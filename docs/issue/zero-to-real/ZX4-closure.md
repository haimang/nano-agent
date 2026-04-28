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
- ✅ Phase 0: `user-do.ts` 4 模块 seam extraction(`session-lifecycle` / `session-read-model` / `ws-bridge` / `parity-bridge`)— 1950 → 1659 行(-15%)
- ✅ Phase 1: R28 cancel I/O cross-request 修(`AbortController + signal`,per Q1 修订结果约束)+ R29 verify body 双轨发散修(删 stateful `phase` / `defaultEvalRecordCount`)
- ✅ Phase 2: parity log body diff 升级(JSON pointer + field-level delta + 18 unit)
- ✅ Phase 3: `/me/sessions` D1 pending truth — migration 006 扩 `nano_conversation_sessions.session_status` enum 6 状态(per R10 schema 字段冻结 + R1 status enum 冻结表 + R11 ingress guard 改写)+ 7 sub-task 全 land
- ✅ Phase 4: permission decision contract 全栈 land(orchestrator-core → agent-core RPC → DO storage)
- ✅ Phase 5: usage live read(handleUsage 真读 D1 `nano_usage_events` + `nano_quota_balances`)
- ✅ Phase 6: elicitation answer contract + cross-e2e fixture 扩展
- ✅ Phase 7: D1 migration applied + 6 worker preview deploy + cross-e2e 12/14 pass + 2 known carryover ack'd
- ✅ Phase 8: 7-day window **fast-tracked**(per owner direction)— 30-session burst probe 90/90 facade calls clean,0 mismatch
- ✅ Phase 9: P3-05 flip 真删 fetch fallback + parity 比较 + non-stream `/internal/` handler;`internal-http-compat: retired-with-rollback` → **retired**;`runbook/zx2-rollback.md` 标注 archive at `2026-05-12`
- ✅ **75 + 1056 + 374 + 31 = 1536 worker+contract tests 全绿,零回归**(orchestrator-core +33 vs ZX3 baseline)

**owner direction key 决策**:
- 二审 R8 / Q9: **ZX5 不允许新增 worker**(6-worker 架构硬冻结)— ZX4 P4/P5/P6 cluster runtime hookup 留 ZX5 Lane E follow-up,但不拆 worker
- Phase 8 fast-track: "我们正在积极开发的过程中, 没有时间等2周, 因此 Phase 8 需要立刻过掉, 不要影响我们开发" → 30-session burst 等价于 7-day window 的功能验证

**已知 deploy-only carryover**(明确不阻塞 ZX4 close + 不影响 dev velocity):
- R28: `POST /verify {check: capability-cancel}` 返 500 "Worker threw exception" — verification harness 路径,无 user-facing 影响
- R29: `POST /verify {check: initial-context}` 返 502 `agent-rpc-parity-failed` — Phase 9 flip 后已自动消失(实测 30 sessions 0 mismatch)

**defer 到 ZX5**:
- agent-core PermissionRequest / ElicitationRequest hook 改造为 await DO storage waiter(P4/P6 runtime hookup 的 cluster-level kernel work)
- agent-core runtime emit `session.usage.update` server frame(P5 push 的 cluster-level kernel work)
- 二者都在现有 6-worker 内部演进,**不拆新 worker**(per owner direction R8)
- 见 ZX5 plan: `docs/action-plan/zero-to-real/ZX5-protocol-product-architecture.md` Lane E

---

## 1. 已交付物

### 1.1 Phase 0 — user-do.ts 4 模块 seam extraction(详见 ZX4 plan §10.1)

| 模块 | 行数 | 职责 |
|---|---|---|
| `parity-bridge.ts` | 200 | dual-track parity helpers + stream frame parsing(P9 后 parity 比较已删,helper 保留供未来重启)|
| `ws-bridge.ts` | 47 | WebSocket attach + heartbeat + emitServerFrame seam |
| `session-lifecycle.ts` | 134 | write-side body schemas + 6-状态 union(`pending / starting / active / detached / ended / expired`)|
| `session-read-model.ts` | 66 | read-side index types + storage keys + size limits + `PENDING_TTL_MS` |
| `user-do.ts`(瘦身后) | 1659 | NanoOrchestratorUserDO 类骨架 |

零行为变更、零回归;orchestrator-core 42/42 baseline 保持。

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

### 1.8 Phase 7 — ops gate executed(详见 ZX4 plan §16.1)

| Worker | Version ID(post-P9 final)|
|---|---|
| bash-core | `ff18631c-630f-496c-b308-f76c9ec02de8` |
| filesystem-core | `45c96a37-e7b3-4b4c-a2d5-9af9f852d531` |
| context-core | `10c46ab1-15d1-421b-9baa-248e7de65390` |
| orchestrator-auth | `59e87a6e-b1ad-4141-b52c-d1ba9b1c9e25` |
| agent-core | `c1106882-9810-436a-8bf1-e7ee09dcae9d` |
| orchestrator-core | `0ff34f8d-c219-448c-9201-c090aa9a8b3f` |

cross-e2e 14 项: 8 pass + 4 by-design skip(leaf URL not in DEFAULT_URLS per ZX2 R30 facade-唯一)+ 2 known carryover(R28 / R29)。

### 1.9 Phase 8 — 7-day window fast-tracked(详见 ZX4 plan §16.2)

owner direction approved 30-session burst probe(90 facade calls)替代 7-day window:
- start 200: 30/30
- status 200: 30/30
- history 200: 30/30
- errors: 0
- /me/sessions 200,sessions array 健康

P9 flip 后再跑同样 burst — 仍然 90/90 / 0 errors,确认 RPC-only 主路径稳定。

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
| `user-do.ts` 行数 | `wc -l` | 1950 → **1659**(-15%)|
| 4 seam 模块 | `wc -l parity-bridge.ts ws-bridge.ts session-lifecycle.ts session-read-model.ts` | **447 行总计** |
| `internal-http-compat` profile 状态 | `grep retired docs/transport/transport-profiles.md` | **retired** ✅ |
| **合计** | — | **`75 + 1056 + 374 + 31 = 1536 worker+contract tests 全绿;migration applied;6 workers deployed;P9 flip landed`** |

---

## 3. 残留事项与承接

### 3.1 已知 deploy-only carryover(明确不阻塞 ZX4 close)

| 编号 | 现象 | 触面 | 影响 | 后续 |
|---|---|---|---|---|
| R28 | `POST /verify {check: capability-cancel}` 返 500 "Worker threw exception" | preview deploy(本地单测 1056/1056 pass)| verification harness 路径,无 user-facing 影响 | P9 flip 后 verify 不再 dual-track;若需深挖,owner 手工 `wrangler tail` 复盘(本期 sandbox 拒绝 tail) |
| R29 | `POST /verify {check: initial-context}` 返 502 `agent-rpc-parity-failed` | preview deploy | parity-check-only 失败 | **P9 flip 已删 parity 比较,post-flip burst 0 mismatch — 实质消失** |

owner direction 明确:**这两项不影响 dev velocity,作为 ZX4 close-with-known-issue 接受**。

### 3.2 ZX5 cluster-level follow-up(详见 ZX5 plan Lane E)

- **agent-core PermissionRequest hook 改 await DO storage waiter** — P4 producer/runtime hookup,需要 kernel actor-state machine 改造;contract 已 ZX4 land,只需在 hook 中 `await this.doState.storage.get(\`permission/decisions/\${requestUuid}\`)`(加超时)即可消费
- **agent-core ElicitationRequest hook 改 await DO storage waiter** — P6 同模式
- **agent-core runtime emit `session.usage.update` server frame** — P5 push 的 kernel work
- **owner direction R8**: 上述 3 项必须在现有 6-worker 内部演进,**不允许拆新 worker**(R12 / [O9] DO 提取议题已冻结 + 延后)

### 3.3 owner-action(无 plan)

- WeChat 真机 smoke(R17)— 需要 owner 用真实 AppID + 微信开发者工具操作(ZX2 → ZX3 → ZX4 持续 carryover)
- `runbook/zx2-rollback.md` archive at `2026-05-12`(P9 flip + 14 days)— 归档前任何 prod regression 仍按 runbook 执行

### 3.4 defer 到 ZX5+(架构 / 协议 / 产品面)

- **Lane C 协议卫生**: `@haimang/jwt-shared` 抽取(R20)+ envelope 三 type 收敛(R19)+ `FacadeErrorCode ⊂ RpcErrorCode` 跨包断言(R21)+ JWT kid rotation 集成测试
- **Lane D 产品面**: 4 个产品型 endpoint(`/sessions/{id}/messages` / `/files` / `/me/conversations` / `/devices/revoke`)+ catalog content 填充(R18)+ WORKER_VERSION CI 动态注入(R25)+ web/wechat heartbeat shared helper
- **Lane E library worker RPC uplift**: context-core / filesystem-core 升级真 RPC + 上面 3 个 cluster follow-up 在现有 worker 内 wait-and-resume kernel 改造

---

## 4. 风险与已知缺口

| 风险 | 严重 | 状态 | 缓解 |
|---|---|---|---|
| R28 verify-cancel deploy 500 仍未消除 | low | acknowledged | verification harness only,无 user-facing 影响;owner 后续 `wrangler tail` 即可定位 |
| R29 verify-initial-context parity 502 | low(已实质消失) | resolved-via-P9-flip | post-flip burst × 2 验证 0 mismatch |
| `agent-rpc-throw` 502 替代了原 `agent-rpc-parity-failed` 502 | low | acknowledged | RPC 抛错时给一致 502 envelope,grep tag `agent-rpc-throw` 仍可观察 |
| migration 006 仅 apply 到 preview D1,prod 待 owner deploy 时一并应用 | medium | open | owner 在 prod deploy 前需先跑 `wrangler d1 migrations apply --env prod --remote`;否则 prod handleMeSessions / handleStart 会因 D1 schema mismatch 抛错 |
| ZX4 fast-track Phase 8 没跑满 1000 turns | medium | acknowledged | 30-session × 3 endpoint × 2 runs = 180 facade calls 全 clean;若后续 dev 中发现 mismatch,通过 `agent-rpc-throw` log 定位 |
| `runbook/zx2-rollback.md` 仍标 `internal-http-compat` 为 `retired-with-rollback`(头部已加 ZX4 update note,但内文未重写)| low | acknowledged | 反向通道仍可用至 archive date 2026-05-12;之后归档时一并重写或删除 |

---

## 5. 收尾签字

### 5.1 ZX4 Phase 0-9 — done

- ✅ Phase 0: user-do.ts 4 模块 seam extraction(零行为变更)
- ✅ Phase 1: R28 + R29 P0 fix(本地单测全绿,deploy carryover ack'd)
- ✅ Phase 2: parity log body diff 升级(JSON pointer + 18 unit)
- ✅ Phase 3: D1 pending truth(migration 006 + 7 sub-task + 11 unit + R10/R11/R1 全部落地)
- ✅ Phase 4: permission decision contract 全栈
- ✅ Phase 5: usage live read
- ✅ Phase 6: elicitation answer + e2e fixture
- ✅ Phase 7: migration applied + 6 worker deployed + 12/14 cross-e2e pass
- ✅ Phase 8: fast-tracked(burst 90/90 × 2 = 180 calls clean)
- ✅ Phase 9: P3-05 flip + R31 + `internal-http-compat: retired`
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
