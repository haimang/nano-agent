/**
 * Agent Runtime Kernel — Session & Turn State
 *
 * Inspired by codex-rs SessionState / TurnState split.
 * SessionState tracks the overall lifecycle; TurnState tracks a single turn.
 * KernelSnapshot combines both for checkpoint / restore.
 */

import { z } from "zod";
import { KernelPhaseSchema, InterruptReasonSchema } from "./types.js";
import { KERNEL_VERSION } from "./version.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Session State
// ═══════════════════════════════════════════════════════════════════

export const SessionStateSchema = z.object({
  phase: KernelPhaseSchema,
  turnCount: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
  compactCount: z.number().int().min(0),
  lastCheckpointAt: z.string().nullable(),
  createdAt: z.string(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

// ═══════════════════════════════════════════════════════════════════
// §2 — Turn State
// ═══════════════════════════════════════════════════════════════════

export const TurnPhaseSchema = z.enum([
  "pending",
  "running",
  "completed",
  "aborted",
]);
export type TurnPhase = z.infer<typeof TurnPhaseSchema>;

/**
 * Pending tool call descriptor. Captures enough metadata for the
 * scheduler to produce a `tool_exec` decision without requiring
 * the runner to look up additional information.
 */
export const PendingToolCallSchema = z.object({
  callId: z.string(),
  toolName: z.string(),
  toolInput: z.unknown(),
});
export type PendingToolCall = z.infer<typeof PendingToolCallSchema>;

export const TurnStateSchema = z.object({
  turnId: z.string(),
  stepIndex: z.number().int().min(0),
  phase: TurnPhaseSchema,
  pendingToolCalls: z.array(PendingToolCallSchema),
  messages: z.array(z.unknown()),
  llmFinished: z.boolean(),
  /**
   * Buffered input that arrived while the turn was suspended. Consumed
   * on the next `resume`. Null when no input is pending.
   */
  pendingInput: z.unknown().nullable(),
  startedAt: z.string(),
  interruptReason: InterruptReasonSchema.nullable(),
});
export type TurnState = z.infer<typeof TurnStateSchema>;

// ═══════════════════════════════════════════════════════════════════
// §3 — Kernel Snapshot
// ═══════════════════════════════════════════════════════════════════

export const KernelSnapshotSchema = z.object({
  session: SessionStateSchema,
  activeTurn: TurnStateSchema.nullable(),
  version: z.string(),
});
export type KernelSnapshot = z.infer<typeof KernelSnapshotSchema>;

// ═══════════════════════════════════════════════════════════════════
// §4 — Factory Functions
// ═══════════════════════════════════════════════════════════════════

export function createInitialSessionState(): SessionState {
  return {
    phase: "idle",
    turnCount: 0,
    totalTokens: 0,
    compactCount: 0,
    lastCheckpointAt: null,
    createdAt: new Date().toISOString(),
  };
}

export function createTurnState(turnId: string): TurnState {
  return {
    turnId,
    stepIndex: 0,
    phase: "pending",
    pendingToolCalls: [],
    messages: [],
    llmFinished: false,
    pendingInput: null,
    startedAt: new Date().toISOString(),
    interruptReason: null,
  };
}

export function createKernelSnapshot(
  session: SessionState,
  activeTurn: TurnState | null = null,
): KernelSnapshot {
  return {
    session,
    activeTurn,
    version: KERNEL_VERSION,
  };
}
