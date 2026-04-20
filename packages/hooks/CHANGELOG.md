# Changelog — @nano-agent/hooks

## 0.2.0 — 2026-04-20

B5 — Hooks Catalog Expansion 1.0.0. The catalog grows from 8 events to
18 across three classes:

### Added

- **Class B (4 new events)**: `Setup`, `Stop`, `PermissionRequest`,
  `PermissionDenied`. `Setup` fires on actor attachment (pre-`SessionStart`);
  `Stop` fires in graceful shutdown (pre-`SessionEnd`). `PermissionRequest`
  is blocking; its verdict rides on the existing `continue` (=allow) /
  `block` (=deny) wire actions with a package-local `verdictOf()` helper
  for readability.
- **Class D (6 new events)**: `ContextPressure` (early-signal before ARM),
  `ContextCompactArmed`, `ContextCompactPrepareStarted`,
  `ContextCompactCommitted`, `ContextCompactFailed`, and `EvalSinkOverflow`.
  Five of these mirror `@nano-agent/context-management`'s
  `COMPACT_LIFECYCLE_EVENT_NAMES`; the export
  `ASYNC_COMPACT_HOOK_EVENTS` keeps the two names lists in sync.
  `EvalSinkOverflow` is metadata only — producer ships in B6.
- `CLASS_B_HOOK_EVENTS` export grouping the startup/shutdown/permission
  inventory.
- `permission.ts` — `PermissionVerdict`, `verdictOf(aggregated, eventName)`,
  and `denyReason(aggregated)`. Compile-away for P4 §8.5's `allow` / `deny`
  vocabulary; no wire-level fields added.

### Preserved

- Class A 8 events: `SessionStart` / `SessionEnd` / `UserPromptSubmit` /
  `PreToolUse` / `PostToolUse` / `PostToolUseFailure` / `PreCompact` /
  `PostCompact` — allowlists unchanged, all existing tests green.
- `hook.emit` / `hook.outcome` / `hook.broadcast` / `audit.record` wire
  schemas are unchanged.
- Dispatcher / registry / matcher / snapshot / runtime behaviour
  unchanged.

### Deferred

- Class C (`FileChanged`, `CwdChanged`) — still deferred per B5 §2.2 /
  P4 §5.
- `EvalSinkOverflow` real producer — ships in B6 (eval-observability
  `SessionInspector` dedup patch).

### Companion producer seams (per B5 Phase 4)

- `@nano-agent/session-do-runtime`: `orchestration.startTurn()` emits
  `Setup` once on actor attachment; `gracefulShutdown()` emits `Stop`
  before `SessionEnd`.
- `@nano-agent/capability-runtime`: new optional `permissionAuthorizer`
  executor option surfaces `PermissionRequest` / `PermissionDenied`
  through any host-supplied authorizer that wraps `HookDispatcher`.
- `@nano-agent/context-management`:
  `AsyncCompactOrchestrator.tryArm()` emits `ContextPressure` as an
  early-signal before the ARM transition.

## 0.1.0 — 2026-04-17

Initial implementation of the hooks lifecycle-governance package.

### Added

- 8-event catalog (`HOOK_EVENT_CATALOG` + `HookEventName` union),
  per-event `allowedOutcomes` / `redactionHints` / `payloadSchema` /
  `blocking` metadata, and `isBlockingEvent()` helper.
- Outcome reducer (`aggregateOutcomes`) with strictest-wins precedence,
  event-specific allowlist enforcement, and `updatedInput` propagation
  limited to `PreToolUse`.
- `HookRegistry` with source priority (platform-policy > session > skill)
  and deterministic ordering by insertion time.
- `HookMatcher` with `exact` / `wildcard` / `toolName` only (no regex).
- `HookDispatcher.emit()` as the single emission entry point, with
  recursion-depth guard (`checkDepth`) wired into every emit, timeout
  guard (`withTimeout`), and AbortSignal propagation through handlers.
- `LocalTsRuntime` for trusted in-proc handlers and `ServiceBindingRuntime`
  stub for future cross-worker hook execution.
- NACP-Core codec (`buildHookEmitBody`, `parseHookOutcomeBody`,
  `buildHookOutcomeBody`) that produces/consumes bodies validated by
  `HookEmitBodySchema` / `HookOutcomeBodySchema`.
- NACP-Session adapter (`hookEventToSessionBroadcast`) that emits
  `hook.broadcast` bodies validated by `SessionStreamEventBodySchema`,
  with redaction hints applied to the payload.
- Audit builder (`buildHookAuditRecord`) that produces `audit.record`
  bodies validated by `AuditRecordBodySchema`, plus the internal
  lifecycle helper `buildHookAuditEntry`.
- Session snapshot / restore codec for DO hibernation.
- Integration tests: PreToolUse blocking, session resume, service-binding
  timeout (via fake transport), PreCompact guard.
- `scripts/export-schema.ts` + `scripts/gen-registry-doc.ts`.
