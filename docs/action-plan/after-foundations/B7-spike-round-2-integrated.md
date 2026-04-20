# Nano-Agent 行动计划 — B7：Spike Round 2 Integrated Validation

> 服务业务簇：`After-Foundations Phase 6 — Spike Round 2: Integrated Validation`
> 计划对象：`spikes/round-2-integrated/` 下的 round-2 spike workers、round-2 finding/status writeback、B7 closure issues
> 类型：`spike`
> 作者：`GPT-5.4`
> 时间：`2026-04-20`
> 文件位置：
> - `spikes/round-2-integrated/README.md` （new）
> - `spikes/round-2-integrated/spike-do-storage-r2/{package.json,tsconfig.json,wrangler.jsonc,README.md,.gitignore}` （new）
> - `spikes/round-2-integrated/spike-do-storage-r2/src/{worker,result-shape}.ts` （new）
> - `spikes/round-2-integrated/spike-do-storage-r2/src/do/IntegratedProbeDO.ts` （new）
> - `spikes/round-2-integrated/spike-do-storage-r2/src/follow-ups/{kv-cross-colo-stale,do-size-cap-binary-search,curl-high-volume,r2-concurrent-put}.ts` （new）
> - `spikes/round-2-integrated/spike-do-storage-r2/src/re-validation/{storage,bash,context}.ts` （new）
> - `spikes/round-2-integrated/spike-do-storage-r2/scripts/{deploy,run-all-probes,extract-finding}.ts|.sh` （new）
> - `spikes/round-2-integrated/spike-binding-pair-r2/worker-a-r2/{package.json,tsconfig.json,wrangler.jsonc,README.md,.gitignore}` （new）
> - `spikes/round-2-integrated/spike-binding-pair-r2/worker-a-r2/src/{worker,follow-ups,re-validation,result-shape}.ts` （new）
> - `spikes/round-2-integrated/spike-binding-pair-r2/worker-b-r2/{package.json,tsconfig.json,wrangler.jsonc,README.md,.gitignore}` （new）
> - `spikes/round-2-integrated/spike-binding-pair-r2/worker-b-r2/src/{worker,handlers}.ts` （new）
> - `spikes/round-2-integrated/spike-binding-pair-r2/scripts/{deploy-both,run-all-probes,extract-finding}.ts|.sh` （new）
> - `docs/spikes/_DISCIPLINE-CHECK-round-2.md` （new）
> - `docs/spikes/spike-do-storage/*.md` （modify：更新 §0 status + round-2 closure section）
> - `docs/spikes/spike-binding-pair/*.md` （modify：更新 §0 status + round-2 closure section）
> - `docs/spikes/unexpected/*.md` （modify：更新 §0 status + round-2 closure section）
> - `docs/spikes/round-2-integrated/**/*.md` （new：仅当 Round 2 暴露新增 `integrated-F*` finding）
> - `docs/issue/after-foundations/B7-{phase-1,phase-2,phase-3,final}-closure.md` （new）
>
> 关联设计 / spec / review / issue / spike / action-plan 文档：
> - `docs/plan-after-foundations.md` (§4.1 G / §7.7 / §11.1 / §14.2 / §14.4)
> - `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md`
> - `docs/design/after-foundations/P6-spike-round-2-integration-plan.md`
> - `docs/design/after-foundations/P7-worker-matrix-pre-convergence.md`
> - `docs/issue/after-foundations/B1-final-closure.md`
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md`
> - `docs/action-plan/after-foundations/B2-storage-adapter-hardening.md`
> - `docs/action-plan/after-foundations/B3-fake-bash-extension-and-port.md`
> - `docs/action-plan/after-foundations/B4-context-management-package-async-core.md`
> - `docs/action-plan/after-foundations/B5-hooks-catalog-expansion-1-0-0.md`
> - `docs/action-plan/after-foundations/B6-nacp-1-2-0-upgrade.md`
> - `docs/spikes/storage-findings.md`
> - `docs/spikes/binding-findings.md`
> - `docs/spikes/fake-bash-platform-findings.md`
>
> 关键 reference（当前仓库 reality）：
> - `spikes/round-1-bare-metal/spike-do-storage/package.json`
> - `spikes/round-1-bare-metal/spike-binding-pair/worker-a/package.json`
> - `spikes/round-1-bare-metal/spike-binding-pair/worker-b/package.json`
> - `packages/session-do-runtime/src/env.ts`（当前 v1 binding catalog reality）
> - `package.json`（root `test:contracts / test:e2e / test:cross`）
>
> 文档状态：`draft`

---

## 0. 执行背景与目标

> B7 不是“再跑一次 spike”这么简单。它是 after-foundations 的最终验证 gate：**一方面**要把 B1 明确 defer 到 Round 2 的 follow-ups 跑透，**另一方面**要用 B2-B6 已 ship 的 packages 重跑 B1 全部 finding，判断这些 ship 到底有没有把 Round 1 暴露出的 platform truth 真正消化掉。

- **服务业务簇**：`After-Foundations Phase 6 — Spike Round 2: Integrated Validation`
- **计划对象**：round-2 integrated spike workers、finding 状态迁移、B7 closure issues 与 B8 handoff 输入
- **本次计划要解决的核心问题**：
  - **P1**：P6 design 的初稿口径仍容易让人误读成 “5 follow-ups + B2-B6 理想化 closure”；按当前事实，Round 2 至少要覆盖 **7 项** follow-up / caveat：
    1. `F03` cross-colo stale-read
    2. `F08` DO value cap binary-search
    3. `F09` high-volume curl with owner URL
    4. `binding-F01` callee-side abort observation
    5. `unexpected-F01` R2 concurrent put
    6. `binding-F04` true cross-worker sink callback path
    7. `F03` 的 `cacheTtl: 0` + 100-sample 扩展验证
  - **P2**：B7 必须消费的是 **B2-B6 已 ship 的现实 contract**，不是它们最乐观的叙述：
    - B2 提供的是 honest storage substrate，不是“自动闭环的最终 router”
    - B3 提供的是 conservative fake-bash surface，不替代高 volume curl / exact cap probe
    - B4/B5/B6 各自都还留了要由 integrated spike 复验的 seam
  - **P3**：当前仓库已有 Round 1 live spike skeleton（3 个 package.json 都只暴露 `deploy:dry-run / deploy / tail`），B7 应延续这种 deploy-shaped 结构，但必须保持 **新目录 + 新 worker 名 + 新资源**，不能污染 Round 1 baseline
  - **P4**：B7 有两类天然阻塞：
    - `F09` 需要 owner-supplied URL
    - `F03` cross-colo 可能受账号 / region / deploy profile 限制
    这两类都必须显式写成 gate，而不是临场降级成“随便测一下”
  - **P5**：B7 是第一个被允许 `import "@nano-agent/*"` runtime 的 spike phase；它必须通过 real package seams 重跑验证，而不是偷偷回退到 bare-metal API 调用
  - **P6**：B7 不只是产出 `.out/*.json`；它还必须把 B1 的 13 required + 2 optional finding 状态真正推到闭环，或者老老实实留下 `still-open` escalation
- **本次计划的直接产出**：
  - **D1**：建立 `spikes/round-2-integrated/` 的 deploy-shaped 代码与脚本骨架
  - **D2**：完成 7 项 round-2 follow-up / caveat probe，并沉淀 raw evidence
  - **D3**：通过 B2-B6 已 ship packages 跑完整的 integration re-validation route set
  - **D4**：更新 B1 原 finding docs 的状态与 round-2 closure section；必要时新增 `integrated-F*` finding docs
  - **D5**：形成 `B7-phase-*` / `B7-final-closure` closure issue pack 与 `_DISCIPLINE-CHECK-round-2.md`
  - **D6**：给 B8 / worker-matrix 提供一份不再依赖 draft 想象的 closure verdict bundle

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 采用 **“先冻结 verdict 和 gate，再起 round-2 worker；先跑 follow-up，再做全量 re-validation；先更新原 finding 状态，再决定 handoff”** 的方式：

1. **先冻结 B7 的唯一真相源**
   - 以 `B1-final-closure`、`B1-handoff`、P6 design r2、以及 B2-B6 action-plan 当前收口状态为准
   - 把 follow-up count 明确固定为 **7**，不再回退到旧的 “5 项” 口径
2. **先隔离 Round 2 物理载体，再接包**
   - separate dir / separate worker name / separate KV/R2/D1
   - 然后在 round-2 spike 里显式 import B2-B6 ship 后的 packages
3. **把 follow-up 当成优先级最高的 gate**
   - F03/F08/F09/binding-F01/unexpected-F01/binding-F04/F03-cacheTtl 扩展先跑
   - 否则后面的全量 re-validation 很容易被残留未知量污染
4. **把 re-validation 严格绑定到 shipped seam**
   - storage 走 `R2Adapter / DOStorageAdapter / KvAdapter / D1Adapter / ReferenceBackend`
   - fake-bash 走 `capability-runtime`
   - context / hooks / nacp / inspector 走 B4-B6 已 ship seam
5. **用 finding status transition 作为真正收口**
   - B7 完成不等于“跑了脚本”，而等于 original finding doc 的 `§0 status` 和 round-2 closure section 已更新
   - 若出现新增真实问题，用 `integrated-F*` 记录，而不是把它塞进老 finding 里糊掉

### 1.2 Phase 总览

| Phase | 名称 | 目标摘要 | 依赖前序 |
|---|---|---|---|
| Phase 1 | Preflight + verdict freeze | 对齐 B1 / P6 / B2-B6 / current spike reality；冻结 7 follow-ups、status transition rule、owner/blocker gate | - |
| Phase 2 | Round-2 spike skeleton + isolated deploy surface | 建 `spikes/round-2-integrated/` 目录、separate workers/resources、result/evidence shape、package imports | Phase 1 |
| Phase 3 | Round-2 follow-ups | 跑透 7 项 follow-up / caveat probe，并形成 raw evidence | Phase 2 |
| Phase 4 | Integration re-validation + finding transition | 通过 B2-B6 seam 重跑 13 required + 2 optional finding，并更新 finding status / `integrated-F*` | Phase 3 |
| Phase 5 | Discipline / docs / closure / handoff | `_DISCIPLINE-CHECK-round-2`、B7 closure issues、final verdict bundle、B8 handoff input | Phase 4 |

### 1.3 来自 B1-B6 的输入约束

| 来源 | B7 必须消费的事实 | 对计划的直接影响 |
|---|---|---|
| **B1 final closure** | Round 2 follow-ups 不再只是 5 项；`C1` 与 `C3` 已把 `binding-F04` true callback、F03 cacheTtl/100-sample 明确推给 B7 | B7 必须按 7 项 follow-up 组织执行与 closure |
| **B2 输出** | `R2Adapter.listAll()` 目前是 bounded best-effort sweep；`ReferenceBackend({ doStorage, r2 })` 仍不是 orphan-free final router；F03/F08 仍属于 B7 | B7 不能把 B2 substrate 当“已穷尽真相”的黑盒；re-validation 时必须保留这些 caveat |
| **B3 输出** | `write` 只 honest 消费 `WorkspaceFsLike.writeFile()` oversize truth；`curl` 只 ship conservative budget，high-volume 仍待 B7 | B7 负责确认 F09 真边界，不在 spike 中偷偷扩 command surface |
| **B4 输出** | B4 给出的是 context-management package 与 inspector-facade seam，不是 deploy 验证结果 | B7 要验证 real worker async lifecycle / inspector route truth，而不是只消费单测绿灯 |
| **B5 输出** | Class C 仍 deferred；true callback sink semantics 仍待 integrated spike；`EvalSinkOverflow` 只是 metadata 已冻结 | B7 只做验证与 verdict，不在本 phase 直接扩 catalog |
| **B6 输出** | dedup key 基于 frame/header `message_uuid`；`binding-F04` Round 1 仍只是 response-batch simulation | B7 必须在 true callback push path 上复验 ordering / dedup / overflow disclosure |

### 1.4 执行策略说明

- **baseline-protection 原则**：Round 1 workers / raw outputs / finding docs 作为历史 baseline 保留；Round 2 不覆盖它们，只在原 finding doc 中追加 closure section
- **package-truth 原则**：Round 2 的存在意义是验证 packages 已 ship seam；任何 probe 若绕回 bare-metal API，都必须明确说明“这是 follow-up raw truth，不是 integration re-validation”
- **gate-first 原则**：F09 owner URL、F03 cross-colo capability、wrangler tail capture 都是显式 gate；缺 gate 时 B7 保持 open / partial，而不是凑一个替代验证
- **honest-verdict 原则**：若某 finding 仍 unresolved，就写 `still-open` 并升级 issue / handoff，不得因为“后续还有 B8”就提前宣称闭合
- **minimal-writeback 原则**：B7 自身是 spike/action-plan phase；它负责发现和定性，不负责顺手把 B2-B6 又重做一遍。若暴露新问题，走 `integrated-F*` + downstream issue

### 1.5 本次 action-plan 影响目录树

```text
nano-agent/
├── spikes/
│   ├── round-1-bare-metal/                         # 历史 baseline，保留
│   └── round-2-integrated/                         # NEW
│       ├── README.md
│       ├── spike-do-storage-r2/
│       │   ├── package.json
│       │   ├── tsconfig.json
│       │   ├── wrangler.jsonc
│       │   ├── README.md
│       │   ├── .gitignore
│       │   ├── src/
│       │   │   ├── worker.ts
│       │   │   ├── result-shape.ts
│       │   │   ├── do/IntegratedProbeDO.ts
│       │   │   ├── follow-ups/*
│       │   │   └── re-validation/*
│       │   └── scripts/*
│       └── spike-binding-pair-r2/
│           ├── worker-a-r2/
│           │   ├── package.json
│           │   ├── tsconfig.json
│           │   ├── wrangler.jsonc
│           │   ├── README.md
│           │   ├── .gitignore
│           │   └── src/*
│           ├── worker-b-r2/
│           │   ├── package.json
│           │   ├── tsconfig.json
│           │   ├── wrangler.jsonc
│           │   ├── README.md
│           │   ├── .gitignore
│           │   └── src/*
│           └── scripts/*
├── docs/
│   ├── spikes/
│   │   ├── _DISCIPLINE-CHECK-round-2.md
│   │   ├── spike-do-storage/*.md                  # update status / closure section
│   │   ├── spike-binding-pair/*.md                # update status / closure section
│   │   ├── unexpected/*.md                        # update status / closure section
│   │   └── round-2-integrated/**/*.md             # optional integrated-F*
│   └── issue/after-foundations/
│       ├── B7-phase-1-closure.md
│       ├── B7-phase-2-closure.md
│       ├── B7-phase-3-closure.md
│       └── B7-final-closure.md
└── package.json                                   # root test runners are B7 preflight input
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 对齐 B1 / P6 / B2-B6 / current spike reality，冻结 B7 的唯一执行清单
- **[S2]** 建立 `spikes/round-2-integrated/` 代码与 deploy skeleton
- **[S3]** 部署 round-2 storage spike 与 binding-pair spike，使用 separate names/resources
- **[S4]** 跑透 7 项 round-2 follow-up / caveat probe
- **[S5]** 用 B2-B6 shipped seam 重跑 13 required + 2 optional finding 的 integration re-validation
- **[S6]** 更新 original finding docs 的状态与 round-2 closure section
- **[S7]** 如 Round 2 暴露新增真实问题，创建 `integrated-F*` finding docs 与 downstream issue
- **[S8]** 产出 `_DISCIPLINE-CHECK-round-2.md`、B7 closure issues、B8 handoff input bundle

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 重写 B2-B6 的 ship 内容；B7 只验证，不越权变成新一轮实现 phase
- **[O2]** 新增 V4 validation class；B7 的取材范围仍来自 B1 finding / caveat
- **[O3]** worker-matrix phase 的具体实现 / binding v2 设计
- **[O4]** 生产级 observability / dashboard / billing / tenant ops
- **[O5]** 因 owner gate 缺失而擅自替换 F09 URL、擅自把 cross-colo 缩成 same-colo
- **[O6]** 覆盖或删除 Round 1 原始 `.out` / worker / finding baseline
- **[O7]** 为了让 B7 看起来绿而把 `still-open` 改写成 `dismissed-with-rationale`

### 2.3 必须在 Phase 1 明确的边界判定

| 议题 | B7 应采用的判定 | 原因 |
|---|---|---|
| follow-up count | **固定为 7** | B1 final closure `C1/C3` + P6 r2 已把旧 5 项扩展为 7 项 |
| Round 2 对 B2 的读取口径 | **消费 shipped substrate + 显式 caveat** | `listAll()` / `ReferenceBackend` 仍有 carry-forward caveat |
| `binding-F04` probe 形态 | **worker-b push -> worker-a sink callback** | 不能再停留在 response-batch simulation |
| `F03` closure 条件 | **cross-colo + 100 samples + `cacheTtl: 0` variant** | 这是 B1 C3 留下的最小 closure 条件 |
| owner gate 缺失时的行为 | **保持 open / partial** | 不能用替代 URL/替代 region 伪装 closure |
| `nacp-session` 版本标签 | **验证实际协议 surface，不预设一定是 1.2.0** | B6 已明确 stay at 1.1.0 也是合法 outcome |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|---|---|---|---|---|---|---|
| P1-01 | Phase 1 | 对齐 B1 / P6 / B2-B6 / spike reality | check | docs/** + spikes/** + packages/** | 冻结 B7 单一真相 | high |
| P1-02 | Phase 1 | 冻结 verdict / status transition / owner gate | decision | finding docs + closure docs | 避免 B7 口径漂移 | high |
| P1-03 | Phase 1 | 冻结 round-2 naming / resource isolation / phase closure grouping | decision | spikes/** + docs/issue/** | baseline 与 round-2 解耦 | medium |
| P2-01 | Phase 2 | 建 `spike-do-storage-r2` skeleton | add | `spikes/round-2-integrated/spike-do-storage-r2/**` | storage/b3/b4 seam 可部署复验 | high |
| P2-02 | Phase 2 | 建 `spike-binding-pair-r2` skeleton | add | `spikes/round-2-integrated/spike-binding-pair-r2/**` | binding/b5/b6 seam 可部署复验 | high |
| P2-03 | Phase 2 | 接 shipped package imports + result/evidence shape | modify | round-2 spike source files | integrated spike 不回退到 bare-metal | high |
| P3-01 | Phase 3 | 跑 F08 + unexpected-F01 | probe | storage r2 worker | exact cap 与 concurrent R2 truth 落地 | high |
| P3-02 | Phase 3 | 跑 binding-F01 + binding-F04 | probe | binding pair r2 workers + wrangler tail | cancellation / true callback truth 落地 | high |
| P3-03 | Phase 3 | 跑 F03 cross-colo/cacheTtl follow-up | probe | storage r2 worker + region/profile setup | KV freshness truth 落地 | high |
| P3-04 | Phase 3 | 跑 F09 owner URL high-volume follow-up | probe | storage r2 worker + owner input | curl 真边界落地 | high |
| P4-01 | Phase 4 | storage / workspace / context re-validation | probe | round-2 route set + B2/B4 imports | storage/context finding 经 shipped seam 重跑 | high |
| P4-02 | Phase 4 | fake-bash / hooks / protocol / binding re-validation | probe | round-2 route set + B3/B5/B6 imports | non-storage finding 经 shipped seam 重跑 | high |
| P4-03 | Phase 4 | status transition / `integrated-F*` 记录 | doc | original finding docs + new docs | B1 finding 真正闭环 | high |
| P5-01 | Phase 5 | round-2 discipline check + raw evidence pack | doc | docs/spikes/** + .out/** | round-2 自身可 audit | medium |
| P5-02 | Phase 5 | B7 closure issue 系列 + final verdict bundle | doc | docs/issue/after-foundations/** | phase closure 可追溯 | medium |
| P5-03 | Phase 5 | 给 B8 输出 handoff bundle | doc | action-plan / closure docs | worker-matrix 输入不再猜测 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Preflight + verdict freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P1-01 | 输入对齐核查 | 把 `B1-final-closure`、`B1-handoff`、P6 design r2、B2-B6 action-plan 当前口径、Round 1 spike 目录与 package.json reality 对成唯一执行清单 | `docs/**`, `spikes/round-1-bare-metal/**`, `packages/**` | B7 不再混用旧 5-item follow-up 口径 | 人工核对 + grep | follow-up 数、closure 条件、资源范围全部单一化 |
| P1-02 | verdict / owner gate 冻结 | 明确 `writeback-shipped / dismissed-with-rationale / still-open` 在 B7 的判定方式，以及 F09/F03 owner gate 缺失时的处理 | finding docs template + B7 docs | B7 不会靠临场折中改 verdict | 文档核对 | 所有 blocking input 都有明确去向 |
| P1-03 | round-2 命名与隔离冻结 | 固定 `-r2` worker naming、separate resource names、以及 `B7-phase-1/2/3 + final` closure grouping | spikes/** + `docs/issue/after-foundations/**` | baseline 与 round-2 不混淆 | 文档核对 | naming / resources / issue naming 全部统一 |

### 4.2 Phase 2 — Round-2 spike skeleton + isolated deploy surface

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P2-01 | `spike-do-storage-r2` 骨架 | 新建 package metadata、wrangler profile、README、`.gitignore`、`src/worker.ts`、`IntegratedProbeDO`、follow-up/re-validation 子目录 | `spikes/round-2-integrated/spike-do-storage-r2/**` | storage round-2 worker 可独立部署 | `deploy:dry-run` | worker skeleton 与 Round 1 一样 deploy-shaped，但导入 shipped packages |
| P2-02 | `spike-binding-pair-r2` 骨架 | 新建 worker-a-r2 / worker-b-r2 及 scripts，保留 caller/callee 分工 | `spikes/round-2-integrated/spike-binding-pair-r2/**` | binding-pair round-2 worker 可独立部署 | `deploy:dry-run` | 两个 worker 与 scripts 可一起组装运行 |
| P2-03 | 接入 shipped packages | 在 round-2 spike 里直接 import `@nano-agent/storage-topology`、`@nano-agent/capability-runtime`、`@nano-agent/context-management`、`@nano-agent/hooks`、`@nano-agent/nacp-*` 等已 ship seam；只有 pure follow-up raw probe 可直接打原生 binding API | round-2 spike source files | integrated spike 与 Round 1 的核心差异被兑现 | build / import smoke | re-validation 路由不回退到 bare-metal |
| P2-04 | result / evidence shape | 为 round-2 `ProbeResult` 增加 `findingId / verdict / usedPackages / caveats / evidenceRefs` 等字段；规划 `.out/*.json`、tail logs、status diff table | `result-shape.ts`, scripts, docs | evidence 能直接写回 finding doc | local smoke | result shape 足够支撑 closure section |

### 4.3 Phase 3 — Round-2 follow-ups

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P3-01 | F08 binary-search + unexpected-F01 concurrent put | 在 storage r2 worker 上完成 `[1 MiB, 10 MiB]` binary-search，并用 `R2Adapter.putParallel()` 跑 10/50/100/200 并发档位 | `follow-ups/do-size-cap-binary-search.ts`, `follow-ups/r2-concurrent-put.ts` | exact DO cap 与 R2 concurrent baseline 可量化 | live probe | F08 有 measured cap；unexpected-F01 有 safe/default concurrency verdict |
| P3-02 | binding-F01 callee abort + binding-F04 true callback | worker-b 记录 `[slow] abort observed`；另将 eval fan-in 改成 worker-b push 到 worker-a sink endpoint，复验 ordering / dedup / overflow disclosure / backpressure | binding-pair r2 workers + `wrangler tail` | B1 C1 与 binding-F01 deferred truth 被真正补齐 | live probe + tail capture | 不再只是 response-body simulation；callee log 可审计 |
| P3-03 | F03 cross-colo/cacheTtl/100-sample | 在允许的账号/profile 下跑 cross-colo stale-read，覆盖 delay buckets、100 samples、`cacheTtl: 0` variant；如平台新增 strong-read option 也一并记录 | `follow-ups/kv-cross-colo-stale.ts` | B1 C3 weak evidence 被升级成 closure-level evidence | live probe | 未覆盖 cross-colo / 100-sample / cacheTtl 0 不得关闭 F03 |
| P3-04 | F09 owner URL high-volume | 获取 owner-supplied URL，按 50/100/200/500/1000 阶梯跑 curl fetch；记录 429 / subrequest limit / timeout / cpu_ms 行为 | `follow-ups/curl-high-volume.ts` | B3 conservative budget 得到真实上限参考 | live probe | 没有 owner URL 时明确保持 open / partial，不自行替换测试目标 |

### 4.4 Phase 4 — Integration re-validation + finding transition

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P4-01 | storage / workspace / context re-validation | 用 `R2Adapter / KvAdapter / DOStorageAdapter / D1Adapter / ReferenceBackend / MemoryBackend / context-management` 重跑 F01/F02/F04/F05/F06/F08/F03 及 B4 real deploy seam；显式保留 B2 caveat 注记 | `re-validation/storage.ts`, `re-validation/context.ts` | storage/context finding 通过 shipped seam 重测 | live probe | 每个 finding 都能指出“这次是通过哪个 shipped surface 被验证”的证据 |
| P4-02 | fake-bash / hooks / protocol / binding re-validation | 用 `capability-runtime`、B5 catalog reality、B6 dedup/protocol reality 重跑 F07/F09/binding-F02/binding-F03/binding-F04；验证 lowercase header law、permission/overflow metadata、frame-level dedup truth | `re-validation/bash.ts`, binding-pair r2 routes | non-storage finding 同样经过 shipped seam 重测 | live probe | 不再依赖 Round 1 的 raw truth 直接得出 phase verdict |
| P4-03 | finding status transition | 更新 13 required + 2 optional original finding docs 的 `§0 status` 与 round-2 closure section；若新增问题独立写成 `integrated-F*` docs，并链接 downstream issue | `docs/spikes/**`, `docs/spikes/round-2-integrated/**` | B1 finding 真正从“待验证”变成 closure verdict | 文档核对 | 没有只更新 rollup、不更新原 finding 的半套做法 |

### 4.5 Phase 5 — Discipline / docs / closure / handoff

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P5-01 | round-2 discipline check | 产出 `docs/spikes/_DISCIPLINE-CHECK-round-2.md`，按 7 条纪律逐项自检；其中 §3.7 明确记录 “Round 2 允许 import shipped packages” 的例外 | docs/spikes/** | Round 2 自身也可 audit，不只是 probe 结果可看 | 文档核对 | 6/7 strict + 1 modified nuance 被说清 |
| P5-02 | closure issue 系列 | 产出 `B7-phase-1/2/3-closure.md` 与 `B7-final-closure.md`，记录 raw evidence、follow-up verdict、status transition summary、剩余 blocker | docs/issue/after-foundations/** | B7 phase closure 可追溯 | 文档核对 | closure docs 与 finding docs / `.out` / tail logs 相互可追踪 |
| P5-03 | 给 B8 输出 handoff bundle | 总结 exact cap、curl calibrated budget、KV freshness verdict、true callback sink truth、13+2 status map、residual blockers（若有） | B7 docs + downstream notes | B8 / worker-matrix 不再依赖 B1/B2-B6 零散材料自行拼装 | 人工核对 | 至少形成一份可直接引用的 verdict bundle |

---

## 5. 测试与验证策略

### 5.1 Round-2 启动前必须确认的 shipped package 命令

| 包 / 层 | 命令 | 目的 |
|---|---|---|
| `@nano-agent/storage-topology` | `pnpm --filter @nano-agent/storage-topology typecheck && pnpm --filter @nano-agent/storage-topology build && pnpm --filter @nano-agent/storage-topology test && pnpm --filter @nano-agent/storage-topology build:schema && pnpm --filter @nano-agent/storage-topology build:docs` | 确认 B2 shipped surface 仍可作为 round-2 substrate |
| `@nano-agent/workspace-context-artifacts` | `pnpm --filter @nano-agent/workspace-context-artifacts typecheck && pnpm --filter @nano-agent/workspace-context-artifacts build && pnpm --filter @nano-agent/workspace-context-artifacts test` | 确认 workspace/reference backend seam 仍稳定 |
| `@nano-agent/capability-runtime` | `pnpm --filter @nano-agent/capability-runtime typecheck && pnpm --filter @nano-agent/capability-runtime build && pnpm --filter @nano-agent/capability-runtime test` | 确认 B3 fake-bash surface 可被 round-2 导入 |
| `@nano-agent/context-management` | `pnpm --filter @nano-agent/context-management typecheck && pnpm --filter @nano-agent/context-management build && pnpm --filter @nano-agent/context-management test` | 确认 B4 real package seam 已 ready |
| `@nano-agent/hooks` | `pnpm --filter @nano-agent/hooks typecheck && pnpm --filter @nano-agent/hooks build && pnpm --filter @nano-agent/hooks test && pnpm --filter @nano-agent/hooks build:schema && pnpm --filter @nano-agent/hooks build:docs` | 确认 B5 catalog truth 可作为 re-validation 输入 |
| `@nano-agent/nacp-core` | `pnpm --filter @nano-agent/nacp-core typecheck && pnpm --filter @nano-agent/nacp-core build && pnpm --filter @nano-agent/nacp-core test && pnpm --filter @nano-agent/nacp-core build:schema && pnpm --filter @nano-agent/nacp-core build:docs` | 确认 B6 protocol truth 已固定 |
| `@nano-agent/nacp-session` | `pnpm --filter @nano-agent/nacp-session typecheck && pnpm --filter @nano-agent/nacp-session build && pnpm --filter @nano-agent/nacp-session test && pnpm --filter @nano-agent/nacp-session build:schema && pnpm --filter @nano-agent/nacp-session build:docs` | 确认 session profile truth 已固定 |
| `@nano-agent/eval-observability` + `@nano-agent/session-do-runtime` | `pnpm --filter @nano-agent/eval-observability typecheck && pnpm --filter @nano-agent/eval-observability build && pnpm --filter @nano-agent/eval-observability test && pnpm --filter @nano-agent/session-do-runtime typecheck && pnpm --filter @nano-agent/session-do-runtime build && pnpm --filter @nano-agent/session-do-runtime test` | 确认 dedup / overflow / sink truth 可被 round-2 验证 |
| root | `node --test test/*.test.mjs && pnpm test:cross` | 确认 root contract/e2e baseline 仍绿 |

### 5.2 round-2 spike 自身必须提供的执行入口

| 入口 | 用途 | 说明 |
|---|---|---|
| `deploy:dry-run` | 配置/资源预检 | round-2 worker 在真正 deploy 前先验证 bindings/profile |
| `deploy` / `deploy-both` | 部署 round-2 worker | storage 和 binding-pair 分别部署 |
| `tail` | 抓取 callee abort / push callback evidence | 特别用于 binding-F01 / binding-F04 |
| `scripts/run-all-probes.*` | 统一执行 follow-up + re-validation | 输出 `.out/*.json` 与 summary |
| `scripts/extract-finding.*` | 从 raw result 提取 round-2 closure section 草案 | 减少手工误抄 |

### 5.3 B7 必须捕获的 evidence artifacts

- round-2 worker URL / version hash / resource IDs
- `.out/*.json` raw probe outputs
- `wrangler tail` logs（尤其是 binding-F01 / binding-F04）
- finding status diff table（before → after）
- original finding doc 新增的 round-2 closure section
- `integrated-F*` docs（如有）
- `_DISCIPLINE-CHECK-round-2.md`
- `B7-phase-*` / `B7-final-closure.md`

### 5.4 B7 特有的 probe / regression 类型

- **binary-search probe**：每个 size 至少 3 samples，避免把偶发 flake 当平台上限
- **cross-colo freshness probe**：按 delay bucket、100 samples、`cacheTtl: 0` variant 组织
- **true callback push-path probe**：必须区分 response-batch simulation 与 worker-to-worker push callback
- **integration re-validation route set**：每条 Round 1 finding 都要能映射到 “本次通过哪个 shipped seam 被验证”

---

## 6. 风险与注意事项

### 6.1 执行风险表

| 风险 | 触发条件 | 影响 | 应对 |
|---|---|---|---|
| owner gate 阻塞 | F09 URL 未提供；F03 所需 region/profile 无法建立 | B7 无法完全闭合 | 保持 open / partial；在 B7 final closure 中显式升级 |
| 把 B2 substrate 当 final router | re-validation 直接依赖 `listAll()` exhaustive / `ReferenceBackend` orphan-free 假设 | 误判 B2 已完全吸收 platform truth | 在 probe/result 中显式记录 caveat 与验证边界 |
| `binding-F04` 仍按旧方式测 | 继续看 response body，而不是 true push callback | B6/B7 dedup truth 仍停留在旧假设 | 强制 worker-b -> worker-a sink push path |
| round-2 污染 round-1 baseline | 复用同名 worker 或同一组 KV/R2/D1 资源 | 历史 evidence 不可比较 | 独立 naming / resource isolation |
| 新发现无处安放 | round-2 暴露 shipped bug，但只改老 finding status | 新问题被淹没 | 新建 `integrated-F*` docs + downstream issue |

### 6.2 B7 特别注意的 8 个约束

1. **B7 不是 B2-B6 的补代码 phase**：它主要负责验证、定性、留 issue，不是把 upstream phase 重新做一遍。
2. **follow-up 数量以 7 为准**：任何文档若仍写 5 项，Phase 1 必须先回写口径。
3. **F03 不能被 same-colo 替代**：没有 cross-colo / 100-sample / `cacheTtl: 0` variant，就不能声称 closure。
4. **F09 不能用默认 URL 冒充 owner input**：没拿到 owner URL 时，最多做 exploratory run，不得据此关闭 finding。
5. **`binding-F04` 必须测 push path**：否则 B6 的 dedup/disclosure truth仍只在 simulation 层成立。
6. **B2 caveat 不能在 B7 中被抹平**：`listAll()` bounded sweep 与 `ReferenceBackend` cleanup caveat 仍要写进 result 与 closure note。
7. **`still-open` 是合法但昂贵的结果**：如果真实无法闭合，就升级 issue / handoff，而不是降级描述。
8. **验证的是 protocol/runtime truth，不是版本号**：即使 `nacp-session` 保持 `1.1.0`，B7 也要按实际 wire/profile truth 验证。

---

## 7. Definition of Done（B7）

| 维度 | DoD | 说明 |
|---|---|---|
| 部署 | round-2 storage + binding-pair workers 可独立 deploy | 与 Round 1 物理隔离 |
| follow-ups | 7 项 follow-up / caveat 全有 raw evidence | 不再停留在口头 defer |
| re-validation | 13 required + 2 optional finding 全部经 shipped seam 重跑 | 每条 finding 都能指向具体 seam |
| 文档 | original finding docs、`integrated-F*`（如有）、discipline check、closure issues 全齐 | 形成可 audit 文档链 |
| 状态迁移 | finding 状态被真正更新 | 不只新增 rollup，不只留 `.out` |
| handoff | 给 B8 输出 verdict bundle | worker-matrix 不再需要自己倒推 B1-B6 |

---

## 8. Action-plan-level exit criteria

本 action-plan 的收口标准：

1. `spikes/round-2-integrated/` 目录树与 2 组 round-2 worker skeleton 已建立
2. round-2 worker 使用 separate names / separate resources，未污染 Round 1 baseline
3. 7 项 follow-up / caveat probe 全部有 raw evidence 与 closure verdict
4. 13 required B1 finding 全部完成 round-2 re-validation
5. 2 optional unexpected finding 同样完成 round-2 re-validation 或明确 dismissal
6. original finding docs 的 `§0 status` 与 round-2 closure section 已更新
7. 新增真实问题（若有）已写成 `integrated-F*` finding，而不是被吞进旧 finding
8. `docs/spikes/_DISCIPLINE-CHECK-round-2.md` 已交付
9. `docs/issue/after-foundations/B7-phase-1-closure.md`、`B7-phase-2-closure.md`、`B7-phase-3-closure.md`、`B7-final-closure.md` 已交付
10. 给 B8 / worker-matrix 的 verdict bundle 已形成，且不再依赖隐式口头背景

---

## 9. B7 对下游 phase 的直接输出

| 下游 phase | B7 输出 | 为什么重要 |
|---|---|---|
| **B8 / worker-matrix** | exact DO cap、calibrated curl budget、KV freshness verdict、true callback sink truth、13+2 status map、residual blockers list | worker-matrix 不应再自己做平台真相猜测 |
| **后续 storage/context 调整** | B2 substrate 在真实 integrated runtime 下的 caveat 是否仍成立 | 决定后续是 minor calibration 还是结构性 reopen |
| **后续 protocol/hooks 调整** | B6 dedup/disclosure 是否在 push path 成立；B5 deferred items 是否仍应保持 deferred | 防止在 worker-matrix 前带着错误 protocol assumption 前进 |

---

## 10. 关闭前提醒

- B7 的价值不在于“证明前面都做对了”，而在于**把哪些真的被平台消化、哪些仍然没被消化说清楚**
- 如果 B7 暴露的是 packages/ ship bug，就把它写成 `integrated-F*` + downstream issue；不要在 spike 里偷偷 hotfix 然后假装没事
- `binding-F04` 是本 phase 的关键诚实度测试：**没跑 true callback push path，就不要说 dedup/disclosure 已完成 cross-worker closure**
- `F03` 和 `F09` 都带 owner/platform gate；因此 B7 的一个重要工程价值就是把“无法继续自动推进的地方”显式暴露出来
- B7 完成后，B8 才拥有真正可靠的 handoff 输入；在此之前，worker-matrix 仍然不应该起跑
