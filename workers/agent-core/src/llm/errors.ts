/**
 * LLM-Specific Error Types
 *
 * Categorised error types for provider-agnostic error handling.
 * Providers map their HTTP status codes / error payloads into these categories
 * so upstream code can make consistent retry / fallback decisions.
 */

/** High-level error category for LLM provider failures. */
export type LLMErrorCategory =
  | "auth"
  | "rate_limit"
  | "context_length"
  | "invalid_request"
  | "server_error"
  | "network"
  | "timeout"
  | "unknown";

/** Structured error payload returned alongside normalised events. */
export interface LLMError {
  readonly category: LLMErrorCategory;
  readonly message: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly requestId?: string;
  readonly provider?: string;
}

/**
 * Throwable error class for the llm-wrapper package.
 *
 * Carries a machine-readable `code` and an `LLMErrorCategory` so callers
 * can branch on either without parsing the message string.
 */
export class LlmWrapperError extends Error {
  public readonly code: string;
  public readonly category: LLMErrorCategory;

  constructor(message: string, code: string, category: LLMErrorCategory) {
    super(message);
    this.name = "LlmWrapperError";
    this.code = code;
    this.category = category;
  }
}
