# @nano-agent/storage-topology

Storage semantics layer for nano-agent: hot / warm / cold taxonomy, the
data-item catalog, central key builders, `NacpRef`-compatible ref
builders, MIME-type gate, placement hypotheses, checkpoint fragment
boundaries, archive / promotion / demotion plan contracts, and the
evidence-driven calibration seam.

This package is a **semantics library**. It does NOT perform storage
I/O itself; production reads and writes always go through
`@nano-agent/nacp-core`'s `tenant*` scoped-I/O helpers (or a real
adapter injected at deploy time). Its job is to make sure every
subsystem shares one vocabulary, one set of key patterns, and one
calibration seam.

---

## What's in scope (v1)

- Shared vocabulary: `StorageClass` (`hot | warm | cold`),
  `StorageBackend` (`do-storage | kv | r2`), `ProvisionalMarker`,
  `ResponsibleRuntime`.
- `DATA_ITEM_CATALOG` — every data item in v1 with its provisional
  storage class + revisit condition.
- Key builders: `DO_KEYS`, `KV_KEYS`, `R2_KEYS`. `KV_KEYS.featureFlags`
  is the single `_platform/` exception reserved for ambient feature
  flags.
- `StorageRef` + `build{R2,Kv,DoStorage}Ref()` — every output parses
  under `@nano-agent/nacp-core`'s `NacpRefSchema`. Every ref kind
  (including `do-storage`) uses the `tenants/{team_uuid}/...` key
  prefix.
- `ScopedStorageAdapter` interface with `do*` / `kv*` / `r2*` methods
  that accept `teamUuid` on every call and include `list` / `delete`.
- `applyMimePolicy()` — the v1 MIME-type gate for attachments (returns
  `inline | signed-url | prepared-text | reject` plus the threshold
  consulted).
- `PLACEMENT_HYPOTHESES` — per-data-item placement hypothesis with
  revisit condition.
- `CHECKPOINT_CANDIDATE_FIELDS` — every candidate checkpoint field
  annotated with its fragment (`kernel | session | workspace | hooks |
  usage`), owner runtime, and any open pending questions.
- Archive / promotion / demotion plan contracts that name their
  `ResponsibleRuntime` (not `string`).
- Evidence types (`EvidenceSignal` discriminated union) +
  `evaluateEvidence()` calibrator that takes tunable options + a
  `placementLogToEvidence()` adapter that converts
  `@nano-agent/eval-observability`'s `StoragePlacementLog` entries
  into calibrator input.
- `scripts/export-schema.ts` and `scripts/gen-placement-doc.ts` to
  render the full topology as reviewable artefacts.

## What's NOT in scope (v1)

- D1 DDL / SQL schema / structured query layer.
- A production archive scheduler or lifecycle manager.
- Analytics Engine / APM / billing pipelines.
- Final frozen byte thresholds (every threshold is evidence-driven).
- Real R2 / KV / DO runtime orchestration (this package defines the
  contract; deploy-layer wires the implementation).
- Rewriting `NacpRefSchema` or introducing new ref kinds.
- Cross-region replication, compliance deletion, TTL policies.
- Opening general `_platform/` access beyond `KV_KEYS.featureFlags`.

---

## Quick start

```ts
import {
  buildR2Ref,
  buildDoStorageRef,
  applyMimePolicy,
  evaluateEvidence,
  placementLogToEvidence,
  getPlacement,
  DO_KEYS,
  R2_KEYS,
} from "@nano-agent/storage-topology";

// Ref that safely round-trips through nacp-core NacpRefSchema.
const doRef = buildDoStorageRef("team-1", DO_KEYS.SESSION_PHASE);

// MIME-type gate for incoming attachments.
const gate = applyMimePolicy({ mimeType: "text/plain", sizeBytes: 2048 });
// gate.decision === "inline", gate.thresholdBytes === 102400 (provisional)

// Calibrate against eval-observability's placement log.
const signals = placementLogToEvidence(placementLogEntries);
const recommendation = evaluateEvidence(signals, getPlacement("session-messages")!);
```

## Scripts

```
npm run build                        # tsc → dist/
npm run typecheck
npm run test
npm run test:coverage
npx tsx scripts/export-schema.ts     # dist/storage-topology.schema.json
npx tsx scripts/gen-placement-doc.ts # dist/storage-placement.md
```
