/**
 * Stream Normalizer
 *
 * Consumes an async iterable of raw SSE lines (strings) and yields
 * NormalizedLLMEvents via the provided adapter's parseStreamChunk method.
 */

import type { ChatCompletionAdapter } from "./adapters/types.js";
import type { NormalizedLLMEvent } from "./canonical.js";

/**
 * Normalize provider-specific SSE chunks to internal events.
 *
 * Skips null parse results (e.g. empty lines, [DONE] markers, etc.).
 */
export async function* normalizeStreamChunks(
  chunks: AsyncIterable<string>,
  adapter: ChatCompletionAdapter,
): AsyncGenerator<NormalizedLLMEvent> {
  for await (const chunk of chunks) {
    const event = adapter.parseStreamChunk(chunk);
    if (event) {
      yield event;
    }
  }
}
