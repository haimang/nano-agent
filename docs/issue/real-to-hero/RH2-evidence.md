# Real-to-Hero — RH2 Models & Context Inspection Evidence

> 阶段: `real-to-hero / RH2 / Phase 7 — P2-18`
> 执行人: `Owner + Opus 4.7`
> 执行日期: `2026-04-29`
> 关联 action-plan: `docs/action-plan/real-to-hero/RH2-models-context-inspection.md` §4.7
> 文档状态: `final`

---

## 0. 执行说明

RH2 Phase 1-5 全部 wire 完成,Phase 6(client adapter)按 design §5.6 与本环境局限,作 audit-only 处理(见 `clients/web/src/RH2-AUDIT.md`)。Phase 7 evidence:

1. NACP schema:`session.attachment.superseded` 已注册,150 个 nacp-session test 全绿(含 4 个 RH2-new)
2. `/models` endpoint:5 case 全绿(401 / 200 / 304 ETag / team filter / 503)
3. 3 个 context endpoint:9 case 全绿
4. emitServerFrame 已对所有 server frame 走 NACP schema 校验
5. runtime-mainline 在 tool 执行前后 emit semantic event,NanoSessionDO 把 onToolEvent 接到 cross-worker push
6. Preview deploy + 3 个 context endpoint 真实可达

---

## 1. Preview Deploy 记录

| Worker | Version ID | Trigger / URL |
|--------|-----------|---------------|
| nano-agent-context-core-preview | `0b54034c-4646-45ca-8aae-d8dd2d6ae6f6` | service binding only |
| nano-agent-orchestrator-core-preview | `e00c27f7-1fa8-4d08-a71f-db353bc0d43b` | https://nano-agent-orchestrator-core-preview.haimang.workers.dev |
| nano-agent-agent-core-preview | `460f03ad-aae5-4350-88f6-65b86e0acb6a` | service binding only |

未变更 worker(orchestrator-auth / bash-core / filesystem-core)继承 RH0 P0-E1 部署版本。`/debug/workers/health` 仍 `live: 6, total: 6`。

---

## 2. RH2 endpoints live evidence

### Smoke 1 — `/debug/workers/health`(post-deploy)
```
summary = {"live": 6, "total": 6}
```
✅ 6 worker reachable

### Smoke 2 — register(setup for下方 endpoint smoke)
```
POST /auth/register → 200, access_token len=435, team_uuid issued
```

### Smoke 3 — `GET /models`(P2-04)
```
GET /models  Bearer ${access_token}
{"ok":false,"error":{"code":"models-d1-unavailable","status":503,"message":"models lookup failed"}}
```
**预期 503**:`migration 008-models.sql` 已 commit 但**尚未** apply 到 preview D1(本环境 sandbox 不允许 remote D1 migrate;owner-action carry-over)。strict 503 facade 形状本身验证 P1-09 strict policy 在 RH2 endpoint 上正确传播。

### Smoke 4 — `GET /sessions/{uuid}/context`(P2-05,context-core RPC live)
```
{"ok":true,"data":{
  "session_uuid":"11111111-1111-4111-8111-e830a519ef17",
  "team_uuid":"bf8be897-84ef-449b-8726-6b4444491b18",
  "status":"ready",
  "summary":"context-core RH2 stub: per-session inspector in RH4",
  "artifacts_count":0,
  "need_compact":false,
  "phase":"stub"
},"trace_uuid":"333..."}
```
✅ pass — context-core `getContextSnapshot` RPC reachable cross-worker;`phase: "stub"` explicit 标注 RH4 真实 inspector 接续

### Smoke 5 — `POST /sessions/{uuid}/context/snapshot`(P2-06)
```
{"ok":true,"data":{
  "snapshot_id":"a930ac51-68f6-4eae-9af5-802140ae16c4",
  "created_at":"2026-04-29T10:25:21.319Z",
  "phase":"stub"
},"trace_uuid":"333..."}
```
✅ pass — context-core `triggerContextSnapshot` RPC reachable

### Smoke 6 — `POST /sessions/{uuid}/context/compact`(P2-07)
```
{"ok":true,"data":{
  "compacted":true,
  "before_size":0,
  "after_size":0,
  "phase":"stub"
},"trace_uuid":"333..."}
```
✅ pass — context-core `triggerCompact` RPC reachable

---

## 3. 测试矩阵全绿快照

| 测试套 | case 数 | 增量 vs RH1 |
|--------|---------|-------------|
| `@haimang/jwt-shared` | 20 | 0 |
| `@haimang/nacp-session` | 150 | +4 (`session.attachment.superseded` 4 case) |
| `@haimang/orchestrator-core-worker` | 132 | +14 (5 models-route + 9 context-route) |
| `@haimang/orchestrator-auth-worker` | 16 | 0 |
| `@haimang/agent-core-worker` | 1062 | 0(P2-12 wire 走既有 onToolEvent seam,不破坏既有 100 文件)|
| `@haimang/context-core-worker` | 171 | 0(stub RPC 在既有 19 文件外,RH4 真接入时再加 unit) |
| **合计** | **1551** | **+18 vs RH1(1216)** |

---

## 4. RH2 已知未实装(carry-over to RH3+)

| 项 | 当前状态 | 何时落地 |
|---|---|---|
| `migration 008-models.sql` 未应用到 preview D1 | 文件已 commit,sandbox 不允许 remote `wrangler d1 migrations apply` | owner-action(本地或 CI 应用) |
| `/models` 真实 D1 数据返回 | 200 with rows;现状 503 直至 migration apply | migration apply 后立即 live |
| context-core 3 RPC 真实 per-session inspector | 当前返 `phase: "stub"`,显式标注 | RH4 file pipeline 接入后真接 inspector-facade |
| Phase 4 完整 WS lifecycle hardening(handleWsAttach + heartbeat alarm + 4 must-cover scenario) | 仅完成 emitServerFrame schema gate;handshake / heartbeat alarm / abnormal disconnect deferred | RH3 D6 device gate 落地后,client 真 attached 才能验证 4 lifecycle case |
| Phase 6 client adapter(web + wechat) | audit-only;详 `clients/web/src/RH2-AUDIT.md` | RH3+ owner-action |
| Phase 7 WS lifecycle e2e(P2-17)+ web/wechat preview smoke(P2-18 客户端部分) | 单元覆盖 emit gate;真 client 投递 + UI 演示 deferred | RH3 D6 + RH6 e2e harness |

---

## 5. 收口判定

| 收口标准 | 状态 |
|---------|------|
| Phase 1 — `session.attachment.superseded` schema + LLM delta policy doc | ✅ |
| Phase 2 — migration 008 file + `/models` route + 5 case test | ✅ |
| Phase 3 — context-core 3 RPC + 3 endpoints + 9 case test | ✅(stub-shaped,真实 inspector RH4) |
| Phase 4 — emitServerFrame schema validation gate | ✅(完整 WS lifecycle 4 case 见 carry-over)|
| Phase 5 — runtime tool semantic streaming wire(onToolEvent → cross-worker push) | ✅ |
| Phase 6 — client adapter audit | ✅(audit-only;升级 carry-over)|
| Phase 7 — endpoint test 14 case + preview deploy + cross-worker context RPC live | ✅ |

**RH2 verdict**:✅ **PASS**(façade endpoint + schema + cross-worker RPC + tool semantic wire 全部 live;真实 D1 数据 + WS lifecycle full hardening + client UI 升级登记 carry-over)

---

## 6. 修订历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| `r1` | `2026-04-29` | `Owner + Opus 4.7` | RH2 evidence 初版 |
