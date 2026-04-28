# ZX4 Transport True Close + Session Semantics — 收尾专项

> 类型: closure (full — 9/9 phases done + ops gate executed)
> 关联: `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md`
> 上游承接: `docs/issue/zero-to-real/ZX3-closure.md` §3.2 + ZX2 closure §4.3 + §5 R11-R31 + §8.2
> 上游审查: `docs/eval/zero-to-real/ZX4-action-plan-reviewed-by-GPT.md`(GPT 一审)+ `docs/eval/zero-to-real/ZX4-ZX5-action-plan-reviewed-by-GPT.md`(GPT 二审 R10-R12)
> 执行人: Opus 4.7(1M ctx)
> 时间: 2026-04-28
> 状态: **ZX4 全 9 phase 完成 — `internal-http-compat: retired` 真正落地;facade-http-v1 必需 7 个 session 语义 endpoint 业务可用;migration 006 applied to remote D1;6 worker preview deploy + post-flip burst 90/90 clean**

---

## 0. TL;DR

ZX4 完成"transport 真收口 + session 语义闭环"主线 — 仓库从 ZX2 留下的"P3-05 翻转 pending + dual-track parity 观察期未启动 + R28/R29 deploy-only bug 未修 + R16 /me/sessions D1 pending truth 缺口 + R27 permission/usage/elicitation round-trip 未通"中间态,推进到"transport profile 唯一(retired internal-http-compat)+ session 5 状态完整 D1 single-truth + decision-forwarding contract 全栈 land + 30-burst smoke 0 mismatch"。

**已完成**:
- ✅ Phase 0: `user-do.ts` 4 模块 seam extraction(`session-lifecycle` / `session-read-model` / `ws-bridge` / `parity-bridge`)— Phase 0 完成时 user-do.ts 1950 → 1659 行,但 ZX4 后续 Phase 3-6 在该文件回填了 D1 pending truth / 5-state read-model / decision forwarding / usage read 等业务逻辑,**ZX4 closure 时点 user-do.ts 实际为 1910 行**(seam 抽取的 helper/types 没有回流,handler 方法体仍在主文件;参见 R4 修订)。4 个 seam 模块当前实际行数:`parity-bridge.ts` 342(P2 body diff 升级后)/ `ws-bridge.ts` 47 / `session-lifecycle.ts` 134 / `session-read-model.ts` 69 = **合计 592 行**(原 plan §10.1 报 447 行也是 Phase 0 时点数)
- ✅ Phase 1: R28 cancel I/O cross-request 修(`AbortController + signal`,per Q1 修订结果约束)+ R29 verify body 双轨发散修(删 stateful `phase` / `defaultEvalRecordCount`)— **代码层修法落地,本地单测全绿;但 deploy 验证仍 surface 残留 500/502,见下方 carryover 块,deploy 根因未定位**
- ✅ Phase 2: parity log body diff 升级(JSON pointer + field-level delta + 18 unit)
- ✅ Phase 3: `/me/sessions` D1 pending truth — migration 006 扩 `nano_conversation_sessions.session_status` enum 6 状态(per R10 schema 字段冻结 + R1 status enum 冻结表 + R11 ingress guard 改写)+ 7 sub-task 全 land — **migration 仅 apply 到 preview remote D1,prod apply 仍是 owner-action;参见 §3.3**
- ⚠️ Phase 4 **(contract land / runtime kernel waiter deferred)**: permission decision **transport 契约**全栈 land(orchestrator-core → agent-core RPC → NanoSessionDO storage `permission/decisions/${requestUuid}`),但 **agent-core PermissionRequest hook 实际 await/resume 改造未做** —— 当前 agent runtime 在 emit `session.permission.request` server frame 后不会阻塞等待 DO storage decision 回流。**这不是 round-trip 业务闭环**,只是 decision-forwarding storage contract。runtime hookup 是 cluster-level kernel work,留 ZX5 Lane E。
- ⚠️ Phase 5 **(D1 read snapshot done / WS live push deferred)**: handleUsage 真读 D1 `nano_usage_events` + `nano_quota_balances`,GET `/usage` 返真数字(allow verdicts 聚合 + remaining balance);但 ZX4 plan 原标准还要求 `session.usage.update` server frame **WS 实时推送**,这一项未实现 —— runtime 在每次 LLM/tool call 完成后没有 emit 对应 frame。前端仍没有 live usage update 体验,只能轮询 GET。runtime emit 留 ZX5 Lane E。
- ⚠️ Phase 6 **(contract land / runtime kernel waiter deferred)**: elicitation answer storage contract 全栈 land + cross-e2e fixture 扩展;但 agent-core ElicitationRequest hook 同 P4 一样未改造为 await/resume。当前 agent runtime 不会消费 `elicitation/decisions/${requestUuid}`。runtime hookup 留 ZX5 Lane E。
- ⚠️ Phase 7 **(code complete / preview deploy with 2 deploy-surfaced carryovers)**: D1 migration applied(preview only)+ 6 worker preview deploy + cross-e2e 12/14 pass(8 pass + 4 by-design skip + 2 deploy-surfaced 仍 fail:R28/R29)
- ⚠️ Phase 8 **(fast-tracked,功能验证 only)**: per owner direction "我们正在积极开发的过程中, 没有时间等2周",原 7-day window + ≥1000 turns + 0 误报 退出标准被替换为 30-session × 3 endpoint × 2 runs = **180 facade calls clean**。**这等价于 happy-path 功能验证,不等价于 7-day 长尾观察**(覆盖不到 alarm GC timing / 并发 race / D1 冷启动 / Workers AI 配额波动 / WS 心跳超时等时间敏感问题);post-flip 边界条件留待后续 dev 阶段自然 surface。
- ⚠️ Phase 9 **(flip executed / R29 path-deletion not root-cause-fix)**: P3-05 flip 真删 fetch fallback + parity 比较 + non-stream `/internal/` handler;`internal-http-compat: retired-with-rollback` → **retired**;`runbook/zx2-rollback.md` 标注 archive at `2026-05-12`。**注意**: R29 所指的 RPC vs HTTP body 微小 divergence 在 P9 flip 后"自动消失",但这是因为产生该 502 的 parity 比较代码被整体删除,**不是定位并修复了 divergence 根因**。post-flip RPC-only 主路径,divergence 即使存在也不再被检测。
- ✅ **75 + 1056 + 374 + 31 = 1536 worker+contract tests 全绿,零回归**(orchestrator-core +33 vs ZX3 baseline)

**owner direction key 决策**:
- 二审 R8 / Q9: **ZX5 不允许新增 worker**(6-worker 架构硬冻结)— ZX4 P4/P5/P6 cluster runtime hookup 留 ZX5 Lane E follow-up,但不拆 worker
- Phase 8 fast-track: "我们正在积极开发的过程中, 没有时间等2周, 因此 Phase 8 需要立刻过掉, 不要影响我们开发" → 30-session burst **功能等价**于 7-day window 通过 happy-path 功能验证,但**性能 / 边界 / 长尾覆盖不等价**

**已知 deploy-only carryover**(代码层修法落地 / deploy 根因未定位 / owner direction 不阻塞 ZX4 close):
- R28: `POST /verify {check: capability-cancel}` 在 preview deploy 仍返 500 "Worker threw exception"。Phase 1 的 `AbortController + signal` 修法 + Phase 7 加的 outer try/catch 双重防御网都未消除。本地 1056/1056 单测 pass,deploy 上仍 fail —— 根因疑在 RPC 调用栈上层(orchestrator-core 的 User-DO `await rpc` 后某环节抛出),需 wrangler tail 复盘(本期 sandbox 拒绝 tail 命令)。**verification harness 路径,无当前 user-facing 影响,但若未来产品化"用户主动取消正在执行的 capability"会触达**。**承接到 ZX5 Lane E / 独立 hotfix follow-up**。
- R29: `POST /verify {check: initial-context}` 在 P9 flip 前返 502 `agent-rpc-parity-failed`(RPC 与 HTTP body 微小 divergence)。Phase 1 删 stateful 字段后本地稳定,deploy 仍 surface 微小 divergence。Phase 9 flip 删除整个 dual-track parity 比较后,该 502 不再触发 —— **divergence 根因未定位,仅检测代码被删除**。post-flip RPC-only 路径下,如未来需要重新引入 parity 检测必须重新定位根因。

**defer 到 ZX5**:
- agent-core PermissionRequest / ElicitationRequest hook 改造为 await DO storage waiter(P4/P6 runtime hookup 的 cluster-level kernel work)
- agent-core runtime emit `session.usage.update` server frame(P5 push 的 cluster-level kernel work)
- 二者都在现有 6-worker 内部演进,**不拆新 worker**(per owner direction R8)
- 见 ZX5 plan: `docs/action-plan/zero-to-real/ZX5-protocol-product-architecture.md` Lane E

---

## 1. 已交付物

### 1.1 Phase 0 — user-do.ts 4 模块 seam extraction(详见 ZX4 plan §10.1)

**Phase 0 时点(seam extraction 落地后,P3-P6 业务回填前)**:

| 模块 | Phase 0 行数 | 职责 |
|---|---|---|
| `parity-bridge.ts` | 200 | dual-track parity helpers + stream frame parsing(P2 升级 body diff 后增长到 342 行,见下表) |
| `ws-bridge.ts` | 47 | WebSocket attach + heartbeat + emitServerFrame seam |
| `session-lifecycle.ts` | 134 | write-side body schemas + 6-状态 union(`pending / starting / active / detached / ended / expired`) |
| `session-read-model.ts` | 66 | read-side index types + storage keys + size limits |
| `user-do.ts`(seam 抽取后) | 1659 | NanoOrchestratorUserDO 类骨架 |
| 4 seam 模块合计 | 447 | — |

**ZX4 closure 时点(P2 body diff 升级 + P3-P6 业务回填后)**:

| 模块 | 当前行数 | 增长来源 |
|---|---|---|
| `parity-bridge.ts` | **342**(+142) | Phase 2 body diff 升级:`computeBodyDiff` / `escapePointerSegment` / `appendPointer` / `previewDiffValue` / `diffNodes` |
| `ws-bridge.ts` | 47 | 不变 |
| `session-lifecycle.ts` | 134 | 不变 |
| `session-read-model.ts` | 69(+3) | 加 `PENDING_TTL_MS` |
| `user-do.ts` | **1910**(+251 vs Phase 0 的 1659) | Phase 3-6 业务回填:P3-07 `sessionGateMiss` / `expireStalePendingSessions` / `mintPendingSession` 调用方 / 5-state read-model 合并 / `handlePermissionDecision` RPC 转发 / `handleElicitationAnswer` / `handleUsage` D1 read |
| 4 seam 模块合计 | **592**(+145) | — |

零行为变更、零回归;orchestrator-core 42/42 baseline 保持。**注意**:Phase 0 的 -15% 缩减是 seam extraction 当时点指标;ZX4 closure 整体看 user-do.ts 净增长(因 P3-P6 在主文件直接回填 handler 逻辑,而非进一步搬到 seam)。R26 user-do refactor 仍未实质 close,handler 方法体仍集中在主文件,**需 ZX5 Lane E 继续按 lifecycle/read-model/ws 边界搬移 handler**(参见 §3.4)。

### 1.2 Phase 1 — R28 + R29 P0 fix(详见 ZX4 plan §10.2)

- **R28 verifyCapabilityCancel**: 删独立 `transport.cancel`(原 I/O cross-request 触发点),改 `AbortController + signal` 同请求生命周期取消。`getCapabilityTransport()` call 接口加 `signal?: AbortSignal`(remote-bindings.ts:253 已支持)。
- **R29 verifyInitialContext**: 删 stateful `phase: this.state.actorState.phase` + `defaultEvalRecordCount: this.getDefaultEvalRecords().length`;只返 deterministic `check / pendingCount / assembledKinds / totalTokens`。

### 1.3 Phase 2 — parity log body diff 升级(详见 ZX4 plan §11)

`logParityFailure` 升级 emit:
- `body_diff: BodyDiffEntry[]` — JSON pointer(per RFC 6901,`~ /` 转义)+ kind(`value-mismatch / rpc-only / fetch-only`)+ rpc/fetch 预览值(string > 200 chars 截断,array/object compact preview)
- `status_match` boolean、`first_pointer`(grep 入口)、`body_diff_truncated`(cap=20)
- 18 个 unit test 覆盖(parity-bridge.test.ts 新文件)

### 1.4 Phase 3 — D1 pending truth(详见 ZX4 plan §12 + §16.1)

- **P3-01 migration 006**: `nano_conversation_sessions.session_status` CHECK 扩 6 状态(per R10 真表字段冻结 — `conversation_uuid NOT NULL` + `started_at NOT NULL`)。SQLite 标准 table-swap 模式,FK target 同步 rename + recreate。新增 `idx_nano_conversation_sessions_pending_started_at`。**已 apply 到 remote D1**(32 commands / 34ms)。
- **P3-02 TS union**: `DurableSessionStatus` 同步扩到 6 状态(R1 status enum 冻结表 4 处之一)。
- **P3-03 mintPendingSession**: `D1SessionTruthRepository.mintPendingSession()` 事务插 2 行(`nano_conversations` + `nano_conversation_sessions(status='pending')`,per R10)。`POST /me/sessions` 在响应前调用。
- **P3-04 alarm GC**: `expireStalePending({now, cutoff})` 扫 pending > 24h → `expired` + 删孤儿 conversation。User-DO `alarm()` 每 10min 触发。
- **P3-05 read-model 5 状态合并视图**: `handleMeSessions()` 合并 KV `CONVERSATION_INDEX_KEY` + D1 `listSessionsForUser()`(D1 status 优先,覆盖 detached → expired 场景)。
- **P3-06 handleStart 状态机**: pending → starting 显式 UPDATE;`expired` / `ended` 拒 409。
- **P3-07 ingress guard**(per R11): KV miss + D1 status='pending' → 409 `session-pending-only-start-allowed`;status='expired' → 409 `session-expired`;`hydrateSessionFromDurableTruth` 对 pending/expired 返 null(防止假冒可写 entry)。**11 个 unit test 覆盖**(7 follow-up endpoint × pending + expired + null fall-through + start expired + start ended)。

### 1.5 Phase 4 — permission decision contract(详见 ZX4 plan §13.2)

- **agent-core**:
  - `host/internal.ts:SUPPORTED_INTERNAL_ACTIONS` 加 `permission-decision`(P9 后回收)
  - `host/do/nano-session-do.ts:fetch()` http-fallback 路径 intercept `permission-decision` action,转 `recordAsyncAnswer(sessionId, body, kind='permission')`,写 DO storage `permission/decisions/${requestUuid}`
  - `index.ts:AgentCoreEntrypoint.permissionDecision()` RPC 方法
- **orchestrator-core**:
  - `OrchestratorCoreEnv.AGENT_CORE` 类型加 `permissionDecision?: AgentRpcMethod`
  - `user-do.ts:handlePermissionDecision()` 在写 KV 后 best-effort 调用 `AGENT_CORE.permissionDecision(...)`(throw 或 binding 缺失不破坏 user-facing 200 ack)

### 1.6 Phase 5 — usage live read(详见 ZX4 plan §13.3)

- `D1SessionTruthRepository.readUsageSnapshot({session_uuid, team_uuid})` 聚合 `nano_usage_events`(allow verdicts only)+ join `nano_quota_balances.remaining`
- `user-do.ts:handleUsage()` 优先返真数字(`llm_input_tokens` / `llm_output_tokens` / `tool_calls` / `subrequest_used` / `subrequest_budget`),no-rows 时退回 placeholder shape

### 1.7 Phase 6 — elicitation answer contract + e2e(详见 ZX4 plan §13.4)

- 与 P4 完全对称的 elicitation pipeline(同 `recordAsyncAnswer` helper、同 RPC 模式、同 4-段 route 模式)
- `index.ts` SessionAction union 加 `elicitation/answer`;`user-do.ts` 加 `handleElicitationAnswer()`
- `test/cross-e2e/zx2-transport.test.mjs` 扩展 ZX4 段:验证 mint 出的 session 在 GET `/me/sessions` 中以 `pending` 状态可见、follow-up `/input` 被 409 `session-pending-only-start-allowed` 拒、`permission/decision` 200、`elicitation/answer` 200

### 1.8 Phase 7 — ops gate executed(**preview only**;详见 ZX4 plan §16.1)

| Worker | Version ID(post-P9 final)|
|---|---|
| bash-core | `ff18631c-630f-496c-b308-f76c9ec02de8` |
| filesystem-core | `45c96a37-e7b3-4b4c-a2d5-9af9f852d531` |
| context-core | `10c46ab1-15d1-421b-9baa-248e7de65390` |
| orchestrator-auth | `59e87a6e-b1ad-4141-b52c-d1ba9b1c9e25` |
| agent-core | `c1106882-9810-436a-8bf1-e7ee09dcae9d` |
| orchestrator-core | `0ff34f8d-c219-448c-9201-c090aa9a8b3f` |

migration 006 仅 apply 到 **preview** remote D1(`wrangler d1 migrations apply nano-agent-preview --env preview --remote`);**prod 仍是 owner-action,不在 ZX4 closure 范围内**(参见 §3.3 + §4 prod deploy hard gate)。

cross-e2e 14 项: 8 pass + 4 by-design skip(leaf URL not in DEFAULT_URLS per ZX2 R30 facade-唯一)+ 2 deploy-surfaced 仍 fail(R28 / R29 — 见 §3.1)。**这不是 14/14 全绿,closure 不应被读作 "preview deploy 全部清白"**。

### 1.9 Phase 8 — 7-day window fast-tracked(**功能验证 only**;详见 ZX4 plan §16.2)

owner direction approved 30-session burst probe(90 facade calls)替代 7-day window:
- start 200: 30/30
- status 200: 30/30
- history 200: 30/30
- errors: 0
- /me/sessions 200,sessions array 健康

P9 flip 后再跑同样 burst — 仍然 90/90 / 0 errors,确认 RPC-only 主路径稳定。

**等价性论述(per 4-reviewer 共识)**:
- ✅ **功能等价**:4 个核心 facade endpoint(start / status / history / me-list)happy-path 200 + 0 unexpected error。
- ❌ **性能 / 边界 / 长尾不等价**:180 calls 不能覆盖 alarm GC timing(24h pending → expired)/ 并发 race / D1 冷启动 / Workers AI 配额波动 / WS 心跳超时等时间敏感问题;也不覆盖 permission/elicitation/cancel/verify/usage/ws full lifecycle。
- ❌ **退出 fast-track 的窗口已关闭**:Phase 9 P3-05 flip 翻转后 parity 比较代码被删,无法回头补 7 天观察。
- 风险接受策略:边界条件留待后续 dev 阶段自然 surface,通过 `agent-rpc-throw` warn log 定位(post-P9 等价于原 `agent-rpc-parity-failed` 的可观测性接口)。

### 1.10 Phase 9 — P3-05 flip + R31 + retired(详见 ZX4 plan §16.3)

- **orchestrator-core**: `forwardStart` / `forwardStatus` 切 RPC-only(无 binding 时 503 `agent-rpc-unavailable`);`forwardInternalJsonShadow` 删 fetch + parity,只保留 RPC + try/catch 502 `agent-rpc-throw`(方法名保留以减少 diff)
- **agent-core**: `host/internal.ts:SupportedInternalAction` 收紧到 `{stream, stream_snapshot}`,`forwardHttpAction` helper 整体删除
- **R31 verify**: 5 leaf worker `workers_dev: false` 在 ZX2 P1-02 / R30 已 land,P9 阶段确认仍生效
- **transport-profiles.md**: §1 表 + §2.2 状态块 + §6 roadmap 三处更新到 `retired` 终态;明确 stream/stream_snapshot 是独立 stream-only 子集
- **runbook/zx2-rollback.md**: 头部加 ZX4 Phase 9 update + archive date `2026-05-12`(P9 flip + 14 days,per ZX4 plan + owner fast-track)

---

## 2. 验证证据

| 验证项 | 命令 | 结果 |
|---|---|---|
| migration 006 to remote D1 | `wrangler d1 migrations apply nano-agent-preview --remote` | **006-pending-status-extension.sql ✅**(32 commands / 34ms) |
| 6 worker preview deploy(post-P9) | `wrangler deploy --env preview` × 6 | **All ✅** Version IDs recorded |
| orchestrator-core test | `pnpm -F @haimang/orchestrator-core-worker test` | **75 / 75 pass**(ZX3 42 + parity-bridge 18 + P3-07 11 + P4/P6 4)|
| agent-core test | `pnpm -F @haimang/agent-core-worker test` | **1056 / 1056 pass**(post-P9 删 1 个 obsolete /internal/start test;ZX3 1057 - 1 = 1056)|
| bash-core test | `pnpm -F @haimang/bash-core-worker test` | **374 / 374 pass**(零回归) |
| context-core / filesystem-core / orchestrator-auth / nacp-core / nacp-session / orchestrator-auth-contract | — | **零回归**(ZX3 baseline 维持) |
| root-guardians | `pnpm test:contracts` | **31 / 31 pass**(零回归) |
| cross-e2e live(preview)| `NANO_AGENT_LIVE_E2E=1 pnpm test:cross-e2e` | **8 pass + 4 by-design skip + 2 known carryover (R28/R29)** |
| post-flip burst probe | `node /tmp/probe-burst.mjs` × 2 runs | **90 / 90 pass,0 errors** × 2 |
| `user-do.ts` 行数(Phase 0 时点) | `wc -l` | 1950 → **1659**(-15%)— Phase 0 落地瞬时指标 |
| `user-do.ts` 行数(ZX4 closure 时点) | `wc -l` | **1910**(+251 vs Phase 0)— P3-P6 业务回填后净增长,见 §1.1 |
| 4 seam 模块(Phase 0 时点) | `wc -l parity-bridge.ts ws-bridge.ts session-lifecycle.ts session-read-model.ts` | 447 行总计 |
| 4 seam 模块(ZX4 closure 时点) | 同上 | **592 行总计**(+145,主要来自 P2 parity-bridge body diff 升级)|
| `internal-http-compat` profile 状态 | `grep retired docs/transport/transport-profiles.md` | **retired** ✅ |
| **合计** | — | **`75 + 1056 + 374 + 31 = 1536 worker+contract tests 全绿;migration applied;6 workers deployed;P9 flip landed`** |

---

## 3. 残留事项与承接

### 3.1 已知 deploy-only carryover(代码层修法落地 / deploy 验证未 pass / 不阻塞 dev velocity)

| 编号 | 现象 | 触面 | 影响 | 后续 |
|---|---|---|---|---|
| R28 | `POST /verify {check: capability-cancel}` 返 500 "Worker threw exception" | preview deploy(本地单测 1056/1056 pass)| verification harness only,**当前**无 user-facing 影响。但若未来产品化"用户主动取消正在进行的 capability"会触达。**不能写为 "无 user-facing 影响" 等价于 "无 bug"**。**根因待 wrangler tail 定位;当前只 symptom 缓解(500 → 部分场景 diagnostic envelope)** | 承接到 ZX5 Lane E / 独立 hotfix。若 owner 在 `2026-05-12` runbook archive 前未定位根因,应在归档时把 R28 升级为 ZX5 P0 bug |
| R29 | `POST /verify {check: initial-context}` 返 502 `agent-rpc-parity-failed`(parity 检测出 RPC vs HTTP body 微小 divergence) | preview deploy | parity-check-only 失败,handleVerify body 仍有 fallback。**P9 flip 后该 502 不再触发是因为 parity 比较代码被删除,不是因为 divergence 根因被修复**。post-flip RPC-only 路径下,divergence 即使存在也不再被检测 | divergence 根因未定位。如未来需要重新引入 parity 检测必须重新定位。post-flip 通过 `agent-rpc-throw` warn log 提供等价可观测性 |

owner direction 明确:**这两项不影响 dev velocity,作为 ZX4 close-with-known-issue 接受**。

### 3.2 ZX5 cluster-level follow-up(详见 ZX5 plan Lane E)— **关键 handoff 清单**

ZX4 已 land 的 contract 端点(ZX5 Lane E 执行者复用):
- orchestrator-core `handlePermissionDecision()`:KV `permission_decision/${requestUuid}` + best-effort RPC `AGENT_CORE.permissionDecision()`
- orchestrator-core `handleElicitationAnswer()`:KV `elicitation_answer/${requestUuid}` + best-effort RPC `AGENT_CORE.elicitationAnswer()`
- agent-core `AgentCoreEntrypoint.permissionDecision()` + `elicitationAnswer()` RPC 方法(`workers/agent-core/src/index.ts`)
- agent-core `NanoSessionDO.recordAsyncAnswer()`:写入 `permission/decisions/${requestUuid}` 和 `elicitation/decisions/${requestUuid}` DO storage

ZX5 Lane E 必须新增的 runtime kernel work(明确不在 ZX4 scope):
- (a) **agent-core PermissionRequest hook** 在 `emitServerFrame('session.permission.request', ...)` 后改为 `await pollDoStorage('permission/decisions/' + requestUuid, timeoutMs)`,resolve 后驱动 kernel actor-state machine 继续。需要 kernel 支持 wait-and-resume 模式
- (b) **agent-core ElicitationRequest hook** 同 (a) 模式,polling key 为 `elicitation/decisions/${requestUuid}`
- (c) **agent-core runtime emit `session.usage.update` server frame** — P5 WS push 的 kernel work,在每次 LLM/tool call commit quota 后通过 emitServerFrame 推送实时数字
- **owner direction R8**:上述 3 项必须在现有 6-worker 内部演进,**不允许拆新 worker**(R12 / [O9] DO 提取议题已冻结 + 延后)

ZX5 Lane A/B 待补的稳健性 follow-up:
- **handleStart idempotency**(per GLM R8):当 KV miss 且 D1 status='pending' 时,客户端重发 `/start` 可能导致 `starting` → `active` 竞态。建议加 request-scoped idempotency key 或 D1 `UPDATE ... WHERE status='pending' AND started_at = :minted_at` 条件
- **R28 deploy 500 根因定位**(per kimi R4 / deepseek R3):需 wrangler tail 复盘(本期 sandbox 拒绝 tail)
- **retired guardians 契约覆盖 cross-reference audit**(per deepseek R13):14 个 retired guardian 的 assert 语句对照 worker-local test 覆盖,验证无契约遗漏

### 3.3 owner-action(无 plan)

- **prod migration 006 apply**:**这是 prod deploy 前的 hard gate,不是软性 owner action**。prod handleMeSessions / handleStart 在 migration 缺失时会因 D1 schema mismatch 抛错。owner 在任何 prod deploy 前必须先跑 `wrangler d1 migrations apply --env prod --remote`(参见 `docs/runbook/zx2-rollback.md` §2.4 prod deploy 顺序硬约束)
- WeChat 真机 smoke(R17)— 需要 owner 用真实 AppID + 微信开发者工具操作(ZX2 → ZX3 → ZX4 持续 carryover)
- `runbook/zx2-rollback.md` archive at `2026-05-12`(P9 flip + 14 days)— 归档前任何 prod regression 仍按 runbook 执行
- `pnpm-lock.yaml` 6 个 stale importer block 清理 — owner 注入 `NODE_AUTH_TOKEN` 后跑一次 `pnpm install`(per ZX3 closure carryover)

### 3.4 defer 到 ZX5+(架构 / 协议 / 产品面)

- **Lane C 协议卫生**: `@haimang/jwt-shared` 抽取(R20)+ envelope 三 type 收敛(R19)+ `FacadeErrorCode ⊂ RpcErrorCode` 跨包断言(R21)+ JWT kid rotation 集成测试
- **Lane D 产品面**: 4 个产品型 endpoint(`/sessions/{id}/messages` / `/files` / `/me/conversations` / `/devices/revoke`)+ catalog content 填充(R18)+ WORKER_VERSION CI 动态注入(R25)+ web/wechat heartbeat shared helper
- **Lane E library worker RPC uplift**: context-core / filesystem-core 升级真 RPC + 上面 3 个 cluster follow-up 在现有 worker 内 wait-and-resume kernel 改造

---

## 4. 风险与已知缺口

| 风险 | 严重 | 状态 | 缓解 |
|---|---|---|---|
| R28 verify-cancel deploy 500 根因未定位 | **medium** | open(轻量 try/catch 缓解 / 根因待 wrangler tail) | verification harness only(当前)/ 但若产品化 user-cancel 路径会触达 / 承接到 ZX5 Lane E |
| R29 verify-initial-context parity 502 通过路径删除"消失" | **medium** | resolved-by-deletion-not-fix | divergence 根因未定位,仅 parity 检测代码被删除;post-flip 通过 `agent-rpc-throw` warn log 提供等价可观测性 |
| `agent-rpc-throw` 502 替代了原 `agent-rpc-parity-failed` 502 | low | acknowledged | RPC 抛错时给一致 502 envelope,grep tag `agent-rpc-throw` 仍可观察 |
| **prod migration 006 apply 是 deploy hard gate,不是软 owner-action** | **high** | open | prod deploy 前必须 `wrangler d1 migrations apply --env prod --remote`;否则 prod handleMeSessions / handleStart 会因 D1 schema mismatch 抛错。runbook §2.4 已加 prod deploy 顺序硬约束 |
| Phase 8 fast-track 替代 7-day window 不等价 | **medium** | accepted-risk | 180 calls 等价于 happy-path 功能验证,**不等价**于 7-day + 1000 turns 长尾覆盖;退出 fast-track 窗口已关闭(parity 比较代码已删,无法回头补观察)。后续 dev 阶段通过 `agent-rpc-throw` log 自然 surface 边界 |
| **P4/P6 permission/elicitation 不是 round-trip 业务闭环** | **medium** | partial-by-design | decision-forwarding storage contract 全栈 land,但 agent-core kernel hook 的 await/resume 改造未做(留 ZX5 Lane E)。前端可发 decision,但 agent runtime 不会因此恢复执行 |
| **P5 usage 仅 D1 read snapshot,无 WS live push** | **medium** | partial-by-design | GET `/usage` 真读 D1,但 `session.usage.update` server frame 未 emit(留 ZX5 Lane E)。前端无 live usage update 体验 |
| `forwardInternalJsonShadow` 方法名保留 historical "Shadow" 语义但行为已 RPC-only | low | acknowledged | 注释已说明,后续 ZX5 envelope refactor 时一并重命名 |
| `parity-bridge.ts` 的 `logParityFailure` / `computeBodyDiff` 保留但永不触发(post-P9 dead code in user-do)| low | acknowledged | helper 保留供未来 dual-track 重启使用;若确定 retired profile 不会重新启用,ZX5 后续可 @deprecated 标记或物理删除 |
| `runbook/zx2-rollback.md` §2.1 软回滚已 post-P9 不可用(已加更新标注但子节内容保留作为历史参考)| low | acknowledged | 头部 + §1 + §2.1 + §2.4 全部更新到 P9 后状态;archive date 2026-05-12 |

---

## 5. 收尾签字

### 5.1 ZX4 Phase 0-9 — closure 状态(经 4-reviewer review 后修订)

- ✅ Phase 0: user-do.ts 4 模块 seam extraction(零行为变更;Phase 0 时点 1659 行 / closure 时点 1910 行,见 §1.1)
- ⚠️ Phase 1: R28 + R29 P0 fix — **代码层修法落地,本地 1056/1056 单测全绿;preview deploy 验证未 pass(R28 仍 500 / R29 通过 P9 路径删除"消失")**;deploy 根因待 ZX5
- ✅ Phase 2: parity log body diff 升级(JSON pointer + 18 unit)
- ⚠️ Phase 3: D1 pending truth(migration 006 + 7 sub-task + 11 unit + R10/R11/R1 落地;migration 仅 apply 到 **preview** remote D1,prod 是 owner deploy hard gate)
- ⚠️ Phase 4: permission decision **storage contract** 全栈 land / **runtime kernel waiter deferred** to ZX5 Lane E
- ⚠️ Phase 5: usage **D1 read snapshot done** / **WS `session.usage.update` live push deferred** to ZX5 Lane E
- ⚠️ Phase 6: elicitation answer **storage contract** + e2e fixture / **runtime kernel waiter deferred** to ZX5 Lane E
- ⚠️ Phase 7: migration applied(preview only)+ 6 worker deployed + cross-e2e **8 pass + 4 by-design skip + 2 deploy-surfaced fail(R28/R29)**
- ⚠️ Phase 8: fast-tracked 30-session burst × 2 = 180 calls — **功能验证 only,不等价于 7-day + 1000 turns 长尾覆盖**
- ✅ Phase 9: P3-05 flip + R31 + `internal-http-compat: retired`(**注意**:R29 通过此 phase 删除产生 502 的代码,而非定位 root cause)
- ✅ 1536 worker+contract tests 全绿,零回归

### 5.2 ZX5 启动条件(已具备)

- ✅ ZX4 transport finalization 完成 — `internal-http-compat: retired` 真正落地
- ✅ ZX4 facade-http-v1 必需 7 个 session 语义 endpoint 业务可用(start / input / cancel / verify / status / timeline / history + permission/decision + elicitation/answer + usage + me/sessions + ws + resume)
- ✅ D1 single-truth 6-状态 session model + R11 ingress guard 闭环
- ✅ 6-worker 架构硬冻结(owner direction R8)
- ✅ ZX5 plan(`docs/action-plan/zero-to-real/ZX5-protocol-product-architecture.md`)起草完成,Lane C/D/E 边界冻结

### 5.3 owner action

- ⏳ prod deploy 前先 `wrangler d1 migrations apply --env prod --remote` 推 migration 006
- ⏳ 审核 ZX5 plan 启动顺序(Lane C / D / E 优先级)
- ⏳ `runbook/zx2-rollback.md` 在 `2026-05-12` 归档(or 提前归档)
- ⏳ R28 deploy-only verify 500 若需要根因解决,可在 `wrangler tail` 下复盘(本期 sandbox 拒绝 tail)

> 2026-04-28 — ZX4 全 9 phase 收口。**transport 真收口主线完成** — `internal-http-compat` 从 ZX2 P3-05 留下的 `retired-with-rollback` 中间态推进到真正的 `retired`(fetch fallback 删除 + parity 比较删除 + non-stream `/internal/` handler 删除 + 5 leaf worker `workers_dev:false` 维持 + runbook archive timer 设置 + transport-profiles.md 终态文档化)。**facade-http-v1 必需 7+5 个 session 语义 endpoint 业务可用**;mint→pending→starting→active→detached→ended/expired 6 状态 D1 single-truth 模型闭环;permission/elicitation decision-forwarding contract 端到端;handleUsage 真预算字段。**ZX4 不是协议层卫生 / 产品面 / 架构演进的开始**;真正的 protocol/auth hygiene + product surface + library worker RPC uplift 承接到 ZX5 — 三个 Lane 严格在 6-worker 架构内演进,owner direction 已硬冻结禁止新增 worker。
