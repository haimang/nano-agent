# LLM Wrapper Core-Gap — claude-code vs nano-agent

> Reviewer: GPT-5.4  
> Date: 2026-05-02  
> Scope baseline: `context/claude-code/` 真实 llm-wrapper 代码 + `workers/{agent-core,orchestrator-core,context-core}/` 当前实现 + `clients/api-docs/` 当前 public contract + `docs/charter/plan-hero-to-pro.md` + `docs/action-plan/hero-to-pro/{HPX5-wire-up-action-plan,HPX6-workbench-action-plan}.md`  
> 引用纪律: 文中所有 `path:Lx-Ly` 均为一手代码/文档引用。

---

## 0. TL;DR（先给定论）

**结论一句话**：nano-agent **已经足够支撑一个“WebSocket-first 的基础 workbench client”**——可以启动 session、流式收消息、切模型、查 usage、看 tool-calls / items / workspace / todos / confirmations / context probe；但它**还不够支撑一个“成熟、完整、自主闭环”的前端 agent loop**。最硬的断点不是“端点数量不够”，而是 **若干看起来已经存在的 control plane 仍然只有 schema / 存储 / façade，没有真正进入 loop**。这与 charter 想达到的“成熟 LLM wrapper 控制平面”还有明确距离（`docs/charter/plan-hero-to-pro.md:L8-L15`, `docs/charter/plan-hero-to-pro.md:L49-L59`, `docs/charter/plan-hero-to-pro.md:L159-L178`, `docs/charter/plan-hero-to-pro.md:L187-L201`）。

**我确认的 6 条阻断级断点**：

1. **`approval_policy=ask` 不是 Claude/Codex 式 pause-and-resume，而是立即报错**：tool ask 没有进入 confirmation wait state，前端无法做“用户批准后原 turn 继续”的真实 HITL。证据见 `workers/agent-core/src/host/runtime-mainline.ts:L229-L255`, `workers/agent-core/src/host/do/session-do-runtime.ts:L376-L395`, `workers/agent-core/src/kernel/types.ts:L40-L59`, `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:L141-L150`。
2. **auto-compact 在 live loop 里仍是假的**：runtime 已能 probe compact-required，但 compact delegate 仍固定返回 `tokensFreed: 0`，因此 loop 不具备 claude-code 式自主压缩能力。证据见 `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:L279-L312`, `workers/agent-core/src/host/runtime-mainline.ts:L813-L816`。
3. **`/runtime` 里的 `network_policy / web_search / workspace_scope` 目前只是可读写文档，不是执行期约束**：真正进入 tool 决策的只有 `permission_rules` 与 `approval_policy`。证据见 `workers/orchestrator-core/src/runtime-config-plane.ts:L100-L145`, `workers/orchestrator-core/src/entrypoint.ts:L322-L373`, `clients/api-docs/runtime.md:L12-L40`。
4. **fallback / retry / streaming recovery 不是一等公民**：live path 直接走 `WorkersAiGateway.executeStream()`，没有 claude-code 那种 `withRetry`、streaming-fallback tombstone、request-chain continuity；而且 model fallback 元数据根本没有从 agent-core 流出。证据见 `workers/agent-core/src/host/runtime-mainline.ts:L445-L479`, `workers/agent-core/src/llm/gateway.ts:L281-L339`, `workers/agent-core/src/llm/adapters/workers-ai.ts:L282-L307`, `workers/orchestrator-core/src/user-do/message-runtime.ts:L403-L439`。
5. **reasoning object layer 目前是“schema 在、投影在、生产者不在”**：item projection 只有在 durable `llm.delta(content_type=reasoning|reasoning_summary)` 存在时才会产出 reasoning item，但 live adapter 现在只发 `text` / `tool_use_*`。证据见 `workers/agent-core/src/kernel/types.ts:L126-L137`, `workers/agent-core/src/llm/session-stream-adapter.ts:L61-L84`, `workers/orchestrator-core/src/item-projection-plane.ts:L67-L78`。
6. **retry / fork / restore 这些“高级工作流按钮”还不是 completed semantics**：public API 已经暴露这些入口，但 executor 真实执行深度仍不够；`retry/fork` 当前在 executor runtime 中直接短路，`restore` 明确只到 `partial`。证据见 `clients/api-docs/session.md:L223-L259`, `workers/orchestrator-core/src/executor-runtime.ts:L60-L97`, `clients/api-docs/session-ws-v1.md:L186-L200`。

**因此，当前 nano-agent 的真实状态更准确地说是**：

- **能做**：一个具备模型切换、WS 流、tool/workspace/items inspector、manual compact、todo/confirmation 列表的 **first-wave web client**。  
- **还不能做**：一个像 claude-code 一样，能在长对话、自主 compact、ask-policy、streaming fallback、turn-level recover 这些环节 **稳定自闭环** 的 mature wrapper 前端。

---

## 1. claude-code 的 llm wrapper 在做什么（作为度量尺）

我这次不把 claude-code 当“功能清单”，而是把它当 **成熟 wrapper 该在哪些层面闭环** 的度量尺。

### 1.1 它不是单个 `/messages` 调用，而是一整套 query runtime

`QueryEngine` 在结果尾部返回的是一个**聚合后的 result envelope**，其中已经包含 `usage`、`modelUsage`、`permission_denials`、`fast_mode_state` 等前端/SDK 直接可消费的字段，而不是把这些信息拆散到多个旁路接口里（`context/claude-code/QueryEngine.ts:L618-L637`）。

### 1.2 它的主 loop 自带 compact / fallback / budget / continuity

`query.ts` 在同一条 loop 内做：

- microcompact / snip / context-collapse / autocompact（`context/claude-code/query.ts:L365-L546`）
- task budget 累积与跨 compact 递减（`context/claude-code/query.ts:L193-L198`, `context/claude-code/query.ts:L504-L515`, `context/claude-code/query.ts:L699-L706`）
- streaming fallback 时 tombstone orphaned partial messages，并丢弃旧 tool executor 结果，保证 transcript 与 UI 不被半路污染（`context/claude-code/query.ts:L650-L740`）

### 1.3 它把 retry / capacity / stale-connection 当作 live path 的一部分

`withRetry()` 不是外围 util，而是 live API path 的组成部分：它区分 foreground 529 retry、persistent unattended retry、OAuth/401 refresh、stale keep-alive socket、429/529 连续错误与 fallback 触发（`context/claude-code/services/api/withRetry.ts:L57-L110`, `context/claude-code/services/api/withRetry.ts:L170-L257`）。

### 1.4 它把 tool execution 当作流式状态机，而不是“只有结果”

`toolOrchestration.ts` 按 concurrency safety 分批并发/串行执行工具（`context/claude-code/services/tools/toolOrchestration.ts:L19-L82`）；`StreamingToolExecutor.ts` 明确维护 `queued / executing / completed / yielded`，并处理 sibling error、user interruption、streaming fallback discard（`context/claude-code/services/tools/StreamingToolExecutor.ts:L19-L76`, `context/claude-code/services/tools/StreamingToolExecutor.ts:L126-L231`）。

### 1.5 它把 context management 与 thinking/model capability 放进 request builder

- API-native microcompact / clear-thinking / clear-tool-uses：`context/claude-code/services/compact/apiMicrocompact.ts:L63-L153`
- `ThinkingConfig = adaptive | enabled{budgetTokens} | disabled`，并带 provider-aware support check：`context/claude-code/utils/thinking.ts:L10-L13`, `context/claude-code/utils/thinking.ts:L88-L144`
- model capability 动态拉取并缓存 `max_input_tokens / max_tokens`：`context/claude-code/utils/model/modelCapabilities.ts:L19-L27`, `context/claude-code/utils/model/modelCapabilities.ts:L75-L117`

**这组事实非常重要**：claude-code 的“成熟”不是因为端点多，而是因为 **这些控制逻辑已经在同一条 loop 内真实生效**。

---

## 2. nano-agent 当前已经够前端用到什么程度

如果只看 public surfaces，nano-agent 现在并不贫瘠。相反，它已经具备一套相当完整的 **web-first workbench surface**：

| 能力 | 当前 surface | 一手证据 |
|------|--------------|----------|
| session 生命周期 + transport | `/start` / `/input` / `/messages` / `/status` / `/timeline` / `/history` / `/resume` / `/retry` / `/fork` | `clients/api-docs/session.md:L17-L52`, `clients/api-docs/session.md:L89-L147`, `clients/api-docs/session.md:L168-L205`, `clients/api-docs/session.md:L223-L259` |
| WS attach / replay / heartbeat / top-level workbench frames | `last_seen_seq`、`session.runtime.update`、`session.item.*`、`session.restore.completed` | `clients/api-docs/session-ws-v1.md:L11-L31`, `clients/api-docs/session-ws-v1.md:L152-L200` |
| model 目录 + session default model | `/models`、`/models/{id}`、`/sessions/{id}/model` | `clients/api-docs/models.md:L13-L30`, `clients/api-docs/models.md:L34-L74`, `clients/api-docs/models.md:L89-L124`, `clients/api-docs/models.md:L136-L220` |
| context probe / layers / manual compact preview / job handle | `/context` family | `clients/api-docs/context.md:L12-L22`, `clients/api-docs/context.md:L26-L56`, `clients/api-docs/context.md:L101-L180` |
| runtime / permission rule 文档面 | `/sessions/{id}/runtime` | `clients/api-docs/runtime.md:L12-L40`, `clients/api-docs/runtime.md:L42-L84` |
| Codex-style object layer | `/sessions/{id}/items`、`/items/{item_uuid}` | `clients/api-docs/items.md:L8-L38`, `clients/api-docs/items.md:L39-L58` |
| tool-call ledger | `/sessions/{id}/tool-calls` list/detail/cancel | `clients/api-docs/tool-calls.md:L8-L41` |
| workspace/artifact/files | artifact CRUD + workspace metadata + workspace bytes | `clients/api-docs/workspace.md:L13-L33`, `clients/api-docs/workspace.md:L123-L150` |
| todo / confirmation control planes | `/todos`、`/confirmations` | `clients/api-docs/todos.md:L13-L28`, `clients/api-docs/todos.md:L31-L48`, `clients/api-docs/confirmations.md:L13-L38`, `clients/api-docs/confirmations.md:L55-L120` |

**所以问题不在“没有 API”**。问题在于：**这些 surface 里有相当一部分还没有真正进入 loop，或者进入得不够深。**

---

## 3. 阻断级断点（这些问题会直接阻止“完整 agent loop”成立）

### 3.1 B1 — `approval_policy=ask` 现在不会暂停 turn，只会把 tool 调用变成错误

当前 live tool authorization 走的是 `authorizeToolPlan()`：

- `decision === "allow"` → 继续
- `decision === "ask"` → 返回错误 `tool-permission-required`
- `decision === "deny"` → 返回错误 `tool-permission-denied`

证据在 `workers/agent-core/src/host/runtime-mainline.ts:L229-L255`。这里**没有**：

1. 创建 confirmation row  
2. emit `session.confirmation.request`  
3. 将 kernel 置入 `confirmation_pending`  
4. 用户 decision 后恢复同一个 turn

而另一方面，底层其实已经准备了“正确姿势”的骨架：

- kernel interrupt enum 里已经有 `confirmation_pending`（`workers/agent-core/src/kernel/types.ts:L40-L59`）
- DO runtime 已经有 `emitPermissionRequestAndAwait()`，会先发 `session.permission.request` 再等待异步回答（`workers/agent-core/src/host/do/session-do-runtime.ts:L376-L395`）
- runtime assembly 的注释还明确写着“future HP5 P3 wiring (PreToolUse permission, elicitation alias)”（`workers/agent-core/src/host/do/session-do/runtime-assembly.ts:L141-L150`）

**这说明当前不是“没有设计”，而是“设计骨架存在，但 live caller 没接上”。**

**对前端的直接影响**：

- `/runtime` 把 `approval_policy=ask` 暴露给了客户端（`clients/api-docs/runtime.md:L17-L40`），但当前前端一旦真把 session 设为 ask，tool 不会进入 HITL，而会直接失败。  
- 这会让前端以为自己拿到了 claude-code / codex 风格的 approval loop，实际得到的是“一个带 ask 文案的 hard error”。

**对标 claude-code**：它的 loop 至少把 permission_denials 作为 result envelope 的一部分返回（`context/claude-code/QueryEngine.ts:L629-L631`），并把工具执行状态保持在活跃 loop 里，而不是把 ask 直接拍成终态错误。

---

### 3.2 B2 — elicitation 也是同样的问题：answer path 在，request producer 不在

当前 agent-core DO runtime 也已经有 `emitElicitationRequestAndAwait()`（`workers/agent-core/src/host/do/session-do-runtime.ts:L397-L414`），orchestrator-core 也有 `elicitation/answer` 的 durable path（`workers/orchestrator-core/src/user-do/surface-runtime.ts:L443-L528`）。

但我在当前 live loop 中**没有看到任何实际 caller** 去触发这个 request path。结果是：

- answer path 有
- row/decision plane 有
- live producer 没有

这与 `clients/api-docs/confirmations.md` 中“`elicitation` 已有 live caller”的文档口径并不一致（`clients/api-docs/confirmations.md:L9-L10`, `clients/api-docs/confirmations.md:L28-L38`）。

**对前端的直接影响**：如果你要做“模型主动向用户提问 → 用户回答 → 同一条 loop 继续”的 agent workbench，当前 API 面**没有真正跑通这条业务链**。

---

### 3.3 B3 — auto-compact 现在是“会检测、不会真正 compact”

这条是我本轮调查里最硬的一条。

当前 runtime assembly 已经会从 orchestrator 读取 durable context state，并计算 `used >= auto_compact_token_limit`，把它 wiring 到 `probeCompactRequired`（`workers/agent-core/src/host/do/session-do/runtime-assembly.ts:L279-L312`）。

但真正的 compact delegate 仍然是：

```ts
compact: {
  async requestCompact() {
    return { tokensFreed: 0 };
  }
}
```

证据：`workers/agent-core/src/host/runtime-mainline.ts:L813-L816`。

这意味着当前 live loop 的真实状态是：

1. 能 probe “该 compact 了”
2. scheduler 也可能走 compact branch
3. 但 compact 执行本身**没有真实释放上下文**

与之相对，orchestrator/context 侧其实已经有相对完整的 manual compact substrate：

- durable context state read：`workers/orchestrator-core/src/context-control-plane.ts:L315-L341`
- manual snapshot / compact boundary job：`workers/orchestrator-core/src/context-control-plane.ts:L394-L417`
- public `/context/compact` / `/context/compact/jobs/{id}` 文档面：`clients/api-docs/context.md:L132-L180`

**所以当前真实结论不是“没有 compact”**，而是：

- **manual compact surface 已经有了**
- **agent loop 自主 compact 还没有**

**对前端的直接影响**：

- 你可以做一个“用户点按钮手动 compact”的 UI。  
- 但你还不能做一个 claude-code 式“长对话自己压缩、自己恢复、继续跑”的成熟 loop。

**对标 claude-code**：它把 microcompact / autocompact / reactive compact / PTL retry 都放在同一条 query loop 里（`context/claude-code/query.ts:L365-L546`, `context/claude-code/services/compact/compact.ts:L133-L260`, `context/claude-code/services/compact/apiMicrocompact.ts:L63-L153`）。nano-agent 现在还没有到这一步。

---

### 3.4 B4 — `/runtime` 里 3 个字段目前只是“存起来给你看”，不是执行期约束

`/runtime` 的 public 文档把以下字段都列为 runtime document 的一部分：

- `network_policy`
- `web_search`
- `workspace_scope`
- `approval_policy`
- `permission_rules`

见 `clients/api-docs/runtime.md:L17-L40`。

它们也确实会被 `D1RuntimeConfigPlane.patch()` 持久化（`workers/orchestrator-core/src/runtime-config-plane.ts:L100-L145`）。

但是，真正进入 tool execution 决策的代码只有 `authorizeToolUse()`，而这个函数只读取：

1. session `permission_rules`
2. tenant `permission_rules`
3. `approval_policy`

证据：`workers/orchestrator-core/src/entrypoint.ts:L345-L372`。

**这里完全没有 `network_policy` / `web_search` / `workspace_scope` 的执行期检查。**

因此当前 `/runtime` 的更准确描述应该是：

- `permission_rules` / `approval_policy`：**部分真实生效**
- `network_policy` / `web_search` / `workspace_scope`：**当前更像 durable config document，而不是 enforced policy**

**对前端的直接影响**：

- 前端如果把这 3 个字段直接做成“runtime 生效开关”，会误导用户。  
- 当前它们更适合作为“未来可治理字段 / UI 预留”，而不是“已落地的执行控制项”。

这也是一个**业务断点**：前端已经能 PATCH，用户也能读回新值，但 loop 本身不会遵守这些限制。

---

### 3.5 B5 — fallback / retry / stream-recovery 还不是 wrapper 的一等事实

当前 live mainline 调 LLM 的路径是：

1. `createMainlineKernelRunner()`  
2. `WorkersAiGateway.executeStream()`  
3. `invokeWorkersAi()`

证据链：

- `workers/agent-core/src/host/runtime-mainline.ts:L445-L479`
- `workers/agent-core/src/llm/gateway.ts:L281-L339`
- `workers/agent-core/src/llm/adapters/workers-ai.ts:L282-L307`

这里有 3 个问题叠在一起：

#### 3.5.1 live path 没有 claude-code 那种 retry/watchdog/request-chain

claude-code 的 live path 明确带 `withRetry()` 与 streaming fallback recovery（`context/claude-code/services/api/withRetry.ts:L57-L110`, `context/claude-code/services/api/withRetry.ts:L170-L257`, `context/claude-code/query.ts:L650-L740`）。

nano-agent 当前 live path 里没有这些控制逻辑；`WorkersAiGateway.executeStream()` 只是把 provider chunk 正常化后向上抛，出错时给一个 error event（`workers/agent-core/src/llm/gateway.ts:L281-L339`）。

#### 3.5.2 fallback 是 adapter 内部行为，但没有向上层公开为“发生过 fallback”

`invokeWorkersAi()` 会把 `modelId + hard-coded fallback model` 组成 `modelIds` 列表，依次尝试（`workers/agent-core/src/llm/adapters/workers-ai.ts:L282-L307`）。  
但它**没有返回**：

- 是否用了 fallback
- 原 requested model
- 最终 fallback model
- fallback reason

而 orchestrator 一侧其实正等着这些字段来关 turn 并 emit `model.fallback`：

- `workers/orchestrator-core/src/user-do/message-runtime.ts:L403-L439`

**也就是说：下游已经准备好了，live 上游没有把 fallback 事实抬出来。**

#### 3.5.3 model metadata 里的 `fallback_model_id` 也没有被 live path 使用

`nano_models` / `/models/{id}` detail 已经把 `fallback_model_id` 做成了 model metadata 的一部分（`workers/orchestrator-core/src/session-truth.ts:L378-L409`, `workers/orchestrator-core/src/session-truth.ts:L444-L493`, `clients/api-docs/models.md:L96-L118`）。

但 live 执行路径并没有把这个 per-model metadata 传给 adapter；当前 adapter 仍然使用硬编码的 `WORKERS_AI_FALLBACK_MODEL`（`workers/agent-core/src/llm/adapters/workers-ai.ts:L8-L10`, `workers/agent-core/src/llm/adapters/workers-ai.ts:L282-L307`）。

**这会产生一个非常具体的产品断点**：

- 前端读到了“这个模型的 fallback 策略”
- 实际执行时 backend 并不遵守它

---

### 3.6 B6 — reasoning item / reasoning stream 目前还是“投影先行，生产者缺席”

agent-core kernel type 明确允许 `llm.delta.contentType = "thinking"`（`workers/agent-core/src/kernel/types.ts:L126-L137`）。

但 live stream adapter 现在只把：

- 普通 delta → `llm.delta(content_type="text")`
- tool_call → `llm.delta(content_type="tool_use_start")`

证据：`workers/agent-core/src/llm/session-stream-adapter.ts:L61-L84`。

另一方面，item projection 只有在 durable message 满足：

- `message_kind === "stream-event"`
- `body.kind === "llm.delta"`
- `content_type === "reasoning" | "reasoning_summary"`

时，才会投影成 `reasoning` item（`workers/orchestrator-core/src/item-projection-plane.ts:L67-L78`）。

**所以当前 reasoning 面的真实状态是**：

- schema/type 有
- item kind 有
- live producer 没有

**对前端的直接影响**：

- `/models` 可以告诉你某模型支持 reasoning（`workers/orchestrator-core/src/session-truth.ts:L363-L408`）  
- 但当前前端拿不到 reasoning trace / reasoning item 来渲染 reasoning panel

这不是“体验损失”，而是 **API 语义自相矛盾**：capability surface 与 observable surface 还没有闭合。

---

## 4. 高等级但非首要阻断的缺口

### 4.1 H1 — advanced workflow surface 已公开，但 deep semantics 仍未完成

`/retry` 与 `/fork` 已经以 202/queue-enqueued 的工作流 API 形状对外暴露（`clients/api-docs/session.md:L223-L259`），但当前 executor runtime 中：

- `job.kind !== "restore"` 时直接 `return { ok: true, job_uuid }`
- 并没有实际 retry/fork 执行逻辑

证据：`workers/orchestrator-core/src/executor-runtime.ts:L60-L66`。

restore 也不是 full semantics，而是显式写成 `partial`（`workers/orchestrator-core/src/executor-runtime.ts:L70-L97`, `clients/api-docs/session-ws-v1.md:L186-L200`）。

**这类 surface 对前端不是“不可做”**，但会形成一个危险的错觉：  
前端会以为这些按钮已经代表成熟工作流，实际上现在更像 **workbench-grade placeholders with truthful terminal state**。

### 4.2 H2 — 当前缺少一个 QueryEngine 式的 turn/result 聚合对象

claude-code 在 `QueryEngine` 尾部给 SDK/前端的是一整个 result envelope（`context/claude-code/QueryEngine.ts:L618-L637`）。

nano-agent 当前 public 事实被拆在多处：

- start/input/messages ack：`clients/api-docs/session.md:L53-L87`
- usage：单独 `/sessions/{id}/usage`
- tool-calls：单独 ledger
- items：单独 projection
- model fallback：理论上走 WS，但 live producer 不完整

**这不阻止一个富前端自己拼 reducer**，但会让一个薄客户端 / SDK 客户端明显更难做。  
我把它判为 **高等级摩擦**，不是 blocker。

### 4.3 H3 — docs 里有两处“比代码更乐观”的表述，前端容易被误导

1. `clients/api-docs/confirmations.md` 把 `tool_permission` / `elicitation` 写成已有 live caller（`clients/api-docs/confirmations.md:L9-L10`, `clients/api-docs/confirmations.md:L28-L38`），但当前 live loop 中 ask-path / elicitation-path 的 producer 并没有真正接通到 pause-resume。  
2. `clients/api-docs/session-ws-v1.md` 把 `model.fallback` 写成 live（`clients/api-docs/session-ws-v1.md:L59-L76`），但 agent-core live path 没有对外产出 fallback metadata，orchestrator 的 emit 条件因此难以成立（`workers/orchestrator-core/src/user-do/message-runtime.ts:L403-L439`）。

这类问题不是“文档小漂移”，而是会让前端**按错业务假设建 reducer**。

---

## 5. 回到“前端能不能做”的最终判断

### 5.1 如果目标是 first-wave client：**可以**

如果你的目标是一个 **web-first、workbench 风格、用户可手动干预较多** 的前端，当前 API 已经足够做出：

1. session list / conversation detail / start / follow-up / resume / history
2. live WS transcript + heartbeat + replay
3. model picker + default model
4. tool-call inspector + workspace file inspector + items inspector
5. todo / confirmation 列表页
6. context probe + manual compact 按钮

也就是说，**“能做前端 client”这个命题本身已经成立**。

### 5.2 如果目标是 mature agent loop front-end：**还不成立**

如果你的目标是一个更接近 claude-code / codex 的前端——即前端不是简单“看流”，而是要承接一个真正成熟的 wrapper loop——那当前还差下面 4 个闭环：

1. **HITL 闭环**：ask / elicitation 必须进入 wait-resume，而不是 error-out。
2. **context 闭环**：auto-compact 必须真的修改 live prompt，而不是只会 probe。
3. **reliability 闭环**：fallback / retry / stream recovery 必须成为一等事实，并对前端可见。
4. **policy 闭环**：`/runtime` 里的执行控制字段必须要么真的 enforce，要么降格成“仅记录，不承诺生效”。

**在这 4 个闭环没补齐之前，nano-agent 更准确的定位是**：

> **已经具备完整 workbench surface，但还没有完成 mature wrapper semantics。**

---

## 6. 我建议的收口顺序（coherent 建议）

我建议不要再继续“补更多端点”，而是按下面顺序补 **已经存在但没真正进 loop 的骨架**：

### 6.1 第一优先级：把 ask / elicitation 变成真实 loop interrupt

最小正确路径应该是：

1. `authorizeToolPlan()` 在 `decision === "ask"` 时不直接报错  
2. 创建 confirmation row  
3. emit `session.confirmation.request`  
4. kernel 进入 `confirmation_pending`  
5. 用户 decision 后恢复同一条 turn

这是当前最关键的产品断点，因为它直接决定 `/runtime.approval_policy=ask` 是否是真功能。

### 6.2 第二优先级：把 auto-compact 从“探测”变成“真实 compact”

当前已经有：

- durable context truth
- probe
- manual compact boundary/job
- loop 级 compact signal

真正缺的是 **live compact delegate**。  
这一步补完后，context 管理才会从“前端手动辅助”升级成“wrapper 自主能力”。

### 6.3 第三优先级：让 fallback / retry / streaming fallback 对前端可见

至少要补齐：

1. per-turn `fallback_used / requested_model_id / fallback_model_id / fallback_reason`
2. per-turn retry / request-chain metadata
3. streaming fallback 时的 partial-output cleanup 语义

否则前端永远只能“看起来在跑”，无法知道 backend 实际发生了什么补救动作。

### 6.4 第四优先级：把 `/runtime` 变成 honest contract

二选一，不要继续半悬空：

1. **真接 enforcement**：network/web_search/workspace_scope 进入实际执行路径  
2. **真降格文案**：明确这 3 项当前只是 stored runtime hints，不承诺 enforcement

这一步对前端非常重要，因为前端最怕“看起来有开关，实际上没有效果”。

### 6.5 第五优先级：清理“schema-live / docs-live / producer-not-live”区域

至少包括：

1. reasoning item
2. model.fallback WS frame
3. confirmation kind live-status 文档
4. retry/fork/restore public semantics 文档层级

这些问题单看都不大，但会持续污染前端的真实心智模型。

---

## 7. 如果新增一个阶段，我建议的 P0 / P1 范围

如果后续真的要增加一个阶段，我的建议不是“继续补更多功能点”，而是**只补那些能显著抬高前端起点、又能直接闭合现有 loop 断点的功能**。  
换句话说：**P0 只收真正的 loop blocker；P1 才收可见性、工作台增强与语义补完。**

### 7.1 我推荐纳入 P0 的内容

#### P0-1. 把 ask / elicitation 做成真实的 pause-resume HITL 闭环

这是我最推荐放进 P0 的事项，因为它直接决定：

- `/runtime.approval_policy=ask` 是否是真功能（`clients/api-docs/runtime.md:L17-L40`）
- confirmation control plane 是否只是“列表页”，还是能驱动 live turn（`clients/api-docs/confirmations.md:L13-L38`, `clients/api-docs/confirmations.md:L55-L120`）

当前 ask-path 仍直接 error-out（`workers/agent-core/src/host/runtime-mainline.ts:L229-L255`），而正确所需的 runtime 骨架其实已经存在：`confirmation_pending` interrupt、`emitPermissionRequestAndAwait()`、`emitElicitationRequestAndAwait()`、以及 session DO assembly 中预留的 HP5 wiring seam（`workers/agent-core/src/kernel/types.ts:L40-L59`, `workers/agent-core/src/host/do/session-do-runtime.ts:L376-L414`, `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:L141-L150`）。

**为什么它必须是 P0**：  
因为前端一旦要进入“真实 agent workbench”，用户就一定会碰到“工具执行前批准”和“模型主动向用户追问”这两类交互。如果这一层不闭环，前端只能把 agent loop 降格为“失败后重试”的伪交互。

#### P0-2. 把 auto-compact 从 probe 变成 live compact

当前 auto-compact 的状态是：

- durable context truth 有（`workers/orchestrator-core/src/context-control-plane.ts:L315-L341`）
- compact probe 有（`workers/agent-core/src/host/do/session-do/runtime-assembly.ts:L279-L312`）
- manual compact API/job 有（`clients/api-docs/context.md:L132-L180`）
- 但 live compact delegate 仍然固定返回 `tokensFreed: 0`（`workers/agent-core/src/host/runtime-mainline.ts:L813-L816`）

**为什么它必须是 P0**：  
因为这决定前端能否站在“长对话可持续运行”的起点上。没有 live auto-compact，前端即使有 context panel，也只能靠用户手动救火；这不是成熟 loop，只是 exposed substrate。

#### P0-3. 让 fallback / retry 进入 live semantics，并对前端可见

当前最危险的不是“没有 fallback”，而是**fallback 已经在局部发生，但它不是前端可观察事实**：

- live path 直接走 `WorkersAiGateway.executeStream()`（`workers/agent-core/src/host/runtime-mainline.ts:L445-L479`, `workers/agent-core/src/llm/gateway.ts:L281-L339`）
- adapter 内部会尝试硬编码 fallback model（`workers/agent-core/src/llm/adapters/workers-ai.ts:L282-L307`）
- orchestrator 下游却在等待 `fallback_used / fallback_model_id / requested_model_id / fallback_reason` 这些字段（`workers/orchestrator-core/src/user-do/message-runtime.ts:L403-L439`）

我建议 P0 至少收 3 件事：

1. per-turn fallback telemetry 真实产出  
2. per-model `fallback_model_id` 真正进入 live path，而不是继续只读不用（`clients/api-docs/models.md:L96-L118`）  
3. 增加最小可靠性闭环：至少有 retry/backoff/watchdog 中的一条 live path，而不是完全依赖 provider 一次成功

**为什么它必须是 P0**：  
因为前端如果看不到 fallback / retry，就无法向用户解释“为什么这次回答换了模型 / 为什么这次流中断又续上了 / 当前 turn 到底是失败了还是被补救了”。

#### P0-4. 把 `/runtime` 变成 honest contract，而不是半生效文档

当前 `/runtime` 暴露了 `network_policy / web_search / workspace_scope / approval_policy / permission_rules`（`clients/api-docs/runtime.md:L17-L40`），但真实执行路径只消费后两类（`workers/orchestrator-core/src/entrypoint.ts:L345-L372`）。

因此 P0 必须二选一：

1. **真接 enforcement**：让 `network_policy / web_search / workspace_scope` 进入实际执行路径  
2. **真降格 contract**：明确它们当前只是 stored hints / future policy fields，不承诺 live enforcement

**为什么它必须是 P0**：  
因为 runtime 开关是前端最容易被产品化、也最容易误导用户的区域。这个 contract 如果不诚实，前端起点反而会更低。

### 7.2 我推荐纳入 P1 的内容

#### P1-1. reasoning producer / reasoning item 真正闭合

当前是 capability 有、schema 有、projection 有，但 live producer 没有（`workers/agent-core/src/kernel/types.ts:L126-L137`, `workers/agent-core/src/llm/session-stream-adapter.ts:L61-L84`, `workers/orchestrator-core/src/item-projection-plane.ts:L67-L78`）。

我把它放在 P1，而不是 P0，原因很简单：**它很重要，但不阻止基础前端形成可用 loop**。  
它更像“提高可解释性与调试能力”的高价值增强。

#### P1-2. retry / fork / restore executor 的 deep semantics

当前 retry/fork 已有 public surface，但 executor runtime 还没有完成真实语义；restore 也只是 `partial`（`clients/api-docs/session.md:L223-L259`, `workers/orchestrator-core/src/executor-runtime.ts:L60-L97`, `clients/api-docs/session-ws-v1.md:L186-L200`）。

我建议把这组能力放进 P1，原因是：

- 它们会显著抬高 workbench 的高级操作能力  
- 但它们不是“前端是否能跑起来”的第一道门槛

#### P1-3. 增加一个 QueryEngine-lite 的 turn/result 聚合对象

claude-code 的成熟体验，有一部分来自它能把 usage / permission denials / fast-mode-state / model-usage 等结果聚合后交给上层（`context/claude-code/QueryEngine.ts:L618-L637`）。

nano-agent 当前 public contract 被拆散在 `/messages`、`/usage`、`/items`、`/tool-calls`、WS stream 等多处（`clients/api-docs/session.md:L53-L87`, `clients/api-docs/tool-calls.md:L8-L41`, `clients/api-docs/items.md:L8-L58`）。

我建议 P1 考虑加一个 **QueryEngine-lite / turn-summary object**，把前端最常用的 turn 结果聚合出来。  
这不是 blocker，但会明显提高 SDK / 薄前端的可接入性。

#### P1-4. 清理 docs-live / schema-live / producer-not-live 漂移

这类工作包括：

1. `confirmations.md` 对 live caller 状态的诚实修订（`clients/api-docs/confirmations.md:L9-L10`, `clients/api-docs/confirmations.md:L28-L38`）  
2. `session-ws-v1.md` 中 `model.fallback` live-status 的修订（`clients/api-docs/session-ws-v1.md:L59-L76`）  
3. reasoning / retry / fork / restore 的 public semantics 对齐

我把它放在 P1，是因为它主要解决的是**前端心智模型污染**，不是 live loop 本身的第一性断点。

### 7.3 我明确不建议放进这个新增阶段的内容

如果目标是“让前端站在更高起点”，那这个阶段**不应该**继续横向扩张到下面这些方向：

1. 新的大类工具能力 / 新的业务域 API
2. 完整多 provider 抽象重写
3. 大规模 prompt caching / model capability center / cost governance 平台化
4. 更复杂的 policy engine，而不是先把现有 `/runtime` contract 变诚实

原因很简单：这些方向都可能有价值，但它们不会像 P0 那样，直接把当前前端最痛的 loop 断点补上。

### 7.4 如果只能做一个“小而硬”的新增阶段，我建议它的主题是

> **“从 workbench surface 走向 honest loop semantics”**

更具体地说：

- **P0 主题**：闭合 4 个 loop blocker  
  - ask / elicitation HITL  
  - live auto-compact  
  - fallback / retry live semantics  
  - honest runtime contract
- **P1 主题**：补足观测与高级工作台语义  
  - reasoning  
  - executor deep semantics  
  - turn-summary / QueryEngine-lite  
  - docs drift cleanup

这样切的好处是：**新增阶段不是“再堆功能”，而是把现有 surface 变成真正可依赖的前端起点。**

---

## 8. 最终 verdict

**最终判断**：

- **对“做一个可用 web client”**：**Yes**。当前 API 已经够。  
- **对“做一个成熟完整的 nano-agent agent loop 前端”**：**Not yet**。

差距已经不再是“API 面贫瘠”，而是 **若干关键控制平面仍停留在“有 surface、有存储、有 schema，但没有真正驱动 loop”**。  
这正是当前 nano-agent 与 claude-code 这类 mature wrapper 的核心距离。
