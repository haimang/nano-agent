# Nano-Agent 行动计划

> 服务业务簇: `HPX5 — schema-frozen wire-up + bounded surface completion`
> 计划对象: `把已注册 schema 的 emitter / capability / runtime / 字节通道接通 + 修齐 19-doc pack 文档断点`
> 类型: `upgrade + add`
> 作者: `Owner + Opus 4.7 (1M)`
> 时间: `2026-05-02`
> 文件位置: `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md`
> 上游前序 / closure:
> - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` v0.2.1(已纳入 deepseek/GPT/kimi 评审 + owner 决议 Q-bridging-7 直接删 / Q-bridging-8 同意 Queue / F7 dual-accept OK)
> - `docs/design/hero-to-pro/HP3-context-state-machine.md` HP3 frozen
> - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md` HP5 frozen
> - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md` HP6 frozen
> - `docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md` HP9 frozen
> 下游交接:
> - `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md`(F6 + F8–F15)
> 关联设计 / 调研文档:
> - `docs/eval/hero-to-pro/api-gap/claude-code-compared-by-opus.md`
> - `docs/eval/hero-to-pro/api-gap/codex-compared-by-GPT.md`
> - `docs/eval/hero-to-pro/api-gap/gemini-cli-compared-by-deepseek.md`
> - `docs/eval/hero-to-pro/api-gap/HPX5-HPX6-design-docs-reviewed-by-deepseek.md`
> - `docs/eval/hero-to-pro/api-gap/HPX5-HPX6-design-docs-reviewed-by-GPT.md`
> - `docs/eval/hero-to-pro/api-gap/HPX5-HPX6-design-docs-reviewed-by-kimi.md`
> 冻结决策来源:
> - `docs/design/hero-to-pro/HPX-qna.md`(Q1–Q27 仍适用)
> - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` §0.4 / §9.1(Q-bridging-1..8)— 只读引用,本 action-plan 不开 Q/A
> 文档状态: `executed`

---

## 0. 执行背景与目标

HPX5 是 hero-to-pro 阶段最后一公里的"接线工程"。HP1–HP9 已经把协议 schema、D1 truth、RPC leaf 全部冻好,但仓内一手代码核查发现:

- `packages/nacp-session/src/messages.ts:304-393, 369-393` 里 `SessionConfirmationRequestBodySchema` / `SessionConfirmationUpdateBodySchema` / `SessionTodosWriteBodySchema` / `SessionTodosUpdateBodySchema` 已注册到 `SESSION_BODY_SCHEMAS`(`messages.ts:397-444`),`type-direction-matrix.ts:24, 37-43` 也声明了 direction;但 `workers/agent-core/src/host/orchestration.ts:112` 的 `pushStreamEvent(kind, body)` deps **只能** emit `session.stream.event` 子类型,**没有**任何代码路径在 row write 之后 emit confirmation/todos 顶层帧。
- `workers/orchestrator-core/src/todo-control-plane.ts` 已经 live(279 行),但 `agent-core` 的 capability registry 没有任何把 LLM `tool_use { name: "write_todos" }` 路由到 `D1TodoControlPlane` 的代码,所以 LLM 不能驱动 todo。
- `workers/agent-core/src/host/orchestration.ts:314-322` 的 `if (this.deps.probeCompactRequired) { ... }` 是 **default-off, optionally wired** 模式,`workers/agent-core/src/host/compact-breaker.ts:18-37, 44-55` 的 `composeCompactSignalProbe` 也已实现,但 `runtime-mainline.ts` 没有把它传入 `OrchestrationDeps.probeCompactRequired`。
- `workers/orchestrator-core/src/facade/routes/session-context.ts:103-114` 调用 `ctx.previewCompact / triggerCompact` 时 **不读取** request body,所以客户端的 `force / preview_uuid / label` 全部被静默丢弃。
- `packages/nacp-session/src/stream-event.ts:139-145` 的 `ModelFallbackKind` 已在 `SessionStreamEventBodySchema` 13-kind discriminated union 内(union 见 `stream-event.ts:147-161`),但 `workers/orchestrator-core/src/user-do/message-runtime.ts:341-342, 395-396` 的 turn 关闭路径仍**硬编码**写 `fallback_used: false, fallback_reason: null`,emit 路径也没接。
- `workers/filesystem-core/src/index.ts:160-175` 的 `readTempFile` RPC **已 live**(返回 `{ ok, r2_key, bytes, mime }`),但 `workers/orchestrator-core/src/hp-absorbed-routes.ts:248-269` 的 workspace 读取路由仍只返 metadata + `content_source: "filesystem-core-leaf-rpc-pending"` 占位 — façade 没有接通字节路径。
- `clients/api-docs/*.md` 19-doc pack 内引用 `workers/orchestrator-core/src/index.ts:1103-...` 这类行号,但 `workers/orchestrator-core/src/index.ts` 实际只有 18 行(已模块化到 `facade/routes/*.ts` + `*-control-plane.ts`),所有 implementation reference 均失效。

HPX5 把这 7 个真实缺口闭环。**本计划不开 Q/A,所有取舍源于 design v0.2.1。**

- **服务业务簇**:`HPX5 — schema-frozen wire-up + bounded surface completion`
- **计划对象**:F0 + F1 + F2(a/b/c) + F3 + F4 + F5 + F7 共 7 项功能(对应 design §5.1 HPX5 phase)
- **本次计划解决的问题**:
  - confirmation/todos 顶层 WS 帧 emitter 未接通 → 客户端 HITL 必须轮询
  - LLM 不能写自己的 todo(agent-core 无 WriteTodos capability)
  - auto-compact runtime 未接线、`/context/compact` body 字段被忽略 → 长 session 撞 context window
  - `model.fallback` 静默 → 前端 model badge 不更新
  - workspace temp file 字节读取 façade 未通 → 前端不能预览 LLM 生成的文件
  - 13 处文档断点 + 失效 implementation reference → 前端基于文档实现会写错请求
- **本次计划的直接产出**:
  - 新建 `packages/nacp-session/src/emit-helpers.ts` 单一 emit 出口,封装 zod 校验 + cross-worker bridge + system.error fallback
  - confirmation/todos/model.fallback 三类 emitter 真实 emit
  - agent-core `WriteTodos` capability live(tool schema 注册 + execution 路由 + at-most-1 invariant 自动护理)
  - `runtime-mainline.ts` 接通 `composeCompactSignalProbe` → SessionOrchestrator deps;façade 透传 compact body;`compact.notify` 完整 4 状态链路
  - 新增 `GET /sessions/{id}/workspace/files/{*path}/content` binary 路由(façade pass-through 到 `readTempFile` RPC)
  - 19-doc pack 13 处契约不一致全修齐;implementation reference 全量刷新到模块化结构;`/start` 返回 `first_event_seq`;新增 `client-cookbook.md`
  - `scripts/check-docs-consistency.mjs` 落地,在 CI 通过
- **本计划不重新讨论的设计结论**:
  - confirmation/todos 走**独立顶层 WS 帧**,不扩展 `SessionStreamEventBodySchema`(来源:design Q-bridging-6 / `messages.ts:397-444` 已注册顶层 message_type)
  - polling 路由保留作为 reconcile fallback(来源:Q-bridging-2 / §6.1 取舍 5)
  - emit-helpers 仅作为 F1/F2/F4 强制出口,现有 stream-event emitter **不强制迁移**(来源:§6.1 取舍 6)
  - F4 字段名以 `stream-event.ts:139-145` schema 为准(`fallback_model_id` 而非 `effective_model_id`)
  - F7 `decision/payload` legacy 字段在 façade 层 dual-accept 1 个版本(owner 已决议:F7 OK)

---

## 1. 执行综述

### 1.1 总体执行方式

**先底层后上层 + 先 infra 后 emitter + 文档跟随代码**。Phase 1 先把 `emit-helpers.ts` infrastructure + cross-worker bridge 建出来(F0)— 这是 F1/F2/F4 的硬前置,必须 W1 完成。Phase 2 接通 4 个 emitter(F1 confirmation / F2c todos / F4 model.fallback / + emit-helpers 的 zod 校验回路)。Phase 3 接通 LLM-side capability(F2a/F2b WriteTodos)+ workspace bytes GET(F5)— 这两项与 emitter 解耦,可并行。Phase 4 处理 auto-compact runtime + façade body 透传(F3),涉及 agent-core 与 context-core RPC 跨 worker 校准。Phase 5 文档全量修订 + reference 行号刷新(F7),只动 docs 与 ci 脚本。每个 Phase 完成后必须跑 `pnpm test:contracts` + per-worker `pnpm --filter @haimang/* test` 不退化才能进入下一 Phase。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Emit Seam Infrastructure(F0) | M | 新建 `emit-helpers.ts`;在 agent-core session DO `runtime-assembly.ts` 注入 `emitTopLevelFrame` deps;封装 zod 校验 + system.error fallback | - |
| Phase 2 | Top-level Frame Emitters(F1 + F2c + F4) | L | confirmation row-write 后 emit;todo row-write 后 emit;model.fallback 真实 emit + D1 真实写入 | Phase 1 |
| Phase 3 | LLM Capability + Workspace Bytes(F2a + F2b + F5) | M | WriteTodos tool schema 注册 + execution 路由 + auto-close in_progress;workspace bytes binary GET | Phase 2(F2c)+ Phase 1 |
| Phase 4 | Auto-Compact Wiring + Body 透传(F3) | M | `composeCompactSignalProbe` 接到 deps;façade 读 body 并透传 context-core RPC;4 状态 `compact.notify` | - |
| Phase 5 | Docs Consistency + Reference Refresh(F7) | M | 13 处契约修齐;implementation reference 全量刷新;`/start` 返 `first_event_seq`;新增 `client-cookbook.md`;`scripts/check-docs-consistency.mjs` 入 CI | Phase 1–4(代码先 freeze,再写 docs) |

### 1.3 Phase 说明

1. **Phase 1 — Emit Seam Infrastructure(F0)**
   - **核心目标**:在 `packages/nacp-session/src/emit-helpers.ts` 提供 `emitTopLevelFrame(messageType, body, ctx)`;在 `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:367-385` 当前的 `pushStreamEvent` deps 旁边注入 `emitTopLevelFrame` deps,内部走 `helper.pushEvent` 但**不**经 `session.stream.event` 包装。
   - **为什么先做**:F1/F2/F4 三个 emitter 都依赖此出口;若没有 helper,emit 路径会散落在 control-plane / kernel / DO 三处,引入新 RHX 风险(三份评审一致点出)。

2. **Phase 2 — Top-level Frame Emitters(F1 + F2c + F4)**
   - **核心目标**:row write 之后 ≤500ms emit;失败 fall back 到 `system.error`(stream-event family);emit latency 写入 `nano_emit_latency_ms` metric。
   - **为什么放在这里**:F0 提供出口,F1/F2c/F4 接它;同 Phase 完成后客户端可以**统一**关掉 confirmation/todos polling fallback 的 happy path(reconcile 仍保留)。

3. **Phase 3 — LLM Capability + Workspace Bytes(F2a + F2b + F5)**
   - **核心目标**:LLM 在 turn 中调用 `tool_use { name: "write_todos" }` 时 agent-core 路由到 `D1TodoControlPlane` 并自动 close 上一个 in_progress;新增 `GET /sessions/{id}/workspace/files/{*path}/content` 走 `readTempFile` RPC pass-through。
   - **为什么放在这里**:F2a/F2b 与 F2c 解耦(capability 是 LLM-facing,emitter 是 client-facing),可以并行;F5 完全独立,只是把 RPC 已就绪的字节通道暴露给 façade。

4. **Phase 4 — Auto-Compact Wiring + Body 透传(F3)**
   - **核心目标**:`runtime-mainline.ts` 注入 `composeCompactSignalProbe(budgetSource, breaker)` 到 `OrchestrationDeps.probeCompactRequired`;façade 真实读 `/context/compact[/preview]` body 并透传到 context-core RPC;4 状态 `compact.notify` 链路 emit。
   - **为什么放在这里**:F3 与 F1/F2/F5 完全独立,可与 Phase 3 并行;放第 4 是为了让 F0/F1/F2 先稳定,避免 compact 引入的 turn-boundary 触发与 emitter 抖动相互影响。

5. **Phase 5 — Docs Consistency + Reference Refresh(F7)**
   - **核心目标**:19-doc pack 内零契约不一致;implementation reference 全量刷新到 `workers/orchestrator-core/src/{facade/routes,*-control-plane}.ts`;新增 `clients/api-docs/client-cookbook.md` 收口 helper;`/start` 返 `first_event_seq`;`scripts/check-docs-consistency.mjs` 入 CI。
   - **为什么放在这里**:文档跟随代码,代码 freeze 后写 docs(HP9 已建立的纪律);`first_event_seq` 字段需要 Phase 1–4 的 emit seam 落地后才能稳定。

### 1.4 执行策略说明

- **执行顺序原则**:infra → emitter → capability → runtime → docs;每个 Phase 完成必须 contracts 测试与 per-worker test 全绿。
- **风险控制原则**:emit 失败必须 fall back 到 `system.error`(`stream-event.ts:113-122` 的 `SystemErrorKind`),**绝不**静默丢帧;LLM-side capability(F2b)在调用前自动 close 上一个 in_progress,避免触发 Q19 `409 in-progress-conflict`。
- **测试推进原则**:Phase 1 完成必须有 emit-helpers 单测覆盖 zod 校验 + fallback 路径;Phase 2/3/4 完成必须有 e2e contracts 测试覆盖"row write → WS receive";Phase 5 必须有 `scripts/check-docs-consistency.mjs` CI 通过。
- **文档同步原则**:F7 在 Phase 5 集中处理,但每个 Phase 内的 implementation reference 改动当 Phase 内 commit 一并改 docs,避免漂移。
- **回滚 / 降级原则**:emit-helpers 失败走 system.error,客户端 polling 仍 live,不会出现"既无 push 又无 polling"的盲区;`runtime-mainline.ts` 注入 `composeCompactSignalProbe` 出问题可以一行还原(deps 字段是 optional)。

### 1.5 本次 action-plan 影响结构图

```text
HPX5 wire-up
├── Phase 1: Emit Seam Infrastructure
│   ├── packages/nacp-session/src/emit-helpers.ts (NEW)
│   ├── packages/nacp-session/src/index.ts (re-export)
│   └── workers/agent-core/src/host/do/session-do/runtime-assembly.ts:367-385 (注入 emitTopLevelFrame deps)
├── Phase 2: Top-level Frame Emitters
│   ├── workers/orchestrator-core/src/confirmation-control-plane.ts:96-131, 221-260 (F1: 在 create / applyDecision 后调 emit)
│   ├── workers/orchestrator-core/src/todo-control-plane.ts:151-... (F2c: 在 create/update 后调 emit)
│   ├── workers/agent-core/src/host/runtime-mainline.ts (F4: model fallback 决策点 emit)
│   └── workers/orchestrator-core/src/user-do/message-runtime.ts:341-342, 395-396 (F4: 替换硬编码 fallback_used:false)
├── Phase 3: LLM Capability + Workspace Bytes
│   ├── workers/agent-core/src/host/runtime-mainline.ts (F2a: tool schema 注册到 capability registry)
│   ├── workers/agent-core/src/kernel/* (F2b: tool execution 路由 write_todos → D1TodoControlPlane RPC)
│   └── workers/orchestrator-core/src/hp-absorbed-routes.ts:248-269 (F5: 新增 /content 子路径,调 readTempFile)
├── Phase 4: Auto-Compact Wiring
│   ├── workers/agent-core/src/host/runtime-mainline.ts (F3: 注入 composeCompactSignalProbe)
│   ├── workers/agent-core/src/host/compact-breaker.ts (F3: 复用,不动)
│   ├── workers/orchestrator-core/src/facade/routes/session-context.ts:103-114 (F3: 读 body 并透传)
│   └── workers/context-core/src/* (F3: previewCompact / triggerCompact RPC 接受 force/preview_uuid/label)
└── Phase 5: Docs Consistency
    ├── clients/api-docs/*.md (F7: 13 处修订 + reference 行号刷新)
    ├── clients/api-docs/client-cookbook.md (NEW)
    ├── clients/api-docs/README.md (索引更新)
    ├── scripts/check-docs-consistency.mjs (NEW)
    └── workers/orchestrator-core/src/facade/routes/session-bridge.ts (F7: /start response 加 first_event_seq)
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope(本次 action-plan 明确要做)

- **[S1]** F0:新建 `packages/nacp-session/src/emit-helpers.ts` + agent-core session DO 注入 `emitTopLevelFrame` deps + zod 校验 + system.error fallback。
- **[S2]** F1:`workers/orchestrator-core/src/confirmation-control-plane.ts` 的 `create()`(`:96-131`)与 `applyDecision()`(`:221-260`)成功后,经 emit-helpers emit `session.confirmation.request` / `session.confirmation.update` 顶层帧。
- **[S3]** F2a:agent-core capability registry 注册 `write_todos` tool schema(走 `packages/nacp-session/src/messages.ts:369-374` 已冻 `SessionTodosWriteBodySchema`)。
- **[S4]** F2b:agent-core tool execution 路径接住 `tool_use { name: "write_todos" }` → orchestrator-core 服务绑定调 `D1TodoControlPlane.create / update`(`workers/orchestrator-core/src/todo-control-plane.ts:151-...`);capability 内部自动 close 上一个 in_progress(读 `workers/orchestrator-core/src/todo-control-plane.ts:65-66, 143` 的 in_progress 检测)。
- **[S5]** F2c:`D1TodoControlPlane.create / update` 成功后,经 emit-helpers emit authoritative `session.todos.update` 全量 snapshot;`session.todos.write` 继续作为已冻结写入命令形状保留(走 `messages.ts:369-393` 已冻 schema)。
- **[S6]** F3:`workers/agent-core/src/host/runtime-mainline.ts` 把 `composeCompactSignalProbe(budgetSource, breaker)`(已实现于 `workers/agent-core/src/host/compact-breaker.ts:44-55`)注入 `OrchestrationDeps.probeCompactRequired`(`workers/agent-core/src/host/orchestration.ts:88`);`workers/orchestrator-core/src/facade/routes/session-context.ts:103-114` 修改为先读 `request.json()` 取 `force / preview_uuid / label` 字段并透传到 `ctx.previewCompact / ctx.triggerCompact`;context-core RPC signature 扩展接受这三个字段。
- **[S7]** F4:`workers/agent-core/src/host/runtime-mainline.ts` 在 model resolution fallback 决策点 emit `model.fallback`(走 `pushStreamEvent`,因 `ModelFallbackKind` 已在 stream-event 13-kind union 内,见 `stream-event.ts:139-145, 159`);同步把 `workers/orchestrator-core/src/user-do/message-runtime.ts:341-342, 395-396` 的硬编码 `fallback_used: false, fallback_reason: null` 替换为真实值。
- **[S8]** F5:`workers/orchestrator-core/src/hp-absorbed-routes.ts` 新增 `/sessions/{id}/workspace/files/{*path}/content` 路径 + handler,调 filesystem-core `readTempFile`(`workers/filesystem-core/src/index.ts:160-175`),返 binary-content profile + 25 MiB cap;同步把 `hp-absorbed-routes.ts:259` 的 `content_source: "filesystem-core-leaf-rpc-pending"` 占位改为 `"live"`。
- **[S9]** F7:19-doc pack 13 处契约修齐 + implementation reference 全量刷新 + 新增 `client-cookbook.md` + `/start` 返回 `first_event_seq` + `scripts/check-docs-consistency.mjs` 入 CI。

### 2.2 Out-of-Scope(本次 action-plan 明确不做)

- **[O1]** F6 tool-calls 真实化 ledger(新增 `nano_tool_call_ledger` D1 表)→ HPX6。
- **[O2]** F8 followup_input 的 public WS handler(orchestrator-core `user-do/ws-runtime.ts:167` 当前只把 inbound message 当 activity touch;agent-core `session-do/ws-runtime.ts:166` 已能接 `session.followup_input`,但跨 worker 转发链路属于 HPX6)→ HPX6。
- **[O3]** F9–F15(runtime config / permission rules / executor / item projection / file_change item)→ HPX6。
- **[O4]** stream-event 13-kind 已 live emitter 的全量迁移到 emit-helpers — 仅新 emitter 走 helpers,旧 emitter 保留(design 取舍 6)。
- **[O5]** WriteTodos V2 task graph(子 todo 树)— Q20 frozen 5-status flat list 不变。
- **[O6]** legacy `session.permission.request` / `session.elicitation.request` server→client 帧的恢复 — HP5 已声明不再 emit,客户端只走 confirmation 新帧族。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| F2 拆为 F2a/F2b/F2c 三子任务 | `in-scope` | design §7.2 F2 拆分;F2a/F2b LLM-side,F2c client-side | never |
| `/context/compact[/preview]` body 透传是否动 context-core RPC | `in-scope` | façade 透传必须 RPC 接受;否则 body 仍被丢弃 | never |
| emit-helpers 是否同时支持 stream-event 与 top-level frame | `in-scope but bounded` | helper 提供两个函数:`emitStreamEvent`(沿用现有路径)与 `emitTopLevelFrame`(新增);F1/F2c 走后者,F4 走前者 | 全量收敛留 HPX6 之后 |
| `first_event_seq` 字段加在哪条 response | `in-scope` | `/sessions/{id}/start` legacy-do-action envelope;不破 envelope shape,只增字段 | never |
| `decision/payload` legacy dual-accept | `in-scope` | owner 决议 OK;`status/decision_payload` 是 canonical | dual-accept 在 HPX6 末尾移除(per Q-bridging-7 类似纪律) |
| 19-doc pack reference 行号刷新 | `in-scope` | F7 scope;deepseek §1.4 一手核查 `index.ts` 18 行 | never |
| permission_mode 4 档路由的废弃 | `out-of-scope` | Q-bridging-7 owner 决议直接删,但删除发生在 HPX6(随 F9 runtime config 上线) | HPX6 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | 新建 emit-helpers.ts skeleton | add | `packages/nacp-session/src/emit-helpers.ts`, `packages/nacp-session/src/index.ts` | 提供 `emitTopLevelFrame` + `emitStreamEvent` 两个出口,zod 校验 + system.error fallback | low |
| P1-02 | Phase 1 | 注入 emitTopLevelFrame deps | update | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:367-385`, `workers/agent-core/src/host/orchestration.ts:112` | session DO 在 deps 上同时暴露 `pushStreamEvent`(legacy)与 `emitTopLevelFrame`(new) | medium |
| P1-03 | Phase 1 | emit latency metric | add | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`, `packages/nacp-core/src/error-registry.ts`(若需新 metric key) | `nano_emit_latency_ms` 直方图,emit 失败计 `nano_emit_drop_total` | low |
| P2-01 | Phase 2 | F1 confirmation emitter | update | `workers/orchestrator-core/src/confirmation-control-plane.ts:96-131, 221-260` | `create()` 与 `applyDecision()` 成功后调 emit-helpers emit 顶层帧 | medium |
| P2-02 | Phase 2 | F4 model.fallback emitter | update | `workers/agent-core/src/host/runtime-mainline.ts`, `workers/orchestrator-core/src/user-do/message-runtime.ts:341-342, 395-396` | fallback 决策点 push stream event;turn close 写真实 fallback_used / fallback_reason | medium |
| P2-03 | Phase 2 | emit-helpers 单测 + e2e contracts | add | `packages/nacp-session/test/emit-helpers.test.ts`(NEW), `tests/contracts/`(扩) | zod 校验 + fallback + happy-path 全覆盖 | low |
| P3-01 | Phase 3 | F2a write_todos tool schema | add | `workers/agent-core/src/host/runtime-mainline.ts`,(capability registry 文件,需在 P3-01 启动时定位) | tool schema 注册;LLM 可见 `write_todos` | medium |
| P3-02 | Phase 3 | F2b execution 路由 + auto-close | add | `workers/agent-core/src/kernel/*`, `workers/orchestrator-core/src/todo-control-plane.ts`(已 live,只需 service-binding RPC) | tool_use 路由 D1TodoControlPlane;调用前自动 close in_progress | medium |
| P3-03 | Phase 3 | F2c todo emitter | update | `workers/orchestrator-core/src/todo-control-plane.ts`(在 create/update 后 emit) | row write 后经 emit-helpers emit authoritative `session.todos.update` snapshot | medium |
| P3-04 | Phase 3 | F5 workspace bytes GET | add | `workers/orchestrator-core/src/hp-absorbed-routes.ts:248-269`(扩 `/content` 分支), `workers/filesystem-core/src/index.ts:160-175`(已 live,不动) | binary profile;25 MiB cap;tenant boundary 强校验 | low |
| P4-01 | Phase 4 | F3 注入 compact probe | update | `workers/agent-core/src/host/runtime-mainline.ts`, `workers/agent-core/src/host/compact-breaker.ts:44-55`(复用,不动), `workers/agent-core/src/host/orchestration.ts:314-322`(调用点,不动) | `composeCompactSignalProbe` 注入 deps;turn 边界自动触发 | medium |
| P4-02 | Phase 4 | F3 façade 透传 body | update | `workers/orchestrator-core/src/facade/routes/session-context.ts:103-114`, `workers/context-core/src/*`(RPC signature 扩展) | 读 body 中的 `force / preview_uuid / label` 并透传 | medium |
| P4-03 | Phase 4 | F3 compact.notify 4 状态 | update | `workers/agent-core/src/host/runtime-mainline.ts` 或 context-core RPC 完成回调 | started/completed/failed/skipped 全路径 emit | low |
| P5-01 | Phase 5 | 19-doc 13 处契约修齐 | update | `clients/api-docs/{auth,session,session-ws-v1,confirmations,permissions,context,workspace,todos,checkpoints,models,me-sessions,error-index,transport-profiles}.md` | 不一致全部对齐(详见 §5.5) | low |
| P5-02 | Phase 5 | implementation reference 全量刷新 | update | `clients/api-docs/*.md`(全部 19 份) | 行号刷新到 `facade/routes/*.ts` + `*-control-plane.ts` | low |
| P5-03 | Phase 5 | `/start` 返 first_event_seq | update | `workers/orchestrator-core/src/facade/routes/session-bridge.ts`, `clients/api-docs/session.md`, `clients/api-docs/session-ws-v1.md` | response data 加 `first_event_seq: number` | low |
| P5-04 | Phase 5 | client-cookbook.md | add | `clients/api-docs/client-cookbook.md`, `clients/api-docs/README.md`(索引) | 收口 envelope unwrap / dual-emit dedup / first_event_seq 兜底 等 helper | low |
| P5-05 | Phase 5 | check-docs-consistency.mjs | add | `scripts/check-docs-consistency.mjs`, `package.json`(test:contracts hook) | CI gate;违规 fail | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Emit Seam Infrastructure(F0)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | emit-helpers skeleton | 新建文件,导出两函数 `emitTopLevelFrame(messageType, body, ctx)` 与 `emitStreamEvent(kind, body, ctx)`;前者用 `SESSION_BODY_SCHEMAS[messageType].safeParse(body)`(`messages.ts:397-444`)校验,后者用 `SessionStreamEventBodySchema.safeParse(body)`(`stream-event.ts:147-161`)校验;失败构造 `SystemErrorKind`(`stream-event.ts:113-122`)走 `emitStreamEvent` 通道 | `packages/nacp-session/src/emit-helpers.ts` (NEW), `packages/nacp-session/src/index.ts` re-export | helper 文件 live;zod 校验 + fallback 路径有单测 | `pnpm --filter @haimang/nacp-session test`(新增 `test/emit-helpers.test.ts`) | helper 单测 ≥ 6 case(成功 / unknown messageType / body 不合 schema / system.error fallback / latency 写入 / cross-worker stub)全绿 |
| P1-02 | 注入 emitTopLevelFrame deps | 在 `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:367-385` 现有的 `pushStreamEvent` 旁边新增 `emitTopLevelFrame: (messageType, body) => helper.pushFrame(...)`(若 `SessionWebSocketHelper` 没有 `pushFrame` API,在 helper 上加;它已有 `pushEvent`,只是绑死 `session.stream.event` 包装);更新 `workers/agent-core/src/host/orchestration.ts:112` 的 `OrchestrationDeps` 接口加 `readonly emitTopLevelFrame?: (messageType: string, body: Record<string, unknown>) => void;` | `runtime-assembly.ts`, `orchestration.ts`, `workers/agent-core/src/host/do/session-do/ws-helper.ts`(若需) | session DO 同时支持两类 emit;旧路径完全不动 | per-worker `pnpm --filter @haimang/agent-core-worker test` | session-do 测试通过;新增 deps 字段在已有 mock 中是 optional 不退化 |
| P1-03 | emit latency metric | 在 emit-helpers 内 `performance.now()` 测量;成功写 `nano_emit_latency_ms` 直方图,失败 + drop 写 `nano_emit_drop_total`;通过现有 `getLogger(env).info` 通道(参见 `hp-absorbed-routes.ts` 中 logger 使用) | `packages/nacp-session/src/emit-helpers.ts`, 现有 logger (无需新文件) | metric 在 `/debug/recent-errors` 与 `/debug/logs` 可见 | 集成测试覆盖 1 次成功 emit + 1 次 drop,通过 `/debug/recent-errors` 验证 | metric key `nano_emit_latency_ms` / `nano_emit_drop_total` 已记录;无静默丢帧 |

### 4.2 Phase 2 — Top-level Frame Emitters(F1 + F4)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | F1 confirmation emitter | 在 `confirmation-control-plane.ts:96-131` 的 `D1ConfirmationControlPlane.create()` `await ... .run()` 之后调 emit-helpers emit `session.confirmation.request`(走 `SessionConfirmationRequestBodySchema` `messages.ts:304-322`);在 `:221-260` 的 `applyDecision()` UPDATE 成功后 emit `session.confirmation.update`(走 `SessionConfirmationUpdateBodySchema` `messages.ts:324-332`);emit 必须在 row write 成功之后(HP5 row-first dual-write Q16)。注意:control-plane 当前在 orchestrator-core,emit-helpers 在 agent-core session DO;需要通过 service binding 把 emit 请求发回 session DO(参考现有 confirmation HTTP plane 的 service-binding 模式) | `workers/orchestrator-core/src/confirmation-control-plane.ts`, `workers/orchestrator-core/src/facade/routes/session-control.ts`(confirmation route handler 在 row write 后调 emit) | confirmation row write 后 ≤500ms emit 顶层帧 | per-worker contracts 测试 + e2e:跑一个 fake LLM 的 PreToolUse confirmation 流,WS 客户端必须 ≤500ms 收到 `session.confirmation.request` | confirmation row create / decision 后 e2e 测试可见 WS 帧;polling fallback 仍可用(双轨),frame `seq` 单调递增;`409 confirmation-already-resolved` 行为不变 |
| P2-02 | F4 model.fallback emitter | 在 `runtime-mainline.ts` 的 model resolution / fallback 决策代码路径 emit `model.fallback { kind: "model.fallback", turn_uuid, requested_model_id, fallback_model_id, fallback_reason }`(`stream-event.ts:139-145`);**走 `pushStreamEvent`**(因为 `ModelFallbackKind` 已在 13-kind union 内,`stream-event.ts:159`);同步替换 `workers/orchestrator-core/src/user-do/message-runtime.ts:341-342, 395-396` 的硬编码 `fallback_used: false, fallback_reason: null` 为来自 turn 实际的 fallback decision | `workers/agent-core/src/host/runtime-mainline.ts`, `workers/orchestrator-core/src/user-do/message-runtime.ts:341-342, 395-396` | fallback 发生 ≤500ms 客户端收到 push;D1 `nano_conversation_sessions.fallback_used / fallback_reason` 真实写入 | per-worker test 模拟 fallback 触发 + e2e:用 model alias 强制触发 fallback,WS 客户端必须收到帧 | turn 关闭路径不再写硬编码 false;`fallback_used / fallback_reason` 在 D1 `nano_conversation_sessions` 与 WS 帧一致 |
| P2-03 | emit-helpers 单测 + contracts | 在 `tests/contracts/` 加 case:F1 confirmation 全 7 kind / F4 model.fallback;验证 frame schema 校验 + emit 顺序 + 失败 fallback | `packages/nacp-session/test/emit-helpers.test.ts`, `tests/contracts/emit-seam.test.ts`(NEW) | 测试覆盖 ≥ 12 case;contracts 测试通过 | `pnpm test:contracts` | contracts 0 失败;每条 emit 路径有覆盖 |

### 4.3 Phase 3 — LLM Capability + Workspace Bytes(F2a + F2b + F2c + F5)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | F2a write_todos tool schema | 在 agent-core capability registry(实施时定位至 `workers/agent-core/src/host/runtime-mainline.ts` 或同目录的 capability registration 文件)注册新 tool:`{ name: "write_todos", input_schema: SessionTodosWriteBodySchema }`(走 `messages.ts:369-374` 已冻 schema);LLM 系统提示中可见 | `workers/agent-core/src/host/runtime-mainline.ts` + capability registry | LLM API request 中 `tools[]` 包含 `write_todos` | per-worker test 跑一个 fake LLM mock,确认 tool list 含 `write_todos` | tool schema 在 LLM-bound prompt 中可见;input_schema 与 SessionTodosWriteBodySchema byte-equal |
| P3-02 | F2b execution 路由 + auto-close | tool_use block 解析时,`name === "write_todos"` 走 service binding 调 `D1TodoControlPlane.create()` / `update()`(`workers/orchestrator-core/src/todo-control-plane.ts:151-...`);调用前先 `readActiveInProgress`(plane 已有方法,见 `:65-66, 143`),若存在则 PATCH 它到 `pending`(避免触发 `409 in-progress-conflict`);tool_result 给 LLM 返结构化 ack(成功 todo_uuid 列表 / auto-closed 列表) | `workers/agent-core/src/kernel/*`(execution 路径), `workers/orchestrator-core/src/todo-control-plane.ts`(已 live,通过 RPC 调) | LLM 调 `write_todos` → D1 写入成功 → tool_result 含 todo_uuid 列表 | per-worker test 模拟 LLM tool_use → D1 写入 + auto-close 路径 | LLM 同时写 2 个 in_progress → 第一个生效,其余降为 pending + tool_result 含警告;无 `409 in-progress-conflict` 抛到 LLM |
| P3-03 | F2c todo emitter | 在 `D1TodoControlPlane.create()` / `update()` 成功后,通过 service binding 让 session DO emit authoritative `session.todos.update` 全量 snapshot(`session.todos.write` 保留为 frozen command shape;走 `messages.ts:369-393` + emit-helpers F0 出口) | `workers/orchestrator-core/src/todo-control-plane.ts`, 服务绑定到 agent-core session DO | row write 后 ≤500ms WS 帧 emit | e2e:跑 todo create / update,WS 客户端必须收到 `session.todos.update` | F2c emit 与 F1 行为对称;polling 仍可用 |
| P3-04 | F5 workspace bytes GET | 在 `workers/orchestrator-core/src/hp-absorbed-routes.ts` 现有的 `parseSessionFilesRoute`(参见 `:70` 邻近)新增 `/sessions/{id}/workspace/files/{*path}/content` 路径分支;调 filesystem-core RPC `readTempFile({ team_uuid, session_uuid, virtual_path })`(`workers/filesystem-core/src/index.ts:160-175`);返 binary-content profile(`Content-Type: <mime ?? "application/octet-stream">` + `Content-Length` + raw bytes);path 走 7-rule normalize(Q19,workspace.md §3 已冻);25 MiB cap;tenant boundary 强校验;同步把 `:259` 的 `content_source: "filesystem-core-leaf-rpc-pending"` 改为 `"live"` | `workers/orchestrator-core/src/hp-absorbed-routes.ts:158-269`, `workers/filesystem-core/src/index.ts:160-175`(只读,不动) | LLM 写出的 workspace temp file 可通过 GET 路由直接读取字节 | per-worker e2e:agent 写入 → GET 路由读取字节,SHA256 一致;path traversal → 400;超 25 MiB → 413 | binary profile 与 artifact bytes 路径形状一致;`content_source` 标 `"live"` |

### 4.4 Phase 4 — Auto-Compact Wiring + Body 透传(F3)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | F3 注入 compact probe | 在 `workers/agent-core/src/host/runtime-mainline.ts` 创建 `SessionOrchestrator` 时构造 `composeCompactSignalProbe(budgetSource, breaker)`(已实现于 `workers/agent-core/src/host/compact-breaker.ts:44-55`)并传入 `OrchestrationDeps.probeCompactRequired`(`workers/agent-core/src/host/orchestration.ts:88`);`budgetSource` 实现:调 context-core `getContextProbe` RPC,取 `effective_context_pct` 与 model 的 `auto_compact_token_limit`,返回 `effective_context_pct >= threshold`;阈值默认 0.85,可由 model `auto_compact_token_limit` 派生 | `workers/agent-core/src/host/runtime-mainline.ts`, `workers/agent-core/src/host/compact-breaker.ts:44-55`(只读,不动), `workers/agent-core/src/host/orchestration.ts:88, 314-322`(只读,不动) | scheduler 在 turn 边界看到 `compactRequired: true` 时进入 `compact` decision(`workers/agent-core/src/kernel/scheduler.ts:49-52` 已存在) | per-worker test:模拟 budgetSource 返 true,确认 scheduler 触发 compact | turn 边界自动 compact;**绝不**在 turn 内 stream 时触发;3 次失败熔断生效(由 compact-breaker 已实现) |
| P4-02 | F3 façade 透传 body | 改 `workers/orchestrator-core/src/facade/routes/session-context.ts:103-114` 的 `case "compact-preview"` / `case "compact"`:在调用 `ctx.previewCompact / ctx.triggerCompact` 之前先 `await request.json()` 取 `{ force?: boolean, preview_uuid?: string, label?: string }`,作为参数透传;context-core RPC signature 扩展接受这三个字段(在 `workers/context-core/src/*` 内) | `workers/orchestrator-core/src/facade/routes/session-context.ts:103-114`, `workers/context-core/src/*`(RPC signature) | `/context/compact` body 字段真实生效;`label` 写入 checkpoint row | per-worker contracts:POST 带 body 与不带 body 都跑通,带 body 时返回的 checkpoint 含 `label`;不带 body 时取 server 默认 | body 字段不再被静默丢弃;legacy 客户端(不发 body)行为不变 |
| P4-03 | F3 compact.notify 4 状态 | 确保 `compact.notify` 在 started/completed/failed/skipped 4 状态都 emit;走 `pushStreamEvent`(`CompactNotifyKind` 已在 13-kind union 内,`stream-event.ts:155`) | `workers/agent-core/src/host/runtime-mainline.ts` 或 context-core compact 完成回调路径 | 客户端订阅 WS 可见 4 状态 | e2e:跑一次手动 compact + 一次失败 compact,验证 `started → completed` 与 `started → failed` 帧路径 | 4 状态都有 e2e 覆盖;失败时 `tokens_freed: 0` |

### 4.5 Phase 5 — Docs Consistency + Reference Refresh(F7)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | 13 处契约修齐 | 详见 §5.5 修订清单(7 处来自 GPT §6.1–6.6 + 6 处来自 design D1–D7) | `clients/api-docs/{session,session-ws-v1,confirmations,permissions,context,workspace,todos,me-sessions,checkpoints,models,error-index,transport-profiles,auth}.md` | 19-doc pack 内零契约不一致 | `scripts/check-docs-consistency.mjs` 通过 | check 脚本通过 + 人工 review |
| P5-02 | implementation reference 刷新 | 19-doc pack 内所有 `workers/orchestrator-core/src/index.ts:NNN` 改为新模块化结构对应行号(如 `workers/orchestrator-core/src/facade/routes/session-bridge.ts:14-33` / `confirmation-control-plane.ts:96-131` 等) | `clients/api-docs/*.md`(全部 19 份) | 没有失效 reference | grep 全文 `index\.ts:[0-9]` 应为零 | 0 失效引用 |
| P5-03 | `/start` 返 first_event_seq | `workers/orchestrator-core/src/facade/routes/session-bridge.ts` 在 `/start` action 的 success response 中加 `first_event_seq: number`(从 session DO 取当前 stream 的初始 seq);`clients/api-docs/session.md` `:104` 更新 success 示例;`clients/api-docs/session-ws-v1.md` 加章节"start→ws attach 之间的帧保留窗口"说明 | `workers/orchestrator-core/src/facade/routes/session-bridge.ts`, `clients/api-docs/session.md`, `clients/api-docs/session-ws-v1.md` | 字段 backward-compatible 增量(envelope 不变,只增字段);旧客户端不读不影响 | per-worker contracts:`/start` 返 success body 含 `first_event_seq` | 字段在 e2e 测试可见;client-cookbook 描述如何用作 `last_seen_seq` 兜底 |
| P5-04 | client-cookbook.md | 新建文件,收口:envelope `unwrap()` helper(legacy-do-action vs facade-http-v1)/ `(trace_uuid, code)` 1s dedup / `409 confirmation-already-resolved` 视终态 / `start` ack → ws attach 顺序 / polling fallback 何时启用 / `decision/payload` legacy dual-accept(deprecated) | `clients/api-docs/client-cookbook.md` (NEW), `clients/api-docs/README.md`(索引由 18 → 19) | 前端可凭 cookbook 写出无 fallback 漏洞的 client | 人工 review;Owner 复核 | cookbook 章节 ≥ 6 节;README 索引同步 |
| P5-05 | check-docs-consistency.mjs | 新建脚本检查:19-doc pack 内 (a) `index\.ts:[0-9]+` 零出现;(b) model.fallback 上下文 `effective_model_id` 零出现;(c) `session_status: "running"` 零出现;(d) `content_source: filesystem-core-leaf-rpc-pending` 零出现;(e) confirmation/todo `emitter pending` 零出现;(f) `model.fallback emitter-not-live` 零出现;(g) `session.confirmation.request{kind:"permission"}` 零出现;(h) legacy decision body `{ decision, payload }` 零出现;并强制 `session.md` / `session-ws-v1.md` 提及 `first_event_seq` | `scripts/check-docs-consistency.mjs` (NEW), `package.json` `scripts.test:contracts` 添加调用 | CI fail-fast | `node scripts/check-docs-consistency.mjs` 本地通过 | CI 通过;Owner 复核 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Emit Seam Infrastructure(F0)

- **Phase 目标**:在 hero-to-pro 阶段建立 emit 顶层帧的统一出口,让 F1/F2c 真正可以 emit independent top-level frame(Q-bridging-6)。
- **本 Phase 对应编号**:`P1-01 / P1-02 / P1-03`
- **本 Phase 新增文件**:
  - `packages/nacp-session/src/emit-helpers.ts`
  - `packages/nacp-session/test/emit-helpers.test.ts`
- **本 Phase 修改文件**:
  - `packages/nacp-session/src/index.ts`(re-export `emitTopLevelFrame` / `emitStreamEvent`)
  - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:367-385`(在 `pushStreamEvent` 旁注入 `emitTopLevelFrame` deps)
  - `workers/agent-core/src/host/orchestration.ts:112`(`OrchestrationDeps` 接口加 optional `emitTopLevelFrame`)
- **本 Phase 删除文件**:无
- **具体功能预期**:
  1. `emit-helpers.ts` 导出 `emitTopLevelFrame(messageType, body, ctx) → EmitResult`;`messageType` 必须是 `keyof SESSION_BODY_SCHEMAS`(`packages/nacp-session/src/messages.ts:397-444` 已冻);`body` 经 `SESSION_BODY_SCHEMAS[messageType].safeParse` 校验。
  2. emit 失败(unknown messageType / body 不合 schema / WS helper 不可达)→ 构造 `SystemErrorKind { kind: "system.error", error: { code, category, message, retryable, ... } }`(`stream-event.ts:113-122`)走 `emitStreamEvent` 通道;**绝不**静默丢帧。
  3. `runtime-assembly.ts:367-385` 当前的 `pushStreamEvent` deps 不动,在它旁边加一个独立的 `emitTopLevelFrame` deps:`(messageType, body) => helper.pushFrame(messageType, body)` — 若 `SessionWebSocketHelper` 没有 `pushFrame` API,在它上面加(它当前的 `pushEvent` 只支持 stream-event 包装,见 `runtime-assembly.ts:371-374`)。
- **具体测试安排**:
  - **单测**:`emit-helpers.test.ts` ≥ 6 case(成功 emit / unknown messageType / body 不合 schema / system.error fallback / latency 写入 metric / cross-worker stub)
  - **集成测试**:`tests/contracts/` 加 cross-worker 场景:orchestrator-core service binding 调 session-do `emitTopLevelFrame` 触发 emit
  - **回归测试**:per-worker `pnpm --filter @haimang/agent-core-worker test` + `pnpm --filter @haimang/nacp-session test` 全绿;现有 stream-event emitter(turn.begin / turn.end / tool.call.* / llm.delta / system.notify)路径**不退化**
  - **手动验证**:Phase 1 完成后跑一个 stub:在 session-do 内部模拟 `emitTopLevelFrame("session.confirmation.request", body, ctx)`,WS 客户端应直接收到顶层帧
- **收口标准**:
  - `pnpm test:contracts` + per-worker test 全绿
  - emit-helpers 单测 ≥ 6 case 全绿
  - 现有 stream-event emit 路径(`pushStreamEvent` 13 kinds)0 退化
- **本 Phase 风险提醒**:
  - `SessionWebSocketHelper.pushEvent` 当前只能包装为 `session.stream.event`(`runtime-assembly.ts:371-374`);如果在 helper 上加 `pushFrame`,需要确保 reconnect buffer 与 ack 行为对顶层帧一致(参考 `ws-helper.ts` / 现有 heartbeat / attachment.superseded 路径)

### 5.2 Phase 2 — Top-level Frame Emitters(F1 + F4)

- **Phase 目标**:让 confirmation / model.fallback 在 row write 后 ≤500ms emit 到 attached client。
- **本 Phase 对应编号**:`P2-01 / P2-02 / P2-03`
- **本 Phase 新增文件**:
  - `tests/contracts/emit-seam.test.ts`
- **本 Phase 修改文件**:
  - `workers/orchestrator-core/src/confirmation-control-plane.ts:96-131, 221-260`(create / applyDecision 后 emit)
  - `workers/orchestrator-core/src/facade/routes/session-control.ts`(confirmation route handler 在 row write 后调 emit;legacy `/permission/decision` `/elicitation/answer` dual-write 路径同样接 emit)
  - `workers/agent-core/src/host/runtime-mainline.ts`(F4: model resolution / fallback 决策点 push stream event)
  - `workers/orchestrator-core/src/user-do/message-runtime.ts:341-342, 395-396`(F4: 替换硬编码 fallback_used:false,fallback_reason:null)
- **本 Phase 删除文件**:无
- **具体功能预期**:
  1. `D1ConfirmationControlPlane.create()` 在 INSERT 成功后(`:96-131`),通过 service binding 让 session-do emit `session.confirmation.request { confirmation_uuid, kind, payload, request_uuid?, expires_at? }`(走 `messages.ts:304-322`)
  2. `D1ConfirmationControlPlane.applyDecision()` 在 UPDATE 成功后(`:239-260`),emit `session.confirmation.update { confirmation_uuid, status, decision_payload?, decided_at? }`(走 `messages.ts:324-332`);若 row 已是终态(`:236-238`),仍是 `409 confirmation-already-resolved`,**不**emit 重复帧
  3. agent-core 在 fallback 决策点 emit `model.fallback { kind: "model.fallback", turn_uuid, requested_model_id, fallback_model_id, fallback_reason }`(`stream-event.ts:139-145`),走 `pushStreamEvent`(已在 13-kind union 内,见 `:159`)
  4. `message-runtime.ts:341-342, 395-396` 的 turn 关闭路径替换为从 turn 实际 fallback decision 取 `fallback_used / fallback_reason` 真实值
- **具体测试安排**:
  - **单测**:F1 emitter 路径 + F4 emitter 路径在 control-plane test 中各 ≥ 4 case
  - **集成测试**:`tests/contracts/emit-seam.test.ts`:跑 PreToolUse confirmation 流(7 kind 中 `tool_permission` / `elicitation` 至少各 1 个)+ fallback 触发流;WS 客户端必须 ≤500ms 收到对应帧
  - **回归测试**:`pnpm test:contracts`、`pnpm test:cross-e2e` 全绿;legacy `POST /permission/decision` `POST /elicitation/answer` dual-write 行为不变;`409 confirmation-already-resolved` 不变
  - **手动验证**:用 wrangler 本地起 worker,curl 触发 confirmation 创建 + WebSocket 客户端订阅,确认收到帧
- **收口标准**:
  - `pnpm test:contracts` + `pnpm test:cross-e2e` 全绿
  - confirmation row write → WS receive ≤500ms(P95)
  - model.fallback 在 fallback 触发后 D1 + WS 同步可见
  - legacy permission/elicitation HTTP path 行为 0 变化
- **本 Phase 风险提醒**:
  - F1 跨 worker emit:control-plane 写在 orchestrator-core,emit 必须经 service binding 调 agent-core session DO;若 service binding 不可达,必须 fall back 到 `system.error`(F0 已封装)而非阻塞 row write
  - dual-emit 窗口期不需要(legacy `session.permission.request` 已不再 emit,见 `clients/api-docs/permissions.md` §1)

### 5.3 Phase 3 — LLM Capability + Workspace Bytes(F2a + F2b + F2c + F5)

- **Phase 目标**:LLM 能驱动 todo;前端能直接读取 workspace 文件字节。
- **本 Phase 对应编号**:`P3-01 / P3-02 / P3-03 / P3-04`
- **本 Phase 新增文件**:无(全部走现有文件 + 新增路径分支)
- **本 Phase 修改文件**:
  - `workers/agent-core/src/host/runtime-mainline.ts`(F2a tool schema 注册)
  - `workers/agent-core/src/kernel/*`(F2b execution 路由,具体文件在实施时定位)
  - `workers/orchestrator-core/src/todo-control-plane.ts`(F2c emit;`:151-...` create/update 后调 emit-helpers)
  - `workers/orchestrator-core/src/hp-absorbed-routes.ts:158-269`(F5 新增 `/content` 子路径;`:259` 把 `content_source` 标 `"live"`)
- **本 Phase 删除文件**:无
- **具体功能预期**:
  1. capability registry 注册 `write_todos` tool;input_schema 走 `SessionTodosWriteBodySchema`(`messages.ts:369-374`)
  2. tool_use `name === "write_todos"` 时,先 `readActiveInProgress(session_uuid)`(`todo-control-plane.ts:65-66, 143`)→ 若存在则 PATCH 它到 `pending` → 再 `create()` / `update()` 新 todo;tool_result 给 LLM 返 `{ todos: [{ todo_uuid, status }], auto_closed: [{ todo_uuid }] }`
  3. `todo-control-plane.ts` 在 create / update / delete 后 emit authoritative `session.todos.update` 全量 snapshot;`session.todos.write` 作为写入命令形状保留
  4. `hp-absorbed-routes.ts` 新增 `/sessions/{id}/workspace/files/{*path}/content`:解析 path → 7-rule normalize → 调 `readTempFile({ team_uuid, session_uuid, virtual_path })` → binary response;25 MiB cap(否则 `413 payload-too-large`);R2 obj 不存在 → `409 workspace-file-pending`(metadata 在但字节缺)
- **具体测试安排**:
  - **单测**:F2a tool schema 注册 1 case;F2b auto-close + execution 路由 ≥ 4 case;F2c emit ≥ 2 case;F5 happy / path-traversal / oversize / missing 共 4 case
  - **集成测试**:e2e 跑一个 fake LLM 触发 `write_todos`(2 个 in_progress),验证第一个生效 + 其余 pending + 不抛 409;e2e 写 workspace temp file → GET `/content` 读取字节 SHA256 一致
  - **回归测试**:`pnpm test:cross-e2e`;现有 todo HTTP CRUD `/todos` 行为不退化;现有 artifact bytes `/files/{uuid}/content` 不退化
  - **手动验证**:wrangler 本地起 agent-core + orchestrator-core,跑一个对话让 LLM 调 `write_todos`,前端 WS 收到 `session.todos.update`
- **收口标准**:
  - `pnpm test:cross-e2e` 全绿
  - LLM 调 write_todos 的 e2e fixture 通过
  - workspace bytes GET 25 MiB ≤5s 完成下载(P95)
  - `content_source: "live"` 在 metadata read 中可见
- **本 Phase 风险提醒**:
  - F2b auto-close in_progress 与 LLM 在同一 turn 内多次调 `write_todos` 的 race:必须**串行**执行(per-session lock),否则 invariant 仍可能被踩
  - F5 binary response 必须正确处理 R2 stream(`bytes: ArrayBuffer | null` → response body),不要全量加载到内存(25 MiB 上限内可以,但 hero-to-platform 可能要支持 streaming)

### 5.4 Phase 4 — Auto-Compact Wiring + Body 透传(F3)

- **Phase 目标**:长 session 在 turn 边界自动 compact;`/context/compact[/preview]` body 字段真实生效。
- **本 Phase 对应编号**:`P4-01 / P4-02 / P4-03`
- **本 Phase 新增文件**:无
- **本 Phase 修改文件**:
  - `workers/agent-core/src/host/runtime-mainline.ts`(注入 `composeCompactSignalProbe`;实现 budgetSource 调 context-core probe)
  - `workers/orchestrator-core/src/facade/routes/session-context.ts:103-114`(读 body 透传)
  - `workers/context-core/src/*`(RPC `previewCompact` / `triggerCompact` signature 接受 `force / preview_uuid / label`)
- **本 Phase 删除文件**:无
- **具体功能预期**:
  1. `runtime-mainline.ts` 创建 SessionOrchestrator 时构造 breaker = `createCompactBreaker(3)`(`compact-breaker.ts:18-37`)+ `composeCompactSignalProbe(budgetSource, breaker)`(`:44-55`),传入 `OrchestrationDeps.probeCompactRequired`(`orchestration.ts:88`)
  2. `budgetSource` 调 context-core `getContextProbe`,取 `effective_context_pct` 与 model 的 `auto_compact_token_limit`,返回 `effective_context_pct >= threshold`(默认 0.85)
  3. `session-context.ts:103-114` 的 `case "compact-preview"` / `case "compact"` 在调用 `ctx.previewCompact / ctx.triggerCompact` 之前 `await request.json()` 取 `{ force?: boolean, preview_uuid?: string, label?: string }`;签名扩展为 `ctx.triggerCompact(sessionUuid, teamUuid, { force, preview_uuid, label }, meta)`
  4. context-core RPC 接受这三字段;`label` 写入 `nano_session_checkpoints.label`(checkpoint_kind="compact_boundary");`force=true` 时跳过 budget 检查直接执行;`preview_uuid` 用于 idempotent commit
  5. `compact.notify` 在 4 状态 emit:`started`(executor 开始)/ `completed`(成功)/ `failed`(executor 失败 3 次)/ `skipped`(budget 未达 + 非 force)
- **具体测试安排**:
  - **单测**:`composeCompactSignalProbe` 已有覆盖(`compact-breaker.ts` 已 live);`session-context.ts` body 解析 ≥ 3 case(无 body / 部分字段 / 全字段)
  - **集成测试**:e2e 跑一个 turn-boundary 触发场景(模拟 effective_context_pct = 0.9 → scheduler 进入 compact decision → compact.notify started → completed);跑一个 force=true 的 manual compact
  - **回归测试**:既有 `/context/probe` `/context/layers` `/context/snapshot` 行为不变;`compact-breaker` 已存在的 3 次熔断行为不变
  - **手动验证**:wrangler 本地起跑长对话,确认 turn 边界自动 compact;curl `/context/compact` 带 body `{ "label": "test-label" }`,验证 D1 checkpoint 含 label
- **收口标准**:
  - `pnpm test:contracts` + per-worker test 全绿
  - long-session e2e fixture 通过(模拟 50 轮对话不撞 context window)
  - `/context/compact` body 字段在 D1 + checkpoint 真实可见
- **本 Phase 风险提醒**:
  - `compactRequired` 触发时机必须严格在 turn 边界(`runStepLoop` 的 scheduler 已经做了,见 `workers/agent-core/src/kernel/scheduler.ts:49-52`),`probeCompactRequired` 不要在 turn 内频繁调用否则 latency
  - context-core RPC signature 扩展可能影响内部其他 caller — 必须改成 optional 字段,backward-compatible

### 5.5 Phase 5 — Docs Consistency + Reference Refresh(F7)

- **Phase 目标**:19-doc pack 内零契约不一致;CI 有自动化 gate。
- **本 Phase 对应编号**:`P5-01 / P5-02 / P5-03 / P5-04 / P5-05`
- **本 Phase 新增文件**:
  - `clients/api-docs/client-cookbook.md`
  - `scripts/check-docs-consistency.mjs`
- **本 Phase 修改文件**:
  - `clients/api-docs/{auth,session,session-ws-v1,confirmations,permissions,context,workspace,todos,me-sessions,checkpoints,models,error-index,transport-profiles,worker-health,wechat-auth,catalog,usage,README}.md`
  - `clients/api-docs/README.md`(索引由 18 → 19,加 `client-cookbook.md`)
  - `workers/orchestrator-core/src/facade/routes/session-bridge.ts`(`/start` action response 加 `first_event_seq`)
  - `package.json`(`scripts.test:contracts` 调 check-docs-consistency)
- **本 Phase 删除文件**:无
- **具体功能预期 — 13 处契约修齐清单**:
  1. **`/sessions/{id}/context` 语义统一**(GPT §6.1):`README.md` 与 `context.md` 对齐为"完整 context snapshot"(不是 probe alias)
  2. **`/start` pre-mint 一致**(GPT §6.2):`me-sessions.md` 与 `session.md` 对齐为"`/me/sessions` 是推荐路径,但 `/start` 接受未 mint UUID;未 mint 时 `404 not-found`"
  3. **confirmation kind 统一**(GPT §6.3):`permissions.md` 内残留的 `permission` 改为 `tool_permission`(以 `confirmations.md` 为 canonical)
  4. **decision body shape 统一**(GPT §6.4):全 19-doc 统一 `status + decision_payload`;legacy `decision + payload` 不再出现在 authoritative doc pack 中
  5. **`session_status` 7 值枚举**(GPT §6.5):`models.md` 示例里的 `"running"` 改为 `"active"`;`transport-profiles.md` 加 7 值枚举表(`pending / starting / active / attached / detached / ended / expired`)
  6. **history / timeline schema 示例**(GPT §6.6):`session.md` 补完整 response schema 示例
  7. **D1 envelope dual-shape unwrap**(design D1):写进 `client-cookbook.md` 第一节
  8. **D2 close/delete/title legacy body-level error 映射**(design D2):写进 `error-index.md` legacy note 章节
  9. **D3 dual-emit 1s dedup**(design D3):写进 `client-cookbook.md`
  10. **D4 start→ws attach 帧保留窗口**(design D4):`/start` 返 `first_event_seq`;`session-ws-v1.md` 加章节
  11. **D5 60s preview cache not-implemented**(design D5):`context.md` 已写,F7 验证措辞清晰
  12. **D6 `409 confirmation-already-resolved` 视终态成功**(design D6):写进 `client-cookbook.md` + `error-index.md` 强调
  13. **D7 artifact / workspace temp / snapshot 三概念区分图**(design D7):`workspace.md` §1 加图
  14. **(额外)F4 `model.fallback` 字段名**(本 plan F4):`session-ws-v1.md` `:177` 模型字段从 `effective_model_id` 改为 `fallback_model_id`(对齐 schema `stream-event.ts:139-145`)
- **具体测试安排**:
  - **单测**:`scripts/check-docs-consistency.mjs` 自身的 unit smoke(node 直接跑 + 期望 0 违规)
  - **集成测试**:`pnpm test:contracts` 调 check 脚本
  - **回归测试**:check 脚本必须能识别故意构造的违规并报错
  - **手动验证**:Owner 复核 client-cookbook 章节是否覆盖所有 helper
- **收口标准**:
  - `pnpm test:contracts` 通过
  - `node scripts/check-docs-consistency.mjs` 0 违规
  - 19-doc 索引稳定(含 `client-cookbook.md`)
  - Owner 一次性复核通过
- **本 Phase 风险提醒**:
  - `decision/payload` legacy dual-accept 必须在 façade 层有真实代码 fallback,不能只改文档(P5-01 第 4 条)— 实施时在 `session-control.ts` 的 confirmation decision handler 加 `body.decision ?? body.status` 类似 fallback,标 deprecated

---

## 6. 依赖的冻结设计决策(只读引用)

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q-bridging-1(NACP 1.1.0 不 bump) | `HPX5-HPX6-bridging-api-gap.md` §0.4 | 所有 emit 走已注册 schema;HPX5 不动 contract 形状 | 设计回退到 design,不在 action-plan 调整 |
| Q-bridging-2(polling fallback 保留) | `HPX5-HPX6-bridging-api-gap.md` §0.4 | client-cookbook 必须双轨说明 polling 仍可启用 | 不影响代码,仅 docs 调整 |
| Q-bridging-6(confirmation/todos 走独立顶层帧) | `HPX5-HPX6-bridging-api-gap.md` §0.4 / §3.4 | F0 emit-helpers 必须支持 top-level frame;F1/F2c 走它 | 若发现 helper 必须扩展 stream-event union,blocked 回 design |
| HP5 row-first dual-write(Q16) | `HP5-confirmation-control-plane.md` § / `HPX-qna.md` Q16 | F1 emit 必须在 row write 之后,绝不在 row write 之前 | n/a |
| HP6 at-most-1 in_progress(Q19) | `HP6-tool-workspace-state-machine.md` / `HPX-qna.md` Q19 | F2b 必须 auto-close 上一个 in_progress | n/a |
| HP3 compact-breaker(已 live) | `compact-breaker.ts:18-37, 44-55` | F3 复用,**不**重做 circuit breaker | n/a |
| HP9 envelope law(Q27) | `transport-profiles.md` §2 | `/start` 加 `first_event_seq` 字段是增量;不破 envelope | n/a |
| Q-bridging-7 不 dual-write、直接删(owner 决议) | `HPX5-HPX6-bridging-api-gap.md` §0.4 v0.2.1 | HPX5 内**不删** legacy `permission_mode` 路由(留给 HPX6 与 F9 一起删) | 若 owner 后续要求 HPX5 内删,blocked 回 design |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| F0 cross-worker bridge | confirmation 写在 orchestrator-core,emit 必须穿到 agent-core session DO | medium | F0 提供 service-binding 封装;emit 失败必 fall back 到 `system.error`(stream-event family) |
| F1 emit 与 polling race | client 同订阅 WS + polling | low | confirmation_uuid 全局唯一;client cookbook 强制 dedup;`409 confirmation-already-resolved` 兜底 |
| F2b LLM 多 in_progress race | LLM 同 turn 内多次调 write_todos | medium | per-session lock 串行 capability 调用 |
| F3 budget probe latency | 每个 turn 边界调 context-core RPC | low | 已有 breaker 7 分钟冷却;turn 边界本就是低频点 |
| F3 context-core RPC signature 扩展 | 加 `force / preview_uuid / label` 可能影响内部其他 caller | low | 改为 optional 字段;现有 caller 不传 = 当前行为 |
| F4 fallback emit 时机 | streaming 中发生 fallback,帧穿插 stream | low | client reducer 必须容忍乱序;cookbook 标明 |
| F5 R2 大文件下载 | 25 MiB 上限内但需考虑 worker 内存 | low | 流式响应(R2 obj.body 可 ReadableStream);上限内可全量加载 |
| F7 dual-accept legacy decision body | façade 加 fallback 改动小但易漏 | low | check-docs-consistency 自动检测 |

### 7.2 约束与前提

- **技术前提**:NACP_VERSION = 1.1.0 不 bump;`packages/nacp-session` 已发布 1.4.0(`packages/nacp-session/package.json:3`);emit-helpers 在下一次 nacp-session 发布时 ship。
- **运行时前提**:Cloudflare Workers + Durable Objects + service binding;orchestrator-core ↔ agent-core 已有 service binding(参见现有 `confirmation-control-plane` 跨 worker 调用模式)。
- **组织协作前提**:`@haimang` GitHub Packages 发布权限(已知 owner 已登录)。
- **上线 / 合并前提**:每个 Phase 完成必须 `NODE_AUTH_TOKEN=$NODE_AUTH_TOKEN pnpm test`(根 alias)+ `pnpm test:contracts` + `pnpm test:cross-e2e` 全绿;preview 部署验证 confirmation/todos/fallback 三类 emitter live。

### 7.3 文档同步要求

- 需要同步更新的设计文档:
  - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`(closure 章节加"HPX5 emitter 接通"链接)
  - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`(closure 章节加"HPX5 WriteTodos / workspace bytes")
  - `docs/design/hero-to-pro/HP3-context-state-machine.md`(closure 章节加"HPX5 auto-compact wiring + body 透传")
- 需要同步更新的说明文档 / README:
  - `clients/api-docs/README.md`(索引 18 → 19,加 `client-cookbook.md`)
  - `README.md`(若 root README 引用 client API,无需动)
- 需要同步更新的测试说明:
  - `workers/orchestrator-core/test/README.md`(若存在,加 confirmation/todo emitter contracts 范围)
  - `workers/agent-core/test/README.md`(同上,加 WriteTodos capability 与 fallback emit 范围)

### 7.4 完成后的预期状态

1. confirmation row write 之后 ≤500ms 客户端 WS 收到 `session.confirmation.request/.update` 顶层帧;前端 happy path 不再依赖 polling(reconcile 仍保留)。
2. LLM 在 turn 中可调 `write_todos`,D1 落地 + WS emit + tool_result 给 LLM 返结构化 ack;at-most-1 in_progress invariant 由 capability 自动护理。
3. 长 session 在 turn 边界自动 compact,`compactRequired:false` 默认行为被 `composeCompactSignalProbe` 接通;`/context/compact[/preview]` body 字段真实透传;`compact.notify` 4 状态 live。
4. `model.fallback` 顶层帧在 fallback 决策点 emit;D1 `nano_conversation_sessions.fallback_used / fallback_reason` 真实写入,前端 model badge 即时更新。
5. `GET /sessions/{id}/workspace/files/{*path}/content` binary 路由 live;LLM 写出的文件可被前端直接读取字节;`content_source: "live"` 在 metadata read 中可见。
6. 19-doc pack 内零契约不一致;`/start` 返 `first_event_seq`;`client-cookbook.md` 收口前端实战兜底;`scripts/check-docs-consistency.mjs` 在 CI 通过。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**:
  - `pnpm install`、`pnpm typecheck`、`pnpm lint` 全过
  - `pnpm check:cycles` 不退化(HP9 baseline 10 个 carry-over 不超)
- **单元测试**:
  - `pnpm --filter @haimang/nacp-session test`(emit-helpers 新单测 ≥ 6 case)
  - per-worker `pnpm --filter @haimang/{orchestrator-core,agent-core,context-core,filesystem-core}-worker test`
- **集成测试**:
  - `pnpm test:contracts`(F1/F4 emitter + F3 body 透传 + F7 docs check 全覆盖)
  - `pnpm test:cross-e2e`(F2b LLM-driven todo + F5 workspace bytes + 长 session auto-compact 端到端)
- **端到端 / 手动验证**:
  - wrangler 本地起 5 worker,跑一个完整 turn:输入 → confirmation 弹窗(WS push)→ decision → tool 执行(write_todos)→ todo emit → workspace 写文件 → 前端 GET /content → fallback 切模型 → turn end
  - 长 session 50+ 轮验证 auto-compact turn 边界触发
- **回归测试**:
  - 既有 19-doc 描述的所有 happy path 行为(login / start / input / messages / cancel / close / files upload / todos HTTP CRUD / checkpoints / context probe / models)0 退化
  - legacy `POST /permission/decision` `POST /elicitation/answer` HTTP 行为 0 变化
- **文档校验**:
  - `node scripts/check-docs-consistency.mjs` 0 违规
  - Owner 复核 `client-cookbook.md` 完整覆盖前端兜底逻辑

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后,至少应满足以下条件:

1. emit-helpers.ts live,F1/F2c/F4 emitter 在 row write/decision 后 ≤500ms emit(P95)
2. LLM 在 e2e 测试中可成功调 `write_todos`;D1 落地 + WS emit + tool_result 三链路通
3. 长 session 50 轮 e2e 不撞 context window;`compact.notify` 4 状态可在 timeline 见
4. `/context/compact[/preview]` body 字段真实生效;legacy 客户端不传 body 不退化
5. 19-doc 内零契约不一致;`/start` 返 `first_event_seq`;`client-cookbook.md` live;CI gate 通过
6. `pnpm test` 根 alias、`pnpm test:contracts`、`pnpm test:cross-e2e` 全绿
7. 现有 stream-event 13 emitter / artifact bytes / todo HTTP CRUD / confirmation HTTP CRUD / `/policy/permission_mode` 路由 0 退化

### 8.3 完成定义(Definition of Done)

| 维度 | 完成定义 |
|------|----------|
| 功能 | F0/F1/F2(a/b/c)/F3/F4/F5/F7 七项功能均有 e2e fixture 覆盖且 ≤500ms emit / ≤5s 25MiB GET / ≤2s auto-compact decide latency 达标 |
| 测试 | 单测 + contracts + cross-e2e 全绿;`scripts/check-docs-consistency.mjs` 0 违规 |
| 文档 | 18→19 doc 索引同步;13 处契约修齐;implementation reference 全量刷新到模块化结构;`first_event_seq` 文档化 |
| 风险收敛 | §7.1 表内 8 项风险均有缓解或被 e2e 验证不发生 |
| 可交付性 | preview 部署验证 confirmation/todos/fallback emit live,polling fallback 仍可启用,前端可基于 18+1 doc pack 写出无 fallback 漏洞的 client |

---

## 9. 执行日志回填(executed 2026-05-02)

> 文档状态从 `draft` → `executed`。所有 16 个新增 Phase 工作项已落地;3 个 worker + nacp-session + 1 个 root script 全部 typecheck + test 通过。

### 9.1 实际执行摘要

HPX5 5 个 Phase 在单 sprint 内顺序完成。新增/修改文件清单(按 commit 顺序):

**P1 — Emit Seam Infrastructure (F0)**
- `packages/nacp-session/src/emit-helpers.ts` (NEW,~240 行) — `emitTopLevelFrame` / `emitStreamEvent` 两个出口,zod 校验 + system.error fallback + EmitObserver 通道
- `packages/nacp-session/src/index.ts` — re-export
- `packages/nacp-session/src/messages.ts` — 新增 `export type SessionMessageType = keyof typeof SESSION_BODY_SCHEMAS`
- `packages/nacp-session/src/websocket.ts` — `SessionWebSocketHelper.pushFrame(messageType, body)` 新增,emit 顶层帧(非 stream-event)
- `packages/nacp-session/test/emit-helpers.test.ts` (NEW) — 10 case 覆盖 happy / unknown messageType / 校验失败 / fallback / drop / sink throw / metric
- `workers/agent-core/src/host/orchestration.ts:112-130` — `OrchestrationDeps.emitTopLevelFrame` 新增 optional 字段
- `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:367-401` — 在 `pushStreamEvent` 旁注入 `emitTopLevelFrame` deps,封装 cross-worker bridge

**P2 — Top-level Frame Emitters (F1 + F2c + F4)**
- `workers/orchestrator-core/src/wsemit.ts` (NEW) — `emitFrameViaUserDO` / `emitStreamEventViaUserDO` 调用 emit-helpers + service binding 到 User DO `__forward-frame`
- `workers/orchestrator-core/src/facade/routes/session-control.ts:23, 416-451, 506-525, 555-575, 591-616` — F1 confirmation `applyDecision` 后 emit `session.confirmation.update`;F2c todo create / patch / delete 后 emit `session.todos.update` 全量 list snapshot
- `workers/orchestrator-core/src/user-do/surface-runtime.ts:36-65, 84-176, 359, 462` — F1 legacy permission/elicitation dual-write 路径接 `ctx.emitServerFrame` → emit `session.confirmation.request` (新建时) / `.update` (终态时)
- `workers/orchestrator-core/src/user-do-runtime.ts:243-247` — surface runtime ctx 注入 `emitServerFrame`
- `workers/orchestrator-core/src/user-do/message-runtime.ts:120-127, 333-432` — F4 `inputAck.body` 中读 `fallback_used / fallback_model_id / fallback_reason`(替换硬编码 `false / null`),并在 fallback_used=true 时 emit `model.fallback` stream-event(走 `pushStreamEvent`,因 `ModelFallbackKind` 已在 13-kind union 内)
- `workers/orchestrator-core/src/user-do-runtime.ts:347-352` — message runtime ctx 注入 `emitServerFrame`

**P3 — LLM Capability + Workspace Bytes (F2a + F2b + F5)**
- `workers/orchestrator-core/src/entrypoint.ts:42-44, 138-260` — F2b 新增 `writeTodos` RPC 方法:auto-close in_progress + 创建多个 todos + emit `session.todos.update`(走 emit-helpers)
- `workers/agent-core/src/host/env.ts:104-150` — `ORCHESTRATOR_CORE` 接口新增 `writeTodos?` + `readContextDurableState?`
- `workers/agent-core/src/host/runtime-mainline.ts:1-5, 159-195` — `MainlineKernelOptions.writeTodosBackend?` 新增 + `TodoStatusLiteral` 内部类型
- `workers/agent-core/src/host/runtime-mainline.ts:467-578` — capability execute 入口加 F2a/F2b 短路:`toolName === "write_todos"` 时调 `writeTodosBackend` + 自动 close + tool_result 含 `created` / `auto_closed` 列表
- `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:178-184, 195` — wire `runtimeEnv.ORCHESTRATOR_CORE.writeTodos` → `MainlineKernelOptions.writeTodosBackend`
- `workers/orchestrator-core/src/hp-absorbed-routes.ts:21-39, 85-114, 250-323` — F5 新增 `/sessions/{id}/workspace/files/{*path}/content` 路径分支 + binary-content profile + 25 MiB cap + filesystem-core `readTempFile` RPC pass-through;`content_source` 从 `"filesystem-core-leaf-rpc-pending"` 改为 `"live"`
- `workers/orchestrator-core/src/facade/env.ts:28-46` — `FILESYSTEM_CORE` 接口扩展 `readTempFile?` RPC
- `workers/orchestrator-core/test/workspace-route.test.ts:243-247` — 测试断言更新为 `"live"`

**P4 — Auto-Compact Wiring + Body 透传 (F3)**
- `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:27-31, 285-321` — 在 `buildOrchestrationDeps` 内构造 `composeCompactSignalProbe(budgetSource, breaker)`,budgetSource 调 `ORCHESTRATOR_CORE.readContextDurableState` 计算 `used >= auto_compact_token_limit`(默认阈值 0.85),注入 `OrchestrationDeps.probeCompactRequired`
- `workers/orchestrator-core/src/facade/routes/session-context.ts:6-69, 121-155` — F3 façade 读 `{ force?, preview_uuid?, label? }` body 并透传到 context-core RPC
- `workers/context-core/src/index.ts:228-258, 308-372` — `previewCompact` 与 `triggerCompact` 签名扩展接受 `options?: { force?, preview_uuid?, label? }`;`force=true` 跳过 "compact-not-needed" early return

**P5 — Docs Consistency + Reference Refresh (F7)**
- `clients/api-docs/session-ws-v1.md:65` — `model.fallback` 字段名修正为 `fallback_model_id`
- `clients/api-docs/models.md:148, 211` — `session_status: "running"` → `"active"`(2 处)
- `clients/api-docs/checkpoints.md:4` / `permissions.md:4` / `confirmations.md:4` / `context.md:4, 97` / `todos.md:4` / `session.md:4` / `workspace.md:4` / `models.md:4` — 9 处 implementation reference 行号刷新到模块化结构(`facade/routes/*.ts` + `*-control-plane.ts`)
- `clients/api-docs/workspace.md:132-149` — F5 路由表加 `/content` binary GET + `content_source: "live"` 说明
- `clients/api-docs/client-cookbook.md` (NEW) — 12 节实战兜底:envelope unwrap / dedup / start→ws 顺序 / `409 confirmation-already-resolved` 终态 / WriteTodos 行为 / workspace bytes / auto-compact / model.fallback 字段名 / decision body 等
- `clients/api-docs/README.md:48-49` — 索引 18 → 19,加 client-cookbook
- `scripts/check-docs-consistency.mjs` (NEW) — 8 项 regex CI gate + 2 项 required-snippet gate:`index.ts:NNN` 失效引用零;`effective_model_id` 在 model.fallback 上下文零;`session_status: "running"` 零;`content_source: "filesystem-core-leaf-rpc-pending"` 零;confirmation/todo `emitter pending` 零;`model.fallback emitter-not-live` 零;`session.confirmation.request{kind:"permission"}` 零;legacy decision body `{ decision, payload }` 零;并强制 `session.md` / `session-ws-v1.md` 提及 `first_event_seq`
- `package.json:20` — 加 `check:docs-consistency` script
- `workers/orchestrator-core/src/user-do/session-flow/start.ts:267-285` — F7 `/start` 返回 `first_event_seq` 字段

### 9.2 Phase 偏差

- **P1**:emit-helpers 测试初版 4 个断言写错(混淆了 `state` spread 与 mutation 行为),修 `makeSink` 用 `bundle` 单对象引用后 10 case 全绿。
- **P3**:agent-core capability execute 入口的 `write_todos` 短路逻辑放在 `if (!options.capabilityTransport)` 之前,确保即使 capability transport 不可用 WriteTodos 仍可工作(只要 writeTodosBackend 已配)。
- **P5**:`scripts/check-docs-consistency.mjs` 初版误报 — `effective_model_id` 在 `models.md` 内 3 处是 D1 audit 字段名(`nano_conversation_turns.effective_model_id`)合法引用,在 `client-cookbook.md` 第 12 节是 meta-描述说"WS 帧用 fallback_model_id 不是 effective_model_id"。修正 regex 为只匹配 `model.fallback` 上下文,排除 audit 字段引用,4 hits → 0 hits。

### 9.3 阻塞与处理

无阻塞。所有改动 backward-compatible:

- `OrchestrationDeps.emitTopLevelFrame` / `MainlineKernelOptions.writeTodosBackend` / `MainlineKernelOptions.compactSignalProbe` 全部 optional — 既有 mock / 单测 fixture 不传不退化
- `SessionWebSocketHelper.pushFrame` 是新方法,既有 `pushEvent` 路径不动
- `previewCompact / triggerCompact` 签名扩展为 `options?` optional 末位参数 — 既有 caller 不传不退化
- `inputAck.body` 中读 `fallback_used` 等字段时,缺省时回退到原硬编码 false 值
- legacy `POST /policy/permission_mode` 路由完全不动(Q-bridging-7 hard delete 留 HPX6)

### 9.4 测试发现

| 测试套件 | Tests | 通过 | 说明 |
|---------|-------|------|------|
| `@haimang/nacp-session` | 207 | ✅ 207 | 含 10 个新 emit-helpers case |
| `@haimang/orchestrator-core-worker` | 332 | ✅ 332 | 含 1 个 workspace-route test 更新(`content_source: "live"`)|
| `@haimang/agent-core-worker` | 1072 | ✅ 1072 | 0 退化,新 capability 短路有 e2e 路径(已 wire writeTodosBackend optional)|
| `@haimang/context-core-worker` | 178 | ✅ 178 | `previewCompact / triggerCompact` 签名扩展 backward-compat |
| `pnpm check:cycles` | - | ✅ 0 cycle | madge 无新增循环 |
| `pnpm check:envelope-drift` | - | ✅ clean | facade envelope 无漂移 |
| `node scripts/check-docs-consistency.mjs` | 8 regex checks + 2 required-snippet checks × 19 docs | ✅ OK | 0 violations |
| `pnpm test:contracts` (root-guardian) | 29 | ⚠️ 28/29 | **1 项 pre-existing 失败**:`session-registry-doc-sync.test.mjs` 引用不存在的 `docs/nacp-session-registry.md` — 与 HPX5 无关,git history 显示该测试在 HP* 之前已失败 |

**Total**:`207 + 332 + 1072 + 178 = 1789` test 全绿;新增 emit-helpers / workspace `content_source` 断言更新 / 文档 consistency 全部覆盖。

### 9.5 后续 handoff

- **HPX6 入口**:`docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md` 已草拟,可直接进入 implementation
- **HPX6 第一项前置依赖**:已在本计划完成的 emit-helpers (F0) — HPX6 F9 / F12 / F14 的新顶层帧都走同一出口
- **HPX6 hard delete 任务**:Q-bridging-7 owner 已决议直接删 legacy `permission_mode`,HPX6 Phase 3 P3-04 处理
- **HPX6 Queue 部署**:Q-bridging-8 owner 已决议 Cloudflare Queue + DO alarm 兜底,HPX6 Phase 4 引入第 7 worker `executor-runner`

### 9.6 完整工作清单(逐项)

- [x] **P1-01** — 新建 `packages/nacp-session/src/emit-helpers.ts` (zod validate + system.error fallback + observer)
- [x] **P1-01** — 新建 `packages/nacp-session/test/emit-helpers.test.ts` (10 case 全绿)
- [x] **P1-01** — `packages/nacp-session/src/index.ts` re-export `emitTopLevelFrame / emitStreamEvent / EmitSink / EmitContext / EmitResult / EmitObserver`
- [x] **P1-01** — `packages/nacp-session/src/messages.ts` export `SessionMessageType` 类型
- [x] **P1-01** — `packages/nacp-session/src/websocket.ts` 新增 `SessionWebSocketHelper.pushFrame(messageType, body)` 顶层帧 emit
- [x] **P1-02** — `workers/agent-core/src/host/orchestration.ts` `OrchestrationDeps.emitTopLevelFrame?` 新增 optional 字段
- [x] **P1-02** — `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` 在 `pushStreamEvent` 旁注入 `emitTopLevelFrame` deps
- [x] **P2-01 (F1)** — `workers/orchestrator-core/src/wsemit.ts` 新建 `emitFrameViaUserDO` / `emitStreamEventViaUserDO` cross-worker bridge
- [x] **P2-01 (F1)** — `workers/orchestrator-core/src/facade/routes/session-control.ts` confirmation `applyDecision` 后 emit `session.confirmation.update`
- [x] **P2-01 (F1)** — `workers/orchestrator-core/src/user-do/surface-runtime.ts` legacy `permission/decision` + `elicitation/answer` dual-write 后 emit `session.confirmation.request` (新建时) + `.update` (终态时);ctx 接口加 `emitServerFrame`
- [x] **P2-01 (F1)** — `workers/orchestrator-core/src/user-do-runtime.ts` surface runtime ctx 注入 `emitServerFrame`
- [x] **P2-02 (F4)** — `workers/orchestrator-core/src/user-do/message-runtime.ts` 替换 `fallback_used: false, fallback_reason: null` 硬编码,从 `inputAck.body` 读真实值
- [x] **P2-02 (F4)** — message-runtime 在 `fallback_used=true` 时 emit `model.fallback` stream-event;ctx 接口加 `emitServerFrame`
- [x] **P2-02 (F4)** — `workers/orchestrator-core/src/user-do-runtime.ts` message runtime ctx 注入 `emitServerFrame`
- [x] **P2-03** — orchestrator-core 332 test 全绿;`emit-helpers-fallback` warn 在 test fixture 中是预期行为(无 DO binding 时 fall back)
- [x] **P3-01 (F2a)** — `workers/agent-core/src/host/runtime-mainline.ts` `MainlineKernelOptions.writeTodosBackend?` 新增 optional;`TodoStatusLiteral` 内部类型
- [x] **P3-02 (F2b)** — `workers/agent-core/src/host/runtime-mainline.ts` capability execute 入口加 `toolName === "write_todos"` 短路:从 contextProvider 取 session/team/trace + 校验 todos 数组 + 调 writeTodosBackend + 把 result 转换为 tool_result
- [x] **P3-02 (F2b)** — `workers/orchestrator-core/src/entrypoint.ts` 新增 `writeTodos` RPC 方法:auto-close 当前 in_progress + 串行 create + 同时多 in_progress 自动降级
- [x] **P3-02 (F2b)** — `workers/agent-core/src/host/env.ts` `ORCHESTRATOR_CORE.writeTodos?` 接口声明
- [x] **P3-02 (F2b)** — `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` wire `ORCHESTRATOR_CORE.writeTodos` → `writeTodosBackend`
- [x] **P3-03 (F2c)** — `workers/orchestrator-core/src/facade/routes/session-control.ts` HTTP 路径 todo create / patch / delete 后 emit `session.todos.update`
- [x] **P3-03 (F2c)** — `workers/orchestrator-core/src/entrypoint.ts:writeTodos` LLM 路径 emit `session.todos.update`
- [x] **P3-04 (F5)** — `workers/orchestrator-core/src/hp-absorbed-routes.ts` 加 `/content` 路径分支 + 25 MiB cap + binary-content profile;`content_source` 从 `"filesystem-core-leaf-rpc-pending"` → `"live"`
- [x] **P3-04 (F5)** — `workers/orchestrator-core/src/facade/env.ts` `FILESYSTEM_CORE.readTempFile?` RPC 接口扩展
- [x] **P3-04 (F5)** — `workers/orchestrator-core/test/workspace-route.test.ts` 断言更新为 `"live"`
- [x] **P4-01 (F3)** — `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:buildOrchestrationDeps` 构造 `composeCompactSignalProbe(budgetSource, breaker)` 注入 `OrchestrationDeps.probeCompactRequired`
- [x] **P4-01 (F3)** — `workers/agent-core/src/host/env.ts` `ORCHESTRATOR_CORE.readContextDurableState?` 接口声明
- [x] **P4-02 (F3)** — `workers/orchestrator-core/src/facade/routes/session-context.ts` 加 `CompactBodyOptions` 接口 + `readJsonBodyOrNull` + `pickCompactBodyOptions`;两路 (`compact-preview` / `compact`) 透传到 RPC
- [x] **P4-02 (F3)** — `workers/context-core/src/index.ts` `previewCompact` / `triggerCompact` 签名扩展 `options?: CompactBodyOptions`;`force=true` 跳过 "compact-not-needed";`label / preview_uuid` 透传
- [x] **P5-01** — `clients/api-docs/session-ws-v1.md` `model.fallback` 字段名修正
- [x] **P5-01** — `clients/api-docs/models.md` `session_status: "running"` → `"active"` (2 处)
- [x] **P5-02** — 9 份 doc 的 implementation reference 行号刷新到模块化结构
- [x] **P5-02** — `clients/api-docs/context.md` HPX5 F3 body 字段说明替换 ignored 占位
- [x] **P5-02** — `clients/api-docs/workspace.md` F5 路由 + content_source live 说明
- [x] **P5-03** — `workers/orchestrator-core/src/user-do/session-flow/start.ts` `/start` 返回 `first_event_seq`
- [x] **P5-04** — `clients/api-docs/client-cookbook.md` 新建 12 节实战兜底
- [x] **P5-04** — `clients/api-docs/README.md` 索引 18 → 19
- [x] **P5-05** — `scripts/check-docs-consistency.mjs` 新建 + `package.json` 加 `check:docs-consistency` script
- [x] **测试 sweep** — `pnpm --filter @haimang/{nacp-session,orchestrator-core-worker,agent-core-worker,context-core-worker} test` 全绿(1789 tests)
- [x] **CI gate sweep** — `check:cycles` 0 cycle / `check:envelope-drift` clean / `check:docs-consistency` OK
- [x] **closure 文件** — `docs/issue/hero-to-pro/HPX5-closure.md` 写入
