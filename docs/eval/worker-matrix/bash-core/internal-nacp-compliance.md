# bash.core — internal NACP compliance

> 目标：定义 `bash.core` 今天真正拥有、并且必须继续遵守的 **`tool.call.* / requestId / cancel / progress / policy / no-silent-success`** 内部契约。

---

## 0. 先给结论

**`bash.core` 不是 `session.*` 协议 owner；它今天真正拥有的 internal protocol responsibility，是：**

1. **对上游 host / remote transport**，它必须与 `@nano-agent/nacp-core` 的 `tool.call.request / response / cancel` body family 对齐；
2. **对自己**，它必须把 `requestId / cancel / timeout / progress / terminal result` 执行成一套稳定 capability lifecycle；
3. **对 LLM-facing fake-bash surface**，它必须坚持 `no-silent-success + policy truth + narrow bash path`，而不能为了更像 shell 去偷偷放宽 contract。

---

## 1. 原始素材召回表

### 1.1 原始文档

| 类型 | 原始路径 | 关键行 / 章节 | 用途 |
|---|---|---|---|
| evaluation | [`docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`](../../../eval/after-foundations/worker-matrix-eval-with-GPT.md) | `317-346` | 说明 `bash.core` 的价值在 transport/policy/workspace boundary，而不是 full shell |
| evaluation | [`docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`](../../../eval/after-foundations/worker-matrix-eval-with-Opus.md) | `218-224` | 说明 `bash.core` Phase 8.A 的核心是 fetch handler + `ServiceBindingTarget` 接线 |
| design | [`docs/design/after-foundations/P2-fake-bash-extension-policy.md`](../../../design/after-foundations/P2-fake-bash-extension-policy.md) | `49-60,74-91,174-193,241-248` | 说明 fake-bash 的 contract 是受控 capability layer，不是 shell runtime |
| value analysis | [`docs/eval/vpa-fake-bash-by-GPT.md`](../../../eval/vpa-fake-bash-by-GPT.md) | `67-95` | 说明 fake-bash 的正确定位是 bash-compatible surface + capability-native runtime |

### 1.2 协议源码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| tool schemas | [`packages/nacp-core/src/messages/tool.ts`](../../../../packages/nacp-core/src/messages/tool.ts) | `4-17,19-30,32-36` | 证明 `tool.call.request/response/cancel` 的 body shape 与 allowed producer roles |
| core direction matrix | [`packages/nacp-core/src/type-direction-matrix.ts`](../../../../packages/nacp-core/src/type-direction-matrix.ts) | `17-24` | 证明 `tool.call.request/cancel = command`，`tool.call.response = response/error` |
| envelope validator | [`packages/nacp-core/src/envelope.ts`](../../../../packages/nacp-core/src/envelope.ts) | `279-359` | 证明 body validation 与 role gate 仍属于 envelope transport 层 |

### 1.3 `bash.core` 相关实现源码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| tool-call bridge | [`packages/capability-runtime/src/tool-call.ts`](../../../../packages/capability-runtime/src/tool-call.ts) | `1-15,20-37,64-87,89-160` | 证明 capability-runtime 只负责 `tool.call.*` body bridge，不负责 envelope framing |
| executor | [`packages/capability-runtime/src/executor.ts`](../../../../packages/capability-runtime/src/executor.ts) | `22-68,71-119,121-239,242-320` | 证明 requestId / policy / cancel / timeout / streaming lifecycle |
| event kinds | [`packages/capability-runtime/src/events.ts`](../../../../packages/capability-runtime/src/events.ts) | `1-25` | 证明 internal capability event kinds 已冻结 |
| result kinds | [`packages/capability-runtime/src/result.ts`](../../../../packages/capability-runtime/src/result.ts) | `9-37` | 证明 terminal result kinds 与 inline/promotion boundary |
| service-binding target | [`packages/capability-runtime/src/targets/service-binding.ts`](../../../../packages/capability-runtime/src/targets/service-binding.ts) | `40-84,90-215` | 证明 remote roundtrip 对 `tool.call.*` body、progress、cancel 的承诺 |
| bridge | [`packages/capability-runtime/src/fake-bash/bridge.ts`](../../../../packages/capability-runtime/src/fake-bash/bridge.ts) | `17-20,46-80,82-167` | 证明 fake-bash 入口的 no-silent-success contract |
| planner | [`packages/capability-runtime/src/planner.ts`](../../../../packages/capability-runtime/src/planner.ts) | `130-248,257-311` | 证明 bash path narrow law 与 structured tool path 并存 |
| policy gate | [`packages/capability-runtime/src/policy.ts`](../../../../packages/capability-runtime/src/policy.ts) | `17-48` | 证明 allow / ask / deny 决策来源 |

### 1.4 runtime seam / tests

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| capability binding seam | [`packages/session-do-runtime/src/remote-bindings.ts`](../../../../packages/session-do-runtime/src/remote-bindings.ts) | `329-390` | 证明 host 侧 remote capability seam 只暴露 `serviceBindingTransport` |
| bridge tests | [`packages/capability-runtime/test/fake-bash-bridge.test.ts`](../../../../packages/capability-runtime/test/fake-bash-bridge.test.ts) | `41-77,79-134,197-227` | 证明 no-executor / unsupported / bash-narrow 都以 structured error 收口 |
| service-binding tests | [`packages/capability-runtime/test/integration/service-binding-transport.test.ts`](../../../../packages/capability-runtime/test/integration/service-binding-transport.test.ts) | `72-90,92-136,167-216,218-255` | 证明 `not-connected` / progress / cancel / requestId patching 都已锁定 |

---

## 2. `bash.core` 不拥有 `session.*`；它拥有的是 `tool.call.*`

### 2.1 正确的协议 ownership

| 面向对象 | 应消费的协议层 | 为什么 |
|---|---|---|
| client ↔ host | `@nano-agent/nacp-session` | `bash.core` 不是 client-facing session host；它不拥有 `session.start / followup / ack / heartbeat` |
| host ↔ bash remote seam | `@nano-agent/nacp-core` `tool.call.*` | `tool.call.request/response/cancel` 已在 `nacp-core` 注册并带有明确 body schema / role gate：`packages/nacp-core/src/messages/tool.ts:4-30` |

换句话说，`bash.core` 后续如果被独立成 worker，它也应该是：

> **一个消费 `tool.call.*` 的 capability worker，而不是一个自己说 `session.*` 的 shell worker。**

### 2.2 `tool.call.*` 的合法方向已经冻结

`nacp-core` 当前对 `tool.call.*` 的合法方向写得很清楚：

- `tool.call.request` → `command`
- `tool.call.response` → `response` / `error`
- `tool.call.cancel` → `command`

见：`packages/nacp-core/src/type-direction-matrix.ts:20-24`

同时 role gate 也已冻结：

- request / cancel 只能由 `session`
- response 只能由 `capability` 或 `skill`

见：`packages/nacp-core/src/messages/tool.ts:19-30`

这对 `bash.core` 的直接含义是：

1. 它不能把自己写成 session producer；
2. 它如果远端回包，producer role 必须落在 `capability`；
3. cancel 只能沿 `tool.call.cancel` family 走，不能自造 “bash.cancelled” 一类私有 wire message。

---

## 3. `bash.core` 只负责 `tool.call.*` 的 **body bridge**，不负责 envelope

`packages/capability-runtime/src/tool-call.ts` 开头就把边界写死了：

> **This module ONLY produces / consumes the message BODIES. Envelope framing is the concern of the nacp-core transport layer.**

见：`packages/capability-runtime/src/tool-call.ts:4-15`

当前 bridge 已落实三件事：

1. `CapabilityPlan -> ToolCallRequestBody`：`64-75`
2. `reason -> ToolCallCancelBody`：`77-87`
3. `ToolCallResponseBody -> CapabilityResult`：`89-160`

这意味着当前的 `bash.core` internal compliance 不是“它自己已经拥有完整 wire protocol stack”，而是：

> **它已经拥有 tool-call body bridge，但 envelope validate / role gate / delivery-kind legality 仍由 `nacp-core` transport 层负责。**

这点与 `validateEnvelope()` 的六层校验完全一致：Layer 4 做 body validation，Layer 5 做 role gate：`packages/nacp-core/src/envelope.ts:331-359`

---

## 4. `requestId / cancel / progress / terminal result` 已经形成稳定 lifecycle

### 4.1 executor 已冻结 capability lifecycle

`CapabilityExecutor` 当前已经把下面这些事情执行成 load-bearing contract：

1. 生成 `requestId`：`121-124`
2. 在 policy 后 dispatch target：`125-206`
3. 注册 `AbortController` 供外部 cancel：`208-210`
4. 在 timeout 时真正 abort 底层 handler：`213-239`
5. `executeStream()` 产出 `started -> progress* -> terminal`：`242-320`

对应 internal event kinds 也已冻结为：

- `started`
- `progress`
- `completed`
- `error`
- `cancelled`
- `timeout`

见：`packages/capability-runtime/src/events.ts:9-25`

### 4.2 这些 event 是 internal lifecycle，不是 client-facing 协议

`events.ts` 文件头已明确：

> These are consumed by the orchestrator and observability layer, **NOT surfaced directly to external clients**.

见：`packages/capability-runtime/src/events.ts:3-7`

所以对 `bash.core` 的正确理解是：

> **它已经有完整的 internal execution lifecycle，但这不等于它已经拥有独立 client-facing websocket protocol。**

### 4.3 `ServiceBindingTarget` 已把 progress / cancel roundtrip 做实

`ServiceBindingTarget` 当前已经真实实现：

- `tool.call.request` body 构造：`127-128`
- progress frame → executor progress emit：`151-162`
- caller abort → `tool.call.cancel` body：`130-148`
- parse response 后 patch back `capabilityName + requestId`：`168-176`

见：`packages/capability-runtime/src/targets/service-binding.ts:127-176`

而 integration tests 也锁了：

- 无 transport 时返回 `not-connected`：`test/integration/service-binding-transport.test.ts:72-90`
- transport progress 会变成 progress events：`92-136`
- cancel 会真的调用 transport.cancel()：`167-216`
- terminal result 会补回正确 `requestId`：`218-255`

这说明 `bash.core` 若远端化，它的 protocol backbone 已经不是空白。

---

## 5. no-silent-success 是 `bash.core` 的 correctness law

### 5.1 `FakeBashBridge` 明确拒绝 fabricate success

`bridge.ts` 文件头直接写着：

> the bridge NEVER fabricates success results.

见：`packages/capability-runtime/src/fake-bash/bridge.ts:17-20`

当前它已经把下面这些路径全部收成 structured error result，而不是 throw 出去或者伪造 stdout：

1. `empty-command`：`85-87`
2. `unsupported-command`：`89-95`
3. `oom-risk-blocked`：`97-103`
4. `bash-narrow-rejected`：`105-117`
5. `unknown-command`：`118-124`
6. `no-executor`：`126-132`

### 5.2 这条 law 已被测试锁死

`fake-bash-bridge.test.ts` 当前直接锁了：

- 无 executor 时返回 `no-executor`，且**never fabricates a success result**：`62-77`
- unsupported / unknown / tar/gzip OOM-risk 都 hard-fail：`79-134`
- bash-narrow violation 返回 structured error，不再 raw throw：`197-227`

因此，对 `bash.core` 而言，“像 shell”永远不能优先于“诚实说不能做”。

---

## 6. policy / bash-narrow / taxonomy 也是 internal contract，不只是 UX 文案

### 6.1 static policy 是 capability declaration 的一部分

`CapabilityPolicyGate.check()` 当前只认三件事：

1. hook override（如果有）
2. declaration 的 static policy
3. 未注册能力 = `deny`

见：`packages/capability-runtime/src/policy.ts:25-48`

这意味着 `allow / ask / deny` 不是 README 文案，而是 runtime enforcement truth。

### 6.2 bash path narrow 也是 contract，不是提示建议

`planner.ts` 当前已经把这些 bash-path law 写成 throw-shaped enforcement：

- `curl` bash path 只允许 `curl <url>`：`151-182`
- `ts-exec` bash path 拒绝 leading flags：`183-198`
- `git` 只允许 `status/diff/log`：`199-215`
- 9 个 text-processing 命令都走 file/path-first bash path：`216-248`

所以 `bash.core` 的 contract 不是“以后可以把 argv 扩大”，而是：

> **bash path 故意保持窄； richer semantics 必须走 structured tool call。**

### 6.3 unsupported / OOM-risk taxonomy 也是正式边界

`unsupported.ts` 当前明确把：

- OS / package manager / nested interpreters：放进 `UNSUPPORTED_COMMANDS`
- archive/compression：放进 `OOM_RISK_COMMANDS`

见：`packages/capability-runtime/src/fake-bash/unsupported.ts:15-86`

这意味着 `bash.core` 不是“未来全都能做，只是还没接上”，而是**有些东西当前就是明确不支持**。

---

## 7. host runtime 侧，`bash.core` 当前只暴露 capability transport seam

`makeRemoteBindingsFactory()` 现在给 host 返回的 capability handle 形状是：

```ts
capability: capabilityTransport
  ? { serviceBindingTransport: capabilityTransport }
  : undefined
```

见：`packages/session-do-runtime/src/remote-bindings.ts:385-390`

这条事实很关键，因为它说明：

1. host 侧已经承认 `bash.core` 的 remote identity 是一个 **capability transport**；
2. host 侧今天并没有把 `bash.core` 定义成 “session host / websocket endpoint / workspace owner”；
3. 因此 worker-matrix 阶段若真要做 `bash.core`，最不该做的事情就是重新发明一套与 `tool.call.*` 平行的私有 wire。

---

## 8. 对后续 `bash.core` 设计的直接要求

1. **继续把 `tool.call.*` 当成唯一 remote protocol family**，不要引入私有 `bash.exec.*` wire。
2. **坚持 body bridge 与 envelope transport 分层**，不要把 `capability-runtime` 扩成第二套 envelope validator。
3. **保留 `requestId / cancel / progress / terminal result` 这条 lifecycle**，不要为了简化 worker 壳而把 cancel/progress 丢掉。
4. **继续把 no-silent-success 当作 correctness floor**。
5. **在独立 worker 壳出现之前，不允许把 `bash.core` 写成“已完成 remote worker”**。

---

## 9. 本文件的最终判断

从 internal contract 角度看，`bash.core` 的正确身份不是“一个会说 bash 的随意工具箱”，而是：

> **一个以 `tool.call.*` body bridge 为协议核心、以 `requestId / cancel / progress / policy / no-silent-success` 为执行纪律的 capability worker 候选体。**

这也是 worker-matrix 阶段继续推进 `bash.core` 的前提。
