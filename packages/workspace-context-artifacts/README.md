# @nano-agent/workspace-context-artifacts

Workspace data plane for nano-agent: mount-based namespace, in-memory
backend, artifact store, prepared-artifact seam, context assembler,
compact boundary manager, redaction helpers, and the workspace
snapshot fragment that session-do-runtime persists across DO
hibernation.

Every `ArtifactRef` / `PreparedArtifactRef` is structurally aligned
with `@nano-agent/nacp-core`'s `NacpRefSchema` — artifact kinds live
on `artifactKind`, not on the NacpRef wire `kind`. The compact
boundary manager produces / consumes bodies that parse directly under
`context.compact.request` / `context.compact.response`.

---

## What's in scope (v1)

- Core types: `WorkspacePath`, `MountConfig`, `ArtifactRef`,
  `PreparedArtifactRef`, `ContextLayer`, `WorkspaceSnapshotFragment`.
- `ArtifactRefSchema` + `PreparedArtifactRefSchema` — NacpRef-shaped
  with tenant-prefix refinement. `toNacpRef(ref)` strips artifact
  metadata so the ref can go on the wire.
- `MountRouter` + `WorkspaceNamespace` — longest-prefix router with
  a reserved `/_platform/` namespace so a root `/` mount cannot
  accidentally swallow platform-level paths.
- `MemoryBackend` + `ReferenceBackend` seam.
- `InMemoryArtifactStore` + `StubArtifactPreparer`.
- `promoteToArtifactRef()` — emits `tenants/{teamUuid}/artifacts/{kind}/…`
  keys so every promotion is tenant-scoped by default.
- `ContextAssembler` — honours `config.layers` as an allowlist (empty
  = accept-all) and respects the `maxTokens - reserveForResponse`
  budget.
- `CompactBoundaryManager`:
  - `buildCompactRequest()` returns a
    `ContextCompactRequestBodySchema`-valid body.
  - `applyCompactResponse()` consumes a
    `ContextCompactResponseBodySchema`-valid body and reinjects a
    boundary marker.
  - `pickSplitPoint()` selects a budget-aware split (by
    `tokenEstimate` / `content.length`, never by naive message count).
- `redactPayload()` — local mirror of `@nano-agent/nacp-session`'s
  `redactPayload()`; callers can inject the Session version via
  `redactForClient({ payloadRedactor })`.
- `WorkspaceSnapshotBuilder` — ACTUALLY captures mount configs + file
  index + artifact refs + caller-supplied context layers (no more
  empty arrays). `maxFileIndexSize` bounds the snapshot size.

## What's NOT in scope (v1)

- Final DO / KV / R2 / D1 storage topology (that lives in
  `@nano-agent/storage-topology`).
- Production Cloudflare backend adapters (only memory + reference
  seams ship here).
- Git-style repository semantics or structured indexing databases.
- OCR / embedding / semantic indexing pipelines (prepared-artifact
  is a stub).
- A complete compact algorithm or model calls (we define the boundary
  contract; the algorithm itself is out of scope).
- Transcript / analytics / registry DDL.
- Multi-user / multi-agent collaborative workspaces.
- Client-facing UI / SDK artifact download-preview experience.
- Opening general `/_platform/` access beyond the reserved-namespace
  protection.

---

## Quick start

```ts
import {
  MountRouter,
  WorkspaceNamespace,
  MemoryBackend,
  InMemoryArtifactStore,
  promoteToArtifactRef,
  ContextAssembler,
  CompactBoundaryManager,
  WorkspaceSnapshotBuilder,
  redactForClient,
  toNacpRef,
} from "@nano-agent/workspace-context-artifacts";

const router = new MountRouter();
router.addMount(
  { mountPoint: "/", backend: "memory", access: "writable" },
  new MemoryBackend(),
);
const namespace = new WorkspaceNamespace(router);
const artifacts = new InMemoryArtifactStore();

// Promote a tool result
const ref = promoteToArtifactRef("team-1", "<html/>", "text/html", "document");
artifacts.register({
  ref,
  audience: "client-visible",
  previewText: "<html/>",
  createdAt: new Date().toISOString(),
});

// Snapshot
const fragment = await new WorkspaceSnapshotBuilder(namespace, artifacts).buildFragment();

// Wire it across to a session DO checkpoint
sessionCheckpoint.workspaceFragment = fragment;
```

## Scripts

```
npm run build         # tsc → dist/
npm run typecheck
npm run test
npm run test:coverage
```
