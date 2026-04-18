# Nano-Agent Trace-first Observability Foundation 功能簇设计

> 功能簇: `Trace-first Observability Foundation`
> 讨论日期: `2026-04-17`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
> - `docs/design/after-skeleton/P0-identifier-law.md`
> - `docs/design/after-skeleton/P2-observability-layering.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

在 Phase 0 已经冻结 `trace_uuid` canonical 与 UUID-only internal naming 之后，Phase 2 不能继续把 observability 理解成“多打一批日志”。对 nano-agent 来说，observability foundation 要回答的是：

> **trace_uuid 如何成为 runtime 的第一事实，如何在 ingress、session edge、LLM/tool/hook/compact、checkpoint/restore 中被持续携带、锚定、恢复和解释。**

当前代码现实说明我们已经有了 foundation 的半成品，但还没有真正 trace-first：

- `NacpObservabilityEnvelope` 已经使用 `trace_uuid`，但它仍是 optional（`packages/nacp-core/src/observability/envelope.ts:12-29`）。
- `TraceEventBase` 目前只有 `sessionUuid` / `teamUuid` / `turnUuid`，还没有 `traceUuid`（`packages/eval-observability/src/trace-event.ts:13-70`）。
- `session-do-runtime/src/traces.ts` 仍在生成 `turn.started` / `turn.completed` 这类与当前 session event catalog 已经漂移的名字，且没有携带 `trace_uuid`（`packages/session-do-runtime/src/traces.ts:37-105`）。
- `SessionInspector`、`DoStorageTraceSink`、`audit-record` codec、`DurablePromotionRegistry` 都已经搭好了骨架，说明“基础设施外壳”存在；真正欠缺的是 **trace-first 语义闭合**。

- **项目定位回顾**：nano-agent 的 observability 不是外挂，而是 runtime correctness 的组成部分。Worker/DO 环境没有传统本地 stdout 和稳定常驻进程，trace-first 更加必要。
- **本次讨论的前置共识**：
  - `trace_uuid` 是唯一 canonical trace identity。
  - accepted internal request 若没有 trace_uuid，必须在 ingress/anchor 层被补齐并建立锚点，而不是让后续 runtime 在半失联状态下继续执行。
  - observability 需要区分 anchor、durable evidence、diagnostic 三层。
  - 当前 Phase 不追求完整 analytics 平台，而追求 **正确的 trace law + 正确的 recovery law + 正确的 instrumentation seam**。
  - 当前代码 reality 仍处在 pre-migration 状态；Phase 2 只能在 P0 rename/compat chain 与 event-kind convergence 启动后，才把 `trace_uuid` law 从 owner target 变成跨包 enforcement reality。
- **显式排除的讨论范围**：
  - 不讨论 public observability API
  - 不讨论 D1 analytics schema
  - 不讨论 DataDog / OTLP / Grafana exporter
  - 不讨论完整模型质量评估体系

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Trace-first Observability Foundation`
- **一句话定义**：它是 nano-agent 的 trace law、recovery law、instrumentation law 的总设计，负责让 `trace_uuid` 成为 runtime 的第一事实，而不是事后补写的日志标签。
- **边界描述**：**包含** trace law、anchor/recovery、TraceEvent base contract、instrumentation points、sink/codec alignment、alert exception rule；**不包含** dashboard/query API、BI schema、OTEL exporter。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **Trace Law** | 哪些 runtime 行为必须带 trace_uuid，哪些例外允许无 trace_uuid | 它首先是 correctness law |
| **Trace Anchor** | 能确保 trace_uuid 不丢失、能回溯、能重建的最小 durable 记录 | 不要求包含全部 payload |
| **Recovery Law** | 当局部链路丢失 trace_uuid 时，系统如何通过 anchor 恢复而不是崩溃 | 不允许 silent fallback |
| **Instrumentation Point** | 必须 emit trace 的关键 runtime 位置 | 如 ingress、turn.begin、api.error、checkpoint |
| **TraceEvent** | eval-observability 中的统一 trace evidence 对象 | Phase 2 需升级其 base fields |
| **Alert Exception** | 平台级/worker级告警可不属于某个 request trace 的例外 | 必须被显式限制 |

### 1.2 参考调查报告

- `docs/investigation/codex-by-opus.md` — codex 的 trace context 传播最接近“trace-first runtime”
- `docs/investigation/claude-code-by-opus.md` — claude-code 的 telemetry 证明 observability 不应只是 raw logging，而应包含 attribution / sequence / cache break reasoning
- `docs/investigation/mini-agent-by-opus.md` — mini-agent 证明没有 trace law 时，日志只能做人肉排查

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **runtime correctness guardrail + evidence foundation**。
- 它服务于：
  1. `session-do-runtime`
  2. `eval-observability`
  3. `nacp-core`
  4. hooks / llm-wrapper / capability-runtime / workspace-context-artifacts
- 它依赖：
  - `trace-substrate-decision.md` 对 substrate 的选择
  - `identifier-law.md` 对 `trace_uuid` 的命名法冻结
  - 当前 `nacp-core` / `nacp-session` / `eval-observability` reality
- 它被谁依赖：
  - Phase 3 session edge closure
  - future API / DDL design
  - deployment dry-run、storage evidence、E2E 诊断

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `NACP-Core` | Foundation -> Core | 强 | observability envelope、trace schema、audit.record codec 受其约束 |
| `NACP-Session` | Foundation -> Session | 强 | session edge 进出站都要携带/消费 trace_uuid |
| `Eval-Observability` | 双向 | 强 | TraceEvent、sink、timeline、inspector 是本设计的落地载体 |
| `Session DO Runtime` | 双向 | 强 | ingress、turn loop、checkpoint/alarm 是主要 instrumentation 源 |
| `LLM Wrapper` | Foundation -> LLM | 中 | api.request/response/error 的 attribution 与 debug context 需对齐 |
| `Hooks` | Foundation -> Hooks | 中 | hook.broadcast / hook.outcome 既是 governance evidence，也是 replay clue |
| `Capability Runtime` | Foundation -> Capability | 中 | tool call/result/progress 的 durable/diagnostic 分层受其影响 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Trace-first Observability Foundation` 是 **runtime correctness 与证据基础层**，负责 **把 `trace_uuid` 从命名约定提升为全链路 runtime 第一事实**，对上游提供 **anchor / recovery / instrumentation / evidence 的统一准则**，对下游要求 **任何重要 runtime 行为都不能脱离 trace law 自行扩展**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 一上来做完整 OTEL exporter | codex/平台型工程 | 当前更关键的是 trace law 与 evidence shape | 可能 |
| 把所有 diagnostic event 都 durable 化 | 丰富 telemetry 平台常见倾向 | 会带来写放大与信号噪音 | 否 |
| 让 trace_uuid 继续 optional | 当前 `NacpObservabilityEnvelope` reality | 与 owner 决策冲突，也会削弱 recovery law | 否 |
| 允许业务代码自由拼 trace detail | 宽松 logging 习惯 | 最终会丢失统一 evidence truth | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| TraceEvent base | `TraceEventBase` | Phase 2 升级为含 `traceUuid` / source metadata | event-specific builders / richer guards |
| Audit codec | `traceEventToAuditBody` / `auditBodyToTraceEvent` | 当前 body-level codec | future core schema-driven codec |
| Alert exception policy | `NacpAlertPayload.trace_uuid?` | 仅允许平台级 alert 例外 | future stronger typed alert kinds |
| Recovery hooks | anchor lookup / rebuild seam | Phase 2 定义 contract | Phase 5/6 实现/验证 |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：Anchor/recovery law vs analytics/query
- **解耦原因**：前者服务 runtime survival；后者服务观察便利。
- **依赖边界**：无 query 平台也必须能恢复 trace。

- **解耦对象**：Diagnostic noise vs durable evidence
- **解耦原因**：`llm.delta` / `tool.call.progress` 之类高频事件不能直接等同于 durable truth。
- **依赖边界**：diagnostic 可 sampled/ephemeral；anchor 与 durable evidence 不能丢。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：trace law、alert exception、instrumentation point catalog、TraceEvent base contract
- **聚合形式**：由 `trace-first-observability-foundation.md` 统一规定，再由 `eval-observability` / `session-do-runtime` 实作
- **为什么不能分散**：如果 trace law 分散在各包 README、tests、comments 里，任何一个包都可能重新发明“自己的 trace 真相”。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：有 append-only log，但没有统一 trace identity，也没有 recovery law。
- **亮点**：
  - 早期验证成本低
  - 对调试直观
- **值得借鉴**：
  - 事件记录最小闭环的重要性
- **不打算照抄的地方**：
  - 不把“写了日志”误当成 trace-first

### 4.2 codex 的做法

- **实现概要**：把 trace context 当成一等公民，并通过 W3C trace context 与 span 传播实现跨边界连续性。
- **亮点**：
  - trace continuation 非常严肃
  - current span trace id 能被稳定提取
- **值得借鉴**：
  - trace 要能传播、恢复、验证
- **不打算照抄的地方**：
  - 不直接复制完整 OTEL crate/runtime

### 4.3 claude-code 的做法

- **实现概要**：sequence、metadata、cache break attribution、gateway detection 都说明 telemetry 应该是“解释系统行为”的结构化设施，而不是纯打印。
- **亮点**：
  - event sequence 清晰
  - deferred sink、metadata guard、cache break reasoning 很成熟
- **值得借鉴**：
  - observability 应自带 attribution
  - sink 未 ready 不能丢关键信号
- **不打算照抄的地方**：
  - 不引入其整套平台 telemetry 复杂度

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| trace 作为 runtime 第一事实 | 低 | 高 | 中高 | 高 |
| recovery / continuation 严肃度 | 低 | 高 | 中 | 高 |
| attribution 细腻度 | 低 | 中 | 高 | 中高 |
| event volume discipline | 低 | 中 | 高 | 高 |
| 对 Worker/DO 环境适配度 | 低 | 低 | 中 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] 定义 trace law**：必须明确哪些 accepted internal 行为必须带 trace_uuid，哪些是例外。
- **[S2] 定义 recovery law**：必须明确 trace 丢失时如何通过 anchor 重建或拒绝，而不是无声继续。
- **[S3] 升级 TraceEvent base contract**：必须让 `eval-observability` 真正 carry `trace_uuid`。
- **[S4] 定义 instrumentation point catalog**：必须明确 ingress、turn、api、hook、tool、compact、checkpoint、alarm 的 trace 责任。
- **[S5] 定义 alert exception rule**：必须明确 `trace_uuid` 可选只属于 platform-level alerts。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] 跨租户 trace 查询 API**
- **[O2] 生产级 dashboard / alert routing**
- **[O3] 完整 OTEL/OTLP exporter**
- **[O4] 复杂 LLM quality benchmark**

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `NacpAlertPayload.trace_uuid` 平台级可选 | in-scope | 需要显式定义例外边界 |
| `TraceEventBase` 现在无 `traceUuid` | in-scope | 这是 Phase 2 必须补齐的 foundation 缺口 |
| `llm.delta` 全量 durable | out-of-scope | 只属于 diagnostic/live |
| `api.error` attribution | in-scope | 属于 durable evidence 的关键案例 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **strict trace law** 而不是 **“尽量带 trace 就好”**
   - **为什么**：Worker/DO 环境一旦丢失 causal chain，后续恢复与诊断成本极高。
   - **我们接受的代价**：要在 ingress、session edge、builders、codec 里做更严格对齐。
   - **未来重评条件**：无；这属于 runtime law，不是风格偏好。

2. **取舍 2**：我们选择 **anchor + durable evidence + diagnostic 分层** 而不是 **把 observability 看成单一事件流**
   - **为什么**：不同层的 durability、payload、query 需求完全不同。
   - **我们接受的代价**：概念上多一层抽象。
   - **未来重评条件**：只有当系统证明这三层没有差异时，才可能合并；当前显然不成立。

3. **取舍 3**：我们选择 **typed builders / typed base contract** 而不是 **各包自由拼 detail**
   - **为什么**：后者会迅速导致 evidence 漂移和 replay 不可解释。
   - **我们接受的代价**：builder 与 codec 要更集中、更严格。
   - **未来重评条件**：只有在确有未知新 evidence 需要探索时，才允许先放 `extra/detail`，但不能长期游离。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| trace law 过严导致边缘请求被拒 | ingress 没有生成 anchor 的补位逻辑 | runtime 拒绝过多请求 | 明确区分 ingress-generated trace 与 accepted internal request |
| 层次过多导致实现混乱 | 没有层级映射表 | package 再次各自理解 | 用 `observability-layering.md` 提供配套矩阵 |
| old event builders 漂移 | `session-do-runtime/src/traces.ts` 未同步 | trace/event 名字再次分叉 | Phase 2 先收敛 builders 与 event names |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：之后再看任何 trace/evidence，都知道它处在哪层、是否应 durable、是否带 trace_uuid。
- **对 nano-agent 的长期演进**：未来 D1 query、archive、public API 都有稳定基础件。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：稳定性直接获益；上下文压缩与 Skill 执行也将拥有可回溯证据链。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Trace Law | 定义哪些 accepted internal 行为必须带 trace_uuid | 任何关键 runtime 行为都能被 trace_uuid 锚定 |
| F2 | Recovery Law | 定义 trace 丢失时的 anchor/rebuild 行为 | trace 丢失不再等于 runtime 崩溃或 silent drop |
| F3 | TraceEvent Upgrade | 升级 TraceEvent base contract | `eval-observability` 真正变成 trace-first |
| F4 | Instrumentation Catalog | 冻结必须打点的 runtime 位置 | observability 不再靠“想到哪打到哪” |
| F5 | Alert Exception Policy | 收紧 `trace_uuid` optional 例外 | 平台级告警和请求级 trace 不再混淆 |

### 7.2 详细阐述

#### F1: `Trace Law`

- **输入**：owner 的 `trace_uuid` 决策、当前 `nacp-core` / `session-do-runtime` reality
- **输出**：一组强制规则
- **主要调用者**：`nacp-core`、`session-do-runtime`、`eval-observability`
- **核心逻辑**：
  1. ingress 接受外部请求时，若尚无 trace_uuid，则立即生成并建立 anchor
  2. 一旦请求被接受为 internal runtime work item，其后续消息/事件必须带 trace_uuid
  3. 任何脱离 trace_uuid 的 accepted internal message 视为非法
- **边界情况**：
  - worker-level platform alerts 可不挂某个 request trace_uuid
- **一句话收口目标**：✅ **`accepted internal runtime work 永远可被 trace_uuid 追到头`**

#### F2: `Recovery Law`

- **输入**：trace anchor、session_uuid、message_uuid、turn_uuid 等最小结构
- **输出**：trace rebuild seam
- **主要调用者**：session edge、checkpoint/restore、failure replay
- **核心逻辑**：
  - trace_uuid 不是“可有可无的标签”，而是可通过 anchor 查回的 runtime 主索引
  - recovery lookup priority 固定为：`trace_uuid` 直达 > `message_uuid` 锚点 > `turn_uuid + session_uuid` 锚点 > 当前 checkpoint / replay window 中的最近 durable anchor
  - recovery 只允许使用 **已知锚点** 与 compat-decoded durable evidence；不允许靠模糊字符串或 best-effort 猜测拼一个 trace_uuid
  - 跨 worker / remote seam 若返回了 request-scoped payload 但丢失 `trace_uuid`，必须进入 `cross-seam-trace-loss` 显式失败或 quarantine path，不能继续向下游扩散
  - replay / restore 读取旧数据时，必须先经 compat layer 补齐 retired fields，再尝试 recovery；compat 失败与 anchor 缺失是两种不同错误类别
  - recovery 错误至少区分：`anchor-missing`、`anchor-ambiguous`、`compat-unrecoverable`、`cross-seam-trace-loss`
  - 热路径 recovery 必须是局部、可界定成本的：默认只允许读当前 actor state、最近 replay buffer、checkpoint 或本 session durable window，不允许为修一个 trace 做全量历史扫描
  - Phase 2 implementation 至少要覆盖 6 类场景：ingress 无 trace 需生成锚点、remote worker response 丢 trace、alarm/restore 缺当前 turn trace、旧 audit body 仅有 retired trace fields、compact/replay 后重建 trace、message/session 级锚点冲突
- **边界情况**：
  - 平台级 alert 不是 recovery 来源；只有 request/session/turn-scoped anchor 才能参与 recovery
- **一句话收口目标**：✅ **`trace 丢了也能明确恢复或明确失败，不再半死不活`**

#### F3: `TraceEvent Upgrade`

- **输入**：当前 `TraceEventBase`
- **输出**：新的 trace-first base contract
- **主要调用者**：`DoStorageTraceSink`、`audit-record` codec、timeline/inspector
- **核心逻辑**：
  - `TraceEventBase` 应新增至少：`traceUuid`、`sourceRole`、`sourceKey?`、`messageUuid?`
  - `sessionUuid` / `teamUuid` / `turnUuid` 继续保留
  - 所有 builders 统一产出这套 base fields
- **边界情况**：
  - old audit body 可通过 compat decode 补齐缺失字段
- **一句话收口目标**：✅ **`TraceEvent 不再只是 session-scoped，而是真正 trace-scoped`**

#### F4: `Instrumentation Catalog`

- **输入**：当前 session-do-runtime / eval-observability / nacp-session seams
- **输出**：最低必打点目录
- **主要调用者**：runtime packages
- **核心逻辑**：至少包括：
  1. ingress accept / authority stamping / trace generation
  2. WS attach / detach / resume / replay
  3. turn.begin / turn.end / cancel
  4. api.request / api.response / api.error
  5. hook.broadcast / hook.outcome
  6. tool.call.request / result / summarized progress
  7. compact.start / compact.end / compact.notify
  8. checkpoint / restore / alarm health
  9. context.assembly / optional-layer-drop / truncation
  10. storage.placement / artifact promotion / archive flush
- **边界情况**：
  - 高频 diagnostic event 可不全量 durable
- **一句话收口目标**：✅ **`所有关键 runtime 边界都有固定 trace 证据出口`**

#### F5: `Alert Exception Policy`

- **输入**：当前 `NacpAlertPayloadSchema`
- **输出**：对 optional `trace_uuid` 的收紧说明
- **主要调用者**：core observability envelope、platform diagnostics
- **核心逻辑**：
  - request/session/turn 级 alert 必须带 trace_uuid
  - 只有 truly platform-level / worker-level alert 才允许无 trace_uuid，例如 worker cold-start anomaly、binding unavailable、queue overflow、archive backpressure 这类不归属单个 request 的事件
- **边界情况**：
  - 若 alert 关联 session_uuid 但无 trace_uuid，属于不合法状态，应走 recovery
- **一句话收口目标**：✅ **`trace_uuid optional 不再成为偷懒口子，只保留受控例外`**

### 7.3 非功能性要求

- **性能目标**：trace builders 应以薄层结构为主，避免在最热路径写入巨 payload。
- **可观测性要求**：事件既要能解释“发生了什么”，也要能解释“为什么发生”。
- **稳定性要求**：foundation 规则优先于任何单个 package 的方便实现。
- **测试覆盖要求**：必须覆盖 trace generation、anchor recover、alert exception、audit round-trip、timeline reconstruction。
- **阶段门禁要求**：P2 enforcement 以前必须完成至少两件事：`trace_id -> trace_uuid` 的 canonical migration 进入 compat chain，以及跨包 event-kind strings 的集中收敛；P3/P4/P6 只能消费这套升级后的 foundation，不得再发明平行 trace carrier。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/logger.py:43-83` | REQUEST/RESPONSE/TOOL_RESULT append-only log | 基础事件骨架值得借鉴 | 但缺 trace law 与 recovery |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/otel/src/trace_context.rs:19-59` | current trace context / parent context 设置 | trace continuation 是 runtime 基础行为 | 很适合 nano-agent 的 trace-first 思路 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/utils/telemetry/events.ts:21-75` | event.sequence / prompt.id / metadata injection | observability 需要 sequence 与稳定公共字段 | 比纯 console log 高一个层级 |

### 8.4 需要避开的“反例”位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `packages/eval-observability/src/trace-event.ts:13-70` | 当前 base fields 没有 `traceUuid` | 说明还没真正 trace-first |
| `packages/session-do-runtime/src/traces.ts:37-105` | 仍在生成 `turn.started` / `turn.completed`，且缺 `trace_uuid` | foundation 必须先收敛 builders 与命名 |
| `packages/nacp-core/src/observability/envelope.ts:12-29` | `trace_uuid` 仍 optional | 必须通过 exception policy 收紧 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`Trace-first Observability Foundation` 是 nano-agent 真正从“有点日志”走向“可恢复、可解释、可证明”的关键阶段。它不会直接增加用户可见功能，但会重写全系统对 trace 的态度：trace_uuid 不再只是 header 里的一个字段，而是 ingress、turn、checkpoint、replay、error attribution 的共同坐标。这个 foundation 的复杂度不在代码量，而在于它会统一多包之间的认知边界。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | trace-first 是当前阶段最该优先完成的基础能力 |
| 第一版实现的性价比 | 5 | 成本主要是 contract 收敛，但收益覆盖所有 runtime 包 |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 5 | 三条主线都会直接受益 |
| 对开发者自己的日用友好度 | 4 | 前期更严格，后期定位问题快得多 |
| 风险可控程度 | 4 | 主要风险是旧 builders/旧 event names 漂移，可通过 Phase 2 批量收敛 |
| **综合价值** | **5** | **是 post-skeleton 阶段最关键的基础设计之一** |

### 9.3 下一步行动

- [ ] **决策确认**：确认 TraceEvent base contract 必须增补 `traceUuid`。
- [ ] **关联 Issue / PR**：收敛 `session-do-runtime` builders 与 `eval-observability` base types。
- [ ] **关联 Issue / PR**：建立集中 event-kind registry，并让 edge/runtime/observability 共享它。
- [ ] **待深入调查的子问题**：
  - [ ] `messageUuid` 是否进入所有 TraceEvent base fields
  - [ ] alert exception 是否需要单独 schema 类型区分
- [ ] **需要更新的其他设计文档**：
  - `observability-layering.md`
  - `session-edge-closure.md`
  - `storage-and-context-evidence-closure.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：trace 是日志字段还是 runtime law
  - **A 方观点**：先在少量地方带 trace 即可
  - **B 方观点**：accepted internal request 必须有 trace_uuid 与 anchor
  - **最终共识**：trace_uuid 是 runtime law，而不是 best-effort label

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
