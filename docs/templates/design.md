# Nano-Agent 功能簇设计模板

> 功能簇: `{FEATURE_CLUSTER_NAME}`
> 讨论日期: `{DATE}`
> 讨论者: `{PARTICIPANTS}`
> 关联调查报告:
> - `{LINKS_TO_INVESTIGATION_DOCS}`
> 关联 QNA / 决策登记:
> - `{QNA_OR_DECISION_REGISTER}`
> 文档状态: `draft | reviewed | frozen | superseded`

---

## 0. 背景与前置约束

> 说明为什么现在讨论这个功能簇、它继承了哪些已经冻结的 charter / QNA / closure 结论，以及本设计不再讨论什么。
>
> **纪律**：设计阶段负责回答 owner / architect 级问题。会影响 contract、boundary、scope、runtime posture、security law 的问题必须在本设计或关联 QNA register 中冻结；不要把这类问题留给 action-plan。

- **项目定位回顾**：`{PROJECT_POSITIONING}`
- **本次讨论的前置共识**：
  - `{FROZEN_PRECONDITION_1}`
  - `{FROZEN_PRECONDITION_2}`
- **本设计必须回答的问题**：
  - `{DESIGN_QUESTION_1}`
  - `{DESIGN_QUESTION_2}`
- **显式排除的讨论范围**：
  - `{OUT_OF_DISCUSSION_1}`
  - `{OUT_OF_DISCUSSION_2}`

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`{FEATURE_CLUSTER_NAME}`
- **一句话定义**：`{ONE_LINE_DEFINITION}`
- **边界描述**：这个功能簇**包含** `{INCLUDED_CAPABILITIES}`；**不包含** `{EXCLUDED_CAPABILITIES}`。
- **关键术语对齐**：此表为必填；如果术语无法对齐，后续 action-plan 不应开始。

| 术语 | 定义 | 备注 |
|------|------|------|
| `{TERM}` | `{DEFINITION}` | `{NOTE}` |

### 1.2 参考调查报告

- `{INVESTIGATION_DOC}` — `{RELEVANT_SECTION}`
- `{REFERENCE_DOC}` — `{RELEVANT_SECTION}`

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演什么角色？例如：核心骨架、协议层、运行时 owner、安全守卫、开发者体验层、测试治理层。
- 它服务于谁？例如：agent loop、开发者、最终用户、运维、后续 action-plan。
- 它依赖什么？例如：前置模块、配置源、外部服务、QNA 决策。
- 它被谁依赖？例如：下游 worker、客户端、测试层、closure/handoff。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `{NEIGHBOR}` | `{DIRECTION}` | `{COUPLING}` | `{DETAIL}` |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`{FEATURE_CLUSTER_NAME}` 是 **{ROLE}**，负责 **{RESPONSIBILITY}**，对上游提供 **{WHAT_IT_OFFERS}**，对下游要求 **{WHAT_IT_NEEDS}**。"

---

## 3. 架构稳定性与未来扩展策略

> 本节负责防止架构漂移：哪里要砍、哪里要留口、哪里必须解耦、哪里必须聚合。这里写 architecture boundary，不写执行任务。

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| `{CUT_ITEM}` | `{SOURCE}` | `{WHY_SAFE_TO_CUT}` | `{REVISIT_CONDITION}` |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| `{EXTENSION_POINT}` | `{FORM}` | `{FIRST_WAVE_BEHAVIOR}` | `{FUTURE_DIRECTION}` |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：`{DECOUPLED_OBJECT}`
- **解耦原因**：`{WHY_DECOUPLE}`
- **依赖边界**：`{DEPENDENCY_BOUNDARY}`

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：`{AGGREGATED_OBJECT}`
- **聚合形式**：`{AGGREGATION_FORM}`
- **为什么不能分散**：`{WHY_NOT_SCATTERED}`

---

## 4. 参考实现 / 历史 precedent 对比

> 简明对比，不重复 investigation 报告里的全部细节，只挑出会改变 nano-agent 设计选择的点。若某阶段没有 mini-agent / codex / claude-code 参考，可改成“内部 precedent 对比”。

### 4.1 mini-agent 的做法

- **实现概要**：`{SUMMARY}`
- **亮点**：
  - `{STRENGTH}`
- **值得借鉴**：
  - `{BORROW}`
- **不打算照抄的地方**：
  - `{NO_COPY}`

### 4.2 codex 的做法

- **实现概要**：`{SUMMARY}`
- **亮点**：
  - `{STRENGTH}`
- **值得借鉴**：
  - `{BORROW}`
- **不打算照抄的地方**：
  - `{NO_COPY}`

### 4.3 claude-code 的做法

- **实现概要**：`{SUMMARY}`
- **亮点**：
  - `{STRENGTH}`
- **值得借鉴**：
  - `{BORROW}`
- **不打算照抄的地方**：
  - `{NO_COPY}`

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| `{DIMENSION}` | `{VALUE}` | `{VALUE}` | `{VALUE}` | `{OUR_CHOICE}` |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

> 每一项都要说明为什么一定要做。这里是 scope 判断，不是执行清单。

- **[S1]** `{IN_SCOPE_ITEM}` — `{WHY_REQUIRED}`
- **[S2]** `{IN_SCOPE_ITEM}` — `{WHY_REQUIRED}`

### 5.2 Out-of-Scope（本设计确认不做）

> 每一项都要说明为什么暂不做，以及什么条件下重评。

- **[O1]** `{OUT_OF_SCOPE_ITEM}` — `{WHY_DEFERRED}`；重评条件：`{REVISIT_CONDITION}`
- **[O2]** `{OUT_OF_SCOPE_ITEM}` — `{WHY_DEFERRED}`；重评条件：`{REVISIT_CONDITION}`

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `{ITEM}` | `in-scope / out-of-scope / defer` | `{WHY}` | `{ACTION_PLAN_OR_FUTURE_DOC}` |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

> 用 **"我们选择 X 而不是 Y，原因是 Z，代价是 W，重评条件是 C"** 的句式把关键决策写清楚。至少覆盖所有会影响 action-plan 执行路径的 owner/architect 级选择。

1. **取舍 1**：我们选择 **`{X}`** 而不是 **`{Y}`**
   - **为什么**：`{WHY}`
   - **我们接受的代价**：`{COST}`
   - **未来重评条件**：`{REVISIT_CONDITION_OR_NEVER}`

2. **取舍 2**：我们选择 **`{X}`** 而不是 **`{Y}`**
   - **为什么**：`{WHY}`
   - **我们接受的代价**：`{COST}`
   - **未来重评条件**：`{REVISIT_CONDITION_OR_NEVER}`

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| `{RISK}` | `{TRIGGER}` | `{IMPACT}` | `{MITIGATION}` |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：`{VALUE_FOR_US}`
- **对 nano-agent 的长期演进**：`{VALUE_FOR_PROJECT}`
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：`{VALUE_FOR_STRATEGIC_DIRECTIONS}`

---

## 7. In-Scope 功能详细列表

> 把 §5.1 的 S1/S2/S3 展开为可落地的功能规格。这里写**可验证的验收条件**，不是 action-plan 任务列表；不要写 `[ ] 创建文件 X` 这类执行项。

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | `{FEATURE_NAME}` | `{DESCRIPTION}` | ✅ `{ONE_LINE_DONE_CRITERION}` |
| F2 | `{FEATURE_NAME}` | `{DESCRIPTION}` | ✅ `{ONE_LINE_DONE_CRITERION}` |

### 7.2 详细阐述

#### F1: `{FEATURE_NAME}`

- **输入**：`{INPUT}`
- **输出**：`{OUTPUT}`
- **主要调用者**：`{CALLERS}`
- **核心逻辑**：`{CORE_LOGIC}`
- **边界情况**：
  - `{EDGE_CASE}`
- **一句话收口目标**：✅ **`{ONE_LINE_DONE_CRITERION}`**

#### F2: `{FEATURE_NAME}`

- **输入**：`{INPUT}`
- **输出**：`{OUTPUT}`
- **主要调用者**：`{CALLERS}`
- **核心逻辑**：`{CORE_LOGIC}`
- **边界情况**：
  - `{EDGE_CASE}`
- **一句话收口目标**：✅ **`{ONE_LINE_DONE_CRITERION}`**

### 7.3 非功能性要求与验证策略

- **性能目标**：`{PERFORMANCE_TARGET}`
- **可观测性要求**：`{OBSERVABILITY_REQUIREMENT}`
- **稳定性要求**：`{STABILITY_REQUIREMENT}`
- **安全 / 权限要求**：`{SECURITY_REQUIREMENT}`
- **测试覆盖要求**：`{TEST_REQUIREMENT}`
- **验证策略**：`{VALIDATION_STRATEGY}`（说明如何证明设计成立；具体命令由 action-plan 写）

---

## 8. 可借鉴的代码位置清单

> 列出来自参考实现或本仓库 precedent 的具体代码位置，标注为什么值得看 / 打算借鉴什么。这是后续实现阶段的参考书签，不是修改清单。

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/...` | `{CONTENT}` | `{BORROW_POINT}` | `{NOTE}` |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/...` | `{CONTENT}` | `{BORROW_POINT}` | `{NOTE}` |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/...` | `{CONTENT}` | `{BORROW_POINT}` | `{NOTE}` |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `{FILE_LINE}` | `{PATTERN_OR_PROBLEM}` | `{WHY}` |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

> 若本设计有跨文档、跨 Phase 或会影响多个 action-plan 的问题，应进入 `{FEATURE_GROUP}-qna.md` 或同类 decision register。业主只在 register 中填写回答；design 和 action-plan 只引用。

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| `{Q1}` | `{QUESTION}` | `{IMPACT}` | `{RECOMMENDATION}` | `open | answered | frozen` | `{QNA_LINK}` |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. `{DESIGN_EXIT_CRITERION_1}`
2. `{DESIGN_EXIT_CRITERION_2}`
3. `{DESIGN_EXIT_CRITERION_3}`
4. 所有影响 action-plan 执行路径的问题都已在本设计或 QNA register 中回答。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `{ACTION_PLAN_DOC}`
- **需要同步更新的设计文档**：
  - `{RELATED_DESIGN_DOC}`
- **需要进入 QNA register 的问题**：
  - `{QNA_ITEM_OR_NONE}`

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

> 三到五句话概括本设计产出的 nano-agent 侧画像：这个功能簇将以什么形式存在、覆盖多大范围、与其他部分怎么耦合、复杂度来自哪里。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | `{RATING}` | `{WHY}` |
| 第一版实现的性价比 | `{RATING}` | `{WHY}` |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | `{RATING}` | `{WHY}` |
| 对开发者自己的日用友好度 | `{RATING}` | `{WHY}` |
| 风险可控程度 | `{RATING}` | `{WHY}` |
| **综合价值** | `{RATING}` | `{WHY}` |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：`{DISAGREEMENT}`
  - **A 方观点**：`{POSITION_A}`
  - **B 方观点**：`{POSITION_B}`
  - **最终共识**：`{CONSENSUS}`

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `{DATE}` | `{AUTHOR}` | 初稿 |

