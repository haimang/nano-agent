/**
 * Canonical LLM Model Types
 *
 * Provider-agnostic message, content, request and response types.
 * Every provider adapter translates to/from these canonical shapes
 * so the rest of the system never touches provider-specific JSON.
 *
 * Inspired by codex-rs/model-provider-info ModelProviderInfo and
 * claude-code/services/api telemetry structures.
 */

import type { FinishReason, LLMUsage } from "./usage.js";
import type { LLMError } from "./errors.js";

// ── Content Parts ──────────────────────────────────────────────

/** Discriminator for content part variants. */
export type ContentPartKind = "text" | "image_url" | "tool_call" | "tool_result";

export interface TextContentPart {
  readonly kind: "text";
  readonly text: string;
}

export interface ImageUrlContentPart {
  readonly kind: "image_url";
  readonly url: string;
  readonly mimeType?: string;
}

export interface ToolCallContentPart {
  readonly kind: "tool_call";
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface ToolResultContentPart {
  readonly kind: "tool_result";
  readonly toolCallId: string;
  readonly content: string;
  readonly isError?: boolean;
}

/** Discriminated union of all content part shapes. */
export type CanonicalContentPart =
  | TextContentPart
  | ImageUrlContentPart
  | ToolCallContentPart
  | ToolResultContentPart;

// ── Messages ───────────────────────────────────────────────────

/** Allowed message roles in canonical form. */
export type CanonicalRole = "system" | "user" | "assistant" | "tool";

/** A single message in a canonical conversation. */
export interface CanonicalMessage {
  readonly role: CanonicalRole;
  readonly content: CanonicalContentPart[] | string;
  readonly name?: string;
}

// ── Request ────────────────────────────────────────────────────

/** Provider-agnostic LLM request payload. */
export interface CanonicalLLMRequest {
  readonly model: string;
  readonly messages: CanonicalMessage[];
  readonly reasoning?: { readonly effort: "low" | "medium" | "high" };
  readonly tools?: unknown[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly stream?: boolean;
  readonly jsonSchema?: unknown;
  readonly stopSequences?: string[];
  readonly metadata?: Record<string, unknown>;
}

// ── Streaming Events ───────────────────────────────────────────

export interface RequestStartedEvent {
  readonly type: "llm.request.started";
  readonly requestId: string;
  readonly modelId: string;
}

export interface DeltaEvent {
  readonly type: "delta";
  readonly content: string;
  readonly index: number;
}

export interface ToolCallEvent {
  readonly type: "tool_call";
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface FinishEvent {
  readonly type: "finish";
  readonly finishReason: FinishReason;
  readonly usage: LLMUsage;
}

export interface ErrorEvent {
  readonly type: "error";
  readonly error: LLMError;
}

/** Normalised streaming event emitted by every provider adapter. */
export type NormalizedLLMEvent =
  | RequestStartedEvent
  | DeltaEvent
  | ToolCallEvent
  | FinishEvent
  | ErrorEvent;

// ── Completed Result ───────────────────────────────────────────

/** Final result after a (possibly streamed) LLM call completes. */
export interface CanonicalLLMResult {
  readonly finishReason: FinishReason;
  readonly usage: LLMUsage;
  readonly content: CanonicalContentPart[];
  readonly model: string;
  readonly durationMs: number;
}
