# GLM 审查报告逐条 Reasoning

## 审查结论总览

GLM 的审查非常专业且深入，基于后端源码、API 文档和小程序现有代码做了交叉验证。16 条建议中，**全部接受**，但部分建议需要在计划中调整优先级或合并实现。

---

## 1. 计划本身的设计缺陷

### 1.1 [Critical] stream.js 只封装了 4 种 WS frame — 应预留未来帧类型

**GLM 建议**: 预留 `onOpened`, `onPermissionRequest`, `onUsageUpdate`, `onElicitationRequest` 四个可选回调。

**Reasoning**: **接受并采纳**。后端 `NanoOrchestratorUserDO.emitServerFrame()` 虽然当前未被调用，但 schema 已定义。如果后端未来启用这些帧类型，小程序侧不需要重新设计接口。计划在 P3-01 中增加这些预留回调，并在 JSDoc 中标注 "当前后端未发送此帧"。

**修改方式**: P3-01 的 callbacks 定义增加四个 optional 回调。

---

### 1.2 [Critical] api/session.js 缺少 usage() 代理函数

**GLM 建议**: 在 P2-02 中增加 `usage(sessionUuid)` 函数。

**Reasoning**: **接受并采纳**。这是明显的遗漏。`apiRoutes.js` 和 `utils/api.js` 中已有 `sessionUsage` 定义和 helper，但计划 P2-02 的 8 个函数列表中遗漏了它。`usage` 接口的 `durable_truth` 字段已经有用（message_count, activity_count, last_event_seq），且未来后端启用真实 usage 数据后可以无缝切换。

**修改方式**: P2-02 增加第 9 个函数 `usage(sessionUuid)`，并标注当前 usage 字段为 placeholder。

---

### 1.3 [Medium] api/auth.js 遗漏了 verifyToken 使用场景

**GLM 建议**: 在 `api/auth.js` 中明确标注 `verifyToken` 的推荐使用场景（app.onLaunch 中校验），并在 `app.js` 的 `onLaunch` 中添加 token 校验逻辑。

**Reasoning**: **接受并采纳**。当前小程序登录后只存储 token，没有在冷启动时验证 token 有效性。GLM 指出的最佳实践（登录获取 → 可选 verify → 401 时 refresh）是正确的。计划在 P2-01 中增加 `verifyToken` 的使用场景说明，并在 P4-01（auth 页面迁移）中同步更新 `app.js` 的 `onLaunch` 逻辑。

**修改方式**: P2-01 增加 `verifyToken` 使用场景 JSDoc；P4-01 增加 `app.js` 的 token 冷启动校验。

---

### 1.4 [Medium] api/me.js 只有 2 个函数 — 需要明确 getProfile() 归属

**GLM 建议**: `getProfile()`（即 GET /me 或 GET /auth/me）应放在 `api/auth.js`，`api/me.js` 只负责 session 管理。

**Reasoning**: **接受并采纳**。当前 `pages/profile/index.js` 调用的是 `api.request('me')`，而 `auth.js` 已有 `getMe()`。两者是同一接口的不同路由别名。从模块语义看，`getMe()` 放在 `auth.js` 更合理（身份认证相关的读取），`me.js` 只负责 `/me/sessions` 相关。这样可以避免模块边界模糊。

**修改方式**: P2-01 中 `getMe()` JSDoc 标注 "等效于 GET /me"；P2-03 保持只含 `createSession()` 和 `listSessions()`。

---

## 2. 计划与后端真实行为的偏差

### 2.1 [Critical] 后端 session_status vs status 字段不只是命名不一致

**GLM 建议**: 需要明确 legacy action payload → facade envelope 的转换策略，特别处理 `start` 返回 `status` 而 `input` 返回 `session_status` 的差异。

**Reasoning**: **接受并采纳**。这是计划中最关键的遗漏。后端存在两种完全不同的成功返回格式：
- `start`/`input`/`cancel`/`getStatus`/`getTimeline`/`getHistory`/`verify` — 扁平结构 `{ok, action, ..., trace_uuid}`
- `resume` — 嵌套结构 `{ok, data: {...}, trace_uuid}`

代理层必须统一转换为标准 envelope `{ok, data, error, trace_uuid}`。对于扁平结构，需要将所有非 `ok`/`trace_uuid` 字段提取到 `data` 中；对于 `session_status` vs `status`，统一映射为 `status`。

**修改方式**: P2-02 的 "具体功能预期" 中增加详细的转换策略伪代码，并在风险提醒中强调此问题。

---

### 2.2 [Critical] POST /me/sessions 的 "pending" 语义陷阱

**GLM 建议**: `createSession()` 应在 JSDoc 中明确标注 "pending session 不会出现在 listSessions() 中"，且小程序本地应维护 pending sessions 列表。

**Reasoning**: **接受并采纳**。后端文档明确说明 "freshly minted 但尚未 /start 的 UUID，不会出现在 GET /me/sessions 列表里"。这会导致用户创建 session 后刷新页面，session 从列表中消失。代理层需要透明化此行为，并在 JSDoc 中标注。

**修改方式**: P2-03 的 `createSession()` 和 `listSessions()` JSDoc 中明确标注此行为差异。

---

### 2.3 [Medium] GET /sessions/{uuid}/usage 返回全 null 值

**GLM 建议**: `usage()` 函数的 JSDoc 中明确标注当前 usage 字段为 placeholder，以及 `durable_truth` 字段的可用值。

**Reasoning**: **接受并采纳**。虽然这与 1.2 是同一个函数，但 GLM 特别强调了 usage 字段全为 null 的事实。代理层需要在 JSDoc 中诚实标注，避免页面开发者误以为能获取到真实的 token 消耗数据。

**修改方式**: 与 1.2 合并，在 P2-02 新增的 `usage()` 函数 JSDoc 中标注。

---

### 2.4 [Medium] WS 重连策略缺少 last_seen_seq 持久化

**GLM 建议**: `api/stream.js` 应在每次收到 event 时自动将 `lastSeenSeq` 持久化到 `wx.setStorageSync`，并在 `connect()` 时自动恢复。

**Reasoning**: **接受并采纳**。当前 `nano-client.js` 的 `lastSeenSeq` 是内存变量，小程序切后台后会丢失。持久化到 storage 是 WS 可靠性的基础要求。

**修改方式**: P3-01 增加 `lastSeenSeq` 自动持久化和恢复逻辑。

---

### 2.5 [Low] utils/api.js 的 request() 有 401 自动重试逻辑

**GLM 建议**: 代理层不应重复实现 401 处理，`auth.refresh()` 应直接调用 `utils/api.js` 的 `request()`。

**Reasoning**: **接受并采纳**。当前 `utils/api.js` 已经有完善的 token 刷新队列机制（多个并发 401 只刷新一次，其他请求排队等待）。代理层如果自行实现 `refresh()` 会绕过这个机制，导致竞态条件。

**修改方式**: P2-01 增加 `auth.refresh()` 实现约束 — 必须调用 `utils/api.js` 的 `request('refresh', ...)`。

---

## 3. 计划对后端缺口的影响

### 3.1 [Critical] 代理层只代理了已存在的接口 — 但小程序的核心体验缺口仍未解决

**GLM 建议**: 在每个代理模块文件头部，增加 `// NOT YET AVAILABLE` 注释块，列出对应的缺失后端接口。

**Reasoning**: **接受并采纳**。这是一个非常好的开发者体验改进。当前后端缺失的接口（`POST /sessions/{id}/messages`、`GET /sessions/{id}/files` 等）会导致小程序功能受限，但代理层不应该静默忽略它们。通过注释块明确标注：
1. 开发者知道哪些功能暂时不可用
2. 后端启用新接口时，开发者知道在代理层的哪个模块添加
3. 不会因为找不到接口而认为是代理层遗漏

**修改方式**: 在 Phase 2 的每个模块实现要求中，增加 "文件头部必须包含 NOT YET AVAILABLE 注释块" 的约束。

---

### 3.2 [Medium] catalog 接口返回空数组 — 小程序需要优雅退化

**GLM 建议**: `api/catalog.js` 在 JSDoc 中明确标注当前后端返回空数组，且代理层函数应返回空数组而非 null。

**Reasoning**: **接受并采纳**。后端三个 catalog 接口当前 hard-coded 返回空数组。代理层应该让页面层可以安全地 `listSkills().then(skills => skills.length && renderSkills(skills))`，而不是处理 null。

**修改方式**: P2-04 的 `listSkills()`/`listCommands()`/`listAgents()` 返回值明确为 `[]` 而非 null，JSDoc 中标注后端当前返回空数组。

---

### 3.3 [Medium] 小程序 WS 是单向流 — 这与 CLI 的交互模型根本不同

**GLM 建议**: `api/stream.js` 和 `api/permission.js` 的 JSDoc 应明确标注当前限制，不应暗示这些交互已经可用。

**Reasoning**: **接受并采纳**。当前 WS 客户端发送的 `heartbeat`/`resume`/`ack` 消息不被服务端处理，`permission.js` 的决策也只记录到 hot state 不实际拦截工具执行。如果代理层的 JSDoc 暗示这些功能已可用，会导致页面开发者产生错误预期。

**修改方式**: P2-05 和 P3-02 的 JSDoc 中增加明确的限制说明。

---

## 4. 额外发现的问题

### 4.1 [High] pages/session/index.js 硬编码了 base URL

**GLM 建议**: WS base URL 应统一从 `apiRoutes.js` 获取，`api/stream.js` 的 `connect()` 应接受 `baseUrl` 参数（或从 `apiRoutes.js` 读取默认值）。

**Reasoning**: **接受并采纳**。当前 `pages/session/index.js` 第 78 行硬编码了 preview 环境的 URL，切换到 production 时容易遗漏。`api/stream.js` 应该从 `apiRoutes.js` 读取 base URL，与 HTTP 代理保持一致。

**修改方式**: P1-03（新增）增强 `apiRoutes.js`，增加 `wsBaseUrl` 配置；P3-01 的 `connect()` 从 `apiRoutes.js` 读取默认 base URL。

---

### 4.2 [Medium] apiRoutes.js 缺少 requireAuth 元数据

**GLM 建议**: 在 `apiRoutes.js` 中增加 `requireAuth` 字段，代理层从路由定义中读取，不需要每个函数手动传。

**Reasoning**: **接受并采纳**。当前 `apiRoutes.js` 只定义了 `method` 和 `path`，代理层函数需要手动控制 `requireAuth`。增加元数据后，代理层可以统一处理，减少重复代码。

**修改方式**: P1-03（新增）在 `apiRoutes.js` 中增加 `requireAuth` 字段。

---

### 4.3 [Medium] 小程序的 WS 连接缺少断线重连逻辑

**GLM 建议**: `api/stream.js` 应实现指数退避自动重连（初始 1s，最大 30s），重连时传入 `last_seen_seq`，失败超过阈值后回调 `onPermanentDisconnect`。

**Reasoning**: **接受并采纳**。当前 `nano-client.js` 在连接断开时只调用 `onState('close')`，没有自动重连。根据后端 WS 文档的建议，重连策略是可靠性的基础。这个逻辑应该在封装层实现，而不是让每个页面自己处理。

**修改方式**: 与 2.4 合并，P3-01 增加自动重连逻辑。

---

### 4.4 [Low] e2e 测试框架选择

**GLM 建议**: 明确 e2e 测试技术方案，推荐 Node.js 直接 HTTP 测试 + mock `wx.request`（方案 A）。

**Reasoning**: **接受并采纳**。计划中只提到 "小程序环境不支持标准单测框架"，但没有明确 e2e 的实现方式。GLM 推荐的方案 A 最符合我们的目标（跳过页面 UI，直接测试 API 代理层），且不需要引入复杂的小程序模拟环境。

**修改方式**: P4-05 中明确 e2e 技术方案为 Node.js + vitest/jest，通过 mock `wx.request` 和 `wx.connectSocket` 来测试 `api/` 层。

---

### 4.5 [Low] OAuth token 刷新的竞态条件

**GLM 建议**: `auth.refresh()` 应该直接调用 `utils/api.js` 的 `request('refresh', ...)` 以复用现有的 token 刷新队列机制。

**Reasoning**: **接受并采纳**。这与 2.5 是同一个问题。`utils/api.js` 已经有完善的 token 刷新队列，代理层不应该绕过它。

**修改方式**: 与 2.5 合并，在 P2-01 中增加约束。

---

## 5. 结构性建议总结

### 5.1 P1 与 P2 之间：增加 apiRoutes.js 增强

**GLM 建议**: 在 P1 中同时增强 `apiRoutes.js`：增加 `requireAuth` 字段、`wsBaseUrl` 配置、可选 `responseShape` 字段。

**Reasoning**: **接受并采纳**。`apiRoutes.js` 是当前已经存在的基础设施，增强它不需要额外的工作量，而且可以解决硬编码 URL 和 requireAuth 重复的问题。建议将其作为 P1-03 加入计划。

**修改方式**: 新增 P1-03 工作项。

---

### 5.2 P2 中 session.js 应最优先实现

**GLM 建议**: 5 个代理模块中，`session.js` 最复杂，应最优先实现。

**Reasoning**: **接受**。当前计划中的实现顺序已经是 `auth.js` → `session.js` → `me.js` → `permission.js` → `catalog.js`，与 GLM 建议一致。无需调整顺序，但需要在计划中明确标注 `session.js` 的复杂度最高，分配更多时间。

**修改方式**: 在 P2 说明中强调 `session.js` 复杂度最高，建议分配更多时间。

---

### 5.3 P3 的 WS 封装应考虑重连逻辑

**GLM 建议**: P3-01 应一并实现 `lastSeenSeq` 持久化、指数退避重连、重连后事件补齐。

**Reasoning**: **接受并采纳**。当前 P3-01 只封装了 `connect/disconnect/getLastSeenSeq`，缺少可靠性相关的逻辑。将重连逻辑纳入 P3-01 可以避免页面层重复实现。

**修改方式**: P3-01 的 "具体功能预期" 中增加重连相关功能。

---

## 综合修改清单

基于以上 reasoning，对 `new-apis.md` 的修改如下：

### Phase 1 修改
- [新增 P1-03] 增强 `apiRoutes.js`：增加 `requireAuth` 字段、`wsBaseUrl` 配置

### Phase 2 修改
- [P2-01] `auth.js`：明确 `verifyToken` 使用场景（app.onLaunch 冷启动校验）；`getMe()` JSDoc 标注 "等效于 GET /me"；`refresh()` 约束为必须调用 `utils/api.js` 的 `request()`
- [P2-02] `session.js`：增加第 9 个函数 `usage(sessionUuid)`；详细描述 legacy → facade 转换策略（含伪代码）；明确 `session_status` vs `status` 统一映射为 `status`；增加 `NOT YET AVAILABLE` 注释块
- [P2-03] `me.js`：`createSession()` 和 `listSessions()` JSDoc 标注 pending session 不在列表中的行为；增加 `NOT YET AVAILABLE` 注释块
- [P2-04] `catalog.js`：JSDoc 标注当前后端返回空数组，函数返回 `[]` 而非 null；增加 `NOT YET AVAILABLE` 注释块
- [P2-05] `permission.js`：JSDoc 标注当前决策不实际拦截工具执行；增加 `NOT YET AVAILABLE` 注释块

### Phase 3 修改
- [P3-01] `stream.js`：callbacks 增加四个预留回调（`onOpened`, `onPermissionRequest`, `onUsageUpdate`, `onElicitationRequest`）；增加 `lastSeenSeq` 自动持久化和恢复；增加指数退避自动重连（初始 1s，最大 30s，阈值 5 次）；`connect()` 从 `apiRoutes.js` 读取默认 base URL
- [P3-02] WS 事件转换 JSDoc 中标注当前 WS 是单向流，客户端消息不被服务端消费

### Phase 4 修改
- [P4-01] 增加 `app.js` 的 `onLaunch` token 冷启动校验
- [P4-03] 解决硬编码 base URL 问题（通过 `api/stream.js` 的统一封装）
- [P4-05] 明确 e2e 技术方案：Node.js + vitest/jest，mock `wx.request` 和 `wx.connectSocket`

### Out-of-Scope 修改
- [新增 O6] 不处理后端已定义但未实现的 WS 帧类型（`meta(opened)`, `session.permission.request`, `session.usage.update`, `session.elicitation.request`）— 但 `api/stream.js` 已预留回调接口

### 全局修改
- 增加 "每个代理模块文件头部必须包含 `// NOT YET AVAILABLE` 注释块" 的约束
- 风险表中增加 "后端已定义但未实现的 WS 帧类型" 和 "WS 单向流限制" 两项风险
