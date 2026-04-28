# Nano-Agent 行动计划 — Web-v10 F3 Auth And Session Navigation

> 服务业务簇: `clients/web / web-v10 / auth-and-session-navigation`
> 计划对象: `打通进入系统、会话列表、conversation 列表、新建会话与会话切换主入口`
> 类型: `new + modify`
> 作者: `Copilot`
> 时间: `2026-04-28`
> 文件位置:
> - `clients/web/src/pages/{AuthPage,ChatPage}.tsx`
> - `clients/web/src/components/{Sidebar,AuthForm,SessionList}.tsx`
> - `clients/web/src/apis/{auth,sessions}.ts`
> - `clients/web/src/{state,hooks}/`
> 上游前序 / closure:
> - `clients/web/docs/charter/web-v10-foundations.md`
> - `clients/web/docs/action-plan/web-v10/F2-bff-and-transport-split.md`
> 下游交接:
> - `clients/web/docs/action-plan/web-v10/F4-chat-mainline-and-stream.md`
> - `clients/web/docs/action-plan/web-v10/F5-inspector-and-delivery-hardening.md`
> 关联设计 / 调研文档:
> - `clients/web/docs/charter/web-v10-foundations.md`
> - `clients/api-docs/README.md`
> - `clients/api-docs/{auth,me-sessions}.md`
> 冻结决策来源:
> - `web-v10-foundations.md` §4.1 I3 / §6.1 F3 / §7.4 F3（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `executed`

---

## 0. 执行背景与目标

F3 的目标是把 Web 从“有壳、有 HTTP posture”推进到“用户可以真正进入系统并选择/创建会话”。这是 first real client 的最小入口：如果没有 auth bootstrap、session list、conversation list 与 new session flow，F4 的聊天主链就没有稳定的入口点。

- **服务业务簇**：`clients/web / web-v10`
- **计划对象**：`auth-and-session-navigation`
- **本次计划解决的问题**：
  - 用户还没有正式的登录进入路径。
  - session / conversation 仍未被组织成侧栏导航与新建入口。
  - 页面还缺少未登录、空状态、错误状态的正式 guard。
- **本次计划的直接产出**：
  - `AuthPage` 与 auth state/bootstrap
  - `GET/POST /me/sessions` 前端入口
  - sidebar 中的 session navigation
  - `/me/conversations` 的 reality audit 结论（若当前 docs/code 仍未收敛，则作为 conditional enhancement，而不是 F3 硬依赖）
- **本计划不重新讨论的设计结论**：
  - F3 只负责入口和导航，不负责完整聊天 runtime（来源：charter §7.4）
  - façade-only 调用边界已冻结，不绕开 `orchestrator-core`（来源：charter §4.4）

### 0.1 开工前必须继承的项目上下文

1. `clients/web/docs/charter/web-v10-foundations.md`
2. `clients/api-docs/README.md`
3. `clients/api-docs/auth.md`
4. `clients/api-docs/me-sessions.md`
5. F2 的 `/api/*` 与 `src/apis/*` 实现

### 0.2 F3 接口参照入口

| F3 子目标 | 直接参考文档 | 执行注意点 |
|---|---|---|
| register / login / me / logout | `clients/api-docs/auth.md` | auth routes 返回标准 facade success envelope |
| new session / session list | `clients/api-docs/me-sessions.md` | `/me/sessions` 是当前最稳定的 user-scoped hot index contract |
| 入口级 route reality check | `clients/api-docs/README.md` | README 当前把 `GET /me/conversations` 列为“尚未实现”，F3 不能无条件依赖它 |

### 0.3 `/me/conversations` 的执行纪律

当前 `clients/api-docs/README.md` 仍把 `GET /me/conversations` 列为尚未实现。因此 F3 的可执行口径必须是：

1. **硬依赖**：`auth.md` + `me-sessions.md`
2. **条件增强**：`/me/conversations`
3. 若执行时确认 façade 代码与 API docs 已收敛，可在同一变更里把 `/me/conversations` 提升为真实 read-model 并同步更新 `clients/api-docs`
4. 若未收敛，则 sidebar 先以 `/me/sessions` 为 canonical source，不允许因为缺 `/me/conversations` 而阻塞 F3

---

## 1. 执行综述

### 1.1 总体执行方式

执行方式采用 **“先 auth bootstrap，再接 session hot index read-model，再审计 `/me/conversations` 是否可提升为增强项，再建 sidebar 导航，最后补 guard 与状态面”**。F3 要形成的不是“能看到列表”，而是一个稳定的系统入口。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Auth Bootstrap | `M` | 建 register/login/me/logout 主入口与 auth state | `-` |
| Phase 2 | Session Read Model + Conversation Audit | `M` | 打通 `/me/sessions`，并审计 `/me/conversations` 是否可提升为增强入口 | `Phase 1` |
| Phase 3 | Sidebar Navigation And New Session Flow | `M` | 建立切换会话与创建会话入口 | `Phase 2` |
| Phase 4 | Guards / Empty / Error States | `S` | 补未登录、空列表、错误、过期 token 的状态面 | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — Auth Bootstrap**
   - **核心目标**：让用户能够进入系统。
   - **为什么先做**：没有 auth，就没有任何 user-scoped 数据入口。
2. **Phase 2 — Session Read Model + Conversation Audit**
   - **核心目标**：先建立当前用户可见的 session 视图，再判断 `/me/conversations` 是否能作为增强层加入。
   - **为什么放在这里**：它依赖 auth state 已可用。
3. **Phase 3 — Sidebar Navigation And New Session Flow**
   - **核心目标**：让用户可以切换和新建会话。
   - **为什么放在这里**：读模型存在后，导航才有真实内容。
4. **Phase 4 — Guards / Empty / Error States**
   - **核心目标**：防止 F3 只剩 happy path。
   - **为什么放在最后**：要在主流程已经成立后补全异常入口。

### 1.4 执行策略说明

- **执行顺序原则**：`先 auth，再 list，再 navigation，最后补状态面`
- **风险控制原则**：`不把 session_uuid 手输模式继续留在产品主线里`
- **测试推进原则**：`以 build + 本地/preview auth/session flow 手动验证为主`
- **文档同步原则**：`F3 不越权写最终 API 文档`
- **回滚 / 降级原则**：`若 sidebar 未稳定，不推进 F4 聊天主链`

### 1.5 本次 action-plan 影响结构图

```text
web-v10 / F3 auth-and-session-navigation
├── Phase 1: Auth Bootstrap
│   ├── src/pages/AuthPage.tsx
│   ├── src/components/AuthForm.tsx
│   └── src/state/auth.*
├── Phase 2: Session / Conversation Read Model
│   ├── src/apis/sessions.ts
│   └── src/state/sessions.*
├── Phase 3: Sidebar Navigation And New Session Flow
│   ├── src/components/Sidebar.tsx
│   └── src/components/SessionList.tsx
└── Phase 4: Guards / Empty / Error States
    └── auth/session UI states
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** register / login / me bootstrap / logout
- **[S2]** `/me/sessions` 的前端读模型
- **[S3]** `/me/conversations` 的 reality audit；若 docs/code 收敛则提升为增强读模型
- **[S4]** sidebar 中的 session/conversation 导航
- **[S5]** new session 创建与切换入口
- **[S6]** 未登录、空状态、错误状态与过期 token 处理

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 聊天流式 runtime 展示
- **[O2]** inspector、catalog、health、devices 等辅助面
- **[O3]** cookie/session 二期安全体系
- **[O4]** 富消息与文件流转 UI

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `POST /me/sessions` | `in-scope` | 新会话入口是 F3 核心 | 无 |
| sidebar conversation/session list | `in-scope` | F3 必需导航面 | 无 |
| `GET /me/conversations` | `defer / depends-on-reality-audit` | `clients/api-docs/README.md` 当前仍列为未实现，不能直接当硬依赖 | 当 docs 与 façade 代码在同一变更中收敛时 |
| `session start/input/ws` | `out-of-scope` | 属于 F4 | F4 |
| `GET /me/devices` | `defer / depends-on-design` | 辅助设置面属于 F5 | F5 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | create auth state and form flow | `add` | `src/pages/AuthPage.tsx` `src/components/AuthForm.tsx` `src/state/auth.*` | 建立用户进入路径 | `medium` |
| P2-01 | Phase 2 | wire me/sessions read model | `update` | `src/apis/sessions.ts` `src/state/sessions.*` | 读取当前用户的 session hot index 真相 | `medium` |
| P2-02 | Phase 2 | audit me/conversations reality | `update` | `src/apis/sessions.ts` `clients/api-docs/README.md` | 判断 `/me/conversations` 是可提升增强项还是继续 deferred | `medium` |
| P3-01 | Phase 3 | build sidebar navigation | `add` | `src/components/{Sidebar,SessionList}.tsx` | 组织会话切换和创建入口 | `medium` |
| P3-02 | Phase 3 | add new session flow | `update` | `src/pages/ChatPage.tsx` `src/apis/sessions.ts` | 用 server-mint 路径新建会话 | `medium` |
| P4-01 | Phase 4 | add guards and UI states | `update` | `src/pages/*` `src/components/*` | 防止只有 happy path | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Auth Bootstrap

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | create auth state and form flow | 建立 register/login/me/logout 的前端状态与页面入口 | `src/pages/AuthPage.tsx` `src/components/AuthForm.tsx` `src/state/auth.*` | 用户可进入系统 | `manual auth flow` | 登录与 me bootstrap 可运行 |

### 4.2 Phase 2 — Session Read Model + Conversation Audit

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | wire me/sessions read model | 接入 `/me/sessions` 并整理为前端可消费视图 | `src/apis/sessions.ts` `src/state/sessions.*` | 当前用户 session 真相可读取 | `manual list flow` | 列表数据可稳定展示 |
| P2-02 | audit me/conversations reality | 按 `clients/api-docs/README.md` 与 façade 代码的当前事实，判断 `/me/conversations` 能否进入 F3；若进入，必须同步修订 client API docs；若不进入，则在 sidebar 里保持 session-first 口径 | `src/apis/sessions.ts` `clients/api-docs/README.md` | `/me/conversations` 不再处于“想用但不知道能不能用”的灰区 | `doc/code audit` | F3 对 `/me/conversations` 的处理被明确写死 |

### 4.3 Phase 3 — Sidebar Navigation And New Session Flow

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | build sidebar navigation | 侧栏展示 session / conversation 列表与选中态 | `src/components/{Sidebar,SessionList}.tsx` | 用户可切换会话 | `preview manual check` | sidebar 成为真实导航面 |
| P3-02 | add new session flow | 使用 server-mint 路径创建新会话并跳转到聊天视图 | `src/pages/ChatPage.tsx` `src/apis/sessions.ts` | 不再手工输入 session UUID | `manual new-session flow` | 新建会话主线稳定 |

### 4.4 Phase 4 — Guards / Empty / Error States

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | add guards and UI states | 处理未登录、空列表、错误、token 过期等页面状态 | `src/pages/*` `src/components/*` | F3 不只剩 happy path | `manual negative-path checks` | 关键状态都有明确 UI 行为 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Auth Bootstrap

- **Phase 目标**：让用户能正式进入系统。
- **本 Phase 对应编号**：
  - `P1-01`
- **本 Phase 新增文件**：
  - `src/pages/AuthPage.tsx`
  - `src/components/AuthForm.tsx`
  - `src/state/auth.*`
- **本 Phase 修改文件**：
  - `src/apis/auth.ts`
- **具体功能预期**：
  1. register/login/me bootstrap 流程明确
  2. logout 与 token 失效处理有固定行为
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build`
  - **回归测试**：`登录后刷新/重新进入`
  - **手动验证**：`register → login → me`
- **收口标准**：
  - 用户能从 AuthPage 成功进入系统
  - auth 状态可被 ChatPage / Sidebar 复用
- **本 Phase 风险提醒**：
  - 不能把 auth 状态散落在多个页面局部变量中

### 5.2 Phase 2 — Session Read Model + Conversation Audit

- **Phase 目标**：给 sidebar 提供真实数据源。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `src/state/sessions.*`
- **本 Phase 修改文件**：
  - `src/apis/sessions.ts`
- **具体功能预期**：
  1. `/me/sessions` 成为 F3 的 canonical read-model source
  2. `/me/conversations` 是否进入 F3 被显式决策，而不是模糊悬置
  3. 读模型可以支撑选中态与空态
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build`
  - **回归测试**：`列表刷新与页面重新进入`
  - **手动验证**：`已有会话列表展示`
- **收口标准**：
  - sidebar 需要的 canonical session 数据已准备好
  - `/me/conversations` 的 fate 已经明示（纳入或 deferred）
  - 列表不依赖手工构造 session UUID
- **本 Phase 风险提醒**：
  - conversation 与 session 之间的映射不能写成一次性硬编码

### 5.3 Phase 3 — Sidebar Navigation And New Session Flow

- **Phase 目标**：让用户能创建和切换会话。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `src/components/Sidebar.tsx`
  - `src/components/SessionList.tsx`
- **本 Phase 修改文件**：
  - `src/pages/ChatPage.tsx`
  - `src/apis/sessions.ts`
- **具体功能预期**：
  1. 用户可以从侧栏切换已有会话
  2. 用户可以使用 server-mint 路径创建新会话
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build`
  - **回归测试**：`列表切换与新建入口`
  - **手动验证**：`点击已有会话 / 新建会话`
- **收口标准**：
  - sidebar 已具备真实交互价值
  - session UUID 手输模式不再是产品主线
- **本 Phase 风险提醒**：
  - 不能把 session 创造逻辑继续留在调试输入框模型里

### 5.4 Phase 4 — Guards / Empty / Error States

- **Phase 目标**：让入口链路具备真实客户端最基本的异常处理。
- **本 Phase 对应编号**：
  - `P4-01`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `src/pages/*`
  - `src/components/*`
- **具体功能预期**：
  1. 未登录时不会误进聊天页
  2. 空列表和错误场景有可解释 UI
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build`
  - **回归测试**：`失败路径 smoke`
  - **手动验证**：`空状态 / token 过期 / 请求失败`
- **收口标准**：
  - 关键异常路径已被覆盖
  - F3 不再只是 happy path
- **本 Phase 风险提醒**：
  - 不要把“以后再补”当成留白理由

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| I3: auth + session navigation 是 first real client 最小主线 | `web-v10-foundations.md` §4.1 | F3 是 F4 前的必经 gate | 若改变，F3/F4 边界需重写 |
| G1: 不再手工输入 session UUID 作为产品主线 | `web-v10-foundations.md` §7.4 | F3 必须接 `/me/sessions` server-mint | 若不成立，客户端仍停留在 demo 姿势 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| auth 状态碎片化 | 页面自己管一套 token 状态 | `medium` | 建统一 auth state |
| 仍依赖手输 session UUID | 会话创建仍停留在 dogfood 模式 | `high` | 强制 server-mint 新建路径 |

### 7.2 约束与前提

- **技术前提**：`F2 的 /api/* 与 src/apis/* 已成立`
- **运行时前提**：`/me/sessions` facade 可用；`/me/conversations` 只有在 reality audit 收敛后才可启用`
- **组织协作前提**：`F4 依赖 F3 的 session bootstrap`
- **上线 / 合并前提**：`auth 与 session navigation 主线已可手动走通`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `clients/web/docs/charter/web-v10-foundations.md`（若 F3 边界有偏移）
- 需要同步更新的说明文档 / README：
  - `留给 F5 的 api-contract.md`
- 需要同步更新的测试说明：
  - `无`

### 7.4 完成后的预期状态

1. 用户可以通过正式 auth 页面进入系统。
2. sidebar 能展示并切换真实的 session/conversation。
3. 新建会话不再依赖手工 session UUID。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `clients/web build`
  - `确认 AuthPage、Sidebar、ChatPage 已接入`
- **单元测试**：
  - `不适用`
- **集成测试**：
  - `auth + session list + new session 基础流程`
- **端到端 / 手动验证**：
  - `register/login → /me → list sessions/conversations → create session → select session`
- **回归测试**：
  - `空状态、失败状态、token 过期路径`
- **文档校验**：
  - `确认 F3 不越权描述聊天主链与 inspector`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. 用户可通过 auth 主线进入系统。
2. `/me/sessions` 已成为 sidebar canonical 数据源；`/me/conversations` 的 fate（启用或 deferred）已被明确写死。
3. 新建与切换会话路径可运行。
4. 关键空态/错态/未登录态有明确 UI 行为。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `auth + session navigation 主线成立` |
| 测试 | `build 与基础手动流程通过` |
| 文档 | `F3 范围与 charter 一致` |
| 风险收敛 | `手输 session UUID 不再是产品主线` |
| 可交付性 | `F4 可基于稳定 session bootstrap 继续实现聊天主链` |

---

## 9. 执行日志回填（仅 `executed` 状态使用）

| 编号 | 工作项 | 状态 | 证据 |
|------|--------|------|------|
| P1-01 | create auth state and form flow | ✅ | `AuthPage.tsx` + `AuthForm` 逻辑内联 + `src/state/auth.ts`（localStorage 持久化 + 订阅机制）已建立 |
| P2-01 | wire me/sessions read model | ✅ | `src/apis/sessions.ts` 中 `listMySessions` + `src/state/sessions.ts` 已建立 |
| P2-02 | audit me/conversations reality | ✅ | `clients/api-docs/README.md` 仍列为未实现；F3 明确以 `/me/sessions` 为 canonical source，sidebar 不依赖 conversation |
| P3-01 | build sidebar navigation | ✅ | `Sidebar.tsx` + `SessionList.tsx` 已实现会话列表展示、选中态、切换导航 |
| P3-02 | add new session flow | ✅ | `App.tsx` 中 `createSession` 回调使用 server-mint 路径，`ChatPage` 自动跳转 |
| P4-01 | add guards and UI states | ✅ | AuthPage 有 loading/error 态；未登录时自动跳转 auth；token 过期自动登出 |

**F3 收口判定**: `full close` — auth + session navigation 主线成立，手输 session UUID 已退役。
