# context.core — external contract surface

> 目标：回答 `context.core` 今天到底向外暴露了什么，以及哪些 surface 仍未落到 worker shell。

---

## 0. 先给结论

**今天的 `context.core` 外部面也必须拆成两层来看：**

1. **当前真实 worker shell**：`workers/context-core`
2. **当前真实 context substrate 外部面**：`@nano-agent/context-management` + `@nano-agent/workspace-context-artifacts` context slice

而 **live standalone context-core worker API** 仍未在当前 shell 中落地。

---

## 1. 当前最该看的直接证据

| 类型 | 路径 | 用途 |
|---|---|---|
| shell code | `workers/context-core/package.json`; `wrangler.jsonc`; `src/index.ts`; `test/smoke.test.ts` | 证明当前 deploy shell surface |
| package surface | `packages/context-management/README.md`; `packages/workspace-context-artifacts/README.md` | 证明当前真正的 library-level external API |
| runtime seam | `packages/session-do-runtime/src/workspace-runtime.ts`; `src/do/nano-session-do.ts` | 证明当前 host-local composition seam |
| W3 blueprint | `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md` | 说明 C2 与 D1 应如何分边界 |

---

## 2. 第一层 external surface：当前 worker shell

### 2.1 `workers/context-core` 现在真实暴露了什么

当前 shell 行为非常窄：

- `fetch()` 返回 `worker / nacp_core_version / nacp_session_version / status / phase`：`workers/context-core/src/index.ts:5-22`
- smoke test 只验证 fetch handler 与版本探针：`workers/context-core/test/smoke.test.ts:1-26`

因此当前 shell 对外最准确的表述是：

> **一个 deploy-shaped probe shell，不是 live context worker API。**

### 2.2 W4 已把“没有 worker 壳”这个问题关闭

当前 closure truth：

- `docs/issue/pre-worker-matrix/W4-closure.md:18-27,45-48,235-240`

这意味着 r2 不应再写“context-core 还没有独立 worker 目录/配置/CI”。

---

## 3. 第二层 external surface：当前 package / substrate API

当前真正成熟的外部面仍是两个 package 的组合：

1. `@nano-agent/context-management@0.1.0`
2. `@nano-agent/workspace-context-artifacts@0.1.0` 的 context slice

它们当前对外提供的真实 surface 包括：

| 面 | 当前真实 surface |
|---|---|
| compact governance | `AsyncCompactOrchestrator`、`createKernelCompactDelegate()` |
| budget / policy | budget helpers |
| inspect/control seam | `InspectorFacade` + `mountInspectorFacade()` |
| assembly | `ContextAssembler` |
| compact boundary | `CompactBoundaryManager` |
| snapshot | `WorkspaceSnapshotBuilder` |
| evidence | assembly / compact / snapshot evidence emitters |

因此现在的 `context.core` 不是“写死在 host 里的隐式 helper”，而是：

> **已经拥有单独 package-level public surface 的 context substrate。**

---

## 4. 当前最真实的 runtime external seam：host-local composition

### 4.1 `composeWorkspaceWithEvidence(...)` 仍是当前最真实的 runtime 接缝

当前 host runtime 侧最正式的接缝仍是：

- `packages/session-do-runtime/src/workspace-runtime.ts`

它输出：

1. `assembler`
2. `compactManager`
3. `snapshotBuilder`
4. `captureSnapshot()`

这说明 runtime 侧今天真正需要的 external contract 不是“巨大的 context worker API”，而是：

> **一个装配好的 context business-object bundle。**

### 4.2 默认 DO 路径仍是 local-compose，而不是 remote context worker

`NanoSessionDO` 当前如果没有上游提供 `workspace` handle，会自己装：

1. `MountRouter`
2. `WorkspaceNamespace`
3. `InMemoryArtifactStore`
4. `composeWorkspaceWithEvidence(...)`

因此今天的 runtime reality 仍是：

> **host-local composition**

而不是：

> “已经通过 remote worker 在调用 `context.core`”

---

## 5. public inspect/control surface：存在，但仍不是默认 always-on

当前 inspect/control 面仍应这样理解：

1. facade helper 已存在
2. host 必须显式 mount
3. 默认 route 仍不会平白长出 `/inspect/...`

因此 external surface 的正确表述是：

> **opt-in host-mounted facade**

而不是：

> “默认在线的独立 context admin plane”

---

## 6. 当前明确不存在的 external surface

当前仍然**不存在**：

1. live standalone context-core fetch API（除了 probe JSON）
2. default remote compact delegate worker path
3. full semantic context engine API
4. reranker / slot / intent-routing worker surface

所以把今天的 `context.core` 写成“独立 context worker 已上线”会明显过头。

---

## 7. 对 r2 的直接要求

1. **承认 `workers/context-core` shell 已存在。**
2. **把 C1/C2 组合视为当前真正的语义本体。**
3. **把 host-local composition 视为当前真实 runtime seam，而不是空白。**
4. **在 C1/C2 吸收完成前，不把 probe shell 写成 live worker API。**

---

## 8. 本文件的最终判断

**今天 `context.core` 的外部面最成熟的是 package/substrate API 与 host-local composition seam；最不成熟的是“吸收进 worker shell 后的 live worker API”。**

所以 worker-matrix r2 最合理的写法是：

> **以现有 C1/C2 package surface 与 host-local composition 为语义基线，把 `workers/context-core` 从 deploy shell 提升为真正的 context worker，而不是另起一套厚 context API 设计。**
