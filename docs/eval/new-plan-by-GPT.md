# New Plan Exploration — GPT

> 状态：`exploratory memo`
> 目的：`不是正式 action-plan，只是基于当前代码 reality，对下一阶段方向做一次重新判断`
> 参考输入：
> - `docs/plan-after-nacp.md`
> - `docs/plan-after-skeleton.md`

---

## 0. 先给结论

我当前的判断是：

> **下一阶段不应该再叫“继续补基础设施”，但也不应该一上来就直接做重型 API / DDL。**

更合适的起点是：

> **Integration-first Capability & Context Expansion**

也就是：

1. **先把已经存在的 packages 接成一条真实的 turn execution vertical slice**
2. **再基于这条真实链路，设计 public/product API 与 data model**
3. **最后才决定 registry / DDL / structured store 要不要上，以及怎么上**

如果只让我用一句话概括：

> **After-skeleton 的 closure 已经完成，接下来最有价值的事情，不是再发明新的包，而是把已经有的 kernel / llm / capability / hooks / workspace / storage 真实接起来，再让 API 和数据模型从这条链路中长出来。**

---

## 1. 重新回顾两份旧计划后，我认为它们各自说对了什么

## 1.1 `plan-after-nacp.md` 说对的部分

`docs/plan-after-nacp.md` 的核心判断是：

- post-NACP 阶段不该继续停留在“多建几个 skeleton package”
- 应该转向 **Worker-native Runtime Closure**
- 核心问题在：
  - session edge reality
  - external seam reality
  - storage reality
  - capability governance reality

这套判断，现在看是对的，而且已经被 after-skeleton 阶段大体兑现了。

## 1.2 `plan-after-skeleton.md` 说对的部分

`docs/plan-after-skeleton.md` 的核心判断是：

- 当前阶段先完成：
  - contract freeze
  - identifier law
  - trace-first observability
  - session edge v1
  - external seam closure
  - storage/context evidence
  - minimal fake bash contract
- 然后下一阶段再进入：
  - API / data model design
  - richer capability / context expansion

这个方向也对。

但是，**如果结合当前真实代码去看，它还少了一层中间桥接**：

> **我们已经有很多“单包内成立”的能力了，但还没有把这些能力真实接成一个 product-shaped turn path。**

这意味着：

- 直接进入重型 API / DDL，仍然会有一部分是“基于推测的设计”
- 但继续做 infrastructure-only closure，也已经不是最高价值方向

所以我认为应该在两份旧计划之间，做一个更贴近当前 reality 的折中收敛。

---

## 2. 当前代码 reality 告诉我的最关键事实

下面这些不是抽象判断，而是当前仓库里能直接看到的代码事实。

## 2.1 after-skeleton 的收口，已经基本成立

从当前仓库看：

- `docs/plan-after-skeleton.md` 约定的 contract / trace / runtime closure / minimal bash 工作，已经基本全部落地
- 10 个核心包都已经不是空 skeleton，而是有了实质 src/test 面
- root contract tests + cross-package tests 也已经形成稳定回归面

换句话说：

> **我们已经不再处于“是否有骨架”的问题空间里。**

## 2.2 但主运行时还没有真正消费多数 runtime packages

最关键的事实在这里：

- `packages/session-do-runtime/package.json` 当前 runtime dependencies 只有：
  - `@nano-agent/nacp-session`
  - `@nano-agent/workspace-context-artifacts`
- 它**没有**把下面这些包作为 runtime dependency 接进主链：
  - `@nano-agent/agent-runtime-kernel`
  - `@nano-agent/llm-wrapper`
  - `@nano-agent/capability-runtime`
  - `@nano-agent/hooks`
  - `@nano-agent/storage-topology`

这说明一件非常重要的事：

> **这些包现在大多是“已经实现好的能力面”，但还不是默认 runtime truth 的一部分。**

## 2.3 `session-do-runtime` 已经是一个很好用的 assembly host，但还不是完整 product runtime

当前 `packages/session-do-runtime/src/orchestration.ts` 已经定义了很清晰的 `OrchestrationDeps`：

- `advanceStep`
- `buildCheckpoint`
- `restoreCheckpoint`
- `emitHook`
- `emitTrace`
- `pushStreamEvent`

这说明它已经为真正的跨包 assembly 留好了位置。

但从当前 reality 看：

- 这套 orchestration seam 主要还是一个 **well-shaped host**
- 还不是一个已经吃进 `kernel + llm + capability + hook + storage` 的完整 vertical slice

## 2.4 worker entry 已经很“真”，但仍然很薄

`packages/session-do-runtime/src/worker.ts` 当前基本只做：

1. 路由检查
2. 取 `SESSION_DO` stub
3. `stub.fetch(request)`

这很好，说明 worker entry 没有过早复杂化。

但这也意味着：

> **真正决定产品行为的部分，下一阶段必须在 DO composition / runtime assembly 层完成，而不是寄希望于 worker entry 自己长逻辑。**

## 2.5 其他包已经具备“可被接入”的成熟度

从当前代码面看：

- `llm-wrapper` 已经有：
  - `LLMExecutor`
  - adapter
  - registry
  - request builder
  - session stream adapter
- `agent-runtime-kernel` 已经有：
  - scheduler
  - reducer
  - runner
  - runtime event mapping
  - checkpoint fragment
- `capability-runtime` 已经有：
  - planner
  - executor
  - fake bash bridge
  - local/service-binding/browser targets
  - filesystem/search/network/exec/vcs handlers
- `hooks` 已经有：
  - registry
  - dispatcher
  - local runtime
  - service-binding runtime
- `storage-topology` 已经有：
  - placement taxonomy
  - refs / keys
  - mime gate
  - calibration

所以当前问题不是“这些包太空，不能用”，而是：

> **它们还没有被接成一条真实的业务主链。**

---

## 3. 因此，我对“接下来该做什么”的判断

我的判断是：

## 3.1 下一阶段最该先做的，不是新的 package，不是更大的 fake bash，也不是直接 DDL

最该先做的是：

> **Integrated Turn Slice**

也就是先把下面这条路径接通：

`session.start`
→ ingress / authority / session edge
→ context assembly
→ kernel step loop
→ llm call / llm streaming
→ tool call / fake bash capability execution
→ tool result 回流
→ stream events / trace / evidence
→ checkpoint / snapshot / artifact promotion
→ `turn.end`

只要这条链路还没有形成真实 cross-package truth，后面的很多事情都会有漂移风险：

- public API 会猜
- timeline shape 会猜
- artifact interface 会猜
- registry model 会猜
- DDL 也会猜

## 3.2 但这也不意味着“API / data model design 不重要”

API / data model 仍然是下一阶段的重要主题。

只是我认为它不应该作为完全脱离 runtime slice 的“纸面设计”先行，而应该：

> **和 integrated turn slice 一起推进，但以 vertical slice 的真实输出为依据。**

换句话说：

- **不是先空想 API，再去找 runtime 配合**
- 而是 **先让 runtime 产出稳定 truth，再把 truth 抽象成 API / data model**

## 3.3 因此我建议的下一阶段名字

如果要给下一阶段一个更贴近当前 reality 的名字，我会用：

> **Integration-first Capability & Context Phase**

它和 `plan-after-skeleton.md` 的“Capability & Context Expansion Phase”并不冲突；
只是我会把这个 phase 的**第一个工作流**重新定义为：

> **Integrated Runtime Slice & Product Surface Convergence**

---

## 4. 我建议的实现路径（不是正式 plan，只是方向）

## 4.1 Workstream 1 — Integrated Turn Slice（最高优先级）

### 目标

把当前已经存在的 runtime packages，接成一条真实可跑的 turn execution 主链。

### 我认为最该先接的东西

1. **Kernel 接线**
   - 把 `agent-runtime-kernel::KernelRunner` 真正接入 `SessionOrchestrator`
   - 让 `advanceStep` 不再只是 assembly seam，而是真正跑 kernel decisions

2. **LLM 接线**
   - 把 `llm-wrapper::LLMExecutor` 接入 kernel 的 llm delegate
   - 先只做一条最小 provider path：
     - fake provider worker / remote fetcher
     - streaming delta
     - finish / usage

3. **Capability 接线**
   - 把 `capability-runtime::CapabilityExecutor` 接入 kernel 的 capability delegate
   - 先只支持当前已稳定的 minimal command inventory
   - 重点不是扩命令，而是让 tool call 真走 turn loop

4. **Hook 接线**
   - 把 `hooks::HookDispatcher` / `ServiceBindingRuntime` 接入真实 turn lifecycle
   - 让 hook outcome 不只是 emit，而是开始影响主链行为（至少先做 continue / block / annotate 这样的最小闭环）

5. **Workspace / Context / Evidence 接线**
   - 把 `workspace-context-artifacts` 从 checkpoint / snapshot use-site，再往上推进到真实 turn context assembly
   - 让 `ContextAssembler` 不只存在于 helper，而是真参与一次 turn 的 prompt construction

### 这一工作流做完后，应该能回答的问题

- 一次 turn 到底怎么跑
- 哪些事件会出现在 session timeline
- artifact / prepared artifact / snapshot 分别在哪一层出现
- trace / evidence / stream event 的真实粒度是什么

这会直接为下一步 API 和 data model 提供依据。

## 4.2 Workstream 2 — Product Surface Convergence

### 目标

基于上面的 vertical slice，抽出真正稳定的 product-facing surfaces。

### 我建议这时再正式讨论的内容

1. public session API
2. timeline / replay / artifact read API
3. frontend-facing session state model
4. minimal product config surface
   - provider profile
   - model profile
   - capability exposure profile

### 为什么我不建议它先于 Workstream 1

因为当前代码事实说明：

- runtime host shape 已经够稳定
- 但 product truth 还没稳定

所以这一步适合做，但更适合建立在 integrated slice 之后。

## 4.3 Workstream 3 — Registry / Data Model Decision

### 目标

不是直接建数据库，而是把“到底哪些东西应该结构化”变成 evidence-backed decision。

### 我建议怎么做

1. 先观察 integrated slice 的真实访问模式
2. 再把下面这些分开判断：
   - model registry：KV snapshot 是否够用
   - provider config：是否需要 structured store
   - skill / capability registry：是否仍可保持 manifest-first
   - timeline / artifact metadata：是否必须 query-heavy

### 我的倾向

我现在不倾向于下一步就直接做重型 DDL。

我更倾向：

- 先定义 **registry/data model memo**
- 再决定是否真的需要 structured store

## 4.4 Workstream 4 — Controlled Expansion

这是我认为应该排在后面的扩展面：

1. broader fake bash / `just-bash` port
2. richer queue / replace / merge semantics
3. deeper compression / budget management
4. richer frontend adaptation
5. broader provider matrix

这些都重要，但都不该压过 integrated turn slice。

---

## 5. 我建议的 In-Scope

如果下一阶段是我来定方向，我会把下面这些放进 In-Scope：

## 5.1 必须 in-scope

1. **把 `session-do-runtime` 变成真实的 cross-package composition host**
2. **接通最小 integrated turn slice**
3. **让 `ContextAssembler` 进入真实 prompt assembly**
4. **让一次 tool-call path 进入真实 turn loop**
5. **让 session timeline / trace / evidence 的真实输出变得可观察**
6. **基于真实输出，整理 product-facing surface draft**
7. **形成 registry / data-model decision memo，而不是立刻上 DDL**

## 5.2 可以 in-scope，但应放后

1. fake provider 进一步贴近真实 provider error / streaming reality
2. capability profile / command inventory 的 product-facing manifest
3. minimal config registry surface

---

## 6. 我建议的 Out-of-Scope

下面这些我明确建议暂时不要作为下一阶段主目标：

## 6.1 不该立刻做的

1. **重型 frontend productization**
2. **完整 registry / business DDL implementation**
3. **多 provider / 多 model / 多策略矩阵同时铺开**
4. **大面积扩 fake bash 命令集**
5. **session protocol v2 全量扩族**
6. **复杂 multi-turn queue / replace / merge 正式语义**
7. **多 agent / sub-agent / orchestration network**

## 6.2 为什么这些现在不该做

因为它们都会把团队注意力从“把现有能力接成一条真实主链”转移出去。

而当前最大的工程价值，不在于再多拥有几个能力点，而在于：

> **把已有能力变成一条真实、稳定、可解释、可对外暴露的执行路径。**

---

## 7. 为什么我不建议直接从 API / DDL 开始

这部分我想单独写清楚，因为它和 `plan-after-skeleton.md` 的表述有一点细微差异。

我并不是反对 API / DDL design。

我反对的是：

> **在 integrated runtime slice 还没有形成之前，就把 API / DDL 设计当成阶段起点。**

原因很简单：

1. 当前 runtime closure 已完成的是 **infrastructure closure**
2. 还没有完成的是 **product execution truth closure**

如果没有 product execution truth，下面这些都容易过早冻结：

- timeline object model
- artifact visibility model
- prepared artifact lifecycle
- capability registry boundary
- session API 的状态机形状

所以我的建议不是“API / data model 延后很久”，而是：

> **让它紧跟 integrated slice，而不是先于 integrated slice。**

---

## 8. 一个更贴近当前 reality 的阶段排序

如果现在让我给一个“方向上的推荐顺序”，我会这样排：

1. **Integrated Turn Slice**
2. **Product Surface Convergence**
3. **Registry / Data Model Decision**
4. **Controlled Capability & Context Expansion**

如果换成更直白的说法：

1. 先让系统真的跑起来
2. 再把跑出来的 truth 抽象成 API
3. 再决定哪些东西值得结构化存储
4. 最后再扩大能力面

---

## 9. 最终判断

我对当前阶段后的下一步判断是：

> **不应该回到“继续补 skeleton”，也不应该直接跳到“重型产品设计”。**

更好的路线是：

> **以 cross-package runtime integration 为起点，把现有包接成一个最小但真实的 turn execution slice；然后再让 API / context / registry / data model 从这条 slice 上生长出来。**

这条路的优点是：

1. 最大化复用当前已经完成的 10 个 packages
2. 避免过早冻结 API / DDL
3. 把下一阶段的核心风险，从“文档是否完整”转移到“主链是否真实”
4. 更容易形成对外可解释的产品面

如果只保留最后一句话，我会写成：

> **The next phase should start from integration, not invention. Connect the existing runtime packages into one real turn slice first; then let APIs, context architecture, and data decisions grow from observed reality instead of speculation.**
