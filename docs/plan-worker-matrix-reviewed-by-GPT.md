# Plan Worker Matrix — reviewed by GPT

> 审查对象: `docs/plan-worker-matrix.md`
> 审查时间: `2026-04-23`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/plan-worker-matrix.md`
> - `docs/handoff/pre-worker-matrix-to-worker-matrix.md`
> - `docs/eval/worker-matrix/{index,00-contexts/00-current-gate-truth,cross-worker-interaction-matrix,worker-readiness-stratification,skill-core-deferral-rationale}.md`
> - `docs/eval/worker-matrix/{agent-core,bash-core,context-core,filesystem-core}/index.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：**这份 charter 已经可以支撑 `4-worker` 的基本架构落地与基本功能验证，但它当前更像“可执行且略偏强”的执行 charter，而不是“仅验证最小闭环”的窄计划。**
- **结论等级**：`approve-with-followups`
- **本轮最关键的 3 个判断**：
  1. **worker-matrix 被定义为 `assembly + absorption` 是对的**，并且与当前真相层一致；它没有回退到“重新定义 4 workers 是什么”的旧问题。见 `docs/plan-worker-matrix.md:30-55`、`docs/eval/worker-matrix/index.md:93-101`。
  2. **这份计划足以完成 first-wave 的核心闭环**：`agent.core` host runtime、`bash.core` remote capability seam、`context.core` 的 `initial_context`/assembly、`filesystem.core` 的 workspace/storage substrate 归属都已进入 In-Scope。见 `docs/plan-worker-matrix.md:149-167,188-347,353-438`。
  3. **它还有 3 个执行层缺口需要先说清**：`bash-core` real preview deploy 在 P2 是隐含依赖、`initial_context` 缺 dedicated root e2e、以及 `context/filesystem` 的 host-local posture 不应被硬写成“4 个 entry 都必须变成 remote live worker”。见 §2 的 R1-R3。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/plan-worker-matrix.md`
  - `docs/handoff/pre-worker-matrix-to-worker-matrix.md`
  - `docs/eval/worker-matrix/index.md`
  - `docs/eval/worker-matrix/cross-worker-interaction-matrix.md`
  - `docs/eval/worker-matrix/worker-readiness-stratification.md`
  - `docs/eval/worker-matrix/skill-core-deferral-rationale.md`
  - 4 份 worker `index.md`

### 1.1 已确认的正面事实

1. **charter 起点正确**：文档明确把 worker-matrix 定义为 “把已 shipped 的 Tier B substrate 按 W3 map 吸收进 `workers/*/src/`，并装出 live agent turn loop”的阶段，而不是重新讨论拓扑或协议。见 `docs/plan-worker-matrix.md:41-55`。
2. **冻结事实引用基本对齐当前真相**：计划继承了 `@haimang/nacp-core@1.4.0`、`@haimang/nacp-session@1.3.0`、4 个 `workers/*` shell、W3 10 units / 4 workers、以及当前未完成项。见 `docs/plan-worker-matrix.md:60-115`。
3. **In-Scope 覆盖了 4-worker 基本架构所需的关键工作**：A1-A5、B1、C1+C2、D1+D2 absorption；default composition；remote bindings；`initial_context` consumer；`agent↔bash` binding；context/filesystem posture；published-path cutover；deprecation；closure。见 `docs/plan-worker-matrix.md:149-167`。
4. **4 个 worker 的 charter-level 定位总体与刷新后的 worker truth 一致**：
   - `agent.core` 继续是 host worker，而不是 binding slot。见 `docs/plan-worker-matrix.md:188-229` 与 `docs/eval/worker-matrix/agent-core/index.md:60-70,171-177`。
   - `bash.core` 是 governed fake-bash capability worker，不是 full shell。见 `docs/plan-worker-matrix.md:231-271` 与 `docs/eval/worker-matrix/bash-core/index.md:56-65,165-171`。
   - `context.core` / `filesystem.core` 是 thin substrate workers，首波可以继续 host-local posture。见 `docs/plan-worker-matrix.md:273-347` 与 `docs/eval/worker-matrix/context-core/index.md:56-65,166-172`、`docs/eval/worker-matrix/filesystem-core/index.md:56-65,167-173`。
5. **7 个 owner questions 都是当前真实需要决策的问题**，不是伪问题。它们分别触及 PR 粒度、remote default、compact posture、filesystem posture、cutover trigger、deprecated banner 时机、`skill.core` admit。见 `docs/plan-worker-matrix.md:441-496`。

### 1.2 已确认的负面事实

1. **P2 对 `agent.core ↔ bash.core` live binding 的实现路径有隐含依赖，但没有写成清晰前置条件**。计划正文知道要在 P2 激活 `BASH_CORE` binding，并做 live `tool.call.*` 闭环，但把 “bash-core 必须先 real preview deploy” 只写在风险表里。见 `docs/plan-worker-matrix.md:380-381,410-413,510`。
2. **`initial_context` 是计划承认的关键缺口，但当前 DoD 对它的验证要求偏弱**。正文要求新增 API 与 host consumer 接线，但 P2 DoD 只硬性要求了 `tool.call.*` 的根级 e2e，未要求 dedicated `initial_context` root e2e。见 `docs/plan-worker-matrix.md:157,376-377,409-413`；对照 `docs/eval/worker-matrix/cross-worker-interaction-matrix.md:62-70`。
3. **charter 的部分退出口径把“4 workers 基本架构成立”写得比当前 first-wave posture 更强**。它要求 `4 workers 的 src/ 全部非 version-probe`，这对 `context.core` / `filesystem.core` 的 host-local 首波姿态来说过满。见 `docs/plan-worker-matrix.md:126,417-429,521`；对照 `docs/plan-worker-matrix.md:276,315`。

---

## 2. 审查发现

### R1. P2 对 `bash-core` real preview deploy 的前置依赖写得不够显式

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/plan-worker-matrix.md:380-381` 把 P2.E 定义为激活 `CAPABILITY_WORKER` binding 并 redeploy `agent-core`。
  - `docs/plan-worker-matrix.md:410-413` 的 P2 DoD 要求 `BASH_CORE` binding active + 端到端 `tool.call.*` root e2e。
  - `docs/plan-worker-matrix.md:510` 才补写 “P2.E 前必须先把 bash-core real preview deploy 完成，再在 agent-core 激活该 binding”。
- **为什么重要**：
  - 这是 P2 live loop 的真实外部前提，不只是风险提示。
  - 如果不把它前置写进 phase / DoD / checklist，执行者很容易先做 agent 侧 binding activation，再在 preview 环境得到一个“架构没错但目标 worker 不存在”的假红。
- **审查判断**：
  - 这不是 blocker，但它是当前计划里最明显的隐性执行依赖。
- **建议修法**：
  - 把 “`workers/bash-core` real preview deploy 完成” 升级为 **P2 的显式前置条件或 DoD 条目**。
  - 最简单的修法是：在 `P2.E` 前增加一条 `P2.E0 — bash-core preview deploy`，或在 `6.2 P2 DoD` 加一条 “bash-core preview deploy 成功并可被 `BASH_CORE` service binding 命中”。

### R2. `initial_context` 的验证要求不足以证明第二条关键 first-wave seam

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - 计划把 `initial_context` 明确列为 In-Scope：`docs/plan-worker-matrix.md:157,409`。
  - P2 sub-phase 里也专门安排了 `appendInitialContextLayer` API 与 host consumer：`docs/plan-worker-matrix.md:376-379`。
  - 但 P2 DoD 的根级 e2e 只明确要求了 `tool.call.request → bash-core → response → stream` 这条链路：`docs/plan-worker-matrix.md:412`。
  - 刷新后的交互矩阵把 `initial_context` 明确列为 “最重要的非 remote gap”：`docs/eval/worker-matrix/cross-worker-interaction-matrix.md:62-70`。
- **为什么重要**：
  - 如果只验证 `tool.call.*`，那 plan 会证明 “host↔bash” 跑通，但不能证明 “session.start → context assembly” 真的被接到了 live loop。
  - 这会让 `context.core` 的 first-wave 价值只停留在 API/DoD 文本，而不是根级闭环证据。
- **审查判断**：
  - 当前计划对 `initial_context` 的实现覆盖是够的，但对验证覆盖仍偏弱。
- **建议修法**：
  - 在 P2 DoD 里补一条 dedicated root e2e：`session.start` 带 `initial_context`，host 调 `appendInitialContextLayer`，随后 assembled prompt / context evidence / downstream behavior 出现可验证变化。

### R3. “4 workers 基本架构成立”的出口条件写得比 first-wave posture 更强

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - 计划在一句话产出里写 “4 个 workers 的 `src/` 内有真实吸收后的 runtime(非 version-probe shell)”：`docs/plan-worker-matrix.md:126`。
  - Exit Criteria 第 2 条又要求 “4 workers 的 `src/` 全部非 version-probe；每个 worker 的 `src/index.ts` 暴露的都是吸收后的真实 runtime”：`docs/plan-worker-matrix.md:521`。
  - 但同一份计划又明确 `context.core` / `filesystem.core` 首波运行位置是 **host 进程内**，独立 remote service 不是首波硬要求：`docs/plan-worker-matrix.md:276,315`。
  - 刷新后的 readiness / interaction docs 也强调：首波真正需要 battle-test 的 remote loop 是 `agent.core ↔ bash.core`，而 `context.core` / `filesystem.core` 首波主要是 substrate absorption，不是 remote chatter：`docs/eval/worker-matrix/cross-worker-interaction-matrix.md:49-109`、`docs/eval/worker-matrix/worker-readiness-stratification.md:67-95`。
- **为什么重要**：
  - 如果保持现在的表述，执行者可能为了满足 “4 个 entry 都非 probe” 而给 `context/filesystem` 强行做一个过早的 remote live entry。
  - 这会和整个 `conservative-first / host-local first-wave` 的真相层冲突。
- **审查判断**：
  - 这不是架构判断错误，而是 **DoD / exit wording 过满**。
- **建议修法**：
  - 把硬闸第 2 条改成：
    - **“4 个 worker 的 runtime ownership 已吸收到 `workers/*/src/`，不再以 `packages/*` 作为主要运行归属；各自的 entrypoint 形状服从其已选 posture（host-local / remoteized）。”**
  - 这样能保住 4-worker ownership，又不强迫 `context/filesystem` 过早 remoteize。

---

## 3. In-Scope 逐项审核

> 本节结论使用：`covered | partial | missing`，表示 **该计划项在 charter 中是否被充分定义并可执行**。

| 编号 | 计划项 | 审查结论 | 说明 |
|---|---|---|---|
| I1 | A1-A5 absorption (`agent.core`) | `covered` | worker 身份、吸收范围、关键锚点、P1/P2 顺序都明确。见 `docs/plan-worker-matrix.md:153,188-229,358-359,374-379` |
| I2 | B1 absorption (`bash.core`) | `covered` | B1 是完整 first-wave 单元，治理边界与 remote seam 都写清楚。见 `docs/plan-worker-matrix.md:154,231-271,375` |
| I3 | `createDefaultCompositionFactory()` 升级 | `covered` | 当前缺口、Phase、DoD、目标状态都明确。见 `docs/plan-worker-matrix.md:155,406-408` |
| I4 | `makeRemoteBindingsFactory()` 补全 | `covered` | 目标和处理方式明确，但与 first-wave remote posture 的边界也写了保留。见 `docs/plan-worker-matrix.md:156,408,511` |
| I5 | `initial_context` host consumer 接线 | `partial` | 实现路径明确，但 dedicated root e2e 未写成硬闸。见 `docs/plan-worker-matrix.md:157,376-379,409` |
| I6 | `agent.core ↔ bash.core` `tool.call.*` live | `partial` | 主链定义清楚，但 `bash-core` real preview deploy 前置依赖未写进 phase/DoD。见 `docs/plan-worker-matrix.md:158,380-381,410-413,510` |
| I7 | C1 + C2 absorption (`context.core`) | `covered` | 薄做边界、API 归属、helper split 都明确。见 `docs/plan-worker-matrix.md:159,273-311,382-385,417-421` |
| I8 | `context.core` compact posture 决策 | `covered` | 候选、建议、DoD 都明确。见 `docs/plan-worker-matrix.md:160,419,459-465` |
| I9 | D1 + D2 absorption (`filesystem.core`) | `covered` | 吸收对象、workspace law、remote posture边界都明确。见 `docs/plan-worker-matrix.md:161,312-347,385-387,425-429` |
| I10 | `filesystem.core` connected-mode / remote posture 决策 | `covered` | 选项和 first-wave stance 都明确。见 `docs/plan-worker-matrix.md:162,339,467-473` |
| I11 | `workspace:* → @haimang/*` cutover milestone | `partial` | P5 有安排，但 trigger 建议当前偏早且偏日历化。见 `docs/plan-worker-matrix.md:163,388,433,475-481` |
| I12 | 吸收后的 Tier B packages 打 `DEPRECATED` | `covered` | P5 范围与非物理删除边界明确。见 `docs/plan-worker-matrix.md:164,176,389,434-435` |
| I13 | W3 pattern placeholders 回填 | `covered` | 已绑定首批 absorb PR / closure。见 `docs/plan-worker-matrix.md:165,389,402,529` |
| I14 | 其余 3 workers 升级到 real preview deploy | `partial` | bash 在 P2 实际需要；context/filesystem 又允许 defer，当前表述略混。见 `docs/plan-worker-matrix.md:166,420,428,530` |
| I15 | worker-matrix final closure + handoff | `covered` | P5 明确要求且进入硬闸。见 `docs/plan-worker-matrix.md:167,390,436-437,525` |

### 3.1 对齐结论

- **covered**：`10`
- **partial**：`5`
- **missing**：`0`

**总结**：这不是一份空泛 charter，也不是“看起来很大但无法开工”的 wish list。它已经足够支持执行，但仍需要把 3 条关键执行/验证依赖说得更硬、更准。**

---

## 4. 它是否足以支持 `4-worker` 基本架构与基本功能验证？

### 4.1 对“4-worker 基本架构”的判断

**可以。**

原因是这份计划已经把 4-worker 基本架构拆成了 4 种不同的 first-wave reality，而不是假设 4 个 worker 都要同时变成对称 remote service：

| worker | 计划中的 first-wave 架构判断 | 审查判断 |
|---|---|---|
| `agent.core` | host worker + live turn loop owner | `成立` |
| `bash.core` | first-wave 唯一必须 battle-test 的 remote execution seam | `成立` |
| `context.core` | thin context substrate，首波可 host-local | `成立` |
| `filesystem.core` | typed workspace/storage substrate，首波可 host-local | `成立` |

这与当前刷新后的 eval tree 完全一致：`agent↔bash` 是唯一明确必须打通的 remote loop，`context/filesystem` 首波主要是 ownership absorption 与 posture decision。见 `docs/eval/worker-matrix/cross-worker-interaction-matrix.md:49-109`、`docs/eval/worker-matrix/worker-readiness-stratification.md:69-95`。

### 4.2 对“基本功能验证”的判断

**基本上可以，但还差两条验证补强。**

当前计划已经明确要求验证：

1. live agent turn loop 端到端运行：`session.start → tool.call → bash-core → response → stream`。见 `docs/plan-worker-matrix.md:520-525`。
2. `createDefaultCompositionFactory()` 不再空袋。见 `docs/plan-worker-matrix.md:406-408`。
3. `initial_context` consumer 接线存在。见 `docs/plan-worker-matrix.md:409`。
4. workspace/storage truth 在 `filesystem.core` first-wave 中继续单一，不 fork。见 `docs/plan-worker-matrix.md:427-429`。

但若要把“基本功能验证”讲得完整，还应再补：

1. **`initial_context` dedicated root e2e**
2. **`bash-core` real preview deploy 作为 P2 显式前置**

所以我的判断是：

> **这份计划足以支持“4-worker 基本架构 + 基本功能验证”，但前提是先把 R1 / R2 / R3 这 3 处表述补硬。**

---

## 5. 对 Opus 提出的 7 个问题的回答

### 5.1 Q1 — absorption 首批 PR 粒度

- **问题背景**：
  - 计划当前候选是 `(a) 每个 unit 一个 PR / (b) 每 worker 一组 PR / (c) 按 sub-phase 序列 PR`。见 `docs/plan-worker-matrix.md:443-450`。
  - 但 P1 的真实结构不是 10 个完全独立的模块，而是 **A1-A5 高耦合 + B1 相对独立**。见 `docs/plan-worker-matrix.md:358-359,374-375`。
- **推荐回答**：**选 `(c)`，按 sub-phase / worker 组推进，不建议纯 `(a)`。**
- **推荐理由**：
  1. `A1-A5` 之间天然耦合，拆成 5 个完全独立 PR 会带来大量中间态噪音。
  2. `B1` 本身是一个完整、边界清晰的单元，适合独立 PR。
  3. 对 first-wave 来说，**“每个 worker/每个子阶段可验证”** 比 **“每个吸收单元都各开一个 PR”** 更重要。
- **建议落地**：
  - `P1.A = agent-core absorption PR sequence`
  - `P1.B = bash-core absorption PR`
  - 如果必须更细，再把 `P1.A` 内部分成 2-3 个 PR，而不是 5 个 unit PR。

### 5.2 Q2 — `tool.call.*` default transport 选择

- **问题背景**：
  - 计划当前建议 `(a) 默认走 `CAPABILITY_WORKER` service-binding`。见 `docs/plan-worker-matrix.md:451-457`。
  - 刷新后的交互矩阵明确：`agent.core ↔ bash.core` 是 first-wave 唯一必须真实 battle-test 的 remote loop。见 `docs/eval/worker-matrix/cross-worker-interaction-matrix.md:49-60,95-103`。
- **推荐回答**：**接受 `(a)`，默认走 `CAPABILITY_WORKER` service-binding；但保留 `local-ts` 作为显式 fallback / test seam，而不是把它删掉。**
- **推荐理由**：
  1. 如果 first-wave 不默认走远端，那 worker-matrix 就没有真正验证最关键的 cross-worker loop。
  2. 但 `local-ts` 仍有价值：单测、故障回退、preview 之外的开发路径都需要它。
  3. 所以最好的表述不是 “只剩远端”，而是 **“远端是默认真相，本地是显式 fallback”**。

### 5.3 Q3 — 默认 compact posture

- **问题背景**：
  - 计划当前建议 `(c) compact 保持 opt-in, 首波不自动装`。见 `docs/plan-worker-matrix.md:459-465`。
  - `context.core` 的刷新真相也强调：first-wave 是 thin substrate，不是厚 context engine。见 `docs/plan-worker-matrix.md:275-303`、`docs/eval/worker-matrix/context-core/index.md:100-110`。
- **推荐回答**：**接受 `(c)`。**
- **推荐理由**：
  1. compact 不是 first-wave 唯一关键闭环；`agent↔bash` 才是。
  2. 把 compact 保持 opt-in，能让 `context.core` 的吸收范围维持在 “assembly + boundary + evidence + API ownership”。
  3. 这最符合 conservative-first，也最不容易把 `context.core` 拉成厚引擎。

### 5.4 Q4 — filesystem first-wave remote posture

- **问题背景**：
  - 计划当前建议 `(a) host-local 继续`。见 `docs/plan-worker-matrix.md:467-473`。
  - 刷新后的 `filesystem.core` / interaction matrix / readiness docs 都明确：first-wave 不需要为了“对称”去发明完整 remote filesystem RPC。见 `docs/eval/worker-matrix/filesystem-core/index.md:69-110`、`docs/eval/worker-matrix/cross-worker-interaction-matrix.md:72-109`。
- **推荐回答**：**接受 `(a)`。**
- **推荐理由**：
  1. 这条路线最符合当前 workspace truth 单一源的要求。
  2. 它允许先完成 D1+D2 absorption 与 connected-mode 决策，而不引入不必要的 RPC。
  3. 这也是把 `filesystem.core` 当成 typed substrate，而不是 full FS service 的正确写法。

### 5.5 Q5 — `workspace:*` → published cutover trigger

- **问题背景**：
  - 计划当前建议 `(a) 首批 absorb 稳定 1 周后`。见 `docs/plan-worker-matrix.md:475-481`。
  - 但这个触发器偏日历化，而且 “首批 absorb” 对 4-worker 全局 closure 来说过早。
- **推荐回答**：**不建议接受当前 `(a)`；推荐选 `(c) 独立 release PR schedule`。**
- **推荐理由**：
  1. published-path cutover 是 **closure / release hygiene**，不是 first-wave 架构证明的一部分。
  2. 它应该绑定在一个显式 release checklist 上，而不是 “稳定 1 周” 这种模糊时间条件上。
  3. 这样能避免 `workspace:*` interim 漂成 permanent，也避免过早 cutover 把 P2/P3/P4 的验证噪音带进包版本管理。
- **建议落地**：
  - 把 cutover 触发器写成：**“P2/P3/P4 DoD 全绿后，开独立 P5 release PR 执行 published-path cutover。”**

### 5.6 Q6 — Tier B deprecation banner 时机

- **问题背景**：
  - 计划当前建议 `(c) 逐 worker 逐个打 deprecated`。见 `docs/plan-worker-matrix.md:483-489`。
  - 这与当前 absorption / 共存期 / 后续物理删除分阶段的思路一致。
- **推荐回答**：**接受 `(c)`。**
- **推荐理由**：
  1. 这是最诚实的做法：哪个 worker 先稳定，哪个相关 package 先贴 banner。
  2. 它避免两种坏情况：过早贴 deprecated 误伤现有消费者，或等到最后统一贴导致“吸收已完成但 repo 口径仍旧”。
  3. 也最方便把 deprecation 与对应 absorb PR / CHANGELOG 绑定。

### 5.7 Q7 — `skill.core` 是否在 worker-matrix 内被 admit

- **问题背景**：
  - 计划当前建议是 **否**。见 `docs/plan-worker-matrix.md:491-496`。
  - 刷新后的 `skill-core-deferral-rationale.md` 已经把理由说得很清楚：有 protocol reservation，但没有 substrate、没有 shell、没有 W3 absorption unit，也没有 first-wave 产品压力。见 `docs/eval/worker-matrix/skill-core-deferral-rationale.md:32-119`。
- **推荐回答**：**接受当前建议：`skill.core` 在本阶段继续 `reserved + deferred`。**
- **推荐理由**：
  1. admit `skill.core` 会把 4-worker charter 变成 5-worker charter。
  2. 它没有当前 substrate 可吸收，等于把 greenfield invention 混进 assembly phase。
  3. 这会直接破坏整个计划的 conservative-first 边界。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：`approve-with-followups`
- **是否允许把它作为 worker-matrix 执行 charter 使用**：`yes`

### 6.1 为什么我给 `yes`

因为这份计划已经满足了 3 个最重要的条件：

1. **定义正确**：worker-matrix 被正确写成 assembly + absorption over frozen shells。
2. **scope 足够**：4-worker 基本架构所需的吸收、装配、姿态决策、cutover、closure 都已进入 In-Scope。
3. **核心验证链存在**：live turn loop、binding activation、`initial_context` consumer、workspace truth、preview deploy / dry-run / root tests 都已经进入 DoD / Exit Criteria。

### 6.2 开工前最值得先补的 3 条 follow-up

1. **把 `bash-core real preview deploy` 提升为 P2 的显式前置条件 / DoD 条目**
2. **在 P2 DoD 里补一条 `initial_context` dedicated root e2e**
3. **把“4 workers 全部非 version-probe”改写成“4 workers 的 runtime ownership 已吸收到 `workers/*/src/`，entrypoint 形状服从各自 posture”**

### 6.3 最终一句话判断

> **这份 Opus 重写后的 `plan-worker-matrix.md` 已经足以支撑 4-worker 的基本架构与基本功能验证；它当前的问题不是方向错，而是有 3 处执行/验证口径还需要补硬，避免把 first-wave 的薄做姿态误写成过早 remoteize 或隐含依赖。**
