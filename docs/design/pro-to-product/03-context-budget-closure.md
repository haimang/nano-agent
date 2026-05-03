# PP2 / Context Budget Closure

> 功能簇: `PP2 / Context Budget Closure`
> 讨论日期: `2026-05-02`
> 讨论者: `GPT-5.5`
> 关联调查报告:
> - `docs/charter/plan-pro-to-product.md`
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> 关联 QNA / 决策登记:
> - `docs/charter/plan-pro-to-product.md` §10 T2
> 文档状态: `draft`

---

## 0. 背景与前置约束

- **项目定位回顾**：前端要运行长会话，就必须知道 context 是否接近窗口、何时 compact、compact 后保留了什么，以及失败时是否还能继续。
- **本次讨论的前置共识**：
  - 当前已有 context probe/layers/compact preview/job public surface。
  - 当前 agent-core runtime compact seam 仍是 no-op，不能把 context-core preview/job 等同于 runtime auto-compact。
- **本设计必须回答的问题**：
  - token budget 的 truth owner 是谁？
  - manual compact 与 auto compact 的边界如何冻结？
  - compact 后如何形成 durable boundary，而不是只发 UI 提示？
- **显式排除的讨论范围**：
  - 不引入新 worker。
  - 不要求 PP2 完成高质量语义摘要模型；第一版可用 deterministic summary，但必须 honest。

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Context Budget Closure`
- **一句话定义**：把 context usage/probe/compact 从“可查询 surface”推进到 agent loop 可依赖的 budget gate。
- **边界描述**：包含 context probe、layers、manual compact、auto compact trigger law、compact boundary、protected fragments、degraded/error；不包含记忆系统、RAG 检索、复杂语义压缩算法。

| 术语 | 定义 | 备注 |
|------|------|------|
| `budget` | model context_window、effective pct、reserve 与当前 usage | 前端与 runtime 共同消费 |
| `compact boundary` | compact 后写入的 checkpoint + context snapshot | durable truth |
| `protected fragment` | compact 时不能丢失的 `<model_switch>` / `<state_snapshot>` 等片段 | 当前 preview 已识别 |
| `manual compact` | 前端/用户触发的 compact | PP2 必须 live |
| `auto compact` | runtime 根据 budget 自动触发 compact | PP2 至少要 honesty + gate |

### 1.2 参考调查报告

- `clients/api-docs/context.md` — 当前 probe/layers/compact public contract。
- `docs/design/pro-to-product/00-agent-loop-truth-model.md` — T2 context truth。
- `docs/design/pro-to-product/01-frontend-trust-contract.md` — budget/degraded 的前端合同边界。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

PP2 是从“可以发起长会话”到“可以可靠继续长会话”的分水岭。它不只要求一个 `/context/probe`，而要求 LLM request 前知道是否超窗、manual compact 能写 durable boundary、runtime auto compact 不再 overclaim。当前 context-core 的 durable read/preview/commit substrate 已经存在，但 agent-core `requestCompact()` 返回 `{ tokensFreed: 0 }`，且 LLM request builder 只做 capability validation，没有 token-window preflight。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| `01-frontend-trust-contract` | `01 → 03` | 强 | 前端要消费 budget/degraded |
| `02-hitl-interrupt-closure` | `03 ↔ 02` | 中 | `context_compact` confirmation 仍 registry-only |
| `04-reconnect-session-recovery` | `03 ↔ 04` | 强 | compact boundary 影响 replay/recovery |
| `06-policy-reliability-hardening` | `03 ↔ 06` | 中 | runtime 不得把 no-op compact 标成成功 |
| `07-api-contract-docs-closure` | `03 → 07` | 强 | docs 必须标记 auto/manual live 状态 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Context Budget Closure` 是 **长会话安全阀**，负责 **把 token budget、compact preview、compact boundary 与 runtime preflight 接成闭环**，对上游提供 **可继续运行的上下文**，对下游要求 **前端可见的 budget/degraded truth**。

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 高质量 LLM 摘要模型 | Claude/Codex compact precedent | PP2 首要是 truth 与 boundary，不是摘要质量 | PP2 closed 后优化 |
| 新 `nano_compact_jobs` 表 | job 管理诱因 | 当前复用 checkpoint 已冻结 | 若 checkpoint 承载不足再迁移 |
| 完整 memory/RAG | context 命题易膨胀 | 超出 pro-to-product | 独立 product phase |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 | 第一版行为 | 未来可能的演进方向 |
|--------|----------|------------|---------------------|
| `summary_text` | compact snapshot payload | deterministic summary | LLM summary / memory |
| `protected_fragment_kinds` | preview/commit payload | model/state tags | tool-specific retention law |
| `preview_uuid` | request echo | informational | 60s idempotency cache |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：context-core budget computation 与 agent-core LLM execution。
- **解耦原因**：context-core 是 durable truth/projector，agent-core 是 runtime executor；两者通过 explicit RPC/contract 耦合，不共享内存。
- **依赖边界**：agent-core 只依赖 public/internal RPC 返回的 budget/compact decision，不直接查询 D1。
- **D1 纪律**：PP2 默认 zero migration；若 checkpoint lineage 无法承载 compact truth，必须按 charter §4.5 申请受控例外，而不是默认新增 compact jobs 表。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：`ContextDurableState`。
- **聚合形式**：orchestrator-core 读取 D1 session/history/usage/model，context-core 做 probe/layers/preview/commit。
- **为什么不能分散**：如果 runtime 用一套估算、frontend probe 用另一套估算，会出现 UI 说可继续但 LLM 实际超窗。

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 gemini-cli 的做法

- **实现概要**：Gemini 把 context overflow 作为 stream event 暴露，并在 turn stream 中区分 error、retry、cancel、overflow。
- **亮点**：
  - `GeminiEventType.ContextWindowWillOverflow` 是一等事件（`context/gemini-cli/packages/core/src/core/turn.ts:52-67`）。
  - `Turn.run()` 在异常路径中把 user cancelled、invalid stream、structured error 分别 yield（`context/gemini-cli/packages/core/src/core/turn.ts:361-402`）。
- **值得借鉴**：context overflow/degrade 必须成为 event，不应只在日志里出现。
- **不打算照抄的地方**：Gemini 的 chat compression 事件在本地 core 内完成；nano-agent 必须写 durable D1 boundary。

### 4.2 codex 的做法

- **实现概要**：Codex 将 compact 当作一个独立 turn/task，记录 analytics、发送 turn item、处理 context-window-exceeded、重试和 history replacement。
- **亮点**：
  - manual compact 会先发 `TurnStarted`，携带 `model_context_window`（`context/codex/codex-rs/core/src/compact.rs:91-103`）。
  - compact inner 会 clone history、记录输入、发 `ContextCompactionItem` started（`context/codex/codex-rs/core/src/compact.rs:150-166`）。
  - context window exceeded 时逐个裁剪 oldest history，并向用户通知 trim 行为（`context/codex/codex-rs/core/src/compact.rs:214-229`）。
- **值得借鉴**：compact 是可观察任务，不是无声删除历史。
- **不打算照抄的地方**：不在 PP2 复制 Codex 的完整 Responses compact loop；先做 durable boundary + frontend truth。

### 4.3 claude-code 的做法

- **实现概要**：Claude Code 在 query loop 中先做 tool-result budget、snip、microcompact，再考虑 autocompact；手动 `/compact` 有 session-memory、reactive、traditional 多路径。
- **亮点**：
  - query loop 在请求前应用 tool result budget、snip 与 microcompact（`context/claude-code/query.ts:365-419`）。
  - `/compact` 先过滤 compact boundary 后的消息，再尝试 session memory/reactive/traditional compaction（`context/claude-code/commands/compact/compact.ts:44-108`）。
  - compact 失败会区分 abort、not enough messages、incomplete response 与 generic error（`context/claude-code/commands/compact/compact.ts:125-135`）。
- **值得借鉴**：预算治理应该在 LLM request 前发生，而不是失败后补救。
- **不打算照抄的地方**：不引入多套 compaction mode；PP2 保持单一 durable path。

### 4.4 横向对比速查表

| 维度 | gemini-cli | codex | claude-code | nano-agent 倾向 |
|------|------------|-------|-------------|------------------|
| overflow visibility | stream event | error/event | query preflight | WS `compact.notify` / context probe |
| compact execution | chat compression | compact turn/task | micro/reactive/traditional | context-core durable boundary |
| runtime preflight | core turn | turn context | query loop | agent-core before LLM invoke |
| truth storage | local chat | session history | local/session files | D1 history/snapshot/checkpoint |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1] Runtime budget preflight** — LLM request 前必须读取/计算 budget。
- **[S2] Manual compact live** — `/context/compact` 写 compact boundary + stream notify。
- **[S3] Auto compact honesty** — 若 auto 未接线，docs/API 不得声称 live。
- **[S4] Protected fragment law** — `<model_switch>` / `<state_snapshot>` 不得被 silent drop。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1] 复杂语义 memory** — 与 context budget 不同。
- **[O2] 新 job table** — 当前复用 checkpoint。
- **[O3] Prompt optimizer** — 不解决模型效果，只解决可继续运行。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `context_compact` confirmation | defer / registry-only | enum 已有但 caller 未 live；不计入 PP2 closure evidence | PP2 诚实标注，PP6 docs 回填 |
| `force=true` compact | in-scope | manual compact API 已支持 body | PP2 |
| 60s preview cache | out-of-scope first wave | docs 已标 not implemented | PP6 可继续标注 |
| model context_window registry | in-scope | budget 必须使用模型 truth | PP2/PP5 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **durable compact boundary** 而不是 **只改内存 prompt**
   - **为什么**：reconnect/replay/前端刷新都需要知道 compact 后的 truth。
   - **我们接受的代价**：compact 要写 snapshot/checkpoint/message 多表。
   - **未来重评条件**：若建立 event-sourced context store，可调整写法。

2. **取舍 2**：我们选择 **runtime preflight** 而不是 **LLM 超窗后重试**
   - **为什么**：Cloudflare/LLM 失败成本高，前端体验差。
   - **我们接受的代价**：agent-core 需调用 context-core 或共享 budget helper。
   - **未来重评条件**：模型 API 提供稳定 token-count endpoint。

3. **取舍 3**：我们选择 **显式 degraded 作为未接线告警** 而不是 **把 `{tokensFreed:0}` 当成功**
   - **为什么**：当前 `requestCompact()` no-op 会误导前端，但 degraded 也不能替代 charter T2 的 prompt mutation 硬闸。
   - **我们接受的代价**：若工程上只能做到 degraded，则 PP2 不能宣称 closure，除非 charter 同步修订。
   - **未来重评条件**：agent-core compact 真接线并能证明 prompt 缩减。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| budget 估算过低 | char/4 粗估 | LLM 仍超窗 | 保守阈值 + response reserve |
| compact summary 丢关键信息 | deterministic summary 简化 | long session 语义退化 | protected fragments + user-visible warning |
| runtime 与 probe 分叉 | agent-core 不读 context-core | UI/实际不一致 | PP2 要统一 owner |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：明确 HP3 first-wave 与 PP2 closure 的差距。
- **对 nano-agent 的长期演进**：为 memory、restore、multi-session replay 提供 compact boundary。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：context 不再只是探针，而是 agent loop 安全阀。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Budget Owner Unification | 统一 probe 与 runtime budget | ✅ UI 与 runtime 不分叉 |
| F2 | Manual Compact Boundary | `/context/compact` 真实写 durable boundary | ✅ compact 后可恢复 |
| F3 | Runtime Compact Bridge | agent-core no-op compact seam 被替换 | ✅ 超窗前有处理 |
| F4 | Context Docs Honesty | docs 标明 auto/manual live 状态 | ✅ 前端不会误信 auto compact |

### 7.2 详细阐述

#### F1: Budget Owner Unification

- **输入**：D1 usage、model profile、history、context snapshots。
- **输出**：probe/layers/runtime preflight 共享 budget。
- **主要调用者**：context-core、agent-core、frontend。
- **核心逻辑**：`resolveBudget()` 当前用 model `context_window/effective_context_pct/auto_compact_token_limit` 算 needCompact；PP2 要让 runtime 使用同一结果。
- **边界情况**：无 model row 时使用默认 profile，但 docs 必须标明 default 行为。
- **一句话收口目标**：✅ **同一 session 只有一套 context budget truth。**

#### F2: Manual Compact Boundary

- **输入**：preview/trigger body `{force, preview_uuid, label}` 与 durable state。
- **输出**：compact snapshot、checkpoint、`compact.notify` stream event。
- **主要调用者**：前端、context-core。
- **核心逻辑**：`createCompactBoundaryJob()` 已写 snapshot/checkpoint/message；PP2 要确认输出 shape 与 docs 对齐。
- **边界情况**：session 非 active/detached 时返回 blocked，不应伪成功。
- **一句话收口目标**：✅ **manual compact 是 durable operation。**

#### F3: Runtime Compact Bridge

- **输入**：LLM 前 budget preflight 或 context-core compact result。
- **输出**：runtime 阻止超窗或触发 compact 后继续。
- **主要调用者**：agent-core。
- **核心逻辑**：当前 `runtime-mainline.ts:833-836` 返回 `{ tokensFreed: 0 }`；PP2 closure 必须把它替换为能证明下一次 LLM request prompt 真实缩减的 compact bridge。显式 degraded 只能作为 fail-visible fallback，不能替代 charter T2，除非 charter 同步修订。
- **边界情况**：compact not needed、compact failed、compact blocked 都是不同状态。
- **一句话收口目标**：✅ **agent loop 不再假装 compact 成功。**

#### F4: Context Docs Honesty

- **输入**：context API 与 runtime truth。
- **输出**：PP6-ready docs。
- **主要调用者**：frontend、PP6。
- **核心逻辑**：docs 中 `auto-compact not-wired` 必须随代码事实更新；如果 PP2 接线，PP6 改成 live。
- **边界情况**：preview cache、context_compact confirmation 不应写成 live。
- **一句话收口目标**：✅ **docs 不 overclaim context capability。**

### 7.3 非功能性要求与验证策略

 - **性能目标**：compact 完成或 explicit degrade ≤3s alert threshold；probe/preview 不是 charter latency baseline，本设计只要求其不额外放大 compact 路径。
- **可观测性要求**：compact.notify、job read、trace_uuid、tokens_before/after。
- **稳定性要求**：compact failed/blocked 不得破坏原会话。
- **安全 / 权限要求**：context routes 必须 auth + session ownership。
- **测试覆盖要求**：budget computation、manual compact writes、runtime preflight/no-op replacement、docs consistency。
- **验证策略**：worker unit + route tests + long-conversation cross-e2e。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/packages/core/src/core/turn.ts:52-67` | `ContextWindowWillOverflow` event | overflow 是一等状态 | |
| `context/gemini-cli/packages/core/src/core/turn.ts:361-402` | cancel/error structured yield | context failure 可恢复展示 | |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/core/src/compact.rs:91-103` | compact turn started includes context window | compact 可观察 | |
| `context/codex/codex-rs/core/src/compact.rs:150-166` | clone history + compaction item | compact 是任务 | |
| `context/codex/codex-rs/core/src/compact.rs:214-229` | context exceeded trim oldest + event | degraded/trim 要告知 | |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/query.ts:365-419` | request 前 budget/snip/microcompact | preflight 优先 | |
| `context/claude-code/commands/compact/compact.ts:44-108` | compact boundary 后消息 + 多路径 compact | compact 输入边界 | |
| `context/claude-code/commands/compact/compact.ts:125-135` | compact error 分类 | 不吞失败 | |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `workers/context-core/src/control-plane.ts:176-198` | budget resolve | 当前 budget owner 候选 |
| `workers/context-core/src/control-plane.ts:307-379` | compact preview | deterministic preview |
| `workers/context-core/src/index.ts:308-370` | triggerCompact RPC | manual compact entry |
| `workers/orchestrator-core/src/context-control-plane.ts:394-511` | write snapshot/checkpoint/compact.notify | durable boundary |
| `workers/agent-core/src/host/runtime-mainline.ts:833-836` | `requestCompact()` returns 0 | 必须修的 no-op |
| `workers/agent-core/src/llm/request-builder.ts:34-120` | capability validation only | 缺 token-window preflight |
| `clients/api-docs/context.md:196-207` | deferred list | PP6 docs honesty baseline |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| D-03-1 | 是否新增 compact jobs 表？ | PP2 | 否，复用 checkpoint | frozen | HPX-O2 / current docs + `docs/design/pro-to-product/PPX-qna.md` Q9 |
| D-03-2 | auto compact 未接线时是否可写 live？ | PP2/PP6 | 否 | frozen | `docs/design/pro-to-product/PPX-qna.md` Q10 |
| D-03-3 | PP2 是否必须引入 LLM summary？ | PP2 | 否，先 truth/boundary | frozen | `docs/design/pro-to-product/PPX-qna.md` Q11 |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. budget owner 与 runtime preflight 路径明确。
2. manual compact 写 durable boundary 且可读 job。
3. auto compact live/not-live 表述诚实。
4. protected fragment 与 compact failure 有前端可见处理。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/pro-to-product/PP2-context-budget-closure-action-plan.md`
- **需要同步更新的设计文档**：
  - `04-reconnect-session-recovery.md` 的 compact boundary replay。
  - `07-api-contract-docs-closure.md` 的 context docs sweep。
- **需要进入 QNA register 的问题**：
  - 无。

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

`Context Budget Closure` 的核心不是“做一个漂亮摘要”，而是消灭长会话中的 fake safety：probe 可以说需要 compact，runtime 却继续发超窗请求；compact seam 可以返回 0，却被当成功；docs 可以写 auto compact，却没有 caller。PP2 要把这些表述统一成 durable、可观察、可恢复的 context truth。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 长会话必需 |
| 第一版实现的性价比 | 4 | substrate 多，但 runtime bridge 仍需谨慎 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | 5 | compact boundary 是后续 memory/replay 基础 |
| 对开发者自己的日用友好度 | 4 | 前端可解释 budget |
| 风险可控程度 | 3 | token 估算与 summary 质量有天然风险 |
| **综合价值** | 5 | P0 必做 |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：是否只保留 manual compact，不做 runtime preflight。
  - **A 方观点**：manual compact 足够，前端提醒用户。
  - **B 方观点**：agent loop 仍可能自动超窗失败。
  - **最终共识**：manual compact 与 runtime preflight 都在 PP2 scope；auto compact 不能 overclaim。

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-05-02` | `GPT-5.5` | 初稿 |
