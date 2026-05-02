# Pro-to-Product Re-Planning(基于 GPT + Kimi 双审的综合修订)

> **文档性质**: `eval / re-planning`(对 `initial-planning-by-opus.md` 的修订;综合采纳 GPT + Kimi 两份独立 review 的关键意见)
> **作者**: Claude Opus 4.7(1M context)
> **日期**: 2026-05-02
> **直接输入**:
> - `docs/eval/pro-to-product/initial-planning-by-opus.md`(本文件的被修订对象)
> - `docs/eval/pro-to-product/initial-planning-reviewed-by-GPT.md`(GPT 的复核意见,§3 / §5 / §6 给出 phase 重排建议)
> - `docs/eval/pro-to-product/initial-planning-reviewed-by-kimi.md`(Kimi 的独立审查,§2 揭示 HPX7 自指矛盾,§4 / §6 / §8 / §9 提出 4 项 initial 草案缺失维度)
> - `docs/charter/plan-hero-to-pro.md`(基石)
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`(`partial-close/7-retained` 真实状态)
> - `docs/issue/hero-to-pro/HPX6-closure.md`(`executed-with-followups` 状态 + 4 项 followup)
> - 9 份 `docs/eval/hero-to-pro/core-gap/` 报告
>
> **本文档不冻结任何决策**;它的目的是把 GPT + Kimi 双审带来的修订意见交叉合成,产出比 initial 草案**更诚实、更可执行**的 pro-to-product 阶段结构 + 配套 design docs 蓝图,供 owner 用作 PP0 charter 撰写前的最终参照。
>
> **修订历史**:
> - `2026-05-02 v1.draft — 首版,基于 initial-planning v0.draft + GPT + Kimi 双审`

---

## 0. 这份文档要解决的 5 个新问题

owner 在双审完成后追加的具体诉求:

1. **直接回答**:GPT 与 Kimi 都对 **HPX7 scope** 与 **PP1 scope** 提出疑问 — 这两条具体疑问是什么、谁的更准、我的最终立场。
2. **交叉判断**:两份 review 中除了上述两点之外的论点,**哪些有据,哪些价值高,哪些可以不采纳**。
3. **重排 HPX7**:基于双审的修正意见,HPX7 最终装什么、规模多大。
4. **重排 pro-to-product 阶段结构**:6 个闭环 / 5 个 phase / DAG 是否调整。
5. **新增**:pro-to-product 阶段需要多少份 design doc、分别是哪些文件、覆盖哪些方面、它们如何共同完成阶段的方向 / 技术指导 / 落地规划。

本文档逐条回答,每个回答都带**采纳 / 不采纳 / 部分采纳**的明确表态 + 理由。

---

## 1. 双审最关键的两个共同质疑(直接回答)

### 1.1 关于 HPX7 scope — Kimi 揭示了一个我之前没看到的**自指矛盾**

**Kimi §2.1 的核心质疑**(原话):

> 8 项候选中,**至少 3 项违反标准 1 或 3**……**更严重的问题**:HPX7-A(replay buffer 恢复)被 Opus 自己归类为 connection 维度的 P0 断点(§1.1 Connection 第 2 条),但又在 HPX7 中试图收编。**如果 HPX7-A 真的只是"单文件改动",那它就不应该是 9 份报告共同指认的 P0;如果它是 P0,那它就不满足 HPX7 的浅修补标准。**这是一个自相矛盾。

**我的判断**:**Kimi 完全正确,这是 initial 草案的核心错误**。我在 §3.1 制定了 4 条入选标准(浅修补 / 与 4 套状态机紧耦合 / 不引新跨 worker 接线 / 升级 closure 判定),然后在 §3.2 的 8 项中**实际上违反了我自己制定的标准**:

- **HPX7-A(replay buffer 恢复)**:Kimi 指出真实改动跨 `replay.ts`(packages 协议层) + `session-do-persistence.ts`(agent-core DO 层) + `user-do/ws-runtime.ts`(orchestrator-core façade 层)。**确实是三层联动**,违反"浅修补"标准。我之前归到 HPX7 是因为单看任一文件改动不大,但忽略了**三层协调**才是真实成本。
- **HPX7-D(reasoning content_type 区分)**:Kimi 指出涉及 `session-stream-adapter.ts`(agent-core) + `stream-event.ts`(packages) + `clients/api-docs/session-ws-v1.md`(docs)+ provider 返回格式解析。**跨 worker + provider 依赖**,违反标准 3。
- **HPX7-F(check-docs-consistency 新 regex)**:Kimi 指出这是 drift guard 增量,**不与 4 套状态机耦合**。这条单独看是好工作,但放进 HPX7 是范围错配。

**GPT 在 §4 也对 HPX7 的部分项目持类似保留态度**(对 HPX7-B 说"应在落项前再用当前代码复核一次",对 HPX7-H 说"更像 hygiene/race hardening,不是阶段命题核心")— 但 GPT 没有像 Kimi 这样把它升级为"自指矛盾"的体系性问题。

**采纳决议**:**完全采纳 Kimi 的 §2.1 判断**。HPX7 必须重新设计,见 §6。

### 1.2 关于 PP1 scope — GPT 与 Kimi **独立得到同一结论**

GPT §3.1(原话):

> PP1 不应该同时吞下全部 C1+C2,而应显式拆成两段执行面 [...] 把它们在 charter 中硬捆成一个 phase 可以,但在 action-plan 层最好至少拆成 PP1A / PP1B 两条执行线,**否则 compact 这条最大的技术风险会拖住 ask-path 这条最直观的产品 blocker**。

Kimi §4.3(原话):

> **PP1 的复杂度被系统性低估** [...] **降低单点阻塞**:如果 PP1 把 C1 和 C2 捆在一起,一旦 compact 真实装卡壳(高概率),ask pause-resume 也会被拖后,进而阻塞 PP2/PP3/PP4 全部。

两位 reviewer **独立得出完全一致的结论**:PP1 必须拆。这是 initial 草案最严重的工程组织错误。

**理由再交叉一次**:
- **C1(HITL interrupt)** 改动中心:`runtime-mainline.ts authorizeToolPlan` + `kernel scheduler interrupt` + `session-do-runtime.ts emitPermissionRequestAndAwait` + `OrchestrationState confirmation_pending phase`
- **C2(Context budget)** 改动中心:`request-builder.ts token estimation` + `context-core 真 summary 生成` + `agent-core reducer 真截消息` + `compact-breaker circuit policy`
- 两者**都涉及 interrupt**,但 C1 的 interrupt 是 user-driven(等待 confirmation 决策),C2 的 interrupt 是 quota-driven(等待 compact 完成);两套 interrupt 共享 scheduler 改动**但触发条件、恢复路径、timeout 语义都不同**。
- 工期估算:initial 草案给 PP1 估 14-21 天,Kimi 反例 hero-to-pro HP5(仅统一 confirmation HTTP plane 就用了一整个 phase,而 pause-resume 比 plane 复杂 2-3 倍),**14-21 天连 C1 单独都未必够**。

**采纳决议**:**完全采纳 GPT + Kimi 的 PP1 拆分建议**。新结构见 §7。

---

## 2. 双审两点共识之外的其他论点 — 逐条判断

下面把双审两位 reviewer 提出的所有其他论点(HPX7 scope + PP1 split 之外)汇总,逐条给出我的最终立场。

### 2.1 GPT 的其他论点

| 论点 | 我的判断 | 理由 |
|---|---|---|
| **§3.2 Hook 闭环不应从"全目录接通"起步,而应先做最小 live loop**(PreToolUse 真走 dispatcher + 1 个 register source + 最小前端可见性 → 然后才扩 HookStarted/HookCompleted) | **完全采纳** | initial 草案 §4.2 把 C5 写成"14 emit + 新 frame + UI 状态条 + register 路径 + hook handler"是典型 surface-first 错误。GPT 指出的真实代码事实(`PreToolUse` 不走 dispatcher 而走 `authorizeToolUse` RPC)是更基础的一层 — 没修这条,扩 14 emit 是空忙活。**新结构 PP4 重写为"Hook delivery closure(minimal live loop first)"**,见 §7 |
| **§3.3 Reconnect phase 第一优先级应是 restore path,而不是先追求协议重写**(top-level frame buffer 留 PP3 后半或 PP5 follow-up) | **完全采纳** | initial 草案 §5.1 把 PP3 写成"replay restore + status snapshot + outbound dedup + detached TTL + top-level frame buffer + actor snapshot push + cookbook 重写"7 项一锅烩。GPT 指出最先该修的是 restore path(`restoreFromStorage` 不读 helper checkpoint)+ replay graceful degrade(throw → lagged contract)+ detached TTL — 这 3 条是真硬断点,其他可以二阶段做。**新 PP3 结构按 GPT 顺序拆成 PP3a / PP3b**,见 §7 |
| **§3.4 Policy 与 Reliability 不适合完全并批**(`/runtime` honesty 应早做,不等 retry/fallback 全套) | **部分采纳 — 在同 phase 内分先后,不拆 phase** | GPT 论点有据(policy honesty 是 docs-already-public-but-not-enforced 的最严重一条 — 前端被误导成本高)。但拆成 2 个 phase 边际收益低 — 两者都不在串行关键路径上,可以同 phase 不同 sub-task。**新 PP5 内部:先做 policy honesty(降格或 enforce 二选一),再做 reliability(fallback metadata + retry)**,见 §7 |
| **§3.5 D1 freeze 应是默认原则 + 严格受控例外,不写成硬禁令** | **完全采纳** | GPT 反例非常具体(reconnect 的 idempotency / replay bookkeeping 字段可能需要极小 D1 表)。我的 initial 草案 §7.3 风险 4 写"pro-to-product **不**新加 D1 migration"是教条;实际 hero-to-pro charter §4.4 R8 也只是"默认严禁 + 受控例外"。**新 PP0 charter 显式写出例外条件**,见 §7.6 |
| **§4 HPX7 项目逐项判断**(HPX7-A 强烈支持 / C/D/E/F/G 支持 / B 需复核 / H 不应是主价值) | **部分采纳 — 与 Kimi 的更激进版本合并裁决** | GPT 的逐项判断仍把 HPX7-A/D 留下,但 Kimi 的自指矛盾论证(§1.1)更强,我接受 Kimi 的判决:HPX7-A/D 都不在 HPX7 内 |
| **§5 PP0-PP6 7-phase 重排**(PP0 charter / PP1 HITL / PP2 Context / PP3 Reconnect / PP4 Hook / PP5 Reliability+Policy / PP6 Final) | **基本采纳,顺序微调** | GPT 把 PP3 Reconnect 放在 PP2 之后、PP4 Hook 之前,理由是"reconnect 是 product trust 比 hook 更靠基础"。我同意 — reconnect 不修则前端刷新页面就崩,hook 不修前端 hook 体验只是"看不到 backend 状态变化"。**采纳 GPT 的 PP3 优先于 PP4 顺序**,见 §7 |
| **§6 6 条硬闸**(HITL truth / Context truth / Reconnect truth / Session state truth / Policy truth / Hook truth) | **完全采纳** | 这 6 条 truth 比我 initial §4.2 的 6 个闭环更可操作 — 它们直接是"closure gate"而非"承担工作"。**新 PP0 charter 把这 6 条作为 Primary Exit Criteria 硬闸**,见 §7.6 |

### 2.2 Kimi 的其他论点

| 论点 | 我的判断 | 理由 |
|---|---|---|
| **§1.2 in-scope 判定标准 4 条**(已有 schema 但 0 caller / 前端 user journey 可感知 / 不引新 NACP message_type / 不引新 D1 migration) | **完全采纳** | 这 4 条把 6 闭环从"抽象概念"转化为"逐条可判定"的 operational rule;直接解决 initial 草案的 §1.1 标准模糊问题。**新 PP0 charter 把这 4 条写进 §4 全局 In-Scope/Out-of-Scope 判定表**,见 §7.6 |
| **§3.2-3.3 用户感知度三级矩阵**(must-have 直接感知 / should-have 间接感知 / nice-have backend 内部) | **完全采纳** | 解决 C3/C4 边界模糊问题(loop detection 这类 backend-only 工作不应吃 P0 预算)。**新 PP0 charter 增 §4.7 用户感知度矩阵**,作为 phase 内部 task 排序依据,见 §7.6 |
| **§4.2 PP1 隐藏成本 5 步分析**(scheduler interrupt 改造 / OrchestrationState 改造 / ws-runtime 路由 / race 处理 / e2e 验证) | **完全采纳并扩展** | Kimi 把 PP1 的 5 步隐藏成本写得很具体,这是 initial 草案 §7.2 估算最薄弱处。**新 PP1 估算上调为 PP1a 18-25 天 + PP1b 14-21 天**,见 §8 |
| **§5.2 工作量估算纪律 4 条**(基础估算 ×1.5 / e2e 单独列项 / 20% regression buffer / 30% 超期触发 scope-cut) | **完全采纳** | 这是工程纪律,不是技术决策,几乎没有反对理由。**新 PP0 charter §5 方法论增第 8 条**,见 §7.6 |
| **§6 Debt Acknowledgement Gate(13 项)** — HPX6 closure 4 项 followup + HPX6 review 9 项发现 + hero-to-pro 7-retained | **完全采纳** | 这条是 Kimi 最有价值的发现之一 — initial 草案把"hero-to-pro full close 或 close-with-known-issues"当作入口条件,但实际 hero-to-pro 是 `partial-close/7-retained` + `HPX6 executed-with-followups` + `9 项 review findings`,这些都是**隐性 debt**。**新 PP0 增 Gate D1: Hero-to-Pro Debt Clearance**,见 §7.6 |
| **§6 HPX6 review R1 / R2(item projection 残缺 / runtime config 无乐观锁)应进入 HPX7** | **完全采纳** | 这是我之前没看到的 HPX6 follow-through 工作;放 HPX7 更合理(它们与 4 套状态机耦合)。**HPX7 重新加入 R1 / R2 各 1 项**,见 §6 |
| **§7.3 1-engineer 场景按层固化策略**(kernel → connection → wrapper) | **完全采纳** | initial 草案 §6.4 写"严格串行" — Kimi 指出这忽略了上下文切换成本(每次 ~3-5 天 reload time);"层固化"思路把同一技术栈的工作连续做完,降低 cognitive load。**新 PP0 charter §6 给出 2 种工程组织模型**,见 §7.6 |
| **§8 Top-3 Risk Contingency Contract**(compact 不可行 / scheduler interrupt regression / Hook 与 permission_rules 冲突) | **完全采纳** | initial 草案 §7.3 风险列表只是方向性描述,Kimi 把它升级为"如果发生 X,则做 Y"的可操作 fallback。**新 PP0 charter §10 Contingency Contract 详细列出**,见 §7.6 |
| **§9.1 前端介入节奏**(PP0 / PP1a 中期 / PP2 启动 / PP3 启动 / PP4 中期 / PP5 全程) | **完全采纳** | initial 草案全程从 backend 视角写,完全忽略前端;Kimi 指出"如果前端 PP5 才介入会发现 PP1-PP4 设计不符合实际消费方式"。**新 PP0 charter 增 §13 Frontend Engagement Schedule**,见 §7.6 |
| **§9.2 性能基准 4 阈值**(confirmation interrupt ≤500ms / compact ≤3s / reconnect 重放 ≤2s / retry 首响 ≤1s) | **完全采纳** | 是 6 闭环的"frontend 不卡"可观测验收标准;不是 SLA(那是 platform 阶段的事)。**新 PP0 charter 增 §14 Observability Baseline**,见 §7.6 |
| **§9.3 hero-to-pro 7-retained 非阻塞声明** | **完全采纳** | 防止"retained 拖到 pro-to-product 结束还没解决"的最坏路径。**新 PP0 charter §11 增 Gate D2: Retained Non-Block Verification**,见 §7.6 |
| **§5.1 工作量上调 30-50%**(单工程师 90-120 天) | **采纳但保守一些** | Kimi 的反推 reasoning(e2e 60 天 / docs 6-9 天 / regression 20-30%)有理。但我的 initial 60-90 天估算不算太错(假设是中位数 75 天 + 30% buffer ≈ 100 天,落在 Kimi 区间);保留区间式估算 80-110 天 + 显式 buffer,见 §8 |

### 2.3 双审的体系性盲区(双审都没提到)

我自审了一遍,以下 4 项 initial 草案的内容**双审都没有质疑也没有强化**,我自己评估其状态:

| 主题 | initial 草案立场 | 双审态度 | 我的最终立场 |
|---|---|---|---|
| **6 个闭环 C1-C6 的命名是否最终** | C1-C6 既定 | GPT/Kimi 都接受;Kimi §3.1 显式称"覆盖了 9 份报告的 P0 共识" | **保留 C1-C6 命名,作为 charter §3 一句话产出的核心** |
| **`pro-to-product` 命名是否最终** | initial §9 Q6 标"待 owner 决断" | 双审都用了这个名,未质疑 | **保留命名,等 owner Q6 决断** |
| **PP6 Final closure 输出 `plan-platform-foundations.md` stub** | initial §8.3 提议 | GPT 默认 / Kimi 显式确认 | **保留** |
| **9 份 core-gap 报告的 deferral 矩阵归一应在 PP0 内做** | initial §5.1 PP0 In-Scope | 双审都没反对;Kimi §6 通过 debt gate 补强 | **PP0 必交付物之一** |

---

## 3. 双审都漏掉的两个维度(我自己补)

经过对双审 + initial 草案的交叉审视,我识别出**两个关键维度双审都没覆盖**:

### 3.1 Charter §16 HPX1-HPX6 回填段对 pro-to-product 入口的隐含约束

`docs/charter/plan-hero-to-pro.md` §16.4 已经把 hero-to-pro 的"实际完成面"重新定义为:

> 在不打破 6-worker 基石的前提下,把 nano-agent 从"成熟 LLM wrapper 控制平面"继续推到"具备 workbench-grade controls、对象层与 reconnect/reconcile 友好面的 agent loop backend"。

这意味着 hero-to-pro 的真实终态**已经远超原 charter §3 一句话目标**;pro-to-product 的命题不是"补 hero-to-pro 没做完的事",而是"把 hero-to-pro **超额完成** 的 substrate 真接通到 live caller"。这与 initial 草案的判断一致,但 **双审都没显式提到 §16.4 这条新基线** — 它影响 PP0 的入口条件描述方式:不应再说"hero-to-pro 4 套状态机闭环",应说"hero-to-pro workbench-grade backend substrate 已就绪"。

### 3.2 Charter §10.4 收口类型判定表对 pro-to-product 的承袭

hero-to-pro charter §10.4 定义了 3 种收口类型(`full close` / `close-with-known-issues` / `cannot close`)。pro-to-product 也应该承袭这个三选一框架,且**应明文写出 NOT-成功识别清单**(类比 hero-to-pro §10.3)。**这是 charter 类文档的体例约束,initial 草案漏写**。新 PP0 charter §10 必须包含。

---

## 4. 综合判断:initial 草案需要多少修正

把 §1-§3 全部综合,initial 草案的修正度量:

| 维度 | initial 草案 | 双审修订后 | 修正度 |
|---|---|---|---|
| 命题方向 | hero-to-platform → pro-to-product | 保持 | **0%** |
| 6 闭环命名 | C1-C6 | 保持 | **0%** |
| Phase 数量 | 6(PP0-PP5) | 7(PP0-PP6) | **+1 phase** |
| HPX7 项数 | 8 项 / 7-12 天 | 6 项 / 3-5 天 | **-25% 项数 / -60% 工期** |
| PP1 是否拆 | 单 phase | 拆 PP1a + PP1b | **结构变化** |
| PP3 优先级 | 在 PP4 之后 | 在 PP4 之前(GPT 重排) | **顺序变化** |
| 工作量估算 | 60-90 天单 / 35-50 天三人 | 80-110 天单 / 50-70 天三人 | **+25% 上调** |
| Gate 数量 | 0 显式 gate | 6 个(D1 debt / D2 retained / 6 truth)| **新增 6 gate** |
| 用户感知度矩阵 | 无 | must/should/nice 三级 | **新增** |
| 前端介入节奏 | 无 | 6 时点 schedule | **新增** |
| 性能基准 | 无 | 4 个 latency 阈值 | **新增** |
| Contingency contract | 无 | Top-3 risk fallback | **新增** |

**综合判断**:initial 草案的**方向是对的**(命题转换 / 6 闭环框架 / 闭环识别 / DAG 思路),但**执行层面需要明显修订**(HPX7 范围、PP1 拆分、新增 6 类 governance 维度)。**等于:战略保留,战术重写**。

---

## 5. 双审带来的"元元结论"

把 GPT + Kimi 两份 review 拉到一起读,我看到一个**比 9 份 core-gap 报告更深一层**的元结论:

> **nano-agent 的工程问题不在"做了多少",而在"宣称完成的多少 不等于 实际接通的多少"** — F12/F13 是这条规律在 hero-to-pro 阶段的具体显形,7-retained / executed-with-followups / 14/18 hook 不 emit / `tokensFreed:0` 是它在 HPX5/HPX6 的延续。**pro-to-product 阶段的核心治理目标,不只是"补完 6 闭环",而是"建立一种不让此规律继续延伸的 closure 纪律"**。

这条元元结论直接驱动两件事:

1. **PP6 Final closure 不应只做"残骸 cleanup",还要 codify 出一份 "honesty-driven closure 准则"**,作为 platform-foundations 阶段的入口约束。
2. **每个 phase 的 closure 标准从"功能 live"改为"前端可信"** — 这正是 GPT §6 的 6 条 truth gate 的本质。

我把这条元元结论写进新 PP0 charter §3 一句话目标,见 §7.6。

---

## 6. 重排后的 HPX7

### 6.1 新 HPX7 入选标准(更严格,避免再自指)

| 标准 | 含义 | 与 initial 4 条的差异 |
|---|---|---|
| **S1 — 单工程师 1 天内完整 deliver(含 e2e 与 review)** | 用工期上限替代"浅修补"的模糊词 | 比 initial 标准 1 更可操作 |
| **S2 — 不跨 worker** | 不 cross `agent-core / orchestrator-core / packages` 任意 2 个 | 与 initial 标准 3 一致,严格化 |
| **S3 — 不引入新协议帧 / 新 D1 migration / 新 NACP message_type** | 严格继承 hero-to-pro DDL freeze | initial 标准 4 隐含,这里显式化 |
| **S4 — 满足以下任一**:消除 deceptive closure 表述 / 修复 schema-live producer-not-live 漂移 / 修复 race / 让 final closure 升级 | 替代 initial 标准 2(与 4 状态机紧耦合)— 因为 §16.4 重定位后,4 状态机已不是 hero-to-pro 唯一锚点 | 标准更广义但更可判 |

### 6.2 新 HPX7 项目清单

按新 4 条标准筛后,**6 项进入 HPX7**(initial 8 项中 4 项保留 / 1 项升级 / 3 项删除;同时从 Kimi §6 的 HPX6 review findings 中新增 2 项):

| ID | 工作项 | 入选理由 | 工期 | 来源 |
|---|---|---|---|---|
| **HPX7-1** | **`docs/issue/hero-to-pro/HP5-closure.md` 重新表态**:F12 hook dispatcher 状态从"closed"诚实降级为"dispatcher instance injected, live caller deferred to pro-to-product PP4" | 满足 S1 / S2 / S3 / S4(消除 deceptive closure)| 0.5 天 | initial HPX7-G + Kimi 合并 |
| **HPX7-2** | **`reducer.ts:llm_response` token 双重累加修复**(区分 `cumulativeTokens` vs `currentPromptTokens`)+ 配套 unit test | 单文件 + 不跨 worker + 修复 bug 性 race(compact signal 误触发);PP2 启动前必修 | 0.5-1 天 | initial HPX7-B,GPT 建议复核完成 |
| **HPX7-3** | **`runtime-mainline.ts:520` `abort()` 空实现填充**:capability transport 已有 cancel 接口,接通 → emit `tool.call.cancelled` | 单文件 + schema-live producer-not-live | 0.5 天 | initial HPX7-C |
| **HPX7-4** | **`session-do-runtime.ts:679` 空 catch block 修复**:把 race 默默吞掉改为 emit `system.error` 或走真 detach-then-attach | 单文件 + race hardening | 0.5 天 | initial HPX7-H + GPT/Kimi 都接受 |
| **HPX7-5(新)** | **`item-projection-plane.ts` 残缺补全**:HPX6 review R1 — error 无投影、read 仅支持 tool_call;补完 7 类全覆盖,否则 PP4 hook delivery 的 e2e 会撞 item projection 缺口 | 单文件 + 与 4 状态机耦合 + 让 PP4 e2e 可写 | 1 天 | Kimi §6 新建议 |
| **HPX7-6(新)** | **`runtime-config-plane.ts` 加乐观锁(If-Match ETag)**:HPX6 review R2 — `/runtime` PATCH 当前无并发保护;不修则 PP5 policy 测试会 flaky | 单文件 + 满足 S1-S4 | 0.5 天 | Kimi §6 新建议 |

**HPX7 总规模**:6 项 × 0.5-1 天 = **3.5-4.5 工作日**(单工程师)

### 6.3 明确不进入 HPX7 的项目(全部下放 pro-to-product)

| 项目 | 移交去向 | 理由 |
|---|---|---|
| **HPX7-A(replay buffer 三层联动)** | pro-to-product PP3a 入口任务 | 三层联动违反 S2;Kimi §2.1 自指矛盾揭示 |
| **HPX7-D(reasoning content_type 区分)** | pro-to-product PP6 observability layer | 跨 worker + provider 依赖违反 S2 |
| **HPX7-E(`confirmations.md` + `session-ws-v1.md` docs drift 修订)** | pro-to-product PP0 内一次性收口 | docs drift 应在 charter freeze 前一次性扫,不在 hero-to-pro 尾端打补丁(GPT/Kimi 双方部分支持但价值低于其他项) |
| **HPX7-F(check-docs-consistency 新 regex)** | pro-to-product PP6 docs honesty 子任务 | 不与 4 状态机耦合违反新 S4 |

### 6.4 HPX7 与 hero-to-pro final closure 的关系

执行 HPX7 6 项后,hero-to-pro `final-closure.md` 的 partial-close/7-retained 状态可以更新为:

- F12 hook dispatcher 从"closed"诚实降级为"dispatcher instance injected, real caller deferred to pro-to-product PP4"(HPX7-1)
- token 双重累加 bug 显式 closed(HPX7-2)
- tool cancel 路径显式 closed(HPX7-3)
- attach race 显式 hardened(HPX7-4)
- HPX6 R1 / R2 显式 closed(HPX7-5 / 6)

**结果**:hero-to-pro 升级为 `close-with-known-issues`,4 个 owner-action retained 不变(它们是 owner action 而非 engineering work)。

---

## 7. 重排后的 pro-to-product

### 7.1 新阶段切分(7 phase)

```
PP0 — Charter & Entry Gate                   [8-12 天]
PP1 — HITL Interrupt Closure (C1)            [18-25 天]   ── Kernel 层
PP2 — Context Budget Closure (C2)            [20-28 天]   ── Context-core + Wrapper 层
PP3 — Reconnect Closure (C6)                 [15-22 天]   ── Connection 层
PP4 — Hook Delivery Closure (C5)             [12-18 天]   ── Hook 层 minimal-loop-first
PP5 — Reliability + Policy Honesty (C3+C4)   [15-22 天]   ── Wrapper 层 + Policy 层(内部分先后)
PP6 — Observability + Reasoning Stream + Final Closure  [10-15 天]   ── Stream/Frame 层 + 阶段封板
```

**注意**:initial 草案是 6 phase(PP0-PP5),新结构是 7 phase(PP0-PP6),把"observability + reasoning stream"独立成 PP6 而 Final closure 与之合并。这样:
- 把 reasoning content_type 区分(从 HPX7 删除后落到 PP6) + TokenCount push + RateLimits push + ContextWindow% push 等"observability layer"工作集中收口
- Final closure 作为 PP6 的子项,而非独立 phase(类比 hero-to-pro HP10 是独立 phase,但因 pro-to-product 的 closure 更轻量,可合并)

### 7.2 DAG 与并行窗口

```text
PP0 (charter / debt gate / acceptance freeze)
└── PP1 (HITL)
      ├── PP2 (Context — 依赖 PP1 interrupt 路径)
      └── PP4 (Hook — 依赖 PP1 confirmation interrupt for PreToolUse)
PP3 (Reconnect — 与 PP1 几乎无文件冲突,可与 PP1 并行启动)
PP5 (Reliability + Policy Honesty — 与 PP1 文件冲突仅 runtime-mainline LLM wrapper subsection,可与 PP1 后期/PP2 并行)
PP6 (Observability + reasoning + final closure — 等 PP1-PP5 全部 closure)
```

**并行窗口**:**PP1 / PP3 / PP5 三线并行**(差异于 initial 草案的 PP2/PP3/PP4 三线并行 — 因为新结构中 PP1 不再吞 C2 所以更轻);**PP2 / PP4 串行依赖 PP1**(因为 confirmation_pending interrupt 是它们的复用面)。

**critical path**:PP0 → PP1 → PP2 → PP6(估 65-92 天单工程师,不含 PP4/PP3/PP5 — 这三个可与 PP2 段并行)

### 7.3 工作组织模型(继承 Kimi §7.3 层固化策略)

#### 模型 A — 3 工程师并行(estimated 50-70 天 calendar = 2.5-3.5 人月)

| Engineer | 主要承担 | Phase 顺序 | 技术栈连续性 |
|---|---|---|---|
| **A — Kernel & State Machine** | PP1 → PP4 → PP6 内 reasoning stream | 串行 PP1 → PP4 | 全程 agent-core kernel/scheduler 层,无切换 |
| **B — Connection & Storage** | PP3 → PP6 内 status snapshot 收尾 | PP0 closure 后立即启动 PP3 | 全程 orchestrator-core ws-runtime + DO storage + packages/nacp-session 层 |
| **C — LLM Wrapper & Policy** | PP2 → PP5 → PP6 内 observability 收尾 | PP1 closure 后启动 PP2,PP2 closure 后启动 PP5 | 全程 agent-core LLM wrapper + orchestrator-core entrypoint policy 层 |

#### 模型 B — 1 工程师串行(estimated 80-110 天 calendar = 4-5.5 人月,采纳 Kimi 层固化建议)

按层而非按 phase 编号串行:

```
Wave 1 (Kernel/State Machine 层): PP0 → PP1 → PP4 → PP6 reasoning stream
Wave 2 (Connection 层): PP3 → PP6 status snapshot
Wave 3 (Wrapper/Policy 层): PP2 → PP5 → PP6 observability final
```

每个 wave 内文件改动域几乎不切换,降低 cognitive load(避免 Kimi 估计的 3-5 天/次 reload 时间)。

### 7.4 6 个闭环 vs 7 个 phase 的映射

为避免阅读混淆,显式给出闭环 → phase 映射:

| 闭环 | 主要承担 phase | 跨 phase 子项 |
|---|---|---|
| **C1 HITL** | PP1(主)| PP4 复用 confirmation interrupt 给 PreToolUse |
| **C2 Context** | PP2(主)| 无 |
| **C3 Reliability** | PP5 后半 + PP6 observability | fallback metadata 早(PP5),retry 中(PP5),streaming recovery 中(PP5) |
| **C4 Policy honesty** | PP5 前半(主)| PP4 hook 与 permission_rules 仲裁 也涉及 |
| **C5 Hook delivery** | PP4(主)| PP6 HookStarted/HookCompleted frame 推送收尾 |
| **C6 Reconnect** | PP3(主)| PP6 actor snapshot 推送收尾 |

### 7.5 6 个真实 truth gate(采纳 GPT §6)

新 PP0 charter §10.1 Primary Exit Criteria 必须冻结这 6 条:

| Truth | 验收 e2e | 失败动作 |
|---|---|---|
| **T1 — HITL truth** | `approval_policy=ask` 在 e2e 中触发真 confirmation pause-resume(allow / deny / timeout 三路径全绿)| PP1 不能 closure |
| **T2 — Context truth** | compact 后下一个 LLM request 的 prompt **真减小**(byte-level diff 显示老消息被替换为 summary)| PP2 不能 closure |
| **T3 — Reconnect truth** | DO hibernation 后 client 带 `last_seen_seq` 重连 → 收到 lagged contract 或真 replay,不 throw 给前端 | PP3 不能 closure |
| **T4 — Session state truth** | 重连后立刻收到 `session.actor.snapshot` 帧,含 `phase / activeTurnId / pendingConfirmationUuid` | PP3 / PP6 不能 closure |
| **T5 — Policy truth** | `network_policy / web_search / workspace_scope` 在 e2e 中要么真 enforce(阻断违规调用),要么 docs/API response 显式标 `stored-not-enforced` | PP5 不能 closure |
| **T6 — Hook truth** | 至少一条 hook path 完成 `register → emit → outcome → audit visible + frontend visible` 的全闭环 e2e | PP4 不能 closure |

### 7.6 PP0 charter 必含 14 节(对照 hero-to-pro 体例)

新 PP0 charter `plan-pro-to-product.md` 应严格按 hero-to-pro charter 模板,但补 4 节双审新增内容:

```
§0 为什么这份 charter 要现在写
§1 本轮 owner decisions + 基石事实
  + Kimi §1.2 的 4 条 in-scope 判定标准(新)
§2 当前真实起点 — Reality Snapshot
  + §16.4 hero-to-pro workbench-grade backend substrate 引用(新)
  + Gate D1 Hero-to-Pro Debt Acknowledgement(13 项)(新)
  + Gate D2 7-retained Non-Block Verification(新)
§3 一句话目标
  + 元元结论:从"功能完成"到"前端可信"的 closure 纪律转向(新)
§4 全局 In-Scope / Out-of-Scope
  + 4.7 用户感知度 must/should/nice 三级矩阵(新)
§5 方法论
  + 第 8 条:工作量估算纪律(基础 ×1.5 / e2e 单列 / 20% buffer / 30% 超期 scope-cut)(新)
§6 Phase 总览
  + 6.4 工程组织模型 A / B(新,继承 Kimi §7.3 层固化策略)
§7 各 phase 详细 In-Scope/Out-of-Scope/Exit Criteria
§8 执行顺序与 Gate
§9 测试与验证策略
§10 Primary Exit Criteria(6 truth gate)+ NOT-成功识别清单 + 收口类型判定表
§11 下一阶段触发条件(承袭 hero-to-pro §11)
§12 Owner / Architect 决策区(更少更具体)
§13 Frontend Engagement Schedule(新,完整 6 时点)
§14 Observability Baseline(新,4 阈值)
§15 Contingency Contract(新,Top-3 risk fallback)
§16 维护约定
```

### 7.7 D1 freeze 例外条款(GPT §3.5)

新 PP0 charter §4.4 R8' 的 pro-to-product 版本:

```
pro-to-product 默认严禁新 D1 migration。受控例外条件(全部满足才允许):
1. 该 migration 是 reconnect / dedup / detached recovery 这 3 类语义之一(穷举)
2. 字段总数 ≤ 5 列,无新表
3. owner 明文批准,且本 charter §7 对应 phase 显式登记 schema 修订
4. 新 migration 编号继 hero-to-pro 序列(`014-...` 起)
5. PP6 final closure 显式登记此例外的 schema correction list
```

---

## 8. 修正后工作量估算

### 8.1 各 phase 估算(单工程师)

| Phase | 内容 | 估算 | 上调 vs initial |
|---|---|---|---|
| **HPX7** | 6 项 | 3.5-4.5 天 | **-60%**(initial 7-12 天) |
| **PP0** | charter / debt gate / contingency / frontend schedule | 8-12 天 | **+30%**(initial 3-5 天) |
| **PP1** | HITL Interrupt Closure | 18-25 天 | **+45%**(initial 14-21 天 PP1 一半) |
| **PP2** | Context Budget Closure | 20-28 天 | initial 14-21 天的 PP1 另一半;独立后估算上调 |
| **PP3** | Reconnect Closure | 15-22 天 | 与 initial 一致 |
| **PP4** | Hook Delivery Closure | 12-18 天 | **-25%**(initial 10-15 天 + minimal-loop-first 简化) |
| **PP5** | Reliability + Policy Honesty | 15-22 天 | 与 initial PP4 一致 |
| **PP6** | Observability + Reasoning + Final | 10-15 天 | 新 phase |
| **总计单工程师** | — | **101-146 天 ≈ 5-7 人月** | **+25-30%** vs initial |
| **总计 3 工程师并行** | critical path = PP0+PP1+PP2+PP6 | **56-80 天 ≈ 2.5-4 人月** | **+25%** vs initial |

### 8.2 工期诚实性评估

新估算与 Kimi §5.1 的 90-120 天单 / 50-70 天三人范围**基本对齐**,但偏中位数(我对 e2e 成本与上下文切换的看法稍乐观于 Kimi)。如果 owner 要更保守,可在 PP0 charter 里把所有上限 +10% 作为 final 数字。

### 8.3 PP1 + PP2 = 关键路径风险集中

新结构中 PP1 + PP2 占 critical path 38-53 天,占整个 single-engineer 工期 38-50%。如果 PP1 或 PP2 中任一卡壳,整个 pro-to-product 拖期。**Contingency Contract**(§7.6 §15)对这两个 phase 的 fallback 路径必须最详细(见 Kimi §8.2)。

---

## 9. Pro-to-Product 阶段的 Design Doc 蓝图

### 9.1 设计哲学:design doc 是阶段的"技术决策骨架"

承袭 hero-to-pro charter §13.1 的 design doc 体例,pro-to-product 的 design docs 需要承担**3 层职责**:

| 层 | 职责 | 在 hero-to-pro 的对应 |
|---|---|---|
| **Tier 1 — Reasoning / pre-charter** | 产出 charter 写作的输入(类比 closing-thoughts);锁定阶段的"为什么" | `closing-thoughts-part-{1,2}-by-opus.md`(2 份)|
| **Tier 2 — Cross-cutting architecture** | 跨 phase 的共享语义、共享接口、共享纪律;阶段最高抽象层 | `hero-to-pro-schema.md` / `lane-e-final-state.md`(2 份)|
| **Tier 3 — Per-phase implementation** | 每个 phase 的实施前 design 锁定;phase action-plan 的输入 | `HP1-schema-extension.md` 至 `HP8-runtime-hardening.md`(8 份)|

**总计 hero-to-pro 12 份 design**(2 + 2 + 8)。**pro-to-product 同体例,但工作性质不同**(不补新 capability,只接通已有的) → 我的判断是 design 数量略少,但 Tier 2 比例提高(因为 closure 纪律 / honesty contract / observability baseline 是阶段级的,不是 phase 级的)。

### 9.2 Pro-to-Product Design Doc 完整清单(13 份)

#### Tier 1 — Reasoning / Pre-Charter(3 份)

| # | 文件 | 职责 | 何时写 |
|---|---|---|---|
| **1** | `docs/eval/pro-to-product/closing-thoughts-by-opus.md`(类比 hero-to-pro `closing-thoughts-part-1`)| 把 9 份 core-gap 报告 + 双审 + initial-planning 三类输入合成,产出"pro-to-product 必须解决什么"和"pro-to-product 不应解决什么"两个答案;为 PP0 charter §0 / §3 / §4 提供 reasoning 基础 | PP0 启动 Day 1-3 |
| **2** | `docs/eval/pro-to-product/debt-acknowledgement-matrix.md`(Kimi §6 提议)| 逐项登记 hero-to-pro retained(7 项)+ HPX6 closure followups(4 项)+ HPX6 review findings(9 项)= **20 项** debt 的处理决议(本阶段处理 / next stage / 不处理 + 理由)| PP0 启动 Day 4-7 |
| **3** | `docs/eval/pro-to-product/9-report-deferral-matrix-by-opus.md` | 把 9 份 core-gap 报告中所有 P0/P1/P2 项目逐项归一为 "PP0/PP1/PP2/PP3/PP4/PP5/PP6 / out-of-scope" 矩阵;消除 9 份报告之间的语义交叉与隐含矛盾;为 PP0 charter §6 / §7 提供 phase In-Scope 输入 | PP0 启动 Day 8-12 |

#### Tier 2 — Cross-Cutting Architecture(4 份)

| # | 文件 | 职责 | 何时写 | 与 hero-to-pro 对应 |
|---|---|---|---|---|
| **4** | `docs/architecture/pro-to-product-truth-architecture.md` | 重新刻画三层真相(D1 / DO storage / DO memory)在 6 个闭环里的责任划分:① compact 后 message persistence 在哪一层;② replay restore 后哪些状态从哪源 hydrate;③ hook outcome audit 写哪;④ confirmation_pending interrupt 状态在哪持久化;⑤ detached TTL counter 在哪。**这是阶段最重要的架构 doc**,否则 6 闭环各自实现会出现"compact 改 D1 但 replay 只读 DO storage"这类不一致 | PP0 完成,PP1 启动前 frozen | `hero-to-pro-schema.md`(架构层) |
| **5** | `docs/architecture/pro-to-product-frontend-contract.md`(Kimi 用户感知矩阵 + GPT 6 truth)| 定义 6 闭环对前端的契约:must-have(用户直接感知) / should-have(间接感知) / nice-have(后端内部);明确 charter §16 22-doc 之外**新增** `hooks.md` / `reconnect.md` / `reasoning.md` 的 rationale 与边界;为前端团队介入 PP1a 的 mock 阶段提供 stable contract | PP0 完成,PP1 启动前 frozen | `client-cookbook.md`(本身就是 client contract) |
| **6** | `docs/architecture/pro-to-product-honesty-contract.md` | 把 GPT §6 的 6 条 truth gate 升格为阶段纪律 doc:① 6 truth 各自的 e2e 验收方式;② "wire-with-delivery 不算闭合"在每个 phase closure 中的具体判定;③ 文档诚实表述准则(避免"emitter live"用于 0-caller emitter);④ HPX5 P5-05 `check-docs-consistency.mjs` 的扩展 rule | PP0 完成,所有 phase 共享 | 无对应(hero-to-pro 没明确 honesty doc,只在 charter §5 + §10.3 散写) |
| **7** | `docs/architecture/pro-to-product-observability-baseline.md`(Kimi §9.2)| 4 个用户感知阈值(confirmation interrupt ≤500ms / compact ≤3s / reconnect 重放 ≤2s / retry 首响 ≤1s)的精确测量方式 + frame timing 语义 + 每个阈值在哪个 phase 验收 | PP0 完成,PP6 主要消费 | 无对应 |

#### Tier 3 — Per-Phase Implementation(5 份)

每个 phase 一份 design doc,体例对齐 hero-to-pro `HP*.md`。

| # | 文件 | 职责 | 何时写 |
|---|---|---|---|
| **8** | `docs/design/pro-to-product/PP1-hitl-interrupt-closure.md` | ① scheduler interrupt 状态机扩展(`confirmation_pending` phase);② `awaitAsyncAnswer` 复用 vs 重写决策;③ `OrchestrationState` 持久化策略;④ race 处理(用户在 confirmation pending 时 send followup_input / cancel);⑤ timeout 语义(default 60s vs per-tool override);⑥ allow / deny / timeout 三态恢复路径 + e2e 用例清单 | PP0 末段写,PP1 启动前 frozen |
| **9** | `docs/design/pro-to-product/PP2-context-budget-closure.md` | ① token estimator 实现(byte heuristic 含中文系数);② `request-builder.ts` 预检集成点;③ context-core 真 summary 算法(参考 claude-code microcompact / gemini-cli `<state_snapshot>`);④ reducer 真截消息策略(保留最近 N 轮 vs 阈值百分比);⑤ `<model_switch>` 与 summary 的剥离恢复;⑥ 超窗 graceful degrade 路径(走 confirmation `kind:context_compact` 或 emit `system.error`)| PP1 中段写,PP2 启动前 frozen |
| **10** | `docs/design/pro-to-product/PP3-reconnect-closure.md` | ① `restoreFromStorage` 接通 helper.restore 顺序;② `replay.ts` 从 throw 改 lagged contract 的 schema(emit `session.replay.lagged` 帧);③ detached TTL 默认值与 cron 调度;④ running-turn 在 detach 后的 cancel 策略;⑤ `session.actor.snapshot` 帧 schema(GPT/Kimi 都建议加);⑥ followup_input dedup(request_id + ack)— 决议是 PP3a 包含还是 defer 到 PP6 | PP0 末段写,PP3 启动前 frozen |
| **11** | `docs/design/pro-to-product/PP4-hook-delivery-closure.md` | ① `authorizeToolPlan` 改 "先走 HookDispatcher.emit('PreToolUse'),再走 authorizeToolUse fallback" 的具体调用顺序;② 与 HPX6 D1PermissionRulesPlane 的仲裁顺序(GPT/Kimi 都点名为 PP2-PP4 风险);③ "至少 1 个 register source"选 platform-policy 还是 session;④ 最小前端可见性 — `session.hook.started/completed` schema vs 复用 `session.confirmation.update`;⑤ allowedOutcomes 扩展 — outcome 是否需要 typed entries(claude-code/gemini-cli 都有);⑥ 14/18 emit producer 在 PP4 内只接通哪几个,余下留 PP6 还是 platform-foundations | PP1 closure 后写,PP4 启动前 frozen |
| **12** | `docs/design/pro-to-product/PP5-reliability-and-policy-honesty.md` | ① `/runtime` 三字段二选一终态决议(network/web_search/workspace_scope:enforce 的实现路径 vs 降格为 hint 的 docs 改动清单);② Workers AI fallback metadata 抬出协议(`fallback_used / requested_model_id / fallback_model_id / fallback_reason` 字段在 NormalizedLLMEvent 的位置);③ stream retry / idle timeout 实现(参考 codex 5/300s);④ streaming-fallback tombstone 算法(参考 claude-code `query.ts:650-740`);⑤ loop detection 是否本 phase 做(评估 user perception 是 nice-have)| PP4 中段写,PP5 启动前 frozen |
| **13** | `docs/design/pro-to-product/PP6-observability-and-final-closure.md` | ① reasoning content_type 流推送(`session-stream-adapter.ts` 改造);② TokenCount / RateLimits / ContextWindow% push 帧 schema;③ HookStarted/HookCompleted 推送 schema(完成 PP4 留下的"扩展"部分);④ `clients/api-docs/` 22 → 25 doc 的 3 份新增 contents outline;⑤ final closure 要素清单(deferral 矩阵 / 6 truth e2e 全绿 / honesty contract 验收 / debt-matrix 闭合状态 / handoff stub) | PP4 / PP5 closure 期间写,PP6 启动前 frozen |

#### **总计:13 份 design**(3 Tier1 + 4 Tier2 + 6 Tier3)

vs hero-to-pro 12 份(2 + 2 + 8):pro-to-product 多 1 份是因为 Tier 2 多了 honesty + observability baseline 两份(hero-to-pro 没显式做)。

### 9.3 13 份 design 如何共同完成阶段方向 / 技术指导 / 落地规划

这 13 份 design **不是各自独立**,而是按下面这条 dependency 链条层层咬合:

```
Tier 1 reasoning (3 份)
   └─→ 为 Tier 2 提供"为什么"answer
            ↓
Tier 2 cross-cutting architecture (4 份)
   └─→ 为 Tier 3 提供"什么形状"answer
   └─→ 为 charter §10 truth gate 提供 acceptance 定义
            ↓
PP0 charter (`plan-pro-to-product.md`) ←─────── 三 Tier 共同输入
   └─→ 为 Tier 3 各 phase design 提供 boundary
            ↓
Tier 3 per-phase implementation (6 份)
   └─→ 为各 phase action-plan(`docs/action-plan/pro-to-product/PP*.md`) 提供"怎么做"answer
            ↓
各 phase action-plan
   └─→ 为各 phase closure(`docs/issue/pro-to-product/PP*-closure.md`) 提供"做了什么"answer
```

具体对每一份 design 的"输出对象"给出明确归属:

| Design | 直接输入到的下游 doc |
|---|---|
| **(1)** closing-thoughts | PP0 charter §0 / §3 / §4 |
| **(2)** debt-matrix | PP0 charter §2.2 Reality Snapshot Gate D1 / D2 |
| **(3)** 9-report-deferral-matrix | PP0 charter §6 / §7;每个 phase 的 §7.X In-Scope |
| **(4)** truth-architecture | PP1 / PP2 / PP3 design docs 的"持久化策略"小节;PP6 final closure 的"三层真相一致性 verify"小节 |
| **(5)** frontend-contract | PP4 / PP5 / PP6 设计 + frontend 团队接入文档;PP6 final closure "前端 demo 跑通"证据 |
| **(6)** honesty-contract | 每个 phase closure 的 wire-with-delivery 验证段;PP6 final closure |
| **(7)** observability-baseline | PP6 design;PP1 / PP2 / PP3 e2e 测试 acceptance |
| **(8)-(13)** per-phase | 各 phase action-plan;各 phase closure |

### 9.4 Design 文档顺序与时间盒

按 dependency 链条,建议的撰写时间盒:

```
Day 1-3:    closing-thoughts-by-opus.md             [Tier 1.1]
Day 4-7:    debt-acknowledgement-matrix.md          [Tier 1.2]
Day 8-12:   9-report-deferral-matrix-by-opus.md     [Tier 1.3]
            ↓ 此时 Tier 1 完成,可以开始 PP0 charter 第一版
Day 13-17:  pro-to-product-truth-architecture.md    [Tier 2.4]
Day 13-17:  pro-to-product-frontend-contract.md     [Tier 2.5]   ← 与 4 并行
Day 18-20:  pro-to-product-honesty-contract.md      [Tier 2.6]
Day 18-20:  pro-to-product-observability-baseline.md [Tier 2.7]  ← 与 6 并行
            ↓ 此时 Tier 2 完成,PP0 charter 第二版定稿
Day 21-23:  PP1 design (PP1-hitl-interrupt-closure)  [Tier 3.8]
Day 21-23:  PP3 design (PP3-reconnect-closure)       [Tier 3.10] ← 与 8 并行
            ↓ PP0 closure;PP1 / PP3 启动
PP1 中段:   PP2 design                                [Tier 3.9]
PP1 closure:PP4 design                                [Tier 3.11]
PP4 中段:   PP5 design                                [Tier 3.12]
PP4/5 closure: PP6 design                             [Tier 3.13]
```

PP0 阶段总工期对应 Day 1-23 = 约 18-23 工作日(单工程师);Kimi 的 PP0 8-12 天估算偏少 — 因为没把 13 份 design 全 frontload 算进去。**新 PP0 估算上调到 18-23 天**。

### 9.5 Design Review 体例(继承 hero-to-pro)

每份 design 应至少做一轮 review,体例参考 hero-to-pro action-plan-docs-reviewed-by-{GPT,kimi,deepseek,opus}.md 的 4 家 review pattern。但因 pro-to-product 工期紧,可以:

- **Tier 1**(3 份):多家 review(GPT + Kimi + Deepseek + Opus 4 家),因为 Tier 1 决定整阶段方向
- **Tier 2**(4 份):双家 review(GPT + Kimi 2 家)
- **Tier 3**(6 份):单家 review(任选 1 家),因为 phase 内细节由执行 engineer 主导

总 review 工作:Tier 1 4×3=12 份 + Tier 2 2×4=8 份 + Tier 3 1×6=6 份 = **26 份 review**。

---

## 10. 综合修订清单(initial 草案 → 修订版)

下面这张表是 owner 在写 PP0 charter 前应该掌握的所有 deltas 的精简清单:

| 维度 | initial v0 | 修订 v1(本文) | 决议来源 |
|---|---|---|---|
| HPX7 项数 | 8 | 6(删 3 加 2)| Kimi §2.1 自指 + GPT §4 部分采纳 |
| HPX7 工期 | 7-12 天 | 3.5-4.5 天 | Kimi §2.2 |
| Phase 数量 | 6(PP0-PP5)| 7(PP0-PP6)| §7.1 + Kimi §4.3 |
| PP1 拆分 | 单 phase | PP1(C1)+ PP2(C2)| GPT §3.1 + Kimi §4.3 共识 |
| PP3 优先级 | 在 PP4 后 | 在 PP4 前 | GPT §5 |
| PP3 内部排序 | 平铺 7 项 | restore-first / protocol-second(可拆 PP3a/PP3b)| GPT §3.3 |
| PP4 范围 | 14 emit + 完整面 | minimal live loop first + 扩展留 PP6 | GPT §3.2 + Kimi 隐性 |
| PP5 范围 | C3+C4 平铺 | 内部分 policy honesty 早 / reliability 后 | GPT §3.4 |
| PP6 新设 | 不存在 | observability + reasoning + final closure 合并 | §7.1 自审 |
| D1 freeze 表述 | 硬禁令 | 默认 + 受控例外 5 条 | GPT §3.5 |
| 用户感知度矩阵 | 无 | must / should / nice 3 级 | Kimi §3.3 |
| Frontend Engagement | 无 | 6 时点 schedule | Kimi §9.1 |
| Observability Baseline | 无 | 4 latency 阈值 | Kimi §9.2 |
| Contingency Contract | 无 | Top-3 risk fallback | Kimi §8 |
| Debt Acknowledgement Gate | 无 | Gate D1 13 项 + Gate D2 7-retained | Kimi §6 + §9.3 |
| 6 truth gate | 无显式 | T1-T6 作为 Primary Exit Criteria | GPT §6 |
| 工作量(单工程师)| 60-90 天 | 101-146 天 | Kimi §5.1 + 自审 |
| 工作量(3 工程师并行)| 35-50 天 | 56-80 天 | 同上 |
| Design doc 数量 | 未明确 | 13 份(3+4+6)| 本文 §9 |

---

## 11. 一句话定位(修订版)

> **pro-to-product = 把 hero-to-pro 已经盖好的 schema/storage/façade 真正接通到 _agent loop_ 与 _client 可见层_,通过 6 truth gate(HITL / Context / Reconnect / Session-state / Policy / Hook)的端到端 e2e 验收,完成 6 个闭环(C1-C6),让前端第一次能站在一个 _诚实_、_可观测_、_可恢复_ 的产品级 backend 上搭起来 — 同时把"functionality complete 不等于 frontend trust"这条 hero-to-pro 阶段反复出现的反模式,通过 honesty contract + 6 truth gate + Tier 2 cross-cutting designs,在阶段纪律层面 codify 成 platform-foundations 阶段的入口约束。**

---

## 12. Owner 决策清单(修订版)

修订后 owner 仍需决断的问题(对照 initial §9 7 个,部分已自答):

### 已自答(不再 owner 决策)

- ~~Q1 HPX7 是否接受 8 项?~~ → 改为 §6 提议的 6 项,owner 决断"接受 6 项还是减项"
- ~~Q2 6 闭环 / 6 phase 切分?~~ → 改为 §7.1 提议的 7 phase
- ~~Q5 charter 是严格还是轻量?~~ → 已通过 §7.6 14 节列表自答(严格)

### 仍需 owner 决断

- **Q1'**:HPX7 是否接受 §6 提议的 6 项 / 3.5-4.5 天?
- **Q2'**:pro-to-product 是否接受 §7.1 提议的 7 phase + DAG?
- **Q3'**:D1 freeze 是否接受 §7.7 5 条受控例外?
- **Q4'**:工作组织模型 A(3 工程师)/ B(1 工程师层固化)/ 介于两者?
- **Q5'**:Tier 2 4 份 cross-cutting designs 是 PP0 必交付,还是允许部分推迟到 PP1 启动后补?
- **Q6'**:`pro-to-product` 命名是否最终?(GPT / Kimi 都默认接受)
- **Q7'**:HP10 final closure 与 HPX7 顺序 — HPX7 在 HP10 之前完成(更干净)还是之后做(允许 hero-to-pro 先 close)?
- **Q8'(新)**:6 truth gate 中 T5 Policy truth 的"二选一终态" — owner 倾向 enforce 还是降格?**这条最好在 PP0 charter 写之前决断**,否则 PP5 design 没 anchor。
- **Q9'(新)**:前端团队是否同意按 §9.2 Tier 2.5 frontend-contract 提议的方式介入?frontend lead 应在 PP0 Tier 1 reasoning 阶段就加入 review。
- **Q10'(新)**:13 份 design 是否过多?如果 owner 觉得过多,可以把 Tier 2 的 honesty-contract + observability-baseline 合并成 1 份 → 12 份;或者把 Tier 1.3 9-report-deferral 并入 closing-thoughts → 12 份。但 Tier 3 6 份 per-phase 不可减(否则等于无 design 直接 action-plan)。

---

## 维护约定

1. 本文档是 `eval / re-planning`,在 PP0 charter 写出之前**与 initial-planning v0 并存**,作为修订对照档。
2. PP0 charter 写出之后,本文档自动转为 "ancestry-only" 参考,与 initial-planning v0 一起作为 PP0 charter 的输入包。
3. 若双审的某一条建议在实际 PP0 charter 撰写过程中被 owner 拒绝,本文档应在该条目下补行说明 owner 的反 reasoning,保持决策 trail。
4. 13 份 design 的清单(§9.2)是建议数量,owner 可根据 Q10' 决断调整,但调整决议必须在 PP0 charter §13 后续文档生产清单内显式登记。
