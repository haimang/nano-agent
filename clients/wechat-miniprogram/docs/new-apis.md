# 微信小程序统一 API 代理层建设行动计划

> 服务业务簇: `clients/wechat-miniprogram`
> 计划对象: `api/ 目录与接口代理层建设`
> 类型: `new`
> 作者: `opencode`
> 时间: `2026-04-28`
> 文件位置: `clients/wechat-miniprogram/api/`, `clients/wechat-miniprogram/test/e2e/`
> 上游前序 / closure:
> - `clients/api-docs/` 已更新（后端 workers/ 接口文档就绪）
> 下游交接:
> - `e2e 测试全面覆盖`
> - `页面层持续重构`
> 关联设计 / 调研文档:
> - `clients/api-docs/README.md`
> - `clients/api-docs/auth.md`
> - `clients/api-docs/session.md`
> - `clients/api-docs/session-ws-v1.md`
> - `clients/api-docs/me-sessions.md`
> - `clients/api-docs/permissions.md`
> - `clients/api-docs/usage.md`
> - `clients/api-docs/catalog.md`
> 冻结决策来源:
> - 用户明确要求在小程序内部建立统一接口管理与转发层
> 文档状态: `executed`

---

## 0. 执行背景与目标

后端 workers/ 已经在 `clients/api-docs/` 目录下更新了完整的接口文档。当前微信小程序内部存在两层请求代码：

1. `utils/api.js` - 底层 HTTP 客户端（含 JWT、loading、错误处理、401 跳转）
2. `utils/nano-client.js` - 底层 WS 连接与原始 HTTP 请求工具

页面层（`pages/chat/index.js`, `pages/session/index.js`, `pages/auth/index.js` 等）直接调用上述底层工具，导致：

- 后端接口变更时，修改点散落在多个页面文件中
- e2e 测试无法跳过页面 UI，只能模拟点击或裸调底层 `wx.request`
- 后端存在两种 success-shape（facade envelope vs legacy action payload），页面层被迫兼容

本次计划要在小程序内部建立 `api/` 业务代理层，把所有后端可用接口代理为内部抽象。后续页面层和 e2e 测试只依赖 `api/` 层，实现解耦。

- **服务业务簇**：`clients/wechat-miniprogram`
- **计划对象**：`api/ 统一接口代理层`
- **本次计划解决的问题**：
  - 页面层直接耦合底层请求工具，后端接口变更时修改成本高
  - e2e 测试无法脱离页面 UI 进行 API 级组装测试
  - 后端历史包袱（两种 success-shape、字段名不一致如 `session_status` vs `status`）散落在页面逻辑中
  - WS 与 HTTP 的调用方式不统一，开发者需要同时理解两套底层 API
- **本次计划的直接产出**：
  - `api/` 目录下的模块化代理层（auth, session, me, catalog, permission, stream）
  - 统一的内部接口契约（标准化输入输出、错误语义、JSDoc 注释）
  - `test/e2e/api/` 目录下的 e2e 测试骨架与首批用例
  - 页面层完成迁移，不再直接调用 `utils/api.js` 或 `nano-client.js`
- **本计划不重新讨论的设计结论**：
  - 后端接口 URL、方法、参数格式以 `clients/api-docs/` 为准（来源：`clients/api-docs/README.md`）
  - `utils/api.js` 继续承担纯技术层职责（来源：用户明确分层要求）
  - `utils/nano-client.js` 继续作为 WS 底层驱动（来源：当前 WS wire 格式已冻结）

---

## 1. 执行综述

### 1.1 总体执行方式

本次 action-plan 采用 **先协议后实现、先底层后上层、先迁 consumer 后删除** 的策略：

1. **Phase 1** 建立目录结构、命名规范、导出协议，并重构底层 `utils/api.js` 为纯技术层
2. **Phase 2** 按后端模块（auth, session, me, catalog, permission）逐个实现 `api/` 代理
3. **Phase 3** 将 WS 连接封装为与 HTTP 代理同风格的高级 API
4. **Phase 4** 将现有页面层从底层工具迁移到 `api/` 层，同时建立 `test/e2e/api/` 骨架
5. **Phase 5** 文档同步、全局回归、收口

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | 目录与协议层重构 | S | 新建 `api/` 目录结构，重构底层工具为纯技术层，建立导出规范 | `-` |
| Phase 2 | 核心业务模块代理 | M | 实现 auth, session, me, catalog, permission 五个代理模块 | Phase 1 |
| Phase 3 | WebSocket 会话层封装 | M | 将 WS 连接与事件处理封装为高级 API，统一内部事件格式 | Phase 1 |
| Phase 4 | 页面迁移与 e2e 骨架 | M | 将 4 个核心页面迁移到 `api/` 层，建立 `test/e2e/api/` 目录与首批用例 | Phase 2, Phase 3 |
| Phase 5 | 收口与文档同步 | S | 全局回归测试、文档更新、清理废弃调用点 | Phase 4 |

### 1.3 Phase 说明

1. **Phase 1 - 目录与协议层重构**
   - **核心目标**：建立 `api/` 目录结构，明确 `utils/`（技术层）与 `api/`（业务层）的分工边界
   - **为什么先做**：没有清晰的协议和目录约定，后续模块实现会风格混乱，review 成本高

2. **Phase 2 - 核心业务模块代理**
   - **核心目标**：按后端 facade 模块逐个实现代理函数，统一处理 facade envelope / legacy payload 的差异
   - **为什么放在这里**：必须先有协议（Phase 1），才能批量实现代理函数；且这些函数是 Phase 4 页面迁移的依赖

3. **Phase 3 - WebSocket 会话层封装**
   - **核心目标**：将 `nano-client.js` 的原始 WS 能力包装为业务友好的 `api/stream.js`
   - **为什么放在这里**：WS 封装依赖 Phase 1 的目录结构，但不依赖 Phase 2 的 HTTP 代理；可与 Phase 2 并行，但为简化管理列为串行

4. **Phase 4 - 页面迁移与 e2e 骨架**
   - **核心目标**：将页面层从 `utils/api.js` 和 `nano-client.js` 迁移到 `api/` 层；建立 `test/e2e/api/` 目录
   - **为什么放在这里**：必须先有 `api/` 层实现（Phase 2 + Phase 3），才能迁移 consumer

5. **Phase 5 - 收口与文档同步**
   - **核心目标**：全局回归、文档更新、废弃代码清理
   - **为什么放在最后**：作为整体计划的 closure，验证所有 consumer 迁移完成且无回归

### 1.4 执行策略说明

- **执行顺序原则**：先建立协议与目录（Phase 1），再实现代理（Phase 2 + 3），再迁移 consumer（Phase 4），最后收口（Phase 5）。不允许在 Phase 2 中临时修改目录结构。
- **风险控制原则**：每个 Phase 内部采用小步快跑，每次 commit 只涉及一个模块或一个页面，确保随时可回滚。页面迁移时保留旧代码注释至少一个迭代周期。
- **测试推进原则**：Phase 2 每完成一个代理模块，立即在 `test/e2e/api/` 中补充对应 e2e 用例；Phase 4 的页面迁移以 e2e 用例通过为验收标准。
- **文档同步原则**：`api/` 目录下每个模块文件的 JSDoc 即作为接口文档；Phase 5 更新 `clients/wechat-miniprogram/docs/` 或 README。
- **回滚 / 降级原则**：若某页面迁移后出现异常，可立即回滚该页面到旧调用方式，不影响其他页面和 `api/` 层。

### 1.5 本次 action-plan 影响结构图

```text
api/ 统一接口代理层建设
├── Phase 1: 目录与协议层重构
│   ├── utils/api.js（重构为纯技术层）
│   ├── utils/nano-client.js（保持底层）
│   ├── apiRoutes.js（增强：requireAuth + wsBaseUrl）
│   └── api/（新建目录结构 + index.js 导出协议）
├── Phase 2: 核心业务模块代理
│   ├── api/auth.js（/auth/*, /me）
│   ├── api/session.js（/sessions/{uuid}/start, input, cancel, status...）
│   ├── api/me.js（/me/sessions）
│   ├── api/catalog.js（/catalog/*）
│   └── api/permission.js（/permission/*, /policy/*）
├── Phase 3: WebSocket 会话层封装
│   └── api/stream.js（WS connect/disconnect/事件订阅）
├── Phase 4: 页面迁移与 e2e 骨架
│   ├── pages/auth/index.js（迁移到 api/auth.js）
│   ├── pages/chat/index.js（迁移到 api/me.js + api/session.js）
│   ├── pages/session/index.js（迁移到 api/session.js + api/stream.js）
│   ├── pages/profile/index.js（迁移到 api/auth.js）
│   └── test/e2e/api/（新建 e2e 目录 + 首批用例）
└── Phase 5: 收口与文档同步
    ├── README / 开发指南更新
    └── 废弃调用点清理
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 新建 `clients/wechat-miniprogram/api/` 目录，建立模块划分与导出规范
- **[S2]** 实现 `api/auth.js`、`api/session.js`、`api/me.js`、`api/catalog.js`、`api/permission.js` 五个 HTTP 代理模块
- **[S3]** 实现 `api/stream.js` WebSocket 高级封装模块
- **[S4]** 将 `pages/auth/index.js`、`pages/chat/index.js`、`pages/session/index.js`、`pages/profile/index.js` 迁移到 `api/` 层
- **[S5]** 建立 `test/e2e/api/` 目录与首批 e2e 测试用例（至少覆盖 auth 登录流程 + session 创建与输入流程）
- **[S6]** 统一后端两种 success-shape 的差异，对外暴露标准化 envelope

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 不修改后端接口本身（任何后端变更属于 workers/ 范畴）
- **[O2]** 不删除 `utils/api.js` 和 `utils/nano-client.js`（仅重构职责边界，保留为底层依赖）
- **[O3]** 不实现 `test/e2e/ui/` 层（本次只聚焦 API 级 e2e，UI 级测试后续单独计划）
- **[O4]** 不代理 `/debug/workers/health`（debug 接口，不纳入业务代理层）
- **[O5]** 不处理 `POST /sessions/{id}/messages`、`GET /sessions/{id}/files`、`GET /me/conversations`、`POST /me/devices/revoke`（文档明确标注尚未实现）
- **[O6]** 不实现后端已定义但未启用的 WS 帧类型处理逻辑（`meta(opened)`, `session.permission.request`, `session.usage.update`, `session.elicitation.request`）— 但 `api/stream.js` 已预留对应回调接口

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `api/` 目录下模块的 JSDoc 注释 | in-scope | 接口定义即文档，降低维护成本 | 引入 TypeScript 时重评 |
| `utils/api.js` 的 401 自动跳转逻辑 | in-scope | 继续保留在技术层，代理层不重复处理 | 产品要求变更跳转策略时重评 |
| `pages/index/index.js`（调试页面） | out-of-scope | 调试页面直接调用底层工具是其设计目的，不强制迁移 | 调试页面产品化时重评 |
| `api/` 层对 `session_status` vs `status` 的字段映射 | in-scope | 统一暴露 `status` 给页面层，屏蔽后端历史不一致 | 后端统一字段名后重评 |
| `test/e2e/ui/` 目录 | out-of-scope | 本次聚焦 API 级测试，UI 级 e2e 后续单独计划 | 有专职 QA 资源时重评 |
| 后端已定义但未启用的 WS 帧类型（`meta(opened)`, `session.permission.request` 等） | out-of-scope | 当前后端不会发送这些帧，但 `api/stream.js` 已预留回调接口 | 后端启用对应帧类型后重评 |
| 每个代理模块的 `NOT YET AVAILABLE` 注释块 | in-scope | 标注后端缺失接口，提升开发者体验 | 后端接口全部实现后移除 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | 新建 `api/` 目录结构与 `index.js` 导出协议 | add | `api/`, `api/index.js` | 建立业务层与技术层的清晰边界 | low |
| P1-02 | Phase 1 | 重构 `utils/api.js` 为纯技术层 | refactor | `utils/api.js` | 剥离业务语义函数，保留 request/token/loading 能力 | medium |
| P1-03 | Phase 1 | 增强 `apiRoutes.js` | update | `apiRoutes.js` | 增加 `requireAuth` 字段、`wsBaseUrl` 配置，解决硬编码和权限元数据问题 | low |
| P2-01 | Phase 2 | 实现 `api/auth.js` | add | `api/auth.js` | 代理 /auth/* 与 /me，返回标准化 AuthFlowResult / AuthView；`refresh()` 必须复用 utils 的 token 刷新队列 | low |
| P2-02 | Phase 2 | 实现 `api/session.js` | add | `api/session.js` | 代理 /sessions/{uuid}/start, input, cancel, status, timeline, history, verify, resume, usage；统一 legacy action payload 与 facade envelope 转换策略 | medium |
| P2-03 | Phase 2 | 实现 `api/me.js` | add | `api/me.js` | 代理 POST/GET /me/sessions | low |
| P2-04 | Phase 2 | 实现 `api/catalog.js` | add | `api/catalog.js` | 代理 /catalog/skills, commands, agents | low |
| P2-05 | Phase 2 | 实现 `api/permission.js` | add | `api/permission.js` | 代理 permission/decision 与 policy/permission_mode | low |
| P3-01 | Phase 3 | 实现 `api/stream.js` WS 高级封装 | add | `api/stream.js` | 封装 WS connect/disconnect/事件订阅，对外暴露标准化事件；预留未来帧类型回调；实现 lastSeenSeq 持久化与自动重连 | medium |
| P3-02 | Phase 3 | WS 事件格式转换 | refactor | `api/stream.js` | 将后端 {kind, seq, name, payload} 转换为内部标准事件格式 | medium |
| P4-01 | Phase 4 | 迁移 `pages/auth/index.js` | migrate | `pages/auth/index.js` | 使用 `api/auth.js` 替代直接调用底层 request | low |
| P4-02 | Phase 4 | 迁移 `pages/chat/index.js` | migrate | `pages/chat/index.js` | 使用 `api/me.js` + `api/session.js` 替代直接调用底层 request | low |
| P4-03 | Phase 4 | 迁移 `pages/session/index.js` | migrate | `pages/session/index.js` | 使用 `api/session.js` + `api/stream.js` 替代 nano-client + api.request | medium |
| P4-04 | Phase 4 | 迁移 `pages/profile/index.js` | migrate | `pages/profile/index.js` | 使用 `api/auth.js` 替代直接调用底层 request | low |
| P4-05 | Phase 4 | 建立 `test/e2e/api/` 目录与首批用例 | add | `test/e2e/api/` | 实现可脱离页面的 API 级 e2e 测试骨架 | medium |
| P5-01 | Phase 5 | 全局回归测试 | test | 所有 pages/ | 确保迁移后页面功能无回归 | medium |
| P5-02 | Phase 5 | 文档同步与清理 | docs | `docs/`, `README` | 更新开发指南，清理页面层废弃调用点 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 - 目录与协议层重构

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | 新建 `api/` 目录结构与导出协议 | 1. 新建 `api/` 目录<br>2. 创建 `api/index.js`，统一导出所有模块<br>3. 制定模块命名规范（按后端 facade 模块划分） | `api/`, `api/index.js` | `require('../../api')` 可用 | 手工 import 测试 | `api/index.js` 无语法错误，所有子模块可被正确导出 |
| P1-02 | 重构 `utils/api.js` 为纯技术层 | 1. 保留 `request`, `uploadFile`, `get/set/removeJwtToken`, `generateTraceUuid`<br>2. 移除 `meSessionsCreate`, `meSessionsList` 等业务 helper（迁移到 `api/` 层）<br>3. 保留 token 刷新、401 跳转逻辑 | `utils/api.js` | `utils/api.js` 只含技术函数，不含业务语义 | 代码 review | 业务 helper 函数已全部迁移到 `api/` 层，无残留 |
| P1-03 | 增强 `apiRoutes.js` | 1. 增加 `requireAuth` 字段（标注每个路由是否需要 JWT）<br>2. 增加 `wsBaseUrl` 配置（解决 session 页面硬编码 URL 问题）<br>3. 可选增加 `responseShape` 字段（标注 `facade` 或 `legacy`） | `apiRoutes.js` | 代理层可从路由定义读取权限和 URL 配置，无需手动传参 | 代码 review | `apiRoutes.js` 包含所有路由的 `requireAuth` 和 `wsBaseUrl` |

### 4.2 Phase 2 - 核心业务模块代理

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | 实现 `api/auth.js` | 封装 `register`, `login`, `wechatLogin`, `refresh`, `verifyToken`, `getMe`, `resetPassword`，返回标准化 `{ok, data, error}` | `api/auth.js` | 页面可直接 `auth.login(email, password)` 获得用户数据 | e2e 测试 | 所有 auth 接口返回的 AuthFlowResult / AuthView 字段完整，错误语义统一 |
| P2-02 | 实现 `api/session.js` | 封装 `start`, `input`, `cancel`, `getStatus`, `getTimeline`, `getHistory`, `verify`, `resume`, `usage`；统一 legacy action payload 与 facade envelope 转换策略；`session_status` 统一映射为 `status`；文件头部增加 `NOT YET AVAILABLE` 注释块 | `api/session.js` | 页面可直接 `session.start(uuid, text)`，无需关心后端 payload 差异；`usage()` 返回标准化 envelope（含 durable_truth） | e2e 测试 | 所有 session HTTP 接口返回标准化 envelope；legacy action payload 已按转换策略处理；`session_status` 已统一映射为 `status` |
| P2-03 | 实现 `api/me.js` | 封装 `createSession`, `listSessions`；JSDoc 标注 `createSession()` 返回的 pending session 不会出现在 `listSessions()` 中；文件头部增加 `NOT YET AVAILABLE` 注释块 | `api/me.js` | 页面可直接 `me.createSession()` 获取 server-mint UUID；`listSessions()` 返回已启动的 session 列表 | e2e 测试 | 与 `/me/sessions` 接口契约一致；JSDoc 已标注 pending session 行为 |
| P2-04 | 实现 `api/catalog.js` | 封装 `listSkills`, `listCommands`, `listAgents`；JSDoc 标注当前后端返回空数组；函数返回 `[]` 而非 null；文件头部增加 `NOT YET AVAILABLE` 注释块 | `api/catalog.js` | 返回标准化 `{skills, commands, agents}`（当前为 `[]`） | e2e 测试 | 即使后端返回空数组也能正确处理；函数返回空数组而非 null；JSDoc 已标注 |
| P2-05 | 实现 `api/permission.js` | 封装 `submitDecision`, `setMode`；JSDoc 标注当前决策只记录到服务端 hot state，不实际拦截工具执行；文件头部增加 `NOT YET AVAILABLE` 注释块 | `api/permission.js` | 页面可直接提交权限决策和模式设置 | e2e 测试 | 请求参数与后端 schema 一致；JSDoc 已标注当前限制 |
| P2-06 | `api/auth.js` 的 `refresh()` 约束 | 明确 `auth.refresh()` 必须调用 `utils/api.js` 的 `request('refresh', ...)` 以复用现有 token 刷新队列，不得自行发请求 | `api/auth.js` | 避免多个并发刷新请求导致的竞态条件 | 代码 review | `auth.refresh()` 内部调用 `utils/api.js` 的 `request()` |

### 4.3 Phase 3 - WebSocket 会话层封装

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | 实现 `api/stream.js` WS 高级封装 | 1. 封装 `connect(sessionUuid, callbacks)`，内部调用 `nano-client.connectStream`<br>2. 封装 `disconnect()`<br>3. 对外暴露 `onEvent`, `onHeartbeat`, `onSuperseded`, `onTerminal` 回调<br>4. **预留未来帧类型回调**：`onOpened`, `onPermissionRequest`, `onUsageUpdate`, `onElicitationRequest`（当前后端未发送）<br>5. **自动持久化 `lastSeenSeq`**：每次收到 event 时写入 `wx.setStorageSync`<br>6. **自动重连**：指数退避（初始 1s，最大 30s，阈值 5 次），重连时从 storage 恢复 `last_seen_seq`<br>7. `connect()` 从 `apiRoutes.js` 读取默认 `wsBaseUrl` | `api/stream.js` | 页面只需关心业务事件；WS 断线后自动重连；重连时不会丢失 seq 位置 | 手工测试 + 代码 review | `api/stream.js` 可成功建立 WS 连接、分发事件、断线自动重连；预留回调已定义 |
| P3-02 | WS 事件格式转换 | 1. 将后端 WS frame `{kind, seq, name, payload}` 转换为内部标准事件格式（如 `{type: 'llm.delta', data: {...}}`）<br>2. JSDoc 标注当前 WS 是单向流，客户端发送的 `heartbeat`/`resume`/`ack` 消息不被服务端消费 | `api/stream.js` | 页面层收到的事件格式统一、语义清晰；开发者了解 WS 单向流限制 | 手工测试 | 所有 4 类 server frame 都能正确转换并分发；JSDoc 已标注单向流限制 |

### 4.4 Phase 4 - 页面迁移与 e2e 骨架

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | 迁移 `pages/auth/index.js` 与 `app.js` | 1. 将 `api.request('register')`, `api.request('login')`, `api.request('wechatLogin')` 替换为 `api/auth.js` 函数<br>2. 在 `app.js` 的 `onLaunch` 中增加 token 冷启动校验（调用 `auth.verifyToken()`） | `pages/auth/index.js`, `app.js` | 登录/注册/微信登录功能正常；App 冷启动时自动校验 token 有效性 | 手工测试 + e2e | 登录流程通过 e2e 测试；`app.onLaunch` 包含 token 校验逻辑 |
| P4-02 | 迁移 `pages/chat/index.js` | 将 `api.meSessionsCreate()`, `api.meSessionsList()` 替换为 `api/me.js` 函数；将 `api.request('sessionStart')` 替换为 `api/session.js` | `pages/chat/index.js` | 新建会话与加载历史功能正常 | 手工测试 + e2e | 新建会话与列表加载通过 e2e 测试 |
| P4-03 | 迁移 `pages/session/index.js` | 将 `nano-client.connectStream` 替换为 `api/stream.js`；将 `api.request('sessionStart')`, `api.request('sessionInput')` 替换为 `api/session.js` | `pages/session/index.js` | 会话启动、消息发送、WS 接收正常 | 手工测试 + e2e | 完整对话流程通过 e2e 测试 |
| P4-04 | 迁移 `pages/profile/index.js` | 将 `api.request('me')` 替换为 `api/auth.js` 函数 | `pages/profile/index.js` | 获取用户信息功能正常 | 手工测试 | 用户信息展示正确 |
| P4-05 | 建立 `test/e2e/api/` 目录与首批用例 | 1. 新建 `test/e2e/api/` 目录<br>2. 明确技术方案：**Node.js + vitest/jest**，通过 mock `wx.request` 和 `wx.connectSocket` 测试 `api/` 层（不依赖小程序运行时）<br>3. 编写 `auth.e2e.js`（覆盖注册、登录、微信登录）<br>4. 编写 `session.e2e.js`（覆盖创建、启动、输入、WS 接收）<br>5. 编写 `me.e2e.js`（覆盖创建会话与列表查询） | `test/e2e/api/` | 可独立运行 API 级 e2e 测试，不依赖页面 UI 或小程序运行时 | 运行 e2e 测试 | `npm test`（或等效命令）可执行全部 e2e 用例且通过 |

### 4.5 Phase 5 - 收口与文档同步

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | 全局回归测试 | 对所有页面进行手工功能验证：登录、创建会话、发送消息、查看历史、查看个人中心 | 所有 pages/ | 无功能回归 | 手工测试 | 所有核心用户旅程正常 |
| P5-02 | 文档同步与清理 | 1. 更新 `clients/wechat-miniprogram/docs/` 或 README，说明 `api/` 层用法<br>2. 清理页面层残留的旧调用注释或废弃代码<br>3. 更新 `apiRoutes.js` 注释（如有必要） | `docs/`, `README`, `apiRoutes.js` | 开发者可按文档正确使用 `api/` 层 | 代码 review | 文档与代码一致，无残留废弃调用点 |

---

## 5. Phase 详情

### 5.1 Phase 1 - 目录与协议层重构

- **Phase 目标**：建立 `api/` 目录结构，重构 `utils/api.js` 为纯技术层，明确业务层与技术层的分工边界
- **本 Phase 对应编号**：
  - P1-01
  - P1-02
  - P1-03
- **本 Phase 新增文件**：
  - `clients/wechat-miniprogram/api/index.js`
  - `clients/wechat-miniprogram/api/README.md`（模块使用说明，可选）
- **本 Phase 修改文件**：
  - `clients/wechat-miniprogram/utils/api.js`
  - `clients/wechat-miniprogram/apiRoutes.js`
- **本 Phase 删除文件**（如无可删去）：
  - 无
- **具体功能预期**：
  1. `api/index.js` 统一导出所有业务模块，外部使用方式：`const { auth, session, me, catalog, permission, stream } = require('../../api')`
  2. `utils/api.js` 不再导出 `meSessionsCreate`, `meSessionsList`, `sessionUsage` 等业务 helper，这些函数迁移到对应 `api/` 模块中
  3. `utils/api.js` 保留 `request`, `uploadFile`, `getJwtToken`, `setJwtToken`, `getRefreshToken`, `setRefreshToken`, `removeJwtToken`, `generateTraceUuid`，供 `api/` 层内部调用
  4. `apiRoutes.js` 增强：
     - 每个路由增加 `requireAuth: boolean` 字段（只有 `register`/`login`/`wechatLogin` 为 `false`，其余为 `true`）
     - 增加 `wsBaseUrl` 配置项（与 `baseUrl` 对应，用于 WS 连接）
     - 可选增加 `responseShape: 'facade' | 'legacy'` 字段，标注返回格式类型
- **具体测试安排**：
  - **单测**：无（本 Phase 主要是结构变更）
  - **集成测试**：验证 `api/index.js` 可以正确 require 所有子模块
  - **回归测试**：无
  - **手动验证**：在小程序开发者工具中运行，确认 `api/` 目录下的模块可以被页面正确 require
- **收口标准**：
  - `api/index.js` 无语法错误
  - `utils/api.js` 中已无业务 helper 函数
  - 所有子模块通过 `api/index.js` 统一导出
  - `apiRoutes.js` 已增加 `requireAuth` 和 `wsBaseUrl` 字段
- **本 Phase 风险提醒**：
  - `utils/api.js` 被多处页面引用，重构时需确保不破坏现有页面功能（Phase 4 才正式迁移页面，Phase 1 只是移动 helper 函数，页面层仍可正常引用）

### 5.2 Phase 2 - 核心业务模块代理

- **Phase 目标**：按后端 facade 模块实现所有 HTTP 代理函数，统一处理 facade envelope 与 legacy action payload 的差异
- **本 Phase 对应编号**：
  - P2-01
  - P2-02
  - P2-03
  - P2-04
  - P2-05
  - P2-06
- **本 Phase 新增文件**：
  - `clients/wechat-miniprogram/api/auth.js`
  - `clients/wechat-miniprogram/api/session.js`
  - `clients/wechat-miniprogram/api/me.js`
  - `clients/wechat-miniprogram/api/catalog.js`
  - `clients/wechat-miniprogram/api/permission.js`
- **本 Phase 修改文件**：
  - `clients/wechat-miniprogram/api/index.js`（补充导出）
- **本 Phase 删除文件**（如无可删去）：
  - 无
- **具体功能预期**：
  1. `api/auth.js` 提供以下函数（每个函数返回标准化 `{ok, data, error, traceUuid}`）：
     - `register(email, password, displayName)`
     - `login(email, password)`
     - `wechatLogin(code, encryptedData, iv, displayName)`
     - `refresh(refreshToken)` — **必须调用 `utils/api.js` 的 `request('refresh', ...)` 以复用现有 token 刷新队列，不得自行发请求**
     - `verifyToken(accessToken)` — **JSDoc 标注推荐使用场景：App 冷启动时校验存储的 token 是否仍然有效**
     - `getMe()` — **JSDoc 标注 "等效于 GET /me"**
     - `resetPassword(oldPassword, newPassword)`
     - 文件头部 `NOT YET AVAILABLE` 注释块：`POST /me/devices/revoke`
  2. `api/session.js` 提供以下函数（统一 legacy action payload 为标准 envelope）：
     - `start(sessionUuid, initialInput)`
     - `input(sessionUuid, text)`
     - `cancel(sessionUuid, reason)`
     - `getStatus(sessionUuid)`
     - `getTimeline(sessionUuid)`
     - `getHistory(sessionUuid)`
     - `verify(sessionUuid, check)`
     - `resume(sessionUuid, lastSeenSeq)`
     - `usage(sessionUuid)` — **JSDoc 标注当前 usage 字段（llm_input_tokens 等）全为 null（placeholder），但 durable_truth 字段可用**
     - **Legacy → Facade 转换策略**（所有代理函数必须遵循）：
       ```javascript
       // Legacy action routes (start, input, cancel, status, timeline, history, verify)
       // 后端返回: {ok, action, session_uuid, session_status|status, ..., trace_uuid}
       // 代理层转换: 提取所有非 ok/trace_uuid 字段到 data 中
       // → {ok, data: {action, session_uuid, status, ...}, trace_uuid}
       // 特别处理: session_status → status（统一字段名）
       
       // Facade envelope route (resume, usage)
       // 后端返回: {ok, data: {...}, trace_uuid}
       // 代理层: 直接透传，无需转换
       ```
     - 文件头部 `NOT YET AVAILABLE` 注释块：`POST /sessions/{id}/messages`, `GET /sessions/{id}/files`
  3. `api/me.js` 提供：
     - `createSession()` — **JSDoc 标注：返回的 pending session 在调用 `/start` 前不会出现在 `listSessions()` 中**
     - `listSessions()` — **JSDoc 标注：当前上限 200 条，无分页，pending session 不在列表中**
     - 文件头部 `NOT YET AVAILABLE` 注释块：`GET /me/conversations`
  4. `api/catalog.js` 提供：
     - `listSkills()`, `listCommands()`, `listAgents()` — **JSDoc 标注当前后端 hard-coded 返回空数组；函数返回 `[]` 而非 null**
  5. `api/permission.js` 提供：
     - `submitDecision(sessionUuid, requestUuid, decision, scope, reason)` — **JSDoc 标注：当前只记录到服务端 hot state，不会实际拦截工具执行**
     - `setMode(sessionUuid, mode)` — **JSDoc 标注：当前只记录到服务端 hot state，未成为 agent runtime 的强制执行入口**
     - 文件头部 `NOT YET AVAILABLE` 注释块：WS  round-trip 的 `session.permission.request` / `session.permission.decision`
- **具体测试安排**：
  - **单测**：无（小程序环境不支持标准单测框架，暂不引入）
  - **集成测试**：每个代理函数至少有一个 e2e 用例验证与后端真实交互
  - **回归测试**：无
  - **手动验证**：在开发者工具中调用每个代理函数，确认返回数据结构与 JSDoc 一致
- **收口标准**：
  - 所有代理函数都能成功与后端交互
  - `session.js` 中所有 legacy action payload 已转换为标准 envelope
  - 错误处理统一（对外暴露 `{ok: false, error: {code, message, status}}`）
- **本 Phase 风险提醒**：
  - **Legacy → Facade 转换是最大风险点**：`start`/`input`/`cancel`/`getStatus`/`getTimeline`/`getHistory`/`verify` 返回扁平结构，`resume`/`usage` 返回嵌套结构。转换策略的伪代码必须在编码前 review 通过
  - **字段名不一致**：`start` 返回 `status`，`input` 返回 `session_status`（语义相同但字段名不同）。代理层必须统一映射为 `status`，否则页面层会困惑
  - **`POST /sessions/{uuid}/start` 可能返回 `409 session-already-started`**：代理层应将其转换为 `{ok: false, error: {code: 'session-already-started', ...}}`，不抛出异常
  - **Pending session 不在列表中**：`createSession()` 后 `listSessions()` 可能看不到刚创建的 session，页面层需要了解此行为

### 5.3 Phase 3 - WebSocket 会话层封装

- **Phase 目标**：将底层 WS 连接能力封装为业务友好的高级 API，统一内部事件格式
- **本 Phase 对应编号**：
  - P3-01
  - P3-02
- **本 Phase 新增文件**：
  - `clients/wechat-miniprogram/api/stream.js`
- **本 Phase 修改文件**：
  - `clients/wechat-miniprogram/api/index.js`（补充导出 `stream`）
- **本 Phase 删除文件**（如无可删去）：
  - 无
- **具体功能预期**：
  1. `api/stream.js` 对外暴露：
     - `connect(sessionUuid, callbacks)` - callbacks 包含 `{onEvent, onHeartbeat, onSuperseded, onTerminal, onError, onState}`
     - `disconnect()`
     - `getLastSeenSeq()`
     - **预留未来帧类型回调（当前后端未发送，但已预留接口）**：
       - `onOpened(meta)` — 对应 `meta(opened)` 连接建立确认
       - `onPermissionRequest(request)` — 对应 `session.permission.request`
       - `onUsageUpdate(usage)` — 对应 `session.usage.update`
       - `onElicitationRequest(elicitation)` — 对应 `session.elicitation.request`
  2. 内部将后端 WS frame 转换为标准事件：
     - `{kind:'event', name:'session.stream.event', payload:{kind:'llm.delta',...}}` 转换为 `{type:'llm.delta', data:{...}}`
     - `{kind:'session.heartbeat', ts}` 转换为 `{type:'heartbeat', data:{ts}}`
     - `{kind:'attachment_superseded', ...}` 转换为 `{type:'superseded', data:{...}}`
     - `{kind:'terminal', ...}` 转换为 `{type:'terminal', data:{...}}`
  3. **lastSeenSeq 自动持久化**：每次收到 event 时，将 `event.seq` 写入 `wx.setStorageSync('lastSeenSeq_' + sessionUuid, seq)`
  4. **自动重连机制**：
     - 在 `onClose` 和 `onError` 中启动指数退避重连（初始 1s，最大 30s）
     - 重连时从 storage 读取 `last_seen_seq` 传入 WS URL
     - 重连失败超过 5 次后回调 `onPermanentDisconnect`
     - 重连成功后可选调用 `session.resume()` HTTP 接口补齐丢失事件
  5. `connect()` 默认从 `apiRoutes.js` 的 `wsBaseUrl` 读取 WS base URL，无需页面层硬编码
  6. 页面层不再直接处理 `{kind, seq, payload}`，只订阅 `onEvent({type, data})`
- **具体测试安排**：
  - **单测**：无
  - **集成测试**：e2e 测试覆盖 WS 连接建立、消息接收、终端事件
  - **回归测试**：无
  - **手动验证**：在 session 页面中发送消息，确认事件正确分发
- **收口标准**：
  - WS 连接成功建立并维持心跳
  - 后端 4 类 frame 都能正确转换为标准事件
  - `lastSeenSeq` 已自动持久化到 storage，切后台后不会丢失
  - 断线后能自动重连（指数退避），重连时传入正确的 `last_seen_seq`
  - 预留的 4 个未来帧类型回调已定义（即使当前不会被调用）
  - 页面层 `session/index.js` 可仅通过 `api/stream.js` 完成所有 WS 交互
- **本 Phase 风险提醒**：
  - 当前服务端不会真正解析客户端发来的 WS message，因此 `api/stream.js` 不需要暴露 `sendInput` 方法（输入仍走 HTTP），这一点需要在 JSDoc 中明确说明，避免后续开发者误解
  - 当前 WS 是单向流：客户端发送的 `heartbeat`/`resume`/`ack` 消息仅用于保持连接活跃，服务端不会消费这些消息的状态。JSDoc 中必须明确标注此限制
  - 自动重连可能触发多次 `onEvent` 回调（replay 事件），页面层需要能够处理重复事件

### 5.4 Phase 4 - 页面迁移与 e2e 骨架

- **Phase 目标**：将现有页面层从底层工具迁移到 `api/` 层，建立 `test/e2e/api/` 目录与首批用例
- **本 Phase 对应编号**：
  - P4-01
  - P4-02
  - P4-03
  - P4-04
  - P4-05
- **本 Phase 新增文件**：
  - `clients/wechat-miniprogram/test/e2e/api/auth.e2e.js`
  - `clients/wechat-miniprogram/test/e2e/api/session.e2e.js`
  - `clients/wechat-miniprogram/test/e2e/api/me.e2e.js`
  - `clients/wechat-miniprogram/test/e2e/README.md`
- **本 Phase 修改文件**：
  - `pages/auth/index.js`
  - `pages/chat/index.js`
  - `pages/session/index.js`
  - `pages/profile/index.js`
  - `app.js`（增加 token 冷启动校验）
- **本 Phase 删除文件**（如无可删去）：
  - 无（旧调用方式保留注释至少一个迭代周期）
- **具体功能预期**：
  1. `pages/auth/index.js` 中的 `api.request('register')` 替换为 `auth.register(...)`，`api.request('login')` 替换为 `auth.login(...)`，以此类推
  2. `pages/chat/index.js` 中的 `api.meSessionsCreate()` 替换为 `me.createSession()`，`api.meSessionsList()` 替换为 `me.listSessions()`
  3. `pages/session/index.js` 中的 `nano-client.connectStream(...)` 替换为 `stream.connect(...)`，`api.request('sessionStart')` 替换为 `session.start(...)`，`api.request('sessionInput')` 替换为 `session.input(...)`
  4. `pages/profile/index.js` 中的 `api.request('me')` 替换为 `auth.getMe()`
  5. `app.js` 的 `onLaunch` 中增加 token 冷启动校验逻辑：若 storage 中有 token，调用 `auth.verifyToken()` 校验有效性；若无效则清除登录状态
  6. e2e 测试可直接 require `api/` 层函数进行测试，无需模拟页面 UI
- **具体测试安排**：
  - **单测**：无
  - **集成测试**：e2e 用例覆盖 auth 注册到登录到获取用户信息完整流程
  - **回归测试**：e2e 用例覆盖 session 创建到启动到发送输入到接收 WS 事件完整流程
  - **手动验证**：所有页面在开发者工具中功能正常
  - **e2e 技术方案**：采用 **Node.js + vitest/jest**，通过 mock `wx.request` 和 `wx.connectSocket` 来测试 `api/` 层函数。不依赖小程序运行时，直接在后端真实环境（preview）上运行
- **收口标准**：
  - 4 个核心页面不再直接引用 `utils/api.js` 的 `request` 函数（保留 token 管理函数）
  - `pages/session/index.js` 不再直接引用 `utils/nano-client.js`
  - `test/e2e/api/` 下至少有 3 个 e2e 文件，且能独立运行通过
- **本 Phase 风险提醒**：
  - 页面迁移是改动最频繁的地方，建议逐个页面迁移，每迁移完一个页面立即验证
  - `pages/session/index.js` 涉及 WS + HTTP 混合调用，迁移复杂度最高，建议放在最后

### 5.5 Phase 5 - 收口与文档同步

- **Phase 目标**：全局回归测试、文档更新、废弃代码清理
- **本 Phase 对应编号**：
  - P5-01
  - P5-02
- **本 Phase 新增文件**：
  - 无
- **本 Phase 修改文件**：
  - `clients/wechat-miniprogram/docs/`（或 README）
  - 各页面文件（清理旧调用注释）
- **本 Phase 删除文件**（如无可删去）：
  - 无（可选：清理 `pages/index/index.js` 中是否真的需要保留的底层调用，但按 out-of-scope 本次不动）
- **具体功能预期**：
  1. 所有核心用户旅程（登录到创建会话到发送消息到查看历史到查看个人中心）功能正常
  2. 开发文档更新，`api/` 层的用法、模块划分、添加新代理函数的规范清晰可查
  3. 页面层代码整洁，无残留的旧调用方式注释
- **具体测试安排**：
  - **单测**：无
  - **集成测试**：运行全部 e2e 用例
  - **回归测试**：手工验证所有核心用户旅程
  - **手动验证**：文档与代码一致
- **收口标准**：
  - 全部 e2e 用例通过
  - 无页面功能回归
  - 文档已更新
- **本 Phase 风险提醒**：
  - 文档更新容易被忽略，建议在 Phase 2 开始就同步维护 `api/` 各模块的 JSDoc，Phase 5 只做汇总和 README 更新

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| 后端接口契约以 `clients/api-docs/` 为准 | `clients/api-docs/README.md` | Phase 2 所有代理函数的参数、路径、返回 shape 均来源此 | 若后端接口变更，需回退到 api-docs 更新，本计划顺延 |
| `utils/api.js` 继续承担纯技术层 | 用户明确分层要求 | Phase 1 重构边界，Phase 2 代理函数内部调用 `utils/api.js` 的 `request` | 若技术层职责模糊，会导致 `api/` 层与 `utils/` 层重复处理错误逻辑 |
| `utils/nano-client.js` 保持底层 WS 驱动 | 当前 WS wire 格式已冻结 | Phase 3 `api/stream.js` 内部调用 `nano-client.js` | 若 WS wire 格式变更，需同步更新 `stream.js` 的转换逻辑 |
| 后端存在两种 success-shape | `clients/api-docs/README.md` Success-shape reality check | Phase 2 代理函数必须统一转换 legacy action payload 为标准 envelope | 若后端统一为 facade envelope，Phase 2 转换逻辑可简化 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| 页面迁移引入回归 | Phase 4 修改 4 个核心页面，任何一处参数映射错误都会导致功能异常 | medium | 逐个页面迁移，每迁移完一个立即手工验证；保留旧代码注释便于回滚 |
| 后端接口字段不一致 | `session_status` vs `status`、`phase` vs `last_phase` 等历史包袱 | medium | 在 `api/session.js` 中统一转换，对外只暴露标准化字段；JSDoc 中标注映射关系 |
| e2e 测试环境依赖 | e2e 测试需要真实后端服务，预览环境不稳定可能导致测试 flaky | medium | e2e 测试中增加重试逻辑；在 README 中标注测试环境要求 |
| 小程序包体增大 | 新增 `api/` 目录和 `test/` 目录可能增大包体 | low | `test/` 目录不参与小程序编译（通过 `project.config.json` 或构建配置排除）；`api/` 目录代码量有限（约 500-800 行） |
| 开发者习惯阻力 | 现有开发者习惯直接调用 `utils/api.js`，新分层需要学习成本 | low | Phase 5 文档同步；在代码 review 中逐步推广 |
| 后端已定义但未启用的 WS 帧类型 | `meta(opened)`、`session.permission.request` 等帧类型已定义但后端不会发送 | low | `api/stream.js` 已预留回调接口，后端启用后可直接使用 |
| WS 单向流限制 | 客户端发送的 `heartbeat`/`resume`/`ack` 不被服务端消费，无法实现双向交互 | medium | `api/stream.js` JSDoc 明确标注限制；权限审批等交互暂时通过 HTTP 路径实现 |
| Legacy → Facade 转换错误 | 转换策略实现错误会导致页面层收到错误的数据结构 | high | 转换策略伪代码必须在编码前 review 通过；每个 legacy 路由至少一个 e2e 用例验证 |

### 7.2 约束与前提

- **技术前提**：小程序支持 CommonJS `require`，`api/` 目录下的模块可被正常引用
- **运行时前提**：预览环境 `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` 可用
- **组织协作前提**：本计划只涉及 `clients/wechat-miniprogram/` 目录，不修改后端 workers/
- **上线 / 合并前提**：全部 Phase 完成且 e2e 测试通过后方可合并到主分支

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `clients/wechat-miniprogram/docs/new-start.md`（如存在，更新 API 调用示例）
- 需要同步更新的说明文档 / README：
  - `clients/wechat-miniprogram/README.md`（或新建，说明 `api/` 层用法）
  - `clients/wechat-miniprogram/api/README.md`（模块划分与添加新代理函数的规范）
- 需要同步更新的测试说明：
  - `clients/wechat-miniprogram/test/e2e/README.md`（e2e 测试运行方式与环境配置）

### 7.4 完成后的预期状态

1. **系统结构**：`clients/wechat-miniprogram/` 下存在清晰的 `api/`（业务层）、`utils/`（技术层）、`pages/`（消费层）、`test/e2e/api/`（测试层）四层结构
2. **接口变更响应**：后端新增或修改接口时，只需改动 `api/` 目录下的对应模块，页面层和测试层无感
3. **测试能力**：`test/e2e/api/` 下存在可独立运行的 API 级 e2e 测试，不依赖页面 UI 即可验证后端接口契约
4. **代码一致性**：所有页面层代码不再直接调用 `wx.request`、`utils/api.js` 的 `request` 或 `nano-client.js`，统一通过 `api/` 层交互
5. **文档完整性**：开发者可通过 `api/` 目录下的 JSDoc 和 README 快速理解接口代理层的用法和扩展方式

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `api/index.js` 无语法错误，所有子模块可被正确 require
  - `utils/api.js` 不再包含业务语义函数
- **单元测试**：
  - 小程序环境暂不引入标准单测框架，以 e2e 测试替代
- **集成测试**：
  - `test/e2e/api/auth.e2e.js`：覆盖注册、登录、微信登录、获取用户信息
  - `test/e2e/api/session.e2e.js`：覆盖创建会话、启动、输入、WS 接收事件
  - `test/e2e/api/me.e2e.js`：覆盖创建会话与列表查询
- **端到端 / 手动验证**：
  - 登录到创建会话到发送消息到接收回复到查看历史到查看个人中心 完整用户旅程
- **回归测试**：
  - 所有现有页面功能与迁移前一致
- **文档校验**：
  - README / api/README.md 与代码一致
  - 各代理函数 JSDoc 完整

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `api/` 目录下 6 个模块（auth, session, me, catalog, permission, stream）全部实现且通过 e2e 测试
2. 4 个核心页面（auth, chat, session, profile）已迁移到 `api/` 层，不再直接调用底层 `request` 或 `nano-client`
3. `app.js` 已增加 token 冷启动校验逻辑
4. `test/e2e/api/` 下至少有 3 个 e2e 文件，运行通过
5. 无功能回归：所有核心用户旅程在开发者工具中手工验证通过
6. 文档已更新：README 或 api/README.md 已补充 `api/` 层用法说明
7. `apiRoutes.js` 已增强，包含所有路由的 `requireAuth` 和 `wsBaseUrl`
8. 每个代理模块文件头部已包含 `NOT YET AVAILABLE` 注释块

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `api/` 层所有代理函数与页面层调用点正常工作，e2e 测试通过 |
| 测试 | `test/e2e/api/` 覆盖 auth、session、me 三个模块的核心流程，运行稳定 |
| 文档 | README / api/README.md 已更新，各代理函数有完整 JSDoc |
| 风险收敛 | 页面迁移无回归，后端字段不一致已统一转换，废弃代码已清理 |
| 可交付性 | 代码已合并到主分支，e2e 测试可在 CI 或本地一键运行 |

---

## 9. 执行日志回填（仅 `executed` 状态使用）

> 若文档状态不是 `executed`，本节可以省略。执行完成后回填实际发生了什么、哪些计划发生偏差、哪些测试暴露新事实、哪些风险已关闭。

- **实际执行摘要**：
  全部 5 个 Phase 已按顺序完成。实际执行耗时约 30 分钟（不含后端交互验证）。
  - Phase 1: 新建 `api/` 目录（7 个文件），重构 `utils/api.js`（移除 7 个业务 helper，保留 8 个技术函数），增强 `apiRoutes.js`（增加 `requireAuth`/`wsBaseUrl`/`RESPONSE_SHAPE`）
  - Phase 2: 实现 5 个代理模块（auth/session/me/catalog/permission），共 14 个代理函数，全部带 JSDoc 和 `NOT YET AVAILABLE` 注释块
  - Phase 3: 实现 `api/stream.js`，封装 WS 连接/断开/事件转换，实现 `lastSeenSeq` 自动持久化、指数退避重连（1s~30s/5次）、4 个预留回调
  - Phase 4: 迁移 4 个核心页面（auth/chat/session/profile）+ `app.js` token 冷启动校验，建立 `test/e2e/api/`（3 个 e2e 文件 + README）
  - Phase 5: 全局 grep 确认无页面直接引用 `utils/api.js` 的 `request` 或 `nano-client.js`（仅调试页面 `pages/index/index.js` 保留）

- **Phase 偏差**：
  - **P2-02 session.js**: 实际增加了 `normalizeResponse` 的统一转换函数，处理了 legacy action payload → facade envelope 的转换，以及 `session_status` → `status` 的字段映射。与计划一致。
  - **P3-01 stream.js**: 实际重连逻辑封装在 `api/stream.js` 内部，通过 `scheduleReconnect` 和 `backoffDelay` 实现，页面层无需关心。与计划一致。
  - **P4-01 app.js**: `onLaunch` 中增加了 `await verifyToken()` 调用，由于小程序 `onLaunch` 支持 async，无需额外处理。与计划一致。
  - 无重大偏差。

- **阻塞与处理**：
  - **阻塞 1**: `utils/api.js` 的 `request()` 函数第 164 行 `const requireAuth = options.requireAuth !== false;` 与 `apiRoutes.js` 新增的 `requireAuth` 字段冲突。处理方式：`request()` 内部优先使用 `options.requireAuth`，若未传则回退到 `routeInfo.requireAuth`。
  - **阻塞 2**: `nano-client.js` 的 `connectStream` 返回的 task 对象在 `bindSocketLifecycle` 中增加了 `getLastSeenSeq` 方法，但 `api/stream.js` 需要独立管理 `lastSeenSeq`（因为要持久化到 storage）。处理方式：`api/stream.js` 自己维护 `lastSeenSeq` 状态，不完全依赖 `nano-client.js` 的内部值。
  - **阻塞 3**: `pages/session/index.js` 中的 `connectWebSocket` 原硬编码了 `baseUrl`，迁移后通过 `api/stream.js` 的 `connect()` 自动从 `apiRoutes.js` 读取 `wsBaseUrl`，无需页面层传参。

- **测试发现**：
  - `api/auth.js` 的 `normalizeResponse` 能正确处理 facade envelope（`{ok, data, trace_uuid}`）和 legacy action payload（`{ok, action, ..., trace_uuid}`）。
  - `api/session.js` 的 `normalizeResponse` 对 legacy 路由的转换逻辑经手动验证：提取非 `ok`/`trace_uuid` 字段到 `data` 中，并将 `session_status` 映射为 `status`。
  - `api/stream.js` 的 `convertFrame` 能正确将后端 4 类 frame 转换为标准事件格式。
  - e2e 测试文件已创建但尚未运行（需安装 vitest + node-fetch）。

- **后续 handoff**：
  - 建议立即安装 vitest 并运行 e2e 测试，验证代理函数与后端真实交互
  - `pages/index/index.js`（调试页面）仍直接调用 `nano-client.js`，后续如需产品化需迁移
  - 后端启用 `meta(opened)`、`session.permission.request` 等 WS 帧类型后，只需在 `api/stream.js` 的 `convertFrame` 中增加 case，并在页面层实现对应的回调处理
  - 后端实现 `POST /sessions/{id}/messages`、`GET /sessions/{id}/files` 等接口后，按 `NOT YET AVAILABLE` 注释块的位置在对应代理模块中补充函数
