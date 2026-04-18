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
import { DEFAULT_RUNTIME_CONFIG } from "../env.js";
import type { RuntimeConfig } from "../env.js";
import { SessionOrchestrator } from "../orchestration.js";
import type { OrchestrationDeps, OrchestrationState } from "../orchestration.js";
import { assertTraceLaw, type TraceContext } from "../traces.js";
import { extractTurnInput } from "../turn-ingress.js";
import { transitionPhase as transitionPhaseImported } from "../actor-state.js";
import { validateSessionCheckpoint } from "../checkpoint.js";
import { createDefaultCompositionFactory } from "../composition.js";
import type { CompositionFactory, SubsystemHandles } from "../composition.js";
import { makeRemoteBindingsFactory } from "../remote-bindings.js";
import type { SessionRuntimeEnv } from "../env.js";

/**
 * A4-A5 review R3 / Kimi R5: pick the right factory based on env
 * bindings. If any of the three v1 service bindings is present,
 * prefer `makeRemoteBindingsFactory()` so the deployed DO actually
 * consumes the remote seam instead of silently staying all-local.
 * Tests (which build a bare `{}` env) still fall back to the
 * default local factory, preserving the existing no-op behaviour.
 */
function selectCompositionFactory(env: unknown): CompositionFactory {
  const e = (env ?? {}) as Partial<SessionRuntimeEnv>;
  const anyRemote = Boolean(
    e.CAPABILITY_WORKER || e.HOOK_WORKER || e.FAKE_PROVIDER_WORKER,
  );
  return anyRemote
    ? makeRemoteBindingsFactory()
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
} from "@nano-agent/nacp-session";

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

/** Same UUID (v1–v5) shape the checkpoint validator enforces. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    compositionFactory: CompositionFactory = selectCompositionFactory(env),
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
    }

    this.healthGate = new HealthGate(this.config);
    this.wsController = new WsController();
    this.httpController = new HttpController();

    this.heartbeatTracker = { lastHeartbeatAt: null };
    this.ackWindow = { pendingCount: 0 };

    // Build the subsystem composition from the injected factory.
    this.subsystems = compositionFactory.create(
      (env ?? {}) as unknown as import("../env.js").SessionRuntimeEnv,
      this.config,
    );

    const deps = this.buildOrchestrationDeps();
    this.orchestrator = new SessionOrchestrator(deps, this.config);
    this.state = this.orchestrator.createInitialState();
  }

  // ── fetch ──────────────────────────────────────────────────

  /**
   * Entry point for all HTTP requests to this DO.
   * Routes to WsController (upgrade) or HttpController (fallback).
   */
  async fetch(request: Request): Promise<Response> {
    const route: RouteResult = routeRequest(request);

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
        });

        // Optional JSON body from HTTP clients (start / input carry content).
        let body: unknown = undefined;
        if (
          request.method === "POST" ||
          request.method === "PUT" ||
          request.method === "PATCH"
        ) {
          try {
            body = await request.json();
          } catch {
            body = undefined;
          }
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

    const envelope = this.acceptClientFrame(raw);
    if (!envelope.ok) return;

    await this.dispatchAdmissibleFrame(envelope.messageType, envelope.body);
  }

  /**
   * Run a raw wire payload through nacp-session ingress + legality gate.
   * The DO uses this for both WS and HTTP fallback so they share one
   * truth. Returns a typed envelope; rejections are recorded so callers
   * (and tests) can introspect them without exceptions.
   */
  acceptClientFrame(raw: string | unknown): IngressEnvelope {
    const result = acceptIngress({
      raw,
      authority: this.buildIngressContext(),
      streamSeq: this.streamSeq,
      streamUuid: this.streamUuid,
      phase: this.state.actorState.phase as SessionPhase,
    });
    if (result.ok) {
      this.streamSeq += 1;
      this.lastIngressRejection = null;
    } else {
      this.lastIngressRejection = result;
    }
    return result;
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
          await this.doState.storage?.put(LAST_SEEN_SEQ_KEY, lastSeenSeq);
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
    const envTeamUuid = (this.env as { TEAM_UUID?: unknown } | undefined)
      ?.TEAM_UUID;
    const teamUuid =
      typeof envTeamUuid === "string" && envTeamUuid.length > 0
        ? envTeamUuid
        : "_unknown";
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
    const envTeamUuid = (this.env as { TEAM_UUID?: unknown } | undefined)
      ?.TEAM_UUID;
    const teamUuid =
      typeof envTeamUuid === "string" && envTeamUuid.length > 0
        ? envTeamUuid
        : null;
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
    const envTeamUuid = (this.env as { TEAM_UUID?: unknown } | undefined)
      ?.TEAM_UUID;
    const teamUuid =
      typeof envTeamUuid === "string" && envTeamUuid.length > 0
        ? envTeamUuid
        : null;
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
      }),
      emitHook: async (event, payload, context) => {
        const hooks = handles.hooks as
          | { emit?: (e: string, p: unknown, c?: unknown) => Promise<unknown> }
          | undefined;
        if (hooks?.emit) return hooks.emit(event, payload, context);
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
      traceContext: this.buildTraceContext(),
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
    const envTeamUuid = (this.env as { TEAM_UUID?: unknown } | undefined)?.TEAM_UUID;
    const teamUuid =
      typeof envTeamUuid === "string" && envTeamUuid.length > 0
        ? envTeamUuid
        : null;
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
    const storage = this.doState.storage;
    if (!storage) return null;
    return {
      get: async <T,>(k: string) => storage.get<T>(k),
      put: async <T,>(k: string, v: T) => {
        await storage.put(k, v);
      },
    };
  }

  private async persistCheckpoint(): Promise<void> {
    const storage = this.doState.storage;
    if (!storage) return;

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
    const envTeamUuid = (this.env as { TEAM_UUID?: unknown } | undefined)?.TEAM_UUID;
    const teamUuid =
      typeof envTeamUuid === "string" && envTeamUuid.length > 0 ? envTeamUuid : null;
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
    const storage = this.doState.storage;
    if (!storage) return;

    const raw = await storage.get(CHECKPOINT_STORAGE_KEY);
    if (!raw) return;
    if (!validateSessionCheckpoint(raw)) return;

    // Restore just the kernel snapshot + turnCount for now — a richer
    // subsystem restore path is the job of the concrete composition
    // factory in production builds.
    this.state = {
      actorState: this.state.actorState,
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
}
