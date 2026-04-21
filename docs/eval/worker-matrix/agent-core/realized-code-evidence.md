# agent.core — realized code evidence

> 目标：只基于**当前仓库代码与当前测试**，回答 `agent.core` 已经实现了什么、还缺什么、哪些只是 handle。

---

## 0. 先给结论

**`agent.core` 现在最准确的代码判断是：已有真实 host shell，已有真实 session ingress / orchestration / checkpoint / replay / hook / evidence 骨架，但默认装配仍未把 `KernelRunner + LLMExecutor + capability/workspace` 接成真正的 agent turn loop。**

也就是说，它已经不是 greenfield；但它也还不是“默认可发布的完整 agent”。

---

## 1. 原始素材召回表

### 1.1 host 核心代码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| Worker entry | `packages/session-do-runtime/src/worker.ts` | `55-88` | 证明 Worker entry 已存在且是薄壳 |
| DO host | `packages/session-do-runtime/src/do/nano-session-do.ts` | `130-280, 466-715, 906-1124` | 证明真实宿主、ingress、dispatch、checkpoint、tenant、evidence 均已存在 |
| composition | `packages/session-do-runtime/src/composition.ts` | `82-106` | 证明默认 composition 仍返回空柄 |
| remote composition | `packages/session-do-runtime/src/remote-bindings.ts` | `330-397` | 证明 remote seams 已存在，但 kernel/workspace/eval/storage 未接 |
| runtime env | `packages/session-do-runtime/src/env.ts` | `55-121` | 证明 runtime catalog 与 profile switch 已存在 |
| HTTP fallback | `packages/session-do-runtime/src/http-controller.ts` | `127-237` | 证明 host 的 HTTP action surface 真实存在 |
| orchestrator | `packages/session-do-runtime/src/orchestration.ts` | `55-96, 132-220` | 证明 Session orchestration 是真实代码而不是概念图 |

### 1.2 现成子系统代码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| kernel | `packages/agent-runtime-kernel/src/runner.ts` | `35-111, 133-220` | 证明 `KernelRunner` 已真实实现 |
| llm | `packages/llm-wrapper/src/executor.ts` | `44-198` | 证明 `LLMExecutor` 已真实实现 |
| hooks remote runtime | `packages/hooks/src/runtimes/service-binding.ts` | `34-153` | 证明 remote hooks seam 已真实实现 |

### 1.3 直接证明行为的测试

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| worker 路由 | `packages/session-do-runtime/test/worker.test.ts` | `30-65` | 证明 Worker entry 确实在按 `/sessions/:id/...` 转发 |
| remote composition | `packages/session-do-runtime/test/integration/remote-composition-default.test.ts` | `16-85` | 证明默认 remote hook/capability 选择路径是真实存在的 |
| stream schema | `packages/session-do-runtime/test/integration/stream-event-schema.test.ts` | `43-135` | 证明 orchestrator 输出能被 `SessionStreamEventBodySchema` 直接消费 |
| checkpoint | `packages/session-do-runtime/test/integration/checkpoint-roundtrip.test.ts` | `47-114` | 证明 checkpoint roundtrip 真实成立 |
| upstream context contract | `test/initial-context-schema-contract.test.mjs` | `13-68` | 证明 `initial_context` wire hook 已冻结 |
| tenant plumbing | `test/tenant-plumbing-contract.test.mjs` | `46-218` | 证明 tenant ingress / tenant key prefix / raw storage white-list 的核心 contract 已锁 |

---

## 2. 已经真实存在的 host shell

## 2.1 Worker entry 已存在，而且故意很薄

当前 `worker.ts` 的核心行为只有：

```ts
const route = routeRequest(request);
if (route.type === "not-found") return 404;
const sessionId = extractSessionId(request);
const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId));
return stub.fetch(request);
```

见：`packages/session-do-runtime/src/worker.ts:72-88`

这说明两件事：

1. `agent.core` 的外层 Worker 壳已经存在；
2. 当前设计明确把“真正的 runtime”放在 DO 里，而不是在 Worker entry 写业务主链。

## 2.2 `NanoSessionDO` 已经是 load-bearing host

`NanoSessionDO` 构造函数里已经包含这些真实职责：

- 选择 composition factory；
- 组装 subsystems；
- 安装默认 eval sink；
- 装配 workspace composition；
- 装配 orchestrator、HTTP controller、WS controller；
- 维护 session UUID、trace UUID、stream seq、heartbeat/ack tracker：`packages/session-do-runtime/src/do/nano-session-do.ts:130-280`。

这意味着当我们说 `agent.core` 时，当前仓库中的真实物体就是：

> **`packages/session-do-runtime/src/do/nano-session-do.ts::NanoSessionDO`**

而不是某个未来要新建的 `AgentHostWorker` 类。

---

## 3. 已经真实存在的 session host path

## 3.1 client ingress 已经走正式 session profile，而不是手搓 JSON

当前 WS 主路径是：

1. `webSocketMessage()` 收 raw；
2. `acceptClientFrame(raw)`；
3. `acceptIngress(...)`；
4. `normalizeClientFrame(...)`；
5. `validateSessionFrame(...)`；
6. `await verifyTenantBoundary(...)`；
7. `dispatchAdmissibleFrame(...)`。

关键代码位点：

- `packages/session-do-runtime/src/do/nano-session-do.ts:466-533`
- `packages/nacp-session/src/ingress.ts:25-74`
- `packages/nacp-session/src/frame.ts:66-136`

这意味着 `agent.core` 当前不是“自己 parse 一下 JSON 再说”，而是已经有正式 session ingress 闸口。

## 3.2 session lifecycle orchestration 已经是真实代码

`SessionOrchestrator` 不是空壳：

- `startTurn()` 会发 `Setup / SessionStart / UserPromptSubmit` hooks，并推进 actor phase：`packages/session-do-runtime/src/orchestration.ts:171-220`
- `advanceStep` / `emitTrace` / `pushStreamEvent` 都通过 `OrchestrationDeps` 连接子系统：`packages/session-do-runtime/src/orchestration.ts:55-96`

而 `NanoSessionDO.buildOrchestrationDeps()` 已经把 host-side glue 接起来：

- `emitHook(...)` 透传 cross-seam anchor；
- `emitTrace(...)` 经过 eval sink；
- `pushStreamEvent(...)` 优先走 `SessionWebSocketHelper.pushEvent(...)`：`packages/session-do-runtime/src/do/nano-session-do.ts:906-1005`。

所以“host 负责 turn orchestration”这件事，已经是代码真相。

## 3.3 replay / ack / heartbeat / checkpoint 已经接进宿主

`dispatchAdmissibleFrame()` 当前已经真正处理：

- `session.resume`
- `session.stream.ack`
- `session.heartbeat`

见：`packages/session-do-runtime/src/do/nano-session-do.ts:662-709`

而 `wsHelperStorage()`、`persistCheckpoint()`、`restoreFromStorage()` 也已经存在：`packages/session-do-runtime/src/do/nano-session-do.ts:1042-1124`。

对应 roundtrip test 也在证明 checkpoint 不是写着玩的：`packages/session-do-runtime/test/integration/checkpoint-roundtrip.test.ts:47-114`。

因此如果只问“host 壳、session actor、checkpoint/replay 是否存在”，答案是：

> **存在，而且已经不是 stub。**

---

## 4. 已经接通的 remote seam 与 evidence seam

## 4.1 local/remote profile switch 已存在

`env.ts` 已定义：

- `CAPABILITY_WORKER`
- `HOOK_WORKER`
- `FAKE_PROVIDER_WORKER`
- `CompositionProfile = { capability, hooks, provider }`

并提供 `readCompositionProfile()`：`packages/session-do-runtime/src/env.ts:55-121`

这证明 host 侧对 local/remote seam 的 profile switch 已不是文档概念。

## 4.2 remote hooks / capability / fake-provider seam 已存在

`makeRemoteBindingsFactory()` 当前能根据 env 组出：

- remote hooks handle；
- capability transport；
- provider fetcher；

见：`packages/session-do-runtime/src/remote-bindings.ts:330-397`

对应 remote hook 行为也被 integration test 证明：

- 有 `HOOK_WORKER` 时，`emitHook` 会真的打到 fake binding：`packages/session-do-runtime/test/integration/remote-composition-default.test.ts:28-63`
- 只有 `CAPABILITY_WORKER` 时，会真的暴露 capability transport：`packages/session-do-runtime/test/integration/remote-composition-default.test.ts:65-84`

## 4.3 evidence sink 已经不是 test-only 幻觉

`NanoSessionDO` 构造函数现在会在 factory 没提供 `eval` 时，自动安装 bounded in-memory default sink：`packages/session-do-runtime/src/do/nano-session-do.ts:148-174, 256-280`

而 `persistCheckpoint()` 还会通过 `workspaceComposition.captureSnapshot()` 触发 `snapshot.capture` evidence：`packages/session-do-runtime/src/do/nano-session-do.ts:1061-1072`

这意味着：

> 当前 host 至少已经进入“默认路径也会产 evidence”的阶段，而不是只有测试工厂才看得见 evidence。

---

## 5. 当前仍然只是 handle，而不是默认主链的部分

## 5.1 默认 composition 仍然是空柄

`createDefaultCompositionFactory()` 目前返回的是：

```ts
return {
  kernel: undefined,
  llm: undefined,
  capability: undefined,
  workspace: undefined,
  hooks: undefined,
  eval: undefined,
  storage: undefined,
  profile,
};
```

见：`packages/session-do-runtime/src/composition.ts:90-106`

这几乎是判断 `agent.core` 当前 readiness 的单一最重要证据。

## 5.2 remote composition 也没有把 kernel / workspace / eval / storage 接进去

`makeRemoteBindingsFactory()` 现在虽然比 default factory 前进很多，但返回值依然是：

```ts
return {
  kernel: undefined,
  llm: providerFetcher ? { fetcher: providerFetcher } : undefined,
  capability: capabilityTransport ? { serviceBindingTransport: capabilityTransport } : undefined,
  workspace: undefined,
  hooks: hooksHandle,
  eval: undefined,
  storage: undefined,
  profile,
};
```

见：`packages/session-do-runtime/src/remote-bindings.ts:385-395`

所以当前最准确的说法不是“remote factory 已把主链打通”，而是：

> **它已经把 3 条 remote transport seam 组出来了，但主链上的 `kernel/workspace/eval/storage` 仍未默认接通。**

## 5.3 `buildOrchestrationDeps()` 对“没有 kernel”采取 honest degrade，而不是 fatal

当前 host 在没有 kernel 的情况下，会这样降级：

```ts
if (kernel?.advanceStep) return kernel.advanceStep(snapshot, signals);
return { snapshot, events: [], done: true };
```

见：`packages/session-do-runtime/src/do/nano-session-do.ts:910-921`

这说明：

1. 当前 host shell 允许 standalone / empty composition 跑起来；
2. 但这也意味着默认路径并不代表“真实 agent loop 已闭合”。

---

## 6. 明明已经存在、但还未装进默认 host 的子系统

## 6.1 `KernelRunner` 已真实存在

`KernelRunner` 当前已经能：

- 调 scheduler；
- 做 `llm_call / tool_exec / compact / wait / finish / hook_emit`；
- 产出 runtime events；

见：`packages/agent-runtime-kernel/src/runner.ts:35-111, 133-220`

因此 host 侧“没有 kernel”绝不是因为仓库里没有 kernel，而只是因为 composition 还没实例化它。

## 6.2 `LLMExecutor` 已真实存在

`LLMExecutor` 当前已经能：

- 发 chat/completions；
- 管 timeout / retry / exponential backoff；
- 处理 `Retry-After`；
- 做 stream normalization；

见：`packages/llm-wrapper/src/executor.ts:44-198`

所以 host 侧“没有 llm”也不是因为仓库里没有 llm 层，而只是因为它还没被装到 `subsystems.llm` 里。

## 6.3 `initial_context` 只有 wire hook，没有消费实现

虽然 root contract test 已锁住 `SessionStartInitialContextSchema`：`test/initial-context-schema-contract.test.mjs:13-68`，但 host dispatch 现在只抽 turn input：`packages/session-do-runtime/src/do/nano-session-do.ts:612-645`。

所以这条必须诚实记录为：

| 项目 | 当前状态 |
|---|---|
| `initial_context` schema | 已冻结 |
| `initial_context` host consumer | 未实现 |

---

## 7. “历史 review”与“当前代码真相”的交叉判断

| 议题 | 历史 review 常见印象 | 当前代码真相 | 这里的判断 |
|---|---|---|---|
| tenant verify | 还停留在 fire-and-forget | 已变成 `await verifyTenantBoundary(...)` gate：`packages/session-do-runtime/src/do/nano-session-do.ts:487-533` | 以当前代码为准 |
| host evidence | 默认路径不产 evidence | 默认构造已安装 bounded sink，checkpoint 还会触发 snapshot evidence：`packages/session-do-runtime/src/do/nano-session-do.ts:148-174, 256-280, 1061-1072` | 以当前代码为准 |
| agent loop | host 已经是完整 agent | `KernelRunner` 与 `LLMExecutor` 虽然存在，但 default/remote factory 仍未装配：`packages/session-do-runtime/src/composition.ts:90-106`; `packages/session-do-runtime/src/remote-bindings.ts:385-395` | **不能过度宣称** |

---

## 8. 本文件的最终判断

如果只基于当前代码来下结论，`agent.core` 最准确的表述是：

> **一个已经存在的 session host runtime，具备真实 Worker/DO/ingress/orchestration/replay/checkpoint/remote seam/evidence 壳，但默认 composition 仍未把 kernel、llm、workspace 与 capability 主链装配成完整 agent。**

所以 worker-matrix 阶段对 `agent.core` 的主任务，应理解为 **assembly / wiring / closure**，而不是 **greenfield implementation**。
