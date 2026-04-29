# Nano-Agent 行动计划 — RH1 Lane F Live Runtime

> 服务业务簇: `real-to-hero / RH1`
> 计划对象: `把 hook / permission / elicitation / usage 四条 runtime side-channel 从 contract-only 提升为真实 live path`
> 类型: `modify + add`
> 作者: `Owner + Opus 4.7`
> 时间: `2026-04-29`
> 文件位置:
> - `workers/agent-core/src/kernel/scheduler.ts`
> - `workers/agent-core/src/host/runtime-mainline.ts`
> - `workers/agent-core/src/host/do/nano-session-do.ts`
> - `workers/agent-core/wrangler.jsonc`（新增 `ORCHESTRATOR_CORE` service binding）
> - `workers/orchestrator-core/src/{index,user-do}.ts`
>
> 📝 **行号引用提示**：本文档所有 `file:line` 引用均基于 2026-04-29 main 分支代码快照；RH0 拆分会让后续行号漂移，实施时以函数 / 方法名为锚点，行号仅辅助。
>
> 📝 **业主已签字 QNA**：业主已同意 RHX-qna Q1-Q5 Opus 路线（含限定）。本 plan 不再列 owner pending。
> 上游前序 / closure:
> - `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md` 完成 closure
> - `docs/charter/plan-real-to-hero.md` r2 §7.2
> 下游交接:
> - `docs/action-plan/real-to-hero/RH2-models-context-inspection.md`（依赖 live runtime + WS push 路径）
> - `docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md`（force-disconnect 复用 RH1 push 机制）
> 关联设计 / 调研文档:
> - `docs/design/real-to-hero/RH1-lane-f-live-runtime.md`（含 §9 修订记录）
> - `docs/design/real-to-hero/RH2-llm-delta-policy.md`（usage push vs HTTP snapshot 政策）
> - `docs/eval/real-to-hero/closing-thoughts-by-opus.md` §2
> 冻结决策来源:
> - `docs/design/real-to-hero/RHX-qna.md`（Q1-Q5 与 RH1 无直接耦合，但 Q2 dual-track 政策影响 RPC-first 模式）
> 文档状态: `draft`

---

## 0. 执行背景与目标

ZX4/ZX5 把 `nacp-session` 的 permission/elicitation/usage 三类 body schema 与 deferred answer 等待原语都立起来了，但 Lane F 四条 side-channel 仍是 **contract 已就位、live 路径中断** 的状态：(1) `runtime-mainline.ts:295-298` 的 `hook.emit` 是 no-op；(2) `scheduler.ts` 不产生 `hook_emit` 决策（虽然 `StepDecision` union 已含该变体）；(3) `nano-session-do.ts:797-829` 的 `emitPermissionRequestAndAwait` / `emitElicitationRequestAndAwait` **有 await 机制但零 frame emit + 零调用方**；(4) `nano-session-do.ts:494-501` 的 `onUsageCommit` callback 仅 `console.log`；(5) `forwardServerFrameToClient` 跨 worker RPC handler **完全不存在**；(6) `handleUsage` 在无 rows 时仍返回 null placeholder。RH1 把这 6 条 gap 全部接通成可验证的 live path。

- **服务业务簇**：`real-to-hero / Lane F live runtime`
- **本次计划解决的问题**：
  - hook / permission / elicitation / usage 四链全部从 contract-only 升级为 live
  - usage strict snapshot 不再返回 null（charter P1-E）
  - 跨 worker WS push 通道首次成立
- **本次计划的直接产出**：
  - `scheduler.ts` 在合适状态下产生 `hook_emit` 决策
  - `runtime-mainline.ts` `hook.emit` 调用已建成的 `HookDispatcher`
  - `nano-session-do.ts` 的 emitPermission/emitElicitation 真 emit `session.permission.request` / `session.elicitation.request` WS frame
  - `user-do.ts` 新增 `forwardServerFrameToClient(sessionUuid, frame)` RPC method
  - `agent-core/host/do/nano-session-do.ts` `onUsageCommit` 经 service binding 调上述 RPC，推 `session.usage.update` frame
  - `user-do.ts` `handleUsage` 无 rows 时返回 0/明确空快照
- **本计划不重新讨论的设计结论**：
  - hook dispatcher 本体已建成 149 行，仅缺 wiring（`design §8.4`）
  - kernel `StepDecision.hook_emit` 已预路由（`design §8.4`）
  - permission/elicitation timeout 一律 fail-closed（`design §6.1`）
  - usage push = best-effort preview，HTTP snapshot = strict source（`design §6.1`）
  - token-level streaming out-of-scope（`design RH2-llm-delta-policy §5.2`）

---

## 1. 执行综述

### 1.1 总体执行方式

RH1 采用**先 wiring 再实施 → 先单链测通 → 再跨链 e2e**：先把每条链最薄的 wiring 改完（hook delegate → scheduler 决策 → emit frame → forwardServerFrameToClient RPC），让 4 条链各自能产生第一条真实 event；再做跨 worker e2e（permission round-trip / elicitation round-trip / usage push）；最后做 P1-E `/usage` no-null 的纯 HTTP path 修整与 preview smoke。整阶段不引入新抽象层。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Hook Dispatcher Wiring (P1-A + P1-B) | M | scheduler 产生 hook_emit + runtime-mainline.hook.emit 调 dispatcher | RH0 closure |
| Phase 2 | Permission/Elicitation Frame Emit (P1-C) | M | 在 emitPermission/emitElicitation 真 emit WS frame + 接首个调用方 | Phase 1 |
| Phase 3 | Cross-Worker WS Push RPC (P1-D 上半) | L | agent-core 新增 `ORCHESTRATOR_CORE` service binding；orchestrator-core `WorkerEntrypoint` 暴露 `forwardServerFrameToClient` RPC（内部通过 `ORCHESTRATOR_USER_DO` 定位 User DO 后委托 `emitServerFrame`）；agent-core 调用 | Phase 1 |
| Phase 4 | Usage Push Live (P1-D 下半) | M | onUsageCommit 经 RPC 推 session.usage.update | Phase 3 |
| Phase 5 | Usage Strict Snapshot No-Null (P1-E) | S | handleUsage 无 rows 时返回 0/空快照 | Phase 4 |
| Phase 6 | Cross-Worker E2E + Preview Smoke | M | 4 条 live path 各 ≥1 e2e + preview smoke | Phase 1-5 |

### 1.3 Phase 说明

1. **Phase 1**：dispatcher 已建成，只缺 wiring；最小改动起步
2. **Phase 2**：waiter 已建成，frame emit 是关键缺失；接通后即可单元测试 permission round-trip 假流程
3. **Phase 3**：跨 worker RPC 是全新实装；先做 RPC 通道再 carry usage push
4. **Phase 4**：usage live preview 借 Phase 3 通道
5. **Phase 5**：纯 HTTP fix，独立小 PR，避免污染主线
6. **Phase 6**：所有 wiring 落地后做整链 e2e

### 1.4 执行策略说明

- **执行顺序原则**：先内部 wiring → 再跨 worker RPC → 再 HTTP fix → 末 e2e
- **风险控制原则**：每个 Phase 单独 PR；scheduler 改动单独 review
- **测试推进原则**：先单测 + miniflare 集成，e2e 在 Phase 6 统一跑
- **文档同步原则**：design RH1 §9 已记录修订；本 action-plan 落地时同步更新 closure 候选条目
- **回滚 / 降级原则**：scheduler 在 hook_emit 决策上失败必须 throw 而非 silent skip，避免漂回 contract-only 状态

### 1.5 本次 action-plan 影响结构图

```text
RH1 Lane F Live
├── Phase 1: Hook Wiring
│   ├── workers/agent-core/src/kernel/scheduler.ts
│   └── workers/agent-core/src/host/runtime-mainline.ts
├── Phase 2: Permission/Elicitation Emit
│   └── workers/agent-core/src/host/do/nano-session-do.ts
├── Phase 3: Cross-Worker RPC
│   ├── workers/orchestrator-core/src/user-do.ts (forwardServerFrameToClient)
│   └── workers/agent-core/src/host/do/nano-session-do.ts (consumer)
├── Phase 4: Usage Push
│   └── workers/agent-core/src/host/do/nano-session-do.ts (onUsageCommit)
├── Phase 5: Usage No-Null
│   └── workers/orchestrator-core/src/user-do.ts (handleUsage)
└── Phase 6: E2E + Smoke
    └── tests + docs/issue/real-to-hero/RH1-evidence.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** scheduler 在合适状态产生 `hook_emit` 决策；runner 已支持
- **[S2]** `runtime-mainline.hook.emit` 不再 no-op，调用 `HookDispatcher`
- **[S3]** emitPermissionRequestAndAwait/emitElicitationRequestAndAwait 真 emit WS frame
- **[S4]** runtime hook（如 tool 执行前 permission gate）真调用 emitPermission（接首个调用方）
- **[S5]** `agent-core/wrangler.jsonc` 新增 `ORCHESTRATOR_CORE` service binding；`orchestrator-core` `WorkerEntrypoint` (默认 export) 暴露 `forwardServerFrameToClient(sessionUuid, frame, meta)` RPC method —— 内部通过 `ORCHESTRATOR_USER_DO.idFromName(...)` 定位目标 User DO 后委托现有 `emitServerFrame`；frame 必须经 `validateSessionFrame` 校验；authority/team 校验先行
- **[S6]** `onUsageCommit` 经 RPC 推 `session.usage.update`
- **[S7]** `handleUsage` 无 rows 时返回 0/明确空快照（P1-E）
- **[S8]** 4 条 live path 各 ≥1 cross-worker e2e + preview smoke 证据

### 2.2 Out-of-Scope

- **[O1]** token-level text streaming（RH2 delta-policy 已 defer 到 hero-to-platform）
- **[O2]** approval/admin plane policy center（hero-to-platform）
- **[O3]** 新 public endpoint（RH2/RH3）
- **[O4]** richer hook bus（hero-to-platform）

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| permission timeout 自动 allow | out-of-scope | 必须 fail-closed | 无 |
| usage push 当 strict source | out-of-scope | 与 design §6.1 双轨违反 | 无 |
| 把 forwardServerFrameToClient 写成 public ingress | out-of-scope | 这是内部 RPC | 无 |
| HTTP snapshot 在 RH1 真实化 | in-scope | charter §7.2 P1-E 明确 | 无 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | scheduler 产生 hook_emit | update | `agent-core/src/kernel/scheduler.ts` | 在 idle/post-tool 等状态产生 hook_emit 决策 | medium |
| P1-02 | Phase 1 | runtime-mainline.hook.emit 调 dispatcher | update | `agent-core/src/host/runtime-mainline.ts:295-298` | no-op → 调用 HookDispatcher | medium |
| P1-03 | Phase 2 | emitPermissionRequestAndAwait 真 emit frame | update | `agent-core/src/host/do/nano-session-do.ts:797-815` | emit `session.permission.request` 到 attached WS | medium |
| P1-04 | Phase 2 | emitElicitationRequestAndAwait 真 emit frame | update | `nano-session-do.ts:817-829` | emit `session.elicitation.request` | medium |
| P1-05 | Phase 2 | runtime hook 调 emitPermission | update | `runtime-mainline.ts` 或 hook handler | tool 执行前 permission gate 真调 emitPermission | medium |
| P1-06a | Phase 3 | agent-core 新增 `ORCHESTRATOR_CORE` service binding | add | `agent-core/wrangler.jsonc` | dry-run 通过；env 含 binding | medium |
| P1-06b | Phase 3 | orchestrator-core `WorkerEntrypoint` 暴露 `forwardServerFrameToClient` RPC | add | `orchestrator-core/src/index.ts` (default export `WorkerEntrypoint`) | RPC 可由 service binding 调用；内部委托 User DO `emitServerFrame` | high |
| P1-07 | Phase 3 | agent-core 调 forwardServerFrameToClient | update | `nano-session-do.ts` + service binding | 通过新 binding 调 orchestrator-core RPC，再由 orchestrator-core 路由到 User DO | high |
| P1-08 | Phase 4 | onUsageCommit → forwardServerFrameToClient | update | `nano-session-do.ts:494-501` | quota commit 推 `session.usage.update` | medium |
| P1-09 | Phase 5 | handleUsage 无 rows 返 0/空 | update | `orchestrator-core/src/user-do.ts:1215-1257` | 不再 null placeholder | low |
| P1-10 | Phase 6 | permission round-trip e2e | add | `test/cross-e2e/permission-round-trip.e2e.test.ts` | allow/deny/timeout 三 case | medium |
| P1-11 | Phase 6 | elicitation round-trip e2e | add | `test/cross-e2e/elicitation-round-trip.e2e.test.ts` | answer/timeout 二 case | medium |
| P1-12 | Phase 6 | usage push e2e | add | `test/cross-e2e/usage-push.e2e.test.ts` | tool/llm 各推一次 | medium |
| P1-13 | Phase 6 | preview smoke + 归档 | manual | `docs/issue/real-to-hero/RH1-evidence.md` | 4 链 live 证据 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Hook Dispatcher Wiring

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | scheduler hook_emit | 在 `scheduleNextStep()` 中识别"需要触发 hook"的 SchedulerSignals 信号（如 tool 执行后、turn 完成后），产生 `{kind: "hook_emit", event: <name>}` 决策 | `agent-core/src/kernel/scheduler.ts` | scheduler 在确定状态下输出 hook_emit | scheduler unit test 新增 ≥3 case（不同信号 → 不同 hook event）| 决策类型校验通过；既有 scheduler test 不回归 |
| P1-02 | runtime delegate 调 dispatcher | 在 `runtime-mainline.ts` 替换 `async emit(_event, _payload) { return undefined; }` 为调用 `HookDispatcher.emit(event, payload, context)`，dispatch 失败要 throw 而非 silent | `agent-core/src/host/runtime-mainline.ts:295-298` + 注入 dispatcher 实例 | hook 真 dispatch；blocking hook 失败正确传播 | unit test：mock HookDispatcher，验证 emit 调用次数与参数 | dispatcher mock 收到正确 event；既有 mainline test 不回归 |

### 4.2 Phase 2 — Permission/Elicitation Frame Emit

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-03 | permission emit | 在 `emitPermissionRequestAndAwait` 内构造 `{kind: 'session.permission.request', request_uuid, ...}` frame，通过 `getWsHelper()` 真 emit 到 attached client；attached=false 时仍走 `awaitAsyncAnswer`（HTTP mirror 路径作为 backstop）| `nano-session-do.ts:797-815` | attached client 在 WS 上收到 frame；request_uuid 在 storage + deferred map 中可查 | unit test + miniflare 集成 | 至少 1 个 attached scenario 收到 frame；既有 session-do test 不回归 |
| P1-04 | elicitation emit | 同 P1-03，对称改造 elicitation 路径 | `nano-session-do.ts:817-829` | 同上 | 同上 | 同上 |
| P1-05 | hook 调 emitPermission | 在 runtime mainline tool 执行前 hook 处真调 emitPermission（首个调用方）；可参考 charter §10.1 hook category 列表 | `runtime-mainline.ts` 或 `hooks/permission.ts` 接 dispatcher | tool execution 前置 permission 真发起 | integration test：发起 permission tool execution，验证 client WS 收 frame | 至少 1 个 tool 路径触发 emit |

### 4.3 Phase 3 — Cross-Worker WS Push RPC

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-06a | agent-core service binding | 在 `agent-core/wrangler.jsonc` 的 `services` 列表新增 `{ "binding": "ORCHESTRATOR_CORE", "service": "nano-agent-orchestrator-core" }`；同步更新 `agent-core/src/index.ts` env 类型 | `agent-core/wrangler.jsonc` + `agent-core/src/index.ts` env interface | agent-core dry-run 通过；env 类型含 ORCHESTRATOR_CORE | `wrangler deploy --dry-run` | binding 在 env 可见 |
| P1-06b | orchestrator-core RPC | 在 `orchestrator-core/src/index.ts` 默认 export 的 `WorkerEntrypoint` class 中新增 `async forwardServerFrameToClient(sessionUuid: string, frame: unknown, meta: { authority: string; teamUuid: string }): Promise<{ ok: boolean; reason?: string }>`：(1) `validateSessionFrame(frame)` schema 校验失败 → reject；(2) authority/team 校验失败 → reject；(3) 通过 `ORCHESTRATOR_USER_DO.idFromName(...)` 定位 User DO，stub 调用现有 `emitServerFrame(sessionUuid, frame)` | `orchestrator-core/src/index.ts` + `user-do.ts` | RPC 可由 service binding 调用 | unit test：mock attached client，验证 frame 投递 + authority 拒绝 | RPC 在 RPC 表中可见；frame 经 schema 校验；authority 拒绝 / session 不属于 team / detached / attached 4 种 case 单测 |
| P1-07 | agent-core 调用 | NanoSessionDO 通过新增 `ORCHESTRATOR_CORE` service binding 调 P1-06b RPC；不能直接绑定 `ORCHESTRATOR_USER_DO`（DO namespace 不属于 agent-core） | `nano-session-do.ts` + `agent-core/wrangler.jsonc` | agent-core 能跨 worker 推 frame 到 client（agent-core → orchestrator-core RPC → User DO `emitServerFrame`）| cross-worker integration test | 调用成功；client 收 frame；3 失败路径明确（无 binding / authority 拒绝 / session 不存在）|

### 4.4 Phase 4 — Usage Push Live

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-08 | onUsageCommit 推送 | 在 `nano-session-do.ts:494-501` `onUsageCommit` callback 内构造 `{kind: 'session.usage.update', ...}` frame，调 `forwardServerFrameToClient`；保留原 `console.log` 作为 trace | `nano-session-do.ts:494-501` + `runtime-mainline.ts:240-339` 现有 onUsageCommit seam | tool/llm quota commit 后 client WS 收 update frame | unit + e2e | attached client 收到 ≥1 frame；client 未 attached 时 best-effort 丢失（不报错）|

### 4.5 Phase 5 — Usage Strict Snapshot No-Null

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-09 | handleUsage strict snapshot | (a) **no rows 真零快照**：把 `user-do.ts:1225-1232` 的 `null` 初始化改为 `0`，无 rows 时返回 `{llm_input_tokens: 0, llm_output_tokens: 0, tool_calls: 0, subrequest_used: 0, subrequest_budget: <team quota or 0>, estimated_cost_usd: 0}`；(b) **D1 unavailable / read failed → 503 facade error**（保留 trace_uuid + warning log，**不**退化为 200 + zero）—— 与 charter §9.5 strict snapshot 纪律一致；不可把"账本不可用"伪装成"用户没消耗"| `orchestrator-core/src/user-do.ts:1215-1257`（行号截至 2026-04-29，以 `handleUsage` 函数为准） | `/sessions/{id}/usage`：has rows 真值；no rows zero-shape 200；D1 失败 503 + facade error envelope | unit test + endpoint test 覆盖：has-rows / no-rows / unknown-session 404 / D1 read failure 503 | 4 case 全绿；charter §9.5 strict snapshot 不被 success-shaped fallback 污染 |

### 4.6 Phase 6 — Cross-Worker E2E + Preview Smoke

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-10 | permission e2e | tool 触发 → client 收 frame → client 发 decision → tool resume；含 timeout fail-closed | `test/cross-e2e/permission-round-trip.e2e.test.ts` | 3 case（allow / deny / timeout）| miniflare cross-worker | 3 case pass |
| P1-11 | elicitation e2e | 同 P1-10 对称 | `test/cross-e2e/elicitation-round-trip.e2e.test.ts` | 2 case（answer / timeout）| 同上 | 2 case pass |
| P1-12 | usage push e2e | tool 调 → quota commit → client 收 usage frame；连发 N 次验证不丢顺序 | `test/cross-e2e/usage-push.e2e.test.ts` | best-effort push live | 同上 | client 收 ≥1 frame |
| P1-13 | preview smoke + 归档 | preview deploy 后业主跑 4 条 live path，截屏 + WS log | `docs/issue/real-to-hero/RH1-evidence.md` | 4 链 evidence 完整 | manual | 文档 ≥ 1KB，含每条链截图 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Hook Dispatcher Wiring

- **Phase 目标**：把 hook 链从 contract-only 升级为 live；scheduler → runner → dispatcher 全通
- **本 Phase 对应编号**：P1-01, P1-02
- **本 Phase 新增文件**：无
- **本 Phase 修改文件**：`scheduler.ts`、`runtime-mainline.ts`
- **具体功能预期**：
  1. scheduler 在 idle/post-tool 状态产 hook_emit 决策
  2. runtime delegate 调 HookDispatcher
- **具体测试安排**：
  - **单测**：scheduler 新增 ≥3 case；runtime-mainline mock dispatcher 验证调用
  - **回归测试**：agent-core 全套测试不破
- **收口标准**：dispatcher mock 收到正确 event；既有 test 0 回归
- **本 Phase 风险提醒**：scheduler 改动影响主循环，回归面大；建议 PR 单独 review；任何 dispatcher 失败必须 throw

### 5.2 Phase 2 — Permission/Elicitation Frame Emit

- **Phase 目标**：waiter 链从"等待无 emit"升级为"emit 后等待"
- **本 Phase 对应编号**：P1-03, P1-04, P1-05
- **本 Phase 修改文件**：`nano-session-do.ts`、可能 `runtime-mainline.ts` 或 `hooks/permission.ts`
- **具体功能预期**：
  1. emitPermission/emitElicitation 真发 frame
  2. 至少有 1 个 runtime hook 调 emitPermission
- **具体测试安排**：
  - **单测**：mock attached client，验证 emit
  - **集成测试**：miniflare 内 fire tool execution 触发 emitPermission
- **收口标准**：attached scenario 收 frame；HTTP mirror backstop 不破
- **本 Phase 风险提醒**：detached 状态下 emit 应 silent no-op，但 HTTP mirror 必须能收到 decision；不能让 attached/detached 走两套语义

### 5.3 Phase 3 — Cross-Worker WS Push RPC

- **Phase 目标**：跨 worker WS push 通道首次成立。**重要拓扑澄清**：agent-core 不能直接绑定 `ORCHESTRATOR_USER_DO`（DO namespace 属于 orchestrator-core）；正确路径是 `agent-core ─[ORCHESTRATOR_CORE service binding]→ orchestrator-core WorkerEntrypoint.forwardServerFrameToClient ─[ORCHESTRATOR_USER_DO.idFromName]→ User DO.emitServerFrame`
- **本 Phase 对应编号**：P1-06a, P1-06b, P1-07
- **本 Phase 修改文件**：`agent-core/wrangler.jsonc` (新增 service binding) + `agent-core/src/index.ts` env interface + `orchestrator-core/src/index.ts` (默认 export `WorkerEntrypoint` 加 RPC method) + `orchestrator-core/src/user-do.ts` (复用 emitServerFrame) + `nano-session-do.ts` (consumer)
- **具体功能预期**：
  1. agent-core 含 `ORCHESTRATOR_CORE` service binding
  2. orchestrator-core `WorkerEntrypoint` 暴露 `forwardServerFrameToClient` RPC
  3. RPC 内部委托现有 User DO `emitServerFrame`（不重复实现 WS push）
  4. agent-core 通过 binding 调用
- **具体测试安排**：
  - **单测**：orchestrator-core RPC 单测（含 authority 拒绝 / session 不属于 team / detached / attached 4 case）
  - **集成测试**：cross-worker miniflare e2e
- **收口标准**：cross-worker frame 投递 ≥ 1 次成功；4 失败路径单测明确（无 binding / authority 拒绝 / session 不存在 / client detached）
- **本 Phase 风险提醒**：service binding 启用涉及 agent-core wrangler.jsonc 改动；deploy 顺序必须 orchestrator-core 先于 agent-core，否则 agent-core 找不到目标 service。

### 5.4 Phase 4 — Usage Push Live

- **Phase 目标**：onUsageCommit 真推 client
- **本 Phase 对应编号**：P1-08
- **本 Phase 修改文件**：`nano-session-do.ts`
- **具体功能预期**：tool/llm quota commit → client WS 收 update frame
- **具体测试安排**：unit + cross-worker e2e
- **收口标准**：attached client 收 ≥1 usage update；detached 不报错
- **本 Phase 风险提醒**：push 高频时 RPC 调用频率可能成本上升；first-wave 不做批量合并，留给 hero-to-platform

### 5.5 Phase 5 — Usage Strict Snapshot No-Null

- **Phase 目标**：(a) `/usage` 无 rows 返 zero-shape 而非 null；(b) D1 失败返 503 facade error 而非 200 + zero（charter §9.5 strict snapshot）
- **本 Phase 对应编号**：P1-09
- **本 Phase 修改文件**：`user-do.ts:1215-1257`（行号截至 2026-04-29，以 `handleUsage` 为准）
- **具体测试安排**：endpoint test 4 case：(1) has-rows 真值；(2) no-rows zero-shape 200；(3) unknown-session 404；(4) D1 unavailable 503 facade error
- **收口标准**：4 case 全绿；charter §9.5 strict snapshot 不被 success-shaped fallback 污染；与 RH0 P0-B 的 messages 路径不冲突
- **本 Phase 风险提醒**：必须严格区分 "无 rows"（200 zero）与 "D1 read exception"（503 error）；team_quota fallback 默认 0 直至 RH3 引入 team policy。

### 5.6 Phase 6 — Cross-Worker E2E + Preview Smoke

- **Phase 目标**：4 条 live path 各 ≥1 e2e + preview smoke 归档
- **本 Phase 对应编号**：P1-10, P1-11, P1-12, P1-13
- **本 Phase 新增文件**：3 个 e2e + 1 evidence md
- **收口标准**：3 e2e 全绿；preview evidence 文档 ≥1KB
- **本 Phase 风险提醒**：miniflare 与 prod 在 service binding 行为差异；建议 e2e 使用 miniflare，preview 用真 deploy 二次验证

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| timeout fail-closed | `design RH1 §6.1` | Phase 2 实现 timeout 必走 deny | 推翻则重审 Lane F 安全语义 |
| push best-effort / snapshot strict | `design RH1 §3.3` + `RH2-llm-delta-policy §3.3` | Phase 4/5 分别走两路 | 推翻则需重新设计 usage 一致性模型 |
| dispatcher 已建成 | `design RH1 §8.4` | Phase 1 仅 wiring | 不成立则降级到 scope-extend，回 design |
| StepDecision.hook_emit 已有变体 | `design RH1 §8.4` + `kernel/types.ts:30,62` | Phase 1 仅改 scheduler 业务逻辑 | 不成立则需扩 union type |
| forwardServerFrameToClient 全新实装 | `design RH1 §5.1 [S4]` | Phase 3 是 RH1 主成本 | 推翻则需重新设计 cross-worker push |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| scheduler 主循环回归 | hook_emit 改动可能影响 idle/active 状态机 | high | scheduler 改动单独 PR + ≥3 新 case；既有 case 全跑 |
| service binding wrangler 配置 | USER_DO binding 在 agent-core wrangler.jsonc 中需启用 | medium | RH0 P0-C 已声明；RH1 P1-07 启用 |
| permission/elicitation HTTP mirror 与 WS double-handling | 同一 decision 可能从两个入口到达 | medium | 在 deferred map 中按 request_uuid 去重；first-arrives-wins |
| cross-worker e2e 的 miniflare 限制 | 部分 service binding 行为与 prod 不一致 | medium | preview deploy 后做真 e2e 二次验证 |

### 7.2 约束与前提

- **技术前提**：RH0 closure 完成；jwt-shared 已可独立构建；6 worker dry-run 通过
- **运行时前提**：USER_DO binding 在 agent-core wrangler.jsonc 中启用
- **组织协作前提**：业主在 Phase 6 提供 manual evidence
- **上线 / 合并前提**：每个 Phase 单 PR；Phase 6 必须以 preview deploy 而非仅 miniflare 收口

### 7.3 文档同步要求

- 需要同步更新的设计文档：`design/real-to-hero/RH1-lane-f-live-runtime.md` §9（执行后更新 status）
- 需要同步更新的说明文档：`docs/api/lane-f-protocol.md`（如不存在则新建，描述 4 条 frame 形态）

### 7.4 完成后的预期状态

1. `runtime-mainline.hook.emit` 不再 no-op，dispatcher 真消费 event
2. Permission / elicitation round-trip 在 attached / detached 双场景都 live
3. Usage 双轨成立：WS push best-effort + HTTP `/usage` no-null strict
4. 跨 worker WS push 通道首次可用，下游 RH3 force-disconnect 可复用
5. 4 条 live path evidence 归档；RH2 可启动

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：6 worker `wrangler deploy --dry-run` 不回归；agent-core / orchestrator-core 既有 test 全绿
- **单元测试**：scheduler ≥3 case；runtime-mainline dispatcher mock；user-do RPC mock；handleUsage 4 case
- **集成测试**：miniflare cross-worker 3 e2e（permission / elicitation / usage push）
- **端到端 / 手动验证**：preview deploy 后 4 链 manual smoke
- **回归测试**：agent-core / orchestrator-core 既有矩阵 + RH0 P0-B/P0-G 测试不回归
- **文档校验**：RH1-evidence.md ≥1KB

### 8.2 Action-Plan 整体收口标准

1. hook event 真消费（dispatcher mock 验证）
2. Permission / Elicitation 双场景 round-trip live + timeout fail-closed
3. 跨 worker WS push 通道存在；usage push live preview
4. `/sessions/{id}/usage` 任何 case 不返 null
5. 4 链 cross-worker e2e + preview smoke evidence 归档
6. RH2 Per-Phase Entry Gate 满足

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | 4 链 live + HTTP no-null |
| 测试 | scheduler/dispatcher/RPC/handleUsage 单测全绿；3 cross-worker e2e 全绿 |
| 文档 | RH1 design §9 状态更新；RH1-evidence.md 归档 |
| 风险收敛 | scheduler 主循环 0 回归；HTTP mirror 不双 fire |
| 可交付性 | RH2 action-plan 可基于 RH1 closure 启动 |

---

## 9. 实施工作日志（RH1 closure work-log）

> 实施人:Opus 4.7(2026-04-29)
> 实施日期:2026-04-29(同日 RH0 闭合后立即启动)
> 关联闭合文件:`docs/issue/real-to-hero/RH1-closure.md` + `docs/issue/real-to-hero/RH1-evidence.md`
> 实施模式:auto mode + 业主授权 wrangler deploy

本节按文件清单 + 变更摘要 + 关联 phase 编号的形式 append RH1 全部代码 / 文档 / 配置改动,作为整体工作报告。

### 9.1 新增文件(4 个)

| # | 文件路径 | 关联编号 | 说明 |
|---|---------|----------|------|
| 1 | `docs/issue/real-to-hero/RH1-closure.md` | RH1 closure | 阶段闭合 memo + RH2 Per-Phase Entry Gate 预核对 |
| 2 | `docs/issue/real-to-hero/RH1-evidence.md` | P1-13 | 4 链 live evidence + preview deploy 记录 + 已知 RH3+ carry-over |
| 3 | `workers/orchestrator-core/src/entrypoint.ts` | P1-06b | 新建 default export `OrchestratorCoreEntrypoint extends WorkerEntrypoint`;暴露 `forwardServerFrameToClient(sessionUuid, frame, meta)` RPC;`fetch()` 复用 `worker.fetch`(测试不需 resolve `cloudflare:workers`)|
| 4 | `workers/orchestrator-core/test/usage-strict-snapshot.test.ts` | P1-09 | 3 case:has-rows 200 / no-rows zero-shape 200 / D1-fail 503 facade error |

### 9.2 修改文件(8 个)

| # | 文件路径 | 关联编号 | 变更摘要 |
|---|---------|----------|----------|
| 1 | `workers/agent-core/src/kernel/scheduler.ts` | P1-01 | `SchedulerSignals` 新增 `pendingHookEvents?: readonly string[]`;Priority 3.5 在 compact 与 tool/llm 之间 drain `hook_emit { kind, event }` 决策 |
| 2 | `workers/agent-core/test/kernel/scheduler.test.ts` | P1-01 | 新增 4 case:`emits hook_emit when pendingHookEvents non-empty` / `hook_emit drains FIFO` / `compact takes priority over hook_emit` / `hook_emit takes priority over tool_exec`(13 / 13 全绿)|
| 3 | `workers/agent-core/src/host/runtime-mainline.ts` | P1-02 | `MainlineKernelOptions` 新增 `hookDispatcher?` + `hookContextProvider?`;`hook.emit` no-op 改为 dispatcher delegate(blocked → throw,绑定不在时退化为 no-op 向下兼容) |
| 4 | `workers/agent-core/test/host/runtime-mainline.test.ts` | P1-02 | 新增 2 case:`hook.emit delegate routes through HookDispatcher when injected` + `hook.emit delegate is no-op when no HookDispatcher injected`(5 / 5 全绿)|
| 5 | `workers/agent-core/src/host/env.ts` | P1-06a | `SessionRuntimeEnv` 新增 `ORCHESTRATOR_CORE?: ServiceBindingLike & { forwardServerFrameToClient?(...) }` 类型,RPC 形状显式 narrow |
| 6 | `workers/agent-core/wrangler.jsonc` | P1-06a | 顶层 + preview env `services` 数组各加 `{binding:"ORCHESTRATOR_CORE", service:"nano-agent-orchestrator-core[-preview]"}` |
| 7 | `workers/agent-core/src/host/do/nano-session-do.ts` | P1-03 + P1-04 + P1-07 + P1-08 | (a) `emitPermissionRequestAndAwait` / `emitElicitationRequestAndAwait` 在 await 前调 `pushServerFrameToClient({kind: "session.{permission,elicitation}.request", ...})`;(b) 新增 `pushServerFrameToClient` private helper 通过 `env.ORCHESTRATOR_CORE.forwardServerFrameToClient(sessionUuid, frame, {userUuid, teamUuid, traceUuid})` 推 frame;best-effort 失败返 `{delivered:false, reason}`,不抛;(c) `onUsageCommit` 在保留 `console.log` 的前提下加 `void this.pushServerFrameToClient({kind:"session.usage.update", ...})` |
| 8 | `workers/orchestrator-core/src/index.ts` | P1-06b 拆分 | (a) 移除 `cloudflare:workers` import(让 vitest 仍能 import index.js);(b) 把 default export 从 `worker` 留作 fallback,真实 Worker entry point 移到 `entrypoint.ts`;(c) 新增 `export { worker }` 命名导出;(d) RH0 P0-E1 collateral fix 保留(AgentRpcMethodKey union 含 `permissionDecision`/`elicitationAnswer`,`InitialContextSeed` import) |
| 9 | `workers/orchestrator-core/src/user-do.ts` | P1-06b 配套 | 在 fetch dispatch 上方插入 `__forward-frame` 内部路由(POST /sessions/{uuid}/__forward-frame body `{frame:{kind, ...}}`),调用 `this.emitServerFrame(sessionUuid, frame)` 返 `{delivered, reason?}`;`handleUsage` 改 strict snapshot:no-rows zero-shape / D1 fail 503 facade error |
| 10 | `workers/orchestrator-core/wrangler.jsonc` | P1-06b | `main` 从 `dist/index.js` 改为 `dist/entrypoint.js`(WorkerEntrypoint default export 入口) |

### 9.3 已部署到 Cloudflare preview(P1-13)

```
nano-agent-orchestrator-core-preview    34cfc8a6-038f-49ad-9af8-80c321dc2f4f (RH1)
nano-agent-agent-core-preview           de2fd54f-26a4-4d28-9c2d-2da6f8a7e633 (RH1)
                                        https://nano-agent-orchestrator-core-preview.haimang.workers.dev
```

未变更 worker(orchestrator-auth / bash-core / context-core / filesystem-core)继承 RH0 P0-E1 部署版本(见 `docs/issue/zero-to-real/post-fix-verification.md` §1),`/debug/workers/health` 仍 `live: 6, total: 6`。

### 9.4 RH1 测试矩阵全绿快照

| 测试套 | case 数 | 状态 | 增量 |
|--------|---------|------|------|
| `@haimang/jwt-shared` | 20 | ✅ | 0(继承 RH0)|
| `@haimang/orchestrator-core-worker` | 118 | ✅ | +3 (`usage-strict-snapshot.test.ts`) |
| `@haimang/orchestrator-auth-worker` | 16 | ✅ | 0 |
| `@haimang/agent-core-worker` | 1062 | ✅ | +6(scheduler 4 + runtime-mainline 2)|
| **合计** | **1216** | ✅ | **+9 vs RH0(1207)** |

### 9.5 RH1 hard gate 全表绿灯

见 `docs/issue/real-to-hero/RH1-closure.md` §2(9 项 hard gate 全绿)。

### 9.6 已知遗留(留 RH3+)

> RH1 不重新讨论,本节列出 RH1 期望即未实装的项,作为 RH2 / RH3 Per-Phase Entry Gate 的"已识别 known-gap":
>
> 1. `pushServerFrameToClient` 真投递成功:wire 完整,因 NanoSessionDO 当前未持有 `user_uuid` 而返 `delivered:false,reason:'no-user-uuid-for-routing'`。RH3 D6 device gate 把 `user_uuid` 写进 IngressAuthSnapshot 后落地。
> 2. permission / elicitation / usage push 真 round-trip e2e:单元覆盖 wire 正确性,真投递 + attached client 观察 frame 到达由 RH3 D6 + RH6 e2e harness 接续。
> 3. HookDispatcher 实例注入 NanoSessionDO:dispatcher 类与 createMainlineKernelRunner.hookDispatcher seam 就位,但 NanoSessionDO 当前没有把 dispatcher 实例填入 — 由 RH3+ 把 PreToolUse / SessionStart hook handler 接通时一并注入。
> 4. `D1_ERROR: no such table nano_user_devices` schema gap(/me/devices 500)与 `nano_conversation_sessions_old_v6`(timeline LLM_POSTPROCESS_FAILED):均为 pre-existing,RH3 D6 + ZX5 早期 schema cleanup 同时消化。

### 9.7 闭合声明

RH1 全部 6 个 phase / 13 个 work-item / 4 链 lane F 的 wire 全部 PASS;6 worker preview deploy 健康可达;9 项 hard gate 全部满足;`/sessions/{uuid}/usage` strict snapshot 在真实 preview 上 live 验证 zero-shape;RH2 Per-Phase Entry Gate(charter §8.3)成立。**RH1 阶段正式闭合,RH2 实施可启动。**
