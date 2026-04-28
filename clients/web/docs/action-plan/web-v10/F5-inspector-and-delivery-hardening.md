# Nano-Agent 行动计划 — Web-v10 F5 Inspector And Delivery Hardening

> 服务业务簇: `clients/web / web-v10 / inspector-and-delivery-hardening`
> 计划对象: `补齐 inspector 与辅助页面，并形成 setup/deployment/api-contract 等交付文档与基础硬化`
> 类型: `new + modify`
> 作者: `Copilot`
> 时间: `2026-04-28`
> 文件位置:
> - `clients/web/src/components/inspector/*`
> - `clients/web/src/pages/{SettingsPage,CatalogPage,HealthPage}.tsx`
> - `clients/web/src/apis/{sessions,catalog,debug}.ts`
> - `clients/web/docs/{setup.md,deployment.md,api-contract.md}`
> - `clients/web/package.json`
> 上游前序 / closure:
> - `clients/web/docs/action-plan/web-v10/F4-chat-mainline-and-stream.md`
> 下游交接:
> - `clients/web/docs/action-plan/web-v10/F6-closure-and-handoff.md`
> 关联设计 / 调研文档:
> - `clients/web/docs/charter/web-v10-foundations.md`
> - `clients/api-docs/README.md`
> - `clients/api-docs/{session,session-ws-v1,usage,permissions,catalog,worker-health}.md`
> 冻结决策来源:
> - `web-v10-foundations.md` §4.1 I4 / §4.2 O3-O4 / §7.6 F5（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `executed`

---

## 0. 执行背景与目标

F5 的任务是把 Web 从“已经能聊天”推进到“具备基本 inspection 能力、辅助页面与可交付文档”的状态。它不是产品 richness 的终局，而是 foundation 最后一段硬化：让 usage/files/timeline/history/status 进入右侧 inspector，让 catalog/health/devices 成为辅助面，并让 setup/deployment/api-contract 成文。

- **服务业务簇**：`clients/web / web-v10`
- **计划对象**：`inspector-and-delivery-hardening`
- **本次计划解决的问题**：
  - ChatPage 还缺少右侧 inspection 面。
  - settings / catalog / health / devices 还没有正式页面落点。
  - 本地开发、preview 部署与 API 文档还没有 Web 侧说明文档。
- **本次计划的直接产出**：
  - inspector tabs：status / usage / files / timeline / history
  - Settings / Catalog / Health 辅助页面
  - `setup.md` / `deployment.md` / `api-contract.md`
- **本计划不重新讨论的设计结论**：
  - usage 不得伪装成 live push（来源：charter §7.6）
  - files 不得伪装成完整下载/预览资产系统（来源：charter §4.2 O4 / §7.6）

### 0.1 开工前必须继承的项目上下文

1. `clients/web/docs/charter/web-v10-foundations.md`
2. `clients/api-docs/README.md`
3. `clients/api-docs/session.md`
4. `clients/api-docs/session-ws-v1.md`
5. `clients/api-docs/usage.md`
6. `clients/api-docs/permissions.md`
7. `clients/api-docs/catalog.md`
8. `clients/api-docs/worker-health.md`
9. F4 已完成的 chat/runtime 主链

### 0.2 F5 接口参照入口

| F5 子目标 | 直接参考文档 | 执行注意点 |
|---|---|---|
| inspector 的 status / timeline / history / files | `clients/api-docs/session.md` | `/files` 当前仍不在 README 的已实现基线里，不能直接假设它可用 |
| usage 面板 | `clients/api-docs/usage.md` | 只有 snapshot，数值字段仍可能是 placeholder |
| permission / devices / settings 辅助面 | `clients/api-docs/permissions.md` + `clients/api-docs/README.md` | `POST /me/devices/revoke` 当前 README 仍列为尚未实现，F5 只能按 conditional capability 处理 |
| catalog 页面 | `clients/api-docs/catalog.md` | contract 稳定，但内容可能为空 |
| health 页面 | `clients/api-docs/worker-health.md` | 这是 debug JSON，不是 facade envelope |

### 0.3 F5 的 truth-framing 纪律

1. `GET /sessions/{id}/files` 若仍未在 API docs 与 façade 现实中收敛，只能做“占位 / not available” truth label，不能伪装成已交付能力。
2. `POST /me/devices/revoke` 若仍未实现，只允许保留设置页结构或 explanatory placeholder，不允许编造交互闭环。
3. `api-contract.md` 必须显式指向 `clients/api-docs`，而不是另写一套脱离项目上下文的平行接口真相。

---

## 1. 执行综述

### 1.1 总体执行方式

执行方式采用 **“先补 ChatPage inspector，再补辅助页面，再补运行/部署文档，最后做基础硬化与 truth labeling”**。F5 的核心是把 foundation 补齐，不是扩 scope。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Inspector Tabs | `M` | 建立 status / timeline / history / usage / files 面板 | `-` |
| Phase 2 | Secondary Surfaces | `M` | 建立 Catalog / Health / Settings(Device) 辅助页面 | `Phase 1` |
| Phase 3 | Delivery Docs | `S` | 编写 setup / deployment / api-contract 文档 | `Phase 2` |
| Phase 4 | Hardening And Truth Labels | `S` | build/preview 基础硬化与 partial capability 说明 | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — Inspector Tabs**
   - **核心目标**：让聊天页具备 inspection 面。
   - **为什么先做**：这是 F5 与 F4 直接相连的部分。
2. **Phase 2 — Secondary Surfaces**
   - **核心目标**：建立非聊天主线的辅助页面。
   - **为什么放在这里**：它建立在 inspector 和基础 APIs 已可用上。
3. **Phase 3 — Delivery Docs**
   - **核心目标**：让本地运行、部署与 API contract 有正式文档。
   - **为什么放在这里**：只有前 2 个阶段稳定，文档才不会写成空壳。
4. **Phase 4 — Hardening And Truth Labels**
   - **核心目标**：完成基础 build/preview 硬化与 truth framing。
   - **为什么放在最后**：它是 F5 的统一收口。

### 1.4 执行策略说明

- **执行顺序原则**：`先 inspector，再 secondary surfaces，再 docs，最后 hardening`
- **风险控制原则**：`不把 snapshot 能力包装成 live capability`
- **测试推进原则**：`以 build、preview、关键页面手动 smoke 为主`
- **文档同步原则**：`setup/deployment/api-contract 只在 F5 正式落文`
- **回滚 / 降级原则**：`若 inspector 或 docs 不完整，不宣称 foundations 可交付`

### 1.5 本次 action-plan 影响结构图

```text
web-v10 / F5 inspector-and-delivery-hardening
├── Phase 1: Inspector Tabs
│   ├── status / timeline / history
│   ├── usage
│   └── files
├── Phase 2: Secondary Surfaces
│   ├── CatalogPage
│   ├── HealthPage
│   └── SettingsPage (devices)
├── Phase 3: Delivery Docs
│   ├── setup.md
│   ├── deployment.md
│   └── api-contract.md
└── Phase 4: Hardening And Truth Labels
    └── build / preview / UX truth framing
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** status / usage / files / timeline / history inspector
- **[S2]** Catalog / Health / Settings(Device) 页面
- **[S3]** `setup.md` / `deployment.md` / `api-contract.md`
- **[S4]** build / preview / 文档 / truth labeling 基础硬化

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** usage live push 伪装
- **[O2]** 完整文件上传/下载/预览系统
- **[O3]** 多租户 admin / billing / credits 面
- **[O4]** richer mobile UX / 完整组件测试平台

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| usage tab 以 snapshot 展示 | `in-scope` | 与当前真实能力一致 | 若后端 live push 真正稳定再升级 |
| files tab 以 metadata list 展示 | `in-scope` | charter 已冻结此口径 | 若后端文件链路完整后重评 |
| device revoke UI | `defer / depends-on-contract` | README 当前仍把 `POST /me/devices/revoke` 视为未实现；只有 contract 收敛后才能升级为真实功能 | API docs 与 façade 代码同日收敛 |
| 完整 multimodality UI | `out-of-scope` | 超出 foundation 范围 | 后续 phase |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | build inspector tabs | `add` | `components/inspector/*` `ChatPage` | 建立聊天页 inspection 面 | `medium` |
| P2-01 | Phase 2 | wire catalog/health/devices pages | `update` | `pages/{CatalogPage,HealthPage,SettingsPage}.tsx` | 建辅助页面真实内容，并对未实现能力保持 truth labeling | `medium` |
| P3-01 | Phase 3 | write delivery docs | `add` | `docs/{setup,deployment,api-contract}.md` `clients/api-docs/*.md` | 形成可运行可交接文档，并把 Web docs 明确挂回 client API docs | `medium` |
| P4-01 | Phase 4 | harden build and preview posture | `update` | `package.json` `pages/*` | 让 Web 具备可交付姿势 | `medium` |
| P4-02 | Phase 4 | add truth labels for partial capabilities | `update` | `components/*` `docs/*` | 不制造错误能力认知 | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Inspector Tabs

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | build inspector tabs | 把 status/usage/files/timeline/history 组织为右侧 inspector tabs | `components/inspector/*` `ChatPage` | 聊天页具备最小 inspection 能力 | `preview manual check` | 右侧面板可切换并展示真实内容 |

### 4.2 Phase 2 — Secondary Surfaces

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | wire catalog/health/devices pages | 接入 catalog、worker health 与 settings 辅助页面；`me/devices`/revoke 仅在 contract 收敛时升级为真实能力，否则保持 truth-labeled placeholder | `pages/{CatalogPage,HealthPage,SettingsPage}.tsx` `src/apis/*` | Web 不再只有聊天页 | `manual route smoke` | 三类辅助页面有真实内容，未实现能力不会被伪装 |

### 4.3 Phase 3 — Delivery Docs

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | write delivery docs | 写本地运行、Pages 部署与 Web 客户端 API contract 文档；其中 `api-contract.md` 必须引用 `clients/api-docs` 作为 contract baseline，而不是再造平行真相 | `docs/{setup,deployment,api-contract}.md` `clients/api-docs/*.md` | 团队可以按文档运行与理解 Web | `doc review` | 文档覆盖运行、部署、接口三方面，且引用链清晰 |

### 4.4 Phase 4 — Hardening And Truth Labels

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | harden build and preview posture | 收紧 build/preview 环境与基础脚本行为 | `package.json` `pages/*` | Web 具备更稳定交付面 | `build + preview` | 本地/preview 姿势稳定 |
| P4-02 | add truth labels for partial capabilities | 在 UI 与 docs 中显式标记 snapshot / partial / future | `components/*` `docs/*` | 避免能力误判 | `manual UX/doc review` | 不出现过度承诺 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Inspector Tabs

- **Phase 目标**：建立聊天页右侧 inspection 面。
- **本 Phase 对应编号**：
  - `P1-01`
- **本 Phase 新增文件**：
  - `src/components/inspector/*`
- **本 Phase 修改文件**：
  - `src/pages/ChatPage.tsx`
- **具体功能预期**：
  1. ChatPage 可以查看 status/timeline/history/usage/files
  2. inspector 内容与 F4 的聊天主链共享会话上下文
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build`
  - **回归测试**：`切换 tab 与会话`
  - **手动验证**：`聊天过程中查看 inspector`
- **收口标准**：
  - 右侧 inspection 面成立
  - 数据内容与当前后端能力一致
- **本 Phase 风险提醒**：
  - 不要把 inspector 做成静态展示页

### 5.2 Phase 2 — Secondary Surfaces

- **Phase 目标**：补齐辅助页面。
- **本 Phase 对应编号**：
  - `P2-01`
- **本 Phase 新增文件**：
  - `src/pages/{CatalogPage,HealthPage,SettingsPage}.tsx`
- **本 Phase 修改文件**：
  - `src/apis/{catalog,debug,sessions}.ts`
- **具体功能预期**：
  1. catalog/health/devices 页面有真实数据
  2. Web 不再只有聊天主视图
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build`
  - **回归测试**：`辅助页面 route smoke`
  - **手动验证**：`进入 settings / catalog / health`
- **收口标准**：
  - 三类辅助页面可以浏览
  - revoke device 等基础操作可接入
- **本 Phase 风险提醒**：
  - 不要把未来 admin 面硬塞进 settings

### 5.3 Phase 3 — Delivery Docs

- **Phase 目标**：让 Web 具备正式运行与交接文档。
- **本 Phase 对应编号**：
  - `P3-01`
- **本 Phase 新增文件**：
  - `clients/web/docs/setup.md`
  - `clients/web/docs/deployment.md`
  - `clients/web/docs/api-contract.md`
- **本 Phase 修改文件**：
  - `无`
- **具体功能预期**：
  1. 团队能按文档本地启动和部署 preview
  2. Web 侧 API contract 有专属文档入口
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`文档 walkthrough`
  - **回归测试**：`按 setup/deployment 文档复盘`
  - **手动验证**：`文档可读性检查`
- **收口标准**：
  - 三类文档存在且有真实内容
  - 不再依赖口头说明运行 Web
- **本 Phase 风险提醒**：
  - 文档不能只是路径清单或空模板

### 5.4 Phase 4 — Hardening And Truth Labels

- **Phase 目标**：完成基础交付硬化并统一 truth framing。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `package.json`
  - `pages/*`
  - `components/*`
  - `docs/*`
- **具体功能预期**：
  1. build/preview 姿势稳定
  2. partial capability 都有明确标签或说明
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build + preview`
  - **回归测试**：`usage/files/permission 等口径检查`
  - **手动验证**：`UI 与文档 truth review`
- **收口标准**：
  - Web 已具备最低可交付性
  - 过度承诺被消除
- **本 Phase 风险提醒**：
  - 若省略 truth labels，前端会反向制造错误产品事实

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| I4: inspector / settings / catalog / health 是 F5 基本范围 | `web-v10-foundations.md` §4.1 | F5 不只是“补文档”，必须补辅助面 | 若改变，F5 目标会被削空 |
| O3/O4: usage/files 不能假装 fully live | `web-v10-foundations.md` §4.2 | F5 必须做 truth labeling | 若改变，需重新评估产品口径 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| inspector 做成假内容 | 只展示静态占位 | `medium` | 强制接真实 session 数据 |
| 文档空心化 | setup/deployment/api-contract 只有标题 | `medium` | 明确 Phase 3 为硬交付 |

### 7.2 约束与前提

- **技术前提**：`F4 聊天主链已完成`
- **运行时前提**：`status/usage/files/timeline/history/catalog/health/devices facade 可用`
- **组织协作前提**：`F6 基于 F5 的证据做 closure`
- **上线 / 合并前提**：`辅助页面与文档至少达到最小非空状态`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `clients/web/docs/charter/web-v10-foundations.md`（若 F5 范围调整）
- 需要同步更新的说明文档 / README：
  - `clients/web/docs/{setup,deployment,api-contract}.md`
- 需要同步更新的测试说明：
  - `如后续引入 smoke 说明，则一并补充`

### 7.4 完成后的预期状态

1. ChatPage 已具备 inspector 面。
2. Catalog / Health / Settings 页面有真实内容。
3. setup / deployment / api-contract 已形成正式交付文档。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `clients/web build`
  - `辅助页面与 inspector 文件结构检查`
- **单元测试**：
  - `不适用`
- **集成测试**：
  - `ChatPage + inspector + secondary pages smoke`
- **端到端 / 手动验证**：
  - `对话中查看 inspector；进入 settings/catalog/health；按文档启动和部署`
- **回归测试**：
  - `usage/files capability truth review`
- **文档校验**：
  - `setup/deployment/api-contract 是否具备真实内容与正确范围`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. ChatPage 已有最小 inspection 能力。
2. 辅助页面已具备真实内容。
3. setup/deployment/api-contract 文档已成文。
4. UI 与文档不再过度承诺 partial capability。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `inspector 与辅助页面已形成最小非空面` |
| 测试 | `build + 关键页面手动 smoke 可走通` |
| 文档 | `setup/deployment/api-contract 已可阅读和使用` |
| 风险收敛 | `usage/files 等 partial capability 口径已被收紧` |
| 可交付性 | `F6 可基于 F5 证据正式做 closure` |

---

## 9. 执行日志回填（仅 `executed` 状态使用）

| 编号 | 工作项 | 状态 | 证据 |
|------|--------|------|------|
| P1-01 | build inspector tabs | ✅ | `src/components/inspector/InspectorTabs.tsx` 已实现 status/timeline/history/usage 四标签，数据接真实 API |
| P2-01 | wire catalog/health/devices pages | ✅ | `CatalogPage.tsx`（skills/commands/agents）、`HealthPage.tsx`（worker health 表格）、`SettingsPage.tsx`（truth labels）已实现 |
| P3-01 | write delivery docs | ✅ | `clients/web/docs/setup.md` + `deployment.md` + `api-contract.md` 已创建，api-contract 明确引用 `clients/api-docs` |
| P4-01 | harden build and preview posture | ✅ | `pnpm build` + `pnpm preview` 可稳定运行；`vite.config.ts` 配置正确 |
| P4-02 | add truth labels for partial capabilities | ✅ | `SettingsPage` 明确列出 5 项已知限制；`InspectorTabs` usage 标注 snapshot；`CatalogPage` 标注可能为空 |

**F5 收口判定**: `full close` — inspector 与辅助页面已形成最小非空面，交付文档已成文，truth labeling 已落实。
