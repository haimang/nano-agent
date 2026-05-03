# Nano-Agent 功能簇设计模板

> 功能簇: `PP0 / Frontend Trust Contract`
> 讨论日期: `2026-05-02`
> 讨论者: `GPT-5.5`
> 关联调查报告:
> - `docs/charter/plan-pro-to-product.md`
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> 关联 QNA / 决策登记:
> - `docs/charter/plan-pro-to-product.md` §6.4, §10, §12 Q3
> 文档状态: `draft`

---

## 0. 背景与前置约束

- **项目定位回顾**：本阶段的“产品化”不是 UI polish，而是让前端可以用稳定合同驱动 agent loop：连接、输入、等待、恢复、权限、降级、错误与最终状态都必须可解释。
- **本次讨论的前置共识**：
  - `00-agent-loop-truth-model.md` 已冻结 7 条 truth gates。
  - PP6 会对 `clients/api-docs` 做 item-by-item public contract sweep；本设计负责先定义“前端可信”的合同边界。
- **本设计必须回答的问题**：
  - 前端需要依赖哪些 public surfaces 才能运行一个可信 agent loop？
  - 哪些内部 seam 不应被写入 client contract？
- **显式排除的讨论范围**：
  - 不设计具体 React/Vue UI。
  - 不新增 SDK abstraction；当前以 `clients/api-docs` 与 HTTP/WS contract 为准。

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Frontend Trust Contract`
- **一句话定义**：把 7 truth gates 翻译成前端可消费的 HTTP / WS / runtime / degraded / docs 合同。
- **边界描述**：这个功能簇**包含** public surface 分类、前端状态机输入、HTTP/WS 对账、degraded path、FE-1/FE-2/FE-3 介入点；**不包含** 内部 RPC、worker-to-worker seam、UI 组件实现、SDK 提取。

| 术语 | 定义 | 备注 |
|------|------|------|
| `public surface` | 前端可直接调用或订阅的 HTTP/WS 合同 | 由 `orchestrator-core` facade 暴露 |
| `frame truth` | WS frame 的 kind、seq、payload 足以让前端更新状态 | 不要求泄漏内部 worker |
| `runtime truth` | `/runtime` 返回字段与实际执行语义一致 | PP5/PP6 重点 |
| `degraded UX` | 失败时前端能收到明确状态，而非连接断开或未知 throw | reconnect/fallback/compact 必填 |
| `docs truth` | `clients/api-docs` 与真实代码行为一致 | PP6 hard gate |

### 1.2 参考调查报告

- `docs/charter/plan-pro-to-product.md` — §6.4 Frontend Engagement Schedule、§10 Frontend contract truth。
- `docs/design/pro-to-product/00-agent-loop-truth-model.md` — 统一 truth gate 与 evidence shape。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

本设计是 `00` 与 `02-07` 之间的翻译层：`00` 定义什么算真实，`01` 定义这些真实如何被前端消费。它要求后续设计所有新增或修正的语义都必须落到至少一种 frontend-facing evidence：

1. HTTP response / status / error code。
2. WS top-level frame 或 canonical stream event。
3. 可读 runtime/config state。
4. `clients/api-docs` 中的明确说明。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| `00-agent-loop-truth-model` | `00 → 01` | 强 | 提供 7 gates 与 evidence discipline |
| `02-hitl-interrupt-closure` | `01 → 02` | 强 | 前端需要 pending request/update 与 decision contract |
| `03-context-budget-closure` | `01 → 03` | 中 | 前端需要 compact status、degrade 与 latency 感知 |
| `04-reconnect-session-recovery` | `01 → 04` | 强 | 前端需要 last_seen_seq、lagged/degraded 与 state snapshot |
| `05-hook-delivery-closure` | `01 → 05` | 中 | 前端只消费 minimal user-driven hook visibility |
| `06-policy-reliability-hardening` | `01 → 06` | 强 | runtime 字段必须 enforce 或 explicit downgrade |
| `07-api-contract-docs-closure` | `01 → 07` | 强 | PP6 用本设计定义 sweep 边界 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Frontend Trust Contract` 是 **前端可依赖边界层**，负责 **把后端 truth gates 映射为 public contract**，对上游提供 **消费约束**，对下游要求 **所有 public docs 与 runtime behavior 同构**。

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 内部 RPC 文档化 | PP6 “扫描全部接口”容易膨胀 | 前端不直接调用 internal service binding | SDK/admin 阶段再重评 |
| 完整 UI 状态机设计 | frontend trust 命题 | 当前只冻结 backend contract，不替前端实现 UI | 前端项目启动时 |
| SDK 封装 | 产品化诱因 | SDK 会掩盖当前 HTTP/WS truth drift | PP6 后若 docs 全绿再提取 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 | 第一版行为 | 未来可能的演进方向 |
|--------|----------|------------|---------------------|
| WS `seq` / `last_seen_seq` | `session-ws-v1` query + frames | replay 或 lagged/degraded | 多端同步 / persistent stream |
| Runtime ETag | `/runtime` `ETag / If-Match` | optimistic lock | 多客户端协作 |
| `system.error` / structured errors | WS / HTTP error-index | client retry/report UX | Observability dashboard |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：frontend-facing contract 与 internal implementation seam。
- **解耦原因**：如果把 internal RPC 写给前端，后续 worker refactor 会变成 breaking change。
- **依赖边界**：前端只依赖 `orchestrator-core` facade 与 documented WS frames。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：`clients/api-docs`。
- **聚合形式**：PP6 统一对账，所有 public contract 最终回填到该目录。
- **为什么不能分散**：如果 design、action-plan、closure 各写一套接口真相，前端无法判断哪一份权威。

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 gemini-cli 的做法

- **实现概要**：Gemini 在 `Turn.run()` 中把 LLM stream、tool request、confirmation、retry、context overflow 与 blocked/stopped 统一为 `ServerGeminiStreamEvent`。
- **亮点**：
  - 事件枚举直接覆盖前端/CLI 可感知状态（`context/gemini-cli/packages/core/src/core/turn.ts:52-71`）。
  - `ToolCallConfirmation` 是 stream event 的一等成员（`context/gemini-cli/packages/core/src/core/turn.ts:153-156`）。
  - CLI 启动时先初始化 storage，保证 list/resume session 能读取 project identifier（`context/gemini-cli/packages/cli/src/gemini.tsx:524-527`）。
- **值得借鉴**：
  - nano-agent 应把每类前端状态写成明确 frame / error / runtime 字段，而不是让前端从文本里猜。
- **不打算照抄的地方**：
  - Gemini 的前端是本地 Ink CLI；nano-agent 的前端是远程 HTTP/WS client。

### 4.2 codex 的做法

- **实现概要**：Codex protocol 将客户端与 agent 的通信定义为 submission queue / event queue，并通过 app-server-protocol 导出类型。
- **亮点**：
  - protocol 注释明确 client-agent boundary（`context/codex/codex-rs/protocol/src/protocol.rs:1-5`）。
  - `Submission` 有 id 与 trace，用于 correlation（`context/codex/codex-rs/protocol/src/protocol.rs:106-116`）。
  - app-server-protocol 显式 re-export request/response 类型（`context/codex/codex-rs/app-server-protocol/src/lib.rs:17-43`）。
- **值得借鉴**：
  - nano-agent 的 `x-trace-uuid`、WS seq、runtime ETag 应作为 front/back 对账骨架。
- **不打算照抄的地方**：
  - 不引入 Codex 的完整 TS schema generation pipeline；PP6 先维护 markdown docs truth。

### 4.3 claude-code 的做法

- **实现概要**：Claude Code 把 resume、backgrounding、query generator 和 permission UI 都放在本地应用状态中，前端/CLI 直接消费这些状态。
- **亮点**：
  - `/resume` 从 logs 中筛选可恢复会话并处理 cross-project 情况（`context/claude-code/commands/resume/resume.tsx:107-170`）。
  - background session hook 会同步 foregrounded task messages、loading state 与 abort controller（`context/claude-code/hooks/useSessionBackgrounding.ts:76-144`）。
- **值得借鉴**：
  - nano-agent 必须向远程前端提供等价的“当前 session state”与恢复状态，而不是只给历史消息。
- **不打算照抄的地方**：
  - 不把本地 React AppState 搬到后端；后端只提供 durable state + stream contract。

### 4.4 横向对比速查表

| 维度 | gemini-cli | codex | claude-code | nano-agent 倾向 |
|------|------------|-------|-------------|------------------|
| 前端事件 | `ServerGeminiStreamEvent` | Event Queue | React/AppState + stream | WS top-level frame + stream event |
| session resume | storage-backed session data | thread/session protocol | logs picker + background tasks | `last_seen_seq` + state snapshot + degraded |
| config contract | local config | typed app-server protocol | AppState/settings | `/runtime` ETag + docs truth |
| docs 来源 | code/docs mixed | generated schema possible | source-driven local UI | PP6 item-by-item markdown docs |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1] Public surface taxonomy** — PP6 必须知道扫什么。
- **[S2] Frontend state inputs** — 前端至少需要 phase、active turn、pending interaction、runtime、stream seq 与 degraded/error。
- **[S3] Docs truth law** — `clients/api-docs` 是 frontend contract 的权威输出。
- **[S4] FE engagement checkpoints** — 防止后端单边定义 frontend trust。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1] Internal RPC / worker-to-worker seam docs** — 前端不可直接调用；重评条件：SDK/admin 阶段。
- **[O2] 完整 UI component spec** — 当前是 backend contract design；重评条件：前端 repo 启动。
- **[O3] 自动 schema generation** — 当前成本超过收益；重评条件：PP6 发现 markdown docs 无法维持一致性。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `/sessions/{id}/runtime` | in-scope | 前端直接消费，且影响 policy truth | PP5/PP6 |
| `ORCHESTRATOR_CORE` RPC | out-of-scope | internal binding | 不进 client docs |
| `session.confirmation.*` frame | in-scope | HITL UI 必需 | PP1/PP6 |
| hook internal audit | defer | 不是最小 frontend-visible path | PP4 secondary |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **public facade as contract** 而不是 **把 worker topology 暴露给前端**
   - **为什么**：6-worker topology 是后端实现细节，前端只应依赖 `orchestrator-core`。
   - **我们接受的代价**：facade 必须承担更多 envelope / error / docs consistency。
   - **未来重评条件**：如果抽 SDK，也应从 facade contract 生成。

2. **取舍 2**：我们选择 **HTTP + WS 双合同** 而不是 **只靠 WS stream**
   - **为什么**：runtime/config/decision/list/read model 更适合 HTTP；progress/replay 更适合 WS。
   - **我们接受的代价**：PP6 必须对两套 transport profile 做一致性审计。
   - **未来重评条件**：前端确认为纯 WS 模式，但当前不成立。

3. **取舍 3**：我们选择 **docs truth hard gate** 而不是 **docs as afterthought**
   - **为什么**：前端实际按 docs 开发。
   - **我们接受的代价**：PP6 成为正式 phase。
   - **未来重评条件**：建立自动 schema/doc generation 后再简化。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| 前端参与过晚 | FE-1/FE-2 未执行 | PP6 才发现 contract 不可用 | §6.4 三时点必须回填 closure |
| docs 与代码漂移 | PP1-PP5 改 public surface 未同步 | client 误用接口 | PP6 item-by-item sweep |
| internal seam 泄漏 | docs 写入 service binding/RPC | 后续 refactor 破坏前端 | PP6 只扫 frontend-facing surfaces |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：明确“写给前端的 truth”与“内部实现细节”的边界。
- **对 nano-agent 的长期演进**：未来 SDK、web client、multi-device 都能继承同一 public contract。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：context/recovery/hook 不再只是后端功能，而是前端可消费状态。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Public Surface Taxonomy | 定义 HTTP / WS / runtime / docs 的 frontend-facing 范围 | ✅ PP6 有明确 sweep 边界 |
| F2 | Frontend State Minimum | 定义前端最小状态输入 | ✅ 前端不用猜 active/pending/recovered |
| F3 | Degraded Contract Law | 定义失败/降级必须可文档化 | ✅ throw/unknown 不能作为 UX |
| F4 | Docs Truth Handoff | 规定所有最终合同进入 `clients/api-docs` | ✅ docs 成为最终 contract |

### 7.2 详细阐述

#### F1: Public Surface Taxonomy

- **输入**：facade HTTP routes、WS frames、runtime config、client docs。
- **输出**：PP6 sweep list。
- **主要调用者**：PP6、frontend lead、reviewer。
- **核心逻辑**：凡前端直接调用/订阅/依赖的内容都 in-scope；internal RPC out-of-scope。
- **边界情况**：
  - Debug routes 如果客户端 inspector 使用，则属于 frontend-facing。
- **一句话收口目标**：✅ **所有 public surfaces 都能归类到 docs。**

#### F2: Frontend State Minimum

- **输入**：session status、WS seq、runtime config、pending confirmation/elicitation、reconnect state。
- **输出**：最小前端状态模型。
- **主要调用者**：PP1、PP3、PP6。
- **核心逻辑**：前端至少知道当前 phase、active turn、pending interaction、last seq、runtime version、degraded status。
- **边界情况**：
  - 无法恢复完整 replay 时，也必须返回 lagged/degraded contract。
- **一句话收口目标**：✅ **前端刷新后仍能重建可解释 UI。**

#### F3: Degraded Contract Law

- **输入**：replay out-of-range、fallback、retry、compact failed、policy downgrade。
- **输出**：明确 code/status/frame/docs。
- **主要调用者**：PP2、PP3、PP5。
- **核心逻辑**：degraded 是一等状态，不是异常泄漏。
- **边界情况**：
  - retry 内部成功但前端无可见性时，需至少在 PP5/PP6 登记 truth surface。
- **一句话收口目标**：✅ **所有关键失败都能被前端处理。**

#### F4: Docs Truth Handoff

- **输入**：PP1-PP5 的代码事实与 closure。
- **输出**：PP6 更新后的 `clients/api-docs`。
- **主要调用者**：PP6。
- **核心逻辑**：docs 不引用愿景，只引用真实代码行为。
- **边界情况**：
  - 如果代码与设计不一致，docs 写代码事实，closure 记录 drift。
- **一句话收口目标**：✅ **前端按 docs 开发不会踩 fake-live contract。**

### 7.3 非功能性要求与验证策略

- **性能目标**：遵守 charter §9.2 latency baseline，并登记超阈值。
- **可观测性要求**：每个 public contract 要能关联 `trace_uuid` 或等价排查信息。
- **稳定性要求**：WS reconnect、HTTP retry、runtime conflict 都有 documented handling。
- **安全 / 权限要求**：前端不得依赖 internal worker route；runtime policy 不得 overclaim。
- **测试覆盖要求**：PP6 至少有 route/docs/item-by-item audit evidence。
- **验证策略**：FE-1/FE-2/FE-3 三次介入，加 PP6 docs sweep。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/packages/core/src/core/turn.ts:52-71` | 统一事件枚举 | frontend-facing event taxonomy | 映射到 WS frame |
| `context/gemini-cli/packages/core/src/core/turn.ts:252-404` | `Turn.run()` yield events/errors/retry | stream contract 不泄漏底层 API | nano 要补 degraded |
| `context/gemini-cli/packages/cli/src/gemini.tsx:524-527` | storage 初始化支撑 session list/resume | frontend state 依赖 durable storage | nano 用 D1/DO |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/protocol/src/protocol.rs:1-5` | client-agent protocol | 明确 contract 边界 | 不照搬协议 |
| `context/codex/codex-rs/protocol/src/protocol.rs:106-116` | `Submission` id + trace | correlation / trace law | nano 用 `x-trace-uuid` |
| `context/codex/codex-rs/app-server-protocol/src/lib.rs:17-43` | re-export typed protocol | contract 可生成/可审计 | nano 暂用 docs sweep |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/commands/resume/resume.tsx:107-170` | resume session picker / cross-project handling | resume 是前端体验而非后端细节 | nano 需要 state snapshot |
| `context/claude-code/hooks/useSessionBackgrounding.ts:76-144` | foreground/background task state sync | detached/recovery 要给 UI 明确状态 | PP3 继承 |
| `context/claude-code/query.ts:365-420` | query loop 处理 compact/budget state | 前端 trust 需要 budget/recovery truth | PP2/PP3 继承 |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `clients/api-docs/README.md:1-8` | 当前 docs 明确 client 只连 `orchestrator-core` | facade owner law |
| `clients/api-docs/session-ws-v1.md:13-22` | WS connect 支持 `last_seen_seq` | reconnect contract 已有文档入口 |
| `clients/api-docs/session-ws-v1.md:57-75` | frame seq 与 13-kind catalog | PP6 必须重新核对 |
| `clients/api-docs/runtime.md:40-47` | `/runtime` decision order + ETag law | PP5/PP6 必须保持 honest |
| `workers/orchestrator-core/src/facade/routes/session-runtime.ts:200-265` | PATCH `If-Match`、version conflict、emit `session.runtime.update` | public contract 有真实代码支撑 |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| D-01-1 | 前端是否只依赖 `orchestrator-core` facade？ | 全部 client docs | 是 | frozen | `clients/api-docs/README.md` |
| D-01-2 | PP6 是否只扫 frontend-facing public surfaces？ | PP6 | 是 | frozen | charter §12 Q3 |
| D-01-3 | per-phase docs 是否必须在 PP0 全部完成？ | PP0/PP1-PP6 | 否，JIT | frozen | charter §13.4 |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. 明确 public/internal 边界。
2. FE-1/FE-2/FE-3 的最低输出可被 closure 引用。
3. PP6 sweep 范围可以从本设计导出。
4. 所有影响 action-plan 执行路径的问题都已在本设计或 charter 中回答。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md`
- **需要同步更新的设计文档**：
  - `docs/design/pro-to-product/02-hitl-interrupt-closure.md`
  - `docs/design/pro-to-product/04-reconnect-session-recovery.md`
  - `docs/design/pro-to-product/07-api-contract-docs-closure.md`
- **需要进入 QNA register 的问题**：
  - 无。

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

`Frontend Trust Contract` 是 nano-agent 后端与后续前端之间的最小可信协议设计。它不追求“接口越多越完整”，而追求每一个已经公开或即将公开的 surface 都能被前端按文档、安全地消费。它的复杂度来自 HTTP/WS/D1/DO 多层事实必须最终聚合到同一份 `clients/api-docs`。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 直接服务 frontend trust |
| 第一版实现的性价比 | 5 | 不新增 SDK，只冻结 contract discipline |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | 4 | 为 reconnect/context/hook 的前端消费提供边界 |
| 对开发者自己的日用友好度 | 4 | 降低前端对后端内部状态的猜测 |
| 风险可控程度 | 4 | 风险在 docs drift，PP6 已设硬闸 |
| **综合价值** | 5 | 是 PP6 contract closure 的前提 |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：是否需要在 PP6 前就定义 frontend contract。
  - **A 方观点**：PP6 再扫即可。
  - **B 方观点**：PP1-PP5 写设计时必须先知道前端消费边界。
  - **最终共识**：`01` 先冻结 contract law，PP6 负责最终 item-by-item 对账。

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-05-02` | `GPT-5.5` | 初稿 |
