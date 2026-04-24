# Nano-Agent 功能簇设计模板

> 功能簇: `F0 Stream Relay Mechanism`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/plan-orchestration-facade.md`、`docs/plan-orchestration-facade-reviewed-by-opus-2nd-pass.md`
> 文档状态: `frozen (F0 closed; reviewed + FX-qna consumed)`

---

## 0. 背景与前置约束

orchestration-facade 阶段最难偷懒的一层，不是 public route 本身，而是 **`agent.core -> orchestrator.core` 的 stream relay**。当前 `agent.core` 已有 public WS ingress；但在新架构里，这条 WS 不再是 future internal seam。我们必须定义一个 first-wave 可落地、与 fetch transport 一致、且能支撑 reconnect 的 relay 机制。F1/F2 已验证的现实形态是 **snapshot-over-NDJSON relay**，不是持续 push 的 live stream。

- **项目定位回顾**：本阶段要把 client-facing 实时会话能力交给 `orchestrator.core`，同时避免引入新的 transport 大爆炸。
- **本次讨论的前置共识**：
  - worker-to-worker 不走 WS
  - first-wave internal stream transport 选 HTTP streaming response
  - legacy `agent.core /sessions/:id/ws` 只做迁移期遗留入口
  - relay owner 在 orchestrator user DO
- **显式排除的讨论范围**：
  - SSE-only public contract 重做
  - queue/broker 总线
  - binary framing

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`F0 Stream Relay Mechanism`
- **一句话定义**：定义 `agent.core` 如何把 session stream 以 HTTP streaming / NDJSON 形式提供给 `orchestrator.core`，以及 `orchestrator.core` 如何将其 relay 给 client WS。
- **边界描述**：本功能簇**包含** internal stream route、framing、cursor、terminal semantics、legacy WS fate；**不包含** public route contract 与 internal auth header 的完整定义。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| relay stream | `agent.core -> orchestrator.core` 的 NDJSON relay body | first-wave 为 snapshot-based |
| relay cursor | façade 记录的 `last_forwarded.seq` | reconnect 从 `cursor + 1` 恢复 |
| data frame | 承载 session stream event 的单条流消息 | NDJSON line |
| terminal frame | 表示本次 stream 正常/异常结束的单条消息 | 不能只靠 EOF 猜 |
| legacy WS ingress | `agent.core /sessions/:id/ws` | 迁移期遗留，不是 internal seam |

### 1.2 参考调查报告

- `docs/plan-orchestration-facade.md` — §1.7 / §1.8 / §6.2 / §6.3
- `docs/plan-orchestration-facade-reviewed-by-opus-2nd-pass.md` — G3 / M3 / S6

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **runtime event bridge** 的角色。
- 它服务于：
  - client WS consumer
  - orchestrator user DO
  - reconnect flow
- 它依赖：
  - internal binding contract
  - user DO registry / relay cursor
  - `session_uuid` lifecycle
- 它被谁依赖：
  - F1 first roundtrip
  - F2 public WS / reconnect
  - F3 legacy WS retirement

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| internal binding contract | start/input/cancel -> stream open/close | 强 | action 与流生命周期成对出现 |
| user DO schema | relay cursor <-> active session entry | 强 | reconnect 依赖 cursor |
| public WS contract | relay -> client | 强 | internal stream 不直接暴露给 client |
| authority policy | internal stream request legality | 中 | stream 路径仍需 internal auth |
| live E2E migration | stream behavior -> tests | 中 | WS/reconnect 测试未来要依赖 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`F0 Stream Relay Mechanism` 是 **runtime output bridge**，负责 **把 `agent.core` 的 session stream 以 HTTP streaming / NDJSON 拉到 `orchestrator.core`，再由 user DO relay 给 client**，对上游提供 **稳定的 first-wave event flow**，对下游要求 **明确 framing、cursor 与 terminal semantics**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| worker-to-worker WebSocket | 全双工 agent mesh 常见做法 | 平台与复杂度都不划算 | 低 |
| binary/protobuf framing | 高性能流系统常见 | first-wave 没必要 | 中 |
| broker / queue fanout | 大规模多消费者系统常见 | 当前只需 façade user DO relay | 中 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| stream route | `GET /internal/sessions/:id/stream` | single stream consumer | richer streaming channels |
| framing | NDJSON lines | `meta` / `event` / `terminal` 三类 | versioned framing |
| relay cursor | `last_seq` | reconnect resume hint | stronger replay / ack |
| terminal semantics | explicit terminal line | completed/cancelled/error | richer shutdown causes |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：internal stream framing vs public client WS framing
- **解耦原因**：client-facing protocol 可以更稳定，internal framing 可按 worker needs 调整。
- **依赖边界**：internal stream 只保证 `orchestrator.core` 能消费；public WS 对外再做适配。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：relay cursor、stream lifetime、terminal interpretation
- **聚合形式**：`orchestrator.core` user DO
- **为什么不能分散**：如果 cursor 一半在 agent、一半在 client，reconnect 无法收口。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：没有独立网络流桥，更多是本地消息历史与 summary。
- **值得借鉴**：
  - 不要为了流而流；流机制要服务于真实 owner
- **不打算照抄的地方**：
  - 用单进程消息列表取代明确 relay contract

### 4.2 codex 的做法

- **实现概要**：event mapping / thread manager 清晰，把模型流输出映射成 typed turn items。
- **值得借鉴**：
  - stream 中的事件要 typed
  - terminal / reasoning / agent message 区分清楚
- **不打算照抄的地方**：
  - first-wave 不复制其完整 protocol tree

### 4.3 claude-code 的做法

- **实现概要**：Structured IO 的 outbound queue 保证 control_request 不乱序，session state 与 permission prompt 可回放。
- **值得借鉴**：
  - stream 写出必须有单 writer
  - pending/resolved 状态要有中心记录
- **不打算照抄的地方**：
  - 不把 stdio/SDK host 协议直接照搬到 worker mesh

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| 流事件 typed 化 | 低 | 高 | 中高 | 中高 |
| 中央 writer | 低 | 中 | 高 | 高 |
| reconnect/rollback 语义 | 低 | 高 | 中 | 中 |
| 实现成本 | 低 | 高 | 中 | 中 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** 定义 internal stream route：`GET /internal/sessions/:session_uuid/stream`
- **[S2]** 采用 NDJSON framing
- **[S3]** 定义 `meta` / `event` / `terminal` 三类 frame
- **[S4]** user DO 记录 relay cursor，并支撑 reconnect
- **[S5]** 明确 legacy `agent.core /sessions/:id/ws` 的 fate

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** worker-to-worker WS
- **[O2]** 多消费者 broker/queue
- **[O3]** binary framing / compression

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| internal HTTP streaming = public WS | out-of-scope | 两者是两层协议 |
| stream EOF 是否足够表示结束 | out-of-scope | 必须有 explicit terminal frame |
| legacy `agent.core` WS 是否可 repurpose 为 internal stream | out-of-scope | 已被 r2 明确否决 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **HTTP streaming + NDJSON** 而不是 **worker-to-worker WS**
   - **为什么**：与当前 fetch transport 一致，first-wave 更稳。
   - **我们接受的代价**：没有真正的双向内网流。
   - **未来重评条件**：如果 future richer orchestrator 真的需要更复杂协作。

2. **取舍 2**：我们选择 **explicit terminal frame** 而不是 **只靠 EOF 语义**
   - **为什么**：cancel/error/completed 必须可区分。
   - **我们接受的代价**：需要额外定义 frame taxonomy。
   - **未来重评条件**：无；这是必要清晰度。

3. **取舍 3**：我们选择 **orchestrator user DO 持有 relay cursor** 而不是 **让 client 自己记**
   - **为什么**：reconnect owner 在 façade，不应把关键状态推给 client。
   - **我们接受的代价**：user DO schema 稍厚一点。
   - **未来重评条件**：如果 future client protocol 真需要强 client replay。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| framing 不清楚 | 只写“HTTP streaming”四个字 | F1/F2 实现反复返工 | 明确 NDJSON schema |
| terminal 语义不清 | 只靠 close/EOF | cancel/error 诊断困难 | 引入 explicit terminal frame |
| reconnect 漂移 | cursor 不在 user DO | 客户端与 façade 状态分裂 | relay cursor 写入 registry |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：stream/debug/reconnect 有统一思路，不需要边写边猜。
- **对 nano-agent 的长期演进**：future public WS 能保持稳定，internal stream 可单独进化。
- **对三大深耕方向的杠杆作用**：stability 与 context continuity 都依赖可预测的 relay 层。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Internal stream route | `agent.core` 提供 stream endpoint | ✅ **internal stream 已有明确 fetch target** |
| F2 | NDJSON framing | 以 line-delimited JSON 输出 | ✅ **stream 内容不再需要靠猜测解释** |
| F3 | Relay cursor | user DO 持有 `last_forwarded.seq` | ✅ **reconnect 有 owner** |
| F4 | Terminal semantics | 明确 completed/cancelled/error | ✅ **stream 结束原因可区分** |
| F5 | Legacy WS retirement | `agent.core /sessions/:id/ws` 不再被当 future seam | ✅ **架构意图不再摇摆** |

### 7.2 详细阐述

#### F1: `NDJSON framing`

- **输入**：来自 session runtime 的 stream event
- **输出**：一行一条 JSON frame
- **主要调用者**：`orchestrator.core`
- **核心逻辑**：使用 `Content-Type: application/x-ndjson`；每行一条 frame。
- **冻结 frame type shape**：
  ```ts
  import type { SessionStreamEventBody } from "@haimang/nacp-session";

  type MetaFrame = {
    kind: "meta";
    seq: 0;
    event: "opened";
    session_uuid: string;
  };

  type EventFrame = {
    kind: "event";
    seq: number; // non-negative integer, monotonic increasing from 1
    name: "session.stream.event";
    payload: SessionStreamEventBody;
  };

  type TerminalFrame = {
    kind: "terminal";
    seq: number; // non-negative integer, greater than every prior frame seq
    terminal: "completed" | "cancelled" | "error";
    payload?: {
      code?: string;
      message?: string;
    };
  };

  type StreamFrame = MetaFrame | EventFrame | TerminalFrame;
  ```
- **Zod 对齐要求**：
  - F1 实现时应以同样的 `kind` discriminator 构造 `z.discriminatedUnion("kind", [...])`
  - `seq` 必须校验为 `number().int().nonnegative()`
- **边界情况**：
  - no event before terminal 仍合法
  - terminal 必须最多一条
  - first-wave 当前实现中，terminal line 表示 **本次 relay read 收口**，不自动等于 façade lifecycle 的 `ended`
- **一句话收口目标**：✅ **first-wave internal stream framing 被具体化为 NDJSON 三类 frame**

#### F2: `Relay cursor`

- **输入**：已 relay 的最后一个 seq
- **输出**：写入 user DO `active_sessions[*].relay_cursor`
- **主要调用者**：reconnect flow
- **核心逻辑**：
  - `relay_cursor = last_forwarded.seq`
  - 初始值视为 `-1`
  - reconnect 从 `relay_cursor + 1` 开始恢复
  - first-wave 当前实现中，只有成功 forward 给当前 attachment 的 `event` frame 会推进 cursor；`meta` / `terminal` 不计入 cursor
- **边界情况**：
  - cursor 缺失或为 `-1` 时，从 `seq 0` 的 `meta/opened` 开始
  - 若无法恢复流，只能回退到 typed terminal / timeline fallback，而不是猜测 off-by-one
- **一句话收口目标**：✅ **reconnect 不再依赖 client 自带序号成为唯一真相**

### 7.3 非功能性要求

- **性能目标**：长期目标是不把整段数据缓存后再回传；first-wave 当前实现允许生成有限 snapshot NDJSON body 后立即 close。
- **可观测性要求**：meta/event/terminal frame 必须能在日志中区分。
- **稳定性要求**：frame taxonomy 不能在 F1/F2 实现中随意发散。
- **测试覆盖要求**：至少有 first event relay integration test；未来补 reconnect / terminal tests。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/agent.py:180-220` | token/summary 触发前先检查状态再处理 | 流转与状态变化要先定义边界再执行 | 作为“不要隐式处理”的提醒 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/core/src/event_mapping.rs:135-208` | response item -> typed turn item 映射 | stream event 需要 typed frame，而不是模糊文本流 | |
| `context/codex/codex-rs/core/src/thread_manager.rs:134-171` | thread/fork/interrupt 终止边界 | terminal semantics 要明确 | |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/cli/structuredIO.ts:160-163` | 单一 outbound drain loop 防止乱序 | relay writer 必须单一 | |
| `context/claude-code/cli/structuredIO.ts:149-187` | resolved request tracking | relay/cursor 也应有显式 state | |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `workers/agent-core/src/host/ws-controller.ts:47-63` | 当前只定义 public WS upgrade verdict，不是 worker-to-worker stream contract | 不能把现有 public WS controller 误当 future internal relay 方案 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`F0 Stream Relay Mechanism` 是 orchestrator 真正“有用起来”的那层设计。没有它，`orchestrator.core` 只能做 HTTP façade；有了它，public WS / reconnect / runtime event continuity 才有落点。第一版当前落地为 snapshot-based relay，而不是 persistent push；复杂度中等，但这是架构级复杂度，不是可选增强。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | public façade 是否真实成立，取决于 relay |
| 第一版实现的性价比 | 4 | 复杂度不低，但不做就没有 real-time façade |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 5 | reconnect/stability 直接依赖这层 |
| 对开发者自己的日用友好度 | 4 | 提前冻结后，后续实现会顺很多 |
| 风险可控程度 | 4 | 风险主要在 framing 与 reconnect，设计后可控 |
| **综合价值** | **5** | **是 F1/F2 的前置设计层** |

### 9.3 下一步行动

- [ ] **设计冻结回填**：把 `StreamFrame` discriminated union 与 cursor 语义吸收到 F0 / F1 action-plan 的首批任务。
- [ ] **关联 Issue / PR**：`docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`
- [ ] **待深入调查的子问题**：
  - reconnect 时是否允许 partial replay
- [ ] **需要更新的其他设计文档**：
  - `F0-user-do-schema.md`
  - `F0-session-lifecycle-and-reconnect.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-24 | GPT-5.4 | 初稿 |
| v0.2 | 2026-04-24 | GPT-5.4 | 吸收 review + FX-qna，冻结 StreamFrame type、seq/cursor 语义并移除 overloaded `ended` terminal |
