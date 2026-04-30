# Nano-Agent 行动计划 — HP10 Final Closure + Cleanup

> 服务业务簇: `hero-to-pro / HP10`
> 计划对象: `把 HP0-HP10 phase 结果、105 项 deferred、F1-F17 chronic、cleanup 决议与 hero-to-platform 入口统一固化成阶段封板体系`
> 类型: `docs + cleanup + handoff`
> 作者: `Owner + GPT-5.4`
> 时间: `2026-04-30`
> 文件位置:
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
> - `docs/issue/hero-to-pro/HP10-closure.md`
> - `docs/charter/plan-hero-to-platform.md`
> - `docs/architecture/test-topology.md`
> - `workers/orchestrator-core/src/{parity-bridge.ts,user-do-runtime.ts,user-do/message-runtime.ts,user-do/session-flow.ts}`
> - `workers/agent-core/src/host/do/nano-session-do.ts`
> - `workers/orchestrator-core/src/user-do.ts`
> - `package.json`
> - `docs/issue/zero-to-real/{zero-to-real-final-closure.md,R29-postmortem.md,ZX5-closure.md}`
> - `docs/issue/real-to-hero/RHX2-closure.md`
> 上游前序 / closure:
> - `docs/action-plan/hero-to-pro/HP9-action-plan.md`
> - `docs/issue/hero-to-pro/HP8-closure.md`
> - `docs/issue/hero-to-pro/HP9-closure.md`
> - `docs/charter/plan-hero-to-pro.md` §7.11 HP10
> 下游交接:
> - `docs/charter/plan-hero-to-platform.md`
> 关联设计 / 调研文档:
> - `docs/design/hero-to-pro/HP10-final-closure-and-cleanup.md`
> - `docs/design/hero-to-pro/HPX-qna.md`
> - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
> - `docs/issue/real-to-hero/RHX2-closure.md`
> 冻结决策来源:
> - `docs/design/hero-to-pro/HPX-qna.md` Q33-Q36（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `draft`

---

## 0. 执行背景与目标

HP10 不是“写一篇总结”或“顺手删几段老代码”的收尾注释，而是 hero-to-pro 作为一个阶段是否真正封板的最后闸口。当前仓库已经具备两个关键 precedent：第一，`zero-to-real-final-closure.md` 证明了 final closure 需要强结构 section、phase map、remaining issues 与 final verdict；第二，ZX5 / RHX2 等 phase closure 证明了每个 phase 的设计、执行、证据、defer 都已各自成文。HP10 的任务不是重复施工日志，而是把这些分散事实归并成唯一入口，并把 cleanup / retained / handoff 的边界一次性写死。

这一步尤其不能再沿用历史名词：`nano-session-do.ts` 与 `user-do.ts` 已经退化成 wrapper，真正需要进入 cleanup register 的是当前 reality 中仍然存在的 symbol、owner file 与历史 residue。与此同时，Q33-Q36 已经冻结了 HP10 的法律：**final closure 禁止 silently resolved；cleanup register 按当前 repo reality + as-of-commit-hash 决议；hero-to-platform stub 只写 inherited issues 与边界说明；retained-with-reason 是合法终态，但必须带 scope / reason / remove condition，且 remove condition 必须是可观察事件**。

- **服务业务簇**：`hero-to-pro / HP10`
- **计划对象**：`hero-to-pro 阶段封板、cleanup 决议与 hero-to-platform 入口`
- **本次计划解决的问题**：
  - phase closure / chronic register / deferred map 仍分散在多份文档中，缺少阶段级唯一入口。
  - cleanup 决议若继续围绕历史文件名，会与当前 repo reality 脱节。
  - 下一阶段没有正式 stub 时，hero-to-platform 容易再次依赖聊天上下文接力。
- **本次计划的直接产出**：
  - `hero-to-pro-final-closure.md`、`HP10-closure.md`、`plan-hero-to-platform.md`。
  - cleanup register、retained registry、deferred/chronic canonical verdict map。
  - `docs/architecture/test-topology.md` 与 retired guardians 索引。
- **本计划不重新讨论的设计结论**：
  - HP10 final closure 不允许出现 `silently resolved`，所有残余都必须显式分类（来源：`docs/design/hero-to-pro/HPX-qna.md` Q33）。
  - cleanup register 必须按当前 repo reality 决议，并记录 `as-of-commit-hash`（来源：`docs/design/hero-to-pro/HPX-qna.md` Q34）。
  - hero-to-platform stub 只登记 inherited issues 与边界说明，严禁写 recommended approach / timeline / proposed architecture（来源：`docs/design/hero-to-pro/HPX-qna.md` Q35）。
  - `retained-with-reason` 是合法终态，但每项都必须有 scope / reason / remove condition，且 remove condition 必须是可观察事件（来源：`docs/design/hero-to-pro/HPX-qna.md` Q36）。

---

## 1. 执行综述

### 1.1 总体执行方式

HP10 采用**先 phase-result / cleanup candidate reality snapshot → 再做 cleanup 决议与物理删除/保留登记 → 再归并 final closure 的 phase/deferred/chronic map → 最后创建 hero-to-platform stub 并完成 HP10 closure** 的顺序。先做 reality snapshot，能避免 final closure 继续引用已经失真的历史残余名词；而把 stub 放在最后，则能确保下一阶段入口只消费已经在本阶段显式判定过的 inherited issues，而不是把未定结论带过去。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Reality Snapshot + Cleanup Candidate Inventory | M | 建立 as-of-commit-hash 的 cleanup / handoff 基线 | `-` |
| Phase 2 | Cleanup Execution + Retained Registry | M | 处理可删项并为保留项补齐显式字段 | Phase 1 |
| Phase 3 | Final Closure Memo + Canonical Verdict Map | M | 归并 phase map、105 deferred、F1-F17 chronic 与 final verdict | Phase 1-2 |
| Phase 4 | Hero-to-Platform Stub + HP10 Closure | S | 创建下一阶段入口并完成 HP10 phase closure | Phase 1-3 |

### 1.3 Phase 说明

1. **Phase 1 — Reality Snapshot + Cleanup Candidate Inventory**
   - **核心目标**：把 HP10 的 cleanup 和 handoff 建立在真实当前仓库，而不是历史问题名词上。
   - **为什么先做**：不先钉住 as-of-commit-hash reality snapshot，cleanup register 很容易继续失真。
2. **Phase 2 — Cleanup Execution + Retained Registry**
   - **核心目标**：处理真正可删项，并为 retained/handoff 项补齐最小字段。
   - **为什么放在这里**：final closure 不能在 cleanup verdict 还模糊时先行写出。
3. **Phase 3 — Final Closure Memo + Canonical Verdict Map**
   - **核心目标**：把 phase map、105 deferred、F1-F17 chronic 与 inherited issues 归并到一个 final closure 入口。
   - **为什么放在这里**：只有 cleanup / retained / handoff 已定稿，final closure 的 verdict 才可信。
4. **Phase 4 — Hero-to-Platform Stub + HP10 Closure**
   - **核心目标**：创建下一阶段入口并完成 HP10 自身的 closure。
   - **为什么最后**：stub 必须消费已经定稿的 inherited issues，不能越界替下一阶段做规划。

### 1.4 执行策略说明

- **执行顺序原则**：先 snapshot，再 cleanup，再 final closure，再 stub；先分类后删除，不反过来。
- **风险控制原则**：禁止 silently resolved；retained 项必须带 `next-review-date`，默认对齐 hero-to-platform charter 启动日。
- **测试推进原则**：HP10 以 grep/assert、section 完整性检查、phase closure traceability 和 retained/deleted/handoff 分类完整性为主。
- **文档同步原则**：`hero-to-pro-final-closure.md`、`HP10-closure.md`、`plan-hero-to-platform.md`、`test-topology.md` 四份文档必须互链，并回挂 phase closure / runbook / baseline。
- **回滚 / 降级原则**：若某 residue 无法安全删除，则转 `retained-with-reason` 或 `handed-to-platform`；不可因为想要“看起来收尾干净”而强删。

### 1.5 本次 action-plan 影响结构图

```text
hero-to-pro HP10 final closure
├── Phase 1: Reality Snapshot + Cleanup Candidate Inventory
│   ├── as-of-commit-hash cleanup baseline
│   ├── current residual files/symbols
│   └── phase closure input matrix
├── Phase 2: Cleanup Execution + Retained Registry
│   ├── deleted candidates + grep proof
│   ├── retained-with-reason registry
│   └── handed-to-platform registry
├── Phase 3: Final Closure Memo + Canonical Verdict Map
│   ├── 11-phase map
│   ├── 105 deferred canonical verdicts
│   ├── F1-F17 chronic merge
│   └── final verdict
└── Phase 4: Hero-to-Platform Stub + HP10 Closure
    ├── plan-hero-to-platform.md
    ├── docs/architecture/test-topology.md
    └── docs/issue/hero-to-pro/HP10-closure.md
```

### 1.6 已核对的当前代码锚点

1. **仓库已有 final closure precedent，且结构化程度足以直接借鉴**
   - `docs/issue/zero-to-real/zero-to-real-final-closure.md:18-31,99-133`
2. **phase closure precedent 也已存在，final closure 不需要重复全文搬运施工日志**
   - `docs/issue/zero-to-real/ZX5-closure.md:13-39`
   - `docs/issue/real-to-hero/RHX2-closure.md:16-29,124-142`
3. **R28 runbook 仍是 owner-action backfill，而不是 closure 结论**
   - `docs/runbook/zx5-r28-investigation.md:100-141`
4. **历史 megafile 入口已经失真：`nano-session-do.ts` 与 `user-do.ts` 当前都只是 wrapper**
   - `workers/agent-core/src/host/do/nano-session-do.ts:1-8`
   - `workers/orchestrator-core/src/user-do.ts:1-9`
5. **真正需要纳入 cleanup / retained 决议的，是当前 repo reality 中仍活着的 symbol 和 owner file**
   - `workers/orchestrator-core/src/user-do/message-runtime.ts:72-78`
   - `workers/orchestrator-core/src/user-do/session-flow.ts:124-129`
   - `workers/orchestrator-core/src/parity-bridge.ts:48-63,182-219`
   - `workers/orchestrator-core/src/index.ts:1844-1899`
6. **当前 root pipeline 没有 final closure helper，HP10 只能靠显式文档法则而不是现成命令收口**
   - `package.json:7-17`

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `hero-to-pro-final-closure.md` 的阶段总 closure 主文档。
- **[S2]** cleanup register、retained-with-reason registry、handed-to-platform registry。
- **[S3]** 105 项 deferred 与 F1-F17 chronic 的 canonical verdict map。
- **[S4]** `plan-hero-to-platform.md` 入口 stub。
- **[S5]** `docs/architecture/test-topology.md` 与 retired guardians 索引。
- **[S6]** `HP10-closure.md` 与 HP10 gate 合规性说明。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** hero-to-platform 的正式 charter / action-plan / 实施方案。
- **[O2]** HP9 之后的新功能开发。
- **[O3]** 补做新的 manual evidence。
- **[O4]** 继续在 HP10 内重写上游 phase design / action-plan。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `silently resolved` 作为 closure 分类 | `out-of-scope` | Q33 已明确禁止模糊分类 | 不重评 |
| cleanup 按历史文件名决议 | `out-of-scope` | Q34 已冻结为按当前 repo reality + as-of-commit-hash | 不重评 |
| hero-to-platform stub 预写实施计划 | `out-of-scope` | Q35 已明确严禁越界规划下一阶段 | 不重评 |
| retained 项不写 remove condition | `out-of-scope` | Q36 已明确 retained 必须带可观察 remove condition | 不重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | phase input matrix | `update` | all phase closures + charter references | 建立 HP10 的统一输入矩阵 | `medium` |
| P1-02 | Phase 1 | cleanup candidate inventory | `update` | current residual files / symbols | 以 as-of-commit-hash reality 锁定决议基线 | `high` |
| P2-01 | Phase 2 | delete-able residue cleanup | `remove` | approved cleanup targets | 对确认可删项做物理删除与 grep 证明 | `high` |
| P2-02 | Phase 2 | retained / handoff registry | `update` | final closure register sections | 让无法删除项也有合规终态 | `high` |
| P3-01 | Phase 3 | final closure memo | `add` | `hero-to-pro-final-closure.md` | 形成阶段唯一 closure 入口 | `high` |
| P3-02 | Phase 3 | canonical deferred/chronic map | `update` | final closure body | 把 105 deferred 与 F1-F17 压成统一 verdict map | `high` |
| P4-01 | Phase 4 | hero-to-platform stub | `add` | `plan-hero-to-platform.md` | 创建下一阶段唯一入口 | `medium` |
| P4-02 | Phase 4 | HP10 closure + test-topology doc | `add` | `HP10-closure.md`, `docs/architecture/test-topology.md` | 让 HP10 自身也具备可审计 closure | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Reality Snapshot + Cleanup Candidate Inventory

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | phase input matrix | 汇总 HP0-HP10 phase closures、HP8/HP9 gate 结果、`docs/issue/zero-to-real/R29-postmortem.md`、相关 zero-to-real / real-to-hero precedent，建立 final closure 输入矩阵 | all phase closures + precedent docs | HP10 有唯一输入清单，不再靠记忆拼接 | doc review | 每个 phase 都有 verdict / evidence / inherited impact |
| P1-02 | cleanup candidate inventory | 以当前 repo reality 与 `git rev-parse HEAD` 的 as-of-commit-hash 建 cleanup candidate 表，列出 delete / retain / handoff 候选项 | current code residues + grep results | cleanup 决议建立在真实当前仓库而非历史名词 | grep/assert | 每项候选都有当前路径 / symbol / owner / baseline hash |

### 4.2 Phase 2 — Cleanup Execution + Retained Registry

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | delete-able residue cleanup | 执行前先读取 `docs/issue/zero-to-real/R29-postmortem.md`；仅对已被 R29/HP8 判为可删的 residue 做物理删除，并给出 grep / test / manual scan 验证方法 | cleanup target files | 可删项不再停留在“建议删除” | grep + regression tests | `deleted` 项都有 verification method；grep 结果为零 |
| P2-02 | retained / handoff registry | 为 retained / handed 项补齐 `item, scope, reason, remove_condition, current_owner, next_review_date` 等字段 | final closure register sections | 非删除项也有合规终态 | doc review | 缺任何字段即视为 unresolved，不可 closure |

### 4.3 Phase 3 — Final Closure Memo + Canonical Verdict Map

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | final closure memo | 按“阶段总览 → deferred/inherited map → chronic map → handoff 清单 → final verdict”写 `hero-to-pro-final-closure.md` | `docs/issue/hero-to-pro/hero-to-pro-final-closure.md` | hero-to-pro 第一次有真正的阶段总 closure 入口 | section completeness check | 所有 primary gate 与 verdict 都能在一个文件中追踪 |
| P3-02 | canonical deferred/chronic map | 合并 105 deferred，并在 HP0-HP9 closure 已登记的 F1-F17 状态基础上形成 canonical verdict map；允许 `closed / accepted-as-risk / retained-with-reason / handed-to-platform / cannot close` | same final closure doc | 历史 carryover 第一次集中可查 | map review | 同一问题只保留一条 canonical verdict，不再多处文档各说各话 |

### 4.4 Phase 4 — Hero-to-Platform Stub + HP10 Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | hero-to-platform stub | 只登记 inherited issues 与边界说明，明确本阶段不再覆盖的内容 | `docs/charter/plan-hero-to-platform.md` | 下一阶段拥有唯一入口但不越界 | doc review | stub 不包含 recommended approach / timeline / architecture |
| P4-02 | HP10 closure + test-topology doc | 写 `HP10-closure.md`、补 `docs/architecture/test-topology.md` 的 retired guardians 索引，并回挂 cleanup / final closure 证据；HP10 closure 同时显式记录 merged F1-F17 chronic verdict | `docs/issue/hero-to-pro/HP10-closure.md`, `docs/architecture/test-topology.md` | HP10 自身也具备可审计 phase closure | doc review + existence check | HP10 closure 能独立说明 final closure / cleanup / stub 是否已合规 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Reality Snapshot + Cleanup Candidate Inventory

- **Phase 目标**：先建立 HP10 的 current-reality 输入矩阵。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`（起草）
  - 可能涉及 cleanup inventory session artifact
- **本 Phase 已核对的源码锚点**：
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md:18-31,99-133`
  - `docs/issue/zero-to-real/ZX5-closure.md:13-39`
  - `docs/issue/real-to-hero/RHX2-closure.md:16-29,124-142`
  - `workers/orchestrator-core/src/user-do/message-runtime.ts:72-78`
  - `workers/orchestrator-core/src/user-do/session-flow.ts:124-129`
  - `workers/orchestrator-core/src/parity-bridge.ts:48-63`
- **具体功能预期**：
  1. 每个 phase 的最终 verdict、主证据和 inherited impact 都会进入输入矩阵。
  2. cleanup 候选项会被按“当前路径/符号/owner/as-of-commit-hash”记录。
  3. 历史问题名词与当前 reality 的映射会被写清，避免 reviewer 无法理解 cleanup 依据。
- **具体测试安排**：
  - **单测**：无新增单测。
  - **集成测试**：无；以文档核对与 grep 为主。
  - **回归测试**：grep / ls / `git rev-parse HEAD` snapshot。
  - **手动验证**：phase input matrix 审阅。
- **收口标准**：
  - phase input matrix 完整。
  - cleanup candidate inventory 不再围绕历史文件名。
- **本 Phase 风险提醒**：
  - 如果 as-of-commit-hash 不先钉死，review 期间代码变化会让 cleanup register 失去基线。

### 5.2 Phase 2 — Cleanup Execution + Retained Registry

- **Phase 目标**：把“该删 / 该留 / 该移交”变成严格分类，而不是口头建议。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 修改文件**：
  - 可能涉及已批准删除的 residue 代码文件
  - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
- **本 Phase 已核对的源码锚点**：
  - `workers/orchestrator-core/src/parity-bridge.ts:57-63,182-219`
  - `workers/orchestrator-core/src/user-do/message-runtime.ts:72-78`
  - `workers/orchestrator-core/src/user-do/session-flow.ts:124-129`
  - `workers/agent-core/src/host/do/nano-session-do.ts:1-8`
  - `workers/orchestrator-core/src/user-do.ts:1-9`
- **具体功能预期**：
  1. `deleted` 项都有明确 verification method。
  2. `retained-with-reason` 项都写明 scope / reason / remove condition / current owner / next-review-date。
  3. `handed-to-platform` 项都能说明为什么不再由 hero-to-pro 覆盖。
- **具体测试安排**：
  - **单测**：若有代码删改，使用 संबंधित worker 现有测试。
  - **集成测试**：无新增集成测试为主。
  - **回归测试**：
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
    - `pnpm test:cross-e2e`（若删除项涉及主链路）
  - **手动验证**：grep / manual scan。
- **收口标准**：
  - 所有 cleanup 候选都落入 `deleted / retained-with-reason / handed-to-platform`。
  - 没有“建议删除但先不记”的口径。
- **本 Phase 风险提醒**：
  - 若为了“封板干净”而强删高风险 residue，可能制造回归；HP10 必须接受 retained 作为合法终态。

### 5.3 Phase 3 — Final Closure Memo + Canonical Verdict Map

- **Phase 目标**：形成 hero-to-pro 的阶段总 closure。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
- **本 Phase 已核对的源码锚点**：
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md:18-31,119-133`
  - `docs/runbook/zx5-r28-investigation.md:124-141`
  - `docs/issue/real-to-hero/RHX2-closure.md:124-142`
- **具体功能预期**：
  1. final closure 能同时给出 11 phase 状态、4 套状态机最终状态、105 deferred canonical verdict、由 HP0-HP9 closure 合并而来的 F1-F17 chronic canonical verdict、inherited issues 清单与 final verdict。
  2. 每个 phase 都通过 phase closure 链接回挂，而不是复制大段施工日志。
  3. 边界项有分类决策树，不再落入 silent resolution。
- **具体测试安排**：
  - **单测**：无新增单测。
  - **集成测试**：无。
  - **回归测试**：section completeness review、canonical verdict consistency review。
  - **手动验证**：reviewers 通读 final closure。
- **收口标准**：
  - final closure 成为阶段唯一入口。
  - 105 deferred 与 F1-F17 不再散落多处文档各自判定。
- **本 Phase 风险提醒**：
  - 若 final closure 变成 phase closure 拼接稿，信息噪音会压垮 handoff 价值。

### 5.4 Phase 4 — Hero-to-Platform Stub + HP10 Closure

- **Phase 目标**：创建下一阶段入口并完成 HP10 自身收口。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `docs/charter/plan-hero-to-platform.md`
  - `docs/architecture/test-topology.md`
  - `docs/issue/hero-to-pro/HP10-closure.md`
- **本 Phase 已核对的源码锚点**：
  - `package.json:7-17`
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md:99-115`
  - `docs/design/hero-to-pro/HPX-qna.md:623-655`
- **具体功能预期**：
  1. hero-to-platform stub 只写 inherited issues 与边界说明。
  2. `test-topology.md` 明确 live guardians 与 retired guardians 的拓扑索引。
  3. HP10 closure 会写明 final closure、cleanup、stub 三层是否合规完成。
- **具体测试安排**：
  - **单测**：无新增单测。
  - **集成测试**：无。
  - **回归测试**：文档存在性检查、互链检查、分类完整性检查。
  - **手动验证**：stub 边界审阅。
- **收口标准**：
  - stub 不越界。
  - HP10 closure 能独立回答“阶段是否真正封板、哪些内容被移交”。
- **本 Phase 风险提醒**：
  - stub 一旦越界写成下一阶段计划，会同时破坏 hero-to-pro 封板与 hero-to-platform 起点。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q33 — final closure 禁止 silently resolved | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP10 必须使用显式分类决策树，不允许模糊 verdict | 若想保留 silent 类别，HP10 直接不能 closure |
| Q34 — cleanup register 按当前 repo reality + as-of-commit-hash | `docs/design/hero-to-pro/HPX-qna.md` | 决定 cleanup candidate inventory 的基线写法与 review 方式 | 若想回到历史文件名口径，必须退回 design |
| Q35 — hero-to-platform stub 只写 inherited issues + 边界说明 | `docs/design/hero-to-pro/HPX-qna.md` | 决定 stub 不得包含 recommended approach / timeline / architecture | 若要写实质规划，只能在下一阶段 charter 里做 |
| Q36 — retained-with-reason 是合法终态，但 remove condition 必须可观察 | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP10 retained registry 的最小字段与合规边界 | 若 remove condition 不可观察，则该项不能标 retained |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| HP8 / HP9 gate 依赖 | HP10 合法启动依赖 HP8 chronic explicit 与 HP9 docs/evidence/baseline 完成 | `high` | 缺任一 primary gate 直接 `cannot close` |
| cleanup 误判风险 | 若仍按历史问题名词决议，会误删或漏删当前真实 residue | `high` | 以 current reality + as-of-commit-hash 建 baseline |
| retained 项永久积压 | 若 retained 不写 next-review-date，会退化成新一轮 silent carryover | `medium` | 默认 next-review-date = hero-to-platform charter 启动日 |
| stub 越界风险 | HP10 很容易顺手替下一阶段做设计 | `medium` | Q35 明确禁止 recommended approach / timeline / architecture |
| final closure 噪音过大 | 若把 phase 施工日志全文复制进来，会丧失入口价值 | `medium` | 只回挂 phase closure，不复写施工细节 |

### 7.2 约束与前提

- **技术前提**：HP10 以文档归并和必要 cleanup 为主，不引入新的功能开发。
- **运行时前提**：所有上游 gates（HP8/HP9）都必须已有显式 verdict；HP10 不重开这些决策。
- **组织协作前提**：owner / reviewers 需要对 retained / handoff / final verdict 给出最终确认。
- **上线 / 合并前提**：final closure、cleanup register、hero-to-platform stub、HP10 closure 四项齐全。

### 7.3 文档同步要求

- 需要同步更新的说明文档 / README：
  - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
  - `docs/issue/hero-to-pro/HP10-closure.md`
  - `docs/charter/plan-hero-to-platform.md`
  - `docs/architecture/test-topology.md`
- 需要同步回挂的 phase closure：
  - `docs/issue/hero-to-pro/HP0-closure.md` 至 `HP9-closure.md`（按实际存在文件回挂）
- 需要同步回挂的 precedent / inherited 输入：
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
  - `docs/issue/real-to-hero/RHX2-closure.md`
  - `docs/issue/zero-to-real/R29-postmortem.md`

### 7.4 完成后的预期状态

1. hero-to-pro 会第一次拥有真正的阶段总 closure，而不是一堆 phase closure 的散列集合。
2. 每一项 cleanup / retained / handoff 都会有唯一、可追溯的显式结论。
3. hero-to-platform 会拥有唯一入口，而不再依赖聊天上下文接力。
4. 后续 review / onboarding / handoff 能以 `hero-to-pro-final-closure.md` 作为 authoritative 入口，而不是重新考古整仓文档。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 检查 `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`、`docs/issue/hero-to-pro/HP10-closure.md`、`docs/charter/plan-hero-to-platform.md`、`docs/architecture/test-topology.md` 全部存在。
  - 检查 cleanup register 已包含 `deleted / retained-with-reason / handed-to-platform`。
  - 检查 retained 项都包含 `scope / reason / remove_condition / current_owner / next_review_date`。
- **单元测试**：
  - 若有代码 cleanup，运行相关 worker 现有测试：
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
- **集成测试**：
  - 无新增集成测试为主；以 grep/assert 与 phase closure traceability 为主。
- **端到端 / 手动验证**：
  - `pnpm test:cross-e2e`（仅在 cleanup 涉及 runtime path 时）
  - final closure / stub 人工通读审查
- **回归测试**：
  - cleanup grep 验证
  - section completeness / canonical verdict consistency 检查
- **前序 phase 回归**：
  - 若 Phase 2 真的删除 runtime residue，至少回归其所影响 phase 的既有 e2e / worker tests；若只做文档收口，则以 phase closure traceability + grep/assert 为主。
- **文档校验**：
  - final closure 必须能追溯到 phase closure、HP8/HP9 gate、manual evidence、prod baseline、runbook/postmortem
  - HP10 closure / final closure 必须明确说明 F1-F17 是基于 HP0-HP9 closure merge，而不是 HP10 首次“临场判定”

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. hero-to-pro final closure 已存在，并成为阶段唯一入口。
2. cleanup register 已按当前 repo reality 显式分类；`deleted` 有验证方法，`retained` 有 remove condition。
3. 105 deferred 与 F1-F17 chronic 都已进入 canonical verdict map。
4. hero-to-platform stub 已创建，且未越界到正式规划。
5. HP10 closure 本身已说明 final closure / cleanup / stub 三层 verdict。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | final closure、cleanup register、retained/handoff registry、hero-to-platform stub、HP10 closure 全部闭环 |
| 测试 | cleanup grep/assert、section completeness、必要 worker regression 与 cross-e2e（若删改触及主链路）全部通过 |
| 文档 | final closure / HP10 closure / stub / test-topology 四件套存在且互链完整 |
| 风险收敛 | 不再有 silently resolved、不再按历史文件名做 cleanup 决议、不再让下一阶段无入口 |
| 可交付性 | hero-to-pro 可以作为一个真正已封板、可审计、可移交的阶段结束；hero-to-platform 拥有唯一入口 |
