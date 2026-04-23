/**
 * Agent Runtime Kernel — Step Definitions
 *
 * A KernelStep represents a single discrete unit of work within a turn
 * (e.g., an LLM call, a tool execution, a hook emission).
 */

import { z } from "zod";
import { StepKindSchema } from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Kernel Step
// ═══════════════════════════════════════════════════════════════════

export const KernelStepSchema = z.object({
  kind: StepKindSchema,
  index: z.number().int().min(0),
  turnId: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  result: z.unknown().nullable(),
});
export type KernelStep = z.infer<typeof KernelStepSchema>;
