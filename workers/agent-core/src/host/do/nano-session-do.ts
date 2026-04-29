/**
 * Session DO Runtime — NanoSessionDO Durable Object.
 *
 * The actual Durable Object class that ties everything together:
 *   - Routes requests via routeRequest → WsController or HttpController
 *   - Handles WebSocket lifecycle (upgrade, message, close) with a real
 *     `ctx.acceptWebSocket()` call when the DO API is available, falling
 *     back to a synthetic response in the vitest harness.
 *   - Runs alarm-based health checks and persists / restores checkpoint
 *     state through `state.storage` when it is provided.
 *   - Drives kernel orchestration through `SessionOrchestrator`.
 *
 * WebSocket ingress goes through `nacp-session` reality:
 *   - `session.start` body reaches the orchestrator via `extractTurnInput`.
 *   - `session.resume` reads `last_seen_seq` (the real schema field) and
 *     triggers the restore path rather than parsing an invented
 *     `checkpoint` field off the wire.
 *
 * Reference: docs/action-plan/session-do-runtime.md Phase 4
 */

import { routeRequest } from "../routes.js";
import type { RouteResult } from "../routes.js";
import { WsController } from "../ws-controller.js";
import { HttpController } from "../http-controller.js";
import { HealthGate } from "../health.js";
import type { HeartbeatTracker, AckWindow } from "../health.js";
import { DEFAULT_RUNTIME_CONFIG, resolveCapabilityBinding } from "../env.js";
import type { RuntimeConfig } from "../env.js";
import { SessionOrchestrator } from "../orchestration.js";
import type { OrchestrationDeps, OrchestrationState } from "../orchestration.js";
import { assertTraceLaw, type TraceContext } from "../traces.js";
import { extractTurnInput } from "../turn-ingress.js";
import { appendInitialContextLayer } from "@haimang/context-core-worker/context-api/append-initial-context-layer";
import { transitionPhase as transitionPhaseImported } from "../actor-state.js";
import { createDefaultCompositionFactory } from "../composition.js";
import type { CompositionFactory, SubsystemHandles } from "../composition.js";
import { makeRemoteBindingsFactory } from "../remote-bindings.js";
import type { CrossSeamAnchor } from "../cross-seam.js";
import type { SessionRuntimeEnv } from "../env.js";
import { validateInternalAuthority } from "../internal-policy.js";
import {
  createMainlineKernelRunner,
} from "../runtime-mainline.js";
import {
  runPreviewVerification as runPreviewVerificationModule,
  getCapabilityTransport as getCapabilityTransportModule,
  type VerifyContext,
} from "./session-do-verify.js";
import {
  awaitAsyncAnswer as awaitAsyncAnswerModule,
  buildWsHelperStorage,
  getTenantScopedStorage as getTenantScopedStorageModule,
  persistCheckpoint as persistCheckpointModule,
  persistTeamUuid as persistTeamUuidModule,
  persistUserUuid as persistUserUuidModule,
  recordAsyncAnswer as recordAsyncAnswerModule,
  restoreFromStorage as restoreFromStorageModule,
  sweepDeferredAnswers as sweepDeferredAnswersModule,
  type DeferredAnswerEntry,
  type PersistenceContext,
} from "./session-do-persistence.js";
import {
  composeWorkspaceWithEvidence,
  type WorkspaceCompositionHandle,
} from "../workspace-runtime.js";
import {
  BoundedEvalSink,
  extractMessageUuid,
  type EvalSinkOverflowDisclosure,
  type EvalSinkStats,
} from "../eval-sink.js";
import {
  InMemoryArtifactStore,
  MountRouter,
  WorkspaceNamespace,
  type EvidenceAnchorLike,
} from "@nano-agent/workspace-context-artifacts";

// Pick the composition factory based on env bindings: prefer
// `makeRemoteBindingsFactory()` when any v1 service binding is present so
// deployed DO consumes the remote seam; fall back to local factory for tests
// with bare `{}` env. `anchorProvider` is threaded into the remote factory so
// live remote requests carry `x-nacp-trace/session/team/request/...` headers.
function selectCompositionFactory(
  env: unknown,
  anchorProvider?: () => CrossSeamAnchor | undefined,
): CompositionFactory {
  const e = (env ?? {}) as Partial<SessionRuntimeEnv>;
  const anyRemote = Boolean(
    resolveCapabilityBinding(e) || e.HOOK_WORKER || e.FAKE_PROVIDER_WORKER,
  );
  return anyRemote
    ? makeRemoteBindingsFactory({ anchorProvider })
    : createDefaultCompositionFactory();
}
import { acceptIngress } from "../session-edge.js";
import type { IngressEnvelope } from "../session-edge.js";
import {
  SessionWebSocketHelper,
  type IngressContext,
  type SessionContext,
  type SessionPhase,
  type SessionStorageLike,
} from "@haimang/nacp-session";
import {
  verifyTenantBoundary,
  type DoStorageLike,
} from "@haimang/nacp-core";
import { D1QuotaRepository } from "../quota/repository.js";
import {
  QuotaAuthorizer,
  type QuotaRuntimeContext,
} from "../quota/authorizer.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — DurableObjectState subset
// ═══════════════════════════════════════════════════════════════════

/**
 * Minimum DO API surface used by NanoSessionDO. Subset of
 * Cloudflare's `DurableObjectState` so vitest can supply doubles.
 */
export interface DurableObjectStateLike {
  readonly storage?: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put<T = unknown>(key: string, value: T): Promise<void>;
    setAlarm?(scheduledTime: number | Date): Promise<void>;
  };
  acceptWebSocket?(ws: unknown): void;
}

/** Key used to persist the last-seen-seq hint from the client. */
const LAST_SEEN_SEQ_KEY = "session:lastSeenSeq";
// CHECKPOINT_STORAGE_KEY + SESSION_TEAM_STORAGE_KEY are owned by
// `./session-do-persistence.ts` and re-imported above (RH0 P0-D2).
const DEFAULT_LLM_CALL_LIMIT = 200;
const DEFAULT_TOOL_CALL_LIMIT = 400;

/** Same UUID (v1–v5) shape the checkpoint validator enforces. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.length > 0
        ? Number(value)
        : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — NanoSessionDO
// ═══════════════════════════════════════════════════════════════════

export class NanoSessionDO {
  private state: OrchestrationState;
  private readonly orchestrator: SessionOrchestrator;
  private readonly healthGate: HealthGate;
  private readonly wsController: WsController;
  private readonly httpController: HttpController;
  private readonly config: RuntimeConfig;
  private readonly subsystems: SubsystemHandles;
  /**
   * 2nd-round R2: live workspace handle that owns the
   * `ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder`
   * trio. The DO calls `captureSnapshot()` from `persistCheckpoint()`
   * so every checkpoint write produces a `snapshot.capture` evidence
   * record into the eval sink — that is the non-test runtime use-site
   * GPT R2 asked for.
   */
  private readonly workspaceComposition: WorkspaceCompositionHandle;
  private readonly quotaAuthorizer: QuotaAuthorizer | null;

  // 3rd-round R2 + B6 dedup: bounded in-memory default eval/evidence sink
  // (capacity 1024). Production deployments override `subsystems.eval`
  // with `DoStorageTraceSink`; default sink is bypassed there.
  private static readonly DEFAULT_SINK_MAX = 1024;
  // P2 Phase 2 (D06 upgrade): if composition provides a `BoundedEvalSink`
  // on `eval`, the DO adopts that instance so getRecords/getDisclosure/
  // getStats read from the same sink the host writes into. Otherwise
  // the DO falls back to its own instance (W4 / backward-compat path).
  private defaultEvalSink: BoundedEvalSink = new BoundedEvalSink({
    capacity: NanoSessionDO.DEFAULT_SINK_MAX,
  });

  // Health tracking — minimal in-memory trackers.
  private readonly heartbeatTracker: HeartbeatTracker & { lastHeartbeatAt: string | null };
  private readonly ackWindow: AckWindow & { pendingCount: number };

  private readonly doState: DurableObjectStateLike;
  private readonly env: unknown;

  /**
   * Session UUID source-of-truth for this DO instance. Set once via
   * `attachSessionUuid()` (typically from the first WebSocket upgrade's
   * route sessionId, from the injected env, or by the worker entry
   * before forwarding a request). `persistCheckpoint()` refuses to
   * write when this is still `null` so we never emit a checkpoint with
   * the old `"unknown"` sentinel that fails the tightened validator.
   */
  private sessionUuid: string | null = null;
  /** Session-scoped team truth, latched from ingress authority or restore. */
  private sessionTeamUuid: string | null = null;
  /** Session-scoped user truth, latched from internal authority or restore. */
  private sessionUserUuid: string | null = null;

  /** Per-stream sequence assigned to each accepted client frame. */
  private streamSeq = 0;
  /**
   * Stream UUID handed to nacp-session at ingress. The DO uses a single
   * primary stream ("main") for the lifetime of the actor; richer
   * multi-stream semantics belong to a later session protocol cut.
   */
  private readonly streamUuid: string = "main";
  /** Last typed ingress rejection — exposed to tests and the controller layer. */
  private lastIngressRejection: IngressEnvelope | null = null;

  /** Lazily-created session trace UUID for this DO actor. */
  private traceUuid: string | null = null;

  /**
   * Optional SessionWebSocketHelper for replay/ack/heartbeat/checkpoint.
   * Constructed on first WS attach; shared across subsequent reconnects
   * so the replay buffer + pending acks survive detach. The fields are
   * mutable because the helper needs a real `sessionUuid` which is only
   * known after the first upgrade.
   */
  private wsHelper: SessionWebSocketHelper | null = null;

  constructor(
    doState: DurableObjectStateLike,
    env: unknown,
    compositionFactory?: CompositionFactory,
  ) {
    this.doState = doState;
    this.env = env;
    this.config = DEFAULT_RUNTIME_CONFIG;
    // Env may carry a pre-seeded SESSION_UUID (e.g. when the DO is
    // constructed in a test harness or when the worker pre-seeds it).
    const envSessionUuid = (env as { SESSION_UUID?: unknown } | undefined)
      ?.SESSION_UUID;
    if (typeof envSessionUuid === "string" && envSessionUuid.length > 0) {
      this.sessionUuid = envSessionUuid;
      const envTeamUuid = (env as { TEAM_UUID?: unknown } | undefined)?.TEAM_UUID;
      if (typeof envTeamUuid === "string" && envTeamUuid.length > 0) {
        this.sessionTeamUuid = envTeamUuid;
      }
      const envUserUuid = (env as { USER_UUID?: unknown } | undefined)?.USER_UUID;
      if (typeof envUserUuid === "string" && envUserUuid.length > 0) {
        this.sessionUserUuid = envUserUuid;
      }
    }

    this.healthGate = new HealthGate(this.config);
    this.wsController = new WsController();
    this.httpController = new HttpController();

    this.heartbeatTracker = { lastHeartbeatAt: null };
    this.ackWindow = { pendingCount: 0 };

    // 2nd-round R1: when the DO selects the remote factory by
    // default, pass an anchorProvider closure that captures `this`
    // so the factory can stamp every outbound remote-seam request
    // with the live `CrossSeamAnchor` derived from DO state. Tests
    // that pass an explicit factory keep the old constructor
    // behaviour (no anchor injection — they handle seam wiring
    // directly).
    const factory =
      compositionFactory ?? selectCompositionFactory(env, () => this.buildCrossSeamAnchor());

    // Build the subsystem composition from the (possibly anchored)
    // factory.
    const baseSubsystems = factory.create(
      (env ?? {}) as unknown as import("../env.js").SessionRuntimeEnv,
      this.config,
    );

    // 3rd-round R2 + P2 Phase 2: when the composition factory
    // supplied an `EvalCompositionHandle` whose `.sink` is a
    // `BoundedEvalSink`, adopt that same sink as the DO's
    // `defaultEvalSink` so `getRecords / getDisclosure / getStats`
    // read from the same instance that `composition.eval.emit()`
    // writes into. Non-matching eval handles (e.g. future remote
    // sink adapters) keep the DO's original default sink; the inline
    // fallback still wraps records into `{record, messageUuid}`
    // before calling the adopted sink.
    const evalCandidate = baseSubsystems.eval as
      | { sink?: unknown; emit?: (e: unknown) => void | Promise<void> }
      | undefined;
    if (evalCandidate?.sink instanceof BoundedEvalSink) {
      this.defaultEvalSink = evalCandidate.sink;
    }

    const baseEvalSink = baseSubsystems.eval as
      | { emit?: (e: unknown) => void | Promise<void> }
      | undefined;
    const effectiveEvalSink =
      baseEvalSink?.emit !== undefined
        ? baseEvalSink
        : {
            // B6 — route into the bounded sink with dedup + overflow
            // disclosure. `extractMessageUuid` is best-effort: it
            // finds the uuid if the record carries an envelope-shaped
            // `header.message_uuid`, `{ envelope: { header: ... } }`,
            // or a direct `messageUuid` field. Records without a uuid
            // are recorded unconditionally (backward compat).
            emit: (record: unknown): void => {
              const messageUuid = extractMessageUuid(record);
              this.defaultEvalSink.emit({ record, messageUuid });
            },
          };

    // 2nd-round R2: when the composition factory did not supply a
    // `workspace` handle, wire one with live evidence emission. This
    // is the runtime use-site GPT R2 asked for — without it,
    // `ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder`
    // were only ever instantiated by tests. The eval sink doubles
    // as the evidence sink so a single emit() reference receives
    // both trace events and evidence records.
    let workspaceHandle: WorkspaceCompositionHandle | undefined =
      baseSubsystems.workspace as WorkspaceCompositionHandle | undefined;
    const hasFullWorkspaceShape =
      workspaceHandle !== undefined &&
      workspaceHandle !== null &&
      typeof (workspaceHandle as { assembler?: unknown })?.assembler === "object" &&
      typeof (workspaceHandle as { compactManager?: unknown })?.compactManager === "object" &&
      typeof (workspaceHandle as { snapshotBuilder?: unknown })?.snapshotBuilder === "object" &&
      typeof (workspaceHandle as { captureSnapshot?: unknown })?.captureSnapshot === "function";
    if (!hasFullWorkspaceShape) {
      const evidenceSink = effectiveEvalSink.emit
        ? { emit: (record: unknown) => effectiveEvalSink.emit!(record) }
        : undefined;
      workspaceHandle = composeWorkspaceWithEvidence({
        namespace: new WorkspaceNamespace(new MountRouter()),
        artifactStore: new InMemoryArtifactStore(),
        evidenceSink,
        evidenceAnchor: () => this.buildEvidenceAnchor(),
      });
    } else if (effectiveEvalSink.emit) {
      // P2 Phase 2: the composition factory provided a full workspace
      // handle but did not wire evidence emission (it cannot — the
      // anchor builder depends on DO state it doesn't have access to).
      // Retrofit evidence wiring on the assembler / compactManager /
      // snapshotBuilder so `snapshot.capture / compact.* / assembly.*`
      // records land in the DO's (possibly adopted) default eval sink.
      const evidenceSink = {
        emit: (record: unknown) => effectiveEvalSink.emit!(record),
      };
      const evidenceAnchor = () => this.buildEvidenceAnchor();
      workspaceHandle!.assembler.setEvidenceWiring({
        evidenceSink,
        evidenceAnchor,
      });
      workspaceHandle!.compactManager.setEvidenceWiring({
        evidenceSink,
        evidenceAnchor,
      });
      workspaceHandle!.snapshotBuilder.setEvidenceWiring({
        evidenceSink,
        evidenceAnchor,
      });
    }
    this.subsystems = {
      ...baseSubsystems,
      eval: effectiveEvalSink,
      workspace: workspaceHandle,
    };
    this.quotaAuthorizer = this.buildQuotaAuthorizer(effectiveEvalSink);
    this.workspaceComposition = workspaceHandle!;

    const deps = this.buildOrchestrationDeps();
    this.orchestrator = new SessionOrchestrator(deps, this.config);
    this.state = this.orchestrator.createInitialState();
  }

  /**
   * 2nd-round R2: build the live `EvidenceAnchor` shape that the
   * workspace evidence emitters expect. Mirrors the trace context
   * but adds an explicit `timestamp` per call so each emission lands
   * with the wall-clock time it was produced. Returns `undefined`
   * before identity is latched so the helpers gracefully suppress.
   */
  private buildEvidenceAnchor(): EvidenceAnchorLike | undefined {
    const trace = this.buildTraceContext();
    if (!trace) return undefined;
    return {
      traceUuid: trace.traceUuid,
      sessionUuid: trace.sessionUuid,
      teamUuid: trace.teamUuid,
      sourceRole: trace.sourceRole,
      sourceKey: trace.sourceKey,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 2nd-round R1: derive the per-request `CrossSeamAnchor` from
   * current DO state. Returns `undefined` when the DO has not yet
   * latched a sessionUuid / teamUuid — callers MUST treat that as
   * "no anchor available" rather than fall back to a synthetic one.
   * `requestUuid` is minted fresh per call so each outbound
   * request is independently correlatable on the receiving Worker.
   */
  private buildCrossSeamAnchor(): CrossSeamAnchor | undefined {
    const teamUuid = this.currentTeamUuid();
    if (!teamUuid) return undefined;
    if (!this.sessionUuid) return undefined;
    if (!this.traceUuid) this.traceUuid = crypto.randomUUID();
    return {
      traceUuid: this.traceUuid,
      sessionUuid: this.sessionUuid,
      teamUuid,
      requestUuid: crypto.randomUUID(),
      sourceRole: "session",
      sourceKey: "nano-agent.session.do@v1",
    };
  }

  private buildQuotaContext(turnUuid?: string | null): QuotaRuntimeContext | null {
    const trace = this.buildTraceContext();
    if (!trace) return null;
    return {
      teamUuid: trace.teamUuid,
      sessionUuid: trace.sessionUuid,
      traceUuid: trace.traceUuid,
      // Kernel turn IDs are local runtime identifiers, not the durable
      // `nano_session_turns.turn_uuid` keys owned by orchestrator-core.
      // Until a cross-worker durable turn mapping is frozen, quota/audit
      // writes must stay session-scoped to avoid foreign-key drift.
      turnUuid: turnUuid ?? null,
    };
  }

  private buildQuotaAuthorizer(evalSink: {
    emit?: (record: unknown) => void | Promise<void>;
  }): QuotaAuthorizer | null {
    const runtimeEnv = this.env as Partial<SessionRuntimeEnv> | undefined;
    const db = runtimeEnv?.NANO_AGENT_DB;
    if (!db) return null;
    return new QuotaAuthorizer(
      new D1QuotaRepository(db, {
        allowSeedMissingTeam: runtimeEnv.NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED === "true",
      }),
      {
      llmLimit: readPositiveInt(
        runtimeEnv.NANO_AGENT_LLM_CALL_LIMIT,
        DEFAULT_LLM_CALL_LIMIT,
      ),
      toolLimit: readPositiveInt(
        runtimeEnv.NANO_AGENT_TOOL_CALL_LIMIT,
        DEFAULT_TOOL_CALL_LIMIT,
      ),
      emitTrace: async (event) => {
        assertTraceLaw(event);
        if (evalSink.emit) {
          await evalSink.emit(event);
        }
      },
      },
    );
  }

  private createLiveKernelRunner() {
    const runtimeEnv = this.env as Partial<SessionRuntimeEnv> | undefined;
    if (!runtimeEnv?.AI) return null;
    return createMainlineKernelRunner({
      ai: runtimeEnv.AI,
      modelCatalogDb: runtimeEnv.NANO_AGENT_DB,
      sessionFileReader: runtimeEnv.FILESYSTEM_CORE,
      quotaAuthorizer: this.quotaAuthorizer,
      capabilityTransport: this.getCapabilityTransport(),
      contextProvider: () => this.buildQuotaContext(),
      anchorProvider: () => this.buildCrossSeamAnchor(),
      // ZX5 Lane F3: register usage-commit callback so quota events are
      // observable. WS push to the attached client requires orchestrator-core
      // coordination (deferred to follow-up PR); for now the event is logged
      // so it is at minimum visible in wrangler tail.
      onUsageCommit: (event) => {
        // RH1 P1-08 — push `session.usage.update` server frame to client
        // (cross-worker WS push via ORCHESTRATOR_CORE service binding).
        // Best-effort: missing binding / detached client returns delivered=false
        // and the trace log below stays as the audit anchor.
        console.log("usage-commit", {
          tag: "usage-commit",
          kind: event.kind,
          remaining: event.remaining,
          limitValue: event.limitValue,
        });
        void this.pushServerFrameToClient({
          kind: "session.usage.update",
          session_uuid: this.sessionUuid ?? "unknown",
          quota_kind: event.kind,
          remaining: event.remaining,
          limit_value: event.limitValue,
          detail: event.detail,
        });
      },
      // RH2 P2-12 — runtime tool semantic streaming. Map runtime
      // `ToolSemanticEvent` → NACP-compatible lightweight frames:
      //   - tool_use_start / tool_use_delta → `llm.delta` body
      //   - tool_call_result → `tool.call.result` body
      // (The `tool.call.result` kind is mapped to `session.stream.event` by
      // frame-compat, so it's a stream event body. The `llm.delta` ones with
      // tool_use_* content_type are also `session.stream.event` body.)
      onToolEvent: (event) => {
        if (event.kind === "tool_call_result") {
          void this.pushServerFrameToClient({
            kind: "tool.call.result",
            session_uuid: this.sessionUuid ?? "unknown",
            tool_call_id: event.tool_call_id,
            tool_name: event.tool_name,
            status: event.status ?? "ok",
            ...(event.output !== undefined ? { output: event.output } : {}),
            ...(event.error !== undefined ? { error: event.error } : {}),
          });
          return;
        }
        // tool_use_start / tool_use_delta — llm.delta body
        void this.pushServerFrameToClient({
          kind: "llm.delta",
          session_uuid: this.sessionUuid ?? "unknown",
          content_type: event.kind,
          tool_call_id: event.tool_call_id,
          tool_name: event.tool_name,
          ...(event.tool_input !== undefined ? { tool_input: event.tool_input } : {}),
          ...(event.args_chunk !== undefined ? { args_chunk: event.args_chunk } : {}),
        });
      },
    });
  }

  // ── fetch ──────────────────────────────────────────────────

  /**
   * Entry point for all HTTP requests to this DO.
   * Routes to WsController (upgrade) or HttpController (fallback).
   */
  async fetch(request: Request): Promise<Response> {
    const route: RouteResult = routeRequest(request);
    const isInternalDoRequest = new URL(request.url).hostname === "session.internal";
    const validatedInternal = isInternalDoRequest
      ? await validateInternalAuthority(
          request,
          this.env as Pick<
            SessionRuntimeEnv,
            "NANO_INTERNAL_BINDING_SECRET" | "TEAM_UUID" | "ENVIRONMENT"
          >,
        )
      : null;
    if (validatedInternal && !validatedInternal.ok) return validatedInternal.response;
    if (validatedInternal?.ok) {
      this.attachTeamUuid(validatedInternal.authority.tenant_uuid);
      this.attachUserUuid(validatedInternal.authority.sub);
      if (!this.traceUuid && validatedInternal.traceUuid.length > 0) {
        this.traceUuid = validatedInternal.traceUuid;
      }
    }

    switch (route.type) {
      case "websocket":
        this.attachSessionUuid(route.sessionId);
        return this.handleWebSocketUpgrade(route.sessionId);

      case "http-fallback": {
        if (!this.config.httpFallbackEnabled) {
          return new Response(
            JSON.stringify({ error: "HTTP fallback disabled" }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        }
        this.attachSessionUuid(route.sessionId);

        // Share the DO's actor + timeline with the HTTP controller so
        // WS and HTTP fallback resolve to the same session model.
        this.httpController.attachHost({
          submitFrame: (raw) => this.webSocketMessage(null, raw),
          getPhase: () => this.state.actorState.phase,
          readTimeline: () => {
            const helper = this.getWsHelper();
            if (!helper) return [];
            const frames = helper.replay.replay(this.streamUuid, 0);
            return frames.map((f) => f.body as Record<string, unknown>);
          },
          // A4-A5 review R1 (Kimi): share the DO-minted trace identity
          // so HTTP fallback client frames stay on the same trace as
          // the WS path. Latch a traceUuid on first access so both
          // transports converge even when HTTP fallback fires first.
          getTraceUuid: () => {
            if (!this.traceUuid) this.traceUuid = crypto.randomUUID();
            return this.traceUuid;
          },
          runVerification: (sessionId, body) =>
            this.runPreviewVerification(sessionId, body),
        });

        // Optional JSON body from HTTP clients (start / input carry content).
        let body: unknown = validatedInternal?.ok ? validatedInternal.bodyJson ?? undefined : undefined;
        if (
          body === undefined &&
          (request.method === "POST" ||
            request.method === "PUT" ||
            request.method === "PATCH")
        ) {
          try {
            body = await request.json();
          } catch {
            body = undefined;
          }
        }
        // ZX4 P4-01 / P6-01 — intercept decision-forwarding actions so
        // they don't flow through httpController (which is the user-facing
        // session action surface). These are the orchestrator-core →
        // agent-core async-answer pipeline endpoints.
        if (route.action === "permission-decision") {
          return this.handlePermissionDecisionRecord(route.sessionId, body);
        }
        if (route.action === "elicitation-answer") {
          return this.handleElicitationAnswerRecord(route.sessionId, body);
        }
        const result = await this.httpController.handleRequest(
          route.sessionId,
          route.action,
          body,
        );
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      case "not-found":
      default:
        return new Response(
          JSON.stringify({ error: "Not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
    }
  }

  /**
   * Attach a sessionUuid to this DO instance. The first valid UUID-shaped
   * call wins; subsequent calls are ignored so the identity cannot be
   * flipped mid-session. Non-UUID strings (e.g. route 404 fallbacks) are
   * rejected so they can never poison the checkpoint path.
   */
  attachSessionUuid(candidate: string | undefined | null): void {
    if (this.sessionUuid !== null) return;
    if (!candidate || !UUID_RE.test(candidate)) return;
    this.sessionUuid = candidate;
  }

  // ZX4 Phase 4 P4-01 — record permission decision (delegated to seam).
  private async handlePermissionDecisionRecord(
    sessionId: string,
    body: unknown,
  ): Promise<Response> {
    return recordAsyncAnswerModule(this.buildPersistenceContext(), sessionId, body, "permission");
  }

  // ZX4 Phase 6 P6-01 — symmetric elicitation answer path (delegated to seam).
  private async handleElicitationAnswerRecord(
    sessionId: string,
    body: unknown,
  ): Promise<Response> {
    return recordAsyncAnswerModule(this.buildPersistenceContext(), sessionId, body, "elicitation");
  }

  // ZX5 Lane F1/F2 — alarm-driven wait-and-resume primitives(per Q10
  // owner direction:b alarm-driven). Map keyed by `${kind}:${requestUuid}`;
  // deferred lifecycle implementation lives in `./session-do-persistence.ts`.
  // GLM R8 hibernation safety: storage-probe + alarm sweepDeferredAnswers
  // backstop guarantees recovery; timeout default 60s, clamped to ≤5 min.
  private readonly deferredAnswers = new Map<
    string,
    { resolve: (decision: Record<string, unknown>) => void; reject: (error: Error) => void; expiresAt: number; kind: "permission" | "elicitation"; requestUuid: string }
  >();

  async awaitAsyncAnswer(input: {
    kind: "permission" | "elicitation";
    requestUuid: string;
    timeoutMs?: number;
  }): Promise<Record<string, unknown>> {
    return awaitAsyncAnswerModule(this.buildPersistenceContext(), input);
  }

  // ZX5 Lane F1/F2 — alarm sweep delegated to seam (sweepDeferredAnswersModule).
  async sweepDeferredAnswers(): Promise<void> {
    return sweepDeferredAnswersModule(this.buildPersistenceContext());
  }

  // RH1 P1-03 — emit `session.permission.request` to the client (via
  // cross-worker push to orchestrator-core User DO), then await decision.
  async emitPermissionRequestAndAwait(input: {
    sessionUuid: string;
    requestUuid: string;
    capability: string;
    reason?: string;
    timeoutMs?: number;
  }): Promise<Record<string, unknown>> {
    await this.pushServerFrameToClient({
      kind: "session.permission.request",
      session_uuid: input.sessionUuid,
      request_uuid: input.requestUuid,
      capability: input.capability,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    });
    return this.awaitAsyncAnswer({
      kind: "permission",
      requestUuid: input.requestUuid,
      timeoutMs: input.timeoutMs,
    });
  }

  // RH1 P1-04 — symmetric for elicitation.
  async emitElicitationRequestAndAwait(input: {
    sessionUuid: string;
    requestUuid: string;
    prompt: string;
    timeoutMs?: number;
  }): Promise<Record<string, unknown>> {
    await this.pushServerFrameToClient({
      kind: "session.elicitation.request",
      session_uuid: input.sessionUuid,
      request_uuid: input.requestUuid,
      prompt: input.prompt,
    });
    return this.awaitAsyncAnswer({
      kind: "elicitation",
      requestUuid: input.requestUuid,
      timeoutMs: input.timeoutMs,
    });
  }

  /**
   * RH1 P1-07 — push a server frame to the client attached to this session
   * via the cross-worker WS push topology:
   *   agent-core ─[ORCHESTRATOR_CORE service binding]→ orchestrator-core
   *     WorkerEntrypoint.forwardServerFrameToClient ─[ORCHESTRATOR_USER_DO.idFromName]
   *     → User DO.emitServerFrame
   *
   * Best-effort by design: missing binding / detached client / RPC error is
   * logged and returned as `delivered=false` rather than thrown — runtime
   * truth (storage decision / quota commit) stays the source of truth.
   */
  private async pushServerFrameToClient(frame: {
    readonly kind: string;
    readonly [k: string]: unknown;
  }): Promise<{ ok: boolean; delivered: boolean; reason?: string }> {
    const env = this.env as Partial<SessionRuntimeEnv> | undefined;
    const orch = env?.ORCHESTRATOR_CORE;
    if (!orch || typeof orch.forwardServerFrameToClient !== "function") {
      return { ok: false, delivered: false, reason: "orchestrator-core-binding-missing" };
    }
    const sessionUuid = this.sessionUuid;
    if (!sessionUuid) {
      return { ok: false, delivered: false, reason: "no-session-uuid" };
    }
    const teamUuid = this.currentTeamUuid();
    // The User DO is keyed by user_uuid (sub) — RH1 carries no user_uuid
    // attribute on NanoSessionDO yet (that wiring is RH3 D6 device gate
    // territory). Fall back to a TEAM-keyed forward only when authority
    // chain doesn't carry a user identity; the meta.userUuid field is
    // declared optional on the orchestrator-core entrypoint to allow this
    // best-effort behavior.
    const userUuid = this.currentUserUuid();
    if (!userUuid) {
      return { ok: false, delivered: false, reason: "no-user-uuid-for-routing" };
    }
    try {
      return await orch.forwardServerFrameToClient(sessionUuid, frame, {
        userUuid,
        ...(teamUuid ? { teamUuid } : {}),
        traceUuid: this.traceUuid ?? undefined,
      });
    } catch (error) {
      console.warn("push-server-frame-failed", {
        tag: "push-server-frame-failed",
        session_uuid: sessionUuid,
        kind: frame.kind,
        error: String(error),
      });
      return { ok: false, delivered: false, reason: "rpc-error" };
    }
  }

  private attachTeamUuid(candidate: string | undefined | null): void {
    if (typeof candidate !== "string" || candidate.length === 0) return;
    void persistTeamUuidModule(this.buildPersistenceContext(), candidate);
  }

  private attachUserUuid(candidate: string | undefined | null): void {
    if (typeof candidate !== "string" || candidate.length === 0) return;
    void persistUserUuidModule(this.buildPersistenceContext(), candidate);
  }

  private currentTeamUuid(): string | null {
    return this.sessionTeamUuid && this.sessionTeamUuid.length > 0
      ? this.sessionTeamUuid
      : null;
  }

  private currentUserUuid(): string | null {
    return this.sessionUserUuid && this.sessionUserUuid.length > 0
      ? this.sessionUserUuid
      : null;
  }

  // ── webSocketMessage ───────────────────────────────────────

  /**
   * Handle an incoming WebSocket message.
   *
   * A4 P1-02: every client frame goes through `acceptIngress()` so
   * `nacp-session` is the single source of truth for schema, authority
   * stamping, and phase/role legality. The DO never parses
   * `message_type` directly. Typed rejections are routed to
   * `recordIngressRejection()` for caller-managed handling.
   *
   * Dispatched message types:
   *   session.start            → extractTurnInput → orchestrator.startTurn
   *   session.followup_input   → extractTurnInput → orchestrator.startTurn
   *   session.cancel           → orchestrator.cancelTurn
   *   session.end              → orchestrator.endSession
   *   session.resume           → read `last_seen_seq` + restoreFromStorage
   *   session.stream.ack       → ack accounting (decrement pending)
   *   session.heartbeat        → heartbeat timestamp
   */
  async webSocketMessage(
    _ws: unknown,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const raw =
      typeof message === "string"
        ? message
        : new TextDecoder().decode(message);

    const envelope = await this.acceptClientFrame(raw);
    if (!envelope.ok) return;

    await this.dispatchAdmissibleFrame(envelope.messageType, envelope.body);
  }

  /**
   * Run a raw wire payload through nacp-session ingress + legality gate.
   * The DO uses this for both WS and HTTP fallback so they share one
   * truth. Returns a typed envelope; rejections are recorded so callers
   * (and tests) can introspect them without exceptions.
   *
   * B9 GPT-review fix (B9-R1): this method is `async` and `await`s the
   * tenant-boundary verification BEFORE declaring the frame admissible.
   * A verification failure is converted into a typed rejection so the
   * caller's `if (!envelope.ok) return;` gate actually prevents dispatch.
   */
  async acceptClientFrame(raw: string | unknown): Promise<IngressEnvelope> {
    const result = acceptIngress({
      raw,
      authority: this.buildIngressContext(),
      streamSeq: this.streamSeq,
      streamUuid: this.streamUuid,
      phase: this.state.actorState.phase as SessionPhase,
    });
    if (!result.ok) {
      this.lastIngressRejection = result;
      return result;
    }

    // B9: explicit, `await`ed tenant boundary verification. If the
    // validated frame carries `refs[*]` pointing at a foreign team, the
    // `authority.team_uuid` fails to match `env.TEAM_UUID`, or any other
    // boundary rule is violated, we convert the thrown error into a
    // typed rejection so the caller's admissibility gate blocks dispatch.
    try {
      this.attachTeamUuid(result.frame.authority.team_uuid);
      const doTeamUuid = this.tenantTeamUuid();
      await verifyTenantBoundary(result.frame, {
        serving_team_uuid: doTeamUuid,
        do_team_uuid: doTeamUuid,
        accept_delegation: false,
      });
    } catch (err) {
      const rejection: IngressEnvelope = {
        ok: false,
        reason: "schema-invalid",
        message: `tenant boundary verification failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        messageType: result.messageType,
      };
      this.lastIngressRejection = rejection;
      return rejection;
    }

    this.streamSeq += 1;
    this.lastIngressRejection = null;
    return result;
  }

  /**
   * B9: stable source-of-truth for the DO's tenant identity. Runtime
   * tenant truth is latched from request authority; deploy-local TEAM_UUID
   * is no longer a fallback. The `"_unknown"` value is only used before
   * a session-owned team has been attached, so legacy unit harnesses can
   * construct the DO without fabricating tenant identity.
   */
  private tenantTeamUuid(): string {
    const teamUuid = this.currentTeamUuid();
    return typeof teamUuid === "string" && teamUuid.length > 0
      ? teamUuid
      : "_unknown";
  }

  // RH0 P0-D2 — tenant-scoped storage proxy delegated to
  // `./session-do-persistence.ts` (B9 invariant unchanged).
  private getTenantScopedStorage(): DoStorageLike | null {
    return getTenantScopedStorageModule(this.buildPersistenceContext());
  }

  /**
   * Dispatch a frame that the legality gate already accepted. No
   * legality decisions live here — they all happened in
   * `acceptClientFrame()`.
   */
  async dispatchAdmissibleFrame(
    messageType: string,
    body: Record<string, unknown> | undefined,
  ): Promise<void> {
    // P2 Phase 3 (D05 R1 + R2) — session.start initial_context consumer.
    //
    // BEFORE `extractTurnInput` so the helper-maintained pending layers
    // list is populated in time for the upcoming turn's `assemble()`
    // call. Reads the load-bearing entry per R1:
    //     this.subsystems.workspace?.assembler
    // (NOT a top-level `assembler` handle — R1 forbids that shape.)
    //
    // `appendInitialContextLayer` is a helper-maintained pending layer
    // manager; it does NOT mutate `ContextAssembler` directly and it
    // does NOT invent an `initial_context` layer kind. The host will
    // drain the pending list at `assemble()` time (future kernel
    // integration — stub pass-through for P2).
    //
    // Any error surfaces via `system.notify severity=error` (R2:
    // canonical kind; do NOT invent `system.error`). The turn is
    // allowed to continue.
    if (messageType === "session.start" && body?.["initial_context"]) {
      const assembler = (
        this.subsystems.workspace as
          | { assembler?: import("@nano-agent/workspace-context-artifacts").ContextAssembler }
          | undefined
      )?.assembler;
      if (assembler) {
        try {
          const payload = body["initial_context"] as import("@haimang/nacp-session").SessionStartInitialContext;
          appendInitialContextLayer(assembler, payload);
        } catch (err) {
          const message =
            err instanceof Error
              ? `initial_context_consumer_error: ${err.message}`
              : `initial_context_consumer_error: unknown error`;
          const helper = this.ensureWsHelper();
          if (helper) {
            try {
              helper.pushEvent(this.streamUuid, {
                kind: "system.notify",
                severity: "error",
                message,
              } as unknown as Parameters<typeof helper.pushEvent>[1]);
            } catch {
              // pushEvent failure is non-fatal — the turn continues.
            }
          }
        }
      }
    }

    switch (messageType) {
      case "session.start":
      case "session.followup_input": {
        const turnInput = extractTurnInput(messageType, body ?? {});
        if (turnInput) {
          // A4 P3-02 single-active-turn invariant: if a turn is already
          // running, queue the input for the next turn instead of
          // starting a parallel one. Phase 3 only acks the queued
          // input; richer queue / replace / merge semantics are out of
          // scope.
          if (this.state.actorState.phase === "turn_running") {
            this.state = {
              ...this.state,
              actorState: {
                ...this.state.actorState,
                pendingInputs: [
                  ...this.state.actorState.pendingInputs,
                  turnInput,
                ],
              },
            };
          } else {
            this.state = await this.orchestrator.startTurn(
              this.state,
              turnInput,
            );
            // A4-A5 review R1: after a turn finishes the orchestrator
            // may have left queued follow-up inputs behind. Drain them
            // FIFO before returning control so the single-active-turn
            // invariant is actually enforced end-to-end.
            this.state = await this.drainPendingInputs(this.state);
          }
        }
        break;
      }

      case "session.cancel": {
        this.state = await this.orchestrator.cancelTurn(this.state);
        // A4-A5 review R1: a cancel releases `turn_running`, so any
        // follow-up inputs queued while the now-cancelled turn was
        // running should run next.
        this.state = await this.drainPendingInputs(this.state);
        break;
      }

      case "session.end": {
        this.state = await this.orchestrator.endSession(this.state);
        break;
      }

      case "session.resume": {
        const lastSeenSeq = body?.["last_seen_seq"];
        if (typeof lastSeenSeq === "number" && Number.isFinite(lastSeenSeq)) {
          // B9: tenant-scoped write (LAST_SEEN_SEQ_KEY).
          const scoped = this.getTenantScopedStorage();
          if (scoped) await scoped.put(LAST_SEEN_SEQ_KEY, lastSeenSeq);
          // Ask the helper to replay the gap, if it exists. The helper
          // is the single source of truth for per-stream seq + replay
          // buffer state (A4 P2-02 / P2-03).
          const helper = this.ensureWsHelper();
          if (helper) {
            // Restore the helper from the DO storage first so that a
            // reconnect after hibernation sees the pre-detach buffer.
            const helperStorage = this.wsHelperStorage();
            if (helperStorage) await helper.restore(helperStorage);
            helper.handleResume(this.streamUuid, lastSeenSeq);
          }
        }
        await this.restoreFromStorage();
        await this.emitEdgeTrace("session.edge.resume", {
          lastSeenSeq:
            typeof lastSeenSeq === "number" ? lastSeenSeq : null,
        });
        break;
      }

      case "session.stream.ack": {
        const ackedSeq = body?.["acked_seq"];
        const streamUuid = body?.["stream_uuid"];
        if (
          typeof ackedSeq === "number" &&
          Number.isFinite(ackedSeq) &&
          typeof streamUuid === "string"
        ) {
          const helper = this.ensureWsHelper();
          if (helper) helper.handleAck(streamUuid, ackedSeq);
        }
        if (this.ackWindow.pendingCount > 0) {
          this.ackWindow.pendingCount -= 1;
        }
        break;
      }

      case "session.heartbeat": {
        this.heartbeatTracker.lastHeartbeatAt = new Date().toISOString();
        const helper = this.ensureWsHelper();
        if (helper) helper.handleHeartbeat();
        break;
      }

      default:
        break;
    }
  }

  /** Build the IngressContext for nacp-session's authority stamping. */
  private buildIngressContext(): IngressContext {
    const teamUuid = this.currentTeamUuid() ?? "_unknown";
    const planLevel: IngressContext["plan_level"] = "internal";
    return {
      team_uuid: teamUuid,
      plan_level: planLevel,
      stamped_by_key: "nano-agent.session.do@v1",
    };
  }

  /** Get the most recent typed ingress rejection (or null if last frame was admitted). */
  getLastIngressRejection(): IngressEnvelope | null {
    return this.lastIngressRejection;
  }

  /**
   * Return the DO-owned SessionWebSocketHelper, constructing it lazily
   * with the best-available session context. This is the same helper
   * referenced by replay / ack / heartbeat / checkpoint / restore.
   *
   * `null` return means the DO does not yet have a sessionUuid and
   * cannot construct a helper safely — the caller should avoid relying
   * on replay/ack state until the session has an identity.
   */
  ensureWsHelper(): SessionWebSocketHelper | null {
    if (this.wsHelper) return this.wsHelper;
    if (this.sessionUuid === null) return null;
    const teamUuid = this.currentTeamUuid();
    if (teamUuid === null) return null;
    if (!this.traceUuid) this.traceUuid = crypto.randomUUID();

    const sessionContext: SessionContext = {
      team_uuid: teamUuid,
      plan_level: "internal",
      session_uuid: this.sessionUuid,
      trace_uuid: this.traceUuid,
      producer_key: "nano-agent.session.do@v1",
      stamped_by_key: "nano-agent.session.do@v1",
    };
    this.wsHelper = new SessionWebSocketHelper({ sessionContext });
    return this.wsHelper;
  }

  /** Get the current WS helper without constructing it. */
  getWsHelper(): SessionWebSocketHelper | null {
    return this.wsHelper;
  }

  /** Current trace UUID, if assigned. */
  getTraceUuid(): string | null {
    return this.traceUuid;
  }

  /**
   * Emit an edge-lifecycle trace event through the composition's eval
   * sink (A4 P4-01). The event is typed structurally against
   * `@nano-agent/eval-observability`'s `TraceEventBase` so any sink wired
   * in by a composition factory sees a trace-law compliant event.
   *
   * No-op when the session has no team UUID / session UUID yet — in that
   * case there is no anchor to thread, so silently dropping is the
   * correct trace-first behaviour (the DO has nothing to anchor to).
   */
  /**
   * A4-A5 review R1: repeatedly drain the pending-input FIFO until
   * either the queue is empty or the next input cannot be started
   * (e.g. because `startTurn` re-entered `turn_running`). Cap the loop
   * at `maxTurnSteps` so a misbehaving drain cannot infinite-loop.
   */
  private async drainPendingInputs(
    state: OrchestrationState,
  ): Promise<OrchestrationState> {
    let current = state;
    // The queue is bounded by wire-level acceptance, but we belt-and-
    // braces the loop at the same runtime cap used for step-budget.
    const safetyCap = Math.max(1, this.config.maxTurnSteps);
    for (let i = 0; i < safetyCap; i++) {
      if (current.actorState.pendingInputs.length === 0) return current;
      if (current.actorState.phase === "turn_running") return current;
      const next = await this.orchestrator.drainNextPendingInput(current);
      if (next === current) return current;
      current = next;
    }
    return current;
  }

  private async emitEdgeTrace(
    eventKind: string,
    extra: Record<string, unknown> = {},
    layer: "live" | "durable-audit" = "durable-audit",
  ): Promise<void> {
    const evalSink = this.subsystems.eval as
      | { emit?: (e: unknown) => Promise<void> | void }
      | undefined;
    if (!evalSink?.emit) return;
    if (!this.traceUuid) this.traceUuid = crypto.randomUUID();
    const teamUuid = this.currentTeamUuid();
    if (!teamUuid || !this.sessionUuid) return;

    await evalSink.emit({
      eventKind,
      timestamp: new Date().toISOString(),
      traceUuid: this.traceUuid,
      sessionUuid: this.sessionUuid,
      teamUuid,
      sourceRole: "session",
      sourceKey: "nano-agent.session.do@v1",
      audience: "internal",
      layer,
      ...extra,
    });
  }

  // ── webSocketClose ─────────────────────────────────────────

  /**
   * Handle WebSocket close. Persists a checkpoint when DO storage is
   * available, then detaches the actor back to the `unattached` phase.
   */
  async webSocketClose(_ws: unknown): Promise<void> {
    await this.emitEdgeTrace("session.edge.detach");
    await this.persistCheckpoint();

    if (this.state.actorState.phase === "turn_running") {
      const attached = transitionPhaseImported(this.state.actorState, "attached");
      this.state = {
        ...this.state,
        actorState: transitionPhaseImported(attached, "unattached"),
      };
    } else if (this.state.actorState.phase === "attached") {
      this.state = {
        ...this.state,
        actorState: transitionPhaseImported(this.state.actorState, "unattached"),
      };
    }
  }

  // ── alarm ──────────────────────────────────────────────────

  /**
   * Alarm handler — periodic health check + reschedule.
   *
   * When DO storage exposes `setAlarm`, we reschedule the next tick
   * using the configured heartbeat interval. When the health gate signals
   * that the connection should close we persist a checkpoint before
   * returning.
   */
  async alarm(): Promise<void> {
    const status = this.healthGate.checkHealth(
      this.heartbeatTracker,
      this.ackWindow,
    );

    if (this.healthGate.shouldClose(status)) {
      await this.persistCheckpoint();
    }

    // ZX5 Lane F1/F2 — alarm-driven sweep of deferred async answers
    // (per Q10 owner direction:b 选项 alarm-driven)。每个 heartbeat tick
    // 检查内存 deferred map 是否有过期 OR storage 已 land 但内存未 resolve
    // (DO restart 后的 storage-first recovery)。
    await this.sweepDeferredAnswers();

    const storage = this.doState.storage;
    if (storage?.setAlarm) {
      await storage.setAlarm(Date.now() + this.config.heartbeatIntervalMs);
    }
  }

  // ── Composition + orchestration deps ────────────────────────

  /**
   * Wire the orchestrator deps from the composed subsystem handles.
   *
   * Each handle is opaque (`unknown`) — in production the composition
   * factory supplies real kernel / hook / eval / stream handles. In the
   * default factory they are no-op stubs so the DO class is usable
   * standalone; tests substitute a real factory via the constructor.
   */
  private buildOrchestrationDeps(): OrchestrationDeps {
    const handles = this.subsystems;
    const liveKernel = this.createLiveKernelRunner();

    return {
      advanceStep: async (snapshot, signals) => {
        const kernel = handles.kernel as
          | {
              advanceStep?: (
                snap: unknown,
                sig: unknown,
              ) => Promise<{ snapshot: unknown; events: unknown[]; done: boolean }>;
            }
          | undefined;
        if (kernel?.advanceStep) return kernel.advanceStep(snapshot, signals);
        if (liveKernel) {
          return liveKernel.advanceStep(
            snapshot as import("../../kernel/state.js").KernelSnapshot,
            signals as import("../../kernel/scheduler.js").SchedulerSignals,
          );
        }
        return { snapshot, events: [], done: true };
      },
      buildCheckpoint: (snapshot) => snapshot,
      restoreCheckpoint: (fragment) => fragment,
      createSessionState: () => ({
        phase: "idle",
        turnCount: 0,
        totalTokens: 0,
        compactCount: 0,
        lastCheckpointAt: null,
        createdAt: new Date().toISOString(),
      }),
      createTurnState: (turnId: string) => ({
        turnId,
        stepIndex: 0,
        phase: "pending",
        pendingToolCalls: [],
        messages: [],
        startedAt: new Date().toISOString(),
        interruptReason: null,
        llmFinished: false,
      }),
      emitHook: async (event, payload, context) => {
        // 2nd-round R1: the orchestrator-supplied `context` is just
        // the call-site bag (turnId / sessionId / etc.). To make
        // sure every live `hooks.emit` carries cross-seam identity,
        // we MERGE in the current `CrossSeamAnchor` so the remote
        // hook handle's `pickAnchor(context)` succeeds. The factory
        // also has an anchor fallback, so this merge is belt-and-
        // braces: callers that already include a richer anchor
        // (future Skill seam, etc.) keep their values intact.
        const anchor = this.buildCrossSeamAnchor();
        const merged = anchor
          ? typeof context === "object" && context !== null
            ? { ...anchor, ...(context as Record<string, unknown>) }
            : { ...anchor, payloadContext: context }
          : context;
        const hooks = handles.hooks as
          | { emit?: (e: string, p: unknown, c?: unknown) => Promise<unknown> }
          | undefined;
        if (hooks?.emit) return hooks.emit(event, payload, merged);
        return undefined;
      },
      emitTrace: async (event) => {
        // A2-A3 review R1: orchestrator now always hands a typed
        // `TraceEvent` built through the shared builders, so the sink
        // boundary is the right place to assert trace-law before any
        // storage/WAL side-effect runs. A violation here points at a
        // code path that bypasses the builder and must be fixed
        // before the event becomes an audit anomaly.
        assertTraceLaw(event);
        const evalSink = handles.eval as
          | { emit?: (e: unknown) => Promise<void> | void }
          | undefined;
        if (evalSink?.emit) await evalSink.emit(event);
      },
      traceContext: () => this.buildTraceContext(),
      pushStreamEvent: (_kind, body) => {
        // A4-A5 review R2: the outbound `session.stream.event` surface
        // MUST go through `SessionWebSocketHelper.pushEvent()` so the
        // replay buffer, ack window, and attached socket all see the
        // same truth. The body already embeds `{ kind, ... }` per the
        // discriminated `SessionStreamEventBodySchema`; we forward it
        // verbatim and let the helper validate. If the helper has not
        // yet been assembled (tests without a sessionUuid) we fall
        // back to whatever raw kernel hook the composition provided —
        // that path is only hit in pure-unit harnesses.
        const helper = this.ensureWsHelper();
        if (helper) {
          try {
            helper.pushEvent(
              this.streamUuid,
              body as unknown as Parameters<typeof helper.pushEvent>[1],
            );
          } catch {
            // A pushEvent failure (e.g. ack backpressure) MUST NOT
            // wedge the orchestrator; the replay buffer will report
            // the lost seq via the ack window next tick.
          }
          return;
        }
        const stream = handles.kernel as
          | { pushStreamEvent?: (body: Record<string, unknown>) => void }
          | undefined;
        if (stream?.pushStreamEvent) stream.pushStreamEvent(body);
      },
    };
  }

  /**
   * Build the per-session `TraceContext` the orchestrator hands to its
   * trace builders. Returns `undefined` when the DO has not yet latched
   * a sessionUuid / teamUuid (e.g. right after cold start, before the
   * first client frame). In that window the orchestrator falls back to
   * its `ZERO_TRACE_CONTEXT` placeholder — this keeps trace-law
   * assertions happy while flagging that the producer is not yet
   * identified.
   */
  private buildTraceContext(): TraceContext | undefined {
    const teamUuid = this.currentTeamUuid();
    if (!teamUuid || !this.sessionUuid) return undefined;
    if (!this.traceUuid) this.traceUuid = crypto.randomUUID();
    return {
      sessionUuid: this.sessionUuid,
      teamUuid,
      traceUuid: this.traceUuid,
      sourceRole: "session",
      sourceKey: "nano-agent.session.do@v1",
    };
  }

  // ── Persistence ────────────────────────────────────────────

  /**
   * Narrow the DO storage surface to the `SessionStorageLike` shape the
   * helper expects. Returns null when the DO was constructed without
   * storage (e.g. the default test harness), in which case the helper
   * runs in isolate-memory-only mode.
   */
  // RH0 P0-D2 — wsHelper storage adapter delegated to seam.
  private wsHelperStorage(): SessionStorageLike | null {
    return buildWsHelperStorage(this.buildPersistenceContext());
  }

  // RH0 P0-D2 — checkpoint persist delegated to seam.
  private async persistCheckpoint(): Promise<void> {
    return persistCheckpointModule(this.buildPersistenceContext());
  }

  // RH0 P0-D2 — restore-from-storage delegated to seam.
  private async restoreFromStorage(): Promise<void> {
    return restoreFromStorageModule(this.buildPersistenceContext());
  }

  /**
   * RH0 P0-D2 — narrow PersistenceContext bridging private state to seam.
   * Mirror of buildVerifyContext: NanoSessionDO's private fields stay
   * encapsulated behind these accessors.
   */
  private buildPersistenceContext(): PersistenceContext {
    const self = this;
    return {
      get doState() {
        return self.doState;
      },
      get workspaceComposition() {
        return self.workspaceComposition;
      },
      get subsystems() {
        return self.subsystems;
      },
      get deferredAnswers() {
        return self.deferredAnswers as unknown as Map<string, DeferredAnswerEntry>;
      },
      getSessionUuid: () => self.sessionUuid,
      getCurrentTeamUuid: () => self.currentTeamUuid(),
      setSessionTeamUuid: (value: string) => {
        self.sessionTeamUuid = value;
      },
      getCurrentUserUuid: () => self.currentUserUuid(),
      setSessionUserUuid: (value: string) => {
        self.sessionUserUuid = value;
      },
      getSessionState: () => self.state,
      setRestoredState: (next) => {
        self.state = next;
      },
      getWsHelper: () => self.wsHelper,
    };
  }

  // ── WebSocket upgrade helper ───────────────────────────────

  private async handleWebSocketUpgrade(sessionId: string): Promise<Response> {
    const result = await this.wsController.handleUpgrade(sessionId);
    if (result.status !== 101) {
      const reason = result.status === 400 ? result.reason : "upgrade-failed";
      return new Response(
        JSON.stringify({ error: "Upgrade failed", reason }),
        {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Construct (or re-use) the SessionWebSocketHelper and plumb it
    // through the controller so `handleMessage` / `handleClose` have a
    // real target. The DO calls `webSocketMessage` directly in
    // production, but tests may route through the controller, so the
    // hook is always attached.
    this.ensureWsHelper();
    this.wsController.attachHooks({
      onMessage: (raw) => this.webSocketMessage(null, raw),
      onClose: () => this.webSocketClose(null),
    });
    await this.emitEdgeTrace("session.edge.attach");

    // If the runtime provides `acceptWebSocket`, use it — this is the
    // real Cloudflare DO WebSocket path. Otherwise return a synthetic
    // response so vitest can reason about the control flow.
    if (typeof this.doState.acceptWebSocket === "function") {
      try {
        const pair = new (globalThis as unknown as {
          WebSocketPair?: new () => { 0: unknown; 1: unknown };
        }).WebSocketPair!();
        const serverSocket = (pair as { 1: unknown })[1];
        this.doState.acceptWebSocket!(serverSocket);
        // A4-A5 review R2: attach the server-side socket to the
        // helper so outbound `pushEvent()` calls actually reach the
        // client instead of only populating the replay buffer.
        this.attachHelperToSocket(serverSocket);
        return new Response(null, {
          status: 101,
          statusText: "Switching Protocols",
          // @ts-expect-error Cloudflare-only webSocket init field
          webSocket: (pair as { 0: unknown })[0],
        });
      } catch {
        // Fall through to the synthetic response when WebSocketPair is
        // not available (vitest / Node).
      }
    }

    try {
      return new Response(null, { status: 101, statusText: "Switching Protocols" });
    } catch {
      return new Response(null, { status: 200, statusText: "Switching Protocols" });
    }
  }

  /**
   * A4-A5 review R2: narrow the Cloudflare-side WebSocket to the
   * structural `SessionSocketLike` the nacp-session helper expects and
   * wire it as the helper's live outbound transport. Silently bails
   * out when the runtime does not expose a `send` method — that would
   * be a test harness without a real socket pair.
   */
  private attachHelperToSocket(rawSocket: unknown): void {
    const helper = this.ensureWsHelper();
    if (!helper) return;
    const s = rawSocket as Partial<{
      send: (data: unknown) => void;
      close: (code?: number, reason?: string) => void;
    }>;
    if (typeof s.send !== "function") return;
    try {
      helper.attach({
        send: (data: string) => s.send!(data),
        close: (code?: number, reason?: string) => s.close?.(code, reason),
      });
    } catch {
      // `attach()` throws if a socket is already attached; that is a
      // legitimate state during reconnect. The resume path will take
      // over from there.
    }
  }

  // ── Accessors for testing ──────────────────────────────────

  /** Expose current orchestration state for testing. */
  getState(): OrchestrationState {
    return this.state;
  }

  /** Expose health gate for testing. */
  getHealthGate(): HealthGate {
    return this.healthGate;
  }

  /** Expose the composed subsystem handles for testing. */
  getSubsystems(): SubsystemHandles {
    return this.subsystems;
  }

  /**
   * 3rd-round R2: snapshot of the bounded in-memory default eval
   * sink. Production deployments that wire `subsystems.eval` to a
   * real `DoStorageTraceSink` (or equivalent) will see this list
   * stay empty — that is intentional. The accessor exists so
   * deploy-shaped smoke tests can observe the default-path
   * emission without poking at private state.
   *
   * **B6**: delegates to the new `BoundedEvalSink` for dedup +
   * overflow disclosure; records held remain stable across calls.
   */
  getDefaultEvalRecords(): readonly unknown[] {
    return this.defaultEvalSink.getRecords();
  }

  /**
   * B6 — overflow disclosure for the default eval sink. Satisfies
   * `binding-F04` "sink overflow MUST emit explicit disclosure; silent
   * drop is non-conformant". Returns the ring buffer of recent
   * disclosure records (most recent last).
   */
  getDefaultEvalDisclosure(): readonly EvalSinkOverflowDisclosure[] {
    return this.defaultEvalSink.getDisclosure();
  }

  /**
   * B6 — counter snapshot for the default eval sink. Primary
   * consumers: deploy smoke tests and the B7 integrated spike.
   */
  getDefaultEvalStats(): EvalSinkStats {
    return this.defaultEvalSink.getStats();
  }

  private async runPreviewVerification(
    sessionId: string,
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return runPreviewVerificationModule(this.buildVerifyContext(), sessionId, request);
  }

  /**
   * RH0 P0-D1 — return the narrow VerifyContext that `session-do-verify.ts`
   * needs. NanoSessionDO's private fields stay private; only this small
   * accessor surface escapes the class.
   */
  private buildVerifyContext(): VerifyContext {
    const self = this;
    return {
      get subsystems() {
        return self.subsystems;
      },
      get env() {
        return self.env;
      },
      get quotaAuthorizer() {
        return self.quotaAuthorizer;
      },
      buildQuotaContext: (turnUuid?: string | null) => self.buildQuotaContext(turnUuid),
      buildCrossSeamAnchor: () => self.buildCrossSeamAnchor(),
    };
  }

  private getCapabilityTransport() {
    return getCapabilityTransportModule(this.buildVerifyContext());
  }
}
