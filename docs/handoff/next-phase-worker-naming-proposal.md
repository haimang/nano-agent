# Next-phase worker naming proposal

> **This is a proposal, not a frozen decision.**
> **Worker matrix phase may adjust.**
> **B8 does not modify `V1_BINDING_CATALOG`; it only proposes next-phase worker names.**

---

## 1. Why this proposal exists

After-foundations proved enough substrate reality to talk about first-wave workers, but B8 is still a handoff phase:

1. it does **not** decide the next phase’s full charter;
2. it does **not** rewrite the current binding catalog;
3. it does **not** force a provider/skill split before product demand exists.

What B8 *does* provide is a naming proposal the next phase can accept, reject, or refine without re-reading the whole B1-B7 stack.

---

## 2. Current reality that remains unchanged in B8

Current shipped binding reality:

| current reality | source | B8 posture |
|---|---|---|
| `CAPABILITY_WORKER` | `packages/session-do-runtime/src/env.ts` | unchanged |
| `HOOK_WORKER` | `packages/session-do-runtime/src/env.ts` | unchanged |
| `FAKE_PROVIDER_WORKER` | `packages/session-do-runtime/src/env.ts` | unchanged |
| `SKILL_WORKERS` reserved slot | `packages/session-do-runtime/src/env.ts` | still reserved-only |
| 3 service bindings declared in `wrangler.jsonc` | `packages/session-do-runtime/wrangler.jsonc` | unchanged |

Therefore this proposal should be read as:

> “Here are the **worker names** the next phase is likely to want,”  
> not  
> “Here is the **binding catalog** B8 already changed.”

---

## 3. Proposed first-wave workers

| proposed worker | role | form | why it is first-wave |
|---|---|---|---|
| `agent.core` | host worker | session DO’s next assembly form | the host still owns session lifecycle, routing, replay, and composition |
| `bash.core` | remote worker | capability-runtime-first execution shell | fake-bash / capability execution is already a distinct shipped substrate |
| `filesystem.core` | remote worker | storage/workspace-heavy shell | B2/B7 proved the storage substrate is independently valuable and evidence-backed |
| `context.core` | remote worker | async compact + inspection shell | owner decision already upgraded context/core from “reserved maybe later” to first-wave |

### 3.1 Suggested deployment names

| logical name | suggested worker service name |
|---|---|
| `agent.core` | `nano-agent-agent-core` |
| `bash.core` | `nano-agent-bash-core` |
| `filesystem.core` | `nano-agent-filesystem-core` |
| `context.core` | `nano-agent-context-core` |

These names are only there to reduce startup friction in worker matrix phase 1. They are not a protocol freeze.

---

## 4. Reserved-only name

| proposed worker | status | reason |
|---|---|---|
| `skill.core` | reserved only | current repo has no dedicated shipped skill substrate and no current product requirement forcing the split |

B8 recommendation:

- keep the name visible,
- keep the slot reserved,
- do **not** spend first-wave charter budget implementing it.

---

## 5. Critical distinction — `agent.core` is not a binding slot

This is the easiest mistake for the next phase to make, so B8 keeps it explicit:

> **`agent.core ≠ binding slot`.**

`agent.core` is the **host worker**. It is the thing that:

- owns the session DO lifecycle,
- consumes remote workers,
- coordinates replay/checkpoint/handoff,
- and decides composition.

It is **not** one more entry in the same category as:

- `CAPABILITY_WORKER`
- `HOOK_WORKER`
- `FAKE_PROVIDER_WORKER`

Those are remote seams. `agent.core` is the host.  
Worker matrix should preserve that abstraction boundary even if the host later exposes callback endpoints of its own.

---

## 6. Naming migration posture for worker matrix

Recommended policy:

1. keep current runtime/catalog names untouched until worker matrix has real shell code,
2. use these names first at the **deployment/service** layer,
3. only discuss a v2 binding catalog if first-wave shell reality actually demands it,
4. do not let `skill.core` consume scope before the first four names are grounded.

---

## 7. Verdict

**Recommended proposal for worker matrix kickoff**

1. host: `agent.core`
2. remotes: `bash.core`, `filesystem.core`, `context.core`
3. reserve only: `skill.core`

Use this as a naming seed, not as a frozen law.
