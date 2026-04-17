# Changelog — @nano-agent/session-do-runtime

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
