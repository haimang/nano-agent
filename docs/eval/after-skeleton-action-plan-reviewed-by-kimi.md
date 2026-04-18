# After-Skeleton Action-Plan Review — Comprehensive Evaluation by Kimi

> Review Date: 2026-04-18
> Reviewer: Kimi (k2p5)
> Scope: All 10 action-plan files in `docs/action-plan/after-skeleton/` (A1–A10)
> Reference: `docs/design/after-skeleton/PX-QNA.md`, `docs/plan-after-skeleton.md`, `packages/*` code reality, `context/*` reference implementations
> Review Model: E2E-style chain-cluster evaluation
> Review Type: Fact-checking, dependency validation, execution feasibility, cross-reference alignment

---

## 0. Executive Summary

[Overall assessment: action-plans are well-structured and owner-aligned but have systematic optimism bias regarding implementation readiness]

---

## 1. Review Methodology: E2E Chain-Cluster Model

[Explain the four chains: Foundation (A1-A3), Runtime (A4-A6), Evidence (A7), Capability (A8-A10)]

---

## 2. Foundation Chain Review (A1, A2, A3)

### 2.1 A1 — Contract and Identifier Freeze

**Dimensions:** Design Alignment, Code-Reality Check, PX-QNA Consistency, Dependency Hygiene, Closure Verifiability (each rated 1-5 stars)

**What it gets right:**
- Treats A1 as root of downstream work
- 5 logical batches
- Includes stamped_by and reply_to migrations per Q3
- Includes follow-up input family per Q8

**Code-Reality Gaps:**
1. 15+ occurrences of trace_id/producer_id/stream_id/span_id exist in code but plan has no codemod strategy
2. Phase 3 now includes follow-up input family widening (Q8) - this is scope increase from original P0 design. Not a rename, it's new protocol surface design
3. Phase 4 mentions "llm-wrapper" as downstream consumer but real consumers are session-do-runtime, agent-runtime-kernel, eval-observability, hooks
4. Closure criterion not machine-verifiable without lint rule

**Context Reference:** SMCP uses trace_uuid consistently; SAFE maps trace_id to trace_uuid. A1 aligns with SMCP but needs explicit OpenTelemetry mapping doc.

**Verdict:** Architecturally correct but execution-heavy. Needs codemod strategy and automated lint.

### 2.2 A2 — Trace Substrate Decision Investigation

**What it gets right:**
- Evidence-gathering framework
- 4 well-structured batches
- References Q5 and Q20

**Code-Reality Gaps:**
1. Phase 1 audits are descriptive not evaluative - no "audit failure" criteria
2. Phase 2 needs DO benchmark harness but doesn't specify technology (Miniflare? wrangler dev?)
3. Self-fulfilling decision risk - DoStorageTraceSink already exists, benchmark will likely validate it. Needs negative test with rejection threshold

**Verdict:** Sound framework but benchmark methodology needs technical specifics.

### 2.3 A3 — Trace-first Observability Foundation

**What it gets right:**
- Elevates trace_uuid from naming to runtime law
- 5 batches covering law, codec, recovery, instrumentation, closure
- Correctly depends on A1 and A2

**Code-Reality Gaps:**
1. Assumes TraceEventBase carries traceUuid but current packages/eval-observability/src/trace-event.ts has no traceUuid field
2. Assumes "turn.begin"/"turn.end" are canonical but session-do-runtime/src/traces.ts still emits "turn.started"/"turn.completed"
3. Phase 4 instrumentation sweep touches 4+ packages - very broad surface area
4. Recovery model depends on message_uuid/request_uuid/reply_to_message_uuid/stream_uuid but nacp-core still uses reply_to (not reply_to_message_uuid) and stream_id (not stream_uuid)

**Context Reference:** Claude-code uses AsyncLocalStorage for span propagation. Nano-agent has no equivalent mechanism.

**Verdict:** Conceptually correct but implementation gap is massive. Every core package needs refactoring.

---

## 3. Runtime Chain Review (A4, A5, A6)

### 3.1 A4 — Session Edge Closure

**What it gets right:**
- Identifies normalizeClientFrame as single source of truth
- WS-first with HTTP fallback
- Single-active-turn invariant

**Code-Reality Gaps:**
1. Central claim "All ingress must flow through normalizeClientFrame" is contradicted by nano-session-do.ts:198-258 which does raw JSON.parse + switch
2. WsController and HttpController are still stubs - plan assumes they can be "real wired" without specifying stub replacement strategy
3. normalizeClientFrame itself has TODO comment and is not fully implemented
4. Hard dependencies on A1 (follow-up input family) and A3 (trace carrier) - if these slip, A4 is blocked
5. No "not yet supported" response shape for follow-up input rejection

**Verdict:** Correctly identifies what needs to happen but implementation gap is massive. Session DO needs near-total refactoring.

### 3.2 A5 — External Seam Closure

**What it gets right:**
- Prioritizes fake-but-faithful workers
- Dual path (local-ts reference + service-binding remote)
- Cross-seam propagation law

**Code-Reality Gaps:**
1. Hooks ServiceBindingRuntime is a stub throwing "not yet connected" while capability ServiceBindingTarget is fully implemented - asymmetric effort
2. CompositionFactory returns undefined handle bags - cannot resolve external worker bindings
3. SessionRuntimeEnv lacks bindings for FAKE_PROVIDER, FAKE_CAPABILITY, FAKE_HOOK workers
4. Assumes trace_uuid propagation but trace_uuid doesn't exist in core envelope yet

**Context Reference:** Codex uses sandbox types (MacosSeatbelt, LinuxSeccomp) as capability model. Nano-agent doesn't mention sandboxing for remote workers.

**Verdict:** Good seam contract but implementation readiness is asymmetric.

### 3.3 A6 — Deployment Dry-Run and Real Boundary Verification

**What it gets right:**
- Three-rung verification ladder (L0/L1/L2)
- Verdict Bundle concept
- Explicitly a verification gate, not independent phase (per Q10)

**Code-Reality Gaps:**
1. L1/L2 cannot proceed until A4 and A5 complete - dependency inversion risk
2. wrangler.jsonc is skeletal (only SESSION_DO) - needs infrastructure work not scoped in any action-plan
3. No CI/CD secrets management mentioned
4. L2 real smoke assumes gpt-4.1-nano (Q12) but no cost/latency budget specified

**Verdict:** Verification strategy is sound but sequenced correctly as gate.

---

## 4. Evidence Chain Review (A7)

### 4.1 A7 — Storage and Context Evidence Closure

**What it gets right:**
- Evidence-first approach
- Five typed evidence streams
- Four-tier calibration verdicts (per Q13)
- Separated from PX capability maturity (per Q14)

**Code-Reality Gaps:**
1. StoragePlacementLog only exists in tests - needs to move to live runtime path but plan doesn't specify which package owns live emission
2. CompactBoundaryRecord is snapshot-only - needs upgrade to trace/evidence event
3. ContextAssembler doesn't emit evidence currently - adding it requires interface changes
4. "At least one real R2 put/get integration" required but wrangler.jsonc has no R2 binding

**Verdict:** Good evidence framework but many evidence types require greenfield instrumentation.

---

## 5. Capability Chain Review (A8, A9, A10)

### 5.1 A8 — Minimal Bash Search and Workspace

**What it gets right:**
- Workspace truth is namespace, not bash output
- rg as sole canonical search command (per Q15)
- grep -> rg alias as minimal compatibility (per Q16)

**Code-Reality Gaps:**
1. rg handler is degraded string-scan stub - no regex, case-sensitivity, or file-type filtering
2. mkdir is registered but functionally no-op ack - needs honest labeling
3. File/search consistency law not enforced in tests

**Context Reference:** just-bash has 80+ commands with lazy loading and CommandContext API. Nano-agent is far behind.

**Verdict:** Good contract principles but implementation surface is weaker than design implies.

### 5.2 A9 — Minimal Bash Network and Script

**What it gets right:**
- curl as restricted verification capability (per Q17)
- Structured path preferred over bash argv expansion
- Explicit ban on localhost, Python, package managers

**Code-Reality Gaps:**
1. curl handler is stub - returns diagnostic string, makes no HTTP request
2. ts-exec handler is stub - returns diagnostic string, no execution
3. Policy gate can approve capabilities that cannot execute (curl has policy "ask" but handler doesn't exist)

**Verdict:** Strong governance intent but implementation is entirely missing.

### 5.3 A10 — Minimal Bash VCS and Policy

**What it gets right:**
- git v1 frozen to status/diff/log (per Q18)
- Five-tier taxonomy + ask-gated disclosure (per Q19)
- Drift guard concept

**Code-Reality Gaps:**
1. git handlers are stubs despite being registered with policy "allow"
2. FakeBashBridge doesn't reference centralized UNSUPPORTED_COMMANDS/OOM_RISK_COMMANDS lists
3. Drift guard is manual - no automated mechanism defined

**Verdict:** Good policy framework but implementation mostly missing.

---

## 6. Cross-Cutting Issues

### 6.1 Trace Naming Bifurcation (CRITICAL)

- trace_id vs trace_uuid across core/session/runtime/observability
- NacpObservabilityEnvelope.trace_uuid is optional, not required
- session-do-runtime/traces.ts emits events without any trace field
- Affects A1, A2, A3, A4, A5

### 6.2 Event Kind Divergence (CRITICAL)

- Four surfaces use different strings for same events
- No centralized event kind registry
- Affects A3, A4

### 6.3 Stub Surfaces Misrepresented (HIGH)

- WsController, HttpController, rg, curl, ts-exec, git all stubs but treated as contractually frozen
- Affects A4, A8, A9, A10

### 6.4 Observability Envelope Disconnect (HIGH)

- NacpObservabilityEnvelope is placeholder; eval-observability uses its own types
- Affects A3

### 6.5 Just-Bash Context Underutilized (MID)

- A8-A10 don't reference just-bash patterns (lazy loading, CommandContext, opt-in gating)

### 6.6 SMCP/SAFE Alignment Gaps (MID)

- turn_uuid vs SMCP's run_uuid/step_run_uuid semantic mapping not documented
- Affects A1

---

## 7. Severity-Ranked Issue Registry

### CRITICAL (Blocking Execution)

| # | Issue | Affected Plans | Root Cause | Recommended Action |
|---|---|---|---|---|
| C1 | **Trace naming bifurcation**: trace_id vs trace_uuid | A1-A5 | Schema drift | Execute breaking migration in A1 before any other plan starts |
| C2 | **Event kind divergence**: turn.started vs turn.begin vs turn.completed vs turn.end | A3, A4 | No centralized registry | Create event-kinds.ts in nacp-core; migrate all emitters |
| C3 | **Ingress anti-pattern**: nano-session-do.ts raw JSON.parse + switch | A4 | Session DO implemented before nacp-session helpers | Refactor webSocketMessage to use normalizeClientFrame in A4 Phase 1 |

### HIGH (Significant Risk)

| # | Issue | Affected Plans | Root Cause | Recommended Action |
|---|---|---|---|---|
| H1 | **Stub surfaces treated as contracts**: WsController, rg, curl, ts-exec, git | A4, A8-A10 | Design docs written before implementation audit | Add "Implementation State" section to each action-plan batch |
| H2 | **Hooks service-binding stub**: throws "not yet connected" | A5 | Uneven development priority | Implement ServiceBindingRuntime or defer hooks seam to later phase |
| H3 | **Identifier law not enforced**: *_id persists in code | A1 | Law declared but not implemented | Add lint rule; execute migration in A1 Phase 2-3 |
| H4 | **Observability envelope disconnect**: placeholder vs actual types | A3 | No canonical observability schema enforced | Decide: elevate NacpObservabilityEnvelope or canonize eval-observability types |
| H5 | **A1 Phase 3 scope increase**: follow-up input family is new protocol design, not rename | A1 | Q8 owner decision changed scope | Re-estimate Phase 3 workload; separate follow-up design from rename batches |
| H6 | **Policy/implementation gap**: curl/ts-exec registered but handlers are stubs | A9 | Commands registered before handlers implemented | Either implement handlers or change policy to deferred for stub commands |
| H7 | **A3 assumes A1 complete**: TraceEventBase.traceUuid depends on identifier migration | A3 | Dependency not explicitly acknowledged | Add hard gate: "A3 Phase 1 cannot start until A1 closure criteria pass" |

### MID (Moderate Risk)

| # | Issue | Affected Plans | Root Cause | Recommended Action |
|---|---|---|---|---|
| M1 | **A2 benchmark methodology vague**: No harness technology specified | A2 | Engineering decision deferred | Specify Miniflare vs wrangler dev before Phase 2 starts |
| M2 | **A2 self-fulfilling decision**: Benchmark will validate existing path | A2 | Existing DoStorageTraceSink creates bias | Add negative test with rejection threshold |
| M3 | **A4 blocked on A1+A3**: If prerequisites slip, A4 cannot proceed | A4 | Hard dependencies on incomplete work | Add explicit dependency gates with skip criteria |
| M4 | **A7 evidence greenfield**: Most evidence types require new instrumentation | A7 | Components not originally designed to emit evidence | Re-scope A7 as "instrumentation and evidence" not just "evidence closure" |
| M5 | **PX-QNA Q8 scope not estimated**: Follow-up input family workload unknown | A1 | Owner decision added work without estimate | Produce follow-up-input-family-design.md with workload estimate before A1 starts |
| M6 | **A6 L2 cost unspecified**: Real provider smoke has financial cost | A6 | No budget or cost cap defined | Add cost ceiling: "L2 smoke must cost <$X per run" |
| M7 | **just-bash underutilized**: A8-A10 don't reference context patterns | A8-A10 | Context available but not consulted | Add just-bash alignment analysis to each plan |
| M8 | **Registry/docs disconnect**: Manual inventory will drift | A10 | No automated drift guard | Implement test that checks registry entries against handler implementations |

### LOW (Minor)

| # | Issue | Affected Plans | Root Cause | Recommended Action |
|---|---|---|---|---|
| L1 | **A1 downstream consumer list vague**: "e.g., llm-wrapper" instead of explicit list | A1 | Imprecise specification | List exact packages: session-do-runtime, agent-runtime-kernel, eval-observability, hooks |
| L2 | **A4 no rejection shape**: Follow-up input deferral lacks "not yet supported" response | A4 | Scope cut without fallback behavior | Add nacp-session error kind for unsupported message types |
| L3 | **A5 no sandboxing mention**: Remote worker security not addressed | A5 | Security gap in external seam design | Add sandboxing/policy discussion to A5 Phase 4 |
| L4 | **A7 R2 binding missing**: wrangler.jsonc has no R2 | A7 | Infrastructure not provisioned | Add R2 binding to wrangler.jsonc before A7 Phase 4 |
| L5 | **A10 drift guard manual**: No automated enforcement | A10 | Process constraint not tool constraint | Implement automated test: registry vs handlers vs docs |

---

## 8. Phase Readiness Assessment

| Plan | Design Quality | Implementation Readiness | Can Execute? | Primary Blockers |
|---|---|---|---|---|
| **A1** | ★★★★☆ | ★★☆☆☆ | ⚠️ Conditional | C1, H3, H5 |
| **A2** | ★★★★☆ | ★★★☆☆ | ✅ Yes | M1, M2 |
| **A3** | ★★★★☆ | ★★☆☆☆ | ❌ No | C1, C2, H4, H7 |
| **A4** | ★★★★☆ | ★★☆☆☆ | ❌ No | C2, C3, H2, M3 |
| **A5** | ★★★★☆ | ★★★☆☆ | ⚠️ Conditional | C1, H2 |
| **A6** | ★★★★☆ | ★★☆☆☆ | ❌ No | C3, H2 (A4/A5 must complete first) |
| **A7** | ★★★★☆ | ★★★☆☆ | ⚠️ Conditional | M4, L4 |
| **A8** | ★★★★☆ | ★★☆☆☆ | ⚠️ Conditional | H1 (rg stub) |
| **A9** | ★★★★☆ | ★★☆☆☆ | ❌ No | H1, H6 |
| **A10** | ★★★★☆ | ★★☆☆☆ | ⚠️ Conditional | H1, L5 |

---

## 9. Final Verdict

### 9.1 Overall Assessment

The after-skeleton action-plan suite is **architecturally mature but implementation-optimistic**. The plans correctly translate design intent into executable batches, respect owner decisions from PX-QNA, and maintain logical dependencies. However, they share a **collective blind spot**: they assume that the prerequisite Phase has left behind a clean, working surface, when in reality most surfaces are stubs, partially migrated, or missing entirely.

### 9.2 Recommended Pre-Flight Actions (Before Any Execution)

1. **Resolve C1 (trace naming bifurcation)**: Execute trace_id → trace_uuid migration as a breaking change with version bump
2. **Resolve C2 (event kind divergence)**: Create centralized event-kinds.ts in nacp-core
3. **Add "Implementation State" annotations**: Every action-plan batch should rate its target surfaces as Implemented/Stub/Partial/Not Started
4. **Estimate A1 Phase 3 scope**: Follow-up input family is new protocol design, not rename - produce separate design doc with workload estimate
5. **Specify A2 benchmark harness technology**: Miniflare vs wrangler dev vs custom mock - lock before Phase 2

### 9.3 Recommended Execution Order

```
Pre-flight:
  1. C1 migration (trace_id → trace_uuid)
  2. C2 registry (event-kinds.ts)
  3. A1 Phase 1-2 (inventory + core rename)
  
Wave 1:
  4. A1 Phase 3-5 (session rename + follow-up family + freeze evidence)
  5. A2 (substrate decision - can parallel with A1 if harness ready)
  
Wave 2:
  6. A3 Phase 1-2 (trace law + codec convergence)
  7. A8 Phase 1-3 (workspace truth + rg implementation)
  
Wave 3:
  8. A3 Phase 3-5 (recovery + instrumentation + closure)
  9. A4 Phase 1-2 (ingress convergence + WS helper assembly)
  10. A5 Phase 1-2 (binding catalog + hook/capability seam)
  
Wave 4:
  11. A4 Phase 3-5 (HTTP fallback + edge closure)
  12. A5 Phase 3-5 (fake provider + cross-seam law)
  13. A9 Phase 1-3 (curl/ts-exec contracts)
  14. A10 Phase 1-3 (git subset + policy enforcement)
  
Wave 5:
  15. A6 (verification gate - only after A4/A5 complete)
  16. A7 Phase 1-4 (evidence wiring + calibration)
  17. A8-A10 Phase 4-5 (consistency guards + drift guards)
  18. A7 Phase 5 (evidence report + closure)
```

### 9.4 Closing Statement

> The action-plans represent a **sound execution map** for the after-skeleton phase. Their primary weakness is not architectural but **epistemological**: they assume knowledge of a code reality that does not yet exist. Adding explicit "Implementation State" annotations, automated lint enforcement, and conservative dependency gates will transform these plans from **aspirational documents** into **executable contracts**.

---

*Review completed. This document should be treated as a living artifact and updated after each action-plan batch closure.*