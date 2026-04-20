# Nano-Agent 行动计划 — B8：Worker-Matrix Pre-Convergence & Handoff

> 服务业务簇：`After-Foundations Phase 7 — Worker-Matrix Pre-Convergence & Handoff`
> 计划对象：`docs/handoff/` + `docs/templates/` 下的 4 项 handoff deliverables + B8 closure issues
> 类型：`handoff (no packages/ code change)`
> 作者：`Claude Opus 4.7 (1M context)`
> 时间：`2026-04-20`
> 文件位置：
> - `docs/handoff/after-foundations-to-worker-matrix.md` （new）
> - `docs/handoff/next-phase-worker-naming-proposal.md` （new）
> - `docs/templates/wrangler-worker.toml` （new）
> - `docs/templates/composition-factory.ts` （new）
> - `docs/issue/after-foundations/B8-phase-{1,2,3}-closure.md` （new）
> - `docs/issue/after-foundations/B8-final-closure.md` （new）
> - `docs/issue/after-foundations/after-foundations-final-closure.md` （new — **后基础阶段整体收口**）
>
> 关联设计 / spec / review / issue / spike / action-plan 文档：
> - `docs/plan-after-foundations.md` (§4.1 H / §6 Phase 7 / §7.8 / §11 / §12)
> - `docs/design/after-foundations/P7-worker-matrix-pre-convergence.md` （P7 设计主文件）
> - `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
> - `docs/action-plan/after-foundations/B2-storage-adapter-hardening.md`
> - `docs/action-plan/after-foundations/B3-fake-bash-extension-and-port.md`
> - `docs/action-plan/after-foundations/B4-context-management-package-async-core.md`
> - `docs/action-plan/after-foundations/B5-hooks-catalog-expansion-1-0-0.md`
> - `docs/action-plan/after-foundations/B6-nacp-1-2-0-upgrade.md`
> - `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md`（LIVE evidence 输入）
> - `docs/issue/after-foundations/B7-final-closure.md`（B8 硬前置）
> - `docs/issue/after-foundations/B7-phase-3-closure.md`
> - `docs/issue/after-foundations/B1-final-closure.md`
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md`（handoff memo 格式参照）
> - `docs/code-review/after-foundations/B5-B6-reviewed-by-GPT.md`（B7 入场 review 依据）
> - `docs/code-review/after-foundations/B7-reviewed-by-GPT.md`（B8 入场 review 依据）
>
> 关键 reference（当前仓库 reality）：
> - `packages/session-do-runtime/src/env.ts`（`V1_BINDING_CATALOG` 当前 3 active + 1 reserved）
> - `packages/session-do-runtime/wrangler.jsonc`（当前声明的 3 条 services binding）
> - `spikes/round-2-integrated/spike-do-storage-r2/wrangler.jsonc`（B7 final deploy 的 binding shape 示例）
> - `spikes/round-2-integrated/spike-do-storage-r2/.out/probe_*.json`（LIVE evidence）
> - `spikes/round-2-integrated/spike-binding-pair-r2/worker-a-r2/.out/probe_*.json`（LIVE binding evidence）
> - `test/b7-round2-integrated-contract.test.mjs`（B6 dedup/overflow 契约的根测试锁）
>
> 文档状态：`draft`

---

## 0. 执行背景与目标

> B8 是 after-foundations 阶段的**最终 handoff phase**。与 B2-B6 的 ship phase 和 B1/B7 的 spike phase 都不同——B8 **不新增 / 不修改任何 `packages/` 代码**。它把 B1-B7 全部已 ship、已冻结、已验证的事实打包成下一个阶段（worker matrix）能直接消费的 readiness package。

- **服务业务簇**：`After-Foundations Phase 7 — Worker-Matrix Pre-Convergence & Handoff`
- **计划对象**：`docs/handoff/` + `docs/templates/` 的 4 项 deliverables + B8 closure issues + after-foundations 整体收口 issue
- **本次计划要解决的核心问题**：
  - **P1**：B1-B7 产生了**海量事实**（15 个 finding docs、7 个 phase closure、3 个 reviews、B7 LIVE deploy `.out/*.json`），但没有一个**单一入口**让下一个阶段的 charter 设计者能一次消费。handoff memo 就是这个入口。
  - **P2**：charter §4.1 H 第 32 项明确要求 **v1 binding catalog 不得修改**，但 worker matrix 阶段必然要讨论 `bash.core / filesystem.core / context.core / agent.core` 这些命名。B8 必须输出 **proposal 形态的 naming 文档**，严格标注"不是冻结决策，worker matrix 阶段可调整"。
  - **P3**：worker matrix 阶段若从零写 `wrangler.jsonc` + composition factory，会重复 B2-B6 已经走过的 type/binding 痛点。B8 提供两个模板让 worker matrix 从 "组装已验证组件" 而非 "边写边验证" 起步。
  - **P4**：B7 产出的 LIVE evidence（DO cap = 2.1 MiB、R2 concurrent put 安全默认 50、binding-F04 cross-worker dedup 契约成立、x-nacp-* 小写法则等）必须**具体以数字形态**进入 handoff memo，而不是让 worker matrix 再去挖 `.out/*.json`。
  - **P5**：B7 保留的 2 个 owner/platform gate（F03 cross-colo、F09 high-volume curl）必须显式写进 handoff 的 `§9 Open Issues`，worker matrix 不能默认消费 cross-colo KV read-after-write。
  - **P6**：charter §1.4 把 `context.core` 从 v1 `RESERVED_BINDINGS` 升格为 worker matrix first-wave worker。B8 handoff 必须显式记录这项 owner decision + Opus eval v2 §7.4 依据。
  - **P7**：GPT §2.2 修订的 `agent.core ≠ binding slot` 区分必须作为 handoff 核心不变量——否则 worker matrix 会把 `agent.core` 当成 reserved binding 从而引入 catalog 设计错误。
- **本次计划的直接产出**：
  - **D1**：`docs/handoff/after-foundations-to-worker-matrix.md`（P7 设计 §3.1 规定的 10 章节 handoff memo）
  - **D2**：`docs/handoff/next-phase-worker-naming-proposal.md`（4 first-wave + 1 reserved proposal，explicitly non-binding）
  - **D3**：`docs/templates/wrangler-worker.toml`（含 binding-F02 / F08 / binding-F01 evidence comment）
  - **D4**：`docs/templates/composition-factory.ts`（B2-B6 shipped packages 组装模板）
  - **D5**：`docs/issue/after-foundations/B8-phase-1/2/3-closure.md` + `B8-final-closure.md`
  - **D6**：`docs/issue/after-foundations/after-foundations-final-closure.md`——**整个 after-foundations 阶段 (B1-B8) 的单页终极收口 issue**

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 采用 **"先收集 truth、再构造 handoff memo、再沉淀 templates、最后做整体 closure"** 的四段式：

1. **Phase 1 — Truth Inventory + 前置校验**：确认 B1-B7 全部 phase closure 已 ship，抓齐每条 finding 的 Round-2 verdict、每个 shipped package 的 version、每条 LIVE 数字，把它们汇总成**"B8 Truth Inventory 电子表格"**（作为 Phase 2/3 的唯一输入源）。
2. **Phase 2 — Handoff Memo + Worker Naming Proposal**：按 P7 §3.1 的 10 章节结构写 handoff memo；按 P7 §3.2 写 worker naming proposal，每条都 cite Truth Inventory 的对应条目。
3. **Phase 3 — 2 个 Templates**：按 P7 §3.3 / §3.4 写 `wrangler-worker.toml` + `composition-factory.ts`，模板注释必须 cite 具体 B7 LIVE 数字（例如 cross-worker call timeout 建议默认 ≥ 100ms 对应 binding-F01 p99=7ms 的 ~14× buffer；`maxValueBytes = 2,097,152` 对应 F08 LIVE cap 2.1 MiB）。
4. **Phase 4 — Closure + After-Foundations Final Exit**：B8 phase-1/2/3 closure issues + B8-final-closure + **after-foundations-final-closure**（single-page terminal closure for the whole after-foundations phase）。

**关键执行不变量**：
- **不修改 `packages/` 任何代码**（charter §4.1 H 第 32 项）
- **不修改 `spikes/` 任何 probe 代码**（B7 closed；任何回改都要走 follow-up，不在 B8 范围）
- **不新增包、不升 version、不写实现**（B8 是 doc phase）
- **所有引用必须是 file-or-evidence-link**（不允许 "as documented earlier" 之类的指称）

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|---|---|---|---|---|
| Phase 1 | Truth Inventory + 前置校验 | S | 抓齐 B1-B7 全部 ship + finding verdict + LIVE 数字的单一 spreadsheet | B7 final closure must exist |
| Phase 2 | Handoff Memo + Worker Naming Proposal | M | 按 P7 §3.1 / §3.2 输出两份 doc，每条都 cite Truth Inventory | Phase 1 |
| Phase 3 | 2 个 Templates（wrangler + composition factory） | S | 按 P7 §3.3 / §3.4 输出；模板注释带 B7 LIVE 数字证据 | Phase 2 |
| Phase 4 | B8 closure + after-foundations-final-closure | S | B8 4 份 closure issue + 1 份整体 after-foundations 收口 issue | Phase 1-3 |

### 1.3 Phase 说明

1. **Phase 1 — Truth Inventory + 前置校验**
   - **核心目标**：把 B1-B7 所有 phase closure、所有 finding verdict、所有 LIVE 数字、所有 shipped package 的 version + ship date、当前 repo state（`pnpm-workspace.yaml`、每个包的 CHANGELOG 尾部、每个 action-plan 的 §X 日志）抓成 `B8-truth-inventory.md` 的**单一事实源**。Phase 2/3 只允许 cite 这份 inventory，不允许重新去翻原始文档。
   - **为什么先做**：B1-B7 产生的 evidence 过于分散（15 finding docs / 7 phase closures / 3 reviews / `.out/*.json`）；如果 Phase 2 边写 memo 边翻旧档，会出现"同一事实在多处写法不一致"的风险（B7-R3 就是这类 drift 的教训）。Phase 1 用 30–60 分钟的 inventory 工作换取 Phase 2/3 的"单一真相源"。
2. **Phase 2 — Handoff Memo + Worker Naming Proposal**
   - **核心目标**：产出 `docs/handoff/after-foundations-to-worker-matrix.md` + `docs/handoff/next-phase-worker-naming-proposal.md`。前者按 P7 §3.1 的 10 章节模板；后者按 P7 §3.2 的 4 first-wave + 1 reserved 结构，**明确标注为 proposal**。
   - **为什么放在这里**：handoff memo 是 B8 最重要的 deliverable；早一点定稿，Phase 3 的模板才能 cite 它的章节号。
3. **Phase 3 — 2 个 Templates**
   - **核心目标**：`docs/templates/wrangler-worker.toml` + `docs/templates/composition-factory.ts`。模板里的每条 `// comment` 必须指向 Phase 1 inventory 的具体条目或 B7 `.out/*.json` 的具体 observation。
   - **为什么放在这里**：模板是 handoff memo §8 的实装；handoff memo 先定稿，模板才能和它对齐。
4. **Phase 4 — Closure + After-Foundations Final Exit**
   - **核心目标**：B8-phase-1/2/3-closure + B8-final-closure + `after-foundations-final-closure.md`（单页整体收口）。最后一份是本 action-plan 的**项级交付**——把 B1-B8 八个 phase 一次性告别。
   - **为什么放在这里**：只有前 3 个 Phase 都 closed 后，才有资格写整体收口。

### 1.4 执行策略说明

- **执行顺序原则**：**truth 先行、proposal 紧随、template 再下、closure 最末**。严格按 Phase 1→2→3→4 串行；Phase 内允许 parallelism，Phase 间不允许跳步。
- **风险控制原则**：**零代码修改**。本 phase 下 `git diff -- 'packages/*' 'spikes/*'` 必须保持 0 行；任何看似"顺手修一下"的冲动都违反 charter §4.1 H 第 32 项。
- **测试推进原则**：B8 无代码测试；用 **doc-consistency check** 替代——Phase 1 inventory 的每条 bullet 必须能在原始文档里 `grep` 到匹配；Phase 2/3 的每条 cite 必须能在 inventory 里匹配。整体收口要求根测试 `node --test test/*.test.mjs` + `npm run test:cross` 仍绿（作为 "no regression from B8 edits" 的 sanity check）。
- **文档同步原则**：本 phase 的 deliverables 之间存在引用链（`composition-factory.ts` cite handoff memo §8；handoff memo §7 cite `B7-final-closure.md` §3；B8-final-closure cite 所有 4 个 deliverables）。一次改动一个文件；改完立即同步下游引用。

### 1.5 本次 action-plan 影响目录树

```text
docs/
├── handoff/                                        # NEW directory
│   ├── after-foundations-to-worker-matrix.md       # D1 — 10-section handoff memo
│   └── next-phase-worker-naming-proposal.md        # D2 — worker naming proposal (non-binding)
├── templates/
│   ├── wrangler-worker.toml                        # D3 — worker shell template
│   └── composition-factory.ts                      # D4 — B2-B6 shipped packages assembly
├── issue/after-foundations/
│   ├── B8-phase-1-closure.md                       # Truth Inventory phase closed
│   ├── B8-phase-2-closure.md                       # Handoff memo + naming proposal closed
│   ├── B8-phase-3-closure.md                       # 2 templates closed
│   ├── B8-final-closure.md                         # B8 phase closed; 4 deliverables shipped
│   └── after-foundations-final-closure.md          # B1-B8 全阶段单页终极收口
└── action-plan/after-foundations/
    └── B8-worker-matrix-pre-convergence.md         # 本文件
```

**未触及目录（必须保持原状）**：

```text
packages/**                        # zero source modification
spikes/**                          # B7 closed; no probe edits
test/**                            # no new tests; existing 77/77 + 91/91 must stay green
docs/spikes/**                     # Round-1/2 finding docs stay as-is (§9 closure sections frozen)
docs/design/after-foundations/**   # P0-P7 designs frozen
docs/rfc/**                        # nacp-* RFCs frozen
packages/*/CHANGELOG.md            # frozen
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** Truth Inventory: B1-B7 全部 phase closure、finding verdict、LIVE 数字、shipped package version 的单一 spreadsheet (`docs/issue/after-foundations/B8-phase-1-closure.md` 的 §2-§5)
- **[S2]** `docs/handoff/after-foundations-to-worker-matrix.md` 按 P7 §3.1 规定的 10 章节结构
- **[S3]** `docs/handoff/next-phase-worker-naming-proposal.md` 按 P7 §3.2 规定的 4 first-wave + 1 reserved 结构
- **[S4]** `docs/templates/wrangler-worker.toml` 按 P7 §3.3 结构；每条 comment cite Truth Inventory 或 B7 `.out/*.json`
- **[S5]** `docs/templates/composition-factory.ts` 按 P7 §3.4 结构；只 import B2-B6 shipped packages
- **[S6]** B8 phase-1/2/3 closure issues + B8-final-closure
- **[S7]** `docs/issue/after-foundations/after-foundations-final-closure.md`（B1-B8 全阶段终极收口，单页）
- **[S8]** handoff memo §9 必须列出 F03 / F09 两个 owner/platform gate 作为 open issues handed off

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 修改 `packages/` 任何文件（charter §4.1 H 第 32 项 + §4.2 第 2 项）
- **[O2]** 修改 `spikes/` 任何 probe 代码（B7 已 closed）
- **[O3]** 新增或修改 `@nano-agent/*` 包的 version / CHANGELOG
- **[O4]** worker matrix 阶段的实际 worker shell 实现（→ next phase 的 charter）
- **[O5]** binding catalog v2 接口签名设计（→ next phase）
- **[O6]** skill.core 拆分为 browser/search/scrape 等细 worker 的决策（→ product demand 出现时）
- **[O7]** RBAC / OAuth / billing / tenant ops / cross-region routing（→ post-worker-matrix）
- **[O8]** 为打开 F03 / F09 gate 而编写的新 probe（→ owner step，不是 B8 代码工作）
- **[O9]** 把 `DOStorageAdapter.maxValueBytes` 从 1 MiB 升到 2 MiB 的 minor calibration（→ worker matrix 阶段 OR 独立的 small change，不在 B8）

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|---|---|---|---|
| 修改 `V1_BINDING_CATALOG` | `out-of-scope` | charter §4.1 H 第 32 项：不修改；除非 P6 Round 2 暴露 v1 catalog gap。B7 实测没暴露 → 保持不动 | worker matrix 阶段 charter |
| agent.core / bash.core / filesystem.core / context.core 4 worker shell 实装 | `out-of-scope` | charter §4.2 A 第 1-3 项；B8 只出 proposal | worker matrix 阶段 |
| skill.core 是否 reserved binding 升格 first-wave | `defer` | charter §12.2 + P7 §3.2.2：仅 reserve name；product demand 出现时再讨论 | product demand trigger |
| F03 cross-colo 打开 gate | `defer / depends-on-decision` | owner/平台问题，不是 B8 代码可解；但 B8 必须在 handoff §9 标注 | owner 提供跨 colo account profile 时 |
| F09 owner URL | `defer / depends-on-decision` | 同上 | owner 提供 URL 时 |
| `DOStorageAdapter.maxValueBytes = 2 MiB` calibration | `defer` | B7 LIVE 已给出 2.1 MiB；升级是 packages 修改，不在 B8 | worker matrix 阶段或独立 small PR |
| handoff memo 把 B7-review §6/§7 的 B8 entry assessment 直接引用 | `in-scope` | Phase 1 Truth Inventory 必须消费这份 B8 entry assessment | — |
| 增加 `nano-agent-spike-do-storage-r2` / `-binding-pair-*-r2` 的 observability dashboard | `out-of-scope` | 与 B7 closed 无关；post-worker-matrix 范畴 | — |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|---|---|---|---|---|---|---|
| P1-01 | Phase 1 | 抓 B2-B6 shipped package versions + CHANGELOG 尾部 | doc | `packages/*/package.json` + `packages/*/CHANGELOG.md` | 记录 8 个包的当前 version + 最新 ship 日期 | low |
| P1-02 | Phase 1 | 抓 B1 Round-1 + B7 Round-2 全部 finding 的 §0 status + §9 closure | doc | `docs/spikes/**/*.md` | 15 finding 的 Round-1 status / Round-2 verdict / gate 状态完整表 | low |
| P1-03 | Phase 1 | 抓 B7 LIVE deploy 的所有 `.out/*.json` 关键数字 | doc | `spikes/round-2-integrated/**/*.out/*.json` | 每个 probe 的 headline 数字（DO cap、R2 曲线、binding-F04 stats、…）进表 | low |
| P1-04 | Phase 1 | 抓 3 份 GPT reviews 的最终 verdict + §6/§7 response 结论 | doc | `docs/code-review/after-foundations/*.md` | 每轮 review 的 verdict + 关闭 review 所需的 evidence 进表 | low |
| P1-05 | Phase 1 | Sanity check: root tests 仍绿 | test | `test/*.test.mjs` + `npm run test:cross` | 77/77 + 91/91 作为 "no B8 pre-edit regression" baseline | low |
| P1-06 | Phase 1 | 产出 `B8-phase-1-closure.md`（整份是 Truth Inventory） | doc | `docs/issue/after-foundations/B8-phase-1-closure.md` | Phase 2/3 的唯一事实源 | medium |
| P2-01 | Phase 2 | 按 P7 §3.1 写 handoff memo 10 章节 | doc | `docs/handoff/after-foundations-to-worker-matrix.md` | 核心交付物 D1 | high |
| P2-02 | Phase 2 | 按 P7 §3.2 写 worker naming proposal (4 + 1) | doc | `docs/handoff/next-phase-worker-naming-proposal.md` | 核心交付物 D2；显式标注 non-binding | high |
| P2-03 | Phase 2 | handoff memo §7 填 B7 Round-2 15 finding verdict 表 | doc | 同 P2-01 | 每行必须 cite `.out/*.json` 或 finding doc §9 | high |
| P2-04 | Phase 2 | handoff memo §9 列出 F03 / F09 open gates + B8 既往 B5-B6 review findings 无未 closed 项 | doc | 同 P2-01 | open issues 的完整移交 | high |
| P2-05 | Phase 2 | `B8-phase-2-closure.md` | doc | `docs/issue/after-foundations/B8-phase-2-closure.md` | Phase 2 closed | low |
| P3-01 | Phase 3 | `docs/templates/wrangler-worker.toml` | doc | 新文件 | 按 P7 §3.3 结构；每个 comment 带 B7 LIVE evidence link | medium |
| P3-02 | Phase 3 | `docs/templates/composition-factory.ts` | doc | 新文件 | 按 P7 §3.4 结构；只 import 已 ship 的 `@nano-agent/*` | medium |
| P3-03 | Phase 3 | `B8-phase-3-closure.md` | doc | 新文件 | Phase 3 closed | low |
| P4-01 | Phase 4 | `B8-final-closure.md` | doc | 新文件 | B8 phase closed；4 deliverables 都 ship；Truth Inventory 已被 memo 完整消费 | medium |
| P4-02 | Phase 4 | `after-foundations-final-closure.md`（整阶段终极收口） | doc | 新文件 | B1-B8 八 phase 的单页收口 + next phase（worker matrix）charter kickoff readiness 声明 | high |
| P4-03 | Phase 4 | 本 action-plan 回填 §12 实现者工作日志 | doc | 本文件底部 | 可 audit | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Truth Inventory + 前置校验

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P1-01 | B2-B6 version 抓取 | 对 8 个 shipped 包（`nacp-core / nacp-session / storage-topology / capability-runtime / context-management / workspace-context-artifacts / hooks / eval-observability / session-do-runtime`）逐一记录 `package.json version` + CHANGELOG 尾部最新 entry 的日期 | `packages/*/package.json`, `packages/*/CHANGELOG.md` | 8 行表格进 `B8-phase-1-closure.md` §2 | grep + 人工比对 | 每个包的 version 可 copy-paste，CHANGELOG 日期无出入 |
| P1-02 | 15 finding Round-1/Round-2 status | 按 `docs/spikes/{spike-do-storage,spike-binding-pair,unexpected}/*.md` 的 §0 status 列 + §9 Round-2 closure 列出 15 行 | `docs/spikes/**/*.md` | `B8-phase-1-closure.md` §3 | grep `§9 Round-2 closure` 存在于 15 份 finding docs | 15 行完整；gate 字段（F03/F09）精确标注 |
| P1-03 | B7 LIVE headline 数字 | 每个 B7 probe 抓 1-3 个 headline 数字：`DO cap (F08), R2 concurrent p50 curve (unexpected-F01), binding-F04 dedup/overflow stats, binding-F01 canceled outcome, F05 parity trace, …` | `spikes/round-2-integrated/**/*.out/*.json` | `B8-phase-1-closure.md` §4；每条数字后附 .out 文件 path | `python3 -c 'import json; ...'` 脚本重抽 | 数字能和 `.out/*.json` 逐一对上 |
| P1-04 | 3 轮 reviews verdict | `B5-B6-reviewed-by-GPT.md` + `B7-reviewed-by-GPT.md` + 本次 B8 对 reviews 的 response 的最终 verdict 列入 inventory | `docs/code-review/after-foundations/*.md` | `B8-phase-1-closure.md` §5；review ID → verdict → 闭环状态 | 人工核对 §6 response | 3 轮都标注为 closed with findings addressed |
| P1-05 | root tests sanity | `node --test test/*.test.mjs` + `npm run test:cross` 在 B8 起点跑一次，记录基线 | `test/**`, repo root | `B8-phase-1-closure.md` §6；数字 + timestamp | actual test run | 77/77 + 91/91；与 B7 closure 一致 |
| P1-06 | Phase 1 closure issue | 把 P1-01 到 P1-05 的产出汇编成 `B8-phase-1-closure.md`，作为 Phase 2/3 的唯一事实源 | 新文件 | 该文件存在 + 6 个 section 齐全 | 人工 review | Phase 2 开始前 Phase 1 必须 closed |

### 4.2 Phase 2 — Handoff Memo + Worker Naming Proposal

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P2-01 | handoff memo 10-section 骨架 | 按 P7 §3.1.1 的 10 章节模板建骨架；每个章节标题 + 一句话用途 | `docs/handoff/after-foundations-to-worker-matrix.md` | 骨架文件存在；10 个 `## §N` heading | grep `## §` 得 10 | 10 章节 heading 齐全，subtitle 正确 |
| P2-02 | handoff memo §1-§6 填充 | §1 Phase Summary / §2 What's Validated / §3 What's Shipped / §4 Hard Contract Requirements / §5 Worker Naming (点指 D2) / §6 Binding Catalog Evolution Policy | 同 P2-01 | 每章节至少 1 个表 + 3 条证据 link | 人工 review | 每个事实可追回 Phase 1 inventory 条目 |
| P2-03 | handoff memo §7 R2 verdict 表 | 15 行 finding（9 storage + 4 binding + 2 optional），每行 4 列：finding ID / Round-1 status / Round-2 verdict / Evidence path | 同 P2-01 | 15 行完整 | grep 15 | 每 evidence path 必须能 `ls` 到文件 |
| P2-04 | handoff memo §8-§10 | §8 Templates Available (点指 D3/D4) / §9 Open Issues at Handoff / §10 Recommended First Phase of Worker Matrix | 同 P2-01 | §9 必须显式列 F03 / F09 gate + 无 B5-B6/B7 未 closed review finding | 人工 review | §9 无遗漏 gate；§10 给 worker matrix 一个具体起步建议 |
| P2-05 | worker naming proposal | 按 P7 §3.2.1 的 4 first-wave 表 + §3.2.2 reserved + §3.2.3 critical distinction | `docs/handoff/next-phase-worker-naming-proposal.md` | 文档以 "**This is a proposal, not a frozen decision**" 开头 | grep | non-binding 标注显式 + agent.core ≠ binding slot 显式 |
| P2-06 | Phase 2 closure | `B8-phase-2-closure.md` | 新文件 | — | — | handoff memo + naming proposal 两份都 ship |

### 4.3 Phase 3 — 2 个 Templates

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P3-01 | wrangler-worker.toml 模板 | 按 P7 §3.3 结构；顶部 comment block 引用 binding-F01 p99=7ms / F08 cap 2.1 MiB / binding-F02 lowercase rule；`durable_objects / kv_namespaces / r2_buckets / d1_databases / services` 都给 placeholder block + 注释 | `docs/templates/wrangler-worker.toml` | 文件存在；comment 密度高 | grep `F01\|F02\|F08\|B7` | 所有 placeholder 带 comment 解释其来源 evidence |
| P3-02 | composition-factory.ts 模板 | 按 P7 §3.4 结构；`import` 块涵盖 `@nano-agent/storage-topology`（R2/Kv/D1/DOStorage adapters）+ `@nano-agent/context-management`（BudgetPolicy / AsyncCompactOrchestrator / InspectorFacade）+ `@nano-agent/capability-runtime`（CapabilityExecutor + LocalTsTarget）+ `@nano-agent/hooks`（HookDispatcher）+ `@nano-agent/nacp-core/nacp-session`（envelope transport）+ `@nano-agent/session-do-runtime`（BoundedEvalSink） | `docs/templates/composition-factory.ts` | 文件 compile-friendly（不是实装，但类型签名无明显错） | `tsc --noEmit` on the file with a throwaway tsconfig | 每个 import 与实际 ship API 对应 |
| P3-03 | Phase 3 closure | `B8-phase-3-closure.md` | 新文件 | — | — | 2 templates ship |

### 4.4 Phase 4 — B8 closure + After-Foundations Final Exit

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P4-01 | B8-final-closure.md | §1 4 deliverables inventory / §2 B1-B7 truth consumed / §3 Open Issues carried over / §4 Handoff readiness checklist / §5 Exit verdict | `docs/issue/after-foundations/B8-final-closure.md` | — | 人工 review | 4 deliverables 都 ship + review verdict = closed |
| P4-02 | after-foundations-final-closure.md | **single-page** 整阶段收口：8 phases verdict、40+ shipped artifacts 目录、15 findings 状态、3 reviews outcome、LIVE deploy inventory、2 open gates、next phase readiness 声明 | `docs/issue/after-foundations/after-foundations-final-closure.md` | — | 人工 review | 一页 + 全部事实可追 |
| P4-03 | 本 action-plan §12 工作日志 | 参照 B5-B7 action-plan 的 §12 模式回填 | `docs/action-plan/after-foundations/B8-worker-matrix-pre-convergence.md`（本文件） | — | grep | §12 存在，涵盖 Phase 1-4 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Truth Inventory + 前置校验

- **Phase 目标**：把 B1-B7 分散在 80+ 文件里的 truth 抓成一份 `B8-phase-1-closure.md` 的单一 spreadsheet。
- **本 Phase 对应编号**：`P1-01 / P1-02 / P1-03 / P1-04 / P1-05 / P1-06`
- **本 Phase 新增文件**：
  - `docs/issue/after-foundations/B8-phase-1-closure.md`（inventory 本身）
- **本 Phase 修改文件**：无
- **具体功能预期**：
  1. 8 shipped 包的 version + CHANGELOG 日期 → `§2 Shipped Packages`
  2. 15 findings Round-1/Round-2 status + gate → `§3 Findings State Transition`
  3. B7 LIVE headline 数字 → `§4 LIVE Platform Numbers`
  4. 3 reviews verdict → `§5 Code Review History`
  5. root tests baseline → `§6 Regression Baseline`
- **具体测试安排**：
  - **单测**：无（doc phase）
  - **集成测试**：无
  - **回归测试**：`node --test test/*.test.mjs` + `npm run test:cross` 跑一次并记录到 §6
  - **手动验证**：每条 inventory entry 必须能 `grep` 或 `cat` 原始文件定位
- **收口标准**：
  - `B8-phase-1-closure.md` 6 个 section 齐全
  - 根测试 baseline 与 B7 closure 的数字一致（77/77 + 91/91）
  - Phase 2 可以**只 cite 这份 inventory** 而不需回溯原始文档
- **本 Phase 风险提醒**：
  - **真相不是"最后一次跑的数字"**——B7 做了两轮 deploy（第一轮有 probe-side bug），P1-03 必须抓的是最新 `.out/*.json` 的数字，且和 `docs/issue/after-foundations/B7-final-closure.md` §3 一致。

### 5.2 Phase 2 — Handoff Memo + Worker Naming Proposal

- **Phase 目标**：产出 handoff memo + worker naming proposal 两份 doc，**全部内容从 Phase 1 inventory cite**。
- **本 Phase 对应编号**：`P2-01 / P2-02 / P2-03 / P2-04 / P2-05 / P2-06`
- **本 Phase 新增文件**：
  - `docs/handoff/after-foundations-to-worker-matrix.md`
  - `docs/handoff/next-phase-worker-naming-proposal.md`
  - `docs/issue/after-foundations/B8-phase-2-closure.md`
- **本 Phase 修改文件**：无
- **具体功能预期**：
  1. handoff memo **10 章节齐全**，与 P7 design §3.1.1 的章节命名严格一致
  2. §2 `What's Validated` 必须含 P7 §3.1.2 规定的 6 handoff findings 表（现在可以填实际 Round-2 verdict，不是 "(filled by P6 Round 2)"）
  3. worker naming proposal 开头一句话 "**This is a proposal. Worker matrix phase may adjust.**"
  4. worker naming proposal §3.2.3 critical distinction（`agent.core ≠ binding slot`）作为独立 subsection
  5. worker naming proposal §3.2.2 `skill.core reserved only` with explicit `charter §12.2` cite
- **具体测试安排**：
  - **单测 / 集成 / 回归**：无（doc phase）
  - **手动验证**：每条 cite 必须指向 Phase 1 inventory 条目；handoff memo §7 verdict 表与 `B7-final-closure.md` §4 完全一致
- **收口标准**：
  - 两份 doc 存在；`grep '^## §' docs/handoff/after-foundations-to-worker-matrix.md` 返回 10 行
  - handoff memo §9 明确列 F03 / F09 gate + B5-B6 review / B7 review 都 closed
  - naming proposal 含 non-binding 声明 + `agent.core ≠ binding slot` distinction
- **本 Phase 风险提醒**：
  - **overclaim 风险**：P7 §3.1.2 允许 "Caveats" 列；如果某 finding 的 Round-2 verdict 是 `still-open` / 只在 local-sim 验证，handoff memo 必须如实写，不能用 "writeback-shipped" 盖过。
  - **P7 §3.2.3 不要省略**：agent.core 是 host 不是 binding 的区分容易在摘要里被丢掉——memo §5 与 proposal §3.2.3 都要显式写。

### 5.3 Phase 3 — 2 个 Templates

- **Phase 目标**：给 worker matrix phase 提供两个 deploy-shaped 模板。
- **本 Phase 对应编号**：`P3-01 / P3-02 / P3-03`
- **本 Phase 新增文件**：
  - `docs/templates/wrangler-worker.toml`
  - `docs/templates/composition-factory.ts`
  - `docs/issue/after-foundations/B8-phase-3-closure.md`
- **本 Phase 修改文件**：无
- **具体功能预期**：
  1. `wrangler-worker.toml` 顶部 20-30 行 comment block 引用 binding-F01 / binding-F02 / F08 三个 B7 LIVE 数字
  2. `wrangler-worker.toml` services 区域列出 `BASH_CORE / FILESYSTEM_CORE / CONTEXT_CORE`，reserved 标注 `SKILL_CORE`
  3. `composition-factory.ts` 对 `agent.core` vs `remote` workers 给出 composition 差异注释（host 需 DO/KV/R2/D1 bindings + services；remote 多数只需 env vars）
  4. `composition-factory.ts` 每个 import 必须指向 shipped package 的 actual export（可用 P1-01 的 version + CHANGELOG 交叉核对）
- **具体测试安排**：
  - **单测**：`tsc --noEmit` on the file（用 throwaway tsconfig 验证 import 类型有效）
  - **集成**：无
  - **手动验证**：每条 comment 的 evidence link 可 `grep`
- **收口标准**：
  - 两份模板 ship
  - wrangler 模板 `jsonc` 语法正确（允许 comment）
  - composition factory tsc 过（允许类型参数 `{/* ... */}` 占位）
- **本 Phase 风险提醒**：
  - **类型签名 drift**：B2-B6 已 ship 的 adapter 构造签名我们在 B7 已经踩过一次坑（R2Adapter.listAll positional / D1Adapter.query not run / LocalTsTarget.registerHandler）——composition factory 模板必须用 **B7 修正后的正确签名**，不是 Round-1 的错版。

### 5.4 Phase 4 — B8 closure + After-Foundations Final Exit

- **Phase 目标**：B8 自身 + 整个 after-foundations 阶段的 single-page 终极收口。
- **本 Phase 对应编号**：`P4-01 / P4-02 / P4-03`
- **本 Phase 新增文件**：
  - `docs/issue/after-foundations/B8-final-closure.md`
  - `docs/issue/after-foundations/after-foundations-final-closure.md`
- **本 Phase 修改文件**：
  - 本 action-plan 底部回填 §12 工作日志
- **具体功能预期**：
  1. `B8-final-closure.md` 含 4 deliverables 的 file paths + B8 phase 结束声明
  2. `after-foundations-final-closure.md` 单页 + 含：
     - 8 phase (B1-B8) verdict 表
     - 40+ shipped artifacts 清单（packages / spike workers / handoff docs / templates）
     - 15 findings state（含 2 open gates）
     - 3 reviews outcome（B5-B6 / B7 / B8 review 的 close 状态）
     - LIVE deploy inventory（3 round-2 workers + their version IDs）
     - next phase (worker matrix) readiness statement
  3. 本 action-plan §12 回填与 B5-B7 同样的模式：phase-by-phase log + artifact inventory + verification + verdict
- **具体测试安排**：
  - **回归**：再跑一次 `node --test test/*.test.mjs` + `npm run test:cross` 作为 "B8 doc work did not regress tests" 的最终确认
- **收口标准**：
  - B8-final-closure + after-foundations-final-closure 两份都 ship
  - 所有内部引用 (`cite` links) 指向现存文件
  - root tests 仍然 77/77 + 91/91
- **本 Phase 风险提醒**：
  - `after-foundations-final-closure.md` 的"next phase readiness statement"不能变成"一切完美"——F03 / F09 两个 gate + B7 review 的 probe-code 修复历史（3 bugs）都必须在终极收口里诚实出现。

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1 — `agent.core` 在 worker matrix phase 究竟是 host worker 还是在某种意义上也有 binding 角色？

- **影响范围**：Phase 2 (worker naming proposal §3.2.3) + Phase 3 (composition factory)
- **为什么必须确认**：P7 §3.2.3 + charter §4.1 H 第 34 项都把 `agent.core = host worker, 不是 binding slot` 写成硬不变量。但 worker matrix phase 可能需要 "agent.core 同时也对其他 worker 提供 hook callback binding" 之类的反向关系。本 B8 的 proposal 如果把这层 totally 排除，worker matrix 可能又要回来 patch。
- **当前建议 / 倾向**：保持 P7 §3.2.3 口径不变——`agent.core` **对外**不提供 service binding（它不是被 host 消费的 remote worker），但它**可能**在内部使用 `reply_to` 之类的回调机制收 hook 结果。这不等同于 "agent.core 是 binding slot"。
- **Q**：B8 的 worker naming proposal 是否需要为 "agent.core 作为 hook callback endpoint" 预留一条 opt-in note？还是完全按 "agent.core ≠ binding slot" 的纯净口径输出？
- **A**：同意你的建议。

#### Q2 — `DOStorageAdapter.maxValueBytes` 从 1 MiB 提到 2 MiB 的 calibration 放 B8 还是 worker matrix？

- **影响范围**：Phase 3 composition factory + worker matrix 首 phase
- **为什么必须确认**：B7 LIVE 证据（F08）给出 DO 硬上限 ≈ 2.1 MiB。shipped `DOStorageAdapter` 默认的 1 MiB 是 B2 conservative default，B7 已证明可以安全提升到 2 MiB（留 ~100 KiB 安全边距）。但 B8 是 doc phase，按规则不改 packages/。如果 worker matrix 首 phase 直接用 composition factory 实装，会需要这个 calibration。
- **当前建议 / 倾向**：保持 1 MiB 到 worker matrix 首 phase，把 "B8 composition factory 注释里记录 `// TODO(worker-matrix): consider raising to 2_097_152 per B7 F08 LIVE evidence`" 作为 handoff 提示即可。Out-of-Scope [O9]。
- **Q**：同意把 maxValueBytes calibration 推到 worker matrix phase / 独立 small PR，而不是 B8 范围？
- **A**：同意你的建议。

#### Q3 — `after-foundations-final-closure.md` 的终极收口是否作为下一 phase 的 "kickoff 权限 token"？

- **影响范围**：Phase 4 + 下一阶段启动
- **为什么必须确认**：B1 final closure 对 B2-B6 起到 gate 作用；B7 final closure 对 B8 起到 gate 作用。`after-foundations-final-closure.md` 是否对 worker matrix phase 起同样作用——即"没这份 closure ship，worker matrix charter 不得启动"？
- **当前建议 / 倾向**：是的。charter §6 Phase 7 + §7.8 实际上就是这么要求的。
- **Q**：确认 `after-foundations-final-closure.md` ship 之后，worker matrix charter 设计工作才可以启动？
- **A**：同意你的建议。

#### Q4 — B8 是否允许为 F03 / F09 两个 gate 编写 "future rerun checklist" 放进 handoff memo §9？

- **影响范围**：Phase 2 handoff memo §9
- **为什么必须确认**：out-of-scope [O8] 明确说 B8 不写 gate 打开后的新 probe 代码。但 handoff memo §9 可以列出 "owner 打开 gate 需要的步骤 checklist"（provision a cross-colo profile / supply a URL / rerun `scripts/run-all-probes.sh` / 更新 finding §9）——这仍是 doc 工作。
- **当前建议 / 倾向**：允许。§9 里列 owner-side rerun checklist 有价值；B8 本身仍然不碰 probe 代码。
- **Q**：handoff memo §9 可以含 owner-side rerun checklist？
- **A**：同意你的建议。

### 6.2 问题整理建议

- 优先问 Q1（影响 proposal 语义）+ Q3（影响下一阶段 kickoff 权限）
- Q2 / Q4 可以按"当前建议"默认执行，业主事后否决再回滚

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|---|---|---|---|
| truth drift during Phase 1 | Phase 1 抓 inventory 时 B7 closure 的某些数字已被其他会话偷偷改动 | `low` | Phase 1 末尾做 `git log --oneline -- docs/issue/after-foundations/B7-final-closure.md` 确认 B7 closure commit hash 稳定 |
| handoff memo 章节遗漏 | P7 §3.1.1 规定 10 章节，但实施时可能漏掉某一章 | `medium` | Phase 2 起步先建 10 个空 heading，再逐个填；grep 验证 |
| composition factory 类型 drift | B2-B6 ship API 和我脑中的模型有偏差（B7 踩过 3 次坑） | `medium` | P3-02 每个 import 对照 `packages/*/dist/index.d.ts` 的真实 export；写完跑一次 `tsc --noEmit` |
| overclaim "closed-with-evidence" | 把还未打开的 F03/F09 盖过去 | `medium` | Phase 2 §9 + Phase 4 after-foundations-final-closure 都专列 gate subsection |
| root tests 意外变红 | B8 理论上不改任何代码，但若不小心 cd 错目录 git add 错文件会出问题 | `low` | Phase 1 P1-05 baseline + Phase 4 regression re-run 两道防线 |
| proposal 被误读成 freeze | worker matrix charter 作者把 B8 naming proposal 当冻结决策 | `medium` | naming proposal 开头第一句话 "**This is a proposal. Worker matrix phase may adjust.**" + memo §5 cross-cite 同一警示 |

### 7.2 约束与前提

- **技术前提**：
  - B7 `B7-final-closure.md` 已 ship，且其 §3 / §4 已含所有 LIVE 数字（**已确认**：B7 closure 2026-04-20 LIVE deploy 完成）
  - 3 份 code reviews（B5-B6 / B7 / 本 B8 不会有 review 因为是 handoff phase）都 closed with findings addressed
  - `pnpm-workspace.yaml` 和 `packages/` 目录结构稳定
- **运行时前提**：无（B8 不运行任何 worker）
- **组织协作前提**：业主确认 Q1 / Q3（见 §6）；Q2 / Q4 有默认倾向可 proceed
- **上线 / 合并前提**：无（文档 commit 可单独 PR）

### 7.3 文档同步要求

- 需要同步更新的设计文档：无（P7 design 冻结；不改）
- 需要同步更新的说明文档：
  - `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md`：在 Phase 4 结束时添加一行"B8 consumed this plan's LIVE evidence in `docs/handoff/after-foundations-to-worker-matrix.md` §2 / §7"（cross-reference only, no content change）
- 需要同步更新的测试说明：无

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 4 deliverables 文件存在：`ls docs/handoff/* docs/templates/wrangler-worker.toml docs/templates/composition-factory.ts`
  - 4 closure issues 存在：`ls docs/issue/after-foundations/B8-*.md docs/issue/after-foundations/after-foundations-final-closure.md`
  - `grep -l '{[A-Z_]*}' docs/handoff/*.md docs/templates/*` 必须为空（不能残留模板占位符如 `{PHASE_NAME}`）
- **单元测试**：无（doc phase）
- **集成测试**：无
- **端到端 / 手动验证**：
  - 按 handoff memo §5 可以 `ls` 到 proposal 文件
  - 按 memo §8 可以 `ls` 到 2 个 template 文件
  - 按 memo §7 的每行 evidence path 都可以 `ls`
- **回归测试**：
  - `node --test test/*.test.mjs` → 77/77
  - `npm run test:cross` → 91/91
  - 两次（Phase 1 P1-05 + Phase 4 P4-03）数字一致
- **文档校验**：
  - `grep '^## §' docs/handoff/after-foundations-to-worker-matrix.md | wc -l` → 10（§1-§10）
  - `grep -c 'proposal\|not a frozen\|not binding' docs/handoff/next-phase-worker-naming-proposal.md` ≥ 2

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后：

1. **`docs/handoff/after-foundations-to-worker-matrix.md`** ship，10 章节齐全，§7 15-finding verdict 表完整
2. **`docs/handoff/next-phase-worker-naming-proposal.md`** ship，4 first-wave + 1 reserved，non-binding 声明显式
3. **`docs/templates/wrangler-worker.toml`** ship，comment block 含 binding-F01 / F02 / F08 三项 B7 LIVE evidence
4. **`docs/templates/composition-factory.ts`** ship，`tsc --noEmit` 通过
5. **B8-phase-1/2/3-closure.md + B8-final-closure.md** 四份 closure issues 齐全
6. **`after-foundations-final-closure.md`** 单页整阶段终极收口 ship
7. **`packages/` + `spikes/` 目录 zero modification**（`git diff` 验证）
8. root tests **77/77 + 91/91** 保持
9. handoff memo §9 列出 F03 / F09 两个 gate + B5-B6 / B7 review 皆已 closed
10. 本 action-plan §12 工作日志回填完成

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|---|---|
| 功能 | 4 deliverables + 5 closure issues 全部 ship；every fact 可追 |
| 测试 | root tests 仍 77/77 + 91/91；无新增测试也无 regression |
| 文档 | handoff memo 10 章节齐全；naming proposal non-binding 显式；2 templates comment 带 B7 LIVE evidence |
| 风险收敛 | Q1 / Q3 已 answered；Q2 / Q4 按默认执行或业主 opt-in 变更 |
| 可交付性 | 下一阶段（worker matrix）charter 撰写者可以 **仅** 读 `after-foundations-final-closure.md` + handoff memo 即开始工作 |

---

## 9. 执行后复盘关注点

> 执行结束后回填。

- **哪些 Phase 的工作量估计偏差最大**：`Phase 1 + Phase 3`。Phase 1 因为 truth 分散在 B1/B7 closure、reviews、raw .out 与 package reality；Phase 3 因为需要额外做一次 throwaway path-mapped `tsconfig` 来把 workspace module resolution 与真实 API drift 分开。
- **哪些编号的拆分还不够合理**：`P1-03/P1-04` 与 `P2-03/P2-04` 还有一点耦合。事实表明“抓 LIVE 数字 / 抓 review posture / 把它们转成 handoff verdict matrix”几乎是一个连续动作，而不是完全独立的四块。
- **handoff memo 的章节结构是否实际用起来顺手**：`是`。10-section 结构把 validated findings、命名提议、binding evolution policy、open issues、first-phase recommendation 清楚拆开，适合作为 worker-matrix kickoff memo。
- **worker naming proposal 是否被后续 worker matrix phase 接受**：`B8 内无法验证`。本轮已通过开头 warning + 文内 6 处 non-binding 提示 + `agent.core ≠ binding slot` 显式强调，尽量降低被误读成 freeze 的风险。
- **templates 是否真的被 worker matrix 首 phase 直接消费**：`B8 内无法验证`。当前只能确认两份模板已成形、无 placeholder、composition template 经 path-mapped `tsc` 校过；真实 adoption 取决于 worker-matrix phase 的实现策略。

---

## 10. 结语

这份 action-plan 以 **"诚实、完整、可追"** 为第一优先级，采用 **"truth inventory → handoff memo → templates → terminal closure"** 的四段式推进，优先解决 **把 B1-B7 八个 phase 分散的 truth 汇总成下一 phase 可直接消费的 readiness package**，并把 **"不修改 packages/ + 不越权决策 worker matrix"** 作为主要约束。

整个计划完成后，`after-foundations` 阶段将达到**一页终极收口 + 4 份 handoff deliverables** 的可交付性状态，从而为后续的 **worker matrix charter + first-wave worker shells** 提供不再需要倒推 B1-B7 的稳定基础。

**B8 不创造新 truth；它让 B1-B7 的 truth 变得可消费**——这是它唯一且充分的价值。

---

## 11. 关闭前提醒

- B8 的价值不在于"写出漂亮的 doc"，而在于**让下一阶段的 charter 作者只读一份文档就能起步**
- 如果 Phase 1 inventory 抓不齐，Phase 2/3 就不应启动；宁可多花 30 分钟在 inventory，也不要让 handoff memo 里出现"模糊引用"
- `naming proposal` 是 **proposal**，不是 freeze；即便 Q1 业主说 "按你建议来"，文档本身也必须保留 non-binding 声明
- F03 / F09 两个 gate 是 **诚实的 open issues**，不能在整阶段收口时被"四舍五入"掉——handoff memo §9 + after-foundations-final-closure 的 open issues 列表都必须显式列出
- B7 review response 里暴露了 3 个 probe-side bugs 被我自己写错的教训——B8 composition factory 模板的类型签名必须以 **B7 修正后的事实** 为准，而非 B7 最初的错版
- B8 完成后，after-foundations 阶段**正式结束**；worker matrix charter 撰写工作才可以启动

---

## 12. GPT-5.4 执行记录、事实回填与收口意见（2026-04-20）

### 12.1 本轮实际执行范围

本轮执行严格按 B8 的 doc-only 边界推进：

1. **只新增 / 修改 `docs/**` 与 session 临时验证文件**；
2. **不修改 `packages/**`**；
3. **不修改 `spikes/**` 探针实现**；
4. **不改 package version / CHANGELOG / shipped code**。

### 12.2 实际完成的工作

#### A. Truth inventory（Phase 1）

我先把 B8 所需的事实重新 pin 成单一 truth source：

1. 新建 `docs/issue/after-foundations/B8-phase-1-closure.md`。
2. 逐项核对 9 个 shipped package 的 `package.json` / `CHANGELOG` reality，并保留 mismatch（如 `eval-observability`、`session-do-runtime` changelog head 高于 package version；`capability-runtime` 无 package-local changelog）。
3. 用当前 B7 raw `.out` 重新 pin LIVE 数字，而不是直接继承较早 review 叙事：
   - F08：`2,199,424` last-good / `2,200,000` first-TOOBIG / width `576` / `14` steps
   - R2 并发曲线：`10→336/530/530`、`50→1310/2396/2396`、`100→2216/4371/4371`、`200→4383/8491/8512`
   - binding-F04：`duplicateDropCount=3`、`capacityOverflowCount=5`、`disclosure.count=8`
   - binding-F01：`callerAbortObserved=true`，`abortAfterMs=300`
   - binding-F02/F03 smoke：header keys lowercased；latency smoke `sampleCount=5`, `min=max=10ms`
4. 把 B1/B7 finding 状态重新收敛为 `11 shipped + 2 dismissed + 2 still-open gates`。
5. 重跑根测试并把 baseline pin 到 inventory：`node --test test/*.test.mjs` = **77/77**，`npm run test:cross` = **91/91**。

#### B. Handoff memo + naming proposal（Phase 2）

我随后完成并复核了：

1. `docs/handoff/after-foundations-to-worker-matrix.md`
2. `docs/handoff/next-phase-worker-naming-proposal.md`
3. `docs/issue/after-foundations/B8-phase-2-closure.md`

这一阶段明确完成了：

- 10-section handoff memo；
- non-binding naming proposal；
- `agent.core ≠ binding slot` 作为独立关键区分；
- `F03 / F09` 作为 open gates 持续保留；
- 历史 review 仅作为“历史 verdict”消费，不再覆盖当前 raw evidence truth。

#### C. Starter templates（Phase 3）

我完成并复核了：

1. `docs/templates/wrangler-worker.toml`
2. `docs/templates/composition-factory.ts`
3. `docs/issue/after-foundations/B8-phase-3-closure.md`

其中 `composition-factory.ts` 的关键做法是：

- 只引用当前仓内真实存在的 `@nano-agent/*` shipped package names；
- 再按实际 public export / constructor signature 校到可通过 `tsc`；
- 明确把 `agent.core`、bounded eval sink、lowercase header law、2 MiB planning default 等约束写进 comments，而不是让 worker-matrix phase 重新考古。

#### D. Final closure（Phase 4）

我完成并复核了：

1. `docs/issue/after-foundations/B8-final-closure.md`
2. `docs/issue/after-foundations/after-foundations-final-closure.md`
3. 本文件 `§9` retrospective 回填
4. 本文件 `§12` 工作日志与收口意见
5. `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md` 的一条 cross-reference only 同步说明

### 12.3 本轮实际新增 / 修改的交付物

| 类型 | 文件 |
|---|---|
| phase closure | `docs/issue/after-foundations/B8-phase-1-closure.md` |
| phase closure | `docs/issue/after-foundations/B8-phase-2-closure.md` |
| phase closure | `docs/issue/after-foundations/B8-phase-3-closure.md` |
| final closure | `docs/issue/after-foundations/B8-final-closure.md` |
| terminal closure | `docs/issue/after-foundations/after-foundations-final-closure.md` |
| handoff | `docs/handoff/after-foundations-to-worker-matrix.md` |
| handoff | `docs/handoff/next-phase-worker-naming-proposal.md` |
| template | `docs/templates/wrangler-worker.toml` |
| template | `docs/templates/composition-factory.ts` |
| sync note | `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md` |
| action-plan backfill | `docs/action-plan/after-foundations/B8-worker-matrix-pre-convergence.md` |

### 12.4 本轮实际验证结果

| 检查项 | 结果 |
|---|---|
| `ls docs/handoff/* docs/templates/wrangler-worker.toml docs/templates/composition-factory.ts` | 通过 |
| `ls docs/issue/after-foundations/B8-*.md docs/issue/after-foundations/after-foundations-final-closure.md` | 通过 |
| `grep '^## §' docs/handoff/after-foundations-to-worker-matrix.md \| wc -l` | `10` |
| `grep -ciE 'proposal\|not a frozen\|not binding' docs/handoff/next-phase-worker-naming-proposal.md` | `6` |
| placeholder grep（仅针对 B8 handoff/template 新文件） | 空 |
| `node_modules/.pnpm/node_modules/.bin/tsc -p /root/.copilot/session-state/592cb120-8b05-4ffb-8229-199bb74fd46a/files/b8-template-tsconfig.json` | 通过 |
| `git --no-pager diff -- packages spikes` | 空 |
| `node --test test/*.test.mjs` | **77/77** |
| `npm run test:cross` | **91/91** |

### 12.5 与原计划相比的一个实际调整

`§8.1` 原草案里的 placeholder grep 写成了 `docs/templates/*` 全量扫描；实际执行时这个范围会扫到 pre-existing legacy template files，因此不能作为 B8 新交付物的干净判据。

所以本轮实际采用的是：

- **只针对 B8 新增的 2 个 handoff 文件 + 2 个 template 文件做 placeholder grep**。

这是验证方法收窄，不是范围缩水；它避免把历史遗留模板噪音误判成 B8 未完成。

### 12.6 收口意见

我的收口判断是：

> **B8 可以正式关闭，after-foundations 可以正式结束，worker-matrix charter 可以立刻启动。**

理由只有三条，但都已被事实支撑：

1. **B8 没有发明新 truth**：它只是把 B1-B7 的分散 truth 收束成 inventory / memo / templates / closure pack。
2. **B8 保持了诚实边界**：`F03 / F09` 两个 gate 仍显式开放；`agent.core ≠ binding slot` 没被偷换；naming proposal 也明确保持 non-binding。
3. **B8 完成了 handoff 责任**：下一阶段不再需要倒翻 B1-B7 全部 closure / review / `.out` 证据，已经可以从 handoff pack 直接起步。

因此本阶段的最终 verdict 是：

**✅ B8 closed. Ready for worker-matrix charter.**
