import { createLogger } from "@haimang/nacp-core/logger";
import type { IngressAuthSnapshot, InitialContextSeed } from './auth.js';
import {
  D1SessionTruthRepository,
  type DurableSessionPointer,
  type DurableTurnPointer,
} from "./session-truth.js";

// RH6 runtime implementation — thin public façade lives in user-do.ts.
// ZX4 Phase 0 — seam extraction(per ZX4-ZX5 GPT review Q3 4-module seam):
// types + pure helpers 已抽到 4 个 seam 模块,本文件只保留 NanoOrchestratorUserDO
// 类骨架。Phase 0 是 pure refactor,零行为变更。Phase 1+ 在小文件上各自演进。
// ZX4 Phase 9 P9-01 — post P3-05 flip: jsonDeepEqual / logParityFailure
// 不再被 user-do 使用(parity 比较已删除),仍在 parity-bridge.ts 中保留供
// 未来 dual-track 重启时使用,但本文件不再 import。
import {
  InvalidStreamFrameError,
  isRecord,
  isNonNegativeInteger,
  parseStreamFrame,
  readJson,
  readNdjsonFrames,
  type StreamFrame,
  type StreamReadResult,
} from "./parity-bridge.js";
import {
  CLIENT_WS_HEARTBEAT_INTERVAL_MS,
  createWebSocketPair,
  isWebSocketUpgrade,
  parseLastSeenSeq,
  type AttachmentState,
  type WorkerSocketLike,
} from "./ws-bridge.js";
import {
  type CloseBody,
  type DeleteSessionBody,
  extractPhase,
  isAuthSnapshot,
  jsonResponse,
  redactActivityPayload,
  sessionKey,
  sessionMissingResponse,
  sessionTerminalResponse,
  terminalKey,
  type CancelBody,
  type FollowupBody,
  type SessionEntry,
  type SessionStatus,
  type SessionTerminalRecord,
  type StartSessionBody,
  type TerminalKind,
  type TitlePatchBody,
  type VerifyBody,
} from "./session-lifecycle.js";
import { validateLightweightServerFrame } from "./frame-compat.js";
import {
  ACTIVE_POINTERS_KEY,
  CACHE_PREFIX,
  CACHE_TTL_MS,
  CONVERSATION_INDEX_KEY,
  ENDED_INDEX_KEY,
  ENDED_TTL_MS,
  HOT_STATE_ALARM_MS,
  MAX_CONVERSATIONS,
  MAX_ENDED_SESSIONS,
  MAX_RECENT_FRAMES,
  PENDING_TTL_MS,
  RECENT_FRAMES_PREFIX,
  USER_AUTH_SNAPSHOT_KEY,
  USER_META_KEY,
  USER_SEED_KEY,
  cacheKey,
  recentFramesKey,
  type ActivePointers,
  type ConversationIndexItem,
  type EndedIndexItem,
  type EphemeralCacheEntry,
  type RecentFramesState,
} from "./session-read-model.js";
import { createUserDoDurableTruth } from "./user-do/durable-truth.js";
import { createUserDoAgentRpc } from "./user-do/agent-rpc.js";
import { createUserDoMessageRuntime } from "./user-do/message-runtime.js";
import { createUserDoSessionFlow } from "./user-do/session-flow.js";
import { createUserDoSurfaceRuntime } from "./user-do/surface-runtime.js";
import { createUserDoWsRuntime } from "./user-do/ws-runtime.js";
import { buildAuditPersist } from "./observability.js";
import { tryEmitSystemError } from "@haimang/nacp-core/logger";

const logger = createLogger("orchestrator-core");

// ZX2 Phase 3 P3-01 — extended agent-core RPC binding (input/cancel/verify/
// timeline/streamSnapshot in addition to start/status). Each method has the
// same shape so forwardWithParity can use it generically.
type AgentRpcMethodFn = (
  input: Record<string, unknown>,
  meta: { trace_uuid: string; authority: unknown },
) => Promise<{ status: number; body: Record<string, unknown> | null }>;

export type AgentRpcMethodKey =
  | 'start'
  | 'status'
  | 'input'
  | 'cancel'
  | 'verify'
  | 'timeline'
  | 'streamSnapshot'
  // RH0 P0-E1 collateral fix — `permissionDecision` / `elicitationAnswer`
  // forwarders are referenced at user-do.ts:1330 / 1389 but were absent from
  // this union; without them, `pnpm build` fails on HEAD even before any RH0
  // megafile-split work. Real RPC implementation for these lands with RH1
  // Lane F live runtime.
  | 'permissionDecision'
  | 'elicitationAnswer';

export interface OrchestratorUserEnv {
  readonly AGENT_CORE?: Fetcher & Partial<Record<AgentRpcMethodKey, AgentRpcMethodFn>>;
  readonly NANO_AGENT_DB?: D1Database;
  readonly NANO_INTERNAL_BINDING_SECRET?: string;
  readonly NANO_ENABLE_RHX2_SPIKE?: string;
}

export interface DurableObjectStateLike {
  readonly storage?: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put<T = unknown>(key: string, value: T): Promise<void>;
    delete?(key: string): Promise<void>;
    setAlarm?(scheduledTime: number | Date): Promise<void>;
  };
}

// Re-export seam types for backward compatibility(ZX4 Phase 0):
// 外部 import { SessionStatus, SessionEntry, ... } from './user-do.js' 仍然工作。
export type { SessionStatus, TerminalKind, SessionEntry } from "./session-lifecycle.js";

// ZX5 review fix (deepseek R5): read the orchestrator-core-supplied authority
// from the internal request header. orchestrator-core sets
// `x-nano-internal-authority: JSON.stringify(snapshot)` on every authenticated
// User-DO route; read paths previously only consulted the KV-persisted snapshot
// which is empty for users that haven't started a session yet.
function readInternalAuthority(request: Request): IngressAuthSnapshot | null {
  const raw = request.headers.get('x-nano-internal-authority');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isAuthSnapshot(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export class NanoOrchestratorUserDO {
  private readonly attachments = new Map<string, AttachmentState>();
  private readonly durableTruth;
  private readonly agentRpc;
  private readonly messageRuntime;
  private readonly sessionFlow;
  private readonly surfaceRuntime;
  private readonly wsRuntime;

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: OrchestratorUserEnv,
  ) {
    this.durableTruth = createUserDoDurableTruth({
      sessionTruth: () => this.sessionTruth(),
      get: <T>(key: string) => this.get<T>(key),
      put: <T>(key: string, value: T) => this.put(key, value),
      delete: (key: string) => this.delete(key),
      setHotStateAlarm: (at: number) => this.state.storage?.setAlarm?.(at) ?? Promise.resolve(),
    });
    this.agentRpc = createUserDoAgentRpc({
      env: this.env,
      get: <T>(key: string) => this.get<T>(key),
      put: <T>(key: string, value: T) => this.put(key, value),
      cloneJsonResponse: (status, body, contentType) =>
        this.cloneJsonResponse(status, body, contentType),
      sessionTruth: () => this.sessionTruth(),
      userAuthSnapshotKey: USER_AUTH_SNAPSHOT_KEY,
      sessionKey,
    });
    this.wsRuntime = createUserDoWsRuntime({
      attachments: this.attachments,
      get: <T>(key: string) => this.get<T>(key),
      put: <T>(key: string, value: T) => this.put(key, value),
      readInternalAuthority,
      requireReadableSession: (sessionUuid: string) => this.requireReadableSession(sessionUuid),
      sessionGateMiss: (sessionUuid: string) => this.sessionGateMiss(sessionUuid),
      getTerminal: (sessionUuid: string) => this.getTerminal(sessionUuid),
      readInternalStream: (sessionUuid: string) => this.readInternalStream(sessionUuid),
      emitServerFrame: (sessionUuid: string, frame: { kind: string; [k: string]: unknown }) =>
        this.emitServerFrame(sessionUuid, frame),
      enforceSessionDevice: (
        sessionUuid: string,
        entry: SessionEntry,
        authSnapshot: IngressAuthSnapshot | null | undefined,
      ) => this.enforceSessionDevice(sessionUuid, entry, authSnapshot),
      readAuditAuthSnapshot: async () => (await this.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY)) ?? null,
      persistAudit: async (record) => {
        const snapshot = (await this.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY)) ?? null;
        const teamUuid = record.team_uuid ?? snapshot?.team_uuid ?? snapshot?.tenant_uuid;
        if (!teamUuid) {
          logger.warn("audit-team-missing", {
            code: "internal-error",
            ctx: { tag: "audit-team-missing", event_kind: record.event_kind, session_uuid: record.session_uuid },
          });
          return;
        }
        await buildAuditPersist(this.env)({
          ...record,
          team_uuid: teamUuid,
          user_uuid: record.user_uuid ?? snapshot?.user_uuid ?? snapshot?.sub,
          device_uuid: record.device_uuid ?? snapshot?.device_uuid,
        });
      },
    });
    this.surfaceRuntime = createUserDoSurfaceRuntime({
      env: this.env,
      get: <T>(key: string) => this.get<T>(key),
      put: <T>(key: string, value: T) => this.put(key, value),
      sessionTruth: () => this.sessionTruth(),
      readDurableSnapshot: (sessionUuid: string) => this.readDurableSnapshot(sessionUuid),
      readDurableHistory: (sessionUuid: string) => this.readDurableHistory(sessionUuid),
      requireReadableSession: (sessionUuid: string) => this.requireReadableSession(sessionUuid),
      readAuditAuthSnapshot: async () => (await this.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY)) ?? null,
      persistAudit: async (record) => {
        const snapshot = (await this.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY)) ?? null;
        const teamUuid = record.team_uuid ?? snapshot?.team_uuid ?? snapshot?.tenant_uuid;
        if (!teamUuid) {
          logger.warn("audit-team-missing", {
            code: "internal-error",
            ctx: { tag: "audit-team-missing", event_kind: record.event_kind, session_uuid: record.session_uuid },
          });
          return;
        }
        await buildAuditPersist(this.env)({
          ...record,
          team_uuid: teamUuid,
          user_uuid: record.user_uuid ?? snapshot?.user_uuid ?? snapshot?.sub,
          device_uuid: record.device_uuid ?? snapshot?.device_uuid,
        });
      },
    });
    this.sessionFlow = createUserDoSessionFlow({
      sessionTruth: () => this.sessionTruth(),
      get: <T>(key: string) => this.get<T>(key),
      put: <T>(key: string, value: T) => this.put(key, value),
      delete: (key: string) => this.delete(key),
      userAuthSnapshotKey: USER_AUTH_SNAPSHOT_KEY,
      readDurableSnapshot: (sessionUuid: string) => this.readDurableSnapshot(sessionUuid),
      readDurableTimeline: (sessionUuid: string) => this.readDurableTimeline(sessionUuid),
      readDurableHistory: (sessionUuid: string) => this.readDurableHistory(sessionUuid),
      rememberCache: (name: string, value: Record<string, unknown> | null) =>
        this.rememberCache(name, value),
      updateConversationIndex: (pointer, entry) => this.updateConversationIndex(pointer, entry),
      updateActivePointers: (pointer, turn) => this.updateActivePointers(pointer, turn),
      refreshUserState: (authSnapshot, seed) => this.refreshUserState(authSnapshot, seed as InitialContextSeed | undefined),
      requireAllowedModel: (authSnapshot, modelId) => this.requireAllowedModel(authSnapshot, modelId),
      resolveAllowedModel: (authSnapshot, modelId) => this.resolveAllowedModel(authSnapshot, modelId),
      ensureDurableSession: (sessionUuid, authSnapshot, traceUuid, timestamp) =>
        this.ensureDurableSession(sessionUuid, authSnapshot, traceUuid, timestamp),
      createDurableTurn: (sessionUuid, pointer, authSnapshot, traceUuid, kind, inputText, timestamp, requestedModel) =>
        this.createDurableTurn(sessionUuid, pointer, authSnapshot, traceUuid, kind, inputText, timestamp, requestedModel),
      recordUserMessage: (sessionUuid, pointer, authSnapshot, traceUuid, turn, kind, payload, timestamp) =>
        this.recordUserMessage(sessionUuid, pointer, authSnapshot, traceUuid, turn, kind, payload, timestamp),
      recordContextSnapshot: (sessionUuid, pointer, turn, authSnapshot, traceUuid, payload, timestamp) =>
        this.recordContextSnapshot(sessionUuid, pointer, turn, authSnapshot, traceUuid, payload, timestamp),
      appendDurableActivity: (input) => this.appendDurableActivity(input),
      recordStreamFrames: (sessionUuid, pointer, authSnapshot, traceUuid, turn, frames, timestamp) =>
        this.recordStreamFrames(sessionUuid, pointer, authSnapshot, traceUuid, turn, frames, timestamp),
      forwardStart: (sessionUuid, body) => this.forwardStart(sessionUuid, body),
      forwardStatus: (sessionUuid) => this.forwardStatus(sessionUuid),
      forwardInternalJsonShadow: (sessionUuid, action, body, rpcMethod) =>
        this.forwardInternalJsonShadow(sessionUuid, action, body, rpcMethod),
      readInternalStream: (sessionUuid: string) => this.readInternalStream(sessionUuid),
      requireSession: (sessionUuid: string) => this.requireSession(sessionUuid),
      requireReadableSession: (sessionUuid: string) => this.requireReadableSession(sessionUuid),
      sessionGateMiss: (sessionUuid: string) => this.sessionGateMiss(sessionUuid),
      getTerminal: (sessionUuid: string) => this.getTerminal(sessionUuid),
      enforceSessionDevice: (sessionUuid, entry, authSnapshot) =>
        this.enforceSessionDevice(sessionUuid, entry, authSnapshot),
      notifyTerminal: (sessionUuid: string, terminal: SessionTerminalRecord) =>
        this.notifyTerminal(sessionUuid, terminal),
      rememberEndedSession: (sessionUuid: string, endedAt: string) =>
        this.rememberEndedSession(sessionUuid, endedAt),
      cleanupEndedSessions: (now?: number) => this.cleanupEndedSessions(now),
      proxyReadResponse: (sessionUuid, entry, response) =>
        this.proxyReadResponse(sessionUuid, entry, response),
      cloneJsonResponse: (status, body, contentType) =>
        this.cloneJsonResponse(status, body, contentType),
      touchSession: (sessionUuid, status) => this.touchSession(sessionUuid, status),
      forwardFramesToAttachment: (sessionUuid, entry, frames) =>
        this.forwardFramesToAttachment(sessionUuid, entry, frames),
      handleMessages: (sessionUuid, body) => this.handleMessages(sessionUuid, body),
      attachments: this.attachments,
    });
    this.messageRuntime = createUserDoMessageRuntime({
      attachments: this.attachments,
      get: <T>(key: string) => this.get<T>(key),
      put: <T>(key: string, value: T) => this.put(key, value),
      userAuthSnapshotKey: USER_AUTH_SNAPSHOT_KEY,
      requireSession: (sessionUuid: string) => this.requireSession(sessionUuid),
      sessionGateMiss: (sessionUuid: string) => this.sessionGateMiss(sessionUuid),
      getTerminal: (sessionUuid: string) => this.getTerminal(sessionUuid),
      isAllowedSessionImageUrl: (sessionUuid: string, rawUrl: string) =>
        this.isAllowedSessionImageUrl(sessionUuid, rawUrl),
      refreshUserState: (authSnapshot, seed) => this.refreshUserState(authSnapshot, seed),
      requireAllowedModel: (authSnapshot, modelId) => this.requireAllowedModel(authSnapshot, modelId),
      resolveAllowedModel: (authSnapshot, modelId) => this.resolveAllowedModel(authSnapshot, modelId),
      enforceSessionDevice: (sessionUuid, entry, authSnapshot) =>
        this.enforceSessionDevice(sessionUuid, entry, authSnapshot),
      ensureDurableSession: (sessionUuid, authSnapshot, traceUuid, timestamp) =>
        this.ensureDurableSession(sessionUuid, authSnapshot, traceUuid, timestamp),
      createDurableTurn: (sessionUuid, pointer, authSnapshot, traceUuid, kind, inputText, timestamp, requestedModel) =>
        this.createDurableTurn(sessionUuid, pointer, authSnapshot, traceUuid, kind, inputText, timestamp, requestedModel),
      recordUserMessage: (sessionUuid, pointer, authSnapshot, traceUuid, turn, kind, payload, timestamp) =>
        this.recordUserMessage(sessionUuid, pointer, authSnapshot, traceUuid, turn, kind, payload, timestamp),
      appendDurableActivity: (input) => this.appendDurableActivity(input),
      forwardInternalJsonShadow: (sessionUuid, action, body, rpcMethod) =>
        this.forwardInternalJsonShadow(sessionUuid, action, body, rpcMethod),
      readInternalStream: (sessionUuid: string) => this.readInternalStream(sessionUuid),
      sessionTruth: () => this.sessionTruth(),
      forwardFramesToAttachment: (sessionUuid, entry, frames) =>
        this.forwardFramesToAttachment(sessionUuid, entry, frames),
      recordStreamFrames: (sessionUuid, pointer, authSnapshot, traceUuid, turn, frames, timestamp) =>
        this.recordStreamFrames(sessionUuid, pointer, authSnapshot, traceUuid, turn, frames, timestamp),
      updateConversationIndex: (pointer, entry) => this.updateConversationIndex(pointer, entry),
      updateActivePointers: (pointer, turn) => this.updateActivePointers(pointer, turn),
    });
  }

  async alarm(): Promise<void> {
    try {
      await this.trimHotState();
    } catch (err) {
      logger.warn("alarm-trim-hot-state-failed", {
        code: "internal-error",
        ctx: { tag: "alarm-trim-hot-state-failed", error: String(err) },
      });
    }
    try {
      await this.cleanupEndedSessions();
    } catch (err) {
      logger.warn("alarm-cleanup-ended-sessions-failed", {
        code: "internal-error",
        ctx: { tag: "alarm-cleanup-ended-sessions-failed", error: String(err) },
      });
    }
    try {
      await this.expireStalePendingSessions();
    } catch (err) {
      logger.warn("alarm-expire-stale-pending-failed", {
        code: "internal-error",
        ctx: { tag: "alarm-expire-stale-pending-failed", error: String(err) },
      });
    }
    await this.ensureHotStateAlarm();
  }

  async fetch(request: Request): Promise<Response> {
    await this.cleanupEndedSessions();
    await this.ensureHotStateAlarm();

    // ZX2 Phase 5 P5-02 — /me/sessions list (server-side hot index).
    const pathname = new URL(request.url).pathname;
    if (request.method === 'GET' && pathname === '/me/sessions') {
      return this.handleMeSessions();
    }
    // ZX5 Lane D D5 — /me/conversations:对 5 状态 D1 view 做 conversation
    // 维度聚合(把同 conversation_uuid 的多个 session 收成一个 conversation row)。
    if (request.method === 'GET' && pathname === '/me/conversations') {
      const url = new URL(request.url);
      const limitParam = url.searchParams.get('limit');
      const limit = (() => {
        if (limitParam === null) return 50;
        const n = Number(limitParam);
        if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 200) return 50;
        return n;
      })();
      // ZX5 review fix (deepseek R5): orchestrator-core forwards authority via
      // `x-nano-internal-authority` on every authenticated route, but the read
      // paths previously fell back to the KV-persisted snapshot only — a fresh
      // user (no /start yet) saw an empty list even with a valid token. Prefer
      // the in-flight header, fall back to KV for compatibility.
      const headerAuthority = readInternalAuthority(request);
      return this.handleMeConversations(limit, headerAuthority);
    }
    if (request.method === 'POST' && pathname === '/internal/devices/revoke') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body.device_uuid !== 'string') {
        return jsonResponse(400, { error: 'invalid-input', message: 'device revoke requires device_uuid' });
      }
      return this.handleDeviceRevoke(body.device_uuid, typeof body.reason === 'string' ? body.reason : null);
    }

    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] !== 'sessions' || (segments.length !== 3 && segments.length !== 4)) {
      return jsonResponse(404, { error: 'not-found', message: 'user DO route not found' });
    }

    const sessionUuid = segments[1]!;
    const action =
      segments.length === 4 ? `${segments[2]}/${segments[3]}` : segments[2]!;

    // RH1 P1-06b — internal-only frame forward path. Called by
    // `OrchestratorCoreEntrypoint.forwardServerFrameToClient` to push a
    // server frame to the client attached to this User DO. Body shape:
    //   { frame: { kind: string, ... } }
    // Returns { delivered: boolean, reason?: string }
    if (request.method === 'POST' && action === '__forward-frame') {
      const body = (await request.json().catch(() => null)) as
        | { frame?: { kind?: unknown; [k: string]: unknown } }
        | null;
      if (!body || typeof body !== 'object' || !body.frame || typeof body.frame.kind !== 'string') {
        return jsonResponse(400, {
          delivered: false,
          reason: 'invalid-frame',
        });
      }
      const delivered = this.emitServerFrame(
        sessionUuid,
        body.frame as { kind: string; [k: string]: unknown },
      );
      return jsonResponse(200, {
        delivered,
        reason: delivered ? undefined : 'no-attached-client',
      });
    }

    if (request.method === 'POST' && action === 'start') {
      const body = (await request.json().catch(() => null)) as StartSessionBody | null;
      if (!body || typeof body !== 'object') {
        return jsonResponse(400, { error: 'invalid-start-body', message: 'start requires a JSON body' });
      }
      return this.handleStart(sessionUuid, body);
    }

    if (request.method === 'POST' && action === 'input') {
      const body = (await request.json().catch(() => null)) as FollowupBody | null;
      if (!body || typeof body !== 'object') {
        return jsonResponse(400, { error: 'invalid-input-body', message: 'input requires a JSON body' });
      }
      return this.handleInput(sessionUuid, body);
    }

    if (request.method === 'POST' && action === 'cancel') {
      const body = (await request.json().catch(() => ({}))) as CancelBody;
      return this.handleCancel(sessionUuid, body ?? {});
    }

    if (request.method === 'POST' && action === 'close') {
      const body = (await request.json().catch(() => ({}))) as CloseBody;
      return this.handleClose(sessionUuid, body ?? {});
    }

    if (request.method === 'DELETE' && action === 'delete') {
      const body = (await request.json().catch(() => ({}))) as DeleteSessionBody;
      return this.handleDelete(sessionUuid, body ?? {});
    }

    if (request.method === 'PATCH' && action === 'title') {
      const body = (await request.json().catch(() => null)) as TitlePatchBody | null;
      if (!body || typeof body !== 'object') {
        return jsonResponse(400, {
          error: 'invalid-input',
          message: 'title requires a JSON body',
        });
      }
      return this.handleTitle(sessionUuid, body);
    }

    if (request.method === 'POST' && action === 'verify') {
      const body = (await request.json().catch(() => null)) as VerifyBody | null;
      if (!body || typeof body !== 'object') {
        return jsonResponse(400, { error: 'invalid-verify-body', message: 'verify requires a JSON body' });
      }
      return this.handleVerify(sessionUuid, body);
    }

    if (request.method === 'GET' && action === 'status') return this.handleRead(sessionUuid, 'status');
    if (request.method === 'GET' && action === 'timeline') return this.handleRead(sessionUuid, 'timeline');
    if (request.method === 'GET' && action === 'history') return this.handleRead(sessionUuid, 'history');
    if (request.method === 'GET' && action === 'ws') return this.handleWsAttach(sessionUuid, request);

    // ZX2 Phase 5 P5-01 — facade-必需 endpoints.
    if (request.method === 'GET' && action === 'usage') {
      return this.handleUsage(sessionUuid);
    }
    if (request.method === 'POST' && action === 'resume') {
      return this.handleResume(sessionUuid, request);
    }
    if (request.method === 'POST' && action === 'permission/decision') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) {
        return jsonResponse(400, {
          error: 'invalid-input',
          message: 'permission/decision requires a JSON body',
        });
      }
      return this.handlePermissionDecision(sessionUuid, body);
    }
    if (request.method === 'POST' && action === 'policy/permission_mode') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) {
        return jsonResponse(400, {
          error: 'invalid-input',
          message: 'policy/permission_mode requires a JSON body',
        });
      }
      return this.handlePolicyPermissionMode(sessionUuid, body);
    }
    if (request.method === 'POST' && action === 'elicitation/answer') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) {
        return jsonResponse(400, {
          error: 'invalid-input',
          message: 'elicitation/answer requires a JSON body',
        });
      }
      return this.handleElicitationAnswer(sessionUuid, body);
    }
    // ZX5 Lane D D3 — POST /sessions/{id}/messages(per Q8 owner direction):
    //   - /messages 是 /input 多模态超集
    //   - 同表 nano_conversation_messages + message_kind / source tag 区分来源
    //   - session-running ingress only(pending → 用 /start;ended/expired → 拒)
    if (request.method === 'POST' && action === 'messages') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) {
        return jsonResponse(400, {
          error: 'invalid-input',
          message: 'messages requires a JSON body',
        });
      }
      return this.handleMessages(sessionUuid, body);
    }
    // ZX5 Lane D D4 — GET /sessions/{id}/files
    if (request.method === 'GET' && action === 'files') {
      return this.handleFiles(sessionUuid);
    }

    return jsonResponse(404, { error: 'not-found', message: 'user DO route not found' });
  }

  private sessionTruth(): D1SessionTruthRepository | null {
    return this.env.NANO_AGENT_DB ? new D1SessionTruthRepository(this.env.NANO_AGENT_DB) : null;
  }

  private async ensureDurableSession(
    sessionUuid: string,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    timestamp: string,
  ): Promise<DurableSessionPointer | null> {
    return this.durableTruth.ensureDurableSession(
      sessionUuid,
      authSnapshot,
      traceUuid,
      timestamp,
    );
  }

  private async createDurableTurn(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    kind: 'start' | 'followup' | 'cancel',
    inputText: string | null,
    timestamp: string,
    requestedModel?: {
      readonly model_id: string;
      readonly reasoning_effort: "low" | "medium" | "high" | null;
    } | null,
  ): Promise<DurableTurnPointer | null> {
    return this.durableTruth.createDurableTurn(
      sessionUuid,
      pointer,
      authSnapshot,
      traceUuid,
      kind,
      inputText,
      timestamp,
      requestedModel,
    );
  }

  private async appendDurableActivity(input: {
    readonly pointer: DurableSessionPointer | null;
    readonly authSnapshot: IngressAuthSnapshot;
    readonly traceUuid: string;
    readonly turnUuid?: string | null;
    readonly eventKind: string;
    readonly severity: 'info' | 'warn' | 'error';
    readonly payload: Record<string, unknown>;
    readonly timestamp: string;
  }): Promise<void> {
    await this.durableTruth.appendDurableActivity(input);
  }

  private async recordContextSnapshot(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    turn: DurableTurnPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    payload: unknown,
    timestamp: string,
  ): Promise<void> {
    await this.durableTruth.recordContextSnapshot(
      sessionUuid,
      pointer,
      turn,
      authSnapshot,
      traceUuid,
      payload,
      timestamp,
    );
  }

  private async recordUserMessage(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    turn: DurableTurnPointer | null,
    kind: 'user.input' | 'user.cancel' | 'user.input.text' | 'user.input.multipart',
    payload: Record<string, unknown>,
    timestamp: string,
  ): Promise<void> {
    await this.durableTruth.recordUserMessage(
      sessionUuid,
      pointer,
      authSnapshot,
      traceUuid,
      turn,
      kind,
      payload,
      timestamp,
    );
  }

  private async recordStreamFrames(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    turn: DurableTurnPointer | null,
    frames: readonly StreamFrame[],
    timestamp: string,
  ): Promise<void> {
    await this.durableTruth.recordStreamFrames(
      sessionUuid,
      pointer,
      authSnapshot,
      traceUuid,
      turn,
      frames,
      timestamp,
    );
  }

  private async readDurableSnapshot(sessionUuid: string) {
    return this.durableTruth.readDurableSnapshot(sessionUuid);
  }

  private async readDurableTimeline(sessionUuid: string) {
    return this.durableTruth.readDurableTimeline(sessionUuid);
  }

  private async readDurableHistory(sessionUuid: string) {
    return this.durableTruth.readDurableHistory(sessionUuid);
  }

  private async updateConversationIndex(
    pointer: DurableSessionPointer | null,
    entry: SessionEntry,
  ): Promise<void> {
    await this.durableTruth.updateConversationIndex(pointer, entry);
  }

  private async updateActivePointers(
    pointer: DurableSessionPointer | null,
    turn: DurableTurnPointer | null,
  ): Promise<void> {
    await this.durableTruth.updateActivePointers(pointer, turn);
  }

  private async rememberCache(name: string, value: Record<string, unknown> | null): Promise<void> {
    await this.durableTruth.rememberCache(name, value);
  }

  private async trimHotState(now = Date.now()): Promise<void> {
    await this.durableTruth.trimHotState(now);
  }

  private async ensureHotStateAlarm(): Promise<void> {
    await this.durableTruth.ensureHotStateAlarm();
  }

  // ZX4 Phase 9 P9-01 — P3-05 flip executed: HTTP fetch fallback removed.
  // The dual-track parity check served as a 7-day safety net during ZX2/ZX4;
  // after the observation window (P8 fast-track 90/90 facade calls clean)
  // the RPC binding is the sole truth path. fetch fallback handlers in
  // agent-core/host/internal.ts (start/input/cancel/verify) are also
  // pruned in this phase.
  private async forwardStart(
    sessionUuid: string,
    body: Record<string, unknown>,
  ): Promise<{ response: Response; body: Record<string, unknown> | null }> {
    const rpcStart = this.env.AGENT_CORE?.start;
    const authority = isAuthSnapshot(body.authority) ? body.authority : null;
    const traceUuid = typeof body.trace_uuid === 'string' ? body.trace_uuid : crypto.randomUUID();
    if (typeof rpcStart !== 'function' || !authority) {
      return {
        response: jsonResponse(503, {
          error: 'agent-rpc-unavailable',
          message: 'agent-core RPC binding required after P3-05 flip',
        }),
        body: { error: 'agent-rpc-unavailable' },
      };
    }
    try {
      const rpcResult = await rpcStart(
        { session_uuid: sessionUuid, ...body },
        { trace_uuid: traceUuid, authority },
      );
      return {
        response: this.cloneJsonResponse(rpcResult.status, rpcResult.body),
        body: rpcResult.body,
      };
    } catch (error) {
      logger.warn("agent-rpc-throw", {
        code: "internal-error",
        ctx: {
          tag: "agent-rpc-throw",
          action: "start",
          session_uuid: sessionUuid,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        },
      });
      return {
        response: jsonResponse(502, {
          error: 'agent-rpc-throw',
          message: error instanceof Error ? error.message : String(error),
        }),
        body: { error: 'agent-rpc-throw' },
      };
    }
  }

  private async forwardStatus(sessionUuid: string): Promise<Response> {
    const rpcStatus = this.env.AGENT_CORE?.status;
    const authority = await this.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY);
    if (typeof rpcStatus !== 'function' || !authority) {
      return jsonResponse(503, {
        error: 'agent-rpc-unavailable',
        message: 'agent-core RPC binding required after P3-05 flip',
      });
    }
    try {
      const rpcResult = await rpcStatus(
        { session_uuid: sessionUuid },
        { trace_uuid: crypto.randomUUID(), authority },
      );
      return this.cloneJsonResponse(rpcResult.status, rpcResult.body);
    } catch (error) {
      logger.warn("agent-rpc-throw", {
        code: "internal-error",
        ctx: {
          tag: "agent-rpc-throw",
          action: "status",
          session_uuid: sessionUuid,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        },
      });
      return jsonResponse(502, {
        error: 'agent-rpc-throw',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ZX4 Phase 9 P9-01 — P3-05 flip executed: dual-track parity removed.
  // RPC binding is the sole transport for input / cancel / verify / timeline.
  // Method name preserved (forwardInternalJsonShadow) so call sites stay
  // unchanged; the "Shadow" semantic is now historical, not behavioral.
  private async forwardInternalJsonShadow(
    sessionUuid: string,
    action: 'input' | 'cancel' | 'verify' | 'timeline',
    body: Record<string, unknown> | undefined,
    rpcMethod: AgentRpcMethodKey,
  ): Promise<{ response: Response; body: Record<string, unknown> | null }> {
    const rpc = this.env.AGENT_CORE?.[rpcMethod];
    const authority = isAuthSnapshot(body?.authority)
      ? body?.authority
      : await this.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY);
    if (typeof rpc !== 'function' || !authority) {
      return {
        response: jsonResponse(503, {
          error: 'agent-rpc-unavailable',
          message: `agent-core RPC binding required after P3-05 flip (action=${action})`,
        }),
        body: { error: 'agent-rpc-unavailable' },
      };
    }
    const traceUuid =
      typeof body?.trace_uuid === 'string' ? body.trace_uuid : crypto.randomUUID();
    const rpcInput: Record<string, unknown> = {
      session_uuid: sessionUuid,
      ...(body ?? {}),
    };
    try {
      const rpcResult = await rpc(rpcInput, { trace_uuid: traceUuid, authority });
      return {
        response: this.cloneJsonResponse(rpcResult.status, rpcResult.body),
        body: rpcResult.body,
      };
    } catch (error) {
      logger.warn("agent-rpc-throw", {
        code: "internal-error",
        ctx: {
          tag: "agent-rpc-throw",
          action,
          session_uuid: sessionUuid,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        },
      });
      return {
        response: jsonResponse(502, {
          error: 'agent-rpc-throw',
          message: `agent-core rpc ${action} threw: ${error instanceof Error ? error.message : String(error)}`,
        }),
        body: { error: 'agent-rpc-throw' },
      };
    }
  }

  private async hydrateSessionFromDurableTruth(sessionUuid: string): Promise<SessionEntry | null> {
    return this.sessionFlow.hydrateSessionFromDurableTruth(sessionUuid);
  }

  private async requireReadableSession(sessionUuid: string): Promise<SessionEntry | null> {
    return this.sessionFlow.requireReadableSession(sessionUuid);
  }

  private async handleStart(sessionUuid: string, body: StartSessionBody): Promise<Response> {
    return this.sessionFlow.handleStart(sessionUuid, body);
  }

  // ZX5 review fix (deepseek R3 / kimi R5 / Q8 owner direction):
  // /input is now a thin compatibility alias. It validates `{text}` (preserving
  // its historical 400 `invalid-input-body` shape for upstream callers) and
  // normalizes the body into the /messages multipart shape `parts: [{kind:
  // 'text', text}]` before delegating to handleMessages. Single 落库 path,
  // single agent-core forward, single message_kind taxonomy.
  private async handleInput(sessionUuid: string, body: FollowupBody): Promise<Response> {
    return this.sessionFlow.handleInput(sessionUuid, body);
  }

  private async handleCancel(sessionUuid: string, body: CancelBody): Promise<Response> {
    return this.sessionFlow.handleCancel(sessionUuid, body);
  }

  private async handleClose(sessionUuid: string, body: CloseBody): Promise<Response> {
    return this.sessionFlow.handleClose(sessionUuid, body);
  }

  private async handleDelete(sessionUuid: string, body: DeleteSessionBody): Promise<Response> {
    return this.sessionFlow.handleDelete(sessionUuid, body);
  }

  private async handleTitle(sessionUuid: string, body: TitlePatchBody): Promise<Response> {
    return this.sessionFlow.handleTitle(sessionUuid, body);
  }

  private async handleVerify(sessionUuid: string, body: VerifyBody): Promise<Response> {
    if (body.check === "emit-system-error") {
      if (this.env.NANO_ENABLE_RHX2_SPIKE !== "true") {
        return jsonResponse(403, {
          error: "spike-disabled",
          message: "RHX2 system.error spike trigger is disabled",
        });
      }
      const attachment = this.attachments.get(sessionUuid);
      const traceUuid =
        typeof body.trace_uuid === "string" && body.trace_uuid.length > 0
          ? body.trace_uuid
          : crypto.randomUUID();
      if (!attachment) {
        return jsonResponse(409, {
          error: "no-attached-client",
          message: "system.error spike requires an attached websocket client",
          trace_uuid: traceUuid,
        });
      }
      const emitted = await tryEmitSystemError({
        code: typeof body.code === "string" ? body.code : "spike-system-error",
        source_worker: "orchestrator-core",
        trace_uuid: traceUuid,
        message: "RHX2 synthetic system.error spike",
        detail: { check: "emit-system-error", session_uuid: sessionUuid },
        emit: async (systemFrame) => {
          attachment.socket.send(JSON.stringify(systemFrame));
          return { delivered: true };
        },
        fallbackNotify: async (payload) => {
          attachment.socket.send(JSON.stringify(payload));
        },
      });
      return jsonResponse(200, {
        ok: true,
        check: "emit-system-error",
        trace_uuid: traceUuid,
        emitted,
      });
    }
    return this.sessionFlow.handleVerify(sessionUuid, body);
  }

  private async handleRead(sessionUuid: string, action: 'status' | 'timeline' | 'history'): Promise<Response> {
    return this.sessionFlow.handleRead(sessionUuid, action);
  }

  // ZX2 Phase 5 P5-03 / RH2 P2-08 — emit a server→client WS frame.
  //
  // RH2 P2-08:在 send 前调 `validateLightweightServerFrame()`,把已知 kind 走
  // NACP schema 校验(via `frame-compat.mapKindToMessageType` + 对应 body
  // schema)。校验失败 → log + drop(不 throw,因为 emitServerFrame 是
  // best-effort push;但严格记录 schema bypass 数量)。
  // The wire shape stays the lightweight `{kind, ...}` per ZX2 P4-04 — RH3
  // device gate完成后,统一升级 attached client 到 full NACP frame。
  emitServerFrame(sessionUuid: string, frame: { kind: string; [k: string]: unknown }): boolean {
    const validation = validateLightweightServerFrame(frame);
    if (!validation.ok) {
      const attachment = this.attachments.get(sessionUuid);
      if (attachment) {
        void tryEmitSystemError({
          code: "internal-error",
          source_worker: "orchestrator-core",
          message: "server frame rejected before delivery",
          detail: {
            kind: frame.kind,
            reason: validation.reason,
          },
          emit: async (systemFrame) => {
            attachment.socket.send(JSON.stringify(systemFrame));
            return { delivered: true };
          },
          fallbackNotify: async (payload) => {
            attachment.socket.send(JSON.stringify(payload));
          },
        });
      }
      logger.warn("server-frame-schema-rejected", {
        code: "internal-error",
        ctx: {
          tag: "server-frame-schema-rejected",
          session_uuid: sessionUuid,
          kind: frame.kind,
          reason: validation.reason,
        },
      });
      return false;
    }
    const attachment = this.attachments.get(sessionUuid);
    if (!attachment) return false;
    try {
      attachment.socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  // ZX2 Phase 5 P5-01 → ZX4 Phase 5 P5-01 — usage read from D1 truth.
  // When `nano_usage_events` has rows for this session we aggregate them
  // (allow verdicts only) + join team-level llm balance for budget. The
  // null-placeholder shape is preserved as the fallback when no rows
  // exist yet (eg. session that hasn't called any LLM/tool capability).
  private async handleUsage(sessionUuid: string): Promise<Response> {
    return this.surfaceRuntime.handleUsage(sessionUuid);
  }

  // ZX2 Phase 5 P5-01 — explicit resume ack. Companion to the WS
  // `?last_seen_seq=` query path; this HTTP variant lets clients tell
  // the server "I'm coming back" without opening WS first.
  private async handleResume(
    sessionUuid: string,
    request: Request,
  ): Promise<Response> {
    return this.surfaceRuntime.handleResume(sessionUuid, request);
  }

  // ZX2 Phase 5 P5-01 / P5-03 — record a permission decision. Real
  // permission round-trip lives on the WS path; this HTTP endpoint is
  // the mirror so clients without an active WS can still respond.
  private async handlePermissionDecision(
    sessionUuid: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return this.surfaceRuntime.handlePermissionDecision(sessionUuid, body);
  }

  // ZX4 Phase 6 P6-01 — elicitation answer ingress. Mirror of
  // handlePermissionDecision: store locally + forward to agent-core via
  // RPC so the runtime DO has the answer keyed by request_uuid.
  private async handleElicitationAnswer(
    sessionUuid: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return this.surfaceRuntime.handleElicitationAnswer(sessionUuid, body);
  }

  // ZX5 Lane D D3 — POST /sessions/{id}/messages.
  // Per Q8 owner direction:`/messages` 是 `/input` 的多模态超集;统一落到
  // 同一 `nano_conversation_messages` 表 + `message_kind` source tag 区分;
  // 只作为 session-running ingress(pending → 用 /start;ended/expired → 拒)。
  //
  // body shape(前端契约):
  //   {
  //     parts: Array<{ kind: 'text', text: string }
  //                 | { kind: 'artifact_ref', artifact_uuid: string, mime?: string, summary?: string }>,
  //     trace_uuid?: string,
  //     auth_snapshot?: IngressAuthSnapshot,
  //     initial_context_seed?: InitialContextSeed,
  //   }
  //
  // 与 `/input` 的兼容关系:`/input` 接受的 `{text}` 在服务端会被归一化为
  // `parts: [{kind: 'text', text}]` 后落同一张表(自然 alias),所以前端
  // 可以选 `/input`(text-only)或 `/messages`(任意 parts);worker 不
  // 维护两套落库路径。
  private async handleMessages(
    sessionUuid: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return this.messageRuntime.handleMessages(sessionUuid, body);
  }

  private isAllowedSessionImageUrl(sessionUuid: string, rawUrl: string): boolean {
    return this.surfaceRuntime.isAllowedSessionImageUrl(sessionUuid, rawUrl);
  }

  private async requireAllowedModel(
    authSnapshot: IngressAuthSnapshot,
    modelId: string,
  ): Promise<Response | null> {
    return this.surfaceRuntime.requireAllowedModel(authSnapshot, modelId);
  }

  private async resolveAllowedModel(
    authSnapshot: IngressAuthSnapshot,
    modelId: string,
  ) {
    return this.surfaceRuntime.resolveAllowedModel(authSnapshot, modelId);
  }

  // ZX5 Lane D D4 — GET /sessions/{id}/files.
  // 当前 6 worker 都没有 R2 binding(deepseek R8 已点出);本期实现仅
  // 从 `nano_conversation_messages.body_json` 中扫 artifact_ref(D3 落的
  // 多模态 part)+ context snapshots,返 list。**真正的 R2 拉取需 owner
  // 创建 R2 bucket + binding 后扩展**;当前 endpoint 返 list 而不返 bytes。
  private async handleFiles(sessionUuid: string): Promise<Response> {
    return this.surfaceRuntime.handleFiles(sessionUuid);
  }

  private async handlePolicyPermissionMode(
    sessionUuid: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return this.surfaceRuntime.handlePolicyPermissionMode(sessionUuid, body);
  }

  // ZX2 Phase 5 P5-02 — list this user's sessions from the hot conversation
  // index. Each conversation has at most one `latest_session_uuid`; we
  // join with each session's per-uuid SessionEntry for last_seen_at /
  // status / last_phase so the response is render-ready.
  //
  // ZX4 P3-05 — read-model 5-state view: also merge D1 rows (pending /
  // active / detached / ended / expired). Pending rows live ONLY in D1
  // (mint path doesn't write KV), so without this merge GET /me/sessions
  // would silently drop them. D1 is the authoritative status source when
  // a row appears in both places.
  private async handleMeSessions(): Promise<Response> {
    return this.surfaceRuntime.handleMeSessions();
  }

  // ZX5 Lane D D5 — GET /me/conversations.
  // Per Q5 owner direction:仅复用现有 D1 truth(`nano_conversation_sessions`),
  // 不新建平行表。Group session by conversation_uuid → 每 conversation 一行。
  private async handleMeConversations(
    limit: number,
    headerAuthority?: IngressAuthSnapshot | null,
  ): Promise<Response> {
    return this.surfaceRuntime.handleMeConversations(limit, headerAuthority);
  }

  private async handleWsAttach(sessionUuid: string, request: Request): Promise<Response> {
    return this.wsRuntime.handleWsAttach(sessionUuid, request);
  }

  private bindSocketLifecycle(sessionUuid: string, socket: WorkerSocketLike): void {
    this.wsRuntime.bindSocketLifecycle(sessionUuid, socket);
  }

  private async markDetached(sessionUuid: string): Promise<void> {
    await this.wsRuntime.markDetached(sessionUuid);
  }

  private async touchSession(sessionUuid: string, status: SessionStatus): Promise<void> {
    await this.wsRuntime.touchSession(sessionUuid, status);
  }

  private async proxyReadResponse(
    sessionUuid: string,
    entry: SessionEntry,
    response: Response,
  ): Promise<Response> {
    return this.agentRpc.proxyReadResponse(sessionUuid, entry, response);
  }

  private async forwardFramesToAttachment(
    sessionUuid: string,
    entry: SessionEntry,
    frames: readonly StreamFrame[],
  ): Promise<SessionEntry> {
    return this.wsRuntime.forwardFramesToAttachment(sessionUuid, entry, frames);
  }

  private async notifyTerminal(
    sessionUuid: string,
    terminal: SessionTerminalRecord,
  ): Promise<void> {
    await this.wsRuntime.notifyTerminal(sessionUuid, terminal);
  }

  private async forwardInternalRaw(
    sessionUuid: string,
    action: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    return this.agentRpc.forwardInternalRaw(sessionUuid, action, body);
  }

  private async readInternalStream(sessionUuid: string): Promise<StreamReadResult> {
    return this.agentRpc.readInternalStream(sessionUuid);
  }

  private async refreshUserState(
    authSnapshot?: IngressAuthSnapshot,
    seed?: InitialContextSeed,
  ): Promise<void> {
    await this.surfaceRuntime.refreshUserState(authSnapshot, seed);
  }

  private async requireSession(sessionUuid: string): Promise<SessionEntry | null> {
    return this.surfaceRuntime.requireSession(sessionUuid);
  }

  private async enforceSessionDevice(
    sessionUuid: string,
    entry: SessionEntry,
    authSnapshot: IngressAuthSnapshot | null | undefined,
  ): Promise<SessionEntry | Response> {
    return this.surfaceRuntime.enforceSessionDevice(sessionUuid, entry, authSnapshot);
  }

  private async handleDeviceRevoke(deviceUuid: string, reason: string | null): Promise<Response> {
    return this.wsRuntime.handleDeviceRevoke(deviceUuid, reason);
  }

  // ZX4 P3-07 — ingress guard miss path (per R11). When the KV entry is
  // missing AND D1 says the row is 'pending' or 'expired', return a
  // distinct 409 instead of the generic 404 — clients/proxies need to
  // distinguish "you minted but never started" from "this UUID was never
  // minted at all".
  private async sessionGateMiss(sessionUuid: string): Promise<Response> {
    return this.surfaceRuntime.sessionGateMiss(sessionUuid);
  }

  private async getTerminal(sessionUuid: string): Promise<SessionTerminalRecord | null> {
    return this.surfaceRuntime.getTerminal(sessionUuid);
  }

  private async rememberEndedSession(sessionUuid: string, endedAt: string): Promise<void> {
    await this.durableTruth.rememberEndedSession(sessionUuid, endedAt);
  }

  // ZX4 P3-04 — alarm GC for pending rows older than 24h. Runs on every
  // hot-state alarm tick (every 10 min); cheap when there's nothing to do
  // (single index scan), bounded to 200 rows per tick to avoid alarm
  // overrun. Uses `started_at` per R10 schema-field freeze (NOT created_at).
  private async expireStalePendingSessions(now = Date.now()): Promise<void> {
    await this.durableTruth.expireStalePendingSessions(now);
  }

  private async cleanupEndedSessions(now = Date.now()): Promise<void> {
    await this.durableTruth.cleanupEndedSessions(now);
  }

  private async get<T>(key: string): Promise<T | undefined> {
    return this.state.storage?.get<T>(key);
  }

  private async put<T>(key: string, value: T): Promise<void> {
    await this.state.storage?.put(key, value);
  }

  private async delete(key: string): Promise<void> {
    await this.state.storage?.delete?.(key);
  }

  private cloneJsonResponse(
    status: number,
    body: Record<string, unknown> | null,
    contentType = 'application/json',
  ): Response {
    return new Response(body ? JSON.stringify(body) : null, {
      status,
      headers: { 'Content-Type': contentType },
    });
  }
}
