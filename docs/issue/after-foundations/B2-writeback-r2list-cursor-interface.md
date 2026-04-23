# [B2 / writeback] `ScopedStorageAdapter.r2List` interface must be v2 (breaking)

> **Issue ID**: `B2-writeback-r2list-cursor-interface`
> **Action plan**: `docs/action-plan/after-foundations/B2-storage-adapter-hardening.md`
> **Phase**: B2 (Storage Adapter Hardening)
> **Status**: ✅ closed (2026-04-20 — shipped in `@nano-agent/storage-topology` 2.0.0)
> **Created**: 2026-04-19
> **Closed**: 2026-04-20
> **Owner**: Opus 4.7 (1M context)
> **Type**: writeback (forward-traceability evidence per discipline 7 / charter §10.3)
> **Source finding**: `docs/spikes/spike-do-storage/02-r2-list-cursor-required-pagination-confirmed.md` (`spike-do-storage-F02`)

---

## Summary

`packages/storage-topology/src/adapters/scoped-io.ts:127` 的 `r2List` 接口当前签名 **缺少 cursor / limit 入参与 truncated/cursor 返回字段**。spike-do-storage Round 1 已在真实 Cloudflare R2 上确认 50 keys + limit=20 必须用 cursor 分页 3 次（20+20+10）才能完整 enumerate。**任何 R2-backed list 操作如不支持 cursor walking，会在 keys > limit 时静默丢失数据**。这是 worker matrix 阶段 filesystem.core 启动前必须修复的 **breaking interface change**。

## Context

- spike worker live: `https://nano-agent-spike-do-storage.haimang.workers.dev`
- spike finding doc: `docs/spikes/spike-do-storage/02-r2-list-cursor-required-pagination-confirmed.md`
- Combined run output: `the historical round-1 storage spike workspace`

## Required action

### 1. Modify `packages/storage-topology/src/adapters/scoped-io.ts:127`

Current:
```ts
async r2List(prefix: string): Promise<{ objects: Array<{...}> }> {
  throw new Error("NullStorageAdapter: r2List not connected");
}
```

Target (v2):
```ts
async r2List(
  prefix: string,
  opts?: { limit?: number; cursor?: string },
): Promise<{
  objects: Array<{...}>;
  truncated: boolean;
  cursor?: string;
}>;
```

This is a **breaking change** to the `ScopedStorageAdapter` interface. Since the only current implementer is `NullStorageAdapter` (which throws), there are no production users to break. **Recommend `storage-topology` major bump 0.1.0 → 2.0.0** when shipping this.

### 2. Add `packages/storage-topology/src/adapters/r2-adapter.ts` (NEW)

Real R2Adapter implementation must:
- Wrap `binding.list({ prefix, limit, cursor })` directly
- Provide a helper `listAll(prefix)` that walks cursor automatically until `truncated === false`
- Document expected per-page latency (per spike unexpected-F01: ~270 ms / put for small payloads suggests list latency may also be elevated for high page counts)

### 3. RFC document

`docs/rfc/scoped-storage-adapter-v2.md` (NEW) must include:
- Breaking change rationale
- Migration path for `ReferenceBackend`
- Migration path for any other consumer

### 4. Contract test

Add test that:
- Pre-seeds N keys (e.g. 50) with limit=20
- Calls `r2List` and asserts truncated/cursor fields
- Walks cursor until `truncated=false` and asserts total count

## Acceptance criteria

- [x] `scoped-io.ts` interface v2 shipped — `r2List(teamUuid, prefix?, opts?)` returns `{ objects: R2ObjectLike[]; truncated; cursor? }` (note: `teamUuid` retained on the facade per RFC r2 freeze; only the return shape is breaking).
- [x] `r2-adapter.ts` real implementation shipped — `R2Adapter` per-binding wrapper with `list()` (v2 cursor shape), `listAll()` (auto-walk with `maxPages` guard), `putParallel()` helper, size pre-check, decoupled `R2BucketBinding` type.
- [x] `ReferenceBackend` is now functional in connected mode (DO-only and DO + R2-promotion topologies); `list()` reads from the underlying `DOStorageAdapter` (which has its own native list API); see `packages/workspace-context-artifacts/src/backends/reference.ts`.
- [x] `docs/rfc/scoped-storage-adapter-v2.md` r2 frozen — status `frozen`, §3.1 reflects shipped surface, §6 acceptance criteria all `[x]` except B7 round-2 re-run.
- [x] Contract test for cursor walking added — `packages/storage-topology/test/adapters/r2-adapter.test.ts` reproduces the F02 50-keys-+-limit-20-=-3-pages scenario; asserts `truncated`/`cursor`; asserts `listAll` walks 3 pages with the right cursors.
- [x] `storage-topology` major bump 0.1.0 → 2.0.0 — `package.json` + `STORAGE_TOPOLOGY_VERSION` + CHANGELOG `2.0.0 — 2026-04-20` entry.
- [ ] Round 2 integrated spike re-runs V1-storage-R2-list-cursor against the new `R2Adapter` and confirms cursor walking from `packages/` — **deferred to B7 per `P6-spike-round-2-integration-plan.md` §4.1**.

## Related findings (potentially co-shipped)

- `spike-do-storage-F01` (R2 multipart) — same R2 adapter file, may be co-shipped
- `spike-do-storage-F03` (KV stale-read JSDoc) — same `scoped-io.ts` file, may be co-shipped
- `spike-do-storage-F04` (DO transactional) — `do-storage-adapter.ts` separate file, can be co-shipped
- `unexpected-F01` (R2 put 273 ms / key) — same R2 adapter, recommend `putParallel` helper added

## References

- Charter: `docs/plan-after-foundations.md` §6 Phase 1 + §11.1 Exit Criteria 2
- Source finding: [F02](../../the historical spikes tree spike-do-storage/02-r2-list-cursor-required-pagination-confirmed.md)
- Storage rollup: `docs/spikes/storage-findings.md` §3
- Spike code: `the historical round-1 storage spike workspace`
- Discipline check: `docs/spikes/_DISCIPLINE-CHECK.md`
- Tracking policy: `docs/issue/README.md`
