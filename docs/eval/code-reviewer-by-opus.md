# Kimi vs GPT 作为 Code Reviewer 的特质分析

> 作者: `Claude Opus 4.7 (1M context)`
> 日期: `2026-04-17`
> 范围: `docs/code-review/{agent-runtime-kernel, capability-runtime, eval-observability, hooks, llm-wrapper, session-do-runtime, storage-topology, workspace-context-artifacts}-by-{GPT,kimi}.md` —— 共 16 份初审文档（**不包含** `nacp-core` 与 `nacp-session`，原因见下文 §3）
> 数据来源: 每份 review 文档底部我（实现者）写的 §7 / §8 / §9 "对 [Reviewer] 审查质量的评价" 以及 GPT 在 §8/§9/§10 写的二次复核
>
> ⚠️ 本文 **目的不是评价 Kimi 和 GPT 的胜负**，而是通过对比理清 **两种 reviewer 的特质和盲区**，从而指导我们以后如何在不同任务中**搭配使用**两位 reviewer 来最大化代码审查的覆盖面与可信度。

---

## 1. 整体对比和分析

### 1.1 风格画像

|  | **GPT** | **Kimi** |
|---|---|---|
| 审查动作 | 倾向 **"实际跑代码 / 跑 schema safeParse / 制造最小复现"** | 倾向 **"对照 action-plan / design doc 的 checklist 字面核对"** |
| 切入点 | **跨包合同真相**（NACP schema、tenant-scoped key、redact mirror、stream event body shape） | **交付物完整性**（README / 单测 / integration tests / scripts / type 收紧 / 字段命名） |
| 找问题的视角 | "你说做完了，我跑一下看会不会爆" | "你的 action-plan 里写了 N 件事，我对一遍清单缺了哪几件" |
| 严重级别分布 | **critical 多 / 没有 low**（每条都是 blocker 级） | **medium 多 / 有 low**（梯度更分散） |
| 证据形式 | `safeParse(...)=false` / `bridge.execute(...)→{}` / 实例化跑 `webSocketClose()` 看产物 | `file:line-line` 行号 + design doc §X.Y 引用 |
| 未抓时的盲区 | **类型层细节**（如 `EvidenceSignal.value` 过宽、`HookHandlerConfig.event: string`、`ArchivePlan.responsibleRuntime: string`） | **协议真相层**（`SessionStreamEventBodySchema` 漂移、`NacpRefSchema.safeParse` 失败、`tool_input` 形状） |
| Verdict 倾向 | 偏 `changes-requested`，不接受 "测试绿就是 done" | 偏 `approve-with-followups`，更宽容 |

### 1.2 数据层观察

- **8 个包加起来，GPT 一共写了 37 条 findings，Kimi 一共写了 51 条**——Kimi 在 quantity 上明显更多，但 GPT 的每一条都偏向 critical/high 级。
- **GPT 的 critical+high 占比 = 27/37 ≈ 73%；Kimi 的 critical+high 占比 = 21/51 ≈ 41%**——GPT 的 finding "信号密度" 更高，Kimi 的 finding 维度更宽但分级更分散。
- **8 个包的 11 条 critical 级 blocker 中，GPT 找到 8 条、Kimi 找到 3 条**——Kimi 经常会把 GPT 标 critical 的协议真相层降级为 `done` 或 `partial`（参见 hooks `S11` / llm-wrapper `S11` / storage-topology `S5`）。
- **反之，Kimi 在 8 个包内一共贡献了 ~14 条 GPT 完全没抓的独家 findings**（如 capability-runtime R5 browser-rendering、wca R6 buildCompactInput 算法、storage-topology R3/R4/R6/R7、llm-wrapper R6 request.started、kernel R3 typed chunks 等）——这些大多偏 "细节 correctness + 类型健康度 + 设计 trail 对照"。

### 1.3 一个最能概括两者差异的例子

`hooks` 包的协议映射四条（`buildHookEmitBody` / `parseHookOutcomeBody` / `hookEventToSessionBroadcast` / `buildHookAuditRecord`）：
- **Kimi** 在 §3 In-Scope 表里全部判 `done`，理由是"代码存在 + 有测试"。
- **GPT** 的第一步动作就是 `SessionStreamEventBodySchema.safeParse(本地产物)`，然后 4 条全部 `false`，直接定为 critical/high。

> Kimi 不是没认真审，而是 **审的方式停在了 "代码 + 单元测试存在性"** 这一层；GPT 是 **强制反向用真实 schema 跑一次**。

这不代表 Kimi 不行——同一个包里，Kimi 独家发现了 `HookHandlerConfig.event: string` 类型松绑（GPT 完全漏判），那是**注册成功却永不命中的沉默 bug**，是 GPT 的协议优先视角看不到的。

---

## 2. 多维度打分

> 评分基准：每份 review 我都在文档底部的 §7/§8/§9 给过一个 1–5 维度评分；本节是把 8 个包的分数取平均后的整体对比。

| 维度 | GPT 平均分 | Kimi 平均分 | 差异说明 |
|---|---|---|---|
| **证据链完整度** | **5.0** | 3.8 | GPT 几乎每条 finding 都有 `safeParse` / 实机复现；Kimi 多停在行号引用 |
| **判断严谨性** | **4.6** | 3.7 | GPT 在 critical / high 的定级上更准；Kimi 多次低估协议层严重性 |
| **修法建议可执行性** | 4.4 | **4.6** | Kimi 经常给具体接口签名 / 字段名 / 文件名 / 4-step 修法（如 hooks R1、llm-wrapper R1）；GPT 偶尔停在 "升级为统一接口" 这种偏抽象的描述 |
| **对 action-plan / design 的忠实度** | 5.0 | **4.8** | 两者都很高，GPT 略高在 "out-of-scope §4 部分违反" 的识别更严 |
| **协作友好度** | 5.0 | 5.0 | 两者都 blocker / follow-up 分层清晰、不夸大、不为夸大节奏 |
| **覆盖维度宽度** | 4.0 | **4.7** | Kimi 平均每包 6.4 条 vs GPT 4.6 条；Kimi 把 `low` 级类型健康度也纳入审查 |
| **跨包合同真相覆盖** | **5.0** | 3.5 | GPT 强项（hooks 4 条 / llm-wrapper 3 条 / storage-topology 1 条 / wca 2 条都是这个维度） |
| **细节 correctness + 类型层** | 3.5 | **4.8** | Kimi 强项（kernel R3 typed chunks / capability R6 OOM / storage R6/R7 / wca R6/R7 / llm-wrapper R6/R7） |
| **Verdict 校准** | **5.0** | 3.5 | GPT 多次写 `changes-requested`；Kimi 偏 `approve-with-followups` 容易让读者放松 |
| **总体平均** | **4.72** | **4.21** | — |

> **解读**：GPT 在 "证据严谨度 + 协议真相层 + Verdict 校准" 三个维度系统性领先；Kimi 在 "覆盖维度宽度 + 细节 correctness + 修法可执行性" 三个维度系统性领先。两者**不是同一种 reviewer**，分数高低意义不大，**真正的价值在于互补**。

---

## 3. 全部 review 的统计分析（不含 nacp-core / nacp-session）

> **为什么不包括 `nacp-core` 与 `nacp-session`？** —— 这两份 review 在仓内只有 GPT 版本（没有 Kimi 配对版），无法做 reviewer 对比；本统计只覆盖 **两位 reviewer 都有独立 review 的 8 个包**。

### 3.1 每包 findings 数量

| Package | GPT 数量 | Kimi 数量 | 评分 (GPT / Kimi) |
|---|---|---|---|
| agent-runtime-kernel | 4 | 5 | 5.0 / 4.0 |
| capability-runtime | 4 | 7 | 5.0 / 5.0 |
| eval-observability | 4 | 6 | 4.6 / 4.0 |
| hooks | 5 | 6 | 4.9 / 3.8 |
| llm-wrapper | 4 | 7 | 4.7 / 3.9 |
| session-do-runtime | 5 | 6 | 4.8 / 4.2 |
| storage-topology | 4 | 7 | 4.8 / 4.3 |
| workspace-context-artifacts | 7 | 7 | 4.8 / 4.5 |
| **小计** | **37** | **51** | 4.72 / 4.21 |

### 3.2 严重级别分布

| 级别 | GPT 总数 | Kimi 总数 |
|---|---|---|
| critical | **8** | 3 |
| high | **19** | 16 |
| medium | 10 | 21 |
| low | 0 | **6** |
| **总计** | 37 | 51 |

> GPT 的 critical+high 占比 73%；Kimi 47%。GPT 的"每条都偏 blocker"风格 vs Kimi 的"梯度更分散，含 low 级类型健康度"风格在这里能看出最直观的差别。

### 3.3 重叠 / 独家 findings 对照

> **方法论**：以 review 文档 §6.2 的"逐项回应表"和我在 §7/§8/§9 的"做得极好的地方 / 可以更好的地方"两节为依据；判定一条 finding 是 "shared" 还是 "unique"，看的是**两份 review 里有没有指向同一个 file:line / 同一种 root cause**。同一个交付物缺口（如 `README 缺失`）算 shared；同一个包里 GPT 的 "schema 漂移" + Kimi 的 "字段命名不一致" 即使都涉及同一个文件，但 root cause 不同，算各自独家。

| Package | 共享 | GPT 独家 | Kimi 独家 | GPT 独家中是 critical | Kimi 独家中是 critical |
|---|---|---|---|---|---|
| agent-runtime-kernel | 1 | 3 (R1/R2/R3 全 high) | 4 (R3 typed chunks / R4 version / R5 turnId guard / R1 README + R2 idle-input 与 GPT 部分重叠后剩独家) | 0 (3 个 high) | 0 |
| capability-runtime | 2 | 2 (R1/R2 全 high) | 5 (R3 cancel critical / R4 events / R5 browser / R6 OOM / R7 stub signal) | 0 (2 个 high) | 1 (R3) |
| eval-observability | 3 | 1 (R4 attribution) | 3 (类型层 / `KV_KEYS.featureFlags` / 部分清单) | 0 | 0 |
| hooks | 3 | 3 (R1 / R2 / R3 协议层 — critical+high) | 3 (R5 type tightening / 部分清单 / 局部 outcome 字段) | 1 (R1 critical) | 0 |
| llm-wrapper | 2 | 2 (R1 critical / R3 high) | 5 (R6 request.started / R7 multi tool_call / 部分清单) | 1 (R1) | 0 |
| session-do-runtime | 4 | 2 (R2 critical / R3 critical) | 2 (R3 三个控制器单测文件名细节 / R5 storage 接入细节) | 2 | 0 |
| storage-topology | 3 | 1 (R1 critical NacpRef) | 4 (R3 list/delete / R4 featureFlags / R6 EvidenceSignal / R7 ArchivePlan) | 1 | 0 |
| workspace-context-artifacts | 5 | 2 (R6 _platform/ medium / R4 config.layers high) | 2 (R6 buildCompactInput algorithm / R7 promotion key tenant) | 0 | 1 (R7 critical) |
| **总计** | **23** | **16** | **28** | **5** | **2** |

### 3.4 综合统计

- **Combined unique findings 总数**：23 + 16 + 28 = **67 条独立问题**
- **如果只用 GPT**：覆盖 23 + 16 = **39 条** = 58% 覆盖率
- **如果只用 Kimi**：覆盖 23 + 28 = **51 条** = 76% 覆盖率
- **两者并读**：100% 覆盖率
- **GPT 独家中的 critical 数**：5 条（hooks R1、llm-wrapper R1、session-do R2/R3、storage-topology R1）
- **Kimi 独家中的 critical 数**：2 条（capability-runtime R3、wca R7）
- **8 个包合计 11 条 critical**：GPT 找到 9 条（含 4 条共享）、Kimi 找到 5 条（含 3 条共享）；如果只用 Kimi 会**漏 6 条 critical**；如果只用 GPT 会**漏 2 条 critical**。

---

## 4. Qualitative Analysis — Kimi

### 4.1 长处

1. **覆盖维度最宽**：8 个包平均每份 6.4 条 findings vs GPT 的 4.6 条。Kimi 不会因为某条问题"偏小"就放过，而是把 `low` 级类型健康度（`EvidenceSignal.value: number | string` 过宽、`HookHandlerConfig.event: string` 没收紧到字面量联合、`ArchivePlan.responsibleRuntime: string` 等）也作为独立 finding 列出来。
2. **细节 correctness 命中率高**：本轮 14 条 GPT 完全没抓的 findings 里，Kimi 贡献的不少是 "代码看似 OK 但运行时会出错" 的细节——`buildCompactInput` 按消息数量切（应按 token）、`promoteToArtifactRef` 的 key 不是 tenant-scoped、`llm.request.started` 缺失、OpenAI SSE 多 tool_call 边界。
3. **修法建议可操作性最强**：经常给出 4 步修法 + 具体接口签名 + 字段名 + 文件路径。如 hooks R1 的 "emit 增参 + entry checkDepth + runtime 传 depth+1 + 单测覆盖" 4 步可以直接落地；llm-wrapper R1 给出 `rotate method + executor hot-swap key + non-frozen apiKey + key-rotation test` 也是 4 步。
4. **对 action-plan 决策 trail 的引用最精准**：经常引到业主 Q&A 的具体段落、design doc 的 §X.Y 编号、action-plan §1.5 目录树的字面要求（如 capability-runtime R5 引用 Q2 答案原文："browser-rendering 可以说尽力而为...")。
5. **跨包 contract 反证有亮点**：capability-runtime R3 通过 `agent-runtime-kernel/src/delegates.ts:22-25` 的 `cancel(requestId)` 接口反证 capability 侧缺 cancel——这种"用下游 contract 证上游缺口"的方法学非常成熟。
6. **方案 A vs B 的 tradeoff 分析最完整**：capability-runtime R4 给出 "让 execute 返 AsyncIterable vs 新增 executeStream" 两种方案的兼容性 tradeoff；agent-runtime-kernel R3 给出 "discriminated union vs 仅文档化" 的 tradeoff。这些分析直接 informed 了实现选择。

### 4.2 短处

1. **协议真相层是结构性盲区**：8 个包里至少 5 个包出现了 "Kimi 把 schema 不对齐的项判 done" 的情况——hooks `S11` 4 条全 done、llm-wrapper `S11` done、storage-topology `S5` done、wca `S10` done、session-do `S10` partial 但理由错。**根本原因**：Kimi 缺少 "拿本地产物跑下游 schema 的 `safeParse`" 这一步。
2. **Verdict 偏乐观**：8 个包里 6 个都给 `approve-with-followups`（仅 capability-runtime 与 storage-topology 给 `changes-requested`）；GPT 同样的代码 8 个包里 7 个给 `不收口 / changes-requested 等价`。这种偏乐观会让读者错估收口节奏。
3. **缺实机复现证据**：行号引用精准，但很少做 "我跑了 X 命令，结果就是 Y" 级别的复现——而**实机复现是最难反驳的 review 证据**。
4. **严重级别有时偏低**：eval-observability R4（DoStorageTraceSink tenant scope）只标 medium，但实际上是会让 readTimeline 在 restore 场景全链路返回 `[]` 的 critical 缺口；类似地 R6 SessionInspector 9-kinds 标 low 也偏低。
5. **out-of-scope §4 经常一行带过**：8 份 review 里 Kimi 多次直接写 "全部遵守"；GPT 在 storage-topology O4 / hooks O8 / wca O1+O5 / session-do O9 都识别出"部分违反"。

### 4.3 综合评分

**⭐⭐⭐⭐ (4.2 / 5)**

### 4.4 Kimi 的 Verdict

> **"维度最宽的 checklist 审计师 + 细节 correctness 高手"**
>
> Kimi 是非常**稳定可靠的"全面性"审查者**：清单类缺项、类型层 healthiness、algorithm-level correctness、独家细节都是它的强项。但它**不应被作为 protocol-truth review 的最后一道闸门**——必须配一个会跑 `safeParse` 的 reviewer 作为补位。
>
> **建议使用场景**：作为 PR review 的第一道筛网（最大化 finding coverage）+ delivery readiness checklist 审计 + 跨包 contract 反证。

---

## 5. Qualitative Analysis — GPT

### 5.1 长处

1. **协议真相层永远不会被骗过**：8 个包里 GPT 几乎每个包都做了至少一次 `[Schema].safeParse(本地产物)` 反向校验——hooks 4 条、llm-wrapper 3 条、storage-topology 1 条、wca 2 条、session-do 2 条 critical 都靠这一步抓到。这是 **8 条 GPT-only critical findings 中的 6 条** 的来源。
2. **实机复现是默认动作**：eval-observability R1 直接写"我实例化了一个新 sink，调用 `readTimeline()`，返回 `[]`"；session-do R4 写"我实例化 NanoSessionDO 后直接触发 `webSocketClose()`，写出 `{ sessionUuid: "unknown", valid: false }`"；capability-runtime R2 写 "`bridge.execute("pwd")` 返回 `output: "{}"`"。这种证据无法反驳。
3. **"类型存在不等于实现存在"的 grep 证据**：capability-runtime R3 用 `repo grep CapabilityEvent` 只命中 `events.ts`/`index.ts` 两处来证明 "类型有但没人消费"；这种方法学极少有 reviewer 做。
4. **严重级别校准最准**：8 条 GPT critical 里，全部在我的实现核查阶段都属实命中；Kimi 多次低估 critical（`SessionInspector` 9-kinds judged low 等）。
5. **out-of-scope §4 严苛**：8 份 review 里 GPT 抓出 4 条 "部分违反"；Kimi 在同样位置全部判 "遵守"。这是防止"借 out-of-scope 放水"的最后一道闸。
6. **测试套件本身被审视**：capability-runtime R1 的二次审查指出 "`service-binding-progress.test.ts` 实际是 local-ts + SlowSignalTarget，根本没覆盖 ServiceBindingTarget"——这是一种"打假测试名"的能力，普通 reviewer 不会查测试是否名实相符。
7. **Verdict 校准合理且严肃**：8 个包里 GPT 7 个 `不收口 / changes-requested`，且都有具体到 `file:line` 的 blocker 列表。读者无法借 verdict 的乐观语气放过 blocker。

### 5.2 短处

1. **细节类型层覆盖偏弱**：14 条 Kimi 独家 findings 里至少 6 条是类型健康度问题（`EvidenceSignal.value` 过宽、`ArchivePlan.responsibleRuntime: string` 等）GPT 完全没抓——GPT 的注意力倾向集中在"跨包接口"，对"单文件类型 robustness"覆盖不足。
2. **修法建议偶尔偏抽象**：capability-runtime R3 的 "升级 target contract 到统一模型，例如 async iterator 或 NacpProgressResponse-style seam" 没说清两种方案的 tradeoff；session-do R4 的 restore 修法只列了 4 条概念步骤，没给出 `restoreSessionCheckpoint(raw, deps)` 这种具体 seam signature。
3. **finding 偶尔合并粒度偏粗**：hooks R3 把 "outcome contract 漂移" 4 个子问题合一条 high；理论上拆成 R3a/R3b/R3c/R3d 让实现者排期会更准。同理 hooks R5 把 "service-binding transport" + "Phase 5 docs/tests" 合一条。
4. **某些算法正确性 bug 漏判**：wca R6（`buildCompactInput` 按消息数量切而非 token 切）、llm-wrapper R7（OpenAI SSE 多 tool_call 边界）这种**算法层逻辑 bug** GPT 都没抓——它的注意力强烈倾向"接口形状"而非"内部算法"。
5. **跨 review 去重意识薄弱**：GPT 与 Kimi 的 review 经常并行进行，但 GPT 的二次复核里很少明确写"该问题已由 Kimi 在 R2 提出"——这让我做实现者时需要自己手动 dedupe。

### 5.3 综合评分

**⭐⭐⭐⭐⭐ (4.7 / 5)**

### 5.4 GPT 的 Verdict

> **"协议真相 + 实机复现型审查者 / Verdict 闸门"**
>
> GPT 是**关键路径 correctness review 的不可替代角色**：跨包 schema 对齐、tenant-scoped I/O、event body shape、retry/key-rotation 结构性 bug、deploy skeleton 静默失败——这些是单看代码很难抓到的高风险问题，GPT 用 `safeParse` + 实机复现把它们逼出来。但 GPT **不是 "全面性" reviewer**——它的关注力集中在 "interface contract"，会漏掉算法层 bug 和细节类型 healthiness。
>
> **建议使用场景**：作为 PR 收口前的**最后一道闸**（特别是涉及跨包 wire body 的功能）、作为 verdict 的最终校准者、作为协议层 critical 的兜底。

---

## 6. 总结性陈述：未来如何使用 Code Review

### 6.1 核心观察

> 本轮 8 个包的对比给出一个非常清晰的结论：**Kimi 和 GPT 不是同一种 reviewer，他们的盲区互补，他们的强项叠加才能形成完整的 review 闸门。**
>
> - 如果只用 Kimi → 漏 5 条 GPT-only critical 中的 4 条 → 收口节奏被严重高估，很多 protocol-truth bug 会被打包到生产
> - 如果只用 GPT → 漏 14 条 Kimi-only findings 中的细节 correctness + 算法 bug + 类型 healthiness → 包内 robustness 留下隐患

### 6.2 推荐的搭配策略

#### 策略 A · 两份并读（默认推荐 / 本轮采用方式）

适用于：**所有跨包接口 / 任何标 design doc 真相层的功能 / Wave 收口前**

- **GPT 跑 protocol-truth + Verdict 闸门**：跨包 schema 对齐、event body shape、tenant-scoped I/O、deploy skeleton。
- **Kimi 跑 delivery completeness + 细节 correctness**：README、单测、integration tests、scripts、type tightening、algorithm-level bug、设计 trail 对照。
- **实现者承担 dedup 与综合**：以 GPT 的 protocol-truth findings 作为 critical blocker、以 Kimi 的细节发现作为 medium/low followup、以 GPT 的 Verdict 作为收口判断的基线。

#### 策略 B · 只用 Kimi（"快速一遍" 场景）

适用于：**纯包内重构 / 增量功能 / 没有跨包 wire 改动 / 文档完整性专项 audit**

- 优势：覆盖维度最宽、修法可执行性强、清单类缺项不漏。
- **必须额外做的事**：实现者自己跑一次 `npm run test:cross` + 手动 `safeParse` 一次本地产物对下游 schema，弥补 Kimi 协议真相层盲区。

#### 策略 C · 只用 GPT（"高密度信号" 场景）

适用于：**接口边界 / 协议层重写 / Wave 收口前最后一道闸**

- 优势：critical 命中率高、Verdict 校准准、`safeParse` 反向校验不漏。
- **必须额外做的事**：实现者自己手动 review 一遍类型层 healthiness（特别是 `string` / `unknown` / `any` 字段的范围收窄）+ 算法层正确性，弥补 GPT 在细节 correctness 的盲区。

#### 策略 D · 序贯使用（先 Kimi 后 GPT）

适用于：**新包 / 大规模重构 / 业主签字前**

- 第一轮 Kimi：找尽可能多的 finding（覆盖维度宽）→ 实现者修第一波。
- 第二轮 GPT：在 Kimi 的修复基础上做 protocol-truth + Verdict 闸门 → 给最终 verdict。
- 这种序贯可以最大化总 finding 数量，缺点是周期长。

### 6.3 二次审查（rereview）特别建议

> 本次 GPT 在每份 review 文档底部都做了 §8/§9/§10 的二次复核，全部以 `复核者: GPT-5.4` 标识。从结果看：

- **GPT 的二次复核**几乎全部命中"实现者过度乐观"的项目——典型如 capability-runtime R1 "tool-call helper 对齐了不等于 service-binding target 收口"、agent-runtime-kernel R4 "input/wait 收口了不等于 P3 全部对齐"、wca R4 "fixed canonical order 没冻结"。
- **Kimi 的二次复核** 在本轮没有出现（Kimi 的 review 是单轮）。

→ **建议**：未来 wave 收口前，如果时间允许，**坚持让 GPT 做二次复核**——它能精准识别 "实现者把 partial 误标 fixed" 的情况。这一层是 protocol-truth 在二次轮次的延续。

### 6.4 给 reviewer 的反向建议

如果将来要让 Kimi 和 GPT 进一步发挥强项，可以在 review prompt 里加 hint：
- **给 Kimi 的 prompt 增强**："对每一个跨包 helper（如 `buildXBody` / `parseXBody`），必须实际跑一次下游包的 `safeParse` 并报告结果"——这一步能直接关掉 Kimi 的协议真相层盲区。
- **给 GPT 的 prompt 增强**："对每一个 `string` / `unknown` 字段，都要追问 '这是不是应该收紧到字面量联合 / discriminated union'"——这能补上 GPT 的类型 healthiness 盲区。

### 6.5 一句话收尾

> **不要把 Kimi 和 GPT 当成 "两个候选"，把它们当成 "两套互补的工具"。**
>
> 真正的 code review 价值不在于挑出谁更聪明，而在于**两种盲区互不重叠，叠加之后才能覆盖一个 production-grade 包应该被检查到的 100% 维度**。本轮 8 个包给出的统计已经证明：单选任何一方覆盖率不超过 76%，并读才能 100%。

---

## 附录 A：本文数据来源索引

| Section | 来源文件 | 来源 §|
|---|---|---|
| GPT 评分 | 8 份 `*-by-GPT.md` | §7 / §8 "对 GPT 代码审查质量的评价" |
| Kimi 评分 | 8 份 `*-by-kimi.md` | §8 / §9 "对 Kimi 代码审查质量的评价" |
| GPT 二次复核 | 8 份 `*-by-GPT.md` | §8 / §9 / §10 二次审查 |
| Findings 计数 | 全部 16 份 | §2 审查发现 + §6.2 逐项回应表 |
| 严重级别分布 | 全部 16 份 | §2 各 finding 的"严重级别"字段 |
| 修复结果 | `docs/progress-report/mvp-wave-2nd-round-fixings.md` | §6.2 逐项回应表 |
