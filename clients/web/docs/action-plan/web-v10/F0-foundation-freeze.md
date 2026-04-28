# Nano-Agent 行动计划 — Web-v10 F0 Foundation Freeze

> 服务业务簇: `clients/web / web-v10 / foundation-freeze`
> 计划对象: `把 web-v10 foundations charter 落成可执行的文档基线、路径基线与交接基线`
> 类型: `new + modify`
> 作者: `Copilot`
> 时间: `2026-04-28`
> 文件位置:
> - `clients/web/docs/charter/web-v10-foundations.md`
> - `clients/web/docs/action-plan/web-v10/`
> - `clients/web/docs/{setup.md,deployment.md,api-contract.md}`
> - `clients/web/docs/web-v10-closure.md`
> 上游前序 / closure:
> - `clients/web/docs/charter/web-v10-foundations.md`
> 下游交接:
> - `clients/web/docs/action-plan/web-v10/F1-react-shell-reset.md`
> - `clients/web/docs/action-plan/web-v10/F2-bff-and-transport-split.md`
> - `clients/web/docs/action-plan/web-v10/F6-closure-and-handoff.md`
> 关联设计 / 调研文档:
> - `clients/web/docs/charter/web-v10-foundations.md`
> - `clients/api-docs/README.md`
> - `clients/api-docs/README.md`
> 冻结决策来源:
> - `clients/web/docs/charter/web-v10-foundations.md` §1 / §3 / §4 / §6（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `executed`

---

## 0. 执行背景与目标

F0 不是代码实现 phase，而是把 foundations charter 真正变成后续可执行的起跑线。当前 `clients/web/docs/charter/web-v10-foundations.md` 已冻结了 why-now、边界、Phase 职责与 exit discipline，但若不继续落成 action-plan 家族、路径规范与交接口径，后续执行者仍会把它当成"宏观方向"而不是"实际入口"。

- **服务业务簇**：`clients/web / web-v10`
- **计划对象**：`foundation-freeze`
- **本次计划解决的问题**：
  - foundation charter 与 action-plan 路径需要完全对齐，不能保留旧的单文件 `web-v10-action-plan.md` 口径。
  - 后续 F1-F6 若没有正式入口与职责切分，执行会重新回到"边做边解释"。
  - 运行文档、closure 文档、phase 文档之间需要形成固定拓扑，而不是散落在 `clients/web/docs/` 根层。
- **本次计划的直接产出**：
  - `clients/web/docs/action-plan/web-v10/` 目录及 F0-F6 七份 plan ✅
  - charter 中所有 action-plan 引用改为目录化口径 ✅
  - F1-F6 的交接关系、证据要求与 closure 入口冻结 ✅
- **本计划不重新讨论的设计结论**：
  - `Cloudflare Pages + Vite + React + TypeScript` 是 frozen foundation stack（来源：charter §1.1 D2）
  - HTTP 走 same-origin BFF、WS first-wave 可 direct connect 是 frozen posture（来源：charter §1.3 / §4.3）

### 0.1 开工前必须同时打开的上下文包

F0 的职责之一，就是把后续 F1-F6 的执行上下文冻结成统一入口。执行任一后续 phase 时，至少同时打开：

1. `clients/web/docs/charter/web-v10-foundations.md`
2. `clients/api-docs/README.md`
3. `clients/web/src/main.ts` / `clients/web/src/client.ts` / `clients/web/package.json`
4. 当前 phase 自己的 action-plan

### 0.2 API / contract 参照总原则

1. `clients/api-docs/README.md` 是 **client-facing public contract baseline**：base URL、transport profile、success-shape split、未实现接口列表都先看它。
2. 各 phase 再按接口族打开对应子文档：`auth.md`、`me-sessions.md`、`session.md`、`session-ws-v1.md`、`usage.md`、`permissions.md`、`catalog.md`、`worker-health.md`。
3. 若 `clients/api-docs` 与 façade 代码存在漂移，执行时不能静默假设哪边一定正确；必须把“reality audit + 同步文档修订或降级为 conditional feature”写入该 phase 的交付物。
4. F0 之后的每个 phase 都必须显式写出“开工时应同时参考哪些 API docs”。

---

## 1. 执行综述

### 1.1 总体执行方式

整体采取 **“先校正文档拓扑，再冻结 phase 交接，再建立证据清单”** 的执行方式。F0 不引入业务功能，而是把 web-v10 的计划体系从单个 charter 扩展成可执行的文档家族。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Charter Input Audit | `XS` | 审计 foundations charter 的路径、术语、交接对象与遗留旧口径 | `-` |
| Phase 2 | Plan Family Topology Freeze | `S` | 建立 `action-plan/web-v10/F0-F6` 目录化真相 | `Phase 1` |
| Phase 3 | Evidence And Closure Freeze | `XS` | 冻结运行文档、closure 与 phase handoff 的证据要求 | `Phase 2` |

### 1.3 Phase 说明

1. **Phase 1 — Charter Input Audit**
   - **核心目标**：先找出所有仍引用旧单文件 action-plan 的位置。
   - **为什么先做**：如果路径真相没统一，后续 plan 家族本身就会变成漂移源。
2. **Phase 2 — Plan Family Topology Freeze**
   - **核心目标**：建立 F0-F6 每个 phase 的独立 plan 入口。
   - **为什么放在这里**：phase 文档不存在，实施职责就无法稳定交接。
3. **Phase 3 — Evidence And Closure Freeze**
   - **核心目标**：把 setup / deployment / api-contract / closure 的角色冻结。
   - **为什么放在最后**：它依赖前两步已经明确 phase family 与路径口径。

### 1.4 执行策略说明

- **执行顺序原则**：`先统一路径真相，再建 phase 文档，再冻结 closure/handoff 口径`
- **风险控制原则**：`任何旧的 web-v10-action-plan.md 口径都必须清零，不允许并存`
- **测试推进原则**：`以文档引用检查、目录检查、执行链路自洽检查为主`
- **文档同步原则**：`charter / action-plan / closure / 运行文档 / clients/api-docs 必须互相可引用`
- **回滚 / 降级原则**：`若 phase family 尚未完整，不宣称 foundations 已具备执行入口`

### 1.5 本次 action-plan 影响结构图

```text
web-v10 / F0 foundation-freeze
├── Phase 1: Charter Input Audit
│   ├── web-v10-foundations.md
│   └── 旧 action-plan 引用清理
├── Phase 2: Plan Family Topology Freeze
│   ├── action-plan/web-v10/F0-F6
│   └── phase 路径与命名收口
└── Phase 3: Evidence And Closure Freeze
    ├── setup.md / deployment.md / api-contract.md
    └── web-v10-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 统一 web-v10 文档路径与命名口径
- **[S2]** 创建 F0-F6 独立 action-plan 文档
- **[S3]** 冻结 phase handoff 与 closure 入口
- **[S4]** 冻结后续运行文档的职责边界
- **[S5]** 冻结后续 F1-F6 的统一 API 参照入口与 drift 处理原则

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** React / BFF / 页面层任何具体代码实现
- **[O2]** 接口字段级 contract 编写
- **[O3]** Pages 部署配置落地
- **[O4]** 关闭 web-v10 foundations 本身

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `clients/web/docs/action-plan/web-v10/F0-F6` | `in-scope` | 这是 foundations 的正式执行入口 | 无 |
| `clients/web/docs/web-v10-action-plan.md` 单文件旧口径 | `out-of-scope` | 必须被目录化方案替代 | 无 |
| `setup.md / deployment.md / api-contract.md` 的最终内容 | `defer / depends-on-design` | F0 只冻结职责，不写内容细节 | F5 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | audit charter references | `update` | `clients/web/docs/charter/web-v10-foundations.md` | 清理旧 action-plan 引用 | `low` |
| P2-01 | Phase 2 | create phase plan family | `add` | `clients/web/docs/action-plan/web-v10/*.md` | 建立 F0-F6 计划入口 | `medium` |
| P2-02 | Phase 2 | freeze naming and successor chain | `add` | `clients/web/docs/action-plan/web-v10/*.md` | 让每个 phase 都有前序和后续 | `medium` |
| P3-01 | Phase 3 | freeze evidence docs role | `update` | `clients/web/docs/{setup.md,deployment.md,api-contract.md}` `clients/api-docs/*.md` | 明确这些文档由哪个 phase 产出，并与 client API docs 建立引用关系 | `low` |
| P3-02 | Phase 3 | freeze closure entry | `update` | `clients/web/docs/web-v10-closure.md` | 为 F6 提供正式收口入口 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Charter Input Audit

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | audit charter references | 审计并改写 charter 中所有旧的单文件 action-plan 引用、下游产物引用与建议撰写顺序 | `clients/web/docs/charter/web-v10-foundations.md` | charter 与目录化计划口径一致 | doc link check | 不再出现 `web-v10-action-plan.md` 单文件表述 |

### 4.2 Phase 2 — Plan Family Topology Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | create phase plan family | 创建 `F0-F6` 七份 plan 文件并填充 action-plan 结构 | `clients/web/docs/action-plan/web-v10/*.md` | 每个 foundations phase 都有对应执行文档 | directory review | 七份文档齐全且结构完整 |
| P2-02 | freeze naming and successor chain | 给每个 phase plan 冻结文件名、阶段名、前序 / 后续交接对象 | `clients/web/docs/action-plan/web-v10/*.md` | 执行者不会再自己猜 phase 顺序 | doc review | 每份文档都具备 predecessor / successor |

### 4.3 Phase 3 — Evidence And Closure Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | freeze evidence docs role | 明确 `setup/deployment/api-contract` 在 F5 才是正式交付物；同时冻结 `clients/api-docs/README.md + 子文档` 是后续各 phase 的接口参照入口 | `clients/web/docs/action-plan/web-v10/*.md` `clients/api-docs/*.md` | 运行文档职责不再漂移，接口参考入口单一 | doc review | F5 之外的文档不越权承诺，F1-F6 都知道去哪里找接口 |
| P3-02 | freeze closure entry | 明确 `web-v10-closure.md` 由 F6 负责，而不是任何中间 phase 临时替代 | `clients/web/docs/action-plan/web-v10/F6-closure-and-handoff.md` | close 入口单一 | doc review | closure 口径固定 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Charter Input Audit

- **Phase 目标**：把 foundations charter 与目录化 action-plan 家族完全对齐。
- **本 Phase 对应编号**：
  - `P1-01`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `clients/web/docs/charter/web-v10-foundations.md`
- **具体功能预期**：
  1. charter 顶部下游产物改为 `action-plan/web-v10/F0-F6`
  2. charter 中的执行建议不再引用单文件 plan
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`不适用`
  - **回归测试**：`文档引用检查`
  - **手动验证**：`通读 charter 的下游产物、撰写顺序与维护约定`
- **收口标准**：
  - 不再存在旧单文件 plan 口径
  - charter 与 F0-F6 目录化方案一致
- **本 Phase 风险提醒**：
  - 若旧引用残留，后续 F1-F6 文档会被视为“额外产物”而非 canonical plan

### 5.2 Phase 2 — Plan Family Topology Freeze

- **Phase 目标**：建立 web-v10 的 phase 计划家族。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `clients/web/docs/action-plan/web-v10/F0-foundation-freeze.md`
  - `clients/web/docs/action-plan/web-v10/F1-react-shell-reset.md`
  - `clients/web/docs/action-plan/web-v10/F2-bff-and-transport-split.md`
  - `clients/web/docs/action-plan/web-v10/F3-auth-and-session-navigation.md`
  - `clients/web/docs/action-plan/web-v10/F4-chat-mainline-and-stream.md`
  - `clients/web/docs/action-plan/web-v10/F5-inspector-and-delivery-hardening.md`
  - `clients/web/docs/action-plan/web-v10/F6-closure-and-handoff.md`
- **具体功能预期**：
  1. 每个宏观 phase 都有单独 plan 文件
  2. 每个 plan 都写清前序、后续、范围、测试与收口
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`不适用`
  - **回归测试**：`目录结构与文件名检查`
  - **手动验证**：`抽查每个 plan 是否可独立阅读`
- **收口标准**：
  - 七份 plan 都存在
  - phase 命名、职责与 charter 一一对应
- **本 Phase 风险提醒**：
  - 如果只是占位文件，没有完整 plan 结构，F0 仍然未完成

### 5.3 Phase 3 — Evidence And Closure Freeze

- **Phase 目标**：给运行文档与 closure 文档建立角色边界。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `clients/web/docs/action-plan/web-v10/F5-inspector-and-delivery-hardening.md`
  - `clients/web/docs/action-plan/web-v10/F6-closure-and-handoff.md`
- **具体功能预期**：
  1. `setup/deployment/api-contract` 被明确绑定到 F5
  2. `web-v10-closure.md` 被明确绑定到 F6
  3. `clients/api-docs/README.md + 子文档` 被明确绑定为 F1-F6 的 contract reference set
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`不适用`
  - **回归测试**：`文档职责自洽检查`
  - **手动验证**：`阅读 F5/F6 plan`
- **收口标准**：
  - 运行文档职责不再前移或漂移
  - closure 入口不再模糊
- **本 Phase 风险提醒**：
  - 若职责不冻结，F5 与 F6 会互相覆盖

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| D2: `Cloudflare Pages + Vite + React + TypeScript` | `web-v10-foundations.md` §1.1 | F0 需要围绕该 stack 建 plan 家族 | 若改变，整套 F1-F5 计划都需重写 |
| H1: `action-plan 必须细化实施任务，charter 不写细节` | `web-v10-foundations.md` §0.3 | F0 必须建出 F1-F6 而不是继续留在单 charter | 若不成立，F0 不再有存在意义 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| 文档路径漂移 | charter 与 action-plan 家族引用不一致 | `medium` | 全量改写旧口径 |
| phase 文件空心化 | 只建文件名，不写可执行内容 | `medium` | 每份 plan 填满模板关键章节 |

### 7.2 约束与前提

- **技术前提**：`F0 不实现前端代码，只处理文档拓扑与执行入口`
- **运行时前提**：`无`
- **组织协作前提**：`后续执行者以 F1-F6 为唯一 phase 实施入口`
- **上线 / 合并前提**：`charter 与 plan family 路径一致`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `clients/web/docs/charter/web-v10-foundations.md`
- 需要同步更新的说明文档 / README：
  - `clients/api-docs/README.md`（作为后续 phase 的统一 contract entry）
- 需要同步更新的测试说明：
  - `无`

### 7.4 完成后的预期状态

1. web-v10 不再只有一份宏观 charter，而拥有完整的 phase plan family。
2. 后续执行者可以直接进入 F1-F6，而不需要重新解释 foundations。
3. closure、运行文档与 phase handoff 的边界已经冻结。
4. 后续执行者知道所有接口都应先从 `clients/api-docs` 找入口，而不是到处猜。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `检查 clients/web/docs/action-plan/web-v10/ 下是否存在 F0-F6 七份文档`
  - `检查 charter 是否已改为目录化 action-plan 引用`
- **单元测试**：
  - `不适用`
- **集成测试**：
  - `不适用`
- **端到端 / 手动验证**：
  - `逐份通读 F0-F6，确认 predecessor / successor / in-scope / closure 均完整`
- **回归测试**：
  - `确认没有新的单文件 action-plan 口径被引入`
- **文档校验**：
  - `核对 F5/F6 是否明确接运行文档与 closure 责任`
  - `核对 F1-F6 是否都写明了 clients/api-docs 的参照入口`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `clients/web/docs/action-plan/web-v10/` 已成为 canonical plan 入口。
2. `web-v10-foundations.md` 与 plan 家族互相对齐。
3. 运行文档与 closure 的责任边界已经明确。
4. 不再存在旧单文件 `web-v10-action-plan.md` 口径。
5. F1-F6 都已拿到统一的 client API docs 参照入口。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `F0-F6 七份计划文档存在且内容完整` |
| 测试 | `文档路径、引用与职责自洽` |
| 文档 | `charter、plan family 与 clients/api-docs 引用链完全对齐` |
| 风险收敛 | `旧路径真相与新路径真相不再并存` |
| 可交付性 | `后续执行者可以直接从 F1-F6 开始实施` |

---

## 9. 执行日志回填（仅 `executed` 状态使用）

| 编号 | 工作项 | 状态 | 证据 |
|------|--------|------|------|
| P1-01 | audit charter references | ✅ | charter §12.1 / §0 已使用目录化 action-plan 引用，无旧单文件 plan 口径残留 |
| P2-01 | create phase plan family | ✅ | F0-F6 七份 plan 文件均存在于 `action-plan/web-v10/` |
| P2-02 | freeze naming and successor chain | ✅ | 每份 plan 均具备明确的 predecessor / successor 交接链 |
| P3-01 | freeze evidence docs role | ✅ | F5 已承接 `setup.md`/`deployment.md`/`api-contract.md`；F1-F6 均写明 `clients/api-docs` 参照入口 |
| P3-02 | freeze closure entry | ✅ | F6 已承接 `web-v10-closure.md` 作为正式收口入口 |

**F0 收口判定**: `full close` — 所有 P1-P3 工作项已完成，后续 F1-F6 可基于完整的 plan family 直接启动实施。
