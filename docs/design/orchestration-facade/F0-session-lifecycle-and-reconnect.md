# Nano-Agent 功能簇设计模板

> 功能簇: `F0 Session Lifecycle and Reconnect`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/plan-orchestration-facade.md`、`docs/design/orchestration-facade/F0-user-do-schema.md`、`docs/design/orchestration-facade/F0-stream-relay-mechanism.md`
> 文档状态: `frozen (F0 closed; reviewed + FX-qna consumed)`

---

## 0. 背景与前置约束

本阶段若只定义 `session_uuid` minting owner，而不定义 attach / detach / reconnect 的状态机，那么 `orchestrator.core` 仍然只是“代理 start 请求”的空 façade。`session_uuid` lifecycle 与 reconnect 语义必须在 F0 写死，否则 F1/F2 很容易在多 tab、断线恢复、ended session 行为上边写边改。

- **项目定位回顾**：`orchestrator.core` 是 façade 侧 session owner；`agent.core` 是 runtime 侧 execution owner。
- **本次讨论的前置共识**：
  - `session_uuid` 由 façade mint
  - reconnect owner 在 façade user DO
  - internal stream cursor 也由 user DO 记录
  - first-wave 不做 thread fork / branch / clone
- **显式排除的讨论范围**：
  - richer collaboration/fork model
  - cross-user session attach
  - full history replay protocol

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`F0 Session Lifecycle and Reconnect`
- **一句话定义**：定义 first-wave `session_uuid` 的生命周期状态机，以及 client attach / detach / reconnect 的默认行为。
- **边界描述**：本功能簇**包含** lifecycle states、ownership、attach/reconnect semantics、single attachment recommendation；**不包含** stream framing细节与 richer multi-collaborator model。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| canonical session_uuid | façade mint 的 session id | public truth |
| attachment | client WS 与该 session 的一次绑定 | 不等于 runtime turn |
| detached session | client 断开，但 runtime 可能还在 | reconnect 入口 |
| relay cursor | 已 relay 的最后 seq | reconnect 辅助 |
| terminal session | lifecycle `status = "ended"` 且带有 terminal reason 的 session | 不再恢复 live relay |

### 1.2 参考调查报告

- `docs/plan-orchestration-facade.md` — §4.3 / §4.4 / §11.3
- `docs/design/orchestration-facade/F0-user-do-schema.md`
- `docs/design/orchestration-facade/F0-stream-relay-mechanism.md`

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **session ownership law** 的角色。
- 它服务于：
  - client WS attach/reconnect
  - user DO registry updates
  - canonical cutover
- 它依赖：
  - user DO schema
  - internal stream cursor
  - public façade contract
- 它被谁依赖：
  - F1 mint/start flow
  - F2 public WS / reconnect
  - F3 live E2E migration

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| user DO schema | lifecycle -> state entry | 强 | 每个 state 要有对应字段 |
| stream relay | reconnect <-> relay cursor | 强 | reconnect 依赖 cursor |
| public WS contract | attach/detach -> client | 强 | canonical attach owner 是 façade |
| legacy retirement | lifecycle -> cutover | 中 | legacy WS 退役后 attach 全走 façade |
| authority policy | attach identity -> legality | 中 | attach 仍要经过 auth gate |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`F0 Session Lifecycle and Reconnect` 是 **session ownership state machine**，负责 **明确 `session_uuid` 从 starting 到 ended 的状态变化，以及 attach / detach / reconnect 的默认法则**，对上游提供 **可预测的 WS 行为**，对下游要求 **registry 与 relay cursor 同步**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 多写者 / 多协作者 session | 协作式 agent 系统常见 | first-wave 复杂度过高 | 是 |
| thread fork / snapshot branch | codex/thread systems 常见 | 不属于当前阶段 | 是 |
| client 主导 replay 协议 | richer frontend 常见 | reconnect owner 在 façade | 中 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| status enum | `starting/active/detached/ended` | minimal lifecycle | richer paused / replaying / restoring |
| attachment policy | single active writable attachment | 简化 first-wave | multi-tab fanout / read-only mirrors |
| reconnect result | typed success / terminal / missing | minimal result taxonomy | partial replay / resume snapshots |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：client attachment state vs runtime turn state
- **解耦原因**：WS 是否连着，不等于 runtime 是否还在跑。
- **依赖边界**：attachment 由 façade user DO 管；turn/phase 由 runtime session DO 管。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：`session_uuid` registry ownership、attachment owner、reconnect owner
- **聚合形式**：`orchestrator.core` user DO
- **为什么不能分散**：一旦 client、runtime、registry 各自有一套 session truth，F3 cutover 无法真正完成。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：单 agent owner 持有完整消息状态，几乎没有“attach/reconnect”概念。
- **值得借鉴**：
  - 中央 owner 不要多头
- **不打算照抄的地方**：
  - 不区分 façade owner 与 runtime owner

### 4.2 codex 的做法

- **实现概要**：thread manager、fork snapshot、turn abort 等状态定义较清楚。
- **值得借鉴**：
  - 先定义状态机，再写实现
- **不打算照抄的地方**：
  - first-wave 不做 thread fork / collaboration complexity

### 4.3 claude-code 的做法

- **实现概要**：任务状态、session external metadata、StructuredIO pending/resolved 控制清晰。
- **值得借鉴**：
  - attach/reconnect 需要明确状态而不是临场判断
- **不打算照抄的地方**：
  - 不把 SDK host state machine 照搬为 worker session state machine

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| 生命周期显式程度 | 低 | 高 | 中高 | 高 |
| reconnect owner | 无 | 中 | 中 | 高（façade） |
| first-wave 简洁度 | 高 | 中 | 中 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** `session_uuid` lifecycle state machine
- **[S2]** attach / detach / reconnect 语义
- **[S3]** single active writable attachment 的默认建议
- **[S4]** terminal session 的处理规则

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** 多协作者同时写同一 session
- **[O2]** thread fork / clone / branch
- **[O3]** client 主导 replay 协议

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| single active writable attachment | in-scope | first-wave 最稳的默认值 |
| 多 tab 同时写入 | out-of-scope | race/ownership 复杂度过高 |
| terminal session 的只读查询 | in-scope | status/timeline 仍需可读 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **façade-owned session_uuid lifecycle** 而不是 **runtime 继续自行接纳 public session ids**
   - **为什么**：canonical public owner 必须单一。
   - **我们接受的代价**：`orchestrator.core` 责任更重。
   - **未来重评条件**：无；这是本阶段根前提。

2. **取舍 2**：我们选择 **single active writable attachment** 而不是 **多 attachment 并发写**
   - **为什么**：first-wave 要先稳住 reconnect 与 ownership。
   - **我们接受的代价**：多 tab 体验更克制。
   - **未来重评条件**：若 owner 明确需要 multi-tab live co-view/co-write。

3. **取舍 3**：我们选择 **terminal session 只保留 bounded metadata** 而不是 **立即 purge**
   - **为什么**：刚结束后的状态读取与诊断仍需要事实。
   - **我们接受的代价**：需要 cleanup discipline。
   - **未来重评条件**：若 storage budget 成为核心压力。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| attach/reconnect owner 不清 | runtime 与 façade 都能接 client | dual ownership | 统一收口到 façade |
| multi-tab 语义混乱 | first-wave 不写策略 | 同 session 多写 race | 先冻结 single-writer 默认值 |
| terminal cleanup 漂移 | 无 retention 规则 | registry 膨胀 | bounded ended metadata |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：reconnect 逻辑不再需要实现阶段现场发明。
- **对 nano-agent 的长期演进**：future collaboration/branching 可建立在明确的 first-wave state machine 之上。
- **对三大深耕方向的杠杆作用**：stability 和 context continuity 直接受益。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Lifecycle states | starting -> active -> detached -> ended | ✅ **session 生命周期不再口头描述** |
| F2 | Attachment policy | single active writable attachment | ✅ **first-wave attach 行为可预测** |
| F3 | Reconnect result taxonomy | success / terminal / missing | ✅ **reconnect 不靠模糊状态判断** |
| F4 | Terminal retention | bounded recent-ended metadata | ✅ **结束后仍能完成状态读取与诊断** |

### 7.2 详细阐述

#### F1: `Lifecycle states`

- **输入**：session start / WS attach / detach / terminal signal
- **输出**：registry 中的状态变化
- **主要调用者**：user DO
- **状态机建议**：
  - `starting`
  - `active`
  - `detached`
  - `ended`
- **stream terminal -> lifecycle mapping**：

  | stream terminal | lifecycle.status | client-visible terminal kind |
  |---|---|---|
  | `completed` | `ended` | `session.completed` |
  | `cancelled` | `ended` | `session.cancelled` |
  | `error` | `ended` | `session.error` |
- **F2 implementation note**：
  - internal relay read 的 `terminal` line 本身只表示该次 relay/read 完成，**不自动等于 session ended**。
  - façade 只有在 session-level terminal law 成立时才转 `ended`；F2 当前实现中，普通 `start/input` 完成后无 active attachment 时进入 `detached`，`cancel` 则进入 `ended/cancelled`。
- **边界情况**：
  - `cancel` 结束 turn，不必自动 purge session entry
- **一句话收口目标**：✅ **状态机已最小化且足以支撑 first-wave façade**

#### F2: `Attachment policy`

- **输入**：client WS attach/reconnect
- **输出**：绑定或替换当前 active attachment
- **主要调用者**：public WS ingress
- **默认建议**：
  - first-wave 只允许 **single active writable attachment**
  - 新 attach 到来时，旧 attachment 必须先收到 typed close message，再被 server 主动关闭
  - typed close message 形状冻结为：
    ```json
    {
      "kind": "attachment_superseded",
      "reason": "replaced_by_new_attachment",
      "new_attachment_at": "<timestamp>"
    }
    ```
- **边界情况**：
  - terminal session 不再允许 live attach，upgrade 直接返回：
    ```json
    {
      "error": "session_terminal",
      "terminal": "completed|cancelled|error"
    }
    ```
  - read-only mirror attachment 明确留到下一阶段 richer orchestrator charter，不在 first-wave 偷渡
- **一句话收口目标**：✅ **first-wave attach/reconnect 不再存在隐含多写语义**

#### F3: `Reconnect result taxonomy`

- **输入**：client reconnect request + registry `status/relay_cursor`
- **输出**：`success` / `terminal` / `missing`
- **主要调用者**：public WS ingress / user DO
- **核心逻辑**：
  - `success`：session 仍可恢复 live relay，且从 `relay_cursor + 1` 尝试继续
  - `terminal`：session 已 `ended`，返回 typed terminal result，不再重新 attach runtime stream
  - `missing`：registry 中不存在该 session，返回 typed not-found
- **边界情况**：
  - `relay_cursor = -1` 表示此前尚未 forward 任何 frame，不等于 missing
  - reconnect result 由 façade 生成，不要求 client 自己解释 runtime phase
- **一句话收口目标**：✅ **reconnect 分支不再依赖实现者临场发明语义**

### 7.3 非功能性要求

- **性能目标**：attach / reconnect 决策必须是低开销 registry 读写。
- **可观测性要求**：每次 attach / detach / reconnect 要能在 registry 与日志中看到状态变化。
- **稳定性要求**：状态机与 schema 命名不能在 F1/F2 中来回变化。
- **测试覆盖要求**：至少要有 attach / reconnect / terminal read 三类测试。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/agent.py:100-121` | 取消时只清理不完整消息，保留已完成步骤 | terminal / interrupted state 需要显式边界 | |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/core/src/thread_manager.rs:151-178` | fork snapshot/interrupt 的状态语义 | 生命周期先写状态含义 | |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/Task.ts:15-29` | terminal task status 判定 | first-wave 也要明确什么是 terminal session | |
| `context/claude-code/cli/structuredIO.ts:149-187` | resolved request tracking | reconnect/attach 也需要中心 state 跟踪 | |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `workers/agent-core/src/host/ws-controller.ts:52-63` | 当前只判 session id 合法性，并未承担 façade attach owner 职责 | first-wave attach owner 要搬到 `orchestrator.core` |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`F0 Session Lifecycle and Reconnect` 是一份“小而硬”的设计文档：它不长业务功能，但决定了 façade 到底是不是 session owner。它把 first-wave 的 session 行为缩成一条清晰状态机，并把多协作者/分叉这类重复杂度显式推迟。它的价值在于让 F2 不再靠“凭感觉补齐生命周期”。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | façade 要成 session owner，必须先有 lifecycle law |
| 第一版实现的性价比 | 5 | 一份状态机能换大量实现稳定性 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 4 | future collaboration 可建立在它之上 |
| 对开发者自己的日用友好度 | 4 | 实现 attach/reconnect 时少很多争论 |
| 风险可控程度 | 4 | 风险主要在 single-vs-multi attachment，但已收敛 |
| **综合价值** | **5** | **是 F2 的设计闸门** |

### 9.3 下一步行动

- [ ] **设计冻结回填**：把 superseded close message、terminal attach rejection、reconnect result taxonomy 吸收到 F2 action-plan。
- [ ] **关联 Issue / PR**：`docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`
- [ ] **待深入调查的子问题**：
  - terminal result 是否需要附带最近一次 `last_phase`
- [ ] **需要更新的其他设计文档**：
  - `F0-user-do-schema.md`
  - `F0-stream-relay-mechanism.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-24 | GPT-5.4 | 初稿 |
| v0.2 | 2026-04-24 | GPT-5.4 | 吸收 review + FX-qna，冻结 superseded close message、terminal attach rejection 与 terminal->lifecycle mapping |
