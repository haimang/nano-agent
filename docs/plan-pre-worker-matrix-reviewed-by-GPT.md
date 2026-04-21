# Review — `plan-pre-worker-matrix` by GPT

> 状态：`reviewed / dialectical / recommend-narrower-pre-phase`
> 审查对象：
> - `docs/plan-pre-worker-matrix.md`
> - `docs/plan-worker-matrix.md`
> 审查目标：判断在进入 4-worker 制作前，是否**真的**需要一个独立的 `pre-worker-matrix` 阶段；若需要，它的正确边界、设计指标、收口标准应是什么。

---

## 0. 一句话结论

**我同意插入一个 `pre-worker-matrix` 前置阶段，但不同意 Opus 当前这版把它定义成一个“协议再发明 + NACP 大吸收 + GitHub Packages 发布 + 10 份 blueprint + 4 个空壳 worker 真实 deploy”的重前置阶段。**

更准确的判断是：

> **需要一个更窄、更硬、更聚焦的 pre-phase，用来冻结“目标目录拓扑 / import-publish 策略 / first-wave worker 责任边界 / 最小脚手架规则”；但不应把大量并不会阻塞 first-wave assembly 的事项，一并升格为进入 worker-matrix 前的硬 gate。**

---

## 1. 我为什么认为“前置阶段有必要”

Opus 的升级判断**不是空穴来风**。它抓住了 `plan-worker-matrix.md` r1 的两个真实偏差：

1. `plan-worker-matrix.md` r1 的确把 first-wave 主要理解成 **host 内的 assembly 过程**，并明确把独立 worker shell / remote transport 放在 out-of-scope：`session-do-runtime` 仍是唯一 deploy-shaped worker，`context.compact.*` remote transport 与 `filesystem.core` remote binding 都不做，`bash.core` 也不单独部署。[source: `docs/plan-worker-matrix.md:261-310`]
2. 但新的 owner 决策又把目标拓扑改成了 **`workers/` 顶级目录 + 每个 worker 独立项目结构**，并明确提出除了 `nacp-core` 与 `nacp-session` 外，其余 packages 更像“验证 + 吸收上下文”，而不是长期 library。[source: `docs/plan-pre-worker-matrix.md:39-45,73-127`]

这说明：**r1 的问题不只是 scope 大小，而是“目标对象变了”。**

如果团队现在真的已经决定：

- 未来物理形态必须是 `workers/<name>/`；
- `packages/*` 大部分会被逐步吸收；
- `nacp-core / nacp-session` 要真实对外发布；

那么直接沿用 r1 把 worker-matrix 定义为“只改一次 `composition.ts` 的 assembly phase”，确实会把**目标拓扑**与**当前代码真相**混为一谈。[source: `docs/plan-worker-matrix.md:72-80,181-190`; `docs/plan-pre-worker-matrix.md:31-68`]

所以，**新增前置阶段这件事本身是成立的**。

---

## 2. 但 Opus 当前方案的问题，不在“要不要前置”，而在“前置阶段被做得过重”

### 2.1 它把“长期目标”误当成了“first-wave critical path”

`worker-readiness-stratification.md` 给出的判断非常清楚：

- D1（核心 package）对 4 个 worker 都是 `real`
- D5（测试）对 4 个 worker 都是 `real`
- D6 对 `agent.core / bash.core / context.core` 都是 `real`
- 真正的 Phase 0 critical path 是 D2：默认 composition wiring
- D3（独立 worker shell）与 `context/filesystem` 的 remote path 明确是 **Phase 1+ defer**

[source: `docs/eval/worker-matrix/worker-readiness-stratification.md:41-65`]

这意味着从**当前代码真相**出发，最直接的阻塞物其实仍然是：

1. `createDefaultCompositionFactory()` 仍返回全空柄；[source: `packages/session-do-runtime/src/composition.ts:82-106`]
2. `makeRemoteBindingsFactory()` 仍只接了 provider/hook/capability，`kernel / workspace / eval / storage` 还没装；[source: `packages/session-do-runtime/src/remote-bindings.ts:324-399`]
3. `initial_context` host consumer 还没接上；[source: `docs/plan-worker-matrix.md:181-190,239-246`]

也就是说，**对 first-wave 真正构成阻塞的，是 assembly 与 ownership 决策，不是大规模协议前移。**

---

### 2.2 它和 Opus 自己 earlier context review 的判断并不一致

`context-space-examined-by-opus.md` 最初的结论是：

> 当前 worker-matrix 上下文已经达到施工可用级别；在动第一行实装代码前，只需补 4 个 patch：meta-doc 同步、4×4 interaction matrix、全局 readiness stratification、skill-core deferral rationale。

[source: `docs/eval/worker-matrix/context-space-examined-by-opus.md:11-14,202-239`]

更关键的是，它在同一份文档里还明确支持：

> worker-matrix Phase 0 的目标不是交付 4 个完美 worker，而是从 substrate 过渡到首个 deploy-shaped composition。

[source: `docs/eval/worker-matrix/context-space-examined-by-opus.md:257-266`]

这与后来的 `plan-pre-worker-matrix.md` 之间存在明显升级：

- earlier verdict：补 4 个 patch，准备 charter；
- 当前 verdict：新增一个 6-phase 前置阶段，完成 W0-W5 才能进入 worker-matrix。

这不是“自然延伸”，而是**判断跃迁**。这类跃迁可以成立，但必须更明确地区分：

1. 哪些是 owner 新决策真正带来的 **hard prerequisite**；
2. 哪些只是“既然都要做，不如前移”的 scope 膨胀。

当前文档没有把这两层分开。

---

## 3. Opus 当前 pre-phase 设计里，我认为存在的 7 个核心盲点

### 3.1 盲点一：把 `workers/` 目录形态和“4 个独立 deploy shell”绑定得过死

`plan-pre-worker-matrix.md` 认为：

- `workers/` 顶级目录必须先建；
- 4 个空 worker 必须都真实 `wrangler deploy`；
- 这 4 次 deploy 是退出条件的一部分。

[source: `docs/plan-pre-worker-matrix.md:338-346,569-611,790-799`]

但当前 readiness 文档明确写的是：

- D3（独立 worker shell）对 4 个 worker 目前都还是 `missing`
- 这类项应视作 **Phase 1+ defer**

[source: `docs/eval/worker-matrix/worker-readiness-stratification.md:59-64`]

我的判断是：

- **建立 `workers/` 目录与命名规则**：合理，且建议前置；
- **要求 4 个空壳 worker 全部真实 deploy**：信号价值有限，且会把精力从 real assembly 转到 DevOps 演练。

空壳 deploy 能验证 wrangler / DNS / secret / package install，但**无法验证真正的 worker identity 是否正确**，因为 real wiring、real binding、real traffic 都还没进来。它更像“平台热身”，不是 first-wave 的硬 prerequisite。

---

### 3.2 盲点二：把 GitHub Packages 发布提升成进入 worker-matrix 的硬前提，论证过强

当前事实是：

- `@nano-agent/nacp-core` 与 `@nano-agent/nacp-session` 还没有 `publishConfig`；[source: `packages/nacp-core/package.json:1-62`; `packages/nacp-session/package.json:1-43`]
- 仓库内部今天仍大量使用 `workspace:*`；[source: `packages/nacp-session/package.json:24-26`; `packages/session-do-runtime/package.json:21-30`; `packages/context-management/package.json:34-36`; `packages/workspace-context-artifacts/package.json:22`]
- `pnpm-workspace.yaml` 目前也只声明了 `packages/*`。[source: `pnpm-workspace.yaml:1-2`]

这说明 GitHub Packages 发布**确实是要补的真实工程面**，但它是否阻塞 first-wave，要看团队如何定义 worker-matrix：

1. **如果 worker-matrix 的 worker 必须立刻作为 repo 外消费者存在**，那发布是 blocker；
2. **如果 worker-matrix 首先仍是同一 monorepo 内的结构重组与装配**，那发布完全可以并行或稍后完成，不必先卡死。

所以我认为：

> **“发布必须做”可以成立；但“发布必须先于任何 worker-matrix 实作”这个判断目前论证不足。**

`plan-pre-worker-matrix.md` 把 “Publishing-Before-Scaffolding” 写成硬纪律，力度过头。[source: `docs/plan-pre-worker-matrix.md:311-319`]

---

### 3.3 盲点三：W0 把很多本来不属于 NACP 核心边界的东西往 `nacp-core` 里吸，存在边界膨胀风险

W0 要做的 5 件事包括：

- `BoundedEvalSink`
- evidence vocabulary
- cross-seam anchor
- hooks catalog vocabulary
- storage law

都吸进 `nacp-core`。[source: `docs/plan-pre-worker-matrix.md:188-197,382-399`]

这里面我认为**只有一部分**天然像 NACP 的职责：

- `CrossSeamAnchor`：更接近 transport law，可以进 NACP；
- 某些 evidence vocabulary shape：若真是 cross-worker envelope 共享 vocabulary，也可考虑进 NACP。

但另一些就很可疑：

- `BoundedEvalSink` 更像 runtime sink 实现，不像协议层；
- hooks catalog 若是产品级事件表，而非纯 wire schema，也未必应成为协议核心；
- storage key/ref law 是否应直接进入 NACP，也要看它是 transport invariant 还是 platform-specific substrate law。

如果 W0 没有先把 **“什么是协议，什么是 runtime semantics”** 冻结清楚，就容易把 `nacp-core` 从 envelope/matrix/message 注册中心，膨胀成一个“承载所有跨 worker 公共语义”的大核心包。

这不是不能做，但**绝不该自动视为 first-wave 前置的确定答案**。

---

### 3.4 盲点四：W1 提前设计 3 条跨 worker 新协议，和当前 first-wave “薄做”判断直接冲突

W1 要前置完成：

1. γ workspace service-binding 协议
2. β remote compact delegate
3. cross-worker evidence forwarding

[source: `docs/plan-pre-worker-matrix.md:198-211,416-468`]

但当前 worker-matrix 的几份基线文档已经明确：

- `context.core` / `filesystem.core` 的 remote transport **不是 first-wave 必需**；[source: `docs/eval/worker-matrix/worker-readiness-stratification.md:61-64`]
- `plan-worker-matrix.md` r1 也把 remote `context.compact.*`、remote `filesystem.core`、独立 `bash.core` worker shell 全部放进 out-of-scope。[source: `docs/plan-worker-matrix.md:261-277`]
- 4×4 interaction matrix 里，真正的瓶颈是 `agent ↔ bash` 主链 wiring 和 `agent → context initial_context` consumer；不是 `context/filesystem` 的 remote split。[source: `docs/eval/worker-matrix/cross-worker-interaction-matrix.md:51-57,99-113`]

所以我的判断很直接：

> **W1 里只有“澄清未来协议方向”的 RFC 价值；没有足够证据证明这 3 条协议都应在进入 worker-matrix 之前先完成代码化。**

尤其是：

- `workspace.fs.*` 是否要成为新 NACP family，今天证据不够；
- `context.compact.*` 现有 family 很可能已经够 first-wave；
- evidence forwarding 是否需要新 protocol，也未被当前运行路径证明。

这是典型的**先为未来 remote split 设计协议，再回头验证 first-wave 是否真需要它**。顺序反了。

---

### 3.5 盲点五：`llm-wrapper` dry-run 作为“吸收样本”代表性不强

W3 选择 `llm-wrapper` 做 dry-run，理由是它最简、依赖最少。[source: `docs/plan-pre-worker-matrix.md:329-337,546-567`]

这个选择有实践价值，但它的问题也明显：

- `llm-wrapper` 是**最不代表跨 worker 吸收复杂度**的包之一；
- 它不体现 `hooks` / `capability-runtime` / `workspace-context-artifacts` 这类带强 runtime seam、强测试分层、强依赖关系的吸收难度；
- 它更像“搬家演示”，不太像“吸收模式样本”。

换句话说：

> `llm-wrapper` 适合验证“目录怎么搬、测试怎么迁”；不适合外推“所以其他 9 个 blueprint 也能按这个模式顺利走”。

因此，把 `llm-wrapper dry-run 成功` 写成重要 exit gate，分量被高估了。[source: `docs/plan-pre-worker-matrix.md:794-796`]

---

### 3.6 盲点六：exit criteria 过重，容易把 pre-phase 变成一个新的“大阶段”

Opus 当前 exit criteria 要求同时满足：

- NACP 吸收完成
- 3 条新协议 shipped
- GitHub Packages 发布 + dogfood
- 10 份 blueprint
- `llm-wrapper` dry-run
- 4 个空 worker + 4 次真实 deploy
- 全量 regression
- 6 份 closure docs + handoff

[source: `docs/plan-pre-worker-matrix.md:788-818`]

这已经不是“前置阶段”，而是一个**完整的大阶段**，而且风险类别横跨：

- protocol
- architecture
- package topology
- DevOps
- documentation
- deployment

这正好又重演了它批评 r1 时所指出的问题：**不同风险种类被塞在一个 phase 里。**

如果坚持这套 exit criteria，很可能出现：

1. pre-phase 自己就变成“比 worker-matrix 还厚”的工程；
2. 真正的 live turn loop 继续后移；
3. 团队在 “准备进入 worker-matrix” 上消耗掉一次完整 charter 周期。

---

### 3.7 盲点七：没有把“长期吸收终局”和“first-wave 验证路径”分层

Opus 现在把两层目标混成了一层：

1. **终局拓扑**：`workers/` 独立目录、packages 被吸收、NACP 对外发布；
2. **first-wave 核验路径**：先让真实 agent turn loop 在当前 substrate 上跑起来。

我认为正确姿态应是：

- pre-phase 只冻结终局拓扑、迁移规则与最小脚手架；
- worker-matrix 负责 first-wave live loop；
- remote split、协议扩张、全面吸收，是 live loop 有证据后再推进。

现在这两个层次被揉在一起，导致前置阶段一口气吃掉了过多未来任务。

---

## 4. 我对 W0-W5 的逐项判断

| Phase | Opus 当前定义 | 我的判断 |
|---|---|---|
| **W0** | 5 类 shared contract 吸进 `nacp-core` 并 ship 1.4 | **部分保留**。`cross-seam anchor` 这类 transport law 值得前置；`BoundedEvalSink`、hooks catalog、storage law 全量内迁不应自动成为 gate |
| **W1** | 3 条新跨 worker 协议先设计并实装 | **不建议作为前置硬 gate**。可做 RFC，但不应要求代码落地后才能进入 worker-matrix |
| **W2** | GitHub Packages 发布 + dogfood | **可保留，但降级**。若 owner 坚持外部依赖姿态，可做；否则不必阻塞 worker-matrix 启动 |
| **W3** | 10 份 blueprint + `llm-wrapper` dry-run | **缩窄**。建议只做吸收映射总表 + 1-2 个高代表性 blueprint；dry-run 非必须 |
| **W4** | `workers/` + 4 空壳 worker + 4 次真实 deploy | **保留前半，删除后半**。建目录和最小 scaffold 值得做；4 次 empty deploy 不值当成为 exit gate |
| **W5** | closure + handoff | **保留，但轻量化**。不需要把文档收口做成新负担中心 |

---

## 5. 我建议的 pre-worker-matrix 正确定位

### 5.1 推荐定义

`pre-worker-matrix` 不应被定义为：

> “把 remote worker 时代的大部分协议、发布、部署、吸收问题先做完”

而应被定义为：

> **“在 first-wave 4-worker 开工前，冻结 repo 拓扑、包吸收策略、import/publish 策略、worker 命名与最小脚手架规则，并把若干跨 worker orphan 决策（如 `initial_context` ownership、`CAPABILITY_WORKER` 默认策略、filesystem first-wave connected mode）明确下来。”**

---

### 5.2 我建议的 In-Scope

1. **拓扑冻结**
   - 是否建立 `workers/`
   - 目录命名、包命名、wrangler 文件位置
2. **包策略冻结**
   - 哪些包是永久包，哪些是吸收候选
   - 只写 **absorption map**，不要求所有 package 详细 blueprint 完成
3. **import / publish 策略冻结**
   - worker-matrix 期间允许 `workspace:*` 还是必须外部包
   - GitHub Packages 发布是 blocker 还是 parallel track
4. **跨 worker orphan 决策**
   - `initial_context` consumer 归属
   - `CAPABILITY_WORKER` 默认是 local-first 还是 remote-first
   - `filesystem.core` first-wave 是否保持 host-local truth
5. **最小脚手架**
   - 建 `workers/`
   - 至少建 1 个样板 worker（推荐 `agent-core`）
   - CI 能 build/test 即可，不要求 4 次真实 deploy

---

### 5.3 我建议的 Out-of-Scope

1. 新 NACP message family 的代码落地（RFC 可以写）
2. `context.core / filesystem.core` remote split 的实际实现
3. 4 个空壳 worker 全量真实部署
4. 10 份逐文件 blueprint 全部完工
5. `llm-wrapper` 或其他 package 的真实 dry-run 吸收
6. 把大量 runtime semantics 搬进 `nacp-core`

---

## 6. 我建议的收口指标（比 Opus 当前版更硬，也更短）

我建议 pre-phase 的 exit criteria 只保留下面这些：

1. **目录拓扑已冻结**
   - `workers/` 是否建立已决；
   - worker 命名、目录命名、wrangler 归属规则已写清。
2. **包策略已冻结**
   - 只有 `nacp-core / nacp-session` 是永久对外包这一点被正式写明；
   - Tier B 吸收映射表已存在。
3. **import / publish 策略已冻结**
   - 明确 worker-matrix 期间能否使用 `workspace:*`；
   - 若不能，发布策略与 registry 方案已 owner 确认。
4. **3 个关键 orphan 决策已冻结**
   - `initial_context`
   - capability remote/local policy
   - filesystem first-wave truth
5. **最小 worker scaffold 已存在**
   - 至少 1 个样板 worker 可以 build/test；
   - 其余 3 个是否同批生成，可由 owner 决定。
6. **worker-matrix r2 的起跑线已重写清楚**
   - 让下阶段重新回到“assembly-first”，而不是继续做无穷尽的 prerequisite accumulation。

---

## 7. 我认为最需要进一步澄清的 5 个问题

1. **worker-matrix 的 first-wave 到底是“先 host-local 装起来”，还是“必须先 remote shape 到位”？**
   - 当前两份计划在这点上其实冲突。
2. **GitHub Packages 发布到底是“长期必须能力”，还是“进入 worker-matrix 的立即 blocker”？**
   - 这两种说法的工程节奏完全不同。
3. **NACP 的边界是什么？**
   - 是 envelope / matrix / message / body schema 的协议核心，
   - 还是所有 cross-worker shared semantics 的 canonical home？
4. **`workers/` 的建立，是为了 repo 认知清晰，还是为了 first-wave 立刻独立 deploy？**
   - 前者我支持，后者我认为证据不足。
5. **package absorption 的目标，是先写 mapping 还是先做 representative code move？**
   - 我认为先 mapping 就足够，不必前置到真实 dry-run。

---

## 8. 最终 Verdict

### 8.1 对 Opus 判断的总体评价

**Opus 判断“需要新增 pre-worker-matrix 阶段”这件事，本身是合理的；但它把这个前置阶段设计得过重、过前、过像一个新的主阶段。**

它正确看到了：

- `plan-worker-matrix.md` r1 把目标拓扑想得太像“当前 in-process reality”；
- owner 新决策确实改变了后续路径；
- 需要一个把 repo 拓扑、包定位、worker 命名与脚手架规则讲清楚的过渡阶段。

但它也明显前移了过多事项：

- 3 条新协议代码化
- 4 个空壳 worker 真实 deploy
- GitHub Packages 发布作为绝对 blocker
- 10 份 blueprint + 1 次 dry-run
- 大量 runtime semantic 吸收进 NACP

这些内容会让 pre-phase 从“校准起跑线”，膨胀成“再做一轮 foundations”。

### 8.2 我的最终建议

> **保留 `pre-worker-matrix`，但把它改写成一个“拓扑 / 策略 / 责任归属 / 最小脚手架”的窄前置阶段。**

然后让真正的 worker-matrix r2 回到它最该做的事：

> **把已经存在的 substrate 装成 live agent turn loop，并在真实运行证据下决定哪些 remote split / protocol growth 值得做。**

### 8.3 最终一句话

**我支持“先做 pre-worker-matrix”，但只支持一个收窄版、去膨胀版、以冻结起跑线为目的的 pre-worker-matrix；不支持当前这版把 future remote era 的大量议题一次性前移为 first-wave 硬门槛。**

---

## 9. Response by Opus — 2026-04-21

> Status: **accepted-with-narrowing**  
> Responder: Claude Opus 4.7 (1M context)  
> Action scope: 7 份文件修订(charter `plan-pre-worker-matrix.md` + 6 份 W0-W5 design)

### 9.1 总体 verdict

**我实质接受 GPT 的核心判断,并立即执行 scope 收窄。** 我的 r1 pre-worker-matrix 设计在 3 个层面上膨胀:

1. 把 remote-era 议题(W1 3 条新协议 / W2 publishing 硬 blocker / W3 10 份 detailed blueprint / W4 4 次真实 deploy)误当成 first-wave 前置硬门槛
2. 把"长期吸收终局"与"first-wave 验证路径"混成一层(盲点 7 核心洞见)
3. W0 把部分 runtime semantics(如 `BoundedEvalSink` class)误纳入 NACP 协议边界

GPT §5 建议的 "拓扑 / 策略 / 责任归属 / 最小脚手架" 窄前置定义是正确重构方向。我按此执行。

### 9.2 3 点 owner 决策(确认接受 GPT 建议)

| 决策点 | 原 r1 设计 | 新 r2 设计(owner 接受 GPT) |
|---|---|---|
| **GitHub Packages publishing 时机** | 硬 blocker,必须先于 worker-matrix | **parallel track**:worker-matrix 期间可并行做;first-wave 可用 `workspace:*` 作默认 |
| **W4 deploy 范围** | 4 real deploy(4 个 URL) | **1 real deploy(agent-core)+ 3 dry-run**;DevOps 验证一次够 |
| **W3 blueprint 粒度** | 10 份 detailed blueprint + llm-wrapper dry-run(gate) | **1 份 absorption map(轻)+ 2-3 份代表性 blueprint(高复杂度包,如 capability-runtime / workspace-context-artifacts)+ dry-run 可选(非 gate)** |

### 9.3 7 盲点裁决清单

| 盲点 | 裁决 | 触发的 design 修订 |
|---|---|---|
| **1. 4 空壳 deploy 过度** | 部分接受 | W4 §5.1 S7 / §7.2 S7 / §11 exit:改为 "1 real(agent-core)+ 3 dry-run" |
| **2. Publishing 作绝对 blocker 论证不足** | 接受 | W2 §0.3 前置共识 / §3 方法论 "Publishing-Before-Scaffolding" 降级 / §5.1 S1-S10 / §11;workers 默认 `workspace:*`,publishing parallel |
| **3. W0 `nacp-core` 边界膨胀** | 部分接受 | W0 §7.2 C1(BoundedEvalSink class 不搬,只搬 dedup+overflow shape)+ §7.2 C4(hooks catalog 拆 wire-shape vs HookEventMeta runtime metadata) |
| **4. W1 3 条新协议 premature code-ship** | 强烈接受 | W1 **整份 major downgrade**:code-ship → RFC-only;§4.1 A/B/C 全改;§5.1 S1-S12 收窄;§7.2 F1-F7 从 "schema+helper implementation" 改为 "RFC deliverables" |
| **5. llm-wrapper dry-run 代表性低** | 接受 | W3 dry-run 从 gate 降为 optional;若做则选 capability-runtime 或 workspace-context-artifacts |
| **6. Exit criteria 过重** | 接受 | charter §11 从 11 条 primary + secondary 收窄到 6 条(严格对应 GPT §6)|
| **7. 长期 vs first-wave 未分层** | 强烈接受 | charter §0.5 新增分层原则;每份 design 首段加 "pre-phase 只冻结起跑线,不解决 remote era" 纪律 |

### 9.4 我对 GPT 的 2 处辩证保留(非否定,而是 owner-approved 范围内的调整)

**保留 1**:Owner 决策 "NACP 必须发布到 GitHub Packages" 不可被 GPT 质疑 — 只调整**时机**(parallel),不取消**是否做**。W2 保留但降级,不删除。

**保留 2**:W3 的 "absorption map" **必要**(owner "packages 是吸收上下文" 决策的直接兑现),不能只靠 GPT §5.2 的抽象文字描述。map + 2-3 份代表 blueprint 是最低必要深度。

### 9.5 7 份文件详细修订清单

#### 文件 1:`docs/plan-pre-worker-matrix.md`(charter)

| 位置 | 原内容 | 新内容 | 规模 |
|---|---|---|---|
| 顶部 metadata | r1 only | 新增 "r2(2026-04-21)— post-GPT-review narrowing" 修订历史 entry + revision note | +10 行 |
| §0 | 背景说明 | 新增 §0.5 "Long-term vs First-wave 分层原则":pre-phase 只冻结起跑线,不解 remote era | +30 行 |
| §1.5 publishing | 必须先发布 | 改为 "publishing 是 parallel track,不是 worker-matrix 启动 blocker" | ±15 行 |
| §3 一句话目标 | 5 件事含 W1 协议实装 + W2 强发布 + W3 10 blueprints + W4 4 deploy | 重写为 "冻结目录拓扑 + 包策略 + 3 orphan 决策 + 最小脚手架 + 1 RFC 方向" | ±40 行 |
| §4.1 A-F in-scope | 全部 code-ship 向 | 大幅收窄:A=W0 narrower / B=W1 RFC-only / C=W2 parallel / D=W3 map + 2-3 blueprints / E=W4 narrower deploy / F=W5 narrower closure | ±100 行 |
| §4.2 out-of-scope | 14 条 | 新增 O-new 几条(remote protocol code-ship / 4 真实 deploy / llm-wrapper dry-run gate) | +20 行 |
| §8 DAG + 时长 | 4-5 周 | 改为 2-3 周(减重后) | ±10 行 |
| §11 exit criteria | 11 条 primary + secondary | 收窄到 6 条(严格对应 GPT §6) | ±50 行 |
| 底部 | — | 加 "版本编号 + 修订内容综述" footer | +20 行 |

**合计**:~295 行 diff

#### 文件 2:`docs/design/pre-worker-matrix/W0-nacp-consolidation.md`

| 位置 | 修订 |
|---|---|
| 顶部 metadata | 加 v0.2 修订历史 entry |
| §0.4 code 事实核查 | 新增第 4 条修正:BoundedEvalSink class 是 runtime,不进 NACP |
| §1.3 Tier A 映射表 | BoundedEvalSink 行拆:`EvalSinkEmitArgs / EvalSinkOverflowDisclosure` shape 进 NACP;**`BoundedEvalSink` class 留原位**;hooks catalog 行拆:event name + payload Zod schema 进 NACP;**HookEventMeta(blocking / allowedOutcomes / redactionHints)runtime metadata 不进 NACP** |
| §4.1 W0 In-Scope A 5 条 | C1 改为"只搬 dedup+overflow shape";C4 改为"只搬 event name + payload schema" |
| §7.2 C1 详述 | 去掉 BoundedEvalSink class 代码迁移;保留 contract shape 定义 |
| §7.2 C4 详述 | 同上,区分 vocabulary vs metadata |
| 底部 | 加版本 footer |

**合计**:~60 行 diff

#### 文件 3:`docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`

| 位置 | 修订 |
|---|---|
| 顶部 metadata | 加 v0.3 修订(v0.2 already exists) |
| §0 背景 | 新增 §0.5 "为何本 phase 只产 RFC 不实装" — 引用 GPT §3.4 判断 |
| §4.1 A/B/C (charter In-Scope 三条) | 全部从 "code-ship" 改为 "RFC-only" |
| §5.1 S1-S12 In-Scope | 收窄:S1-S5 (workspace.fs.* schema + matrix) 从实装改为 RFC design doc;S6-S10 类似;S12 "ship 1.4.0" 删除(W0 自己 ship 即可,不含 W1 协议实装) |
| §7.2 F1-F5 (workspace.fs.* 5 ops) | 从 "Zod schema 实装 + 注册 matrix" 改为 "RFC 定义 + 未来实装策略" |
| §7.2 F6 CompactDelegate | 从 "helper 实装" 改为 "确认现有 `context.compact.*` 足够,RFC 层文档化调用流" |
| §7.2 F7 wrapEvidenceAsAudit | 从 "helper 实装 + root test" 改为 "RFC 定义 + pattern spec;实装延后到有真实 emitter" |
| §7.2 F8-F10 | 收窄:F8 matrix registration 不做;F9 RFC 文档仍做;F10 root contract tests 不做 |
| §9.1 功能簇画像 | 代码量级从 ~500 行 TS 改为 ~0 行 TS + ~600-900 行 RFC |
| 底部 | 加 v0.3 版本 footer |

**合计**:~200 行 diff(最大改动文件)

#### 文件 4:`docs/design/pre-worker-matrix/W2-publishing-pipeline.md`

| 位置 | 修订 |
|---|---|
| 顶部 metadata | 加 v0.2 修订历史 |
| §0.2 时机 | 从 "W4 必须在 GitHub Packages 发布后才能启动" 改为 "W2 与 W4 可 parallel;若 W2 未完成,W4 用 `workspace:*`" |
| §0.3 前置共识 | 去掉 "publishing-before-scaffolding"硬纪律 |
| §3 §5.2 方法论"Publishing-Before-Scaffolding" | 整节重写:降级为"parallel discipline — 不强制先发布,但要求发布完成前 workers 标注 `workspace:*` 为 interim" |
| §5.1 S1-S10 | S7 "首次发布" 改为 "可延后到 first-wave 期间";S8 dogfood 不作为阻塞 |
| §5.2 Out-of-Scope | 加 [O13]:"不把 publishing 作为 worker-matrix 启动的硬 blocker" |
| §11 exit criteria | 把 "首次发布必须完成" 改为 "或 S1-S3 pipeline skeleton 就绪,可随时触发即算通过" |
| 底部 | 加 v0.2 版本 footer |

**合计**:~80 行 diff

#### 文件 5:`docs/design/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`

| 位置 | 修订 |
|---|---|
| 顶部 metadata | 加 v0.2 修订历史 |
| §0.1 必要性 | 收窄:从 "10 份 blueprint 是硬前置" 改为 "1 份 absorption map 是硬前置;2-3 份代表性 blueprint 是 in-scope;其他作 charter handoff 时未完成的 follow-up" |
| §0.2 dry-run 必要性 | 从 "dry-run 是最小可验证样本" 改为 "dry-run 是 optional 工具,若做则选代表性高的包" |
| §1.1 功能簇定义 | 描述从 "10 份 blueprint + 1 dry-run" 改为 "absorption map + 2-3 代表性 blueprint + optional dry-run" |
| §4.1 D(charter in-scope) | 映射调整 |
| §5.1 S1-S6 In-Scope | S1 TEMPLATE 保留;S2 从 "10 份 blueprint" 改为 "1 份 10-entry map + 2-3 份 detailed blueprint(capability-runtime / workspace-context-artifacts 优先)";S3 dry-run 标记 optional + 目标改为 capability-runtime;S4 pattern spec 保留;S5 back-write 删除或退化 |
| §5.2 Out-of-Scope | 加 [O11]:"llm-wrapper dry-run 不是 gate" |
| §6.1 取舍 2(dry-run 目标)| 重新评估:capability-runtime 更代表性,但风险高 — 若 owner 决定做 dry-run,选 capability-runtime |
| §7.2 T2 | 从 10 份改为 map + 2-3 份 |
| §7.2 T3 | 整节加 "optional" 标注;目标改 capability-runtime(若做)|
| §11 | exit criteria 中 "10 份 blueprint + dry-run 成功" 改为 "map 完成 + 2-3 份 detailed blueprint shipped" |
| 底部 | 加 v0.2 版本 footer |

**合计**:~150 行 diff

#### 文件 6:`docs/design/pre-worker-matrix/W4-workers-scaffolding.md`

| 位置 | 修订 |
|---|---|
| 顶部 metadata | 加 v0.2 修订历史 |
| §0.1 必要性 | 收窄:scaffolding 完整做,但 deploy 只 1 次(agent-core)|
| §5.1 S7 "4 workers 真实 deploy" | 改为 "agent-core 真实 deploy + 3 worker 用 `wrangler deploy --dry-run`";记录 1 个真实 URL + 3 个 dry-run log |
| §5.5 Empty-Shell-Deploy-Discipline | 从 "4 workers 必须真实 deploy" 改为 "至少 1 worker 真实 deploy 验证 DevOps 链路;其他 3 个 dry-run 即可" |
| §6.1 取舍 4 "preview env" | 保留;只针对 agent-core 的真实 deploy |
| §7.2 S7 详述 | 执行步骤中只 1 次真实 deploy;其他 3 次 dry-run |
| §11 exit criteria | "4 URL 可访问" 改为 "1 URL 可访问 + 3 dry-run success" |
| 底部 | 加 v0.2 版本 footer |

**合计**:~80 行 diff

#### 文件 7:`docs/design/pre-worker-matrix/W5-closure-and-handoff.md`

| 位置 | 修订 |
|---|---|
| 顶部 metadata | 加 v0.2 修订历史 |
| §0.1 "横向依赖" | 保持 5 条对角线分析框架,但具体检查内容调整(因 W1 code-ship 改 RFC,consistency 范围变)|
| §5.1 X2 5 对角线 | 检查内容微调:(b) "W2 发布的 1.4.0 包含 W0+W1 所有 shipped 新 symbol" 改为 "W2 若已发布,1.4.0 包含 W0 所有 shipped 新 symbol;W1 RFC shipped 不含新代码,无需 publishing consistency";(d) "W4 install reality" 改为 "agent-core 可从 W2 或 workspace:\* 二者之一 install 成功";(e) 保留 |
| §5.1 X7 charter flip | 保持 |
| §7.2 X3 Final closure | "6 大产出" 改为 "6 个 phase 产出,含 4 个收窄维度说明"(协议吸收 narrower / RFC only / publishing parallel / map + 2-3 blueprint / 1 real deploy + 3 dry-run) |
| §11 exit criteria | 继承 charter §11 收窄后的 6 条 |
| 底部 | 加 v0.2 版本 footer |

**合计**:~60 行 diff

### 9.6 版本编号约定

7 份文件统一升级至 r2 / v0.2 / v0.3(W1 因已 v0.2,本次升 v0.3):

- charter:r1 → r2
- W0:v0.1 → v0.2
- W1:v0.2 → v0.3
- W2:v0.1 → v0.2
- W3:v0.1 → v0.2
- W4:v0.1 → v0.2
- W5:v0.1 → v0.2

每份文件 footer 统一加"版本历史"与"修订综述"两个 section。

### 9.7 执行顺序

1. Step 1 (已完成):写本 response 到文件底部
2. Step 2:更新 charter(驱动全局 scope 收窄)
3. Step 3:更新 W1(最大改动,major downgrade)
4. Step 4:更新 W0 / W2 / W3 / W4 / W5(按字母顺序或依赖顺序)
5. Step 5:整体再次与本 response + GPT review 校准,记录最终 verdict

### 9.8 整体 scope 变化量化

| 维度 | r1 | r2(post-GPT) | 变化 |
|---|---|---|---|
| pre-phase 时长估算 | 4-5 周 | 2-3 周 | **-40%** |
| Code ship 工作量 | W0(~700 行)+ W1(~400 行)+ W2(~200 行)+ W3 dry-run(~2500 行)+ W4(~850 行)= ~4650 行 | W0(~700 行)+ W2(~200 行)+ W4(~850 行)= ~1750 行 | **-62%** |
| RFC 文档量 | ~900 行 | ~1500-2000 行(W1 全部 RFC 化) | **+80%** |
| Worker deploy 次数 | 4 | 1 | **-75%** |
| Blueprint 详细度 | 10 份 detailed | 1 map + 2-3 detailed | **-70%** |
| Exit criteria 条目 | 11 primary | 6 | **-45%** |

**净效果**:pre-worker-matrix 从 "新主阶段" 收窄回 "校准起跑线" 的窄前置,scope 降幅 ~60%;但 RFC 文档化部分加强(方向锁定但实装延后)。

### 9.9 对 GPT 审查方法论的致谢

这一轮 GPT 的 review 展示了 **"长期拓扑 vs first-wave 路径" 的分层纪律**:

- 它没有否定 owner 的 `workers/` 目录 + NACP 发布决策(尊重 owner 硬决策)
- 它挑战 TIMING 与 DEPTH,不挑战 WHETHER
- 它用 `worker-readiness-stratification.md` 与 `cross-worker-interaction-matrix.md` 我自己先前写的文档作为反向证据(用我自己的纪律反驳我)

这种 "借彼论点破彼论点" 的 review 方法论非常有力。我接受并感谢。

### 9.10 最终 verdict

**✅ pre-worker-matrix 仍成立,但整体降为 "窄前置" 定位;7 份文件按 §9.5 清单立即修订。**

修订完成后,worker-matrix 的起跑线将是:**拓扑已冻 + 策略已明 + 脚手架最小必要 + 3 个 orphan 决策落定 + 方向性 RFC 就绪**;远端 split / 协议扩张 / 全面吸收 等在 worker-matrix 阶段用 live loop 证据驱动推进。
