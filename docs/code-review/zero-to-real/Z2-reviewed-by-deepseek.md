# Nano-Agent 代码审查模板

> 审查对象: `zero-to-real / Z2 Session Truth and Audit Baseline`
> 审查时间: `2026-04-25`
> 审查人: `deepseek`
> 审查范围:
> - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`
> - `workers/orchestrator-core/src/session-truth.ts`
> - `workers/orchestrator-core/src/user-do.ts`
> - `workers/orchestrator-core/src/index.ts`
> - `workers/orchestrator-core/src/auth.ts`
> - `workers/orchestrator-core/src/policy/authority.ts`
> - `workers/orchestrator-core/wrangler.jsonc`
> - `workers/agent-core/src/index.ts`
> - `workers/agent-core/src/host/internal.ts`
> - `workers/agent-core/src/host/internal-policy.ts`
> - `workers/agent-core/src/host/session-edge.ts`
> - `workers/agent-core/src/host/routes.ts`
> - `workers/agent-core/src/host/ws-controller.ts`
> - `workers/agent-core/src/host/checkpoint.ts`
> - `workers/agent-core/src/host/do/nano-session-do.ts`
> - `workers/agent-core/wrangler.jsonc`
> - `workers/orchestrator-auth/src/wechat.ts`
> - `workers/agent-core/test/rpc.test.ts`
> - `workers/orchestrator-core/test/user-do.test.ts`
> - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`
> - `docs/issue/zero-to-real/Z2-closure.md`
> - `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md`
> - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
> - `docs/design/zero-to-real/ZX-qna.md`
> - `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md`
> - `docs/charter/plan-zero-to-real.md`
> - `context/ddl-v170/smind-01-tenant-identity.sql`
> - `context/smind-admin/src/modules/identity/auth.service.ts`
> - `docs/issue/zero-to-real/Z1-closure.md`
> - `docs/code-review/zero-to-real/Z0-Z1-reviewed-by-deepseek.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`Z2 的 session truth 主体工程已落地，但存在一个跨设计文档的系统性冲突（write ownership matrix 的 ZX-D1 vs Z2 action-plan 方向矛盾），以及 schema 字段级与 Q5 冻结答案之间的多处不一致。当前不应视为可以直接关闭的 completed 状态。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `ZX-D1 §7.3.5 冻结的 write ownership matrix（agent.core 拥有 turns / messages / context snapshots）与实际代码（orchestrator-core 单一写入全部表）之间存在系统性的设计-实现断层，这不是小偏差，而是结构层面的 ownership 矛盾。`
  2. `Q5 冻结的 12 列 activity log 字段中，actor_user_uuid / conversation_uuid / session_uuid 被冻结为 nullable，但 002-session-truth-and-audit.sql 将其全部钉死为 NOT NULL——这直接违反了 owner 在 ZX-qna.md 中签字同意的 Q5 答案。`
  3. `Z2 action-plan 的 in-scope 描述与 ZX-D1 design 的 write ownership matrix 相互矛盾：前者要求"orchestration.core 把 session truth 落到 D1"，后者要求 agent.core 拥有 turns/messages/context snapshots 主写权——GPT 在执行时选择了 action-plan 的方向，但未回修 ZX-D1 的设计契约，也未在 closure 中诚实记录这一矛盾。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`（action-plan）
  - `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md`（Z2 design）
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`（ZX-D1 design — 冻结表结构 + write ownership）
  - `docs/design/zero-to-real/ZX-qna.md`（Q1-Q10 owner 回答 — Q5/Q6/Q7 直接约束 Z2）
  - `docs/charter/plan-zero-to-real.md`（zero-to-real charter）
  - `docs/issue/zero-to-real/Z1-closure.md`（前序阶段 closure）
  - `docs/code-review/zero-to-real/Z0-Z1-reviewed-by-deepseek.md`（Z0-Z1 review 中的 carry-over 项）

- **核查实现**：
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`（97 行，6 表 + 5 索引）
  - `workers/orchestrator-core/src/session-truth.ts`（498 行，D1SessionTruthRepository）
  - `workers/orchestrator-core/src/user-do.ts`（1466 行，User DO + durable wiring）
  - `workers/orchestrator-core/src/index.ts`（224 行，public façade）
  - `workers/orchestrator-core/src/auth.ts`（253 行，auth + ingress）
  - `workers/agent-core/src/index.ts`（248 行，WorkerEntrypoint RPC）
  - `workers/agent-core/src/host/internal.ts`（179 行，internal routing）
  - `workers/agent-core/src/host/internal-policy.ts`（240 行，authority validation）
  - `workers/agent-core/src/host/do/nano-session-do.ts`（1255+ 行，Session DO）
  - `workers/agent-core/src/host/checkpoint.ts`（282 行，session checkpoint）
  - `workers/orchestrator-auth/src/wechat.ts`（77 行，WeChat bridge）
  - `workers/agent-core/test/rpc.test.ts`（56 行）
  - `workers/orchestrator-core/test/user-do.test.ts`（510 行）
  - `context/ddl-v170/smind-01-tenant-identity.sql`（777 行，祖宗 schema）
  - `context/smind-admin/src/modules/identity/auth.service.ts`（150 行，祖宗 auth 流）

- **执行过的验证**：
  - 逐字段对比 `002-session-truth-and-audit.sql` 与 `ZX-d1-schema-and-migrations.md` §7.3.1 冻结字段
  - 逐字段对比 `nano_session_activity_logs` DDL 与 `ZX-qna.md` Q5 冻结 12 列
  - 核对了 `D1SessionTruthRepository` 的所有写入方法与 ZX-D1 §7.3.5 write ownership matrix
  - 核对了 `user-do.ts` 中 DO hot-state 四组 key 与 Q6 冻结的容量/TTL/Alarm 约束
  - 核对了 agent-core RPC 入口 `start()`/`status()` 的实际调用路径
  - 核对了 Z1 carry-over 修正项的执行结果

### 1.1 已确认的正面事实

- 6 张 Wave B 表全部已创建：`nano_conversations`、`nano_conversation_sessions`、`nano_conversation_turns`、`nano_conversation_messages`、`nano_conversation_context_snapshots`、`nano_session_activity_logs`
- 5 条索引全部存在，包括 Q5 要求的 3 条强制 activity log 索引（`team_uuid+created_at DESC`、`trace_uuid+event_seq`、`session_uuid+created_at`），以及额外补的 session 和 message 读路径索引
- `D1SessionTruthRepository` 提供完整 API：`beginSession`、`updateSessionState`、`createTurn`、`closeTurn`、`appendMessage`、`appendStreamEvent`、`captureContextSnapshot`、`appendActivity`、`readTimeline`、`readHistory`、`readSnapshot`（共 11 个方法）
- `user-do.ts` 已将 D1 durable truth 接入 `handleStart`、`handleInput`、`handleCancel`、`handleRead`（history/timeline/status）、`handleVerify`、`handleWsAttach` 的全部生命周期
- DO hot-state 已收敛为 4 组最小 key 集合：`conversation/index`、`conversation/active-pointers`、`recent-frames/<session>`、`cache/*`
- 容量约束已代码级实现：`MAX_CONVERSATIONS=200`、`MAX_RECENT_FRAMES=50`、`CACHE_TTL_MS=5min`、`HOT_STATE_ALARM_MS=10min`
- `setAlarm()` 调度位点在 `user-do.ts:662` 和 `alarm.ts` handler 中均已接入
- activity log 写入前经过 `redactActivityPayload`（复用 `packages/nacp-session/src/redaction.ts`），敏感字段（access_token、refresh_token、authority、password、secret、openid、unionid）被替换为 `[redacted]`
- agent-core 已升级为 `WorkerEntrypoint` 类，暴露 `status()` 和 `start()` RPC 方法
- orchestrator-core 的 `forwardStart` 已实现 dual-impl parity check：fetch 返回与 RPC 返回不一致时返回 502 `agent-rpc-parity-failed`
- agent-core 的旧 public session route 现在返回 410（`legacy-session-route-retired`），WebSocket route 返回 426
- preview 环境真实部署并 remote apply 了 001 和 002 migration，live E2E 36/36 + 12/12 全绿
- Z1 carry-over 问题已被吸收：auth.ts HTTP 路由默认拒绝 query `access_token`（仅 ws 放行）、`tenant_source` 从 truthy-check 修正为 source-check、wechat.ts retry 收紧为仅 network/timeout/5xx
- internal-policy.ts 不再强制 header authority 的 tenant 等于 worker-local `TEAM_UUID`，改为允许 payload 自洽
- `NanoSessionDO` 已开始锁存 `sessionTeamUuid` 并在 checkpoint/restore 路径恢复
- wrangler.jsonc 的 `TEAM_UUID` 已从非 UUID 占位符收紧为 UUID-shaped placeholder

### 1.2 已确认的负面事实

- ZX-D1 §7.3.5 write ownership matrix 中 `agent.core` 被指定为 `nano_conversation_turns`、`nano_conversation_messages`、`nano_conversation_context_snapshots` 的主写者，但实际代码中 `D1SessionTruthRepository`（orchestrator-core 的 user-do 使用）对这三张表执行 INSERT，agent-core 零 D1 写入
- Q5 冻结 `actor_user_uuid` = nullable（系统事件可空），但 002 DDL 为 `TEXT NOT NULL`
- Q5 冻结 `conversation_uuid` / `session_uuid` = nullable（lineage carriers），但 002 DDL 均为 `TEXT NOT NULL`
- Q5 冻结 `payload` = `max 8KB`，但 DDL 中无 CHECK 约束，代码中 `JSON.stringify(input.payload)` 无 size 检查
- ZX-D1 §7.3.1 冻结 `nano_conversations` 字段为 `created_by_user_uuid`、`archived_at`，但 002 DDL 使用 `owner_user_uuid`、`conversation_status`（enum `active/ended/archived`）
- ZX-D1 §7.3.1 冻结 `nano_conversation_sessions` 字段为 `status`，但 002 DDL 使用 `session_status`
- ZX-D1 §7.3.1 冻结 `nano_conversation_turns` 字段为 `role`/`status`/`started_at`，但 002 DDL 使用 `turn_kind`/`turn_status`/`created_at`
- `nano_conversation_messages` 的 `message_role` 列是 002 DDL 新增的（ZX-D1 未列出此列），语义上属于对设计冻结的静默扩展
- Wave B 所有 6 张表无任何 FOREIGN KEY 约束（Wave A 的 001 migration 中 identity 表有 FK 约束）
- `nano_conversation_messages` 缺少 `turn_uuid` 索引（按 turn 查询消息时性能问题）
- `nano_conversation_turns` 缺少 `team_uuid` 索引（按 team 审计 turns 时需要全表扫描或借道 session）
- agent-core wrangler.jsonc 无 `NANO_AGENT_DB` binding（closure 已诚实记录此项）
- `forwardStatus` 未实现 dual-impl parity check（与 `forwardStart` 的不对称）

---

## 2. 审查发现

### R1. Write Ownership Matrix 与实现方向之间存在系统性矛盾

- **严重级别**：`critical`
- **类型**：`scope-drift`
- **事实依据**：
  - ZX-D1 §7.3.5："`agent.core` — turns, messages, context snapshots, usage events, quota balances"
  - ZX-D1 §7.3.1 字段级冻结表：`nano_conversation_turns` 主写 = `agent.core`；`nano_conversation_messages` 主写 = `agent.core`；`nano_conversation_context_snapshots` 主写 = `agent.core`
  - `workers/orchestrator-core/src/session-truth.ts:196-373` — `createTurn()`、`appendMessage()`、`appendStreamEvent()`、`captureContextSnapshot()` 全由 orchestrator-core 执行 INSERT
  - `workers/agent-core/src/index.ts` — agent-core 中无任何 D1 写入代码（甚至无 `NANO_AGENT_DB` binding）
  - 同时，Z2 action-plan §2.1 [S2] 明确："让 `orchestration.core` 的 `start/input/history/timeline/verify` 消费 durable truth"
- **为什么重要**：
  - 这是 ZX-D1 设计文档的冻结决策与 Z2 action-plan 执行方向的**根本性矛盾**。ZX-D1 作为 cross-cutting 设计，对所有 phase 的表写入权做了唯一指定；Z2 action-plan 在 in-scope 描述中改变了这一方向，但未回修 ZX-D1 的设计契约。
  - 如果 Z2 选择了"orchestrator-core 集中写入"这一路径，那么 ZX-D1 的 write ownership matrix 必须被修订，且 Z3（quota tables 的 agent.core 主写）的设计也需要重新评估——因为 Z3 将继续沿用 ZX-D1 的 matrix 作为设计输入。
  - 这不是"字段命名差异"级别的偏差，而是**"谁拥有 durable truth 的写入权"这一架构级别的问题**。
- **审查判断**：
  - Z2 在执行时实际选择了"orchestrator-core 作为 session truth 的单一 D1 写入面"这一路径，与 action-plan 的 in-scope 描述一致，但违反了 ZX-D1 的 write ownership matrix。
  - 需要 owner 确认：是否接受"orchestrator-core 为唯一 D1 写入者"的既成事实，并回修 ZX-D1 的 write ownership matrix；或者要求 Z2 将 turns/messages/context snapshots 的写入权迁移至 agent-core。
  - 从工程现实判断，前者（统一到 orchestrator-core）在当前架构下更合理——因为 agent-core 没有 D1 binding 且其 session DO 有独立的 checkpoint/hot-state 持久化机制。但必须显式记录这一决策变更。
- **建议修法**：
  - **(a)** Owner 确认接受"orchestrator-core 为 turns/messages/context snapshots 的 D1 写入者"后，修订 ZX-D1 §7.3.1 和 §7.3.5，将这三张表的主写权改为 `orchestration.core`。
  - **(b)** 在 Z2 closure 文档中记录这一设计决策变更。
  - **(c)** 如果 Z3 需要 agent-core 拥有 quota tables 的独立写入权，需要为 agent-core 添加 `NANO_AGENT_DB` binding。

### R2. Activity Log DDL 字段 nullable 约束违背 Q5 冻结答案

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - ZX-qna.md Q5 Opus 最终回答（业主回答："同意 GPT 的推荐，同意 Opus 的看法"）：
    ```
    actor_user_uuid     TEXT (nullable, 系统事件可为空)
    conversation_uuid   TEXT (nullable)
    session_uuid        TEXT (nullable)
    turn_uuid           TEXT (nullable)
    ```
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:71-76`：
    ```sql
    actor_user_uuid TEXT NOT NULL,
    conversation_uuid TEXT NOT NULL,
    session_uuid TEXT NOT NULL,
    turn_uuid TEXT,  -- 这一列遵守了 nullable
    ```
  - Q5 同时要求 `payload` 列 `max 8KB`，但 DDL 中只有 `payload TEXT NOT NULL`，无长度约束。
- **为什么重要**：
  - Q5 的 nullable 语义不是偶然的："系统事件（如 alarm trim、DO 自动过期）没有 actor_user_uuid"——如果强制 NOT NULL，这些系统级 activity 无法写入。
  - `conversation_uuid` / `session_uuid` 为 nullable 是因为某些事件（如 quota 系统检查、密钥轮换）可能发生在 conversation/session 上下文之外。NOT NULL 会迫使这些事件要么绑一个假 UUID，要么被排除在 audit trail 之外。
  - Q5 是业主逐字同意的冻结答案，执行阶段不应静默修改其字段级约束。
- **审查判断**：
  - 当前 `D1SessionTruthRepository.appendActivity()` 要求 caller 必须提供 `conversation_uuid` 和 `session_uuid`（均为 `string` 类型，非 optional），这进一步在代码层强化了 NOT NULL 的约束。这意味着某些 Z2 未来阶段需要产出的系统级 activity（如 Z3 的 quota.deny 事件在被 deny 时可能还没有 session）在现有 schema 下无法写入。
  - 这不是"字段命名差异"而是**语义违反**——将 Q5 的三列 nullable 从设计层面撤销。
- **建议修法**：
  - 将 `actor_user_uuid`、`conversation_uuid`、`session_uuid` 的 NOT NULL 约束移除。
  - 同步修改 `D1SessionTruthRepository.appendActivity()` 的 TypeScript 类型签名，将这三个字段改为 `string | null`。
  - 为 `payload` 列添加 CHECK 约束或代码级 size 检查（`JSON.stringify(input.payload).length <= 8192`）。

### R3. Agent-core RPC 路径内部仍走 fetch-backed shim，非真正 RPC end-to-end

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `workers/agent-core/src/index.ts:176-241` — `invokeInternalRpc()` 方法构建 headers + body 后调用 `routeInternal(new Request(...))`。
  - `workers/agent-core/src/host/internal.ts:144-178` — `routeInternal()` 调用 `validateInternalAuthority()`（检查 shared secret header）后，通过 `forwardHttpAction()` 向 Session DO 发起 `stub.fetch()`。
  - 这意味着 ochestrator-core 调用 agent-core 的 `start()` RPC → agent-core 内部仍然走"构造 fetch Request → validateInternalAuthority → fetch to Session DO"这一整条 fetch 链路。
- **为什么重要**：
  - action-plan P4-01/P4-02 要求 "先把 `status` 做成 RPC-first smoke" 和 "让 `start` 开始走 RPC-first seam"。但当前实现中，`status()`/`start()` RPC 方法在 agent-core **内部**仍然通过 `routeInternal` → `forwardHttpAction` → `stub.fetch()` 这条 fetch 路径调用 Session DO。这不是"RPC-first seam"，而是"RPC 入口 + fetch 内部实现"。
  - 真正 RPC-first 应该让 `start()` RPC 方法直接调用 Session DO 的 RPC 方法（如果 Session DO 暴露了 WorkerEntrypoint），或至少通过 `DoRpcTransport` 而非 `fetch` 新建的 Request。
  - 虽然 closure 已诚实记录 "`input/cancel/timeline/verify/stream` 仍主要走 fetch-backed internal seam"，但对 `start`/`status` 两条已经标注为 "RPC-first" 的方法，其内部实现仍为 fetch-backed，closure 未披露此事实。
- **审查判断**：
  - `start` 的 dual-impl parity check（`forwardStart` 中对比 fetch 返回与 RPC 返回）依赖"RPC 路径和 fetch 路径内部走相同的代码"这一事实才能 deep-equal。这不是 parity proof，而是同义反复——两条路径调用了同一个 `routeInternal` 函数。
  - 真正的 parity proof 应该是：fetch 路径走旧 infrastructure，RPC 路径走新 infrastructure（如通过 `DoRpcTransport` 直接调用 Session DO），两者产生相同的 D1 row 和 envelope。
- **建议修法**：
  - 短期：在 Z2 closure 中诚实记录 `start`/`status` RPC 方法的内部 fetch-backend 事实。
  - 中期（Z3/Z4）：让 agent-core 的 RPC 方法内部通过 `DoRpcTransport` 或直接 DO RPC 调用 Session DO，不再绕经 `routeInternal` 的 fetch 包装。

### R4. ZX-D1 字段级冻结与实际 DDL 之间存在多处命名差异

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：

| 表 | ZX-D1 §7.3.1 冻结字段 | 002 DDL 实际字段 | 差异 |
|----|----------------------|-----------------|------|
| `nano_conversations` | `created_by_user_uuid` | `owner_user_uuid` | 语义变更：历史归属 vs 持续所有权 |
| `nano_conversations` | `archived_at` | `conversation_status` (enum) + `updated_at` + `latest_session_uuid` + `latest_turn_uuid` | 归档字段被扩展为状态机 + denormalized pointers |
| `nano_conversation_sessions` | `status` | `session_status` | 加 `session_` 前缀（与 `nano_conversations.conversation_status` 不对称） |
| `nano_conversation_turns` | `role` | `turn_kind` | 语义变更 |
| `nano_conversation_turns` | `status` | `turn_status` | 加 `turn_` 前缀 |
| `nano_conversation_turns` | `started_at` | `created_at` | 语义变更 |
| `nano_conversation_turns` | （无） | `input_text` | DDL 新增字段 |
| `nano_conversation_messages` | `message_kind` | `message_kind` + `message_role` | DDL 新增 `message_role` (user/assistant/system) |
| `nano_conversation_messages` | （无） | `event_seq` | DDL 新增字段 |
| `nano_conversation_messages` | `message_uuid...turn_uuid...` | `turn_uuid` 未列在冻结字段中 | ZX-D1 未列出 `turn_uuid`，但 DDL 有 |

- **为什么重要**：
  - ZX-D1 是 cross-cutting 设计文档，对全阶段（Z1-Z4）的 D1 schema 做了字段级冻结。Z2 的 DDL 是第一个消费这些冻结决策的实现。如果 Z2 就偏离了冻结字段，Z3（quota tables）和后续 admin/reporting 查询将面临两种不同命名体系的混用。
  - 具体问题：`created_by_user_uuid` → `owner_user_uuid` 的语义变更会影响后续 ownership transfer 的实现——"created by" 不可变，"owner" 可变。
  - `archived_at` → `conversation_status` 的状态机扩展本身是合理的工程决策，但增加了 ZX-D1 未冻结的字段（`updated_at`、`latest_session_uuid`、`latest_turn_uuid`），这些 denormalized pointers 需要写入一致性维护。
- **审查判断**：
  - 部分差异是合理的工程优化（如 `conversation_status` 枚举代替单一 `archived_at` 时间戳），但应在 closure 中诚实地声明"哪些冻结字段被修改、扩展或替换，以及理由"。
  - `created_by_user_uuid` → `owner_user_uuid` 变更缺少解释。
  - `nano_conversation_sessions.status` → `session_status` 的加前缀与 `nano_conversations.conversation_status` 不对称（一个加 table prefix，一个没加）。
- **建议修法**：
  - 在 Z2 closure 中补入"设计冻结 vs 实际 DDL 差异说明表"，逐项解释理由。
  - 回修 ZX-D1 §7.3.1 的字段冻结表，使其与 002 DDL 落地形态一致。
  - 对于 `conversation_status` 与 `session_status` 的不对称命名，建议统一（两者都加 table prefix 或都不加）。

### R5. `nano_session_activity_logs` 缺少 payload 大小约束

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - ZX-qna.md Q5 Opus 最终回答："`payload` = JSON text，单行最大 `8KB`"
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:80`：`payload TEXT NOT NULL` — 无长度 CHECK 约束
  - `workers/orchestrator-core/src/session-truth.ts:419`：`JSON.stringify(input.payload)` — 无 size 检查
- **为什么重要**：
  - Q5 的 8KB 上限是为了防止 activity log 被大 payload（如完整 LLM 响应正文）撑爆。没有这个约束，单个 activity row 可能达到 MB 级别，导致 D1 行大小超限、索引膨胀、查询性能退化。
  - D1 的 TEXT 列在 Cloudflare 有隐式上限（约 1MB），但远比 8KB 宽松。缺乏显式约束意味着"设计同意 8KB，运行时允许 ~1MB"。
- **审查判断**：
  - 建议在 TypeScript 层加 size check（D1 不支持 CHECK 约束中的 `LENGTH(payload) <= 8192` 表达式因 TEXT 类而歧义，但至少代码层应防御）。
- **建议修法**：
  - 在 `D1SessionTruthRepository.appendActivity()` 中添加 `JSON.stringify(input.payload).length <= 8192` 检查，超限时截断或拒绝，并写一条 `severity='warn'` 的 activity 记录说明 payload 被截断。

### R6. DO hot-state 的"清空 storage 后从 D1 重建"invariant 缺乏测试证明

- **严重级别**：`high`
- **类型**：`test-gap`
- **事实依据**：
  - ZX-qna.md Q6 Opus 最终回答（业主同意）："重建 invariant 测试：Z2 closure 必须包含一条测试，'清空 DO storage 后 reconnect 仍能从 D1 恢复 last 50 frames'。如果通不过，hot-state 设计就是错的。"
  - `workers/orchestrator-core/test/user-do.test.ts` 中测试依赖 `createState()` 返回的 in-memory Map storage，所有测试的 state 都是被 `store.set()` 手动注入的，没有任何一条测试模拟"清空 DO storage → 从 D1 恢复 → reconnect"全流程。
  - `workers/agent-core/test/host/integration/checkpoint-roundtrip.test.ts` 存在但覆盖的是 agent-core 的 DO checkpoint 往返，不是 orchestrator-core user DO 的 hot-state 从 D1 重建场景。
- **为什么重要**：
  - Q6 的这条 invariant 是区分"DO SQLite 是 truth owner"和"DO SQLite 是 cache"的关键证明。没有它，热态设计的设计意图就无法被验证。
  - 当前 user-do.test.ts 中的 `history` 测试（"returns durable history payloads even when no D1 binding is configured"）只验证了"没有 D1 binding 时返回空数组"，不是"有 D1 binding 时从 D1 恢复"。
- **审查判断**：
  - 这是一个 owner 明确要求的 closure 条件，Z2 closure 文档未提及此条未满足。需要补测试。
- **建议修法**：
  - 新增测试：模拟 session 有 D1 数据但 DO storage 为空 → 调用 `history`/`timeline` → 断言从 D1 返回了正确数据。
  - 新增测试：在 user-do 中清空 `recent-frames/<session>` 后调用 `readDurableTimeline` → 断言返回与 D1 一致。

### R7. Wave B 表缺少外键约束

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/migrations/001-identity-core.sql`（Wave A）有 5 条 FOREIGN KEY 约束：`user_uuid → nano_users`（两次）、`team_uuid → nano_teams`（三次）
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`（Wave B）6 张表零 FOREIGN KEY
  - `nano_conversation_sessions.conversation_uuid` 没有 FK 指向 `nano_conversations`
  - `nano_conversation_turns.session_uuid` 没有 FK 指向 `nano_conversation_sessions`
  - `nano_conversation_messages.session_uuid` 没有 FK 指向 `nano_conversation_sessions`
- **为什么重要**：
  - 参考实现 `context/ddl-v170/smind-01-tenant-identity.sql` 声明了"本阶段不依赖硬外键；跨表关系以注释、索引、服务层事务与迁移脚本保证"。但 nano-agent 的 Wave A migration 已经使用了 FOREIGN KEY，Wave B 却突然放弃，风格不一致。
  - 更关键的是：当前所有写入集中在单一 `D1SessionTruthRepository` 中（orchestrator-core），无并发写入 risk。但 FK 不仅用于并发保护，也用于读路径的 join 优化提示。
- **审查判断**：
  - 一致性问题：要么 Wave A 也去掉 FK（与 ddl-v170 风格一致），要么 Wave B 也加上 FK（与 Wave A 风格一致）。当前混用状态令读者困惑。
- **建议修法**：
  - 统一决策：如果 Cloudflare D1 在 preview 环境支持 FK 且 001 migration 的 FK 在 live E2E 中已验证无问题，则 Wave B 应添加对应的 FK 约束。
  - 至少为 `nano_conversation_sessions.conversation_uuid → nano_conversations` 和 `nano_conversation_turns.session_uuid → nano_conversation_sessions` 添加 FK。

### R8. `forwardStatus` 缺少 dual-impl parity check

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:707-722` — `forwardStatus()` 在 `rpcStatus` 可用时直接使用 RPC，否则 fallback fetch。无 parity comparison。
  - `workers/orchestrator-core/src/user-do.ts:665-705` — `forwardStart()` 有完整的 parity check：对比 status + body，不匹配时返回 502 `agent-rpc-parity-failed`。
- **为什么重要**：
  - action-plan P4-01 要求 `status` 作为 RPC smoke，closure proof 落在 `start`。但 `status` 因为是纯读操作（无 D1 写入），其 parity 验证成本更低，反而更容易实现。当前实现中 `status` 变成了"有 RPC 就用，没有就 fetch"，失去了 smoke 验证 RPC 通路正确性的功能。
  - 如果 RPC binding 配置错误但 agent-core 仍可 fetch 访问，`status` RPC smoke 无法探测到 RPC path 的问题。
- **审查判断**：
  - 建议为 `forwardStatus` 也添加 parity check（因为其实现成本更低且无副作用），或者至少在 `status` 的 RPC smoke 路径中增加一条"确认 RPC 确实走了（而非静默 fallback fetch）"的日志/返回标记。
- **建议修法**：
  - 在 `forwardStatus` 中增加 dual-impl parity check，或至少让 RPC path 返回中标记 `transport: 'rpc'` 使 caller 可区分。

### R9. `nano_conversation_sessions.last_event_seq` 从未被更新

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:23`：`last_event_seq INTEGER NOT NULL DEFAULT 0`
  - `workers/orchestrator-core/src/session-truth.ts:142`：`beginSession` 插入时固定为 0
  - `workers/orchestrator-core/src/session-truth.ts:170-194`：`updateSessionState` 只更新 `session_status / last_phase / ended_at`，不更新 `last_event_seq`
  - 全局代码搜索 `last_event_seq` 在 session-truth.ts 中只有 INSERT 时出现过，没有任何 UPDATE 语句。
- **为什么重要**：
  - 这个字段的设计意图是给恢复/重连提供"最后一个 event 的序号"快速查询，避免每次都去 messages 表 `MAX(event_seq)`。如果永远为 0，它的存在就是 misleading 的——调用者以为拿到的是真实值，实则永远为 0。
- **审查判断**：
  - 或者在 `appendStreamEvent` 后更新 `last_event_seq`，或者将 `last_event_seq` 改为通过查询 `nano_conversation_messages` 的 `MAX(event_seq)` 读取（去掉 denormalized 字段）。
- **建议修法**：
  - 在 `appendStreamEvent()` 中追加 `UPDATE nano_conversation_sessions SET last_event_seq = MAX(last_event_seq, ?) WHERE session_uuid = ?`。

### R10. `nano_conversation_turns` 缺少 `team_uuid` 索引，turn 级审计需全表扫描

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `nano_conversation_turns` 表有 `team_uuid TEXT NOT NULL`，但 002 DDL 中无对应索引。
  - 对比：`nano_conversation_sessions` 有 `(team_uuid, started_at DESC)` 索引；`nano_session_activity_logs` 有 3 条索引；`nano_conversation_turns` 只有隐式的 `session_uuid` 查询路径（通过 `turn_index` 在 session 内的唯一性）。
- **为什么重要**：
  - 当需要按 team 维度审计所有 turn 活动时（如 "某 team 在最近 24 小时内产生了多少 turn"），D1 会全表扫描 `nano_conversation_turns`。
- **审查判断**：
  - Z2 不是 BI/reporting 阶段，这条索引不属于 critical gap。但考虑到 Z3 的 quota 和 Z4 的 client usage 需求，建议在 Wave B 中预建。
- **建议修法**：
  - 添加 `CREATE INDEX idx_nano_conversation_turns_team_created_at ON nano_conversation_turns(team_uuid, created_at DESC)`。

### R11. `nano_conversation_messages` 缺少 `turn_uuid` 索引

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `nano_conversation_messages` 有 `turn_uuid TEXT` 列，无对应索引。
  - 当前 read path（`readHistory`、`readTimeline`）按 `session_uuid` 查询，不按 `turn_uuid`。但如果 Z3/Z4 的客户端需要在 UI 中按 turn 分组展示消息，缺少此索引会导致查询变慢。
- **审查判断**：
  - 当前功能不依赖此索引，但预留以支持 Z4 客户端按 turn 分组显示。
- **建议修法**：
  - 添加 `CREATE INDEX idx_nano_conversation_messages_turn_uuid ON nano_conversation_messages(turn_uuid, created_at)`。

### R12. ZX-D1 与 Z2 action-plan 之间的系统性方向矛盾未被闭合

- **严重级别**：`critical`
- **类型**：`scope-drift`
- **事实依据**：
  - ZX-D1 §7.3.1：`nano_conversation_turns`、`nano_conversation_messages`、`nano_conversation_context_snapshots` 的主写 worker 均为 `agent.core`。
  - ZX-D1 §7.3.5 write ownership matrix：`agent.core` — turns, messages, context snapshots。
  - Z2 action-plan §1.2 Phase 总览 Phase 2：`orchestration.core` 的 `start / input / history / timeline / verify` 写入并读取 D1 truth。
  - Z2 action-plan §1.5 影响目录树：只列出 `workers/orchestrator-core/src/index.ts`、`src/user-do.ts` ——不包含 agent-core 的任何 D1 写入文件。
  - 代码现实：`D1SessionTruthRepository` 写在 orchestrator-core 中，被 `user-do.ts` 独占使用。agent-core 无 D1 写入。
- **为什么重要**：
  - 这是 **R1 的根源**。action-plan 在起草时修改了 ZX-D1 的设计决策（从 agent-core 写入改为 orchestrator-core 写入），但既未在 action-plan 中标注这一变更，也未修订 ZX-D1 的设计合同。
  - Z2 closure 文档完全未提及这一矛盾——closure 中声称 "Wave B D1 schema ✅"，但没有承认"该 schema 的写入权与 ZX-D1 设计契约存在结构性冲突"。
  - 如果 Z3 继续基于 ZX-D1 的 write ownership matrix 来设计 quota tables 的 agent-core 写入权，会在同一个系统里制造出"一部分表由 agent-core 写、另一部分表由 orchestrator-core 写但 D1 整体由 orchestrator-core 管理 migration"的混乱局面。
- **审查判断**：
  - Z2 closure 当前声称的 "✅ Wave B D1 schema 落地" 需要 conditional：schema 已落地，但其写入 ownership 与 ZX-D1 设计冻结不一致，需要 owner 确认新的 ownership 归属并回修 ZX-D1。
- **建议修法**：
  - 同 R1 的修法。

### R13. `NanoSessionDO` checkpoint 机制与 orchestrator-core 的 10m alarm checkpoint 是两个独立体系

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - Z2 action-plan §4.3 P3-02："replay cursor/heartbeat/ack 具备 first-wave runtime reality，`every 10m + alarm` checkpoint 能把 pending delta 写回 durable truth"
  - `workers/orchestrator-core/src/user-do.ts` 的 alarm 做 trim/cleanup/evict，不写回 D1
  - `workers/agent-core/src/host/do/nano-session-do.ts` 的 `persistCheckpoint()` 写入 DO storage（key `CHECKPOINT_STORAGE_KEY`），不写入 D1
  - agent-core 的 `alarm()` 做 health check + reschedule，不做 trim/refresh
- **为什么重要**：
  - action-plan 期望 alarm 触发的 checkpoint 将 "pending delta 写回 durable truth"（即 D1）。但当前实现中：
    - orchestrator-core alarm = 热态 GC（不写 D1）
    - agent-core alarm = 健康检查（不写 D1）
    - agent-core checkpoint = 写入 DO storage（不写 D1）
  - 这意味着从 DO storage 到 D1 的"pending delta 写回"路径在 Z2 中实际上不存在。当前架构中 D1 写入发生在事件发生时（`appendStreamEvent` 等），而非 alarm 批量写回。
  - 这不是 bug——event-time 写入比 alarm 批量写回更简单且更及时——但 closure 和 action-plan 关于 alarm checkpoint 的描述与实际实现不符。
- **审查判断**：
  - 建议在 Z2 closure 中诚实记录：当前实现选择 event-time 写入 D1 而非 alarm 批量写回，这是一种更简化的工程选择，与 action-plan 的 alarm checkpoint 描述有差异。
- **建议修法**：
  - 更新 Z2 closure §4 和 action-plan 执行日志，说明选择了 event-time D1 写入模式。

### R14. `user-do.ts` 中的 `cache/` 前缀和 `EphemeralCacheEntry` 类型存在但无主动过期驱逐（仅被动 GC）

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:140`：`CACHE_PREFIX = 'cache/'`
  - `workers/orchestrator-core/src/user-do.ts:69-73`：`EphemeralCacheEntry` 有 `expires_at` 字段
  - `workers/orchestrator-core/src/user-do.ts:637-643`：`rememberCache()` 写入 cache entry 时设置 `expires_at` 为当前时间 + 5min
  - `workers/orchestrator-core/src/user-do.ts:645-658`：`trimHotState()` 中只 trim `recent-frames` 和 ended session cache keys，不 scan cache 前缀下的所有 key 做过期驱逐
- **为什么重要**：
  - Cache entries 的 `expires_at` 被设置了但从未被检查。`rememberCache` 使用了 `put` 覆盖写入（key 唯一），所以同一个 cache key 不会产生多份过期数据。但 cache key 的集合可能随时间增长（不同的 session 产生不同的 cache key），且无 GC。
  - 当前只有两个 hardcoded cache key 被使用：`status:<sessionUuid>` 和 `verify:<sessionUuid>`，且它们只有 ended sessions 被清理时通过 `delete` 移除。active session 的 cache 永不过期。
- **审查判断**：
  - 当前 scope 下影响有限（仅 2 种 cache key），但 Q6 要求 "DO Alarm 过期 reconnect cursors > 1h + refresh/evict secret cache"，其中 cache eviction 未在代码中体现。
- **建议修法**：
  - 在 `trimHotState()` 或独立 alarm cycle 中添加对 `cache/*` 前缀下所有 key 的 `expires_at` 检查与删除。
  - 或改为不提供通用 cache 机制而直接 hardcode `status` 和 `verify` 的 TTL。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| [S1] | Wave B D1 schema 落地（6 表） | `partial` | 6 表 + 索引已落地，但 schema 与 ZX-D1 字段冻结存在多处差异（R4），activity log 的 nullable 列与 Q5 不一致（R2），payload 缺 8KB 约束（R5） |
| [S2] | public session durable truth（start/input/history/timeline/verify） | `partial` | D1SessionTruthRepository 完整可用，user-do 已接入生命周期。但 write ownership 与 ZX-D1 矛盾（R1），`last_event_seq` 从未被更新（R9） |
| [S3] | DO hot-state 4 组最小集合 + `10m + alarm` checkpoint | `partial` | 4 组 hot-state key 正确、容量约束已设、alarm 已调度。但 alarm 不做 D1 写回（R13），cache eviction 未实现（R14），"清空 DO storage 从 D1 重建"invariant 无测试证明（R6） |
| [S4] | heartbeat/replay cursor/reconnect first-wave truth | `partial` | heartbeat/replay cursor 在 agent-core 的 `SessionWebSocketHelper` 中存在，session-edge 有 replay 处理。但 Z2 action-plan 要求的 "`every 10m + alarm` snapshot/recover path" 描述了 alarm → D1 写回路径，该路径未实现（R13） |
| [S5] | internal `status` RPC + `start` kickoff | `partial` | agent-core 有 WorkerEntrypoint `status()`/`start()` RPC，orchestrator-core 的 forwardStart 有 parity check。但 RPC 内部仍走 fetch-backend（R3），forwardStatus 缺 parity check（R8），parity proof 因内部路径相同而无法真正证明两条 path 独立等价 |
| [S6] | append-only activity log + redaction discipline | `partial` | activity log 写入前确实调用 `redactActivityPayload`。但 Q5 的 nullable 字段被改为 NOT NULL（R2），payload 缺 8KB 上限（R5） |

### 3.1 对齐结论

- **done**: `0`
- **partial**: `6`
- **missing**: `0`

**结论**: Z2 的 6 项 in-scope 全部被评为 `partial` 而非 `done`。核心原因是：Z2 action-plan 与 ZX-D1 设计文档之间存在未解决的系统性矛盾（write ownership），以及多个 design-doc 冻结字段（Q5 nullable、ZX-D1 命名）与实际 DDL 之间的不一致。这更像"主体工程已落地，但设计与实现之间的合同仍未对齐"而不是"已符合所有 frozen design doc 的 completed 状态"。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| [O1] | real Workers AI provider 与 quota gate | `遵守` | 未引入 |
| [O2] | 完整 client UI 与真机链路 | `遵守` | 未引入 |
| [O3] | 丰富的 admin analytics / BI query layer | `遵守` | 未引入 |
| [O4] | HTTP public surface 全面退役 | `遵守` | 未引入，closure 诚实记录了仍在使用的 fetch-backed 路径 |

---

## 5. 跨阶段跨包深度分析

### 5.1 Z0-Z1 review carry-over 项的 Z2 闭合状态

上一轮 Z0-Z1 review 中的发现与 Z2 的关系：

| Z0-Z1 Review 发现 | Z2 中的状态 |
|-------------------|------------|
| R1: `orchestrator-core/src/auth.ts` 定义独立的 `IngressAuthSnapshot` 类型（第二套 auth 类型） | **仍存在**。`auth.ts:25-35` 的 `IngressAuthSnapshot` 并未被 contract package 的 `AuthSnapshot` 替换。Z2 还在 `user-do.ts` 中继续消费 `IngressAuthSnapshot`。 |
| R2: 命名体系永久 gap（charter/docs 用 `orchestration.core`，代码用 `orchestrator-core`） | **仍存在**。Z2 的所有新文件（session-truth.ts 等）继续使用 `orchestrator-core` 路径命名。 |
| R3: `findIdentityBySubject()` 缺少 `identity_status` 过滤 | Z2 未动 auth worker，此项保留到 Z1 scope。 |
| R11: Z1 `nano_team_api_keys` 缺少 `key_status` 列 | Z2 未动 identity tables。 |

### 5.2 Z2 对 Z3 的直接影响

1. **write ownership 矛盾会直接阻塞 Z3**：Z3 设计依赖 ZX-D1 的 write ownership matrix（quota tables 主写 = agent.core）。如果 Z2 不解决 ownership 归属问题，Z3 的执行者会面临两个矛盾选择：(a) 继续在 orchestrator-core 中添加 quota 写入 → 违反 ZX-D1；(b) 为 agent-core 添加 D1 binding → 违反当前"agent-core 无 D1"的代码现实。

2. **Q5 nullable 的缺失会影响 Z3 的 quota deny events**：Z3 需要在没有 session 上下文的场景下写入 activity log（例如 start admission check 被 deny 时尚未创建 session）。当前 NOT NULL 约束会迫使 Z3 要么绑假 session，要么跳过 activity log。

3. **activity log 缺 8KB 上限**：Z3 的 LLM invoke 产生的 activity payload 可能包含大段 content，若不加约束会突破 D1 行限制。

4. **agent-core 的 RPC 路径仍为 fetch-backend**：Z3 的 runtime mesh tightening（charter §7.4 In-Scope 6："收紧 runtime mesh 的 binding discipline"）需要这条路径已真实 RPC 化。

### 5.3 Z2 对 Z4 的直接影响

1. **turn/message history read path 已在 Z2 建立**：Z4 的客户端 history/readback 可以直接消费 `readHistory`/`readTimeline`，不依赖 Z2 的任何修正。
2. **DO hot-state 的 from-D1 rebuild**：Z4 的 Mini Program reconnect 场景高度依赖这个 invariant——客户端重连时如果 DO 已被 hibernation 清空，必须从 D1 恢复。当前缺失测试意味着这条路在 Z4 真机测试中可能首次暴露问题。

### 5.4 命名体系 vs 设计文档体系的不对齐（全局分析）

经过 Z0+Z1+Z2 三轮审查，存在一个贯穿全文档体系的系统性 gap：

- **charter / ZX 设计文档** 使用 `orchestration.core`
- **代码路径** 使用 `orchestrator-core`
- **wrangler.jsonc** 使用 `nano-agent-orchestrator-core`
- **Z2 action-plan** 在 §0 写 `orchestration.core` 但在 §1.5 文件树写 `orchestrator-core`

这导致任何跨文档引用（如"按照 ZX-D1 第 N 行，orchestration.core 应写入...查找代码中 orchestrator-core 的对应位置"）都需要手动翻译命名体系，长期会增加运维与 onboarding 成本。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：`Z2 的核心工程主体已落地（D1 truth、DO hot-state、RPC kickoff、activity log 全部存在），但 ZX-D1 设计契约与实际实现之间存在未解决的系统性矛盾，且多个 Q5 冻结字段被静默修改。closure 文档未诚实地记录这些矛盾。当前不应标记为 ready-for-Z3。`

- **是否允许关闭本轮 review**：`no — changes-requested`

- **关闭前必须完成的 blocker**：
  1. **R1+R12**：Owner 确认 write ownership 的新归属（orchestrator-core 全权写入 vs agent-core 分写），回修 ZX-D1 §7.3.1 和 §7.3.5，并在 Z2 closure 中记录决策变更。
  2. **R2**：修复 `nano_session_activity_logs` 的 `actor_user_uuid`、`conversation_uuid`、`session_uuid` 为 nullable（DDL + TypeScript 类型 + repository 代码），与 Q5 冻结答案对齐。
  3. **R4**：在 Z2 closure 中补入"设计冻结字段 vs 实际 DDL 字段差异说明表"，逐项记录变更理由，并回修 ZX-D1 的字段冻结表。

- **可以后续跟进的 non-blocking follow-up**：
  1. **R3**：agent-core RPC 方法的内部 fetch-backend 替换为真正的 DO RPC 调用（Z3）。
  2. **R5**：为 activity log payload 添加 8KB 上限检查（Z2 修正期或 Z3）。
  3. **R6**：补"清空 DO storage 从 D1 重建"invariant 测试（Z2 修正期）。
  4. **R7**：统一 Wave A/Wave B 的 FK 策略（Z2 修正期）。
  5. **R8**：为 `forwardStatus` 添加 parity check（Z2 修正期）。
  6. **R9**：修复 `last_event_seq` 从不更新的 bug（Z2 修正期）。
7. **R10+R11**：补 turn_uuid/team_uuid 索引（Z3）。
8. **R13+R14**：alarm checkpoint 描述更新 + cache eviction 实现（Z2 修正期或 Z3）。
9. 命名体系全局对齐（建议在 Z5 closure 时统一处理，不在 Z2 单点解决）。

---

## 7. 对 DeepSeek 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-25`
> 评价依据: `本文件 §0-§6；以及实现者对照修复结果（docs/code-review/zero-to-real/Z2-reviewed-by-opus.md §7）`

### 7.1 一句话评价评审风格

DeepSeek 的这份审查更像一次 **架构契约审计**：对 design/action-plan/QNA/DDL 的对照非常强，系统性断点抓得准，但在个别“结构分离是否等于缺陷”的判断上略偏重。

### 7.2 优点
1. 对 **ZX-D1 / ZX-qna / action-plan / closure / 实际代码** 的交叉比对非常扎实，能抓到一般 code review 很容易漏掉的“文档真相漂移”。
2. 抓到了多条后来被证实真实存在、且价值很高的问题：write ownership 矛盾、nullable 漂移、payload 8KB、`last_event_seq` 未更新、缺 FK、缺 parity、缺 rebuild proof。
3. 审查报告对后续阶段的价值高，不只是指出“这段代码有问题”，而是明确指出“这会怎样污染 Z3/Z4 的输入假设”。

### 7.3 缺点
1. R1 与 R12 的问题域高度重叠，作为两个独立高严重度 finding 有一定重复。
2. R13 把 “agent-core checkpoint” 与 “orchestrator alarm GC” 两套机制并存当成缺陷，实际上更接近架构边界说明不足，而不是直接 bug。
3. 个别文档/命名类问题给的严重度略高，优先级排序不如 Opus 那样收敛。

### 7.4 对审查报告中，全部问题，的清点

| 问题编号 | 原始严重程度 | 该问题的质量 | 分析与说明 |
|----|------|------|------------------|
| R1 | critical | 高 | 准确抓到 ZX-D1 write ownership matrix 与实际 landed 实现相冲突，这是本轮最有价值的系统性发现之一。 |
| R2 | critical | 高 | Q5 nullable/lineage 语义与 DDL 不一致完全成立，且后续确实被修复。 |
| R3 | high | 高 | 对 “RPC 入口存在，但内部仍是 fetch-backed shim” 的判断准确，属于真实架构债。 |
| R4 | high | 高 | 字段冻结与实际 DDL 命名漂移是真问题，后续也确实需要回修文档。 |
| R5 | medium | 高 | `payload <= 8KB` 的缺失判断准确，建议也可执行。 |
| R6 | high | 高 | “清空 storage 后从 D1 重建” proof 缺位是 Q6 字面要求，指认准确。 |
| R7 | medium | 高 | Wave B 缺 FK 的判断完全成立，且与仓库现有 Wave A 风格对照得当。 |
| R8 | low | 高 | `forwardStatus` 缺 parity 是低严重度但高准确性的 finding，等级把握合理。 |
| R9 | medium | 高 | `last_event_seq` 未更新是很精准的实现级发现，后续被直接修复。 |
| R10 | low | 中 | turn `team_uuid` 索引是有价值的预防性建议，但更偏优化，不是收口核心。 |
| R11 | low | 中 | message `turn_uuid` 索引同样成立，但属于低优先级 schema 完善项。 |
| R12 | critical | 中 | 与 R1 高度重叠；独立列出有助于强调，但会稀释报告去重度。 |
| R13 | medium | 低 | 两套 checkpoint/GC 机制独立并不天然构成 defect，这条更像边界说明问题而非错误。 |
| R14 | low | 中 | 被动 GC 的观察基本成立，但描述略宽，未完全区分当前已建模 cache 与未建模 cache。 |

### 7.5 评分 - 总体 ** 8.7 / 10 **

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 9 | 文档、DDL、代码、closure、前序阶段 carry-over 都串起来了。 |
| 判断严谨性 | 9 | 大多数判断经后续修复验证成立；只有极少数边界类问题偏重。 |
| 修法建议可执行性 | 8 | 大部分可执行，少数项更像“先决策后实现”的设计修正。 |
| 对 action-plan / design 的忠实度 | 10 | 这是 DeepSeek 最强的维度。 |
| 协作友好度 | 8 | 结论直且有力，但少数结论偏强，阅读门槛较高。 |
| 找到问题的覆盖面 | 8 | 设计/契约/文档面覆盖极强，但 runtime 错误路径与测试层不如 Opus 全面。 |
