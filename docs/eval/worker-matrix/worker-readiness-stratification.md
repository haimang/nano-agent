# Worker Matrix — Global Readiness Stratification

> **Status**: `refreshed derived readiness view`
> **Purpose**: show where the 4 workers stand after pre-worker W0-W5 closure and the worker-doc refresh
> **Last refreshed**: `2026-04-23`

---

## 0. One-line verdict

**All 4 workers are now real first-wave targets, but they are not equally “live inside their shells.” The project is past the “do these workers exist?” stage and fully in the “which absorptions and wiring should r2 schedule first?” stage.**

---

## 1. Rating legend

| tag | meaning |
|---|---|
| **real** | the capability exists and is part of current truth |
| **partial** | some important pieces are real, but the end-to-end first-wave posture is not yet closed |
| **seam** | boundary slot exists, but the default live consumer path is still not assembled |
| **defer** | intentionally not first-wave to finish |

---

## 2. Master readiness table

| dimension | `agent.core` | `bash.core` | `context.core` | `filesystem.core` |
|---|---|---|---|---|
| **D1. Absorption substrate exists** | **real** — `session-do-runtime` + host runtime substrate | **real** — `capability-runtime` + fake-bash/tool substrate | **real** — `context-management` + C2 context slice | **real** — D1 filesystem slice + `storage-topology` |
| **D2. Worker shell is materialized** | **real** — `workers/agent-core` exists | **real** — `workers/bash-core` exists | **real** — `workers/context-core` exists | **real** — `workers/filesystem-core` exists |
| **D3. Shell verification state** | **real** — preview deploy exists | **real** — dry-run validated | **real** — dry-run validated | **real** — dry-run validated |
| **D4. Live runtime is absorbed into that shell** | **partial** — shell exists, but live host runtime remains package-side and not fully absorbed/wired through the shell | **partial** — shell exists, but command runtime is still package-side and default host dispatch is not activated | **partial** — shell exists, but C1/C2 runtime remains substrate-side and no default live absorbed flow exists in the shell | **partial** — shell exists, but D1/D2 runtime remains substrate-side and still depends on host-local composition truth |
| **D5. First-wave default wiring posture** | **seam** — default composition still lacks full host wiring | **seam** — remote/local tool dispatch seam exists but default first-wave path is not fully assembled | **partial** — compact/assembly truths are real, but `initial_context` consumer and default mount posture still need r2 decisions | **partial** — workspace/evidence truth is real, but connected-mode / absorption posture still needs r2 decisions |
| **D6. Remote boundary readiness** | **partial** — remote bindings and service slots exist, but the full workerized runtime path is not the default | **partial** — service-binding seam is the clearest first-wave remote path, but still not the default live path | **defer** — no need to force remote compact worker transport in first wave | **defer** — no need to force remote filesystem RPC in first wave |
| **D7. Contract + evidence truth** | **real** — host/session ownership and protocol legality are clear | **real** — `tool.call.*` + command policy truth is clear | **real** — `context.compact.*` + thin-substrate posture is clear | **real** — workspace/ref/storage law is clear |

---

## 3. Aggregate grade per worker

| worker | grade | why this grade is fair now |
|---|---|---|
| `agent.core` | **A- — ready for first absorption** | hardest wiring target, but the shell/substrate/protocol truth is already present |
| `bash.core` | **A- — ready for first absorption** | strongest remote seam candidate; missing piece is default activation, not substrate invention |
| `context.core` | **B+ — ready with policy decisions** | thin substrate is real, but host ingress ownership and default posture still need explicit r2 choices |
| `filesystem.core` | **A- — ready for absorption with one policy guard** | filesystem/storage substrate is real; remaining work is absorption posture, not existence |

### Aggregate conclusion

1. **No worker is blocked by missing shell existence**
2. **No worker needs to be re-justified as a first-wave candidate**
3. the real differentiator is now **wiring / absorption difficulty**, not “whether the worker is real”

---

## 4. What this means for worker-matrix r2

### 4.1 What r2 should treat as green

Do **not** reopen:

1. whether the 4 worker names are the right first-wave targets
2. whether the 4 worker shells should exist
3. whether the substrate packages are real enough to start

### 4.2 What r2 should treat as yellow

These are the true first-wave pressure points:

1. **`agent.core` default composition / host runtime absorption**
2. **`bash.core` default execution-path activation**
3. **`context.core` `initial_context` + default compact/assembly posture**
4. **`filesystem.core` connected-mode / absorption posture while preserving shared workspace truth**

### 4.3 What r2 should treat as red-for-now

Do not let these become false blockers:

1. independent remote compact worker transport
2. independent remote filesystem RPC family
3. a fifth first-wave worker
4. “everything must already run from `workers/*/src` before planning can continue”

---

## 5. Phase-order implication

A practical reading of this table yields the following order:

1. **A-group first** — close `agent.core` + `bash.core` live loop
2. **then C-group** — resolve host→context ownership and default posture
3. **then D-group** — absorb filesystem/storage semantics into the worker shell without forking workspace truth
4. **keep remote context/filesystem worker transports deferred unless a later phase proves the need**

This matches the broader r2 posture:

> the project already has shells and substrates; r2 should decide absorption order and live wiring order.

---

## 6. Maintenance rule

This table is derived truth.

It should move whenever any of these move:

1. any worker `index.md` verdict
2. `workers/*` deploy or verification status
3. default composition / remote binding posture
4. first-wave scope posture for context/filesystem remote paths
5. `skill.core` reservation status
