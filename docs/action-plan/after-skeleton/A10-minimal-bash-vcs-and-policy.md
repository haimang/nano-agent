# A10. Nano-Agent Minimal Bash VCS and Policy 执行计划

> 服务业务簇: `Capability Runtime / Fake Bash / Governance`
> 计划对象: `after-skeleton / Phase 7c / minimal-bash-vcs-and-policy`
> 类型: `modify`
> 作者: `GPT-5.4`
> 时间: `2026-04-18`
> 执行序号: `A10 / 10`
> 上游前序: `A8`, `A9`
> 下游交接: `-`
> 文件位置: `packages/capability-runtime/**`, `docs/design/after-skeleton/P7c-minimal-bash-vcs-and-policy.md`
> 关键仓库锚点: `packages/capability-runtime/src/{capabilities/vcs,fake-bash/unsupported,fake-bash/bridge,policy}.ts`, `packages/capability-runtime/test/{fake-bash-bridge,integration/command-surface-smoke.test.ts}`
> 参考 context / 对标来源: `context/codex/codex-rs/tools/src/tool_registry_plan.rs`, `context/claude-code/services/tools/toolExecution.ts`
> 关联设计 / 调研文档:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P7a-minimal-bash-search-and-workspace.md`
> - `docs/design/after-skeleton/P7b-minimal-bash-network-and-script.md`
> - `docs/design/after-skeleton/P7c-minimal-bash-vcs-and-policy.md`
> - `docs/design/after-skeleton/PX-capability-inventory.md`
> - `docs/design/after-skeleton/PX-QNA.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

Phase 7c 不是再加一个工具，而是给整个 fake bash 能力面做治理收口。当前仓库已经具备几块非常关键的基础：`registerMinimalCommands()` 把 `git` 固定在 12-command minimal pack 内，默认 policy 为 `allow`；`capabilities/vcs.ts` 已把 v1 git subset 明确为 `status/diff/log`；`fake-bash/unsupported.ts` 已把 `UNSUPPORTED_COMMANDS` 与 `OOM_RISK_COMMANDS` 分开维护；`FakeBashBridge` 也已经通过测试证明 unsupported / unknown / oom-risk / no-executor 都会 hard-fail，而不会 fabricated success。

但同一时间，P7c 要解决的断点也非常真实：`git` 当前仍是 stub reality；registry truth、README、prompt、inventory 还没有完全收成一份单一真相；unsupported 与 risk-blocked 虽然代码上已分表，但还没有在 capability disclosure 与 drift guard 里变成正式 contract。Q18 已冻结：**`git` v1 严格只保留 `status / diff / log`**；Q19 已冻结：**capability inventory 采用 `Supported / Partial / Deferred / Unsupported / Risk-Blocked` 五级口径，并以 `ask-gated disclosure` 作为正交维度**。因此这份 action-plan 的目标，是把 **virtual git subset、unsupported/risk-blocked taxonomy、registry/prompt/TS guard alignment、inventory drift guard** 一次性收口，让 Phase 7 真正从“命令表”升级到“能力治理真相表”。

- **服务业务簇**：`Capability Runtime / Fake Bash / Governance`
- **计划对象**：`after-skeleton / Phase 7c / minimal-bash-vcs-and-policy`
- **本次计划解决的问题**：
  - `git` 只读子集已在代码中出现，但当前仍未形成完整 capability contract 与测试闭环
  - unsupported / oom-risk 已有分类，但还没有升格为 registry/prompt/inventory 的共用治理语言
  - 新增命令或修改支持面时，仓库还缺显式 drift guard
- **本次计划的直接产出**：
  - 一套冻结为 `status/diff/log` 的 virtual git baseline 与 structured/bashed shared truth
  - 一套把 `Unsupported / Risk-Blocked / Partial / ask-gated` 明确区分开的治理 contract
  - 一份能约束 registry、prompt、README、inventory、tests 同步收口的 P7c exit pack

---

## 1. 执行综述

### 1.1 总体执行方式

这份 action-plan 采用 **先冻结 subset 与 taxonomy，再闭合 git baseline，再建立 drift guard 与 disclosure 对齐，最后补测试/docs/inventory** 的推进方式。核心原则是：**registry truth 优先于 prompt 文案；只承诺真有的 subset；拒绝与风险必须分开讲；新增能力必须先更新 inventory 与 guard，再谈实现。**

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Governance Truth Freeze | `M` | 冻结 git subset、五级 inventory 口径与 ask-gated disclosure | `A8 + A9 + PX-QNA / PX-capability-inventory` |
| Phase 2 | Virtual Git Baseline Closure | `M` | 让 `git status/diff/log` 成为真实只读 baseline，而不是单纯 stub 名字 | `Phase 1` |
| Phase 3 | Unsupported / Risk-Blocked Enforcement | `M` | 把 taxonomy 从代码常量升级为 policy/prompt/bridge 的正式 contract | `Phase 2` |
| Phase 4 | Registry / Prompt / Inventory Drift Guard | `M` | 建立支持面漂移守卫，避免命令表、提示词与文档脱节 | `Phase 3` |
| Phase 5 | Tests, Docs & Exit Pack | `S` | 用 tests/docs/inventory 收束 Phase 7c，并为后续能力扩张提供治理模板 | `Phase 4` |

### 1.3 执行策略说明

- **执行顺序原则**：`先 freeze 治理语言，再做 git baseline，再补 drift guard，再封箱`
- **风险控制原则**：`不允许 mutating git 偷跑进 v1；不允许 unsupported 与 risk-blocked 混类；不允许 prompt 高于 registry truth`
- **测试推进原则**：`先 fake-bash bridge rejection，再 git subset smoke，再 inventory drift guard`
- **文档同步原则**：`P7c design、PX inventory、README、command disclosure、bridge/policy tests 必须同口径`

### 1.4 本次 action-plan 影响目录树

```text
minimal-bash-vcs-and-policy
├── packages/capability-runtime
│   ├── src/{fake-bash/commands,fake-bash/unsupported,fake-bash/bridge,planner,capabilities/vcs,policy}.ts
│   └── test/{fake-bash-bridge,integration/command-surface-smoke,git-subset-smoke,inventory-drift-guard}.test.ts
└── docs
    ├── action-plan/after-skeleton/A10-minimal-bash-vcs-and-policy.md
    └── design/after-skeleton/{P7c-minimal-bash-vcs-and-policy,PX-capability-inventory}.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 冻结 `git status/diff/log` 为 v1 唯一合法 VCS subset
- **[S2]** 把 `Unsupported / Risk-Blocked / Partial / ask-gated` 升格为正式 capability governance language
- **[S3]** 让 registry、planner、bridge、README、inventory、prompt 对同一支持面保持单一真相
- **[S4]** 为新增命令/修改支持面建立 drift guard 与 review gate
- **[S5]** 保留 future virtual git 扩张空间，但不提前承诺 mutating subset

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** `git add/commit/reset/checkout/rebase/merge` 等 mutating or history-rewriting commands
- **[O2]** 宿主真实 git repository 访问、shelling out 到系统 git
- **[O3]** 复杂 prompt engineering 平台与自动生成 marketing 文案
- **[O4]** 细粒度组织级权限平台或完整 DDL/registry 持久化

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `git status/diff/log` | `in-scope` | Q18 已冻结为 v1 唯一合法 subset | 仅在 future virtual git 设计时重评 |
| mutating git | `out-of-scope` | 与当前 fake bash 治理路线冲突，风险过高 | 独立设计完成前不重评 |
| `Unsupported` vs `Risk-Blocked` | `in-scope` | Q19 已要求分开披露，当前代码也已分表 | 长期保留 |
| `ask-gated disclosure` | `in-scope` | Q19 已明确是正交维度，需进入 inventory | 长期保留 |
| auto-generated inventory | `out-of-scope` | 当前先要收口 truth，不先上复杂 tooling | 后续若 drift 成本升高再重评 |
| prompt 高于 registry truth | `forbidden` | 会破坏 fake bash 治理底线 | 永不作为合法路线重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Git Subset Freeze | `update` | `capabilities/vcs.ts`, `fake-bash/commands.ts`, docs | `git=status/diff/log only` 成为全仓单一真相 | `high` |
| P1-02 | Phase 1 | Inventory Taxonomy Freeze | `update` | PX docs, README, policy docs | 五级口径 + ask-gated disclosure 固定下来 | `high` |
| P1-03 | Phase 1 | Governance Terminology Sync | `update` | bridge/policy/docs | `partial / unsupported / risk-blocked` 不再混用 | `medium` |
| P2-01 | Phase 2 | Virtual Git Handler Baseline | `update` | `capabilities/vcs.ts`, tests | `git status/diff/log` 拥有真实最小 baseline | `high` |
| P2-02 | Phase 2 | Bash / Structured Shared Truth | `update` | planner/tool-call/tests | bash path 与 structured path 共享同一 git subset | `medium` |
| P2-03 | Phase 2 | Readonly Workspace Alignment | `update` | vcs/filesystem/workspace tests | git subset 输出与 workspace truth 对齐 | `medium` |
| P3-01 | Phase 3 | Unsupported Taxonomy Enforcement | `update` | `fake-bash/unsupported.ts`, bridge/policy/tests | unsupported 与 risk-blocked 拒绝路径统一成正式 contract | `high` |
| P3-02 | Phase 3 | No-Silent-Success Guard | `update` | `fake-bash/bridge.ts`, tests | 未接线、未知命令、风险命令都只能 hard-fail | `high` |
| P3-03 | Phase 3 | Ask-Gated Disclosure Closure | `update` | registry/policy/inventory/docs | ask-gated 成为显式披露维度，而非隐性实现细节 | `medium` |
| P4-01 | Phase 4 | Inventory Drift Guard | `update` | tests/docs/review notes | 新命令、新 policy、新 subset 修改必须同步更新 inventory | `high` |
| P4-02 | Phase 4 | Registry / Prompt Alignment Guard | `update` | README/docs/tests | registry truth 优先于 prompt 文案成为制度化约束 | `medium` |
| P5-01 | Phase 5 | Package Test Gate | `update` | bridge/git/inventory tests | Phase 7c 拥有稳定回归面 | `medium` |
| P5-02 | Phase 5 | Docs / Exit Pack | `update` | P7c docs + PX inventory | 后续新增能力可以直接沿用 P7c 治理模板 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Governance Truth Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Git Subset Freeze | 把 `git` 在 registry/planner/docs/inventory 中统一冻结为 `status/diff/log`，明确不含 mutating subset | `packages/capability-runtime/src/{capabilities/vcs,fake-bash/commands,planner}.ts`, docs | `git` v1 边界被清晰写死 | command-surface + docs review | 再无地方暗示 `git add/commit` 属于 v1 |
| P1-02 | Inventory Taxonomy Freeze | 让 `Supported / Partial / Deferred / Unsupported / Risk-Blocked` 与 `ask-gated` 正交维度正式进入 inventory 与 README | PX docs, README | capability disclosure 有稳定语言 | docs review | 同一能力在不同文档不再使用不同术语 |
| P1-03 | Governance Terminology Sync | 在 bridge/policy/docs 中收紧 `partial / unsupported / risk-blocked` 的用词与判定条件 | bridge/policy/docs | 审阅与实现的治理语言一致 | targeted tests | 拒绝原因可稳定映射回 inventory 分类 |

### 4.2 Phase 2 — Virtual Git Baseline Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Virtual Git Handler Baseline | 将当前 `vcs.ts` stub 升级为最小只读 baseline，至少能在 workspace truth 上表达 `status/diff/log` 的 deterministic 输出 | `packages/capability-runtime/src/capabilities/vcs.ts`, tests | `git` 不再只是 declaration | `pnpm --filter @nano-agent/capability-runtime test` | 至少一条 git subset smoke 成立 |
| P2-02 | Bash / Structured Shared Truth | 确保 bash path 与 structured tool-call path 都被同一 subset validator 限制 | planner/tool-call/tests | 不再出现 bash 与 structured 两套 git reality | package tests | 两个入口都只能到 `status/diff/log` |
| P2-03 | Readonly Workspace Alignment | 让 git subset 的输出与 workspace namespace / readonly semantics / path law 保持一致 | vcs/filesystem/workspace tests | git 结果不再脱离 workspace truth | targeted tests | git baseline 与 filesystem/search workspace reality 同世界 |

### 4.3 Phase 3 — Unsupported / Risk-Blocked Enforcement

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | Unsupported Taxonomy Enforcement | 把 `UNSUPPORTED_COMMANDS` 与 `OOM_RISK_COMMANDS` 的分类正式接进 bridge/policy/error code 契约 | `fake-bash/unsupported.ts`, bridge/policy/tests | unsupported 与 risk-blocked 有稳定错误族 | bridge tests | `unsupported-command` 与 `oom-risk-blocked` 不再混用 |
| P3-02 | No-Silent-Success Guard | 延续并强化 `FakeBashBridge` 的 hard-fail contract，覆盖 no-executor / unknown / unsupported / risk-blocked | `fake-bash/bridge.ts`, tests | fake bash 不会伪造成功 | bridge tests | 任一拒绝路径都不会产出 success-shaped output |
| P3-03 | Ask-Gated Disclosure Closure | 让 ask-gated policy 成为显式披露维度，并在 inventory/docs 中稳定展示 | registry/policy/inventory/docs | `ask` 不再只是内部实现细节 | package tests + docs review | reviewer/client 能清楚区分 supported 与 ask-gated supported |

### 4.4 Phase 4 — Registry / Prompt / Inventory Drift Guard

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | Inventory Drift Guard | 增加回归守卫：命令数、支持面、policy、taxonomy 更新时必须同步修改 inventory/docs | tests/docs/review notes | 支持面漂移能被尽早发现 | drift guard tests | 新命令或政策变化不会只改代码、不改披露 |
| P4-02 | Registry / Prompt Alignment Guard | 收紧 README / command disclosure / prompt note 的来源顺序：registry truth 优先 | README/docs/tests | prompt 不再偷偷承诺代码没有的能力 | docs review + tests | 所有对外说明都可追溯到 registry/inventory |

### 4.5 Phase 5 — Tests, Docs & Exit Pack

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | Package Test Gate | 执行 fake-bash rejection、git subset、command-surface、inventory drift guards | package tests | P7c 拥有稳定治理回归面 | `pnpm --filter @nano-agent/capability-runtime test` | 关键治理边界都有自动回归 |
| P5-02 | Docs / Exit Pack | 更新 P7c docs、PX inventory、README，使 future capability expansion 可直接遵循本模板 | docs + README | Phase 7 governance 有可继承基线 | docs review | 新能力扩张不再需要重发明治理语言 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Governance Truth Freeze

- **Phase 目标**：先把“系统到底支持什么、怎么分类、如何披露”这件事写死。
- **具体功能预期**：
  1. `git` v1 只读 subset 统一冻结。
  2. 五级 inventory 与 ask-gated 维度正式成为共用语言。
  3. registry、policy、docs 使用同一治理术语。
- **测试与验证重点**：
  - command-surface smoke
  - docs / inventory review

### 5.2 Phase 2 — Virtual Git Baseline Closure

- **Phase 目标**：让 `git` 至少拥有一个诚实、只读、可验证的 virtual baseline。
- **具体功能预期**：
  1. `status/diff/log` 在 workspace truth 上有 deterministic 输出。
  2. bash 与 structured 共享同一 subset truth。
  3. `git` 不再只是 README 里的声明或 handler 里的 stub。
- **测试与验证重点**：
  - git subset smoke
  - workspace alignment tests

### 5.3 Phase 3 — Unsupported / Risk-Blocked Enforcement

- **Phase 目标**：把拒绝与风险真正纳入治理主链，而不是分散在常量与注释里。
- **具体功能预期**：
  1. unsupported 与 risk-blocked 错误家族清晰稳定。
  2. `FakeBashBridge` 的 no-silent-success 合同继续被加强。
  3. ask-gated disclosure 进入 inventory/README。
- **测试与验证重点**：
  - fake-bash rejection tests
  - policy / disclosure tests

### 5.4 Phase 4 — Registry / Prompt / Inventory Drift Guard

- **Phase 目标**：把“能力漂移”从 review 习惯提升成有守卫的工程约束。
- **具体功能预期**：
  1. registry truth 成为所有能力披露的上游。
  2. inventory drift guard 能挡住“只改代码不改 docs”。
  3. future 新命令扩张有明确治理模板。
- **测试与验证重点**：
  - inventory drift tests
  - README / prompt alignment review

### 5.5 Phase 5 — Tests, Docs & Exit Pack

- **Phase 目标**：让 Phase 7c 不只是当前三份文稿的尾声，而是 future capability governance 的模板。
- **交付要求**：
  1. bridge / git / inventory drift tests 完整
  2. README / PX inventory / P7c design 同口径
  3. 新能力进入系统前必须先通过本治理基线

---

## 6. 风险、依赖与验收

### 6.1 关键依赖

| 依赖项 | 作用 | 当前状态 | 本计划应对方式 |
|--------|------|----------|----------------|
| `FakeBashBridge` rejection tests | no-silent-success 核心资产 | 已存在 | 继续扩充为治理守卫 |
| `UNSUPPORTED_COMMANDS` / `OOM_RISK_COMMANDS` | taxonomy 基础 | 已存在 | 升格为正式 contract |
| PX capability inventory | 披露总表 | 已存在 design memo | Phase 5 统一同步 |
| P7a / P7b action-plan 结果 | workspace 与高风险工具前提 | 正在收口 | 作为 P7c 上游 truth 消费 |

### 6.2 主要风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| `git` 被暗中扩张 | bash/structured 某一侧偷偷加子命令 | 支持面再次漂移 | subset validator + drift guard 同时覆盖两入口 |
| unsupported 与 risk-blocked 混用 | 错误码/文档不同步 | reviewer / runtime 无法统一理解 | Phase 3 强制统一 taxonomy |
| registry 与 docs 脱节 | 新命令只改代码、不改 inventory | fake bash 真相再次失控 | Phase 4 建立 drift guard |

### 6.3 完成定义（Definition of Done）

1. `git` v1 被清晰固定为 `status/diff/log`，且至少拥有最小真实 baseline。
2. `Unsupported / Risk-Blocked / Partial / ask-gated` 成为全仓共用治理语言。
3. `FakeBashBridge` 持续保证 no-silent-success。
4. registry、README、PX inventory、tests 对同一能力面的口径完全一致。
5. future 新命令扩张前，必须先通过 P7c 建立的 inventory / drift guard 约束。

---

## 7. 收口结论

Phase 7c 真正冻结的不是一个 `git` 命令，而是 nano-agent fake bash 的治理姿态：**我们只承诺真的有的 subset；没有的能力不是含糊其辞，而是明确标为 partial、unsupported 或 risk-blocked；所有这些判断都必须在 registry、bridge、policy、README、inventory 与 tests 里保持单一真相。** 只要这套治理收口完成，Phase 7 后续所有能力扩张都会有稳定模板，而不会重新滑回“功能越来越多，但没人说得清到底支持什么”的局面。
