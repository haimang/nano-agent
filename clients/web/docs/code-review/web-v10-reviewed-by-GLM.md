# Nano-Agent 代码审查模板

> 审查对象: `clients/web` (web-v10 foundations 实现)
> 审查类型: `code-review`
> 审查时间: `2026-04-28`
> 审查人: `GLM`
> 审查范围:
> - `clients/web/src/` 全部源码 (apis, components, pages, state, constants, hooks, styles)
> - `clients/web/functions/api/[[path]].ts` BFF 层
> - `clients/web/vite.config.ts`, `package.json`, `tsconfig.json`, `index.html`
> 对照真相:
> - `clients/web/docs/charter/web-v10-foundations.md` (基石纲领)
> - `clients/web/docs/closure/web-v10-closure.md` (关闭报告)
> - `clients/web/docs/api-contract.md` (API 契约)
> - `clients/api-docs/` (权威 API baseline)
> - 6-worker 后端架构 (orchestrator-core public facade)
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`web-v10 foundations 实现的主体骨架成立，但存在若干需要立即修复的断点、逻辑缺陷和安全盲点，其中 auth 状态双源分裂、WS 无重连、token 无刷新、BFF preflight 缺失四个问题构成最高优先级。当前不应标记为 fully complete，应修正后重新验证。`
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. **Auth 状态双源分裂**：`apis/auth.ts` 和 `state/auth.ts` 各自维护独立的 `currentAuth` 变量，两者可以不同步，导致 ChatPage 使用的 token 可能与 App.vue 的 auth 状态不一致——这是 correctness 层面的 blocker。
  2. **WebSocket 无重连机制**：closure §2.5 声称 resume/reconnect/timeline 对账已实现（✅），但实际 ChatPage 中 WS 断开后仅显示 disconnected 状态，不自动重连——这是 charter §7.5 "什么不算完成" 的定义："只有 WS happy path，没有 resume/reconnect/timeline 对账"。
  3. **BFF 缺少 CORS preflight 处理**：`functions/api/[[path]].ts` 不响应 OPTIONS 请求，浏览器对 POST + JSON body + 自定义 header 的预检请求将收到 405 或直接失败——这在生产环境会导致所有写操作失效。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `clients/web/docs/charter/web-v10-foundations.md`
  - `clients/web/docs/closure/web-v10-closure.md`
  - `clients/web/docs/api-contract.md`
  - `clients/api-docs/` (auth.md, session.md, session-ws-v1.md, usage.md, permissions.md, catalog.md, worker-health.md, README.md)
- **核查实现**：
  - `clients/web/src/` 全部源文件（已逐行阅读）
  - `clients/web/functions/api/[[path]].ts`（已逐行阅读）
  - `clients/web/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`
  - `clients/web/src/apis/` (transport.ts, auth.ts, sessions.ts, catalog.ts, debug.ts)
  - `clients/web/src/state/` (auth.ts, sessions.ts)
  - `clients/web/src/pages/` (AuthPage.tsx, ChatPage.tsx, SettingsPage.tsx, CatalogPage.tsx, HealthPage.tsx)
  - `clients/web/src/components/` (AppShell.tsx, Sidebar.tsx, Topbar.tsx, MainPanel.tsx, InspectorPanel.tsx, SessionList.tsx, inspector/InspectorTabs.tsx)
  - `clients/web/src/client.ts`, `heartbeat.ts`, `App.tsx`, `main.tsx`, `main.ts`
- **执行过的验证**：
  - 逐行代码审查，追踪数据流、状态流、控制流
  - API 契约与前端实现逐接口对账
  - WS 协议前端实现与 `session-ws-v1.md` 对账
  - 6-worker 后端 facade 路由与前端 BFF 代理路径对账
  - Auth 生命周期（注册→登录→token 存取→刷新→过期处理）端到端追踪
- **复用 / 对照的既有审查**：
  - 无——本次为独立审查，未参考其他 reviewer 的分析。

### 1.1 已确认的正面事实

- React app shell 已完全取代旧 demo 入口（`main.tsx` 为入口，`main.ts` 标注为 retired）。
- 同源 BFF 代理已建立（`functions/api/[[path]].ts`），HTTP 主路径走 `/api/*`。
- Auth 主链（register/login/me/logout）流程可运行。
- Session 导航（list/create/switch）流程可运行。
- Chat 主链可运行（start → input → WS stream → timeline → resume ack）。
- Inspector 四标签（status/timeline/history/usage）已实现。
- 辅助页面（Catalog/Health/Settings）已实现，且 Settings 页面诚实标注了 known limitations。
- HeartbeatTracker 与 WS seq/ack 机制已实现。
- 页面 visual 设计遵循 dark mode token 系统。
- closure 声称的 F1-F5 full close 硬闸在骨架层面确实满足。

### 1.2 已确认的负面事实

- Auth 状态存在两套独立的内存存储，且注册流程中只有一套被写入。
- WS 断开后无自动重连，closure 声称的 reconnect 能力未实际实现。
- BFF 不处理 CORS preflight OPTIONS 请求。
- Token 过期后直接登出用户，不尝试 refresh（后端 `/auth/refresh` 端点已存在但前端未实现）。
- `client.ts` 与 `ChatPage.tsx` 存在重复的 WS 连接逻辑且 `client.ts` 未被 React 应用使用。
- 硬编码 upstream URL 散布在 4 个文件中。
- Inspector 数据仅加载一次，不随 session 状态变化刷新。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 所有发现均以 file:line 引用 |
| 本地命令 / 测试 | no | 未执行 build/dev，仅代码审查 |
| schema / contract 反向校验 | yes | 与 clients/api-docs/ 对账 |
| live / deploy / preview 证据 | no | 未部署验证 |
| 与上游 design / QNA 对账 | yes | 与 charter 及 closure 对账 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | Auth 状态双源分裂 | critical | correctness | yes | 合并为单一 auth state，消除 `apis/auth.ts` 中的独立 `currentAuth` |
| R2 | BFF 缺少 CORS preflight 处理 | critical | platform-fitness | yes | 在 `[[path]].ts` 添加 OPTIONS 响应或部署 Pages Functions CORS middleware |
| R3 | WebSocket 无重连机制 | high | correctness | yes | 实现 WS close/error 后的指数退避重连，配合 `last_seen_seq` 对账 |
| R4 | Token 过期无 refresh 机制 | high | delivery-gap | yes | 实现 `/auth/refresh` 调用，在 401 时先尝试 refresh 再 fallback 到 logout |
| R5 | 硬编码 upstream URL 散布四处 | medium | scope-drift | no | 抽取为统一常量/环境变量，消除 `transport.ts`, `client.ts`, `ChatPage.tsx`, `main.ts` 中的重复硬编码 |
| R6 | `client.ts` 废弃代码与 ChatPage WS 逻辑重复 | medium | delivery-gap | no | 清理 `client.ts`，或将 ChatPage 的 WS 逻辑提取到可复用模块 |
| R7 | ChatPage 中消息数组可变操作 | medium | correctness | no | 重构为不可变操作模式，消除 `messagesRef.current` 的直接修改 |
| R8 | Inspector 数据不随 session 刷新 | medium | correctness | no | 在 tab 切回时或 session 状态变化时重新 fetch |
| R9 | BFF query string 解析在 value 含 `=` 时会截断 | medium | platform-fitness | no | 使用 `URL` 和 `URLSearchParams` 代替手动 `split("=")` |
| R10 | `hooks/` 目录为空——非 React hook 的 `useAuth` | low | test-gap | no | 重命名 `useAuth` 为普通函数或实现真正的 React hook；填充 hooks 目录 |
| R11 | Topbar 硬编码 "Connected" 状态 | low | docs-gap | no | 绑定到实际 WS 连接状态或 auth 状态 |
| R12 | `main.ts` 废弃 demo 仍可能被打包 | low | platform-fitness | no | 从 vite 构建入口排除或移除 `main.ts` 和 `styles.css` |
| R13 | `register()` 函数无部分失败恢复 | medium | correctness | no | 若 register 成功但 login 失败，用户处于未登录但已注册的不一致状态 |
| R14 | WS `stream_uuid: "main"` 硬编码 | low | protocol-drift | no | 从后端 WS 协议获取或从事件动态提取 stream_uuid |
| R15 | Envelope 类型安全不足 | low | correctness | no | 引入 Zod/io-ts 运行时验证或至少 narrow typing 减少 `as` 断言 |

### R1. Auth 状态双源分裂

- **严重级别**：`critical`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `src/apis/auth.ts:10` 维护模块级 `let currentAuth: AuthState | null = null`，提供 `getAuth()`, `setAuth()`, `requireAuth()`。
  - `src/state/auth.ts:5` 维护另一独立模块级 `let currentAuth: AuthState | null = null`，提供 `getAuthState()`, `setAuthState()`, `subscribeAuth()`, `useAuth()`。
  - `src/pages/AuthPage.tsx:31` 调用 `setAuthState(auth)` (state/auth.ts)，但 `src/apis/auth.ts:74` 的 `login()` 函数内部调用 `currentAuth = auth` (apis/auth.ts 的)，这两处写入不同的变量。
  - `src/apis/sessions.ts` 的 `authHeaders()` 调用 `authApi.requireAuth()` 获得 `apis/auth.ts` 中的 token，但 App.tsx 中的 auth 判断使用 `state/auth.ts` 的 `getAuthState()`。
  - `src/apis/auth.ts:86-88` 的 `logout()` 只清除了 `apis/auth.ts` 的 `currentAuth`，未清除 `state/auth.ts` 的 localStorage 持久化数据。
- **为什么重要**：
  - 两个独立来源的 auth 状态会在以下场景分裂：register 调用路径（只写入了 apis/auth.ts 的 currentAuth，未写入 state/auth.ts），logout 路径（只清除了 apis/auth.ts），token 刷新场景。
  - 当 `App.tsx` 读 `state/auth.ts` 认为"已登录"，但 `sessions.ts` 读 `apis/auth.ts` 发现 `requireAuth()` 为 null 时，将抛出 "login first" 错误。
- **审查判断**：
  - 这是一个 correctness blocker。auth 是所有后续操作的前提，如果 token 获取路径不一致，整个客户端的可运行性就无法保证。
- **建议修法**：
  - 删除 `apis/auth.ts` 中的 `currentAuth` / `getAuth()` / `setAuth()` / `requireAuth()` 状态管理。
  - 统一使用 `state/auth.ts` 作为唯一 auth state 源。
  - 让 `sessions.ts` 和其他 API 模块通过 `state/auth.ts` 的 `getAuthState()` 获取 token。
  - 确保 `logout()` 清除 `state/auth.ts` 的持久化数据。

### R2. BFF 缺少 CORS preflight 处理

- **严重级别**：`critical`
- **类型**：`platform-fitness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `functions/api/[[path]].ts` 是一个 catch-all 处理器，仅处理 `onRequest`。
  - Cloudflare Pages Functions 默认不自动处理 OPTIONS 请求。
  - 前端在 `transport.ts` 中设置 `content-type: application/json` 和 `authorization: Bearer <token>` 请求头。
  - 浏览器在跨域情况下（即使 BFF 是同源的，但本地开发时 Vite 开发服务器与预览后端是跨域的）会对 POST + JSON + 自定义 header 发送 OPTIONS preflight。
  - 更重要的是：当 `Transport` 的 `useBff` 为 `false`（直接打 upstream）时，CORS headers 来自 BFF 代理无法覆盖浏览器的 preflight 需求。
  - 即使在 BFF 同源场景下，Cloudflare Pages Functions 也需要显式处理 OPTIONS 方法。
- **为什么重要**：
  - 如果 BFF 不响应 OPTIONS，浏览器的 CORS preflight 请求会返回 405 或 404，导致所有 POST 请求（login, register, start, input 等）被浏览器拦截。
  - 这意味着整个写入链路在标准浏览器环境下无法工作。
- **审查判断**：
  - 这是一个 production blocker。在 Cloudflare Pages 部署后，除非 browsers 不发 preflight（同源 + 简单请求），否则所有非 GET 写操作都会失败。
  - 注：如果前端和 BFF 完全同源，简单 GET 请求可以工作（因为 `content-type` 默认不受限），但带 `Authorization` header 的 GET 也会触发 preflight。
- **建议修法**：
  - 在 `[[path]].ts` 中添加 OPTIONS 方法处理，返回 CORS headers + 204。
  - 或者添加一个单独的 `OPTIONS` handler 在 Pages Functions 路由中。
  - 同时考虑将 CORS `access-control-allow-origin` 从 `*` 收窄到具体 origin（白名单）。

### R3. WebSocket 无重连机制

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `src/pages/ChatPage.tsx:176-185`：WS `close` 和 `error` 事件回调仅设置 `wsStatus("disconnected")` 和调用 `cleanupWs()`，没有任何重连逻辑。
  - Charter §7.5 明确定义 "什么不算完成"：「只有 WS happy path，没有 resume/reconnect/timeline 对账」。
  - Closure §2.5 声称 "Resume: `last_seen_seq` 对接 + `session.resume` 帧发送"，但实际上 `resume` 帧只在 `open` 事件时发送一次（`ChatPage.tsx:117-120`），而不是断线后重连时。
  - 当 WS 因网络波动断开后，用户只能看到 "disconnected" 状态，无法恢复流式输出，必须手动刷新页面。
- **为什么重要**：
  - Chat 是 web-v10 的核心主线。WS 断连是真实网络环境中必然会发生的事件（移动网络、NAT 超时、服务器重启等）。
  - 没有重连能力的 Chat 在生产环境中几乎不可用——网络抖动就等于对话中断。
- **审查判断**：
  - 这属于 charter §7.5 的 "什么不算完成" 定义范围。closure 将其标记为 ✅ 是不准确的。
- **建议修法**：
  - 实现 WS 断连后的指数退避重连（exponential backoff reconnect）。
  - 重连时使用 `last_seen_seq` 发送 `session.resume` 帧。
  - 重连后可选调用 `/sessions/{uuid}/timeline` 进行增量对账。
  - 在 UI 上显示重连状态（"Reconnecting..." / "Reconnected"）。

### R4. Token 过期无 refresh 机制

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `src/apis/transport.ts:110`：当 HTTP 状态为 401 时，直接将其归类为 `auth.expired`。
  - `src/App.tsx:40-42`：当 `ApiRequestError` 的 `details.kind === "auth.expired"` 时，直接清除 auth 并跳转到登录页。
  - 后端 API 文档 `auth.md` 明确存在 `POST /auth/refresh` 端点，接受 `refresh_token` 并返回新 token。
  - 前端 `apis/auth.ts` 中 `AuthState` 类型包含 `refreshToken` 字段（`auth.ts:5`），但从未使用过。
  - `state/auth.ts:13` 持久化时也保存了 `refreshToken`，但没有任何代码读取它来刷新 token。
- **为什么重要**：
  - Access token 有 1 小时有效期（根据 API 文档 `exp: 3600`）。
  - 1 小时后用户被强制登出，没有任何恢复途径。
  - 对于真实使用场景，这是不可接受的体验——用户需要每小时重新登录一次。
- **审查判断**：
  - `/auth/refresh` 是后端已实现的能力，前端应利用它。
  - 缺少 refresh 机制使得 auth 主链在长时间使用场景下断裂。
- **建议修法**：
  - 在 `transport.ts` 中实现 401 拦截：先尝试 `/auth/refresh`，成功则用新 token 重试原始请求。
  - 在 `state/auth.ts` 中暴露 `refreshToken`。
  - 考虑 token 过期前主动 refresh（如剩余 5 分钟时）。

### R5. 硬编码 upstream URL 散布四处

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `src/apis/transport.ts:2`：`DEFAULT_UPSTREAM = "https://nano-agent-orchestrator-core-preview.haimang.workers.dev"`
  - `src/client.ts:14`：`UPSTREAM_WS_BASE = "wss://nano-agent-orchestrator-core-preview.haimang.workers.dev"`
  - `src/pages/ChatPage.tsx:34`：`UPSTREAM_WS_BASE = "wss://nano-agent-orchestrator-core-preview.haimang.workers.dev"`
  - `src/main.ts:8`：`DEFAULT_BASE_URL = "https://nano-agent-orchestrator-core-preview.haimang.workers.dev"`
  - `functions/api/[[path]].ts:3`：`UPSTREAM_BASE_URL = "https://nano-agent-orchestrator-core-preview.haimang.workers.dev"`
- **为什么重要**：
  - charter §1.3 D2 规定技术栈为 Cloudflare Pages + Vite + React，任何 upstream 变更需要同步修改 5 个位置。
  - client.ts 和 ChatPage.tsx 的 WS URL 必须同步，但它们是独立硬编码的。
  - 这违反了 charter §4.4 "facade-first" 原则——虽然这里不是绕过 facade，但 URL 统一管理是 facade-first 的基本要求。
- **审查判断**：
  - 不是 blocker，但是显著的维护风险。
- **建议修法**：
  - 抽取为 `constants/upstream.ts` 统一管理。
  - WS URL 应从 HTTP base URL 推导（替换 protocol），而非独立硬编码。
  - 确保 BFF 场景下 WS URL 也能正确生成。

### R6. `client.ts` 废弃代码与 ChatPage WS 逻辑重复

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `src/client.ts` 包含完整的 `openSessionStream()` 函数，含 heartbeat、seq/ack、resume 帧逻辑。
  - `src/pages/ChatPage.tsx:79-186` 独立重新实现了完全相同的 WS 连接逻辑（heartbeat、seq/ack、resume）。
  - `src/main.ts:2` 注释说明 "Retired DOM demo — no longer the canonical UI entry"，但 `client.ts` 未标注退役。
  - 两者使用不同的 WS base URL 来源：`client.ts` 从 `import.meta.env` + `localStorage` 获取，`ChatPage.tsx` 从 `import.meta.env` 获取（不检查 localStorage）。
  - `client.ts` 和 `ChatPage.tsx` 的 heartbeat 参数不一致：`client.ts` 使用 `HeartbeatTracker` 的 `interval` getter（`15_000`），`ChatPage.tsx` 也硬编码 `15_000`，但如果 HeartbeatTracker 默认值变化，ChatPage 不会跟随。
- **为什么重要**：
  - 维护两份 WS 逻辑是技术债，修改协议细节时需要改两处。
  - `client.ts` 看似是可复用的模块，但实际上 React 应用完全没用它。
- **建议修法**：
  - 决策：要么将 ChatPage 的 WS 逻辑提取到 `client.ts` 或新的 `useWebSocket` hook，要么彻底移除 `client.ts`。
  - 如果保留 `client.ts` 作为参考，应明确标注 `@deprecated` 并在注释中说明它不被 React 应用使用。

### R7. ChatPage 中消息数组可变操作

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `ChatPage.tsx:60`：`const messagesRef = useRef<MessageItem[]>([])` 创建了一个 mutable ref。
  - `ChatPage.tsx:144-146`：`last.content += payload.content` 直接修改数组中已有对象的属性。
  - `ChatPage.tsx:152-154`：`last.kind = "llm.complete"` 和 `last.seq = parsed.seq` 也是直接修改。
  - `ChatPage.tsx:267-269`（timeline 恢复中）：同样的 `last.content += content` 可变修改。
  - `messagesRef.current = [...messagesRef.current]` 配合 `setMessages([...messagesRef.current])` 的模式试图模拟不可变更新，但实际上在 `.content +=` 之前 `setMessages` 时，React 可能还没渲染出最新的 content。
- **为什么重要**：
  - React 的 reconciliation 依赖引用比较。直接修改已有 message 对象的属性可能导致 React 不重新渲染（因为引用没变）。
  - 在高频率的 stream delta 事件中，这可能导致消息丢失或渲染闪烁。
- **建议修法**：
  - 使用不可变操作：创建新的 message 对象而非修改已有的。
  - 或者引入 `useReducer` 统一管理消息状态。

### R8. Inspector 数据不随 session 刷新

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `InspectorTabs.tsx:36-58`：`useEffect` 的依赖项包含 `timelineData`, `historyData`, `usageData`，一旦数据被设置为非 `null`，就不会再重新 fetch。
  - 即使 WS 收到新事件导致 session 状态变化（如新消息、新 usage），Inspector 中的 timeline/history/usage 标签仍显示首次加载时的数据。
  - 没有 "刷新" 按钮或自动刷新机制。
- **为什么重要**：
  - Inspector 的核心用途是实时观察 session 状态。如果数据只加载一次，它在长时间对话中几乎无用。
- **建议修法**：
  - 在 tab 切回时重新 fetch（将数据设为 null 后重新加载）。
  - 或添加手动 "刷新" 按钮。
  - 或在 WS 收到新事件时标记 Inspector 数据为 stale。

### R9. BFF query string 解析在 value 含 `=` 时会截断

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `functions/api/[[path]].ts:14-18`：
    ```typescript
    request.url.split("?")[1]
      ?.split("&")
      .forEach((p) => {
        const [k, v] = p.split("=");
        if (k) url.searchParams.set(k, v ?? "");
      });
    ```
  - `p.split("=")` 在值包含 `=` 字符时（如 base64 编码的值）会截断。
  - JWT token 包含 base64 payload，其中 `=` 是合法字符，虽然 token 通常通过 header 而非 query string 传递，但 `trace_uuid` 也可能在特殊编码中包含 `=`。
- **为什么重要**：
  - 虽然 WS 的 `access_token` 是通过 query string 传递的（不走 BFF），但其他 query string 参数可能受到影响。
  - 更重要的是，这段代码展示了对 URL 解析的不严谨态度。
- **建议修法**：
  - 使用 `URL` 和 `URLSearchParams` API：
    ```typescript
    const sourceUrl = new URL(request.url);
    for (const [k, v] of sourceUrl.searchParams) {
      url.searchParams.set(k, v);
    }
    ```

### R10. `hooks/` 目录为空——非 React hook 的 `useAuth`

- **严重级别**：`low`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `src/hooks/` 目录为空（无文件）。
  - `src/state/auth.ts:43-45`：`export function useAuth(): AuthState | null { return currentAuth; }` 这个函数名为 `useAuth` 但不是真正的 React hook——它不使用任何 React API（useState, useContext 等），不会触发 re-render。
  - 如果组件调用 `useAuth()`，它不会在 auth 状态变化时重新渲染。
  - 所有依赖 auth 状态的组件（`App.tsx`, `ChatPage.tsx`, `InspectorTabs.tsx`）都是通过 `getAuthState()` 一次性获取或在 effect 中使用，不会响应 auth 变化。
- **为什么重要**：
  - `useAuth` 的命名具有误导性——开发者可能认为它是 React hook，期望在 auth 变化时自动 re-render，但它没有这个行为。
  - 当 auth token 被刷新（R4 修复后）时，所有使用旧 token 的组件不会自动感知到变化。
- **建议修法**：
  - 要么实现真正的 React context + `useAuth` hook（使用 `subscribeAuth` listener）。
  - 要么重命名 `useAuth` 为 `getAuthState` 避免误导。
  - 填充 `hooks/` 目录，提取 `useWebSocket`、`useAuth`、`useSession` 等。

### R11. Topbar 硬编码 "Connected" 状态

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `src/components/Topbar.tsx:6-8`：永远显示绿色圆点和 "Connected" 文字。
  - ChatPage 中有真实的 WS 连接状态（`wsStatus`），但 Topbar 不接收也不显示它。
- **为什么重要**：
  - 绿色 "Connected" 状态是一个虚假承诺——如果 WS 断连、auth 过期、或后端不可达，Topbar 仍显示 "Connected"。
  - 这违反了 charter §4.4 "truth-first" 纪律。
- **建议修法**：
  - 将 WS 连接状态和 auth 状态传递到 Topbar，显示真实连接状态。
  - 或改为中性的 "nano-agent" 标识，不暗示连接状态。

### R12. `main.ts` 废弃 demo 仍可能被打包

- **严重级别**：`low`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `src/main.ts` 和 `src/styles.css` 是旧 DOM demo 的残留代码。
  - `vite.config.ts` 未排除 `main.ts`。
  - 虽然入口是 `main.tsx`（在 `index.html` 中指定），`main.ts` 不会被自动执行，但它仍会被 TypeScript 编译（因为 `tsconfig.json` 的 `include` 配置是 `src/**/*.ts`）。
  - `main.ts` 中的 `import { openSessionStream } from "./client"` 和 `import "./styles.css"` 会被 tree-shaking 移除，但增加了执行 `tsc --noEmit` 时的依赖链复杂度。
- **建议修法**：
  - 将 `main.ts` 重命名为 `main.ts.deprecated.ts` 或移至 `docs/legacy/`。
  - 或在 `tsconfig.json` 中排除 `src/main.ts`。

### R13. `register()` 函数无部分失败恢复

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `src/apis/auth.ts:27-37`：`register()` 函数先调用 `POST /auth/register`，成功后直接调用 `login()`。
  - 如果 `register` 成功（用户已创建）但 `login` 失败（网络错误、服务端 5xx 等），用户已经存在于后端，但前端显示注册失败。
  - 用户再次尝试注册时会得到 "user already exists" 错误，再次尝试登录时需要重新输入凭证——但凭证可能正确，问题只是临时网络故障。
- **为什么重要**：
  - 这导致一种糟糕的 UX：用户"注册成功"了但被告知失败，后续尝试注册同一个 email 又失败。
- **建议修法**：
  - `register()` 应该返回后端响应中的 token 信息（如果后端 register 直接返回 token）。
  - 或在 `register` 成功后 `login` 失败时，显示"注册成功，请手动登录"而非通用错误。
  - 或拆分注册和登录为两步 UI 流程。

### R14. WS `stream_uuid: "main"` 硬编码

- **严重级别**：`low`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `src/client.ts:74`：`body: { stream_uuid: "main", acked_seq: parsed.seq }`
  - `src/pages/ChatPage.tsx:136`：`body: { stream_uuid: "main", acked_seq: parsed.seq }`
  - 两处都硬编码 `"main"` 作为 stream_uuid。
  - 后端 WS 协议文档未说明 stream_uuid 是否有其他值，但硬编码可能导致未来协议扩展时断裂。
- **建议修法**：
  - 从 WS 打开时的响应或初始事件中提取 stream_uuid。
  - 或定义为常量并加注释说明后端当前只使用 "main"。

### R15. Envelope 类型安全不足

- **严重级别**：`low`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `src/apis/transport.ts`：`ApiResponse = FacadeSuccessEnvelope | LegacyActionPayload | Record<string, unknown>` — 过于宽泛的联合类型。
  - `src/apis/sessions.ts:30-35`：`"data" in body ? (body as { data: ... }).data : body` — 多处使用 `in` 检查 + `as` 类型断言。
  - `src/apis/auth.ts:46-52`：类似模式。
  - `src/pages/ChatPage.tsx:240-242`：`(status as { durable_truth?: ... }).durable_truth` 直接类型断言。
  - 没有运行时 schema 验证——如果后端返回意外字段名或结构变化，前端会静默地使用 `undefined`。
- **为什么重要**：
  - 后端 API 存在两种 envelope（facade 和 legacy），如果 field 名变化，前端不会报错也不会降级，只会显示空白或异常。
- **建议修法**：
  - 为各 API 端点引入 Zod schema 验证（至少对核心路径）。
  - 或增加更严格的 TypeScript discriminated union 类型定义。
  - 对关键字段缺失时增加显式 fallback 和 console.warn。

---

## 3. In-Scope 逐项对齐审核

> 对照 charter §4.1 In-Scope 项和 closure §2 完成证据矩阵。

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | I1: React app shell 姿势切换 | `done` | main.tsx 为入口，AppShell 三栏布局，旧 demo 标注 retired |
| S2 | I2: Pages Functions BFF 与前端 API 分层 | `partial` | BFF 代理已建立，但缺少 CORS preflight 处理（R2）；本地开发时 BFF 不可用 |
| S3 | I3: Auth / session navigation / chat mainline | `partial` | Auth 主链可运行，但 token 无 refresh 机制（R4）；auth 状态双源分裂（R1） |
| S4 | I4: Inspector / settings / catalog / health 辅助面 | `partial` | 基础面已建立，但 Inspector 数据只加载一次不刷新（R8）；Topbar 硬编码假状态（R11） |
| S5 | I5: partial capability 不伪装 | `done` | Settings 页诚实标注 known limitations；Inspector usage 标注为 snapshot |
| S6 | I6: action-plan / closure 所需基础结构 | `done` | F0-F6 文档齐全，closure 已产出 |
| S7 | F1: React Shell Reset | `done` | 骨架完整 |
| S8 | F2: BFF And Transport Split | `partial` | BFF 存在但 CORS preflight 缺失 |
| S9 | F3: Auth And Session Navigation | `partial` | 功能可运行，但 auth 双源（R1）和 token 无 refresh（R4） |
| S10 | F4: Chat Mainline And Stream | `partial` | WS 无重连（R3）；消息可变操作有潜在 bug（R7） |
| S11 | F5: Inspector And Delivery Hardening | `partial` | Inspector 不刷新（R8）；Topbar 假状态（R11） |
| S12 | F6: Closure And Handoff | `partial` | Closure 声称部分功能 ✅ 与实际不符（WS reconnect、auth 双源） |

### 3.1 对齐结论

- **done**: 4 (S1, S5, S6, S7)
- **partial**: 8 (S2, S3, S4, S8, S9, S10, S11, S12)
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0

> 这更像"核心骨架成立，但 auth/WS/BFF 存在断点需修复后才能关闭"，而不是 partial 完成即可通过。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 完整 Open WebUI 产品能力复刻 | `遵守` | 未复刻完整 Open WebUI |
| O2 | model/provider 切换面板 | `遵守` | Settings 页诚实标注 |
| O3 | 实时 permission / elicitation modal | `遵守` | 未伪装 |
| O4 | 完整附件上传 / 下载 / 预览 | `遵守` | 未实现 |
| O5 | 多租户 admin / billing / org | `遵守` | 未实现 |
| O6 | clients/web 纳入根 workspace | `遵守` | 仍在 workspace 外 |
| O7 | WS 同域 gateway | `遵守` | 仍为 direct connect（受控例外） |
| O8 | 单元/集成测试 | `部分违反` | 无任何测试；closure K9 将其标注为 Low，但这对关键路径（auth, WS reconnect, BFF proxy）构成风险 |
| O9 | 状态管理方案升级 | `遵守` | 当前为极简自定义方案 |
| O10 | Cookie/session 化 auth | `遵守` | 当前为 localStorage，已在 K10 标注 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`web-v10 foundations 主体成立，但存在 R1（auth 双源）、R2（BFF CORS preflight）、R3（WS 无重连）、R4（token 无 refresh）四个 blocker 级别问题。这些修正前不应关闭 closure。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **R1 Auth 状态统一**：合并 `apis/auth.ts` 和 `state/auth.ts` 的 auth 状态为单一来源，确保 register/login/logout/token-refresh 路径一致写入。
  2. **R2 BFF CORS preflight**：`functions/api/[[path]].ts` 添加 OPTIONS 方法处理（返回 CORS headers + 204），确保所有浏览器写操作可通过。
  3. **R3 WS 重连机制**：实现 WS 断连后的指数退避重连 + `last_seen_seq` 对账 + `session.resume` 帧重发。
  4. **R4 Token refresh**：实现 `/auth/refresh` 调用路径，401 时先 refresh 再重试，避免 1 小时强制登出。
- **可以后续跟进的 non-blocking follow-up**：
  1. R5: 统一 upstream URL 管理
  2. R6: 清理或重构 `client.ts` 废弃代码
  3. R7: 消息数组可变操作重构
  4. R8: Inspector 数据刷新机制
  5. R9: BFF query string 解析修复
  6. R10: `useAuth` hook 正确实现或重命名
  7. R11: Topbar 连接状态真实化
  8. R13: `register()` 部分失败恢复
  9. R14: `stream_uuid` 常量化
  10. R15: Envelope 类型安全增强
- **建议的二次审查方式**：`independent reviewer`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 附录 A. 审查质量评价

> 评价对象: `GLM — web-v10-closure code review`
> 评价人: `Copilot (post-fix evaluator)`
> 评价时间: `2026-04-28`

---

### A.0 评价结论

- **一句话评价**: `覆盖面最广的扫描型审查者，15 个 finding 全部为 true-positive，但在 blocker 优先级校准上存在过度拔高，且漏掉了最关键的 WS 架构语义 bug。`
- **综合评分**: `7.5 / 10`
- **推荐使用场景**: 全量代码扫描，发现技术债和配置类缺陷，适合作为"宽网"补充审查。
- **不建议单独依赖的场景**: 严重级别排序和 blocker/non-blocker 边界划分；GLM 倾向于将产品体验类问题（token refresh）上升为 foundation blocker。

---

### A.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | 全量扫描 + 平台适配 + 安全合规 | 覆盖从 auth 架构到 BFF CORS、query string 解析、`useAuth` 命名误导、envelope 类型安全等 |
| 证据类型 | file:line 引用 + 协议对账 | R9 引用 `[[path]].ts:14-18` 的具体代码片段；R14 引用协议文档 |
| Verdict 倾向 | 严格偏激进 | 将 token refresh（R4）列为 blocker，但 refreshToken 字段存在只是类型定义未被消费 |
| Finding 粒度 | 最细 (15 个 finding) | 从架构级（R1 dual auth）到代码风格（R15 envelope 类型断言）均覆盖 |
| 修法建议风格 | 均衡，具体代码较少 | 多为方向描述，R9 给出了完整替换代码；其余以 bullet 方向为主 |

---

### A.2 优点与短板

#### A.2.1 优点

1. **覆盖面最广，15 个 finding 零误报**：从 auth 双状态、WS 重连、BFF CORS、query string 解析到 `useAuth` 命名误导和 envelope 类型安全，无一遗漏且全部验证为真。
2. **独家发现 BFF CORS preflight 缺失（R2）和 query string 解析 bug（R9）**：其他三位审查者均未提及 OPTIONS 处理缺失；R9 是唯一精确指出 `split("=")` 破坏含 `=` 值场景的 finding，均已修复。
3. **对 `useAuth` 命名误导（R10）的分析深入**：正确指出它不是真正的 React hook（无 useState/useEffect），组件调用后不会响应 auth 变化重新渲染，是防御性编程质量的重要隐患。

#### A.2.2 短板 / 盲区

1. **漏掉最关键的架构 bug**：`ChatPage.handleSend` 每次 send 后调用 `connectWs()`，导致 WS 连接被反复重建，这是 foundation 阶段最严重的 WS 架构语义错误。GLM 发现了"WS 无重连"（R3），却没有意识到 WS 正在被主动频繁销毁。
2. **Token refresh（R4）blocker 定级过高**：将其列为与 auth 双状态、WS 无重连并列的 blocker。实际上 refreshToken 字段已在类型中定义，后端 API 存在，但未实现属于产品功能迭代（UX 问题），不是 foundation 正确性的 blocker。在 1 小时 session 中用户不会强制登出。
3. **Session 切换状态重置问题未识别**：GPT 明确指出切换 session 时 `started/messagesRef/lastSeenSeqRef` 未清空导致新会话首消息走 `/input` 而非 `/start`。GLM 的 R8（Inspector 不刷新）触及了部分表象，但未识别出更深层的 chat 状态污染问题。

---

### A.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| R1 (Auth 双状态) | critical | true-positive | excellent | 与 DeepSeek R2 / GPT R1 一致，已修复 |
| R2 (BFF CORS preflight) | critical | true-positive | excellent | 独家发现，已修复（OPTIONS 204 早返回） |
| R3 (WS 无重连) | high | true-positive | good | 正确，但未发现根因（每次 send 重建 WS） |
| R4 (Token 过期无 refresh) | high | partial | mixed | Finding 为真但 blocker 定级过高；属产品迭代项 |
| R5 (URL 散布 4 处) | medium | true-positive | good | 正确，deferred |
| R6 (client.ts 废弃代码重复) | medium | true-positive | good | 正确，deferred |
| R7 (消息 mutable 操作) | medium | true-positive | good | 正确，deferred |
| R8 (Inspector 数据不刷新) | medium | true-positive | good | 已通过 session 切换 data 清空间接修复 |
| R9 (BFF query string 解析) | medium | true-positive | excellent | 独家发现且最精准，已修复 |
| R10 (useAuth 非真正 hook) | low | true-positive | good | 深入分析，正确识别命名误导 |
| R11 (Topbar 硬编码) | low | true-positive | good | 已修复 |
| R12 (main.ts 仍参与编译) | low | true-positive | mixed | 技术上正确，但不影响运行时行为 |
| R13 (register 部分失败) | medium | true-positive | good | 正确识别 UX 断裂场景，deferred |
| R14 (stream_uuid 硬编码) | low | true-positive | mixed | 正确但低优先级；协议文档未明确 |
| R15 (Envelope 类型断言) | low | true-positive | mixed | 正确但属于 TypeScript 质量提升，非紧迫 |

**关键遗漏（未发现）**:
- `ChatPage.handleSend` 每次 send 调用 `connectWs()` 重建 WS（kimi R1 — 最高优先级架构 bug）
- `sendInput` body 携带冗余 `session_uuid`（kimi R3）
- Session 切换时 started/messages/lastSeenSeq 未重置（GPT R2）
- Facade 未转发 `last_seen_seq`（GPT R3 后端层面）

---

### A.4 多维度评分

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 8 | 15 个 finding 均有 file:line 支撑；R9 代码片段尤为精确 |
| 判断严谨性 | 7 | 零误报，但 R4 blocker 定级过高影响优先级排序 |
| 修法建议可执行性 | 7 | R9 给出完整替换代码；其余多为方向描述，可执行性参差 |
| 对 action-plan / design / QNA 的忠实度 | 8 | 系统对照 charter 和 closure，Out-of-Scope 分析完整 |
| 协作友好度 | 8 | 格式清晰，表格整齐，blocker 清单明确 |
| 找到问题的覆盖面 | 8 | 15 finding 是最多的，覆盖从架构到代码风格；但漏掉最关键的 WS 架构 bug |
| 严重级别 / verdict 校准 | 6 | R4（token refresh）blocker 定级明显过高；WS 相关问题的根因识别不足 |