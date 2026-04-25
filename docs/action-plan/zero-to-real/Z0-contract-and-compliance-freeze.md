# Z0 — Contract and Compliance Freeze

> 服务业务簇: `zero-to-real / Z0 / contract-and-compliance-freeze`
> 计划对象: `把 charter + design + ZX-qna 压成可直接驱动 Z1-Z5 的执行基线`
> 类型: `modify`
> 作者: `GPT-5.4`
> 时间: `2026-04-25`
> 文件位置: `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md`
> 关联设计 / 调研文档:
> - `docs/charter/plan-zero-to-real.md`
> - `docs/design/zero-to-real/Z0-contract-and-compliance-freeze.md`
> - `docs/design/zero-to-real/ZX-qna.md`
> - `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md`
> - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
> - `docs/design/zero-to-real/ZX-nacp-realization-track.md`
> - `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md`
> 文档状态: `executed`

---

## 0. 执行背景与目标

Z0 不是实现 worker 代码的 phase，而是把 zero-to-real 从“design 已经齐了”推进到“后续实现不再反复回滚设计层”的 phase。当前 charter、10 份 design 与 `ZX-qna.md` 已基本冻结，但如果没有 Z0 action-plan，把这些内容压成统一执行基线、关闭残留漂移、写出 Z1-Z5 的起跑条件，后续 phase 仍会重新讨论 binding、D1、provider、client baseline。

Z0 解决的是执行入口问题：哪些答案已经冻结、哪些 cross-cutting 约束必须被后续 phase 机械消费、哪些验证基线与 closure 资产从 day-1 就要准备好。它的直接成果不是新功能，而是让 Z1-Z5 的 action-plan、issue closure 与 handoff pack 都建立在同一套事实之上。

- **服务业务簇**：`zero-to-real / Z0`
- **计划对象**：`Contract and Compliance Freeze`
- **本次计划解决的问题**：
  - `charter / design / ZX-qna 已完成，但尚未被压成下游 phase 的单一执行基线`
  - `Z1-Z5 缺少明确的 cross-cutting consumption checklist，容易在实施期重新打开 design debate`
  - `zero-to-real 缺少 Z0 closure，用来宣告 design freeze 与 action-plan pack 已进入执行态`
- **本次计划的直接产出**：
  - `docs/action-plan/zero-to-real/Z1-Z5` 的可执行引用基线
  - `docs/issue/zero-to-real/Z0-closure.md`
  - `zero-to-real` 的 execution checklist / validation baseline / cross-cutting dependency map

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先做 freeze audit、再做 execution mapping、最后写 Z0 closure** 的方式推进。Z0 不增加运行时代码，而是把 charter、design、QnA、现有代码现实和 root test baseline 汇总成一个可直接驱动 Z1-Z5 的执行门槛。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Freeze Audit | `S` | 核对 charter / design / ZX-qna / 代码起点 / 测试基线 已无结构性冲突 | `-` |
| Phase 2 | Execution Mapping | `S` | 把 cross-cutting 约束映射进 Z1-Z5 的实施前提与依赖表，并补齐 implementation freeze register | `Phase 1` |
| Phase 3 | Validation Baseline | `XS` | 固定 root test / package-e2e / cross-e2e / closure evidence 的使用方式 | `Phase 2` |
| Phase 4 | Z0 Closure | `XS` | 产出 `Z0-closure.md` 并正式解锁 Z1 | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — Freeze Audit**
   - **核心目标**：确认 charter、10 份 design、`ZX-qna.md` 与当前仓库代码现实不再互相冲突。
   - **为什么先做**：如果 freeze audit 还没完成，Z1 起步时会把 design 问题重新带回实现期。
2. **Phase 2 — Execution Mapping**
   - **核心目标**：把 `NANO_AGENT_DB`、`AI` binding、WorkerEntrypoint RPC-first、D1 waves、Q1-Q10 frozen answers 映射成后续 phase 的实施前提。
   - **为什么放在这里**：先确认冻结真相，再决定每个 phase 怎样消费。
3. **Phase 3 — Validation Baseline**
   - **核心目标**：明确零散的测试资产如何变成 Z1-Z5 的统一验证体系。
   - **为什么放在这里**：执行基线若不含测试/closure 资产，后续 review 会继续主观化。
4. **Phase 4 — Z0 Closure**
   - **核心目标**：形成 Z0 完成证明，并把剩余问题压成 implementation follow-up。
   - **为什么放在最后**：closure 只能建立在前 3 个 Phase 真正收束之后。

### 1.4 执行策略说明

- **执行顺序原则**：`先审计冻结真相，再下放到执行，再写 closure`
- **风险控制原则**：`Z0 不偷渡实现期设计变更，也不把实现细节重新升格为 owner blocker`
- **测试推进原则**：`只复用仓库既有 test:package-e2e / test:cross-e2e / test:cross(test:e2e) 与 closure evidence，不建立新的平行验证体系`
- **文档同步原则**：`charter / design / action-plan / issue closure 的术语、路径、Q 编号一次对齐`

### 1.5 本次 action-plan 影响目录树

```text
zero-to-real/
├── charter/
│   └── docs/charter/plan-zero-to-real.md
├── design/
│   └── docs/design/zero-to-real/
│       ├── Z0-contract-and-compliance-freeze.md
│       ├── ZX-qna.md
│       ├── ZX-binding-boundary-and-rpc-rollout.md
│       ├── ZX-d1-schema-and-migrations.md
│       ├── ZX-nacp-realization-track.md
│       └── ZX-llm-adapter-and-secrets.md
├── action-plan/
│   └── docs/action-plan/zero-to-real/
│       ├── Z1-full-auth-and-tenant-foundation.md
│       ├── Z2-session-truth-and-audit-baseline.md
│       ├── Z3-real-runtime-and-quota.md
│       ├── Z4-real-clients-and-first-real-run.md
│       └── Z5-closure-and-handoff.md
└── closure/
    └── docs/issue/zero-to-real/Z0-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 核对并声明 zero-to-real 的 frozen inputs：charter、10 份 design、`ZX-qna.md`
- **[S2]** 输出 Z1-Z5 的 cross-cutting dependency / sequencing / validation baseline
- **[S3]** 把 root test scripts 与现有 package-e2e / cross-e2e harness 升格为执行基线
- **[S4]** 产出 `docs/issue/zero-to-real/Z0-closure.md`

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 新增任何 worker / package / client 代码
- **[O2]** 重新打开 Q1-Q10 的 owner-level 决策
- **[O3]** 编写 Z1-Z4 的实现代码
- **[O4]** 直接撰写 final closure / next-phase handoff

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `ZX-qna.md` Q1-Q10 追加新答案 | `out-of-scope` | Z0 只消费已冻结答案，不重开决策 | `出现 owner 新决策时` |
| Z1-Z5 action-plan 撰写 | `in-scope` | Z0 必须把执行包真正交付出来 | `Z0 执行期` |
| 具体 SQL / RPC / provider 代码实现 | `out-of-scope` | 属于 Z1-Z4 正文工作 | `对应 phase 执行期` |
| `Z0-closure.md` | `in-scope` | Z1 起跑前必须有正式 closure | `Z0 执行期` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | frozen input audit | `update` | `charter + design + ZX-qna` | 证明 zero-to-real 的 design freeze 已真正成立 | `medium` |
| P1-02 | Phase 1 | code-anchor audit | `update` | `workers/**` `test/**` | 把 action-plan 锚定到真实目录、wrangler、tests | `medium` |
| P2-01 | Phase 2 | cross-cutting dependency map | `update` | `Z1-Z5 action-plan pack` | 让每个 phase 明确消费哪些 ZX 文档与 Q 编号 | `low` |
| P2-02 | Phase 2 | deliverable / closure path freeze | `update` | `docs/issue/zero-to-real/**` `docs/handoff/**` | 让 issue / handoff 路径固定下来 | `low` |
| P2-03 | Phase 2 | implementation freeze register | `update` | `ZX-qna + ZX-d1 + ZX-llm + Z4 plan` | 冻结 model、migration tool、client stack、evidence template 等执行级细节 | `medium` |
| P3-01 | Phase 3 | validation baseline freeze | `update` | `package.json` `test/**` | 统一 `test:package-e2e` / `test:cross-e2e` / `test:cross(test:e2e)` / evidence pack 口径 | `low` |
| P4-01 | Phase 4 | Z0 closure memo | `add` | `docs/issue/zero-to-real/Z0-closure.md` | 宣告 Z1 可正式启动 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Freeze Audit

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | frozen input audit | 核对 charter、10 份 design、`ZX-qna.md` 是否共享同一组 phase / D1 / RPC / Workers AI / client baseline | `docs/charter/plan-zero-to-real.md` `docs/design/zero-to-real/*.md` | 冻结真相成为单一事实源 | 文档 review | 不再出现 phase boundary、Q 编号、文件路径冲突 |
| P1-02 | code-anchor audit | 对照 `workers/*/wrangler.jsonc`、`workers/**/src/**`、`test/**`，确认 action-plan 使用的当前锚点真实存在 | `workers/**` `test/**` `package.json` | Z1-Z5 的实施文件路径有真实落点 | grep / glob / 文档 review | action-plan 不引用错误目录、错误脚本或不存在的现有路径 |

### 4.2 Phase 2 — Execution Mapping

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | cross-cutting dependency map | 给 Z1-Z5 明确标出要消费的 ZX 文档、Q 编号、shared bindings、migration waves | `docs/action-plan/zero-to-real/*.md` | 后续 phase 不再在实现期重新找前提 | 文档 review | 每份 action-plan 都有稳定的 cross-cutting 输入集 |
| P2-02 | deliverable / closure path freeze | 固定 `docs/issue/zero-to-real/` 与 `docs/handoff/` 的输出路径及职责分工 | `issue / handoff paths` | closure / handoff 不再临时 invent 文件名 | 文档 review | Z0-Z5 closure 与 final closure/handoff 路径全部明确 |
| P2-03 | implementation freeze register | 把 implementation-phase 最容易重新争论的细项冻结成 register：`NANO_AGENT_DB` alias + `wrangler d1 migrations apply`、Workers AI first-wave model/fallback、Z4 client stack baseline、first-real-run evidence template | `docs/action-plan/zero-to-real/*.md` `docs/design/zero-to-real/ZX-*.md` | 后续 phase 不再在实现期重开 model / migration / client stack / evidence 讨论 | 文档 review | 执行期最常见的 implementation-level ambiguity 被前置冻结 |

### 4.3 Phase 3 — Validation Baseline

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | validation baseline freeze | 固定 `pnpm test:package-e2e`、`pnpm test:cross-e2e`、`pnpm test:cross` / `pnpm test:e2e`、package-local tests、evidence pack 的使用规则 | `package.json` `test/**` | 所有 phase 都共享一套验证口径 | 文档 review | action-plan 不再出现平行验证体系或缺失验证口径 |

### 4.4 Phase 4 — Z0 Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | Z0 closure memo | 汇总 freeze audit、execution mapping、validation baseline，并给出 Z1 解锁条件 | `docs/issue/zero-to-real/Z0-closure.md` | Z0 正式闭合 | 文档 review | Z1 能直接以 Z0 closure 作为启动前提 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Freeze Audit

- **Phase 目标**：证明 zero-to-real 已经从 design authoring 进入 execution-ready 状态
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `docs/action-plan/zero-to-real/*.md`
- **具体功能预期**：
  1. Z1-Z5 action-plan 全部建立在 current code reality 之上。
  2. `ZX-qna.md` 成为唯一 decision source，不再被平行解释。
  3. worker / D1 / provider / client 路线不再在 Z1 起步时重新讨论。
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`文档交叉核对 + 代码路径核对`
  - **手动验证**：`逐份检查 charter/design/action-plan 的路径、Q 编号、worker reality`
- **收口标准**：
  - action-plan 不引用错误现有文件路径
  - Q1-Q10 的消费方式在 Z1-Z5 中稳定一致
  - 现有测试与 closure 路径都已被 action-plan 纳入
- **本 Phase 风险提醒**：
  - 最容易把设计里的“目标目录”误当成当前已存在目录
  - 最容易把过期 review blocker 重新带回执行计划

### 5.2 Phase 2 — Execution Mapping

- **Phase 目标**：让 Z1-Z5 在启动前就知道自己依赖哪些 frozen answers 与 cross-cutting 文档
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
  - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`
  - `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`
  - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md`
  - `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md`
- **具体功能预期**：
  1. 每个 phase 都明确知道自己依赖哪几份 ZX 文档。
  2. D1 migration waves、auth contract、Workers AI、client evidence pack 的责任面不再漂移。
  3. `NANO_AGENT_DB` / migration tool / first-wave model / Z4 client stack / evidence template 被前置冻结。
  4. closure / handoff 文档输出路径提前固定。
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`action-plan 交叉引用检查`
  - **手动验证**：`检查每份 plan 的关联文档与交付路径`
- **收口标准**：
  - 每份 plan 至少列出 1 组 phase-specific docs + 1 组 cross-cutting docs
  - execution-level freeze register 已覆盖 migration tool、binding alias、model fallback、client stack、evidence 模板
  - Z5 能消费 Z0-Z4 的 closure 输出，不再 invent 新命名
- **本 Phase 风险提醒**：
  - 最容易遗漏 `packages/orchestrator-auth-contract/`、`NANO_AGENT_DB`、`AI` binding 这类 cross-cutting 真前提
  - 最容易把“implementation-level freeze”误当成 owner-level blocker而跳过

### 5.3 Phase 3 — Validation Baseline

- **Phase 目标**：让后续 review 的“怎么证明做完了”从 Z0 开始统一
- **本 Phase 对应编号**：
  - `P3-01`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `docs/action-plan/zero-to-real/*.md`
- **具体功能预期**：
  1. Z1-Z5 默认复用 root scripts 与现有 package-e2e / cross-e2e harness。
  2. 客户端 / manual proof 类事项转成 evidence pack，而不是口头描述。
  3. 不再为每个 phase 建平行 test runner。
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`脚本与测试目录路径核对`
  - **手动验证**：`核对 package.json scripts 与 test 目录`
- **收口标准**：
  - `pnpm test:package-e2e` = package 内独立验证；`pnpm test:cross-e2e` = cross-worker 独立验证；`pnpm test:cross` / `pnpm test:e2e` = 全量回归
  - Z4/Z5 明确 evidence pack 路径与用途
- **本 Phase 风险提醒**：
  - 最容易把 manual evidence 与 automated harness 混成一类，导致 closure 判据失焦

### 5.4 Phase 4 — Z0 Closure

- **Phase 目标**：宣布 zero-to-real 的设计冻结和执行起跑线正式成立
- **本 Phase 对应编号**：
  - `P4-01`
- **本 Phase 新增文件**：
  - `docs/issue/zero-to-real/Z0-closure.md`
- **本 Phase 修改文件**：
  - `无`
- **具体功能预期**：
  1. Z0 closure 能一页说明“为什么可以进入 Z1”。
  2. closure 明确列出 Z1 的启动前提，而不是泛泛写“下一步做 auth”。
  3. charter `§10.1 Primary Exit Criteria` 被明确引用为后续审计基线。
  4. 所有已冻结决定与剩余 implementation follow-up 分界清楚。
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`closure / charter / action-plan 三方对照`
  - **手动验证**：`检查 Z0 closure 是否可直接被 Z1 引用`
- **收口标准**：
  - `docs/issue/zero-to-real/Z0-closure.md` 存在
  - closure 引用了 charter、ZX-qna、Z1-Z5 action-plan pack
  - Z1 启动前提清晰且不再包含 owner-level 未决问题
- **本 Phase 风险提醒**：
  - 最容易把 Z0 closure 写成 design recap，而不是 execution gate

---

## 6. 风险与依赖

| 风险 / 依赖 | 描述 | 缓解方式 |
|-------------|------|----------|
| frozen answer 漂移 | 实施者绕开 `ZX-qna.md` 自行解释 Q1-Q10 | 所有 plan 必须显式引用对应 Q 编号 |
| current reality 误读 | 把未来目标目录写成现有目录 | 对照 `workers/**`、`test/**`、`wrangler.jsonc` 做现实锚定 |
| validation baseline 分裂 | 每个 phase 各自发明验证方式 | 统一要求优先复用 root scripts 与 evidence pack |

---

## 7. 完成后的预期状态

Z0 完成后，zero-to-real 不再停留在“design 都写好了”的状态，而是进入 **Z1 可直接起跑** 的状态：

1. 后续 phase 的路径、依赖、closure 产物全部固定；
2. current code reality 与 future target reality 已被显式区分；
3. implementation follow-up 不再伪装成 owner-level blocker。

---

## 8. 本计划完成后立即解锁的后续动作

1. 启动 `Z1-full-auth-and-tenant-foundation.md`
2. 在 `docs/issue/zero-to-real/` 建立 Z1-Z5 closure 文档骨架
3. 按 Z1 -> Z2 -> Z3 -> Z4 -> Z5 的顺序推进，不回滚 Z0 基石决策

---

## 9. 工作日志回填（executed）

1. 重新核对了 `docs/charter/plan-zero-to-real.md`、Z0/Z1 action-plan、ZX 设计包、以及当前 worker/runtime 代码现实，确认 Z1 起步前不再存在 owner-level blocker。
2. 将 zero-to-real 的验证基线显式压回仓库既有 runner，并把入口固定到 root `package.json`：`pnpm test:package-e2e`、`pnpm test:cross-e2e`、`pnpm test:cross`。
3. 创建 `docs/issue/zero-to-real/Z0-closure.md`，把 frozen answer register、cross-cutting dependency map、validation baseline、以及“文档术语 vs 代码路径”的映射正式写成 closure 资产。
4. 将本文档状态从 `draft` 翻为 `executed`，并把 “Z0 的价值在于 execution gate，而不是新增运行时代码” 这一点固定下来，避免后续阶段误把 Z0 当实现期。
5. 在 Z0 freeze baseline 上，直接启动并完成了 Z1 的首轮真实实现；这个后续事实可作为 Z0 baseline 已足以机械消费的反向证据，但不把 Z1 成果误记为 Z0 自身交付。
