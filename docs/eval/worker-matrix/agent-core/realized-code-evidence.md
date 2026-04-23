# agent.core — realized code evidence

> 目标：只基于当前代码与当前 closure truth，回答 `agent.core` 现在已经有什么、还缺什么。

---

## 0. 先给结论

**`agent.core` 现在最准确的代码判断是：worker shell 已 materialize 并已完成 real preview deploy；host runtime substrate 仍主要停留在 `@nano-agent/session-do-runtime`；默认 live turn loop 仍未装配完成。**

---

## 1. 当前最重要的代码锚点

| 层 | 路径 | 当前用途 |
|---|---|---|
| worker shell | `workers/agent-core/package.json`; `wrangler.jsonc`; `src/index.ts`; `src/nano-session-do.ts`; `test/smoke.test.ts` | 证明 deploy-shaped shell、DO stub、preview shape、shell smoke |
| host runtime | `packages/session-do-runtime/src/worker.ts`; `env.ts`; `composition.ts`; `remote-bindings.ts`; `do/nano-session-do.ts` | 证明真实 host runtime substrate |
| phase truth | `docs/issue/pre-worker-matrix/W4-closure.md`; `docs/design/pre-worker-matrix/W3-absorption-map.md` | 证明 shell 已存在、A1-A5 仍待吸收 |

---

## 2. 已经真实存在的 worker shell

### 2.1 `workers/agent-core` 已经是 deploy-shaped 目录

直接证据：

- `workers/agent-core/package.json:1-24`
- `workers/agent-core/wrangler.jsonc:1-51`
- `workers/agent-core/src/index.ts:1-24`
- `workers/agent-core/src/nano-session-do.ts:1-17`
- `workers/agent-core/test/smoke.test.ts:1-39`

当前 shell 已经真实具备：

1. `build / typecheck / test / deploy:dry-run / deploy:preview` 脚本
2. `SESSION_DO` binding
3. Worker fetch handler
4. `NanoSessionDO` stub
5. 对 NACP published truth 的 probe 输出

### 2.2 `agent-core` preview deploy 已不是文档猜想

当前 closure / handoff 已明确：

1. preview deploy 已完成：`docs/issue/pre-worker-matrix/W4-closure.md:18-27`
2. live probe URL 已存在：`docs/handoff/pre-worker-matrix-to-worker-matrix.md:112-115`

所以从代码+部署角度看，`agent.core` 当前已经跨过了“是否具备 deploy shell”这个问题。

---

## 3. 当前 shell 还没有承接的 runtime 真相

### 3.1 当前 shell 仍只是 version probe + DO stub

`workers/agent-core/src/index.ts:6-24` 当前只返回：

- `worker`
- `nacp_core_version`
- `nacp_session_version`
- `status`
- `phase`

`workers/agent-core/src/nano-session-do.ts:3-17` 当前只返回：

- `worker`
- `role`
- `status`

因此当前 shell 还**没有**：

1. WebSocket upgrade
2. HTTP fallback actions
3. checkpoint / replay / ack / heartbeat
4. runtime composition

---

## 4. 已真实存在的 host substrate 仍在 `session-do-runtime`

### 4.1 Worker/DO host 原型仍在 package 内

最直接的当前代码真相仍是：

- `packages/session-do-runtime/src/worker.ts:1-89`
- `packages/session-do-runtime/src/do/nano-session-do.ts`
- `packages/session-do-runtime/package.json:1-40`

它说明：

1. `@nano-agent/session-do-runtime@0.3.0` 仍是当前 host substrate
2. Worker entry + DO host + runtime env catalog + composition helpers 依然都在这个 package 中

### 4.2 default composition 仍是空 handle bag

当前最关键的 readiness 证据仍是：

- `packages/session-do-runtime/src/composition.ts:82-106`

其中：

- `kernel: undefined`
- `llm: undefined`
- `capability: undefined`
- `workspace: undefined`
- `hooks: undefined`
- `eval: undefined`
- `storage: undefined`

这意味着当前 host substrate 仍不能被写成“默认 live agent loop 已闭合”。

### 4.3 remote composition 仍只接了部分 seam

当前真实状态：

- `packages/session-do-runtime/src/remote-bindings.ts:324-399`

已经接上的：

1. `llm` fake-provider fetcher
2. `capability` service-binding transport
3. `hooks` minimal remote handle

仍未接上的：

1. `kernel`
2. `workspace`
3. `eval`
4. `storage`

### 4.4 `initial_context` 仍没有 host consumer

当前代码搜索结果仍是：

1. `packages/session-do-runtime/src/` 中无 `initial_context` / `appendInitialContextLayer`
2. `packages/context-management/src/` 中也无当前 host consumer 接线

因此 `initial_context` 仍只能被写成：

> **wire 已冻结，host assembly 仍待实现。**

---

## 5. W3/W4 之后，`agent.core` 的代码真相应如何描述

| 维度 | 当前真相 | 不应写成什么 |
|---|---|---|
| worker shell | 已存在，且 preview deploy 已完成 | 还没有 deploy baseline |
| DO slot | 已存在 | 还要先论证 host 是否用 DO |
| host substrate | 已存在于 `session-do-runtime` | 还是纯概念图 |
| live turn loop | 仍未闭合 | 已默认具备 kernel+llm+workspace mainline |
| cross-worker assembly | 仍未激活 | 已 live 连到 `bash.core / context.core / filesystem.core` |

---

## 6. 对 r2 的直接含义

从 realized code evidence 角度看，`agent.core` 现在最合理的工作描述应是：

1. **吸收 A1 host shell substrate**
2. **接入 A2 kernel**
3. **接入 A3 llm**
4. **接入 A4 hooks residual**
5. **接入 A5 eval / trace seam**
6. **把当前 shell 从 probe/stub 提升为 live host runtime**

这与 W3 map 完全一致：`docs/design/pre-worker-matrix/W3-absorption-map.md:31-39,46-77`

---

## 7. 本文件的最终判断

**`agent.core` 现在已经拥有“可部署的外壳”和“可吸收的宿主原型”，但还没有拥有“默认闭合的 live runtime”。**

因此 worker-matrix r2 不应再纠缠于“是否先造壳”，而应明确把主任务写成：

> **host substrate absorption + default composition closure + downstream seam activation sequencing。**
