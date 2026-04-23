# bash.core — external contract surface

> 目标：回答 `bash.core` 今天到底向外暴露了什么，以及哪些 surface 仍未落到 worker shell。

---

## 0. 先给结论

**今天的 `bash.core` 外部面已经不止 package API，也不止 fake-bash bridge。它现在应被拆成四层：**

1. **当前真实 worker shell**：`workers/bash-core`
2. **当前真实 package surface**：`@nano-agent/capability-runtime`
3. **当前真实 fake-bash compatibility face**：21-command governed subset
4. **当前真实 remote seam**：`ServiceBindingTarget` + host-side `CAPABILITY_WORKER`

而 **live standalone bash-core worker API** 仍未在当前 shell 中落地。

---

## 1. 当前最该看的直接证据

| 类型 | 路径 | 用途 |
|---|---|---|
| shell code | `workers/bash-core/package.json`; `wrangler.jsonc`; `src/index.ts`; `test/smoke.test.ts` | 证明当前 deploy shell surface |
| package surface | `packages/capability-runtime/README.md`; `src/index.ts` | 证明当前真正的 library-level external API |
| command truth | `packages/capability-runtime/src/fake-bash/commands.ts`; `planner.ts`; `fake-bash/bridge.ts` | 证明当前 bash-shaped surface |
| remote seam | `packages/capability-runtime/src/targets/service-binding.ts`; `packages/session-do-runtime/src/env.ts`; `remote-bindings.ts` | 证明当前 service-binding path |

---

## 2. 第一层 external surface：当前 worker shell

### 2.1 `workers/bash-core` 现在真实暴露了什么

当前 shell 行为非常窄：

- `fetch()` 返回 `worker / nacp_core_version / nacp_session_version / status / phase`：`workers/bash-core/src/index.ts:5-22`
- smoke test 只验证 fetch handler 与版本探针：`workers/bash-core/test/smoke.test.ts:1-26`

因此当前 shell 对外最准确的表述是：

> **一个 deploy-shaped probe shell，不是 live fake-bash API。**

### 2.2 W4 已把“没有 worker 壳”这个问题关闭

当前 closure truth：

- `docs/issue/pre-worker-matrix/W4-closure.md:18-27,43-48,225-233`

这意味着 r2 不应再写“bash-core 还没有独立 worker 目录/配置/CI”。

---

## 3. 第二层 external surface：当前 package / library API

当前真正成熟的外部面仍是 `@nano-agent/capability-runtime`：

- package truth：`packages/capability-runtime/package.json:1-35`
- public README：`packages/capability-runtime/README.md:1-151`

它当前明确暴露：

1. planner
2. executor
3. targets
4. fake-bash bridge
5. handlers

因此现在的 `bash.core` 不是“写死在 host 里的私有 helper”，而是：

> **已经拥有单独 package-level public surface 的 capability engine。**

---

## 4. 第三层 external surface：bash-shaped compatibility face

当前 bash-shaped surface 仍以两件东西为核心：

1. `FakeBashBridge`
2. canonical 21-command registry

主锚点：

- `packages/capability-runtime/src/fake-bash/bridge.ts`
- `packages/capability-runtime/src/fake-bash/commands.ts:16-314`
- `packages/capability-runtime/README.md:20-82`

当前这层 surface 的最重要事实是：

| 项目 | 当前真相 |
|---|---|
| 命令面 | 21-command governed subset |
| policy | ask/allow 已显式冻结 |
| bash path | 故意保持 narrow |
| richer semantics | 走 structured tool path，而不是扩大 bash grammar |

所以今天的 `bash.core` external contract 绝不是“完整 shell 语法面”。

---

## 5. 第四层 external surface：remote seam

### 5.1 `ServiceBindingTarget` 已经是真实 external seam

当前 target 已真实暴露：

- `call(input)` / optional `cancel(input)`
- `requestId`
- `onProgress`
- parsed response patch-back

锚点：

- `packages/capability-runtime/src/targets/service-binding.ts:40-215`

这说明：

> 未来的 `bash.core` worker 不必重新发明 remote transport 形状，它只需要实现现有 seam。

### 5.2 host 侧 binding slot 也已经真实存在

当前 host substrate 仍暴露：

- `CAPABILITY_WORKER`：`packages/session-do-runtime/src/env.ts:55-77`
- `{ serviceBindingTransport }` handle：`packages/session-do-runtime/src/remote-bindings.ts:335-395`

因此外部面上当前已经有：

1. worker shell
2. package surface
3. fake-bash surface
4. remote seam

缺的并不是 seam，而是：

> **把引擎吸收到 `workers/bash-core` 里，并把该 shell 提升成真正 remote worker。**

---

## 6. 当前明确不存在的 external surface

当前仍然**不存在**：

1. live standalone bash-core fetch API（除了 probe JSON）
2. bash-core 自己的 WebSocket / session host 协议
3. full shell grammar / pipe / redirect / heredoc
4. package manager / nested runtime / mutating git

所以把今天的 `bash.core` 写成“独立 shell service 已上线”会明显过头。

---

## 7. 对 r2 的直接要求

1. **承认 `workers/bash-core` shell 已存在**。
2. **把 `@nano-agent/capability-runtime` 视为当前真正的外部语义本体**。
3. **把 `ServiceBindingTarget + CAPABILITY_WORKER` 视为现成 remote seam，而不是未来 invention**。
4. **在 B1 吸收完成前，不把 probe shell 写成 live worker API。**

---

## 8. 本文件的最终判断

**今天 `bash.core` 的外部面最成熟的是 package API、fake-bash surface、service-binding seam；最不成熟的是“吸收进 worker shell 后的 live remote API”。**

所以 worker-matrix r2 最合理的写法是：

> **以现有 package/bridge/seam 为语义基线，把 `workers/bash-core` 从 deploy shell 提升为真正 capability worker，而不是另起一套 shell API 设计。**
