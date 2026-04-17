# Changelog — @nano-agent/nacp-session

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
