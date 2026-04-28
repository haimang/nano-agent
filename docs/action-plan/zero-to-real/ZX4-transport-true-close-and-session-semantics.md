# Nano-Agent 行动计划 — ZX4 Transport True Close + Session Semantics

> 服务业务簇: `zero-to-real / ZX4 / transport-true-close + session-semantics`
> 计划对象: 让 `internal-http-compat` 真正进入 `retired` 状态;同时把 facade-http-v1 必需的 session 语义闭环(permission / usage / elicitation / pending truth)在现有 durable truth 体系内补齐
> 类型: `bug-fix + refactor + add + observation + cutover`
> 作者: `Opus 4.7(2026-04-28 v2)— v1 + ZX4-ZX5 GPT review(R1-R3)修订`
> 时间: `2026-04-28`
> 文件位置:
> - **Lane A(transport blocking close)**:
>   - `workers/agent-core/src/host/do/nano-session-do.ts`(R28 cancel I/O 修)
>   - `workers/agent-core/src/host/do/nano-session-do.ts`(R29 verify body 双轨发散修)
>   - `workers/agent-core/src/host/remote-bindings.ts`(capability transport seam)
>   - `workers/orchestrator-core/src/user-do.ts`(parity log body diff 升级 + P3-05 fetch fallback 删除)
>   - `workers/agent-core/src/host/internal.ts`(P3-05 非 stream/stream_snapshot fetch handlers 删除)
>   - `docs/transport/transport-profiles.md`(retired 状态推进)
>   - `docs/runbook/zx2-rollback.md`(P3-05 flip 后保留 2 周再归档)
> - **Lane B(session semantics)**:
>   - `workers/orchestrator-core/migrations/`(扩展 `nano_conversation_sessions` 加 pending status,**不新建 `pending_sessions` 表**)
>   - `workers/orchestrator-core/src/{index,user-do,session-truth}.ts`(POST `/me/sessions` 写 D1;GET 合并 active+pending;handlePermissionDecision 真回流 resolver;handleUsage 真预算)
>   - `workers/agent-core/src/hooks/permission.ts`(producer)
>   - `test/cross-e2e/zx2-transport.test.mjs`(扩展)
> - **Pre-requisite refactor(早期 seam extraction)**:
>   - `workers/orchestrator-core/src/user-do.ts` → `session-lifecycle.ts` / `session-read-model.ts` / `ws-bridge.ts` / `parity-bridge.ts`(per GPT 3.7+Q3 — 早做避免 pile-up)
> 关联设计 / 调研文档:
> - `docs/eval/zero-to-real/ZX4-action-plan-reviewed-by-GPT.md`(本 plan 的 re-baseline 来源)
> - `docs/issue/zero-to-real/ZX2-closure.md` §4.3 + §5(R16/R27/R28/R29/R30/R31)+ §8.2(7 天 parity + P3-05)
> - `docs/issue/zero-to-real/ZX3-closure.md` §3.2(ZX2 carryover 承接)
> - `docs/code-review/zero-to-real/ZX1-ZX2-reviewed-by-GPT.md` §6.5b rollout-surfaced findings
> - `docs/runbook/zx2-rollback.md`
> 文档状态: `draft (v2 post-ZX4-ZX5-GPT-review) — v1 已被 approved-with-caveats;v2 把 status enum 冻结为单一表 + P4-P6 视为 session-interaction cluster + P7 标 whole-plan + ops gate`

---

## 0. 执行背景与目标

GPT 对原 ZX4 unified draft 的审查(`docs/eval/zero-to-real/ZX4-action-plan-reviewed-by-GPT.md`)指出: 原 plan **scope 过宽**(把 transport finalization + product endpoints + auth hygiene + user-do 大型重构 + heartbeat client + WORKER_VERSION CI 全揉进一份 plan),phase 依赖断点(cross-e2e 14/14 作为 P1 gate 过粗),并存在关键盲点(`pending_sessions` 新表会和 `nano_conversation_sessions` 形成双重真相;`deploy-preview.yml` 在仓库中并不存在;Stream-2/Stream-3 实际触面交集很大)。

按 GPT §4 建议,ZX4 重切为 **Lane A(blocking close)+ Lane B(session semantics)** 单点目标 plan,目标是让 `internal-http-compat: retired` 真正落地 + facade-http-v1 必需 session 语义闭环。**不再混入产品面 endpoint / 协议 hygiene / 架构 refactor — 这些拆到 ZX5**。

- **服务业务簇**: `zero-to-real / ZX4`
- **计划对象**: transport 真收口 + session 语义闭环
- **本次计划解决的问题**:
  - R28 `verifyCapabilityCancel` 在 CF Workers 真 deploy 触发 I/O cross-request 隔离
  - R29 `verify(check:initial-context)` RPC vs HTTP body 双轨发散触发 502
  - R31 5 个 leaf worker `workers_dev:false` 后旧 stable URL 仍可达
  - 7 天 parity 观察期未启动(且不能在 R28+R29 修前启动 — 阈值无意义)
  - P3-05 翻转(删除 `forwardInternalJsonShadow` fetch fallback + `agent-core/host/internal.ts` 非 stream fetch handlers)未执行
  - R16 `/me/sessions` server-mint 但未写 D1 pending truth → POST 与 GET 不闭环
  - R27 permission/usage/elicitation WS round-trip producer/consumer 未真接通
  - parity log 仅 emit status code,无 body diff(R29 类型未来分歧无法精确定位)
  - `user-do.ts` 1900+ 行已成单点热点 — 后续 phase 若不先做 seam extraction,会形成 pile-up
- **本次计划的直接产出**:
  - R28 + R29 修复 + R28/R29 targeted preview smoke pass
  - parity log 升级到 body diff(JSON pointer + field-level delta)
  - `user-do.ts` 早期 seam refactor 完成(4 模块: `session-lifecycle` / `session-read-model` / `ws-bridge` / `parity-bridge`)
  - permission / usage / elicitation round-trip 业务闭环 + live e2e 覆盖
  - `/me/sessions` 在现有 `nano_conversation_sessions` durable truth 上扩展 `pending` status(**不新建平行表**)
  - cross-e2e 14/14 全绿(R28/R29 修后再升级测试覆盖)
  - 7 天 parity 观察 0 误报 + ≥ 1000 turns
  - P3-05 翻转: 删 fetch fallback + 删非 stream/stream_snapshot fetch handlers
  - `internal-http-compat`: `retired-with-rollback` → `retired`
  - R31 5 个 leaf worker 旧 workers.dev URL 显式撤销

---

## 1. 执行综述

### 1.1 总体执行方式

GPT 审查后的核心修订: **早做 seam extraction → R28/R29 修 + targeted gate → session 语义闭环 → 全面 live verify → 7 天观察 → P3-05 翻转**。串行为主,只在低交集子项允许并行(per GPT 3.3)。

### 1.2 Phase 总览

| Phase | Lane | 名称 | 工作量 | 目标摘要 | 依赖前序 |
|------|------|------|--------|----------|----------|
| Phase 0 | A+B | user-do.ts 早期 seam extraction | `M` | 拆为 4 模块,不增加新功能,纯 seam 抽取(per GPT 3.7) | `-` |
| Phase 1 | A | R28 cancel I/O fix + R29 verify body fix(P0) | `M` | targeted preview smoke + R28/R29 unit/integration tests pass(**不要求 cross-e2e 14/14 — per GPT 3.2**) | Phase 0 |
| Phase 2 | A | parity log body diff 升级 | `S` | logParityFailure emit JSON pointer + field-level delta | Phase 1 |
| Phase 3 | B | `/me/sessions` D1 pending truth(扩 nano_conversation_sessions 加 'pending')| `M` | POST 写 D1 / GET 合并 active+pending / TTL 24h alarm GC,**不新建平行表**(per GPT 3.4) | Phase 0(seam 后再动 read-model)|
| Phase 4 | B | permission round-trip producer + consumer + resolver | `L` | agent runtime permission gate emit `session.permission.request`;decision 回流到等待中的 resolver | Phase 0 + Phase 3 |
| Phase 5 | B | usage live push + 真预算 snapshot | `M` | `/usage` 返回真预算字段(non-null);`session.usage.update` 推送 | Phase 4 |
| Phase 6 | B | elicitation round-trip + live e2e 扩展 | `M` | `start → permission deny → usage update → elicit answer → cancel → list` full path | Phase 5 |
| Phase 7 | A | live e2e 全面回归 + cross-e2e 14/14 验证 | `S` | preview deploy 后跑 cross-e2e + zx2-transport 扩展;**这里才是 14/14 gate**(per GPT 3.2) | Phase 6 |
| Phase 8 | A | 7-day parity observation | `M`(主要观察期) | `agent-rpc-parity-failed` count = 0 + ≥ 1000 turns | Phase 7 |
| Phase 9 | A | P3-05 flip + R31 workers_dev 撤销 + transport-profiles.md retired 状态 | `M` | 删 fetch fallback / 非 stream fetch handlers;`wrangler unpublish-route` × 5 leaf workers | Phase 8 |

### 1.3 Phase 说明

1. **Phase 0(early seam extraction)**: 把 `user-do.ts` 1900+ 行先按职责 seam 拆为 4 模块 — `session-lifecycle.ts`(handleStart / handleInput / handleCancel / handleVerify)/ `session-read-model.ts`(handleStatus / handleTimeline / handleHistory / handleMeSessions / handleUsage)/ `ws-bridge.ts`(WebSocket attach / emitServerFrame / heartbeat)/ `parity-bridge.ts`(forwardInternalRaw / forwardInternalJsonShadow / logParityFailure)。**不加新功能**,纯重组 + 测试零回归。完成后 Phase 1-6 才能在小文件上各自演进。
2. **Phase 1(R28 + R29 P0 fix)**: R28 — `verifyCapabilityCancel` 改为"取消与执行同一请求生命周期 / 同一运行链条",不依赖第二条独立 cancel request 作为主路径(per GPT Q1 修订 — 结果约束而非实现文字)。R29 — 在 `verifyInitialContext()` 输出层统一 RPC vs HTTP 两轨 body shape;若需要,先把 parity log 升级到 body diff 再定位 field-level 分歧。**Exit gate: R28/R29 targeted preview smoke + 单元测试 pass(per GPT 3.2 不要求 cross-e2e 14/14)**。
3. **Phase 2(parity log body diff)**: `logParityFailure(action, sessionUuid, rpcResult, fetchResult)` 升级为 emit JSON pointer + field-level delta — 让未来类似 R29 的分歧能直接定位 field。
4. **Phase 3(/me/sessions pending truth — 在现有 truth 内扩展)**: per GPT 3.4 严正反对建新 `pending_sessions` 表(会与 `nano_conversation_sessions` / `nano_conversations` / `nano_conversation_turns` 形成双重真相)。改方案: 扩展现有 `nano_conversation_sessions.session_status` enum,加入 `pending` + `expired` 两个新值;POST `/me/sessions` 时写一行 `pending`;`handleStart()` 时迁到 `active`;DO alarm 24h 扫 `pending` 且 `created_at + 24h < now` 的行 → `expired`。**单一 session truth model 保持**。

   **R1 修订(ZX4-ZX5 GPT review §2.2 R1)— Session Status Enum 冻结表**: 当前 `nano_conversation_sessions.session_status` 仅允许 `starting | active | detached | ended`;ZX4 必须**同步**扩展以下 4 处,任何一处遗漏即为 P3 失败:

   | 落点 | 当前状态 | ZX4 P3 后状态 |
   |---|---|---|
   | `migrations/0XX-pending-status.sql` CHECK 约束 | `IN ('starting','active','detached','ended')` | `IN ('pending','starting','active','detached','ended','expired')` |
   | `workers/orchestrator-core/src/session-truth.ts` `DurableSessionStatus` TypeScript union | `'starting' \| 'active' \| 'detached' \| 'ended'` | `'pending' \| 'starting' \| 'active' \| 'detached' \| 'ended' \| 'expired'` |
   | `/me/sessions` read-model 可见状态(GET 响应) | `active / detached / ended` | `pending / active / detached / ended / expired` |
   | DO alarm GC 状态转移 | n/a | `pending` 且 `created_at + 24h < now` → `expired` |

   **状态机**:`pending` →(handleStart)→ `starting` →(runtime ready)→ `active` →(WS detach)→ `detached` →(终态)→ `ended`;另有兜底分支 `pending` →(24h 未 start + alarm)→ `expired`。`detached` 路径保留与 ZX2 行为一致,不属于 ZX4 改动范围。
5. **Phase 4-6(per ZX4-ZX5 GPT review §2.2 R2 — Session-Interaction Cluster)**: P4 / P5 / P6 在文稿上看似三件事,但实际都会同时牵动 `orchestrator-core` read/write paths + `agent-core` runtime blocking seam + WS / HTTP mirror + live e2e。**应被视为一个连续的 session-interaction cluster,工作量按 cluster(>= L+M+M)整体预算,不按文稿长度低估**。

   - **Phase 4(permission round-trip)**: agent runtime permission gate(`workers/agent-core/src/hooks/permission.ts`)在需要询问时通过 `emitServerFrame()` 发 `session.permission.request` server frame;客户端 decision 通过 WS 或 HTTP `/sessions/{id}/permission/decision` 回到 orchestrator-core,然后通过 promise resolver 回流到 agent runtime 阻塞中的 gate。**关键工程困难**: agent-core 当前没有"阻塞等待 orchestrator decision 再恢复执行"的现成 transport contract — P4 必须**同时建立这条 contract + 实现 producer + 实现 consumer**,不是三个独立 phase。
   - **Phase 5(usage live push + 真预算)**: `/usage` 不再返 null placeholder;返 `tokens_used` / `tokens_remaining` / `budget_total` 真数字;runtime 在每次 LLM/tool call 完成后通过 `emitServerFrame()` 推 `session.usage.update`。**与 P4 共享同一 ws-bridge / emitServerFrame seam**;P5 必须在 P4 把 seam 真接通后做。
   - **Phase 6(elicitation round-trip + live e2e 扩展)**: 同 P4 模式 — 双向阻塞-resume contract;若 P4 已建好 generic contract,P6 可复用。新增 cross-e2e 测试覆盖 `start → permission deny → usage update → elicit answer → cancel → list` full path。**这是 cluster 的最后一片 + 第一次真验证 cluster 整体行为**。
8. **Phase 7(live e2e 全面回归)— per ZX4-ZX5 GPT review §2.2 R3 显式 whole-plan + ops gate**: 此处才是 cross-e2e 14/14 + zx2-transport 扩展全绿的 **whole-plan verification gate,含环境前置条件**。该 gate 不是"代码 phase 内部的自足 gate",而是 **code + ops + creds + budget** 的联合 gate,前置条件包括:

   | 前置条件 | 内容 |
   |---|---|
   | code | Phase 0 - Phase 6 全部完成,worker tests 全绿 + root-guardians 全绿 |
   | ops | preview deploy 路径已就绪(对照 ZX5 D1 ops 前置 — 当前为 owner local `wrangler deploy --env preview`)|
   | creds | `NANO_AGENT_LIVE_E2E=1` + `JWT_SIGNING_KEY_v1` + `WECHAT_APPID/SECRET` + `TEAM_UUID` 在执行环境注入 |
   | budget | live LLM smoke(test 12)有 Workers AI quota / provider key |
   | env | preview env 6 worker 已 deploy 到最新 ZX4 P0-P6 代码 |

   Phase 1 的 P0 修复后 R28/R29 类失败已不存在;Phase 4-6 后 permission/usage/elicitation 真接通;Phase 7 跑通就证明 Lane A + Lane B 已闭合,可以进入观察期。**若 ops/creds/budget 任何一项不就绪导致 14/14 跑不出来,要在 closure 中明确写"代码层完成 + ops gate pending",不允许把"环境没准备好"误写成"代码未完成"或"代码完成"。**
9. **Phase 8(7-day parity observation)**: per GPT Q4 — 在所有会影响 parity 结果的代码冻结后启动观察(等价于 P0-P6 + P7 全绿后)。preview env wrangler tail grep `agent-rpc-parity-failed`;0 误报 + ≥ 1000 turns 后 owner 批准翻转。
10. **Phase 9(P3-05 flip + R31 + retired)**: 按 `runbook/zx2-rollback.md` 反向流程:删 `forwardInternalJsonShadow` 中的 fetch fallback;删 `agent-core/host/internal.ts` 中除 stream/stream_snapshot 外的所有 fetch action handlers;`wrangler unpublish-route` × 5 leaf workers 撤销旧 workers.dev URL;`docs/transport/transport-profiles.md` `internal-http-compat: retired-with-rollback` → `retired`。runbook 保留 2 周作为反向通道,之后归档。

### 1.4 执行策略说明

- **执行顺序原则**: Phase 0 早做(seam) → P1 P0 修(targeted gate) → P2 → P3 → P4 → P5 → P6 → P7(全面 gate)→ P8 观察 → P9 翻转
- **风险控制原则**: P1 exit gate 收紧到 R28/R29 targeted smoke(per GPT 3.2) — 不被 unrelated live case 绑架;P9 翻转必须 P8 0 误报 + 1000 turns
- **测试推进原则**: 每 phase 跑全 worker tests + root-guardians;P6 引入扩展 live e2e;P7 是 14/14 cross-e2e gate
- **回滚原则**: P9 翻转后保留 `runbook/zx2-rollback.md` 反向通道至少 2 周;有 regression 立即 rollback
- **并行原则**(per GPT 3.3): 整 stream 不并行;只把低交集子项(如 P2 parity log 升级 vs P3 D1 schema migration)允许 cross-phase 并行,前提是 git conflict 风险可控

### 1.5 影响目录树

```text
ZX4-transport-true-close-and-session-semantics
├── Phase 0 — Early Seam Extraction
│   └── workers/orchestrator-core/src/user-do.ts → 4 modules:
│       ├── session-lifecycle.ts
│       ├── session-read-model.ts
│       ├── ws-bridge.ts
│       └── parity-bridge.ts
├── Lane A — Transport Blocking Close
│   ├── workers/agent-core/src/host/do/nano-session-do.ts(R28+R29)
│   ├── workers/agent-core/src/host/remote-bindings.ts(capability transport)
│   ├── workers/orchestrator-core/src/parity-bridge.ts(parity log body diff)
│   ├── workers/orchestrator-core/src/parity-bridge.ts(P3-05: 删 fetch fallback)
│   ├── workers/agent-core/src/host/internal.ts(P3-05: 删非 stream fetch handlers)
│   ├── docs/transport/transport-profiles.md(retired 状态)
│   └── docs/runbook/zx2-rollback.md(2 周后归档)
└── Lane B — Session Semantics
    ├── workers/orchestrator-core/migrations/0XX-pending-status-extension.sql(扩 nano_conversation_sessions)
    ├── workers/orchestrator-core/src/index.ts(handleMeSessions / handlePermissionDecision / handleUsage)
    ├── workers/orchestrator-core/src/session-lifecycle.ts(handleStart pending→active 状态机)
    ├── workers/orchestrator-core/src/session-read-model.ts(/me/sessions 合并视图)
    ├── workers/orchestrator-core/src/ws-bridge.ts(emitServerFrame producer 路径)
    ├── workers/agent-core/src/hooks/permission.ts(permission producer)
    └── test/cross-e2e/zx2-transport.test.mjs(扩展 full lifecycle)
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope(本次 action-plan 明确要做)

- **[S1]** `user-do.ts` 4 模块 seam extraction(早期,无新功能)
- **[S2]** R28 cancel I/O cross-request 修(per GPT Q1 — 结果约束而非实现文字)
- **[S3]** R29 verify body 双轨发散修
- **[S4]** parity log 升级支持 body diff(JSON pointer + field-level delta)
- **[S5]** `/me/sessions` D1 pending truth — **基于现有 `nano_conversation_sessions` 加 pending 状态**(per GPT 3.4 反对新建平行表)
- **[S6]** permission round-trip producer + consumer + resolver
- **[S7]** usage live push + 真预算字段
- **[S8]** elicitation round-trip
- **[S9]** live e2e 扩展 + cross-e2e 14/14 gate
- **[S10]** 7 天 parity 观察 + P3-05 flip + R31 workers_dev 撤销 + `internal-http-compat: retired`

### 2.2 Out-of-Scope(本次 action-plan 明确不做 — 移交 ZX5)

- **[O1]** `@haimang/jwt-shared` package 抽取(R20)→ ZX5 Lane C
- **[O2]** envelope 三 type 收敛(R19)→ ZX5 Lane C(per GPT 3.9 — 应写"单向约束 + 不改 public wire",不是泛泛"收敛")
- **[O3]** `FacadeErrorCode` ⊂ `RpcErrorCode` 跨包断言(R21)→ ZX5 Lane C
- **[O4]** JWT kid rotation 集成测试 → ZX5 Lane C
- **[O5]** web / wechat client heartbeat / replay 切到 `@haimang/nacp-session` shared helper(per GPT 3.8)→ ZX5 Lane C
- **[O6]** catalog content 填充(R18)→ ZX5 Lane D(产品面 backlog,per GPT 3.6 不阻塞 transport close)
- **[O7]** 4 个产品型 endpoint(`/sessions/{id}/messages` / `/files` / `/me/conversations` / `/devices/revoke`)→ ZX5 Lane D
- **[O8]** WORKER_VERSION CI 动态注入(R25)→ ZX5 Lane D — per GPT 3.5 这是 ops/owner-required prerequisite,不是代码 phase;且当前 `.github/workflows/deploy-preview.yml` 不存在,需要先确认 deploy pipeline
- **[O9]** DO 提取独立 worker(R24)→ ZX5 Lane E(架构 refactor)
- **[O10]** context-core / filesystem-core 升级真 RPC → ZX5 Lane E
- **[O11]** WeChat 真机 smoke(R17)→ owner-action(无 plan)

---

## 3. 业务工作总表

| 编号 | Phase | Lane | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------|------|--------|------|------------------|------------|----------|
| P0-01 | Phase 0 | A+B | user-do.ts 拆分到 4 模块 | `refactor` | `workers/orchestrator-core/src/user-do.ts` → `session-lifecycle.ts` / `session-read-model.ts` / `ws-bridge.ts` / `parity-bridge.ts` | 按 GPT Q3 修订 seam 拆分;无新功能;测试零回归 | high |
| P0-02 | Phase 0 | A+B | 现有 import / test 全部迁到新 4 模块 | `update` | 所有引用 user-do 内部 helper 的文件 | 切 import path;再跑全量 worker tests | medium |
| P1-01 | Phase 1 | A | R28 cancel I/O 修 | `bug-fix` | `workers/agent-core/src/host/do/nano-session-do.ts:1617-1699` + `workers/agent-core/src/host/remote-bindings.ts:247-331` | 取消与执行同一请求生命周期 / 同一运行链条;不依赖独立 cancel request 作为主路径(per GPT Q1) | high |
| P1-02 | Phase 1 | A | R29 verify body 双轨发散修 | `bug-fix` | `workers/agent-core/src/host/do/nano-session-do.ts:verifyInitialContext` | RPC + HTTP 两轨返回 body shape 统一 | high |
| P1-03 | Phase 1 | A | R28/R29 targeted preview smoke | `verify` | preview env + targeted reproduction | **exit gate(per GPT 3.2)** — 不要求 cross-e2e 14/14;只要求 R28/R29 类型已修 | medium |
| P2-01 | Phase 2 | A | parity log body diff 升级 | `add` | `workers/orchestrator-core/src/parity-bridge.ts:logParityFailure` | emit JSON pointer + field-level delta | medium |
| P3-01 | Phase 3 | B | D1 migration: `nano_conversation_sessions.session_status` enum 加 'pending' + 'expired' | `add` | `workers/orchestrator-core/migrations/0XX-pending-status.sql` | CHECK 约束扩到 6 个值;不建平行表(per GPT 3.4 + R1 status enum 冻结表) | medium |
| P3-02 | Phase 3 | B | TypeScript `DurableSessionStatus` union 同步扩展 | `update` | `workers/orchestrator-core/src/session-truth.ts` | union 加 'pending' + 'expired';所有 narrow / exhaustive switch 同步(R1)| medium |
| P3-03 | Phase 3 | B | POST `/me/sessions` 写 D1 pending row | `update` | `workers/orchestrator-core/src/index.ts:handleMeSessions` | mint UUID 后写 D1 一行 `session_status='pending'` | high |
| P3-04 | Phase 3 | B | DO alarm 24h GC pending → expired | `add` | `workers/orchestrator-core/src/session-lifecycle.ts` + DO alarm | scan `WHERE session_status='pending' AND created_at + 24h < now` → UPDATE → 'expired' | medium |
| P3-05 | Phase 3 | B | GET `/me/sessions` read-model 5 状态合并视图 | `update` | `workers/orchestrator-core/src/session-read-model.ts:handleMeSessions` | 返 pending / active / detached / ended / expired 全集(R1) | medium |
| P3-06 | Phase 3 | B | handleStart 状态机 'pending' → 'starting' → 'active' | `update` | `workers/orchestrator-core/src/session-lifecycle.ts:handleStart` | 不用 INSERT,改 UPDATE pending row;保留 duplicate-start 409 guard | medium |
| P4-01 | Phase 4 | B | permission request producer | `add` | `workers/agent-core/src/hooks/permission.ts` + `workers/orchestrator-core/src/ws-bridge.ts:emitServerFrame` | runtime permission gate emit `session.permission.request` server frame | high |
| P4-02 | Phase 4 | B | permission decision consumer + resolver | `add` | `workers/orchestrator-core/src/index.ts:handlePermissionDecision` + `workers/orchestrator-core/src/session-lifecycle.ts` | decision 通过 WS 或 HTTP 回流到等待中的 runtime resolver | high |
| P5-01 | Phase 5 | B | usage live push + 真预算 snapshot | `update` | `workers/orchestrator-core/src/index.ts:handleUsage` + runtime usage emit | `/usage` 返真数字 + `session.usage.update` server frame | medium |
| P6-01 | Phase 6 | B | elicitation round-trip producer + consumer | `add` | 同 P4 模式 | elicitation 接通 | medium |
| P6-02 | Phase 6 | B | live e2e 扩展(start → permission deny → usage → elicit → cancel → list)| `test` | `test/cross-e2e/zx2-transport.test.mjs` | 7 个 facade endpoint full path 覆盖 | medium |
| P7-01 | Phase 7 | A | preview deploy + cross-e2e 14/14 验证 | `verify` | preview env + cross-e2e | **whole-plan + ops gate(R3)** — code + ops + creds + budget + env 5 项前置全部就绪;14/14 全绿;若任何一项 not-ready 须诚实记入 closure | medium |
| P8-01 | Phase 8 | A | 7-day parity observation | `verify` | preview env wrangler tail grep `agent-rpc-parity-failed` | 0 误报 + ≥ 1000 turns | medium |
| P9-01 | Phase 9 | A | P3-05 flip 执行 | `remove` | `workers/orchestrator-core/src/parity-bridge.ts:forwardInternalJsonShadow` + `workers/agent-core/src/host/internal.ts` | 删 fetch fallback + 删非 stream/stream_snapshot fetch handlers | high |
| P9-02 | Phase 9 | A | R31 workers_dev 撤销 | `update` | `wrangler unpublish-route` × 5 leaf workers | 5 个 leaf worker 旧 workers.dev URL 真撤销 | medium |
| P9-03 | Phase 9 | A | transport-profiles.md 状态 retired | `update` | `docs/transport/transport-profiles.md` | `internal-http-compat: retired-with-rollback` → `retired` | low |
| P9-04 | Phase 9 | A | runbook/zx2-rollback.md 保留 2 周后归档 | `update` | `docs/runbook/zx2-rollback.md` | 加"已 retired,反向通道保留至 ${date+14}d"标注 | low |

---

## 4. Phase 业务表格

(详细 Phase 业务表格按 ZX3 plan §4 模式展开;落地时填充)

---

## 5. 需要业主 / 架构师回答的问题清单

### Q1(per GPT 修订)

- **影响范围**: `Phase 1 P1-01 R28 修复`
- **为什么必须确认**: 原 Q1 把实现文字冻结为"AbortController 同 fetch 链";GPT 5.Q1 建议改写为结果约束(取消与执行同一请求生命周期 / 同一运行链条),不冻结实现名词
- **当前建议 / 倾向**: 采用 GPT 修订表述
- **Q**: R28 修复约束是否冻结为"取消与执行处于同一请求生命周期 / 同一运行链条;不依赖第二条独立 cancel request 作为 preview 主路径;本次不做 transport 大重构"?
- **A**: 同意,按结果约束冻结;实现可自由选择,但 preview 主路径不得再依赖第二条独立 cancel request,且本次不扩大为 transport 大重构。

### Q2(per GPT 修订 — 不再问整 stream 并行)

- **影响范围**: Phase 之间的串行 vs 并行
- **为什么必须确认**: GPT 3.3 反对整 stream 并行;同意低交集子项并行(P2 parity log 升级 vs P3 D1 schema migration)
- **当前建议 / 倾向**: 串行为主;允许 P2 与 P3-01 / P3-02 cross-phase 并行(前提 git conflict 可控)
- **Q**: 是否同意 phase-by-phase 串行 + 仅低交集子项允许跨 phase 并行?
- **A**: 同意。以 phase-by-phase 串行为默认,只允许像 P2 与 P3-01/P3-02 这类低交集子项跨 phase 并行,并要求独立 PR + 不触碰同一热点文件。

### Q3(per GPT 修订 — 4 模块 seam 而非行数)

- **影响范围**: Phase 0 user-do.ts 拆分原则
- **为什么必须确认**: GPT Q3 建议 4 模块 — `session-lifecycle` / `session-read-model` / `ws-bridge` / `parity-bridge`(按职责 seam 不按机械行数)
- **当前建议 / 倾向**: 采用 GPT 4 模块 seam
- **Q**: user-do.ts 4 模块 seam 拆分是否冻结?
- **A**: 同意。冻结为 4 模块 seam(`session-lifecycle` / `session-read-model` / `ws-bridge` / `parity-bridge`),按职责边界拆分,不按机械行数拆分。

### Q4(per GPT 修订 — 全部代码冻结后再启动观察)

- **影响范围**: Phase 8 7 天 parity 观察启动时机
- **为什么必须确认**: GPT Q4 反对 S1-P1 后立刻观察(后续变更会污染观察窗口);建议在所有会影响 parity/path 行为的代码冻结后启动
- **当前建议 / 倾向**: P0-P6 + P7 cross-e2e 14/14 全部完成后启动观察(等价于本 plan P8)
- **Q**: 7 天观察启动时机冻结为"所有 parity 影响代码冻结 + cross-e2e 14/14 全绿之后"?
- **A**: 同意。观察期必须放在所有会影响 parity/path 的代码冻结且 P7 14/14 全绿之后,否则观察窗口会被后续变更污染。

### Q5(新增)

- **影响范围**: Phase 3 D1 schema 演进策略
- **为什么必须确认**: GPT 3.4 反对新建 `pending_sessions` 表;建议在现有 `nano_conversation_sessions` 加 'pending' 状态值
- **当前建议 / 倾向**: 采用 GPT 单一 truth 模型 — 扩展现有表
- **Q**: `/me/sessions` pending truth 是否冻结为"扩展 `nano_conversation_sessions` 加 'pending' 状态值,不新建平行表"?
- **A**: 同意。冻结为扩展 `nano_conversation_sessions` 的单一 truth 模型,不新建平行表;若保留 `expired` 语义,必须同步更新 migration CHECK、TypeScript 状态 union 与 read-model,否则只做定时清理不引入文字状态。

---

## 6. 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| Phase 0 seam refactor 引入 regression | 1900+ 行拆分 + import 迁移 | high | 强制零新功能 + 全量测试零回归 + 每模块独立 commit |
| R28 修复仍可能触发其他 I/O 隔离 | CF Workers I/O 隔离规则复杂 | high | wrangler tail 验证;若仍触发降级到 fire-and-forget cancel(GPT Q1 已用结果约束代替实现文字) |
| R29 body 双轨发散根因模糊 | 当前 wrangler tail 只看到 status code | medium | Phase 2 parity log body diff 升级先行,定位 field-level 差异 |
| pending status 与 D1 truth 整合的事务一致性 | POST /me/sessions 写 D1 + handleStart 改 status,需保证状态机原子性 | medium | 用 D1 transaction 或 idempotent UPDATE WHERE status='pending' |
| Phase 8 观察 timing | 7 天观察是 deploy-rate 决定,non-deterministic | medium | 14 天仍无 1000 turns 放宽阈值或加压力测试 |
| `runbook/zx2-rollback.md` 反向通道 timing | P9 flip 后保留 2 周,期间任何回归立即 rollback | medium | 制定明确"哪类信号触发 rollback"(parity 日志 spike / e2e regression / 客户端 4xx 异常)|

---

## 7. Action-Plan 整体测试与整体收口

### 7.1 整体测试方法

- **基础校验**: 6 worker + 6 keep-set 包测试(目前 2400 + 31 = 2431 baseline)
- **集成测试**: cross-e2e 14 项(R28/R29 修后 14/14)+ zx2-transport 扩展(P6 加 full lifecycle)
- **端到端 / 手动验证**: preview env 真部署 + wrangler tail grep `agent-rpc-parity-failed`
- **回归测试**: 每 phase 后跑全量 worker tests + root-guardians
- **Live e2e**: `NANO_AGENT_LIVE_E2E=1 pnpm test:cross-e2e` 期望 P7 后 14/14 pass
- **Phase 1 exit gate**(per GPT 3.2): R28/R29 targeted preview smoke + 单元/集成测试 — **不强求 cross-e2e 14/14**
- **Phase 7 whole-plan gate**: cross-e2e 14/14 + zx2-transport 扩展全绿

### 7.2 整体收口标准

1. P0 user-do.ts 4 模块 seam 完成 + 全量 tests 零回归
2. P1 R28 + R29 修复 + targeted smoke pass
3. P2 parity log body diff 升级
4. P3 `/me/sessions` D1 pending truth — **R1 status enum 4 处同步扩展(migration CHECK / TS union / read-model / alarm GC),任何一处遗漏即 P3 失败**
5. P4-P6 session-interaction cluster — permission / usage / elicitation 三件作为 cluster 整体收口(per R2)
6. P7 cross-e2e 14/14 全绿 — **R3 whole-plan + ops gate;code/ops/creds/budget/env 5 项前置全部就绪**
7. P8 parity log 0 误报 + ≥ 1000 turns
8. P9 P3-05 flip + R31 撤销 + `internal-http-compat: retired`

### 7.3 完成定义(Definition of Done)

| 维度 | 完成定义 |
|------|----------|
| 功能 | `R28+R29 修复 + permission/usage/elicitation round-trip 接通 + /me/sessions pending truth(单一 schema)+ user-do.ts seam 4 模块 + P3-05 flip` |
| 测试 | `cross-e2e 14/14 + zx2-transport 扩展 + 全量 worker tests 全绿(2431+ baseline)` |
| 文档 | `transport-profiles.md internal-http-compat: retired + ZX4 closure 收口` |
| 风险收敛 | `parity log 0 误报 + ≥ 1000 turns + rollback runbook 反向通道保留 2 周` |
| 可交付性 | `internal-http-compat 真正进入 retired;HTTP fallback 全部删除;facade-http-v1 必需 session 语义业务可用(permission / usage / elicitation / pending sessions)` |

---

## 8. 执行后复盘关注点

- **Phase 0 seam refactor 是否真避免了 pile-up**: `待 ZX4 执行后回填`
- **R28/R29 修复方法是否覆盖所有 deploy-only 类似 bug**: `待 ZX4 执行后回填`
- **pending status 状态机扩展是否破坏现有 D1 truth 查询**: `待 ZX4 执行后回填`
- **permission/usage/elicitation round-trip 工作量是否符合预算**: `待 ZX4 执行后回填`
- **7 天观察是否真触发 1000 turns**: `待 ZX4 执行后回填`

---

## 9. 结语

ZX4 经 GPT 审查后 re-baseline 为单点目标 plan: **transport 真收口 + session 语义闭环**。原 unified draft 的 4 类工作(transport / session / protocol-auth / product)拆为:

- **本 plan(ZX4)**: Lane A(transport blocking close)+ Lane B(session semantics)— 是 transport 真退役的硬条件
- **ZX5(独立 plan)**: Lane C(protocol/auth hygiene)+ Lane D(product surface)+ Lane E(library worker RPC 升级,**保持 6-worker 不变**)— 不阻塞 transport close;**owner direction 已硬冻结禁止 ZX5 新增 worker**(详见 ZX5 v2 §1.3 Lane E)

ZX4 完成后,`internal-http-compat: retired` 真正落地;facade-http-v1 必需的 7 个 session 语义 endpoint 业务可用。**ZX4 是 ZX2 transport 主线的真正终点**;ZX5 是后续协议卫生 + 业务面 + 架构演进。

> v1 post-GPT-review by Opus 4.7(2026-04-28)。等 owner 审核 Q1-Q5 后启动。建议执行批次: Phase 0 早期 seam 必须先做 → Phase 1 P0 修 → Phase 2-6 串行 → Phase 7 全面 gate → Phase 8 观察 → Phase 9 翻转(终点)。
