# F4 Closure — Authority Hardening

> 阶段: `orchestration-facade / F4`
> 状态: `closed`
> 作者: `GPT-5.4`
> 时间: `2026-04-24`
> 对应 action-plan: `docs/action-plan/orchestration-facade/F4-authority-hardening.md`
> 直接解锁: `docs/action-plan/orchestration-facade/F5-closure-and-handoff.md`

---

## 1. 结论

F4 已达到关闭条件。

`orchestrator-core` 的 public ingress 与 `agent-core` 的 guarded internal ingress 现在都经过显式 authority / tenant / trace legality layer；`bash-core` 也具备执行前 recheck seam，first-wave 的 single-tenant-per-deploy truth 已从 design 口径落成实际 runtime / preview 行为。

---

## 2. 实际交付

1. 新增 `workers/orchestrator-core/src/policy/authority.ts`，集中提供 `TEAM_UUID` bootstrap check、`trace_uuid` 读取与 typed policy reject helper。
2. `workers/orchestrator-core/src/auth.ts` 现在强制要求 public ingress 显式提供 `x-trace-uuid` 或 `trace_uuid` query，并在 tenant claim 与 deploy tenant 不一致时返回 typed reject。
3. 新增 `workers/agent-core/src/host/internal-policy.ts`，把 internal secret、trace law、authority header、body/header no-escalation 与 tenant truth 收束到统一校验入口。
4. `workers/orchestrator-core/src/user-do.ts` 现在会对 internal calls 显式转发 `x-trace-uuid` 与 `x-nano-internal-authority`，并在缺少 persisted auth snapshot 时 fail-closed。
5. `workers/bash-core/src/executor.ts` 已新增 `beforeCapabilityExecute()` seam，固定落点为 `policy.check(plan)` 之后、target lookup 之前；`workers/bash-core/src/worker-runtime.ts` 现在实际通过 `CapabilityExecutor` 路径执行 request/cancel，所以 seam 已进入 production runtime path，但当前未配置额外 recheck provider。
6. 五个 worker 的 `wrangler.jsonc` 现都显式配置 `TEAM_UUID = "nano-agent"`；preview / prod 不再依赖 `_unknown` 心智。
7. negative coverage 已补齐到 worker tests 与 live package-e2e：missing trace、tenant mismatch、internal invalid authority / escalation、executor recheck fail-closed。

---

## 3. 验证证据

### 3.1 本地验证

以下验证已通过：

1. `pnpm --filter @haimang/orchestrator-core-worker test`
2. `pnpm --filter @haimang/agent-core-worker test`
3. `pnpm --filter @haimang/bash-core-worker test`
4. `pnpm --filter @haimang/orchestrator-core-worker typecheck`
5. `pnpm --filter @haimang/orchestrator-core-worker build`
6. `pnpm --filter @haimang/agent-core-worker typecheck`
7. `pnpm --filter @haimang/agent-core-worker build`
8. `pnpm --filter @haimang/bash-core-worker typecheck`
9. `pnpm --filter @haimang/bash-core-worker build`
10. `pnpm test:cross`
11. `pnpm --filter @haimang/orchestrator-core-worker deploy:dry-run`
12. `pnpm --filter @haimang/agent-core-worker deploy:dry-run`
13. `pnpm --filter @haimang/bash-core-worker deploy:dry-run`
14. `pnpm --filter @haimang/context-core-worker deploy:dry-run`
15. `pnpm --filter @haimang/filesystem-core-worker deploy:dry-run`

### 3.2 Preview deploy + live proof

Preview 已重新部署：

1. `orchestrator-core`
2. `agent-core`
3. `bash-core`
4. `context-core`
5. `filesystem-core`

本轮为 live suite 临时旋转了 preview `orchestrator-core` 的 `JWT_SECRET`，并用同值驱动本地签发；secret 未写入仓库。

通过结果：

1. `NANO_AGENT_LIVE_E2E=1 pnpm test:package-e2e` → `35 / 35 pass`
2. `NANO_AGENT_LIVE_E2E=1 pnpm test:cross` → `46 / 46 pass`
3. `rg "@nano-agent/capability-runtime|packages/capability-runtime" workers packages` → 代码面未发现仍在消费 `packages/capability-runtime` runtime API 的 worker/package caller（仅剩 bash-core 自身注释与 package 本体）

---

## 4. Exit criteria 对照

| F4 exit 条件 | 结果 |
| --- | --- |
| centralized public/internal legality helper 已落地 | ✅ |
| `TEAM_UUID` single-tenant deploy truth 已成为 preview/runtime reality | ✅ |
| `tenant_source` snapshot 与 tenant mismatch reject 已可审计 | ✅ |
| no-escalation internal guard 已真实 enforce | ✅ |
| `CapabilityExecutor` recheck seam 已固定落点并 fail-closed | ✅ |
| negative evidence 已覆盖 public/internal/runtime 三层 | ✅ |

> 说明：F4 action-plan 原计划包含一个短暂的 probe marker 过渡态；由于 F5 在同一执行链内紧接着启动，当前仓库 HEAD 已直接显示终态 marker `orchestration-facade-closed`。

---

## 5. 最终 verdict

**F4 closed.**

现在 `orchestrator-core` 不再只是 public façade，还是 first-wave legality owner；`agent-core` 的 internal surface 也不再只靠 shared secret 维持“默认可信”。后续若要引入 credit / quota / revocation，应沿 `beforeCapabilityExecute()` 与现有 authority helpers 扩展，而不是重开 ingress / executor 主路径。
