import type { IngressAuthSnapshot } from './auth.js';
import {
  D1SessionTruthRepository,
  type DurableSessionPointer,
  type DurableTurnPointer,
} from "./session-truth.js";

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
  type VerifyBody,
} from "./session-lifecycle.js";
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
  | 'streamSnapshot';

export interface OrchestratorUserEnv {
  readonly AGENT_CORE?: Fetcher & Partial<Record<AgentRpcMethodKey, AgentRpcMethodFn>>;
  readonly NANO_AGENT_DB?: D1Database;
  readonly NANO_INTERNAL_BINDING_SECRET?: string;
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

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: OrchestratorUserEnv,
  ) {}

  async alarm(): Promise<void> {
    await this.trimHotState();
    await this.cleanupEndedSessions();
    await this.expireStalePendingSessions();
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

    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] !== 'sessions' || (segments.length !== 3 && segments.length !== 4)) {
      return jsonResponse(404, { error: 'not-found', message: 'user DO route not found' });
    }

    const sessionUuid = segments[1]!;
    const action =
      segments.length === 4 ? `${segments[2]}/${segments[3]}` : segments[2]!;

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
    const repo = this.sessionTruth();
    const teamUuid = authSnapshot.team_uuid ?? authSnapshot.tenant_uuid;
    const actorUserUuid = authSnapshot.user_uuid ?? authSnapshot.sub;
    if (!repo || typeof teamUuid !== 'string' || teamUuid.length === 0) return null;
    return repo.beginSession({
      session_uuid: sessionUuid,
      team_uuid: teamUuid,
      actor_user_uuid: actorUserUuid,
      trace_uuid: traceUuid,
      started_at: timestamp,
    });
  }

  private async createDurableTurn(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    kind: 'start' | 'followup' | 'cancel',
    inputText: string | null,
    timestamp: string,
  ): Promise<DurableTurnPointer | null> {
    const repo = this.sessionTruth();
    const teamUuid = authSnapshot.team_uuid ?? authSnapshot.tenant_uuid;
    const actorUserUuid = authSnapshot.user_uuid ?? authSnapshot.sub;
    if (!repo || !pointer || typeof teamUuid !== 'string' || teamUuid.length === 0) return null;
    return repo.createTurn({
      session_uuid: sessionUuid,
      conversation_uuid: pointer.conversation_uuid,
      team_uuid: teamUuid,
      actor_user_uuid: actorUserUuid,
      trace_uuid: traceUuid,
      kind,
      input_text: inputText,
      created_at: timestamp,
    });
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
    const repo = this.sessionTruth();
    const teamUuid = input.authSnapshot.team_uuid ?? input.authSnapshot.tenant_uuid;
    const actorUserUuid = input.authSnapshot.user_uuid ?? input.authSnapshot.sub;
    if (!repo || typeof teamUuid !== 'string' || teamUuid.length === 0) return;
    await repo.appendActivity({
      team_uuid: teamUuid,
      actor_user_uuid: actorUserUuid,
      conversation_uuid: input.pointer?.conversation_uuid ?? null,
      session_uuid: input.pointer?.session_uuid ?? null,
      turn_uuid: input.turnUuid ?? null,
      trace_uuid: input.traceUuid,
      event_kind: input.eventKind,
      severity: input.severity,
      payload: redactActivityPayload(input.payload),
      created_at: input.timestamp,
    });
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
    const repo = this.sessionTruth();
    const teamUuid = authSnapshot.team_uuid ?? authSnapshot.tenant_uuid;
    if (!repo || !pointer || typeof teamUuid !== 'string' || teamUuid.length === 0) return;
    const recordPayload = isRecord(payload) ? payload : {};
    await repo.captureContextSnapshot({
      session_uuid: sessionUuid,
      conversation_uuid: pointer.conversation_uuid,
      team_uuid: teamUuid,
      trace_uuid: traceUuid,
      turn_uuid: turn?.turn_uuid ?? null,
      snapshot_kind: 'initial-context',
      summary_ref: null,
      prompt_token_estimate: null,
      payload: recordPayload,
      created_at: timestamp,
    });
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
    const repo = this.sessionTruth();
    const teamUuid = authSnapshot.team_uuid ?? authSnapshot.tenant_uuid;
    if (!repo || !pointer || typeof teamUuid !== 'string' || teamUuid.length === 0) return;
    await repo.appendMessage({
      session_uuid: sessionUuid,
      conversation_uuid: pointer.conversation_uuid,
      team_uuid: teamUuid,
      trace_uuid: traceUuid,
      turn_uuid: turn?.turn_uuid ?? null,
      // ZX5 review (deepseek R2): kind taxonomy was extended in D3 to include
      // 'user.input.text' / 'user.input.multipart'; the role discriminator must
      // accept the whole `user.input.*` family — strict equality silently mis-
      // tagged D3 messages as `system` and corrupted history reads.
      role: kind.startsWith('user.input') ? 'user' : 'system',
      kind,
      event_seq: null,
      body: payload,
      created_at: timestamp,
    });
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
    await this.put(recentFramesKey(sessionUuid), {
      updated_at: timestamp,
      frames: frames.slice(-MAX_RECENT_FRAMES),
    } satisfies RecentFramesState);
    const repo = this.sessionTruth();
    const teamUuid = authSnapshot.team_uuid ?? authSnapshot.tenant_uuid;
    const actorUserUuid = authSnapshot.user_uuid ?? authSnapshot.sub;
    if (!repo || !pointer || typeof teamUuid !== 'string' || teamUuid.length === 0) return;

    for (const frame of frames) {
      if (frame.kind === 'event') {
        await repo.appendStreamEvent({
          session_uuid: sessionUuid,
          conversation_uuid: pointer.conversation_uuid,
          team_uuid: teamUuid,
          trace_uuid: traceUuid,
          turn_uuid: turn?.turn_uuid ?? null,
          event_seq: frame.seq,
          payload: frame.payload,
          created_at: timestamp,
        });
        await repo.appendActivity({
          team_uuid: teamUuid,
          actor_user_uuid: actorUserUuid,
          conversation_uuid: pointer.conversation_uuid,
          session_uuid: sessionUuid,
          turn_uuid: turn?.turn_uuid ?? null,
          trace_uuid: traceUuid,
          event_kind: `stream.${typeof frame.payload.kind === 'string' ? frame.payload.kind : 'event'}`,
          severity:
            frame.payload.kind === 'system.notify' &&
            typeof frame.payload.severity === 'string' &&
            frame.payload.severity === 'error'
              ? 'error'
              : 'info',
          payload: redactActivityPayload(frame.payload),
          created_at: timestamp,
        });
      } else if (frame.kind === 'terminal') {
        await repo.appendActivity({
          team_uuid: teamUuid,
          actor_user_uuid: actorUserUuid,
          conversation_uuid: pointer.conversation_uuid,
          session_uuid: sessionUuid,
          turn_uuid: turn?.turn_uuid ?? null,
          trace_uuid: traceUuid,
          event_kind: `stream.terminal.${frame.terminal}`,
          severity: frame.terminal === 'error' ? 'error' : 'info',
          payload: redactActivityPayload(frame.payload ?? { terminal: frame.terminal }),
          created_at: timestamp,
        });
      }
    }
  }

  private async readDurableSnapshot(sessionUuid: string) {
    return this.sessionTruth()?.readSnapshot(sessionUuid) ?? null;
  }

  private async readDurableTimeline(sessionUuid: string) {
    return this.sessionTruth()?.readTimeline(sessionUuid) ?? [];
  }

  private async readDurableHistory(sessionUuid: string) {
    return this.sessionTruth()?.readHistory(sessionUuid) ?? [];
  }

  private async updateConversationIndex(
    pointer: DurableSessionPointer | null,
    entry: SessionEntry,
  ): Promise<void> {
    if (!pointer) return;
    const current = (await this.get<ConversationIndexItem[]>(CONVERSATION_INDEX_KEY)) ?? [];
    const next = [
      {
        conversation_uuid: pointer.conversation_uuid,
        latest_session_uuid: pointer.session_uuid,
        status: entry.status,
        updated_at: entry.last_seen_at,
      },
      ...current.filter((item) => item.conversation_uuid !== pointer.conversation_uuid),
    ].slice(0, MAX_CONVERSATIONS);
    await this.put(CONVERSATION_INDEX_KEY, next);
  }

  private async updateActivePointers(
    pointer: DurableSessionPointer | null,
    turn: DurableTurnPointer | null,
  ): Promise<void> {
    await this.put(ACTIVE_POINTERS_KEY, {
      conversation_uuid: pointer?.conversation_uuid ?? null,
      session_uuid: pointer?.session_uuid ?? null,
      turn_uuid: turn?.turn_uuid ?? null,
    } satisfies ActivePointers);
  }

  private async rememberCache(name: string, value: Record<string, unknown> | null): Promise<void> {
    await this.put(cacheKey(name), {
      key: name,
      value,
      expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    } satisfies EphemeralCacheEntry);
  }

  private async trimHotState(now = Date.now()): Promise<void> {
    const index = (await this.get<ConversationIndexItem[]>(CONVERSATION_INDEX_KEY)) ?? [];
    if (index.length > MAX_CONVERSATIONS) {
      await this.put(CONVERSATION_INDEX_KEY, index.slice(0, MAX_CONVERSATIONS));
    }
    const activePointers = await this.get<ActivePointers>(ACTIVE_POINTERS_KEY);
    const sessionUuids = new Set<string>();
    for (const item of index) {
      sessionUuids.add(item.latest_session_uuid);
    }
    if (typeof activePointers?.session_uuid === 'string' && activePointers.session_uuid.length > 0) {
      sessionUuids.add(activePointers.session_uuid);
    }
    for (const sessionUuid of sessionUuids) {
      const recent = await this.get<RecentFramesState>(recentFramesKey(sessionUuid));
      if (recent?.frames && recent.frames.length > MAX_RECENT_FRAMES) {
        await this.put(recentFramesKey(sessionUuid), {
          ...recent,
          frames: recent.frames.slice(-MAX_RECENT_FRAMES),
        } satisfies RecentFramesState);
      }
      for (const cacheName of [`status:${sessionUuid}`, `verify:${sessionUuid}`]) {
        const cache = await this.get<EphemeralCacheEntry>(cacheKey(cacheName));
        const expiresAt = cache?.expires_at ? Date.parse(cache.expires_at) : Number.NaN;
        if (cache && Number.isFinite(expiresAt) && expiresAt <= now) {
          await this.delete(cacheKey(cacheName));
        }
      }
    }
    const ended = (await this.get<EndedIndexItem[]>(ENDED_INDEX_KEY)) ?? [];
    for (const item of ended) {
      const endedAt = Date.parse(item.ended_at);
      if (Number.isFinite(endedAt) && endedAt < now - ENDED_TTL_MS) {
        await this.delete(recentFramesKey(item.session_uuid));
        await this.delete(cacheKey(`status:${item.session_uuid}`));
        await this.delete(cacheKey(`verify:${item.session_uuid}`));
      }
    }
  }

  private async ensureHotStateAlarm(): Promise<void> {
    await this.state.storage?.setAlarm?.(Date.now() + HOT_STATE_ALARM_MS);
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
      console.warn(
        `agent-rpc-throw action=start session=${sessionUuid}`,
        { tag: 'agent-rpc-throw', action: 'start', session_uuid: sessionUuid,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) },
      );
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
      console.warn(
        `agent-rpc-throw action=status session=${sessionUuid}`,
        { tag: 'agent-rpc-throw', action: 'status', session_uuid: sessionUuid,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) },
      );
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
      console.warn(
        `agent-rpc-throw action=${action} session=${sessionUuid}`,
        {
          tag: 'agent-rpc-throw',
          action,
          session_uuid: sessionUuid,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        },
      );
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
    const durable = await this.readDurableSnapshot(sessionUuid);
    if (!durable) return null;
    // ZX4 P3-07 — pending / expired rows are not readable as live sessions;
    // ingress guards must reject them with a specific 409 instead of letting
    // hydrate fabricate a "fake" entry that downstream code treats as active.
    if (durable.session_status === 'pending' || durable.session_status === 'expired') {
      return null;
    }
    const now = new Date().toISOString();
    const entry: SessionEntry = {
      created_at: durable.started_at,
      last_seen_at: now,
      status: durable.session_status,
      last_phase: durable.last_phase,
      relay_cursor: durable.last_event_seq,
      ended_at: durable.ended_at,
    };
    await this.put(sessionKey(sessionUuid), entry);
    await this.updateConversationIndex(
      {
        conversation_uuid: durable.conversation_uuid,
        session_uuid: sessionUuid,
        conversation_created: false,
      },
      entry,
    );
    const timeline = await this.readDurableTimeline(sessionUuid);
    if (timeline.length > 0) {
      const recentEvents = timeline.slice(-MAX_RECENT_FRAMES);
      const startSeq = Math.max(1, durable.last_event_seq - recentEvents.length + 1);
      await this.put(recentFramesKey(sessionUuid), {
        updated_at: now,
        frames: recentEvents.map((payload, index) => ({
          kind: 'event',
          seq: startSeq + index,
          name: 'session.stream.event',
          payload,
        })),
      } satisfies RecentFramesState);
    }
    return entry;
  }

  private async requireReadableSession(sessionUuid: string): Promise<SessionEntry | null> {
    return (await this.requireSession(sessionUuid)) ?? this.hydrateSessionFromDurableTruth(sessionUuid);
  }

  private async handleStart(sessionUuid: string, body: StartSessionBody): Promise<Response> {
    const initialInput =
      typeof body.initial_input === 'string' && body.initial_input.length > 0
        ? body.initial_input
        : typeof body.text === 'string' && body.text.length > 0
          ? body.text
          : null;
    if (!initialInput) {
      return jsonResponse(400, { error: 'invalid-start-body', message: 'start requires initial_input / text' });
    }
    if (!body.auth_snapshot || typeof body.auth_snapshot.sub !== 'string' || body.auth_snapshot.sub.length === 0) {
      return jsonResponse(400, { error: 'invalid-auth-snapshot', message: 'auth_snapshot.sub is required' });
    }

    // ZX1-ZX2 review (Kimi R6 / GPT R5): /me/sessions mints a UUID and the
    // first /sessions/{id}/start owns it; any subsequent start on the same
    // UUID must 409 instead of silently overwriting the active session or
    // restarting a terminal one. Mint a fresh UUID for a new run.
    const existingEntry = await this.get<SessionEntry>(sessionKey(sessionUuid));
    if (existingEntry) {
      return jsonResponse(409, {
        error: 'session-already-started',
        message: `session ${sessionUuid} already exists in state '${existingEntry.status}'; mint a new UUID via POST /me/sessions to run again`,
        session_uuid: sessionUuid,
        current_status: existingEntry.status,
        ...(existingEntry.last_phase ? { last_phase: existingEntry.last_phase } : {}),
      });
    }

    // ZX4 P3-06 — D1-aware pre-flight. mint() wrote a 'pending' D1 row
    // before any KV entry existed; we accept that as the legitimate start
    // path. But 'expired' / 'ended' D1 rows must reject — KV is empty
    // because either alarm GC fired or cleanup already ran, NOT because
    // this is a fresh UUID.
    const durableStatus = await this.sessionTruth()?.readSessionStatus(sessionUuid);
    if (durableStatus === 'expired') {
      return jsonResponse(409, {
        error: 'session-expired',
        message: `session ${sessionUuid} expired (24h pending TTL); mint a new UUID via POST /me/sessions`,
        session_uuid: sessionUuid,
        current_status: 'expired',
      });
    }
    if (durableStatus === 'ended') {
      return jsonResponse(409, {
        error: 'session-already-started',
        message: `session ${sessionUuid} already ended; mint a new UUID via POST /me/sessions`,
        session_uuid: sessionUuid,
        current_status: 'ended',
      });
    }

    const traceUuid = typeof body.trace_uuid === 'string' ? body.trace_uuid : crypto.randomUUID();
    const now = new Date().toISOString();
    const startingEntry: SessionEntry = {
      created_at: now,
      last_seen_at: now,
      status: 'starting',
      last_phase: null,
      relay_cursor: -1,
      ended_at: null,
    };

    // ZX5 F4 — idempotency claim BEFORE side-effects.
    // Per Q11 owner-frozen修法 (b): D1 conditional UPDATE WHERE pending.
    // Concurrent /start retries on the same UUID will all reach this point
    // (KV starts empty + readSessionStatus 'pending'). The first to land
    // the UPDATE flips D1 'pending' → 'starting'; the rest see changes=0
    // and return 409 immediately, avoiding double-write of KV / duplicate
    // DurableSessionStart side-effects (turn / message / activity rows).
    if (durableStatus === 'pending') {
      const claimed = (await this.sessionTruth()?.claimPendingForStart(sessionUuid)) ?? true;
      if (!claimed) {
        return jsonResponse(409, {
          error: 'session-already-started',
          message: `session ${sessionUuid} already claimed by a concurrent /start; mint a new UUID via POST /me/sessions`,
          session_uuid: sessionUuid,
          current_status: 'starting',
        });
      }
    }

    await this.refreshUserState(body.auth_snapshot, body.initial_context_seed);
    await this.put(sessionKey(sessionUuid), startingEntry);
    const durablePointer = await this.ensureDurableSession(
      sessionUuid,
      body.auth_snapshot,
      traceUuid,
      now,
    );
    // ZX4 P3-06 — explicit pending → starting transition once the row is
    // committed to be the active run. Before this line the D1 row may still
    // read 'pending' (mint inserted it; ensureDurableSession's INSERT OR
    // IGNORE leaves the existing row untouched). updateSessionState on the
    // success path moves it onward to 'active'/'detached'.
    if (durableStatus === 'pending') {
      await this.sessionTruth()?.updateSessionState({
        session_uuid: sessionUuid,
        status: 'starting',
        last_phase: null,
        touched_at: now,
      });
    }
    const durableTurn = await this.createDurableTurn(
      sessionUuid,
      durablePointer,
      body.auth_snapshot,
      traceUuid,
      'start',
      initialInput,
      now,
    );
    await this.recordUserMessage(
      sessionUuid,
      durablePointer,
      body.auth_snapshot,
      traceUuid,
      durableTurn,
      'user.input',
      { text: initialInput },
      now,
    );
    if (body.initial_context !== undefined) {
      await this.recordContextSnapshot(
        sessionUuid,
        durablePointer,
        durableTurn,
        body.auth_snapshot,
        traceUuid,
        body.initial_context,
        now,
      );
    }
    await this.appendDurableActivity({
      pointer: durablePointer,
      authSnapshot: body.auth_snapshot,
      traceUuid,
      turnUuid: durableTurn?.turn_uuid,
      eventKind: 'session.start.request',
      severity: 'info',
      payload: { initial_input: initialInput },
      timestamp: now,
    });

    const startAck = await this.forwardStart(sessionUuid, {
      initial_input: initialInput,
      ...(body.initial_context !== undefined ? { initial_context: body.initial_context } : {}),
      ...(typeof body.trace_uuid === 'string' ? { trace_uuid: body.trace_uuid } : {}),
      authority: body.auth_snapshot,
    });
    if (!startAck.response.ok) {
      await this.delete(sessionKey(sessionUuid));
      if (durablePointer) {
        await this.sessionTruth()?.rollbackSessionStart({
          session_uuid: sessionUuid,
          conversation_uuid: durablePointer.conversation_uuid,
          delete_conversation: durablePointer.conversation_created,
        });
      }
      await this.appendDurableActivity({
        pointer: durablePointer?.conversation_created ? null : durablePointer,
        authSnapshot: body.auth_snapshot,
        traceUuid,
        turnUuid: null,
        eventKind: 'session.start.failed',
        severity: 'error',
        payload: startAck.body ?? { error: 'agent-start-failed' },
        timestamp: new Date().toISOString(),
      });
      return jsonResponse(startAck.response.status, {
        error: 'agent-start-failed',
        message: 'agent-core internal start failed',
        start_ack: startAck.body,
      });
    }

    const stream = await this.readInternalStream(sessionUuid);
    if (!stream.ok) return stream.response;
    const frames = stream.frames;
    let entry: SessionEntry = {
      ...startingEntry,
      last_seen_at: new Date().toISOString(),
      last_phase: extractPhase(startAck.body),
      status: this.attachments.has(sessionUuid) ? 'active' : 'detached',
    };
    await this.put(sessionKey(sessionUuid), entry);
    await this.sessionTruth()?.updateSessionState({
      session_uuid: sessionUuid,
      status: entry.status,
      last_phase: entry.last_phase,
      touched_at: entry.last_seen_at,
    });
    entry = await this.forwardFramesToAttachment(sessionUuid, entry, frames);
    await this.recordStreamFrames(
      sessionUuid,
      durablePointer,
      body.auth_snapshot,
      traceUuid,
      durableTurn,
      frames,
      entry.last_seen_at,
    );
    await this.updateConversationIndex(durablePointer, entry);
    await this.updateActivePointers(durablePointer, durableTurn);

    const firstEvent =
      frames.find((frame): frame is Extract<StreamFrame, { kind: 'event' }> => frame.kind === 'event') ?? null;
    const terminal =
      frames.find((frame): frame is Extract<StreamFrame, { kind: 'terminal' }> => frame.kind === 'terminal') ?? null;
    if (durableTurn) {
      await this.sessionTruth()?.closeTurn({
        turn_uuid: durableTurn.turn_uuid,
        status:
          terminal?.terminal === 'cancelled'
            ? 'cancelled'
            : terminal?.terminal === 'error'
              ? 'failed'
              : 'completed',
        ended_at: new Date().toISOString(),
      });
    }

    return jsonResponse(200, {
      ok: true,
      action: 'start',
      session_uuid: sessionUuid,
      user_uuid: body.auth_snapshot.sub,
      last_phase: entry.last_phase,
      status: entry.status,
      relay_cursor: entry.relay_cursor,
      first_event: firstEvent?.payload ?? null,
      terminal: null,
      start_ack: startAck.body,
    });
  }

  // ZX5 review fix (deepseek R3 / kimi R5 / Q8 owner direction):
  // /input is now a thin compatibility alias. It validates `{text}` (preserving
  // its historical 400 `invalid-input-body` shape for upstream callers) and
  // normalizes the body into the /messages multipart shape `parts: [{kind:
  // 'text', text}]` before delegating to handleMessages. Single 落库 path,
  // single agent-core forward, single message_kind taxonomy.
  private async handleInput(sessionUuid: string, body: FollowupBody): Promise<Response> {
    if (typeof body.text !== 'string' || body.text.length === 0) {
      return jsonResponse(400, { error: 'invalid-input-body', message: 'input requires non-empty text' });
    }
    const messagesBody: Record<string, unknown> = {
      parts: [{ kind: 'text', text: body.text }],
      ...(body.auth_snapshot ? { auth_snapshot: body.auth_snapshot } : {}),
      ...(body.initial_context_seed ? { initial_context_seed: body.initial_context_seed } : {}),
      ...(typeof body.trace_uuid === 'string' ? { trace_uuid: body.trace_uuid } : {}),
      ...(body.context_ref !== undefined ? { context_ref: body.context_ref } : {}),
      ...(body.stream_seq !== undefined ? { stream_seq: body.stream_seq } : {}),
      // mark origin so downstream observability can still tell /input apart
      // from /messages without splitting落库 path.
      _origin: 'input',
    };
    return this.handleMessages(sessionUuid, messagesBody);
  }

  private async handleCancel(sessionUuid: string, body: CancelBody): Promise<Response> {
    const entry = await this.requireSession(sessionUuid);
    if (!entry) return this.sessionGateMiss(sessionUuid);
    if (entry.status === 'ended') return sessionTerminalResponse(sessionUuid, await this.getTerminal(sessionUuid));
    if (body.auth_snapshot) await this.refreshUserState(body.auth_snapshot, body.initial_context_seed);
    const authSnapshot =
      body.auth_snapshot ??
      (await this.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY));
    if (!authSnapshot) {
      return jsonResponse(400, { error: 'missing-authority', message: 'cancel requires persisted auth snapshot' });
    }
    const traceUuid = typeof body.trace_uuid === 'string' ? body.trace_uuid : crypto.randomUUID();
    const now = new Date().toISOString();
    const durablePointer = await this.ensureDurableSession(sessionUuid, authSnapshot, traceUuid, now);
    const durableTurn = await this.createDurableTurn(
      sessionUuid,
      durablePointer,
      authSnapshot,
      traceUuid,
      'cancel',
      typeof body.reason === 'string' ? body.reason : null,
      now,
    );
    await this.recordUserMessage(
      sessionUuid,
      durablePointer,
      authSnapshot,
      traceUuid,
      durableTurn,
      'user.cancel',
      typeof body.reason === 'string' ? { reason: body.reason } : { reason: 'cancel' },
      now,
    );

    // ZX4 Phase 9 — RPC-only forward for cancel (post P3-05 flip).
    const cancelAck = await this.forwardInternalJsonShadow(
      sessionUuid,
      'cancel',
      {
        ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
        ...(typeof body.trace_uuid === 'string' ? { trace_uuid: body.trace_uuid } : {}),
        ...(body.auth_snapshot ? { authority: body.auth_snapshot } : {}),
      },
      'cancel',
    );
    if (!cancelAck.response.ok) {
      return this.cloneJsonResponse(cancelAck.response.status, cancelAck.body);
    }

    const terminal: SessionTerminalRecord = {
      terminal: 'cancelled',
      last_phase: extractPhase(cancelAck.body) ?? entry.last_phase,
      ended_at: now,
    };
    const nextEntry: SessionEntry = {
      ...entry,
      last_seen_at: now,
      status: 'ended',
      last_phase: terminal.last_phase,
      ended_at: now,
    };

    await this.put(sessionKey(sessionUuid), nextEntry);
    await this.put(terminalKey(sessionUuid), terminal);
    await this.sessionTruth()?.updateSessionState({
      session_uuid: sessionUuid,
      status: 'ended',
      last_phase: terminal.last_phase,
      touched_at: now,
      ended_at: now,
    });
    if (durableTurn) {
      await this.sessionTruth()?.closeTurn({
        turn_uuid: durableTurn.turn_uuid,
        status: 'cancelled',
        ended_at: now,
      });
    }
    await this.appendDurableActivity({
      pointer: durablePointer,
      authSnapshot,
      traceUuid,
      turnUuid: durableTurn?.turn_uuid,
      eventKind: 'session.cancelled',
      severity: 'info',
      payload: cancelAck.body ?? { reason: body.reason ?? 'cancel' },
      timestamp: now,
    });
    await this.rememberEndedSession(sessionUuid, now);
    await this.cleanupEndedSessions();
    await this.notifyTerminal(sessionUuid, terminal);
    await this.updateConversationIndex(durablePointer, nextEntry);
    await this.updateActivePointers(durablePointer, null);

    return jsonResponse(cancelAck.response.status, {
      ...(cancelAck.body ?? { ok: true, action: 'cancel' }),
      session_uuid: sessionUuid,
      session_status: nextEntry.status,
      terminal: terminal.terminal,
    });
  }

  private async handleVerify(sessionUuid: string, body: VerifyBody): Promise<Response> {
    const entry = await this.requireSession(sessionUuid);
    if (!entry) return this.sessionGateMiss(sessionUuid);
    if (body.auth_snapshot) await this.refreshUserState(body.auth_snapshot, body.initial_context_seed);
    // ZX4 Phase 9 — RPC-only forward for verify (post P3-05 flip).
    const verifyAck = await this.forwardInternalJsonShadow(
      sessionUuid,
      'verify',
      body as unknown as Record<string, unknown>,
      'verify',
    );
    const response = verifyAck.response;
    const proxied = await this.proxyReadResponse(sessionUuid, entry, response);
    const durable_truth = await this.readDurableSnapshot(sessionUuid);
    const bodyJson = await readJson(proxied.clone());
    const nextBody = !durable_truth
      ? bodyJson
      : {
      ...(bodyJson ?? {}),
      durable_truth,
    };
    await this.rememberCache(`verify:${sessionUuid}`, nextBody ?? null);
    return this.cloneJsonResponse(proxied.status, nextBody ?? null);
  }

  private async handleRead(sessionUuid: string, action: 'status' | 'timeline' | 'history'): Promise<Response> {
    const entry = await this.requireReadableSession(sessionUuid);
    if (!entry) return this.sessionGateMiss(sessionUuid);
    if (action === 'history') {
      await this.touchSession(sessionUuid, entry.status);
      const messages = await this.readDurableHistory(sessionUuid);
      return jsonResponse(200, {
        ok: true,
        action: 'history',
        session_uuid: sessionUuid,
        messages,
      });
    }
    if (action === 'timeline') {
      const events = await this.readDurableTimeline(sessionUuid);
      if (events.length > 0) {
        await this.touchSession(sessionUuid, entry.status);
        return jsonResponse(200, {
          ok: true,
          action: 'timeline',
          session_uuid: sessionUuid,
          events,
        });
      }
    }
    if (action === 'status') {
      const durable_truth = await this.readDurableSnapshot(sessionUuid);
      const response = await this.forwardStatus(sessionUuid);
      const proxied = await this.proxyReadResponse(sessionUuid, entry, response);
      const bodyJson = await readJson(proxied.clone());
      const nextBody = !durable_truth
        ? bodyJson
        : {
        ...(bodyJson ?? {}),
        durable_truth,
      };
      await this.rememberCache(`status:${sessionUuid}`, nextBody ?? null);
      return this.cloneJsonResponse(proxied.status, nextBody ?? null);
    }
    // ZX2 Phase 3 P3-01 — timeline (and history) reads run parity when an
    // RPC binding is available; status went through forwardStatus above.
    if (action === 'timeline') {
      const timelineAck = await this.forwardInternalJsonShadow(
        sessionUuid,
        'timeline',
        undefined,
        'timeline',
      );
      return this.proxyReadResponse(sessionUuid, entry, timelineAck.response);
    }
    const response = await this.forwardInternalRaw(sessionUuid, action);
    return this.proxyReadResponse(sessionUuid, entry, response);
  }

  // ZX2 Phase 5 P5-03 — helper that emits a server→client WS frame to
  // the currently-attached socket if any. Used by future plumbing
  // (e.g. permission gate triggered by agent-core hooks) to push:
  //   - session.permission.request
  //   - session.usage.update
  //   - session.elicitation.request
  // The wire shape stays the lightweight `{kind, ...}` per ZX2 P4-04.
  // Returns true if a frame was queued, false if no client is attached.
  emitServerFrame(sessionUuid: string, frame: { kind: string; [k: string]: unknown }): boolean {
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
    const entry = await this.requireReadableSession(sessionUuid);
    if (!entry) return this.sessionGateMiss(sessionUuid);
    const durable = await this.readDurableSnapshot(sessionUuid);
    const repo = this.sessionTruth();
    let usage: Record<string, unknown> = {
      llm_input_tokens: null,
      llm_output_tokens: null,
      tool_calls: null,
      subrequest_used: null,
      subrequest_budget: null,
      estimated_cost_usd: null,
    };
    if (repo && durable?.team_uuid) {
      try {
        const live = await repo.readUsageSnapshot({
          session_uuid: sessionUuid,
          team_uuid: durable.team_uuid,
        });
        if (live) usage = live as unknown as Record<string, unknown>;
      } catch (error) {
        console.warn(
          `usage-d1-read-failed session=${sessionUuid}`,
          { tag: 'usage-d1-read-failed', error: String(error) },
        );
      }
    }
    return jsonResponse(200, {
      ok: true,
      data: {
        session_uuid: sessionUuid,
        status: entry.status,
        usage,
        last_seen_at: entry.last_seen_at,
        durable_truth: durable ?? null,
      },
    });
  }

  // ZX2 Phase 5 P5-01 — explicit resume ack. Companion to the WS
  // `?last_seen_seq=` query path; this HTTP variant lets clients tell
  // the server "I'm coming back" without opening WS first.
  private async handleResume(
    sessionUuid: string,
    request: Request,
  ): Promise<Response> {
    const entry = await this.requireReadableSession(sessionUuid);
    if (!entry) return this.sessionGateMiss(sessionUuid);
    const body = (await request.json().catch(() => ({}))) as {
      last_seen_seq?: number;
    };
    const acknowledged = entry.relay_cursor;
    return jsonResponse(200, {
      ok: true,
      data: {
        session_uuid: sessionUuid,
        status: entry.status,
        last_phase: entry.last_phase,
        relay_cursor: acknowledged,
        // If the client was further behind than what we have, signal
        // they need to reconcile via timeline read.
        replay_lost: typeof body.last_seen_seq === 'number' && body.last_seen_seq > acknowledged,
      },
    });
  }

  // ZX2 Phase 5 P5-01 / P5-03 — record a permission decision. Real
  // permission round-trip lives on the WS path; this HTTP endpoint is
  // the mirror so clients without an active WS can still respond.
  private async handlePermissionDecision(
    sessionUuid: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const requestUuid = body.request_uuid;
    const decision = body.decision;
    const scope = typeof body.scope === 'string' ? body.scope : 'once';
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof requestUuid !== 'string' || !uuidRe.test(requestUuid)) {
      return jsonResponse(400, {
        error: 'invalid-input',
        message: 'permission/decision requires a UUID request_uuid',
      });
    }
    if (
      decision !== 'allow' &&
      decision !== 'deny' &&
      decision !== 'always_allow' &&
      decision !== 'always_deny'
    ) {
      return jsonResponse(400, {
        error: 'invalid-input',
        message: 'decision must be allow|deny|always_allow|always_deny',
      });
    }
    // For ZX2 we record the decision in the hot index; the live
    // round-trip with the running turn is plumbed once nacp-session
    // permission frames are wired through agent-core (P5-03 server-side).
    await this.put(`permission_decision/${requestUuid}`, {
      session_uuid: sessionUuid,
      request_uuid: requestUuid,
      decision,
      scope,
      decided_at: new Date().toISOString(),
    });

    // ZX4 P4-01 — forward the decision to agent-core so the runtime DO
    // can resolve a waiting PermissionRequest. Best-effort: missing RPC
    // binding, missing authority, or RPC failure does not break the
    // user-facing 200 ack — the KV record above stays as the fallback
    // contract for future kernel polling.
    const rpcDecision = this.env.AGENT_CORE?.permissionDecision;
    const authority = await this.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY);
    if (typeof rpcDecision === 'function' && authority) {
      try {
        await rpcDecision(
          {
            session_uuid: sessionUuid,
            request_uuid: requestUuid,
            decision,
            scope,
          },
          {
            trace_uuid: crypto.randomUUID(),
            authority,
          },
        );
      } catch (error) {
        console.warn(
          `permission-decision-forward-failed session=${sessionUuid} request=${requestUuid}`,
          { tag: 'permission-decision-forward-failed', error: String(error) },
        );
      }
    }

    return jsonResponse(200, {
      ok: true,
      data: { request_uuid: requestUuid, decision, scope },
    });
  }

  // ZX4 Phase 6 P6-01 — elicitation answer ingress. Mirror of
  // handlePermissionDecision: store locally + forward to agent-core via
  // RPC so the runtime DO has the answer keyed by request_uuid.
  private async handleElicitationAnswer(
    sessionUuid: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const requestUuid = body.request_uuid;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (typeof requestUuid !== 'string' || !uuidRe.test(requestUuid)) {
      return jsonResponse(400, {
        error: 'invalid-input',
        message: 'elicitation/answer requires a UUID request_uuid',
      });
    }
    const answer = body.answer;
    if (answer === undefined) {
      return jsonResponse(400, {
        error: 'invalid-input',
        message: 'elicitation/answer requires an answer field',
      });
    }
    await this.put(`elicitation_answer/${requestUuid}`, {
      session_uuid: sessionUuid,
      request_uuid: requestUuid,
      answer,
      decided_at: new Date().toISOString(),
    });

    const rpc = this.env.AGENT_CORE?.elicitationAnswer;
    const authority = await this.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY);
    if (typeof rpc === 'function' && authority) {
      try {
        await rpc(
          {
            session_uuid: sessionUuid,
            request_uuid: requestUuid,
            answer,
          },
          {
            trace_uuid: crypto.randomUUID(),
            authority,
          },
        );
      } catch (error) {
        console.warn(
          `elicitation-answer-forward-failed session=${sessionUuid} request=${requestUuid}`,
          { tag: 'elicitation-answer-forward-failed', error: String(error) },
        );
      }
    }

    return jsonResponse(200, {
      ok: true,
      data: { request_uuid: requestUuid, answer },
    });
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
    // ingress guard:与 input/cancel/verify 同一族 — KV miss + D1 pending → 409
    const entry = await this.requireSession(sessionUuid);
    if (!entry) return this.sessionGateMiss(sessionUuid);
    if (entry.status === 'ended') {
      return sessionTerminalResponse(sessionUuid, await this.getTerminal(sessionUuid));
    }

    // parse parts
    const partsRaw = body.parts;
    if (!Array.isArray(partsRaw) || partsRaw.length === 0) {
      return jsonResponse(400, {
        error: 'invalid-input',
        message: 'messages requires non-empty parts[] array',
      });
    }
    const parts: Array<{
      kind: 'text' | 'artifact_ref';
      text?: string;
      artifact_uuid?: string;
      mime?: string;
      summary?: string;
    }> = [];
    for (const raw of partsRaw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return jsonResponse(400, { error: 'invalid-input', message: 'each part must be an object' });
      }
      const part = raw as Record<string, unknown>;
      if (part.kind === 'text') {
        if (typeof part.text !== 'string' || part.text.length === 0) {
          return jsonResponse(400, { error: 'invalid-input', message: 'text part requires non-empty text' });
        }
        parts.push({ kind: 'text', text: part.text });
        continue;
      }
      if (part.kind === 'artifact_ref') {
        if (typeof part.artifact_uuid !== 'string' || part.artifact_uuid.length === 0) {
          return jsonResponse(400, { error: 'invalid-input', message: 'artifact_ref part requires artifact_uuid' });
        }
        parts.push({
          kind: 'artifact_ref',
          artifact_uuid: part.artifact_uuid,
          ...(typeof part.mime === 'string' ? { mime: part.mime } : {}),
          ...(typeof part.summary === 'string' ? { summary: part.summary } : {}),
        });
        continue;
      }
      return jsonResponse(400, {
        error: 'invalid-input',
        message: `unsupported part kind '${String(part.kind)}'; expected 'text' | 'artifact_ref'`,
      });
    }

    const authSnapshot = isAuthSnapshot(body.auth_snapshot)
      ? body.auth_snapshot
      : (await this.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY));
    if (!authSnapshot) {
      return jsonResponse(400, {
        error: 'missing-authority',
        message: 'messages requires persisted auth snapshot',
      });
    }
    if (body.auth_snapshot) {
      await this.refreshUserState(
        body.auth_snapshot as IngressAuthSnapshot,
        body.initial_context_seed as InitialContextSeed | undefined,
      );
    }
    const traceUuid =
      typeof body.trace_uuid === 'string' ? body.trace_uuid : crypto.randomUUID();
    const now = new Date().toISOString();

    // 同一 nano_conversation_messages 表 + message_kind source tag 区分:
    //   - 'user.input.text'      = single text part (alias-equivalent to /input)
    //   - 'user.input.multipart' = any part list with > 1 part or non-text
    const isMultipart = parts.length > 1 || parts.some((p) => p.kind !== 'text');
    const messageKind = isMultipart ? 'user.input.multipart' : 'user.input.text';

    const durablePointer = await this.ensureDurableSession(sessionUuid, authSnapshot, traceUuid, now);
    const durableTurn = await this.createDurableTurn(
      sessionUuid,
      durablePointer,
      authSnapshot,
      traceUuid,
      'followup',
      isMultipart ? null : (parts[0] as { text: string }).text,
      now,
    );
    await this.recordUserMessage(
      sessionUuid,
      durablePointer,
      authSnapshot,
      traceUuid,
      durableTurn,
      messageKind as 'user.input.text' | 'user.input.multipart',
      { parts },
      now,
    );
    await this.appendDurableActivity({
      pointer: durablePointer,
      authSnapshot,
      traceUuid,
      turnUuid: durableTurn?.turn_uuid,
      eventKind: 'session.message.append',
      severity: 'info',
      payload: { message_kind: messageKind, part_count: parts.length },
      timestamp: now,
    });

    // ZX5 review fix (deepseek R1 / GLM R1 / GPT R1 / kimi R5):
    // /messages must drive the agent-runtime, not just write D1. Reduce parts
    // to a `text` representation for the existing agent-core 'input' RPC
    // (per turn-ingress.ts session.followup_input.text contract) — text parts
    // join with newlines, artifact_ref parts surface as `[artifact:<uuid>]`
    // placeholders so the agent kernel sees the multipart shape end-to-end.
    // The richer `parts` array is also passed through for future agent-core
    // multipart consumption without another protocol cut.
    const combinedText = parts
      .map((p) =>
        p.kind === 'text'
          ? (p.text ?? '')
          : `[artifact:${p.artifact_uuid}${p.summary ? `|${p.summary}` : ''}]`,
      )
      .filter((s) => s.length > 0)
      .join('\n');
    const inputAck = await this.forwardInternalJsonShadow(
      sessionUuid,
      'input',
      {
        text: combinedText,
        parts,
        message_kind: messageKind,
        ...(body.context_ref !== undefined ? { context_ref: body.context_ref } : {}),
        ...(typeof body.stream_seq === 'number' ? { stream_seq: body.stream_seq } : {}),
        ...(typeof body.trace_uuid === 'string' ? { trace_uuid: body.trace_uuid } : {}),
        authority: authSnapshot,
      },
      'input',
    );
    if (!inputAck.response.ok) {
      if (durableTurn) {
        await this.sessionTruth()?.closeTurn({
          turn_uuid: durableTurn.turn_uuid,
          status: 'failed',
          ended_at: new Date().toISOString(),
        });
      }
      return this.cloneJsonResponse(inputAck.response.status, inputAck.body);
    }

    const stream = await this.readInternalStream(sessionUuid);
    if (!stream.ok) return stream.response;
    const frames = stream.frames;
    let nextEntry: SessionEntry = {
      ...entry,
      last_seen_at: new Date().toISOString(),
      last_phase: extractPhase(inputAck.body) ?? entry.last_phase,
      status: this.attachments.has(sessionUuid) ? 'active' : 'detached',
      ended_at: null,
    };
    await this.put(sessionKey(sessionUuid), nextEntry);
    await this.sessionTruth()?.updateSessionState({
      session_uuid: sessionUuid,
      status: nextEntry.status,
      last_phase: nextEntry.last_phase,
      touched_at: nextEntry.last_seen_at,
    });
    nextEntry = await this.forwardFramesToAttachment(sessionUuid, nextEntry, frames);
    await this.recordStreamFrames(
      sessionUuid,
      durablePointer,
      authSnapshot,
      traceUuid,
      durableTurn,
      frames,
      nextEntry.last_seen_at,
    );
    await this.updateConversationIndex(durablePointer, nextEntry);
    await this.updateActivePointers(durablePointer, durableTurn);
    if (durableTurn) {
      const terminal =
        frames.find((frame): frame is Extract<StreamFrame, { kind: 'terminal' }> => frame.kind === 'terminal') ?? null;
      await this.sessionTruth()?.closeTurn({
        turn_uuid: durableTurn.turn_uuid,
        status:
          terminal?.terminal === 'cancelled'
            ? 'cancelled'
            : terminal?.terminal === 'error'
              ? 'failed'
              : 'completed',
        ended_at: new Date().toISOString(),
      });
    }

    const action = body._origin === 'input' ? 'input' : 'messages';
    return jsonResponse(inputAck.response.status, {
      ...(inputAck.body ?? { ok: true, action }),
      action,
      session_uuid: sessionUuid,
      session_status: nextEntry.status,
      relay_cursor: nextEntry.relay_cursor,
      message_kind: messageKind,
      part_count: parts.length,
      turn_uuid: durableTurn?.turn_uuid ?? null,
    });
  }

  // ZX5 Lane D D4 — GET /sessions/{id}/files.
  // 当前 6 worker 都没有 R2 binding(deepseek R8 已点出);本期实现仅
  // 从 `nano_conversation_messages.body_json` 中扫 artifact_ref(D3 落的
  // 多模态 part)+ context snapshots,返 list。**真正的 R2 拉取需 owner
  // 创建 R2 bucket + binding 后扩展**;当前 endpoint 返 list 而不返 bytes。
  private async handleFiles(sessionUuid: string): Promise<Response> {
    const entry = await this.requireReadableSession(sessionUuid);
    if (!entry) return this.sessionGateMiss(sessionUuid);

    const repo = this.sessionTruth();
    if (!repo) {
      return jsonResponse(200, {
        ok: true,
        action: 'files',
        session_uuid: sessionUuid,
        files: [],
      });
    }
    const messages = await repo.readHistory(sessionUuid);
    const files: Array<{
      message_uuid: string;
      turn_uuid: string | null;
      message_kind: string;
      artifact_uuid: string;
      mime: string | null;
      summary: string | null;
      created_at: string;
    }> = [];
    for (const msg of messages) {
      const body = msg.body as { parts?: Array<{ kind?: string; artifact_uuid?: string; mime?: string; summary?: string }> };
      if (!Array.isArray(body?.parts)) continue;
      for (const part of body.parts) {
        if (part.kind === 'artifact_ref' && typeof part.artifact_uuid === 'string') {
          files.push({
            message_uuid: msg.message_uuid,
            turn_uuid: msg.turn_uuid,
            message_kind: msg.kind,
            artifact_uuid: part.artifact_uuid,
            mime: typeof part.mime === 'string' ? part.mime : null,
            summary: typeof part.summary === 'string' ? part.summary : null,
            created_at: msg.created_at,
          });
        }
      }
    }
    return jsonResponse(200, {
      ok: true,
      action: 'files',
      session_uuid: sessionUuid,
      files,
      // 若未来加 R2 binding,可在 envelope 里加 `download_url` field;
      // 当前仅返 metadata,前端用 artifact_uuid 构造 R2 path。
    });
  }

  private async handlePolicyPermissionMode(
    sessionUuid: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const mode = body.mode;
    if (
      mode !== 'auto-allow' &&
      mode !== 'ask' &&
      mode !== 'deny' &&
      mode !== 'always_allow'
    ) {
      return jsonResponse(400, {
        error: 'invalid-input',
        message: 'mode must be auto-allow|ask|deny|always_allow',
      });
    }
    await this.put(`permission_mode/${sessionUuid}`, {
      session_uuid: sessionUuid,
      mode,
      set_at: new Date().toISOString(),
    });
    return jsonResponse(200, {
      ok: true,
      data: { session_uuid: sessionUuid, mode },
    });
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
    const conversations = (await this.get<ConversationIndexItem[]>(CONVERSATION_INDEX_KEY)) ?? [];
    type Item = {
      conversation_uuid: string;
      session_uuid: string;
      status: string;
      last_phase: string | null;
      last_seen_at: string;
      created_at: string | null;
      ended_at: string | null;
    };
    const bySessionUuid = new Map<string, Item>();
    for (const conv of conversations) {
      const entry = await this.get<SessionEntry>(sessionKey(conv.latest_session_uuid));
      bySessionUuid.set(conv.latest_session_uuid, {
        conversation_uuid: conv.conversation_uuid,
        session_uuid: conv.latest_session_uuid,
        status: entry?.status ?? conv.status,
        last_phase: entry?.last_phase ?? null,
        last_seen_at: entry?.last_seen_at ?? conv.updated_at,
        created_at: entry?.created_at ?? null,
        ended_at: entry?.ended_at ?? null,
      });
    }

    const repo = this.sessionTruth();
    const authority = await this.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY);
    if (repo && authority) {
      const teamUuid = authority.team_uuid ?? authority.tenant_uuid;
      const actorUserUuid = authority.user_uuid ?? authority.sub;
      if (typeof teamUuid === 'string' && teamUuid.length > 0) {
        try {
          const rows = await repo.listSessionsForUser({
            team_uuid: teamUuid,
            actor_user_uuid: actorUserUuid,
            limit: 50,
          });
          for (const row of rows) {
            const existing = bySessionUuid.get(row.session_uuid);
            // D1 status wins — KV may carry a stale 'detached' for what
            // D1 already moved to 'expired' via alarm GC.
            bySessionUuid.set(row.session_uuid, {
              conversation_uuid: row.conversation_uuid,
              session_uuid: row.session_uuid,
              status: row.session_status,
              last_phase: row.last_phase ?? existing?.last_phase ?? null,
              last_seen_at: existing?.last_seen_at ?? row.started_at,
              created_at: row.started_at,
              ended_at: row.ended_at ?? existing?.ended_at ?? null,
            });
          }
        } catch (error) {
          console.warn(
            'me-sessions-d1-merge-failed',
            { tag: 'me-sessions-d1-merge-failed', error: String(error) },
          );
        }
      }
    }

    const items = Array.from(bySessionUuid.values()).sort((a, b) =>
      (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? ''),
    );
    return jsonResponse(200, {
      ok: true,
      data: { sessions: items, next_cursor: null },
    });
  }

  // ZX5 Lane D D5 — GET /me/conversations.
  // Per Q5 owner direction:仅复用现有 D1 truth(`nano_conversation_sessions`),
  // 不新建平行表。Group session by conversation_uuid → 每 conversation 一行。
  private async handleMeConversations(
    limit: number,
    headerAuthority?: IngressAuthSnapshot | null,
  ): Promise<Response> {
    const repo = this.sessionTruth();
    const authority =
      headerAuthority ?? (await this.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY));
    if (!repo || !authority) {
      return jsonResponse(200, {
        ok: true,
        data: { conversations: [], next_cursor: null },
      });
    }
    const teamUuid = authority.team_uuid ?? authority.tenant_uuid;
    const actorUserUuid = authority.user_uuid ?? authority.sub;
    if (typeof teamUuid !== 'string' || teamUuid.length === 0) {
      return jsonResponse(200, {
        ok: true,
        data: { conversations: [], next_cursor: null },
      });
    }

    // ZX5 review (GPT R4): `last_seen_at` was an honest name for "latest
    // session.started_at in this conversation"; the field has been renamed to
    // `latest_session_started_at` so client code doesn't conflate it with a
    // real "user activity" timestamp. The legacy key is preserved as an alias
    // for one release to avoid breaking any in-flight client.
    type Conversation = {
      conversation_uuid: string;
      latest_session_uuid: string;
      latest_status: string;
      started_at: string;
      latest_session_started_at: string;
      last_seen_at: string; // legacy alias of latest_session_started_at — to be removed in a future cut
      last_phase: string | null;
      session_count: number;
    };

    let rows: Awaited<ReturnType<typeof repo.listSessionsForUser>> = [];
    try {
      // Pull more rows than `limit` so we can group by conversation;
      // the result still respects `limit` in conversation count after
      // grouping。上限 200(per session-truth.ts listSessionsForUser cap)。
      rows = await repo.listSessionsForUser({
        team_uuid: teamUuid,
        actor_user_uuid: actorUserUuid,
        limit: 200,
      });
    } catch (error) {
      console.warn(
        'me-conversations-d1-read-failed',
        { tag: 'me-conversations-d1-read-failed', error: String(error) },
      );
      return jsonResponse(200, {
        ok: true,
        data: { conversations: [], next_cursor: null },
      });
    }

    const byConv = new Map<string, Conversation>();
    for (const row of rows) {
      const existing = byConv.get(row.conversation_uuid);
      if (!existing) {
        byConv.set(row.conversation_uuid, {
          conversation_uuid: row.conversation_uuid,
          latest_session_uuid: row.session_uuid,
          latest_status: row.session_status,
          started_at: row.started_at,
          latest_session_started_at: row.started_at,
          last_seen_at: row.started_at,
          last_phase: row.last_phase ?? null,
          session_count: 1,
        });
        continue;
      }
      existing.session_count += 1;
      // listSessionsForUser ORDER BY started_at DESC → 第一条是最新的。
      // existing 已是最新,保留 latest_session_started_at = max,update 最早 started_at。
      if (row.started_at < existing.started_at) {
        existing.started_at = row.started_at;
      }
    }

    const conversations = Array.from(byConv.values())
      .sort((a, b) =>
        b.latest_session_started_at.localeCompare(a.latest_session_started_at),
      )
      .slice(0, limit);

    return jsonResponse(200, {
      ok: true,
      data: { conversations, next_cursor: null },
    });
  }

  private async handleWsAttach(sessionUuid: string, request: Request): Promise<Response> {
    const entry = await this.requireReadableSession(sessionUuid);
    if (!entry) return this.sessionGateMiss(sessionUuid);
    if (entry.status === 'ended') return sessionTerminalResponse(sessionUuid, await this.getTerminal(sessionUuid));
    if (!isWebSocketUpgrade(request)) {
      return jsonResponse(400, { error: 'invalid-upgrade', message: 'ws route requires websocket upgrade' });
    }
    const clientLastSeenSeq = parseLastSeenSeq(request);

    const pair = createWebSocketPair();
    if (!pair) {
      return jsonResponse(501, { error: 'websocket-unavailable', message: 'WebSocketPair unavailable' });
    }
    pair.server.accept?.();

    const stream = await this.readInternalStream(sessionUuid);
    if (!stream.ok) return stream.response;

    const current = this.attachments.get(sessionUuid);
    if (current) {
      this.attachments.delete(sessionUuid);
      if (current.heartbeat_timer) clearInterval(current.heartbeat_timer);
      current.socket.send(
        JSON.stringify({
          kind: 'attachment_superseded',
          reason: 'replaced_by_new_attachment',
          new_attachment_at: new Date().toISOString(),
        }),
      );
      current.socket.close(4001, 'attachment_superseded');
    }

    const heartbeatTimer = setInterval(() => {
      const currentAttachment = this.attachments.get(sessionUuid);
      if (!currentAttachment || currentAttachment.socket !== pair.server) {
        clearInterval(heartbeatTimer);
        return;
      }
      pair.server.send(JSON.stringify({
        kind: 'session.heartbeat',
        ts: Date.now(),
      }));
    }, CLIENT_WS_HEARTBEAT_INTERVAL_MS);
    (heartbeatTimer as unknown as { unref?: () => void }).unref?.();

    this.attachments.set(sessionUuid, {
      socket: pair.server,
      attached_at: new Date().toISOString(),
      heartbeat_timer: heartbeatTimer,
    });
    this.bindSocketLifecycle(sessionUuid, pair.server);

    const replayCursor =
      clientLastSeenSeq === null
        ? entry.relay_cursor
        : Math.min(entry.relay_cursor, clientLastSeenSeq);
    const nextEntry: SessionEntry = {
      ...entry,
      last_seen_at: new Date().toISOString(),
      status: 'active',
      relay_cursor: replayCursor,
      ended_at: null,
    };
    await this.put(sessionKey(sessionUuid), nextEntry);
    await this.forwardFramesToAttachment(sessionUuid, nextEntry, stream.frames);

    try {
      return new Response(null, {
        status: 101,
        statusText: 'Switching Protocols',
        // @ts-expect-error Cloudflare-only webSocket init field
        webSocket: pair.client,
      });
    } catch {
      return new Response(null, { status: 200, statusText: 'Switching Protocols' });
    }
  }

  private bindSocketLifecycle(sessionUuid: string, socket: WorkerSocketLike): void {
    socket.addEventListener?.('close', () => {
      const current = this.attachments.get(sessionUuid);
      if (!current || current.socket !== socket) return;
      this.attachments.delete(sessionUuid);
      if (current.heartbeat_timer) clearInterval(current.heartbeat_timer);
      void this.markDetached(sessionUuid);
    });

    socket.addEventListener?.('message', () => {
      void this.touchSession(sessionUuid, this.attachments.has(sessionUuid) ? 'active' : 'detached');
    });
  }

  private async markDetached(sessionUuid: string): Promise<void> {
    const entry = await this.get<SessionEntry>(sessionKey(sessionUuid));
    if (!entry || entry.status === 'ended') return;
    await this.put(sessionKey(sessionUuid), {
      ...entry,
      status: 'detached',
      last_seen_at: new Date().toISOString(),
    } satisfies SessionEntry);
  }

  private async touchSession(sessionUuid: string, status: SessionStatus): Promise<void> {
    const entry = await this.get<SessionEntry>(sessionKey(sessionUuid));
    if (!entry || entry.status === 'ended') return;
    await this.put(sessionKey(sessionUuid), {
      ...entry,
      status,
      last_seen_at: new Date().toISOString(),
    } satisfies SessionEntry);
  }

  private async proxyReadResponse(
    sessionUuid: string,
    entry: SessionEntry,
    response: Response,
  ): Promise<Response> {
    const body = await readJson(response);
    const nextEntry = {
      ...entry,
      last_seen_at: new Date().toISOString(),
      last_phase: extractPhase(body) ?? entry.last_phase,
    } satisfies SessionEntry;
    await this.put(sessionKey(sessionUuid), nextEntry);
    await this.sessionTruth()?.updateSessionState({
      session_uuid: sessionUuid,
      status: nextEntry.status,
      last_phase: nextEntry.last_phase,
      touched_at: nextEntry.last_seen_at,
      ended_at: nextEntry.ended_at,
    });
    return this.cloneJsonResponse(
      response.status,
      body,
      response.headers.get('Content-Type') ?? 'application/json',
    );
  }

  private async forwardFramesToAttachment(
    sessionUuid: string,
    entry: SessionEntry,
    frames: readonly StreamFrame[],
  ): Promise<SessionEntry> {
    const attachment = this.attachments.get(sessionUuid);
    if (!attachment) return entry;

    let cursor = entry.relay_cursor;
    for (const frame of frames) {
      if (frame.kind !== 'event') continue;
      if (frame.seq <= cursor) continue;
      attachment.socket.send(JSON.stringify(frame));
      cursor = frame.seq;
    }

    if (cursor === entry.relay_cursor) return entry;

    const nextEntry: SessionEntry = {
      ...entry,
      relay_cursor: cursor,
      last_seen_at: new Date().toISOString(),
    };
    await this.put(sessionKey(sessionUuid), nextEntry);
    return nextEntry;
  }

  private async notifyTerminal(
    sessionUuid: string,
    terminal: SessionTerminalRecord,
  ): Promise<void> {
    const attachment = this.attachments.get(sessionUuid);
    if (!attachment) return;

    attachment.socket.send(
      JSON.stringify({
        kind: 'terminal',
        terminal: terminal.terminal,
        session_uuid: sessionUuid,
        ...(terminal.last_phase ? { last_phase: terminal.last_phase } : {}),
      }),
    );
    attachment.socket.close(1000, `session_${terminal.terminal}`);
    this.attachments.delete(sessionUuid);
  }

  private async forwardInternalJson(
    sessionUuid: string,
    action: string,
    body?: Record<string, unknown>,
  ): Promise<{ response: Response; body: Record<string, unknown> | null }> {
    const response = await this.forwardInternalRaw(sessionUuid, action, body);
    return { response, body: await readJson(response.clone()) };
  }

  private async forwardInternalRaw(
    sessionUuid: string,
    action: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    if (!this.env.AGENT_CORE) {
      return jsonResponse(503, { error: 'agent-core-unavailable', message: 'AGENT_CORE binding missing' });
    }
    if (!this.env.NANO_INTERNAL_BINDING_SECRET) {
      return jsonResponse(503, { error: 'internal-auth-unconfigured', message: 'internal binding secret missing' });
    }

    const traceUuid =
      typeof body?.trace_uuid === 'string' && body.trace_uuid.length > 0
        ? body.trace_uuid
        : crypto.randomUUID();
    const authority = isAuthSnapshot(body?.authority)
      ? body?.authority
      : await this.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY);
    if (!authority || typeof authority.sub !== 'string' || authority.sub.length === 0) {
      return jsonResponse(400, {
        error: 'missing-authority',
        message: 'internal requests require a persisted auth snapshot',
        session_uuid: sessionUuid,
      });
    }

    const headers = new Headers({
      'x-nano-internal-binding-secret': this.env.NANO_INTERNAL_BINDING_SECRET,
      'x-trace-uuid': traceUuid,
      'x-nano-internal-authority': JSON.stringify(authority),
    });
    if (body) headers.set('content-type', 'application/json');

    return this.env.AGENT_CORE.fetch(
      new Request(`https://agent.internal/internal/sessions/${sessionUuid}/${action}`, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  }

  private async readInternalStream(sessionUuid: string): Promise<StreamReadResult> {
    const response = await this.forwardInternalRaw(sessionUuid, 'stream');
    if (!response.ok) return { ok: false, response };
    try {
      return { ok: true, frames: await readNdjsonFrames(response) };
    } catch (error) {
      if (error instanceof InvalidStreamFrameError) {
        return {
          ok: false,
          response: jsonResponse(502, {
            error: 'invalid-stream-frame',
            message: error.message,
            session_uuid: sessionUuid,
          }),
        };
      }
      throw error;
    }
  }

  private async refreshUserState(
    authSnapshot?: IngressAuthSnapshot,
    seed?: InitialContextSeed,
  ): Promise<void> {
    if (authSnapshot) {
      await this.put(USER_META_KEY, { user_uuid: authSnapshot.sub });
      await this.put(USER_AUTH_SNAPSHOT_KEY, authSnapshot);
    }
    if (seed) await this.put(USER_SEED_KEY, seed);
  }

  private async requireSession(sessionUuid: string): Promise<SessionEntry | null> {
    return (await this.get<SessionEntry>(sessionKey(sessionUuid))) ?? null;
  }

  // ZX4 P3-07 — ingress guard miss path (per R11). When the KV entry is
  // missing AND D1 says the row is 'pending' or 'expired', return a
  // distinct 409 instead of the generic 404 — clients/proxies need to
  // distinguish "you minted but never started" from "this UUID was never
  // minted at all".
  private async sessionGateMiss(sessionUuid: string): Promise<Response> {
    const status = await this.sessionTruth()?.readSessionStatus(sessionUuid);
    if (status === 'pending') {
      return jsonResponse(409, {
        error: 'session-pending-only-start-allowed',
        message: `session ${sessionUuid} is pending; only POST /sessions/{id}/start is allowed before it transitions to active`,
        session_uuid: sessionUuid,
        current_status: 'pending',
      });
    }
    if (status === 'expired') {
      return jsonResponse(409, {
        error: 'session-expired',
        message: `session ${sessionUuid} expired (24h pending TTL); mint a new UUID via POST /me/sessions`,
        session_uuid: sessionUuid,
        current_status: 'expired',
      });
    }
    return sessionMissingResponse(sessionUuid);
  }

  private async getTerminal(sessionUuid: string): Promise<SessionTerminalRecord | null> {
    return (await this.get<SessionTerminalRecord>(terminalKey(sessionUuid))) ?? null;
  }

  private async rememberEndedSession(sessionUuid: string, endedAt: string): Promise<void> {
    const current = (await this.get<EndedIndexItem[]>(ENDED_INDEX_KEY)) ?? [];
    const next = [
      ...current.filter((item) => item.session_uuid !== sessionUuid),
      { session_uuid: sessionUuid, ended_at: endedAt },
    ].sort((a, b) => a.ended_at.localeCompare(b.ended_at));
    await this.put(ENDED_INDEX_KEY, next);
  }

  // ZX4 P3-04 — alarm GC for pending rows older than 24h. Runs on every
  // hot-state alarm tick (every 10 min); cheap when there's nothing to do
  // (single index scan), bounded to 200 rows per tick to avoid alarm
  // overrun. Uses `started_at` per R10 schema-field freeze (NOT created_at).
  private async expireStalePendingSessions(now = Date.now()): Promise<void> {
    const repo = this.sessionTruth();
    if (!repo) return;
    const cutoff = new Date(now - PENDING_TTL_MS).toISOString();
    const nowIso = new Date(now).toISOString();
    try {
      const expired = await repo.expireStalePending({ now: nowIso, cutoff });
      if (expired > 0) {
        console.warn(
          `pending-session-expired-gc count=${expired}`,
          { tag: "pending-session-expired-gc", expired_count: expired, cutoff },
        );
      }
    } catch (error) {
      console.warn(
        "pending-session-expired-gc-failed",
        { tag: "pending-session-expired-gc-failed", error: String(error) },
      );
    }
  }

  private async cleanupEndedSessions(now = Date.now()): Promise<void> {
    const index = (await this.get<EndedIndexItem[]>(ENDED_INDEX_KEY)) ?? [];
    const keptByTime = index.filter((item) => {
      const endedAt = Date.parse(item.ended_at);
      return Number.isFinite(endedAt) && endedAt >= now - ENDED_TTL_MS;
    });
    const kept = keptByTime.slice(-MAX_ENDED_SESSIONS);
    const keepSet = new Set(kept.map((item) => item.session_uuid));

    for (const item of index) {
      if (keepSet.has(item.session_uuid)) continue;
      await this.delete(sessionKey(item.session_uuid));
      await this.delete(terminalKey(item.session_uuid));
    }

    await this.put(ENDED_INDEX_KEY, kept);
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
