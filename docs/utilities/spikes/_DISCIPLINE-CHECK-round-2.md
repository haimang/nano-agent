# Spike Discipline Check — Round 2 Integrated

> **Check date**: 2026-04-20
> **Spike scope**: `round-2-integrated/{spike-do-storage-r2, spike-binding-pair-r2}`
> **Reviewer**: Claude Opus 4.7 (1M context)
> **Discipline source**: `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` §3
> **Required by**: `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md` P5-01

---

## Verdict

✅ **7/7 disciplines satisfied (6 strict + 1 modified with explicit exception)**

Round 2 exists to validate shipped `@nano-agent/*` packages on real
platform surfaces. The exception is **discipline 7**: Round 1 forbade
`import "@nano-agent/*"`; Round 2 requires it. The exception is
declared in §7 below with full rationale.

---

## §1. 纪律 1：spike 代码放 the historical spikes tree 顶级目录，**不进** `packages/`

### Status: ✅ HOLDS

### Evidence

- `pnpm-workspace.yaml` still only includes `packages/*`:
  ```yaml
  packages:
    - "packages/*"
  ```
- All Round-2 code lives under `the historical round-2 integrated spikes tree`.
- No the historical spikes tree files exist inside `packages/`.

### Verification command

```bash
find packages/ -path '*/the historical spikes tree *' -o -name 'spike*' | wc -l   # → 0
find the historical round-2 integrated spikes tree -type f | wc -l                # > 0
```

---

## §2. 纪律 2：spike 必须有 expiration date

### Status: ✅ HOLDS

### Evidence

- Every Round-2 `wrangler.jsonc` includes `"EXPIRATION_DATE":
  "2026-08-01"` in `vars` (same window as Round 1 for operator
  cognitive load).
- Every Round-2 `package.json` description carries "Expiration:
  2026-08-01".
- Top-level `the historical round-2 integrated spikes treeREADME.md` declares the
  expiration up front.

---

## §3. 纪律 3：spike **不进** CI main pipeline

### Status: ✅ HOLDS

### Evidence

- Root `package.json` scripts still only call `pnpm -r run test`
  (packages) + `node --test test/*.test.mjs` (root contracts). The
  `the historical round-2 integrated spikes tree*/package.json` files do NOT expose a
  `test` script.
- `the historical round-2 integrated spikes treeREADME.md` explicitly describes
  deploy-dry-run / live capture as **operator** steps, not CI steps.

### Caveat

The root-level contract test `test/b7-round2-integrated-contract.test.mjs`
DOES run in CI, but it exercises shipped packages' APIs — NOT spike
worker code. It is a local-simulation of the probe logic so the B6
dedup + F04 push-path contract is locked in CI regardless of deploy
status. That's a validation-infrastructure test, not a spike-code
test, and consistent with discipline 3.

---

## §4. 纪律 4：findings → docs/historical spike artifacts.md per template

### Status: ✅ HOLDS

### Evidence

- No Round-2 finding docs replace Round-1 finding docs; every
  existing `docs/spikes/spike-do-storage/*.md`,
  `docs/spikes/spike-binding-pair/*.md`, `docs/spikes/unexpected/*.md`
  received a **§9 Round-2 closure** section appended (append-only
  discipline preserved).
- Writeback vocabulary is the frozen B7 `{writeback-shipped |
  dismissed-with-rationale | still-open}` set (per action-plan §1.2).
- Any newly-discovered issues would have gone to a dedicated
  Round-2-integrated finding doc as `integrated-F*` — none were
  surfaced in this phase (all Round-1 findings continue to hold; no
  shipped-package bug was discovered).

---

## §5. 纪律 5：no production data / no business logic / no LLM API key

### Status: ✅ HOLDS

### Evidence

- All Round-2 payloads are synthetic (`Uint8Array(N)` for storage
  probes, deterministic seeded UUIDs for sink probes).
- Spike bindings use `nano-agent-spike-*-r2` namespaces, fully
  isolated from production tenant keys.
- No `LLM_API_KEY` / `ANTHROPIC_API_KEY` / similar is referenced
  anywhere in round-2 source (grep confirms).

---

## §6. 纪律 6：Round 1 baseline vs Round 2 isolation

### Status: ✅ HOLDS

### Evidence

Round 1 baseline preserved intact. Round 2 uses separate wrangler
worker names, DO class names, KV / R2 / D1 resources:

| Facet | Round 1 | Round 2 |
|---|---|---|
| storage worker name | `nano-agent-spike-do-storage` | `nano-agent-spike-do-storage-r2` |
| storage DO class | `ProbeDO` | `IntegratedProbeDO` |
| storage KV namespace | `…-kv` | `…-kv-r2` |
| storage R2 bucket | `…-probe` | `…-probe-r2` |
| storage D1 database | `…_d1` | `…_d1_r2` |
| binding worker-a name | `…-pair-a` | `…-pair-a-r2` |
| binding worker-b name | `…-pair-b` | `…-pair-b-r2` |

Round 1 findings docs are **only appended to** (no Round-1 data
edits). Round 1 `.out/` artefacts (if committed) stay where they
were; Round 2 writes to its own `.out/` in each round-2 spike dir.

---

## §7. 纪律 7 (MODIFIED)：package imports — Round 2 is the exception

### Status: ✅ HOLDS (explicit exception)

### Original Round-1 discipline

> "NOT importing packages/ runtime; only loose contract alignment"

### Round-2 exception

Round 2's entire point is validating shipped `@nano-agent/*`
packages on real platform surfaces. Therefore Round 2 IS allowed
to `import "@nano-agent/*"`:

- `spike-do-storage-r2/src/re-validation/storage.ts` imports
  `@nano-agent/storage-topology` (`R2Adapter`, `KvAdapter`,
  `D1Adapter`, `DOStorageAdapter`)
- `spike-do-storage-r2/src/re-validation/bash.ts` imports
  `@nano-agent/capability-runtime` (`CapabilityExecutor`,
  `CapabilityPolicyGate`, `InMemoryCapabilityRegistry`,
  `LocalTsTarget`)
- `spike-do-storage-r2/src/re-validation/context.ts` imports
  `@nano-agent/context-management` (`BudgetPolicy`,
  `COMPACT_LIFECYCLE_EVENT_NAMES`, `noopLifecycleEmitter`)
- `spike-binding-pair-r2/worker-b-r2/src/worker.ts` imports
  `@nano-agent/session-do-runtime` (`BoundedEvalSink`,
  `extractMessageUuid`)

### Constraint on the exception

Pure follow-up probes that require **raw platform truth** still do
NOT import `@nano-agent/*`:

- `spike-do-storage-r2/src/follow-ups/do-size-cap-binary-search.ts`
  uses only the native `DurableObjectStub` — F08 is about the
  platform's storage engine limit, not the adapter wrapping it.
- `spike-do-storage-r2/src/follow-ups/r2-concurrent-put.ts` uses
  only the native `R2Bucket` binding — the concurrency curve is a
  platform / account property.
- `spike-do-storage-r2/src/follow-ups/kv-cross-colo-stale.ts` uses
  only the native `KVNamespace` — cross-colo staleness is a
  platform property.
- `spike-do-storage-r2/src/follow-ups/curl-high-volume.ts` uses
  only `fetch()` — high-volume curl budget is a platform property.
- `spike-binding-pair-r2/worker-b-r2/src/handlers/slow-abort-
  observer.ts` uses only `request.signal` — callee-side abort
  observation is a platform property.

The distinction is enforced by convention: **re-validation/*.ts**
imports shipped packages; **follow-ups/*.ts** does not (except
binding-F04 where the push-path probe physically consumes
`BoundedEvalSink` on worker-b — that is the whole point of F04).

---

## Summary table

| # | Discipline | Status | Notes |
|---|---|---|---|
| 1 | the historical spikes tree  not packages/ | ✅ | unchanged |
| 2 | expiration date | ✅ | 2026-08-01 |
| 3 | not in CI main | ✅ | root local-sim test is validation infra, not spike code |
| 4 | findings template | ✅ | append-only §9 closure sections on every Round-1 doc |
| 5 | no production data | ✅ | synthetic payloads only |
| 6 | Round 1/2 isolation | ✅ | separate names + resources |
| 7 | package imports | ✅ (modified) | Round 2 IS allowed to import `@nano-agent/*`; follow-up probes are not |

Round 2 may ship.
