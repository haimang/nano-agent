# Before Worker Matrix — Evaluation by GPT

> 状态：`exploratory evaluation`
> 目的：`评价 owner 提出的“先进入 after-foundations 阶段，再进入 worker matrix”的判断与 spike worker 思路`
> References:
> - `docs/plan-after-nacp.md`
> - `docs/plan-after-skeleton.md`
> - `docs/eval/new-plan-by-GPT.md`
> - `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`

---

## 0. 先给结论

在重新对照当前代码事实后，我认为：

> **你这次的判断，比我上一轮“可以直接进入 worker matrix”更稳，而且大概率更正确。**

更准确地说：

1. **worker matrix 方向本身仍然成立**
2. **但现在直接进入实施，会把几个尚未收敛的前提混在一起**
3. **因此，在 worker matrix 之前，增加一个 after-foundations 阶段，是合理且推荐的**
4. **而“spike worker / probe worker”是这个阶段里非常值得采用的方法**

如果只保留一句话：

> **我现在不再建议“立即进入 worker matrix 实施”。我更建议先做一个 after-foundations 验证阶段，把 just-bash、Cloudflare storage loops、context package realism、hook taxonomy、以及 NACP 更新这五类前提补实，再进入矩阵实施。**

---

## 1. 为什么我会修正我上一轮的判断

上一轮我支持 worker matrix，原因是：

- foundations 已经具备
- session-do-runtime 已经像一个真实 worker / DO host
- hooks / capability / provider 的 service-binding seam 已有代码地基
- 用 5 个真实 worker 做 deploy-shaped MVP 很有价值

这些判断本身仍然成立。

但你这次指出的关键问题是：

> **“具备 foundations” 并不等于 “已经具备进入 matrix implementation 的前置事实”。**

我认为这句话是成立的。

也就是说，问题不在于：

- worker matrix 想法对不对

而在于：

- **现在是不是已经到了实施它的时点**

结合代码 reality，我认为答案是：

> **还没有完全到。**

---

## 2. 你列出的 5 个缺口，代码事实是否支持

我的结论是：

> **5 个缺口全部都有代码事实支撑，而且不是“想太多”，而是非常真实的阶段前提。**

---

## 2.1 just-bash 抽象与 Cloudflare 环境测试不够 —— 这个判断是对的

### 代码事实

当前仓库里：

- `context/just-bash/package.json` 明确表明它是一个完整的独立项目：
  - 名称：`just-bash`
  - 描述：`A simulated bash environment with virtual filesystem`
  - 版本：`2.14.2`
- `context/just-bash/README.md` 表明它支持的能力非常广：
  - 大量文件 / 文本 / 数据处理命令
  - `js-exec`
  - `python3`
  - `sqlite3`
  - `curl`
  - 多种 filesystem 模型（InMemoryFs / OverlayFs / ReadWriteFs / MountableFs）
  - 较完整的 shell features

而当前我们自己的 `packages/capability-runtime/src/fake-bash/commands.ts` 只注册了最小集合：

- `pwd`
- `ls`
- `cat`
- `write`
- `mkdir`
- `rm`
- `mv`
- `cp`
- `rg`
- `curl`
- `ts-exec`
- `git`

这说明：

> **nano-agent 当前 fake-bash 更接近“minimal governed subset”，而不是 “just-bash 等级的环境抽象”。**

另外，`packages/capability-runtime/src/targets/browser-rendering.ts` 目前还是显式的 `not-connected` stub，进一步说明：

> **我们离“完整 skill / tool / shell environment”还有明显距离。**

### 我的判断

所以你说“进入 worker matrix 前，需要更多 just-bash 抽象实现与真实 Cloudflare 环境测试”，我认为是**非常成立**的。

### 进一步评价

这个缺口不只是“命令数量不够”，而是三层问题：

1. **命令抽象够不够**
2. **这些命令在 Worker-native 环境下怎么落地**
3. **这些能力跨 worker / storage / fake-bash 协作时，是否还能保持一套一致心智模型**

这三层都还没有完全被回答。

---

## 2.2 D1 / R2 / KV / worker-memory 的抽象与真实循环测试不够 —— 这个判断也是对的

### 代码事实

当前 `packages/storage-topology/src/adapters/scoped-io.ts` 提供的是：

- `ScopedStorageAdapter` 接口
- `NullStorageAdapter`

而 `NullStorageAdapter` 会对所有操作直接抛出：

- `doGet not connected`
- `kvGet not connected`
- `r2Get not connected`

这说明：

> **storage-topology 当前给出的主要是“typed abstraction seam”，不是 concrete Cloudflare storage implementation。**

同时，`packages/workspace-context-artifacts/src/backends/reference.ts` 里的 `ReferenceBackend` 也明确是：

- `not connected — durable storage backend is not yet available`

另外，仓库里虽然已经大量出现了 `d1` 这个词，但它当前更多出现在：

- `NacpRef` 的合法 kind union
- promotion / binding defaults
- README / docs / evidence vocabulary

而不是成熟的 D1 adapter/runtime loop。

例如：

- `workspace-context-artifacts/src/promotion.ts` 里 `d1: "PRIMARY_D1"` 只是 binding default
- `storage-topology/README.md` 也明确把 D1 DDL / structured query 放在更后的位置

### 我的判断

所以你说：

> **“更完整的 D1，R2，KV 与本地 worker 内存中的抽象与真实循环测试”**

这是一个非常准确的阶段前提，而不是额外加戏。

### 进一步评价

这个问题如果不先补实，直接进入 worker matrix 会造成一个结构性风险：

- 我们会拥有一组“看起来是 filesystem/storage workers 的矩阵”
- 但它们真正跑的仍然主要是 in-memory / placeholder / provisional logic

那样的 matrix 可以部署，但不够说明问题。

---

## 2.3 context package 还不够“真实” —— 这个判断也是成立的

### 代码事实

当前 `packages/workspace-context-artifacts/src/index.ts` 已经有：

- `ContextAssembler`
- `CompactBoundaryManager`
- `WorkspaceSnapshotBuilder`
- `WorkspaceNamespace`
- evidence emitters

这说明它已经具备很强的 primitives。

但同时，也能看到几个重要现实：

1. `prepared-artifacts.ts` 暴露的是 `StubArtifactPreparer`
   - 文件头注释直接说：`Includes a stub implementation for testing`
2. `promotion.ts` 里的 `DEFAULT_PROMOTION_POLICY` 与 `coldTierSizeBytes` 仍是 **provisional**
3. `nacp-core/src/messages/context.ts` 当前 context message family 只有：
   - `context.compact.request`
   - `context.compact.response`

这说明：

> **我们已经有 context primitives，但还没有完整的 context engine product reality。**

### 我的判断

所以你说：

> **“更真实的上下文管理 package 的实现”**

这是对当前 reality 的准确描述。

### 进一步评价

这里真正缺的不是“再写几个类”，而是三个更高一层的问题：

1. context assembly 在真实 turn 中如何参与 prompt construction
2. compact / snapshot / prepared artifact 如何形成一致生命周期
3. context worker 和 filesystem worker 的边界如何划分

这些如果不先通过 after-foundations 设计+验证补清楚，直接进入 worker matrix，会非常容易在 `context.core` 与 `filesystem.core` 之间发生职责漂移。

---

## 2.4 需要更准确的 hooks 分类与实现 —— 这个判断非常关键

### 代码事实

当前 `packages/hooks/src/catalog.ts` 冻结的 canonical event 只有 8 个：

- `SessionStart`
- `SessionEnd`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `PreCompact`
- `PostCompact`

这个 catalog 已经足够支撑当前 after-skeleton 阶段的 session/tool/compact lifecycle。

但如果你要进入：

- context management worker
- filesystem worker
- fake-bash worker
- richer skill worker

那么现在这个 catalog 就显得偏粗。

另外，`packages/nacp-core/src/messages/hook.ts` 当前 wire-level body 也非常泛化：

- `hook.emit`: `{ event_name, event_payload }`
- `hook.outcome`: `{ ok, block?, updated_input?, additional_context?, stop?, diagnostics? }`

这说明：

> **hook runtime 已经有了可用底盘，但事件 taxonomy 还主要围绕 session/tool/compact，而不是 context/filesystem/budget/storage 等更细粒度行为。**

### 我的判断

所以你说：

> **为了上下文管理、文件系统操作，提供更准确的 hooks 分类、补充与代码实现**

这不仅成立，而且我认为它是你这 5 个条件里**最容易被低估，但最影响后续质量**的一项。

### 进一步评价

原因在于：

- worker matrix 一旦开始，hooks 就不再只是“附加治理层”
- 它会变成跨 worker 协作与可观测性的骨架

如果 taxonomy 太粗，后面会出现两个问题：

1. event_name 语义过载
2. audit / trace / block / enrich 的边界会模糊

所以这个前置阶段很有必要。

---

## 2.5 NACP core / session 需要更新 —— 这个判断也有充分依据

### 代码事实

当前 `packages/nacp-core/src/messages/index.ts` 注册的 core message families 只有：

- tool
- hook
- skill
- context
- system

其中 context 目前只有 compact request/response。

当前 `packages/nacp-session/src/messages.ts` 则主要还是 session profile v1：

- `session.start`
- `session.resume`
- `session.cancel`
- `session.end`
- `session.stream.ack`
- `session.heartbeat`
- `session.followup_input`

这套协议对 after-skeleton 阶段是足够的。

但如果要进入你设想的 after-foundations 前置验证，并最终走向 worker matrix，那么下面这些东西很可能都需要更精确的协议表达：

- context orchestration
- filesystem / artifact 操作反馈
- richer hook / governance signals
- maybe skill / capability / browser probe semantics

### 我的判断

所以你说：

> **依据上面的要求，对 nacp.core 与 nacp.session 的更新**

这不是“顺手补一补”的事情，而是：

> **一个非常正常的协议前置阶段。**

### 进一步评价

因为如果协议不先更新，后面会很容易出现一种坏情况：

- worker matrix 已经搭起来了
- 但 worker 之间实际传的仍然是“为上一个阶段设计的 message shape”

那就会把“验证真实矩阵”的工作，变成“用旧协议硬扛新职责”。

---

## 3. 因此，我对你“增加 after-foundations 阶段”的评价

我的判断是：

> **这个阶段不是拖延，也不是回到“继续补基础设施”，而是 worker matrix 的必要前置验证期。**

我甚至会进一步强化你的说法：

> **这个 after-foundations 阶段的目标，不是再做更多 packages，而是把“进入 worker matrix 之前必须为真的前提”逐项验证出来。**

这和我前一份 `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md` 的建议并不矛盾，而是对它的修正：

- 上一份文档强调：worker matrix 方向正确
- 这一份文档强调：**正确方向不等于可以立刻实施**

我现在更认同：

> **先做 after-foundations pre-matrix phase，再做 worker matrix implementation phase。**

---

## 4. 你提出的 spike worker / probe worker，我非常支持

这是你这次想法里，我最认同的部分之一。

## 4.1 为什么这个想法非常好

因为你已经明确它不是：

- product worker
- 长期正式架构单元
- 需要稳定维护的业务边界

而是：

> **纯粹用于验证本地环境无法诚实验证的 Cloudflare runtime reality 的 probe。**

这个定位是非常对的。

## 4.2 代码事实为什么支持这个想法

当前代码里已经有很多“可以在本地通过测试，但无法代表 Cloudflare 真实环境”的地方：

1. `session-do-runtime/src/worker.ts` 很薄，很多真实行为最终要看 DO + bindings + runtime
2. `storage-topology` 当前有 typed seam，但缺少真实 KV/R2/D1 loops
3. `ReferenceBackend` / `NullStorageAdapter` 仍然 not connected
4. service-binding runtimes 已有抽象，但真实 worker-to-worker 行为仍需要 deploy-shaped proof
5. browser target 还是 stub，说明某些技能面只能通过真实外部 worker / service 才能验证

这些都说明：

> **只靠本地测试环境，我们很难把这些问题看清。**

## 4.3 spike worker 最适合验证什么

我认为 spike worker 最适合验证的，不是完整产品，而是下面几类“本地最难诚实模拟”的问题：

1. **真实 service binding shape**
2. **DO + Worker + WS / HTTP 的真实行为**
3. **真实 KV / R2 / D1 binding loops**
4. **trace / evidence / audit 在跨 worker 情况下是否还连贯**
5. **storage placement 的真实代价与行为**

## 4.4 我对 spike worker 的建议

我推荐，但推荐一个很明确的使用方式：

### 推荐原则

1. **它是 disposable probe，不是 product seed**
2. **它可以被频繁改写、推翻、重建**
3. **每次只验证少数假设，不要一次装太多业务语义**
4. **必须保留验证输出：logs / traces / evidence / latency / failure mode**

### 我推荐的形态

比起一个什么都测的大 worker，我更推荐：

1. `spike.runtime`
   - 验证 HTTP / WS / DO / service-binding / NACP shape
2. `spike.storage`
   - 验证 KV / R2 / D1 / worker-memory loops

如果只想先做一个，也可以，但我会建议至少在逻辑上把两类问题分开。

### 为什么不能让 spike worker 变成新的泥球

因为它的价值恰恰在于：

> **快速验证不可在本地诚实验证的问题。**

如果把它做成“半产品 worker”，它反而会拖慢判断。

---

## 5. 我对 after-foundations 阶段的总体定义

如果让我给你这个阶段下定义，我会这样写：

> **After-foundations is a pre-matrix verification phase. Its job is not to ship the worker matrix yet, but to prove the missing facts that make the matrix implementation honest.**

这个阶段的本质是：

1. **补齐前提事实**
2. **收敛协议与抽象**
3. **用 spike workers 验证 Cloudflare reality**
4. **为下一阶段的 worker matrix implementation 降风险**

---

## 6. 我建议这个阶段的 In-Scope

如果按你的思路进入 after-foundations，我建议 in-scope 是：

1. **just-bash 与 nano fake-bash 的差异收敛**
2. **Cloudflare-native storage adapter / loop 验证**
3. **更真实的 context package 演化**
4. **hook taxonomy 扩充与实现**
5. **NACP core / session 的协议更新**
6. **spike worker / probe worker 的真实部署验证**

---

## 7. 我建议这个阶段的 Out-of-Scope

我反而建议这个阶段先不要把下面这些作为硬目标：

1. **完整 5-worker matrix implementation**
2. **完整 frontend-facing API / DDL**
3. **完整 browser / scrape / search productization**
4. **最终 context strategy 全冻结**
5. **最终 filesystem/storage product architecture 全冻结**

原因很简单：

> **这个阶段的价值在于“证明前提”，不是“提前完成最终产品”。**

---

## 8. 最终 verdict

### 8.1 对你这次判断的评价

**我认可，而且我认为它比我上一轮建议更稳。**

### 8.2 是否推荐增加一个 before-worker-matrix 的 after-foundations 阶段

**推荐。**

### 8.3 是否推荐 spike worker / probe worker

**强烈推荐。**

### 8.4 最准确的表达

如果要用一句最准确的话来表达我的评价，我会写成：

> **worker matrix 仍然是正确方向，但当前还缺少若干 load-bearing 前提。先增加一个 after-foundations 预备阶段，用 spike workers 去验证 just-bash、Cloudflare storage loops、context realism、hook taxonomy、以及 NACP 更新，是一个更诚实、更工程化、也更可能成功的推进方式。**

### 8.5 一句话总结

> **I now recommend a pre-matrix phase before implementation. The matrix is still the right destination, but the current codebase still needs a round of Cloudflare-shaped proof, protocol refinement, and probe-driven validation before the worker matrix can be implemented honestly.**
