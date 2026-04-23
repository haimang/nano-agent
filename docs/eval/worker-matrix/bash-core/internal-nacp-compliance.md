# bash.core — internal NACP compliance

> 目标：定义 `bash.core` 在 pre-worker 之后、r2 之前真正拥有的协议责任。

---

## 0. 先给结论

**W4 新增了 `workers/bash-core` shell，但没有改变 `bash.core` 的协议 ownership：它今天真正拥有的仍是 `tool.call.* / requestId / cancel / progress / policy / no-silent-success` 这一层 internal contract，而不是 `session.*`。**

---

## 1. 当前最该看的直接证据

| 类型 | 路径 | 用途 |
|---|---|---|
| W3/W4 truth | `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`; `docs/issue/pre-worker-matrix/W4-closure.md` | 说明 shell 已 materialize，但 engine / protocol 仍主要在 B1 |
| core wire | `packages/nacp-core/src/messages/tool.ts`; `type-direction-matrix.ts`; `envelope.ts` | `tool.call.*` body family、role gate、direction truth |
| engine code | `packages/capability-runtime/src/tool-call.ts`; `executor.ts`; `events.ts`; `policy.ts`; `fake-bash/bridge.ts`; `targets/service-binding.ts` | 当前 bash-core 真正的 internal protocol backbone |
| host seam | `packages/session-do-runtime/src/env.ts`; `remote-bindings.ts` | 说明当前 host 只把 bash-core 看成 capability transport seam |
| shell evidence | `workers/bash-core/src/index.ts` | 说明当前 W4 shell 还没有拥有独立 protocol runtime |

---

## 2. 当前必须保留的协议 ownership

| 面向对象 | 正确协议层 | 当前判断 |
|---|---|---|
| client ↔ host | `@haimang/nacp-session` | 不是 `bash.core` 的职责 |
| host ↔ bash remote seam | `@haimang/nacp-core` `tool.call.*` | 这是 `bash.core` 当前真正对齐的 wire family |
| `bash.core` 自己的执行纪律 | capability-runtime lifecycle | `requestId / cancel / timeout / progress / terminal result` |

最重要的一句话没有变：

> **如果 `bash.core` 被独立成 worker，它也应是一个 capability worker，而不是会说 `session.*` 的 shell worker。**

---

## 3. 当前仍必须原样继承的几条 law

### 3.1 `tool.call.*` 继续是唯一 remote family

当前正式真相仍是：

- `packages/nacp-core/src/messages/tool.ts:4-30`
- `packages/nacp-core/src/type-direction-matrix.ts:20-24`

因此：

1. request / cancel 继续是 `command`
2. response 继续是 `response` / `error`
3. 远端 `bash.core` 不能发明私有 `bash.exec.*` wire

### 3.2 body bridge 与 envelope transport 继续必须分层

`packages/capability-runtime/src/tool-call.ts` 当前仍把边界写得很死：

> only the message bodies, not the outer envelope

这意味着：

> 即使 B1 被吸收到 `workers/bash-core/`，也不应把 capability-runtime 扩成第二套 envelope validator。

### 3.3 `requestId / cancel / progress / terminal result` 继续是 load-bearing lifecycle

当前 backbone 仍是：

- `packages/capability-runtime/src/executor.ts`
- `packages/capability-runtime/src/events.ts`
- `packages/capability-runtime/src/targets/service-binding.ts:90-215`

当前真相包括：

1. executor 会生成 `requestId`
2. cancel 通过 `AbortController` 向下游传播
3. streaming path 保留 progress lifecycle
4. service-binding target 会把 progress / cancel / response roundtrip 做实

因此 r2 不能为了“更快做出一个 worker shell”而把 cancel/progress lifecycle 悄悄裁掉。

### 3.4 no-silent-success 继续是 correctness floor

当前最关键的治理 law 仍是：

- `packages/capability-runtime/src/fake-bash/bridge.ts:1-20,82-132`

它已经明确拒绝 fabricate success，并把：

1. `unsupported-command`
2. `oom-risk-blocked`
3. `bash-narrow-rejected`
4. `no-executor`

都收成 structured result。

### 3.5 policy / bash-narrow / taxonomy 继续是 runtime contract，不是 README 文案

当前代码真相仍是：

- command registry / ask-allow surface：`packages/capability-runtime/src/fake-bash/commands.ts:16-314`
- policy gate：`packages/capability-runtime/src/policy.ts`
- unsupported taxonomy：`packages/capability-runtime/src/fake-bash/unsupported.ts`

因此 `bash.core` 的 contract 不是“以后再看要不要扩”，而是：

> **当前就有一整套已经冻结的 allow/ask/deny + narrow path + unsupported boundary。**

---

## 4. W4 shell 出现后，哪些东西没有变化

| 变化 | 是否改变协议 ownership | 为什么 |
|---|---|---|
| `workers/bash-core` 目录存在 | **否** | 只是 deploy shell materialized |
| `workers/bash-core/src/index.ts` 返回 probe JSON | **否** | 这是 shell identity，不是 capability protocol runtime |
| W4 dry-run 通过 | **否** | 证明 deploy path 真实，不证明 `tool.call.*` 已在该目录内 remoteize 完成 |

---

## 5. host 视角下，`bash.core` 现在仍然只是一条 capability seam

当前 host 侧仍然这么看待 bash-core：

1. env 里暴露的是 `CAPABILITY_WORKER`：`packages/session-do-runtime/src/env.ts:55-77`
2. remote composition 返回的是 `{ serviceBindingTransport }`：`packages/session-do-runtime/src/remote-bindings.ts:335-395`

也就是说，当前 host mental model 仍然是：

> **bash-core = capability transport seam**

而不是：

> “一个自己拥有 session host、websocket 协议、workspace authority 的独立 shell 系统”

---

## 6. 对 r2 的直接纪律

1. **继续把 `tool.call.*` 当成唯一 remote family**。
2. **继续坚持 body bridge 与 envelope 分层**。
3. **继续保留 `requestId / cancel / progress / terminal result` lifecycle**。
4. **继续把 no-silent-success 当作 correctness floor**。
5. **在 B1 真正吸收之前，不允许把 `workers/bash-core` 写成已拥有 live capability runtime。**

---

## 7. 本文件的最终判断

**pre-worker 之后，`bash.core` 的协议 reality 没有被 worker shell 稀释：真正重要的仍是 `tool.call.*`、service-binding seam、以及 governed fake-bash lifecycle。**

所以 worker-matrix r2 应把重点放在：

> **如何把这套已有 internal contract 吸收到 `workers/bash-core/` 内，而不是发明第二套 shell-specific private wire。**
