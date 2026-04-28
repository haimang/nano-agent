# Nano-Agent 行动计划 — Web-v10 F2 BFF And Transport Split

> 服务业务簇: `clients/web / web-v10 / bff-and-transport-split`
> 计划对象: `建立 same-origin BFF 与前端 API 分层，并从 NanoClient 中提纯 transport 资产`
> 类型: `new + refactor`
> 作者: `Copilot`
> 时间: `2026-04-28`
> 文件位置:
> - `clients/web/functions/api/{auth,me,sessions,catalog,debug}/`
> - `clients/web/src/apis/{transport,auth,sessions,catalog,debug}.ts`
> - `clients/web/src/client.ts`
> - `clients/web/package.json`
> 上游前序 / closure:
> - `clients/web/docs/charter/web-v10-foundations.md`
> - `clients/web/docs/action-plan/web-v10/F1-react-shell-reset.md`
> 下游交接:
> - `clients/web/docs/action-plan/web-v10/F3-auth-and-session-navigation.md`
> - `clients/web/docs/action-plan/web-v10/F4-chat-mainline-and-stream.md`
> 关联设计 / 调研文档:
> - `clients/web/docs/charter/web-v10-foundations.md`
> - `clients/web/src/client.ts`
> - `clients/api-docs/README.md`
> - `clients/api-docs/{auth,me-sessions,session,session-ws-v1,usage,permissions,catalog,worker-health}.md`
> 冻结决策来源:
> - `web-v10-foundations.md` §1.3 / §4.3 / §5 `BFF-for-HTTP` / §7.3 F2（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `executed`

---

## 0. 执行背景与目标

F2 是 web-v10 foundation 的第二个硬门槛：在 React shell 成立之后，HTTP 仍不能继续以“页面直接打 upstream URL”的方式增长。当前 `NanoClient` 已经积累了 auth、session、usage、catalog 与 WS 的协议经验，但它仍是一个 dogfood adapter，而不是最终的 Web BFF + API 分层。

- **服务业务簇**：`clients/web / web-v10`
- **计划对象**：`bff-and-transport-split`
- **本次计划解决的问题**：
  - 浏览器 HTTP 若继续直打 upstream，会让 env、trace、auth、error 归一长期碎片化。
  - `src/client.ts` 若继续承担全部调用，会成为前端 transport 巨石。
  - 页面层需要一个稳定的 `/api/*` 同域入口，而不是手工拼接 upstream URL。
- **本次计划的直接产出**：
  - Pages Functions BFF 路由族
  - `src/apis/*` 前端 API 分层
  - `src/client.ts` 的兼容缩减或过渡包装
- **本计划不重新讨论的设计结论**：
  - HTTP 默认走 same-origin BFF（来源：charter §1.3 / §4.3）
  - WebSocket first-wave 仍 direct connect，不在 F2 一步到位改成 gateway（来源：charter §4.5 / §7.3）

### 0.1 开工前必须继承的项目上下文

F2 是 web-v10 里最依赖“全项目上下文”的 phase 之一。执行时至少同时打开：

1. `clients/web/docs/charter/web-v10-foundations.md`
2. `clients/api-docs/README.md`
3. `clients/api-docs/{auth,me-sessions,session,session-ws-v1,usage,permissions,catalog,worker-health}.md`
4. `clients/web/src/client.ts`

### 0.2 F2 接口参照入口

| BFF / API 域 | 直接参考文档 | 执行时必须注意的现实约束 |
|---|---|---|
| `auth` | `clients/api-docs/auth.md` | auth 成功 shape 是标准 facade envelope |
| `me/sessions` | `clients/api-docs/me-sessions.md` | `POST/GET /me/sessions` 是标准 facade envelope，但 mint 后 pending truth 仍有现实限制 |
| `sessions/*` | `clients/api-docs/session.md` | `start/input/cancel/status/timeline/history/verify` 仍是 legacy action payload split |
| `permissions` | `clients/api-docs/permissions.md` | HTTP path live，但 runtime unblock 未落地 |
| `usage` | `clients/api-docs/usage.md` | snapshot path live，usage 数值仍为 placeholder |
| `catalog` | `clients/api-docs/catalog.md` | route 稳定，但内容当前是空数组 placeholder |
| `debug` | `clients/api-docs/worker-health.md` | 不是标准 facade envelope，而是 debug JSON |
| `ws` | `clients/api-docs/session-ws-v1.md` | 不在 F2 主范围，但要用它约束 HTTP/BFF 不去假设 WS 已 fully live |

### 0.3 Drift 处理原则

若执行 F2 时发现 `clients/api-docs` 与 façade 代码现实不一致，必须二选一并在同一变更中完成：

1. 更新 `clients/api-docs`，让文档与当前 façade 保持一致；
2. 把该能力降级为 conditional / compat path，并在 F2/F3/F4/F5 action-plan 中显式写出。

---

## 1. 执行综述

### 1.1 总体执行方式

整体采用 **“先立 BFF 路由，再拆前端 API，再做错误/env/trace 归一，最后切页面接线”** 的方式。F2 不追求把所有页面都接完，而是建立可复用的 HTTP transport 基线。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | BFF Route Family Scaffold | `M` | 建立 `/api/auth|me|sessions|catalog|debug` 路由族 | `-` |
| Phase 2 | Front-End API Extraction | `M` | 从 `NanoClient` 抽出 `src/apis/*` 层 | `Phase 1` |
| Phase 3 | Error / Env / Trace Normalization | `S` | 统一 preview/prod upstream、auth headers、错误模型、trace 注入 | `Phase 2` |
| Phase 4 | Page Cutover And Compat Shrink | `S` | 页面改走新 API 层，`src/client.ts` 退到兼容/WS 资产层 | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — BFF Route Family Scaffold**
   - **核心目标**：先让浏览器有稳定的 `/api/*` 同域入口。
   - **为什么先做**：没有 BFF，HTTP 姿势就仍是旧模型。
2. **Phase 2 — Front-End API Extraction**
   - **核心目标**：把 `NanoClient` 按域拆出前端 API 模块。
   - **为什么放在这里**：页面不能直接依赖巨石 adapter。
3. **Phase 3 — Error / Env / Trace Normalization**
   - **核心目标**：解决真实 Web 环境最容易碎裂的错误与环境问题。
   - **为什么放在这里**：它必须建立在 BFF 与 API 分层已经存在的基础上。
4. **Phase 4 — Page Cutover And Compat Shrink**
   - **核心目标**：把页面层切到新 API，保留必要兼容但不保留旧结构。
   - **为什么放在最后**：只有前 3 个阶段稳定，页面切换才有意义。

### 1.4 执行策略说明

- **执行顺序原则**：`先 BFF，再 API，再归一，再切页面`
- **风险控制原则**：`WebSocket 不在 F2 扩 scope；F2 只负责 HTTP posture`
- **测试推进原则**：`以 build、本地 preview、HTTP route smoke 为主`
- **文档同步原则**：`F2 不提前写最终 API 文档，但要为 F5 保留统一 contract 面`
- **回滚 / 降级原则**：`若页面未完全切走，可暂保 compat wrapper，但不保留旧页面直打 upstream`

### 1.5 本次 action-plan 影响结构图

```text
web-v10 / F2 bff-and-transport-split
├── Phase 1: BFF Route Family Scaffold
│   └── functions/api/{auth,me,sessions,catalog,debug}
├── Phase 2: Front-End API Extraction
│   ├── src/apis/transport.ts
│   ├── src/apis/auth.ts
│   ├── src/apis/sessions.ts
│   └── src/apis/{catalog,debug}.ts
├── Phase 3: Error / Env / Trace Normalization
│   └── auth / trace / preview-prod env rules
└── Phase 4: Page Cutover And Compat Shrink
    ├── src/client.ts
    └── page adapters
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 建立 Pages Functions BFF 路由族
- **[S2]** 建立 `src/apis/*` 前端 API 层
- **[S3]** 统一 HTTP trace / env / error / auth 归一策略，并显式兼容 `clients/api-docs/README.md` 里的 success-shape split
- **[S4]** 切断页面层直接访问 upstream 的路径

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** WS gateway / same-origin WS 代理
- **[O2]** cookie/session 二期安全体系
- **[O3]** 聊天 UI 主链体验实现
- **[O4]** 最终 API 文档完整撰写

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `functions/api/*` | `in-scope` | BFF 是 F2 的硬目标 | 无 |
| `src/client.ts` 完全删除 | `out-of-scope` | 允许保留 WS 与兼容资产，不要求一步删除 | 后续 F4/F5 |
| WS direct connect | `defer / depends-on-design` | frozen 例外，不在 F2 处理 | 后端提供 gateway 后重评 |
| `/debug/workers/health` 使用独立 JSON normalizer | `in-scope` | `worker-health.md` 已明确它不是 facade envelope | 无 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | scaffold BFF routes | `add` | `functions/api/*` | 建立同域 HTTP 入口 | `medium` |
| P2-01 | Phase 2 | extract front-end auth/session/catalog/debug APIs | `refactor` | `src/apis/*` `src/client.ts` | 让页面不再依赖巨石 client | `high` |
| P3-01 | Phase 3 | normalize env and trace | `update` | `functions/api/*` `src/apis/transport.ts` | 统一 preview/prod 与 trace 注入 | `medium` |
| P3-02 | Phase 3 | normalize error model | `update` | `src/apis/transport.ts` | 统一成功/失败 shape，并兼容 facade envelope / legacy action payload / debug JSON 三类返回 | `medium` |
| P4-01 | Phase 4 | cut pages to new APIs | `update` | `src/pages/*` `src/client.ts` | 页面完全走新 HTTP posture | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — BFF Route Family Scaffold

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | scaffold BFF routes | 建 `auth/me/sessions/catalog/debug` 五族同域路由，代理到 `orchestrator-core` facade | `functions/api/*` | 浏览器有稳定 `/api/*` 面 | `manual HTTP smoke` | 主要 route family 已存在 |

### 4.2 Phase 2 — Front-End API Extraction

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | extract front-end APIs | 把 `NanoClient` 按 auth/sessions/catalog/debug/transport 域拆解到 `src/apis/*` | `src/apis/*` `src/client.ts` | 页面不再直绑巨石 client | `build + type check via build` | `src/apis/*` 成为主入口 |

### 4.3 Phase 3 — Error / Env / Trace Normalization

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | normalize env and trace | 统一 preview/prod upstream 读取、trace 注入与 auth header 规则 | `functions/api/*` `src/apis/transport.ts` | env 与 trace 不再散落 | `manual request inspection` | HTTP 姿势统一 |
| P3-02 | normalize error model | 统一成功 envelope 与错误对象到 Web 可消费模型，覆盖 `auth`/`me-sessions` 标准 facade envelope、`session.md` 的 legacy action payload、`worker-health.md` 的 debug JSON 三类返回 | `src/apis/transport.ts` | 页面可以依赖统一错误模型 | `manual error smoke` | 页面层不再自行拼错误处理 |

### 4.4 Phase 4 — Page Cutover And Compat Shrink

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | cut pages to new APIs | 让页面层全部走 `src/apis/*` 与 `/api/*`，`src/client.ts` 退到兼容/WS 层 | `src/pages/*` `src/client.ts` | HTTP 主链完成切换 | `build + preview flows` | 页面不再直打 upstream |

---

## 5. Phase 详情

### 5.1 Phase 1 — BFF Route Family Scaffold

- **Phase 目标**：建立同域 HTTP 门面。
- **本 Phase 对应编号**：
  - `P1-01`
- **本 Phase 新增文件**：
  - `functions/api/auth/*`
  - `functions/api/me/*`
  - `functions/api/sessions/*`
  - `functions/api/catalog/*`
  - `functions/api/debug/*`
- **本 Phase 修改文件**：
  - `无`
- **具体功能预期**：
  1. 浏览器请求统一从 `/api/*` 发出
  2. upstream URL 被封装到 Functions 层
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`clients/web build`
  - **回归测试**：`关键 route 手动调用`
  - **手动验证**：`登录、me、session list 等基础 route 代理检查`
- **收口标准**：
  - route family 已存在
  - 浏览器不再需要知道全部 upstream URL
- **本 Phase 风险提醒**：
  - 不要把 F1/F3 的页面逻辑混进 Functions

### 5.2 Phase 2 — Front-End API Extraction

- **Phase 目标**：把 `NanoClient` 拆为真正的前端 API 层。
- **本 Phase 对应编号**：
  - `P2-01`
- **本 Phase 新增文件**：
  - `src/apis/transport.ts`
  - `src/apis/auth.ts`
  - `src/apis/sessions.ts`
  - `src/apis/catalog.ts`
  - `src/apis/debug.ts`
- **本 Phase 修改文件**：
  - `src/client.ts`
- **具体功能预期**：
  1. 页面能依赖按域划分的 API 模块
  2. `src/client.ts` 不再承担未来全部 HTTP 逻辑
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build`
  - **回归测试**：`API 调用 smoke`
  - **手动验证**：`抽查 auth/session/catalog/debug 调用路径`
- **收口标准**：
  - `src/apis/*` 成为主入口
  - 页面层已可准备切换
- **本 Phase 风险提醒**：
  - 不能只是复制 `NanoClient` 代码到更多文件

### 5.3 Phase 3 — Error / Env / Trace Normalization

- **Phase 目标**：建立真实 Web 所需的环境与错误统一面。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `functions/api/*`
  - `src/apis/transport.ts`
- **具体功能预期**：
  1. preview/prod 切换不再污染页面代码
  2. 页面消费统一错误对象与 trace 行为
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build`
  - **回归测试**：`正常/错误路径手动 smoke`
  - **手动验证**：`检查 trace uuid 与错误展示`
- **收口标准**：
  - env/trace/error 已集中处理
  - 页面层不再自行判断 envelope 细节
- **本 Phase 风险提醒**：
  - 若错误模型不统一，F3-F5 会重新分裂

### 5.4 Phase 4 — Page Cutover And Compat Shrink

- **Phase 目标**：完成 HTTP 页面切换。
- **本 Phase 对应编号**：
  - `P4-01`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `src/pages/*`
  - `src/client.ts`
- **具体功能预期**：
  1. 页面全部使用 `src/apis/*`
  2. `src/client.ts` 退为兼容层或 WS 资产层
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build`
  - **回归测试**：`基础 HTTP 页面流程`
  - **手动验证**：`页面已不直接拼 upstream URL`
- **收口标准**：
  - HTTP 主链切换完成
  - compat 层不会再被当成长期主入口
- **本 Phase 风险提醒**：
  - 不能只做新 API 层而不切页面

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| B1: HTTP through BFF | `web-v10-foundations.md` §1.3 / §4.3 | F2 是整个 web-v10 的硬 gate | 若改变，F2 整体目标需要重写 |
| B2: WS direct connect as controlled exception | `web-v10-foundations.md` §4.5 | F2 不扩 scope 到 WS gateway | 若改变，需新增独立 WS 设计与计划 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| transport 巨石复刻 | 只是把 `NanoClient` 拆成多个大文件 | `high` | 强制按域切分且页面切换 |
| 页面直打 upstream 残留 | 旧逻辑残留在页面中 | `medium` | Phase 4 收口检查 |

### 7.2 约束与前提

- **技术前提**：`F1 React shell 已成立`
- **运行时前提**：`orchestrator-core facade 为唯一 HTTP 上游`
- **组织协作前提**：`F3/F4 基于新的 src/apis/* 与 /api/*`
- **上线 / 合并前提**：`浏览器主路径不再依赖 upstream URL 直连`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `clients/web/docs/charter/web-v10-foundations.md`（若 BFF 口径发生变化）
- 需要同步更新的说明文档 / README：
  - `留给 F5 的 api-contract.md`
- 需要同步更新的测试说明：
  - `无`

### 7.4 完成后的预期状态

1. Web HTTP 主链已具备同域 BFF 姿势。
2. `src/apis/*` 成为页面调用主入口。
3. `src/client.ts` 不再是长期 HTTP 巨石。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `clients/web build`
  - `检查 functions/api/* 与 src/apis/* 是否齐全`
- **单元测试**：
  - `不适用`
- **集成测试**：
  - `通过 preview 与本地 route smoke 验证 auth/me/sessions 等关键路径`
- **端到端 / 手动验证**：
  - `确认页面侧请求统一走 /api/*`
- **回归测试**：
  - `检查是否仍有页面直接拼接 upstream HTTP URL`
- **文档校验**：
  - `确认 F2 不把 WS gateway 或 cookie 二期误写成本轮范围`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `functions/api/*` 同域 BFF 路由已建立。
2. `src/apis/*` 已取代 `src/client.ts` 成为 HTTP 主入口。
3. 页面层不再直接访问 upstream URL。
4. env/trace/error HTTP 姿势已统一。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `BFF 与 API 分层已落地` |
| 测试 | `build 与关键 HTTP route smoke 通过` |
| 文档 | `F2 与 charter 的 BFF 纪律一致` |
| 风险收敛 | `页面直打 upstream 的路径已清零` |
| 可交付性 | `F3/F4 可以直接在新 HTTP posture 上继续实现` |

---

## 9. 执行日志回填（仅 `executed` 状态使用）

| 编号 | 工作项 | 状态 | 证据 |
|------|--------|------|------|
| P1-01 | scaffold BFF routes | ✅ | `functions/api/[[path]].ts` 已建立通用代理路由，覆盖 auth/me/sessions/catalog/debug |
| P2-01 | extract front-end APIs | ✅ | `src/apis/transport.ts`（含错误模型）+ `auth.ts` + `sessions.ts` + `catalog.ts` + `debug.ts` 已拆分 |
| P3-01 | normalize env and trace | ✅ | `Transport` 类统一处理 preview/prod upstream、trace uuid 注入与 BFF toggle |
| P3-02 | normalize error model | ✅ | `ApiRequestError` + `ApiError` 类型统一处理 facade envelope / legacy payload / debug JSON 三类返回 |
| P4-01 | cut pages to new APIs | ✅ | 所有页面均通过 `src/apis/*` 调用，`src/client.ts` 退为 WS 资产层 |

**F2 收口判定**: `full close` — BFF 与 API 分层已落地，页面不再直打 upstream。
