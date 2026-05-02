# HPX6 Workbench Controls — Closure

> 服务业务簇: `hero-to-pro / HPX6 — workbench-grade controls + new truth + Codex-style object layer`
> 上游 design: `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` v0.2.1
> 上游 action-plan: `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md`(已 executed,§9 含完整工作日志)
> 下游 handoff: `none`(hero-to-pro 内最终收口;但 executor deep semantics 见 §2)
> 闭环日期: `2026-05-02`
> 文档状态: `executed-with-followups`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| HPX6 当前状态 | **`executed-with-followups`**: F6/F8/F9/F10/F14/F15 已 live;F11/F12/F13 已有 Queue dispatch substrate,restore 可 terminal-drive,retry/fork deep semantics 仍需后续专项补齐 |
| Protocol / package | `@haimang/nacp-session@1.5.0` 已落地 5 个 HPX6 top-level frame schema |
| D1 truth | `015` tool-call ledger、`016` runtime config、`017` tenant permission rules 已落地 |
| Public HTTP/WS surface | `/runtime`、`/items`、tool-call list/detail/cancel、public WS `session.followup_input` 均已接通 |
| Legacy removal | `POST /sessions/{id}/policy/permission_mode` 已 hard-delete;User DO `permission_mode/*` KV 写入移除 |
| Executor | Cloudflare Queue producer/consumer 已接在 orchestrator-core 内,保持 6-worker topology;restore job 可从 pending→running→succeeded 并 emit `session.restore.completed` |
| Docs | clients/api-docs 扩为 22-doc pack,新增 runtime/items/tool-calls |
| 测试 | 受影响 package/worker typecheck/build/test、root `pnpm test`、docs consistency、cross-e2e topology gate 均通过 |

---

## 1. 已完成项

| ID | 描述 | 代码 / 文档证据 |
|----|------|----------------|
| R1 | HPX6 frame schema + registry | `packages/nacp-session/src/messages.ts`, `type-direction-matrix.ts`, `session-registry.ts`, `test/hpx6-workbench-messages.test.ts` |
| R2 | Tool-call D1 ledger | `workers/orchestrator-core/migrations/015-tool-call-ledger.sql`, `src/tool-call-ledger.ts`, `src/hp-absorbed-routes.ts`, `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` |
| R3 | Public WS `session.followup_input` 转发 | `workers/orchestrator-core/src/user-do/ws-runtime.ts`, `src/user-do-runtime.ts` |
| R4 | Runtime config control plane | `migrations/016-session-runtime-config.sql`, `src/runtime-config-plane.ts`, `src/facade/routes/session-runtime.ts` |
| R5 | Permission rules + PreToolUse decision seam | `migrations/017-team-permission-rules.sql`, `src/permission-rules-plane.ts`, `src/entrypoint.ts:authorizeToolUse`, `workers/agent-core/src/host/runtime-mainline.ts` |
| R6 | Legacy permission_mode hard delete | `src/facade/routes/session-bridge.ts`, `src/user-do/surface-runtime.ts`, `test/policy-permission-mode-route.test.ts` |
| R7 | Queue-backed executor substrate | `workers/orchestrator-core/src/executor-runtime.ts`, `src/entrypoint.ts:queue`, `wrangler.jsonc`, `src/facade/routes/session-control.ts`, `src/hp-absorbed-handlers.ts` |
| R8 | Item projection + file_change | `src/item-projection-plane.ts`, `src/facade/routes/session-items.ts`, `src/hp-absorbed-routes.ts`, `src/wsemit.ts`, `src/frame-compat.ts` |
| R9 | Client API docs 22-doc pack | `clients/api-docs/{runtime,items,tool-calls}.md`, `README.md`, `session-ws-v1.md`, `session.md`, `workspace.md`, `permissions.md`, `error-index.md` |

---

## 2. Follow-up / 不能夸大的边界

1. **retry executor deep semantics 尚未完成**:当前 `POST /sessions/{id}/retry` 已从旧 hint 变成 Queue dispatch response,但 Queue consumer 还没有真正重放 latest user turn、写 `turn_attempt` / `requested_attempt_seed`、驱动新 turn。
2. **fork executor deep semantics 尚未完成**:当前 `POST /sessions/{id}/fork` 已 queue-enqueue 并 mint `child_session_uuid`,但 child workspace snapshot copy、`nano_session_fork_lineage` materialization、`session.fork.created` terminal emit 仍需补齐。
3. **DO alarm stuck-job 兜底未落地**:本轮选择 Queue consumer + inline fallback,没有新增 agent-core DO alarm 每 5 分钟 requeue running job。
4. **package 发布未执行**:源码已升 `@haimang/nacp-session@1.5.0`,但本 closure 没有执行 GitHub Packages publish / preview redeploy。

因此本 closure 不把 HPX6 描述为“所有 executor 语义 fully complete”;准确状态是 workbench surfaces + durable truth + Queue substrate 已落地,executor deep semantics 仍有明确后续项。

---

## 3. 验证记录

| 命令 | 结果 |
|------|------|
| `pnpm --filter @haimang/nacp-session build` | ✅ pass |
| `pnpm --filter @haimang/nacp-session test` | ✅ pass |
| `pnpm --filter @haimang/orchestrator-core-worker typecheck` | ✅ pass |
| `pnpm --filter @haimang/agent-core-worker typecheck` | ✅ pass |
| `pnpm --filter @haimang/orchestrator-core-worker test` | ✅ pass |
| `pnpm --filter @haimang/agent-core-worker test` | ✅ pass |
| `pnpm --filter @haimang/orchestrator-core-worker build` | ✅ pass |
| `pnpm --filter @haimang/agent-core-worker build` | ✅ pass |
| `pnpm run check:docs-consistency` | ✅ pass |
| `pnpm test` | ✅ pass |
| `pnpm test:cross-e2e` | ✅ exit 0;live deploy cases skipped without `NANO_AGENT_LIVE_E2E=1` |

---

## 4. 发布前检查清单

1. Apply preview D1 migrations `015` / `016` / `017`。
2. Create/confirm Cloudflare Queue `nano-agent-executor-preview` and preview binding。
3. Publish `@haimang/nacp-session@1.5.0` to GitHub Packages。
4. Regenerate package manifests and run package truth gate before deploy。
5. Redeploy 6 workers and verify `/debug/packages` reports `@haimang/nacp-session@1.5.0`。
6. Run live e2e with `NANO_AGENT_LIVE_E2E=1` after deploy。

