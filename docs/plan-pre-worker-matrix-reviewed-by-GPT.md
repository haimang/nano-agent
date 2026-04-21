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
