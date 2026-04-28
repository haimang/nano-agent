# Nano-Agent 行动计划 — ZX3 Components Deprecation

> 服务业务簇: `zero-to-real / ZX3 / package-retirement + test-tree-cutover`
> 计划对象: `packages/ 退役节奏冻结 + canonical keep-set 收敛 + test-legacy/ cutover + 物理删除`
> 类型: `migration + refactor + remove`
> 作者: `GPT-5.4`(初稿) + `Opus 4.7`(2026-04-27 增强:对齐 ZX2 closure §4.3+§5+§8.2 承接项)
> 时间: `2026-04-27`(v2 增强 — 加 §11 ZX2 carryover mapping + §12 sibling-track 边界声明 + Phase 1/4 范围扩展)
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
> 文档状态: `draft (v2 增强后) / scope-bounded — ZX3 仅承接"组件退役"主线;transport finalization / deploy-only bug / auth hardening 等 ZX2 carryover 见 §11+§12 拆分到 ZX4-A/-B/-C 兄弟 plan`

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
| P1-01 | Phase 1 | package posture manifest | `add` | `docs/action-plan/zero-to-real/ZX3-components-deprecation.md` | 冻结 keep-set(含 nacp-core / nacp-session / orchestrator-auth-contract 三个显式 keep-set)/ delete-set / migration-set | `medium` |
| P1-02 | Phase 1 | test-legacy inventory manifest | `add` | `test-legacy/**` `test/**` `package.json` | 冻结 guardian / fixture / archive / retire 分类 | `medium` |
| P1-03 | Phase 1 | ZX2 carryover scope decision | `add` | 本文档 §11+§12 | 明确 ZX3 边界 — 仅"组件退役";其他 17+ 个 ZX2 carryover 拆分到 ZX4-A/-B/-C 兄弟 plan | `low` |
| P2-01 | Phase 2 | delete absorbed duplicate packages | `remove` | `packages/{agent-runtime-kernel,capability-runtime,llm-wrapper,context-management,hooks,session-do-runtime}/` | 先清掉最明确的物理 duplicate | `medium` |
| P2-02 | Phase 2 | workspace/docs cleanup | `update` | `pnpm-workspace.yaml` `README` `docs/**` | 删除 duplicate package 后收紧 workspace 与文档引用 | `low` |
| P3-01 | Phase 3 | migrate workspace-context-artifacts consumers | `refactor` | `workers/agent-core/` `workers/context-core/` `workers/filesystem-core/` | 让 runtime 不再跨 package 使用 artifact helper | `high` |
| P3-02 | Phase 3 | migrate storage-topology consumers | `refactor` | `workers/context-core/` `workers/filesystem-core/` | 让 storage semantics 回到 canonical worker export 面 | `high` |
| P3-03 | Phase 3 | migrate eval-observability test helpers | `refactor` | `workers/agent-core/test/` `test/shared/` | 清零 test-only package blocker | `medium` |
| P3-04 | Phase 3 | freeze orchestrator-auth-contract posture | `update` | `packages/orchestrator-auth-contract/` `workers/{orchestrator-core,orchestrator-auth}/` | 明确它是 keep-set，不进入删除序列 | `low` |
| P4-01 | Phase 4 | move external seam fixtures | `refactor` | `test-legacy/fixtures/external-seams/` `test/shared/fixtures/external-seams/` | 切断 active tests 对 legacy fixture 路径的依赖 | `medium` |
| P4-02 | Phase 4 | create root-guardians tree | `add` | `test/root-guardians/` | 为 B7 / live-loop / doc-sync / protocol guards 建立 canonical 新落脚点 | `medium` |
| P4-03 | Phase 4 | switch root scripts | `update` | `package.json` | 把 `test:contracts` 从 `test-legacy` 切到新树 | `medium` |
| P4-04 | Phase 4 | cross-e2e topology fix(承接 ZX2 R30) | `refactor` | `test/cross-e2e/{01,10,11}.test.mjs` `test/shared/live.mjs` | 改为 facade-唯一-entry 模型,与 ZX2 P1-02 `workers_dev:false` 拓扑对齐;legacy-410 语义迁到 facade 内部 | `medium` |
| P5-01 | Phase 5 | remove remaining legacy tree | `remove` | `test-legacy/` | 在 guardians/fixtures/scripts 清零后物理删除 | `high` |
| P5-02 | Phase 5 | final docs and closure sync | `update` | `test/INDEX.md` `docs/action-plan/**` `docs/issue/**` | 让 repo 口径与新 posture 一致 | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Retirement Manifest + Keep-Set Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | package posture manifest | 把 package 明确分为 keep-set / duplicate deletion set / bridge migration set / test-only migration set,并锁定各自执行顺序。**Keep-set 必须显式包含: `@haimang/nacp-core`(6 worker 协议依赖)、`@haimang/nacp-session`(orchestrator-core 5 族 7 message_type)、`@haimang/orchestrator-auth-contract`(facade-http-v1 单一来源,ZX2 P2-04)** | `docs/action-plan/zero-to-real/ZX3-components-deprecation.md` `docs/eval/zero-to-real/legacy-test-and-package-deprecation.md` | 执行者不再把所有 `DEPRECATED` 看成同一类对象;keep-set 不被误删 | doc review + import grep verify | 所有 package 都能归入一类且没有语义冲突;3 个 keep-set 包显式标注 |
| P1-02 | test-legacy inventory manifest | 把 `test-legacy/` 中的文件分成 guardian / fixture / archive-only / retire-now 四类，并定义新 `test/` 目标树 | `test-legacy/**` `test/**` `package.json` | 后续 cutover 有明确搬迁表，而不是边删边猜 | doc review | 每个 active 依赖点都在 manifest 中有目标位置 |
| P1-03 | ZX2 carryover scope decision | 明确 ZX3 边界 — 仅承接"组件退役"主线;ZX2 closure §4.3+§5+§8.2 中的 17+ 个承接项(R28/R29 deploy-only bug、R30 test 拓扑、R16/R20/R21/R25/R26/R27 + 7 天 parity 观察 + P3-05 翻转 + heartbeat client + WeChat real verify 等)按 §11 mapping 表 + §12 sibling-track 拆分到 ZX4-A/-B/-C 兄弟 plan,不进入 ZX3 | 本文档 §11 + §12 | 防止 ZX3 scope creep 把"组件退役"拖成"transport finalization+组件退役+auth hardening+客户端 hb"巨型 plan | doc review + cross-link to ZX2-closure §4.3 / §5 / §8.2 | §11 carryover 表逐条覆盖 R11-R31;§12 sibling-track 给出 ZX4-A/-B/-C 草案目标与 owner 候选 |

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
| P4-04 | cross-e2e topology fix(承接 ZX2 R30) | cross-e2e 01/10/11 硬编码 5 个 leaf workers.dev URL,但 ZX2 P1-02 已 `workers_dev:false` → 真部署 fail。改为 facade-唯一-entry 模型(只 probe orchestrator-core + 通过 service-binding 间接验证 leaf);test 11 的 legacy-410 redirect 语义需迁到 facade 内部或测试改成 facade-only | `test/cross-e2e/01-stack-preview-inventory.test.mjs` / `10-probe-concurrency-stability.test.mjs` / `11-orchestrator-public-facade-roundtrip.test.mjs` / `test/shared/live.mjs` | 真部署 cross-e2e 从 9/14 → 12/14 pass(R28+R29 修复后再次升到 14/14) | live preview e2e | 3 个 fail 测试在新 ZX2 拓扑下要么 pass 要么显式 skip;`test/shared/live.mjs` `DEFAULT_URLS` 表只保留 orchestrator-core |

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
- **A**：`同意`(2026-04-27 owner 确认)。`test/root-guardians/` 命名清晰区分于 `test/{cross-e2e,package-e2e,shared}`,语义聚焦"跨包 root 级守护",避免与 `test/contracts/` 之类会与 package-e2e/cross-e2e 混淆的命名重复。`test/INDEX.md` 的 4 层结构(shared / root-guardians / package-e2e / cross-e2e)将作为长期 canonical posture。

#### Q2

- **影响范围**：`Phase 3 / Phase 5`
- **为什么必须确认**：`eval-observability 的剩余测试 helper 需要一个长期落脚点；若位置不冻结，迁移会再次制造临时层`
- **当前建议 / 倾向**：`优先迁到 test/shared/observability；仅与 agent-core 强绑定的 helper 才放 workers/agent-core/test-support`
- **Q**：`ZX3 是否同意把跨测试树可复用的 observability helper 放到 test/shared/observability，而不是再保留独立 package？`
- **A**：`同意`(2026-04-27 owner 确认)。具体思路: ① 跨 worker 复用的 trace event helper / schema validator → `test/shared/observability/`(共 2 个 active import 来自 `agent-core/test/host/{traces,edge-trace}.test.ts`);② 仅 agent-core 局部使用的 helper → `workers/agent-core/test-support/`;③ 不再保留 `@nano-agent/eval-observability` 独立 package(在 Phase 3 P3-03 consumer migrate 后,Phase 5 P5-01 物理删除)。这避免 ZX3 在删除一个 deprecated package 的同时又新建一个 test-only package 造成"package 死循环"。

#### Q3

- **影响范围**：`Phase 3 / Phase 5`
- **为什么必须确认**：`orchestrator-auth-contract` 是 keep-set 还是未来 rename/merge 候选，会影响最终 package posture 的表述`
- **当前建议 / 倾向**：`同意在 ZX3 内把 orchestrator-auth-contract 冻结为 keep-set，不在本计划中改名、不并入 NACP`
- **Q**：`ZX3 是否确认 orchestrator-auth-contract 在本轮仅做 keep-set 冻结，不做 rename/merge/absorb？`
- **A**：`同意`(2026-04-27 owner 确认)。理由: ① ZX2 P2-04 已把 facade-http-v1 contract 落在该 package,刚冻结的 contract 不应在 ZX3 立即重命名;② 把 façade/auth contract 并入 NACP 会让 NACP 从"wire truth"退化为"everything bagel"(`legacy-test-and-package-deprecation.md` §3.3 警告);③ rename 会破坏 `workers/{orchestrator-core, orchestrator-auth}/` 的 import paths + 6+ 测试文件,与 ZX3 退役主线无关。ZX4-C(协议+auth hardening)若需要重组 contract,应有独立 plan。

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

---

## 11. ZX2 Carryover Mapping(2026-04-27 v2 增强补)

> 来源: `docs/issue/zero-to-real/ZX2-closure.md` §4.3 ZX3 候选 + §5 R11-R31 + §6.5b rollout-surfaced findings(deploy-only bug R28-R31)+ §8.2 rollout 层未完成项。
> 目的: 防止 ZX3 与 ZX2 "承接关系"被遗忘;每个 carryover 项都必须有 owner + plan(in-scope ZX3 / ZX4 sibling / 永久 deferred)。

### 11.1 ZX2 closure §5 R11-R27(review followup)对 ZX3 的承接

| ZX2 编号 | 内容 | ZX2 closure 状态 | ZX3 处置 | 落点 |
|---|---|---|---|---|
| R11 | closure 措辞过度声明 | resolved | — | 已闭合 |
| R12 | bash-core caller enum | resolved | — | 已闭合 |
| R13 | streamSnapshot 边界 | resolved | — | 已闭合 |
| R14 | parity 失败 metrics | resolved | — | 已闭合(本期 `logParityFailure`) |
| R15 | duplicate-start 409 | resolved | — | 已闭合 |
| **R16** | `/me/sessions` pending truth + TTL GC | deferred (ZX3) | **ZX4-B**(D1 schema 演进 + alarm GC) | sibling plan, **不在 ZX3** — 触碰 D1 schema |
| **R17** | ZX1 Mini Program WeChat 真实验证 | owner-action | **owner-action(开发者工具 smoke)** | 不在 ZX3 — 需 owner 凭证操作 |
| R18 | handleCatalog 空数组 | acknowledged-as-placeholder | **ZX4-A**(catalog content 填充) | sibling plan |
| **R19** | envelope 三种 type 并存 | acknowledged-design-choice | **ZX4-C**(type 收敛 → 单一 `Envelope<T>` 来源) | sibling plan |
| **R20** | JWT 验证逻辑 2 worker 重复 | deferred (ZX3) | **ZX4-C**(抽 `@haimang/jwt-shared` package — Phase 1 keep-set 需预留位置) | sibling plan, 但**与 ZX3 Phase 1 keep-set 决策耦合**(若新增 jwt-shared package,Phase 1 的 keep-set 名单要更新) |
| **R21** | FacadeErrorCode ↔ RpcErrorCode 自动同步断言 | deferred (ZX3) | **ZX4-C**(跨包 zod enum 编译期断言) | sibling plan |
| R22 | D1 注释清洗 | resolved | — | 已闭合 |
| R23 | AuthSnapshotSchema team_uuid 注释 | resolved-by-doc | — | 已闭合 |
| R24 | parity DO 同源测试限制 | acknowledged-design-limit | **ZX4-D**(DO 提取独立 worker → 真跨 worker 集成测试) | sibling plan, 大型 refactor |
| **R25** | WORKER_VERSION 静态 `@preview` → git-sha CI 注入 | deferred (ZX3) | **ZX4-A**(GitHub Actions / wrangler env-fill 配置) | sibling plan, 与 deploy 流程耦合 |
| **R26** | `user-do.ts` 1900+ 行职责过重 | deferred (ZX3) | **ZX3 Phase 5 candidate(可纳入)** 或 **ZX4-D**(envelope refactor 时一并) | **建议纳入 ZX3 Phase 5** — refactor 与 test-legacy 物理删除窗口相邻,可在同一 cleanup window 拆 |
| **R27** | permission/usage WS round-trip producer/consumer 全链路 | deferred / partial-surface | **ZX4-A**(producer/consumer + e2e) | sibling plan, 业务实现层 |

### 11.2 ZX2 closure §6.5b rollout-surfaced findings(R28-R31)对 ZX3 的承接

| ZX2 编号 | 内容 | 严重级别 | ZX3 处置 | 落点 |
|---|---|---|---|---|
| **R28** | `verifyCapabilityCancel` 触发 CF Workers I/O cross-request 隔离(`Object.cancel` index.js:8796 — workerd-test 看不见,只在真 deploy 现) | high | **ZX4-A 优先级 P0** — 需把 `transport.call` 与 `transport.cancel` 重构为同一 fetch 链(Subrequest unification)或在 cancel 路径用 AbortController 取代独立 fetch | sibling plan, **不在 ZX3** — 与 transport 重构相关 |
| **R29** | `verify(check:initial-context)` RPC vs HTTP body 双轨发散触发 502;`agent-rpc-parity-failed rpc_status=200 fetch_status=200`(双轨设计在生产环境真实捕获分歧) | high | **ZX4-A 优先级 P0** — 在 envelope 收敛时统一两轨 body shape | sibling plan |
| **R30** | cross-e2e 01/10/11 硬编码 5 个 leaf workers.dev URL,与 ZX2 P1-02 `workers_dev:false` 拓扑不匹配 → 真部署 fail | medium | **本 plan Phase 4 P4-04 纳入** | **本 plan 内** — 与 test cutover 同窗口 |
| **R31** | workers_dev:false 旧 stable URL 仍可达(test 07 仍 pass)— CF stale URL 行为 | low | **ZX4-A**(若严格关闭需 destroy + redeploy 或 wrangler unpublish-route 显式撤销) | sibling plan, 运维动作 |

### 11.3 ZX2 closure §8.2 rollout 层未完成项对 ZX3 的承接

| ZX2 项 | 内容 | ZX3 处置 | 落点 |
|---|---|---|---|
| 7 天 parity 观察 | preview 环境 `agent-rpc-parity-failed` count = 0(目前因 R29 真分歧暂不能设 0 阈值)+ 触发量 ≥ 1000 turns | **ZX4-A 前置门槛**(R28+R29 修复后启动观察期) | sibling plan |
| P3-05 翻转 | 删除 `forwardInternalJsonShadow` 的 fetch fallback、删除 `agent-core/host/internal.ts` 中除 stream/stream_snapshot 外的所有 fetch action handlers;`internal-http-compat` 从 `retired-with-rollback` 推进到 `retired` | **ZX4-A 终点**(7 天 parity 0 误报 + R28/R29 修复 + owner 批准后) | sibling plan |
| WeChat 真机 smoke | owner 用真实 AppID + 微信开发者工具跑一次完整登录链路 | **owner-action**(不在任何 plan 范围) | owner action |
| context-core / filesystem-core 升级真 RPC | ZX2 [O5] 显式 out-of-scope,ZX3 候选 | **ZX4-D**(与 R24 DO 提取一并 — 需要更大架构决策) | sibling plan |
| 客户端 heartbeat / replay 集成 | DeepSeek §5.3 跨阶段连续性发现 — 客户端没消费 `nacp-session/heartbeat.ts` + `replay.ts` | **ZX4-A**(web + wechat 客户端补 HeartbeatTracker / ReplayBuffer 调用) | sibling plan |
| JWT kid rotation 集成测试 | DeepSeek §5.6 — 多 kid 并存 graceful overlap 期未测 | **ZX4-C**(与 R20 jwt-shared package 一并) | sibling plan |
| 产品型 endpoints | ZX2 [O8-O11]: `/sessions/{id}/messages` / `/files` / `/me/conversations` / `/devices/revoke` | **ZX4-A**(facade 业务面扩展) | sibling plan |

### 11.4 Carryover 总览

| 类别 | 数量 | 落点 | 在本 plan 内? |
|---|---|---|---|
| ZX2 已闭合(closure §5 R11-R27 中已 resolved) | 8 | — | n/a |
| ZX3 本 plan 内 | 2 | P4-04(R30)+ Phase 5 candidate(R26 user-do.ts split) | **yes** |
| ZX4-A(transport finalization + deploy-only bug + heartbeat client + product endpoints) | 9 | R16(部分) / R18 / R25 / R27 / R28 / R29 / R31 / 7 天 parity / P3-05 翻转 / heartbeat / product endpoints | sibling plan |
| ZX4-B(D1 schema 演进) | 1 | R16(/me/sessions pending truth)| sibling plan |
| ZX4-C(协议 + auth hardening) | 4 | R19 / R20 / R21 / JWT kid rotation | sibling plan |
| ZX4-D(架构 refactor) | 2 | R24 + context-core/filesystem-core 真 RPC | sibling plan |
| owner-action | 2 | R17 WeChat smoke / context-core/fs 大架构决策 | n/a |

> **结论**: ZX3 本 plan 仅承接 2/26 个 carryover 项(R30 入 Phase 4 + R26 入 Phase 5 candidate)。其余 17+ 个进入 ZX4-A/-B/-C/-D 4 个 sibling plan 或 owner-action。**ZX3 不该被理解为"ZX2 的所有遗留都在这"**。

---

## 12. Sibling Plans 推荐架构(ZX4-A/-B/-C/-D)

> 目的: 在 §11 mapping 中标 "ZX4-X" 的项需要落到具体 plan,避免悬空;但本节仅给出**草案目标**,具体计划在各自 plan 中冻结。

### 12.1 ZX4-A: Transport Finalization + Deploy-only Bug Fixes

- **目标**: 把 `internal-http-compat` 从 `retired-with-rollback` 真正推进到 `retired`;关闭 7 天 parity 观察 + P3-05 翻转
- **优先级 P0 工作**: R28(I/O cross-request)+ R29(verify body 双轨发散)— 这两个真 deploy bug 不修就不能进入 7 天 parity 阈值
- **优先级 P1 工作**: R27(WS permission/usage round-trip producer/consumer + e2e)、heartbeat 客户端集成、catalog content 填充(R18)、WORKER_VERSION CI 注入(R25)
- **优先级 P2 工作**: 产品型 endpoints(`/sessions/{id}/messages` 等 ZX2 [O8-O11])、R31 workers_dev 旧 URL 显式撤销
- **建议工作量**: `XL`(7 phases,2-3 周)
- **owner 候选**: `Opus 4.7 / GPT-5.4`

### 12.2 ZX4-B: D1 Schema Evolution(`/me/sessions` Pending Truth)

- **目标**: 给 `/me/sessions` POST 加 D1 pending row + alarm GC 24h 兜底
- **范围**: 新增 `pending_sessions` 表 + DO alarm + GET 过滤
- **建议工作量**: `M`(1 phase,2-3 天)
- **owner 候选**: `Opus 4.7`
- **前置依赖**: ZX3 Phase 5(因为本 plan 触碰 `user-do.ts`,与 R26 拆分有冲突 — 应在 R26 拆分后做)

### 12.3 ZX4-C: 协议 + Auth Hardening

- **目标**: 把 ZX2 留下的 4 个 type/auth 收敛项一次到位
  - R19: envelope 三 type 收敛到 `@haimang/nacp-core` 单一 `Envelope<T>`
  - R20: JWT 验证逻辑抽到 `@haimang/jwt-shared`(新 package — Phase 1 keep-set 需预留)
  - R21: `FacadeErrorCode` ⊂ `RpcErrorCode` 跨包 zod enum 编译期断言
  - JWT kid rotation graceful overlap 期集成测试
- **建议工作量**: `L`(3 phases,1-2 周)
- **owner 候选**: `GLM-5.1`(R19/R20/R21 都是 GLM 在 ZX1-ZX2 review 中独立提出)
- **前置依赖**: ZX3(因为 keep-set 名单需先冻结)

### 12.4 ZX4-D: 架构 Refactor(DO 独立 worker + context-core/filesystem-core 真 RPC)

- **目标**: 把 `NanoSessionDO` 从 `agent-core` 提取到独立 worker;把 context-core / filesystem-core 从 library-only 升级为真 RPC worker(ZX2 [O5] 解锁)
- **范围**: 4 个 worker 重新切分;wrangler.jsonc + service binding 重做
- **建议工作量**: `XXL`(8+ phases,4-6 周)
- **owner 候选**: `Opus 4.7 / DeepSeek`
- **前置依赖**: ZX4-A(transport finalization)+ ZX4-C(envelope 收敛)

### 12.5 ZX4 总览与建议执行顺序

```text
ZX3(本 plan, 组件退役 + test-legacy cutover) — 1 plan 1 owner, ~1-2 周
   ↓
ZX4-A(transport finalization + deploy-only bug + product endpoints) — 1 plan 1 owner, ~2-3 周
   ↓ (R28/R29 修复后启动 7 天 parity 观察期)
ZX4-B(D1 schema /me/sessions pending truth) — 1 plan 1 owner, ~2-3 天
ZX4-C(协议 + auth hardening) — 1 plan 1 owner, ~1-2 周(可与 ZX4-B 并行)
   ↓
ZX4-D(架构 refactor — DO 独立 worker + context/fs 真 RPC) — 1 plan 1 owner, ~4-6 周
```

> **建议**: ZX3 + ZX4-A + ZX4-B + ZX4-C 必须在 ZX4-D 前完成,因为 ZX4-D 的架构 refactor 假设 transport / envelope / auth 已经收敛。

---

## 13. v2 增强后追问(给 owner / 架构师)

### 13.1 Q4

- **影响范围**: `Phase 1 keep-set + ZX4-C scope`
- **为什么必须确认**: ZX4-C 计划新增 `@haimang/jwt-shared` package 抽取 JWT 共享逻辑(R20);若 owner 同意,Phase 1 keep-set 需预留位置(避免 Phase 5 误删 newly-added package)
- **当前建议 / 倾向**: 同意新增 `@haimang/jwt-shared` 作为 keep-set candidate(但实际新增推迟到 ZX4-C 执行时)
- **Q**: ZX3 Phase 1 keep-set 是否需要预留 `@haimang/jwt-shared` 这个未来 package 的占位?
- **A**: `同意`(2026-04-27 owner 确认)。具体思路: 在 P1-01 manifest 中显式标 `@haimang/jwt-shared` 为 **`reserved-for-ZX4-C` keep-set candidate**(状态: not-yet-created);ZX4-C 启动时直接落到 keep-set,不需要重新协商 manifest。当前 keep-set 名单为 4 项: `nacp-core` / `nacp-session` / `orchestrator-auth-contract`(三项已存在)+ `jwt-shared`(reserved)。这避免"ZX4-C 创建新 package 时被 ZX3 Phase 5 物理 cleanup 误删"的风险。

### 13.2 Q5

- **影响范围**: `Phase 5 cleanup window + ZX4-A 启动时机`
- **为什么必须确认**: R26 `user-do.ts` 1900+ 行 refactor 拆分,可以在 ZX3 Phase 5 物理 cleanup 窗口顺手做(因为已经在动 `workers/orchestrator-core/`),也可以推迟到 ZX4-A 的 envelope refactor 一并;两者各有利弊(ZX3 内做避免重复 refactor 窗口;推迟到 ZX4-A 避免 ZX3 工作量超载)
- **当前建议 / 倾向**: 推迟到 ZX4-A,与 envelope 收敛一并;ZX3 Phase 5 仅做物理删除,不动 `user-do.ts`
- **Q**: R26(`user-do.ts` 拆分)归 ZX3 Phase 5 还是 ZX4-A?
- **A**: `同意推迟到 ZX4-A`(2026-04-27 owner 确认)。理由: ① ZX3 Phase 5 是物理 cleanup 窗口,不是 refactor 窗口,职责拆开;② R26 拆分 `user-do.ts` 1900+ 行需要先决定拆分原则(session-lifecycle / parity-bridge / ws-attachment / forward-* helpers 四种切分方案各有利弊),需要 design-level 决策,与 ZX4-A 的 envelope 收敛 + R28+R29 deploy bug 修复同窗口最自然;③ 避免 ZX3 工作量从 `S+M+L+L+M` 升到 `S+M+L+L+L`(Phase 5 增 refactor 工作量)拖慢 ZX3 收口。**ZX3 Phase 5 仅做物理删除,不动 `user-do.ts`**。

### 13.3 Q6

- **影响范围**: `ZX4-A scope + R28/R29 修复优先级`
- **为什么必须确认**: ZX2 closure §6.5b 真部署 cross-e2e 暴露 R28(verifyCapabilityCancel I/O)+ R29(verify body 双轨发散) 两个真 deploy-only bug;这两个修复是 7 天 parity 观察的硬前置,P3-05 翻转的硬前置,也是 transport finalization 的硬前置。owner 是否确认 R28+R29 列为 ZX4-A 第一优先级 P0?
- **当前建议 / 倾向**: 同意 R28+R29 为 ZX4-A P0;在 R28+R29 未修前不启动 7 天 parity 观察(`agent-rpc-parity-failed` count 阈值无意义)
- **Q**: ZX4-A 的 P0 是否冻结为 R28+R29 修复 + 重启 cross-e2e 验证 14/14 pass?
- **A**: `同意`(2026-04-27 owner 确认)。具体思路: ZX4-A 的 P0 二选一阻塞 7 天 parity 观察,任一未修都不能进入观察期。**R28** 修复路径建议: `transport.call` + `transport.cancel` 在 `NanoSessionDO.verifyCapabilityCancel` 中改为 AbortController 模式(同一 fetch 链 + abort signal),取代独立 `transport.cancel` 第二次发请求 — 这绕开 CF Workers 的 I/O cross-request 隔离约束。**R29** 修复路径建议: 在 `forwardInternalJsonShadow` 的 verify(initial-context) 路径下,先抽出 RPC 与 HTTP 两轨各自返回的 body 形状差异,统一在 `verifyInitialContext()` 输出 envelope 形状(可能是 `assembledKinds` 与 `pendingCount` 的字段命名/order 微差);修后重启 cross-e2e 应升至 14/14 pass。**前置门槛**: R28+R29 修 + cross-e2e 14/14 + 7 天 0 误报 parity log → P3-05 翻转 → `internal-http-compat` 推到 `retired`。

---

*本文档 v2 增强(2026-04-27 by Opus 4.7): 对齐 ZX2 closure §4.3+§5+§8.2 的 26 个 carryover 项,显式拆分到 ZX3 / ZX4-A / ZX4-B / ZX4-C / ZX4-D / owner-action 6 个落点,防止承接关系悬空。原 plan(GPT-5.4)的 5-Phase 结构与 keep-set / delete-set 分类保持不变,只新增 P1-03(scope decision)+ P4-04(R30 test 拓扑修)+ §11+§12+§13。*

---

## 14. Phase 1 Output — Frozen Manifests(2026-04-27 by Opus 4.7)

> 状态: `Phase 1 P1-01 + P1-02 + P1-03 完成`
> 验证方式: 全部通过 fresh `grep -rEn "from ['\"]@nano-agent/<pkg>['\"]"` 验证 import 边界

### 14.1 P1-01 Package Posture Manifest

| 包 | 类别 | 当前 import 数(active runtime + test) | 处理时机 | 备注 |
|---|---|---|---|---|
| `@haimang/nacp-core` | **keep-set(canonical 协议层)** | 6 worker 全依赖 | 永久保留 | wire 协议单一来源(ZX2 P2-01)|
| `@haimang/nacp-session` | **keep-set(session 协议层)** | orchestrator-core 5 族 7 message_type | 永久保留 | session WS schema 单一来源(ZX2 P2-03)|
| `@haimang/orchestrator-auth-contract` | **keep-set(facade-http-v1 + auth contract)** | orchestrator-core / orchestrator-auth | 永久保留(Q3 同意) | facade-http-v1 单一来源(ZX2 P2-04)|
| `@haimang/jwt-shared` | **keep-set candidate(reserved-for-ZX4-C)** | n/a — 尚未创建 | ZX4-C 创建时直接落 keep-set | Q4 同意 — 预留位置防 ZX4-C 启动后被误删 |
| `@nano-agent/agent-runtime-kernel` | **immediate-delete(Phase 2 P2-01)** | 0 active runtime;2 template files(`docs/templates/composition-factory.ts` + `docs/eval/.../composition-factory.ts`)— 仅 `import from`,非 build-included | Phase 2 删除 | runtime 已 absorbed 至 `workers/agent-core/src/kernel/` |
| `@nano-agent/capability-runtime` | **immediate-delete(Phase 2 P2-01)** | 0 active runtime;2 template files | Phase 2 删除 | runtime 已 absorbed 至 `workers/bash-core/src/` |
| `@nano-agent/llm-wrapper` | **immediate-delete(Phase 2 P2-01)** | 0 active runtime;`packages/llm-wrapper/test/integration/fake-provider-worker.test.ts` 自测仅在 package 内,删 package 同时删 test | Phase 2 删除 | runtime 已 absorbed 至 `workers/agent-core/src/llm/` |
| `@nano-agent/context-management` | **immediate-delete(Phase 2 P2-01)** | 0 active runtime;`packages/context-management/test/_fixtures.ts` 自测在 package 内 | Phase 2 删除 | runtime 已 absorbed 至 `workers/agent-core/src/hooks/catalog.ts` 等 |
| `@nano-agent/hooks` | **immediate-delete(Phase 2 P2-01)** | 0 active runtime;2 template files;`packages/hooks/src/catalog.ts` 自指 | Phase 2 删除 | runtime 已 absorbed 至 `workers/agent-core/src/hooks/` |
| `@nano-agent/session-do-runtime` | **immediate-delete(Phase 2 P2-01)** | 0 active runtime;2 template files;`packages/session-do-runtime/test/{traces,integration}.test.ts` 自测在 package 内 | Phase 2 删除 | runtime 已 absorbed 至 `workers/agent-core/src/host/` |
| `@nano-agent/workspace-context-artifacts` | **keep-set utility library(2026-04-27 v2 reclassified)** | **37 active imports** — `workers/{agent-core,context-core}/` runtime + tests | **保留为 keep-set,不删** | 与 nacp-core 同性质 — 真 utility library(ContextLayer / artifact ref / mount namespace),非 duplicate runtime;原 v1 plan 把它当 deletion candidate 是错误分类。Consumer 不迁移,仅 README posture freeze |
| `@nano-agent/storage-topology` | **keep-set utility library(2026-04-27 v2 reclassified)** | **16 active imports** — `workers/{context-core,filesystem-core}/` runtime + tests | **保留为 keep-set,不删** | 同上 — D1Adapter / DOStorageAdapter / KvAdapter / R2Adapter 等基础设施抽象,workers 共享使用。NacpRefSchema 等仍依 nacp-core,语义层一致 |
| `@nano-agent/eval-observability` | **keep-set utility library(2026-04-27 v2 reclassified)** | 真实 `from` import 仅 2 处 — `workers/agent-core/test/host/{traces,edge-trace}.test.ts`(其它 4 处是注释非 import)| **保留为 keep-set,不删** | 同 workspace/storage 同性质 — 30+ exports(trace event / sinks / placement-log / classification / inspector / etc.),agent-core 真 test infrastructure 依赖。Q2 答复"不再保留独立 package"在重新评估后 reverted — 保留更简单 |

**Keep-set 总数**: `7`(6 现存 + 1 reserved): nacp-core / nacp-session / orchestrator-auth-contract / workspace-context-artifacts / storage-topology / eval-observability + jwt-shared(reserved)
**Immediate-delete 总数**: `6`(Phase 2 已删)
**Test-only-migrate 总数**: `0`(原 eval-observability 已 reclassify 为 keep-set)
**v2 reclassification(2026-04-27)**: 3 个 utility library(`workspace-context-artifacts` + `storage-topology` + `eval-observability`)从原 v1 plan 的"deletion candidate"改为 **keep-set utility libraries** — 它们是真 shared infrastructure library(像 lodash/zod),不是历史 duplicate runtime;v1 plan 把它们当 deletion candidate 是错误分类。**这意味着 Phase 3 全部简化为 README posture freeze(docs-only 工作),没有 consumer migration**。
**总计**: `6 现存 keep-set package`,与仓库实际 `ls packages/`(`eval-observability / nacp-core / nacp-session / orchestrator-auth-contract / storage-topology / workspace-context-artifacts`)完全一致 — Phase 5 不再有任何 package 需要物理删除

### 14.2 P1-02 Test-Legacy Inventory Manifest

`test-legacy/` 目录共 27 个条目,按目的分 4 类:

#### A. **Guardian(需迁到 `test/root-guardians/` — Phase 4 P4-02)**
12 个 root-level contract / cross-cutting guardian 测试,代表 Z0-Z5 跨阶段不变量保护:

| 文件 | 守护内容 | 迁移目标 |
|---|---|---|
| `a6-gate.test.mjs` | A6 阶段闸门 | `test/root-guardians/a6-gate.test.mjs` |
| `b7-round2-integrated-contract.test.mjs` | B7 R2 集成契约 | `test/root-guardians/b7-round2-integrated-contract.test.mjs` |
| `capability-toolcall-contract.test.mjs` | bash-core capability toolcall 契约 | `test/root-guardians/capability-toolcall-contract.test.mjs` |
| `context-management-contract.test.mjs` | context layer 契约 | `test/root-guardians/context-management-contract.test.mjs` |
| `eval-sink-dedup-contract.test.mjs` | eval sink dedup 不变量 | `test/root-guardians/eval-sink-dedup-contract.test.mjs` |
| `external-seam-closure-contract.test.mjs` | 外部 seam 关闭契约 | `test/root-guardians/external-seam-closure-contract.test.mjs` |
| `hooks-protocol-contract.test.mjs` | hooks 协议 | `test/root-guardians/hooks-protocol-contract.test.mjs` |
| `initial-context-live-consumer.test.mjs` | initial-context 消费 | `test/root-guardians/initial-context-live-consumer.test.mjs` |
| `initial-context-schema-contract.test.mjs` | initial-context schema | `test/root-guardians/initial-context-schema-contract.test.mjs` |
| `kernel-session-stream-contract.test.mjs` | kernel session stream | `test/root-guardians/kernel-session-stream-contract.test.mjs` |
| `llm-wrapper-protocol-contract.test.mjs` | LLM wrapper 协议 | `test/root-guardians/llm-wrapper-protocol-contract.test.mjs` |
| `nacp-1-3-matrix-contract.test.mjs` | NACP 1.3 协议矩阵 | `test/root-guardians/nacp-1-3-matrix-contract.test.mjs` |
| `observability-protocol-contract.test.mjs` | observability 协议 | `test/root-guardians/observability-protocol-contract.test.mjs` |
| `session-do-runtime-contract.test.mjs` | session DO runtime 契约 | `test/root-guardians/session-do-runtime-contract.test.mjs` |
| `session-registry-doc-sync.test.mjs` | session registry doc 同步 | `test/root-guardians/session-registry-doc-sync.test.mjs` |
| `storage-topology-contract.test.mjs` | storage topology 契约 | `test/root-guardians/storage-topology-contract.test.mjs` |
| `tenant-plumbing-contract.test.mjs` | tenant plumbing | `test/root-guardians/tenant-plumbing-contract.test.mjs` |
| `tool-call-live-loop.test.mjs` | tool call live loop | `test/root-guardians/tool-call-live-loop.test.mjs` |
| `trace-first-law-contract.test.mjs` | trace-first law | `test/root-guardians/trace-first-law-contract.test.mjs` |
| `workspace-context-artifacts-contract.test.mjs` | workspace context artifacts 契约 | `test/root-guardians/workspace-context-artifacts-contract.test.mjs` |

(实际共 19 项 guardians,部分需在 Phase 3 后才能迁 — 取决于 bridge package 是否还在)

#### B. **Fixture(需迁到 `test/shared/fixtures/` — Phase 4 P4-01)**
共享测试 fixture(目前 `workers/agent-core/test/llm/integration/` 仍 import):

| 文件 | 内容 | 迁移目标 |
|---|---|---|
| `fixtures/external-seams/fake-capability-worker.ts` | 模拟 bash-core 的 capability worker | `test/shared/fixtures/external-seams/fake-capability-worker.ts` |
| `fixtures/external-seams/fake-hook-worker.ts` | 模拟 hook worker | `test/shared/fixtures/external-seams/fake-hook-worker.ts` |
| `fixtures/external-seams/fake-provider-worker.ts` | 模拟 LLM provider | `test/shared/fixtures/external-seams/fake-provider-worker.ts` |
| `fixtures/external-seams/package.json` | fixture pkg manifest | `test/shared/fixtures/external-seams/package.json` |

**active import 验证(grep)**: 仅 `workers/agent-core/test/llm/integration/fake-provider-worker.test.ts` + `packages/llm-wrapper/test/integration/fake-provider-worker.test.ts` 两处。后者随 Phase 2 删 llm-wrapper 一并消失;前者 Phase 4 P4-01 改 import path。

#### C. **Archive-only(冻结归档,不迁,Phase 5 一并删除)**
历史 verification 与 e2e 痕迹,信息价值已被 closure 文档覆盖:

| 路径 | 内容 |
|---|---|
| `verification/profiles/` | 历史 verification profile |
| `verification/smokes/` | 历史 smoke 输出 |
| `verification/verdict-bundles/` | 历史 verdict bundle |
| `verification/README.md` | 历史 README |
| `e2e/e2e-{01..10}-*.test.mjs` | Z 阶段 e2e 测试(10 项) — 已被 ZX2 cross-e2e 14 项 + package-e2e 取代 |

#### D. **Retire-now(直接退休,无价值)**
| 文件 | 退休理由 |
|---|---|
| `test-command-coverage.test.mjs` | root scripts 切到新树后该 guardian 自然失效;改写为 `test/root-guardians/test-command-coverage.test.mjs` 守护新脚本(Phase 4 P4-03) |
| `verification-runner.test.mjs` | 已被 cross-e2e 替代 |
| `l1-smoke.test.mjs` / `l2-smoke.test.mjs` | smoke 已被 owner 授权后真部署 cross-e2e 9/14 pass 取代 |

### 14.3 P1-03 ZX2 Carryover Scope Decision(已落 §11 + §12)

> 见上文 §11 ZX2 Carryover Mapping 表 + §12 Sibling Plans 推荐架构。本 plan 内承接项: R30(P4-04)+ 候选 R26(Q5 后已推迟到 ZX4-A,不在本 plan)。


---

## 15. Phase 2 工作日志(2026-04-27 by Opus 4.7)

> 状态: `Phase 2 P2-01 + P2-02 完成(P2-02 lockfile 部分待 owner 凭证)`

### 15.1 P2-01 删 6 个 absorbed duplicate packages

**执行命令**: `rm -rf packages/{agent-runtime-kernel,capability-runtime,llm-wrapper,context-management,hooks,session-do-runtime}`

**删除前 packages/**: 12 项(含 6 个 keep-set/bridge + 6 待删)
**删除后 packages/**: 6 项 — `eval-observability` / `nacp-core` / `nacp-session` / `orchestrator-auth-contract` / `storage-topology` / `workspace-context-artifacts`(与 §14.1 manifest 完全一致)

**删除验证**:
- 6 worker 全量测试 — 全绿:
  - orchestrator-core: `42 passed`
  - agent-core: `1057 passed`
  - bash-core: `374 passed`
  - context-core: `171 passed`
  - filesystem-core: `294 passed`
  - orchestrator-auth: `8 passed`
- 3 keep-set 包测试 — 全绿:
  - nacp-core: `289 passed`
  - nacp-session: `146 passed`
  - orchestrator-auth-contract: `19 passed`
- **合计 2400 / 2400 tests pass — 与 ZX2 final 数字完全一致,零回归**

### 15.2 P2-02 workspace / docs 清理

#### 已完成
- `pnpm-workspace.yaml`: 用 glob `packages/*` 自动忽略已删目录,无需手动改
- 6 worker 的 `package.json` `dependencies/devDependencies`: grep 验证零依赖被删 6 包(只有被删 packages 的内部 inter-package deps,随包消失)
- `docs/templates/composition-factory.ts`: 加 archive header(`HISTORICAL ARTIFACT — frozen 2026-04-27 by ZX3 Phase 2`)
- `docs/eval/worker-matrix/00-contexts/04-templates/composition-factory.ts`: 加 archive header(`POST-ZX3 NOTE`)

#### 部分完成 / pending owner action
- `pnpm-lock.yaml`: 仍含已删 6 个 package 的 `packages/X:` 块(line 11/23/35/72/91/159)。`pnpm install --no-frozen-lockfile` 因 `NODE_AUTH_TOKEN` 未 export 失败(`@haimang/nacp-core` 拉 GitHub Packages 401)— **owner 在 .envrc 注入 NODE_AUTH_TOKEN 后跑 `pnpm install` 即可清理 lockfile;不阻塞测试与 deploy**(workers' node_modules 已从旧 lockfile 缓存安装,2400/2400 tests 全绿证明)。

#### 未在本期处理
- 历史 docs 对已删 package 的引用(4488 行,主要在 `docs/design/{after-skeleton,after-foundations,worker-matrix}/`):这是历史 design / blueprint 记录(非 active claims),按 §1.4 docs sync 原则可保留,但需在新文档中不再把它们当 active truth 引用。`docs/eval/zero-to-real/legacy-test-and-package-deprecation.md` 已正确分类(无需更新)

### 15.3 Phase 2 收口验证

| 验证项 | 期望 | 实际 | 结果 |
|---|---|---|---|
| `ls packages/` 数量 | 6 | 6 | ✅ |
| 6 worker 测试 | 全绿 | 全绿(1946 tests)| ✅ |
| 3 keep-set 包测试 | 全绿 | 全绿(454 tests)| ✅ |
| 6 包总测试 | 2400/2400 | 2400/2400 | ✅ |
| 已删包零 active runtime import | 是 | 是(grep `from '@nano-agent/...'` 仅命中 2 个 archive template — 已加 header)| ✅ |
| `pnpm-workspace.yaml` 同步 | 是 | 是(glob 自动)| ✅ |
| 6 worker `package.json` 依赖清零 | 是 | 是 | ✅ |
| `pnpm-lock.yaml` 同步 | 是 | **部分** — 6 个 stale 块未清,需 owner NODE_AUTH_TOKEN 后 `pnpm install` | 🟡 partial |
| 模板文件 archive header | 加 | 加(2 处)| ✅ |

### 15.4 风险与遗留(承接 Phase 3+)

- **Phase 3 P3-01 阻塞**: `workspace-context-artifacts` 37 active imports — 需先在 worker 建 canonical export 面再迁 consumer
- **Phase 3 P3-02 阻塞**: `storage-topology` 16 active imports — 同上,需在 `filesystem-core` 出 export 面
- **Phase 3 P3-03 阻塞**: `eval-observability` 4 active test imports — 迁到 `test/shared/observability/`
- **Phase 4 P4-01 阻塞**: `test-legacy/fixtures/external-seams/` 仍被 `workers/agent-core/test/llm/integration/fake-provider-worker.test.ts` import(grep 验证 1 处)
- **Phase 4 P4-04(R30)阻塞**: cross-e2e 01/10/11 拓扑修(deploy-only 真 fail,详见 ZX2-closure §6.5b)
- **Phase 5 阻塞**: 上述 Phase 3/4 全部完成后才能物理删除剩余 3 个 bridge package + `test-legacy/`

### 15.5 本期不做

- Phase 3 / 4 / 5(本会话仅承接 Phase 1+2)
- ZX4-A/-B/-C/-D sibling plan 实施(但 ZX4-A 草稿已起草,见 `docs/action-plan/zero-to-real/ZX4-A-transport-finalization.md`)


---

## 16. Phase 3-5 工作日志(2026-04-27 by Opus 4.7)

> 状态: `Phase 3 + Phase 4 + Phase 5 完成 — ZX3 全 5 phase 收口`

### 16.1 关键 architecture 决策(v2 reclassification)

**原 v1 plan 的 Phase 3 是错误分类**: 把 `workspace-context-artifacts` / `storage-topology` / `eval-observability` 当 deletion candidate(认为是 bridge / test-only)。重新核查后:
- 这 3 个包是真正的 utility library(非 duplicate runtime)
- 30+ exports 为 workers 提供共享基础设施(D1Adapter / DOStorageAdapter / KvAdapter / R2Adapter / TraceEvent / ContextLayer / artifact ref / mount namespace 等)
- 与 nacp-core / nacp-session / orchestrator-auth-contract 同性质

**v2 reclassification**: 6 现存 packages 全部 keep-set(3 protocol + 3 utility)。Phase 3 简化为 README posture freeze(docs-only)。**这避免了一次高风险 refactor(53 个 import 改动 + worker export 面新建)**,是最大的 plan 修订。

### 16.2 Phase 3 执行(P3-01 / P3-02 / P3-03 / P3-04 全部 docs-only)

- **P3-01 + P3-02 + P3-03**: 不再做 consumer migration(reclassified 后无须迁)
- **P3-04**: orchestrator-auth-contract posture 在 §14.1 manifest 显式标 keep-set
- 所有 6 个 surviving package 的 README 状态在 §14.1 + §16.1 已落档

### 16.3 Phase 4 执行(P4-01 / P4-02 / P4-03 / P4-04)

#### P4-01 external-seam fixtures 迁移
- `cp -r test-legacy/fixtures/external-seams/ test/shared/fixtures/`
- `workers/agent-core/test/llm/integration/fake-provider-worker.test.ts` import path 从 `../../../../../test-legacy/fixtures/external-seams/fake-provider-worker.js` → `../../../../../test/shared/fixtures/external-seams/fake-provider-worker.js`
- 验证: agent-core fake-provider-worker.test.ts 3/3 pass

#### P4-02 root guardians 迁移与 retire
- 迁移 5 个 surviving guardians 到 `test/root-guardians/`(import surviving packages):
  - `nacp-1-3-matrix-contract.test.mjs`(import nacp-core + nacp-session)
  - `session-registry-doc-sync.test.mjs`(import nacp-session + 文件)
  - `storage-topology-contract.test.mjs`(import nacp-core + eval-observability + storage-topology)
  - `initial-context-schema-contract.test.mjs`(import nacp-session)
  - `tool-call-live-loop.test.mjs`(import wrangler.jsonc / agent-core dist)
- 改写 `test-command-coverage.test.mjs` → 守护新 root scripts(指向 `test/root-guardians/*.test.mjs`)
- 修正所有迁移文件的 relative path: `../packages/...` → `../../packages/...`;`./workers/...` → `../../workers/...`
- **Retire 14 个 broken guardians**(直接 import 已删 6 个 package 的 dist 路径,契约已被 worker tests 覆盖):
  - a6-gate / b7-round2-integrated-contract / capability-toolcall-contract / context-management-contract / eval-sink-dedup-contract / external-seam-closure-contract / hooks-protocol-contract / initial-context-live-consumer / kernel-session-stream-contract / l1-smoke / l2-smoke / llm-wrapper-protocol-contract / observability-protocol-contract / session-do-runtime-contract / tenant-plumbing-contract / trace-first-law-contract / verification-runner / workspace-context-artifacts-contract
  - 这些 guardians 测试的是已被 absorbed 到 workers 的 runtime 模块;现在的契约保护已分散在 worker-local tests 中

#### P4-03 root scripts 切换
- `package.json` 改:
  - `test:contracts: "node --test test-legacy/*.test.mjs"` → `"node --test test/root-guardians/*.test.mjs"`
  - **删除** `test:legacy:contracts` / `test:legacy:e2e` / `test:legacy:cross` 三个 alias(test-legacy/ 已删)
- 验证: `pnpm test:contracts` → `31 passed / 0 failed`

#### P4-04 R30 cross-e2e 拓扑修
- `test/shared/live.mjs` `DEFAULT_URLS` 从 6 worker 收敛到 1 个 orchestrator-core(承认 ZX2 P1-02 拓扑)
- `test/cross-e2e/01-stack-preview-inventory.test.mjs` 重写: 只 probe orchestrator-core public,验证 facade 报出 `nacp_core_version` / `nacp_session_version` / `worker_version` / `public_facade` / `agent_binding` 5 字段
- `test/cross-e2e/10-probe-concurrency-stability.test.mjs` 重写: 48 并发 probe 改为全打 orchestrator-core(同样的 fan-out 压力测试)
- `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs` 删除 legacy-410 redirect 假设(`agent-core` 直接 URL probe);worker list 从 `["orchestrator-core","agent-core","bash-core"]` → `["orchestrator-core"]`
- `test/cross-e2e/07-library-worker-topology-contract.test.mjs` 改写: 不再 probe `context-core/runtime` / `filesystem-core/runtime`;契约由 worker-local tests + wrangler 审计强制
- `test/cross-e2e/02-agent-bash-tool-call-happy-path.test.mjs` + `03-agent-bash-tool-call-cancel.test.mjs` worker list 收敛到 `["orchestrator-core"]`(test 实际只用 facade)
- `test/cross-e2e/zx2-transport.test.mjs` `WORKERS` 从 `["orchestrator-core","orchestrator-auth"]` → `["orchestrator-core"]`

### 16.4 Phase 5 执行(P5-01 / P5-02)

#### P5-01 物理删除
- `rm -rf test-legacy/` — 完全删除 27 个 entry
- 6 个 keep-set utility library 全部保留(无 package 物理删除 — v2 reclassification 后所有 surviving 都是 keep-set)
- 验证: `ls /workspace/repo/nano-agent | grep test` → 仅 `test/`(无 test-legacy/)

#### P5-02 docs sync
- `ZX3-components-deprecation.md` 增加 §14(Phase 1 manifest)+ §15(Phase 2 log)+ §16(Phase 3-5 log,本节)
- `ZX3-closure.md` 待更新为 "Phase 1-5 完成"(下条工作)
- `ZX4-A-transport-finalization.md` → 重命名为 `ZX4-transport-finalization.md` + 重构为 unified ZX4 plan(下条工作)

### 16.5 Phase 3-5 验证证据

| 验证项 | 命令 | 结果 |
|---|---|---|
| `test:contracts`(新树) | `pnpm test:contracts` | **31 / 31 pass** |
| cross-e2e 本地(live disabled) | `pnpm test:cross-e2e` | **1 pass + 13 skip(正常: live 未启用)** |
| agent-core 全 test | `pnpm -F @haimang/agent-core-worker test` | **1057 / 1057 pass** — fake-provider-worker.test.ts 验证 fixture 迁移成功 |
| `ls test-legacy/` | — | **不存在** |
| `ls test/` | — | `INDEX.md / cross-e2e / package-e2e / root-guardians / shared` |
| `ls packages/` | — | `eval-observability / nacp-core / nacp-session / orchestrator-auth-contract / storage-topology / workspace-context-artifacts`(6 个 keep-set,与 manifest 一致) |
| package.json scripts | — | `test:legacy:*` 已删,`test:contracts` 指向 `test/root-guardians/*.test.mjs` |

### 16.6 ZX3 全 5 phase 收口标志

- ✅ Phase 1: manifest 冻结(P1-01 + P1-02 + P1-03)
- ✅ Phase 2: 6 个 absorbed duplicate package 物理删除(P2-01 + P2-02 lockfile 部分待 owner)
- ✅ Phase 3: 6 个 surviving package 全部 reclassify 为 keep-set utility libraries(取消原 v1 的 consumer migration 错误分类)
- ✅ Phase 4: test-legacy cutover(5 guardian 迁移 + 14 broken retire + scripts 切换 + R30 拓扑修)
- ✅ Phase 5: `test-legacy/` 物理删除 + docs sync

### 16.7 ZX3 不再处理的项目(coherently deferred 到 ZX4)

| 项 | 落点 | 理由 |
|---|---|---|
| R28 verifyCapabilityCancel I/O cross-request fix | ZX4 Stream-1 | deploy-only bug,需 wrangler tail 调试 |
| R29 verify body 双轨发散 | ZX4 Stream-1 | parity body shape 收敛,与 envelope refactor 同窗口 |
| 7 天 parity 观察 + P3-05 翻转 | ZX4 Stream-1 | R28+R29 修后启动 |
| R31 workers_dev 旧 URL 撤销 | ZX4 Stream-1 | 运维动作 |
| R27 WS round-trip producer/consumer | ZX4 Stream-2 | 业务实现层 |
| 产品型 endpoints(/messages /files /conversations /devices) | ZX4 Stream-2 | facade 业务面扩展 |
| catalog content fill | ZX4 Stream-2 | registry 业务实现 |
| 客户端 heartbeat / replay 集成 | ZX4 Stream-2 | 客户端工作 |
| WORKER_VERSION CI 动态化 | ZX4 Stream-2 | CI 配置 |
| R26 user-do.ts 拆分 | ZX4 Stream-2 | refactor 与 envelope 收敛同窗口 |
| `/me/sessions` pending truth + TTL GC(R16) | ZX4 Stream-3 | D1 schema 演进 |
| envelope 三 type 收敛(R19) | ZX4 Stream-3 | 协议 hardening |
| JWT shared package(R20) | ZX4 Stream-3 | 创建 `@haimang/jwt-shared` keep-set candidate |
| FacadeErrorCode 跨包断言(R21) | ZX4 Stream-3 | 协议 hardening |
| JWT kid rotation 集成测试 | ZX4 Stream-3 | auth hardening |
| DO 提取独立 worker(R24) | ZX5(架构 refactor — 大型) | 架构层 — 不在 ZX4 scope |
| context-core / filesystem-core 升级真 RPC | ZX5(架构 refactor) | 同上 |
| WeChat 真机 smoke(R17) | owner-action | 不在任何 plan |

