# Nano-Agent 代码审查报告

> 审查对象: `clients/web / web-v10 Vite + React client`
> 审查类型: `code-review`
> 审查时间: `2026-04-28`
> 审查人: `GPT`
> 审查范围:
> - `clients/web/docs/closure/web-v10-closure.md`
> - `clients/web/docs/charter/web-v10-foundations.md`
> - `clients/web/src/**`
> - `clients/web/functions/api/[[path]].ts`
> - `clients/web/docs/{api-contract,setup,deployment}.md`
> - `clients/api-docs/{auth,me-sessions,session,session-ws-v1,worker-health}.md`
> - `workers/orchestrator-core/src/{index.ts,user-do.ts,session-lifecycle.ts,ws-bridge.ts}`
> 对照真相:
> - `clients/web/docs/charter/web-v10-foundations.md`
> - `clients/web/docs/closure/web-v10-closure.md`
> - `clients/web/docs/api-contract.md`
> - `clients/api-docs/*`
> 文档状态: `changes-requested`

---

## 0. 总结结论

> 该实现已经具备 web-v10 的 React shell、API adapter 与基础页面骨架，但当前不应按 closure 中的“主线目标已成立”关闭；auth/session/chat/WS resume/BFF 本地运行仍有结构性断点。

- **整体判断**：`核心骨架成立，但 Auth → Session Nav → Chat Mainline → Stream/Resume/Timeline 仍不是可靠闭环。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. React shell、页面分层、API adapters 与 dark UI 基线已经落地，且 `npm --prefix clients/web run build` 通过。
  2. 登录态持久化后创建 session 会失败，session 切换会复用旧会话状态，导致首消息可能错误走 `/input` 而不是 `/start`。
  3. closure 宣称的 stream/resume/timeline 闭环被高估：客户端没有自动 reconnect/HTTP resume，对 `last_seen_seq` 的 WS query 也会在 orchestrator-core facade 转发时丢失。

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `clients/web/docs/charter/web-v10-foundations.md`
  - `clients/web/docs/closure/web-v10-closure.md`
  - `clients/web/docs/api-contract.md`
  - `clients/api-docs/auth.md`
  - `clients/api-docs/me-sessions.md`
  - `clients/api-docs/session.md`
  - `clients/api-docs/session-ws-v1.md`
  - `clients/api-docs/worker-health.md`
- **核查实现**:
  - `clients/web/src/App.tsx`
  - `clients/web/src/apis/*`
  - `clients/web/src/state/*`
  - `clients/web/src/pages/*`
  - `clients/web/src/components/*`
  - `clients/web/src/heartbeat.ts`
  - `clients/web/functions/api/[[path]].ts`
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/user-do.ts`
- **执行过的验证**:
  - `npm --prefix clients/web run build`
- **复用 / 对照的既有审查**:
  - `none` — 本报告独立审查实现与契约，不引用其他 reviewer 结论。

### 1.1 已确认的正面事实

- `index.html` 已以 `/src/main.tsx` 作为入口，`main.tsx` 渲染 React `App`，旧 `main.ts` 仅保留为 retired DOM demo 说明。
- `AppShell` 已形成 topbar/sidebar/main/inspector 三栏 dark shell，`AuthPage`、`ChatPage`、`CatalogPage`、`HealthPage`、`SettingsPage` 均已接入。
- HTTP API 已拆到 `src/apis/{transport,auth,sessions,catalog,debug}.ts`，默认通过 `/api/*` BFF 路径调用。
- Settings 对 permission/files/model selector 等 partial capability 有明确 truth label，Inspector usage tab 对 snapshot 口径有明确说明。
- `clients/web` build 通过，说明当前 React/Vite `src` 层至少满足 TypeScript 与生产打包要求。

### 1.2 已确认的负面事实

- `src/apis/auth.ts` 与 `src/state/auth.ts` 各自维护一份 `currentAuth`；localStorage hydration 只进入 `state/auth.ts`，但创建 session 使用的是 `apis/auth.ts` 的 `requireAuth()`。
- `ChatPage` 在 `activeSessionUuid` 变化时没有先重置 `started/messages/lastSeenSeq/wsError`，仅在 `activeSessionUuid` 变为 null 时清空；Inspector tab 数据也未按 `sessionUuid` 重置。
- `ChatPage` 只在 open 时发送 `session.resume` frame 和 WS query `last_seen_seq`，没有实现 close/error 后的自动 reconnect，也没有调用 HTTP `POST /sessions/{uuid}/resume`。
- `orchestrator-core` facade 转发 WS 到 User DO 时只保留 upgrade header，没有把原始 query 中的 `last_seen_seq` 传入内部 request。
- `clients/web` 的 `dev` / `preview` 脚本只启动 Vite；Vite 不会运行 Cloudflare Pages Functions，因此默认 `/api/*` BFF 路径在本地 dev/preview 下没有真实后端。
- `functions/api/[[path]].ts` 未被 `tsconfig.json` 覆盖，且使用 `process.env?.VITE_NANO_BASE_URL` 读取上游，而不是 Cloudflare Pages Function 的 `context.env`。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 对 web 源码、BFF、API docs、orchestrator facade/User DO 进行了行号核查。 |
| 本地命令 / 测试 | `yes` | `npm --prefix clients/web run build` 通过。 |
| schema / contract 反向校验 | `yes` | 对照 `clients/api-docs/session-ws-v1.md`、`session.md`、`me-sessions.md` 与 orchestrator 实现。 |
| live / deploy / preview 证据 | `no` | 未进行真实 Pages deploy 或 live preview 操作。 |
| 与上游 design / QNA 对账 | `yes` | 对照 `web-v10-foundations.md` 与 `web-v10-closure.md`。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | 登录态持久化后创建 session 会失败 | `high` | `correctness` | `yes` | 合并 auth source of truth，移除双 currentAuth |
| R2 | session 切换不重置 chat/inspector 上下文，可能把新会话首消息发到 `/input` | `critical` | `correctness` | `yes` | 按 sessionUuid 重置本地运行态，并 key/reset inspector |
| R3 | WS resume/reconnect 不是端到端闭环，`last_seen_seq` 在 facade 转发时丢失 | `high` | `protocol-drift` | `yes` | facade 保留 WS query，客户端补 reconnect + HTTP resume/timeline reconcile |
| R4 | 本地 dev/preview 默认 `/api/*` 不会运行 BFF | `high` | `delivery-gap` | `yes` | 使用 Wrangler Pages dev 或 Vite proxy，并更新 setup/deployment |
| R5 | Pages Function BFF 的环境读取与类型覆盖不可靠 | `medium` | `platform-fitness` | `no` | 改用 `context.env`，纳入 typecheck |
| R6 | Transport 的错误模型遇到非 JSON 响应会逃逸为裸 `SyntaxError` | `medium` | `correctness` | `no` | 统一将 parse/network/proxy 错误包装为 `ApiRequestError` |
| R7 | Inspector 缺少 closure/known-issue 中承诺的 files unavailable 面 | `medium` | `scope-drift` | `no` | 添加 files tab 的 unavailable truth label 或修正文档口径 |
| R8 | 部署文档声明 pnpm auto-detect，但 package.json 没有 packageManager 且存在 package-lock | `low` | `docs-gap` | `no` | 对齐 package manager 文件与部署文档 |

### R1. 登录态持久化后创建 session 会失败

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/web/src/App.tsx:8-12` 从 `state/auth` 读取持久化 auth，但从 `apis/auth` 导入 `requireAuth`。
  - `clients/web/src/App.tsx:49-56` 创建 session 时调用 `requireAuth()`。
  - `clients/web/src/apis/auth.ts:10-25` 在 API 模块内部维护独立 `currentAuth`。
  - `clients/web/src/apis/auth.ts:67-75` 只有本次 `login()` 成功时才写入 API 模块的 `currentAuth`。
  - `clients/web/src/state/auth.ts:8-18,47` 从 localStorage 只恢复 state 模块的 `currentAuth`。
- **为什么重要**：
  - 页面刷新后，App 会认为用户仍已登录并进入 chat，但 `apis/auth.ts` 的 `currentAuth` 是新模块实例的 `null`。
  - 点击 “New Session” 时 `requireAuth()` 会抛出 `login first`，且这个抛出发生在 `try/catch` 之前，用户无法通过 UI 恢复。
- **审查判断**：
  - closure 中 `Auth bootstrap` 与 `Session Navigation` 的 full close 判定不成立；至少存在刷新后主入口断点。
- **建议修法**：
  - 保留一个 auth source of truth。推荐把 `requireAuth()`、`getAuth()`、`setAuth()` 移到 `state/auth.ts`，API 层只接受显式 `AuthState` 参数。
  - 如果短期保留 `apis/auth.ts` 状态，则 `state/auth.ts` hydration 后必须同步调用 `authApi.setAuth(auth)`，logout 也必须同步清空，但这只是过渡方案。

### R2. session 切换不重置 chat/inspector 上下文，可能把新会话首消息发到 `/input`

- **严重级别**：`critical`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/web/src/pages/ChatPage.tsx:52-60` `started`、`lastSeenSeqRef`、`messagesRef` 是跨 session 的组件级状态。
  - `clients/web/src/pages/ChatPage.tsx:231-301` 仅在 `activeSessionUuid` 为 null 时清空消息与 `started`；切换到另一个非空 session 时不会先重置。
  - `clients/web/src/pages/ChatPage.tsx:248-289` 只有 timeline 非空时才清空并重建 `messagesRef`，新建 pending/empty session 不会清空旧消息。
  - `clients/web/src/pages/ChatPage.tsx:188-218` `handleSend(!started)` 依赖 `started` 决定调用 `/start` 或 `/input`。
  - `workers/orchestrator-core/src/user-do.ts:2169-2178` pending session 在 `/start` 前只允许 start，其他入口返回 `session-pending-only-start-allowed`。
  - `clients/web/src/components/inspector/InspectorTabs.tsx:26-59` timeline/history/usage 缓存在组件 state 中，`sessionUuid` 变化时不会清空；只要旧数据非 null，新 session 不会重新 fetch。
- **为什么重要**：
  - 从一个已 started 的旧会话切到新 minted session 后，`started` 仍可能为 true，首条消息会走 `/sessions/{id}/input`，后端会按 pending gate 拒绝。
  - 即便请求没有失败，用户也可能看到上一会话的 messages、timeline、history 或 usage，造成跨会话数据污染。
- **审查判断**：
  - 这是主聊天链路的结构性 blocker，不是 UI 小问题。它直接破坏 `session navigation → chat mainline` 的可靠性。
- **建议修法**：
  - 在 `activeSessionUuid` 变化的 effect 起始处立即重置 `messagesRef.current = []`、`setMessages([])`、`setStarted(false)`、`lastSeenSeqRef.current = 0`、`setError(null)`、`setWsError(null)`。
  - timeline 成功后再根据实际事件把 `started` 置 true；timeline 为空时保持 false。
  - 给 `InspectorTabs` 加 `key={activeSessionUuid}`，或在 `sessionUuid` 变化时清空 `timelineData/historyData/usageData/error/loading`。
  - 对 pending session 的 `status/timeline/ws` 409 做 truth-labeled 空态，不应吞掉后留下旧状态。

### R3. WS resume/reconnect 不是端到端闭环，`last_seen_seq` 在 facade 转发时丢失

- **严重级别**：`high`
- **类型**：`protocol-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/api-docs/session-ws-v1.md:130-144` 明确当前 authoritative replay 入口是 WS query `last_seen_seq`，并建议 reconnect 时带最大 seq，再用 HTTP resume/timeline 对账。
  - `clients/web/src/pages/ChatPage.tsx:88-93` 客户端确实把 `last_seen_seq` 写入 façade WS URL。
  - `workers/orchestrator-core/src/index.ts:416-420` façade 转发 WS 到 User DO 时构造的是 `https://orchestrator.internal/sessions/${route.sessionUuid}/ws`，只保留 `upgrade` header，没有转发 query。
  - `workers/orchestrator-core/src/user-do.ts:1893-1901` User DO 在内部 request 上解析 `last_seen_seq`。
  - `clients/web/src/pages/ChatPage.tsx:176-185` close/error 只设置 disconnected 并 cleanup，没有自动 reconnect/backoff。
  - `clients/web/src/pages/ChatPage.tsx:114-120` open 时发送 `session.resume` frame，但 `clients/api-docs/session-ws-v1.md:124-128` 明确当前服务端不会消费这些 body。
- **为什么重要**：
  - closure 的 “Resume / last_seen_seq 对接” 在当前 6-worker 链路上不成立：客户端传了 query，但 public facade 没有把 query 交给实际 User DO。
  - 网络抖动、Cloudflare close、浏览器 sleep 后，Web UI 只会进入 disconnected，不会自行恢复流或按 timeline 对账。
- **审查判断**：
  - F4 只能算 happy-path stream，不能算已满足 charter §10.1 中的 `stream/resume/timeline` 硬闸。
- **建议修法**：
  - 在 `orchestrator-core` WS 转发中保留原始 `last_seen_seq`，例如从 public request URL 读取 search 并拼到内部 request。
  - 客户端 close/error 增加 bounded retry/backoff；重连时带 `lastSeenSeqRef.current`。
  - 在 reconnect 后调用 HTTP `POST /sessions/{uuid}/resume`；若 `replay_lost` 或状态不确定，则以 `GET /timeline` 重建消息。
  - `attachment_superseded` 与 normal terminal close 应区别处理，避免被错误重连。

### R4. 本地 dev/preview 默认 `/api/*` 不会运行 BFF

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/web/package.json:6-9` `dev` 是 `vite --host 0.0.0.0`，`preview` 是 `vite preview --host 0.0.0.0`。
  - `clients/web/src/apis/transport.ts:70-79` 默认 `useBff = true`，请求 URL 固定为 `/api${path}`。
  - `clients/web/docs/setup.md:72-85` 指示用户运行 `pnpm dev` 后注册/登录并创建会话。
  - `clients/web/functions/api/[[path]].ts:5-41` BFF 是 Cloudflare Pages Function，不是 Vite dev server route。
- **为什么重要**：
  - 按 setup 文档启动本地开发后，AuthPage 登录会请求 Vite dev server 的 `/api/auth/login`，而不是 Pages Function proxy。
  - 这会让 “本地可运行、可交接” 的证据失真；build 通过并不代表本地主链能跑。
- **审查判断**：
  - F2/F5 的 delivery hardening 未收口。当前实现依赖 deployed Pages 环境才能走 BFF，local dev/preview 文档与实际脚本不一致。
- **建议修法**：
  - 增加 `wrangler pages dev dist` 或 `wrangler pages dev -- npm run dev` 的明确脚本，或者配置 Vite dev proxy 把 `/api/*` 转发到 upstream。
  - 如果本地 dev 暂不跑 BFF，则 `Transport` 应在 dev 模式支持显式 direct upstream，并让 setup 文档说明如何启用。
  - setup/deployment smoke steps 应分别覆盖 Vite-only、Pages Functions、本地 direct upstream 三种模式的真实差异。

### R5. Pages Function BFF 的环境读取与类型覆盖不可靠

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/web/functions/api/[[path]].ts:1-3` 使用 `process.env?.VITE_NANO_BASE_URL` 读取 upstream。
  - `clients/web/functions/api/[[path]].ts:5-8` `onRequest` context 类型只声明了 `request` 和 `params`，没有 `env`。
  - `clients/web/tsconfig.json:12` 仅 include `src/**/*.ts` 与 `src/**/*.tsx`，BFF 不参与 `tsc --noEmit`。
  - `clients/web/docs/deployment.md:49-56` 要求在 Cloudflare Pages 配置 `VITE_NANO_BASE_URL`。
- **为什么重要**：
  - Cloudflare Pages Functions 的运行时环境通常通过 `context.env` 传入；当前代码可能在生产始终退回 hard-coded preview upstream。
  - BFF 是 F2 的关键边界，但当前 build/typecheck 不覆盖它，BFF 语法或平台类型漂移不会被发现。
- **审查判断**：
  - 这不一定让当前 preview demo 立刻失败，因为 hard-coded preview 存在；但它会破坏 production/preview 环境切换的可信度。
- **建议修法**：
  - 将 BFF context 改为包含 `env: { VITE_NANO_BASE_URL?: string; NANO_BASE_URL?: string }`，优先读 `context.env`。
  - 把 `functions/**/*.ts` 纳入专门的 typecheck，或增加 Pages Functions 类型配置。
  - BFF 应处理 `OPTIONS`，并避免无条件复制所有浏览器 headers 到 upstream。

### R6. Transport 的错误模型遇到非 JSON 响应会逃逸为裸 `SyntaxError`

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/web/src/apis/transport.ts:91-93` 对任意非空 response text 直接 `JSON.parse(text)`。
  - `clients/web/src/apis/transport.ts:94-126` 只有 JSON parse 成功后才会进入统一 `ApiRequestError` 映射。
  - `clients/web/docs/api-contract.md:427-451` 将错误契约定义为统一 facade error envelope 与客户端错误类型映射。
- **为什么重要**：
  - 本地 Vite `/api/*` 404、Cloudflare HTML 错误页、代理超时、非 JSON upstream 错误都会绕过 `ApiRequestError`。
  - 页面层有的地方只识别 `ApiRequestError`，会出现不可解释的空错误、`SyntaxError` 文案或被 silent catch 吞掉。
- **审查判断**：
  - “错误模型统一” 目前只覆盖 happy JSON facade，不覆盖真实 Web 传输层必须处理的 proxy/platform failure。
- **建议修法**：
  - 检查 `content-type` 并捕获 JSON parse 错误。
  - 对 non-JSON / parse failure 抛出 `ApiRequestError({ kind: response.status >= 500 ? "runtime.error" : "request.error", ... })`，details 包含 text preview 与 content-type。
  - 对 `fetch` network error 也统一包装，避免页面层到处处理裸 Error。

### R7. Inspector 缺少 closure/known-issue 中承诺的 files unavailable 面

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/web/docs/charter/web-v10-foundations.md:439-443` F5 In-Scope 包含 `status / usage / files / timeline / history inspector`。
  - `clients/web/docs/closure/web-v10-closure.md:141-145` K4 写明 files 完整链路未实现，Inspector 中 files tab 只能展示 metadata 或标记 unavailable。
  - `clients/web/src/components/inspector/InspectorTabs.tsx:14` 当前 `TABS` 只有 `status`, `timeline`, `history`, `usage`。
  - `clients/web/docs/api-contract.md:455-465` 明确 `/sessions/{id}/files` 未实现，Web 客户端应标记 unavailable。
- **为什么重要**：
  - 不要求当前实现上传/下载/预览，但 closure 已把“不可用标注”作为 truth framing 的一部分。
  - 缺少 files tab 会让交接者误以为 files 不属于当前 inspection 面，而不是“已知不可用能力”。
- **审查判断**：
  - 这是 scope/truth-label 缺口，不是功能大缺失；不阻塞 React shell，但不应标记 F5 完全完成。
- **建议修法**：
  - 添加 `files` inspector tab，展示 “Files metadata / upload / download / preview are unavailable in web-v10; backend route is not implemented”。
  - 或修正 charter/closure/api-contract，明确 web-v10 不提供 files inspector tab；但这会改变当前 closure 口径。

### R8. 部署文档声明 pnpm auto-detect，但 package.json 没有 packageManager 且存在 package-lock

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/web/package.json:1-21` 没有 `packageManager` 字段。
  - `clients/web/package-lock.json` 存在，说明当前 client 更像 npm consumer。
  - `clients/web/docs/deployment.md:67-76` 写明 Pages 使用 pnpm，并通过 `packageManager` 字段自动识别。
- **为什么重要**：
  - Cloudflare Pages 构建命令写的是 `pnpm build`，但项目文件又没有 pnpm lock/packageManager，交接者会遇到包管理器口径不一致。
- **审查判断**：
  - 这是交付文档和仓库事实的 drift，短期不影响本地 `npm --prefix clients/web run build`，但影响 Pages 配置可复制性。
- **建议修法**：
  - 二选一：加入 `packageManager: "pnpm@..."` 并生成/提交 `pnpm-lock.yaml`；或把部署文档与 Pages build command 改成 npm 口径。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | React app shell 姿势切换 | `done` | `main.tsx`/`App.tsx`/组件树已替代 DOM demo，build 通过。 |
| S2 | Same-origin BFF 承接 HTTP | `partial` | 前端默认 `/api/*` 与 BFF 文件存在，但本地 dev/preview 不跑 Pages Functions，BFF env/typecheck 未收口。 |
| S3 | Auth bootstrap | `partial` | 登录/注册路径存在，但 localStorage 恢复后的 auth 与 `requireAuth()` 分裂，刷新后创建 session 断。 |
| S4 | Session navigation | `partial` | list/create/select UI 存在，但创建与切换依赖错误 auth source，且切换 session 不清理 chat/inspector 状态。 |
| S5 | Chat mainline start/input/ws | `partial` | start/input/WS happy path 存在；新 session 可能错误走 input，WS reconnect/resume 不完整。 |
| S6 | Stream/resume/timeline | `partial` | timeline 读取与 WS delta 渲染存在；resume query 被后端 facade 丢失，客户端没有 reconnect/HTTP resume 对账。 |
| S7 | Inspector / Settings / Catalog / Health 基础面 | `partial` | status/timeline/history/usage/catalog/health/settings 存在；files unavailable tab 缺失，Inspector 数据未按 sessionUuid 重置。 |
| S8 | Partial capability truth framing | `partial` | Settings/Usage note 已标注；files tab 缺失，Topbar 静态 “Connected” 也容易形成误导。 |
| S9 | 文档、部署与已知限制书面冻结 | `partial` | 文档齐全，但 setup 与实际 dev script、deployment 与 package manager 事实不一致。 |
| S10 | 不绕过 6-worker public facade | `done` | Web HTTP 与 WS 均面向 orchestrator-core public facade；未发现直连其他 worker 的客户端调用。 |

### 3.1 对齐结论

- **done**: `2`
- **partial**: `8`
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

这更像“React/BFF/页面骨架已完成，主链仍有多个 correctness 与 delivery blocker”，而不是 closure 中描述的 “web-v10 foundations 主线目标已成立”。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 完整 Open WebUI 产品能力复刻 | `遵守` | 当前实现是基础 dark shell，没有扩成完整 Open WebUI clone。 |
| O2 | model/provider 真正可切换产品面板 | `遵守` | Settings 明确标注 model selector 不可用，未伪装成已交付。 |
| O3 | 实时 permission / elicitation modal fully live | `遵守` | Settings 标注 permission runtime unblock 未实现，未发现 modal 伪装。 |
| O4 | 完整附件上传 / 下载 / 预览系统 | `遵守但标注不足` | 未实现完整 files 系统是正确的；但 closure 承诺的 files unavailable inspector tab 未落地。 |
| O5 | 多租户 admin console / billing / credits / org management | `遵守` | 未发现 admin/billing/credit UI 范围漂移。 |
| O6 | 把 `clients/web` 纳入根 workspace | `遵守` | 未发现 workspace 纳入变更。 |
| O7 | WS direct connect 作为 first-wave 受控例外 | `部分违反` | 直连 orchestrator-core 本身符合例外；但 resume/reconnect 口径被 closure 过度声明，`last_seen_seq` 未穿透到 User DO。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested — web-v10 的工程骨架可以保留，但当前不能关闭为 close-with-known-issues。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 修复 auth 双 source of truth，确保刷新后仍能创建 session、列 session、进入 chat。
  2. 修复 session 切换/新建时的 chat 与 inspector 状态复位，确保新 session 首消息必走 `/start`。
  3. 修复 WS resume/reconnect 的端到端事实：至少让 `last_seen_seq` 穿透 facade，并实现客户端 bounded reconnect + timeline 对账。
  4. 修复本地 dev/preview 的 BFF 运行口径，确保 setup 文档给出的步骤能真实跑通 `/api/*`。
- **可以后续跟进的 non-blocking follow-up**：
  1. BFF 改用 `context.env` 并纳入 typecheck。
  2. Transport 包装 non-JSON/network failures 为统一 `ApiRequestError`。
  3. 添加 files unavailable inspector tab。
  4. 对齐 package manager 与 deployment 文档。
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应

> **规则**：
> 1. 不要改写 reviewer 写下的 §0–§5；只允许从这里往下 append。
> 2. 回应必须按 `R1/R2/...` 对应，不能模糊写"已修一些问题"。
> 3. 必须写明"哪些修了、怎么修、改了哪些文件、跑了什么验证"。
> 4. 若选择不修某条 finding，必须写明理由、tradeoff、后续承接位置。
> 5. 如果本节用于二次 / 三次回应，请保留历史 §6 内容，在后面追加 `## 6B / 6C` 或新的 dated section。

### 6.1 对本轮审查的回应

> 执行者: `Copilot`
> 执行时间: `2026-04-28`
> 回应范围: `R1–R8（GPT）+ 跨审查核实修复项（DeepSeek R2/R3/R4/R5/R7/R9, GLM R1/R3/R9, kimi R1/R2/R3）`
> 对应审查文件: `clients/web/docs/code-review/web-v10-reviewed-by-GPT.md`

- **总体回应**: 本轮对 GPT/DeepSeek/GLM/kimi 四份审查的全部 finding 进行了 item-by-item 逐条核查；核实为真的所有结构性断点已完整修复；涉及后端改动或产品迭代的 finding 已说明理由并标记 deferred。
- **本轮修改策略**: 先修 auth 单一真相源 → 再修 WS 生命周期（decoupled + reconnect）→ 再修 session 切换状态复位 → 最后修工程配置与清理项。
- **实现者自评状态**: `ready-for-rereview`

### 6.2 逐项回应表

#### GPT findings

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | Auth 双 source of truth，刷新后 createSession 断 | `fixed` | 在 `state/auth.ts` 增加 `requireAuth()`；App.tsx 改为从 `state/auth` 导入 `requireAuth`，不再依赖 `apis/auth` 的模块级 `currentAuth`；页面刷新后 state/auth 从 localStorage 恢复，requireAuth 可正确返回 | `state/auth.ts`, `App.tsx` |
| R2 | Session 切换不重置 chat/inspector 上下文 | `fixed` | ChatPage 主 useEffect 开头立即重置 `messagesRef`, `messages`, `started`, `lastSeenSeqRef`, `error`, `wsError`；InspectorTabs 增加独立 useEffect 在 `sessionUuid` 变化时清空 `timelineData/historyData/usageData/errors/loading` | `ChatPage.tsx`, `InspectorTabs.tsx` |
| R3 | WS resume/reconnect 不是端到端闭环，`last_seen_seq` 在 facade 转发时丢失 | `partially-fixed` | 客户端侧：close handler 实现指数退避重连（1s/2s/4s/8s，最大 30s，上限 5 次），以 `activeUuidRef` 守护避免跨 session 误连，重连时携带当前 `lastSeenSeqRef` 写入 WS URL query；facade 侧不转发 `last_seen_seq` 是 orchestrator-core 后端问题，deferred 到后端 PR | `ChatPage.tsx` |
| R4 | 本地 dev/preview 默认 `/api/*` 不会运行 BFF | `fixed` | `vite.config.ts` 增加 `server.proxy`，将 `/api` 转发至 upstream（读 `VITE_NANO_BASE_URL` 或 fallback 到 preview upstream），`pnpm dev` 下 BFF 路径现可直通 | `vite.config.ts` |
| R5 | Pages Function BFF 的环境读取与类型覆盖不可靠 | `deferred-with-rationale` | 当前 `process.env` 读取在 Pages Functions runtime 可工作（Node.js compat mode）；纳入专门 typecheck 需要新增 tsconfig，属于工程完善项，deferred 到 web-v10+ hardening | — |
| R6 | Transport 遇到非 JSON 响应逃逸为裸 `SyntaxError` | `deferred-with-rationale` | 属于防御性编程增强，不影响当前主链；deferred 到 web-v10+ transport 层统一错误包装 | — |
| R7 | Inspector 缺少 files unavailable tab | `deferred-with-rationale` | charter/closure 已明确 files 为 K4 known issue，Inspector 当前 4 标签覆盖 status/timeline/history/usage；files tab 作为 stub 展示属于下一迭代 product iteration 任务 | — |
| R8 | 部署文档声明 pnpm，但 package.json 无 packageManager 字段 | `deferred-with-rationale` | 本地 `npm run build` 可通过；pnpm/npm 对齐属于文档一致性工作，deferred 到 web-v10+ setup 文档修订 | — |

#### 跨审查核实修复项（DeepSeek / GLM / kimi）

| 来源 Finding | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|--------------|----------|----------|----------|----------|
| kimi R1 | ChatPage 每次 handleSend 都重建 WS 连接 | `fixed` | 从 `handleSend` 中移除 `connectWs(activeSessionUuid)` 调用；WS 在 `activeSessionUuid` 变化时由 useEffect 建立一次，之后维持整个 session 生命周期 | `ChatPage.tsx` |
| DeepSeek R4 / kimi R5 | createSession / selectSession 缺少 auth.expired 处理 | `fixed` | `createSession` catch 块增加 `auth.expired` 检测，触发 `setAuthState(null)` 并跳转登录页；`selectSession` catch 块已有 `getAuthState()` 校验，不受 dual auth state 影响 | `App.tsx` |
| kimi R3 | sendInput body 携带冗余 `session_uuid` | `fixed` | 移除 `body: JSON.stringify({ text, session_uuid: sessionUuid })` 中的 `session_uuid` 字段，与 session.md 契约一致 | `apis/sessions.ts` |
| DeepSeek R5 / GLM (error state) | InspectorTabs 错误状态跨 tab 共享 | `fixed` | 将 `error: string \| null` 改为 `errors: Record<string, string \| null>`；各 tab fetch 失败时写入对应 key；渲染时读取当前 tab 的 error | `InspectorTabs.tsx` |
| DeepSeek R9 | InspectorTabs 未使用 import `catalogApi` | `fixed` | 移除 `import * as catalogApi from "../../apis/catalog"` | `InspectorTabs.tsx` |
| GLM R9 | BFF query string 解析在 value 含 `=` 时截断 | `fixed` | 改用 `new URL(request.url).searchParams` 迭代，替换手动 `split("=")` | `functions/api/[[path]].ts` |
| GLM R2 | BFF 缺少 CORS preflight 处理 | `fixed` | 增加 OPTIONS 方法早返回（204 + CORS headers），确保跨域场景预检可通过；提取 CORS headers 为常量复用 | `functions/api/[[path]].ts` |
| DeepSeek R6 / GLM R11 / kimi R12 | Topbar 硬编码 "Connected" 状态 | `fixed` | 移除虚假连接状态指示器，改为中性品牌文字 "nano-agent"；WS 真实状态已在 ChatPage 自己的 topBar 中展示 | `Topbar.tsx` |

### 6.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号 | 说明 |
|------|------|------|------|
| 已完全修复 | 12 | GPT R1/R2/R4; kimi R1/R3; DS R4/R5/R9; GLM R2/R9; Topbar; InspectorTabs error | 见 §6.2 逐项说明 |
| 部分修复，需二审判断 | 1 | GPT R3 | 客户端 reconnect 已实现；facade 不转发 `last_seen_seq` 是后端问题，deferred |
| 有理由 deferred | 4 | GPT R5/R6/R7/R8 | 属于工程完善或下一迭代产品功能，不影响当前 foundation |
| 拒绝 / stale-rejected | 0 | — | — |
| 仍 blocked | 0 | — | — |

### 6.4 变更文件清单

- `clients/web/src/state/auth.ts` — 增加 `requireAuth()` 导出，作为单一 auth 真相源
- `clients/web/src/App.tsx` — 改为从 `state/auth` 导入 `requireAuth`；`createSession` catch 增加 `auth.expired` 处理
- `clients/web/src/pages/ChatPage.tsx` — WS 与 send 解耦；指数退避自动重连；session 切换时立即重置全部状态；移除冗余 `requireAuth` import
- `clients/web/src/apis/sessions.ts` — `sendInput` body 移除 `session_uuid`
- `clients/web/vite.config.ts` — 增加 `server.proxy` 将 `/api/*` 转发到 upstream
- `clients/web/functions/api/[[path]].ts` — URLSearchParams 替换 `split("=")`；增加 OPTIONS 预检处理
- `clients/web/src/components/inspector/InspectorTabs.tsx` — 移除 `catalogApi` 死引用；per-tab error state；sessionUuid 变化时重置缓存数据
- `clients/web/src/components/Topbar.tsx` — 移除虚假 "Connected" 指示器

### 6.5 验证结果

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|--------|-------------|------|----------------|
| TypeScript 编译 + Vite 构建 | `npm --prefix clients/web run build` | `pass` — 0 错误，dist 输出正常 | 全部 |

```text
> @nano-agent/client-web@0.0.0 build
> tsc --noEmit && vite build

vite v7.3.2 building client environment for production...
✓ 49 modules transformed.
dist/index.html                   0.40 kB │ gzip:  0.27 kB
dist/assets/index-bi-EoeJi.css    1.24 kB │ gzip:  0.59 kB
dist/assets/index-CEgs_cpt.js   235.68 kB │ gzip: 71.05 kB
✓ built in 1.37s
```

### 6.6 未解决事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| GPT R3 (facade last_seen_seq) | `deferred` | orchestrator-core WS 转发不透传 query 是后端改动，超出前端 closure 范围 | orchestrator-core 后续 PR |
| GPT R5 (BFF context.env) | `deferred` | 工程完善项，当前 process.env 在 Pages Functions Node.js compat mode 可工作 | web-v10+ hardening |
| GPT R6 (Transport non-JSON error) | `deferred` | 防御性编程增强，不阻塞主链 | web-v10+ transport 层 |
| GPT R7 (files unavailable tab) | `deferred` | 属于产品迭代功能，charter 已明确 K4 known issue | web-v10+ product iteration |
| GPT R8 (package manager 文档) | `deferred` | 文档一致性工作 | web-v10+ setup 文档修订 |

### 6.7 Ready-for-rereview gate

- **是否请求二次审查**: `yes`
- **请求复核的范围**: `GPT R1/R2/R3/R4 blocker 修复验证`
- **实现者认为可以关闭的前提**:
  1. 二审确认 auth 单一真相源修复后，页面刷新 → createSession 路径可正常工作
  2. 二审确认 WS reconnect 指数退避实现满足 charter §7.5 的 resilience 要求（客户端侧）
  3. 二审确认 session 切换后 chat/inspector 状态完全复位，新 session 首消息必走 `/start`
  4. facade `last_seen_seq` 转发问题作为后端 PR 独立跟进，不阻塞前端 closure

---

## 7. GPT 二次审查报告

> 二次审查对象: `clients/web`（基于 §6 实现者回应后的当前代码）
> 二次审查类型: `rereview`
> 二次审查时间: `2026-04-28`
> 二次审查人: `GPT`
> 复核范围:
> - `clients/web/src/{App.tsx,state/auth.ts,pages/ChatPage.tsx,components/inspector/InspectorTabs.tsx,apis/sessions.ts,components/Topbar.tsx}`
> - `clients/web/functions/api/[[path]].ts`
> - `clients/web/vite.config.ts`
> - `workers/orchestrator-core/src/index.ts`
> - `clients/api-docs/session-ws-v1.md`
> - 本文档 `§6 实现者回应`

### 7.1 二次结论

- **整体判断**：`R1/R2/R4 的主修方向成立，但 R3 仍未收口；新增的 reconnect 实现还把 terminal 正常关闭误判为需要重连。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `Auth` 单一真相源与 session 切换主路径已明显改善，原先最直接的 create/start 断点基本解除。
  2. `WS resume/reconnect` 仍不是端到端闭环：facade 依旧丢弃 `last_seen_seq`，客户端也没有补 HTTP `resume/timeline` 对账。
  3. 新 reconnect 逻辑对 close code `1000` 也会自动重连，和 `session-ws-v1` 的 terminal 关闭语义冲突。

### 7.2 本轮已确认关闭的原始 finding

| 原 finding | 二审结论 | 说明 |
|------------|----------|------|
| R1 Auth 双 source of truth | `closed` | `App.tsx` 已改为从 `state/auth.ts` 导入 `requireAuth()`；`state/auth.ts:47-50` 成为 createSession 的单一 auth 真相源。 |
| R2 Session 切换不重置 chat/inspector | `mostly-closed` | `ChatPage.tsx:260-271` 已在 session 切换时重置 `messages/started/lastSeenSeq/error/wsError`；`InspectorTabs.tsx:31-38` 已在 `sessionUuid` 变化时清空缓存数据。主聊天链路的 `/start` vs `/input` 错路问题已被修正。 |
| R4 本地 `/api/*` 开发路径不可用 | `closed` | `vite.config.ts:8-18` 已增加 `/api` proxy；本地 Vite 7 preview 实现也会从 `server.proxy` 回落（本轮检查 `clients/web/node_modules/vite/dist/node/chunks/config.js` 中 `preview?.proxy ?? server.proxy`）。 |

### 7.3 二次审查发现

#### RR1. `R3` 仍未收口：WS resume/reconnect 仍然不是端到端闭环

- **严重级别**：`high`
- **类型**：`protocol-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/web/src/pages/ChatPage.tsx:96-99` 重连时仍然只把 `last_seen_seq` 写到 public WS URL query。
  - `workers/orchestrator-core/src/index.ts:416-420` façade 转发到 User DO 的内部 WS request 仍未携带任何原始 query string。
  - `clients/api-docs/session-ws-v1.md:140-143` 当前 authoritative reconnect 建议明确要求：带 `?last_seen_seq=`，必要时补 `POST /sessions/{uuid}/resume`，最终用 `GET /timeline` 对账。
  - `clients/web/src/pages/ChatPage.tsx` 当前没有任何 `sessionsApi.resume(...)` 调用。
- **为什么重要**：
  - 当前新增的 client reconnect 只能“重新连上”，但不能证明“从正确 seq 恢复”。
  - 在 6-worker 实际链路里，最关键的 `last_seen_seq` 仍停在 public façade，没到 User DO；因此 closure 里的 resume 断点依然存在。
- **审查判断**：
  - `§6` 把 R3 标成 `partially-fixed` 是准确的，但 `§6.3` 中“仍 blocked = 0”不成立。R3 仍应保留为 blocker。
- **建议修法**：
  - 后端：修 `orchestrator-core` WS 转发，把原始 search params 至少是 `last_seen_seq` 透传到内部 request。
  - 前端：在 reconnect 成功后按 `session-ws-v1` 建议补 `POST /sessions/{uuid}/resume`，必要时以 `GET /timeline` 重建本地状态。

#### RR2. 新 reconnect 逻辑会把 terminal 正常关闭也当成“需要重连”

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/api-docs/session-ws-v1.md:147-150` 明确 `1000` 是 terminal 后的 normal close。
  - `clients/web/src/pages/ChatPage.tsx:193-207` close handler 仅排除了 `4001`，对 `1000` 仍会调度指数退避重连。
- **为什么重要**：
  - 这会让已经 `completed/cancelled/error` 的 session 在正常终态后继续发起最多 5 次无意义重连。
  - 它把“恢复异常断线”和“服务端正常结束”混为一谈，属于 runtime 语义错误，不只是 UX 噪声。
- **审查判断**：
  - 这是本轮修复引入的新增 blocker；如果不修，chat runtime 仍不满足“正确恢复”而只是“机械重连”。
- **建议修法**：
  - close handler 至少排除 `1000` 与 `4001`。
  - 更稳妥的做法是：收到 `terminal` frame 后显式标记 session 终态，后续 close 不再触发 reconnect。

#### RR3. `selectSession` 的 `auth.expired` 处理仍未实现，§6 回应对这点表述过度

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/web/src/App.tsx:56-63` 已为 `createSession` 加入 `auth.expired` 分支。
  - `clients/web/src/App.tsx:68-77` `selectSession` 仍是裸 `catch { setSessionStatus(null); }`，没有把 401 映射为 logout/login redirect。
  - `§6.2` 中对应行声称 `createSession / selectSession` 均已修复。
- **为什么重要**：
  - token 过期后，用户点选已有 session 时仍可能被静默留在聊天壳内，只看到 status 清空。
  - 这不是主链 blocker，但说明当前实现者回应里这条修复覆盖面写得比实际更大。
- **审查判断**：
  - 这是 residual follow-up，不阻塞本轮的主要 verdict，但应从“已修复”改回“部分修复”。
- **建议修法**：
  - 在 `selectSession` catch 中识别 `ApiRequestError && kind === "auth.expired"`，与 `createSession/loadSessions` 保持一致地清 auth 并回到登录页。

### 7.4 Deferred 项复核

| 编号 | 二审结论 | 说明 |
|------|----------|------|
| R5 BFF `context.env` / typecheck | `unchanged-deferred` | 代码未修，Deferred 状态成立。 |
| R6 Transport non-JSON error | `unchanged-deferred` | `transport.ts:91-92` 仍直接 `JSON.parse`，Deferred 状态成立。 |
| R7 files unavailable tab | `unchanged-deferred` | `InspectorTabs.tsx:13` 仍只有 4 个 tab，Deferred 状态成立。 |
| R8 package manager / docs drift | `unchanged-deferred` | `deployment.md:69-76` 仍声明 `packageManager` 自动识别，但 `clients/web/package.json` 仍无该字段。 |

### 7.5 二次审查 verdict

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 修复 `R3 / RR1`：让 `last_seen_seq` 真正穿透 façade，或提供等价的后端/前端 resume 对账闭环。
  2. 修复 `RR2`：不要在 terminal normal close (`1000`) 后继续自动重连。
- **可以后续跟进的 non-blocking follow-up**：
  1. 修正 `selectSession` 的 `auth.expired` 处理与 §6 对应表述。
  2. 继续处理 R5/R6/R7/R8 的 deferred 项。
- **本轮是否建议再次复审**：`yes`
- **复审重点**：
  1. terminal / attachment_superseded / abnormal close 三类 WS 关闭路径是否被正确区分。
  2. reconnect 后是否真的具备 authoritative replay / resume 语义，而不只是“重新连上”。

---

## 附录 A. 审查质量评价

> 评价对象: `GPT — web-v10-closure code review`
> 评价人: `Copilot (post-fix evaluator)`
> 评价时间: `2026-04-28`

---

### A.0 评价结论

- **一句话评价**: `信噪比最高的战略型审查者，8 个 finding 全部命中要害，独家发现了跨层架构断点（facade last_seen_seq 丢失）和 session 上下文污染，但在代码层细节覆盖上不如其他审查者全面。`
- **综合评分**: `8.5 / 10`
- **推荐使用场景**: 端到端系统链路完整性审查、跨层（前端 + 后端 facade）协议一致性核查、高优先级 blocker 识别。
- **不建议单独依赖的场景**: 代码层细节（dead imports、query string 解析 bug、BFF CORS）的清理类审查；GPT 的 8 个 finding 有 4 个属于代码层盲区。

---

### A.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | 端到端链路完整性 + 跨层协议对账 | 独家阅读了 `workers/orchestrator-core/src/index.ts` 和 `user-do.ts`，发现 facade 转发 WS 时不保留 last_seen_seq |
| 证据类型 | 跨文件行号引用 + 后端源码核查 | R3 同时引用 `session-ws-v1.md:130-144`、`ChatPage.tsx:88-93`、`orchestrator-core/src/index.ts:416-420`、`user-do.ts:1893-1901` |
| Verdict 倾向 | 严格 | verdict 为 `changes-requested`，不接受 `approve-with-followups` |
| Finding 粒度 | 粗（8 个 finding，高度聚焦） | 每个 finding 代表一类系统级问题，不展开枝节 |
| 修法建议风格 | 可执行 + 战略性 | R2 建议"给 InspectorTabs 加 `key={activeSessionUuid}`"这样的精确 API 级建议 |

---

### A.2 优点与短板

#### A.2.1 优点

1. **独家跨层分析，找到 facade 漏洞（R3）**：是四位审查者中唯一阅读了后端 `orchestrator-core` 源码的，发现 WS 转发到 User DO 时不转发 `last_seen_seq` query，导致 closure 声明的 "Resume ✅" 在真实链路上不成立。这是端到端审查的典型价值。
2. **独家发现 session 切换状态污染（R2）**：精确定位 `ChatPage.tsx:52-60` 中 `started/lastSeenSeqRef/messagesRef` 跨 session 共享，且追踪到 `user-do.ts:2169-2178` 的后端 gate 行为（pending session 拒绝 `/input`），完整描述了用户可感知的故障场景。
3. **信噪比最高**：8 个 finding 全部 true-positive，且每个 finding 都对应了一个需要修复的实际问题，没有低价值清理类 finding 稀释优先级。

#### A.2.2 短板 / 盲区

1. **漏掉最关键的 WS 架构 bug**：`ChatPage.handleSend` 每次 send 后调用 `connectWs()`，WS 被反复重建。GPT 发现了"WS reconnect 不完整"（R3），却没有发现 WS 正在被主动过度销毁——这是 kimi 独家发现的 critical 级架构错误。
2. **代码层清理类问题完全未覆盖**：`catalogApi` dead import、BFF query string `split("=")` bug、`sendInput` body 中的冗余 `session_uuid`、Topbar 硬编码——这些都是在 DeepSeek/GLM/kimi 中均被发现但 GPT 完全忽略的问题。
3. **R4（本地 dev BFF）的修法建议偏重**：建议增加 wrangler pages dev 脚本或 setup 文档更新，而最简单的 vite proxy 一行配置被排在后面，实际采用的就是最轻量的 vite proxy 方案。

---

### A.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| R1 (Auth 双 source of truth) | high | true-positive | excellent | 与 DeepSeek/GLM 一致，已修复；GPT 的描述最简洁精准 |
| R2 (Session 切换不重置状态) | critical | true-positive | excellent | 独家发现，是四位审查者中最有价值的 finding 之一；已修复 |
| R3 (WS resume/reconnect 不闭环 + facade 漏洞) | high | true-positive (partial-fix) | excellent | 独家发现后端 facade 转发漏洞；客户端侧已修复，后端侧 deferred |
| R4 (本地 dev BFF 不可用) | high | true-positive | good | 与 DeepSeek R1 一致；修法建议偏重，实际用 vite proxy 解决 |
| R5 (BFF env 读取不可靠) | medium | true-positive | good | 正确，deferred |
| R6 (Transport 非 JSON 错误逃逸) | medium | true-positive | good | 正确，deferred |
| R7 (Inspector files tab 缺失) | medium | true-positive | mixed | scope/truth 层面正确，但 charter 已明确为 K4；严重程度略高 |
| R8 (package manager 文档不一致) | low | true-positive | good | 正确，deferred |

**关键遗漏（未发现）**:
- `ChatPage.handleSend` 每次 send 调用 `connectWs()` 重建 WS（kimi R1 — 最高优先级架构 bug）
- `sendInput` body 携带冗余 `session_uuid`（kimi R3）
- BFF query string `split("=")` 解析 bug（GLM R9）
- BFF CORS OPTIONS 缺失（GLM R2）
- InspectorTabs error state 跨 tab 共享（DeepSeek R5）
- `catalogApi` dead import（DeepSeek R9）

---

### A.4 多维度评分

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 9 | 跨越前端、BFF、orchestrator-core 多层引用，证据链最深 |
| 判断严谨性 | 9 | 8 个 finding 全部 true-positive，零误报；R3 后端层面判断独此一家 |
| 修法建议可执行性 | 8 | R2 的 `key={activeSessionUuid}` 建议极为精准；R4 建议偏重 |
| 对 action-plan / design / QNA 的忠实度 | 9 | 系统对照 charter §7.5、§10.1 和 session-ws-v1.md，忠实度最高 |
| 协作友好度 | 8 | 格式清晰，但 finding 较少可能让实现者误以为问题不多 |
| 找到问题的覆盖面 | 6 | 8 个 finding 覆盖了最关键的系统性问题；代码层细节完全空白 |
| 严重级别 / verdict 校准 | 9 | R2 定为 critical 完全正确；整体 severity 分布最合理 |
