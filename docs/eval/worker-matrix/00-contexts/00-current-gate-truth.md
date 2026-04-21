# Worker Matrix — Current Gate Truth

> **Snapshot date**: `2026-04-21`
> **Use this file before consuming the rest of the bundle.**

---

## 1. One-line verdict

**Worker-matrix planning can use B8 as stable input, but must not treat B9 as fully closed yet.**

---

## 2. What is stable enough to plan against

### 2.1 B8 handoff remains valid

The following are still good planning inputs:

1. `B8-phase-1-closure.md` as the consolidated truth inventory
2. `after-foundations-to-worker-matrix.md` as the main handoff memo
3. `next-phase-worker-naming-proposal.md` as the naming seed
4. `wrangler-worker.toml` and `composition-factory.ts` as starter shapes

### 2.2 worker-matrix architecture evaluations remain useful

The GPT / Opus worker-matrix evaluations and the `smind-contexter` learnings are still direct design inputs for:

- first-wave worker boundaries
- host vs remote worker split
- `context.core` scope and timing
- `skill.core` reservation posture

---

## 3. What is not yet stable enough to freeze as truth

The latest GPT implementation review of B9 concluded **changes-requested**, not closed.

Two issues matter immediately for worker-matrix planning:

1. `NanoSessionDO.acceptClientFrame()` wires `verifyTenantBoundary()` as fire-and-forget, so tenant violation can be recorded **without actually blocking dispatch**
2. `wrapAsError()` does not currently produce a legal per-verb error envelope for the advertised request-to-error flow under the current 1.3 surface

There is also one low-severity docs drift item:

3. `packages/nacp-session/README.md` still carries one stale Core-owned phase-gate statement

---

## 4. Practical reading law for this bundle

Use the following precedence:

1. **latest review truth**
2. **then action-plan intent**
3. **then older closure posture**

In practice, that means:

| topic | use this as current truth | do not blindly inherit |
|---|---|---|
| B8 worker-matrix handoff | `01-b8-handoff/*` | scattered older phase docs |
| B9 contract freeze readiness | `02-b9-contract/B9-reviewed-by-GPT.md` | `docs/issue/after-foundations/B9-final-closure.md` |
| overall after-foundations readiness | this file + B8 handoff + B9 latest review | `docs/issue/after-foundations/after-foundations-final-closure.md` wording that assumes B9 is fully shipped |

---

## 5. What worker matrix should do with this

1. Start charter/design from the B8 handoff pack.
2. Keep B9 in scope as a pre-implementation contract fix-up.
3. Do not treat B9 closure language as authoritative until the review findings are repaired.
4. Use the evaluation docs to decide first-wave worker boundaries, but use the B9 review to constrain protocol/runtime assumptions.
