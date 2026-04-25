# Nano-Agent 功能簇设计模板

> 功能簇: `Z2 Session Truth and Audit Baseline`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/charter/plan-zero-to-real.md`、`docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`、`docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

Z2 的任务不是再补几个 route，而是第一次让 nano-agent 的 session/conversation/history/context/audit 成为可持久、可回看、可追责的真实系统。当前 `orchestration.core` user DO 已有 registry/relay 能力，但还没有 DO SQLite、Alarm、conversation 聚合最低集合；同时 `orchestration.core -> agent.core` 仍主要通过 fetch-backed internal HTTP 驱动。Z2 要把这些空白转成最小但真实的 baseline。

- **项目定位回顾**：Z2 是 zero-to-real 的 session/persistence 中轴。
- **本次讨论的前置共识**：
  - conversation/session/turn/message/context snapshot/activity log 都应进入 D1。
  - DO SQLite / Alarm / conversation 聚合最低集合进入 `orchestration.core`。
  - 至少 1 条 control-plane 主方法要双实现可用。
  - history/reconnect/timeline 不能继续主要依赖纯热态。
- **显式排除的讨论范围**：
  - full collaboration richness
  - cold archive / R2 offload
  - 全部 stream-plane 一步到位 RPC-only

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Z2 Session Truth and Audit Baseline`
- **一句话定义**：建立 zero-to-real 的 session/conversation/context/audit 共享真相，并让 orchestrator user DO 获得最小 stateful uplift。
- **边界描述**：本功能簇**包含** D1 conversation core、context snapshot、activity log、DO SQLite/Alarm 最低集合、history/reconnect/timeline read path、control-plane RPC kickoff；**不包含**完整双向 WS 终态与 collaboration richness。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| session truth | conversation/session/turn/message/context/audit 的共享结论 | D1 为主 |
| stateful uplift | 把 user DO 从 registry/relay 提升为真正 user-state host | Z2 最低集合 |
| history read path | 已结束会话与消息仍可查询 | 不再只靠热态 |
| reconnect hint | 支撑 WS/stream 重连的热路径辅助状态 | 多放在 DO SQLite |
| dual implementation | 同一 control-plane 方法同时有旧过渡面与新 RPC 面 | Z2 至少 1 条 |

### 1.2 参考调查报告

- `docs/charter/plan-zero-to-real.md` — §7.3 / §9 / §10
- `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
- `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md`
- `context/smind-contexter/src/engine_do.ts`

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **real loop persistence spine** 的角色。
- 它服务于：
  - web client history/timeline
  - reconnect/readback
  - audit/trace review
  - later Mini Program first real run
- 它依赖：
  - Z1 auth/tenant truth
  - Z2 D1 migrations
  - existing session/runtime scaffold
- 它被谁依赖：
  - Z3 runtime evidence
  - Z4 real client full-chain
  - final closure/handoff

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| Auth foundation | auth -> session | 强 | session truth 依赖真实 user/team |
| D1 schema | schema -> persistence | 强 | Z2 主落点 |
| Binding/RPC | transport -> control plane | 强 | 至少 1 条主方法 dual-implemented |
| Runtime/quota | runtime -> audit | 中 | Z3 evidence 要接在 Z2 truth 上 |
| Clients | client <- history/reconnect | 强 | Z4 真实体验高度依赖 Z2 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`Z2 Session Truth and Audit Baseline` 是 **把 real loop 从热态样机变成可回看系统的阶段**，负责 **落 conversation/session/context/audit 真相与最小 stateful uplift**，对上游提供 **history/reconnect/timeline 的可信 read path**，对下游要求 **runtime 与客户端不再依赖模糊 registry 或纯内存残留**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| full collaboration schema | `smind-06` 更完整模型 | 不影响 first real run | 是 |
| broad fanout / broadcaster 终态 | richer orchestrator 形态 | 可以留给 Z4 收尾 | 是 |
| 全量 stream-plane RPC 化 | transport purity 追求 | 会影响 Z2 主目标 | 是 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| conversation list | read model / query helper | 最小 list/history | richer filters/sorting |
| reconnect hints | DO SQLite tables | session/timeline hints | 更细粒度 cursor state |
| activity log views | views/query helpers | timeline/audit baseline | BI/reporting projections |
| control-plane RPC | start first | 至少 1 条主方法双实现 | 全控制面切换 |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：D1 truth vs hot-state hints
- **解耦原因**：history/audit 必须可从共享真相层读取，热态只能优化体验。
- **依赖边界**：DO SQLite 用于 active pointers、recent cursors、conversation index；D1 提供最终查询与回看。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：conversation/session/turn/message/context/activity
- **聚合形式**：以 conversation 为上位聚合中心
- **为什么不能分散**：否则无法从同一 trace/session/team 维度做回看与排错。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：没有 Worker + shared DB + hot-state 这套分层。
- **亮点**：
  - 状态模型简单
- **值得借鉴**：
  - first-wave 状态结构不要过度复杂
- **不打算照抄的地方**：
  - 不建立 shared session truth

### 4.2 codex 的做法

- **实现概要**：更关注 task/execution，而不是 conversation-centric D1 baseline。
- **亮点**：
  - 生命周期较清楚
- **值得借鉴**：
  - timeline/readback 必须围绕清晰 lifecycle 建模
- **不打算照抄的地方**：
  - 不处理多租户 shared persistence

### 4.3 claude-code 的做法

- **实现概要**：本地交互控制较强。
- **亮点**：
  - task/history 组织清晰
- **值得借鉴**：
  - history 需要服务真实交互，而不是只作日志
- **不打算照抄的地方**：
  - 本地历史文件心智

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| shared session truth | 低 | 中 | 中 | 高 |
| hot-state vs shared DB | 低 | 低 | 低 | 高 |
| reconnect emphasis | 低 | 中 | 中 | 高 |
| audit linkage | 低 | 中 | 高 | 高 |
| multi-client readiness | 低 | 中 | 中 | 中高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** conversation/session/turn/message 真相落 D1
- **[S2]** context snapshot 真相落 D1
- **[S3]** activity/audit truth 落 D1
- **[S4]** orchestrator user DO 获得 DO SQLite/Alarm/conversation 聚合最低集合
- **[S5]** `orchestration.core -> agent.core` control-plane RPC kickoff

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** full collaboration richness
- **[O2]** cold archive / R2 offload
- **[O3]** all stream-plane RPC-only retirement
- **[O4]** final Broadcaster / richer fanout 终态

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| bidirectional WS message handling | partially in-scope | Z4 承接终态，Z2 只需不阻断后续 |
| history API | in-scope | Z2 closure 的核心证据之一 |
| broadcaster/richer fanout | out-of-scope（Z2） | 属于延后 stateful richness |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **先建立 session truth 与最小 hot-state** 而不是 **先接真实 provider 再说**
   - **为什么**：没有 history/audit truth，真实 provider 输出也无法形成可信 loop。
   - **我们接受的代价**：Z2 看起来比直觉中的“数据库补线”更重。
   - **未来重评条件**：无；这是 charter 已固定的顺序。

2. **取舍 2**：我们选择 **conversation 作为聚合中心** 而不是 **继续只按 session_uuid 思考**
   - **为什么**：real client 的 history/list/reconnect 都需要更高层聚合。
   - **我们接受的代价**：需要补 conversation list/read model。
   - **未来重评条件**：若未来产品形态完全不同再重审。

3. **取舍 3**：我们选择 **双实现 1 条主方法证明 RPC kickoff** 而不是 **要求 Z2 一次性切完控制面**
   - **为什么**：这样既能验证方向，也不会挤爆 Z2。
   - **我们接受的代价**：过渡面仍会存在一段时间。
   - **未来重评条件**：Z3/Z4 继续压缩剩余面。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| stateful uplift 不足 | 只落 D1，不补 hot-state | reconnect/history 体验仍差 | 通过 Q6 冻结最低集合 |
| schema 过薄 | 缺 context/activity | real loop 无法审计 | 强制 D1 进入 context/audit |
| RPC 证明过虚 | 选边缘方法完成指标 | 无法证明 control-plane 真的迁移 | 通过 Q7 优先用 `start` |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：session/history/reconnect 有了真正可查的真相层。
- **对 nano-agent 的长期演进**：后续 quota、client、admin 查询都能建立在这一层之上。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：没有稳定 session truth，这三条线很难进入真实使用面。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Conversation Truth | conversation/session/turn/message 落 D1 | ✅ **session 结束后仍可读 history** |
| F2 | Context/Audit Truth | context snapshot + activity logs 落 D1 | ✅ **trace/session/team 可对齐到审计面** |
| F3 | Stateful Uplift | DO SQLite / Alarm / conversation aggregation 最低集合 | ✅ **history/reconnect 不再只靠冷读或残留热态** |
| F4 | RPC Kickoff | 首条 control-plane 双实现 | ✅ **control-plane RPC 已进入主路径证明** |

### 7.2 详细阐述

#### F1: `Conversation Truth`

- **输入**：start/followup/cancel/end/runtime stream
- **输出**：conversation/session/turn/message 记录
- **主要调用者**：`orchestration.core`、`agent.core`
- **核心逻辑**：把 runtime 生命周期映射到持久化 truth，并提供 list/history/timeline read path。
- **边界情况**：
  - conversation 与 session 是两层，不可继续混用
  - terminal session 的 recent metadata 仍可走 hot-state hint
- **一句话收口目标**：✅ **用户断线/重连/稍后回来时仍能看到一致历史**

#### F2: `Stateful Uplift`

- **输入**：active conversation/session、recent stream cursor、history query
- **输出**：DO SQLite + Alarm 组织的热态辅助层
- **主要调用者**：`orchestration.core` user DO
- **核心逻辑**：只保留 real client 必需热路径，不抢 D1 的 SSOT 地位。
- **边界情况**：
  - 具体热态集合由 Q6 拍板
  - 所有热态必须能从 D1 重新构建
- **一句话收口目标**：✅ **user DO 已从 registry/relay owner 升格为最小 user-state host**

### 7.3 非功能性要求

- **性能目标**：history/timeline/readback 有可用路径，reconnect 不出现明显丢帧/丢游标。
- **可观测性要求**：conversation/session/turn/context/activity 都可通过 trace/session/team 关联。
- **稳定性要求**：D1 truth 与 hot-state hints 的责任边界要清楚。
- **测试覆盖要求**：history、reconnect、timeline、conversation list、首条 RPC parity 都要有证明。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/README.md` | 简单 session/state 模型 | 状态模型要克制 | 仅作对照 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/README.md` | 生命周期/线程类概念说明 | timeline/history 应围绕清晰 lifecycle | 间接启发 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/history.ts` | 交互历史组织 | history 需要服务真实用户读回 | 对 client readback 有启发 |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `workers/orchestrator-core/src/user-do.ts` | 当前仍主要是 session registry / relay owner | Z2 目标是让它成为最小 user-state host，而不是停留在代理层 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

Z2 是 zero-to-real 的结构拐点：从“能转发、能跑 loop”变成“跑完以后还留下真实历史和审计”。它必须同时处理 D1 truth、hot-state 最低集合、control-plane RPC kickoff 三件事，因此复杂度较高，但价值同样极高。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 没有 Z2，系统仍不算 real |
| 第一版实现的性价比 | 4 | 复杂，但每一项都直接服务 first real run |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 5 | 这是所有后续高阶能力的持久化地基 |
| 对开发者自己的日用友好度 | 4 | 之后排错、回放、读历史会轻松很多 |
| 风险可控程度 | 4 | 最大风险在 scope 管理，已通过 boundary 缓解 |
| **综合价值** | **5** | **Z2 决定 nano-agent 是否真正拥有 shared session truth** |

### 9.3 下一步行动

- [ ] **决策确认**：在 `ZX-qna.md` 回答 Q5-Q7。
- [ ] **关联 Issue / PR**：conversation/context/audit migrations、DO SQLite uplift、RPC scaffold。
- [ ] **待深入调查的子问题**：
  - activity log read model
  - hot-state 最低集合
  - `start` 双实现 parity 断言
- [ ] **需要更新的其他设计文档**：
  - `ZX-d1-schema-and-migrations.md`
  - `ZX-binding-boundary-and-rpc-rollout.md`
  - `Z4-real-clients-and-first-real-run.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：先接真实 provider 还是先补 session truth
  - **A 方观点**：先接模型更“像真的”
  - **B 方观点**：先把历史/审计/持久化真相补齐
  - **最终共识**：后者优先

### B. 开放问题清单（可选）

- [ ] **Q5**：activity log 单表还是拆表
- [ ] **Q6**：hot-state 最低集合
- [ ] **Q7**：首条 dual-implemented 方法

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-24` | `GPT-5.4` | 初稿 |
