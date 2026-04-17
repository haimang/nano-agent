/**
 * @nano-agent/eval-observability — TraceEvent schema.
 *
 * Defines the base trace-event shape and extension slots for LLM evidence,
 * tool evidence, and storage evidence. The full TraceEvent is the intersection
 * of the base with partial extensions, allowing a single event to carry
 * evidence from multiple subsystems.
 */

import type { EventAudience, TraceLayer } from "./types.js";

/** Base fields present on every trace event. */
export interface TraceEventBase {
  readonly eventKind: string;
  readonly timestamp: string;
  readonly sessionUuid: string;
  readonly teamUuid: string;
  readonly turnUuid?: string;
  readonly stepIndex?: number;
  readonly durationMs?: number;
  readonly audience: EventAudience;
  readonly layer: TraceLayer;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

/** Extension slot for LLM / API call evidence. */
export interface LlmEvidenceExtension {
  readonly usageTokens?: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead?: number;
  };
  readonly ttftMs?: number;
  readonly attempt?: number;
  readonly provider?: string;
  readonly gateway?: string;
  readonly cacheState?: string;
  readonly cacheBreakReason?: string;
  readonly model?: string;
}

/** Extension slot for tool-call evidence. */
export interface ToolEvidenceExtension {
  readonly toolName?: string;
  readonly resultSizeBytes?: number;
  readonly durationMs?: number;
}

/** Extension slot for storage-operation evidence. */
export interface StorageEvidenceExtension {
  readonly storageLayer?: string;
  readonly key?: string;
  readonly op?: string;
  readonly sizeBytes?: number;
}

/**
 * A fully-resolved trace event.
 *
 * Combines the base with partial evidence extensions so that a single event
 * can carry data from the LLM subsystem, a tool call, and/or a storage op.
 */
export type TraceEvent =
  & TraceEventBase
  & Partial<LlmEvidenceExtension>
  & Partial<ToolEvidenceExtension>
  & Partial<StorageEvidenceExtension>;
