# Worker Matrix — Current Gate Truth

> **Snapshot date**: `2026-04-23`
> **Revision 4**: `2026-04-23` — `00-contexts` rebuilt around pre-worker-matrix closure + current repo reality
> **Use this file before consuming the rest of the bundle.**

---

## 1. One-line verdict

**Worker-matrix planning may start now, but only as `plan-worker-matrix.md` rewrite r2. The direct kickoff pack is pre-worker-matrix W5 closure/handoff plus current code truth; B8/B9 remain upstream ancestry, not the immediate gate.**

---

## 2. Direct planning pack

Treat the following as the actual rewrite input set:

1. `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`
2. `docs/handoff/pre-worker-matrix-to-worker-matrix.md`
3. `docs/issue/pre-worker-matrix/W5-closure.md`
4. `docs/issue/pre-worker-matrix/W4-closure.md`
5. `docs/design/pre-worker-matrix/W3-absorption-map.md`
6. `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`
7. `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`
8. `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`
9. `03-evaluations/current-worker-reality.md`

These are the files that answer:

- what is already frozen,
- what still belongs to worker-matrix,
- what code truth exists today,
- and what the first absorption / assembly PRs must inherit.

---

## 3. Current repo truth that r2 must assume

### 3.1 Protocol / package truth

1. `@haimang/nacp-core` is now **`1.4.0`**
2. `@haimang/nacp-session` is now **`1.3.0`**
3. GitHub Packages first publish is already real, not theoretical
4. only those two packages remain permanent external package truth; Tier B packages are absorption inputs, not forever-libraries

### 3.2 Runtime truth

1. `@nano-agent/session-do-runtime@0.3.0` is still the host-runtime substrate
2. `createDefaultCompositionFactory()` still returns `kernel / llm / capability / workspace / hooks / eval / storage = undefined` in the default path
3. remote composition still leaves `kernel / workspace / eval / storage` unresolved in `remote-bindings.ts`
4. `initial_context` still exists as shipped wire schema, but there is still **no host-side consumer wiring**

### 3.3 Worker-shell truth

1. `workers/agent-core`, `workers/bash-core`, `workers/context-core`, `workers/filesystem-core` physically exist
2. all 4 shells are in the pnpm workspace
3. `agent-core` has a real preview deploy:
   - `https://nano-agent-agent-core-preview.haimang.workers.dev`
4. the other 3 workers are still shell-only / dry-run validated
5. current worker shell dependency posture is `workspace:*` for the two published NACP packages, by deliberate interim choice

### 3.4 Scope truth

1. `skill.core` remains reserved / deferred
2. workspace RPC / remote compact delegate / evidence forwarding remain **RFC-frozen directions**, not shipped runtime APIs
3. W3 blueprints and map are now the execution baseline for Tier B absorption

---

## 4. Practical reading law

Use this precedence:

1. **pre-worker final closure / handoff**
2. **current code truth condensed inside `00-contexts`**
3. **B8/B9 ancestry summaries**
4. **historical templates**

In practice, that means:

| question | read this first | do not start from |
|---|---|---|
| what is the immediate kickoff pack? | pre-worker final closure + handoff | old B8/B9 copies alone |
| what code exists today? | `03-evaluations/current-worker-reality.md` | early exploratory evaluations or stale detailed indexes |
| what must remain immutable from after-foundations? | `01-b8-handoff/*` + `02-b9-contract/*` summaries + canonical source docs they cite | deprecated direct gate wording |
| what should r2 inherit as implementation order? | W3 map + representative blueprints + W4 closure | the old deprecated r1 worker charter |

---

## 5. What counts as ancestry only

The following remain important, but are no longer the direct entry gate:

1. B8 platform findings and B7-derived platform law
2. B9 contract-freeze rationale and implementation review history
3. early GPT / Opus worker-matrix evaluations
4. historical TOML / composition starter templates

Use them to preserve:

- platform constraints,
- contract law,
- host-vs-remote mental model,
- and evaluation rationale.

Do **not** use them to override:

- pre-worker W0-W5 closure truth,
- current package versions,
- current shell topology,
- or the current “rewrite first, execute next” stage gate.

---

## 6. Immediate rewrite consequences

`plan-worker-matrix.md` r2 should therefore:

1. **not** reopen topology or package-destiny debates
2. **not** pretend remote protocol families already shipped in code
3. **not** rebuild worker shells from scratch
4. **not** treat `agent.core` as a binding slot
5. **must** explicitly schedule:
   - first real absorption order,
   - `workspace:*` → published-path cutover milestone,
   - live service-binding activation sequence,
   - and W3 pattern-placeholder backfill

---

## 7. Revision 4 provenance

This revision was triggered because the old `00-contexts` bundle still centered B8/B9 and early evaluations as if pre-worker-matrix had not already finished W0-W5.

The rebuild uses:

1. pre-worker final closure and handoff,
2. W0-W4 closures,
3. current package / worker code truth,
4. the current worker-index docs under `docs/eval/worker-matrix/`,
5. and B8/B9 only as mediated ancestry.
