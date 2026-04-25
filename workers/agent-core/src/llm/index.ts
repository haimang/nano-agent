/**
 * @nano-agent/llm-wrapper — LLM Wrapper, Canonical Model & Provider Abstraction
 *
 * This is the public API surface. All consumers should import from here.
 */

// ── Version ──
export { LLM_WRAPPER_VERSION } from "./version.js";

// ── Usage & Finish Reason ──
export { createEmptyUsage } from "./usage.js";
export type { LLMUsage, FinishReason } from "./usage.js";

// ── Errors ──
export { LlmWrapperError } from "./errors.js";
export type { LLMErrorCategory, LLMError } from "./errors.js";

// ── Canonical Types ──
export type {
  ContentPartKind,
  TextContentPart,
  ImageUrlContentPart,
  ToolCallContentPart,
  ToolResultContentPart,
  CanonicalContentPart,
  CanonicalRole,
  CanonicalMessage,
  CanonicalLLMRequest,
  RequestStartedEvent,
  DeltaEvent,
  ToolCallEvent,
  FinishEvent,
  ErrorEvent,
  NormalizedLLMEvent,
  CanonicalLLMResult,
} from "./canonical.js";

// ── Registry ──
export { ProviderRegistry } from "./registry/providers.js";
export type { ProviderProfile } from "./registry/providers.js";
export { ModelRegistry } from "./registry/models.js";
export type { ModelCapabilities, CapabilityName } from "./registry/models.js";
export { loadRegistryFromConfig, loadRegistryFromEnv } from "./registry/loader.js";
export type { RegistryConfig } from "./registry/loader.js";

// ── Request Builder ──
export { buildExecutionRequest } from "./request-builder.js";
export type { ExecutionRequest } from "./request-builder.js";

// ── Attachment Planner ──
export { planAttachment, SUPPORTED_MIME_TYPES } from "./attachment-planner.js";
export type { AttachmentRoute, AttachmentPlan, LegacyAttachmentRoute } from "./attachment-planner.js";

// ── Prepared Artifact ──
export type { PreparedArtifactRef, ArtifactRefLike } from "./prepared-artifact.js";
export { toWorkspacePreparedArtifactRef } from "./prepared-artifact.js";

// ── Adapters ──
export type { ChatCompletionAdapter } from "./adapters/types.js";
export { OpenAIChatAdapter } from "./adapters/openai-chat.js";

// ── Executor ──
export { LLMExecutor } from "./executor.js";
export type { LLMExecutorOptions } from "./executor.js";

// ── Stream Normalizer ──
export { normalizeStreamChunks } from "./stream-normalizer.js";

// ── Session Stream Adapter ──
export { mapLlmEventToSessionBody } from "./session-stream-adapter.js";
export type { SessionEventBody, SessionEventKind } from "./session-stream-adapter.js";

// ── Gateway ──
export {
  WORKERS_AI_PROVIDER_KEY,
  WorkersAiGateway,
  buildWorkersAiExecutionRequestFromMessages,
  toCanonicalMessage,
} from "./gateway.js";
export type { InferenceGateway } from "./gateway.js";

// ── Provider Skeletons ──
export { executeDeepSeekSkeleton } from "./adapters/deepseek/index.js";
export type { DeepSeekAdapterSkeleton } from "./adapters/deepseek/index.js";
