/**
 * NACP-Session Message Schemas — the v1 Session profile messages.
 *
 * Phase 0 / Q1+Q8 widening: adds `session.followup_input` as the minimum
 * client-produced multi-round input family alongside the initial 7 kinds.
 * Any richer queue / replace / merge / approval-aware scheduling semantics
 * are explicitly out of scope — they belong to a later session protocol cut.
 *
 * These are NOT registered in Core's BODY_SCHEMAS — they belong exclusively
 * to the Session profile (client ↔ session DO WebSocket).
 */

import { z } from "zod";
import { NacpRefSchema } from "@haimang/nacp-core";
import { SessionStartInitialContextSchema } from "./upstream-context.js";

const ModelIdSchema = z.string().regex(/^[a-z0-9@/._-]{1,120}$/i);
const ReasoningEffortSchema = z.object({
  effort: z.enum(["low", "medium", "high"]),
});

const SessionMessagePartSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1).max(32768),
  }),
  z.object({
    kind: z.literal("artifact_ref"),
    artifact_uuid: z.string().min(1).max(128),
    mime: z.string().max(128).optional(),
    summary: z.string().max(2048).optional(),
  }),
  z.object({
    kind: z.literal("image_url"),
    url: z.string().min(1).max(2048),
    mime: z.string().max(128).optional(),
    mimeType: z.string().max(128).optional(),
  }),
]);
export type SessionMessagePart = z.infer<typeof SessionMessagePartSchema>;

// ── session.start ──
export const SessionStartBodySchema = z.object({
  cwd: z.string().max(512).optional(),
  // B9 / 1.3: tightened from z.record(...) to SessionStartInitialContextSchema.
  // Back-compat: the inner schema is .passthrough() with every field optional,
  // so existing loose payloads (including {}) continue to parse.
  initial_context: SessionStartInitialContextSchema.optional(),
  initial_input: z.string().max(32768).optional(),
  model_id: ModelIdSchema.optional(),
  reasoning: ReasoningEffortSchema.optional(),
});
export type SessionStartBody = z.infer<typeof SessionStartBodySchema>;

// ── session.resume ──
export const SessionResumeBodySchema = z.object({
  last_seen_seq: z.number().int().min(0),
});
export type SessionResumeBody = z.infer<typeof SessionResumeBodySchema>;

// ── session.cancel ──
export const SessionCancelBodySchema = z.object({
  reason: z.string().max(256).optional(),
});
export type SessionCancelBody = z.infer<typeof SessionCancelBodySchema>;

// ── session.end ──
export const SessionEndBodySchema = z.object({
  reason: z.enum(["user", "timeout", "error", "completed"]),
  usage_summary: z
    .object({
      total_tokens: z.number().int().min(0).optional(),
      total_tool_calls: z.number().int().min(0).optional(),
      duration_ms: z.number().int().min(0).optional(),
    })
    .optional(),
});
export type SessionEndBody = z.infer<typeof SessionEndBodySchema>;

// ── session.stream.ack ──
export const SessionStreamAckBodySchema = z.object({
  stream_uuid: z.string().min(1).max(128),
  acked_seq: z.number().int().min(0),
});
export type SessionStreamAckBody = z.infer<typeof SessionStreamAckBodySchema>;

// ── session.heartbeat ──
export const SessionHeartbeatBodySchema = z.object({
  ts: z.number().int().min(0),
});
export type SessionHeartbeatBody = z.infer<typeof SessionHeartbeatBodySchema>;

// ── session.attachment.superseded (RH2 P2-01c) ──
// 当同一 session 出现新的 attach（例如另一台设备登录或刷新页面），先前
// attached 的客户端应收到一条 `session.attachment.superseded` 帧并执行
// graceful disconnect。`reason` 给客户端清晰的原因码以便决定是否提示用户重登。
export const SessionAttachmentSupersededBodySchema = z.object({
  session_uuid: z.string().uuid(),
  superseded_at: z.string().datetime(),
  // `device-conflict` — 同账号另一设备 attach;`reattach` — 同设备刷新；
  // `revoked` — device revoke 触发；`policy` — 策略强制断开。
  reason: z.enum(["device-conflict", "reattach", "revoked", "policy"]),
  // 可选 trace 字段,供前端日志关联。
  next_attach_trace_uuid: z.string().uuid().optional(),
});
export type SessionAttachmentSupersededBody = z.infer<
  typeof SessionAttachmentSupersededBodySchema
>;

// ── session.followup_input (Phase 0 widened v1 surface) ──
//
// Owner decision (PX-QNA Q1 / AX-QNA Q1): the minimum frozen shape is a
// single client-produced message that mirrors `session.start.initial_input`
// so ingress / client code can reuse the same text-bearing shape. Body is
// intentionally small — `text` is required, `context_ref` lets the client
// attach a PreparedArtifactRef for refer-back, and `stream_seq` lets
// resume/replay place the follow-up on the session timeline without
// re-sending it.
export const SessionFollowupInputBodySchema = z.object({
  text: z.string().min(1).max(32768),
  context_ref: NacpRefSchema.optional(),
  stream_seq: z.number().int().min(0).optional(),
  model_id: ModelIdSchema.optional(),
  reasoning: ReasoningEffortSchema.optional(),
  parts: z.array(SessionMessagePartSchema).min(1).max(32).optional(),
});
export type SessionFollowupInputBody = z.infer<typeof SessionFollowupInputBodySchema>;

export const SessionMessagePostBodySchema = z.object({
  parts: z.array(SessionMessagePartSchema).min(1).max(32),
  model_id: ModelIdSchema.optional(),
  reasoning: ReasoningEffortSchema.optional(),
  trace_uuid: z.string().uuid().optional(),
  context_ref: NacpRefSchema.optional(),
  stream_seq: z.number().int().min(0).optional(),
});
export type SessionMessagePostBody = z.infer<typeof SessionMessagePostBodySchema>;

// ═══════════════════════════════════════════════════════════════════
// ZX2 Phase 2 P2-03 — 5 message_type families (7 message types) covering
// the facade-needed capabilities derived from CLI host comparisons
// (claude-code / codex / gemini-cli). Each family below stays a body-only
// schema; the WS frame envelope continues to be NacpSessionFrameSchema.
// ═══════════════════════════════════════════════════════════════════

// ── Family 1: permission gate ─────────────────────────────────────
// server → client: ask for tool-use permission with a request_uuid;
// client → server: reply with the user's decision (mirroring claude-code
// `can_use_tool`).
export const SessionPermissionDecisionEnumSchema = z.enum([
  "allow",
  "deny",
  "always_allow",
  "always_deny",
]);
export type SessionPermissionDecisionEnum = z.infer<
  typeof SessionPermissionDecisionEnumSchema
>;

export const SessionPermissionScopeEnumSchema = z.enum([
  "once",
  "session",
  "user",
]);
export type SessionPermissionScopeEnum = z.infer<
  typeof SessionPermissionScopeEnumSchema
>;

export const SessionPermissionRequestBodySchema = z.object({
  request_uuid: z.string().uuid(),
  tool_name: z.string().min(1).max(128),
  tool_input: z.record(z.string(), z.unknown()),
  reason: z.string().max(2048).optional(),
  blocked_path: z.string().max(2048).optional(),
  // ISO timestamp; orchestrator picks 30s default (ZX2 Phase 5 P5-03).
  expires_at: z.string().datetime({ offset: true }).optional(),
  suggested_decision: SessionPermissionDecisionEnumSchema.optional(),
});
export type SessionPermissionRequestBody = z.infer<
  typeof SessionPermissionRequestBodySchema
>;

export const SessionPermissionDecisionBodySchema = z.object({
  request_uuid: z.string().uuid(),
  decision: SessionPermissionDecisionEnumSchema,
  scope: SessionPermissionScopeEnumSchema.default("once"),
  reason: z.string().max(2048).optional(),
});
export type SessionPermissionDecisionBody = z.infer<
  typeof SessionPermissionDecisionBodySchema
>;

// ── Family 2: usage update ───────────────────────────────────────
// High-frequency server → client push. ZX2 Phase 5 P5-03 mandates ≥1Hz
// auto-merge backpressure so this body MUST stay small.
export const SessionUsageUpdateBodySchema = z.object({
  // Cumulative since session start.
  llm_input_tokens: z.number().int().min(0).optional(),
  llm_output_tokens: z.number().int().min(0).optional(),
  llm_cache_read_tokens: z.number().int().min(0).optional(),
  llm_cache_write_tokens: z.number().int().min(0).optional(),
  tool_calls: z.number().int().min(0).optional(),
  subrequest_used: z.number().int().min(0).optional(),
  subrequest_budget: z.number().int().min(0).optional(),
  estimated_cost_usd: z.number().min(0).optional(),
});
export type SessionUsageUpdateBody = z.infer<typeof SessionUsageUpdateBodySchema>;

// ── Family 3: skill invoke ───────────────────────────────────────
// client → server: ask the session to invoke a registered skill by name.
// Skill execution itself remains a NACP-Core `skill.invoke.request` —
// this WS frame is just the client trigger.
export const SessionSkillInvokeBodySchema = z.object({
  skill_name: z.string().min(1).max(128),
  args: z.record(z.string(), z.unknown()).optional(),
  request_uuid: z.string().uuid().optional(),
});
export type SessionSkillInvokeBody = z.infer<typeof SessionSkillInvokeBodySchema>;

// ── Family 4: command invoke ─────────────────────────────────────
// client → server: trigger a slash command (parallel to skill but the
// command catalogue is curated separately, e.g. /loop, /schedule).
export const SessionCommandInvokeBodySchema = z.object({
  command_name: z.string().min(1).max(128),
  args: z.string().max(8192).optional(),
  request_uuid: z.string().uuid().optional(),
});
export type SessionCommandInvokeBody = z.infer<
  typeof SessionCommandInvokeBodySchema
>;

// ── Family 5: elicitation ────────────────────────────────────────
// server → client: single-turn ask-the-user pair (mirroring claude-code
// `elicitation`). client → server: the answer.
export const SessionElicitationRequestBodySchema = z.object({
  request_uuid: z.string().uuid(),
  prompt: z.string().min(1).max(8192),
  // JSON schema (loose) describing the expected answer shape; consumers
  // use it to render structured input when present.
  answer_schema: z.record(z.string(), z.unknown()).optional(),
  expires_at: z.string().datetime({ offset: true }).optional(),
});
export type SessionElicitationRequestBody = z.infer<
  typeof SessionElicitationRequestBodySchema
>;

export const SessionElicitationAnswerBodySchema = z.object({
  request_uuid: z.string().uuid(),
  // Free-form structured answer — validated against `answer_schema` on
  // the server, since the schema is dynamic.
  answer: z.unknown(),
  cancelled: z.boolean().optional(),
});
export type SessionElicitationAnswerBody = z.infer<
  typeof SessionElicitationAnswerBodySchema
>;

// ── Family 6: confirmation control plane (HP5) ───────────────────
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.6 HP5
//   * docs/design/hero-to-pro/HP5-confirmation-control-plane.md §7 F4
//   * docs/design/hero-to-pro/HPX-qna.md Q16-Q18
//   * workers/orchestrator-core/migrations/012-session-confirmations.sql
//
// Frozen invariants (HP5 must NOT extend without §3 schema correction):
//   * kind ∈ { tool_permission, elicitation, model_switch, context_compact,
//             fallback_model, checkpoint_restore, context_loss }
//     — exactly 7 kinds; Q18 forbids `tool_cancel` and forbids `custom`.
//   * status ∈ { pending, allowed, denied, modified, timeout, superseded }
//     — exactly 6 statuses; Q16 forbids `failed`.
//
// `session.confirmation.request` is server → client and announces a
// new pending row. `session.confirmation.update` is server → client and
// either updates a still-pending row (e.g. extended expiry) or signals
// the terminal transition. The legacy `session.permission.request /
// .decision` and `session.elicitation.request / .answer` frames remain
// in the registry as compat aliases — HP5 does NOT delete them.
export const SessionConfirmationKindSchema = z.enum([
  "tool_permission",
  "elicitation",
  "model_switch",
  "context_compact",
  "fallback_model",
  "checkpoint_restore",
  "context_loss",
]);
export type SessionConfirmationKind = z.infer<
  typeof SessionConfirmationKindSchema
>;

export const SessionConfirmationStatusSchema = z.enum([
  "pending",
  "allowed",
  "denied",
  "modified",
  "timeout",
  "superseded",
]);
export type SessionConfirmationStatus = z.infer<
  typeof SessionConfirmationStatusSchema
>;

export const SessionConfirmationRequestBodySchema = z.object({
  confirmation_uuid: z.string().uuid(),
  kind: SessionConfirmationKindSchema,
  // Generic kind-shaped payload. Kind-specific shapes (tool_permission's
  // tool_name/tool_input, elicitation's prompt, etc.) live inside this
  // record; HP5 deliberately keeps the wire body open so HP3 / HP4 / HP6
  // / HP7 can attach their own kind payloads without re-versioning the
  // frame family.
  payload: z.record(z.string(), z.unknown()),
  // Optional cross-reference to a per-emit request id when the caller
  // already owns one (e.g. legacy permission / elicitation request_uuid
  // — HP5 lets the caller forward that as `request_uuid` so the client
  // can correlate against legacy frames during the compat window).
  request_uuid: z.string().uuid().optional(),
  expires_at: z.string().datetime({ offset: true }).optional(),
});
export type SessionConfirmationRequestBody = z.infer<
  typeof SessionConfirmationRequestBodySchema
>;

export const SessionConfirmationUpdateBodySchema = z.object({
  confirmation_uuid: z.string().uuid(),
  status: SessionConfirmationStatusSchema,
  decision_payload: z.record(z.string(), z.unknown()).optional(),
  decided_at: z.string().datetime({ offset: true }).optional(),
});
export type SessionConfirmationUpdateBody = z.infer<
  typeof SessionConfirmationUpdateBodySchema
>;

// ── Family 7: agentic-loop todos (HP6) ─────────────────────────────
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.7 HP6
//   * docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md §7 F1
//   * workers/orchestrator-core/migrations/010-agentic-loop-todos.sql
//
// Frozen invariants (HP6 must NOT extend without §3 schema correction
// in HP1):
//   * status ∈ { pending, in_progress, completed, cancelled, blocked }
//     — exactly 5 statuses; charter §436.
//   * `at most 1 in_progress` per session is enforced at the
//     application layer (D1TodoControlPlane).
//
// `session.todos.write` is bidirectional: model-side (`WriteTodos`
// capability) and client-side both produce it as a generic upsert
// command. `session.todos.update` is server → client and broadcasts
// the new authoritative list whenever the registry changes.

export const SessionTodoStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "blocked",
]);
export type SessionTodoStatus = z.infer<typeof SessionTodoStatusSchema>;

const SessionTodoItemSchema = z.object({
  todo_uuid: z.string().uuid().optional(),
  parent_todo_uuid: z.string().uuid().optional(),
  content: z.string().min(1).max(2000),
  status: SessionTodoStatusSchema.default("pending"),
});

export const SessionTodosWriteBodySchema = z.object({
  todos: z.array(SessionTodoItemSchema).min(1).max(100),
  // Optional client-side request_uuid — useful for client UIs that
  // want to correlate the write with an outgoing patch.
  request_uuid: z.string().uuid().optional(),
});
export type SessionTodosWriteBody = z.infer<typeof SessionTodosWriteBodySchema>;

const SessionTodoStateSchema = z.object({
  todo_uuid: z.string().uuid(),
  session_uuid: z.string().uuid(),
  conversation_uuid: z.string().uuid(),
  parent_todo_uuid: z.string().uuid().nullable(),
  content: z.string().min(1).max(2000),
  status: SessionTodoStatusSchema,
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).nullable(),
});

export const SessionTodosUpdateBodySchema = z.object({
  session_uuid: z.string().uuid(),
  todos: z.array(SessionTodoStateSchema),
});
export type SessionTodosUpdateBody = z.infer<typeof SessionTodosUpdateBodySchema>;

// ── Aggregated maps ──

export const SESSION_BODY_SCHEMAS = {
  "session.start": SessionStartBodySchema,
  "session.resume": SessionResumeBodySchema,
  "session.cancel": SessionCancelBodySchema,
  "session.end": SessionEndBodySchema,
  "session.stream.ack": SessionStreamAckBodySchema,
  "session.heartbeat": SessionHeartbeatBodySchema,
  "session.followup_input": SessionFollowupInputBodySchema,
  // ZX2 Phase 2 P2-03 — 5 family / 7 message_types
  "session.permission.request": SessionPermissionRequestBodySchema,
  "session.permission.decision": SessionPermissionDecisionBodySchema,
  "session.usage.update": SessionUsageUpdateBodySchema,
  "session.skill.invoke": SessionSkillInvokeBodySchema,
  "session.command.invoke": SessionCommandInvokeBodySchema,
  "session.elicitation.request": SessionElicitationRequestBodySchema,
  "session.elicitation.answer": SessionElicitationAnswerBodySchema,
  // HP5 P1-03 — generic confirmation control plane frame family.
  "session.confirmation.request": SessionConfirmationRequestBodySchema,
  "session.confirmation.update": SessionConfirmationUpdateBodySchema,
  // HP6 P1-02 — agentic-loop todo family.
  "session.todos.write": SessionTodosWriteBodySchema,
  "session.todos.update": SessionTodosUpdateBodySchema,
  // RH2 P2-01c — server → client supersede notification.
  "session.attachment.superseded": SessionAttachmentSupersededBodySchema,
  // session.stream.event is handled separately via stream-event.ts
} as const;

export const SESSION_BODY_REQUIRED = new Set([
  "session.start",
  "session.resume",
  "session.end",
  "session.stream.ack",
  "session.heartbeat",
  "session.followup_input",
  // ZX2 Phase 2 P2-03 — every new family carries a non-empty body.
  "session.permission.request",
  "session.permission.decision",
  "session.usage.update",
  "session.skill.invoke",
  "session.command.invoke",
  "session.elicitation.request",
  "session.elicitation.answer",
  // HP5 P1-03
  "session.confirmation.request",
  "session.confirmation.update",
  // HP6 P1-02
  "session.todos.write",
  "session.todos.update",
  // RH2 P2-01c
  "session.attachment.superseded",
]);

export const SESSION_MESSAGE_TYPES = new Set([
  "session.start",
  "session.resume",
  "session.cancel",
  "session.end",
  "session.stream.event",
  "session.stream.ack",
  "session.heartbeat",
  "session.followup_input",
  // ZX2 Phase 2 P2-03
  "session.permission.request",
  "session.permission.decision",
  "session.usage.update",
  "session.skill.invoke",
  "session.command.invoke",
  "session.elicitation.request",
  "session.elicitation.answer",
  // HP5 P1-03
  "session.confirmation.request",
  "session.confirmation.update",
  // HP6 P1-02
  "session.todos.write",
  "session.todos.update",
  // RH2 P2-01c
  "session.attachment.superseded",
]);
