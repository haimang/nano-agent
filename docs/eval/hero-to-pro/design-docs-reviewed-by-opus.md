# Nano-Agent 代码审查 — `hero-to-pro` 全套设计文档

> 审查对象: `docs/design/hero-to-pro/HP0-HP10 + HPX-qna(共 12 份)`
> 审查类型: `docs-review`(对所有 phase design doc 的设计审查)
> 审查时间: `2026-04-30`
> 审查人: `Claude Opus 4.7(独立第二轮 review,GPT-5.4 为初稿作者)`
> 审查范围:
> - `docs/design/hero-to-pro/HP0-pre-defer-fixes.md`
> - `docs/design/hero-to-pro/HP1-schema-extension.md`
> - `docs/design/hero-to-pro/HP2-model-state-machine.md`
> - `docs/design/hero-to-pro/HP3-context-state-machine.md`
> - `docs/design/hero-to-pro/HP4-chat-lifecycle.md`
> - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`
> - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`
> - `docs/design/hero-to-pro/HP7-checkpoint-revert.md`
> - `docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md`
> - `docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md`
> - `docs/design/hero-to-pro/HP10-final-closure-and-cleanup.md`
> - `docs/design/hero-to-pro/HPX-qna.md`(Q1-Q39)
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md`(v0.draft-r1,本阶段唯一基石文件)
> - `docs/eval/hero-to-pro/closing-thoughts-part-1-by-opus.md` / `closing-thoughts-part-2-by-opus.md`
> - 当前仓库 6-worker 真实代码(`workers/orchestrator-core/migrations/001-006`、`agent-core / orchestrator-core / context-core / filesystem-core / bash-core` 源码)
> - `context/codex` / `context/claude-code` / `context/gemini-cli` 三家 reference agent 源码
> 文档状态: `changes-requested`

---

## 0. 总结结论

> 12 份设计稿在结构、引用纪律、产品语义层面整体已成熟,但在 **HP1 schema 与 HP5/HP6/HP7 消费端 schema 之间存在系统性 schema 漂移**,以及 **HP3 compact job 在 HP1 schema 中无对应表**。这两个问题若不在 action-plan 启动前消除,DDL Freeze Gate(charter §4.4 + §8.3)在执行阶段必然破戒。

- **整体判断**:`12 份设计文件主体可作为 action-plan 输入,但 HP1 与下游 4 份 phase design 的 schema 一致性必须先 reconcile。`
- **结论等级**:`changes-requested`
- **是否允许关闭本轮 review**:`no`
- **本轮最关键的 1-3 个判断**:
  1. **R1 critical**:HP5 的 7-kind confirmation enum、HP6 的 todos/temp_files/cleanup_status 三组字段、HP7 的 checkpoint/file_snapshot/restore_job 三张表的字段集合,均与 charter §7.2 HP1 In-Scope 明显不一致。HP1 设计文件本身在 §7.2.F4 只列表名不列字段,等于把 schema 真相全部下放到 charter §7.2。一旦 HP1 action-plan 直接按 charter §7.2 落表,HP5/HP6/HP7 就会立刻发现自己的设计字段对不上 — 反之 HP5/HP6/HP7 自己设计的字段又突破了 HP1 freeze 边界。这是当前 12 份设计中 **唯一一个会让 charter §4.4 R8 受控例外路径在第一周就被触发** 的问题。
  2. **R2 critical**:HP3 In-Scope §S1/S6/F4 要求 `POST /sessions/{id}/context/compact` + `GET /jobs/{id}` durable job;HP3 §5.3 自承"compact job durable D1 必需",并在 §9.3 + HPX Q37 把"作为 HP3 collateral migration"作为条件题挂出。但 charter §7.2 + HP1 §7.1.1 ledger(`007-013`)中 **没有 compact_jobs 表**。这意味着 HP3 一启动就会撞到 R8 受控例外。建议在 HP1 启动前补进 `nano_compact_jobs`,而不是当作"HP3 collateral migration"风险项处理。
  3. **R3 high**:HP1 设计文件 §7.2.F1-F4 只列表名(`nano_models 扩列`、`nano_session_todos`、`nano_session_temp_files`、`nano_session_files provenance`、`nano_session_confirmations`、`nano_session_checkpoints + nano_checkpoint_file_snapshots + nano_checkpoint_restore_jobs + nano_workspace_cleanup_jobs`)以及 ledger 编号 `007-013`,但 **没有把字段集合直接写入设计**。当前完整字段集合只存在于 charter §7.2。这种"设计文件不携带 schema 真相,只指向 charter"的做法,是 HP6/HP7 schema 漂移的直接结构性诱因,也是后续 HP1 action-plan 编写时唯一可能继续滑动的环节。

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/charter/plan-hero-to-pro.md`(charter v0.draft-r1,authoritative)
  - `docs/eval/hero-to-pro/closing-thoughts-part-1-by-opus.md` / `closing-thoughts-part-2-by-opus.md`
  - `docs/templates/code-review.md`(本 review 输出格式)
- **核查实现**:
  - `workers/orchestrator-core/migrations/{001-006}.sql`(当前 baseline)
  - `workers/orchestrator-core/src/{index.ts, session-lifecycle.ts, user-do/session-flow.ts, user-do/message-runtime.ts, user-do-runtime.ts}`
  - `workers/agent-core/src/{host/runtime-mainline.ts, host/checkpoint.ts, host/do/session-do-runtime.ts, host/do/session-do-persistence.ts, hooks/dispatcher.ts, hooks/permission.ts, kernel/state.ts, kernel/types.ts, llm/canonical.ts, llm/request-builder.ts, llm/gateway.ts}`
  - `workers/context-core/src/index.ts`、`workers/filesystem-core/src/index.ts`、`workers/bash-core/src/index.ts`
  - `packages/{nacp-session/src/messages.ts, nacp-session/src/stream-event.ts, nacp-core/src/tenancy/scoped-io.ts, nacp-core/src/messages/tool.ts, nacp-core/src/rpc.ts, orchestrator-auth-contract/src/index.ts}`
  - `clients/api-docs/{README.md, session.md, permissions.md, usage.md, error-index.md}`
  - `test/cross-e2e/*`(15 个测试文件,无 permission/elicitation/usage round-trip)
  - `context/codex/codex-rs/{core/src/codex.rs, core/tests/suite/compact.rs, protocol/src/openai_models.rs, protocol/src/models.rs, app-server/src/codex_message_processor.rs}`
  - `context/claude-code/{server/directConnectManager.ts, utils/model/model.ts, query.ts, tools/AgentTool/forkSubagent.ts, constants/xml.ts}`
  - `context/gemini-cli/packages/{cli/src/ui/commands/modelCommand.ts, core/src/config/config.ts, core/src/services/modelConfigService.ts, core/src/services/chatRecordingService.ts, core/src/utils/checkpointUtils.ts, core/src/commands/restore.ts, cli/src/ui/commands/rewindCommand.tsx, core/src/config/storage.ts, core/src/context/contextManager.ts, core/src/context/contextCompressionService.ts, core/src/confirmation-bus/types.ts, core/src/confirmation-bus/message-bus.ts}`
- **执行过的验证**:
  - `wc -l` 各被引文件,核对引文行号在文件实际行数范围内
  - `grep -n` 关键 anchor symbol(`alarm`、`forwardInternalJsonShadow`、`pendingToolCalls`、`emitPermissionRequestAndAwait`、`awaitAsyncAnswer`、`model_switch`、`can_use_tool / control_request`、`未 live`)
  - `ls workers/orchestrator-core/migrations/`(确认 baseline 仅 `001-006`)
  - `ls clients/api-docs/`(确认现有 11 份)
  - `ls test/cross-e2e/`(确认无 15-permission-roundtrip-allow / 16-permission-roundtrip-deny / 17-elicitation-roundtrip / 18-usage-push-live)
  - 比对 charter §7.2 HP1 In-Scope schema 与 HP5/HP6/HP7 各设计文件中字段集合的 token-level diff
- **复用 / 对照的既有审查**:
  - `docs/charter/review/plan-hero-to-pro-reviewed-by-GPT.md`(R1-R9 已在 charter v0.draft-r1 中修订)— 本轮独立复核,仅在涉及 charter 与 design 一致性时引用,作为线索之一。

### 1.1 已确认的正面事实

- 12 份设计文档全部使用统一模板,章节编号、术语对齐表、precedent 引用方式、QNA 表等结构一致;HP0-HP10 的"实现目标 / In-Scope / Out-of-Scope / 边界清单 / Tradeoff / 风险 / 详细功能 / Value Verdict"段落齐备。
- 所有设计稿都遵守"precedent 只接受 `context/` 与当前仓库源码锚点,不再以二手 study markdown 作为 precedent"的纪律(见各 HP*.md §4 的开头)— 这是 RHX2 review 之后明确建立的规则,本轮 12 份均守约。
- 引文行号绝大多数有效:抽样核对 `workers/agent-core/src/host/do/session-do-runtime.ts:583` 确为 `async alarm()`、`workers/orchestrator-core/src/user-do-runtime.ts:753` 确为 `// Method name preserved (forwardInternalJsonShadow)` 注释、`workers/agent-core/src/kernel/state.ts:55` 确含 `pendingToolCalls`、`workers/agent-core/src/host/do/session-do-runtime.ts:376` 确为 `emitPermissionRequestAndAwait`、`clients/api-docs/permissions.md:18` 确含"WS round-trip 未 live"、`context/claude-code/server/directConnectManager.ts:82-83` 确含 `control_request` / `can_use_tool`。
- HP1 §7.1.1 `007-013 migration ledger` 与 charter §7.2 交付物列表一一对应(`007-model-metadata-and-aliases / 008-session-model-audit / 009-turn-attempt-and-message-supersede / 010-agentic-loop-todos / 011-session-temp-files-and-provenance / 012-session-confirmations / 013-product-checkpoints`),编号顺序、文件名都与 charter 一致;migrations baseline `001-006` 与仓库实际(已 `ls` 确认)严格一致。
- HP0 §1.2 / §7.2 / §9.1 准确指出当前代码事实:`/messages` 已支持 `model_id` / `reasoning`(`workers/orchestrator-core/src/user-do/message-runtime.ts:134-161`)而 `/start` `/input` 仍丢字段(`workers/orchestrator-core/src/user-do/session-flow.ts:342-347,445-454`),`CONTEXT_CORE` binding 与 `LANE_E_RPC_FIRST=false` 已在 wrangler 中存在,`forwardInternalJsonShadow` / `parity-bridge` 是历史 retention。这一组事实判断与 charter §1.2 R3 修订一致。
- HP3 §0 / §1.2 准确识别 context-core 三 RPC 仍是 `phase: "stub"`(`workers/context-core/src/index.ts`,实际 211 行,RPC 实现确为占位)、`compact.notify` 已是正式 stream kind(`packages/nacp-session/src/stream-event.ts`)。
- HP5 §0 / §1.2 准确识别现状:`emitPermissionRequestAndAwait` / `awaitAsyncAnswer` / `recordAsyncAnswer` 三件 round-trip primitive 已存在但 hook permission helper 为 fail-closed 同步路径(`workers/agent-core/src/hooks/permission.ts:31-70`)、kernel 仅有 `approval_pending`,这与 charter G7 + F12 慢性 deferral 一致。
- HP6 §0 / §4.2 准确识别仓库 tenant prefix law 已经冻结(`packages/nacp-core/src/tenancy/scoped-io.ts`)、bash-core `capability/cancel` transport 已 live(`workers/bash-core/src/index.ts:317-329,342-413`)、filesystem-core 当前 RPC 仅 artifact 三件套(`workers/filesystem-core/src/index.ts:47-59,83-125`)。
- HP9 §0 / §1.2 准确陈述 `clients/api-docs/` 当前 11 份(`README.md / auth.md / catalog.md / error-index.md / me-sessions.md / permissions.md / session-ws-v1.md / session.md / usage.md / wechat-auth.md / worker-health.md`,已 `ls` 验证),与 charter §7.10 #1 + §4.4 一致。
- HPX-qna 的 39 道题覆盖 HP0-HP10 各 design doc 的 owner 拍板项,Q1-Q6 / Q7-Q12 / Q13-Q18 / Q19-Q24 / Q25-Q28 / Q29-Q32 / Q33-Q36 / Q37-Q39 分区合理,条件触发题(Q37/Q38/Q39)显式标注;每题包含影响范围、当前建议、reasoning、问题语句、业主回答槽位 — 结构合理,符合 HPX 角色设定。
- HP0 / HP1 启动顺序与 charter §13.4 一致(HP1 design 在 HP0 启动前完成 → HP0 action-plan → HP0 → HP1 action-plan → HP1)。
- HP7 §6.1 取舍 1(lazy snapshot)、§6.1 取舍 2(rollback baseline)、§6.1 取舍 4(restore/fork 分离)与 charter §7.8 In-Scope 完全一致;HP7 §1.1 fork 边界(同 conversation 新 session,不跨 conversation fork)与 charter §4.2 O5 边界一致。
- HP10 §1.1 / §7 final closure 结构(`phase map + deferred map + chronic F1-F17 + inherited issues`)忠实复刻 charter §10.4 + `zero-to-real-final-closure.md` precedent;hero-to-platform stub 边界(只登记 inherited issues,不抢写实质内容)与 charter §11 一致。

### 1.2 已确认的负面事实

- HP1 design `7.2.F4: product checkpoint durable truth` **没有列出 `nano_session_checkpoints` / `nano_checkpoint_file_snapshots` / `nano_checkpoint_restore_jobs` / `nano_workspace_cleanup_jobs` 的字段集合**,只点了表名;HP1 design `7.2.F3` 的 `nano_session_todos` / `nano_session_temp_files` / `nano_session_confirmations` / `nano_session_files provenance` 同样只点表名,不展开字段。即:**charter §7.2 是当前唯一字段集合权威源**,但 HP1 design 文件没有把它复刻进来。
- HP5 design `§7.2.F5: 7-kind freeze` 列的 7 个 kind 是:`permission / elicitation / compact_execute / checkpoint_restore / conversation_delete / workspace_cleanup / tool_cancel`。charter §7.2 HP1 In-Scope `nano_session_confirmations.kind` 列的 7 个 kind 是:`tool_permission / elicitation / model_switch / context_compact / fallback_model / checkpoint_restore / context_loss`。**两组只有 `elicitation` 与 `checkpoint_restore` 共有(2 项重合);其余 5 项完全不同**(`permission` vs `tool_permission`、`compact_execute` vs `context_compact` 是命名漂移,3 项是语义不同)。
- HP6 design `§7.2.F1: nano_session_todos` 字段为 `{todo_uuid, session_uuid, team_uuid, title, details_json, status[pending|in_progress|completed], sort_index, source_request_uuid, created_at, updated_at, deleted_at}`。charter §7.2 HP1 In-Scope `nano_session_todos` 字段为 `{todo_uuid PK, session_uuid FK, conversation_uuid FK, team_uuid, parent_todo_uuid, content, status[pending/in_progress/completed/cancelled/blocked], created_at, updated_at, completed_at}`。差异:HP6 缺 `conversation_uuid FK / parent_todo_uuid / completed_at`,多 `title / details_json / sort_index / source_request_uuid / deleted_at`;status 枚举 HP6 = 3 项,charter = 5 项;`content`(charter)vs `title + details_json`(HP6)是语义不同表达。
- HP6 design `§7.2.F2: nano_session_temp_files.cleanup_status` 枚举为 `pending | retained_with_reason | deleted | failed`。charter §7.2 HP1 In-Scope `nano_session_temp_files.cleanup_status` 枚举为 `pending / scheduled / done`。两者完全不同;HP6 多了 `failed` 与 `retained_with_reason`,charter 多了 `scheduled / done`。HP6 design 同时缺 charter 列出的 `last_modified_at / written_by[user/agent/tool] / UNIQUE(session_uuid, virtual_path)`,而 charter 缺 HP6 的 `updated_at` — 实际上 `updated_at` 与 `last_modified_at` 是别名,但命名一致性需先冻结。
- HP6 design `§7.2.F4: artifact provenance` 仅显式登记 `provenance_kind = workspace_promoted / source_workspace_path / source_content_hash / promoted_at`,而 charter §7.2 HP1 In-Scope `nano_session_files` provenance 列的枚举为 `provenance_kind[user_upload / agent_generated / workspace_promoted / compact_summary / checkpoint_restored]`(5 项)+ `source_workspace_path / source_session_uuid`。HP6 没说 charter 的另外 4 个 provenance kind 谁来写、何时写;`source_session_uuid`(用于 fork)在 HP6 没出现。
- HP7 design `§7.2.F1: nano_session_checkpoints` 字段为 `{checkpoint_uuid, session_uuid, conversation_uuid, team_uuid, checkpoint_kind[turn_end | user_named | compact_boundary | rollback_baseline], label, message_anchor_uuid, turn_anchor_index, file_snapshot_status, expires_at, created_at}`。charter §7.2 HP1 In-Scope `nano_session_checkpoints` 字段为 `{checkpoint_uuid PK, session_uuid FK, conversation_uuid FK, team_uuid, turn_uuid FK, turn_attempt INTEGER, checkpoint_kind[turn_end/user_named/compact_boundary/system], label, message_high_watermark TEXT, latest_event_seq INTEGER, context_snapshot_uuid FK?, file_snapshot_status[none/pending/materialized/failed], created_by[user/system/compact/turn_end], created_at, expires_at}`。差异:HP7 缺 `turn_uuid FK / turn_attempt / latest_event_seq / context_snapshot_uuid FK / created_by` 五字段;HP7 用 `message_anchor_uuid / turn_anchor_index` 替代 charter 的 `message_high_watermark`(语义重叠但命名不同);HP7 的 `checkpoint_kind` 枚举增加 `rollback_baseline`,删掉 `system`(替换 1 项)。
- HP7 design `§7.2.F1: nano_checkpoint_file_snapshots` 字段为 `{checkpoint_uuid, session_uuid, team_uuid, virtual_path, r2_key, content_hash, snapshot_status[pending | materialized | copied_to_fork | failed], created_at}`。charter §7.2 HP1 In-Scope 字段为 `{snapshot_uuid PK, checkpoint_uuid FK, session_uuid FK, team_uuid, source_temp_file_uuid FK?, source_artifact_file_uuid FK?, source_r2_key, snapshot_r2_key, virtual_path, size_bytes, content_hash, snapshot_status[pending/materialized/copied_to_fork/failed], created_at}`。差异:HP7 没有独立 `snapshot_uuid PK`(charter 暗示 `snapshot_uuid` 才是主键,而 `(checkpoint_uuid, virtual_path)` 是业务唯一);HP7 缺 `source_temp_file_uuid FK / source_artifact_file_uuid FK / source_r2_key / snapshot_r2_key / size_bytes` 五字段。这 5 个字段是 charter §7.2 用来表达 lazy materialization 与 fork copy lineage 的核心,不是装饰字段。
- HP7 design `§7.2.F3: nano_checkpoint_restore_jobs` 字段为 `{restore_job_uuid, session_uuid, team_uuid, checkpoint_uuid, mode, confirmation_uuid, rollback_checkpoint_uuid, status[pending_confirmation | running | completed | rolled_back | failed], failure_reason, created_at, finished_at}`。charter §7.2 HP1 In-Scope 字段为 `{job_uuid PK, checkpoint_uuid FK, session_uuid FK, mode[conversation_only/files_only/conversation_and_files/fork], target_session_uuid TEXT?, status[pending/running/succeeded/partial/failed/rolled_back], confirmation_uuid FK, started_at, completed_at, failure_reason TEXT}`。差异:HP7 用 `restore_job_uuid` 替代 charter 的 `job_uuid`(命名);HP7 缺 `target_session_uuid TEXT?`(charter 用于 fork mode 关联新 session,HP7 §F4 fork 流程必需但没显式 schema 字段承接);HP7 status 多 `pending_confirmation`,charter status 含 `succeeded / partial`,两者枚举完全不一样;HP7 用 `created_at / finished_at`,charter 用 `started_at / completed_at`(命名);HP7 引入新 mode `rollback_baseline` 触发的 restore 流程未对应到 charter mode 枚举。
- HP3 design `§5.3` 显式登记 "compact job durable D1 — in-scope — HP3 action-plan 若 HP1 schema 未落则补最小表";HP3 design `§9.3 → 需要进入 QNA register 的问题`(以及 HPX-qna Q37)把"是否允许 HP3 collateral migration"挂为条件题。但 charter §7.2 HP1 In-Scope 与 HP1 design `§7.1.1 ledger 007-013` 中 **没有 `nano_compact_jobs` 表**;charter §4.4 R8 受控例外需要 owner 批准 + charter §7.2 修订 + HP1 schema doc 修订,HP3 design 单方面登记"若未落则补最小表"会让 HP3 一启动就触发 R8 路径 — 这是当前 12 份设计中最显式的 schema 缺口。
- HP9 design `§7.2.F2 rewrite/sanity-check routing` 列 rewrite = 4(`session.md, permissions.md, usage.md, error-index.md`)、new = 7、sanity-check = 7。charter §7.10 #1 列同样的 11 现有 + 7 新增 = 18,且 rewrite 4 份与 HP9 一致;charter §7.10 #4 又写 "对 6 份新增 + 4 份 rewrite 共 10 份做 review"。 charter 内 7-vs-6 是 charter 自身的内部不一致(应是 7 份),HP9 design 选 7 修正 charter 笔误,但 design 没显式说明这一选择。
- HP3 §S2 `CrossTurnContextManager` 与 charter §7.4 #2 一致;但 HP3 §6.1 "取舍 2:CrossTurnContextManager 放 agent-core" + HPX Q10 "context prompt owner 放 agent-core,context-core 仅 inspection"事实上 **窄化** 了 charter §7.4 #1 中 `getContextSnapshot / triggerContextSnapshot / triggerCompact` 三 RPC 解 stub 的语义:charter 仍要求三 RPC 提供真数据(probe 类),HP3 也确实保留 probe 端点交给 context-core,但 HP3 没有显式说明"`triggerCompact` 仍由 context-core 持有触发权,还是由 agent-core 真发起 compact 后再回写"。这会影响 action-plan 阶段的 RPC owner 划分,目前是模糊地带。
- 现有 `test/cross-e2e/` 14 个编号文件 + `zx2-transport`,**没有** `15-permission-roundtrip-allow / 16-permission-roundtrip-deny / 17-elicitation-roundtrip / 18-usage-push-live`(已 `ls` 验证)。HP5 design §7.3 显式列出这 4 个文件名作为冻结产物,与 charter §7.6 完全一致 — 这部分没有问题,只是为后续 reviewer 提供"什么是 hero-to-pro charter HP5 之前的 baseline"事实证据。
- HP4 design `§5.3 / §9.3` 把 "HP1 未落地时,delete tombstone / retry attempt / checkpoint registry / restore job 的最小 D1 字段集是否作为 HP4 collateral migration 一并处理"挂为条件题(Q38)— 与 HP3 类似,但 charter §13.4 推荐撰写顺序是 "HP1 design → HP0 → HP1 → HP2..." 即 HP1 必须在 HP4 之前完成。这道条件题的存在合理(防御性),但 HP4 design 没说明若 HP1 已 closure(charter §8.1 推荐顺序),Q38 是否自动失效。
- HP6 §S2 写明"workspace temp file UNIQUE(session_uuid, virtual_path)"约束没有出现在 HP6 design 字段表中(charter §7.2 有,HP6 §7.2.F2 没列),只在边界 / Tradeoff 文字里隐含 — 这与"design 是字段集合权威"的原则相矛盾。
- 12 份 design 的 `9.1` QNA 表全部标 `frozen`,但 HPX-qna Q1-Q39 全部 `业主回答` 槽位为空 — 设计层面把决策当 `frozen`、QNA 层面又把决策当待答题。这是流程级矛盾(详见 R8 修法说明)。**注**:按 owner 指示,业主回答未填写本身不计为 finding。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 通过 `wc -l` + `grep -n` 抽样验证 ~25 处 anchor;绝大多数行号有效,仅 HP1 引文 `migrations/002:7-169` 末行越界 1 行(实际 168 行,无功能影响),HP3 引 `codex.rs:3954-3961` 实际 `<model_switch>` 注释在 3955 行(在范围内) |
| 本地命令 / 测试 | `yes` | `ls workers/orchestrator-core/migrations`、`ls clients/api-docs`、`ls test/cross-e2e`、`grep` 关键 symbol、`wc -l` ~10 个被引文件 |
| schema / contract 反向校验 | `yes` | charter §7.2 字段集合 vs HP1 design §7.2.F4 vs HP5/HP6/HP7 §7.2.F* 字段集合 token-level diff(详见 R1) |
| live / deploy / preview 证据 | `n/a` | 本轮为 docs-review,不依赖 deploy/preview |
| 与上游 design / QNA 对账 | `yes` | charter v0.draft-r1 + HPX Q1-Q39 全文对照 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | HP5/HP6/HP7 schema 与 charter §7.2 HP1 schema 系统性漂移 | critical | scope-drift / correctness | yes | HP1 启动前 reconcile,把字段集合统一回填进 HP1 design `§7.2.F1-F4`,并修订下游 design 字段集与命名 |
| R2 | HP3 compact_jobs durable table 在 HP1 schema 中缺失 | critical | delivery-gap | yes | charter §7.2 增补 `nano_compact_jobs` + HP1 design ledger 增补 `014-compact-jobs.sql` 或并入 `008/009`;不要走 HP3 collateral migration 路径 |
| R3 | HP1 design §7.2 不携带字段集合,只列表名 | high | docs-gap / correctness | yes | HP1 design 必须在 §7.2 内复刻 charter §7.2 全部字段集合(13 个分组),成为 HP6/HP7 字段命名的唯一权威源 |
| R4 | HP5 7-kind confirmation enum 与 charter HP1 schema 7-kind enum 完全不同 | high | scope-drift / protocol-drift | yes | 二选一:(a)采纳 HP5 list(更符合实际产品语义)+ 修订 charter §7.2,(b)采纳 charter list + 修订 HP5 design;并明确 model_switch / fallback_model 是否走 confirmation control plane |
| R5 | HP7 file_snapshots 缺 source 系列 lineage 字段(charter §7.2 必需) | high | delivery-gap | yes | HP7 design §7.2.F1 字段表补 `snapshot_uuid PK / source_temp_file_uuid FK / source_artifact_file_uuid FK / source_r2_key / snapshot_r2_key / size_bytes` |
| R6 | HP7 restore_jobs status enum 与 mode 表达与 charter 不一致;`target_session_uuid` 缺失 | high | delivery-gap | yes | HP7 design §7.2.F3 status 改为 `pending/running/succeeded/partial/failed/rolled_back`,补 `target_session_uuid TEXT?`(用于 fork mode);命名命名 `job_uuid` vs `restore_job_uuid` 二选一并冻结 |
| R7 | HP6 todos schema 缺 `conversation_uuid FK / parent_todo_uuid`,status 枚举少 2 项 | high | delivery-gap | yes | HP6 design §7.2.F1 补 charter 字段;status 改回 5 项或显式说明删除 `cancelled / blocked` 的理由(并修订 charter) |
| R8 | HP6 temp_files cleanup_status 枚举与 charter 不重叠 | high | scope-drift | yes | 二选一并冻结;若选 HP6 enum(`pending/retained_with_reason/deleted/failed`),修订 charter §7.2 |
| R9 | HP6 artifact provenance_kind 5 项中只展开 1 项 | medium | delivery-gap | no | HP6 design §7.2.F4 显式说明 5 个 kind 的写入时机 + 谁来写;`source_session_uuid`(fork) 必须出现 |
| R10 | HP3 `triggerCompact` RPC owner 模糊(context-core vs agent-core) | medium | correctness | no | HP3 design 在 §F2 + §F4 显式说明:probe 由 context-core 持有,真正 compact 触发由 agent-core 持有,context-core RPC 仅做 inspection |
| R11 | HP3 / HP4 design 自登记 `collateral migration` 兜底路径,违反 charter §4.4 R8 唯一路径 | medium | scope-drift | no | HP3/HP4 design §5.3 + §9.3 删除"作为 collateral migration 一并处理"措辞,改为"若 HP1 schema 缺,必须按 §4.4 R8 受控例外流程修订 charter"(消除 design 自带 fallback 路径) |
| R12 | HP9 7 vs 6 新增文档与 charter §7.10 内部不一致,HP9 选 7 但未显式说明修正了 charter 笔误 | medium | docs-gap | no | HP9 design §7.2.F1 新增 1 行说明:HP9 采纳 charter §7.10 #1 (7 新增) 而非 §7.10 #4 (6 新增);并建议 charter §7.10 #4 同步修订 |
| R13 | HP5/HP6 命名漂移(`permission` vs `tool_permission`、`compact_execute` vs `context_compact`) | medium | protocol-drift | no | 选定一组并跨 charter / HP1 / HP5 design 一致;倾向用 charter `tool_permission / context_compact` 与 NACP 命名族对齐 |
| R14 | 12 份 design `9.1 QNA 表` 全标 `frozen`,但 HPX-qna Q1-Q39 业主回答未填,流程语义不一致 | medium | docs-gap | no | design `9.1` `状态` 列改成 `pending-owner-answer-via-HPX-Q{n}`,等业主在 HPX-qna 填答后再统一标 `frozen`;或在 design 内显式注明"frozen 是 design layer 自冻结,owner answer 槽位独立等填" |
| R15 | HP4 Q38 / HP3 Q37 条件题在 HP1 已按推荐顺序完成时的失效条件未显式说明 | low | docs-gap | no | HPX-qna Q37 / Q38 增加"若 HP1 已 closure,本题自动 not-triggered"标注 |
| R16 | HP6 `UNIQUE(session_uuid, virtual_path)` 约束没有出现在 design 字段表 | low | docs-gap | no | HP6 design §7.2.F2 字段表加该约束行 |
| R17 | HP1 design 引文 `migrations/002:7-169` 末行越界 1 行 | low | docs-gap | no | 改为 `7-168` 或 `7-167`(根据实际真表结尾位置) |

### R1. HP5/HP6/HP7 schema 与 charter §7.2 HP1 schema 系统性漂移

- **严重级别**:`critical`
- **类型**:`scope-drift / correctness`
- **是否 blocker**:`yes`
- **事实依据**:
  - charter §7.2 HP1 In-Scope `nano_session_confirmations.kind[tool_permission/elicitation/model_switch/context_compact/fallback_model/checkpoint_restore/context_loss]` vs HP5 design §7.2.F5 `[permission/elicitation/compact_execute/checkpoint_restore/conversation_delete/workspace_cleanup/tool_cancel]` — 仅 2 项重合
  - charter §7.2 HP1 In-Scope `nano_session_todos {todo_uuid PK, session_uuid FK, conversation_uuid FK, team_uuid, parent_todo_uuid, content, status[pending/in_progress/completed/cancelled/blocked], created_at, updated_at, completed_at}` vs HP6 design §7.2.F1 `{todo_uuid, session_uuid, team_uuid, title, details_json, status[pending|in_progress|completed], sort_index, source_request_uuid, created_at, updated_at, deleted_at}` — 字段集合 12 项中 5 项不同
  - charter §7.2 HP1 In-Scope `nano_session_temp_files.cleanup_status[pending/scheduled/done]` vs HP6 design §7.2.F2 `[pending|retained_with_reason|deleted|failed]` — 完全不重合
  - charter §7.2 HP1 In-Scope `nano_session_checkpoints.checkpoint_kind[turn_end/user_named/compact_boundary/system]` vs HP7 design §7.2.F1 `[turn_end | user_named | compact_boundary | rollback_baseline]` — 替换 1 项
  - charter §7.2 HP1 In-Scope `nano_session_checkpoints` 含 `turn_uuid FK / turn_attempt / latest_event_seq / context_snapshot_uuid FK / created_by` 五字段,HP7 design §7.2.F1 无
  - charter §7.2 HP1 In-Scope `nano_checkpoint_file_snapshots` 含 `snapshot_uuid PK / source_temp_file_uuid FK / source_artifact_file_uuid FK / source_r2_key / snapshot_r2_key / size_bytes` 六字段,HP7 design §7.2.F1 无
  - charter §7.2 HP1 In-Scope `nano_checkpoint_restore_jobs.status[pending/running/succeeded/partial/failed/rolled_back]` vs HP7 design §7.2.F3 `[pending_confirmation|running|completed|rolled_back|failed]` — 完全不重合
  - charter §7.2 HP1 In-Scope `nano_checkpoint_restore_jobs.target_session_uuid TEXT?` 字段(用于 fork mode 把新 session uuid 写回),HP7 design §7.2.F3 缺
- **为什么重要**:
  - HP1 是 DDL Freeze Gate(charter §4.4)。HP1 落地后,HP2-HP10 默认严禁加新 migration;受控例外(R8)需要 owner 批准 + charter 修订。如果 HP1 按 charter §7.2 落表,HP6/HP7 自己设计的字段会缺;如果 HP1 按 HP6/HP7 落表,charter §7.2 中 HP4/HP6/HP7/closure 引用的字段(如 `target_session_uuid`、`source_temp_file_uuid`、`turn_uuid FK + turn_attempt`)会缺,**HP4/HP6/HP7 在 action-plan 期就会触发 R8**。
  - 这不是单点 review nit,而是 12 份设计文档作为整体不能进入 action-plan 的 blocker:无论 HP1 怎么落,都会有至少一个下游 phase 在第一周破戒。
- **审查判断**:
  - 这是设计阶段最关键的一致性问题。**根因是 R3(HP1 design §7.2 不携带字段集合)** — HP1 design 只点表名,把字段权威拱手让给 charter §7.2,而 HP5/HP6/HP7 设计稿未必每次都对齐到 charter §7.2 最新版本。
  - 解决方向必须是"把字段集合写回 HP1 design",而不是"让每个下游 design 自己列字段"。否则字段命名将来还会继续漂。
- **建议修法**:
  1. **HP1 design §7.2.F1-F4 必须复刻 charter §7.2 字段集合**(全部 13 个分组,含每张表所有字段、PK/FK、enum 取值、索引、UNIQUE 约束)。这一步是其他修法的前提。
  2. HP5 design §7.2.F5 7-kind enum 与 charter §7.2 二选一并冻结;**强烈建议** 选 HP5 list(更符合实际产品 confirmation 语义,charter 列表中 `model_switch / fallback_model / context_loss` 更像 stream notification 而非 confirmation)。若选 HP5 list,charter §7.2 + §4.3 灰区表 + §6.1 Phase 总表 同步修订。
  3. HP6 design §7.2.F1 todos schema 与 charter 二选一并冻结;**建议** 采纳 charter 字段(`conversation_uuid FK / parent_todo_uuid / content / 5 项 status`)— 这些字段对应 R8(R29 教训:charter §13.4 conversation 维度 audit 是必须的)、parent-child(charter §4.2 O15 留 hero-to-platform 但需要 schema 占位)、agent loop 暂停(`cancelled` 状态)。HP6 自己加的 `title / details_json / sort_index / source_request_uuid` 也合理 — 建议合并保留两侧字段。
  4. HP6 design §7.2.F2 temp_files cleanup_status 与 charter 二选一并冻结;**建议** 采纳 charter `pending / scheduled / done`(更接近 cron 调度模型);HP6 多出来的 `failed / retained_with_reason` 可作为 charter 增补。
  5. HP7 design §7.2.F1 checkpoint schema 字段集合修订:补 `turn_uuid FK / turn_attempt / latest_event_seq / context_snapshot_uuid FK? / created_by`(与 charter 一致);`message_anchor_uuid / turn_anchor_index` vs `message_high_watermark` 二选一并冻结。HP7 加的 `rollback_baseline` checkpoint_kind 是个真问题:charter §7.2 暗示 rollback baseline 是 system kind 的子类,HP7 把它独立 — 此处建议 HP7 提议为 owner 决策(写入 HPX-qna 新 Q40),不要单方面冻结。
  6. HP7 design §7.2.F1 file_snapshots 补 `snapshot_uuid PK / source_temp_file_uuid FK / source_artifact_file_uuid FK / source_r2_key / snapshot_r2_key / size_bytes` 全部六字段。这些是 lazy materialization + fork copy 的最小载体,缺一不可。
  7. HP7 design §7.2.F3 restore_jobs status enum、mode 枚举、`target_session_uuid TEXT?` 与 charter 对齐;`pending_confirmation` vs `pending` 二选一(建议 charter `pending`,confirmation 状态由 `nano_session_confirmations.status[pending/...]` 表达,而不是 restore_job.status)。

### R2. HP3 compact_jobs durable table 在 HP1 schema 中缺失

- **严重级别**:`critical`
- **类型**:`delivery-gap`
- **是否 blocker**:`yes`
- **事实依据**:
  - HP3 design §5.1 [S1] 列出的 5 个 surface 包括 `POST /sessions/{id}/context/compact` + `GET /sessions/{id}/context/compact/jobs/{id}`(charter §7.4 #7 也要求)
  - HP3 design §3.2 接口保留点 `compact job: POST /...compact + GET /.../jobs/{job_id}` "durable job 记录最小执行结果"
  - HP3 design §5.3 边界清单 `compact job 是否需要 durable D1: in-scope: 要支持 GET /jobs/{id} 与跨 worker 重读`,且写明"HP3 action-plan 若 HP1 schema 未落则补最小表"
  - HP3 design §9.3 + HPX-qna Q37 把"作为 HP3 collateral migration 一并处理"挂为条件题
  - charter §7.2 HP1 In-Scope 7 个分组(`Model state machine schema / Chat / Tool-Workspace / Confirmation / Product checkpoint / R2 cleanup / Workers AI seed / Alias seed / Indexes`)中 **没有** compact job 表
  - HP1 design §7.1.1 ledger `007-013`(`007 model-metadata-and-aliases / 008 session-model-audit / 009 turn-attempt-and-message-supersede / 010 agentic-loop-todos / 011 session-temp-files-and-provenance / 012 session-confirmations / 013 product-checkpoints`)中 **没有** compact job 表
- **为什么重要**:
  - HP3 自身已经识别 compact job 是 durable truth,但同时又把"如果 HP1 不带,HP3 自己加"留作合法路径。这等同于 design 在 charter §4.4 R8 受控例外之外又开了第二条 fallback,让 DDL Freeze Gate 在 HP3 启动时几乎确定会被破。
  - charter §10.3 NOT-成功识别 #9 "compact 真实运行但 24K context_window 模型仍溢出 crash"是硬闸 — 即 HP3 的 compact 必须 live。所以 compact_jobs 表是必要的,缺它就缺一个 phase 闭环。
- **审查判断**:
  - 这不是"HP3 设计错了",而是 charter §7.2 HP1 In-Scope 漏写了 compact_jobs。HP3 design 应该把它显式 surface 出来,作为 HP1 必须修补的输入,而不是吞掉为"我自己处理"。
  - 此项也暴露了 HP1/HP3 之间的 schema review 没有对账 — HP1 design 写完后,HP2/HP3/HP4/HP5/HP6/HP7 应当各自做一次"我消费的 schema 是否已在 HP1 §7.2"的 sanity check。这件事 12 份 design 都没做。
- **建议修法**:
  1. **charter §7.2 HP1 In-Scope 增补第 8 个分组**:`compact job schema`,字段建议 `{compact_job_uuid PK, session_uuid FK, conversation_uuid FK, team_uuid, kind[manual/auto], trigger_reason TEXT, requested_at, started_at, completed_at, status[pending/running/succeeded/partial/failed], boundary_snapshot_uuid FK?, tokens_before INTEGER, tokens_after INTEGER, failure_reason TEXT, attempt_count INTEGER}`(对齐 charter §7.4 #6 circuit breaker 3 次失败语义)
  2. **HP1 design §7.1.1 ledger 增补 `008-compact-jobs.sql`**(如果按 charter 编号顺序)或并入 `012-session-confirmations` 作为 §1.6 增补;**或** 在 `008-session-model-audit.sql` 加 audit 列。建议拆分独立 migration 与 confirmations 同级。
  3. **HP3 design §5.3 + §9.3 + HPX-qna Q37 修订**:删除"作为 HP3 collateral migration"措辞,改为"compact_jobs 表已在 HP1 §7.2 + HP1 design ledger,HP3 直接消费;若 HP1 closure 仍未带,本 phase 不得启动,必须按 charter §4.4 R8 流程修订。"
  4. R11 处理与本项联动。

### R3. HP1 design §7.2 不携带字段集合,只列表名

- **严重级别**:`high`
- **类型**:`docs-gap / correctness`
- **是否 blocker**:`yes`
- **事实依据**:
  - HP1 design §7.2.F1 模型 metadata 与 alias 扩展:列了字段名但没列 PK / FK / 默认值 / nullability
  - HP1 design §7.2.F2 聊天 durable truth 扩展:只说"补 model audit、turn_attempt rebuild、message supersede、conversation tombstone"
  - HP1 design §7.2.F3 workspace / todo / confirmation:只说"新增 nano_session_todos、nano_session_temp_files、nano_session_confirmations;给 nano_session_files 增 provenance columns"
  - HP1 design §7.2.F4 product checkpoint:只说"新增 nano_session_checkpoints、nano_checkpoint_file_snapshots、nano_checkpoint_restore_jobs、nano_workspace_cleanup_jobs"
  - 任何字段集合、enum 取值、索引、UNIQUE 约束、PK/FK 定义,都只在 charter §7.2 HP1 In-Scope 出现,没有复刻到 HP1 design
- **为什么重要**:
  - design layer 的核心价值之一就是"作为 action-plan 编写时唯一 schema 真相源"。HP1 design 把 schema 真相外推到 charter,本身没有问题(charter 是 authoritative);但下游 phase design(HP5/HP6/HP7)在引用这些字段时,没有统一的"HP1 design"中介,而是各自从 charter 抄写或自己重新发明 — 直接催生 R1。
  - 第二级影响:HP1 action-plan 写作者必须在 charter §7.2 与 HP6/HP7 design §7.2 之间手工调和,这是工作量大且最容易出错的点。
- **审查判断**:
  - 这是设计文件结构性的缺陷,不是个别字段疏漏。
- **建议修法**:
  1. HP1 design §7.2.F1-F4 全部展开,**逐字段**复刻 charter §7.2 HP1 In-Scope(13 个分组)。建议格式与 HP6 design §7.2.F1-F4 字段表一致(列出字段名 + 类型 + 是否 PK/FK + 默认值 + 注释)。
  2. 在 §7.2.F1-F4 顶部加一行:"本节字段集合是 HP1 design 与 charter §7.2 HP1 In-Scope 的等价复刻;若两者出现差异,以本节为准并同步修订 charter。"
  3. HP5/HP6/HP7 design §7.2.F* 在每个 schema 段开头加引用:"本节字段消费自 HP1 design §7.2.F{n};任何字段命名 / 取值差异必须先回 HP1 design 修订。"
  4. 加完后,HP1 design 篇幅会显著上涨(估计 +200 行) — 这是必要成本。

### R4. HP5 7-kind confirmation enum 与 charter HP1 schema 7-kind enum 完全不同

- **严重级别**:`high`
- **类型**:`scope-drift / protocol-drift`
- **是否 blocker**:`yes`
- **事实依据**:
  - HP5 design §7.2.F5: `[permission, elicitation, compact_execute, checkpoint_restore, conversation_delete, workspace_cleanup, tool_cancel]`
  - charter §7.2 HP1 In-Scope `nano_session_confirmations.kind`: `[tool_permission, elicitation, model_switch, context_compact, fallback_model, checkpoint_restore, context_loss]`
  - HPX-qna Q18 业主问题为"HP5 先冻结第一版 7 个 confirmation kind",未指定具体 7 个
  - HP2 design 提到 `<model_switch>` developer message 但没提 model_switch confirmation;HP3 design 在 §3.2 "compact preview future 可接 HP5 confirmation" 但没提 context_compact / compact_execute 命名
- **为什么重要**:
  - kind enum 是 confirmation registry 的 D1 schema 列(charter §7.2);它同时也是 NACP frame `session.confirmation.request.kind` 字段(HP5 §S5)。一个真表 + 一个协议字段都依赖这个 enum 冻结。
  - 7 项中 5 项分歧不是命名,而是语义不同:
    - HP5 有 `conversation_delete / workspace_cleanup / tool_cancel`(charter 没有)— 这些是 HP4 / HP6 的真实 destructive action,需要 confirmation
    - charter 有 `model_switch / fallback_model / context_loss`(HP5 没有)— 这些更像 user-facing notification,charter 把它们硬塞进 confirmation registry 可能是误判
- **审查判断**:
  - 站在产品 confirmation 语义看,**HP5 list 更准确**:confirmation 必须是"用户能 allow/deny/modify"的动作,而 model_switch 是 LLM 看到的 developer message(HP2),fallback_model 是 stream event(HP2 §S6),context_loss 是状态通知(charter §4.3 灰区表也没明确)。
  - 站在 charter authority 看,charter §7.2 是 frozen 字段集合,HP5 应当遵守。
  - 这是一个 owner 必须拍板的问题。
- **建议修法**:
  1. 在 HPX-qna 新增 **Q40** 题面:"7 个 confirmation kind 应采用 charter §7.2 list(`tool_permission / elicitation / model_switch / context_compact / fallback_model / checkpoint_restore / context_loss`)还是 HP5 design list(`permission / elicitation / compact_execute / checkpoint_restore / conversation_delete / workspace_cleanup / tool_cancel`)?",当前建议为 HP5 list 并修订 charter。
  2. owner 拍板后:
     - 若选 HP5 list:charter §7.2 / §4.3 / §6.1 同步修订,把 model_switch / fallback_model / context_loss 改为 stream notification(charter §7.6 + HP2 design §S6);HP1 design §7.2.F3 字段表的 confirmation kind enum 改为 7 项 HP5 list
     - 若选 charter list:HP5 design §7.2.F5 改;HP4 conversation_delete confirmation 改用 generic `tool_permission`(等价?— 此选项 awkward)或新增独立 HP4 endpoint;HP6 workspace_cleanup / tool_cancel 同理

### R5. HP7 file_snapshots 缺 source 系列 lineage 字段(charter §7.2 必需)

- **严重级别**:`high`
- **类型**:`delivery-gap`
- **是否 blocker**:`yes`
- **事实依据**:
  - charter §7.2 HP1 In-Scope `nano_checkpoint_file_snapshots` 字段:`snapshot_uuid PK, checkpoint_uuid FK, session_uuid FK, team_uuid, source_temp_file_uuid FK?, source_artifact_file_uuid FK?, source_r2_key, snapshot_r2_key, virtual_path, size_bytes, content_hash, snapshot_status[pending/materialized/copied_to_fork/failed], created_at`
  - HP7 design §7.2.F1 字段:`checkpoint_uuid, session_uuid, team_uuid, virtual_path, r2_key, content_hash, snapshot_status[pending|materialized|copied_to_fork|failed], created_at`
  - 缺失:`snapshot_uuid PK / source_temp_file_uuid FK / source_artifact_file_uuid FK / source_r2_key / snapshot_r2_key / size_bytes`(6 字段)
- **为什么重要**:
  - 没有 `snapshot_uuid PK`,主键由 `(checkpoint_uuid, virtual_path)` 复合,但 fork copy 时同 virtual_path 会出现两行(原 session + child session),需要独立 PK
  - 没有 `source_temp_file_uuid` / `source_artifact_file_uuid` / `source_r2_key`,无法表达"这个 snapshot 是从 workspace temp file 还是 artifact file 拷贝的"— charter §6.3 fork mode 流程要求记录,HP7 §F4 fork 步骤 4 也要求标 `copied_to_fork`,但缺字段就只能靠 R2 路径暗号(脆弱)
  - 没有 `snapshot_r2_key`,如果 lazy materialization 使 R2 路径不固定(`tenants/{team}/sessions/{session}/snapshots/{checkpoint_uuid}/{virtual_path}`),无法记录某次物化的真实 R2 key
  - 没有 `size_bytes`,cleanup 成本审计无法做(charter §7.8 风险提醒"R2 snapshot 成本可观")
- **审查判断**:
  - HP7 design §F1 字段表是 R3 之后第二严重的 schema 缺漏。这 6 个字段在 charter §7.2 是 lazy materialization + fork copy 的最小载体,不是装饰字段。
- **建议修法**:
  1. HP7 design §7.2.F1 file_snapshots 字段表完全替换为 charter §7.2 版本(13 字段)。
  2. 在字段表下方加一段"为什么必须有 source 系列字段":lazy materialization 需要在 D1 记录"snapshot 来自哪里";fork 复制需要 `copied_to_fork` 状态 + 来源 path 双向追溯。

### R6. HP7 restore_jobs status enum 与 mode 表达与 charter 不一致;`target_session_uuid` 缺失

- **严重级别**:`high`
- **类型**:`delivery-gap`
- **是否 blocker**:`yes`
- **事实依据**:
  - charter §7.2 HP1 In-Scope `nano_checkpoint_restore_jobs.status`: `[pending/running/succeeded/partial/failed/rolled_back]`
  - HP7 design §7.2.F3: `[pending_confirmation|running|completed|rolled_back|failed]`
  - charter mode 枚举: `[conversation_only/files_only/conversation_and_files/fork]`(4 项,fork 是 mode 的一种)
  - HP7 mode 枚举: charter §F2 列 3 项 `conversation_only / files_only / conversation_and_files`,fork 单独走 §F4 端点 — 不一致
  - charter 含 `target_session_uuid TEXT?`(用于 fork mode 把 child session 写回);HP7 design §7.2.F3 缺
  - HP7 用 PK 名 `restore_job_uuid` vs charter `job_uuid`(命名)
  - HP7 用 `created_at / finished_at` vs charter `started_at / completed_at`(命名)
- **为什么重要**:
  - status `succeeded vs completed` / `partial`(HP7 没)/ `pending vs pending_confirmation`(HP7 把 confirmation 状态揉进 restore status)— 三处差异都会让 restore 行为变得不一致。`partial` 是 charter §7.2 表达"files 部分恢复成功"的状态,HP7 没有,意味着 partial 失败必须当作 `failed` 走 rollback,但有时只 file_snapshot 之一失败,rollback 成本反而更高
  - mode 表达不一致直接影响 fork 是否走 restore_job 流。charter 设计是"fork 是 restore mode 的一种,共用 restore_job 表";HP7 把 fork 单独成 endpoint(§F4),没复用 restore_job — 但 HP7 又自登记 fork 中"必要时 materialize file snapshot"(§F4 流程 1)、"从 rollback baseline 回滚"(§F3 是为 conversation/files mode 的)— 这里逻辑模糊
  - `target_session_uuid` 缺失意味着 fork 时不能用 restore_job 表把 child session uuid 写回 — 这是 fork lineage 审计的核心字段
- **审查判断**:
  - 这一组分歧背后实际上是更深层的设计问题:**fork 是 restore 的子模式还是独立动作?** charter 倾向"子模式",HP7 倾向"独立动作"。建议借这次 review 解决。
- **建议修法**:
  1. owner 拍板"fork 是 restore 子模式还是独立动作"(可加入 HPX-qna Q41)
  2. 若选 charter 路线(子模式):
     - HP7 design §F4 fork endpoint 重写,改用 `POST /sessions/{id}/checkpoints/{checkpoint_uuid}/restore`,body `{ mode: "fork", new_session_label? }`,在 restore_job 表里写 `target_session_uuid`
     - status 改为 charter 6 项,加 `partial`
     - 命名统一用 charter `job_uuid / started_at / completed_at`
  3. 若选 HP7 路线(独立动作):
     - charter §7.2 HP1 In-Scope `nano_checkpoint_restore_jobs` 字段表修订:删 `target_session_uuid TEXT?`;status 改为 5 项;新增 `nano_session_forks` 表
     - HP7 design §F4 fork 流程显式写出"不复用 restore_job,使用单独 nano_session_forks 表"

### R7. HP6 todos schema 缺 `conversation_uuid FK / parent_todo_uuid`,status 枚举少 2 项

- **严重级别**:`high`
- **类型**:`delivery-gap`
- **是否 blocker**:`yes`
- **事实依据**:
  - charter §7.2 HP1 In-Scope `nano_session_todos {todo_uuid PK, session_uuid FK, conversation_uuid FK, team_uuid, parent_todo_uuid, content, status[pending/in_progress/completed/cancelled/blocked], created_at, updated_at, completed_at}`
  - HP6 design §7.2.F1 `{todo_uuid, session_uuid, team_uuid, title, details_json, status[pending|in_progress|completed], sort_index, source_request_uuid, created_at, updated_at, deleted_at}`
- **为什么重要**:
  - 缺 `conversation_uuid FK`:charter §6.3 phase 交接原则要求 todo 与 conversation/session 双层 audit;若 session 被 fork(HP7),原 session 的 todo 需要 conversation_uuid 锚定原 conversation 而不是 session
  - 缺 `parent_todo_uuid`:charter §4.2 O15 把"TodoWrite V2 task graph (parent-child execution + sub-task spawn)"留 hero-to-platform,但 HP1 schema 必须为 V2 留 parent_todo_uuid 字段占位(否则 V2 启动时必须破 DDL freeze)
  - status 缺 `cancelled / blocked`:agent loop 暂停场景常见,charter 5 项设计是为了准确表达"任务被中断" vs "任务等待依赖"两类状态
  - HP6 多出来的 `title / details_json / sort_index / source_request_uuid` 也合理(`title` 短描述、`details_json` 详细数据、`sort_index` 显示顺序、`source_request_uuid` audit)— 不应该删除,而应该并入
- **审查判断**:
  - HP6 自己的字段集合不是"错",而是"缺",同时也"多";应该合并保留两侧字段。
- **建议修法**:
  1. HP6 design §7.2.F1 todos 字段表合并:保留 charter `conversation_uuid FK / parent_todo_uuid / completed_at` + status 5 项;追加 HP6 `title / details_json / sort_index / source_request_uuid`;`content` vs `title + details_json` 二选一(建议保留 charter `content` + HP6 `details_json`,相当于 `content` 是 markdown 短文本,`details_json` 是结构化 metadata)
  2. charter §7.2 同步修订(若并入新字段)

### R8. HP6 temp_files cleanup_status 枚举与 charter 不重叠

- **严重级别**:`high`
- **类型**:`scope-drift`
- **是否 blocker**:`yes`
- **事实依据**:
  - charter §7.2: `nano_session_temp_files.cleanup_status[pending/scheduled/done]`
  - HP6 design §7.2.F2: `[pending|retained_with_reason|deleted|failed]`
- **为什么重要**:
  - charter 思路:`pending`(待清理)→ `scheduled`(cron 已排队)→ `done`(已删) — 这是 cron 调度状态机
  - HP6 思路:`pending`(待清理)→ `deleted`(已删,等价 charter `done`)/ `failed`(删失败) / `retained_with_reason`(因业务保留不删)— 这是 cleanup outcome 状态机
  - 两个 enum 表达的事不一样,但都对。HP6 多了 `failed`(charter 没法表达 cleanup 失败) 和 `retained_with_reason`(charter 没法表达"被业务锁定不删")— 这两个状态确实是 charter §7.2 漏的。
- **审查判断**:
  - HP6 enum 在表达力上更强;charter enum 在 cron scheduling 表达上更细。建议合并:`pending / scheduled / done / failed / retained_with_reason`(5 项)。
- **建议修法**:
  1. HP6 design §7.2.F2 cleanup_status 枚举改为 5 项 `[pending / scheduled / done / failed / retained_with_reason]`
  2. charter §7.2 同步修订
  3. HP1 design §7.2.F3 temp_files 字段表同步

### R9. HP6 artifact provenance_kind 5 项中只展开 1 项

- **严重级别**:`medium`
- **类型**:`delivery-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - charter §7.2 HP1 In-Scope `nano_session_files` provenance: `provenance_kind[user_upload / agent_generated / workspace_promoted / compact_summary / checkpoint_restored]` + `source_workspace_path` + `source_session_uuid`
  - HP6 design §7.2.F4 仅在 `provenance_kind = workspace_promoted` 场景下写明字段(`source_workspace_path / source_content_hash / promoted_at`);其他 4 个 kind(`user_upload / agent_generated / compact_summary / checkpoint_restored`)的写入时机和谁写没说
- **为什么重要**:
  - `user_upload` 由 `/files/upload`(HP6 §F4 + RH4 已 live)写入
  - `agent_generated` 由 LLM tool call 直接产生 artifact(HP6 §F3 inflight tool 完成后)写入
  - `compact_summary` 由 HP3 boundary snapshot 物化为 artifact 写入
  - `checkpoint_restored` 由 HP7 restore 写入(标记此 artifact 是从 snapshot 恢复出来的副本)
  - HP6 没说哪个 phase 负责写哪种 provenance — 这是设计稿之间的 ownership gap,会让 action-plan 期"4 个 phase 互相推诿"
- **审查判断**:
  - 不影响 HP6 主线,但影响 HP3/HP6/HP7 联动正确性。属于 design 之间的 ownership 表达缺陷。
- **建议修法**:
  1. HP6 design §7.2.F4 加 ownership matrix:每个 provenance_kind 对应的写入 phase 与 endpoint
  2. `source_session_uuid`(fork 用)在 HP6 / HP7 design 至少有一处 explicit:"fork 时新 session artifact provenance 写 source_session_uuid"

### R10. HP3 `triggerCompact` RPC owner 模糊(context-core vs agent-core)

- **严重级别**:`medium`
- **类型**:`correctness`
- **是否 blocker**:`no`
- **事实依据**:
  - HP3 design §6.1 取舍 2:`runtime 内单一 CrossTurnContextManager`(放 agent-core);context-core 偏 inspection / control plane
  - HP3 design §S1 5 个 surface 包括 probe / preview / compact / jobs / layers,均挂在 context-core
  - HP3 design §F4 manual compact preview + job:preview 由 context-core(无副作用),compact 创建 job(实际谁写 boundary snapshot?)
  - charter §7.4 #1 "context-core 3 RPC 解 stub:从 agent-core Session DO + D1 messages + workspace assembler 拉真实数据"
  - charter §7.4 #2 `CrossTurnContextManager` 放 agent-core
- **为什么重要**:
  - 真正 compact 需要调 LLM 摘要(由 agent-core 持有 LLM 客户端)+ 写 boundary snapshot 到 D1(orchestrator-core 拥有 D1 写入)+ emit `compact.notify` stream(orchestrator-core 拥有 NACP frame)+ 写 `nano_compact_jobs`(orchestrator-core)。但 HP3 把"compact" endpoint 放在 context-core(facade 转发) — 实际执行链路一定是跨 worker
  - HPX-qna Q10 已 frozen "agent-core runtime 是 prompt owner、context-core 是 inspection",但没说 trigger compact 端点谁来真正执行 — 容易在 action-plan 期出现"facade 调 context-core RPC,context-core 又调 agent-core,agent-core 调 LLM 后写 D1"的多跳链路,latency / 一致性 / 错误处理 都复杂
- **审查判断**:
  - 模糊不是错,但留作后续解释会持续制造问题。
- **建议修法**:
  1. HP3 design §F4 显式说明执行链路:
     - `POST /sessions/{id}/context/compact` 路由到 orchestrator-core facade
     - facade 写 `nano_compact_jobs` 一行 `pending`
     - facade 调用 agent-core(via Session DO RPC `triggerCompact`)— agent-core 执行 LLM 摘要 + 写 boundary snapshot 到 D1
     - agent-core 完成后回写 facade,facade 把 job 标 `succeeded` + emit `compact.notify`
  2. context-core 的 `triggerCompact` RPC 重新定位为 inspection-only(返回当前 compact policy / threshold,而不是真发起 compact)— 否则名字误导

### R11. HP3 / HP4 design 自登记 `collateral migration` 兜底路径,违反 charter §4.4 R8 唯一路径

- **严重级别**:`medium`
- **类型**:`scope-drift`
- **是否 blocker**:`no`(R2 解决后此项自动消解 50%)
- **事实依据**:
  - HP3 design §5.3:"compact job durable D1: in-scope: HP3 action-plan 若 HP1 schema 未落则补最小表"
  - HP3 design §9.3:"若 HP1 schema extension 在 HP3 启动前仍未落地,compact job 的最小 D1 表是否作为 HP3 collateral migration 一并落地"
  - HP4 design §9.3:"若 HP1 schema extension 尚未落地,delete tombstone / retry attempt / checkpoint registry / restore job 的最小 D1 字段集是否作为 HP4 collateral migration 一并处理"
  - charter §4.4 R8 受控例外明确规定:HP1 之外的 schema 改动必须 owner 批准 + charter 修订 + 标 `HP1 schema correction` + migration 编号继 HP1 序列
  - HPX Q37 / Q38 当前建议"默认不允许"
- **为什么重要**:
  - design layer 的"如果 HP1 没落,我自己处理"语义,即使 HPX 默认不允许,也会让 action-plan 编写者把"collateral migration"当作合法路径之一,实质上稀释了 R8 的强约束力
  - charter §13.4 撰写顺序明确"HP1 design → HP0 → HP1 → HP2..." → 所以 HP3/HP4 启动时 HP1 必然已 closure,Q37/Q38 实际不会触发 — 即条件题在正常执行路径下永远 not-triggered
- **审查判断**:
  - 条件题保留作为"防御性"是合理的,但 design 文本不应自我登记 fallback。
- **建议修法**:
  1. HP3 design §5.3 + §9.3 改:"compact job durable D1: in-scope; HP1 schema 必须包含此表,如果发现未包含,必须按 charter §4.4 R8 修订 charter,不允许 HP3 自加 migration"
  2. HP4 design §9.3 改类似措辞
  3. HPX-qna Q37 / Q38 的"当前建议"改为"按 charter §4.4 R8;Q37 应仅在 HP1 closure 后发现 schema 缺漏时触发,与执行顺序问题无关"
  4. R2 处理后,Q37 永远 not-triggered

### R12. HP9 7 vs 6 新增文档与 charter §7.10 内部不一致,HP9 选 7 但未显式说明修正了 charter 笔误

- **严重级别**:`medium`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - charter §7.10 #1:"11 份现有 + 7 份新增 = 18 份"(列出 7 份新增:`models.md / context.md / checkpoints.md / confirmations.md / todos.md / workspace.md / transport-profiles.md`)
  - charter §7.10 #4:"对 6 份新增 + 4 份 rewrite 共 10 份做 review"(说"6 份新增")
  - HP9 design §7.2.F2: rewrite = 4 / new = 7 / sanity-check = 7
- **为什么重要**:
  - HP9 design 选了 7(与 charter §7.10 #1 一致),实际是修正了 charter §7.10 #4 的笔误(应是 7,不是 6)。这是合理判断,但 HP9 design 没显式声明"我修正了 charter §7.10 #4"。
  - reviewer 看到 charter / HP9 数字不一致时无 audit trail。
- **审查判断**:
  - 应当在 HP9 design 里 explicit 说明,同时建议 charter 同步修订。
- **建议修法**:
  1. HP9 design §7.2.F2 加 1 句 footnote:"本节采纳 charter §7.10 #1 的 7 份新增列表。charter §7.10 #4 写'6 份'是 charter v0.draft-r1 笔误,应为 7 份;建议同步修订 charter。"
  2. charter §7.10 #4 修订:`6 份新增 + 4 份 rewrite 共 10 份` → `7 份新增 + 4 份 rewrite 共 11 份`

### R13. HP5/HP6 命名漂移(`permission` vs `tool_permission`、`compact_execute` vs `context_compact`)

- **严重级别**:`medium`
- **类型**:`protocol-drift`
- **是否 blocker**:`no`
- **事实依据**:
  - HP5 design §F5: `permission`、`compact_execute`
  - charter §7.2: `tool_permission`、`context_compact`
  - NACP `session.permission.*` 已 live(`packages/nacp-session/src/messages.ts:146-191`)— 与 `tool_permission` 半一致
  - charter §4.3 灰区表 "通用 /confirmations 端点 in-scope (HP5)"
- **为什么重要**:
  - kind enum 是协议字段;命名漂移会让 client / server 反序列化失败
  - `tool_permission` 比 `permission` 更精确(charter 显式区分 PreToolUse 权限 vs 其他权限);`context_compact` 比 `compact_execute` 更与 NACP `compact.notify` 对齐
- **审查判断**:
  - 倾向 charter 命名,但需 owner 配合 R4 一并拍板。
- **建议修法**:
  1. 与 R4 合并处理,在 HPX-qna Q40 中一并指定 7 项 final 命名(无论选 charter list 还是 HP5 list,命名都要统一)

### R14. 12 份 design `9.1 QNA 表` 全标 `frozen`,但 HPX-qna Q1-Q39 业主回答未填,流程语义不一致

- **严重级别**:`medium`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - HP0-HP10 各 design §9.1 的"状态"列均为 `frozen`(全部 12 份)
  - HPX-qna 开头明确"业主只在本文件填写回答";Q1-Q39 的"业主回答"全部为空
  - HPX-qna §9.1 "本文件的使用约束 — HP0-HP10 各设计稿中的 9.1 与 9.3 已被统一吸收;后续若有回答回填,应优先更新本文件"
- **为什么重要**:
  - 当 reviewer / owner / executor 看到 design §9.1 标 `frozen` 时,默认应是"已经业主拍板",但实际 HPX-qna 还在等回答 — 流程语义矛盾
  - 即使按 owner 指示"HPX-qna 空答不计为问题",design `frozen` 标签的语义本身仍不应等同 owner 已答
- **审查判断**:
  - 这是流程命名问题,不是设计错误。但建议明确两层"frozen":design-layer-frozen(GPT 自冻结)+ owner-answered(业主答完)。
- **建议修法**:
  1. design §9.1 状态列改为分两层:`design-frozen | owner-answered`;当前 design-frozen,等 owner answer 后改 owner-answered
  2. 或在 design §9.1 顶部加一句"本表 'frozen' 仅指设计层结论已冻结,owner 最终拍板见 HPX-qna Q{n}"

### R15. HP4 Q38 / HP3 Q37 条件题在 HP1 已按推荐顺序完成时的失效条件未显式说明

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - charter §13.4 撰写顺序:HP1 design → HP0 → HP1(closure)→ HP2... → 即 HP3 启动时 HP1 必然已 closure
  - HPX Q37 / Q38 是"若 HP1 在 HPN 启动前仍未落地"的条件题,实际不会触发
- **审查判断**:
  - 防御性条件题保留合理,但应明确触发条件
- **建议修法**:
  1. HPX-qna Q37 / Q38 题面加一行:"若 HP1 已按 charter §13.4 顺序 closure,本题自动 not-triggered;仅在 HP1 closure 后发现 schema 漏时触发,与执行顺序问题无关"

### R16. HP6 `UNIQUE(session_uuid, virtual_path)` 约束没有出现在 design 字段表

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - charter §7.2 `nano_session_temp_files (..., UNIQUE(session_uuid, virtual_path))`
  - HP6 design §7.2.F2 字段表只列 12 个字段名,没列 UNIQUE
  - HP6 design §F2 文字描述"写入时若内容 hash 未变,则仅更新 updated_at,不重复覆盖对象"暗示 UNIQUE,但没显式
- **建议修法**:
  1. HP6 design §7.2.F2 字段表加一行 `UNIQUE(session_uuid, virtual_path)` 约束

### R17. HP1 design 引文 `migrations/002:7-169` 末行越界 1 行

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - HP1 design §1.2 "关联源码锚点":`workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-169`
  - 实际 `wc -l` = 168 行;末行行号 168
- **建议修法**:
  1. HP1 design §1.2 引文行号改为 `7-168`;HP1 设计 §8.4 "本仓库 precedent" 表第一行同步

---

## 3. In-Scope 逐项对齐审核

> 本表对照 charter §4.1 全局 In-Scope I1-I11 与各 phase design `5.1 In-Scope` 段。

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | I1 HP0 — `/start`/`/input` model_id 透传 + suffix 骨架 + binding-presence verify | `done` | HP0 design §S1-S5 与 charter I1 完全对齐;§7.1.F1-F4 + §9.1 决策(D1-D3)清晰。HP0 唯一遗留是 R17(引文越界,无功能影响) |
| S2 | I2 HP1 — DDL 集中扩展 + 13 个分组(charter §7.2) | `partial` | HP1 design §7.1.1 ledger 完全对齐 charter §7.2 编号(007-013);但 §7.2.F1-F4 字段集合未展开(R3),且 charter §7.2 缺 compact_jobs(R2)。schema correctness 不足;ledger / migration 编号 / DDL Freeze Gate 法则、SQLite ALTER 警告、prod migration 风险等设计要素 OK |
| S3 | I3 HP2 — Model 状态机闭环(4 层、`<model_switch>`、fallback、alias、reasoning effort) | `done` | HP2 design §S1-S6 与 charter §7.3 完全对齐;Codex / Claude Code / Gemini precedent 引用准确;`<model_switch>` 语义在 HP2 冻结的决策(D3)正确;唯一注意是 R4 中 `model_switch` 是否进入 confirmation registry 需 owner 拍板 |
| S4 | I4 HP3 — Context 状态机闭环(probe + compact + cross-turn + layers) | `partial` | HP3 design §S1-S6 与 charter §7.4 主体一致;但 compact_jobs 表 charter 缺(R2)、`triggerCompact` RPC owner 模糊(R10)、§5.3 自登记 collateral migration 路径(R11)。三者都需要 reconcile |
| S5 | I5 HP4 — Chat 生命周期 + checkpoint conversation_only | `partial` | HP4 design §S1-S6 与 charter §7.5 完全对齐;close vs ended/completed 决策(D1)、conversation soft tombstone(D2)、checkpoint registry 不复用 DO latest checkpoint(D3)都 OK;但 §9.3 自登记 collateral migration 路径(R11)需修订 |
| S6 | I6 HP5 — Confirmation control plane + Hook dispatcher + F12/F13 closure | `partial` | HP5 design §S1-S6 与 charter §7.6 主体一致;`emitPermissionRequestAndAwait` 复用、kernel 统一 `confirmation_pending`、4 个 cross-e2e 文件名(`15-18`)都 OK;但 §F5 7-kind enum 与 charter §7.2 完全分歧(R4 / R13) |
| S7 | I7 HP6 — Tool/Workspace 状态机 | `partial` | HP6 design §S1-S6 与 charter §7.7 主体一致;virtual_path 主键(D1)、promotion 复制(D2)、tool cancel 可观察(D3)都 OK;但 §F1 todos schema(R7)、§F2 cleanup_status enum(R8)、§F4 provenance_kind ownership(R9)、§F2 缺 UNIQUE(R16)需修订 |
| S8 | I8 HP7 — Checkpoint 全模式 revert + session fork | `partial` | HP7 design §S1-S6 与 charter §7.8 主体一致;lazy snapshot(D1)、fork 同 conversation(D2)、rollback baseline(D3)都 OK;但 §F1 checkpoint schema(R1 / R5)、§F1 file_snapshots schema(R5)、§F3 restore_jobs schema(R6)需修订 |
| S9 | I9 HP8 — Runtime hardening + chronic deferrals 系统收口 | `done` | HP8 design §S1-S5 与 charter §7.9 完全对齐;megafile gate 改为当前 owner 文件(D1)、tool catalog 落 nacp-core(D2)、envelope 收敛只针对 public(D3)、retained-with-reason / handoff(D4)都正确;`session-do-runtime.ts:583` alarm 真实存在;`user-do-runtime.ts` 1171 行已确认。无 schema 风险 |
| S10 | I10 HP9 — `clients/api-docs/` 18 份 + manual evidence + prod schema baseline | `partial` | HP9 design §S1-S5 与 charter §7.10 主体一致;按产品 surface 切(D1)、manual evidence hard gate(D2)、prod baseline owner-action(D3)、分级 review(D4)都 OK;7 份新增列表对齐 charter §7.10 #1;但未显式说明修正了 charter §7.10 #4 的 6 vs 7 笔误(R12) |
| S11 | I11 HP10 — Final closure + plan-hero-to-platform stub | `done` | HP10 design §S1-S5 与 charter §7.11 完全对齐;final closure 强结构化(D1)、cleanup register 按当前 reality(D2)、stub 不写实质(D3)、retained-with-reason 合法终态(D4)都正确;无 schema 风险 |

### 3.1 对齐结论

- **done**: `4`(S1 / S3 / S9 / S11 — HP0 / HP2 / HP8 / HP10)
- **partial**: `7`(S2 / S4 / S5 / S6 / S7 / S8 / S10 — HP1 / HP3 / HP4 / HP5 / HP6 / HP7 / HP9)
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

> 这更像"12 份 design 主体已成熟,但 HP1 schema 与下游 4 份 phase design schema 之间缺一次 reconcile,以及 HP3 compact_jobs 与 charter §7.10 #4 vs #1 笔误两处 charter 修订",而不是"设计稿不完整"。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Multi-provider LLM routing(charter §4.2 O1) | `遵守` | HP2 design §5.2 [O1] 显式排除 multi-provider routing,charter §4.2 O1 一致 |
| O2 | Sub-agent / multi-agent(charter §4.2 O2) | `遵守` | HP6 design §5.2 [O2] 显式排除 todo parent-child DAG / sub-task spawn(O15);HP7 §5.2 [O1] 排除 cross-conversation fork |
| O3 | Admin plane / billing(charter §4.2 O3/O4) | `遵守` | HP9 design §5.2 [O2/O3] 显式排除新 API surface 与 SDK 自动生成 |
| O4 | TodoWrite V2 task graph(charter §4.2 O15) | `遵守` | HP6 design §5.2 [O2] 显式排除 todo parent-child DAG;但 HP6 schema 也缺 `parent_todo_uuid`(R7),会导致 V2 启动时必须破 freeze — 这是 schema 占位的设计反例,见 R7 修法 |
| O5 | WeChat miniprogram 完整适配(charter §4.3 灰区表) | `遵守` | HP9 design §5.2 [O1] 显式排除 |
| O6 | SDK extraction(charter §4.2 O6) | `遵守` | HP8 design §5.2 [O3 隐含] 一致 |
| O7 | Patch/diff 编辑模式(charter §4.2 O15 隐含) | `遵守` | HP6 design §5.2 [O1] 显式排除 |
| O8 | F2 WeChat 真机 smoke 与 miniprogram 完整适配关系(charter §4.3 灰区表) | `遵守` | HP9 design §5.2 [O1] 与 charter 一致(F2 是 HP9 hard gate,miniprogram 完整适配是独立专项) |
| O9 | permission/elicitation 旧端点物理删除(charter §4.3 灰区表) | `遵守` | HP5 design §5.2 [O1] 显式排除 break legacy route,charter §7.6 一致 |
| O10 | hero-to-platform inherited issues 详细方案(charter §4.2 多项) | `遵守` | HP10 design §5.2 [O1] 显式排除 stub 写实质内容 |
| O11 | F4 Lane E 强制物理删除 host-local residue | `遵守` | HP8 design §5.3 边界清单 "Lane E 是否必须立刻物理删除 host-local residue: defer: 允许 retained-with-reason 路径" 与 charter §7.9 D8 一致 |
| O12 | dual-emit window 关闭(charter §4.2 O9) | `遵守` | 12 份 design 均未涉及 dual-emit 切换,charter 一致 |

无 out-of-scope 越界;无误判 deferred 为 blocker。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**:`changes-requested`
- **是否允许关闭本轮 review**:`no`
- **关闭前必须完成的 blocker**:
  1. **R3** — HP1 design §7.2.F1-F4 必须复刻 charter §7.2 全部字段集合(13 个分组,逐字段);这是后续所有 schema reconcile 的前提
  2. **R2** — charter §7.2 + HP1 design §7.1.1 ledger 必须增补 `nano_compact_jobs` 表(独立 migration 或并入 008-session-model-audit);HP3 design §5.3 / §9.3 同步删除 collateral migration 兜底措辞
  3. **R1** — HP5/HP6/HP7 design §7.2.F* 字段集合与 HP1 design §7.2(完整版)做一次 token-level reconcile,所有命名 / enum 取值 / 缺字段 / 多字段差异在本轮全部消解;命名差异由 owner 在 HPX-qna 拍板(R4 / R13 合并入 Q40)
  4. **R4** — owner 在 HPX-qna(新 Q40)拍板 7-kind confirmation enum 是 charter list 还是 HP5 list;若选 HP5 list,charter §7.2 / §4.3 / §6.1 + HP2 stream notification 同步修订;若选 charter list,HP5 design + HP4 conversation_delete + HP6 workspace_cleanup/tool_cancel 改造路径 explicit
  5. **R5** — HP7 design §7.2.F1 file_snapshots 字段表补 `snapshot_uuid PK / source_temp_file_uuid FK / source_artifact_file_uuid FK / source_r2_key / snapshot_r2_key / size_bytes` 全部六字段
  6. **R6** — HP7 design §7.2.F3 restore_jobs status enum / mode 表达 / `target_session_uuid` 与 charter 二选一并冻结(owner 在 HPX-qna 新 Q41 拍板"fork 是 restore 子模式还是独立动作")
  7. **R7** — HP6 design §7.2.F1 todos 字段表补 `conversation_uuid FK / parent_todo_uuid / completed_at` + status 5 项;`title / details_json / sort_index / source_request_uuid` 也保留;HP1 design §7.2 + charter §7.2 同步
  8. **R8** — HP6 design §7.2.F2 cleanup_status enum 改为 5 项 `[pending / scheduled / done / failed / retained_with_reason]`;HP1 design + charter 同步
- **可以后续跟进的 non-blocking follow-up**:
  1. **R9** — HP6 design §7.2.F4 加 provenance_kind 5 项 ownership matrix
  2. **R10** — HP3 design §F4 显式说明 compact 执行链路(facade → agent-core via Session DO RPC → LLM)
  3. **R11** — HP3/HP4 design §5.3 + §9.3 删除 collateral migration 兜底措辞,改为"必须按 charter §4.4 R8 流程修订"
  4. **R12** — HP9 design §7.2.F2 加 footnote 显式说明修正了 charter §7.10 #4 笔误;charter 同步修订
  5. **R13** — 与 R4 合并处理(命名一致性)
  6. **R14** — design §9.1 状态列分两层 `design-frozen | owner-answered` 或加 footnote 说明
  7. **R15** — HPX-qna Q37 / Q38 题面加 not-triggered 触发条件
  8. **R16** — HP6 design §7.2.F2 字段表加 `UNIQUE(session_uuid, virtual_path)` 约束
  9. **R17** — HP1 design 引文行号 `7-169` 改 `7-168`
- **建议的二次审查方式**:`independent reviewer rereview after R1-R8 修订`(本轮 schema reconcile 影响 HP1 / HP5 / HP6 / HP7 四份 design + charter §7.2,变动量大,建议二次 review 由独立 reviewer 复核)
- **实现者回应入口**:`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应,不要改写 §0–§5。`

> 本轮 review 不收口,等待实现者按 §6 响应并再次更新代码。

> **特别说明**:本轮 review 严格遵守 owner 指示:`HPX-qna Q1-Q39 的"业主回答"为空不计为 finding`。但建议 owner 在拍板 R4 / R6 时,新增 Q40(7-kind enum)+ Q41(fork 是 restore 子模式还是独立)两题,避免 design 层无法自冻结。
