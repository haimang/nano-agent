# Nano-Agent 行动计划 — Session DO Runtime

> 服务业务簇: `Session Actor Runtime`
> 计划对象: `@nano-agent/session-do-runtime` — nano-agent 的 Worker / Session DO 组装层与会话 actor runtime
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-16`
> 文件位置: `packages/session-do-runtime/`（主仓 monorepo 内的 workspace package；作为首个 deploy-oriented Worker / Session DO 组装包）
> 关联设计 / 调研文档:
> - `docs/design/session-do-runtime-by-opus.md`
> - `docs/design/agent-runtime-kernel-by-GPT.md`
> - `docs/design/workspace-context-artifacts-by-GPT.md`
> - `docs/design/capability-runtime-by-GPT.md`
> - `docs/design/hooks-by-GPT.md`
> - `docs/design/eval-observability-by-opus.md`
> - `docs/action-plan/nacp-core.md`
> - `docs/action-plan/nacp-session.md`
> - `docs/action-plan/agent-runtime-kernel.md`
> - `docs/action-plan/llm-wrapper.md`
> - `docs/action-plan/capability-runtime.md`
> - `docs/action-plan/workspace-context-artifacts.md`
> - `docs/action-plan/hooks.md`
> - `docs/action-plan/eval-observability.md`
> - `docs/investigation/plan-after-nacp-reviewed-by-GPT-to-opus.md`
> - `docs/plan-after-nacp.md`
> - `README.md`
> - 参考代码：`packages/nacp-core/`、`packages/nacp-session/`、`context/codex/`、`context/claude-code/`、`context/mini-agent/`
> 文档状态: `draft`

---

## 0. 执行背景与目标

`nacp-core` 与 `nacp-session` 已经分别冻结了 **内部 envelope / transport contract** 与 **client ↔ session DO 的 WebSocket profile**；前面 6 份 action-plan 也已经把 kernel、llm、capability、workspace、hooks、observability 的包级边界铺开。  
现在缺的，是把这些包真正**装配成一个能跑起来的 Cloudflare Worker + Durable Object 会话 actor**。

`Session DO Runtime` 不是又一个“逻辑库”，而是 nano-agent 第一层真正接近可部署单元的 runtime assembly package。它要回答的不是“某个子系统怎么实现”，而是：

1. Worker fetch 入口如何路由到 Session DO
2. Session DO 如何以 **WebSocket-first + HTTP fallback** 双入口服务会话
3. Session DO 如何驱动 step-driven kernel，并在每一步之间做 health check / checkpoint / dispatch
4. `SessionWebSocketHelper`、workspace snapshot、hook dispatcher、llm executor、capability runtime、trace sink 如何在一个 actor 里被安全组装

同时，这份 action-plan 必须直接绕开前一轮 review 指出的两个断点：

- **Session WebSocket legality 只能由 `@nano-agent/nacp-session` 仲裁**，不能重新把 Session phase 语义拖回 `nacp-core`
- **正常用户 turn ingress contract 仍未完全冻结**，当前最小 reality 只有 `session.start.body.initial_input`

- **服务业务簇**：`Session Actor Runtime`
- **计划对象**：`@nano-agent/session-do-runtime`
- **本次计划解决的问题**：
  - nano-agent 目前有协议包与功能包规划，但没有真正的 Worker / Session DO 组装层
  - `SessionWebSocketHelper`、kernel、workspace、hooks、llm、capability 之间还缺统一 composition contract
  - WebSocket-first 与 HTTP fallback 的运行时职责仍未被同一份行动计划收口
  - checkpoint / restore / graceful shutdown / heartbeat / ack health / trace sink 的调用时机需要由 Session DO 明确承担
- **本次计划的直接产出**：
  - `packages/session-do-runtime/` workspace package 骨架
  - Worker entry、Session DO class、composition factory、ingress adapter、checkpoint/alarm/shutdown helpers
  - 与 `@nano-agent/nacp-session` reality 严格对齐的 WebSocket / HTTP 双入口运行时
  - 可驱动 kernel delegates 的 Session actor loop 与 fixture-based integration tests

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 分 **6 个 Phase**，执行策略是 **“先装配 contract 与 ingress，再组装 actor lifecycle，再接 kernel/delegates，最后补 checkpoint/health 与全链路场景测试”**。  
这里最重要的是：`session-do-runtime` 必须是 **runtime assembly layer**，而不是把 kernel、llm、capability、workspace 的实现细节重新吞回去。它负责编排、生命周期与入口，不负责重写下游子系统真相。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | 包骨架与 Session Composition Contract | M | 建立独立包，冻结 Worker/DO 组装 contract、runtime env、subsystem composition seam | `-` |
| Phase 2 | Ingress Profiles / Worker Routing / Turn Intake | L | 落 WebSocket-first + HTTP fallback 双入口，并收敛最小 turn ingress contract | Phase 1 |
| Phase 3 | Session Actor Lifecycle / WebSocket Attach / Health Gates | L | 组装 `SessionWebSocketHelper`、Session-owned phase gate、single-active-turn 与 caller-managed health | Phase 1, Phase 2 |
| Phase 4 | Kernel Orchestration / Delegate Wiring / Event Dispatch | L | 让 Session DO 逐步驱动 kernel，并接入 llm/hooks/capability/workspace/eval delegates | Phase 1-3 |
| Phase 5 | Checkpoint / Restore / Alarm / Graceful Shutdown | M | 建立 checkpoint seam、restore path、alarm health checks 与 shutdown 流程 | Phase 3, Phase 4 |
| Phase 6 | Integration Fixtures / 文档 / 收口 | M | 用 fake provider/tool/hook/workspace 场景跑通 session skeleton，并完成导出与说明文档 | Phase 1-5 |

### 1.3 Phase 说明

1. **Phase 1 — 包骨架与 Session Composition Contract**
   - **核心目标**：建立独立包，冻结 runtime env、Worker/DO 装配边界、composition factory、dependency interfaces 与 deploy-oriented exports。
   - **为什么先做**：若不先定义 assembly seam，后续 DO 逻辑很快会把所有子系统反向内联。
2. **Phase 2 — Ingress Profiles / Worker Routing / Turn Intake**
   - **核心目标**：实现 Worker fetch routing、WebSocket upgrade、HTTP fallback 入口，并显式收敛最小 turn ingress contract。
   - **为什么放在这里**：Session actor 的入口如果不先冻结，kernel 与 lifecycle 都没有稳定起点。
3. **Phase 3 — Session Actor Lifecycle / WebSocket Attach / Health Gates**
   - **核心目标**：组装 `SessionWebSocketHelper`、Session-owned phase/role gate、single-active-turn guard，以及 caller-managed ack/heartbeat health。
   - **为什么放在这里**：attach/resume/health 是 Session DO 成为 actor 的最小骨架。
4. **Phase 4 — Kernel Orchestration / Delegate Wiring / Event Dispatch**
   - **核心目标**：让 Session DO 按 step 驱动 kernel，并把 hooks / llm / capability / workspace / observability 接成受控 delegates。
   - **为什么放在这里**：只有入口、phase、health 稳定后，step loop 编排才不会被 transport 细节污染。
5. **Phase 5 — Checkpoint / Restore / Alarm / Graceful Shutdown**
   - **核心目标**：把 replay checkpoint、workspace snapshot、kernel fragment、usage/tracing state 拼成会话级 checkpoint seam，并完成 alarm / shutdown。
   - **为什么放在这里**：checkpoint shape 必须建立在真实 orchestration 路径之上，不能先拍脑袋定义。
6. **Phase 6 — Integration Fixtures / 文档 / 收口**
   - **核心目标**：跑通最小 session skeleton，并明确 Session DO runtime 的支持/不支持边界。
   - **为什么放在这里**：session actor 的正确性只能通过完整 attach → turn → checkpoint → resume 场景验证。

### 1.4 执行策略说明

- **执行顺序原则**：`composition/env -> ws/http ingress -> actor lifecycle -> kernel orchestration -> checkpoint/alarm -> fixtures/docs`
- **风险控制原则**：Session WebSocket legality 只走 `@nano-agent/nacp-session`；不让 `nacp-core` 重新承担 Session profile phase ownership；HTTP fallback 与 WS 共用对象模型但不复制 transport 逻辑
- **测试推进原则**：先测 routing/ingress/phase/health，再测 kernel orchestration 与 checkpoint/resume，最后用完整 session scenario 收口
- **文档同步原则**：实现时同步回填 `session-do-runtime-by-opus.md`、`agent-runtime-kernel-by-GPT.md`、`eval-observability-by-opus.md`、`storage-topology-by-opus.md`

### 1.5 本次 action-plan 影响目录树

```text
packages/session-do-runtime/
├── src/
│   ├── version.ts
│   ├── env.ts
│   ├── composition.ts
│   ├── worker.ts
│   ├── routes.ts
│   ├── http-controller.ts
│   ├── ws-controller.ts
│   ├── turn-ingress.ts
│   ├── actor-state.ts
│   ├── health.ts
│   ├── orchestration.ts
│   ├── checkpoint.ts
│   ├── alarm.ts
│   ├── shutdown.ts
│   ├── traces.ts
│   ├── do/
│   │   └── nano-session-do.ts
│   └── index.ts
├── test/
│   ├── routes.test.ts
│   ├── http-controller.test.ts
│   ├── ws-controller.test.ts
│   ├── turn-ingress.test.ts
│   ├── health.test.ts
│   ├── orchestration.test.ts
│   ├── checkpoint.test.ts
│   └── integration/
│       ├── start-turn-resume.test.ts
│       ├── ws-http-fallback.test.ts
│       ├── heartbeat-ack-timeout.test.ts
│       └── graceful-shutdown.test.ts
├── package.json
├── tsconfig.json
├── wrangler.jsonc
├── README.md
└── CHANGELOG.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `@nano-agent/session-do-runtime` 独立包骨架
- **[S2]** Worker fetch entry：routing WebSocket upgrade / HTTP fallback / internal Session DO fetch
- **[S3]** `NanoSessionDO` class 与 composition factory
- **[S4]** `SessionWebSocketHelper` 装配：attach / detach / handleResume / pushEvent / checkpoint / restore
- **[S5]** 使用 `@nano-agent/nacp-session` 的 `assertSessionPhaseAllowed()` / `assertSessionRoleAllowed()` / `normalizeClientFrame()`，明确 Session-owned legality
- **[S6]** WebSocket-first + HTTP fallback 双入口共享同一 session model 与 event/output body
- **[S7]** 最小 turn ingress contract：支持 `session.start.body.initial_input` 打通首个 e2e turn
- **[S8]** `TurnIngressAdapter` seam：为后续多轮输入 family 预留接口，但不在本包里偷偷发明新的 wire truth
- **[S9]** single-active-turn guard、pending input queue / running turn slot、cancel path
- **[S10]** kernel step orchestration：Session DO 按 step 驱动 kernel，并在每一步之间处理 health / dispatch / checkpoint 决策
- **[S11]** delegates wiring：llm-wrapper、capability-runtime、hooks、workspace-context-artifacts、eval-observability
- **[S12]** caller-managed ack/heartbeat enforcement：周期性调用 `checkHeartbeatHealth()` / `checkAckHealth()`
- **[S13]** checkpoint / restore seam：拼接 `SessionWebSocketHelper`、kernel、workspace、usage/tracing fragment
- **[S14]** alarm handler：v1 至少承担 heartbeat / ack health 与 archive/flush 触发 seam
- **[S15]** graceful shutdown：`session.end` / timeout / fatal error → checkpoint → close
- **[S16]** integration fixtures 与 deploy-oriented README / wrangler config skeleton

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** sub-agent spawning / multi-DO federation
- **[O2]** multi-client attach / observer mode
- **[O3]** kernel 本体的 step scheduling 细节
- **[O4]** llm provider request construction与 provider auth helper 全家桶
- **[O5]** capability command registry / fake bash 命令面本体
- **[O6]** workspace / artifact 最终 storage topology 与 DDL
- **[O7]** production analytics / billing / cost pipeline
- **[O8]** 跨区域迁移与复杂 DO sharding
- **[O9]** 在本包里抢跑新的 `nacp-session` profile 真相并绕过 owner 决策

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| Session WebSocket legality 走 `@nano-agent/nacp-session` | `in-scope` | 这是已被 `nacp-session` 收口的结构性边界 | 默认不重评 |
| `session.start.initial_input` 打通首个 e2e turn | `in-scope` | 这是当前 `nacp-session` reality 下最小可行入口 | 默认不重评 |
| 后续多轮输入 family 的最终 wire truth | `defer / depends-on-decision` | 当前 profile 尚未冻结独立 `session.prompt` 等消息 | owner 确认后 |
| HTTP fallback runtime surface | `in-scope` | 这是业主已明确追加的运行时要求 | 默认不重评 |
| `SessionWebSocketHelper` 自动健康托管 | `out-of-scope` | 当前 helper 明确是 caller-managed health | 默认不重评 |
| 真实 archive / transcript / registry 最终 placement | `out-of-scope` | 由 storage-topology 与 evidence 反推，不在本包先写死 | storage-topology 收口时 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | package / wrangler 骨架 | `add` | `package.json`、`tsconfig.json`、`wrangler.jsonc`、`README.md`、`CHANGELOG.md` | 建出 deploy-oriented runtime package | medium |
| P1-02 | Phase 1 | composition contract | `add` | `src/env.ts`、`src/composition.ts` | 冻结 runtime assembly seam | high |
| P1-03 | Phase 1 | ingress contract note | `add` | `src/turn-ingress.ts` | 明确最小 turn 入口与 future seam | high |
| P2-01 | Phase 2 | Worker routes | `add` | `src/worker.ts`、`src/routes.ts` | 统一 WS/HTTP 路由入口 | medium |
| P2-02 | Phase 2 | WebSocket controller | `add` | `src/ws-controller.ts` | 统一升级、attach、message dispatch | high |
| P2-03 | Phase 2 | HTTP fallback controller | `add` | `src/http-controller.ts` | 提供 degraded-network 下的输入/读取入口 | high |
| P3-01 | Phase 3 | actor state model | `add` | `src/actor-state.ts` | 冻结 Session DO 内部状态槽位 | high |
| P3-02 | Phase 3 | health gates | `add` | `src/health.ts` | caller-managed ack/heartbeat 检查稳定化 | high |
| P3-03 | Phase 3 | DO class lifecycle | `add` | `src/do/nano-session-do.ts` | attach/resume/detach/close 生命周期收口 | high |
| P4-01 | Phase 4 | kernel orchestration | `add` | `src/orchestration.ts` | Session DO 可逐步驱动 kernel | high |
| P4-02 | Phase 4 | delegate wiring | `add` | `src/composition.ts`、`src/traces.ts` | llm/hooks/capability/workspace/eval 接线 | high |
| P4-03 | Phase 4 | stream / result dispatch | `add` | `src/ws-controller.ts`、`src/http-controller.ts` | WS/HTTP 复用同一 output body | medium |
| P5-01 | Phase 5 | checkpoint / restore seam | `add` | `src/checkpoint.ts` | kernel/websocket/workspace 片段被统一保存 | high |
| P5-02 | Phase 5 | alarm / shutdown | `add` | `src/alarm.ts`、`src/shutdown.ts` | heartbeat/ack health 与 graceful shutdown 成立 | medium |
| P5-03 | Phase 5 | trace / archive hooks | `add` | `src/traces.ts` | observability 与 archive flush seam 收口 | medium |
| P6-01 | Phase 6 | integration tests | `add` | `test/integration/*.test.ts` | 跑通跨包组装下的 start-turn-resume 与 ws/http fallback | high |
| P6-02 | Phase 6 | docs / exports | `update` | `README.md`、`src/index.ts` | 说明 deploy/runtime 边界与接入方式 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 包骨架与 Session Composition Contract

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | package / wrangler 骨架 | 建立 deploy-oriented runtime package，并补齐 Worker/DO 所需基础配置与最小 DO binding 示例 | `package.json`、`tsconfig.json`、`wrangler.jsonc`、`README.md`、`CHANGELOG.md` | 能作为独立 runtime repo 演进 | 基础命令校验 | 包与部署骨架约定稳定 |
| P1-02 | composition contract | 定义 runtime env、binding 入口、subsystem handles、composition factory | `src/env.ts`、`src/composition.ts` | 所有子系统接线有统一 seam | 类型测试 / compile-only | 不再在 DO class 里散落 new / import 逻辑 |
| P1-03 | ingress contract note | 明确 `session.start.initial_input` 的最小 e2e 作用，以及 follow-up turn 的 future seam | `src/turn-ingress.ts` | runtime 不再假装后续 prompt wire truth 已冻结 | 单测 + 文档断言 | ingress 假设被写明且可 review |

### 4.2 Phase 2 — Ingress Profiles / Worker Routing / Turn Intake

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Worker routes | 定义 WS upgrade、HTTP fallback、internal DO fetch routing | `src/worker.ts`、`src/routes.ts` | Worker 只做 routing，不卷入业务 | route 单测 | WS/HTTP 入口职责清楚 |
| P2-02 | WebSocket controller | 统一 upgrade、attach、`normalizeClientFrame()`、message dispatch | `src/ws-controller.ts` | WS path 与 session profile reality 对齐 | controller 单测 | 不绕开 `nacp-session` ingress |
| P2-03 | HTTP fallback controller | 提供最小输入、状态/结果读取、cancel/end 等 HTTPS fallback 接口，并定义 stateless session identification 规则 | `src/http-controller.ts` | degraded-network 下仍可与 session 交互 | integration smoke | HTTP path 复用同一 session model |

### 4.3 Phase 3 — Session Actor Lifecycle / WebSocket Attach / Health Gates

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | actor state model | 定义 phase、running turn、pending input、attachment state、checkpoint meta | `src/actor-state.ts` | Session DO 内部状态稳定 | 类型测试 / state 单测 | single-active-turn 边界明确 |
| P3-02 | health gates | 统一 `checkHeartbeatHealth()` / `checkAckHealth()` 与 attach state 判断 | `src/health.ts` | caller-managed health 成为显式 runtime 责任 | health 单测 | 不再依赖“helper 自动托管”的错误心智 |
| P3-03 | DO class lifecycle | 实现 `fetch` / `webSocketMessage` / `webSocketClose` / `alarm` 的编排骨架 | `src/do/nano-session-do.ts` | Session actor lifecycle 成立 | lifecycle 单测 | attach/resume/detach/close 路径清晰 |

### 4.4 Phase 4 — Kernel Orchestration / Delegate Wiring / Event Dispatch

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | kernel orchestration | 以 step-driven 方式驱动 kernel，并在每一步之间处理 dispatch/checkpoint signal | `src/orchestration.ts` | Session DO 真正成为 kernel 宿主 | orchestration 单测 | 不退回黑盒 `runTurn()` 心智 |
| P4-02 | delegate wiring | 组装 llm/hooks/capability/workspace/eval delegates 与 service bindings | `src/composition.ts`、`src/traces.ts` | 下游包通过 contract 被接入，不被重写 | fixture test | glue 层职责稳定 |
| P4-03 | stream / result dispatch | WS `session.stream.event` 与 HTTP fallback body 复用同一 normalized output | `src/ws-controller.ts`、`src/http-controller.ts` | 双入口结果模型一致 | integration test | 不出现两套结果 shape |

### 4.5 Phase 5 — Checkpoint / Restore / Alarm / Graceful Shutdown

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | checkpoint / restore seam | 拼接 kernel fragment、`SessionWebSocketHelper`、workspace snapshot、usage/trace state | `src/checkpoint.ts` | 会话级 checkpoint shape 成立 | checkpoint 单测 | restore 后可继续运行 |
| P5-02 | alarm / shutdown | 实现 heartbeat/ack 检查、flush/archive trigger seam、graceful shutdown，并只负责提交 evidence/触发请求 | `src/alarm.ts`、`src/shutdown.ts` | timeout / end / fatal error 路径被收口 | integration test | 结束路径不丢状态 |
| P5-03 | trace / archive hooks | 接 eval-observability trace sink 与 future archive flush seam | `src/traces.ts` | runtime 对 observability/storage 有稳定接缝 | fixture test | 不提前绑死 archive 物理策略 |

### 4.6 Phase 6 — Integration Fixtures / 文档 / 收口

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P6-01 | integration tests | 跑通 start-turn-resume、ws/http fallback、ack/heartbeat timeout、graceful shutdown，以及 kernel/llm-wrapper/capability/workspace 的最小跨包组装链路 | `test/integration/*.test.ts` | session skeleton 可回归 | 集成测试 | 核心 actor 路径全部成立 |
| P6-02 | docs / exports | 完成 runtime README、exports、deploy/use 边界说明 | `README.md`、`src/index.ts` | 下游知道如何组装与部署 | 文档校验 | 支持/不支持边界清楚 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 包骨架与 Session Composition Contract

- **Phase 目标**：建立 `session-do-runtime` 作为 runtime assembly package 的最小真相。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - `packages/session-do-runtime/src/env.ts`
  - `packages/session-do-runtime/src/composition.ts`
  - `packages/session-do-runtime/src/turn-ingress.ts`
- **本 Phase 修改文件**：
  - `packages/session-do-runtime/package.json`
  - `packages/session-do-runtime/wrangler.jsonc`
- **具体功能预期**：
  1. runtime assembly seam 与 deploy-oriented package 结构被明确。
  2. Session DO 内只保留编排逻辑，不直接吞入下游包的实现细节。
  3. `session.start.initial_input` 作为最小入口被记录清楚，future prompt family 作为开放 seam 明确列出。
  4. `wrangler.jsonc` 至少给出最小 DO binding / class export skeleton（如 `NanoSessionDO` 的 durable object binding 与迁移占位），避免 deploy-oriented package 只停留在口头层面。
- **具体测试安排**：
  - **单测**：composition/env/ingress type tests
  - **集成测试**：无
  - **回归测试**：runtime env shape 快照
  - **手动验证**：对照 `nacp-session` 7 个消息 reality
- **收口标准**：
  - 包骨架与 wrangler skeleton 明确
  - composition contract 可供后续 phases 复用
  - ingress 未冻结项被明文写出而非隐式假定
  - DO binding / export skeleton 至少有一份可审阅的最小配置示例
- **本 Phase 风险提醒**：
  - 若此处偷渡新 Session message family，会重新污染 `nacp-session` 边界

### 5.2 Phase 2 — Ingress Profiles / Worker Routing / Turn Intake

- **Phase 目标**：统一 WS/HTTP 双入口。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `packages/session-do-runtime/src/worker.ts`
  - `packages/session-do-runtime/src/routes.ts`
  - `packages/session-do-runtime/src/ws-controller.ts`
  - `packages/session-do-runtime/src/http-controller.ts`
- **具体功能预期**：
  1. Worker fetch 只做 routing，不做 turn logic。
  2. WebSocket path 严格消费 `normalizeClientFrame()` 与 Session-owned phase/role gate。
  3. HTTP fallback path 可承接 degraded-network 下的输入、读取、cancel/end 等最小操作；每个 HTTP 请求都必须通过显式 session identification（path parameter / request header / authority context）定位到正确 DO，而不是假设存在 WebSocket 式 attach state。
  4. HTTP fallback 只承担最小写入口与 durable 结果/状态读取；实时 event push 仍坚持 WebSocket-first。
  5. WS/HTTP 共享同一 session model 与 output body，而不是两套 runtime。
- **具体测试安排**：
  - **单测**：routes、ws/http controller
  - **集成测试**：ws/http fallback smoke
  - **回归测试**：非法 WS frame / forged authority / bad HTTP route / 缺失或错误 session identifier
  - **手动验证**：对照 `packages/nacp-session/src/ingress.ts`
- **收口标准**：
  - WS 与 HTTP 双入口职责稳定
  - 不绕开 `nacp-session` reality
  - HTTP fallback 不复制一套新对象模型
  - stateless HTTP 请求的 session 定位规则被显式写清
- **本 Phase 风险提醒**：
  - 若 HTTP fallback 直接返回另一套 body，会破坏前面所有 action-plan 的一致性
  - 若 HTTP session identification 语义含糊，degraded-network 路径会先于功能实现失真

### 5.3 Phase 3 — Session Actor Lifecycle / WebSocket Attach / Health Gates

- **Phase 目标**：让 Session DO 成为真正的会话 actor。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - `packages/session-do-runtime/src/actor-state.ts`
  - `packages/session-do-runtime/src/health.ts`
  - `packages/session-do-runtime/src/do/nano-session-do.ts`
- **具体功能预期**：
  1. actor state 明确区分 phase、active turn、pending input、attachment 与 checkpoint meta。
  2. `SessionWebSocketHelper` 只提供 helper 能力；ack/heartbeat 健康检查由 Session DO 显式承担。
  3. DO class 生命周期路径与 attach/resume/detach/close 明确成文。
- **具体测试安排**：
  - **单测**：actor state、health gates、DO lifecycle skeleton
  - **集成测试**：attach/resume/detach
  - **回归测试**：single-active-turn / stale ack / heartbeat timeout
  - **手动验证**：对照 `packages/nacp-session/src/websocket.ts`
- **收口标准**：
  - caller-managed health 被稳定接管
  - attach/resume/detach/close 不再靠隐式约定
  - single-active-turn invariant 成立
- **本 Phase 风险提醒**：
  - 若 actor state 漂移，checkpoint 与 orchestration 会同步失稳

### 5.4 Phase 4 — Kernel Orchestration / Delegate Wiring / Event Dispatch

- **Phase 目标**：让 Session DO 逐步驱动 kernel 并接入下游包。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - `packages/session-do-runtime/src/orchestration.ts`
  - `packages/session-do-runtime/src/traces.ts`
- **本 Phase 修改文件**：
  - `packages/session-do-runtime/src/composition.ts`
  - `packages/session-do-runtime/src/ws-controller.ts`
  - `packages/session-do-runtime/src/http-controller.ts`
- **具体功能预期**：
  1. Session DO 以 step-driven 方式驱动 kernel，而不是黑盒调用。
  2. llm/hooks/capability/workspace/eval 通过 delegates 被接入，不被本包重新定义。
  3. `session.stream.event` 与 HTTP fallback 读取复用同一 normalized outputs。
- **具体测试安排**：
  - **单测**：orchestration、delegate wiring
  - **集成测试**：fake llm + fake capability + fake hook + fake workspace
  - **回归测试**：llm/tool/hook/compact event dispatch 与 output body 对齐
  - **手动验证**：对照前 6 份 action-plan 的 dependency seams
- **收口标准**：
  - Session DO 真正成为 orchestration host
  - glue 层职责清晰，没有反向吞并子系统
  - WS/HTTP 双路径 output 结构一致
- **本 Phase 风险提醒**：
  - glue 层若过厚，说明包边界设计有问题

### 5.5 Phase 5 — Checkpoint / Restore / Alarm / Graceful Shutdown

- **Phase 目标**：让会话状态真正可恢复、可结束、可自我检查。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
  - `P5-03`
- **本 Phase 新增文件**：
  - `packages/session-do-runtime/src/checkpoint.ts`
  - `packages/session-do-runtime/src/alarm.ts`
  - `packages/session-do-runtime/src/shutdown.ts`
- **本 Phase 修改文件**：
  - `packages/session-do-runtime/src/traces.ts`
- **具体功能预期**：
  1. checkpoint seam 组合 kernel fragment、websocket replay/seqs、workspace snapshot、usage/traces。
  2. alarm 负责 heartbeat/ack 健康与 future archive flush seam；它只触发 flush/archive request 并提交 evidence，不在本包里写死最终 archive 物理编排。
  3. `session.end` / timeout / fatal error 均走统一 graceful shutdown。
- **具体测试安排**：
  - **单测**：checkpoint、alarm、shutdown
  - **集成测试**：checkpoint → restore → resume、timeout → close、end → checkpoint
  - **回归测试**：restore 后 seq counters / replay / pending turn state 一致性
  - **手动验证**：对照 `SessionWebSocketHelper.checkpoint()/restore()`
- **收口标准**：
  - restore 后 session 可继续工作
  - alarm / shutdown 不丢状态
  - archive/flush seam 没有被提前写死成最终 storage strategy
  - flush 触发责任与 archive 物理策略边界能被 review 直接看懂
- **本 Phase 风险提醒**：
  - 若 checkpoint 过宽，会把 storage-topology 直接写死；过窄则无法恢复

### 5.6 Phase 6 — Integration Fixtures / 文档 / 收口

- **Phase 目标**：证明会话 actor skeleton 与最小跨包组装链路成立。
- **本 Phase 对应编号**：
  - `P6-01`
  - `P6-02`
- **本 Phase 新增文件**：
  - `packages/session-do-runtime/test/integration/start-turn-resume.test.ts`
  - `packages/session-do-runtime/test/integration/ws-http-fallback.test.ts`
  - `packages/session-do-runtime/test/integration/heartbeat-ack-timeout.test.ts`
- **本 Phase 修改文件**：
  - `packages/session-do-runtime/README.md`
  - `packages/session-do-runtime/src/index.ts`
- **具体功能预期**：
  1. start → turn → checkpoint → resume 路径能稳定回归。
  2. WS-first 与 HTTP fallback 双路径能共用同一 session model。
  3. 至少存在一条最小跨包集成链路：`session-do-runtime -> agent-runtime-kernel -> llm-wrapper/capability-runtime/workspace-context-artifacts`。
  4. README 明确说明该包是 runtime assembly layer，不是子系统实现全集。
- **具体测试安排**：
  - **单测**：补齐未覆盖模块
  - **集成测试**：start-turn-resume、ws/http fallback、heartbeat/ack timeout、graceful shutdown、最小跨包 compose flow
  - **回归测试**：phase / output / checkpoint shape 快照
  - **手动验证**：模拟网络降级与 resume
- **收口标准**：
  - session skeleton 可独立 build/typecheck/test
  - 双入口与恢复语义成立
  - 至少一条跨包 compose flow 可回归，不再只停留在单包自证
  - 文档解释清楚支持/不支持边界
- **本 Phase 风险提醒**：
  - 若只测 happy path，会掩盖 health 与 resume 的真实复杂度

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 1 / Phase 2 / Phase 4`
- **为什么必须确认**：当前 `nacp-session` 只冻结了 `session.start.body.initial_input` 的最小入口建议，但 attach 后的 follow-up turn input family 仍未成为正式 wire truth。
- **当前建议 / 倾向**：`v1 先以 session.start.initial_input 打通首个 e2e turn；后续用户输入 family 单独在 Session profile 做小版本扩展，不在本包里偷渡`
- **Q**：`v1 是否同意把首个 turn 固定在 session.start.initial_input，上层 follow-up prompt family 另行补到 Session profile，而不是在 session-do-runtime 内自造消息？`
- **A**：通过阅读 `docs/investigation/action-plan-qna-clarification-batch-1.md` 后，业主表示同意采取推荐措施：`v1 先以 session.start.initial_input 作为首个 turn 的正式入口；follow-up input family 后续单独补到 Session profile，不在 session-do-runtime 内自造消息。`

#### Q2

- **影响范围**：`Phase 2 / Phase 6`
- **为什么必须确认**：HTTP fallback 需要明确是“只负责读取 durable 产物”，还是也要承担提交新输入 / cancel / end 的写入口，这会直接影响 controller 设计。
- **当前建议 / 倾向**：`HTTP fallback 同时支持最小写入口（start/input/cancel/end）与 durable 读取，但实时 event push 仍坚持 WebSocket-first`
- **Q**：`v1 的 HTTP fallback 是否接受“写入口最小可用 + 读取 durable 结果/状态 + 实时流仍由 WebSocket 承担”的分层策略？`
- **A**：同意。

#### Q3

- **影响范围**：`Phase 5 / storage-topology / eval-observability`
- **为什么必须确认**：Session DO 在 turn end / session end / alarm 时是否需要触发 archive/flush seam，会决定 checkpoint 内容与 observability 联动责任。
- **当前建议 / 倾向**：`Session DO Runtime 只负责触发 flush/archive seam 与提交 evidence，不在本包里写死最终 R2 archive 策略`
- **Q**：`v1 是否同意让 session-do-runtime 只承担 archive/flush 触发责任，而把最终 archive 物理策略留给 storage-topology + observability 证据收敛？`
- **A**：同意。

### 6.2 问题整理建议

- 优先冻结 turn ingress contract 与 HTTP fallback 责任边界
- 不要把 provider/tool/compact 的内部实现细节混到 runtime assembly 决策里
- 所有 owner 决策要同步回填到 `nacp-session`、`session-do-runtime`、`storage-topology`、`eval-observability`

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| Session legality 被错误拖回 Core | 会重蹈 `session.stream.event/ack/heartbeat` phase 旧坑 | high | 所有 WS legality 只走 `nacp-session` helper；Core 仅处理 internal envelope admissibility |
| turn ingress contract 未完全冻结 | follow-up user prompt wire truth 尚未定案 | high | 最小 e2e 先用 `session.start.initial_input`，同时保留显式 Q/A 与 future seam |
| WS/HTTP 双入口分叉成两套模型 | degraded network 场景下最容易发生 | high | 统一 controller contract 与 shared output body |
| caller-managed health 被忽略 | `SessionWebSocketHelper` 不会自动托管 heartbeat/ack | high | alarm / lifecycle 中显式调用 `checkHeartbeatHealth()` / `checkAckHealth()` |
| glue 代码过厚 | 说明 assembly layer 吞并了下游子系统 | medium | composition contract 前置冻结，delegate interfaces 复用既有包 |

### 7.2 约束与前提

- **技术前提**：Cloudflare Workers / Durable Objects / TypeScript / 单线程 V8 isolate / `nacp-session` 负责 WS profile reality
- **运行时前提**：single-active-turn、WebSocket-first + HTTP fallback、caller-managed ack/heartbeat health、Session DO 是 runtime assembly host 而不是子系统实现全集
- **组织协作前提**：`packages/*` 现由主仓 monorepo 统一跟踪；`@nano-agent/session-do-runtime` 是首个 deploy-oriented assembly package，但仍与 kernel/llm/capability/workspace/hooks/eval 分包协作
- **上线 / 合并前提**：不得让 `nacp-core` 重新承担 Session WebSocket legality；不得在本包里偷偷发明新的 Session wire truth；不得写死最终 archive/storage 策略

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/session-do-runtime-by-opus.md`
  - `docs/design/storage-topology-by-opus.md`
  - `docs/design/eval-observability-by-opus.md`
- 需要同步更新的说明文档 / README：
  - `README.md`
  - `packages/session-do-runtime/README.md`
- 需要同步更新的测试说明：
  - `packages/session-do-runtime/test/README.md`（如创建）

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `packages/session-do-runtime` 可独立 `build/typecheck/test`
  - `wrangler.jsonc` / entry exports / DO export skeleton 完整
- **单元测试**：
  - composition、routes、ws/http controllers、health、checkpoint、shutdown
- **集成测试**：
  - start-turn-resume
  - ws/http fallback
  - heartbeat/ack timeout
  - graceful shutdown
- **端到端 / 手动验证**：
  - 模拟 WS start → turn → detach → resume
  - 模拟 HTTP fallback 提交/读取
  - 模拟 fatal error → checkpoint → close
- **回归测试**：
  - phase / health / checkpoint shape 快照
  - shared output body 快照
- **文档校验**：
  - README、action-plan、design 文稿中的 runtime responsibility 保持一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `@nano-agent/session-do-runtime` 已形成独立 deploy-oriented runtime package 骨架
2. WS legality、HTTP fallback、single-active-turn、caller-managed health 四条运行时边界已被正确实现
3. Session DO 已能逐步驱动 kernel 并接入 llm/hooks/capability/workspace/eval delegates
4. checkpoint / restore / shutdown / alarm 语义已能稳定回归
5. runtime assembly 层没有反向吞并下游子系统真相

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | session-do-runtime 已具备 Worker/DO 组装、WS/HTTP 双入口、kernel orchestration、checkpoint/restore、health/shutdown |
| 测试 | attach/resume/fallback/timeout/shutdown 等关键 actor 场景均可稳定回归 |
| 文档 | action-plan、README、deploy/use 边界说明与相关设计文稿同步完成 |
| 风险收敛 | Session legality 与 Core admissibility 不再混淆，HTTP fallback 不再成为临时补丁 |
| 可交付性 | 包可作为 Worker / Session DO runtime assembly layer 继续推进实现与部署 |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

> 这份 action-plan 以 **建立 nano-agent 的会话 actor 组装层** 为第一优先级，采用 **先 composition 与 ingress、再 actor lifecycle 与 kernel orchestration、最后 checkpoint/health 与全链路场景收口** 的推进方式，优先解决 **Worker / Session DO 如何真正承载 kernel、如何同时服务 WebSocket-first 与 HTTP fallback、如何把恢复与健康管理变成显式 runtime 责任**，并把 **不让 Core 重新承担 Session legality、不在本包偷渡新 protocol truth、不提前写死最终 archive/storage 策略** 作为主要约束。整个计划完成后，`Session DO Runtime` 应达到 **能够装配 kernel、hooks、llm、capability、workspace、observability 并跑通最小 durable session skeleton** 的程度，从而为后续的 deploy、storage 收敛与端到端产品验证提供稳定基础。
