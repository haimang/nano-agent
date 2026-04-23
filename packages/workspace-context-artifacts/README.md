# @nano-agent/workspace-context-artifacts

> ⚠️ **DEPRECATED — split absorbed 2026-04-23(worker-matrix P5/D09;C2+D1 split 同步)**
>
> 本包按 W3 absorption blueprint 的 C2/D1 split 已迁移到两个 worker:
>   - **context slice** — `context-layers.ts` / `context-assembler.ts` / `compact-boundary.ts` / `redaction.ts` / `snapshot.ts` + mixed helper 的 context 部分(assembly / compact / snapshot evidence helpers + 2 结构类型)已进入 `workers/context-core/src/`(含 `evidence-emitters-context.ts`)
>   - **filesystem slice** — `types.ts` / `paths.ts` / `refs.ts` / `artifacts.ts` / `prepared-artifacts.ts` / `promotion.ts` / `mounts.ts` / `namespace.ts` / `backends/*` + mixed helper 的 artifact 部分已进入 `workers/filesystem-core/src/`(含 `evidence-emitters-filesystem.ts`)
>
> **本包保留为 coexistence duplicate 直到 P5 之后的 one-shot ownership switch**:当前 agent-core 的主 consumer 路径(`WorkspaceNamespace` / `InMemoryArtifactStore` / `ContextAssembler` / `MountRouter` 等)仍 import 自本包,这是 P3/P4 closure 已诚实承认的 coexistence posture。
>
> **新 consumer 请优先 import 自 `workers/context-core` 或 `workers/filesystem-core`(按 slice 归属);不要扩大对本包 runtime 的新 import。**
> 本包 `CHANGELOG.md` 已追加 P5 deprecation entry;共存期 bug 优先在本包修复(W3 pattern §6)。物理删除归下一阶段。

Workspace data plane for nano-agent: mount-based namespace, in-memory
backend, artifact store, prepared-artifact seam, context assembler,
compact boundary manager, redaction helpers, and the workspace
snapshot fragment that session-do-runtime persists across DO
hibernation.

Every `ArtifactRef` / `PreparedArtifactRef` is structurally aligned
with `@haimang/nacp-core`'s `NacpRefSchema` — artifact kinds live
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
- `redactPayload()` — local mirror of `@haimang/nacp-session`'s
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
