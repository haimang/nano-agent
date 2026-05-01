# Nano-Agent 代码审查

> 审查对象: `hero-to-pro / HP6-HP8 + current broader hero-to-pro handoff`
> 审查类型: `mixed`
> 审查时间: `2026-04-30`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/charter/plan-hero-to-pro.md`
> - `docs/action-plan/hero-to-pro/HP6-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP7-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP8-action-plan.md`
> - `docs/issue/hero-to-pro/HP6-closure.md`
> - `docs/issue/hero-to-pro/HP7-closure.md`
> - `docs/issue/hero-to-pro/HP8-closure.md`
> - `workers/orchestrator-core/**`
> - `workers/agent-core/**`
> - `workers/filesystem-core/**`
> - `workers/bash-core/**`
> - `packages/nacp-core/**`
> - `packages/nacp-session/**`
> - `scripts/**`
> - `clients/api-docs/**`
> - `test/cross-e2e/**`
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md`
> - `docs/action-plan/hero-to-pro/HP6-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP7-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP8-action-plan.md`
> - `docs/issue/hero-to-pro/HP6-closure.md`
> - `docs/issue/hero-to-pro/HP7-closure.md`
> - `docs/issue/hero-to-pro/HP8-closure.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`HP6~HP8 的 first-wave 主体大体成立，但三阶段都仍停在 partial-live，当前代码事实不支持把它们表述成“已完成原 action-plan 全量预定工作”；与此同时，clients/api-docs 对 broader hero-to-pro 的 live surface 仍有明显漂移。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `HP6 已落的是 todo truth / workspace path law / tool.call.cancelled 协议层，不是完整的 tool/workspace 产品状态机；workspace CRUD、tool-calls、promotion、cleanup、LLM capability 仍未闭环。`
  2. `HP7 已落的是 snapshot / restore-job / diff / fork-lineage substrate，不是完整的 restore/fork 系统；restore executor、public route、TTL cleanup 与 e2e 仍未完成。`
  3. `HP8 已落的是 root drift gate、tool catalog SSoT 与 Lane E final-state；R28/R29 explicit register、R29 verifier、heartbeat 4-scenario 仍未完成，所以 HP8 自己定义的 freeze gate 也还不能通过。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-hero-to-pro.md`
  - `docs/action-plan/hero-to-pro/HP6-action-plan.md`
  - `docs/action-plan/hero-to-pro/HP7-action-plan.md`
  - `docs/action-plan/hero-to-pro/HP8-action-plan.md`
  - `docs/issue/hero-to-pro/HP6-closure.md`
  - `docs/issue/hero-to-pro/HP7-closure.md`
  - `docs/issue/hero-to-pro/HP8-closure.md`
  - `docs/templates/code-review.md`
- **核查实现**：
  - `workers/orchestrator-core/src/{index.ts,workspace-control-plane.ts,checkpoint-restore-plane.ts}`
  - `workers/agent-core/src/{host/runtime-mainline.ts,host/workspace-runtime.ts,eval/inspector.ts}`
  - `workers/filesystem-core/src/index.ts`
  - `workers/bash-core/src/tool-call.ts`
  - `packages/nacp-core/src/{messages/tool.ts,tools/tool-catalog.ts,index.ts}`
  - `packages/nacp-session/src/{messages.ts,stream-event.ts,session-registry.ts,type-direction-matrix.ts}`
  - `clients/api-docs/{README,session,permissions,session-ws-v1,error-index}.md`
  - `docs/architecture/lane-e-final-state.md`
  - `test/cross-e2e/**`
- **执行过的验证**：
  - `glob test/cross-e2e/**/*.test.mjs`
  - `pnpm --filter @haimang/nacp-session test`
  - `pnpm --filter @haimang/nacp-core test`
  - `pnpm --filter @haimang/orchestrator-core-worker test`
  - `pnpm --filter @haimang/agent-core-worker test`
  - `pnpm --filter @haimang/bash-core-worker test`
  - `pnpm --filter @haimang/filesystem-core-worker test`
  - `pnpm run check:megafile-budget`
  - `pnpm run check:tool-drift`
  - `pnpm run check:envelope-drift`
- **复用 / 对照的既有审查**：
  - `none` — `本文件只基于当前 repo 的 charter / action-plan / closure / 代码 / tests / clients/api-docs 一手事实，不采纳其他 reviewer 结论。`

### 1.1 已确认的正面事实

- `HP6` 的 first-wave 不是空转：`workers/orchestrator-core/src/index.ts:1076-1100,1562-1779` 已有 `/sessions/{id}/todos` CRUD；`packages/nacp-session/src/messages.ts:348-471` 与 `session-registry.ts:38-83,139-162` 已注册 `session.todos.write/update`；`workers/orchestrator-core/src/workspace-control-plane.ts:63-119,178-185,187-260` 已冻结 `normalizeVirtualPath()` 与 `buildWorkspaceR2Key()`，并落下 `D1WorkspaceControlPlane`。
- `HP6/HP7` 的事件与协议增量已真实进入 package truth：`packages/nacp-session/src/stream-event.ts:36-68,148-157` 已注册 `tool.call.cancelled` 与 `session.fork.created`；`workers/agent-core/src/eval/inspector.ts:18-38` 已同步 12-kind catalog。
- `HP7` 的 substrate 确实已落：`workers/orchestrator-core/src/checkpoint-restore-plane.ts:36-70,162-203,218-280,376-531` 已有 snapshot status / restore mode / restore status 的 durable helper、R2 key law 与 restore job truth；`workers/orchestrator-core/src/index.ts:1136-1157` 已 live checkpoint list/create/diff parser。
- `HP8` 的 first-wave 也不是空写文档：`package.json:17-19` 已把三类 root gate 接入；`packages/nacp-core/src/tools/tool-catalog.ts:28-80` 与 `packages/nacp-core/src/index.ts:312-314` 已暴露 `TOOL_CATALOG` / `TOOL_CATALOG_IDS` / `findToolEntry`；`docs/architecture/lane-e-final-state.md:12-17,48-77` 已把 Lane E 冻结为 `retained-with-reason`。
- 当前相关包的 **unit / integration baseline 是绿的**：本轮 `nacp-session`、`nacp-core`、`orchestrator-core-worker`、`agent-core-worker`、`bash-core-worker`、`filesystem-core-worker` 测试以及三类 root drift checks 都通过。

### 1.2 已确认的负面事实

- `HP6~HP8` 都还没通过 charter 的 wire-with-delivery gate：`docs/charter/plan-hero-to-pro.md:337-339,762-769,816-823,871-879` 要求 `端点 + e2e + closure`；但当前 `test/cross-e2e/` 目录只有 15 个既有文件，没有 HP6 todo/workspace/tool-cancel/promote/cleanup、HP7 restore/fork/ttl、HP8 heartbeat 4-scenario 的 targeted e2e。
- `HP6` 仍缺产品闭环主线：`workers/orchestrator-core/src/index.ts` 只有 `todos` 与 `checkpoints` parser；仓内搜索 `workspace/files|tool-calls|artifacts/promote` 在 façade 路由上无 live 命中；`workers/filesystem-core/src/index.ts:83-115` 仍只有 `readArtifact/writeArtifact/listArtifacts` 三件套；`rg "WriteTodos|ReadTempFile|WriteTempFile|ListTempFiles" workers/agent-core/src` 当前无实现命中。
- `HP7` 仍缺 restore/fork 真执行面：`workers/orchestrator-core/src/index.ts:1136-1157` 的 checkpoint route 只支持 list/create/diff，没有 `/restore` / `/fork`；HP7 closure 也明确把 executor / public route / TTL cron 标成 `not-yet`。
- `HP8` 仍缺 chronic register 与 heartbeat 主体：`rg "verify-initial-context-divergence" /workspace/repo/nano-agent` 当前只有 charter/action-plan/design/closure 文档提及，没有真实脚本文件；`docs/issue/hero-to-pro/HP8-closure.md:46-52,101-115` 也明确把 R28 / R29 / heartbeat 4-scenario 标成 `not-started` / `not-run`。
- `clients/api-docs` 当前仍不是 broader hero-to-pro 的完整对外真相：`clients/api-docs/README.md:84-123` 与 `session.md:7-42` 没有 `/sessions/{id}/todos` 或 `/sessions/{id}/confirmations`；`permissions.md:14-18,22-28,177-186` 仍写“HTTP 替代是唯一 live API / runtime 不等待”；`session-ws-v1.md:48-62` 缺 `tool.call.cancelled` 与 `session.fork.created`；`error-index.md:75-105` 缺 `confirmation-already-resolved`。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 直接核查了 charter、HP6-HP8 action-plan、closure、实现代码、scripts、clients/api-docs 与 lane-E 文档。 |
| 本地命令 / 测试 | `yes` | 重新执行了 6 个相关包测试和 3 个 root drift checks，并检查了 `test/cross-e2e` 实际文件集。 |
| schema / contract 反向校验 | `yes` | 反查了 `session.todos.*`、`tool.call.cancelled`、`session.fork.created`、tool catalog、route parser 与 clients/api-docs 的对应关系。 |
| live / deploy / preview 证据 | `no` | 本轮不依赖 preview/live 环境，只用当前仓库代码与本地测试。 |
| 与上游 design / QNA 对账 | `yes` | 以 charter / action-plan / closure 的冻结 in-scope 和收口标准判断“done / partial / missing / stale”。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | HP6~HP8 仍未通过 charter 的 wire-with-delivery gate | `high` | `delivery-gap` | `yes` | 先补齐 targeted cross-e2e 并跑绿，再讨论 phase close |
| R2 | HP6 仍只有 todo/path/schema first wave，未形成完整 tool/workspace 状态机 | `high` | `delivery-gap` | `yes` | 完成 workspace CRUD、tool-calls、promotion、cleanup 与 LLM/file capability 接线 |
| R3 | HP7 仍只有 restore substrate，未形成完整 restore/fork 产品系统 | `high` | `delivery-gap` | `yes` | 完成 restore/fork executor、public route、TTL cleanup 与 rollback e2e |
| R4 | HP8 仍只有 root gate / catalog / lane-E first wave，chronic register 与 heartbeat posture 未收口 | `high` | `delivery-gap` | `yes` | 完成 R28/R29 explicit register、R29 verifier、heartbeat 4-scenario 后再评 HP8 close |
| R5 | `clients/api-docs` 仍落后于当前 live 的 broader hero-to-pro surface | `medium` | `docs-gap` | `no` | 补齐 todos / confirmations / WS event / error code 文档，并重写 stale permissions 口径 |

### R1. HP6~HP8 仍未通过 charter 的 wire-with-delivery gate

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-hero-to-pro.md:337-339` 把 HP6 / HP7 / HP8 的阶段交付写成 `端点 + e2e + closure`。
  - `docs/charter/plan-hero-to-pro.md:762-769,816-823,871-879` 明确把 HP6 cleanup/CRUD、HP7 restore/fork/ttl、HP8 heartbeat/runtime-hardening 的 e2e 列进收口标准。
  - `docs/issue/hero-to-pro/HP6-closure.md:27-28,58-60,128-137`、`HP7-closure.md:31-32,64-66,134-142`、`HP8-closure.md:23,48-52,145-153` 都明确登记 cross-e2e 未运行或未落。
  - 当前 `test/cross-e2e/` 实际只有 15 个既有文件，且仓内搜索 `todos|workspace|promote|restore|fork|heartbeat|confirmation` 在 `test/cross-e2e/**/*.test.mjs` 中无任何命中。
- **为什么重要**：
  - 这不是“建议再补点测试”，而是 charter 自己设的阶段硬闸。硬闸未过，就不能把 phase 说成 full-live 或 completed。
  - HP6~HP8 都是跨 worker / D1 / R2 / WS / route 的拼装 phase，没有 targeted e2e 时最容易出现“helper 成立、产品面未闭环”的误判。
- **审查判断**：
  - 三份 closure 当前把自己写成 `partial-live` 是诚实的。
  - 不诚实的部分，是任何把 HP6~HP8 整体描述成“预定工作已完成”的说法。
- **建议修法**：
  - HP6：补 `todos roundtrip / workspace temp readback / tool cancel / promote / cleanup audit / traversal deny`。
  - HP7：补 `three-mode restore / rollback / fork isolation / checkpoint ttl`。
  - HP8：补 `heartbeat normal / heartbeat lost / reconnect-resume / deferred sweep 共存` 四场景。

### R2. HP6 仍只有 todo/path/schema first wave，未形成完整 tool/workspace 状态机

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-hero-to-pro.md:738-743` 与 `docs/action-plan/hero-to-pro/HP6-action-plan.md:158-163,216-234` 把 todo、workspace temp file CRUD、tool-calls list/cancel、promotion、cleanup 都列入 HP6 in-scope。
  - `workers/orchestrator-core/src/index.ts:1076-1100,1562-1779` 目前只有 `/sessions/{id}/todos`；`parseSessionCheckpointRoute()` 之外没有 workspace / tool-calls / promote parser。
  - `workers/filesystem-core/src/index.ts:83-115` 目前 RPC 仍只有 `readArtifact` / `writeArtifact` / `listArtifacts`。
  - 仓内搜索 `WriteTodos|ReadTempFile|WriteTempFile|ListTempFiles` 在 `workers/agent-core/src` 无实现命中。
  - `docs/issue/hero-to-pro/HP6-closure.md:16-27,50-60` 也明确把 workspace public CRUD、filesystem-core leaf RPC、tool-calls route、promotion、cleanup、WriteTodos capability 标为 `not-yet` 或 `not-wired`。
- **为什么重要**：
  - HP6 的目标不是“补一个 todo 面 + 冻结路径规则”，而是把 tool/workspace 变成完整产品状态机。
  - 当前缺口恰好都在用户面与执行面：没有 public workspace、没有 tool-calls read model/cancel route、没有 promotion、没有 cleanup、没有 LLM/file capability。
- **审查判断**：
  - HP6 first-wave 代码是可信的：todo truth、virtual_path law、D1WorkspaceControlPlane、`tool.call.cancelled` 这些都真落了。
  - 但它离 HP6 charter 的“完整状态机”还有明显距离，不能关闭本轮 review。
- **建议修法**：
  - 先补 filesystem-core temp-file RPC 与 façade workspace CRUD。
  - 再补 `/sessions/{id}/tool-calls` + cancel route 与 promotion / provenance / cleanup job audit。
  - 最后把 `WriteTodos` 与 temp-file capabilities 真接到 agent-core，再用 targeted e2e 收口。

### R3. HP7 仍只有 restore substrate，未形成完整 restore/fork 产品系统

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-hero-to-pro.md:792-797` 与 `docs/action-plan/hero-to-pro/HP7-action-plan.md:157-162,215-233` 把 restore 三模式、confirmation gate、rollback baseline、fork、TTL cleanup 与 e2e 都列为 HP7 in-scope。
  - `workers/orchestrator-core/src/checkpoint-restore-plane.ts:162-203,376-531` 的确已提供 R2 key law 与 restore-job helper，但 `workers/orchestrator-core/src/index.ts:1136-1157` 的 public checkpoint route 仍只支持 list/create/diff，没有 `/restore` / `/fork`。
  - `workers/filesystem-core/src/index.ts:83-115` 也还没有 HP7 计划要求的 snapshot / restore / copy-to-fork 类 RPC。
  - `docs/issue/hero-to-pro/HP7-closure.md:16-31,56-66` 明确把 restore executor、fork executor、TTL cleanup、public route 与 cross-e2e 标成 `not-yet` / `not-run`。
- **为什么重要**：
  - HP7 的真正难点不是 schema/helper，而是 restore/fork 这种会修改 conversation 与 files truth 的 destructive product operation。
  - 没有 executor、public route、TTL cleanup 与 rollback e2e，当前用户其实还拿不到 HP7 宣称的核心能力。
- **审查判断**：
  - HP7 first-wave substrate 是有效的，且为后续 executor 提供了不错的真相层。
  - 但现在只能说“helper / registry 已落”，不能说“checkpoint/revert/fork 产品系统已完成”。
- **建议修法**：
  - 补 `POST /sessions/{id}/checkpoints/{checkpoint_uuid}/restore` 与 `POST /sessions/{id}/fork`。
  - 真接 `conversation_only / files_only / conversation_and_files / fork` 四模式 executor、rollback baseline 与 TTL cleanup。
  - 用 restore/fork/ttl 的 targeted e2e 再做二次复审。

### R4. HP8 仍只有 root gate / catalog / lane-E first wave，chronic register 与 heartbeat posture 未收口

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-hero-to-pro.md:846-852,871-879` 把 R28、R29、DO heartbeat alarm 化、Lane E、megafile gate、tool catalog、envelope verify 一起列为 HP8 收口标准。
  - `package.json:17-19`、`scripts/check-megafile-budget.mjs`、`scripts/check-tool-drift.mjs`、`scripts/check-envelope-drift.mjs` 与 `packages/nacp-core/src/tools/tool-catalog.ts:52-80` 证明 HP8 first-wave gate/canonical catalog 已 live。
  - 但 `rg "verify-initial-context-divergence" /workspace/repo/nano-agent` 只有文档命中，没有真实脚本文件；`docs/issue/hero-to-pro/HP8-closure.md:46-52` 也明确把 R28、R29、heartbeat posture 与 4-scenario e2e 标成未完成。
  - `docs/issue/hero-to-pro/HP8-closure.md:92-115` 已直接给出 **HP9 freeze gate: NOT GRANTED**。
- **为什么重要**：
  - HP8 的职责不是只做“脚本闸门”和“Lane E 文字定性”，而是把 chronic issue 与 runtime posture 从口头共识变成 explicit register。
  - 只完成 gate/catalog/Lane E，还不足以说明 HP8 自己的目标已完成；否则 HP9 的 freeze gate 就会建立在未稳定的 chronic truth 上。
- **审查判断**：
  - HP8 first-wave 的 repo governance 收紧是成立的，且实际 root checks 已通过。
  - 但 HP8 还远不到可以关闭 review 的程度；closure 把它写成 `partial-live` 是正确的。
- **建议修法**：
  - 补 `scripts/verify-initial-context-divergence.mjs` 与 `R29-postmortem.md` 三选一判定。
  - 补 R28 explicit register 与 heartbeat 4-scenario cross-e2e。
  - 完成这些后，再重新评估 HP9 freeze gate。

### R5. `clients/api-docs` 仍落后于当前 live 的 broader hero-to-pro surface

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:1076-1100,1562-1779` 已 live `/sessions/{id}/todos` CRUD；`workers/orchestrator-core/src/index.ts:1103-1133,1404-1536` 已 live `/sessions/{id}/confirmations` list/detail/decision。
  - `packages/nacp-session/src/stream-event.ts:36-68,148-157` 已 live `tool.call.cancelled` 与 `session.fork.created`。
  - `clients/api-docs/README.md:84-123` 与 `session.md:7-42` 当前都没有 `/todos` 与 `/confirmations`。
  - `clients/api-docs/permissions.md:14-18,22-28,177-186` 仍声称 “HTTP 路径是唯一可用的 permission / elicitation API”，且继续描述 KV-first、runtime 不等待的 RHX2 语义。
  - `clients/api-docs/session-ws-v1.md:48-62` 缺少 `tool.call.cancelled` 与 `session.fork.created`；`clients/api-docs/error-index.md:75-105` 缺 `confirmation-already-resolved`。
- **为什么重要**：
  - 这会直接误导客户端、QA 和后续 reviewer：当前 docs 并没有准确区分 legacy compat surface 与已经 live 的 generic confirmation/todo/event plane。
  - 这类漂移在 HP9 之前可以理解，但不能被说成 “current docs 已正确、完整、error free”。
- **审查判断**：
  - 当前 `clients/api-docs` 只能算 RHX2 + HP3/HP4/部分 HP8 的混合快照，不能算 broader hero-to-pro 的完整客户端真相。
  - 这不是 HP6~HP8 代码 correctness blocker，但它是明确存在的阶段文档断点。
- **建议修法**：
  - 在 `README.md` / `session.md` 中补入 `/todos` 与 `/confirmations`。
  - 在 `permissions.md` 中把旧 HTTP 路径改写为 legacy compat appendix，而不是“唯一 live API”。
  - 在 `session-ws-v1.md` / `error-index.md` 中补 `tool.call.cancelled`、`session.fork.created` 与 `confirmation-already-resolved`。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | HP6：todo durable truth + `/sessions/{id}/todos` CRUD + `session.todos.*` | `done` | route、D1 helper、协议注册都已存在。 |
| S2 | HP6：workspace path normalization + temp-file D1 truth | `done` | `normalizeVirtualPath()`、`buildWorkspaceR2Key()`、`D1WorkspaceControlPlane` 已落。 |
| S3 | HP6：workspace CRUD / tool-calls / promote / cleanup / LLM-file capability 完整状态机 | `partial` | 目前只有 todo/path/schema/event truth，用户面与执行面主体未接完。 |
| S4 | HP6：6+ targeted cross-e2e | `missing` | 当前 `test/cross-e2e/` 没有对应文件。 |
| S5 | HP7：snapshot plane + restore job truth + diff projector + fork event | `done` | helper / enum / R2 key law / fork event 都在。 |
| S6 | HP7：restore/fork executor + public route + TTL cleanup | `partial` | 当前只有 substrate，没有完整执行面。 |
| S7 | HP7：restore/fork/ttl targeted cross-e2e | `missing` | 当前目录没有对应测试。 |
| S8 | HP8：megafile/tool/envelope root gate + tool catalog SSoT + Lane E final-state | `done` | root checks live 且 clean，Lane E 文档已冻结。 |
| S9 | HP8：R28/R29 explicit register + R29 verifier + heartbeat 4-scenario | `partial` | closure 已承认这些仍未完成。 |
| S10 | broader hero-to-pro：clients/api-docs 完整匹配当前 live surface | `stale` | todo / confirmations / WS events / error code 仍有漂移。 |

### 3.1 对齐结论

- **done**: `4`
- **partial**: `3`
- **missing**: `2`
- **stale**: `1`
- **out-of-scope-by-design**: `0`

这更像是 **“HP6~HP8 的真相层和治理层先落了第一波骨架，但真正决定用户可交付性的 transport / executor / e2e / chronic register 还没收口”**，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | HP6 不做 patch/diff/read-before-write 编辑器 | `遵守` | 当前实现没有越界去做 editor/diff 模式；缺的是已 in-scope 的 CRUD/capability，不是越界。 |
| O2 | HP7 不做 cross-conversation fork / export-import | `遵守` | 当前缺的是同 conversation fork 和 restore executor；没有把 out-of-scope 当成 blocker。 |
| O3 | HP8 不负责 `clients/api-docs` 重写、manual evidence、prod schema baseline | `遵守` | 这些仍应留给 HP9；本轮只把 docs drift 记为 broader follow-up，不把 HP9 任务误算成 HP8 blocker。 |
| O4 | R28 / R29 必须在 HP8 完全根治 | `误报风险` | Q28 允许 `retained-with-reason` / `handed-to-platform`；本轮 blocker 不是“必须根治”，而是“必须 explicit，不允许 silent unresolved”。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `完成 HP6 的 workspace/tool-calls/promotion/cleanup/LLM capability 主线，并补齐 HP6 targeted cross-e2e。`
  2. `完成 HP7 的 restore/fork executor、public route、TTL cleanup 与 targeted cross-e2e。`
  3. `完成 HP8 的 R28/R29 explicit register、R29 verifier、heartbeat 4-scenario 证据，再重新评估 HP8 close / HP9 freeze gate。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `把 clients/api-docs 补齐到当前 live truth：至少覆盖 todos、confirmations、tool.call.cancelled、session.fork.created、confirmation-already-resolved，以及 stale permissions 说明。`
  2. `等 targeted cross-e2e 补齐后，再做一次 same reviewer rereview，确认 helper truth 确实已变成 public delivery truth。`
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应

> 本节是对 GPT-5.4 / Deepseek 两份 HP6-HP8 review 的整体合并回应。回应按各 reviewer 的编号（GPT-R*、DS-N*）逐项对齐，不模糊归纳；不修改 §0-§5 reviewer 内容。

### 6.1 对本轮审查的回应

> 执行者: `claude-opus-4-7 (1M context)`
> 执行时间: `2026-05-01`
> 回应范围: `GPT-R1..R5 + DS-N1..N12`
> 对应审查文件:
> - `docs/code-review/hero-to-pro/HP6-HP8-reviewed-by-GPT.md`
> - `docs/code-review/hero-to-pro/HP6-HP8-full-review-by-deepseek.md`

- **总体回应**：两份 review 共 17 条 finding，去重后实质问题 14 条；其中 1 条已通过本轮 trivial fix 修复（DS-N9：HP6/HP7/HP8 action-plan `draft` → `executed`），1 条 reviewer 事实判断错误（DS-N12：`tool.cancelled` vs `tool.call.cancelled` 命名不一致——实查全仓零 `tool.cancelled` literal，全部为 `tool.call.cancelled`，命名是一致的），其余 12 条均为 HP6/HP7/HP8 closure §2 已显式登记的 partial / not-started / not-wired 项，且每条都有明确的承接 phase 与 unlock condition——本轮不在 charter §0.5 法律下的"first wave + 后续批次承接"边界外做提前接线（避免 wire-without-consumer 反模式）。
- **本轮修改策略**：
  1. **有效且当下可独立修复的**：HP6/HP7/HP8 action-plan 状态标签修正（DS-N9）。
  2. **stale-rejected**：DS-N12 命名不一致（reviewer 事实判断错误，全仓只有 `tool.call.cancelled`，零 `tool.cancelled` literal）。
  3. **deferred-with-rationale**：HP6/HP7/HP8 closure §2 已显式登记的全部 partial/not-started/not-wired 项 — 包括 R28/R29 register、verify-initial-context-divergence.mjs、R29-postmortem.md、heartbeat 4-scenario e2e、filesystem-core temp-file RPC、workspace public CRUD、tool-calls list/cancel 路由、artifact promotion、cleanup cron、agent-core WriteTodos/temp-file capability、restore/fork executor、public restore/fork 路由、TTL cleanup cron、agent-core/bash-core consumer migration to nacp-core tool catalog。
  4. **scope-drift / 系统性观察**：DS-N11（全 8 phase `partial-live`）— 这是 reviewer 元判断；与 HP8 closure §5 `HP9 freeze gate: NOT GRANTED` 的诚实判定一致，是 charter §0.5 法律下"control-plane first wave + runtime owner / executor 后续批次承接"的结构性结果，不是 deceptive closure。HP9/HP10 是承接 32 项 second-wave 债务的 charter-defined 时点，不是 HP8 自身要修的 bug。
  5. **HP9 territory**：clients/api-docs 漂移（GPT-R5）— charter §1.1 D7 + §10.1 第 3 条把 18 份文档全量对齐冻结到 HP9；HP6/HP7/HP8 closure §0 已严格遵守 `not-touched`（与 HP2-HP4 散落更新形成对比，纪律已恢复）。本轮不在 HP6-HP8 散打补，避免再踩 D7 红线。
- **实现者自评状态**：`partially-closed`（trivial fix 已落 + stale-rejected 已确认；其余 deferred 项的承接位置全部在对应 closure §2 与 charter §10 中显式标注，等待对应 phase 后续批次或 HP9/HP10 收口）

### 6.2 逐项回应表

#### 6.2.1 GPT review

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| GPT-R1 | HP6~HP8 仍未通过 charter wire-with-delivery gate（cross-e2e 缺失） | `deferred-with-rationale` | 与 DS-N10 同源。HP6/HP7/HP8 closure §6/§7 已显式登记 cross-e2e 为 not-run；charter §8.3 wire-with-delivery 在每 phase 后续批次（HP6 6+ scenarios / HP7 6+ scenarios / HP8 4-scenario heartbeat）补齐。本轮不补 surface-only e2e（在缺 filesystem-core temp-file RPC、restore executor、heartbeat 4-scenario 的 substrate 状态下，e2e 反而会变成 false-positive）。 | — |
| GPT-R2 | HP6 仍只有 todo/path/schema first wave，未形成完整 tool/workspace 状态机 | `deferred-with-rationale` | 与 DS-N7+N8 同源。HP6 closure §2 已显式登记：filesystem-core temp-file RPC（P1 not-yet）、workspace public CRUD（P2 not-wired-on-route-side）、tool-calls list/cancel 路由（P3 not-wired-on-route-side）、artifact promote/provenance（P4 not-wired）、cleanup jobs cron（P5 not-wired）、agent-core WriteTodos capability（P7 not-wired）。承接位置：HP6 后续批次（with substrate-then-route-then-capability 序列）。 | — |
| GPT-R3 | HP7 仍只有 restore substrate，未形成完整 restore/fork 产品系统 | `deferred-with-rationale` | 与 DS-N6 同源。HP7 closure §2 已显式登记：restore executor + fork executor（P1-P3/P4 not-wired）、public restore/fork 路由（P6 not-wired）、TTL cleanup cron（P5 not-wired）。HP7 first wave（snapshot lineage + restore job truth + diff projector + fork event + R2 key law）作为 substrate 已 done，executor / public route 是 HP7 后续批次工作。 | — |
| GPT-R4 | HP8 仍只有 root gate / catalog / lane-E first wave，chronic register 与 heartbeat posture 未收口 | `deferred-with-rationale` | 与 DS-N1+N2+N3 同源。HP8 closure §2 已显式登记：R28 explicit register（P1 not-started）、R29 verifier + postmortem（P2 not-started）、heartbeat 4-scenario cross-e2e（P4 not-run）、agent-core/bash-core consumer migration（P5/P6 not-wired）。HP8 closure §5 已诚实给出 `HP9 freeze gate: NOT GRANTED`，并列出 4 条 unlock condition。承接位置：HP8 后续批次或 HP10 final closure 时（按 reviewer 自身建议）以 `closed / retained-with-reason / handed-to-platform` 三选一终态登记。 | — |
| GPT-R5 | clients/api-docs 仍落后于当前 live broader hero-to-pro surface | `deferred-with-rationale` | charter §1.1 D7 + §10.1 第 3 条把 18 份 api-docs 全量对齐冻结到 HP9 一次性集中收口；HP6/HP7/HP8 closure §0 已遵守 `not-touched`（与 HP2-HP4 散落更新违反 D7 形成对比，纪律已恢复）。HP9 启动时以 HP8 freeze 为基线，新增 7 份文档（`models.md` / `context.md` / `checkpoints.md` / `confirmations.md` / `todos.md` / `workspace.md` / `transport-profiles.md`）+ `error-index.md` 全 code 重排 + `permissions.md` legacy compat 改写 + `session-ws-v1.md` `tool.call.cancelled` / `session.fork.created` 补齐。 | — |

#### 6.2.2 Deepseek review

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| DS-N1 | `verify-initial-context-divergence.mjs` 不存在 — R29 验证入口缺失 | `deferred-with-rationale` | HP8 closure §2 P2 已显式登记 `not-started`；HP8 closure §5 unlock condition 第 2 条要求 R29 register 进入终态。承接位置：HP8 后续批次（脚本骨架 + session history dump + diff baseline）；如 owner 选择 `handed-to-platform`，HP10 final closure 接收。本轮不创建空骨架脚本以避免 wire-without-evidence 反模式。 | — |
| DS-N2 | `R29-postmortem.md` 不存在 — F15 chronic 未兑现 | `deferred-with-rationale` | HP8 closure §2 P2 已显式登记 `not-started`；charter §10.3 NOT-成功退出条件之一。承接位置：HP8 后续批次完成 postmortem 三选一判定（zero-diff / has-diff / unverifiable），或显式以 Q28 4 字段登记为 `handed-to-platform` 由 HP10 final closure 接收。本轮不写空 postmortem 文件（Q28 禁止 silent unresolved 也禁止 deceptive closure）。 | — |
| DS-N3 | R28/R29 均无 explicit closure register（Q28 4 字段不全） | `deferred-with-rationale` | 与 DS-N1+N2 / GPT-R4 同源。HP8 closure §2 P1/P2 + §5 unlock condition 已显式登记。承接位置：HP8 后续批次或 HP10 final closure。Q28 4 字段（scope / risk / remove condition / owner）回填将在 register 进入终态时一并完成。 | — |
| DS-N4 | agent-core/bash-core 未消费 nacp-core tool catalog | `deferred-with-rationale` | HP8 closure §2 P5/P6 已显式登记 `not-wired`；当前 `check:tool-drift.mjs` 已 enforced ssoT，drift guard 在 catalog 出现重复 literal 时会 fail。承接位置：HP8 后续批次 consumer migration（agent-core / bash-core 改用 `findToolEntry()` 直读 SSoT）。本轮不动 consumer，避免在缺 cross-e2e 保护下打散 LLM tool wiring。 | — |
| DS-N5 | `compactRequired` 硬编码 false — HP8 未修复 | `deferred-with-rationale` | reviewer 自身正确归类 `not-blocker / 归 HP3`。同 HP2-HP4 review DS-R1。`workers/agent-core/src/host/orchestration.ts:296,429` 仍硬编码 `false`，HP3 closure §2 P2 已显式登记 `not-wired`。承接位置：HP3 后续批次（与 CrossTurnContextManager 同 batch）。 | — |
| DS-N6 | checkpoint-restore-plane 无 HTTP 路由 | `deferred-with-rationale` | reviewer 自身正确归类 `not-blocker / 归 HP7`。HP7 closure §2 P6 已显式登记 `not-wired`。承接位置：HP7 后续批次（restore + fork executor + public route + TTL cron 同 batch）。 | — |
| DS-N7 | filesystem-core temp-file RPC 未实现 | `deferred-with-rationale` | reviewer 自身正确归类 `not-blocker / 归 HP6`。HP6 closure §2 P1 已显式登记 `not-yet`；Lane E final-state §3 remove condition 第 1 条要求 `readTempFile / writeTempFile / listTempFiles / deleteTempFile / readSnapshot / writeSnapshot / copyToFork / cleanup` 完整暴露作为 Lane E 升级为 `closed` 的前置条件。承接位置：HP6 后续批次。 | — |
| DS-N8 | workspace/tool-calls HTTP 面缺失 | `deferred-with-rationale` | reviewer 自身正确归类 `not-blocker / 归 HP6`。同 GPT-R2。HP6 closure §2 P2/P3 已显式登记 `not-wired-on-route-side`。 | — |
| DS-N9 | HP6/HP7/HP8 action-plan 文档状态标注 `draft` 与实际不符 | `fixed` | 已将三份 action-plan 的 `文档状态: draft` 改为 `文档状态: executed`，与 HP2/HP3（HP3 已在前一轮 review 修复）一致。 | `docs/action-plan/hero-to-pro/HP6-action-plan.md:29`, `docs/action-plan/hero-to-pro/HP7-action-plan.md:29`, `docs/action-plan/hero-to-pro/HP8-action-plan.md:39` |
| DS-N10 | 全部 cross-e2e 未执行（HP2-HP8 累计） | `deferred-with-rationale` | 与 GPT-R1 同源。各 phase closure 均诚实标注 `not run`。承接位置：每 phase 后续批次按 charter §8.3 配额补齐对应 e2e。reviewer 建议的"HP10 final closure 之前补齐所有 cross-e2e"已在 HP8 closure §5 `HP9 freeze gate` unlock condition 中作为前置条件之一登记。 | — |
| DS-N11 | 全阶段 8 个 phase 均 `partial`，无一 `closed` | `acknowledged-systemic-observation` | 这是 reviewer 元判断（system-level observation），不是某个 phase 要修的 bug。reviewer 自身确认"各 phase first wave 代码质量很高（1922 测试全绿即可证明）"+"问题在于 second-wave 工作从未被 timebox"。我们的处理：（a）HP8 closure §5 已诚实给出 `HP9 freeze gate: NOT GRANTED` 与 4 条 unlock condition；（b）HP8 closure §6 已列下游 phase handoff 表，把 35+ second-wave items 按归属 phase 分类登记；（c）HP9 / HP10 的 charter-defined 角色就是承接这批 second-wave 与 chronic register（charter §6.3 严格串行 + §10 final closure 对 F1-F17 逐项判定），不需要在本轮额外 batch plan。 | — |
| DS-N12 | `tool.call.cancelled` vs `tool.cancelled` 命名不一致 | `stale-rejected (incorrect-claim)` | 实查全仓 `grep -rn "tool\.cancelled" packages/ workers/` 返回**零结果**；所有 stream event kind 均为 `tool.call.cancelled`，包括 `packages/nacp-session/src/stream-event.ts:68,148`、`packages/nacp-session/test/hp6-tool-cancelled.test.ts`（文件名为 hp6-tool-cancelled 但 literal kind 全为 `tool.call.cancelled`）、`workers/agent-core/src/eval/inspector.ts:29`、`workers/agent-core/test/eval/inspector.test.ts:37`。reviewer 提到的"nacp-session index.ts 中某些引用使用了 tool.cancelled 缩写"在实际代码中不存在；命名是统一的。 | — (verified clean) |

### 6.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号 | 说明 |
|------|------|------|------|
| 已完全修复 | 1 | DS-N9 | HP6/HP7/HP8 action-plan `文档状态: draft` → `executed`（修改 3 行；HP3 已在前一轮 review fix） |
| 部分修复，需二审判断 | 0 | — | — |
| 有理由 deferred | 12 | GPT-R1/R2/R3/R4/R5, DS-N1/N2/N3/N4/N5/N6/N7/N8/N10 | 全部承接到 HP3/HP6/HP7/HP8 后续批次或 HP9/HP10 charter-aligned 时点；每条都有显式 unlock condition（见对应 closure §2 + HP8 closure §5 + charter §10） |
| 拒绝 / stale-rejected | 1 | DS-N12 | 全仓零 `tool.cancelled` literal，命名是统一的，reviewer 事实判断错误 |
| Reviewer 系统性元判断 / 非 fix-target | 1 | DS-N11 | 8 phase `partial-live` 是 charter §0.5 法律下的结构性结果，HP9/HP10 是 charter-defined 承接时点；HP8 closure §5/§6 已显式登记 |
| 仍 blocked | 0 | — | 无 blocker：reviewer 标 yes-blocker 的 GPT-R1/R2/R3/R4 + DS-N1/N2/N3/N10/N11 全部归类为 charter §0.5 法律下"control-plane first wave + 后续批次承接"的有计划 deferred |

### 6.4 变更文件清单

- `docs/action-plan/hero-to-pro/HP6-action-plan.md` — 第 29 行 `文档状态` 由 `draft` 改为 `executed`，修复 DS-N9。
- `docs/action-plan/hero-to-pro/HP7-action-plan.md` — 第 29 行 `文档状态` 由 `draft` 改为 `executed`，修复 DS-N9。
- `docs/action-plan/hero-to-pro/HP8-action-plan.md` — 第 39 行 `文档状态` 由 `draft` 改为 `executed`，修复 DS-N9。
- `docs/code-review/hero-to-pro/HP6-HP8-reviewed-by-GPT.md` — 追加本 §6 实现者回应（应 reviewer §5 实现者回应入口要求 + `docs/templates/code-review-respond.md`）。

### 6.5 验证结果

> 与本轮回应直接相关的验证。DS-N12 stale-rejected 走实跑命令；其他 deferred 项不在本轮验证范围（未来对应 phase 后续批次落地后由 reviewer 二次审查）。

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|--------|-------------|------|----------------|
| `tool.cancelled` literal 全仓核查 | `grep -rn "tool\.cancelled\b\|\"tool.cancelled\"" packages/ workers/` | `zero matches`（全仓只有 `tool.call.cancelled`） | DS-N12 stale-rejected |
| `tool.call.cancelled` 命名一致性 | `grep -rn "tool\.call\.cancelled" packages/ workers/` 返回 stream-event.ts / hp6-tool-cancelled.test.ts / inspector.ts / inspector.test.ts 一致命中 | `consistent` | DS-N12 stale-rejected |
| HP6/HP7/HP8 action-plan 状态修正 | `grep '文档状态' docs/action-plan/hero-to-pro/HP[678]-action-plan.md` | `executed × 3` | DS-N9 |
| 三类 root drift gate | `pnpm run check:megafile-budget` / `check:tool-drift` / `check:envelope-drift` | `5 file(s) within budget` / `1 tool id (bash) clean` / `1 public file clean` | confirms HP8 first-wave 仍 green |
| `verify-initial-context-divergence.mjs` 缺失现状 | `ls scripts/` | `confirmed-not-present` | DS-N1 deferred-rationale |
| `R29-postmortem.md` 缺失现状 | `ls docs/issue/zero-to-real/` | `confirmed-not-present` | DS-N2 deferred-rationale |
| agent-core/bash-core 未消费 catalog 现状 | `grep -rn "TOOL_CATALOG\|tool-catalog" workers/agent-core/src workers/bash-core/src` | `zero matches`（drift guard 仍 pass，因 catalog 仅 1 entry 且无 dup literal） | DS-N4 deferred-rationale |
| `compactRequired` 硬编码现状 | `grep -n "compactRequired" workers/agent-core/src/host/orchestration.ts` | `296: false`, `429: false` | DS-N5 deferred-rationale（归 HP3） |
| checkpoint-restore-plane HTTP 路由现状 | `workers/orchestrator-core/src/index.ts` checkpoint route parser 仅支持 list/create/diff | `confirmed-no-restore-route` | DS-N6 deferred-rationale（归 HP7） |

```text
# 三类 root drift gate 全部 green
[check-megafile-budget] 5 owner file(s) within budget.
  workers/orchestrator-core/src/index.ts                      facade-router            2886/3000  ok
  workers/orchestrator-core/src/session-truth.ts              d1-truth-aggregator      1897/2000  ok
  workers/orchestrator-core/src/user-do-runtime.ts            user-do-runtime          1222/1300  ok
  workers/agent-core/src/host/do/session-do-runtime.ts        session-do-runtime        737/ 800  ok
  workers/agent-core/src/host/runtime-mainline.ts             kernel-runner             636/ 700  ok

[check-tool-drift] catalog SSoT clean. 1 tool id(s) registered: bash.
[check-envelope-drift] 1 public file(s) clean.
```

### 6.6 未解决事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| GPT-R1 / DS-N10 | deferred | charter §8.3 wire-with-delivery 矩阵分阶段补；substrate 缺位下补 e2e 反成 false-positive | HP6 后续批次（todos / workspace / tool-cancel / promote / cleanup / traversal-deny 6+）+ HP7 后续批次（restore 三模式 / rollback / fork isolation / TTL 6+）+ HP8 后续批次（heartbeat normal/lost/reconnect-resume/sweep 4-scenario）+ HP10 final closure cross-e2e gate |
| GPT-R2 / DS-N7 / DS-N8 | deferred | HP6 control-plane first wave 与 executor/route 边界 | HP6 后续批次（filesystem-core temp-file RPC + workspace public CRUD + tool-calls list/cancel + artifact promote + cleanup cron + agent-core WriteTodos capability）|
| GPT-R3 / DS-N6 | deferred | HP7 substrate first wave 与 executor/route 边界 | HP7 后续批次（restore/fork executor + public route + TTL cleanup cron + rollback baseline e2e）|
| GPT-R4 / DS-N1 / DS-N2 / DS-N3 | deferred | HP8 first wave gate/catalog/Lane E 与 chronic register 边界 | HP8 后续批次（R28 register 终态 + R29 verifier 脚本 + R29 postmortem 三选一 + heartbeat 4-scenario e2e）；如 owner 选择 `handed-to-platform`，HP10 final closure 接收 Q28 4 字段登记 |
| GPT-R5 | deferred | charter §1.1 D7 + §10.1 第 3 条把 18 份 api-docs 冻结到 HP9 | HP9（新增 7 份文档 + error-index 全 code 重排 + permissions legacy compat 改写 + session-ws-v1 补 `tool.call.cancelled` / `session.fork.created`）|
| DS-N4 | deferred | catalog SSoT first wave 与 consumer migration 边界 | HP8 后续批次（agent-core / bash-core 改用 `findToolEntry()` 直读 SSoT）|
| DS-N5 | deferred | 归属 HP3 而非 HP6-HP8 | HP3 后续批次（与 CrossTurnContextManager 同 batch）|
| DS-N11 | systemic-observation-acknowledged | charter §0.5 first-wave/second-wave 法律下的结构性结果，非某 phase 要修的 bug | HP9 freeze gate（HP8 closure §5 已 NOT GRANTED + 4 条 unlock condition）+ HP10 final closure（F1-F17 逐项判定 + 35+ deferred items 三选一终态登记）|

### 6.7 Ready-for-rereview gate

- **是否请求二次审查**：`partial`（DS-N9 trivial fix + DS-N12 stale-rejected verification 可即时复核；其余 deferred 项需在对应 phase 后续批次落地后再审）
- **请求复核的范围**：
  1. `DS-N9 fix verification`：`docs/action-plan/hero-to-pro/HP[678]-action-plan.md` 三份文件 `文档状态` 字段
  2. `DS-N12 stale-rejected verification`：`grep -rn "tool\.cancelled\b" packages/ workers/` 应返回零结果
  3. `三类 root drift gate 仍 green` 验证：HP8 first wave 治理层未回归
  4. **关键判断**：reviewer 是否同意 DS-N11（"全 phase partial"）是 charter §0.5 法律下的合规结构性结果（HP9/HP10 是 charter-defined 承接时点）而非"单独要修的 scope-drift"
- **实现者认为可以关闭本轮 review 的前提**：
  1. reviewer 同意 DS-N9 已 fix
  2. reviewer 同意 DS-N12 stale-rejected 判定（事实核查）
  3. reviewer 同意 GPT-R1..R5 + DS-N1..N8/N10 全部 14 条以"deferred-with-rationale"处理是 charter §0.5 法律下的合规路径（避免 wire-without-consumer 反模式）
  4. reviewer 同意 DS-N11 系统性元判断不要求在本轮新建 batch plan（HP9 freeze gate 与 HP10 final closure 是 charter-defined 承接时点）
  5. reviewer 同意 GPT-R5 / DS-N4 等 HP9/HP10 territory 项由 charter §10 时间约束承接，不在 HP6-HP8 散打补

> 备注：两份 review 整体口径 GPT 标 `changes-requested / no`、DS 标 `changes-requested / no`。本轮回应在统一处理 14 条去重 finding 后，建议本轮 review 以 `partially-closed-with-deferred-roadmap` 收口——已显式 fix（DS-N9）+ stale-rejected（DS-N12）2 项当下可二审，其余 12 项进入对应 phase 后续批次或 HP9 / HP10 charter-aligned 承接时点的 reviewer 跟踪表。HP8 closure §5 的 `HP9 freeze gate: NOT GRANTED` 已显式承接 R28/R29/heartbeat 三项 unlock condition，与本轮 reviewer 担忧完全对齐。
