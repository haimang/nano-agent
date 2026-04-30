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
