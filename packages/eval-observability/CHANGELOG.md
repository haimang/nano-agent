# Changelog — @nano-agent/eval-observability

## 0.1.0 — 2026-04-17

Initial implementation of the eval-observability validation-infrastructure
library.

### Added

- Trace taxonomy: `TraceEvent` base fields + LLM / tool / storage evidence
  extensions.
- Three-way classification: `live`, `durable-audit`, `durable-transcript`
  sets plus `classifyEvent()` and `shouldPersist()` helpers.
- `DurablePromotionRegistry` with an enumerable default rule set.
- `TraceSink` seam and `DoStorageTraceSink`: append-only JSONL, tenant-scoped
  key (`tenants/{teamUuid}/trace/{sessionUuid}/{YYYY-MM-DD}.jsonl`), durable
  date index for hibernation-safe `readTimeline()`, optional `list(prefix)`
  fast path.
- `audit.record` codec (`traceEventToAuditBody` / `auditBodyToTraceEvent`)
  aligned with `@nano-agent/nacp-core`.
- `SessionTimeline` with a generic `TraceTimelineReader` seam for both live
  sink reads and HTTP-fallback durable reads.
- `SessionInspector` that strictly consumes the 9 canonical
  `session.stream.event` kinds, with an optional body validator, a drift
  guard test against `@nano-agent/nacp-session`, and rejection diagnostics.
- `ScenarioSpec` / `ScenarioRunner` / `ScenarioResult` DSL + runner.
- `FailureReplayHelper` over a `SessionTimeline`.
- `StoragePlacementLog` for DO/KV/R2 placement evidence.
- `buildLlmAttribution` / `buildToolAttribution` — the `tool` variant now
  surfaces `toolName` and `resultSizeBytes` alongside the shared LLM/tool
  `AttributionRecord`.
- `metric-names` baseline constants.
- `truncateOutput` / `TRACE_OUTPUT_MAX_BYTES` budget helpers.
- Integration tests covering durable-write → timeline read, failure replay
  over a durable sink, and WS inspector + HTTP-fallback durable read.
- `scripts/export-schema.ts` and `scripts/gen-trace-doc.ts` for generating
  the review-able schema manifest and trace contract doc.
