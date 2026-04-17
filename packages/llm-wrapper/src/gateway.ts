/**
 * Inference Gateway Interface
 *
 * Future seam for plugging in alternative execution backends
 * (e.g. batch, caching proxy, model router).
 * Stub interface only — not implemented in v1.
 */

import type { ExecutionRequest } from "./request-builder.js";
import type { CanonicalLLMResult, NormalizedLLMEvent } from "./canonical.js";

export interface InferenceGateway {
  execute(exec: ExecutionRequest): Promise<CanonicalLLMResult>;
  executeStream(exec: ExecutionRequest): AsyncGenerator<NormalizedLLMEvent>;
}
