/**
 * @nano-agent/eval-observability — base types.
 *
 * TraceLayer implements the three-way split from design doc v0.2 section 5.3:
 *  - "live"              : ephemeral, streamed to connected clients only
 *  - "durable-audit"     : persisted for compliance / replay
 *  - "durable-transcript": persisted, forms the user-facing conversation record
 *
 * A3 adds a separate conceptual-layering language (Anchor / Durable /
 * Diagnostic, AX-QNA Q7). That language is *not* an implementation enum —
 * it is a review / governance vocabulary. {@link CONCEPTUAL_LAYER_OF_TRACE_LAYER}
 * maps the implementation enum onto the conceptual layer so docs and code
 * stay in sync without inventing a second runtime type.
 *
 * EventAudience controls downstream visibility of trace events.
 *
 * TraceSourceRole mirrors the NACP producer role enum in spirit but is
 * narrower: it only lists the roles that actually produce trace events
 * (the `queue` role does not, for example). It is the required
 * `sourceRole` field on {@link TraceEventBase}.
 */

/** The three-way durability split for trace events (implementation enum). */
export type TraceLayer = "live" | "durable-audit" | "durable-transcript";

/** Visibility scope for a trace event. */
export type EventAudience = "internal" | "audit-only" | "client-visible";

/**
 * Conceptual layering (A3 / P2 / AX-QNA Q7). Intentionally distinct from
 * {@link TraceLayer}:
 *  - `anchor`     : cannot be dropped; used for trace recovery.
 *  - `durable`    : must be kept for replay / audit.
 *  - `diagnostic` : sampled / ephemeral; may be dropped at the sink.
 */
export type ConceptualTraceLayer = "anchor" | "durable" | "diagnostic";

/**
 * Mapping between the implementation enum and the conceptual layer. The
 * mapping is surjective on purpose — some durable-audit events (such as
 * `turn.begin` / `turn.end`) are also anchors; that distinction lives in
 * {@link DurablePromotionEntry.conceptualLayer}, not in this table.
 */
export const CONCEPTUAL_LAYER_OF_TRACE_LAYER: Record<
  TraceLayer,
  ConceptualTraceLayer
> = {
  live: "diagnostic",
  "durable-audit": "durable",
  "durable-transcript": "durable",
} as const;

/**
 * Narrowed producer-role taxonomy for trace events. Keeps the enum aligned
 * with NACP's canonical roles while recognising that not every canonical
 * role produces traces on the hot path (queue consumers, for instance).
 */
export type TraceSourceRole =
  | "session"
  | "hook"
  | "skill"
  | "capability"
  | "ingress"
  | "client"
  | "platform";
