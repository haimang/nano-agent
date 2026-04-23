/**
 * Workspace Context Artifacts — Context Assembly Types
 *
 * Defines the layered context model used to assemble prompts
 * from system instructions, session state, workspace summaries,
 * artifact summaries, recent transcripts, and injected content.
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════
// §1 — Context Layer Kind
// ═══════════════════════════════════════════════════════════════════

export const ContextLayerKindSchema = z.enum([
  "system",
  "session",
  "workspace_summary",
  "artifact_summary",
  "recent_transcript",
  "injected",
]);
export type ContextLayerKind = z.infer<typeof ContextLayerKindSchema>;

/**
 * Canonical fixed layer order used by `ContextAssembler` when
 * `config.layers` does not itself act as an ordered list (see the
 * `context-assembler.ts` header for the ordering rules).
 *
 * This freezes the `system → session → workspace_summary →
 * artifact_summary → recent_transcript → injected` sequence from
 * `docs/action-plan/workspace-context-artifacts.md §4.4 P4-02` so the
 * assembler's output order is a stable part of the public contract,
 * not a side-effect of caller-supplied `priority` values.
 */
export const CANONICAL_LAYER_ORDER: readonly ContextLayerKind[] = [
  "system",
  "session",
  "workspace_summary",
  "artifact_summary",
  "recent_transcript",
  "injected",
] as const;

/**
 * 0-indexed rank of each canonical layer kind. Used by
 * `ContextAssembler` to break ties deterministically when two layers
 * share the same caller-supplied `priority`, and as the default
 * ordering when the caller's `config.layers` allowlist is omitted.
 */
export const CANONICAL_LAYER_RANK: Record<ContextLayerKind, number> =
  Object.fromEntries(
    CANONICAL_LAYER_ORDER.map((kind, index) => [kind, index]),
  ) as Record<ContextLayerKind, number>;

// ═══════════════════════════════════════════════════════════════════
// §2 — Context Layer
// ═══════════════════════════════════════════════════════════════════

export const ContextLayerSchema = z.object({
  kind: ContextLayerKindSchema,
  priority: z.number().int(),
  content: z.string(),
  tokenEstimate: z.number().int().min(0),
  required: z.boolean(),
});
export type ContextLayer = z.infer<typeof ContextLayerSchema>;

// ═══════════════════════════════════════════════════════════════════
// §3 — Context Assembly Config
// ═══════════════════════════════════════════════════════════════════

export const ContextAssemblyConfigSchema = z.object({
  maxTokens: z.number().int().min(1),
  layers: z.array(ContextLayerKindSchema),
  reserveForResponse: z.number().int().min(0),
});
export type ContextAssemblyConfig = z.infer<typeof ContextAssemblyConfigSchema>;
