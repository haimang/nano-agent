# A4. Nano-Agent Session Edge Closure 执行计划

> 服务业务簇: `Session Runtime / Edge`
> 计划对象: `after-skeleton / Phase 3 / session-edge-closure`
> 类型: `modify`
> 作者: `GPT-5.4`
> 时间: `2026-04-18`
> 执行序号: `A4 / 10`
> 上游前序: `A1`, `A3`
> 下游交接: `A5`, `A6`
> 文件位置: `packages/nacp-session/**`, `packages/session-do-runtime/**`, `docs/design/after-skeleton/P3-session-edge-closure.md`, `test/*.test.mjs`
> 关键仓库锚点: `packages/nacp-session/src/{ingress,session-registry,stream-event,websocket}.ts`, `packages/session-do-runtime/src/{do/nano-session-do,ws-controller,http-controller,turn-ingress}.ts`
> 参考 context / 对标来源: `context/claude-code/services/tools/toolExecution.ts`, `context/codex/codex-rs/tools/src/tool_registry_plan.rs`
> 关联设计 / 调研文档:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P0-contract-and-identifier-freeze.md`
> - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
> - `docs/design/after-skeleton/P3-session-edge-closure.md`
> - `docs/design/after-skeleton/PX-QNA.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

Phase 3 的任务不是重新发明 session 协议，而是把已经存在的 `@nano-agent/nacp-session` truth 真正装配成 **唯一 session edge 主路径**。当前 repo 的现实非常清楚：`packages/nacp-session/src/ingress.ts` 已经提供 `normalizeClientFrame()`，`session-registry.ts` 已经冻结 session-owned phase/role legality，`stream-event.ts` 已经冻结 9 个 `session.stream.event` kinds，`websocket.ts` 已经实现 replay/ack/heartbeat/checkpoint/restore helper；与此同时，`SessionOrchestrator` 也已经具备 `startTurn()` / `runStepLoop()` / `cancelTurn()` 的最小 orchestration 骨架。与之相对，`packages/session-do-runtime/src/do/nano-session-do.ts` 仍直接 `JSON.parse()` 后按 `message_type` 分支，`WsController` 和 `HttpController` 仍是 stub，`turn-ingress.ts` 还保留 `future-prompt-family` placeholder。

Q8 已经把 formal follow-up input family 提升为 **Phase 0 必须冻结的 `nacp-session` contract surface**。因此这份 action-plan 的目标不是在 runtime 里私造 follow-up wire，而是 **消费上游已冻结 truth**，并把 WS ingress、HTTP fallback、replay/resume、ack/heartbeat、single-active-turn、edge trace emission 一次性收口到同一条路径上。完成后，`session-do-runtime` 不应再保留平行的 raw parse/switch reality，前端和后续 Phase 也不应再依赖 README/注释去猜 session edge 的真实行为。

- **服务业务簇**：`Session Runtime / Edge`
- **计划对象**：`after-skeleton / Phase 3 / session-edge-closure`
- **本次计划解决的问题**：
  - `session-do-runtime` 仍未真正消费 `nacp-session` 的 normalized ingress / legality / websocket helper truth
  - `WsController` / `HttpController` 仍是 stub，WS 与 HTTP fallback 还不是同一 session model 的两种 transport
  - follow-up input family 已进入 P0 freeze 范围，但 runtime 还停留在 `session.start.initial_input` 单一路径 + placeholder note 的现实
- **本次计划的直接产出**：
  - 一条真正经过 `normalizeClientFrame()` 与 `nacp-session` legality gate 的 session edge 主路径
  - 一套闭合的 WS attach/replay/ack/heartbeat/checkpoint/restore + HTTP fallback 行为
  - 一份覆盖 ingress、controller、single-active-turn、trace/health、tests/docs 的 Phase 3 收口包

---

## 1. 执行综述

### 1.1 总体执行方式

这份 action-plan 采用 **先同步 upstream session truth，再替换 raw ingress，再装配 WS helper，然后闭合 HTTP fallback 与 single-active-turn，最后补 edge trace / health / evidence pack** 的推进方式。核心原则是：**`nacp-session` 负责 legality，`session-do-runtime` 负责 assembly；WS 和 HTTP fallback 共享一套 session model；formal follow-up family 只消费 upstream frozen truth，绝不由 runtime 私造。**

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Upstream Truth Sync & Ingress Convergence | `M` | 消费 P0 widened session truth，替换 raw parse/switch，建立统一 normalized ingress 入口 | `Phase 0 / Phase 2` |
| Phase 2 | WebSocket Helper Assembly | `M` | 真正把 `SessionWebSocketHelper`、WS controller、DO lifecycle 装配进主路径 | `Phase 1` |
| Phase 3 | HTTP Fallback & Single-active-turn Closure | `M` | 让 HTTP fallback 与 WS 共用同一 actor/session model，并接通 widened ingress surface | `Phase 2` |
| Phase 4 | Edge Trace, Health & Recovery Closure | `M` | attach/resume/replay/health/checkpoint 进入 trace-first 与 caller-managed health reality | `Phase 3` |
| Phase 5 | Evidence, Docs & Exit Pack | `S` | 用 package/integration/cross tests 与 docs sync 把 P3 正式封箱 | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — Upstream Truth Sync & Ingress Convergence**
   - **核心目标**：把 P0 widened session contract 与 P2 trace carrier 变成 Phase 3 的明确输入，并让 raw ingress 停止直接进 DO 业务逻辑。
   - **为什么先做**：如果 upstream truth 还没被消费，后面的 WS/HTTP controller 只会继续围绕 placeholder 和 stub 建第二套 reality。
2. **Phase 2 — WebSocket Helper Assembly**
   - **核心目标**：让 `SessionWebSocketHelper` 成为 replay/ack/heartbeat/checkpoint 的真实执行面。
   - **为什么放在这里**：WS 仍是 nano-agent 的主交互面，HTTP fallback 必须建立在稳定的 WS/session model 之上。
3. **Phase 3 — HTTP Fallback & Single-active-turn Closure**
   - **核心目标**：把 fallback 从 stub 提升为与 WS 共享 actor state / session truth 的 transport 替代，并把 widened ingress 真正喂给 turn host。
   - **为什么放在这里**：如果 WS 主路径未收口，HTTP fallback 只会复制另一套偏差。
4. **Phase 4 — Edge Trace, Health & Recovery Closure**
   - **核心目标**：让 attach/resume/replay/heartbeat/ack/alarm/checkpoint 进入 trace-first 和 caller-managed health reality。
   - **为什么放在这里**：trace/health 应建立在已经装配好的 edge 行为上，而不是反过来驱动 stub。
5. **Phase 5 — Evidence, Docs & Exit Pack**
   - **核心目标**：让 Phase 3 结束后，后续 API / SDK / P4 external seams 可以直接依赖 session edge baseline。
   - **为什么放在这里**：Phase 3 是 runtime closure 第一物理边界，必须单独有 evidence/exit pack。

### 1.4 执行策略说明

- **执行顺序原则**：`先消费 nacp-session truth，再替换 raw ingress；先闭合 WS 主路径，再闭合 HTTP fallback；先 single-active-turn baseline，再谈 richer queue semantics`
- **风险控制原则**：`runtime 不得发明 private follow-up wire；HTTP fallback 不能变成另一套协议宇宙；trace/health 只在 P2 carrier 可用后接线`
- **测试推进原则**：`先修 session-do-runtime 单测与 integration，再跑 nacp-session integration 与 root cross test`
- **文档同步原则**：`P3 design、P0/P2 上游 memo、nacp-session package docs、session-do-runtime contract tests 必须保持一致口径`

### 1.5 本次 action-plan 影响目录树

```text
session-edge-closure
├── packages/nacp-session
│   ├── src/{ingress,frame,session-registry,stream-event,websocket,messages}.ts
│   └── test/{ingress,frame,websocket,session-registry}/**/*.ts
├── packages/session-do-runtime
│   ├── src/{routes,worker,ws-controller,http-controller,turn-ingress,health,alarm,orchestration}.ts
│   ├── src/do/nano-session-do.ts
│   └── test/{routes,ws-controller,http-controller,turn-ingress,health,do/nano-session-do}.test.ts
│       test/integration/{ws-http-fallback,start-turn-resume,heartbeat-ack-timeout,checkpoint-roundtrip,graceful-shutdown,stream-event-schema}.test.ts
├── docs
│   ├── action-plan/after-skeleton/A4-session-edge-closure.md
│   └── design/after-skeleton/P3-session-edge-closure.md
└── root
    └── package.json / test:cross
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 把 `routeRequest()` → `normalizeClientFrame()` → session role/phase gate → dispatch 收敛为唯一 normalized ingress 主路径
- **[S2]** 真正装配 `SessionWebSocketHelper`，闭合 attach/replay/ack/heartbeat/checkpoint/restore
- **[S3]** 让 `HttpController` 成为 WS-first session model 的 transport fallback，而不是另一套业务协议
- **[S4]** 在 widened session ingress surface 上维持 single-active-turn invariant，并消费 upstream frozen follow-up family
- **[S5]** 让 edge-side attach/resume/replay/health/checkpoint 进入 trace-first observability reality

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** follow-up queue / replace / merge / approval-aware scheduling 的完整产品语义
- **[O2]** multi-client attach / observer mode / cross-DO federation
- **[O3]** public SDK / frontend-facing product API object model
- **[O4]** external seam/service-binding worker closure（属于下一份 P4 action-plan）

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `session.start.body.initial_input` | `in-scope` | 当前唯一已接线的 turn ingress reality，必须保留并纳入新主路径 | P3 完成后仅在 richer API design 时重评 |
| formal follow-up / multi-round input family | `in-scope` | Q8 已要求其先进入 P0 `nacp-session` contract freeze，P3 只消费这条 truth | 在 P0 Q1 形状冻结后进入 Phase 1 coding |
| runtime-private follow-up wire | `out-of-scope` | 与 owner 决策和 P3 design 冲突，禁止在 `session-do-runtime` 私造 | 永不作为合法路线重评 |
| HTTP fallback status/timeline/cancel/end | `in-scope` | 这是 session edge 的 transport fallback，不是未来 API 才有 | P3 完成后在 public API 设计时可包装 |
| multi-client attach / observer replay | `out-of-scope` | 会显著扩大 replay/ack/state 模型 | 下一阶段独立设计再重评 |
| edge-side trace emission | `depends-on-phase` | Phase 3 必须接，但依赖 P2 canonical trace carrier 已落地 | P2 closure 后立即接线 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Upstream Frozen Truth Sync | `update` | `packages/nacp-session/src/{messages,session-registry,ingress}.ts`, `packages/session-do-runtime/src/turn-ingress.ts` | 用 P0 widened truth 替换 `future-prompt-family` placeholder | `high` |
| P1-02 | Phase 1 | Normalized Ingress Pipeline | `update` | `packages/session-do-runtime/src/{routes,worker,do/nano-session-do}.ts`, `packages/nacp-session/src/ingress.ts` | 让 raw WS/HTTP 输入统一经 `normalizeClientFrame()` 与 legality gate | `high` |
| P1-03 | Phase 1 | Session Role/Phase Enforcement Handoff | `update` | `packages/nacp-session/src/session-registry.ts`, `packages/session-do-runtime/src/do/nano-session-do.ts` | 停止在 DO 内部维持平行 legality reality | `medium` |
| P2-01 | Phase 2 | WsController Real Assembly | `update` | `packages/session-do-runtime/src/ws-controller.ts`, tests | 把 upgrade/message/close 从 stub 升级为真实 edge façade | `high` |
| P2-02 | Phase 2 | SessionWebSocketHelper Wiring | `update` | `packages/session-do-runtime/src/do/nano-session-do.ts`, `packages/nacp-session/src/websocket.ts` | attach/replay/ack/heartbeat/checkpoint/restore 全部走 helper | `high` |
| P2-03 | Phase 2 | Replay / Resume / Checkpoint Convergence | `update` | `packages/session-do-runtime/src/{do/nano-session-do,checkpoint}.ts`, integration tests | reconnect/resume 不再绕开真实 replay + checkpoint contract | `high` |
| P3-01 | Phase 3 | HttpController Real Actions | `update` | `packages/session-do-runtime/src/http-controller.ts`, tests | `start/input/cancel/end/status/timeline` 共享同一 actor state 与 output truth | `high` |
| P3-02 | Phase 3 | Single-active-turn Edge Model | `update` | `packages/session-do-runtime/src/{turn-ingress,orchestration,http-controller}.ts` | widened ingress 进入 runtime 后仍维持单活跃执行基线 | `high` |
| P3-03 | Phase 3 | Shared Actor / Timeline Surface | `update` | `packages/session-do-runtime/src/{http-controller,routes,worker}.ts`, integration tests | WS 与 HTTP fallback 不再漂移成两套 session model | `medium` |
| P4-01 | Phase 4 | Edge Trace Wiring | `update` | `packages/session-do-runtime/src/{do/nano-session-do,alarm,health}.ts`, `packages/eval-observability/**` | attach/resume/replay/ack/heartbeat/checkpoint 都有 trace evidence | `medium` |
| P4-02 | Phase 4 | Health / Alarm / Recovery Closure | `update` | `packages/session-do-runtime/src/{alarm,health,checkpoint}.ts`, integration tests | caller-managed health 与 edge lifecycle 收口 | `medium` |
| P4-03 | Phase 4 | Stream Schema / Cross-package Guard | `update` | `packages/nacp-session/src/stream-event.ts`, `test/observability-protocol-contract.test.mjs` | edge 输出与 observability/session stream reality 持续对拍 | `medium` |
| P5-01 | Phase 5 | Package & Integration Test Gate | `update` | `packages/nacp-session/**`, `packages/session-do-runtime/**`, root tests | 用现有 tests + integration 证明 session edge 已成主路径 | `medium` |
| P5-02 | Phase 5 | Docs / Schema / Exit Pack | `update` | P3 docs, session package docs/schema | 后续 API/P4 可直接依赖的 session edge baseline 出口包 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Upstream Truth Sync & Ingress Convergence

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Upstream Frozen Truth Sync | 把 `turn-ingress.ts` 的 placeholder note 改为消费 P0 widened session truth；同步 `nacp-session` follow-up family 与 identifier law 的最新 reality | `packages/nacp-session/src/{messages,session-registry,ingress}.ts`, `packages/session-do-runtime/src/turn-ingress.ts` | Phase 3 不再建立在“follow-up family 未来再说”的前提上 | `pnpm --filter @nano-agent/nacp-session test` | `future-prompt-family` 不再是永久 placeholder，P3 有明确的 upstream contract 输入 |
| P1-02 | Normalized Ingress Pipeline | 用 `normalizeClientFrame()` 替换 DO 内 raw parse/switch 入口，统一 WS/HTTP ingress 的 authority stamping + validation + legality gate | `packages/session-do-runtime/src/{routes,worker,do/nano-session-do}.ts`, `packages/nacp-session/src/ingress.ts` | raw ingress 不再直接碰业务逻辑 | `pnpm --filter @nano-agent/session-do-runtime test` | 不再存在绕开 `nacp-session` 的 ingress 主路径 |
| P1-03 | Session Role/Phase Enforcement Handoff | 明确 `nacp-session` phase/role matrix 是唯一真相，并让 runtime 只消费结果 | `packages/nacp-session/src/session-registry.ts`, `packages/session-do-runtime/src/do/nano-session-do.ts` | DO 内部不再复制平行 legality 判断 | package tests | `NanoSessionDO` 不再靠手写 `message_type` switch 维持 legality |

### 4.2 Phase 2 — WebSocket Helper Assembly

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | WsController Real Assembly | 让 `WsController` 从 101/400 stub 变成真正对接 DO/session helper 的 façade | `packages/session-do-runtime/src/ws-controller.ts`, `test/ws-controller.test.ts` | upgrade/message/close 路径不再是 no-op | `pnpm --filter @nano-agent/session-do-runtime test` | `WsController` 能表达 upgrade acceptance、dispatch 和 detach |
| P2-02 | SessionWebSocketHelper Wiring | 在 `NanoSessionDO` 中真实持有/装配 `SessionWebSocketHelper`，统一 attach/replay/ack/heartbeat/checkpoint/restore | `packages/session-do-runtime/src/do/nano-session-do.ts`, `packages/nacp-session/src/websocket.ts` | WS edge 真正进入 helper reality | package tests + `nacp-session` tests | replay/ack/heartbeat/checkpoint 行为不再散落在 DO 自己维护的字段里 |
| P2-03 | Replay / Resume / Checkpoint Convergence | 将 `session.resume`、`last_seen_seq`、checkpoint/restore 与 helper/replay buffer 统一 | `packages/session-do-runtime/src/{do/nano-session-do,checkpoint}.ts`, integration tests | reconnect/resume 与 checkpoint 读写同一套 contract | integration tests | reconnect + restore 共享单一 replay/checkpoint truth |

### 4.3 Phase 3 — HTTP Fallback & Single-active-turn Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | HttpController Real Actions | 将 `start/input/cancel/end/status/timeline` 从静态 `{ ok: true }` stub 升级为真实 actor/session operations | `packages/session-do-runtime/src/http-controller.ts`, `test/http-controller.test.ts` | HTTP fallback 成为 transport fallback，不再是假接口 | `pnpm --filter @nano-agent/session-do-runtime test` | status/timeline 来自真实 actor state / session evidence |
| P3-02 | Single-active-turn Edge Model | widened ingress 进入 runtime 后，继续以 single-active-turn 为执行基线；follow-up family 只走 upstream frozen truth | `packages/session-do-runtime/src/{turn-ingress,orchestration,http-controller}.ts` | P3 不会因 widened input surface 直接掉入 queue/replace 语义泥潭 | package tests | 首轮与 follow-up input 都服从同一单活跃执行 invariant |
| P3-03 | Shared Actor / Timeline Surface | 保证 WS 与 HTTP fallback 读到相同 actor phase、timeline、cancel/end semantics | `packages/session-do-runtime/src/{routes,worker,http-controller}.ts`, integration tests | WS/HTTP 不再各说一套 session reality | `packages/session-do-runtime/test/integration/ws-http-fallback.test.ts` | fallback 是 transport 替代，而不是新协议宇宙 |

### 4.4 Phase 4 — Edge Trace, Health & Recovery Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | Edge Trace Wiring | 为 attach/resume/replay/ack mismatch/heartbeat timeout/checkpoint/restore 补 trace emission | `packages/session-do-runtime/src/{do/nano-session-do,alarm,health}.ts`, `packages/eval-observability/**` | session edge 不再是 trace blind spot | package tests + root cross test | 关键 edge boundary 都有固定 trace evidence 出口 |
| P4-02 | Health / Alarm / Recovery Closure | 把 caller-managed health 与 alarm/checkpoint/replay 收敛成一套 edge lifecycle | `packages/session-do-runtime/src/{alarm,health,checkpoint}.ts`, integration tests | heartbeat/ack/backpressure 不再只停留在 helper API 级别 | `packages/session-do-runtime/test/integration/heartbeat-ack-timeout.test.ts` | unhealthy edge 会按既定 contract close / persist / recover |
| P4-03 | Stream Schema / Cross-package Guard | 保证 edge 推出的 stream bodies 持续与 `nacp-session` / observability reality 对齐 | `packages/nacp-session/src/stream-event.ts`, root tests | stream schema drift 能被尽早发现 | `npm run test:cross` | 不再出现 session edge 与 observer/timeline 对同一事件有两套理解 |

### 4.5 Phase 5 — Evidence, Docs & Exit Pack

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | Package & Integration Test Gate | 执行 `nacp-session`、`session-do-runtime`、root cross tests；补齐 replay/fallback/health 回归 | `packages/nacp-session/**`, `packages/session-do-runtime/**`, root tests | 用现有 test surface 证明 session edge 已成主路径 | package tests + integration + root tests | raw parse/switch 不再是主入口，reconnect/replay/fallback contract 稳定 |
| P5-02 | Docs / Schema / Exit Pack | 更新 P3 docs、session package schema/docs 产物、README/notes 中的边界描述 | `docs/design/after-skeleton/P3-session-edge-closure.md`, `packages/nacp-session/package.json` docs scripts | 为 P4/P5/Pnext 提供可引用 baseline | docs/schema build + review | 后续文档不再需要解释“真实 session edge 其实还没接线” |

---

## 5. Phase 详情

### 5.1 Phase 1 — Upstream Truth Sync & Ingress Convergence

- **Phase 目标**：在开始 controller/DO 重写前，先让 Phase 3 拥有明确的 upstream frozen truth 与统一 ingress 入口。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - 视需要新增 widened ingress / follow-up adapter tests
- **本 Phase 修改文件**：
  - `packages/nacp-session/src/{messages,session-registry,ingress}.ts`
  - `packages/session-do-runtime/src/{routes,worker,turn-ingress}.ts`
  - `packages/session-do-runtime/src/do/nano-session-do.ts`
- **具体功能预期**：
  1. `turn-ingress.ts` 不再把 follow-up family 当永久 future placeholder
  2. DO 入口不再直接把 raw JSON 当业务输入
  3. role/phase legality 的真相源固定在 `nacp-session`
  4. 继续复用既有 `SessionOrchestrator` 作为 single-active-turn coordination 骨架；A4 的主工作是 ingress/controller wiring，而不是重写 orchestration
- **具体测试安排**：
  - **单测**：`packages/nacp-session/test/{ingress,session-registry}.test.ts`, `packages/session-do-runtime/test/{routes,turn-ingress}.test.ts`
  - **集成测试**：`packages/nacp-session test:integration`
  - **回归测试**：`pnpm --filter @nano-agent/nacp-session typecheck && pnpm --filter @nano-agent/nacp-session test`; `pnpm --filter @nano-agent/session-do-runtime test`
  - **手动验证**：检查 session edge 不再声明“follow-up family not yet frozen”这类过时口径
- **收口标准**：
  - `normalizeClientFrame()` 成为 ingress 必经点
  - `turn-ingress.ts` 已能消费 upstream frozen widened family
  - runtime 内不再维持平行 legality truth
- **本 Phase 风险提醒**：
  - 若 P0 widened session family 尚未真正落到代码，这一 phase 只能部分完成
  - 若 raw ingress 替换不彻底，后续 WS/HTTP 装配会再次出现双主路径

### 5.2 Phase 2 — WebSocket Helper Assembly

- **Phase 目标**：让 WS 主路径停止依赖 stub/controller 幻觉，真正进入 helper-driven reality。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - 视需要新增 helper/DO assembly integration tests
- **本 Phase 修改文件**：
  - `packages/session-do-runtime/src/ws-controller.ts`
  - `packages/session-do-runtime/src/do/nano-session-do.ts`
  - `packages/nacp-session/src/websocket.ts`
  - `packages/session-do-runtime/test/{ws-controller,do/nano-session-do}.test.ts`
- **具体功能预期**：
  1. `WsController` 从空壳变成真实 edge façade
  2. `SessionWebSocketHelper` 负责 replay/ack/heartbeat/checkpoint/restore 的真实行为
  3. `session.resume` 与 `last_seen_seq` 共享一条 replay/checkpoint truth
- **具体测试安排**：
  - **单测**：`ws-controller.test.ts`, `do/nano-session-do.test.ts`, `packages/nacp-session/test/websocket.test.ts`
  - **集成测试**：`start-turn-resume.test.ts`, `checkpoint-roundtrip.test.ts`
  - **回归测试**：`pnpm --filter @nano-agent/session-do-runtime test`
  - **手动验证**：检查 DO 不再手工维护平行 replay/ack/heartbeat 主逻辑
- **收口标准**：
  - replay/resume/checkpoint 真正由 helper + DO lifecycle 承担
  - `session.resume` 不再是仅写 `last_seen_seq` 的半成品路径
  - WS path 已可被视为 session edge 主 truth
- **本 Phase 风险提醒**：
  - 如果 helper 只被部分装配，Phase 2 会残留“DO logic 一半，helper 一半”的新型漂移
  - 如果 replay/checkpoint 仍停在不同 contract 上，后续 reconnect/recovery 会继续失真

### 5.3 Phase 3 — HTTP Fallback & Single-active-turn Closure

- **Phase 目标**：让 HTTP fallback 成为同一 session model 的 transport 替代，并在 widened input surface 上维持单活跃执行基线。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - 视需要新增 fallback/timeline fixtures
- **本 Phase 修改文件**：
  - `packages/session-do-runtime/src/{http-controller,turn-ingress,orchestration,routes,worker}.ts`
  - `packages/session-do-runtime/test/{http-controller,routes}.test.ts`
  - `packages/session-do-runtime/test/integration/ws-http-fallback.test.ts`
- **具体功能预期**：
  1. `start/input/cancel/end/status/timeline` 反映真实 actor/session state
  2. widened follow-up ingress 进入 runtime 之后仍不打破 single-active-turn invariant
  3. WS 与 HTTP fallback 共享同一 timeline / status / cancel/end truth
- **具体测试安排**：
  - **单测**：`http-controller.test.ts`, `routes.test.ts`, `turn-ingress.test.ts`, `orchestration.test.ts`
  - **集成测试**：`ws-http-fallback.test.ts`, `start-turn-resume.test.ts`
  - **回归测试**：`pnpm --filter @nano-agent/session-do-runtime test`
  - **手动验证**：人工确认 HTTP fallback 没有引入自己的 input/phase/timeline 语义
- **收口标准**：
  - HTTP fallback 不再只返回静态 `{ ok: true }`
  - `input` action 与 widened session family / single-active-turn invariant 对齐
  - WS 与 fallback 共享同一 actor model
- **本 Phase 风险提醒**：
  - 如果把 HTTP fallback 做成另一套消息体系，后续 public API 会建立在错误边界上
  - 如果 widened input 直接被实现成 queue semantics，P3 会越界侵入下一阶段

### 5.4 Phase 4 — Edge Trace, Health & Recovery Closure

- **Phase 目标**：把 session edge 从“功能可用”推进到“可观测、可恢复、可判责”。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - 视需要新增 edge trace / recovery tests
- **本 Phase 修改文件**：
  - `packages/session-do-runtime/src/{do/nano-session-do,alarm,health,checkpoint}.ts`
  - `packages/eval-observability/**`
  - `test/observability-protocol-contract.test.mjs`
- **具体功能预期**：
  1. attach/resume/replay/heartbeat/ack/backpressure/checkpoint/restore 全部有固定 trace evidence
  2. caller-managed health 真正落在 alarm/close/persist/recover 路径上
  3. edge 输出与 stream schema / observability reality 持续对拍
- **具体测试安排**：
  - **单测**：`health.test.ts`, `alarm.test.ts`, `checkpoint.test.ts`, `traces.test.ts`
  - **集成测试**：`heartbeat-ack-timeout.test.ts`, `checkpoint-roundtrip.test.ts`, `graceful-shutdown.test.ts`, `stream-event-schema.test.ts`
  - **回归测试**：`npm run test:cross`
  - **手动验证**：人工检查 edge boundary 不再是 trace blind spot
- **收口标准**：
  - edge lifecycle 的关键行为都能被 trace / health evidence 看见
  - heartbeat/ack/backpressure 进入 caller-managed enforcement reality
  - stream schema drift 能被 cross-package tests 捕获
- **本 Phase 风险提醒**：
  - 若 P2 trace carrier 尚未真正收口，Phase 4 只能做半成品 wiring
  - 若仅加 trace 不做 health/close/recover contract，observability 会再次变成“只多打一批日志”

### 5.5 Phase 5 — Evidence, Docs & Exit Pack

- **Phase 目标**：让 Phase 3 结束后，session edge baseline 可以被后续 Phase 直接消费。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - 视需要新增 ingress migration checklist / closure note
- **本 Phase 修改文件**：
  - `docs/design/after-skeleton/P3-session-edge-closure.md`
  - `packages/nacp-session/package.json` 相关 schema/docs 产物
  - `docs/action-plan/after-skeleton/A4-session-edge-closure.md`
- **具体功能预期**：
  1. `nacp-session` / `session-do-runtime` / root tests 共同证明 P3 已成唯一 edge 主路径
  2. package docs / schema / design memo 不再保留“controller stub”“follow-up family deferred”等过时表述
  3. P4/P5/Pnext 能直接引用这份 exit pack
- **具体测试安排**：
  - **单测**：`pnpm --filter @nano-agent/nacp-session test`, `pnpm --filter @nano-agent/session-do-runtime test`
  - **集成测试**：`pnpm --filter @nano-agent/nacp-session test:integration`, `packages/session-do-runtime` integration suite
  - **回归测试**：`pnpm --filter @nano-agent/nacp-session build:schema && pnpm --filter @nano-agent/nacp-session build:docs`; `npm run test:cross`
  - **手动验证**：核对 P3 design / action-plan / package docs / tests 口径一致
- **收口标准**：
  - raw parse/switch 不再是实际 ingress reality
  - reconnect + replay + fallback + health contract 有自动化与文档双重证据
  - 后续 phase 不再需要重新解释“session edge 到底有没有接真”
- **本 Phase 风险提醒**：
  - 若只看 package-local 绿测，不看 cross-package drift，P3 closure 仍可能是局部幻觉
  - 若 docs/schema 不同步，前端与后续设计仍会读到旧口径

---

## 6. 需要业主 / 架构师回答的问题清单

> **统一说明**：与本 action-plan 相关的业主 / 架构师问答，统一收录于 `docs/action-plan/after-skeleton/AX-QNA.md`；请仅在该汇总文件中填写答复，本文不再逐条填写。

### 6.1 当前判断

- 当前 **无新增必须拍板的问题**。
- Phase 3 直接继承并依赖已有冻结输入：
  1. **Q8**：formal follow-up input family 必须进入 P0 `nacp-session` contract freeze；
  2. **Q6 / Q7**：trace-first carrier 与三层 observability 语言已经在 P2 固定。
- 如果执行中需要回到业主层，只应针对 **会改变 upstream widened session truth** 或 **会改变 single-active-turn invariant** 的问题，而不是 controller 实现细节。

### 6.2 问题整理建议

- 不把 `turn-ingress.ts` 的适配细节升级成 owner 问题
- 不把 HTTP fallback 的输出字段微调升级成 owner 问题
- 只把会改变 P0/P2 frozen truth 的事项带回给业主

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| P0 widened session family 尚未真正落地 | `turn-ingress.ts` 仍是 placeholder reality | `high` | 把 P0 widened truth 作为 Phase 1 start gate，而不是在 runtime 私造 wire |
| `nacp-session` 仍存在 retired trace/identifier naming | `SessionContext` 还在用 `trace_id / producer_id / stamped_by / stream_id` | `high` | Phase 3 coding 建立在 P0 rename 已完成的前提上，不提前假装 trace closure 完成 |
| WS helper 只被半装配 | replay/ack/heartbeat/checkpoint 会继续分散在 DO 与 helper 之间 | `high` | Phase 2 强制所有相关路径统一经过 helper |
| HTTP fallback 自由发挥 | fallback 会长成第二套协议 | `medium` | 明确其只是 transport fallback，并用 integration tests 守住 |

### 7.2 约束与前提

- **技术前提**：`P0 contract freeze 与 P2 trace-first foundation 已可作为上游输入；Phase 3 不重新设计 protocol surface`
- **运行时前提**：`single-active-turn` 是当前唯一执行 invariant；runtime 不得 silently coerce widened family 回 `session.start`
- **组织协作前提**：`nacp-session` 是 legality truth，`session-do-runtime` 是 assembly host，这条边界不得再逆转
- **上线 / 合并前提**：`nacp-session` / `session-do-runtime` tests、必要 schema/docs 产物、root cross tests 与 P3 doc sync 必须一起过线

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/after-skeleton/P3-session-edge-closure.md`
  - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
  - `docs/design/after-skeleton/P0-contract-freeze-matrix.md`
- 需要同步更新的说明文档 / README：
  - 相关 session package docs / root planning 说明
- 需要同步更新的测试说明：
  - `packages/nacp-session/test/**`
  - `packages/session-do-runtime/test/**`
  - root `test:cross`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 确认所有进入 Session DO 的客户端输入都先经过 `normalizeClientFrame()`
  - 确认 runtime 没有发明 private follow-up wire，也没有保留 raw `message_type` 主解析路径
- **单元测试**：
  - `pnpm --filter @nano-agent/nacp-session test`
  - `pnpm --filter @nano-agent/session-do-runtime test`
- **集成测试**：
  - `pnpm --filter @nano-agent/nacp-session test:integration`
  - `packages/session-do-runtime/test/integration/{ws-http-fallback,start-turn-resume,heartbeat-ack-timeout,checkpoint-roundtrip,graceful-shutdown,stream-event-schema}.test.ts`
- **端到端 / 手动验证**：
  - 手工验证 reconnect/resume/fallback 路径读到的是同一 session model
  - 手工验证 widened follow-up family 没有被 runtime 私有消息替代
- **回归测试**：
  - `pnpm --filter @nano-agent/nacp-session typecheck && pnpm --filter @nano-agent/nacp-session build`
  - `pnpm --filter @nano-agent/session-do-runtime typecheck && pnpm --filter @nano-agent/session-do-runtime build`
  - `npm run test:cross`
- **文档校验**：
  - P3 design、action-plan、package docs/schema、tests 对 ingress/fallback/replay/health 的说法必须一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `normalizeClientFrame()` 已成为 session edge 唯一合法 ingress 入口。
2. `SessionWebSocketHelper` 已承担 replay/ack/heartbeat/checkpoint/restore 的真实主路径责任。
3. HTTP fallback 与 WS 共享同一 actor state / timeline / cancel/end truth。
4. widened session ingress surface 在 runtime 中服从 single-active-turn invariant，且没有 runtime-private wire 漂移。
5. attach/resume/replay/health/checkpoint/restore 已具备 trace/health/evidence 收口。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `normalized ingress + WS helper assembly + HTTP fallback closure + single-active-turn edge + edge trace/health` 全部落地 |
| 测试 | `nacp-session`、`session-do-runtime`、integration、root cross tests 形成最小闭环 |
| 文档 | P3 design、action-plan、session package docs/schema、相关 root 说明口径一致 |
| 风险收敛 | 不再存在 raw parse/switch 主路径、runtime-private follow-up wire、WS/HTTP 双宇宙 |
| 可交付性 | P4 external seam、P5 deploy verification、后续 API/SDK 设计可直接把 P3 作为稳定输入 |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

这份 action-plan 以 **把 `nacp-session` 的 frozen truth 变成 `session-do-runtime` 的唯一边界现实** 为第一优先级，采用 **先同步 upstream truth、再替换 raw ingress、再装配 WS helper、再闭合 fallback/trace/health、最后用 tests/docs 封箱** 的推进方式，优先解决 **DO 内 raw parse/switch 主路径、controller stub、follow-up family 只停留在上游 freeze 而未进入 runtime** 这三类问题，并把 **不私造 protocol、不把 HTTP fallback 长成第二协议、不断言 richer queue semantics 已成熟** 作为主要约束。整个计划完成后，`Session Runtime / Edge` 应达到 **WS-first、HTTP fallback、single-active-turn、replay/ack/heartbeat/checkpoint、edge trace/health 都共享同一套 truth** 的状态，从而为后续的 **external seam closure、deploy-shaped verification、API / SDK 设计** 提供稳定基础。
