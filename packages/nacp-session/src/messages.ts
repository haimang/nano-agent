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

// ── session.start ──
export const SessionStartBodySchema = z.object({
  cwd: z.string().max(512).optional(),
  // B9 / 1.3: tightened from z.record(...) to SessionStartInitialContextSchema.
  // Back-compat: the inner schema is .passthrough() with every field optional,
  // so existing loose payloads (including {}) continue to parse.
  initial_context: SessionStartInitialContextSchema.optional(),
  initial_input: z.string().max(32768).optional(),
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
});
export type SessionFollowupInputBody = z.infer<typeof SessionFollowupInputBodySchema>;

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
  // RH2 P2-01c
  "session.attachment.superseded",
]);
