# Nano-Agent 行动计划 — HP5 Confirmation Control Plane

> 服务业务簇: `hero-to-pro / HP5`
> 计划对象: `把当前 permission/elicitation 两条异步回路升级为统一 confirmation registry、统一 API、统一 frame、统一 wait 语义的确认控制面`
> 类型: `modify + protocol + runtime + API + test`
> 作者: `Owner + GPT-5.4`
> 时间: `2026-04-30`
> 文件位置:
> - `packages/nacp-session/src/messages.ts`
> - `workers/agent-core/src/hooks/{dispatcher,permission}.ts`
> - `workers/agent-core/src/kernel/{types,interrupt}.ts`
> - `workers/agent-core/src/host/runtime-mainline.ts`
> - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`
> - `workers/agent-core/src/host/do/session-do-runtime.ts`
> - `workers/agent-core/src/host/do/session-do-persistence.ts`
> - `workers/agent-core/src/host/do/session-do/fetch-runtime.ts`
> - `workers/orchestrator-core/src/index.ts`
> - `workers/orchestrator-core/src/user-do/surface-runtime.ts`
> - `test/cross-e2e/**`
> - `docs/issue/hero-to-pro/HP5-closure.md`
> 上游前序 / closure:
> - `docs/action-plan/hero-to-pro/HP4-action-plan.md`
> - `docs/charter/plan-hero-to-pro.md` §7.6 HP5
> 下游交接:
> - `docs/action-plan/hero-to-pro/HP6-action-plan.md`
> 关联设计 / 调研文档:
> - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`
> - `docs/design/hero-to-pro/HPX-qna.md`
> 冻结决策来源:
> - `docs/design/hero-to-pro/HPX-qna.md` Q16-Q18、Q39（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `draft`

---

## 0. 执行背景与目标

HP5 不是“再多开一个 `/confirmations` endpoint”的表层补丁，而是要把当前已经存在的 permission/elicitation transport primitive、可选 `HookDispatcher` seam、以及 Session DO 的 await/record 机制，收束成统一的 confirmation control plane。到当前代码现实为止，`nacp-session` 只定义了 `session.permission.*` 与 `session.elicitation.*` 两组消息体；kernel 只有 `approval_pending`；public façade 只有 `permission/decision` 与 `elicitation/answer`；而 runtime 虽然已经有 `emitPermissionRequestAndAwait()` / `emitElicitationRequestAndAwait()` 与 `awaitAsyncAnswer()`，但它们还没有统一 registry、统一 API、统一 wait reason、统一 decision handler。

因此 HP5 的任务，是把“异步等用户回答”升级为正式产品骨架：`nano_session_confirmations` 成为唯一 pending/resolved durable truth，`/confirmations` 成为统一 list/detail/decision surface，kernel wait reason 统一为 `confirmation_pending`，hook dispatcher 第一次有真实调用方，而旧的 permission/elicitation endpoint/frame 则作为兼容层被收编，而不是继续和新面并行成第二真相源。与此同时，Q16-Q18 与条件题 Q39 已把关键边界冻结：**统一 control plane、内部统一 `confirmation_pending`、第一版只冻结 7 kind、不预留 `custom`，若未来需要 alias 也只允许外部兼容而不分裂内部语义**。

- **服务业务簇**：`hero-to-pro / HP5`
- **计划对象**：`hero-to-pro 的 confirmation control plane 与 runtime interruption owner`
- **本次计划解决的问题**：
  - 当前系统只有 permission/elicitation 两条孤立回路，没有统一 pending confirmation registry 与 `/confirmations` API。
  - kernel 仍只有 `approval_pending`，`HookDispatcher` 仍是可选 seam，permission helper 也还是同步 allow/deny 翻译器。
  - 旧 transport 和当前 live emitter 之间已经出现 shape 漂移，说明 HP5 需要在兼容期内完成统一，而不是继续让协议自然分叉。
- **本次计划的直接产出**：
  - 统一 confirmation registry、`GET /sessions/{id}/confirmations` / `GET .../{uuid}` / `POST .../{uuid}/decision`。
  - `session.confirmation.request` / `session.confirmation.update` frame 族、`confirmation_pending` wait 语义、live permission/elicitation round-trip。
  - 4 个 cross-e2e（15-18）与 `docs/issue/hero-to-pro/HP5-closure.md`。
- **本计划不重新讨论的设计结论**：
  - permission / elicitation / restore / cleanup / cancel 等确认行为统一收敛到单一 confirmation control plane，兼容旧 endpoint 但不保留第二套真相（来源：`docs/design/hero-to-pro/HPX-qna.md` Q16）。
  - kernel wait reason 内部统一为 `confirmation_pending`，`kind` 只作为 metadata，不进入 enum 爆炸（来源：`docs/design/hero-to-pro/HPX-qna.md` Q17）。
  - 第一版只冻结 7 个 confirmation kind，且不预留 `custom` escape hatch（来源：`docs/design/hero-to-pro/HPX-qna.md` Q18）。

---

## 1. 执行综述

### 1.1 总体执行方式

HP5 采用**先建立 confirmation durable truth 与统一 API/协议面 → 再统一 kernel / runtime 的等待语义 → 再接通 permission/elicitation 真调用方与兼容层 → 最后用 real-stack e2e 收口 F12/F13** 的顺序。先把“pending confirmation 到底是谁、从哪里读、向哪里决策”定成单一骨架，可以避免 runtime 和 façade 各自维护一套等待真相；而把 live caller 与 compat route 放在后半段，则能确保 PreToolUse permission、elicitation 恢复、legacy endpoint alias、以及 usage push closure 都建立在同一 registry 与 decision law 之上。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Registry + Public Surface | M | 建立 confirmation row、generic `/confirmations` API 与统一 frame 族 | `-` |
| Phase 2 | Protocol + Kernel Semantics | M | 统一 `confirmation_pending`、规范 request/update contract、把 dispatcher 变成正式 runtime seam | Phase 1 |
| Phase 3 | Live Callers + Compatibility | M | 打通 permission/elicitation 真 round-trip，并把旧 endpoint/frame 收编到统一 decision law | Phase 1-2 |
| Phase 4 | E2E + Closure | S | 用 15-18 cross-e2e 与 HP5 closure 终结 F12/F13 | Phase 1-3 |

### 1.3 Phase 说明

1. **Phase 1 — Registry + Public Surface**
   - **核心目标**：让 pending confirmation 第一次拥有统一 durable truth 与对外 API。
   - **为什么先做**：没有 registry 与 generic decision handler，live caller 只会继续写各自私有路径。
2. **Phase 2 — Protocol + Kernel Semantics**
   - **核心目标**：把协议、kernel wait、dispatcher seam 统一到一条 confirmation 主线。
   - **为什么放在这里**：只有先有 generic row/API，`confirmation_pending` 与 request/update frame 才有单一真相来源。
3. **Phase 3 — Live Callers + Compatibility**
   - **核心目标**：让 PreToolUse permission 与 elicitation 真暂停、真恢复，同时保留旧 endpoint/frame 兼容窗口。
   - **为什么放在这里**：live caller 必须消费 Phase 1 的 registry 与 Phase 2 的 runtime semantics。
4. **Phase 4 — E2E + Closure**
   - **核心目标**：证明 pending list、stream/frame、runtime 恢复、usage push 四层证据一致。
   - **为什么最后**：只有 registry、kernel、compat、live caller 都已落地，F12/F13 才能被真正终结。

### 1.4 执行策略说明

- **执行顺序原则**：先统一 truth，再统一 wait 语义，先收编 compat，再接 live caller，最后做 real-stack closure。
- **风险控制原则**：不新增第二套 wakeup primitive、不让 legacy route 继续绕过 registry、不新增 `failed` status、不把 7 kind 扩成任意集合。
- **测试推进原则**：`@haimang/nacp-session`、agent-core、orchestrator-core 测试之外，必须补 15-18 四个 cross-e2e，并覆盖 allow/deny/timeout、elicitation answer/cancel、usage push live。
- **文档同步原则**：closure 必须同时记录 registry verdict、runtime wait verdict、compat verdict、usage push verdict。
- **回滚 / 降级原则**：统一遵守 Q16 双写顺序：先写 confirmation row，再走 DO storage primitive；若第二步失败，不留下 phantom pending，而是把 row 回写到现有失效终态 `superseded`，并把失败细节写进 `decision_payload_json` + audit/error log。

### 1.5 本次 action-plan 影响结构图

```text
hero-to-pro HP5 confirmation control plane
├── Phase 1: Registry + Public Surface
│   ├── packages/nacp-session/src/messages.ts
│   ├── /sessions/{id}/confirmations
│   └── generic decision handler + confirmation rows
├── Phase 2: Protocol + Kernel Semantics
│   ├── workers/agent-core/src/kernel/{types,interrupt}.ts
│   ├── workers/agent-core/src/host/runtime-mainline.ts
│   └── HookDispatcher runtime seam
├── Phase 3: Live Callers + Compatibility
│   ├── PreToolUse permission
│   ├── elicitation round-trip
│   ├── session-do await/record primitive
│   └── legacy permission/elicitation alias path
└── Phase 4: E2E + Closure
    ├── test/cross-e2e/15-18
    └── docs/issue/hero-to-pro/HP5-closure.md
```

### 1.6 已核对的当前代码锚点

1. **协议层目前只有 permission / elicitation 两组异步消息，没有 generic confirmation frame**
   - `packages/nacp-session/src/messages.ts:146-191,232-255,260-319`
   - 当前 registry 中只有 `session.permission.request/decision` 与 `session.elicitation.request/answer`，还没有 `session.confirmation.request/update`。
2. **当前 permission request schema 与 live emitter 已经出现 shape 漂移**
   - `packages/nacp-session/src/messages.ts:169-178`
   - `workers/agent-core/src/host/do/session-do-runtime.ts:376-389`
   - schema 期待 `tool_name/tool_input`，但 live emitter 当前推的是 `{ capability, reason }`，说明 HP5 需要在兼容期内完成协议统一。
3. **HookDispatcher 已完整存在，但 permission helper 仍只是同步 allow/deny 翻译器**
   - `workers/agent-core/src/hooks/dispatcher.ts:45-148`
   - `workers/agent-core/src/hooks/permission.ts:31-70`
   - `workers/agent-core/src/host/runtime-mainline.ts:125-140,498-503`
   - dispatcher 还是可选注入，permission helper 仍把 aggregated hook outcome 翻译成同步 verdict，没有 generic confirmation wait。
4. **kernel 现在只有 `approval_pending`，没有统一 `confirmation_pending`**
   - `workers/agent-core/src/kernel/types.ts:41-67`
   - `workers/agent-core/src/kernel/interrupt.ts:20-39`
   - 当前 wait reason 只覆盖 `approval_pending`，且 classification 也只认这一个确认类中断。
5. **Session DO 的 await/record primitive 已可复用，但仍只面向 permission / elicitation**
   - `workers/agent-core/src/host/do/session-do-persistence.ts:288-385`
   - `workers/agent-core/src/host/do/session-do-runtime.ts:350-414`
   - `workers/agent-core/src/host/do/session-do/fetch-runtime.ts:101-106`
   - 当前已经有 `recordAsyncAnswer()`、`awaitAsyncAnswer()`、`emitPermissionRequestAndAwait()`、`emitElicitationRequestAndAwait()` 与直达 DO 的 compat return path。
6. **public façade 当前只暴露旧 answer 路径，没有 `/confirmations`**
   - `workers/orchestrator-core/src/index.ts:364-440,707-711`
   - `workers/orchestrator-core/src/user-do/surface-runtime.ts:221-320`
   - 现在只有 `permission/decision` 与 `elicitation/answer` 两条 legacy ingress。
7. **F13 所需的 usage push seam 已存在，但仍需要 real-stack closure**
   - `workers/agent-core/src/host/runtime-mainline.ts:125-130,408-421,552-557`
   - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:130-153`
   - `onUsageCommit` 已在 tool/llm quota commit 后触发并通过 `pushServerFrameToClient` 推 `session.usage.update`，HP5 需要把这条 seam 纳入 18 号 e2e 与 closure，而不是另造使用量通道。
8. **外部 precedent 已核对并支持 HP5 的“统一 control plane + correlation”设计**
   - `context/claude-code/server/directConnectManager.ts:81-99`, `context/gemini-cli/packages/core/src/confirmation-bus/types.ts:18-79,145-155,200-212`, `context/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts:79-148,204-220`
   - precedent 共同说明 confirmation / ask-user / policy 更新应共享统一消息族、稳定关联 ID 与独立控制轨；HP5 只吸收统一 control plane 与 correlation law，不照抄外部 UI / policy engine 细节。

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 统一 confirmation row truth 与 `GET /sessions/{id}/confirmations` / `GET .../{uuid}` / `POST .../{uuid}/decision`。
- **[S2]** `session.confirmation.request` / `session.confirmation.update` frame 族与 legacy dual-emit 兼容策略。
- **[S3]** `confirmation_pending` wait 语义、kind metadata、HookDispatcher 真注入。
- **[S4]** permission / elicitation 真 round-trip：创建 row → emit/request → await → decision → runtime resume。
- **[S5]** 第一版 7 个 confirmation kind 的冻结与 generic API 接纳。
- **[S6]** 15-18 四个 cross-e2e 与 HP5 closure（含 F12/F13）。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 物理删除 legacy permission/elicitation endpoint 或立刻结束 compat window。
- **[O2]** 7 个 kind 全部在 HP5 live；HP5 真接线只覆盖 `tool_permission` 与 `elicitation`。
- **[O3]** tool/workspace/restore/cleanup 等具体业务 payload 设计细节。
- **[O4]** 客户端最终 UI/文案与视觉交互稿。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| permission/elicitation 继续各走一套路由 | `out-of-scope` | Q16 已冻结为统一 control plane + compat 收编 | 不重评；这是 HP5 核心目标 |
| kernel 为每个 confirmation kind 扩一个 pending enum | `out-of-scope` | Q17 已冻结内部统一 `confirmation_pending` | 除非 HPX-qna 被正式重开 |
| 7 个 kind 在 HP5 就要全部 live | `out-of-scope` | Q18 冻结的是 enum/API 边界，不是所有业务都在 HP5 接线 | 后续 HP3/HP4/HP6/HP7 分 phase 接线 |
| 外部 alias 替代内部 `confirmation_pending` 语义 | `defer / not-triggered` | Q39 已冻结当前不触发；如未来需要，也只能外部 alias、内部不分裂 | 仅在命名争议重新出现时重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | confirmation registry + decision handler | `update` | orchestrator-core + HP1 confirmation truth | 让 pending/resolved confirmation 拥有统一 durable owner | `high` |
| P1-02 | Phase 1 | generic `/confirmations` API | `update` | `workers/orchestrator-core/src/index.ts`, User DO surface | 让客户端第一次拥有统一 confirmation list/detail/decision 面 | `medium` |
| P1-03 | Phase 1 | confirmation frame family + protocol normalization | `update` | `packages/nacp-session/src/messages.ts`, push path | 让 generic request/update frame 成为正式协议，并收敛现有漂移 | `high` |
| P2-01 | Phase 2 | kernel wait unification | `update` | `workers/agent-core/src/kernel/{types,interrupt}.ts` | 让所有确认类等待统一为 `confirmation_pending` | `high` |
| P2-02 | Phase 2 | HookDispatcher runtime injection | `update` | `workers/agent-core/src/host/runtime-mainline.ts`, runtime assembly | 让 dispatcher 第一次成为真实主线依赖 | `medium` |
| P3-01 | Phase 3 | permission live round-trip | `update` | hooks + Session DO await/record primitive | 让 `emitPermissionRequestAndAwait()` 第一次有真调用方 | `high` |
| P3-02 | Phase 3 | elicitation live round-trip + compat alias | `update` | Session DO + façade + compat routes | 让 elicitation 进入统一 registry，并保留旧 answer return path | `high` |
| P3-03 | Phase 3 | row-first dual-write law | `update` | orchestrator-core + agent-core decision paths | 让 registry → DO primitive 的双写顺序、失败终态和日志 law 固化 | `high` |
| P4-01 | Phase 4 | cross-e2e 15-18 | `add` | `test/cross-e2e/**` | 用真实 6-worker round-trip 终结 F12/F13 | `medium` |
| P4-02 | Phase 4 | HP5 closure | `update` | `docs/issue/hero-to-pro/HP5-closure.md` | 让 HP6/HP7 可直接消费 HP5 verdict | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Registry + Public Surface

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | confirmation registry + decision handler | 统一 confirmation row 的 create/read/update 与 generic decision handler；legacy permission/elicitation decision 最终也落到同一 handler | orchestrator-core + HP1 `nano_session_confirmations` truth | pending/resolved confirmation 第一次有单一 durable owner | D1 assertions + orchestrator-core tests | list/detail/decision 都围绕同一 row truth 工作 |
| P1-02 | generic `/confirmations` API | 新增 `GET /sessions/{id}/confirmations`、`GET /sessions/{id}/confirmations/{uuid}`、`POST /sessions/{id}/confirmations/{uuid}/decision` 三件套 | `workers/orchestrator-core/src/index.ts`, User DO surface | 客户端终于有统一 confirmation 面 | route tests + API tests | legacy path 与 generic path 最终命中同一 decision law |
| P1-03 | confirmation frame family + protocol normalization | 在 `nacp-session` 增加 `session.confirmation.request/update`；规范 generic payload；兼容期内保留 legacy permission/elicitation dual-emit，但不再让 live emitter 与 schema 继续漂移；关联 ID / 控制分轨对齐 Claude direct-connect 与 Gemini confirmation bus precedent | `packages/nacp-session/src/messages.ts`, push path | control-plane frame 族正式成型 | package tests + integration tests | generic frame 已注册；当前 `tool_name/tool_input` vs `capability` 漂移被收敛 |

### 4.2 Phase 2 — Protocol + Kernel Semantics

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | kernel wait unification | 把确认类等待统一成 `confirmation_pending`，kind 作为 metadata；interrupt classification / resume 逻辑跟随迁移 | `workers/agent-core/src/kernel/{types,interrupt}.ts` | runtime 等待语义不再按 kind 爆炸 | kernel tests | 不再出现为每种确认单独加一个 pending enum 的路径 |
| P2-02 | HookDispatcher runtime injection | `createMainlineKernelRunner` 与 runtime assembly 真接 `HookDispatcher`，不再只是 optional seam；为 live caller 提供统一 confirmation requester 上下文 | `workers/agent-core/src/host/runtime-mainline.ts`, `runtime-assembly.ts` | dispatcher 从 seam 升级为真实主线依赖 | agent-core tests | dispatcher 已成为真调用链的一部分，fail-closed/timeout/depth guard 仍有效 |

### 4.3 Phase 3 — Live Callers + Compatibility

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | permission live round-trip | `PreToolUse` 在 `policy.shouldAsk()` 时走 confirmation registry → `emitPermissionRequestAndAwait()` → decision → runtime 恢复；allow/deny/timeout 都有明确终态 | hooks + Session DO runtime | `emitPermissionRequestAndAwait()` 第一次有真调用方 | agent-core/orchestrator-core tests | tool call 会真实暂停并恢复，不再只停留在设计稿 |
| P3-02 | elicitation live round-trip + compat alias | elicitation 走同一 registry / wait law；旧 `permission/decision` 与 `elicitation/answer` 继续保留为兼容 alias，并在 dual-emit 窗口内工作 | Session DO + façade + User DO surface | elicitation 进入统一 control plane，legacy client 不 break | integration tests + compat tests | new API 与 legacy API 都能恢复同一 pending confirmation |
| P3-03 | row-first dual-write law | 冻结“先写 confirmation row → 后写 DO storage primitive”的双写顺序；confirmation 终态固定为 `pending | allowed | denied | modified | timeout | superseded`；若第二步失败，row 进入 `superseded`，并写 `decision_payload_json` + audit/error log | orchestrator-core + agent-core decision path | pending 列表与 runtime 恢复不再分裂 | failure path tests | 不新增 `failed` status，不留下 phantom pending |

### 4.4 Phase 4 — E2E + Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | cross-e2e 15-18 | 落地 `15-permission-roundtrip-allow`、`16-permission-roundtrip-deny`、`17-elicitation-roundtrip`、`18-usage-push-live` 四个 real-stack e2e；`15-18` 为 HP5 保留编号范围，其他 phase 若采用编号文件必须显式避让 | `test/cross-e2e/**` | F12/F13 终结有真实证据 | `pnpm test:cross-e2e` | 4 个用例全绿，覆盖 allow/deny/timeout、elicitation、usage push live |
| P4-02 | HP5 closure | 回填 registry verdict、`confirmation_pending` verdict、compat verdict、usage push verdict、7-kind readiness matrix，并显式登记 F1-F17 chronic status（`closed / partial / not-touched / handed-to-platform`） | `docs/issue/hero-to-pro/HP5-closure.md` | HP6/HP7 能直接消费 HP5 输出 | doc review | closure 能独立回答“统一 confirmation 面是否已成型，以及 compat 还剩什么窗口” |

---

## 5. Phase 详情

### 5.1 Phase 1 — Registry + Public Surface

- **Phase 目标**：让 confirmation 第一次拥有统一 durable truth、统一 API 与统一 frame 族。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 修改文件**：
  - `packages/nacp-session/src/messages.ts`
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts`
  - 可能涉及 orchestrator-core confirmation read/write helper 模块
- **本 Phase 已核对的源码锚点**：
  - `packages/nacp-session/src/messages.ts:146-191,232-255,260-319`
  - `workers/orchestrator-core/src/index.ts:364-440,707-711`
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:221-320`
- **具体功能预期**：
  1. `/confirmations` 三件套成为 generic public surface。
  2. `session.confirmation.request/update` 成为正式 message type，并对齐当前 live emitter 所需字段。
  3. legacy permission/elicitation 路径最终只作为 alias，不再各自维护第二套 truth。
- **具体测试安排**：
  - **单测**：`@haimang/nacp-session` schema tests、orchestrator-core route tests。
  - **集成测试**：generic decision handler 与 legacy alias 对撞。
  - **回归测试**：
    - `pnpm --filter @haimang/nacp-session typecheck build test`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - pending confirmation 能被统一 list/detail/read。
  - generic frame 与 current emitter 不再漂移。
- **本 Phase 风险提醒**：
  - 若 registry 和 legacy alias 继续双轨各写各的，HP5 会从第一天起就失去“统一 control plane”的意义。

### 5.2 Phase 2 — Protocol + Kernel Semantics

- **Phase 目标**：统一等待语义，并让 dispatcher 成为真实 runtime 主线。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 修改文件**：
  - `workers/agent-core/src/kernel/types.ts`
  - `workers/agent-core/src/kernel/interrupt.ts`
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`
  - `workers/agent-core/src/hooks/permission.ts`
- **本 Phase 已核对的源码锚点**：
  - `workers/agent-core/src/kernel/types.ts:41-67`
  - `workers/agent-core/src/kernel/interrupt.ts:20-39`
  - `workers/agent-core/src/host/runtime-mainline.ts:125-140,498-503`
  - `workers/agent-core/src/hooks/dispatcher.ts:45-148`
- **具体功能预期**：
  1. kernel 只认识 `confirmation_pending`，而不是再长出 `elicitation_pending` / `restore_pending` / ...。
  2. `confirmation_kind` 作为 metadata 在 runtime / replay / observability 可读，但不进入 enum。
  3. `HookDispatcher` 在主线 runner 中成为真依赖，timeout/depth/fail-closed 行为继续复用现有 guard。
- **具体测试安排**：
  - **单测**：kernel interrupt migration tests、dispatcher injection tests。
  - **集成测试**：wait reason metadata + resume path 对撞。
  - **回归测试**：
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - runtime 内部不再需要为每种确认单独开 pending enum。
  - dispatcher 不再只是“有就用、没有就算了”的历史 seam。
- **本 Phase 风险提醒**：
  - 若 internal semantics 因命名争议而再次 split，Q17 和整个 HP5 的治理价值会被直接打穿。

### 5.3 Phase 3 — Live Callers + Compatibility

- **Phase 目标**：让 permission / elicitation 真暂停、真恢复，同时把旧 endpoint/frame 收编到同一条法律。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 修改文件**：
  - `workers/agent-core/src/hooks/permission.ts`
  - `workers/agent-core/src/host/do/session-do-runtime.ts`
  - `workers/agent-core/src/host/do/session-do-persistence.ts`
  - `workers/agent-core/src/host/do/session-do/fetch-runtime.ts`
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts`
- **本 Phase 已核对的源码锚点**：
  - `workers/agent-core/src/host/do/session-do-runtime.ts:350-414`
  - `workers/agent-core/src/host/do/session-do-persistence.ts:288-385`
  - `workers/agent-core/src/host/do/session-do/fetch-runtime.ts:101-106`
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:221-320`
- **具体功能预期**：
  1. `emitPermissionRequestAndAwait()` 与 `emitElicitationRequestAndAwait()` 都先经过 confirmation row，再进入 DO primitive。
  2. 旧 `permission/decision` / `elicitation/answer` 继续可用，但最终落到 generic decision handler。
  3. DO primitive 第二步失败时，row 进入 `superseded`，而不是留着 phantom pending 或新增 `failed` status。
- **具体测试安排**：
  - **单测**：permission/elicitation live caller tests、failure path tests。
  - **集成测试**：registry → DO storage → runtime resume 链路。
  - **回归测试**：
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - `emitPermissionRequestAndAwait` 第一次拥有真调用方。
  - permission/elicitation 新旧入口都能恢复到同一 pending confirmation truth。
- **本 Phase 风险提醒**：
  - 若 dual-write 顺序被实现成“先 DO storage 再 row”，会立刻制造“runtime 等到了、列表却看不到”的分裂现场。

### 5.4 Phase 4 — E2E + Closure

- **Phase 目标**：证明统一 confirmation 面已在真实 6-worker 栈中闭环，并完成 F12/F13 收口。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `test/cross-e2e/15-permission-roundtrip-allow.test.mjs`
  - `test/cross-e2e/16-permission-roundtrip-deny.test.mjs`
  - `test/cross-e2e/17-elicitation-roundtrip.test.mjs`
  - `test/cross-e2e/18-usage-push-live.test.mjs`
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/HP5-closure.md`
- **本 Phase 已核对的源码锚点**：
  - `workers/agent-core/src/host/runtime-mainline.ts:408-421,552-557`
  - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:138-153`
- **具体功能预期**：
  1. allow/deny/timeout、elicitation answer/cancel、usage push live 都有 real-stack 证据。
  2. HP5 closure 能独立说明 F12 hook dispatcher 与 F13 usage push 是否已真正终结。
- **具体测试安排**：
  - **单测**：无新增单测为主。
  - **集成测试**：6-worker round-trip + confirmation registry + WS frames。
  - **回归测试**：
    - `pnpm test:cross-e2e`
    - `pnpm --filter @haimang/nacp-session typecheck build test`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - **手动验证**：closure 对照 e2e 结果回填。
- **收口标准**：
  - 15-18 四个 e2e 全绿。
  - closure 对 registry / kernel / compat / usage push 四层都给出明确 verdict。
- **本 Phase 风险提醒**：
  - 若 e2e 只 mock endpoint 而不启真实 6-worker stack，F12/F13 仍然不算终结。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q16 — 统一 confirmation control plane | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP5 必须有 registry、generic API、row-first dual-write，且旧 endpoint 只做 compat alias | 若执行期想回到 endpoint-per-kind，必须退回 design/QNA |
| Q17 — 内部统一 `confirmation_pending` | `docs/design/hero-to-pro/HPX-qna.md` | 决定 kernel interrupt 只保留统一等待语义，kind 以 metadata 表达 | 若要继续扩 pending enum，必须重开 QNA |
| Q18 — 第一版冻结 7 kind，且不留 `custom` | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP5 的 schema/API 只接受 charter 冻结 kind 集合 | 若未来要扩 kind，必须进 HPX-qna |
| Q39 — alias 只可外部兼容、内部不分裂 | `docs/design/hero-to-pro/HPX-qna.md` | 决定即使未来发生命名兼容，内部 runtime 仍维持 `confirmation_pending` 单一语义 | 当前 not-triggered；若触发，alias 也不得永久化 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| HP1 confirmation truth 依赖 | HP5 假定 `nano_session_confirmations` 与 charter enum 已由 HP1 冻结 | `high` | HP5 不私补 schema；缺口只能回到 HP1 correction law |
| HP4 closure 前置依赖 | charter 已明确 HP5 应在 HP4 closure 后启动，避免 kernel interrupt / runtime-mainline 改动并发互踩 | `high` | HP4 未 closure 时，HP5 保持未启动；不得并行改同一条 interrupt 主线 |
| 协议漂移已存在 | `messages.ts` 与 live permission emitter 当前字段已分叉 | `high` | 在 Phase 1 一次性收敛 generic frame contract，并保留 compat |
| row → DO dual-write 分裂 | 先后任一步失败都会制造 pending 列表与 runtime 恢复不一致 | `high` | 冻结 row-first law；第二步失败写 `superseded` + audit/error |
| kernel rename ripple | `approval_pending` → `confirmation_pending` 会波及 resume/observability/replay | `medium` | 统一用 metadata 承载 kind，必要时仅提供外部 alias，不分裂内部语义 |
| compat window 拖太久 | 旧 endpoint/frame 永久存在会形成第二真相源 | `medium` | deprecate 节奏延至 HP10 决定，但 HP5 内部一开始就只保留一个决策真相 |

### 7.2 约束与前提

- **技术前提**：HP1 已冻结 `nano_session_confirmations` 与 7-kind enum；继续复用 `awaitAsyncAnswer()` / `recordAsyncAnswer()`，不另造唤醒通道。
- **运行时前提**：`HookDispatcher` 的 timeout/depth/fail-closed guard 必须原样保留；`onUsageCommit` 继续使用现有推帧通路。
- **执行顺序前提**：HP5 只在 HP4 closure 后启动，避免 `runtime-mainline.ts` / interrupt path 与 HP4 的生命周期治理并发改同一主线。
- **组织协作前提**：HP5 不重开 Q16-Q18；后续 HP3/HP4/HP6/HP7 消费 confirmation 时，只接入已有 control plane，不新造 waiting 路径。
- **上线 / 合并前提**：registry、generic API、runtime wait、compat route、15-18 e2e、HP5 closure 六层证据齐全。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/hero-to-pro/HP3-context-state-machine.md`
  - `docs/design/hero-to-pro/HP4-chat-lifecycle.md`
  - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`
- 需要同步更新的说明文档 / README：
  - `docs/issue/hero-to-pro/HP5-closure.md`
- 需要同步更新的测试说明：
  - `test/index.md` 或 cross-e2e 说明（若 15-18 成为新的固定 gate）

### 7.4 完成后的预期状态

1. 所有“agent 为什么停住等用户”都会能在统一 confirmation 列表里被解释。
2. permission / elicitation 会共享同一 registry、同一 decision law、同一恢复语义，而不是各走各路。
3. kernel 内部会只保留一个确认类等待语义，后续 HP3/HP4/HP6/HP7 只需接 kind 与 payload。
4. HP6 Tool/Workspace 与 HP7 Restore/Recovery 会第一次有可直接复用的人机边界骨架。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 检查 `session.confirmation.request/update` 已进入 `packages/nacp-session/src/messages.ts` registry。
  - 检查 `/sessions/{id}/confirmations` 三件套已存在，且 legacy permission/elicitation 最终命中同一 decision law。
- **单元测试**：
  - `pnpm --filter @haimang/nacp-session typecheck build test`
  - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
- **集成测试**：
  - confirmation row + DO primitive + runtime resume + compat alias 对撞
- **端到端 / 手动验证**：
  - `pnpm test:cross-e2e`
- **回归测试**：
  - 15 allow、16 deny、17 elicitation、18 usage push live 四条场景
- **前序 phase 回归**：
  - 至少回归 HP3 的 context / compact 主线与 HP4 的 retry / restore 主线，确认 `confirmation_pending` 重构没有把既有 interrupt / resume 语义打断。
- **文档校验**：
  - `docs/issue/hero-to-pro/HP5-closure.md` 必须同时写明 registry / wait reason / compat / usage push 四层 verdict
  - `docs/issue/hero-to-pro/HP5-closure.md` 必须包含 7-kind readiness matrix 与 F1-F17 chronic status

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `/confirmations` 三件套已 live，且 pending/resolved confirmation 能统一 list/detail/decision。
2. kernel 内部已统一到 `confirmation_pending`，kind 通过 metadata 可见。
3. permission / elicitation 已进入统一 registry，并保留旧 endpoint/frame 兼容窗口。
4. 15-18 四个 cross-e2e 全绿，HP5 closure 已清楚写出 F12/F13 最终 verdict。
5. HP5 closure 已显式声明 F1-F17 的 phase 状态，并以 readiness matrix 解释 7-kind 中哪些 live、哪些仅 freeze。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | confirmation registry、generic API、runtime wait、legacy compat 与 live callers 已完整闭环 |
| 测试 | `@haimang/nacp-session`、agent-core、orchestrator-core 测试通过，15-18 cross-e2e 全绿 |
| 文档 | HP5 closure 能独立解释 registry、compat、kernel、usage push 四层结果 |
| 风险收敛 | 不再 endpoint-per-kind、不再 pending enum 爆炸、不再存在 phantom pending |
| 可交付性 | HP6/HP7 可以直接基于 7-kind freeze 与统一 confirmation plane 继续实施 |
