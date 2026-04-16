# Plan After NACP 设计复核 — GPT to Opus

> 审核对象:
> - `docs/design/eval-observability-by-opus.md`
> - `docs/design/session-do-runtime-by-opus.md`
> - `docs/design/storage-topology-by-opus.md`
> 日期: `2026-04-16`
> 审核者: `GPT-5.4`
> 审核依据:
> - `README.md`
> - `docs/plan-after-nacp.md`
> - `docs/action-plan/nacp-core.md`
> - `docs/action-plan/nacp-session.md`
> - `packages/nacp-core/`
> - `packages/nacp-session/`
> - `context/mini-agent`
> - `context/codex`
> - `context/claude-code`

---

## 1. 审核结论总览

这三份文稿里，**`eval-observability-by-opus.md` 最稳**，方向基本正确；**`session-do-runtime-by-opus.md` 最接近 implementation blueprint，但当前仍有两个结构性断点**；**`storage-topology-by-opus.md` 最容易过早冻结实现细节，需要显著降温**。

整体判断如下：

| 文档 | 结论 | 当前判断 |
|------|------|----------|
| `eval-observability-by-opus.md` | **可作为后续 action-plan 输入** | 但需补“durable trace vs live stream”分层，修少量引用漂移 |
| `session-do-runtime-by-opus.md` | **暂不宜直接进入 action-plan** | 需先修正 Session/Core 边界、补齐 user-turn ingress contract |
| `storage-topology-by-opus.md` | **暂不宜作为冻结版本** | 目前对 DO/KV/R2 placement 承诺过早，和 `plan-after-nacp.md` 的“证据反推”原则有张力 |

---

## 2. 先给总体评价：哪些地方是对的

Opus 这轮文稿有三个明显优点：

1. **总体方向没有跑偏**
   - 三份文档都明确站在 `README.md` 的主轴上：Cloudflare-native、DO-centered、WebSocket-first、typed runtime、非 Linux 真相（`README.md:13-45, 167-176`）。

2. **NACP 已经被当成“地基”而不是“可选参考”**
   - 三份文档都把 `nacp-core` / `nacp-session` 当作已冻结合同来使用，而不是绕开它们另起一套 transport 语义。

3. **都具备演进意识**
   - `eval-observability` 留了 sink / runner / replay seam；
   - `session-do-runtime` 留了 composition seam；
   - `storage-topology` 至少试图从“语义层”而不是“DDL 层”讨论存储。

这说明大方向是对的，问题主要出在**边界没有完全收紧**，以及**有些地方冻结得太快**。

---

## 3. 跨文档的主要问题

### 3.1 `session-do-runtime` 重新把 Session phase 语义往 Core 拖，踩到了已经收口过的旧坑

这是本轮最重要的问题。

`nacp-session` 收口时已经明确冻结：

1. Session ingress 负责 authority stamping；
2. Session phase semantics 由 `nacp-session` 自己维护；
3. ack / heartbeat enforcement 是 caller-managed，由 session DO lifecycle 显式调用 helper。

这不是“偏好”，而是已经收口过的边界（`plan.md:163-170`）。

代码事实也已经写死：

- `packages/nacp-session/src/session-registry.ts:1-8,54-58`
  - 明确写着 Core 的 phase table **不覆盖** `session.stream.event / session.stream.ack / session.heartbeat`
  - Session **必须维护自己的 phase matrix**
- `packages/nacp-core/src/admissibility.ts:16-24,51-59`
  - `checkAdmissibility()` 仍然会把 `ctx.session_phase` 交给 Core 的 `isMessageAllowedInPhase()`
- `packages/nacp-core/src/state-machine.ts:21-24,25-64`
  - Core phase table只知道内部消息与少数 `session.*` 触发点，不是 WebSocket profile 的完整 phase source of truth

但 `docs/design/session-do-runtime-by-opus.md` 一边在正文里说 phase gate 依赖 `@nano-agent/nacp-session`（`233-239`），另一边又在参考代码区把 `packages/nacp-core/src/admissibility.ts` 描述成 “DO 的 phase-aware admissibility” 依据（`326-329`）。

**问题不在于“引用了 core”，而在于这个说法会重新制造一个错误的心智模型：**

> 仿佛 Session DO 的 WebSocket profile legality 可以由 Core phase table 仲裁。

这和我们已经修过的断点是同一个问题，只是从“代码层”退回到了“设计层”。

**建议：**

- `session-do-runtime` 必须明确改成：
  - **client/WebSocket/session.* legality → `@nano-agent/nacp-session`**
  - **internal envelope admissibility / deadline / capability scope → `@nano-agent/nacp-core`**
- 文稿里不应再出现 “Core 的 admissibility 管 Session phase” 这种表述。

### 3.2 `session-do-runtime` 没有解决“正常用户 turn 是怎么进来的”

这是第二个 blocker。

`docs/action-plan/nacp-session.md` 当前只冻结了 7 个 Session message：

- `session.start`
- `session.resume`
- `session.cancel`
- `session.end`
- `session.stream.event`
- `session.stream.ack`
- `session.heartbeat`

见 `docs/action-plan/nacp-session.md:197-205`。

而且 action-plan 还明确把下面这件事保留为待决策项：

- **`session.start` 是否带首条用户输入**（`docs/action-plan/nacp-session.md:243-246`）

但 `docs/design/session-do-runtime-by-opus.md` 在附录生命周期里直接写了：

- `NanoSessionDO.webSocketMessage(...)`
- `(user prompt) → addToHistory → runTurn() → phase = turn_running`

见 `session-do-runtime-by-opus.md:402-413`。

**问题：这个“(user prompt)”并没有协议入口。**

当前 NACP 基座还没有定义：

1. 首条用户输入是否塞进 `session.start`
2. attach 之后的后续用户输入走什么消息类型
3. 它属于 `session.*`，还是属于未来另外一层 conversation input contract

也就是说，这份 Session DO 设计已经在画 turn loop，但 **turn loop 的入口合同还没被定义**。

这会直接影响：

- WebSocket ingress dispatch
- replay / resume semantics
- timeline / audit event 的父子关系
- kernel 的 `pending_input` 模型

**建议：**

- 在 `session-do-runtime` 里单独加一个章节，明确写：
  - 这件事当前**尚未冻结**
  - v1 倾向方案是什么
  - 如果不在 `nacp-session` 里定义，就需要一个新的上层 input contract

### 3.3 `storage-topology` 现在还是太像“提前决定实现”，不够像“证据后收敛”

`docs/plan-after-nacp.md` 其实已经把原则钉死了：

- 先补设计和 action-plan；
- 再搭 observability / eval harness；
- 最后根据运行时证据反推 KV / R2 / DO storage 职责（`docs/plan-after-nacp.md:25-27, 58-60, 114-115, 186-188, 255`）。

但 `docs/design/storage-topology-by-opus.md` 虽然在开头承认这个原则（`23-27`），正文却已经给出了大量**非常具体的 placement 决策**：

- 小于 1MB 的 workspace file 放 DO storage（`251-252`）
- `session:messages` 放 DO storage（`244`）
- `audit:{date}` 放 DO storage（`249`）
- compact archive 的 key 结构（`253, 315-316`）
- transcript export 的 key 结构（`254, 317-318`）
- 甚至已经写出了 `SessionCheckpoint` 结构（`263-285`）

这不是不能讨论，而是**冻结得过快**。

尤其是：

1. `workspace file (small, <1MB) -> DO storage`（`251-252`）
2. `workspace_files: Record<string, string>` 进入 checkpoint（`278`）

这两条已经不只是 topology 语义，而是在**替 workspace runtime 提前拍板物理实现**。

而我们前一轮刚冻结的 `Workspace / Context / Artifacts` 设计明确强调：

- mount-based workspace namespace
- artifact-first large object path
- mount router 与 physical storage 分离

见 `docs/design/workspace-context-artifacts-by-GPT.md:33-37, 51-57, 160-163`。

所以当前这份 storage 文稿的问题不是“方向错”，而是：

> 它比 runtime evidence 走得更快，也比 workspace 语义边界走得更实。

**建议：**

- 把现在的 `7.1 三层数据分布表` 改成 **provisional placement hypotheses**
- 把 `1MB threshold` 改成 **待 eval/observability 校准的暂定阈值**
- 把 `SessionCheckpoint` 改成 **候选字段集**，不要先假定 workspace 小文件一定 inline 到 checkpoint

---

## 4. 分文档审核

## 4.1 `docs/design/eval-observability-by-opus.md`

### 4.1.1 做得对的地方

这份是三份里最成熟的一份。

我认可的点：

1. **它真的抓住了 post-NACP 的任务**
   - 不是“做指标面板”，而是“给后续 storage / runtime 决策提供证据”；
   - 这和 `docs/plan-after-nacp.md:89-96, 128-130, 154-158` 是一致的。

2. **它没有把 observability 误写成 product analytics**
   - 把 scenario runner / failure replay / storage placement inspector 当成第一版核心，是正确方向。

3. **它很自然地站在 NACP 之上**
   - internal trace 走 `audit.record`
   - client-visible progress 走 `session.stream.event`
   - 这和 `nacp-core` / `nacp-session` 的分层是一致的。

### 4.1.2 需要修的中等级问题

#### 问题 A：durable trace 与 live stream 还没明确分层

文稿里把 Trace Event 定义成：

> `audit.record` 或 `session.stream.event`

见 `eval-observability-by-opus.md:67-73, 198-204`。

这在概念上没错，但还不够细。

`claude-code` 的事实很重要：

- `context/claude-code/utils/sessionStorage.ts:134-145`
  - progress **不是 transcript message**
- `context/claude-code/utils/sessionStorage.ts:180-195`
  - 高频 tool progress 是 **UI-only ephemeral state**

这说明：

1. **live stream**
2. **durable transcript**
3. **durable audit trace**

不能混成一层。

当前文稿如果不把这三者拆开，后面会出现两个问题：

- timeline builder 可能把高频 progress 当成 durable record
- storage placement inspector 会统计错“真正需要落盘的证据”

**建议：**

- 增加三分法：
  - `Live Session Stream`
  - `Durable Audit Trace`
  - `Durable Transcript / Export`
- 明确：
  - 不是每个 `session.stream.event` 都必须 durable
  - 但某些 `session.stream.event` 可以被摘要/采样/映射为 trace event

#### 问题 B：`TraceEvent` 字段还偏薄，不足以支撑后续 storage/eval 判断

当前文稿给出的核心 trace schema 还是：

```ts
{ event_kind, timestamp, session_uuid, turn_uuid?, step_index?, duration_ms?, context?, error? }
```

见 `eval-observability-by-opus.md:239-248`。

这个 schema 作为最小骨架可以理解，但如果目标真的是为后续：

- storage placement
- failure replay
- cache break attribution
- model / tool cost evidence

提供证据，那它现在还缺几类非常关键的字段槽位，例如：

- `usage_tokens` / per-model usage
- `ttft_ms`
- `attempt`
- `provider` / `gateway`
- `cache_break_reason` 或至少 `cache_state`

这不是要把 claude-code / codex 的 telemetry 全搬过来，而是至少要保证：

> 这份 trace schema 不会在 action-plan 第一周就被迫扩容。

相关参考代码其实已经给了足够强的信号：

- `context/codex/codex-rs/response-debug-context/src/lib.rs:11-17,19-27,37-53`
- `context/codex/codex-rs/otel/src/events/session_telemetry.rs:77-91,141-192`
- `context/claude-code/services/api/promptCacheBreakDetection.ts:28-69,71-99`
- `context/claude-code/cost-tracker.ts:143-174`

**建议：**

- 不一定现在就把所有字段钉死；
- 但应在文稿里把 `TraceEvent` 拆成：
  - **base fields**
  - **llm/tool/cache/storage evidence extensions**
- 至少为上述高价值字段预留扩展位。

### 4.1.3 小问题 / 引用漂移

1. `codex-rs/otel/src/session_telemetry.rs`
   - 实际路径是 `context/codex/codex-rs/otel/src/events/session_telemetry.rs`

2. `RequestDebugContext`
   - 实际结构体名是 `ResponseDebugContext`
   - 见 `context/codex/codex-rs/response-debug-context/src/lib.rs:11-17`

3. `SessionTelemetryMetadata` 的引用总体成立
   - 但建议引用真实文件位置：`.../otel/src/events/session_telemetry.rs:77-91`

### 4.1.4 对后续演进的判断

这份文稿**可以支撑后续演进**，尤其能支撑：

- scenario-based validation
- storage evidence collection
- failure replay

它最需要补的不是方向，而是把：

> “什么是 durable evidence，什么只是 live stream”

说得更清楚。

### 4.1.5 本文稿 verdict

**结论：可保留为后续 action-plan 输入，但建议先修 durable/live 分层与少量引用漂移。**

---

## 4.2 `docs/design/session-do-runtime-by-opus.md`

### 4.2.1 做得对的地方

这份文稿抓住了几个非常关键的点：

1. **Session DO 是会话 actor 宿主**
   - 这和 `README.md:17-20, 129-131, 200-203` 一致。

2. **明确把 WebSocket + hooks + llm + tools + workspace 放在一个 actor 内装配**
   - 这是对的；否则这些边界只会继续漂浮。

3. **把 DO alarm / checkpoint / restore 当成一等能力**
   - 这和 nano-agent 的 durable session 目标一致。

### 4.2.2 主要 blocker

#### Blocker A：Session/Core phase 边界回退

见本报告 §3.1。

这件事如果不改，后续很容易再把 `session.stream.event / ack / heartbeat` 的 phase legality 拉回 Core。

#### Blocker B：turn ingress contract 缺失

见本报告 §3.2。

没有“正常用户 turn 输入”的协议入口，Session DO 的主循环就还是半空的。

### 4.2.3 中等级问题

#### 问题 A：kernel 被写得过于像“一个大函数调用”

文稿在解耦段写：

> `kernel.runTurn(messages, tools, hooks)`  
> Session DO 只调它拿结果

见 `session-do-runtime-by-opus.md:167-169`。

这和现在已经冻结出来的 runtime kernel 方向并不一致。

`docs/design/agent-runtime-kernel-by-GPT.md` 已经把内核定义为：

- `SessionState / TurnState`
- `StepScheduler`
- `InterruptController`
- `RuntimeEventEmitter`
- typed delegates

见 `docs/design/agent-runtime-kernel-by-GPT.md:50-54, 112-119, 158-173`。

也就是说，kernel 不该只是“runTurn 一次性黑盒”，而应是：

> 一个可中断、可观察、可 checkpoint、可 delegate 的 step-driven core

如果 Session DO 文稿继续把 kernel 写成单函数调用，后面会有两个问题：

1. 它会弱化 single-active-turn / pending approvals / interrupt model
2. 它会让 hooks / llm / capability 更像 Session DO 自己在 orchestrate，而不是 kernel 在 orchestrate

**建议：**

- 把 `kernel.runTurn(messages, tools, hooks)` 改写成 “Session DO 驱动 Kernel step loop，并向其注入 delegates”

#### 问题 B：没有显式写出 `single active turn`

README 的主动 trade-off 已经写得很清楚：

- 早期核心是 **单 agent、单线程**（`README.md:31, 171-173`）

而 runtime kernel 设计进一步把它冻结为：

- **single active turn**

见 `docs/design/agent-runtime-kernel-by-GPT.md:33-34, 144-150`。

但 Session DO 文稿没有把这条作为显式 runtime invariant 写出来。

这会让后续实现者产生误解：

- 是不是一个 session 可以重入多个 turn？
- attach/resume / tool progress / cancel 会不会导致 turn overlap？

**建议：**

- 在 Session DO 文稿里单独增加：
  - `At most one active turn per session DO`

#### 问题 C：checkpoint 触发点写得过窄

文稿现在主要写的是：

- `webSocketClose -> checkpoint`
- `resume -> restore`

见 `session-do-runtime-by-opus.md:236-237, 414-418`。

这不完全错，但对 durable actor 来说太窄了。

因为 hot state 的关键变化并不只发生在 close：

- turn 结束
- compact 完成
- tool inflight 状态改变
- session end

这些都可能是更自然的 checkpoint boundary。

所以这里建议从：

> “checkpoint 发生在 close”

改成：

> “close 只是 checkpoint 触发点之一；具体 checkpoint seam 由 runtime kernel + workspace snapshot seam 共同定义”

#### 问题 D：`直接照搬` Claude Code compact 阈值公式不够克制

文稿在 `8.4` 里写：

> **直接照搬** compact 状态机 + 阈值公式

见 `session-do-runtime-by-opus.md:347-349`。

这里我不建议这么写。

因为 Claude Code 的 `effectiveContextWindow - 13000` 是建立在它自己的：

- provider behavior
- transcript shape
- compact strategy
- prompt cache 行为

之上的（`context/claude-code/services/compact/autoCompact.ts:28-49, 62-90`）。

nano-agent 现在还没完成：

- session-do-runtime
- workspace/context runtime
- llm-wrapper action-plan 实装

所以这里最多能说 **“借鉴 circuit breaker 和阈值建模方式”**，不宜写成“直接照搬”。

### 4.2.4 小问题 / 引用漂移

1. `codex-rs/thread-store/src/types.ts`
   - 实际文件是 `context/codex/codex-rs/thread-store/src/types.rs`

2. “一条 WebSocket = 一个 session = 一个 DO”（`32-34`）
   - 更准确的说法应是：
     - **一个 session = 一个 DO**
     - **v1 默认单活跃 socket attachment**

### 4.2.5 对后续演进的判断

这份文稿**非常接近能支撑后续实现**，但还差两件决定性事情：

1. 不要重新把 Session/WebSocket phase legality 托回 Core
2. 把 turn ingress contract 明确下来

如果这两件不修，action-plan 会一开始就建立在含糊入口和错误 phase 心智上。

### 4.2.6 本文稿 verdict

**结论：方向正确，但当前不建议直接进入 action-plan；先修两个 blocker，再进入执行规划。**

---

## 4.3 `docs/design/storage-topology-by-opus.md`

### 4.3.1 做得对的地方

这份文稿有两个正确方向：

1. **它知道 storage topology 讨论的是 storage semantics，不是 DDL**
   - 这是对的。

2. **它坚持 DO/KV/R2 三层语义**
   - 这和 README 技术栈整体方向一致（`README.md:77-85`）。

### 4.3.2 主要问题

#### 问题 A：把“最后设计、证据反推”写对了，但正文还是提前拍了很多板

见本报告 §3.3。

当前最明显的过早冻结点就是：

- workspace small file placement（`251-252`）
- 1MB threshold（`251-252, 331`）
- checkpoint 直接 inline `workspace_files`（`278`）

这些都比当前 evidence 更靠前。

#### 问题 B：把 workspace runtime 的语义提前收窄成“DO inline + R2 fallback”

README 和前一轮 workspace 设计真正强调的是：

- virtual FS
- mount-based workspace
- artifact-first large object path

见：

- `README.md:43-44, 80-86, 204-208`
- `docs/design/workspace-context-artifacts-by-GPT.md:33-37, 51-57, 152-163`

而 storage 文稿现在写法更像：

> 先决定小文件住 DO，大文件住 R2，workspace 自然就成立。

这会反过来把 workspace runtime 变成 storage topology 的子集，而不是让 storage topology 去承接 workspace runtime 的语义。

**建议：**

- 把 workspace placement 写成：
  - `workspace namespace is mount-based`
  - `specific hot/cold materialization strategy remains evidence-driven`

### 4.3.3 中等级问题

#### 问题 A：README 被误引成“包含 D1”

文稿写：

> 可用的存储层（来自 README §3）：
> DO storage / KV / R2 / D1

见 `storage-topology-by-opus.md:31-35`。

但当前 README 的技术栈表实际写的是：

- Durable Object storage / KV / R2

见 `README.md:77-85`。

也就是说：

- **D1 可以作为未来可能层**
- 但它不是 README 已承诺的当前栈

这类误引本身不致命，但它会改变读者对项目当前承诺面的理解。

#### 问题 B：tenant namespace 规则与 feature flag key 写法自相矛盾

文稿前面说：

> 所有 R2/KV key 必须以 `tenants/{team_uuid}/` 开头

见 `storage-topology-by-opus.md:36`。

但后面又写：

- `FEATURE_FLAGS: "_platform/config/feature_flags"`（`309`）
- 表格里也写 `_platform/config/feature_flags`（`261`）

这不是不能成立，而是**必须显式声明 `_platform/` 是 platform-global exception**。

否则这份文稿内部自己就不一致。

#### 问题 C：Checkpoint 格式写得太像最终结构

`SessionCheckpoint`（`267-285`）现在包含：

- `messages: CanonicalMessage[]`
- `workspace_files: Record<string, string>`
- `workspace_refs: NacpRef[]`
- `audit_buffer: string[]`

这比“候选字段集”走得更快。

尤其在：

- runtime kernel action-plan 还没出
- workspace runtime 还没进 action-plan
- observability 还没拿到真实 placement evidence

的阶段，这种格式不该看起来像已经冻结。

### 4.3.4 小问题 / 引用漂移

1. `codex-rs/thread-store/src/types.ts`
   - 实际是 `types.rs`

2. 部分 placement 论证引用是合理的，但应增加一句：
   - “这是候选分层，不是最终基线”

### 4.3.5 对后续演进的判断

这份文稿**能支撑后续演进，但前提是从“定案表”降成“候选表”**。

如果不降温，后面会出现两个问题：

1. session-do-runtime / workspace runtime 会被 storage 表倒逼实现
2. eval-observability 失去“反推 topology”的意义

### 4.3.6 本文稿 verdict

**结论：可以作为 storage semantics 的讨论底稿，但当前不宜视为冻结版本；建议先改成 provisional topology。**

---

## 5. 总结性陈述

如果要一句话概括这三份文稿：

> **Opus 已经把 post-NACP 的后三块骨架大体搭对了，但还没有完全收紧“谁定义什么边界、什么现在能定、什么必须等证据”的纪律。**

更具体地说：

1. **`eval-observability-by-opus.md`**
   - 是这轮最强的一份；
   - 它已经具备进入 action-plan 的条件，只需要补清 durable/live 分层。

2. **`session-do-runtime-by-opus.md`**
   - 是最接近 implementation blueprint 的一份；
   - 但它当前还缺一个真正关键的东西：**用户 turn 输入合同**；
   - 同时必须避免把 Session/WebSocket legality 又拖回 Core phase table。

3. **`storage-topology-by-opus.md`**
   - 最有价值的部分是“它坚持 semantics-first”；
   - 最大的问题是“它写着 semantics-first，却已经开始像 final placement table 了”。

最终 verdict：

| 文档 | 最终 verdict |
|------|--------------|
| `eval-observability-by-opus.md` | **通过，带修订** |
| `session-do-runtime-by-opus.md` | **暂缓，通过前需修 blocker** |
| `storage-topology-by-opus.md` | **暂缓，需降级为 provisional 版本** |

我的总建议是：

1. **先修 `session-do-runtime` 的两个 blocker**
2. **同时把 `storage-topology` 从“定案”改成“候选 + 待证据校准”**
3. **然后再让这三份文稿一起进入下一轮 cross-doc go-through**

这样才符合 `README` 的精神，也符合 `plan-after-nacp.md` 规定的推进纪律。
