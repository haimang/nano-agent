/**
 * Chat Completion Adapter Interface
 *
 * Each LLM provider implements this interface to translate between
 * the canonical ExecutionRequest and the provider's HTTP API format.
 */

import type { ExecutionRequest } from "../request-builder.js";
import type { NormalizedLLMEvent, CanonicalLLMResult } from "../canonical.js";

export interface ChatCompletionAdapter {
  /** Build the JSON request body for the provider's API. */
  buildRequestBody(exec: ExecutionRequest): unknown;

  /** Build HTTP headers (including auth) for the provider's API. */
  buildRequestHeaders(exec: ExecutionRequest): Record<string, string>;

  /** Parse a single SSE chunk into a normalized event (or null to skip). */
  parseStreamChunk(chunk: string): NormalizedLLMEvent | null;

  /** Parse a non-streaming JSON response body into a canonical result. */
  parseNonStreamResponse(body: unknown): CanonicalLLMResult;
}
