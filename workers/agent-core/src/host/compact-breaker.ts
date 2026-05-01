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
// `recordSuccess()` when the next compact succeeds.
export function createCompactBreaker(threshold = 3): CompactBreaker {
  let failures = 0;
  return {
    canCompact() {
      return failures < threshold;
    },
    recordSuccess() {
      failures = 0;
    },
    recordFailure() {
      failures += 1;
    },
    reset() {
      failures = 0;
    },
    currentFailures() {
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
