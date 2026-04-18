# Nano-Agent 代码审查报告

> 审查对象: `docs/action-plan/after-skeleton/A4-session-edge-closure.md` / `docs/action-plan/after-skeleton/A5-external-seam-closure.md`
> 审查时间: `2026-04-18`
> 审查人: `GPT-5.4`
> 审查范围:
> - `packages/session-do-runtime/**`
> - `packages/nacp-session/src/websocket.ts`
> - `packages/hooks/src/runtimes/service-binding.ts`
> - `packages/llm-wrapper/**`
> - `test/external-seam-closure-contract.test.mjs`
> - `docs/design/after-skeleton/P3-session-edge-closure.md`
> - `docs/design/after-skeleton/P4-external-seam-closure.md`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`A4/A5 都已经产出了一批真实的基础件，但 session edge 与 external seam 的关键“live runtime closure”仍未成立；当前不应标记为 completed。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `acceptIngress()`、HTTP fallback frame 化、binding catalog / profile / remote adapters / fake workers 这些基础件都是真实存在的，不是空壳。
  2. A4 宣称的 `SessionWebSocketHelper` 主路径闭合并未成立：helper 既没有 attach 到真实 socket，也没有接到任何 outbound stream event，因此 replay / timeline / resume 仍不是 runtime truth。
  3. A5 宣称的 remote seam closure 仍停留在 package-level adapter/factory 层：Worker/DO 默认路径没有启用 remote composition，cross-seam propagation/startup law 也没有进入真实调用主路径。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/after-skeleton/A4-session-edge-closure.md`
  - `docs/action-plan/after-skeleton/A5-external-seam-closure.md`
  - `docs/design/after-skeleton/P3-session-edge-closure.md`
  - `docs/design/after-skeleton/P4-external-seam-closure.md`
  - `docs/action-plan/after-skeleton/AX-QNA.md`
- **核查实现**：
  - `packages/session-do-runtime/src/{session-edge,turn-ingress,http-controller,ws-controller,composition,remote-bindings,cross-seam,worker}.ts`
  - `packages/session-do-runtime/src/do/nano-session-do.ts`
  - `packages/nacp-session/src/websocket.ts`
  - `packages/hooks/src/runtimes/service-binding.ts`
  - `packages/session-do-runtime/test/{do,remote-bindings,composition-profile,integration}/**`
  - `packages/hooks/test/runtimes/service-binding.test.ts`
  - `packages/llm-wrapper/test/integration/fake-provider-worker.test.ts`
  - `test/external-seam-closure-contract.test.mjs`
- **执行过的验证**：
  - `pnpm --filter @nano-agent/session-do-runtime test`
  - `pnpm --filter @nano-agent/session-do-runtime typecheck && pnpm --filter @nano-agent/session-do-runtime build`
  - `pnpm --filter @nano-agent/hooks test && pnpm --filter @nano-agent/hooks typecheck && pnpm --filter @nano-agent/hooks build`
  - `pnpm --filter @nano-agent/capability-runtime test && pnpm --filter @nano-agent/capability-runtime typecheck && pnpm --filter @nano-agent/capability-runtime build`
  - `pnpm --filter @nano-agent/llm-wrapper test && pnpm --filter @nano-agent/llm-wrapper typecheck && pnpm --filter @nano-agent/llm-wrapper build`
  - `pnpm --filter @nano-agent/nacp-core test`
  - `npm run test:cross`
  - `rg 'pendingInputs' packages/session-do-runtime/src --glob '**/*.ts'`
  - `rg '\\.pushEvent\\(' packages --glob 'src/**/*.ts'`
  - `rg 'makeRemoteBindingsFactory|createDefaultCompositionFactory\\(' packages --glob 'src/**/*.ts'`

### 1.1 已确认的正面事实

- `packages/session-do-runtime/src/session-edge.ts` 已引入 `acceptIngress()`，并在 `packages/session-do-runtime/src/do/nano-session-do.ts:282-297` 由 WS/HTTP 共用；raw `message_type` legality 不再直接写在 DO 边界层。
- `packages/session-do-runtime/src/http-controller.ts:140-237` 已把 `start/input/cancel/end/status/timeline` 做成真实 action surface：`start/input/cancel` 构造 client frame，`end` 在 host 存在时返回 `405`，`status/timeline` 走 host seam。
- `packages/session-do-runtime/src/env.ts`、`composition.ts`、`remote-bindings.ts`、`cross-seam.ts`、`packages/hooks/src/runtimes/service-binding.ts` 以及三类 fake worker fixtures 都真实存在；相关 package tests/build/typecheck 当前为绿色。

### 1.2 已确认的负面事实

- `packages/session-do-runtime/src/do/nano-session-do.ts:318-328` 只会把 follow-up input 追加进 `pendingInputs`；对 `packages/session-do-runtime/src` 的全文检索显示，除 state 定义与这里的 append 之外再无任何消费/出队逻辑。
- `packages/nacp-session/src/websocket.ts:97-158` 的 replay/send 主路径是 `SessionWebSocketHelper.pushEvent()`，但全仓 `src/**/*.ts` 中没有任何 `.pushEvent(` use-site；同时 `packages/session-do-runtime/src/do/nano-session-do.ts:188-193,349-363,648-653` 却把 timeline / resume / checkpoint 都建立在 helper replay state 之上。
- `packages/session-do-runtime/src/do/nano-session-do.ts:129-155` 默认仍使用 `createDefaultCompositionFactory()`；`packages/session-do-runtime/src/worker.ts:73-87` 只是把请求转发给 DO，没有注入 `makeRemoteBindingsFactory()`；而 `packages/session-do-runtime/src/remote-bindings.ts:241-250` 返回的 remote handles 是 `{ serviceBindingTransport } / { fetcher }`，`packages/session-do-runtime/src/do/nano-session-do.ts:603-620` 的 runtime 依赖却只消费 `hooks.emit` 与 `kernel.pushStreamEvent`。
- `packages/session-do-runtime/src/cross-seam.ts:7-21,45-75` 明确要求每个 cross-worker call 都携带 anchor headers，但 `packages/session-do-runtime/src/remote-bindings.ts:56-61` 的实际请求头只有 `content-type`；全文检索也显示 `buildCrossSeamHeaders` / `StartupQueue` 在 `src/` 里没有任何运行时 use-site。

---

## 2. 审查发现

### R1. `pendingInputs` 只有入队、没有出队，A4 的 single-active-turn widened ingress 只完成了一半

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `packages/session-do-runtime/src/do/nano-session-do.ts:318-328` 在 `turn_running` 时把 `session.start / session.followup_input` 追加到 `pendingInputs`。
  - `packages/session-do-runtime/src/actor-state.ts:24-30` 仅定义了 `pendingInputs` 字段；对 `packages/session-do-runtime/src/**/*.ts` 的检索结果显示，没有任何后续 drain / dequeue / replay 逻辑。
  - `packages/session-do-runtime/test/do/nano-session-do.test.ts:366-387` 只断言 “turnCount 增加 **或** pendingInputs.length 增加”，并没有守住“队列最终会被消费”。
- **为什么重要**：
  - A4 的 DoD 明确要求 widened ingress 在 runtime 中服从 single-active-turn invariant，而不是把 follow-up family 卡在“能接收但不会执行”的死队列状态（`docs/action-plan/after-skeleton/A4-session-edge-closure.md:434-438,444-448`）。
  - 当前实现不是“暂时不支持 richer queue semantics”，而是连最小的 “先排队、后执行下一个 turn” 都没有闭合；这会让 follow-up input 表面合法、实际丢在 actor state 中。
- **审查判断**：
  - A4 对 widened input family 的 runtime 消费仍是 `partial`，不能按 “single-active-turn closure 已完成” 记账。
- **建议修法**：
  - 在 `turn.end` / `cancel` / `resume` 后加入明确的 pending-input drain 规则，最小也要支持 FIFO 消费一个下一输入。
  - 为 `turn_running → queue → current turn end → next turn start` 增加 integration test，不再接受 “turnCount 或 pendingInputs 任一增加即可” 这种弱断言。

### R2. `SessionWebSocketHelper` 没有成为真实 WS/replay 主路径，A4 的 replay/timeline/resume 结论不成立

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `packages/nacp-session/src/websocket.ts:97-158` 规定 helper 的真实 replay/send 主路径是 `pushEvent()`；它负责 append replay、向 socket 发送 frame、并维护 ack window。
  - 对全仓 `src/**/*.ts` 的检索没有任何 `.pushEvent(` use-site；`packages/session-do-runtime/src/do/nano-session-do.ts:616-620` 也只是把 `pushStreamEvent` 转发给 `handles.kernel.pushStreamEvent`，没有把 session stream 送进 helper。
  - `packages/session-do-runtime/src/do/nano-session-do.ts:188-193` 的 HTTP `timeline` 读取 helper replay buffer；`:349-363` 的 `session.resume` 依赖 helper `restore + handleResume`；`:648-653` 的 checkpoint 也只保存 helper replay state。
  - 对全仓 `src/**/*.ts` 的检索也没有任何 `SessionWebSocketHelper.attach(...)` use-site；`packages/session-do-runtime/src/do/nano-session-do.ts:721-758` 只 `ensureWsHelper()` 并 `acceptWebSocket(pair[1])`，没有把 socket attach 给 helper。
- **为什么重要**：
  - A4 自己的整体收口标准把 “helper 承担 replay/ack/heartbeat/checkpoint/restore 的真实主路径责任” 列为硬条件（`docs/action-plan/after-skeleton/A4-session-edge-closure.md:434-438`）。
  - 现在 helper 既没接到 outbound session stream，也没 attach 到真实 socket；这意味着 `timeline` / `resume replay` / `ack backpressure` 读的不是 live runtime 事实，而只是一个从未真正承载输出的空缓冲。
- **审查判断**：
  - A4 Phase 2/3 的 helper assembly 只完成了“对象存在、接口被调用”的表层接线，离“shared WS replay truth”还有核心断点。
- **建议修法**：
  - 明确把 session stream emission 收敛到 helper：DO 的 client-visible `session.stream.event` 统一经 `helper.pushEvent()` 发出，而不是旁路 kernel handle。
  - 在 WebSocket upgrade path 中把实际 socket attach 给 helper。
  - 增加真实 integration test：HTTP `timeline` 必须能读到由 runtime 发出的 stream events；`session.resume(last_seen_seq)` 必须能重放这些 events。

### R3. A5 的 remote seam 仍未进入 live runtime path：默认 Worker/DO 仍是 local/no-op，remote handles 也没有被消费

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `packages/session-do-runtime/src/do/nano-session-do.ts:126-155` 的 constructor 默认参数仍是 `createDefaultCompositionFactory()`。
  - `packages/session-do-runtime/src/composition.ts:90-105` 的默认 factory 即便解析出 `profile.remote`，返回的也仍是 `kernel/llm/capability/workspace/hooks/eval/storage = undefined`。
  - `packages/session-do-runtime/src/worker.ts:73-87` 只是 forward request 到 DO stub，没有任何 `makeRemoteBindingsFactory()` 注入点。
  - `packages/session-do-runtime/src/remote-bindings.ts:241-250` 返回的 remote handles 形状是 `{ serviceBindingTransport }` 和 `{ fetcher }`；但 `packages/session-do-runtime/src/do/nano-session-do.ts:603-620` 只消费 `hooks.emit` 与 `kernel.pushStreamEvent`，对 `serviceBindingTransport` / `fetcher` 没有 use-site。
  - 对 `packages/session-do-runtime/src/**/*.ts` 的检索也没有 `new ServiceBindingRuntime`、`new CapabilityExecutor`、`new LLMExecutor` 等把这些 remote handles 装配进 runtime 的代码。
- **为什么重要**：
  - A5 的 charter 不是“包里有几个 adapter”而已，而是把 external seam 从 package-level seam 推进到 “runtime 中可装配、可测试、可交接的真实 worker seam”（`docs/action-plan/after-skeleton/A5-external-seam-closure.md:458-462,468-472,488`）。
  - 当前状态下，即便 wrangler 配上 `HOOK_WORKER / CAPABILITY_WORKER / FAKE_PROVIDER_WORKER`，默认 deployed path 也不会真正使用它们；A6 无法直接继承一个可运行的 remote composition baseline。
- **审查判断**：
  - A5 的 binding catalog / profile / adapter 层是真实进展，但 “session runtime 可装配的真实 remote seam” 仍然只是 `partial`。
- **建议修法**：
  - 给 Worker/DO 默认装配路径补一个 profile-aware composition entry，确保 env binding presence 能真正切到 remote factory。
  - 同时把 remote handles bridge 到真实 runtime use-site：hook 走 `ServiceBindingRuntime`，capability/provider 至少进入 DO 组装层，而不是只停在 factory 输出对象。

### R4. A5 的 cross-seam propagation/startup law 仍是 dead code：实际 remote 请求没有带 anchor，`StartupQueue` 也未进入运行时

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `packages/session-do-runtime/src/cross-seam.ts:7-21,45-75` 明确写着 “every cross-worker call must carry the same trace + tenant + request anchor”。
  - `packages/session-do-runtime/src/remote-bindings.ts:56-61` 构造 Request 时的 headers 只有 `{ "content-type": "application/json" }`；全文检索显示 `buildCrossSeamHeaders` / `readCrossSeamHeaders` 在 `src/` 内没有任何 use-site。
  - `packages/session-do-runtime/src/cross-seam.ts:206-260` 定义了 `StartupQueue<T>`；但对 `packages/**/src/**/*.ts` 的检索显示，它没有任何 runtime use-site，只在 root contract test 中被直接 new 出来。
  - `test/external-seam-closure-contract.test.mjs:69-89,177-199` 只验证 helper/API 自身，而没有验证真实 remote-binding 请求是否带 header，或 early events 是否真的走 queue。
- **为什么重要**：
  - A5 把 cross-seam trace/tenant/error law 视为主交付之一（`docs/action-plan/after-skeleton/A5-external-seam-closure.md:458-462`）；如果真实请求根本不带 anchor，P4 的“trace-first external seam”就还没有发生。
  - 这不是“补点 observability”那么轻：没有 `traceUuid/sessionUuid/teamUuid/requestUuid` 传播，remote worker 的日志/trace 将天然断链；`StartupQueue` 不进入 runtime，则 early event 不 silent vanish 的承诺也只是纸面存在。
- **审查判断**：
  - 当前 A5 已经冻结了 law vocabulary，但没有把 law 接入 transport/runtime；因此这块只能判 `partial`，不能按“统一 cross-seam law 已落地”结案。
- **建议修法**：
  - 在 `callBindingJson()` 或各 seam adapter 中强制接入 `buildCrossSeamHeaders()`，并在 fake worker/contract tests 中校验 header propagation。
  - 只有在 runtime 确实存在 early-event buffering 需求的路径上接入 `StartupQueue`；如果暂时不接，就应把 A5/P4 文档口径降级为 utility-only，而不是 runtime closure。

### R5. A4/A5 的测试与执行文档对“已收口”有明显过度表述，当前更像 package-local primitives 完成，而不是 live runtime closure 完成

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `packages/session-do-runtime/test/integration/ws-http-fallback.test.ts:95-161` 仍主要在直接实例化 `WsController` / `HttpController` 或手动调用 `actor-state` transition；它没有覆盖 `NanoSessionDO.fetch() + HttpDispatchHost + shared timeline` 的真实装配路径。
  - `packages/session-do-runtime/test/http-controller.test.ts:36-54` 主要守的是无 host stub 行为；`packages/session-do-runtime/test/do/nano-session-do.test.ts:366-387` 对 single-active-turn 只做弱断言。
  - `packages/session-do-runtime/test/remote-bindings.test.ts:133-198` 与 `test/external-seam-closure-contract.test.mjs:91-219` 主要验证 adapter/factory/fixture round-trip，并没有证明 session runtime 真正消费 remote handles。
  - 但 `docs/design/after-skeleton/P3-session-edge-closure.md:413-425`、`docs/action-plan/after-skeleton/A4-session-edge-closure.md:528-533`、`docs/design/after-skeleton/P4-external-seam-closure.md:450-463`、`docs/action-plan/after-skeleton/A5-external-seam-closure.md:558-563` 都把 A4/A5 写成“全部前提 / 全部功能 / 可交付性已收口”。
- **为什么重要**：
  - A4/A5 是 after-skeleton 中间最关键的 runtime phases；如果 execution log 和 design appendix 把 package-local adapter completion 写成 runtime closure，会直接误导 A6/A7 的验证输入。
  - 当前绿测主要证明 “局部 primitives 自洽”，还没有证明 “DO runtime / service-binding runtime 真正闭环”。这类 overclaim 会把 review gate 变成装饰。
- **审查判断**：
  - 文档与测试证据包需要回收到与代码事实一致的等级；否则 A4/A5 会重复 A1/A2/A3 的 exit-pack 问题。
- **建议修法**：
  - 把 P3/P4 附录 B 与 A4/A5 §11.4 的结论降级为 `partial closure`，明确区分“已落地 primitives”和“尚未进入 live runtime path 的 seam”。
  - 增补真正的 integration tests：A4 至少覆盖 DO+HTTP fallback timeline/replay；A5 至少覆盖 Worker/DO 默认路径消费 remote factory 与 remote handles。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | A4 normalized ingress / legality convergence | `done` | `acceptIngress()` 已成为 WS/HTTP 共用的 ingress gate，raw parse/switch legality 主路径已下线。 |
| S2 | A4 `SessionWebSocketHelper` real assembly | `partial` | helper 已被构造并参与 resume/ack/checkpoint API，但没有 attach socket、没有接到 outbound stream event。 |
| S3 | A4 HTTP fallback shared actor/timeline truth | `partial` | `HttpController` 已成为真实 fallback surface，但 `timeline` 依赖的 helper replay 不是 live stream truth，相关 integration coverage 也不足。 |
| S4 | A4 widened ingress 下的 single-active-turn closure | `partial` | follow-up input 已能被接收入队，但当前没有任何 drain/next-turn 执行闭环。 |
| S5 | A4 edge trace / health / recovery closure | `partial` | `session.edge.attach/detach/resume` trace 已存在，但 replay/health/checkpoint/restore 的“真实主路径收口”没有成立。 |
| S6 | A5 binding catalog + composition profile freeze | `done` | `CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER`、reserved skill seam、profile resolution 都已落地。 |
| S7 | A5 hook / capability remote seam closure | `partial` | remote adapters/runtimes 已存在，但 session runtime 默认路径没有消费 remote handles。 |
| S8 | A5 fake provider seam + LLM delegate closure | `partial` | fake provider worker 与 fetcher adapter 已存在，但尚未进入 Worker/DO live composition path。 |
| S9 | A5 cross-seam propagation / failure / startup closure | `partial` | taxonomy/header/startup queue vocabulary 已冻结，但 propagation 与 queue 仍未进入真实 transport/runtime。 |
| S10 | A5 evidence/docs/P5 handoff pack | `partial` | tests/build 绿色，但它们主要证明 package-local primitives；design/action-plan 对 runtime closure 有过度表述。 |

### 3.1 对齐结论

- **done**: `2`
- **partial**: `8`
- **missing**: `0`

这更像 **“A4/A5 的基础件和 vocabulary 已经搭起来了，但关键 live runtime glue 仍未收口”**，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | skill worker 进入 v1 binding catalog | `遵守` | `SKILL_WORKERS` 仍只作为 reserved seam，没有被偷带进 v1 catalog。 |
| O2 | richer queue / replace / merge 多轮调度语义 | `遵守` | 代码没有越界实现 richer queue semantics；问题在于最小 drain 也未闭合，而不是 scope creep。 |
| O3 | 破坏 local reference path、强制全部 remote 化 | `遵守` | local/reference path 仍然保留；当前问题是 remote path 没真正接上，而不是越界删除 local path。 |
| O4 | 在 A5 内直接做 real provider smoke / deploy verification | `遵守` | A5 仍停留在 fake worker / adapter / contract 层，没有越界抢 A6 的 verification gate。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`A4/A5 当前不收口；normalized ingress 与 binding-catalog primitives 已成立，但 helper replay/timeline、single-active-turn drain、remote composition、cross-seam propagation 这四条关键 runtime glue 仍有 blocker。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 补齐 A4 的 queued follow-up drain path，并用 integration test 证明 `turn_running → queue → next turn` 真实发生。
  2. 让 `SessionWebSocketHelper` 成为真实 outbound WS/replay 主路径：attach socket、经 helper 发送/缓存 session stream event，并证明 HTTP timeline / WS resume 读取到这些 event。
  3. 把 A5 remote composition 接入 live Worker/DO path，并把 remote handles bridge 到真实 hook/capability/provider use-site，而不是只停在 factory/adapters。
  4. 在真实 remote 请求上接入 `CrossSeamAnchor` propagation（至少 header stamping/reading/validation），并决定 `StartupQueue` 是接入 runtime 还是正式降级为 utility-only；同步回收 P3/P4/A4/A5 的过度收口表述。
- **可以后续跟进的 non-blocking follow-up**：
  1. 调整 A4/A5 的 integration coverage，避免继续由 controller-stub / factory-roundtrip tests 充当 runtime closure evidence。
  2. 统一根级 cross-test 入口与手工 contract-test 入口的说明，减少 future review 再次误读 coverage 面。

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。
