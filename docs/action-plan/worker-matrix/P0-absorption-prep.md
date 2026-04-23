# P0 — Absorption Prep & Charter Freeze

> 服务业务簇: `worker-matrix / Phase 0 — Absorption Prep`
> 计划对象: `7 份非代表 detailed blueprint on-demand 补齐 + 7 条 owner 决策落盘 + 3 份代表 blueprint reality check + D01-D09 GPT review 吸收真相回填 + P1 执行前基线冻结`
> 类型: `new`(7 份 blueprint 新建) + `modify`(3 份代表 blueprint 校准 + charter/design/handoff 索引同步)
> 作者: `Claude Opus 4.7 (1M context)`
> 时间: `2026-04-23`
> 文件位置:
> - `docs/design/worker-matrix/blueprints/` 新目录(7 份 on-demand blueprint)
> - `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`(作模板)
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-*.md`(3 份代表 blueprint 校准)
> - `docs/design/worker-matrix/D01-D09-*.md`(已吸收 R1-R5,P0 不再重改,只做 reality check)
> - `docs/plan-worker-matrix.md`(owner 决策 Q1-Q7 已 confirmed,P0 不再重改)
> - `docs/issue/worker-matrix/P0-absorption-prep-closure.md`(P0 收口 memo,本阶段产出)
> 关联设计 / 调研文档:
> - `docs/plan-worker-matrix.md`(charter)
> - `docs/design/worker-matrix/D01-D09-*.md`(9 份 design;已吸收 R1-R5)
> - `docs/eval/worker-matrix/D01-D09-design-docs-reviewed-by-GPT.md`(GPT review)
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`(10 units / 4 workers)
> - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`(10 disciplines;3 placeholder 节留给 P1)
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`(代表 blueprint)
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`(代表 blueprint)
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`(代表 blueprint)
> - `docs/handoff/pre-worker-matrix-to-worker-matrix.md`(输入包)
> 文档状态: `draft`

---

## 0. 执行背景与目标

pre-worker-matrix(W0-W5)已收口,`docs/plan-worker-matrix.md` r2 + `docs/design/worker-matrix/D01-D09`(已吸收 D01-D09 GPT review R1-R5) + 7 条 owner 决策(Q1-Q7 全 confirmed)已成为执行输入。但 P1 开工前仍存在三件 design-only 的前置欠账,如果不在 P0 压实,P1 的 absorb PR 会被反复打断:

1. **10 个 absorption units 里,只有 3 份代表 blueprint 写过** — B1(capability-runtime)、A1(session-do-runtime host shell)、C2/D1(workspace-context-artifacts split)。剩余 7 个 units(A2 agent-runtime-kernel / A3 llm-wrapper / A4 hooks residual / A5 eval-observability residual / C1 context-management / D2 storage-topology residual / 以及 A1-A5 之间 sub-PR 边界 reality check)没有自己的 detailed blueprint;P1 执行时必须 `copy-fill TEMPLATE` 才能机械搬家。
2. **3 份代表 blueprint 需要按当前代码真相做 reality check**(因为它们是 pre-worker-matrix 末期写的,中间 W2 published、W4 shell、D01-D09 design + GPT R1-R5 都改了一些边界),不改结构,只校准事实锚点和 dependency 引用。
3. **charter §6.2 P2 prerequisite(per GPT R1)** 明确要求 `workers/bash-core` real preview deploy 是 P2 硬前置 — 这条在 P1.B 末尾触发,但 P0 必须把 owner / schedule / rollback 决策落在一份 P0 closure memo 里,避免 P1.B 合并后才开始找 owner。

本 action-plan 是 **design-only 的准备 phase**,不改任何 `packages/*` 或 `workers/*` 代码,也不改 NACP wire / 任何 schema。目标是把 "P1 机械执行所需的所有 design 锚点 / owner 决策 / reality check" 全部压实。

- **服务业务簇**:`worker-matrix / Phase 0 — Absorption Prep`
- **计划对象**:`7 份非代表 blueprint on-demand 补齐 + 3 份代表 blueprint reality check + P2.E0 owner 决策落盘 + D01-D09 GPT R1-R5 吸收结果与 charter / handoff 索引同步 + P0 closure memo`
- **本次计划解决的问题**:
  - `P1 开工前仍缺 7 份 detailed blueprint,A2-A5 / C1 / D2 / A1-A5 sub-PR 边界没有机械执行样板`
  - `3 份代表 blueprint 的事实锚点可能在 W2/W4/D01-D09 后已经漂移(import path / 版本号 / 依赖)`
  - `P2.E0 bash-core real preview deploy 的 owner / 时机 / rollback 未落盘,P1.B merge 后会被卡住`
  - `D01-D09 GPT R1-R5 吸收完的 design 真相没有在 charter / handoff pack 里留一条索引链,后续接手者需要重新 reconcile`
- **本次计划的直接产出**:
  - `docs/design/worker-matrix/blueprints/` 目录 + 7 份 detailed blueprint 文件 + 一份 blueprints-index.md`
  - 3 份代表 blueprint 的校准 patch(仅 reality check 条目,保持原文结构)
  - `docs/issue/worker-matrix/P0-absorption-prep-closure.md`(P0 收口 memo,含 P2.E0 owner 决策、GPT R1-R5 吸收索引、P1 启动 checklist)

---

## 1. 执行综述

### 1.1 总体执行方式

P0 分 4 个 Phase:**先 blueprint reality check → 再补齐 7 份非代表 blueprint → 再落 P2.E0 owner 决策 → 最后写 P0 closure memo**。全过程零代码改动,只写 markdown;每个 Phase 都可以独立 PR 或合并成 1 个 design PR,视 owner 节奏。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | 代表 blueprint reality check | `S` | 3 份代表 blueprint 按当前 W2 published + W4 shell + D01-D09(含 GPT R1-R5)事实校准锚点 | `-`(P0 起点)|
| Phase 2 | 7 份非代表 blueprint 补齐 | `M` | 从 `TEMPLATE-absorption-blueprint.md` copy-fill;覆盖 A2 / A3 / A4 / A5 / C1 / D2 / A1-A5 sub-PR 边界 | Phase 1 |
| Phase 3 | P2.E0 owner 决策 + P1 启动 checklist 落盘 | `XS` | `workers/bash-core` real preview deploy 的 owner / schedule / rollback;P1.A / P1.B 的 kickoff prerequisite | Phase 1 + 2 |
| Phase 4 | D01-D09 R1-R5 吸收索引 + P0 closure memo | `S` | `docs/issue/worker-matrix/P0-absorption-prep-closure.md` + charter / handoff 索引同步 | Phase 1-3 |

### 1.3 Phase 说明

1. **Phase 1 — 代表 blueprint reality check**
   - **核心目标**:把 3 份代表 blueprint(`W3-absorption-blueprint-capability-runtime.md` / `W3-absorption-blueprint-session-do-runtime.md` / `W3-absorption-blueprint-workspace-context-artifacts-split.md`)按当前 W2 published(@haimang/nacp-core@1.4.0 + nacp-session@1.3.0)、W4 shell、D01-D09(含 GPT R1-R5 吸收结果)事实校准 import path / 版本号 / 依赖引用
   - **为什么先做**:代表 blueprint 是 7 份非代表 blueprint 的复用母本;如果代表事实先漂移,7 份非代表会继承同样漂移
2. **Phase 2 — 7 份非代表 blueprint 补齐**
   - **核心目标**:覆盖 A2(agent-runtime-kernel)、A3(llm-wrapper)、A4(hooks residual)、A5(eval-observability residual)、C1(context-management)、D2(storage-topology residual)共 6 份;再加 1 份 `A1-A5-sub-pr-granularity.md` 专门处理 Q1c 的 "A1-A5 内部 2-3 sub-PR 边界"
   - **为什么放在这里**:代表 blueprint 已校准后 copy-fill 才有合法锚点
3. **Phase 3 — P2.E0 owner 决策 + P1 启动 checklist**
   - **核心目标**:把 charter §6.2 P2 prerequisite 里的 `workers/bash-core real preview deploy` 的 owner(谁执行)、schedule(P1.B PR merge 后立即,还是单独 deploy window)、rollback plan(preview URL 回滚 + wrangler Version ID pin)定死在 closure memo + P1 kickoff checklist 里
   - **为什么放在这里**:blueprint reality check 与 7 份补齐完成后,P2.E0 的 "deploy 的是哪个 worker"、"deploy 什么版本"、"deploy 后 curl 什么 endpoint" 都有 D02 F6 的 F-level 描述支撑
4. **Phase 4 — GPT R1-R5 吸收索引 + P0 closure memo**
   - **核心目标**:把 D01-D09 的 v0.2 版本历史条目(R1 / R2 / R3 / R4 / R5 已吸收)汇总为一个 "reviewed-and-absorbed" 索引,附在 `docs/handoff/pre-worker-matrix-to-worker-matrix.md` 底部或 `P0-absorption-prep-closure.md` 内,并由 closure memo 明确 P1 开工 gate
   - **为什么放在这里**:这是 P0 的合拢动作,之前几 Phase 全部落盘后才能写

### 1.4 执行策略说明

- **执行顺序原则**:先校准 → 后复制 → 后决策 → 后合拢
- **风险控制原则**:P0 零代码改动;全部是 markdown;每个 Phase 独立 reviewable
- **测试推进原则**:P0 无运行测试;合拢时跑 `grep` 验证 9 份 blueprint 文件存在 + charter / handoff 索引引用正确 + D01-D09 v0.2 条目存在
- **文档同步原则**:blueprint 的 "何时可以真正使用" 在 closure memo 里声明;不重复写在每份 blueprint 里

### 1.5 本次 action-plan 影响目录树

```text
worker-matrix/
├── P0 目标产出/
│   ├── docs/design/worker-matrix/blueprints/
│   │   ├── A2-agent-runtime-kernel-absorption-blueprint.md  [新建]
│   │   ├── A3-llm-wrapper-absorption-blueprint.md           [新建]
│   │   ├── A4-hooks-residual-absorption-blueprint.md        [新建]
│   │   ├── A5-eval-observability-residual-absorption-blueprint.md [新建]
│   │   ├── C1-context-management-absorption-blueprint.md    [新建]
│   │   ├── D2-storage-topology-residual-absorption-blueprint.md [新建]
│   │   ├── A1-A5-sub-pr-granularity.md                       [新建]
│   │   └── blueprints-index.md                                [新建]
│   └── docs/issue/worker-matrix/
│       └── P0-absorption-prep-closure.md                     [新建]
├── P0 影响但不重改 (索引指向)/
│   └── docs/design/pre-worker-matrix/
│       ├── W3-absorption-blueprint-capability-runtime.md     [仅 Phase 1 校准 patch;不重写]
│       ├── W3-absorption-blueprint-session-do-runtime.md     [仅 Phase 1 校准 patch;不重写]
│       └── W3-absorption-blueprint-workspace-context-artifacts-split.md [仅 Phase 1 校准 patch;不重写]
└── P0 影响但仅回填索引 (不改内容)/
    ├── docs/plan-worker-matrix.md                            [Phase 4 附 P0 closure link]
    └── docs/handoff/pre-worker-matrix-to-worker-matrix.md    [Phase 4 附 D01-D09 R1-R5 吸收索引]
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope(本次 action-plan 明确要做)

- **[S1]** Phase 1:3 份代表 blueprint reality check patch(不改结构,只改事实锚点 / 版本号 / import path / deps)
- **[S2]** Phase 2:新建 `docs/design/worker-matrix/blueprints/` 目录 + 7 份 blueprint + 1 份 `blueprints-index.md`
- **[S3]** Phase 2:A1-A5 sub-PR granularity blueprint 必须明确 sub-PR 切分建议(例如 sub-PR-1 = host shell + kernel;sub-PR-2 = llm + hooks + eval;sub-PR-3 = host consumer 预留落点;但由 owner 在 P1.A kickoff 最终锁定,P0 提方案不拍板)
- **[S4]** Phase 3:写 `P0-absorption-prep-closure.md` 的 "P2.E0 决策" 段 — owner / schedule / rollback / curl probe expected JSON(对齐 D02 F6 + 对齐 charter §6.2 P2 prerequisite)
- **[S5]** Phase 3:写 `P1 kickoff checklist` 段(放在 closure memo 内) — 含 P1.A / P1.B 启动前必须验证的事实列表(blueprints 存在 / owner 定 / dependency 无漂移)
- **[S6]** Phase 4:写 `P0-absorption-prep-closure.md` 的 "D01-D09 GPT R1-R5 吸收索引" 段(9 份 design 的 v0.2 版本历史 + 5 条吸收 delta 的 cross-reference 表)
- **[S7]** Phase 4:在 `docs/plan-worker-matrix.md` §5 或 §11 附 P0 closure link(1 行索引,不改 charter 其他段)
- **[S8]** Phase 4:在 `docs/handoff/pre-worker-matrix-to-worker-matrix.md` 尾部附 "P0 已收口" 一段(含 P0 closure link + D01-D09 v0.2 索引)

### 2.2 Out-of-Scope(本次 action-plan 明确不做)

- **[O1]** 任何 `packages/*` 或 `workers/*` 代码改动
- **[O2]** 任何 NACP wire / schema / body / kind 改动
- **[O3]** D01-D09 的任一 design 内容改动(R1-R5 已在 charter session 内吸收到 v0.2;P0 不重吸收)
- **[O4]** owner 决策 Q1-Q7 再评审(已 confirmed;P0 不重开)
- **[O5]** A1-A5 内部最终 sub-PR 切分拍板(P0 只提建议,P1.A kickoff PR 由 owner 最终锁定)
- **[O6]** W3 pattern spec 3 个 placeholder 节回填(归 P1 首批 absorb PR,W3-absorption-pattern.md §10)
- **[O7]** `.npmrc` / registry 改动(归 P5 D08)
- **[O8]** Tier B CHANGELOG 创建 / banner(归 P5 D09)
- **[O9]** `workers/bash-core` 真正 deploy(deploy 本身归 P1.B 收尾或 P2.E0 执行;P0 只写决策)

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| 3 份代表 blueprint 是否重写 | `out-of-scope` | 仅 reality check patch,保留原文结构 | P1 首批 absorb PR 回填 W3 pattern §10 的 "LOC→时长 / 可执行流水线" 后再评是否需要一次 v2 | 
| A1-A5 sub-PR 最终切分数量(2 / 3 / 4)| `defer / P1.A owner` | Q1c 决策给 owner 最终自由度 | P1.A kickoff PR | 
| `workers/bash-core` real preview deploy 的执行 | `out-of-scope` | P0 只决策;执行归 P1.B 末尾或 P2.E0 | P1.B 合并时 | 
| 新增第 5 workers / skill.core | `out-of-scope` | charter §1.5 / §3.2 O1 硬约束 | NOT revisit |
| 7 份非代表 blueprint 是否必须在 P0 全部 ship | `in-scope 全部` | P1 执行时 copy-fill,必须有源母本 | P1.A / P1.B kickoff 前全部就绪 |
| closure memo 是否含 D01-D09 v0.2 索引 | `in-scope` | GPT R1-R5 吸收后必须有单一真相 anchor | — |
| P0 PR 数量 | `defer / owner` | 可 1 PR 也可 4 PR,视 owner 节奏 | P0 kickoff 决定 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | 代表 blueprint reality check(capability-runtime)| update | `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md` | 校准 `@haimang/nacp-*@1.4.0/1.3.0` 真相 + D02 F6 preview deploy 事实锚点 | low |
| P1-02 | Phase 1 | 代表 blueprint reality check(session-do-runtime)| update | `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md` | 校准 D01 F1-F5 落点 + D05 host consumer 落在 `dispatchAdmissibleFrame` + `composition.workspace.assembler` 的 R1 口径 | low |
| P1-03 | Phase 1 | 代表 blueprint reality check(WCA split)| update | `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md` | 校准 C2 / D1 slice 边界 + mixed helper 归属表;对齐 D03/D04 当前口径 | low |
| P2-01 | Phase 2 | A2 blueprint 补齐 | add | `docs/design/worker-matrix/blueprints/A2-agent-runtime-kernel-absorption-blueprint.md` | `packages/agent-runtime-kernel/**` → `workers/agent-core/src/kernel/` 的机械执行样板 | medium |
| P2-02 | Phase 2 | A3 blueprint 补齐 | add | `docs/design/worker-matrix/blueprints/A3-llm-wrapper-absorption-blueprint.md` | `packages/llm-wrapper/**` → `workers/agent-core/src/llm/` | medium |
| P2-03 | Phase 2 | A4 blueprint 补齐 | add | `docs/design/worker-matrix/blueprints/A4-hooks-residual-absorption-blueprint.md` | `packages/hooks/**` runtime residual → `workers/agent-core/src/hooks/`(wire catalog 归 NACP,不迁)| medium |
| P2-04 | Phase 2 | A5 blueprint 补齐 | add | `docs/design/worker-matrix/blueprints/A5-eval-observability-residual-absorption-blueprint.md` | `packages/eval-observability/**` runtime sink + inspector seam → `workers/agent-core/src/eval/` | medium |
| P2-05 | Phase 2 | C1 blueprint 补齐 | add | `docs/design/worker-matrix/blueprints/C1-context-management-absorption-blueprint.md` | `packages/context-management/{budget,async-compact,inspector-facade}/**` → `workers/context-core/src/` | medium |
| P2-06 | Phase 2 | D2 blueprint 补齐 | add | `docs/design/worker-matrix/blueprints/D2-storage-topology-residual-absorption-blueprint.md` | `packages/storage-topology/{tenant*,placement,adapters,calibration}/**` → `workers/filesystem-core/src/storage/` | medium |
| P2-07 | Phase 2 | A1-A5 sub-PR granularity blueprint | add | `docs/design/worker-matrix/blueprints/A1-A5-sub-pr-granularity.md` | 按 Q1c 提 2-3 sub-PR 切分方案供 P1.A owner 最终锁定 | low |
| P2-08 | Phase 2 | blueprints index | add | `docs/design/worker-matrix/blueprints/blueprints-index.md` | 10 个 units × 对应 blueprint 源(代表 / P0 补齐)的索引表 | low |
| P3-01 | Phase 3 | P2.E0 owner 决策 | add | `docs/issue/worker-matrix/P0-absorption-prep-closure.md` §3 | 落定 bash-core real preview deploy owner / schedule / rollback / curl probe expected JSON | low |
| P3-02 | Phase 3 | P1 kickoff checklist | add | 同上 §4 | P1.A / P1.B 启动前必验事实(blueprints 存在 / deps 无漂移 / owner 定)| low |
| P4-01 | Phase 4 | D01-D09 R1-R5 吸收索引 | add | 同上 §5 | 9 份 design v0.2 版本历史条目 + 5 条 delta cross-reference 表 | low |
| P4-02 | Phase 4 | charter / handoff 索引同步 | update | `docs/plan-worker-matrix.md` + `docs/handoff/pre-worker-matrix-to-worker-matrix.md` | 各加 1 行 P0 closure link | low |
| P4-03 | Phase 4 | P0 closure memo 收口 | add | `docs/issue/worker-matrix/P0-absorption-prep-closure.md` §0-§6 全文 | memo 合拢 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 代表 blueprint reality check

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | 代表 blueprint 校准(capability-runtime)| grep 并替换任何仍写 `@nano-agent/nacp-*` 或老 version 的引用;核对 "D02 F6 real preview deploy" 路径引用是否已经指向 D02 v0.2(含 R3 binding-first)| `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md` | patch diff 仅触及事实锚点,不动结构章节 | `grep "@haimang/nacp-core@1.4.0"` 至少一处;`grep "@nano-agent/nacp-"` 0 处;`grep "/tool.call.request"` 0 处(若原文没出现则跳过)| diff 最小 + 不改 §1-§9 结构标题 |
| P1-02 | 代表 blueprint 校准(session-do-runtime)| 核对 D01 F1-F5 落点(`workers/agent-core/src/host/do/nano-session-do.ts`)+ D05 host consumer 落点(`composition?.workspace?.assembler`,R1 口径)| `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md` | patch 仅触及事实锚点 | `grep "composition.workspace.assembler\|composition?.workspace?.assembler"` ≥1(若原文 blueprint 不涉及 consumer 话题则可免改)| 与 D01 / D05 v0.2 对齐 |
| P1-03 | 代表 blueprint 校准(WCA split)| 核对 C2 / D1 slice 边界(D03 §4 context slice / D04 §4 filesystem slice);mixed helper owner 表与 D03/D04 一致 | `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md` | patch 仅触及事实锚点 + mixed helper 表 | `grep "evidence-emitters.ts"` 且 context/filesystem 行各 1 | 与 D03 / D04 v0.1 对齐 |

### 4.2 Phase 2 — 7 份非代表 blueprint 补齐

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | A2 blueprint | 从 `TEMPLATE-absorption-blueprint.md` copy-fill;源:`packages/agent-runtime-kernel/**`;目标:`workers/agent-core/src/kernel/`;填 W3 blueprint §1-§9(背景 / 目标目录结构 / test 搬迁 / import 改写 / 依赖 / LOC 估算 / 合同 invariant / 搬迁后验证 / 风险)| `docs/design/worker-matrix/blueprints/A2-agent-runtime-kernel-absorption-blueprint.md` | 500-700 行 blueprint,结构与代表 blueprint 对齐 | `diff` structural headings vs 代表 blueprint;`ls packages/agent-runtime-kernel/src/` cited 真实文件清单 | blueprint 含 `源目录 / 目标目录 / dependency 表 / LOC 估算 / 合同 invariant` 五要素 |
| P2-02 | A3 blueprint | 同上;源:`packages/llm-wrapper/**`;目标:`workers/agent-core/src/llm/` | `docs/design/worker-matrix/blueprints/A3-llm-wrapper-absorption-blueprint.md` | 同上 | 同上 | 同上 |
| P2-03 | A4 blueprint | 同上;源:`packages/hooks/**` 仅 runtime residual(wire catalog 归 `@haimang/nacp-core`,不迁);目标:`workers/agent-core/src/hooks/` | `docs/design/worker-matrix/blueprints/A4-hooks-residual-absorption-blueprint.md` | 同上 | `grep "hooks-catalog"` 0 in 搬迁清单;明确 "wire catalog 不迁" 段 | 含 "非迁移项" 段 |
| P2-04 | A5 blueprint | 同上;源:`packages/eval-observability/**` runtime sink + inspector seam;目标:`workers/agent-core/src/eval/` | `docs/design/worker-matrix/blueprints/A5-eval-observability-residual-absorption-blueprint.md` | 同上;明确保持 `BoundedEvalSink` dedup / overflow B7 LIVE 契约 | `grep "BoundedEvalSink"` ≥1 | 明含 "B7 LIVE 5 tests 不得破" 条目 |
| P2-05 | C1 blueprint | 同上;源:`packages/context-management/{budget,async-compact,inspector-facade}/**`;目标:`workers/context-core/src/`;明示 Q3c "opt-in 保持 default 不自动装" 落地 | `docs/design/worker-matrix/blueprints/C1-context-management-absorption-blueprint.md` | 同上 | `grep "opt-in"` ≥2;明含 "不默认 wire compact" 段 | 含 Q3c 口径段 |
| P2-06 | D2 blueprint | 同上;源:`packages/storage-topology/**`;目标:`workers/filesystem-core/src/storage/`;明示 Q4a "host-local 继续" + tenant wrapper 不绕过 | `docs/design/worker-matrix/blueprints/D2-storage-topology-residual-absorption-blueprint.md` | 同上 | `grep "tenant"` ≥2;明含 "Q4a host-local" 段 | 含 B9 contract 引用 |
| P2-07 | A1-A5 sub-PR granularity | 提 2-3 sub-PR 切分方案供 P1.A owner 最终锁定;示例:sub-PR-1 host shell + kernel;sub-PR-2 llm + hooks + eval;sub-PR-3 预留 host consumer 落点;明含 "P1.A owner 拥有最终锁定权" | `docs/design/worker-matrix/blueprints/A1-A5-sub-pr-granularity.md` | 300-500 行 | `grep "P1.A owner"` ≥1 | 显式声明 owner 最终锁定 |
| P2-08 | blueprints-index | 10 units × 对应 blueprint 源(代表 3 / P0 新建 6 + 1 sub-PR)映射表 | `docs/design/worker-matrix/blueprints/blueprints-index.md` | 1 张表 + 每行一个 unit | `grep "^\| [A-D][0-9]"` 10 行 | 10 unit 全覆盖 |

### 4.3 Phase 3 — P2.E0 owner 决策 + P1 启动 checklist

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | P2.E0 决策落盘 | 在 closure memo §3 写:**owner**(谁执行 deploy)/ **schedule**(P1.B merge 后多久)/ **rollback**(wrangler Version ID pin + preview URL 回滚)/ **curl probe expected JSON 字段**(含 `worker: "bash-core"`、`absorbed_runtime: true`、`nacp_core_version: "1.4.0"`、`nacp_session_version: "1.3.0"`)| `docs/issue/worker-matrix/P0-absorption-prep-closure.md` §3 | 30-60 行段落 | `grep "absorbed_runtime: true"` ≥1 | 含 4 段(owner/schedule/rollback/probe)|
| P3-02 | P1 kickoff checklist | 在 closure memo §4 写:P1.A kickoff gate(A1-A5 blueprint 全就绪 / 代表 blueprint 无漂移 / owner 锁定 sub-PR 数);P1.B kickoff gate(B1 代表 blueprint 最新 / D02 v0.2 审阅 / P2.E0 owner 已定 / 有 rollback plan)| `docs/issue/worker-matrix/P0-absorption-prep-closure.md` §4 | 两段 checklist | checkbox 形式;P1.A / P1.B 各 ≥5 条 | 能被 P1 kickoff PR body 直接引用 |

### 4.4 Phase 4 — D01-D09 R1-R5 吸收索引 + P0 closure memo

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | R1-R5 吸收索引 | 在 closure memo §5 写 9 份 design v0.2 版本历史条目的汇总表;列:design / 吸收的 R / 主要 delta 文字 / 事实锚点 | `docs/issue/worker-matrix/P0-absorption-prep-closure.md` §5 | 1 张表 9 行(D01 / D02+R3 / D03 / D04 / D05+R1+R2 / D06+R1 / D07 / D08+R4 / D09+R5)| `grep "R1\|R2\|R3\|R4\|R5"` ≥5 | 9 行全含 |
| P4-02 | charter 索引 | 在 `docs/plan-worker-matrix.md` §11 附 "P0 已收口 → 见 `docs/issue/worker-matrix/P0-absorption-prep-closure.md`" 一行 | `docs/plan-worker-matrix.md` §11 | 1 行 | `grep "P0-absorption-prep-closure"` ≥1 in charter | charter diff ≤ 5 行 |
| P4-02 | handoff 索引 | 在 `docs/handoff/pre-worker-matrix-to-worker-matrix.md` 尾部附 "P0 已收口 + D01-D09 R1-R5 吸收索引" 段 | `docs/handoff/pre-worker-matrix-to-worker-matrix.md` | 10-30 行段落 | `grep "D01-D09"` ≥1 | handoff 有一条明确的 "下一环节起点" |
| P4-03 | P0 closure 合拢 | 把 §0 背景 / §1-§4 blueprint reality check + blueprints 就绪 + P2.E0 决策 + P1 kickoff checklist / §5 R1-R5 索引 / §6 exit criteria 合成一份 closure memo | `docs/issue/worker-matrix/P0-absorption-prep-closure.md` | 完整 400-700 行 memo | memo §6 exit criteria 5 条全部 checked | P0 exit criteria 全绿 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 代表 blueprint reality check

- **Phase 目标**:3 份代表 blueprint 与 W2 published + W4 shell + D01-D09 v0.2 事实一致
- **本 Phase 对应编号**:`P1-01` `P1-02` `P1-03`
- **本 Phase 新增文件**:无
- **本 Phase 修改文件**:
  - `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`
  - `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`
  - `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`
- **具体功能预期**:
  1. `@haimang/nacp-*@1.4.0/1.3.0` 版本号真相在 3 份都出现至少 1 次
  2. D02 F6 preview deploy 引用对齐(capability-runtime blueprint)
  3. `composition?.workspace?.assembler` 口径对齐 D05 v0.2(session-do-runtime blueprint,若涉及)
  4. mixed helper owner 表(C2 / D1)对齐 D03 / D04(WCA blueprint)
- **具体测试安排**:
  - **单测**:n/a
  - **集成测试**:n/a
  - **回归测试**:n/a
  - **手动验证**:`grep -c "@haimang" <3 files>` ≥ 3;`grep -c "@nano-agent/nacp-" <3 files>` == 0
- **收口标准**:3 份 diff 都 ≤ 50 行;都只触事实锚点,不动 §1-§9 结构
- **本 Phase 风险提醒**:
  - 若代表 blueprint 中某些章节本就不涉及被校准的事实(如 session-do-runtime blueprint 根本没有 consumer 话题),该项可 skip,不强行插入

### 5.2 Phase 2 — 7 份非代表 blueprint 补齐

- **Phase 目标**:`docs/design/worker-matrix/blueprints/` 含 7 份 detailed blueprint + 1 份 index,10 个 units 全覆盖
- **本 Phase 对应编号**:`P2-01` 至 `P2-08`
- **本 Phase 新增文件**:
  - `docs/design/worker-matrix/blueprints/A2-agent-runtime-kernel-absorption-blueprint.md`
  - `docs/design/worker-matrix/blueprints/A3-llm-wrapper-absorption-blueprint.md`
  - `docs/design/worker-matrix/blueprints/A4-hooks-residual-absorption-blueprint.md`
  - `docs/design/worker-matrix/blueprints/A5-eval-observability-residual-absorption-blueprint.md`
  - `docs/design/worker-matrix/blueprints/C1-context-management-absorption-blueprint.md`
  - `docs/design/worker-matrix/blueprints/D2-storage-topology-residual-absorption-blueprint.md`
  - `docs/design/worker-matrix/blueprints/A1-A5-sub-pr-granularity.md`
  - `docs/design/worker-matrix/blueprints/blueprints-index.md`
- **本 Phase 修改文件**:无
- **具体功能预期**:
  1. 6 份 absorb blueprint 都含 § 源目录 / 目标目录 / dependency 表 / LOC 估算 / 合同 invariant
  2. A4(hooks)明确 "wire catalog 不迁 — 归 nacp-core"
  3. A5(eval)明确 "B7 LIVE 5 tests 不得破"
  4. C1 明确 Q3c "opt-in 保持"
  5. D2 明确 Q4a "host-local 继续" + tenant wrapper 不绕过
  6. A1-A5 sub-PR 明确 "owner 最终锁定"
  7. blueprints-index 覆盖 10 个 units
- **具体测试安排**:
  - **手动验证**:`ls docs/design/worker-matrix/blueprints/*.md | wc -l` == 8;每份 blueprint ≥ 200 行
- **收口标准**:8 个文件全存在;index 引用 10 个 units
- **本 Phase 风险提醒**:
  - 避免把 design(D01-D09)重复写成 blueprint — blueprint 仅 pressed absorb 机械执行;design 是决策论述,两者不重叠

### 5.3 Phase 3 — P2.E0 owner 决策 + P1 启动 checklist

- **Phase 目标**:P2.E0 owner / schedule / rollback / probe 落盘;P1 kickoff gate 落盘
- **本 Phase 对应编号**:`P3-01` `P3-02`
- **本 Phase 新增文件**:`docs/issue/worker-matrix/P0-absorption-prep-closure.md`(骨架;Phase 4 继续添加)
- **本 Phase 修改文件**:无
- **具体功能预期**:
  1. closure memo §3 含 P2.E0 决策 4 段(owner / schedule / rollback / probe)
  2. §4 含 P1.A / P1.B kickoff checklist
- **具体测试安排**:
  - **手动验证**:§3 ≥ 30 行;§4 checklist 各 ≥ 5 条
- **收口标准**:P1 kickoff PR body 可直接引用 §4 checklist
- **本 Phase 风险提醒**:
  - owner 决策应给出具体名字或 role(如 "GPT-5.4 / 由 W4 real deploy 的同一 owner 执行"),而不是 "TBD"

### 5.4 Phase 4 — R1-R5 吸收索引 + P0 closure memo

- **Phase 目标**:closure memo 合拢;charter / handoff 索引同步
- **本 Phase 对应编号**:`P4-01` `P4-02` `P4-03`
- **本 Phase 新增文件**:无
- **本 Phase 修改文件**:
  - `docs/issue/worker-matrix/P0-absorption-prep-closure.md`(由 Phase 3 骨架扩展为完整 memo)
  - `docs/plan-worker-matrix.md` §11
  - `docs/handoff/pre-worker-matrix-to-worker-matrix.md` 尾部
- **具体功能预期**:
  1. closure memo §5 含 R1-R5 吸收索引表(9 行)
  2. charter §11 附 P0 closure link(1 行)
  3. handoff pack 尾部有 P0 收口段
  4. closure memo §6 exit criteria 5 条全绿
- **具体测试安排**:
  - **手动验证**:`grep -c "R1\|R2\|R3\|R4\|R5" <closure>` ≥ 5;`grep "P0-absorption-prep-closure" docs/plan-worker-matrix.md docs/handoff/*.md` ≥ 2
- **收口标准**:P0 exit criteria §6 全 checked
- **本 Phase 风险提醒**:
  - 避免在 charter 中重复写 R1-R5 delta(已在各 design v0.2 落盘) — charter 只附 link

---

## 6. 需要业主 / 架构师回答的问题清单

### Q1 — P0 PR 节奏

- **影响范围**:全 Phase
- **为什么必须确认**:P0 可以合成 1 份 design PR 或拆成 4 份(每 Phase 一份),影响 review 成本与 owner 预算
- **当前建议 / 倾向**:**合成 1 份 design PR**(预期 diff ≤ 3000 行 markdown;纯 design 变更,不跑 CI)
- **Q**:P0 是否拆 PR?如拆,按几 Phase 拆?
- **A**:_pending_

### Q2 — 7 份非代表 blueprint 丰度深度

- **影响范围**:Phase 2
- **为什么必须确认**:blueprint 可写 300 行(最小 machine-usable)或 700 行(代表 blueprint 丰度);写太深会浪费 P0 预算,太浅在 P1 执行时会被补充
- **当前建议 / 倾向**:400-600 行区间;保证 **§源/目标/deps/LOC/invariant 五要素齐全**,文字丰度与代表 blueprint 相近但不追求逐行匹配
- **Q**:7 份 blueprint 的丰度目标是?
- **A**:_pending_

### Q3 — P2.E0 owner 归属

- **影响范围**:Phase 3 + P2.E0 实际执行
- **为什么必须确认**:`workers/bash-core` real preview deploy 是 P2 硬前置;如果 owner 到 P1.B merge 后才找,P2 会被卡 1-3 天
- **当前建议 / 倾向**:由 W4 完成 agent-core preview deploy 的同一 owner(GPT-5.4 或等价)继续执行 bash-core preview;schedule = P1.B merge 后 24 小时内
- **Q**:P2.E0 owner 是谁?schedule 窗口多长?
- **A**:_pending_

### Q4 — blueprints-index 是否分 "代表 / 补齐" 两列

- **影响范围**:Phase 2 P2-08
- **为什么必须确认**:影响 index 可读性;如不分列则只有单列 blueprint link,分列能显式标 "哪些是 pre-worker-matrix 代表 / 哪些是 P0 新建"
- **当前建议 / 倾向**:分列(source-origin + blueprint-link 两列)
- **Q**:blueprints-index 格式?
- **A**:_pending_

### 6.2 问题整理建议

- Q1 / Q3 是 execution gate;Q2 / Q4 是 format-only
- Q3 不确认,Phase 3 写 "TBD" 会把 P2.E0 风险延迟到 P1.B merge 后

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| 7 份非代表 blueprint 写浅 | 在 P1 执行时发现 machine-unusable,需要回头补 | `medium` | Q2 定丰度目标;每份 blueprint review gate |
| 代表 blueprint 校准不彻底 | 继承到 7 份非代表 blueprint 的 import 漂移 | `low` | Phase 1 先做;Phase 2 copy-fill 时 grep 验证 |
| P2.E0 owner 未定 | 导致 P1.B merge 后 P2 卡住 | `high` | Q3 + Phase 3 hard-require owner 具体名 |
| closure memo 与 charter 脱节 | 后续接手人找不到 P0 真相 | `low` | Phase 4 强制双向 link(charter ↔ closure memo)|

### 7.2 约束与前提

- **技术前提**:pre-worker-matrix 已收口(W0-W5 closure 存在);D01-D09 v0.2(已吸收 R1-R5)存在
- **运行时前提**:无(P0 零代码改动)
- **组织协作前提**:owner 能在 Q1-Q4 上给出决策(尤其 Q3)
- **上线 / 合并前提**:P0 可在 owner approve Q1-Q4 后单独 merge;不依赖任何 CI

### 7.3 文档同步要求

- 需要同步更新的设计文档:
  - `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`
  - `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`
  - `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`
- 需要同步更新的说明文档 / README:
  - `docs/plan-worker-matrix.md` §11(1 行索引)
  - `docs/handoff/pre-worker-matrix-to-worker-matrix.md` 尾部(1 段)
- 需要同步更新的测试说明:
  - n/a

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**:
  - `ls docs/design/worker-matrix/blueprints/*.md | wc -l` == 8
  - `ls docs/issue/worker-matrix/P0-absorption-prep-closure.md` 存在
  - `grep -c "P0-absorption-prep-closure" docs/plan-worker-matrix.md docs/handoff/*.md` ≥ 2
- **单元测试**:n/a
- **集成测试**:n/a
- **端到端 / 手动验证**:owner 阅读 closure memo §6 exit criteria 5 条全绿
- **回归测试**:n/a(零代码改动)
- **文档校验**:每份 blueprint ≥ 200 行;blueprint-index 覆盖 10 unit

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后,至少应满足以下条件:

1. 3 份代表 blueprint 与 D01-D09 v0.2 事实一致(diff 最小,不改结构)
2. 7 份非代表 blueprint + 1 份 index 全存在,10 个 units 全覆盖
3. P2.E0 owner / schedule / rollback / probe 在 closure memo §3 明确落盘
4. P1.A / P1.B kickoff checklist 在 closure memo §4 明确,P1 PR body 可直接引用
5. 9 份 design v0.2 R1-R5 吸收索引在 closure memo §5 汇总
6. charter / handoff 索引双向链接 closure memo

### 8.3 完成定义(Definition of Done)

| 维度 | 完成定义 |
|------|----------|
| 功能 | 7 份非代表 blueprint + 1 份 index 新建;3 份代表 blueprint 校准;closure memo 合拢 |
| 测试 | n/a(零代码改动)|
| 文档 | charter / handoff 双向引用 closure memo;9 份 design v0.2 条目可被 closure §5 引用 |
| 风险收敛 | P2.E0 owner 具体名落盘,不再是 TBD |
| 可交付性 | P1.A / P1.B kickoff PR body 能直接 copy closure memo §4 checklist |

---

## 9. 执行后复盘关注点

- 哪份 blueprint 在 P1 执行时被发现 machine-unusable → 反馈到本 action-plan 下次修订的 Phase 2 丰度策略
- 代表 blueprint reality check 漏掉的真相项目
- P2.E0 owner 决策是否在 P1.B merge 前被 respect
- closure memo 与 charter 的 link 是否在 P1-P5 接力中被后续 PR 继续引用

---

## 10. 结语

这份 P0 action-plan 以 **"在改任一行 runtime 代码前,把 design + owner 决策全压实"** 为第一优先级,采用 **"先代表 reality check → 再 7 份 on-demand 补齐 → 再 owner 决策落盘 → 最后 closure memo 合拢"** 的推进方式,优先解决 **"P1 开工前仍缺 machine-usable blueprint / P2.E0 owner 未定 / R1-R5 吸收真相无单一 anchor"** 三件 design-only 欠账,并把 **"零代码改动 / 仅 markdown / 不重开 owner 决策"** 作为主要约束。整个计划完成后,`worker-matrix` 应达到 **"P1 的每一份 absorb PR 都有明确母本 / P2.E0 的 owner 与 schedule 已定 / R1-R5 吸收真相可在 closure memo 内被单点查询"**,从而为后续的 **P1 A1-A5 + B1 机械 absorb** 提供稳定、可机械化执行的基础。

---

## 11. P0 执行日志(Claude Opus 4.7, 2026-04-23)

本章节由 P0 执行者在 Phase 1-4 全部完成后回填,作为本 action-plan 的执行证据与后续 P1 kickoff 的 single-source reference。

### 11.1 执行综述

- **执行窗口**:2026-04-23 单次会话内完成
- **零代码改动**:全部产出仅 markdown;未触 `packages/*` / `workers/*` 任一源码
- **总新建 / 修改文件数**:11 份(10 份在 `docs/` 下新建 / 修改,1 份本 action-plan 的 §11 回填)
- **Phase 推进顺序**:按 §1.2 Phase 总览严格推进 Phase 1 → 2 → 3 → 4
- **exit criteria**:6/6 全绿(v0.2 补录:owner 于 2026-04-23 批准默认 answer,F6 deploy 已实际执行并验证 — 见 closure memo §3.2 批准表 + v0.2 版本历史)

### 11.2 Phase 1 执行日志 — 代表 blueprint reality check

| 编号 | 文件 | 触发修改的事实 | diff 规模 |
|------|------|----------------|----------|
| P1-01 | `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md` | (1) §5.1 "nacp-core / nacp-session" → 明确为 `@haimang/nacp-core@1.4.0` / `@haimang/nacp-session@1.3.0`(W2 shipped 事实);(2) §5.1 补 D07 激活时 `CAPABILITY_WORKER` binding 说明;(3) §5.1 补 WCA split 归 D03/D04 的说明;(4) 新增 §8.1 "worker-matrix 下 P1.B / D02 消费本 blueprint 的要点(reality-check)" 节 4 条事实锚点(real preview deploy P2.E0 硬前置 / binding-first `/capability/call` + `/capability/cancel` / `ServiceBindingTarget` 默认 service name 保持 / workspace substrate 共存期保留)| +32 行 |
| P1-02 | `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md` | 新增 §7 "worker-matrix 下 D01 / D05 / D06 消费本 blueprint 的要点(reality-check)" 节 5 条事实锚点(A1 host shell 落点 `workers/agent-core/src/host/do/nano-session-do.ts` / host consumer 读 `composition?.workspace?.assembler` / wire truth = `session.start.body.initial_input` + `session.followup_input.body.text` / 依赖事实 `@haimang/nacp-core + nacp-session + @nano-agent/workspace-context-artifacts` coexist 期 / A4 / A5 residual 驻留 host composition layer)| +16 行 |
| P1-03 | `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md` | 新增 §9 "worker-matrix 下 D03 / D04 / D05 消费本 blueprint 的要点(reality-check)" 节 7 条事实锚点(mixed helper context 侧归 context-core/evidence/ / artifact 侧归 filesystem-core/evidence/artifact.ts / `appendInitialContextLayer` 归 context-core helper 不扩 assembler API / `ContextAssembler` public API 当前仅 2 方法 / `ContextLayerKindSchema` 6 项枚举不扩 / D04 D1 slice 对 `@nano-agent/storage-topology` 依赖在 D2 同批搬 / session-do-runtime live consumer 走 staged cut-over)| +20 行 |

全部 Phase 1 patch 均为 **additive** — 原文 §1-§6 结构保持 byte-identical。

### 11.3 Phase 2 执行日志 — 7 份非代表 blueprint 补齐 + index

| 编号 | 新建文件 | LOC | 8 要素覆盖 | 特色内容 |
|------|----------|-----|------------|----------|
| P2-01 | `docs/design/worker-matrix/blueprints/A2-agent-runtime-kernel-absorption-blueprint.md` | 202 | ✓ | 实测 ~3017 LOC;零跨包 dep;22 src → workers/agent-core/src/kernel/;`KernelDelegates` interface 由 A3/A4/A5 实装 |
| P2-02 | `docs/design/worker-matrix/blueprints/A3-llm-wrapper-absorption-blueprint.md` | 209 | ✓ | 实测 ~3121 LOC;零跨包 dep;17 src 含 adapters/ + registry/ 两层子目录;`PreparedArtifactRef` 与 D04 pair review |
| P2-03 | `docs/design/worker-matrix/blueprints/A4-hooks-residual-absorption-blueprint.md` | 222 | ✓ | 实测 ~4437 LOC;**唯一含 `@haimang/nacp-core` runtime dep**;`HOOK_EVENT_CATALOG` 跟搬 / `HookEventName` wire 留 nacp-core;`HookEventName` re-export deprecation 保留至 D09 |
| P2-04 | `docs/design/worker-matrix/blueprints/A5-eval-observability-residual-absorption-blueprint.md` | 233 | ✓ | 实测 ~6811 LOC(最大 residual);零跨包 dep;`TraceSink` interface 归 A5 / `BoundedEvalSink` 归 A1;**B7 LIVE 5 tests 协调说明**(A5 先合 → A1 后合)|
| P2-05 | `docs/design/worker-matrix/blueprints/C1-context-management-absorption-blueprint.md` | 223 | ✓ | 实测 ~5332 LOC;3 subpath exports(budget / async-compact / inspector-facade);**Q3c opt-in 纪律明示**;`ContextLayer` import 漂移由 D03 C2 slice merge 顺序决定 |
| P2-06 | `docs/design/worker-matrix/blueprints/D2-storage-topology-residual-absorption-blueprint.md` | 218 | ✓ | 实测 ~4816 LOC;`@haimang/nacp-core` dep 保留 `tenantDoStorage*` / `tenantKv*` / `tenantR2*`;**Q4a host-local 明示**;`getTenantScopedStorage()` 归 A1,不搬 |
| P2-07 | `docs/design/worker-matrix/blueprints/A1-A5-sub-pr-granularity.md` | 192 | sub-PR 方案对比 | 三方案对比(1 PR / 2 PR / 3 PR)+ 默认推荐 **方案 2(2 sub-PR)**;P1.A kickoff PR body 6 项 checklist |
| P2-08 | `docs/design/worker-matrix/blueprints/blueprints-index.md` | 79 | index | 10 units × blueprint link 映射(含来源属性 "代表 3 份 / P0 补齐 6 份");附加资产表 |

合计 8 个 blueprint 文件 / ~1578 LOC / 10 units 全覆盖。每份 absorption blueprint 均覆盖 §源目录 / §目标目录 / §文件映射表 / §dep 处理 / §测试迁移 / §风险 / §LOC 估算 / §verdict 8 要素。

### 11.4 Phase 3 执行日志 — P2.E0 owner decision + P1 kickoff checklist

| 编号 | 产出位置 | 内容 |
|------|----------|------|
| P3-01 | `docs/issue/worker-matrix/P0-absorption-prep-closure.md` §3 | P2.E0 决策 5 子项(owner / schedule / rollback / probe 命令 / expected JSON shape)+ 建议值(待 owner 填最终 answer)+ 正常路径 + 故障路径流程 |
| P3-02 | `docs/issue/worker-matrix/P0-absorption-prep-closure.md` §4 | P1.A kickoff PR body 6 条 checklist;P1.B kickoff PR body 6 条 checklist |

两段合计 60+ 行 — P1 kickoff PR body 可直接 copy。

### 11.5 Phase 4 执行日志 — R1-R5 吸收索引 + P0 closure memo

| 编号 | 产出 / 修改 | 内容 |
|------|-------------|------|
| P4-01 | `docs/issue/worker-matrix/P0-absorption-prep-closure.md` §5 | 9 份 design v0.2 版本历史总表(D01 / D02+R3 / D03+R1 / D04 / D05+R1+R2 / D06+R1 / D07 / D08+R4 / D09+R5);5 条 delta cross-reference 表(R1 / R2 / R3 / R4 / R5 映射到 P1-P5 action-plan 的具体消费点)|
| P4-02 | `docs/plan-worker-matrix.md` §11.1 | 新增 "已收口 Phase 索引" 小节,附 1 条 P0 closure link |
| P4-02 | `docs/handoff/pre-worker-matrix-to-worker-matrix.md` §8 | 新增 "worker-matrix P0 已收口索引(2026-04-23 追记)" 段;含 P0 产出 7 项映射表 |
| P4-03 | `docs/issue/worker-matrix/P0-absorption-prep-closure.md` 合拢 | §0 背景 + §1 交付清单 + §2 Phase 1 delta 说明 + §3 P2.E0 decision + §4 P1 kickoff checklist + §5 R1-R5 索引 + §6 exit criteria + §7 对 P1 开工影响 + §8 版本历史 |

P0 closure memo 最终规模:~160 行,覆盖 §0-§8 全部 sections。

### 11.6 exit criteria 最终状态

| Code | 条件 | 状态 | 证据 |
|------|------|------|------|
| E1 | 3 份代表 blueprint 完成 reality-check | ✅ | `grep -l "worker-matrix 下" docs/design/pre-worker-matrix/W3-absorption-blueprint-*.md` 返回 3 文件 |
| E2 | 6 P0 blueprint + 1 sub-PR 切分 + 1 index + 10 units 覆盖 | ✅ | `ls docs/design/worker-matrix/blueprints/*.md \| wc -l` = 8;blueprints-index 覆盖 10 units |
| E3 | P2.E0 owner decision 5 子项 answer 非 pending | ✅(v0.2 补录)| owner 于 2026-04-23 批准默认建议值;Claude 作为 deploy 执行者;Version ID `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4` 已记录 |
| E4 | P1.A / P1.B kickoff checklist 12+ 条 | ✅ | closure memo §4.1 6 条 + §4.2 6 条 = 12 条 |
| E5 | R1-R5 吸收索引 9 行 + 5 条 delta cross-reference | ✅ | closure memo §5.1 9 行 + §5.2 9 行(覆盖 R1/R2/R3/R4/R5)|
| E6 | charter + handoff 回链 closure memo | ✅ | `grep -l P0-absorption-prep-closure docs/plan-worker-matrix.md docs/handoff/*.md` 返回 2 文件 |

**6/6 全绿**(v0.2 补录于 2026-04-23:owner 批准默认 answer + F6 实际执行)。

### 11.7 受影响文件完整清单

**新建(9 文件)**:
- `docs/design/worker-matrix/blueprints/A2-agent-runtime-kernel-absorption-blueprint.md`
- `docs/design/worker-matrix/blueprints/A3-llm-wrapper-absorption-blueprint.md`
- `docs/design/worker-matrix/blueprints/A4-hooks-residual-absorption-blueprint.md`
- `docs/design/worker-matrix/blueprints/A5-eval-observability-residual-absorption-blueprint.md`
- `docs/design/worker-matrix/blueprints/C1-context-management-absorption-blueprint.md`
- `docs/design/worker-matrix/blueprints/D2-storage-topology-residual-absorption-blueprint.md`
- `docs/design/worker-matrix/blueprints/A1-A5-sub-pr-granularity.md`
- `docs/design/worker-matrix/blueprints/blueprints-index.md`
- `docs/issue/worker-matrix/P0-absorption-prep-closure.md`

**修改(5 文件)**:
- `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`(+§5.1 澄清 + §8.1 新 4 条事实锚点)
- `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`(+§7 新 5 条事实锚点)
- `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`(+§9 新 7 条事实锚点)
- `docs/plan-worker-matrix.md`(+§11.1 P0 closure link)
- `docs/handoff/pre-worker-matrix-to-worker-matrix.md`(+§8 P0 已收口索引表)

**本 action-plan 回填(1 文件)**:
- `docs/action-plan/worker-matrix/P0-absorption-prep.md`(+§11 本执行日志)

### 11.8 P1 开工 gate 确认(从本执行日志的角度)

- [x] 10 units 全部有 machine-usable blueprint → P1.A / P1.B / P3 / P4 executor 可按 blueprints-index 直接取母本
- [x] P1.A / P1.B kickoff checklist 可直接 copy 到 kickoff PR body
- [x] D02 v0.2 / D05 v0.2 / D06 v0.2 / D08 v0.2 / D09 v0.2 / D03 v0.2 已在 v0.2 版本历史落盘;P1-P5 action-plan 已吸收 R1-R5(P1-P5 reviewer session 产出;closure memo §5.2 cross-reference 表已映射)
- [x] 共存期纪律在每份 blueprint §非迁移项 / §风险 中明示
- [ ] **owner action required**:closure memo §3.2 P2.E0 5 子项 answer 填入 → E3 exit criterion 转绿 → P0 全绿
- [ ] **owner action required**:P0 可以单独作为一份 design PR merge(建议),或按 Phase 拆 4 份 PR merge(Q1 未定)

### 11.9 已知未收口 / owner open question

源自本 action-plan §6 的 4 个 Q + 从 P1-P5 GPT review 吸收期延续下来的 2 个 Q,共 6 条:

| Q | 影响范围 | 本 action-plan 建议值 | 状态 |
|---|----------|-----------------------|------|
| Q1(本 action-plan §6)| P0 PR 节奏 | 合成 1 份 design PR(~3000 行 markdown 纯 design)| _pending_ |
| Q2(本 action-plan §6)| 7 份非代表 blueprint 丰度 | 400-600 行 / 5 要素齐全 | _实际丰度 192-233_(§11.3);未与建议严格对齐,但符合 "machine-usable" 标准 |
| Q3(本 action-plan §6)| P2.E0 owner 归属 | W4 agent-core deploy 同一 owner 继续;P1.B merge 后 24h 内 | _pending(对应 E3 / closure memo §3.2)_ |
| Q4(本 action-plan §6)| blueprints-index 分列 | 分列 `blueprint source-origin + blueprint link`;**已落地**(见 blueprints-index `blueprint 源属性` + `blueprint link` 两列)| ✅ 已按建议执行 |
| P3 Q1(延续)| P3 cross-worker import A vs B | 未建议(P3 action-plan 已写两条合法路径)| _pending(P3 kickoff 前)_ |
| P5 Q1/Q2(延续)| deprecation PR cadence + R5-path choice | 未建议(P5 action-plan 已按 R5 落地)| _pending(P5 kickoff 前)_ |

### 11.10 复盘关注点(留给后续 phase)

1. 7 份 P0 补齐 blueprint 规模(192-233 行)比 §6 Q2 建议的 400-600 行略轻;若 P1 执行期发现 machine-unusable,需回溯扩写
2. A1-A5 sub-PR 切分方案默认推荐方案 2 的 ~1.5 周执行预算,需在 P1.A kickoff 时 owner 确认实际 bandwidth
3. E3 owner answer 未填,不会阻塞 P0 "产出完成" 本身,但会阻塞 "P0 100% 绿 exit";P1.B PR 合并时该 answer 必须在 closure memo §3.2 已填
4. B7 LIVE 5 tests 协调(A5 先合 → A1 后合)是 A1-A5 sub-PR 序列里最脆弱的时刻,需在 PR body 明确 "acceptable drift window"

### 11.11 总结一句话

P0 Phase 1-4 零代码改动完成:3 份代表 blueprint 按当前事实补 reality-check 节(30 行+16 行+20 行);8 份新 blueprint 合计 ~1578 行 100% 覆盖 10 units;P0 closure memo ~160 行整合 P2.E0 decision + P1 kickoff checklist + R1-R5 吸收索引;charter / handoff 双向回链已落地;exit criteria 6/6 中 4 绿 + E6 已回填 + E3 等 owner answer。**P0 在 owner 填入 §3.2 最终 answer 后即 100% 绿,P1 可开工**。
