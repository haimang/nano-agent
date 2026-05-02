# Pro-to-Product Charter

> **文档对象**：`nano-agent / pro-to-product`
> **状态**：`active charter`
> **日期**：`2026-05-02`
> **作者**：`GPT-5.4`
> **文档性质**：`phase charter`
> **文档一句话定义**：`在 hero-to-pro 已完成的 workbench-grade backend substrate 之上，把 live caller / truth gap 接成前端可信的产品级 agent loop 的基石纲领。`
>
> **修订历史**：
> - `2026-05-02 v0.active — 首版基线 charter，承接 hero-to-pro final closure 与 HPX7 closure honesty uplift`
>
> **直接输入包（authoritative）**：
> 1. `docs/charter/plan-hero-to-pro.md`
> 2. `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
> 3. `docs/issue/hero-to-pro/HPX7-closure.md`
> 4. `docs/eval/pro-to-product/closing-thoughts-by-GPT.md`
>
> **ancestry-only / 背景参考（不作为直接入口）**：
> - `docs/eval/pro-to-product/re-planning-by-opus.md`
> - `docs/eval/pro-to-product/re-planning-reviewed-by-{deepseek,kimi,GPT}.md`
> - `docs/eval/pro-to-product/initial-planning-by-opus.md`
>
> **下游预期产物**：
> - `docs/design/pro-to-product/*.md`
> - `docs/action-plan/pro-to-product/PP*.md`
> - `docs/issue/pro-to-product/PP*-closure.md` + `docs/issue/pro-to-product/pro-to-product-final-closure.md`

---

## 0. 为什么这份 charter 要现在写

### 0.1 当前时点的根本原因

现在写 `plan-pro-to-product.md` 的原因，不是“下一阶段该有一个名字了”，而是 **hero-to-pro 已经在 HPX7 之后完成了它该完成的 honesty uplift**，使我们第一次拥有了一个足够干净、可以诚实承接下一阶段的起点。

`hero-to-pro` 当前真实终态已经不是早先的 `partial-close / 7-retained`，而是 **`close-with-known-issues / 4-owner-action-retained-with-explicit-remove-condition`**；28 个 deferred 细分项已经 absorbed within hero-to-pro，工程侧 retained 已不再构成下一阶段入口 blocker（`docs/issue/hero-to-pro/hero-to-pro-final-closure.md:21-30`; `docs/issue/hero-to-pro/HPX7-closure.md:14-19,73-80`）。

与此同时，charter §16 已把上一阶段的实际完成面重写为 **在不打破 6-worker 基石的前提下，形成 workbench-grade agent loop backend substrate**。这意味着下一阶段的主命题不再是“继续补更多 schema / route / worker topology”，而是 **把已经存在的 substrate 接成前端可信的 live loop**（`docs/charter/plan-hero-to-pro.md:1339-1367`）。

如果现在不写这份 charter，最直接的后果就是：phase 切分、design 数量、truth gate、Hook/Policy/Reconnect 的边界，又会重新落回“谁先写一份 planning 文档谁说了算”的漂移状态。上一轮讨论已经证明，这类模糊空间会迅速膨胀成文档过度生产与 phase 边界失真。

### 0.2 这份文档要解决的模糊空间

1. **下一阶段到底是 phase-first 还是 doc-first**：我们必须冻结，`pro-to-product` 的推进力是 truth gate + e2e skeleton，不是 13 份 design 文档的前置生产。
2. **哪些工作必须在本阶段完成，哪些应明确留给下一阶段**：尤其是 multi-provider、admin/billing、SDK extraction、完整 hook catalog 这类平台化主题，不能再次悄悄混入当前阶段。
3. **Phase 与 design 的粒度**：既不能像 Opus 方案那样把文档体系做成一个子项目，也不能像 4-phase 巨型合并那样把 critical path 做成一个超大 phase。

### 0.3 这份 charter 的职责，不是别的文件的职责

- **本 charter 负责冻结**：
  - `pro-to-product` 的唯一中心命题、全局边界与错误前提
  - 6 个 Phase 的职责划分、先后顺序与 truth gate
  - 必要的 design 生产清单、review 模式与下一阶段触发条件
- **本 charter 不负责展开**：
  - 各 Phase 的具体实现算法、数据结构、边界细节（应在：`docs/design/pro-to-product/*.md`）
  - 逐任务执行拆解、命令级验证、修复步骤（应在：`docs/action-plan/pro-to-product/PP*.md`）

---

## 1. 本轮已确认的 Owner Decisions 与基石事实

### 1.1 Owner Decisions（直接生效）

| 编号 | 决策 | 影响范围 | 来源 |
|------|------|----------|------|
| D1 | `pro-to-product` 的 design 文件统一放在 `docs/design/pro-to-product/`，不再分散到其他目录 | 设计文档结构、下游引用路径、行动计划与 closure 的引用稳定性 | User input: "我趋向于只在 docs/design/pro-to-product/ 下增加design文件, 而不动其他文件夹, 这样所有设计文件都集合在一起" |
| D2 | 本 charter 承接 HPX7 之后的真实起点，不再以 `partial-close / 7-retained` 为入口前提 | reality snapshot、gate 设计、phase 工期、design 数量 | `docs/eval/pro-to-product/closing-thoughts-by-GPT.md`; current user request to draft baseline charter from all discussions |
| D3 | 本阶段基线采用 **6-phase / 7-design / batch-review / e2e-first** 的轻量方案 | phase 切分、design 生产、review 方式、PP0 定义 | `docs/eval/pro-to-product/closing-thoughts-by-GPT.md`; current user request to materialize baseline charter |

### 1.2 已冻结的系统真相

| 主题 | 当前真相 | 本阶段如何继承 |
|------|----------|----------------|
| hero-to-pro 终态 | `hero-to-pro` 已是 `close-with-known-issues / 4-owner-action-retained-with-explicit-remove-condition`；工程 retained 不再是下一阶段入口 blocker | 本阶段不再设置 Debt Acknowledgement Gate / Retained Non-Block Gate；owner-action retained 仅作为背景事实保留 |
| 拓扑与 substrate | 6-worker 基石仍成立；HPX5/HPX6/HPX7 已形成 workbench-grade agent loop backend substrate，而非新的 7-worker 常态拓扑 | 本阶段继续保持 6-worker topology，不以“换拓扑”作为解法 |
| public contract 现状 | `/runtime` 已有 public `ETag / If-Match` 合同，tool-call cancel 已有 live producer，`/items` public route 已有 route-level evidence | 本阶段从当前 public surface 出发，做 live caller / truth gap 收口，而不是再回到“是否先把 facade 做出来”的问题 |
| 4 套状态机现实 | Model / Context / Chat lifecycle / Tool-Workspace 目前都是 `partial-live`，问题主要在 live caller、恢复语义、policy honesty，而不是表结构缺失 | 本阶段的 6 truth gates直接对准这些 remaining gaps，而不是重建状态机 |
| 22-doc client docs baseline | `clients/api-docs/` 已扩展到 22-doc pack，但“写进文档 ≠ 前端可依赖”仍需由本阶段 truth gates 校验 | docs truth 将被纳入本阶段硬闸，而不再以“文档已存在”视为完成 |

### 1.3 明确不再重讨论的前提

1. **6-worker topology 继续作为默认基线**；本阶段不以新增 worker / 常态化拓扑重写作为解题方向。
2. **`wire-without-delivery` 仍然不算闭合**；任何 schema / storage / façade / emitter-only 成果，如果没有 live caller 与前端可信证据，都不能宣称阶段完成。
3. **HPX7 已经完成了上一阶段的 honesty uplift**；本阶段不再重新打开 HPX7 的 scope 争论。

---

## 2. 当前真实起点（Reality Snapshot）

### 2.1 已成立的 shipped / frozen truth

| 主题 | 当前现实 | 证据 |
|------|----------|------|
| HITL transport substrate | permission / elicitation 的 request-frame + async answer substrate 已存在，但尚未被 `approval_policy=ask` 的 live caller 消费 | `workers/agent-core/src/host/do/session-do-runtime.ts:378-415` |
| Context probe substrate | compact signal probe 已经接到 runtime composition，能根据 durable usage / context_window 计算 compact required | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:292-324` |
| Runtime config public contract | `/runtime` 现在有 `ETag / If-None-Match / If-Match` public optimistic lock 合同；body `version` law 仍保留 | `workers/orchestrator-core/src/facade/routes/session-runtime.ts:129-207` |
| Replay persistence substrate | checkpoint 时 WS helper replay 已写盘；replay buffer 本身有 checkpoint/restore 能力 | `workers/agent-core/src/host/do/session-do-persistence.ts:154-160`; `packages/nacp-session/src/replay.ts:81-95` |
| Hook substrate | session DO assembly 中已无条件构造 `HookRegistry + HookDispatcher + LocalTsRuntime`，hook runtime seam 已在 | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:155-160,191-196` |

### 2.2 当前仍然存在的核心 gap

| 编号 | gap | 为什么必须在本阶段处理 | 若不处理会怎样 |
|------|-----|------------------------|----------------|
| G1 | `approval_policy=ask` 仍然直接 error-out，而不是 pause-resume | 这是当前最明确的 live caller 断点；已有 substrate 存在但主回路未接通 | 前端无法建立可信的 HITL loop，工具权限仍表现为“错误”而不是“等待用户决策” |
| G2 | token/context-window preflight 缺失，compact 仍是 `{ tokensFreed: 0 }` | Context budget 是长对话可持续性的核心；当前 compact 仍是假闭环 | 前端即便有 compact UI，也是在消费一个不会真正缩小 prompt 的伪能力 |
| G3 | replay checkpoint 已写盘，但 restore 路径不恢复 helper replay，过旧 seq 仍直接 throw | reconnect/recovery 是产品 trust 的基础能力；当前断线后恢复仍停在 best-effort | 前端刷新页面 / 断线重连时仍然会撞到恢复不可信、状态不连续、甚至直接 throw |
| G4 | HookDispatcher 已注入，但 production register source 与 PreToolUse live caller 仍未接通 | hook 仍停在 substrate ready，而不是 product loop ready | 若直接扩 hook catalog / UI，可见性会再次先于真实 delivery |
| G5 | `network_policy / web_search / workspace_scope` 已 public visible，但运行时仍未消费；fallback/retry 也未形成 first-class truth surface | 这是典型的 policy honesty + reliability gap | 前端会继续消费 ambiguous contract：字段已公开却不 enforce，fallback/retry 发生却不可见 |

### 2.3 本阶段必须拒绝的错误前提

- **错误前提 1**：`approval_policy=ask` 只要文档里有、frame 也会发，就算能力已具备。  
  **为什么错**：当前 `authorizeToolPlan()` 仍直接返回 `tool-permission-required / denied` error，不会暂停 turn（`workers/agent-core/src/host/runtime-mainline.ts:235-261`）。
- **错误前提 2**：compact 只要 probe 已接上、通知也会发，就可以宣称 Context 闭合。  
  **为什么错**：当前 `requestCompact()` 仍返回 `{ tokensFreed: 0 }`，没有真实 prompt mutation（`workers/agent-core/src/host/runtime-mainline.ts:833-836`）。
- **错误前提 3**：文档 / review / design 产量本身就是阶段进展。  
  **为什么错**：本阶段的真问题是 live caller / recovery / policy truth；没有 e2e skeleton 和 truth gate，文档产量不会自动变成 delivery。

---

## 3. 本阶段的一句话目标

> **阶段目标**：`在不打破 6-worker 基石、默认不新增 D1 schema 的前提下，把 hero-to-pro 已具备的 workbench-grade backend substrate 接成前端可信、可恢复、可观测的 live agent loop，并用 truth gate 取代“功能已存在”的自述。`

### 3.1 一句话产出

`一个前端第一次可以真实依赖的 nano-agent backend：工具权限不再 error-out、长对话不再停在假 compact、断线后恢复有明确 contract、最小 hook loop 可见、runtime policy 不再 ambiguity。`

### 3.2 一句话非目标

`不是 multi-provider / sub-agent / admin / billing / SDK extraction / sandbox / WeChat 完整产品化的阶段。`

---

## 4. 本阶段边界：全局 In-Scope / Out-of-Scope

### 4.1 全局 In-Scope（本阶段必须完成）

| 编号 | 工作主题 | 为什么必须在本阶段完成 | 对应 Phase |
|------|----------|------------------------|------------|
| I1 | PP0 charter + truth lock + 首个 e2e skeleton | 没有这一层，后续 phase 会再次回到“文档先行、真实 gap 后看”的模式 | PP0 |
| I2 | HITL interrupt 真闭合 | 这是前端可交互 agent loop 的第一条硬闸 | PP1 |
| I3 | Context budget 真闭合 | 长对话可靠性与 compact truth 是 agent loop 产品化的第二条硬闸 | PP2 |
| I4 | Reconnect / session recovery 真闭合 | 前端刷新 / 断线后的信任恢复不能继续停在 best-effort | PP3 |
| I5 | Hook minimal live loop 闭合 | Hook 需要先从 substrate 变成 product loop，再谈 catalog 扩张 | PP4 |
| I6 | Policy honesty + reliability hardening + final closure | 当前 `/runtime` 与 fallback/retry 的 truth gap 不能继续延后；本阶段需要合法封板 | PP5 |

### 4.2 全局 Out-of-Scope（本阶段明确不做）

| 编号 | 项目 | 为什么现在不做 | 重评条件 / 下游落点 |
|------|------|----------------|----------------------|
| O1 | Multi-provider routing / provider abstraction | 当前主命题是把单-provider 下的 live caller 与 truth gap 接通；过早做会把恢复/权限/compact 问题乘以 provider 数量 | 下一阶段（暂定 platform-foundations / scale-out charter） |
| O2 | Sub-agent / multi-agent | 这是平台能力，不是当前 single-agent loop productization 的必要条件 | 下一阶段 |
| O3 | Admin plane / billing / team management / SDK extraction | 这些属于平台和商业化能力，与当前 frontend trust 主线正交 | 下一阶段 |
| O4 | Full hook catalog（14/18 emit 全接通） | 当前阶段只需要 minimal live hook loop；全 catalog 容易把 PP4 再次做成大杂烩 | 下一阶段，或在本阶段 closure 后作为 secondary follow-up 重评 |
| O5 | Sandbox 隔离 / bash streaming progress / WeChat 完整产品化 | 这些都属于更大产品面或平台面，不是当前 baseline charter 的主线 | 下一阶段 / 独立客户端专项 |

### 4.3 灰区判定表（用来消除模糊空间）

| 项目 | 判定 | 判定理由 | 若要翻案，需要什么新事实 |
|------|------|----------|--------------------------|
| reasoning stream typing | `defer / later-phase or PP5 subtask` | 它是重要 truth surface，但不是单独 phase；只有在 PP5 observability / docs truth 需要它时，才纳入本阶段子任务 | 如果某个 truth gate 无法在无 reasoning typing 的情况下被合法验证 |
| cross-e2e 基础设施 | `in-scope` | 本阶段必须以真实 e2e skeleton 驱动，不可只靠 design / unit test | 如果已有基础设施已足以直接表达 6 truth gates，无需新增骨架 |
| 完整 policy enforce | `in-scope with downgrade fallback` | `network_policy / web_search / workspace_scope` 不能继续 ambiguity；要么 enforce，要么显式 downgrade | 如果运行时实际无法在本阶段安全接入且 downgrade 方案也不诚实 |
| hook 全 catalog 扩张 | `out-of-scope` | 当前只需要 minimal live loop；catalog 扩张是 secondary outcome，不是主闸 | 如果最小 loop 无法成立，必须先调 scope，而不是扩 catalog |

### 4.4 必须写进 charter 的硬纪律

1. **没有 live caller + e2e 证据，就不能宣称闭合。**
2. **默认不新增 D1 migration，不新增 worker，不重写 6-worker topology。**
3. **每个 Phase 的 action-plan 与 closure 都必须以 truth gate 为对账单，而不是以文档产量为对账单。**
4. **本阶段的 review 采用 batch review，不采用逐文档 review 链。**

### 4.5 必须写明的例外（如有）

本阶段允许一类**严格受控的 D1 例外**，但默认不使用。只有全部满足下列条件时才允许：

1. 该 schema 变更只服务于 reconnect / dedup / detached recovery 语义之一；
2. 不新增表，字段规模控制在极小范围（原则上 ≤ 5 列）；
3. 对应 Phase 的 design doc 与 action-plan 显式登记此例外；
4. owner / architect 在本 charter 或其修订版中明确批准；
5. 最终 closure 必须把该例外登记进 schema correction list。

---

## 5. 本阶段的方法论

| 方法论 | 含义 | 它避免的错误 |
|--------|------|--------------|
| **live-caller-first** | 优先修“已有 substrate 但无 caller”的断点，而不是继续铺 schema / surface | 再次制造 schema-live / producer-not-live |
| **e2e-first** | PP0 就要有首个真实 e2e skeleton；每个 Phase 都必须有对应 e2e 证据 | 把 design / review 误当成 delivery |
| **truth-gate-first** | 6 truth gates 是本阶段 closure 的硬闸，不是附属说明 | Phase 完成只停留在“代码大概有了” |
| **minimal-loop-first** | Hook、Policy、Observability 都先做最小可信闭环，再扩 catalog / polish | 一上来追求 full surface，造成 phase 膨胀 |
| **verification-first on residuals** | 对 inherited residual 先验证当前 reality，再决定是否需要 patch | 因旧 review 口径强做无效修补 |
| **doc-as-contract, not as-progress** | 文档用于冻结边界和合同，不作为推进本身的代替品 | 文档体系膨胀、工程节奏被治理开销拖垮 |

### 5.1 方法论对 phases 的直接影响

- **`e2e-first`** 直接影响：PP0 不能只交 charter 和 design，必须交首个 e2e skeleton；PP1-PP5 的 closure 都要有真实 loop 证据。
- **`minimal-loop-first`** 直接影响：PP4 不追求完整 hook catalog；PP5 不追求所有 observability embellishment，而优先 enforce-or-downgrade 与最小 fallback/retry truth。

---

## 6. Phase 总览与职责划分

### 6.1 Phase 总表

| Phase | 名称 | 类型 | 核心目标 | 主要风险 |
|------|------|------|----------|----------|
| PP0 | Charter & Truth Lock | freeze | 冻结 reality snapshot、truth gates、设计清单与首个 e2e skeleton | 文档前置过多、PP0 再次膨胀 |
| PP1 | HITL Interrupt Closure | implementation | 把 ask / elicitation / confirmation 从 error path 接成 pause-resume loop | scheduler / confirmation state 设计不稳 |
| PP2 | Context Budget Closure | implementation | 把 token preflight、compact 真执行、prompt mutation 接成真实 budget loop | compact 执行不可行或效果无法证明 |
| PP3 | Reconnect & Session Recovery | implementation | 把 replay restore、lagged contract、detached policy、state snapshot 接成可信恢复链 | replay / restore 多层状态不一致 |
| PP4 | Hook Delivery Closure | implementation | 让 PreToolUse 真走 HookDispatcher，并形成最小 frontend-visible hook loop | Hook 与 permission/policy 仲裁顺序不清 |
| PP5 | Policy Honesty + Reliability Hardening + Final Closure | hardening / closure | 消除 public runtime ambiguity，补齐 fallback/retry truth，并完成阶段封板 | PP5 变成剩余事项的杂物抽屉 |

### 6.2 Phase 职责矩阵（推荐必填）

| Phase | 本 Phase 负责 | 本 Phase 不负责 | 进入条件 | 交付输出 |
|------|---------------|----------------|----------|----------|
| PP0 | charter、cross-cutting truth、首个 e2e skeleton、design 生产顺序冻结 | 不负责实现 live loop | hero-to-pro final closure 与 HPX7 closure 已冻结 | charter + `00/01` design + 首个 e2e skeleton |
| PP1 | permission / elicitation / confirmation interrupt 真闭合 | 不负责 compact / replay / hook register | PP0 完成；truth model 已冻结 | PP1 design + action-plan + HITL e2e |
| PP2 | token preflight、real compact、prompt mutation、overflow degrade | 不负责 replay / hook / policy downgrade | PP1 interrupt substrate 已稳定 | PP2 design + action-plan + compact truth e2e |
| PP3 | replay restore、lagged contract、detached policy、state snapshot | 不负责 policy / hook catalog 扩张 | PP1 的 `session-do-runtime.ts` 关键改动已稳定；PP0 truth model 已冻结 | PP3 design + action-plan + reconnect truth e2e |
| PP4 | PreToolUse live caller、register source、minimal hook surface | 不负责 full hook catalog 或 full product UI | PP1 confirmation / interrupt substrate 已可复用 | PP4 design + action-plan + hook truth e2e |
| PP5 | enforce-or-downgrade、fallback/retry truth、docs/obs audit、final closure | 不负责 platform-scale features | PP2/PP3/PP4 主线完成并各自有 e2e 证据 | PP5 design + action-plan + final closure |

### 6.3 Phase 之间的交接原则

1. **PP0 只冻结主线，不抢后续 Phase 的实现细节。**
2. **PP1 先提供 interrupt substrate；PP2 与 PP4 只能建立在它的稳定输出上。**
3. **PP3 可与后续 Phase 并行，但不得与 PP1 在同一 owner file 的高频改动窗口重叠。**
4. **PP5 不替前面 Phase 补主线真相，只负责 hardening、honesty 和 final closure。**

---

## 7. 各 Phase 详细说明

### 7.1 `PP0` — Charter & Truth Lock

#### 实现目标

冻结 `pro-to-product` 的起点、边界、truth gates、design 生产清单，并用首个 e2e skeleton 把“文档推理”压回“可测现实”。

#### In-Scope

1. 形成 `plan-pro-to-product.md` 首版并冻结 6 truth gates。
2. 产出 `00-agent-loop-truth-model.md` 与 `01-frontend-trust-contract.md`。
3. 交付至少一个真实 e2e skeleton（HITL 或 reconnect 其一）。

#### Out-of-Scope

1. 不在 PP0 内提前写完所有 per-phase design。
2. 不在 PP0 内执行任何 Phase 的主线实现。

#### 交付物

1. `docs/charter/plan-pro-to-product.md`
2. `docs/design/pro-to-product/00-agent-loop-truth-model.md`
3. `docs/design/pro-to-product/01-frontend-trust-contract.md`
4. 首个 e2e skeleton（测试或最小验证骨架）

#### 收口标准

1. 6 truth gates、D1 例外 law、Phase 边界已冻结。
2. `00/01` 两份 cross-cutting design 已完成并可被 PP1-PP5 直接消费。
3. 首个 e2e skeleton 能以真实代码路径暴露 substrate 真相。

#### 什么不算完成

1. 只写出 charter / design，没有首个 e2e skeleton。
2. 继续派生 debt-matrix / review-matrix / 额外 governance 文档。

#### 本 Phase 风险提醒

- PP0 最容易再次膨胀成“文档项目”。
- 若 e2e skeleton 只停在 mock，不走真实代码路径，则会失去 PP0 的意义。

---

### 7.2 `PP1` — HITL Interrupt Closure

#### 实现目标

把 `approval_policy=ask`、permission request、elicitation、confirmation pending 从 error path 接成真实的 pause-resume loop。

#### In-Scope

1. `approval_policy=ask` 不再直接变成 LLM error。
2. permission / elicitation request 能进入等待用户输入的真实 loop。
3. allow / deny / timeout 三态恢复路径明确且可观测。

#### Out-of-Scope

1. 不负责 compact / token preflight。
2. 不负责 replay restore / hook register / policy downgrade。

#### 交付物

1. `docs/design/pro-to-product/02-hitl-interrupt-closure.md`
2. `docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md`
3. PP1 对应的 HITL truth e2e / closure 文档

#### 收口标准

1. `approval_policy=ask` 真进入 pause-resume，而非 error-out。
2. permission / elicitation 至少一条用户驱动回路全闭合。
3. allow / deny / timeout 三态都有真实证据。

#### 什么不算完成

1. 只是把错误换成另一种 façade response，但 turn 仍未暂停。
2. 只有单元测试，没有真实 e2e 证明用户可以恢复 loop。

#### 本 Phase 风险提醒

- scheduler / confirmation state 容易做出“看起来像 interrupt，实际只是异步错误”的伪闭环。
- `session-do-runtime.ts` 会成为后续 PP3 的共享改动面，需尽早稳定。

---

### 7.3 `PP2` — Context Budget Closure

#### 实现目标

把 token preflight、compact 真执行、prompt mutation 与 overflow degrade 接成真实的 Context budget loop。

#### In-Scope

1. request-builder 层的 token/context-window preflight。
2. compact 真执行并能释放预算，而不是 `{ tokensFreed: 0 }`。
3. compact 后下一个 request 的 prompt 真变化，overflow 有明确 degrade contract。

#### Out-of-Scope

1. 不负责 reconnect / replay。
2. 不负责 hook delivery 或完整 policy honesty。

#### 交付物

1. `docs/design/pro-to-product/03-context-budget-closure.md`
2. `docs/action-plan/pro-to-product/PP2-context-budget-closure-action-plan.md`
3. PP2 对应的 compact truth e2e / closure 文档

#### 收口标准

1. preflight 不再缺位，长对话风险在请求前可被识别。
2. compact 执行后可证明 prompt 真实缩减。
3. overflow degrade 有明确 contract，而不是 provider 错误外泄。

#### 什么不算完成

1. 仍然只 emit compact notify，但 prompt 未变化。
2. 只有 heuristic 说明，没有证据证明 budget 真释放。

#### 本 Phase 风险提醒

- compact 可能成为最大技术风险点，需要准备 manual compact / degrade 的 contingency。
- 若 budget loop 与 PP1 interrupt substrate 边界不清，Phase 间职责会重新打架。

---

### 7.4 `PP3` — Reconnect & Session Recovery

#### 实现目标

把 replay restore、lagged contract、detached policy 与 session state snapshot 接成可信的断线恢复链。

#### In-Scope

1. restore 路径恢复 helper replay / session recovery 所需状态。
2. `NACP_REPLAY_OUT_OF_RANGE` 不再直接向前端 throw，而是显式 lagged/degraded contract。
3. detached running turn policy 与 session state snapshot 明确。

#### Out-of-Scope

1. 不负责完整 hook / policy / compact。
2. 不负责多设备跨端同步平台化能力。

#### 交付物

1. `docs/design/pro-to-product/04-reconnect-session-recovery.md`
2. `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md`
3. PP3 对应的 reconnect truth e2e / closure 文档

#### 收口标准

1. replay restore 真恢复关键 helper state。
2. reconnect 在 replay 失败时也不会直接 throw 给前端。
3. 前端重连后能知道 session 当前状态，而不是只能从 timeline 猜。

#### 什么不算完成

1. replay 仍是 best-effort，没有 degraded contract。
2. detached turn 继续无限跑，或前端无法知道 session phase。

#### 本 Phase 风险提醒

- `session-do-runtime.ts` 与 PP1 会共享改动面，启动时机必须后移到 PP1 稳定后。
- replay / restore 涉及多层状态，一处成功不代表整条恢复链成功。

---

### 7.5 `PP4` — Hook Delivery Closure

#### 实现目标

让 PreToolUse 真走 HookDispatcher，并形成最小 frontend-visible hook loop。

#### In-Scope

1. PreToolUse live caller 接到 HookDispatcher。
2. 至少一个 production register source。
3. 至少一个 frontend-visible hook path，且与 audit / outcome 可对账。

#### Out-of-Scope

1. 不负责完整 14/18 hook catalog 全接通。
2. 不负责把 hook 做成独立平台能力或 admin plane。

#### 交付物

1. `docs/design/pro-to-product/05-hook-delivery-closure.md`
2. `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md`
3. PP4 对应的 hook truth e2e / closure 文档

#### 收口标准

1. PreToolUse 不再绕过 HookDispatcher。
2. 至少一条 `register → emit → outcome → frontend visible + audit visible` 闭环成立。
3. 与 permission_rules / approval_policy 的仲裁顺序清晰且被测试覆盖。

#### 什么不算完成

1. 只是把 HookDispatcher 保留为 injected substrate，但 caller 仍不进来。
2. 只有内部 audit，没有前端可见性。

#### 本 Phase 风险提醒

- 最容易 scope creep 到“全 catalog / 全 UI / 全 contract”。
- 若 Hook 与 permission_rules 的优先级不冻结，Phase 会反复返工。

---

### 7.6 `PP5` — Policy Honesty + Reliability Hardening + Final Closure

#### 实现目标

消除 public runtime ambiguity，补齐 fallback/retry truth，并完成本阶段 final closure。

#### In-Scope

1. `network_policy / web_search / workspace_scope` 的 enforce-or-downgrade。
2. fallback / retry / stream recovery 的最小 first-class truth surface。
3. docs / observability audit、phase closures 与 final closure。

#### Out-of-Scope

1. 不负责 multi-provider、admin、billing、SDK extraction。
2. 不负责完整 observability 平台化或完整 hook catalog 扩张。

#### 交付物

1. `docs/design/pro-to-product/06-policy-reliability-hardening.md`
2. `docs/action-plan/pro-to-product/PP5-policy-reliability-hardening-action-plan.md`
3. `docs/issue/pro-to-product/pro-to-product-final-closure.md`

#### 收口标准

1. `/runtime` 的 3 类字段不再 ambiguity：要么真 enforce，要么 explicit downgrade。
2. fallback / retry 的 truth surface 至少够支撑前端与 closure 诚实表述。
3. 所有 truth gates 对账完成，phase closures 与 final closure 一致。

#### 什么不算完成

1. 仍把 stored-not-enforced 字段写成 active policy。
2. 把 PP5 做成前面 residual 的杂物抽屉，而非 hardening / final closure phase。

#### 本 Phase 风险提醒

- 容易承接过多 leftover，导致边界失真。
- final closure 若没有回到 truth gates 对账，仍会重演上一阶段的 deceptive closure。

---

## 8. 执行顺序与 Gate

### 8.1 推荐执行顺序

1. `PP0 → PP1`
2. `PP1 稳定后并行推进 PP2 / PP3 / PP4`
3. `PP2 + PP3 + PP4 closure 后进入 PP5`

### 8.2 推荐 DAG / 依赖关系

```text
PP0
└── PP1
    ├── PP2
    ├── PP3
    └── PP4
        \ 
PP2 ------\
PP3 -------+── PP5
PP4 ------/
```

### 8.3 Gate 规则

| Gate | 含义 | 必须满足的条件 |
|------|------|----------------|
| Start Gate | 下一 Phase 合法启动的最低门槛 | 上一 Phase 的设计边界已冻结；共享 owner file 的高频改动窗口已稳定；首个相关 e2e skeleton 已存在 |
| Build Gate | Phase 可以进入主实现的门槛 | 对应 design doc 与 action-plan 已落地；本 Phase truth 定义与 shared contract 不冲突 |
| Closure Gate | Phase 可以宣称完成的门槛 | 该 Phase 对应 truth 已被真实验证；docs truth 已同步；不得存在 overclaim |

### 8.4 为什么这样排

这个顺序不是按“哪个文档先写完”排序，而是按 **代码耦合面与 truth 依赖链** 排序：

- PP1 必须先行，因为 PP2 与 PP4 都依赖它提供的 interrupt substrate。
- PP3 可以并行，但不能在 PP1 对 `session-do-runtime.ts` 的关键改动尚未稳定时过早切入。
- PP5 放到最后，因为它是 honesty / hardening / final closure phase，不应该替前面 Phase 收主线欠账。

---

## 9. 测试与验证策略

### 9.1 继承的验证层

1. 现有 worker / package 单元测试与集成测试层（包括 targeted worker tests）。
2. route-level contract tests 与 public surface tests。
3. root workspace 回归与 docs consistency / diff hygiene 等全局校验。

### 9.2 本阶段新增的验证重点

| 类别 | 验证内容 | 目的 |
|------|----------|------|
| Product-loop e2e | 至少一条 HITL / reconnect skeleton 在 PP0 即开始跑通，后续各 Phase 拓展到对应 truth gate | 让本阶段不再停在 design-first 推测 |
| Truth-gate e2e | 每个 Phase 至少有一条能直接判定对应 truth 是否成立的真实回路 | 把 closure 从“代码存在”提升为“前端可信” |
| Docs truth audit | public docs / runtime response / stream events 的表述必须与当前代码同构 | 防止 stored-not-enforced 与 fake-live drift 再现 |

### 9.3 本阶段不变量

1. **6-worker topology 不变**，除非 charter 修订版显式改变。
2. **任何 public contract 的新增表述都必须能在代码与测试里找到 owner evidence。**
3. **Phase closure 不能先于 truth gate 证据。**

### 9.4 证据不足时不允许宣称的内容

1. 不允许宣称 **HITL 已闭合**，如果 `approval_policy=ask` 仍然直接 error-out。
2. 不允许宣称 **Context 已闭合**，如果 compact 后 prompt 没有真实缩减。
3. 不允许宣称 **Reconnect 已闭合**，如果 replay overflow 仍直接 throw 给前端。
4. 不允许宣称 **Hook 已闭合**，如果 HookDispatcher 仍只是 injected substrate、无 live caller。
5. 不允许宣称 **Policy 已诚实**，如果 public runtime 字段仍 ambiguity。

---

## 10. 收口分析（Exit / Non-Exit Discipline）

### 10.1 Primary Exit Criteria（硬闸）

1. **HITL truth**：`approval_policy=ask` 与至少一条 elicitation path 能在真实 e2e 中触发 pause-resume，而不是 error-out。
2. **Context truth**：compact 后下一个 LLM request 的 prompt 能被证明真实缩减，不再只是 notify / bookkeeping。
3. **Reconnect truth**：`last_seen_seq` 重连时，要么 replay 成功，要么收到明确 lagged / degraded contract，不直接 throw 给前端。
4. **Session state truth**：前端在恢复后能拿到 session 当前状态（至少包含 phase / active-turn / pending interaction 的等价信息）。
5. **Hook truth**：至少一条 `register → emit → outcome → frontend visible + audit visible` hook 回路成立。
6. **Policy / reliability truth**：`network_policy / web_search / workspace_scope` 要么真 enforce，要么 explicit downgrade；fallback / retry 的 truth surface 对前端和 closure 足够诚实。

### 10.2 Secondary Outcomes（结果加分项，不是硬闸）

1. Hook catalog 超出 minimal live loop 的额外接通。
2. 更丰富的 observability push / metric surface。
3. 比最小要求更完整的 reconnect snapshot / recovery UX。

### 10.3 NOT-成功退出识别

以下任一成立，则**不得**宣称本阶段收口：

1. 任一 Primary Exit Criteria 仍未成立，却试图用 design / docs / partial tests 替代。
2. public docs / API / stream 表述仍存在明显 stored-not-enforced 或 fake-live drift。
3. Phase 输出只是“代码大概存在”，但没有对应 truth e2e。
4. 通过新增 worker / 大规模 schema 变更“绕开”本阶段问题，而非在既有 substrate 上完成接线。

### 10.4 收口类型判定表

| 收口类型 | 含义 | 使用条件 | 文档要求 |
|----------|------|----------|----------|
| `full close` | 阶段核心目标与 6 条硬闸全部满足，且无残留问题需要显式下放 | 所有 truth gates 全绿；无 retained engineering issue；docs truth 全面对齐 | final closure 必须列出完整证据矩阵与 phase-by-phase verdict |
| `close-with-known-issues` | 主线 truth 已完成，但仍有不会破坏本阶段目标的显式残留 | 6 条 truth gates 全绿；残留仅限 non-blocking known issue / owner-action / 明确下游主题 | final closure 必须复写残留问题、影响范围、下游落点与 remove condition |
| `cannot close` | 仍存在 blocker / truth drift / 证据不足 | 任一 truth gate 未成立；docs truth 未对齐；或主线 live caller 仍缺失 | final closure 必须显式写 cannot-close，不得用“部分完成”模糊替代 |

### 10.5 这一阶段成功退出意味着什么

`nano-agent` 第一次拥有一个前端可以真实依赖的 agent loop backend：权限交互、长对话 budget、断线恢复、最小 hook loop、runtime policy honesty 都不再停留在 substrate-ready 或 doc-ready，而是有真实闭环证据。

### 10.6 这一阶段成功退出**不意味着什么**

1. **不**意味着 nano-agent 已成为 multi-provider / sub-agent / platform-scale 系统。
2. **不**意味着 admin plane / billing / SDK extraction / sandbox / WeChat 全产品化已完成。

---

## 11. 下一阶段触发条件

### 11.1 下一阶段会正式纳入 In-Scope 的内容

1. Multi-provider routing / provider abstraction / structured output / prompt caching。
2. Sub-agent / multi-agent / orchestration-scale topics。
3. Admin plane / billing / SDK extraction / platform packaging。
4. 更完整的 hook catalog、observability expansion、客户端多端专项。

### 11.2 下一阶段的开启前提

1. `pro-to-product` 至少达到 `close-with-known-issues`。
2. 6 truth gates 全部达到可验证绿灯。
3. final closure 已明确 remaining known issues 与下游范围，没有 silently resolved。

### 11.3 为什么这些内容不能前移到本阶段

因为本阶段的唯一中心任务，是把 **已存在的 substrate 接成前端可信的 live loop**。在这一层尚未成立前，把 multi-provider、sub-agent、admin、billing、SDK 之类平台主题前移，只会把当前已经存在的 live caller / recovery / honesty gap 乘上更多复杂度，而不会更接近真正可用的产品基线。

---

## 12. Owner / Architect 决策区（可选）

### Q1 — `network_policy / web_search / workspace_scope` 的最终策略应默认 enforce 还是 explicit downgrade？

- **为什么必须回答**：PP5 的 policy honesty 不能在实现期临时摇摆，否则 docs truth 与 runtime behavior 会继续漂移。
- **当前建议 / 默认答案**：**默认 enforce；若在 PP5 内无法在不破坏主线的情况下安全接入，则必须 explicit downgrade 到 `stored-not-enforced`，并同步 API/docs。**
- **最晚冻结时点**：`PP5 design 冻结前`

### Q2 — PP4 的最小 hook 范围是否只冻结到 `PreToolUse + 1 register source + 1 frontend-visible path`？

- **为什么必须回答**：如果不冻结最小目标，PP4 很容易从 minimal live loop 失控到 full catalog 扩张。
- **当前建议 / 默认答案**：**是。** 本阶段不以 14/18 emit catalog 全接通为目标，只以 minimal live loop 为目标。
- **最晚冻结时点**：`PP4 design 冻结前`

---

## 13. 后续文档生产清单

### 13.1 Design 文档

- `docs/design/pro-to-product/00-agent-loop-truth-model.md`
- `docs/design/pro-to-product/01-frontend-trust-contract.md`
- `docs/design/pro-to-product/02-hitl-interrupt-closure.md`
- `docs/design/pro-to-product/03-context-budget-closure.md`
- `docs/design/pro-to-product/04-reconnect-session-recovery.md`
- `docs/design/pro-to-product/05-hook-delivery-closure.md`
- `docs/design/pro-to-product/06-policy-reliability-hardening.md`

### 13.2 Action-Plan 文档

- `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md`
- `docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md`
- `docs/action-plan/pro-to-product/PP2-context-budget-closure-action-plan.md`
- `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md`
- `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md`
- `docs/action-plan/pro-to-product/PP5-policy-reliability-hardening-action-plan.md`

### 13.3 Closure / Handoff 文档

- `docs/issue/pro-to-product/PP0-closure.md` 至 `docs/issue/pro-to-product/PP5-closure.md`
- `docs/issue/pro-to-product/pro-to-product-final-closure.md`
- `docs/issue/pro-to-product/pro-to-product-to-platform-foundations-handoff.md`

### 13.4 建议撰写顺序

1. `plan-pro-to-product.md` → `00/01` cross-cutting design → 首个 e2e skeleton
2. PP1 design / action-plan → PP2 design / action-plan → PP3 design / action-plan
3. PP4 design / action-plan → PP5 design / action-plan → closures / final closure / handoff

---

## 14. 最终 Verdict

### 14.1 对本阶段的最终定义

`pro-to-product` 是一个 **productization / trust-closure 阶段**，不是平台扩张阶段，也不是文档治理阶段。它的职责是把 hero-to-pro 已完成的 substrate 接成前端可信的 live loop。

### 14.2 工程价值

它把下一轮工程工作的主矛盾从“继续加面”切换成“接通已有面”，并用 truth gate、e2e skeleton、batch review 把 engineering effort 从文档生产重新拉回真实 loop 交付。

### 14.3 业务价值

它让前端第一次可以站在一个**可交互、可恢复、可观测、可诚实描述**的 backend 上继续推进，而不必把大量 trust gap 再留给客户端自行 reconcile。

### 14.4 一句话总结

> `pro-to-product` = **把 hero-to-pro 已就绪的 workbench-grade backend substrate，接成前端可信的 live agent loop，并以 truth gate 而不是功能自述作为阶段收口标准。**

---

## 15. 维护约定

1. **charter 只更新冻结边界、Phase 定义、退出条件，不回填逐任务执行日志。**
2. **执行过程中的具体变更进入 action-plan / closure / handoff。**
3. **若阶段方向被重写，必须在文首修订历史说明：改了什么、为什么改。**
4. **若某项由 in-scope 改为 out-of-scope（或反向），必须同步更新 §4、§7、§10、§11。**
5. **若采用 `close-with-known-issues`，必须在 closure 文档里复写对应残留问题、影响范围与下游落点。**
