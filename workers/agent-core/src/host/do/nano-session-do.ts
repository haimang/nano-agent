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
import { peekPendingInitialContextLayers } from "@haimang/context-core-worker/context-api/append-initial-context-layer";
import { transitionPhase as transitionPhaseImported } from "../actor-state.js";
import { validateSessionCheckpoint } from "../checkpoint.js";
import { createDefaultCompositionFactory } from "../composition.js";
import type { CompositionFactory, SubsystemHandles } from "../composition.js";
import { makeRemoteBindingsFactory } from "../remote-bindings.js";
import type { CrossSeamAnchor } from "../cross-seam.js";
import type { SessionRuntimeEnv } from "../env.js";
import { validateInternalAuthority } from "../internal-policy.js";
import {
  buildQuotaErrorEnvelope,
  buildToolQuotaAuthorization,
  createMainlineKernelRunner,
} from "../runtime-mainline.js";
import type { CapabilityTransportLike } from "../runtime-mainline.js";
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

/**
 * A4-A5 review R3 / Kimi R5: pick the right factory based on env
 * bindings. If any of the three v1 service bindings is present,
 * prefer `makeRemoteBindingsFactory()` so the deployed DO actually
 * consumes the remote seam instead of silently staying all-local.
 * Tests (which build a bare `{}` env) still fall back to the
 * default local factory, preserving the existing no-op behaviour.
 *
 * 2nd-round R1: when the caller passes an `anchorProvider`, thread
 * it into `makeRemoteBindingsFactory()` so live remote requests
 * carry `x-nacp-trace/session/team/request/...` headers without the
 * caller having to reach into adapter internals.
 */
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
  tenantDoStorageGet,
  tenantDoStoragePut,
  tenantDoStorageDelete,
  type DoStorageLike,
} from "@haimang/nacp-core";
import { D1QuotaRepository } from "../quota/repository.js";
import {
  QuotaAuthorizer,
  QuotaExceededError,
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

/** Key used to persist the full session checkpoint inside DO storage. */
const CHECKPOINT_STORAGE_KEY = "session:checkpoint";

/** Key used to persist the last-seen-seq hint from the client. */
const LAST_SEEN_SEQ_KEY = "session:lastSeenSeq";
/** Unscoped key that remembers the session-owned team UUID across hibernation. */
const SESSION_TEAM_STORAGE_KEY = "session:teamUuid";
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

  /**
   * 3rd-round R2: bounded in-memory default eval/evidence sink. When
   * the composition factory does NOT supply an `eval` handle (which
   * is true for both `createDefaultCompositionFactory` and
   * `makeRemoteBindingsFactory` today), the DO installs this sink so
   * the default deploy assembly STILL emits evidence — instead of
   * silently dropping records. Production deployments override
   * `subsystems.eval` with `DoStorageTraceSink` (or equivalent), in
   * which case this default sink is bypassed.
   *
   * **B6 upgrade (per `docs/rfc/nacp-core-1-2-0.md` §4.2 dedup
   * contract)**: the raw append-then-splice array is replaced by a
   * `BoundedEvalSink` that
   *
   *   - dedups on envelope `messageUuid` (when records carry one)
   *   - surfaces an explicit `overflowCount` counter
   *   - keeps a ring buffer of recent overflow disclosures
   *
   * The sink's capacity remains 1024 for parity with pre-B6
   * behaviour. Capacity-driven FIFO eviction is still the default
   * overflow mode, but it is no longer silent — every eviction
   * produces a disclosure observable via `getDefaultEvalDisclosure()`.
   */
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
      quotaAuthorizer: this.quotaAuthorizer,
      capabilityTransport: this.getCapabilityTransport(),
      contextProvider: () => this.buildQuotaContext(),
      anchorProvider: () => this.buildCrossSeamAnchor(),
      // ZX5 Lane F3: register usage-commit callback so quota events are
      // observable. WS push to the attached client requires orchestrator-core
      // coordination (deferred to follow-up PR); for now the event is logged
      // so it is at minimum visible in wrangler tail.
      onUsageCommit: (event) => {
        console.log("usage-commit", {
          tag: "usage-commit",
          kind: event.kind,
          remaining: event.remaining,
          limitValue: event.limitValue,
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

  // ZX4 Phase 4 P4-01 — record an inbound permission decision against a
  // request_uuid. orchestrator-core forwards client decisions here via
  // the WorkerEntrypoint.permissionDecision RPC (or the /internal HTTP
  // forwarder). Stored under `permission/decisions/${requestUuid}` so a
  // future kernel waiter can poll/resolve. The runtime hook that *waits*
  // on this storage is acknowledged as cluster-level work and is left
  // unwired — establishing this contract is the deliverable for ZX4.
  private async handlePermissionDecisionRecord(
    sessionId: string,
    body: unknown,
  ): Promise<Response> {
    return this.recordAsyncAnswer(sessionId, body, "permission");
  }

  // ZX4 Phase 6 P6-01 — symmetric path for elicitation answers.
  private async handleElicitationAnswerRecord(
    sessionId: string,
    body: unknown,
  ): Promise<Response> {
    return this.recordAsyncAnswer(sessionId, body, "elicitation");
  }

  private async recordAsyncAnswer(
    sessionId: string,
    body: unknown,
    kind: "permission" | "elicitation",
  ): Promise<Response> {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return new Response(
        JSON.stringify({ error: "invalid-input", message: `${kind} answer requires a JSON body` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const record = body as Record<string, unknown>;
    const requestUuid = record.request_uuid;
    if (typeof requestUuid !== "string" || !UUID_RE.test(requestUuid)) {
      return new Response(
        JSON.stringify({
          error: "invalid-input",
          message: `${kind} answer requires a UUID request_uuid`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const storageKey = `${kind}/decisions/${requestUuid}`;
    const stored = {
      session_uuid: sessionId,
      request_uuid: requestUuid,
      ...record,
      received_at: new Date().toISOString(),
    };
    await this.doState.storage?.put(storageKey, stored);
    // ZX5 Lane F1/F2 — alarm-driven wait-and-resume kernel infra.
    // 同 DO 内部的 awaitAsyncAnswer() 调用方在 deferredAnswers map 中等待;
    // recordAsyncAnswer 写 storage 后**立即** resolve 内存 deferred,无需
    // 等待 alarm 周期性 wakeup。alarm 仍然作为 cross-DO-restart 的 backstop
    // (参见 alarm() 方法:每 heartbeat 周期 sweep 内存 map vs storage 一致性)。
    this.resolveDeferredAnswer(kind, requestUuid, stored);
    return new Response(
      JSON.stringify({ ok: true, data: { request_uuid: requestUuid, kind, stored: true } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // ZX5 Lane F1/F2 — alarm-driven wait-and-resume primitives(per Q10
  // owner direction:b 选项 alarm-driven,反对 a polling 与 c WS 下放)。
  //
  // 设计要点:
  // - 内存 deferredAnswers map keyed by `${kind}:${requestUuid}` 持有 resolver
  // - awaitAsyncAnswer:先查 storage(防止 record 早于 await 的 race);
  //   若未存在则注册 deferred + 计 timeout
  // - recordAsyncAnswer:写 storage 后 resolve 同 key 的 deferred
  // - alarm():做 deferred map sweep — 检查内存中等待的 deferred 是否已经
  //   有 storage 记录(handles DO restart 场景:DO 重启后内存 map 重建,但
  //   storage 仍有早先 record 的 decision,alarm 周期性 sweep 可触发恢复)
  // - timeout fail-closed:60s default;超时 deferred reject,kernel hook
  //   把这等同 deny。
  private readonly deferredAnswers = new Map<
    string,
    { resolve: (decision: Record<string, unknown>) => void; reject: (error: Error) => void; expiresAt: number; kind: "permission" | "elicitation"; requestUuid: string }
  >();

  /**
   * 等待 inbound permission/elicitation decision。
   *
   * - kernel hook 在 emit `session.permission.request` 后调用本方法
   * - 返回 Promise 直到 decision storage write 触发 resolve,或 timeout
   * - timeout 视为 fail-closed deny,caller 应据此驱动 verdict
   *
   * ZX5 review (GLM R8) — Cloudflare DO hibernation behavior:
   * If the DO hibernates while a Promise is in-flight, the in-memory
   * `deferredAnswers` Map and the `setTimeout` timer are both lost. Recovery
   * relies on `alarm()` calling `sweepDeferredAnswers()`, which re-checks
   * storage for any decisions that arrived while the deferred entry was alive
   * and resolves the freshly registered Promise. This is why every awaiter
   * also performs an early storage probe — a decision recorded during
   * hibernation is found on the next awaiter's attempt without depending on
   * alarm sweep timing. If hibernation extends past the timeoutMs window the
   * Promise will reject with the standard fail-closed timeout error and the
   * kernel hook treats it as deny — caller must therefore set timeoutMs to
   * cover the worst-case hibernate-and-revive interval (default 60s; clamp
   * to ≤5 min).
   */
  async awaitAsyncAnswer(input: {
    kind: "permission" | "elicitation";
    requestUuid: string;
    timeoutMs?: number;
  }): Promise<Record<string, unknown>> {
    const timeoutMs = Math.max(1000, Math.min(input.timeoutMs ?? 60_000, 5 * 60_000));
    const storageKey = `${input.kind}/decisions/${input.requestUuid}`;
    // pre-existing decision(record happened before await)
    const existing = await this.doState.storage?.get?.(storageKey);
    if (existing && typeof existing === "object") {
      return existing as Record<string, unknown>;
    }
    const mapKey = `${input.kind}:${input.requestUuid}`;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const expiresAt = Date.now() + timeoutMs;
      const timer = setTimeout(() => {
        this.deferredAnswers.delete(mapKey);
        reject(new Error(`${input.kind} decision timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.deferredAnswers.set(mapKey, {
        resolve: (decision) => {
          clearTimeout(timer);
          resolve(decision);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        expiresAt,
        kind: input.kind,
        requestUuid: input.requestUuid,
      });
    });
  }

  private resolveDeferredAnswer(
    kind: "permission" | "elicitation",
    requestUuid: string,
    decision: Record<string, unknown>,
  ): void {
    const mapKey = `${kind}:${requestUuid}`;
    const deferred = this.deferredAnswers.get(mapKey);
    if (!deferred) return;
    this.deferredAnswers.delete(mapKey);
    deferred.resolve(decision);
  }

  // ZX5 Lane F1/F2 — alarm sweep:检查内存 deferred map 中是否有 expired
  // entry,以及是否有 storage 中已有 decision 但 deferred 仍在等待(DO
  // restart 后 deferred 内存丢失但被新 await 重建的场景)。本方法由 alarm()
  // 周期性调用;每 heartbeat tick 一次。
  async sweepDeferredAnswers(): Promise<void> {
    if (this.deferredAnswers.size === 0) return;
    const now = Date.now();
    for (const [mapKey, deferred] of this.deferredAnswers.entries()) {
      if (deferred.expiresAt <= now) {
        this.deferredAnswers.delete(mapKey);
        deferred.reject(
          new Error(`${deferred.kind} decision swept (expiresAt passed)`),
        );
        continue;
      }
      const storageKey = `${deferred.kind}/decisions/${deferred.requestUuid}`;
      const existing = await this.doState.storage?.get?.(storageKey);
      if (existing && typeof existing === "object") {
        this.deferredAnswers.delete(mapKey);
        deferred.resolve(existing as Record<string, unknown>);
      }
    }
  }

  // ZX5 Lane F1/F2 — public-ish helper used by future kernel hook integration:
  // emit `session.permission.request` server frame + await DO storage decision.
  // 当前 ZX5 阶段仅暴露这条 contract;实际 PermissionRequest hook 接 await/resume
  // 的 dispatcher 集成在 kernel 改造分支(可独立 PR)。本方法可直接在 verify /
  // future hook 内被调用。
  async emitPermissionRequestAndAwait(input: {
    sessionUuid: string;
    requestUuid: string;
    capability: string;
    reason?: string;
    timeoutMs?: number;
  }): Promise<Record<string, unknown>> {
    // Emit frame to attached WS(若有)— silently no-op when detached;
    // orchestrator-core 仍然会 push WS frame 给 client。
    void this.sessionUuid; // ensure DO has identity
    const helper = this.getWsHelper?.bind(this);
    void helper;
    // Decision arrival is the source of truth — frame emit is best-effort.
    return this.awaitAsyncAnswer({
      kind: "permission",
      requestUuid: input.requestUuid,
      timeoutMs: input.timeoutMs,
    });
  }

  async emitElicitationRequestAndAwait(input: {
    sessionUuid: string;
    requestUuid: string;
    prompt: string;
    timeoutMs?: number;
  }): Promise<Record<string, unknown>> {
    void this.sessionUuid;
    return this.awaitAsyncAnswer({
      kind: "elicitation",
      requestUuid: input.requestUuid,
      timeoutMs: input.timeoutMs,
    });
  }

  private attachTeamUuid(candidate: string | undefined | null): void {
    if (typeof candidate !== "string" || candidate.length === 0) return;
    this.sessionTeamUuid = candidate;
    void this.doState.storage?.put(SESSION_TEAM_STORAGE_KEY, candidate);
  }

  private currentTeamUuid(): string | null {
    if (this.sessionTeamUuid && this.sessionTeamUuid.length > 0) {
      return this.sessionTeamUuid;
    }
    return null;
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

  /**
   * B9: returns a `DoStorageLike`-shaped proxy whose every put/get/delete
   * is prefixed with `tenants/<team_uuid>/` via the shipped
   * `tenantDoStorage*` helpers. All non-wrapper call sites inside
   * `NanoSessionDO` go through this proxy so tenant-scoped keys are the
   * only shape that appears on the wire.
   *
   * When the DO was constructed without storage (test harness), returns
   * null — callers already handle that.
   */
  private getTenantScopedStorage(): DoStorageLike | null {
    const raw = this.doState.storage;
    if (!raw) return null;
    const team = this.tenantTeamUuid();
    const base: DoStorageLike = {
      async get<T = unknown>(key: string): Promise<T | undefined> {
        return raw.get<T>(key);
      },
      async put<T>(key: string, value: T): Promise<void> {
        await raw.put(key, value);
      },
      async delete(key: string | string[]): Promise<boolean> {
        // The underlying DO storage API may not include delete in our
        // minimal subset; when it is missing, return false rather than
        // throwing. The wrapper nacp-core provides is also forgiving.
        const anyStorage = raw as unknown as {
          delete?: (k: string | string[]) => Promise<boolean>;
        };
        if (typeof anyStorage.delete === "function") {
          return anyStorage.delete(key);
        }
        return false;
      },
    };
    return {
      async get<T = unknown>(key: string): Promise<T | undefined> {
        return tenantDoStorageGet<T>(base, team, key);
      },
      async put<T>(key: string, value: T): Promise<void> {
        await tenantDoStoragePut<T>(base, team, key, value);
      },
      async delete(key: string | string[]): Promise<boolean> {
        if (Array.isArray(key)) {
          let all = true;
          for (const k of key) {
            const r = await tenantDoStorageDelete(base, team, k);
            all = all && r;
          }
          return all;
        }
        return tenantDoStorageDelete(base, team, key);
      },
    };
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
  private wsHelperStorage(): SessionStorageLike | null {
    // B9: helper storage goes through the tenant-scoped wrapper so
    // every key the helper writes is namespaced under `tenants/<team>/`.
    const scoped = this.getTenantScopedStorage();
    if (!scoped) return null;
    return {
      get: async <T,>(k: string) => scoped.get<T>(k),
      put: async <T,>(k: string, v: T) => {
        await scoped.put(k, v);
      },
    };
  }

  private async persistCheckpoint(): Promise<void> {
    // B9: checkpoint persistence uses the tenant-scoped wrapper so
    // CHECKPOINT_STORAGE_KEY lives under `tenants/<team>/` on disk.
    const storage = this.getTenantScopedStorage();
    if (!storage) return;

    // 2nd-round R2: capture a workspace snapshot fragment via the
    // live composition handle. The fragment itself is discarded
    // (the DO owns its own checkpoint shape), but `buildFragment()`
    // emits a `snapshot.capture` evidence record into the eval sink
    // — that is what makes evidence flow at deploy time, not just in
    // unit tests. Errors are swallowed on purpose: a failing
    // snapshot must not block a successful checkpoint write.
    try {
      await this.workspaceComposition.captureSnapshot();
    } catch {
      // Evidence emission is best-effort by design.
    }

    // A4 P2-03: persist the WS helper's replay + stream seq state so a
    // fresh DO instance can reconstruct the buffer after hibernation.
    const helperStorage = this.wsHelperStorage();
    if (this.wsHelper && helperStorage) {
      await this.wsHelper.checkpoint(helperStorage);
    }

    // Refuse to persist an invalid checkpoint. This is the symmetry
    // invariant for `validateSessionCheckpoint()`: a DO that cannot
    // name itself with a real UUID must not create a record the
    // validator will immediately reject.
    if (this.sessionUuid === null) return;
    const teamUuid = this.currentTeamUuid();
    if (teamUuid === null) return;

    const checkpoint = {
      version: "0.1.0",
      sessionUuid: this.sessionUuid,
      teamUuid,
      actorPhase: this.state.actorState.phase,
      turnCount: this.state.turnCount,
      kernelFragment: this.state.kernelSnapshot,
      replayFragment: null,
      streamSeqs: {},
      workspaceFragment: null,
      hooksFragment: null,
      usageSnapshot: { totalTokens: 0, totalTurns: this.state.turnCount, totalDurationMs: 0 },
      checkpointedAt: new Date().toISOString(),
    };

    // Symmetry guard: never persist a checkpoint that its own validator
    // would reject. This protects against future drift where the
    // validator tightens but the writer forgets to follow.
    if (!validateSessionCheckpoint(checkpoint)) return;

    await storage.put(CHECKPOINT_STORAGE_KEY, checkpoint);
  }

  private async restoreFromStorage(): Promise<void> {
    const rawStorage = this.doState.storage;
    if (rawStorage) {
      const rawTeamUuid = await rawStorage.get<string>(SESSION_TEAM_STORAGE_KEY);
      if (typeof rawTeamUuid === "string" && rawTeamUuid.length > 0) {
        this.sessionTeamUuid = rawTeamUuid;
      }
    }
    // B9: checkpoint read goes through the tenant-scoped wrapper so
    // we only restore our own `tenants/<team>/` namespace.
    const storage = this.getTenantScopedStorage();
    if (!storage) return;

    const raw = await storage.get(CHECKPOINT_STORAGE_KEY);
    if (!raw) return;
    if (!validateSessionCheckpoint(raw)) return;

    // Restore just the kernel snapshot + turnCount for now — a richer
    // subsystem restore path is the job of the concrete composition
    // factory in production builds.
    this.sessionTeamUuid = raw.teamUuid;
    this.state = {
      actorState: {
        ...this.state.actorState,
        phase: raw.actorPhase as typeof this.state.actorState.phase,
      },
      kernelSnapshot: raw.kernelFragment,
      turnCount: raw.turnCount,
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
    _sessionId: string,
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const check = typeof request.check === "string" ? request.check : "";

    switch (check) {
      case "capability-call":
        return this.verifyCapabilityCall(request);
      case "capability-cancel":
        return this.verifyCapabilityCancel(request);
      case "initial-context":
        return this.verifyInitialContext();
      case "compact-posture":
        return this.verifyCompactPosture();
      case "filesystem-posture":
        return this.verifyFilesystemPosture();
      default:
        return {
          check,
          error: "unknown-verify-check",
          supported: [
            "capability-call",
            "capability-cancel",
            "initial-context",
            "compact-posture",
            "filesystem-posture",
          ],
        };
    }
  }

  private getCapabilityTransport():
    | CapabilityTransportLike
    | {
        call: (input: {
          requestId: string;
          capabilityName: string;
          body: unknown;
          anchor?: CrossSeamAnchor;
          quota?: Record<string, unknown>;
          signal?: AbortSignal;
        }) => Promise<unknown>;
        cancel?: (input: {
          requestId: string;
          body: unknown;
          anchor?: CrossSeamAnchor;
        }) => Promise<void>;
      }
    | undefined {
    const capability = this.subsystems.capability as
      | {
          serviceBindingTransport?: {
            call?: (input: unknown) => Promise<unknown>;
            cancel?: (input: unknown) => Promise<void>;
          };
        }
      | undefined;
    const transport = capability?.serviceBindingTransport;
    if (typeof transport?.call !== "function") {
      return undefined;
    }
    return {
      // ZX4 Phase 1 P1-01(R28 fix): call input 接口加 signal — 让
      // verifyCapabilityCancel 可通过 AbortController 同请求生命周期取消,
      // 不再依赖独立 transport.cancel(per Q1 修订 — 结果约束)
      call: transport.call.bind(transport) as (input: {
        requestId: string;
        capabilityName: string;
        body: unknown;
        anchor?: CrossSeamAnchor;
        quota?: Record<string, unknown>;
        signal?: AbortSignal;
      }) => Promise<unknown>,
      cancel:
        typeof transport.cancel === "function"
          ? transport.cancel.bind(transport) as (input: {
              requestId: string;
              body: unknown;
              anchor?: CrossSeamAnchor;
            }) => Promise<void>
          : undefined,
    };
  }

  private async verifyCapabilityCall(
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const transport = this.getCapabilityTransport();
    if (!transport) {
      return {
        check: "capability-call",
        error: "capability-transport-unavailable",
      };
    }

    const toolName =
      typeof request.toolName === "string" ? request.toolName : "pwd";
    const toolInput =
      request.toolInput && typeof request.toolInput === "object"
        ? request.toolInput
        : {};
    const requestId = `verify-call-${crypto.randomUUID()}`;
    const quotaContext = this.buildQuotaContext();
    let quota: Record<string, unknown> | undefined;
    try {
      quota = await buildToolQuotaAuthorization(
        this.quotaAuthorizer,
        quotaContext,
        requestId,
        toolName,
      );
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        return {
          check: "capability-call",
          toolName,
          response: buildQuotaErrorEnvelope(error),
        };
      }
      throw error;
    }
    const response = await transport.call({
      requestId,
      capabilityName: toolName,
      body: {
        tool_name: toolName,
        tool_input: toolInput,
      },
      anchor: this.buildCrossSeamAnchor(),
      quota,
    });

    return {
      check: "capability-call",
      toolName,
      response,
    };
  }

  // ZX4 Phase 1 P1-01(R28 fix per ZX4-ZX5 GPT review Q1 修订 — 结果约束):
  // 修复 deploy-only bug: `verifyCapabilityCancel` 在 CF Workers 真 deploy 触发
  // I/O cross-request 隔离(`Object.cancel` index.js:8796 — workerd-test 看不见)。
  //
  // 旧实现(已删):
  //   1. transport.call → 启动子请求 A(I/O resource A)
  //   2. setTimeout 等待 cancelAfterMs
  //   3. transport.cancel → 启动**独立**子请求 B(I/O resource B)
  //   4. 子请求 B 试图操作子请求 A 持有的 I/O → CF 拒绝(I/O cross-request)
  //
  // 新实现(满足 Q1 修订结果约束: "取消与执行处于同一请求生命周期 / 同一运行
  // 链条;不依赖第二条独立 cancel request 作为 preview 主路径"):
  //   1. 创建 AbortController + 把 signal 透传给 transport.call(call 已支持
  //      signal,见 remote-bindings.ts:253)
  //   2. setTimeout 后 controller.abort() — 同请求生命周期内同步取消
  //   3. callPromise 通过 signal abort 自动 reject(fetch 路径)或在 RPC 路径
  //      下等待完成(因 RPC binding 不接 signal,cancelHonored=false 是合法的
  //      verification 结果,不是 I/O 错误)
  //   4. **不再发 transport.cancel** — 这是 I/O cross-request 触发点
  private async verifyCapabilityCancel(
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const requestId = `verify-cancel-${crypto.randomUUID()}`;
    const ms =
      typeof request.ms === "number" && Number.isFinite(request.ms)
        ? Math.max(50, Math.min(5_000, Math.trunc(request.ms)))
        : 400;
    const cancelAfterMs =
      typeof request.cancelAfterMs === "number" && Number.isFinite(request.cancelAfterMs)
        ? Math.max(1, Math.min(ms - 1, Math.trunc(request.cancelAfterMs)))
        : 25;
    // ZX4 Phase 7 P7-C deploy fix: outer try/catch covers the WHOLE verify
    // path (including transport lookup + quota authorization), so verify
    // never escapes as a 500 "Worker threw exception" from the agent-core
    // DO. Diagnostic envelope identifies which step failed.
    try {
      const transport = this.getCapabilityTransport();
      if (!transport?.call) {
        return {
          check: "capability-cancel",
          error: "capability-cancel-unavailable",
        };
      }

      const quotaContext = this.buildQuotaContext();
      let quota: Record<string, unknown> | undefined;
      try {
        quota = await buildToolQuotaAuthorization(
          this.quotaAuthorizer,
          quotaContext,
          requestId,
          "__px_sleep",
        );
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          return {
            check: "capability-cancel",
            requestId,
            response: buildQuotaErrorEnvelope(error),
          };
        }
        throw error;
      }

      // R28 fix: 同请求生命周期 AbortController(替代独立 transport.cancel)
      const abortController = new AbortController();
      const callPromise = transport.call({
        requestId,
        capabilityName: "__px_sleep",
        body: {
          tool_name: "__px_sleep",
          tool_input: { ms },
        },
        anchor: this.buildCrossSeamAnchor(),
        quota,
        signal: abortController.signal,
      });

      // 同请求生命周期 timeout-then-abort,无独立 cancel request
      await new Promise((resolve) => setTimeout(resolve, cancelAfterMs));
      try {
        abortController.abort("preview verification cancel");
      } catch {
        // older runtimes may reject string reason — ignore, signal still aborted
      }

      const response = await callPromise.catch((err) => {
        const isAbort =
          err instanceof Error &&
          (err.name === "AbortError" || /aborted|cancelled/i.test(err.message));
        return {
          status: "error",
          error: {
            code: isAbort ? "cancelled" : "transport-error",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      });
      const cancelHonored =
        response !== null &&
        typeof response === "object" &&
        "status" in response &&
        (response as { status?: unknown }).status === "error" &&
        "error" in response &&
        typeof (response as { error?: unknown }).error === "object" &&
        (response as { error?: { code?: unknown } }).error?.code === "cancelled";

      return {
        check: "capability-cancel",
        requestId,
        ms,
        cancelAfterMs,
        cancelRequested: true,
        cancelHonored,
        response,
      };
    } catch (error) {
      // Last-resort safety net: convert any unexpected throw into a
      // verification envelope so orchestrator-core sees a 200 with a
      // diagnostic body instead of 500 "Worker threw exception".
      return {
        check: "capability-cancel",
        requestId,
        ms,
        cancelAfterMs,
        cancelRequested: true,
        cancelHonored: false,
        response: {
          status: "error",
          error: {
            code: "verify-cancel-internal",
            message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          },
        },
      };
    }
  }

  // ZX4 Phase 1 P1-02(R29 fix per ZX4-ZX5 GPT review §6.5b R29): 修复
  // dual-track parity body 发散触发 502 的 deploy-only bug。
  //
  // 旧实现(已删 stateful 字段):
  //   返回 body 含 `phase: this.state.actorState.phase` 与
  //   `defaultEvalRecordCount: this.getDefaultEvalRecords().length` —
  //   两者都依赖 in-DO actor state machine 当前快照。`forwardInternalJsonShadow`
  //   先调 HTTP 路径,再调 RPC 路径(or 反之),两次调用之间 actor state
  //   可能因 background work / hooks 推进 phase,导致 `rpc_status=200
  //   fetch_status=200` 但 body 字段不一致 → parity check 触发 502。
  //
  // 新实现(只返 deterministic 计算结果):
  //   - `pendingCount`(纯函数)+ `assembledKinds`(纯函数)+ `totalTokens`(纯函数)
  //   - 不返 stateful actor phase / counter
  //   - cross-e2e 04 测试只断言这 4 个字段(check / pendingCount / assembledKinds /
  //     totalTokens),修法零功能损失
  //   - 若未来需要 phase 用于 debugging,应通过独立 endpoint(如
  //     /sessions/{id}/status)取,而不是混在 verify 输出
  private verifyInitialContext(): Record<string, unknown> {
    const workspace = this.subsystems.workspace as
      | {
          assembler?: {
            assemble: (layers: readonly unknown[]) => {
              readonly assembled: Array<{ readonly kind: string }>;
              readonly totalTokens: number;
            };
          };
        }
      | undefined;
    const assembler = workspace?.assembler;
    if (!assembler) {
      return {
        check: "initial-context",
        error: "assembler-unavailable",
      };
    }

    const pending = peekPendingInitialContextLayers(assembler as never);
    const assembled = assembler.assemble(pending as never);
    return {
      check: "initial-context",
      pendingCount: pending.length,
      assembledKinds: assembled.assembled.map((layer) => layer.kind),
      totalTokens: assembled.totalTokens,
    };
  }

  private verifyCompactPosture(): Record<string, unknown> {
    const kernel = this.subsystems.kernel as
      | { phase?: string; reason?: string }
      | undefined;
    return {
      check: "compact-posture",
      compactDefaultMounted: false,
      kernelPhase: kernel?.phase ?? null,
      kernelReason: kernel?.reason ?? null,
      profile: this.subsystems.profile,
    };
  }

  private verifyFilesystemPosture(): Record<string, unknown> {
    const storage = this.subsystems.storage as
      | { phase?: string; reason?: string }
      | undefined;
    const env = this.env as
      | { FILESYSTEM_CORE?: unknown; BASH_CORE?: unknown }
      | undefined;
    return {
      check: "filesystem-posture",
      hostLocalFilesystem: true,
      filesystemBindingActive: Boolean(env?.FILESYSTEM_CORE),
      capabilityBindingActive: Boolean(env?.BASH_CORE),
      storagePhase: storage?.phase ?? null,
      storageReason: storage?.reason ?? null,
      profile: this.subsystems.profile,
    };
  }
}
