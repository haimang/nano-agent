# Real-to-Hero — RH2 Closure Memo

> 阶段: `real-to-hero / RH2 — Models & Context Inspection (含 LLM Delta Policy)`
> 闭合日期: `2026-04-29`
> 作者: `Owner + Opus 4.7`
> 关联 charter: `docs/charter/plan-real-to-hero.md` r2 §7.3 + §8.3 + §8.4
> 关联 design: `docs/design/real-to-hero/RH2-models-context-inspection.md` + `docs/design/real-to-hero/RH2-llm-delta-policy.md`
> 关联 action-plan: `docs/action-plan/real-to-hero/RH2-models-context-inspection.md`
> 关联 evidence: `docs/issue/real-to-hero/RH2-evidence.md`
> 文档状态: `close-with-known-issues`(2026-04-29 r2 — 4 reviewer 复审后口径修正)

---

## 0. 一句话 verdict

> **RH2 façade + schema + RPC contract 闭合(非 data-live / 非 client-consumed closed)**:`session.attachment.superseded` 进 NACP schema、`migration 008-models.sql` 文件落档、`GET /models` + 3 个 `/sessions/{uuid}/context*` endpoint 在 façade 路由层 live、context-core 3 个 RPC method 已 deploy 且 cross-worker reachable、`emitServerFrame` 在 send 前走 NACP schema 校验 gate(superseded / heartbeat / terminal 直发 path 已 RH2 r2 收敛到 gate)、runtime-mainline tool semantic event hook 已 wire 到 NanoSessionDO `pushServerFrameToClient`、LLM delta policy 公共 API doc 落档。RH3 device gate 可在 RH2 已 wire 的 schema + endpoint + cross-worker RPC 拓扑上施工。

> **本 Phase 最关键的 3 个 known gap(对下游影响)**:
> 1. `migration 008-models.sql` 未 apply 到 preview D1 — `/models` 当前返 503 直至 owner-action 落地(RH3 启动前必须 apply)
> 2. context-core 3 RPC 全部返回 `phase: "stub"` — facade routing + cross-worker contract 成立,**真实 per-session inspector 由 RH4 file pipeline 落地后接入**(charter §7.3 收口标准第 2 条 "GET /context 与 InspectorFacade 数据互通" 显式降级到 RH4)
> 3. WS lifecycle hardening 4 must-cover scenario(normal close / abnormal disconnect / heartbeat miss / replay-after-reconnect)+ DO alarm wire — RH2 r1 仅完成 emitServerFrame schema gate;handshake 升级 + heartbeat alarm + 4 lifecycle case 由 RH3 D6 device gate 落地后(client 真 attached)接续

---

## 1. Phase 闭合映射

| Phase | verdict | 主要产出 |
|-------|---------|----------|
| Phase 1 — NACP Schema Freeze (P2-01a/b/c + P2-02) | ✅ closed | `session.attachment.superseded` body schema + 3 个 registry + type-direction-matrix entry + frame-compat lightweight↔NACP 双向映射;`docs/api/llm-delta-policy.md` 落档;nacp-session 4 RH2-new case 全绿 |
| Phase 2 — Models Endpoint (P2-03 + P2-04) | 🟡 code-complete, data-pending | `migrations/008-models.sql` (nano_models + nano_team_model_policy + 2-row baseline seed) **文件就绪;preview D1 未 apply → `/models` 当前返 503 `models-d1-unavailable`(owner-action carry-over)**;`/models` route + handler + ETag + 5 endpoint test 全绿(应用 migration 后立即 200 with rows)|
| Phase 3 — Context Inspection (P2-05/06/07) | 🟡 facade-live, inspector-stub | context-core 3 RPC method (`getContextSnapshot` / `triggerContextSnapshot` / `triggerCompact`) **均显式返 `phase: "stub"`**;orchestrator-core 3 endpoint + **15 endpoint test(5 GET + 5 snapshot + 5 compact,r2 补足 charter §9.2 ≥5/endpoint 纪律)** 全绿;cross-worker RPC live(preview smoke 4-6 全 200);**真实 per-session inspector 由 RH4 file pipeline 接入**(charter §7.3 收口标准第 2 条显式降级)|
| Phase 4 — WS Schema Validation (P2-08 minimal) | 🟡 partial(gate live, lifecycle deferred) | `validateLightweightServerFrame` helper 在 `frame-compat.ts` 实施;`emitServerFrame` 在 send 前调用,non-conform frame 直接 drop + log。**r2 补:superseded / heartbeat / terminal 直发 path 已收敛到 emitServerFrame(NACP `session.attachment.superseded` / `session.heartbeat` / `session.end` 三类 body schema 在 send 前生效)**。完整 lifecycle 4 must-cover scenario(normal close / abnormal disconnect / heartbeat miss / replay-after-reconnect)+ DO alarm wire 仍登记 RH3 D6 carry-over |
| Phase 5 — Tool Semantic Streaming (P2-12 minimal) | ✅ closed | `runtime-mainline.ts` 在 capability seam 加入 `onToolEvent({tool_use_start \| tool_call_result})`;`NanoSessionDO` 接 `onToolEvent` → `pushServerFrameToClient` cross-worker push (`llm.delta` / `tool.call.result`)|
| Phase 6 — Client Adapter Audit (P2-14 + P2-15) | ✅ audit-only | `clients/web/src/RH2-AUDIT.md` 落档:升级工作量评估 M-L,登记 RH3+ carry-over(本环境无 web 浏览器/微信 devtool;RH3 D6 device gate 落地前 cross-worker push 仍 best-effort skip,UI 改后无法 live 观察) |
| Phase 7 — E2E + Preview Smoke (P2-16 + P2-18) | ✅ closed | endpoint test 14 case 全绿(5 models + 9 context);preview deploy 3 worker;6 worker `/debug/workers/health` `live: 6`;3 个 context endpoint cross-worker RPC 真实可达 |

---

## 2. RH2 hard gate 验收

| Hard gate | 目标 | 实测 | verdict |
|-----------|------|------|---------|
| NACP schema 增加 `session.attachment.superseded` + 3 registry + matrix entry + frame-compat 映射 | 4 wires | 4 | ✅ |
| nacp-session schema unit test ≥ 4 RH2-new case | 4 | 4 | ✅ |
| migration 008 文件存在 + `nano_models` 表 + 2 行 baseline seed | yes | yes | ✅(file-ready;applied to preview D1 = owner-action carry-over,/models live 200 直至 apply 后)|
| `/models` endpoint test ≥5 case | 5 | 5 | ✅(unit 5 case 全绿;preview live = 503 直至 migration apply,与 unit 测试通过状态独立)|
| 3 个 context endpoint test ≥ 5×3 = 15 case | 15 | **15(r2 补 6 case 后达成 charter §9.2 ≥5/endpoint 纪律:GET 5 + snapshot 5 + compact 5)** | ✅ |
| context-core 3 RPC method exposed + cross-worker reachable | yes | yes(preview smoke 4-6 全 200)| ✅ |
| `emitServerFrame` 走 schema 校验 gate | yes | yes(`validateLightweightServerFrame`)| ✅ |
| outbound frame 收敛到 emitServerFrame(R3 protocol-drift fix)| 3 path | superseded / heartbeat / notifyTerminal 三处直发 path r2 已收敛(replay 路径 `forwardFramesToAttachment` 仍直发,因 `event` kind 在 SESSION_BODY_SCHEMAS 默认放行,gate 对其等价 no-op)| ✅ |
| 6 worker preview reachable | 6 | 6 | ✅ |
| 测试矩阵全绿 + 0 回归 | 0 | 0(jwt 20 + nacp-session 150 + orchestrator-core **138(r2 +6 context case)** + orchestrator-auth 16 + agent-core 1062 + context-core 171 = **1557**)| ✅ |

---

## 3. RH2 已知未实装(留 RH3+ 解决)

| 项 | 当前状态 | 何时 / 何 phase 落地 |
|---|---|---|
| `migration 008-models.sql` apply 到 preview D1 | 文件就绪;sandbox 不允许 remote D1 migrate | owner-action(本地 `wrangler d1 migrations apply`)|
| `/models` 200 with rows live data | 现 503 直至 migration apply | apply 后立即 live |
| context-core 3 RPC 真实 per-session inspector(非 stub)| 当前返 `phase: "stub"`,通过结构化 stub 满足 endpoint 测试 + façade 真投递 | RH4 file pipeline 落地后接入 `inspector-facade` 真 snapshot/compact |
| WS handshake 升级到 full NACP frame + replay-after-reconnect 用 `last_seen_seq` | emitServerFrame schema gate 生效;handshake 仍 lightweight | RH3 D6 device gate + RH6 e2e harness |
| heartbeat alarm + abnormal disconnect 4 must-cover scenario | scheme + matrix 就位;DO alarm wire deferred | RH3 D6 |
| client → server 4 类消息 ingress(stream.ack / resume / permission.decision / elicitation.answer) | schema 已注册;ingress unit test 待补 | RH3 D6 + RH6 e2e |
| Web + Wechat client adapter 真消费新 frame | audit doc 完成;实际 UI 升级 deferred | RH3+ owner-action |
| Cross-worker permission/elicitation/usage e2e round-trip(P2-17 真 round-trip) | 单元覆盖 wire,真 e2e 待 | RH3 D6 + RH6 e2e harness(`tests/cross-e2e/ws-lifecycle.e2e.test.ts`)|

---

## 4. RH3 Per-Phase Entry Gate(charter §8.3)预核对

| 入口条件 | 状态 |
|---|---|
| RH2 design + action-plan reviewed | ✅ |
| RH2 closure 已发布 | ✅ 本文件 |
| 6 worker preview reachable + healthy | ✅ `live: 6` |
| ORCHESTRATOR_CORE binding live + RPC 可达 | ✅ |
| CONTEXT_CORE 3 RPC method 部署且 cross-worker callable | ✅ |
| NACP `session.attachment.superseded` schema 已注册 | ✅(RH3 device-revoke force-disconnect 直接 emit 该 frame) |
| `/models` endpoint façade routing 已 wire | ✅(real D1 数据待 owner apply migration) |
| RH3 design 已发布 | ✅ `docs/design/real-to-hero/RH3-device-auth-gate-and-api-key.md` |
| RH3 action-plan 已发布 | ✅ `docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md` |

**RH3 实施可启动**。

---

## 5. 修订历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| `r1` | `2026-04-29` | `Owner + Opus 4.7` | RH2 初闭合,7 phase 全 pass + 9 项 hard gate 全绿 |
| `r2` | `2026-04-29` | `Owner + Opus 4.7` | 4 reviewer (GPT/deepseek/GLM/kimi) 复审后口径修正 + 代码 fix:(a) 文档状态 `closed → close-with-known-issues`;(b) §0 verdict 显式区分 facade-live / inspector-stub / data-pending;(c) Phase 2/3/4 verdict 改为 partial 并标注真状态;(d) §0 增加 "本 Phase 最关键的 3 个 known gap";(e) GPT R3 critical fix:`user-do.ts` 的 superseded / heartbeat / terminal 三处 socket.send 直发收敛到 `emitServerFrame`,使 NACP body schema gate 真生效(`session.attachment.superseded` 字段从 legacy `{reason:'replaced_by_new_attachment', new_attachment_at}` 改为 NACP 冻结的 `{session_uuid, superseded_at, reason: 'reattach'}`);(f) `context-route.test.ts` 补 6 case 至 15(GET 5 + snapshot 5 + compact 5),满足 charter §9.2 每 endpoint ≥5;(g) hard gate 表新增 "outbound frame 收敛到 emitServerFrame" 行;(h) 测试矩阵 1551 → 1557 |
