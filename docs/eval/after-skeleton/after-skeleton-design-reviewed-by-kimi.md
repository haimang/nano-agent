# After-Skeleton Design Review — Comprehensive Evaluation by Kimi

> Review Date: 2026-04-17  
> Reviewer: Kimi (k2p5)  
> Scope: All 15 design documents in `docs/design/after-skeleton/`  
> Reference: `docs/plan-after-skeleton.md`, `packages/*` code reality, `context/*` reference implementations  
> Review Type: Fact-checking, gap analysis, cross-reference validation, severity-ranked issue registry  

---

## 0. Executive Summary

The after-skeleton design suite represents a **significant methodological improvement** over the post-NACP phase. The designs correctly identify the phase's true mission—**contract freeze, identifier law, trace-first observability, and runtime closure**—rather than feature expansion. However, a systematic code-reality audit reveals **substantial gaps between design ambition and implementation state**. The designs often presuppose capabilities that do not yet exist in `packages/`, fail to account for legacy naming drift that contradicts the new identifier law, and occasionally over-specify substrate decisions before the implementation has reached the necessary maturity.

**Overall Assessment:** The designs are **architecturally sound but implementation-optimistic**. They would benefit from a tighter coupling to code reality, explicit acknowledgment of stub surfaces, and a more conservative substrate decision timeline.

---

## 1. Phase 0 — Contract & Identifier Freeze (P0-*)

### 1.1 P0-contract-and-identifier-freeze.md

**Architectural Soundness:** ★★★★☆  
**Implementation Alignment:** ★★☆☆☆  
**Actionability:** ★★★☆☆

**What it gets right:**
- Correctly identifies Phase 0 as a "governance baseline" rather than a feature.
- The four-state classification (Frozen / Frozen with Rename / Directional Only / Deferred) is pragmatic and reviewable.
- Explicitly excludes public API, business DDL, and fake bash details—scope discipline is strong.

**Code-Reality Gaps:**

1. **The document claims `nacp-core` envelope fields are "mostly Frozen with Rename,"** but the actual `packages/nacp-core/src/envelope.ts:115` defines `trace_id: z.string().uuid()` (not `trace_uuid`), and `producer_id` remains without `_uuid` or `_key` suffix migration. The design assumes a migration that has not occurred.

2. **The `NacpObservabilityEnvelope` in `packages/nacp-core/src/observability/envelope.ts:15` defines `trace_uuid: z.string().uuid().optional()`**—making it optional, not mandatory. This directly contradicts the design's claim that "any accepted internal request must carry `trace_uuid`." The design does not address this optional-to-required upgrade path.

3. **The contract matrix requires manual maintenance.** Without automated lint or codemod enforcement (which the design mentions but does not specify), this matrix will drift within weeks. The design acknowledges this risk but offers no mitigation beyond "code review discipline."

**Cross-Reference Check (context/safe, context/smcp):**
- SMCP uses `trace_uuid` consistently (context/smcp). SAFE uses `trace_id` but explicitly maps it to SMCP's `trace_uuid` (context/safe). The nano-agent design correctly chooses `trace_uuid` as canonical, but the implementation has not caught up.

**Verdict:** Good governance framework, but the baseline it claims to freeze does not yet exist in code. The design should explicitly acknowledge that **Phase 0 implementation requires a breaking schema migration** before it can be considered "frozen."

---

### 1.2 P0-identifier-law.md

**Architectural Soundness:** ★★★★★  
**Implementation Alignment:** ★★☆☆☆  
**Actionability:** ★★★☆☆

**What it gets right:**
- The suffix taxonomy (`*_uuid`, `*_key`, `*_name`, `*_ref`, `*_seq`) is clear, unambiguous, and lint-friendly.
- The "Translation Zone" concept for provider-native fields (e.g., OpenAI `tool_call_id`) is pragmatic.
- Explicitly forbids `*_id` as a generic suffix, which prevents semantic overload.

**Code-Reality Gaps:**

1. **The law is violated extensively in current code:**
   - `packages/nacp-core/src/envelope.ts`: `trace_id`, `producer_id`, `stream_id`, `span_id`
   - `packages/nacp-session/src/frame.ts`: `trace_id` (inferred from dist declarations)
   - `packages/session-do-runtime/src/traces.ts`: No `trace_uuid` field at all; uses `sessionUuid`, `turnUuid`, `teamUuid` (mixed casing: `Uuid` vs `uuid`)

2. **The document states "All UUIDs are lowercase with hyphens"** but does not address the camelCase drift (`turnUuid` vs `turn_uuid`) already present in session-do-runtime.

3. **No migration path is specified.** The law says "cancel `*_id`" but does not say: (a) in what order to migrate, (b) how to maintain backward compatibility during transition, (c) how to version the breaking change. P0-nacp-versioning-policy.md discusses versioning but does not connect it to the identifier migration.

**Cross-Reference Check (context/smcp):**
- SMCP uses `trace_uuid`, `run_uuid`, `step_run_uuid`, `alert_uuid` consistently. The nano-agent law aligns with SMCP, which is correct.

**Verdict:** The law itself is excellent. But it reads as if it were already enforced, when in fact it requires a **cross-package refactoring** that touches core envelope schema, session frame schema, observability payloads, and all test fixtures. The design should include an explicit migration action-plan.

---

### 1.3 P0-contract-freeze-matrix.md

**Architectural Soundness:** ★★★★☆  
**Implementation Alignment:** ★★★☆☆  
**Actionability:** ★★★★☆

**What it gets right:**
- The matrix format is reviewable and auditable.
- Distinguishes "Frozen with Rename" from "Frozen"—acknowledges that some surfaces need migration before they are truly stable.

**Code-Reality Gaps:**

1. **Several surfaces marked "Frozen" are not actually frozen in code:**
   - `core.trace.trace_uuid` is marked Frozen, but the code still uses `trace_id`.
   - `core.refs` is marked Frozen, but `NacpRefKindSchema` in `packages/nacp-core/src/envelope.ts:185-211` includes `d1` as a ref kind, yet no D1 binding exists in the runtime.

2. **The matrix does not include a "Needs Evidence" state.** Surfaces like `session.replay` and `session.resume` are marked Frozen, but their implementations in `packages/session-do-runtime/src/do/nano-session-do.ts` are raw JSON.parse + switch blocks—not exactly "frozen contract quality."

**Verdict:** Useful governance tool, but its accuracy depends on the matrix being updated after migration, not before. Risk of becoming a "wishlist matrix" rather than a "reality matrix."

---

### 1.4 P0-nacp-versioning-policy.md

**Architectural Soundness:** ★★★★☆  
**Implementation Alignment:** ★★★☆☆  
**Actionability:** ★★★☆☆

**What it gets right:**
- Introduces "Compat Floor" and "Migration Chain" concepts, which are necessary for a protocol that must support replay/restore.
- Correctly classifies renames as breaking changes.
- Aliases-only-in-adapter-layers rule prevents schema pollution.

**Code-Reality Gaps:**

1. **The policy states that `compat/migrations.ts` is the migration chain home, but `packages/nacp-core/src/compat/migrations.ts` is a placeholder** with only `z.object({})` exports. The policy is ahead of the code.

2. **The document reclassifies current `1.0.0` as a "pre-freeze provisional baseline,"** but this reclassification is not reflected anywhere in the code. `packages/nacp-core/src/version.ts` still exports `NACP_VERSION = "1.0.0"` without any "provisional" marker.

3. **No connection to the identifier migration.** The policy should explicitly state: "The migration from `trace_id` to `trace_uuid` will be NACP version 1.1.0, a breaking change with a 2-version compat floor." This connection is missing.

**Verdict:** Solid policy framework, but currently a "policy without a implementation engine." Needs explicit linkage to the identifier migration and a populated `compat/migrations.ts`.

---

## 2. Phase 1 — Trace Substrate Decision (P1)

### 2.1 P1-trace-substrate-decision.md

**Architectural Soundness:** ★★★★☆  
**Implementation Alignment:** ★★★☆☆  
**Actionability:** ★★★☆☆

**What it gets right:**
- Correctly frames the decision as "which substrate serves which temperature of data," not "which substrate is best overall."
- The "Actor Locality" principle (data should stay close to the Session DO) is appropriate for a DO-centered architecture.
- Acknowledges that `eval-observability` already uses DO storage (`DoStorageTraceSink`), so the decision is not greenfield.

**Code-Reality Gaps:**

1. **The document compares D1, DO storage, and R2+KV, but D1 is not declared anywhere in the runtime bindings.** `packages/session-do-runtime/src/env.ts` has no D1 binding. `packages/session-do-runtime/wrangler.jsonc` has no D1 binding. The comparison is theoretical.

2. **The document claims DO storage is "the current closest-to-correct path,"** but then spends significant space comparing D1 as if it were a realistic near-term option. Given that (a) D1 bindings don't exist, (b) DO storage trace sink already works, (c) the phase charter says "D1 is the current preferred hypothesis," the document should more explicitly recommend **DO storage as the Phase 1-2 hot substrate, with D1 as a Phase 3+ query substrate**.

3. **The "1-week investigation" timeline is not actionable without a test harness.** The document does not specify how to measure "write latency," "recovery reliability," or "query performance" across substrates. Without benchmarks, the investigation risks becoming an opinion survey.

**Cross-Reference Check (context/claude-code):**
- Claude-code uses a dual-export telemetry model: OTel + Perfetto. Nano-agent's substrate decision does not mention whether the chosen substrate must support structured query (for replay) or only append-only log (for audit). This distinction matters.

**Verdict:** The decision framework is sound, but the document over-invests in comparing a substrate (D1) that has zero runtime footprint. Should more explicitly recommend DO storage for hot path and defer D1 to Phase 6+.

---

## 3. Phase 2 — Trace-First Observability (P2-*)

### 3.1 P2-trace-first-observability-foundation.md

**Architectural Soundness:** ★★★★☆  
**Implementation Alignment:** ★★☆☆☆  
**Actionability:** ★★★☆☆

**What it gets right:**
- Elevates `trace_uuid` from "logging label" to "runtime correctness law"—this is the correct conceptual shift.
- Trace recovery model (anchor -> recover -> explicit failure) is well-designed.
- Instrumentation catalog covers all critical lifecycle points.

**Code-Reality Gaps:**

1. **The document states "Any accepted internal request must carry `trace_uuid`,"** but:
   - `NacpObservabilityEnvelopeSchema.trace_uuid` is **optional** (`z.string().uuid().optional()`).
   - `packages/session-do-runtime/src/traces.ts` emits trace events with `eventKind: "turn.started"` but **no `trace_uuid` field at all**.
   - The E2E tests in `test/e2e/` do not validate `trace_uuid` propagation.

2. **The document mandates `trace_uuid` in `TraceEventBase`,** but `packages/eval-observability/src/trace-event.ts` does not define a `TraceEventBase` with `trace_uuid`. Current trace events use `eventKind`, `timestamp`, `sessionUuid`, `teamUuid`, `turnUuid`—no `trace_uuid`.

3. **The document specifies "turn.begin" and "turn.end" as canonical event kinds,** but `packages/session-do-runtime/src/traces.ts:43` still emits `"turn.started"` and `"turn.completed"`. The orchestrator (`orchestration.ts:17-21`) documents the rename but the traces module has not been updated.

4. **The recovery model depends on `message_uuid`, `request_uuid`, `reply_to`, `parent_message_uuid`, `stream_uuid`, `tool_call_uuid`, `hook_run_uuid`—** but `packages/nacp-core/src/envelope.ts` defines `reply_to` (not `reply_to_message_uuid`) and `stream_id` (not `stream_uuid`). The recovery model assumes the identifier migration is complete.

**Cross-Reference Check (context/claude-code):**
- Claude-code uses `AsyncLocalStorage` for span context propagation. Nano-agent has no equivalent mechanism. The design does not address how `trace_uuid` will be propagated across async boundaries without explicit parameter passing.

**Verdict:** The observability law is conceptually correct, but the implementation is **not even at the starting line**. Every core package that emits trace events needs refactoring. The design should explicitly state: "This law cannot be enforced until P0 identifier migration is complete."

---

### 3.2 P2-observability-layering.md

**Architectural Soundness:** ★★★★☆  
**Implementation Alignment:** ★★★☆☆  
**Actionability:** ★★★☆☆

**What it gets right:**
- Three-layer model (Anchor / Durable Evidence / Diagnostic) maps cleanly onto existing `live / durable-audit / durable-transcript` enums.
- Promotion rules (when diagnostic becomes evidence) are necessary and well-defined.

**Code-Reality Gaps:**

1. **The layering is conceptual, not implemented.** The current `eval-observability` package has `TraceLayer = "live" | "durable-audit" | "durable-transcript"`, but no "anchor" sub-layer. The document should specify whether "anchor" is a new enum value or a cross-cutting concern.

2. **The overlap between `DURABLE_AUDIT_EVENTS` and `DURABLE_TRANSCRIPT_EVENTS` in `packages/eval-observability/src/classification.ts:29-45` is a known bug** (documented in `docs/code-review/after-nacp/e2e-test-01.md`). The layering document does not address this overlap or specify which layer "tool.call.result" belongs to.

**Verdict:** Useful conceptual memo, but needs explicit connection to the existing `TraceLayer` enum and resolution of the audit/transcript overlap bug.

---

## 4. Phase 3 — Session Edge Closure (P3)

### 4.1 P3-session-edge-closure.md

**Architectural Soundness:** ★★★★☆  
**Implementation Alignment:** ★★☆☆☆  
**Actionability:** ★★★☆☆

**What it gets right:**
- Correctly identifies `nacp-session.normalizeClientFrame` as the single source of truth for ingress.
- WebSocket-first with HTTP fallback is the correct priority.
- Single-active-turn invariant is a valid Phase 3 scope limit.

**Code-Reality Gaps:**

1. **The document's central claim—"All ingress must flow through `nacp-session.normalizeClientFrame`"—is directly contradicted by `packages/session-do-runtime/src/do/nano-session-do.ts:198-258`,** which performs raw `JSON.parse(text)` followed by a `switch(messageType)` block. This is the **exact anti-pattern** the design seeks to eliminate.

2. **`WsController` and `HttpController` are still stubs.** The design says "`WsController` / `HttpController` 真实接线" but does not specify what "real wiring" means when the underlying controllers lack implementation.

3. **The design assumes `nacp-session` helpers are ready to absorb all ingress types,** but `packages/nacp-session/src/ingress.ts:25` exports `normalizeClientFrame` with a TODO comment: "Blocker 1 fix: normalizeClientFrame now calls validateSessionFrame()." The helper itself is not fully implemented.

4. **Multi-round input is deferred, but the design does not specify how the current single-turn-only surface will reject follow-up input.** Will it return an error? Silently ignore? The edge contract needs a "not yet supported" response shape.

**Cross-Reference Check (context/smcp):**
- SMCP's session lifecycle is workflow-centric (`WORKFLOW_START` -> `STEP_START` -> `STEP_CALLBACK`). Nano-agent's session edge is turn-centric (`session.start` -> turn -> `session.end`). The design does not address whether nano-agent will eventually need a workflow-like session state machine or if turns are sufficient.

**Verdict:** The design correctly identifies what needs to happen, but the implementation gap is **massive**. The session DO needs near-total refactoring of its WebSocket message handler. This should be flagged as the highest-risk Phase 3 work item.

---

## 5. Phase 4 — External Seam Closure (P4)

### 5.1 P4-external-seam-closure.md

**Architectural Soundness:** ★★★★☆  
**Implementation Alignment:** ★★★☆☆  
**Actionability:** ★★★☆☆

**What it gets right:**
- Prioritizes fake-but-faithful workers over real provider integration—correct risk ordering.
- Dual path (local-ts reference + service-binding remote) is pragmatic.
- Cross-seam propagation law (team_uuid, trace_uuid, request_uuid, timeout) is comprehensive.

**Code-Reality Gaps:**

1. **The hooks service-binding runtime is a stub:** `packages/hooks/src/runtimes/service-binding.ts` throws `"service-binding runtime not yet connected"`. The capability service-binding target, by contrast, is fully implemented (`packages/capability-runtime/src/targets/service-binding.ts`). This inconsistency means Phase 4 will have **uneven implementation effort**—one target is ready, the other needs full development.

2. **`CompositionFactory` in `packages/session-do-runtime/src/composition.ts` returns `undefined` handle bags.** The design assumes composition can resolve external worker bindings, but the factory cannot currently produce valid handles.

3. **`SessionRuntimeEnv` lacks explicit bindings for fake provider / fake capability / fake hook workers.** The env types only have `SESSION_DO`, `R2_ARTIFACTS`, `KV_CONFIG`, `SKILL_WORKERS`. New bindings for `FAKE_PROVIDER`, `FAKE_CAPABILITY`, `FAKE_HOOK` are not declared.

4. **The document mandates carrying `trace_uuid` across boundaries,** but as established in P2 and P0, `trace_uuid` does not yet exist in the core envelope. Cross-boundary propagation of a non-existent field is impossible.

**Cross-Reference Check (context/codex):**
- Codex uses sandbox types (`MacosSeatbelt`, `LinuxSeccomp`) as a capability model. Nano-agent's external seam closure does not mention sandboxing or capability isolation for remote workers. Given that fake bash commands will execute across worker boundaries, this is a security gap.

**Verdict:** Good seam contract design, but implementation readiness is **asymmetric** (capability target ready, hooks target missing). The dependency on P0 identifier migration is not explicitly acknowledged.

---

## 6. Phase 5 — Deployment Verification (P5)

### 6.1 P5-deployment-dry-run-and-real-boundary-verification.md

**Architectural Soundness:** ★★★★☆  
**Implementation Alignment:** ★★☆☆☆  
**Actionability:** ★★☆☆☆

**What it gets right:**
- Three-rung verification ladder (L0 in-process, L1 deploy-shaped dry-run, L2 real smoke) is a sound validation strategy.
- Verdict Bundle concept (trace + timeline + placement + summary) ensures verification produces evidence, not just pass/fail.

**Code-Reality Gaps:**

1. **L1/L2 cannot proceed until P3 and P4 are complete.** The document assumes deployment-shaped verification is a Phase 5 activity, but the prerequisites (real session edge, real external seams) are not yet implemented. This creates a **dependency inversion risk**: if P3/P4 slip, P5 has nothing to verify.

2. **`wrangler.jsonc` is skeletal.** The document says "dry-run profiles must declare all bindings," but the current `packages/session-do-runtime/wrangler.jsonc` only declares `SESSION_DO`. Adding R2, KV, and fake worker bindings requires infrastructure work that is not scoped in any design document.

3. **No CI/CD integration is mentioned,** but deployment-shaped tests require a Cloudflare account, API tokens, and wrangler authentication. The document does not address how these secrets will be managed in the test environment.

**Verdict:** The verification strategy is sound, but it is **sequenced too early**. P5 should be reclassified as a "verification gate" that opens only after P3 and P4 closure, not as a separate phase with its own timeline.

---

## 7. Phase 6 — Storage & Context Evidence (P6)

### 7.1 P6-storage-and-context-evidence-closure.md

**Architectural Soundness:** ★★★★☆  
**Implementation Alignment:** ★★★☆☆  
**Actionability:** ★★★☆☆

**What it gets right:**
- Evidence-first approach (policies remain provisional until supported by runtime evidence) is correct.
- Five typed evidence streams (Placement, Context Assembly, Compact, Artifact Lifecycle, Snapshot/Restore) cover the necessary surfaces.
- Calibration verdicts (`provisional`, `evidence-backed`, `needs-revisit`, `contradicted-by-evidence`) are a good governance model.

**Code-Reality Gaps:**

1. **`StoragePlacementLog` currently only exists in tests** (`packages/eval-observability/test/integration/storage-placement-evidence.test.ts`). The design requires moving it into the live runtime path, but does not specify which package owns the live log emission.

2. **`CompactBoundaryRecord` is currently snapshot-only** (used in checkpoint tests). The design requires upgrading it to a full trace/evidence event, but does not specify the event schema or emission hooks.

3. **Context assembly evidence requires `ContextAssembler` to record `orderApplied`, `truncated`, dropped layers, and token counts.** The current `packages/workspace-context-artifacts/src/context-assembler.ts` does not emit such evidence. Adding it requires changes to the assembler interface.

4. **The design says "at least one real R2 put/get integration" is required,** but `packages/session-do-runtime/wrangler.jsonc` has no R2 binding, and `SessionRuntimeEnv` only types `R2_ARTIFACTS` without any runtime usage.

**Cross-Reference Check (context/claude-code):**
- Claude-code separates file-system sandbox policy from network sandbox policy. Nano-agent's storage design does not mention sandboxing for workspace operations. Given that capability-runtime executes file ops, this is a security consideration.

**Verdict:** Good evidence framework, but many evidence types require **greenfield instrumentation** in packages that were not originally designed to emit them. The phase should be re-scoped to "instrumentation and evidence" rather than just "evidence closure."

---

## 8. Phase 7 — Minimal Bash Governance (P7a-c)

### 8.1 P7a-minimal-bash-search-and-workspace.md

**Architectural Soundness:** ★★★★☆  
**Implementation Alignment:** ★★☆☆☆  
**Actionability:** ★★★☆☆

**What it gets right:**
- Workspace truth is the namespace, not the bash command output—correct architectural principle.
- `rg` as the sole canonical search command is a valid minimal surface.
- Reserved `/_platform/` namespace prevents mount collisions.

**Code-Reality Gaps:**

1. **`rg` handler is a degraded string-scan stub** (`packages/capability-runtime/src/capabilities/search.ts:44`). The design claims it as a "canonical command" but the implementation has no quality evidence. Without regex support, case-sensitivity options, or file-type filtering, `rg` is essentially `grep` with a different name.

2. **`mkdir` is registered but functionally a no-op ack** (`packages/capability-runtime/src/fake-bash/commands.ts:52`). The design does not explicitly label `mkdir` as "partial/no-op," which could mislead LLM users into believing directory creation works.

3. **File/search consistency law is not enforced in tests.** The E2E tests (`test/e2e/e2e-07-workspace-fileops.test.mjs`) verify file ops but do not verify that `ls`, `cat`, and `rg` see the same namespace reality.

**Cross-Reference Check (context/just-bash):**
- just-bash has 80+ commands with lazy loading, opt-in security gating, and a `CommandContext` API. Nano-agent's 12 commands with stub handlers are far behind. The design should explicitly state: "Nano-agent's fake bash is not aiming for just-bash parity in this phase."

**Verdict:** Good contract principles, but the implementation surface is **weaker than the design implies**. `rg` needs real implementation, and `mkdir` needs honest labeling.

---

### 8.2 P7b-minimal-bash-network-and-script.md

**Architectural Soundness:** ★★★★☆  
**Implementation Alignment:** ★★☆☆☆  
**Actionability:** ★★☆☆☆

**What it gets right:**
- `curl` as restricted verification capability (not unrestricted egress) is correct.
- Explicit ban on localhost, package managers, child processes, and background servers is strong security governance.
- Structured capability path preferred over bash string expansion is the right long-term direction.

**Code-Reality Gaps:**

1. **`curl` handler is a stub** (`packages/capability-runtime/src/capabilities/network.ts:42`). It returns `"[curl] fetching: {url}"` but makes no actual HTTP request. The design's governance rules (URL allow-lists, method restrictions) have no enforcement because the handler is not implemented.

2. **`ts-exec` handler is a stub** (`packages/capability-runtime/src/capabilities/exec.ts:38`). It returns `"[ts-exec] running: {script}"` but does not execute TypeScript. The design's "controlled TS/JS analysis capability" is not yet real.

3. **The document says "bash string support is weak" and recommends the structured path,** but the structured path (`CapabilityExecutor` with typed input) is already the primary path. The real gap is that **the handlers behind the structured path are stubs**.

**Cross-Reference Check (context/just-bash):**
- just-bash gates `curl`, `python3`, and `js-exec` behind explicit config flags. Nano-agent's design does not mention gating—`curl` and `ts-exec` are registered with `policy: "ask"` but the handlers don't exist. This is a security gap: the policy gate can approve a capability that cannot execute.

**Verdict:** Strong governance intent, but the implementation is **entirely missing**. This phase should be re-titled "Network & Script Capability Implementation" rather than "Governance."

---

### 8.3 P7c-minimal-bash-vcs-and-policy.md

**Architectural Soundness:** ★★★★☆  
**Implementation Alignment:** ★★☆☆☆  
**Actionability:** ★★★☆☆

**What it gets right:**
- Virtual git v1 is read-mostly (`status`, `diff`, `log`)—correct minimal surface.
- Unsupported commands must hard-fail with explicit error semantics—prevents silent confusion.
- `UNSUPPORTED_COMMANDS` and `OOM_RISK_COMMANDS` as first-class policy contracts is good governance.

**Code-Reality Gaps:**

1. **`git` handlers are stubs** (`packages/capability-runtime/src/capabilities/vcs.ts:49`). Despite being registered with `policy: "allow"`, the implementation returns a diagnostic string without actual git operations.

2. **`FakeBashBridge` in `packages/capability-runtime/src/fake-bash/bridge.ts:141` does not reference `UNSUPPORTED_COMMANDS` or `OOM_RISK_COMMANDS` from a centralized registry.** The policy lists exist in the design but not in the code.

3. **The inventory must be manually maintained across three surfaces:** command registry, system prompt, and TypeScript guards. The design mentions an "inventory drift guard" but does not specify how it will work.

**Verdict:** Good policy framework, but like P7b, the implementation is **mostly missing**. The gap between registry (what the LLM sees) and handlers (what actually runs) is a critical reliability risk.

---

## 9. Cross-Cutting Analysis (PX-capability-inventory.md)

### 9.1 PX-capability-inventory.md

**Architectural Soundness:** ★★★★☆  
**Implementation Alignment:** ★★★☆☆  
**Actionability:** ★★★☆☆

**What it gets right:**
- Evidence Grade scale (E0-E3) is a useful maturity metric.
- Consolidates P7a/7b/7c judgments into a single table.
- Explicitly catalogues unsupported and risk-blocked surfaces.

**Code-Reality Gaps:**

1. **The inventory rates `pwd`, `ls`, `cat`, `write`, `rm`, `mv`, `cp` as E2-E3,** but `write` has `policy: "ask"` by default, meaning it will return a `policy-ask` error in non-interactive contexts. An E2-E3 rating implies the command "works," but `"ask"` policy means it often fails. The rating should be conditional on policy override.

2. **`mkdir`, `rg`, `curl`, `ts-exec`, `git` are rated E1 (stub/degraded).** This is accurate, but the design documents (P7a-c) sometimes describe these capabilities as if they were contractually frozen, when in fact they are not yet implemented.

3. **No automated drift guard is defined.** The inventory is a manual document. Without automated verification (e.g., a test that checks registry entries against handler implementations), it will drift.

**Verdict:** Useful consolidation memo, but the E2-E3 ratings for `"ask"` policy commands are optimistic. Needs explicit policy-context annotations.

---

## 10. Cross-Cutting Issues

### 10.1 Trace Naming Crisis (P0-P2)

**Severity: CRITICAL**

The most severe cross-cutting issue is the **trace naming bifurcation**:

- `nacp-core` envelope uses `trace_id` (required)
- `nacp-core` observability envelope uses `trace_uuid` (optional)
- `nacp-session` frame uses `trace_id`
- `session-do-runtime` traces module emits events **without any trace field**
- `eval-observability` classification does not reference `trace_uuid` at all

This is not a minor naming inconsistency. It is a **protocol-breaking divergence** that prevents trace propagation across package boundaries. The designs in P0-P2 assume this is already resolved or easily resolvable, but in reality it requires:

1. Breaking schema change in `nacp-core`
2. Breaking schema change in `nacp-session`
3. Refactoring of `session-do-runtime/traces.ts`
4. Update of all test fixtures
5. Update of E2E tests
6. Version bump with migration policy

**Recommendation:** P0 should be re-scoped to explicitly include "trace_id -> trace_uuid migration" as its primary deliverable, with a breaking version bump and compat floor.

---

### 10.2 Event Kind Drift (P2-P3)

**Severity: HIGH**

The orchestrator documents a rename (`turn.started` -> `turn.begin`, `turn.completed` -> `turn.end`), but:
- `session-do-runtime/src/traces.ts` still emits `"turn.started"` and `"turn.completed"`
- `eval-observability/src/classification.ts` classifies `"turn.begin"` and `"turn.end"` but not the old names
- Tests in `session-do-runtime/test/traces.test.ts` assert `"turn.started"`

This means:
- The orchestrator emits the new names
- The traces module emits the old names
- The classifier recognizes the new names
- The tests validate the old names

**Four different surfaces, four different truths.**

**Recommendation:** All event kind strings must be centralized in a single source-of-truth file (e.g., `packages/nacp-core/src/event-kinds.ts`) and imported by all packages. No package should define event kind strings locally.

---

### 10.3 Stub Surfaces Misrepresented as Contracts (P3-P7)

**Severity: HIGH**

Multiple design documents describe surfaces as if they were contractually frozen or implementation-complete, when they are actually stubs:

| Surface | Design Claim | Code Reality |
|---|---|---|
| `WsController` / `HttpController` | "Real wiring" | Stubs |
| `normalizeClientFrame` | "Ingress source of truth" | Partial implementation with TODO |
| `rg` | "Canonical search command" | String-scan stub |
| `curl` | "Restricted verification capability" | Returns diagnostic string, no HTTP |
| `ts-exec` | "Controlled TS/JS analysis" | Returns diagnostic string, no execution |
| `git` | "Read-mostly VCS subset" | Returns diagnostic string, no git operations |
| `ServiceBindingRuntime` (hooks) | "Cross-worker boundary" | Throws "not yet connected" |
| `StoragePlacementLog` | "Evidence stream" | Test-only |

**Recommendation:** Every design document should include an explicit "Implementation State" section that rates each surface as: `Implemented`, `Stub`, `Partial`, or `Not Started`. This prevents contract documents from becoming wishlists.

---

### 10.4 Observability-Envelope Disconnect (P2)

**Severity: HIGH**

The observability layering document (P2-observability-layering.md) and the trace-first foundation document (P2-trace-first-observability-foundation.md) both assume a unified observability envelope. However:

- `NacpObservabilityEnvelopeSchema` exists in `nacp-core` but is marked "v1.1 placeholder" with "no runtime implementation in v1.0"
- `eval-observability` does not use `NacpObservabilityEnvelope` at all; it has its own `TraceEvent` types
- The session-do-runtime traces module emits plain objects, not envelope-wrapped events

**Recommendation:** Before P2 can proceed, a decision must be made: either (a) upgrade `NacpObservabilityEnvelope` to a runtime-used schema and migrate all trace emission to it, or (b) deprecate `NacpObservabilityEnvelope` and elevate `eval-observability`'s types to the canonical observability contract.

---

### 10.5 Just-Bash Context Underutilized (P7)

**Severity: MID**

The just-bash context (`context/just-bash/`) provides a rich reference implementation with:
- 80+ commands
- Opt-in security gating
- Lazy loading
- `CommandContext` API for piped behavior
- Prototype pollution defense

Nano-agent's capability-runtime has:
- 12 commands
- No lazy loading
- No `CommandContext` API
- No piped behavior
- Policy gating (`allow` vs `ask`) but no handler-level enforcement

The designs in P7a-c do not reference just-bash's architecture. They treat nano-agent's fake bash as a greenfield design, when in fact a mature reference exists.

**Recommendation:** P7 designs should include a "just-bash alignment analysis" section that explicitly states which just-bash patterns are adopted, which are rejected, and why.

---

### 10.6 SMCP/SAFE Trace Alignment (P0-P2)

**Severity: MID**

SMCP and SAFE both use `trace_uuid` (or `trace_id` with explicit SMCP mapping). The nano-agent designs correctly choose `trace_uuid` as canonical. However:

- SMCP uses `run_uuid` and `step_run_uuid` for workflow execution tracking. Nano-agent uses `turn_uuid` and `stepIndex`. The designs do not address whether `turn_uuid` is semantically equivalent to SMCP's `run_uuid` or `step_run_uuid`.
- SAFE separates `control` payload from `io` payload. Nano-agent's envelope has `header`, `authority`, `trace`, `control`, `refs`, `body`, `extra`—which is more granular but also more complex. The designs do not discuss whether this granularity is necessary or if it creates overhead.

**Recommendation:** Add a "Protocol Alignment Note" to P0 that maps nano-agent envelope fields to SMCP/SAFE equivalents. This helps future integration and prevents divergence.

---

## 11. Severity-Ranked Issue Registry

### CRITICAL (Blocking Phase Progression)

| # | Issue | Affected Phases | Root Cause | Recommended Action |
|---|---|---|---|---|
| C1 | **Trace naming bifurcation**: `trace_id` vs `trace_uuid` across core/session/runtime/observability packages | P0, P1, P2, P4 | Schema drift during skeleton phase; no migration executed | Execute breaking migration: rename `trace_id` -> `trace_uuid` in nacp-core and nacp-session; add `trace_uuid` to all trace event types; bump NACP version to 1.1.0 with compat floor |
| C2 | **Ingress anti-pattern**: `nano-session-do.ts` performs raw JSON.parse + switch instead of using `normalizeClientFrame` | P3 | Session DO was implemented before nacp-session helpers were ready | Refactor `webSocketMessage` to delegate to `normalizeClientFrame`; add error handling for invalid frames; update tests |
| C3 | **Event kind divergence**: Four different surfaces use four different event kind strings for the same semantic events | P2, P3 | No centralized event kind registry | Create `packages/nacp-core/src/event-kinds.ts` with canonical string constants; migrate all packages to import from it; update tests |

### HIGH (Significant Risk to Phase Quality)

| # | Issue | Affected Phases | Root Cause | Recommended Action |
|---|---|---|---|---|
| H1 | **Observability envelope disconnect**: `NacpObservabilityEnvelope` is a placeholder; eval-observability uses its own types; traces module emits plain objects | P2 | No canonical observability schema was enforced during skeleton | Either elevate `NacpObservabilityEnvelope` to runtime use and migrate all emitters, or deprecate it and canonize eval-observability types |
| H2 | **Stub surfaces misrepresented as contracts**: Designs describe WsController, rg, curl, ts-exec, git as contractually frozen when they are stubs | P3, P7a, P7b, P7c | Design documents written before implementation reality was audited | Add "Implementation State" section to every design; re-rate surfaces as Stub/Partial/Implemented; adjust phase scope accordingly |
| H3 | **Identifier law not enforced**: `*_id` fields persist in nacp-core, nacp-session, and tests; camelCase drift (`turnUuid`) exists | P0 | Law was declared but not implemented | Add lint rule or codemod to enforce suffix taxonomy; execute migration; update all test fixtures |
| H4 | **Hooks service-binding runtime is a stub** while capability service-binding target is fully implemented | P4 | Uneven development priority | Implement `ServiceBindingRuntime` for hooks, or explicitly defer hooks external seam to a later phase |
| H5 | **D1 substrate comparison is theoretical**: No D1 binding exists in runtime env or wrangler config | P1 | Substrate was discussed but not provisioned | Either provision D1 binding for investigation, or narrow P1 to "DO storage hot + D1 query later" and close the decision |
| H6 | **Policy/implementation gap**: `curl`, `ts-exec`, `mkdir` are registered with `policy: "ask"` but handlers are stubs; policy gate can approve non-executable capabilities | P7b | Commands were registered for LLM surface compatibility before handlers were implemented | Either implement handlers before registering commands, or change policy to `deferred` for stub commands |
| H7 | **Storage placement log is test-only**: No runtime emission of placement evidence | P6 | Instrumentation was not built during skeleton | Add placement evidence emission to workspace-context-artifacts and storage-topology; define minimal evidence schema |

### MID (Moderate Risk, Manageable)

| # | Issue | Affected Phases | Root Cause | Recommended Action |
|---|---|---|---|---|
| M1 | **Versioning policy ahead of code**: `compat/migrations.ts` is a placeholder | P0 | Policy was written before migration engine was built | Populate `compat/migrations.ts` with at least one migration (trace_id -> trace_uuid); add migration tests |
| M2 | **Contract matrix may become stale**: Manual matrix without automated enforcement | P0 | Governance tool chosen before automation was available | Add CI check or pre-commit hook that validates matrix against schema exports |
| M3 | **E2E tests do not validate trace propagation**: No test checks `trace_uuid` across package boundaries | P2, P4 | Test design focused on happy-path functionality, not trace law | Add trace propagation validation to root contract tests and E2E tests |
| M4 | **Session DO composition factory returns undefined handles**: External worker bindings cannot be resolved | P4 | Composition was stubbed during skeleton | Implement composition factory to return actual binding handles from env |
| M5 | **Multi-round input deferral lacks rejection contract**: Design says "deferred" but does not specify how to reject follow-up input | P3 | Scope was cut without specifying fallback behavior | Add "not yet supported" error kind to nacp-session frame schema; implement rejection in session DO |
| M6 | **P5 sequenced too early**: Deployment verification depends on P3/P4 completion | P5 | Phase dependency not fully respected in timeline | Reclassify P5 as a "verification gate" triggered by P3/P4 closure, not a standalone phase |
| M7 | **Just-bash context underutilized**: P7 designs do not reference just-bash patterns | P7a, P7b, P7c | Context was available but not consulted during design | Add "just-bash alignment analysis" to each P7 design |
| M8 | **No AsyncLocalStorage equivalent for trace propagation**: Cross-async-boundary trace carrying requires explicit parameter passing | P2 | Node.js AsyncLocalStorage pattern not adopted | Evaluate whether Cloudflare Workers support AsyncLocalStorage or equivalent; if not, document explicit propagation pattern |
| M9 | **Capability inventory ratings optimistic**: E2-E3 ratings for `"ask"` policy commands overstate readiness | PX | Ratings did not account for policy-induced failures | Add policy-context annotation to inventory (e.g., "E2 with `allow` override, E1 with default `ask`") |
| M10 | **Event classification overlap**: `DURABLE_AUDIT_EVENTS` and `DURABLE_TRANSCRIPT_EVENTS` share members, causing audit downgrade | P2 | Classification sets were defined without mutual exclusion | Remove overlapping members from one set; add test that validates mutual exclusivity |

### LOW (Minor, Cosmetic, or Deferred)

| # | Issue | Affected Phases | Root Cause | Recommended Action |
|---|---|---|---|---|
| L1 | **README references outdated paths**: `docs/action-plan/*.md` should be `docs/action-plan/after-nacp/*.md` | P0 | Paths were updated but some references were missed | Update all internal references in README and design docs |
| L2 | **NacpObservabilityEnvelope lacks `trace_uuid` at top level**: It only exists in nested `alerts[].trace_uuid` | P2 | Schema was designed for alerts, not for general trace anchoring | Consider adding top-level `trace_uuid` to observability envelope or document why it is alert-scoped |
| L3 | **Session-do-runtime env types include `SKILL_WORKERS` but no skill runtime exists** | P4 | Forward-looking type declaration | Either remove `SKILL_WORKERS` until skill runtime is scoped, or document it as reserved |
| L4 | **Design documents lack "Last Verified Against Code" timestamps** | All | Process gap | Add a "Code Reality Check" ritual to design reviews with dated signatures |
| L5 | **P1 document over-invests in D1 comparison** | P1 | Substrate decision was framed as open when implementation reality favors DO storage | Refocus P1 on "DO storage hot + D1 query later" with minimal D1 investigation scope |

---

## 12. Final Verdict

### 12.1 Overall Assessment

The after-skeleton design suite is **architecturally mature but implementation-immature**. The designs correctly identify the hard problems (contract freeze, identifier law, trace-first observability, runtime closure) and propose sensible solutions. However, they consistently **overstate implementation readiness** and **understate migration cost**.

The designs would benefit from:
1. **Explicit implementation state annotations** on every surface
2. **Tighter coupling to code reality** with dated verification timestamps
3. **More conservative substrate decisions** that respect existing runtime bindings
4. **Explicit migration action-plans** for breaking changes (especially trace naming)
5. **Reference to context/ implementations** (just-bash, SMCP, SAFE, claude-code) as alignment baselines

### 12.2 Phase Readiness Assessment

| Phase | Design Quality | Implementation Readiness | Can Proceed? | Blockers |
|---|---|---|---|---|
| **P0** | ★★★★☆ | ★★☆☆☆ | ⚠️ Conditional | C1, C3, H3 must be resolved first |
| **P1** | ★★★★☆ | ★★★☆☆ | ✅ Yes | Narrow scope to DO storage hot; D1 is theoretical |
| **P2** | ★★★★☆ | ★★☆☆☆ | ❌ No | C1, H1, H6, M3 block trace law enforcement |
| **P3** | ★★★★☆ | ★★☆☆☆ | ❌ No | C2, H2, H4, M5 block session edge closure |
| **P4** | ★★★★☆ | ★★★☆☆ | ⚠️ Conditional | H4 (hooks stub) must be resolved; C1 blocks trace propagation |
| **P5** | ★★★★☆ | ★★☆☆☆ | ❌ No | Depends on P3, P4; reclassify as gate |
| **P6** | ★★★★☆ | ★★★☆☆ | ⚠️ Conditional | H7, M4 block evidence emission |
| **P7a** | ★★★★☆ | ★★☆☆☆ | ⚠️ Conditional | H2 (rg stub), H6 (mkdir partial) |
| **P7b** | ★★★★☆ | ★★☆☆☆ | ❌ No | H2 (curl/ts-exec stubs), H6 (policy gap) |
| **P7c** | ★★★★☆ | ★★☆☆☆ | ⚠️ Conditional | H2 (git stub) |
| **PX** | ★★★★☆ | ★★★☆☆ | ✅ Yes | M9 (rating accuracy) |

### 12.3 Recommended Next Steps

1. **Immediate (before any phase implementation):**
   - Resolve C1 (trace naming bifurcation) with breaking migration
   - Resolve C3 (event kind divergence) with centralized registry
   - Add implementation state sections to all designs

2. **Short-term (P0-P1):**
   - Execute identifier migration (H3)
   - Narrow P1 to DO storage hot path
   - Populate `compat/migrations.ts` (M1)

3. **Medium-term (P2-P4):**
   - Resolve observability envelope disconnect (H1)
   - Refactor session DO ingress (C2)
   - Implement hooks service-binding runtime (H4)

4. **Long-term (P5-P7):**
   - Reclassify P5 as verification gate
   - Add instrumentation to storage/context packages (H7)
   - Implement stub handlers or downgrade their registry status (H6)

---

*Review completed. This document should be treated as a living artifact and updated after each phase closure.*
