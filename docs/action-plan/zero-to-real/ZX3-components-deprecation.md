# Nano-Agent 行动计划 — ZX3 Components Deprecation

> 服务业务簇: `zero-to-real / ZX3 / package-retirement + test-tree-cutover`
> 计划对象: `packages/ 退役节奏冻结 + canonical keep-set 收敛 + test-legacy/ cutover + 物理删除`
> 类型: `migration + refactor + remove`
> 作者: `GPT-5.4`
> 时间: `2026-04-27`
> 文件位置:
> - `packages/{agent-runtime-kernel,capability-runtime,llm-wrapper,context-management,hooks,session-do-runtime}/`
> - `packages/{workspace-context-artifacts,storage-topology,eval-observability,orchestrator-auth-contract}/`
> - `workers/{orchestrator-core,orchestrator-auth,agent-core,context-core,filesystem-core}/`
> - `test-legacy/`
> - `test/{shared,root-guardians,package-e2e,cross-e2e}/`
> - `package.json`
> - `pnpm-workspace.yaml`
> - `clients/api-docs/`
> 关联设计 / 调研文档:
> - `docs/eval/zero-to-real/legacy-test-and-package-deprecation.md`
> - `docs/action-plan/worker-matrix/PX-new-tests.md`
> - `docs/issue/worker-matrix/worker-matrix-final-closure.md`
> - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

ZX3 的前提已经很清楚：当前仓库虽然完成了 6-workers 主体吸收，但 `packages/` 与 `test-legacy/` 仍处于 **“逻辑上已退役、物理上仍共存”** 的中间态。调查已经证明，当前不能把“删 package”理解成“除 NACP 外全部清空”，也不能把“新 test/ 已建立”理解成“test-legacy 已无价值”。仍有一部分 package 是 load-bearing bridge/helper；仍有一部分 root guardians、fixture 与脚本依赖 `test-legacy/`。

因此，ZX3 的任务不是做一次粗暴清仓，而是把“历史共存”收敛成一个**可解释、可验证、可回滚**的退役序列：先冻结 canonical keep-set 与删除名单，再删除已完全 absorbed 的 duplicate packages，再迁最后的 bridge/test-only consumers，最后把 `test-legacy/` 中仍有价值的 guardians 与 fixtures 迁入新的 canonical `test/` 树，并完成物理删除。

- **服务业务簇**：`zero-to-real / ZX3`
- **计划对象**：`组件退役与测试树 cutover`
- **本次计划解决的问题**：
  - `packages/` 中的 `DEPRECATED` 语义仍然混杂：有的是可删 duplicate，有的是仍有 consumer 的 bridge/helper
  - `test-legacy/` 仍被 root scripts、共享 fixtures、B7/live-loop/initial-context guardians 与文档治理口径依赖
  - 当前缺少一份正式的执行节奏，指导“先删什么、后迁什么、什么必须保留、何时才允许物理删除”
- **本次计划的直接产出**：
  - `packages/` 的 canonical keep-set 与 phased deletion manifest
  - 新 `test/` 树中的 `shared/` + `root-guardians/` 承接结构与脚本切换顺序
  - `packages/` 与 `test-legacy/` 的最终物理删除门槛与 closure 标准

---

## 1. 执行综述

### 1.1 总体执行方式

整体策略采用 **“先冻结边界，再做低风险删除，随后迁最后 consumer，最后物理清理”**。ZX3 明确拆成两条主线并行设计、串行落地：一条是 `packages/` 退役主线，另一条是 `test-legacy/` cutover 主线。两条主线共享同一原则：**逻辑退役不等于物理删除；只有在 consumer 清零、脚本切换完成、文档口径同步之后，才允许执行最后删除。**

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Retirement Manifest + Keep-Set Freeze | `S` | 冻结 package keep-set / deletion set / migration set；冻结 `test-legacy` 文件分类与新 `test/` 目标结构 | `-` |
| Phase 2 | Pure Duplicate Package Removal | `M` | 删除已经完全 absorbed、无 live consumer 的 duplicate packages，并清理 workspace/docs/test 残留 | `Phase 1` |
| Phase 3 | Bridge / Test-Only Consumer Migration | `L` | 迁移 `workspace-context-artifacts`、`storage-topology`、`eval-observability` 的剩余 consumer；保留 `orchestrator-auth-contract` 作为 keep-set | `Phase 2` |
| Phase 4 | Root Guardians + Fixture Cutover | `L` | 新建 `test/root-guardians/` 与 `test/shared/fixtures/`，迁移 `test-legacy` 仍有价值的 guardians 与共享 seam fixtures，切换 root scripts | `Phase 3` |
| Phase 5 | Physical Cleanup + Closure | `M` | 删除剩余 `test-legacy/` 与已完成迁移的废弃 package，更新 docs/closure/handoff，冻结最终 posture | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — Retirement Manifest + Keep-Set Freeze**
   - **核心目标**：先把“什么要保留、什么可删除、什么需先迁移”一次性讲清楚。
   - **为什么先做**：没有 manifest，执行者会把 README 上的 `DEPRECATED` 误解成“可立刻删”。
2. **Phase 2 — Pure Duplicate Package Removal**
   - **核心目标**：优先删除最明确、风险最低的 duplicate packages。
   - **为什么放在这里**：这一步不应被 bridge/test-only consumer 的复杂迁移阻塞。
3. **Phase 3 — Bridge / Test-Only Consumer Migration**
   - **核心目标**：清零仍然挡住最终收敛的 runtime/test consumers。
   - **为什么放在这里**：只有在 duplicate 先清理之后，bridge migration 的边界才足够清晰。
4. **Phase 4 — Root Guardians + Fixture Cutover**
   - **核心目标**：把 `test-legacy/` 的剩余真实价值迁入新 canonical `test/` 树。
   - **为什么放在这里**：此时 packages 主线已基本稳定，测试树迁移不会再被运行时结构频繁打断。
5. **Phase 5 — Physical Cleanup + Closure**
   - **核心目标**：完成物理删除、脚本收口、文档口径收口与最终 posture 冻结。
   - **为什么放在最后**：只有 consumer 清零和脚本切换完成，物理删除才安全。

### 1.4 执行策略说明

- **执行顺序原则**：`先冻结 keep-set / delete-set / migration-set，再删 duplicate，再迁 consumer，最后删 test-legacy`
- **风险控制原则**：`任何 package 删除前必须证明 runtime consumer = 0；任何 test-legacy 删除前必须证明 script import + fixture import + guardian import = 0`
- **测试推进原则**：`每次 package 删除都跑 owning worker tests；每次测试树迁移都同时跑 root contracts / package-e2e / cross-e2e`
- **文档同步原则**：`README、action-plan、closure、api-docs、test/INDEX.md 必须同步改口，不允许代码已删但文档仍以 legacy truth 自居`

### 1.5 本次 action-plan 影响目录树

```text
ZX3-components-deprecation
├── Phase 1: Retirement Manifest + Keep-Set Freeze
│   ├── docs/action-plan/zero-to-real/ZX3-components-deprecation.md
│   ├── docs/eval/zero-to-real/legacy-test-and-package-deprecation.md
│   └── package / test classification manifests
├── Phase 2: Pure Duplicate Package Removal
│   ├── packages/agent-runtime-kernel/
│   ├── packages/capability-runtime/
│   ├── packages/llm-wrapper/
│   ├── packages/context-management/
│   ├── packages/hooks/
│   └── packages/session-do-runtime/
├── Phase 3: Bridge / Test-Only Consumer Migration
│   ├── packages/workspace-context-artifacts/
│   ├── packages/storage-topology/
│   ├── packages/eval-observability/
│   ├── packages/orchestrator-auth-contract/   [keep-set，非删除目标]
│   ├── workers/agent-core/
│   ├── workers/context-core/
│   ├── workers/filesystem-core/
│   └── workers/{orchestrator-core,orchestrator-auth}/
├── Phase 4: Root Guardians + Fixture Cutover
│   ├── test-legacy/
│   ├── test/shared/fixtures/external-seams/
│   ├── test/root-guardians/
│   └── package.json
└── Phase 5: Physical Cleanup + Closure
    ├── pnpm-workspace.yaml
    ├── docs/action-plan/**
    ├── docs/issue/**
    ├── test/INDEX.md
    └── docs/handoff/**
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 冻结 `packages/` 的 canonical keep-set、duplicate deletion set、bridge migration set、test-only migration set
- **[S2]** 删除已经 absorbed 且无 live consumer 的 duplicate packages
- **[S3]** 迁移 `workspace-context-artifacts` / `storage-topology` / `eval-observability` 的剩余 consumer
- **[S4]** 将 `test-legacy/` 中仍有价值的 fixtures / guardians / scripts 切换到新 `test/` 树

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 把 remaining helper/contract 一并吸收到 `nacp-core` 或 `nacp-session`
- **[O2]** 在 ZX3 内新增与本次退役无关的 façade 新功能（例如 ZX2 已推迟的 product-heavy endpoints）
- **[O3]** 重写 worker-matrix 历史文档本身的全部叙事，只做必要同步
- **[O4]** 把 `orchestrator-auth-contract` 从 keep-set 强行改造成另一种契约架构

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `orchestrator-auth-contract` | `in-scope` | 需要在 ZX3 冻结为 keep-set，而不是被误删 | `Phase 1` |
| `workspace-context-artifacts` / `storage-topology` consumer migration | `in-scope` | 当前仍是最终收口 blocker | `Phase 3` |
| `test/root-guardians/` 新层 | `in-scope` | 没有新落脚点就无法安全删除 `test-legacy/` | `Phase 4` |
| NACP 协议层扩张 | `out-of-scope` | ZX2 已明确不把 helper/contract 都吸入 NACP | `若后续单独立项` |
| product-heavy façade 能力 | `out-of-scope` | 与本 action-plan 的退役主线无直接关系 | `ZX3 之后的产品计划` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | package posture manifest | `add` | `docs/action-plan/zero-to-real/ZX3-components-deprecation.md` | 冻结 keep-set / delete-set / migration-set | `medium` |
| P1-02 | Phase 1 | test-legacy inventory manifest | `add` | `test-legacy/**` `test/**` `package.json` | 冻结 guardian / fixture / archive / retire 分类 | `medium` |
| P2-01 | Phase 2 | delete absorbed duplicate packages | `remove` | `packages/{agent-runtime-kernel,capability-runtime,llm-wrapper,context-management,hooks,session-do-runtime}/` | 先清掉最明确的物理 duplicate | `medium` |
| P2-02 | Phase 2 | workspace/docs cleanup | `update` | `pnpm-workspace.yaml` `README` `docs/**` | 删除 duplicate package 后收紧 workspace 与文档引用 | `low` |
| P3-01 | Phase 3 | migrate workspace-context-artifacts consumers | `refactor` | `workers/agent-core/` `workers/context-core/` `workers/filesystem-core/` | 让 runtime 不再跨 package 使用 artifact helper | `high` |
| P3-02 | Phase 3 | migrate storage-topology consumers | `refactor` | `workers/context-core/` `workers/filesystem-core/` | 让 storage semantics 回到 canonical worker export 面 | `high` |
| P3-03 | Phase 3 | migrate eval-observability test helpers | `refactor` | `workers/agent-core/test/` `test/shared/` | 清零 test-only package blocker | `medium` |
| P3-04 | Phase 3 | freeze orchestrator-auth-contract posture | `update` | `packages/orchestrator-auth-contract/` `workers/{orchestrator-core,orchestrator-auth}/` | 明确它是 keep-set，不进入删除序列 | `low` |
| P4-01 | Phase 4 | move external seam fixtures | `refactor` | `test-legacy/fixtures/external-seams/` `test/shared/fixtures/external-seams/` | 切断 active tests 对 legacy fixture 路径的依赖 | `medium` |
| P4-02 | Phase 4 | create root-guardians tree | `add` | `test/root-guardians/` | 为 B7 / live-loop / doc-sync / protocol guards 建立 canonical 新落脚点 | `medium` |
| P4-03 | Phase 4 | switch root scripts | `update` | `package.json` | 把 `test:contracts` 从 `test-legacy` 切到新树 | `medium` |
| P5-01 | Phase 5 | remove remaining legacy tree | `remove` | `test-legacy/` | 在 guardians/fixtures/scripts 清零后物理删除 | `high` |
| P5-02 | Phase 5 | final docs and closure sync | `update` | `test/INDEX.md` `docs/action-plan/**` `docs/issue/**` | 让 repo 口径与新 posture 一致 | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Retirement Manifest + Keep-Set Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | package posture manifest | 把 package 明确分为 keep-set / duplicate deletion set / bridge migration set / test-only migration set，并锁定各自执行顺序 | `docs/action-plan/zero-to-real/ZX3-components-deprecation.md` `docs/eval/zero-to-real/legacy-test-and-package-deprecation.md` | 执行者不再把所有 `DEPRECATED` 看成同一类对象 | doc review | 所有 package 都能归入一类且没有语义冲突 |
| P1-02 | test-legacy inventory manifest | 把 `test-legacy/` 中的文件分成 guardian / fixture / archive-only / retire-now 四类，并定义新 `test/` 目标树 | `test-legacy/**` `test/**` `package.json` | 后续 cutover 有明确搬迁表，而不是边删边猜 | doc review | 每个 active 依赖点都在 manifest 中有目标位置 |

### 4.2 Phase 2 — Pure Duplicate Package Removal

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | delete absorbed duplicate packages | 按 manifest 删除 `agent-runtime-kernel`、`capability-runtime`、`llm-wrapper`、`context-management`、`hooks`、`session-do-runtime`，并处理它们的残留 tests/docs | `packages/{...}/` | 先完成低风险物理收缩 | owning tests + repo search | 被删 package 无 runtime/test/doc consumers |
| P2-02 | workspace/docs cleanup | 更新 `pnpm-workspace.yaml`、lockfile、README、action-plan、closure 文档中对已删 duplicate packages 的活跃表述 | `pnpm-workspace.yaml` `pnpm-lock.yaml` `docs/**` | 仓库结构与口径同步 | build/test + doc review | workspace 安装、构建、测试均不再需要已删 package |

### 4.3 Phase 3 — Bridge / Test-Only Consumer Migration

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | migrate workspace-context-artifacts consumers | 把 `agent-core` / `context-core` / `filesystem-core` 对 artifact helper 的使用迁到 worker export 面或 worker-local canonical module | `workers/agent-core/` `workers/context-core/` `workers/filesystem-core/` | `workspace-context-artifacts` 不再是 load-bearing runtime bridge | worker tests + cross-e2e | runtime import 清零 |
| P3-02 | migrate storage-topology consumers | 把 `context-core` 对 `storage-topology` 的直接依赖迁到 `filesystem-core` export 或 worker-local storage seam | `workers/context-core/` `workers/filesystem-core/` | `storage-topology` 不再作为共享运行包存在 | worker tests + dry-run | direct import 清零 |
| P3-03 | migrate eval-observability test helpers | 把仍在 package tests / worker tests 中使用的 helper 迁到 `workers/agent-core/test-support` 或 `test/shared/observability` | `workers/agent-core/test/` `test/shared/` | `eval-observability` 从 test blocker 变成可删对象 | worker tests + root contracts | test imports 清零 |
| P3-04 | freeze orchestrator-auth-contract posture | 明确 `orchestrator-auth-contract` 为 canonical façade/auth contract keep-set；只收紧 README / docs 口径，不进入删除列表 | `packages/orchestrator-auth-contract/` `workers/{orchestrator-core,orchestrator-auth}/` | 计划执行时不再误判它应被并入 NACP 或直接删除 | doc review | keep-set 定义与 ZX2 边界一致 |

### 4.4 Phase 4 — Root Guardians + Fixture Cutover

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | move external seam fixtures | 将 `test-legacy/fixtures/external-seams/*` 迁到 `test/shared/fixtures/external-seams/*` 并更新现行 import | `test-legacy/fixtures/` `test/shared/fixtures/` `workers/**/test` | active tests 不再依赖 legacy 路径 | owning tests | repo 中无 `test-legacy/fixtures` import |
| P4-02 | create root-guardians tree | 在 `test/` 下新增 `root-guardians/`，迁移仍有价值的 B7 / live-loop / initial-context / doc-sync / protocol guards | `test/root-guardians/` `test-legacy/*.test.mjs` | 新 test tree 获得 root contracts 的 canonical 落脚点 | root contracts + package-e2e + cross-e2e | `test:contracts` 可切到新树 |
| P4-03 | switch root scripts | 更新 `package.json` 中 `test:contracts` 与 `test:legacy:*` 脚本；收紧 `test-command-coverage` 等守卫 | `package.json` `test/root-guardians/**` `test-legacy/test-command-coverage.test.mjs` | legacy 路径不再是 canonical 运行入口 | root scripts | 所有 root scripts 指向新 tree 或被移除 |

### 4.5 Phase 5 — Physical Cleanup + Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | remove remaining legacy tree | 在 fixtures / guardians / scripts / docs 全部切换后删除 `test-legacy/`，同时删除 Phase 3 已清零 consumer 的 bridge/test-only packages | `test-legacy/` `packages/{workspace-context-artifacts,storage-topology,eval-observability}/` | 物理遗留树正式消失 | full regression | 无代码、脚本、文档再引用 legacy tree 或已删 package |
| P5-02 | final docs and closure sync | 更新 `test/INDEX.md`、相关 action-plan / closure / handoff 文档，冻结最终 posture 并记录 residual | `test/INDEX.md` `docs/**` | 仓库叙事与真实结构一致 | doc review | 没有文档继续把 legacy tree 视作 active truth |

---

## 5. Phase 详情

### 5.1 Phase 1 — Retirement Manifest + Keep-Set Freeze

- **Phase 目标**：把 ZX3 的边界冻结成可执行清单，而不是停留在调查结论
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `docs/action-plan/zero-to-real/ZX3-components-deprecation.md`
- **本 Phase 修改文件**：
  - `docs/eval/zero-to-real/legacy-test-and-package-deprecation.md`（如需回填索引）
- **具体功能预期**：
  1. 执行者知道哪些 package 立即删、哪些先迁、哪些保留。
  2. 执行者知道 `test-legacy/` 中哪些测试要迁、哪些只归档、哪些可直接退休。
  3. ZX3 不再把“删 package”与“吸收进 NACP”混为一谈。
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`无`
  - **手动验证**：`逐项核对 package / test inventory 与调查文档一致`
- **收口标准**：
  - keep-set / delete-set / migration-set 全部冻结
  - `test-legacy` 分类完成
  - 无“DEPRECATED 但语义不清”的对象留白
- **本 Phase 风险提醒**：
  - 最容易把 test-only blocker 误记成 runtime blocker
  - 最容易把 keep-set 误写成最终删除目标

### 5.2 Phase 2 — Pure Duplicate Package Removal

- **Phase 目标**：先删除最明确的 duplicate packages，缩小仓库噪音与后续迁移范围
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `pnpm-workspace.yaml`
  - `pnpm-lock.yaml`
  - `docs/**`
- **本 Phase 删除文件**：
  - `packages/agent-runtime-kernel/**`
  - `packages/capability-runtime/**`
  - `packages/llm-wrapper/**`
  - `packages/context-management/**`
  - `packages/hooks/**`
  - `packages/session-do-runtime/**`
- **具体功能预期**：
  1. duplicate packages 先从工作区消失。
  2. worker runtime/test 不再受这些旧 package 牵制。
  3. 文档不再把它们描述为活跃 owner。
- **具体测试安排**：
  - **单测**：`被影响 worker/package 的现有单测`
  - **集成测试**：`受影响 worker 的现有 integration tests`
  - **回归测试**：`pnpm -r run test` 中与被删 package 相关的现有脚本`
  - **手动验证**：`repo-wide search 确认 import / docs / workspace entries 清零`
- **收口标准**：
  - duplicate packages 已物理删除
  - workspace / lockfile / docs 同步完成
  - 无残留 consumer
- **本 Phase 风险提醒**：
  - 包内测试与 docs 引用很容易被漏掉
  - 不能因为“worker 不 import”就忽略 root tests 的依赖

### 5.3 Phase 3 — Bridge / Test-Only Consumer Migration

- **Phase 目标**：清零真正阻挡最终收敛的 bridge/test-only consumers
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
  - `P3-04`
- **本 Phase 新增文件**：
  - `workers/agent-core/test-support/**` 或 `test/shared/observability/**`
  - `workers/{context-core,filesystem-core}/src/{exports,adapters}/**`（按实际需要）
- **本 Phase 修改文件**：
  - `workers/agent-core/**`
  - `workers/context-core/**`
  - `workers/filesystem-core/**`
  - `workers/{orchestrator-core,orchestrator-auth}/**`
  - `packages/{workspace-context-artifacts,storage-topology,eval-observability,orchestrator-auth-contract}/**`
- **具体功能预期**：
  1. `workspace-context-artifacts` 与 `storage-topology` 不再是 runtime bridge。
  2. `eval-observability` 不再是 test blocker。
  3. `orchestrator-auth-contract` 的长期姿态被明确为 keep-set。
- **具体测试安排**：
  - **单测**：`agent-core/context-core/filesystem-core/orchestrator-* 现有单测`
  - **集成测试**：`cross-worker integration + package-local integration`
  - **回归测试**：`pnpm -r run test` + `pnpm --filter './workers/*' run build`
  - **手动验证**：`repo-wide import search；确认 direct package imports 清零`
- **收口标准**：
  - `workspace-context-artifacts` runtime import = 0
  - `storage-topology` direct import = 0
  - `eval-observability` test import = 0
  - `orchestrator-auth-contract` 明确留在 keep-set 中
- **本 Phase 风险提醒**：
  - 这是 ZX3 技术风险最高的 Phase，不能在没有 worker-owned export 面的情况下硬迁
  - 迁移 test helpers 时不要再次制造一个新的临时 package

### 5.4 Phase 4 — Root Guardians + Fixture Cutover

- **Phase 目标**：让新的 `test/` 树真正成为唯一 canonical test tree
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - `test/shared/fixtures/external-seams/**`
  - `test/root-guardians/**`
- **本 Phase 修改文件**：
  - `package.json`
  - `workers/**/test/**`
  - `test-legacy/test-command-coverage.test.mjs`
  - `test/INDEX.md`
- **具体功能预期**：
  1. 现行测试不再 import legacy fixtures。
  2. root contracts 在新树下有稳定入口。
  3. `test:contracts` 与其他 root scripts 不再指向 `test-legacy/`。
- **具体测试安排**：
  - **单测**：`无新增单测要求，复用迁移后现有 tests`
  - **集成测试**：`worker/package integration tests`
  - **回归测试**：`node --test` root guardians + `test:package-e2e` + `test:cross-e2e`
  - **手动验证**：`检查 repo 中不存在对 test-legacy/fixtures 的 import`
- **收口标准**：
  - fixture imports 全部切到 `test/shared`
  - root guardians 全部切到 `test/root-guardians`
  - `test:contracts` 指向新树，`test:legacy:*` 删除或仅保留临时 compat 别名
- **本 Phase 风险提醒**：
  - 不要先删 legacy tree 再迁 fixture
  - 不要把“历史证据归档”与“仍需运行的 guardian”混在一起处理

### 5.5 Phase 5 — Physical Cleanup + Closure

- **Phase 目标**：完成物理删除与仓库叙事收口
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - `docs/issue/zero-to-real/ZX3-closure.md`（如执行阶段需要）
  - `docs/handoff/ZX3-components-deprecation-handoff.md`（如执行阶段需要）
- **本 Phase 修改文件**：
  - `test/INDEX.md`
  - `docs/action-plan/**`
  - `docs/issue/**`
  - `docs/handoff/**`
- **本 Phase 删除文件**：
  - `test-legacy/**`
  - `packages/{workspace-context-artifacts,storage-topology,eval-observability}/**`（前提是 Phase 3 已清零 consumer）
- **具体功能预期**：
  1. `test-legacy/` 真正从仓库中消失。
  2. bridge/test-only packages 在 consumer 清零后退出工作区。
  3. 文档、脚本、closure、handoff 对新 posture 的叙述一致。
- **具体测试安排**：
  - **单测**：`受影响 worker/test-support 的现有单测`
  - **集成测试**：`cross-e2e / package-e2e`
  - **回归测试**：`repo 全量构建 + 相关测试矩阵`
  - **手动验证**：`repo-wide search 确认 test-legacy 与已删 package 均无残留引用`
- **收口标准**：
  - `test-legacy` 物理删除
  - 非 keep-set package 只保留仍被显式批准的对象
  - 文档与仓库结构对齐
- **本 Phase 风险提醒**：
  - 如果 closure 文档改口早于代码/脚本切换，会形成虚假完成

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 4 / Phase 5`
- **为什么必须确认**：`新树中 root contract 的 canonical 命名会影响 package.json scripts、docs 口径与后续长期维护`
- **当前建议 / 倾向**：`同意采用 test/root-guardians/，不要再复用 test/contracts/ 之类会与 package-e2e/cross-e2e 混淆的名字`
- **Q**：`ZX3 是否确认把新的 root contract/guardian 树命名为 test/root-guardians/ 作为长期 canonical 名称？`
- **A**：

#### Q2

- **影响范围**：`Phase 3 / Phase 5`
- **为什么必须确认**：`eval-observability 的剩余测试 helper 需要一个长期落脚点；若位置不冻结，迁移会再次制造临时层`
- **当前建议 / 倾向**：`优先迁到 test/shared/observability；仅与 agent-core 强绑定的 helper 才放 workers/agent-core/test-support`
- **Q**：`ZX3 是否同意把跨测试树可复用的 observability helper 放到 test/shared/observability，而不是再保留独立 package？`
- **A**：

#### Q3

- **影响范围**：`Phase 3 / Phase 5`
- **为什么必须确认**：`orchestrator-auth-contract` 是 keep-set 还是未来 rename/merge 候选，会影响最终 package posture 的表述`
- **当前建议 / 倾向**：`同意在 ZX3 内把 orchestrator-auth-contract 冻结为 keep-set，不在本计划中改名、不并入 NACP`
- **Q**：`ZX3 是否确认 orchestrator-auth-contract 在本轮仅做 keep-set 冻结，不做 rename/merge/absorb？`
- **A**：

### 6.2 问题整理建议

- 优先确认会改变目录与脚本长期命名的事项
- 优先确认会改变 package keep-set 的事项
- 不把实现细节（例如具体 helper 文件名）提升成架构问题
- 每个问题都尽量给出默认建议，避免 ZX3 重新回到开放式讨论

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| bridge package 迁移复杂度 | `workspace-context-artifacts` / `storage-topology` 牵涉多个 worker 与类型导出面 | `high` | 先冻结 worker-owned export 面，再迁 consumer，不做一次性硬删 |
| root guardian 丢失 | `test-legacy` 中的 B7/live-loop/doc-sync/protocol guards 若分类错误，会造成回归保护缺口 | `high` | 先建 `root-guardians` 树，再切脚本，最后删 legacy |
| 文档口径滞后 | 代码已删但文档仍宣称 legacy tree active，会造成后续误导 | `medium` | Phase 2 / Phase 5 都要求同步文档收口 |
| keep-set 误判 | 若把 `orchestrator-auth-contract` 误纳入删除序列，会破坏 façade/auth 边界 | `medium` | 在 Phase 1 与 Q3 中先冻结 posture |

### 7.2 约束与前提

- **技术前提**：`6-workers 当前行为需保持可构建、可测试；不得因 package 删除破坏现有 worker runtime truth`
- **运行时前提**：`bridge package consumer 迁移必须先有 canonical worker export 面，再执行删除`
- **组织协作前提**：`架构师需对 root-guardians 命名、observability helper 落点、orchestrator-auth-contract keep-set posture 做冻结`
- **上线 / 合并前提**：`每个 Phase 都必须用现有脚本完成验证，不允许靠“后面再补测试”推进物理删除`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/eval/zero-to-real/legacy-test-and-package-deprecation.md`
  - `docs/action-plan/worker-matrix/PX-new-tests.md`
- 需要同步更新的说明文档 / README：
  - `test/INDEX.md`
  - `packages/orchestrator-auth-contract/README.md`
  - 保留/迁移中的 package README
- 需要同步更新的测试说明：
  - `package.json` root test scripts
  - `test/root-guardians/README.md`（如新增）

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `repo-wide search` 确认已删 package / `test-legacy` 路径无残留 import
  - workspace 安装、构建、脚本执行仍成立
- **单元测试**：
  - 受影响 workers / test-support / shared helpers 复用现有 unit tests
- **集成测试**：
  - `agent-core` / `context-core` / `filesystem-core` / `orchestrator-*` 的现有 integration tests
- **端到端 / 手动验证**：
  - root guardians、package-e2e、cross-e2e 三层都可从新树运行
- **回归测试**：
  - `pnpm -r run test`
  - `pnpm --filter './workers/*' run build`
  - 必要时 `pnpm --filter './workers/*' run deploy:dry-run`
- **文档校验**：
  - `test/INDEX.md`、action-plan、closure、handoff 对最终 posture 的描述一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `packages/` 中只保留经 Phase 1 明确批准的 canonical keep-set。
2. `workspace-context-artifacts`、`storage-topology`、`eval-observability` 等 blocker 的 consumer 已清零并按计划退出。
3. `test/` 成为唯一 canonical test tree，`test-legacy/` 已物理删除。
4. `package.json` 与测试脚本不再引用 legacy tree。
5. 仓库文档、closure、handoff 与最终目录结构一致，不再把已删对象当作 active truth。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `duplicate packages 已删除，bridge/test-only consumers 已迁移，test tree 已完成 cutover` |
| 测试 | `所有受影响 worker tests、root guardians、package-e2e、cross-e2e 与必要 dry-run 均通过` |
| 文档 | `README、INDEX、action-plan、closure、handoff 对最终 posture 的口径一致` |
| 风险收敛 | `无已知 runtime consumer / test consumer / script consumer 仍依赖 legacy objects` |
| 可交付性 | `后续贡献者不需要再理解旧共存史，也能直接在 canonical tree 与 keep-set 上工作` |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待 ZX3 执行后回填`
- **哪些编号的拆分还不够合理**：`待 ZX3 执行后回填`
- **哪些问题本应更早问架构师**：`待 ZX3 执行后回填`
- **哪些测试安排在实际执行中证明不够**：`待 ZX3 执行后回填`
- **模板本身还需要补什么字段**：`待 ZX3 执行后回填`

---

## 10. 结语

这份 action-plan 以 **“把逻辑退役变成可验证的物理退役”** 为第一优先级，采用 **“先冻结边界、先删 duplicate、再迁最后 consumer、最后删 legacy tree”** 的推进方式，优先解决 **package keep-set 混乱、bridge/test-only blocker 未清零、test-legacy 仍被 active 依赖** 这三个核心问题，并把 **协议层边界不膨胀、测试保护不丢失、文档口径不失真** 作为主要约束。整个计划完成后，`zero-to-real / ZX3` 应达到 **packages 收敛到极小 canonical set，test/ 成为唯一 canonical 测试树，test-legacy 与历史 duplicate packages 完成物理退场**，从而为后续的 **更轻量的 worker 演进、transport 后续工作与客户端能力扩展** 提供稳定基础。
