# @nano-agent/nacp-session

> NACP-Session — the client ↔ session DO WebSocket profile of the NACP Protocol Family.

## What this package provides

- **7 Session message schemas** (`session.start/resume/cancel/end/stream.event/stream.ack/heartbeat`)
- **Unified server-push channel** via `session.stream.event` with 9 event kinds (tool progress, hook broadcast, LLM delta, compact notify, system notify, turn lifecycle, session update)
- **Client frame normalization + authority server-stamping** (ingress layer)
- **Replay buffer** with per-stream ring buffer + DO storage checkpoint/restore for hibernation
- **Ack window** with at-most-once / at-least-once delivery modes
- **Heartbeat tracker** for liveness detection
- **WebSocket helper** with attach/detach/resume/replay/close lifecycle
- **Redaction** for scrubbing sensitive fields before client push
- **Adapters** for tool/hook/compact/system/llm → stream event conversion

## Quick Start

```typescript
import {
  SessionWebSocketHelper,
  normalizeClientFrame,
  toolProgressToStreamEvent,
} from "@nano-agent/nacp-session";

// SessionContext is required — provides real tenant/session identity
const helper = new SessionWebSocketHelper({
  sessionContext: {
    team_uuid: "your-team-uuid",
    plan_level: "pro",
    session_uuid: "your-session-uuid",
    trace_id: "your-trace-id",
    producer_id: "nano-agent.session.do@v1",
    stamped_by: "nano-agent.platform.ingress@v1",
  },
});
helper.attach(webSocket);

// Push a tool progress event
helper.pushEvent("tool-call-42", toolProgressToStreamEvent("bash", "output chunk", false));

// Client reconnects with last_seen_seq
helper.handleResume("tool-call-42", lastSeenSeq);

// Health checks (caller-managed — call these in your session DO loop)
helper.checkHeartbeatHealth(); // throws NACP_SESSION_HEARTBEAT_TIMEOUT if stale
helper.checkAckHealth();       // throws NACP_SESSION_ACK_MISMATCH if acks timed out

// Hibernate: save state to DO storage
await helper.checkpoint(ctx.storage);
// Wake: restore
await helper.restore(ctx.storage);
```

## Relationship to NACP-Core

This package **depends on** `@nano-agent/nacp-core` and extends its types:
- `NacpSessionFrameSchema` extends `NacpEnvelopeBaseSchema`
- `session-registry.ts` imports `SessionPhase` / `isMessageAllowedInPhase` from Core for phase gate
- Error types extend Core's `NacpValidationError`

## MVP Follow-up Note

For MVP, `session.start.body.initial_input` is the formal entry for the first turn so the session skeleton can be validated without inventing runtime-private wire messages.

**The first post-MVP expansion item for `@nano-agent/nacp-session` is to add a formal follow-up input family** so multi-turn conversations become first-class protocol reality rather than ad hoc runtime behavior. This decision is aligned with `docs/investigation/action-plan-qna-clarification-batch-1.md` (Batch-1 / Q5).

## Commands

```bash
pnpm build           # TypeScript compilation
pnpm typecheck       # Type check only
pnpm test            # Run all tests
pnpm test:integration # Integration tests only
pnpm build:schema    # Export → dist/nacp-session.schema.json
pnpm build:docs      # Generate → docs/nacp-session-registry.md
```
