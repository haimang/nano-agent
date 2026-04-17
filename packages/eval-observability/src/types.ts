/**
 * @nano-agent/eval-observability — base types.
 *
 * TraceLayer implements the three-way split from design doc v0.2 section 5.3:
 *  - "live"              : ephemeral, streamed to connected clients only
 *  - "durable-audit"     : persisted for compliance / replay
 *  - "durable-transcript": persisted, forms the user-facing conversation record
 *
 * EventAudience controls downstream visibility of trace events.
 */

/** The three-way durability split for trace events. */
export type TraceLayer = "live" | "durable-audit" | "durable-transcript";

/** Visibility scope for a trace event. */
export type EventAudience = "internal" | "audit-only" | "client-visible";
