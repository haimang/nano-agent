/**
 * Session DO Runtime — NanoSessionDO implementation.
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

import { WsController } from "../ws-controller.js";
import { HttpController } from "../http-controller.js";
import { HealthGate } from "../health.js";
import type { HeartbeatTracker, AckWindow } from "../health.js";
import { DEFAULT_RUNTIME_CONFIG } from "../env.js";
import type { RuntimeConfig } from "../env.js";
import type { OrchestrationState } from "../orchestration.js";
import { assertTraceLaw, type TraceContext } from "../traces.js";
import type { CompositionFactory, SubsystemHandles } from "../composition.js";
import type { CrossSeamAnchor } from "../cross-seam.js";
import type { SessionRuntimeEnv } from "../env.js";
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
import type { WorkspaceCompositionHandle } from "../workspace-runtime.js";
import {
  BoundedEvalSink,
  type EvalSinkOverflowDisclosure,
  type EvalSinkStats,
} from "../eval-sink.js";
import type { EvidenceAnchorLike } from "@nano-agent/workspace-context-artifacts";
import {
  SessionWebSocketHelper,
  type IngressContext,
  type SessionContext,
  type SessionStorageLike,
} from "@haimang/nacp-session";
import type { DoStorageLike } from "@haimang/nacp-core";
import { QuotaAuthorizer, type QuotaRuntimeContext } from "../quota/authorizer.js";
import {
  createSessionDoFetchRuntime,
} from "./session-do/fetch-runtime.js";
import {
  createSessionDoRuntimeAssembly,
} from "./session-do/runtime-assembly.js";
import {
  createSessionDoWsRuntime,
} from "./session-do/ws-runtime.js";

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

/** Same UUID (v1–v5) shape the checkpoint validator enforces. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ═══════════════════════════════════════════════════════════════════
// §2 — NanoSessionDO
// ═══════════════════════════════════════════════════════════════════

export class NanoSessionDO {
  private state: OrchestrationState;
  private readonly healthGate: HealthGate;
  private readonly wsController: WsController;
  private readonly httpController: HttpController;
  private readonly config: RuntimeConfig;
  private readonly subsystems: SubsystemHandles;
  private readonly workspaceComposition: WorkspaceCompositionHandle;
  private readonly quotaAuthorizer: QuotaAuthorizer | null;
  private readonly defaultEvalSink: BoundedEvalSink;
  private readonly fetchRuntime: ReturnType<typeof createSessionDoFetchRuntime>;
  private readonly wsRuntime: ReturnType<typeof createSessionDoWsRuntime>;

  // 3rd-round R2 + B6 dedup: bounded in-memory default eval/evidence sink
  // (capacity 1024). Production deployments override `subsystems.eval`
  // with `DoStorageTraceSink`; default sink is bypassed there.
  private static readonly DEFAULT_SINK_MAX = 1024;

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
  private lastIngressRejection: import("../session-edge.js").IngressEnvelope | null = null;

  /** Lazily-created session trace UUID for this DO actor. */
  private traceUuid: string | null = null;

  /**
   * Optional SessionWebSocketHelper for replay/ack/heartbeat/checkpoint.
   * Constructed on first WS attach; shared across subsequent reconnects
   * so the replay buffer + pending acks survive detach.
   */
  private wsHelper: SessionWebSocketHelper | null = null;

  // ZX5 Lane F1/F2 — alarm-driven wait-and-resume primitives.
  private readonly deferredAnswers = new Map<
    string,
    {
      resolve: (decision: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      expiresAt: number;
      kind: "permission" | "elicitation";
      requestUuid: string;
    }
  >();

  constructor(
    doState: DurableObjectStateLike,
    env: unknown,
    compositionFactory?: CompositionFactory,
  ) {
    this.doState = doState;
    this.env = env;
    this.config = DEFAULT_RUNTIME_CONFIG;

    const envSessionUuid = (env as { SESSION_UUID?: unknown } | undefined)?.SESSION_UUID;
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

    const assembly = createSessionDoRuntimeAssembly({
      env,
      config: this.config,
      compositionFactory,
      streamUuid: this.streamUuid,
      buildCrossSeamAnchor: () => this.buildCrossSeamAnchor(),
      buildEvidenceAnchor: () => this.buildEvidenceAnchor(),
      buildQuotaContext: (turnUuid?: string | null) => this.buildQuotaContext(turnUuid),
      getCapabilityTransport: () => this.getCapabilityTransport(),
      pushServerFrameToClient: (frame) => this.pushServerFrameToClient(frame),
      ensureWsHelper: () => this.ensureWsHelper(),
      buildTraceContext: () => this.buildTraceContext(),
      currentTeamUuid: () => this.currentTeamUuid(),
      getSessionUuid: () => this.sessionUuid,
    });
    this.subsystems = assembly.subsystems;
    this.workspaceComposition = assembly.workspaceComposition;
    this.defaultEvalSink = assembly.defaultEvalSink;
    this.quotaAuthorizer = assembly.quotaAuthorizer;
    this.state = assembly.state;

    this.wsRuntime = createSessionDoWsRuntime({
      config: this.config,
      doState: this.doState,
      wsController: this.wsController,
      subsystems: this.subsystems,
      orchestrator: assembly.orchestrator,
      streamUuid: this.streamUuid,
      getState: () => this.state,
      setState: (next) => {
        this.state = next;
      },
      getStreamSeq: () => this.streamSeq,
      setStreamSeq: (next) => {
        this.streamSeq = next;
      },
      buildIngressContext: () => this.buildIngressContext(),
      tenantTeamUuid: () => this.tenantTeamUuid(),
      setLastIngressRejection: (next) => {
        this.lastIngressRejection = next;
      },
      attachTeamUuid: (candidate) => this.attachTeamUuid(candidate),
      getTenantScopedStorage: () => this.getTenantScopedStorage(),
      wsHelperStorage: () => this.wsHelperStorage(),
      ensureWsHelper: () => this.ensureWsHelper(),
      emitEdgeTrace: (eventKind, extra, layer) =>
        this.emitEdgeTrace(eventKind, extra, layer),
      restoreFromStorage: () => this.restoreFromStorage(),
      persistCheckpoint: () => this.persistCheckpoint(),
      recordHeartbeat: (timestamp) => {
        this.heartbeatTracker.lastHeartbeatAt = timestamp;
      },
      decrementAckPending: () => {
        if (this.ackWindow.pendingCount > 0) {
          this.ackWindow.pendingCount -= 1;
        }
      },
      attachHelperToSocket: (rawSocket) => this.attachHelperToSocket(rawSocket),
    });

    this.fetchRuntime = createSessionDoFetchRuntime({
      env: this.env,
      config: this.config,
      httpController: this.httpController,
      streamUuid: this.streamUuid,
      getState: () => this.state,
      getWsHelper: () => this.getWsHelper(),
      getTraceUuid: () => this.traceUuid,
      setTraceUuid: (value) => {
        this.traceUuid = value;
      },
      attachTeamUuid: (candidate) => this.attachTeamUuid(candidate),
      attachUserUuid: (candidate) => this.attachUserUuid(candidate),
      attachSessionUuid: (candidate) => this.attachSessionUuid(candidate),
      handleWebSocketUpgrade: (sessionId) => this.handleWebSocketUpgrade(sessionId),
      webSocketMessage: (ws, raw) => this.webSocketMessage(ws, raw),
      runPreviewVerification: (sessionId, request) =>
        this.runPreviewVerification(sessionId, request),
      handlePermissionDecisionRecord: (sessionId, body) =>
        this.handlePermissionDecisionRecord(sessionId, body),
      handleElicitationAnswerRecord: (sessionId, body) =>
        this.handleElicitationAnswerRecord(sessionId, body),
    });
  }

  /**
   * 2nd-round R2: build the live `EvidenceAnchor` shape that the
   * workspace evidence emitters expect.
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
   * current DO state.
   */
  private buildCrossSeamAnchor(): CrossSeamAnchor | undefined {
    const teamUuid = this.currentTeamUuid();
    if (!teamUuid || !this.sessionUuid) return undefined;
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
      turnUuid: turnUuid ?? null,
    };
  }

  // ── fetch ──────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    return this.fetchRuntime.fetch(request);
  }

  /**
   * Attach a sessionUuid to this DO instance. The first valid UUID-shaped
   * call wins.
   */
  attachSessionUuid(candidate: string | undefined | null): void {
    if (this.sessionUuid !== null) return;
    if (!candidate || !UUID_RE.test(candidate)) return;
    this.sessionUuid = candidate;
  }

  private async handlePermissionDecisionRecord(
    sessionId: string,
    body: unknown,
  ): Promise<Response> {
    return recordAsyncAnswerModule(this.buildPersistenceContext(), sessionId, body, "permission");
  }

  private async handleElicitationAnswerRecord(
    sessionId: string,
    body: unknown,
  ): Promise<Response> {
    return recordAsyncAnswerModule(this.buildPersistenceContext(), sessionId, body, "elicitation");
  }

  async awaitAsyncAnswer(input: {
    kind: "permission" | "elicitation";
    requestUuid: string;
    timeoutMs?: number;
  }): Promise<Record<string, unknown>> {
    return awaitAsyncAnswerModule(this.buildPersistenceContext(), input);
  }

  async sweepDeferredAnswers(): Promise<void> {
    return sweepDeferredAnswersModule(this.buildPersistenceContext());
  }

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

  // ── WebSocket ingress ──────────────────────────────────────

  async webSocketMessage(
    ws: unknown,
    message: string | ArrayBuffer,
  ): Promise<void> {
    return this.wsRuntime.webSocketMessage(ws, message);
  }

  async acceptClientFrame(
    raw: string | unknown,
  ): Promise<import("../session-edge.js").IngressEnvelope> {
    return this.wsRuntime.acceptClientFrame(raw);
  }

  private tenantTeamUuid(): string {
    const teamUuid = this.currentTeamUuid();
    return typeof teamUuid === "string" && teamUuid.length > 0
      ? teamUuid
      : "_unknown";
  }

  private getTenantScopedStorage(): DoStorageLike | null {
    return getTenantScopedStorageModule(this.buildPersistenceContext());
  }

  async dispatchAdmissibleFrame(
    messageType: string,
    body: Record<string, unknown> | undefined,
  ): Promise<void> {
    return this.wsRuntime.dispatchAdmissibleFrame(messageType, body);
  }

  private buildIngressContext(): IngressContext {
    return {
      team_uuid: this.currentTeamUuid() ?? "_unknown",
      plan_level: "internal",
      stamped_by_key: "nano-agent.session.do@v1",
    };
  }

  getLastIngressRejection(): import("../session-edge.js").IngressEnvelope | null {
    return this.lastIngressRejection;
  }

  /**
   * Return the DO-owned SessionWebSocketHelper, constructing it lazily
   * with the best-available session context.
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

  getWsHelper(): SessionWebSocketHelper | null {
    return this.wsHelper;
  }

  getTraceUuid(): string | null {
    return this.traceUuid;
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

  async webSocketClose(ws: unknown): Promise<void> {
    return this.wsRuntime.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    const status = this.healthGate.checkHealth(
      this.heartbeatTracker,
      this.ackWindow,
    );

    if (this.healthGate.shouldClose(status)) {
      await this.persistCheckpoint();
    }

    await this.sweepDeferredAnswers();

    const storage = this.doState.storage;
    if (storage?.setAlarm) {
      await storage.setAlarm(Date.now() + this.config.heartbeatIntervalMs);
    }
  }

  // ── Trace + persistence ────────────────────────────────────

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

  private wsHelperStorage(): SessionStorageLike | null {
    return buildWsHelperStorage(this.buildPersistenceContext());
  }

  private async persistCheckpoint(): Promise<void> {
    return persistCheckpointModule(this.buildPersistenceContext());
  }

  private async restoreFromStorage(): Promise<void> {
    return restoreFromStorageModule(this.buildPersistenceContext());
  }

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
    return this.wsRuntime.handleWebSocketUpgrade(sessionId);
  }

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
      // reconnect path owns the already-attached case
    }
  }

  // ── Accessors for testing ──────────────────────────────────

  getState(): OrchestrationState {
    return this.state;
  }

  getHealthGate(): HealthGate {
    return this.healthGate;
  }

  getSubsystems(): SubsystemHandles {
    return this.subsystems;
  }

  getDefaultEvalRecords(): readonly unknown[] {
    return this.defaultEvalSink.getRecords();
  }

  getDefaultEvalDisclosure(): readonly EvalSinkOverflowDisclosure[] {
    return this.defaultEvalSink.getDisclosure();
  }

  getDefaultEvalStats(): EvalSinkStats {
    return this.defaultEvalSink.getStats();
  }

  private async runPreviewVerification(
    sessionId: string,
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return runPreviewVerificationModule(this.buildVerifyContext(), sessionId, request);
  }

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
