# Worker Matrix — Global Readiness Stratification

> Status: `patch-3 from context-space-examined-by-opus.md §6`
> Author: Claude Opus 4.7 (1M context)
> Date: 2026-04-21
> Purpose: give worker-matrix charter authors a single-table, N-worker × M-dimension readiness view. Complements per-worker `index.md §6` open-gaps tables by showing them side-by-side.
>
> Derived from the 4 per-worker `index.md` + `realized-code-evidence.md` + `external-contract-surface.md`. See §4 "Maintenance rule."

---

## 0. Rating legend

| tag | meaning |
|---|---|
| **real** | deploy-shaped code path exists + regression-tested; usable today |
| **partial** | code exists but has honest gaps (stubs / not-implemented sections / non-default path) |
| **seam** | transport/composition slot exists but default consumer is not wired |
| **missing** | no code, no seam |
| **deferred** | explicitly out-of-scope for first wave by charter |

---

## 1. Master readiness table (6 dimensions × 4 workers)

| dimension | `agent.core` | `bash.core` | `context.core` | `filesystem.core` |
|---|---|---|---|---|
| **D1. Core package(s) exist** | **real** — `@nano-agent/session-do-runtime 0.3.0` + orchestrator + DO host | **real** — `@nano-agent/capability-runtime` + 21-command registry + handlers + bridge | **real** — `@nano-agent/context-management 0.1.0` + `@nano-agent/workspace-context-artifacts` | **real** — `@nano-agent/workspace-context-artifacts` + `@nano-agent/storage-topology` |
| **D2. Default composition wires this worker's subsystems** | **seam** — `createDefaultCompositionFactory()` returns `kernel: undefined, llm: undefined, …` (see `composition.ts:90-106`) | **seam** — `CAPABILITY_WORKER` transport seam exists but `kernel` consumer is not wired | **partial** — workspace trio auto-mounts in default DO path (`nano-session-do.ts:282-305`); `context-management` orchestrator is NOT auto-wired | **real** — default DO path mounts `composeWorkspaceWithEvidence(...)` (`nano-session-do.ts:282-305`) |
| **D3. Independent Worker deploy shell** | **missing** — no separate `agent-core-worker` wrangler entry (host shell IS `session-do-runtime`) | **missing** — no `bash-core-worker` wrangler entry; transport exists but no deployed target | **missing** — no `context-core-worker`; `context.compact.*` is in-process only | **missing** — no `filesystem-core-worker`; workspace is host-local |
| **D4. Remote service-binding path** | **seam** — `HOOK_WORKER` + `FAKE_PROVIDER_WORKER` env slots exist (`env.ts:55-121`); `CAPABILITY_WORKER` is the outbound seam | **seam** — `CAPABILITY_WORKER` env slot present; `serviceBindingTransport` produced by `makeRemoteBindingsFactory()` (`remote-bindings.ts:329-390`) | **not-yet** — `context.compact.*` remote transport does not exist; intentional Phase 0 posture | **not-yet** — no remote filesystem seam; workspace stays host-local by design |
| **D5. Regression test coverage** | **real** — 357 session-do-runtime tests + 17 root B9 tests + checkpoint roundtrip | **real** — 352 capability-runtime tests + 21-command smoke + service-binding-transport integration | **real** — 97 context-management + 192 workspace-context-artifacts + root contract tests | **real** — 192 workspace + 169 storage-topology + DO/R2 adapter tests |
| **D6. Protocol contract alignment** | **real** — owns `session.*` profile via `nacp-session`; consumes `tool.call.*` + `context.compact.*` as host | **real** — aligned to `tool.call.*` body family (`tool-call.ts`) + core direction matrix + role gate | **real** — `CompactBoundaryManager` produces `context.compact.request/response` that pass `nacp-core` schema | **partial** — `NacpRef` / `tenant-scoped key` / `_platform/` reserved namespace law is codified; but no dedicated `filesystem.*` verb family exists (workspace is consumed via in-process FsLike) |

---

## 2. First-wave decision framework

### 2.1 Green column ⇒ no Phase 0 action

Cells that are `real` across the board can be **locked**, not rebuilt:

- D1 for all 4 workers — substrate packages are final
- D5 for all 4 workers — test harnesses are live; net test count is 2242+ (core) + 98 (root) + 112 (cross)
- D6 for `agent.core` / `bash.core` / `context.core` — protocol alignment is finalized

**Charter rule**: do not rewrite any of these surfaces in Phase 0. If a redesign is necessary, it must be a separate RFC after Phase 0 closure.

### 2.2 Yellow column ⇒ Phase 0 wiring work

Cells that are `seam` or `partial` are the **Phase 0 critical path**:

- **D2 / agent.core**: install `KernelRunner + LLMExecutor + WorkspaceNamespace` into `createDefaultCompositionFactory()`. This is the single largest Phase 0 deliverable.
- **D2 / bash.core**: wire `CAPABILITY_WORKER` transport seam as the default kernel tool dispatcher.
- **D2 / context.core**: decide whether `AsyncCompactOrchestrator` should be auto-mounted into default DO path (Phase 0 candidate) or opt-in (Phase 1). See also refine-3 in `context-core/index.md §6`.
- **D4 / agent.core** + **D4 / bash.core**: transport seams are live but no default consumer chooses them at session start. Phase 0 must decide: does a fresh session default to local or remote composition? Current `selectCompositionFactory()` uses env-presence heuristic — this may need an explicit policy.
- **D6 / filesystem.core**: decide if first wave needs a `filesystem.*` verb family or if in-process FsLike is sufficient. Current Opus/GPT eval says in-process is fine for P0.

### 2.3 Red column ⇒ Phase 1+ deferrals

Cells that are `missing` / `deferred` / `not-yet` should NOT be attempted in Phase 0:

- **D3 for all 4 workers** — independent wrangler entries are a Phase 1 concern at earliest. Host worker = `session-do-runtime` is the only deploy-shaped Worker at Phase 0 exit.
- **D4 for context.core / filesystem.core** — remote transport is not an architectural necessity yet; keep these seams unbound.

---

## 3. Aggregate readiness grade per worker

| worker | grade | 1-line justification |
|---|---|---|
| `agent.core` | **A- (ready for wiring)** | substrate done, test harness live, only default composition wiring missing |
| `bash.core` | **A- (ready for wiring)** | 21-command governed subset complete + transport seam live; default consumer wiring is the only gap |
| `context.core` | **B+ (ready with 1 decision needed)** | assembler / compact boundary / snapshot / evidence are real; `context-management` default-mount + inspector default-on need charter decisions |
| `filesystem.core` | **A- (ready for wiring)** | mount + workspace + backends + adapters all real; first-wave decision needed on `ReferenceBackend.connected` mode |

**Aggregate**: 4 / 4 workers are at A- or higher. **No worker is a Phase 0 blocker on its own substrate.** The blockers are all in the **wiring** column (D2) — which is exactly what `agent-core/index.md §4 判断 5` calls "默认 host 能跑 session shell,但还没有默认跑出真实 agent turn loop."

---

## 4. Phase 0 scope implication

Reading D2 column top-to-bottom:

1. agent.core D2 = seam → **Phase 0 deliverable #1**
2. bash.core D2 = seam → **Phase 0 deliverable #2** (follows from #1 — same composition change)
3. context.core D2 = partial → **Phase 0 deliverable #3** (decide whether to auto-mount compact orchestrator)
4. filesystem.core D2 = real → **Phase 0 maintenance** (stay real; add first-wave guidance on connected mode — see refine-2)

**All 4 D2 cells belong to the same edit**: the default composition factory in `packages/session-do-runtime/src/composition.ts`. A single focused PR can move 4 cells from seam/partial to real.

This is the unique Phase 0 necessary milestone. Everything else (deploy shells, remote transports, additional workers) is Phase 1+.

---

## 5. Maintenance rule

This stratification is derived truth; per-worker `index.md §6` open-gaps tables are primary truth.

When any of the following change, this file must be updated in the same PR:
- `packages/session-do-runtime/src/composition.ts` (D2 rows)
- `packages/session-do-runtime/src/remote-bindings.ts` (D4 rows)
- package `package.json` version bumps (D1 rows)
- New wrangler entries under `packages/*/wrangler*` (D3 rows)

If a per-worker `index.md §6` adds a row, this table should add a column or an adjacent sub-table, not silently absorb it.
