# Nano-Agent 代码审查模板

> 审查对象: `zero-to-real / Z0-Z5 全套 action-plan 文档（6 份）`
> 审查时间: `2026-04-25`
> 审查人: `DeepSeek v4 (deepseek-v4-pro)`
> 审查范围:
> - `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md`
> - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
> - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`
> - `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`
> - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md`
> - `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md`
> - `docs/charter/plan-zero-to-real.md`（对照基线）
> - `docs/design/zero-to-real/*.md`（对照基线）
> - `docs/design/zero-to-real/ZX-qna.md`（Q1-Q10 已回填）
> - `workers/{orchestrator-core,agent-core,bash-core,context-core,filesystem-core}/**`
> - `test/{package-e2e,cross-e2e,shared}/**`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`6 份 action-plan 主体成立——Z0-Z5 的 phase 切分、工作项编排、测试策略与 closure 路径在宏观上是合理且完整的。存在 2 处会直接导致实现期返工的命名不一致（表名），以及 3 处 QnA Opus 详细约束未被 action-plan 显式吸收的精度回退。修正后可直接进入实施。`
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. **表命名不一致存在 2 处 critical 断点**——ZX-d1 设计文档使用 `nano_conversation_sessions/turns/messages` 与 `nano_usage_events/nano_quota_balances`，但 Z2 action-plan 使用 `nano_sessions/session_turns/session_messages`，Z3 action-plan 使用 `nano_usage_ledger`。如果不修正，实现者会在 D1 migration SQL 与代码 ORM/query 层产生持续冲突。
  2. **ZX-qna.md 的 Q1-Q10 已全部由 owner 回填**（对比上一轮 design review 时的全空状态，这是巨大进展），且每个 Q 附带 Opus 三层分析（问题分解 / GPT推荐分析 / 最终回答）提供丰富的实施约束。但 action-plan 对 Opus 约束的显式吸收率约 60%——剩余 40% 的精度回退可能导致实现期重开设计讨论。
  3. **action-plan 的文件路径引用经过代码实证校验**——Z2 的 `workers/agent-core/src/host/do/nano-session-do.ts`、各测试文件、`policy/authority.ts` 等关键路径均真实存在。仅 `workers/*/migrations/` 目录不存在（zero-to-real 阶段会新建），符合预期。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-zero-to-real.md`（phase boundary / exit criteria 基准）
  - `docs/design/zero-to-real/Z0-Z4-*.md`（设计约束基准）
  - `docs/design/zero-to-real/ZX-*.md`（cross-cutting 设计基准）
  - `docs/design/zero-to-real/ZX-qna.md`（Q1-Q10 已回填，含 Opus 约束）
- **核查实现**：
  - `workers/*/wrangler.jsonc` — 5 worker 配置事实
  - `workers/*/src/**` — 现有源码路径校对
  - `test/{package-e2e,cross-e2e,shared}/**` — 现有测试资产校对
  - `packages/nacp-core/**` / `packages/nacp-session/**` — 协议层事实
- **执行过的验证**：
  - `glob` 验证 `workers/agent-core/src/host/**/*.ts` 下 25 个文件全部存在
  - `glob` 验证 `workers/agent-core/src/host/do/nano-session-do.ts` 存在（路径正确）
  - `glob` 验证 `test/**/*.test.mjs` 下 29 个文件存在，包含 action-plan 引用的 `06-auth-negative`、`02-session-start`、`04-reconnect`、`11-orchestrator-public-facade-roundtrip`、`08-session-lifecycle-cross`、`09-capability-error-envelope-through-agent`、`02-agent-bash-tool-call-happy-path` — 全部存在
  - `glob` 验证 `workers/bash-core/src/tool-call.ts`、`policy.ts`、`workers/agent-core/src/llm/registry/models.ts`、`workers/agent-core/src/kernel/session-stream-mapping.ts`、`workers/agent-core/src/llm/session-stream-adapter.ts`、`test/shared/orchestrator-auth.mjs`、`test/shared/orchestrator-jwt.mjs`、`test/shared/live.mjs` — 全部存在
  - `glob` 验证 `workers/*/migrations/*.sql` — 零文件（符合预期，zero-to-real 将新建）
  - `grep` 验证 ZX-d1 design doc 中的 table naming convention（`nano_conversation_*` 前缀 vs action-plan 的 `nano_session_*` 前缀）
  - `grep` 全量 Q1-Q10 在 ZX-qna.md 中的业主回答字符串一致性（全部为 `"同意 GPT 的推荐，同意 Opus 的看法。"`）

### 1.1 已确认的正面事实

- `ZX-qna.md` 的 10 个 Q 全部获得 owner 正式回答。上一轮 design review 中标记为 critical 的 "QnA 全空" 风险已解除。
- Z1-Z4 的 phase 切分逻辑（先 contract+schema → worker skeleton → full flow → external bridge → negative tests+closure）与 charter §8 DAG 一致。
- Z0 的 "freeze audit → execution mapping → validation baseline → Z0 closure" 四阶段自身构成完整的 phase governance。
- Z5 的三阶段 "completion audit → final verdict → handoff pack" 明确定位为文档型收口 phase，不做代码修补（符合 charter §7.5 的 closure/handoff 交付物清单）。
- `packages/orchestration-auth-contract/` 作为 typed RPC contract package 进入 Z1 Phase 1，直接回应 Q1 Opus 约束第 1 条。
- Z2 Phase 4 采用两步 RPC kickoff（`status` smoke → `start` dual-impl），与 Q7 Opus 推荐完全一致。
- Z4 Phase 1→2 顺序为 web 先、Mini Program 后，与 Q10 Opus 约束第 4 条一致。
- Z1 Phase 1 将 `nano_team_api_keys` schema 纳入 Wave A（建表但不实现 verify path），与 Q4 Opus 推荐一致。
- 所有 action-plan 的 "涉及文件/模块" 引用的代码文件经 `glob` 验证全部真实存在（见 §1 验证命令输出）。
- Z1 §6 风险表中明确列出 "RPC-first auth bringup 受平台限制" 并给出 shim fallback 过渡路径——这是对 Q1 Opus 约束第 2 条的实际承接。

### 1.2 已确认的负面事实

- ZX-d1 design doc 使用 `nano_conversation_sessions` / `nano_conversation_turns` / `nano_conversation_messages` / `nano_conversation_context_snapshots` 命名，但 Z2 action-plan §2.1 S1 使用 `nano_sessions` / `nano_session_turns` / `nano_session_messages` / `nano_session_contexts`。
- ZX-d1 design doc 使用 `nano_usage_events` / `nano_quota_balances` 两张表，但 Z3 action-plan §4.4 P4-01 使用 `nano_usage_ledger`。
- ZX-d1 §0 已更新为引用 QnA frozen answers（line 21），但 action-plan 中没有一份文档逐条引用 QnA 的 Opus 详细约束（如 Q5 的 12 列字段清单、Q6 的容量上限、Q9 的 deny event 形态）。
- Z2 action-plan Phase 3 只说 "Q6 冻结的 DO hot-state 4 组最小集合" 但没有具体列出 4 组的名称和容量上限。
- Z1 action-plan Phase 3（P3-02）提到 "refresh rotation truth 进入 `nano_auth_sessions`" 但 Q2 Opus 明确要求 `kid`-based rotation + wrangler secret 落点——action-plan 说"用 `kid`/rotation baseline"但未指定 secret 命名约定 `JWT_SIGNING_KEY_<kid>` 和 access 1h / refresh 30d 的 lifetime。
- Z3 action-plan Phase 3（P3-01）说 "统一 llm/tool 额度门禁" 但 Q9 Opus 的 LLM gate 落点方案（`beforeLlmInvoke` hook 在 `runner.ts`）与 tool gate 落点方案（复用 `beforeCapabilityExecute`）未被 action-plan 的 "涉及文件" 列区分。
- `workers/*/migrations/` 目录全仓不存在，虽然 action-plan 标注 `[new]` 新建，但没有说明 migration 的执行触发 worker——所有 migration 都放在 `orchestrator-core/migrations/` 但 `orchestrator-core` 不是设计上的 D1 write 主力（auth 是 identity 写主力，agent-core 是 conversation 写主力）。

---

## 2. 审查发现

### R1. ZX-d1 与 Z2 action-plan 的 conversation 表命名存在结构性冲突

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md:175-178` — S2/S3 使用 `nano_conversations` / `nano_conversation_sessions` / `nano_conversation_turns` / `nano_conversation_messages` / `nano_conversation_context_snapshots`。
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md:335-339` — Write Ownership Matrix 中全部使用 `nano_conversation_*` 前缀。
  - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md:113` — S1 列出 `nano_sessions` / `nano_session_turns` / `nano_session_messages` / `nano_session_contexts`。
  - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md:160` — P1-01 工作内容为 "session / turn / message / context / activity tables"。
  - `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md:19` — 设计文档 Z2 明确说 "conversation 作为聚合中心"，强调 conversation 与 session 是两层不能混用。
- **为什么重要**：
  - 如果 Z2 action-plan 创建 `nano_sessions` 而 ZX-d1 期待 `nano_conversation_sessions`，后续 Z3（runtime evidence 写入）和 Z4（client history 读取）将引用不存在的表名。这会导致 migration SQL 与 ZX-d1 design 不一致、query helper 命名漂移、以及 Z2 closure 时 reviewer 无法用 ZX-d1 作为单一对照源。
  - 更根本的问题：Z2 设计文档的 §6.1 取舍 2 明确说 "conversation 作为聚合中心而不是 session_uuid"——`nano_conversation_sessions` 的命名反映这个架构思想：一张 sessions 表挂在 conversations 之下。`nano_sessions` 丢掉了 conversation 前置语义。这不是命名偏好，是架构编码。
  - `nano_session_contexts` vs `nano_conversation_context_snapshots` 差异更大——后者含 `snapshot` 关键词，为未来区分 "live context" 和 "snapshot context" 留空间，前者丢掉了这个区分。
- **审查判断**：
  - 这是实现期的硬阻断——如果在写 migration SQL 时才发现命名不一致，必须回头改 design 或 action-plan 中的一方。现在修正成本最低（改 action-plan 字符串），建议以 ZX-d1 为准。
- **建议修法**：
  - 将 Z2 action-plan §2.1 S1 和 §4.1 中的表名改为 `nano_conversations / nano_conversation_sessions / nano_conversation_turns / nano_conversation_messages / nano_conversation_context_snapshots`（与 ZX-d1 完全一致）。
  - 将 `nano_session_contexts` 改为 `nano_conversation_context_snapshots`（这是语义差异最大的一个）。
  - 在 P1-01 wave-B migrations 的工作内容中增加一句 "表名严格沿用 ZX-D1 §7.2 Write Ownership Matrix 的命名"。

---

### R2. Z3 action-plan 的 `nano_usage_ledger` 与 ZX-d1 的 `nano_usage_events` / `nano_quota_balances` 不一致

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md:177` — S5 为 `nano_usage_events` / `nano_quota_balances`。
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md:109` — 扩展点表中注明 "quota tables = `nano_usage_events` / `nano_quota_balances`"。
  - `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md:184` — P4-01 工作内容写 "落 `nano_usage_ledger`、quota balance/read model 等 durable tables"。
  - `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md:35` — migration 文件名为 `003-usage-and-quota.sql`（与 ZX-d1 migration wave 命名对齐，但内部的表名不匹配）。
- **为什么重要**：
  - `nano_usage_ledger` 暗示一张包含借贷记账的 ledger 表（有 debit/credit 列），而 ZX-d1 的设计是 `nano_usage_events`（event-sourced usage）+ `nano_quota_balances`（materialized balance view）。这是两种不同的数据建模范式——event-sourcing vs double-entry ledger。如果 action-plan 暗示 ledger 模式但 migration SQL 写 event 模式，实现期会产生混乱。
  - 同样影响 Z3 Phase 4 的 `audit/eval evidence`（P4-02）——evidence 写到哪张表取决于表名。
- **审查判断**：
  - 与 R1 同级别，必须在 migration SQL 编写前修正。
- **建议修法**：
  - 将 Z3 action-plan P4-01 和所有引用处的 `nano_usage_ledger` 改为 `nano_usage_events` + `nano_quota_balances`（与 ZX-d1 一致）。
  - 在 P4-01 收口标准中明确定义 "usage events 为 append-only event log，quota balances 为 materialized read model（可由 views 派生或由 quota authorizer 同步更新）"。

---

### R3. ZX-qna Opus 详细约束被 action-plan 显式吸收率约 60%，剩余精度回退可能导致实现期重开设计讨论

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - Q5 Opus 最终回答要求 `nano_session_activity_logs` 包含 **12 个具体列**（含 `actor_user_uuid`、`event_seq`、`severity` 等 Q5 原推荐未覆盖的列）以及 **3 条强制 index**。Z2 action-plan P1-01 只说 "activity tables"，未列出列清单。
  - Q6 Opus 最终回答要求 **4 组热态的容量上限**（conversation_index ≤ 200、recent_frames ≤ 50、cache TTL ≤ 5min、Alarm every 10min 的 trim/expire/refresh 职责清单）。Z2 action-plan P3-01 只说 "DO hot-state 4 组最小集合"，未列出容量上限。
  - Q9 Opus 最终回答要求 **deny 必须写带 `event_kind='quota.deny'`、`severity='warn'`、含 deny reason + remaining balance + requested cost** 的 activity log 记录，并要求 user-visible stream 抛 `code='QUOTA_EXCEEDED'` 错误。Z3 action-plan P3-01 说 "reject reason 稳定" 和 "balance/usage 写回路径存在" 但未引用具体的 event_kind 和 severity 枚举值。
  - Q2 Opus 最终回答要求 **JWT header 含 `kid`、secret 落点 wrangler secret 命名约定 `JWT_SIGNING_KEY_<kid>`、access 1h / refresh 30d**。Z1 action-plan P3-02 说 "使用 HS256 + kid + single-sign + dual-verify-window" 但未指定 lifetime 或 secret 命名约定。
- **为什么重要**：
  - Opus 约束不是可有可无的——它们是 owner 在 QnA 阶段接收的唯一详细技术回答（"同意 GPT 的推荐，同意 Opus 的看法" 意味着两个口径同时成立）。如果 action-plan 不显式落地这些约束，实现者面临两个风险：(a) 只看 action-plan 会漏掉 Opus 约束，导致 closure 时 reviewer 以 QnA Opus 约束为标尺拒绝；(b) 实现者自己推断时产生与 Opus 不同的选择，造成返工。
  - 这不是要求 action-plan 逐字复制 QnA 内容，而是要求关键约束（列清单、容量上限、命名约定）被 action-plan 的 "工作内容" 或 "收口标准" 显式引用，使得实现者看一份文档就够了。
- **审查判断**：
  - action-plan 对 QnA GPT 推荐口径的吸收已经较好（方向性决策如 "WorkerEntrypoint RPC-first"、"dual gate"、"HTTP + WS baseline" 都进入了 plan）。但对 Opus 补充的精确约束吸收不足——这些约束恰恰是 Opus 在 QnA 阶段额外增加的、GPT 原推荐未覆盖的精度层。
- **建议修法**：
  - 在 Z1 P3-02 收口标准中追加 "JWT access lifetime = 1h, refresh lifetime = 30d, secret 命名 `JWT_SIGNING_KEY_<kid>`"。
  - 在 Z2 P1-01 工作内容中追加 "activity_logs 表包含 Q5 冻结的 12 列 + 3 条 index，payload 写入侧复用 `packages/nacp-session/src/redaction.ts`"。
  - 在 Z2 P3-01 收口标准中追加 "capacity limits: conversation_index ≤ 200, recent_frames ≤ 50, cache TTL ≤ 5min, Alarm every 10min 执行 trim/expire/refresh"。
  - 在 Z3 P3-01 收口标准中追加 "deny 写 `nano_session_activity_logs` with `event_kind='quota.deny'`, `severity='warn'`, user-visible error `code='QUOTA_EXCEEDED'`"。

---

### R4. D1 migration 的执行触发 worker 在所有 action-plan 中未明确

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md:165` — Wave-A migration 放在 `workers/orchestrator-core/migrations/001-identity-core.sql`。
  - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md:200` — Wave-B migration 放在 `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`。
  - `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md:291` — Wave-C migration 放在 `workers/orchestrator-core/migrations/003-usage-and-quota.sql`。
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md:60-62` — "服务于 `orchestration.auth`、`orchestration.core`、`agent.core`"。
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md:335-339` — Write Ownership Matrix 中 identity 表由 `orchestration.auth` 主写、conversation 表由 `orchestration.core` 和 `agent.core` 分担。
- **为什么重要**：
  - 三份 migration 文件都放在 `orchestrator-core/migrations/` 下，暗示 `orchestrator-core` 是 migration runner。但 ZX-d1 的 write ownership 把 identity 写权限给 `orchestration.auth`、conversation session 写权限给 `orchestration.core`、turn/message/context 写权限给 `agent.core`。
  - 如果 `orchestrator-core` 既是 Z2 migration runner 又是 conversation session 的写 owner，这本身是合理的。但 Z1 migration（identity core）的 run 时机在 `orchestration.auth` 创建 **之前**（Z1 Phase 2），而 identity 表的写 owner 是 `orchestration.auth`——这里存在 chicken-and-egg：谁在 `orchestration.auth` 还不存在时运行 identity migration？
  - 更稳健的方案在 ZX-d1 中被提及但未被执行：设计 doc 说 "由 `orchestration.auth` 触发 migration"，但 action-plan 把 migration 放在 `orchestrator-core`。需要澄清一致。
- **审查判断**：
  - 这不会阻止 Z1 启动（可以手动 `wrangler d1 execute`），但 action-plan 应明确 migration trigger strategy，避免 Z2/Z3 的增量 migration 出现在迁移顺序意外。
- **建议修法**：
  - 在 Z1 action-plan 中追加一条说明：migration runner = `orchestrator-core`（在所有 wave），理由：它是唯一可对外部署的 worker（auth worker internal-only 不可以有独立 deploy pipeline），D1 migration 由它在 `blockConcurrencyWhile` 中执行 idempotent check。
  - 或者另一种方案：新建 `workers/d1-migrator/` 专门跑 migration。两种方案选一并在 action-plan 中写死。

---

### R5. Z2 action-plan Phase 5 的 audit evidence 收口标准不够具体

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md:325-326` — P5-02 收口标准为 "replay/activity/readback 测试全绿"。
  - `docs/charter/plan-zero-to-real.md:546` — Z2 收口标准第 6 条 "real loop 已达到最低可审计基线"。
  - `docs/design/zero-to-real/ZX-qna.md:152-169` — Q5 Opus 详细列出 activity logs 的 12 列、3 条 index、redaction discipline、以及一条 view 命名。
- **为什么重要**：
  - "测试全绿" 无法等价于 "达到最低可审计基线"——审计基线需要证明：(a) append-only 约束成立（无法 update/delete row）；(b) redaction 确实过滤了敏感字段；(c) trace_uuid / session_uuid 链路完整（每一行都能反向索引）。仅靠现有的 package-e2e green 无法覆盖这些审计属性。
  - 如果 Z2 closure 只引用测试 green 作为证据，Z5 completion audit 可能判定 Z2 的 audit 面未真收口。
- **审查判断**：
  - 收口标准需要从 "测试全绿" 细化为可验证的审计属性清单。
- **建议修法**：
  - 将 P5-02 收口标准改为三条：(a) D1 写入覆盖 append-only 证明（至少 1 条负例：尝试 UPDATE/DELETE activity_log 行被拒绝）；(b) redaction 覆盖证明（至少 1 条测试：带敏感字段的 payload 经 redaction wrapper 后不含明文 secret/token）；(c) trace linkage 证明（至少 1 条测试：通过 trace_uuid 可完整查询同 trace 的所有 activity events）。

---

### R6. Z2 action-plan 的 P3-01 "DO hot-state compaction" 工作项缺少对现有 DO storage（key-value）的迁移讨论

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts`（788 行）当前全部使用 `state.storage.get/put/delete`（key-value API）。
  - `workers/agent-core/src/host/do/nano-session-do.ts` 当前使用 `state.storage`（key-value），并有 `getTenantScopedStorage()` 租户范围存储。
  - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md:171` — P3-01 修改文件列表中同时包括 `user-do.ts` 和 `nano-session-do.ts`，工作内容为 "让 DO 只保留 activeWsBindings、lastReplayCursor/seq、latestTransportMeta、pendingSinceLastCheckpoint"。
  - `docs/design/zero-to-real/ZX-qna.md:206-208` — Q6 Opus 要求 "清空 DO storage 后 reconnect 仍能从 D1 恢复 last 50 frames" 作为重建 invariant 测试。
- **为什么重要**：
  - 当前 DO 已经在 key-value storage 中存放了 session registry、auth snapshots、ended index 等状态。Z2 的 "hot-state compaction" 需要：(a) 清掉哪些 key；(b) 把哪些现有 key-value 数据迁移到 D1；(c) 新增哪些 key 作为 compacted hot-state；(d) DO SQLite（`state.storage.sql`）是否加入。
  - ZX-d1 §3.3 和 Q6 都区分 "D1 = SSOT, DO = hot-state"，但 action-plan P3-01 没有给出从现有 key-value DO → compacted DO 的迁移步骤。实现者面对 788 行现有 DO 代码时，"只保留 4 组" 的指令是不够的——需要知道哪些现有 key 要删、哪些 D1 表要补。
- **审查判断**：
  - 这是一个 "实现指引不够具体" 的 gap。不会阻断 Z2 启动（可以先不碰现有 DO storage，只加新的），但会影响 Z2 closure 时 "是否真完成了 compaction" 的判断。
- **建议修法**：
  - 在 P3-01 工作内容中追加一条："清点当前 `user-do.ts` 的 state.storage key 使用情况，区分三种命运：(a) 移到 D1（如 session registry → nano_conversation_sessions）；(b) 保留在 compacted hot-state（如 activeWsBindings / replay cursor）；(c) 废弃（如 ended index → D1 query 替代）。在 Z2 closure 中记录迁移完成情况。"

---

### R7. Z1 action-plan Phase 3（P3-02 refresh/reset/token rotation）的收口标准过于依赖 "实现期自行推断"

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md:179` — P3-02 收口标准为 "access / refresh 行为符合 Q2"。
  - `docs/design/zero-to-real/ZX-qna.md:63-68` — Q2 Opus 回答明确：(1) JWT header 含 `kid`；(2) secret 命名约定 `JWT_SIGNING_KEY_<kid>`；(3) claim 集 `{user_uuid, team_uuid, team_plan_level, kid, iat, exp}`；(4) access 1h / refresh 30d / rotate-on-use。
  - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md:284` — 收口标准又说 "access / refresh 行为符合 Q2"、"me / tenant readback 与 D1 truth 一致"、"invalid/revoked token 被 typed reject"。
- **为什么重要**：
  - "符合 Q2" 太模糊——实现者需要打开 QnA 才能知道 Q2 要求三件事（kid / naming / lifetimes）。而 Q2 的 Opus 回答又依赖于 review R12 的 refresh-token lifetime 决定（Q2 文末明确写了 "此题与 review R12 强相关"）。
  - refresh-token lifetime 和 rotation 行为（rotate-on-use / per-refresh revoke / keep-old-until-expire）是安全基线，不能靠实现者自己推测。
- **审查判断**：
  - 收口标准需要包含具体的 token lifetime 和 rotation 策略，而不是只写 "符合 Q2"。
- **建议修法**：
  - 将 P3-02 收口标准改为三条：(a) access token 1h, refresh token 30d, rotate-on-use；(b) JWT header 含 `kid`，secret 落点 wrangler secret `JWT_SIGNING_KEY_<kid>`；(c) old-kid token 在 dual-verify 窗口内仍能验证，窗口结束后必须 reject。

---

### R8. Z2 action-plan 的 P4-02 "internal start kickoff" 未给出 parity proof 的判定形式

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md:180` — P4-02 收口标准为 "public `start` 与 internal `start` 共享同一 durable truth"。
  - `docs/design/zero-to-real/ZX-qna.md:234-236` — Q7 Opus 回答明确：parity 判定 = "(a) 返回 envelope deep-equal；(b) D1 写入 row diff = ∅；(c) NACP authority/trace stamp 一致"。
- **为什么重要**：
  - "共享同一 durable truth" 不够精确——它可以被解释为 "两个 path 都写 D1"，但 parity 被证伪的情况包括：(a) envelope 相同但 D1 写入多了额外行；(b) D1 相同但 authority stamp 不一致。Opus 的三条判定给了一个可机器验证的 check list，而 action-plan 把它缩成一句自然语言。
- **审查判断**：
  - 与 R3 同类——QnA Opus 约束未被 action-plan 充分吸收。如果 closure 时 reviewer 用 Opus 的 parity checklist 来衡量 P4-02 的完成度，当前收口标准不够。
- **建议修法**：
  - 将 P4-02 收口标准改为三条明确的 parity 判定条件（envelope deep-equal, D1 row diff zero, NACP stamp 一致），与 Q7 Opus 回答对齐。

---

### R9. Z1 action-plan Phase 4 (WeChat Bridge) 未区分 "code-level smoke" 与 "真实 Mini Program 联调"

- **严重级别**：`low`
- **类型**：`test-gap`
- **事实依据**：
  - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md:184` — P4-01 收口标准为 "`code -> openid -> JWT` 可跑通，失败不留下脏中间态"。
  - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md:303` — 测试方式为 "Mini Program 开发者工具 smoke"。
  - `docs/charter/plan-zero-to-real.md:478` — Z1 收口标准第 5 条 "用 Mini Program 开发者工具或等价 mock 至少跑通一次 `code -> openid -> JWT` code-level 链路"。
- **为什么重要**：
  - Charter 明确允许 "开发者工具或等价 mock" 作为 Z1 的 WeChat proof。Action-plan P4-01 的 "Mini Program 开发者工具 smoke" 与此对齐。（注意：真正的 Mini Program 真机调测是 Z4 的责任，不在 Z1 scope。）
  - 但从 action-plan 的 P4-01 收口标准来看，"失败不留下脏中间态" 是一个强的跨表一致性要求——它意味着如果 WeChat `jscode2session` 成功但 `create user` 失败，必须回滚 user/profile/identity 的写入。action-plan 的测试方式只写 "package-e2e / manual smoke"，没有描述如何构造 `jscode2session` 成功但后续失败的场景。
- **审查判断**：
  - 这是实现细节层面的 gap，不阻塞 Z1 启动，但在 closure 阶段可能形成 blind spot。
- **建议修法**：
  - 在 P4-01 测试方式中追加 "package-e2e 必须覆盖 jscode2session mock 成功但下游 D1 写入失败的恢复场景"。

---

### R10. Z3 action-plan 未明确 `nano_tenant_secrets` 是否在 Wave C migration 中建表

- **严重级别**：`low`
- **类型**：`scope-drift`
- **事实依据**：
  - `docs/design/zero-to-real/ZX-qna.md:267` — Q8 Opus 回答第 3 条明确 "`nano_tenant_secrets` 暂不建表"（等 BYO-key 真实需求出现再 wave-N 加表）。
  - `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md:35` — Wave C migration 为 `003-usage-and-quota.sql`。
  - Z3 action-plan P4-01 只提到 "usage/balance/quota tables"，未提及 `nano_tenant_secrets`——这是正确的（不建表），但 action-plan 没有一条显式的 "out-of-scope" 说明来防止实现者惯性建表。
- **为什么重要**：
  - Opus 明确反对 "建了不用" 的反模式。如果实现者在 `003-usage-and-quota.sql` 中顺手加上 `nano_tenant_secrets`（因为 ZX-d1 提到了这张表且 Q8 提到了 BYO key），会引入一张永远为空的表。
- **审查判断**：
  - 当前 action-plan 没有违反 Q8 Opus 约束（因为没有说要建这张表），但也没有显式防御。建议在 Z3 §2.3 boundary 表或 P4-01 工作内容中加一条显式排除说明。
- **建议修法**：
  - 在 Z3 action-plan P4-01 工作内容中追加 "不建 `nano_tenant_secrets`（Q8 已冻结：BYO key 需求后延）"。

---

### R11. Z4 action-plan 对 Mini Program 的 WS heartbeat/replay 接入缺少对 `nacp-session` 既有资产的显式引用

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/design/zero-to-real/ZX-qna.md:322-323` — Q10 Opus 回答第 1/2 条要求 "WS 必须使用 `packages/nacp-session/src/heartbeat.ts`" 和 "WS 重连必须使用 `replay.ts` 的 cursor"。
  - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md:171` — P3-01 工作内容说 "用真实客户端验证 disconnect/reconnect/heartbeat/replay cursor"。
  - Z4 action-plan P3-01 未在 "涉及文件/模块" 中列出 `packages/nacp-session/src/heartbeat.ts` 或 `replay.ts`。
- **为什么重要**：
  - heartbeat 和 replay cursor 不是从零写的——它们已经在 nacp-session 中存在现成实现。Q10 Opus 明确要求 "显式接入既有资产" 而非重写。如果实现者不看 QnA 而只看 action-plan，可能尝试在客户端重新实现 heartbeat，导致两份实现分叉。
- **审查判断**：
  - 这是一个 reference gap——不阻断执行但会增加实现期返工。
- **建议修法**：
  - 在 Z4 P3-01 的 "涉及文件/模块" 中追加 `packages/nacp-session/src/heartbeat.ts` 和 `packages/nacp-session/src/replay.ts`，并在工作内容中追加 "复用 nacp-session 既有 heartbeat interval (≤25s, server-initiated) 和 replay cursor 机制"。

---

### R12. Z2 action-plan Phase 1 仅关注表创建，缺少对 D1 binding 配置（wrangler）的显式工作项

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - 全仓 5 个 worker 的 wrangler.jsonc 中均无 `[[d1_databases]]` binding。
  - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md:201-202` — Phase 1 修改文件列表中包含 `workers/orchestrator-core/wrangler.jsonc`，但未在 P1-01 工作内容中显式说明需要添加 `[[d1_databases]]` binding。
  - Z1 action-plan Phase 1 同样修改 `wrangler.jsonc`，但也未显式说明 D1 binding 添加。
- **为什么重要**：
  - 从零引入 D1 需要三步：(a) wrangler 配置 `[[d1_databases]]`；(b) `env.DB` type 声明；(c) migration SQL。当前 action-plan P1-01 只覆盖了 (c)，对 (a) 和 (b) 依赖 "修改 wrangler.jsonc" 这一行隐式覆盖。但有的 worker（如 `bash-core`）可能也需要 D1 access（写 usage events）——其 wrangler 也要改。
- **审查判断**：
  - 这是执行细节层面的遗漏。不阻塞启动，但建议在 P1-01 工作内容中显式列出需要添加 `[[d1_databases]]` 的 worker 清单。
- **建议修法**：
  - 在 Z1 P1-02 和 Z2 P1-01 工作内容中追加 "在 `orchestrator-core/wrangler.jsonc` 中添加 `[[d1_databases]]` binding，database_name = `nano-agent-db`，binding = `DB`"。
  - 在 Z3 Z3 相关 phase 中追加 `agent-core` 和 `bash-core` 的 D1 binding（如果它们需要读写 usage/balance）。

---

### R13. Z5 action-plan 的类型标记为 "modify" 与实际内容不匹配

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md:5` — 类型标记为 `modify`。
  - Z5 的工作内容为 "汇总 Z0-Z4 的交付、验证、残留问题"——纯文档产出，不涉及代码修改。
  - Z4 action-plan 类型为 `new`（创建 clients/），Z1-Z3 类型为 `migration`（有代码变更），Z0 类型为 `modify`（修改文档基线）。
- **为什么重要**：
  - 类型标记影响 reviewer 和下一阶段规划者对 "本 phase 是否需要 run tests / deploy" 的预期。Z5 既然是纯文档产出，用 `modify` 可能产生 "需要改已有文件" 的误解。
- **审查判断**：
  - 微小不一致，不改无实质影响。
- **建议修法**：
  - 将 Z5 action-plan 类型改为 `update`（文档更新型 phase）或新增一个 `closure` 类型。

---

### R14. 各 action-plan 的 "预估工作量" 标签（S/M/L）缺少与 LOC 或人天的映射定义

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - Z1-Z4 的 Phase 总览表中大量使用 `S` / `M` / `L` / `XS` 作为预估工作量。
  - 例如 Z1 Phase 3（Full User Auth Flow）标记为 `L`，而 Z1 Phase 1（Contract + Wave A Schema）标记为 `M`。
  - 没有任何地方定义 `S` = 多少小时/天/行代码。
- **为什么重要**：
  - 不影响 phase 间排序的正确性，但影响总体工期判断。下一步编排 timeline 时需要知道 "Z1 的 2M + 2L + 1S 大约是多少周"。
- **审查判断**：
  - 非阻塞。如果下一阶段要排 timeline，需要在 Z0 或 Z5 中补一个 size mapping 定义。
- **建议修法**：
  - 可选：在 Z0 action-plan §1.2 中追加 "S = 1-3 天, M = 3-7 天, L = 1-3 周, XS = 半天内" 的约定。

---

## 3. In-Scope 逐项对齐审核

> 本节以 **各 action-plan §2.1 的 In-Scope 清单** 为基准，逐项对照 **charter §7** 的 phase 要求 与 **Z-X design docs + ZX-qna** 的约束，判断 action-plan 的承接是否完整、精确。  
> 结论统一使用：`done | partial | missing | out-of-scope-by-design`。

### 3.1 Z0 — Contract and Compliance Freeze

| 编号 | 审查项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S01 | Charter §7.1 In-Scope #1–#6 + Design-handoff #7–#11 | `done` | P1-01 覆盖 charter freeze audit，P2-01/P2-02 覆盖 execution mapping 与 deliverable path freeze。design-handoff 项映射到 Z1-Z5，由 P2-01 cross-cutting dependency map 承载。 |
| S02 | Q1-Q10 frozen answers 的消费路径已固化 | `done` | Z0 §4.2 P2-01 要求 "每个 phase 明确消费哪些 Q 编号"。Z1-Z4 的关联文档列表均已引用 `ZX-qna.md`。 |
| S03 | Code-anchor audit 将 action-plan 锚定到真实目录 | `done` | P1-02 要求 "对照 wrangler.jsonc、src/**、test/** 确认锚点真实存在"。当前审查已验证 action-plan 引用的代码路径均为真实存在。 |

### 3.2 Z1 — Full Auth + Tenant Foundation

| 编号 | 审查项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S04 | S1: 新建 `packages/orchestration-auth-contract/` | `done` | P1-01 创建 typed RPC contract package，直接回应 Q1 Opus 第 1 条约束。 |
| S05 | S2: 新建 `workers/orchestration-auth/` internal-only worker | `done` | P2-01 创建 auth worker scaffold + wrangler config，P2-02 将 orchestrator 降级为 proxy-only。 |
| S06 | S3: Wave A D1 schema（identity core + auth_sessions + team_api_keys） | `partial` | P1-02 建表清单包含了所有 7 张表。Q2 Opus 的 `kid`-based rotation 默认 access 1h/refresh 30d 未在 P1-02 收口标准中显式落地（见 R7）。Q4 的 schema reserved + impl defer 已正确执行。 |
| S07 | S4: register/login/verify/refresh/reset/me | `partial` | P3-01/P3-02 覆盖全链路。refresh token lifetime 和 kid 命名约定未在收口标准中显式列出（见 R3/R7）。 |
| S08 | S5: WeChat bridge | `done` | P4-01 覆盖 `code -> openid -> JWT`。Q3 Opus 约束的三条（默认 team 命名确定性、email 路径同样自动建 team、membership=owner）已进入 P4-02。 |
| S09 | S6: 双租户 negative tests + Z1 closure | `done` | P5-01 覆盖 forged token/tenant mismatch/non-orchestrator caller 负例，test files 路径全部真实存在。 |

### 3.3 Z2 — Session Truth + Audit Baseline

| 编号 | 审查项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S10 | S1: Wave B D1 schema (session/turn/message/context/activity) | `partial` | **表命名不一致：action-plan 使用 `nano_sessions` 等简写，ZX-d1 使用 `nano_conversation_sessions` 等全名前缀**（见 R1）。Q5 Opus 的 12 列 + 3 index 未落地到 action-plan（见 R3）。 |
| S11 | S2: public session durable truth | `done` | P2-01/P2-02 让 `start/input/history/timeline/verify` 读写 D1。新增 activity log append path 与 redaction discipline。 |
| S12 | S3: DO hot-state 4 组最小集合 + 10min alarm checkpoint | `partial` | 4 组概念已进入 P3-01，但**容量上限未显式列出**（见 R3）。现有 DO key-value state 的迁移步骤缺失（见 R6）。 |
| S13 | S4: heartbeat/replay cursor/reconnect baseline | `done` | P3-02 覆盖 replay cursor、heartbeat ack、alarm snapshot/recover。 |
| S14 | S5: internal `status` RPC smoke + `start` kickoff | `done` | P4-01/P4-02 采用 Q7 Opus 两步走。P4-02 的 parity proof 判定形式不够精确（见 R8）。 |
| S15 | S6: append-only activity log + redaction discipline | `partial` | P2-02 与 P5-01 覆盖了 append path。**审计属性的具体证明条件缺失**（见 R5）。Redaction 复用 `nacp-session/src/redaction.ts` 未在涉及文件中引用。 |

### 3.4 Z3 — Real Runtime + Quota

| 编号 | 审查项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S16 | S1: Workers AI mainline provider | `done` | P1-01 冻结 `AI` binding + model registry。Q8 Opus fc smoke gate 和 escalation path 未显式落地（见 R3）。 |
| S17 | S2: real llm execution path | `done` | P2-01/P2-02 将真实 LLM 执行接入 agent loop，session stream/runtime mapping 同步。 |
| S18 | S3: llm + tool 双 quota gate | `partial` | P3-01/P3-02 覆盖 llm gate 和 tool gate。**Q9 Opus 的 deny event 可观测形态（event_kind='quota.deny', severity='warn', user error code='QUOTA_EXCEEDED'）未在收口标准中落地**（见 R3）。LLM gate 代码落点（`beforeLlmInvoke` hook）未在 action-plan 中指定。 |
| S19 | S4: usage/balance/quota tables + audit evidence | `partial` | P4-01/P4-02 覆盖。**`nano_usage_ledger` 与 ZX-d1 的 `nano_usage_events` + `nano_quota_balances` 不一致**（见 R2）。`nano_tenant_secrets` 不建表的显式排除说明缺失（见 R10）。 |
| S20 | S5: runtime evidence 进入 activity/audit/eval stream | `done` | P4-02 覆盖 accepted/rejected evidence 写入。 |

### 3.5 Z4 — Real Clients + First Real Run

| 编号 | 审查项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S21 | S1: `clients/web/` baseline | `done` | P1-01/P1-02 创建 web client + auth/session integration。Q10 的 web-first 顺序约束已遵守。 |
| S22 | S2: `clients/wechat-miniprogram/` baseline | `done` | P2-01/P2-02 创建 Mini Program + WeChat auth/session integration。Q10 的 transport baseline（HTTP start/input + WS stream/history）已进入。 |
| S23 | S3: heartbeat/replay cursor/quota/error disclosure hardening | `partial` | P3-01/P3-02 覆盖 stateful gap fix。**Q10 Opus 要求的 nacp-session heartbeat/replay 既有资产显式引用缺失**（见 R11）。 |
| S24 | S4: first real run evidence + residual inventory | `done` | P4-01/P4-02 覆盖 evidence pack 与 gap triage。 |

### 3.6 Z5 — Closure and Handoff

| 编号 | 审查项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S25 | S1: completion audit（Z0-Z4 closure + tests + evidence） | `done` | P1-01/P1-02 覆盖逐阶段审计。 |
| S26 | S2: final verdict | `done` | P2-01/P2-02 覆盖 Z5-closure 与 final-closure。 |
| S27 | S3: handoff pack | `done` | P3-01 覆盖 next-phase handoff + residual register。 |

### 3.7 对齐结论

- **done**: 18
- **partial**: 9
- **missing**: 0

> 这更像 **"核心工程逻辑已成立，但部分设计级约束（表命名、列清单、容量上限、deny event 形态）尚未被精确转写到 action-plan 的收口标准中"** 的状态。修正 9 处 partial 项（主要是 R1/R2 的命名修正 + R3 的 Opus 约束吸收）即可进入实施。

---

## 4. Out-of-Scope 核查

> 本节对照 charter §4.2 全局 Out-of-Scope 清单，检查 action-plan 是否在 scope 边界上合规。

| 编号 | Out-of-Scope 项（charter §4.2） | 审查结论 | 说明 |
|------|-------------------------------|----------|------|
| O01 | 完整 admin plane | `遵守` | Z1 §2.2 O1 排除完整 tenant/member/API key admin plane。 |
| O02 | 完整 API key admin plane | `遵守` | Z1 §2.3 将 API key verify runtime impl 标记为 out-of-scope（Q4: schema only）。 |
| O03 | 所有 stream/relay/WS 一步到位全面 RPC-only | `遵守` | ZX-binding 固定 stream-plane 可过渡；Z2 §2.2 O4 排除 HTTP public surface 全面退役。 |
| O04 | cold archive / R2 offload | `遵守` | 无任何 action-plan 包含 R2/cold tier 工作项。 |
| O05 | full quota policy / ledger / alerts plane | `遵守` | Z3 §2.2 O1 排除细粒度 billing/statement；但注意 R2（`nano_usage_ledger` 命名可能暗示 ledger 模式）。 |
| O06 | collaboration richness 全量化 | `遵守` | Z2 §2.2 O1 排除。 |
| O07 | NACP 之外的新协议家族扩张 | `遵守` | 所有 action-plan 均基于 nacp-core/nacp-session。 |
| O08 | tenant-facing admin UI | `遵守` | Z4 client 只做最小验证面（§2.2 O1 排除产品级 UI）。 |
| O09 | platform-level observability dashboard / metrics / ops plane | `遵守` | 无任何 action-plan 包含 dashboard/metrics。 |

> **Out-of-Scope 核查结论：全部遵守。** 仅 O05 存在微小的命名风险（R2 中 `nano_usage_ledger` 的 "ledger" 一词可能被误解为 ledger 模式），修正 R2 即可消除。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`6 份 action-plan 的 phase 切分、执行顺序、工作项粒度、测试策略与 closure 路径在宏观上成立。Z0-Z5 的 DAG 链完整（Z0 governance → Z1 auth → Z2 session → Z3 runtime → Z4 clients → Z5 closure），每阶段的前置依赖清晰。在修正 2 处 critical 命名不一致（R1/R2）和补完 3 处 QnA Opus 约束的精度回退（R3）后，可直接进入 Z1 实施。`

- **是否允许关闭本轮 review**：`no`

- **关闭前必须完成的 blocker**：
  1. **修正 R1（conversation 表命名）**：将 Z2 action-plan 所有 `nano_sessions` / `nano_session_turns` / `nano_session_messages` / `nano_session_contexts` 改为 ZX-d1 的 `nano_conversation_sessions` / `nano_conversation_turns` / `nano_conversation_messages` / `nano_conversation_context_snapshots`。
  2. **修正 R2（usage 表命名）**：将 Z3 action-plan 的 `nano_usage_ledger` 改为 `nano_usage_events` + `nano_quota_balances`，对齐 ZX-d1。
  3. **补完 R3 的核心约束吸收**：在 Z1 P3-02 收口标准中追加 token lifetime 和 secret 命名约定；在 Z2 P1-01 中追加 activity log 的 12 列 + 3 index 要求；在 Z2 P3-01 中追加 DO hot-state 容量上限；在 Z3 P3-01 中追加 deny event 可观测形态（event_kind/severity/user error code）。

- **可以后续跟进的 non-blocking follow-up**：
  1. **R4（migration trigger worker）**：在 Z1 中明确 D1 migration runner = `orchestrator-core`。
  2. **R5（Z2 audit closure 收口标准细化）**：将 "测试全绿" 改为可验证的审计属性清单（append-only proof + redaction proof + trace linkage proof）。
  3. **R6（DO key-value → compacted hot-state 迁移步骤）**：在 Z2 P3-01 中追加现有 state.storage key 的清点与分类指引。
  4. **R7（refresh token lifetime 显式化）**：按 Q2 Opus 约束在 Z1 P3-02 收口标准中写明 access 1h / refresh 30d / rotate-on-use。
  5. **R8（parity proof 判定形式）**：在 Z2 P4-02 中按 Q7 Opus 的三条判定补充收口标准。
  6. **R9（WeChat 失败场景测试）**：在 Z1 P4-01 中追加 D1 写入失败恢复的 package-e2e 覆盖。
  7. **R10（nano_tenant_secrets 显式排除）**：在 Z3 P4-01 中追加 "不建 nano_tenant_secrets" 的说明。
  8. **R11（nacp-session 既有资产引用）**：在 Z4 P3-01 涉及文件中追加 heartbeat.ts / replay.ts 路径。
  9. **R12（D1 binding wrangler 配置）**：在各阶段 migration 工作项中显式列出需要添加 `[[d1_databases]]` 的 worker 清单。
  10. **R13（Z5 类型标记）**：将 Z5 类型从 `modify` 改为 `update` 或 `closure`。
  11. **R14（S/M/L 映射定义）**：在 Z0 中追加工作量标签的 size mapping。

> 本轮 review 不收口。等待 action-plan author 按 §5 的 3 个 blocker 修正后，再进行二次审查。9 条 non-blocking follow-up 可在二次审查前或二次审查后分别处理，不阻塞 Z1 启动。

