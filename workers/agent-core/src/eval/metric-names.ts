/**
 * @nano-agent/eval-observability — metric naming constants.
 *
 * Follows the hierarchical `agent.*` naming convention from codex's
 * otel/src/names.rs. All metric names use dot-separated segments with
 * snake_case leaf names for OTel compatibility.
 */

export const METRIC_NAMES = {
  // ── Turn metrics ──
  "agent.turn.started": "agent.turn.started",
  "agent.turn.completed": "agent.turn.completed",
  "agent.turn.duration_ms": "agent.turn.duration_ms",
  "agent.turn.ttft_ms": "agent.turn.ttft_ms",

  // ── Tool metrics ──
  "agent.tool.call": "agent.tool.call",
  "agent.tool.duration_ms": "agent.tool.duration_ms",

  // ── API / LLM metrics ──
  "agent.api.request": "agent.api.request",
  "agent.api.error": "agent.api.error",
  "agent.api.duration_ms": "agent.api.duration_ms",

  // ── Compaction metrics ──
  "agent.compact.started": "agent.compact.started",
  "agent.compact.duration_ms": "agent.compact.duration_ms",

  // ── Session lifecycle metrics ──
  "agent.session.started": "agent.session.started",
  "agent.session.ended": "agent.session.ended",
} as const;

/** Union of all known metric name strings. */
export type MetricName = (typeof METRIC_NAMES)[keyof typeof METRIC_NAMES];
