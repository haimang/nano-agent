# Next-phase worker naming proposal — current status after pre-worker-matrix

> **Status**: `proposal partly materialized`
> **Canonical ancestry**: `docs/handoff/next-phase-worker-naming-proposal.md`
> **Current truth sources**: `workers/*`, `docs/issue/pre-worker-matrix/W4-closure.md`, `docs/handoff/pre-worker-matrix-to-worker-matrix.md`

---

## 1. What is now frozen enough to use

The following logical names remain the correct first-wave mental model:

| logical worker | current physical reality |
|---|---|
| `agent.core` | `workers/agent-core/`, service name family `nano-agent-agent-core` |
| `bash.core` | `workers/bash-core/`, service name family `nano-agent-bash-core` |
| `context.core` | `workers/context-core/`, service name family `nano-agent-context-core` |
| `filesystem.core` | `workers/filesystem-core/`, service name family `nano-agent-filesystem-core` |

And:

| logical worker | status |
|---|---|
| `skill.core` | reserved / deferred |

---

## 2. What remains proposal-only

These points are still proposal-level rather than runtime law:

1. whether worker-matrix r2 keeps exactly the same deploy/service names forever
2. whether any future binding-catalog revision is needed
3. how far `context.core` and `filesystem.core` go in first-wave live remote activation

But one rule is already stable:

> **`agent.core` is still the host worker. It is not a binding slot.**

---

## 3. How to use this naming file during r2 rewrite

1. keep the four first-wave logical names
2. keep `skill.core` deferred
3. keep deploy/service names aligned with the W4 shell reality unless r2 explicitly chooses to rename them
4. do not reopen naming as a free-form debate before absorbing the W3/W4 pack
