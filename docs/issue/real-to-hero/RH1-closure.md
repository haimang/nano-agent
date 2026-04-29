# Real-to-Hero — RH1 Closure Memo

> 阶段: `real-to-hero / RH1 — Lane F Live Runtime`
> 闭合日期: `2026-04-29`
> 作者: `Owner + Opus 4.7`
> 关联 charter: `docs/charter/plan-real-to-hero.md` r2 §7.2 + §8.3
> 关联 design: `docs/design/real-to-hero/RH1-lane-f-live-runtime.md`
> 关联 action-plan: `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md`
> 关联 evidence: `docs/issue/real-to-hero/RH1-evidence.md`
> 文档状态: `close-with-known-issues`(2026-04-29 r2 — 4 reviewer 复审后口径修正)

---

## 0. 一句话 verdict

> **RH1 wire-contract 闭合(非 e2e live closed)**:hook / permission / elicitation / usage 4 条 lane F side-channel 的代码 wiring + cross-worker RPC topology 已完成(scheduler emits hook_emit / runtime delegate routes to HookDispatcher / emit*Request 真发 frame via `pushServerFrameToClient` → ORCHESTRATOR_CORE.forwardServerFrameToClient → User DO `__forward-frame` → emitServerFrame / `/usage` strict snapshot zero-shape live)。**真投递到 attached client(permission/elicitation/usage 三链)由 RH3 D6 `IngressAuthSnapshot.user_uuid` 进入 NanoSessionDO 解锁;在此之前 `pushServerFrameToClient` 缺 `user_uuid` 时返回 `{delivered:false, reason:"no-user-uuid-for-routing"}`,这是预期的 best-effort skip 行为。** P1-10/P1-11/P1-12 三个 round-trip e2e 文件未实装,延后到 RH3 D6 + RH6 e2e harness。RH2 可在 RH1 已 wire 的 ORCHESTRATOR_CORE service binding + `forwardServerFrameToClient` RPC + WorkerEntrypoint default export 上施工(已 PASS,见 `RH2-closure.md`)。

> **本 Phase 最关键的 3 个 known gap(对下游影响)**:
> 1. `pushServerFrameToClient` 当前 100% 返回 `delivered:false` — 阻塞所有 lane F 真投递 e2e,RH3 D6 user_uuid 注入是 hard prereq
> 2. P1-10/P1-11/P1-12 round-trip e2e 文件不存在 — RH3 D6 落地后必须补;无此 e2e 不能宣称 "Lane F live runtime 闭合"
> 3. HookDispatcher 实例注入 NanoSessionDO 仍 deferred — seam + class 就位但 wire 不通到 PreToolUse / SessionStart 真 callsite

---

## 1. Phase 闭合映射

| Phase | verdict | 主要产出 |
|-------|---------|----------|
| Phase 1 — Hook Dispatcher Wiring (P1-01 + P1-02) | ✅ closed | `scheduler.ts` 加 `pendingHookEvents` + drain;`runtime-mainline.ts` `hook.emit` 改为 dispatcher delegate。13 + 5 共 18 case 全绿(RH1-new 6) |
| Phase 2 — Permission/Elicitation Frame Emit (P1-03 + P1-04) | 🟡 wire-only | `nano-session-do.ts` emit*RequestAndAwait 在 await 前 push frame via `pushServerFrameToClient`;**真投递返 `delivered:false` 直至 RH3 D6 user_uuid 注入**;P1-06b 的 `validateSessionFrame` schema 校验在 RH2 P2-08 `validateLightweightServerFrame` 中补做(责任归属 shift,见 RH1 action-plan §9 注释)|
| Phase 3 — Cross-Worker WS Push RPC (P1-06a + P1-06b + P1-07) | ✅ closed(wire) | `agent-core/wrangler.jsonc` 新增 ORCHESTRATOR_CORE binding;`orchestrator-core/src/entrypoint.ts` 新建 default export `WorkerEntrypoint` 暴露 `forwardServerFrameToClient` RPC;`orchestrator-core/src/user-do.ts` 新增 `__forward-frame` 内部路由;`agent-core/src/host/env.ts` SessionRuntimeEnv 新增 ORCHESTRATOR_CORE 类型 |
| Phase 4 — Usage Push Live (P1-08) | 🟡 wire-only(best-effort skip) | `nano-session-do.ts` `onUsageCommit` 接 `pushServerFrameToClient(session.usage.update)` 走 `void` fire-and-forget(与 charter §4.4 + design §6.1 best-effort 纪律一致);真投递同 Phase 2 受 user_uuid 封锁 |
| Phase 5 — Usage Strict Snapshot No-Null (P1-09) | ✅ closed | `user-do.ts:handleUsage` no-rows 改为 zero-shape;D1 fail 改为 503 facade error;3 case 单测全绿(`usage-strict-snapshot.test.ts`)+ 真实 preview 验证 zero-shape live |
| Phase 6 — Cross-Worker E2E + Preview Smoke (P1-13) | 🟡 partial | preview deploy `orchestrator-core` Version `34cfc8a6...` + `agent-core` Version `de2fd54f...`;6 worker `/debug/workers/health` `live: 6 total: 6`;business chain smoke pass(register → start → usage zero-shape)。**P1-10/P1-11/P1-12 三个 round-trip e2e 文件 *未实装*(missing,非 deferred-with-stub)**;单元测试仅覆盖 wire 正确性,RH3 D6 user_uuid 落地后必须补 3 个 `tests/cross-e2e/*.e2e.test.ts` 才能宣称 Lane F live runtime 闭合 |

---

## 2. RH1 hard gate 验收

| Hard gate | 目标 | 实测 | verdict |
|-----------|------|------|---------|
| scheduler hook_emit drain 单测 ≥3 case | 3 | 4 | ✅ |
| runtime-mainline dispatcher delegate 单测 | mock-injected | 2 RH1-new case | ✅ |
| usage strict snapshot 单测 ≥3 case | 3(has-rows / no-rows / D1-fail)| 3 | ✅ |
| agent-core ORCHESTRATOR_CORE binding 在 dry-run env 可见 | yes | yes | ✅ |
| orchestrator-core default export 是 WorkerEntrypoint | yes | yes(`OrchestratorCoreEntrypoint`) | ✅ |
| `forwardServerFrameToClient` RPC 在部署后存在 | yes | yes(已 deploy `34cfc8a6`)| ✅ |
| 6 worker preview `/debug/workers/health` `live=6` | 6 | 6 | ✅ |
| `/sessions/{uuid}/usage` no-rows zero-shape live | 0/0/0 | confirmed live(zero-shape return)| ✅ |
| 既有测试矩阵 0 回归 | 0 | 0(jwt-shared 20 / orchestrator-auth 16 / orchestrator-core 118 / agent-core 1062 = 1216 全绿) | ✅ |

---

## 3. RH1 已知未实装(留 RH3+ 解决)

| 项 | 当前状态 | 何时 / 何 phase 落地 |
|---|---|---|
| `pushServerFrameToClient` 真投递 | wire 完整,缺 user_uuid 解析(NanoSessionDO 当下未持有 user_uuid)| RH3 D6 — IngressAuthSnapshot.user_uuid 进入 NanoSessionDO |
| permission/elicitation round-trip 真 e2e | 单元覆盖 wire,真投递 e2e 待 user_uuid 落地 | RH3 D6 / RH6 e2e harness |
| usage push 多次顺序 e2e | 单元覆盖,真观察待 attached client 投递 | RH3 D6 |
| `nano_user_devices` D1 schema gap(/me/devices 500)| pre-existing | RH3 D6 device migration |
| `nano_conversation_sessions_old_v6` D1 schema gap(timeline LLM_POSTPROCESS_FAILED)| pre-existing | ZX5 schema cleanup(独立 PR)|
| HookDispatcher 实例注入 NanoSessionDO | seam 就位 + dispatcher 类已建,实例注入 deferred | RH3+(把 PreToolUse / SessionStart hook 接 emit*RequestAndAwait 时,把 dispatcher 注入 createMainlineKernelRunner)|

---

## 4. RH2 Per-Phase Entry Gate(charter §8.3)预核对

| 入口条件 | 状态 |
|---|---|
| RH1 design + action-plan reviewed | ✅ |
| RH1 closure 已发布 | ✅ 本文件 |
| 6 worker preview reachable + healthy | ✅ `live: 6` |
| ORCHESTRATOR_CORE service binding live | ✅(为 RH2 `/sessions/{uuid}/context/snapshot/compact` 跨 worker push 留下入口)|
| WorkerEntrypoint default export ready for new RPC | ✅(RH2 加 `triggerContextSnapshot` 等 RPC 直接挂在同一 entrypoint)|
| RH2 design 已发布 | ✅ `docs/design/real-to-hero/RH2-models-context-inspection.md` |
| RH2 action-plan 已发布 | ✅ `docs/action-plan/real-to-hero/RH2-models-context-inspection.md` |

**RH2 实施可启动**。

---

## 5. 修订历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| `r1` | `2026-04-29` | `Owner + Opus 4.7` | RH1 初闭合,6 phase 全 pass + hard gate 9 项全绿 |
| `r2` | `2026-04-29` | `Owner + Opus 4.7` | 4 reviewer (GPT/deepseek/GLM/kimi) 复审后口径修正:(a) 文档状态 `closed → close-with-known-issues`;(b) §0 verdict 显式区分 wire-contract vs e2e-live;(c) Phase 2/4/6 verdict 改为 wire-only / partial 并标注真投递缺 user_uuid;(d) §0 增加 "本 Phase 最关键的 3 个 known gap";(e) Phase 2 备注 P1-06b schema 校验 shift 到 RH2 P2-08 |
