// HP3-D2 / HP3-D4 (deferred-closure absorb) — compact signal probe +
// circuit breaker.
//
// Lifted out of `runtime-mainline.ts` to keep that file within its HP8
// P3-01 megafile budget (Q25). The semantics are unchanged.

export interface CompactBreaker {
  readonly canCompact: () => boolean;
  readonly recordSuccess: () => void;
  readonly recordFailure: () => void;
  readonly reset: () => void;
  readonly currentFailures: () => number;
}

// Tracks consecutive compact failures within a single host instance and
// blocks the compact path after `threshold` failures. Reset by
// `recordSuccess()` when the next compact succeeds, or by the cool-down
// window so transient compact failures cannot permanently disable compact.
export function createCompactBreaker(
  threshold = 3,
  cooldownMs = 7 * 60 * 1000,
  now: () => number = () => Date.now(),
): CompactBreaker {
  const failureThreshold = Math.max(1, Math.floor(threshold));
  const resetAfterMs = Math.max(1, Math.floor(cooldownMs));
  let failures = 0;
  let openedAt: number | null = null;

  function resetIfCooledDown(): void {
    if (openedAt === null) return;
    if (now() - openedAt < resetAfterMs) return;
    failures = 0;
    openedAt = null;
  }

  function reset(): void {
    failures = 0;
    openedAt = null;
  }

  return {
    canCompact() {
      resetIfCooledDown();
      return failures < failureThreshold;
    },
    recordSuccess() {
      reset();
    },
    recordFailure() {
      failures += 1;
      if (failures >= failureThreshold && openedAt === null) {
        openedAt = now();
      }
    },
    reset,
    currentFailures() {
      resetIfCooledDown();
      return failures;
    },
  };
}

// Compose a `compactSignalProbe` from a budget source + breaker.
// `budgetSource()` returns true when the upstream context-control-plane
// thinks compact is required (e.g. estimated_used_tokens >=
// auto_compact_token_limit). The breaker veto is checked first so an
// open breaker silences the signal regardless of budget.
export function composeCompactSignalProbe(
  budgetSource: () => Promise<boolean> | boolean,
  breaker: CompactBreaker,
): () => Promise<boolean> {
  return async () => {
    if (!breaker.canCompact()) return false;
    try {
      return Boolean(await budgetSource());
    } catch {
      return false;
    }
  };
}
