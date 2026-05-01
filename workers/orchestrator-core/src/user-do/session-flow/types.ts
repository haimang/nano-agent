import type { IngressAuthSnapshot } from "../../auth.js";
import type { StreamFrame } from "../../parity-bridge.js";
import type {
  SessionEntry,
  SessionTerminalRecord,
} from "../../session-lifecycle.js";
import type {
  D1SessionTruthRepository,
  DurableResolvedModel,
  DurableSessionPointer,
  DurableTurnPointer,
} from "../../session-truth.js";

export type RpcAck = { response: Response; body: Record<string, unknown> | null };

export interface UserDoSessionFlowContext {
  sessionTruth(): D1SessionTruthRepository | null;
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  userAuthSnapshotKey: string;
  readDurableSnapshot(sessionUuid: string): Promise<{
    conversation_uuid: string;
    session_status: SessionEntry["status"];
    last_phase: string | null;
    last_event_seq: number;
    ended_at: string | null;
    started_at: string;
  } | null>;
  readDurableTimeline(sessionUuid: string): Promise<Record<string, unknown>[]>;
  readDurableHistory(
    sessionUuid: string,
  ): Promise<
    Array<{
      message_uuid: string;
      turn_uuid: string | null;
      kind: string;
      body: unknown;
      created_at: string;
    }>
  >;
  rememberCache(name: string, value: Record<string, unknown> | null): Promise<void>;
  updateConversationIndex(
    pointer: DurableSessionPointer | null,
    entry: SessionEntry,
  ): Promise<void>;
  updateActivePointers(
    pointer: DurableSessionPointer | null,
    turn: DurableTurnPointer | null,
  ): Promise<void>;
  refreshUserState(
    authSnapshot?: IngressAuthSnapshot,
    seed?: unknown,
  ): Promise<void>;
  requireAllowedModel(
    authSnapshot: IngressAuthSnapshot,
    modelId: string,
  ): Promise<Response | null>;
  resolveAllowedModel(
    authSnapshot: IngressAuthSnapshot,
    modelId: string,
  ): Promise<DurableResolvedModel | Response>;
  ensureDurableSession(
    sessionUuid: string,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    timestamp: string,
  ): Promise<DurableSessionPointer | null>;
  createDurableTurn(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    kind: "start" | "followup" | "cancel",
    inputText: string | null,
    timestamp: string,
    requestedModel?: {
      readonly model_id: string;
      readonly reasoning_effort: "low" | "medium" | "high" | null;
    } | null,
  ): Promise<DurableTurnPointer | null>;
  recordUserMessage(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    turn: DurableTurnPointer | null,
    kind: "user.input" | "user.cancel" | "user.input.text" | "user.input.multipart",
    payload: Record<string, unknown>,
    timestamp: string,
  ): Promise<void>;
  recordContextSnapshot(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    turn: DurableTurnPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    payload: unknown,
    timestamp: string,
  ): Promise<void>;
  appendDurableActivity(input: {
    readonly pointer: DurableSessionPointer | null;
    readonly authSnapshot: IngressAuthSnapshot;
    readonly traceUuid: string;
    readonly turnUuid?: string | null;
    readonly eventKind: string;
    readonly severity: "info" | "warn" | "error";
    readonly payload: Record<string, unknown>;
    readonly timestamp: string;
  }): Promise<void>;
  recordStreamFrames(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    turn: DurableTurnPointer | null,
    frames: readonly StreamFrame[],
    timestamp: string,
  ): Promise<void>;
  forwardStart(sessionUuid: string, body: Record<string, unknown>): Promise<RpcAck>;
  forwardStatus(sessionUuid: string): Promise<Response>;
  forwardInternalJsonShadow(
    sessionUuid: string,
    action: "input" | "cancel" | "verify" | "timeline",
    body: Record<string, unknown> | undefined,
    rpcMethod: "input" | "cancel" | "verify" | "timeline",
  ): Promise<RpcAck>;
  readInternalStream(
    sessionUuid: string,
  ): Promise<{ ok: true; frames: StreamFrame[] } | { ok: false; response: Response }>;
  requireSession(sessionUuid: string): Promise<SessionEntry | null>;
  requireReadableSession(sessionUuid: string): Promise<SessionEntry | null>;
  sessionGateMiss(sessionUuid: string): Promise<Response>;
  getTerminal(sessionUuid: string): Promise<SessionTerminalRecord | null>;
  enforceSessionDevice(
    sessionUuid: string,
    entry: SessionEntry,
    authSnapshot: IngressAuthSnapshot | null | undefined,
  ): Promise<SessionEntry | Response>;
  notifyTerminal(sessionUuid: string, terminal: SessionTerminalRecord): Promise<void>;
  rememberEndedSession(sessionUuid: string, endedAt: string): Promise<void>;
  cleanupEndedSessions(now?: number): Promise<void>;
  proxyReadResponse(
    sessionUuid: string,
    entry: SessionEntry,
    response: Response,
  ): Promise<Response>;
  cloneJsonResponse(
    status: number,
    body: Record<string, unknown> | null,
    contentType?: string,
  ): Response;
  touchSession(sessionUuid: string, status: SessionEntry["status"]): Promise<void>;
  forwardFramesToAttachment(
    sessionUuid: string,
    entry: SessionEntry,
    frames: readonly StreamFrame[],
  ): Promise<SessionEntry>;
  handleMessages(sessionUuid: string, body: Record<string, unknown>): Promise<Response>;
  attachments: Map<string, unknown>;
}
