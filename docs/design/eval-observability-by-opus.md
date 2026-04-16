# Nano-Agent 功能簇设计 — Eval & Observability

> 功能簇: `Eval & Observability`
> 讨论日期: `2026-04-16`
> 讨论者: `Claude Opus 4.6 (1M context)`
> 关联调查报告:
> - `docs/investigation/codex-by-opus.md` §14.4 (tracing / otel / rollout replay)
> - `docs/investigation/claude-code-by-opus.md` §14.4 (tengu telemetry / promptCacheBreakDetection)
> - `docs/investigation/mini-agent-by-opus.md` §14.4 (plain-text log only)
> - `docs/nacp-by-opus.md` v2 §5.4.6 (audit partitioning) + §5.6 (audience / redaction)
> - `docs/action-plan/nacp-core.md` (audit.record message type)
> - `docs/action-plan/nacp-session.md` (session.stream.event catalog with 9 kinds)
> - `docs/design/hooks-by-opus.md` (hook audit log → DO storage JSONL)
> - `docs/design/session-do-runtime-by-opus.md` (Session DO as trace source)
> - `docs/plan-after-nacp.md` §6 (infra + observation windows)
> - `README.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

### 0.1 为什么 Eval & Observability 必须在代码之前设计

`docs/plan-after-nacp.md` §3.2 明确指出：如果不先做 observability / eval harness，后续 DDL / KV / R2 的存储分层决策就是"拍脑袋"。这不是一个"部署后再加"的子系统——它决定了我们**有没有能力判断其他子系统是否正确工作**。

三家代表 agent 的对比更加证实了这一点：
- **codex**：有完整 rollout JSONL + OTEL crate + `response-debug-context` 包，可以 replay 整个会话
- **claude-code**：有 `tengu_*` 系列 telemetry 事件 + `promptCacheBreakDetection` + 会话 transcript 持久化
- **mini-agent**：只有 plain-text log，无法程序化回放，是反例

nano-agent 在 Worker 环境下更需要 observability，因为：
1. **没有本地 terminal stdout**——所有调试信息必须通过结构化事件传递
2. **会话可以跨 hibernation 存活**——需要"事后回放"能力
3. **多租户**——审计必须按 team_uuid 分区，不能 grep 全局日志

### 0.2 前置共识

- NACP-Core 已有 `audit.record` 和 `system.error` 两个 Core message type
- NACP-Session 已有 9 种 `session.stream.event` kinds，包括 `turn.begin` / `turn.end` / `tool.call.progress` / `hook.broadcast` / `llm.delta` / `compact.notify` / `system.notify`
- Hooks design 已定义 audit log 写入 DO storage 的 JSONL 格式
- NACP-Core 有 `control.audience` (internal / audit-only / client-visible) 和 `control.redaction_hint`

### 0.3 显式排除的讨论范围

- 不讨论生产级 APM / DataDog / Grafana 集成
- 不讨论 billing / cost analytics（那是 storage-topology 的范畴）
- 不讨论 LLM evaluation benchmarks（那是 model quality，不是 runtime observability）
- 不讨论跨租户审计查询的 API 设计

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Eval & Observability`
- **一句话定义**：Eval & Observability 是 nano-agent 的**验证与观察基础设施**——提供 trace sink / session inspector / scenario runner / failure replay 四大能力，让我们能判断其他子系统是否正确工作，并为 storage topology 的数据分层决策提供证据。
- **边界描述**：
  - **包含**：trace sink（结构化事件收集）、session timeline（事件序列可视化）、session inspector（实时观察运行中 session）、scenario runner（脚本化 e2e 测试）、failure replay（从审计日志重放失败路径）、storage placement inspector（每条数据落在 DO/KV/R2 的可视化）
  - **不包含**：审计日志的 DDL schema、LLM quality benchmark、billing pipeline、客户端 UI 框架

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|------|------|------|
| **Trace Event** | 一条结构化的运行时事件，由 Session DO / Hook / LLM / Tool 产出 | 格式 = NACP Core envelope (audit.record) 或 Session stream event |
| **Trace Sink** | 事件的持久化目的地 | v1 = DO storage JSONL；未来可 fan-out 到 R2 / Analytics Engine |
| **Session Timeline** | 一个 session 内所有 trace event 按时间排序的序列 | 包括 NACP-Core internal + NACP-Session client-visible 两层 |
| **Session Inspector** | 实时观察一个正在运行的 session 的 stream event flow | 通过 WebSocket 的 `session.stream.event` 订阅实现 |
| **Scenario Runner** | 用脚本化方式驱动 session 走完一个预定义路径 | 输入 = scenario JSON；输出 = pass/fail + timeline |
| **Failure Replay** | 从审计日志中提取失败 session 的事件序列并重新执行 | 需要 audit log 保留完整的请求/响应上下文 |
| **Storage Placement Inspector** | 观察每条数据最终落在 DO storage / KV / R2 的哪个位置 | 为 storage-topology 的决策提供证据 |

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

Eval & Observability 是**验证层**——它不参与 agent 的主循环，但它回答"主循环是否正确工作"这个问题。

它的价值分三层：
1. **开发期**：替代 `console.log` / `print`——在 Worker 环境里没有本地 terminal，所有调试必须走结构化事件
2. **验证期**：替代手动测试——scenario runner 可以脚本化地验证 "session.start → tool call → hook → compact → session.end" 的完整路径
3. **运营期**：替代 log grep——session timeline + failure replay 让"用户说 session 坏了"的排查变成"看 timeline + 重放"

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|---------|---------|------|
| **Session DO Runtime** | Session DO emit trace events → trace sink | 中 | Session DO 是最大的事件源 |
| **NACP-Core** | `audit.record` message type 是 trace event 的载体 | 中 | 审计走 Core transport |
| **NACP-Session** | `session.stream.event` 是 client-visible trace 的载体 | 弱 | inspector 消费 stream |
| **Hooks** | Hook emit/outcome 事件是 trace 的一部分 | 弱 | hooks audit log 格式对齐 |
| **LLM Wrapper** | LLM request/response/usage 是 trace 的一部分 | 弱 | llm.delta 已在 stream event |
| **Capability Runtime** | Tool call/progress/result 是 trace 的一部分 | 弱 | tool 事件已在 stream event |
| **Storage Topology** | storage placement inspector 观察数据落盘位置 | 中 | 这是 topology 决策的证据源 |

### 2.3 一句话定位陈述

> "Eval & Observability 是 nano-agent 的**验证基础设施**，负责**收集结构化 trace、提供 session timeline / inspector / scenario runner / failure replay 四大观察能力**，为**其他子系统的正确性验证**和**storage topology 的数据分层决策**提供可靠证据。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点

| 被砍项 | 砍的理由 | 未来是否回补 |
|--------|---------|-------------|
| 生产级 APM (DataDog/Grafana) | v1 用 DO storage + R2 JSONL 足够 | 按需接 CF Logpush |
| 实时 metrics dashboard | v1 不需要仪表盘；timeline 够用 | v2 |
| 跨租户审计 API | v1 审计按 team 分区，无跨租户查询 | 按需 |
| LLM quality evaluation | 不是 runtime observability | 独立项目 |

### 3.2 接口保留点

| 扩展点 | v1 行为 | 未来可能演进 |
|--------|---------|-------------|
| `TraceSink` 接口 | v1 写 DO storage JSONL | 可换成 R2 / Analytics Engine / Logpush |
| `ScenarioRunner.run(scenario)` 返回 `ScenarioResult` | v1 只检查 pass/fail | 可扩展为覆盖率统计 / regression detection |
| `TimelineQuery(session_uuid, filters)` | v1 返回 event list | 可扩展为时间窗口查询 / 聚合 |

### 3.3 解耦点

- **TraceSink 与 Session DO 分离**：Session DO 只调 `traceSink.emit(event)`，不知道事件写到哪里
- **ScenarioRunner 与 production runtime 分离**：runner 是一个独立的 test harness，不在生产 Worker 里运行
- **Timeline 查询与 trace 写入分离**：写入走 append-only JSONL；查询走独立的 read path

### 3.4 聚合点

- **所有 trace event 走 `audit.record` NACP 消息**——内部 hooks/tool/llm/compact 的 trace 都收敛到 Core 的 `audit.record` message type
- **所有 client-visible trace 走 `session.stream.event`**——9 kinds 是唯一出口

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent

- **做了什么**：plain-text log (`~/.mini-agent/log/agent_run_<ts>.log`)；`/log` slash 命令查看
- **亮点**：人类可读性好
- **局限**：不可程序化 replay、不可结构化查询、不可 audit

### 4.2 codex

- **做了什么**：OTEL crate (`codex-rs/otel/`)；rollout JSONL (`rollout/src/recorder.rs`)；`response-debug-context` 包；session 可从 rollout replay
- **亮点**：rollout JSONL 是"每条 event 一行"的追加格式，既可 audit 又可 replay；`response-debug-context` 让 LLM response 的细节可以被独立复盘
- **借鉴**：JSONL 追加 + per-event 一行 = nano-agent 的 DO storage trace 格式

### 4.3 claude-code

- **做了什么**：`tengu_*` telemetry 事件族（api_success / api_opus_fallback / prompt_cache_break）；`promptCacheBreakDetection` 的 hash + root-cause 模式；`sessionStorage.ts` 的 transcript 持久化
- **亮点**：`promptCacheBreakDetection` 是"主动检测异常 + 归因"的典范——不只是记录，还解释"为什么 cache 命中率掉了"
- **借鉴**：trace event 应该不仅记录"发生了什么"，还记录"为什么"（附带 `reason` / `context` 字段）

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope

- **[S1]** `TraceSink` 接口 + DO storage JSONL 实现：append-only, per-session, tenant-partitioned
- **[S2]** Trace event schema：基于 `audit.record` body 扩展，含 `event_kind` / `timestamp` / `duration_ms?` / `context?` / `error?`
- **[S3]** Session Timeline builder：从 DO storage 读取一个 session 的全部 trace events，按 timestamp 排序
- **[S4]** Session Inspector：通过 `session.stream.event` 的 WebSocket 订阅，实时观察正在运行的 session
- **[S5]** Scenario Runner：脚本化 e2e 测试框架，输入 `ScenarioSpec` 输出 `ScenarioResult`
- **[S6]** Failure Replay helper：从 audit log 提取失败 session 的事件序列，辅助 debug
- **[S7]** Storage Placement Inspector：追踪每条关键数据的 DO/KV/R2 落盘位置
- **[S8]** Trace event 的 audience / redaction 对齐：internal trace 不走 client stream；client-visible trace 消费 `redaction_hint`

### 5.2 Out-of-Scope

- **[O1]** 生产级 APM / metrics / alerting
- **[O2]** 跨租户审计查询 API
- **[O3]** LLM quality benchmarks
- **[O4]** Billing / cost pipeline
- **[O5]** Client-side UI 框架
- **[O6]** D1 / structured query for trace events（v1 只做 append + scan）

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **"DO storage JSONL 作为 v1 trace sink"** 而不是 **"直接上 Analytics Engine / Logpush"**
   - **为什么**：DO storage 是 session actor 级别的强一致存储，trace 天然属于 session scope；不需要跨 session join
   - **代价**：不支持跨 session 查询；大量 trace 会占 DO storage 空间（单 DO 50GB 上限）
   - **重评条件**：当需要跨 session 聚合分析时

2. **取舍 2**：我们选择 **"scenario runner 作为独立 test harness"** 而不是 **"内嵌到 production worker 里"**
   - **为什么**：eval harness 不应该在生产路径上增加 overhead
   - **代价**：scenario runner 需要单独维护 client 连接逻辑
   - **重评条件**：如果需要"在生产环境里跑 smoke test"

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|---------------|
| F1 | TraceSink interface | `emit(event: TraceEvent): Promise<void>` 的抽象接口 | ✅ 可替换的 trace 持久化口子 |
| F2 | DoStorageTraceSink | 把 trace event 追加到 `tenants/{team_uuid}/trace/{session_uuid}/{date}.jsonl` | ✅ 每条 event 一行 JSON |
| F3 | TraceEvent schema | `{event_kind, timestamp, session_uuid, turn_uuid?, step_index?, duration_ms?, context?, error?}` | ✅ 可被 timeline builder 消费 |
| F4 | SessionTimeline | 读取一个 session 的全部 trace events 并按 timestamp 排序 | ✅ 返回 `TraceEvent[]` |
| F5 | SessionInspector | 通过 WebSocket `session.stream.event` 实时观察 | ✅ 可看到 kind / seq / content |
| F6 | ScenarioSpec schema | `{name, steps: [{action, expect}]}` 的脚本化测试定义 | ✅ 可驱动一次 session e2e |
| F7 | ScenarioRunner | 执行 ScenarioSpec，收集 timeline，判断 pass/fail | ✅ `runner.run(spec) → ScenarioResult` |
| F8 | FailureReplayHelper | 从 audit log 提取失败路径的 event 序列 | ✅ 辅助 debug 的 read-only 工具 |
| F9 | StoragePlacementLog | 在关键数据写入时记录"这条数据落在 DO/KV/R2 的哪个 key" | ✅ 为 storage-topology 决策提供证据 |
| F10 | Audience gate | trace event 的 `audience` 字段决定是否进入 client stream | ✅ internal trace 不泄露给 client |

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nacp-core

| 文件 | 借鉴点 |
|------|--------|
| `packages/nacp-core/src/messages/system.ts` | `AuditRecordBodySchema` — trace event 的 NACP 载体 |
| `packages/nacp-core/src/tenancy/scoped-io.ts` | `tenantR2Put` / `tenantDoStoragePut` — tenant-scoped trace 写入 |

### 8.2 来自 nacp-session

| 文件 | 借鉴点 |
|------|--------|
| `packages/nacp-session/src/stream-event.ts` | 9 kinds = client-visible trace 的 catalog |
| `packages/nacp-session/src/redaction.ts` | `redactPayload()` — client-visible trace 的 audience gate |

### 8.3 来自 codex

| 文件 | 借鉴点 |
|------|--------|
| `context/codex/codex-rs/rollout/src/recorder.rs` | JSONL append-only 格式 |
| `context/codex/codex-rs/otel/` | OpenTelemetry integration pattern |

### 8.4 来自 claude-code

| 文件 | 借鉴点 |
|------|--------|
| `context/claude-code/services/api/promptCacheBreakDetection.ts` | "检测异常 + 归因" 模式 |
| `context/claude-code/services/api/logging.ts` | `tengu_*` 事件族 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

Eval & Observability 是 nano-agent 的**验证基础设施**。v1 预期 ~400-600 行核心代码（TraceSink + Timeline + ScenarioRunner），围绕三个原则：
1. **trace event 走 NACP 消息**（`audit.record` for internal, `session.stream.event` for client-visible）
2. **持久化走 DO storage JSONL**（append-only, per-session, tenant-partitioned）
3. **scenario runner 是独立 harness**（不在 production worker 里）

它的最大价值不是"好看的仪表盘"，而是**让后续的 storage-topology 决策有证据**——"什么数据被读了多少次 / 什么数据写了多少次 / 什么数据跨 session 被引用"这些问题的答案，都来自 trace timeline。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | Worker 环境没有 terminal，结构化 trace 是唯一调试路径 |
| 第一版实现的性价比 | 4 | TraceSink + Timeline 很轻；ScenarioRunner 需要投入但回报高 |
| 对 storage-topology 的杠杆 | 5 | 这是 storage 分层决策的证据源 |
| 对开发者日用友好度 | 4 | session inspector 替代 console.log |
| **综合价值** | **5** | **"没有观察窗口就没有证据，没有证据就没有好决策"** |

---

## 附录

### A. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-16 | Opus 4.6 | 初稿 |
