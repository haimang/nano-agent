/**
 * @haimang/nacp-session — Session profile of the NACP Protocol Family.
 *
 * Client ↔ session DO WebSocket interaction layer.
 * Provides: message schemas, frame normalize/stamp, replay/ack/heartbeat
 * runtime helpers, unified stream event channel, and adapters.
 */

// ── Version ──
export { NACP_SESSION_VERSION, NACP_SESSION_VERSION_COMPAT, NACP_SESSION_WS_SUBPROTOCOL } from "./version.js";

// ── Errors ──
export { NacpSessionError, SESSION_ERROR_CODES } from "./errors.js";

// ── Type × Direction matrix (1.3) ──
export {
  NACP_SESSION_TYPE_DIRECTION_MATRIX,
  isLegalSessionDirection,
} from "./type-direction-matrix.js";

// ── Upstream context schema (1.3) ──
export { SessionStartInitialContextSchema } from "./upstream-context.js";
export type { SessionStartInitialContext } from "./upstream-context.js";

// ── Messages ──
export {
  SessionStartBodySchema, SessionResumeBodySchema, SessionCancelBodySchema,
  SessionEndBodySchema, SessionStreamAckBodySchema, SessionHeartbeatBodySchema,
  SessionFollowupInputBodySchema,
  SessionMessagePostBodySchema,
  // ZX2 Phase 2 P2-03 — 5 family / 7 message_types
  SessionPermissionDecisionEnumSchema,
  SessionPermissionScopeEnumSchema,
  SessionPermissionRequestBodySchema,
  SessionPermissionDecisionBodySchema,
  SessionUsageUpdateBodySchema,
  SessionSkillInvokeBodySchema,
  SessionCommandInvokeBodySchema,
  SessionElicitationRequestBodySchema,
  SessionElicitationAnswerBodySchema,
  SESSION_BODY_SCHEMAS, SESSION_BODY_REQUIRED, SESSION_MESSAGE_TYPES,
} from "./messages.js";
export type {
  SessionStartBody, SessionResumeBody, SessionCancelBody,
  SessionEndBody, SessionStreamAckBody, SessionHeartbeatBody,
  SessionFollowupInputBody, SessionMessagePostBody, SessionMessagePart,
  // ZX2 Phase 2 P2-03
  SessionPermissionDecisionEnum,
  SessionPermissionScopeEnum,
  SessionPermissionRequestBody,
  SessionPermissionDecisionBody,
  SessionUsageUpdateBody,
  SessionSkillInvokeBody,
  SessionCommandInvokeBody,
  SessionElicitationRequestBody,
  SessionElicitationAnswerBody,
} from "./messages.js";

// ── Stream events ──
export {
  SessionStreamEventBodySchema, STREAM_EVENT_KINDS,
  ToolCallProgressKind, ToolCallResultKind, HookBroadcastKind,
  SessionUpdateKind, TurnBeginKind, TurnEndKind,
  CompactNotifyKind, SystemNotifyKind, LlmDeltaKind,
} from "./stream-event.js";
export type { SessionStreamEventBody, StreamEventKind } from "./stream-event.js";

// ── Frame (extends Core envelope) ──
export {
  SessionFrameFieldsSchema, NacpSessionFrameSchema, NacpClientFrameSchema,
  validateSessionMessageType, validateSessionFrame,
} from "./frame.js";
export type { SessionFrameFields, NacpSessionFrame, NacpClientFrame } from "./frame.js";

// ── Session registry + state gate (R4 fix) ──
export {
  SESSION_ROLE_REQUIREMENTS, assertSessionRoleAllowed,
  isSessionMessageAllowedInPhase, assertSessionPhaseAllowed,
} from "./session-registry.js";
export type { SessionRoleRequirement, SessionPhase } from "./session-registry.js";

// ── Ingress ──
export { normalizeClientFrame } from "./ingress.js";
export type { IngressContext } from "./ingress.js";

// ── Replay ──
export { ReplayBuffer } from "./replay.js";
export type { ReplayBufferOptions } from "./replay.js";

// ── Delivery / Ack ──
export { AckWindow, shouldRequireAck } from "./delivery.js";
export type { DeliveryMode, AckWindowOptions, PendingAck } from "./delivery.js";

// ── Heartbeat ──
export { HeartbeatTracker } from "./heartbeat.js";
export type { HeartbeatOptions, HeartbeatStatus } from "./heartbeat.js";

// ── WebSocket helper ──
export { SessionWebSocketHelper } from "./websocket.js";
export type { SessionSocketLike, SessionStorageLike, SessionWebSocketHelperOptions, SessionContext } from "./websocket.js";

// ── Redaction ──
export { redactPayload } from "./redaction.js";

// ── Adapters ──
export { toolProgressToStreamEvent, toolResultToStreamEvent } from "./adapters/tool.js";
export { hookBroadcastToStreamEvent } from "./adapters/hook.js";
export { compactNotifyToStreamEvent } from "./adapters/compact.js";
export { systemNotifyToStreamEvent } from "./adapters/system.js";
export { llmDeltaToStreamEvent } from "./adapters/llm.js";
