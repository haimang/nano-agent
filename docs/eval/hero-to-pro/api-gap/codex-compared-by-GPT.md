# nano-agent API Gap 调查报告（对照 Codex）

> 作者：GPT  
> 时间：2026-05-02  
> 结论来源限制：**仅使用以下三类上下文**
>
> 1. `clients/api-docs/*.md`
> 2. `context/codex/**`
> 3. 根目录 `README.md`

---

## 1. 调查目标

本次调查不验证实现代码，不回看 worker / packages / docs 其他内容，只回答一个问题：

> **如果要仅依赖当前对外 API，为 nano-agent 做一个可用的前端 client，乃至一个完整的 agent loop workbench，这些接口是否已经足够？还缺什么？哪里存在盲点、断点或文档层面的阻塞？**

本报告中的“完整 agent loop”并不只指：

- 能登录
- 能建 session
- 能发消息
- 能收到流式回复

而是指更接近 `context/codex` 所体现的完整交互心智：

- 有连续 thread / turn
- 有 item 级流式更新
- 有工具调用可视化
- 有文件变更可视化
- 有 todo / plan 更新
- 有 approval / elicitation / interruption
- 有恢复、重连、回放
- 有 runtime 配置面
- 有 workspace / artifact / context / model 等辅助控制面

---

## 2. 参考系：从 README 与 Codex 提取的目标心智

### 2.1 README 给出的 nano-agent 方向

根目录 `README.md` 给出的愿景非常明确：

- nano-agent 是 **Cloudflare-native 的持久化 agent runtime**
- 以 **WebSocket-first** 为主要交互协议
- 用 **Durable Object** 承载 session actor
- 对模型保留 bash / 文件 / 搜索 / git 风格的熟悉外形
- 但内部仍然坚持 typed capability runtime，而不是本地 CLI 的直接云搬运

这意味着，对外 API 至少应满足两层要求：

1. **聊天主线可用**：建会话、输入、流式输出、状态、历史、恢复。
2. **agent loop 可治理**：工具、确认、todo、workspace、context、usage、重连、回放、文件与状态副产物都能被前端消费。

### 2.2 `context/codex` 给出的对照基线

从 `context/codex/sdk/typescript` 与 sample 可以抽出一个很清晰的交互基线：

#### 事件层

Codex 的 thread streaming 直接暴露：

- `thread.started`
- `turn.started`
- `turn.completed`
- `turn.failed`
- `item.started`
- `item.updated`
- `item.completed`

#### item 层

Codex 的 `ThreadItem` 已经把 agent loop 中的核心对象显式化：

- `agent_message`
- `reasoning`
- `command_execution`
- `file_change`
- `mcp_tool_call`
- `web_search`
- `todo_list`
- `error`

#### 运行时配置层

Codex thread options 允许前端或调用方显式设置：

- `approvalPolicy`
- `sandboxMode`
- `workingDirectory`
- `networkAccessEnabled`
- `webSearchMode`
- `additionalDirectories`
- `model`
- `modelReasoningEffort`

**因此，Codex 对比基线不是“一个聊天 API”**，而是：

> 一个让前端能够理解 agent 正在做什么、还能控制 agent 如何做的完整交互模型。

---

## 3. nano-agent 当前 API 能覆盖到什么程度

基于 `clients/api-docs`，我认为当前 nano-agent 的对外 API 可以分成三层成熟度。

### 3.1 第一层：主线已经够用

这一层已经足够支撑一个 **first-wave chat client**。

#### 已具备的能力

1. **鉴权主线**
   - `auth.md`
   - register / login / refresh / verify / me / reset password / wechat login / revoke api key

2. **会话与列表主线**
   - `me-sessions.md`
   - `POST /me/sessions`
   - `GET /me/sessions`
   - `GET /me/conversations`
   - `GET /conversations/{conversation_uuid}`

3. **session lifecycle 主线**
   - `session.md`
   - `start / input / messages / cancel / close / delete / title / status / timeline / history / resume / usage`

4. **WS 流式主线**
   - `session-ws-v1.md`
   - `GET /sessions/{id}/ws`
   - `last_seen_seq` reconnect
   - heartbeat / end / usage.update / stream event

5. **基础控制面**
   - `models.md`
   - `context.md`
   - `workspace.md`
   - `checkpoints.md`
   - `todos.md`
   - `confirmations.md`
   - `permissions.md`
   - `usage.md`

#### 这意味着什么

如果目标是：

- Web chat 界面
- Session 列表
- Conversation 列表
- 文本 + 多段 message 输入
- artifact 上传
- 实时流式输出
- reconnect / replay
- usage 展示
- model 选择
- context probe / compact UI

那么 **现有 API 已经足够做出一个可工作的前端**。

### 3.2 第二层：控制面已存在，但很多还是 first-wave / partial

这一层“有接口”，但前端不能把它们当作 **完整闭环能力**。

#### 典型例子

1. **workspace**
   - `workspace.md` 明确写了：
     - workspace public CRUD 已接通
     - 但仍是 **metadata-first first wave**
     - temp file bytes / 完整 delivery / tool ledger 还不完整

2. **checkpoints / restore**
   - `checkpoints.md` 明确写了：
     - `restore` 现在只是 **open pending job**
     - restore executor 未 live

3. **fork**
   - `session.md` 写 `POST /sessions/{id}/fork` 已存在
   - 但仍然只是 **pending-executor first wave**
   - 不是“fork 已完成”

4. **retry**
   - `session.md` 写得很清楚：
     - 现在只是 request-acknowledged
     - 真正 replay 仍需 client 按 hint 再发一次 message

5. **auto-compact**
   - `context.md` 明确写：
     - `compact_required` 可读
     - 但 runtime **不会自动触发 compact**

### 3.3 第三层：对完整 agent loop 来说仍然缺失

这一层不是“体验还可以优化”，而是会直接阻止你做出真正完整的 agent workbench。

---

## 4. 关键结论：首版前端够用，但完整 agent loop 还不够

### 4.1 对“首版前端 client”的判断

我认为答案是：

> **够用。**

可以做出的前端包括：

1. 登录与 token 生命周期
2. 新建 session / 列会话 / 列 conversation
3. 进入单 session 聊天页
4. 建立 WebSocket，消费 LLM 流式输出
5. 发 text input / multipart messages
6. 看 history / timeline / status / usage
7. 做模型切换
8. 做 context probe / compact
9. 上传 artifact
10. 看 confirmation / todo / checkpoint / workspace metadata 面板

### 4.2 对“完整 agent loop workbench”的判断

我认为答案是：

> **不够。**

不是完全不能做，而是会被迫退化成：

- 一个“能聊天的 agent UI”
- 而不是一个“能完整操控 agent 工作流的工作台”

---

## 5. 真正的盲点与断点

下面这些，是我认为最关键、最真实的 gap。

### 5.1 Gap A：confirmation 虽有统一 HTTP plane，但实时 loop 没闭环

#### 现状

`confirmations.md` 表示 unified confirmation control plane 已 live。  
但 `session-ws-v1.md` 同时明确：

- `session.confirmation.request`
- `session.confirmation.update`

目前只是 **schema registered / emitter pending**。

并且 client → server confirmation reply **不支持 WS**，只能走 HTTP `POST /confirmations/{uuid}/decision`。

#### 影响

这会导致：

1. 前端不能像 Codex 一样在流中**被动实时接收到 approval request**
2. 若不轮询 `/confirmations`，就无法及时感知需要用户决策
3. HITL 体验会从“实时 loop”退化成“旁路查询 + HTTP 提交”

#### 结论

**这是完整 agent loop 的第一大断点。**

---

### 5.2 Gap B：todo plane 已有，但 agent-side write 与 WS live 都未闭环

#### 现状

`todos.md` 明确写了：

- HTTP todo control plane 已 live
- 但 WS：
  - `session.todos.write`
  - `session.todos.update`
 仍是 **schema registered / emitter pending**
- 同时 agent-core 还没有 `WriteTodos` capability

#### 对照 Codex

Codex 的 sample 与 item type 里，`todo_list` 是一等流式 item，可以：

- started
- updated
- completed

前端能自然渲染 plan / subtask 演进。

#### 影响

当前 nano-agent 前端即使有 todos 面板，也只能：

- 由用户显式创建
- 手动刷新/轮询

而不能把它当成 agent loop 的内生部分。

#### 结论

**这不是“锦上添花能力”，而是完整 workbench 的核心缺口。**

---

### 5.3 Gap C：workspace 仍然偏 metadata plane，不是完整文件工作台

#### 现状

`workspace.md` 已非常诚实地写出了当前事实：

- artifact CRUD live
- workspace temp file truth live
- filesystem-core temp-file RPC live
- 但 public workspace CRUD 仍是 **metadata-first first wave**
- `GET /workspace/files/{*path}` 当前读的是 metadata + canonical `r2_key`
- 不应假设完整 bytes delivery / tool execution ledger / promotion cleanup 已闭环

#### 对照 Codex

Codex 前端样例与 item 类型里已经有：

- `command_execution`
- `file_change`

也就是说，它的前端可以天然把“agent 做了什么文件修改”表达成可消费对象。

#### nano-agent 当前问题

当前 API 里虽然有：

- artifact 上传
- workspace metadata
- tool-calls list/cancel

但缺：

1. **稳定的 file change event**
2. **稳定的 workspace file bytes read/write surface**
3. **可直接驱动前端 diff / patch viewer 的变更对象**

#### 结论

**这会直接限制 IDE/workbench 类前端。**

---

### 5.4 Gap D：retry / fork / restore 仍是“受理了”，不是“完成了”

#### 现状

从 `session.md` 与 `checkpoints.md` 可得出：

- `retry`：只是 acknowledged，客户端还要自己重发 prompt
- `fork`：只是 `pending-executor`
- `restore`：只是创建 `pending` restore job

#### 影响

这意味着前端无法把这些能力视为可靠的产品按钮：

- 点 retry，不代表真正有重试链
- 点 fork，不代表真正 fork 完成
- 点 restore，不代表当前 state 已恢复

前端只能把它们包装成：

- “提交请求成功”
- “等待后续能力完成”

这与完整 agent loop 所要求的：

- branch
- replay
- rollback
- recovery

还差了一大段。

#### 结论

**这一类接口更像 substrate 已铺好，而不是产品面已闭环。**

---

### 5.5 Gap E：公开 runtime 配置面过薄

#### 对照 Codex

Codex `ThreadOptions` 暴露了很多运行时开关：

- `approvalPolicy`
- `sandboxMode`
- `workingDirectory`
- `networkAccessEnabled`
- `webSearchMode`
- `additionalDirectories`

#### nano-agent 当前公开面

从 `clients/api-docs` 看，真正暴露给 client 的 runtime 选择只有：

- model / reasoning
- permission mode
- message content
- context-related operations

但没有一个系统化的 session / turn runtime options 面：

- 没有统一的 run config object
- 没有 sandbox / network / search policy 切换
- 没有 workspace root / mount / directory scope 的公开设置

#### 影响

即使前端能聊天，也很难变成一个真正的“agent workbench”，因为：

- 用户无法清楚控制 agent 是如何运行的
- 前端也无法把这些 runtime 选择做成显式 UI

#### 结论

**这不是 bug，但它限制了产品上限。**

---

## 6. 文档自身存在的阻塞与不一致

除了 API 本身的缺口，我认为当前 `clients/api-docs` 还存在几处**会直接卡住前端实现**的文档不一致。

### 6.1 `/sessions/{id}/context` 的语义不一致

`README.md` 把它写成：

- `GET /sessions/{id}/context` = context probe alias

但 `context.md` 又写成：

- `GET /sessions/{id}/context` = 完整 context snapshot
- `GET /sessions/{id}/context/probe` = budget probe

#### 影响

前端无法确定：

- `/context` 是拿完整 assembled snapshot
- 还是拿 probe summary

这是一个**真实文档断点**。

---

### 6.2 `/start` 对未 mint UUID 的语义不一致

`me-sessions.md` 写：

- `/sessions/{id}/start` 仍接受未 mint 的新 UUID

但 `session.md` 的错误说明又写：

- UUID 未在 `nano_conversation_sessions` 会返回 `404 not-found`

#### 影响

前端无法判断是否必须：

1. 先 `POST /me/sessions`
2. 再 `POST /sessions/{id}/start`

还是可以本地生成 UUID 直接 start。

这会直接影响 session create flow 的实现方式。

---

### 6.3 confirmation kind 命名不一致

`confirmations.md` / `session-ws-v1.md` 中使用的是：

- `tool_permission`

而 `permissions.md` 中多处仍使用：

- `permission`

#### 影响

前端在做 type mapping 时会遇到不确定性：

- 是 `tool_permission`
- 还是 `permission`

这会污染 client-side enum 与 reducer。

---

### 6.4 confirmation 决策 body 示例不一致

`confirmations.md` 的统一写法是：

```json
{
  "status": "modified",
  "decision_payload": { "answer": "pandas" }
}
```

但 `permissions.md` 的迁移路径又写成：

- `{ decision: "allow" }`
- `{ decision: "modified", payload: { answer } }`

#### 影响

这不是简单措辞问题，而是：

- 前端到底该发 `status`
- 还是 `decision`
- `decision_payload`
- 还是 `payload`

这会直接导致请求写错。

---

### 6.5 models 示例里出现未对齐状态值

`models.md` 示例里有：

- `session_status: "running"`

但 `session.md` 生命周期枚举里并没有这个状态；主文档描述的是：

- `pending`
- `starting`
- `active`
- `attached`
- `detached`
- `ended`
- `expired`

#### 影响

前端无法安全建立统一的 session status enum。

---

### 6.6 `history` / `timeline` 的响应 shape 不够完整

`session.md` 说明了存在：

- `GET /sessions/{id}/timeline`
- `GET /sessions/{id}/history`

但没有像其他专题文档一样给出足够完整的返回 schema 示例。

#### 影响

前端如果要做：

- timeline viewer
- replay UI
- history message renderer

仍然需要猜字段结构。

这在“文档已经冻结可供前端实现”的语境下，是不够的。

---

## 7. 从“聊天产品”到“完整 agent workbench”，还缺哪些关键对象

我建议从对象模型角度来理解当前 gap。

### 7.1 当前已经公开得比较好的对象

- `session`
- `conversation`
- `auth view`
- `model catalog`
- `usage snapshot`
- `context probe`
- `artifact`
- `checkpoint`
- `confirmation row`
- `todo row`

### 7.2 当前最缺的对象

这些对象，在 Codex 对照心智里是清晰存在的，但 nano-agent 还没形成稳定 public object：

1. **turn**
   - 有 `turn.begin` / `turn.end` event，但缺一个更完整的 turn object 视图

2. **item**
   - 缺少像 Codex 那样统一的 item 抽象
   - 现在更多是 event fragments，不利于前端 reducer

3. **tool execution**
   - 当前只有 stream event 片段与 first-wave tool-call list/cancel
   - 缺少稳定、可查询、可渲染的 tool execution object

4. **file change**
   - 缺少稳定的 file change object / event

5. **runtime config**
   - 缺少稳定、可查询、可更新的 session runtime options object

6. **restore / fork execution state**
   - 目前只有 accepted / pending job
   - 缺少“执行完成结果对象”

---

## 8. 总体评估

### 8.1 成熟度判断

我会给出下面这个分层判断：

| 能力层 | 结论 |
|---|---|
| 聊天主线 | **ready** |
| 流式主线 | **ready** |
| 列表 / 会话 / usage / model / context side panel | **ready** |
| confirmation / todo / workspace / checkpoint 控制面 | **partially ready** |
| 完整 agent loop / IDE-style workbench | **not ready** |

### 8.2 一句话结论

> **当前 API 已经足够做一个 first-wave 前端 client，但还不足以支撑一个完整的、Codex 风格的 agent loop 工作台。**

---

## 9. 建议：应该怎样补齐

下面按优先级给建议。

### 9.1 P0：先修文档断点，再谈前端落地

如果 API 文档要成为前端实现依据，我建议先修这几类不一致：

1. 统一 `/sessions/{id}/context` 的语义
2. 统一 `/start` 是否要求 pre-mint session
3. 统一 confirmation kind 命名（`tool_permission` vs `permission`）
4. 统一 confirmation decision request shape（`status/decision_payload` vs `decision/payload`）
5. 统一 `session_status` 枚举
6. 给 `timeline` / `history` 补完整 schema 示例

**原因**：这些问题不是长期规划，而是会立刻阻断前端开发。

---

### 9.2 P1：把 confirmation WS emitter 接通

最优先建议是：

1. 真正 emit：
   - `session.confirmation.request`
   - `session.confirmation.update`
2. 明确 frame payload 的 authoritative schema
3. 明确与 legacy permission / elicitation 的迁移映射

**原因**：  
没有这个，HITL 只能靠 HTTP 轮询，完整 agent loop 的实时性就断了。

---

### 9.3 P1：把 todo 从“控制面”升级为“loop 对象”

建议补齐：

1. agent-side `WriteTodos` capability
2. WS emitter：
   - `session.todos.write`
   - `session.todos.update`
3. 明确 todo 与 turn / tool / confirmation 的关系

**原因**：  
Codex 对照下，todo 不只是一个 CRUD 列表，而是用户理解“agent 正在做什么”的核心结构。

---

### 9.4 P1：补齐 workspace/file-change 的真实产品面

建议目标不是只补 API，而是补“前端可消费对象”：

1. 稳定的 workspace file read/write bytes surface
2. 稳定的 file change event / object
3. 明确 artifact 与 workspace temp file 的前端区分
4. 若有 patch / diff，给出稳定输出模型

**原因**：  
没有这个，前端很难做出 IDE/workbench 感，而只能停留在聊天 UI。

---

### 9.5 P2：把 retry / fork / restore 从 first-wave ack 推到 completed surface

建议：

1. retry 提供真实 attempt chain
2. fork 提供真正完成的 child session lineage
3. restore 提供 executor 完成态与可追踪 job lifecycle

**原因**：  
这三条能力是“高级工作流”的关键，如果长期只停留在 accepted/pending，会误导前端与产品设计。

---

### 9.6 P2：抽象一个更接近 Codex 的公开 event/item 模型

我不建议机械复制 Codex，但建议吸收它最成功的一点：

> **前端需要消费“对象级演进”，而不是只消费零散 stream 事件。**

可以考虑在现有 `session-ws-v1` 之上形成更清晰的一层：

- turn object
- item object
- tool execution object
- file change object
- confirmation object
- todo object

即使 wire format 不完全照搬 Codex，也应让前端 reducer 能建立稳定对象图。

---

### 9.7 P3：补一个统一 runtime config surface

建议长期补一个显式的 session runtime config 面，至少覆盖：

- approval / permission 模式
- model / reasoning
- network policy
- workspace scope
- search mode
- 其他 agent behavior knobs

这不一定要与 Codex 的 `ThreadOptions` 完全一致，但现在的公开面确实偏薄。

---

## 10. 最终结论

### 10.1 我对“是否够做前端 client”的判断

**是，已经够做。**

但这个“前端 client”更接近：

- chat-first
- session-first
- stream-first
- side-panel assisted

而不是完整的 agent IDE / workbench。

### 10.2 我对“是否够支撑完整 agent loop”的判断

**还不够。**

核心原因不是主线消息能力不够，而是以下闭环还没真正接通：

1. confirmation 实时 WS 闭环
2. todo live loop
3. workspace / file-change 对象化
4. retry / fork / restore executor completion
5. 更完整的 runtime config

### 10.3 最简总结

> **当前 nano-agent API 已能支撑一个首版生产可用的 chat client。**  
> **但若目标是完整的、Codex 风格的 agent loop workbench，当前 public surface 仍存在明确盲点与断点，尤其集中在实时确认、todo、workspace/file-change、恢复分叉，以及运行时配置层。**

