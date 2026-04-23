# @nano-agent/eval-observability

Trace taxonomy, durable sink, timeline, scenario runner, failure replay and
attribution helpers for nano-agent.

This package is a **validation-infrastructure library** — not a production
APM. It frames what nano-agent persists, what it merely streams, and what
gets replayed; it does **not** wire up storage, dashboards or telemetry
exporters.

---

## Three-way trace layers

| Layer | Purpose | Examples |
|-------|---------|----------|
| `live` | Ephemeral, high-frequency, never persisted | `llm.delta`, `tool.call.progress`, `session.update`, `system.notify` |
| `durable-audit` | Persisted structural + governance evidence | `turn.begin`, `turn.end`, `api.request/response/error`, `hook.outcome`, `compact.start/end`, `session.start/end` |
| `durable-transcript` | User-visible conversation record | `user.message`, `assistant.message`, `tool.call.request`, `tool.call.result` |

The `classifyEvent()` and `shouldPersist()` helpers are the single source of
truth. `DurablePromotionRegistry` carries the per-kind *why* (granularity,
replay visibility, revisit condition).

---

## Main exports

```ts
import {
  // Types
  TraceEvent,
  TraceTimelineReader,
  AttributionRecord,

  // Classification
  classifyEvent,
  shouldPersist,
  LIVE_ONLY_EVENTS,
  DURABLE_AUDIT_EVENTS,
  DURABLE_TRANSCRIPT_EVENTS,
  DurablePromotionRegistry,
  createDefaultRegistry,

  // Persistence
  DoStorageTraceSink,
  SessionTimeline,

  // Live / replay
  SessionInspector,
  SESSION_STREAM_EVENT_KINDS,
  ScenarioRunner,
  FailureReplayHelper,

  // Evidence
  buildLlmAttribution,
  buildToolAttribution,
  StoragePlacementLog,

  // Audit codec
  traceEventToAuditBody,
  auditBodyToTraceEvent,

  // Budgets
  truncateOutput,
  TRACE_OUTPUT_MAX_BYTES,
  METRIC_NAMES,
} from "@nano-agent/eval-observability";
```

---

## Durable sink contract

`DoStorageTraceSink` writes append-only JSONL under the
**tenant-scoped** key pattern:

```
tenants/{teamUuid}/trace/{sessionUuid}/{YYYY-MM-DD}.jsonl
```

A companion `_index` key stores the set of date-keys written, so a brand
new sink instance (e.g. after DO hibernation / restart) can reconstruct
the full timeline without relying on in-process state. When the underlying
storage exposes `list(prefix)`, the sink prefers it over the index.

```ts
const sink = new DoStorageTraceSink(storage, teamUuid, sessionUuid);
await sink.emit({
  eventKind: "turn.begin",
  timestamp: new Date().toISOString(),
  // Trace-law carriers (A3): every event MUST declare the owning
  // trace UUID and the producing source role.
  traceUuid,
  sourceRole: "session",
  sourceKey: "nano-agent.session.do@v1",
  sessionUuid,
  teamUuid,
  audience: "internal",
  layer: "durable-audit",
});
const timeline = await SessionTimeline.fromSink(sink);
```

`SessionTimeline.fromSink()` accepts any `TraceTimelineReader` — the same
seam is used for HTTP-fallback durable reads from a reconnecting client.

---

## Live inspector contract

`SessionInspector` strictly consumes the **9 canonical
`session.stream.event` kinds** mirrored locally from
`@haimang/nacp-session`:

```
tool.call.progress   tool.call.result   hook.broadcast
session.update       turn.begin         turn.end
compact.notify       system.notify      llm.delta
```

Unknown kinds are rejected and surfaced via `getRejections()`. An optional
body validator (e.g. `SessionStreamEventBodySchema.safeParse`) can be
injected to also reject invalid bodies. `filterByKind()` and `getLatest()`
preserve `seq` and `timestamp` so ordering and duplicate-delivery bugs can
be diagnosed off the live stream.

The inspector models WebSocket-first observation; HTTP-fallback durable
reads go through `SessionTimeline.fromSink(fallbackReader)`. The two views
are independently consumable and can be joined downstream.

---

## v1 limits & out-of-scope

This package deliberately does NOT include:

- A production APM, alerting engine or dashboard.
- Any cross-tenant audit query API.
- A full OTEL SDK / OTLP exporter (`metric-names` is a naming baseline
  only).
- Billing / cost accounting pipelines.
- An LLM quality benchmark platform.
- Client-side UI framework bits.
- D1 / structured-query storage for trace events — v1 is append + scan only.
- Blind `durable`-ification of high-frequency `session.stream.event`s such
  as `llm.delta` or `tool.call.progress`.
- A long-running Worker-embedded scenario runner — `ScenarioRunner` is a
  test harness.
- Final R2 archive orchestration (`StoragePlacementLog` is evidence only).

---

## Scripts

```
npm run build       # tsc → dist/
npm run typecheck
npm run test
npm run test:coverage
npx tsx scripts/export-schema.ts   # dist/eval-observability.schema.json
npx tsx scripts/gen-trace-doc.ts   # dist/trace-contract.md
```
