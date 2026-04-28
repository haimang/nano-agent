# Nano-Agent 行动计划 — Web-v10 F1 React Shell Reset

> 服务业务簇: `clients/web / web-v10 / react-shell-reset`
> 计划对象: `把现有 DOM dogfood client 重置为 React dark shell 与产品化目录骨架`
> 类型: `upgrade + refactor`
> 作者: `Copilot`
> 时间: `2026-04-28`
> 文件位置:
> - `clients/web/package.json`
> - `clients/web/src/{main.ts,main.tsx,App.tsx}`
> - `clients/web/src/{components,pages,constants,styles}/`
> - `clients/web/index.html`
> 上游前序 / closure:
> - `clients/web/docs/charter/web-v10-foundations.md`
> - `clients/web/docs/action-plan/web-v10/F0-foundation-freeze.md`
> 下游交接:
> - `clients/web/docs/action-plan/web-v10/F2-bff-and-transport-split.md`
> - `clients/web/docs/action-plan/web-v10/F3-auth-and-session-navigation.md`
> 关联设计 / 调研文档:
> - `clients/web/docs/charter/web-v10-foundations.md`
> - `clients/web/src/main.ts`
> - `clients/web/src/client.ts`
> - `clients/api-docs/README.md`
> - `clients/api-docs/README.md`
> 冻结决策来源:
> - `web-v10-foundations.md` §1.1 D1-D3 / §5 `shell-before-richness` / §7.2 F1（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `executed`

---

## 0. 执行背景与目标

F1 的任务是把当前 `clients/web` 从“可点按钮的 dogfood 面板”切换为“可以承接真实页面与业务主线的 React 壳层”。现状已经很明确：`package.json` 只有 `vite + typescript`，`src/main.ts` 直接拼装 DOM。若不先做 F1，F3/F4 之后的任何业务接线都只会把 demo 变成更大的 demo。

- **服务业务簇**：`clients/web / web-v10`
- **计划对象**：`react-shell-reset`
- **本次计划解决的问题**：
  - 当前没有 React app shell、组件层、页面层与 constants 层。
  - 当前 UI 入口与产品入口混在 `src/main.ts` 单文件里。
  - 当前没有 dark-mode 产品壳，无法承接 Open WebUI 风格目标。
- **本次计划的直接产出**：
  - React 入口与 `App.tsx`
  - `components / pages / constants / styles` 产品化目录骨架
  - dark shell 布局：sidebar / main / inspector / topbar
- **本计划不重新讨论的设计结论**：
  - Web 技术栈已冻结为 `Cloudflare Pages + Vite + React + TypeScript`（来源：charter §1.1 D2）
  - F1 只做 shell，不做完整业务链闭环（来源：charter §7.2）

### 0.1 开工前必须继承的项目上下文

F1 虽然不直接实现接口调用，但它也不是孤立 UI 重构。开工时至少同时打开：

1. `clients/web/docs/charter/web-v10-foundations.md`
2. `clients/api-docs/README.md`
3. `clients/web/src/main.ts`
4. `clients/web/src/client.ts`

### 0.2 F1 与 clients/api-docs 的关系

F1 不接业务，但必须让页面骨架与当前 API family 对齐，而不是拍脑袋命名页面：

| 页面骨架 | 对应 contract 入口 | F1 口径 |
|---|---|---|
| `AuthPage` | `auth.md` | 保留 auth 主入口位置 |
| `ChatPage` | `me-sessions.md` + `session.md` + `session-ws-v1.md` | 保留 session/chat 主工作区 |
| `CatalogPage` | `catalog.md` | 允许空内容骨架 |
| `HealthPage` | `worker-health.md` | debug/ops 辅助页，不是业务主页 |
| `SettingsPage` | `README.md` 当前未实现列表 | 只保留 settings 容器，不预设不存在的具体接口 |

---

## 1. 执行综述

### 1.1 总体执行方式

执行方式采用 **“先引入 React 入口，再建立壳层，再拆页面骨架，最后退掉旧 DOM 入口”**。F1 的目标不是把所有页面都做完，而是把 `clients/web` 的结构切到正确轨道。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | React Runtime Bootstrap | `S` | 引入 React/React DOM、主入口与基础应用壳 | `-` |
| Phase 2 | App Shell And Theme | `M` | 建 sidebar / topbar / inspector / main 的 dark shell | `Phase 1` |
| Phase 3 | Page Skeleton And Directory Reset | `M` | 建立页面、组件、常量与样式目录骨架 | `Phase 2` |
| Phase 4 | DOM Demo Retirement | `S` | 移除 DOM demo 作为主入口，保留 transport 资产但不保留旧 UI 结构 | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — React Runtime Bootstrap**
   - **核心目标**：完成 React 工程入口切换。
   - **为什么先做**：没有 React 入口，后续任何页面骨架都不成立。
2. **Phase 2 — App Shell And Theme**
   - **核心目标**：先把产品壳搭起来，而不是直接接 API。
   - **为什么放在这里**：这是 `shell-before-richness` 的直接落实。
3. **Phase 3 — Page Skeleton And Directory Reset**
   - **核心目标**：建立后续 F2-F5 会依赖的文件边界。
   - **为什么放在这里**：没有目录骨架，transport 与页面会再次缠绕。
4. **Phase 4 — DOM Demo Retirement**
   - **核心目标**：不再允许 `main.ts` 的旧式 UI 作为 canonical entry。
   - **为什么放在最后**：必须先把 React 主入口立住，再退旧壳。

### 1.4 执行策略说明

- **执行顺序原则**：`先 entry，再 shell，再 pages，再 retire old demo`
- **风险控制原则**：`transport 资产保留，但 UI 结构必须重做`
- **测试推进原则**：`以 clients/web build + 本地 preview 验证为主`
- **文档同步原则**：`F1 只同步 action-plan，不提前写运行文档`
- **回滚 / 降级原则**：`若 React shell 未成形，不删除旧 DOM 入口`

### 1.5 本次 action-plan 影响结构图

```text
web-v10 / F1 react-shell-reset
├── Phase 1: React Runtime Bootstrap
│   ├── package.json
│   └── src/main.tsx / App.tsx
├── Phase 2: App Shell And Theme
│   ├── src/components/
│   ├── src/styles/
│   └── src/constants/
├── Phase 3: Page Skeleton And Directory Reset
│   └── src/pages/
└── Phase 4: DOM Demo Retirement
    ├── src/main.ts
    └── index.html
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 引入 React / React DOM 与 React 入口文件
- **[S2]** 建立 `AppShell` 风格的 dark layout
- **[S3]** 建立与当前 `clients/api-docs` route family 对齐的 `pages / components / constants / styles` 目录骨架
- **[S4]** 退役旧 DOM demo 作为主 UI 入口

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** same-origin BFF 与 API 分层实现
- **[O2]** auth、session、chat 的完整业务接线
- **[O3]** Pages 部署文档与运行文档
- **[O4]** 任何对后端能力的产品承诺扩张

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `src/App.tsx` 与 `src/main.tsx` | `in-scope` | React shell 的基本入口 | 无 |
| `src/apis/*` | `out-of-scope` | 属于 F2 | F2 |
| `src/pages/{Auth,Chat,Settings,Catalog,Health}` 骨架 | `in-scope` | F1 需要给后续 phase 提供页面落脚点 | 无 |
| 真实业务调用 | `defer / depends-on-design` | F1 只做 shell，不做主链 | F3-F5 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | add React runtime deps | `add` | `clients/web/package.json` | 让 web 工程具备 React 入口能力 | `medium` |
| P1-02 | Phase 1 | create React entry | `add` | `src/main.tsx` `src/App.tsx` | 建立新的 UI 主入口 | `medium` |
| P2-01 | Phase 2 | create app shell components | `add` | `src/components/*` | 建立 dark shell 主要区域 | `medium` |
| P2-02 | Phase 2 | create theme and constants | `add` | `src/styles/*` `src/constants/*` | 固定视觉 token 与布局常量 | `low` |
| P3-01 | Phase 3 | create page skeletons | `add` | `src/pages/*` | 让 F3-F5 有页面落脚点 | `medium` |
| P4-01 | Phase 4 | retire DOM demo as primary entry | `update` | `src/main.ts` `index.html` | 让旧 demo 不再承担产品入口 | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — React Runtime Bootstrap

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | add React runtime deps | 为 `clients/web` 增加 React 与 React DOM 依赖，保证 Vite 工程可进入 React 模式 | `package.json` | React 工程可安装与构建 | `clients/web build` | 依赖声明完成且工程可编译 |
| P1-02 | create React entry | 新建 `main.tsx` 与 `App.tsx`，切换页面入口 | `src/main.tsx` `src/App.tsx` | 新 UI 入口替代旧 DOM 入口 | `clients/web build + preview` | 页面已由 React 渲染 |

### 4.2 Phase 2 — App Shell And Theme

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | create app shell components | 建立 `AppShell`、`Sidebar`、`Topbar`、`InspectorPanel`、`MainPanel` 等骨架组件 | `src/components/*` | dark shell 结构成立 | `preview manual check` | 页面已有三栏/双栏产品壳 |
| P2-02 | create theme and constants | 建立色板、间距、布局常量与主题变量 | `src/styles/*` `src/constants/*` | 视觉 token 不再散落在单文件 | `preview manual check` | dark mode 基础 token 可复用 |

### 4.3 Phase 3 — Page Skeleton And Directory Reset

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | create page skeletons | 建 `AuthPage`、`ChatPage`、`SettingsPage`、`CatalogPage`、`HealthPage` 骨架 | `src/pages/*` | 后续业务 phase 有页面锚点 | `build + route smoke` | 页面骨架存在且可导航 |

### 4.4 Phase 4 — DOM Demo Retirement

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | retire DOM demo as primary entry | 将 `src/main.ts` 从产品主入口中移出，避免继续追加 DOM 逻辑 | `src/main.ts` `index.html` | 旧 demo 不再是主 UI 事实 | `build + preview` | canonical entry 已转为 React |

---

## 5. Phase 详情

### 5.1 Phase 1 — React Runtime Bootstrap

- **Phase 目标**：切换到 React runtime。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `src/main.tsx`
  - `src/App.tsx`
- **本 Phase 修改文件**：
  - `clients/web/package.json`
- **具体功能预期**：
  1. `clients/web` 具备 React 入口
  2. UI 进入组件树管理，而非手写 DOM 拼装
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`clients/web build`
  - **回归测试**：`preview 渲染检查`
  - **手动验证**：`确认页面由 React 根节点渲染`
- **收口标准**：
  - React 入口已经可运行
  - 旧 DOM 不再是唯一入口
- **本 Phase 风险提醒**：
  - 不能只装依赖而不切入口

### 5.2 Phase 2 — App Shell And Theme

- **Phase 目标**：先立产品壳与 dark theme。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `src/components/*`
  - `src/styles/*`
  - `src/constants/*`
- **本 Phase 修改文件**：
  - `src/App.tsx`
- **具体功能预期**：
  1. 页面具备侧栏、主视区与 inspector 结构
  2. dark theme 变量可以被后续页面共用
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`clients/web build`
  - **回归测试**：`不同页面壳结构检查`
  - **手动验证**：`深色主题和基础布局检查`
- **收口标准**：
  - app shell 已成形
  - theme/token 不再散落
- **本 Phase 风险提醒**：
  - 不要把 F2/F3 的业务逻辑偷塞进 shell phase

### 5.3 Phase 3 — Page Skeleton And Directory Reset

- **Phase 目标**：建立页面落脚点。
- **本 Phase 对应编号**：
  - `P3-01`
- **本 Phase 新增文件**：
  - `src/pages/*`
- **本 Phase 修改文件**：
  - `src/App.tsx`
- **具体功能预期**：
  1. F3-F5 需要的页面骨架已存在
  2. 页面结构与组件结构分离
  3. 页面骨架名称与 `clients/api-docs` 当前 route family 对齐，不提前承诺不存在的接口
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build`
  - **回归测试**：`页面切换 smoke`
  - **手动验证**：`确认五类页面都存在占位结构`
- **收口标准**：
  - 页面目录建立完成
  - 不再需要在 `App.tsx` 单文件里堆所有 UI
- **本 Phase 风险提醒**：
  - 页面名和职责必须与 charter 的 F1/F3/F5 边界一致

### 5.4 Phase 4 — DOM Demo Retirement

- **Phase 目标**：正式退掉旧 DOM demo 的主入口地位。
- **本 Phase 对应编号**：
  - `P4-01`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `src/main.ts`
  - `index.html`
- **具体功能预期**：
  1. 旧 demo 逻辑不再被误用为产品主界面
  2. transport 资产可保留，但 UI 壳已完全换代
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`clients/web build`
  - **回归测试**：`preview 页面入口检查`
  - **手动验证**：`确认页面不再显示旧按钮式面板`
- **收口标准**：
  - canonical UI 已是 React shell
  - 旧 demo 不再是主入口
- **本 Phase 风险提醒**：
  - 不能把旧 DOM demo 以“临时兼容”名义继续保留成主路径

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| D1: dark mode 参考 Open WebUI | `web-v10-foundations.md` §1.1 | F1 的 shell 和 theme 目标 | 若改变，F1 shell 目标需重写 |
| M1: `shell-before-richness` | `web-v10-foundations.md` §5 | F1 不能提前做 F2-F5 业务 | 若不成立，phase 边界会崩塌 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| 继续在旧 DOM 文件上叠逻辑 | 最常见的路径依赖 | `high` | 明确退役旧主入口 |
| React 结构空壳化 | 只换入口，不立组件/页面边界 | `medium` | phase 2/3 必须完成 |

### 7.2 约束与前提

- **技术前提**：`clients/web` 继续保持 out-of-workspace dogfood consumer 姿势`
- **运行时前提**：`F1 不要求 live API 全闭环`
- **组织协作前提**：`F2/F3 执行前必须继承 F1 的目录结构`
- **上线 / 合并前提**：`React shell build 成功且旧主入口退役`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `clients/web/docs/charter/web-v10-foundations.md`（若 F1 落地结构与 charter 不一致则必须回修）
- 需要同步更新的说明文档 / README：
  - `无`
- 需要同步更新的测试说明：
  - `无`

### 7.4 完成后的预期状态

1. `clients/web` 已成为 React 应用，而不是 DOM demo。
2. dark shell 和页面骨架为 F2-F5 提供稳定落脚点。
3. 后续 phase 不再需要在单文件 UI 上堆积逻辑。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `clients/web build`
  - `preview 启动后页面能正常渲染`
- **单元测试**：
  - `不适用（若后续引入测试工具，进入 F5 统一处理）`
- **集成测试**：
  - `React 入口与页面骨架联动检查`
- **端到端 / 手动验证**：
  - `检查 sidebar / main / inspector / topbar 基本布局`
- **回归测试**：
  - `确认旧 DOM demo 不再作为主入口渲染`
- **文档校验**：
  - `确认 F1 不越权承诺业务闭环`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. React 入口与 `App.tsx` 已取代 DOM 主入口。
2. `components / pages / constants / styles` 目录结构已建立。
3. dark shell 布局已成形。
4. 旧 `main.ts` 不再承担产品主界面职责。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `React shell 可运行且结构完整` |
| 测试 | `clients/web build + preview 检查通过` |
| 文档 | `F1 与 foundations 边界一致` |
| 风险收敛 | `不再依赖旧 DOM demo 作为产品入口` |
| 可交付性 | `F2/F3 可直接基于新目录继续实施` |

---

## 9. 执行日志回填（仅 `executed` 状态使用）

| 编号 | 工作项 | 状态 | 证据 |
|------|--------|------|------|
| P1-01 | add React runtime deps | ✅ | `package.json` 已添加 `react@^19.0.0` + `react-dom@^19.0.0` + `@types/react` + `@types/react-dom` |
| P1-02 | create React entry | ✅ | `src/main.tsx` + `src/App.tsx` 已创建，`index.html` 已切换入口 |
| P2-01 | create app shell components | ✅ | `AppShell.tsx`（含 Sidebar/Topbar/InspectorPanel/MainPanel）已建立 dark layout |
| P2-02 | create theme and constants | ✅ | `src/styles/global.css` 已定义 CSS 变量系统，`src/constants/theme.ts` 已创建 |
| P3-01 | create page skeletons | ✅ | `AuthPage`, `ChatPage`, `SettingsPage`, `CatalogPage`, `HealthPage` 骨架已建立 |
| P4-01 | retire DOM demo as primary entry | ✅ | `src/main.ts` 已不再作为主入口，React shell 为 canonical UI |

**F1 收口判定**: `full close` — React shell 可运行且结构完整，旧 DOM demo 已退役。
