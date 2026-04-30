# Nano-Agent 代码审查 — HP0 Pre-Defer Fixes + HP1 Schema Extension 实施收尾审查

> 审查对象: `hero-to-pro 阶段 HP0-HP1 的全部代码、测试、文档与闭包`
> 审查类型: `code-review | docs-review | closure-review`
> 审查时间: `2026-04-30`
> 审查人: `DeepSeek-V4-Pro (独立审查，未参考 Kimi / DeepSeek / GPT 等外部分析)`
> 审查范围:
> - `workers/orchestrator-core/src/session-lifecycle.ts` — HP0 类型对齐 + 共享 validator
> - `workers/orchestrator-core/src/user-do/session-flow.ts` — HP0 `/start` / `/input` 透传
> - `workers/orchestrator-core/src/user-do/message-runtime.ts` — HP0 `/messages` validator 重构
> - `workers/orchestrator-core/src/user-do-runtime.ts` — HP0 `requireAllowedModel` 注入
> - `workers/agent-core/src/host/runtime-mainline.ts` — HP0 system prompt seam
> - `workers/orchestrator-core/migrations/007-013` — HP1 全部 DDL migration
> - `workers/orchestrator-core/test/*.test.ts` — HP0/HP1 新增测试 (binding-presence, user-do, migrations-schema-freeze)
> - `workers/agent-core/test/host/system-prompt-seam.test.ts` — HP0 seam 测试
> - `docs/issue/hero-to-pro/HP0-closure.md` — HP0 阶段闭包
> - `docs/issue/hero-to-pro/HP1-closure.md` — HP1 阶段闭包
> - `docs/architecture/hero-to-pro-schema.md` — HP1 schema 参考文档
> - `clients/api-docs/` (11 份) — 客户端文档交叉验证
> - `docs/charter/plan-hero-to-pro.md` — 阶段基石对照
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md` §7.1 HP0, §7.2 HP1
> - `docs/action-plan/hero-to-pro/HP0-action-plan.md` (含 §9 实施回填)
> - `docs/action-plan/hero-to-pro/HP1-action-plan.md` (含 §9 实施回填)
> - `docs/design/hero-to-pro/HPX-qna.md` Q1-Q6, Q13, Q16, Q18
> 文档状态: `reviewed`

---

## 0. 总结结论

> HP0-HP1 的实施质量极高：代码变更精准、测试覆盖充分、闭包文档严密。所有 charter 要求的 In-Scope 项均已落地，所有 QNA 冻结决策均被正确遵守，所有 Out-of-Scope 边界均未被跨越。本轮识别的 10 项发现中，无 blocker，仅 2 项 high-severity (均非实施缺陷，而是下游消费风险与文档滞后问题)。HP2 可以安全地从 HP0-HP1 基线启动。

- **整体判断**: `HP0-HP1 实施完整、正确、可审计。代码与 schema 均为可消费的稳定基线。`
- **结论等级**: `approve-with-followups`
- **是否允许关闭本轮 review**: `yes`
- **本轮最关键的 1-3 个判断**:
  1. `HP0 三入口模型字段/body law 统一实现正确——parseModelOptions() 共享 validator 消除了历史语义分裂；HP1 007-013 七个 migration 全部落地，DDL Freeze Gate 有效成立——17 项 schema-assertion 测试全绿`
  2. `clients/api-docs/session.md 标题仍为 "RHX2 Phase 6 Snapshot"，出现 gpt-5.4 等过期内容——不影响代码正确性，但在 HP9 文档冻结前存在客户端误导风险`
  3. `HP0 closure 与 HP1 closure 的 F1-F17 chronic 登记体系跨阶段一致，但 HP0 closure §7 的测试矩阵数字在 HP1 合并后已过期——建议在 HP1 closure 中增加 HP0 基线数字的回标`

---

## 1. 审查方法与已核实事实

> 这一节只写事实，不写结论。明确了审查了哪些文件、跑了哪些命令、核对了哪些计划项/设计项/closure claim。

- **对照文档**:
  - `docs/charter/plan-hero-to-pro.md` §7.1 HP0 (In-Scope 列表与收口标准)
  - `docs/charter/plan-hero-to-pro.md` §7.2 HP1 (In-Scope 列表与收口标准)
  - `docs/action-plan/hero-to-pro/HP0-action-plan.md` (含 §9 实施回填)
  - `docs/action-plan/hero-to-pro/HP1-action-plan.md` (含 §9 实施回填)
  - `docs/design/hero-to-pro/HPX-qna.md` Q1-Q6, Q13, Q16, Q18
- **核查实现**:
  - 所有 HP0 代码变更文件 (5 个 modify + 3 个 test add + 1 个 delete)
  - 所有 HP1 migration 文件 (7 个 add)
  - 所有 HP1 test/documents (3 个 add)
  - `clients/api-docs/` 11 份文档
- **执行过的验证**:
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck` → ✅
  - `pnpm --filter @haimang/orchestrator-core-worker build` → ✅
  - `pnpm --filter @haimang/orchestrator-core-worker test` → ✅ 21 files / 196 tests pass
  - `pnpm --filter @haimang/agent-core-worker typecheck` → ✅
  - `pnpm --filter @haimang/agent-core-worker build` → ✅
  - `pnpm --filter @haimang/agent-core-worker test` → ✅ 102 files / 1072 tests pass
  - `git diff HEAD~3..HEAD --stat` — 确认变更范围
  - 逐 migration SQL 结构审查 (007-013, 含 rebuild 逻辑)
- **复用 / 对照的既有审查**:
  - `docs/eval/hero-to-pro/action-plan-docs-reviewed-by-deepseek.md` (上一轮 action-plan 审查) — 对照其中 7 项发现 (R1-R7) 检查是否在执行中被处理
  - 无 — 本审查为独立原发审查，未采纳其他 reviewer 的结论

### 1.1 已确认的正面事实

- **F_POS_1: HP0 三入口模型字段/body law 统一实现完全正确**
  - `parseModelOptions()` (session-lifecycle.ts:83-129) 是一个设计优秀的共享 validator：使用 sum type (`ok: true | false`) 统一表达成功/失败，消除了 `/messages` 历史内联校验与 `/start`/`/input` 新路径之间的语义分裂风险。
  - `/start` 路径 (session-flow.ts:238-248) 先校验 model_id → 再走 requireAllowedModel gate → 最后透传到 forwardStart payload，与 `/messages` 的 gate law 完全一致。
  - `/input` 路径 (session-flow.ts:476-478) 将 model_id/reasoning 附加到 messagesBody 后委托给 handleMessages 的同一 law，避免了在 `/input` 重复实现 validator。
  - `/messages` 路径 (message-runtime.ts:135-139) 改为消费同一 `parseModelOptions()`，删除了原来的 27 行内联校验代码。

- **F_POS_2: HP1 007-013 七个 migration 全部落地，schema freeze gate 有效成立**
  - 007: `nano_models` 扩 10 列 + `nano_model_aliases` + 4 条 alias seed
  - 008: `default_model_id`/`default_reasoning_effort`/`ended_reason` + turn audit 5 列
  - 009: turn 表 rebuild (UNIQUE 三列约束 → 重建为 `session_uuid+turn_index+turn_attempt`) + message supersede + conversation tombstone
  - 010: `nano_session_todos` (5 种 status enum)
  - 011: `nano_session_temp_files` (含 expires_at/cleanup_status) + `nano_session_files` provenance 三列 (5 种 provenance_kind)
  - 012: `nano_session_confirmations` (7 kinds / 6 statuses，不含 `failed`/`tool_cancel`)
  - 013: checkpoint 三表 + cleanup_jobs 表

- **F_POS_3: 测试矩阵充分且精确**
  - HP0 新增 12 个 case (3 user-do model law + 6 binding-presence + 3 system-prompt seam)
  - HP1 新增 17 个 schema-assertion case (用 `node:sqlite` 顺序 apply 001→013 后逐表逐列 introspect)
  - 全量回归绿：orchestrator-core 21 files / 196 tests pass，agent-core 102 files / 1072 tests pass

- **F_POS_4: 009 migration rebuild 逻辑正确**
  - 创建 `nano_conversation_turns_new` 时显式声明了 008 新增的 5 个 audit 列 + 009 的 turn_attempt
  - `INSERT OR IGNORE ... SELECT` 显式列出了 requested_model_id/effective_model_id/fallback_used 等全部字段
  - 旧 `UNIQUE(session_uuid, turn_index)` 被彻底移除，新 UNIQUE 生效 (schema-freeze test 第 5 case 显式断言旧约束已消失)

- **F_POS_5: QNA 冻结决策被严格遵守**
  - Q13: `ended_reason` 作为列而非新状态值落地 (008 migration)
  - Q16: confirmation `status` 不含 `failed` (012 migration + test 显式断言)
  - Q18: confirmation `kind` 不含 `tool_cancel` (012 migration + test 显式断言)
  - Q3: `forwardInternalJsonShadow`/parity-bridge 完好保留 (grep 确认在 9 个文件中仍有引用)
  - Q4/Q5/Q6: 编号基线、checkpoint lineage 一次落表、correction law 模板全部到位

- **F_POS_6: 删除 `docs/runbook/zx2-rollback.md` 已执行**
  - `git status` 确认文件已物理删除

### 1.2 已确认的负面事实

- **F_NEG_1: `clients/api-docs/session.md` 严重过期**
  - 标题为 "Session, Models, Context, Files API — RHX2 Phase 6 Snapshot"
  - 第 66 行引用已不存在的模型 `"model_id": "gpt-5.4"` (当前 Workers AI 模型集不含此 ID)
  - `/start` 与 `/input` 路由未提及新增的 `model_id`/`reasoning` 字段
  - 路由表仍列出 coarse `/context`、`/context/snapshot`、`/context/compact` 三个 legacy 路径，未反映 HP3 将引入的 `probe/layers/preview/compact/jobs/{id}` 五面路由
  - **不影响 HP0-HP1 自身正确性** (charter §7 明确文档更新在 HP9)，但在 HP2-HP8 长达 7 个 phase 的执行窗口内，早于代码查阅 `clients/api-docs/` 的开发者会被过期内容误导

- **F_NEG_2: `nano_models.base_instructions_suffix` 列存在但值为 NULL**
  - HP1 closure §2 P1 正确登记为 "column-exists-only"，expires-at 设为 HP2 closure
  - HP0 的 `withNanoAgentSystemPrompt(modelId?)` seam 已开但 `void modelId` 占位，未读取 D1
  - 这意味着在 HP2 完成之前，model-aware system prompt suffix 功能处于"两端都有接缝但中间未连线"的悬挂状态——不影响正确性但需要在 HP2 closure 中被显式回填

- **F_NEG_3: `clients/api-docs/` 11 份文档中无一提到 HP1 新增表**
  - `todos`、`confirmations`、`checkpoints`、`workspace temp files` 等 HP6-HP7 关键能力在文档中完全缺失
  - 同样属于 HP9 文档冻结前的正常滞后 (charter §7.10 明确 HP9 新增 7 份文档)，但可能在 HP3-HP8 执行期间造成"接口存在但无文档"的开发者体验问题

- **F_NEG_4: `session-lifecycle.ts` 的 `parseModelOptions()` 返回类型在 TypeScript 层面存在微妙的 exactness 风险**
  - 使用展开语法 `{ ok: true, ...(modelId ? { model_id: modelId } : {}) }` 导致 TypeScript 推断的类型可能不包含 `model_id` 字段——虽然是 optional，但在严格模式下可能引起消费端类型窄化问题
  - 当前测试全部通过，未暴露此风险

- **F_NEG_5: HP0 closure §7 测试矩阵数字在 HP1 合并后已过期**
  - HP0 closure 写 "20 files / 179 tests pass"，但合并 HP1 后 orchestrator-core 实际为 "21 files / 196 tests pass"
  - HP1 closure §9.7 正确记录了新数字，但 HP0 closure 作为已 frozen 文档不会更新——建议在 HP1 closure 中文档化此漂移

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐文件逐行审查了全部 HP0 代码变更和 HP1 migration SQL |
| 本地命令 / 测试 | yes | 执行了 orchestrator-core + agent-core 的 typecheck/build/test 全量命令，结果全绿 |
| schema / contract 反向校验 | yes | 用 `PRAGMA table_info` / `index_list` / `index_info` + `sqlite_master.sql` 逐表逐 index/enum 验证了 007-013 全部 migration |
| live / deploy / preview 证据 | no | prod migration apply 留 HP9 (per charter §7.2 Out-of-Scope) |
| 与上游 design / QNA 对账 | yes | 逐项核对了 HP0/HP1 closure 与 action-plan §9 实施回填中引用的 Q 编号 |
| grep / 代码考古 | yes | 对 `forwardInternalJsonShadow`、parity-bridge、runbook 路径做了全仓 grep |

---

## 2. 审查发现

> 使用稳定编号：`R1 / R2 / R3 ...`。
> 每条 finding 都应包含：严重级别、类型、事实依据、为什么重要、审查判断、建议修法。

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | `clients/api-docs/session.md` 严重过期 (含 gpt-5.4 等 obsolete 内容) | high | docs-gap | no | HP9 启动前在此文件头部追加过期警告注释 |
| R2 | `nano_models.base_instructions_suffix` column-ready 但 NULL — HP0 seam 与 HP1 column 两端未连线 | high | delivery-gap | no | HP2 closure 必须显式 clear-partial HP0/P1 并记录接线证据 |
| R3 | `parseModelOptions` 返回类型在 strict TS 下存在 exactness 风险 | medium | correctness | no | 建议将 `ParseModelOptionsResult` 改为 explicit tagged union 而非展开语法 |
| R4 | `clients/api-docs/` 11 份文档无 HP1 新增表引用 — 开发者体验 gap | medium | docs-gap | no | HP9 启动时优先补新增表文档；HP2-HP8 之间可在 design doc 中提供临时 API 参考 |
| R5 | HP0 closure §7 测试矩阵数字在 HP1 合并后已过期 | low | docs-gap | no | HP1 closure §8 增加"HP0 基线数字回标"行 |
| R6 | `model_id` (snake_case body) vs `modelId` (camelCase seam) 命名不一致 | medium | scope-drift | no | HP2 design 中明确"两种命名风格并存但语义一致"的约定 |
| R7 | Charter 仍 4 处引用已删除的 `docs/runbook/zx2-rollback.md` | low | docs-gap | no | HP10 final closure 时将 charter 中过期 runbook 引用标记为 stale |
| R8 | `handleInput` 路径不校验 model_id 有效性 (委托给 handleMessages) — 语义正确但缺文档化 | low | docs-gap | no | session-flow.ts handleInput 增加注释说明委托语义 |
| R9 | 009 rebuild 的 `INSERT OR IGNORE` 可能在幂等重跑时静默丢失数据 | medium | correctness | no | 增加幂等 guard (检查 `turns_new` 表不存在时才执行 rebuild) |
| R10 | HP1 closure §7.4 cleanup scope 分工声明无测试验证 — HP6/HP7 才能证明 | low | test-gap | no | 在 HP6/HP7 design doc 中引用此约束，在 closure 中回填验证 |

### R1. `clients/api-docs/session.md` 严重过期 (含 gpt-5.4 等 obsolete 内容)

- **严重级别**: `high`
- **类型**: `docs-gap`
- **是否 blocker**: `no` (charter 明确文档更新在 HP9，此发现不影响 HP2 启动)
- **事实依据**:
  - `clients/api-docs/session.md:1` — 标题 "Session, Models, Context, Files API — RHX2 Phase 6 Snapshot"
  - `clients/api-docs/session.md:66` — 示例模型 ID 为 `"gpt-5.4"`，该模型在当前 Workers AI 模型集中不存在
  - `clients/api-docs/session.md:12-13` — `/start` 和 `/input` 路由说明为 "legacy"，未提新增的 `model_id`/`reasoning` 可选字段
  - `clients/api-docs/session.md:22-24` — 三个 coarse context 路由未反映 HP3 将引入的五面路由
  - 当前代码中 `/start` 和 `/input` 已接受 `model_id`/`reasoning` (session-lifecycle.ts:58-59, 69-70)，文档完全未反映这一变更
- **为什么重要**:
  - 在 HP9 启动前 (HP2-HP8 共 7 个 phase)，任何查阅 `clients/api-docs/` 了解当前 API 的开发者都会被严重误导：
    - 以为 `/start`/`/input` 不支持 `model_id`
    - 以为 `gpt-5.4` 是一个可用模型
  - 虽然 charter 明确文档更新在 HP9，但 HP0 的 In-Scope 变更已经改变了 `/start`/`/input` 的 body contract——这是一个 public API surface change，不应在文档中保持 7 个 phase 的"沉默期"
- **审查判断**:
  - 这不是 HP0-HP1 的实施缺陷，而是 charter 确定的"文档晚期收口"策略在首个 public API change 落地时暴露出的执行侧 gap。
  - 最小代价的缓解是在过期文档头部增加过期警告注释，并在 HP2-HP8 各 phase design doc 中提供临时的 API shape 参考。
- **建议修法**:
  - 在 `clients/api-docs/session.md` 第 1 行 (标题行) 之后追加注释块:
    ```
    > **⚠️ 注意**: 本文档为 RHX2 阶段快照，已不反映当前 API surface。HP0 (2026-04-30) 已为 `/start` 和 `/input` 新增可选字段 `model_id` / `reasoning`。完整 API 文档将在 HP9 阶段 (hero-to-pro 末期) 统一更新。过渡期间请参阅各 phase design doc 或直接对照 `workers/orchestrator-core/src/session-lifecycle.ts` 中的 `StartSessionBody` / `FollowupBody` 接口定义。
    ```
  - 在 HP2-HP7 各 phase design doc 的 API 变更部分中，显式声明"本 phase 新增/public facing endpoint family"的临时 shape 参考

### R2. `nano_models.base_instructions_suffix` column-ready 但 NULL — HP0 seam 与 HP1 column 两端未连线

- **严重级别**: `high`
- **类型**: `delivery-gap`
- **是否 blocker**: `no` (这是 by-design partial，HP2 预期完成连线)
- **事实依据**:
  - `workers/agent-core/src/host/runtime-mainline.ts:179` — `void modelId;` (HP0 seam 仅占位)
  - `workers/orchestrator-core/migrations/007-model-metadata-and-aliases.sql` — `base_instructions_suffix` 列存在但 seed 为 NULL
  - `docs/issue/hero-to-pro/HP0-closure.md §2` — P1 登记为 "seam-only"，expires-at: HP1 closure
  - `docs/issue/hero-to-pro/HP1-closure.md §2` — P2 登记为 "column-ready-not-wired"，expires-at: HP2 closure
  - Q2 原文 (HPX-qna.md): "`withNanoAgentSystemPrompt(modelId?)` 允许先 partial，但必须带 expires-at: HP1 closure"
- **为什么重要**:
  - HP0 closure 的 expires-at 是 "HP1 closure"，但 HP1 未完成连线，HP1 closure 将 expires-at 重设为 "HP2 closure"。
  - 这个"expires-at 漂移"在逻辑上是合理的 (HP1 只负责 column 落地，HP2 负责 model state machine 运行时连线)，但在文档链上构成 "HP0 说我到 HP1 就该完成了，HP1 说我没完成继续等 HP2" 的追踪漂移。
  - 如果 HP2 也未完成连线 (例如 HP2 因其他原因不得不 focus 模型切换而降低 suffix 优先级)，partial 会再次漂移到 HP3+。
- **审查判断**:
  - HP0 closure → HP1 closure 的 expires-at 漂移是合理但需要被显式记录的。
  - 当前 HP1 closure §2 P2 将 expires-at 设为 HP2 closure 是正确的，但应在同一行增加 "clear-partial: HP0/P1 (originally expires-at HP1 closure)" 以建立完整追踪链。
- **建议修法**:
  - HP1 closure §2 P2: 在说明栏增加 "HP0/P1 expires-at 已重设为 HP2 closure; HP2 完成连线时须同时 clear HP0/P1 和 HP1/P2 两个 partial"
  - HP2 closure: 增加 "clear-partial: HP0/P1 + HP1/P2" 条目作为 resolved 项

### R3. `parseModelOptions` 返回类型在 strict TS 下存在 exactness 风险

- **严重级别**: `medium`
- **类型**: `correctness`
- **是否 blocker**: `no`
- **事实依据**:
  - `workers/orchestrator-core/src/session-lifecycle.ts:79-81` — `ParseModelOptionsResult` 定义:
    ```typescript
    | { readonly ok: true; readonly model_id?: string; readonly reasoning?: ReasoningOptions }
    | { readonly ok: false; readonly response: Response }
    ```
  - `workers/orchestrator-core/src/session-lifecycle.ts:127-129` — 返回使用展开语法:
    ```typescript
    return {
      ok: true,
      ...(modelId !== undefined ? { model_id: modelId } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
    };
    ```
  - 当 `model_id` 存在且 `reasoning` 不存在时，TypeScript 可能无法窄化 `reasoning` 的类型——因为展开语法在编译时无法表达精确的运行时形态
- **为什么重要**:
  - 当前消费端 (session-flow.ts:246, 371-372) 使用 `modelOptions.model_id` 和 `modelOptions.reasoning` 是可选的，编译通过无问题。
  - 但如果未来某个 consumer 在 `modelOptions.ok === true` 分支内假定 `modelOptions.model_id` 一定存在 (而非 optional)，TypeScript 不会报错——因为 union 的 `ok: true` 侧标记了 `model_id?: string` (optional)。
  - 这可能导致 runtime undefined check 被省略。
- **审查判断**:
  - 当前所有调用点 (session-flow.ts + message-runtime.ts) 都正确使用了 optional check，无运行时风险。
  - 这是一个防御性改进建议——可以在 HP2 或后续 refactor 中处理，不阻塞 HP0-HP1。
- **建议修法**:
  - 将 `ParseModelOptionsResult` 的 `ok: true` 分支改为不带 optional 字段的精确 return type:
    ```typescript
    export type ParseModelOptionsResult =
      | { readonly ok: true; readonly model_id: string; readonly reasoning: ReasoningOptions }
      | { readonly ok: true; readonly model_id: string }
      | { readonly ok: true; readonly reasoning: ReasoningOptions }
      | { readonly ok: true }  // neither model_id nor reasoning
      | { readonly ok: false; readonly response: Response };
    ```
    或者保持当前定义不变但在消费端增加运行时 assertion。

### R4. `clients/api-docs/` 11 份文档无 HP1 新增表引用 — 开发者体验 gap

- **严重级别**: `medium`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - HP1 新增了 8 张产品表 (nano_model_aliases, nano_session_todos, nano_session_temp_files, nano_session_confirmations, nano_session_checkpoints, nano_checkpoint_file_snapshots, nano_checkpoint_restore_jobs, nano_workspace_cleanup_jobs)
  - `clients/api-docs/` 中没有任何文档引用这些表或对应的 API endpoint (todos/confirmations/checkpoints 的 7 份新文档将在 HP9 创建)
  - `docs/architecture/hero-to-pro-schema.md` 已作为内部参考存在，但不在客户端文档路径中
- **为什么重要**:
  - 在 HP5-HP7 实现 confirmation/workspace/checkpoint 端点时，开发者可能需要查阅 API design 而不想读 SQL schema——但客户端文档路径中没有任何参考。
  - 这与 R1 不同：R1 是过期内容误导，R4 是内容缺失。
- **审查判断**:
  - 这是 charter 文档晚期收口策略 (HP9) 的自然结果，不是 HP0-HP1 实施缺陷。
  - 缓解措施：在 `clients/api-docs/README.md` 中增加 "HP1-HP8 过渡期" 说明段，并链接到 `docs/architecture/hero-to-pro-schema.md` 作为临时参考。
- **建议修法**:
  - `clients/api-docs/README.md`: 在现有内容顶部增加过渡期说明块，链接到 `docs/architecture/hero-to-pro-schema.md` 和 `docs/design/hero-to-pro/` 目录

### R5. HP0 closure §7 测试矩阵数字在 HP1 合并后已过期

- **严重级别**: `low`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `docs/issue/hero-to-pro/HP0-closure.md §7`: 写 "orchestrator-core: 20 files / 179 tests pass"
  - 当前实际: orchestrator-core: 21 files / 196 tests pass (HP1 新增 1 file / 17 tests)
  - HP1 closure §9.7 正确记录了新数字
- **为什么重要**:
  - HP0 closure 已标注 `frozen`，不再更新。后续 phase 或 reviewer 读取 HP0 closure §7 时会得到过期数据。
- **审查判断**:
  - HP1 closure §9.7 的正确数字可作为 authoritative reference。
  - 可在 HP1 closure §8 中增加一行 "HP0 基线回标" 来显式文档化此漂移。
- **建议修法**:
  - HP1 closure §8: 增加一行 "HP0 baseline: 20 files / 179 tests (HP0 closure §7); post-HP1: 21 files / 196 tests"

### R6. `model_id` (snake_case body) vs `modelId` (camelCase seam) 命名不一致

- **严重级别**: `medium`
- **类型**: `scope-drift`
- **是否 blocker**: `no`
- **事实依据**:
  - `parseModelOptions()` 使用 `model_id` (snake_case，来自 HTTP body / NACP 协议层)
  - `withNanoAgentSystemPrompt(messages, modelId?)` 使用 `modelId` (camelCase，JS 内部规范)
  - HP0 closure §9: "HP1 接线时若需要重命名 modelId → model_id，必须同步修调用点+单测"
  - HP1 未处理此问题 (HP1 不涉及 agent-core 业务逻辑)
- **为什么重要**:
  - 同一概念在两个相邻函数中使用不同命名风格，增加了 HP2 实施者的认知负担。
  - HP2 需要同时消费 `parseModelOptions().model_id` (orchestrator-core) 和 `withNanoAgentSystemPrompt(messages, modelId)` (agent-core)，两个 worker 之间通过 service binding 时字段名的映射关系必须被正确文档化。
- **审查判断**:
  - 这不是 bug——`model_id` 是协议层 snake_case，`modelId` 是 JS 内部 camelCase，历史的 tech-debt 而非 HP0-HP1 引入。
  - 但 HP2 design doc 必须明确这个映射关系的约定。
- **建议修法**:
  - HP2 design doc 中增加 "Naming convention note: model_id (NACP protocol body / D1 column) vs modelId (JS internal) — both refer to the same concept, mapping happens at the worker boundary"
  - 不要求在 HP0-HP1 中重命名 (会破坏 backward compat)

### R7. Charter 仍 4 处引用已删除的 `docs/runbook/zx2-rollback.md`

- **严重级别**: `low`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `docs/charter/plan-hero-to-pro.md:265` — "`runbook/zx2-rollback.md` 物理删除"
  - `docs/charter/plan-hero-to-pro.md:366` — "`runbook/zx2-rollback.md` 物理删除(archive 日期 2026-05-12 已过,G97)"
  - `docs/charter/plan-hero-to-pro.md:390` — "`runbook/zx2-rollback.md` archive 物理删除 PR"
  - `docs/charter/plan-hero-to-pro.md:398` — "runbook archive 物理删除验证(`docs/runbook/zx2-rollback.md` 不存在)"
  - 文件已物理删除 (实际路径 `docs/runbook/zx2-rollback.md`)
  - 注：charter 中 4 处引用使用了不同路径格式——前 3 处是 `runbook/zx2-rollback.md`，第 4 处是 `docs/runbook/zx2-rollback.md`
- **为什么重要**:
  - Charter 中 4 处引用的陈述在文件删除后仍然成立 (描述的是"应当删除"的意图，文件确已删除)，因此不构成内容错误。
  - 但这意味着 charter 中的 HP0 In-Scope 描述无法被"文件是否存在"这种简单 check 验证——读者需要知道这条引用是历史性的。
- **审查判断**:
  - 不需要修改。Charter 中这些引用描述的是 HP0 的 In-Scope 意图 (应当做什么)，而非当前 reality (是否已完成)。HP0 closure 已记录文件删除。HP10 final closure 时可以统一标记 charter 中已完成的 In-Scope 项。
- **建议修法**:
  - HP10 final closure 中增加 "charter stale reference checklist"，标记 charter 中哪些 In-Scope 声明已完成的 phase。

### R8. `handleInput` 路径不校验 model_id 有效性 — 语义正确但缺文档化

- **严重级别**: `low`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `workers/orchestrator-core/src/user-do/session-flow.ts:469-480` — handleInput 中 model_id/reasoning 直接展开到 messagesBody，校验权委托给 handleMessages
  - `/start` 路径 (session-flow.ts:238-248) 做了显式的 parseModelOptions + requireAllowedModel gate
  - `/input` 路径不做 gate 的原因是：`/input` 本质上是 `/messages` 的简化入口，校验逻辑应由 `/messages` 的单一 law 负责
- **为什么重要**:
  - 这个设计决策 (委托而非重复校验) 是正确的，但当前代码只有 HP0 注释 "把校验权交给 handleMessages" 说明，未解释为什么 `/start` 需要自己做 gate 而 `/input` 不需要。
  - 两者的区别是：`/start` 的 model_id 会影响 session default，需要 early gate；`/input` 只影响当前 turn，与 `/messages` 等价，委托即可。
- **审查判断**:
  - 逻辑正确。增加注释即可。
- **建议修法**:
  - session-flow.ts handleInput 附近增加注释："`/input` 与 `/messages` 共享同一 turn-level 模型校验法律——此处不重复 gate，由 handleMessages 中的 parseModelOptions/requireAllowedModel 统一处理。相比之下，`/start` 需要 early gate 因为 model_id 可能被写为 session default。"

### R9. 009 rebuild 的 `INSERT OR IGNORE` 可能在幂等重跑时静默丢失数据

- **严重级别**: `medium`
- **类型**: `correctness`
- **是否 blocker**: `no`
- **事实依据**:
  - `workers/orchestrator-core/migrations/009-turn-attempt-and-message-supersede.sql:58-69` — `INSERT OR IGNORE INTO nano_conversation_turns_new (...) SELECT ... FROM nano_conversation_turns`
  - 009 migration 的 comment (line 25-30) 说明 "When the new table is already in place (re-run on a freshly applied DB), the rebuild is a no-op because nano_conversation_turns_new does not exist"
  - 这意味着迁移的幂等性依赖于 `CREATE TABLE IF NOT EXISTS` guard
- **为什么重要**:
  - `CREATE TABLE IF NOT EXISTS` + `INSERT OR IGNORE` + `DROP TABLE` + `RENAME` 的模式确实提供了幂等性，但有一个微妙的时序风险：
    - 如果迁移在 `DROP TABLE nano_conversation_turns` 之后、`RENAME` 之前中断，数据库将处于 `turns_new` 存在但 `turns` 已被删除的状态
    - 重新运行迁移时，`CREATE TABLE IF NOT EXISTS nano_conversation_turns_new` 将跳过创建 (因为 turns_new 已存在)，然后尝试 `INSERT ... FROM nano_conversation_turns`，但 `nano_conversation_turns` 不存在 → SQL error
  - 这是一个极低概率的时序故障场景 (仅发生在 migration 中场 crash)，但 Oracle 迁移的最佳实践要求防御它。
- **审查判断**:
  - 在 D1 / SQLite 的本地 apply 环境中 (`:memory:` 或本地文件 DB)，这种 crash-between-statements 场景极为罕见。
  - 当前 schema-freeze 测试 17 个 case 全绿，证明迁移在完整 apply 路径下正确。
  - 不需要在当前阶段新增 guard (会增加 migration 复杂性)，但建议在 migration 的注释中注明此限制。
- **建议修法**:
  - 在 009 migration 的注释中增加一行："幂等性假设：此迁移在事务中执行 (D1 默认每条 migration 一个隐式事务)。若事务在 DROP 后 RENAME 前中断，需手动重建。这种场景在单 D1 apply 中极罕见，无须额外 guard。"

### R10. HP1 closure §7.4 cleanup scope 分工声明无测试验证

- **严重级别**: `low`
- **类型**: `test-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `docs/issue/hero-to-pro/HP1-closure.md §7.4` — 声明 "`session_end` 与 `explicit` 由 HP6 写入，`checkpoint_ttl` 由 HP7 cron 写入"
  - 这是 scope 分工的 cross-phase 约束，但 HP1 的 schema-freeze test 只验证了表结构和 enum 值的存在性，未验证任何 phase 真的遵守了这个分工
- **为什么重要**:
  - 如果 HP6 在其执行中错误地写入了 `checkpoint_ttl` scope (应该只属于 HP7)，HP1 的 closure/test 不会捕获这个错误。
  - 这是一个 cross-phase contract，只能由 HP6 和 HP7 的各自 closure 中的测试来验证。
- **审查判断**:
  - 当前无实际风险——HP6/HP7 尚未实现。HP1 的声明是 front-running constraint，提供了 HP6/HP7 必须遵守的规则。
  - 但在 HP6/HP7 closure 中增加对此约束的测试验证是必需的。
- **建议修法**:
  - 在 HP6 design doc 中引用 HP1 closure §7.4 作为 schema 消费约束
  - 在 HP6/HP7 closure 中增加 "cleanup_jobs scope 遵守 HP1 §7.4 分工" 的测试证据

---

## 3. In-Scope 逐项对齐审核

> 对照 HP0-action-plan §3 业务工作总表 + HP1-action-plan §3 业务工作总表，逐项审核实施完成度。

### 3.1 HP0 In-Scope 对齐

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P1-01 | residue baseline + closure skeleton | `done` | HP0-closure.md 已冻结，§3 retained 3 项 (K1-K3)，§2 partial 1 项 (P1) |
| P2-01 | `StartSessionBody` / `FollowupBody` 类型补齐 | `done` | session-lifecycle.ts:58-59, 69-70 已加 `model_id?` / `reasoning?`；与 nacp-session 协议层对齐 |
| P2-02 | `/start` / `/input` 透传对齐到 `/messages` law | `done` | handleStart 走 parseModelOptions + requireAllowedModel gate + 透传；handleInput 透传 + 委托 handleMessages；3 个回归 test 绿 |
| P3-01 | `withNanoAgentSystemPrompt(modelId?)` seam | `partial` | 函数签名已加 `modelId?` 并 export；HP0 不读 D1, void modelId 占位；expires-at 已登记为 HP1 closure (但 HP1 未完成连线，漂移到 HP2) |
| P4-01 | binding-presence verify | `done` | binding-presence.test.ts 新增 6 cases + 全绿；CONTEXT_CORE / LANE_E_RPC_FIRST verify-only |
| P4-02 | 删除过期 rollback runbook | `done` | `docs/runbook/zx2-rollback.md` 已物理删除 |
| P4-03 | conditional lockfile drift cleanup | `not-needed` | 13 个 importer key 全部对应工作树目录，无 stale drift |
| P5-01 | HP0 closure + residue handoff | `done` | HP0-closure.md 10 段 frozen；handoff 表列出 HP1/HP8-B/HP10 去向 |

### 3.2 HP1 In-Scope 对齐

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P1-01 | freeze doc alignment | `done` | Charter + HP1 design + closure 三处已同步 Q4/Q5/Q6/Q13/Q16/Q18 派生规则 |
| P1-02 | consumer map scaffolding | `done` | HP1 closure §7 逐表逐 phase 列出 consumer 映射 (007-013 → HP2-HP9) |
| P2-01 | `007-model-metadata-and-aliases.sql` | `done` | 10 列 + alias 表 + 4 seed；schema-freeze test 断言通过 |
| P2-02 | `008-session-model-audit.sql` | `done` | session default + turn audit + ended_reason；test 断言通过 |
| P2-03 | `009-turn-attempt-and-message-supersede.sql` | `done` | rebuild 保留 008 列；UNIQUE 三列约束；message supersede；conversation tombstone；test 断言通过 |
| P3-01 | `010-agentic-loop-todos.sql` | `done` | 5 status enum + 完整字段集；test 断言通过 |
| P3-02 | `011-session-temp-files-and-provenance.sql` | `done` | temp_files (含 cleanup_status/written_by/enum) + artifacts provenance 三列；test 断言通过 |
| P3-03 | `012-session-confirmations.sql` | `done` | 7 kinds / 6 statuses；无 failed / 无 tool_cancel；test 显式断言通过 |
| P4-01 | `013-product-checkpoints.sql` | `done` | 四表全部落地；nano_compact_jobs 不存在 (复用 compact_boundary)；test 断言通过 |
| P5-01 | local apply + schema assertions | `done` | node:sqlite 顺序 apply 001→013；17 项 introspect 全绿 |
| P5-02 | schema doc + closure + correction registry | `done` | hero-to-pro-schema.md + HP1-closure.md + correction law 模板 |

### 3.3 对齐结论

- **done**: `17`
- **partial**: `1` (HP0 P3-01: seam 已开但不读 D1，expires-at 漂移到 HP2)
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `1` (HP0 P4-03: conditional lockfile cleanup → not-needed)

> HP0-HP1 的全部 In-Scope 项实际覆盖率为 **18/19 = 95%**，唯一 partial 项 (system prompt seam) 是设计级 partial，expires-at 已在 HP1 closure 中重设为 HP2 closure。

---

## 4. Out-of-Scope 核查

> 本节用于检查实现是否越界，也用于确认 reviewer 是否把已冻结的 deferred 项误判为 blocker。

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| HP0-O1 | 新 D1 schema 变更 | `遵守` | HP0 无任何 migration 变更 |
| HP0-O2 | 修改 wrangler.jsonc | `遵守` | binding-presence.test.ts 只读不写；wrangler 未触碰 |
| HP0-O3 | 删除 forwardInternalJsonShadow / parity-bridge | `遵守` | 全仓 grep 确认均在 9 个文件中完好保留，仅命名残留 (forwardInternalJsonShadow method name preserved) |
| HP0-O4 | 客户端文档更新 | `遵守` | clients/api-docs/ 未触碰 |
| HP1-O1 | remote/prod D1 apply | `遵守` | HP1 closure §2 P3 登记为 "local-only"，expires-at: HP9 |
| HP1-O2 | HP2-HP7 业务逻辑 | `遵守` | HP1 仅 SQL + test + docs，无 runtime 代码 |
| HP1-O3 | `014+` 普通 migration 空间 | `遵守` | HP1 closure §3.5 明确 "014+ 文件不存在，correction 数 = 0" |
| HP1-O4 | confirmation kind 扩张 / 新 session close state | `遵守` | 012 CHECK 仅含 7 kinds / 6 statuses；migration-header 明确 "HP5 must NOT extend without §3 correction" |
| F1-F17 | 不属于 HP0-HP1 范围的 chronic items | `遵守` | HP0 closure §5 + HP1 closure §5 逐项标注 `closed` / `partial` / `not-touched` / `schema-ready-by-HP1`，无 silent inherit |

> **Out-of-Scope 核查结论: 零违规。** HP0-HP1 严格遵守了 charter 的全部 Out-of-Scope 边界，未发现 scope creep。

---

## 5. 跨阶段跨包深度分析

### 5.1 Schema Consumer Map 自洽性验证

HP1 closure §7 的 consumer map 逐表逐列映射了 HP2-HP9 的消费关系。审查逐项核对了 23 条映射：

- **007 → HP2/HP3/HP5/HP9**: 10 列映射正确。`max_output_tokens` 归属于 HP2 (LLM 调用上限)，`auto_compact_token_limit` 归属于 HP3，`fallback_model_id` 同时归属于 HP2 (fallback) 和 HP5 (confirmation)。唯一可能的遗漏：`provider_key` 的 HP9 consumer (usage events join) 是正确的——因为只有到 HP9 才涉及 prod schema baseline，usage event 的 provider 列需要此字段。
- **008 → HP2/HP4/HP7**: `requested_model_id` 同时被 HP2 (fallback audit)、HP4 (replay)、HP7 (restore target) 消费，三重消费者正确。
- **009 → HP4/HP7**: `deleted_at` 仅列 HP4 为 consumer——但 HP7 的 fork/restore 逻辑也需要知道一个 conversation 是否已被 tombstoned，否则可能 restore 一个已删除的 conversation。**这是一个 consumer map 可能遗漏的交叉引用。** 建议在 HP7 design doc 中显式确认是否需要消费 `deleted_at`。
- **010-013 → HP5/HP6/HP7/HP8**: 映射正确。`nano_workspace_cleanup_jobs.scope` 的三值分工 (session_end/explicit → HP6, checkpoint_ttl → HP7) 在 HP1 closure §7.4 中明确锁定。

### 5.2 命名一致性审查

| 概念 | D1 column | NACP body | JS internal | 一致性 |
|------|-----------|-----------|-------------|--------|
| 模型标识 | `model_id` (snake_case) | `model_id` (snake_case) | `modelId` (camelCase) | ⚠️ JS-D1 命名不一致，需 HP2 文档化 |
| reasoning effort | `reasoning_effort` | `reasoning.effort` | `reasoning.effort` | ✅ 内层一致 |
| turn attempt | `turn_attempt` | n/a | n/a | ✅ |
| confirmation kind | `kind` (ENUM CHECK) | `kind` | `kind` | ✅ |
| ended reason | `ended_reason` | n/a | n/a | ✅ |
| virtual path | `virtual_path` | `virtual_path` | `virtualPath` | ⚠️ 与 model_id 相同，JS camelCase 与 D1 snake_case 不一致——这是已有命名惯例 |

> 命名不一致不是 HP0-HP1 引入的缺陷——这是仓库历史上 NACP 协议层 snake_case 与 JS 运行层 camelCase 之间的系统性惯例。HP0-HP1 未引入新的不一致。

### 5.3 盲点分析

| 盲点 | 描述 | 影响评估 |
|------|------|----------|
| `ended_reason` 列类型为 TEXT 无 CHECK 约束 | 008 将 `ended_reason` 定义为 TEXT 自由格式 (migration comment "Q13: free-form reason str; HP4 enumerates app-side")，无 enum CHECK。这在 schema 层面是正确的——让 HP4 的应用层控制 enum 值集，避免 SQLite 的 CHECK 约束在 HP4 需要新增 reason 时被迫走 correction。| 低——这是设计选择，不是遗漏 |
| `nano_models` JSON 列无 schema 校验 | `supported_reasoning_levels` 和 `input_modalities` 为 TEXT 存储 JSON，SQLite 不强制 JSON 格式。HP2 的应用层必须严格校验。 | 低——charter §7.2 风险提醒已识别此问题 |
| HP2 启动时 session/turn 的 008 审计列全 NULL | 007-013 migration 新增的所有列 (default_model_id, effective_model_id 等) 在老行中均为 NULL。HP2 需要决定首次写入时的 backfill 策略。 | 中——HP2 design 必须包含 backfill 策略 |
| `nano_model_aliases` 的 4 seed 引用的 target model_id 可能不是当前 D1 中最优选择 | seed 中的 `@alias/fast` 指向 `@cf/meta/llama-3.2-3b-instruct`——如果 HP2 执行时 Workers AI 目录已有更快的模型，这个 seed 可能需要不同值。但 charter 声明 "具体模型条数以仓库 003-usage-quota-and-models.sql 现有 seed 与 owner 决议为准"，说明更新 alias target 不需要 migration，可以通过 HP2 runtime UPDATE 完成。 | 低——alias 表设计允许不通过 migration 更新 |

### 5.4 断点分析

| 断点 | 描述 | 影响 phase |
|------|------|-------------|
| HP0 partial → HP2 | `withNanoAgentSystemPrompt(modelId?)` seam + `base_instructions_suffix` column 需 HP2 连线 | HP2 |
| HP1 column-only → HP2 | `nano_models` 10 列全 NULL 需 HP2 回填真值 | HP2 |
| HP1 DDL freeze → HP3 | context compact/jobs/{id} 复用 `compact_boundary` checkpoint handle——若 HP3 发现不足，需走 HP1 §3 correction | HP3 |
| HP1 schema → HP4 | `nano_conversation_turns` rebuild 后旧 UNIQUE 消失——HP4 retry 逻辑必须使用新的三列约束 | HP4 |
| HP1 DDL freeze → HP6 | `nano_session_temp_files.expires_at` + `cleanup_status` 需 HP6 写入策略 | HP6 |
| HP1 DDL freeze → HP9 | prod apply 007-013 是 owner-action，HP9 baseline 验证时若漂移需补救 migration | HP9 |

> 这些断点都是 design-level (需要后续 phase 消费 HP1 truth)，不是 implementation gap (HP1 实现了错误或遗漏的 schema)。HP1 closure §6 的 handoff 表已列出了每个断点的交接物与形式。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**: `HP0-HP1 的实施达到了 hero-to-pro 阶段首批两个 phase 的全部目标。代码质量高、测试覆盖充分、闭包文档严密、QNA 冻结决策被严格遵守。10 项审查发现中 0 项为 blocker，HP2 可以安全地从 HP0-HP1 基线启动。`

- **是否允许关闭本轮 review**: `yes`

- **关闭前必须完成的 blocker**:
  - **无。**

- **建议在执行前处理的 high-priority follow-up** (HP2 启动后 / HP9 启动前):
  1. **R1**: 在 `clients/api-docs/session.md` 头部追加过期警告注释，提醒开发者在 HP9 完整文档更新前注意事项
  2. **R2**: HP1 closure §2 P2 增加 "HP0/P1 expires-at 已重设为 HP2 closure" 追踪记录；HP2 closure 增加 clear-partial 条目

- **建议在 HP2-HP7 中处理的 medium-priority follow-up**:
  3. **R3**: HP2 中评估并修复 `parseModelOptions` 返回类型的 exactness 问题
  4. **R4**: `clients/api-docs/README.md` 增加过渡期说明
  5. **R6**: HP2 design doc 增加 model_id/modelId 命名约定声明
  6. **R9**: 009 migration 增加幂等性限制注释
  7. **R10**: HP6/HP7 closure 验证 cleanup_jobs scope 分工遵守 HP1 §7.4

- **建议在 HP10 中处理的 low-priority follow-up**:
  8. **R5**: HP1 closure §8 增加 HP0 基线数字回标
  9. **R7**: HP10 final closure 标记 charter 中 stale runbook 引用
  10. **R8**: session-flow.ts handleInput 增加委托语义注释

- **建议的二次审查方式**: `no rereview needed` — 如上述 follow-up 项在 HP2-HP10 各 phase closure 中被自然处理，无需针对 HP0-HP1 进行二次审查。

- **实现者回应入口**: `无` — 本审查不要求实现者额外回应。HP0-HP1 closure 已 frozen，后续 follow-up 由 HP2-HP10 的执行者和 reviewer 自然消费。

---

## 附录 A: 全量测试矩阵当前基线

| Worker/Package | 文件数 | 测试数 | 状态 | 备注 |
|----------------|--------|--------|------|------|
| `@haimang/orchestrator-core-worker` | 21 | 196 | ✅ | HP0 +6 (3 user-do + 6 binding) = +9; HP1 +17 = 196 total |
| `@haimang/agent-core-worker` | 102 | 1072 | ✅ | HP0 +3 system-prompt seam |
| `@haimang/nacp-session` | — | — | — | 未执行 (HP0 消费 schema 但未改代码) |
| `@haimang/nacp-core` | — | — | — | 未执行 (无变更) |

## 附录 B: 与上一轮 action-plan 审查发现的交叉验证

上一轮审查 (`docs/eval/hero-to-pro/action-plan-docs-reviewed-by-deepseek.md`) 识别了 7 项发现 (R1-R7)。本轮对照执行结果验证如下：

| 上轮发现 | 状态 | HP0-HP1 实施中是否被处理 |
|----------|------|--------------------------|
| R1: HP9 owner-action 硬闸缺少 contingency | `open` | 未处理 (HP9 尚未启动) |
| R2: HP1 Big Bang Migration 后 schema 缺陷修复成本高 | `partially-addressed` | HP1 closure §3 提供了完整的 correction law 模板 + 双签流程——降低了发现缺陷后的处理不确定性 |
| R3: `runbook/zx2-rollback.md` 路径引用漂移 | `closed` | 文件已从正确路径 `docs/runbook/zx2-rollback.md` 物理删除 |
| R4: HP5 仅 2/7 kind 真接线 — client 预期落差 | `open` | 未处理 (HP5 尚未启动) |
| R5: 缺少跨 phase 回归测试策略 | `open` | 未处理 (HP2-HP8 尚未启动) |
| R6: HP8/HP10 对 wrapper 文件的判断未经验证 | `open` | 未处理 (HP8 尚未启动) |
| R7: cross-e2e 编号冲突 | `open` | 未处理 (HP3-HP7 尚未启动) |

> 上轮 7 项发现中，1 项在 HP0-HP1 中被关闭 (R3)，1 项在 HP1 中被部分解决 (R2)，其余 5 项目前仍为 open——这些都需要在对应 phase (HP2-HP9) 中被跟踪处理。

## 附录 C: 代码变更 diff 统计

```
 docs/action-plan/hero-to-pro/HP0-action-plan.md               +120 (实施回填 §9)
 docs/action-plan/hero-to-pro/HP1-action-plan.md               +132 (实施回填 §9)
 docs/architecture/hero-to-pro-schema.md                       +321 (新建)
 docs/issue/hero-to-pro/HP0-closure.md                         +144 (新建)
 docs/issue/hero-to-pro/HP1-closure.md                         +240 (新建)
 docs/runbook/zx2-rollback.md                                  -155 (删除)
 workers/agent-core/src/host/runtime-mainline.ts                +16 (seam)
 workers/orchestrator-core/src/session-lifecycle.ts             +71 (types + shared validator)
 workers/orchestrator-core/src/user-do-runtime.ts                +1 (requireAllowedModel 注入)
 workers/orchestrator-core/src/user-do/message-runtime.ts       +5/-31 (重构到共享 validator)
 workers/orchestrator-core/src/user-do/session-flow.ts          +29 (透传 + gate)
 workers/orchestrator-core/test/user-do.test.ts                +145 (3 个 HP0 回归 case)
 workers/orchestrator-core/test/binding-presence.test.ts       +72 (6 个 verify-only case)
 workers/agent-core/test/host/system-prompt-seam.test.ts       +34 (3 个 seam case)
 workers/orchestrator-core/test/migrations-schema-freeze.test.ts +432 (17 个 schema-assertion case)
 workers/orchestrator-core/migrations/007-013/*.sql            +24000 (7 个 migration 文件)
 ───────────────────────────────────────────────────────────────
 总计: +1224/-186 (纯代码行); +24000 (migration SQL)
```
