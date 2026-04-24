# F3 — Canonical Cutover and Legacy Retirement

> 服务业务簇: `orchestration-facade / F3 / canonical-cutover-and-legacy-retirement`
> 计划对象: `把 canonical public ingress 切到 orchestrator-core，并退役 agent-core legacy session surface`
> 类型: `migration`
> 作者: `GPT-5.4`
> 时间: `2026-04-24`
> 文件位置: `docs/action-plan/orchestration-facade/F3-canonical-cutover-and-legacy-retirement.md`
> 关联设计 / 调研文档:
> - `docs/plan-orchestration-facade.md`
> - `docs/action-plan/orchestration-facade/F2-session-seam-completion.md`
> - `docs/design/orchestration-facade/F0-compatibility-facade-contract.md`
> - `docs/design/orchestration-facade/F0-live-e2e-migration-inventory.md`
> - `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md`
> - `docs/design/orchestration-facade/FX-qna.md`
> - `test/INDEX.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

F3 是 orchestration-facade 最容易被低估的周期，因为它看起来像“改 URL + 改几份测试”。实际上，它承担的是三件同时发生的重动作：

1. **切 canonical ingress owner**
2. **迁受影响的 live suites / harness / docs**
3. **在同一个周期里退役 legacy `agent-core /sessions/*` public surface**

只有 F3 完成，`orchestrator.core` 才从“新 façade 已可用”变成“唯一默认 public ingress”。否则项目依旧停留在 dual-ingress tech debt 里。

- **服务业务簇**：`orchestration-facade / F3`
- **计划对象**：`Canonical Cutover and Legacy Retirement`
- **本次计划解决的问题**：
  - `affected live tests / harness / docs 仍以 agent-core 为默认 public owner`
  - `legacy session routes 尚未进入 typed deprecation`
  - `canonical public truth 还没有通过测试树结构与文档结构被表达出来`
- **本次计划的直接产出**：
  - `test/package-e2e/orchestrator-core/` canonical public suite
  - `test/shared/live.mjs` 与 `test/INDEX.md` 的 orchestrator truth
  - `agent-core` legacy HTTP `410` / WS `426` hard deprecation + `F3-closure.md`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先建 orchestrator canonical live suite、再迁 affected tests / docs / harness、最后同 PR 翻转 legacy deprecation** 的方式推进。F3 不能拆成“先加 deprecation header，再以后看情况 hard fail”的两段式；本周期的价值正是一次性消除 dual-ingress。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | canonical public suite 建立 | `M` | 建立 `orchestrator-core` package-e2e 目录与 live harness | `F2 closed` |
| Phase 2 | package-e2e 迁移 | `L` | 迁 agent-core session-facing tests 到 orchestrator-core | `Phase 1` |
| Phase 3 | cross-e2e / docs / harness 迁移 | `L` | 迁 affected cross-e2e、`live.mjs`、`test/INDEX.md` | `Phase 2` |
| Phase 4 | legacy hard deprecation | `M` | 同 PR 翻转 `agent-core /sessions/*` 到 HTTP `410` / WS `426` | `Phase 3` |
| Phase 5 | F3 closure | `S` | 产出 cutover / retirement evidence | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — canonical public suite 建立**
   - **核心目标**：让测试树先表达“public owner 已经是 orchestrator-core”
   - **为什么先做**：没有新目录，后续迁移都会变成原地改 URL 的模糊动作
2. **Phase 2 — package-e2e 迁移**
   - **核心目标**：迁 `agent-core/02-06` 到新的 orchestrator suite
   - **为什么放在这里**：先迁 package-e2e，能最直接表达 public owner 切换
3. **Phase 3 — cross-e2e / docs / harness 迁移**
   - **核心目标**：把 cross-e2e 入口、`live.mjs`、`INDEX.md` 同步切走
   - **为什么放在这里**：这些是 cutover 的第二层真相，不应先于 suite 目录切换
4. **Phase 4 — legacy hard deprecation**
   - **核心目标**：让 old public session surface 在同一个 PR 中失效
   - **为什么放在这里**：只有当 canonical path 及其 tests/docs 已 ready，legacy 才能被 honest retire
5. **Phase 5 — F3 closure**
   - **核心目标**：给后续 F4/F5 提供 cutover 已完成的明确证据
   - **为什么放在最后**：closure 必须建立在 tests/docs/runtime 都切完之后

### 1.4 执行策略说明

- **执行顺序原则**：`先建立新 owner 的测试树，再迁文档，再翻转旧入口`
- **风险控制原则**：`同一个 PR 完成 legacy session routes 的 hard deprecation，拒绝长 grace window`
- **测试推进原则**：`package-e2e 先迁，cross-e2e 再迁，最后补 legacy negative tests`
- **文档同步原则**：`suite、harness、INDEX、README 必须一起说同一套 canonical truth`

### 1.5 本次 action-plan 影响目录树

```text
F3 Canonical Cutover and Legacy Retirement
├── test/package-e2e/orchestrator-core/
│   ├── 01-preview-probe.test.mjs
│   ├── 02-session-start.test.mjs
│   ├── 03-ws-attach.test.mjs
│   ├── 04-reconnect.test.mjs
│   ├── 05-verify-status-timeline.test.mjs
│   ├── 06-auth-negative.test.mjs
│   └── 07-legacy-410-assertion.test.mjs
├── test/cross-e2e/*
├── test/shared/live.mjs
├── test/INDEX.md
├── workers/agent-core/src/index.ts
├── workers/agent-core/src/host/routes.ts
└── docs/issue/orchestration-facade/F3-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 新建并填充 `test/package-e2e/orchestrator-core/` canonical public suite
- **[S2]** 迁移 affected package-e2e / cross-e2e / `live.mjs` / `test/INDEX.md`
- **[S3]** 在 `agent-core` 上对 legacy HTTP session routes 返回 typed `410`、对 legacy WS 返回 typed `426`
- **[S4]** 产出 cutover closure evidence 与 legacy negative tests

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 重造产品级 public API
- **[O2]** 删除 `GET /` / `GET /health` probe
- **[O3]** 迁移 `bash-core` / `context-core` / `filesystem-core` 的 internal posture suites
- **[O4]** 引入完整 WS-only live suite beyond first-wave needs

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `agent-core/01-preview-probe` | `in-scope but keep` | probe 仍属于 agent-core 自身 posture | `未来若 worker topology 再改` |
| cross-e2e 目录结构 | `in-scope but keep location` | cross tests 天然跨 worker，不必改目录，只改入口 owner | `不适用` |
| post-F3 grace window | `out-of-scope` | FX-qna 已明确拒绝 | `未来若 owner 正式重开` |
| legacy WS 继续 upgrade | `out-of-scope` | D1 已冻结为 HTTP `426` typed rejection | `不适用` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | orchestrator package-e2e 目录建立 | `add` | `test/package-e2e/orchestrator-core/*` | 测试树先表达 canonical owner | `medium` |
| P1-02 | Phase 1 | live harness 新 env | `update` | `test/shared/live.mjs` | 为 orchestrator public URL 提供 SSOT | `medium` |
| P2-01 | Phase 2 | migrate agent-core session tests | `remove/update/add` | `agent-core/02-06*` + `orchestrator-core/*` | package-e2e public suite 迁移完成 | `high` |
| P2-02 | Phase 2 | auth-negative / legacy-negative cases | `add` | `orchestrator-core/06-07*` | canonical suite 具备必要负例 | `medium` |
| P3-01 | Phase 3 | cross-e2e 入口迁移 | `update` | `test/cross-e2e/02,03,04,05,06,08,09` | cross tests 入口 owner 切到 orchestrator | `high` |
| P3-02 | Phase 3 | test docs truth 更新 | `update` | `test/INDEX.md` README / preview docs | 文档不再说 agent-core 是默认 public edge | `medium` |
| P4-01 | Phase 4 | legacy HTTP `410` | `update` | `workers/agent-core/*` | old session HTTP paths honest retire | `high` |
| P4-02 | Phase 4 | legacy WS `426` | `update` | `workers/agent-core/*` | old WS path 不再升级 | `high` |
| P5-01 | Phase 5 | cutover closure | `add` | `docs/issue/orchestration-facade/F3-closure.md` | F3 完整闭合 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — canonical public suite 建立

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | orchestrator package-e2e 目录建立 | 建立 01-07 七个 canonical public test slots | `test/package-e2e/orchestrator-core/*` | suite 结构先于迁移存在 | 文档/文件 review | 目录结构完整 |
| P1-02 | live harness 新 env | 引入 `NANO_AGENT_ORCHESTRATOR_CORE_URL` 与 default preview URL | `test/shared/live.mjs` | public live target 有 SSOT | harness tests | new env 可被读取 |

### 4.2 Phase 2 — package-e2e 迁移

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | migrate agent-core session tests | 把 `02/04/05/06` 迁到 orchestrator-core，`03` 合并进 `02-session-start` | `test/package-e2e/*` | session-facing package-e2e 全部归属 orchestrator-core | package-e2e | old ghost files 删除 |
| P2-02 | auth-negative / legacy-negative | 新增 `06-auth-negative` 与 `07-legacy-410-assertion` | `test/package-e2e/orchestrator-core/*` | canonical suite 具备安全与退役证明 | package-e2e | 负例可断言 |

### 4.3 Phase 3 — cross-e2e / docs / harness 迁移

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | cross-e2e 入口迁移 | 迁 `02,03,04,05,06,08,09` 的 default public owner 到 orchestrator | `test/cross-e2e/*` | cross suite 反映 canonical owner | cross-e2e | affected files 全改 |
| P3-02 | docs truth 更新 | 更新 `test/INDEX.md`、相关 README/preview truth | `test/INDEX.md` docs | 文档与测试树说同一套真相 | 文档 review | 不再把 agent-core 当默认 public edge |

### 4.4 Phase 4 — legacy hard deprecation

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | legacy HTTP `410` | 让 `agent-core /sessions/:id/{start,input,cancel,status,timeline,verify}` 返回 typed `410` + canonical hint | `workers/agent-core/*` | old HTTP surface honest retire | negative tests | all legacy HTTP asserts updated |
| P4-02 | legacy WS `426` | 让 `/sessions/:id/ws` 返回 typed `426` + canonical hint，不再升级 | `workers/agent-core/*` | old WS surface honest retire | negative tests | no WS upgrade on legacy path |

### 4.5 Phase 5 — F3 closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | cutover closure | 写清 canonical cutover、affected suite migration、legacy retirement 证据 | `docs/issue/orchestration-facade/F3-closure.md` | F3 可被后续 phase 审计 | 文档 review | closure 直接可引用 |

---

## 5. Phase 详情

### 5.1 Phase 1 — canonical public suite 建立

- **Phase 目标**：让测试树先承认 orchestrator-core 是 canonical public owner
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `test/package-e2e/orchestrator-core/01-preview-probe.test.mjs`
  - `test/package-e2e/orchestrator-core/02-session-start.test.mjs`
  - `test/package-e2e/orchestrator-core/03-ws-attach.test.mjs`
  - `test/package-e2e/orchestrator-core/04-reconnect.test.mjs`
  - `test/package-e2e/orchestrator-core/05-verify-status-timeline.test.mjs`
  - `test/package-e2e/orchestrator-core/06-auth-negative.test.mjs`
  - `test/package-e2e/orchestrator-core/07-legacy-410-assertion.test.mjs`
- **本 Phase 修改文件**：
  - `test/shared/live.mjs`
- **具体功能预期**：
  1. 目录结构本身就说出 canonical public owner
  2. harness 可以统一拿到 orchestrator preview URL
  3. 后续迁移有明确落点
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`live harness smoke`
  - **手动验证**：`目录与 env 接线检查`
- **收口标准**：
  - 新目录存在
  - 新 env 存在
  - suite slots 已预留齐
- **本 Phase 风险提醒**：
  - 最容易为了省事继续在 `agent-core/` 目录里原地改 URL

### 5.2 Phase 2 — package-e2e 迁移

- **Phase 目标**：完成最直接、最清晰的 canonical owner 切换
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `orchestrator-core/06-auth-negative.test.mjs`
  - `orchestrator-core/07-legacy-410-assertion.test.mjs`
- **本 Phase 修改文件**：
  - `test/package-e2e/agent-core/02-06*.mjs`
  - `test/package-e2e/orchestrator-core/*.mjs`
- **具体功能预期**：
  1. session-facing package-e2e 全部归 orchestrator-core
  2. `03-initial-context-smoke` 与 `02-session-start` 合并，避免 ghost duplication
  3. old agent-core session-facing files 被删除，不留歧义
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`new suite package-e2e`
  - **回归测试**：`affected package-e2e`
  - **手动验证**：`old/new 文件职责核对`
- **收口标准**：
  - old package-e2e 无 session-facing public owner 幻象
  - new package-e2e 能稳定运行
- **本 Phase 风险提醒**：
  - 最容易留下双份近似测试，制造 future drift

### 5.3 Phase 3 — cross-e2e / docs / harness 迁移

- **Phase 目标**：让跨 worker 测试与文档一起说同一套 canonical truth
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `test/cross-e2e/02,03,04,05,06,08,09*.mjs`
  - `test/INDEX.md`
  - `相关 README / preview truth`
- **具体功能预期**：
  1. affected cross-e2e 入口 URL 全切到 orchestrator
  2. `test/INDEX.md` 反映 v0.3 canonical owner truth
  3. docs/harness/tests 不再互相打架
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`cross-e2e`
  - **回归测试**：`affected cross suite`
  - **手动验证**：`INDEX 与实际路径核对`
- **收口标准**：
  - 7 个 affected cross-e2e 完成迁移
  - INDEX/harness 与 suite 目录结构一致
- **本 Phase 风险提醒**：
  - 最容易只改测试，不改文档

### 5.4 Phase 4 — legacy hard deprecation

- **Phase 目标**：在同一个周期里 honest retire old public surface
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `workers/agent-core/src/index.ts`
  - `workers/agent-core/src/host/routes.ts`
  - `workers/agent-core/src/host/http-controller.ts`
  - `workers/agent-core/src/host/ws-controller.ts`
- **具体功能预期**：
  1. legacy HTTP session routes 返回 typed `410`
  2. legacy WS 返回 typed `426`
  3. `GET /` / `GET /health` probe 不受影响
- **具体测试安排**：
  - **单测**：`legacy route rejection tests`
  - **集成测试**：`negative assertion`
  - **回归测试**：`agent-core tests + orchestrator 07 legacy test`
  - **手动验证**：`legacy URL smoke`
- **收口标准**：
  - legacy session routes 不再成功执行
  - probe 继续可用
- **本 Phase 风险提醒**：
  - 最容易被“再留一点 grace”诱惑重新拖回 dual-ingress

### 5.5 Phase 5 — F3 closure

- **Phase 目标**：形成可审计的 cutover 证据
- **本 Phase 对应编号**：
  - `P5-01`
- **本 Phase 新增文件**：
  - `docs/issue/orchestration-facade/F3-closure.md`
- **本 Phase 修改文件**：
  - `无`
- **具体功能预期**：
  1. closure 记录 affected suites 已迁、docs 已改、legacy 已退役
  2. 为 F4/F5 提供 clear proof
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无新增`
  - **回归测试**：`closure 对照 test inventory`
  - **手动验证**：`closure vs inventory 逐项核对`
- **收口标准**：
  - F3 退出条件三件套齐备：closure + orchestrator live E2E 绿 + legacy negative tests 绿
- **本 Phase 风险提醒**：
  - 最容易写出“理论切流完成”，但未附负例证据

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 当前结论

本阶段 **无新增 owner-level blocker**。  
Q7/Q8 已在 `FX-qna.md` 明确：**无 grace window、同 PR hard deprecate、canonical suite 属于 orchestrator-core**。

### 6.2 问题整理建议

- `canonical_public` 的具体 preview/prod URL 组装位置可在实现中决定
- 若 future 需要更厚的 deprecation disclosure header，可在后续阶段增加，但不影响 F3 hard deprecation

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| suite / harness / docs 三方不同步 | cutover 很容易只改其中一层 | `high` | Phase 3 要求三者一起迁 |
| 旧入口退役不彻底 | 容易留下一个仍能 200 的 legacy path | `high` | Phase 4 统一 negative tests |
| cutover 被误拆成两次 PR | 会重新引入灰色地带 | `medium` | 严格执行同 PR 翻转纪律 |

### 7.2 约束与前提

- **技术前提**：`F2 已闭合，orchestrator-core 已具备完整 first-wave session seam`
- **运行时前提**：`orchestrator-core preview URL 已稳定`
- **组织协作前提**：`不把 F3 写成渐进兼容工程，而是一次 honest cutover`
- **上线 / 合并前提**：`orchestrator live suite 与 legacy negative tests 必须同时为绿`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/orchestration-facade/F0-compatibility-facade-contract.md`
  - `docs/design/orchestration-facade/F0-live-e2e-migration-inventory.md`
- 需要同步更新的说明文档 / README：
  - `test/INDEX.md`
- 需要同步更新的测试说明：
  - `test/shared/live.mjs`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `orchestrator-core suite 已成为 canonical public suite`
  - `legacy session routes 已不再成功执行`
- **单元测试**：
  - `legacy rejection shape tests`
- **集成测试**：
  - `package-e2e + cross-e2e affected suite`
- **端到端 / 手动验证**：
  - `legacy URL smoke + canonical URL smoke`
- **回归测试**：
  - `affected package-e2e/cross-e2e + relevant worker tests`
- **文档校验**：
  - `INDEX / harness / suite tree / closure 一致`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `test/package-e2e/orchestrator-core/` 已成为 canonical public suite
2. affected cross-e2e 的 default public owner 已切到 orchestrator-core
3. `test/shared/live.mjs` 与 `test/INDEX.md` 已同步为 orchestrator truth
4. `agent-core` legacy HTTP session routes 返回 typed `410`，legacy WS 返回 typed `426`
5. `F3-closure.md` 已明确 cutover 完成且无 grace window

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `canonical public ingress 已从 agent-core 切到 orchestrator-core` |
| 测试 | `affected live suites 与 legacy negative paths 都为绿` |
| 文档 | `suite tree / harness / INDEX / closure 完全同步` |
| 风险收敛 | `dual-ingress tech debt 被 honest retire` |
| 可交付性 | `F4/F5 可在单一 canonical ingress 事实上继续推进` |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`Phase 3 可能比预期更大，因为 docs/harness 更新面容易被低估`
- **哪些编号的拆分还不够合理**：`若 package-e2e 与 cross-e2e 迁移互相耦得太紧，可再细拆`
- **哪些问题本应更早问架构师**：`若 cutover 期间又有人要求 grace window，说明 QNA 沟通不够充分`
- **哪些测试安排在实际执行中证明不够**：`若 legacy negative tests 只断言 status code，应补 body shape`
- **模板本身还需要补什么字段**：`future 可增加 “same-PR retirement discipline” 专门项`

---

## 10. 结语

这份 action-plan 以 **让 `orchestrator.core` 成为唯一真实 public ingress** 为第一优先级，采用 **先建 canonical suite、再迁测试与文档、最后同 PR 退役 legacy** 的推进方式，优先解决 **dual-ingress tech debt** 与 **测试树/文档仍说旧真相** 两个问题，并把 **不留 grace window、不拆两次 PR** 作为主要约束。整个计划完成后，`orchestration-facade / F3` 应达到 **canonical cutover 已完成、legacy session surface 已 honest retire** 的状态，从而为后续的 **F4 authority hardening 与 F5 final closure** 提供清晰基础。
