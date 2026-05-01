# Nano-Agent 行动计划 — HPX1 Worker Test Cleanup + Enhance

> 服务业务簇: `hero-to-pro / HPX1`
> 计划对象: `按当前 6-worker 拓扑重分类测试资产，清理失效 / 占位测试，并为内部与 e2e matrix 的确认缺口补齐最小可信守卫`
> 类型: `modify + cleanup + test + docs`
> 作者: `Owner + GPT-5.4`
> 时间: `2026-05-01`
> 文件位置:
> - `test/package-e2e/**`
> - `test/cross-e2e/**`
> - `test/root-guardians/**`
> - `test/index.md`
> - `docs/architecture/test-topology.md`
> - `workers/{bash-core,orchestrator-auth,orchestrator-core,agent-core,context-core,filesystem-core}/test/**`
> 上游前序 / closure:
> - `docs/issue/hero-to-pro/HP10-closure.md`
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
> - `docs/architecture/test-topology.md`
> 下游交接:
> - `docs/issue/hero-to-pro/HPX1-closure.md`
> 关联设计 / 调研文档:
> - `docs/eval/hero-to-pro/HPX1-test-analysis-by-deepseek.md`
> - `docs/eval/hero-to-pro/HPX1-test-analysis-by-GLM.md`
> - `docs/eval/hero-to-pro/HPX1-test-analysis-by-kimi.md`
> - `docs/charter/plan-hero-to-pro.md`
> - `docs/charter/plan-worker-matrix.md`
> - `test/index.md`
> 冻结决策来源:
> - `docs/charter/plan-hero-to-pro.md` D1-D4 / §1.2（只读引用；本 action-plan 不填写 Q/A）
> - `docs/charter/plan-worker-matrix.md` §1.2 / §2.2 / §4（只读引用；本 action-plan 不填写 Q/A）
> - `docs/architecture/test-topology.md` §1-§6（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `draft`

---

## 0. 执行背景与目标

HPX1 不是“再多补几条测试”或“顺手删几个旧文件”的零散清理，而是要把 hero-to-pro 冻结后的测试资产重新压回**当前真实拓扑**。三份评审都抓到了同一个大问题：测试树里同时混着历史拓扑残留、live-gated scaffold、真正仍有价值的守卫，以及少量已经能被代码直接证伪的陈旧断言。如果继续把这些资产混在一起，`pnpm test:e2e` 与 `docs/architecture/test-topology.md` 会继续向后续实现者传递错误的质量信号。

本轮核查有一个关键历史分界：`a8e8e33`（ZX3/ZX4）之后，`test/shared/live.mjs` 已明确只有 `orchestrator-core` 具备默认 public URL，5 个 leaf worker 改为 `workers_dev: false`，`cross-e2e/07-library-worker-topology-contract.test.mjs` 也被改写成 marker。换句话说，HPX1 的核心不是“继续沿用 worker-matrix 时期对 leaf worker 的直接 public probe”，而是把所有测试重新对齐到 **worker-local / root-guardians / package-e2e / cross-e2e** 四层现行职责之下。

- **服务业务簇**：`hero-to-pro / HPX1`
- **计划对象**：`hero-to-pro 冻结后测试资产的 truth realignment`
- **本次计划解决的问题**：
  - pre-ZX3 / pre-HP10 的拓扑假设仍留在 `test/package-e2e/` 与 `test/cross-e2e/` 中，形成失效或 pass-shaped 的假覆盖。
  - 部分真正有价值的断言落在了错误层级（例如 bash-core HTTP 边界测试停留在 package-e2e，而 worker-local 没有等价守卫）。
  - `test/index.md` 与 `docs/architecture/test-topology.md` 已存在，但对“哪些测试仍 live、哪些已是 scaffold / stale / retired”描述不完整。
- **本次计划的直接产出**：
  - 一份按当前 6-worker reality 重写的测试分层裁决与 per-file 处置清单。
  - 对 stale / mislayered / placeholder 测试的删除、迁移、替换与最小增补方案。
  - `test/index.md` 与 `docs/architecture/test-topology.md` 的同步修订，以及 HPX1 closure 的收口输入。
- **本计划不重新讨论的设计结论**：
  - 6-worker 拓扑仍是冻结事实，`worker-health` 的 6-worker 断言是 guard，而不是应被“动态化”的坏味道（来源：`docs/charter/plan-hero-to-pro.md` D1；`docs/charter/plan-worker-matrix.md` §2.2）。
  - leaf worker 是 binding-first posture；direct public URL probe 不是它们的 canonical 交付路径（来源：`docs/charter/plan-worker-matrix.md` §4；`test/shared/live.mjs` 当前注释与默认 URL）。
  - 仓库已经有 4 层测试结构，HPX1 的任务是让资产回到正确层，而不是再造第 5 层（来源：`test/index.md:1-74`；`docs/architecture/test-topology.md:49-57`）。
  - live-gated scaffold 不能继续被记作 delivered coverage；凡只靠 `200` 或 marker 注释通过的测试，都不能充当 HPX1 之后的质量门（来源：`docs/architecture/test-topology.md:61-72` 与 `test/cross-e2e/15-21*.test.mjs` 当前内容）。

---

## 1. 执行综述

### 1.1 总体执行方式

HPX1 采用**先按当前代码与 git 历史做测试分层 truth snapshot → 再清理拓扑失效与占位资产 → 再把仍有价值但放错层的断言回迁到 worker-local → 最后只为真正需要 live / cross-worker 证明的场景补最小可信 e2e** 的顺序。先分层定性，能避免把仍有价值的 guard 跟 stale residue 一起删掉；而把 live e2e 放在最后，则能确保只留下可观察、可解释、可维护的跨 worker 证明。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Reality Snapshot + Stratification Verdict | M | 用当前代码、测试文档与 git 历史重建测试真相与 per-file 处置表 | `-` |
| Phase 2 | Stale Suite Cleanup + Layer Rehoming | L | 删除拓扑失效 / marker / 错层 package-e2e，并把仍有价值的断言迁回正确层 | Phase 1 |
| Phase 3 | Worker-Internal Boundary Backfill | M | 为 bash-core / orchestrator-auth / orchestrator-core 补齐确认缺口，并清掉低风险 stale/duplicate 测试 | Phase 1-2 |
| Phase 4 | Cross-E2E Replacement + Docs Sync | M | 让 cross-e2e 只保留真实断言，移除 placeholder，并同步测试拓扑文档 | Phase 1-3 |
| Phase 5 | Regression + Closure Handoff | S | 用现有命令收口，并为 HPX1 closure 建立可审计输入 | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — Reality Snapshot + Stratification Verdict**
   - **核心目标**：先搞清“什么仍然有效、什么只是历史残影、什么属于错误层级”。
   - **为什么先做**：没有这一层，后续删除与补强都会建立在评审意见而不是仓库 reality 上。
2. **Phase 2 — Stale Suite Cleanup + Layer Rehoming**
   - **核心目标**：把确认失效的 package-e2e / cross-e2e 从树里拿掉，同时保住仍有价值的断言。
   - **为什么放在这里**：不先去掉 stale residue，后面的缺口补强会继续被假覆盖掩盖。
3. **Phase 3 — Worker-Internal Boundary Backfill**
   - **核心目标**：把本应在 worker-local 层证明的边界补齐，减少 live-only 测试对基础契约的承载。
   - **为什么放在这里**：只有本地确定性边界先站稳，live e2e 才能专注于真正的跨 worker 事实。
4. **Phase 4 — Cross-E2E Replacement + Docs Sync**
   - **核心目标**：替换或删除 placeholder cross-e2e，并把 `test/index.md` / `test-topology.md` 改成可执行 truth。
   - **为什么放在这里**：经过前两阶段后，哪些场景必须保留 live 证明、哪些应当退休，边界才清楚。
5. **Phase 5 — Regression + Closure Handoff**
   - **核心目标**：用仓库现有命令做最终回归，并把 HPX1 的最终裁决交给 closure。
   - **为什么最后**：只有测试树和文档都收敛了，closure 才不会再写成“边做边记”。

### 1.4 执行策略说明

- **执行顺序原则**：先做分层裁决，再删/迁，再补 worker-local，再补 live cross-e2e；不允许边删边猜。
- **风险控制原则**：每个争议文件都必须落到 `keep / delete / migrate / replace` 四选一；禁止以“先保留再说”维持不确定状态。
- **测试推进原则**：worker-local 负责 deterministic 边界与输入错误；package-e2e / cross-e2e 只保留 deploy / public facade / multi-worker 的真实证明。
- **文档同步原则**：`test/index.md` 是目录级真相，`docs/architecture/test-topology.md` 是阶段冻结真相；两份文档必须同时更新，不能一个修一个漂。
- **回滚 / 降级原则**：若某个 stale e2e 仍承载唯一可观察事实，必须先把断言迁移或替换，再删除旧文件；不允许先删后想。

### 1.5 本次 action-plan 影响结构图

```text
hero-to-pro HPX1 test cleanup + enhance
├── Phase 1: Reality Snapshot + Stratification Verdict
│   ├── eval reports × 3 verdict register
│   ├── git-history topology truth
│   └── per-file keep/delete/migrate/replace matrix
├── Phase 2: Stale Suite Cleanup + Layer Rehoming
│   ├── package-e2e leaf-worker stale suites
│   ├── cross-e2e/07 marker retirement
│   └── bash-core / agent-core assertion rehoming
├── Phase 3: Worker-Internal Boundary Backfill
│   ├── bash-core HTTP boundary tests
│   ├── orchestrator-auth entrypoint/RPC adapter tests
│   ├── orchestrator-core auth-negative补强
│   └── low-risk stale/duplicate cleanup
├── Phase 4: Cross-E2E Replacement + Docs Sync
│   ├── retire 200-only placeholder files
│   ├── add real cross-worker assertions
│   ├── test/index.md
│   └── docs/architecture/test-topology.md
└── Phase 5: Regression + Closure Handoff
    ├── pnpm test / test:contracts / targeted e2e
    └── docs/issue/hero-to-pro/HPX1-closure.md input pack
```

### 1.6 已核对的当前代码锚点

1. **leaf worker direct public probe 已不是当前 topology 的默认真相**
   - `test/shared/live.mjs:4-13`
   - `workers/{agent-core,bash-core,context-core,filesystem-core,orchestrator-auth}/wrangler.jsonc:7-8`
2. **`cross-e2e/07` 已在 ZX3/ZX4 后被显式降级为 marker，而不是有效断言**
   - `test/cross-e2e/07-library-worker-topology-contract.test.mjs:5-23`
   - `git blame test/cross-e2e/07-library-worker-topology-contract.test.mjs:5-21`（`a8e8e33`）
3. **context-core / filesystem-core worker-local smoke 现在守护的是 `401 binding-scope-forbidden`，不是 package-e2e 里写的 `404`**
   - `workers/context-core/test/smoke.test.ts:41-58`
   - `workers/filesystem-core/test/smoke.test.ts:41-58`
4. **orchestrator-auth 的 public route 现行真相是 `401 binding-scope-forbidden`，而非 package-e2e 中的 `404`**
   - `workers/orchestrator-auth/src/public-surface.ts:29-45`
   - `workers/orchestrator-auth/test/public-surface.test.ts:18-31`
   - `test/package-e2e/orchestrator-auth/01-probe.test.mjs:17-24`
5. **bash-core 的 package-e2e 04/05/06 承载了有价值的 HTTP 边界断言，但它们现在位于错误层，而且 live 请求缺少内部绑定前提**
   - `test/package-e2e/bash-core/04-capability-sampling.test.mjs:31-54`
   - `test/package-e2e/bash-core/05-capability-error-envelopes.test.mjs:28-75`
   - `test/package-e2e/bash-core/06-capability-malformed-body.test.mjs:36-85`
   - `workers/bash-core/src/index.ts:455-494`
6. **cross-e2e 15-21 当前全部是 pass-shaped scaffold，而不是功能证明**
   - `test/cross-e2e/15-hp2-model-switch.test.mjs:12-53`
   - `test/cross-e2e/16-hp3-context-machine.test.mjs:9-49`
   - `test/cross-e2e/17-hp4-lifecycle.test.mjs:9-46`
   - `test/cross-e2e/18-hp5-confirmation-roundtrip.test.mjs:9-39`
   - `test/cross-e2e/19-hp6-tool-workspace.test.mjs:6-45`
   - `test/cross-e2e/20-hp7-checkpoint-restore.test.mjs:6-44`
   - `test/cross-e2e/21-hp8-heartbeat-posture.test.mjs:6-30`
7. **测试分层文档并非缺失，而是 truth drift**
   - `test/index.md:24-75`
   - `docs/architecture/test-topology.md:49-72,75-126`
8. **并非所有“看起来硬编码”的测试都应动态化；`worker-health` 当前是在守护冻结拓扑**
   - `test/package-e2e/orchestrator-core/08-worker-health.test.mjs:4-26`
   - `workers/orchestrator-core/test/smoke.test.ts:58-85`
   - `docs/charter/plan-hero-to-pro.md:102-109`

### 1.7 三份评审逐项裁决表

| 来源 | 编号 | 核查结论 | 在 HPX1 的处理 |
|------|------|----------|----------------|
| Kimi | R1 | `采纳` | `bash-core/02-03` 与 worker smoke 重复，且 post-ZX3 已不应作为 direct package-e2e 保留，Phase 2 删除。 |
| Kimi | R2 | `采纳（并收紧）` | `context-core/02` 与 `filesystem-core/02` 不仅前置条件失效，而且当前 truth 是 `401`，Phase 2 删除旧 e2e，不再保留 404 口径。 |
| Kimi | R3 | `采纳` | `orchestrator-core/07` 实测的是 agent-core legacy 路由，Phase 2 合并到 agent-core-local 覆盖后删除 e2e 文件。 |
| Kimi | R4 | `采纳` | `cross-e2e/07` 已被历史改写成 marker，Phase 2 退休该文件，并把 replacement 写入文档。 |
| Kimi | R5 | `部分采纳` | orchestrator-auth 并非“几乎没测”；已有 `service.test.ts` 和 `public-surface.test.ts`。真实缺口是 WorkerEntrypoint fetch/RPC adapter 测试，Phase 3 补这一层，而不是新增 public auth route 测试。 |
| Kimi | R6 | `采纳` | package-e2e `06-auth-negative` 仍有 live 价值，但 worker-local 缺 malformed JWT negative，Phase 3 补 internal case，保留 live negative。 |
| Kimi | R7 | `采纳` | agent-core stale 历史注释确实存在，作为 low-risk cleanup 纳入 Phase 3。 |
| Kimi | R8 | `部分采纳` | 测试分层文档已存在，问题是 truth drift 而非“完全没有文档”；Phase 1/4 更新 `test/index.md` 与 `test-topology.md`。 |
| GLM | R1 | `采纳` | `cross-e2e/15-21` 31 个 `200-only` 占位测试必须退出主树的“已覆盖”语义，Phase 4 只保留有真实 oracle 的文件，其余退休。 |
| GLM | R2 | `不采纳` | `tool-call-live-loop.test.mjs` 依当前 `test/index.md` 与 root guard 定义仍属于 repo-level contract guard，不作为 HPX1 blocker；只在未来 topology 变更时再评估位置。 |
| GLM | R3 | `采纳（并收紧）` | `context-core/02`、`filesystem-core/02` 应离开 package-e2e；HPX1 直接退休旧文件，而不是保留为同名 live suite。 |
| GLM | R4 | `部分采纳` | orchestrator-core 路由测试的 SQL mock 确有脆弱性，但它不是本轮 topology cleanup 的首阻塞；仅在 Phase 3 作为 opportunistic hardening。 |
| GLM | R5 | `部分采纳` | helper 重复属真实维护债，但不应压过 stale suite cleanup；Phase 3 只处理与本轮改动直接相邻的重复 helper。 |
| GLM | R6 | `部分采纳` | `setTimeout` 脆弱性成立，但属于 test-fitness follow-up，不列为 HPX1 首轮 blocker。 |
| GLM | R7 | `不采纳` | `execution-error` 与 `handler-error` 来自不同层：前者是 executor 捕获抛错，后者是 handler 返回的显式错误，当前语义区分成立。 |
| GLM | R8 | `采纳（改写落点）` | legacy 测试目录确实错位，但处理方式是并回 agent-core-local，而不是简单改目录继续保留为 package-e2e。 |
| GLM | R9 | `采纳` | `cross-e2e/07` 为空操作文件，Phase 2 明确退休。 |
| GLM | R10 | `部分采纳` | 常量守卫类测试可加注释，但不是 HPX1 阻塞项；仅在 touched file 时顺带修。 |
| GLM | R11 | `部分采纳` | nacp-session stream-event 正向覆盖不足是真问题，但不属于本轮“worker-test-cleanup-and-enhance”的主战场，列入 non-blocking follow-up。 |
| GLM | R12 | `部分采纳` | `user-do.test.ts` 过长成立，但应视 Phase 3 时间窗处理，不与 stale e2e cleanup 绑成 blocker。 |
| GLM | R13 | `不采纳` | `worker-health` 硬编码 6-worker 是对冻结拓扑的 guard，不应动态化。 |
| GLM | R14 | `部分采纳` | R2 10 MiB 边界测试是有效 follow-up，但不列为 HPX1 主阻塞。 |
| DeepSeek | R1 | `采纳（并收紧）` | mislayered package-e2e 问题成立，但实际应清理的不止 12 个文件；连 `orchestrator-auth/01` 也已与现行 `401` 真相冲突。 |
| DeepSeek | R2 | `部分采纳` | 部分 duplicate pair 确认成立（如 `compact-reinject`、`eval/sink`、`composition-local-ts-fallback`），但 HPX1 只处理低风险、证据最干净的几项。 |
| DeepSeek | R3 | `采纳` | bash-core HTTP 输入验证 / 错误分类应回到 worker-local，Phase 2-3 执行迁移与替换。 |
| DeepSeek | R4 | `部分采纳` | `orchestration.test.ts` 过大是维护债，但不作为 HPX1 首轮 blocker。 |
| DeepSeek | R5 | `采纳（改写落点）` | `orchestrator-core/07` 的目录与层级问题成立，但 HPX1 选择 local merge + package-e2e retirement。 |
| DeepSeek | R6 | `部分采纳` | `09-api-key-smoke` 直接 D1 INSERT 是风险，但不属于本轮 stale test cleanup 的首阻塞；列为 follow-up。 |
| DeepSeek | R7 | `采纳` | `eval/sink.test.ts` 仅测试 test-only 接口，Phase 3 作为低风险删除候选。 |
| DeepSeek | R8 | `部分采纳` | `InMemoryAuthRepository` 重复定义成立，但只在 Phase 3 与 orchestrator-auth 测试增补同做时顺带抽取。 |

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 为所有争议测试文件建立 `keep / delete / migrate / replace` 裁决，并把裁决落到代码与文档。
- **[S2]** 清理 post-ZX3 后已失效的 package-e2e leaf-worker suites、`cross-e2e/07` marker，以及目录错位的 legacy retirement 测试。
- **[S3]** 将 bash-core 当前仍有价值的 HTTP 边界断言回迁至 worker-local，并补齐 orchestrator-auth / orchestrator-core 的确认缺口。
- **[S4]** 处理 `cross-e2e/15-21` 的 placeholder pass-shaped 文件：要么升级为真实断言，要么显式退休。
- **[S5]** 更新 `test/index.md` 与 `docs/architecture/test-topology.md`，让测试分层文档与当前现实重新对齐。
- **[S6]** 为 HPX1 closure 准备最终变更清单、保留项清单和回归命令结果。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 新增测试框架、统一改写全部测试风格，或重做整个测试目录结构。
- **[O2]** 将 `worker-health` 从 6-worker guard 改为动态拓扑断言。
- **[O3]** 对所有 helper duplication、SQL mock、setTimeout 脆弱性做仓库级总清理；本轮只处理与 HPX1 直接相邻的部分。
- **[O4]** 重做 `09-api-key-smoke.test.mjs` 的 live fixture bootstrap 流程；该项只记录风险与后续方向。
- **[O5]** 为每个 HP2-HP8 scaffold 都立刻补齐全量 live e2e；HPX1 只保留那些当前有稳定 observable oracle 的场景。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `test/package-e2e/{agent-core,bash-core,context-core,filesystem-core,orchestrator-auth}/*` | `in-scope` | 这些文件与 post-ZX3 拓扑直接冲突，已构成 stale suite | 若未来这些 worker 再次获得 public surface，重新评估 |
| `test/root-guardians/tool-call-live-loop.test.mjs` 迁位 | `out-of-scope` | 现行目录定义和 guard 语义仍成立，不是 HPX1 首阻塞 | 若 root guard 章程改写，再重评 |
| `test/package-e2e/orchestrator-core/08-worker-health.test.mjs` 动态化 | `out-of-scope` | 6-worker 拓扑冻结，当前硬编码是 guard 而非漂移 | 仅当 charter 改成可扩缩 worker matrix 时重评 |
| `test/package-e2e/orchestrator-core/09-api-key-smoke.test.mjs` 全面改造 | `defer` | 存在真实风险，但优先级低于 stale suite cleanup 与 placeholder retirement | HPX1 closure 后单开 follow-up |
| `packages/*` 层的 coverage hardening（如 R2 10MiB 边界、quota 计算） | `defer` | 这些问题真实但不阻断 HPX1 的主任务：测试分层真相重建 | 当 HPX1 主清理完成后重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | stratification verdict matrix | `update` | reports + `test/index.md` + `docs/architecture/test-topology.md` + test tree | 建立当前测试树唯一裁决基线 | `high` |
| P1-02 | Phase 1 | git-history topology audit | `update` | `test/shared/live.mjs`, `cross-e2e/07`, related package-e2e files | 把“为何失效”写成可审计历史事实 | `medium` |
| P2-01 | Phase 2 | leaf-worker package-e2e retirement | `remove` | `test/package-e2e/{agent-core,bash-core,context-core,filesystem-core,orchestrator-auth}/**` | 删除已不符合当前拓扑的 direct public probe 套件 | `high` |
| P2-02 | Phase 2 | bash-core assertion rehoming | `migrate` | `test/package-e2e/bash-core/{04,05,06}*.mjs` → `workers/bash-core/test/**` | 保住有价值断言，同时把它们放回正确层 | `high` |
| P2-03 | Phase 2 | marker / misplaced e2e cleanup | `remove` | `test/cross-e2e/07-*`, `test/package-e2e/orchestrator-core/07-*`, `workers/agent-core/test/smoke.test.ts` | 退休 marker 并把 legacy retirement 覆盖并回 agent-core-local | `medium` |
| P3-01 | Phase 3 | orchestrator-auth entrypoint coverage | `add` | `workers/orchestrator-auth/test/**` | 补齐 fetch/RPC adapter 与 envelope wrapper 的 worker-level 测试 | `medium` |
| P3-02 | Phase 3 | orchestrator-core auth-negative补强 | `add` | `workers/orchestrator-core/test/{auth.test.ts,smoke.test.ts}` | 补齐 malformed JWT 等 internal negative cases | `low` |
| P3-03 | Phase 3 | low-risk internal stale cleanup | `remove` | `workers/context-core/test/integration/compact-reinject.test.ts`, `workers/agent-core/test/eval/sink.test.ts`, related comments | 删掉证据最干净的 duplicate / stale 测试与注释 | `medium` |
| P4-01 | Phase 4 | placeholder cross-e2e retirement policy | `remove` | `test/cross-e2e/15-21*.test.mjs` | 让 cross-e2e 不再允许 200-only scaffold 冒充覆盖 | `high` |
| P4-02 | Phase 4 | real cross-worker replacement tests | `add` | `test/cross-e2e/**` | 为确认 / checkpoint / heartbeat / hook 等当前可观察场景保留真实 live 证明 | `high` |
| P4-03 | Phase 4 | topology docs sync | `update` | `test/index.md`, `docs/architecture/test-topology.md` | 让文档与 post-HPX1 真相完全一致 | `medium` |
| P5-01 | Phase 5 | regression command pack | `update` | root scripts + affected suites | 用仓库现有命令验证 HPX1 变更面 | `medium` |
| P5-02 | Phase 5 | HPX1 closure handoff | `update` | future `docs/issue/hero-to-pro/HPX1-closure.md` | 为 closure 提供删除/保留/替换/验证证据索引 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Reality Snapshot + Stratification Verdict

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | stratification verdict matrix | 基于 3 份评审、当前测试树、`test/index.md`、`test-topology.md` 和代码锚点，建立 per-file `keep/delete/migrate/replace` 清单 | eval docs + test/docs tree | HPX1 的所有后续改动都有唯一裁决表可依赖 | file audit + doc review | 所有争议文件都有明确去向 |
| P1-02 | git-history topology audit | 用 `2046e97` → `702a89e` → `a8e8e33` 的历史链说明 worker-matrix 时代测试如何在 ZX3/ZX4 后失效 | `test/shared/live.mjs`, `cross-e2e/07`, package-e2e stale files | “为什么删/迁”不再停留在口头判断 | git review | 每个被退休文件都有历史原因说明 |

### 4.2 Phase 2 — Stale Suite Cleanup + Layer Rehoming

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | leaf-worker package-e2e retirement | 删除 direct public probe 失效的 leaf-worker package-e2e 套件；orchestrator-auth 旧 probe 一并清理 | `test/package-e2e/{agent-core,bash-core,context-core,filesystem-core,orchestrator-auth}/**` | stale deploy suites 不再制造假覆盖 | targeted e2e listing + grep | 相关 stale 文件退出主树 |
| P2-02 | bash-core assertion rehoming | 把 `04/05/06` 的 HTTP sampling / error taxonomy / malformed-body 断言迁入 bash-core worker-local 测试 | `workers/bash-core/test/**` | 有价值断言保留，但不再依赖 live direct fetch | worker-local tests | bash-core worker-local 具备完整 HTTP 边界守卫 |
| P2-03 | marker / misplaced cleanup | 退休 `cross-e2e/07` marker；将 legacy retirement 覆盖并回 `agent-core` local 测试后删除 package-e2e 旧文件 | `test/cross-e2e/07-*`, `test/package-e2e/orchestrator-core/07-*`, `workers/agent-core/test/smoke.test.ts` | marker 与目录错位资产从主树消失 | worker-local tests + file existence check | 相关行为仍被覆盖，但旧路径已删除 |

### 4.3 Phase 3 — Worker-Internal Boundary Backfill

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | orchestrator-auth entrypoint coverage | 为 `fetch()` public probe / guard 和 WorkerEntrypoint RPC wrapper 增加 worker-level 测试，覆盖 known error / misconfig / envelope wrapping | `workers/orchestrator-auth/test/**` | auth worker 的薄弱适配层不再依赖间接覆盖 | worker tests | entrypoint fetch + RPC adapter 都有直接测试 |
| P3-02 | orchestrator-core auth-negative补强 | 在 worker-local 层补 `malformed JWT` 等当前 live negative 独有但 local 缺失的 case | `workers/orchestrator-core/test/{auth.test.ts,smoke.test.ts}` | live negative 与 worker-local negative 重新对齐 | worker tests | 至少补齐 malformed JWT case |
| P3-03 | low-risk internal stale cleanup | 删除证据最干净的 duplicate / test-only / stale 注释，如 `compact-reinject`, `eval/sink.test.ts`, agent-core 历史注释残影 | `workers/context-core/test/**`, `workers/agent-core/test/**` | 内部测试树减少历史残影和零产出测试 | worker tests + diff review | 删除项都有对等 coverage 证明 |

### 4.4 Phase 4 — Cross-E2E Replacement + Docs Sync

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | placeholder cross-e2e retirement policy | 对 `15-21` 每个文件做二选一：升级成有真实 oracle 的 live test，或显式退休；禁止继续保留 200-only scaffold | `test/cross-e2e/15-21*.test.mjs` | cross-e2e 只剩真实证明，不再有 pass-shaped placeholder | cross-e2e audit | 主树中不再存在纯 200-only placeholder |
| P4-02 | real cross-worker replacement tests | 优先为当前已有稳定 oracle 的场景补真实 live 断言：confirmation roundtrip、checkpoint restore / fork、heartbeat posture；若 hook pretool block 有现成可观察路径，可追加一个真实 cross-worker 案例 | `test/cross-e2e/**` | live e2e 聚焦真正跨 worker / runtime 事实 | live e2e | 至少保留 2-3 个有真实断言的 HP-targeted cross-e2e |
| P4-03 | topology docs sync | 更新 `test/index.md` 的目录定义与 `test-topology.md` 的 retired/kept truth，使二者反映 HPX1 后的现状 | `test/index.md`, `docs/architecture/test-topology.md` | 测试文档不再把 stale suites 记作 live coverage | doc review | 文档与实际文件树、命令、retired guardians 对齐 |

### 4.5 Phase 5 — Regression + Closure Handoff

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | regression command pack | 运行 root tests、contracts、受影响 worker suites 与必要的 e2e 命令，确认 HPX1 没有引入新漂移 | `package.json` scripts + affected suites | HPX1 的验证方法可复制、可 handoff | command pack | 现有命令全部给出明确结果 |
| P5-02 | HPX1 closure handoff | 汇总 deleted / migrated / replaced / retained-with-reason 清单，并为 closure 文档准备证据索引 | future closure doc + action-plan references | HPX1 不会在 closure 阶段再重复做事实核查 | doc review | closure 只需消费 HPX1 结果，不需重建事实 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Reality Snapshot + Stratification Verdict

- **Phase 目标**：把 HPX1 的执行建立在 current-reality 而不是 review 文本复述之上。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 修改文件**：
  - `docs/action-plan/hero-to-pro/HPX1-worker-test-cleanup-and-enhance.md`
  - `test/index.md`
  - `docs/architecture/test-topology.md`
- **具体功能预期**：
  1. 每个争议测试文件都会被明确标成 `keep/delete/migrate/replace`。
  2. 三份评审的分歧点会被压成统一裁决，而不是在实现阶段继续靠个人判断。
  3. topology drift 的历史原因会被显式写出来，避免 reviewer 误以为是“主观偏好删测试”。
- **具体测试安排**：
  - **单测**：无新增单测。
  - **集成测试**：无；以 file audit 和 git history 为主。
  - **回归测试**：确认 `test/index.md` / `test-topology.md` 引用的路径真实存在。
  - **手动验证**：对照 3 份评审逐项核查表。
- **收口标准**：
  - per-file 裁决矩阵完整。
  - 关键历史节点（`2046e97` / `702a89e` / `a8e8e33`）已写入 action-plan 论证。
- **本 Phase 风险提醒**：
  - 如果跳过这个阶段，后续极易误删仍有价值的 guard，或继续保留纯 placeholder。

### 5.2 Phase 2 — Stale Suite Cleanup + Layer Rehoming

- **Phase 目标**：去掉确认失效的 suite，同时把仍有价值的断言放回正确层。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 删除文件**（按裁决执行）：
  - `test/package-e2e/agent-core/01-preview-probe.test.mjs`
  - `test/package-e2e/bash-core/{01-preview-probe,02-capability-call-route,03-capability-cancel-route}.test.mjs`
  - `test/package-e2e/context-core/{01-preview-probe,02-library-worker-posture}.test.mjs`
  - `test/package-e2e/filesystem-core/{01-preview-probe,02-library-worker-posture}.test.mjs`
  - `test/package-e2e/orchestrator-auth/01-probe.test.mjs`
  - `test/cross-e2e/07-library-worker-topology-contract.test.mjs`
  - `test/package-e2e/orchestrator-core/07-legacy-agent-retirement.test.mjs`
- **本 Phase 新增 / 修改文件**：
  - `workers/bash-core/test/http-input-validation.test.ts`（或等价命名）
  - `workers/bash-core/test/http-error-taxonomy.test.ts`（或与上者合并）
  - `workers/agent-core/test/smoke.test.ts`（并回 legacy retirement 覆盖）
- **具体功能预期**：
  1. leaf-worker stale package-e2e 从主树移除，不再误导为可运行 live suite。
  2. bash-core 现有有价值断言不丢失，而是转到 deterministic worker-local。
  3. `cross-e2e/07` 的“marker 语义”由文档承接，不再留在测试树里冒充测试。
- **具体测试安排**：
  - **单测**：新增 bash-core / agent-core worker tests。
  - **集成测试**：无新增集成；验证 rehomed assertions 覆盖等价行为。
  - **回归测试**：`pnpm --filter @haimang/bash-core-worker test`、`pnpm --filter @haimang/agent-core-worker test`。
  - **手动验证**：确认删除文件不再被 `test/index.md` / `test-topology.md` 记作 live guardian。
- **收口标准**：
  - stale suites 已删除。
  - rehomed assertions 已由 worker-local tests 承接。
  - package-e2e 不再包含违反当前 topology 的 direct leaf-worker public probe。
- **本 Phase 风险提醒**：
  - 迁移 bash-core 断言时若只删不迁，会让 HTTP 边界测试从 repo 中消失。

### 5.3 Phase 3 — Worker-Internal Boundary Backfill

- **Phase 目标**：把真正该由 worker-local 证明的边界补齐，减少 live 层承重。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - `workers/orchestrator-auth/test/entrypoint-rpc.test.ts`（建议命名）
- **本 Phase 修改文件**：
  - `workers/orchestrator-auth/test/public-surface.test.ts`
  - `workers/orchestrator-auth/test/service.test.ts`
  - `workers/orchestrator-core/test/{auth.test.ts,smoke.test.ts}`
  - `workers/context-core/test/**`
  - `workers/agent-core/test/**`
- **具体功能预期**：
  1. orchestrator-auth 的 WorkerEntrypoint fetch/RPC adapter 被直接测试，而不是继续靠 service 层间接覆盖。
  2. orchestrator-core local auth-negative 至少补齐 malformed JWT 这类 live 侧已出现的 case。
  3. 低风险 duplicate / stale test 被删除后，剩余 coverage 仍完整。
- **具体测试安排**：
  - **单测**：orchestrator-auth / orchestrator-core / context-core / agent-core 受影响套件。
  - **集成测试**：仅在 duplicate cleanup 涉及 integration test 时补回对等证明。
  - **回归测试**：`pnpm --filter @haimang/orchestrator-auth-worker test`、`pnpm --filter @haimang/orchestrator-core-worker test`、相关 worker tests。
  - **手动验证**：确认被删 duplicate 的代码路径仍有权威测试文件守护。
- **收口标准**：
  - orchestrator-auth entrypoint 层具备直接测试。
  - malformed JWT local negative 已补齐。
  - 仅删除证据最干净的 duplicate / test-only 文件，不留下 coverage 真空。
- **本 Phase 风险提醒**：
  - duplicate cleanup 若贪大求全，容易把 HPX1 拉成全仓测试重构；必须只做证据最干净的部分。

### 5.4 Phase 4 — Cross-E2E Replacement + Docs Sync

- **Phase 目标**：让 cross-e2e 退出“占位通过”时代，并让文档准确描述 surviving guardians。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增 / 修改文件**：
  - `test/cross-e2e/18-hp5-confirmation-roundtrip.test.mjs`
  - `test/cross-e2e/20-hp7-checkpoint-restore.test.mjs`
  - `test/cross-e2e/21-hp8-heartbeat-posture.test.mjs`
  - 视可观察 oracle 决定是否新增 `hook` 相关 cross-e2e
  - `test/index.md`
  - `docs/architecture/test-topology.md`
- **具体功能预期**：
  1. 主树中不再允许单纯断言 `response.status === 200` 的 cross-e2e 文件。
  2. 仅保留当前已有稳定 observable oracle 的 live 场景，例如 confirmation row / checkpoint restore / heartbeat event / hook block。
  3. `test/index.md` 与 `test-topology.md` 会显式记录 retired guardians 与 live-gated truth，不再写“none retired”。
- **具体测试安排**：
  - **单测**：无新增单测。
  - **集成测试**：按需要补充 supporting helper tests。
  - **端到端 / 手动验证**：`pnpm test:cross-e2e`；必要时在 `NANO_AGENT_LIVE_E2E=1` 下逐个场景验证。
  - **文档校验**：检查命令、路径、retired guardian 列表与实际文件树一致。
- **收口标准**：
  - `15-21` 中不再存在 placeholder pass-shaped 文件。
  - 至少保留一组真实 confirmation / checkpoint / heartbeat 级 live assertion。
  - 文档不再把 retired 或 stale suites 记成 live coverage。
- **本 Phase 风险提醒**：
  - 不应为了“保留编号”而硬留空壳文件；宁可显式退休，也不要继续制造假覆盖。

### 5.5 Phase 5 — Regression + Closure Handoff

- **Phase 目标**：把 HPX1 的结果变成可复验、可 closure、可 handoff 的最终状态。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/HPX1-closure.md`（未来）
- **具体功能预期**：
  1. 所有受影响测试层都能用仓库现有命令重跑。
  2. HPX1 的 deleted / migrated / replaced / retained-with-reason 清单可直接供 closure 使用。
  3. 后续 reviewer 不需要重新用 git 历史证明“这些测试为什么失效”。
- **具体测试安排**：
  - **基础校验**：root commands。
  - **单测**：所有受影响 worker suites。
  - **集成测试**：必要的 package-e2e / cross-e2e 子集。
  - **文档校验**：索引与 topology 文档一致性。
- **收口标准**：
  - canonical command pack 全部有明确结果。
  - closure 输入包完整。
- **本 Phase 风险提醒**：
  - 如果 closure 只写“删了一些旧测试”，而没有 per-file verdict 与命令证据，HPX1 会再次失去可审计性。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| D1: 6-worker 拓扑冻结 | `docs/charter/plan-hero-to-pro.md` D1 | `worker-health` 继续以 6-worker invariant 作为 guard；不做动态化 | 若后续 charter 改拓扑，HPX1 文档需重写 |
| leaf worker binding-first posture | `docs/charter/plan-worker-matrix.md` §2.2 / §4 | direct public probe 的 package-e2e 不再是 canonical 测试路径 | 若 leaf worker 再获 public surface，重新设计 package-e2e |
| test layers 已存在 | `test/index.md`, `docs/architecture/test-topology.md` | HPX1 做的是资产回正，不是新增层级 | 若 test tree 结构重写，需另开 plan |
| live-gated scaffold 不等于 delivered coverage | `docs/architecture/test-topology.md` §1.4 | `cross-e2e/15-21` 必须替换或退休，不能继续算覆盖 | 若无稳定 oracle，则直接退休，不保留空壳 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| stale suite 删除过快 | 若先删再想迁移，可能丢失仍有价值的断言 | `high` | 先完成 P1 per-file 裁决，再执行删除 |
| live oracle 不稳定 | confirmation / checkpoint / heartbeat 的 live 断言若无稳定观测点，容易再次退化成 placeholder | `high` | 仅保留已有公开可观察信号的场景；否则退休 |
| 文档与文件树再次漂移 | 只改代码不改 `test/index.md` / `test-topology.md` 会让 HPX1 结论失效 | `medium` | Phase 4 强制同步两份文档 |
| worker-local backfill 范围膨胀 | orchestrator-auth / duplicate cleanup 容易被拉成全仓测试重构 | `medium` | 仅处理与 HPX1 主线直接相关的 adapter/gap |
| follow-up 债务继续混入 blocker | helper duplication / setTimeout / api-key bootstrap 都是真问题，但不能抢占 HPX1 主阻塞 | `medium` | 在 closure 中登记 follow-up，不并入首轮 blocker |

### 7.2 约束与前提

- **技术前提**：继续使用现有 `vitest` 与 `node:test` 体系，不引入新框架。
- **运行时前提**：`test/shared/live.mjs` 的当前 topology truth 有效；`NANO_AGENT_LIVE_E2E=1` 仍作为 live gate。
- **组织协作前提**：三份评审仅作为输入；HPX1 以当前仓库 reality 与 git 历史为最终裁决依据。
- **上线 / 合并前提**：所有删除 / 迁移 / 替换项都必须在 closure 中可追踪，不允许 silent retire。

### 7.3 文档同步要求

- 需要同步更新的设计/架构文档：
  - `docs/architecture/test-topology.md`
- 需要同步更新的说明文档 / README：
  - `test/index.md`
- 需要同步更新的测试说明：
  - HPX1 closure 中的 deleted / replaced / retained 清单

### 7.4 完成后的预期状态

1. `test/package-e2e/` 不再保留与当前 topology 冲突的 leaf-worker direct public probe 套件。
2. `test/cross-e2e/` 不再包含只靠 `200` 或 marker 注释通过的 placeholder 文件。
3. bash-core / orchestrator-auth / orchestrator-core 的关键边界会在 worker-local 层直接被证明，而不是继续依赖 live 侧偶然覆盖。
4. `test/index.md` 与 `docs/architecture/test-topology.md` 将准确反映哪些 guardian 仍 live、哪些已 retired、哪些仍是 live-gated scaffold。
5. HPX1 closure 将能基于明确的 per-file verdict 和 canonical command pack 收口，而不是重新做事实核查。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `pnpm test`
  - `pnpm test:contracts`
- **单元测试**：
  - `pnpm --filter @haimang/bash-core-worker test`
  - `pnpm --filter @haimang/orchestrator-auth-worker test`
  - `pnpm --filter @haimang/orchestrator-core-worker test`
  - 受 duplicate cleanup 影响的 `agent-core` / `context-core` worker tests
- **集成测试**：
  - 受影响 worker 的 integration / smoke suites
- **端到端 / 手动验证**：
  - `pnpm test:package-e2e`
  - `pnpm test:cross-e2e`
  - 必要时 `NANO_AGENT_LIVE_E2E=1 node --test --test-concurrency=1 test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs`
- **回归测试**：
  - 删除 / 迁移后的 file-tree audit
  - `test/index.md` 与 `docs/architecture/test-topology.md` 的路径 / 命令 / retired guardian 一致性核对
- **文档校验**：
  - `test/index.md` 不再列出已退休 suite
  - `docs/architecture/test-topology.md` 不再把 retired guardian 记为 `(none)`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. 主树中不再存在与当前 topology 冲突的 leaf-worker direct package-e2e suite。
2. 主树中不再存在 `assert.ok(true)` marker 或纯 `status === 200` 的 placeholder cross-e2e。
3. bash-core / orchestrator-auth / orchestrator-core 的确认缺口已由 worker-local tests 承接。
4. `test/index.md` 与 `docs/architecture/test-topology.md` 与实际文件树、命令和 guardian 状态一致。
5. HPX1 的 deleted / migrated / replaced / retained-with-reason 清单可以直接供 closure 使用。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | 所有争议测试文件都已被正确删除、迁移、替换或保留，并能解释原因 |
| 测试 | 现有 canonical commands 能覆盖 HPX1 改动面；不再靠 placeholder 冒充覆盖 |
| 文档 | `test/index.md` 与 `docs/architecture/test-topology.md` 已反映 post-HPX1 truth |
| 风险收敛 | 评审报告中的 blocker 项均已处理或显式降级为 follow-up / retained-with-reason |
| 可交付性 | HPX1 closure 可直接引用本 plan 的 per-file verdict、命令和文档同步结果 |

