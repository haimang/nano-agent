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
import { extractTurnInput } from "../turn-ingress.js";
import { transitionPhase as transitionPhaseImported } from "../actor-state.js";
import { validateSessionCheckpoint } from "../checkpoint.js";
import { createDefaultCompositionFactory } from "../composition.js";
import type { CompositionFactory, SubsystemHandles } from "../composition.js";

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

  constructor(
    doState: DurableObjectStateLike,
    env: unknown,
    compositionFactory: CompositionFactory = createDefaultCompositionFactory(),
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
        const result = await this.httpController.handleRequest(
          route.sessionId,
          route.action,
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
   * Message dispatch (nacp-session reality):
   *   session.start       → extractTurnInput → orchestrator.startTurn
   *   session.cancel      → orchestrator.cancelTurn
   *   session.end         → orchestrator.endSession
   *   session.resume      → read `last_seen_seq` + restoreFromStorage
   *   session.stream.ack  → ack accounting (decrement pending)
   *   session.heartbeat   → heartbeat timestamp
   */
  async webSocketMessage(
    _ws: unknown,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const text =
      typeof message === "string"
        ? message
        : new TextDecoder().decode(message);

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }

    const messageType = parsed.message_type as string | undefined;
    if (!messageType) return;

    const body = (parsed.body as Record<string, unknown> | undefined) ?? parsed;

    switch (messageType) {
      case "session.start": {
        const turnInput = extractTurnInput(messageType, body);
        if (turnInput) {
          this.state = await this.orchestrator.startTurn(this.state, turnInput);
        }
        break;
      }

      case "session.cancel": {
        this.state = await this.orchestrator.cancelTurn(this.state);
        break;
      }

      case "session.end": {
        this.state = await this.orchestrator.endSession(this.state);
        break;
      }

      case "session.resume": {
        // Use the real SessionResumeBody field — `last_seen_seq`.
        const lastSeenSeq = body["last_seen_seq"];
        if (typeof lastSeenSeq === "number" && Number.isFinite(lastSeenSeq)) {
          await this.doState.storage?.put(LAST_SEEN_SEQ_KEY, lastSeenSeq);
        }
        await this.restoreFromStorage();
        break;
      }

      case "session.stream.ack": {
        if (this.ackWindow.pendingCount > 0) {
          this.ackWindow.pendingCount -= 1;
        }
        break;
      }

      case "session.heartbeat": {
        this.heartbeatTracker.lastHeartbeatAt = new Date().toISOString();
        break;
      }

      default:
        break;
    }
  }

  // ── webSocketClose ─────────────────────────────────────────

  /**
   * Handle WebSocket close. Persists a checkpoint when DO storage is
   * available, then detaches the actor back to the `unattached` phase.
   */
  async webSocketClose(_ws: unknown): Promise<void> {
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
        const evalSink = handles.eval as
          | { emit?: (e: unknown) => Promise<void> | void }
          | undefined;
        if (evalSink?.emit) await evalSink.emit(event);
      },
      pushStreamEvent: (_kind, body) => {
        const stream = handles.kernel as
          | { pushStreamEvent?: (body: Record<string, unknown>) => void }
          | undefined;
        if (stream?.pushStreamEvent) stream.pushStreamEvent(body);
      },
    };
  }

  // ── Persistence ────────────────────────────────────────────

  private async persistCheckpoint(): Promise<void> {
    const storage = this.doState.storage;
    if (!storage) return;

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
      return new Response(JSON.stringify({ error: "Upgrade failed" }), {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // If the runtime provides `acceptWebSocket`, use it — this is the
    // real Cloudflare DO WebSocket path. Otherwise return a synthetic
    // response so vitest can reason about the control flow.
    if (typeof this.doState.acceptWebSocket === "function") {
      try {
        const pair = new (globalThis as unknown as {
          WebSocketPair?: new () => { 0: unknown; 1: unknown };
        }).WebSocketPair!();
        this.doState.acceptWebSocket!((pair as { 1: unknown })[1]);
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
