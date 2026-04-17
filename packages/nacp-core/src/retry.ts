/**
 * NACP Retry — protocol-level retry decision logic.
 *
 * Ported from SMCP's retry.ts (context/smcp/src/runtime/retry.ts).
 * Pure functions — no side effects, no timers.
 */

import { z } from "zod";

export const NacpRetryPolicySchema = z.object({
  max_attempts: z.number().int().min(1).max(20).default(3),
  base_delay_ms: z.number().int().min(0).default(200),
  max_delay_ms: z.number().int().min(0).default(10_000),
  jitter_ratio: z.number().min(0).max(1).default(0.2),
});
export type NacpRetryPolicy = z.infer<typeof NacpRetryPolicySchema>;

export const NacpRetryDecisionSchema = z.object({
  should_retry: z.boolean(),
  next_delay_ms: z.number().int().min(0),
  reason: z.enum([
    "attempts_remaining",
    "max_attempts_reached",
    "non_retryable_error",
  ]),
});
export type NacpRetryDecision = z.infer<typeof NacpRetryDecisionSchema>;

export function calculateBackoffDelay(
  attempt: number,
  policy: NacpRetryPolicy,
): number {
  const raw = Math.min(
    policy.base_delay_ms * 2 ** Math.max(attempt - 1, 0),
    policy.max_delay_ms,
  );
  const jitterMax = Math.floor(raw * policy.jitter_ratio);
  const jitter = jitterMax > 0 ? Math.floor(Math.random() * jitterMax) : 0;
  return raw + jitter;
}

export function decideRetry(
  attempt: number,
  policyInput: unknown,
  isRetryableError: boolean,
): NacpRetryDecision {
  const policy = NacpRetryPolicySchema.parse(policyInput);
  if (!isRetryableError) {
    return {
      should_retry: false,
      next_delay_ms: 0,
      reason: "non_retryable_error",
    };
  }
  if (attempt >= policy.max_attempts) {
    return {
      should_retry: false,
      next_delay_ms: 0,
      reason: "max_attempts_reached",
    };
  }
  return {
    should_retry: true,
    next_delay_ms: calculateBackoffDelay(attempt + 1, policy),
    reason: "attempts_remaining",
  };
}
