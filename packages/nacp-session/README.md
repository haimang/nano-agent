# @nano-agent/nacp-session

> NACP-Session — the client ↔ session DO WebSocket profile of the NACP Protocol Family.
> **Baseline**: `1.1.0` (frozen) — shares `NACP_VERSION` with `@nano-agent/nacp-core`. `NACP_VERSION_COMPAT = "1.0.0"` (pre-freeze payloads are accepted via `migrate_v1_0_to_v1_1` at the envelope layer).

## What this package provides

- **8 Session message schemas** (`session.start / resume / cancel / end / stream.event / stream.ack / heartbeat / followup_input`) — `session.followup_input` is the A1 Phase 0 widened client-produced surface (minimum shape: `{ text, context_ref?, stream_seq? }`); richer queue/replace/merge semantics stay out of v1.
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
    // Internal identity naming is being standardized to UUID-based fields.
    // Pass the session/trace UUIDs and producer metadata required by your build.
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

## Follow-up Input Family (A1 Phase 0 — frozen)

`session.start.body.initial_input` remains the formal entry for the first turn. A1 Phase 3 widened the v1 surface with the minimum follow-up shape so multi-round input is a first-class protocol message instead of a runtime-private behaviour:

| message_type | role | producer | consumer | min body |
|---|---|---|---|---|
| `session.followup_input` | client | client | session | `{ text: string, context_ref?: NacpRef, stream_seq?: number }` |

Queue / replace / merge / approval-aware scheduling semantics are explicitly **not** part of v1 — they live in the post-runtime-closure expansion phase, and any richer behaviour must arrive as an additive protocol extension rather than an ad-hoc runtime path.

## Commands

```bash
pnpm build           # TypeScript compilation
pnpm typecheck       # Type check only
pnpm test            # Run all tests
pnpm test:integration # Integration tests only
pnpm build:schema    # Export → dist/nacp-session.schema.json
pnpm build:docs      # Generate → docs/nacp-session-registry.md
```
