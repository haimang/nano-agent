/**
 * Context-Management — Budget submodule types.
 *
 * The budget submodule freezes the **per-session policy contract** that
 * drives both `async-compact` (when to ARM / PREPARE / fall back to
 * sync) and `inspector-facade` (what to surface in `UsageReport`).
 *
 * Source-of-truth references:
 *   - Charter §7.4 + §11.1
 *   - PX async-compact-lifecycle-spec §3 (threshold defaults)
 *   - `workspace-context-artifacts` `ContextAssemblyConfig` reality:
 *     `maxTokens` and `reserveForResponse` already exist; this submodule
 *     does NOT replace that — it extends it with compact-trigger
 *     percentages and runtime override channels.
 */

// ═══════════════════════════════════════════════════════════════════
// §1 — BufferPolicy
// ═══════════════════════════════════════════════════════════════════

/**
 * Hard token budget for the session and the chunk reserved for the
 * model response. Mirrors `ContextAssemblyConfig` so consumers can
 * keep the same number across the assembler and the compact scheduler.
 */
export interface BufferPolicy {
  /** Total token budget enforced for the assembled prompt. */
  readonly hardLimitTokens: number;
  /** Tokens kept aside for the assistant's response. */
  readonly responseReserveTokens: number;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — CompactPolicy
// ═══════════════════════════════════════════════════════════════════

/**
 * Per-session compact behaviour. All fields have defaults from
 * `PX-async-compact-lifecycle-spec.md §3.1`; per-session override is
 * applied via `mergeCompactPolicy(defaults, override)`.
 */
export interface CompactPolicy {
  /** Soft trigger: ARM when usage% ≥ this value. Default 0.75. */
  readonly softTriggerPct: number;
  /** Hard fallback: force sync compact when usage% ≥ this value. Default 0.95. */
  readonly hardFallbackPct: number;
  /**
   * Minimum free tokens required before scheduler will arm — guards
   * against false positives on tiny contexts. Default 5_000.
   */
  readonly minHeadroomTokensForBackground: number;
  /** Background LLM timeout (ms) before falling back to sync. Default 30_000. */
  readonly backgroundTimeoutMs: number;
  /** Per-session retry budget after a failed prepare. Default 1. */
  readonly maxRetriesAfterFailure: number;
  /** Explicit no-compact for short sessions. Default false. */
  readonly disabled: boolean;
}

/**
 * Caller-supplied partial override — every field is optional. The
 * `mergeCompactPolicy` helper applies defaults per field.
 */
export type CompactPolicyOverride = Partial<CompactPolicy>;

// ═══════════════════════════════════════════════════════════════════
// §3 — Usage report calc inputs
// ═══════════════════════════════════════════════════════════════════

/**
 * Per-tag token breakdown — mirrors the layered context categories the
 * assembler already produces. The string is intentionally a free-form
 * tag (e.g. `"system"` / `"workspace_summary"` / `"interaction"`) so
 * future categories don't need a schema bump.
 */
export interface CategoryUsage {
  readonly name: string;
  readonly tokens: number;
}

/**
 * Snapshot of the live token accounting fed into the inspector
 * facade's `UsageReport.percentage / categories`.
 */
export interface UsageSnapshot {
  readonly totalTokens: number;
  readonly maxTokens: number;
  readonly responseReserveTokens: number;
  readonly categories: readonly CategoryUsage[];
}
