# Changelog — @haimang/nacp-session

## 1.3.0 — 2026-04-21 (B9 — contract freeze pre worker-matrix)

Per `docs/rfc/nacp-core-1-3-draft.md`. Zero breaking change. Version jumps over `1.2.0` in step with nacp-core 1.3.0 (the `1.2.0` label is owned by the B6-reconciled no-schema-delta RFC at `docs/rfc/nacp-session-1-2-0.md`).

### Added

- `NACP_SESSION_TYPE_DIRECTION_MATRIX` (`src/type-direction-matrix.ts`) — `Record<string, Set<NacpDeliveryKind>>` covering all 8 session profile types. Owned by the session profile; NOT reusing the core matrix.
- `isLegalSessionDirection(type, kind)` helper — fail-open for unknown types, fail-closed for known.
- `validateSessionFrame()` now enforces `(message_type × delivery_kind)` legality via the session matrix. Throws `NacpSessionError` with code `NACP_SESSION_TYPE_DIRECTION_MISMATCH` on illegal combination.
- `SessionStartInitialContextSchema` (`src/upstream-context.ts`) — precise upstream memory injection wire contract. All four sub-fields (`user_memory` / `intent` / `warm_slots` / `realm_hints`) are optional; root schema uses `.passthrough()` to preserve back-compat with loose payloads.
- `SESSION_ERROR_CODES.NACP_SESSION_TYPE_DIRECTION_MISMATCH` error code.

### Changed

- `NACP_SESSION_VERSION` bumped `1.1.0 → 1.3.0`. `NACP_SESSION_VERSION_COMPAT` unchanged (`1.0.0`).
- `SessionStartBodySchema.initial_context` tightened from `z.record(z.string(), z.unknown()).optional()` to `SessionStartInitialContextSchema.optional()`. Because the inner schema is all-optional + passthrough, existing valid payloads (including `{}` or loose objects) continue to parse.

### Not shipped (deferred)

- Consumer of `body.initial_context` inside `session-do-runtime`. RFC §6.3 preserves the field in the validated frame; the actual dispatch path is left to the worker-matrix `agent.core` / `context.core`.

## 2026-04-20 — B6 reconciliation (Outcome A: stay at 1.1.0)

Per `docs/rfc/nacp-session-1-2-0.md` (now frozen with status `frozen`),
Outcome A is chosen — **no schema changes, no version bump**.

### Drift fix

- RFC §6.2 previously claimed `session.stream.event` body schema
  carries `message_uuid`. That is **inaccurate**: the dedup key
  `messageUuid` lives on the NACP envelope `header`, stamped by
  `websocket.ts::postStreamEvent` at line 120. Body schema
  (`SessionStreamEventBodySchema`) is unchanged and does NOT carry
  `message_uuid`. RFC §6.2 reworded to call out the correct key
  source and point at the B6 `SessionInspector` `onSessionFrame()` /
  `onStreamEvent(..., meta)` consumer seams.

### Preserved

- All 9 `session.stream.event` kinds, 8 session message kinds.
- Frame / websocket / replay / ack / heartbeat behaviour unchanged.

## v1.0.0 (2026-04-16)

Initial release of the NACP-Session package.

### Phase 1 — Session Protocol Skeleton
- 7 Session message schemas (start/resume/cancel/end/stream.event/stream.ack/heartbeat)
- `SessionStreamEventBody` discriminated union with 9 event kinds
- `SESSION_MESSAGE_TYPES` / `SESSION_BODY_REQUIRED` registries
- Session-specific error codes

### Phase 2 — Ingress / Egress Normalization
- `NacpSessionFrameSchema` extends Core's `NacpEnvelopeBaseSchema`
- `NacpClientFrameSchema` allows authority omission
- `normalizeClientFrame` for authority server-stamping
- Forged authority rejection

### Phase 3 — Replay / Resume / Ack / Heartbeat
- `ReplayBuffer` ring buffer with per-stream + total limits
- DO storage checkpoint/restore for hibernation
- `NACP_REPLAY_OUT_OF_RANGE` enforcement
- `AckWindow` with at-most-once / at-least-once delivery
- `HeartbeatTracker` with healthy/stale/timeout status

### Phase 4 — WebSocket Profile + DO Integration
- `SessionWebSocketHelper` with attach/detach/pushEvent/handleResume/handleAck/close
- Progress forwarding via pushEvent API
- Checkpoint/restore for DO hibernation

### Phase 5 — Adapters & Redaction
- Tool progress/result adapter
- Hook broadcast adapter (with redaction)
- Compact notify adapter
- System notify adapter
- LLM delta adapter seam
- `redactPayload` redaction utility

### Phase 6 — Tests, Schema Export, Documentation
- 71 tests across 11 test files
- JSON Schema export (10 definitions)
- Registry doc generation
- Independent git repo initialization
