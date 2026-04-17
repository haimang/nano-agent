# Changelog — @nano-agent/workspace-context-artifacts

## 0.1.0 — 2026-04-17

Initial v1 implementation + post-review corrections.

### Added

- `ArtifactRef` / `PreparedArtifactRef` schemas are now `NacpRef`-shaped.
  Artifact kinds live on `artifactKind`; the NacpRef backend enum
  (`r2 | kv | do-storage | d1 | queue-dlq`) is the wire `kind`. The
  schema refines `key` so every ref is tenant-prefixed.
- `NacpRefLike` type + `toNacpRef(ref)` helper for publishing a ref
  on the wire without artifact metadata.
- `MountRouter` reserves `/_platform/` — a bare root mount (`/`) can
  no longer swallow platform-reserved paths. Explicit `/_platform`
  mounts still claim the namespace.
- `ContextAssembler.assemble()` honours `config.layers` as an
  allowlist (empty = accept-all; required-but-not-allowed layers are
  still dropped, not silently kept).
- `CompactBoundaryManager` wire shapes align with
  `context.compact.request` / `context.compact.response`:
  - `buildCompactRequest({ historyRef, messages, targetTokenBudget })`
  - `applyCompactResponse(messages, response, summaryRef, turnRange)`
  - `pickSplitPoint(messages, targetTokenBudget)` — token-budget-aware
    split (via `tokenEstimate` / `content.length`).
- `redactPayload()` mirror of `@nano-agent/nacp-session`'s
  `redactPayload`; `redactForClient()` applies it to JSON previews
  and can take an injected `payloadRedactor` for Session parity.
- `WorkspaceSnapshotBuilder.buildFragment()` now ACTUALLY captures
  mount configs (`namespace.listMounts()`), file index
  (`namespace.listDir(mount.mountPoint)`), artifact refs and
  caller-supplied context layers. `maxFileIndexSize` bounds the
  snapshot.
- `WorkspaceSnapshotBuilder.restoreFragment()` now returns the full
  restored view: `mountConfigs`, `artifactRefs`, `fileIndex`,
  `contextLayers`.
- `WorkspaceNamespace.listMounts()` exposes the mount list.
- `promoteToArtifactRef()` produces tenant-scoped keys
  (`tenants/{teamUuid}/artifacts/{artifactKind}/…`), options support
  `role` / `idFactory` / `bindingOverride` / tunable policy.
- New tests: `refs.test.ts`, `redaction.test.ts`,
  `integration/fake-workspace-flow.test.ts`,
  `integration/compact-reinject.test.ts`,
  `integration/snapshot-restore-fragment.test.ts`.
- Updated tests for the new ref shape across
  `artifacts.test.ts`, `prepared-artifacts.test.ts`,
  `promotion.test.ts`, `snapshot.test.ts`, `compact-boundary.test.ts`,
  `mounts.test.ts`, `context-assembler.test.ts`.
- README + CHANGELOG.

### Changed

- `ArtifactRef` field names migrated from camelCase / local shape to
  NacpRef shape: `teamUuid → team_uuid`, `storageClass → kind`
  (NacpRef backend), artifact classification moved to `artifactKind`,
  `mimeType → content_type`, `sizeBytes → size_bytes`, added
  `binding`, `role`, optional `bucket`, `etag`.
- `PreparedArtifactRefSchema` refines both `key` and `sourceRef.key`
  to require tenant prefixes.
- `InMemoryArtifactStore.listByKind` now filters by `ref.artifactKind`
  (the semantic kind) — `ref.kind` is the NacpRef backend now.
- `buildCompactInput`/`applyCompactOutput` renamed to
  `buildCompactRequest` / `applyCompactResponse` with schema-aligned
  bodies. The old names + shapes are removed.
