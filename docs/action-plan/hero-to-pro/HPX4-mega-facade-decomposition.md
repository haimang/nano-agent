# Nano-Agent 行动计划 — HPX4 Mega Facade Decomposition

> 服务业务簇: `hero-to-pro / HPX4`
> 计划对象: `拆分 workers/orchestrator-core/src/index.ts 巨石 façade，并对 workers/orchestrator-core/src/user-do/session-flow.ts 做第二轮合理拆分`
> 类型: `refactor + test + docs`
> 作者: `Owner + GPT-5.4`
> 时间: `2026-05-01`
> 文件位置:
> - `workers/orchestrator-core/src/index.ts`
> - `workers/orchestrator-core/src/facade/**`（HPX4 新增目录）
> - `workers/orchestrator-core/src/user-do/session-flow.ts`
> - `workers/orchestrator-core/src/user-do/session-flow/**`（HPX4 新增目录）
> - `scripts/{megafile-budget.json,check-megafile-budget.mjs}`
> - `workers/orchestrator-core/test/**`
> - `docs/issue/hero-to-pro/HPX4-mega-facade-decomposition-closure.md`
> 上游前序 / closure:
> - `docs/action-plan/hero-to-pro/HP8-action-plan.md`
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
> - `docs/issue/hero-to-pro/HP-full-closure-test-report.md`
> 下游交接:
> - `docs/issue/hero-to-pro/HPX4-mega-facade-decomposition-closure.md`
> - 后续具体实现批次 / PR closure
> 关联设计 / 调研文档:
> - `docs/action-plan/real-to-hero/RH6-do-megafile-decomposition.md`
> - `workers/orchestrator-core/README.md`
> - `scripts/megafile-budget.json`
> - `scripts/check-megafile-budget.mjs`
> 冻结决策来源:
> - `docs/charter/plan-hero-to-pro.md` §7.9 HP8 megafile gate
> - `docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md` §7 F3
> - `docs/design/hero-to-pro/HPX-qna.md` Q25（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `executed`

---

## 0. 执行背景与目标

HP8 已经把 megafile gate 冻结成仓库纪律，但 `workers/orchestrator-core/src/index.ts` 仍然处在“止血未完成”的状态：当前文件 **3015 行**，已经高于现行 `scripts/megafile-budget.json` 中给它的 `3000` 行 ceiling；而且它不是单纯的“大”，而是把 **入口 worker、公共 façade dispatch、route parser、auth proxy、D1 read-model、context/files service-binding、checkpoint/confirmation/todo/model control-plane、session bridge 包装** 全部叠在一个 owner file 里。继续在这个文件上叠功能，会把 hero-to-pro 后续所有 façade 增量都推回同一个维护瓶颈。

与此同时，`workers/orchestrator-core/src/user-do/session-flow.ts` 当前 **966 行**，虽然尚未越过“1000 行”这条新要求，但它已经把 `hydrate/start/input/cancel/close/delete/title/verify/read` 9 条流程塞进单一 factory，并在多个 handler 中重复执行 `auth_snapshot 恢复 → device gate → durable lifecycle 读取/写回 → activity append`。如果只拆 `index.ts` 而不同时给 `session-flow.ts` 设计第二轮拆分路径，复杂度会从 public façade 巨石转移到 User DO 巨石，而不是被真正消化。

- **服务业务簇**：`hero-to-pro / HPX4`
- **计划对象**：`orchestrator-core public façade mega-file decomposition`
- **本次计划解决的问题**：
  - `workers/orchestrator-core/src/index.ts` 3015 行，且共享了过多互不相同的职责边界。
  - `dispatchFetch()` 既是入口路由器，又直接绑定大量 domain handler，任何新增 surface 都会继续往同一文件涨。
  - `session-flow.ts` 虽未超线，但已经形成单工厂 + 多流程 + 重复 gate helper 的隐性巨石。
  - 现有 megafile gate 只做“止血 ceiling”，还没有把 orchestrator-core façade 真正拉回 `<1000` 行。
- **本次计划的直接产出**：
  - `index.ts` 拆成薄 façade 入口文件 + 按 domain 分层的 route/handler/shared 模块。
  - 明确的 phase 执行线路，确保拆分不是把 3015 行搬进另一个 1500 行替身文件。
  - `session-flow.ts` 的二次拆分方案与目标目录结构。
  - 最终把 façade owner files 纳入更严格的 `<1000` 行 gate。
- **本计划不重新讨论的设计结论**：
  - HPX4 是 **refactor / decomposition**，不借机改变 public route 的 URL、auth law、facade envelope、status code 或 D1 truth owner（来源：当前 `index.ts` 已落地的产品面 + HP0-HP10 closure）。
  - megafile ceiling 只能下降，不能因为“重构难”而把 `scripts/megafile-budget.json` 的上限调高（来源：`scripts/check-megafile-budget.mjs` + HP8 frozen contract）。
  - wrapper / re-export 文件可以保持很薄，但真正承载业务逻辑的 owner file 必须进入 megafile gate；不能靠“套一层 wrapper”规避预算（来源：`scripts/check-megafile-budget.mjs` 头部注释）。

---

## 1. 执行综述

### 1.1 总体执行方式

HPX4 采用 **先冻结当前结构与拆分法律 → 再抽 shared seam → 再按 domain 平移 parser/handler → 最后把 index.ts 收束成薄入口，并同步做 session-flow second pass** 的顺序。核心原则不是“把大文件切成很多文件”这么简单，而是把 **parser、handler、shared helper、budget gate、test route** 一起收束，避免拆完以后只是从一个 megafile 变成多个互相缠绕的半巨石。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Baseline Freeze + Split Law | `S` | 冻结当前行数、职责图、目标目录与 import law | `-` |
| Phase 2 | Shared Facade Spine Extraction | `M` | 把 env/type/request/auth/ownership/response seam 从 `index.ts` 抽离 | `Phase 1` |
| Phase 3 | Non-Session Domain Route Extraction | `L` | 拆出 debug/auth/catalog/me/team/devices/models 等非 session domain | `Phase 2` |
| Phase 4 | Session Surface Route Extraction | `L` | 拆出 context/files/checkpoints/confirmations/todos/model + session bridge dispatch | `Phase 2-3` |
| Phase 5 | Thin Entrypoint + Budget Hard Gate | `M` | 让 `index.ts` 退化为薄入口，并把新 owner files 纳入 `<1000` 行预算 | `Phase 2-4` |
| Phase 6 | Session Flow Second Pass | `M` | 对 `session-flow.ts` 做第二轮拆分，防止复杂度回流到 User DO | `Phase 2-5` |

### 1.3 Phase 说明

1. **Phase 1 — Baseline Freeze + Split Law**
   - **核心目标**：把“为什么要拆、准备怎么拆、不能怎么拆”冻结成可执行约束。
   - **为什么先做**：不先定 split law，很容易一边拆一边改 contract，或者造出新的 replacement megafile。
2. **Phase 2 — Shared Facade Spine Extraction**
   - **核心目标**：先拆出 shared seam，让后续 domain 文件不再反向依赖 `index.ts`。
   - **为什么放这里**：不先处理 env/type/helper，后面一拆 route 就容易形成 import cycle。
3. **Phase 3 — Non-Session Domain Route Extraction**
   - **核心目标**：先拆 debug/auth/catalog/me/team/devices/models 这些相对独立的 domain。
   - **为什么放这里**：这些 domain 共享较少，适合先把 dispatch 体积明显降下来。
4. **Phase 4 — Session Surface Route Extraction**
   - **核心目标**：再拆 context/files/checkpoints/confirmations/todos/model，以及 session bridge body policy。
   - **为什么放这里**：这些 domain 的共享约束更复杂，需要建立在 shared spine 与 registry dispatch 已稳定之后。
5. **Phase 5 — Thin Entrypoint + Budget Hard Gate**
   - **核心目标**：把 `index.ts` 最终压回薄 façade，并让 megafile gate 真正升级为 `<1000`。
   - **为什么最后做**：只有当拆分完成后，预算下降才不会立刻把仓库置于不可合并状态。
6. **Phase 6 — Session Flow Second Pass**
   - **核心目标**：避免 public façade 拆完后，复杂度全部堆进 `session-flow.ts`。
   - **为什么单列**：它不是 HPX4 的主入口瓶颈，但已经是明确的下一颗“准巨石”。

### 1.4 执行策略说明

- **执行顺序原则**：先 shared 再 domain，先独立 domain 再重耦合 session domain，先稳定 import 方向再收紧 megafile gate。
- **风险控制原则**：禁止创建任何新的 `>1000` 行 replacement owner file；parser 与 handler 必须按 domain 同步迁移，不允许 parser 留在旧文件、handler 移到新文件后继续双头维护。
- **测试推进原则**：每一阶段至少跑 orchestrator-core package 级 typecheck/build/test；Phase 5-6 再跑 root regression 与 megafile gate。
- **文档同步原则**：预算变更、目录归属、owner file 列表变化，都必须同步到 closure 与必要 README，而不是只留在代码 diff 里。
- **回滚 / 降级原则**：按小批次/单 domain 落地；若某一拆分引入 route drift，可单独回滚该 domain，不回滚整个 HPX4。

### 1.5 本次 action-plan 影响结构图

```text
HPX4 mega facade decomposition
├── Phase 1: Baseline Freeze + Split Law
│   ├── current line-map / handler-map / route-map
│   └── import-direction / budget-direction / no-replacement-megafile law
├── Phase 2: Shared Facade Spine Extraction
│   ├── facade shared request/auth/ownership/response seam
│   └── env/type ownership moved out of index.ts
├── Phase 3: Non-Session Domain Route Extraction
│   ├── debug + auth + catalog
│   ├── me/team/devices
│   └── models
├── Phase 4: Session Surface Route Extraction
│   ├── context + files
│   ├── checkpoints + confirmations + todos + session-model
│   └── session bridge route manifest + body policy
├── Phase 5: Thin Entrypoint + Budget Hard Gate
│   ├── index.ts <= thin facade
│   ├── route registry dispatch
│   └── scripts/megafile-budget.json lowered below 1000
└── Phase 6: Session Flow Second Pass
    ├── session-flow shared helpers
    ├── start / lifecycle / verify-read split
    └── createUserDoSessionFlow facade preservation
```

### 1.6 已核对的当前代码锚点

1. **`index.ts` 当前已经越过现行 budget**
   - `wc -l workers/orchestrator-core/src/index.ts` = `3015`
   - `scripts/megafile-budget.json` 当前对该文件的 ceiling 是 `3000`
2. **`dispatchFetch()` 承担了过多职责**
   - `workers/orchestrator-core/src/index.ts:635-833`
   - 这里集中处理了 health/debug/auth/catalog/me/conversations/team/devices/models/context/files/checkpoints/confirmations/todos/workspace/tool-calls/session DO bridge。
3. **route parser 与入口 shared helper 目前混在一起**
   - `workers/orchestrator-core/src/index.ts:390-620`
   - `SessionAction`、`parseSessionRoute()`、`parseSessionFilesRoute()`、`parseAuthRoute()`、`readAccessToken()`、`readDeviceMetadata()` 与 `proxyAuthRoute()` 位于同一层。
4. **非 session domain 与 session domain 目前没有稳定的文件级分层**
   - `handleMeSessions()` `889-1000`
   - `handleMeConversations()` / `handleConversationDetail()` `1200-1272`
   - `handleSessionCheckpoint()` / `handleSessionConfirmation()` / `handleSessionTodos()` `1274-1902`
   - `handleMeTeam()` / `handleMeTeams()` / `handleMeDevices*()` `1905-2205`
   - `handleModels*()` / `handleSessionModel()` `2214-2451`
   - `handleSessionContext()` / `handleSessionFiles()` / `wrapSessionResponse()` `2466-3010`
5. **`session-flow.ts` 当前虽在 1000 行以内，但已是单 factory 巨石**
   - `wc -l workers/orchestrator-core/src/user-do/session-flow.ts` = `966`
   - 内部包含 `hydrateSessionFromDurableTruth`、`requireReadableSession`、`handleStart`、`handleInput`、`handleCancel`、`handleClose`、`handleDelete`、`handleTitle`、`handleVerify`、`handleRead`
6. **megafile checker 的语义是“owner file 只降不升”**
   - `scripts/check-megafile-budget.mjs`
   - HPX4 不能通过“换个名字继续超大”来规避，而必须把 owner files 真正收束到 `<1000`。

### 1.7 HPX4 目标结构（建议落点）

```text
workers/orchestrator-core/src
├── index.ts                                  # 薄入口；保留 worker export / NanoOrchestratorUserDO export
├── facade/
│   ├── env.ts                                # OrchestratorCoreEnv / shell / health probe types
│   ├── shared/
│   │   ├── request.ts                        # UUID_RE / parseBody / limit helpers / upload primitives
│   │   ├── auth.ts                           # readAuthTeam / debug auth / access token / device metadata
│   │   ├── ownership.ts                      # requireOwnedSession / cross-tenant audit
│   │   └── response.ts                       # wrapSessionResponse + shared JSON facade helpers
│   ├── route-registry.ts                     # dispatch table / ordered matcher registry
│   └── routes/
│       ├── debug.ts
│       ├── auth.ts
│       ├── catalog.ts
│       ├── me.ts
│       ├── models.ts
│       ├── session-bridge.ts
│       ├── session-context.ts
│       ├── session-files.ts
│       └── session-control.ts                # checkpoints / confirmations / todos / session-model
└── user-do/
    ├── session-flow.ts                       # 薄 façade / compat export
    └── session-flow/
        ├── types.ts
        ├── shared.ts
        ├── hydrate.ts
        ├── start.ts
        ├── input.ts
        ├── lifecycle.ts                      # cancel / close / delete / title
        ├── verify-read.ts
        └── index.ts
```

### 1.8 HPX4 的硬性拆分法律

1. **禁止 replacement megafile**
   - 不允许把 `index.ts` 的 3000 行搬进新的 `router.ts` / `handlers.ts` / `session-control.ts` 继续超过 1000 行。
2. **禁止 parser / handler 双头漂移**
   - 某个 domain 的 matcher、body policy、handler 应尽量同域放置；若拆开，必须通过单一 registry 装配，不允许散落在 `index.ts` + domain file 两处同时维护。
3. **禁止 domain 反向 import `index.ts`**
   - 如果 domain handler 需要 env/type，必须从 `facade/env.ts` 或 shared seam 获取，不能回头 import 入口文件。
4. **禁止借 HPX4 改 public contract**
   - URL、auth requirement、response envelope、status set、D1 truth owner 全部保持现状不变。
5. **budget 只能在完成拆分后下调**
   - `scripts/megafile-budget.json` 必须在 Phase 5 才收紧；且所有新增 owner file ceiling 一律 `<1000`。

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 对 `workers/orchestrator-core/src/index.ts` 做完整、分 phase 的结构拆分，并把其 owner file 大小压回 `<1000`。
- **[S2]** 建立 façade shared seam：env/type、request parsing、auth helper、ownership gate、response wrapping。
- **[S3]** 按 domain 拆出 non-session routes 与 session surface routes，并引入 route registry / dispatch 装配层。
- **[S4]** 同步更新 `scripts/megafile-budget.json`，把 orchestrator-core façade owner files 纳入更严格预算。
- **[S5]** 为 `workers/orchestrator-core/src/user-do/session-flow.ts` 提供第二轮拆分方案，并把它纳入 HPX4 执行线路。
- **[S6]** 明确测试线路：package 级、root 级、megafile gate、必要时 preview/live 回归。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 变更任何 public API 的语义、auth law、response envelope 或 status code。
- **[O2]** 引入新的 D1 schema、control-plane feature 或新的 product endpoint。
- **[O3]** 顺手重构 `session-truth.ts`、`user-do-runtime.ts`、`agent-core` 其他 megafile；它们可以是后续 follow-up，但不属于 HPX4 主范围。
- **[O4]** 只做“换文件名”的伪拆分；若某个新文件仍然 >1000 行，则不视为 HPX4 达标。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `index.ts` 薄入口化 | `in-scope` | 这是 HPX4 的主目标 | 不重评 |
| `session-flow.ts` second pass | `in-scope` | 当前虽未越线，但已具备下一颗巨石的形状 | 若 owner 明确要求拆分只限 public façade，才可降级 |
| `session-truth.ts` 同轮一起大拆 | `out-of-scope` | 会把 HPX4 变成多巨石并行改造，风险失控 | 后续独立 HPX* |
| 提高 megafile budget ceiling | `out-of-scope` | 违反 HP8 frozen law | 不重评 |
| 引入 route registry | `in-scope` | 不引入 registry，`index.ts` 很难持续保持薄入口 | 若最终有更小更稳的 dispatcher 方案，可等价替换 |
| 通过 wrapper 规避 owner budget | `out-of-scope` | 与 checker 语义冲突 | 不重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | line-map / route-map freeze | `update` | `index.ts`, `session-flow.ts`, action-plan | 固定现状结构与行数基线 | `low` |
| P1-02 | Phase 1 | split law freeze | `update` | action-plan | 固定 import / budget / parser-handler 法律 | `medium` |
| P2-01 | Phase 2 | shared seam extraction | `refactor` | `src/facade/shared/**`, `src/facade/env.ts`, `index.ts` | 为 domain split 消除共同耦合点 | `medium` |
| P2-02 | Phase 2 | response / ownership centralization | `refactor` | `response.ts`, `ownership.ts`, `index.ts` | 防止 wrap / tenant audit 复制扩散 | `medium` |
| P3-01 | Phase 3 | debug/auth/catalog split | `refactor` | `routes/{debug,auth,catalog}.ts` | 先拆相对独立的 façade surface | `low` |
| P3-02 | Phase 3 | me/team/devices/models split | `refactor` | `routes/{me,models}.ts` | 把 read-side 与 account surface 脱离入口文件 | `medium` |
| P4-01 | Phase 4 | context/files split | `refactor` | `routes/{session-context,session-files}.ts` | 把 service-binding façade 下沉到独立 domain | `medium` |
| P4-02 | Phase 4 | session control split | `refactor` | `routes/session-control.ts` | 抽离 checkpoints/confirmations/todos/model surface | `high` |
| P4-03 | Phase 4 | session bridge manifest | `refactor` | `routes/session-bridge.ts`, `route-registry.ts` | 把 session action matcher / body policy / ws passthrough 从 `index.ts` 拆走 | `high` |
| P5-01 | Phase 5 | thin index.ts | `refactor` | `index.ts` | 把入口文件压缩为薄 façade | `high` |
| P5-02 | Phase 5 | budget hardening | `update` | `scripts/megafile-budget.json` | 把 façade owner files 全部收进 `<1000` | `high` |
| P6-01 | Phase 6 | session-flow shared helper split | `refactor` | `user-do/session-flow/{types,shared,hydrate}.ts` | 抽出重复 gate / auth / durable helper | `medium` |
| P6-02 | Phase 6 | session-flow handler split | `refactor` | `user-do/session-flow/{start,input,lifecycle,verify-read}.ts` | 把单 factory handler 巨石拆开 | `high` |
| P6-03 | Phase 6 | session-flow thin facade + budget | `refactor` | `user-do/session-flow.ts`, `scripts/megafile-budget.json` | 保持 `createUserDoSessionFlow(ctx)` 稳定，同时拉开 owner file 预算 | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Baseline Freeze + Split Law

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | line-map / route-map freeze | 记录 `index.ts` 与 `session-flow.ts` 的当前行数、函数/handler 分布、route domain 分区、现有 budget 状态 | `index.ts`, `session-flow.ts`, action-plan | 后续拆分不再凭感觉推进 | `wc -l`, 结构审计 | 行数、domain、owner seam 全部落到文档 |
| P1-02 | split law freeze | 明确“禁止 replacement megafile / 禁止 domain import index.ts / budget 只降不升 / parser-handler 同域迁移”等硬约束 | action-plan | 后续实现有清晰边界 | review | law 可直接作为 implementation checklist 使用 |

### 4.2 Phase 2 — Shared Facade Spine Extraction

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | shared seam extraction | 把 env/type、`parseBody`、UUID/limit/mime helper、auth helper 从 `index.ts` 抽到 `facade/env.ts` 与 `facade/shared/**` | `src/facade/env.ts`, `src/facade/shared/{request,auth}.ts`, `index.ts` | 后续 domain 文件不需要反向 import `index.ts` | `pnpm --filter @haimang/orchestrator-core-worker typecheck build test` | `index.ts` 不再持有大量 shared helper |
| P2-02 | response / ownership centralization | 抽离 `requireOwnedSession()`、`wrapSessionResponse()`、cross-tenant audit 等 shared seam | `src/facade/shared/{ownership,response}.ts`, `index.ts` | route 文件共享同一 response/ownership law | 同上 + route tests | 不出现第二份 wrap / ownership 复制实现 |

### 4.3 Phase 3 — Non-Session Domain Route Extraction

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | debug/auth/catalog split | 把 `/health`、`/debug/*`、`/auth/*`、`/catalog/*` 的 parser/handler 拆出，并由 registry 装配 | `routes/{debug,auth,catalog}.ts`, `route-registry.ts`, `index.ts` | 入口文件不再直接维护这些 surface 的具体实现 | `debug-routes.test.ts`, `auth.test.ts`, `smoke.test.ts` | 域内 parser/handler 不再留在 `index.ts` |
| P3-02 | me/team/devices/models split | 拆出 `/me/sessions`、`/me/conversations`、`/me/team`、`/me/teams`、`/me/devices*`、`/models*` | `routes/{me,models}.ts`, `index.ts` | 账户面与 model 面迁出入口文件 | `me-*.test.ts`, `models-route.test.ts` | 所有 read-side/account route 从 `index.ts` 迁出 |

### 4.4 Phase 4 — Session Surface Route Extraction

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | context/files split | 把 context/files façade 及其 service-binding call 封入 domain route 文件 | `routes/{session-context,session-files}.ts`, `index.ts` | service-binding façade 不再占据 `index.ts` 大段空间 | `context-route.test.ts`, `files-route.test.ts` | context/files route 迁出完成 |
| P4-02 | session control split | 把 checkpoints/confirmations/todos/session-model 拆到统一 session-control domain 或多个小域文件 | `routes/session-control.ts`, 相关 control-plane imports | HP4-HP7 吸收面不再挤在入口文件 | `chat-lifecycle-route.test.ts`, `confirmation-route.test.ts`, `todo-route.test.ts`, `session-model-route.test.ts` | 这些 control-plane route 全部离开 `index.ts` |
| P4-03 | session bridge manifest | 把 `parseSessionRoute()`、session action matcher、optional-body / needs-body policy、ws passthrough bridge 从 `index.ts` 拆到 `session-bridge.ts` + registry | `routes/session-bridge.ts`, `route-registry.ts`, `index.ts` | `dispatchFetch()` 不再手写一长串 session action 分支 | `messages-route.test.ts`, `user-do.test.ts`, `smoke.test.ts` | session bridge 规则集中到单域文件 |

### 4.5 Phase 5 — Thin Entrypoint + Budget Hard Gate

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | thin index.ts | 让 `index.ts` 只保留 export、worker fetch wrapper、顶层 dispatch 装配与极少量 bootstrap | `index.ts`, `route-registry.ts` | 入口文件回到薄 façade | `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`, `pnpm test` | `index.ts` `<1000`，并优先压到 `<=400-600` |
| P5-02 | budget hardening | 调整 `scripts/megafile-budget.json`：降低 `index.ts` ceiling，并给 HPX4 引入的新 owner files 建立 `<1000` ceiling | `scripts/megafile-budget.json` | megafile gate 从“止血”变成真实约束 | `node scripts/check-megafile-budget.mjs` | 不存在任何新的 >1000 owner file |

### 4.6 Phase 6 — Session Flow Second Pass

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P6-01 | session-flow shared helper split | 抽出 `UserDoSessionFlowContext`、`RpcAck`、auth snapshot 恢复、device gate、durable pointer / lifecycle helper | `user-do/session-flow/{types,shared,hydrate}.ts` | 去掉 `session-flow.ts` 内部重复 gate 代码 | `user-do-chat-lifecycle.test.ts`, `user-do.test.ts` | 重复 helper 不再分散在 4-5 个 handler 里 |
| P6-02 | session-flow handler split | 把 `handleStart`、`handleInput`、`handleCancel/Close/Delete/Title`、`handleVerify/Read` 拆到独立模块 | `user-do/session-flow/{start,input,lifecycle,verify-read}.ts` | 单 factory 巨石被拆成按职责分层的 handler 文件 | 同上 + `messages-route.test.ts` | 单一 handler文件不过大，行为保持不变 |
| P6-03 | session-flow thin facade + budget | 保持 `createUserDoSessionFlow(ctx)` 对外 API 稳定，让 `session-flow.ts` 成为薄 façade / compat export，并把新的 owner files 也纳入 megafile gate | `user-do/session-flow.ts`, `scripts/megafile-budget.json` | User DO 流程层不再是下一颗巨石 | `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`, `node scripts/check-megafile-budget.mjs` | `session-flow` 薄 façade成型，owner files 全部 `<1000` |

---

## 5. Phase 详情

### 5.1 Phase 1 — Baseline Freeze + Split Law

- **Phase 目标**：把当前结构问题从“感受”转成可执行的拆分边界。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - 无
- **本 Phase 修改文件**：
  - `docs/action-plan/hero-to-pro/HPX4-mega-facade-decomposition.md`
- **具体功能预期**：
  1. 明确当前 `index.ts` 已 breach 现有 budget，不再允许“以后再说”。
  2. 明确 `session-flow.ts` 虽未 breach，但必须一并列入 second-pass。
- **具体测试安排**：
  - **单测**：无
  - **集成测试**：无
  - **回归测试**：`wc -l` + `node scripts/check-megafile-budget.mjs` 记录基线
  - **手动验证**：结构审计
- **收口标准**：
  - 结构图、law、目标目录全部写清
  - 后续实现者不需要再自行猜测“先拆哪一块”
- **本 Phase 风险提醒**：
  - 若 law 写得不够硬，后续实现仍可能演化成“把 3000 行换个地方塞”

### 5.2 Phase 2 — Shared Facade Spine Extraction

- **Phase 目标**：把所有 domain 都会引用的 shared seam 从 `index.ts` 拉平。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/src/facade/env.ts`
  - `workers/orchestrator-core/src/facade/shared/{request,auth,ownership,response}.ts`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
- **具体功能预期**：
  1. domain route 文件只依赖 `facade/env.ts` 与 shared seam，而不依赖 `index.ts`
  2. `wrapSessionResponse()`、`requireOwnedSession()` 等共享 law 只有一份 owner
- **具体测试安排**：
  - **单测**：`workers/orchestrator-core/test/{auth,models-route,files-route}.test.ts`
  - **集成测试**：`pnpm --filter @haimang/orchestrator-core-worker build`
  - **回归测试**：`pnpm --filter @haimang/orchestrator-core-worker test`
  - **手动验证**：import graph 审阅，确认 domain 不反向 import `index.ts`
- **收口标准**：
  - `index.ts` 已明显减重
  - shared seam 不再散落在多个 domain 里
- **本 Phase 风险提醒**：
  - env/type 若仍留在 `index.ts`，后续拆分很容易形成 cycle

### 5.3 Phase 3 — Non-Session Domain Route Extraction

- **Phase 目标**：先拆相对独立的 façade domain，快速降低入口体积。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/src/facade/routes/{debug,auth,catalog,me,models}.ts`
  - `workers/orchestrator-core/src/facade/route-registry.ts`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
- **具体功能预期**：
  1. `dispatchFetch()` 不再手工持有 debug/auth/catalog/me/models 的业务逻辑
  2. route registry 以 ordered matcher/handler 方式装配这些独立 domain
- **具体测试安排**：
  - **单测**：`debug-routes.test.ts`、`auth.test.ts`、`me-*.test.ts`、`models-route.test.ts`
  - **集成测试**：`pnpm --filter @haimang/orchestrator-core-worker typecheck build`
  - **回归测试**：`pnpm --filter @haimang/orchestrator-core-worker test`
  - **手动验证**：确认 parser 与 handler 已从 `index.ts` 删除，而非复制
- **收口标准**：
  - 非 session domain 全部迁出
  - `index.ts` 不再承载这些 domain 的实际处理逻辑
- **本 Phase 风险提醒**：
  - route matcher 顺序若改坏，容易导致 `/me` / `/auth/me` 等路径优先级漂移

### 5.4 Phase 4 — Session Surface Route Extraction

- **Phase 目标**：把最重的 session surface 从 `index.ts` 中拆出。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/src/facade/routes/{session-context,session-files,session-control,session-bridge}.ts`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/facade/route-registry.ts`
- **具体功能预期**：
  1. context/files 的 service-binding façade 迁出
  2. checkpoints/confirmations/todos/session-model 从入口文件下沉
  3. session action route manifest、body optionality、ws passthrough 逻辑进入 `session-bridge.ts`
- **具体测试安排**：
  - **单测**：`context-route.test.ts`、`files-route.test.ts`、`chat-lifecycle-route.test.ts`、`confirmation-route.test.ts`、`todo-route.test.ts`、`session-model-route.test.ts`
  - **集成测试**：`pnpm --filter @haimang/orchestrator-core-worker typecheck build`
  - **回归测试**：`pnpm --filter @haimang/orchestrator-core-worker test`
  - **手动验证**：检查 session route body policy 不漂移
- **收口标准**：
  - `dispatchFetch()` 只保留极薄的 registry 调用
  - session route 规则集中到单域 owner，而不是散在入口文件
- **本 Phase 风险提醒**：
  - session bridge 是 HPX4 最高风险点；optional-body / ws path 一旦漂移会直接打坏 live façade

### 5.5 Phase 5 — Thin Entrypoint + Budget Hard Gate

- **Phase 目标**：把 `index.ts` 最终收束成薄入口，并让 megafile gate 真正生效。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - 无（以收束为主）
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
  - `scripts/megafile-budget.json`
- **具体功能预期**：
  1. `index.ts` 只保留 `worker.fetch()`、顶层 dispatch 装配、`NanoOrchestratorUserDO` export、default export
  2. budget 由当前 `3000` 下调到 `<1000`，并为 HPX4 新 owner files 设置严格上限
- **具体测试安排**：
  - **单测**：`smoke.test.ts`、所有 route tests
  - **集成测试**：`pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - **回归测试**：`pnpm test`、`node scripts/check-megafile-budget.mjs`
  - **手动验证**：`wc -l` 复核 `index.ts`
- **收口标准**：
  - `index.ts < 1000`
  - 没有任何新 owner file 超过 1000 行
- **本 Phase 风险提醒**：
  - 只收紧 `index.ts`，但忘了把新 owner file 纳入 budget，会留下新的盲区

### 5.6 Phase 6 — Session Flow Second Pass

- **Phase 目标**：把 `session-flow.ts` 从“单 factory 准巨石”拉回可持续状态。
- **本 Phase 对应编号**：
  - `P6-01`
  - `P6-02`
  - `P6-03`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/src/user-do/session-flow/{types,shared,hydrate,start,input,lifecycle,verify-read,index}.ts`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/user-do/session-flow.ts`
  - `scripts/megafile-budget.json`
- **具体功能预期**：
  1. `handleStart` 独立成单文件，避免继续吞噬其它 lifecycle 路径
  2. `cancel/close/delete/title` 作为同一 lifecycle domain 聚合
  3. `verify/read` 聚合为 read-side domain
  4. `createUserDoSessionFlow(ctx)` 对外调用面不变
- **具体测试安排**：
  - **单测**：`user-do-chat-lifecycle.test.ts`、`user-do.test.ts`、`messages-route.test.ts`
  - **集成测试**：`pnpm --filter @haimang/orchestrator-core-worker typecheck build`
  - **回归测试**：`pnpm --filter @haimang/orchestrator-core-worker test`、`pnpm test`、`node scripts/check-megafile-budget.mjs`
  - **手动验证**：检查 `session-flow.ts` 是否退化为薄 façade / compat export
- **收口标准**：
  - `session-flow` 不再是 900+ 行单 factory
  - second-pass helper 不改外部 contract
- **本 Phase 风险提醒**：
  - 抽 shared helper 时若过度抽象，容易把流程语义藏进“万能 helper”里，反而更难维护

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q25 megafile gate 只降不升 | `docs/design/hero-to-pro/HPX-qna.md` Q25 | HPX4 不能提高 ceiling，只能拆分后下调预算 | 停止 HPX4，回到设计层重开 |
| HP8 F3 owner file budget discipline | `docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md` §7 F3 | 新 owner files 也必须进入 budget，而不是只看旧 `index.ts` | 若无法纳入 budget，则不视为完成 |
| wrapper / generated file 不代表 owner file | `scripts/check-megafile-budget.mjs` 头部注释 | HPX4 可以保留薄 wrapper，但真实逻辑 owner 必须有预算 | 若仅靠 wrapper 规避预算，则视为违规拆分 |
| public façade contract 保持稳定 | 当前 `workers/orchestrator-core/src/index.ts` 已落地行为 + HP0-HP10 closure | HPX4 只能拆结构，不能顺手改 URL/auth/envelope/status law | 若确需改 contract，必须拆出独立 feature plan |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| import cycle | domain route 文件若继续依赖 `index.ts`，会形成循环引用 | `high` | Phase 2 先抽 `facade/env.ts` 与 shared seam |
| replacement megafile | 可能出现新的 `route-registry.ts` / `session-control.ts` 超过 1000 行 | `high` | 所有新 owner file 都进 budget；必要时继续按 domain 细切 |
| route drift | matcher 顺序、optional body、ws pass-through 在拆分中漂移 | `high` | 保持 parser/handler 同域迁移，并跑现有 route tests + smoke |
| shared helper 过抽象 | `session-flow` second pass 若造出“万能 helper”，会降低可读性 | `medium` | helper 只抽重复 gate / durable seam，不抽业务分支 |
| test blind spot | 只跑 package test，不跑 root/megafile gate，会漏掉结构性回归 | `medium` | Phase 5-6 明确要求 `pnpm test` + `check-megafile-budget` |

### 7.2 约束与前提

- **技术前提**：保留 `worker` / `default export` / `NanoOrchestratorUserDO` 这些对外导出面不变；Cloudflare Request/Response/WebSocket 语义不能被错误抽象。
- **运行时前提**：拆分过程必须维持当前 façade contract，不允许出现“编译过了但 live path 漂了”的情况。
- **组织协作前提**：HPX4 应按小批次/分 phase 落地，不建议单次大爆改提交。
- **上线 / 合并前提**：预算下调与 owner file 新增只能在对应拆分已经落地并验证通过后一起合并。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/issue/hero-to-pro/HPX4-mega-facade-decomposition-closure.md`
- 需要同步更新的说明文档 / README：
  - `workers/orchestrator-core/README.md`（若目录结构与 owner 说明发生变化）
- 需要同步更新的测试说明：
  - `workers/orchestrator-core/test/README.md`（若新增 route-registry / megafile gate 说明）

### 7.4 完成后的预期状态

1. `workers/orchestrator-core/src/index.ts` 从 3015 行巨石退化为薄入口文件，且 `<1000`。
2. public façade 的 route/domain 归属清晰，新增 surface 不再默认往 `index.ts` 里堆。
3. `scripts/megafile-budget.json` 对 orchestrator-core façade 的约束从“止血”升级为真正的 `<1000` hard gate。
4. `workers/orchestrator-core/src/user-do/session-flow.ts` 不再是 900+ 行单 factory，User DO 流程层有明确的二次分层。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `wc -l workers/orchestrator-core/src/index.ts workers/orchestrator-core/src/user-do/session-flow.ts`
  - `node scripts/check-megafile-budget.mjs`
- **单元测试**：
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck`
  - `pnpm --filter @haimang/orchestrator-core-worker build`
  - `pnpm --filter @haimang/orchestrator-core-worker test`
- **集成测试**：
  - `pnpm test`
- **端到端 / 手动验证**：
  - 若 HPX4 落地批次触达 preview deploy，则执行 `bash scripts/deploy-preview.sh`
  - 若已 deploy preview，则执行 `NANO_AGENT_LIVE_E2E=1 pnpm test:live:e2e`
- **回归测试**：
  - `git --no-pager diff --check`
  - route / smoke / user-do 相关测试全绿
- **文档校验**：
  - closure 中必须记录拆分后的 owner file 清单、最终行数与 budget 变化

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `workers/orchestrator-core/src/index.ts` 与 HPX4 新增的 façade owner files 全部 `<1000` 行。
2. `dispatchFetch()` 不再直接持有大段 domain 业务逻辑，而是只做薄装配。
3. `workers/orchestrator-core/src/user-do/session-flow.ts` 已完成 second-pass，且对外 factory surface 保持稳定。
4. `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`、`pnpm test`、`node scripts/check-megafile-budget.mjs` 全部通过；若触达 preview，则 live regression 也通过。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | public façade 与 User DO flow 的外部行为不变，只有结构被拆分 |
| 测试 | orchestrator-core package test、root regression、megafile gate 全绿；必要时 live e2e 也全绿 |
| 文档 | HPX4 closure 记录最终文件树、owner 归属、budget 变化与验证结果 |
| 风险收敛 | 没有新的 replacement megafile、没有新的 import cycle、没有 route drift |
| 可交付性 | 后续新增 façade surface 可以按 domain 挂接，不必再修改 3000 行入口文件 |

---

## 9. 工作日志回填

1. **基线冻结**
   - 复核了 `workers/orchestrator-core/src/index.ts` 旧基线 `3015` 行、`workers/orchestrator-core/src/user-do/session-flow.ts` 旧基线 `966` 行。
   - 确认 `scripts/megafile-budget.json` 旧状态只对 `index.ts` 维持 `3000` 行止血 ceiling，尚未覆盖 HPX4 引入的新 owner files。

2. **shared spine 落地**
   - 新增 `workers/orchestrator-core/src/facade/env.ts`。
   - 新增 `workers/orchestrator-core/src/facade/shared/{request,auth,ownership,response}.ts`。
   - 将 env/type、request parser、debug auth helper、cross-tenant ownership gate、session response wrapping 从旧 `index.ts` 抽出，消除 domain 反向 import `index.ts` 的需求。

3. **non-session route split 落地**
   - 新增 `workers/orchestrator-core/src/facade/routes/{debug,auth,catalog,me,models}.ts`。
   - 将 `/health`、`/debug/*`、`/auth/*`、`/catalog/*`、`/me/*`、`/models*` 从入口巨石迁出。
   - 其中 `me.ts` 承接 `/me/sessions`、`/me/conversations`、`/conversations/{id}`、`/me/team`、`/me/teams`、`/me/devices*` 的 D1 read-side 与 revoke flow。

4. **session surface split 落地**
   - 新增 `workers/orchestrator-core/src/facade/routes/{session-context,session-files,session-control,session-bridge}.ts`。
   - 将 context/files service-binding façade、checkpoints/confirmations/todos control-plane、session DO bridge / ws passthrough 从旧 `index.ts` 迁出。
   - 保持了旧入口的 route 顺序：`/models*` 与 context routes 仍位于 tenant gate 之前，`/sessions/{id}/model`、files/control/bridge 仍位于 tenant gate 之后。

5. **route registry 与薄入口**
   - 新增 `workers/orchestrator-core/src/facade/route-registry.ts` 作为 ordered dispatch 中枢。
   - 将 `workers/orchestrator-core/src/index.ts` 收束为 18 行薄入口，仅保留 `worker.fetch()`、`dispatchFacadeRoute()`、`NanoOrchestratorUserDO` export 和 default export。
   - 本轮中途出现过一次“大 patch 没有真正把 facade 文件落盘”的异常；最终改为小批次重建并重新覆盖 `index.ts`，问题已消除。

6. **session-flow second pass 落地**
   - 保持 `workers/orchestrator-core/src/user-do/session-flow.ts` 为薄 façade（2 行 re-export）。
   - 新增 `workers/orchestrator-core/src/user-do/session-flow/{types,shared,hydrate,start,input,lifecycle,verify-read,index}.ts`。
   - 将 `createUserDoSessionFlow(ctx)` 的内部实现拆成 hydrate / start / input / lifecycle / verify-read 多模块，并修复拆分过程中暴露的 `requireReadableSession` 类型缺口。

7. **megafile budget hardening**
   - 更新 `scripts/megafile-budget.json`：
     - `workers/orchestrator-core/src/index.ts` ceiling 从 `3000` 下调到 `100`。
     - 新增 façade owner files：
       - `facade/route-registry.ts`
       - `facade/routes/{me,models,session-context,session-files,session-control,session-bridge}.ts`
     - 新增 User DO flow owner files：
       - `user-do/session-flow/{index,start,lifecycle,verify-read}.ts`
   - 所有新增 ceiling 均 `<1000`，符合 HP8 / HPX4 frozen law。

8. **最终 owner file 行数**
   - `workers/orchestrator-core/src/index.ts` = `18`
   - `workers/orchestrator-core/src/facade/route-registry.ts` = `52`
   - `workers/orchestrator-core/src/facade/routes/me.ts` = `481`
   - `workers/orchestrator-core/src/facade/routes/models.ts` = `289`
   - `workers/orchestrator-core/src/facade/routes/session-context.ts` = `162`
   - `workers/orchestrator-core/src/facade/routes/session-files.ts` = `200`
   - `workers/orchestrator-core/src/facade/routes/session-control.ts` = `599`
   - `workers/orchestrator-core/src/facade/routes/session-bridge.ts` = `171`
   - `workers/orchestrator-core/src/user-do/session-flow.ts` = `2`
   - `workers/orchestrator-core/src/user-do/session-flow/index.ts` = `62`
   - `workers/orchestrator-core/src/user-do/session-flow/start.ts` = `282`
   - `workers/orchestrator-core/src/user-do/session-flow/lifecycle.ts` = `375`
   - `workers/orchestrator-core/src/user-do/session-flow/verify-read.ts` = `91`

9. **测试结果**
   - `pnpm --filter @haimang/orchestrator-core-worker typecheck`：通过。
   - `pnpm --filter @haimang/orchestrator-core-worker build`：通过。
   - `pnpm --filter @haimang/orchestrator-core-worker test`：通过，`34` 个 test files 全绿。
   - `node scripts/check-megafile-budget.mjs`：通过，`16 owner file(s) within budget`。
   - `pnpm check:cycles`：通过。
   - `pnpm test`：通过，root regression exit code `0`。

10. **本轮收口判断**
    - HPX4 目标已经成立：`index.ts` 从 3015 行巨石收束为薄入口，session-flow 也完成了 second pass。
    - 当前没有新的 replacement megafile；新 façade / flow owner files 全部进入 megafile gate 且保持 `<1000`。
    - 后续若继续扩展 orchestrator-core façade，应优先在 `facade/routes/*` 对应 domain 内演进，而不是回填到 `src/index.ts`。
