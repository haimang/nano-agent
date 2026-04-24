# Nano-Agent 功能簇设计模板

> 功能簇: `F0 Agent-Core Internal Binding Contract`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4（参考 Opus 2nd-pass）`
> 关联调查报告: `docs/plan-orchestration-facade.md`、`docs/plan-orchestration-facade-reviewed-by-opus-2nd-pass.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

当前仓库里，`agent.core` 没有任何 internal-only session route；现有 `/sessions/:id/*` 仍是 public edge。2nd-pass 最关键的 gap 也正是这一点：如果不在 F0 冻住 `orchestrator.core -> agent.core` 的 internal binding contract，后面所有 richer orchestrator 工作都会建立在 ad-hoc fetch 胶水上。

- **项目定位回顾**：本阶段要把 public ownership 从 runtime 剥离，但不做 big-bang transport rewrite。
- **本次讨论的前置共识**：
  - transport 仍用 fetch-backed service binding
  - JWT 只在 `orchestrator.core` 做 public ingress 校验
  - `agent.core` 接收的是 gated internal request，而不是 raw public request
  - `orchestrator.core` first-wave 需要至少覆盖 `start` / `cancel`
- **显式排除的讨论范围**：
  - WorkerEntrypoint RPC
  - worker-to-worker WebSocket
  - richer generic internal RPC bus

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`F0 Agent-Core Internal Binding Contract`
- **一句话定义**：定义 `orchestrator.core` 如何通过 service binding 调用 `agent.core`，以及 `agent.core` 如何识别 / 验证 / 接纳这些 internal session requests。
- **边界描述**：本功能簇**包含** internal route family、internal auth gate、authority passing convention、typed error shape；**不包含** public façade contract 与 stream relay framing。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| internal binding contract | `orchestrator.core -> agent.core` 的 worker-to-worker contract | 与 public contract 分离 |
| gated internal route | 仅服务于 service binding 的 `/internal/*` 路径族 | 不对外文档化 |
| internal auth header | `orchestrator.core` 发给 `agent.core` 的 worker-to-worker 请求标识 | 仍需配合 authority 检查 |
| authority-stamped request | 由 façade 翻译后的 trace / authority / session context 完整请求 | 不再携带 public JWT |
| typed internal rejection | internal path 的显式拒绝响应 | 避免 silent 403/404 混淆 |

### 1.2 参考调查报告

- `docs/plan-orchestration-facade.md` — §1.7 / §6.1 / §11.1 / §15.1 #7
- `docs/plan-orchestration-facade-reviewed-by-opus-2nd-pass.md` — G1 / M1 / M6

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **façade 与 runtime 之间唯一 internal API** 的角色。
- 它服务于：
  - `orchestrator.core`
  - `agent.core`
  - future richer orchestrator features
- 它依赖：
  - `session_uuid` lifecycle
  - authority payload translation
  - tenant truth (`TEAM_UUID`)
- 它被谁依赖：
  - F1 minimal roundtrip
  - F2 session seam completion
  - F5 exit criterion #7

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| public façade contract | façade → internal | 强 | action surface coverage 必须对应 |
| stream relay | internal → façade | 强 | `start/input/cancel` 与 stream 打开/关闭耦合 |
| authority policy | internal request → validation | 强 | internal auth 不是只靠 header |
| user DO schema | façade registry → runtime | 中 | session_uuid 与 user registry 要对齐 |
| test migration | internal seam → integration tests | 中 | Exit #7 要求两条 integration tests |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`F0 Agent-Core Internal Binding Contract` 是 **runtime mesh 的第一条正式 internal API**，负责 **让 `orchestrator.core` 可以在不复用 legacy public routes 的前提下调用 `agent.core`**，对上游提供 **typed internal session actions**，对下游要求 **auth gate、authority legality、tenant alignment**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 复用 public `/sessions/*` 作为 internal target | 简化迁移的临时方案 | 会让 internal API 永远绑在 legacy public path 上 | 否 |
| generic RPC bus | 大型服务网格常见 | 本阶段只需要 typed session actions | 低 |
| worker-to-worker JWT | 典型 API gateway 模式 | public JWT 在 façade 已验证，不需要重复验证 | 低 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| internal route family | `/internal/sessions/:id/*` | first-wave typed actions | richer internal lifecycle ops |
| internal auth | header + env secret | single shared gate | signed internal token / mTLS-like policy |
| authority payload | NACP-stamped JSON body | minimal trace / authority / session context | richer credit / quota metadata |
| internal error taxonomy | typed JSON error body | `invalid-internal-auth` / `invalid-authority` / `unsupported-action` | versioned internal API errors |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：public façade routes vs internal session routes
- **解耦原因**：只有这样，legacy public route 才能在 F3 exit 后真正退役。
- **依赖边界**：public route 由 `orchestrator.core` 管；internal route 只在 `agent.core` 上作为 service-binding target 存在。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：internal auth gate、authority passing convention、typed action list
- **聚合形式**：`agent.core` 单一 internal route family
- **为什么不能分散**：若不同 action 自带不同鉴权与 body 约定，future richer orchestrator 无法稳定扩展。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：没有独立 networked internal contract，入口与执行体几乎是同一个 Agent owner。
- **值得借鉴**：
  - route / action 列表要保持最小
- **不打算照抄的地方**：
  - 单进程 owner 替代明确的 service-binding contract

### 4.2 codex 的做法

- **实现概要**：typed protocol + thread/session manager + permission model 明确。
- **值得借鉴**：
  - 先枚举 action vocabulary
  - internal state owner 清晰
- **不打算照抄的地方**：
  - 本阶段不复制完整 protocol engine

### 4.3 claude-code 的做法

- **实现概要**：Structured IO 的 control request / response、ToolPermissionContext、Task/Tool 分层明确。
- **值得借鉴**：
  - internal control plane 必须有 typed request/response
- **不打算照抄的地方**：
  - 不把 SDK host / stdio surface 当成 worker internal contract

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| internal API 显式程度 | 低 | 高 | 中高 | 高 |
| action vocabulary | 低 | 高 | 中 | 中高 |
| permission / auth 分层 | 低 | 高 | 高 | 高 |
| first-wave 实现成本 | 低 | 高 | 中 | 中 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** 定义 `/internal/sessions/:session_uuid/{start,input,cancel,status,timeline,verify,stream}`。
- **[S2]** internal request 必须带 shared auth header。
- **[S3]** internal request 必须带 authority-stamped context，不重复 public JWT。
- **[S4]** `agent.core` 对 internal actions 提供 typed rejection。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** 复用 legacy public `/sessions/*` 当 internal target。
- **[O2]** 通用型 internal RPC bus。
- **[O3]** worker-to-worker WS contract。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `/internal/*` 是否可被 docs 暴露给 client | out-of-scope | 不是 public contract |
| `agent.core` 是否再次校验 JWT | out-of-scope | public JWT 只在 façade 验一次 |
| `agent.core` 是否继续校验 authority / tenant legality | in-scope | internal auth 不能代替 legality |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **新增 gated `/internal/*` route family** 而不是 **复用 public `/sessions/*`**
   - **为什么**：只有这样，F3 才能真正退役 legacy public path。
   - **我们接受的代价**：要写额外 internal route / auth gate。
   - **未来重评条件**：无；这是结构性前提。

2. **取舍 2**：我们选择 **header gate + authority legality 双重检查** 而不是 **只信 service binding transport**
   - **为什么**：transport 不是安全模型本体。
   - **我们接受的代价**：实现看起来更“啰嗦”。
   - **未来重评条件**：若平台提供更强 worker identity 可再调整。

3. **取舍 3**：我们选择 **typed session action family** 而不是 **generic internal RPC envelope**
   - **为什么**：first-wave 范围有限，typed action 更易验证。
   - **我们接受的代价**：后续若扩 action，需要显式加新路径。
   - **未来重评条件**：当 richer orchestrator 真需要 generic bus。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| internal contract 漂移 | F1 代码先写，文档未冻住 | future feature 全部靠猜 | 先写本设计文档 |
| 只靠 header，不校验 authority | 实现图快 | tenant / authority law 失真 | F4.A 接入 explicit policy helper |
| action list 不完整 | first-wave 漏掉 `cancel` / `verify` | F2/F3 再次返工 | 在 F0 就枚举完整 route family |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：不再需要把 future feature 硬绑到 legacy public agent routes。
- **对 nano-agent 的长期演进**：为 richer orchestrator 留下稳定 internal API。
- **对三大深耕方向的杠杆作用**：context / skill / stability 的扩展都可以建立在稳定 internal seam 上。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Internal route family | 为 session lifecycle 提供 `/internal/sessions/*` | ✅ **internal action vocabulary 不再隐式依附 public path** |
| F2 | Internal auth gate | 每个 internal request 都经 shared gate 检查 | ✅ **transport 之外还有显式 gate** |
| F3 | Authority-stamped request | 由 façade 传入 trace / authority / session context | ✅ **agent 接受的是合法 internal request，不是 raw public body** |
| F4 | Typed rejection | internal invalid request 有明确错误码 | ✅ **integration tests 能断言 contract，而不是猜 403/404** |

### 7.2 详细阐述

#### F1: `Internal route family`

- **输入**：来自 service binding 的 fetch request
- **输出**：进入对应 session action handler
- **主要调用者**：`orchestrator.core`
- **核心逻辑**：internal path 独立于 public path，至少覆盖 `start` / `cancel`，完整枚举到 first-wave action family。
- **边界情况**：
  - `/internal/*` 未认证 -> reject
  - 不支持的 action -> typed rejection
- **一句话收口目标**：✅ **internal session actions 具备稳定、独立、可测试的路由族**

#### F2: `Authority-stamped request`

- **输入**：已在 façade 完成 JWT translation 的 request body
- **输出**：`agent.core` 可用于 legality verify 的内部上下文
- **主要调用者**：`agent.core` ingress policy
- **核心逻辑**：`agent.core` 不再期待 raw public JWT，而期待已翻译好的 authority + trace + session context。
- **边界情况**：
  - 缺 authority -> reject
  - tenant mismatch -> reject
- **一句话收口目标**：✅ **internal request 既不是 raw public request，也不是无上下文的 blind fetch**

### 7.3 非功能性要求

- **性能目标**：internal path 不得引入明显高于 legacy direct path 的固定开销。
- **可观测性要求**：每次 internal action 要能区分 `invalid-internal-auth`、`invalid-authority`、`unsupported-action`。
- **稳定性要求**：F1 必须至少有 `new session` 与 `cancel session` 两条 integration tests。
- **测试覆盖要求**：Exit #7 必须以 integration tests 体现，而不是只靠文档。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/agent.py:45-59` | Agent 初始化时集中持有 tool registry | internal action owner 要集中 | |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/protocol/src/openai_models.rs:166-206` | tool capability 类型枚举 | internal action / capability vocabulary 要 typed 化 | |
| `context/codex/codex-rs/protocol/src/permissions.rs:21-73` | sandbox/network/file-system 权限类型 | legality 不应只靠 transport | |
| `context/codex/codex-rs/core/src/thread_manager.rs:194-218` | thread manager 作为中央 owner | internal session owner 需要稳定中心 | |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/cli/structuredIO.ts:93-117` | typed request details builder | internal request 要可被明确描述与验证 | |
| `context/claude-code/Tool.ts:123-148` | permission context 中央结构 | internal request legality 不应散落 | |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `workers/agent-core/src/index.ts:49-62` | 当前所有 session traffic 都共用 legacy public route lookup | 这正是要被拆开的现状，而不是 future internal contract |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`F0 Agent-Core Internal Binding Contract` 是 orchestration-facade 阶段最重要的结构性 design doc 之一。它覆盖范围小于 public façade contract，但其价值更“骨架化”：如果没有它，future richer orchestrator 会继续长在一段临时 fetch 胶水上。它的实现复杂度不在 transport，而在 **路径边界、auth gate、authority passing、typed rejection**。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 这是 runtime mesh 正式内化的关键层 |
| 第一版实现的性价比 | 5 | 不先冻结，后续全部返工 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 5 | future feature 全部会经过它 |
| 对开发者自己的日用友好度 | 4 | 增加一点 upfront 设计成本，但大幅降低后续漂移 |
| 风险可控程度 | 4 | 路由与 gate 设计可控，风险主要在偷懒复用 legacy path |
| **综合价值** | **5** | **必须在 F1 前冻结** |

### 9.3 下一步行动

- [ ] **决策确认**：owner 确认 internal auth 采用 shared header gate 作为 first-wave 基线。
- [ ] **关联 Issue / PR**：`docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`
- [ ] **待深入调查的子问题**：
  - shared header 是纯 secret 还是可签名载体
- [ ] **需要更新的其他设计文档**：
  - `F0-stream-relay-mechanism.md`
  - `F4-authority-policy-layer.md`

---

## 附录

### B. 开放问题清单（可选）

- [ ] **Q1**：first-wave internal auth header 采用纯 shared secret 还是签名格式？

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-24 | GPT-5.4 | 初稿 |
