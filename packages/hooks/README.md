# @nano-agent/hooks

Lifecycle-governance hooks for nano-agent: the v2 **18-event catalog**,
outcome aggregation, single-entry dispatcher, local + service-binding
runtimes, NACP-Core/Session codec, audit-record builder, and session
snapshot/restore.

This package is a **library**, not a deployable runtime. Wiring into a
Cloudflare Worker / Durable Object happens in session-do-runtime.

---

## 18-event catalog (B5)

### Class A — 8 events (unchanged from 1.x)

| Event | Blocking | Allowed outcome fields |
|-------|----------|------------------------|
| `SessionStart` | no | `additionalContext`, `diagnostics` |
| `SessionEnd` | no | `diagnostics` |
| `UserPromptSubmit` | yes | `block`, `additionalContext`, `diagnostics` |
| `PreToolUse` | yes | `block`, `updatedInput`, `additionalContext`, `diagnostics` |
| `PostToolUse` | no | `additionalContext`, `diagnostics` |
| `PostToolUseFailure` | no | `additionalContext`, `stop`, `diagnostics` |
| `PreCompact` | yes | `block`, `diagnostics` |
| `PostCompact` | no | `additionalContext`, `diagnostics` |

### Class B — 4 events (startup / shutdown / permission)

| Event | Blocking | Allowed outcome fields |
|-------|----------|------------------------|
| `Setup` | no | `additionalContext`, `diagnostics` |
| `Stop` | no | `diagnostics` |
| `PermissionRequest` | yes | `block`, `additionalContext`, `diagnostics` |
| `PermissionDenied` | no | `additionalContext`, `diagnostics` |

- **`Setup`** fires once per actor attachment, BEFORE the first
  `SessionStart`. `session-do-runtime`'s `SessionOrchestrator.startTurn()`
  is the canonical producer.
- **`Stop`** fires during `gracefulShutdown()`, BEFORE `SessionEnd`.
  `Setup` / `Stop` coexist with `SessionStart` / `SessionEnd`; neither
  replaces the other.
- **`PermissionRequest`** wire truth: `continue` → **allow**, `block`
  → **deny**, zero handlers → **fail-closed deny** (caller's
  responsibility). No new wire fields. Use `verdictOf(aggregated)` for
  the package-local `allow` / `deny` alias.

### Class D — 6 events (async-compact lifecycle + eval sink)

| Event | Blocking | Allowed outcome fields |
|-------|----------|------------------------|
| `ContextPressure` | no | `additionalContext`, `diagnostics` |
| `ContextCompactArmed` | no | `diagnostics` |
| `ContextCompactPrepareStarted` | no | `diagnostics` |
| `ContextCompactCommitted` | no | `additionalContext`, `diagnostics` |
| `ContextCompactFailed` | no | `diagnostics` |
| `EvalSinkOverflow` | no | `additionalContext`, `diagnostics` |

- The first five mirror
  `@nano-agent/context-management`'s `COMPACT_LIFECYCLE_EVENT_NAMES`.
  Import `ASYNC_COMPACT_HOOK_EVENTS` instead of hand-copying strings.
- `EvalSinkOverflow` is **metadata only in B5**. The real producer
  ships in B6 (eval-observability SessionInspector dedup patch).

### Semantics

**`updatedInput` is only valid on `PreToolUse`.** Any handler that
returns it for another event has it silently dropped by the reducer.

**`stop` is only valid on `PostToolUseFailure`.** Demoted to `continue`
everywhere else.

**Blocking** events (`PreToolUse`, `UserPromptSubmit`, `PreCompact`,
`PermissionRequest`) execute sequentially by source priority, and
short-circuit as soon as a handler returns `block` or (where allowed)
`stop`. **Non-blocking** events execute in parallel.

---

## Main exports

```ts
import {
  // Catalog + types
  HookEventName,
  HOOK_EVENT_CATALOG,
  isBlockingEvent,
  ASYNC_COMPACT_HOOK_EVENTS,  // 5 names — mirrors B4's COMPACT_LIFECYCLE_EVENT_NAMES
  CLASS_B_HOOK_EVENTS,        // 4 names — Setup / Stop / PermissionRequest / PermissionDenied
  HookHandlerConfig,
  HookSource,
  HookRuntimeKind,
  HookMatcherConfig,

  // Outcome reducer
  HookOutcome,
  AggregatedHookOutcome,
  aggregateOutcomes,

  // Permission verdict (B5 compile-away for design §8.5 allow/deny)
  PermissionVerdict,
  verdictOf,
  denyReason,

  // Core
  HookRegistry,
  HookDispatcher,
  HookEmitContext,
  matchEvent,
  LocalTsRuntime,
  ServiceBindingRuntime,

  // Safety
  withTimeout,
  checkDepth,
  DEFAULT_GUARD_OPTIONS,

  // NACP-Core codec
  buildHookEmitBody,
  parseHookOutcomeBody,
  buildHookOutcomeBody,
  HookEmitBody,
  HookOutcomeBody,

  // NACP-Session adapter
  hookEventToSessionBroadcast,
  HookBroadcastBody,

  // Audit
  buildHookAuditRecord,
  buildHookAuditEntry,
  AuditRecordBody,
  HookAuditEntry,

  // Snapshot / restore
  snapshotRegistry,
  restoreRegistry,
  HookRegistrySnapshot,
} from "@nano-agent/hooks";
```

---

## Dispatcher safety model

`HookDispatcher.emit(event, payload, context)` is the single entry
point. Every call goes through three guards:

1. **Recursion depth guard** — runs `checkDepth(context.depth ?? 0,
   maxDepth)` before any handler dispatches. Handlers that re-emit
   events receive `depth + 1` via the runtime context, so a handler
   cycle aborts at the configured limit (default: 3) instead of
   running unbounded.
2. **Timeout guard** — each handler runs under `withTimeout(fn,
   handler.timeoutMs ?? defaultTimeoutMs, context.abortSignal)`.
3. **Exception catch** — any thrown error is converted into a
   `continue` outcome with `diagnostics.error`, so one misbehaving
   handler never aborts the whole emit().

---

## Protocol codec

The `core-mapping.ts` helpers align with the real
`@haimang/nacp-core` schemas:

```
HookEmitBody     { event_name, event_payload }
HookOutcomeBody  { ok, block?, updated_input?, additional_context?,
                   stop?, diagnostics? }
```

`parseHookOutcomeBody(body, { handlerId, durationMs })` derives the
domain `HookOutcome.action` from the wire body (`stop:true → "stop"`,
`block:{…} → "block"`, else `"continue"`).

`session-mapping.ts` emits `hook.broadcast` bodies that parse cleanly
under `SessionStreamEventBodySchema`:

```
{ kind: "hook.broadcast",
  event_name,
  payload_redacted,
  aggregated_outcome? }
```

`audit.ts` emits `audit.record` bodies aligned with `AuditRecordBodySchema`:

```
{ event_kind: "hook.outcome",
  ref?,
  detail: { hookEvent, handlerCount, totalDurationMs, blocked, … } }
```

---

## v1 out-of-scope

- Shell-command hook runtime, `fetch-http` runtime, `llm-prompt` runtime.
- Client-side blocking handlers (the client only receives redacted
  broadcasts; it cannot reply with a `HookOutcome`).
- Regex matcher or arbitrary condition DSL (v1 matchers: `exact`,
  `wildcard`, `toolName` only).
- A 25-event hook universe with `hook.started` / `hook.finished` kinds.
- Real DO / KV / R2 storage orchestration — we only build the codecs.
- Skill-runtime body and skill registry — only the `skill` source tag
  is reserved.
- Sub-agent / multi-turn concurrency hooks.
- Per-bash-subcommand hooks.

---

## Scripts

```
npm run build           # tsc → dist/
npm run typecheck
npm run test
npm run test:coverage
npx tsx scripts/export-schema.ts     # dist/hooks.schema.json
npx tsx scripts/gen-registry-doc.ts  # dist/hook-registry.md
```
