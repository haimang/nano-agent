# Nano-Agent After-Foundations P0 — Spike Discipline & Validation Matrix

> 功能簇：`Spike Discipline & Validation Matrix`
> 讨论日期：`2026-04-19`
> 讨论者：`Opus 4.7 (1M context)`
> 关联调查报告：
> - `docs/plan-after-foundations.md` （特别是 §1.1 / §2.2 / §4.1 A / §5.1 / §7.1）
> - `docs/eval/after-foundations/before-worker-matrix-eval-with-Opus.md` （§4.3 + §6.2 + §8.5.3）
> - `docs/eval/after-foundations/before-worker-matrix-eval-with-GPT.md` （§4 + §6）
> - `docs/eval/after-foundations/context-management-eval-by-Opus.md` v2 （§7.3）
> - `docs/templates/_TEMPLATE-spike-finding.md`
> 文档状态：`draft`

---

## 0. 背景与前置约束

After-foundations 阶段是 worker matrix 之前的一道 spike-driven validation gate。其核心方法论是：**用 disposable Cloudflare workers 在真实 platform 暴露 packages/ 现有 typed seams 与真实 runtime 的差异，然后基于真相 ship 5 类代码**。这条主线的前提，是 spike 必须**严守纪律**——否则它会迅速退化为"事实上的 product worker"，从而破坏自身的方法论价值。

本文件做两件事：

1. **冻结 spike discipline**：把 disposable probe 的 7 条纪律写成本阶段的 owner-aligned policy
2. **冻结 validation matrix**：把 §2.2 的 12 项 platform 验证项写成可以指派、可以评分、可以追溯写回的明确 list

- **项目定位回顾**：nano-agent 是 Cloudflare Worker / Durable Object / WebSocket-first 形态的极精简 agent runtime；本阶段不展开 Linux / shell / 本地 FS 等 host-bound 语义，所有 spike 都必须以 Cloudflare Workers / DO / KV / R2 / D1 / service binding 为真相载体。
- **本次讨论的前置共识**：
  - `packages/` 当前已有 8 个 foundations 包，但 default runtime assembly 仍 partial（详见 plan-after-foundations §2.1 修订表）
  - 未经 spike 验证的 packages/ 假设不能进入 worker matrix
  - spike 是 disposable，不是 product seed
  - spike 必须 ship code（non-trivial workers），但代码本身**不**进 packages/ 主线
  - 本阶段必须输出 finding docs + writeback actions，不只是部署 spike 然后扔掉
- **显式排除的讨论范围**：
  - 不讨论 worker matrix 阶段的最终 worker shell 设计
  - 不讨论 production observability / dashboard
  - 不讨论 spike 之外的 packages 内部实现细节（那是 P1-P5 的工作）

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Spike Discipline & Validation Matrix`
- **一句话定义**：本功能簇是 after-foundations 阶段的**顶层方法论冻结**——它定义了 spike worker 必须遵守的 7 条纪律、12 项必须验证的 Cloudflare 真相、以及每项验证如何被消化回 packages/ 的双向 traceability 规则。
- **边界描述**：本功能簇**包含** spike 纪律、validation 验证项目录、finding 模板配套规则、writeback 判定标准、与 charter / phase 的关系；**不包含**两个 spike worker 的具体设计（那是 P0-spike-do-storage-design / P0-spike-binding-pair-design 的范围）。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|---|---|---|
| **Spike** | 在真实 Cloudflare 环境部署的 disposable worker，专门用于暴露本地测试无法证明的 platform 真相 | 有 expiration date，不接 CI 主线 |
| **Round 1 (bare-metal)** | 不依赖 packages/ 运行时实现的 spike 一轮 | 直接调 Cloudflare 原生 API，验证 platform truth |
| **Round 2 (integrated)** | 接入 P1-P5 ship 后的 packages 重跑 e2e 的 spike 二轮 | 验证 ship 的代码是否消化了 Round 1 的真相 |
| **Validation Item** | charter §2.2 + 本文 §4 列出的 12 项 platform 待验证事实之一 | 每项必须产生至少 1 条 finding doc |
| **Finding** | 用 `_TEMPLATE-spike-finding.md` 写的、指向 packages/ 影响的发现 | finding 是 spike 的唯一 ship-value |
| **Writeback** | 把 finding 消化回 packages/ 修改 / contract test / design doc 修订的动作 | 没有 writeback 的 finding 是 spike-truth 与 package-truth 双轨漂移的种子 |

### 1.2 参考调查报告

- `docs/eval/after-foundations/before-worker-matrix-eval-with-Opus.md` —— §4.3 spike 5 条纪律、§8.5.3 补 2 条
- `docs/eval/after-foundations/before-worker-matrix-eval-with-GPT.md` —— §6 spike 形态推荐
- `docs/eval/after-foundations/context-management-eval-by-Opus.md` v2 —— §7.3 新增第三类 spike-context-loop（已合并到 §4 矩阵）

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 本功能簇在整体架构里扮演的角色：**after-foundations 阶段的 owner-aligned policy 与 truth-source matrix**。
- 它服务于：所有 P1-P5 的 ship-code 工作 + Phase 6 的 integrated validation + Phase 7 的 handoff。
- 它依赖：plan-after-foundations charter 已冻结的边界与方法论。
- 它被谁依赖：P0-spike-do-storage-design、P0-spike-binding-pair-design、Phase 6 integrated spike design。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `P0-spike-do-storage-design` | 输出 → 输入 | 强 | 本文 §4.1 storage 6 项 + §4.2 bash 2 项验证由该 design 实现 |
| `P0-spike-binding-pair-design` | 输出 → 输入 | 强 | 本文 §4.3 binding 4 项验证由该 design 实现 |
| Phase 1-5 ship-code phases | 输出 finding → 输入 ship spec | 强 | finding writeback 是 ship code 的输入之一 |
| Phase 6 integrated spike | 输入 ← finding 全集 | 强 | Round 2 必须验证所有 Round 1 finding 已被消化 |
| `_TEMPLATE-spike-finding.md` | 配套 | 强 | 模板字段与本文 §5 writeback 规则一一对应 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Spike Discipline & Validation Matrix` 是 after-foundations 阶段的**顶层方法论合同**，负责把"什么算合格的 spike、什么必须被验证、什么算 finding 闭合"三件事一次性定死，对上游消化 plan-after-foundations charter 的 spike-first-iteration 方法论，对下游为两个 spike design 与所有 ship-code phase 提供可追溯的真相源。

---

## 3. Spike Discipline — 7 条纪律的冻结

> **核心约束**：本节 7 条纪律全部冻结。Phase 0-7 的任何 spike-related 决策都必须先通过这 7 条 review。

### 3.1 纪律 1：spike 代码放 the historical spikes tree 顶级目录，**不进** `packages/`

**理由**：spike 是 disposable，packages/ 是 production-shaped。混在一起会让 packages/ 被迫吸收 spike 的临时假设。

**判定**：任何 spike 文件出现在 `packages/` 目录下，即视为违反。

### 3.2 纪律 2：spike 必须有 expiration date

**默认 expiration**：2026-08-01（约本 charter 起算 3.5 个月）。

**判定**：到期后必须执行下面之一：
- 删除 spike worker 与代码
- 转化为正式 packages/ 模块（必须经过 review，不允许直接 promote）
- 显式 extend expiration 并在 charter 添加修订记录

### 3.3 纪律 3：spike 不接 CI 主链

**理由**：spike 的失败不应阻塞主线 build；主线的失败不应被 spike 噪音掩盖。

**判定**：historical spike artifacts 不进入 `pnpm test` / `pnpm typecheck` / 任何 CI workflow 的主路径。spike 可以有自己的本地 deploy script，但不进 PR-blocking pipeline。

### 3.4 纪律 4：spike 的发现必须落到 design doc，不能只在代码注释里

**理由**：spike 一旦销毁，代码注释就丢了；只有 design doc 是 durable truth。

**判定**：每条 spike 发现必须**独立成文**写到 `docs/spikes/{namespace}/{NN}-{title}.md`，使用 `docs/templates/_TEMPLATE-spike-finding.md`。代码注释可以指向 finding doc，但 finding 本身必须在 doc 里。

### 3.5 纪律 5：spike 不接生产数据 / 不持有业务数据 / 不实现新业务能力

**理由**：disposable 的语义要求它**对销毁不敏感**；持有业务数据会让 spike 无法被自由销毁。

**判定**：
- spike R2 / KV / D1 namespace 必须独立于 production
- spike worker 不接 LLM API key（用 fake provider 或 free-tier 探针）
- spike 不实现"将来产品也要用"的新能力

### 3.6 纪律 6：两轮 spike 分目录

**目录结构**：

```
the historical spikes tree 
├── round-1-bare-metal/
│   ├── spike-do-storage/
│   └── spike-binding-pair/
├── round-2-integrated/
│   ├── spike-do-storage/      # 接入 ship 后的 packages 重跑
│   └── spike-binding-pair/
└── README.md                    # 指向本 design doc
```

**判定**：Round 1 与 Round 2 的代码不允许互相 import；两轮的 finding doc 也分目录归档。

### 3.7 纪律 7：Round 1 spike 不依赖 packages/ 的运行时实现，但回写任务必须显式对齐 packages/ seam

> **r2 修订（基于 GPT review §2.7）**：本条不是"完全不依赖 packages/"，而是"不绑架 packages/ 的现有 seam 实现，但所有 finding 必须可被 packages/ 消化"。

**判定**：
- ✅ 允许 Round 1 spike 直接调 `env.R2_ARTIFACTS.put(...)` / `env.KV_CONFIG.get(...)` / `env.SESSION_DO.fetch(...)` 等 Cloudflare 原生 binding API
- ✅ 允许 Round 1 spike 引用 packages/ 的 type definitions（**只**为了对齐 contract reference）
- ❌ 不允许 Round 1 spike `import` packages/ 的 runtime 实现（如 `WorkspaceNamespace` / `ContextAssembler` / `KernelRunner` 等）
- ✅ 所有 Round 1 finding 必须显式列出"对哪些 packages/ 文件构成 impact"——见 finding 模板 §3
- ✅ 所有 Round 1 finding 必须显式列出 writeback 路径——见 finding 模板 §5
- ✅ Round 2 spike **必须** import ship 后的 packages/ runtime——这是 Round 2 的存在意义

---

## 4. Validation Matrix — 12 项必须验证的 Cloudflare 真相

> **核心约束**：下表 12 项是 owner-aligned 的本阶段 spike 必验事实。每项必须至少产生 1 条 finding doc。

### 4.1 Storage 类（6 项，由 spike-do-storage 验证）

| ID | 验证项 | 当前 packages/ 假设 | 期望发现 |
|---|---|---|---|
| **V1-storage-R2-multipart** | R2 binding 的 `put()` 在大 object（≥ 100MB / ≥ 5MB single part）下的真实行为，含 multipart upload 协议 | `ScopedStorageAdapter.r2Put` 接口未表达 multipart 约束（`storage-topology/src/adapters/scoped-io.ts:111-115`） | multipart 上限 / single-part 上限 / 失败降级行为 |
| **V1-storage-R2-list-cursor** | R2 `list()` 的 page size 上限与 cursor 行为 | `ScopedStorageAdapter.r2List` 无 cursor 字段（`scoped-io.ts:127`） | 单次最多 N keys；必须 cursor 分页 |
| **V1-storage-KV-stale-read** | KV `put`-then-`get` 的 eventual consistency 窗口大小 | `ScopedStorageAdapter.kvGet/Put` 未标注 stale-read 可能（`scoped-io.ts:99-107`） | stale-read window 数字 + 是否提供 strong-read 选项 |
| **V1-storage-DO-transactional** | DO `state.storage` 的 transactional `transaction(callback)` 行为，含 abort 与重试 | `WorkspaceNamespace` (`workspace-context-artifacts/src/namespace.ts`) 假设 transactional 但未真实测试 | transaction 边界；与 KV 跨 binding 协作的一致性 |
| **V1-storage-Memory-vs-DO** | `MemoryBackend` 与 真实 DO storage 的语义差异（顺序、原子性、容量） | `ReferenceBackend` 全抛 not-connected（`backends/reference.ts:19-47`） | 哪些 MemoryBackend 行为在 DO 上不成立 |
| **V1-storage-D1-transaction** | D1 单 query batch 与"跨 query 事务"的真实可用性 | `storage-topology` 把 D1 当 typed slot，未真实测试 | D1 不支持跨 query transaction 的影响范围 |

### 4.2 Bash / Capability 类（2 项，由 spike-do-storage 验证）

| ID | 验证项 | 当前 packages/ 假设 | 期望发现 |
|---|---|---|---|
| **V2-bash-platform** | fake-bash filesystem capabilities 在真实 DO 沙箱里的行为：mkdir / cat 大文件 / rg 大目录 / write 跨 binding | 12-pack 仅本地 vitest 验证（`capability-runtime/src/capabilities/`） | DO memory 128MB 上限触发 / cpu_ms 限制 / subrequest count |
| **V2-bash-curl-quota** | curl 真实接通 outgoing fetch 的 quota / cpu_ms / subrequest count 边界 | `CURL_NOT_CONNECTED_NOTE = "curl-not-connected"`（`network.ts:38`） | 单 worker 最大 subrequest 数 / 最大 outbound payload |

### 4.3 Service Binding 类（4 项，由 spike-binding-pair 验证）

| ID | 验证项 | 当前 packages/ 假设 | 期望发现 |
|---|---|---|---|
| **V3-binding-latency-cancellation** | service binding 的真实 latency / timeout / cancellation / retry 形态 | `remote-bindings.ts` 已就绪但未真实跨 worker 验证 | p50 / p99 latency；cancellation 是否传播；retry 语义 |
| **V3-binding-cross-seam-anchor** | `CrossSeamAnchor` headers (`x-nacp-trace/session/team/request/source-*`) 在真实 service-binding 下的传播 | 已定义但未生产验证（`session-do-runtime/src/cross-seam.ts`） | header 是否被 worker runtime 透传 / 是否有 size 限制 |
| **V3-binding-hooks-callback** | hooks `service-binding` runtime 在真实 binding 下的回调延迟 | `hooks/src/runtimes/service-binding.ts` 已设计 | 跨 worker hook dispatch latency；fail / cancel 路径 |
| **V3-binding-eval-fanin** | eval sink fan-in 在跨 worker 下的 ordering 与 dedup | `defaultEvalRecords` 在 single-worker 验证 | ordering 是否保留；dedup 是否需要应用层做 |

> 总计 6 storage + 2 bash + 4 binding = **12 项**，对齐 plan-after-foundations §2.2 与 §4.1 A 第 3 项。

### 4.4 Round 2 (integrated) 验证项的取材方式

Round 2 不再独立列验证项，而是：

1. 取 Round 1 全部 finding 的 writeback action
2. 在 ship 后的 packages/ 上重跑相同验证
3. 对每个 finding 给出 closure verdict：`writeback-shipped` / `writeback-in-progress` / `dismissed-with-rationale`

> Round 2 的 finding 命名空间是 `integrated-F{NN}`，主要内容是 closure verdict + 残留 issue。

### 4.5 Required vs Optional Findings（GPT review §2.2 修订）

> **修订说明（2026-04-19, GPT review §2.2 反馈）**：v1 在 spike-do-storage 中混淆了 "required validation findings" 与 "optional unexpected findings"，导致 closure 标准不清晰。本节正式分层。

**Required findings**：每个 §4.1-4.3 列出的 12 个 validation item 必须**至少**产生 1 条 finding（即 12 条 required findings 是本阶段 closure 的硬门槛）。

**Optional findings**：spike 跑过程中可能暴露 validation matrix 之外的 platform 真相，这些可以记录为 `unexpected-F{NN}` 命名空间下的 optional finding，**不**作为 closure 硬门槛但**鼓励**记录。

**Closure 硬门槛**：

```
✅ Required (硬):  12 个 validation item × 至少 1 条 finding
                   全部落入 writeback-shipped 或 dismissed-with-rationale
✅ Optional (软):  unexpected-F* 不强制数量，但出现的必须经过 finding template 流程
✅ Rollup (硬):    3 份 rollup index docs 必须 ship（详见 §4.6）
```

### 4.6 Two-tier Deliverable: Per-finding docs + Rollup index docs（GPT review §2.5 修订）

> **修订说明（2026-04-19, GPT review §2.5 反馈）**：charter §4.1 A 第 4 项要求交付 `docs/spikes/storage-findings.md` / `binding-findings.md` / `fake-bash-platform-findings.md` 3 份文档；同时本 design §3.4 要求每条 finding 独立成文。这两层不矛盾，但需要明确分层。

**Tier 1 — Per-finding docs**（细颗粒度，每条 finding 独立成文）：
- 路径：`docs/spikes/{spike-namespace}/{NN}-{slug}.md`
- 模板：`docs/templates/_TEMPLATE-spike-finding.md`（**唯一**模板路径，**不**使用 `docs/spikes/_TEMPLATE-finding.md`）
- 命名空间：`spike-do-storage` / `spike-binding-pair` / `unexpected`
- 用途：作为 packages/ writeback 的输入；每条携带 §3 Package Impact + §5 Writeback Action

**Tier 2 — Rollup index docs**（粗颗粒度，3 份 charter 交付物）：
- `docs/spikes/storage-findings.md` —— 汇总 V1-storage-* 6 项 finding 的 index
- `docs/spikes/binding-findings.md` —— 汇总 V3-binding-* 4 项 finding 的 index
- `docs/spikes/fake-bash-platform-findings.md` —— 汇总 V2-bash-* 2 项 finding 的 index

**Rollup doc 的最小内容**（不重复 per-finding 详情）：

| 段 | 内容 |
|---|---|
| §1 Finding index | 表格：每行一条 finding，列出 ID / title / severity / status / packages/ impact 摘要 |
| §2 Severity summary | 按 severity (blocker/high/medium/low) 统计数量 |
| §3 Writeback destination map | 表格：每条 finding → 目标 phase / 目标 packages 文件 |
| §4 Unresolved / dismissed summary | 列出 dismissed-with-rationale 的 finding 与延后理由 |
| §5 Reference to per-finding docs | links 到所有 per-finding doc |

**Rollup 不是把 per-finding 内容粘贴**，而是为下游 phase （Phase 1-7）提供**索引 + verdict + writeback map**。

---

## 5. Writeback 规则 —— Finding 闭合的唯一标准

### 5.1 三种 finding 闭合状态（与模板 §0 status 字段一致）

| 状态 | 含义 | 判定 |
|---|---|---|
| `writeback-shipped` | finding 已被 packages/ 改动消化，且 Round 2 已验证 | packages/ PR merged + Round 2 contract test 通过 |
| `dismissed-with-rationale` | finding 经审视后决定不做 packages/ 改动 | 必须填写模板 §5.3 的延后理由（cost-benefit / 不成立 / 延后到 worker matrix） |
| `open / writeback-in-progress` | 尚未闭合 | 不允许在本阶段 exit 时仍处于此状态 |

### 5.2 双向 traceability 检查

> **本规则是 plan-after-foundations §10.3 的具体落实。**

| 方向 | 检查 | 失败处理 |
|---|---|---|
| Forward：finding → ship code | 每条 finding 必须显式列出对应 packages/ 修改路径 | 阻止 finding 被标 `writeback-shipped` |
| Backward：ship code → finding | 每个 P1-P5 ship 的 packages/ 改动必须能反向追溯到至少 1 条 finding 或 charter 显式要求 | review 时被标记 "ship without spike justification" |

### 5.3 Exit 前的 finding 状态闸口

本阶段 exit（plan-after-foundations §11）要求：

- 不允许任何 `open` 或 `writeback-in-progress` 的 finding 残留
- 所有 finding 必须落入 `writeback-shipped` 或 `dismissed-with-rationale` 之一
- `dismissed-with-rationale` 的 finding 必须在 handoff memo `docs/handoff/after-foundations-to-worker-matrix.md` 中明确列出

---

## 6. 与现有 plan-after-foundations charter 的对应关系

| Charter 章节 | 本文落实 |
|---|---|
| §1.1 spike worker 是核心方法论 | §3 全部 7 条纪律 |
| §2.2 12 项待验证 gap | §4 全部 12 项 |
| §4.1 A spike round 1 in-scope | §3 + §4.1-4.3 |
| §4.1 G spike round 2 in-scope | §4.4 |
| §5.1 spike disposable probe | §3.1-§3.7 |
| §5.2 spike-first-iteration | §4 + §5.2 双向 traceability |
| §10.3 双向 traceability | §5.2 |
| §11.1 第 1 条 spike 真相已闭合 | §5.3 exit 闸口 |

---

## 7. 不在本文件冻结的事项

以下事项**不**在本 P0 design 中冻结，留给后续 design / phase 决定：

1. spike worker 的具体代码结构 → `P0-spike-do-storage-design.md` / `P0-spike-binding-pair-design.md`
2. 每个 finding 的具体内容 → 由 spike 实际跑出后写入 `docs/spikes/`
3. Round 2 spike 的详细 integration plan → `P6-spike-round-2-integration-plan.md`
4. 哪些 finding 触发 packages/ ship → 由 P1-P5 design 在写时反推

---

## 8. 收口标准（Exit Criteria）

本 design 的成立标准：

1. ✅ §3 的 7 条纪律已被 owner alignment（plan-after-foundations §5.1 已包含）
2. ✅ §4 的 12 验证项已被 owner alignment（plan-after-foundations §2.2 已包含）
3. ✅ `_TEMPLATE-spike-finding.md` 已 ship at `docs/templates/`
4. ⏳ `P0-spike-do-storage-design.md` 引用本文 §3 + §4.1-4.2
5. ⏳ `P0-spike-binding-pair-design.md` 引用本文 §3 + §4.3
6. ⏳ Phase 0 action plan `B1-spike-round-1-bare-metal.md` 引用本文 §5 writeback 规则

---

## 9. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；冻结 7 条 spike 纪律 + 12 项 validation matrix + writeback 规则 |
