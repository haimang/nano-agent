# @nano-agent/session-do-runtime

Durable-Object runtime assembly layer for nano-agent sessions. Wires the
Session DO class, a minimal Worker fetch entry, WebSocket + HTTP-fallback
routing, the session actor state machine, the kernel orchestrator, a
caller-managed heartbeat/ack health gate, alarm handler, graceful
shutdown, and session-level checkpoint / restore.

This is a **deploy-oriented library**: it ships the single `NanoSessionDO`
Durable Object class plus the Worker entry that Wrangler binds to. It
does NOT ship subsystem implementations (kernel, llm-wrapper,
capability-runtime, hooks, eval-observability, workspace-context-artifacts,
storage-topology); those are composed in via a `CompositionFactory`.

---

## What's in scope (v1)

- Worker entry (`src/worker.ts`) and wrangler skeleton pointing at it.
- `NanoSessionDO` class: `fetch`, `webSocketMessage`, `webSocketClose`,
  `alarm`.
- WebSocket ingress for `session.start` / `session.end` / `session.cancel`
  / `session.resume` / `session.stream.ack` / `session.heartbeat`.
  `session.resume` reads `body.last_seen_seq` (the real
  `SessionResumeBodySchema` field).
- Session actor state machine (`unattached → attached → turn_running →
  attached / ended`).
- Kernel-driven `SessionOrchestrator`. All client-visible stream events
  emitted by the orchestrator are in the canonical 9-kind
  `SessionStreamEventBodySchema` catalog:
  - Turn lifecycle → `turn.begin` / `turn.end` with real `turn_uuid`.
  - Turn cancel → `system.notify` with `severity: "warning"`.
  - Session end → `system.notify` with `severity: "info"`.
  - Step-budget exhaustion → `system.notify` with `severity: "warning"`.
  The old invented `turn.started` / `turn.cancelled` / `session.ended`
  kinds and the `level:` field have been removed.
- `CompositionFactory` seam; `createDefaultCompositionFactory()` returns
  a stub bag so the DO is usable standalone.
- `buildSessionCheckpoint` / `validateSessionCheckpoint` /
  `restoreSessionCheckpoint`. Validation now insists on a UUID
  `sessionUuid`, canonical `actorPhase`, non-negative-integer turn
  counts + stream seqs, and a parseable `checkpointedAt`.
- DO storage persistence of the last-seen seq and the last checkpoint.
- `HealthGate`, `AlarmHandler`, `gracefulShutdown` (with stream-event
  reason codes).
- Single-`turn` turn ingress contract with `extractTurnInput` — only
  `session.start.initial_input` is the supported path today; the
  follow-up prompt family is deliberately left as a documented gap.

## What's NOT in scope (v1)

- Sub-agent spawning or multi-DO federation.
- Multi-client attach / observer mode.
- Kernel step scheduling internals (composed in, not reimplemented here).
- LLM provider request construction / auth helper fleet.
- Capability command registry / fake-bash command surface.
- Final workspace storage topology / DDL.
- Production analytics / billing pipelines.
- Cross-region migration or DO sharding.
- Reinventing the `@nano-agent/nacp-session` profile.

---

## Wrangler layout

```jsonc
{
  "name": "nano-agent-session",
  "compatibility_date": "2024-12-01",
  "main": "dist/worker.js",
  "durable_objects": {
    "bindings": [
      { "name": "SESSION_DO", "class_name": "NanoSessionDO" }
    ]
  }
}
```

`npm run build` compiles `src/worker.ts` → `dist/worker.js` (the DO class
is re-exported from the worker module so Wrangler can discover it).

---

## Public API (selected)

```ts
import {
  NanoSessionDO,
  workerEntry,
  routeRequest,
  HttpController,
  WsController,
  SessionOrchestrator,
  createInitialActorState,
  transitionPhase,
  HealthGate,
  AlarmHandler,
  gracefulShutdown,
  buildSessionCheckpoint,
  validateSessionCheckpoint,
  restoreSessionCheckpoint,
  createDefaultCompositionFactory,
  extractTurnInput,
  TURN_INGRESS_NOTE,
} from "@nano-agent/session-do-runtime";
```

For production deploys, supply your own `CompositionFactory` that wires
real subsystem handles:

```ts
const doInstance = new NanoSessionDO(doState, env, {
  create(env, config) {
    return {
      kernel: buildKernel(env, config),
      llm: buildLlmWrapper(env, config),
      capability: buildCapabilityRuntime(env, config),
      workspace: buildWorkspace(env, config),
      hooks: buildHooks(env, config),
      eval: buildEvalObservability(env, config),
      storage: buildStorage(env, config),
    };
  },
});
```

---

## Scripts

```
npm run build      # tsc → dist/ (worker.ts → dist/worker.js)
npm run typecheck
npm run test
npm run test:coverage
```
