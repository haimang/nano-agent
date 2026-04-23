# agent.core — internal NACP compliance

> 目标：只保留 `worker-matrix` r2 真正需要继承的协议责任。
> 当前前提：`workers/agent-core` shell 已存在，但真正的 host runtime truth 仍主要来自 `@nano-agent/session-do-runtime`。

---

## 0. 先给结论

**pre-worker-matrix 改变的是 `agent.core` 的 deploy reality，不是它的协议 ownership。今天的 `agent.core` 仍然同时站在两层协议边界上：**

1. **对 client-facing session path**，以 `@haimang/nacp-session` 为唯一真相源；
2. **对 downstream/internal seam**，以 `@haimang/nacp-core` 为 envelope / tool / hook / context / system 真相源；
3. **对 host 自己**，把 authority、tenant、replay、checkpoint、ack、heartbeat 执行成宿主责任。

---

## 1. 当前该看的直接证据

| 类型 | 路径 | 当前用途 |
|---|---|---|
| W3/W4 truth | `docs/design/pre-worker-matrix/W3-absorption-map.md`; `docs/issue/pre-worker-matrix/W4-closure.md` | 说明 `agent.core` 已有 worker shell，但协议责任未转移 |
| session profile | `packages/nacp-session/src/ingress.ts`; `frame.ts`; `type-direction-matrix.ts`; `session-registry.ts`; `stream-event.ts` | client-facing profile、phase、stream truth |
| core profile | `packages/nacp-core/src/envelope.ts`; `type-direction-matrix.ts`; `messages/tool.ts`; `tenancy/boundary.ts` | internal envelope、tool/cancel、tenant gate |
| host substrate | `packages/session-do-runtime/src/do/nano-session-do.ts`; `worker.ts`; `http-controller.ts`; `env.ts` | 证明这些 law 现在由 host runtime 实际执行 |
| shell evidence | `workers/agent-core/src/index.ts`; `src/nano-session-do.ts` | 说明 W4 shell 还没有取代这些 runtime laws |

---

## 2. 当前必须保留的协议 ownership

| 面向对象 | 正确协议层 | 当前判断 |
|---|---|---|
| client ↔ `agent.core` | `@haimang/nacp-session` | `agent.core` 仍然是 session host，不是自己发明 `session.*` 替代物 |
| `agent.core` ↔ remote seams | `@haimang/nacp-core` | remote worker / service binding 继续走 core envelope + body family |
| `agent.core` 自己的 host discipline | host runtime 实现层 | authority、tenant、replay、checkpoint、stream push 继续是宿主责任 |

最重要的点没有变：

> **`agent.core` 可以同时消费 Session 与 Core，但不能把两层 validator / ownership 混成一层。**

---

## 3. pre-worker 之后，哪些 law 仍必须原样继承

### 3.1 authority 只能 server-stamped

`nacp-session` 仍要求：

1. client frame 不得自带 authority
2. authority 只能在 ingress 端由 server stamp

锚点：

- `packages/nacp-session/src/ingress.ts:25-74`

这条对 r2 的含义是：

> 即使 `workers/agent-core` 已有独立壳，authority 也不能被移动成某个 shell helper、浏览器客户端、或下游 worker 的可写字段。

### 3.2 Session 自己拥有 message legality / phase legality / stream legality

当前仍是三层：

1. `validateSessionFrame()` 负责 body/schema legality：`packages/nacp-session/src/frame.ts:66-136`
2. `NACP_SESSION_TYPE_DIRECTION_MATRIX` 负责 Session 自己的 type×direction：`packages/nacp-session/src/type-direction-matrix.ts:14-25`
3. `session-registry.ts` 负责 Session 自己的 role/phase legality：`packages/nacp-session/src/session-registry.ts:1-9,68-120`

这意味着：

> `agent.core` 的 client-facing path 仍不能回退到 `nacp-core` envelope validator。

### 3.3 tenant boundary 仍是 ingress gate，不是审计附加项

当前应继续以代码真相为准：

- `packages/nacp-core/src/tenancy/boundary.ts:20-98`
- `packages/session-do-runtime/src/do/nano-session-do.ts:492-533`

因此 r2 不应再写出任何“先过一遍业务逻辑，最后再记 tenant violation”的设计。

### 3.4 tenant-scoped storage 仍是 host 持久化前提

当前 host 关键持久化路径继续走 tenant-scoped wrapper：

- `packages/session-do-runtime/src/do/nano-session-do.ts:548-601,1042-1124`

这条在 worker 吸收后也不能退回到裸 `doState.storage.*`。

### 3.5 `session.stream.event` 继续只能走 canonical 目录

当前 session stream truth 仍是：

- `packages/nacp-session/src/stream-event.ts:10-96`

而 host orchestrator 继续必须产出可被这套 schema 直接消费的 event family。  
W4 新建 worker shell，并没有改变这条 law。

### 3.6 `session.end` 继续是 server-emitted family

当前证据仍是：

- `packages/nacp-session/src/type-direction-matrix.ts:17-24`
- `packages/session-do-runtime/src/http-controller.ts:222-237`

所以 r2 绝不应把 `session.end` 写成 client produce family。

### 3.7 `initial_context` 仍是 wire truth，仍未完成 host consumer

当前状态要诚实写成两半：

| 项目 | 当前状态 |
|---|---|
| wire schema | 已冻结在 `@haimang/nacp-session` |
| host consumer | 仍未在当前 host runtime 中接通 |

锚点：

- `packages/nacp-session/src/upstream-context.ts:1-42`
- `packages/session-do-runtime/src/composition.ts:82-106`
- `packages/session-do-runtime/src/remote-bindings.ts:385-395`
- `packages/session-do-runtime/src/` 中当前无 `initial_context` / `appendInitialContextLayer` consumer

因此 r2 最多只能写：

> **`initial_context` 的 ownership 已冻结，但 host-side assembly 仍待实现。**

---

## 4. W4 shell 落地后，哪些东西没有变化

`workers/agent-core` 的出现容易让人误以为协议责任已经跟着迁走。当前必须明确不是这样：

| 变化 | 是否改变协议 ownership | 为什么 |
|---|---|---|
| `workers/agent-core` 目录存在 | **否** | 只是 deploy shell 与 DO slot materialized |
| `NanoSessionDO` stub 存在 | **否** | 这是 W4 shell 证明，不是 live session runtime 替代物 |
| real preview deploy 已完成 | **否** | 证明 deploy path 真实，不证明 protocol runtime 已迁移完成 |

---

## 5. 对 r2 的直接纪律

1. **继续把 `agent.core` 写成 Session host**，不要把它降格成 remote capability worker。
2. **继续把 `nacp-session` 当成 client-facing 第一协议层**。
3. **继续把 `nacp-core` 当成 downstream/internal seam 第一协议层**。
4. **tenant verify、tenant-scoped storage、canonical stream kinds 任何一条都不允许回退**。
5. **在 host consumer 实装前，不允许把 `initial_context` 写成“已完成集成”**。

---

## 6. 本文件的最终判断

**`agent.core` 在 pre-worker 之后的正确姿态，是“deploy reality 前进了，但协议责任没有稀释”。**

所以 worker-matrix r2 不能把重点放在“重新定义 agent 协议”，而应放在：

> **把这些已经冻结的 Session/Core/tenant/stream laws，带着现有 host substrate 一起吸收到 `workers/agent-core/` 内，并让默认装配真正执行它们。**
