# Nano-Agent After-Foundations P0 — Reviewed by GPT

> 文档对象：
> - `docs/templates/_TEMPLATE-spike-finding.md`
> - `docs/design/after-foundations/P0-spike-binding-pair-design.md`
> - `docs/design/after-foundations/P0-spike-do-storage-design.md`
> - `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md`
> 审查人：`GPT-5.4`
> 审查日期：`2026-04-19`
> 审查性质：`phase-0 design review / action-plan readiness audit`
> 审查结论：`ready-with-fixes`

---

## 0. 总判断

我的总判断是：

> **这 4 份 Phase 0 设计已经基本建立了完整的 P0 设计骨架，方向正确、与当前 charter 主线一致、也足以支撑 `B1-spike-round-1-bare-metal.md` 的撰写；但它们还没有完全冻结。**

我认为它们已经做对了三件最重要的事：

1. **把 Phase 0 明确收束成两个 spike：`spike-do-storage` 与 `spike-binding-pair`**
2. **把 Round 1 spike 的价值，从“部署成功”收束成“finding + writeback”**
3. **把 Phase 0 与后续 P1-P5 的依赖关系明确写出来，而不是把 spike 当成独立实验**

这意味着：  
**从方法论上，P0 已经成立；从 action-plan 准备度上，P0 也已经接近可执行。**

但我也认为，当前稿子还有几处会直接影响 `B1` 完整性的漂移，主要集中在：

1. **模板路径与交付物命名仍有 drift**
2. **验证项 / finding 数量的表述仍有局部不自洽**
3. **`spike-binding-pair` 对 repo 里两种 service-binding transport reality 的覆盖范围还没说透**
4. **`spike-do-storage` 里的 bash/platform probe 还没有完全贴住当前 `capability-runtime` 的真实语义**

所以我的结论不是“退回重写”，而是：

> **P0 设计可以作为 B1 的直接输入，但建议在写 B1 之前，先做一轮小型收口，把上面 4 类 drift 先修平。**

---

## 1. 我明确赞同的部分

### 1.1 P0 的 scope 已经闭合

这是这轮设计里最重要的进步。

`P0-spike-discipline-and-validation-matrix.md` 把 P0 清晰拆成：

- **7 条 spike discipline**
- **12 项必须验证的 Cloudflare 真相**
- **finding → writeback → ship code 的闭合规则**

这与 `docs/plan-after-foundations.md` 目前的主线是一致的：  
Phase 0 不是“先做点 probe 看看”，而是 **Round 1 truth probe 的正式 phase**。

尤其是 matrix 文档的 §5，把 finding 的闭合状态收束成：

- `writeback-shipped`
- `dismissed-with-rationale`
- 不允许带着 `open / writeback-in-progress` 退出

这点是对的，因为它真正防止了 **spike-truth 与 package-truth 双轨漂移**。

### 1.2 两个 spike 的职责边界划分是清楚的

`P0-spike-do-storage-design.md` 明确把 single-worker probe 聚焦在：

- R2
- KV
- DO storage
- D1
- fake-bash platform / curl quota

而 `P0-spike-binding-pair-design.md` 明确把 two-worker probe 聚焦在：

- binding latency / cancellation
- cross-seam anchor propagation
- hook callback
- eval sink fan-in

这两个设计没有互相吞 scope，也没有把 worker matrix 的终态 shell 提前做进来。  
这一点符合我们整条讨论链里一再强调的原则：**P0 要暴露 platform truth，不要偷跑成 next-phase implementation。**

### 1.3 finding template 的方向是对的

`docs/templates/_TEMPLATE-spike-finding.md` 的整体结构我认为是对的，而且是这轮 P0 设计里最有价值的部分之一。

它把一条 finding 固定成 8 段：

1. 摘要
2. 现象
3. 根因
4. packages/ 影响
5. worker-matrix 影响
6. writeback action
7. evidence
8. 关联关系

尤其是下面三节是 load-bearing 的：

- `§3 Package Impact`
- `§4 Worker-Matrix Impact`
- `§5 Writeback Action`

这三个段落直接把 P0 findings 和后续 `P1-P7` 连起来了。  
也就是说，这个模板已经不是“实验记录模板”，而是 **phase handoff artifact 模板**。这点我明确认可。

### 1.4 设计文档已经开始用真实代码事实约束自己

这轮 P0 设计的另一个优点，是它没有完全停留在抽象层。

例如：

- `P0-spike-do-storage-design.md` 明确对齐了 `NullStorageAdapter` 与 `ReferenceBackend` 仍是 `not connected`
- `P0-spike-binding-pair-design.md` 明确对齐了 `CrossSeamAnchor`、`remote-bindings.ts`、hook runtime、capability target
- `P0-spike-discipline-and-validation-matrix.md` 明确把 “typed seams ready, live assembly partial” 当作前置现实

这说明 Opus 已经在按代码事实写 P0，不是在凭空写一个“理想 spike”。

---

## 2. 我认为当前设计的主要问题

### 2.1 模板路径与 charter 交付物命名仍有 drift

这是当前最直接、也最该先修的一个问题。

现在真实存在的模板文件是：

- `docs/templates/_TEMPLATE-spike-finding.md`

而 `docs/plan-after-foundations.md` 里 Phase 0 的交付物与文档顺序，仍然多处写的是：

- `docs/spikes/_TEMPLATE-finding.md`

并且 charter 里 Phase 0 还要求交付：

- `docs/spikes/storage-findings.md`
- `docs/spikes/binding-findings.md`
- `docs/spikes/fake-bash-platform-findings.md`

但当前 P0 设计与模板的真实输出形状，却是：

- `docs/spikes/{namespace}/{NN}-{slug}.md` 的**逐条 finding 文件**

这就形成了两个层面的 drift：

| 层 | 当前设计现实 | charter/交付物表述 |
|---|---|---|
| 模板路径 | `docs/templates/_TEMPLATE-spike-finding.md` | `docs/spikes/_TEMPLATE-finding.md` |
| finding 产出形态 | 每条 finding 独立成文 | 仍保留 3 份 summary-style doc 名称 |

这不是小的命名问题。  
如果不先统一，B1 会立刻遇到两个 ambiguity：

1. **到底要产出 per-finding docs，还是 3 份汇总 doc，还是两者都要？**
2. **extract-finding.ts 的输出，是直接完成交付，还是只是中间产物？**

我的建议是：

> **在 B1 之前先统一：把 `docs/templates/_TEMPLATE-spike-finding.md` 作为唯一模板路径；同时明确 Phase 0 交付物包含“两层文档”——逐条 finding docs + 3 份 index/rollup docs。**

否则 action-plan 写不出清晰的 deliverable checklist。

### 2.2 验证项 / finding 数量表述还有局部不自洽

这一点在 `P0-spike-do-storage-design.md` 和 `P0-spike-discipline-and-validation-matrix.md` 里都出现了。

#### A. binding 项数量 drift

在 `P0-spike-discipline-and-validation-matrix.md` 的交互矩阵里，写的是：

> `P0-spike-binding-pair-design` —— 本文 §4.3 binding **6 项**验证由该 design 实现

但 §4.3 实际只有 **4 项**：

- `V3-binding-latency-cancellation`
- `V3-binding-cross-seam-anchor`
- `V3-binding-hooks-callback`
- `V3-binding-eval-fanin`

这说明局部表述还残留旧稿 drift。

#### B. do-storage finding 数量 drift

`P0-spike-do-storage-design.md` 里，核心验证项是 **8 项**，这一点没问题：

- 6 storage
- 2 bash/capability

但同一文件里又出现了几组不一致的数字：

- `run-all-probes.sh` “顺次调用 **9** 路由”
- 生成 `.out/YYYY-MM-DD.json`（**10 条 ProbeResult**）
- 销毁条件里写“全部 **10 条 finding**（V1-V2 共 8 项 + 至少 2 条 unexpected finding）”

这说明当前稿子的真实意图其实是：

> **8 条 required validation findings + 允许额外 unexpected findings**

这个思路是合理的，但现在还没有被写成明确规则。  
如果不改，B1 就会不清楚：

1. **“必须完成”的是 8 条，还是 10 条？**
2. **unexpected finding 是鼓励项，还是 closure 必需项？**

我的建议是：

> **把 required baseline 与 optional unexpected findings 分开写死。**

例如：

- `required`: 每个 validation item 至少 1 条 finding
- `optional`: 允许额外产生 `unexpected-F*`
- closure 以 required 全覆盖为硬门槛，不以“凑够 10 条”作为硬门槛

这样 B1 才能写出明确的 completion condition。

### 2.3 `spike-binding-pair` 还没有把 transport scope 说透

这是我认为第二个最重要的问题。

当前 repo 里，service-binding reality 实际上有两种：

#### A. `session-do-runtime` 当前真正 load-bearing 的 remote seam

`packages/session-do-runtime/src/remote-bindings.ts` 明确写的是：

> service-binding 的 **lowest-common-denominator transport 是 `binding.fetch(new Request(...))`**

并且当前 `makeHookTransport()` / `makeCapabilityTransport()` 也都是走：

- `binding.fetch(...)`
- JSON body
- HTTP path (`/hooks/emit`, `/capability/call`, `/capability/cancel`)

也就是说，**对 `session-do-runtime` 这条真实链路来说，P0 binding-pair 现在的 fetch-based probe 是对的。**

#### B. repo 里另外一条已经存在的 RPC surface

但与此同时，`packages/nacp-core/src/transport/service-binding.ts` 又定义了另一条 transport reality：

- `ServiceBindingTarget.handleNacp(envelope)`
- RPC-shaped service binding transport
- `validateEnvelope → verifyTenantBoundary → checkAdmissibility → handleNacp`

这意味着仓库里其实已经有：

- **fetch-based binding seam**
- **RPC `handleNacp`-based transport seam**

而当前 `P0-spike-binding-pair-design.md` 只明确 probe 了前者，没有明确说明：

> **P0 的 binding-pair 到底是要关闭“当前 session-do-runtime 的 fetch seam 真相”，还是要关闭“整个 repo 的 service-binding transport 真相”？**

如果不把这个 scope 写清，B1 结束后会出现一个危险误解：

> “我们已经验证过 service binding 了”

但实际上验证的可能只是 **fetch path**，不是 repo 里全部 transport path。

我的建议不是让 P0 把 RPC path 也一起做了；那会让 scope 膨胀。  
我更建议：

> **在 P0-spike-binding-pair-design 里显式声明：本 spike 关闭的是 `session-do-runtime` 当前 load-bearing 的 fetch-based remote seam truth；`nacp-core` 的 `handleNacp` RPC transport 不在 Round 1 closure 范围内，后续如有需要单列 probe 或在 Phase 5 / Phase 6 补证。**

这样 action-plan 才不会把“partial truth”误写成“repo-wide truth”。

### 2.4 `spike-do-storage` 的 V2 probe 还没有完全贴住当前 capability-runtime 语义

这是我认为第三个需要在 B1 前收紧的地方。

`P0-spike-do-storage-design.md` 的 `V2-bash-platform` 很有价值，但当前写法还更像“Worker stress probe”，而不是“当前 capability-runtime 语义 probe”。

原因在于，repo 里的当前 capability reality 其实已经很具体：

#### A. filesystem handler 的真实行为

`packages/capability-runtime/src/capabilities/filesystem.ts` 已经明确：

- 所有路径必须走 `resolveWorkspacePath()`
- `/_platform/**` 是保留命名空间
- `mkdir` 目前是 **partial-with-disclosure**
- backend **没有目录 primitive**
- `mkdir` 只返回固定 note：`mkdir-partial-no-directory-entity`

这意味着当前 `mkdir` 的语义不是“真实目录创建”，而是 **ack-only prefix**。

#### B. search handler 的真实行为

`packages/capability-runtime/src/capabilities/search.ts` 也已经明确：

- `rg` 是递归 `WorkspaceFsLike.listDir/readFile`
- inline output cap 是 `200 lines / 32KB`
- reserved namespace silently skipped

也就是说，当前 `rg` 的行为不是“直接跑 ripgrep”，而是 **受 workspace API 与 output cap 强约束的 TS handler**。

#### C. 由此带来的设计偏差

而 `P0-spike-do-storage-design.md` 现在的 V2 probe 里仍然有几处更像 shell / OS stress assumptions 的表述：

- `mkdir -p a/b/c/d/e`
- `ls -R .`
- “subrequest count 在 mkdir 多少层时触发”
- “rg 跑多少文件时触发 50ms 上限”

这些并不完全对应当前 capability-runtime 的真实 handler 行为。  
例如，当前 `mkdir` handler 本身并没有目录实体与多级创建 primitive；它更接近一个 **path-law + disclosure behavior**。

所以我建议在 B1 前把 V2 probe 明确拆成两类：

1. **capability-parity probe**
   - 专门对齐当前 filesystem/search/network handlers 的真实 contract
   - 例如：`mkdir` partial note、reserved namespace、`rg` truncation、`cat` 大文件读取行为

2. **platform stress probe**
   - 测 Worker runtime 的 memory / cpu / subrequest 边界
   - 但明确标注它不是 current capability parity test，而是 future writeback input

否则 P0 findings 很容易写成：

> “Worker 环境下 bash 很慢”

却没有精确落到：

> “当前 `capability-runtime` 的哪个 handler contract 需要改、哪些只是 runtime guard 要补”

### 2.5 B1 还需要一个显式的“rollup / index doc”动作

这个问题和 2.1 相关，但我单独列出来，因为它会影响 Phase 0 closure。

现在 template 和两个 spike design 都非常强调：

- 每条 finding 独立成文
- 每条 finding 必须有 package impact + writeback path

这是对的。  
但当前设计里没有清楚回答：

> **那 `docs/spikes/storage-findings.md` / `binding-findings.md` / `fake-bash-platform-findings.md` 到底谁来写、写什么、什么时候写？**

如果没有这层 rollup，Phase 0 结束时会有一堆离散 finding，但没有：

- 总结性 verdict
- design writeback map
- B2/B3/B4 的输入索引

所以我建议 B1 里显式加入一个动作：

1. per-finding docs 先生成
2. 再生成 3 份 rollup/index docs
3. rollup doc 只做：
   - finding index
   - severity summary
   - writeback destination map
   - unresolved / dismissed summary

这样既不损失逐条精度，也能满足 charter 的阶段交付物。

---

## 3. 基于代码事实，我对“是否已足以支撑完整 action-plan”的判断

我的判断是：

> **是，已经足以支撑完整的 `B1-spike-round-1-bare-metal.md`。**

但这个判断有一个前提：

> **B1 不能直接把当前 4 份文档原样机械展开，而应先把上面 2.1-2.5 里的 drift 先写成 B1 的前置澄清项。**

换句话说，当前 P0 设计已经满足了 action-plan 的三项关键前提：

### 3.1 已经有明确的 phase goal

P0 不是模糊的“做点 spike”，而是：

- 2 个 spike
- 12 个 validation items
- Round 1 truth probe
- finding/writeback closure

### 3.2 已经有明确的 deliverable family

虽然命名仍有 drift，但 deliverable family 已经齐了：

- spike code
- deploy scripts
- raw outputs
- per-finding docs
- writeback mapping

### 3.3 已经有明确的 downstream consumers

P0 不再是自说自话的 phase，而是已经清楚指向：

- Phase 1 storage hardening
- Phase 2 fake-bash extension
- Phase 3 context-management
- Phase 4 hooks catalog
- Phase 5 protocol review
- Phase 6 integrated spike
- Phase 7 handoff

这就意味着 `B1` 已经有足够的信息去写：

- 批次划分
- 实施顺序
- deploy/run/extract/review/rollup 的动作链
- closure gate

---

## 4. 我建议在写 B1 前先补的最小修正清单

如果你希望 Phase 0 设计真正“可直接执行”，我建议先把下面 5 条补上：

1. **统一模板路径与命名**
   - 明确唯一模板路径：`docs/templates/_TEMPLATE-spike-finding.md`
   - 明确 `docs/spikes/_TEMPLATE-finding.md` 不再使用

2. **统一 finding 交付形态**
   - 明确：Phase 0 同时产出 `per-finding docs + 3 份 rollup docs`

3. **修正所有计数 drift**
   - `binding 6 项` → `binding 4 项`
   - `9 routes / 10 ProbeResult / 10 findings` 统一成 required vs optional 两层

4. **给 binding-pair 明确 transport scope**
   - 写清它验证的是 `session-do-runtime` 当前 fetch-based seam
   - 不默认关闭 `nacp-core` RPC transport truth

5. **给 do-storage 的 V2 probe 加一层“capability parity vs platform stress”划分**
   - 避免 bash/platform findings 最后落不到当前 handler contract

---

## 5. 最终评价

我对这组 P0 设计文档的最终评价是：

> **这是一组质量明显合格、方法论已经站稳、并且确实能把 Phase 0 从“方向讨论”推进到“可写 action-plan”的设计文档。**

它们最值得肯定的地方在于：

- 没有把 spike 写成产品化 worker
- 没有让 finding 停留在实验记录层
- 已经开始把 Phase 0 真正变成 P1-P7 的 truth source

它们最需要修正的地方在于：

- 命名与交付物层的 drift 还没完全收口
- 局部计数与 closure 条件还不够严格
- 个别 probe 还没有完全贴住 repo 现有实现的 load-bearing 语义

---

## 6. 最终 Verdict

### 6.1 关于 Phase 0 设计是否成立

**Verdict：成立。**

Phase 0 的设计目标、边界、验证矩阵、finding/writeback 逻辑都已经成立。

### 6.2 关于是否可以进入 action-plan

**Verdict：可以进入 `B1`，但建议先做一轮小收口。**

也就是说，现在不是“继续补更多 P0 设计文档”的时点了；  
现在更像是：

> **用这 4 份文档作为真相源，先修平命名/计数/transport-scope 的小 drift，然后就进入 `B1-spike-round-1-bare-metal.md`。**

### 6.3 一句话总评

> **Opus 这轮 Phase 0 设计已经把 after-foundations 的第一步真正落到了“可执行”的程度：两个 spike、12 项验证、逐条 finding、writeback 闭合，这条主链已经建立。现在缺的不是更多抽象讨论，而是把模板路径、finding 交付形态、计数口径、transport scope、以及 bash probe 的 capability 对齐再收紧一轮，然后就可以正式写 B1 并开工。**
