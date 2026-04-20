# Changelog — @nano-agent/session-do-runtime

## 0.2.0 — 2026-04-20

B6 — default eval sink upgrade. Per `binding-F04` / `docs/rfc/nacp-core-1-2-0.md` §4.2.

### Added

- `BoundedEvalSink` (`src/eval-sink.ts`) — bounded FIFO sink with:
  - Hard dedup on envelope `messageUuid` when records carry one.
  - Explicit `overflowCount` counters + ring buffer of recent
    `EvalSinkOverflowDisclosure` records.
  - Optional `onOverflow` callback for host-driven `EvalSinkOverflow`
    hook emission.
- `extractMessageUuid(record)` helper — walks the record shapes
  `defaultEvalRecords` callers emit (`{ messageUuid }` /
  `{ envelope: { header: { message_uuid } } }` / loose
  `{ header: { message_uuid } }`).
- `NanoSessionDO.getDefaultEvalDisclosure()` — new read accessor for
  the overflow-disclosure ring buffer. Satisfies `binding-F04` "silent
  drop is non-conformant".
- `NanoSessionDO.getDefaultEvalStats()` — counters snapshot.

### Changed

- `NanoSessionDO.defaultEvalRecords` replaced by `defaultEvalSink:
  BoundedEvalSink`. Capacity unchanged (1024); overflow semantics are
  now observable instead of silent.
- `NanoSessionDO.getDefaultEvalRecords()` now delegates to the bounded
  sink. Return shape (`readonly unknown[]`) unchanged — no caller
  break.

### Preserved

- B5 `Setup` / `Stop` hook emission, orchestrator hook order, and all
  332 existing tests. Shutdown order remains Stop → SessionEnd →
  checkpoint → flush → close.

## 0.1.0 — 2026-04-17

Initial v1 implementation + post-review corrections.

### Added

- Worker entry `src/worker.ts` that forwards `/sessions/:id/...`
  requests to the DO namespace stub, and re-exports `NanoSessionDO` so
  Wrangler can discover the DO class.
- `NanoSessionDO` class: fetch, webSocketMessage, webSocketClose, alarm.
- `SessionOrchestrator` that emits **only** the canonical 9-kind
  `SessionStreamEventBodySchema` bodies:
  - Turn start → `turn.begin` with `turn_uuid`.
  - Turn end   → `turn.end`   with `turn_uuid`.
  - Turn cancel / budget exhaustion → `system.notify` with severity.
  - Session end → `system.notify` with severity `"info"`.
- WebSocket ingress that reads `session.resume.body.last_seen_seq`
  (the real SessionResumeBody field), not an invented `checkpoint` field.
- `CompositionFactory` seam + `createDefaultCompositionFactory()`; the
  DO class now threads composition handles through the orchestrator
  deps instead of inlining hardcoded stubs.
- `validateSessionCheckpoint` tightened: UUID `sessionUuid`, canonical
  `actorPhase`, non-negative-integer `turnCount` + `streamSeqs`, valid
  `checkpointedAt` timestamp.
- `restoreSessionCheckpoint(raw, deps)` helper that validates the
  checkpoint and dispatches each fragment to its owning subsystem.
- DO storage persistence for `session:checkpoint` and
  `session:lastSeenSeq`.
- Alarm handler now reschedules via `state.storage.setAlarm()` when
  supported.
- `test/http-controller.test.ts`, `test/ws-controller.test.ts`,
  `test/turn-ingress.test.ts` — the three controller / ingress unit
  tests the action-plan called for.
- `test/worker.test.ts` for the new Worker entry.
- `test/integration/stream-event-schema.test.ts` that reverse-validates
  every orchestrator-emitted body against the real
  `SessionStreamEventBodySchema`.
- `README.md` + `CHANGELOG.md`.

### Changed

- `pushStreamEvent(kind, body)` now REQUIRES the body to include the
  `kind` discriminator so it parses under `SessionStreamEventBodySchema`
  directly. The orchestrator emits every body in this shape.
- Integration tests updated to use valid UUID `sessionUuid` values so
  they exercise the tightened validator.
