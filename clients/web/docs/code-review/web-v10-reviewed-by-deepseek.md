# Nano-Agent 代码审查报告

> 审查对象: `clients/web (web-v10 foundations implementation)`
> 审查类型: `code-review`
> 审查时间: `2026-04-28`
> 审查人: `DeepSeek`
> 审查范围:
> - `clients/web/src/` (全部源码: apis, components, pages, state, hooks, constants, styles)
> - `clients/web/functions/api/[[path]].ts` (BFF 层)
> - `clients/web/package.json`, `vite.config.ts`, `tsconfig.json`
> 对照真相:
> - `clients/web/docs/charter/web-v10-foundations.md` (基石纲领)
> - `clients/web/docs/closure/web-v10-closure.md` (关闭报告)
> - `clients/web/docs/api-contract.md` (API 契约)
> - `clients/api-docs/` (session.md, session-ws-v1.md, auth.md, me-sessions.md 等)
> 文档状态: `changes-requested`

---

## 0. 总结结论

> **整体判断**: `该实现主线骨架成立，所有 charter 硬闸在源码层面可验证，但存在若干数据流分裂、连接可靠性缺失、以及开发模式下 BFF 不可用的结构性断点，不应标记为 completed。`

- **整体判断**: 核心业务主链（auth → session navigation → chat + WS stream → inspector）均可走通，工程基线 `pnpm build` 通过。但存在双轨 auth state、开发环境下 BFF 不可用、WebSocket 无自动重连、以及多处错误处理盲区等实际问题。
- **结论等级**: `approve-with-followups`
- **是否允许关闭本轮 review**: `no` — 存在需要修正的 blocker，修正后可关闭
- **本轮最关键的 1-3 个判断**:
  1. **Dual auth state** (`apis/auth.ts` 与 `state/auth.ts` 各维护一份 `currentAuth`) 是架构层面的数据流分裂，已在 `createSession`/`selectSession` 中引发实际行为缺陷。
  2. **Vite dev 模式下 BFF `/api/*` 不可用**：`vite.config.ts` 未配置 proxy，本地 `pnpm dev` 时所有 BFF 路径的 fetch 将 404，严重影响本地开发体验。
  3. **WebSocket 无自动重连机制**：`close` / `error` 事件只做状态设置和清理，不发生 reconnect attempt，违反 charter §7.5 强调的 "resume/reconnect/timeline 对账" 要求且与 closure 声明 `~95%` 的评估有直接差距。

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `clients/web/docs/charter/web-v10-foundations.md`
  - `clients/web/docs/closure/web-v10-closure.md`
  - `clients/api-docs/session-ws-v1.md`
  - `clients/api-docs/session.md`
  - `clients/api-docs/auth.md`
  - `clients/api-docs/me-sessions.md`
- **核查实现**:
  - `clients/web/src/` 全部源文件 (17 个文件)
  - `clients/web/functions/api/[[path]].ts`
  - `clients/web/vite.config.ts`, `tsconfig.json`, `package.json`
- **执行过的验证**:
  - `pnpm build` — TypeScript 编译 + Vite 打包通过，0 错误
- **复用 / 对照的既有审查**:
  - 无 — 本次为独立审查，未参考任何其他 reviewer 的结论

### 1.1 已确认的正面事实

- `pnpm build` (tsc --noEmit + vite build) 零错误通过，工程基线健康
- React shell 已完全替代旧的 DOM demo (`main.ts` 已标记为 retired)
- HTTP 主路径通过 `Transport.useBff=true` 默认走 same-origin `/api/*`，BFF `[[path]].ts` 正确代理至 upstream
- Auth 主链完整：register/login/logout + localStorage 持久化 + expired 检测
- Session 导航完整：`/me/sessions` 列表 + `POST /me/sessions` 创建 + sidebar 切换
- Chat 流式主链可执行：start/input HTTP → WS stream → timeline 回补
- Inspector 四标签 (status/timeline/history/usage) 均已实现，partial capability 均有 truth label
- 辅助页面 (Catalog/Health/Settings) 均已实现且带有已知限制说明
- 错误模型 (`ApiRequestError`) 覆盖 facade error envelope / HTTP error 三类形状
- `HeartbeatTracker` 心跳实现与 `packages/nacp-session` 行为等价

### 1.2 已确认的负面事实

- **Dual auth state**: `src/apis/auth.ts` 持有 `currentAuth` 变量 (via `getAuth()`/`setAuth()`/`requireAuth()`), `src/state/auth.ts` 持有另一份 `currentAuth` (via `getAuthState()`/`setAuthState()`)。`App.tsx` 混用两者（`loadSessions` 用 `state/auth`, `createSession` 用 `apis/auth` 的 `requireAuth`），两套 state 在特定路径下可能不同步。
- **Vite dev 无 `/api/*` 代理**: `vite.config.ts` 未配置 `server.proxy`，导致 `pnpm dev` 时浏览器请求 `/api/*` 会直接打到 Vite dev server 而返回 404，本地开发必须手动切换 `useBff: false` 或配置环境变量。
- **WS 无自动重连**: `ChatPage.tsx` 的 `close`/`error` 事件处理 (`close` 行 176-179, `error` 行 181-185) 只做状态切换与清理，不发起任何重连尝试。
- **`createSession` / `selectSession` 缺少 auth.expired 处理**: `App.tsx:54-58` (`createSession`) 和 `App.tsx:69-73` (`selectSession`) 的 catch 块没有 `auth.expired` 检测，token 过期时不会触发登出/跳转。
- **InspectorTabs 错误状态跨 tab 共享**: `InspectorTabs.tsx:30` 的 `error` state 是单一的，当 timeline tab 抛出错误后切换到 history tab 仍显示同一错误。
- **`Topbar` 连接状态硬编码**: 始终显示绿色 "Connected"，不反映真实 WS 状态。
- **`catalogApi` 在 `InspectorTabs.tsx` 中导入但未使用**: 代码死引用。
- **`hooks/` 目录为空**: charter §6.1 定义的目录骨架下此目录当前无内容。
- **`getWsBaseUrl()` 在 `client.ts` 和 `ChatPage.tsx` 中重复实现**: 同一逻辑两份拷贝，若 WS URL 变更需同时修改两处。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐文件代码审查，覆盖全部 src/ + functions/ 源文件 |
| 本地命令 / 测试 | yes | `pnpm build` (tsc + vite) 通过 |
| schema / contract 反向校验 | yes | 对比 `clients/api-docs/` 中 session-ws-v1/session/auth/me-sessions 契约 |
| live / deploy / preview 证据 | no | 未执行 live deploy 验证 |
| 与上游 design / QNA 对账 | yes | 以 charter 硬闸 (§10.1) 和 closure 证据矩阵 (§2) 逐项对账 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | Vite dev 模式 BFF `/api/*` 不可用 — 无 proxy 配置 | critical | platform-fitness | yes | 修复 |
| R2 | Dual auth state: `apis/auth.ts` 与 `state/auth.ts` 维护两份 `currentAuth` | high | correctness | yes | 修复 |
| R3 | WebSocket 无自动重连机制 | high | correctness | yes | 修复 |
| R4 | `App.tsx` 中 `createSession` / `selectSession` 缺少 `auth.expired` 处理 | high | correctness | yes | 修复 |
| R5 | `InspectorTabs` 错误状态跨 tab 共享 | medium | correctness | no | 后续修复 |
| R6 | `Topbar` 连接状态为硬编码静态 "Connected" | medium | delivery-gap | no | 后续修复 |
| R7 | `getWsBaseUrl()` 在 `client.ts` 和 `ChatPage.tsx` 中重复实现 | medium | correctness | no | 后续修复 |
| R8 | Timeline 回放未处理 `is_final` 标志 | medium | correctness | no | 后续修复 |
| R9 | `InspectorTabs` 未使用 import `catalogApi` | low | delivery-gap | no | 清理 |
| R10 | `hooks/` 目录为空 | low | delivery-gap | no | 后续填充或移除 |

### R1. Vite dev 模式 BFF `/api/*` 不可用 — 无 proxy 配置

- **严重级别**: `critical`
- **类型**: `platform-fitness`
- **是否 blocker**: `yes`
- **事实依据**:
  - `vite.config.ts` (完整文件) — 仅有 `root` 和 `build.outDir`，没有 `server.proxy` 配置
  - `src/apis/transport.ts:71` — `Transport` 默认 `useBff = true`，所有 API 请求发往 `/api/*`
  - `src/apis/transport.ts:77-78` — `url = this.useBff ? '/api${path}' : ...`
  - Vite dev server 不运行 Cloudflare Pages Functions，因此 `/api/*` 请求返回 404
- **为什么重要**:
  - `pnpm dev` 是开发者的主要工作流入口。当前默认配置下，本地开发时所有 HTTP API 调用全部失败。开发者被迫手动在浏览器控制台执行 `localStorage.setItem("nano.baseUrl", ...)` 并绕过 BFF，这与 charter §4.4 的第 2 条纪律 "HTTP 主路径默认经 BFF" 形成实践背离。
- **审查判断**:
  - 这是 foundation 阶段的工程配置缺失。closure 声明 "工程基线: 100%" 与本地 dev 模式下的实际体验不符。
- **建议修法**:
  在 `vite.config.ts` 中添加 server proxy 配置，将 `/api/*` 转发至 upstream:

  ```ts
  export default defineConfig({
    root: ".",
    build: { outDir: "dist" },
    server: {
      proxy: {
        "/api": {
          target: process.env.VITE_NANO_BASE_URL ??
            "https://nano-agent-orchestrator-core-preview.haimang.workers.dev",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  });
  ```

  同时在 `Transport` 中自动检测 Vite dev 模式并根据 `import.meta.env.DEV` 决定默认 `useBff` 策略。

### R2. Dual auth state: `apis/auth.ts` 与 `state/auth.ts` 维护两份 `currentAuth`

- **严重级别**: `high`
- **类型**: `correctness`
- **是否 blocker**: `yes`
- **事实依据**:
  - `src/apis/auth.ts:10` — `let currentAuth: AuthState | null = null;` (api 层)
  - `src/state/auth.ts:5` — `let currentAuth: AuthState | null = null;` (state 层)
  - `src/state/auth.ts:47` — `currentAuth = loadPersisted();` (state 层从 localStorage 初始化)
  - `src/apis/auth.ts` 的 `currentAuth` **不从** localStorage 初始化
  - `src/App.tsx` 混用: `getAuthState()` (state层, line 8/27/91), `requireAuth()` (api层, line 50)
  - `src/pages/ChatPage.tsx` 使用 `getAuthState()` (state层, line 2/82/198/233)
  - `src/pages/AuthPage.tsx` 调用 `authApi.login()` (api层内部会设其 `currentAuth`, line 74), 然后调 `setAuthState()` (state层, line 31)
  - `src/components/inspector/InspectorTabs.tsx` 使用 `getAuthState()` (state层, line 2/33)
- **为什么重要**:
  - 两套 auth state 在页面刷新后不同步：刷新后 state 层从 localStorage 恢复，api 层为 null。`App.tsx:50` 的 `requireAuth()` (读 api 层) 在刷新后首次调用会 throw `"login first"` 错误，尽管用户实际已登录且 localStorage 中有 token。
  - `createSession` 在 `App.tsx:49` 使用 `requireAuth()`，刷新后点击新建会话将抛出错误而非正常创建。
- **审查判断**:
  - 这是 F0-F3 阶段的架构残留。Charter §4.4 的 "facade-first" 纪律要求客户端只面向 public facade，但此处实际是两个前端内部模块之间产生了分裂的真相源。当面刷新后仍可走通的原因主要是 `AuthPage` 在注册/登录时同时写了两边 + `App.tsx:90-99` 的 `useEffect` 从 state 层读 auth 来判断路由，但 `createSession` 走的是 api 层路径，形成了事实盲区。
- **建议修法**:
  选择单一真相源。推荐方案：**删除 `apis/auth.ts` 中的 `currentAuth` 变量及 `getAuth()`/`setAuth()`/`logout()`/`requireAuth()` 函数**，统一使用 `state/auth.ts`。将 `requireAuth()` 函数移至 `state/auth.ts`。需要修改的调用点：
  - `src/App.tsx:50` — 改用 `state/auth` 的 requireAuth
  - `src/apis/auth.ts:91-93` — 移除独立的 `requireAuth()`
  - 所有引用 `getAuth()`/`setAuth()` 的调用统一迁至 `getAuthState()`/`setAuthState()`

### R3. WebSocket 无自动重连机制

- **严重级别**: `high`
- **类型**: `correctness`
- **是否 blocker**: `yes`
- **事实依据**:
  - `src/pages/ChatPage.tsx:176-179` — `socket.addEventListener("close", () => { setWsStatus("disconnected"); cleanupWs(); });`
  - `src/pages/ChatPage.tsx:181-185` — `socket.addEventListener("error", () => { setWsError("..."); setWsStatus("disconnected"); cleanupWs(); });`
  - 二者均只做状态更新和资源清理，不包含任何重连逻辑
  - Charter §7.5 F4 收口标准: "刷新或掉线后可以恢复会话流式状态"
  - Charter §10.3 NOT-成功退出: "聊天主链缺少 resume/reconnect/timeline 对账，只有 happy-path 流式展示"
  - `clients/api-docs/session-ws-v1.md:138-143` 给出了明确的 reconnect recommendation 流程
- **为什么重要**:
  - 用户在网络波动、服务器重启、Cloudflare 平台重置等场景下，WebSocket 断开后聊天对话将永久中断，用户必须手动刷新整个页面。这与 charter F4 的收口标准直接矛盾。
  - Closure §2.5 将 F4 标记为 "full close" 且声称 "Resume ✅ — last_seen_seq 对接 + session.resume 帧发送"，但 resume 帧仅在连接建立时发送，并不覆盖连接断开后的重新建立。
  - 对比 `clients/api-docs/session-ws-v1.md` 的 reconnect recommendation (§138-143): 该建议规定了 4 步重连流程，前端当前只实现了第 1 步（本地记住 seq），缺失第 2-4 步。
- **审查判断**:
  - Closure 对 F4 的评估过于乐观。实际实现缺少重连自动化，在非 happy-path 下不可恢复。这使 closure 的 "Chat 主链 ~95%" 声称需要下调。
- **建议修法**:
  在 `ChatPage.tsx` 的 `close` 事件中增加重连逻辑:
  1. 区分正常关闭 (code 1000) 与异常关闭
  2. 对异常关闭进行指数退避重连 (exponential backoff: 1s/2s/4s/8s, max 30s)
  3. 重连时带 `?last_seen_seq=<lastSeenSeqRef.current>` 
  4. 重连成功后调用 `POST /sessions/{uuid}/resume` 对比 relay_cursor
  5. 对 `attachment_superseded` (code 4001) 特殊处理：不自动重连，提示用户
  6. 设置最大重连次数 (如 5 次)

### R4. `App.tsx` 中 `createSession` / `selectSession` 缺少 `auth.expired` 处理

- **严重级别**: `high`
- **类型**: `correctness`
- **是否 blocker**: `yes`
- **事实依据**:
  - `src/App.tsx:54-58` — `createSession` 的 catch 块只有 `console.error("Failed to create session:", err)`
  - `src/App.tsx:69-73` — `selectSession` 的 catch 块只有 `setSessionStatus(null)` 
  - 对比 `src/App.tsx:39-43` — `loadSessions` 的 catch 块**有**完整的 `auth.expired` 检测与处理
- **为什么重要**:
  - 如果 token 在 `createSession` 调用时过期（HTTP 401），用户不会收到任何 UI 反馈（仅 console 静默打印），不会跳转到登录页，UI 停留在 chat 页面但实际未认证。
  - `selectSession` 同理，token 过期时静默将 status 设为 null，用户看到的是 inspector 显示无数据，但不知道根因是认证问题。
- **审查判断**:
  - 这是 Auth 主链的错误处理盲区。三个操作路径共用同一 auth token，但仅 `loadSessions` 正确处理了过期场景。
- **建议修法**:
  在 `createSession` 和 `selectSession` 的 catch 块中增加与 `loadSessions` 一致的 `auth.expired` 检测:
  ```typescript
  } catch (err) {
    if (err instanceof ApiRequestError && err.details.kind === "auth.expired") {
      setAuthState(null);
      setPage("auth");
      return;
    }
    console.error("Failed to create session:", err);
  }
  ```

### R5. `InspectorTabs` 错误状态跨 tab 共享

- **严重级别**: `medium`
- **类型**: `correctness`
- **是否 blocker**: `no`
- **事实依据**:
  - `src/components/inspector/InspectorTabs.tsx:30` — `const [error, setError] = useState<string | null>(null);` 是单值状态
  - `src/components/inspector/InspectorTabs.tsx:40` — timeline fetch 失败时 `setError(err.message)`
  - `src/components/inspector/InspectorTabs.tsx:92-93` — `renderTimeline` 检查全局 `error`
  - `src/components/inspector/InspectorTabs.tsx:120` — `renderHistory` 也检查全局 `error`
- **为什么重要**:
  - 用户在 inspector 中查看 timeline，如果 timeline API 返回错误 (如 session 不存在时返回 404)，错误信息会显示。此时用户切换到 history tab，history API 可能正常返回，但因为 `error` state 仍持有 timeline 的错误，history tab 也会显示该错误信息而非正常数据。用户会被误导以为 history 也失败了。
- **审查判断**:
  - 中等影响。不影响主链功能，但会导致 inspector 面的数据展示错误，误导调试行为。
- **建议修法**:
  将 error state 改为按 tab 维度: `Record<string, string | null>`:
  ```typescript
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  ```
  fetch 失败时 `setErrors(prev => ({ ...prev, [activeTab]: msg }))`，
  switch tab 时清除: `setErrors(prev => ({ ...prev, [activeTab]: null }))`。

### R6. `Topbar` 连接状态为硬编码静态 "Connected"

- **严重级别**: `medium`
- **类型**: `delivery-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `src/components/Topbar.tsx:6-7` — 状态圆点和文字均为静态: `background: "var(--color-accent-success)"` + `"Connected"`
  - Topbar 不接受任何 props 来传递真实 WS 状态
  - `ChatPage` 持有真实的 `wsStatus` state (`"disconnected" | "connecting" | "connected"`) 但不向上传递
- **为什么重要**:
  - 在 WS 断开、重连、或尚未连接时，Topbar 仍显示绿色 "Connected"，对用户产生误导。这是 charter F4 "WS 状态指示器" 的表面实现而非真实实现。
- **审查判断**:
  - Topbar 应该接收并反映真实的 WS 状态。当前实现是 UI 壳而非功能实现。
- **建议修法**:
  在 `App.tsx` 中维护 WS 状态，通过 `AppShell` → `Topbar` 传递，或在 Topbar 中使用 context/状态订阅。

### R7. `getWsBaseUrl()` 在 `client.ts` 和 `ChatPage.tsx` 中重复实现

- **严重级别**: `medium`
- **类型**: `correctness`
- **是否 blocker**: `no`
- **事实依据**:
  - `src/client.ts:16-27` — `function getWsBaseUrl()` 
  - `src/pages/ChatPage.tsx:36-45` — `function getWsBaseUrl()` 
  - 两处实现逻辑几乎完全相同: 检查 `VITE_NANO_BASE_URL` env, 替换 `https:` → `wss:`, fallback 到硬编码 URL
  - `ChatPage` 不使用 `client.ts` 的 `openSessionStream`，而是自己实现了完整的 WS 连接逻辑
- **为什么重要**:
  - 代码重复导致维护风险。如后端 WS URL 变更，需在两个文件分别修改，容易遗漏。
  - `client.ts` 的 `openSessionStream` 本应是 WS 连接的 canonical 实现，但 `ChatPage` 未复用，而是自行重写了一份几乎相同的逻辑（包括 heartbeat、ack、resume 帧发送）。
- **审查判断**:
  - 这是 F2 transport 拆分的不彻底产物。`ChatPage` 应当通过 `client.ts` 的 `openSessionStream` 或一个共享的 WS hook 来管理连接，而非重复实现。
- **建议修法**:
  1. 将 `getWsBaseUrl()` 提取到 `src/apis/transport.ts` 或新的 `src/apis/ws.ts`
  2. 将 WS 连接逻辑（heartbeat、seq/ack、resume）从 `ChatPage` 中抽离为一个 `useSessionStream` 自定义 hook 或复用 `client.ts` 的 `openSessionStream`
  3. `ChatPage` 通过该共享模块管理 WS 生命周期

### R8. Timeline 回放未处理 `is_final` 标志

- **严重级别**: `medium`
- **类型**: `correctness`
- **是否 blocker**: `no`
- **事实依据**:
  - `src/pages/ChatPage.tsx:266` — timeline 回放中 `llm.delta` 处理: `if (kind === "llm.delta" && contentType === "text")` — 未检查 `is_final`
  - `clients/api-docs/session.md:238-246` — timeline events 包含 `is_final` 字段
  - `src/pages/ChatPage.tsx:142` — WS live stream 中 `llm.complete` 正确处理了最终化
- **为什么重要**:
  - 当用户刷新页面后，timeline 回放重建消息列表。如果某个 `llm.delta` 事件带有 `is_final: true`，代码会继续将其作为 streaming delta 处理，而不是标记为完整的 assistant 消息。这可能导致消息显示状态不一致: WS live 路径下会生成 `[Complete]` 系统消息（line 156），而 timeline 回放路径不会。
- **审查判断**:
  - 中等影响。刷新后重新进入的聊天历史可能与实时流式路径下的消息展示不一致。
- **建议修法**:
  在 timeline 回放逻辑中增加 `is_final` 检查:
  ```typescript
  } else if (kind === "llm.delta" && contentType === "text") {
    const last = messagesRef.current[messagesRef.current.length - 1];
    if (last && last.role === "assistant" && last.kind === "llm.delta") {
      last.content += content;
      if (ev.is_final) {
        last.kind = "llm.complete";
      }
    } else {
      messagesRef.current.push({
        role: "assistant",
        content,
        kind: ev.is_final ? "llm.complete" : "llm.delta",
      });
    }
  }
  ```

### R9. `InspectorTabs` 未使用 import `catalogApi`

- **严重级别**: `low`
- **类型**: `delivery-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `src/components/inspector/InspectorTabs.tsx:4` — `import * as catalogApi from "../../apis/catalog";`
  - 在整个文件 (303 行) 中，`catalogApi` 未被任何地方引用
- **审查判断**:
  - 死代码残留。不影响功能，但增加打包体积和阅读干扰。
- **建议修法**:
  删除该 import 行。

### R10. `hooks/` 目录为空

- **严重级别**: `low`
- **类型**: `delivery-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `clients/web/src/hooks/` 目录存在但为空 (0 entries)
  - Charter §6.2 F1 交付物中包含目录骨架建立
- **审查判断**:
  - 目录结构已预留但未填充。如果后续确实不在此阶段使用 hooks，可保留空目录作为骨架；但如果认为空目录是噪音，可删除。
- **建议修法**:
  二选一:
  1. 保留 hooks 目录，为后续 productization 做准备
  2. 删除空目录，避免误导

---

## 3. In-Scope 逐项对齐审核

按 Charter §10.1 硬闸 + Closure §1.2 判定表逐项核查：

| 编号 | 计划项 / Closure Claim | 审查结论 | 说明 |
|------|----------------------|----------|------|
| S1 | React app shell 姿势切换 | done | `main.tsx` + `App.tsx` 替代了 DOM demo |
| S2 | Same-origin BFF 承接 HTTP | partial | BFF 代理实现正确，但 Vite dev 无 proxy 导致本地开发不可用 (R1) |
| S3 | Auth → Session Nav → Chat Mainline → Stream/Resume/Timeline | partial | 主链可走通，但 WS 无自动重连 (R3)、auth state 双轨 (R2)、createSession 缺 auth.expired (R4) |
| S4 | Inspector / Settings / Catalog / Health 基础面 | partial | 四个页面均已实现，但 Topbar 状态静态 (R6)、InspectorTabs 错误跨 tab (R5)、catalogApi 死引用 (R9) |
| S5 | 文档、部署与已知限制书面冻结 | done | setup/deployment/api-contract 已产出 |
| S6 | Auth bootstrap (F3) | partial | 主逻辑完整，但 dual auth state (R2) 在刷新后 createSession 会抛异常 |
| S7 | WS stream heartbeat + seq/ack (F4) | partial | heartbeat/ack 实现正确，但缺重连 (R3) 且 getWsBaseUrl 重复 (R7) |
| S8 | Timeline 回补 (F4) | partial | 回补逻辑基本正确，但未处理 is_final (R8) |
| S9 | Resume (F4) | partial | resume 帧在 WS open 时发送，但无断开后 reconnect 时自动 resume (R3) |
| S10 | Inspector tabs (F5) | partial | 四标签实现，但 error state 全局共享 (R5) |
| S11 | Truth labeling (F5) | done | usage snapshot 标注、Settings 已知限制列表正确 |

### 3.1 对齐结论

- **done**: 3
- **partial**: 8
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0

> **总结**: 这更像 **"核心骨架完成，但 transport 一致性、连接可靠性与本地开发体验仍未收口"**，而不是 charter 定义的 "full close" 状态。Closure 判定为 `close-with-known-issues` 是诚实的，但其 §4.2 前端技术债务清单遗漏了上述 R1-R5 的实现断点。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | permission / elicitation modal 未 fully live | 遵守 | ChatPage 未伪装这些能力，WS 仅处理已文档化的 4 种 frame |
| O2 | usage live push 未实现 | 遵守 | Inspector 中明确标注 "point-in-time snapshot"，Settings 中列出为 known limitation |
| O3 | files 完整链路未实现 | 遵守 | 无文件上传/下载/预览 UI 伪实现 |
| O4 | model/provider 切换未实现 | 遵守 | Settings 页面仅展示说明，无 selector 组件 |
| O5 | WS 仍为 direct connect | 遵守 | 属 charter §4.5 规定的 "first-wave 受控例外" |
| O6 | `/me/conversations` deferred | 遵守 | Sidebar 使用 `/me/sessions` 为 canonical source |
| O7 | 无单元测试/集成测试 | 遵守 | 已列为已知债务 (K9)，closure 真实记录 |
| O8 | Auth token 在 localStorage | 遵守 | 已列为已知债务 (K10)，closure 真实记录 |

**Out-of-Scope 结论**: 所有 deferred 项均被诚实遵守，未发现越界实现或能力伪装。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**: `approve-with-followups` — web-v10 foundations 主线骨架成立，工程基线干净，但存在必须修正的实现断点（R1/R2/R3/R4）才可达到 charter 定义的收口标准。

- **是否允许关闭本轮 review**: `no` — 需要修正 R1-R4 后重新审查或追加验证。

- **关闭前必须完成的 blocker**:
  1. **R1** — 在 `vite.config.ts` 中配置 `/api/*` 代理，使 `pnpm dev` 下 BFF 路径可正常工作
  2. **R2** — 统一 `apis/auth.ts` 与 `state/auth.ts` 为单一 auth state 真相源
  3. **R3** — 为 WebSocket 添加指数退避自动重连机制
  4. **R4** — 在 `createSession` 和 `selectSession` 的 catch 块中添加 `auth.expired` 处理

- **可以后续跟进的 non-blocking follow-up**:
  1. **R5** — 将 InspectorTabs error state 改为 per-tab 维度
  2. **R6** — Topbar 接收真实 WS 状态，替换硬编码 "Connected"
  3. **R7** — 消除 `getWsBaseUrl()` 重复，将 WS 连接逻辑从 ChatPage 中抽离
  4. **R8** — Timeline 回放处理 `is_final` 标志
  5. **R9** — 清理 `InspectorTabs.tsx` 中未使用的 `catalogApi` import
  6. **R10** — 决定 `hooks/` 空目录的去留

- **建议的二次审查方式**: `same reviewer rereview` — 修正 R1-R4 后复查改动点即可

- **实现者回应入口**: `请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待实现者按 blocker 清单修正并再次验证。
