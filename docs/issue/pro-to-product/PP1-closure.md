# PP1 HITL Interrupt Closure — Closure

> 服务业务簇: `pro-to-product / PP1 — HITL Interrupt Closure`
> 上游 action-plan: `docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md`
> 上游 design: `docs/design/pro-to-product/02-hitl-interrupt-closure.md`
> 冻结决策来源: `docs/design/pro-to-product/PPX-qna.md` Q6-Q8
> 闭环日期: `2026-05-03`
> 文档状态: `closed`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| PP1 当前状态 | `closed` |
| `approval_policy=ask` | `closed`：ask 不再作为 `tool-permission-required` 工具错误终结，而是进入 HITL permission wait seam |
| decision 输入 | `closed`：client→server decision 仍只走 HTTP；WS 只承担 server→client request/update 可见性 |
| confirmation kind | `frozen`：PP1 没有新增 kind，继续使用 7-kind registry 中的 `tool_permission` / `elicitation` |
| row-first request | `closed`：unified `session.confirmation.request` 在 durable row 创建失败时不再投递给前端 |
| runtime wakeup | `closed`：generic confirmation decision 对 live kind 要求 agent-core wakeup 成功；失败返回 `503`，不再 success-shaped |
| no-client / timeout | `closed`：tool permission 与 elicitation 都会显式 settle 为 `timeout`，不留下 fake pending |
| live e2e | `not-claimed`：本 closure 不伪造 live preview HITL e2e；当前证据为 worker targeted tests、route integration tests、build/typecheck 与独立 code review |

---

## 1. Resolved 项

| ID | 描述 | Verdict | 证据 |
|----|------|---------|------|
| `P1-01` | Runtime ask bridge | `closed` | `runtime-mainline.ts` 已具备 `requestToolPermission` wait seam；ask 不再落到 `tool-permission-required` error |
| `P1-02` | Row-first request creation | `closed` | `entrypoint.ts` 对 `session.confirmation.request` 要求 `emitterRowCreateBestEffort()` 成功后才 forward |
| `P1-03` | No-client boundary | `closed` | `session-do-runtime.ts` 在 permission / elicitation `delivered=false` 时 settle `timeout` 并抛出 no-decider error |
| `P2-01` | HTTP decision wakeup | `closed` | `session-control.ts` 在 row commit + update emit 后调用 agent-core permission/elicitation RPC，并检查 2xx |
| `P2-02` | Terminal status discipline | `closed` | timeout / no-client 终态写回 `settleConfirmation()`；duplicate/conflict 保持 confirmation plane 语义 |
| `P2-03` | Duplicate decision discipline | `closed` | `confirmation-route.test.ts` 覆盖不同终态重复提交返回 `409 confirmation-already-resolved` |
| `P3-01` | Pending read-model verification | `closed` | `confirmation-route.test.ts` 覆盖 list/detail 与 status filter |
| `P3-02` | HITL evidence | `closed-with-local-evidence` | agent-core DO tests + runtime-mainline tests + orchestrator route tests；未声明 live preview e2e |
| `P3-03` | PP1 closure | `closed` | 本文件 |

---

## 2. 本轮发现并修复的真实断点

1. **HTTP decision success-shaped wakeup 断点**：generic `POST /sessions/{id}/confirmations/{uuid}/decision` 原先可以在 agent-core RPC missing / failed 时仍返回 200，造成前端看到 terminal 但 runtime waiter 继续等到 timeout。现改为 `wakeAgentConfirmationWaiter()` 返回 `{ok, reason}`，对 `tool_permission` / `elicitation` 要求对应 agent-core RPC 存在且返回 2xx；失败返回 `503 internal-error`。
2. **elicitation infinite pending 断点**：permission 已有 no-client timeout 纪律，但 elicitation 仍可能在 `delivered=false` 或 await timeout 后留下 pending row。现 `emitElicitationRequestAndAwait()` 与 permission 对齐：无 client 和 await timeout 都调用 `settleConfirmation(status="timeout")`。
3. **row-first request best-effort 断点**：`forwardServerFrameToClient()` 原本对 legacy request 的 row-create 是 best-effort，扩展到 unified `session.confirmation.request` 后会违反 PP1 row-first 要求。现仅对 unified confirmation request 强制 row-create 成功后投递；legacy compat frame 保持历史 best-effort。

---

## 3. PP1 当前行为矩阵

| 场景 | 当前行为 | 终态 |
|------|----------|------|
| policy / rule 返回 `allow` | 直接执行 tool | tool result `ok` |
| policy / rule 返回 `deny` | 不执行 tool，返回 explicit deny | tool result `error` |
| policy 返回 `ask` 且 client attached | 创建/确认 pending row，推送 `session.confirmation.request`，runtime await | 等待 HTTP decision |
| HTTP decision `allowed` | row terminal，WS update，agent-core waiter 被唤醒 | tool 继续执行 |
| HTTP decision `denied` / timeout / superseded | row terminal，WS update，agent-core waiter 被唤醒 | tool 不执行或 waiter 终结 |
| agent-core wakeup missing / non-2xx | row 已提交，但 HTTP 返回 `503` 明确暴露 second-leg failure | 不伪装成功 |
| no attached client | request 不伪 pending；row settle `timeout` | no-decider / timeout |
| duplicate conflicting decision | 返回 `409 confirmation-already-resolved` | row 不被覆盖 |

---

## 4. Validation Evidence

| 命令 / 操作 | 结果 |
|-------------|------|
| `pnpm --filter @haimang/agent-core-worker typecheck` | pass |
| `pnpm --filter @haimang/agent-core-worker build` | pass |
| `pnpm --filter @haimang/agent-core-worker test -- test/host/runtime-mainline.test.ts test/host/do/nano-session-do.test.ts` | pass，44 tests |
| `pnpm --filter @haimang/orchestrator-core-worker typecheck` | pass |
| `pnpm --filter @haimang/orchestrator-core-worker build` | pass |
| `pnpm --filter @haimang/orchestrator-core-worker test -- test/confirmation-route.test.ts` | pass，8 tests |
| Independent PP1 code review | 第一轮发现 3 个 significant issues；均已修复 |
| Independent PP1 fix review | no significant issues found |

---

## 5. Shared Owner Files / 下游交接

| 文件 | PP1 后稳定职责 | 下游注意 |
|------|----------------|----------|
| `workers/agent-core/src/host/runtime-mainline.ts` | `ask` 分支进入 permission wait seam | PP4 hook 不应重新把 ask 降级为 tool error |
| `workers/agent-core/src/host/do/session-do-runtime.ts` | permission / elicitation request+await+timeout settle | PP3 reconnect 可复用 pending row，不应新增 parallel pending store |
| `workers/orchestrator-core/src/entrypoint.ts` | service binding forward 与 row-first emitter create | PP3/PP4 如新增 frame，应明确是否需要 row-first hard gate |
| `workers/orchestrator-core/src/facade/routes/session-control.ts` | generic confirmation decision + agent-core wakeup | PP5/PP6 docs 应记录 wakeup failure 503 语义 |
| `workers/orchestrator-core/src/confirmation-control-plane.ts` | 7-kind / 6-status durable truth | 不扩 enum；新增 kind 必须 charter/QNA amendment |

---

## 6. Known Issues / Not-Touched

1. 本 closure 不声明完整 browser / frontend live e2e 已完成；PP1 当前以 worker-level targeted evidence 证明 interrupt substrate，PP3 reconnect 与 PP6 api-docs 对账会继续消费该 substrate。
2. Legacy `session.permission.request` / `session.elicitation.request` 仍保留 compat 行为；PP1 强制 row-first 的对象是 unified `session.confirmation.request`。
3. `session.confirmation.update` 仍是 row commit 后 server→client 可见性广播；如果 WS update 投递失败，row truth 不回滚。
4. Full `clients/api-docs` sweep 不在 PP1 执行；PP6 专门负责接口全量扫描与 frontend docs 更新。

---

## 7. 收尾签字

- PP1 已完成 HITL interrupt substrate：ask → pending confirmation → HTTP decision → runtime wakeup / timeout terminal。
- PP1 未扩展 confirmation kind，未把 decision 改成 WS 输入，未实现 permission rule editor。
- `p2p-pp2-code` 可以在 `p2p-pp1-closure` 完成后按串行 todo 启动。
