# Nano-Agent 功能簇设计模板

> 功能簇: `PP1 / HITL Interrupt Closure`
> 讨论日期: `2026-05-02`
> 讨论者: `GPT-5.5`
> 关联调查报告:
> - `docs/charter/plan-pro-to-product.md`
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> 关联 QNA / 决策登记:
> - `docs/charter/plan-pro-to-product.md` §10 T1
> 文档状态: `draft`

---

## 0. 背景与前置约束

- **项目定位回顾**：nano-agent 要支持真实前端运行 agent loop，HITL 不能只是“返回需要权限”的错误；它必须暂停、发出可恢复 request、等待前端 decision、继续或终止。
- **本次讨论的前置共识**：
  - `01-frontend-trust-contract.md` 已定义 frontend-facing contract 只能依赖 public HTTP/WS surface。
  - HP5/HPX5 已建立 7-kind confirmation control plane，但 pro-to-product 必须补齐 runtime loop 与 confirmation plane 的闭环。
- **本设计必须回答的问题**：
  - `ask` policy 如何从错误结果变成 durable interrupt？
  - 前端 decision 如何回到正在等待的 runtime？
  - timeout/cancel/reconnect 后 UI 如何知道 pending truth？
- **显式排除的讨论范围**：
  - 不扩展 7-kind confirmation enum。
  - 不新增 legacy `/permission_mode`。

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`HITL Interrupt Closure`
- **一句话定义**：把工具权限、elicitation、restore/compact 等人工确认从 schema-live 推进到 runtime-live。
- **边界描述**：本功能簇包含 confirmation row、WS request/update、HTTP decision、runtime wait/resume、timeout/superseded；不包含 full UI、policy authoring UX、hook registry。

| 术语 | 定义 | 备注 |
|------|------|------|
| `confirmation row` | `nano_session_confirmations` 中的 durable pending/terminal truth | row-first |
| `interrupt` | runtime 主线暂停等待用户 decision 的状态 | 不能等价于 error |
| `decision` | 前端通过 HTTP 写入的 terminal status | server-only WS frame |
| `compat alias` | legacy permission/elicitation endpoint | 保留但非推荐主路径 |

### 1.2 参考调查报告

- `docs/design/pro-to-product/00-agent-loop-truth-model.md` — T1 HITL truth。
- `docs/design/pro-to-product/01-frontend-trust-contract.md` — public/internal 边界。
- `clients/api-docs/confirmations.md` — 当前 unified control plane 文档。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

PP1 是前端 agent loop 的第一条硬闸：如果工具 ask 仍然返回错误，前端只能展示“失败”，不能展示“等待你确认”。本设计要求 ask/elicitation/restore/compact 共享 confirmation row-first law，但 runtime 只实现本阶段必须闭合的 live caller：`tool_permission` 与 `elicitation`。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| `01-frontend-trust-contract` | `01 → 02` | 强 | 前端只通过 HTTP decision + server WS update |
| `03-context-budget-closure` | `02 ↔ 03` | 中 | `context_compact` 仍 registry-only，后续接 live caller |
| `04-reconnect-session-recovery` | `02 ↔ 04` | 强 | reconnect 后必须能 list pending confirmations |
| `06-policy-reliability-hardening` | `02 ↔ 06` | 强 | runtime policy fallback 的 ask 必须真的 interrupt |
| `07-api-contract-docs-closure` | `02 → 07` | 强 | docs 必须标明 live vs registry-only |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`HITL Interrupt Closure` 是 **agent loop 的人工中断层**，负责 **把 ask/elicitation 从错误或 schema 推进为 durable pending state**，对上游提供 **runtime pause/resume**，对下游要求 **HTTP/WS docs 与 row-first truth 一致**。

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 新增 confirmation kind | tool cancel / custom ask 诱因 | HP5 Q18 已冻结 7-kind | 新 charter 才能改 |
| client→server WS decision | 实时 UI 诱因 | direction matrix 冻结 server-only request/update | SDK 阶段可封装 HTTP |
| full permission editor | Claude/Gemini 支持修改输入 | PP1 最小闭环先 allow/deny/modified | 前端产品设计阶段 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 | 第一版行为 | 未来可能的演进方向 |
|--------|----------|------------|---------------------|
| `decision_payload` | open object | kind-specific payload | typed schemas |
| `expires_at` | optional row field | timeout/sweep basis | SLA/auto-timeout UI |
| `known_kinds` | list response | 7-kind freeze | UI feature flags |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：confirmation row truth 与 runtime wait implementation。
- **解耦原因**：前端/reconnect 可以先读 row truth；runtime 是否仍在线由 recovery 设计处理。
- **依赖边界**：row 写入必须先于 WS emit；decision 写入必须先于 runtime wakeup。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：`D1ConfirmationControlPlane` + `session-control` HTTP routes。
- **聚合形式**：所有 confirmation read/list/decision 都从同一 D1 helper 读取。
- **为什么不能分散**：legacy permission/elicitation 与 unified confirmation 如果各写一套 truth，会导致前端 pending 状态不一致。

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 gemini-cli 的做法

- **实现概要**：Gemini scheduler 在工具确认时设置 `AwaitingApproval`，生成 correlation id，通过 message bus 等待 matching response。
- **亮点**：
  - `awaitConfirmation()` 明确用 `correlationId` 匹配 response，并建议 AbortSignal timeout 防止 zombie listener（`context/gemini-cli/packages/core/src/scheduler/confirmation.ts:51-67`）。
  - confirmation loop 把 tool call 状态更新为 `AwaitingApproval` 并等待 message bus response（`context/gemini-cli/packages/core/src/scheduler/confirmation.ts:155-175`）。
  - policy `ASK_USER` 在 non-interactive 模式直接报错，避免伪装可交互（`context/gemini-cli/packages/core/src/scheduler/policy.ts:90-102`）。
- **值得借鉴**：nano-agent 的 wait 必须有 correlation id、timeout/abort 与显式 pending 状态。
- **不打算照抄的地方**：Gemini 是本地 message bus；nano-agent 必须 durable row + HTTP/WS。

### 4.2 codex 的做法

- **实现概要**：Codex 在 exec policy 中区分 approval policy 是否允许把 prompt 展示给用户，并为 network approval 构造上下文。
- **亮点**：
  - `prompt_is_rejected_by_policy()` 明确当 approval policy 不允许 prompt 时返回 rejection reason（`context/codex/codex-rs/core/src/exec_policy.rs:124-153`）。
  - network ask payload 必须包含 protocol/host 才形成 approval context（`context/codex/codex-rs/core/src/network_policy_decision.rs:26-44`）。
  - denied network policy message 给出 user-facing reason（`context/codex/codex-rs/core/src/network_policy_decision.rs:46-72`）。
- **值得借鉴**：不是所有 ask 都可展示；policy 若禁止 prompt，应成为 explicit deny/reject reason。
- **不打算照抄的地方**：不把 network policy 单独做成 PP1 的新 kind，仍走 existing runtime policy + tool_permission。

### 4.3 claude-code 的做法

- **实现概要**：Claude Code 的 `useCanUseTool` 在 allow/deny/ask 三路中分别处理 config decision、interactive permission、classifier/swarm/coordinator 等路径。
- **亮点**：
  - allow 直接 buildAllow 并记录 decision（`context/claude-code/hooks/useCanUseTool.tsx:37-53`）。
  - deny 记录 reject 并 resolve terminal result（`context/claude-code/hooks/useCanUseTool.tsx:64-91`）。
  - ask 进入 coordinator/swarm/interactive handler，最终回调 resolve（`context/claude-code/hooks/useCanUseTool.tsx:93-168`）。
  - abort/error 会转成 cancelAndAbort，而不是悬挂 promise（`context/claude-code/hooks/useCanUseTool.tsx:171-180`）。
- **值得借鉴**：HITL 的核心是 promise/resume discipline，所有分支必须终结。
- **不打算照抄的地方**：不引入本地 React queue；nano-agent 的 queue 是 D1 row + WS frame。

### 4.4 横向对比速查表

| 维度 | gemini-cli | codex | claude-code | nano-agent 倾向 |
|------|------------|-------|-------------|------------------|
| correlation | `correlationId` | submission/event ids | toolUseID/messageId | `confirmation_uuid/request_uuid` |
| pending state | `AwaitingApproval` | policy prompt | permission queue | D1 `pending` + WS request |
| decision path | message bus | policy amendment | callback resolve | HTTP POST decision |
| timeout/abort | AbortSignal | rejection reason | cancelAndAbort | row `timeout/superseded` + runtime resume |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1] tool_permission runtime interrupt** — `ask` policy 必须暂停并等待 confirmation。
- **[S2] elicitation runtime interrupt** — model/user question 必须统一 row-first。
- **[S3] pending list/reconnect truth** — 前端刷新后能列出 pending confirmations。
- **[S4] timeout/superseded terminal discipline** — 不允许永久 pending。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1] 新 kind 扩展** — 7-kind freeze 不变。
- **[O2] client→server WS decision** — 维持 HTTP decision。
- **[O3] 完整 permission rule editor** — PP5 runtime policy honesty 再处理。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| legacy `/permission/decision` | in-scope compat | 仍 public，但非推荐 | PP6 标注 |
| `checkpoint_restore` confirmation | partial/defer | restore gate 有 first-wave，但 emitter 未全量 | PP3/PP6 |
| `context_compact` confirmation | defer | registry-only | PP2 |
| `tool.call.cancelled` | out-of-scope | Q18 禁止加入 confirmation | workbench/tool-call docs |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **row-first interrupt** 而不是 **runtime-memory-only wait**
   - **为什么**：前端刷新/reconnect 需要 pending truth。
   - **我们接受的代价**：每个 ask 都要 D1 write + WS emit。
   - **未来重评条件**：若引入 dedicated session event store，可优化 read path。

2. **取舍 2**：我们选择 **HTTP decision** 而不是 **WS decision frame**
   - **为什么**：当前 direction matrix 与 docs 已冻结 server-only confirmation frames。
   - **我们接受的代价**：前端需要同时持有 WS subscription 与 HTTP client。
   - **未来重评条件**：协议 v2 才能改。

3. **取舍 3**：我们选择 **先闭合 tool_permission / elicitation** 而不是 **一次接满 7-kind**
   - **为什么**：当前真实 live caller 主要就是这两类；其他 kind 需要各自 phase 语义。
   - **我们接受的代价**：docs 必须诚实标注 registry-only。
   - **未来重评条件**：PP2/PP3/PP5 接入各自 caller。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| row 已 pending 但 runtime 未等待 | emit 路径与 mainline 脱节 | 用户点了 decision 但 agent 不继续 | PP1 必须把 `authorizeToolPlan` ask 接到 wait |
| decision 已写 row 但 wakeup 失败 | downstream RPC 失败 | 前端认为完成，runtime 卡住 | row `superseded` + recovery audit |
| reconnect 后重复提交 | 前端重放 decision | 409 | docs 要求视为 terminal success |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：把“权限错误”与“等待用户”彻底分开。
- **对 nano-agent 的长期演进**：所有人工确认类能力都能共享 row-first substrate。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：compact、restore、fallback 未来不用再发明新 control plane。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Runtime Ask Bridge | `authorizeToolPlan()` ask 不再 error-out | ✅ ask 进入 pending confirmation |
| F2 | Unified Decision Wakeup | HTTP decision 能唤醒等待 runtime | ✅ allow/deny/modified/timeout 都终结 |
| F3 | Pending Truth Read Model | `/confirmations?status=pending` 可恢复 UI | ✅ reconnect 后不丢 pending |
| F4 | Honest Compat Docs | legacy permission/elicitation 标为 alias | ✅ client 迁移路径清晰 |

### 7.2 详细阐述

#### F1: Runtime Ask Bridge

- **输入**：`authorizeToolUse` 返回 `decision: "ask"`。
- **输出**：confirmation row + `session.confirmation.request` + runtime await。
- **主要调用者**：agent-core runtime mainline。
- **核心逻辑**：当前 `workers/agent-core/src/host/runtime-mainline.ts:252-260` 把 ask 映射为 `tool-permission-required` error；PP1 必须替换为 durable wait。
- **边界情况**：non-interactive/no-client 时不能伪 pending，应明确 timeout/deny/degraded。
- **一句话收口目标**：✅ **ask 不再表现为工具失败。**

#### F2: Unified Decision Wakeup

- **输入**：`POST /sessions/{id}/confirmations/{uuid}/decision`。
- **输出**：row terminal + WS update + runtime resume。
- **主要调用者**：orchestrator-core facade、User DO/agent-core wait substrate。
- **核心逻辑**：`session-control.ts:414-449` 已 row-first 写入并 emit update；PP1 要保证对应等待者被唤醒。
- **边界情况**：重复提交 `409 confirmation-already-resolved`，客户端视为终态成功。
- **一句话收口目标**：✅ **前端决策能推动 agent loop 继续。**

#### F3: Pending Truth Read Model

- **输入**：D1 confirmation rows。
- **输出**：list/detail HTTP response。
- **主要调用者**：前端 reconnect/resume。
- **核心逻辑**：`D1ConfirmationControlPlane.list()` 按 session/status 读取 pending；PP1 要确保 live ask 总是先落 row。
- **边界情况**：runtime 已死但 row pending，PP3/PP4 需给 degraded/recovery story。
- **一句话收口目标**：✅ **刷新页面能重新展示待确认项。**

#### F4: Honest Compat Docs

- **输入**：legacy permission/elicitation endpoints 与 unified confirmation docs。
- **输出**：PP6-ready docs truth。
- **主要调用者**：frontend、PP6。
- **核心逻辑**：legacy path 可保留，但推荐路径是 confirmations；docs 必须说明 live/registry-only 差异。
- **边界情况**：当前 docs 对 legacy frame 是否继续发出存在历史表述差异，PP6 必须按代码重核。
- **一句话收口目标**：✅ **前端不会把 compat alias 当作主合同。**

### 7.3 非功能性要求与验证策略

- **性能目标**：permission/elicitation request 首帧 ≤500ms 作为 alert threshold。
- **可观测性要求**：confirmation row、WS frame、HTTP decision 都携带或关联 `trace_uuid`。
- **稳定性要求**：timeout/superseded 必须是 terminal，不允许 infinite pending。
- **安全 / 权限要求**：decision endpoint 必须走 session ownership/auth。
- **测试覆盖要求**：runtime ask bridge、decision wakeup、reconnect list pending、duplicate decision。
- **验证策略**：unit + orchestrator route test + cross-e2e with real WS。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/packages/core/src/scheduler/confirmation.ts:51-67` | correlation + AbortSignal wait | wait lifecycle | nano 用 row + request_uuid |
| `context/gemini-cli/packages/core/src/scheduler/confirmation.ts:155-175` | AwaitingApproval + wait response | pending state | nano 要 public frame |
| `context/gemini-cli/packages/core/src/scheduler/policy.ts:90-102` | ASK_USER non-interactive error | 不伪装可交互 | no-client degraded |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/core/src/exec_policy.rs:124-153` | approval policy prompt rejection | policy honesty | PP5 继承 |
| `context/codex/codex-rs/core/src/network_policy_decision.rs:26-44` | approval context from payload | ask payload 要足够 UI 展示 | tool input/payload |
| `context/codex/codex-rs/core/src/network_policy_decision.rs:46-72` | denied reason | user-facing denial | docs/error-index |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/hooks/useCanUseTool.tsx:37-53` | allow branch resolves | all branches terminal | |
| `context/claude-code/hooks/useCanUseTool.tsx:64-91` | deny branch logs/rejects | explicit denial | |
| `context/claude-code/hooks/useCanUseTool.tsx:93-168` | ask branch interactive handlers | ask is pause/resume | |
| `context/claude-code/hooks/useCanUseTool.tsx:171-180` | abort/error cancels | no hanging promise | timeout/superseded |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `workers/agent-core/src/host/runtime-mainline.ts:235-261` | ask 当前变 `tool-permission-required` error | PP1 最大断点 |
| `workers/agent-core/src/host/do/session-do-runtime.ts:378-397` | legacy permission request + await substrate | 可复用 wait primitive |
| `workers/orchestrator-core/src/confirmation-control-plane.ts:96-131` | create pending row | row-first substrate |
| `workers/orchestrator-core/src/facade/routes/session-control.ts:414-449` | decision row write + WS update | public decision path |
| `packages/nacp-session/src/messages.ts:258-329` | 7-kind / 6-status schema | enum freeze |
| `clients/api-docs/confirmations.md:184-193` | confirmation frames server-only | direction law |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| D-02-1 | `ask` 是否允许继续返回 tool error？ | PP1 | 否，必须 interrupt | proposed | 本设计 |
| D-02-2 | confirmation decision 是否改成 WS 输入？ | PP1/PP6 | 否，维持 HTTP | frozen | `type-direction-matrix.ts` |
| D-02-3 | 是否扩展 confirmation kind？ | PP1 | 否 | frozen | HP5/Q18 |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. `tool_permission` ask 的 runtime bridge 路径清楚。
2. `elicitation` 与 permission 共享 row-first/wakeup 语义。
3. timeout/superseded 终态语义明确。
4. docs 能区分 live caller、registry-only 与 legacy alias。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md`
- **需要同步更新的设计文档**：
  - `03-context-budget-closure.md` 中的 `context_compact` confirmation。
  - `04-reconnect-session-recovery.md` 中 pending confirmation recovery。
  - `07-api-contract-docs-closure.md` 中 docs truth。
- **需要进入 QNA register 的问题**：
  - 无；当前主要是实现断点，不是 owner scope 决策。

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

`HITL Interrupt Closure` 是 pro-to-product 的第一条真正 runtime 产品化门槛。当前代码已经有 D1 row、HTTP route、WS frame 与 agent-core await primitive，但主线工具授权仍把 `ask` 降级成错误。PP1 的价值就是把这些 substrate 接成一个可恢复、可解释、可测试的人工中断闭环。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | agent loop 必需 |
| 第一版实现的性价比 | 5 | substrate 已存在，主要补主线桥接 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | 4 | 统一 confirmation 可复用 |
| 对开发者自己的日用友好度 | 5 | 前端终于能展示“等待确认” |
| 风险可控程度 | 4 | 最大风险是 runtime wakeup/reconnect race |
| **综合价值** | 5 | P0 必做 |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：当前 HP5 control plane 是否已经等于 HITL closed。
  - **A 方观点**：有 `/confirmations` 与 WS frame 即可。
  - **B 方观点**：runtime ask 仍 error-out，不能算 closed。
  - **最终共识**：HP5 是 substrate，PP1 要闭合 runtime-live。

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-05-02` | `GPT-5.5` | 初稿 |
