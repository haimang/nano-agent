# B9 Phase 2 — nacp-core 1.3.0 Ship Closure

> Status: `closed`
> Closed: 2026-04-21
> Owner: Claude Opus 4.7 (1M context)
> Phase goal: ship `@nano-agent/nacp-core@1.3.0` with core-side type×direction matrix + standard error body helper

---

## 1. Files shipped / modified

- `packages/nacp-core/src/type-direction-matrix.ts` — **new**, `NACP_CORE_TYPE_DIRECTION_MATRIX` covering 11 core types
- `packages/nacp-core/src/error-body.ts` — **new**, `NacpErrorBodySchema` + `wrapAsError()` helper
- `packages/nacp-core/src/envelope.ts` — added Layer 6 matrix check (fail-closed for core-registered types, fail-open for others)
- `packages/nacp-core/src/error-registry.ts` — registered `NACP_TYPE_DIRECTION_MISMATCH`
- `packages/nacp-core/src/version.ts` — `NACP_VERSION` `1.1.0 → 1.3.0`
- `packages/nacp-core/src/index.ts` — exported new symbols
- `packages/nacp-core/CHANGELOG.md` — `1.3.0` entry with "jumps 1.2.0" rationale
- `packages/nacp-core/package.json` — version bump
- `packages/nacp-core/test/type-direction-matrix.test.ts` — **new**
- `packages/nacp-core/test/error-body.test.ts` — **new**
- `packages/nacp-core/test/messages/messages.test.ts` — fixture delivery_kind auto-selected from matrix
- `packages/nacp-core/test/version.test.ts` — baseline-is-1.3.0 assertion
- `packages/nacp-core/test/envelope.test.ts` + `test/compat.test.ts` — migration target is still `1.1.0` (floor, not current)

## 2. Tests

- `pnpm --filter @nano-agent/nacp-core test`: **247 / 247 green**
- Matrix layer correctly rejects `(tool.call.request, event)` with `NACP_TYPE_DIRECTION_MISMATCH`.
- `wrapAsError` produces a parseable `NacpErrorBodySchema` envelope.

## 3. Known side effects

- 15 pre-existing tests across `test/messages/messages.test.ts` were using `delivery_kind: "command"` for response/event types. They were incorrect since day-1 but no validator caught them; Layer 6 catches them now. Fix: updated `makeEnv()` to auto-pick first legal kind from the matrix per type.
- B9 GPT-R2 deferred: per-verb `{status, error?}` migration in `tool.ts` / `context.ts` / `skill.ts` is NOT shipped here. Tracked for separate PR.
