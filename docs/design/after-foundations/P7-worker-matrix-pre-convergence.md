# Nano-Agent After-Foundations P7 — Worker-Matrix Pre-Convergence & Handoff

> 功能簇：`Worker-Matrix Pre-Convergence (handoff to next phase)`
> 讨论日期：`2026-04-19`
> 讨论者：`Opus 4.7 (1M context)`
>
> 关联调查报告（B1 finding traceability — 6 handoff findings + cross-references）：
>
> **6 handoff findings (B1-handoff-to-B2-B6.md §B8)**:
> - `docs/spikes/spike-do-storage/01-r2-multipart-not-required-up-to-10mib.md` (**F01 — "R2 single-part covers ≤ 10 MiB"**)
> - `docs/spikes/spike-do-storage/04-do-transactional-three-scenarios-confirmed.md` (**F04 — "DO storage transaction contract validated"**)
> - `docs/spikes/spike-do-storage/05-mem-vs-do-state-parity-confirmed.md` (**F05 — "MemoryBackend ≈ DO storage for basic K/V"**)
> - `docs/spikes/spike-do-storage/07-bash-capability-parity-3-of-3-contracts-hold.md` (**F07 — "12-pack capability contract holds in real worker runtime"**)
> - `docs/spikes/spike-binding-pair/01-binding-latency-sub-10ms-and-cancellation-works.md` (**binding-F01 — "Service binding p50=5ms, p99=7ms; 10 concurrent in 12ms wallclock"**)
> - `docs/spikes/spike-binding-pair/03-hooks-callback-latency-and-error-shape-confirmed.md` (**binding-F03 — "Cross-worker hook dispatch p50=4ms; structured 500 body"**)
>
> **Additional B1 references for binding catalog evolution decision**:
> - `docs/spikes/spike-binding-pair/02-anchor-headers-survive-but-lowercased.md` (binding-F02 — header lowercase contract for cross-worker handoff)
> - `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md` (binding-F04 — sink dedup contract for cross-worker fan-in)
> - `docs/spikes/storage-findings.md` + `docs/spikes/binding-findings.md` + `docs/spikes/fake-bash-platform-findings.md` (3 rollups)
> - `docs/issue/after-foundations/B1-final-closure.md` (B1 全部 finding inventory)
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` §B8 (B8 input contract)
>
> **B2-B6 ship integration outputs that must be cited**:
> - All P1-P5 designs + 3 RFCs (storage 2.0.0 / fake-bash 扩展 / context-management / hooks 1.0.0 / nacp 1.2.0)
> - `docs/design/after-foundations/P6-spike-round-2-integration-plan.md` (sibling — Round 2 closure 是 P7 启动条件)
>
> **Cross-references — V1 binding catalog facts (the existing reality)**:
> - `packages/session-do-runtime/src/env.ts:73-77` (current `V1_BINDING_CATALOG`: `CAPABILITY_WORKER` / `HOOK_WORKER` / `FAKE_PROVIDER_WORKER` + reserved `SKILL_WORKERS`)
> - `packages/session-do-runtime/wrangler.jsonc` (current 3 services binding declared)
>
> **Eval traceability (worker matrix discussion thread)**:
> - `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md` (5 worker matrix proposal)
> - `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md` (3-worker + 2 reserved counter-proposal)
> - `docs/eval/after-foundations/before-worker-matrix-eval-with-GPT.md` + `before-worker-matrix-eval-with-Opus.md` §8 (this whole after-foundations phase emerged from)
> - `docs/eval/after-foundations/context-management-eval-by-Opus.md` v2 §7.4 (context.core upgrade to first-wave worker)
>
> 上游 charter / 模板：
> - `docs/plan-after-foundations.md` §6 Phase 7 + §7.8 + §11 + §12 (next phase)
> - `docs/plan-after-foundations.md` §1.4 (context.core upgrade — owner decision)
> - `docs/plan-after-foundations.md` §4.1 H (worker-matrix pre-convergence in-scope)
> - `docs/templates/design.md`
>
> 文档状态：`draft`

---

## 0. 背景与前置约束

P7 是 after-foundations 阶段的 **handoff phase** —— 不修改 packages/ 任何代码，仅产出 worker matrix 阶段所需的 readiness inputs：worker naming proposal、binding catalog policy、handoff memo、wrangler / composition factory templates. **本设计严守 charter §4.1 H + GPT review §2.2 修订**：worker matrix 的 future worker 命名只是 proposal，**不修改** v1 binding catalog；agent.core 是 host worker 不是被 host 消费的 binding slot.

- **项目定位回顾**：worker matrix 阶段的最终 worker 划分由那时的设计决定；P7 仅提供"input ready" handoff package，不替 worker matrix 决策。
- **本次讨论的前置共识**：
  - **不修改** `env.ts` 现有 `V1_BINDING_CATALOG` (除非 Round 2 暴露 v1 catalog 不可用 gap，per charter §4.1 H 第 32 项)
  - **不立项** worker matrix 的任何实质实现（per charter §4.2 A 第 1+2+3 项）
  - 仅输出**proposal**形态的 worker naming 文档 + binding 名额预留
  - context.core 升格为 first-wave worker (per charter §1.4 owner decision)
  - 4 first-wave worker proposal: **agent.core** (host) + **bash.core** + **filesystem.core** + **context.core**
  - **skill.core** 仅 reserve binding name；当前已是 v1 catalog 的 `SKILL_WORKERS` reserved slot
  - 6 handoff findings (F01/F04/F05/F07/binding-F01/binding-F03) provides "what's already validated" baseline for next phase
  - P6 Round 2 closure (`B7-final-closure.md`) 是 P7 启动的硬前置
- **显式排除的讨论范围**：
  - 不讨论 worker matrix 阶段的具体 phase 划分（→ that phase's charter）
  - 不讨论 service binding catalog 的 v2 接口签名（→ next phase）
  - 不讨论 production deployment topology (→ next phase)
  - 不讨论 RBAC / OAuth / billing / tenant ops (→ post-worker-matrix)
  - 不讨论 D1 schema-first ORM (out-of-scope per charter §4.2)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Worker-Matrix Pre-Convergence`
- **一句话定义**：after-foundations 阶段的 **handoff package** —— 不修改 packages/ 任何代码，仅产出 worker matrix 阶段所需的 readiness inputs (worker naming proposal、binding catalog policy、handoff memo、wrangler / composition factory templates).
- **边界描述**：本设计**包含**handoff memo 结构、4 worker naming proposal、binding catalog evolution policy、wrangler.toml 模板、composition factory 模板、Round 2 closure 与 worker-matrix-readiness 的衔接条件；**不包含**worker matrix 具体 worker shell 实现、binding catalog v2 设计、production deployment 细节。
- **关键术语对齐**：

| 术语 | 定义 |
|---|---|
| **First-wave worker** | worker matrix 阶段计划首批立项的 worker (4: agent.core / bash.core / filesystem.core / context.core) |
| **Reserved binding** | binding catalog 中保留 slot 但不实装的位置 (current: `SKILL_WORKERS`; future: skill.core) |
| **Host worker** | session DO 自身演化形态; agent.core 是 host worker; 不同于 binding-consumed 的 remote worker |
| **Worker naming proposal** | P7 仅输出的 proposal 文档，不修改任何代码 |
| **Handoff memo** | `docs/handoff/after-foundations-to-worker-matrix.md` —— P7 的核心交付物 |

### 1.2 参考调查报告

详见 frontmatter — 6 handoff findings + 全部 B1 finding inventory + worker matrix eval thread + charter §1.4 / §4.1 H / §12.

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 本子模块在整体架构里的角色：**after-foundations → worker matrix 的桥梁** —— 把 B1-B7 的全部 evidence + ship 状态打包成 readiness checklist + worker naming proposal，供 worker matrix 阶段直接消费.
- 服务于：worker matrix 阶段的 charter / phase 0 / first-wave worker shell 设计
- 依赖：B2-B6 全部 ship + B7 (P6) Round 2 closure with all verdicts transitioned
- 被谁依赖：worker matrix 阶段的 phase charter + 4 first-wave worker shells + skill.core 立项决策

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `packages/session-do-runtime/src/env.ts:73-77` (V1_BINDING_CATALOG) | review only (no modify) | 弱 | per charter §4.1 H 第 32 项 |
| `packages/session-do-runtime/wrangler.jsonc` (current 3 services) | review only (no modify) | 弱 | same |
| **All 15 B1 finding docs** | summarizes / cites | 强 | handoff memo 引用 6 handoff findings + 9 其他 finding 状态 |
| **B7 Round 2 closure** (P6 sibling) | depends on | 强 | hard prerequisite |
| `docs/handoff/after-foundations-to-worker-matrix.md` (P7 deliverable) | produces | 强 | 核心 deliverable |
| `docs/handoff/next-phase-worker-naming-proposal.md` (P7 deliverable) | produces | 强 | per charter §4.1 H 第 33 项 |
| `docs/templates/wrangler-worker.toml` (P7 deliverable) | produces | 中 | charter §14 §附 A 第 5 项 |
| `docs/templates/composition-factory.ts` (P7 deliverable) | produces | 中 | same |
| Worker matrix eval thread | references / closes | 中 | discussion converges to this handoff design |
| `docs/eval/after-foundations/context-management-eval-by-Opus.md` v2 §7.4 | cites | 中 | context.core upgrade decision source |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`worker-matrix-pre-convergence` 是 **after-foundations → worker matrix 的桥梁** —— 不改代码，只做 handoff: 整合 6 handoff findings + B2-B6 ship 状态 + Round 2 closure 输出 worker naming proposal + binding catalog evolution policy + handoff memo + 2 templates，让 worker matrix 阶段从 "组装已验证组件" 而非 "边写边验证" 起步.

---

## 3. P7 4 大 Deliverables

### 3.1 `docs/handoff/after-foundations-to-worker-matrix.md`（核心 handoff memo）

#### 3.1.1 必填章节

```
§1 Phase Summary — after-foundations 阶段 7 大 phases (B1-B7) closure 状态总览
§2 What's Validated — 6 handoff findings + 9 其他 finding 当前 verdict 综合
§3 What's Shipped — B2-B6 ship 后的 packages 与 versions
§4 Hard Contract Requirements — 6 必修项 (per B1-final-closure §6)
§5 Worker Naming Proposal — 4 first-wave + 1 reserved (link to next-phase-worker-naming-proposal.md)
§6 Binding Catalog Evolution Policy — V1_BINDING_CATALOG 的演进路径
§7 Round 2 Closure Verdicts — 13 + 2 finding 全部 verdict
§8 Templates Available — wrangler-worker.toml + composition-factory.ts
§9 Open Issues at Handoff — any still-open carried over
§10 Recommended First Phase of Worker Matrix — 建议
```

#### 3.1.2 §2 "What's Validated" 必须含 6 handoff findings 表

每条 handoff finding 必须含：finding ID + 1-line summary + Round 2 verdict + worker matrix phase 用途.

| Finding | Summary | Round 2 verdict | Worker matrix usage | Caveats |
|---|---|---|---|---|
| F01 | R2 single-part covers ≤ 10 MiB | (filled by P6 Round 2) | filesystem.core artifact upload path | — |
| F04 | DO storage transaction validated | (filled by P6) | context.core async-compact committer; agent.core session checkpoint | — |
| F05 | MemoryBackend basic K/V parity | (filled by P6) | bash.core local dev可信 vs production | — |
| F07 | 12-pack capability contract holds | (filled by P6) | bash.core safe to ship with current 12-pack as starting point | — |
| binding-F01 | Service binding p50=5ms / p99=7ms / 10 concurrent in 12ms | (filled by P6) | cross-worker call latency budget for all 4 worker dispatches | — |
| binding-F03 | Cross-worker hook dispatch p50=4ms / structured 500 body | (filled by P6) | cross-worker hook events viability (P4 catalog 18 events) | ⚠️ **anchor-on-hook-path** originally测到 `/handle/header-dump`；2026-04-19 r2 修复后重测 `/handle/hook-dispatch` real path confirmed (per B1-final-closure §Caveats C2 fix) |

> **Additional caveats from B1-final-closure §Caveats (MUST cite when handoff memo ships)**:
> - **C1 (binding-F04 scope)**: V3-binding-eval-fanin 是 response-batch simulation; 真 cross-worker sink callback semantics 由 B7 P6 §4.4a 复现
> - **C3 (F03 weak evidence)**: V1-storage-KV-stale-read 只是 same-colo 40-sample reconnaissance baseline; cacheTtl 变体 + 100-sample + cross-colo 由 B7 P6 §4.1 + §4.4b 复现

### 3.2 `docs/handoff/next-phase-worker-naming-proposal.md`（worker naming proposal）

#### 3.2.1 4 first-wave worker proposals

> **明确标注**：这是 proposal，不是冻结决策；worker matrix 阶段的最终决定可能调整.

| Worker name | Role | Form | Source design |
|---|---|---|---|
| `agent.core` | host worker | session DO 自身的下一形态；不是被 binding 消费 | charter §12.1 + GPT §2.2 修订 + Opus v2 §7.4 |
| `bash.core` | remote binding | capability runtime 12-pack + ext (B3 ship) | charter §12.1 |
| `filesystem.core` | remote binding | workspace + storage adapter (B2 ship) | charter §12.1 |
| `context.core` | remote binding | context-management (B4 ship) | **upgrade per Opus v2 §7.4** (originally reserved-only in v1) |

#### 3.2.2 1 reserved binding

| Worker name | Status | Reason |
|---|---|---|
| `skill.core` | reserved binding only | charter §12.2; greenfield (no foundation packages); deferred until product需求明确 OR 拆分成更细 worker (browser-worker / search-worker / scrape-worker per Opus v2 §3.5) |

#### 3.2.3 critical naming distinction (per GPT review §2.2 修订)

> **agent.core ≠ binding slot**. agent.core 是 **host worker** (session DO 自身演化)，**不是** session DO 通过 binding 调用的 remote worker. 这与 v1 binding catalog 的 3 项 (`CAPABILITY_WORKER` / `HOOK_WORKER` / `FAKE_PROVIDER_WORKER`) 不在同一抽象层.
>
> Worker matrix 阶段必须**保持这层区分**，不能把 agent.core 当成 reserved binding slot.

### 3.3 `docs/templates/wrangler-worker.toml`（worker shell template）

#### 3.3.1 模板内容

```jsonc
// docs/templates/wrangler-worker.toml — template for worker matrix phase first-wave workers.
//
// Naming convention (per owner B1 Q1 + P7 §3.2):
//   - production worker:   nano-agent-{worker-name}                e.g. nano-agent-bash-core
//   - dev worker:          nano-agent-{worker-name}-dev            e.g. nano-agent-bash-core-dev
//   - spike (if needed):   nano-agent-{worker-name}-spike-{...}    (per spike namespace rules)
//
// Discipline references:
//   - All resources MUST carry nano-agent + production tag (or spike per spike rules)
//   - EXPIRATION_DATE only for spikes; production workers do NOT have one
//   - Anchor headers in all worker code MUST be lowercase (per binding-F02 + nacp-core 1.2.0 §4.1)
//
// B1 evidence consulted:
//   - binding-F01 latency baseline → cross-worker call timeout SHOULD be ≥ 100ms (10× p99 buffer)
//   - F08 DO storage value cap → workers persisting state MUST size-check before put
//   - binding-F02 lowercase header → wrangler.jsonc + worker code header constants

{
  "name": "nano-agent-{WORKER_NAME}",
  "main": "dist/worker.js",
  "compatibility_date": "{LATEST_DATE}",
  "compatibility_flags": ["nodejs_compat"],

  "vars": {
    "ENVIRONMENT": "production",
    "OWNER_TAG": "nano-agent"
  },

  // For host workers (agent.core): include DO bindings + KV/R2 bindings
  // For remote workers (bash.core / filesystem.core / context.core): may include only env vars
  // For service-binding consumers (agent.core): include `services` array

  "durable_objects": {
    "bindings": [
      // {WORKER_DO_BINDINGS}
    ]
  },

  "kv_namespaces": [
    // {WORKER_KV_BINDINGS}
  ],

  "r2_buckets": [
    // {WORKER_R2_BINDINGS}
  ],

  "d1_databases": [
    // {WORKER_D1_BINDINGS}
  ],

  "services": [
    // First-wave bindings — agent.core consumes these:
    // { "binding": "BASH_CORE", "service": "nano-agent-bash-core" },
    // { "binding": "FILESYSTEM_CORE", "service": "nano-agent-filesystem-core" },
    // { "binding": "CONTEXT_CORE", "service": "nano-agent-context-core" }
    //
    // Reserved (do NOT instantiate in worker matrix phase 1):
    // { "binding": "SKILL_CORE", "service": "nano-agent-skill-core" }  -- reserved per P7 §3.2.2
  ],

  "observability": {
    "enabled": true
  }
}
```

### 3.4 `docs/templates/composition-factory.ts`（composition factory template）

```ts
// docs/templates/composition-factory.ts — template for worker matrix phase composition factories.
//
// This template documents how a worker matrix phase first-wave worker
// SHOULD be composed using B2-B6-shipped packages.
//
// Per charter §6 Phase 1-5 + B1 evidence + P3 designs:
//   - storage adapters (P1) → wrap binding directly with size check (F08) + cursor walk (F02)
//   - fake-bash extension (P2) → use 12-pack + new text-processing.ts (F07 contract preserved)
//   - context-management (P3) → consume tier router (P3-hybrid-storage) + async-compact (P3-async-compact) + inspector facade (P3-inspector)
//   - hooks 1.0.0 (P4) → catalog 18 events, dispatch with binding-F03 latency baseline
//   - nacp 1.2.0 (P5) → 2 new context.compact.* kinds; lowercase headers (binding-F02)

import { R2Adapter, KvAdapter, DOStorageAdapter, D1Adapter } from "@nano-agent/storage-topology";
import { TierRouter, AsyncCompactOrchestrator, InspectorFacade } from "@nano-agent/context-management";
import { CapabilityRuntime } from "@nano-agent/capability-runtime";
import { HookDispatcher } from "@nano-agent/hooks";
// ... etc

export interface WorkerCompositionFactoryConfig {
  readonly workerName: "agent.core" | "bash.core" | "filesystem.core" | "context.core";
  readonly env: WorkerRuntimeEnv;
  readonly compactPolicy?: CompactPolicy;  // per-session override
}

export function composeWorker(config: WorkerCompositionFactoryConfig): WorkerSubsystems {
  // Each first-wave worker consumes a different subset; this template
  // shows the maximal "agent.core host" composition.

  const r2 = new R2Adapter(config.env.R2_ARTIFACTS);
  const kv = new KvAdapter(config.env.KV_CONFIG);
  const doStorage = new DOStorageAdapter(/* state.storage */);

  const tierRouter = new TierRouter(/* ... */);
  const asyncCompact = new AsyncCompactOrchestrator({
    sessionUuid: /* ... */,
    storage: doStorage,
    kv,
    llmProvider: /* ... */,
    hooks: /* ... */,
    tierRouter,
    compactPolicy: config.compactPolicy,
  });

  // ... etc

  return { /* subsystems */ };
}

// Notes for first-wave workers:
//
// agent.core (host):       full composition; includes asyncCompact, capability runtime, hooks dispatcher, etc.
// bash.core (remote):      capability runtime; receives hooks events via cross-worker dispatch
// filesystem.core (remote): r2 + do + kv + d1 adapters; tierRouter
// context.core (remote):   asyncCompact + tierRouter + inspectorFacade
//
// Reserved: skill.core — do not compose in worker matrix phase 1.
```

---

## 4. Binding Catalog Evolution Policy

### 4.1 V1 catalog status (do not modify in P7)

Per `packages/session-do-runtime/src/env.ts:73-77`:
- `CAPABILITY_WORKER` (active in v1)
- `HOOK_WORKER` (active in v1)
- `FAKE_PROVIDER_WORKER` (active in v1; for P5 golden path / smoke tests)
- `SKILL_WORKERS` (reserved in v1; per `RESERVED_BINDINGS`)

P7 **does not modify** these. Charter §4.1 H 第 32 项 explicitly says: "**不修改** `env.ts` 的 `V1_BINDING_CATALOG` 与 `wrangler.jsonc` 的现有 3 binding；除非 spike Round 2 真的暴露 v1 catalog 的不可用 gap".

### 4.2 If Round 2 (P6) reveals v1 catalog gap → escalation policy

If P6 Round 2 closure reveals that v1 `CAPABILITY_WORKER` / `HOOK_WORKER` / `FAKE_PROVIDER_WORKER` semantics are inadequate for the 4-worker first-wave (e.g., latency budget violated, or naming collides with `bash.core` semantics), then:

1. P7 handoff memo §4 (Hard Contract Requirements) MUST surface the gap explicitly
2. Worker matrix phase 0 design MUST address it (likely via v1 → v2 binding catalog migration)
3. P7 itself does NOT propose v2 catalog; that's worker matrix's call

### 4.3 V1 → next-phase mapping proposal (informative, not normative)

| V1 binding (current) | Proposed mapping in worker matrix phase | Why |
|---|---|---|
| `CAPABILITY_WORKER` | could rename to `BASH_CORE` (or coexist) | semantic alignment with worker naming proposal §3.2 |
| `HOOK_WORKER` | likely retired; hooks dispatch becomes intra-worker for class A/B/C events; cross-worker class D events use different mechanism (e.g., direct service binding to context.core) | binding-F03 viability + P4 catalog reality |
| `FAKE_PROVIDER_WORKER` | preserved (P5 golden path / smoke needs) | P5 deploy smoke design |
| `SKILL_WORKERS` (reserved) | rename to `SKILL_CORE` if/when product demands | charter §12.2 |
| (NEW) `FILESYSTEM_CORE` | new binding for filesystem.core worker | per first-wave proposal |
| (NEW) `CONTEXT_CORE` | new binding for context.core worker | per first-wave proposal + Opus v2 §7.4 upgrade |

> **Critical**: this table is **informative only** for handoff memo. Worker matrix phase decides actual catalog.

---

## 5. 关键决策与证据链

### 5.1 决策：P7 不修改任何 packages/ 代码

**Evidence**: charter §4.1 H 第 32 项 explicit; charter §4.2 第 2 项 (worker matrix shell out-of-scope); GPT review §2.2 修订.

**Decision**: P7 仅产生 docs/ 与 docs/templates/ 文件; `packages/` 与 `spikes/` 都不变; 0 source code commits in P7.

### 5.2 决策：4 first-wave worker proposal (含 context.core upgrade)

**Evidence**:
- charter §12.1 (4 first-wave workers)
- charter §1.4 (context.core upgrade per Opus eval v2 §7.4)
- Opus v2 §7.4: "context.core 升格为 worker matrix first-wave worker — 异步压缩的 isolation 边界要求独立 worker"

**Decision**: §3.2.1 表 — agent.core / bash.core / filesystem.core / context.core 全部 first-wave; skill.core reserved.

### 5.3 决策：agent.core ≠ binding slot (host worker, not remote)

**Evidence**: GPT review §2.2 修订: "agent.core 是 host worker，不是被 host 消费的 remote binding"; charter §4.1 H 第 34 项 "**agent.core 不是 binding 名额**".

**Decision**: §3.2.3 critical distinction explicitly documented in handoff memo + worker naming proposal.

### 5.4 决策：6 handoff findings 必须在 handoff memo §2 表中

**Evidence**: B1-handoff-to-B2-B6.md §B8 lists 6 findings; each has specific worker matrix phase usage.

**Decision**: §3.1.2 required table; each row has Round 2 verdict (filled when P6 closes) + worker matrix usage.

### 5.5 决策：binding-F01 latency baseline drives cross-worker call timeout default

**Evidence**: binding-F01 — service binding p50=5ms / p99=7ms / 10 concurrent in 12ms wallclock.

**Decision**: handoff memo §4 Hard Contract Requirements + composition factory template comment 推荐 default cross-worker call timeout ≥ **100 ms** (10× p99 safety margin).

### 5.6 决策：binding-F03 latency baseline supports P4 catalog 18 events cross-worker dispatch

**Evidence**: binding-F03 — cross-worker hook callback p50=4ms / blocking 1.5s viable / structured 500 body.

**Decision**: handoff memo §4 cite binding-F03 as viability evidence for P4 catalog 18 events when dispatched cross-worker; worker matrix phase can plan with confidence.

### 5.7 决策：F07 confirms bash.core can ship with current 12-pack as starting point

**Evidence**: F07 — 3/3 capability-parity contracts hold (mkdir partial-no-directory-entity / `/_platform/**` reserved / rg cap).

**Decision**: handoff memo §2 cite F07 as "bash.core 可直接 wrap 12-pack + B3 extension 启动，无需重新设计 handler contract".

### 5.8 决策：F04 + F05 confirm context.core / filesystem.core 可信 storage backbone

**Evidence**:
- F04 — DO storage transaction 3 scenarios all pass
- F05 — MemoryBackend basic K/V parity confirmed (size cap diff per F08)

**Decision**: handoff memo §2 cite F04/F05 as "DO storage 是 context.core async-compact committer 与 filesystem.core mount router 可信 backbone"; worker matrix phase 可放心用 DO storage as primary substrate.

### 5.9 决策：F01 confirms filesystem.core 可在 ≤ 10 MiB R2 single-call 范围内不需 multipart 设计

**Evidence**: F01 — 1 KiB-10 MiB single-call put all succeeded.

**Decision**: handoff memo §2 cite F01 as "filesystem.core 在 ≤ 10 MiB 范围用 R2.put 直接 wrap; 无需 explicit multipart upload API; 大于 10 MiB 留给 follow-up".

### 5.10 决策：Round 2 closure 是 P7 启动硬前置

**Evidence**: P6 design §6.8: "Round 2 verdicts 全部 transition (no `still-open`) → P7 starts".

**Decision**:
- P7 action plan (B8) 起草前必须 confirm B7 (`B7-final-closure.md`) 已 ship + 13+2 finding 全部 transitioned
- handoff memo §7 直接 reference B7 final closure 中的 verdict 表
- 如果有 `still-open` finding → P7 必须列入 §9 Open Issues at Handoff，明确承担条件

---

## 6. 与 charter / spec / spike findings 对应关系

| Charter §6 Phase 7 + §11.1 in-scope | 实现位置 | Evidence |
|---|---|---|
| Service binding 名额预留（4 first-wave + 1 reserved） | §3.2 + §4 (informative table) | charter §4.1 H 第 32 项 (no modify) + §3.2 proposal-only |
| `docs/handoff/next-phase-worker-naming-proposal.md` 输出（不冻结） | §3.2 全部 | charter §4.1 H 第 33 项 |
| `docs/handoff/after-foundations-to-worker-matrix.md` 输出 | §3.1 全部 | charter §4.1 H 第 34 项 + §11.1 第 8 项 |
| context.core 升格为 first-wave worker | §3.2.1 第 4 行 | charter §1.4 + Opus v2 §7.4 |
| agent.core 是 host worker 不是 binding 名额 | §3.2.3 + §5.3 | charter §4.1 H 第 34 项 + GPT §2.2 |
| `docs/templates/wrangler-worker.toml` | §3.3 | charter §14 §附 A 第 5 项 |
| `docs/templates/composition-factory.ts` | §3.4 | same |
| 不修改 packages/ 任何代码 | §5.1 | charter §4.2 + §4.1 H |
| Round 2 closure 前置 | §5.10 | P6 design §6.8 + charter §11.1 第 1 项 |

---

## 7. 不在本 design 决策的事项

1. Worker matrix 阶段 4 worker 的具体 shell 实现 → next phase
2. V1 → V2 binding catalog migration 的具体接口签名 → next phase
3. `skill.core` 是否拆分为多个细 worker (browser/search/scrape) → product demand 出现时再 design
4. Production deployment topology / blue-green / canary → post-worker-matrix
5. Cross-region routing → post-worker-matrix
6. RBAC / OAuth / billing / tenant ops → post-worker-matrix
7. UI / dashboard for inspector facade → out-of-scope per charter §4.2

---

## 8. 收口标准（Exit Criteria）

本 design 的成立标准：

1. ✅ §3.1 handoff memo 必填 10 章节定义清楚
2. ✅ §3.1.2 6 handoff findings 表结构定义 (verdict 列由 P6 Round 2 closure 填)
3. ✅ §3.2 4 first-wave proposal + 1 reserved 标注清楚
4. ✅ §3.2.3 agent.core ≠ binding slot 显式 distinction
5. ✅ §3.3 wrangler.toml 模板 (含 binding-F02 + F08 + binding-F01 evidence comment)
6. ✅ §3.4 composition factory 模板 (含 B2-B6 packages import + first-wave 注释)
7. ✅ §4 binding catalog evolution policy (do-not-modify default + escalation path)
8. ✅ §5 10 个关键决策每个绑定 B1 finding / charter / GPT review 修订
9. ⏳ B8 action plan 引用本 design 写出 handoff 撰写批次
10. ⏳ B7 (Round 2) closure (`B7-final-closure.md`) 是 B8 启动硬前置
11. ⏳ handoff memo §7 verdict 表填完后 P7 ship final closure

---

## 9. References

- Charter §6 Phase 7 + §7.8 + §11 + §12: `docs/plan-after-foundations.md`
- Sibling design (P6 Round 2): `docs/design/after-foundations/P6-spike-round-2-integration-plan.md`
- Worker matrix eval thread:
  - `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`
  - `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`
  - `docs/eval/after-foundations/before-worker-matrix-eval-with-GPT.md`
  - `docs/eval/after-foundations/before-worker-matrix-eval-with-Opus.md` §8
- Context.core upgrade source: `docs/eval/after-foundations/context-management-eval-by-Opus.md` v2 §7.4
- B1 final closure: `docs/issue/after-foundations/B1-final-closure.md`
- B1 handoff to B2-B6: `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` (model for P7 handoff style)
- All 15 B1 finding docs: `docs/spikes/`
- B2-B6 designs + RFCs (full list in P6 frontmatter)
- V1 binding catalog source: `packages/session-do-runtime/src/env.ts:73-77`
- Tracking policy: `docs/issue/README.md`

---

## 10. Revision History

| Date | Author | Change |
|---|---|---|
| 2026-04-19 | Opus 4.7 | Initial draft; 4 deliverables (handoff memo + naming proposal + 2 templates); 4 first-wave workers proposal with context.core upgrade per charter §1.4; agent.core ≠ binding distinction (GPT §2.2); binding catalog do-not-modify policy (charter §4.1 H); 10 决策 each cite B1 finding / charter / eval thread |
| 2026-04-19 (r2) | Opus 4.7 | §3.1.2 handoff findings 表加 Caveats 列；binding-F03 标注 anchor path 已 r2 修复；新增 C1/C3 caveat pointer pointing to B1-final-closure §Caveats (per B1-docs-reviewed-by-GPT §R3 alignment) |
