# `skill.core` — Deferral Rationale

> Status: `patch-4 from context-space-examined-by-opus.md §6`
> Author: Claude Opus 4.7 (1M context)
> Date: 2026-04-21
> Purpose: explain why `skill.core` does NOT have a dedicated context bundle under `docs/eval/worker-matrix/` and under what conditions it should enter first-wave scope in the future.
>
> This file exists because the Opus context-space review surfaced a discoverability gap: B8 handoff proposes `skill.core` as a reserved worker name, but `docs/eval/worker-matrix/` only prepares 4 workers (`agent-core`, `bash-core`, `context-core`, `filesystem-core`). Without this file, a fresh worker-matrix charter author would not know whether `skill.core` is "forgotten" or "intentionally deferred."

---

## 1. The question this file answers

> **Is `skill.core` missing from the worker-matrix context bundle by oversight, or is it a deliberate deferral?**

**Answer: deliberate deferral.** It is a reserved name, not a first-wave candidate.

---

## 2. The position of `skill.core` in current design

### 2.1 In B8 handoff — reserved, not first-wave

`docs/handoff/after-foundations-to-worker-matrix.md` line 106:

| candidate name | B8 status | reason |
|---|---|---|
| … | … | … |
| `skill.core` | reserved only | **not** first-wave; keep as a named reserve |

And line 235:

> reserve only: `skill.core`

### 2.2 In naming proposal — explicit scope barrier

`docs/handoff/next-phase-worker-naming-proposal.md` line 67:

> `skill.core` | reserved only | current repo has no dedicated shipped skill substrate and no current product requirement forcing the split

Line 126 (closure rules):

> do not let `skill.core` consume scope before the first four names are grounded.

This is the strongest signal the handoff gives: **`skill.core` scope creep is a charter-level anti-pattern.**

### 2.3 In NACP protocol — `skill.invoke.*` verbs exist, `skill.core` worker does not

The NACP `skill.*` family is registered at `packages/nacp-core/src/messages/skill.ts`:

- `skill.invoke.request` — command, producer: `session`
- `skill.invoke.response` — response / error, producer: **`skill`**

Role gate `producer_role: "skill"` is in `nacp-core` `NacpProducerRoleSchema` already. So **the protocol surface exists**, but there is:

- no `@nano-agent/skill-runtime` package
- no shipped skill registry
- no `SKILL_WORKER` env binding
- no `createSkillRunner()` or equivalent subsystem
- no skill-specific test harness beyond NACP-level matrix tests

Compared to `bash.core`, which has a full `@nano-agent/capability-runtime` package + 21-command registry + handlers + bridge + service-binding target + 352 tests, `skill.core` has essentially **just the protocol slot**.

---

## 3. Why first-wave does not include `skill.core`

### 3.1 The readiness asymmetry is severe

| dimension | `bash.core` readiness | `skill.core` readiness |
|---|---|---|
| core package | `@nano-agent/capability-runtime` shipped | **missing** |
| registry | 21 commands + policy + taxonomy | **missing** |
| handlers | 6 capability handler files | **missing** |
| tests | 352 unit + integration | **missing** (only NACP envelope-level tests) |
| transport target | `ServiceBindingTarget` shipped | **missing** |
| protocol verbs | `tool.call.*` already live at wire | `skill.invoke.*` registered but no producer |

In readiness-stratification terms (`docs/eval/worker-matrix/worker-readiness-stratification.md`), `skill.core` would score **D for 5 of 6 dimensions**. It is not at the same maturity stage as the other 4.

### 3.2 Without a product driver, any scope is speculative

First-wave worker-matrix work is justified because each of the 4 chosen workers has:

1. a live substrate in the repo, AND
2. a concrete product motivation (agent needs to run turns → `agent.core`; LLMs need bash tool → `bash.core`; turns generate history → `context.core`; tools need files → `filesystem.core`)

`skill.core` has neither. The product question "what is a skill?" itself is still open:

- Is a skill a long-lived stateful subroutine?
- Is it a prompt-plus-tool recipe?
- Is it a cross-session reusable plan?
- Is it an RPC adapter for a 3rd-party provider?

Any of these answers would map to very different runtime shapes. Picking one now would be premature cognition-freeze.

### 3.3 The 4-worker first wave is already cognition-heavy

Worker-matrix Phase 0 already has to:

1. Install kernel + llm + capability into default composition (agent.core wiring)
2. Route tool calls through `CAPABILITY_WORKER` remote seam (bash.core wiring)
3. Decide context-management auto-mount policy (context.core decision)
4. Decide `ReferenceBackend` connected-mode policy (filesystem.core decision)
5. Implement `initial_context` consumer (cross-worker orphan responsibility)

Adding `skill.core` as a 5th first-wave candidate would require inventing substrate, registry, runtime, and policy from scratch — **while the other 4 workers are still in the wiring phase**. The sequencing is wrong.

---

## 4. When should `skill.core` enter scope

`skill.core` becomes a reasonable next-wave candidate when **all** of these are true:

1. **First-wave 4 workers closed** — `agent.core` Phase 0 milestone shipped; `bash.core` default remote path live; `context.core` auto-mount policy decided; `filesystem.core` connected-mode policy decided
2. **Product driver exists** — a concrete use case forces the "skill" concept into definition (e.g. a stateful workflow the agent must remember across turns, or a 3rd-party provider adapter family that is too heterogeneous for `tool.call.*`)
3. **Substrate design exists** — at least one shipped package or RFC defines what a skill is (analogous to how `@nano-agent/capability-runtime` defined `bash.core` substrate before worker-matrix started)
4. **Charter cycle available** — a worker-matrix Phase 1 or Phase 2 charter exists that explicitly admits skill.core into scope

If any of these 4 is not met, `skill.core` should remain reserved.

---

## 5. What "reserved" currently protects

While `skill.core` is reserved, the system still enforces several invariants:

1. **`skill.invoke.*` verbs remain legal at the protocol wire** — validators accept them; role gate allows `producer_role: "skill"`. Future implementations do not need an NACP upgrade.
2. **`skill.core` name is NOT available for reassignment** — anyone proposing a new worker must pick a different name. The reservation prevents accidental shadowing.
3. **Charter anti-scope-creep rule holds** — `next-phase-worker-naming-proposal.md:126` explicitly says "do not let `skill.core` consume scope before the first four names are grounded." This is a normative constraint, not a suggestion.
4. **No code lives under `skill.core`** — there is no `@nano-agent/skill-runtime`, no `packages/skill-*`, no `SKILL_WORKER` env slot. This absence is intentional; charter authors should treat any proposal to create one as requiring RFC-level justification.

---

## 6. Meta-note on this file's existence

This deferral rationale is itself an **anti-pattern prevention tool**:

Without it, a worker-matrix charter author might see 4 out of 5 expected workers in the context bundle and assume the 5th was either (a) forgotten or (b) too obvious to document. Either assumption is dangerous — the first invites reinvention, the second invites premature scope expansion.

This file exists to make the deferral **load-bearing** rather than **load-hiding**. A charter author who reads the bundle will find this file and know: `skill.core` is reserved, deferred, and protected — in that order.

If and when `skill.core` enters scope, this file should be replaced (not deleted) by a real `docs/eval/worker-matrix/skill-core/` directory following the same 5-doc scheme as the other 4 workers.
