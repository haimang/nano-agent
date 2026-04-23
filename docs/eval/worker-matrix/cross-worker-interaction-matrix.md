# Worker Matrix — Cross-Worker Interaction Matrix

> **Status**: `refreshed derived matrix`
> **Purpose**: summarize the cross-worker seams that worker-matrix r2 must preserve, wire, or deliberately defer
> **Last refreshed**: `2026-04-23`

---

## 0. One-line verdict

**The current first-wave interaction model is not “4 already-live remote workers talking to each other.” It is `agent.core` as host/session edge, `bash.core` as the main remote execution seam to activate, and `context.core` / `filesystem.core` as mostly host-local substrate truths that must be absorbed without inventing unnecessary new wire paths.**

---

## 1. How to read this matrix

- **Rows** = producer / initiator
- **Columns** = consumer / callee / dependency owner
- each cell answers 3 questions:
  1. what seam or dependency exists,
  2. what the current truth is,
  3. what r2 should do with it

### Status legend

| tag | meaning |
|---|---|
| **real-local** | live current path exists, but mostly as host-local / package-local substrate |
| **seam** | boundary slot exists, but the default live path is not yet assembled |
| **partial** | some real pieces exist, but a key consumer/policy decision is still missing |
| **defer** | intentionally not a first-wave remote interaction |
| **na** | not a meaningful first-wave interaction |

---

## 2. The current 4×4 interaction matrix

| producer ↓ / consumer → | `agent.core` | `bash.core` | `context.core` | `filesystem.core` |
|---|---|---|---|---|
| **`agent.core`** | — | **`tool.call.*` dispatch** — `CAPABILITY_WORKER` / service-binding seam exists, but default composition does not yet install the live kernel→capability path. **Status: seam.** **r2 action:** make this the first real absorbed execution loop. | **`context.compact.*` + `initial_context` handoff** — compact substrate exists, but `initial_context` still has no host-side consumer and compact remains host-local. **Status: partial.** **r2 action:** close the host ingress → context assembly path and decide default compact posture. | **workspace / snapshot / evidence substrate** — host already depends on filesystem truth through local composition. **Status: real-local.** **r2 action:** preserve the shared substrate; do not invent a fake filesystem wire protocol for first wave. |
| **`bash.core`** | **tool response / progress return path** — bash work returns to the host; only `agent.core` owns `session.stream.event`. **Status: seam** for remote default path, **real-local** for package/runtime truth. **r2 action:** activate the remote/default route without moving session wire ownership. | — | **no first-wave direct bash→context worker call** — any context-visible consequence should go through host stream/evidence paths, not a new bash→context protocol. **Status: defer.** | **shared workspace consumer path** — file/search/vcs handlers already consume the same workspace/path truth as filesystem-core. **Status: real-local.** **r2 action:** keep one workspace law; no duplicated path model. |
| **`context.core`** | **compact result / evidence / hook effect back into host loop** — host remains the session edge and receives context-side consequences. **Status: real-local.** **r2 action:** keep host ownership explicit. | **no default context→bash tool loop** — context does not originate tool execution in first wave. **Status: defer.** | — | **snapshot / artifact / assembly dependency** — context-side compaction and assembly depend on the same workspace/artifact substrate owned by filesystem-core. **Status: real-local.** **r2 action:** preserve the C2↔D1 split, not a new RPC. |
| **`filesystem.core`** | **workspace + evidence fan-in to host** — filesystem-side evidence and mounted workspace feed the host composition and eval sink. **Status: real-local.** **r2 action:** keep this as a substrate dependency, not a second session edge. | **bash is the main external consumer** — filesystem does not initiate `tool.call.*`; bash consumes filesystem truth. **Status: real-local.** | **context consumes filesystem artifacts/snapshots** — this is a shared substrate relationship, not a remote worker conversation. **Status: real-local.** | — |

---

## 3. What this matrix means for r2

### 3.1 Only one cross-worker loop is clearly first-wave critical

The main first-wave boundary that still needs real activation is:

1. **`agent.core ↔ bash.core`**

Why:

1. the seam already exists,
2. the worker shell already exists,
3. the product need is immediate,
4. and the missing piece is assembly, not invention.

### 3.2 The most important non-remote gap is still `initial_context`

The highest-value unresolved cross-worker responsibility is still:

1. `session.start.body.initial_context`
2. host ingress consumption in `agent.core`
3. handoff into `context.core` assembly

This is cross-worker in responsibility, but not yet a separate remote wire.

### 3.3 `context.core` and `filesystem.core` are first-wave workers without first-wave remote chatter

That is the core nuance this matrix is meant to preserve:

1. they are real workers in the W3/W4/W5 plan
2. their shells now physically exist
3. but their most important current truths are still **substrate truths**
4. so r2 should absorb and compose them first, not rush to invent extra worker-to-worker RPC

---

## 4. Cross-cutting invariants

Every cell above depends on these shared laws:

1. **`agent.core` remains the only session edge owner** — only the host should own WebSocket / replay / stream legality
2. **workspace/path truth stays singular** — bash, context, and filesystem must keep consuming the same workspace law
3. **evidence vocabulary stays shared** — assembly / compact / artifact / snapshot evidence should keep converging into the same eval/evidence path
4. **tenant-scoped storage law stays global** — absorption must not fork ref/key semantics across workers
5. **remote seams should be added only when they solve a real first-wave problem** — shell existence alone is not sufficient justification

---

## 5. Derived first-wave ordering

Reading the matrix strictly from highest-value unresolved cells:

1. **activate `agent.core ↔ bash.core` default execution path**
2. **close `initial_context` host-consumer → context-assembly path**
3. **preserve filesystem/shared workspace truth while deciding connected-mode policy**
4. **keep context/filesystem evidence and snapshot fan-in intact when absorption begins**

Deliberately **not** first-wave critical:

1. a new remote `context.compact.*` worker transport
2. a new remote filesystem RPC family
3. direct `context.core ↔ bash.core` conversations
4. any attempt to give non-host workers ownership of `session.*` wire behavior

---

## 6. Maintenance rule

This file is derived truth.

Primary sources remain:

1. the 4 worker `index.md` files
2. the 4 worker `external-contract-surface.md` files
3. `00-contexts/00-current-gate-truth.md`
4. pre-worker final closure / handoff + W3 map / blueprints

If those move, this matrix should move in the same PR.
