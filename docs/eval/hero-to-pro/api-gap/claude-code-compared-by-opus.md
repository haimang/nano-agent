# nano-agent Client API vs. Claude-Code Agent Loop — Gap Analysis

> Reviewer: Claude Opus 4.7 (1M context)
> Date: 2026-05-02
> Scope baseline: 仅以下三个来源,不发散
> 1. `clients/api-docs/*.md`(HP9 frozen 18-doc pack)
> 2. `context/claude-code/`(参考实现)
> 3. 仓库根 `README.md`(项目 vision)

---

## 0. TL;DR

**结论一句话**:HP9 frozen 18-doc pack 已经能撑起一个**对话形态**的前端 client(聊天 + 流式 + 工具结果展示 + checkpoint 展示 + usage 面板),但**做不了 Claude-Code 级 agent 工作台** —— 卡在三条服务端实现的拼接缺口上。

**三条阻断级缺口**:
1. **B1**:`session.confirmation.request/.update` WS 帧 schema-frozen 但 emitter 未 live;legacy `session.permission.request` 已停发 → 客户端拿不到 push,只能轮询。
2. **B2**:agent-core 没有 `WriteTodos` capability → LLM 不能驱动自己的 task list,todo plane 退化为人工记事本。
3. **B3**:auto-compact 未接线(`compactRequired:false` 硬编码),手动 `/context/compact` 的 body 字段又被静默忽略 → 长 session 必撞 context window。

**最小可行补丁集(按 ROI 排序)**:接通 confirmation emitter → 接通 WriteTodos → 接通 workspace file 字节 GET → 真实 tool-call ledger → auto-compact 接线。前 4 条补完,前端才具备做"agent 工作台"的能力。

---

## 1. 度量尺:Claude-Code 的 agent loop 长什么样

`context/claude-code/query.ts` 的 `queryLoop` 是**单 turn 自递归**的有限循环(~1729 行,核心 `while(true)`):

```
build prompt
  → applyToolResultBudget(把超大 tool 结果落盘)
  → snip / microcompact / contextCollapse / autocompact(四级 compact 流水线)
  → callModel(stream)
  → 收 tool_use blocks
  → canUseTool(per-tool 权限:allow / deny / ask;updatedInput 可改写)
  → 串行 / 并行 runTools(read-only 批可并发,destructive 必须串)
  → 收 tool_result + queued commands + skill 抓取 + memory prefetch
  → stop hooks
  → 下一轮 / terminal
```

伴随回路的必备机制:
- **push-based 流帧**(StreamEvent / partial messages / tombstone)
- **permission ask 中间态**(canUseTool 是阻塞的,UI 弹出确认 → 解锁)
- **LLM-driven TodoWrite**(agent 自管 plan)
- **auto-compact + reactive-compact + snip + collapse 四级降阶**
- **stop hook**(回路出口可被 hook 阻塞 / 重新驱动)
- **fallback model**(`FallbackTriggeredError` 触发整次请求重试)
- **subagent fork / sub-task 树**(AgentTool 递归调用 query())
- **file ledger / tool ledger**(可回看任意一次工具调用的输入输出)
- **reconnect / replay**(transcript 持久 + last_seen_seq 回放)

我用这把尺,**逐项核对 nano-agent 客户端能不能装出同样的东西**。

---

## 2. 完整 endpoint 覆盖矩阵(只算 client-facing)

| Agent loop 功能 | nano-agent 现状 | 评分 |
|---|---|---|
| 登录 / 刷新 / me / device | `/auth/*` 全套 + `/me/*` + `/me/devices/revoke` | ✅ 完整 |
| 会话 CRUD + tombstone | `/me/sessions` GET/POST,`DELETE /sessions/{id}` 软删 parent conversation,`PATCH /sessions/{id}/title`,`/conversations/{uuid}` detail | ✅ 完整 |
| Model 选择 + per-turn override | `/models` ETag,`PATCH /sessions/{id}/model`,`model_id` 在 `/start` `/input` `/messages` body 内 | ✅ 完整 |
| 启动 / 输入 / 取消 / 关闭 | `/start /input /messages /cancel /close` | ✅ 完整 |
| 多模态输入 | `/messages` with `parts[]`(text / image / artifact_ref) | ✅ 完整 |
| Artifact 上传 / 读字节 | `POST /files`(multipart),`GET /files/{uuid}/content`(binary-content profile) | ✅ 完整 |
| Stream 帧族(13-kind catalog) | `llm.delta` / `tool.call.progress|result|cancelled` / `turn.begin|end` / `compact.notify` / `system.notify|error` / `session.usage.update` 等 | ✅ 主线齐 |
| Reconnect + replay | `last_seen_seq`,`POST /resume`,`GET /timeline` 兜底 | ✅ 设计闭环 |
| 历史 / timeline 拉取 | `/history` `/timeline` cursor 化 | ✅ |
| Confirmation HTTP plane | `/confirmations` list/detail/decision,7-kind × 6-status | ✅ HTTP live |
| 7-kind confirmation registry | schema 全冻 | ✅ schema |
| Compact 触发(手动) | `/context/probe`,`/context/layers`,`/context/snapshot`,`/context/compact/preview`,`/context/compact`,`/context/compact/jobs/{id}` | ⚠️ body 字段全 ignore |
| Checkpoint create/list/diff | `/checkpoints` HP4 first-wave | ✅ |
| Checkpoint restore | `/checkpoints/{uuid}/restore` | ⚠️ 只开 pending job,executor 未 live |
| Fork | `/fork` | ⚠️ `fork_status: "pending-executor"` ack only |
| Todo list HTTP | `/todos` CRUD,5-status,at-most-1 in_progress invariant(Q19) | ✅ HTTP live |
| Workspace temp file metadata | `/workspace/files` CRUD,7-rule path normalize(Q19),tenant-scoped R2 key(Q19) | ✅ metadata |
| Workspace temp file 字节 | metadata 返回 r2_key,但 `content_source: filesystem-core-leaf-rpc-pending` | ❌ 字节拿不到 |
| Tool ledger 查询 | `/sessions/{id}/tool-calls` | ❌ 当前返空,`source: "ws-stream-only-first-wave"` |
| Usage snapshot + push | `/sessions/{id}/usage` + `session.usage.update` 帧 live(HP9) | ✅ |
| Catalog (skills/commands/agents) | 静态 11 项(`catalog-content.ts`) | ✅ 描述用 |
| 错误分类 | `error-index.md` 完整,WS `system.error` 结构化 + dual-emit 窗口 | ✅ 强 |
| 设备多端冲突 | `attachment.superseded` + close `4001` | ✅ |
| 心跳 | `session.heartbeat` 每 15s | ✅ |

---

## 3. 模拟一次完整 turn,看断点在哪里

**场景**:用户登录 → 新会话 → 提问"列出 workspace 文件并把要做的写进 todo"。

```
1.  POST /auth/login                                                ✅
2.  POST /me/sessions                                               ✅ session_uuid pending
3.  POST /sessions/{id}/start                                       ✅ active
4.  GET  /sessions/{id}/ws?access_token=...&trace_uuid=...          ✅ attached
        (注意:必须严格 start ack → ws connect,否则首条 turn.begin 会落到客户端 attach 之前)
5.  POST /sessions/{id}/input { text: "..." }                       ✅
6.  ⇐ event{turn.begin}                                             ✅
7.  ⇐ event{llm.delta}*N                                            ⚠️ content_type 枚举未文档化
8.  LLM 想调用 list_files
    → orchestrator 写一条 confirmation row(kind=tool_permission, status=pending)
    ⇐ WS 应该 push session.confirmation.request                     ❌ emitter 未 live(HP5)
    ⇐ legacy session.permission.request                             ❌ 已声明不再 emit(permissions.md §1)
    → 客户端只能轮询 GET /confirmations?status=pending               ⚠️ 严重 UX 退化
9.  POST /confirmations/{uuid}/decision { status: "allowed" }       ✅
10. ⇐ event{tool.call.progress / .result}                           ✅
11. LLM 想 WriteTodos("step 1: ...")
    → agent-core 没有 WriteTodos capability(todos.md §9)            ❌
    → todo 不会被 LLM 写进去;客户端必须代用户手工 POST /todos
12. ⇐ event{turn.end, usage}                                        ✅
13. ⇐ event{session.usage.update}                                   ✅
```

**第 8 步和第 11 步是两个"卡死了 agent loop 心跳"的真正断点。** 其它步骤都能跑通。

延伸场景:
- **多 turn 长会话** → 第 N 轮触发 context overflow,但 agent-core `compactRequired:false` 硬编码,auto-compact 不会触发 → LLM API 直接 PROMPT_TOO_LONG。客户端能调 `/context/compact` 手动救火,但 body 字段被忽略,不能精细控制。
- **重试上一条 prompt** → `POST /retry` 返一个 hint 让客户端"自己 POST /input 重发",不是真正的 attempt-chain;客户端必须缓存上一条 prompt。
- **回退到 checkpoint** → `POST /restore` 返 `pending` job,executor 未 live → 永远 pending。
- **分叉对话** → `POST /fork` 返 `fork_status: "pending-executor"` → 不会真的分叉。
- **看 LLM 写出来的文件** → `GET /workspace/files/{path}` 给你 metadata + r2_key,但拿不到字节。
- **设置"以后总是允许 Read 工具"** → 没有 per-tool 持久规则面,只有 session 级 4 档 mode(`auto-allow / ask / deny / always_allow`)。

---

## 4. 盲点 / 断点清单(按严重度排序)

### 🔴 阻断级 — 不补,前端只能做"对话框",做不了"agent loop"

| # | 问题 | 影响 | 文档登记位置 |
|---|---|---|---|
| **B1** | `session.confirmation.request` / `session.confirmation.update` **schema 冻 / emitter 未 live**;legacy permission/elicitation 帧已停发 | 客户端无法被动收到"请批准工具调用",必须 ≥1Hz 轮询 `/confirmations`,撕掉了 README 的 WS-first 承诺 | `confirmations.md` §5,`session-ws-v1.md` §3.3 |
| **B2** | agent-core **没有 WriteTodos capability** | LLM 不能驱动自己的 task list,todo plane 退化为人工记事本,Claude Code 的 plan-act-update 主回路在 nano-agent 上**根本跑不起来** | `todos.md` §9 |
| **B3** | **Auto-compact 未接线**(`compactRequired:false` 硬编码) + 手动 `/context/compact` 的 body 字段**全部被静默忽略** | 长 session 一定撞 context window;精细控制不可达;UI 上"compact" 按钮只能"全有/全无" | `context.md` §2 / §5 / §6 |

### 🟡 重要级 — 影响"专业 agent 客户端"体验

| # | 问题 | 影响 |
|---|---|---|
| **Y1** | restore executor / fork executor **未 live** | "回退/分叉"按钮点了只能开 pending job,前端要么藏起按钮,要么标"功能预览中" |
| **Y2** | `/sessions/{id}/tool-calls` **first-wave 返空**(`source: "ws-stream-only-first-wave"`) | 翻历史看某次工具的参数 / 输出 → 只能去 `/timeline` 自己拼 frame;无法只查单条 tool call detail |
| **Y3** | `/workspace/files/{*path}` **content 字节未通**(只返 r2_key) | 文件浏览器没法预览 LLM 写出来的文件;只能展示文件名 |
| **Y4** | **Permission 规则面缺失**:只有 session 级 `permission_mode` 4 档(`auto-allow/ask/deny/always_allow`);没有 per-tool / per-pattern 持久规则,没有 Claude Code 的 `acceptEdits` / `plan` 这类语义 | "记住总是允许 Read" / "Bash 限定 git status" 这类典型设置无法表达;无法存 user/project/local 三级规则 |
| **Y5** | `model.fallback` 帧 **schema live 但 emitter 未 live** | fallback 静默发生,用户看不到"已切到备用模型"提示 |
| **Y6** | `/sessions/{id}/retry` 仍是 first-wave 提示性 ack(返 hint 让你重发上一条 user prompt),不是真正的 attempt-chain | "重试"按钮的语义比 Claude Code 弱一档,客户端必须缓存上一条 prompt |
| **Y7** | `llm.delta.content_type` **未文档化枚举** | 客户端不知道要不要分别处理 thinking / text / image / tool_use 块 — Claude Code 必须把 thinking 块单独走签名保留逻辑(query.ts §"rules of thinking") |
| **Y8** | 没有 stop-hook 客户端等价物;hooks 是服务端 service-binding 模型 | 客户端无法在 turn 结束时插入"再问一次"或"阻断继续"语义,失去 Claude Code 的 stop-hook 死循环防护机制 |

### 🟢 README 主动 trade-off — 不算 bug,但前端要先告知用户

| # | 项 | README 立场 |
|---|---|---|
| G1 | 没有 subagent / sub-task 树式并行 surface | "单 agent / 单线程为早期核心"是 §4.2 主动 trade-off |
| G2 | 没有 hooks 客户端注册面 | hooks 是服务端 service-binding 模型,不暴露给 client(§4.1 ③) |
| G3 | 没有 memory 路由(MEMORY.md / nested CLAUDE.md 注入) | 暂未表态 |
| G4 | 没有 slash command 执行面(只有 `/catalog/commands` 描述) | 期望客户端自己解析 `/clear` `/help`,把"业务命令"翻译成 HTTP/WS 调用 |
| G5 | virtual git subset 而不是完整 Git | §3 表内显式声明 |

### 🟦 文档 / 契约层的小裂缝 — 客户端要写 helper 兜底

| # | 项 | 描述 |
|---|---|---|
| **D1** | `legacy-do-action` 与 `facade-http-v1` envelope 形状不同 | 顶层平铺 vs `data:{...}`,客户端必须写 `unwrap()` helper(`transport-profiles.md` §3 已点名) |
| **D2** | `/sessions/{id}/close` / `DELETE` 仍走 legacy body-level `error: "conversation_deleted"` | 要映射成 facade `conversation-deleted` code(`error-index.md` legacy note) |
| **D3** | RHX2 dual-emit 窗口期 | `system.error` 与 `system.notify(severity=error)` 同 trace 同 code 重复发送,客户端必须 `(trace_uuid, code)` ~1s 去重 |
| **D4** | WS 握手在 session **pending** 时返 `409 session-pending-only-start-allowed` | 意味着客户端要严格 `start ack → ws connect`;文档没有显式画出"start 之后到 ws attach 之间是否会丢帧"的窗口保证 |
| **D5** | `/sessions/{id}/context/compact/preview` 的 60s cache(Q12)未实现 | 同状态多次调价格不可缓存;UI 不能依赖结果稳定 |
| **D6** | confirmation row 失败永远是 `superseded` 而非 `failed`(Q16) | 客户端要把 `409 confirmation-already-resolved` 视作终态成功,不是 retryable |
| **D7** | tool / artifact / workspace temp file 三概念区分 | 客户端要清楚 `artifact_ref`(用户上传)≠ workspace temp(LLM 写)≠ snapshot(checkpoint 用)— `workspace.md` §1 已表 |

---

## 5. 能做的 vs 做不动的

### 能做的(直接开工没问题)

- **聊天形态 Web client / 微信小程序**:登录、会话列表、发送消息、流式 LLM 输出、查 usage、上传图片、checkpoint 展示、断线重连 — 整套 18-doc pack 在这个层面**已经足量**,而且是 Cloudflare-native 设计的完整证明。
- **后台运维 / 调试面板**:`/debug/*` + `/me/*` 已经能撑起 team-scoped 错误观察、device 撤销、package drift 监控。

### 做不动的(没有补丁就装不出 Claude-Code 形态的 agent loop)

只要前端目标包含"看到 agent 自己在 plan & act & confirm",就会**立刻撞上 B1+B2+B3 三条阻断**:
1. 你看不到 agent 在等你批准什么(emitter 没接);
2. 你看不到 agent 给自己排了什么 todo(WriteTodos 没接);
3. 你只要让 session 跑得久一点,就会被 context window 怼死(auto-compact 没接)。

这三条是**协议+服务端实现的拼接缺口**,不是文档缺口 — 文档已经诚实标注了 "schema live / emitter pending"、"agent-core 没有 capability"、"hardcoded false"。

---

## 6. 建议:最小可行补丁集(按 ROI 排序)

> 目标:**让前端从"对话框"升级到"agent 工作台"**,以最小改动为限。

| 优先级 | 补丁 | 改动局限 | 前端立刻获得的能力 |
|---|---|---|---|
| **P0** | 接通 confirmation WS emitter(B1) | 局限在 orchestrator-core,row-write 之后再 emit 一帧即可 | WS-first 承诺成立;permission/elicitation 对话框从轮询 → 事件驱动 |
| **P0** | 接通 agent-core WriteTodos capability(B2) | agent-core 新增一个 capability,触达 `/todos` HTTP control plane 已有的 D1 truth | LLM 能写自己的 plan,前端 todo 区从"记事本"变"agent 工作板" |
| **P1** | 接通 workspace file 字节 GET(Y3) | filesystem-core leaf RPC 已 live,只差 façade 把字节透出来 | 文件浏览器立刻可用;agent-written file 可预览 |
| **P1** | `/sessions/{id}/tool-calls` 真实 ledger(Y2) | orchestrator-core 把 D1 / KV 的 tool call rows 透到这条路由 | 等价于 Claude Code 的 transcript 回放;支持"翻历史看某次工具调用" |
| **P2** | auto-compact 接线(B3)+ 把 compact body 字段真正读起来 | agent-core orchestration 取消 `compactRequired: false` 硬编码;façade 把 body 字段透到 context-core | 长 session 才能活;compact 才有可控性 |
| **P3** | model.fallback emitter 接通(Y5) | agent-core 在 fallback 决策点 emit 一帧 | UI 能告知"已切到备用模型" |
| **P3** | `llm.delta.content_type` 枚举文档化(Y7) | 仅文档,不动代码 | 客户端能正确分流 thinking / text / tool_use 块 |
| **P3** | start → ws attach 窗口的帧保留契约(D4) | 仅文档,或 `/start` 返回 `first_event_seq` 字段供客户端用 `last_seen_seq` 兜底 | 消除"首条 turn.begin 漏接"风险 |

补完 P0 / P1 的 4 条,前端才真正具备做出"Claude-Code 级 agent 工作台"的能力;在那之前,前端最稳的产品形态是**"对话 + 流式 + 权限对话框(轮询版)+ checkpoint 展示"**,而不是"agent 工作台"。

---

## 7. 给前端 client 作者的实战提示

如果今天就要开工,基于 HP9 frozen pack 写 client,以下几条是**必须写进 transport / state 层**的兜底逻辑:

1. **Envelope dual-shape unwrap**:`legacy-do-action` 和 `facade-http-v1` 两种成功 shape 都要正确解析,写一个统一 `unwrap()` helper。
2. **Confirmation polling fallback**:在 emitter 接通前,attached + active session 状态下定时(建议 1.5–3s)拉 `/confirmations?status=pending`;一旦 emitter 接通就切回事件驱动,不需要改前端 UI 层。
3. **Trace UUID 必发 + 错误 UX 显示**:每个业务请求生成 `x-trace-uuid`,任何用户可见的失败都要展示这个 UUID,方便用户报障 + server 侧关联 `nano_error_log`。
4. **Error code 优先,status 兜底**:按 `error-index.md` 的 `classifyNanoError` 模板分类,401 不直接登出 — 先尝试 refresh 一次。
5. **Reconnect 三步**:`last_seen_seq` → `POST /resume` → `GET /timeline`(若 `replay_lost`);三层兜底齐备。
6. **`(trace_uuid, code)` 1s 去重**:dual-emit 窗口期内 `system.error` + `system.notify(error)` 会双发,UI 只能渲染一次。
7. **Pending session WS 握手错误显式处理**:严格 `start ack → ws connect`,否则会拿到 `409 session-pending-only-start-allowed`。
8. **`409 confirmation-already-resolved` 当成成功**,不要重试(HP5 row-first dual-write law)。
9. **Tool call 历史走 `/timeline` 拼**(在 `/tool-calls` 真实 ledger 上线前)。
10. **长 session 主动提示用户手动 compact**:在 `/context/probe` 的 `effective_context_pct` 超过 ~70% 时,UI 上提示"建议压缩上下文",因为 auto-compact 还没接。

---

## 8. 评价

文档侧 HP9 18-doc pack 的工作非常诚实:**所有"schema live / emitter pending"、"first wave"、"hardcoded false"、"body ignored" 都明确标注了**,没有任何"已实现"的虚假承诺。这让这次 gap 分析能纯粹聚焦在协议+实现的拼接缺口上,而不是被文档与代码漂移迷惑。

Vision 侧 README 立场也清晰:nano-agent 不是"缩水版 Claude Code",而是云原生 agent runtime;某些 trade-off(单 agent、单线程、不暴露 hooks 给 client、无 sub-task 树)是**主动选择**,不会改。所以这份 gap 分析里的 G1–G5 不应该被视作"待办",而是"前端 UX 设计需要适配的边界"。

真正需要补的,是把那三条阻断级缺口(confirmation emitter / WriteTodos / auto-compact)从 "schema live" 推到 "fully wired"。这三条补完,nano-agent 就拿到了它在 README 里宣称的全部价值组合 —— 一个 **Cloudflare-native、WebSocket-first、stateful、可治理、对 LLM 友好的 agent runtime**,而不是仅仅一个云端的"chat-with-tools"后端。
