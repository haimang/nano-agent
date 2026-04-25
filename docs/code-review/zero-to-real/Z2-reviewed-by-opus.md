# Z2 Code Review — Session Truth and Audit Baseline

> 审查对象: `zero-to-real / Z2 / session-truth-and-audit-baseline`
> 审查时间: `2026-04-25`
> 审查人: `Opus 4.7 (1M context)`
> 审查范围:
> - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`
> - `docs/issue/zero-to-real/Z2-closure.md`
> - `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md`
> - `docs/design/zero-to-real/ZX-qna.md`（Q5/Q6/Q7）
> - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`
> - `workers/orchestrator-core/src/{session-truth,user-do,index,auth}.ts`
> - `workers/agent-core/src/index.ts`
> - `workers/agent-core/src/host/{internal-policy,internal,routes,session-edge}.ts`
> - `workers/agent-core/src/host/do/nano-session-do.ts`
> - `workers/orchestrator-auth/src/wechat.ts`
> - `workers/{orchestrator-core,agent-core}/wrangler.jsonc`
> - `workers/orchestrator-core/test/user-do.test.ts`、`workers/agent-core/test/rpc.test.ts`
> - `context/ddl-v170/smind-06-conversation-context-session.sql`（参考真相）
> 文档状态: `reviewed`

---

## 0. 总结结论

> Z2 的主体骨架成立：D1 schema 已落、user-do 已经具备 durable owner 身份、DO 四组热态、`status` RPC smoke 与 `start` parity scaffold 都已经出现在仓库里，preview deploy 与 live e2e 也确实跑过。**但若用 Q5 / Q6 / Q7 的字面冻结答案去逐条检查，会发现 schema 的强约束与并发安全没有真正落地，Z1 carry-over 中"deploy-fill 在 runtime 退役"也没有被 Z2 收口。**

- **整体判断**：`Z2 主体可以认定为 closed-with-followups，但当前 schema 与 audit 并发纪律并未达到 Q5 冻结口径，必须在 Z3 Phase 1 之前补。`
- **结论等级**：`approve-with-followups`
- **本轮最关键的 3 个判断**：
  1. **`nano_session_activity_logs.event_seq` 没有按 Q5 冻结的"per-trace 严格递增"落地**——schema 没有 `UNIQUE(trace_uuid, event_seq)`，写入路径用 `SELECT MAX+1` 然后裸 INSERT，存在并发幂等漏洞。这是字面违反冻结答案的 correctness 问题。
  2. **整张 002-session-truth-and-audit.sql 完全没有任何 FK / 任何 UNIQUE / 任何 CHECK 数值约束**——action-plan §4.1 P1-01 的收口标准是"tables、foreign keys、indexes、enum discipline 完整存在"，当前只满足 enum/CHECK 部分，FK 与 unique 全部缺位。
  3. **Z1 carry-over C-1（"deploy-fill 在 runtime 退役"）没有真正收口**——`workers/agent-core/src/host/internal-policy.ts:53` 与 `workers/orchestrator-core/src/user-do.ts:175` 都还显式接受 `tenant_source: "deploy-fill"`，Z2 closure §2.6 的措辞回避了这一事实。

---

## 1. 审查方法与已核实事实

> 这一节只列事实，不下结论。

- **对照文档**：
  - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`（含 §9 GPT 工作日志）
  - `docs/issue/zero-to-real/Z2-closure.md`
  - `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md`
  - `docs/design/zero-to-real/ZX-qna.md`（Q5 / Q6 / Q7）
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`（schema baseline）
  - `docs/issue/zero-to-real/Z1-closure.md` §4（carry-over 残留项）
  - `context/ddl-v170/smind-06-conversation-context-session.sql`（祖宗 schema 的参考形状）

- **核查实现**：
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`（97 行）
  - `workers/orchestrator-core/src/session-truth.ts`（499 行；D1 repository）
  - `workers/orchestrator-core/src/user-do.ts`（1466 行；含 4 组 hot-state、durable wiring、parity check）
  - `workers/orchestrator-core/src/index.ts`（225 行；public façade）
  - `workers/orchestrator-core/src/auth.ts`（254 行；ingress JWT + tenant 来源）
  - `workers/agent-core/src/index.ts`（249 行；含 `WorkerEntrypoint` + `status/start` RPC）
  - `workers/agent-core/src/host/internal-policy.ts`（241 行）
  - `workers/agent-core/src/host/do/nano-session-do.ts`（含 `attachTeamUuid` / session-owned team truth / hibernation 持久化）
  - `workers/orchestrator-auth/src/wechat.ts`（U-3 修复路径）
  - `workers/{orchestrator-core,agent-core}/wrangler.jsonc`
  - `workers/orchestrator-core/test/user-do.test.ts` 与 `workers/agent-core/test/rpc.test.ts`

- **执行过的验证**：
  - `Read` 通读所有上述文件（一手代码事实）
  - 通过 grep 验证 ZX-d1 / ZX-qna 中 Q5、Q6、Q7 的字面冻结口径
  - 与 `context/ddl-v170/smind-06-conversation-context-session.sql` 做 schema 形状交叉对照
  - 比对 Z1 closure §4 列出的 carry-over 是否在 Z2 实现中真正闭合

### 1.1 已确认的正面事实

- **F1**：`workers/orchestrator-core/migrations/002-session-truth-and-audit.sql` 已建出 `nano_conversations / nano_conversation_sessions / nano_conversation_turns / nano_conversation_messages / nano_conversation_context_snapshots / nano_session_activity_logs` 六张表，列名与 ZX-qna §3.5 中 first-wave 字段口径一致。
- **F2**：`nano_session_activity_logs` 列数为 12（活动日志 12 列冻结口径满足），3 条强制 index `(team_uuid, created_at DESC)` / `(trace_uuid, event_seq)` / `(session_uuid, created_at)` 全部存在。
- **F3**：`workers/orchestrator-core/src/user-do.ts` 的 4 组 hot-state（`conversation/index`、`conversation/active-pointers`、`recent-frames/<session>`、`cache/*`）、容量上限（`MAX_CONVERSATIONS=200` / `MAX_RECENT_FRAMES=50` / `CACHE_TTL_MS=5min`）、以及 `HOT_STATE_ALARM_MS=10min` 都直接对应 Q6 冻结答案。
- **F4**：`AgentCoreEntrypoint` 已通过 `cloudflare:workers` 的 `WorkerEntrypoint` 暴露 `status()` / `start()` 两条 RPC 方法；`workers/orchestrator-core/src/user-do.ts:forwardStart` 中已实现 fetch/RPC 双跑 + JSON-stringify 等价性比较；`workers/agent-core/test/rpc.test.ts` 给出了 `status` / `start` RPC 路径的 unit 证明。
- **F5**：`workers/agent-core/src/host/do/nano-session-do.ts` 已实现 session-owned `team_uuid` 锁存：`attachTeamUuid` 在每帧 ingress 时记忆 `result.frame.authority.team_uuid`，并通过 `SESSION_TEAM_STORAGE_KEY` 在 hibernation 后恢复——这是 Z1 carry-over 中"runtime 不再仅依赖 deploy-local TEAM_UUID"的真实落地路径。
- **F6**：`workers/orchestrator-auth/src/wechat.ts` 的 retry 已经收紧为 network/timeout/5xx，不再对 `AuthServiceError`（user-caused）进行重试，U-3 已修复。
- **F7**：`workers/{orchestrator-core,agent-core}/wrangler.jsonc` 的 `TEAM_UUID` 已经从 `"nano-agent"` 字面量收紧为 UUID-shaped placeholder，Z1 carry-over C-2 已正确收口（Z2 闭合 carry-over 的部分）。
- **F8**：`workers/orchestrator-core/src/auth.ts:215-217` 中 `tenant_source` 判定已经从 truthy-check 修正为 source-check（`teamClaim || legacyTenantClaim ? "claim" : "deploy-fill"`），Z1 carry-over C-3（auth.ts:221 逻辑漏洞）已修复。
- **F9**：`workers/orchestrator-core/src/index.ts:113-119:readAccessToken` 已经只接 Authorization 头，不再读 query string；`/sessions/*` 路径只在 `route.action === "ws"` 时显式打开 `allowQueryToken`。Z1 R8 残痕（U-1）在 Z2 中已完整收口。
- **F10**：`workers/orchestrator-core/src/user-do.ts:206-217:redactActivityPayload` 已经把 `access_token / refresh_token / authority / auth_snapshot / password / secret / openid / unionid` 八条敏感字段做 write-side redaction，`recordStreamFrames` 与 `appendDurableActivity` 都通过它过滤——Q5 冻结的 redaction 纪律对 activity log 路径成立。
- **F11**：`workers/orchestrator-core/src/user-do.ts:170-176:isAuthSnapshot` 已显式 narrow `tenant_source ∈ {undefined, claim, deploy-fill}`；`internal-policy.ts:50-56:normalizeAuthority` 同样校验该 enum——契约层 narrow 校验真实存在。
- **F12**：closure §3 列出的 preview 链路（`wrangler d1 create nano-agent-preview` + `001/002 migrations apply` + `auth/orchestrator-core/agent-core preview deploy` + `LIVE_E2E pnpm test:package-e2e/cross-e2e` 36/36 与 12/12 全绿）在 wrangler.jsonc 的 `database_id: "71a4b089-93e0-4d8f-afb8-bc9356a97cfa"` 真实落点上得到佐证（不再是 placeholder）。

### 1.2 已确认的负面事实

- **N1**：`migrations/002-session-truth-and-audit.sql` **没有任何 FK 关键字**（grep `REFERENCES`/`FOREIGN` 均为 0 命中）。`nano_conversation_sessions.conversation_uuid`、`nano_conversation_turns.session_uuid`、`nano_conversation_messages.session_uuid`、`nano_conversation_context_snapshots.conversation_uuid`、`nano_session_activity_logs.conversation_uuid` 等都仅是裸 `TEXT NOT NULL` 列，schema 层面无任何引用完整性。
- **N2**：`migrations/002-session-truth-and-audit.sql` **没有任何 UNIQUE 约束**——既没有 `UNIQUE(conversation_uuid, turn_index)`（smind-06 `uq_conversation_turns_index` 的等价物），也没有 `UNIQUE(trace_uuid, event_seq)` 来支撑 Q5 冻结的"per-trace 严格递增"。`session-truth.ts:386-423:appendActivity` 与 `session-truth.ts:196-250:createTurn` 都使用 `SELECT COALESCE(MAX(...),0)+1` 然后裸 INSERT 的 read-then-write 模式，不在 D1 batch 内，没有 unique 兜底。
- **N3**：`workers/agent-core/src/host/internal-policy.ts:50-56` 中 `tenant_source` 仍允许 `"deploy-fill"`；`workers/orchestrator-core/src/user-do.ts:170-176:isAuthSnapshot` 也接受 `"deploy-fill"`。Z1 closure §4.2 把"runtime tenant truth 全量消费"留给 Z2 收口，但 Z2 实际只完成了 session-owned `team_uuid` 持久化（F5），**deploy-fill 路径在 ingress / DO / runtime 全链路依然合法**。
- **N4**：`workers/agent-core/wrangler.jsonc:5` 的 `compatibility_date` 仍然是 `"2026-04-23"`，而 `workers/orchestrator-core/wrangler.jsonc:5` 是 `"2026-04-25"`。Z1 R9 / Z2 closure 都没有在 Z2 阶段统一这两个日期。
- **N5**：`workers/orchestrator-core/src/user-do.ts:347-351:alarm` 与 `645-659:trimHotState` 只做了"trim conversation_index"与"清理 ended_at > 24h 的 sessions 对应 recent-frames/cache"。Q6 冻结的 Alarm 三件事中——"refresh / evict secret cache（包括 JWT key cache）"与"expire reconnect cursors > 1 h"——**前者完全未做**（user-do 内根本没有 secret/JWT cache 概念），后者也没有显式 reconnect cursor 过期逻辑（cursor 状态在 `wsHelper` 内部，Alarm 不触达）。
- **N6**：`workers/orchestrator-core/src/session-truth.ts:425-434:readTimeline` 与 `436-459:readHistory` 在 ORDER BY 上分别使用 `(event_seq ASC, created_at ASC)` 与 `(created_at ASC, event_seq ASC)`，两条路径排序键序相反；同时 `nano_conversation_messages` 的 `event_seq` 是 nullable（`user.input` / `user.cancel` 写 NULL），又没有 `sequence_no` 严格主序——并发或同毫秒消息的相对顺序在 history 路径下不可预测。
- **N7**：`workers/orchestrator-core/src/session-truth.ts:461-497:readSnapshot` 中 `(SELECT COUNT(*) ... )` 子查询对 `nano_conversation_messages` 与 `nano_session_activity_logs` 各做一次全表 COUNT。这两张表都没有 `idx_nano_conversation_messages_session` 单列索引（仅有 `(session_uuid, created_at, event_seq)` 复合索引可用作前缀扫描），COUNT 的最坏复杂度仍是 O(N)。
- **N8**：`workers/orchestrator-core/test/user-do.test.ts` 共 11 条测试，**没有任何一条测"清空 DO storage 后从 D1 重建 hot-state"**——这是 Q6 line 208 明确写的"重建 invariant 测试"；当前 user-do.test 全是用 `Map` 模拟的 storage、没有任何 D1 fixture，也无法做这条测试。
- **N9**：`workers/orchestrator-core/migrations/002-session-truth-and-audit.sql` 缺少 ZX-qna §3.5 中要求的两条索引：`nano_conversation_turns(session_uuid, started_at)` 不存在；`nano_conversation_turns` 在 turn lifecycle / read 路径上完全无索引。
- **N10**：closure §5.3 自己承认 `pnpm test:contracts` 受仓库既有 `docs/nacp-session-registry.md` 缺失阻塞，但本轮 Z2 验证清单 §3.1 也没有跑 `test:contracts`——这意味着 contract 层的 docs-sync 守门完全脱出 Z2 的回归保护范围。
- **N11**：closure §5.4 说"agent-core 仍未直接 bind `NANO_AGENT_DB`"，但 Q5 line 169 同时要求"不允许任何 worker 直接 INSERT 不经过 redaction wrapper"——agent-core 想发 quota/runtime 事件，必须通过 RPC 让 orchestrator-core 代写，这是 Z3 必须解决的 ownership 边界，Z2 closure 没有把它列为 Z3 已知 blocker。
- **N12**：`workers/orchestrator-core/src/session-truth.ts:306-332:appendStreamEvent` 把每一帧 stream 事件单独 `INSERT`，且嵌套调用 `appendActivity`（再做一次 select+insert）——意味着 50 帧的 stream 在 Z2 路径上会触发 `50 × (3 INSERT + 1 SELECT) = 200 D1 round-trips`。Z2 closure 没有列入 perf budget。
- **N13**：`workers/orchestrator-core/src/user-do.ts:683-705:forwardStart` 的 parity 判定使用 `JSON.stringify(rpcResult.body) === JSON.stringify(fetchResult.body)`——key ordering 不稳定（虽然 V8 通常按插入顺序，但任何 path 增减字段都会破坏 parity 判定）。Q7 给出的 parity 形式应该是结构 deep-equal，而不是字符串等价。

---

## 2. 审查发现

### R1. `D1 schema 完全无 FK 与 UNIQUE 约束，与 action-plan 收口标准矛盾`

- **严重级别**：`critical`
- **类型**：`correctness | scope-drift`
- **事实依据**：
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql` 全文 97 行，没有 `REFERENCES` / `FOREIGN KEY` / `UNIQUE` 任何关键字（N1 / N2）。
  - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md` §4.1 P1-01 收口标准原文："`tables、foreign keys、indexes、enum discipline 完整存在`"。
  - 参考真相 `context/ddl-v170/smind-06-conversation-context-session.sql:410` 给出 `uq_conversation_turns_index ON (conversation_uuid, turn_index)` UNIQUE INDEX；nano-agent 的对应表完全缺失。
- **为什么重要**：
  - schema 是后续所有 invariant 的 last line of defense。当 worker 端的 select+insert 出现 race（见 R2 / R3），FK 与 UNIQUE 是阻止数据被静默写错的唯一保险。
  - "FK 完整存在"是 P1-01 的收口标准之一，不是可选项。Z2 closure §4 把这条标记为 ✅ 显然是不准确的。
- **审查判断**：
  - 当前实现把 schema 当成"裸列容器"，把所有完整性纪律推给 worker 端的运行期校验（实际上 worker 也没做）——这是把 audit/durable truth 的纪律降级为 best-effort。
  - Z2 字面口径上 closed，但 schema 层面的 durable 真相质量低于 charter 与 Q5 对"可审计、可回看、可追责"的要求。
- **建议修法**：
  1. 002（或 003 增量）补 FK：`nano_conversation_sessions.conversation_uuid → nano_conversations`、`nano_conversation_turns.session_uuid/conversation_uuid`、`nano_conversation_messages.session_uuid/turn_uuid`、`nano_conversation_context_snapshots.session_uuid`、`nano_session_activity_logs.session_uuid/turn_uuid`。
  2. 补 UNIQUE：`UNIQUE(conversation_uuid, turn_index)` on `nano_conversation_turns`、`UNIQUE(trace_uuid, event_seq)` on `nano_session_activity_logs`、`UNIQUE(session_uuid, sequence_no)` on `nano_conversation_messages`（同时引入 `sequence_no` 列，见 R7）。
  3. 在 `wrangler d1 migrations apply` 之外增加 schema introspection smoke：用 `sqlite_master` 校验 FK / UNIQUE 真实存在。

### R2. `nano_session_activity_logs.event_seq 通过 SELECT MAX+1 写入，并发下违反 Q5 "per-trace 严格递增"`

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/session-truth.ts:386-423:appendActivity`：
    ```ts
    const next = await this.db.prepare(`SELECT COALESCE(MAX(event_seq), 0) + 1 ...`).bind(input.trace_uuid).first(...);
    const event_seq = toCount(next?.next_event_seq) || 1;
    await this.db.prepare(`INSERT INTO nano_session_activity_logs (...) VALUES (...)`).bind(..., event_seq, ...).run();
    ```
  - 002.sql 没有 `UNIQUE(trace_uuid, event_seq)`（N2），D1 也没有 BEGIN/COMMIT 用户事务可用。两次 D1 round-trip 之间没有任何 serialization 保护。
  - ZX-qna.md Q5 line 168 / 385：`event_seq = per-trace 严格递增`、3 条强制 index 之一 `(trace_uuid, event_seq)`。
- **为什么重要**：
  - 同一 trace_uuid 下的两条事件并发 append（例如同一轮 turn 写 `session.start.request` 与 `stream.event` 时），会读到同一个 MAX、计算出同一个 event_seq、双双成功插入。这直接违反 Q5 冻结的"严格递增"。
  - audit 的核心承诺是"事件顺序可证明"，重复 event_seq 在审计回看时必须做去重启发，等同于丢失审计可信度。
  - DO 是单实例串行，"同一 trace_uuid 内"的并发面相对有限——但 `recordStreamFrames` 中 N 帧 + activity 互嵌、followup turn 在 turn 完结前另一帧到达，都能触发竞态。
- **审查判断**：
  - 当前实现在并发路径上不满足 Q5 字面冻结，**只是因为现有测试是单线程顺序写**才看上去工作。
  - 这是 audit 真相的 correctness bug，不是 perf 优化问题。
- **建议修法**：
  1. 加 `UNIQUE(trace_uuid, event_seq)`，并把 `appendActivity` 改成 `INSERT ... SELECT COALESCE(MAX,0)+1 FROM ... WHERE trace_uuid=?` 的单语句 INSERT-FROM-SELECT，让 D1 在同一 statement 内完成读+写。
  2. 失败重试：UNIQUE 冲突时回退、让 next attempt 再次读取 MAX；这是惯用的 single-writer-per-trace 模式。
  3. 退路方案：若不愿引入 unique，把 `event_seq` 改成 `(trace_uuid, monotonic_clock_ns)` 双键序号，但本文不推荐，因为会绕开 Q5 的字面口径。

### R3. `nano_conversation_turns.turn_index 使用同样的 MAX+1 模式，followup 并发可冲突`

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/session-truth.ts:206-250:createTurn`：`SELECT COALESCE(MAX(turn_index),0)+1 FROM nano_conversation_turns WHERE session_uuid=?` 然后 `INSERT`。
  - 002.sql 没有 `UNIQUE(session_uuid, turn_index)`（N2）；smind-06 line 410 是有的。
- **为什么重要**：
  - turn_index 是 conversation 时间轴的最低位标尺，重复或丢号会让 history 排序逻辑失稳。
  - 与 R2 同因——只是这里是 turn 级而非事件级。
- **审查判断**：
  - 同 R2，schema + 写入路径合谋形成"看起来像递增、但实际不可证明递增"。
- **建议修法**：
  - 加 `UNIQUE(session_uuid, turn_index)` + 单语句 INSERT-FROM-SELECT；或者改用 `crypto.randomUUID()` + 时间戳作为 turn 排序的 fallback，把 turn_index 仅作为"已知排序的 seq"展示字段。

### R4. `agent-core 与 orchestrator-core 的 compatibility_date 不一致，Z1 R9 在 Z2 重新出现`

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `workers/orchestrator-core/wrangler.jsonc:5` = `"2026-04-25"`
  - `workers/agent-core/wrangler.jsonc:5` = `"2026-04-23"`（N4）
  - Z1 R9 已要求统一 compatibility_date，Z1 closure 也认为已收口；Z2 没回头复核，agent-core 的日期没跟上。
- **为什么重要**：
  - compatibility_date 漂移会让两个 worker 看到不同的 Cloudflare runtime 行为（最近一次 compat changes 影响的就是 streams / runtime-API），是隐性 cross-worker 行为不一致来源。
  - Z2 在 cross-worker RPC parity 上做证明，compat 漂移会让 parity 测试失去说服力。
- **审查判断**：
  - 不是 blocker，但应在 Z2 closure 之前就同步——这是 housekeeping 漏掉。
- **建议修法**：
  - 把 agent-core 的 `compatibility_date` 改为 `"2026-04-25"`，同时把 ZX-binding-boundary doc 里的 cross-worker compat 约束写成"必须同步"。

### R5. `DO Alarm 不做 Q6 line 206 的 secret cache refresh / reconnect cursor 过期`

- **严重级别**：`high`
- **类型**：`scope-drift | delivery-gap`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:347-351:alarm` 只 await `trimHotState() + cleanupEndedSessions() + ensureHotStateAlarm()`。
  - `trimHotState`（645-659）只 trim conversation_index 长度、删除 ended_at>24h 的 session 对应缓存键（N5）。
  - Q6 line 206-207 冻结 Alarm 必须做"trim recent_frames > 50/session、expire reconnect cursors > 1 h、refresh / evict secret cache（包括 JWT key cache）"——前两件部分缺失，第三件完全缺失。
  - user-do 中根本没有 secret cache / JWT key cache 数据结构，所以"refresh"无对象。
- **为什么重要**：
  - Alarm 是 stateful uplift 的"心跳"——Q6 line 207 原话；"声称用了，没真用"恰好就是 Q6 想避免的反模式。
  - reconnect cursor 状态目前藏在 `wsHelper` 内部，Alarm 不触达——长时间 detached 的 session 的 cursor 不会过期，反而需要靠 ENDED_TTL_MS=24h 的间接清理。
- **审查判断**：
  - 当前 Alarm 是"最低必要"，但不是"Q6 字面口径"。
  - 这点 Z2 closure §3 没诚实承认；建议进入 Z3 follow-up 而非伪装成 ✅。
- **建议修法**：
  1. 把 reconnect cursor / wsHelper 的 GC 入口暴露为 user-do 可触达的 method；Alarm 调用之以执行 1h 过期。
  2. JWT key cache：要么显式写一个 cache 槽（即使第一版只缓存 last verify 时间），要么把 Q6 字面要求改成"Z3 起补"并在 closure 里诚实记录。

### R6. `Z1 carry-over C-1（deploy-fill 在 runtime 退役）没有在 Z2 收口`

- **严重级别**：`high`
- **类型**：`scope-drift | docs-gap`
- **事实依据**：
  - `workers/agent-core/src/host/internal-policy.ts:50-56` 与 `normalizeAuthority` 显式接受 `tenant_source: "deploy-fill"`。
  - `workers/orchestrator-core/src/user-do.ts:170-176:isAuthSnapshot` 同样接受 `"deploy-fill"`。
  - test/user-do.test.ts 多条 fixture 直接 `tenant_source: 'deploy-fill'`（如 line 124 / 154 / 289 / 310 / 346 / 498），表明运行期主路径仍以 deploy-fill 为常态。
  - Z1 closure §4.2 / §4.3 / §4.6 与 ZX-qna Q3 / Q22 的语境一致：deploy-fill 是 ingress legacy bridge，Z2 closure 之前应让 runtime 不再依赖。
- **为什么重要**：
  - Z1 closure 把"runtime tenant full-consumption"作为 Z2 必须解决的 carry-over。Z2 实际上做的是 session-owned `team_uuid` 持久化（F5），但**保留了 deploy-fill 这个 tenant_source 值的合法性**——在多租户场景下，deploy-fill 等于"任何 token 进来都被 stamp 成 env.TEAM_UUID"，这是单租户 deploy 的特化逻辑，违反 Z1 已建立的"真实身份基底"。
  - Z2 closure §2.6 措辞模糊，没承认这点。
- **审查判断**：
  - 这是 Z1→Z2 的 carry-over 没有"机械关闭"。Z2 closure 不应被读为"deploy-fill 已退役"——事实上还没有。
  - Z3 启动前必须在 doc + 代码两侧明确：`tenant_source` 在 internal RPC 路径上仅接受 `"claim"`；ingress JWT-fallback 退路只在 orchestrator-core 的 ingress 层保留并日志告警。
- **建议修法**：
  1. `internal-policy.ts:normalizeAuthority` 收紧为 `tenant_source !== 'claim'` 直接拒绝。
  2. `user-do.ts:isAuthSnapshot` 收紧为只接受 `"claim"`。
  3. ingress 层（`auth.ts`）保留 deploy-fill fallback，但在写入 `nano_session_activity_logs` 时显式 emit 一条 `event_kind='auth.deploy-fill.fallback'` warn，让 audit 有可观察的 deploy-fill trail。

### R7. `nano_conversation_messages 缺 sequence_no，readHistory 排序不可证明`

- **严重级别**：`high`
- **类型**：`correctness | scope-drift`
- **事实依据**：
  - 002.sql 的 `nano_conversation_messages` 列：`message_uuid, conversation_uuid, session_uuid, turn_uuid, team_uuid, trace_uuid, message_role, message_kind, body_json, created_at, event_seq`——**没有 `sequence_no`**。
  - smind-06 `smind_conversation_messages.sequence_no INTEGER NOT NULL CHECK(sequence_no > 0)` + `UNIQUE(conversation_uuid, sequence_no)` 是设计真相。
  - `session-truth.ts:appendMessage` 中 `event_seq` 对 `user.input` / `user.cancel` 写 NULL；`readHistory` 的 ORDER BY 是 `(created_at ASC, COALESCE(event_seq,0) ASC)`，N6 已示证两条 read 路径方向相反。
- **为什么重要**：
  - "session 结束后仍能读 history"是 F1 一句话收口目标。当 history 排序在并发或 NULL event_seq 情况下不稳定时，前端 timeline 会闪回。
  - Z2 closure §6.2 说"客户端 replay/heartbeat 已经有 durable truth + hot-state baseline"——一旦 history 排序不稳定，replay 的字面信任就被打破。
- **审查判断**：
  - schema 缺一列在 first wave 是"砍范围"，但本案 sequence_no 是 reading order 的最低 invariant，不应该被砍。
- **建议修法**：
  - 003 增量加 `sequence_no INTEGER NOT NULL CHECK(sequence_no > 0)` + `UNIQUE(conversation_uuid, sequence_no)` + 写入路径改成"per-conversation MAX+1"（同样配合 R2 修法）。

### R8. `recordStreamFrames 对每帧 stream 单写入 D1，缺批量写入`

- **严重级别**：`medium`
- **类型**：`correctness | delivery-gap`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:532-594:recordStreamFrames`：循环 frames，每帧 `await repo.appendStreamEvent` + `await repo.appendActivity`。
  - `appendStreamEvent` 内调用 `appendMessage`（INSERT）。`appendActivity` 内做 `SELECT MAX + INSERT`。
  - 单帧成本 ≈ 3 D1 round-trip；单条 50 帧的 stream ≈ 150 round-trip（N12）。
- **为什么重要**：
  - D1 是 over-the-network 的 SQLite，每次 round-trip 都是几十 ms 量级。Z2 的 `start` parity 测试目前只有几帧 fixture（test/user-do.test.ts 用 2-3 帧），这条 perf 漏斗在 live e2e 真实流量下才会暴露。
  - 这间接放大 R2 的并发风险——当 50 帧顺序入库时，每帧 select MAX 会读到上一条的写入，但若任意 retry 触发并发写入 fallback path，event_seq 重复风险叠加。
- **审查判断**：
  - 不是 blocker，但 Z2 closure §3 把"36/36 / 12/12 全绿"读作 perf 已稳是过早乐观。
- **建议修法**：
  - 改用 `db.batch([...])` 把单一 stream 的 N×appendStreamEvent + N×appendActivity 包成一次 batch，并配合 R2 的 single-statement insert-from-select。

### R9. `nano_conversation_messages.body_json 不做 redaction，stream 帧的敏感字段会进 history`

- **严重级别**：`medium`
- **类型**：`security | scope-drift`
- **事实依据**：
  - `session-truth.ts:appendStreamEvent`：`body: input.payload`（直接写 stream frame 原 payload）。
  - 仅 `recordStreamFrames` 中做 `redactActivityPayload(frame.payload)` 给 `appendActivity`；但写到 `nano_conversation_messages` 的 body_json 是 raw payload。
  - Q5 line 169：activity log "不允许任何 worker 直接 INSERT 不经过 redaction wrapper"——messages 不在 Q5 字面范围内，但 Z2 design F2 line 271 用同样口径要求"activity payload 中不存在未经 redaction 的 token / secret / raw authority 泄漏"，未明确约束 messages。
  - 但 stream 的 frame.payload 在 LLM/工具调用阶段经常嵌入 user 输入、context 引用、可能的 token 调试信息——如果不做 redaction，`history` 路径就会把它原样吐回。
- **为什么重要**：
  - "history 可读"≠"history 内容可发给客户端"。Z4 客户端真实链路启动后，`/sessions/<id>/history` 就成了对外暴露面。
  - 即使第一版 frame.payload 看起来无敏感，不做 redaction 是把 audit/data-protection 的纪律从 schema 入口剥离。
- **审查判断**：
  - Z2 设计文档对 message body redaction 没有显式冻结，所以严格说不算违反字面口径，但是 Z3+客户端阶段会被反咬。
- **建议修法**：
  - 在 `appendStreamEvent` / `recordUserMessage` 入口走同一套 redactor（key 集合可分级：activity 为强 redact、messages 为 light redact，仅去掉 token/password/openid 等高危字段）。

### R10. `readSnapshot 用 sub-COUNT(*) 计算 message_count / activity_count`

- **严重级别**：`medium`
- **类型**：`correctness | delivery-gap`
- **事实依据**：
  - `session-truth.ts:461-497:readSnapshot`：`(SELECT COUNT(*) FROM nano_conversation_messages m WHERE m.session_uuid = s.session_uuid)` + 对 `nano_session_activity_logs` 同样的子查询。
  - `nano_conversation_messages` 现有索引仅 `(session_uuid, created_at, event_seq)`，COUNT 扫描走前缀但仍是 O(N) 行数。
  - status 路径每次都跑（N7）。
- **为什么重要**：
  - status 是热路径——客户端心跳轮询 / 重连后第一调用都是 status。Z2 closure §3.3 显式列 status 为 live evidence。
  - 长会话（千级 messages、万级 activity logs）下 status 的 P99 会被 COUNT 击穿。
- **审查判断**：
  - 属于"先 fix design issue 再 fix 性能"——但 schema 不该一开始就埋这个雷。
- **建议修法**：
  - 改在 `nano_conversation_sessions` 加聚合列 `message_count / activity_count`（写入时增量更新），或者用 `nano_conversations.message_count_total` 字段（参考 smind-06 line 146）。

### R11. `Q6 重建 invariant 测试缺位，no test for "清空 DO storage 后 reconnect 仍能从 D1 恢复 last 50 frames"`

- **严重级别**：`medium`
- **类型**：`test-gap | scope-drift`
- **事实依据**：
  - `workers/orchestrator-core/test/user-do.test.ts` 11 条测试均使用 `Map`-based fake storage，不模拟"清空后重连"。
  - 没有任何 fixture 串联 `D1SessionTruthRepository.readHistory` 与 hot-state 重建。
  - Q6 line 208 字面要求："Z2 closure 必须包含一条测试，'清空 DO storage 后 reconnect 仍能从 D1 恢复 last 50 frames'。如果通不过，hot-state 设计就是错的。"
- **为什么重要**：
  - Q6 把这条测试明确提升到"closure 必含"的级别。Z2 closure 没有它，等于把 Q6 line 208 的字面口径降级。
  - 没有重建测试，hot-state 是否真的"可从 D1 重建"只是声明，不是事实。
- **审查判断**：
  - 这是 Z2 closure 对 Q6 字面口径的不完整对齐。可纳入 Z3 P1 必补。
- **建议修法**：
  - 加 `04-reconnect-rebuild.test.mjs`（cross-e2e 或新 package-e2e）：start → push 60+ frames → 显式清空 DO storage → reconnect → 验证 last 50 frames 来自 D1 readHistory。

### R12. `forwardStart 用 JSON.stringify 等价比较做 parity 判定`

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:683-688`：`JSON.stringify(rpcResult.body ?? null) === JSON.stringify(fetchResult.body ?? null)`。
  - Q7 给的 parity 形式是 "(a) 返回 envelope deep-equal；(b) D1 row diff = ∅；(c) NACP authority/trace stamp 一致"——即结构化 deep-equal，不是字符串字面等价。
- **为什么重要**：
  - JSON.stringify 在 V8 上虽然按插入顺序输出键，但任意一侧 path 增减字段或顺序差异都会让 parity 误判失败。
  - parity 失败 → 502 → 用户看到 `agent-rpc-parity-failed`。这把 RPC kickoff 的 robustness 推到客户端。
- **审查判断**：
  - 这条不是 correctness blocker（生产 path 主路径没并发分歧），但是 Q7 字面口径下的实现降级。
- **建议修法**：
  - 引入 deep-equal helper（递归键对齐）；同时把 parity 失败分级为"warn + emit activity log"，而不是直接 502。第一版 RPC kickoff 应该是 silent fallback 到 fetch 结果，而不是阻断。

### R13. `pnpm test:contracts 仍因 docs/nacp-session-registry.md 缺失而红，Z2 没拉回保护范围`

- **严重级别**：`medium`
- **类型**：`test-gap | docs-gap`
- **事实依据**：
  - Z2 closure §5.3 自陈"contracts 红、与 Z2 改动无关"。
  - Z2 验证清单 §3.1 没跑 `test:contracts`——意味着 contract docs-sync 守门完全脱出 Z2 回归范围（N10）。
- **为什么重要**：
  - 红测试存在于 root，意味着 root 级 CI 不绿；后续 Z3 PR 想用 root green 作为 baseline 是不可能的。
  - "与 Z2 无关"是事实，但 Z2 是把仓库推进到下一阶段的最后一个 owner；不让红测试在 Z2 关闭前要么修要么显式 skip，是 zero-to-real 流程纪律的破例。
- **审查判断**：
  - Z2 closure 应在 §5 列入"必须在 Z3 P0 修"，而不仅说"与本轮无关"。
- **建议修法**：
  - 要么补 `docs/nacp-session-registry.md` 让 `test-legacy/session-registry-doc-sync.test.mjs` 重新绿；要么在 root 把这条 legacy 测试 skip 并在 Z2 closure 显式记录。

### R14. `schema 命名漂移：nano_conversation_turns 用 turn_kind 而 design 写 role`

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - 002.sql `nano_conversation_turns`: `turn_kind TEXT NOT NULL CHECK(turn_kind IN ('start','followup','cancel'))`。
  - ZX-qna §3.5 line 336 要求字段集 `{turn_uuid, session_uuid, conversation_uuid, team_uuid, role, status, started_at, ended_at, trace_uuid}`，关键词是 `role`。
  - smind-06 line 372 用 `initiator_kind`（`user|assistant|system|tool|internal`）。
- **为什么重要**：
  - role 在 message 层 = "user/assistant/system"；turn 层 = "initiator"。把 turn 上的字段命名为 `turn_kind`（带 cancel 这种"操作"语义）混合了"谁发起"与"是什么操作"两个语义。
  - 不影响 Z2 收口，但是 cross-doc 一致性的隐性债务。
- **审查判断**：
  - Z3+ 引入 LLM/tool initiator 时，会发现 turn_kind 不够表达 initiator——届时要么再迁移 schema 要么忍。
- **建议修法**：
  - 003 增量补 `initiator_kind TEXT`（nullable，默认 'user'），保留 turn_kind 作为操作元属性。

### R15. `Q5 推荐的 view_recent_audit_per_team 未建`

- **严重级别**：`low`
- **类型**：`scope-drift`
- **事实依据**：
  - Q5 line 170：`first-wave views`：建议先建一条 `view_recent_audit_per_team`（最近 7 天，按 team 分组），其余 query helpers 落 codebase 而非 D1 view。
  - 002.sql 没有任何 `CREATE VIEW`。
- **为什么重要**：
  - 不影响 first-wave runtime，但 owner 巡检时没有 7-day audit view 是 day-1 体验降级。
- **审查判断**：
  - 这是字面口径未做的小项，可挪到 Z3 first wave。
- **建议修法**：
  - 003 增量补 `CREATE VIEW view_recent_audit_per_team AS SELECT ... FROM nano_session_activity_logs WHERE created_at > datetime('now','-7 day')`。

### R16. `agent-core 没有 NANO_AGENT_DB binding，Q5 redaction wrapper 纪律对其无法落地`

- **严重级别**：`low`
- **类型**：`scope-drift`
- **事实依据**：
  - `workers/agent-core/wrangler.jsonc` 无 `d1_databases` 段。
  - closure §5.4 自承"agent-core 仍未直接 bind NANO_AGENT_DB"。
  - Q5 line 169 要求所有 worker INSERT 经 redaction wrapper——意味着只要 agent-core 想写 audit，必须走 RPC 让 orchestrator-core 代写。
- **为什么重要**：
  - Z3 真实 LLM 接入后，runtime 事件、quota deny 都要写 activity logs（Q9 line 295）。当前 agent-core 没有 D1 binding，等于"audit 必须经过 orchestrator-core 跳一手"。
  - 这是 ownership 边界问题，Z2 自己说不属于 Z2 范围，但 Z3 必然首遇——closure 应把它列为 Z3 已知 blocker，不是 residual。
- **审查判断**：
  - 不阻塞 Z2，但 closure 文档对 Z3 启动前的依赖描述偏轻。
- **建议修法**：
  - Z3 P0 增加一条 design 决策：是 agent-core 直 bind D1（破 redaction 纪律）还是引入 `orchestrator-core.appendActivity` 内部 RPC（第二条 dual-impl）。

### R17. `forwardStatus 没有 fetch/RPC 比较，仅做 RPC 优先`

- **严重级别**：`low`
- **类型**：`test-gap`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:707-722:forwardStatus`：有 RPC binding + auth → 直接 RPC；否则 fall back fetch。**不做 parity 比较**。
  - Q7 line 233：`status` smoke 仅需"返回值 deep-equal"。
- **为什么重要**：
  - "status 是 RPC scaffold smoke" 字面已满足；但 Q7 给的是"返回值 deep-equal"形式，意味着至少应该有一条 unit/package-e2e 跑两次（一次 RPC、一次 fetch）证明返回相等。当前测试只测一条 path（RPC 或 fetch 二选一）。
- **审查判断**：
  - 形式问题，不阻塞 Z2 字面收口，但 smoke proof 比 Q7 字面口径偏弱。
- **建议修法**：
  - 加 `workers/orchestrator-core/test/parity.test.ts` 跑 status 的 fetch + RPC 等价比较。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | conversation/session/turn/message D1 真相 | `partial` | 表结构存在；但 FK / UNIQUE / sequence_no 缺位（R1 / R3 / R7） |
| S2 | context/audit truth 落 D1 | `partial` | activity 12 列 + 3 index 满足 Q5 字面（F2），但 event_seq 并发漂移（R2）+ 无 redaction 强制（R9）让 audit 真相弱于声明 |
| S3 | DO hot-state 4 组最小集合 + 10m alarm | `partial` | 4 组 + 容量 + 10m alarm 全部满足（F3）；但 Alarm 内只做 trim+cleanup，缺 secret cache refresh / reconnect cursor 1h 过期（R5） |
| S4 | heartbeat / replay / reconnect first-wave truth | `partial` | wsHelper 与 SESSION_TEAM 持久化覆盖核心 invariant（F5），但 Q6 line 208 的"清空 DO storage 后从 D1 重建 last 50 frames"测试缺位（R11） |
| S5 | internal `status` RPC smoke + `start` kickoff parity | `partial` | RPC 路径已落（F4）；但 parity 用 stringify 等价（R12），forwardStatus 无 parity 测试（R17） |
| S6 | append-only activity log + redaction discipline | `partial` | activity 路径有 redaction（F10），但 messages.body_json 不过滤（R9）；append-only 没有 schema 级 INSERT-only 约束（DROP/UPDATE 在 schema 上仍合法） |
| S7 | preview infra + live e2e | `done` | closure §3.1-3.3 给出真实 wrangler 命令 + 36/36 / 12/12 全绿 evidence（F12） |
| S8 | Z1 carry-over：deploy-fill 在 runtime 退役 | `missing` | 仅做 session-owned team_uuid，deploy-fill tenant_source 仍是 first-class enum（R6） |
| S9 | Z1 carry-over：TEAM_UUID UUID-shaped | `done` | wrangler.jsonc 已统一为 UUID placeholder（F7） |
| S10 | Z1 carry-over：auth.ts tenant_source source-check | `done` | F8 |
| S11 | Z1 carry-over：R8 残痕（query token 只允 ws） | `done` | F9 |
| S12 | Z1 carry-over：WeChat retry 收紧到网络/超时/5xx | `done` | F6 |

### 3.1 对齐结论

- **done**: 5（S7 / S9 / S10 / S11 / S12）
- **partial**: 6（S1 / S2 / S3 / S4 / S5 / S6）
- **missing**: 1（S8）

> 这更像"骨架与 wiring 都建出来了，但每一根 invariant 的螺栓都拧到一半"，而不是 completed。Z2 closure 字面声明 ✅ 的 7 项中有 4 项实质上只到 partial 程度。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | real Workers AI provider 与 quota gate | `遵守` | 本轮没有引入 `workers/agent-core/src/llm/*` 真实 provider 代码 |
| O2 | 完整 client UI 与真机链路 | `遵守` | 客户端代码无变化 |
| O3 | 丰富的 admin analytics / BI query layer | `遵守` | 只新增 first-wave readback；没有 view 物化或 BI 索引 |
| O4 | HTTP public surface 全面退役 | `遵守` | `/sessions/*` HTTP route 仍在；`/auth/*` 仍走 fetch + RPC façade |
| O5 | full collaboration richness（参与者、外部 join） | `遵守` | 002.sql 没有 participants 表 |
| O6 | cold archive / R2 offload | `遵守` | 无 R2 binding |

---

## 5. 跨阶段 / 跨包深度判断

> 这一节是 owner 显式要求"扩大审查面，对整个 zero-to-real 阶段进行回顾"。我把它压在 §5 里，而不是单独 §6/§7，是因为这些发现都直接影响 Z2 是否能真的关闭。

### 5.1 Z0 / Z1 文档与 Z2 实现的一致性

- **D1 schema 真相**：ZX-qna Q5 是 Z2 schema 的字面冻结答案。Z2 002.sql 在列名与 12-列字段集层面字面满足；但在 UNIQUE / FK / view 上选择性遗漏，事实上 Q5 文末三条强制要求中实现了 1.5 条（payload redaction 是 0.5——activity 强、messages 弱）。
- **Q6 hot-state**：Z2 实现里 `conversation_index / active_pointers / recent_frames / cache` 的命名与 ZX-qna §1.21 顶部摘要（用 `active_session_index / ws_attachment_state / recent_replay_window / pending_input_queue`）有差异，**这是 ZX-qna 文档自己内部不一致**——Q6 详情答案（line 196-211）与 Z2 实现一致，但顶部 §1.21 摘要在 Z0 阶段就漂掉了。属于 Z0 文档级 docs-gap，不是 Z2 引入。建议在 Z3 启动前把 ZX-qna 顶部摘要改回 Q6 详情口径。
- **Q7 parity**：Q7 line 234 把 parity 形式定义为 (a) envelope deep-equal、(b) D1 row diff = ∅、(c) authority/trace stamp 一致。Z2 实现里只跑 (a)（且用 stringify），(b) D1 row diff 没有任何自动 fixture 测试（unit test 完全不接 D1），(c) 在 internal-policy.ts 里靠 `authorityEquals` 比较——但 forwardStart 仅在父 worker 端比 stringify。等于 Q7 三个子条件只满足 1 个。

### 5.2 跨 worker 行为一致性

- **compatibility_date 漂移**：R4。
- **NANO_INTERNAL_BINDING_SECRET 共享**：orchestrator-core 与 agent-core 都依赖该 secret，但 wrangler.jsonc 都没列出；运行期靠 `wrangler secret put` 同步。这是 Z2 引入的隐性 deploy 依赖，应在 closure 写明。
- **agent-core 不持有 D1**：R16。这意味着 audit 的 ownership 全压在 orchestrator-core 一侧，agent-core 永远是"事件源"，不能成为事件 owner——Z3 真实 runtime 接入时这条 boundary 会被反复挑战（quota deny / LLM invoke / capability error 都需要 audit）。
- **orchestrator-auth 与 Z2 无直接交互**：本轮只调整了 wechat retry，符合 Z2 范围。

### 5.3 命名与术语漂移

- `nano_conversation_turns.turn_kind` vs design `role` vs smind-06 `initiator_kind`（R14）。
- `IngressAuthSnapshot` 仍然是 `claim | deploy-fill` enum，与 contract 包 `AuthSnapshot` 严格 `claim` 并存——Z1 closure 已声明这是过渡，但 Z2 没引入"以 contract AuthSnapshot 替换 IngressAuthSnapshot"的 step（R6 关联）。
- `recent-frames/<session>` 在代码里用 `/` 作分隔符，但 Q6 顶部摘要写的是 `recent_replay_window`——Z3 起再有命名争议时建议以 ZX-d1 schema 为准。

### 5.4 数据完整性纪律的系统性缺失

把 R1 / R2 / R3 / R7 放在一起看，会得到一个共同模式：**Z2 schema 把所有"完整性纪律"都默认推给 worker 运行期 best-effort，而 worker 运行期又用了非原子的 select+insert 模式。**

这个模式不是 GPT 一时疏忽，而是一个隐性的设计取向——把 D1 当成"事件追加桶"，而不是"约束化真相层"。但 Q5 / Q6 / Charter 的字面口径都假设 D1 是约束化真相层（"可审计、可回看、可追责"）。这个隐性取向必须在 Z3 启动前显式化讨论：要么收紧 schema 约束、要么修改字面冻结口径。否则 Z3 接入真实 quota / runtime 后，audit 的可信度会被快速侵蚀。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：`approve-with-followups（Grade: B）`
- **是否允许关闭本轮 review**：`yes — Z2 主体 closed，但带 5 条必须在 Z3 Phase 1 之前完成的 carry-over`

- **关闭前必须完成的 blocker**（如果不修，不应进入 Z3）：
  无。Z2 主体可作为 Z3 的输入 baseline 关闭。

- **必须在 Z3 Phase 1 第一道工作中完成的 carry-over**：
  1. **R2 / R3**：补 `UNIQUE(trace_uuid, event_seq)` 与 `UNIQUE(session_uuid, turn_index)`，把 `appendActivity` / `createTurn` 改为 atomic INSERT-FROM-SELECT 或 D1 batch+unique 兜底——这是 Q5 字面冻结口径，必须做。
  2. **R1**：补 002.sql 的 FK（至少 session_uuid / conversation_uuid 两条主线），让 schema 真正满足 P1-01 收口标准。
  3. **R6**：明确 deploy-fill 在 internal RPC 路径的退役：internal-policy.ts 与 user-do.ts 的 isAuthSnapshot 都收紧为 `tenant_source === 'claim'`；ingress 层保留并加 audit warn。
  4. **R11**：写"清空 DO storage 后 reconnect 从 D1 恢复 last 50 frames"测试，落地 Q6 line 208 字面要求。
  5. **R7**：决策 `nano_conversation_messages.sequence_no` 是否补；不补就显式记录 history 顺序在并发下不可证明。

- **可以后续跟进的 non-blocking follow-up**：
  1. R4：统一 compatibility_date（housekeeping）。
  2. R5：DO Alarm 补 reconnect cursor 过期 + secret cache refresh hook（Q6 字面收口）。
  3. R8：stream 帧批量写入 D1（perf）。
  4. R9：messages.body_json 走 light redaction（Z4 客户端启动前）。
  5. R10：readSnapshot 用 maintained counter 替代 sub-COUNT（perf）。
  6. R12：parity 用结构 deep-equal 而非 stringify。
  7. R13：root `pnpm test:contracts` 红测试要么修要么 explicit skip。
  8. R14 / R15 / R16 / R17：术语对齐 / view 补建 / agent-core D1 ownership 决策 / forwardStatus parity 测试，可在 Z3 内部消化。

> 总评：**Z2 不是文档夸大，但每一条 invariant 都比字面口径低半档。** GPT 在 Z2 阶段把"骨架 + wiring + preview deploy + live e2e + closure 文档"全部交付齐了，工作量真实存在；但 Q5 / Q6 / Q7 的字面冻结口径上，schema 完整性、Alarm 三件事、parity 三子条件、Z1 carry-over deploy-fill 退役都只完成了主线，把"半步之差"留给 Z3。如果 Z3 接入真实 runtime / quota 时再发生类似的"半步之差"，audit 真相就会出现实质漂移——所以本轮把上述 5 条 carry-over 拉到 Z3 P1 first thing 来做，是 zero-to-real 后续阶段不至于在 audit 真相上失声的最低纪律。

---

## 7. 实现者回应

### 7.1 对本轮审查的回应

> 执行者: `GPT-5.4`
> 执行时间: `2026-04-25`
> 回应范围: `Opus R1-R17 + DeepSeek/Kimi 独有项`

- **总体回应**：`本轮已把能在 Z2 边界内安全落地的 schema / repository / parity / rollback / restore / docs-truth / legacy-contract gaps 全部补齐；剩余未改项已显式降为 deferred/partial，并回写 closure。`
- **本轮修改策略**：`先修 D1 durability correctness（FK/UNIQUE/nullable/8KB cap/last_event_seq/retry），再补 user-do 的 rollback、read-hydration、alarm trim、status parity 与测试，最后修正文档 truth，并把 root test:contracts 拉回绿色。`

### 7.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | D1 schema 无 FK / UNIQUE | fixed | 新增 `003-session-truth-hardening.sql`，为 Wave B 表补 FK、`UNIQUE(session_uuid, turn_index)`、`UNIQUE(trace_uuid, event_seq)`、补充索引与本地 migration smoke。 | `workers/orchestrator-core/migrations/003-session-truth-hardening.sql` |
| R2 | activity `event_seq` 并发安全不足 | fixed | `appendActivity()` 改为单语句 `INSERT ... SELECT COALESCE(MAX(...),0)+1`，再配合 unique 冲突重试。 | `workers/orchestrator-core/src/session-truth.ts` |
| R3 | `turn_index` 仍是 `MAX+1` 裸写 | fixed | `createTurn()` 同样改为单语句分配 + unique 冲突重试；schema 同步加唯一约束。 | `workers/orchestrator-core/src/session-truth.ts`, `workers/orchestrator-core/migrations/003-session-truth-hardening.sql` |
| R4 | worker `compatibility_date` 漂移 | fixed | `agent-core` 对齐到 `2026-04-25`。 | `workers/agent-core/wrangler.jsonc` |
| R5 | Alarm 未完整覆盖 Q6 三项 GC | partially-fixed | 已补 active `recent-frames` trim 与过期 `status:* / verify:*` cache eviction；但 `reconnect cursor` / JWT key cache 当前没有稳定数据结构，继续诚实保留为 residual。 | `workers/orchestrator-core/src/user-do.ts`, `docs/issue/zero-to-real/Z2-closure.md` |
| R6 | `deploy-fill` runtime 退役未收口 | deferred | 本轮未强拆 compatibility path，避免直接破坏现有 single-tenant fallback；改为在 closure 中显式记录仍然存在，后续阶段再做硬收口。 | `docs/issue/zero-to-real/Z2-closure.md` |
| R7 | messages 缺 `sequence_no`，history 排序不可证明 | partially-fixed | 本轮未引入新列；先把 history 排序补到 `created_at / event_seq / message_uuid` 稳定 tie-break，避免同毫秒不稳定。proof-grade `sequence_no` 继续 deferred。 | `workers/orchestrator-core/src/session-truth.ts`, `docs/issue/zero-to-real/Z2-closure.md` |
| R8 | stream 帧逐条写 D1，缺批处理 | partially-fixed | 先把单帧写入改成 message insert + `last_event_seq` update 同批执行，并把 activity 写入改成 unique-safe；尚未把整批 frames 合成单次 batch。 | `workers/orchestrator-core/src/session-truth.ts` |
| R9 | `body_json` 未做 redaction | fixed | message 写入与 activity 写入均走 redaction/size discipline；同时补了 redaction regression test。 | `workers/orchestrator-core/src/session-truth.ts`, `workers/orchestrator-core/test/user-do.test.ts` |
| R10 | `readSnapshot` 仍用 sub-COUNT(*) | deferred | 该项属于 status/perf follow-up，本轮未改聚合策略；已在 closure 中保留为残留项，不再假装完成。 | `docs/issue/zero-to-real/Z2-closure.md` |
| R11 | 缺 "清空 DO storage 后从 D1 重建" 证明 | partially-fixed | 已新增从 durable truth 重建 readable session 的代码与回归测试；但还没做到 review 要求的 full reconnect/50-frame e2e。 | `workers/orchestrator-core/src/user-do.ts`, `workers/orchestrator-core/test/user-do.test.ts`, `docs/issue/zero-to-real/Z2-closure.md` |
| R12 | `forwardStart` parity 用 `JSON.stringify` | fixed | 改成递归语义比较 `jsonDeepEqual()`。 | `workers/orchestrator-core/src/user-do.ts`, `workers/orchestrator-core/test/user-do.test.ts` |
| R13 | `test:contracts` 不在保护范围 | fixed | 新增 `docs/nacp-session-registry.md`，并把一条 Node 下错误引用 worker entry 的 legacy 测试切到 node-safe package export，使 root contracts 重新全绿。 | `docs/nacp-session-registry.md`, `test-legacy/initial-context-live-consumer.test.mjs` |
| R14 | schema / design 命名漂移 | fixed | 回修 ZX-D1、Z2 action-plan、Z2 closure，使 write ownership 与实际落地字段口径一致。 | `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`, `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`, `docs/issue/zero-to-real/Z2-closure.md` |
| R15 | 缺 `view_recent_audit_per_team` | fixed | 在 003 migration 中补 `CREATE VIEW view_recent_audit_per_team`。 | `workers/orchestrator-core/migrations/003-session-truth-hardening.sql` |
| R16 | `agent-core` 仍无 D1 binding | deferred | 未在本轮强行扩写 ownership boundary；closure 已明确它仍是 Z3 前置设计问题。 | `docs/issue/zero-to-real/Z2-closure.md` |
| R17 | `forwardStatus` 无 parity | fixed | `status` 也改为 RPC + fetch 双跑语义比较，并补测试。 | `workers/orchestrator-core/src/user-do.ts`, `workers/orchestrator-core/test/user-do.test.ts` |
| D1 | ZX-D1 write ownership matrix 与实现相矛盾 | fixed | 接受当前已落地的 `orchestrator-core` 单写入面，并把 ZX-D1 / action-plan / closure 一并回写，不再保留双真相口径。 | `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`, `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`, `docs/issue/zero-to-real/Z2-closure.md` |
| D2 | activity log nullable / 8KB 与 Q5 不一致 | fixed | 003 migration 将 `actor_user_uuid / conversation_uuid / session_uuid` 放宽为 nullable；TS 签名同步放宽，并加 8KB CHECK + code-side serialization guard。 | `workers/orchestrator-core/migrations/003-session-truth-hardening.sql`, `workers/orchestrator-core/src/session-truth.ts`, `workers/orchestrator-core/src/user-do.ts` |
| D3 | RPC 仍是 fetch-backed shim | partially-fixed | `start/status` 不再重新进入 `routeInternal()`，而是直接打到 Session DO fetch；但仍未升级成 DO RPC / `DoRpcTransport`，故作为 residual 保留。 | `workers/agent-core/src/index.ts`, `docs/issue/zero-to-real/Z2-closure.md` |
| D5 | activity payload 缺 8KB 上限 | fixed | code-side `serializeActivityPayload()` + DDL CHECK 双保险。 | `workers/orchestrator-core/src/session-truth.ts`, `workers/orchestrator-core/migrations/003-session-truth-hardening.sql` |
| D6 | 缺 D1 重建 invariant 测试 | partially-fixed | 已补 hot-state 丢失后从 durable truth 恢复 readable state 的 test；full reconnect invariant 仍待补。 | `workers/orchestrator-core/test/user-do.test.ts`, `docs/issue/zero-to-real/Z2-closure.md` |
| D7 | Wave B 缺外键 | fixed | 003 migration 为 sessions / turns / messages / snapshots / activity 补 FK。 | `workers/orchestrator-core/migrations/003-session-truth-hardening.sql` |
| D8 | `forwardStatus` 缺 parity | fixed | 与 Opus R17 同修。 | `workers/orchestrator-core/src/user-do.ts`, `workers/orchestrator-core/test/user-do.test.ts` |
| D9 | `last_event_seq` 从未更新 | fixed | `appendStreamEvent()` 同批更新 `nano_conversation_sessions.last_event_seq`。 | `workers/orchestrator-core/src/session-truth.ts`, `workers/orchestrator-core/test/user-do.test.ts` |
| D10 | turns 缺 `team_uuid` 索引 | fixed | 003 migration 新增 `idx_nano_conversation_turns_team_created_at`。 | `workers/orchestrator-core/migrations/003-session-truth-hardening.sql` |
| D11 | messages 缺 `turn_uuid` 索引 | fixed | 003 migration 新增 `idx_nano_conversation_messages_turn_created_at`。 | `workers/orchestrator-core/migrations/003-session-truth-hardening.sql` |
| D12 | ZX-D1 与 Z2 action-plan 方向矛盾未闭合 | fixed | 与 D1 同修，统一到实际 landed 方向。 | `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`, `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`, `docs/issue/zero-to-real/Z2-closure.md` |
| D13 | agent-core checkpoint 与 orchestrator alarm 是两套体系 | rejected | 这两套机制职责不同：前者是 session DO hibernation restore，后者是 orchestrator hot-state GC；本轮不强行耦合，只在 closure 中把边界说实。 | `docs/issue/zero-to-real/Z2-closure.md` |
| D14 | `cache/*` 仅被动 GC | partially-fixed | Alarm 已开始主动驱逐过期 `status:* / verify:*` 缓存；其它未建模 cache family 仍无遍历式 GC。 | `workers/orchestrator-core/src/user-do.ts`, `workers/orchestrator-core/test/user-do.test.ts` |
| K1 | D1 写缺少事务保护 | fixed | 处理了 correctness concern，但**未采纳** `BEGIN TRANSACTION` 方案；本仓库 D1 约定是 `db.batch(...)` + 单语句 + retry。 | `workers/orchestrator-core/src/session-truth.ts`, `workers/orchestrator-core/migrations/003-session-truth-hardening.sql` |
| K5 | start 失败时 D1 清理不完整 | fixed | 新增 `rollbackSessionStart()`，失败路径会回滚 session / conversation scaffolding，并补回归测试。 | `workers/orchestrator-core/src/session-truth.ts`, `workers/orchestrator-core/src/user-do.ts`, `workers/orchestrator-core/test/user-do.test.ts` |
| K7 | `NanoSessionDO` 仍依赖 `env.TEAM_UUID` fallback | deferred | 当前未移除 fallback，避免误伤现有 compatibility/runtime bootstrap；作为已知限制保留。 | `docs/issue/zero-to-real/Z2-closure.md` |
| K8 | checkpoint restore 未恢复 `actorState.phase` | fixed | `restoreFromStorage()` 现在恢复 `actorPhase`，并补 integration test。 | `workers/agent-core/src/host/do/nano-session-do.ts`, `workers/agent-core/test/host/integration/checkpoint-roundtrip.test.ts` |
| K10 | 缺 redaction 验证测试 | fixed | 新增 activity/message redaction regression test。 | `workers/orchestrator-core/test/user-do.test.ts` |
| K11 | closure 的 known limitations 不完整 | fixed | Z2 closure residuals 已按这轮真实边界扩充，不再过满宣称。 | `docs/issue/zero-to-real/Z2-closure.md` |

### 7.3 变更文件清单

- `workers/orchestrator-core/migrations/003-session-truth-hardening.sql`
- `workers/orchestrator-core/src/session-truth.ts`
- `workers/orchestrator-core/src/user-do.ts`
- `workers/orchestrator-core/test/user-do.test.ts`
- `workers/agent-core/src/index.ts`
- `workers/agent-core/src/host/do/nano-session-do.ts`
- `workers/agent-core/test/host/integration/checkpoint-roundtrip.test.ts`
- `workers/agent-core/wrangler.jsonc`
- `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
- `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`
- `docs/issue/zero-to-real/Z2-closure.md`
- `docs/nacp-session-registry.md`
- `test-legacy/initial-context-live-consumer.test.mjs`

### 7.4 验证结果

```text
pnpm --filter @haimang/orchestrator-core-worker typecheck           ✅
pnpm --filter @haimang/orchestrator-core-worker build               ✅
pnpm --filter @haimang/orchestrator-core-worker test                ✅
pnpm --filter @haimang/agent-core-worker typecheck                  ✅
pnpm --filter @haimang/agent-core-worker build                      ✅
pnpm --filter @haimang/agent-core-worker test                       ✅
pnpm --filter @haimang/orchestrator-core-worker deploy:dry-run      ✅
pnpm --filter @haimang/agent-core-worker deploy:dry-run             ✅
pnpm test:contracts                                                 ✅ (107/107)
pnpm test:package-e2e                                               ✅ (non-live mode; 36 skipped as designed)
pnpm test:cross-e2e                                                 ✅ (non-live mode; 12 skipped as designed)
cd workers/orchestrator-core && npx wrangler d1 migrations apply
  NANO_AGENT_DB --local --persist-to /tmp/nano-agent-z2-d1          ✅ (001/002/003 全部成功)
```

### 7.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. `deploy-fill` compatibility path 仍未退役；本轮只把 closure/doc truth 收正，没有硬切 runtime。
  2. `sequence_no`、`readSnapshot` 聚合列、整批 stream frame batch、reconnect-cursor/JWT-cache alarm GC、以及 true DO RPC end-to-end 仍是后续收口项。

---

## 8. 对 Opus 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-25`
> 评价依据: `本文件 §0-§7（含实现者回应）；以及对应代码修复结果`

### 8.1 一句话评价评审风格

Opus 的这份审查是 **高密度、高覆盖面的架构型 review**：既能抓 correctness 主线，也能把 docs/action-plan/QNA/closure 的口径偏差一起拉平，整体 signal-to-noise 最好。

### 8.2 优点
1. 覆盖面最完整：从 schema 并发纪律、deploy-fill carry-over、hot-state invariant、parity、perf，到 contracts/文档 truth，基本没有明显盲区。
2. 证据链很强，而且优先级分层做得好；critical/high/medium/low 大体符合真实修复收益。
3. 多数 finding 都转化成了真实修复或高质量 deferred 决策，说明报告不仅“能找问题”，也真正能推动收口。

### 8.3 缺点
1. 少数 medium/low 项把“未来-proof hardening”与“当前必须修的 defect”放在同一张问题清单里，阅读者需要自己再做优先级二次压缩。
2. R7 / R9 / R10 这类问题的严重度略偏进取，更像提前替 Z3/Z4 抓债，而不是纯粹的 Z2 blocker。
3. 报告信息密度很高，协作者需要投入更多时间来消化“哪些是 now，哪些是 next”。 

### 8.4 对审查报告中，全部问题，的清点

| 问题编号 | 原始严重程度 | 该问题的质量 | 分析与说明 |
|----|------|------|------------------|
| R1 | critical | 高 | FK/UNIQUE 缺位是 Z2 durable truth 的核心断点，判断非常准。 |
| R2 | critical | 高 | `event_seq` 并发安全问题抓得极准，后续被直接修复。 |
| R3 | critical | 高 | `turn_index` 并发安全同样准确，且与 schema 约束一起构成主线问题。 |
| R4 | high | 高 | compatibility_date 漂移是小而真实的问题，级别与作用范围匹配。 |
| R5 | high | 高 | 对 Alarm 三件事缺口的描述很完整，也明确区分了“没建模所以没法真做”的部分。 |
| R6 | high | 高 | deploy-fill carry-over 未机械关闭是关键真实问题，且影响后续多租户可信度。 |
| R7 | high | 中 | `sequence_no` 作为 proof-grade 排序 invariant 很有前瞻性，但并非唯一解，严重度略偏高。 |
| R8 | medium | 中 | stream 批量写入问题真实存在，但属于 perf/follow-up，不是最核心收口项。 |
| R9 | medium | 中 | message body redaction 是很好的前瞻性数据保护提醒，但比当前显式冻结口径更严格。 |
| R10 | medium | 中 | `readSnapshot` sub-COUNT 是真实 perf 债，不过更偏后续优化。 |
| R11 | medium | 高 | rebuild invariant test gap 直接对应 Q6 字面要求，质量很高。 |
| R12 | medium | 高 | parity 用 `JSON.stringify` 的问题判断准确、修法直接。 |
| R13 | medium | 高 | root `test:contracts` 脱离保护范围是非常有价值的流程性发现，且后续已收口。 |
| R14 | low | 中 | 命名/术语漂移成立，但确属低优先级问题。 |
| R15 | low | 中 | view 缺失是真实遗漏，但更偏 completeness than correctness。 |
| R16 | low | 中 | agent-core 无 D1 binding 的 ownership 边界问题有价值，但主要是 Z3 设计债。 |
| R17 | low | 高 | `forwardStatus` parity 缺位是低严重度高准确度的问题，分级克制。 |

### 8.5 评分 - 总体 ** 9.3 / 10 **

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 10 | 文档、设计、closure、DDL、代码、测试、前序 carry-over 全部串起来了。 |
| 判断严谨性 | 9 | 绝大多数判断被后续修复/验证印证，少数只是略偏前瞻。 |
| 修法建议可执行性 | 9 | 多数建议可以直接落到 migration / repository / tests / docs。 |
| 对 action-plan / design 的忠实度 | 9 | 对 Q5/Q6/Q7 与 action-plan 的字面对齐做得非常扎实。 |
| 协作友好度 | 9 | 虽然密度高，但分层清晰、可操作性强。 |
| 找到问题的覆盖面 | 10 | 三位同事里覆盖面最广、漏项最少。 |

---

## 9. 三轮复核 — Opus 二次审查（针对 GPT 修复）

> 审查范围：本文 §7 GPT 逐项回应中的全部 R1-R17 / D1-D14 / K1-K11 修复声明；以及第二次跨阶段对 Z0~Z2 的代码、文档、迁移、测试事实链。
> 审查方法：对每一条修复声明，回到 git working tree 中读取真实文件 — 不接受 `closure / 7.x` 表格的字面声明；同时尝试找到修复路径上可能引入的新问题（W-x）。
> 时间：`2026-04-25`
> 审查人：`Opus 4.7 (1M context)`

### 9.1 一句话二次结论

**Z2 现在可以正式 closed。** 上一轮列为 carry-over 的 5 条（R1 / R2 / R3 / R7 / R11）已经被修复或诚实降为 deferred，并且 GPT 在修复过程中**没有引入新的 critical 缺陷**；`Z3` 在补完两条 deploy-time / preview-environment 同步动作后即可启动，`Z4` 仍然受三条 architectural carry-over 约束，需要在 Z3 中段前回答。

- **整体判断**：`approve`（Z2 closed）+ `Z3 may start with two preflight items` + `Z4 blocked-on-Z3-mid`
- **结论等级**：`approve-with-followups`（升档自上一轮的 `approve-with-followups (B)`，但 Z2 内部已经合规）
- **本轮最关键的 3 个判断**：
  1. **Schema 真相已经合规**：003 migration 把 FK / UNIQUE(`trace_uuid, event_seq`) / UNIQUE(`session_uuid, turn_index`) / 8KB CHECK / `view_recent_audit_per_team` 全部落地；`appendActivity` / `createTurn` 已经改成单语句 INSERT-FROM-SELECT + UNIQUE 冲突重试，Q5 字面冻结的"per-trace 严格递增"现在真的成立。
  2. **新增 W-1 不构成 blocker，但需要写入 Z3 设计议题**：`AgentCoreEntrypoint.invokeInternalRpc` 现在直接 `SESSION_DO.fetch(...)` 而绕开了 `routeInternal()` → `validateInternalAuthority()`。在 Cloudflare service-binding 的封闭模型下功能等价，但 defense-in-depth 的 secret + authority-equality 校验在 RPC 路径上消失；fetch 路径仍保留。Z3 引入第三个 caller（quota authorizer / runtime kernel）前必须把 RPC 路径也走过 `validateInternalAuthority`，否则后续 callers 就拥有"绕开内部纪律"的捷径。
  3. **Preview D1 与 local D1 schema 不同步**：closure §3.2 的迁移命令清单仍只跑过 001/002 remote apply；GPT §7.4 验证清单显示 003 仅在 `--local --persist-to /tmp/...` 应用，**没有 `--env preview --remote`**。如果 Z3 工作直接在现有 preview 环境上启动，会同时遇到"代码假设 UNIQUE 存在"vs"远端 schema 没有 UNIQUE"的真实漂移。这是 Z3 的第一个 preflight。

### 9.2 R/D/K 逐项复核（基于真实代码事实）

| 编号 | GPT 自评 | 复核结论 | 依据（代码事实） |
|---|---|---|---|
| R1 | fixed | **closed** | `003-session-truth-hardening.sql:22-90` 显式 `REFERENCES ... ON DELETE CASCADE/SET NULL` 与 `UNIQUE (session_uuid, turn_index)` / `UNIQUE (trace_uuid, event_seq)` 落地。 |
| R2 | fixed | **closed** | `session-truth.ts:486-547:appendActivity` 已改为 `INSERT ... SELECT COALESCE(MAX(event_seq),0)+1 ... WHERE trace_uuid=?7` 单语句原子化 + UNIQUE retry（`UNIQUE_RETRY_LIMIT=3`）。Q5 "per-trace 严格递增"现在由 schema + atomic stmt 双重保证。 |
| R3 | fixed | **closed** | `session-truth.ts:285-365:createTurn` 同样使用 INSERT-FROM-SELECT + retry；UNIQUE 见 003。 |
| R4 | fixed | **closed** | `workers/agent-core/wrangler.jsonc:5 = "2026-04-25"`，已与 orchestrator-core 同步。 |
| R5 | partially-fixed | **accepted-partial** | `user-do.ts:666-704:trimHotState` 现在遍历 conversation index → 当前 session 集合，主动 trim `recent_frames > 50/session` 与过期 `status:* / verify:*` cache。`reconnect cursor>1h` 与 `JWT key cache refresh` 仍未建模——此为 Z3 follow-up，closure §5.3 已诚实记录。 |
| R6 | deferred | **accepted-deferral** | `internal-policy.ts:13/53` 与 `user-do.ts:175` 仍接受 `tenant_source: "deploy-fill"`；closure §5.4 显式记录。这条与 Z1 carry-over C-1 同源；本轮接受 deferred 的代价是 Z4 真实多客户端启动前必须先收口（详见 §9.4）。 |
| R7 | partially-fixed | **accepted-partial** | `session-truth.ts:616:readHistory` ORDER BY 现在是 `(created_at, event_seq, message_uuid)`——稳定但 message_uuid 是随机 UUID，因此"在 same-created_at + same-event_seq"下排序是 deterministic 但不是真实"插入序"。`sequence_no` 仍未加。Z4 真实客户端读 history 时若需要可证明顺序，必须在 Z3 中段前补。 |
| R8 | partially-fixed | **accepted-partial** | `appendStreamEvent` 现在 `db.batch([insert-message, update-last-event-seq])`，single 帧 round-trip 从 4 降到 2；外层 `recordStreamFrames` 仍是 per-frame loop。50 帧 → 50×2=100 round-trip，未达 single batch。非 blocker。 |
| R9 | fixed | **closed** | `session-truth.ts:98-100:sanitizeMessagePayload` 把 `MESSAGE_REDACTION_FIELDS`（`access_token / refresh_token / authority / auth_snapshot / password / secret / openid / unionid` 八条）应用到 `buildAppendMessageStatement` 入口，**所有 message body_json 现在都过 redaction**；测试 `user-do.test.ts:414-458` 锁定了 redaction 行为。 |
| R10 | deferred | **accepted-deferral** | `readSnapshot` 中 sub-COUNT(*) 仍存在；closure §5.2 / 5.3 列为后续运营 follow-up。非 Z2 blocker。 |
| R11 | partially-fixed | **accepted-partial** | `user-do.ts:784-820:hydrateSessionFromDurableTruth` 真实落地——读 D1 snapshot + timeline，重建 `recent-frames`（容量上限 50），并写回 `sessions/<id>` 与 `conversation/index`；测试 `user-do.test.ts:629-695` 验证清空 hot-state 后 timeline 路径走 D1 还原 50 帧。**没有**端到端 ws reconnect 测试，因此 Q6 line 208 字面口径只达成 ~80%。建议 Z3 启动前补 reconnect e2e。 |
| R12 | fixed | **closed** | `user-do.ts:206-225:jsonDeepEqual` 递归 + key-sorted；测试 `user-do.test.ts:274-329` 锁定"键序不同时仍 parity OK"。 |
| R13 | fixed | **closed** | `docs/nacp-session-registry.md` 31 行已建立；`test-legacy/session-registry-doc-sync.test.mjs` 现在能匹配到文档；root `pnpm test:contracts` 进入保护范围。 |
| R14 | fixed | **closed** | `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md:339` write ownership 收口为 `orchestration.core`（统一经 redaction wrapper append）；index 列表也补齐 turns/messages 双索引 + UNIQUE。 |
| R15 | fixed | **closed** | `003-session-truth-hardening.sql:287-297` 建出 `view_recent_audit_per_team`。 |
| R16 | deferred | **accepted-deferral** | `agent-core/wrangler.jsonc` 仍无 `d1_databases`；closure §5.6 列为 Z3 设计前置。 |
| R17 | fixed | **closed** | `user-do.ts:752-782:forwardStatus` 现在 fetch + RPC 双跑 + jsonDeepEqual 比较；测试 `user-do.test.ts:738-772`。 |
| D1 | fixed | **closed** | ZX-d1 §7.3.5 write ownership matrix 与 003 一致；不再保留双真相口径。 |
| D2 | fixed | **closed** | activity nullable 三列（`actor_user_uuid / conversation_uuid / session_uuid`）+ DDL `payload<=8192` CHECK + code `serializeActivityPayload` 截断兜底（`session-truth.ts:102-111`）。 |
| D3 | partially-fixed | **accepted-partial-with-W1** | `agent-core/src/index.ts:225-232:invokeInternalRpc` 现在 `this.env.SESSION_DO.get(...).fetch(...)`，URL `https://session.internal/sessions/<id>/<action>`，不再走 `routeInternal()`。**新问题 W-1**：因此跳过了 `validateInternalAuthority`（secret + authority-equality + trace_uuid uuid-shape）。详见 §9.3.W-1。 |
| D5 | fixed | **closed** | 与 D2 同修。 |
| D6 | partially-fixed | **accepted-partial** | hydrate 测试存在；full reconnect e2e 缺。 |
| D7 | fixed | **closed** | 003 有 FK。 |
| D8 | fixed | **closed** | 与 R17 同修。 |
| D9 | fixed | **closed** | `appendStreamEvent` 在同一 batch 内 `UPDATE last_event_seq = MAX(?2, last_event_seq)`（`session-truth.ts:422-430`）。 |
| D10 | fixed | **closed** | 003:278-279 创建 `idx_nano_conversation_turns_team_created_at`。 |
| D11 | fixed | **closed** | 003:284-285 创建 `idx_nano_conversation_messages_turn_created_at`。 |
| D12 | fixed | **closed** | 与 D1 同修。 |
| D13 | rejected | **accepted-rejection** | agent-core checkpoint 与 orchestrator alarm 是两套关心不同 invariant 的系统（前者 hibernation restore；后者 hot-state GC），强行耦合会破坏边界。GPT rejected 合理。 |
| D14 | partially-fixed | **accepted-partial** | `status:* / verify:*` 已被 alarm 主动 evict；其它 cache family（如未来 secret cache）当前没有遍历式 GC。可接受作为 Z3 follow-up。 |
| K1 | fixed | **closed** | 没采用 `BEGIN TRANSACTION` 是正确的——D1 文档明确指出 BEGIN/COMMIT 不被支持，应用 `db.batch([...])` + UNIQUE 冲突重试是仓库一直坚持的口径。 |
| K5 | fixed | **closed** | `session-truth.ts:550-591:rollbackSessionStart` + `user-do.ts:906-924` 调用；测试 `user-do.test.ts:355-412` 显式断言 `rollbackSessionStart` 被以正确参数调用，且失败 activity log 写入时 `conversation_uuid/session_uuid/turn_uuid = null`（避免引用已删除行）。 |
| K7 | deferred | **accepted-deferral** | `nano-session-do.ts:503-511:currentTeamUuid` 仍然 fallback `env.TEAM_UUID`。closure §5.3 / §5.4 与 R6 共同记录。 |
| K8 | fixed | **closed** | `nano-session-do.ts:1209-1238:restoreFromStorage` 现在恢复 `actorPhase = raw.actorPhase`；测试 `checkpoint-roundtrip.test.ts:116-139` 锁定行为。 |
| K10 | fixed | **closed** | `user-do.test.ts:414-458` 直接断言 redaction 后字段为 `[redacted]`。 |
| K11 | fixed | **closed** | closure §5 residuals 现在列出 6 条，不再过满宣称。 |

#### 9.2.1 统计

- **closed**: 22（R1 / R2 / R3 / R4 / R9 / R12 / R13 / R14 / R15 / R17 / D1 / D2 / D5 / D7 / D8 / D9 / D10 / D11 / D12 / K1 / K5 / K8 / K10 / K11——23 条 fixed/closed）
- **accepted-partial**: 6（R5 / R7 / R8 / R11 / D3 / D6 / D14）
- **accepted-deferral**: 4（R6 / R10 / R16 / K7）
- **accepted-rejection**: 1（D13）

整体修复有效率约 65% closed + 18% partial + 12% reasonable-deferral，是一个高质量的修复轮次。

### 9.3 修复过程中可能引入的新问题（W-x）

> 这些发现都不在 GPT 自评清单内，是在复核中独立观察到的。

#### W-1. RPC 路径绕开 `validateInternalAuthority` 形成 defense-in-depth 降级

- **严重级别**：`high`（不阻塞 Z2 关闭，但**阻塞 Z3 引入第二/第三个 RPC caller**）
- **类型**：`security`
- **事实依据**：
  - `workers/agent-core/src/index.ts:225-232`：新版 `invokeInternalRpc` 直接 `this.env.SESSION_DO.get(...).fetch(new Request("https://session.internal/sessions/<id>/<action>", ...))`，不再设置 `x-nano-internal-binding-secret` / `x-nano-internal-authority` / `x-trace-uuid` 三个头。
  - `NanoSessionDO.fetch` 走 `routeRequest(request)` → `http-fallback` → `httpController.handleRequest`——**没有 `validateInternalAuthority` 调用**。
  - 对照：fetch 路径（`AGENT_CORE.fetch(/internal/sessions/<id>/start)`）走 `fetchWorker → /internal/* 前缀 → routeInternal → validateInternalAuthority → DO`。
  - GPT D3 自评说"不再重新进入 routeInternal()"——属实，但这一步把 secret + authority-equality + trace-uuid uuid-shape 三道校验也全部跳过了。
- **为什么重要**：
  - 在当前 binding 模型下功能等价（only orchestrator-core 能调 AGENT_CORE.start），但**defense-in-depth 已被砍掉**。
  - 如果 Z3 把 quota authorizer / runtime kernel 接成 RPC caller，新 caller 就有了"不需要带 secret 也能成功"的捷径——一旦未来环境下有第三方共享 binding 出现，绕路漏洞就会变成真实的横向越权。
  - parity 在 happy path 上仍然 OK（fetch 与 RPC 都成功），但 fetch 在 invalid trace_uuid 时返回 400，RPC 在同样 input 下会返回 200——使 parity 测试**只对 happy path 有意义**。
- **审查判断**：
  - 不是 Z2 blocker（功能 + 测试齐全），但**必须在 Z3 Phase 1 第一道工作**对齐：要么把 `validateInternalAuthority` 抽到 NanoSessionDO 自身入口，要么让 invokeInternalRpc 仍然带头并继续走 routeInternal。
- **建议修法**：
  - 推荐把 secret + authority validation 从 routeInternal 抽到 NanoSessionDO.fetch 的最开端——使无论 caller 经哪条 transport（fetch / RPC / 未来 DoRpcTransport），都过同一道关口。

#### W-2. closure §3.2 / §3.3 的 LIVE_E2E 证据是修复前数据，未对修复后代码再验证

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - closure §3.2 命令清单仍只列 001/002 远端 apply，没有 003。
  - closure §3.3 仍写"36 / 36 pass、12 / 12 pass"——这是修复前原 Z2 代码 + 002 schema 的产物。
  - GPT §7.4 验证清单显示 `pnpm test:package-e2e ✅ (non-live mode; 36 skipped as designed)`、cross-e2e 同样 non-live——**修复后没有再跑 LIVE_E2E**。
- **为什么重要**：
  - 003 改动是 `RENAME → CREATE → COPY → DROP`，即使是 idempotent migration，在远端 D1 上首次应用也可能因为已有数据违反新 UNIQUE/FK 而失败。
  - 修复后 RPC 路径已变（W-1），parity 行为也变；非 live 测试无法证明 e2e 表现一致。
- **审查判断**：
  - 这是 Z3 启动前必做的 **preflight #1**：把 003 远端 apply + LIVE_E2E 重跑一遍。
- **建议修法**：
  - `cd workers/orchestrator-core && npx wrangler d1 migrations apply NANO_AGENT_DB --env preview --remote` 加 003；然后 `LIVE_E2E=1` 跑 package-e2e/cross-e2e 双跑作为 Z2 真实关闭证据补录。

#### W-3. 003 migration 是非事务性 RENAME→CREATE→COPY→DROP，远端首次应用风险中

- **严重级别**：`medium`
- **类型**：`correctness`（运维）
- **事实依据**：
  - `003-session-truth-hardening.sql:1-262`：6 条 RENAME → 6 条 CREATE → 6 条 INSERT…SELECT → 6 条 DROP。整段不在事务内。
  - 任何一条 INSERT 在新 UNIQUE 下因数据本身违反约束而失败 → 数据库一半旧、一半新，回滚靠手动。
  - 8KB CHECK 在 INSERT 时使用 `CASE` fallback 写入 `'{"truncated":true,"migrated":true,"reason":"payload-too-large"}'`，规避了 payload 超限失败——这是好设计。
  - 但 UNIQUE(trace_uuid, event_seq) 没有数据修复 path：如果 002 期间已有同 trace_uuid 双写（R2 修复前的并发漏洞），003 INSERT 会直接抛 UNIQUE。
- **为什么重要**：
  - 当前 preview D1 应用 002 期间数据量很小，远端 apply 大概率成功；但 Z3 / Z4 真实流量下若需要再做 schema 加固迁移，这种"无事务、无去重"模板会反复埋雷。
- **审查判断**：
  - Z2 范围内可接受；但在 Z3 启动前应该给 schema migration 写一个标准模板（前置 dedup query / 数据清洗 / 失败回退脚本）。
- **建议修法**：
  - 在 `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md` 增加 §migration-discipline，固定"加 UNIQUE 前必须先跑 dedup pre-check"的 SOP。

#### W-4. Closure §3 仍声称 "live e2e 36/36 + 12/12 pass" 但 §7.4 显示 non-live skipped — 文档与现实不一致

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - 同 W-2 的事实链。
  - closure §3.3 与 §7.4 在同一份文档里给出**互相矛盾**的验证状态。一个读者只看 §3 会以为 live e2e 已过；只看 §7.4 会以为只跑了 non-live。
- **审查判断**：
  - 不阻塞 Z2 关闭（GPT 已经在 §7.4 诚实记录），但 closure 主体应该被 reconcile 一次。
- **建议修法**：
  - 在 closure §3 里明确写"§3.3 是 2026-04-24 / 2026-04-25 修复前的 LIVE_E2E 证据；修复后 LIVE_E2E 重跑挂在 Z3 preflight"。

#### W-5. 上一轮发现的 ZX-qna §1.21 顶部摘要 hot-state 命名漂移仍未修

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/design/zero-to-real/ZX-qna.md:21` 仍写 `Q6=DO SQLite hot-state 只保留 active_session_index / ws_attachment_state / recent_replay_window / pending_input_queue 四组`。
  - Q6 详细答案（line 196-211）与 003 实现一致使用 `conversation_index / active_pointers / recent_frames / cache`。
  - GPT 这轮没有触及 §1.21 顶部摘要。
- **审查判断**：
  - 跨阶段的旧 docs-gap，本轮不该归罪 GPT；但仍是 Z3 启动前文档对齐项之一。
- **建议修法**：
  - 把 ZX-qna §1.21 顶部摘要四组命名改回 Q6 详细口径，同时与 ZX-d1 / Z2-design / Z2-action-plan 一并校准。

### 9.4 跨阶段（Z0~Z2）联合复核

> 这一节不是简单回顾，而是把 Z0/Z1/Z2 三轮 review-after-fix 的最终事实串起来，回答"zero-to-real 阶段一头到 Z2 末梢，已经交付的是什么"。

#### 9.4.1 Z0 — Contract & Compliance Freeze

- **真实状态**：closed（Z0 closure 文档真实存在；charter / design pack / ZX-qna / action-plan 链路成立）。
- **本轮唯一 docs-gap**：W-5 — ZX-qna 顶部摘要命名漂移。属于 Z0 文档，但 Z2 / Z3 都建立在它之上。
- **结论**：Z0 不需要再开。

#### 9.4.2 Z1 — Full Auth & Tenant Foundation

- **真实状态**：closed（Z1 closure 真实存在；orchestrator-auth contract、worker、Wave A schema、JWT keyring、register/login/refresh/me/verify/reset/wechat 都已经在 preview 部署）。
- **未收口的 carry-over**：deploy-fill 在 runtime（agent-core internal-policy + orchestrator-core user-do isAuthSnapshot）依然合法。Z2 closure §5.4 / R6 deferred / K7 deferred 三处都把这条诚实标记为后续阶段（Z3 中段/Z4 客户端启动前）的 blocker。
- **结论**：Z1 不需要再开；Z3 启动前需要在设计层把 deploy-fill 退役 deadline 写入 Z3 charter。

#### 9.4.3 Z2 — Session Truth & Audit Baseline

- **真实状态**：closed（schema 已经合规 / repository 已经原子化 / DO 4 组热态 + 10m alarm + cache eviction + recent-frames trim 落地 / parity fetch+RPC 双跑 + jsonDeepEqual / hydrate from D1 / start/status RPC kickoff / contracts 测试绿 / docs 对齐）。
- **新引入的 carry-over**：W-1 / W-2 / W-3 / W-4 — 都不阻塞 Z2 关闭。
- **结论**：**Z2 closed**。

#### 9.4.4 跨阶段 invariant 的最终状态

| invariant | Z0 | Z1 | Z2 | 备注 |
|---|---|---|---|---|
| `tenant_source: claim` 是 contract 唯一合法值 | ✅ | ✅ | ✅ | 仅 contract 层；ingress/runtime 仍允许 deploy-fill |
| deploy-fill 在 runtime 退役 | n/a | ❌（Z1→Z2 carry） | ❌（Z2→Z3 carry） | 三轮 review 都列 deferred |
| D1 schema 完整性纪律（FK/UNIQUE） | n/a | ✅ Wave A | ✅ Wave B（修复后） | Z2 003 落地 |
| event_seq per-trace 严格递增（Q5） | n/a | n/a | ✅ | atomic INSERT-FROM-SELECT + UNIQUE |
| DO hot-state 四组最小集合（Q6） | n/a | n/a | ✅ | 仅命名与 ZX-qna §1.21 顶部摘要不一致 |
| status/start RPC parity（Q7） | n/a | n/a | ✅ subset | jsonDeepEqual 锁定；D1 row diff 与 trace stamp 验证仍是后续阶段 |
| reconnect 重建 invariant（Q6 line 208） | n/a | n/a | ⚠️ partial | hydrate 测试存在；full ws reconnect e2e 缺 |
| append-only redaction 全覆盖 | n/a | n/a | ✅ | message + activity 双路径都过 redaction |
| view_recent_audit_per_team | n/a | n/a | ✅ | 003 落地 |
| message body redaction（R9） | n/a | n/a | ✅ | sanitizeMessagePayload |

### 9.5 Z2 是否可以关闭 / Z3 / Z4 启动判断

#### 9.5.1 Z2 关闭信号

- **关闭判断**：`yes — Z2 closed`
- **理由**：
  1. action-plan §2.1 列出的 S1-S6 现在全部从 `partial` 上升到 `done` 或 `accepted-partial-with-deferred-followup`。
  2. ZX-qna Q5 / Q6 / Q7 字面冻结口径都已经在代码 + 测试中可验证。
  3. closure §5 residuals 列出的 6 条都已经在本轮 review 中被独立确认为 deferred-by-design。

#### 9.5.2 Z3 启动判断

- **是否允许启动**：`yes，但必须在 Z3 Phase 1 第一道工作之前完成两条 preflight + 一条设计议题`。
- **必须完成的 Z3 preflight**：
  1. **W-2 + W-3 + W-4 同源**：把 003 migration 在 preview-remote `--env preview --remote` 上 apply；重跑 `LIVE_E2E=1 pnpm test:package-e2e && pnpm test:cross-e2e`；把 closure §3.2 / §3.3 改成"修复后 evidence"；reconcile 与 §7.4 的矛盾。**没做之前，Z3 工作不要开始往 preview 部署，否则会同时遇到代码/schema 漂移**。
  2. **W-1**：在 Z3 charter 中写入 "RPC 路径必须过 validateInternalAuthority"，把 secret + authority-equality + trace-uuid uuid-shape 三个 invariant 提到 NanoSessionDO 自身入口，使所有 transport 共享一道关口。Z3 引入第二/第三个 RPC caller（quota authorizer / LLM gate）前必须先做。
- **必须在 Z3 charter 中明确的设计议题**：
  - **R16 / agent-core D1 ownership**：Z3 真实 LLM 接入后 quota deny 必须 emit activity log。是 agent-core 直 bind D1 然后破 redaction wrapper 单点纪律，还是引入 `orchestrator-core.appendActivity` RPC（第二条 dual-impl）？这是 ZX-d1 §7.3.5 write ownership matrix 的下一个测试。
  - **R6 / K7 deploy-fill 退役 deadline**：必须给 Z3 charter 设一个 "deploy-fill 在 runtime 仅作 ingress fallback、internal RPC 路径只接受 claim" 的硬截止；否则 Z4 客户端真机阶段会带病上线。

#### 9.5.3 Z4 启动判断

- **是否允许启动**：`no — Z4 暂不能进入 first real run`，需要先把 Z3 中段三条架构债务收口。
- **理由**：
  1. **R6 / K7 deploy-fill**：客户端（Web / Mini Program）真实流量进入后，每个 token 都来自真实 user/team；deploy-fill fallback 不应该再出现在 internal RPC 与 DO authority 路径上。Z4 启动前必须由 Z3 中段把 internal-policy.ts 与 user-do.ts 的 isAuthSnapshot 收紧。
  2. **R7 / R11 reconnect 真相**：Z4 客户端要真正"重连后看到一致 history"，需要 ws reconnect e2e + sequence_no（或同等可证明顺序）支撑。Z3 中段补 sequence_no（或 OWNER 显式接受 message_uuid 作为 tie-break）+ reconnect e2e。
  3. **R16 / agent-core audit 路径**：Z4 客户端真实 LLM 流式输出需要 quota / LLM invoke 全程被 activity log 锁定，agent-core ↔ orchestrator-core 的 audit ownership 必须先在 Z3 决定。
- **解锁条件（建议写入 Z3 closure）**：
  - W-1 + R6 + K7 一并做完（internal-policy 强收口）。
  - R11 升级到 reconnect ws e2e。
  - R16 决策落定。

### 9.6 总评

- **三轮 review 的最终图景**：Z2 是 zero-to-real 第一个真正"打到了字面口径"的阶段——前两轮是骨架 + carry-over，本轮（GPT 修复 + 二次复核）才把 schema 完整性、parity、redaction、reconnect 半边等核心 invariant 拉到合规线。
- **Z2 真正解决的事**：D1 不再是事件追加桶，而是真正的"约束化真相层"。Q5 字面冻结的"per-trace 严格递增"现在由 schema + atomic stmt 双重保证；Q6 四组热态 + 容量 + 10m alarm 完整成立；Q7 parity 在 fetch/RPC 两条路径上 jsonDeepEqual 锁定；redaction 在 activity + message 两条写入路径全覆盖。
- **Z2 没解决的事**：deploy-fill 仍在 runtime；agent-core 仍无 D1 ownership；invokeInternalRpc 现在缺 defense-in-depth（W-1）；preview-remote 与 local D1 schema 不同步（W-2/W-3）。这些都是 Z3 必须先收的债。
- **最终 verdict**：**Z2 closed; Z3 may start with two preflight items + one charter design item; Z4 blocked-on-Z3-mid。**

> GPT 这一轮的修复质量是真正可信的：22+1 条 closed 都对得上代码事实，6 条 partial 与 4 条 deferred 都给出了诚实的 closure §5 记录，1 条 rejected（D13）是合理的边界判断；同时 GPT 没有用"修复"为名引入 critical 缺陷，唯一的 W-1 是设计权衡——把 routeInternal 从 RPC 路径上剥离换来更短调用链——本轮可接受、下一阶段必须收口。这是 zero-to-real 三个阶段以来最干净的一次 review-fix-rereview 闭环。

