/**
 * @nano-agent/hooks — safety guards for hook execution.
 *
 * Provides timeout enforcement and recursion-depth checking to prevent
 * runaway hook handlers from blocking the agent loop.
 */

export interface GuardOptions {
  timeoutMs: number;
  maxDepth: number;
}

export const DEFAULT_GUARD_OPTIONS: GuardOptions = {
  timeoutMs: 10_000,
  maxDepth: 3,
};

/**
 * Run an async function with a timeout. Rejects with a descriptive error
 * if the function does not resolve within `timeoutMs` milliseconds.
 *
 * If an `abortSignal` is already aborted, rejects immediately.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<T> {
  if (abortSignal?.aborted) {
    throw new Error("Aborted before execution");
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Hook handler timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const onAbort = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("Hook handler aborted"));
      }
    };

    abortSignal?.addEventListener("abort", onAbort, { once: true });

    fn().then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          abortSignal?.removeEventListener("abort", onAbort);
          resolve(value);
        }
      },
      (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          abortSignal?.removeEventListener("abort", onAbort);
          reject(err);
        }
      },
    );
  });
}

/**
 * Throws if `currentDepth` exceeds `maxDepth`.
 * Used to prevent infinite hook-triggers-hook recursion.
 */
export function checkDepth(currentDepth: number, maxDepth: number): void {
  if (currentDepth > maxDepth) {
    throw new Error(
      `Hook recursion depth ${currentDepth} exceeds maximum of ${maxDepth}`,
    );
  }
}
