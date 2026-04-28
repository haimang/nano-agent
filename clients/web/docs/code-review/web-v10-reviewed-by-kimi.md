# Nano-Agent 代码审查报告 — clients/web

> 审查对象: `clients/web` (vite + react web client)
> 审查类型: `code-review`
> 审查时间: `2026-04-28`
> 审查人: `kimi (independent)`
> 审查范围:
> - `clients/web/src/**/*`
> - `clients/web/functions/**/*`
> - `clients/web/package.json`, `vite.config.ts`, `index.html`
> 对照真相:
> - `clients/web/docs/charter/web-v10-foundations.md`
> - `clients/web/docs/closure/web-v10-closure.md`
> - `clients/api-docs/**/*.md` (6-worker backend contract baseline)
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`web-v10 foundations 主体骨架成立，但 chat mainline 的 WebSocket 连接生命周期存在 critical 级设计缺陷，且存在若干与 6-worker 后端契约不一致的 drift。当前不应标记为 completed。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `ChatPage.tsx 每次发送消息都会重建 WS 连接（而非复用），这完全违背了流式会话的持久连接语义，属于架构级错误。`
  2. `sendInput API body 中携带冗余的 session_uuid 字段，与后端契约 session.md §POST /input 不一致，存在 schema 漂移风险。`
  3. `缺少断线重连机制与 token 自动刷新，导致真实用户在弱网或 token 过期场景下体验断裂。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `clients/web/docs/charter/web-v10-foundations.md`
  - `clients/web/docs/closure/web-v10-closure.md`
  - `clients/api-docs/README.md`
  - `clients/api-docs/session.md`
  - `clients/api-docs/session-ws-v1.md`
  - `clients/api-docs/auth.md`
  - `clients/api-docs/me-sessions.md`
- **核查实现**：
  - `clients/web/src/pages/ChatPage.tsx`
  - `clients/web/src/App.tsx`
  - `clients/web/src/apis/sessions.ts`
  - `clients/web/src/apis/transport.ts`
  - `clients/web/src/apis/auth.ts`
  - `clients/web/src/state/auth.ts`
  - `clients/web/src/components/inspector/InspectorTabs.tsx`
  - `clients/web/src/client.ts`
  - `clients/web/functions/api/[[path]].ts`
- **执行过的验证**：
  - `read` 全部 clients/web/src 下 .ts/.tsx 文件
  - `read` 全部 clients/api-docs 下 .md 契约文件
  - `read` charter + closure 文档
  - 无 live build/test 执行（环境限制）
- **复用 / 对照的既有审查**：
  - `无` — 本次为独立审查，未参考 GLM、deepseek 等其他同事的分析结论

### 1.1 已确认的正面事实

- `main.tsx` + `App.tsx` + 组件树已取代 DOM demo，React shell 姿势切换完成
- `functions/api/[[path]].ts` BFF 通用代理已落地，HTTP 主链走同域 `/api/*`
- Auth → Session Nav → Chat Mainline 的最小非空链路存在
- Inspector tabs (status/timeline/history/usage) 已实现
- SettingsPage 已知限制列表已标注 truth
- `client.ts` 与 `heartbeat.ts` 保留了 legacy demo 的 WS 适配经验
- `ApiRequestError` 已覆盖 facade / legacy / debug 三类返回形状的差异

### 1.2 已确认的负面事实

- `ChatPage.tsx` 每次 `handleSend` 都会调用 `connectWs`，导致 WS 连接被反复重建
- `sendInput` API adapter 在 body 中附加了后端不期望的 `session_uuid`
- 没有实现 `session-ws-v1.md` §Reconnect recommendation 中的重连策略
- `AuthState.refreshToken` 存在于类型定义中但从未被消费
- `InspectorTabs.tsx` 的 `useEffect` 依赖数组包含状态自身，导致 tab 切换刷新行为异常
- `Topbar.tsx` 的 "Connected" 状态是静态硬编码，不与实际 WS 状态联动
- `theme.ts` 中定义的 `layout` 常量未被任何组件消费

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 所有引用均通过 Read 工具逐行确认 |
| 本地命令 / 测试 | no | 未执行 build/test（环境限制），但通过源码静态分析完成 |
| schema / contract 反向校验 | yes | 逐条对照 api-docs 契约文件与前端实现 |
| live / deploy / preview 证据 | no | 未访问 preview URL |
| 与上游 design / QNA 对账 | yes | 对照 charter/closure 的硬闸与 action-plan 逐项核对 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | ChatPage 每次发送消息都会重建 WS 连接 | critical | correctness | yes | 立即修复：将 WS 连接与消息发送解耦 |
| R2 | 缺少 WS 断线重连与退避机制 | critical | protocol-drift | yes | 按 session-ws-v1.md §Reconnect recommendation 实现 |
| R3 | sendInput body 携带冗余 session_uuid | high | protocol-drift | no | 移除 body 中的 session_uuid |
| R4 | ChatPage mutable state mutation | high | correctness | no | 改为 immutable update 模式 |
| R5 | started 状态与后端真实状态不同步 | high | correctness | no | 利用 /status 或 /timeline 推断 |
| R6 | InspectorTabs useEffect 依赖包含状态自身 | medium | correctness | no | 改用显式刷新触发器或 ref |
| R7 | Transport 未处理 fetch 网络层异常 | medium | correctness | no | 增加 try/catch 与离线错误分类 |
| R8 | App.tsx selectSession 存在竞态条件 | medium | correctness | no | 增加 AbortController 或取消令牌 |
| R9 | 缺少 access token 自动刷新机制 | medium | protocol-drift | no | 实现 refreshToken 消费逻辑 |
| R10 | ChatPage cleanup effect 为空实现 | medium | correctness | no | 在 effect cleanup 中调用 cleanupWs |
| R11 | WS URL 构建逻辑在 client.ts 与 ChatPage.tsx 重复 | low | delivery-gap | no | 提取到共用 util |
| R12 | Topbar "Connected" 为静态硬编码 | low | correctness | no | 接入真实 WS 状态或移除 |
| R13 | theme.ts layout 常量未被消费 | low | delivery-gap | no | 统一用 theme 常量替换 CSS 变量或删除 |
| R14 | ChatPage onStatusChange stale closure | low | correctness | no | 使用 ref 保存最新回调 |
| R15 | BFF CORS 设置过于宽松 | low | security | no | 移除不必要的 `access-control-allow-origin: *` |
| R16 | localStorage auth 无结构版本校验 | low | security | no | 增加 version/schema 校验 |
| R17 | ChatPage timeline 重建未覆盖所有 event kind | medium | correctness | no | 补充 tool_call、thinking 等 kind 处理 |
| R18 | 未消费已实现的 /me/conversations API | low | scope-drift | no | 评估是否纳入下一迭代或显式 defer |

---

### R1. ChatPage 每次发送消息都会重建 WS 连接

- **严重级别**：`critical`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `ChatPage.tsx:188-218`：`handleSend` 在成功调用 `startSession` 或 `sendInput` 后 unconditionally 调用 `connectWs(activeSessionUuid)`
  - `ChatPage.tsx:79-186`：`connectWs` 每次被调用都会 `cleanupWs()`（关闭旧连接）再 `new WebSocket(...)`
  - `session-ws-v1.md:138-143`：WS 连接应在 session 生命周期内保持，用于接收 stream event
- **为什么重要**：
  - WebSocket 在 nano-agent 架构中是 session stream 的承载层，其核心价值是"建立一次、持续接收"。当前实现把 WS 当成了"每次请求后打开、接收完关闭"的短连接，完全违背了流式架构的设计语义。
  - 这会导致：1) 每次发送消息都有额外的握手 RTT；2) 服务端 attachment 被反复创建/销毁；3) 在 start 到 input 的间隙可能丢失服务端事件；4) `last_seen_seq` 的追踪失去连续性。
- **审查判断**：
  - 这是 web-v10 F4 "Chat Mainline And Stream" 的核心实现缺陷。closure 声称 "WS stream ✅ Heartbeat + seq/ack + 流式输出渲染"，但实际上 WS 连接生命周期是错误的。该 claim 需要修正。
- **建议修法**：
  1. 将 `connectWs` 与 `handleSend` 解耦：`connectWs` 应在 `activeSessionUuid` 发生变化且需要连接时调用一次
  2. `handleSend` 仅负责 HTTP `startSession` / `sendInput`，不负责 WS 管理
  3. 在 `activeSessionUuid` 变为有效且 WS 未连接时，自动建立连接
  4. 在 session 切换或页面卸载时，才调用 `cleanupWs`

---

### R2. 缺少 WS 断线重连与退避机制

- **严重级别**：`critical`
- **类型**：`protocol-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `ChatPage.tsx:176-185`：socket `close` / `error` 事件仅调用 `cleanupWs()` 和 `setWsStatus("disconnected")`，没有重连逻辑
  - `session-ws-v1.md:138-143` 明确建议："本地记住收到的最大 event.seq → 重连时带 ?last_seen_seq → 如发现不一致，再补 POST /resume → 如仍不确定，以 GET /timeline 为最终对账入口"
  - `web-v10-foundations.md §10.1` 硬闸要求："chat mainline → stream/resume/timeline 的最小非空主链已可运行"；closure §2.4 声称 "Resume ✅ last_seen_seq 对接 + session.resume 帧发送"
- **为什么重要**：
  - 在真实网络环境中，WS 连接会因为网络切换、设备休眠、Cloudflare 边缘节点迁移等原因断开。没有重连机制意味着用户必须手动刷新页面或重新选择 session 才能恢复流式接收。
  - closure 的 "Resume ✅"  claim 只做到了在 `open` 时发送 `session.resume` 帧，但没有处理 connection loss 后的 recovery。
- **审查判断**：
  - 当前实现只有 happy-path 的流式展示，没有 resilience。这直接违反 charter §10.3 "NOT-成功退出识别" 第 3 条："聊天主链缺少 resume/reconnect/timeline 对账，只有 happy-path 流式展示" 不得宣称收口。
- **建议修法**：
  1. 在 `close` / `error` 事件后，延迟（指数退避）尝试重连
  2. 重连时携带正确的 `last_seen_seq`
  3. 重连后如果发现 seq 不连续，调用 `POST /resume` 或 `GET /timeline` 回补
  4. 设置最大重试次数，超过后标记为永久断开并提示用户

---

### R3. sendInput body 携带冗余 session_uuid

- **严重级别**：`high`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `apis/sessions.ts:64`：`body: JSON.stringify({ text, session_uuid: sessionUuid })`
  - `session.md:95-108`：`POST /sessions/{sessionUuid}/input` 的 request body 只要求 `"text": "continue"`，没有 `session_uuid` 字段
  - 当前后端可能静默忽略该字段（facade 从 path param 取 sessionUuid），但这属于前端向后端的 schema 漂移
- **为什么重要**：
  - 契约一致性是 BFF 分层的前提。如果后端后续增加 body schema 校验（例如引入 Zod），这个冗余字段可能导致 400 error。
  - 同时这暴露了前端开发者在对接 API 时没有严格遵循契约文档。
- **审查判断**：
  - 属于可以立即修复的低风险漂移。不是 blocker，但应在关闭前清理。
- **建议修法**：
  - `apis/sessions.ts:64` 改为 `body: JSON.stringify({ text })`

---

### R4. ChatPage mutable state mutation

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `ChatPage.tsx:144-146`：`last.content += payload.content` 直接修改 `messagesRef.current` 数组中的对象引用
  - `ChatPage.tsx:152-155`：`last.kind = "llm.complete"` 同样直接 mutation
  - 随后通过 `setMessages([...messagesRef.current])` 触发重新渲染
  - React 官方文档明确反对对 state 进行 mutation，即使通过 ref 绕过
- **为什么重要**：
  - 在 `StrictMode` 下（`main.tsx:7` 已启用），React 会故意 double-invoke某些函数来检测副作用。mutable update 可能导致不可预测的行为。
  - 同时，如果未来引入时间旅行调试、状态持久化或不可变状态管理（如 Zustand/Redux），这种 mutation 会成为迁移障碍。
- **审查判断**：
  - 当前功能上可能工作，但属于反模式。应在重构 WS 生命周期时一并修正。
- **建议修法**：
  - 使用 immutable update：`messagesRef.current = messagesRef.current.slice(); messagesRef.current[messagesRef.current.length - 1] = { ...last, content: last.content + payload.content };`
  - 或更优：彻底移除 `messagesRef`，完全依赖 React state 的 functional update 模式

---

### R5. started 状态与后端真实状态不同步

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `ChatPage.tsx:52`：`started` 是本地 useState，仅在 `handleSend` 中 `setStarted(true)`
  - `ChatPage.tsx:251`：刷新页面后，如果 timeline 有数据，`setStarted(true)` 被推断设置
  - `session.md:40-93`：`POST /start` 可能返回 `409 session-already-started`
  - 没有通过 `/status` 或 `durable_truth.last_phase` 来判断 session 是否已经 started
- **为什么重要**：
  - 用户在刷新页面后打开一个已经 started 的 session，如果 timeline 为空（例如服务端尚未写入事件），`started` 会保持 `false`。
  - 此时用户发送消息会触发 `startSession`，后端返回 409，用户看到错误。
  - 这是一个明确的运行时错误场景，影响 real client 的可用性。
- **审查判断**：
  - F4 声称 "start/input/resume/timeline/history shape 差异已处理"，但 `started` 的本地推断逻辑不完整。
- **建议修法**：
  1. 在 `activeSessionUuid` 变化时，通过 `GET /status` 获取 `durable_truth` 或 `phase`
  2. 如果 `phase !== "unattached"` 或存在 `started_at`，设置 `started = true`
  3. 或者，在 `startSession` 返回 409 时，优雅地设置 `started = true` 并继续流程

---

### R6. InspectorTabs useEffect 依赖包含状态自身

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `InspectorTabs.tsx:59`：`useEffect(() => {...}, [activeTab, sessionUuid, timelineData, historyData, usageData])`
  - 依赖数组中包含了 `timelineData`、`historyData`、`usageData`
  - 当某个 tab 的数据加载完成后（如 `setTimelineData(data)`），effect 会再次运行，但此时 `timelineData !== null`，不会触发新的 API 调用
- **为什么重要**：
  - 虽然不会导致无限循环（因为 null check 阻止了重复请求），但依赖数组设计不当：
  1. 当 `sessionUuid` 不变、用户切换到已加载过的 tab 再切换回来时，数据不会刷新（因为数据仍在内存中）
  2. 如果用户期望手动刷新，当前没有机制
  3. ESLint exhaustive-deps 规则会对此报错（如果配置了）
- **审查判断**：
  - 不影响 foundation 定义，但影响 inspector 的实用性。用户无法刷新 usage snapshot。
- **建议修法**：
  - 将数据状态从依赖数组中移除，改用 `useRef` 记录当前 sessionUuid 的已加载 tab 集合
  - 或增加显式的 "Refresh" 按钮，让用户决定何时重新加载

---

### R7. Transport 未处理 fetch 网络层异常

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `apis/transport.ts:86-89`：`const response = await fetch(url, {...})`
  - 该调用没有包裹在 `try/catch` 中
  - 如果网络完全离线、DNS 失败、或 BFF 未响应，`fetch` 会抛出异常，不会被 `ApiRequestError` 捕获
- **为什么重要**：
  - 当前所有调用 `transport.request()` 的地方都 `catch (err)` 并检查 `err instanceof ApiRequestError`。
  - 对于原生 fetch Error，前端会显示 "Unknown error" 或 console.error，而不是有意义的离线提示。
- **审查判断**：
  - 属于防御性编程缺口，应在 foundation 阶段补齐。
- **建议修法**：
  - 在 `transport.request` 中增加 `try { ... } catch (networkErr) { throw new ApiRequestError({ kind: "request.error", status: 0, message: "Network error: " + networkErr.message }) }`

---

### R8. App.tsx selectSession 存在竞态条件

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `App.tsx:64-74`：`selectSession` 是 `async` 函数，内部 `await sessionsApi.sessionStatus(auth, uuid)`
  - 如果用户快速点击两个不同的 session，第一个请求返回时可能覆盖第二个请求的 UI 状态
- **为什么重要**：
  - 在低延迟网络下不容易触发，但在高延迟（如移动端、跨区域）下会导致 inspector 显示错误的 session status。
- **审查判断**：
  - 标准的前端竞态问题，应在前端基础设施中建立模式。
- **建议修法**：
  - 使用 `AbortController` 取消过期的 `sessionStatus` 请求
  - 或在设置 `setSessionStatus` 前检查 `activeSessionUuid` 是否仍为请求时的 uuid

---

### R9. 缺少 access token 自动刷新机制

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `apis/auth.ts:5-8`：`AuthState` 包含 `refreshToken: string`
  - `apis/auth.ts` 中没有 `refresh()` 函数
  - `auth.md:170-194`：`POST /auth/refresh` 契约完整且已实现
  - `App.tsx:40-43`：token 过期时仅 `setAuthState(null)` 并重定向到 auth 页面
- **为什么重要**：
  - 用户在使用中如果 token 过期，会被强制登出。这对一个 real client 是不可接受的 UX。
  - closure K10 记录了 "Auth token 存储在 localStorage" 为 known issue，但没有记录 "缺少 refresh 机制"。
- **审查判断**：
  - 不是 foundation blocker，但应在 product iteration 早期解决。
- **建议修法**：
  - 实现 `authApi.refresh(refreshToken)` adapter
  - 在 `transport.request` 的 401 handler 中，尝试 refresh 一次，失败后再登出
  - 或使用定时器在 token 即将过期前主动刷新

---

### R10. ChatPage cleanup effect 为空实现

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `ChatPage.tsx:303-305`：第二个 `useEffect` 的 cleanup 函数是空的注释 `// cleanup handled by effect above`
  - `ChatPage.tsx:227-229`：第一个 `useEffect` 的 cleanup 调用了 `cleanupWs()`
  - 如果组件在第二个 effect 的异步操作（如 `sessionStatus` -> `timeline`）进行中卸载，可能导致 `setState on unmounted component`
- **为什么重要**：
  - 空 cleanup 意味着组件卸载时可能泄漏网络请求和状态更新。
  - 虽然 React 18 的自动批处理减轻了部分影响，但这仍是明确的 bug。
- **审查判断**：
  - 应在审查关闭前修复。
- **建议修法**：
  - 在第二个 `useEffect` 中使用 `useRef` 标记 mounted 状态，或在 cleanup 中取消 pending promise

---

### R11. WS URL 构建逻辑重复

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `client.ts:14-27`：定义了 `getWsBaseUrl()` 和 `UPSTREAM_WS_BASE`
  - `ChatPage.tsx:34-45`：定义了完全相同的 `getWsBaseUrl()` 和 `UPSTREAM_WS_BASE`
- **为什么重要**：
  - 如果上游 URL 变更，需要修改两处。
  - `client.ts` 仍在被引用（`main.ts` 中 `import { openSessionStream } from "./client"`），但产品 UI 走 `ChatPage.tsx` 自己的实现，这意味着 `client.ts` 已经是 dead code 的一部分。
- **审查判断**：
  - 技术债务，应在清理 legacy demo 代码时一并处理。
- **建议修法**：
  - 提取 `getWsBaseUrl` 到 `src/apis/ws.ts` 或 `src/utils/url.ts`
  - 统一 `client.ts` 和 `ChatPage.tsx` 的 WS 连接逻辑，避免两个并行的实现

---

### R12. Topbar "Connected" 为静态硬编码

- **严重级别**：`low`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `Topbar.tsx:7`：`<span style={styles.statusText}>Connected</span>`
  - `Topbar.tsx:5-8`：没有任何 props 或 context 接入
  - `ChatPage.tsx:51`：已经有 `wsStatus` 状态（"disconnected" | "connecting" | "connected"）
- **为什么重要**：
  - 用户在 WS 断开后仍看到 "Connected"，产生错误的安全感。
  - 这是虚假状态展示，属于 "UI 伪装" 的一种（尽管是 unintentional）。
- **审查判断**：
  - 违反 charter §4.4 truth-first 纪律。
- **建议修法**：
  - 将 `wsStatus` 通过 AppShell -> Topbar props 传递
  - 根据状态显示 "Connected" / "Connecting" / "Disconnected"
  - 或在未实现真实状态前，移除 "Connected" 文本，仅保留空 topbar

---

### R13. theme.ts layout 常量未被消费

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `theme.ts:52-66`：定义了 `layout.sidebar.width` (260) 等常量
  - `global.css:29-31`：使用 CSS 变量 `--sidebar-width: 260px`
  - 没有文件 `import { layout } from "./constants/theme"` 来消费这些值
- **为什么重要**：
  - 导致 theme 常量和 CSS 变量之间存在隐式同步依赖。修改一处不会自动更新另一处。
- **审查判断**：
  - 不是 blocker，但应统一主题系统：要么全用 CSS 变量，要么全用 JS 常量并在 style 对象中引用。
- **建议修法**：
  - 方案 A：删除 `theme.ts` 中的 `layout`（因为当前全用 CSS 变量）
  - 方案 B：让 `global.css` 从 `theme.ts` 导入值（需要 CSS-in-JS 或构建时注入）

---

### R14. ChatPage onStatusChange stale closure

- **严重级别**：`low`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `ChatPage.tsx:122-124`：`socket.addEventListener("open", () => { sessionsApi.sessionStatus(...).then(status => { onStatusChange(status) }) })`
  - `onStatusChange` 来自 props，被 `connectWs` 的 `useCallback` 捕获
  - `useCallback` 依赖 `[cleanupWs, addMessage, onStatusChange]`
  - 如果 `App.tsx` 的 `setSessionStatus` 函数引用在 `connectWs` 创建后发生变化（虽然 React setState 是稳定的，但 props 可能不是），会导致 stale closure
- **为什么重要**：
  - 当前因为 `setSessionStatus` 是稳定的，实际影响很小。但如果未来 `onStatusChange` 变成非稳定引用（例如包装了一层 useCallback with 变化的依赖），这会成为 bug。
- **审查判断**：
  - 防御性编程问题。
- **建议修法**：
  - 使用 `useRef` 保存最新的 `onStatusChange`，在 event listener 中读取 ref.current

---

### R15. BFF CORS 设置过于宽松

- **严重级别**：`low`
- **类型**：`security`
- **是否 blocker**：`no`
- **事实依据**：
  - `functions/api/[[path]].ts:33`：`responseHeaders.set("access-control-allow-origin", "*")`
  - `web-v10-foundations.md §4.5` 明确指出：HTTP 主路径应通过 same-origin BFF 收口
  - 既然 BFF 本身就是 same-origin 代理，浏览器不会触发跨域 preflight，`*` 是不必要的
- **为什么重要**：
  - `*` 允许任何网站通过 CORS 直接访问 BFF（虽然 BFF 本身需要 auth，但仍增加了攻击面）。
  - 如果未来 BFF 增加非 auth 路由（如 health check），`*` 会被动放大风险。
- **审查判断**：
  - 低风险，但应在安全硬化阶段清理。
- **建议修法**：
  - 对于 same-origin 场景，可以移除 `access-control-allow-origin` header，或设置为 `request.headers.get("origin")` 如果确实需要支持特定跨域

---

### R16. localStorage auth 无结构版本校验

- **严重级别**：`low`
- **类型**：`security`
- **是否 blocker**：`no`
- **事实依据**：
  - `state/auth.ts:8-18`：`loadPersisted()` 直接 `JSON.parse(raw) as AuthState`
  - 仅检查 `parsed.token && parsed.userUuid`
  - 没有版本号或 schema 校验
- **为什么重要**：
  - 如果未来 `AuthState` 增加新字段（如 `expiresAt`），旧 localStorage 数据仍然通过解析，可能导致使用过期 token。
  - 如果数据结构发生不兼容变更，前端会静默使用残缺的数据。
- **审查判断**：
  - 防御性缺口。
- **建议修法**：
  - 在 persisted 对象中增加 `v: number` 字段
  - 解析时检查版本，不匹配则清除并返回 null

---

### R17. ChatPage timeline 重建未覆盖所有 event kind

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `ChatPage.tsx:250-288`：timeline 重建只处理了 `role === "user" || kind === "user.input"`、`kind === "llm.delta"`、`kind === "session.update"`
  - 其他 kind（如 `tool_call`, `thinking`, `error` 等）被归类为 system 消息 `[${kind}]`
  - 后端可能发送的 event kind 不仅限于这些，且未来会增加
- **为什么重要**：
  - 虽然当前 fallback 到 system 消息是安全的，但这意味着用户无法看到 tool call 的详细内容或 thinking 块的展开/折叠。
  - 这会影响 richer chat UX 的后续迭代基础。
- **审查判断**：
  - 不影响 foundation，但应在下一迭代前设计 message kind 的扩展模式。
- **建议修法**：
  - 在 `MessageItem` 类型中增加更丰富的 kind 枚举
  - 对未知 kind 增加 debug 模式展示原始 payload

---

### R18. 未消费已实现的 /me/conversations API

- **严重级别**：`low`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `api-docs/README.md:78`：`/me/conversations` 已实现，返回 conversation 聚合列表
  - `apis/sessions.ts` 中只有 `/me/sessions`，没有 `/me/conversations`
  - `web-v10-foundations.md §4.2 O6` 中 `/me/conversations` 是 deferred，但 api-docs 显示它已实现
- **为什么重要**：
  - 当前前端按 session 列表导航，没有按 conversation 分组。这与后端提供的 conversation 语义不一致。
  - closure §2.3 T4 声称："`/me/sessions` 为 canonical source；`/me/conversations` 明确 deferred"，但 deferred 的理由（后端未实现）已经不再成立。
- **审查判断**：
  - 前端口径与后端现实之间出现了 drift。应评估是否将 conversation 导航纳入 web-v10+ 的 scope。
- **建议修法**：
  - 在下一迭代中增加 `/me/conversations` 消费，并评估 sidebar 是否应按 conversation 分组展示 session

---

## 3. In-Scope 逐项对齐审核

### 3.1 对照 closure §2 F0-F5 完成证据矩阵

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | F0 — Charter 与 action-plan 家族对齐 | done | 文档齐全，命名一致 |
| S2 | F1 — React app shell 姿势切换 | done | main.tsx + AppShell 已落地 |
| S3 | F2 — same-origin BFF 承接 HTTP | done | functions/api/[[path]].ts 已落地 |
| S4 | F3 — Auth → Session Nav 主链 | partial | Auth/Session 导航存在，但缺少 token refresh |
| S5 | F4 — Chat Mainline And Stream | partial | 流式展示存在，但 WS 生命周期错误（R1）、缺少重连（R2）、started 状态不同步（R5） |
| S6 | F5 — Inspector / Settings / Catalog / Health | done | 四标签 inspector 与辅助页面已落地 |
| S7 | F5 — 交付文档 | done | setup.md / deployment.md / api-contract.md 已产出 |
| S8 | F5 — Truth labeling | done | SettingsPage 已知限制列表完整 |

### 3.2 对齐结论

- **done**: `4`
- **partial**: `2` (F3 token refresh, F4 WS 生命周期)
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

> 这更像"核心骨架完成，但 chat mainline 的 transport 层存在 structural correctness 问题"，而不是 closure 所声称的 "WS stream ✅ Heartbeat + seq/ack + 流式输出渲染"。流式输出渲染确实成立，但 WS 连接管理不成立。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 完整 Open WebUI 产品能力复刻 | 遵守 | 前端未越界 |
| O2 | model/provider 真正可切换的产品面板 | 遵守 | SettingsPage 已标注为不可用 |
| O3 | 实时 permission / elicitation modal fully live | 遵守 | 未伪装为已上线 |
| O4 | 完整附件上传 / 下载 / 预览系统 | 遵守 | 未实现 |
| O5 | 多租户 admin console / billing / credits / org management | 遵守 | 完全未涉及 |
| O6 | 把 clients/web 纳入根 workspace | 遵守 | 仍在 workspace 外 |
| O7 | /me/conversations 消费 | 误报风险 | api-docs 显示后端已实现，但 closure 仍标记为 deferred。前端应评估是否更新口径 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `修复 R1：ChatPage.tsx 中 WS 连接与消息发送解耦，避免每次 send 都重建连接`
  2. `修复 R2：实现 WS 断线重连机制（至少基础版：close/error 后延迟重连，带 last_seen_seq）`
  3. `修复 R3：移除 sendInput body 中的冗余 session_uuid`
  4. `修复 R5：started 状态应利用后端 /status 或 /timeline 推断，避免对已 started session 重复调用 start`
- **可以后续跟进的 non-blocking follow-up**：
  1. `R4: immutable update 模式`
  2. `R6: InspectorTabs 刷新机制`
  3. `R7: transport 网络错误处理`
  4. `R8: selectSession 竞态取消`
  5. `R9: token refresh 自动刷新`
  6. `R10: ChatPage cleanup effect`
  7. `R12: Topbar 真实连接状态`
  8. `R16: localStorage auth 版本校验`
  9. `R18: /me/conversations 评估`
- **建议的二次审查方式**：`independent reviewer`（建议由不同于 Copilot/GLM/deepseek 的第四方复核 blocker 修复）
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待实现者按 §6 响应并修复 R1-R5 后再提交复核。

---

## 6. 实现者回应区

> （本节由实现者按 docs/templates/code-review-respond.md 追加，不修改 §0–§5）

*(Empty — awaiting implementer response)*

---

*End of review report*

---

## 附录 A. 审查质量评价

> 评价对象: `kimi — web-v10-closure code review`
> 评价人: `Copilot (post-fix evaluator)`
> 评价时间: `2026-04-28`

---

### A.0 评价结论

- **一句话评价**: `四位审查者中唯一发现了最关键架构 bug（WS 每次 send 重建连接）的审查者，以细粒度扫描和协议语义敏感性见长，但在跨层系统分析深度上略逊于 GPT。`
- **综合评分**: `8.5 / 10`
- **推荐使用场景**: WS/流式协议行为层审查、组件生命周期语义审查、发现"正在做错误的事"类问题（而非"缺少某项功能"）。
- **不建议单独依赖的场景**: 后端链路完整性（facade 层转发行为等跨层问题）；kimi 的审查边界止步于前端代码，未检查后端实现。

---

### A.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | WS/协议语义正确性 + 组件行为契约 | R1 指出 handleSend 每次调用 connectWs 违背"建立一次、持续接收"的流式连接语义 |
| 证据类型 | file:line 引用 + 协议文档逐条对照 | R2 同时引用 `ChatPage.tsx:176-185`、`session-ws-v1.md:138-143`、`web-v10-foundations.md §10.1` |
| Verdict 倾向 | 严格，但 blocker 边界清晰 | 将 R1（WS 重建）和 R2（无重连）列为 critical blocker，其余降为 high/medium |
| Finding 粒度 | 最细（18 个 finding） | 覆盖从架构级（R1 WS 生命周期）到防御性（R14 stale closure，R16 localStorage 版本） |
| 修法建议风格 | 步骤化、可操作 | R1 给出 4 步重构方向（解耦 connectWs/handleSend、自动建连、session 切换时清理）；R2 给出 4 步重连实现方案 |

---

### A.2 优点与短板

#### A.2.1 优点

1. **独家发现最高价值的架构 bug（R1）**：是四位审查者中唯一指出 `handleSend` 每次调用 `connectWs()` 导致 WS 连接被反复重建的问题。这是 foundation 阶段 chat 主链最严重的架构语义错误——其他三位审查者都关注到"没有重连"，却没有发现"WS 正在被主动过度销毁"。该 finding 已修复（解耦 connectWs 与 handleSend）。
2. **协议对照最精准（R3：sendInput 冗余字段）**：独家精确发现 `sessions.ts:64` 中 `session_uuid: sessionUuid` 与 `session.md POST /input` 契约不符，这是一个纯协议级别的 drift，其他三位均未发现。已修复。
3. **BFF 安全分析有独到视角（R15）**：指出 `access-control-allow-origin: *` 对于 same-origin BFF 是不必要的，暴露了对部署拓扑和安全边界的系统化思考，其他审查者只关注 OPTIONS 缺失。

#### A.2.2 短板 / 盲区

1. **缺少跨层分析**：GPT 发现了 orchestrator-core facade 在转发 WS 时不传递 `last_seen_seq` query，是一个前后端协议链路断点。kimi 的 R2 建议了"重连时携带 last_seen_seq"，但没有验证后端是否实际能接收到，这是审查边界的盲区。
2. **Session 切换状态重置问题表述不完整**：kimi 的 R5（started 状态与后端不同步）触及了相关问题，但没有像 GPT R2 那样完整描述"切换 session 时所有状态均未重置"的全貌，以及 `messagesRef/lastSeenSeqRef` 跨 session 污染的风险。
3. **部分低价值 finding 稀释注意力**：R13（theme.ts layout 未消费）、R14（stale closure）、R16（localStorage 无版本校验）等属于防御性提升，在 foundation 阶段优先级极低。在 18 个 finding 中，这类低信号 finding 占比相对较高，可能分散实现者注意力。

---

### A.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| R1 (WS 每次 send 重建连接) | critical | true-positive | excellent | 四位审查者独家，最高价值 finding，已修复 |
| R2 (WS 无重连机制) | critical | true-positive | excellent | 与其他三位一致，已修复 |
| R3 (sendInput 冗余 session_uuid) | high | true-positive | excellent | 独家发现，已修复 |
| R4 (mutable state mutation) | high | true-positive | good | 正确，deferred |
| R5 (started 与后端真实状态不同步) | high | true-positive | good | 正确，部分通过 session 切换重置修复；409 优雅降级 deferred |
| R6 (InspectorTabs useEffect 依赖) | medium | true-positive | good | 正确，已通过 sessionUuid 变化 data 清空修复 |
| R7 (Transport fetch 网络异常未处理) | medium | true-positive | good | 正确，deferred |
| R8 (selectSession 竞态) | medium | true-positive | good | 正确，deferred |
| R9 (token refresh 缺失) | medium | true-positive | mixed | 正确，但 foundation 阶段 deferred；blocker 定级稍高 |
| R10 (ChatPage cleanup effect 空) | medium | true-positive | good | 正确，deferred |
| R11 (WS URL 构建重复) | low | true-positive | good | 正确，deferred |
| R12 (Topbar 硬编码) | low | true-positive | good | 已修复 |
| R13 (theme.ts layout 未消费) | low | true-positive | mixed | 正确但价值极低 |
| R14 (stale closure) | low | true-positive | mixed | 理论上正确，实践中影响极小 |
| R15 (BFF CORS 过宽) | low | true-positive | mixed | 有洞察价值，same-origin 下实际风险低 |
| R16 (localStorage 无版本校验) | low | true-positive | mixed | 防御性建议，低优先级 |
| R17 (timeline 未覆盖所有 event kind) | medium | true-positive | good | 正确，属后续迭代扩展项 |
| R18 (/me/conversations 未消费) | low | true-positive | mixed | Scope drift 识别正确，但 closure 已明确 deferred |

**关键遗漏（未发现）**:
- Facade 不转发 `last_seen_seq` 到 User DO（GPT R3 后端层面）
- Session 切换时完整的 chat/inspector 状态重置（GPT R2 的完整描述）
- BFF query string `split("=")` 解析 bug（GLM R9）
- `catalogApi` dead import（DeepSeek R9）
- BFF CORS OPTIONS 处理缺失（GLM R2）

---

### A.4 多维度评分

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 8 | 18 个 finding 均有 file:line 支撑；协议文档引用精准 |
| 判断严谨性 | 8 | 18 个全部 true-positive；个别 blocker 定级略高（R9） |
| 修法建议可执行性 | 8 | R1/R2 给出清晰的步骤化重构方向，可执行性强 |
| 对 action-plan / design / QNA 的忠实度 | 8 | 对照 charter §10.3 的"非成功退出识别"条款最为准确 |
| 协作友好度 | 7 | 18 个 finding 总量较大，低价值 finding 影响阅读优先级 |
| 找到问题的覆盖面 | 9 | 在前端代码层覆盖最全面；R1 独家发现是本轮最高价值 finding |
| 严重级别 / verdict 校准 | 8 | R1 定 critical 完全正确；少数低优先级 finding 可降级 |
