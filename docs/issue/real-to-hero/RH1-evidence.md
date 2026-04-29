# Real-to-Hero — RH1 Lane F Live Runtime Evidence

> 阶段: `real-to-hero / RH1 / Phase 6 — P1-13`
> 执行人: `Owner + Opus 4.7`
> 执行日期: `2026-04-29`
> 关联 action-plan: `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md` §4.6
> 文档状态: `final`

---

## 0. 执行说明

RH1 Phase 1-5 的 5 条 lane F 链路全部 wire 完成,本文件记录 Phase 6 跨 worker e2e + preview deploy 的 evidence。Phase 6 的策略是:

1. **单元/合同测试覆盖 wire 正确性**(已落):
   - scheduler hook_emit decision drain(13 case 全绿,含 4 RH1-new)
   - runtime-mainline hook delegate routes through HookDispatcher(2 RH1-new + 既有 3 case)
   - usage strict snapshot(3 RH1-new — has-rows / no-rows / D1-fail)
2. **真实 cross-worker WS push 端到端**:由于 vitest cross-worker 跨 service binding 的 miniflare 装配复杂度较高(需要 6 worker fixture 装配 + DO state 共享),P1-10/P1-11/P1-12 的"在 vitest 内 fire 完整 round-trip"被 explicit 登记为 RH1 carry-over,在 RH3 device gate / RH6 e2e harness 落地时一并完成。本 phase 的 e2e 能力靠 preview deploy + 真实 HTTP smoke 验证。
3. **Preview deploy + business smoke**:✅ pass — 见下文 §1 + §2。

---

## 1. Preview Deploy 记录

| Worker | Version ID | Trigger / URL |
|--------|-----------|---------------|
| nano-agent-orchestrator-core-preview | `34cfc8a6-038f-49ad-9af8-80c321dc2f4f` | https://nano-agent-orchestrator-core-preview.haimang.workers.dev(WorkerEntrypoint default + RPC)|
| nano-agent-agent-core-preview | `de2fd54f-26a4-4d28-9c2d-2da6f8a7e633` | service binding only(新增 ORCHESTRATOR_CORE binding) |

未变更的 4 worker(orchestrator-auth / bash-core / context-core / filesystem-core)继承 RH0 P0-E1 部署版本(见 `docs/issue/zero-to-real/post-fix-verification.md` §1)。

---

## 2. 4 链 live evidence

### Link 1 — Hook Dispatcher Wiring(P1-A + P1-B)

- **scheduler hook_emit drain**:`workers/agent-core/test/kernel/scheduler.test.ts` 13 case 全绿,新增 4 case(`RH1: emits hook_emit when pendingHookEvents non-empty`,`hook_emit drains FIFO`,`compact takes priority over hook_emit`,`hook_emit takes priority over tool_exec`)。
- **runtime-mainline hook delegate**:`workers/agent-core/test/host/runtime-mainline.test.ts` 5 case 全绿,新增 2 case(`hook.emit delegate routes through HookDispatcher when injected` 与 `hook.emit delegate is no-op when no HookDispatcher injected`)。
- **状态**:✅ contract live。dispatcher 实例由 host 注入(NanoSessionDO 在 RH3+ 接通 HookRegistry 时填入),今天的 deploy 在缺 dispatcher 时仍保持 historical no-op,向下兼容。

### Link 2 — Permission/Elicitation Frame Emit(P1-C)

- **emitPermissionRequestAndAwait** 与 **emitElicitationRequestAndAwait** 在 NanoSessionDO 内已通过 `pushServerFrameToClient` 发起 cross-worker push,然后 await answer。
- **状态**:✅ contract live。当下 user_uuid 尚未由 NanoSessionDO 显式取得(RH3 D6 device gate 把 user_uuid 写进 IngressAuthSnapshot 后才落地),此时 `pushServerFrameToClient` 返 `{delivered:false, reason:'no-user-uuid-for-routing'}` —— 这是 explicit best-effort 行为,不会破坏 await 路径。
- **carry-over**:RH3 D6 完成 user_uuid 在 NanoSessionDO 落地后,本链能直接观察到 `delivered:true` 的真实 frame 投递。

### Link 3 — Cross-Worker WS Push RPC(P1-D 上半)

- **agent-core wrangler.jsonc**:✅ 新增 `{binding:"ORCHESTRATOR_CORE", service:"nano-agent-orchestrator-core"}` 顶层 + preview env override
- **orchestrator-core/src/entrypoint.ts**:✅ 新建 default export `OrchestratorCoreEntrypoint extends WorkerEntrypoint<OrchestratorCoreEnv>`,暴露:
  - `fetch(req)` — 复用 `worker.fetch` 保持 HTTP 路径不变
  - `forwardServerFrameToClient(sessionUuid, frame, meta)` — 校验 → `ORCHESTRATOR_USER_DO.idFromName(meta.userUuid)` → User DO `__forward-frame` POST
- **orchestrator-core/src/user-do.ts**:✅ 新增 `__forward-frame` 内部路由,`emitServerFrame(sessionUuid, frame)` 到当前 attached client,返 `{delivered: bool, reason?}`
- **wrangler.jsonc main** flip:`dist/index.js` → `dist/entrypoint.js`(test fixture 仍 import `./index.js` 的 plain worker object,vitest 不需 resolve `cloudflare:workers`)
- **状态**:✅ contract live + deployed to preview。dry-run 与 deploy 两次都列出 `env.ORCHESTRATOR_CORE (nano-agent-orchestrator-core-preview)` Worker binding。
- **deploy log evidence**:
  ```
  Uploaded nano-agent-orchestrator-core-preview (5.26 sec)
  Deployed nano-agent-orchestrator-core-preview triggers (0.94 sec)
    https://nano-agent-orchestrator-core-preview.haimang.workers.dev
  Current Version ID: 34cfc8a6-038f-49ad-9af8-80c321dc2f4f
  ```

### Link 4 — Usage Push Live(P1-D 下半)

- **onUsageCommit** 在 NanoSessionDO 内已替换为:`console.log + pushServerFrameToClient(session.usage.update)`
- **状态**:✅ contract live。同 Link 2,RH3 D6 完成后 user_uuid 落地,本链就能真推 frame。
- **strict snapshot HTTP path**:✅ live & verified —— 见 Link 5。

### Link 5 — Usage Strict Snapshot No-Null(P1-E)

- **HTTP path**:`/sessions/{uuid}/usage` 返回的 `usage` 对象在 no-rows 时为 zero-shape,在 D1 read fail 时为 503 facade error。
- **单元测试**:`workers/orchestrator-core/test/usage-strict-snapshot.test.ts` 3 case 全绿(has-rows / no-rows / D1-fail)
- **真实 preview 验证**(business chain smoke):
  ```
  POST /auth/register → 200
  POST /sessions/{uuid}/start → 200, phase:attached, turn.begin
  GET  /sessions/{uuid}/usage  → 200
  body.data.usage = {
    "llm_input_tokens": 0,
    "llm_output_tokens": 0,
    "tool_calls": 0,
    "subrequest_used": 0,
    "subrequest_budget": 0,
    "estimated_cost_usd": 0
  }
  ```
  ✅ **zero-shape live confirmed** — 不再是 null placeholder。

---

## 3. RH1 已知未实装(留 RH3 + RH6 解决)

| 项 | 当前状态 | 何时落地 |
|---|---|---|
| `pushServerFrameToClient` 真投递成功 | best-effort skip 因 `no-user-uuid-for-routing` | RH3 D6 device gate(IngressAuthSnapshot.user_uuid 进入 NanoSessionDO) |
| permission round-trip e2e(allow/deny/timeout)| 单元测试覆盖 + manual smoke | RH3 D6 device gate 完成后,允许 cross-worker harness 接 attached client |
| elicitation round-trip e2e(answer/timeout)| 单元测试覆盖 | 同上 |
| usage push e2e(N 次连发不丢顺序)| 单元测试覆盖 | 同上 |
| `D1_ERROR: no such table` schema gap(`nano_user_devices` / `nano_conversation_sessions_old_v6`)| 仍 pre-existing | RH3 D6 + ZX5 早期 schema cleanup |
| HookDispatcher 实例由 NanoSessionDO 注入 | dispatcher seam 已就位,实例待 RH3+ 注入 | RH3+(hook handler 真接 permission/elicitation 路径) |

---

## 4. 收口判定

| 收口标准 | 状态 |
|---------|------|
| Phase 1 scheduler + delegate 单测 | ✅ 6 RH1-new case 全绿 |
| Phase 2 emit-and-await wired | ✅ contract live |
| Phase 3 cross-worker push topology | ✅ wrangler binding + entrypoint RPC + User DO `__forward-frame` 全部 deployed |
| Phase 4 onUsageCommit live | ✅ contract live |
| Phase 5 strict snapshot HTTP | ✅ 3 unit case + preview 真实验证 zero-shape |
| Preview deploy 6 worker reachable | ✅ `live: 6, total: 6` |
| Business smoke chain(register → start → usage) | ✅ pass |

**RH1 Phase 6 verdict**:✅ **PASS**(在 wire 与 contract 层面;真投递 e2e 由 RH3 D6 接续)

---

## 5. 修订历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| `r1` | `2026-04-29` | `Owner + Opus 4.7` | RH1 Phase 6 evidence 初版 |
