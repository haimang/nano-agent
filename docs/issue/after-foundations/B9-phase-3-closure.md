# B9 Phase 3 — nacp-session 1.3.0 + session-do-runtime 0.3.0 Ship Closure

> Status: `closed`
> Closed: 2026-04-21
> Owner: Claude Opus 4.7 (1M context)
> Phase goal: ship session-side matrix + upstream context schema + tenant plumbing materialization + runtime baseline drift fix

---

## 1. Files shipped / modified — `@nano-agent/nacp-session@1.3.0`

- `packages/nacp-session/src/type-direction-matrix.ts` — **new**, `NACP_SESSION_TYPE_DIRECTION_MATRIX` covering 8 session types; owned by the session profile (GPT-R1 integration)
- `packages/nacp-session/src/upstream-context.ts` — **new**, `SessionStartInitialContextSchema` (all-optional + passthrough)
- `packages/nacp-session/src/frame.ts` — `validateSessionFrame()` now consumes the session matrix; throws `NACP_SESSION_TYPE_DIRECTION_MISMATCH` on illegal combinations
- `packages/nacp-session/src/errors.ts` — registered `NACP_SESSION_TYPE_DIRECTION_MISMATCH`
- `packages/nacp-session/src/messages.ts` — `SessionStartBodySchema.initial_context` tightened from `z.record(...)` to `SessionStartInitialContextSchema.optional()`
- `packages/nacp-session/src/version.ts` — `NACP_SESSION_VERSION` `1.1.0 → 1.3.0`
- `packages/nacp-session/src/index.ts` — exported new symbols
- `packages/nacp-session/CHANGELOG.md` — `1.3.0` entry
- `packages/nacp-session/package.json` — version bump
- `packages/nacp-session/README.md` — baseline line updated to `1.3.0 (frozen)`
- `packages/nacp-session/test/frame.test.ts` — 4 new B9-matrix tests added; `session.stream.event` fixture fixed to use `delivery_kind: "event"`
- `docs/nacp-session-registry.md` — version header bumped to `1.3.0`

## 2. Files shipped / modified — `@nano-agent/session-do-runtime@0.3.0`

- `packages/session-do-runtime/src/do/nano-session-do.ts`:
  - Imported `verifyTenantBoundary`, `tenantDoStorageGet/Put/Delete`, `DoStorageLike` directly from `@nano-agent/nacp-core`
  - Added `tenantTeamUuid()` — single source-of-truth
  - Added `getTenantScopedStorage()` — proxy that namespaces every put/get/delete under `tenants/<team>/`
  - `acceptClientFrame()` now calls `verifyTenantBoundary()` on the validated frame
  - `wsHelperStorage()` — switched to `getTenantScopedStorage()`
  - `persistCheckpoint()` / `restoreFromStorage()` — switched to `getTenantScopedStorage()`
  - `LAST_SEEN_SEQ_KEY` write in `session.resume` handler — switched to `getTenantScopedStorage()`
- `packages/session-do-runtime/src/http-controller.ts` — hardcoded `"1.1.0"` replaced by `NACP_VERSION` import (GPT-R4 integration)
- `packages/session-do-runtime/package.json` — version `0.1.0 → 0.3.0`; explicit `@nano-agent/nacp-core: workspace:*` dependency
- `packages/session-do-runtime/CHANGELOG.md` — `0.3.0` entry explaining the jump over the never-published `0.2.0` tag
- `packages/session-do-runtime/test/integration/checkpoint-roundtrip.test.ts` — assertions updated to read `tenants/<team>/session:checkpoint`
- `packages/session-do-runtime/test/do/nano-session-do.test.ts` — `session.resume` test reads `tenants/<team>/session:lastSeenSeq`

## 3. Tests

- `pnpm --filter @nano-agent/nacp-session test`: **119 / 119 green**
- `pnpm --filter @nano-agent/session-do-runtime test`: **357 / 357 green**

## 4. Known side effects

- Integration tests that previously inspected `store.get("session:checkpoint")` had to be updated to use the tenant-scoped key. This is expected B9 behavior — the wrapper is the point of the change.
- `b7-round2-integrated-contract.test.mjs` (5 tests) still green; B7 LIVE wire contract preserved.
