# Nano-Agent 功能簇设计模板

> 功能簇: `F0 User DO Schema`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/plan-orchestration-facade.md`、`docs/design/orchestration-facade/F0-contexter-absorption-inventory.md`
> 文档状态: `frozen (F0 closed; reviewed + FX-qna consumed)`

---

## 0. 背景与前置约束

`orchestrator.core` first-wave 要成立，不能只是“一个会转发的 worker”。它必须至少有 **per-user registry**、`session_uuid` owner、`last_auth_snapshot`、`initial_context_seed` 这些最小状态。与此同时，本阶段又明确不允许偷渡 richer memory / SQLite domain。因此我们需要一份专门的 design 文档，把 first-wave user DO schema 写成可实现、可 review、可约束的真相层。

- **项目定位回顾**：`orchestrator.core` 是 per-user DO；它要有最小非空状态，但不是 full user-memory engine。
- **本次讨论的前置共识**：
  - storage 采用 DO storage key-value / structured object store
  - 不引入 SQLite
  - 逻辑 schema 维持 4 个主字段：`user_uuid` / `active_sessions` / `last_auth_snapshot` / `initial_context_seed`
  - `session_uuid` owner 在 façade
- **显式排除的讨论范围**：
  - conversation archive
  - full preference/profile domain
  - billing/credit state

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`F0 User DO Schema`
- **一句话定义**：定义 `orchestrator.core` per-user DO 在 first-wave 必须持有的最小持久状态，以及其逻辑 schema 到物理 key layout 的映射。
- **边界描述**：本功能簇**包含** logical schema、physical storage layout、session registry entry、retention boundary；**不包含** reconnect state machine 与 internal stream framing本身。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| logical schema | 对业务可见的对象模型 | 4 个核心字段 |
| physical storage layout | DO storage 内的 key layout | 为实现阶段服务 |
| active session entry | `active_sessions` 中单个 session 的状态对象 | 包含 `relay_cursor = last_forwarded.seq` |
| auth snapshot | 最近一次通过 façade ingress 的认证快照 | 不是权威鉴权数据库，但保留 `tenant_source` 审计信息 |
| seed | `initial_context` 生产的默认输入材料 | 不是 full memory |

### 1.2 参考调查报告

- `docs/plan-orchestration-facade.md` — §4.2 / §18.3 / §18.4
- `docs/design/orchestration-facade/F0-contexter-absorption-inventory.md`

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **per-user registry substrate** 的角色。
- 它服务于：
  - `session_uuid` minting / lookup
  - attach / reconnect
  - auth snapshot debug truth
  - seed builder
- 它依赖：
  - public façade contract
  - session lifecycle law
  - tenant truth
- 它被谁依赖：
  - F1 user DO shell
  - F2 attach / reconnect / seed
  - F3 cutover

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| public façade contract | ingress -> schema | 强 | canonical public owner 直接写入 registry |
| session lifecycle | state machine <-> schema | 强 | schema 决定可存哪些状态 |
| stream relay | relay cursor <-> active session entry | 强 | reconnect 依赖 cursor |
| authority policy | auth snapshot <-> tenant truth | 中 | snapshot 不是权威源，但要可审计 |
| contexter absorption inventory | defer/adopt -> schema shape | 中 | 为什么不引 SQLite 在此落地 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`F0 User DO Schema` 是 **orchestrator 的最小持久状态层**，负责 **承载 user identity snapshot、active session registry 与 seed defaults**，对上游提供 **稳定的 session lookup / attach / reconnect substrate**，对下游要求 **不偷渡 richer memory 域**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| SQLite / `db_do.ts` | contexter | 当前只是 registry，不是 richer memory | 是 |
| per-turn transcript archive | conversation systems 常见 | 不属于 first-wave registry | 是 |
| billing/profile state | SaaS gateway 常见 | 与当前阶段正交 | 是 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| session entry payload | `active_sessions[*]` | minimal phase/status/cursor | richer replay/analytics metadata |
| auth snapshot | `last_auth_snapshot` | latest only | snapshot ring / audit history |
| seed shape | `initial_context_seed` | realm/source/default layers | richer user memory refs |
| retention policy | bounded ended session metadata | active + recent-ended only | richer history index |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：user registry state vs runtime session state
- **解耦原因**：`agent.core` DO 负责 turn loop；`orchestrator.core` DO 负责 user/session registry。
- **依赖边界**：registry 只记录 session meta，不复制 runtime timeline / checkpoint。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：session lookup、auth snapshot、seed defaults
- **聚合形式**：single per-user DO storage
- **为什么不能分散**：如果这些状态分散在 client、runtime、KV 各处，reconnect 与 debug truth 会漂移。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：消息与状态大多集中在单个 Agent 对象。
- **值得借鉴**：
  - first-wave state 不要一开始就做厚
- **不打算照抄的地方**：
  - 不把所有 session state 混在同一对象/进程里

### 4.2 codex 的做法

- **实现概要**：thread manager / protocol / permission state 都有明确 owner。
- **值得借鉴**：
  - 中央 state 要 typed
  - 生命周期与 owner 要先写清
- **不打算照抄的地方**：
  - first-wave 不复制其更厚的 thread store

### 4.3 claude-code 的做法

- **实现概要**：TaskStateBase / ToolPermissionContext 等中央结构清晰。
- **值得借鉴**：
  - 先定义状态基本形，再让实现接线
- **不打算照抄的地方**：
  - 不把更多 CLI/SDK 状态直接带进 worker DO

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| 中央状态厚度 | 低 | 高 | 中 | 中低 |
| typed state | 中 | 高 | 高 | 高 |
| 第一期状态克制度 | 高 | 中 | 中 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** 逻辑 schema 四字段冻结
- **[S2]** `active_sessions` entry shape 冻结
- **[S3]** `last_auth_snapshot` 最小字段冻结
- **[S4]** `initial_context_seed` 最小字段冻结
- **[S5]** physical storage layout 建议冻结

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** SQLite-backed conversation store
- **[O2]** 完整 ended session archive
- **[O3]** credit/profile/billing state

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `active_sessions` 里保留少量 ended metadata | in-scope | reconnect/debug 需要短期事实 |
| 全量历史 session archive | out-of-scope | 会演化成 history domain |
| `last_auth_snapshot` 作为真正授权源 | out-of-scope | 只是 façade 侧 snapshot，不是 authoritative database |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **4 字段最小 schema** 而不是 **一开始就做 richer user domain**
   - **为什么**：先保证 façade 非空、但不失控。
   - **我们接受的代价**：history/profile/analytics 都很克制。
   - **未来重评条件**：进入 richer memory/product phase。

2. **取舍 2**：我们选择 **DO storage key layout** 而不是 **SQLite**
   - **为什么**：当前更像 registry，不像 relational memory domain。
   - **我们接受的代价**：查询能力不如 SQLite 丰富。
   - **未来重评条件**：session/history 查询复杂度显著增加时。

3. **取舍 3**：我们选择 **bounded ended metadata** 而不是 **立即 purge 所有 terminal session**
   - **为什么**：刚结束的会话仍有 reconnect/debug/read-after-end 需求。
   - **我们接受的代价**：`active_sessions` 不只是“活跃中”。
   - **未来重评条件**：若 owner 要求绝对纯粹 active-only map。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| schema 太薄 | 不留 cursor/status | reconnect 做不稳 | 在 entry 中显式保留最小 meta |
| schema 太厚 | 偷渡历史/archive | 阶段失焦 | 明确 out-of-scope |
| ended retention 不清 | 没有 cleanup 规则 | storage 漫长膨胀 | 采用 bounded recent-ended policy |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：实现 user DO 时不需要临场 invent state shape。
- **对 nano-agent 的长期演进**：将来 richer memory 可以在当前 schema 之上平滑扩展。
- **对三大深耕方向的杠杆作用**：context continuity / stability 都离不开一个可信但克制的 user registry。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Logical schema | 四字段逻辑 schema | ✅ **user DO 非空但不越界** |
| F2 | Active session entry | `status/phase/cursor/timestamps` | ✅ **attach/reconnect 有状态基座** |
| F3 | Auth snapshot | latest auth/tenant/source snapshot | ✅ **ingress identity 有可回看事实** |
| F4 | Seed defaults | `initial_context` 生产输入材料 | ✅ **seed builder 不需临时拼凑** |

### 7.2 详细阐述

#### F1: `Logical schema`

- **输入**：first-wave user-scoped metadata
- **输出**：4 字段逻辑对象
- **主要调用者**：user DO
- **建议逻辑 schema**：
  - `user_uuid: string`
  - `active_sessions: Map<session_uuid, SessionEntry>`
  - `last_auth_snapshot: { sub, realm?, tenant_uuid?, tenant_source: "claim" | "deploy-fill", membership_level?, source_name?, exp? }`
  - `initial_context_seed: { realm_hints?, source_name?, default_layers?, user_memory_ref? }`
- **一句话收口目标**：✅ **`orchestrator.core` 的最小持久 state 已冻结**

#### F2: `Active session entry`

- **输入**：每个 façade-owned `session_uuid`
- **输出**：`SessionEntry`
- **建议 entry shape**：
  - `created_at`
  - `last_seen_at`
  - `status: "starting" | "active" | "detached" | "ended"`
  - `last_phase?`
  - `relay_cursor?: number // last_forwarded seq, -1 means no frame forwarded yet`
  - `ended_at?`
- **物理布局建议**：
  - `user/meta`
  - `user/auth-snapshot`
  - `user/seed`
  - `sessions/<session_uuid>`
- **F2 implementation note**：
  - 为保持 `SessionEntry` 不扩列，F2 把 terminal reason 作为 bounded sidecar metadata 存在 `session-terminal/<session_uuid>`，而不是塞回 `SessionEntry` 主体。
- **retention 建议**：
  - active / detached 全保留
  - `starting` / `active` / `detached` 不受 ended retention policy 影响
  - ended 保留 bounded recent metadata，采用 **24h 时间窗 + 每 user 最多 100 个 ended sessions** 的双上限策略
  - 超过任一上限时，按 `ended_at` 从旧到新 purge
- **一句话收口目标**：✅ **session registry entry 已具备 attach/reconnect 所需最小字段**

### 7.3 非功能性要求

- **性能目标**：常见 lookup/update 必须是 O(1) key 访问心智模型。
- **可观测性要求**：session entry 必须包含最小 phase/cursor/timestamp 便于诊断。
- **稳定性要求**：schema 不能在 F1/F2 实现中边写边改名。
- **测试覆盖要求**：至少要有 user DO registry lookup/update 行为测试。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/agent.py:75-84` | 初始化 message history / logger / token counters | 中央 owner state 要先列出再增长 | |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/core/src/thread_manager.rs:194-218` | `ThreadManagerState` 聚合线程、auth、model、plugin 等状态 | 先定义中心状态结构，再装配实现 | |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/Task.ts:44-57` | `TaskStateBase` 明确列出最小任务状态形状 | first-wave user DO 也要先冻结最小状态形状 | |
| `context/claude-code/Tool.ts:158-179` | `ToolUseContext.options` 集中管理依赖项 | auth snapshot / seed / session registry 也应中心化 | |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `context/smind-contexter/src/engine_do.ts:55-67` | sessions map、director、active conversation、DB 都堆在一个 DO 里 | first-wave 只需要 registry，不需要 full business substrate |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`F0 User DO Schema` 会把 `orchestrator.core` 从“会转发的 façade”推进到“有最小状态的 façade”。它的复杂度来自范围控制：既不能太薄到撑不起 reconnect / seed / registry，也不能太厚到偷渡 richer memory。它是本阶段最典型的“需要克制”的设计层。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | user DO 是否非空，全靠它 |
| 第一版实现的性价比 | 5 | 一份 schema freeze 能换来大量实现确定性 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 4 | 可作为 richer memory 的基座 |
| 对开发者自己的日用友好度 | 4 | 写代码时少很多临场 invent |
| 风险可控程度 | 4 | 风险主要在 retention 边界，但可控 |
| **综合价值** | **5** | **是 F1/F2 必需的基础设计** |

### 9.3 下一步行动

- [ ] **设计冻结回填**：把 `tenant_source` 与 `24h + 100` 双上限 retention 写进 F0 / F2 action-plan 的 schema checklist。
- [ ] **关联 Issue / PR**：`docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`
- [ ] **待深入调查的子问题**：
  - purge 采用 lazy cleanup、alarm 还是两者结合
- [ ] **需要更新的其他设计文档**：
  - `F0-session-lifecycle-and-reconnect.md`
  - `F0-stream-relay-mechanism.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-24 | GPT-5.4 | 初稿 |
| v0.2 | 2026-04-24 | GPT-5.4 | 吸收 review + FX-qna，冻结 `tenant_source` 与 ended-session `24h + 100` 双上限 retention |
