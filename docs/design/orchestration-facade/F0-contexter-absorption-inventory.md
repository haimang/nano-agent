# Nano-Agent 功能簇设计模板

> 功能簇: `F0 Contexter Absorption Inventory`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/plan-orchestration-facade.md`、`docs/eval/after-foundations/smind-contexter-learnings.md`、`context/smind-contexter/src/{chat.ts,engine_do.ts}`
> 文档状态: `draft (reviewed, no QNA deltas)`

---

## 0. 背景与前置约束

`smind-contexter` 是本阶段最容易被“概念性吸收”而非“文件级吸收”的来源。r1 之前，charter 容易停留在 “吸收 gateway / user DO 思想”；r2 已经把问题收紧到 **adopt / adapt / defer / discard**。这份 design 文档的目标，就是把这种收紧变成稳定 inventory，避免后续 F1/F2 实现一边写、一边把 SQLite/CICP/RAG 偷渡进来。

- **项目定位回顾**：本阶段的重点不是复制 contexter，而是借它完成 `orchestrator.core` 的最小 façade 组装。
- **本次讨论的前置共识**：
  - NACP 才是 nano-agent 的协议真相
  - `orchestrator.core` first-wave 只需要 minimal state / auth / relay / seed
  - first-wave 不吸收 `db_do.ts`
  - first-wave 不吸收 `context/*` / `ai/*` / `rag/*`
- **显式排除的讨论范围**：
  - richer memory / SQLite domain
  - CICP 协议复用
  - Director / Producer / Writer 业务层吸收

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`F0 Contexter Absorption Inventory`
- **一句话定义**：定义 orchestration-facade 阶段允许从 `smind-contexter` 吸收什么、如何吸收、以及哪些东西必须显式不吸收。
- **边界描述**：本功能簇**包含**文件级 adopt/adapt/defer/discard inventory；**不包含**更一般的 Cloudflare substrate 抽取计划。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| adopt-as-is | 代码可基本原样迁入，仅做轻量接口适配 | 例如 `jwt.ts` |
| adapt-pattern | 代码结构 / 方法论可借，但需按本仓协议与类型重写 | 例如 `withAuth` / WS sessions map |
| defer | 当前不吸收，但承认其未来价值 | 例如 `db_do.ts` |
| discard | 本阶段明确不吸收 | 例如 CICP / RAG |

### 1.2 参考调查报告

- `docs/plan-orchestration-facade.md` — §5
- `docs/eval/after-foundations/smind-contexter-learnings.md`
- `context/smind-contexter/src/chat.ts`
- `context/smind-contexter/src/engine_do.ts`

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **外部样本约束器** 的角色。
- 它服务于：
  - `orchestrator.core` 实现者
  - code review / future refactor
- 它依赖：
  - first-wave `orchestrator.core` scope
  - NACP protocol truth
- 它被谁依赖：
  - F1 middleware / user DO implementation
  - F2 attach / reconnect
  - F4 authority policy（部分）

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| JWT ingress | adopt/adapt | 强 | `core/jwt.ts` 是最直接可复用资产 |
| user DO schema | pattern reuse | 强 | `engine_do.ts` 的 sessions map 仅能 adapt，不可整抄 |
| public façade contract | ingress pattern | 中 | `chat.ts` 的 middleware 视角很有价值 |
| memory/history domain | defer | 中 | `db_do.ts` 有价值，但不属于本阶段 |
| protocol truth | discard | 强 | CICP 不能进入 NACP-first runtime |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`F0 Contexter Absorption Inventory` 是 **防漂移 design inventory**，负责 **把 contexter 的可借鉴面收紧到文件级 adopt/adapt/defer/discard**，对上游提供 **可控的外部经验吸收**，对下游要求 **不偷渡 SQLite / CICP / RAG**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| `core/schemas_cicp.ts` | contexter 协议层 | NACP 才是协议真相 | 否 |
| `context/*` + `ai/*` + `rag/*` | contexter 业务编排层 | 与 façade phase 无关 | 低 |
| `core/db_do.ts` | richer memory substrate | first-wave 不需要 SQLite domain | 是 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| JWT adapter | `src/adapters/jwt.ts` | 轻量 adopt | richer auth adapter |
| trace/auth middleware | `src/facades/middleware.ts` | adapt-pattern | richer ingress pipeline |
| user DO attachment manager | `src/user-do/ws-gateway.ts` | adapt sessions map pattern | richer multi-attachment model |
| persistent user substrate | reserved for future | defer | SQLite / D1 / hybrid store |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：contexter 的协议层与 nano-agent 的协议层
- **解耦原因**：不能把 CICP packet shape 偷渡到 NACP-first runtime。
- **依赖边界**：只能吸收 middleware / DO pattern / auth adapter，不吸收 packet schema。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：所有对 contexter 的吸收结论
- **聚合形式**：单一 inventory 文档
- **为什么不能分散**：否则实现、review、docs 会各自讲一套“吸收了什么”。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：简洁、集中、单 owner 风格。
- **值得借鉴**：
  - 入口层越薄越好
- **不打算照抄的地方**：
  - 不区分 public façade 与 runtime owner

### 4.2 codex 的做法

- **实现概要**：typed protocol / manager / permission 层分得很开。
- **值得借鉴**：
  - 先分层，再吸收
- **不打算照抄的地方**：
  - 不复制其全量 infra tree

### 4.3 claude-code 的做法

- **实现概要**：Structured IO / Task / Tool 中央层非常清晰。
- **值得借鉴**：
  - 要明确什么留在中央层、什么不吸收
- **不打算照抄的地方**：
  - 不直接套用其 SDK host / task surface

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| 外部经验吸收方式 | 直接实现导向 | 强分层 | 中央层导向 | 文件级 inventory |
| 过度复制风险 | 中 | 高 | 中 | 低 |
| 对新贡献者友好度 | 高 | 中 | 中 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** `core/jwt.ts` adopt-as-is（light adaptation）
- **[S2]** `chat.ts` 中 `withTrace` / `withAuth` / `getUserDOStub` adapt-pattern
- **[S3]** `engine_do.ts` 的 WS sessions map / upgrade 结构 adapt-pattern
- **[S4]** `core/broadcast.ts` 作为 relay pattern reference

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** `wrapInCicp` 及其 packet shape
- **[O2]** `db_do.ts`
- **[O3]** `context/*` / `ai/*` / `rag/*`

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `jwt.ts` | in-scope | 低风险高价值 |
| `engine_do.ts` 整文件复制 | out-of-scope | 它连着 DB / Alarm / Director，不是轻壳 |
| `core/broadcast.ts` 思路借鉴 | in-scope | 可为 relay 提供结构参考 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **文件级 inventory** 而不是 **“吸收 gateway 思想” 这类口号**
   - **为什么**：实现阶段必须知道该抄哪几段、不该抄哪几段。
   - **我们接受的代价**：文档更细、更啰嗦。
   - **未来重评条件**：无；这是本阶段必要精度。

2. **取舍 2**：我们选择 **defer `db_do.ts`** 而不是 **顺手把 SQLite 带进 first-wave**
   - **为什么**：当前不是 richer memory 阶段。
   - **我们接受的代价**：first-wave user DO 能力更克制。
   - **未来重评条件**：进入 richer user-memory 阶段时。

3. **取舍 3**：我们选择 **discard CICP packet layer** 而不是 **直接重用 contexter 协议**
   - **为什么**：NACP 才是当前协议真相。
   - **我们接受的代价**：middleware 需要自己改写 wrap layer。
   - **未来重评条件**：无；协议真相已冻结。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| 偷渡 SQLite | 实现者看到 `db_do.ts` 很好用 | 范围失控 | 本文档明确 defer |
| 偷渡 CICP | 直接复制 `wrapInCicp` | 协议层污染 | inventory 明确 discard |
| 过度保守 | 什么都不敢借 | 丧失 contexter 价值 | 明确 adopt/adapt 高价值部分 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：后续实现时不用再反复争论“这段算不算应该吸收”。
- **对 nano-agent 的长期演进**：把外部经验的吸收面做成清晰边界。
- **对三大深耕方向的杠杆作用**：先保留最有价值的 gateway / auth / DO 模式，再把更厚的 memory/skills 留给后续阶段。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | JWT adapter adopt | 迁入 `jwt.ts` 的核心能力 | ✅ **first-wave JWT 不再从零写起** |
| F2 | Ingress middleware adapt | 改写 `withTrace` / `withAuth` / `getUserDOStub` | ✅ **gateway pattern 有具体落点** |
| F3 | User DO WS pattern adapt | 借用 sessions map / upgrade 结构 | ✅ **DO attachment 不是从零想象** |
| F4 | Explicit exclusions | 明确 `db_do` / CICP / RAG 不进入本阶段 | ✅ **first-wave 范围不被偷渡拉宽** |

### 7.2 详细阐述

#### F1: `JWT adapter adopt`

- **输入**：public bearer token / query token
- **输出**：verified identity payload
- **主要调用者**：`orchestrator.core` ingress middleware
- **核心逻辑**：保留 verifyJwt 的思路，但对接 nano-agent env / types。
- **边界情况**：
  - token 缺失 -> reject
  - tenant claim mismatch -> reject（按本阶段 tenant law）
- **一句话收口目标**：✅ **JWT verify 不再从零搭一版新实现**

#### F2: `Explicit exclusions`

- **输入**：实现阶段的吸收候选
- **输出**：明确的 allow / defer / forbid 结论
- **主要调用者**：实现者 / reviewer
- **核心逻辑**：把“不能顺手带入”的外部资产提前写死。
- **边界情况**：
  - future phase 可重开 defer 项，但必须重开文档
- **一句话收口目标**：✅ **first-wave 不因“顺手好用”被拉成 richer memory phase**

### 7.3 非功能性要求

- **性能目标**：不因吸收外部样本而引入不必要 heavy dependency。
- **可观测性要求**：review 时能快速指出某段代码属于 adopt/adapt/defer/discard 哪类。
- **稳定性要求**：inventory 要比“口号吸收”更稳定。
- **测试覆盖要求**：不要求独立测试 inventory，但相关实现要对应到 inventory 分类。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/agent.py:57-76` | 中央 owner 持有消息与 prompt | 外部经验吸收后仍要回到单一 owner | |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/core/src/thread_manager.rs:194-218` | 中央 manager 收口多类依赖 | 借鉴“中央层只吸收必要能力” | |
| `context/codex/codex-rs/protocol/src/permissions.rs:118-177` | typed policy structs | 借鉴“不要让上下文/权限定义散在各处” | |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/Tool.ts:158-179` | ToolUseContext 聚合多个中心依赖 | 借鉴“中央层显式聚合，不靠隐式全局” | |
| `context/claude-code/Task.ts:44-57` | task state base 集中定义 | 借鉴“先做中心状态清单，再写实现” | |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `context/smind-contexter/src/engine_do.ts:73-124` | constructor 同时装配 DB/Alarm/Director，说明它不是轻量 user DO 壳 | 不能整文件搬进 first-wave orchestrator |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`F0 Contexter Absorption Inventory` 的价值不是直接产生运行时代码，而是 **给运行时代码设置护栏**。它让 orchestration-facade 能吸收 contexter 最有价值的 auth/gateway/DO 模式，同时避免被 SQLite/CICP/RAG 绑架到另一个阶段。这类文档通常不起眼，但对范围控制极重要。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 4 | 它不直接产功能，但直接保范围 |
| 第一版实现的性价比 | 5 | 一份文档能少掉很多后续争论 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 4 | richer phase 可以基于这份 inventory 重开 defer 项 |
| 对开发者自己的日用友好度 | 5 | reviewer 和实现者都有单一真相源 |
| 风险可控程度 | 5 | 范围漂移风险显著下降 |
| **综合价值** | **5** | **是范围护栏文档，不可省** |

### 9.3 下一步行动

- [ ] **设计冻结回填**：把 `db_do.ts` defer / `jwt.ts` adopt / `engine_do.ts` adapt 的边界吸收到 F0 action-plan。
- [ ] **关联 Issue / PR**：`docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`
- [ ] **待深入调查的子问题**：
  - richer user-memory 阶段是否优先重开 `db_do.ts`
- [ ] **需要更新的其他设计文档**：
  - `F0-user-do-schema.md`
  - `F4-authority-policy-layer.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-24 | GPT-5.4 | 初稿 |
| v0.2 | 2026-04-24 | GPT-5.4 | 复核 reviewer sweep 后无实质设计改动，仅移除旧式决策提示并对齐当前 freeze 语气 |
