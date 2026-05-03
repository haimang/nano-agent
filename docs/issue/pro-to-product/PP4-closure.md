# PP4 Hook Delivery Closure — Closure

> 服务业务簇: `pro-to-product / PP4 — Hook Delivery Closure`
> 上游 action-plan: `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md`
> 上游 design: `docs/design/pro-to-product/05-hook-delivery-closure.md`
> 冻结决策来源: `docs/design/pro-to-product/PPX-qna.md` Q15-Q17
> 闭环日期: `2026-05-03`
> 文档状态: `closed`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| PP4 当前状态 | `closed-with-pretooluse-minimal-live-loop` |
| hook scope | `PreToolUse-only minimal loop`：遵守 Q15，不扩 full catalog |
| hook runtime | `worker-safe declarative local-ts`：遵守 Q16，不开放 shell hook |
| PermissionRequest | `not-hard-gate`：Q17 fail-closed 语义保持不变，PP4 不把 PermissionRequest 纳入 closure 主闸 |
| user-driven register | `closed`：`GET/POST/DELETE /sessions/{id}/hooks` 通过 orchestrator facade 转发 agent-core session hook RPC |
| production caller | `closed`：真实 tool execution 前执行 PreToolUse，block 阻止工具，updatedInput 重新进入工具校验 |
| frontend visibility | `closed`：PreToolUse outcome 推 `hook.broadcast`，带 `caller:"pre-tool-use"` |
| audit visibility | `closed`：PreToolUse outcome 通过 `hook.outcome` audit 记录 |
| e2e | `not-claimed`：本 closure 不伪造 live cross-e2e；当前证据为 package/worker targeted tests、build/typecheck、governance gates 与两轮 code review |

---

## 1. Resolved 项

| ID | 描述 | Verdict | 证据 |
|----|------|---------|------|
| `P1-01` | Hook registration control surface | `closed` | orchestrator-core 新增 `/sessions/{id}/hooks` facade route；agent-core 新增 `hookRegister/hookList/hookUnregister` RPC |
| `P1-02` | Handler validation | `closed` | session registration manager 只接受 `PreToolUse`、`session` source、`local-ts` runtime、合法 matcher/timeout/declarative outcome |
| `P1-03` | Register persistence/scope | `closed` | hooks 持久化于 tenant-scoped DO storage `session:hooks:v1`；fresh DO HTTP path restore 回归测试覆盖 |
| `P2-01` | PreToolUse caller | `closed` | capability adapter 在 permission/quota/tool execution 前运行 PreToolUse |
| `P2-02` | Block outcome enforcement | `closed` | block path 不调用 capability transport，返回 hook-blocked tool result |
| `P2-03` | Updated input validation | `closed` | updatedInput 必须为 object，并进入原工具 schema；`write_todos` 测试覆盖改写后校验/执行 |
| `P3-01` | Audit outcome | `closed` | runtime assembly 写 `hook.outcome` audit，包含 finalAction、blocked、handlerCount、trace carriers |
| `P3-02` | Frontend broadcast/redaction | `closed` | `hook.broadcast` 带 redacted payload、aggregated_outcome 与 caller provenance |
| `P4-01` | Hook e2e | `not-claimed` | 未新增 cross-e2e；使用 targeted route/runtime tests 作为 first-wave evidence |
| `P4-02` | PP4 closure | `closed` | 本文件 |

---

## 2. 本轮发现并修复的真实断点

1. **register surface 缺失断点**：hook registry/dispatcher 原先只有 substrate，没有用户/session 驱动入口。现新增 public facade `/sessions/{id}/hooks` 与 agent-core internal RPC，形成 register/list/unregister 控制面。
2. **PreToolUse production caller 缺失断点**：generic `hook_emit` 只能广播，不能证明工具执行前 outcome 生效。现 capability adapter 在真实工具执行前运行 PreToolUse，并在 block 时阻止工具。
3. **updatedInput 校验断点**：hook 改写工具输入若直接执行，会变成绕过 schema 的后门。现 updatedInput 必须是 object，且继续进入原工具校验；`write_todos` 回归测试覆盖。
4. **frontend/audit provenance 断点**：`hook.broadcast` 原先无法区分 generic step emit 与 PreToolUse caller。现 broadcast 增加可选 `caller`，PP4 使用 `caller:"pre-tool-use"`；audit 使用 `hook.outcome`。
5. **HTTP hook management restore 断点**：独立审查发现 fresh/hibernated DO 处理 `hooks-list` / `hooks-unregister` 前没有恢复 persisted hooks。现 HTTP fallback path 在 action dispatch 前调用 `restoreSessionHooks()`，并新增 tenant-scoped persisted hook 回归测试。
6. **owner-file budget 断点**：PP4 初版把 hook control 堆入 `session-do-runtime.ts` 后超过 megafile gate。现拆出 `session-do-hooks.ts`，主 DO owner file 回到预算内。

---

## 3. PP4 当前行为矩阵

| 场景 | 当前行为 | 终态 |
|------|----------|------|
| `POST /sessions/{id}/hooks` 注册 PreToolUse | 校验 session ownership，转发 agent-core，写 tenant-scoped hook storage | handler live |
| 注册非 `PreToolUse` event | agent-core 返回 `400 invalid-input` | rejected |
| 注册 shell / service-binding runtime | agent-core 返回 `400 invalid-input` | rejected |
| `GET /sessions/{id}/hooks` fresh DO | 先 restore persisted hooks，再 list | persisted state visible |
| `DELETE /sessions/{id}/hooks/{handler}` | 先 restore，再 unregister 并重写 storage | removed / not found |
| tool execution 命中 block handler | 不调用工具 transport / backend，返回 hook-blocked tool result | blocked |
| tool execution 命中 updatedInput handler | updatedInput 进入原工具校验与执行 | updated then executed |
| handler diagnostics error | fail-visible block，不 silent continue | safe failure |
| hook outcome | 推 `hook.broadcast` + 写 `hook.outcome` audit | frontend/audit visible |

---

## 4. Live Hooks / Catalog-only Hooks

| 类别 | PP4 状态 | 说明 |
|------|----------|------|
| `PreToolUse` | `live-minimal` | session-scoped declarative local-ts handler；支持 block / continue / updateInput |
| `PostToolUse` | `catalog-only` | 不作为 PP4 hard gate |
| `PermissionRequest` | `catalog-only / PP5交汇` | Q17 fail-closed 保持；PP4 不改成 fallback confirmation |
| 其他 15 类 hooks | `catalog-only` | 不扩 full catalog，不作为本阶段 closure 证据 |
| shell hook | `not-supported` | Worker runtime 硬约束；未来若支持需 dedicated sandbox worker / 独立 charter |

---

## 5. Validation Evidence

| 命令 / 操作 | 结果 |
|-------------|------|
| `pnpm --filter @haimang/nacp-session typecheck` | pass |
| `pnpm --filter @haimang/nacp-session build` | pass |
| `pnpm --filter @haimang/nacp-session test` | pass，21 files / 217 tests |
| `pnpm --filter @haimang/agent-core-worker typecheck` | pass |
| `pnpm --filter @haimang/agent-core-worker build` | pass |
| `pnpm --filter @haimang/agent-core-worker test -- test/host/do/nano-session-do.test.ts test/host/runtime-mainline.test.ts` | pass，48 tests |
| `pnpm --filter @haimang/orchestrator-core-worker typecheck` | pass |
| `pnpm --filter @haimang/orchestrator-core-worker build` | pass |
| `pnpm --filter @haimang/orchestrator-core-worker test -- test/session-hooks-route.test.ts` | pass，2 tests |
| `pnpm run check:docs-consistency` | pass |
| `pnpm run check:megafile-budget` | pass，16 owner files within budget |
| `pnpm run check:envelope-drift` | pass |
| `git --no-pager diff --check` | pass |
| Independent PP4 code review | 发现 HTTP fallback restore issue；已修复 |
| Independent PP4 fix review | 确认 restore issue resolved |

---

## 6. Known Issues / Not-Touched

1. PP4 不声明 full hook catalog live；只声明 PreToolUse minimal live loop。
2. PP4 不开放 shell hook，也不提供任意代码执行式 marketplace/plugin UI。
3. PP4 不声明 live preview / browser cross-e2e 已完成；当前 closure 是 local package/worker evidence。
4. session hook registration 是 declarative local-ts first-wave 能力；不是通用 JavaScript 上传/执行平台。
5. hook latency alert 只作为 closure 风险登记；本阶段未建设专门 latency SLO monitor。

---

## 7. 下游交接

| 下游 | 交接事项 |
|------|----------|
| PP5 Policy & Reliability Hardening | policy unavailable / stream degraded 可复用 PP4 的 fail-visible 思路；PermissionRequest no-handler 仍按 Q17 fail-closed |
| PP6 API Contract Docs Closure | 全量核对 hooks route、`hook.broadcast.caller`、session docs、worker health / transport docs 是否一致 |

---

## 8. 收尾签字

- PP4 已关闭 PreToolUse minimal live hook loop：register → restore/list → real tool pre-call emit → block/update outcome → frontend broadcast + audit。
- PP4 未扩 full catalog，未开放 shell hook，未把 PermissionRequest fallback 纳入本阶段。
- 本轮用户要求的 `PP0 → PP1 → PP2 → PP3 → PP4` 串行执行链已在 PP4 closure 后完成。
