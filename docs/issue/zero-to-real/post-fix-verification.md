# Real-to-Hero — RH0 Post-Fix Preview Verification

> 阶段: `real-to-hero / RH0 / Phase 7 — P0-E1 + P0-E2`
> 执行人: `Owner + Opus 4.7`
> 执行日期: `2026-04-29`
> 关联 action-plan: `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md` §4.7
> 文档状态: `final`

---

## 0. 执行说明

本文件记录 RH0 Phase 7 的 preview deploy + manual smoke 证据,作为 RH0 Start Gate 与 RH1 入口的硬闸门收口。RH0 Phase 1-6 已全部 PASS;Phase 7 把 jwt-shared lockfile + 6-worker KV/R2 binding 占位 + endpoint test baseline + NanoSessionDO seam pre-split + bootstrap-hardening stress 一次性推到真实 Cloudflare preview 环境验证。

预期断点(已知,RH1 之前不可达):
- `permission/decision` 与 `elicitation/answer` 在 façade 层已 wire,但 User-DO 内部仍 `permissionDecision` / `elicitationAnswer` RPC stub(RH0 P0-E1 collateral 修了 type union;实际 cross-worker push 路径在 RH1)
- `onUsageCommit` 仍 console.log 输出(RH1 P1-D 接通 cross-worker push 后才真推 `session.usage.update` 帧)

---

## 1. Preview Deploy 记录

| Worker | Version ID | Trigger / URL | 状态 |
|--------|-----------|---------------|------|
| nano-agent-bash-core-preview | `f4657a4a-481b-4dbe-a4af-a14e313c28a3` | service binding only | ✅ uploaded |
| nano-agent-context-core-preview | `ee572bc0-f290-4234-a900-ebba41313ae4` | service binding only | ✅ uploaded |
| nano-agent-filesystem-core-preview | `07b2e3bf-ec7b-46d6-af46-7847d8d393ed` | service binding only | ✅ uploaded |
| nano-agent-agent-core-preview | `c959ba72-36cc-44d6-8c21-0da58b6ccf9c` | service binding only | ✅ uploaded |
| nano-agent-orchestrator-auth-preview | `43fc6c8a-0f23-4936-a93b-839e6c6aac55` | service binding only | ✅ uploaded |
| nano-agent-orchestrator-core-preview | `a8e0e21e-601f-413b-9aa0-7138a9935572` | https://nano-agent-orchestrator-core-preview.haimang.workers.dev | ✅ deployed (public facade) |

部署顺序:`bash-core → context-core → filesystem-core → agent-core → orchestrator-auth → orchestrator-core`(下游 / library worker 先,facade 最后)。

---

## 2. Smoke 证据

### Smoke 1 — orchestrator-core F3 probe(public facade reachable)

```
GET https://nano-agent-orchestrator-core-preview.haimang.workers.dev/
HTTP/1.1 200 OK
{
  "worker": "orchestrator-core",
  "nacp_core_version": "1.4.0",
  "nacp_session_version": "1.3.0",
  "status": "ok",
  "worker_version": "orchestrator-core@preview",
  "phase": "orchestration-facade-closed",
  "public_facade": true,
  "agent_binding": true
}
```
**verdict**:✅ pass(F3 探针返回 RH0 后期望 shape;`agent_binding=true` 表示 service binding 仍然挂得到 agent-core)

### Smoke 2 — `GET /catalog/skills`(facade-http-v1 envelope + non-empty registry)

```
GET https://nano-agent-orchestrator-core-preview.haimang.workers.dev/catalog/skills
x-trace-uuid: 33333333-3333-4333-8333-333333333333

200 OK
{ "ok": true, "data": { "skills": [
  { "name": "context-assembly", ..., "version": "1.0.0", "status": "stable" },
  { "name": "filesystem-host-local", ..., "version": "1.0.0", "status": "stable" },
  { "name": "bash-tool-call", ..., "version": "1.0.0", "status": "stable" }, ... ] }
}
```
**verdict**:✅ pass(envelope 形状、trace_uuid 透传、catalog 非空)

### Smoke 3 — `/debug/workers/health`(6-worker aggregate)

```
GET https://nano-agent-orchestrator-core-preview.haimang.workers.dev/debug/workers/health
{
  "ok": true,
  "environment": "preview",
  "generated_at": "2026-04-29T09:18:47.266Z",
  "summary": { "live": 6, "total": 6 },
  "workers": [
    { "worker": "orchestrator-core", "live": true, "status": "ok", ... },
    { "worker": "orchestrator-auth", "live": true, "status": "ok", "details": { "rpc_surface": true, "d1_binding": true } },
    { "worker": "agent-core", "live": true, "status": "ok", ... },
    { "worker": "bash-core", "live": true, "status": "ok", ... },
    { "worker": "context-core", "live": true, "status": "ok", ... },
    { "worker": "filesystem-core", "live": true, "status": "ok", ... }
  ]
}
```
**verdict**:✅ pass(`live: 6, total: 6` — 全 6 worker 跨 service binding 经 fetch 探针验证 reachable)

### Smoke 4 — bindings visibility(per worker dry-run output)

每个 worker 的 deploy 日志均显式列出:

```
env.NANO_KV (f5de37a4139a480683368d39ca4bbb62)                  KV Namespace
env.NANO_R2 (nano-agent-spike-do-storage-probe)                 R2 Bucket
env.NANO_AGENT_DB (nano-agent-preview)                          D1 Database  (4 worker:orchestrator-*, agent-core)
env.AI                                                           AI binding   (agent-core)
```

**verdict**:✅ pass(NANO_KV / NANO_R2 在 6 worker 都 visible;RH4 真实 binding 上线 = 直接换 placeholder id 即可)

### Smoke 5 — orchestrator-core ⇄ orchestrator-auth RPC reachability(via /debug)

orchestrator-auth 在 `/debug/workers/health` 中 `rpc_surface: true` + `d1_binding: true` 表明 service binding RPC 已建,D1 共享真相 reachable。

**verdict**:✅ pass

---

## 3. RH0 已知未实装(留 RH1+ 解决)

下述为 RH0 后期望仍 stub / 待补的功能,**不算 Phase 7 的失败**,而是 RH1 Per-Phase Entry Gate 后续工作:

1. `/sessions/{uuid}/permission/decision` — façade routing + auth + body validation 已建立(7 份 endpoint test 验证),User-DO 内部 `permissionDecision` RPC 仍未真 emit `session.permission.request` WS 帧 — 由 RH1 Phase 2 (P1-C) 接通
2. `/sessions/{uuid}/elicitation/answer` — 同上 — 由 RH1 Phase 2 (P1-C) 接通
3. `onUsageCommit` cross-worker push — agent-core → orchestrator-core RPC `forwardServerFrameToClient` 仍未实装 — 由 RH1 Phase 3-4 (P1-D) 接通
4. `/usage` 在无 rows 时仍可能返回 null placeholder — 由 RH1 Phase 5 (P1-E) 修整为 0/明确空快照
5. KV / R2 binding 仅占位声明,RH4 才真正消费 — 由 RH4 接通

---

## 4. 收口判定

| 收口标准 | 状态 |
|---------|------|
| 6 worker preview deploy 全 0 退出 | ✅ pass |
| Smoke 1-5 全 pass | ✅ pass |
| `live: 6, total: 6` 在 `/debug/workers/health` | ✅ pass |
| NANO_KV / NANO_R2 在 6 worker bindings 中 visible | ✅ pass |
| 已知未实装的 5 项均归档为 RH1+ scope(not RH0 failure) | ✅ documented |

**RH0 Phase 7 verdict**:✅ **PASS**

**RH1 Per-Phase Entry Gate(charter §8.3)**:
- ✅ RH0 design + action-plan 已发布且 reviewed(charter Start Gate 已满)
- ✅ RH0 closure 文件即将归档(本文件 + `docs/issue/real-to-hero/RH0-closure.md`)
- ✅ 6 worker preview deploy 健康,RH1 Lane F runtime wiring 可在已 reachable 的 service binding 拓扑上施工

---

## 5. 修订历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| `r1` | `2026-04-29` | `Owner + Opus 4.7` | RH0 Phase 7 初版,记录 6 worker preview deploy + 5 smoke pass |
