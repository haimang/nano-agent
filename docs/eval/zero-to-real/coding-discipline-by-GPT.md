# Coding Discipline by GPT — Design / Action-Plan 边界回顾与模板修订报告

## 0. 结论先行

这次回顾后的核心结论是：

1. **design 与 action-plan 的职责确实有历史重叠，但 repo 的最新实践已经自然演化出更清晰的分工。**
2. **Q&A 不应继续存在于 action-plan 模板中。** Owner / architect 级问题必须在 design 阶段或集中 QNA register 中完成回答与冻结；action-plan 只消费这些 frozen answers。
3. **design 的职责是“回答为什么、选哪条路、边界在哪里、验收真相是什么”。**
4. **action-plan 的职责是“按冻结设计拆成可执行 Phase、工作项、测试、收口与回填”。**
5. 两个模板已经按这个结论更新：
   - `docs/templates/design.md`
   - `docs/templates/action-plan.md`

这次修订不是推翻过去，而是把过去几个阶段已经证明有效的实践正式制度化：`design / QNA -> action-plan -> issue closure -> handoff`。

---

## 1. 本次回顾范围

### 1.1 直接审阅的模板

- `docs/templates/action-plan.md`
- `docs/templates/design.md`

### 1.2 抽样审阅的 action-plan 输出

代表性样本包括：

- `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md`
- `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
- `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md`
- `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`
- `docs/action-plan/zero-to-real/ZX3-components-deprecation.md`
- `docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`
- `docs/action-plan/worker-matrix/PX-new-tests.md`
- `docs/action-plan/worker-matrix/P1-agent-bash-absorption.md`
- `docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md`
- `docs/action-plan/after-skeleton/A1-contract-and-identifier-freeze.md`

### 1.3 抽样审阅的 design 输出

代表性样本包括：

- `docs/design/zero-to-real/Z0-contract-and-compliance-freeze.md`
- `docs/design/zero-to-real/ZX-qna.md`
- `docs/design/orchestration-facade/FX-qna.md`
- `docs/design/orchestration-facade/F0-user-do-schema.md`
- `docs/design/worker-matrix/D01-agent-core-absorption.md`
- `docs/design/worker-matrix/D09-tier-b-deprecation-protocol.md`
- `docs/design/pre-worker-matrix/W3-absorption-pattern.md`

---

## 2. 历史实践观察

### 2.1 action-plan 的实际优势

历史 action-plan 做得最好的不是“设计判断”，而是 **执行编排**。

最强的几个模式是：

| 模式 | 代表文件 | 价值 |
|---|---|---|
| Phase 顺序解释 | `Z1-full-auth-and-tenant-foundation.md`、`F0-concrete-freeze-pack.md` | 让执行者知道为什么先做 A 再做 B |
| Scope 边界表 | `Z1-*`、`ZX3-components-deprecation.md` | 避免执行期偷渡需求 |
| Work item ID | `P1-01 / P2-03` 等 | review / handoff / closure 都能精确引用 |
| Phase 风险提醒 | 多数 Z / F / P 系列 action-plan | 把执行时最容易踩的坑前置暴露 |
| Closure / handoff 链 | `Z5-closure-and-handoff.md`、`F0-concrete-freeze-pack.md` | 让下游 plan 继承明确前序 |
| 执行日志回填 | executed 状态文档 | 记录实际执行与计划差异 |

例如 `F0-concrete-freeze-pack.md` 的目标非常典型：它不重新设计 façade，而是把 reviewed design pack + `FX-qna` 压成可执行 freeze baseline。它的 Phase 是 `审计 -> wording 收口 -> checklist -> closure`，这是 action-plan 的典型职责。

### 2.2 design 的实际优势

历史 design 做得最好的不是“列任务”，而是 **冻结判断**。

最强的几个模式是：

| 模式 | 代表文件 | 价值 |
|---|---|---|
| 术语表 | `Z0-contract-and-compliance-freeze.md`、`D09-tier-b-deprecation-protocol.md` | 避免同词不同义 |
| 架构定位 | 多数 design | 明确谁依赖谁、谁服务谁 |
| 精简 / 留口 / 解耦 / 聚合 | `D09-*`、`F0-*` | 防止架构漂移 |
| Tradeoff 句式 | “选择 X 而不是 Y，原因是 Z，代价是 W” | 让未来读者知道当时为什么这么选 |
| 风险与缓解 | `D01-agent-core-absorption.md` 等 | 风险不是抽象的，而是能连接到测试路径 |
| Value Verdict | `Z0-*` 等 | 判断这件事是否值得做 |
| QNA register | `ZX-qna.md`、`FX-qna.md` | 单一答复源，避免多文件漂移 |

`ZX-qna.md` 和 `FX-qna.md` 尤其关键。它们的 header 已经明确写出：

- 业主只在本文件填写回答
- 其他 design / action-plan / memo 引用 Q 编号时，以本文件为唯一答复来源
- 各具体文档不再逐条填写 QNA
- Q 编号保持稳定，后续追加

这套实践已经比旧 action-plan 模板更成熟。

### 2.3 最大历史问题：Q&A 曾经放错层

旧版 `docs/templates/action-plan.md` 的 §6 是：

```text
## 6. 需要业主 / 架构师回答的问题清单
```

这在早期是合理的，因为当时设计纪律还在形成；但随着文档体系成熟，这个章节产生了三个问题：

1. **重复回答**：多个 action-plan 可能引用同一个 owner 问题，却在不同文档中重复回答。
2. **答案漂移**：A1 改了答案，A2 未改，后续执行者无法判断哪个是真相。
3. **职责倒置**：如果 action-plan 仍有 owner blocker，说明 design 尚未冻结；这时不该开始执行计划。

历史上已经出现了从“action-plan 内嵌 Q&A”到“集中 QNA register”的演化：

- after-nacp / early after-skeleton：很多 action-plan 内嵌 Q&A
- after-skeleton：出现 `AX-QNA.md` 作为集中答复源
- orchestration-facade：`FX-qna.md` 成为 design/action-plan 的单一答复源
- zero-to-real：`ZX-qna.md` 成为 Z0-Z4 的 frozen answer register

因此，模板应当采纳最新实践，而不是保留旧习惯。

---

## 3. 两类文档的重新分工

### 3.1 Design 的职责

Design 应回答：

1. **为什么要做**
2. **我们讨论的对象到底是什么**
3. **边界在哪里**
4. **有哪些方案，为什么选择其中一个**
5. **哪些问题必须 owner / architect 拍板**
6. **哪些 Q 已冻结，冻结答案是什么**
7. **可验证的验收真相是什么**
8. **哪些参考实现值得借鉴，哪些不能照抄**
9. **这个设计是否值得做，价值和风险如何**

Design 不应回答：

1. 哪个 PR 先改哪个文件
2. 每个 Phase 的工作项编号
3. 具体执行顺序
4. 执行日志
5. 已冻结设计以外的新临场 Q&A

### 3.2 Action-plan 的职责

Action-plan 应回答：

1. **基于哪些 frozen design / QNA / closure 开始执行**
2. **分几个 Phase 执行**
3. **每个 Phase 做哪些工作项**
4. **改哪些文件 / 模块**
5. **怎么测试**
6. **什么条件下收口**
7. **哪些设计决策是只读依赖**
8. **完成后系统状态变成什么**
9. **执行后实际发生了什么**

Action-plan 不应回答：

1. owner / architect 级开放问题
2. design tradeoff 的根本选择
3. scope 的首次定义
4. 协议 / 安全 / runtime posture 的首次冻结
5. 架构价值判断

### 3.3 两者关系

推荐关系是：

```text
charter / investigation
  ↓
design docs
  ├── freeze terminology
  ├── freeze boundary
  ├── freeze tradeoffs
  ├── freeze contracts
  └── route owner questions to QNA register
        ↓
      QNA / decision register
        ↓
action-plan
  ├── consume frozen decisions
  ├── split work into phases
  ├── define files/tests/exit criteria
  └── produce closure
        ↓
issue closure / handoff
```

---

## 4. 模板更新摘要

### 4.1 `docs/templates/action-plan.md` 的更新

本次更新对 action-plan 模板做了以下关键调整：

| 位置 | 更新 | 原因 |
|---|---|---|
| Header | 新增 `上游前序 / closure`、`下游交接`、`冻结决策来源` | 强化 action-plan 是执行链路的一环 |
| §0 | 明确“如果仍有 owner 问题，应回到 design/QNA” | 防止 action-plan 继续承载 Q&A |
| §1 | 保留 Phase 总览、Phase 说明、执行策略 | 这是 action-plan 的核心价值 |
| §2 | 保留 scope 表，但强调执行边界来自 design/QNA | 防止 action-plan 重开 scope |
| §6 | 删除原 “需要业主 / 架构师回答的问题清单” | Q&A 不属于 action-plan |
| §6 新版 | 改为 “依赖的冻结设计决策（只读引用）” | action-plan 只消费决策，不回答决策 |
| §7 | 新增“完成后的预期状态” | 比空泛结语更有执行价值 |
| §9 | 改为 `executed` 状态才使用的执行日志回填 | 避免 draft 文档长期挂空复盘 |

更新后的核心纪律是：

> action-plan 中若出现需要 owner 回答的问题，说明它还不是 action-plan，而是应该回退到 design/QNA 阶段的 blocker。

### 4.2 `docs/templates/design.md` 的更新

本次更新对 design 模板做了以下关键调整：

| 位置 | 更新 | 原因 |
|---|---|---|
| Header | 新增 `关联 QNA / 决策登记` | 正式承认 QNA 是 design 阶段资产 |
| §0 | 明确 design 阶段负责回答 owner / architect 级问题 | 把 Q&A 从 action-plan 前移 |
| §1 | 强化术语表为必填 | 历史证明术语表能显著降低漂移 |
| §3 | 改名为“架构稳定性与未来扩展策略” | 明确该节作用是防止架构漂移 |
| §5 | 强化灰色地带边界清单 | scope creep 往往发生在灰区 |
| §6 | 强化 tradeoff 句式与重评条件 | 让未来读者知道何时能推翻当前选择 |
| §7 | 明确“不是任务列表，而是验收规格” | 避免 design 与 action-plan 混层 |
| §9 | 新增 “QNA / 决策登记与设计收口” | 让 design 有正式冻结出口 |
| §10 | 保留 Value Verdict | 设计仍需回答“是否值得做” |

更新后的核心纪律是：

> design 进入 `frozen` 前，所有会影响 action-plan 执行路径的问题都必须已经回答。

---

## 5. 新的推荐目录与文档流

### 5.1 推荐目录职责

```text
docs/
├── charter/
│   └── 阶段级目标、不可轻易推翻的根约束
├── investigation/
│   └── 外部系统 / 代码事实 / 参考实现调查
├── eval/
│   └── 审查、复盘、现状评估、批判性分析
├── design/
│   └── 架构设计、边界冻结、tradeoff、QNA register
├── action-plan/
│   └── 执行拆解、Phase、工作项、测试与收口计划
├── issue/
│   └── closure、完成证明、执行结果、阶段结论
└── handoff/
    └── 下一阶段可直接消费的交接包
```

### 5.2 每个目录怎么帮助未来工作

| 目录 | 未来价值 |
|---|---|
| `docs/charter/` | 防止阶段目标被单个实现 PR 反复推翻 |
| `docs/investigation/` | 保存事实材料，避免每次 design 都重新调查 |
| `docs/eval/` | 保存审查与批判性判断，适合回答“我们现在真实处于什么状态” |
| `docs/design/` | 冻结架构选择，回答 owner/architect 问题 |
| `docs/action-plan/` | 把 frozen design 变成可执行、可 review、可 closure 的工作包 |
| `docs/issue/` | 记录已经完成的事实，而不是计划中的承诺 |
| `docs/handoff/` | 降低下一阶段启动成本，避免重新读完整历史 |

### 5.3 推荐命名流

对一个阶段，例如 `zero-to-real`，推荐：

```text
docs/charter/plan-zero-to-real.md
docs/eval/zero-to-real/<topic>-by-<reviewer>.md
docs/design/zero-to-real/Z0-*.md
docs/design/zero-to-real/ZX-qna.md
docs/action-plan/zero-to-real/Z0-*.md
docs/issue/zero-to-real/Z0-closure.md
docs/handoff/zero-to-real-to-next-phase.md
```

其中：

- `ZX-qna.md` 是 design 阶段的决策登记，不是 action-plan 附录。
- `Z0 action-plan` 引用 `ZX-qna.md`，但不填写 Q&A。
- `Z0 closure` 证明 action-plan 已执行，而不是重复计划内容。

---

## 6. 新模板的章节边界

### 6.1 新 design 章节结构

```text
design.md
├── 0. 背景与前置约束
├── 1. 讨论对象
│   ├── 1.1 功能簇定义 + 必填术语表
│   └── 1.2 参考调查报告
├── 2. 在 nano-agent 中的定位
├── 3. 架构稳定性与未来扩展策略
│   ├── 精简点
│   ├── 接口保留点
│   ├── 完全解耦点
│   └── 聚合点
├── 4. 参考实现 / 历史 precedent 对比
├── 5. In-Scope / Out-of-Scope 判断
├── 6. Tradeoff 辩证分析与价值判断
├── 7. In-Scope 功能详细列表
├── 8. 可借鉴的代码位置清单
├── 9. QNA / 决策登记与设计收口
├── 10. 综述总结与 Value Verdict
└── 附录
```

这套结构的重点是：**先定义，再定位，再做边界，再做取舍，再做规格，再冻结问题。**

### 6.2 新 action-plan 章节结构

```text
action-plan.md
├── 0. 执行背景与目标
├── 1. 执行综述
│   ├── 总体执行方式
│   ├── Phase 总览
│   ├── Phase 说明
│   ├── 执行策略说明
│   └── 影响结构图
├── 2. In-Scope / Out-of-Scope
├── 3. 业务工作总表
├── 4. Phase 业务表格
├── 5. Phase 详情
├── 6. 依赖的冻结设计决策（只读引用）
├── 7. 风险、依赖与完成后状态
├── 8. 整体测试与整体收口
└── 9. 执行日志回填（executed 状态使用）
```

这套结构的重点是：**只执行，不重新设计；只引用 QNA，不填写 QNA。**

---

## 7. 辩证思考：两类文档为什么看起来会重叠

### 7.1 重叠不是完全坏事

两类文档都有：

- 背景
- scope
- 风险
- 测试
- 收口

这不是错误，因为读者进入任一文件时都需要最低上下文。但两者的**同名字段应回答不同层次的问题**。

### 7.2 同名字段的不同含义

| 字段 | design 中的含义 | action-plan 中的含义 |
|---|---|---|
| 背景 | 为什么需要这个设计判断 | 为什么现在执行这批工作 |
| scope | 架构上做 / 不做什么 | 本轮执行做 / 不做什么 |
| 风险 | 选择这条设计路线的架构风险 | 执行这批 Phase 的交付风险 |
| 测试 | 用什么方式证明设计可验证 | 实际跑哪些测试 / 验证命令 |
| 收口 | design frozen 的条件 | action-plan executed 的条件 |

所以解决方案不是完全去重，而是**明确层级**。

### 7.3 Q&A 是最该去重的一类内容

Q&A 与普通上下文不同。背景可以重复少量，scope 可以在不同层次重复，但 Q&A 不能重复，因为它的价值在于“单一答案”。

因此：

- design 可以写 Q&A
- centralized QNA register 更适合跨多文档问题
- action-plan 只能只读引用 Q&A

---

## 8. 后续使用规则

### 8.1 什么时候写 design

满足任一条件，就应写 design：

1. 需要 owner / architect 选择路线
2. 涉及协议、权限、安全、运行时 owner、数据模型、长期目录结构
3. 有多个合理方案，必须记录为什么选其中一个
4. 会影响多个 action-plan
5. 需要冻结术语、scope、tradeoff 或验收真相

### 8.2 什么时候写 action-plan

满足全部条件，才应写 action-plan：

1. 上游 design 或 QNA 已经足够冻结
2. 不再需要 owner 回答根本问题
3. 可以明确拆成 Phase
4. 可以列出修改文件、测试方式、收口标准
5. 可以连接 closure / handoff

### 8.3 什么时候写 eval

满足任一条件，就应写 eval：

1. 当前状态不清，需要调查真实情况
2. 需要评估某个计划是否合理
3. 需要对历史实践做复盘
4. 需要比较多个候选方案但还不准备冻结设计
5. 需要批判性检查盲点、断点或风险

### 8.4 什么时候写 closure / handoff

- `closure`：写已经完成了什么、用什么证据证明、还有什么 residual。
- `handoff`：写下一阶段应从哪里开始、继承哪些约束、避开什么坑。

---

## 9. 最终建议

从现在开始，建议执行以下纪律：

1. **所有新 action-plan 不再包含可填写 Q&A。**
2. **所有影响执行路径的 owner 问题，必须在 design/QNA 阶段回答。**
3. **action-plan 的 §6 只列“依赖的冻结设计决策”，不可新增问题。**
4. **design 的 §9 必须说明 QNA / 决策登记状态。**
5. **若 action-plan 撰写时发现新架构问题，应停止 action-plan，回退到 design。**
6. **closure 只记录事实，不替代 action-plan 或 design。**
7. **handoff 只交接下一阶段，不重新做设计争论。**

一句话总结：

> **Design 决定“什么是真相”，Action-plan 决定“怎样把真相落地”，Closure 证明“真相已经落地”，Handoff 告诉下一阶段“从哪里继续”。**

---

## 10. Code Review / Respond / Eval 模板回顾与修订

### 10.1 本轮新增回顾范围

本轮继续沿用“模板 + 历史输出抽样 + 实际用途反推职责边界”的机制，审阅了三份模板：

- `docs/templates/code-review.md`
- `docs/templates/code-review-respond.md`
- `docs/templates/code-review-eval.md`

代表性历史样本包括：

- `docs/code-review/zero-to-real/Z2-reviewed-by-opus.md`
- `docs/code-review/zero-to-real/Z4-reviewed-by-opus.md`
- `docs/code-review/orchestration-facade/F0-F2-reviewed-by-opus.md`
- `docs/code-review/after-foundations/B2-B4-code-reviewed-by-GPT.md`
- `docs/code-review/pre-worker-matrix/W0-reviewed-by-opus.md`
- `docs/code-review/worker-matrix/P3-P4-reviewed-by-opus.md`
- `docs/progress-report/after-nacp/mvp-wave-2nd-round-fixings.md`
- `docs/eval/code-reviewer-reviewed-by-GPT.md`
- `docs/eval/code-reviewer-reviewed-by-opus.md`
- `docs/eval/code-reviewer-reviewed-by-opus-v2.md`

### 10.2 历史实践观察

真实文档已经自然分化出三种不同职能。

第一类是主审查报告。`Z2-reviewed-by-opus.md`、`Z4-reviewed-by-opus.md`、`F0-F2-reviewed-by-opus.md` 与 `B2-B4-code-reviewed-by-GPT.md` 都证明，高质量 code review 不只是列 bug，而是包含 verdict、审查范围、正面事实、负面事实、R 系列 findings、scope 对账、out-of-scope 核查与收口意见。尤其 zero-to-real 后期的 review 已经把 `severity`、`type`、`blocker / follow-up`、平台事实、live evidence、schema/contract 反向校验纳入了事实标准。

第二类是实现者回应。`W0-reviewed-by-opus.md` 与 `P3-P4-reviewed-by-opus.md` 的 §6 显示，实现者回应不是新的 review，也不是 closure，而是逐项 fix ledger：每个 `R1/R2/...` 必须映射到 `fixed / partially-fixed / deferred / rejected` 等处理结果，列出修改文件、验证结果、残留限制，并声明是否 `ready-for-rereview`。`mvp-wave-2nd-round-fixings.md` 进一步说明，当一轮修复包含 scope-down 或 partial closure 时，必须把 partially-closed 与 ready-for-rereview 分开写，避免把“能复核”误写成“已关闭”。

第三类是审查者质量元评估。`code-reviewer-reviewed-by-GPT.md`、`code-reviewer-reviewed-by-opus.md` 与 `code-reviewer-reviewed-by-opus-v2.md` 并不是普通 review 的尾注，而是对 reviewer 方法论、盲区、证据质量、severity 校准、false positive / false negative、搭配策略的独立评估。它们的价值在于告诉项目以后如何组合 reviewer，而不是告诉实现者某条代码怎么改。

### 10.3 三份模板的新边界

| 模板 | 新职责 | 不再承担 |
|------|--------|----------|
| `code-review.md` | 主审查报告：判断当前实现 / 文档 / closure 是否符合冻结真相，输出 R 系列 findings 与最终 verdict。 | 不承载实现者修复过程；不评价 reviewer 本身。 |
| `code-review-respond.md` | 实现者 append-only 回应：逐条处理 R 系列 findings，记录修改、验证、deferred 理由与 rereview 请求。 | 不改写 reviewer 的 §0–§5；不把 partial 修复写成 closed。 |
| `code-review-eval.md` | 审查质量元评估：评价 reviewer 风格、证据链、盲区、severity 校准与未来使用策略。 | 不替代主 review；不作为实现者修复清单。 |

因此新的 review 闭环应写成：

```text
design / action-plan / closure truth
  -> code-review.md
  -> code-review-respond.md
  -> rereview section or new rereview doc
  -> code-review-eval.md（可选，用于 reviewer 质量复盘 / 选型）
```

### 10.4 本轮模板修改摘要

`code-review.md` 的修订重点是把真实高质量 review 已经在做的事情制度化：

- 增加 `审查类型` 与 `对照真相`，支持 code / docs / closure / rereview 等不同场景。
- 强化 §1 的证据可信度说明，要求说明是否使用文件行号、命令、schema/contract 反向校验、live/deploy 证据、design/QNA 对账。
- 保留并强化正面事实 / 负面事实分离，防止 review 只写缺点而无法判断主体是否成立。
- 增加 findings 汇总表，将严重级别、类型、blocker 与建议处理一屏化。
- 扩展 finding 类型到 `platform-fitness`、`protocol-drift` 等本仓真实常见类别。
- 将 closure claim 也纳入 In-Scope 对账，使 closure-review 不再只能靠叙述判断。
- 明确实现者回应入口：使用 `code-review-respond.md` append §6，不改写 reviewer §0–§5。

`code-review-respond.md` 的修订重点是把实现者回应从“简短表格”升级为可复核 fix ledger：

- 保留 append-only 纪律，禁止改写主 review。
- 增加 `stale-rejected`、`deferred-with-rationale`、`blocked` 等更贴近历史实践的处理状态。
- 增加 blocker/follow-up 状态汇总，避免 partially-fixed 被误读为 fixed。
- 增加验证矩阵，把验证项与具体 finding 绑定。
- 增加未解决事项与承接位置，要求 deferred 必须进入后续 doc / phase / issue。
- 增加 ready-for-rereview gate，明确请求复核的范围。

`code-review-eval.md` 的修订最大：它从一个 `## 8` 追加片段升级为完整的元评估模板，同时保留短格式附录。原因是历史上最有价值的 reviewer 评价都是独立分析报告，而不是简单优缺点列表。新模板增加：

- 评价类型、样本基础、利益冲突 / 自评披露。
- 审查风格画像：切入点、证据类型、verdict 倾向、finding 粒度、修法风格。
- finding 质量清点，区分 true-positive、partial、false-positive、stale、missed-by-others。
- false positive / false negative / severity 校准分析。
- 1–5 分维度评分，并增加 verdict 校准与复核能力。
- 多 reviewer 对比与 shared / unique findings。
- 对未来 prompt 与 reviewer 搭配策略的建议。

### 10.5 新目录结构如何帮助未来工作

这次修订后，三份模板与上一轮 design/action-plan 分工可以形成完整纪律链：

```text
docs/design/          冻结问题、边界、QNA、协议真相
docs/action-plan/     将冻结真相拆成 Phase 与执行项
docs/issue/           记录完成事实与 residual
docs/code-review/     审查实现 / 文档 / closure 是否符合真相
docs/progress-report/ 记录较大修复批次的实现者过程与验证
docs/eval/            评价计划、模板、reviewer 质量与阶段现状
docs/handoff/         把已知事实交给下一阶段
```

其中 `docs/code-review/` 与 `docs/eval/` 的区别尤其重要：code review 是“对交付物判案”，eval 是“对判断机制和历史状态做复盘”。如果把 reviewer 质量评价塞在 code review 主体里，会让实现者修复路径变重；如果把 code review findings 写进 eval，又会削弱 blocker 的执行压力。三份模板分开后，读者可以更快判断自己要做什么：

- 实现者看 `code-review.md` 的 R 系列 findings 和 `code-review-respond.md`。
- 复核者看 §6 回应、验证矩阵和 ready-for-rereview gate。
- 项目 owner 看 `code-review-eval.md` 选择 reviewer 组合与下次 prompt。

### 10.6 后续使用规则

1. 新增主审查时使用 `code-review.md`，所有 blocker 必须进入 R 系列编号。
2. 实现者回应必须 append `code-review-respond.md`，不得编辑 reviewer 的原始 verdict 与 findings。
3. 二次审查应基于 §6 的逐项回应做 closed / still-open / partially-fixed 判定。
4. reviewer 质量分析默认写入 `docs/eval/`，只有短评才使用 `code-review-eval.md` 的 §8 附录格式追加到主 review。
5. 任何 `deferred-with-rationale` 都必须有承接位置；没有承接位置的 deferred 不应被视为收口。
6. 对协议、平台、安全、跨 worker wire shape 的 review，必须在证据可信度说明中显式写是否做了 schema/contract 或平台事实核查。

一句话总结：

> **Code Review 判定交付物是否成立，Respond 证明实现者如何逐条处理，Code Review Eval 判断这套审查本身是否可信。**
