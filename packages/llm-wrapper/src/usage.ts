/**
 * LLM Usage & Finish Reason Types
 *
 * Token-level usage tracking and completion reason classification.
 * Inspired by claude-code/services/api/logging.ts telemetry patterns.
 */

/** Token usage for a single LLM request/response cycle. */
export interface LLMUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens?: number;
  readonly cacheReadTokens?: number;
  readonly totalTokens: number;
}

/** Why the model stopped generating. */
export type FinishReason =
  | "stop"
  | "tool_calls"
  | "length"
  | "content_filter"
  | "unknown";

/** Create a zero-valued usage object. */
export function createEmptyUsage(): LLMUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}
