/**
 * Workspace Context Artifacts — Compact Boundary Management
 *
 * The compact boundary is the strip/reinject contract for the
 * `context.compact.request` / `context.compact.response` Core
 * messages.
 *
 * Wire shapes (from `@nano-agent/nacp-core`'s `messages/context.ts`):
 *
 *   ContextCompactRequestBody  : { history_ref, target_token_budget }
 *   ContextCompactResponseBody : { status, summary_ref?, tokens_before?,
 *                                  tokens_after?, error? }
 *
 * `CompactBoundaryManager`:
 *   - Produces `ContextCompactRequestBody`-shaped values from a list of
 *     messages + a token budget. Messages may carry a `tokenEstimate`
 *     (or `content.length` fallback) so the split point honours the
 *     budget instead of splitting by message count.
 *   - Applies a `ContextCompactResponseBody`-shaped value back onto
 *     the live message list, recording a boundary marker so restore /
 *     snapshot can see what was archived.
 */

import type { NacpRefLike, ArtifactRef } from "./refs.js";
import type { CompactBoundaryRecord } from "./snapshot.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Wire shapes (mirror nacp-core)
// ═══════════════════════════════════════════════════════════════════

/** `context.compact.request` body (mirrors `ContextCompactRequestBodySchema`). */
export interface ContextCompactRequestBody {
  readonly history_ref: NacpRefLike;
  readonly target_token_budget: number;
}

/** `context.compact.response` body (mirrors `ContextCompactResponseBodySchema`). */
export interface ContextCompactResponseBody {
  readonly status: "ok" | "error";
  readonly summary_ref?: NacpRefLike;
  readonly tokens_before?: number;
  readonly tokens_after?: number;
  readonly error?: { readonly code: string; readonly message: string };
}

/**
 * Local input passed by callers when they want to build a compact
 * request from raw in-memory messages.
 */
export interface BuildCompactInputArgs {
  readonly historyRef: NacpRefLike;
  readonly messages: readonly CompactMessage[];
  readonly targetTokenBudget: number;
}

/**
 * Minimum message shape the split heuristic understands. Callers may
 * pass additional fields — only `tokenEstimate` / `content.length` are
 * consulted here.
 */
export interface CompactMessage {
  readonly tokenEstimate?: number;
  readonly content?: string;
  readonly [extra: string]: unknown;
}

/**
 * Local handle returned after a compact response is applied. Carries
 * the newly-created boundary record and the resulting live message
 * list. This is NOT a wire type.
 */
export interface ApplyCompactResult {
  readonly messages: readonly CompactMessage[];
  readonly boundary: CompactBoundaryRecord;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — CompactBoundaryManager
// ═══════════════════════════════════════════════════════════════════

export class CompactBoundaryManager {
  private boundaryRecords: CompactBoundaryRecord[] = [];

  /**
   * Build a `context.compact.request` body from a live message list
   * and a token budget. The wire body only carries `history_ref` +
   * `target_token_budget`; the split-point heuristic is exposed via
   * `pickSplitPoint()` so callers can act on the result independently.
   */
  buildCompactRequest(args: BuildCompactInputArgs): ContextCompactRequestBody {
    return {
      history_ref: args.historyRef,
      target_token_budget: args.targetTokenBudget,
    };
  }

  /**
   * Find the split point: the smallest prefix length such that the
   * suffix (recent messages) fits inside `targetTokenBudget`.
   * Returns at least 1 so at least one message is always compactable.
   */
  pickSplitPoint(
    messages: readonly CompactMessage[],
    targetTokenBudget: number,
  ): number {
    if (messages.length === 0) return 0;
    let accumulated = 0;
    let splitIndex = messages.length;
    for (let i = messages.length - 1; i >= 0; i--) {
      const tokens = estimateTokens(messages[i]!);
      if (accumulated + tokens > targetTokenBudget) break;
      accumulated += tokens;
      splitIndex = i;
    }
    return Math.max(1, splitIndex);
  }

  /**
   * Apply a `context.compact.response` body + the artifact ref that
   * points at the summary to the live conversation state.
   *
   * - Errors are surfaced by returning `{ error }` unchanged.
   * - On success a boundary marker is pushed onto the internal record
   *   stack AND prepended to the returned messages so the kernel /
   *   snapshot path can see "turns X-Y were archived here".
   */
  applyCompactResponse(
    currentMessages: readonly CompactMessage[],
    response: ContextCompactResponseBody,
    summaryRef: ArtifactRef,
    turnRange: string,
  ): ApplyCompactResult | { readonly error: ContextCompactResponseBody["error"] } {
    if (response.status === "error") {
      return { error: response.error };
    }

    const boundary: CompactBoundaryRecord = {
      turnRange,
      summaryRef,
      archivedAt: new Date().toISOString(),
    };
    this.boundaryRecords.push(boundary);

    const marker: CompactMessage = {
      role: "system",
      content:
        `[Compact boundary: turns ${turnRange} archived at ${boundary.archivedAt}, ` +
        `summary: ${summaryRef.key}]`,
      _compactBoundary: boundary,
    };

    return {
      messages: [marker, ...currentMessages],
      boundary,
    };
  }

  /** Get all boundary records accumulated so far. */
  getBoundaryRecords(): readonly CompactBoundaryRecord[] {
    return [...this.boundaryRecords];
  }
}

// ── Internal helpers ──

function estimateTokens(msg: CompactMessage): number {
  if (typeof msg.tokenEstimate === "number" && msg.tokenEstimate >= 0) {
    return msg.tokenEstimate;
  }
  if (typeof msg.content === "string") {
    // ~4 chars per token is a reasonable coarse estimate for ASCII-ish
    // English. Not accurate, but good enough as a fallback when the
    // caller did not supply `tokenEstimate`.
    return Math.ceil(msg.content.length / 4);
  }
  return 0;
}
