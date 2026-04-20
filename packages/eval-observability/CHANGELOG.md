# Changelog — @nano-agent/eval-observability

## 0.2.0 — 2026-04-20

B6 — SessionInspector dedup + overflow disclosure writeback. Per
`docs/rfc/nacp-core-1-2-0.md` §4.2 (sink dedup contract) and
`binding-F04`.

### Added

- `SessionInspector.onStreamEvent(kind, seq, body, meta?)` — optional
  `meta.messageUuid` drives **hard dedup**. Repeat `messageUuid`s are
  dropped and recorded in `getRejections()` with
  `reason: "duplicate-message"`.
- `SessionInspector.onSessionFrame(frame)` — convenience wrapper that
  extracts `header.message_uuid`, `body`, and
  `session_frame.stream_seq` from a NACP session frame.
- `SessionInspector.getDedupStats()` — exposes
  `{ dedupEligible, duplicatesDropped, missingMessageUuid }` counters.
  Used by B7 integrated spike to verify `binding-F04` conformance.
- `InspectorEvent.messageUuid` — optional field stored on accepted
  events for debug / correlation.
- `InspectorRejection.messageUuid` + new `reason: "duplicate-message"`
  variant.
- Types: `InspectorEventMeta`, `InspectorDedupStats`,
  `InspectorLikeSessionFrame` exported from the package root.

### Preserved

- Existing `onStreamEvent(kind, seq, body)` signature — the `meta`
  argument is optional. No caller break.
- Unknown-kind / invalid-body rejection semantics.

### Wire truth clarifications

- **Dedup key source is the NACP envelope `header.message_uuid`**, not
  any `session.stream.event` body field. See
  `packages/nacp-session/src/websocket.ts::postStreamEvent` where the
  uuid is stamped, and `docs/rfc/nacp-session-1-2-0.md` §6.2 (B6 drift
  fix 2026-04-20).

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
