# Z2 Closure — Session Truth and Audit Baseline

> 阶段: `zero-to-real / Z2`
> 状态: `closed`
> 作者: `GPT-5.4`
> 时间: `2026-04-25`
> 对应 action-plan: `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`
> 直接解锁: `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`

---

## 1. 结论

Z2 已达到 action-plan 约定的关闭条件，并在 review-followup 中补上了第一轮 schema / replay / parity hardening。

zero-to-real 现在已经不再只是拥有“public session façade + transient replay”的过渡层，而是拥有一条真实的 session durable truth baseline：**Wave B D1 schema、conversation/session/turn/message/context/activity durable owner、DO 最小 hot-state、append-only activity log、以及 `status/start` 的 RPC kickoff 已经在 preview runtime 上被证实。**

---

## 2. 实际交付

1. 新增 `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql` 与 `003-session-truth-hardening.sql`，落下并加固：
    - `nano_conversations`
    - `nano_conversation_sessions`
    - `nano_conversation_turns`
    - `nano_conversation_messages`
    - `nano_conversation_context_snapshots`
    - `nano_session_activity_logs`
   - Wave B hardening：activity nullable lineage、`payload<=8KB`、FK / UNIQUE /补充索引、`view_recent_audit_per_team`
2. 新增 `workers/orchestrator-core/src/session-truth.ts`，把 session/conversation/turn/message/context/activity 的 D1 持久化收束到独立 repository。
3. `workers/orchestrator-core/src/user-do.ts` 已接入：
   - public `history` route
   - durable `timeline/status/verify` augment
   - append-only activity log
   - `conversation/index + active-pointers + recent-frames + cache/*` 四组 hot-state
   - `10m` alarm trim/refresh 入口
4. `workers/agent-core/src/index.ts` 已恢复真实 `WorkerEntrypoint` runtime，并具备 `status()` / `start()` RPC surface；测试侧通过 vitest alias shim 保持非 Cloudflare 环境可运行。
5. `workers/agent-core/src/host/do/nano-session-do.ts` 已开始锁存 session-owned `team_uuid`，并把 checkpoint/trace/evidence anchor 从 deploy-local team 锚转向 session truth。
6. `workers/agent-core/src/host/internal-policy.ts` 不再把 worker-local `TEAM_UUID` 作为 internal authority 的唯一 tenant truth，而是改成 header/body no-escalation + payload 自洽校验。
7. `workers/orchestrator-core/src/auth.ts` 已修正：
   - HTTP ingress 默认拒绝 query `access_token`
   - `ws` compatibility 保留 query token
   - `tenant_source` 从 truthy-check 修正为 source-check
8. `workers/orchestrator-auth/src/wechat.ts` 的 retry 已收紧为 network/timeout/5xx。
9. preview 环境已新增真实 `nano-agent-preview` D1，并完成 Wave A + Wave B migrations remote apply。

---

## 3. 关键验证证据

### 3.1 本地验证

1. `pnpm --filter @haimang/orchestrator-core-worker typecheck`
2. `pnpm --filter @haimang/orchestrator-core-worker build`
3. `pnpm --filter @haimang/orchestrator-core-worker test`
4. `pnpm --filter @haimang/agent-core-worker typecheck`
5. `pnpm --filter @haimang/agent-core-worker build`
6. `pnpm --filter @haimang/agent-core-worker test`
7. `pnpm --filter @haimang/orchestrator-auth-worker typecheck`
8. `pnpm --filter @haimang/orchestrator-auth-worker build`
9. `pnpm --filter @haimang/orchestrator-auth-worker test`

### 3.2 Preview infra / migration evidence

1. `npx wrangler whoami`
2. `npx wrangler d1 create nano-agent-preview`
3. `cd workers/orchestrator-core && npx wrangler d1 migrations apply NANO_AGENT_DB --env preview --remote`
4. `cd workers/orchestrator-auth && npx wrangler deploy --env preview`
5. `cd workers/orchestrator-core && npx wrangler deploy --env preview`
6. `cd workers/agent-core && npx wrangler deploy --env preview`

### 3.3 Live E2E evidence

1. `NANO_AGENT_LIVE_E2E=1 NANO_AGENT_ORCHESTRATOR_JWT_SECRET=<preview-key> pnpm test:package-e2e` → `36 / 36 pass`
2. `NANO_AGENT_LIVE_E2E=1 NANO_AGENT_ORCHESTRATOR_JWT_SECRET=<preview-key> pnpm test:cross-e2e` → `12 / 12 pass`

其中 live 证据已经覆盖：

- `agent-core` preview probe / legacy retirement envelope
- `orchestrator-auth` probe-only public posture
- `orchestrator-core` public start / ws attach / reconnect / verify / timeline / auth negatives
- `orchestrator-core -> agent-core -> bash-core` full roundtrip
- mid-session cross-worker capability call
- append path readback through `timeline/status/history`

---

## 4. Z2 exit criteria 对照

| Z2 目标 | 结果 |
| --- | --- |
| Wave B D1 schema 落地 | ✅ |
| public session durable truth 建立 | ✅ |
| append-only activity log + redaction discipline 落地 | ✅ |
| DO hot-state 收敛到四组最小集合 | ✅ |
| `status` RPC smoke + `start` kickoff parity 落地 | ✅ |
| preview live evidence 成立 | ✅ |
| Z2 closure 文档存在 | ✅ |

---

## 5. 仍需诚实记录的 residuals

1. `input/cancel/timeline/verify/stream` 仍主要走 fetch-backed internal seam；`status/start` 的 RPC kickoff 已不再复用 `/internal/*` router，但终点仍是 Session DO fetch fallback，不是 DO RPC。
2. `nano_session_activity_logs` 当前已经 append-only、具备 redaction wrapper、FK / UNIQUE /关键索引与 8KB guard，但 richer analytics / admin query plane 仍是后续运营阶段主题，不属于 Z2。
3. DO Alarm 现在会 trim active `recent_frames` 与过期 `status/verify` cache；但 `reconnect cursor > 1h` 与 `JWT key / secret cache refresh` 仍未建模，属于后续 stateful uplift follow-up。
4. `deploy-fill` 兼容路径仍存在于 ingress/runtime contract；Z2 只完成了 session-owned `team_uuid` 锁存与恢复，没有在本轮完全退役 legacy fallback。
5. root `pnpm test:contracts` 仍被仓库既有的 `docs/nacp-session-registry.md` 缺失阻塞；这不是 Z2 本轮引入的问题，因此未被伪装成 Z2 blocker。
6. agent-core 仍未直接 bind `NANO_AGENT_DB`；Z2 的 durable truth owner 仍在 orchestrator façade / D1 repository，而不是下沉到 runtime worker 自己读写 D1。

---

## 6. 对 Z3 的直接价值

1. Z3 现在可以直接消费 `conversation/session/turn/message/activity` durable truth，而不必继续依赖 process-local replay。
2. quota / usage / runtime real-provider 接入可以直接写到现有 session/activity baseline，而不是再造一层独立 transcript。
3. 客户端 replay/heartbeat 交互已经有 durable truth + hot-state baseline，不需要重新定义 session truth owner。

---

## 7. 最终 verdict

**Z2 closed.**

这次最关键的变化不是“多了几张表”，而是 zero-to-real 第一次拥有了真正可部署、可回放、可审计、可继续扩展的 session truth baseline。Z3 不再需要解决“session 真相到底落在哪里”，而可以开始专注真实 runtime、quota、以及更强的 provider/runtime 约束。
