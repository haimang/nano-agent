# @nano-agent/eval-observability

`eval-observability` is the trace/evidence semantics package used by tests and mirrored by `agent-core` runtime code. It defines event classification, durable-promotion rules, trace sinks, evidence bridges, replay helpers, timelines, scenario harnesses and metric-name vocabulary.

## Source map

```text
src/
├── trace-event.ts / types.ts             # trace event model
├── classification.ts                     # live, durable-audit and durable-transcript classification
├── durable-promotion-registry.ts         # why an event is durable or live-only
├── sink.ts / sinks/do-storage.ts         # sink contract and DO storage sink
├── timeline.ts / inspector.ts / replay.ts# timeline, live inspector and replay helpers
├── attribution.ts / audit-record.ts      # attribution and audit body codecs
├── evidence-bridge.ts / evidence-streams.ts / evidence-verdict.ts
├── placement-log.ts                      # storage placement evidence
├── scenario.ts / runner.ts               # scenario/test harness
├── truncation.ts / metric-names.ts       # output limits and metric vocabulary
└── index.ts                              # package exports
```

## Runtime posture

- `workers/agent-core/src/eval/` contains the active worker-local runtime mirror used by the session host.
- This package remains the package-level contract/test helper and should stay behavior-compatible with the worker mirror.
- Do not use this package as a production APM or billing engine; it is evidence/trace substrate, not an observability product.

## Validation

```bash
pnpm --filter @nano-agent/eval-observability typecheck
pnpm --filter @nano-agent/eval-observability build
pnpm --filter @nano-agent/eval-observability test
pnpm --filter @nano-agent/eval-observability build:schema
pnpm --filter @nano-agent/eval-observability build:docs
```
