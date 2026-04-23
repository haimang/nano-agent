# context.core — internal NACP compliance

> 目标：定义 `context.core` 在 pre-worker 之后、r2 之前真正拥有的协议责任。

---

## 0. 先给结论

**W4 新增了 `workers/context-core` shell，但没有改变 `context.core` 的协议 ownership：它今天真正 formal 的 protocol 面仍然很窄。**

1. **它不是 client-facing session profile owner**
2. **它当前唯一已经冻结的 context-family 仍是 `context.compact.request/response`**
3. **assembly / snapshot / evidence / inspector 仍主要是 typed runtime seam，不应被顺手扩成一串新 wire family**

---

## 1. 当前最该看的直接证据

| 类型 | 路径 | 用途 |
|---|---|---|
| W3/W4 truth | `docs/design/pre-worker-matrix/W3-absorption-map.md`; `W3-absorption-blueprint-workspace-context-artifacts-split.md`; `docs/issue/pre-worker-matrix/W4-closure.md` | 说明 shell 已 materialize，但 C1/C2 protocol reality 仍主要在 packages 中 |
| formal wire | `packages/nacp-core/src/messages/context.ts`; `packages/workspace-context-artifacts/src/compact-boundary.ts` | 当前唯一 formal 的 context-family |
| current packages | `packages/context-management/src/*`; `packages/workspace-context-artifacts/src/*` | 当前真实 seam 与 helper |
| runtime evidence | `packages/session-do-runtime/src/workspace-runtime.ts`; `packages/session-do-runtime/src/do/nano-session-do.ts` | 说明这些 seam 今天仍主要由 host runtime locally compose |
| shell evidence | `workers/context-core/src/index.ts` | 说明 W4 shell 还没有拥有独立 protocol runtime |

---

## 2. 当前必须保留的协议 ownership

| 面向对象 | 正确协议层 | 当前判断 |
|---|---|---|
| client ↔ host | `@haimang/nacp-session` | 不是 `context.core` 的职责 |
| host ↔ context seam | `@haimang/nacp-core` 的 `context.compact.*` | 当前真正 formal 的 context-family 只有这一条 |
| `context.core` 自己的其余 contract | typed runtime seam | assembly / snapshot / evidence / inspector 仍不应被误写成 formal wire |

最重要的一句话没有变：

> **如果 `context.core` 被独立成 worker，它也应该站在 internal worker seam 上，而不是越权接管 session/client wire。**

---

## 3. 当前仍必须原样继承的几条 law

### 3.1 `context.compact.*` 继续是唯一 formal context-family

当前正式真相仍是：

- `packages/nacp-core/src/messages/context.ts`
- `packages/workspace-context-artifacts/src/compact-boundary.ts`

因此：

1. request / response body shape 继续以 `nacp-core` 为准
2. `CompactBoundaryManager` 继续只做 mirror / build / apply，不发明第二套 wire
3. worker-matrix r2 不应把 assembly / snapshot / evidence 顺手扩成新的 `context.*` message family

### 3.2 producer-role law 仍不应反着来

当前 `context.compact.*` 的 producer-role truth 仍冻结在 `nacp-core` 中：

1. `context.compact.request` 由 `session` / `platform` 发起
2. `context.compact.response` 由 `capability` 返回

这意味着：

> 即使未来 `context.core` remoteize，它也更像 capability-style context worker，而不是 client-facing session endpoint。

### 3.3 tenant-prefixed ref law 仍是 compact / summary / history 指针前提

当前 compact request/response 里的 refs 仍依赖 `NacpRef` 语义；storage-topology 仍要求：

- 所有对外 refs 都 tenant-prefixed
- 裸 key 不能充当 cross-package ref

因此任何 future `context.core` remote seam 都必须继续建立在 tenant-scoped refs 上。

### 3.4 assembly / snapshot / evidence 仍主要是 typed runtime seam，不是 formal wire

当前真实存在的是：

1. `ContextAssembler` contract
2. `WorkspaceSnapshotBuilder` fragment contract
3. `buildAssemblyEvidence / buildCompactEvidence / buildSnapshotEvidence`

这些都很重要，但它们今天仍是：

- package-local typed seam
- host/runtime evidence seam
- future absorption target

而不是已经 formalized 的 NACP family。

### 3.5 client-visible compact feedback 仍属于 Session stream

当前 client-visible compact/lifecycle feedback 仍应折回：

- `session.stream.event`

而不是让 `context.core` 自己定义一套 client push family。  
W4 shell 的出现并没有改变这条边界。

### 3.6 `initial_context` 仍是 shared adjacent work，而不是 `context.core` 已完成能力

当前代码搜索结果仍是：

1. `packages/context-management/src` 中无 `initial_context` / `appendInitialContextLayer`
2. `packages/session-do-runtime/src` 中也无当前 host consumer

因此 r2 最多只能写：

> **`initial_context` 对 `context.core` 是 adjacent shared deliverable，不是当前已被 C1/C2 吸收并完成的 formal capability。**

---

## 4. W4 shell 出现后，哪些东西没有变化

| 变化 | 是否改变协议 ownership | 为什么 |
|---|---|---|
| `workers/context-core` 目录存在 | **否** | 只是 deploy shell materialized |
| `workers/context-core/src/index.ts` 返回 probe JSON | **否** | 这是 shell identity，不是 context protocol runtime |
| W4 dry-run 通过 | **否** | 证明 deploy path 真实，不证明 `context.compact.*` 已在该目录中 live 承载 |

---

## 5. 对 r2 的直接纪律

1. **继续把 `context.compact.*` 当成当前唯一 formal context-family。**
2. **继续让 `assembly / snapshot / evidence` 保持 typed runtime seam，除非有新的正式协议冻结。**
3. **继续把 client-visible compact feedback 折回 `session.stream.event`。**
4. **继续把 tenant-prefixed refs 视为 compact/history/summary 指针前提。**
5. **在 C1/C2 真正吸收前，不把 `workers/context-core` 写成已拥有 live protocol runtime 的 worker。**

---

## 6. 本文件的最终判断

**pre-worker 之后，`context.core` 的协议 reality 没有被 worker shell 稀释：formal protocol 仍然窄，真正重要的仍是 compact wire 与 typed runtime seam 的分层。**

所以 worker-matrix r2 应把重点放在：

> **如何把 C1/C2 现有 contract 吸收到 `workers/context-core/` 内，而不是顺势发明一套更厚的新 context wire。**
