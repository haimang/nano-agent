# B7 Phase 2 Closure — Round-2 spike skeleton + isolated deploy surface

> **Status**: `closed`
> **Closed**: 2026-04-20
> **Owner**: Claude Opus 4.7 (1M context)

## What this phase built

Round-2 directory tree mirroring Round-1's deploy-shaped structure
but with separate names, resources, and the key `-r2` suffix.

### Storage spike (`spike-do-storage-r2/`)

| file | purpose |
|---|---|
| `package.json` | wrangler + TypeScript devDeps |
| `tsconfig.json` | strict + `@cloudflare/workers-types` |
| `wrangler.jsonc` | worker / DO / KV / R2 / D1 bindings (`-r2` naming) |
| `README.md` | routes, gates, modes, local-sim docs |
| `.gitignore` | `.wrangler/` / `dist/` / `.dev.vars` |
| `src/worker.ts` | route table — 4 follow-ups + 3 re-validations |
| `src/result-shape.ts` | `IntegratedProbeResult` with `verdict / usedPackages / caveats / evidenceRefs` |
| `src/do/IntegratedProbeDO.ts` | DO backing F08 bisection + mem-vs-DO parity |
| `scripts/deploy.sh` | owner-run deploy entry |
| `scripts/run-all-probes.sh` | iterate 7 routes, write `.out/*.json` |
| `scripts/extract-finding.ts` | convert `.out/*.json` into round-2 closure drafts (stdout only; never mutates finding docs directly) |

### Binding-pair spike (`spike-binding-pair-r2/`)

| file | purpose |
|---|---|
| `worker-a-r2/` | caller: binding-F01 + binding-F04 follow-ups, binding-F02/F03 re-validation |
| `worker-b-r2/` | callee: owns `BoundedEvalSink`, serves `/slow` (F01 log), `/sink/*` (F04) |
| `scripts/deploy-both.sh` | deploy worker-b first, then worker-a |
| `scripts/run-all-probes.sh` | iterate 3 worker-a routes + reminder to capture `wrangler tail` for F01 |
| `scripts/extract-finding.ts` | same contract as storage variant |

### Imports of shipped packages

Per Round-2 discipline §7 exception:

- `spike-do-storage-r2` imports `@nano-agent/storage-topology`,
  `@nano-agent/capability-runtime`, `@nano-agent/context-management`.
- `spike-binding-pair-r2/worker-b-r2` imports
  `@nano-agent/session-do-runtime` (`BoundedEvalSink`,
  `extractMessageUuid`).

Pure follow-up probes that measure raw platform truth do NOT import
shipped packages (`do-size-cap-binary-search`, `r2-concurrent-put`,
`kv-cross-colo-stale`, `curl-high-volume`, `binding-f01-callee-abort`).

## Exit criteria — met

- [x] `spikes/round-2-integrated/` tree created
- [x] 2 round-2 worker skeletons build-shaped with separate names
- [x] shipped packages imported at the re-validation boundary
- [x] result/evidence shape supports closure-section writeback
- [x] scripts for deploy / probe-run / finding-extract in place
