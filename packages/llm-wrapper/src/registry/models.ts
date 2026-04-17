/**
 * Model Capability Registry
 *
 * Tracks per-model capabilities (streaming, tools, vision, JSON schema)
 * and context-window limits so callers can validate requests before dispatch.
 */

export interface ModelCapabilities {
  readonly modelId: string;
  readonly provider: string;
  readonly supportsStream: boolean;
  readonly supportsTools: boolean;
  readonly supportsVision: boolean;
  readonly supportsJsonSchema: boolean;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly notes?: string;
}

/** Capability names that can be queried via `checkCapability`. */
export type CapabilityName = "stream" | "tools" | "vision" | "json-schema";

export class ModelRegistry {
  private readonly models = new Map<string, ModelCapabilities>();

  /** Register model capabilities. Overwrites any existing entry for the same modelId. */
  register(cap: ModelCapabilities): void {
    if (!cap.modelId) {
      throw new Error("ModelCapabilities must have a non-empty modelId");
    }
    this.models.set(cap.modelId, cap);
  }

  /** Retrieve capabilities for a model by ID. */
  get(modelId: string): ModelCapabilities | undefined {
    return this.models.get(modelId);
  }

  /** List all registered model capabilities. */
  list(): ModelCapabilities[] {
    return Array.from(this.models.values());
  }

  /** Check whether a model supports a specific capability. Returns false for unknown models. */
  checkCapability(modelId: string, need: CapabilityName): boolean {
    const cap = this.models.get(modelId);
    if (!cap) return false;
    switch (need) {
      case "stream":
        return cap.supportsStream;
      case "tools":
        return cap.supportsTools;
      case "vision":
        return cap.supportsVision;
      case "json-schema":
        return cap.supportsJsonSchema;
    }
  }
}
