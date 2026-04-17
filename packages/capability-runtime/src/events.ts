/**
 * Capability Execution Events
 *
 * Internal event types emitted during capability execution.
 * These are consumed by the orchestrator and observability layer,
 * NOT surfaced directly to external clients.
 */

/** Lifecycle stages of a capability execution. */
export type CapabilityEventKind =
  | "started"
  | "progress"
  | "completed"
  | "error"
  | "cancelled"
  | "timeout";

/** A single event emitted during capability execution. */
export interface CapabilityEvent {
  readonly kind: CapabilityEventKind;
  readonly capabilityName: string;
  readonly requestId: string;
  readonly timestamp: string;
  readonly detail?: unknown;
}
