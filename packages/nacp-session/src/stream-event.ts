/**
 * SessionStreamEventBody — the unified server-push channel.
 *
 * ALL server → client push events go through session.stream.event with a
 * discriminated `kind` field. This is the structural anchor of Session profile.
 */

import { NacpErrorSchema } from "@haimang/nacp-core";
import { z } from "zod";

export const ToolCallProgressKind = z.object({
  kind: z.literal("tool.call.progress"),
  tool_name: z.string().min(1),
  request_uuid: z.string().uuid().optional(),
  chunk: z.string(),
  is_final: z.boolean(),
});

export const ToolCallResultKind = z.object({
  kind: z.literal("tool.call.result"),
  tool_name: z.string().min(1),
  request_uuid: z.string().uuid().optional(),
  status: z.enum(["ok", "error"]),
  output: z.string().optional(),
  error_message: z.string().optional(),
});

// HP7 P4-02 — session fork lineage event.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.8 HP7
//   * docs/design/hero-to-pro/HP7-checkpoint-revert.md §7 F4
//   * docs/design/hero-to-pro/HPX-qna.md Q23
//
// Q23: fork is "same conversation, new session". The parent's attached
// client receives a `session.fork.created` event so the fork is
// observable without polling restore jobs. parent_session_uuid /
// child_session_uuid carry the lineage; conversation_uuid is included
// to make the "same conversation" invariant visible on the wire.
export const SessionForkCreatedKind = z.object({
  kind: z.literal("session.fork.created"),
  parent_session_uuid: z.string().uuid(),
  child_session_uuid: z.string().uuid(),
  conversation_uuid: z.string().uuid(),
  from_checkpoint_uuid: z.string().uuid(),
  restore_job_uuid: z.string().uuid(),
  label: z.string().max(200).optional(),
});

// HP6 P3 — tool cancel terminal event.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.7 HP6
//   * docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md §7 F3
//   * docs/design/hero-to-pro/HPX-qna.md Q21
//
// Q21 explicitly forbids `tool_cancel` from joining the confirmation
// kind enum (`docs/design/hero-to-pro/HPX-qna.md` Q21);  cancel is a
// terminal lifecycle event, not a control-plane decision. Clients
// distinguish between `tool.call.result {status: error}` and a true
// user / system cancel by listening for this dedicated frame.
//
// `cancel_initiator` is a closed enum:
//   * `user`          — explicit POST /tool-calls/{id}/cancel
//   * `system`        — orchestrator policy / timeout / quota
//   * `parent_cancel` — cascaded from session.cancel / turn cancel
export const ToolCallCancelledKind = z.object({
  kind: z.literal("tool.call.cancelled"),
  tool_name: z.string().min(1),
  request_uuid: z.string().uuid(),
  cancel_initiator: z.enum(["user", "system", "parent_cancel"]),
  reason: z.string().max(2048).optional(),
});

export const HookBroadcastKind = z.object({
  kind: z.literal("hook.broadcast"),
  event_name: z.string().min(1),
  payload_redacted: z.unknown(),
  aggregated_outcome: z.unknown().optional(),
});

export const SessionUpdateKind = z.object({
  kind: z.literal("session.update"),
  phase: z.string().min(1),
  partial_output: z.string().optional(),
});

export const TurnBeginKind = z.object({
  kind: z.literal("turn.begin"),
  turn_uuid: z.string().uuid(),
});

export const TurnEndKind = z.object({
  kind: z.literal("turn.end"),
  turn_uuid: z.string().uuid(),
  usage: z.unknown().optional(),
});

export const CompactNotifyKind = z.object({
  kind: z.literal("compact.notify"),
  status: z.enum(["started", "completed", "failed"]),
  tokens_before: z.number().int().min(0).optional(),
  tokens_after: z.number().int().min(0).optional(),
});

export const SystemNotifyKind = z.object({
  kind: z.literal("system.notify"),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  code: z.string().min(1).optional(),
  trace_uuid: z.string().uuid().optional(),
});

export const SystemErrorKind = z.object({
  kind: z.literal("system.error"),
  error: NacpErrorSchema,
  source_worker: z.string().min(1).optional(),
  trace_uuid: z.string().uuid().optional(),
});

export const LlmDeltaKind = z.object({
  kind: z.literal("llm.delta"),
  content_type: z.enum(["text", "thinking", "tool_use_start", "tool_use_delta"]),
  content: z.string(),
  is_final: z.boolean().default(false),
});

// HP2-D2 (HP0-H10 deferred-closure absorb) — model.fallback stream event.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.3 HP2
//   * docs/issue/hero-to-pro/HP0-H10-deferred-closure.md HP2-D2
//   * docs/design/hero-to-pro/HPX-qna.md Q8 (single-step fallback)
//
// Emitted when a turn's effective model differs from the requested model
// because of a fallback decision. `fallback_model_id` MUST already have
// passed `resolveModelForTeam()` (Q8 invariant: even fallback target
// must satisfy team policy).
export const ModelFallbackKind = z.object({
  kind: z.literal("model.fallback"),
  turn_uuid: z.string().uuid(),
  requested_model_id: z.string().min(1),
  fallback_model_id: z.string().min(1),
  fallback_reason: z.string().min(1),
});

export const SessionStreamEventBodySchema = z.discriminatedUnion("kind", [
  ToolCallProgressKind,
  ToolCallResultKind,
  ToolCallCancelledKind,
  HookBroadcastKind,
  SessionUpdateKind,
  TurnBeginKind,
  TurnEndKind,
  CompactNotifyKind,
  SystemNotifyKind,
  SystemErrorKind,
  LlmDeltaKind,
  SessionForkCreatedKind,
  ModelFallbackKind,
]);

export type SessionStreamEventBody = z.infer<typeof SessionStreamEventBodySchema>;

export const STREAM_EVENT_KINDS = [
  "tool.call.progress",
  "tool.call.result",
  "tool.call.cancelled",
  "hook.broadcast",
  "session.update",
  "turn.begin",
  "turn.end",
  "compact.notify",
  "system.notify",
  "system.error",
  "llm.delta",
  "session.fork.created",
  "model.fallback",
] as const;
export type StreamEventKind = (typeof STREAM_EVENT_KINDS)[number];
