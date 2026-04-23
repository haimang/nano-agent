# Changelog — @nano-agent/session-do-runtime

## Unreleased — 2026-04-23 (worker-matrix P5/D09 DEPRECATED)

### Deprecated

- Full runtime ownership absorbed into `workers/agent-core/src/host/` as A1 host shell per worker-matrix D01 (P1). Package is now a **coexistence duplicate** kept as-is until the post-worker-matrix physical delete charter. `NanoSessionDO` / `SessionOrchestrator` / `SessionWebSocketHelper` / composition factory / remote-bindings are all canonically owned by `workers/agent-core`. README banner added.
- Coexistence-period bug-fix discipline unchanged (W3 pattern §6: fix here first, sync into `workers/agent-core/src/host/`).
- No runtime / public-API changes in this entry — code is byte-identical to prior.

## Unreleased — 2026-04-22 (W0 pre-worker-matrix compat adapt)

### Changed

- `src/cross-seam.ts` now re-exports propagation truth from `@haimang/nacp-core@1.4.0` while keeping `CrossSeamError`, `CROSS_SEAM_FAILURE_REASONS`, and `StartupQueue` local.
- `src/eval-sink.ts` now re-exports `EvalSinkEmitArgs`, `EvalSinkOverflowDisclosure`, `EvalSinkStats`, and `extractMessageUuid()` from `@haimang/nacp-core@1.4.0` while keeping `BoundedEvalSink` local.
- These are compat / import-topology updates only; runtime behavior and package version stay unchanged in W0.

## 0.3.0 — 2026-04-21 (B9 — tenant plumbing + NACP 1.3 consumer)

> Version baseline note: the previous `0.2.0` CHANGELOG entry existed as a B6 historical record for the `BoundedEvalSink` shipment, but `package.json` remained at `0.1.0` (the `0.2.0` tag was never actually published). B9 jumps `0.1.0 → 0.3.0` and lets the historical `0.2.0` section below stand as the record of B6 work. Per B9 GPT review R4.

### Added

- Explicit dependency on `@haimang/nacp-core` (previously transitive via `@haimang/nacp-session`). B9 imports `verifyTenantBoundary`, `tenantDoStorageGet`, `tenantDoStoragePut`, `tenantDoStorageDelete` directly from nacp-core.
- `NanoSessionDO.tenantTeamUuid()` — single source-of-truth for the DO's tenant identity (reads `env.TEAM_UUID`, falls back to `"_unknown"` for the test harness).
- `NanoSessionDO.getTenantScopedStorage()` — returns a `DoStorageLike`-shaped proxy whose every put/get/delete goes through nacp-core's `tenantDoStorage*` helpers. All non-wrapper DO storage accesses now go through this proxy.
- `acceptClientFrame()` is now `async` and explicitly `await`s `verifyTenantBoundary()` on the validated session frame. A boundary violation is converted into a typed `IngressEnvelope` rejection so that the caller's `if (!envelope.ok) return;` gate actually blocks `dispatchAdmissibleFrame()` from running. Materializes B6's shipped tenant contract at the DO ingress edge. (Second-round GPT review B9-R1 integration — fire-and-forget bug fixed.)

### Changed

- `wsHelperStorage()` — backing store switched from raw `this.doState.storage` to `getTenantScopedStorage()`. WS helper replay-buffer keys are now namespaced under `tenants/<team>/`.
- `persistCheckpoint()` / `restoreFromStorage()` — `CHECKPOINT_STORAGE_KEY` is now written/read through the tenant-scoped wrapper.
- `session.resume` handling (line 559) — `LAST_SEEN_SEQ_KEY` put now goes through the tenant-scoped wrapper.
- `http-controller.ts` — hardcoded `"1.1.0"` replaced by `NACP_VERSION` import from `@haimang/nacp-core`. Addresses B9 GPT review R4 baseline-drift finding.

### Not changed

- `DurableObjectStateLike` surface (API compat preserved).
- `idFromName(sessionId)` per-session DO identity (learnings §10.4 — remains correct for nano-agent runtime).
- `V1_BINDING_CATALOG` (charter §4.1 H rule 32).

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
