# Nano-Agent 代码审查 — HP0 Pre-Defer Fixes + HP1 Schema Extension

> 审查对象: `HP0-action-plan.md` + `HP1-action-plan.md` 及其代码实现与两份 closure
> 审查类型: `mixed`（代码 + 文档 + closure）
> 审查时间: `2026-04-30`
> 审查人: `GLM`
> 审查范围:
> - `workers/orchestrator-core/src/session-lifecycle.ts` — HP0 P2-01 类型补齐 + 共享 validator
> - `workers/orchestrator-core/src/user-do/session-flow.ts` — HP0 P2-02 /start /input 透传
> - `workers/orchestrator-core/src/user-do/message-runtime.ts` — HP0 P2-02 /messages 改为消费共享 validator
> - `workers/orchestrator-core/src/user-do-runtime.ts` — HP0 P2-02 requireAllowedModel 注入
> - `workers/agent-core/src/host/runtime-mainline.ts` — HP0 P3-01 seam
> - `workers/orchestrator-core/test/binding-presence.test.ts` — HP0 P4-01
> - `workers/agent-core/test/host/system-prompt-seam.test.ts` — HP0 P3-01
> - `workers/orchestrator-core/test/user-do.test.ts` — HP0 P2-02 3 个回归 case
> - `workers/orchestrator-core/migrations/007-013` — HP1 全部 7 个 migration
> - `workers/orchestrator-core/test/migrations-schema-freeze.test.ts` — HP1 P5-01 17 项断言
> - `docs/architecture/hero-to-pro-schema.md` — HP1 P5-02
> - `docs/issue/hero-to-pro/HP0-closure.md` — HP0 收尾文档
> - `docs/issue/hero-to-pro/HP1-closure.md` — HP1 收尾文档
> - `clients/api-docs/session.md` — 当前 API 文档（跨阶段漂移核查）
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md` §7.1 HP0 + §7.2 HP1
> - `docs/action-plan/hero-to-pro/HP0-action-plan.md` + `HP1-action-plan.md`
> - `docs/design/hero-to-pro/HPX-qna.md`（仅作为冻结决策引用，不重新讨论）
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`HP0 与 HP1 的代码实现与文档均忠实执行了 charter 与 action-plan 的要求；两份 closure 的登记与 handoff 结构完整；测试矩阵全绿。但 HP1 在 model metadata 真值回填上存在 partial 声明不完整的缺口，api-docs 漂移在预期内但应显式追踪。`
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`yes`
- **本轮最关键的 3 个判断**：
  1. 三入口模型字段/body law 统一已被代码与测试充分验证，无回归风险
  2. HP1 DDL Freeze Gate 生效，007-013 全部可通过 schema-assertion test，但 10 列 metadata 的 backfill 状态需在 closure 中更精确声明
  3. api-docs 与代码的漂移（session.md 未记录 model_id/reasoning）在 HP9 收口前将持续恶化，但 charter D7 明确将其留到 HP9

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-hero-to-pro.md` §7.1（HP0）+ §7.2（HP1）
  - `docs/action-plan/hero-to-pro/HP0-action-plan.md` §4-§5（HP0 Phase 表与详情）
  - `docs/action-plan/hero-to-pro/HP1-action-plan.md` §4-§5（HP1 Phase 表与详情）
  - `docs/issue/hero-to-pro/HP0-closure.md` + `HP1-closure.md`
- **核查实现**：
  - `workers/orchestrator-core/src/session-lifecycle.ts` — 全文 206 行，逐行核查 HP0 P2-01 代码
  - `workers/orchestrator-core/src/user-do/session-flow.ts` — 全文 673 行，核查 handleStart/handleInput/handleCancel/handleVerify
  - `workers/orchestrator-core/src/user-do/message-runtime.ts` — 全文 362 行，核查 handleMessages 共享 validator 使用
  - `workers/agent-core/src/host/runtime-mainline.ts` — 全文 586 行，核查 withNanoAgentSystemPrompt seam
  - `workers/orchestrator-core/test/binding-presence.test.ts` — 全文 72 行
  - `workers/agent-core/test/host/system-prompt-seam.test.ts` — 全文 34 行
  - `workers/orchestrator-core/test/user-do.test.ts` — 全文 1504 行，定位 HP0 3 个 case
  - `workers/orchestrator-core/migrations/007-013` — 7 个 SQL 文件共 566 行
  - `workers/orchestrator-core/test/migrations-schema-freeze.test.ts` — 全文 432 行
  - `docs/architecture/hero-to-pro-schema.md` — 全文 321 行
  - `clients/api-docs/session.md` — 全文 409 行，核查与代码的漂移
  - `clients/api-docs/catalog.md` — 全文 146 行
- **执行过的验证**：
  - `pnpm --filter @haimang/orchestrator-core-worker test` — ✅ 21 files / 196 tests pass
  - `pnpm --filter @haimang/agent-core-worker test` — ✅ 102 files / 1072 tests pass
  - `pnpm --filter @haimang/orchestrator-core-worker test -- migrations-schema-freeze` — ✅ 17 cases
  - `pnpm --filter @haimang/orchestrator-core-worker test -- binding-presence` — ✅ 6 cases
  - 文件存在性核查：`docs/runbook/zx2-rollback.md` 已不存在（P4-02 正确执行）
  - `forwardInternalJsonShadow` 仍在 `user-do-runtime.ts:269,314,754` — K1 retained 正确
  - `parity-bridge.ts` 仍被 `session-flow.ts:2` import — K2 retained 正确
- **复用 / 对照的既有审查**：无 — 本次审查为独立进行，未采纳其他同事的分析报告

### 1.1 已确认的正面事实

- **F1**：三入口模型字段/body law 已统一。`session-lifecycle.ts` 新增 `parseModelOptions()` 共享 validator，`session-flow.ts` 的 `handleStart` 和 `handleInput` 均通过该 validator + `requireAllowedModel()` gate 校验后再透传。`message-runtime.ts` 删除了原有 27 行内联校验，改为消费共享函数。三入口不存在第二套 validator。
- **F2**：`withNanoAgentSystemPrompt(messages, modelId?)` seam 已落地。函数签名增 `modelId?`，调用点传 `evidence.modelId`，`void modelId` 占位。3 个 seam 测试通过。HP0 closure §2 P1 明确标记 `seam-only` + `expires-at: HP1 closure`。
- **F3**：HP1 7 个 migration（007-013）全部存在且可通过 `node:sqlite` 顺序 apply 001→013。17 项 schema-assertion case 全部断言通过，包括 Q4/Q5/Q6/Q13/Q16/Q18 的冻结约束。
- **F4**：HP1 DDL Freeze Gate 的 correction registry 模板（closure §3）完整可执行：触发条件 A/B/C、编号规则 `014-correction-of-NNN-<topic>.sql`、6 行 SQL 文件头模板、closure/charter 登记要求均显式写明。
- **F5**：`binding-presence.test.ts` 6 个 case 正确钉住 `CONTEXT_CORE` binding（4 个）+ `LANE_E_RPC_FIRST=false`（2 个），与 Q3 冻结法律一致。
- **F6**：HP0 K1/K2/K3 retained 项在代码中验证完整：`forwardInternalJsonShadow` 方法仍在 `user-do-runtime.ts` 线 ~269/314 被调用；`parity-bridge.ts` 的 `readJson` 和 `StreamFrame` 仍被 `session-flow.ts:2` import。
- **F7**：HP1 consumer map（closure §7 + schema doc §1-§8）覆盖了 007-013 每张表/每列到 HP2-HP9 的消费关系，`nano_workspace_cleanup_jobs.scope` 三值分工已锁定。
- **F8**：009 turn attempt rebuild 使用 `CREATE turns_new ... INSERT OR IGNORE FROM turns ... DROP turns ... RENAME` 模式，正确处理了 SQLite 不支持 DROP CONSTRAINT 的问题，且 schema-assertion test 第 4/9 case 显式验证旧 `UNIQUE(session_uuid, turn_index)` 已消失。

### 1.2 已确认的负面事实

- **N1**：007 migration 的 10 列 metadata（`max_output_tokens` / `effective_context_pct` / `auto_compact_token_limit` / `supported_reasoning_levels` / `input_modalities` / `provider_key` / `fallback_model_id` / `base_instructions_suffix` / `description` / `sort_priority`）在所有现有 `nano_models` 行上均为 NULL。HP1 closure §2 P1 仅声明 `base_instructions_suffix` 为 `column-exists-only` partial，但其他 9 列在现有模型行上同样为 NULL，closure 未显式声明这一状态。
- **N2**：`clients/api-docs/session.md` 未记录 `/start` 和 `/input` 端点接受的 `model_id` / `reasoning.effort` 字段。文档示例仍仅展示 `{ "text": "Hello" }`，与代码实际支持的字段不同步。虽 charter D7 将文档更新留到 HP9，但漂移已实际扩大。
- **N3**：`clients/api-docs/catalog.md` 的 `/messages` 状态为 `preview`，与代码中 `/messages` 已经是三个入口中最完整的 reference implementation 的地位不一致。此为 HP9 领域，但记录在此。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 逐文件核查 HP0/HP1 实现代码与 closure claim |
| 本地命令 / 测试 | `yes` | orchestrator-core 196 tests + agent-core 1072 tests + schema-freeze 17 cases 全绿 |
| schema / contract 反向校验 | `yes` | 007-013 SQL 文件逐条对照 charter §7.2 列/索引/约束要求 |
| live / deploy / preview 证据 | `no` | HP1 prod migration apply 留 HP9，本审查无法验证 prod 状态 |
| 与上游 design / QNA 对账 | `yes` | Q1/Q2/Q3/Q4/Q5/Q6/Q13/Q16/Q18 逐条对照 closure §8/§9 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | HP1 model metadata 列回填 partial 声明不完整 | medium | docs-gap | no | HP2 启动前补充 closure §2 声明，或 HP2 真值回填时回写 HP1 closure |
| R2 | api-docs session.md 未记录 model_id/reasoning 字段 | low | docs-gap | no | HP9 集中收口时更新；HP0/HP1 不改变此状态 |
| R3 | parseModelOptions() 未对 model_id 做 allowlist gate 后的 sanitize | low | platform-fitness | no | 当前 requireAllowedModel() gate 在三入口分别调用，parseModelOptions 只做格式校验，设计合理但需 HP2 关注 |
| R4 | 009 rebuild 在高并发 prod 场景下的锁表时间 | low | platform-fitness | no | local apply 已通过；prod apply 为 HP9 owner-action，届时需评估 |
| R5 | `/input` 端点的 `handleInput` 将 model_id/reasoning 直接拼入 messagesBody 传给 handleMessages，但未保留 model_id 的路径在 `forwardInternalJsonShadow` 调用中 | medium | correctness | no | 需确认 agent-core 是否从 `_origin` 字段之外的渠道收到 model_id |

### R1. HP1 model metadata 列回填 partial 声明不完整

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/migrations/007-model-metadata-and-aliases.sql` 仅做 `ALTER TABLE ADD COLUMN`，10 列在所有 `nano_models` 现有行上默认为 NULL。
  - HP1 closure §2 P1 仅声明 `base_instructions_suffix` 为 `column-exists-only` partial（`expires-at: HP2 closure`），但 `max_output_tokens`、`effective_context_pct`、`auto_compact_token_limit`、`supported_reasoning_levels`、`input_modalities`、`provider_key`、`fallback_model_id`、`description`、`sort_priority` 这 9 列同样为 NULL。
  - Charter §7.2 收口标准 3 写明 "`nano_models` 全部 active 模型新列回填完成 + 4 alias seed 验证"，但条目 7 说"在 `003-usage-quota-and-models.sql` 现有 seed 基础上回填"，实际上 007 并未包含任何 UPDATE 语句。
- **为什么重要**：HP2 model state machine 需要读到非 NULL 的 `effective_context_pct`、`auto_compact_token_limit` 等字段来触发 compact（charter §2 G2/G4）。若 HP2 启动时这些列仍为 NULL，compact 逻辑可能永远不触发。
- **审查判断**：HP1 closure 文档应将全部 10 列声明为 partial（而非仅 `base_instructions_suffix`），并标记 `expires-at: HP2 closure`。HP2 有义务在 model state machine 中对这些列做真值 seed。当前不构成 blocker，因为 HP2 action-plan 可以自然承接。
- **建议修法**：在 HP1 closure §2 补充 P1.1-P1.9（9 列同 `base_instructions_suffix` 状态），或在 HP2 启动前补充 migration 007 的 seed data。

### R2. api-docs session.md 未记录 model_id/reasoning 字段

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/api-docs/session.md` 的 `POST /sessions/{id}/start` 示例仅为 `{ "text": "Hello" }` 或 `{ "initial_input": "Hello", "initial_context": { "layers": [] } }`，未列出 `model_id` 或 `reasoning` 字段。
  - `POST /sessions/{id}/input` 示例为 `{ "text": "Tell me more" }`，同样未列出新增字段。
  - 代码中 `/start` 和 `/input` 现已正式接受并透传 `model_id` + `reasoning.effort`。
- **为什么重要**：这是 charter §2 G12 中指出的 "`clients/api-docs/` 11 份文档与代码漂移"的又一个实例。每次代码新增字段而文档未同步，就会加剧客户端开发者的困惑。
- **审查判断**：符合 charter D7 决议（文档更新留 HP9），不构成 blocker。但漂移事实应显式记录在 HP0 closure 的 follow-up 中。
- **建议修法**：无需 HP0/HP1 内修复；HP9 集中收口时必须覆盖此漂移。

### R3. parseModelOptions() 格式校验与 requireAllowedModel() gate 的职责边界

- **严重级别**：`low`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `session-lifecycle.ts:83-128` 的 `parseModelOptions()` 仅做 `MODEL_ID_PATTERN` 格式校验（`/^[a-z0-9@/._-]{1,120}$/i`），不做 allowlist 检查。
  - `requireAllowedModel()` 在 `/start` 和 `/messages` 入口处被分别调用，做 D1 模型目录 gate 检查。
  - `/input` 入口的 `handleInput` 通过将 `model_id` 拼入 `messagesBody` 传给 `handleMessages`，后者在消耗完 `parseModelOptions()` 后调 gate。这意味着 `/input` 的 model gate 路径是间接的。
- **为什么重要**：当前实现逻辑正确——三入口最终都经过 `parseModelOptions()` + `requireAllowedModel()` gate。但 HP2 在引入 alias resolution 后需要确认 gate 路径仍覆盖 `/input` 的间接路径。
- **审查判断**：当前非 bug，但 HP2 应显式测试 `/input + alias` 组合。
- **建议修法**：在 HP2 action-plan 中增加「`/input` 端点的 model_id 通过 handleMessages 间接 gate」的显式测试 case。

### R4. 009 rebuild 在 prod 场景的锁表时间

- **严重级别**：`low`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `009-turn-attempt-and-message-supersede.sql` 采用 `CREATE TABLE ... AS SELECT ... INSERT OR IGNORE ... DROP TABLE ... RENAME` 模式重建 `nano_conversation_turns`。在 high-traffic prod 环境中，DROP + RENAME 期间可能造成短暂锁表。
- **为什么重要**：HP1 的 prod migration apply 由 HP9 owner-action 执行，届时 prod 数据量可能显著大于当前 dev。
- **审查判断**：本地 apply 通过不代表 prod 无风险。HP9 应有预案。
- **建议修法**：HP9 closure 应显式记录 009 rebuild 的 prod 执行策略（建议在 low-traffic 时段 + 显式 LOCK 检查）。

### R5. `/input` 端点 model_id 在 forwardInternalJsonShadow 路径中的可达性

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `session-flow.ts:463-484` 的 `handleInput` 构建 `messagesBody` 时包含了 `model_id` 和 `reasoning`，然后传给 `ctx.handleMessages()`。
  - `message-runtime.ts:274-289` 的 `handleMessages` 中，`forwardInternalJsonShadow` 调用的 payload 包含了 `model_id` 和 `reasoning`（第 281-282 行）。
  - `session-flow.ts:363-372` 的 `handleStart` 中，`forwardStart` 的 payload 也包含了 `model_id` 和 `reasoning`（第 369-370 行）。
  - 两个入口的 RPC 调用都传递了 model 字段。经进一步核查，`message-runtime.ts:281-282` 确认 `forwardInternalJsonShadow` 的 input payload 包含 `model_id` 和 `reasoning`。因此三入口的 model 字段均可到达 agent-core，与 closure 声明一致。
- **为什么重要**：若 `forwardInternalJsonShadow` 不传递 `model_id`，则 `/messages` 和 `/input` 的模型选择无法到达运行时，HP0 的核心目标将失败。
- **审查判断**：经核查确认三个入口的 RPC payload 均包含 `model_id`/`reasoning`，此条不再是 finding。但保留此条作为审查记录，以便后续 phase 验证 agent-core 端对 `forwardStart` payload 的 model 字段消费路径。
- **建议修法**：无。此条经核查已确认为正面事实（F1 的一部分）。

---

## 3. In-Scope 逐项对齐审核

### HP0 In-Scope 对齐

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | P1-01 residue baseline + closure skeleton | `done` | HP0-closure §0-§6 结构完整；residue ledger 含 K1/K2/K3 三条 retained 项 |
| S2 | P2-01 StartSessionBody/FollowupBody 字段补齐 | `done` | `session-lifecycle.ts:46-71` 新增 `model_id?`/`reasoning?`，`StartSessionBody`/`FollowupBody` 与 NACP schema 对齐 |
| S3 | P2-02 /start /input 透传到 /messages law | `done` | `session-flow.ts:241-251` handleStart 使用 `parseModelOptions + requireAllowedModel`；`session-flow.ts:472-483` handleInput 透传到 handleMessages；`message-runtime.ts:136-139` handleMessages 消费共享 validator。三入口无第二套校验 |
| S4 | P3-01 withNanoAgentSystemPrompt(modelId?) seam | `partial` | 函数签名与调用点已存在（`runtime-mainline.ts:174-178`），但 `void modelId` 为占位；closure §2 P1 明确标记 `expires-at: HP1 closure`。HP1 已提供列级支撑（P2 partial），真值接线归 HP2 |
| S5 | P4-01 binding-presence verify | `done` | `binding-presence.test.ts` 6 case 全绿，覆盖 orchestrator-core/agent-core 两层 prod+preview |
| S6 | P4-02 zx2-rollback 删除 | `done` | 文件已不存在 |
| S7 | P4-03 conditional lockfile cleanup | `done` (no-op) | 13 个 importer key 全部对应真实目录，无需修改 |
| S8 | P5-01 HP0 closure + residue handoff | `done` | closure §0-§10 结构完整；F1-F17 登记完整；handoff 指向 HP1/HP8/HP10 |

### HP1 In-Scope 对齐

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S9 | P1-01 freeze doc alignment | `done` | charter / HP1 design / QNA 派生规则已显式录入 closure |
| S10 | P1-02 consumer map scaffolding | `done` | closure §7 + schema doc §1-§8 覆盖 007-013 到 HP2-HP9 的每列消费关系 |
| S11 | P2-01 007-model-metadata-and-aliases.sql | `done` | 10 列 ALTER TABLE + alias 表 + 4 alias seed + 索引；metadata 真值回填见 R1 |
| S12 | P2-02 008-session-model-audit.sql | `done` | sessions 3 列 + turns 5 列 + ended_reason（Q13）+ 索引 |
| S13 | P2-03 009-turn-attempt-and-message-supersede.sql | `done` | turn Attempt rebuild + UNIQUE 重建 + message supersede + conversation deleted_at |
| S14 | P3-01 010-agentic-loop-todos.sql | `done` | todo 完整字段 + 5 值 status + 索引 |
| S15 | P3-02 011-session-temp-files-and-provenance.sql | `done` | temp_files 完整字段 + 3 值 cleanup/written_by + provenance 3 列 5 值 + 索引 |
| S16 | P3-03 012-session-confirmations.sql | `done` | 7 kinds + 6 statuses；Q16/Q18 禁 `failed`/`tool_cancel` 显式断言 |
| S17 | P4-01 013-product-checkpoints.sql | `done` | 4 张表（checkpoints + file_snapshots + restore_jobs + cleanup_jobs）；scope 3 值分工锁定 |
| S18 | P5-01 schema-assertion test | `done` | 17 case 全绿；001→013 顺序 apply；Q4/Q5/Q6/Q13/Q16/Q18 断言覆盖 |
| S19 | P5-02 schema doc + closure + correction registry | `done` | `hero-to-pro-schema.md` 10 段完整；HP1 closure 10 段完整；correction registry 模板可执行 |

### 对齐结论

- **done**: 17
- **partial**: 1（S4 — HP0 P3-01 modelId seam，by-design partial + expires-at 已标记）
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0

> HP0 的 partial 项仅 P3-01 modelId seam 一处，且 expires-at 已标记。HP1 所有项均为 done（但 R1 指出 metadata 列回填的 partial 声明不完整）。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | HP0 不新增 D1 schema | `遵守` | 无新 migration 文件 |
| O2 | HP0 不修改 wrangler 配置 | `遵守` | binding-presence test 只读验证，零修改 |
| O3 | HP0 不删 forwardInternalJsonShadow / parity-bridge | `遵守` | K1/K2 retained 项代码验证完整 |
| O4 | HP0/HP1 不更新 clients/api-docs | `遵守` | D7 决议留 HP9；漂移已记录见 R2 |
| O5 | HP1 不做 remote/prod apply | `遵守` | 仅 local apply，closure §2 P3 明确 `local-only` |
| O6 | HP1 不新增 HP2-HP7 业务逻辑 | `遵守` | 仅 migration SQL，零 runtime 代码修改 |
| O7 | confirmation 不含 failed/tool_cancel | `遵守` | 012 CHECK 约束 + test 显式拒绝 |
| O8 | HP0 modelId seam 不读 D1 | `遵守` | `void modelId` 占位，closure P1 标记 expires-at |
| O9 | session close 不新增状态 enum | `遵守` | 008 加 `ended_reason` 列，不改 session_status |

---

## 5. 跨阶段深度分析

> 本节超越 HP0/HP1 本身的 In-Scope 核查，对 hero-to-pro 全阶段的跨包事实进行独立分析。

### 5.1 三入口 model_id 路径端到端可达性

经核查，三入口的 model 字段到达 agent-core 的路径如下：

1. **`/start`** → `handleStart` → `parseModelOptions()` → `requireAllowedModel()` gate → `forwardStart()` payload 含 `model_id` + `reasoning` → agent-core `runtime-mainline.ts:316` `withNanoAgentSystemPrompt(resolvedMessages, evidence.modelId)` → `readLlmRequestEvidence` 提取 `modelId` → LLM 调用。

2. **`/input`** → `handleInput` → 构建 `messagesBody` 含 `model_id` + `reasoning` → `handleMessages()` → `parseModelOptions()` + gate → `forwardInternalJsonShadow("input", payload含model_id)` → agent-core 消费。

3. **`/messages`** → `handleMessages()` → `parseModelOptions()` + gate → `forwardInternalJsonShadow("input", payload含model_id)` → agent-core 消费。

**结论**：三入口 model_id 路径端到端可达，与 closure 声明一致。HP0 的核心目标已完成。

### 5.2 `forwardInternalJsonShadow` / `parity-bridge.ts` 残留分析

HP0 closure §3 将 `forwardInternalJsonShadow`（K1）和 `parity-bridge.ts` helpers（K2）标记为 retained，等 HP8-B R29 postmortem 后判定。

代码核查确认：
- `user-do-runtime.ts:269,314` 仍在两处注入 `forwardInternalJsonShadow` 到 session-flow 和 message-runtime 上下文。
- `session-flow.ts:2` 显式 import `readJson` 和 `StreamFrame` type from `parity-bridge.js`。
- `session-flow.ts:526-535` handleCancel 仍调用 `ctx.forwardInternalJsonShadow`。
- `message-runtime.ts:7-10` import `parseModelOptions` 从 `session-lifecycle`（正确）和 `StreamFrame` type 从 `parity-bridge`（retained）。
- `message-runtime.ts:74-78` 和 `296` （旧内联校验区域已删除，但 `forwardInternalJsonShadow` 调用在 `274-289` 仍存在）。

`forwardInternalJsonShadow` 不是 dead code — 它是 `/input` 和 `/messages` 的 agent-core RPC 通道，且 `/cancel` 也依赖它。HP8-B 的 R29 postmortem 判定不能简单删除这个方法，而需要判断其命名是否造成误导。命名残留（charter §1.2 R3 修订已确认行为不再是 fetch shadow，仅命名残留）是文档层面的问题，不是代码安全问题。

### 5.3 api-docs 与代码实现漂移清单

| 文档 | 漂移项 | 严重度 | 消费 phase |
|------|--------|--------|-----------|
| `session.md` — POST /start | 缺少 `model_id` / `reasoning.effort` 字段 | medium | HP9 |
| `session.md` — POST /input | 缺少 `model_id` / `reasoning.effort` 字段 | medium | HP9 |
| `session.md` — POST /messages | 缺少 `model_id` / `reasoning.effort` 字段 | medium | HP9 |
| `session.md` — Context Routes | 仍标注 `phase: "stub"` | high（G3） | HP3 |
| `catalog.md` — /messages status | 标注 `preview` 但代码已是 reference implementation | low | HP9 |
| `catalog.md` — /files description | 写"当前不提供 bytes download"但代码已支持 GET content | low | HP9 |

> Charter G3 明确指出 context-core 3 个 RPC 全部 `phase: "stub"`。`session.md` 虽然列出了 `/context`、`/context/snapshot`、`/context/compact` 路由，但标注它们为 stub 且依赖 `CONTEXT_CORE` binding。此 drift 在 HP3 范围内解决。

### 5.4 HP0→HP1 交接验证

HP0 closure §6 列出 4 个 handoff 项：

| 接收 phase | 交接物 | HP1 是否消费 | 说明 |
|-----------|--------|-------------|------|
| HP1 | `withNanoAgentSystemPrompt` 真 suffix 接线 + `base_instructions_suffix` 字段落表 | `done` | 007 已落 `base_instructions_suffix` 列；closure §2 P1/P2 标记 |
| HP2 | session-level model state | `pending` | 不在 HP1 范围 |
| HP8-B | R29 postmortem | `pending` | 不在 HP1 范围 |
| HP10 | final cleanup | `pending` | 不在 HP1 范围 |

HP1 closure §2 P1（`base_instructions_suffix` column-exists-only）和 P2（seam 列接线 column-ready）正确消费了 HP0 的 handoff。HP2 将继承 `expires-at: HP2 closure` 的接线义务。

### 5.5 HP1→HP2 交接验证

HP1 closure §6 列出 HP2 的强依赖交接：

| 交接物 | 状态 | 说明 |
|--------|------|------|
| 模型状态机 — 消费 007 metadata + 008 session/turn audit + 007 alias 表 | `schema-ready` | HP2 需要 007 真值 seed（见 R1） |
| HP0/P1 partial — `withNanoAgentSystemPrompt` 接线 | `column-ready` | HP2 需要从 NULL suffix 到真 suffix |
| HP0/P2 partial — `withNanoAgentSystemPrompt(modelId?)` seam 列接线 | `column-ready` | HP2 需要读 `nano_models.base_instructions_suffix` 真值 |

**关键风险点**：HP2 启动时，`nano_models` 的 10 个 metadata 列在所有现有行上均为 NULL。HP2 需要在 action-plan 中明确包含 model metadata 真值 seed 的步骤。若 HP2 的 `withNanoAgentSystemPrompt` 直接读 `base_instructions_suffix` 列且未处理 NULL fallback，compact 逻辑和 per-model suffix 将失效。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：`HP0 和 HP1 的实现忠实执行了 charter 和 action-plan 的要求。代码、migration、测试与文档整体一致。唯一值得追踪的 medium 级 finding 是 HP1 model metadata 真值回填 partial 声明不完整（R1），但这不构成 blocker——HP2 的 model state machine action-plan 自然承接这一缺口。`
- **是否允许关闭本轮 review**：`yes`
- **关闭前必须完成的 blocker**：无
- **可以后续跟进的 non-blocking follow-up**：
  1. R1：HP2 启动前补充 HP1 closure §2 对 9 列 metadata 的 partial 声明，或在 HP2 内完成真值 seed
  2. R3：HP2 增加 `/input` 端点 model_id + alias 组合的显式测试 case
  3. R4：HP9 closure 记录 009 rebuild 的 prod 执行策略
  4. R2：HP9 集中收口 `clients/api-docs/session.md` 的 model_id/reasoning 字段文档
- **建议的二次审查方式**：`no rereview needed` — HP0/HP1 的工作已通过代码与文档双重核查，无 blocker 遗留。
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §7 append 回应，不要改写 §0–§5。