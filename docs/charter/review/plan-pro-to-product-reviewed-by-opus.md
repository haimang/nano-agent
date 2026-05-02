# `plan-pro-to-product.md` 审查报告(Opus)

> **文档性质**: `charter / review`
> **审查对象**: `docs/charter/plan-pro-to-product.md`(GPT v0.active.1)
> **审查方法**: 以当前仓库一手代码 + DDL migration 文件 + hero-to-pro 真实 closure 状态为准;不参考其他同事的 review 结论
> **审查者**: Claude Opus 4.7(1M context)
> **日期**: 2026-05-02
> **审查所用直接证据**:
> - `docs/issue/hero-to-pro/HPX7-closure.md`(HPX7 闭合状态)
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`(hero-to-pro 终态 `close-with-known-issues / 4-owner-action-retained`)
> - `workers/orchestrator-core/migrations/001-017.sql`(17 migrations,实际 DDL truth)
> - `workers/agent-core/src/host/runtime-mainline.ts`(主循环代码)
> - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`(DO assembly)
> - `workers/agent-core/src/host/do/session-do-persistence.ts`(persistCheckpoint / restoreFromStorage)
> - `workers/agent-core/src/host/do/session-do-runtime.ts`(emit permission/elicitation substrate)
> - `workers/agent-core/src/host/orchestration.ts` + `host/shutdown.ts`(emitHook 真实站点)
> - `workers/agent-core/src/eval/durable-promotion-registry.ts`(eval-observability 中的 16 个 registry.register 调用)
> - `workers/orchestrator-core/src/facade/routes/session-runtime.ts`(ETag/If-Match 实装)
> - `workers/agent-core/src/llm/executor.ts` + `llm/gateway.ts` + `llm/request-builder.ts`(LLM wrapper 现状)
> - `packages/nacp-session/src/replay.ts`(REPLAY_OUT_OF_RANGE 仍 throw)

---

## 0. TL;DR(总判定)

**总评**:**这是一份方向准确、克制有度、与代码真相高度对齐的 charter,可以作为 active baseline 进入 PP0**。它正确地承接了 HPX7 完成后的真实终态,合理地把 7 phase 切分按"代码耦合面 + truth 依赖链"组织,并通过 truth gate 取代功能自述作为 closure 标准 — 这正是 hero-to-pro 阶段反复出现的 wire-without-delivery 反模式的解药。

**阶段划分合理性**:**8/10**。PP0-PP6 7 phase + DAG 与代码耦合面强相关;PP1 (HITL) / PP2 (Context) 显式拆分采纳了双审共识;PP3 / PP6 顺序合理;PP6 把 contract sweep + final closure 合并是大胆但 acceptable 的设计选择。

**文档种类与分工合理性**:**7/10**。8 design + batch review + e2e-first 是合理的 lean choice,正确地避免了"13 design 文档体系膨胀"的反模式。但**3 个具体维度被合并/省略时存在风险**:① observability latency baseline(Kimi §9.2 4 阈值)被完全省略;② Tier 2 cross-cutting "honesty contract" 散在 §5/§10,无独立 doc 可能让 6 truth gate 验证 ad-hoc;③ frontend engagement schedule 完全缺席。

**代码 / DDL 真相一致性**:**9/10**。20+ 处具体代码引用经我逐一核验,**全部准确**(authorizeToolPlan 仍 error-out / requestCompact tokensFreed=0 / emitPermissionRequestAndAwait 已存在 / Hook* dispatcher 已注入 / runtime ETag 已实装等)。**但有 1 处轻微不准 + 1 处事实空白**:① §2.1 的"Hook substrate 已在"措辞会让读者误以为 register 路径 0,实际 `eval/durable-promotion-registry.ts` 已有 16 个 production register 调用(只是用于 Class D async-compact 事件,不是 PreToolUse);② charter 对当前 17 个 D1 migration(`001-017`)的真实编号 / 受控例外历史(`014`)只字未提,会让 PP3 的"≤5 列受控例外"在执行期失去 anchor。

**核心断点**(本审查识别 4 项,均可在 charter 内一次性补完,非阻塞):
- B1 — observability baseline 缺失(latency 阈值)
- B2 — frontend engagement schedule 缺失
- B3 — DDL 真相 anchor 缺失(17 migration 编号 / `014` 受控例外历史)
- B4 — Hook register 现状描述精度(0 vs 16 register source)

**建议**:**charter 不需要重写,但建议出一个 v0.active.2 修订**,补 4 个断点 + 微调 §2.1 措辞;然后即可作为 PP0 启动的 frozen baseline。

---

## 1. 阶段划分合理性评估

### 1.1 7-phase 切分本身

| Phase | 名称 | 本审查判定 | 理由 |
|---|---|---|---|
| **PP0** Charter & Truth Lock | 必含首个 e2e skeleton 而非 13 文档体系 | **✅ 合理** | "e2e-first not doc-first" 是对 initial / re-planning 草案最有价值的修正;PP0 同时交付 charter + 00/01 cross-cutting + 1 个真实 e2e 是恰当的 scope |
| **PP1** HITL Interrupt Closure | C1 单独成 phase | **✅ 合理** | 双审独立得出"必须拆 C1+C2"的共识;GPT charter 直接采纳。代码现实(`runtime-mainline.ts:235-261` 仍 error-out / `session-do-runtime.ts:378-415` substrate 已就绪)印证这是产品级 trust 的第 1 顺位 |
| **PP2** Context Budget Closure | C2 单独成 phase | **✅ 合理** | `runtime-mainline.ts:833-836` 的 `tokensFreed:0` 与 `runtime-assembly.ts:292-324` 的 probe 已接通构成"假闭环",PP2 单独承担合理 |
| **PP3** Reconnect & Session Recovery | C6 | **✅ 合理** | `session-do-persistence.ts:154-160` 写盘 vs `:193-222` 不读 helper.restore — 这是 wire-asymmetry 的标准案例,PP3 集中处理是对的 |
| **PP4** Hook Delivery Closure | C5 minimal-loop-first | **✅ 合理(但 §2.1 表述需精化,见 §5 B4)** | `runtime-assembly.ts:191-196` 实际状态:dispatcher 已注入 + 16 register source 已存在(eval-observability) — 这与 charter §2.1 "production register source 仍未接通" 的措辞**部分错位**。详见 §5 B4 |
| **PP5** Policy Honesty + Reliability Hardening | C3+C4 同 phase 内分先后 | **✅ 部分采纳 GPT 双审建议** | initial 草案曾建议拆 PP5a/PP5b,GPT charter 选合并 — 这是合理的 trade-off(避免 phase 过多),但需要 PP5 design 显式约定 policy honesty 在前 / reliability 在后 |
| **PP6** API Contract Sweep + Frontend Docs Closure + Final Closure | 三合一 phase | **⚠️ 大胆但 acceptable** | 详见 §1.4 |

### 1.2 DAG 与并行窗口

```
PP0 → PP1 → {PP2, PP3, PP4} → PP5 → PP6
```

**判定**:**与代码改动域吻合**。证据:
- `runtime-mainline.ts authorizeToolPlan + scheduler interrupt`(PP1 主改区)与 `request-builder.ts + reducer.ts`(PP2 主改区)在文件层有交叉但语义层独立 → PP2 串行依赖 PP1 substrate 是正确的
- `session-do-runtime.ts emitPermissionRequestAndAwait`(PP1 主改区)与 `session-do-persistence.ts restoreFromStorage`(PP3 主改区)只共享同一文件夹但**几乎无重叠改动行**,PP3 与 PP1 后期可并行的判断是对的(charter §6.3 第 3 条 + §7.4 风险提醒第 1 条都自我意识到这一点)
- PP4 PreToolUse 走 dispatcher 改造与 PP1 confirmation interrupt 共享 `runtime-mainline.ts authorizeToolPlan` 函数体 → 必须 PP1 后启动,charter §6.3 第 2 条已 codify

### 1.3 PP1 → PP2 / PP4 串行依赖

GPT charter §6.3 第 2 条 + §7.4 风险提醒第 2 条都明确说"PP1 必须先稳定才能启动 PP2 / PP4"。这与我 re-planning v1 §7.2 的 critical path 判断一致。

**唯一的细节问题**:charter 没说 PP1 / PP2 / PP3 / PP4 / PP5 各自的工期估算(无单工程师 or 多工程师 day count)。这在 hero-to-pro charter §6.1 表格也是同样省略 — 是 charter 类文档体例,acceptable;但 owner 要排资源 / 排日历时,需要 PP0 charter §13 后续文档生产清单内的 action-plan 提供。

### 1.4 PP6 三合一(Contract Sweep + Frontend Docs Closure + Final Closure)— 风险评估

**charter §6.1 表格 + §7.7 显式把 PP6 写成"contract sweep + docs closure + final closure"三合一**。这是相对 initial / re-planning 草案的**最显著结构性新增**,值得专门评估。

**正面**:
- 把"前端 contract 对账"作为独立工作有合理性(initial / re-planning 都漏掉了这一层 — 我自己 re-planning v1 §9.2 把它放进 Tier 2 frontend-contract design 一份 doc 而非独立 phase,GPT 的处理更彻底)
- 22-doc pack 已 frozen 但"docs ≠ truth"的隐患(charter §1.2 第 5 行 + HPX7 H6 修复 ETag/If-Match 但 docs 是否同步重写仍需验证),需要专门 phase 收口
- final closure 与 docs sweep 合并能避免"final closure 阶段才发现 docs 大面积漂移,临时回头修"的风险

**负面 / 风险**:
- **Contract sweep 是实施型工作**(item-by-item 扫 22+ docs vs 真实代码、改 stale 文本、跑 `check-docs-consistency`),**final closure 是治理型工作**(`pro-to-product-final-closure.md` + handoff stub + retained map)— 两类工作的节奏感不同
- 22-doc 现已扩到 22+(有 hooks.md / reconnect.md / reasoning.md 是否新增?charter §13 也没说),contract sweep 单独估算可能 5-7 天;final closure 类 HP10-closure 估算 5-7 天;**合并后 phase 总规模可能 10-15 天但内部存在两段心智切换**
- charter §7.7 风险提醒第 1 条明确警告"最容易膨胀成全仓再审一遍"— 自我意识到此风险但未给 contingency

**最终判定**:**接受 PP6 三合一,但建议 PP6 design(`07-api-contract-docs-closure.md`)显式把 phase 内分两段 sub-task**:
- PP6.A — Contract Sweep + Docs Closure(实施型;duration 70%)
- PP6.B — Final Closure + Handoff Stub(治理型;duration 30%)

避免"contract sweep 没扫完 → final closure 被仓促执行"的实操风险。

### 1.5 PP5 范围(C3+C4 合并)

charter §7.6 明确 PP5 = enforce-or-downgrade(policy honesty)+ minimal fallback/retry truth surface。**这正是 GPT 在 initial-planning-reviewed-by-GPT.md §3.4 提议的方向**,但 GPT 当时建议"policy 早 / reliability 后";charter 通过 §7.6 In-Scope 排序(第 1 项 enforce-or-downgrade / 第 2 项 fallback-retry)隐含了这个先后顺序。**判定**:OK,但建议 PP5 action-plan 显式 codify "policy block 必须在 reliability block 之前 land"。

### 1.6 阶段划分综合评分

| 维度 | 评分 |
|---|---|
| 与代码耦合面对齐度 | **9/10** |
| DAG 串行依赖正确性 | **9/10** |
| 双审共识采纳率 | **9/10**(PP1 拆分 / PP3 restore-first / Hook minimal-loop-first 全部采纳) |
| Phase 数量克制度 | **8/10**(7 phase 比 initial 6 多 1 个,但避免了 6 phase 把 PP6 contract sweep 漏掉的更大问题) |
| Out-of-scope 边界清晰度 | **9/10**(O1-O5 列举具体且与下游阶段触发条件呼应) |

**阶段划分综合评分:8/10。** 核心结构正确;PP6 三合一是最大不确定因素但 manageable。

---

## 2. 文档种类与分工合理性评估

### 2.1 8-design 数量合理性

| 维度 | initial 草案 | re-planning v1 | charter v0.active.1 | 我的判定 |
|---|---|---|---|---|
| Tier 1 reasoning(closing-thoughts / debt-matrix / 9-report-deferral)| — | 3 份 | **0 份**(都 absorb 进 charter §1-§2 或 HPX7 closure)| ✅ **合理省略** — debt 与 deferral 经 HPX7 重写后已无独立 governance 必要 |
| Tier 2 cross-cutting(truth-architecture / frontend-contract / honesty-contract / observability-baseline)| — | 4 份 | **2 份**(00-agent-loop-truth-model + 01-frontend-trust-contract)| ⚠️ **部分合理** — truth-architecture 与 frontend-contract 各保留 1 份是恰当的;但 honesty-contract 散进 §5/§10 可能让 6 truth gate 验证缺独立 anchor;observability-baseline 完全省略**是真损失**(详见 §5 B1) |
| Tier 3 per-phase(PP1-PP6 各 1)| — | 6 份 | **6 份**(02-07,每 phase 1 份)| ✅ **合理** |
| **总计** | 不明 | **13 份** | **8 份** | charter 比 re-planning 少 5 份,其中 3 份 absorb 进 charter 是 win,2 份(honesty-contract / observability-baseline)的 absorb 不够干净 |

**判定**:8 份 design 的数量本身合理,体现了"doc-as-contract not as-progress"原则(charter §5 第 6 条);但 observability-baseline 完全省略是**实质性损失**(详 §5 B1)。

### 2.2 Batch review 模式

charter §4.4 第 4 条:"本阶段的 review 采用 batch review,不采用逐文档 review 链"。

**判定**:**合理**。hero-to-pro 阶段有 4 家 review × 多份文档 → review 工作量爆炸的教训(参见 hero-to-pro charter §16.2 HPX2 / HPX3 处理这种成本)。本阶段以 truth gate 为对账单,review 的核心工作是验证 e2e + truth 而非逐文档审词。但需要 PP0 charter design `00/01` 的某一份**显式定义 batch review 的产出格式**,否则 batch review 容易退化为"作者自检"。

### 2.3 e2e-first 原则

charter §0.2 第 1 条 + §5.1 + §7.1 In-Scope 第 3 条 + §10.1 NOT-成功识别第 3 条共同 codify 了"PP0 必交首个真实 e2e skeleton"。**这是对 initial / re-planning 草案最有价值的修正**。

判定:**强采纳**。但建议 PP0 action-plan 内补一句"e2e skeleton 应选 HITL skeleton 优先(因为 PP1 是下一 phase),除非 owner 选 reconnect skeleton 优先"— 避免"PP0 选了 reconnect skeleton 但 PP1 启动时还得另起 HITL e2e"的 setup 成本浪费。

### 2.4 Action-plan / closure 文档清单(§13.2 / §13.3)

| 文档类 | 数量 | 判定 |
|---|---|---|
| Action-plan | 7 份(PP0-PP6 各 1)| ✅ 标准 |
| Phase closure | 7 份(PP0-PP6 各 1)| ✅ 标准 |
| Final closure | 1 份(`pro-to-product-final-closure.md`)| ✅ 标准 |
| Handoff stub | 1 份(`pro-to-product-to-platform-foundations-handoff.md`)| ✅ 与 hero-to-pro `plan-hero-to-platform.md` stub 体例一致 |

**判定**:符合 hero-to-pro 体例,无问题。

### 2.5 文档分工合理性综合评分

| 维度 | 评分 |
|---|---|
| 8 design 数量 vs 13 design 数量 | **8/10**(克制有度,但 honesty/observability 省略略激进) |
| Batch review 选择 | **9/10** |
| e2e-first 原则 | **10/10** |
| Action-plan / closure 体例 | **10/10** |
| Tier 1 reasoning docs absorb 干净度 | **8/10** |
| Tier 2 cross-cutting docs absorb 干净度 | **6/10**(observability 完全省略,honesty 散在 §5/§10) |
| Tier 3 per-phase docs 数量 | **10/10** |

**文档分工综合评分:7/10。** 8 design + batch review 是合理的 lean choice,但 §5 B1 的 observability baseline 缺失是真实漏洞。

---

## 3. 代码真相一致性核验(逐处验证)

### 3.1 §2.1 已成立的 shipped/frozen truth — 5 项核验

| 主题 | charter 引用 | 我的核验结果 | 判定 |
|---|---|---|---|
| HITL transport substrate | `session-do-runtime.ts:378-415` | 实际 `:378-415` 内是 `emitPermissionRequestAndAwait`(`:378-397`)+ `emitElicitationRequestAndAwait`(`:399-416`)+ `pushServerFrameToClient`(`:418-`)。Charter 引用范围**完全准确** | ✅ |
| Context probe substrate | `runtime-assembly.ts:292-324` | 实际 `:285-325` 是 `composeCompactSignalProbe` + `breaker = createCompactBreaker(3)` + `used >= limit`。Charter 引用 `:292-324` **完全命中** | ✅ |
| Runtime config public contract | `session-runtime.ts:129-207` | 实际 `:129-135 computeRuntimeEtag` + `:138-144 parseRuntimeRoute` + `:146-` `tryHandleSessionRuntimeRoute` 含 GET ETag(`:181-197`)+ PATCH If-Match(`:204-207`)。Charter 引用**完全命中**;HPX7 H6 closure 也确认此处已 land | ✅ |
| Replay persistence substrate | `session-do-persistence.ts:154-160` + `replay.ts:81-95` | `persistCheckpoint` `:142-187` 中 `:154-160` 调 `helper.checkpoint(helperStorage)` 写盘 — **完全命中**。`replay.ts:81-95` 是 `checkpoint`/`restore` 方法范围 — 命中。但 charter §2.2 G3 说"restore 路径不恢复 helper replay" — 我核验 `restoreFromStorage` `:193-222` **确实只恢复 teamUuid/userUuid/kernelFragment/turnCount/actorPhase**,**未调 helper.restore**;同时 persistCheckpoint 内 `:176` 写 `replayFragment: null` — **charter 描述 100% 准确** | ✅ |
| Hook substrate | `runtime-assembly.ts:155-160,191-196` | `:155-160` 是 `createSessionHookDispatcher()`(空 registry + LocalTsRuntime)— 命中。`:191-196` 是 `createMainlineKernelRunner` 注入 dispatcher 的注释 + `hookDispatcher` 字段 — 命中 | ✅ 措辞需精化(见 §3.4) |

### 3.2 §2.2 当前仍然存在的核心 gap — 5 项核验

| Gap | charter 引用 | 我的核验结果 | 判定 |
|---|---|---|---|
| G1 ask error-out | `runtime-mainline.ts:235-261` | `authorizeToolPlan` 在 `:235-261`;实际行为 `:252` `if (decision==="allow") return {allowed:true}`,`:253-261` 把 `ask`/`deny` 都包成 `tool-permission-required`/`tool-permission-denied` error。charter §2.3 错误前提 1 引用同一处 — **完全准确** | ✅ |
| G2 compact tokensFreed=0 | `runtime-mainline.ts:833-836` | 实际 `:833-836` 是 `compact: { async requestCompact() { return { tokensFreed: 0 }; } }` — **逐字命中** | ✅ |
| G3 replay buffer + throw | `replay.ts` + `restoreFromStorage` 不恢复 | 核验:`replay.ts:62-68` 仍 `throw new NacpSessionError([...], NACP_REPLAY_OUT_OF_RANGE)`;`restoreFromStorage` 内不调 `helper.restore` — **完全准确** | ✅ |
| G4 PreToolUse 不走 dispatcher | charter 描述但未引行号 | 核验:`emitHook` 真实调用站点共 6 处(`orchestration.ts:238/244/250/512` + `shutdown.ts:97/104`),全部为 lifecycle 事件,**没有任何 PreToolUse / PostToolUse / PermissionRequest emit**。`authorizeToolPlan` 仍走 `options.authorizeToolUse` RPC 而非 `hookDispatcher.emit` — **完全准确**(但精度要点见 §3.4) | ✅(精化) |
| G5 policy 字段未消费 + fallback 不可见 | charter 未引行号 | 核验:`workers/orchestrator-core/src/entrypoint.ts:345-372` 的 `authorizeToolUse` 仅消费 `permission_rules + approval_policy`,未消费 `network_policy/web_search/workspace_scope`;`workers/agent-core/src/llm/gateway.ts:281` `executeStream` 与 `workers-ai.ts:282-307` fallback chain 内部触发但不向上层抬出 `fallback_used` 字段 — **完全准确** | ✅ |

### 3.3 §1.2 已冻结的系统真相 — 5 项核验

| 主题 | charter 描述 | 我的核验 | 判定 |
|---|---|---|---|
| hero-to-pro 终态 | `close-with-known-issues / 4-owner-action-retained` | `hero-to-pro-final-closure.md:21` "**`close-with-known-issues / 4-owner-action-retained-with-explicit-remove-condition`**" — **完全一致** | ✅ |
| 28 absorbed within hero-to-pro | charter §1.2 第 1 行 | `hero-to-pro-final-closure.md:27` "**28 absorbed within hero-to-pro**" — 一致 | ✅ |
| 6-worker substrate | charter §1.2 第 2 行 | `hero-to-pro-final-closure.md:34` 一致 | ✅ |
| `/runtime` ETag/If-Match | charter §1.2 第 3 行 | `HPX7-closure.md:32` H6 "closed";代码核验 `session-runtime.ts:129-207` 实装 — 一致 | ✅ |
| 22-doc baseline | charter §1.2 第 5 行 | `HPX7-closure.md:66` `pnpm run check:docs-consistency` "✅ pass (22 docs pass 8 regex checks + 2 required-snippet checks)" — 一致 | ✅ |

### 3.4 1 处需精化:Hook substrate 描述精度

charter §1.2 + §2.1 + §2.2 G4 + §7.5 PP4 全部基于一个隐含前提:**"Hook substrate ready,但 production register source 0 + PreToolUse 不走 dispatcher"**。

**实际代码状态**:`grep "registry.register" workers/agent-core/src/`(排除 test):
- `hooks/snapshot.ts:50` — 1 处(snapshot restore 路径)
- `eval/durable-promotion-registry.ts:89/98/107/116/127/136/145/154/165/174/183/192/201/210/219/228` — **16 处**(production register,服务于 ContextPressure / ContextCompactArmed / PrepareStarted / Committed / Failed / EvalSinkOverflow + 自定义 evals)

**所以 charter 措辞略不精确**:**production register source 实际不为 0,只是 0 个用于 PreToolUse / PostToolUse / PermissionRequest 这类 user-driven hook**。

**影响**:
- §7.5 PP4 收口标准第 2 条 "至少一条 `register → emit → outcome → frontend visible + audit visible` 闭环成立" — 字面读取可被 eval-observability 已有的 ContextPressure register satisfy,但显然不是 PP4 的真实意图(PP4 真实意图是 PreToolUse 接通)
- 这条措辞在执行期可能被 deceptive closure 利用("我们已经 register PreCompact 了 → PP4 closed")

**建议修订**(§5 B4):charter §2.1 / §2.2 G4 / §7.5 收口标准都应**显式区分 user-driven hook(PreToolUse/PostToolUse/PermissionRequest)与 lifecycle hook(SessionStart 等)与 async-compact hook(ContextPressure 等已 register)三类**;PP4 的"production register source"特指**第一类的首个 source**。

### 3.5 代码真相核验综合

| 类别 | 核验项 | 准确率 |
|---|---|---|
| §2.1 5 项 substrate 引用 | 5 | **5/5 准确** |
| §2.2 5 项 gap 引用 | 5 | **5/5 准确** |
| §1.2 5 项已冻结真相 | 5 | **5/5 准确** |
| 措辞精度 | Hook substrate 三类区分 | **0/1 精度问题**(需修订 §2.1 / §2.2 G4 / §7.5)|

**代码真相一致性综合评分:9/10。** 核心引用全部准确;唯一精度问题在 Hook register 现状描述。

---

## 4. DDL 真相核验

### 4.1 当前 D1 migrations 真实清单

```
001-identity-core.sql
002-session-truth-and-audit.sql
003-usage-quota-and-models.sql
004-session-files.sql
005-user-devices.sql
006-error-and-audit-log.sql                       — 6 个 zero-to-real / real-to-hero 基线
007-model-metadata-and-aliases.sql
008-session-model-audit.sql
009-turn-attempt-and-message-supersede.sql
010-agentic-loop-todos.sql
011-session-temp-files-and-provenance.sql
012-session-confirmations.sql
013-product-checkpoints.sql                       — 7 个 hero-to-pro HP1 集中
014-session-model-fallback-reason.sql             — 1 个 HP1 closure 受控例外
015-tool-call-ledger.sql                          — HPX6 P3 新增
016-session-runtime-config.sql                    — HPX6 P3 新增
017-team-permission-rules.sql                     — HPX6 P3 新增
```

**总计 17 migrations**,其中 `015/016/017` 是 hero-to-pro 阶段的**HPX6 受控例外**(非 HP1 集中,charter §16.2 表格 HPX6 行已记录)。

### 4.2 charter 对 DDL 真相的覆盖度

charter §1.2 / §2.1 / §4.5 提到 DDL 共 3 处:

1. **§1.2 hero-to-pro 终态行**:写"workbench-grade backend substrate";未提具体 migration 编号
2. **§4.5 D1 freeze 例外**:"原则上 ≤ 5 列" + "对应 Phase 的 design doc 与 action-plan 显式登记此例外" + "owner / architect 在本 charter 或其修订版中明确批准"
3. **§13.1-13.3 文档清单**:无 DDL design doc

**问题**:**charter 没有显式给出 17 migration 的真实编号 anchor 与受控例外历史**(`014` 是 HP1 closure 后 HPX6 之前加的)。这意味着:

- PP3 受控例外若需要新 D1 migration,会编号为 `018`,但 charter 没说 17 是 anchor
- "对应 Phase 的 design doc 与 action-plan 显式登记此例外"— 但例外登记的体例(参考 hero-to-pro `HP1-closure.md` 的 `014` 登记方式)未说明
- 与 hero-to-pro charter §1.2 的"`R2 修订:实际仓库基线`"明确写"6 个 migration 文件,**最新编号 006**"形成对比 — hero-to-pro charter 把 anchor 写得更清晰

**判定**:**断点 B3**(详见 §5)— charter 应在 §1.2 加一条"当前真相:17 migrations,最新编号 017"的 anchor 行。

### 4.3 D1 freeze 例外的工程现实

charter §4.5 例外条件 5 条:① reconnect/dedup/detached recovery 三类之一 / ② ≤ 5 列 / ③ design+action-plan 登记 / ④ owner 明文批准 / ⑤ closure 登记 schema correction list。

**判定**:5 条都合理。但建议补 1 条体例约束:**"新 migration 编号继 `018` 起;不允许复用已有编号或跳号"**— 避免 PP3 / PP4 同时各开 migration 编号冲突。

### 4.4 DDL 真相核验综合评分

| 维度 | 评分 |
|---|---|
| migration 编号 anchor | **6/10**(charter 没写,需 v0.active.2 补)|
| 受控例外条款合理性 | **9/10** |
| 受控例外体例完整度 | **7/10**(缺编号约束)|

**DDL 真相综合评分:7/10。** 17 migration anchor 缺失是 PP3 启动前的小风险。

---

## 5. 识别出的盲点与断点

下面 4 个断点都不阻塞 charter 进入 active 状态,但建议 v0.active.2 修订一并补完。

### 5.1 B1 — Observability latency baseline 缺失(信息断点)

**事实**:Kimi review §9.2 提议 4 个用户感知 latency 阈值(confirmation interrupt ≤500ms / compact ≤3s / reconnect 重放 ≤2s / retry 首响 ≤1s)。Opus re-planning v1 §9.2 把它落到 Tier 2.7 `pro-to-product-observability-baseline.md`(独立 doc)。

**charter 现状**:**完全省略**。§9 测试与验证策略无 latency 阈值;§10 truth gate 只问"是否成立"不问"是否够快"。

**风险**:
- PP1 的 e2e 可以验证"confirmation pause-resume 路径通"但**无法判断"够快"** — 比如 confirmation 决策延迟 5s 实际通过 e2e 但前端体验崩溃
- PP3 reconnect 同理 — replay 决议正确但延迟 10s 等于不可用
- PP6 contract sweep 的"frontend trust"在缺 latency baseline 时**只是 functional trust 不是 perceptual trust**

**为什么 charter 没含**:
- 推测一:GPT 选择"truth-gate-first"原则,不愿让 latency 成为 over-prescription
- 推测二:GPT 把 latency 放进 PP6 contract sweep 的 sub-task(`07-api-contract-docs-closure.md`)中,但 §13.1 design 清单没明示

**修订建议**:
- **Option A(推荐)**:charter §9.2 表格新增 1 行 "Latency baseline" 类别,明示 4 个阈值;PP1/PP3/PP5 的 e2e 含 latency assertion
- **Option B**:加一份独立 design `08-observability-baseline.md`,与 GPT charter §13.1 8-design 列表对齐(变成 9 design)— 但违反 lean 原则
- **Option C**:写一句"observability latency baseline 在 PP6 design 内冻结"— 推迟决策但不丢失

我推荐 Option A — 在 charter §9.2 加 1 行 表格,几句话冻结 4 阈值,后续 phase action-plan 引用。

### 5.2 B2 — Frontend Engagement Schedule 缺失(协作断点)

**事实**:Kimi review §9.1 提议 6 时点 frontend 介入(PP0 lead 评审 / PP1 中期 mock 接入 / PP2 启动 / PP3 启动 / PP4 中期 / PP5 全程)。Opus re-planning v1 §7.6 把它列为 PP0 charter §13 必含。

**charter 现状**:**完全省略**。§3.1 一句话产出说"前端第一次可以真实依赖" — 命题正确,但没说"前端何时介入"。

**风险**:
- 前端如果 PP6 才介入,会发现 PP1-PP5 的 truth gate 设计不符合实际消费(frame 时序 / error handling / loading state)
- charter 自己 §0.1 说 "frontend trust" 是核心命题 — 但如果前端 lead 不参与 PP0 charter 评审,frontend trust 的定义只来自 backend 视角
- charter §10.1 truth gate T7 "Frontend contract truth" — 验收时谁判定"已对齐"?如果前端没全程介入,这条 gate 实际由作者 self-review

**修订建议**:**charter §6 或新增 §6.4 增加 Frontend Engagement Schedule 表格**,明确至少 3 个时点(PP0 lead 评审 / PP1+PP3 中期 mock / PP6 full integration test)。

### 5.3 B3 — DDL 真相 anchor 缺失(信息断点)

详见 §4。建议 charter §1.2 加一行:

```
| 当前 D1 migration 真相 | 17 migrations(`001-006` baseline + `007-013` HP1 集中 + `014` HP1 受控例外 + `015-017` HPX6 受控例外);最新编号 017 | 本阶段默认不新增;若 §4.5 例外触发,新 migration 编号继 `018` 起 |
```

### 5.4 B4 — Hook register 现状描述精度(措辞精度)

详见 §3.4。

**修订建议**:
- charter §2.1 第 5 行 "Hook substrate"行后,补一行:"Hook production register caller 现状:`eval/durable-promotion-registry.ts` 已 register 16 个 handler 服务于 ContextPressure / ContextCompact* / EvalSinkOverflow 6 个 Class D 事件;**user-driven hook(PreToolUse / PostToolUse / PermissionRequest)的 register 仍为 0**。"
- charter §2.2 G4 改为:"HookDispatcher 已注入,且 Class D async-compact 事件已有 16 个 production register handler;但 user-driven hook(PreToolUse / PostToolUse / PermissionRequest)的 register 仍为 0,且 PreToolUse 仍走 `authorizeToolUse` RPC 不走 dispatcher。"
- charter §7.5 PP4 收口标准第 2 条改为:"至少一条 **user-driven hook**(PreToolUse / PostToolUse / PermissionRequest 之一)的 `register → emit → outcome → frontend visible + audit visible` 闭环成立。"
- charter §10.1 truth gate T5 同样应限定为"至少一条 user-driven hook 回路"

不修这条,PP4 closure 时**有概率被 deceptive closure 利用**(指 Class D 的已存在 register 满足字面要求)。

### 5.5 4 个断点的综合优先级

| 断点 | 严重度 | 修订成本 | 是否必须在 v0.active.2 修 |
|---|---|---|---|
| B1 observability baseline | **高** | 中(加 §9.2 表格 + PP1/PP3/PP5 e2e 引用)| **是**(否则 frontend trust 不完整)|
| B2 frontend engagement | **中** | 低(加 §6.4 表格)| **是**(charter 自己说 frontend trust 是核心命题)|
| B3 DDL anchor | **低** | 极低(加 §1.2 一行)| **是**(防 PP3 受控例外编号冲突)|
| B4 Hook register 精度 | **中-高** | 低(改 4 处 措辞)| **是**(防 PP4 deceptive closure)|

---

## 6. 其他观察(非断点,但值得记录)

### 6.1 §11.2 下一阶段开启前提的理想化假设

charter §11.2 写"下一阶段开启前提:`pro-to-product` 至少达到 `close-with-known-issues`,7 truth gates 全部达到可验证绿灯"。

**观察**:hero-to-pro charter §11.2 的同位条款是"至少达到 `full close` 或 `close-with-known-issues`"— **同等克制**。但 hero-to-pro 实际终态 7-retained 转 4-owner-action 用了 HPX7 才接近达到此标准。pro-to-product 的"7 truth gate 全绿"门槛,**其严苛度高于 hero-to-pro 任一 phase**;如果 PP1 / PP2 中 compact 真实装(charter §7.3 主要风险)失败,pro-to-product 进入 "cannot close",触发又一轮"HPX7-style honesty uplift"的可能性不低。

**建议**:**charter §10.4 收口类型判定表第 3 行 `cannot close` 的"文档要求"加一条:"若 cannot close 是因 compact / interrupt / replay 中某 P0 不可行,允许 owner 决定是否触发 `pro-to-product-HPX-N` 或独立 productization-revisit phase"** — 给未来余地。

### 6.2 §12 决策清单只有 3 项

charter §12 Owner / Architect 决策区只有 Q1(policy enforce vs downgrade)/ Q2(PP4 minimal scope)/ Q3(PP6 scan boundary)三个问题。Opus re-planning v1 §12 提了 10 个问题。

**判定**:GPT charter 选择"已默认决断,不再 reopen"的姿态 — 这是合理的(Q4/Q5/Q6 在 §1.1 D1 已 owner 决议)。**但 Q5'(Tier 2 cross-cutting design 是 PP0 必交付,还是允许部分推迟)在 charter 内未显式回答**:§7.1 In-Scope 第 2 条说 "00/01" 在 PP0 内交付,但 §13.1 列了 8 design,02-07 是否也算 PP0 必交付?推测意图是"02 在 PP1 启动前 frozen,03 在 PP2 启动前 frozen..." 但 charter 没明说。

**建议**:charter §13.4 建议撰写顺序内补一句"per-phase design(02-07)采取 just-in-time 模式,在对应 phase 启动前 frozen,而非 PP0 内全产出"— 与 charter §0.2 第 1 条 "phase-first not doc-first" 一致。

### 6.3 §3.2 一句话非目标的覆盖度

charter §3.2 "不是 multi-provider / sub-agent / admin / billing / SDK extraction / sandbox / WeChat 完整产品化的阶段"。

**对比 Opus re-planning v1 §8.2 推迟清单**:11 项(含 Skills / Browser Rendering / Memory / Cost-tracker / Plugin/MCP / Virtual Git 等)。

**判定**:charter §3.2 + §4.2 O1-O5 共 6 项排除清单与 11 项基本对应:Skills / Memory / Cost-tracker / Plugin/MCP / Virtual Git / Browser Rendering 散见于 §4.2 O1-O5 或隐含在 "更完整的 hook catalog / 多端专项";**但 Skills 没显式提**。在 owner Memory 中 Skills 是已知项,charter 不提是 acceptable。

### 6.4 §5 方法论与 hero-to-pro charter §5 的承袭

hero-to-pro charter §5 7 条方法论(状态机优先 / DDL 集中 / 文档晚期收口 / chronic explicit-only / wire-with-delivery / deception-flag / owner-action explicit)。

charter §5 6 条方法论(live-caller-first / e2e-first / truth-gate-first / minimal-loop-first / verification-first on residuals / doc-as-contract not as-progress)。

**判定**:**承袭关系正确**。`live-caller-first` 是 hero-to-pro `wire-with-delivery 不算闭合` 的衍生;`truth-gate-first` 是 `chronic explicit-only` 的衍生。charter §5 6 条比 hero-to-pro §5 7 条更精炼,体现 productization 阶段的命题更窄。

---

## 7. 最终判定

### 7.1 charter v0.active.1 的工程价值

| 维度 | 判定 |
|---|---|
| **方向**(命题转换 + 7 phase + 7 truth gate) | **正确,可作为 active baseline** |
| **代码真相一致性** | **9/10**(20+ 处引用全部准确,1 处措辞需精化)|
| **DDL 真相一致性** | **7/10**(17 migration anchor 缺失,需补 1 行)|
| **阶段划分合理性** | **8/10**(7 phase 切分合理;PP6 三合一是大胆但 acceptable 选择)|
| **文档分工合理性** | **7/10**(8 design 克制有度,但 observability/honesty cross-cutting 整合不够干净)|
| **闭环判定标准准确性** | **9/10**(7 truth gate 取代功能自述是核心 win)|
| **盲点数量** | 4 个非阻塞断点(B1-B4),建议 v0.active.2 一次补完 |

### 7.2 charter 是否能合理与准确构建本阶段收口结论?

**判定**:**能**,前提是补完 4 个断点。

**理由**:
1. 7 truth gate(§10.1)是阶段收口的硬闸,且每条 gate 都对应**一个具体 e2e 验证场景**(charter §9.4 6 条不允许宣称的内容直接镜像 truth gate)。这意味着 final closure 时只要逐 gate 跑 e2e 就能产出真实 verdict,不会出现 hero-to-pro 早期"功能在但 caller 不在"的 deceptive closure。
2. PP6 contract sweep 的存在意味着 docs truth 与 code truth 的对账有专门 phase,不会被推迟到 final closure 仓促执行。
3. §10.4 三种收口类型(`full close` / `close-with-known-issues` / `cannot close`)体例与 hero-to-pro §10.4 完全一致,且 §10.3 NOT-成功识别 4 条具体可判定。
4. §13.3 closure 文档清单标准(7 phase closure + 1 final closure + 1 handoff stub)与 hero-to-pro 体例一致,确保 final closure 不会缺证据链。

**唯一的"不能合理构建"风险**:
- **如果 B1 observability baseline 不补**,T7 "Frontend contract truth" 在 functional 层通过但 perceptual 层未验证(latency 不达标也算 truth gate 绿)
- **如果 B4 Hook register 精度不修**,T5 "Hook truth" 可能被已存在的 16 个 Class D register 字面 satisfy 而 user-driven hook 仍未接通
- 这两条都会让 final closure 出现"truth gate 全绿但前端实际不可用"的反 closure 风险

补完 B1 + B4 后,charter 可以可靠地构建 final closure 结论。

### 7.3 推荐操作(给 owner)

**Step 1**(立即):charter v0.active.2 修订 — 补 4 个断点(B1 + B2 + B3 + B4)。修订量 ≤ 50 行,工作量 1-2 小时。

**Step 2**(PP0 启动前):
- 写 `00-agent-loop-truth-model.md`(承担 truth-architecture 职责)
- 写 `01-frontend-trust-contract.md`(承担 frontend-contract + 前端介入 schedule + observability latency baseline)
- 选 HITL skeleton 作为 PP0 必交 e2e
- 与前端 lead 评审 charter v0.active.2(B2 修订后会显式列出此点)

**Step 3**(PP1 启动后):每 phase action-plan + design 在该 phase 启动前 frozen,采用 batch review(对照 truth gate 不对照 design 文本)。

### 7.4 一句话定论

> **`plan-pro-to-product.md` v0.active.1 是一份方向准确、克制有度的 charter,可以作为 active baseline 进入 PP0;补完 B1(observability latency baseline) + B2(frontend engagement schedule) + B3(DDL migration anchor)+ B4(Hook register 精度)4 个断点后,它能够合理与准确地构建本阶段的收口结论 — 通过 7 truth gate + e2e-first + minimal-loop-first 把"功能完成 ≠ 前端可信"这条 hero-to-pro 反复出现的反模式在阶段纪律层面 codify 出去,使 nano-agent 第一次具备一个**前端可真实依赖、且 closure verdict 不能被 deceptive 的 productization 阶段**。**

---

## 维护约定

1. 本审查报告基于 charter v0.active.1 + 当前仓库代码(commit pre-`PP0`);若 charter 升级到 v0.active.2 含 4 个断点修复,本审查的 §5 / §7.3 应同步更新为"已采纳"。
2. 本审查不替代 batch review — charter §4.4 第 4 条规定的 batch review 应在 PP0 内由 owner 组织。
3. 若 owner 不接受本审查 §5 任一断点修订,应在 charter v0.active.2 修订历史中显式说明 not-adopted reasoning,保持决策 trail。
