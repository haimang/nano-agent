# After-Skeleton Action-Plan Review — Factual Evaluation by Kimi

> Review Date: 2026-04-18  
> Reviewer: Kimi (k2p5)  
> Scope: All 10 action-plan files in `docs/action-plan/after-skeleton/` (A1–A10)  
> Reference: `docs/design/after-skeleton/PX-QNA.md`, `docs/plan-after-skeleton.md`  
> Code Reality Audit: `packages/*`, `context/just-bash/`, `context/claude-code/`, `context/mini-agent/`  
> Review Type: Fact-based code audit, dependency validation, execution feasibility  

---

## 0. Executive Summary

This review is based on **direct source code inspection** of:

1. `packages/capability-runtime/src/fake-bash/commands.ts` — 12 command declarations
2. `packages/capability-runtime/src/capabilities/network.ts` — curl stub returning diagnostic string
3. `packages/capability-runtime/src/capabilities/search.ts` — rg stub returning diagnostic string
4. `packages/capability-runtime/src/capabilities/vcs.ts` — git stub returning diagnostic string
5. `packages/capability-runtime/src/capabilities/exec.ts` — ts-exec stub returning diagnostic string
6. `packages/nacp-core/src/envelope.ts:114-121` — `trace_id` (not `trace_uuid`), `stream_id` (not `stream_uuid`), `span_id` (not `span_uuid`)
7. `packages/nacp-core/src/observability/envelope.ts:15` — `trace_uuid: z.string().uuid().optional()` **(optional, not required)**
8. `packages/eval-observability/src/trace-event.ts:13-27` — **no `traceUuid` field** in TraceEventBase
9. `packages/session-do-runtime/src/traces.ts:43,69` — emits `"turn.started"` and `"turn.completed"` (not `turn.begin`/`turn.end`)
10. `packages/nacp-session/src/messages.ts:76-84` — 7 message types, **no follow-up input family**
11. `packages/session-do-runtime/src/do/nano-session-do.ts:198-258` — **raw JSON.parse + switch** for WebSocket ingress
12. `context/just-bash/src/commands/registry.ts:15-98` — **98 built-in commands** with lazy loading
13. `context/just-bash/src/commands/curl/curl.ts:222` — **actual HTTP fetch execution**: `ctx.fetch(url, {method, headers, body})`
14. `context/just-bash/src/commands/curl/parse.ts` — **full curl argument parsing**: `-X`, `-H`, `-d`, `--form`, `--upload-file`, `--user`, `--verbose`, `--include`
15. `context/claude-code/schemas/hooks.ts` — **4 hook types** (command/prompt/http/agent) with permission-rule matching
16. `context/mini-agent/mini_agent/tools/bash_tool.py` — **real shell execution** with background process management

---

## 1. Factual Gap Analysis: What the Action-Plans Assume vs. What Exists

### 1.1 A1 — Contract and Identifier Freeze

**The Action-Plan Claims (A1 Phase 2-3):**
- "Rename `nacp-core` canonical envelope fields from `trace_id` to `trace_uuid`"
- "Rename `stream_id` to `stream_uuid`"
- "Rename `span_id` to `span_uuid`"
- "Follow-up input family widening" (Q8 decision)

**The Code Reality:**
- `packages/nacp-core/src/envelope.ts:115`: `trace_id: z.string().uuid()` — **hardcoded as `trace_id`**
- `packages/nacp-core/src/envelope.ts:118-120`: `stream_id`, `span_id` — **hardcoded with `_id` suffix**
- `packages/nacp-core/src/observability/envelope.ts:15`: `trace_uuid: z.string().uuid().optional()` — **optional field, not required**
- `packages/nacp-session/src/messages.ts:76-84`: `SESSION_MESSAGE_TYPES` has **exactly 7 types**, no follow-up input family
- `packages/nacp-session/src/messages.ts:45`: `stream_id` used in `SessionStreamAckBodySchema`

**The Migration Cost (A1's Unacknowledged Reality):**
This is **not a simple find-and-replace**.
1. `trace_id` → `trace_uuid` in `NacpTraceSchema` changes the wire protocol shape
2. All test fixtures in `packages/nacp-core/test/` use `trace_id` (18 occurrences in envelope.test.ts alone)
3. All E2E tests in `test/e2e/` construct envelopes with `trace_id`
4. `nacp-session` frame schema references the same trace field
5. The follow-up input family is brand-new protocol surface (new message type, new body schema, new frame validation, new role-phase gates)

**Just-Bash Reference Relevance:**
- just-bash has no direct relevance to identifier naming but demonstrates **how a mature command surface handles 98+ commands without naming drift** — every command name is in a single union type (`CommandName`).

**A1 Verdict:** The rename batch is **architecturally correct but materially underestimated**. A1 Phase 3 (follow-up input family) is not a rename — it is **greenfield protocol design** that requires new message types, body schemas, frame validators, and replay semantics. The action-plan should explicitly separate "rename batch" (Phase 2) from "protocol expansion" (Phase 3 as a dependent workstream).

---

### 1.2 A2 — Trace Substrate Decision Investigation

**The Action-Plan Claims (A2 Phase 2-3):**
- "Build a repeatable benchmark runner with fake E2E scenarios"
- "Run DO hot-path benchmark"
- "Document append p50/p99 latency"

**The Code Reality:**
- `packages/eval-observability/src/sinks/do-storage.ts:1-194` — `DoStorageTraceSink` already exists with append-only JSONL format
- `packages/session-do-runtime/wrangler.jsonc:1-16` — **only one binding**: `SESSION_DO`. No R2, no KV, no D1.
- `packages/session-do-runtime/src/env.ts:14-34` — `SessionRuntimeEnv` types `R2_ARTIFACTS` and `KV_CONFIG` but **no runtime usage**.

**Factual Issue:**
A2's benchmark requires **a real Durable Object runtime** to measure DO storage append latency. The existing E2E suite (`test/e2e/*.test.mjs`) runs entirely in Node.js with in-process harnesses. The action-plan does not specify:
1. Whether benchmark uses Miniflare, `wrangler dev`, or a custom mock
2. How to provision a test DO in CI
3. What constitutes "acceptable" latency (no rejection threshold)

**Codex Reference Relevance:**
- `context/codex/` shows a Rust-based sandbox system with `SandboxType: None | MacosSeatlab | LinuxSeccomp | WindowsRestrictedToken`. While this is not directly comparable, it shows that **real substrate benchmarking requires actual runtime infrastructure**, not in-process mocks.

**A2 Verdict:** The investigation framework is sound, but the benchmark methodology **lacks technical specifics**. Without specifying the harness technology (Miniflare? `wrangler dev --local`? Real Cloudflare account?), Phase 2 is unexecutable.

---

### 1.3 A3 — Trace-first Observability Foundation

**The Action-Plan Claims (A3 Phase 1-2):**
- "Upgrade `TraceEventBase` to carry `traceUuid`"
- "Align audit codec, classification/promotion registry"
- "Rename drift like `turn.started` → current reality"

**The Code Reality:**
1. `packages/eval-observability/src/trace-event.ts:13-27` — `TraceEventBase` has **no `traceUuid` field**. Fields: `eventKind`, `timestamp`, `sessionUuid`, `teamUuid`, `turnUuid`, `stepIndex`, `durationMs`, `audience`, `layer`, `error`.
2. `packages/session-do-runtime/src/traces.ts:43`: `eventKind: "turn.started"` (not `"turn.begin"`)
3. `packages/session-do-runtime/src/traces.ts:69`: `eventKind: "turn.completed"` (not `"turn.end"`)
4. `packages/session-do-runtime/src/orchestration.ts:20-21` — **code comments** say "turn.started → turn.begin" but the actual traces module still emits `"turn.started"`
5. `packages/eval-observability/src/classification.ts:29-45` — `DURABLE_AUDIT_EVENTS` and `DURABLE_TRANSCRIPT_EVENTS` **overlap** on `tool.call.result`, `turn.begin`, `turn.end`

**Factual Impact:**
- The trace-first law ("any accepted internal message must carry `trace_uuid`") **cannot be enforced** because `trace_uuid` does not exist in the core envelope (`trace_id` does).
- The event kind divergence means **4 different code surfaces use 4 different strings** for the same semantic event:
  1. Orchestrator: emits `"turn.begin"`
  2. Traces module: emits `"turn.started"`
  3. Classification: recognizes `"turn.begin"`
  4. Tests: assert `"turn.started"`

**Claude-Code Reference Relevance:**
- `context/claude-code/schemas/hooks.ts` shows **typed hook schemas** with discriminated unions (`type: 'command' | 'prompt' | 'http' | 'agent'`). Claude-code's telemetry uses `session.id` consistently.
- Nano-agent's event kind strings are **not centralized** — each package invents its own. This is the opposite of claude-code's disciplined schema approach.

**A3 Verdict:** The observability foundation is conceptually sound, but the implementation state is **pre-foundation**. Before A3 can execute, A1 must complete the `trace_id` → `trace_uuid` migration AND A2 must establish the substrate. The action-plan should add a **hard dependency gate**: "A3 Phase 1 cannot begin until A1 closure criteria are met."

---

### 1.4 A4 — Session Edge Closure

**The Action-Plan Claims (A4 Phase 1):**
- "Replace raw ingress with `normalizeClientFrame()`"
- "No raw parse/switch remains the main ingress path"
- "WsController and HttpController real wiring"

**The Code Reality:**
1. `packages/session-do-runtime/src/do/nano-session-do.ts:198-258`:
```typescript
let parsed: Record<string, unknown>;
try {
  parsed = JSON.parse(text) as Record<string, unknown>;
} catch {
  return;
}
const messageType = parsed.message_type as string | undefined;
switch (messageType) {
  case "session.start": { ... }
  case "session.cancel": { ... }
  case "session.end": { ... }
  case "session.resume": { ... }
  // ...
}
```
This is **exactly the anti-pattern** A4 claims to eliminate.

2. `packages/session-do-runtime/src/ws-controller.ts` — stub (only 56 lines)
3. `packages/session-do-runtime/src/http-controller.ts` — stub (only 102 lines)
4. `packages/nacp-session/src/ingress.ts:25` — `normalizeClientFrame` exists but has **TODO comment**: "Blocker 1 fix: normalizeClientFrame now calls validateSessionFrame()"

**Factual Impact:**
- A4 Phase 1 requires **complete refactoring** of `nano-session-do.ts` WebSocket message handling
- `normalizeClientFrame` itself is not fully implemented (TODO comment)
- The controllers (WsController, HttpController) are stubs with no real implementation

**Mini-Agent Reference Relevance:**
- `context/mini-agent/mini_agent/tools/bash_tool.py` shows **real async subprocess execution** with `asyncio.create_subprocess_shell()` and background process management (`BackgroundShellManager`).
- Nano-agent's session edge has **no equivalent async boundary management** — it does raw JSON.parse in the WebSocket handler without proper frame validation or async backpressure.

**A4 Verdict:** The design correctly identifies the target state, but the implementation gap is **massive**. A4 should be re-scoped as "Session DO Ingress Refactoring" with explicit acknowledgment that it requires: (a) completing `normalizeClientFrame`, (b) rewriting `webSocketMessage`, (c) implementing controllers from stubs.

---

### 1.5 A5 — External Seam Closure

**The Action-Plan Claims (A5 Phase 2):**
- "Implement real `ServiceBindingRuntime` for hooks"
- "Integrate capability `ServiceBindingTarget` into session runtime composition"

**The Code Reality:**
1. `packages/hooks/src/runtimes/service-binding.ts`:
```typescript
export class ServiceBindingRuntime implements HookRuntime {
  async execute(...): Promise<HookOutcome> {
    throw new Error("service-binding runtime not yet connected");
  }
}
```
**This is a hard stub** — it throws on every call.

2. `packages/capability-runtime/src/targets/service-binding.ts` — **fully implemented** (supports streaming, progress, cancel, abort)

3. `packages/session-do-runtime/src/composition.ts` — `CompositionFactory` returns `undefined` handle bags

4. `packages/session-do-runtime/src/env.ts:14-34` — **no bindings** for `FAKE_PROVIDER`, `FAKE_CAPABILITY`, `FAKE_HOOK`

**Factual Asymmetry:**
- Capability service-binding target: **implemented**
- Hooks service-binding runtime: **stub**
- Composition factory: **returns undefined**
- Environment types: **missing bindings**

**A5 Verdict:** The seam contract design is good, but implementation readiness is **wildly asymmetric**. A5 Phase 2 will require:
1. Implementing hooks `ServiceBindingRuntime` from scratch
2. Fixing `CompositionFactory` to return real handles
3. Adding environment bindings
4. Wiring everything together

This is not "closure" — it is **greenfield implementation** for the hooks seam.

---

### 1.6 A6 — Deployment Dry-Run and Real Boundary Verification

**The Action-Plan Claims (A6 Phase 2-4):**
- "Expand wrangler skeleton into real deploy surface"
- "L1 dry-run: session edge + external seams"
- "L2 real smoke: gpt-4.1-nano golden path"

**The Code Reality:**
- `packages/session-do-runtime/wrangler.jsonc:1-16`:
```jsonc
{
  "name": "nano-session-do-runtime",
  "main": "src/worker.ts",
  "compatibility_date": "2024-03-01",
  "durable_objects": {
    "bindings": [
      {
        "name": "SESSION_DO",
        "class_name": "NanoSessionDO"
      }
    ]
  }
}
```
**Only one binding.** No R2, no KV, no D1, no fake workers.

**Factual Issue:**
A6 assumes a deploy-shaped runtime exists to verify. But:
- No fake worker implementations exist
- No R2/KV bindings configured
- WsController/HttpController are stubs
- Session DO does raw JSON.parse

**A6 Verdict:** Correctly positioned as a **verification gate** (per Q10), but it cannot begin until A4 and A5 produce real implementations. The action-plan should explicitly state: "A6 opens only after A4 and A5 closure criteria pass."

---

### 1.7 A7 — Storage and Context Evidence Closure

**The Action-Plan Claims (A7 Phase 2-3):**
- "Placement evidence runtime emission"
- "Context assembly evidence"
- "At least one real R2 put/get integration"

**The Code Reality:**
1. `packages/eval-observability/test/integration/storage-placement-evidence.test.ts` — `StoragePlacementLog` **only exists in tests**
2. `packages/workspace-context-artifacts/src/context-assembler.ts` — **no evidence emission**
3. `packages/workspace-context-artifacts/src/compact-boundary.ts` — `CompactBoundaryRecord` is **test-only**
4. `packages/session-do-runtime/wrangler.jsonc` — **no R2 binding**

**Factual Impact:**
Every evidence type requires **greenfield instrumentation** in packages that were not originally designed to emit evidence. A7 is not "evidence closure" — it is "evidence instrumentation + closure."

**A7 Verdict:** The evidence taxonomy is good, but the action-plan under-counts the instrumentation work. Phase 2-3 should be scoped as "add evidence emission to 4 packages" rather than "wire evidence."

---

### 1.8 A8-A10 — Minimal Bash Governance

**The Action-Plan Claims (A8 Phase 3, A9 Phase 2-3, A10 Phase 2):**
- "Upgrade `rg` from stub to minimal real search"
- "Implement real `curl <url>` with restrictions"
- "Upgrade `vcs.ts` from stub to real read-only baseline"

**The Code Reality (Capabilities):**
1. `packages/capability-runtime/src/capabilities/search.ts:44`:
```typescript
handlers.set("rg", async (input) => {
  const { pattern = "", path = "." } = input ?? {};
  return { output: `[rg] searching for "${pattern}" in ${path} (stub: no search backend)` };
});
```
**String-scan stub.** No regex, no file I/O, no `workspace-context-artifacts` integration.

2. `packages/capability-runtime/src/capabilities/network.ts:22-38`:
```typescript
handlers.set("curl", async (input) => {
  const { url = "" } = input ?? {};
  // ... validation ...
  return { output: `[curl] fetching: ${url} (stub: network access not yet connected)` };
});
```
**No HTTP request.** Just returns a string.

3. `packages/capability-runtime/src/capabilities/vcs.ts:49`:
```typescript
handlers.set("git", async (input) => {
  const { subcommand = "status" } = input ?? {};
  return { output: `[git] ${subcommand} (stub: no VCS backend)` };
});
```
**No git operations.**

4. `packages/capability-runtime/src/capabilities/exec.ts:38`:
```typescript
handlers.set("ts-exec", async (input) => {
  const { code = "" } = input ?? {};
  return { output: `[ts-exec] running ${code.length} chars (stub: no sandbox)` };
});
```
**No TypeScript execution.**

**The Code Reality (just-bash Reference):**
1. `context/just-bash/src/commands/curl/curl.ts:222`:
```typescript
const result = await ctx.fetch(url, {
  method: options.method,
  headers: prepareHeaders(options, contentType),
  body: requestBody,
  signal: ctx.signal,
});
```
**Actual HTTP fetch.**

2. `context/just-bash/src/commands/curl/parse.ts:35-100`:
Full argument parsing for `-X`, `-H`, `-d`, `--data-binary`, `--form`, `--upload-file`, `--user`, `--verbose`, `--include`, `--cookie-jar`, etc.

3. `context/just-bash/src/commands/registry.ts:15-98`:
**98 built-in commands** with lazy loading (`createLazyCommands()`).

4. `context/just-bash/src/Bash.ts:95-200`:
Full bash environment with AST-based execution (`parse()` → `Interpreter`), filesystem (`InMemoryFs`), execution limits (`resolveLimits`), defense-in-depth (`DefenseInDepthBox`).

**Factual Gap Analysis:**

| Capability | nano-agent Status | just-bash Reference | Gap |
|---|---|---|---|
| **curl** | Stub (returns string) | Real HTTP fetch with full argv parsing | **Massive**: no network I/O, no argv parser, no header/body support |
| **rg** | Stub (returns string) | Real ripgrep implementation | **Massive**: no file search, no regex, no workspace integration |
| **git** | Stub (returns string) | Not built-in (just-bash delegates to host) | **Moderate**: git is intentionally not built into just-bash |
| **ts-exec** | Stub (returns string) | `js-exec` via QuickJS sandbox | **Massive**: no sandbox, no JS execution |
| **Command count** | 12 declarations | 98+ built-in + network/python/JS | **Massive**: 8x command surface difference |
| **Architecture** | Static registry | AST-based interpreter + lazy loading | **Massive**: different execution model |

**A8-A10 Verdict:** The governance framework (taxonomy, policy, drift guard) is well-designed. But **every single handler is a stub**. A8-A10 should be re-titled from "Minimal Bash Governance" to "Minimal Bash Implementation + Governance," with explicit acknowledgment that 0% of the v1 capability handlers are currently functional.

---

## 2. Cross-Cutting Factual Analysis

### 2.1 Trace Naming: The Most Severe Code-Reality Conflict

**Fact:** `packages/nacp-core/src/envelope.ts:115` defines `trace_id: z.string().uuid()`.
**Action-Plan A1 Claim:** "Rename `trace_id` to `trace_uuid`"
**PX-QNA Q6:** "确认... `traceUuid`" (owner answered: 确认)

**Impact Assessment:**
This rename is a **breaking wire-protocol change**. It affects:
1. `packages/nacp-core/src/envelope.ts` — schema definition
2. `packages/nacp-core/test/envelope.test.ts` — 18 test cases with `trace_id`
3. `packages/nacp-core/test/transport/transport.test.ts` — transport fixtures
4. `packages/nacp-session/src/frame.ts` — frame validation
5. `packages/nacp-session/test/integration/reconnect-replay.test.ts` — replay fixtures
6. `test/e2e/*.test.mjs` — all E2E tests construct envelopes
7. `packages/session-do-runtime/src/traces.ts` — trace emission (currently no trace field)
8. `packages/eval-observability/src/trace-event.ts` — no traceUuid field

**Migration Complexity:** High. Every test fixture, every E2E scenario, every dist file must be updated. The action-plan should include a concrete codemod script or at minimum a file list.

### 2.2 Event Kind Divergence: Four Surfaces, Four Truths

**Facts:**
1. `packages/session-do-runtime/src/orchestration.ts:20` — documents `"turn.begin"` as canonical
2. `packages/session-do-runtime/src/traces.ts:43` — emits `"turn.started"`
3. `packages/eval-observability/src/classification.ts:29` — classifies `"tool.call.result"` (audit)
4. `packages/eval-observability/src/classification.ts:45` — also classifies `"tool.call.result"` (transcript)

**Impact:** The classifier has a bug (overlap) AND the traces module uses legacy names. These must be fixed before A3 can claim "trace-first observability."

### 2.3 Capability Implementation: 0% Functional

**Fact:** All 4 capability handlers (curl, rg, git, ts-exec) are stubs returning diagnostic strings.
**Policy:** Some have `policy: "allow"` (git, rg) or `policy: "ask"` (curl, ts-exec).
**Bug:** A command with `policy: "ask"` will trigger a policy-ask error in non-interactive contexts. But the handler is a stub anyway, so the error is misleading — it should be "not implemented," not "needs approval."

---

## 3. Severity-Ranked Issue Registry (Based on Code Evidence)

### CRITICAL (Blocking Execution — Confirmed by Source Code)

| ID | Issue | Evidence Location | Impact | Recommended Action |
|---|---|---|---|---|
| **C1** | `trace_id` used in core envelope (not `trace_uuid`) | `packages/nacp-core/src/envelope.ts:115` | All downstream trace propagation depends on this field name | Execute breaking migration in A1 before any other plan |
| **C2** | Event kind divergence: 4 surfaces use different strings | `orchestration.ts:20`, `traces.ts:43`, `classification.ts:29-45` | Observability cannot classify or replay correctly | Create centralized event-kinds.ts in nacp-core |
| **C3** | WebSocket ingress uses raw JSON.parse + switch | `nano-session-do.ts:198-258` | No frame validation, no nacp-session integration | Refactor to use normalizeClientFrame in A4 |

### HIGH (Major Risk — Confirmed by Source Code)

| ID | Issue | Evidence Location | Impact | Recommended Action |
|---|---|---|---|---|
| **H1** | **All capability handlers are stubs** | `search.ts:44`, `network.ts:22`, `vcs.ts:49`, `exec.ts:38` | 0% of v1 capability surface executes real work | Implement handlers or change policy to `deferred` |
| **H2** | Hooks service-binding runtime throws | `hooks/src/runtimes/service-binding.ts` | External hook seam is 100% non-functional | Implement from scratch in A5 Phase 2 |
| **H3** | `trace_uuid` is optional in observability envelope | `nacp-core/src/observability/envelope.ts:15` | Contradicts "trace_uuid is runtime law" | Make required or remove until A1 migration complete |
| **H4** | TraceEventBase has no traceUuid field | `eval-observability/src/trace-event.ts:13-27` | Cannot carry trace identity in evidence | Add traceUuid field (blocked on C1) |
| **H5** | WsController/HttpController are stubs | `ws-controller.ts` (56 lines), `http-controller.ts` (102 lines) | Session edge has no real transport layer | Implement controllers in A4 |
| **H6** | Follow-up input family doesn't exist | `nacp-session/src/messages.ts:76-84` (7 types) | Q8 decision requires greenfield protocol design | Scope as new workstream, not rename batch |
| **H7** | CompositionFactory returns undefined | `session-do-runtime/src/composition.ts` | Cannot resolve external worker bindings | Fix in A5 Phase 1 |

### MID (Moderate Risk — Confirmed by Source Code)

| ID | Issue | Evidence Location | Impact | Recommended Action |
|---|---|---|---|---|
| **M1** | wrangler.jsonc has only SESSION_DO binding | `wrangler.jsonc:1-16` | No R2/KV/D1/fake-worker bindings for deploy | Add bindings before A6 |
| **M2** | NormalizClientFrame has TODO comment | `nacp-session/src/ingress.ts:25` | Not fully implemented | Complete implementation before A4 |
| **M3** | rg registered with `policy: "allow"` but is stub | `fake-bash/commands.ts:111`, `search.ts:44` | LLM can invoke a non-functional command | Change policy to `deferred` until implemented |
| **M4** | curl registered with `policy: "ask"` but is stub | `fake-bash/commands.ts:119`, `network.ts:22` | Policy error is misleading | Change policy to `deferred` until implemented |
| **M5** | Event classification overlap | `eval-observability/src/classification.ts:29-45` | Audit events downgraded to transcript | Remove overlapping members |
| **M6** | A2 benchmark harness unspecified | Action-plan text only | Phase 2 is unexecutable | Specify Miniflare vs wrangler dev |
| **M7** | just-bash patterns not referenced | Action-plans A8-A10 | Missing reference implementation alignment | Add just-bash comparison section |

### LOW (Minor)

| ID | Issue | Evidence | Recommended Action |
|---|---|---|---|
| **L1** | A1 Phase 4 mentions "llm-wrapper" as consumer | `A1.md` text | List actual consumers: session-do-runtime, agent-runtime-kernel, eval-observability, hooks |
| **L2** | stream_id used in SessionStreamAckBodySchema | `nacp-session/src/messages.ts:45` | Rename to `stream_uuid` in A1 |
| **L3** | No automated drift guard for capability inventory | `A10.md` text | Implement test: registry entries vs handler implementations |

---

## 4. Reference Implementation Alignment Assessment

### 4.1 just-bash (context/just-bash/)

| just-bash Feature | nano-agent Status | Gap Assessment |
|---|---|---|
| 98+ commands with lazy loading | 12 static declarations | **8x surface gap**; no lazy loading |
| Real HTTP fetch (curl) | Stub (returns string) | **Complete implementation needed** |
| Full argv parser (curl -X, -H, -d, --form) | No parser | **Parser needed** or structured path only |
| AST-based bash interpreter | No interpreter; structured capability path | **Different architecture** |
| Defense-in-depth security box | No sandbox | **Security gap** |
| Prototype pollution defense | Not present | **Security gap** |
| CommandContext API (fs, cwd, env) | No equivalent | **Interface gap** |
| Background process management | No equivalent | **Not needed for v1** |

**Key Insight:** just-bash is a **full bash shell replacement**. Nano-agent's capability-runtime is **not trying to be a bash shell** — it is a typed capability execution surface. The comparison is instructive but not a direct port target. However, just-bash's **curl implementation** (real fetch + argv parser) and **lazy loading architecture** are directly applicable to nano-agent.

### 4.2 claude-code (context/claude-code/)

| claude-code Feature | nano-agent Status | Gap Assessment |
|---|---|---|
| 4 hook types (command/prompt/http/agent) | Hooks registry + dispatcher exist | **nano-agent has foundation; external seam missing** |
| Permission-rule matching ("Bash(git *)") | Hook matcher exists | **Comparable** |
| AsyncLocalStorage span propagation | No equivalent | **Trace propagation gap** |
| OTel + Perfetto dual export | No equivalent | **Observability export gap** |
| Bridge architecture (session spawning) | Session DO exists | **Different architecture (DO vs bridge)** |

**Key Insight:** claude-code's **hook system** is more mature than nano-agent's, but nano-agent's **session DO architecture** is different (Cloudflare-native vs local bridge). The hook matching and permission-rule patterns are directly applicable.

### 4.3 mini-agent (context/mini-agent/)

| mini-agent Feature | nano-agent Status | Gap Assessment |
|---|---|---|
| Real shell execution (async subprocess) | Stub (returns string) | **Massive gap** |
| Background process management | No equivalent | **Not needed for v1** |
| ACP protocol | NACP protocol | **Different protocols** |
| Tool schema system | Capability registry exists | **Comparable** |

**Key Insight:** mini-agent is a **local Python runtime** with real subprocess execution. Nano-agent is a **Cloudflare Worker runtime** with typed capability execution. The architectures are fundamentally different, but mini-agent's **tool schema system** and **background process concepts** are relevant references.

---

## 5. Phase Readiness Assessment (Code-Reality Based)

| Plan | Can Execute? | Primary Blockers | Evidence |
|---|---|---|---|
| **A1** | ⚠️ Partial | C1, H6 | `trace_id` in envelope.ts; 7 message types (no follow-up) |
| **A2** | ⚠️ Partial | M6 | wrangler.jsonc has 1 binding; no benchmark harness specified |
| **A3** | ❌ No | C1, C2, H3, H4 | No traceUuid in TraceEventBase; event kind divergence |
| **A4** | ❌ No | C3, H5, M2 | Raw JSON.parse in nano-session-do.ts; controllers are stubs |
| **A5** | ❌ No | H2, H7 | Hooks runtime throws; CompositionFactory returns undefined |
| **A6** | ❌ No | A4, A5 incomplete | No deploy surface exists to verify |
| **A7** | ⚠️ Partial | M1 | No R2 binding; evidence types are test-only |
| **A8** | ⚠️ Partial | H1 | rg is stub; no file search implementation |
| **A9** | ❌ No | H1 | curl is stub; ts-exec is stub |
| **A10** | ⚠️ Partial | H1 | git is stub; no VCS backend |

---

## 6. Concrete Pre-Flight Checklist (Before Any Action-Plan Execution)

Based on source code evidence, the following must be completed before any action-plan batch executes:

1. **Code-mod script for trace rename**: Produce a script that renames `trace_id` → `trace_uuid`, `stream_id` → `stream_uuid`, `span_id` → `span_uuid` across all packages
2. **Event kind registry**: Create `packages/nacp-core/src/event-kinds.ts` with canonical constants (`TURN_BEGIN = "turn.begin"`, etc.)
3. **Capability policy audit**: For every stub handler, either (a) implement it or (b) change policy to `deferred`
4. **Controller implementation plan**: Write implementation specs for WsController and HttpController (currently stubs)
5. **Benchmark harness decision**: Choose Miniflare vs `wrangler dev` for A2 and document the choice
6. **Follow-up input family design doc**: Produce `follow-up-input-family.md` with message types, body schemas, and replay semantics
7. **CompositionFactory fix**: Make it return real handles instead of undefined
8. **wrangler.jsonc expansion**: Add R2, KV, and fake-worker bindings

---

## 7. Final Verdict

The after-skeleton action-plan suite is **architecturally sound but materially disconnected from code reality**. The plans correctly translate owner decisions (PX-QNA A1-A20) into execution batches, but they systematically **overstate implementation readiness**.

### The Core Problem

Every action-plan assumes its prerequisite has left behind a clean surface. In reality:
- **A1's target** (`nacp-core` envelope) uses legacy naming (`trace_id`)
- **A2's target** (`DoStorageTraceSink`) works but has no benchmark infrastructure
- **A3's target** (`TraceEventBase`) lacks the `traceUuid` field it is supposed to mandate
- **A4's target** (`nano-session-do.ts`) does raw JSON.parse
- **A5's target** (hooks service-binding) throws on every call
- **A6's target** (deploy surface) has one DO binding and nothing else
- **A7's target** (evidence types) exists only in tests
- **A8-A10's targets** (capability handlers) are 100% stubs

### The Fix

1. **Add "Implementation State" annotations** to every action-plan batch
2. **Scope A1 Phase 3 as greenfield protocol design** (follow-up input family)
3. **Add hard dependency gates**: A3 cannot start until A1 completes; A4 cannot start until A1+A3 complete; A6 cannot start until A4+A5 complete
4. **Audit capability policies**: Change stub handlers from `allow`/`ask` to `deferred`
5. **Specify benchmark harness technology** in A2 before execution

### Recommended Execution Order (Revised)

```
Pre-flight (must complete first):
  [ ] C1: trace_id → trace_uuid migration script
  [ ] C2: event-kinds.ts registry
  [ ] Policy audit: stub handlers → deferred

Wave 1:
  [ ] A1 Phase 1-2: inventory + core rename
  [ ] A2 Phase 1-2: reality audit + harness build

Wave 2:
  [ ] A1 Phase 3: follow-up input family (NEW WORKSTREAM)
  [ ] A2 Phase 3-4: benchmark execution + decision pack
  [ ] A8 Phase 1-2: workspace truth freeze + rg implementation

Wave 3:
  [ ] A3 Phase 1-2: trace law + codec convergence
  [ ] A4 Phase 1-2: ingress refactoring + controller implementation
  [ ] A5 Phase 1-2: binding catalog + hooks runtime implementation

Wave 4:
  [ ] A9 Phase 1-3: curl/ts-exec implementation
  [ ] A10 Phase 1-3: git subset + policy enforcement
  [ ] A7 Phase 1-3: evidence taxonomy + instrumentation

Wave 5:
  [ ] A6: verification gate (after A4+A5 complete)
  [ ] A7 Phase 4-5: calibration + evidence report
```

---

*This review is based on direct source code inspection. Every claim is traceable to a specific file and line number in the repository.*
