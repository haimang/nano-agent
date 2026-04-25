# Nano-Agent 功能簇设计模板

> 功能簇: `ZX D1 Schema and Migrations`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/charter/plan-zero-to-real.md`、`docs/eval/zero-to-real/plan-hardening-by-GPT.md`、`context/ddl-v170/*`
> 文档状态: `draft`

---

## 0. 背景与前置约束

zero-to-real 的 shared truth 不能再停留在 DO 热态或临时内存里。当前阶段需要第一次把 identity、conversation、session、turn、message、context snapshot、activity/audit、usage/quota 放进同一个可查询、可审计、可跨 worker 共享的 D1 baseline。关键不是“多做几张表”，而是做到 **thin-but-complete**。

- **项目定位回顾**：D1 是 zero-to-real 的稳定真相层，不是 DO SQLite 的替代品。
- **本次讨论的前置共识**：
  - `ddl-v170` 证明了 `team_uuid` 是隔离核心。
  - `smind-admin` 证明了 Worker control-plane 可以围绕 D1 组织。
  - `smind-contexter` 证明了 DO SQLite 适合作为热态，但不是共享 SSOT。
  - `nano_session_activity_logs` 是 nano-agent 新设计，不是现成祖宗表。
- **显式排除的讨论范围**：
  - full quota policy / ledger / alerts plane
  - `smind-06` / `smind-09` 全量 richness
  - cold archive / R2 offload

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`ZX D1 Schema and Migrations`
- **一句话定义**：冻结 zero-to-real 的 first-wave D1 表清单、写入所有权、迁移顺序、以及最小 views/read model。
- **边界描述**：本功能簇**包含** first-wave D1 baseline、migration waves、表组间关系、写入 ownership；**不包含**完整 admin/reporting BI 方案。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| SSOT | 跨 worker 查询与回看时的共享真相源 | 这里指 D1 |
| hot-state | 为提升当前用户/会话交互体验保留的 durable hot cache | 通常在 DO SQLite |
| thin-but-complete | 表面不追求全量广度，但足以支撑 real loop 与审计 | 本文核心 |
| write ownership | 哪个 worker 对哪组表拥有主写权 | 避免多头写入 |
| read model | 为 history/list/timeline 等查询服务的视图或查询约束 | first-wave 可很薄 |

### 1.2 参考调查报告

- `docs/charter/plan-zero-to-real.md` — §1.5 / §2.2 / §7.2 / §7.3 / §7.4
- `docs/eval/zero-to-real/plan-hardening-by-GPT.md` — §2.1 / §4 / §5.2
- `context/ddl-v170/smind-01-tenant-identity.sql`
- `context/ddl-v170/smind-06-conversation-context-session.sql`
- `context/ddl-v170/smind-09-tenant-billing-quota-usage.sql`

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **shared persistence truth layer** 的角色。
- 它服务于：
  - `orchestration.auth`
  - `orchestration.core`
  - `agent.core`
  - future admin / audit read side
- 它依赖：
  - `team_uuid` tenant law
  - NACP trace/session/evidence vocabulary
  - Z1/Z2/Z3 的 phase 目标
- 它被谁依赖：
  - auth flow
  - history/timeline/conversation list
  - audit/trace readback
  - quota runtime proof

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| Auth foundation | auth -> identity tables | 强 | Z1 首批迁移 |
| Session truth | runtime -> conversation tables | 强 | Z2 主使用面 |
| Runtime/quota | runtime -> usage tables | 中 | Z3 最小 quota truth |
| NACP realization | trace/session -> audit tables | 强 | activity logs 需 trace-linked |
| Clients | client <- read model | 中 | conversation list/history 依赖 D1 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`ZX D1 Schema and Migrations` 是 **zero-to-real 的共享持久化主干**，负责 **冻结 first-wave D1 表与迁移顺序**，对上游提供 **tenant-safe、trace-linked、可回看的 shared truth**，对下游要求 **DO 热态只能加速，不得取代 D1 结论**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| full `smind-06` collaboration richness | 成熟聊天/协作 schema | first-wave 不需要 participants/message_parts 全量化 | 是 |
| full `smind-09` ledger/alerts | 成熟 billing plane | 当前只需 quota minimal truth | 是 |
| 直接把 DO SQLite 当 SSOT | stateful runtime 常见偷懒路径 | 会破坏跨 worker / 回看 / admin 读取 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| activity/audit read model | view or query helper | append-only 基线 | richer projections |
| context snapshots | `nano_conversation_context_snapshots` | 只存最小快照 | `context_items` / materialized views |
| quota tables | `nano_usage_events` / `nano_quota_balances` | 最小可验证 | ledger / policies / alerts |
| tenant secrets | `nano_tenant_secrets` | 先保留扩展位 | BYO key / richer KMS discipline |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：D1 SSOT vs DO SQLite hot-state
- **解耦原因**：两者职责完全不同；D1 为共享真相，DO SQLite 为 per-user 热态。
- **依赖边界**：热态可以缓存 conversation 索引、recent cursor、secret cache，但最终 history/audit 读取必须能回落到 D1。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：identity core、conversation core、activity/audit、usage/quota
- **聚合形式**：集中在单一 `nano-agent-db`
- **为什么不能分散**：多库/多 truth 会使 real run 验证失真。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：更轻量，对共享持久化要求弱。
- **亮点**：
  - 启动成本低
- **值得借鉴**：
  - 表设计要服务 first-wave 场景，不必一开始做全量平台 schema
- **不打算照抄的地方**：
  - 把持久化需求长期保持在弱状态

### 4.2 codex 的做法

- **实现概要**：更强调 protocol / task / execution，而非多租户 D1 设计。
- **亮点**：
  - 读写边界清晰
- **值得借鉴**：
  - 表组与职责应聚焦，不做无关膨胀
- **不打算照抄的地方**：
  - 忽略 SaaS 多租户读写模型

### 4.3 claude-code 的做法

- **实现概要**：本地工具化更强，不以 D1/shared truth 为主。
- **亮点**：
  - 状态与控制中心明确
- **值得借鉴**：
  - 状态表必须服务 control plane，而不是只做数据堆积
- **不打算照抄的地方**：
  - 本地历史 / 状态文件式心智

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| shared DB emphasis | 低 | 低 | 低 | 高 |
| multi-tenant schema | 低 | 低 | 低 | 高 |
| read model importance | 低 | 中 | 中 | 高 |
| hot/cold layering | 低 | 中 | 中 | 中高 |
| audit linkage | 低 | 中 | 高 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** 身份核心：`nano_users` / `nano_user_profiles` / `nano_user_identities` / `nano_teams` / `nano_team_memberships`
- **[S2]** 会话核心：`nano_conversations` / `nano_conversation_sessions` / `nano_conversation_turns` / `nano_conversation_messages`
- **[S3]** 上下文核心：`nano_conversation_context_snapshots`
- **[S4]** 审计核心：`nano_session_activity_logs`
- **[S5]** quota 核心：`nano_usage_events` / `nano_quota_balances`

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** full `participants` / `message_parts` / `context_items`
- **[O2]** full quota ledger / alerts / policy plane
- **[O3]** cold archive / R2 history offload
- **[O4]** full admin/reporting projection 套件

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `nano_auth_sessions` | in-scope | refresh / verify-token 需要最小 token state |
| `nano_tenant_secrets` | conditional in-scope | 若 DeepSeek/BYO key 提前进入，需要表位；若仅 Workers AI，可先 skeleton |
| `nano_session_activity_logs` 拆表 | pending | 由 Q5 拍板，不影响主线必须有 activity/audit truth |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **thin-but-complete D1** 而不是 **too-thin or full-richness**
   - **为什么**：既要支撑真实 loop，又不能把本阶段做成整个平台建模工程。
   - **我们接受的代价**：后续仍需补 richer views / collaboration / quota planes。
   - **未来重评条件**：当 zero-to-real 已闭合并开始下一阶段。

2. **取舍 2**：我们选择 **D1 为 SSOT，DO SQLite 为 hot-state** 而不是 **二选一**
   - **为什么**：两者职责不同，真实系统需要互补。
   - **我们接受的代价**：要维护 shared truth 与 hot cache 的一致性规则。
   - **未来重评条件**：若未来出现更适合 shared truth 的平台 substrate。

3. **取舍 3**：我们选择 **write ownership 单一化** 而不是 **多个 worker 共同写同组表**
   - **为什么**：否则 schema 虽在同一数据库，逻辑真相仍会漂移。
   - **我们接受的代价**：有些读取可能需要绕经拥有者或约定查询 helper。
   - **未来重评条件**：仅在后续明确引入 read/write split service 时。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| schema 过薄 | 只落 conversation/message 两三张表 | 无法支撑 history / audit / quota | 强制 identity/context/audit/quota 一并进入首批 |
| schema 过重 | 试图吃下完整 `smind-06/09` | 阻塞 zero-to-real | 明确 richer surface 延后 |
| 多头写入 | 多个 worker 同写 identity/session 表 | 数据漂移 | 冻结 write ownership |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：知道 first-wave 到底要建哪些表，不会一边做一边加。
- **对 nano-agent 的长期演进**：为 admin plane、quota plane、cold tier 留出可延展空间。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：它们未来都需要稳定的 conversation/context/audit 基线。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Identity Core | 用户/身份/团队/成员关系 | ✅ **双租户登录与隔离可持久化** |
| F2 | Conversation Core | conversation/session/turn/message | ✅ **session 结束后 history 仍可查询** |
| F3 | Context Snapshot Core | 每轮可回看的上下文快照 | ✅ **context 不再只留热态** |
| F4 | Activity/Audit Core | trace-linked 行为记录 | ✅ **real run 可追责** |
| F5 | Quota Minimal Core | usage event + quota balance | ✅ **Z3 的 allow/deny 有持久化证据** |

### 7.2 详细阐述

#### F1: `Identity Core`

- **输入**：register/login/wechat/api-key verify
- **输出**：用户、身份、团队、成员关系
- **主要调用者**：`orchestration.auth`
- **核心逻辑**：所有身份写入权集中在 auth worker。
- **边界情况**：
  - 一个 user 允许多 identity provider
  - first real login 是否自动建 default team 由 Q3 决定
- **一句话收口目标**：✅ **auth flow 的持久化真相不再散落在 token 与内存里**

#### F2: `Conversation Core`

- **输入**：session start/followup/cancel/end、runtime events
- **输出**：conversation/session/turn/message readback
- **主要调用者**：`orchestration.core`、`agent.core`
- **核心逻辑**：Z2 把实时 loop 对齐到持久化 truth。
- **边界情况**：
  - DO 热态可缓存 recent cursor，但不能替代 D1
  - richer message part 结构延后
- **一句话收口目标**：✅ **history/timeline 能从 D1 读取，而非只靠热态残留**

### 7.3 非功能性要求

- **性能目标**：list/history/timeline 至少要有可实现的 read path，不要求 Z2 就极致优化。
- **可观测性要求**：所有核心表都必须带 `team_uuid` 与必要的 trace/session 链接键。
- **稳定性要求**：迁移顺序必须支持从 Z1 到 Z3 渐进扩表。
- **测试覆盖要求**：identity、history、activity、quota 至少各有一条跨 worker read/write proof。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/README.md` | 轻量状态模型 | first-wave schema 也要避免全量化冲动 | 只取克制思路 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/README.md` | execution/thread 概念组织 | 读写模型应服务执行与回看，而不是抽象堆砌 | 间接启发 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/history.ts` | 历史状态处理 | 状态存储应服务真实交互回看 | 对 Z2/Z4 有启发 |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `workers/orchestrator-core/src/user-do.ts` | 当前 session registry 主要在 DO storage | 它适合作为热态，不适合作为 shared SSOT |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

ZX-D1 是 zero-to-real 的数据基石。它把 Z1 的身份真相、Z2 的 session/history/context truth、Z3 的 quota 证据落进同一个共享数据库，同时明确哪些内容只应保留在 DO 热态。它不追求平台数据库大而全，但必须足够支撑 first real run 的回看与追责。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 没有 shared truth，就没有“real” |
| 第一版实现的性价比 | 4 | 表数增加，但每组都直接服务 zero-to-real 主线 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 5 | 后续大部分功能都要挂在这些表上 |
| 对开发者自己的日用友好度 | 4 | 明确表与 ownership 后实现会更顺 |
| 风险可控程度 | 4 | 主要风险在于过薄/过重，两边都已有约束 |
| **综合价值** | **5** | **这是 zero-to-real 的 shared truth 主干** |

### 9.3 下一步行动

- [ ] **决策确认**：在 `ZX-qna.md` 回答 Q3 / Q5 / Q6 / Q8。
- [ ] **关联 Issue / PR**：Z1 identity migrations、Z2 conversation/audit migrations、Z3 quota migrations。
- [ ] **待深入调查的子问题**：
  - activity log 单表还是拆分
  - `nano_tenant_secrets` 是否需要在 Z1 建表
  - DO SQLite 热态最小集合
- [ ] **需要更新的其他设计文档**：
  - `Z1-full-auth-and-tenant-foundation.md`
  - `Z2-session-truth-and-audit-baseline.md`
  - `ZX-llm-adapter-and-secrets.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：D1 是不是只要先落很薄的一两张表
  - **A 方观点**：先让功能通
  - **B 方观点**：太薄就无法证明 real loop
  - **最终共识**：采用 thin-but-complete

### B. 开放问题清单（可选）

- [ ] **Q5**：`nano_session_activity_logs` 是否采用单表 + views 作为 first-wave baseline？
- [ ] **Q6**：DO SQLite hot-state 最低集合应冻结到什么粒度？

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-24` | `GPT-5.4` | 初稿 |
