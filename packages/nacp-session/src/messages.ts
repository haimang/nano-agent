/**
 * NACP-Session Message Schemas — the 7 Session profile messages.
 *
 * These are NOT registered in Core's BODY_SCHEMAS — they belong exclusively
 * to the Session profile (client ↔ session DO WebSocket).
 */

import { z } from "zod";

// ── session.start ──
export const SessionStartBodySchema = z.object({
  cwd: z.string().max(512).optional(),
  initial_context: z.record(z.string(), z.unknown()).optional(),
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
  stream_id: z.string().min(1).max(128),
  acked_seq: z.number().int().min(0),
});
export type SessionStreamAckBody = z.infer<typeof SessionStreamAckBodySchema>;

// ── session.heartbeat ──
export const SessionHeartbeatBodySchema = z.object({
  ts: z.number().int().min(0),
});
export type SessionHeartbeatBody = z.infer<typeof SessionHeartbeatBodySchema>;

// ── Aggregated maps ──

export const SESSION_BODY_SCHEMAS = {
  "session.start": SessionStartBodySchema,
  "session.resume": SessionResumeBodySchema,
  "session.cancel": SessionCancelBodySchema,
  "session.end": SessionEndBodySchema,
  "session.stream.ack": SessionStreamAckBodySchema,
  "session.heartbeat": SessionHeartbeatBodySchema,
  // session.stream.event is handled separately via stream-event.ts
} as const;

export const SESSION_BODY_REQUIRED = new Set([
  "session.start",
  "session.resume",
  "session.end",
  "session.stream.ack",
  "session.heartbeat",
]);

export const SESSION_MESSAGE_TYPES = new Set([
  "session.start",
  "session.resume",
  "session.cancel",
  "session.end",
  "session.stream.event",
  "session.stream.ack",
  "session.heartbeat",
]);
