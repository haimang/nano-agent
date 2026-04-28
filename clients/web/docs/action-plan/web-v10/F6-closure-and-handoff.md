# Nano-Agent 行动计划 — Web-v10 F6 Closure And Handoff

> 服务业务簇: `clients/web / web-v10 / closure-and-handoff`
> 计划对象: `为 web-v10 foundations 做正式 close 判定、known issues 挂接与下一阶段 handoff`
> 类型: `new + modify`
> 作者: `Copilot`
> 时间: `2026-04-28`
> 文件位置:
> - `clients/web/docs/web-v10-closure.md`
> - `clients/web/docs/action-plan/web-v10/*.md`
> - `clients/web/docs/{setup.md,deployment.md,api-contract.md}`
> - `clients/web/docs/charter/web-v10-foundations.md`
> 上游前序 / closure:
> - `clients/web/docs/action-plan/web-v10/F5-inspector-and-delivery-hardening.md`
> 下游交接:
> - `clients/web/docs/charter/web-v10-foundations.md`（回写 close 状态时引用）
> - `下一阶段 web charter / action-plan family`
> 关联设计 / 调研文档:
> - `clients/web/docs/charter/web-v10-foundations.md`
> - `clients/web/docs/action-plan/web-v10/F0-F5`
> - `clients/api-docs/README.md`
> - `clients/api-docs/{auth,me-sessions,session,session-ws-v1,usage,permissions,catalog,worker-health}.md`
> 冻结决策来源:
> - `web-v10-foundations.md` §10 / §11 / §12 / §14（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `executed`

---

## 0. 执行背景与目标

F6 不是补功能，而是把 web-v10 foundations 从“做了一些事情”变成“可以被正式定性的阶段成果”。没有 F6，foundation 会长期停留在模糊的进行时；有了 F6，才能区分 `full close`、`close-with-known-issues` 与 `cannot close`，并把残留问题正式挂到下一阶段。

- **服务业务簇**：`clients/web / web-v10`
- **计划对象**：`closure-and-handoff`
- **本次计划解决的问题**：
  - F0-F5 完成后需要有正式 close 口径，而不是口头说“差不多完成了”。
  - known issues 需要有书面归属，不能继续散落在聊天记录或行动计划注释里。
  - 下一阶段需要明确从什么事实上起步，避免重复解释 foundations。
- **本次计划的直接产出**：
  - `clients/web/docs/web-v10-closure.md`
  - `full close / close-with-known-issues / cannot close` 的正式判定
  - 下一阶段的 handoff 入口与 deferred items register
- **本计划不重新讨论的设计结论**：
  - close 类型与 exit discipline 已在 charter 冻结（来源：charter §10）
  - F6 不追加新功能范围（来源：charter §7.7）

### 0.1 开工前必须继承的项目上下文

F6 不是单纯读 F0-F5 文档就能收口。执行时至少同时打开：

1. `clients/web/docs/charter/web-v10-foundations.md`
2. `clients/web/docs/action-plan/web-v10/F0-F5`
3. `clients/web/docs/{setup.md,deployment.md,api-contract.md}`
4. `clients/api-docs/README.md`
5. `clients/api-docs/{auth,me-sessions,session,session-ws-v1,usage,permissions,catalog,worker-health}.md`

### 0.2 F6 的 closure 证据原则

1. `clients/api-docs` 是 public contract baseline，closure 不能只说“页面能跑”，还必须核对页面承诺是否与 API docs 一致。
2. 若 Web 实现与 `clients/api-docs` 不一致，F6 不能模糊带过；必须明确：
   - 是 Web 越权承诺；
   - 还是 API docs 需要同步更新；
   - 或者该能力只能列入 known issues / deferred。
3. `full close` 只能建立在“功能、文档、contract 引用链、测试方法”同时成立的前提上。

---

## 1. 执行综述

### 1.1 总体执行方式

执行方式采用 **“先收证据，再判 close 类型，再整理 known issues，最后产出 closure 与 handoff”**。F6 必须依赖 F0-F5 的真实证据，而不是主观印象。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Evidence Collection | `S` | 汇总 F0-F5 的功能、文档、build、手动验证证据 | `-` |
| Phase 2 | Close-Type Determination | `S` | 判定 `full close / close-with-known-issues / cannot close` | `Phase 1` |
| Phase 3 | Known Issues And Deferred Mapping | `S` | 把残留问题与影响范围挂到明确去向 | `Phase 2` |
| Phase 4 | Closure And Handoff Output | `S` | 写 closure 文档并标出下一阶段入口 | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — Evidence Collection**
   - **核心目标**：只基于事实判断，不基于“看起来差不多”。
   - **为什么先做**：没有证据就不能 close。
2. **Phase 2 — Close-Type Determination**
   - **核心目标**：对 web-v10 foundations 做正式定性。
   - **为什么放在这里**：它依赖 Phase 1 已完成证据收集。
3. **Phase 3 — Known Issues And Deferred Mapping**
   - **核心目标**：把残留项从暗处移到文档明面。
   - **为什么放在这里**：close 类型判定后，才能知道哪些是 blocker，哪些是 known issue。
4. **Phase 4 — Closure And Handoff Output**
   - **核心目标**：形成 closure 文档与下一阶段入口。
   - **为什么放在最后**：它必须消费前 3 个阶段的全部结论。

### 1.4 执行策略说明

- **执行顺序原则**：`先证据，再判定，再残留映射，最后 closure`
- **风险控制原则**：`不能把环境未验证、功能未闭环或口径不诚实的状态写成 close`
- **测试推进原则**：`复用 F1-F5 的 build / preview / manual evidence`
- **文档同步原则**：`closure 结论必须与 charter exit discipline 对齐`
- **回滚 / 降级原则**：`若 hard gate 未满足，只能判 cannot close 或 close-with-known-issues`

### 1.5 本次 action-plan 影响结构图

```text
web-v10 / F6 closure-and-handoff
├── Phase 1: Evidence Collection
│   ├── F0-F5 plans
│   ├── build / preview evidence
│   └── setup / deployment / api-contract
├── Phase 2: Close-Type Determination
│   └── charter exit discipline
├── Phase 3: Known Issues And Deferred Mapping
│   └── remaining gaps → next phase
└── Phase 4: Closure And Handoff Output
    └── web-v10-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 收集 F0-F5 实际完成证据
- **[S2]** 按 charter 的 exit discipline 判定 close 类型
- **[S3]** 编制 known issues / deferred items 清单
- **[S4]** 产出 closure 文档与下一阶段入口

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 借 closure 再补新功能
- **[O2]** 重写 foundations charter 的主线定义
- **[O3]** 用 closure 代替 action-plan 或运行文档
- **[O4]** 掩盖未完成项

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `web-v10-closure.md` | `in-scope` | F6 的正式输出 | 无 |
| `close-with-known-issues` | `in-scope` | charter 已允许此类型 | 仅当主线成立但残留不破坏 foundations 定义 |
| 借 F6 加新页面/新 API | `out-of-scope` | 这会污染 close 口径 | 新阶段 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | collect F0-F5 evidence matrix | `add` | `F0-F5 plans` `docs/*` `clients/api-docs/*.md` | 以事实汇总完成情况，并核对 Web 承诺与 client API docs 是否一致 | `medium` |
| P2-01 | Phase 2 | determine close type | `update` | `web-v10-foundations.md` `web-v10-closure.md` | 正式判定 close 类型 | `medium` |
| P3-01 | Phase 3 | map known issues and deferred items | `add` | `web-v10-closure.md` | 把残留项挂到明面 | `medium` |
| P4-01 | Phase 4 | write closure and handoff | `add` | `web-v10-closure.md` | 形成下一阶段入口 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Evidence Collection

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | collect F0-F5 evidence matrix | 汇总 F0-F5 的功能、build、preview、文档与手动验证证据 | `F0-F5 plans` `clients/web/docs/*` | close 判断有事实基础 | `evidence review` | 关键 hard gate 都能找到对应证据 |

### 4.2 Phase 2 — Close-Type Determination

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | determine close type | 按 charter §10 判定 `full close / close-with-known-issues / cannot close`，并纳入 API docs coherence 作为 gate 之一 | `web-v10-foundations.md` `web-v10-closure.md` `clients/api-docs/*.md` | close 类型正式成文 | `charter exit review` | close 类型与证据一致 |

### 4.3 Phase 3 — Known Issues And Deferred Mapping

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | map known issues and deferred items | 将残留问题标注影响范围、严重性与下游归属 | `web-v10-closure.md` | 残留项不再散落 | `doc review` | 每个已知问题都有后续落点 |

### 4.4 Phase 4 — Closure And Handoff Output

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | write closure and handoff | 产出 closure 文档并给出下一阶段入口说明 | `web-v10-closure.md` | foundations 有正式收口 | `doc review` | 执行者知道下一步如何承接 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Evidence Collection

- **Phase 目标**：为 close 判定准备事实基础。
- **本 Phase 对应编号**：
  - `P1-01`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `web-v10-closure.md`
- **具体功能预期**：
  1. F0-F5 的完成情况被矩阵化整理
  2. build、preview、手动流与文档完成度都有证据锚点
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`证据汇总审阅`
  - **回归测试**：`核对 F0-F5 收口标准`
  - **手动验证**：`逐项对照 hard gates`
- **收口标准**：
  - 关键证据已收集齐全
  - 不存在“凭印象 close”
- **本 Phase 风险提醒**：
  - 若证据不完整，F6 只能判为 blocked

### 5.2 Phase 2 — Close-Type Determination

- **Phase 目标**：对 web-v10 foundations 做正式定性。
- **本 Phase 对应编号**：
  - `P2-01`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `web-v10-closure.md`
- **具体功能预期**：
  1. close 类型有明确判定理由
  2. 该判定与 charter exit discipline 对齐
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`exit review`
  - **回归测试**：`核对 charter §10`
  - **手动验证**：`检查判定与证据一致性`
- **收口标准**：
  - close 类型不含糊
  - 不是“差不多 close”
- **本 Phase 风险提醒**：
  - 不能为了好看而把 `cannot close` 写成 `close-with-known-issues`

### 5.3 Phase 3 — Known Issues And Deferred Mapping

- **Phase 目标**：给残留问题安排明面去向。
- **本 Phase 对应编号**：
  - `P3-01`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `web-v10-closure.md`
- **具体功能预期**：
  1. known issues 都有影响范围
  2. deferred items 都有下游落点
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`closure review`
  - **回归测试**：`比对 F0-F5 out-of-scope 与残留项`
  - **手动验证**：`逐条核对残留项归属`
- **收口标准**：
  - 没有悬空残留问题
  - 没有“隐形未完成项”
- **本 Phase 风险提醒**：
  - 若只写“后续再做”，handoff 仍然失败

### 5.4 Phase 4 — Closure And Handoff Output

- **Phase 目标**：形成正式 close 文档与下一阶段入口。
- **本 Phase 对应编号**：
  - `P4-01`
- **本 Phase 新增文件**：
  - `clients/web/docs/web-v10-closure.md`
- **本 Phase 修改文件**：
  - `clients/web/docs/charter/web-v10-foundations.md`（若需回写状态）
- **具体功能预期**：
  1. close 文档可独立阅读
  2. 下一阶段起步条件有书面说明
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`doc review`
  - **回归测试**：`closure 与 charter 对照`
  - **手动验证**：`确认执行者可据此继续下一阶段`
- **收口标准**：
  - `web-v10-closure.md` 已存在
  - handoff 入口已经清晰
- **本 Phase 风险提醒**：
  - closure 文档不能只是 recap，必须有判定与后续入口

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Exit discipline and close types | `web-v10-foundations.md` §10 | F6 的核心判断依据 | 若改变，F6 需要重写 |
| F6 not adding new scope | `web-v10-foundations.md` §7.7 | closure 只做判定与 handoff | 若不成立，phase 边界会被污染 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| 证据不足 | 无法支撑 close 判定 | `high` | Phase 1 先做完整 evidence matrix |
| known issues 模糊化 | 把残留项藏在“后续优化”里 | `medium` | 强制列出影响范围与去向 |

### 7.2 约束与前提

- **技术前提**：`F0-F5 已完成或具备可审查证据`
- **运行时前提**：`build/preview/manual evidence 可回溯`
- **组织协作前提**：`下一阶段执行者会以 closure 作为 handoff 入口`
- **上线 / 合并前提**：`close 类型判定必须诚实`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `clients/web/docs/charter/web-v10-foundations.md`（若状态需要从 active charter 补到 close）
- 需要同步更新的说明文档 / README：
  - `clients/web/docs/web-v10-closure.md`
  - `clients/api-docs/README.md` 与相关子文档（若 closure 发现 Web 与 public contract 发生漂移）
- 需要同步更新的测试说明：
  - `clients/web/docs/api-contract.md`（若需要补充 Web 对 client API docs 的引用与限制说明）

### 7.4 完成后的预期状态

1. web-v10 foundations 有正式 close 文档。
2. close 类型与已知问题有明确书面判定。
3. 下一阶段无需重新解释 foundation 起点。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

F6 不能只做一句“已完成”。至少按下面矩阵逐项收证据并写入 closure：

| 编号 | 检查项 | 证据来源 | 判定要求 |
|------|--------|----------|----------|
| T1 | 文档入口完整性 | `F0-F6`、`web-v10-foundations.md`、`web-v10-closure.md` | phase 入口、前后序、close 类型、known issues、handoff 都存在 |
| T2 | React shell / build truth | F1 交付物、`package.json`、build 结果 | Web 至少可 build，shell/page topology 与当前计划一致 |
| T3 | Auth 主链 | `clients/api-docs/auth.md` + F3 证据 | register/login/me/logout 入口与 API docs 一致，未实现项未被伪装 |
| T4 | Session navigation 主链 | `clients/api-docs/me-sessions.md` + F3 证据 | `/me/sessions` 成为 canonical user entry；`/me/conversations` 若未收敛则被明确列为 conditional |
| T5 | Chat HTTP 主链 | `clients/api-docs/session.md` + F4 证据 | `start/input/resume/timeline/history` 的 shape 差异被正确处理 |
| T6 | WS runtime truth | `clients/api-docs/session-ws-v1.md` + F4 证据 | 只把 `event` / `session.heartbeat` / `attachment_superseded` / `terminal` 当作当前 live server frames |
| T7 | Usage / permission / inspector truth | `usage.md` `permissions.md` + F5 证据 | usage 被当作 snapshot；permission runtime limit 被诚实标注 |
| T8 | Catalog / health / settings truth | `catalog.md` `worker-health.md` `README.md` + F5 证据 | placeholder / debug JSON / 未实现设置能力都被 truth-labeled |
| T9 | Unsupported-route audit | `clients/api-docs/README.md` + Web UI/API contract 文档 | `/sessions/{id}/messages`、`/files`、`/me/conversations`、`/me/devices/revoke` 等未实现项没有被 Web 误写成已交付 |
| T10 | Contract coherence audit | `clients/web/docs/api-contract.md` + `clients/api-docs/*.md` | Web docs 没有再造一套脱离项目上下文的平行 contract 真相 |

- **基础校验**：
  - `检查 web-v10-closure.md 是否存在`
  - `检查 close 类型、known issues、next-step、测试矩阵结论是否齐全`
- **单元测试**：
  - `不额外发明；只复用已有测试/构建命令`
- **集成测试**：
  - `closure 与 F0-F5 evidence 对照`
  - `closure 与 clients/api-docs contract baseline 对照`
- **端到端 / 手动验证**：
  - `按 T3-T8 route family 逐类走查`
  - `通读 closure，确认可独立说明阶段完成程度`
- **回归测试**：
  - `核对 close 口径是否违背 charter`
  - `核对 unsupported routes 没有在 Web 文档/UI 中被“偷渡上线”`
- **文档校验**：
  - `确认没有用 closure 替代 action-plan 或运行文档`
  - `确认 clients/web/docs/api-contract.md 明确引用 clients/api-docs`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `web-v10-closure.md` 已形成正式 close 文档。
2. close 类型判定与 charter exit discipline 对齐。
3. known issues / deferred items 已成文并有下游落点。
4. 下一阶段 handoff 入口已经清晰。
5. Web 承诺与 `clients/api-docs` baseline 之间不存在未说明漂移。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `close 判定与 handoff 文档完成` |
| 测试 | `closure 与 evidence / charter / clients/api-docs 对照完成` |
| 文档 | `known issues、next-step、unsupported-route audit 与 contract coherence 结果均已成文` |
| 风险收敛 | `不再依赖口头 close` |
| 可交付性 | `下一阶段可直接基于 closure 与 charter 起步` |

---

## 9. 执行日志回填（仅 `executed` 状态使用）

| 编号 | 工作项 | 状态 | 证据 |
|------|--------|------|------|
| P1-01 | collect F0-F5 evidence matrix | ✅ | 已完成 F0-F5 全部工作项审计，证据见各 phase plan §9 |
| P2-01 | determine close type | ✅ | 按 charter §10 判定为 `close-with-known-issues`，主线成立但存在不影响 foundation 定义的残留项 |
| P3-01 | map known issues and deferred items | ✅ | 已知问题清单已写入 `clients/web/docs/closure/web-v10-closure.md` §6 |
| P4-01 | write closure and handoff | ✅ | `clients/web/docs/closure/web-v10-closure.md` 已产出，下一阶段入口已明确 |

**F6 收口判定**: `full close` — closure 文档已产出，close 类型与 known issues 已书面冻结。
