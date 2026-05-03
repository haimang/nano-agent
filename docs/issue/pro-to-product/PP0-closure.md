# PP0 Charter & Truth Lock — Closure

> 服务业务簇: `pro-to-product / PP0 — Charter & Truth Lock`
> 上游 action-plan: `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md`
> 上游 design:
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> 冻结决策来源: `docs/design/pro-to-product/PPX-qna.md` Q1-Q5
> 闭环日期: `2026-05-03`
> 文档状态: `closed`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| PP0 当前状态 | `closed` |
| Truth registry | `frozen`：7 truth gates 是唯一 hard exit；phase sub-gate 只能映射到 7 gates，不能新增平行 exit law |
| Frontend boundary | `frozen`：frontend 只依赖 `orchestrator-core` facade、documented WS frames、runtime/read-model 与 `clients/api-docs` |
| E2E skeleton | `live`：`PATCH /sessions/{id}/runtime` → `session.runtime.update` WS frame → `GET /sessions/{id}/runtime` durable read-model 已由 preview live owner-file 验证 |
| Latency alert | `recorded`：本轮 live evidence `first_visible=531ms`，`terminal_or_degraded=762ms`，未超过 `pp0-runtime-baseline-visible-ms=5000ms` |
| PP1 handoff | `ready`：PP1 可在本 closure 的 truth gate、evidence shape、frontend boundary 之上启动 |

---

## 1. Resolved 项

| ID | 描述 | Verdict | 证据 |
|----|------|---------|------|
| `P1-01` | 7 truth gates 与 closure law 冻结 | `closed` | `docs/design/pro-to-product/PPX-qna.md` Q1-Q5；PP0 action-plan §6 |
| `P1-02` | frontend public/internal boundary 冻结 | `closed` | `01-frontend-trust-contract.md` §2-§5；`PPX-qna.md` Q3/Q5 |
| `P2-01` | PP0 skeleton owner file 落地 | `closed` | `test/cross-e2e/16-pro-to-product-baseline-skeleton.test.mjs` |
| `P2-02` | skeleton 输出统一 evidence shape | `closed` | live 输出 `PP0_EVIDENCE {...}`，字段覆盖 `transport / trace_uuid / start_ts / first_visible_ts / terminal_or_degraded_ts / verdict / latency_alert` |
| `P2-03` | runtime.update live delivery 缺口修复 | `closed` | `workers/orchestrator-core/src/wsemit.ts` 新增 awaited delivery helper；`session-runtime.ts` 对 `session.runtime.update` 使用 awaited forward |
| `P3-01` | FE-1 handoff 内容形成 | `closed-with-owner-action` | 本 closure §4/§7 给出 minimum state inputs 与 frontend owner-action |
| `P3-02` | PP1 start gate 明确 | `closed` | 本 closure §8 |

---

## 2. Live Evidence

```json
{
  "phase": "PP0",
  "scenario": "runtime-control-baseline",
  "transport": ["HTTP", "WS"],
  "trace_uuid": "4e0e972c-bdaa-4285-9889-5fa975eb001b",
  "start_ts": "2026-05-03T02:58:27.829Z",
  "first_visible_ts": "2026-05-03T02:58:28.360Z",
  "terminal_or_degraded_ts": "2026-05-03T02:58:28.591Z",
  "verdict": "live",
  "runtime_version": 2,
  "coverage": {
    "http_control_path": "PATCH /sessions/{id}/runtime",
    "ws_event_path": "session.runtime.update",
    "durable_read_model": "GET /sessions/{id}/runtime",
    "pending_extensions": [
      "pending-PP1-hitl",
      "pending-PP2-context-budget",
      "pending-PP3-reconnect",
      "pending-PP4-hook"
    ]
  },
  "latency_ms": {
    "first_visible": 531,
    "terminal_or_degraded": 762
  },
  "latency_alert": {
    "threshold_key": "pp0-runtime-baseline-visible-ms",
    "threshold_ms": 5000,
    "exceeded_count": 0,
    "accepted_by_owner": false,
    "repro_condition": "NANO_AGENT_LIVE_E2E=1 pnpm test:cross-e2e -- test/cross-e2e/16-pro-to-product-baseline-skeleton.test.mjs"
  }
}
```

---

## 3. PP0 中发现并修复的真实断点

1. **preview D1 migration 缺口**：`015-tool-call-ledger.sql`、`016-session-runtime-config.sql`、`017-team-permission-rules.sql` 在 preview 尚未全部应用；已通过 `wrangler d1 migrations apply NANO_AGENT_DB --env preview --remote` 应用。
2. **preview queue 缺口**：`nano-agent-executor-preview` 不存在，导致 orchestrator-core preview deploy 失败；已创建该 queue 并重新部署。
3. **runtime.update delivery 缺口**：`session-runtime.ts` 原本通过 fire-and-forget UserDO fetch 推送 `session.runtime.update`，live 环境中 PATCH 已成功但前端 WS 收不到 frame；已改为 awaited UserDO forward，保持 response body 不变，不让推送失败回滚 runtime row commit。
4. **skeleton session mint 前置缺口**：`/runtime` 依赖 durable session truth，不能直接对随机 UUID `/start`；skeleton 已改为先 `POST /me/sessions` mint pending session，再使用返回的 `start_url` 启动。
5. **skeleton WS race 缺口**：PATCH 前必须先注册 runtime update listener，并等待首个 WS frame 确认 frontend-visible attachment ready；skeleton 已覆盖该纪律。

---

## 4. FE-1 Handoff

| 项目 | PP0 结论 |
|------|----------|
| 前端 public owner | `orchestrator-core` facade |
| 最小 state inputs | session identity、HTTP control response、WS frame、runtime read-model、trace_uuid、latency evidence |
| internal-only seam | service binding RPC、worker-to-worker helper、D1 implementation detail 不进入 client contract |
| 本轮 pending owner-action | 需要前端 owner 在 PP1/PP3/PP6 前确认：当前 minimum state inputs 是否足够支撑 pending / active / degraded / runtime-change UI |

---

## 5. 下游 PP1 Start Gate

PP1 可以启动，前提如下：

1. 继续消费 `PPX-qna.md` Q6-Q8，不重开 PP0 的 hard-exit 讨论。
2. 使用本 closure 的 evidence shape 与 latency alert 字段作为 closure 输出格式。
3. 不把 PP0 skeleton 的 runtime control 链路误解为 HITL 已闭合；PP1 仍需独立证明 `approval_policy=ask` 进入 pause-resume，而不是 error-out。
4. 若 PP1 需要扩展 e2e，可复用 `test/cross-e2e/16-pro-to-product-baseline-skeleton.test.mjs` 的 mint → start → ws-ready → live evidence 结构。

---

## 6. 验证记录

| 命令 / 操作 | 结果 |
|-------------|------|
| `.npmrc` auth rule check + `NODE_AUTH_TOKEN` presence | ✅ pass |
| `npm whoami --registry=https://npm.pkg.github.com` | ✅ `haimang` |
| `npm view @haimang/nacp-core version --registry=https://npm.pkg.github.com` | ✅ `1.6.0` |
| GitHub package endpoint `curl -sSI -H "Authorization: Bearer $NODE_AUTH_TOKEN" https://npm.pkg.github.com/@haimang%2Fnacp-core` | ✅ HTTP `200` |
| GitHub token scope check via `https://api.github.com/user` | ✅ includes `write:packages` |
| `npx wrangler whoami` | ✅ logged in |
| `wrangler d1 migrations apply NANO_AGENT_DB --env preview --remote` | ✅ applied preview 015/016/017 |
| `npx wrangler queues create nano-agent-executor-preview` | ✅ created missing preview queue |
| `pnpm --filter @haimang/orchestrator-core-worker test -- session-runtime-route.test.ts` | ✅ 4 tests pass |
| `pnpm --filter @haimang/orchestrator-core-worker typecheck` | ✅ pass |
| `pnpm --filter @haimang/orchestrator-core-worker build` | ✅ pass |
| `SKIP_D1_MIGRATIONS=1 bash scripts/deploy-preview.sh orchestrator-core` | ✅ deployed preview version `c5de296f-fbcf-4392-bd91-d0f70cf38ad4` |
| `NANO_AGENT_LIVE_E2E=1 node --test test/cross-e2e/16-pro-to-product-baseline-skeleton.test.mjs` | ✅ 1 live test pass |
| Independent code review | ✅ no significant issues found after final PP0 changes |

---

## 7. Known Issues / Not-Touched

1. `PP1 HITL`、`PP2 context budget`、`PP3 reconnect`、`PP4 hook` 都只是 `pending-PP*` extension，不计入 PP0 完成。
2. FE-1 仍需真实 frontend owner 确认；本 closure 只提供后端 handoff，不伪造“前端已确认”。
3. `.npmrc` 的 `always-auth=true` 在当前 npm 版本会打印 warning，但不影响本轮 GitHub Packages 读写权限验证。
4. `scripts/deploy-preview.sh orchestrator-core` 本身不执行 `pnpm build`；本轮部署前已显式执行 build。后续部署若依赖 TypeScript 变更，必须先 build。

---

## 8. 收尾签字

- PP0 已按 action-plan 完成 truth lock、frontend boundary、live e2e skeleton 与 closure 输出。
- PP0 没有提前实现 PP1-PP4 主线；它只提供可复用 evidence skeleton。
- `p2p-pp1-code` 可以在 `p2p-pp0-closure` 完成后按串行 todo 启动。
