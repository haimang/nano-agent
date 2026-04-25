# Z2 代码审查报告

> 审查对象: `zero-to-real / Z2 / session-truth-and-audit-baseline`
> 审查时间: `2026-04-25`
> 审查人: `Kimi (k2p6)`
> 审查范围:
> - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`
> - `docs/issue/zero-to-real/Z2-closure.md`
> - `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md`
> - `docs/design/zero-to-real/ZX-qna.md` (Q5-Q7)
> - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
> - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`
> - `workers/orchestrator-core/src/session-truth.ts`
> - `workers/orchestrator-core/src/user-do.ts`
> - `workers/orchestrator-core/src/index.ts`
> - `workers/agent-core/src/index.ts`
> - `workers/agent-core/src/host/do/nano-session-do.ts`
> - `workers/agent-core/src/host/internal-policy.ts`
> - `workers/orchestrator-core/src/auth.ts`
> - `workers/orchestrator-auth/src/wechat.ts`
> - `test/package-e2e/orchestrator-core/*`
> - `test/cross-e2e/*`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：Z2 的核心交付物（Wave B schema、D1 session truth repository、DO hot-state 四组集合、activity log append path、RPC kickoff scaffold）已真实落地，preview live evidence 成立。但存在 D1 事务缺失、schema 与 Q5 设计不一致、RPC 仍是 HTTP shim、DO hot-state trim 不完整等结构性问题，当前不应标记为 completed。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. **D1 写入缺乏事务保护**：`session-truth.ts` 的多步操作（如 `beginSession` 的 SELECT + INSERT + UPDATE）未包裹在 SQLite 事务中，失败时会产生孤儿记录。
  2. **RPC kickoff 是 HTTP shim 而非 WorkerEntrypoint native**：`agent-core/src/index.ts` 的 `status/start` RPC 方法内部构建 HTTP Request 调用 `routeInternal`，并未真正利用 WorkerEntrypoint 的直接调用能力。
  3. **activity log schema 与 Q5 冻结答案不一致**：`actor_user_uuid` 和 `conversation_uuid` 在 schema 中被标记为 NOT NULL，但 Q5 明确允许系统事件时为空。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-zero-to-real.md`（§7.3 Z2 收口标准）
  - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`（Phase 1-5）
  - `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md`（F1-F4）
  - `docs/design/zero-to-real/ZX-qna.md`（Q5-Q7）
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
  - `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md`
  - `docs/issue/zero-to-real/Z2-closure.md`
- **核查实现**：
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`（97 行）
  - `workers/orchestrator-core/src/session-truth.ts`（498 行）
  - `workers/orchestrator-core/src/user-do.ts`（1466 行）
  - `workers/orchestrator-core/src/index.ts`（224 行）
  - `workers/agent-core/src/index.ts`（248 行）
  - `workers/agent-core/src/host/do/nano-session-do.ts`（1610 行）
  - `workers/agent-core/src/host/internal-policy.ts`（240 行）
  - `workers/orchestrator-core/src/auth.ts`（253 行）
  - `workers/orchestrator-auth/src/wechat.ts`（77 行）
  - `test/package-e2e/orchestrator-core/02-session-start.test.mjs`（56 行）
  - `test/package-e2e/orchestrator-core/06-auth-negative.test.mjs`（87 行）
  - `test/cross-e2e/08-session-lifecycle-cross.test.mjs`（83 行）
  - `workers/agent-core/test/rpc.test.ts`（56 行）
  - `workers/orchestrator-core/test/user-do.test.ts`（510 行）
  - `workers/orchestrator-core/test/smoke.test.ts`（280 行）
- **参考代码**：
  - `context/ddl-v170/smind-01-tenant-identity.sql`（777 行）
  - `context/smind-admin/src/modules/identity/auth.service.ts`（150 行）
  - `packages/nacp-session/src/redaction.ts`（30 行）
- **执行过的验证**：
  - 逐行阅读所有上述文件
  - 对照 QNA Q5-Q7 逐项验证实现
  - 对照 action-plan Phase 1-5 逐项验证 scope
  - 对照 Z2 design doc F1-F4 判定标准验证
  - 检查 CI 配置 `.github/workflows/workers.yml`
  - 验证 Z1 审查发现项的修复状态

### 1.1 已确认的正面事实

- **Schema 层面**：
  - `002-session-truth-and-audit.sql` 已真实创建 6 张表：`nano_conversations`、`nano_conversation_sessions`、`nano_conversation_turns`、`nano_conversation_messages`、`nano_conversation_context_snapshots`、`nano_session_activity_logs`
  - activity log 的 3 条强制索引已落实（`team_uuid+created_at DESC`、`trace_uuid+event_seq`、`session_uuid+created_at`）
  - 额外补充了 `nano_conversation_sessions` 和 `nano_conversation_messages` 的读路径索引
- **D1 Truth 层面**：
  - `session-truth.ts` 的 `D1SessionTruthRepository` 实现了完整的 session lifecycle 持久化（beginSession、createTurn、closeTurn、appendMessage、appendStreamEvent、captureContextSnapshot、appendActivity）
  - `user-do.ts` 的 `handleStart/handleInput/handleCancel` 均已接入 durable truth 写入
  - `history/timeline/verify/status` 读路径已回落 D1（`readDurableHistory`、`readDurableTimeline`、`readDurableSnapshot`）
  - `appendActivity` 已使用 `redactActivityPayload` 过滤敏感字段（`user-do.ts:206-217`）
- **DO Hot-State 层面**：
  - 四组集合已落实：`conversation/index`（`CONVERSATION_INDEX_KEY`）、`conversation/active-pointers`（`ACTIVE_POINTERS_KEY`）、`recent-frames/<session>`（`RECENT_FRAMES_PREFIX`）、`cache/*`（`CACHE_PREFIX`）
  - 容量常量已定义：`MAX_CONVERSATIONS = 200`、`MAX_RECENT_FRAMES = 50`、`CACHE_TTL_MS = 5min`、`HOT_STATE_ALARM_MS = 10min`
  - `ensureHotStateAlarm()` 在每次 fetch 时调用，确保 alarm 持续调度
- **RPC Kickoff 层面**：
  - `agent-core/src/index.ts` 已升级为 `WorkerEntrypoint` 子类
  - `status()` 和 `start()` RPC 方法已暴露
  - `orchestrator-core/src/user-do.ts:665-705` 的 `forwardStart` 实现了 dual-impl parity 检查
  - `orchestrator-core/src/user-do.ts:707-722` 的 `forwardStatus` 优先走 RPC 路径
- **Z1 Carry-over 修复**：
  - `orchestrator-core/src/index.ts:133` 已显式传递 `caller: "orchestrator-core"`（修复 Z1 R1）
  - `orchestrator-core/src/auth.ts:157` 默认拒绝 query `access_token`，仅 `ws` 放行
  - `orchestrator-core/src/auth.ts:216-217` 的 `tenant_source` 判定已修正为 source-check
  - `workers/orchestrator-auth/src/wechat.ts:35-72` 的 retry 已收紧为 network/timeout/5xx
- **Preview 验证**：
  - `nano-agent-preview` D1 已创建并 remote apply Wave A + Wave B
  - 三个 worker 已 preview deploy
  - `pnpm test:package-e2e` → 36/36 pass
  - `pnpm test:cross-e2e` → 12/12 pass

### 1.2 已确认的负面事实

- `session-truth.ts` 的所有写方法均未使用 SQLite 事务包裹，多步操作存在部分失败风险
- `nano_session_activity_logs` 的 `actor_user_uuid` 和 `conversation_uuid` 为 NOT NULL，与 Q5 设计的 nullable 语义冲突
- `agent-core/src/index.ts` 的 RPC 方法内部仍通过 HTTP Request 调用 `routeInternal`，不是真正的 WorkerEntrypoint native 调用
- `user-do.ts` 的 `forwardStart` 使用 `JSON.stringify` 进行 parity 比较，对 key 顺序敏感
- `user-do.ts` 的 `handleStart` 在内部 start 失败时删除 DO state 但未清理已创建的 D1 session 记录
- `user-do.ts` 的 `trimHotState` 仅 trim conversation_index，未 trim recent_frames 和 cache
- `nano-session-do.ts` 的 `currentTeamUuid()` 仍 fallback 到 `env.TEAM_UUID`，未完全消除 deploy-local 锚
- `nano-session-do.ts` 的 `restoreFromStorage()` 未恢复 `actorState.phase`
- `appendActivity` 的 `event_seq` 使用 `MAX() + 1` 在并发时可能重复
- closure 文档的 known limitations 未完整记录上述结构性问题

---

## 2. 审查发现

### R1. D1 写操作缺乏事务保护

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `session-truth.ts:75-161` 的 `beginSession` 包含：SELECT existing session → SELECT active conversation → INSERT conversation → INSERT session → UPDATE conversation，共 5 个独立 D1 操作
  - `session-truth.ts:196-250` 的 `createTurn` 包含：SELECT MAX turn_index → INSERT turn → UPDATE conversation，共 3 个独立操作
  - `session-truth.ts:265-304` 的 `appendMessage` 只有 1 个 INSERT，相对安全
  - `session-truth.ts:375-423` 的 `appendActivity` 包含 SELECT MAX event_seq + INSERT，共 2 个操作
  - 所有方法均直接调用 `this.db.prepare().bind().run()`，没有 `BEGIN TRANSACTION` / `COMMIT` 包裹
- **为什么重要**：
  - action-plan 的 Phase 2 收口标准明确要求 "会话读写经 durable layer"，隐含要求 durable layer 的原子性
  - 如果 `beginSession` 在 INSERT conversation 后、INSERT session 前失败（如 D1 连接中断），会产生无 session 的孤儿 conversation
  - 如果 `createTurn` 在 INSERT turn 后、UPDATE conversation 前失败，`latest_turn_uuid` 会不一致
  - 这是 D1 truth 与 DO hot-state 分叉的根本原因（action-plan Phase 3 风险提醒："最容易出现 DO state 与 D1 truth 分叉"）
- **审查判断**：
  - 代码结构正确但事务边界缺失，这是 Z2 最核心的 correctness gap
  - D1 支持 SQLite 事务（`BEGIN IMMEDIATE` + `COMMIT`），技术上可行
- **建议修法**：
  - 在 `D1SessionTruthRepository` 中添加 `withTransaction` 辅助方法（类似 Z1 auth worker 的 `repository.ts:147-157`）
  - 将 `beginSession`、`createTurn`、`appendActivity` 的多步操作包裹在事务中
  - 在事务内使用 `RETURNING` 子句获取插入后的值（D1 支持 SQLite 的 RETURNING）

### R2. activity_log schema 与 Q5 冻结答案不一致

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - Q5（`ZX-qna.md:153-167`）明确设计的 `nano_session_activity_logs` 字段中：`actor_user_uuid TEXT (nullable, 系统事件可为空)`、`conversation_uuid TEXT (nullable)`
  - `002-session-truth-and-audit.sql:72-82` 中：`actor_user_uuid TEXT NOT NULL`、`conversation_uuid TEXT NOT NULL`
  - `session-truth.ts:375-423` 的 `appendActivity` 参数中 `actor_user_uuid` 和 `conversation_uuid` 均为 required 字段
- **为什么重要**：
  - 系统级事件（如 alarm trim、reconnect cursor 过期、internal health check）没有明确的 actor_user
  - 如果强制要求 `actor_user_uuid`，系统事件要么伪造一个用户（如 `system`），要么无法记录
  - 同样，`conversation_uuid` 在 session 建立前的事件（如 `session.start.request`）可能还没有 conversation
  - 这与 Q5 的 "单 append-only 表 + 必要 views" 设计意图冲突
- **审查判断**：
  - schema 实现偏离了已冻结的 Q5 设计，属于 scope-drift（虽未扩大 scope，但缩小了设计弹性）
  - 当前测试未覆盖系统事件写入场景，因此未发现此问题
- **建议修法**：
  - 修改 `002-session-truth-and-audit.sql`，将 `actor_user_uuid` 和 `conversation_uuid` 改为 `TEXT`（去掉 NOT NULL）
  - 修改 `session-truth.ts` 的 `appendActivity` 参数类型，允许 `actor_user_uuid` 和 `conversation_uuid` 为 null
  - 在 `user-do.ts` 的 alarm/trim 路径中添加系统事件 activity 写入，验证 nullable 字段工作正常

### R3. RPC kickoff 仍是 HTTP shim 而非 WorkerEntrypoint native

- **严重级别**：`high`
- **类型**：`scope-drift`
- **事实依据**：
  - `agent-core/src/index.ts:168-174` 的 `status/start` 方法调用 `invokeInternalRpc`
  - `invokeInternalRpc`（`agent-core/src/index.ts:176-241`）内部：
    1. 构建 HTTP headers（`x-nano-internal-binding-secret`、`x-trace-uuid`、`x-nano-internal-authority`）
    2. 构建 HTTP Request（`https://agent.internal/internal/sessions/${sessionUuid}/${action}`）
    3. 调用 `routeInternal(request, this.env)`
  - `routeInternal`（`agent-core/src/host/internal.ts:144-179`）仍然是传统的 fetch-based internal router
  - 这意味着从 orchestrator-core 到 agent-core 的 RPC 调用，在 agent-core 内部又转回 HTTP 处理链
- **为什么重要**：
  - action-plan Phase 4 的收口标准明确要求 "`status` 经 RPC 返回真实状态"，但隐含要求 RPC 是 native 的，不是 HTTP 的二次包装
  - Q7 冻结的 "WorkerEntrypoint RPC-first" 目标（`ZX-qna.md:27-41`）要求 "auth worker 与 orchestrator 都从该包 import 接口与 envelope 类型，杜绝 caller/callee 类型漂移"
  - 当前实现中，orchestrator-core 调用 agent-core 的 RPC 方法，但 agent-core 内部仍走 HTTP，这意味着：
    1. RPC 路径和 fetch 路径共享同一个 `routeInternal`，无法独立演进
    2. RPC 调用仍需序列化/反序列化 HTTP body，性能 overhead 未减少
    3. 如果 `routeInternal` 有 bug，RPC 和 fetch 同时受影响
  - Z2 closure 声称 "control-plane RPC 已进入主路径证明"，但当前实现更像 "RPC facade over HTTP"
- **审查判断**：
  - 当前实现符合 Z2 的 "kickoff" 定位（先打通路径），但不符合 "RPC-first seam" 的深层目标
  - 这不是 bug，而是 architectural debt，需要在 Z3 前明确 retire plan
- **建议修法**：
  - 短期：在 Z2 closure 的 known limitations 中明确记录 "RPC 方法内部仍转发至 HTTP surface，Z3 需重构为直接 DO 调用"
  - 中期（Z3）：将 `status/start` 的 RPC 实现改为直接调用 `SESSION_DO.get(idFromName(sessionUuid)).fetch()` 或暴露 DO 的 RPC 方法
  - 长期：参考 `orchestrator-auth` 的纯 RPC 模式，agent-core 的 control-plane 也应逐步退役 HTTP internal surface

### R4. forwardStart 的 parity 检查使用 JSON.stringify

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `user-do.ts:684-686`：`const parityOk = rpcResult.status === fetchResult.response.status && JSON.stringify(rpcResult.body ?? null) === JSON.stringify(fetchResult.body ?? null)`
  - `JSON.stringify` 对对象 key 的顺序敏感：`{a:1,b:2}` 和 `{b:2,a:1}` 的 stringify 结果不同
  - Cloudflare Workers 的 JavaScript 引擎（V8）中对象 key 的顺序通常按插入顺序，但不同代码路径可能产生不同顺序
- **为什么重要**：
  - 如果 fetch 和 RPC 路径返回的 body 语义相同但 key 顺序不同，parity 检查会失败
  - parity 失败时返回 502（`user-do.ts:688-699`），且 **没有 fallback 到 fetch 路径**
  - 这意味着一个无害的 key 顺序差异会导致 start 整体失败，影响可用性
  - action-plan Phase 4 的收口标准要求 "返回 envelope deep-equal"，但 deep-equal 应指语义相等，而非字符串相等
- **审查判断**：
  - 当前实现在简单场景下工作，但在复杂 body（嵌套对象、数组）时容易产生 false negative
  - 这是 Z2 "dual-impl parity" 证明的可靠性问题
- **建议修法**：
  - 将 `JSON.stringify` 比较替换为语义 deep-equal（如引入 `fast-deep-equal` 或手写递归比较）
  - 或：在 parity 失败时记录 warning 并 fallback 到 fetch 结果，而不是直接返回 502
  - 添加注释说明 parity 检查的目的（"检测 RPC 与 fetch 的语义漂移"）

### R5. handleStart 失败时的 D1 清理不完整

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `user-do.ts:798-828`：当 `startAck.response.ok` 为 false 时：
    1. `await this.delete(sessionKey(sessionUuid))` — 清理 DO state
    2. `await this.sessionTruth()?.closeTurn(...)` — 关闭 turn（如果存在）
    3. `await this.appendDurableActivity(...)` — 记录失败 activity
    4. 返回 503 错误响应
  - 但 `ensureDurableSession`（`user-do.ts:751-756`）已 earlier 调用了 `repo.beginSession()`，该操作已：
    - INSERT `nano_conversation_sessions`
    - 可能 INSERT `nano_conversations`
    - UPDATE `nano_conversations`
  - 这些 D1 记录在 start 失败后 **未被删除**
- **为什么重要**：
  - 这会产生孤儿 session：D1 中有 `session_status='starting'` 的 session 记录，但 DO state 已被删除
  - 如果用户随后用相同的 session_uuid 重试 start，`beginSession` 的 `SELECT existing`（`session-truth.ts:82-93`）会返回已存在的 conversation_uuid
  - 但此时 DO state 已被清理，导致 D1 和 DO 的不一致
  - 这与 action-plan Phase 2 风险提醒（"最容易出现 DO state 与 D1 truth 分叉"）直接相关
- **审查判断**：
  - 这是一个明确的 cleanup gap，属于错误路径的遗漏
  - 当前测试（`user-do.test.ts:274-297`）验证了 start 失败时 DO state 被删除，但未验证 D1 记录是否被清理
- **建议修法**：
  - 在 `handleStart` 的失败路径中，添加 D1 清理：
    - DELETE `nano_conversation_sessions` WHERE session_uuid = ?
    - 如果 conversation 是本次新建的，DELETE `nano_conversations` WHERE conversation_uuid = ?
  - 或：将 `beginSession` 的 D1 操作延迟到 `startAck.response.ok` 确认后执行（但这样会影响 timeline/history 的可用性）
  - 更优方案：使用事务包裹 `beginSession` + `createTurn` + `recordUserMessage`，失败时整体回滚

### R6. DO hot-state trim 不完整

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `user-do.ts:645-659` 的 `trimHotState`：
    - trim `conversation_index` 到 `MAX_CONVERSATIONS`（200）
    - 遍历 `ENDED_INDEX_KEY`，删除超过 `ENDED_TTL_MS`（24h）的 session 的 recent_frames 和 cache
    - **没有 trim active session 的 recent_frames**
    - **没有 trim cache 的 TTL 检查**
  - `user-do.ts:542-544` 的 `recordStreamFrames`：在写入时通过 `frames.slice(-MAX_RECENT_FRAMES)` 限制新写入的帧数
  - 但 action-plan Phase 3 的收口标准要求：
    - "trim recent_frames > 50 / session"
    - "expire reconnect cursors > 1h"
    - "refresh / evict secret cache"
- **为什么重要**：
  - 如果某个 session 长期活跃（如持续数小时），其 recent_frames 不会被 alarm 清理，仅依赖写入时的 slice
  - 但写入时的 slice 只限制单次写入，不限制累计——如果 session 活跃数小时并产生大量帧，DO storage 中仍可能积累大量历史帧
  - cache 的 TTL 检查缺失：过期的 cache 条目不会被自动清理
  - 这与 Q6 冻结的 "DO Alarm 每 10 min 负责 trim recent_frames、过期 reconnect hints、evict short-lived cache" 要求不符
- **审查判断**：
  - 当前实现覆盖了 "conversation_index ≤ 200" 和 "ended session cleanup"
  - 但缺失 "active session recent_frames trim" 和 "cache TTL eviction"
  - 这不是紧急问题（active session 的 frames 有写入时 slice），但不符合 Q6 的完整约束
- **建议修法**：
  - 在 `trimHotState` 中添加 active session 的 recent_frames 遍历和 trim
  - 添加 cache TTL 检查：遍历所有 `cache/*` keys，删除 `expires_at < now` 的条目
  - 在 Z2 closure 的 known limitations 中记录 "active session frame trim 依赖写入时 slice，alarm 未覆盖"

### R7. nano-session-do.ts 仍依赖 env.TEAM_UUID fallback

- **严重级别**：`medium`
- **类型**：`security`
- **事实依据**：
  - `nano-session-do.ts:503-511` 的 `currentTeamUuid()`：
    ```typescript
    if (this.sessionTeamUuid && this.sessionTeamUuid.length > 0) return this.sessionTeamUuid;
    const envTeamUuid = (this.env as { TEAM_UUID?: unknown })?.TEAM_UUID;
    return typeof envTeamUuid === "string" && envTeamUuid.length > 0 ? envTeamUuid : null;
    ```
  - Z2 closure 声称 "`internal-policy.ts` 不再把 worker-local `TEAM_UUID` 作为 internal authority 的唯一 tenant truth"
  - 但 `nano-session-do.ts` 的 `currentTeamUuid()` 仍使用 `env.TEAM_UUID` 作为 fallback
  - `tenantTeamUuid()`（`nano-session-do.ts:609-614`）在两者都为空时返回 `"_unknown"`
  - `verifyTenantBoundary` 在 `nano-session-do.ts:580-584` 中被调用，但 `do_team_uuid` 参数是 `this.tenantTeamUuid()`，即 `"_unknown"`
- **为什么重要**：
  - 如果 session 未成功 attach teamUuid（如 ingress 帧中 authority 缺失），`currentTeamUuid()` 会 fallback 到 `env.TEAM_UUID`
  - 在 preview 环境中，`env.TEAM_UUID` 是 `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`（wrangler.jsonc 中的占位符）
  - 这意味着所有未正确 attach teamUuid 的 session 都会共享同一个 deploy-local team，破坏了 tenant 隔离
  - 更关键的是：`verifyTenantBoundary` 的 `serving_team_uuid` 和 `do_team_uuid` 都是 `"_unknown"`，边界验证实际上是无效的
- **审查判断**：
  - Z2 确实削弱了 `internal-policy.ts` 的 TEAM_UUID 锚，但 `nano-session-do.ts` 作为 runtime DO 仍保留了 fallback
  - 这是 deploy-local tenant truth 向 session-owned tenant truth 迁移过程中的残留
  - 当前不影响功能（所有请求都有 authority），但存在安全边界模糊
- **建议修法**：
  - 在 `currentTeamUuid()` 中移除 `env.TEAM_UUID` fallback，当 `sessionTeamUuid` 为空时直接返回 `null`
  - 在 `tenantTeamUuid()` 中，当 teamUuid 为空时抛错或拒绝请求，而不是返回 `"_unknown"`
  - 更新 wrangler.jsonc 中的 `TEAM_UUID` 为 `""` 或移除，强制所有 tenant truth 来自 session ingress

### R8. checkpoint restore 未恢复 actorState.phase

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `nano-session-do.ts:1209-1235` 的 `restoreFromStorage`：
    - 读取 `SESSION_TEAM_STORAGE_KEY` 恢复 `sessionTeamUuid`
    - 读取 checkpoint 并验证
    - 恢复 `kernelSnapshot` 和 `turnCount`
    - `this.state = { actorState: this.state.actorState, kernelSnapshot: raw.kernelFragment, turnCount: raw.turnCount }`
  - 注意：`actorState` 取自 `this.state.actorState`（当前内存中的值），而不是 checkpoint 中保存的值
  - `persistCheckpoint`（`nano-session-do.ts:1152-1207`）保存了 `actorPhase: this.state.actorState.phase`
  - 但 `restoreFromStorage` 没有使用 `raw.actorPhase`
- **为什么重要**：
  - 如果 session 在 `turn_running` phase 时 hibernation，恢复后 `actorState.phase` 应该是 `turn_running`
  - 但当前代码恢复后，`actorState.phase` 是构造函数中 `createInitialState()` 设置的初始值（通常是 `idle`）
  - 这会导致恢复后的 session 无法正确处理正在运行的 turn（如 client 发送 cancel 时，phase gate 认为当前不是 `turn_running`）
  - 这与 Z2 design doc F3 的判定方法（"清空 DO storage 后 reconnect 仍能从 D1 恢复"）直接冲突
- **审查判断**：
  - 这是一个明确的 restore gap，checkpoint 写入了 phase 但恢复时未使用
  - 当前测试未覆盖 hibernation + restore 的场景（vitest 中 DO storage 是内存 Map，但 checkpoint/restore 流程被测试覆盖了吗？）
- **建议修法**：
  - 在 `restoreFromStorage` 中，将 `this.state.actorState.phase` 恢复为 `raw.actorPhase`
  - 可能需要恢复更多 actorState 字段（如 `pendingInputs`）
  - 添加测试：模拟 hibernation（persist checkpoint → 构造新 DO → restore），验证 phase 正确恢复

### R9. appendActivity 的 event_seq 并发安全

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `session-truth.ts:387-392`：
    ```typescript
    const next = await this.db.prepare(
      `SELECT COALESCE(MAX(event_seq), 0) + 1 AS next_event_seq FROM nano_session_activity_logs WHERE trace_uuid = ?1`
    ).bind(input.trace_uuid).first<Record<string, unknown>>();
    const event_seq = toCount(next?.next_event_seq) || 1;
    ```
  - 这是经典的 "read then write" 反模式：先读取当前最大值，再加 1 写入
  - 在并发场景（如多个 worker 同时向同一 trace 写入 activity），两个并发读取可能得到相同的 MAX 值，导致写入相同的 event_seq
- **为什么重要**：
  - Q5 明确要求 "`event_seq`（同 trace 内顺序）... trace 内严格 seq 是 owner 巡检'事件顺序'必备"
  - 如果 event_seq 重复，audit 的时序性被破坏，无法确定事件的真正顺序
  - 虽然 D1 是单节点 SQLite（同一数据库的写入是串行的），但 Cloudflare D1 的读取可能来自 replica，存在读-写竞态
  - action-plan Phase 5 的收口标准要求 "至少 1 条 trace linkage 证明成立"，隐含要求 seq 的唯一性
- **审查判断**：
  - 当前实现在低并发下工作，但在高并发或分布式写入时可能失效
  - 这是 SQLite 的已知限制，但可以通过事务或自增列缓解
- **建议修法**：
  - 方案 A（推荐）：在 `appendActivity` 中使用事务包裹 SELECT MAX + INSERT，利用 SQLite 的串行化隔离
  - 方案 B：使用 SQLite 的 `AUTOINCREMENT`（但 D1 的 `INTEGER PRIMARY KEY AUTOINCREMENT` 可能不支持跨 trace 的隔离）
  - 方案 C：在应用层使用分布式 ID（如 Snowflake），但失去了 per-trace 的严格递增语义
  - 短期：在事务中执行 SELECT MAX + INSERT
  - 长期：考虑将 `event_seq` 改为 `BIGINT` 并使用数据库序列

### R10. 缺少 redaction 验证测试

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - `user-do.ts:206-217` 的 `redactActivityPayload` 已实现，过滤字段包括：`access_token`、`refresh_token`、`authority`、`auth_snapshot`、`password`、`secret`、`openid`、`unionid`
  - `user-do.ts:450-476` 的 `appendDurableActivity` 已调用 `redactActivityPayload`
  - 但现有测试中：
    - `user-do.test.ts` 没有验证 activity log payload 中是否包含敏感字段
    - `smoke.test.ts` 没有验证 redaction
    - `rpc.test.ts` 没有涉及 activity
    - E2E 测试中未找到 redaction 验证
  - Z2 closure 声称 "至少 1 条 redaction 证明成立"，但代码审查中未找到该测试
- **为什么重要**：
  - activity log 是 audit baseline，如果 payload 中意外包含 access_token 或 password，会造成安全泄漏
  - redaction 是 Q5 明确要求的 "写入侧统一过滤；不允许任何 worker 直接 INSERT 不经过 redaction wrapper"
  - 没有测试保护的 redaction 容易在后续修改中被绕过
- **审查判断**：
  - redaction 实现存在但测试缺失，属于 "实现了但未被证明"
  - 这是 Z2 收口标准的直接 gap
- **建议修法**：
  - 在 `workers/orchestrator-core/test/user-do.test.ts` 中添加测试：
    1. 构造一个包含 `access_token` 的 start 请求
    2. 验证 D1 中 `nano_session_activity_logs` 的 payload 中 `access_token` 已被替换为 `[redacted]`
  - 在 `test/package-e2e/orchestrator-core/` 中添加 redaction 验证

### R11. Z2 closure 的 known limitations 不完整

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `Z2-closure.md:101-107` 记录了 4 条 residuals：
    1. `input/cancel/timeline/verify/stream` 仍主要走 fetch-backed internal seam
    2. `nano_session_activity_logs` 的 query/analytics plane 仍是后续主题
    3. root `pnpm test:contracts` 被既有失败阻塞
    4. agent-core 仍未直接 bind `NANO_AGENT_DB`
  - 但未记录：
    - D1 写操作缺乏事务保护（R1）
    - activity_log schema 与 Q5 设计不一致（R2）
    - RPC 仍是 HTTP shim（R3）
    - DO hot-state trim 不完整（R6）
    - checkpoint restore 不完整（R8）
    - event_seq 并发安全（R9）
- **为什么重要**：
  - Z2 closure 是 Z3 的输入文档，如果已知限制不完整，Z3 可能重复踩坑或基于错误假设推进
  - 特别是 D1 事务缺失和 RPC shim 问题，会直接影响 Z3 的 runtime 和 quota 设计
- **审查判断**：
  - 当前 closure 的 residuals 偏乐观，未完整反映代码审查发现的结构性问题
  - 这不是故意隐瞒，而是实施者可能未意识到这些问题的严重性
- **建议修法**：
  - 在 `Z2-closure.md` 的 "仍需诚实记录的 residuals" 中补充上述 6 项
  - 对每项标注严重级别和对 Z3 的潜在影响

---

## 3. In-Scope 逐项对齐审核

### Z2 Action-Plan Phase 1-5

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| P1-01 | Wave B schema 落地 | `done` | 6 张表 + 4 条索引已创建，preview D1 已 apply |
| P2-01 | public session persistence | `partial` | start/input/cancel 已写入 D1，但 **失败路径未清理 D1**（R5）；history/timeline/verify 已读 D1 |
| P2-02 | activity log append path | `partial` | append-only + redaction 已实现，但 **schema 与 Q5 不一致**（R2），**缺少 redaction 测试**（R10） |
| P3-01 | DO hot-state compaction | `partial` | 四组集合已定义，但 **trim 不完整**（R6）：active session frames 和 cache TTL 未在 alarm 中清理 |
| P3-02 | replay / heartbeat baseline | `done` | replay cursor、heartbeat ack、ws attach/supersede 已实现；ended session cleanup 已落实 |
| P4-01 | internal status RPC smoke | `partial` | `status()` RPC 方法存在，但 **内部仍走 HTTP**（R3），不是 native RPC |
| P4-02 | internal start kickoff | `partial` | `start()` RPC 方法 + dual-impl parity 已存在，但 **parity 检查使用 JSON.stringify**（R4），**内部仍走 HTTP**（R3） |
| P5-01 | replay/activity tests | `partial` | package-e2e + cross-e2e 全绿，但 **缺少 redaction 验证**（R10）、**缺少 hibernation restore 测试**（R8） |
| P5-02 | Z2 closure 文档 | `partial` | 文档存在，但 **known limitations 不完整**（R11） |

### Z2 Design Doc F1-F4

| 编号 | 功能项 | 审查结论 | 说明 |
|------|--------|----------|------|
| F1 | Conversation Truth | `partial` | session 结束后可读 history，但 **D1 写操作无事务**（R1），**失败路径产生孤儿记录**（R5） |
| F2 | Context/Audit Truth | `partial` | context snapshot + activity log 已落地，但 **schema 与 Q5 不一致**（R2），**event_seq 可能重复**（R9） |
| F3 | Stateful Uplift | `partial` | DO SQLite + Alarm 已启用，但 **trim 不完整**（R6），**checkpoint restore 不完整**（R8） |
| F4 | RPC Kickoff | `partial` | `status/start` 双实现已存在，但 **RPC 仍是 HTTP shim**（R3），未达到 "control-plane RPC 已进入主路径证明" |

### 3.1 对齐结论

- **done**: 2（P1-01、P3-02）
- **partial**: 7（P2-01、P2-02、P3-01、P4-01、P4-02、P5-01、P5-02）
- **missing**: 0

> Z2 的核心交付物已真实落地，preview live evidence 成立。但 D1 事务缺失、schema 与 design 不一致、RPC 未真正 native、DO trim 不完整等问题表明，它更像 "功能骨架完成，但 correctness 和 completeness 仍未收口" 的状态，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | real Workers AI provider 与 quota gate | `遵守` | 未在 Z2 代码中出现相关实现 |
| O2 | 完整 client UI 与真机链路 | `遵守` | Z2 只做了 web thin client persistence proof，未涉及 Mini Program |
| O3 | 丰富的 admin analytics / BI query layer | `遵守` | activity log 只有 append path，无 query projection |
| O4 | HTTP public surface 的全面退役 | `遵守` | public façade 保持不变，internal HTTP 作为过渡面保留 |
| O5 | `smind-06` full collaboration richness | `遵守` | message_parts / participants 未实现 |
| O6 | cold archive / R2 offload | `遵守` | 未涉及 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：Z2 的 session truth baseline 已真实建立，具备继续推进 Z3 的条件，但存在 3 个 high 级别 blocker 必须在 Z3 启动前修复或明确记录。
- **是否允许关闭本轮 review**：`no`（需修复或记录 R1、R2、R5 后重新审查）
- **关闭前必须完成的 blocker**：
  1. **R1**: 为 `session-truth.ts` 的关键写操作添加 SQLite 事务保护（`beginSession`、`createTurn`、`appendActivity`）
  2. **R2**: 修正 `nano_session_activity_logs` 的 schema，使 `actor_user_uuid` 和 `conversation_uuid` 与 Q5 设计一致（允许 nullable）
  3. **R5**: 在 `handleStart` 的失败路径中清理已创建的 D1 session/conversation 记录，或延迟 D1 写入到 start 成功后
- **可以后续跟进的 non-blocking follow-up**：
  1. **R3**: 在 Z2 closure 中明确记录 "RPC 仍是 HTTP shim，Z3 需重构为 native"（high，但非 Z2 blocker）
  2. **R4**: 将 `forwardStart` 的 parity 检查从 `JSON.stringify` 改为语义 deep-equal（medium）
  3. **R6**: 在 `trimHotState` 中补充 active session frames 和 cache TTL 的清理（medium）
  4. **R7**: 移除 `nano-session-do.ts` 的 `env.TEAM_UUID` fallback（medium）
  5. **R8**: 在 checkpoint restore 中恢复 `actorState.phase`（medium）
  6. **R9**: 使用事务保护 `appendActivity` 的 event_seq 生成（high，但可通过 R1 的事务方案一并解决）
  7. **R10**: 添加 redaction 验证测试（medium）
  8. **R11**: 补充 Z2 closure 的 known limitations（medium）

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。


---

## 7. 跨阶段深度分析（Z0-Z2 对 Z3-Z5 的影响）

### 7.1 Z2 对 Z3 的直接约束

1. **D1 事务缺失将放大 Z3 的 quota 写入风险**：
   - Z3 需要写入 `nano_usage_events` 和 `nano_quota_balances`，如果继续沿用 Z2 的无事务模式，quota deduct + usage record 的双写可能部分失败，导致 quota 泄漏或重复计费
   - **建议**：Z3 在开始 quota schema 前，先建立 `D1SessionTruthRepository` 级别的事务模式，作为所有 D1 写入的标准

2. **RPC HTTP shim 将阻碍 Z3 的 runtime mesh 优化**：
   - Z3 需要高频调用 agent-core（如每轮 LLM invoke），如果仍通过 HTTP shim，latency 和序列化 overhead 会成为瓶颈
   - **建议**：Z3 应将 agent-core 的 `status/start` 重构为直接 DO RPC 调用，退役 `routeInternal` 的 HTTP 路径

3. **activity_log 的 schema 不一致将影响 Z3 的 audit 链路**：
   - Z3 的 quota deny 事件（Q9）需要写入 `nano_session_activity_logs`，但 quota deny 可能没有 actor_user_uuid（如系统级 deny）
   - 如果 Z2 的 schema 保持 NOT NULL，Z3 的 quota deny 写入会失败
   - **建议**：必须在 Z3 前修复 R2

### 7.2 Z2 对 Z4 的间接约束

1. **DO hot-state trim 不完整将影响 Mini Program 的 reconnect 体验**：
   - Z4 的 Mini Program 需要频繁 reconnect（WeChat idle disconnect），如果 active session 的 recent_frames 无限累积，DO storage 会膨胀
   - **建议**：在 Z4 前修复 R6，确保 alarm 定期清理 active session 的 frames

2. **checkpoint restore 不完整将影响 hibernation 后的 session 恢复**：
   - Mini Program 的 session 可能因长时间后台运行而 hibernation，恢复后 phase 不正确会导致 client 侧状态混乱
   - **建议**：在 Z4 前修复 R8

### 7.3 命名规范跨包一致性检查

| 概念 | Z2 命名 | Z1 命名 | ddl-v170 命名 | 建议 |
|------|---------|---------|---------------|------|
| 会话表前缀 | `nano_conversation_*` | `nano_*` | `smind_*` | 保持 `nano_` 前缀，但 `conversation` 层级清晰 |
| 活动日志 | `nano_session_activity_logs` | — | — | 与 Q5 一致，保持 |
| 消息角色 | `message_role` (`user`/`assistant`/`system`) | — | — | 与 OpenAI 消息角色一致，合理 |
| 会话状态 | `session_status` (`starting`/`active`/`detached`/`ended`) | — | — | 状态机清晰，但 `detached` 与 `ended` 的边界需文档说明 |
| turn 类型 | `turn_kind` (`start`/`followup`/`cancel`) | — | — | 覆盖核心操作，但 `cancel` 是否算 turn 需说明 |
| 上下文快照 | `snapshot_kind` (`initial-context`) | — | — | 当前只有一类，Z3 会扩展 |

### 7.4 安全边界跨阶段一致性

1. **Tenant boundary 的演进**：
   - Z1：依赖 `env.TEAM_UUID` 作为 deploy-local anchor
   - Z2：声称削弱 deploy-local anchor，但 `nano-session-do.ts` 仍有 fallback（R7）
   - Z3：quota gate 需要精确的 team_uuid，如果仍 fallback 到 env，会导致 quota 计算错误
   - **建议**：在 Z3 前完全移除 `env.TEAM_UUID` 的 runtime 依赖，仅在 deploy config 中保留作为 bootstrap hint

2. **JWT verify 的三份实现**：
   - Z1：`orchestrator-auth/src/jwt.ts`（mint + verify）
   - Z1：`orchestrator-core/src/auth.ts`（verify only）
   - Z2：无新增，但 `nano-session-do.ts` 的 `buildIngressContext` 使用 `currentTeamUuid()` 而非 JWT verify
   - **建议**：Z3 应考虑将 verify 逻辑提取到共享包，避免三份维护

3. **Redaction discipline 的扩展**：
   - Z2：实现了 activity log 的 redaction（`redactActivityPayload`）
   - Z3：quota deny 的 payload 可能包含敏感字段（如剩余额度），需要复用 redaction
   - Z4：client 侧的 stream event 也需要 redaction（`packages/nacp-session/src/redaction.ts`）
   - **建议**：将 `redactActivityPayload` 的字段列表提取到配置，供 Z3/Z4 复用

---

## 8. 审查纪律声明

- 本审查完全基于 Kimi (k2p6) 的独立 reasoning，未参考其他同事（Deepseek、Opus、GPT）的分析报告。
- 所有发现均有文件路径和行号支撑。
- 审查结论基于 Z2 action-plan、Z2 design doc、ZX-qna Q5-Q7、ZX-d1-schema、以及实际代码事实的多方对照。
- 跨阶段分析（§7）基于 charter 的 Z3-Z5 设计文档和当前 Z2 实现的接口契约。
- Z1 审查发现项的修复状态已独立验证（如 `caller: "orchestrator-core"` 的显式传递）。

---

(End of review)

---

## 9. 对 Kimi 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-25`
> 评价依据: `本文件 §0-§8；以及实现者对照修复结果（docs/code-review/zero-to-real/Z2-reviewed-by-opus.md §7）`

### 9.1 一句话评价评审风格

Kimi 的这份审查更像 **runtime/错误路径排障型 code review**：对实际执行路径、失败回滚、restore 与测试空洞很敏感，动作性强，但在 D1 事务模型上有一处关键前提判断不准。

### 9.2 优点
1. 很擅长抓 **错误路径与可恢复性** 问题：`handleStart` 清理不完整、checkpoint phase restore 缺失、redaction test 缺位，这些都是真实高价值发现。
2. 审查建议大多直接落在实现层，执行者很容易顺着建议去改代码和补测试。
3. 报告可读性好，issue 切分清晰，不容易把问题说成抽象口号。

### 9.3 缺点
1. R1 / R9 明显依赖“SQLite 手写事务可直接用于当前 D1 路径”这一前提，但本仓库 D1 约定是 `db.batch(...)`，所以修法建议方向有偏差。
2. 对 cross-doc / ownership / 字段冻结漂移的系统性深度不如 DeepSeek 和 Opus。
3. 一些 blocker 结论建立在事务前提上，导致优先级判断略显机械。

### 9.4 对审查报告中，全部问题，的清点

| 问题编号 | 原始严重程度 | 该问题的质量 | 分析与说明 |
|----|------|------|------------------|
| R1 | high | 中 | “多步写入缺原子保护”这个 concern 是真的，但把 `BEGIN TRANSACTION` 当作当前 repo/D1 的正解并不准确。 |
| R2 | high | 高 | activity log nullable 漂移完全成立，属于高价值 schema 问题。 |
| R3 | high | 高 | RPC kickoff 仍是 HTTP shim 的判断准确，且对后续 Z3 很重要。 |
| R4 | medium | 高 | `JSON.stringify` parity 问题指认准确，后续也被直接修复。 |
| R5 | high | 高 | start 失败后 D1 清理不完整是非常真实的错误路径缺口。 |
| R6 | medium | 中 | hot-state trim 不完整成立，但对当前 storage 可遍历能力与未建模 cache family 的边界把握一般。 |
| R7 | medium | 中 | `env.TEAM_UUID` fallback 是真实风险，但是否应在本轮硬移除仍带较强设计权衡。 |
| R8 | medium | 高 | checkpoint restore 未恢复 `actorState.phase` 的发现非常精准，且容易复现。 |
| R9 | high | 中 | `event_seq` 并发风险判断成立，但修法依然受错误事务前提拖累。 |
| R10 | medium | 高 | redaction 测试缺位是高质量 test-gap，后续已补。 |
| R11 | medium | 高 | closure residuals 过满的问题成立，且对后续协作非常关键。 |

### 9.5 评分 - 总体 ** 7.6 / 10 **

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 8 | 基本证据充分，代码路径抓得准。 |
| 判断严谨性 | 7 | 多数判断成立，但 D1 事务前提影响了几条关键建议的严谨性。 |
| 修法建议可执行性 | 7 | 很多建议可直接改代码；事务相关建议在当前仓库里不适用。 |
| 对 action-plan / design 的忠实度 | 8 | 对 Q5/Q6/Q7 有对照，但系统性文档漂移覆盖不够广。 |
| 协作友好度 | 8 | 报告可读性和执行友好度都不错。 |
| 找到问题的覆盖面 | 7 | runtime/rollback/restore 很强，设计契约层广度较弱。 |
