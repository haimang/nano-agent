# new-apis.md 审查报告

**审查者**: GLM (独立分析，未参考 GPT、DeepSeek 或其他模型输出)  
**审查对象**: `clients/wechat-miniprogram/docs/new-apis.md`  
**日期**: 2026-04-28  
**关联上下文**: `docs/eval/real-to-hero/api-gap-study-by-GLM.md`

---

## 总体评价

这份行动计划在**小程序侧的代理层抽象**上设计合理，分层清晰（技术层 `utils/` → 业务层 `api/` → 消费层 `pages/`），5 个 Phase 的推进顺序也符合"先协议后实现、先底层后上层"的原则。但审查发现，计划存在一类**结构性盲点**：它假设后端提供的接口已经足够支撑一个"真实可用的小程序"，而没有识别后端接口本身的缺口。

以下审查基于：
1. 小程序现有源码（`utils/api.js`, `utils/nano-client.js`, 4 个页面 JS）
2. 后端 API 文档（`clients/api-docs/` 全部 9 份文档）
3. 后端真实代码（6 个 worker 源码）
4. 已完成的 gap study（`docs/eval/real-to-hero/api-gap-study-by-GLM.md`）

---

## 1. 计划本身的设计缺陷

### 1.1 [Critical] `api/stream.js` 只封装了 4 种 WS frame —— 但这恰好是全部现存 frame

计划第 5.3 节定义 `api/stream.js` 封装 4 类服务端 frame：

- `{kind:'event'}` → `{type: 流事件类型, data: {...}}`
- `{kind:'session.heartbeat'}` → `{type: 'heartbeat', data: {ts}}`
- `{kind:'attachment_superseded'}` → `{type: 'superseded', data: {...}}`
- `{kind:'terminal'}` → `{type: 'terminal', data: {...}}`

这段封装**正确反映了当前后端 WS 的真实行为**。但我审查后端代码后发现，`NanoOrchestratorUserDO.emitServerFrame()` **从未被任何运行时代码路径调用**。也就是说，后端已经定义但未实现的 WS 帧类型包括：

| 已定义但未实现的 WS 帧类型 | 来自 nacp-session schema | 对小程序的影响 |
|---|---|---|
| `meta(opened)` | 连接建立确认 | 小程序无法区分"连接成功"和"正在重连" |
| `session.permission.request` | 工具执行需要用户批准 | 小程序无法实现"是否允许执行此命令"的交互 |
| `session.usage.update` | 使用量实时推送 | 小程序无法显示实时 token 消耗 |
| `session.elicitation.request` | 主动询问用户 | 小程序无法实现 Agent 主动提问 |
| `session.elicitation.answer` | 回答主动提问 | 同上 |

**建议**：`api/stream.js` 的回调接口设计应预留这些帧类型的处理空位，即使当前后端不会发送它们。具体做法：

```javascript
// stream.js 回调接口应预留
const callbacks = {
  onEvent: required,        // 当前已实现
  onHeartbeat: required,    // 当前已实现
  onSuperseded: required,   // 当前已实现
  onTerminal: required,     // 当前已实现
  // 以下为预留，后端启用后可直接使用
  onOpened: optional,       // meta(opened) — 连接建立确认
  onPermissionRequest: optional,  // session.permission.request
  onUsageUpdate: optional,         // session.usage.update
  onElicitationRequest: optional, // session.elicitation.request
};
```

这样当后端启用这些帧后，小程序侧不需要重新设计接口，只需实现对应的回调处理。

### 1.2 [Critical] `api/session.js` 缺少 `usage` 代理函数

计划的 `api/session.js` 代理了 8 个函数：`start`, `input`, `cancel`, `getStatus`, `getTimeline`, `getHistory`, `verify`, `resume`。但 `apiRoutes.js` 中明确定义了 `sessionUsage` 路由，`utils/api.js` 中也有 `sessionUsage(sessionUuid)` helper。

**遗漏原因分析**：`sessionUsage` 在 `api.js` 中是作为一个被暴露的 helper 存在，但在计划的 P2-02 工作项中未包含。

**建议**：在 P2-02 中增加 `usage(sessionUuid)` 函数，代理 `GET /sessions/{uuid}/usage`。虽然当前返回值全为 `null`（后端 usage 数据是 placeholder），但：
1. 小程序需要知道 session 是否存在、当前状态
2. 未来后端启用真实 usage 数据后，可以无缝切换
3. `durable_truth` 字段已经有用（包含 `message_count`, `activity_count`, `last_event_seq`）

### 1.3 [Medium] `api/auth.js` 遗漏了 `verifyToken` 使用场景

计划 P2-01 定义 `api/auth.js` 包含 `verifyToken(accessToken)` 函数。但审查小程序代码发现，`pages/auth/index.js` 的登录流程是：

```javascript
// 当前登录成功后的处理
const token = res.data?.tokens?.access_token;
const refreshToken = res.data?.tokens?.refresh_token;
app.setLoginState(user, token, refreshToken);
```

其中 `app.setLoginState` 只是本地存储 token。**没有**在登录后调用 `verifyToken` 进行二次校验。通常 JWT 最佳实践是：
1. 登录/注册获取 token
2. 可选调用 `verifyToken` 确认 token 有效
3. 401 时用 `refreshToken` 刷新

当前小程序的 401 处理在 `utils/api.js` 的 `request()` 中已经实现了 token 刷新重试。所以 `verifyToken` 的使用场景是：
- App 冷启动时验证存储的 token 是否仍然有效
- 关键操作前校验 token 状态

**建议**：在 `api/auth.js` 中明确标注 `verifyToken` 的推荐使用场景（app.onLaunch 中校验），并在 `app.js` 的 `onLaunch` 中添加 token 校验逻辑。

### 1.4 [Medium] `api/me.js` 只有 2 个函数 —— 远远不够

计划 P2-03 定义 `api/me.js` 只有 `createSession()` 和 `listSessions()`。但审查 `apiRoutes.js`，`/me` 路径有 `me` 和 `meAlias` 两个路由 key，都指向 `GET /auth/me` 或 `GET /me`。

当前 `pages/profile/index.js` 调用的是 `api.request('me', {...})`，这不是 `meSessions` 相关的，而是获取当前用户信息的接口。

**建议**：`api/me.js` 应该包含：
1. `createSession()` — POST /me/sessions
2. `listSessions()` — GET /me/sessions
3. `getProfile()` — GET /me （或 GET /auth/me）

或者将 `getProfile()` 归入 `api/auth.js`（计划中已有 `getMe()`，两者是同一接口的不同路由别名）。需要明确：`getMe()` 在 `auth.js` 还是在 `me.js`？当前计划中 `auth.js` 有 `getMe()`，但 `pages/profile/index.js` 通过 `api.request('me')` 调用。迁移后应该走哪个模块？

**建议方案**：`getProfile()` 放在 `api/auth.js`（因为它是 auth 相关的读取），`api/me.js` 只负责 session 管理。在 `api/auth.js` 的 `getMe()` 注释中标注"等等效于 `GET /me`"。

---

## 2. 计划与后端真实行为的偏差

### 2.1 [Critical] 后端 `session_status` vs `status` 字段不只是命名不一致

计划 P2-02 和风险表中提到：

> 后端 `session` 相关接口的返回字段存在历史不一致（如 `session_status` vs `status`），映射逻辑需要仔细 review

审查后端源码后，这不仅仅是字段名不一致的问题。根据 `clients/api-docs/session.md` 的明确记录：

| 路由 | 成功返回形状 | 关键差异 |
|---|---|---|
| auth 路由 | `{ok:true, data: {...}, trace_uuid}` | 标准 facade envelope |
| POST/GET /me/sessions | `{ok:true, data: {...}, trace_uuid}` | 标准 facade envelope |
| start/input/cancel/status/timeline/history/verify | `{ok:true, action: "...", ..., trace_uuid}` | **legacy 扁平** |
| resume | `{ok:true, data: {...}, trace_uuid}` | 标准 facade envelope |

这意味着 `api/session.js` 的代理函数需要处理**两种完全不同的成功返回格式**：
- `start`、`input`、`cancel`、`getStatus`、`getTimeline`、`getHistory`、`verify` — 扁平结构，业务字段和 `trace_uuid` 在同一层
- `resume` — 嵌套 `data` 结构

**当前计划的描述**："统一 legacy action payload 为标准 envelope" — 这句话隐含了代理层需要做格式转换。但**没有具体指出转换策略**。

**建议**：在 P2-02 的具体功能预期中，明确转换策略：

```javascript
// session.js 内部转换策略
// Legacy action routes (start, input, cancel, status, timeline, history, verify)
// 返回 {ok, action, session_uuid, ..., trace_uuid}
// 代理层应提取所有非 ok/trace_uuid 字段到 data 中：
// → {ok, data: {action, session_uuid, ...}, trace_uuid}

// Facade envelope route (resume)
// 返回 {ok, data: {...}, trace_uuid}
// 无需转换
```

此外，`start` 和 `input` 的返回中还有一个**字段名不一致**需要特别处理：
- `start` 返回 `status` 字段
- `input` 返回 `session_status` 字段（语义相同但字段名不同）

代理层应统一映射为 `status`。

### 2.2 [Critical] `POST /me/sessions` 的 "pending" 语义陷阱

计划 P2-03 的 `createSession()` 调用 `POST /me/sessions`，返回 `{session_uuid, status: "pending", ttl_seconds, created_at, start_url}`。

但根据后端源码和 `clients/api-docs/me-sessions.md`：

> freshly minted 但尚未 `/start` 的 UUID，**不会**出现在 `GET /me/sessions` 列表里

这意味着：
1. 用户创建 session 后（`meSessionsCreate`），`listSessions()` 可能看不到刚创建的 session
2. 如果用户刷新页面，这个 "pending" 的 session 会从列表中消失

**建议**：`api/me.js` 的 `createSession()` 应在 JSDoc 中明确标注此行为，且 `api/session.js` 的 `start()` 应处理 session 不在列表中的情况。小程序本地应维护一个 "pending sessions" 列表，在 `listSessions()` 合并服务端结果和本地 pending sessions。

### 2.3 [Medium] `GET /sessions/{uuid}/usage` 返回全 null 值

`api/session.js` 如果加入 `usage()` 函数（如 1.2 建议），代理层需要知道此接口当前的 usage 字段全是 `null`：

```json
{
  "usage": {
    "llm_input_tokens": null,
    "llm_output_tokens": null,
    "tool_calls": null,
    "subrequest_used": null,
    "subrequest_budget": null,
    "estimated_cost_usd": null
  }
}
```

**建议**：`usage()` 函数的 JSDoc 中明确标注当前 usage 字段为 placeholder，以及 `durable_truth` 字段的可用值（`message_count`, `activity_count`, `last_event_seq`）。

### 2.4 [Medium] WS 重连策略缺少 `last_seen_seq` 持久化

`nano-client.js` 的 `connectStream` 接受 `lastSeenSeq` 参数，`api/stream.js` 暴露 `getLastSeenSeq()` 方法。但当前设计中：

1. `lastSeenSeq` 在页面 JS 中是局部变量，小程序切后台时会丢失
2. `nano-client.js` 有 `updateLastSeen()` 函数追踪最高 seq，但没有持久化到 `wx.setStorage`

**建议**：`api/stream.js` 应在每次收到 event 时自动将 `lastSeenSeq` 持久化到 `wx.setStorageSync('lastSeenSeq_' + sessionUuid, seq)`，并在 `connect()` 时自动从 storage 恢复。这样小程序切后台后重连时不会丢失 seq 位置。

### 2.5 [Low] `utils/api.js` 的 `request()` 有 401 自动重试逻辑

当前 `utils/api.js` 的 `request()` 在收到 401 时会自动刷新 token 并重试。这个逻辑**不应在代理层重复实现**，但代理层需要知道它的存在：

- 代理层函数（如 `session.start()`）调用 `utils/api.js` 的 `request()`
- 如果 `request()` 遇到 401，它会自动刷新 token 并重试
- 代理层函数不应该再额外处理 401

**建议**：在 Phase 1 重构 `utils/api.js` 时，确保 401 重试逻辑保留在技术层，代理层只关注业务逻辑和格式转换，不重复处理 401。

---

## 3. 计划对后端缺口的影响

### 3.1 [Critical] 代理层只代理了已存在的接口 —— 但小程序的核心体验缺口仍未解决

计划的 O5 明确排除：

> 不处理 `POST /sessions/{id}/messages`、`GET /sessions/{id}/files`、`GET /me/conversations`、`POST /me/devices/revoke`（文档明确标注尚未实现）

这是合理的——代理层不应代理不存在的接口。但计划**没有讨论**这些缺口对小程序用户体验的影响：

| 后端缺失的接口 | 小程序受影响的体验 | 建议的代理层应对 |
|---|---|---|
| `POST /sessions/{id}/messages` | 用户只能发纯文本（`input.text`），无法发图片、文件、结构化内容 | 当前 `input()` 只接受 `text` 参数是正确的，但 JSDoc 应标注此限制 |
| `GET /sessions/{id}/files` | 无法列出或下载会话中的文件 | 不代理，但在 `api/session.js` 中预留函数签名 |
| `GET /me/conversations` | 无法从"对话"维度查看历史，只能从"会话"维度，且没有分页 | `listSessions()` 的 JSDoc 标注当前 200 条上限和无分页 |
| `POST /me/devices/revoke` | 无法在其他设备上强制登出 | 不代理，但 `api/auth.js` 应预留 `revokeDevice()` 函数签名 |

**建议**：在每个代理模块文件头部，增加一个 `// NOT YET AVAILABLE` 注释块，列出对应的缺失后端接口。这样：
1. 开发者知道哪些功能暂时不可用
2. 后端启用新接口时，开发者知道在代理层的哪个模块添加
3. 不会因为找不到接口而认为是代理层遗漏

### 3.2 [Medium] catalog 接口返回空数组 —— 小程序需要优雅退化

计划 P2-04 的 `api/catalog.js` 代理 `/catalog/skills`, `/catalog/commands`, `/catalog/agents`，收口标准是"即使后端返回空数组也能正确处理"。

但当前后端这三个接口**永远返回空数组**（hard-coded `{skills: []}`, `{commands: []}`, `{agents: []}`）。

**对小程序的影响**：
1. 如果小程序计划展示"可用技能列表"或"可用命令列表"，当前无处获取数据
2. 如果小程序只把 catalog 作为未来扩展接口，当前应该设计为"有则展示，无则隐藏"

**建议**：`api/catalog.js` 在 JSDoc 中明确标注当前后端返回空数组，且代理层函数应返回空数组而非 null，让页面层可以安全地 `listSkills().then(skills => skills.length && renderSkills(skills))`。

### 3.3 [Medium] 小程序 WS 是单向流 —— 这与 claude-code / codex 的交互模型根本不同

审查参考 CLI 代码后发现，所有 3 个生产 CLI 都是**消息驱动**的交互模型：

- **claude-code**: 用户发消息 → 服务端返回流式响应 → 工具调用时暂停等待 → 用户批准 → 继续
- **gemini-cli**: 用户发 prompt → 服务端返回流式生成 → 工具调用由 policy 决定自动/手动
- **codex**: 用户发 turn → 服务端返回 SSE 事件流 → 审批请求通过 JSON-RPC 双向通信

当前小程序的交互模型是：
1. HTTP `POST /sessions/{uuid}/input` 发文本
2. WS 单向接收 `llm.delta`、`terminal` 等事件
3. WS 客户端发的消息（`heartbeat`, `resume`, `ack`）**不被服务端处理**

这意味着小程序当前**无法实现**：
- 工具执行审批（`session.permission.request`）
- Agent 主动提问（`session.elicitation.request`）
- 结果确认（工具结果反馈给用户）

**建议**：`api/stream.js` 的接口设计和 `api/permission.js` 的接口设计应明确标注当前限制，而不应暗示这些交互已经可用。具体来说：

1. `api/permission.js` 的 JSDoc 应标注："当前 `submitDecision()` 和 `setMode()` 只记录到服务端 hot state，**不会实际拦截工具执行**。工具执行是否需要审批取决于服务端的 policy 设置，而非客户端决策。"
2. `api/stream.js` 的 JSDoc 应标注："当前 WS 是单向流。客户端发送的 `resume` 和 `ack` 消息仅用于保持连接活跃，**服务端不会消费这些消息的状态**。"

---

## 4. 额外发现的问题

### 4.1 [High] `pages/session/index.js` 硬编码了 base URL

审查发现 `pages/session/index.js` 第 78 行：

```javascript
const baseUrl = 'https://nano-agent-orchestrator-core-preview.haimang.workers.dev';
```

这个 URL 应该来自 `apiRoutes.js` 的 `BASE_URL_MAP`，而不是硬编码。如果环境切换到 production，这里容易遗漏。

**建议**：在 Phase 3 或 Phase 4 迁移 session 页面时，WS base URL 应统一从 `apiRoutes.js` 获取。`api/stream.js` 的 `connect()` 方法应接受 `baseUrl` 参数（或从 `apiRoutes.js` 读取默认值）。

### 4.2 [Medium] `apiRoutes.js` 缺少 `requireAuth` 元数据

当前 `apiRoutes.js` 只定义了 `method` 和 `path`，没有定义 `requireAuth`（是否需要 JWT token）。而 `utils/api.js` 的 `request()` 函数通过 `options.requireAuth` 参数控制是否添加 `Authorization` header。

审查所有路由发现，只有 `register`, `login`, `wechatLogin` 三个路由不需要 auth（`requireAuth: false`），其他所有路由都需要。`catalogSkills`/`catalogCommands`/`catalogAgents` 文档标注 "optional bearer"，但小程序的 `catalogList()` helper 传的是 `requireAuth: false`。

**建议**：在 Phase 1 重构 `apiRoutes.js` 时，增加 `requireAuth` 字段：

```javascript
// 示例
sessionStart: { baseUrl: 'ORCHESTRATOR', method: 'POST', path: '/sessions/{sessionUuid}/start', requireAuth: true },
register: { baseUrl: 'ORCHESTRATOR', method: 'POST', path: '/auth/register', requireAuth: false },
catalogSkills: { baseUrl: 'ORCHESTRATOR', method: 'GET', path: '/catalog/skills', requireAuth: true }, // 改为 true
```

这样代理层函数就不需要每个都手动传 `requireAuth`，而是从路由定义中读取。

### 4.3 [Medium] 小程序的 WS 连接缺少断线重连逻辑

`nano-client.js` 的 `connectStream()` 在连接断开时调用 `onState('close')` 或 `onState('error: ...')`，但**没有自动重连逻辑**。`pages/session/index.js` 在收到 `attachment_superseded` 或 close 时也只是 `that.setData({connecting: false})` 和提示错误。

审查后端 WS 文档（`session-ws-v1.md`）明确建议的重连策略是：
1. 记住收到的最大 `event.seq`
2. 重连时带 `?last_seen_seq=<maxSeq>`
3. 不一致时补 `POST /sessions/{uuid}/resume`
4. 最终回退到 `GET /sessions/{uuid}/timeline`

**建议**：`api/stream.js` 应实现自动重连逻辑：
1. 在 `onClose` 和 `onError` 中启动指数退避重连（初始 1s，最大 30s）
2. 重连时传入 `last_seen_seq`（从 storage 读取）
3. 重连失败超过阈值（如 5 次）后回调 `onPermanentDisconnect`
4. 在重连成功后，通过 `session.resume()` HTTP 接口补齐丢失的事件

### 4.4 [Low] e2e 测试框架选择

计划中多处提到"小程序环境不支持标准单测框架"，但没指定 e2e 测试的具体实现方式（miniprogram-simulate? wx-test? 直接 HTTP 测试?）。

**建议**：在 Phase 4 开始前，明确 e2e 测试的技术方案。可选方案：
- **方案 A**：Node.js 直接调用后端 API（不依赖小程序运行时），使用 vitest/jest + fetch
- **方案 B**：使用 miniprogram-simulate + jest 模拟小程序环境
- **方案 C**：使用 Playwright +微信开发者工具自动化

推荐方案 A，因为它不依赖小程序运行时，可以直接 require `api/` 层的代理函数并 mock `wx.request`。

### 4.5 [Low] OAuth token 刷新的竞态条件

`utils/api.js` 实现了 token 刷新队列（多个并发请求遇到 401 时，只刷新一次，其他请求排队等待），这是正确的。但代理层迁移后，`api/auth.js` 的 `refresh()` 函数如果被小程序的多处代码同时调用，是否会绕过这个队列？

**建议**：代理层的 `auth.refresh()` 应该**直接调用** `utils/api.js` 的 `request('refresh', ...)` 而不是自己发请求，这样就能复用现有的 token 刷新队列机制。

---

## 5. 结构性建议总结

| # | 建议 | 优先级 | 影响的 Phase | 类别 |
|---|------|--------|-------------|------|
| 1 | `stream.js` 回调接口预留 `onOpened`, `onPermissionRequest`, `onUsageUpdate`, `onElicitationRequest` 四个可选回调 | Critical | P3 | 接口设计 |
| 2 | `session.js` 增加 `usage()` 函数代理 `GET /sessions/{uuid}/usage` | Critical | P2 | 功能遗漏 |
| 3 | `session.js` 代理层明确 legacy action payload → facade envelope 的转换策略，特别处理 `session_status` vs `status` | Critical | P2 | 格式转换 |
| 4 | `auth.js` 的 `verifyToken()` 增加 app 冷启动校验的推荐使用说明 | Medium | P2 | 使用场景 |
| 5 | `me.js` 明确 `getProfile()` 和 `getMe()` 是同一接口的不同路由，确定归属模块 | Medium | P2 | 模块边界 |
| 6 | `me.js` 的 `createSession()` 和 `listSessions()` JSDoc 标注 pending session 不在列表中的行为 | Medium | P2 | 行为透明 |
| 7 | `stream.js` 自动持久化和恢复 `lastSeenSeq` | Medium | P3 | 可靠性 |
| 8 | 每个代理模块增加 `// NOT YET AVAILABLE` 注释块，列出对应缺失后端接口 | Medium | P2 | 开发者体验 |
| 9 | `catalog.js` JSDoc 标注当前后端返回空数组，代理层函数返回空数组而非 null | Medium | P2 | 优雅退化 |
| 10 | `permission.js` JSDoc 标注当前决策不实际拦截工具执行 | Medium | P2 | 语义正确 |
| 11 | `stream.js` JSDoc 标注当前 WS 是单向流，客户端消息不被消费 | Medium | P3 | 语义正确 |
| 12 | session 页面硬编码 base URL 应改为从 `apiRoutes.js` 读取 | High | P4 | 代码质量 |
| 13 | `apiRoutes.js` 增加 `requireAuth` 字段 | Medium | P1 | 代码质量 |
| 14 | `stream.js` 实现指数退避自动重连 + `last_seen_seq` 恢复 | Medium | P3 | 可靠性 |
| 15 | `auth.refresh()` 直接调用 `utils/api.js` 的 `request()` 以复用 token 刷新队列 | Low | P2 | 一致性 |
| 16 | 明确 e2e 测试技术方案（推荐 Node.js 直接 HTTP 测试 + mock wx.request） | Low | P4 | 测试 |

---

## 6. 对 Phase 执行顺序的调整建议

计划的 5 个 Phase 顺序基本合理，但有微调建议：

### 6.1 P1 与 P2 之间：增加 `apiRoutes.js` 增强

当前 Phase 1 只创建 `api/` 目录和重构 `utils/api.js`。建议在 P1 中同时增强 `apiRoutes.js`：
- 增加 `requireAuth` 字段
- 增加 `wsBaseUrl` 配置（解决 4.1 的硬编码问题）
- 可选增加 `responseShape` 字段（标注 `facade` 或 `legacy`，方便代理层统一转换）

### 6.2 P2 中 `session.js` 应最优先实现

5 个代理模块中，`session.js` 是最复杂的：
- 8 个 HTTP 函数 + 1 个 usage 函数（建议新增）
- 涉及 legacy vs facade envelope 转换
- 涉及 `session_status` vs `status` 字段映射
- 涉及 pending session 行为

建议实现顺序：`auth.js` → `session.js` → `me.js` → `permission.js` → `catalog.js`（计划中已是此顺序）。

### 6.3 P3 的 WS 封装应考虑重连逻辑

当前 P3-01 只封装 `connect/disconnect/getLastSeenSeq`，建议一并实现：
- 自动 `lastSeenSeq` 持久化
- 指数退避重连
- 重连后的事件补齐（通过 `session.resume()` HTTP 接口）

这些是 WS 可靠性的基础，应该在封装层而非页面层实现。

---

## 7. 被忽略的客户端代码细节

审查小程序源码发现了几个值得迁移时注意的细节：

### 7.1 `pages/session/index.js` 的 `handleStreamEvent` 已处理 5 种流事件类型

```javascript
// session/index.js 处理的事件类型
'llm.delta'          → 追加文本或开始工具调用
'tool.call.progress' → 日志记录
'tool.call.result'   → 更新工具结果
'turn.begin'         → 日志记录
'turn.end'           → 终结助手消息
'system.notify'      → 添加系统消息
'session.update'      → 忽略
```

但后端 agent-core 实际通过 WS 发出的事件类型还不止这些。审查 `agent-core/src/llm/session-stream-adapter.ts` 发现：
- `llm.request.started` → 映射为 `null`（不发送到客户端）
- `delta` → 映射为 `{kind: "llm.delta", content_type: "text", ...}`
- `tool_call` → 映射为 `{kind: "llm.delta", content_type: "tool_use_start", ...}`
- `finish` → 映射为 `null`（不发送到客户端）

**当前小程序的 `handleStreamEvent` 对 `content_type: "tool_use_start"` 的处理**：

```javascript
if (payload.content_type === 'tool_use_start') {
  // 尝试 JSON.parse(payload.content)，开始工具调用
}
```

这意味着 `tool.call.progress` 和 `tool.call.result` 事件类型实际上来自 agent-core 的内核runner，不是来自 agent-core 的 LLM 流适配器。小程序已经处理了这两种类型。

**建议**：`api/stream.js` 的事件转换应保持与 `handleStreamEvent` 相同的类型映射，不应引入新的事件类型（除非后端新增）。

### 7.2 `pages/chat/index.js` 的 session 列表展示逻辑

```javascript
// chat/index.js 的 listSessions 映射
sessions: result.sessions.map(s => ({
  session_uuid: s.session_uuid,
  status: s.status,       // 注意：从 facade envelope 来的
  last_seen_at: s.last_seen_at,
  created_at: s.created_at,
  last_phase: s.last_phase,
  // 注意：没有 conversation_uuid 和 ended_at
}))
```

`chat/index.js` 使用的是 `api.meSessionsList()`（通过 `api.meSessionsList()` helper），这个 helper 调用的是 `GET /me/sessions`，返回标准 facade envelope，字段名是 `status` 而不是 `session_status`。

但审查 `api-docs/me-sessions.md` 发现，列表中的 `status` 值只有 `starting`, `active`, `detached`, `ended`——没有 `pending`。这与 `POST /me/sessions` 返回的 `status: "pending"` 存在状态集不一致。

**建议**：`api/me.js` 的 `listSessions()` 应将可能的 `pending` 状态映射为 `starting` 或在 JSDoc 中标注此差异。

---

## 8. 审查结论

这份行动计划在**客户端侧的分层抽象**方面设计清晰，5 个 Phase 的推进顺序合理。主要问题集中在：

1. **对后端缺口的影响估计不足** — 计划正确地排除了尚未实现的接口（O5），但没有在代理层进行影响标注和接口预留
2. **WS 封装的设计前瞻性不够** — 只封装了当前存在的 4 种帧，没有为未来帧类型预留接口
3. **legacy → facade 转换的具体策略缺失** — 提到了统一转换，但没有详细规定转换规则
4. **session 相关的细节遗漏** — `usage()` 函数、pending session 行为、`session_status` vs `status` 的转换都需要更具体的方案

建议在执行前，针对上述 16 条建议**至少**落实 Critical 级别的 3 条（#1, #2, #3），再开始 Phase 2 的编码工作。

---

*审查完毕。*