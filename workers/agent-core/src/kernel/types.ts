/**
 * Agent Runtime Kernel — Core Types
 *
 * Defines the fundamental unions and discriminated unions used across the kernel:
 * phase lifecycle, step kinds, interrupt reasons, step decisions, and runtime events.
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════
// §1 — Kernel Phase
// ═══════════════════════════════════════════════════════════════════

export const KernelPhaseSchema = z.enum([
  "idle",
  "turn_running",
  "waiting",
  "interrupted",
  "ended",
]);
export type KernelPhase = z.infer<typeof KernelPhaseSchema>;

// ═══════════════════════════════════════════════════════════════════
// §2 — Step Kind
// ═══════════════════════════════════════════════════════════════════

export const StepKindSchema = z.enum([
  "llm_call",
  "tool_exec",
  "hook_emit",
  "compact",
  "checkpoint",
  "finish",
]);
export type StepKind = z.infer<typeof StepKindSchema>;

// ═══════════════════════════════════════════════════════════════════
// §3 — Interrupt Reason
// ═══════════════════════════════════════════════════════════════════

export const InterruptReasonSchema = z.enum([
  "cancel",
  "timeout",
  "compact_required",
  "approval_pending",
  "fatal_error",
]);
export type InterruptReason = z.infer<typeof InterruptReasonSchema>;

// ═══════════════════════════════════════════════════════════════════
// §4 — Step Decision (discriminated union on `kind`)
// ═══════════════════════════════════════════════════════════════════

export const StepDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("llm_call") }),
  z.object({
    kind: z.literal("tool_exec"),
    requestId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
  }),
  z.object({ kind: z.literal("hook_emit"), event: z.string() }),
  z.object({ kind: z.literal("compact") }),
  z.object({ kind: z.literal("wait"), reason: InterruptReasonSchema }),
  z.object({ kind: z.literal("finish"), reason: z.string() }),
]);
export type StepDecision = z.infer<typeof StepDecisionSchema>;

// ═══════════════════════════════════════════════════════════════════
// §5 — Delegate Chunk Types
// ═══════════════════════════════════════════════════════════════════

/**
 * Chunks emitted by {@link LlmDelegate.call}. The kernel interprets
 * each chunk and updates state accordingly.
 */
export type LlmChunk =
  | { type: "content"; content: string }
  | {
      type: "usage";
      usage: { inputTokens: number; outputTokens: number };
    }
  | {
      type: "tool_calls";
      calls: Array<{ id: string; name: string; input?: unknown }>;
    };

/**
 * Chunks emitted by {@link CapabilityDelegate.execute}. Progress chunks
 * are streamed mid-execution; a single result chunk terminates.
 */
export type CapabilityChunk =
  | { type: "progress"; progress: string; chunk?: string }
  | { type: "result"; result: unknown; status?: "ok" | "error" };

// ═══════════════════════════════════════════════════════════════════
// §6 — Runtime Event (discriminated union on `type`)
// ═══════════════════════════════════════════════════════════════════

export const RuntimeEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("turn.started"),
    turnId: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("turn.completed"),
    turnId: z.string(),
    reason: z.string(),
    usage: z.unknown().optional(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("llm.delta"),
    turnId: z.string(),
    contentType: z.enum([
      "text",
      "thinking",
      "tool_use_start",
      "tool_use_delta",
    ]),
    content: z.string(),
    isFinal: z.boolean(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("tool.call.progress"),
    turnId: z.string(),
    toolName: z.string(),
    requestId: z.string(),
    chunk: z.string(),
    isFinal: z.boolean(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("tool.call.result"),
    turnId: z.string(),
    toolName: z.string(),
    requestId: z.string(),
    status: z.enum(["ok", "error"]),
    output: z.string().optional(),
    errorMessage: z.string().optional(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("hook.broadcast"),
    event: z.string(),
    payloadRedacted: z.unknown(),
    aggregatedOutcome: z.unknown().optional(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("compact.notify"),
    status: z.enum(["started", "completed", "failed"]),
    tokensBefore: z.number().int().min(0).optional(),
    tokensAfter: z.number().int().min(0).optional(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("system.notify"),
    severity: z.enum(["info", "warning", "error"]),
    message: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("session.update"),
    phase: KernelPhaseSchema,
    turnCount: z.number().int(),
    partialOutput: z.string().optional(),
    timestamp: z.string(),
  }),
]);
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
