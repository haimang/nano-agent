# nano-agent API Gap Analysis — Gemini-CLI Agent Loop 对照

> 文档来源约束: 本次分析**仅**基于以下 3 类上下文，不深入阅读任何超出范围的代码或文档:
>
> | # | 来源 | 范围 |
> |---|------|------|
> | A1 | `clients/api-docs/*.md` | 全部 18 份 HP9 frozen authoritative docs |
> | A2 | `context/gemini-cli/` | gemini-cli 的 core agent loop、scheduler、turn、chat、compression、confirmation 实现 |
> | A3 | `README.md` | nano-agent 的产品愿景、技术栈选择、trade-off 声明 |
>
> 评估方法: 以 gemini-cli 的完整 agent loop 作为参照系，逐层对照 nano-agent 的 public API surface，识别**形状正确性** (shape correctness) 和**时序完整性** (temporal completeness) 的缺口。

---

## 1. 评估框架: Agent Loop 需要什么

从一个前端 client 的视角，实现完整 agent loop 需要以下 **12 类能力**:

| # | 能力 | 说明 |
|---|------|------|
| 1 | Session 生命周期 | 创建、启动、输入、结束、状态查询 |
| 2 | LLM 流式输出 | 文本增量渲染、思考过程、turn 边界 |
| 3 | 工具调用执行 | 工具进度、结果、错误 |
| 4 | 用户确认/权限 | 实时弹出确认弹窗、接收用户决策 |
| 5 | Tool 中途取消 | 用户取消正在执行的长命令 |
| 6 | 上下文管理 | 自动/手动压缩、token 探针 |
| 7 | 模型选择/切换 | 模型列表、session/turn 级别切换、fallback 通知 |
| 8 | 对话历史 | 历史消息拉取、时间线回放 |
| 9 | 重连与事件回放 | WS 断线重连、遗漏帧回放、deconfliction |
| 10 | 文件/Workspace | 上传 artifact、读取 agent 生成的文件 |
| 11 | 错误处理 | 结构化错误码、分类、retry 策略 |
| 12 | 用户中途干预 | turn 内注入新指令、中断重定向 |

---

## 2. 逐类对照矩阵

### 2.1 Session 生命周期

| 步骤 | Gemini-CLI 实现 | Nano-Agent API | 状态 |
|------|---------------|----------------|------|
| 创建 session | 隐式 (首次 chat 自动创建) | `POST /me/sessions` (server-mint UUID) | ✅ |
| 启动 session | `startChat()` | `POST /sessions/{id}/start` | ✅ |
| 发送文本 | `sendMessageStream(parts)` | `POST /sessions/{id}/input {text}` | ✅ |
| 发送多模态 | 同上 (parts 含 inlineData) | `POST /sessions/{id}/messages {parts: [text, image, artifact_ref]}` | ✅ |
| 查询状态 | (无显式路由) | `GET /sessions/{id}/status` | ✅ |
| 结束 session | (无显式 close) | `POST /sessions/{id}/close` → `ended_reason=closed_by_user` | ✅ |
| 删除 conversation | (无) | `DELETE /sessions/{id}` → tombstone | ✅ |
| 重命名 | (无) | `PATCH /sessions/{id}/title` | ✅ |

**结论**: ✅ 完整。Session 生命周期的 HTTP action 路由覆盖了创建到结束的全链路。

---

### 2.2 LLM 流式输出

| 事件类型 | Gemini-CLI | Nano-Agent WS 帧 | 状态 |
|---------|-----------|------------------|------|
| 文本增量 | `Content` event (string) | `llm.delta {content_type, content, is_final}` | ✅ |
| 思考过程 | `Thought` event | (暂无独立 thought 帧) | 🟢 低优先级 |
| Turn 开始 | `(turnCount)` 变量追踪 | `turn.begin {turn_uuid}` | ✅ |
| Turn 结束 | `Finished` event | `turn.end {turn_uuid, usage?}` | ✅ |
| Session 状态变化 | (无) | `session.update {phase, partial_output?}` | ✅ |
| Session 结束 | (无) | `session.end {reason, last_phase}` | ✅ |
| 引用 | `Citation` event | (暂无) | 🟢 低优先级 |
| 模型信息 | `ModelInfo` event | (见 §2.7) | ⚠️ |

**结论**: ✅ 基本完整。LLM 输出的核心流 (delta + turn 边界) 已覆盖。Thought 事件不属于 hero-to-pro 范围 (README 明确不追求 TUI 体验)。

---

### 2.3 工具调用执行

| 阶段 | Gemini-CLI | Nano-Agent API | 状态 |
|------|-----------|----------------|------|
| LLM 请求工具 | `ToolCallRequest` event | 包含在 LLM 流中 (服务端解析) | ✅ |
| 工具进度 | (stdout streaming) | `tool.call.progress {tool_name, chunk, is_final}` | ✅ |
| 工具完成 | `SuccessfulToolCall / ErroredToolCall` | `tool.call.result {tool_name, status, output, error_message?}` | ✅ |
| 工具取消 | `CancelledToolCall` | `tool.call.cancelled {tool_name, request_uuid, cancel_initiator}` | ✅ (HP6 live) |

**结论**: ✅ 完整。工具调用的观察面完全覆盖，HP6 补齐了 `tool.call.cancelled`。

---

### 2.4 用户确认/权限 — 🔴 盲点

**Gemini-CLI 流程**:

```
LLM 请求工具  →  Scheduler 发 TOOL_CONFIRMATION_REQUEST (MessageBus)
              →  UI 弹出确认弹窗 (同步阻塞)
              →  用户决策 → TOOL_CONFIRMATION_RESPONSE
              →  Scheduler 继续执行/拒绝
```

**Nano-Agent 现状**:

| 层次 | 状态 |
|------|------|
| HTTP confirmation CRUD | ✅ **live** — `GET /confirmations`, `GET /confirmations/{uuid}`, `POST /confirmations/{uuid}/decision` |
| WS 通知帧 `session.confirmation.request` | 🔴 **emitter pending** — schema frozen, 未 emit |
| WS 通知帧 `session.confirmation.update` | 🔴 **emitter pending** — schema frozen, 未 emit |
| Legacy compat (`/permission/decision`, `/elicitation/answer`) | ✅ **live** — dual-write 到 confirmations |

**问题**: 在 agent loop 中，confirmation 是一个**同步阻塞点**。Gemini-CLI 中 Scheduler 发出 `TOOL_CONFIRMATION_REQUEST` 后**阻塞等待**用户回复。Nano-agent 的后端行为 (agent-core kernel) 同样是阻塞等待 confirmation。但前端 client **无法通过 WS 实时获知** "agent 正在等我确认"。

引用 [`session-ws-v1.md:100`](../../../clients/api-docs/session-ws-v1.md):

> "confirmation 统一 HTTP plane 已 live，但这两个 WS frame 还没有在 orchestrator runtime 真实 emit"

**模拟后果**:

1. Agent 请求执行 `bash: rm -rf /important`，kernel 进入 `confirmation_pending`
2. 前端只能通过**轮询** `GET /sessions/{id}/confirmations?status=pending` 发现这个确认请求
3. 轮询间隔 2-5 秒 → agent 被阻塞 2-5 秒才弹出确认弹窗
4. 用户做出决策 → agent 继续执行

**严重程度**: 🔴 **高**。对于一个 WebSocket-first 的 agent runtime，confirmation 这种同步阻塞点的实时通知缺失会**显著降低交互体验**。

**缓解方案**: 前端可以实现短间隔轮询 (如 1s) `GET /confirmations?status=pending` 作为 temporary workaround，但这不是长期方案。

---

### 2.5 Tool 中途取消 — 🟡 部分完整

| 操作 | Gemini-CLI | Nano-Agent | 状态 |
|------|-----------|-----------|------|
| 发起取消 | `Scheduler.cancelAll()` / abort signal | `POST /sessions/{id}/tool-calls/{request_uuid}/cancel` → `202` | ⚠️ first-wave |
| 取消确认 | `CancelledToolCall` status change | WS `tool.call.cancelled` 帧 (HP6 live) | ✅ |
| 工具调用列表 | `SchedulerStateManager.activeCalls` | `GET /sessions/{id}/tool-calls` → `source: "ws-stream-only-first-wave"` | ⚠️ first-wave |

**问题**: `POST cancel` 返回 `202 (Accepted)`，但标注为 "first-wave cancel ack"。引用 [`workspace.md:145`](../../../clients/api-docs/workspace.md):

> "GET /sessions/{id}/tool-calls — first-wave list；当前只给空数组/来源标记"

前端发起取消后，需要等待 WS `tool.call.cancelled` 帧确认取消已真正生效。这个确认路径是完整的 (HP6 已 live)，所以**功能上是闭环的**，只是没有 "cancel result API" 供 HTTP-only 场景使用。

**严重程度**: 🟡 **中**。WS 路径已覆盖，HTTP-only 场景有缺口。

---

### 2.6 上下文管理 — 🟡 自动压缩未接线

| 操作 | Gemini-CLI | Nano-Agent | 状态 |
|------|-----------|-----------|------|
| Token 探针 | `countTokens()` + `lastPromptTokenCount` | `GET /sessions/{id}/context/probe` | ✅ |
| Context 层级预览 | (无显式 API) | `GET /sessions/{id}/context/layers` | ✅ |
| 自动压缩 | `ChatCompressionService.compress()` 阈值触发 | 🔴 **not-wired** (`compactRequired: false` hardcoded) | 🔴 |
| 手动压缩预览 | (无) | `POST /sessions/{id}/context/compact/preview` | ✅ |
| 手动压缩 | (通过 prompt 触发) | `POST /sessions/{id}/context/compact` | ✅ |
| 压缩通知 | `ChatCompressed` event | WS `compact.notify {status, tokens_before?, tokens_after?}` | ✅ |

**问题**: 引用 [`context.md:55`](../../../clients/api-docs/context.md):

> "agent-core runtime 当前不会自动触发 compact — workers/agent-core/src/host/orchestration.ts 仍硬编码 compactRequired: false"

`compact_required` 在 probe 中已被正确计算，但 runtime 不会自动执行压缩。这意味着:

1. 前端必须主动轮询 `GET /context/probe` 监控 `compact_required`
2. 当 `compact_required = true` 时，前端必须主动调用 `POST /context/compact` 触发压缩
3. 如果前端忘记轮询，agent 可能在 context window overflow 时直接报错

**模拟场景**: 对话持续 50 轮后，`context_window: 131072`，`estimated_used_tokens: 120000`，`compact_required: true`。但 agent 不自动压缩 → 下一轮 LLM 调用可能因 context window overflow 被拒绝。

**缓解方案**: 前端实现 probe 轮询 + 自动触发 compact 的守护逻辑。但这也意味着前端承担了本应由 runtime 承担的 context management 职责。

**严重程度**: 🟡 **中**。有 HTTP 路由可以手动修复，但要求前端 client 承担更多复杂度。

---

### 2.7 模型选择/切换 — 🟡 通知帧未 emit

| 操作 | Gemini-CLI | Nano-Agent | 状态 |
|------|-----------|-----------|------|
| 模型列表 | (built-in defaults) | `GET /models` (D1 catalog + team policy filter + ETag) | ✅ |
| 模型详情 | (无) | `GET /models/{idOrAlias}` | ✅ |
| Session 当前模型 | `currentSequenceModel` | `GET /sessions/{id}/model` | ✅ |
| 设置 session 模型 | `setTools(modelId)` | `PATCH /sessions/{id}/model` | ✅ |
| Per-turn 覆盖 | `modelToUse = router.route()` | `POST /input` body 中的 `model_id` | ✅ |
| Fallback 通知 | `CoreEvent.ModelChanged` | WS `model.fallback` 帧 | 🔴 **schema live, emitter not-live** |

**问题**: 引用 [`session-ws-v1.md:260`](../../../clients/api-docs/session-ws-v1.md):

> "model.fallback stream event — schema live, emitter not-live"

当模型因 quota/availability/error 被 fallback 时，前端无法实时获知。只能通过轮询 `GET /sessions/{id}/model` 发现 `effective_model_id` 变化。

**模拟场景**: 用户选择了 `@alias/reasoning` (上下文消耗大)，但该模型的 quota 已耗尽，backend fallback 到 `granite-4.0-h-micro`。前端仍显示 "使用 reasoning 回答中..." 与实际不符。

**严重程度**: 🟡 **中**。轮询 `GET /model` 可以绕过，但不如 WS 实时通知优雅。

---

### 2.8 对话历史

| 操作 | Gemini-CLI | Nano-Agent | 状态 |
|------|-----------|-----------|------|
| 历史消息 | `GeminiChat.history: Content[]` | `GET /sessions/{id}/history?limit=&cursor=` | ✅ |
| 事件时间线 | (无) | `GET /sessions/{id}/timeline?limit=&cursor=` | ✅ |
| Conversation 详情 | (无) | `GET /conversations/{conversation_uuid}` | ✅ |
| Conversation 列表 | (无) | `GET /me/conversations?limit=&cursor=` | ✅ |
| Usage 快照 | `usageMetadata` in Finished | `GET /sessions/{id}/usage` + WS `session.usage.update` | ✅ |

**结论**: ✅ 完整。对话历史的拉取、分页、cursor 化都已实现。`session.usage.update` WS 帧已在 HP9 live。

---

### 2.9 重连与事件回放

| 步骤 | Gemini-CLI | Nano-Agent | 状态 |
|------|-----------|-----------|------|
| 追 last seq | (无内置机制) | WS 连接参数 `last_seen_seq` | ✅ |
| 事件回放 | (无) | Server best-effort 回放 buffered events | ✅ |
| HTTP replay ack | (无) | `POST /sessions/{id}/resume` | ✅ |
| Reconciliation | (无) | `GET /sessions/{id}/timeline` (replay_lost 为 true 时) | ✅ |
| 旧连接被踢 | (无) | WS `session.attachment.superseded` 帧 + close `4001` | ✅ |
| Heartbeat | (无) | WS `session.heartbeat` (server 每 15s; client touch) | ✅ |

**结论**: ✅ 完整。重连机制是 nano-agent 的一等能力，seq-based replay + HTTP resume + timeline reconciliation 三层防护。

---

### 2.10 文件/Workspace — 🟢 部分完整

| 操作 | Gemini-CLI | Nano-Agent | 状态 |
|------|-----------|-----------|------|
| Artifact 上传 | `inlineData` in parts | `POST /sessions/{id}/files` (multipart, ≤25 MiB) | ✅ |
| Artifact 列表 | (无) | `GET /sessions/{id}/files` | ✅ |
| Artifact 下载 | (无) | `GET /sessions/{id}/files/{uuid}/content` (binary) | ✅ |
| Artifact 引用 | `inlineData` | `POST /messages` 中 `artifact_ref` | ✅ |
| Workspace 文件元数据 | Sandbox FS | `GET/PUT/DELETE /workspace/files/{*path}` | ⚠️ first-wave metadata |
| Workspace 文件 **内容** | Sandbox FS read | 🔴 `content_source: "filesystem-core-leaf-rpc-pending"` | 🔴 |

**问题**: 引用 [`workspace.md:132`](../../../clients/api-docs/workspace.md):

> "GET /sessions/{id}/workspace/files/{*path} — 读单个 metadata row + canonical r2_key。content_source 仍标 filesystem-core-leaf-rpc-pending"

Workspace temp files 的 **元数据** 可通过 HTTP CRUD 访问，但**文件字节内容**无法直接通过 public API 获取。这意味着:

1. Agent 通过 bash 生成了 `output.json` → 前端无法直接读取内容展示给用户
2. 前端只能看到文件名、大小、R2 key，但拿不到实际 bytes

**缓解方案**: Agent 可以把需要用户看到的输出走 artifact 路线 (先 upload 为 artifact，再通过 `artifact_ref` 引用)。但这不是自然的 workflow。

**严重程度**: 🟢 **低**。artifact 路线已完整，workspace bytes 读取是 hero-to-platform 的扩展。

---

### 2.11 错误处理

| 能力 | Gemini-CLI | Nano-Agent | 状态 |
|------|-----------|-----------|------|
| HTTP 结构化错误 | `StructuredError` | `{ok:false, error:{code,status,message,details}, trace_uuid}` | ✅ |
| WS 结构化错误 | (无) | `system.error {error:{code,category,message,detail?,retryable}}` | ✅ |
| 错误码注册表 | (分散在各模块) | [`error-index.md`](../../../clients/api-docs/error-index.md) — 60+ public codes | ✅ |
| 分类器 | (无) | `classifyNanoError()` — auth/forbidden/session-state/retryable/fatal-input | ✅ |
| NACP 内部码 | (无) | 20 NACP 码 + 6 KernelErrorCode + 8 SessionErrorCode + 8 LLMErrorCategory | ✅ |
| Dual-emit 去重 | (无) | `system.error` + `system.notify(severity=error)` ~1s dedup window | ✅ |

**结论**: ✅ 完整。错误处理是 nano-agent 最成熟的 surface 之一。

---

### 2.12 用户中途干预 — 🔴 盲点

**Gemini-CLI 机制**:

```
Ctrl+C → AbortController.abort()
       → 所有层检查 signal.aborted
       → GeminiClient: yield UserCancelled
       → Scheduler: cancelAll()
       → 用户重新输入新指令 → 新 turn
```

或者: 用户在 agent 执行中直接 @ 新指令 → 新的 `sendMessageStream` 调用。

**Nano-Agent 现状**:

| 操作 | API | 状态 |
|------|-----|------|
| Cancel 当前 turn | `POST /sessions/{id}/cancel` | ✅ |
| 注入 follow-up input | 🔴 **无 WS 帧** | 🔴 |

**问题**: 引用 README §6.1:

> "The minimum client-produced session.followup_input family is now part of the nacp-session frozen surface, allowed in attached / turn_running phases"

Protocol 层 (nacp-session) 已经定义了 `followup_input` 的概念，允许在 `attached` / `turn_running` 阶段注入新输入。但这**没有暴露为 public WS client→server 帧**。

引用 [`session-ws-v1.md §4`](../../../clients/api-docs/session-ws-v1.md):

> "public orchestrator-core WS 当前仅把 client frame 当作 activity touch: session.resume / session.heartbeat / session.stream.ack"

**模拟场景**:

1. Agent 正在执行 `grep -r "pattern" /large/dir`，输出了一半结果
2. 用户看到输出后意识到应该搜索 `"other_pattern"` 而不是 `"pattern"`
3. 当前唯一的选择: `POST /cancel` (取消整个 turn) → `POST /input` (重新开始) → agent 从零开始

这与 README 描述的 "WebSocket-first 实时事件流" 愿景有距离 — 实时连接存在，但 client→server 方向几乎是单向的。

**严重程度**: 🔴 **高**。限制了 agent 交互的自然性，"取消重来" 是降级体验。

**缓解方案**: 当前只能通过 `POST /cancel` + `POST /input` 实现 "停止当前方向并重新开始"。这不是真正的 "follow-up input"。

---

## 3. 完整 Agent Loop 模拟

以下模拟一个完整的前端 client agent loop，标注每个步骤的 API 调用和已知断点:

```
┌────────────────────────────────────────────────────────────────┐
│              模拟: 前端 Client 完整 Agent Loop                     │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 🔐 Auth                                                     │
│     POST /auth/login {email, password}                          │
│     → tokens (access_token, refresh_token)                      │
│     ✅ 完整                                                      │
│                                                                 │
│  2. 🧠 Model Selection                                          │
│     GET /models → pick "@cf/ibm-granite/granite-4.0-h-micro"   │
│     PATCH /sessions/{id}/model (optional)                       │
│     ✅ 完整                                                      │
│                                                                 │
│  3. 🆕 Session Init                                             │
│     POST /me/sessions → session_uuid                            │
│     POST /sessions/{id}/start {model_id, reasoning}             │
│     ✅ 完整                                                      │
│                                                                 │
│  4. 🔌 Connect WebSocket                                        │
│     wss://.../sessions/{id}/ws?access_token=&last_seen_seq=0    │
│     → begin receiving events                                    │
│     ✅ 完整                                                      │
│                                                                 │
│  5. 💬 Send First Input                                         │
│     POST /sessions/{id}/input {text: "write a python script"}   │
│     OR POST /sessions/{id}/messages {parts: [...]}              │
│     ✅ 完整                                                      │
│                                                                 │
│  6. 📡 WS Stream Processing                                     │
│     ┌─ turn.begin {turn_uuid}                                   │
│     ├─ llm.delta {content: "Sure! Here's", is_final: false}     │
│     ├─ llm.delta {content: " the script:", is_final: true}      │
│     ├─ tool.call.progress {tool_name: "bash", chunk: "..."}     │
│     ├─ tool.call.result {tool_name: "bash", status: "success"}  │
│     └─ turn.end {turn_uuid, usage}                              │
│     ✅ 完整                                                      │
│                                                                 │
│  7. ⚠️ Confirmation Handling                                     │
│     ┌─────────────────────────────────────────────────────┐     │
│     │ 🔴 BLIND SPOT: 前端不知道 agent 在等待确认            │     │
│     │                                                     │     │
│     │ Workaround: 定时轮询                                 │     │
│     │   GET /sessions/{id}/confirmations?status=pending    │     │
│     │   → 发现 pending confirmation                       │     │
│     │   → 弹出确认弹窗                                     │     │
│     │   → POST /sessions/{id}/confirmations/{uuid}/decision│     │
│     │   → agent 继续执行                                   │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│  8. 🔴 Mid-Turn User Interruption                                │
│     ┌─────────────────────────────────────────────────────┐     │
│     │ 🔴 BLIND SPOT: 无法在 turn 中注入 follow-up input    │     │
│     │                                                     │     │
│     │ User types: "stop and search for foo instead"       │     │
│     │ → No WS client→server frame available               │     │
│     │ → Must: POST /cancel → POST /input (full restart)   │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│  9. ⚠️ Context Pressure                                          │
│     ┌─────────────────────────────────────────────────────┐     │
│     │ 🟡 BLIND SPOT: auto-compact not wired               │     │
│     │                                                     │     │
│     │ ✓ Frontend can: GET /context/probe every few turns  │     │
│     │   → compact_required = true                         │     │
│     │   → POST /context/compact (manual trigger)          │     │
│     │   → WS compact.notify confirms completion           │     │
│     └─────────────────────────────────────────────────────┘     │
│                                                                 │
│ 10. ⚠️ Tool Cancel                                               │
│     POST /sessions/{id}/tool-calls/{uuid}/cancel → 202         │
│     → Wait for WS tool.call.cancelled confirmation              │
│     ⚠️ HTTP return is first-wave ack only                       │
│                                                                 │
│ 11. 🔄 Disconnect / Reconnect                                    │
│     WS drops → reconnect with last_seen_seq=N                  │
│     → Server replays buffered events                           │
│     → If replay_lost: POST /resume + GET /timeline reconciliation│
│     ✅ 完整                                                      │
│                                                                 │
│ 12. 🏁 Session End                                               │
│     POST /close OR natural completion                           │
│     → WS session.end {reason: "completed"} + close 1000         │
│     ✅ 完整                                                      │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 4. 缺口总汇

| # | 缺口 | 影响面 | 严重度 | 当前缓解 | 建议优先级 |
|---|------|--------|--------|---------|-----------|
| G1 | `session.confirmation.request/update` WS 帧未 emit | 确认弹窗实时性 | 🔴 高 | HTTP 轮询 (`GET /confirmations`) | **P0** |
| G2 | 无 `followup_input` WS client→server 帧 | 中途干预能力 | 🔴 高 | `POST /cancel` + `POST /input` (粗暴) | **P1** |
| G3 | auto-compact runtime 未接线 | 上下文溢出风险 | 🟡 中 | 前端轮询 probe + 手动 compact | **P2** |
| G4 | `model.fallback` WS 帧未 emit | 模型信息不同步 | 🟡 中 | 轮询 `GET /model` | **P3** |
| G5 | Tool cancel 是 first-wave ack | 取消确定性 | 🟡 中 | WS `tool.call.cancelled` confirm | 🟢 已有 |
| G6 | Workspace 文件 bytes 不可直接读取 | 文件预览 | 🟢 低 | artifact 路线迂回 | **P4** |
| G7 | Checkpoint restore executor 未 live | 恢复能力 | 🟢 低 | hero-to-platform 再议 | **P5** |

---

## 5. 形状正确性 vs 时序完整性

这次对照暴露了一个规律: nano-agent 的 API 在**形状正确性**上很成熟，但在**时序完整性**上有系统性缺口。

### 形状正确性 ✅

- 所有 endpoint 的 request/response schema 已冻结
- Error code registry 完整 (60+ codes + 分类器)
- Transport envelope 法律清晰 (6 种 profile)
- Auth 链路完整 (HMAC JWT + refresh + device gate)
- Session 生命周期状态机明确 (pending → active → ended)
- 所有 WS 帧 schema 已通过 zod 校验

### 时序完整性 ⚠️

- 3 个 WS 通知帧 schema 已注册但 **emitter 未接通** (G1, G4)
- 1 个 WS client→server 帧方向 **未暴露** (G2)
- 1 个 runtime 行为 **未接线** (G3)

这是一个**可预期的阶段性问题**: nano-agent 选择了 "schema-first" 策略 — 先把协议形状冻入 `packages/nacp-session`，再逐步接通 emitter。对于 hero-to-pro 阶段的前端 client 来说，这意味着:

1. **API 形状不会变** ✅ — 前端可以放心基于当前 schema 写代码
2. **实际 emit 行为可能缺失** ⚠️ — 前端需要在缺失处写 HTTP 轮询 fallback
3. **fallback 代码可以在 emitter 接通后删除** — 不会产生 API breaking change

---

## 6. 建议

### P0 — 接通 confirmation WS emitter (G1)

**影响**: 确认弹窗的实时性是 agent loop 体验的最大瓶颈。

**做法**: 在 `workers/agent-core/src/host/` 的 confirmation kernel 中添加 `session.confirmation.request` 和 `session.confirmation.update` 的 WS emit。Schema 已就绪，这是"接线"而非"设计"工作。

**前端收益**: 删除 HTTP 轮询代码，改为 WS 事件订阅。

### P1 — 暴露 followup_input 为 WS client→server 帧 (G2)

**影响**: 让用户在 turn 中途可以注入新指令，实现自然的多轮对话干预。

**做法**: 在 `session-ws-v1` direction matrix 中添加 `session.followup_input` client→server 帧，在 session-do runtime 中接受并处理 (替换/追加当前 user prompt)。

**前端收益**: 实现 "实时对话干预" 交互，不需要 cancel + restart。

### P2 — 接通 auto-compact 或至少接通 compact.notify 完整链路 (G3)

**影响**: 长对话的可靠性。

**做法**:
- 短期: 确保 `compact.notify` 在手动 compact 完成后能被正确 emit (确认是否已是 live)
- 中期: 解除 `compactRequired: false` 硬编码，让 runtime 在阈值触发时自动执行 compact

**前端收益**: 减少前端 context management 逻辑，降低上下文溢出报错率。

### P3 — 接通 model.fallback WS emitter (G4)

**影响**: 前端模型显示准确性。

**做法**: 在 agent-core 的 model selection 路径中，当 fallback 发生时 emit `model.fallback` WS 帧。

**前端收益**: 实时更新 UI 中显示的模型名称，提升用户信任。

### P4 — 接通 workspace 文件 bytes 读取

**影响**: 允许前端直接读取 agent 生成的文件内容。

**做法**: 让 `GET /sessions/{id}/workspace/files/{*path}` 在 `content_source` 接通后返回实际 bytes (或提供独立的 `/workspace/files/{*path}/content` binary 路由)。

### P5 — hero-to-platform 阶段再议

- Checkpoint restore executor 完整实现
- Fork 功能
- LLM-side WriteTodos capability

---

## 7. 最终判断

> **API 面是否足够制作前端 client？**

**答案: 基本足够，但需要前端在 4 个盲点处做防守性编码 (HTTP 轮询 fallback)。**

nano-agent 的 current API surface (18 份 HP9 frozen docs) 在 **HTTP plane** 上是完整的 — session lifecycle、history、files、models、confirmations、checkpoints、todos、usage、context 都有对应的 CRUD 路由。在 **WS plane** 上，server→client 方向的核心流 (llm.delta、tool.call.*、turn.*、session.end) 是完整的，重连机制是成熟的三层设计。

但要让一个 agent loop 达到 "WebSocket-first 实时事件流" (README 所述愿景)，还需要补齐 4 个 WS 层的缺口:

1. **Confirmation 实时通知** (schema 已有, emitter 缺)
2. **Follow-up input 帧** (protocol 已有, WS 帧缺)
3. **Auto-compact 接线** (probe 已计算, runtime 忽略)
4. **Model fallback 通知** (schema 已有, emitter 缺)

这 4 个缺口都不是 API **设计**层面的缺失 — 对应的 schema、protocol、probe 都已就绪。它们是 API **实现**层面的尚未接线。对于 hero-to-pro 阶段的前端 client 开发，这意味着:

- **可以开始写前端代码** — API 形状稳定，不会 breaking change
- **需要在 4 个盲点写 HTTP fallback** — 工作量可控，可以在 emitter 接通后删除
- **hero-to-platform 阶段的能力 (fork、restore executor、workspace bytes) 可以暂时不依赖**
