# Changelog — @nano-agent/storage-topology

## Unreleased — 2026-04-22 (W0 pre-worker-matrix compat adapt)

### Changed

- `src/{keys.ts,refs.ts}` now act as explicit compatibility re-export layers over `@haimang/nacp-core@1.4.0` storage-law truth.
- `src/taxonomy.ts` now re-exports `StorageBackend` from `@haimang/nacp-core@1.4.0` so the backend literal union no longer has an independent local source of truth.
- Storage adapters / placement / calibration ownership remains local to `@nano-agent/storage-topology`; this is a source-topology update only, not a package-version bump.

## 2.0.0 — 2026-04-20

After-foundations Phase 1 (B2). First package-side consumption of B1
spike findings (`docs/spikes/storage-findings.md`,
`docs/spikes/fake-bash-platform-findings.md`).

### Breaking

- **`ScopedStorageAdapter.r2List` return shape** — was
  `{ keys: string[]; truncated: boolean }`, now
  `{ objects: R2ObjectLike[]; truncated: boolean; cursor?: string }`.
  Driven by spike-do-storage-F02 (50 keys + limit=20 forces 3-page
  cursor walk). The 3rd positional parameter (`limit`) is now folded
  into an `opts?: { limit?, cursor? }` object so callers can resume
  pagination. The only existing implementer was `NullStorageAdapter`,
  so no production user breaks.

### Added

- `errors.ts` typed error hierarchy:
  - `StorageError` (base; `hint` field)
  - `ValueTooLargeError` (per spike-do-storage-F08; `bytes` / `cap` /
    `adapter ∈ "do" | "kv" | "r2" | "memory"`)
  - `CursorRequiredError` (per spike-do-storage-F02)
  - `StorageNotConnectedError` (typed replacement for the pre-v2
    plain `Error("…not connected")`)
- `R2ObjectLike` — minimal R2 object descriptor exposed from
  `adapters/scoped-io.ts` so the package stays decoupled from
  `@cloudflare/workers-types` (same `*Like` pattern as
  `@haimang/nacp-core`).
- `R2Adapter` (`adapters/r2-adapter.ts`) — production-shaped per-binding
  wrapper. Includes:
  - `get` / `head` / `put` / `delete` (plus `delete(string[])`).
  - `list(prefix, opts?)` returning the v2 cursor shape.
  - `listAll(prefix, opts?)` auto-walking cursor with a `maxPages` guard
    against runaway loops.
  - `putParallel(items, { concurrency })` per spike-unexpected-F01
    (~273 ms per-call overhead).
  - `maxValueBytes` field (default 100 MiB conservative; configurable).
  - `put` size pre-check throws `ValueTooLargeError` for known-size
    bodies (string / `ArrayBuffer` / `ArrayBufferView`); skips check
    for `null` / `ReadableStream`.
- `KvAdapter` (`adapters/kv-adapter.ts`) — wraps a Workers KV namespace.
  Includes:
  - `get` / `put` / `delete`.
  - `putAsync(key, value, ctx?)` per spike-unexpected-F02 (~520 ms
    sync write latency); fire-and-forget; size check is synchronous;
    write registered with `ctx.waitUntil` when supplied; failures
    swallowed with `console.warn`.
  - `maxValueBytes` field (default 25 MiB matching Cloudflare's
    public per-value cap).
- `D1Adapter` (`adapters/d1-adapter.ts`) — wraps a D1 database with the
  F06 batch-only contract:
  - `query(sql, …params)` / `first(sql, …params)` / `batch(stmts)` /
    `prepare(sql)`.
  - **Intentionally does NOT expose** `beginTransaction()` /
    `commit()` / `rollback()` / `exec()` (per spike-do-storage-F06).
- `DOStorageAdapter` (`adapters/do-storage-adapter.ts`) — wraps DO
  `state.storage`. Includes:
  - `get` / `getMany` / `put` / `putMany` / `delete` / `deleteMany` /
    `list`.
  - `transaction(callback)` exposing F04-confirmed throw → rollback
    semantics.
  - `maxValueBytes` field (default conservative 1 MiB per F08; B7
    Round 2 binary-search probe will tighten).
  - `put` / `putMany` size pre-check throws `ValueTooLargeError`
    before reaching DO (prevents `SQLITE_TOOBIG` in production).
- `STORAGE_TOPOLOGY_VERSION` bumped to `2.0.0`.
- New tests under `test/adapters/{r2,kv,d1,do-storage,errors}.test.ts`
  (54 cases) covering F02 cursor walking, F04 transaction rollback,
  F06 batch-only contract + negative-API surface, F08 size pre-check,
  uF01 `putParallel`, uF02 `putAsync` fire-and-forget. Existing
  `integration/scoped-io-alignment.test.ts` updated with a v2
  `r2List` return-shape assertion.

### Changed

- `NullStorageAdapter` upgraded:
  - All 10 methods now throw `StorageNotConnectedError` (typed) instead
    of plain `Error`.
  - `r2List` matches the v2 return shape.
  - `teamUuid` positional argument retained on every method (preserves
    the v1 correctness fix introduced in 0.1.0 GPT R1; aligns with
    `nacp-core` `tenant{R2,Kv,DoStorage}*` helpers).
- `ScopedStorageAdapter` — JSDoc additions per F01 / F03 (with C3
  weak-evidence caveat) / F04 / F08 / unexpected-F01 / unexpected-F02.
  Method signatures are otherwise unchanged except for the F02
  `r2List` breaking shape.
- `package.json` `version` 0.1.0 → 2.0.0.
- `docs/rfc/scoped-storage-adapter-v2.md` r2 — frozen to shipped
  surface with a note explaining the deviation from earlier draft
  (interface keeps `teamUuid`; `maxValueBytes` lives on adapter
  classes).

### Notes

- `docs/issue/after-foundations/B2-writeback-r2list-cursor-interface.md`
  is closed by this release.
- `MemoryBackend` in `@nano-agent/workspace-context-artifacts` was
  updated in the same B2 batch to mirror `DOStorageAdapter.maxValueBytes`
  (default 1 MiB) so local tests fail with the same
  `ValueTooLargeError` shape that production DO would throw.
- `ReferenceBackend` in the same package is now functional in connected
  mode (DO-only or DO + R2 promotion); placeholder mode with
  `StorageNotConnectedError` is preserved for callers that have not
  wired durable storage yet.
- Round 2 follow-ups remain open: F03 cross-colo KV freshness, F08
  binary-search to pin the precise DO cap, F01 large-blob continuation.

## 0.1.0 — 2026-04-17

Initial v1 implementation + post-review corrections.

### Added

- `StorageClass` / `StorageBackend` / `ProvisionalMarker` /
  `ResponsibleRuntime` vocabulary with `storageClassToBackend()`.
- `DATA_ITEM_CATALOG` covering every v1 data item, each flagged as
  `provisional | evidence-backed | frozen` plus a revisit condition.
- `DO_KEYS`, `KV_KEYS`, `R2_KEYS`. `KV_KEYS.featureFlags` is the single
  reserved `_platform/` exception.
- `StorageRef` shape and `build{R2,Kv,DoStorage}Ref()` — every output
  satisfies `NacpRefSchema` (including the tenant-prefix requirement
  for `do-storage`). Optional `content_type` / `size_bytes` / `etag` /
  `bucket` fields mirror Core.
- `ScopedStorageAdapter` interface with `do* / kv* / r2*` methods that
  accept `teamUuid` on every call; `list` / `delete` methods for R2 /
  KV / DO included.
- `applyMimePolicy()` — new executable MIME-type gate returning
  `inline | signed-url | prepared-text | reject` + the provisional
  threshold consulted.
- `PLACEMENT_HYPOTHESES` derived from the data-item catalog.
- `CHECKPOINT_CANDIDATE_FIELDS` extended with `fragment`, `ownerRuntime`,
  `pendingQuestions`, and an optional `mimeGate` hint. Added
  `summarizeFragments()` + `workspace_refs` / `usage_snapshot` entries.
- `ARCHIVE_PLANS` / `PROMOTION_PLANS` / `DEMOTION_PLANS`; the
  `responsibleRuntime` field is now typed as `ResponsibleRuntime`.
- `EvidenceSignal` refactored into a discriminated union
  (`SizeEvidenceSignal` / `ReadFrequencyEvidenceSignal` / …). Each
  variant narrows `value` precisely (number / boolean / union).
- `evaluateEvidence()` now takes a `CalibrationOptions` parameter
  (tunable `doSizeThresholdBytes`, confidence counts, write-frequency
  cut-off). The 1MB DO cut-off is still the default but no longer a
  hardcoded constant.
- `placementLogToEvidence()` adapter that converts
  `@nano-agent/eval-observability`'s `StoragePlacementLog` entries
  into the calibrator's `EvidenceSignal[]` input, and the
  `PlacementLogEntryLike` mirror shape.
- New tests: `taxonomy.test.ts`, `mime-gate.test.ts`,
  `integration/scoped-io-alignment.test.ts`,
  `integration/placement-evidence-revisit.test.ts`,
  `integration/checkpoint-archive-contract.test.ts`. Existing refs /
  calibration / checkpoint-candidate tests were updated for the new
  API.
- `README.md` + `CHANGELOG.md`.
- `scripts/export-schema.ts` (JSON manifest) and
  `scripts/gen-placement-doc.ts` (review-ready markdown).

### Changed

- `validateRefKey()` now requires the tenant prefix on EVERY ref kind,
  including `do-storage`. The old "DO refs are exempt" branch is gone.
- Archive / demotion plan text softened to reference the "provisional
  inline-size cut-off" rather than a literal "1MB" byte figure.
