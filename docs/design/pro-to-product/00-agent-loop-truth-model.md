# Nano-Agent 功能簇设计模板

> 功能簇: `PP0 / Agent Loop Truth Model`
> 讨论日期: `2026-05-02`
> 讨论者: `GPT-5.5`
> 关联调查报告:
> - `docs/charter/plan-pro-to-product.md`
> - `docs/eval/pro-to-product/closing-thoughts-by-GPT.md`
> 关联 QNA / 决策登记:
> - `docs/charter/plan-pro-to-product.md` §1, §10, §12
> 文档状态: `draft`

---

## 0. 背景与前置约束

- **项目定位回顾**：`pro-to-product` 不是继续扩平台面的阶段，而是在 6-worker 基石不变的前提下，把 hero-to-pro 已形成的 workbench-grade backend substrate 接成前端可信的 live agent loop。
- **本次讨论的前置共识**：
  - 当前 baseline 已冻结为 `PP0-PP6 / 8-design / batch-review / e2e-first`。
  - 本阶段 closure 受 7 条 truth gates 约束，不能用 schema、文档或 emitter-only 成果替代 live caller。
- **本设计必须回答的问题**：
  - 什么才算 nano-agent 的 agent loop truth，而不是“能力大概存在”？
  - PP1-PP6 的局部设计如何共享同一套 truth model，避免各自闭合但整体前端不可用？
- **显式排除的讨论范围**：
  - 不讨论 multi-provider、sub-agent、admin/billing、SDK extraction。
  - 不把 3 个参考 CLI 的完整架构照搬到 Cloudflare Workers + Durable Object topology。

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Agent Loop Truth Model`
- **一句话定义**：定义 nano-agent 在 `pro-to-product` 阶段判定 agent loop “真实闭合”的共同语言、硬闸与证据形态。
- **边界描述**：这个功能簇**包含** 7 条 truth gates、phase 间依赖、frontend-facing 证据要求、latency baseline 与 cannot-close 判定；**不包含** 每个 phase 的实现步骤、接口字段逐项改造、测试命令。

| 术语 | 定义 | 备注 |
|------|------|------|
| `live caller` | 已存在 substrate 被真实 agent loop 调用，且能影响当前 turn / stream / durable state | emitter-only 不算 |
| `frontend trust` | 前端可基于 public contract 做 UI 状态机，而不是猜测内部 worker 状态 | PP6 最终对账 |
| `truth gate` | 阶段退出硬闸；未满足则不得 `full close` 或 `close-with-known-issues` | 当前共 7 条 |
| `degraded contract` | 失败或无法完整恢复时，前端收到明确、可处理、文档化的降级语义 | 不等于 throw |
| `substrate-ready` | schema / helper / dispatcher / storage seam 已存在，但尚未接入真实业务回路 | 本阶段必须继续向 live loop 推进 |

### 1.2 参考调查报告

- `docs/charter/plan-pro-to-product.md` — §10 的 7 truth gates 是本设计的硬约束。
- `docs/eval/pro-to-product/closing-thoughts-by-GPT.md` — 本设计继承 `e2e-first / batch-review / minimal-loop-first` 的阶段方法论。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

`Agent Loop Truth Model` 是本阶段所有 per-phase design 的共同 contract。它服务于三类消费者：

1. **后端执行者**：知道每个 phase 不是“落代码即可”，而是必须落到 live caller + evidence。
2. **前端实现者**：知道哪些 stream / HTTP / runtime / degraded path 可以依赖。
3. **closure/review 作者**：知道何时必须写 `cannot close`，而不能用文档产量遮蔽断点。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| `01-frontend-trust-contract` | `00 → 01` | 强 | `00` 定义 truth；`01` 把 truth 映射成前端可消费合同 |
| `02-hitl-interrupt-closure` | `00 → 02` | 强 | HITL 必须证明 ask 不再 error-out |
| `03-context-budget-closure` | `00 → 03` | 强 | context truth 必须证明 prompt mutation，而非 notify-only |
| `04-reconnect-session-recovery` | `00 → 04` | 强 | reconnect truth 必须证明 replay/degraded contract |
| `05-hook-delivery-closure` | `00 → 05` | 中 | hook truth 限定为 user-driven hook live loop |
| `06-policy-reliability-hardening` | `00 → 06` | 强 | policy / reliability truth 必须消除 public ambiguity |
| `07-api-contract-docs-closure` | `00 → 07` | 强 | PP6 用 7 truth gates 对 `clients/api-docs` 做最终对账 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Agent Loop Truth Model` 是 **pro-to-product 的收口宪法**，负责 **定义 live loop 是否真的成立**，对上游提供 **统一 truth gate**，对下游要求 **每个 phase 都以可验证 evidence 收口**。

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 独立 debt gate / retained gate | hero-to-pro 历史阶段治理 | HPX7 已完成 honesty uplift；继续保留会重复治理而非推进 live loop | 若 PP6 final closure 出现新的 retained engineering issue，再由 closure 显式登记 |
| 全量 hook catalog 作为硬闸 | hook surface 已很大 | 本阶段只需要至少一条 user-driven hook live loop；catalog 扩张会拖垮 PP4 | PP4 最小闭环完成后作为 secondary outcome |
| 独立 observability baseline design | Opus review 建议 | latency baseline 已进入 charter §9.2；独立 design 会破坏 8-design 轻量约束 | 若 PP5/PP6 发现 observability 成为 blocker，再单独开 addendum |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 | 第一版行为 | 未来可能的演进方向 |
|--------|----------|------------|---------------------|
| `degraded contract` | stream frame / HTTP error code / docs truth | 先覆盖 reconnect、fallback、runtime policy | 后续扩展到 provider routing、sub-agent |
| `latency baseline` | phase closure evidence | 非硬闸，但必须登记超阈值 | 后续产品化阶段可升级为 SLO |
| `frontend engagement` | FE-1/FE-2/FE-3 | 3 个必要介入点 | 后续引入真实 web 客户端回归 |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：truth gate 与具体实现任务。
- **解耦原因**：truth gate 是“必须证明什么”，action-plan 是“怎么实现”；如果混在一起，closure 会被任务完成率污染。
- **依赖边界**：design 可以定义 evidence shape，但具体命令、文件改动、迁移执行必须留给 action-plan。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：7 truth gates。
- **聚合形式**：统一写在 charter §10，并由本设计作为下游 design 的引用入口。
- **为什么不能分散**：若每个 phase 自定义完成口径，PP6 很难进行最终 public contract sweep。

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 gemini-cli 的做法

- **实现概要**：Gemini 的 turn loop 把模型 stream 事件规范化成 `GeminiEventType`，包括 content、tool request、confirmation、retry、context overflow、blocked/stopped 等状态。
- **亮点**：
  - `Turn.run()` 以 `AsyncGenerator<ServerGeminiStreamEvent>` 输出统一事件流（`context/gemini-cli/packages/core/src/core/turn.ts:252-404`）。
  - tool scheduler 独立管理 queue、active 状态、cancel 与 confirmation（`context/gemini-cli/packages/core/src/scheduler/scheduler.ts:91-134`, `414-460`）。
- **值得借鉴**：
  - nano-agent 的 truth model 也应以 event/state 是否能被前端消费为核心，而不是以后端函数是否存在为核心。
- **不打算照抄的地方**：
  - Gemini 是本地 CLI + core scheduler；nano-agent 必须把同等 truth 映射到 HTTP/WS/D1/DO 组合。

### 4.2 codex 的做法

- **实现概要**：Codex 明确使用 Submission Queue / Event Queue 模型，`Codex` 暴露 submission sender 与 event receiver，`Session` 保存 active turn、mailbox、conversation 等状态。
- **亮点**：
  - protocol 注释直接定义“client and agent”的 SQ/EQ 异步通信模型（`context/codex/codex-rs/protocol/src/protocol.rs:1-5`, `106-116`）。
  - `Codex` 高层接口就是 send submissions / receive events（`context/codex/codex-rs/core/src/codex.rs:399-410`）。
  - `Session` 明确保存 `active_turn`、mailbox、conversation manager 等 loop state（`context/codex/codex-rs/core/src/codex.rs:837-862`）。
- **值得借鉴**：
  - nano-agent 需要把 `active-turn / pending interaction / replay state` 明确为前端可恢复事实。
- **不打算照抄的地方**：
  - 不引入完整 SQ/EQ runtime；当前 6-worker topology 已有 `/input`、WS、D1 truth plane。

### 4.3 claude-code 的做法

- **实现概要**：Claude Code 的 `query()` 是跨 iteration 的 async generator，显式持有 messages、toolUseContext、auto-compact、max-output recovery、transition 等 mutable state。
- **亮点**：
  - `queryLoop()` 把跨 iteration 状态集中在 `State`（`context/claude-code/query.ts:241-280`）。
  - 每轮开始会 yield `stream_request_start`，并在 loop 内处理 compaction、tool result budget、recovery 等（`context/claude-code/query.ts:306-420`）。
- **值得借鉴**：
  - nano-agent 的 truth model 必须包含“turn 仍在运行 / 正在等待 / 已降级 / 已恢复”的状态，而不是只有最终消息。
- **不打算照抄的地方**：
  - Claude Code 是进程内 UI 与 query generator；nano-agent 必须把状态持久化到 DO/D1，并经 public contract 呈现。

### 4.4 横向对比速查表

| 维度 | gemini-cli | codex | claude-code | nano-agent 倾向 |
|------|------------|-------|-------------|------------------|
| loop 表达 | `AsyncGenerator` stream events | SQ/EQ protocol | async generator + mutable State | WS frames + HTTP control plane + D1/DO truth |
| tool/HITL | scheduler + messageBus confirmation | approval/request events | permission hook + UI queue | `approval_policy=ask` 进入 pause-resume |
| context | event 化 overflow/compression | compaction task + analytics | microcompact/autocompact/recovery | compact 后 prompt mutation 可证明 |
| recovery | session storage/resume | thread/session state | resume/backgrounding | replay restore + lagged/degraded contract |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1] 7 truth gates 的统一定义** — 没有统一硬闸，PP1-PP6 会分别 overclaim。
- **[S2] frontend-facing evidence 的定义** — 本阶段的成功对象是前端，不是内部 worker。
- **[S3] cannot-close 判定** — 如果核心 truth 不成立，必须允许诚实 cannot close。
- **[S4] latency baseline 的非硬闸登记** — 防止 functional truth 通过但前端感知不可用。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1] 每个 phase 的实现步骤** — 留给 action-plan；重评条件：设计进入执行。
- **[O2] 新增公共接口字段的 schema 细节** — 留给对应 per-phase design；重评条件：field shape 影响多个 phase。
- **[O3] 平台级 SLO / observability dashboard** — 当前只是 baseline；重评条件：PP5/PP6 发现无 observability 无法验收。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| e2e skeleton | in-scope | 是 truth gate 的第一证据载体 | PP0 action-plan |
| latency threshold | in-scope as baseline | 不做 hard gate，但必须登记超阈值 | PP1/PP3/PP5/PP6 closure |
| full hook catalog | out-of-scope | PP4 只需 user-driven minimal live loop | 下一阶段 |
| internal RPC 全扫 | out-of-scope | PP6 只扫 frontend-facing surfaces | PP6 design |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **7 条 truth gates** 而不是 **按文档/代码任务数量收口**
   - **为什么**：hero-to-pro 已证明“surface 存在”不能代表前端可信。
   - **我们接受的代价**：closure 门槛更高，可能出现 cannot close。
   - **未来重评条件**：如果某 truth gate 被证明不属于产品最小闭环，只能通过 charter 修订移除。

2. **取舍 2**：我们选择 **frontend-facing evidence** 而不是 **内部 substrate evidence**
   - **为什么**：本阶段目标是让前端站在更高起点，而非继续后端自证。
   - **我们接受的代价**：需要 PP6 做 item-by-item docs sweep。
   - **未来重评条件**：下一阶段进入 platform-scale 后再扩大 internal seam audit。

3. **取舍 3**：我们选择 **cannot-close 诚实出口** 而不是 **强行 close-with-known-issues**
   - **为什么**：若 compact / interrupt / replay 任一主线失败，前端 loop 不可信。
   - **我们接受的代价**：可能触发 addendum phase 或 revisit charter。
   - **未来重评条件**：owner 明确降低产品目标，并同步改 truth gates。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| truth gate 变成口号 | action-plan 不写 evidence shape | phase closure 继续 overclaim | 每份 per-phase design 必须写“什么不算完成” |
| latency baseline 被误当硬闸 | review 过度解释 §9.2 | 阻塞本应可 close 的 phase | 明确 baseline 是 alert threshold |
| PP6 变成全仓审计 | contract sweep 扫 internal seam | 阶段膨胀 | 只扫 frontend-facing public surfaces |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：避免每个 phase 都重新争论“什么算完成”。
- **对 nano-agent 的长期演进**：把产品可信度从文档陈述转成 evidence discipline。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：context、hook、reconnect 都以 live-loop truth 而不是功能堆叠为中心。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Truth Gate Registry | 固化 7 条 truth gates 作为所有 phase 的共享判定标准 | ✅ 每个 phase closure 都能引用并对账 |
| F2 | Evidence Shape | 定义 live caller、frontend-visible、degraded contract、docs truth 的证据形态 | ✅ review 不再用 substrate-ready 替代 closure |
| F3 | Cannot-Close Discipline | 明确 cannot close 的条件与后续落点 | ✅ blocker 不会被包装成 known issue |
| F4 | Latency Baseline | 固化非硬闸感知阈值 | ✅ 超阈值必须登记，不会被隐藏 |

### 7.2 详细阐述

#### F1: Truth Gate Registry

- **输入**：charter §10 的 7 条 Primary Exit Criteria。
- **输出**：所有 per-phase design 的验收共同语言。
- **主要调用者**：PP1-PP6 design、action-plan、closure、batch review。
- **核心逻辑**：任何 phase 可以有额外验收，但不得低于对应 truth gate。
- **边界情况**：
  - 若 phase 完成代码但 gate 未绿，closure 必须写 partial/cannot close。
- **一句话收口目标**：✅ **每份 phase closure 都有对应 truth gate verdict。**

#### F2: Evidence Shape

- **输入**：HTTP response、WS frame、D1/DO durable state、e2e observation、client docs。
- **输出**：可引用的 evidence matrix。
- **主要调用者**：reviewer、PP6 docs sweep。
- **核心逻辑**：证据必须能从真实代码路径导出，不引用二手 review 作为事实。
- **边界情况**：
  - 只有 unit test 且无 public surface observation，不足以证明 frontend trust。
- **一句话收口目标**：✅ **每个 truth gate 都能追溯到一手代码与可观测行为。**

#### F3: Cannot-Close Discipline

- **输入**：未满足的 truth gate、不可行原因、残留范围。
- **输出**：`cannot close` 或 addendum/revisit 触发说明。
- **主要调用者**：final closure。
- **核心逻辑**：blocker 不能被写成 non-blocking known issue。
- **边界情况**：
  - 如果 owner 降低目标，必须修 charter，而不是改 closure 文字。
- **一句话收口目标**：✅ **失败也能诚实、可继承、可执行。**

#### F4: Latency Baseline

- **输入**：phase e2e 的观测时间。
- **输出**：超阈值登记与可接受/不可接受判断。
- **主要调用者**：PP1、PP3、PP5、PP6 closure。
- **核心逻辑**：functional truth 是硬闸，latency 是产品感知风险登记。
- **边界情况**：
  - 持续超阈值但 owner 接受，可 close-with-known-issues；不能静默。
- **一句话收口目标**：✅ **frontend trust 覆盖功能与最小感知体验。**

### 7.3 非功能性要求与验证策略

- **性能目标**：沿用 charter §9.2 的 4 个 latency baseline。
- **可观测性要求**：每个 truth gate 至少有一条 public 或 closure-visible evidence。
- **稳定性要求**：replay/compact/fallback 等 degraded path 不得 throw 未文档化错误。
- **安全 / 权限要求**：policy honesty 不能把 stored-not-enforced 写成 active enforced。
- **测试覆盖要求**：每个 phase 至少一条 truth-gate e2e 或等价 integration evidence。
- **验证策略**：PP0 起建立首个 e2e skeleton；PP6 做 `clients/api-docs` item-by-item 对账。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/packages/core/src/core/turn.ts:52-71` | `GeminiEventType` 覆盖 content/tool/confirmation/retry/context overflow/blocked | 把 loop truth 表达成可消费事件 | 不照搬本地事件名 |
| `context/gemini-cli/packages/core/src/core/turn.ts:252-404` | `Turn.run()` 以 async generator yield stream events | 统一 event stream 是 frontend trust 基础 | nano 映射到 WS frame |
| `context/gemini-cli/packages/core/src/scheduler/scheduler.ts:91-134` | scheduler 管理 state/executor/messageBus | tool loop 应独立成状态机 | nano 由 DO/runtime 拆分承接 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/protocol/src/protocol.rs:1-5` | client-agent SQ/EQ protocol | 明确前端与 agent 的异步边界 | nano 不引入完整 SQ/EQ |
| `context/codex/codex-rs/core/src/codex.rs:399-410` | `Codex` send submissions / receive events | public loop 应有清晰 command/event 分界 | 对应 HTTP control + WS event |
| `context/codex/codex-rs/core/src/codex.rs:837-862` | `Session` 持有 active turn、mailbox、conversation | session state truth 必须可恢复 | PP3/PP6 继承 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/query.ts:219-239` | `query()` 是 async generator，返回 terminal | loop 是可迭代过程，不只是一次请求 | nano 以 turn + stream 表达 |
| `context/claude-code/query.ts:241-280` | `State` 保存跨 iteration 状态 | recovery/compact 需要共享状态模型 | nano 用 DO/D1 持久化 |
| `context/claude-code/query.ts:306-420` | 每轮处理 stream start、microcompact、tool result budget | loop truth 包含预算与恢复 | PP2/PP3 继承 |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `workers/agent-core/src/host/runtime-mainline.ts:235-261` | `approval_policy=ask` 仍返回 error | PP1 truth gate 必须修 live caller |
| `workers/agent-core/src/host/runtime-mainline.ts:833-836` | compact 仍 `{ tokensFreed: 0 }` | PP2 必须证明 prompt mutation |
| `packages/nacp-session/src/replay.ts:58-73` | replay out-of-range 直接 throw | PP3 必须改成 lagged/degraded contract |
| `workers/orchestrator-core/src/facade/routes/session-runtime.ts:146-207` | `/runtime` 已有 ETag/If-Match public contract | PP5/PP6 从已有 public surface 收口 |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| D-00-1 | 7 truth gates 是否作为本阶段唯一 hard exit？ | PP1-PP6 closure | 是 | frozen | `docs/charter/plan-pro-to-product.md` §10 |
| D-00-2 | latency baseline 是否作为 hard gate？ | PP1/PP3/PP5/PP6 | 否，作为 alert threshold | frozen | `docs/charter/plan-pro-to-product.md` §9.2 |
| D-00-3 | PP6 是否只扫 frontend-facing surface？ | PP6 | 是 | frozen | `docs/charter/plan-pro-to-product.md` §12 Q3 |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. 7 truth gates 与 charter §10 一致。
2. 所有外部参考均来自 `context/gemini-cli`、`context/codex`、`context/claude-code` 的真实代码位置。
3. 所有 nano-agent 断点均来自当前仓库真实代码位置。
4. 所有影响 action-plan 执行路径的问题都已在本设计或 charter 中回答。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md`
- **需要同步更新的设计文档**：
  - `docs/design/pro-to-product/01-frontend-trust-contract.md`
  - `docs/design/pro-to-product/02-hitl-interrupt-closure.md` 至 `07-api-contract-docs-closure.md`
- **需要进入 QNA register 的问题**：
  - 无；当前 owner/architect 级决策已在 charter 冻结。

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

`Agent Loop Truth Model` 是 pro-to-product 的第一份 cross-cutting design。它不定义某一个接口，而定义本阶段全部接口、runtime、stream、recovery、docs 是否可以诚实封板的共同判据。其复杂度来自跨 worker、跨 stream、跨 docs 的证据一致性，而不是算法本身。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 直接服务“前端可信 live loop” |
| 第一版实现的性价比 | 5 | 设计层冻结口径，避免后续返工 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | 5 | context、hook、reconnect 都共享同一 truth model |
| 对开发者自己的日用友好度 | 4 | 提供清晰 closure 语言，但提高了验收门槛 |
| 风险可控程度 | 4 | 主要风险是 gate 被过度解释，已用 baseline/hard gate 区分缓解 |
| **综合价值** | 5 | 是 PP1-PP6 不再 overclaim 的基础 |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：是否增加 PP6。
  - **A 方观点**：PP5 可直接 closure。
  - **B 方观点**：必须先全量对账 frontend-facing API docs。
  - **最终共识**：新增 PP6，但严格限定为 API contract sweep + frontend docs closure + final closure。

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-05-02` | `GPT-5.5` | 初稿 |
