# Changelog — @nano-agent/hooks

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
