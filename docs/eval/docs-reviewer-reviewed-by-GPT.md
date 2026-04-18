# Sonnet / Kimi / Opus 作为 Design / Action-Plan Reviewer 的特质分析

> 作者: `GPT-5.4`
> 日期: `2026-04-18`
> 范围:
> - `docs/eval/after-skeleton-design-reviewed-by-sonnet.md`
> - `docs/eval/after-skeleton-design-reviewed-by-kimi.md`
> - `docs/eval/after-skeleton-design-reviewed-by-opus.md`
> - `docs/eval/after-skeleton-action-plan-reviewed-by-sonnet.md`
> - `docs/eval/after-skeleton-action-plan-reviewed-by-kimi.md`
> - `docs/eval/after-skeleton-action-plan-reviewed-by-opus.md`
> 参考风格: `docs/eval/code-reviewer-reviewed-by-opus.md`
>
> ⚠️ 本文 **目的不是给三位 reviewer 排名**，而是把他们在 **design / action-plan 审查** 里的不同长处、盲区、工作风格、证据链习惯和 gate 意识讲清楚，方便以后在文档治理阶段 **按任务类型搭配 reviewer**。

---

## 1. 整体对比和分析

### 1.1 风格画像

|  | **Sonnet** | **Kimi** | **Opus** |
|---|---|---|---|
| 审查基本单位 | `按 phase / 按文件` 混合 | **按文件逐份完整审计** | **按 phase + 按链条簇 / DAG** |
| 主导动作 | 把设计意图压回 **当前代码 reality**，判断“这是 wiring 还是 greenfield” | 做 **全量 code-reality audit**，持续追问“现在到底有没有” | 做 **meta-level synthesis**，追问“这套文稿整体能不能启动、谁先谁后、谁该拍板” |
| 证据形式 | 精准 file/line + 现实状态表 + readiness table | file/line + “What it gets right / Code-Reality Gaps / Verdict” 三段式 | Ground Truth 命题表 + QNA 响应度 + DAG / chain-cluster 分析 |
| 主要视角 | runtime 接线、实现前置条件、工程现实主义 | stub surface、迁移成本、实施成熟度、遗漏工项 | charter 完整度、owner decision、phase gate、cross-doc coherence |
| 最擅长抓的问题 | “这不是重写，是接线”；“这一步没有 deploy surface / data source / secret injection” | “你写成 closure，其实还是 greenfield / stub / breaking migration” | “这里不是工程细节，而是 owner blocker / phase blocker / DAG blocker” |
| 最常给出的产出 | `风险表 + 可执行就绪度` | `完整问题册 + 修法建议 + revised execution order` | `执行指南 + staged followups + reviewer-level verdict` |
| 容易弱一点的地方 | 不总是做最高层的文档体系综合 | 较少把问题上升为 owner-vs-implementation 分层 | 不总是穷举每个 stub surface 的细粒度实现缺口 |
| Verdict 倾向 | 偏 **工程 gate**：能不能开工、哪里会炸 | 偏 **现实校准**：别把 design 写得比代码成熟 | 偏 **章程 gate**：结构可启动，但哪些决策必须前置 |

### 1.2 数据层观察

- **篇幅**：
  - Sonnet 两份合计 **868 行**（design 325 + action-plan 543）
  - Kimi 两份合计 **1198 行**（design 640 + action-plan 558）
  - Opus 两份合计 **1050 行**（design 570 + action-plan 480）
- **最宽**的是 **Kimi**：它在两份文稿里都坚持同一种审计模板，逐文件落结论，覆盖面最大。
- **最压缩**的是 **Sonnet**：信息密度很高，尤其擅长把“真实工作量 / 真正前置条件 / 这里其实不是 greenfield”的判断快速讲清楚。
- **最有 meta-structure** 的是 **Opus**：design review 用 per-phase + v1 review response；action-plan review 切成 4 条 chain cluster，已经不是普通“逐文件读后感”，而是在做执行体系建模。

### 1.3 一个最能概括三者差异的例子

用 **`trace_id` / `trace_uuid`** 这一条来看，三人的审查层次差异最清楚：

1. **Sonnet** 的问题表述是：`trace_uuid` 还没进入核心合同，P2/P3/P4/P6 都会失去锚点；重点是 **工程 gate**。
2. **Kimi** 的问题表述是：这不是“命名偏好”，而是 **breaking schema migration**，会打到 `nacp-core / nacp-session / tests / E2E / observability payloads`；重点是 **迁移成本与实施成熟度**。
3. **Opus** 的问题表述是：这已经不是纯工程问题，而是 **owner-level canonical choice**，因为它同时碰 repo truth、旧 contract tests、SAFE/SMCP 对标和 prior review 结论；重点是 **治理权属与 Phase 0 启动门槛**。

> 同一个问题，Sonnet 给的是 **施工现场视角**，Kimi 给的是 **全仓迁移视角**，Opus 给的是 **章程/裁决视角**。

---

## 2. 多维度打分

> 评分基准不是“谁更聪明”，而是“谁在文档审查这类任务里更适合扮演什么角色”。

| 维度 | Sonnet | Kimi | Opus | 差异说明 |
|---|---:|---:|---:|---|
| **代码事实锚定** | 4.7 | **4.8** | **4.8** | 三者都强；Sonnet 更压缩，Kimi/Opus 更系统化 |
| **结构化表达** | 4.5 | **4.8** | **4.9** | Kimi 模板最稳定；Opus 的章节组织最有层次 |
| **审查宽度** | 4.1 | **4.9** | 4.7 | Kimi 基本把每个 phase/file 都扫到位 |
| **审查深度** | 4.4 | 4.5 | **5.0** | Opus 最擅长把局部问题提升为系统性依赖与治理问题 |
| **跨文档 / DAG 推理** | 4.0 | 4.2 | **5.0** | Opus 在 action-plan review 里直接切 chain clusters，最强 |
| **实施前门控意识** | **4.8** | 4.6 | **4.9** | Sonnet/Opus 都很强；Sonnet偏工程 gate，Opus偏 owner gate |
| **修法可执行性** | **4.8** | **4.8** | 4.5 | Sonnet/Kimi 给具体工程动作更多；Opus更偏“先定规则” |
| **Verdict 校准** | 4.5 | 4.6 | **4.9** | Opus 最明确地区分 `approve / approve-with-staged-followups / blocker-Q1` 这类状态 |
| **对 owner/QNA 的消费能力** | 4.1 | 4.3 | **5.0** | Opus 明显最重视 PX-QNA、prior review、README 承诺的一致性 |
| **总体平均** | **4.43** | **4.61** | **4.86** | 三者都高；定位不同，不宜按“胜负”解读 |

> **解读**：  
> - **Sonnet** 最像“实现前置条件审查者”。  
> - **Kimi** 最像“全量 code-reality 审计师”。  
> - **Opus** 最像“phase charter / DAG / owner-decision reviewer”。  
> 真正好的用法不是三选一，而是 **按层叠加**。

---

## 3. 全部 review 的统计分析

### 3.1 文稿组织模式

| Reviewer | Design Review 组织方式 | Action-Plan Review 组织方式 | 最突出特征 |
|---|---|---|---|
| **Sonnet** | 逐 phase 表格 + 最后优先级问题清单 | 先写 code reality baseline，再按 A1-A10 做 factual eval，最后给 readiness table | **最像工程 handoff** |
| **Kimi** | Executive Summary → 每文件 `What it gets right / Gaps / Verdict` → severity registry → final verdict | 同样模板，最后加 revised execution order | **模板最稳定，扫面最完整** |
| **Opus** | Ground Truth → per-phase verdict → review-response / format-completeness / execution guide | Ground Truth → QNA 响应度 → 4 条 chain clusters → staged blocker registry → next steps | **meta-analysis 最强** |

### 3.2 明示的严重级别体系

| Reviewer | Design Review | Action-Plan Review | 观察 |
|---|---|---|---|
| **Sonnet** | 明确列出 `C1-C2`, `H1-H4`, `M1-M5`，再给 phase 风险矩阵 | 没有统一 blocker registry，而是把 severity 分散在每个 A 文件的 factual/risk tables 里 | **更偏分布式工程判断** |
| **Kimi** | 明确列出 `C1-C3`, `H1-H7`, `M1-M10`, `L1-L5` | 明确列出 `C1-C3`, `H1-H7`, `M1-M7`, `L1-L3` | **最标准的 issue registry reviewer** |
| **Opus** | 明确列出 `C1-C3`、`H1-H10`，并附执行时点 | 明确列出 `C1-C2`、`H1-H10`、`M1-M13`、`L1-L7`，再给每个 A 的 readiness verdict | **最强 staged blocker reviewer** |

### 3.3 共同结论与独家结论

#### 三人几乎一致的共识

1. **`trace_uuid` / `trace_id` 与 trace carrier 缺口** 是 design/action-plan 的中心风险。
2. **session edge 仍停留在 raw JSON.parse + switch / controller stubs**，A4 不是小修。
3. **fake bash capability handlers 大面积 stub**，P7 不能写成“治理已完成”。
4. **A6/P5 这类 verification workstream 必须建立在 A4/A5 closure 之上**，不能空跑。

#### 更偏 Sonnet 的独家价值

1. **把“这其实是 wiring，不是重写”讲得最清楚**：A4 对 `SessionOrchestrator` 的判断尤其典型。
2. **把 just-bash 的可移植与不可移植部分切得很准**：`rg` 可借，`js-exec` 的 `node:worker_threads` 不可借。
3. **常给出很强的技术路线压缩**：例如 A8 的 `rg` 升级路线、A9 的 curl Worker-native 路线、A10 的 virtual git 数据来源建议。

#### 更偏 Kimi 的独家价值

1. **最强 implementation-state 校准**：不断提醒“design 写成 closure，但代码还是 stub / greenfield / placeholder”。
2. **最强 breaking migration 感知**：A1/P0/P2 中 repeatedly 把命名漂移写成 cross-package refactor，而不是文字问题。
3. **最强 revised execution order 能力**：action-plan review 最后直接给 pre-flight / Wave 1-5 执行顺序，很适合落工程 backlog。

#### 更偏 Opus 的独家价值

1. **最强 owner-decision 分层**：很清楚地区分“这是实现问题”还是“这必须回到业主 / QNA / README 承诺层”。
2. **最强 cross-doc / chain-cluster 视角**：A1→A2→A3→A7，A4→A5→A6 这种依赖关系只有 Opus 做得最完整。
3. **最强 review-on-review 能力**：会把 prior review、README、QNA、design/action-plan 互相对照，而不是只盯当前一份文稿。

---

## 4. Qualitative Analysis — Sonnet

### 4.1 长处

1. **压缩能力最强**：Sonnet 两份文稿只有 868 行，但关键信息密度非常高。它特别擅长把“这里到底是 greenfield、wiring、还是 partial closure”一锤定音。
2. **实现前置条件意识很强**：它在 design review 里就反复强调 `trace_uuid` 没进核心合同、P4→P5 有强依赖、P7b 没 sandbox 方案；在 action-plan review 里继续把 readiness 压成可执行门槛。
3. **runtime realism 非常好**：Sonnet 对 `SessionOrchestrator`、`WsController`、`CompositionFactory`、`wrangler.jsonc` 这些“已经有一点骨架，但还没接通”的状态判断尤其准确。
4. **最擅长把 context 变成工程建议**：它不是泛泛地说“可以参考 just-bash”，而是会指出 **`rg-search.ts` 可移植，`js-exec.ts` 因 `node:worker_threads` 不可移植**。

### 4.2 短处

1. **action-plan review 的 severity 没有统一 registry**：Sonnet 更喜欢把风险嵌进每个 A 文件的 factual/risk table。工程师读起来顺，但做 reviewer meta-analysis 时不如 Kimi/Opus 容易汇总。
2. **宏观文档体系整合不如 Opus**：它能看出 P2 是中心漏洞，但不太主动去把 prior review、README 承诺、QNA 回答、后续 DAG 一次性编织成完整 meta-story。
3. **覆盖面不如 Kimi 宽**：Sonnet 会抓住最大的工程风险，但不总会像 Kimi 那样把每一层 implementation gap、policy gap、instrumentation gap 全列完。

### 4.3 综合评分

**⭐⭐⭐⭐☆ (4.4 / 5)**

### 4.4 Sonnet 的 Verdict

> **“实现前置条件审查者 / runtime wiring 现实主义者”**
>
> Sonnet 最适合在 **文稿即将转 implementation** 的时候出手：它会告诉你哪一步真能开工，哪一步其实只是接线，哪一步写成了 closure 但真实前提还没满足。  
> 它不是最宽的 reviewer，也不是最 meta 的 reviewer，但它非常擅长把文档从“概念正确”压回“工程上哪里会先爆”。

---

## 5. Qualitative Analysis — Kimi

### 5.1 长处

1. **覆盖面最宽**：Kimi 是三人里最像“完整 code-reality 审计师”的 reviewer。它坚持统一模板，几乎每个 phase / 文件都给出“优点 / 缺口 / verdict”。
2. **最强 implementation gap 识别**：它特别容易看出“文稿说 frozen / closure / governance，但代码还是 placeholder / stub / missing binding / greenfield instrumentation”。
3. **最强迁移成本意识**：Kimi 很少把命名差异当“文案问题”，而是直接判断它会打到 schema、tests、E2E、frame validation、replay semantics。
4. **最适合转 backlog**：action-plan review 后半段的 `Pre-flight / Wave 1-5` 重排非常像真实工程推进建议，可以直接拿去做执行排序。
5. **严重级别 registry 最工整**：design 和 action-plan 两份文稿都给出完整 C/H/M/L 问题表，是三人里最标准的 issue-registry 风格。

### 5.2 短处

1. **owner decision 与 engineering workstream 的分层不如 Opus 清楚**：Kimi 很多时候会把“其实需要先拍板”的东西也自然收编成 pre-flight engineering work，例如 trace rename 脚本、follow-up design doc、policy audit。
2. **对 cross-doc / DAG 的 higher-order synthesis 稍弱**：Kimi 很强在逐文件现实审计，但没有像 Opus 那样把 action-plan 折叠成 4 条 chain cluster 来看整体传导关系。
3. **会系统性压低文稿成熟度**：这经常是优点，但也意味着它的语气更偏“implementation-immature”，容易把一些已经成型的治理价值一起写得过于 early-stage。

### 5.3 综合评分

**⭐⭐⭐⭐⭐ (4.6 / 5)**

### 5.4 Kimi 的 Verdict

> **“最全面的 code-reality 审计师 / implementation-gap enumerator”**
>
> Kimi 最适合做 **第一轮大扫除**：它会把 design / action-plan 里所有“写得比代码成熟”的地方一条条挖出来，并给出很像 backlog 的修法与执行顺序。  
> 如果目标是 **最大化发现数**、压缩 implementation optimism、建立 pre-flight checklist，Kimi 的价值非常高。

---

## 6. Qualitative Analysis — Opus

### 6.1 长处

1. **最高层的文档体系整合能力最强**：Opus 不是只读 1 份 design 或 1 份 action-plan，而是会把 `README / prior review / PX-QNA / plan-after-skeleton / context 对标 / 当前代码 reality` 一起拉进来。
2. **最强 owner-gate 意识**：Opus 很清楚哪些问题应该由工程实现解决，哪些问题必须先回到业主、QNA 或 charter 层重裁。`trace_uuid vs trace_id`、follow-up input family、ts-exec substrate 都被它明确提升到这一层。
3. **最强 DAG / chain-cluster 视角**：在 action-plan review 里，它已经不是“读 A1-A10”，而是在看 **Contract Flow / Runtime Closure Flow / Verification Flow / Capability Flow** 四条链能不能整体运转。
4. **最强 reviewer-of-reviewers 能力**：design review 里会检查 GPT 是否真正吸收了 v1 review 建议；action-plan review 里会检查 20 条 QNA 是否被正确消费。这个层次只有 Opus 做得最完整。
5. **Verdict 语言最成熟**：`approve-with-critical-followups`、`approve-with-staged-followups`、`ready-to-start-with-blocker-Q1` 这种表达，比单纯 approve / reject 更能指导 phase 启动。

### 6.2 短处

1. **对局部实现表面未必像 Kimi 那么穷举**：Opus 很擅长找系统级 blocker，但不是每次都去把每个 stub surface、每个 policy gap、每个 instrumentation hole 全枚举出来。
2. **输出天然更偏“治理和章程”**：如果团队当前只想快速改一份 action-plan 中的局部工程缺口，Opus 的输出有时会显得比 Sonnet/Kimi 更“大”，更像审查 phase charter。
3. **更容易引入 owner 决策负担**：这是强项也是成本。Opus 会把“该回到 owner 的问题”准确挑出来，但如果团队只是想快速推进，可能会觉得门槛更高。

### 6.3 综合评分

**⭐⭐⭐⭐⭐ (4.9 / 5)**

### 6.4 Opus 的 Verdict

> **“phase charter reviewer / owner-decision gatekeeper / DAG synthesizer”**
>
> Opus 最适合在 **design/action-plan 即将成为正式章程** 时使用。  
> 它不是单纯找 bug，而是在判断：**这套文稿作为阶段执行文件，是否已经有资格被当成 charter 使用**。  
> 对 after-skeleton 这种多 phase、多 QNA、多 cross-doc 约束的场景，Opus 的价值最高。

---

## 7. 总结性陈述：未来如何使用 Docs Review

### 7.1 核心观察

> 这 6 份评审给出的最清晰结论不是“谁最好”，而是：
>
> - **Sonnet** 负责把文稿压回 **工程现实与实现门槛**；
> - **Kimi** 负责做 **全量 code-reality 审计与缺口穷举**；
> - **Opus** 负责做 **章程、依赖图、owner decision 与 cross-doc coherence 的最终闸门**。
>
> 三者不是竞争关系，而是 **三层审查栈**。

### 7.2 推荐搭配策略

#### 策略 A · 三层串行（默认推荐）

适用于：**design / action-plan 成为正式 phase charter 前**

1. **Kimi 第一轮**：先把 implementation gap、stub surface、迁移成本、missing binding、missing instrumentation 全扫出来。
2. **Sonnet 第二轮**：把这些问题压缩成真正的工程 gate，判断哪些是 wiring、哪些是真 greenfield、哪些要改 readiness 预期。
3. **Opus 第三轮**：把剩余问题上升到 DAG、QNA、README、owner decision 与 staged followups 层，做最终 charter gate。

#### 策略 B · Kimi + Sonnet（工程落地前）

适用于：**文稿已经基本定稿，只想快速进入实现**

- **Kimi** 负责广撒网，找 implementation optimism。
- **Sonnet** 负责快速确认“能不能开工、先做哪块、context 哪部分可移植”。
- 不足：对 README/QNA/phase charter 的体系性冲突识别不如 Opus。

#### 策略 C · Opus + Sonnet（高风险章程）

适用于：**phase 重排、owner decision 反转、QNA 大更新**

- **Opus** 负责看整体章程是否 still coherent。
- **Sonnet** 负责把这些上层结论压回代码 reality，防止章程写得太脱离实现。
- 不足：没有 Kimi 时，implementation gap 的清单化穷举会少一层。

#### 策略 D · 只用单个 reviewer 的场景

| 只用谁 | 适用场景 | 代价 |
|---|---|---|
| **只用 Sonnet** | 快速 phase gate / 实现前 handoff | 宽度不如 Kimi，meta 层不如 Opus |
| **只用 Kimi** | 想最大化发现数 / 建 pre-flight checklist | owner gate / DAG blocker 分层不如 Opus |
| **只用 Opus** | 文稿要上升为正式 charter / owner 要看整体 | 局部 stub / implementation gap 的穷举度不如 Kimi |

### 7.3 最终结论

这 6 份 eval 文件说明了一件很重要的事：

**在 nano-agent 这种“设计文件本身就是执行系统一部分”的项目里，reviewer 也应该分层。**

- **Kimi** 让文稿不敢假装代码已成熟；
- **Sonnet** 让文稿不敢假装工程 gate 已满足；
- **Opus** 让文稿不敢假装 owner / QNA / DAG 已对齐。

如果以后只保留一种 reviewer 视角，损失会非常明显。  
最优解不是三选一，而是把三人的审查 **叠成一个文档治理流水线**。

