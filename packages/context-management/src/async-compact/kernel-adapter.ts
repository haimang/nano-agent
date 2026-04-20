/**
 * Context-Management — kernel CompactDelegate adapter.
 *
 * `@nano-agent/agent-runtime-kernel` exposes a narrow `CompactDelegate`
 * interface (`{ requestCompact(budget): Promise<unknown> }`). The
 * kernel scheduler calls it when a turn-boundary requires compaction.
 *
 * This adapter wraps an `AsyncCompactOrchestrator` so the kernel can
 * keep its current contract while delegating the real work to the B4
 * lifecycle. The adapter does NOT introduce any kernel-side change —
 * `session-do-runtime` (or any other host) instantiates this adapter
 * and passes it as `delegates.compact`.
 *
 * The adapter calls `forceSyncCompact()` (the synchronous fallback
 * path) because the kernel only invokes `requestCompact` at a hard
 * turn boundary where the user is already blocked. Kernel-side ARM /
 * PREPARE wiring is a future enhancement (would require new kernel
 * scheduler signals); the orchestrator's async path is exercised by
 * the host directly via `tryArm` / `tryPrepare`.
 */

import type { AsyncCompactOrchestrator } from "./index.js";
import type { ContextLayer } from "@nano-agent/workspace-context-artifacts";

/**
 * The kernel's compact delegate is intentionally typed loosely
 * (`requestCompact(budget: unknown): Promise<unknown>`); this adapter
 * normalises the budget input into a structured shape and returns
 * the kernel-expected `{ tokensFreed }` payload.
 */
export interface KernelCompactBudgetInput {
  totalTokens?: number;
}

export interface KernelCompactDelegate {
  requestCompact(budget: unknown): Promise<{ tokensFreed: number }>;
}

export interface CreateKernelAdapterConfig {
  readonly orchestrator: AsyncCompactOrchestrator;
  /**
   * Snapshot of the live context layers + version. The host calls this
   * lazily so the adapter always sees the freshest state at compact
   * time.
   */
  readonly readContext: () => Promise<{
    layers: readonly ContextLayer[];
    contextVersion: number;
  }>;
  /**
   * Reason string surfaced in the `forceSyncCompact` invocation.
   * Default `"kernel-requested"`.
   */
  readonly reason?: string;
}

export function createKernelCompactDelegate(
  config: CreateKernelAdapterConfig,
): KernelCompactDelegate {
  const reason = config.reason ?? "kernel-requested";
  return {
    async requestCompact(budgetRaw: unknown) {
      const budget = (budgetRaw ?? {}) as KernelCompactBudgetInput;
      const tokensBefore = budget.totalTokens ?? 0;
      const ctx = await config.readContext();
      const outcome = await config.orchestrator.forceSyncCompact({
        layers: ctx.layers,
        contextVersion: ctx.contextVersion,
        reason,
      });
      if (outcome.kind !== "committed") {
        // Honest signal — kernel will see `tokensFreed = 0` and the
        // session will fall back to whatever its policy is. The kernel
        // does not currently expose a richer error shape; B7 round 2
        // can extend this if `compact_done` payload grows.
        return { tokensFreed: 0 };
      }
      // Approximate tokens freed: we don't track post-swap usage here
      // (the host knows it). Use the candidate's estimate as a floor
      // — actual freed bytes are >= summary size delta.
      const summaryEstimate = Math.max(
        0,
        Math.ceil(outcome.summary.sizeBytes / 4),
      );
      const freed = Math.max(0, tokensBefore - summaryEstimate);
      return { tokensFreed: freed };
    },
  };
}
