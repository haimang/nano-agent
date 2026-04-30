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

export const SessionStreamEventBodySchema = z.discriminatedUnion("kind", [
  ToolCallProgressKind,
  ToolCallResultKind,
  HookBroadcastKind,
  SessionUpdateKind,
  TurnBeginKind,
  TurnEndKind,
  CompactNotifyKind,
  SystemNotifyKind,
  SystemErrorKind,
  LlmDeltaKind,
]);

export type SessionStreamEventBody = z.infer<typeof SessionStreamEventBodySchema>;

export const STREAM_EVENT_KINDS = [
  "tool.call.progress",
  "tool.call.result",
  "hook.broadcast",
  "session.update",
  "turn.begin",
  "turn.end",
  "compact.notify",
  "system.notify",
  "system.error",
  "llm.delta",
] as const;
export type StreamEventKind = (typeof STREAM_EVENT_KINDS)[number];
