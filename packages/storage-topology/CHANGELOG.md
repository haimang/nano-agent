# Changelog — @nano-agent/storage-topology

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
