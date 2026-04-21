# agent.core — external contract surface

> 目标：把 `agent.core` 的外部面拆成 **client / upstream / downstream / platform** 四层，并给出每层都能回到原始文档、源码和 `context/` 参考实现的召回路径。

---

## 0. 先给结论

**`agent.core` 的外部面不是一个“万能 API”，而是四个边界叠加后的 host runtime：**

1. **对 client**：WebSocket-first + HTTP fallback 的 session host；
2. **对 upstream orchestrator**：消费 `session.start.body.initial_context` 的下游运行时；
3. **对 downstream workers**：hooks / capability / fake-provider 等 remote seam 的调度者；
4. **对平台**：Durable Object、R2、KV、service binding 的组合点。

如果把这四层揉成一个“大 controller”，就会再次把 `agent.core` 误写成 binding slot、长期记忆 orchestrator，或“所有 worker 的合体”。

---

## 1. 原始素材召回表

### 1.1 原始文档

| 类型 | 原始路径 | 关键行 / 章节 | 用途 |
|---|---|---|---|
| handoff | `docs/handoff/after-foundations-to-worker-matrix.md` | `§4-§6, §10-§11` | 定义 host / remote / binding catalog 的边界 |
| evaluation | `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md` | `132-177` | 定义 `agent.core` 作为 first-wave host worker 的总体定位 |
| evaluation | `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md` | `78-84, 171-198` | 说明 `agent.core READY` 的前提是“已有 host shell，未接内核” |
| evaluation | `docs/eval/after-foundations/smind-contexter-learnings.md` | `31-45, 214-229, 241-257` | 说明 upstream orchestrator 与 runtime host 的分层 |

### 1.2 当前仓库代码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| Worker entry | `packages/session-do-runtime/src/worker.ts` | `55-88` | client 请求如何通过 Worker 进入 DO |
| HTTP fallback | `packages/session-do-runtime/src/http-controller.ts` | `85-237` | client-facing fallback surface 的真实 action 面 |
| env contract | `packages/session-do-runtime/src/env.ts` | `36-82, 95-121` | 对 downstream/platform 暴露的 binding 面 |
| remote composition | `packages/session-do-runtime/src/remote-bindings.ts` | `330-397` | downstream remote seam 目前如何被组装 |
| hooks remote runtime | `packages/hooks/src/runtimes/service-binding.ts` | `34-153` | 证明 `HOOK_WORKER` 不是想象面，而是可执行 transport seam |
| Session schema | `packages/nacp-session/src/messages.ts` / `upstream-context.ts` | `17-25, 66-113` / `18-38` | upstream surface 中 `initial_context` 与 followup family 的正式 shape |

### 1.3 `context/` 参考实现

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| gateway 实码 | `context/smind-contexter/src/chat.ts` | `118-125, 183-210` | 对照“无状态 gateway → user-level DO”的 client/upstream 边界 |
| gateway 备忘 | `context/smind-contexter/app/plan-chat.ts.txt` | `9-22, 69-98` | 对照 HTTP/WS + DO stub + service binding 三层外部面 |
| EngineDO 备忘 | `context/smind-contexter/app/plan-engine_do.ts.txt` | `8-21, 24-43` | 对照 “host actor 负责 session + ws + routing，下游模块只是内部逻辑” |
| director 实码 | `context/smind-contexter/context/director.ts` | `139-189, 215-272` | 对照 upstream orchestrator 先做 intent/context，再把结果交给 runtime |

---

## 2. 四层 external surface 总表

| 层级 | `agent.core` 的身份 | 不能把它误写成什么 |
|---|---|---|
| client-facing | session host | 普通 REST API worker |
| upstream-facing | 可被外部 orchestrator 驱动的 runtime | 长期记忆 / 意图路由本体 |
| downstream-facing | remote seam dispatcher | bash/filesystem/context/skill 的合体 |
| platform-facing | DO + R2 + KV + service binding 的 assembly point | “一个抽象存储盒子” |

---

## 3. client-facing surface

## 3.1 Worker 入口：`/sessions/:sessionId/...`

当前 Worker entry 做的事情非常薄：

1. 解析 path 中的 `sessionId`；
2. 用 `SESSION_DO.idFromName(sessionId)` 取 DO stub；
3. 把请求直接转发给 `NanoSessionDO.fetch()`：`packages/session-do-runtime/src/worker.ts:55-88`。

这意味着 client-facing 的真正宿主不是 Worker entry，而是 **DO actor**。

对应 test 也在锁这件事：

- `/sessions/:id/:action` 会转发进 DO；
- 非法 path 会直接 `404`，不触碰 DO namespace：`packages/session-do-runtime/test/worker.test.ts:30-65`。

## 3.2 WebSocket-first surface

`agent.core` 的主入口仍然应被理解为 WebSocket-first session host。源码层面的证据是：

- `NanoSessionDO.webSocketMessage()` 把 raw message 送入统一 ingress：`packages/session-do-runtime/src/do/nano-session-do.ts:466-479`
- ingress 会经过 `acceptIngress(...)`、`normalizeClientFrame(...)`、`validateSessionFrame(...)`、`verifyTenantBoundary(...)` 再进入 `dispatchAdmissibleFrame(...)`：`packages/session-do-runtime/src/do/nano-session-do.ts:481-533`; `packages/nacp-session/src/ingress.ts:25-74`; `packages/nacp-session/src/frame.ts:66-136`。

所以 client-facing 的**正式 contract**，本质上是 `NACP-Session` wire，而不是 controller 手搓 JSON。

## 3.3 HTTP fallback surface：真实存在，但故意更窄

当前 `HttpController` 已提供 6 个 action：`start / input / cancel / end / status / timeline`：`packages/session-do-runtime/src/http-controller.ts:17-25, 85-113`。

关键现实是：

| action | 当前语义 | 代码证据 |
|---|---|---|
| `start` | 注入 `session.start`，但只接受 `initial_input / text` | `packages/session-do-runtime/src/http-controller.ts:160-181` |
| `input` | 注入 `session.followup_input`，但只接受 `text / input` | `packages/session-do-runtime/src/http-controller.ts:184-205` |
| `cancel` | 注入 `session.cancel` | `packages/session-do-runtime/src/http-controller.ts:208-219` |
| `end` | 当 host 存在时返回 `405`，因为 `session.end` 是 server-emitted | `packages/session-do-runtime/src/http-controller.ts:222-237` |
| `status` | 只读 actor phase | `packages/session-do-runtime/src/http-controller.ts:240-247` |
| `timeline` | 只读 replay timeline | `packages/session-do-runtime/src/http-controller.ts:249-257` |

**因此：HTTP fallback 是真实 surface，但它不是完整 orchestrator integration surface。**

---

## 4. upstream-facing surface

## 4.1 `agent.core` 应被视为 downstream runtime，而不是顶层 orchestrator

这点可以同时从原始文档、当前协议与 `context/` 参考实现中看到：

- `worker-matrix-eval-with-GPT.md` 把 `agent.core` 定义为 host/control tower，而不是用户长期记忆系统：`docs/eval/after-foundations/worker-matrix-eval-with-GPT.md:132-177`
- `smind-contexter` 的 `chat.ts` 是无状态 gateway，`Director.handleUserMessage()` 是 one-shot orchestrator，真正 stateful host 是 DO actor：`context/smind-contexter/src/chat.ts:118-125, 183-210`; `context/smind-contexter/context/director.ts:139-189, 215-272`; `context/smind-contexter/app/plan-engine_do.ts.txt:8-21, 24-43`

这说明一个更合适的定位是：

> `agent.core` 是“可被外部 orchestrator 驱动的 host runtime”，而不是“host 自己再做一遍长期记忆 / 意图路由 / 用户画像”。

## 4.2 当前最关键的 upstream 输入面：`initial_context`

协议侧已经把 upstream 输入面正式冻结：

- `SessionStartBodySchema.initial_context`：`packages/nacp-session/src/messages.ts:17-25`
- `SessionStartInitialContextSchema`：`packages/nacp-session/src/upstream-context.ts:18-38`

当前这条输入面已经可以承载：

- `user_memory`
- `intent`
- `warm_slots`
- `realm_hints`

因此外部 orchestrator 的最重要正式入口，不是今天的 HTTP fallback，而是完整的 `session.start` wire。

## 4.3 upstream surface 的当前缺口

现在必须诚实写清楚两件事：

1. **schema 已存在**：上游可以合法地把 `initial_context` 塞进 `session.start`；
2. **host consumer 还不存在**：`dispatchAdmissibleFrame()` 当前只从 `body` 中抽 turn input，然后 `startTurn(...)`：`packages/session-do-runtime/src/do/nano-session-do.ts:612-645`。

所以今天的 upstream-facing truth 是：

> `agent.core` 已经有 upstream wire hook，但还没有完成 upstream context 消费链。

---

## 5. downstream-facing surface

## 5.1 当前 v1 binding catalog：只有 3 条 active seam

`SessionRuntimeEnv` 现在公开的 active remote seams 只有：

- `CAPABILITY_WORKER`
- `HOOK_WORKER`
- `FAKE_PROVIDER_WORKER`

并且 `SKILL_WORKERS` 仍是 reserved，不得被 Phase 4 composition 消费：`packages/session-do-runtime/src/env.ts:36-82`。

这件事对 `agent.core` 的外部边界非常关键：

> worker-matrix 讨论的是未来 worker/service 名称；v1 binding catalog 说的是当前 runtime seam。两者不能混为一层。

## 5.2 remote composition 当前真实做到了什么

`makeRemoteBindingsFactory()` 现在能做三件事：

1. 当 `HOOK_WORKER` 存在时，组出可执行的 `hooks.emit(...)` remote handle；
2. 当 `CAPABILITY_WORKER` 存在时，组出 `serviceBindingTransport`；
3. 当 `FAKE_PROVIDER_WORKER` 存在时，组出 provider fetcher；

代码见：`packages/session-do-runtime/src/remote-bindings.ts:330-397`。

其中 hook seam 不是空想，已经有真实 remote runtime 支撑：

- `ServiceBindingRuntime.execute()` 会经 transport 发送 `hook.emit` body，并解析 `hook.outcome` body：`packages/hooks/src/runtimes/service-binding.ts:34-153`。

对应 integration test 也锁了默认路径能真的打到 fake binding：

- `HOOK_WORKER` 存在时，`emitHook` 会触达 fake binding 的 `fetch`：`packages/session-do-runtime/test/integration/remote-composition-default.test.ts:28-63`。

## 5.3 downstream-facing 的正确职责

`agent.core` 对下游 remote worker 的正确职责是：

1. 选择 local / remote profile；
2. 传递 cross-seam anchor、trace、session、team 等 identity；
3. 汇聚 timeout / cancel / error / audit / evidence；
4. 维护统一 taxonomy。

它**不**应该变成：

- 真正执行 bash 的那个 worker；
- 真正实现 filesystem semantics 的那个 worker；
- 真正实现 context compaction 策略的那个 worker。

这也是为什么 `agent.core` 在外部面上必须保持 **host** 身份，而不是被塞回 binding slot 表。

---

## 6. platform-facing surface

## 6.1 Durable Object：`agent.core` 的第一物理承载

从当前源码看，`agent.core` 的平台第一承载就是 `SESSION_DO`：

- Worker entry 只负责根据 `sessionId` 取 DO stub 并转发：`packages/session-do-runtime/src/worker.ts:72-88`
- 真正的 host runtime 在 `NanoSessionDO`：`packages/session-do-runtime/src/do/nano-session-do.ts:130-280`

这和 `smind-contexter` 的“gateway → user-level DO”分层是一致的：`context/smind-contexter/app/plan-chat.ts.txt:15-22, 33-44`; `context/smind-contexter/app/plan-engine_do.ts.txt:8-21, 24-43`。

## 6.2 R2 / KV：不是“抽象存储”，而是不同职责的 binding

`SessionRuntimeEnv` 当前还公开了：

- `R2_ARTIFACTS`
- `KV_CONFIG`

见：`packages/session-do-runtime/src/env.ts:39-70`

对 `agent.core` 来说，这两个面必须分开理解：

| binding | 正确理解 |
|---|---|
| `R2_ARTIFACTS` | 冷存储 / 大对象 / artifact 出口 |
| `KV_CONFIG` | 配置 / 轻量控制面 |

如果把它们与 DO storage 混成一个“存储层”，后续 `agent.core` 就会丢失显式 DO-vs-R2 路由能力。

## 6.3 当前一个真实存在的宿主 contract 缺口

当前 `NanoSessionDO` 会读：

- `env.TEAM_UUID`
- 某些路径也会读 `env.SESSION_UUID`

见：`packages/session-do-runtime/src/do/nano-session-do.ts:224-230, 541-545, 1086-1089`

但这些字段并没有完整出现在公开 `SessionRuntimeEnv` / `WorkerEnv` 类型上：`packages/session-do-runtime/src/env.ts:55-70`; `packages/session-do-runtime/src/worker.ts:41-50`。

因此 platform-facing 的一个当前缺口是：

> `agent.core` 的 tenant/session 宿主 contract，代码实现层比显式类型层走得更前。

---

## 7. `agent.core` 自己拥有的边界

| 责任 | 是否属于 `agent.core` | 证据 |
|---|---|---|
| session actor lifecycle | **是** | `NanoSessionDO` / `SessionOrchestrator`：`packages/session-do-runtime/src/do/nano-session-do.ts:130-280`; `packages/session-do-runtime/src/orchestration.ts:132-220` |
| client ingress / egress | **是** | `worker.ts` / `http-controller.ts` / `nacp-session` |
| checkpoint / replay / ack / heartbeat | **是** | `packages/session-do-runtime/src/do/nano-session-do.ts:662-709, 1042-1124` |
| downstream seam dispatch | **是** | `packages/session-do-runtime/src/remote-bindings.ts:330-397` |
| fake bash 执行本体 | **否** | 那是 capability/bash-core 一侧 |
| 长期用户记忆与 intent routing | **否** | 这正是 `initial_context` 要表达的 upstream seam |
| 高级 context 压缩策略 | **否** | 应由 `context.core` 或未来上游策略层承担 |

---

## 8. 本文件的最终判断

从 external surface 角度看，`agent.core` 应被写成下面这句话，而不是别的版本：

> **一个 WebSocket-first 的 session host，可被 upstream orchestrator 用 `session.start.initial_context` 驱动，并可向 downstream remote workers 透传 typed runtime seams；它以 DO 为物理核心，以 R2/KV/service binding 为外围 binding 面。**

只要保持这个四层外部边界，worker-matrix 后续设计就不容易再把 `agent.core` 写歪。
