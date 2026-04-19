# Nano-Agent After-Foundations P6 — Spike Round 2 Integration Plan

> 功能簇：`spikes/round-2-integrated/` (the second-round spike that validates B1-shipped packages)
> 讨论日期：`2026-04-19`
> 讨论者：`Opus 4.7 (1M context)`
>
> 关联调查报告（B1 finding traceability — 5 round-2 follow-ups + B2-B6 ship validation）：
>
> **5 Round-2 follow-ups (B1 explicitly deferred to round 2)**：
> - `docs/spikes/spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md` (**F03 — cross-colo / cross-region stale-read 复现**)
> - `docs/spikes/spike-do-storage/08-do-storage-value-cap-between-1mib-and-10mib.md` (**F08 — binary-search 1-10 MiB exact cap**)
> - `docs/spikes/spike-do-storage/09-curl-quota-25-fetches-no-rate-limit-default-target.md` (**F09 — high-volume probe with owner-supplied URL per Q2**)
> - `docs/spikes/spike-binding-pair/01-binding-latency-sub-10ms-and-cancellation-works.md` (**binding-F01 — wrangler tail confirm callee-side `[slow] abort observed`**)
> - `docs/spikes/unexpected/F01-r2-put-273ms-per-key-during-preseed.md` (**unexpected-F01 — R2 concurrent put 50/100/200**)
>
> **B2-B6 ship integration validation (all 13 required findings re-tested)**：
> - `docs/spikes/storage-findings.md` (storage rollup; B2 ship integrated re-test)
> - `docs/spikes/binding-findings.md` (binding rollup; B6 ship integrated re-test)
> - `docs/spikes/fake-bash-platform-findings.md` (V2 rollup; B3 ship integrated re-test)
> - `docs/spikes/_DISCIPLINE-CHECK.md` (round 1 discipline self-check; round 2 must repeat)
>
> **B1 spike infrastructure references**:
> - `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` (7 disciplines apply to round 2 too; §4.4 + §4.5 round-2 取材方式)
> - `docs/design/after-foundations/P0-spike-do-storage-design.md` (round 1 design; round 2 may extend)
> - `docs/design/after-foundations/P0-spike-binding-pair-design.md` (round 1 design; round 2 may extend)
> - `docs/templates/_TEMPLATE-spike-finding.md` (round 2 finding 模板沿用)
> - `docs/issue/after-foundations/B1-final-closure.md` (B1 全部 13 finding 列表 + 5 round-2 follow-ups summary)
>
> **B2-B6 design dependencies (must be ship before round 2 starts)**:
> - `docs/design/after-foundations/P1-storage-adapter-hardening.md` (B2)
> - `docs/rfc/scoped-storage-adapter-v2.md` (B2)
> - `docs/design/after-foundations/P2-fake-bash-extension-policy.md` (B3)
> - `docs/design/after-foundations/P3-context-management-async-compact.md` (B4)
> - `docs/design/after-foundations/P3-context-management-hybrid-storage.md` (B4)
> - `docs/design/after-foundations/P3-context-management-inspector.md` (B4)
> - `docs/design/after-foundations/PX-async-compact-lifecycle-spec.md` (B4)
> - `docs/design/after-foundations/P4-hooks-catalog-expansion.md` (B5)
> - `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md` (B6)
> - `docs/rfc/nacp-core-1-2-0.md` (B6)
> - `docs/rfc/nacp-session-1-2-0.md` (B6)
>
> 上游 charter / 模板：
> - `docs/plan-after-foundations.md` §4.1 G (Spike Round 2 in-scope) + §6 Phase 6 + §7.7 + §11.1 (Primary Exit Criteria)
> - `docs/templates/design.md`
>
> 文档状态：`draft`

---

## 0. 背景与前置约束

`spikes/round-2-integrated/` 是 after-foundations 阶段的**最终验证 gate**。它做两件事：

1. **B1 round-2 follow-ups** —— 把 B1 round-1 显式延后的 5 项验证跑透 (F03 / F08 / F09 / binding-F01 / unexpected-F01)
2. **B2-B6 ship integration validation** —— 用 ship 后的 packages (storage 2.0.0 / fake-bash 扩展 / context-management 0.1.0 / hooks 1.0.0 / nacp 1.2.0) 重跑 B1 全部 13 required validation items + 2 optional unexpected，验证 finding 真的被消化

per charter §10.3 双向 traceability + §11.1 Primary Exit Criteria 第 1 条 + 第 9 条，**Round 2 是 B1 finding 走完 `open → writeback-shipped`/`dismissed-with-rationale` 状态闭环的最后一步**。

- **项目定位回顾**：B1 round 1 是 **bare-metal probe** —— 不依赖 packages/ 运行时，仅暴露 platform truth. Round 2 是 **integrated probe** —— 接入 B2-B6 ship 后的 packages 重跑相同验证项 + 跑 B1 显式 deferred 的 5 项 follow-up.
- **本次讨论的前置共识**：
  - charter §11.1 第 1 条：spike 真相已闭合 (Round 1 + Round 2 都跑过)
  - charter §11.1 第 9 条：每个 finding 必须落入 `writeback-shipped` 或 `dismissed-with-rationale`，0 `open` 残留
  - PX-spike-discipline-and-validation-matrix §4.4: Round 2 不再独立列验证项；取 Round 1 全部 finding 的 writeback action 重测
  - PX-discipline §4.5: 13 required + 2 optional 的状态全部 transition；新发现纳入 `integrated-F*` namespace
  - PX-discipline §3.6 + §3.7: round 2 spike 与 round 1 分目录；round 2 **可以** import packages/ runtime (与 round 1 纪律 7 不同)
  - 业主 Q5 答：spike workers 可一直保留 (Round 2 可复用 Round 1 部署的 worker，按需更新代码)
- **显式排除的讨论范围**：
  - 不讨论 B2-B6 ship 的具体内容（→ 对应 P1-P5 设计 + B2-B6 action plans）
  - 不讨论 B7 之后 (worker matrix phase)
  - 不讨论新 V4 类 validation items（Round 2 取材自 Round 1 finding，不增 V4 类）
  - 不讨论 production-grade observability (out-of-scope per charter §4.2)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`spikes/round-2-integrated/`
- **一句话定义**：第二轮 spike——以 B2-B6 已 ship 的 packages 为基础，重跑 B1 全部 13 required + 2 optional finding 的验证项，并跑透 B1 显式 deferred 的 5 项 follow-up；输出 `integrated-F*` finding 把 B1 finding 状态从 `open` 推到 `writeback-shipped`/`dismissed-with-rationale`.
- **边界描述**：本设计**包含**round-2 spike 部署形态、5 follow-up validation 项、13 + 2 = 15 round-1 findings 的 integration re-validation、B2-B6 packages import 接入策略、closure verdict 路径；**不包含**B2-B6 ship 内容、新 V4 类 validation items、worker matrix phase 工作。
- **关键术语对齐**：

| 术语 | 定义 |
|---|---|
| **Round 2** | spike 第二轮，以 B2-B6 ship 后的 packages 为基础 |
| **Integrated spike** | spike 代码可 `import "@nano-agent/*"` packages runtime (与 round 1 不同) |
| **Round-2 follow-up** | B1 round-1 显式 deferred 的 5 项验证（F03 / F08 / F09 / binding-F01 / unexpected-F01） |
| **Integration re-validation** | B1 13 required + 2 optional finding 的 re-test，对每条给出 closure verdict |
| **Closure verdict** | per finding：`writeback-shipped` (packages/ 已修 + Round 2 confirms) / `dismissed-with-rationale` (重新审视后撤回) / `still-open` (residual issue → carry to worker matrix) |
| **`integrated-F*`** | round-2 finding 的命名空间 (per PX-discipline §4.4) |

### 1.2 参考调查报告

详见 frontmatter B1 findings + B2-B6 design / RFC dependencies + PX-discipline §3 / §4.

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 本子模块在整体架构里的角色：**after-foundations 阶段的最终 closure gate** —— 把 B1 finding 状态全部推到闭环，证明 B2-B6 ship 真的消化了 platform truth.
- 服务于：charter §11.1 Primary Exit Criteria 全 8 条；handoff to worker matrix phase (P7 议题)
- 依赖：B2-B6 全部 ship 完成 (这是 **hard sequencing** —— Round 2 启动条件)
- 被谁依赖：P7 worker-matrix pre-convergence（Round 2 closure 是 P7 启动的前置）；charter §11.1 第 1 条 + 第 9 条 exit gate

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `spikes/round-1-bare-metal/` (existing) | sibling, separated dir | 中 | round 1 不污染 round 2 (PX-discipline §3.6) |
| B2-B6 ship'd packages | depends on (import) | 强 | round 2 spike 可 `import "@nano-agent/*"` (PX-discipline §3.7 round 2 例外) |
| `docs/templates/_TEMPLATE-spike-finding.md` | reuses | 强 | round-2 finding docs 沿用同款 template |
| `docs/spikes/spike-do-storage/` + `docs/spikes/spike-binding-pair/` | updates | 强 | 13+2 finding 文件 §0 status 由 round-2 推动 transition |
| `docs/spikes/_DISCIPLINE-CHECK.md` | extends | 中 | round-2 自检独立报告 `_DISCIPLINE-CHECK-round-2.md` |
| `docs/issue/after-foundations/B7-*.md` (this phase's closure issues) | produces | 强 | round-2 closure issue 系列 |
| `docs/handoff/after-foundations-to-worker-matrix.md` (P7 deliverable) | feeds into | 强 | round-2 closure verdicts 是 handoff memo 的输入 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Round 2 integrated spike` 是 **after-foundations 阶段的 closure gate** —— 用 B2-B6 ship 后的 packages 重跑 B1 全部 finding + 跑透 5 项 round-2 follow-up，把 13 required + 2 optional finding 状态推到 `writeback-shipped` 或 `dismissed-with-rationale`，对上游 charter §11.1 第 1+9 条 exit criteria 提供 evidence，对下游为 P7 worker-matrix pre-convergence 提供 handoff input.

---

## 3. Round 2 Spike 部署形态

### 3.1 目录结构

```
spikes/
├── round-1-bare-metal/                         (B1 ship; do not modify)
│   ├── spike-do-storage/                       (live worker, Round 2 may co-deploy新版本)
│   └── spike-binding-pair/                     (live workers, Round 2 may co-deploy)
└── round-2-integrated/                         (THIS DESIGN ships)
    ├── spike-do-storage-r2/
    │   ├── wrangler.jsonc                      (separate worker name: nano-agent-spike-do-storage-r2)
    │   ├── package.json                        (imports @nano-agent/storage-topology@^2.0.0, etc.)
    │   ├── tsconfig.json
    │   ├── src/
    │   │   ├── worker.ts                       (新增 5 follow-up routes + 9 re-validation routes)
    │   │   ├── do/IntegratedProbeDO.ts         (now uses real DOStorageAdapter from @nano-agent/storage-topology)
    │   │   ├── follow-ups/                     (5 round-2 follow-up probes)
    │   │   │   ├── kv-cross-colo-stale.ts      (F03 follow-up)
    │   │   │   ├── do-size-cap-binary-search.ts (F08 follow-up)
    │   │   │   ├── curl-high-volume.ts         (F09 follow-up; uses owner-supplied URL per Q2)
    │   │   │   └── r2-concurrent-put.ts        (unexpected-F01 follow-up)
    │   │   ├── re-validation/                  (9 + 2 = 11 round-1 finding re-test probes)
    │   │   │   └── …                           (mirror Round 1 probes but route through B2-B6 packages)
    │   │   └── result-shape.ts                 (extends Round 1 ProbeResult with `verdictForFinding` field)
    │   └── scripts/                            (deploy / run-all / extract-finding similar to Round 1)
    └── spike-binding-pair-r2/
        ├── worker-a-r2/                        (named: nano-agent-spike-binding-pair-a-r2)
        ├── worker-b-r2/                        (named: nano-agent-spike-binding-pair-b-r2)
        └── scripts/
            └── …                               (binding-F01 callee-side abort follow-up + 4 V3 re-validation)
```

### 3.2 Worker naming convention

Per owner Q1 (nano-agent + spike dual-tag) + round-2 differentiation:

| Worker (Round 2) | Name |
|---|---|
| spike-do-storage-r2 | `nano-agent-spike-do-storage-r2` |
| spike-binding-pair worker-a r2 | `nano-agent-spike-binding-pair-a-r2` |
| spike-binding-pair worker-b r2 | `nano-agent-spike-binding-pair-b-r2` |

Round 1 workers can either be retired (per owner Q5: at owner discretion) or kept for comparison. Round 2 workers carry their own `EXPIRATION_DATE` (recommend `2026-09-01` — 1 month after Round 1 default).

### 3.3 Resource isolation

Round 2 uses **separate** KV namespace / R2 bucket / D1 database from Round 1 to avoid contamination of round-1 captured results:
- `nano-agent-spike-do-storage-r2-kv` (NEW)
- `nano-agent-spike-do-storage-r2-probe` (R2 NEW)
- `nano_agent_spike_do_storage_r2_d1` (D1 NEW; region same as Round 1 default)

---

## 4. 5 Round-2 Follow-Ups (B1 explicit deferred items)

### 4.1 F03 — KV cross-colo stale-read

**B1 finding source**: `docs/spikes/spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md` §5.2 + §7.2 — explicitly states "Round 2 必须复现"; can dismiss only via cross-colo probe.

**Round-2 strategy**:
- Spike-do-storage-r2 deployed in **multiple region** (use `wrangler deploy --env eu` etc. if account allows; otherwise probe via Cloudflare's network with `cf-region` headers to force routing)
- Write key in colo A; read from colo B (force via different request origin headers or different route)
- Run 100+ samples per delay bucket [0, 50, 100, 250, 500, 1000, 2000, 5000] ms

**Acceptance criteria for F03 verdict**:
- If 100% fresh across colos → F03 verdict = `dismissed-with-rationale` ("KV cross-colo strong observed; no packages/ change needed beyond JSDoc; finding closure")
- If any stale observed → F03 verdict = `writeback-shipped` (forces packages/ change: ScopedStorageAdapter add `freshness` enum field, `KvAdapter.readFresh()` API)

### 4.2 F08 — DO size cap binary-search 1-10 MiB

**B1 finding source**: `docs/spikes/spike-do-storage/08-do-storage-value-cap-between-1mib-and-10mib.md` §5 + §10 acceptance — explicitly requires binary-search probe.

**Round-2 strategy**:
- Binary search inside `[1 MiB, 10 MiB]`: probe at 2 / 4 / 6 / 8 MiB; narrow range to ±0.5 MiB; final precision target **±0.25 MiB**
- For each size, attempt `state.storage.put(key, Uint8Array(size))` × 3 samples to guard against flake
- Report exact `MAX_VALUE_BYTES_DO` value found

**Acceptance criteria for F08 verdict**:
- Always: F08 verdict = `writeback-shipped` (packages/ already changed: DOStorageAdapter `maxValueBytes` config from default 1 MiB → updated default per measured cap with 20% safety margin)
- Update `docs/rfc/scoped-storage-adapter-v2.md` §3.6 with measured cap

### 4.3 F09 — curl high-volume with owner-supplied URL

**B1 finding source**: `docs/spikes/spike-do-storage/09-curl-quota-25-fetches-no-rate-limit-default-target.md` §5 + §7 — explicitly states "Round 2 高 volume" 与 "owner-supplied URL per Q2".

**Round-2 strategy**:
- Prompt owner via Q2 follow-up: provide preferred test URL (likely owner's own backend per Q2 answer)
- Probe count escalation: 50 / 100 / 200 / 500 / 1000 outbound fetches per turn
- Capture rate-limit triggers (HTTP 429 / Cloudflare-level subrequest limit error)
- Confirm Cloudflare paid-plan subrequest limit (1000 per worker invocation per Cloudflare docs)

**Acceptance criteria for F09 verdict**:
- F09 verdict = `writeback-shipped` (packages/ change: `capability-runtime/src/capabilities/network.ts` curl handler default `perTurnSubrequestBudget` calibrated against measured limit; per P2 design §4.3)

### 4.4 binding-F01 — callee-side abort propagation

**B1 finding source**: `docs/spikes/spike-binding-pair/01-binding-latency-sub-10ms-and-cancellation-works.md` §1.3 + §5 — explicitly states "wrangler tail confirm `[slow] abort observed`".

**Round-2 strategy**:
- Re-deploy spike-binding-pair-r2 with worker-b's `slow.ts` handler instrumented with `console.log(...)` lines that explicitly mark `[slow] abort observed t=Xms`
- Run cancellation probe (caller aborts at 300ms; callee sleep 5000ms)
- Capture worker-b wrangler tail output via `wrangler tail nano-agent-spike-binding-pair-b-r2 --format json` during the probe
- Extract abort observation timestamp from log

**Acceptance criteria for binding-F01 verdict**:
- If `[slow] abort observed` appears in worker-b log within 300ms of caller abort → binding-F01 verdict = `writeback-shipped` (callee-side abort propagation confirmed; documents in handoff memo)
- If callee continues running full 5000ms despite caller abort → binding-F01 verdict = `still-open` + raise as worker-matrix-phase concern (cross-worker cancellation timeout design needs adjustment)

### 4.5 unexpected-F01 — R2 concurrent put

**B1 finding source**: `docs/spikes/unexpected/F01-r2-put-273ms-per-key-during-preseed.md` §5 — Round 2 concurrent put 50/100/200 probe.

**Round-2 strategy**:
- Use `R2Adapter.putParallel(items, { concurrency })` from B2 ship
- Run concurrency = 10 / 50 / 100 / 200 with 50 keys each
- Measure wallclock; compare against round-1 sequential 273ms/key baseline (50 keys = 13.67s)
- Detect rate-limit / 429 if Cloudflare R2 imposes concurrent put limit

**Acceptance criteria for unexpected-F01 verdict**:
- If concurrency = 50 yields > 10× speedup vs sequential → unexpected-F01 verdict = `writeback-shipped` (default putParallel concurrency calibrated; documented)
- If concurrency = 200 triggers rate-limit → record in finding; default config caps concurrency at last-safe value

---

## 5. Integration Re-Validation (B1 全部 13+2 finding re-test)

### 5.1 Re-validation 路由分类

| Round 1 finding | Re-test routes through (B2-B6 packages) |
|---|---|
| **F01** (R2 multipart ≤ 10 MiB) | `R2Adapter.put` (P1 ship) |
| **F02** (R2 list cursor) | `R2Adapter.list` + `R2Adapter.listAll` (P1 ship) |
| **F03** (KV stale-read) | covered by §4.1 follow-up |
| **F04** (DO transactional) | `DOStorageAdapter.transaction` (P1 ship) |
| **F05** (Memory vs DO parity) | `MemoryBackend` (with `maxValueBytes` config from B2 ship) vs `DOStorageAdapter` |
| **F06** (D1 cross-query rejected) | `D1Adapter.batch` (P1 ship; verify `beginTransaction` API NOT exposed) |
| **F07** (V2A capability-parity 3/3) | `capability-runtime` 12-pack handlers (B3 ship; verify F07 contract still holds post-extension) |
| **F08** (DO size cap) | covered by §4.2 follow-up + `DOStorageAdapter.put` size pre-check + `MemoryBackend.put` mirror |
| **F09** (curl quota) | covered by §4.3 follow-up + `capability-runtime/network.ts` curl handler with budget |
| **binding-F01** (latency + cancel) | covered by §4.4 follow-up |
| **binding-F02** (anchor lowercase) | re-send 6 anchor headers; verify packages/ constants are lowercase + cross-binding propagation works |
| **binding-F03** (hooks-callback) | hook dispatch with new 18-event catalog (B5 ship); verify cross-worker dispatch still p50 < 10ms |
| **binding-F04** (eval-fanin dedup) | `SessionInspector` (post-B6 dedup ship); send 3× same messageUuid; verify sink contains 1 |
| **unexpected-F01** (R2 concurrent put) | covered by §4.5 follow-up |
| **unexpected-F02** (KV write 520ms) | `KvAdapter.putAsync` (P1 ship); compare hot-path latency vs sync |

### 5.2 Verdict transition rules

For each Round-1 finding, Round 2 emits a verdict per `_TEMPLATE-spike-finding.md` §0 status field:

```
Round-1 status: open
                ↓
                (Round 2 re-validates with B2-B6 ship'd packages)
                ↓
        ┌───────┼───────┐
        ↓       ↓       ↓
writeback   dismissed  still-open
-shipped    -with-     (residual;
            rationale  carry to next
                       phase)
```

Round-2 verdicts are appended to Round-1 finding doc §8 修订历史 + a new §0 status update.

### 5.3 Round-2 finding namespace

New findings discovered during Round 2 (e.g., a packages/ ship has bug not seen in Round 1) are written under `docs/spikes/round-2-integrated/spike-do-storage-r2/` (or equivalent for binding-pair). Naming: `integrated-F{NN}-{slug}.md`.

---

## 6. 关键决策与证据链

### 6.1 决策：Round 2 spike 与 Round 1 物理隔离

**Evidence**: PX-discipline §3.6 (round-1 / round-2 分目录互不污染); B1 round 1 captured outputs preserved as historical baseline.

**Decision**:
- Round 2 spike 用 separate worker names (`-r2` suffix)
- Round 2 spike 用 separate KV/R2/D1 namespace
- Round 1 workers / outputs / finding docs 不修改 (历史 baseline)

### 6.2 决策：Round 2 spike **可** `import "@nano-agent/*"` packages

**Evidence**: PX-discipline §3.7 (Round 1 不依赖 packages/ runtime; **Round 2 例外，必须** import ship 后的 packages 来验证 finding 已被消化).

**Decision**:
- Round 2 spike workers `package.json` 含 `"@nano-agent/storage-topology": "^2.0.0"`, `"@nano-agent/context-management": "^0.1.0"`, etc. as runtime deps
- Round 2 spike 代码 `import { R2Adapter } from "@nano-agent/storage-topology"` 等
- 这是与 Round 1 唯一的纪律差异；其余 6 条纪律 (1, 2, 3, 4, 5, 6) round-2 仍 strict

### 6.3 决策：5 follow-ups 顺序为业主可参与的优先

**Evidence**: F09 needs owner Q2 URL (synchronous owner involvement); F03 cross-colo may need account-level region setup; F08/F01/unexpected-F01 are agent-runnable.

**Decision**: Round 2 sub-phases:
- **R2.1 — agent-runnable** (parallel): F08 binary-search + binding-F01 wrangler-tail observation + unexpected-F01 R2 concurrent
- **R2.2 — owner-input required**: F09 high-volume with owner URL; F03 cross-colo (may need owner to provision EU env or accept limitation)
- **R2.3 — re-validation 11 + 2 = 13 routes**: agent-runnable; sequential

### 6.4 决策：Round 2 finding namespace `integrated-F{NN}` separate from `unexpected-F*`

**Evidence**: B1 round-1 has 2 unexpected findings under `docs/spikes/unexpected/`. Round 2 may also discover unexpected platform truths (e.g., a B2-shipped adapter has bug). Need separate namespace to avoid confusion with round-1 unexpected.

**Decision**:
- New round-2-only findings → `docs/spikes/round-2-integrated/{spike-name}/integrated-F{NN}-{slug}.md`
- Round-1 follow-up findings (F03 / F08 / F09 / binding-F01 / unexpected-F01) → 在原 finding doc §8 加 round-2 closure section + update §0 status; 不创建新 doc（finding ID 复用，避免 ID 通胀）

### 6.5 决策：Round 2 closure issue 系列以 `B7-*` 命名

**Evidence**: charter §14.2 action plan list — B7 = Round 2 spike action plan; sub-phase closure issues should match.

**Decision**:
- `docs/issue/after-foundations/B7-phase-1-closure.md` (R2.1 closure)
- `docs/issue/after-foundations/B7-phase-2-closure.md` (R2.2 closure)
- `docs/issue/after-foundations/B7-phase-3-closure.md` (R2.3 re-validation closure)
- `docs/issue/after-foundations/B7-final-closure.md` (overall Round 2 closure with all verdict transitions documented)

### 6.6 决策：Round 2 必须自己跑 _DISCIPLINE-CHECK

**Evidence**: PX-discipline §3 7 disciplines apply; Round 1 ran self-check; Round 2 must too.

**Decision**:
- `docs/spikes/_DISCIPLINE-CHECK-round-2.md` shipped after Round 2 completes
- Same 7 sections; nuance §3.7 to acknowledge "Round 2 imports packages/ runtime per design exception"
- 6/7 hold + 1 modified (§3.7 round-2-specific)

### 6.7 决策：F03 cross-colo failure → upgrade severity, ship breaking

**Evidence**: `spike-do-storage-F03` §5.3 + §5 explicit ("if Round 2 暴露 stale, F03 升级为 high + breaking change").

**Decision**:
- If Round 2 F03 follow-up reveals cross-colo stale → `KvAdapter` API extension (post-B7): add `readFresh(key)` method that bypasses KV cache via DO storage ground-truth round-trip
- This is a **non-breaking addition** for adapter consumers (existing `get` continues), but **upgrades** F03 severity from `medium` to `high` and adds a breaking note in `nacp-core 1.2.0` §4.3 spec
- charter §11.2 secondary-outcome accommodation: this may necessitate `storage-topology 2.1.0` minor bump

### 6.8 决策：Round 2 exit gate triggers P7 worker-matrix pre-convergence

**Evidence**: charter §11.1 第 1 条 + 第 9 条 + §6 Phase 6→7 sequencing.

**Decision**:
- Round 2 verdicts全部 transition (no `still-open`) → P7 (`worker-matrix-pre-convergence.md`) starts
- Round 2 leaves any `still-open` finding → must be either escalated as worker-matrix-phase blocker OR explicitly dismissed-with-rationale before P7
- Round 2 final closure issue (`B7-final-closure.md`) is the input to `docs/handoff/after-foundations-to-worker-matrix.md`

---

## 7. Acceptance Criteria

Round 2 closure (B7 final) requires:

- [ ] R2.1, R2.2, R2.3 all sub-phases closed
- [ ] 5 round-2 follow-ups (F03 / F08 / F09 / binding-F01 / unexpected-F01) each have closure verdict
- [ ] 13 required B1 findings each transition to `writeback-shipped` or `dismissed-with-rationale` or explicit `still-open` with worker-matrix escalation note
- [ ] 2 optional unexpected-F* findings same treatment
- [ ] Round 2 spike workers deployed (separately from Round 1)
- [ ] `docs/spikes/_DISCIPLINE-CHECK-round-2.md` 6/7 ✅ + 1 modified (§3.7)
- [ ] `docs/issue/after-foundations/B7-final-closure.md` ship
- [ ] All B1 finding docs §0 status updated + §8 history extended with round-2 closure section
- [ ] Any `integrated-F{NN}` new findings shipped under `docs/spikes/round-2-integrated/`
- [ ] Charter §11.1 第 1 条 (spike 真相已闭合) + 第 9 条 (closure ritual) signed off

---

## 8. Out of Scope

- New V4 validation classes (Round 2 取材自 Round 1 finding only)
- Worker matrix phase work (→ P7 + Phase 8)
- Production-grade observability (out-of-scope per charter §4.2)
- B2-B6 ship 内容修改 (→ B2-B6 action plans; Round 2 only validates)
- Cross-account spike (业主 only has 1 paid account per Q1)

---

## 9. References

- Charter §6 Phase 6 + §7.7 + §11.1: `docs/plan-after-foundations.md`
- PX spike discipline + validation matrix: `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md`
- Round 1 design (storage): `docs/design/after-foundations/P0-spike-do-storage-design.md`
- Round 1 design (binding-pair): `docs/design/after-foundations/P0-spike-binding-pair-design.md`
- B1 final closure (full finding inventory): `docs/issue/after-foundations/B1-final-closure.md`
- B1 handoff (mapping to B2-B6): `docs/issue/after-foundations/B1-handoff-to-B2-B6.md`
- Sibling design (P7 handoff): `docs/design/after-foundations/P7-worker-matrix-pre-convergence.md`
- All 15 B1 finding docs: `docs/spikes/spike-do-storage/`, `docs/spikes/spike-binding-pair/`, `docs/spikes/unexpected/`
- Tracking policy: `docs/issue/README.md`

---

## 10. Revision History

| Date | Author | Change |
|---|---|---|
| 2026-04-19 | Opus 4.7 | Initial draft; 5 follow-ups (F03/F08/F09/binding-F01/unexpected-F01) per-finding strategy + acceptance; 13+2 re-validation 路由表; PX-discipline §3.7 round-2 example; verdict transition rules; B7 closure issues 系列 |
