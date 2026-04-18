/**
 * @nano-agent/eval-observability — Durable Promotion Registry.
 *
 * An enumerable registry of durable promotion rules. Each entry describes how
 * a given event kind is promoted from the live layer into a durable layer,
 * at what granularity, and under what conditions it should be revisited.
 *
 * The registry is the business-owner-auditable artefact that answers:
 * "What do we persist, why, and at what fidelity?"
 */

import type { ConceptualTraceLayer, TraceLayer } from "./types.js";

/** A single durable promotion rule. */
export interface DurablePromotionEntry {
  /** The event kind this rule applies to (e.g. "turn.begin"). */
  readonly eventKind: string;
  /** Target durable layer (implementation enum). */
  readonly layer: TraceLayer;
  /**
   * Conceptual layer (A3 / P2 / AX-QNA Q7). This is the review / governance
   * vocabulary: `anchor` events are trace-recovery load-bearing, `durable`
   * events must survive replay, `diagnostic` events may be dropped. The
   * conceptual layer is chosen by the registry author; it is NOT derived
   * from {@link TraceLayer}. `turn.begin` is `durable-audit` at the
   * implementation level but `anchor` at the conceptual level.
   */
  readonly conceptualLayer: ConceptualTraceLayer;
  /** How much detail is persisted. */
  readonly granularity: "full" | "summary" | "sample";
  /** Whether this event should be visible during session replay. */
  readonly replayVisible: boolean;
  /** Human-readable condition under which this rule should be revisited. */
  readonly revisitCondition: string;
  /** Human-readable description of why this event is promoted. */
  readonly description: string;
}

/**
 * Enumerable registry of durable promotion rules.
 *
 * Supports registration, lookup by event kind, full enumeration, and
 * filtering by target layer.
 */
export class DurablePromotionRegistry {
  private readonly entries = new Map<string, DurablePromotionEntry>();

  /** Register a promotion rule. Overwrites any existing rule for the same event kind. */
  register(entry: DurablePromotionEntry): void {
    this.entries.set(entry.eventKind, entry);
  }

  /** Look up the promotion rule for a given event kind, or undefined if none. */
  get(eventKind: string): DurablePromotionEntry | undefined {
    return this.entries.get(eventKind);
  }

  /** Return all registered promotion rules. */
  list(): readonly DurablePromotionEntry[] {
    return [...this.entries.values()];
  }

  /** Return all promotion rules targeting a specific durable layer. */
  listByLayer(layer: TraceLayer): readonly DurablePromotionEntry[] {
    return [...this.entries.values()].filter((e) => e.layer === layer);
  }

  /** Return all rules at a given conceptual layer (anchor / durable / diagnostic). */
  listByConceptualLayer(
    conceptualLayer: ConceptualTraceLayer,
  ): readonly DurablePromotionEntry[] {
    return [...this.entries.values()].filter(
      (e) => e.conceptualLayer === conceptualLayer,
    );
  }
}

/**
 * Create a registry pre-populated with the default v1 promotion rules.
 *
 * These rules codify the initial set of events that are promoted from the
 * live layer into durable storage, along with their granularity and replay
 * visibility settings.
 */
export function createDefaultRegistry(): DurablePromotionRegistry {
  const registry = new DurablePromotionRegistry();

  // ── Durable transcript events ──
  registry.register({
    eventKind: "user.message",
    layer: "durable-transcript",
    conceptualLayer: "durable",
    granularity: "full",
    replayVisible: true,
    revisitCondition: "PII policy change",
    description: "User messages form the conversation record.",
  });
  registry.register({
    eventKind: "assistant.message",
    layer: "durable-transcript",
    conceptualLayer: "durable",
    granularity: "full",
    replayVisible: true,
    revisitCondition: "PII policy change",
    description: "Assistant messages form the conversation record.",
  });
  registry.register({
    eventKind: "tool.call.request",
    layer: "durable-transcript",
    conceptualLayer: "durable",
    granularity: "full",
    replayVisible: true,
    revisitCondition: "Output size grows beyond truncation budget",
    description: "Tool call requests are needed for transcript fidelity.",
  });
  registry.register({
    eventKind: "tool.call.result",
    layer: "durable-transcript",
    conceptualLayer: "durable",
    granularity: "summary",
    replayVisible: true,
    revisitCondition: "Output size grows beyond truncation budget",
    description: "Tool results are truncated to summary for storage efficiency.",
  });

  // ── Anchor events (load-bearing for trace recovery) ──
  registry.register({
    eventKind: "turn.begin",
    layer: "durable-audit",
    conceptualLayer: "anchor",
    granularity: "full",
    replayVisible: true,
    revisitCondition: "None — structural event",
    description: "Turn boundaries anchor trace recovery and enable replay segmentation.",
  });
  registry.register({
    eventKind: "turn.end",
    layer: "durable-audit",
    conceptualLayer: "anchor",
    granularity: "full",
    replayVisible: true,
    revisitCondition: "None — structural event",
    description: "Turn boundaries anchor trace recovery and enable replay segmentation.",
  });
  registry.register({
    eventKind: "session.start",
    layer: "durable-audit",
    conceptualLayer: "anchor",
    granularity: "full",
    replayVisible: true,
    revisitCondition: "None — structural event",
    description: "Session lifecycle anchor for trace recovery + audit trail.",
  });
  registry.register({
    eventKind: "session.end",
    layer: "durable-audit",
    conceptualLayer: "anchor",
    granularity: "full",
    replayVisible: true,
    revisitCondition: "None — structural event",
    description: "Session lifecycle anchor for trace recovery + audit trail.",
  });

  // ── Durable audit events (non-anchor) ──
  registry.register({
    eventKind: "hook.outcome",
    layer: "durable-audit",
    conceptualLayer: "durable",
    granularity: "full",
    replayVisible: false,
    revisitCondition: "Hook payload schema change",
    description: "Hook outcomes are audited for governance compliance.",
  });
  registry.register({
    eventKind: "hook.broadcast",
    layer: "durable-audit",
    conceptualLayer: "durable",
    granularity: "summary",
    replayVisible: true,
    revisitCondition: "Hook broadcast payload schema change",
    description: "Hook broadcasts are durably kept so replay can explain hook-visible effects.",
  });
  registry.register({
    eventKind: "compact.start",
    layer: "durable-audit",
    conceptualLayer: "durable",
    granularity: "summary",
    replayVisible: false,
    revisitCondition: "Compaction strategy change",
    description: "Compaction events track context-window management.",
  });
  registry.register({
    eventKind: "compact.end",
    layer: "durable-audit",
    conceptualLayer: "durable",
    granularity: "summary",
    replayVisible: false,
    revisitCondition: "Compaction strategy change",
    description: "Compaction events track context-window management.",
  });
  registry.register({
    eventKind: "compact.notify",
    layer: "durable-audit",
    conceptualLayer: "durable",
    granularity: "summary",
    replayVisible: true,
    revisitCondition: "Compaction notification schema change",
    description: "Compact notifications are durably kept so replay can explain context-window changes.",
  });
  registry.register({
    eventKind: "api.request",
    layer: "durable-audit",
    conceptualLayer: "durable",
    granularity: "summary",
    replayVisible: false,
    revisitCondition: "Token cost attribution change",
    description: "API requests are audited for cost tracking and debugging.",
  });
  registry.register({
    eventKind: "api.response",
    layer: "durable-audit",
    conceptualLayer: "durable",
    granularity: "summary",
    replayVisible: false,
    revisitCondition: "Token cost attribution change",
    description: "API responses are audited for cost tracking and debugging.",
  });
  registry.register({
    eventKind: "api.error",
    layer: "durable-audit",
    conceptualLayer: "durable",
    granularity: "full",
    replayVisible: false,
    revisitCondition: "Error taxonomy change",
    description: "API errors are fully persisted for incident investigation.",
  });

  return registry;
}
