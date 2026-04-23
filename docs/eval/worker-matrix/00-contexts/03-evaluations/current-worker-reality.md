# Worker Matrix — Current Worker Reality

> **Status**: `direct code-truth summary`
> **Built from**: current package code, current `workers/*` shells, W4 closure, and selective cross-checking against older worker index docs where still useful
> **Use this file before rewriting `plan-worker-matrix.md` r2**

---

## 1. One-line verdict

The 4-worker topology is now physically real, but the live worker-matrix runtime is **not** assembled yet: host/runtime substrate exists, shell/deploy substrate exists, absorption baseline exists, and the remaining work has become explicit execution work rather than fuzzy design work.

---

## 2. Four-worker truth table

| worker | what is already real | what is still missing | detailed raw material |
|---|---|---|---|
| `agent.core` | `session-do-runtime` host substrate, tenant plumbing, WS/HTTP ingress, checkpoint/replay glue, `workers/agent-core` shell, real preview deploy | default composition still returns `kernel / llm / capability / workspace / hooks / eval / storage = undefined`; remote composition still leaves `kernel / workspace / eval / storage` unresolved; `initial_context` still has no host consumer | `docs/eval/worker-matrix/agent-core/index.md` |
| `bash.core` | `capability-runtime` substrate is real; shell exists at `workers/bash-core`; dry-run path proven | no absorbed runtime code in `workers/bash-core/src/`; service-binding runtime still not activated as a worker-to-worker assembly path | `docs/eval/worker-matrix/bash-core/index.md` |
| `context.core` | `context-management` + `workspace-context-artifacts` substrate is real; shell exists; context/compact seam direction is documented | still no independent worker implementation, no remote compact delegate helper, no `initial_context` consumer, no first-wave assembled runtime | `docs/eval/worker-matrix/context-core/index.md` |
| `filesystem.core` | `workspace-context-artifacts` + `storage-topology` substrate is real; shell exists; storage/platform law is already evidence-backed | no absorbed runtime code in shell, no live remote service yet, no worker-era workspace authority implementation | `docs/eval/worker-matrix/filesystem-core/index.md` |

---

## 3. Cross-worker truth that r2 must inherit

Useful detailed raw-material docs outside `00-contexts` are:

1. `docs/eval/worker-matrix/cross-worker-interaction-matrix.md`
2. `docs/eval/worker-matrix/worker-readiness-stratification.md`
3. `docs/eval/worker-matrix/skill-core-deferral-rationale.md`

Treat them as detailed context to cross-check against this condensed summary. They answer:

- which seams already exist,
- which cells are real / seam / partial / missing,
- and why `skill.core` stays deferred.

---

## 4. Hard realities from code, not just docs

These are current code facts r2 must not blur:

1. `packages/session-do-runtime/src/composition.ts::createDefaultCompositionFactory()` still returns an otherwise-empty handle bag
2. `packages/session-do-runtime/src/remote-bindings.ts` still leaves `kernel / workspace / eval / storage` unresolved in remote composition
3. `packages/session-do-runtime/src/` and `packages/context-management/src/` still show **no current `initial_context` consumer**
4. `workers/agent-core/src/index.ts` is still a version-probe shell, not a live agent loop
5. `workers/*/package.json` currently resolve `@haimang/nacp-*` through `workspace:*` by deliberate interim choice

---

## 5. Rewrite consequence

`plan-worker-matrix.md` r2 therefore should be written as:

1. **assembly + absorption charter**
2. **not topology-freeze charter**
3. **not protocol-invention charter**
4. **not shell-bootstrap charter**

The next real unknowns are now execution-order and milestone questions, not basic structure questions.
