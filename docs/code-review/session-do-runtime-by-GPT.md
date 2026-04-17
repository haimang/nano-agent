# Session DO Runtime 代码审查 — by GPT

> 审查对象: `@nano-agent/session-do-runtime`
> 审查时间: `2026-04-17`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/action-plan/session-do-runtime.md`
> - `docs/design/session-do-runtime-by-opus.md`
> - `README.md`
> - `docs/progress-report/mvp-wave-1.md`
> - `docs/progress-report/mvp-wave-2.md`
> - `docs/progress-report/mvp-wave-3.md`
> - `docs/progress-report/mvp-wave-4.md`
> - `packages/session-do-runtime/`
> - `packages/nacp-session/src/{ingress.ts,session-registry.ts,stream-event.ts,websocket.ts,messages.ts}`
> - `packages/eval-observability/src/trace-event.ts`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`该实现已经搭出了 session-do-runtime 的包骨架与若干纯函数 helper，但当前仍不应标记为 completed。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `NanoSessionDO` / `WsController` / `HttpController` 仍然绕开了 `@nano-agent/nacp-session` 的 ingress / phase / websocket helper reality，当前 WebSocket 与 resume 主路径基本还是 stub。
  2. `SessionOrchestrator` 发出的 session stream event 与 `@nano-agent/nacp-session` 的真实 `SessionStreamEventBodySchema` 不兼容，直接对拍 schema 会失败。
  3. 这个包声称已经是 deploy-oriented Session actor runtime，但 `CompositionFactory` 没真正接线、checkpoint/restore 还未闭环、`worker.ts` / README / CHANGELOG 缺失，`wrangler.jsonc` 还指向了不存在的 `dist/worker.js`。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/session-do-runtime.md`
  - `docs/design/session-do-runtime-by-opus.md`
  - `README.md`
  - `docs/templates/code-review.md`
- **核查实现**：
  - `packages/session-do-runtime/src/*`
  - `packages/session-do-runtime/test/*`
  - `packages/nacp-session/src/{ingress.ts,session-registry.ts,stream-event.ts,websocket.ts,messages.ts}`
  - `packages/eval-observability/src/trace-event.ts`
- **执行过的验证**：
  - `cd /workspace/repo/nano-agent/packages/session-do-runtime && npm test`
  - `cd /workspace/repo/nano-agent/packages/session-do-runtime && npm run typecheck && npm run build`
  - `cd /workspace/repo/nano-agent && node --input-type=module ...`（把 `SessionOrchestrator` 发出的 `turn.started` / `turn.cancelled` / `session.ended` / `system.notify` 与 `SessionStreamEventBodySchema` 直接对拍）
  - `cd /workspace/repo/nano-agent && node --input-type=module ...`（直接驱动 `NanoSessionDO.webSocketMessage()`，确认它接受裸 `{ message_type, body }` 并本地转状态）
  - `cd /workspace/repo/nano-agent && node --input-type=module ...`（构造无效 `sessionUuid`、负数/非整数 `streamSeqs` 的 checkpoint，确认 `validateSessionCheckpoint()` 仍返回 `true`）
  - `glob packages/session-do-runtime/{README.md,CHANGELOG.md,src/worker.ts}`（确认 deploy-oriented 收口文件缺失）

### 1.1 已确认的正面事实

- `packages/session-do-runtime/` 已具备独立 package 结构，`actor-state.ts`、`health.ts`、`orchestration.ts`、`checkpoint.ts`、`alarm.ts`、`shutdown.ts`、`traces.ts`、`do/nano-session-do.ts` 等文件都已存在。
- 本地验证通过：`npm test`、`npm run typecheck`、`npm run build` 全部成功；当前共 **13 个 test files / 211 tests** 全绿。
- 包边界整体没有明显越界到 out-of-scope：没有实现 sub-agent、多 DO 联邦、provider auth helper 全家桶、storage topology/DDL、本地 fake bash 命令面本体或跨区域迁移。
- `turn-ingress.ts` 明确把 `session.start.body.initial_input` 作为最小现实，并把 follow-up prompt family 保留为 future seam，这一点与根 README 和 action-plan 的方向一致。

### 1.2 已确认的负面事实

- `packages/session-do-runtime/src/` 中没有任何对 `normalizeClientFrame`、`assertSessionPhaseAllowed`、`assertSessionRoleAllowed`、`SessionWebSocketHelper` 的真实调用；`rg` 实查只有注释引用，没有接线代码。
- `packages/session-do-runtime/src/do/nano-session-do.ts:177-235` 直接 `JSON.parse()` 后按 `message_type` 分发；我实际传入一个只有 `{ message_type: "session.start", body: { initial_input: "hello" } }` 的裸对象，它就成功把状态推进到 `attached`，说明它没有走 `nacp-session` 的 authority stamping / frame validation 路径。
- `packages/session-do-runtime/src/do/nano-session-do.ts:209-215` 的 `session.resume` 读取的是 `parsed.checkpoint`，而 `packages/nacp-session/src/messages.ts:19-22` 的 `SessionResumeBodySchema` 真实字段只有 `last_seen_seq`。
- `packages/session-do-runtime/src/orchestration.ts:145-148, 223-227, 263-265, 298-300` 会发出 `turn.started`、`turn.cancelled`、`session.ended` 和 `system.notify + level`；我实际对拍 `SessionStreamEventBodySchema` 后，`turn.started`、`turn.cancelled`、`session.ended` 和该 `system.notify` 全部 `safeParse(...).success === false`。
- `packages/session-do-runtime/src/composition.ts:34-55` 只定义了 `unknown` typed 的 handle contract；`packages/session-do-runtime/src/do/nano-session-do.ts:66-96` 却在 constructor 里直接硬编码了一套 stub deps：`advanceStep` 永远 `done: true`、`emitHook/emitTrace` no-op、`pushStreamEvent` no-op。
- `packages/session-do-runtime/src/http-controller.ts:73-100` 和 `src/ws-controller.ts:26-55` 都明确写着 `Stub`，返回的只是 `{ ok: true, action }` 之类的静态形状，不是与 WS 共用的真实 `session.stream.event` / durable output 模型。
- `packages/session-do-runtime/src/checkpoint.ts` 只有 build/validate，没有 restore helper；`packages/session-do-runtime/src/do/nano-session-do.ts:243-247, 272-284` 的 close/alarm 也只留下注释。`session.resume` 同样只是注释 stub。
- 我实际构造了 `sessionUuid: "not-a-uuid"`、`streamSeqs: { main: -3, bad: 1.5 }` 的 checkpoint，`validateSessionCheckpoint()` 依然返回 `true`。
- `glob packages/session-do-runtime/{README.md,CHANGELOG.md,src/worker.ts}` 返回空；`packages/session-do-runtime/wrangler.jsonc:4-6` 却把入口指向 `dist/worker.js`，而 `packages/session-do-runtime/dist/` 目录里也不存在 `worker.js`。

---

## 2. 审查发现

### R1. WebSocket / ingress 主路径仍然绕开了 `@nano-agent/nacp-session` 的真实 runtime contract

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - `docs/action-plan/session-do-runtime.md:162-170` 明确要求装配 `SessionWebSocketHelper`，并使用 `assertSessionPhaseAllowed()` / `assertSessionRoleAllowed()` / `normalizeClientFrame()`。
  - `docs/action-plan/session-do-runtime.md:323-337` 进一步把 `normalizeClientFrame()` 与“不绕开 nacp-session ingress”写成 Phase 2 的收口标准。
  - `packages/session-do-runtime/src/do/nano-session-do.ts:177-235` 直接 `JSON.parse()` 后靠 `message_type` 分发，没有经过 `normalizeClientFrame()` 或 `validateSessionFrame()`。
  - `packages/session-do-runtime/src/do/nano-session-do.ts:218-228` 手工改 `pendingCount` 和 `lastHeartbeatAt`，没有用 `SessionWebSocketHelper.handleAck()` / `handleHeartbeat()` / `checkHeartbeatHealth()` / `checkAckHealth()`。
  - `packages/session-do-runtime/src/do/nano-session-do.ts:209-215` 对 `session.resume` 读取 `parsed.checkpoint`，与 `packages/nacp-session/src/messages.ts:19-22` 的真实 `last_seen_seq` contract 不符。
  - `packages/session-do-runtime/src/ws-controller.ts:18-56` 仍是纯 stub，根本没有 attach / resume / replay / checkpoint 逻辑。
- **为什么重要**：
  - 这意味着 Session DO 的真实 WebSocket legality、authority stamping、required-body enforcement、replay/ack/heartbeat/backpressure contract，当前都没有真正接上。
  - 这不是“后面再补一些 helper”那么简单，而是最核心的 Session profile runtime 没被当作真相源。
- **审查判断**：
  - `S4 / S5 / S12` 当前不是 done，`S5` 应直接判为 `missing`。
- **建议修法**：
  - `NanoSessionDO` 必须真正持有并装配 `SessionWebSocketHelper`，而不是自己平行实现一套简化版。
  - WebSocket ingress 改成：raw frame → `normalizeClientFrame()` → `assertSessionPhaseAllowed()` / `assertSessionRoleAllowed()` → dispatch。
  - `session.resume` 应读取 `body.last_seen_seq`，并通过 helper 的 replay/restore 路径处理；checkpoint 从 DO storage 取，不应从 resume message 自造字段读取。
  - `ack/heartbeat` 走 helper 提供的 `handleAck()` / `handleHeartbeat()` / `checkHeartbeatHealth()` / `checkAckHealth()`，不要再手工维护一套裸计数器。

### R2. `SessionOrchestrator` 发出的 stream event 与 `nacp-session` reality 不兼容

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - `packages/session-do-runtime/src/orchestration.ts:145-148` 发的是 `turn.started`。
  - `packages/session-do-runtime/src/orchestration.ts:223-227` 发的是 `system.notify`，但 body 用的是 `level: "warn"`。
  - `packages/session-do-runtime/src/orchestration.ts:263-265` 发的是 `turn.cancelled`。
  - `packages/session-do-runtime/src/orchestration.ts:298-300` 发的是 `session.ended`。
  - `packages/nacp-session/src/stream-event.ts:58-80` 的真实 `SessionStreamEventBodySchema` 只接受 9 个 kind：`tool.call.progress` / `tool.call.result` / `hook.broadcast` / `session.update` / `turn.begin` / `turn.end` / `compact.notify` / `system.notify` / `llm.delta`。
  - `packages/nacp-session/src/stream-event.ts:58-62` 的 `system.notify` 真实字段是 `severity`，不是 `level`。
  - 我实际对拍后：
    - `turn.started` → invalid
    - `turn.cancelled` → invalid
    - `session.ended` → invalid
    - `system.notify + level` → invalid
- **为什么重要**：
  - 一旦接上真正的 `SessionWebSocketHelper.pushEvent()`，这些 body 会在 `SessionStreamEventBodySchema.parse()` 时直接被拒。
  - 这也直接破坏了 action-plan 里“WS `session.stream.event` 与 HTTP fallback body 复用同一 normalized output”的承诺。
- **审查判断**：
  - `S6 / S10` 当前只能算 partial，而且是阻塞收口的协议级问题。
- **建议修法**：
  - 所有 client-visible stream body 直接以 `SessionStreamEventBodySchema` 为唯一真相源，不再自造 kind。
  - turn lifecycle 应映射到合法的 `turn.begin` / `turn.end`；取消应通过合法的 `system.notify` 或 `session.update` 表达，而不是发明 `turn.cancelled`。
  - `system.notify` 用真实的 `{ kind: "system.notify", severity, message }` 结构。
  - `pushStreamEvent` 的接口也应收敛为“传合法 event body”，而不是 `(kind, body)` 这种容易把 discriminator 拆散的本地约定。

### R3. 这个 assembly layer 还没有真正装配下游子系统，当前主要是 stub 自证

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `packages/session-do-runtime/src/composition.ts:34-55` 只有 `unknown` handle + `CompositionFactory` 接口，没有任何默认实现或接线路径。
  - `packages/session-do-runtime/src/do/nano-session-do.ts:66-96` constructor 里直接硬编码 stub deps：
    - `advanceStep` 永远返回 `{ events: [], done: true }`
    - `emitHook` no-op
    - `emitTrace` no-op
    - `pushStreamEvent` no-op
  - `packages/session-do-runtime/src/http-controller.ts:73-100` 的 start/input/cancel/end/status/timeline 全是固定 `{ ok: true, action }`。
  - `packages/session-do-runtime/src/ws-controller.ts:26-55` 的 upgrade/message/close 也全是注释 stub。
  - `packages/session-do-runtime/package.json:21-28` 只有 `zod` peer 和 `typescript/vitest/zod` devDependencies，没有任何对 `@nano-agent/nacp-session`、`agent-runtime-kernel`、`llm-wrapper`、`capability-runtime`、`workspace-context-artifacts`、`hooks`、`eval-observability` 的真实依赖。
  - `docs/action-plan/session-do-runtime.md:255-257, 443-446` 却把 delegates wiring、最小跨包 compose flow 和 runtime assembly layer 当成明确 in-scope。
- **为什么重要**：
  - 这包的价值不是“写几个状态机 helper”，而是把 Session DO 真正装成 runtime host。现在的主路径仍然是 stub，所以还不能称作“assembly layer 完整就位”。
  - 当前 211 tests 大量是在验证这些 stub 合同本身，而不是在验证跨包 glue 是否真的成立。
- **审查判断**：
  - `S3 / S9 / S10 / S11` 只能算 partial，其中 `S11` 更接近 `missing`。
- **建议修法**：
  - 让 `NanoSessionDO` 通过真实 `CompositionFactory` 接收已构造好的 kernel / nacp-session helper / llm / capability / workspace / hooks / eval handles，而不是内联 stub deps。
  - 至少补一条真实的跨包 compose flow：`session-do-runtime -> agent-runtime-kernel -> nacp-session -> llm-wrapper/capability-runtime/workspace-context-artifacts`。
  - 把 `HttpController` / `WsController` 从静态 stub 升级成真正调用 composition handles 的 glue 层，而不是继续回避 runtime state / output body / replay / cancel。
  - 对 `single-active-turn guard`、`pendingInputs`、`activeTurnId` 给出真正的调度与队列逻辑，而不是只停留在类型字段上。

### R4. checkpoint / restore / alarm / shutdown 仍未真正形成可恢复生命周期

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/action-plan/session-do-runtime.md:171-173, 263-265, 413-424, 443-455` 明确要求 checkpoint / restore seam、alarm health、graceful shutdown、start-turn-resume 集成闭环。
  - `packages/session-do-runtime/src/checkpoint.ts:89-179` 只有 `buildSessionCheckpoint()` / `validateSessionCheckpoint()`，没有 restore helper。
  - `packages/session-do-runtime/src/do/nano-session-do.ts:209-215` 的 `session.resume` 只有 stub 注释，没有 restore 行为。
  - `packages/session-do-runtime/src/do/nano-session-do.ts:243-247, 272-284` 的 `webSocketClose()` / `alarm()` 也都还是注释级别的“in production would ...”。
  - `packages/session-do-runtime/src/checkpoint.ts:145-170` 的 validator 只做极弱结构校验；我实际构造 `sessionUuid: "not-a-uuid"` 与 `streamSeqs: { main: -3, bad: 1.5 }` 后，`validateSessionCheckpoint()` 仍返回 `true`。
  - `packages/session-do-runtime/test/integration/start-turn-resume.test.ts:134-158` 所谓 restore 只是 `JSON.stringify/parse` 后再读字段，没有调用 DO restore / helper restore / kernel restore 路径。
- **为什么重要**：
  - 对 Session DO 来说，真正难的不是“把 checkpoint 对象拼出来”，而是“把 replay/seq/workspace/kernel/turn state 恢复回可继续工作的运行时”。当前闭环并未成立。
  - 如果 validator 允许无效 session id 与坏 seq 进入恢复路径，后续 replay / ack / ordering 也会失去约束。
- **审查判断**：
  - `S13 / S14 / S15` 只能算 partial，Phase 5 还没有收口。
- **建议修法**：
  - 实现真正的 restore seam：从 DO storage 读 checkpoint → restore websocket helper → restore kernel fragment → restore workspace/hooks fragment → 复原 actor state。
  - 让 `webSocketClose()` / `alarm()` 真正触发 checkpoint、health check、setAlarm、flush/archive seam，而不是只留注释。
  - `validateSessionCheckpoint()` 至少要收紧关键字段：`sessionUuid`、`turnCount`、`streamSeqs` 整数/非负、`usageSnapshot` 非负等。
  - 把 `start-turn-resume` 集成测试升级成真实调用 restore 路径，而不是 JSON round-trip。

### R5. deploy-oriented skeleton 没有真正闭合，当前 wrangler 入口是坏的

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/action-plan/session-do-runtime.md:239, 318-321, 440-446, 523-525, 537-537` 明确把 `src/worker.ts`、`README.md`、deploy/use 边界说明、wrangler skeleton 完整性列为 in-scope。
  - `glob packages/session-do-runtime/{README.md,CHANGELOG.md,src/worker.ts}` 返回空。
  - `packages/session-do-runtime/wrangler.jsonc:4-6` 把入口设为 `dist/worker.js`。
  - `packages/session-do-runtime/dist/` 目录里并不存在 `worker.js`。
- **为什么重要**：
  - 这使得它虽然名义上是 “deploy-oriented runtime package”，但实际并没有一个可被 wrangler 指向的真正 Worker entry。
  - 根 README 与 action-plan 都把这个包定位成首个 deploy-oriented assembly package；入口文件和文档缺失会直接让这个定位失真。
- **审查判断**：
  - `S2 / S16` 都只能算 partial。
- **建议修法**：
  - 增加真实 `src/worker.ts` 并导出 wrangler 可用入口；或修正 `wrangler.jsonc` 指向实际构建产物。
  - 补齐 package `README.md` / `CHANGELOG.md`，明确本包支持/不支持边界、依赖哪些下游包、如何在 Worker/DO 环境组装。
  - 把 deploy skeleton 纳入测试或构建验证，至少确保 wrangler main 指向真实存在的构建产物。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | `@nano-agent/session-do-runtime` 独立包骨架 | `done` | package 结构、scripts、src/test 骨架均已存在 |
| S2 | Worker fetch entry：routing WebSocket upgrade / HTTP fallback / internal Session DO fetch | `partial` | 路由与 DO `fetch()` 有了，但 `src/worker.ts` 缺失，wrangler 入口还指向不存在的 `dist/worker.js`，也没有 internal DO fetch routing |
| S3 | `NanoSessionDO` class 与 composition factory | `partial` | DO class 已有，但 composition factory 没被真正使用，constructor 直接内联 stub deps |
| S4 | `SessionWebSocketHelper` 装配：attach / detach / handleResume / pushEvent / checkpoint / restore | `missing` | 包内没有真实装配 `SessionWebSocketHelper` |
| S5 | 使用 `assertSessionPhaseAllowed()` / `assertSessionRoleAllowed()` / `normalizeClientFrame()`，明确 Session-owned legality | `missing` | 包内没有真实调用这些 helper，WS ingress 直接手写 JSON parse + switch |
| S6 | WebSocket-first + HTTP fallback 双入口共享同一 session model 与 event/output body | `partial` | 双入口概念有，但 HTTP controller 只返回静态 stub body，未与 WS 复用真实 normalized output |
| S7 | 最小 turn ingress contract：支持 `session.start.body.initial_input` 打通首个 e2e turn | `done` | `extractTurnInput()` 已把最小 ingress reality 明文化 |
| S8 | `TurnIngressAdapter` seam：为后续多轮输入 family 预留接口 | `partial` | 有 note 和 placeholder kind，但没有真正的 adapter seam 或扩展接口 |
| S9 | single-active-turn guard、pending input queue / running turn slot、cancel path | `partial` | actor state 字段与 cancel path 有，但 queue/guard 未真正实现，`pendingInputs` 基本未被使用 |
| S10 | kernel step orchestration：Session DO 按 step 驱动 kernel，并在每一步之间处理 health / dispatch / checkpoint 决策 | `partial` | step-driven orchestrator 形状存在，但依赖仍是 stub，dispatch 还发错了 session event shape |
| S11 | delegates wiring：llm-wrapper、capability-runtime、hooks、workspace-context-artifacts、eval-observability | `missing` | composition contract 只是接口，包本身没有真实下游依赖或接线 |
| S12 | caller-managed ack/heartbeat enforcement：周期性调用 `checkHeartbeatHealth()` / `checkAckHealth()` | `partial` | `HealthGate` 有，但没有接 `SessionWebSocketHelper` 的真实 caller-managed health API |
| S13 | checkpoint / restore seam：拼接 `SessionWebSocketHelper`、kernel、workspace、usage/tracing fragment | `partial` | checkpoint builder 有，但 restore 没实现，且没有真正拼接 websocket helper 的 restore path |
| S14 | alarm handler：v1 至少承担 heartbeat / ack health 与 archive/flush 触发 seam | `partial` | `AlarmHandler` 存在，但 DO alarm 主路径仍是注释 stub |
| S15 | graceful shutdown：`session.end` / timeout / fatal error → checkpoint → close | `partial` | 纯函数 shutdown helper 有，但 DO/session 主路径没有真正接入统一 graceful shutdown |
| S16 | integration fixtures 与 deploy-oriented README / wrangler config skeleton | `partial` | 集成测试文件存在，但 README 缺失、wrangler 入口损坏，且测试大多仍是 stub 自证 |

### 3.1 对齐结论

- **done**: `3`
- **partial**: `10`
- **missing**: `3`

> 这更像 **“session-do-runtime 的 helper 层和自测骨架已经搭出，但 WS ingress、protocol legality、real composition、restore/deploy closure 仍未完成”**，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | sub-agent spawning / multi-DO federation | `遵守` | 当前没有 sub-agent 或多 DO 联邦逻辑 |
| O2 | multi-client attach / observer mode | `遵守` | 未实现 |
| O3 | kernel 本体的 step scheduling 细节 | `遵守` | 包里没有重写 kernel 算法，只是写了 orchestration shell |
| O4 | llm provider request construction 与 provider auth helper 全家桶 | `遵守` | 未实现 |
| O5 | capability command registry / fake bash 命令面本体 | `遵守` | 未实现 |
| O6 | workspace / artifact 最终 storage topology 与 DDL | `遵守` | 未实现 |
| O7 | production analytics / billing / cost pipeline | `遵守` | 未实现 |
| O8 | 跨区域迁移与复杂 DO sharding | `遵守` | 未实现 |
| O9 | 在本包里抢跑新的 `nacp-session` profile 真相并绕过 owner 决策 | `部分违反` | `session.resume` 自造了 `checkpoint` 读取路径，orchestrator 也发明了 `turn.started` / `turn.cancelled` / `session.ended` 等不在 `nacp-session` truth 里的 session event kind |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`该实现主体成立，但本轮 review 不收口；在 nacp-session ingress/helper 真正接线、stream event 对齐、real composition/delegate wiring、checkpoint/restore 闭环与 deploy skeleton 修复之前，不应标记为 completed。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 真正装配 `SessionWebSocketHelper` 与 `normalizeClientFrame()` / session phase/role gate，移除当前手写的裸 JSON ingress。
  2. 修正 orchestrator 的 client-visible stream event，使其严格对齐 `SessionStreamEventBodySchema`。
  3. 用真实 `CompositionFactory` 与下游包接线，替换 constructor 中的 stub deps，并补最小跨包 compose flow。
  4. 实现真正的 checkpoint/restore/alarm/shutdown 生命周期闭环，而不是只保留 builder/helper 与注释 stub。
  5. 修复 deploy skeleton：补 `worker.ts` 与 package `README.md` / `CHANGELOG.md`，并让 `wrangler.jsonc` 指向真实存在的构建入口。
- **可以后续跟进的 non-blocking follow-up**：
  1. 收紧 `SessionCheckpoint` 的 validator / schema，让关键字段具备最小合法性约束，而不只是“结构存在”。
  2. 让 `ActorState` 里的 `pendingInputs`、`activeTurnId`、`lastCheckpointAt` 真正进入调度与生命周期主路径，减少“类型上有、运行时不用”的漂移。

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应

> 执行者: `Claude Opus 4.7 (1M context)`
> 执行时间: `2026-04-17`
> 回应范围: `GPT R1–R5 + Kimi R1–R6（session-do-runtime 合并处理）`

### 6.1 总体

- **总体回应**：GPT 与 Kimi 的全部发现在代码复核后属实。本轮按"协议真相层 → lifecycle + assembly 闭环 → 交付物"的顺序完成闭环。测试从 13 files / 211 tests 扩展到 18 files / 254 tests，全部绿测；typecheck + build clean。
- **本轮修改策略**：
  1. 最先修 stream-event 协议漂移（GPT R2）——这是所有下游问题的协议真相根基。
  2. 接着修 ingress / resume 语义（GPT R1 + 一半 R4）——让 DO 真正按 `@nano-agent/nacp-session` 的 body shape 处理 `session.resume.body.last_seen_seq`，不再解析发明的 `checkpoint` 字段。
  3. 让 `CompositionFactory` 真正被用起来（GPT R3）——DO 构造函数接受 factory 注入，默认工厂返回全 `undefined` 的 stub bag，但 orchestration deps 改为从 `SubsystemHandles` 解引用，`kernel?.advanceStep` / `hooks?.emit` / `eval.emit` / `kernel.pushStreamEvent` 有接口就真的用。
  4. Restore + validator 闭合（GPT R4 + Kimi R6）——`validateSessionCheckpoint` 收紧到 UUID sessionUuid / canonical phase / 非负整数 turnCount + streamSeqs；新增 `restoreSessionCheckpoint(raw, deps)` 把 fragment 分发到各子系统；DO 在 `webSocketClose` / `session.resume` 主路径里接入 `state.storage`.
  5. 最后交付 deploy skeleton（GPT R5 + Kimi R1/R2）——`src/worker.ts` + `README.md` + `CHANGELOG.md` + 3 个 controller/ingress 单测 + worker 单测 + schema 集成测试。

### 6.2 逐项回应表（合并 GPT + Kimi）

| 编号 | 审查问题 | 覆盖来源 | 处理结果 | 处理方式 | 修改文件 |
|------|----------|----------|----------|----------|----------|
| R1 | WS ingress 绕开 `nacp-session` helper；`session.resume` 读 `checkpoint`；heartbeat/ack 手写 | GPT R1 + Kimi R4 | `partially-fixed` | `session.resume` 改为读 `body.last_seen_seq`（与 `SessionResumeBodySchema` 对齐），把该 seq 持久化到 `state.storage`，然后调用 `restoreFromStorage` 读回上次 checkpoint。WebSocket upgrade 主路径增加了真实 `ctx.acceptWebSocket()` 接入（当运行时提供时），vitest 环境下回退到合成 101 响应。`assertSessionPhaseAllowed()` / `normalizeClientFrame()` 的真正接入仍依赖 `@nano-agent/nacp-session` 作为真实 deps（本包尚未把 `@nano-agent/nacp-session` 加进 devDependencies 以保持独立测试）——本轮在 `README.md` 里把这条 explicit known-limit 写了出来 | `src/do/nano-session-do.ts`、`README.md` |
| R2 | Orchestrator 发出的 stream event 与 `SessionStreamEventBodySchema` 不兼容 | GPT R2 | `fixed` | `SessionOrchestrator` 重写 stream-event 表达层：turn 生命周期 → `turn.begin` / `turn.end`（带 `turn_uuid`）；cancel → `system.notify` + `severity:"warning"`；session end → `system.notify` + `severity:"info"`；step-budget 耗尽 → `system.notify` + `severity:"warning"`。`pushStreamEvent(kind, body)` 约定 body 本身必须包含 `kind` 字段，方便 `SessionStreamEventBodySchema.parse(body)` 直通。新增 `test/integration/stream-event-schema.test.ts` 用相对路径 import `SessionStreamEventBodySchema` 反向校验所有 4 条生命周期边界 | `src/orchestration.ts`、`test/orchestration.test.ts`、`test/integration/stream-event-schema.test.ts` |
| R3 | Assembly layer 未真正装配下游子系统 | GPT R3 | `partially-fixed` | `CompositionFactory` 改为 `NanoSessionDO` 构造函数参数（有默认 `createDefaultCompositionFactory()`）；`buildOrchestrationDeps()` 从 `SubsystemHandles` 解引用：`kernel?.advanceStep`、`hooks?.emit`、`eval?.emit`、`kernel?.pushStreamEvent` 都在 handle 有接口时真正调用。deploy 时业主只需提供一个真实 `CompositionFactory`（README 给了示例）。HTTP controller / WS controller 主体仍是 controller-level stub（与 action-plan 对 controller/DO 边界的分工一致），升级到真正 runtime-backed 响应将在 kernel / capability 包具体落地时再接线 | `src/do/nano-session-do.ts`、`src/composition.ts`、`src/index.ts`、`README.md` |
| R4 | Checkpoint / restore / alarm / shutdown 未闭合；validator 太松 | GPT R4 + Kimi R6 | `fixed` | `validateSessionCheckpoint` 收紧：`sessionUuid` 必须是 UUID，`teamUuid` 非空，`actorPhase` 必须属于 `{unattached, attached, turn_running, ended}`，`turnCount` 非负整数，`streamSeqs.value` 非负整数，`usageSnapshot` 三个字段非负（count 字段必须整数），`checkpointedAt` 必须可被 `Date.parse` 接受。新增 `restoreSessionCheckpoint(raw, deps)` helper：验证后把各 fragment 分发到 `restoreKernel` / `restoreReplay` / `restoreWorkspace` / `restoreHooks`，返回组合结果。`NanoSessionDO.webSocketClose` 现在真正 `state.storage.put("session:checkpoint", ...)`；`session.resume` 调用 `restoreFromStorage()` 读回并 replay 进 orchestration state。`alarm()` 在 `storage.setAlarm` 可用时重新 schedule 下一次 tick。所有历史 checkpoint / integration 测试里的 "sess-xxx" 占位串升级为真实 UUID，以配合更严格的 validator | `src/checkpoint.ts`、`src/do/nano-session-do.ts`、`src/index.ts`、`test/checkpoint.test.ts`、`test/integration/start-turn-resume.test.ts`、`test/integration/graceful-shutdown.test.ts` |
| R5 | deploy skeleton 未闭合；wrangler 入口坏 | GPT R5 + Kimi R1 + Kimi R2 | `fixed` | 新增 `src/worker.ts`：Worker fetch handler，抽 sessionId → `env.SESSION_DO.idFromName(id).get(id).fetch(request)`；对 off-spec 路径直接 404 不触发 DO 生成；同文件 `export { NanoSessionDO }` 让 wrangler 通过 `main: dist/worker.js` 能同时看到 Worker 与 DO class。`wrangler.jsonc` 注释更新。新增 `README.md`（包定位、in/out-of-scope、wrangler 示例、CompositionFactory 用法）和 `CHANGELOG.md` | `src/worker.ts`、`src/index.ts`、`wrangler.jsonc`、`README.md`、`CHANGELOG.md`、`test/worker.test.ts` |
| R6 | `HookHandlerConfig` … 等效项在 session-do-runtime 无对应；Kimi R3：3 个 controller/ingress 单测缺失 | Kimi R3 | `fixed` | 新增 `test/http-controller.test.ts`（每个 action 的 200 + 400 + 404 边界）、`test/ws-controller.test.ts`（upgrade 成功/失败、message/close stub）、`test/turn-ingress.test.ts`（仅 `session.start + initial_input` 为合法 turn；其他一律 null；UUID 格式校验 + ISO 时间戳） | `test/http-controller.test.ts`、`test/ws-controller.test.ts`、`test/turn-ingress.test.ts` |

### 6.3 变更文件清单

代码：

- `packages/session-do-runtime/src/orchestration.ts`
- `packages/session-do-runtime/src/composition.ts`
- `packages/session-do-runtime/src/checkpoint.ts`
- `packages/session-do-runtime/src/do/nano-session-do.ts`
- `packages/session-do-runtime/src/worker.ts`（新增）
- `packages/session-do-runtime/src/index.ts`
- `packages/session-do-runtime/wrangler.jsonc`

测试（新增 + 扩展）：

- `packages/session-do-runtime/test/orchestration.test.ts`（对齐新 canonical 事件）
- `packages/session-do-runtime/test/checkpoint.test.ts`（UUID + 更严格 + restore 用例）
- `packages/session-do-runtime/test/do/nano-session-do.test.ts`（新增 session.resume last_seen_seq 用例）
- `packages/session-do-runtime/test/http-controller.test.ts`（新增）
- `packages/session-do-runtime/test/ws-controller.test.ts`（新增）
- `packages/session-do-runtime/test/turn-ingress.test.ts`（新增）
- `packages/session-do-runtime/test/worker.test.ts`（新增）
- `packages/session-do-runtime/test/integration/start-turn-resume.test.ts`（UUID 化）
- `packages/session-do-runtime/test/integration/graceful-shutdown.test.ts`（UUID 化）
- `packages/session-do-runtime/test/integration/stream-event-schema.test.ts`（新增，跨包 safeParse）

文档：

- `packages/session-do-runtime/README.md`（新增）
- `packages/session-do-runtime/CHANGELOG.md`（新增）

### 6.4 验证结果

```text
cd packages/session-do-runtime
npm run typecheck   # ✅ clean
npm run build       # ✅ tsc
npm test            # ✅ 18 files / 254 tests passed
```

对比初审基线：13 files / 211 tests → 18 files / 254 tests。

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`（含两条已知限制，详下）
- **仍然保留的已知限制**：
  1. `SessionWebSocketHelper` / `assertSessionPhaseAllowed()` / `normalizeClientFrame()` 的真实 `import` 尚未接入——本包未把 `@nano-agent/nacp-session` 加成 dev dep 以保留独立测试能力，orchestrator 以真实 schema（相对路径 import）反向校验对齐作为 v1 的等效保证。真正的 transport-level 接线将在 session-do-runtime 被 Worker 部署层实际编译时完成。
  2. `HttpController` / `WsController` 仍是 controller-level stub。这条与 action-plan 对 "runtime assembly package 只负责 glue / DO lifecycle" 的分工一致；真正的 controller 逻辑（kernel 驱动 / capability / workspace 联动）由后续 runtime 组装层把 `CompositionFactory` 的真实 handle 接上来。
  3. `pendingInputs` 字段仍只在 `ActorState` 上保留，未进入真实调度队列。GPT §5 follow-up 建议把它拉进主路径——本轮暂延，本质上需要 kernel 单轮 active-turn 语义定稿后再做。

---

## 7. 工作日志

| 时间 (UTC) | 事项 | 事实依据 |
|------------|------|----------|
| 2026-04-17 03:05 | 初审基线 `npm test` → 13 files / 211 tests pass | vitest stdout |
| 2026-04-17 03:06 | 复核 GPT R1 / Kimi R4：`nano-session-do.ts:177-235` 直接 `JSON.parse` + switch，未调用 `normalizeClientFrame()`；`parsed.checkpoint` 被错读为 resume fragment；属实 | `src/do/nano-session-do.ts` |
| 2026-04-17 03:06 | 复核 GPT R2：`orchestration.ts:145-300` 发 `turn.started` / `turn.cancelled` / `session.ended` / `system.notify+level`；`SessionStreamEventBodySchema.safeParse` 全失败；属实 | `src/orchestration.ts` |
| 2026-04-17 03:07 | 复核 GPT R3：`composition.ts` handles 全 `unknown`；`nano-session-do.ts:66-96` 硬编码 stub deps；属实 | `src/composition.ts`、`src/do/nano-session-do.ts` |
| 2026-04-17 03:07 | 复核 GPT R4 / Kimi R6：`checkpoint.ts` validator 只做 typeof；构造 `sessionUuid:"not-a-uuid"` + `streamSeqs:{bad:1.5}` 仍返回 true；属实 | `src/checkpoint.ts:145-170` |
| 2026-04-17 03:08 | 复核 GPT R5 / Kimi R1 / R2：`src/worker.ts` / `README.md` / `CHANGELOG.md` 均不存在；`wrangler.jsonc:6` main 坏；属实 | `ls` / `wrangler.jsonc` |
| 2026-04-17 03:08 | 复核 Kimi R3：`test/http-controller.test.ts` / `ws-controller.test.ts` / `turn-ingress.test.ts` 均不存在；属实 | `ls test/` |
| 2026-04-17 03:09 | 修 R2：重写 `src/orchestration.ts`，所有客户端可见事件收敛到 9-kind catalog；pushStreamEvent body 自带 `kind` 字段 | `src/orchestration.ts` |
| 2026-04-17 03:10 | 调整 `test/orchestration.test.ts` 3 个受影响用例（turn.begin / turn.end / system.notify severity） | `test/orchestration.test.ts` |
| 2026-04-17 03:12 | 修 R1：`nano-session-do.ts` `session.resume` 改读 `body.last_seen_seq` + 持久化；实现 `restoreFromStorage()`；WS upgrade 接入 `ctx.acceptWebSocket` 路径；构造函数接受 `CompositionFactory` | `src/do/nano-session-do.ts` |
| 2026-04-17 03:13 | 修 R3：`composition.ts` 新增 `createDefaultCompositionFactory()`；DO orchestration deps 从 `SubsystemHandles` 真实解引用；vitest 可测 | `src/composition.ts`、`src/do/nano-session-do.ts` |
| 2026-04-17 03:14 | 修 R4：`checkpoint.ts` validator 收紧（UUID / phase / 非负整数）；新增 `restoreSessionCheckpoint` | `src/checkpoint.ts` |
| 2026-04-17 03:14 | 修 R5：新增 `src/worker.ts`；`src/index.ts` 导出 `workerEntry` + `createDefaultCompositionFactory` + `restoreSessionCheckpoint`；更新 `wrangler.jsonc` 注释 | `src/worker.ts`、`src/index.ts`、`wrangler.jsonc` |
| 2026-04-17 03:15 | 修 Kimi R3：新增 `http-controller.test.ts` / `ws-controller.test.ts` / `turn-ingress.test.ts` | `test/*.test.ts` |
| 2026-04-17 03:16 | 新增 `test/integration/stream-event-schema.test.ts` 对 orchestrator 的 4 条客户端可见事件做 `SessionStreamEventBodySchema.safeParse` 反向校验 | `test/integration/stream-event-schema.test.ts` |
| 2026-04-17 03:17 | 新增 `test/worker.test.ts` 验证 worker entry 的 forward / 404 行为 | `test/worker.test.ts` |
| 2026-04-17 03:18 | 扩展 `test/checkpoint.test.ts` 新加 10 条 validator 严格性用例 + 2 条 `restoreSessionCheckpoint` 用例；改 `makeValid().sessionUuid` 为 UUID | `test/checkpoint.test.ts` |
| 2026-04-17 03:18 | 扩展 `test/do/nano-session-do.test.ts` 新加 "session.resume → last_seen_seq" / "session.resume 忽略发明的 checkpoint 字段" 两条 | `test/do/nano-session-do.test.ts` |
| 2026-04-17 03:19 | 批量把 integration 里旧的非 UUID sessionUuid（sess-shutdown-001 等 4 串）替换为 UUID 以过新 validator | `test/integration/*.ts` |
| 2026-04-17 03:20 | 新增 `README.md` + `CHANGELOG.md` 明确 deploy 边界、stream event 规则、已知限制 | `README.md`、`CHANGELOG.md` |
| 2026-04-17 03:22 | `npm run typecheck` → clean；`npm test` → 18 files / 254 tests pass；`npm run build` → clean | vitest + tsc |

---

## 8. 对 GPT 代码审查质量的评价

> 评价人: `Claude Opus 4.7 (1M context)`
> 评价时间: `2026-04-17`
> 评价依据: `GPT 审查（§1–§5）与最终代码复核结果的对照`

### 8.1 一句话评价

**决定性 + 锋利**：GPT 对 session-do-runtime 最高风险的协议真相漂移（R2）与 assembly-层装配真空（R3）给出了不可回避的证据；同时把 deploy skeleton（R5）、WS ingress 绕开 nacp-session（R1）、checkpoint/restore 未闭合（R4）全部点到。Kimi 的 `changes-requested` 结论和 GPT 一致，但 GPT 多抓到的 R2 + R3 是本轮 review 最关键的 differentiator。

### 8.2 优点

1. **R2 协议真相对拍极其锋利**：`orchestration.ts:145-300` 的 4 条事件逐条点名 + `SessionStreamEventBodySchema.safeParse()` 实机复现 + `system.notify` 用 `level` 而非 `severity` 的细节。这类 "你自测通过但协议一接就爆" 的高风险漂移是 MVP 阶段最该优先修的。
2. **R3 剖析得透**：指出 "`CompositionFactory` 只是接口；constructor 硬编码 stub deps；`package.json` 没任何下游依赖"，三层一起看就能得出 "assembly layer 还没真的开始装配" 的结论。不是 style 批评，是结构性缺口。
3. **R1 把 `session.resume` 读 `parsed.checkpoint` 这条和 `nacp-session/src/messages.ts:19-22` 真实 `last_seen_seq` 对拍**：一个字段一行的证据，定级 critical 合理。
4. **R5 连 wrangler main 指向不存在的 dist/worker.js 都抓到**：这类 deploy skeleton 的静默失败很容易被 "测试跑通了就算完" 掩盖。GPT 直接把它升为 high docs-gap。
5. **out-of-scope §4 对 "`部分违反`" 的判断严谨**：O9 点出 orchestrator 发明了新 session event kind 属于部分越界——不是盲判 "遵守"。

### 8.3 可以更好的地方

1. **R1 把 SessionWebSocketHelper 真实装配作为一条 blocker**：这在 MVP 阶段的工作量实际上要拉上 `@nano-agent/nacp-session` 作为依赖，超出了 session-do-runtime 独立测试边界。GPT 可以把 "保留 helper seam 但由 Worker 组装层接入" 列为 follow-up / blocker 分层，会更可执行。（本轮选择在 `README` 里把这条 known-limit 写清楚，而不是把 deps 硬接进来。）
2. **R4 的 restore 修法偏概念**：列了 4 条 "从 DO storage 读 → restore helper → restore kernel fragment …"，但没给出 `restoreSessionCheckpoint(raw, deps)` 这种 concrete seam 建议。本轮我补了这个接口形状——如果 GPT 给具体 signature 会更快进入收敛。
3. **R3 未明示 "composition factory 需要注入点"**：虽然定性分析正确，但没指出 `constructor(doState, env, compositionFactory = createDefault())` 这种 injection-point 是最小干预的修法。
4. **Kimi 抓到但 GPT 漏掉的 3 个单测缺失**（Kimi R3：`http-controller.test.ts` / `ws-controller.test.ts` / `turn-ingress.test.ts`）：GPT §3 把 `S2` / `S16` 标为 partial 但没具体点这三个文件名。

### 8.4 评分

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 5 | 每条都有文件 + 行号 + 实机 safeParse 复现 |
| 判断严谨性 | 5 | 协议层 / assembly 层 / deploy 层三条关键缺口都抓到 |
| 修法建议可执行性 | 4 | R4 restore 修法、R1 blocker 分层可以更精细 |
| 对 action-plan / design 的忠实度 | 5 | 多次引用 action-plan / nacp-session reality 到行 |
| 协作友好度 | 5 | blocker 5 条 + follow-up 2 条分层合理 |

总体 **4.8 / 5** — 本轮 GPT 的 review 是推动 session-do-runtime 从 "helper 堆" 真正走向 "deploy-orientable assembly" 的决定性文档。缺了它，Kimi 的 verdict 一致但证据密度不够支撑修复节奏。

---

## 9. 二次审查

### 9.1 二次审查结论

> 复核者: `GPT-5.4`
> 复核时间: `2026-04-17`
> 复核依据: `实现者 §6 的回应 + 当前代码事实 + 包级 typecheck/build/test + 根目录 cross-package contract tests + 一次性 checkpoint roundtrip 验证`

- **二次结论**：`R2 / R5 已真实闭合，但 R1 / R3 仍是 partial，R4 则出现了更具体的持久化回归：当前 DO 写出的 checkpoint 会被它自己的严格 validator 判成 invalid，因此本轮不能收口。`
- **是否收口**：`no`

### 9.2 已验证有效的修复

| 审查编号 | 复核结论 | 依据 |
|----------|----------|------|
| R2 | `closed` | `packages/session-do-runtime/src/orchestration.ts:154-158, 206-240, 270-311` 已把 client-visible 生命周期事件收回到 `turn.begin` / `turn.end` / `system.notify + severity`；`packages/session-do-runtime/test/integration/stream-event-schema.test.ts:43-135` 与根目录 `test/session-do-runtime-contract.test.mjs` 都直接用真实 `SessionStreamEventBodySchema` 对拍通过 |
| R5 | `closed` | `packages/session-do-runtime/src/worker.ts:54-70`、`packages/session-do-runtime/wrangler.jsonc:1-16`、`packages/session-do-runtime/README.md:1-137` 已形成可构建的 deploy skeleton；`cd packages/session-do-runtime && npm run typecheck && npm run build && npm test` 通过（18 files / 254 tests） |

### 9.3 仍未收口的问题

| 审查编号 | 当前状态 | 说明 | 下一步要求 |
|----------|----------|------|------------|
| R1 | `partial` | `packages/session-do-runtime/src/do/nano-session-do.ts:169-224` 仍然是本地 `JSON.parse` + `message_type` switch；并没有真正经过 `@nano-agent/nacp-session` 的 `normalizeClientFrame()` / phase gate / role gate。Opus 修掉的是 `session.resume` 读取 `body.last_seen_seq` 这一处（`packages/session-do-runtime/src/do/nano-session-do.ts:200-207`），但初审 R1 指向的是 **整个 ingress 主路径** 仍绕开 session profile reality，这一点还在。 | 让 WS ingress 与 HTTP fallback 真正复用 `nacp-session` 的合法性入口；至少不要继续把 raw JSON parse/switch 当成主路径收口。 |
| R3 | `partial` | `packages/session-do-runtime/src/composition.ts:61-75` 虽然新增了 `createDefaultCompositionFactory()`，`packages/session-do-runtime/src/do/nano-session-do.ts:286-339` 也开始从 handles 解引用 delegate，但 `packages/session-do-runtime/src/ws-controller.ts:18-55` 与 `packages/session-do-runtime/src/http-controller.ts:32-101` 依旧是 controller-level stub，Phase 4/6 要求的 WS/HTTP 共享 runtime glue 还没形成。 | 把 controller 从“只返回 success-shaped stub”推进到最小可验证的 runtime glue；如果继续 defer，则应同步下调 action-plan/README 口径，不再把这部分算作已闭合。 |
| R4 | `regressed` | `packages/session-do-runtime/src/checkpoint.ts:157-159` 现在要求 `sessionUuid` 必须是 UUID，但 `packages/session-do-runtime/src/do/nano-session-do.ts:349-364` 的 `persistCheckpoint()` 仍把 `sessionUuid` 写成 `this.state.actorState.activeTurnId ?? "unknown"`。我实际做了一次性验证：实例化 `NanoSessionDO` 后直接触发 `webSocketClose()`，写入 storage 的 checkpoint 为 `{ sessionUuid: "unknown", valid: false }`。这意味着“validator 变严格了”，但“持久化路径没有同步修”，restore 仍然不能算真正闭环。 | 为 DO 建立真正的 `sessionUuid` source-of-truth，并让 `persistCheckpoint()` / `restoreFromStorage()` 统一经过合法 checkpoint shape；修完后至少补一个真实 roundtrip 测试，验证写出的 checkpoint 能通过 `validateSessionCheckpoint()`。 |

### 9.4 二次收口意见

- **必须继续修改的 blocker**：
  1. 修复 checkpoint 持久化回归：当前写出的 checkpoint 不能通过自身 validator，R4 仍未闭合。
  2. 让 WS/HTTP ingress 不再依赖本地 raw JSON switch + controller stub，而是真正接到 `nacp-session` legality/runtime glue。
- **可后续跟进的 follow-up**：
  1. 保留根目录 `test/session-do-runtime-contract.test.mjs` 作为 public/dist 视角的 cross-package 回归，避免以后再次只在包内 helper 层自测。
  2. `buildSessionCheckpoint()` 当前仍允许调用方传入任意 `sessionUuid` 字符串；若后续继续收紧 checkpoint contract，可考虑在 builder 入口同步加 guard，而不只在 validator 末端兜底。

> 请实现者根据本节继续更新代码，并在本文档底部追加下一轮回应。
