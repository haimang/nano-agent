# `skill.core` — Deferral Rationale

> **Status**: `refreshed scope-guard note`
> **Purpose**: explain why `skill.core` is still not a first-wave worker-matrix target after pre-worker closure and worker-doc refresh
> **Last refreshed**: `2026-04-23`

---

## 0. One-line answer

**`skill.core` is absent from the current worker-matrix context bundle by deliberate deferral, not by omission. It remains a reserved name and an explicit anti-scope-creep guard.**

---

## 1. Why this question still matters

The current folder prepares 4 first-wave workers:

1. `agent.core`
2. `bash.core`
3. `context.core`
4. `filesystem.core`

That can make a fresh reader ask:

> if `skill.core` has a known name, why is it not here?

This file exists so r2 does not answer that question by accident.

---

## 2. Current truth about `skill.core`

### 2.1 What exists

1. the **name** exists as a reserved worker concept in upstream naming / handoff history
2. the **protocol family** exists at the NACP layer (`skill.invoke.*`)
3. the **producer role** `skill` exists in protocol truth

### 2.2 What does **not** exist

1. no shipped `packages/skill-*` substrate
2. no `workers/skill-core` shell
3. no W3 absorption unit assigned to `skill.core`
4. no skill runtime registry, transport target, or host assembly path
5. no first-wave product requirement that forces a skill worker split now

That means current reality is:

> protocol reservation exists; runtime substrate does not.

---

## 3. Why first wave still excludes `skill.core`

### 3.1 W3/W4/W5 already froze a 4-worker first wave

The current worker-matrix truth is built around:

1. `agent.core`
2. `bash.core`
3. `context.core`
4. `filesystem.core`

And W3 already mapped the current absorption work into those 4 workers.

So adding `skill.core` now would not be “finishing the plan.” It would be **changing the plan**.

### 3.2 There is no shipped substrate to absorb

The first-wave 4 workers all have a real substrate story:

| worker | substrate truth today |
|---|---|
| `agent.core` | `session-do-runtime` |
| `bash.core` | `capability-runtime` |
| `context.core` | `context-management` + C2 context slice |
| `filesystem.core` | D1 filesystem slice + `storage-topology` |

`skill.core` has no equivalent shipped substrate.

Without that, a `skill.core` worker would be greenfield invention disguised as matrix planning.

### 3.3 The current first-wave load is already sufficient

r2 already needs to schedule:

1. `agent.core` host/runtime absorption
2. `bash.core` default execution-path activation
3. `context.core` host ingress / compact posture decisions
4. `filesystem.core` connected-mode / absorption posture

Adding `skill.core` now would multiply cognition range before the 4 live targets are grounded.

---

## 4. What “reserved” protects today

Keeping `skill.core` reserved but deferred protects 4 things:

1. **name stability** — the name is not lost to an unrelated worker idea
2. **scope discipline** — r2 does not quietly become a 5-worker charter
3. **protocol continuity** — future skill work can still reuse the existing `skill.invoke.*` family
4. **planning honesty** — the repo does not pretend a substrate exists when it does not

---

## 5. When `skill.core` may legitimately enter scope

`skill.core` becomes a reasonable candidate only when all of the following become true:

1. **the current 4 workers are grounded enough** that first-wave absorption is no longer the main bottleneck
2. **the product meaning of “skill” is explicit**, not still vague
3. **a real substrate or RFC exists** that defines what `skill.core` would absorb
4. **a later charter explicitly admits it into scope**

If any of those are still false, the correct posture remains:

> reserve the name, defer the worker.

---

## 6. r2 writing rule

For `plan-worker-matrix.md` r2:

1. mention `skill.core` only as an explicit reserved/deferred slot
2. do **not** create a fifth first-wave worker track
3. do **not** invent skill runtime scope just to “complete the symmetry”
4. do **not** let protocol reservation be misread as runtime readiness

---

## 7. Replacement rule

If `skill.core` ever becomes real scope, this file should be replaced by a full `docs/eval/worker-matrix/skill-core/` pack.

Until then, this single-file rationale is the correct level of truth.
