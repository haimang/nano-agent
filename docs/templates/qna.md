# Nano-Agent Q&A 模板

> 范围：`{QNA_SCOPE}`
> 目的：把会影响后续 `{TARGET_DOCS_OR_PHASES}` 的业主 / 架构师决策收敛到一份单一清单，避免在多个文档中重复回答、重复漂移、重复改口。
> 使用方式：
> 1. **业主只在本文件填写回答。**
> 2. 其他 design / action-plan / memo 若引用某个 `Q` 编号，默认都以本文件为唯一答复来源。
> 3. 各具体文档不再逐条填写 QNA；如仍保留“已确认 / 已冻结”的历史表述，应理解为上下文说明，后续统一以本文件回填结果为准。
> 4. `Q` 编号应保持稳定；如果是在已有 QNA 基础上补题，继续沿用旧编号，并从最后一个编号往后新增。
>
> 📝 **注**：
> - 本模板默认采用 **标准完整版格式**：`影响范围 / 为什么必须确认 / 当前建议 / Reasoning / Opus second opinion / 问题 / 业主回答`
> - `Reasoning` 必须写给**第一次参与该项目决策的业主**，帮助其理解问题出现的原因、推荐路线的依据、以及不拍板会造成什么后果。
> - 如尚未征求 Opus second opinion，保留 `Opus` 三段空白即可；不要删除结构。

---

## 1. `{DECISION_CLUSTER_1}`

### Q{N} — `{QUESTION_TITLE}`（来源：`{SOURCE_DOCS}`）

- **影响范围**：`{IMPACT_SCOPE}`
- **为什么必须确认**：`{WHY_CONFIRMATION_IS_REQUIRED}`
- **当前建议 / 倾向**：`{CURRENT_RECOMMENDATION}`
- **Reasoning**：`{PLAIN_LANGUAGE_REASONING_FOR_OWNER}`

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`{OWNER_FACING_QUESTION}`
- **业主回答**：

### Q{N+1} — `{QUESTION_TITLE}`（来源：`{SOURCE_DOCS}`）

- **影响范围**：`{IMPACT_SCOPE}`
- **为什么必须确认**：`{WHY_CONFIRMATION_IS_REQUIRED}`
- **当前建议 / 倾向**：`{CURRENT_RECOMMENDATION}`
- **Reasoning**：`{PLAIN_LANGUAGE_REASONING_FOR_OWNER}`

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`{OWNER_FACING_QUESTION}`
- **业主回答**：

---

## 2. `{DECISION_CLUSTER_2}`

### Q{N+2} — `{QUESTION_TITLE}`（来源：`{SOURCE_DOCS}`）

- **影响范围**：`{IMPACT_SCOPE}`
- **为什么必须确认**：`{WHY_CONFIRMATION_IS_REQUIRED}`
- **当前建议 / 倾向**：`{CURRENT_RECOMMENDATION}`
- **Reasoning**：`{PLAIN_LANGUAGE_REASONING_FOR_OWNER}`

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`{OWNER_FACING_QUESTION}`
- **业主回答**：

### Q{N+3} — `{QUESTION_TITLE}`（来源：`{SOURCE_DOCS}`）

- **影响范围**：`{IMPACT_SCOPE}`
- **为什么必须确认**：`{WHY_CONFIRMATION_IS_REQUIRED}`
- **当前建议 / 倾向**：`{CURRENT_RECOMMENDATION}`
- **Reasoning**：`{PLAIN_LANGUAGE_REASONING_FOR_OWNER}`

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`{OWNER_FACING_QUESTION}`
- **业主回答**：

---

## 3. 使用约束

### 3.1 哪些问题应该进入 QNA

- **会直接改变 contract surface、实现边界、执行顺序、验收标准或支持面披露的问题**
- **需要业主 / 架构师拍板，而不是实现阶段自己就能收敛的技术细节**
- **如果不先拍板，就会导致多个后续文档一起漂移的问题**

### 3.2 哪些问题不应进入 QNA

- **实现细节微调**：例如局部命名、内部脚本组织、单个测试文件布局
- **已有 frozen answer 的重复提问**：除非本次要正式推翻旧答案
- **只影响单个函数或单个包内部实现、不会改变外部治理边界的问题**

### 3.3 `Reasoning` 的写法要求

- 要写给**非项目作者、但需要做决策的人**
- 要解释：
  1. **这个问题为什么会出现**
  2. **为什么当前推荐路线更稳**
  3. **如果不拍板，会导致什么工程或业务后果**
- 避免只写“建议这样做”，而不解释其背后的 trade-off

### 3.4 `问题` 的写法要求

- 必须是**业主可以直接作答**的句子
- 尽量避免把多个独立决策捆成一题
- 若问题天然包含两个子决策，需在问题里明确写出“如果确认，请同时回答 X / Y”

### 3.5 `业主回答` 的使用要求

- 业主回答应尽量简洁、明确、可执行
- 一旦填写，应同步成为后续 design / action-plan / review 的唯一口径
- 如果后续要推翻答案，应在同一份 QNA 中追加修订说明，而不是在别处悄悄改口

---

## 4. 最小示例

### Q1 — `{EXAMPLE_QUESTION_TITLE}`（来源：`{EXAMPLE_SOURCE}`）

- **影响范围**：`{PACKAGE_A / DOC_B / PHASE_C}`
- **为什么必须确认**：`{EXAMPLE_WHY_CONFIRM}`
- **当前建议 / 倾向**：`{EXAMPLE_RECOMMENDATION}`
- **Reasoning**：`{EXAMPLE_REASONING_WRITTEN_FOR_OWNER}`

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`{EXAMPLE_OWNER_FACING_QUESTION}`
- **业主回答**：

