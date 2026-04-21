# context.core — internal NACP compliance

> 目标：定义 `context.core` 作为薄的 context substrate / 未来 remote worker 时，必须同时遵守的 **NACP-Core / tenant-ref / compact boundary / session stream ownership** 法则。

---

## 0. 先给结论

**`context.core` 今天真正拥有的 formal NACP 面很窄：**

1. **它不是 client-facing session profile owner**，因此不能吞掉 `nacp-session`；
2. **它当前唯一已经冻结的 internal message family 是 `context.compact.request/response`**；
3. **assembly / snapshot / evidence / inspector 目前都还是 package/runtime seam，不应在 worker-matrix first-wave 里被乱扩成新的 wire family。**

---

## 1. 原始素材召回表

### 1.1 原始文档

| 类型 | 原始路径 | 关键行 / 章节 | 用途 |
|---|---|---|---|
| action-plan | `docs/action-plan/after-foundations/B4-context-management-package-async-core.md` | `54-75, 193-203, 205-214` | 说明 B4 的包边界、本来就不包含 B5/B6/NACP 全量扩展 |
| review | `docs/code-review/after-foundations/B2-B4-code-reviewed-by-GPT.md` | `62-70, 201-237` | 说明 inspector 与 session-edge integration 不能被误写成已闭合协议面 |
| evaluation | `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md` | `181-226` | 说明 `context.core` 第一版只应承接 compact / snapshot / evidence 一类薄 contract |
| evaluation | `docs/eval/after-foundations/smind-contexter-learnings.md` | `214-229, 245-259` | 说明 slot/reranker 是未来结构，不是当前 formal wire 面 |

### 1.2 协议源码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| Core context messages | `packages/nacp-core/src/messages/context.ts` | `5-25` | 证明当前唯一 formal 的 context-family 就是 `context.compact.request/response` |
| Core ref law | `packages/nacp-core/src/envelope.ts` | `255-372` | 证明所有 on-wire ref 最终都必须符合 `NacpRefSchema` |
| Session stream | `packages/nacp-session/src/stream-event.ts` | `10-96` | 证明 client-visible compact 反馈属于 `session.stream.event` catalog，而不是 `context.*` client wire |

### 1.3 代码与测试

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| compact boundary mirror | `packages/workspace-context-artifacts/src/compact-boundary.ts` | `1-22, 36-49, 119-213` | 证明本地 compact manager 已按 `context.compact.*` wire shape 组织 |
| cross-package contract | `test/workspace-context-artifacts-contract.test.mjs` | `42-82` | 证明 `CompactBoundaryManager` 产出的 request/response body 能直接过 `nacp-core` schema |
| ref builders | `packages/storage-topology/src/refs.ts` | `1-23, 67-79, 128-166` | 证明 `history_ref / summary_ref` 必须 tenant-prefixed |
| live inspector catalog | `packages/eval-observability/src/inspector.ts` | `23-33, 157-315` | 证明 live compact feedback 仍落在 session 9-kind 目录 |

### 1.4 `context/` 参考实现

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| internal bus memo | `docs/eval/after-foundations/smind-contexter-learnings.md` | `214-229` | 用来提醒：internal orchestration protocol 与 client/session protocol 不应混成一层 |
| director | `context/smind-contexter/context/director.ts` | `139-189, 215-272` | 对照理解“上游先做意图/context 决策，下游再执行”的分层 |
| producer | `context/smind-contexter/context/producer.ts` | `328-357, 364-392` | 对照理解“谁进 prompt”的局部内部 contract，不必先扩大成 public wire |

---

## 2. `context.core` 的协议 ownership：窄而明确

### 2.1 它不是 `nacp-session` 的替身

`context.core` 今天没有任何证据表明自己应直接拥有 client-facing session legality：

- `session.stream.event` 的 canonical 9-kind 目录仍由 `nacp-session` 定义：`packages/nacp-session/src/stream-event.ts:10-96`
- `SessionInspector` 也是按这 9 kinds 做 observer，而不是定义新的 context client protocol：`packages/eval-observability/src/inspector.ts:23-33,157-315`

因此：

> **如果未来把 `context.core` 拆成独立 worker，它也应该站在 internal worker seam 上，而不是越权接管 client/session wire。**

### 2.2 当前唯一 formal 的 context-family 是 `context.compact.*`

`packages/nacp-core/src/messages/context.ts` 今天只注册了两条消息：

1. `context.compact.request`
2. `context.compact.response`

而且 body 已被冻结：

- request：`{ history_ref, target_token_budget }`
- response：`{ status, summary_ref?, tokens_before?, tokens_after?, error? }`

见：`packages/nacp-core/src/messages/context.ts:5-25`

这意味着：

> **“context.core 的协议化”当前只等价于 compact boundary 的协议化，而不等价于整个 context system 都已经有了 wire contract。**

### 2.3 producer role law 已经写死，不能反着来

`context.compact.*` 还带着明确的 producer-role 限制：

| message | allowed producer roles | 含义 |
|---|---|---|
| `context.compact.request` | `session`, `platform` | 发起 compact 的是宿主 / 平台 |
| `context.compact.response` | `capability` | 返回 compact 结果的是下游能力方 |

主证据：`packages/nacp-core/src/messages/context.ts:18-25`

这条 law 对 `context.core` 的直接含义是：

1. 如果它以后是 remote worker，它更像 **capability-style context worker**；
2. `agent.core` / session host 负责发起 compact request，而不是把 client 直接接到 `context.core`；
3. `context.core` 不应该自造“client → context.compact.request”的快捷路径。

### 2.4 `history_ref / summary_ref` 必须服从 tenant-prefixed `NacpRef` law

compact request/response 里的 ref 不是本地字符串，而是 `NacpRefSchema`：

- `history_ref: NacpRefSchema`
- `summary_ref: NacpRefSchema.optional()`

见：`packages/nacp-core/src/messages/context.ts:5-16`

而 `storage-topology` 已经把 ref law 写清楚：

- 所有 ref key 都必须以 `tenants/{team_uuid}/...` 开头：`packages/storage-topology/src/refs.ts:10-23, 67-79`
- `buildDoStorageRef()` / `buildR2Ref()` / `buildKvRef()` 会统一加 tenant prefix：`packages/storage-topology/src/refs.ts:91-150`
- `validateRefKey()` 明确拒绝非 tenant-prefixed key：`packages/storage-topology/src/refs.ts:156-166`

因此：

> **任何 future `context.core` remote seam，都必须把 compact 的 history/summary 指针建立在 tenant-scoped ref 上，而不是裸 key 或 host-local path。**

### 2.5 `CompactBoundaryManager` 已在镜像协议，而不是自造协议

`CompactBoundaryManager` 的模块头已经把自己的职责说得很窄：

- 本地 mirror `context.compact.request/response`
- 负责 strip / reinject compact boundary
- 负责 build/apply，不负责定义新 wire

见：`packages/workspace-context-artifacts/src/compact-boundary.ts:1-22, 36-49`

而 root contract test 直接锁了这条事实：

- `buildCompactRequest(...)` 产物可直接过 `ContextCompactRequestBodySchema`
- `applyCompactResponse(...)` 消费的 body 可直接过 `ContextCompactResponseBodySchema`

见：`test/workspace-context-artifacts-contract.test.mjs:42-82`

这说明当前仓库的正确姿态是：

> **先把 compact boundary 的 wire truth 守住，再决定是否真的把它 remoteize 成独立 worker。**

### 2.6 assembly / snapshot / evidence 目前还不该乱协议化

今天真正存在的 assembly / snapshot / evidence contract 是：

- `ContextAssembler` 的 caller-order + budget contract：`packages/workspace-context-artifacts/src/context-assembler.ts:1-22, 85-167`
- `WorkspaceSnapshotBuilder` 的 fragment contract：`packages/workspace-context-artifacts/src/snapshot.ts:30-49, 122-184`
- `buildAssemblyEvidence / buildCompactEvidence / buildSnapshotEvidence` 这些 evidence records：`packages/workspace-context-artifacts/src/evidence-emitters.ts:24-84, 120-175, 222-282`

但这些都还是：

1. package-local typed seam；
2. runtime evidence seam；
3. host-side eval sink input；

**它们还不是 formal `nacp-core` message family。**

这点与 `smind-contexter` 的经验完全一致：真正厚的 slot/rerank/context producer 本身可以高度结构化，但不代表要先变成 public wire：`context/smind-contexter/context/director.ts:139-189,215-272`; `context/smind-contexter/context/producer.ts:328-357,364-392`

### 2.7 client-visible compact 反馈仍属于 Session stream，不属于 `context.core`

`SessionInspector` 只接受下面 9 kinds：

- `tool.call.progress`
- `tool.call.result`
- `hook.broadcast`
- `session.update`
- `turn.begin`
- `turn.end`
- `compact.notify`
- `system.notify`
- `llm.delta`

见：`packages/eval-observability/src/inspector.ts:23-33`

这里跟 `context.core` 最相关的是：

> **compact 的 client-visible 反馈今天是 `compact.notify`，它属于 `session.stream.event` truth。**

所以未来即便 `context.core` 被 remoteize，它也应该把结果折回 host，再由 host 发 session stream，而不是直接定义新的 client context push family。

---

## 3. 历史设想与当前代码真相的分歧表

| 主题 | 容易被误读的旧口径 | 当前代码真相 | 当前应采用的判断 |
|---|---|---|---|
| `context.core` 协议面 | 容易被想成“上下文系统都应该有 NACP family” | 当前只有 `context.compact.request/response` 是 formal family：`packages/nacp-core/src/messages/context.ts:5-25` | 以**窄协议面**为准 |
| inspector 面 | 容易被写成“context worker 自己就是 public inspect service” | 当前只有 `mountInspectorFacade(...)` opt-in helper：`packages/context-management/src/inspector-facade/index.ts:313-371` | 以**helper-only / host-mounted**为准 |
| assembly/snapshot | 容易被顺手写成 remote protocol | 当前仍是 package-local typed seam + evidence seam：`packages/workspace-context-artifacts/src/context-assembler.ts:66-167`; `packages/workspace-context-artifacts/src/snapshot.ts:122-184` | 以**非协议化**为准 |

---

## 4. 对后续 `context.core` 设计的直接要求

1. **不要让 `context.core` 越权接管 `nacp-session`。**
2. **如果要拆 remote worker，先只 remoteize `context.compact.*`，不要把 assembly/snapshot/evidence 一起乱上 wire。**
3. **所有 compact refs 必须继续服从 tenant-prefixed `NacpRef` law。**
4. **任何 client-visible compact 反馈都必须折回 `session.stream.event`，而不是让 `context.core` 自己发客户端协议。**
5. **slot / reranker / intent-routing 在真正 freeze 之前，不应被包装成 formal NACP family。**

---

## 5. 本文件的最终判断

从 internal NACP compliance 角度看，`context.core` 的正确姿态不是“所有 context 行为都先协议化”，而是：

> **把 `context.compact.request/response` 作为当前唯一 formal context wire，把 assembly/snapshot/evidence 继续留在 typed runtime seam，把 client-visible compact feedback 留在 session stream。**

这也是 worker-matrix first-wave 里最稳、最不容易漂移的 `context.core` 协议边界。
