# HPX5 Wire-up — Closure

> 服务业务簇: `hero-to-pro / HPX5 — schema-frozen wire-up + bounded surface completion`
> 上游 design: `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` v0.2.1
> 上游 action-plan: `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md`(已 executed,§9 含完整工作日志)
> 下游 handoff: `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md`
> 冻结决策来源: `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` §0.4 / §6.1 / §9.1(Q-bridging-1..8)
> 三份评审输入(已吸收到 design v0.2):
> - `docs/eval/hero-to-pro/api-gap/HPX5-HPX6-design-docs-reviewed-by-deepseek.md`
> - `docs/eval/hero-to-pro/api-gap/HPX5-HPX6-design-docs-reviewed-by-GPT.md`
> - `docs/eval/hero-to-pro/api-gap/HPX5-HPX6-design-docs-reviewed-by-kimi.md`
> 闭环日期: `2026-05-02`
> 文档状态: `frozen-can-close`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| HPX5 当前状态 | **`done — fully wired-up`**(7 个 In-Scope 功能 F0/F1/F2(a/b/c)/F3/F4/F5/F7 全部 live) |
| Phase 1 — Emit Seam Infrastructure (F0) | `done`(emit-helpers.ts + 10 case 单测全绿;runtime-assembly 注入 emitTopLevelFrame deps;SessionWebSocketHelper.pushFrame 加) |
| Phase 2 — Top-level Frame Emitters (F1+F2c+F4) | `done`(confirmation/todos 顶层帧 + model.fallback stream-event 全部 live;legacy permission/elicitation dual-write 同样 emit) |
| Phase 3 — LLM Capability + Workspace Bytes (F2a+F2b+F5) | `done`(WriteTodos LLM-driven + auto-close in_progress + workspace bytes binary GET via filesystem-core readTempFile) |
| Phase 4 — Auto-Compact Wiring (F3) | `done`(composeCompactSignalProbe → SessionOrchestrator deps 接通;façade 透传 force/preview_uuid/label;context-core RPC 签名扩展) |
| Phase 5 — Docs Consistency + Reference Refresh (F7) | `done`(13 处契约修齐;9 份 doc reference 行号刷新;client-cookbook.md 新建;`/start` 返 first_event_seq;check-docs-consistency CI gate live) |
| 测试 sweep | **1789 tests passing across 4 packages**(207 nacp-session + 332 orchestrator-core + 1072 agent-core + 178 context-core);0 退化 |
| CI gate | `check:cycles` 0 cycle / `check:envelope-drift` clean / `check:docs-consistency` OK |
| Backward compatibility | `clean`(全部新增 deps / RPC / 字段都是 optional;legacy emit 路径不动;`POST /policy/permission_mode` 完全保留留 HPX6 hard delete) |
| Contract 变更 | **none**(NACP_VERSION 仍 1.1.0;所有 emit 走已注册 SESSION_BODY_SCHEMAS / SessionStreamEventBodySchema;owner Q-bridging-1 frozen) |
| README "WebSocket-first" 承诺 | **兑现**(confirmation / todos / model.fallback row write 后 ≤500ms 顶层帧 emit;前端 happy path 走事件驱动) |

---

## 1. Resolved 项(本轮 HPX5 已落地、可直接消费)

| ID | 描述 | 证据 | 说明 |
|----|------|------|------|
| `R0` | emit-helpers.ts 单一出口(F0) | `packages/nacp-session/src/emit-helpers.ts` + `test/emit-helpers.test.ts`(10 case) | `emitTopLevelFrame` + `emitStreamEvent` 两个出口;zod 校验 + system.error fallback;EmitObserver 接 `nano_emit_latency_ms / drop` 指标 |
| `R1` | confirmation 顶层帧 emit(F1) | `workers/orchestrator-core/src/{facade/routes/session-control.ts,user-do/surface-runtime.ts,frame-compat.ts}` + `packages/nacp-session/src/emit-helpers.ts` | `applyDecision` 后 emit `session.confirmation.update`;legacy `permission/decision` + `elicitation/answer` dual-write 同样 emit `.request`(create 时) + `.update`(终态时);HPX5 补齐 lightweight `confirmation_kind` alias 与 top-level frame schema mapping |
| `R2` | WriteTodos LLM capability(F2a + F2b) | `workers/orchestrator-core/src/entrypoint.ts:138-260` + `workers/agent-core/src/{llm/tool-registry.ts,host/runtime-mainline.ts}` + `workers/agent-core/test/llm/gateway.test.ts` | LLM `tool_use { name: "write_todos" }` 既对模型可见,又短路到 orchestrator-core RPC;HP6 Q19 at-most-1 in_progress invariant 自动护理(auto-close 旧 in_progress + 同 batch 多 in_progress 自动降级) |
| `R3` | todos 顶层帧 emit(F2c) | `workers/orchestrator-core/src/facade/routes/session-control.ts:506-525, 555-575, 591-616` + `entrypoint.ts:writeTodos` | HTTP CRUD 路径 + LLM-driven 路径都 emit `session.todos.update` 全量 list snapshot |
| `R4` | auto-compact runtime trigger(F3) | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:285-321` | `composeCompactSignalProbe(budgetSource, breaker)` 注入 `OrchestrationDeps.probeCompactRequired`;budgetSource 调 `ORCHESTRATOR_CORE.readContextDurableState` 计算 `used >= auto_compact_token_limit`(默认阈值 0.85);3 次失败熔断由 compact-breaker.ts 已 live |
| `R5` | `/context/compact[/preview]` body 透传(F3) | `workers/orchestrator-core/src/facade/routes/session-context.ts:6-69, 121-155` + `workers/context-core/src/index.ts:228-258, 308-372` | façade 读 `{ force?, preview_uuid?, label? }` 并透传 RPC;`force=true` 跳过 "compact-not-needed" early return;label 进 checkpoint registry |
| `R6` | model.fallback emitter(F4) | `workers/orchestrator-core/src/user-do/message-runtime.ts:120-127, 333-432` | 替换硬编码 `fallback_used: false, fallback_reason: null`;从 `inputAck.body` 读真实值;fallback_used=true 时 emit `model.fallback` stream-event(走现有 `pushStreamEvent` 因已在 13-kind union 内) |
| `R7` | workspace bytes binary GET(F5) | `workers/orchestrator-core/src/hp-absorbed-routes.ts:85-114, 250-323` | 新路径 `/sessions/{id}/workspace/files/{*path}/content`;走 filesystem-core 已 live `readTempFile` RPC pass-through;25 MiB cap;`content_source` 从 `"filesystem-core-leaf-rpc-pending"` → `"live"` |
| `R8` | 19-doc 契约修齐(F7) | `clients/api-docs/{models,session-ws-v1,session,context,permissions,todos,README}.md` + 9 份 reference 行号刷新 | `effective_model_id` → `fallback_model_id`(model.fallback 上下文);`session_status: "running"` → `"active"`;`first_event_seq` / confirmation/todo/model.fallback live truth / compact body / permission kind / doc count 全部回刷到当前代码事实 |
| `R9` | `client-cookbook.md` 新建(F7) | `clients/api-docs/client-cookbook.md` | 12 节实战兜底:envelope unwrap / dedup / start→ws 顺序 / `409 confirmation-already-resolved` 终态 / WriteTodos 行为 / workspace bytes / auto-compact / model.fallback / decision body shape 等 |
| `R10` | `/start` 返 `first_event_seq`(F7) | `workers/orchestrator-core/src/user-do/session-flow/start.ts:267-285` | 客户端可用作 `last_seen_seq` 兜底,消除 start→ws-attach 之间的帧丢失风险 |
| `R11` | docs consistency CI gate | `scripts/check-docs-consistency.mjs` + `package.json:check:docs-consistency` | 8 项检查:`index.ts:NNN` 失效引用零;model.fallback 上下文不再用 `effective_model_id`;`session_status: "running"` 零;`content_source: filesystem-core-leaf-rpc-pending` 零;confirmation/todo `emitter pending` 零;`model.fallback emitter-not-live` 零;`session.confirmation.request{kind:"permission"}` 零;legacy decision body `{ decision, payload }` 零;另强制 `session.md` / `session-ws-v1.md` 必须含 `first_event_seq` |

---

## 2. Partial / Cannot-Close 项

无。HPX5 全部 In-Scope 功能(F0/F1/F2(a/b/c)/F3/F4/F5/F7 共 7 项)均已 live。

> Out-of-scope 项一律落入 HPX6:F6 tool-calls D1 ledger / F8 followup_input public WS / F9 runtime config / F10 permission rules / F11 retry executor / F12 restore executor / F13 fork executor / F14 item projection / F15 file_change item.

---

## 3. 测试 / Quality Gates

| 套件 | 数量 | 通过 | 备注 |
|------|------|------|------|
| `@haimang/nacp-session` | 207 | ✅ 207 | 含 10 个新 emit-helpers case |
| `@haimang/orchestrator-core-worker` | 332 | ✅ 332 | 含 1 个 workspace-route test 更新(`content_source: "live"`) |
| `@haimang/agent-core-worker` | 1072 | ✅ 1072 | 0 退化;新 capability 短路逻辑通过既有 capability execute test 覆盖 |
| `@haimang/context-core-worker` | 178 | ✅ 178 | `previewCompact / triggerCompact` 签名扩展 backward-compat |
| `pnpm check:cycles` | - | ✅ 0 cycle | madge 无新增循环依赖 |
| `pnpm check:envelope-drift` | - | ✅ clean | 1 public file clean |
| `node scripts/check-docs-consistency.mjs` | 8 regex checks + 2 required-snippet checks × 19 docs | ✅ OK | 0 violations |
| `pnpm test:contracts`(root-guardian) | 29 | ⚠️ 28/29 | **1 项 pre-existing 失败**:`session-registry-doc-sync.test.mjs` 引用不存在的 `docs/nacp-session-registry.md`,git 历史显示该测试在 ZX3/ZX4 phase 之前就失败,与 HPX5 无关 |

**Total**:1789 test 全绿。

---

## 4. Frozen 决策回填

| Q ID | 决策 | 在 HPX5 中如何体现 |
|------|------|---------------------|
| **Q-bridging-1**(NACP 1.1.0 不 bump) | NACP_VERSION 不变 | 所有 emit 走已注册 schema;新加的 helper 是包内文件,不动 message_type / direction matrix |
| **Q-bridging-2**(polling 保留) | client-cookbook §5 双轨说明 | 客户端 happy path 走 WS 事件驱动;reconnect 后立即 polling 一次 reconcile |
| **Q-bridging-6**(confirmation/todos 走独立顶层帧) | 新建 `SessionWebSocketHelper.pushFrame` 与 `OrchestrationDeps.emitTopLevelFrame`,**不**扩展 `SessionStreamEventBodySchema` 13-kind union | confirmation/todos 顶层帧;model.fallback 走 stream-event(因已在 union 内) |
| Q16(row-first dual-write) | F1 emit 严格在 `applyDecision` 成功后 | `409 confirmation-already-resolved` 行为不变 |
| Q19(at-most-1 in_progress) | F2b WriteTodos capability 自动 close 旧 in_progress + 同 batch 多 in_progress 自动降级为 pending | tool_result 给 LLM 返 `auto_closed` 列表 |
| Q24(restore 失败必填 failure_reason) | 不受 HPX5 影响(restore executor 留 HPX6) | n/a |
| HP3 compact-breaker | F3 复用 `composeCompactSignalProbe` 与 `createCompactBreaker(3)`,**不**重做 | 7-min 冷却继续 live |

> Q-bridging-7(直接删 legacy `permission_mode`)、Q-bridging-8(executor 走 Cloudflare Queue)是 HPX6 决策,在 HPX5 内**不实施**,legacy 路由完全保留。

---

## 5. Backward Compatibility 报告

所有改动 backward-compatible:

- **新增 deps / fields 全 optional**:`OrchestrationDeps.emitTopLevelFrame?` / `MainlineKernelOptions.writeTodosBackend?` / `MainlineKernelOptions.compactSignalProbe?` / `previewCompact options?` / `triggerCompact options?` / `start response.first_event_seq` / `inputAck.body.fallback_used` 缺省回退到原行为
- **emit 失败永远 fall back 到 system.error**,不静默丢帧;客户端反而获得更明确的错误信号(NACP_VALIDATION_FAILED / NACP_BINDING_UNAVAILABLE / NACP_UNKNOWN_MESSAGE_TYPE)
- **legacy emit 路径完全不动**:turn.begin / turn.end / tool.call.* / llm.delta / system.notify / compact.notify / session.update / session.fork.created 等 13 个 stream-event 子类型路径未改;`SessionWebSocketHelper.pushEvent` API 不动
- **legacy permission_mode 路由完全保留**(`POST /sessions/{id}/policy/permission_mode` + `surface-runtime.ts:660-682 handlePermissionMode`)等待 HPX6 hard delete
- **decision body legacy 字段**:façade 路由仍接受 canonical `status / decision_payload`;legacy `decision / payload` 在 façade 层未引入 dual-accept(留 HPX6 / hero-to-platform 决策)
- **既有 18 doc 行为不变**;index 升级为 19(只增加 `client-cookbook.md`)

---

## 6. Handoff 到 HPX6

HPX6 的 9 项 In-Scope 功能(F6/F8/F9/F10/F11/F12/F13/F14/F15)直接消费 HPX5 已落地的:

- **F0 emit-helpers** — HPX6 新增的 `session.runtime.update`(F9)、`session.restore.completed`(F12)、`session.item.{started,updated,completed}`(F14)、`file_change` item(F15)全部走同一出口
- **F1/F2c emit pattern** — HPX6 新增 emitter 直接 follow F1 模板:row write → emit-helpers → User DO `__forward-frame` → attached client
- **F3 compact-breaker / probeCompactRequired** — HPX6 不再涉及
- **F5 workspace bytes** — HPX6 F15 `file_change` item 在此基础上 emit
- **F7 docs cookbook** — HPX6 F8/F9/F11/F12/F13/F14/F15 直接在此 cookbook 上加章节,不再新建独立 helper doc

**HPX6 第一步**:落 D1 migration `015-tool-call-ledger.sql` + `016-session-runtime-config.sql` + `017-team-permission-rules.sql` + nacp-session 1.5.0 加 4 类新顶层帧 schema;然后 hard delete legacy `permission_mode`(Q-bridging-7);然后 Cloudflare Queue + `executor-runner` worker(Q-bridging-8)。

---

## 7. 文档同步

- ✅ `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md` §9 已回填完整工作日志
- ✅ `clients/api-docs/{session-ws-v1,models,checkpoints,permissions,confirmations,context,todos,session,workspace}.md` 修齐 reference 行号 + HPX5 新行为
- ✅ `clients/api-docs/client-cookbook.md` 新建,12 节
- ✅ `clients/api-docs/README.md` 索引 18 → 19
- ✅ `scripts/check-docs-consistency.mjs` + `package.json` script 入 CI

待 HPX6 完成时一并更新:
- `docs/design/hero-to-pro/HP3-context-state-machine.md` closure 章节追加 "HPX5 auto-compact wiring + body 透传 done"
- `docs/design/hero-to-pro/HP5-confirmation-control-plane.md` closure 章节追加 "HPX5 emitter 接通 done"
- `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md` closure 章节追加 "HPX5 WriteTodos / workspace bytes / `content_source: live` done"

---

## 8. 一句话结语

> **HPX5 把 HP1–HP9 已经冻好的协议形状真正驱动起来 — confirmation / todos / model.fallback row write 后 ≤500ms 顶层帧 emit;LLM 可以直接调 WriteTodos 管自己的 plan;workspace bytes 可读;long session 在 turn 边界自动 compact;13 处文档断点修齐 — 不动 contract 形状,但兑现 README "WebSocket-first 持久化 agent runtime" 承诺。HPX6 接力做 workbench-grade 控制面与 Codex 风格对象层。**
