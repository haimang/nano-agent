/**
 * Request Builder
 *
 * Validates a CanonicalLLMRequest against model capabilities and
 * assembles an ExecutionRequest ready for the executor.
 */

import type { CanonicalLLMRequest } from "./canonical.js";
import type { ProviderProfile } from "./registry/providers.js";
import type { ModelCapabilities } from "./registry/models.js";
import { ProviderRegistry } from "./registry/providers.js";
import { ModelRegistry } from "./registry/models.js";
import { LlmWrapperError } from "./errors.js";

export interface ExecutionRequest {
  readonly provider: ProviderProfile;
  readonly model: ModelCapabilities;
  readonly request: CanonicalLLMRequest;
  readonly apiKey: string;
}

/**
 * Build a fully-validated execution request from a canonical request and registries.
 *
 * Checks:
 * - Model is registered
 * - Provider for the model is registered
 * - Streaming capability (if request.stream)
 * - Tools capability (if request.tools present)
 * - JSON schema capability (if request.jsonSchema present)
 * - Vision capability (if request contains image_url parts)
 * - Reasoning capability (if request.reasoning present)
 */
export function buildExecutionRequest(
  canonical: CanonicalLLMRequest,
  providers: ProviderRegistry,
  models: ModelRegistry,
): ExecutionRequest {
  const modelCap = models.get(canonical.model);
  if (!modelCap) {
    throw new LlmWrapperError(
      `Model "${canonical.model}" is not registered`,
      "MODEL_NOT_FOUND",
      "invalid_request",
    );
  }

  const provider = providers.get(modelCap.provider);
  if (!provider) {
    throw new LlmWrapperError(
      `Provider "${modelCap.provider}" for model "${canonical.model}" is not registered`,
      "PROVIDER_NOT_FOUND",
      "invalid_request",
    );
  }

  // Validate capabilities against request needs
  if (canonical.stream && !modelCap.supportsStream) {
    throw new LlmWrapperError(
      `Model "${canonical.model}" does not support streaming`,
      "CAPABILITY_MISSING",
      "invalid_request",
    );
  }

  if (canonical.tools && canonical.tools.length > 0 && !modelCap.supportsTools) {
    throw new LlmWrapperError(
      `Model "${canonical.model}" does not support tools`,
      "CAPABILITY_MISSING",
      "invalid_request",
    );
  }

  if (canonical.jsonSchema !== undefined && !modelCap.supportsJsonSchema) {
    throw new LlmWrapperError(
      `Model "${canonical.model}" does not support JSON schema`,
      "CAPABILITY_MISSING",
      "invalid_request",
    );
  }

  // Check vision capability if any message contains image_url parts
  const needsVision = canonical.messages.some((msg) => {
    if (typeof msg.content === "string") return false;
    return msg.content.some((part) => part.kind === "image_url");
  });
  if (needsVision && !modelCap.supportsVision) {
    throw new LlmWrapperError(
      `Model "${canonical.model}" does not support vision (image_url content found)`,
      "CAPABILITY_MISSING",
      "invalid_request",
    );
  }

  if (canonical.reasoning) {
    if (!modelCap.supportsReasoning) {
      throw new LlmWrapperError(
        `Model "${canonical.model}" does not support reasoning`,
        "CAPABILITY_MISSING",
        "invalid_request",
      );
    }
    const allowedEfforts = modelCap.reasoningEfforts ?? ["low", "medium", "high"];
    if (!allowedEfforts.includes(canonical.reasoning.effort)) {
      throw new LlmWrapperError(
        `Model "${canonical.model}" does not support reasoning effort "${canonical.reasoning.effort}"`,
        "CAPABILITY_MISSING",
        "invalid_request",
      );
    }
  }

  const apiKey = providers.getNextApiKey(modelCap.provider);

  return {
    provider,
    model: modelCap,
    request: canonical,
    apiKey,
  };
}
