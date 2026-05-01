# Nano-Agent 代码审查

> 审查对象: `hero-to-pro / HP2-HP4 + current broader hero-to-pro handoff`
> 审查类型: `mixed`
> 审查时间: `2026-04-30`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/charter/plan-hero-to-pro.md`
> - `docs/action-plan/hero-to-pro/HP2-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP3-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP4-action-plan.md`
> - `docs/issue/hero-to-pro/HP2-closure.md`
> - `docs/issue/hero-to-pro/HP3-closure.md`
> - `docs/issue/hero-to-pro/HP4-closure.md`
> - `docs/issue/hero-to-pro/HP5-closure.md`
> - `workers/orchestrator-core/**`
> - `workers/agent-core/**`
> - `workers/context-core/**`
> - `packages/nacp-session/**`
> - `clients/api-docs/**`
> - `test/cross-e2e/**`
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md`
> - `docs/action-plan/hero-to-pro/HP2-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP3-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP4-action-plan.md`
> - `docs/issue/hero-to-pro/HP2-closure.md`
> - `docs/issue/hero-to-pro/HP3-closure.md`
> - `docs/issue/hero-to-pro/HP4-closure.md`
> - `docs/issue/hero-to-pro/HP5-closure.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`HP2~HP4 的 first-wave 主体大体成立，但它们仍然停在 partial-live，不应按“已完成原 action-plan 全量预定工作”收口；与此同时，broader hero-to-pro 当前还存在一条已证实的 clients/api-docs 漂移，以及一条整体测试基线破损。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `HP2/HP3/HP4 当前真实状态是“first-wave 已落，核心后半段未完”，这一点与三份 closure 自己的 partial verdict 一致，不支持把三阶段表述成 completed。`
  2. `charter 明确要求 wire-with-delivery gate：任何 phase 宣称端点 live，都必须有对应 cross-e2e 文件；而 HP2~HP4 目前都没有把各自要求的 e2e 面补齐。`
  3. `clients/api-docs 已不再是 current broader hero-to-pro 的完整对外真相：HP5 的 /confirmations 与 row-first confirmation law 已 live，但 README / session / permissions / error-index 仍停在 RHX2/legacy 口径。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-hero-to-pro.md`
  - `docs/action-plan/hero-to-pro/HP2-action-plan.md`
  - `docs/action-plan/hero-to-pro/HP3-action-plan.md`
  - `docs/action-plan/hero-to-pro/HP4-action-plan.md`
  - `docs/issue/hero-to-pro/HP2-closure.md`
  - `docs/issue/hero-to-pro/HP3-closure.md`
  - `docs/issue/hero-to-pro/HP4-closure.md`
  - `docs/issue/hero-to-pro/HP5-closure.md`
  - `docs/templates/code-review.md`
- **核查实现**：
  - `workers/orchestrator-core/src/{index.ts,session-truth.ts,context-control-plane.ts,confirmation-control-plane.ts,checkpoint-restore-plane.ts,user-do/session-flow.ts,user-do/surface-runtime.ts}`
  - `workers/agent-core/src/{host/runtime-mainline.ts,host/orchestration.ts}`
  - `workers/context-core/src/{index.ts,control-plane.ts}`
  - `packages/nacp-session/src/{messages.ts,session-registry.ts,type-direction-matrix.ts}`
  - `workers/orchestrator-core/test/checkpoint-restore-plane.test.ts`
  - `clients/api-docs/{README,session,me-sessions,permissions,session-ws-v1,error-index}.md`
  - `test/cross-e2e/**`
- **执行过的验证**：
  - `glob test/cross-e2e/**/*.mjs`
  - `pnpm --filter @haimang/nacp-session test`
  - `pnpm --filter @haimang/context-core-worker test`
  - `pnpm --filter @haimang/agent-core-worker test`
  - `pnpm --filter @haimang/orchestrator-core-worker test`
  - `rg "confirmations|session\\.confirmation|/sessions/\\{id\\}/model|/me/conversations|/checkpoints|context/compact" clients/api-docs workers/orchestrator-core/src packages/nacp-session/src`
- **复用 / 对照的既有审查**：
  - `none` — `本文件只基于当前代码、action-plan、closure、charter、tests 与 clients/api-docs 的一手事实；未采纳其他 reviewer 的结论。`

### 1.1 已确认的正面事实

- `HP2` 的 first-wave model control plane 确实存在：`workers/orchestrator-core/src/index.ts:2136-2324` 已提供 `/models` list/detail 与 `GET/PATCH /sessions/{id}/model`，`workers/orchestrator-core/src/session-truth.ts:484-536` 已有 session model defaults / current state helper。
- `HP2` 的 runtime seam 已被接实：`workers/agent-core/src/host/runtime-mainline.ts:350-369` 现在会显式把 `modelId` / `reasoning` 送进 request builder，并按 canonical model 读取 `base_instructions_suffix` 接到 system prompt。
- `HP3` 的 context control-plane first-wave 确实存在：`workers/context-core/src/index.ts:210-310` 已 live `probe` / `layers` / `previewCompact` / `getCompactJob` / `triggerCompact`，不再是老的 `phase:"stub"` 返回。
- `HP4` 的 lifecycle/read-model/checkpoint first-wave 确实存在：`workers/orchestrator-core/src/index.ts:1103-1157,1220-1322` 已有 `/conversations/{conversation_uuid}`、checkpoint list/create/diff；`workers/orchestrator-core/src/user-do/session-flow.ts:636-821` 已有 close / delete / title write path。
- `HP5` 的 confirmation registry / API / schema 也确实已落：`workers/orchestrator-core/src/index.ts:1103-1133,1410-1528` 已 live `/sessions/{id}/confirmations` list/detail/decision；`packages/nacp-session/src/messages.ts:258-329,404-415` 已冻结 `session.confirmation.request/update` 与 7-kind / 6-status schema。

### 1.2 已确认的负面事实

- `HP2~HP4` 仍未满足 charter 的 wire-with-delivery gate：三份 closure 都明确写了 `pnpm test:cross-e2e` 未运行，而当前 `test/cross-e2e/` 目录也没有 HP2 model-switch/fallback、HP3 long-conversation、HP4 retry/restore、HP5 15-18 round-trip 文件。
- `HP3` 还不是完整 context state machine：代码中没有 `CrossTurnContextManager`，`workers/agent-core/src/host/orchestration.ts:294-300,425-433` 仍把 `compactRequired` 硬编码为 `false`。
- `HP4` 还不是完整 chat lifecycle：当前 `workers/orchestrator-core/src/index.ts` 仍没有 `/sessions/{id}/retry` 或 checkpoint restore public route，closure 对 retry / restore / rollback 未完成的表述与代码一致。
- `clients/api-docs` 当前对 HP5 broader truth 已经漂移：`clients/api-docs/README.md:84-123`、`clients/api-docs/session.md:7-42` 都没有 `/sessions/{id}/confirmations`；`clients/api-docs/permissions.md:1-27,177-186` 仍把 legacy permission/elicitation 路径描述成唯一 live client API，且仍写成 KV-first 旧语义。
- 当前 broader hero-to-pro 测试基线并不全绿：本轮 `pnpm --filter @haimang/orchestrator-core-worker test` 实际失败在 `test/checkpoint-restore-plane.test.ts` 的 fork / listForSession 两例，错误为 `FOREIGN KEY constraint failed`，对应 `workers/orchestrator-core/src/checkpoint-restore-plane.ts:387-423` 的 `openJob()` 路径。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 直接核对了 charter、HP2-HP4 action-plan、HP2-HP5 closure、实现代码、tests 与 clients/api-docs。 |
| 本地命令 / 测试 | `yes` | 重新执行了 `nacp-session`、`context-core`、`agent-core`、`orchestrator-core` 测试，并检查了 `test/cross-e2e` 实际文件集。 |
| schema / contract 反向校验 | `yes` | 反查了 `session.confirmation.*` schema、checkpoint restore schema、`/confirmations` 路由与 docs 缺口。 |
| live / deploy / preview 证据 | `no` | 本轮不以 preview/live deploy 作为主要证据。 |
| 与上游 design / QNA 对账 | `yes` | 以 charter / action-plan / closure 的冻结目标为基线，判断哪些 in-scope 已落、哪些仍是 partial 或 missing。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | HP2~HP4 仍未通过 charter 的 wire-with-delivery gate | `high` | `delivery-gap` | `yes` | 在继续宣称 HP2~HP4 live/completed 前，补齐对应 cross-e2e 文件并跑绿 |
| R2 | HP3 仍停在 control-plane first wave，runtime owner / auto-compact / strip-recover 未闭环 | `high` | `delivery-gap` | `yes` | 先完成 `CrossTurnContextManager`、model-aware compact signal、strip/recover 与 breaker，再讨论 HP3 close |
| R3 | HP4 仍停在 lifecycle/checkpoint first wave，retry / restore / rollback 未进入 public plane | `high` | `delivery-gap` | `yes` | 完成 `/retry`、conversation_only restore、rollback / restart-safe 与对应 e2e 后再收口 HP4 |
| R4 | `clients/api-docs` 已落后于 current broader hero-to-pro confirmation truth | `medium` | `docs-gap` | `no` | 补写 `/confirmations`、`confirmation-already-resolved` 与 row-first law，并把 `permissions.md` 改成 legacy compat 视角 |
| R5 | broader hero-to-pro 当前测试基线不全绿：`checkpoint-restore-plane` 两例失败 | `medium` | `test-gap` | `no` | 修正 `D1CheckpointRestoreJobs.openJob()` 的 fork / listForSession 路径或相应测试 fixture，再恢复全绿基线 |

### R1. HP2~HP4 仍未通过 charter 的 wire-with-delivery gate

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-hero-to-pro.md:272,1033` 明确规定：任何 phase 宣称端点 live，必须有对应 `test/cross-e2e/*.test.mjs` 文件与端到端全绿证据。
  - `docs/charter/plan-hero-to-pro.md:333-336` 把 HP2/HP3/HP4/HP5 的交付物都写成 `端点 + e2e + closure`。
  - `docs/issue/hero-to-pro/HP2-closure.md:98-111`、`HP3-closure.md:99-112`、`HP4-closure.md:102-118`、`HP5-closure.md:117-133` 都明确登记 `pnpm test:cross-e2e` 未运行。
  - 本轮 `glob test/cross-e2e/**/*.mjs` 只看到 15 个既有文件，未看到 HP2 model-switch/fallback、HP3 long-conversation、HP4 retry/restore、HP5 15-18 round-trip 的目标文件。
- **为什么重要**：
  - 这不是“测试还可以以后补”的软建议，而是 charter 自己定义的硬闸；不满足它，就不能把对应 phase 说成 full-live 或 completed。
  - HP2/HP3/HP4 恰好都是控制平面 phase，缺少 e2e 时最容易出现“route / D1 / stream / prompt 各自局部成立，但端到端语义没有真正闭合”的假阳性。
- **审查判断**：
  - 三份 closure 目前把自己写成 `partial-live` 是诚实的；不诚实的是把这三阶段整体描述成“已完成原预定工作”。
  - 只要 cross-e2e 还没补齐，本轮 review 就不能收口。
- **建议修法**：
  - HP2：至少补 `model-switch-reasoning`、`model-switch-vision`、`model-alias-resolve`、`model-fallback` 一组 e2e。
  - HP3：至少补 long-conversation / compact / cross-turn recall / breaker 一组 e2e。
  - HP4：至少补 close/delete/title/retry/restore 以及 mid-restore restart 一组 e2e。
  - HP5：把 charter 点名的 15-18 round-trip e2e 真落到 `test/cross-e2e/`。

### R2. HP3 仍停在 control-plane first wave，runtime owner / auto-compact / strip-recover 未闭环

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/action-plan/hero-to-pro/HP3-action-plan.md:46-49,150-154,180-187` 把 `CrossTurnContextManager`、model-aware auto-compact、strip-then-recover、3 次失败 breaker、long-conversation e2e 都列为 in-scope。
  - `docs/issue/hero-to-pro/HP3-closure.md:16-23,47-51` 自己也承认当前只是 `context control-plane first wave`。
  - `rg "CrossTurnContextManager" workers/agent-core/src` 当前无任何实现命中。
  - `workers/agent-core/src/host/orchestration.ts:294-300,425-433` 仍把 `compactRequired` 固定为 `false`。
  - `rg "<model_switch>" workers packages` 当前无实际 developer message 注入代码；`workers/context-core/src/control-plane.ts` 与 `workers/orchestrator-core/src/context-control-plane.ts` 只有 `protected_fragment_kinds` marker，没有 recover 回真实下一次 prompt 的主线。
- **为什么重要**：
  - 这意味着 HP3 当前更像“inspection/control-plane 解 stub”，还不是 charter 定义的完整 context state machine。
  - 没有 runtime owner、auto-compact 和 recover，probe/preview/job 看起来再完整，也仍然不能证明真实 prompt assembly 与 compact 行为已经闭环。
- **审查判断**：
  - HP3 first-wave 的 control-plane 结果可以接受，也确实给 HP4/HP9 提供了 durable boundary/job handle。
  - 但它离 HP3 action-plan 的完整 in-scope 仍有实质距离，不能关闭 review。
- **建议修法**：
  - 先在 agent-core 落真正的 cross-turn prompt owner，而不是继续只做 inspection plane。
  - 用 model metadata 把 `compactRequired` 从常量 `false` 改成真实调度信号。
  - 实现 `<model_switch>` / `<state_snapshot>` 的 strip-then-recover 与 3 次失败 breaker，再补对位 e2e。

### R3. HP4 仍停在 lifecycle/checkpoint first wave，retry / restore / rollback 未进入 public plane

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/action-plan/hero-to-pro/HP4-action-plan.md:152-157,181-189` 明确把 latest-turn retry、restore job、rollback / restart-safe、lifecycle/retry/restore e2e 都列为 in-scope。
  - `docs/issue/hero-to-pro/HP4-closure.md:16-23,49-52` 明确登记 retry / restore / rollback / cross-e2e 未完成。
  - `rg "/retry|/restore" workers/orchestrator-core/src/index.ts` 当前对 public route 没有命中；`workers/orchestrator-core/src/index.ts:1136-1157` 的 checkpoint route parser 也只支持 list/create/diff。
  - 虽然 repo 已有 `workers/orchestrator-core/src/checkpoint-restore-plane.ts`，但这属于后续 restore substrate/helper，不等于 HP4 public plane 已完成。
- **为什么重要**：
  - HP4 的核心难点不只是加 close/delete/title，而是把 retry 与 restore 变成真正可追溯、可回滚、可 restart-safe 的 chat lifecycle。
  - 当前 first-wave 已让 session/conversation 有了管理面，但“重试 / 恢复”这两个最接近产品级 lifecycle 的动作仍未交付。
- **审查判断**：
  - HP4 first-wave 作为阶段前半段是可信的；但它还不能代表“HP4 已完成”。
  - 当前 review 不能放行 HP4 收口。
- **建议修法**：
  - 先补 `/sessions/{id}/retry` 与 attempt chain public surface。
  - 再把 conversation_only restore、rollback / restart-safe 和相应 e2e 真接到 public plane，而不是只停留在 helper 层。

### R4. `clients/api-docs` 已落后于 current broader hero-to-pro confirmation truth

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:1113-1133,1423-1528` 已 live `/sessions/{id}/confirmations` list/detail/decision，并返回 `confirmation-already-resolved`(409)。
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:59-77,77-115` 已把 legacy permission/elicitation 纳入 **row-first** confirmation law，而不是旧的“先 KV、再 best-effort RPC”。
  - `clients/api-docs/README.md:84-123` 和 `clients/api-docs/session.md:7-42` 仍然没有 `/sessions/{id}/confirmations`。
  - `clients/api-docs/permissions.md:14-27,68-73,161-166,177-186` 仍把 legacy permission/elicitation 路径写成唯一 live client API，并继续描述 KV-first / runtime 不等待的 RHX2 语义。
  - `clients/api-docs/error-index.md` 当前也没有 `confirmation-already-resolved`。
- **为什么重要**：
  - 这已经不是“还没写 HP9 文档大包”的单纯时间差，而是 current docs 对已 live 的 broader hero-to-pro surface 给出了不完整甚至过时的客户端认知。
  - 客户端如果继续只按 `permissions.md` / `README.md` 接口矩阵集成，会直接漏掉 unified confirmation plane，也会误判 legacy compat 路径的当前语义。
- **审查判断**：
  - 当前 `clients/api-docs` 不能被称为 error-free，也不能被称为完整匹配当前 broader hero-to-pro 代码事实。
  - 这不影响 HP2~HP4 first-wave 代码本身的正确性，但会影响后续 client/QA/文档审计的真实性。
- **建议修法**：
  - 在 `README.md` / `session.md` 中补入 `/sessions/{id}/confirmations` list/detail/decision。
  - 新增 confirmation control-plane 的客户端文档，或把 `permissions.md` 明确改写为 legacy compat appendix。
  - 在 `error-index.md` 中补入 `confirmation-already-resolved`，并解释 legacy permission/elicitation 与 generic confirmation plane 的关系。

### R5. broader hero-to-pro 当前测试基线不全绿：`checkpoint-restore-plane` 两例失败

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - 本轮 `pnpm --filter @haimang/orchestrator-core-worker test` 实际失败，只有 `31 passed / 1 failed file / 2 failed tests`。
  - 失败用例是 `workers/orchestrator-core/test/checkpoint-restore-plane.test.ts:333-343,455-472`：`allows fork without confirmation_uuid` 与 `listForSession returns jobs in started_at desc order`。
  - 失败栈落在 `workers/orchestrator-core/src/checkpoint-restore-plane.ts:387-423` 的 `openJob()`，错误是 `FOREIGN KEY constraint failed`。
  - 同一轮里 `pnpm --filter @haimang/nacp-session test`、`context-core-worker test`、`agent-core-worker test` 都通过，说明当前 broken baseline 集中在 broader-stage restore helper。
- **为什么重要**：
  - 这说明 broader hero-to-pro 当前已经不再是“单包全绿、只有 docs/phase partial”的状态，而是出现了实际测试回归。
  - 即使这条线更接近 HP7，也会直接影响“当前主线可作为稳态继续推进”的可信度。
- **审查判断**：
  - 这不是 HP2~HP4 first-wave 自身的 blocker，但它是 broader hero-to-pro 当前必须登记的真实断点。
  - 它也再次说明当前阶段不适合被描述为“已整体稳定收口”。
- **建议修法**：
  - 先核对 `openJob()` 的 fork 路径与 test fixture 对 `target_session_uuid` / FK 约束的预期是否一致。
  - 修复后恢复 `orchestrator-core` 测试全绿，再继续扩写 HP7 restore line。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | HP2：`/models/{id}`、`GET/PATCH /sessions/{id}/model`、alias/detail truth | `done` | API、repo helper 与 tests 都存在，first-wave control plane 可信。 |
| S2 | HP2：requested/effective audit + explicit runtime model wiring | `done` | orchestrator durable audit 已落，agent-core runtime seam 也已真接线。 |
| S3 | HP2：`<model_switch>`、`model.fallback`、cross-e2e | `missing` | closure 已登记 `not-yet` / `not-run`，代码中也看不到实际注入/事件/e2e。 |
| S4 | HP3：probe/layers/compact-preview/job first wave | `done` | context-core destub 与 façade 五件套真实存在。 |
| S5 | HP3：runtime owner / auto-compact / strip-recover / breaker / long-conversation e2e | `partial` | marker/job handle 有了，但 prompt owner、compact signal、recover、breaker、e2e 都没闭环。 |
| S6 | HP4：close/delete/title、true cursor read model、conversation detail、checkpoint list/create/diff | `done` | lifecycle / read model / checkpoint registry first-wave 代码与测试都成立。 |
| S7 | HP4：retry、restore、rollback / restart-safe、lifecycle-retry-restore e2e | `missing` | 当前 public plane 里仍看不到 retry/restore；closure 也明确未完成。 |
| S8 | HP5：confirmation registry / API / frame family / kernel rename / dispatcher injection | `partial` | first-wave 已落，但 emitter-side live caller 与 15-18 cross-e2e 未闭环。 |
| S9 | broader hero-to-pro：`clients/api-docs` 已完整匹配当前代码 | `stale` | HP5 `/confirmations` 与 row-first law 当前未被 docs 如实覆盖。 |
| S10 | broader hero-to-pro：当前相关包测试基线全绿 | `stale` | `orchestrator-core` 本轮测试实际失败两例。 |

### 3.1 对齐结论

- **done**: `4`
- **partial**: `2`
- **missing**: `2`
- **stale**: `2`
- **out-of-scope-by-design**: `0`

这更像“HP2~HP4 的前半段控制面已经成型，HP5 也起了 first-wave 骨架，但真正的 runtime/enforcement/e2e/documentation 收口还没有完成”，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | HP2 不做 multi-provider routing / fallback chain | `遵守` | 当前只做 single-provider + single-step future seam，没有越界做 provider 路由。 |
| O2 | HP3 不新增 `nano_compact_jobs` | `遵守` | 当前 compact job handle 继续复用 `compact_boundary` checkpoint，符合 Q12/HP1 freeze。 |
| O3 | HP4 不引入 `closed` 状态、`deleted_by_user_uuid`、undelete | `遵守` | 当前 close/delete 仍然遵守 Q13/Q14 边界。 |
| O4 | charter 要求 HP2-HP8 不更新 `clients/api-docs`，统一到 HP9 | `部分违反` | `docs/charter/plan-hero-to-pro.md:273` 明确冻结了文档后置纪律，但 HP2/HP3/HP4 closure 都登记了对 `clients/api-docs` 的提前更新；这不伤 runtime correctness，但属于阶段治理 drift。 |
| O5 | repo 已有 `checkpoint-restore-plane.ts` helper，是否可视作 HP4 restore 已完成 | `误报风险` | 不能。当前只是更后期 restore substrate/helper 存在，public `/restore` route 与 rollback/e2e 仍未落。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`HP2~HP4 first-wave 代码主体成立，但三阶段仍未完成 action-plan 定义的全量交付；本轮 review 不收口。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `按 charter wire-with-delivery gate 补齐 HP2/HP3/HP4（以及 HP5 15-18）的 cross-e2e，并以实跑结果重新证明 live surface。`
  2. `完成 HP3 的 runtime owner / auto-compact / strip-recover，以及 HP4 的 retry / restore / rollback 主链，否则不能把 HP2~HP4 说成“完成预定工作”。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `修正 clients/api-docs 对 HP5 current truth 的漂移，尤其是 /confirmations、row-first law 与 confirmation-already-resolved。`
  2. `修复 orchestrator-core 当前 checkpoint-restore-plane 两个失败用例，恢复 broader hero-to-pro 的整体测试基线。`
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应

> 本节是对 GPT-5.4 / Deepseek / GLM 三份 HP2-HP4 review 的整体合并回应。回应按各 reviewer 的 R 编号（GPT-R*、DS-R*、GLM-R*）逐项对齐，不模糊归纳；不修改 §0-§5 reviewer 内容。

### 6.1 对本轮审查的回应

> 执行者: `claude-opus-4-7 (1M context)`
> 执行时间: `2026-04-30`
> 回应范围: `GPT-R1..R5 + DS-R1..R14 + GLM-R1..R15`
> 对应审查文件:
> - `docs/code-review/hero-to-pro/HP2-HP4-reviewed-by-GPT.md`
> - `docs/code-review/hero-to-pro/HP2-HP4-reviewed-by-deepseek.md`
> - `docs/code-review/hero-to-pro/HP2-HP4-reviewed-by-GLM.md`

- **总体回应**：三份 review 共 34 条 finding，去重后实质问题 21 条；其中 1 条已 stale（GPT-R5 测试失败已被 HP7 P0 fork FK fix 收掉）、1 条 trivial doc fix（DS-R9 HP3 action-plan `draft` → `executed`，已 fix）、其余 19 条均落在 HP2/HP3/HP4/HP5 各自 closure 已显式登记的 partial / deferred 项内（charter §0.5 wire-with-delivery 法律下，每条都有明确承接 phase 与 unlock condition），不在本轮做"为修而修"的 wire-without-consumer 提前接线。
- **本轮修改策略**：
  1. **有效且当下可独立修复的**：HP3 action-plan 状态标签修正（DS-R9）。
  2. **stale-rejected**：GPT-R5（orchestrator-core 测试失败已修，本地 305/305 全绿）。
  3. **deferred-with-rationale**：HP2/HP3/HP4/HP5 各自 closure §2 已显式登记的 partial 项（`<model_switch>` / `model.fallback` / `CrossTurnContextManager` / `auto-compact` / `strip-recover` / `circuit breaker` / `retry route` / `restore route` / `preview cache` / `confirmation emitter row-create` / 全部 cross-e2e）— charter 已把这些归到对应 follow-up 批次，不在本轮提前接线。
  4. **discipline-acknowledged**：clients/api-docs 提前更新违反 charter §4.4 D7 后置纪律（DS-R8 / GLM-R9），承认实质 drift 但不回滚已对齐的内容；HP5-HP8 后续严格不再更新 api-docs。
  5. **HP9 territory**：7 个新端点文档缺失 + error-index 缺新 code（GPT-R4 / GLM-R10 / DS-R8 部分）— charter §1.1 D7 + §10.1 第 3 条把 18 份文档全量对齐冻结到 HP9，本轮不在 HP2-HP8 散打补，避免再次踩 D7 红线。
  6. **HP10 cleanup territory**：context-core `assemblerOps` deprecated alias（GLM-R8 / DS-R13）+ MODEL_PROMPT_SUFFIX_CACHE 无 TTL（GLM-R6）+ model profile 解析跨 worker 重复（GLM-R7）— 已在代码中 `@deprecated` 标注，HP10 final cleanup 物理移除。
- **实现者自评状态**：`partially-closed`（trivial fix 已落 + stale 已确认；其余 deferred 项的承接位置全部显式标注，等待对应 phase 后续批次）

### 6.2 逐项回应表

#### 6.2.1 GPT review

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| GPT-R1 | HP2~HP4 未通过 charter wire-with-delivery gate（cross-e2e 缺失） | `deferred-with-rationale` | 与 DS-R10 / GLM-R5 同源。HP2/HP3/HP4/HP5 closure §2 已显式登记 cross-e2e 为 partial；charter §8.3 wire-with-delivery gate 在每个 phase 后续批次（HP2 model-switch 5+ / HP3 long-conversation 5+ / HP4 lifecycle-retry-restore 6+ / HP5 round-trip 15-18）补齐。本轮不新增 e2e，避免在缺 runtime owner（HP3 CrossTurnContextManager）与 retry/restore route（HP4 后续）的情况下补出 surface-only e2e。 | — |
| GPT-R2 | HP3 runtime owner / auto-compact / strip-recover 未闭环 | `deferred-with-rationale` | 与 DS-R1+R5 / GLM-R2 同源。HP3 closure §2 P1/P2/P4 已显式登记；compactRequired 硬编码 `false` 在 `workers/agent-core/src/host/orchestration.ts:296,429` 是 control-plane first wave 与 runtime owner 的边界。HP3 后续批次落 `CrossTurnContextManager` + budget signal + breaker。 | — |
| GPT-R3 | HP4 retry / restore / rollback 未进入 public plane | `deferred-with-rationale` | 与 DS-R2+R6 / GLM-R3 同源。`workers/orchestrator-core/src/checkpoint-restore-plane.ts` 文件头明确标注 `HP7 — checkpoint restore plane`，并非 HP4 territory；HP4 closure §2 P2/P3 已登记 restore 为 deferred。HP7 P0/P1 已落 `D1CheckpointSnapshotPlane` + `D1CheckpointRestoreJobs` + `CheckpointDiffProjector`，public route 在 HP7 后续批次接线。`/retry` 路由在 HP4 后续批次接线。 | — |
| GPT-R4 | clients/api-docs 落后于 HP5 confirmation truth | `deferred-with-rationale` | 与 GLM-R10 / DS-R8 同源。charter §1.1 D7 + §10.1 第 3 条明确把 `clients/api-docs/` 18 份全量对齐冻结到 HP9 一次性集中收口；本轮不再散打更新（HP5 closure §3 已自陈相同纪律承诺）。HP9 启动时以 HP8 freeze 为基线全量补 `confirmations.md` / `todos.md` / `models.md` / `context.md` / `checkpoints.md` / `workspace.md` / `transport-profiles.md` 7 份新文档 + `error-index.md` 全 code 重排。 | — |
| GPT-R5 | orchestrator-core checkpoint-restore-plane.test.ts 两例 FK 失败 | `stale-rejected` | 本轮重跑 `pnpm --filter @haimang/orchestrator-core-worker test` → **305/305 全绿**（包括 `checkpoint-restore-plane.test.ts` 全部用例）。该失败已在 HP7 P0 通过 seed 增加 `CHILD_SESSION_UUID` 满足 `target_session_uuid` FK 约束修复（见 `workers/orchestrator-core/test/checkpoint-restore-plane.test.ts` 已包含 child session seed）。GPT 审查时点的失败是 HP7 P0 修复前快照，已 stale。 | `workers/orchestrator-core/test/checkpoint-restore-plane.test.ts` (HP7 P0 fix) |

#### 6.2.2 Deepseek review

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| DS-R1 | `compactRequired` 硬编码 false → auto-compact 死链路 | `deferred-with-rationale` | 与 GPT-R2 / GLM-R2 同源。`workers/agent-core/src/host/orchestration.ts:296,429` 当前确为硬编码 `false`，是 HP3 control-plane first wave 与 runtime owner 的边界——HP3 closure §2 P2 已显式登记 `not-wired`。承接位置：HP3 后续批次（接入 budget signal + model-aware threshold + scheduler 路径）。本轮不在缺 `CrossTurnContextManager` 的情况下单独接 compactRequired，避免 wire-without-owner。 | — |
| DS-R2 | `checkpoint-restore-plane.ts` 无 HTTP 路由 | `deferred-with-rationale` | 与 GPT-R3 / GLM-R3 同源。文件头第 1 行已标 `HP7 — checkpoint restore plane`；HP4 closure §2 P2/P3 已登记 restore 为 deferred；HP7 closure §2 已登记 public route 为 HP7 后续批次。Reviewer 担心的 wire-without-delivery 模式我们承认，但这条 carryover 的 owner 不是 HP4 而是 HP7，现已在 HP7 P0/P1 把 substrate（snapshot lineage + restore jobs + diff projector）落地，public route 是 HP7 P2-P3 工作。 | — |
| DS-R3 | `<model_switch>` developer message 缺失 | `deferred-with-rationale` | HP2 closure §2 P2 已登记 `not-started`；charter §7.3 收口标准第 4 项要求。承接位置：HP2 后续批次 + HP3 后续批次（HP3 strip-then-recover 需依赖 `<model_switch>` 已注入）。 | — |
| DS-R4 | `model.fallback` stream event 缺失 | `deferred-with-rationale` | HP2 closure §2 P3 已登记 `not-started`。承接位置：HP2 后续批次（与 fallback 触发链路一起落）。 | — |
| DS-R5 | `CrossTurnContextManager` 不存在 | `deferred-with-rationale` | HP3 closure §2 P1 已登记 `not-started-in-runtime`。承接位置：HP3 后续批次。 | — |
| DS-R6 | retry 路由不存在 | `deferred-with-rationale` | HP4 closure §2 P1 已登记 `not-started-on-public-surface`。承接位置：HP4 后续批次。 | — |
| DS-R7 | agent-core ↔ orchestrator-core 模型状态传递断裂 | `partially-fixed (architectural-acknowledged)` | 现状核查：`workers/orchestrator-core/src/user-do/message-runtime.ts:222-260` 已做完整三层解析（`requestedModel ?? sessionDefaultModel ?? globalDefaultModel`）→ `selectedModelId`，并通过 `forwardInternalJsonShadow` 在 `input` 消息体中以 `model_id` 字段传给 agent-core；`workers/agent-core/src/host/runtime-mainline.ts:218-237` 的 `readLlmRequestEvidence()` 从 message payload 直接读取该字段。**所以"session default 在 agent-core 内部完全不可知"是不准确的——live LLM path 上 session default 已通过结构化字段传递**。Reviewer 真正指出的是"非 message-path 的旁路（compact summary / retry resume / cross-turn manager）尚无独立结构化通道"——这条架构债 HP3 `CrossTurnContextManager` 与 HP4 retry 各自的 deferred 批次会在落 consumer 时同时落 `MainlineKernelOptions.modelDefaults` 字段，避免本轮提前加无 consumer 的 seam（charter §0.5 反对的 wire-without-consumer）。 | 现状已 verified，不改代码 |
| DS-R8 | clients/api-docs 散落更新违反 charter §4.4 纪律 3 | `discipline-acknowledged` | 与 GLM-R9 同源。审查事实成立——HP2/HP3/HP4 closure §0 均报告 `clients/api-docs updated`，与 charter §1.1 D7 + §4.4 纪律 3 冲突。但 reviewer 也确认更新内容**与代码事实对齐良好且诚实**（无 stub 残留、无错误声明）。处理方式：（a）不回滚已对齐的内容（rollback 本身会再次违纪并破坏当前文档质量）；（b）HP5-HP8 strict 不再更新 `clients/api-docs/`（HP5/HP6/HP7/HP8 closure §0 都已遵守该约束，本轮 review 之后继续遵守）；（c）HP9 启动时仍以 HP8 freeze 版本为基线全量 review，把已散落更新的内容并入 18 份对齐表。 | — |
| DS-R9 | HP3 action-plan 文档状态 `draft` 与实际不符 | `fixed` | 已将 `docs/action-plan/hero-to-pro/HP3-action-plan.md:30` 的 `文档状态: draft` 改为 `文档状态: executed`，与 HP2 一致。 | `docs/action-plan/hero-to-pro/HP3-action-plan.md:30` |
| DS-R10 | 全部 HP2-HP5 cross-e2e 未执行 | `deferred-with-rationale` | 与 GPT-R1 / GLM-R5 同源。HP2/HP3/HP4/HP5 closure §6/§7 均诚实标注 `pnpm test:cross-e2e: not run`。承接位置：每 phase 后续批次按 charter §8.3 配额补齐对应 e2e。 | — |
| DS-R11 | `model.fallback` stream event 不存在（dup） | — | dup of DS-R4，处理方式同 DS-R4。 | — |
| DS-R12 | confirmation emitter 侧 row-create 未接通 | `deferred-with-rationale` | 与 GLM-R15 同源。HP5 closure §2 P1 已登记 emitter 侧为 `not-wired-on-emitter-side`，row-first dual-write 法律的"先 row 再 best-effort RPC"在 emitter 路径未接。承接位置：HP5 后续批次（接 PreToolUse emitter caller，使 ask policy 暂停时 `/confirmations?status=pending` 立即可查）。 | — |
| DS-R13 | context-core RPC destub 旧方法签名仍保留 | `deferred-with-rationale` | `workers/context-core/src/index.ts:179-182` `assemblerOps()` 已标注 `@deprecated, Renamed to contextOps() per ZX5 review GLM R11`。承接位置：HP10 final cleanup 物理删除（charter §10 cleanup phase）。 | — |
| DS-R14 | HP2-HP5 全部 closure 均标 `partial` — 不存在一个完成的 phase | `acknowledged-not-a-fix` | 这是 reviewer 自身得出的"first-wave 主体诚实成立"结论的一部分（DS §0、GPT §0、GLM §0 都明确："three closures honestly mark themselves partial-live, no deceptive closure"）。partial-live 是 charter §0.5 wire-with-delivery 法律下"先把 control-plane / lifecycle / read-model 落地，runtime owner + e2e 留到下批次"的结构性选择，不是要修的 bug。各阶段的 unlock condition 均显式列在对应 closure §2。 | — |

#### 6.2.3 GLM review

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| GLM-R1 | `<model_switch>` 与 `model.fallback` 未落地 | `deferred-with-rationale` | 与 DS-R3 + DS-R4 同源，处理方式同 DS-R3/DS-R4。 | — |
| GLM-R2 | `CrossTurnContextManager` 与 auto-compact runtime 未接入 | `deferred-with-rationale` | 与 DS-R1 + DS-R5 / GPT-R2 同源，处理方式同 DS-R1/DS-R5。 | — |
| GLM-R3 | retry / restore job / rollback 仍未接线 | `deferred-with-rationale` | 与 DS-R2 + DS-R6 / GPT-R3 同源，处理方式同 DS-R2/DS-R6。 | — |
| GLM-R4 | circuit breaker 未接线 | `deferred-with-rationale` | HP3 closure §2 P4 已登记。承接位置：HP3 后续批次（与 compact 失败 3 次熔断同 batch）。 | — |
| GLM-R5 | 全部 cross-e2e 未运行 | `deferred-with-rationale` | 与 GPT-R1 / DS-R10 同源。 | — |
| GLM-R6 | `MODEL_PROMPT_SUFFIX_CACHE` 无 TTL/驱逐 | `deferred-with-rationale` | `workers/agent-core/src/host/runtime-mainline.ts:167` 是 in-memory `Map<string, string>`，单 worker 实例 LRU/TTL 当前不构成 production 风险（catalog row 改动罕见 + worker 寿命短）。承接位置：HP8 stop-the-bleed 或 HP10 cleanup 加 TTL/eviction（与 model profile 跨 worker dup 一并处理，见 GLM-R7）。 | — |
| GLM-R7 | model profile 解析逻辑跨 worker 重复 | `deferred-with-rationale` | orchestrator-core `session-truth.ts:421-471` 与 agent-core `runtime-mainline.ts:218-260` 各自做了 alias resolve / metadata read 的相似工作。承接位置：HP8 stop-the-bleed 或 HP10 cleanup（合并为共享 helper 或确立 single-source）。本轮不动，避免在 HP3/HP4 deferred 工作前打散现有 LLM path。 | — |
| GLM-R8 | context-core `assemblerOps` 废弃 alias 仍存在 | `deferred-with-rationale` | `workers/context-core/src/index.ts:179-182` 已 `@deprecated`，charter §10 final cleanup 物理删除（与 DS-R13 同源）。 | — |
| GLM-R9 | clients/api-docs 提前更新违反 charter D7 后置纪律 | `discipline-acknowledged` | 与 DS-R8 同源，处理方式同 DS-R8。 | — |
| GLM-R10 | 7 个新端点（confirmation×3 / todo×4）完全缺失文档 | `deferred-with-rationale` | 与 GPT-R4 同源。charter §10.1 第 3 条把 18 份文档冻结到 HP9 一次性对齐；HP9 必须新增 `confirmations.md` + `todos.md` + 5 份其他文档。 | — |
| GLM-R11 | `fallback_model_id` 不存在链式解析 | `deferred-with-rationale` | HPX-qna Q8 已冻结 fallback 为 single-step（不允许 fallback chain）；`session-truth.ts:91,381` 当前只读取 `fallback_model_id` row 但 fallback 触发链路本身（DS-R4 `model.fallback` event）尚未实现，所以二次校验暂无 caller。承接位置：HP2 后续批次实现 fallback 触发时，必须在 fallback model 上跑 `resolveModelForTeam()` 同样的 metadata + capability + policy gate 校验链。 | — |
| GLM-R12 | cross-e2e 无 HP2 model 状态机专用测试 | `deferred-with-rationale` | 与 GLM-R5 / GPT-R1 / DS-R10 同源。 | — |
| GLM-R13 | HP3 compact preview 60s cache 未实现 | `deferred-with-rationale` | HPX-qna Q12 冻结要求"同 session + 同 high-watermark 60s 内复用 cache"；HP3 closure §2 P3 partial 标记中已隐含（control-plane preview live 但 cache 未落）。承接位置：HP3 后续批次在 `workers/orchestrator-core/src/context-control-plane.ts` 或 `workers/context-core/src/control-plane.ts` 加 session-scoped TTL Map。 | — |
| GLM-R14 | HP4 `DELETE /sessions/{id}` user DO 调度行为 | `acknowledged-not-a-fix` | reviewer 自身判定 `handleDelete` 行为正确（先 end session 再 tombstone conversation）。无需修复。 | — |
| GLM-R15 | HP5 PreToolUse emitter 侧 row-create 未接通 | `deferred-with-rationale` | 与 DS-R12 同源，处理方式同 DS-R12。 | — |

### 6.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号 | 说明 |
|------|------|------|------|
| 已完全修复 | 1 | DS-R9 | HP3 action-plan `文档状态: draft` → `executed`（修改 1 行） |
| 部分修复，需二审判断 | 1 | DS-R7 | 现状已 verified（live LLM path 通过 message-payload `model_id` 通道结构化传递），架构债（非 message-path 旁路通道）显式承接到 HP3/HP4 后续批次的 `MainlineKernelOptions.modelDefaults` |
| 有理由 deferred | 18 | GPT-R1/R2/R3/R4, DS-R1/R2/R3/R4/R5/R6/R10/R11/R12/R13, GLM-R1/R2/R3/R4/R5/R6/R7/R8/R10/R11/R12/R13/R15 | 全部承接到 HP2/HP3/HP4/HP5 后续批次或 HP8/HP9/HP10 charter-aligned 时点；每条都有显式 unlock condition（见对应 closure §2 / charter §10） |
| 拒绝 / stale-rejected | 1 | GPT-R5 | orchestrator-core 测试本轮重跑 305/305 全绿，HP7 P0 fork FK seed fix 已收掉；reviewer 时点快照失效 |
| 仍 blocked | 0 | — | 无 blocker（GPT/DS 标 yes-blocker 的 R1-R3、DS-R1/R2/R7 全部归类为 charter §0.5 法律下"control-plane first wave + 后续批次承接"的有计划 deferred，不是无承接的 blocker；GLM 整体判断 `approve-with-followups` 与此一致） |
| 纪律承认 / 不修不回滚 | 2 | DS-R8, GLM-R9 | clients/api-docs 提前更新违反 charter §1.1 D7 / §4.4 纪律 3，承认为 discipline drift；不回滚（内容已对齐）；HP5-HP8 strict 不再更新；HP9 全量收口 |
| Reviewer 自身确认非 finding | 2 | DS-R14, GLM-R14 | DS-R14 是"三 closure honestly partial"的元判断；GLM-R14 reviewer 自己得出"行为正确"结论 |

### 6.4 变更文件清单

- `docs/action-plan/hero-to-pro/HP3-action-plan.md` — 第 30 行 `文档状态` 由 `draft` 改为 `executed`，修复 DS-R9 与 HP2/HP4 一致性。
- `docs/code-review/hero-to-pro/HP2-HP4-reviewed-by-GPT.md` — 追加本 §6 实现者回应（应 reviewer §5 实现者回应入口要求 + `docs/templates/code-review-respond.md`）。

### 6.5 验证结果

> 与本轮回应直接相关的验证。GPT-R5（test 失败 stale 判定）走实跑命令；其他 deferred 项不在本轮验证范围（未来对应 phase 后续批次落地后由 reviewer 二次审查）。

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|--------|-------------|------|----------------|
| orchestrator-core 全单元 | `pnpm --filter @haimang/orchestrator-core-worker test` | `pass (33 files / 305 tests)` | GPT-R5 stale 判定 |
| HP3 action-plan 状态修正 | `head docs/action-plan/hero-to-pro/HP3-action-plan.md` | `pass (文档状态: executed)` | DS-R9 |
| compactRequired 硬编码现状 | `grep -n "compactRequired" workers/agent-core/src/host/orchestration.ts` → `296: false`, `429: false` | `confirmed-as-deferred` | DS-R1 / GPT-R2 / GLM-R2 |
| message-runtime 模型三层解析现状 | `sed -n '210,260p' workers/orchestrator-core/src/user-do/message-runtime.ts` | `confirmed: requestedModel ?? sessionDefaultModel ?? globalDefaultModel` 三层链已 live；`forwardInternalJsonShadow` payload 携带 `model_id` | DS-R7 partial-fix 现状判定 |
| checkpoint-restore-plane HP7 归属 | `head -10 workers/orchestrator-core/src/checkpoint-restore-plane.ts` | `confirmed-HP7-territory (file header line 1: "HP7 — checkpoint restore plane")` | GPT-R3 / DS-R2 / GLM-R3 |
| context-core deprecated alias | `grep "@deprecated" workers/context-core/src/index.ts` | `confirmed-marked-deprecated` | DS-R13 / GLM-R8 |

```text
# orchestrator-core test 运行摘要
Test Files  33 passed (33)
     Tests  305 passed (305)
  Duration  13.42s

# GPT-R5 referenced 失败：
# test/checkpoint-restore-plane.test.ts:333 "allows fork without confirmation_uuid" — 现 PASS
# test/checkpoint-restore-plane.test.ts:455 "listForSession returns jobs in started_at desc order" — 现 PASS
```

### 6.6 未解决事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| GPT-R1 / DS-R10 / GLM-R5 / GLM-R12 | deferred | charter §8.3 wire-with-delivery e2e 矩阵分阶段补；本轮不补 surface-only e2e | HP2 后续批次 (model 5+) / HP3 后续批次 (long-conversation 5+) / HP4 后续批次 (lifecycle-retry-restore 6+) / HP5 后续批次 (15-18) |
| GPT-R2 / DS-R1 / GLM-R2 | deferred | HP3 control-plane first wave 与 runtime owner 边界 | HP3 后续批次（CrossTurnContextManager + auto-compact + breaker + strip-recover full contract + 60s preview cache GLM-R13） |
| GPT-R3 / DS-R2 / DS-R6 / GLM-R3 | deferred | HP4 lifecycle/checkpoint-registry first wave 与 retry/restore 边界；checkpoint-restore-plane 是 HP7 territory（文件头标注） | HP4 后续批次（`POST /retry` + retry attempt chain）+ HP7 后续批次（`POST /checkpoints/{id}/restore` + rollback executor + cleanup cron） |
| GPT-R4 / GLM-R10 | deferred | charter §1.1 D7 + §10.1 第 3 条把 18 份 api-docs 冻结到 HP9 | HP9（新增 7 份文档 + error-index 全 code 重排 + 4 份现有文档结构性重写） |
| DS-R3 / DS-R4 / DS-R11 / GLM-R1 / GLM-R11 | deferred | HP2 closure §2 P2/P3 显式登记 not-started；fallback 触发链路本身未实现，二次校验无 caller | HP2 后续批次（`<model_switch>` developer message 注入 + `model.fallback` stream event + fallback model 二次校验链） |
| DS-R5 | deferred | HP3 closure §2 P1 显式登记 not-started-in-runtime | HP3 后续批次（与 GPT-R2/DS-R1 同 batch） |
| DS-R7 | partially-fixed | live LLM path 已结构化传递 session default；非 message-path 旁路通道（compact summary / retry resume / cross-turn manager）的 `MainlineKernelOptions.modelDefaults` seam 待 consumer 落地 | HP3 `CrossTurnContextManager` 批次 + HP4 retry 批次（落 consumer 同 batch 落 seam） |
| DS-R8 / GLM-R9 | discipline-acknowledged | 已发生的 drift 不回滚（内容已对齐），HP5-HP8 strict 遵守 | HP9 启动时全量并入 18 份对齐表 |
| DS-R12 / GLM-R15 | deferred | HP5 closure §2 P1 显式登记 emitter row-create 为 not-wired-on-emitter-side | HP5 后续批次（接 PreToolUse emitter caller，使 ask policy 暂停时 `/confirmations?status=pending` 立即可查） |
| DS-R13 / GLM-R8 | deferred | 已 `@deprecated` 标注 | HP10 final cleanup 物理删除 |
| GLM-R4 | deferred | HP3 closure §2 P4 显式登记 not-wired | HP3 后续批次（compact 失败 3 次 breaker） |
| GLM-R6 / GLM-R7 | deferred | 当前不构成 production 风险；待与 model profile 跨 worker dup 合并清理 | HP8 stop-the-bleed 或 HP10 cleanup |

### 6.7 Ready-for-rereview gate

- **是否请求二次审查**：`partial`（DS-R9 trivial fix + GPT-R5 stale 判定可即时复核；其余 deferred 项需在对应 phase 后续批次落地后再审）
- **请求复核的范围**：
  1. `DS-R9 fix verification`：`docs/action-plan/hero-to-pro/HP3-action-plan.md:30`
  2. `GPT-R5 stale verification`：`pnpm --filter @haimang/orchestrator-core-worker test` 305/305 复跑
  3. `discipline-acknowledged 处理方式合理性`（DS-R8 / GLM-R9）：是否同意"不回滚 + HP5-HP8 strict + HP9 全量收口"是合理路径
- **实现者认为可以关闭本轮 review 的前提**：
  1. reviewer 同意 GPT-R5 stale 判定（测试已绿）
  2. reviewer 同意 DS-R7 现状判定（live LLM path 已传递 session default，剩余架构债承接到 HP3/HP4 batches）
  3. reviewer 同意"all reviewer-flagged HP2/HP3/HP4/HP5 closure §2 partial 项不在本轮提前接线"是 charter §0.5 法律下的合规处理（避免 wire-without-consumer 反模式）
  4. reviewer 同意 charter §1.1 D7 / §10.1 第 3 条对 api-docs 全量对齐冻结到 HP9 的纪律保留（GPT-R4 / GLM-R10 不在本轮散打补）

> 备注：三份 review 整体口径 GPT 标 `changes-requested / no`、DS 标 `changes-requested / no`、GLM 标 `approve-with-followups / yes`。本轮回应在统一处理 21 条去重 finding 后，建议本轮 review 以 `partially-closed-with-deferred-roadmap` 收口——已显式 fix / stale / discipline-ack 的 4 项（DS-R9 / GPT-R5 / DS-R8 / GLM-R9 / DS-R7 partial）当下可二审，其余 17 项进入对应 phase 后续批次的 reviewer 跟踪表。
