# Nano-Agent Contract Freeze Matrix 功能簇设计

> 功能簇: `Contract Freeze Matrix`
> 讨论日期: `2026-04-17`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P0-contract-and-identifier-freeze.md`
> - `docs/design/after-skeleton/P0-identifier-law.md`
> - `docs/design/after-skeleton/P0-nacp-versioning-policy.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

Phase 0 最大的风险不是“没人写 design”，而是**不同人对“现在到底冻结了哪些 surface”有不同想象**。当前 repo 同时存在：

1. 已经在代码里成立的 `nacp-core` / `nacp-session` reality；
2. owner 已明确要替换的 legacy naming；
3. README 中对 multi-round follow-up family 有明确承诺，但旧版 design 曾错误将其放入 deferred；full fake bash、full context compression 仍是 deferred；
4. 后续仍需继续探索的 trace substrate / DDL / public API。

因此必须有一份单独的 freeze matrix，把 “**frozen / frozen with rename / directional only / deferred**” 四种状态写死。

- **项目定位回顾**：nano-agent 当前最需要的是“边界清晰”，而不是“表面上做了很多功能”。
- **本次讨论的前置共识**：
  - 这份 matrix 是 **Phase 0 状态判定的唯一权威来源**；其他 P0 文档解释理由、迁移和 versioning，但不覆盖本表状态。
  - 这份 matrix 只服务 internal runtime truth。
  - 未进入 matrix 的 surface，不得被默认为已冻结。
  - `trace_uuid` 与 UUID-only naming law 必须被显式纳入 matrix。
  - Deferred 不等于放弃，只是明确不在本阶段闭合。
- **显式排除的讨论范围**：
  - 不讨论具体 PR 排期
  - 不讨论 frontend/public API 细节
  - 不讨论业务数据库 schema

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Contract Freeze Matrix`
- **一句话定义**：它是一份 Phase 0 的合同状态总表，用来标记 nano-agent 各内部 surface 当前属于“已冻结”“冻结但需 rename”“只冻结方向”“明确延后”中的哪一种。
- **边界描述**：**包含** core/session/internal seam/observability naming/translation zone 的状态判定；**不包含** public API、业务 DDL、下一阶段扩展功能的详细设计。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **Frozen** | 当前 shape 可继续作为稳定真相使用 | 后续变更必须走 versioning policy |
| **Frozen with Rename** | 语义与边界已冻结，但字段命名需先完成 owner-aligned rename | Phase 0 迁移后即进入 Frozen |
| **Directional Only** | 方向已定，但具体实现/物理落点未定 | 例如 observability substrate |
| **Deferred** | 明确不在本阶段闭合 | 例如 public API / business DDL |

### 1.2 参考调查报告

- `docs/investigation/mini-agent-by-opus.md` — 几乎没有显式 freeze matrix
- `docs/investigation/codex-by-opus.md` — 更像代码分层与 trace discipline 自带边界
- `docs/investigation/claude-code-by-opus.md` — 大量 runtime conventions，但并无单一 freeze matrix

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **边界状态看板**。
- 它服务于：
  1. 业主与实现者对齐
  2. action-plan 编排
  3. review / code-review / re-review 收口
- 它依赖：
  - contract freeze 设计
  - identifier law
  - versioning policy
  - 当前包代码 reality
- 它被谁依赖：
  - 后续所有 Phase 0/1 实施 PR
  - 未来 public API / DDL 设计的起点

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `Contract & Identifier Freeze` | 双向 | 强 | matrix 是其执行视图 |
| `Identifier Law` | 双向 | 强 | rename 状态直接影响 matrix 判定 |
| `NACP Versioning Policy` | 双向 | 强 | Frozen/Frozen with Rename 的后续演进由 versioning policy 接管 |
| `NACP-Core` | Matrix -> Core | 强 | header/trace/control/refs 都需要落位 |
| `NACP-Session` | Matrix -> Session | 强 | message family / event kinds / frame 都要有状态 |
| `Observability` | Matrix -> Observability | 中 | 需区分命名冻结与 substrate 未定 |
| `LLM Wrapper / Hooks / Capability Runtime` | Matrix -> Runtime | 中 | 只明确其应消费哪些 frozen seams |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Contract Freeze Matrix` 是 **Phase 0 的边界状态看板**，负责 **把各内部 surface 的冻结状态一次性标明**，对上游提供 **清晰的 in-scope / deferred 口径**，对下游要求 **不要在未冻结 surface 上继续扩大实现面**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 把所有未来想法都写成 frozen | 常见愿景型计划 | 会制造虚假稳定感 | 否 |
| 只写 prose 不写状态 | 常见设计文档习惯 | 很难支撑执行与 review | 否 |
| 把 rename 与 deferred 混在一起 | 当前风险点 | 会让实现者误解“这到底是要改还是不要做” | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| Freeze status enum | `Frozen / FrozenWithRename / Directional / Deferred` | 先用于文档与 review | 未来用于 release checklist |
| Surface registry | matrix table | 先覆盖 core/session/internal seam | 未来扩展到 public API / DDL |
| Evidence link | 文档中引用代码位置 | 手工维护 | 未来自动化生成 |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：surface 状态判定 vs 实施顺序
- **解耦原因**：某个 surface 可能已经 frozen，但 implementation 还没全部跟上 rename。
- **依赖边界**：matrix 负责“状态”，action-plan 负责“顺序”。

- **解耦对象**：directional observability contract vs substrate selection
- **解耦原因**：命名与 anchor law 可以先冻，D1/DO/R2 物理落点仍可调查。
- **依赖边界**：Directional Only 用来明确“方向稳定、实现未决”。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：所有当前阶段 surface 的状态判定
- **聚合形式**：单一 freeze matrix 表
- **为什么不能分散**：一旦分散在多个 design 角落，执行阶段就会重新出现“这块到底算不算 in-scope”的争论。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：以可运行优先，没有显式状态矩阵。
- **亮点**：
  - 项目小，靠直接认知也能勉强 hold 住
- **值得借鉴**：
  - matrix 不必做成庞大流程工具
- **不打算照抄的地方**：
  - 不继续依赖“作者脑内 freeze matrix”

### 4.2 codex 的做法

- **实现概要**：更多通过模块分层与严格 tracing/runtime interfaces 表达边界。
- **亮点**：
  - 边界清晰，多数状态无需额外文档也能从代码看懂
- **值得借鉴**：
  - 真正 frozen 的东西应尽量代码/文档一致
- **不打算照抄的地方**：
  - nano-agent 当前还没达到那种成熟度，需要先用 matrix 外显治理

### 4.3 claude-code 的做法

- **实现概要**：用强 runtime conventions 与丰富 telemetry 保持系统可演化。
- **亮点**：
  - “哪里是稳定边界”通常能从事件面与 orchestration 看出来
- **值得借鉴**：
  - matrix 应只记录对执行真正有价值的 stable seam
- **不打算照抄的地方**：
  - 不用庞大的 convention 代替阶段性 freeze matrix

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| 边界状态显式化 | 低 | 中 | 中 | 高 |
| 对早期团队协作友好度 | 中 | 中 | 中 | 高 |
| 与 Phase 治理的贴合度 | 低 | 中 | 中 | 高 |
| 实施约束力度 | 低 | 高 | 中高 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] 给 core/session/internal seam 列状态**：这些是当前最关键的 contract 面。
- **[S2] 给 observability naming / trace anchor 列状态**：命名与 anchor law 必须进矩阵。
- **[S3] 给 deferred surfaces 单列**：防止后续误入本阶段。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] public API freeze matrix**：下一阶段再引入。
- **[O2] business DDL freeze matrix**：当前没有足够 runtime evidence。
- **[O3] 全量 capability catalog freeze matrix**：本阶段只明确 contract seam，不冻结完整能力面。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `NACP-Session` 当前 7 message types | in-scope | 已有代码 reality，必须列状态 |
| `session.stream.event` 未来更多 kinds | out-of-scope | 扩展面延后 |
| trace substrate 物理选型 | out-of-scope / directional only | 方向要写，物理实现暂不冻结 |
| `NacpRef` tenancy key rule | in-scope | 已是现有核心 contract |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **用 matrix 明确状态** 而不是 **让人从多份文档自己推断**
   - **为什么**：当前阶段涉及 owner 决策、旧代码 reality、未来 deferred surface，靠脑补最容易出错。
   - **我们接受的代价**：需要持续维护一份总表。
   - **未来重评条件**：等系统成熟到边界几乎全靠代码自明时，可弱化 matrix。

2. **取舍 2**：我们选择 **把 rename 单列成状态** 而不是 **简单写 frozen**
   - **为什么**：当前最大风险恰恰是“边界是对的，但名字不对”。
   - **我们接受的代价**：状态表会更细。
   - **未来重评条件**：rename batch 完成后，这些项统一升级为 Frozen。

3. **取舍 3**：我们选择 **Directional Only** 而不是 **要么 frozen 要么 deferred 的二元划分**
   - **为什么**：像 trace anchor / observability 这类东西，命名法与职责已定，但 substrate 还要调查。
   - **我们接受的代价**：需要额外解释什么叫 directional。
   - **未来重评条件**：substrate 决策完成后，Directional Only 再转 Frozen。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| matrix 过期 | 代码演进后不更新 | 误导执行 | 将 matrix 作为每轮 design/re-review 的更新点 |
| 状态定义不清 | Frozen 与 Directional 混淆 | 争论重复出现 | 在文档开头定义状态枚举 |
| 表过大难读 | 覆盖面太广 | 失去可用性 | 只纳入当前 Phase 0 真正相关 surfaces |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：执行时少问“这个现在要不要做”。
- **对 nano-agent 的长期演进**：每个阶段都能继承一个明确的边界账本。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：减少边界争论，把讨论时间留给真正的能力建设。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Core Freeze Matrix | 标定 `nacp-core` 各子面状态 | header/authority/trace/control/refs 有明确状态 |
| F2 | Session Freeze Matrix | 标定 `nacp-session` 各子面状态 | message family / frame / stream event 有明确状态 |
| F3 | Runtime Seam Matrix | 标定 observability / translation zone / public seam 状态 | 所有人知道哪些只冻结方向，哪些延后 |
| F4 | Review Gate Matrix | 给 code review 一个直接判据 | PR 能据此判断是否越界 |

### 7.2 详细阐述

#### F1: `Core Freeze Matrix`

- **输入**：`packages/nacp-core/src/envelope.ts` / `version.ts`
- **输出**：core 各 section 的状态表
- **主要调用者**：`nacp-core`、跨包消费者
- **核心逻辑**：
  - `header`: Frozen（A1 P2 已完成 `producer_id -> producer_key`, `consumer_hint -> consumer_key` rename）
  - `authority`: Frozen（A1 P2 已完成 `stamped_by -> stamped_by_key` rename）
  - `trace`: Frozen（A1 P2 已完成 `trace_id/stream_id/span_id -> *_uuid` rename）
  - `control`: Frozen（A1 P2 已完成 `reply_to -> reply_to_message_uuid` rename）
  - `refs`: Frozen（tenant-scoped key rule 已明确）
- **边界情况**：
  - `extra` 只冻结为 safety valve，不扩张语义
- **一句话收口目标**：✅ **`core 每个 section 都有明确状态，而不是一锅端`**

#### F2: `Session Freeze Matrix`

- **输入**：`packages/nacp-session/src/messages.ts` / `frame.ts` / `ingress.ts` / `websocket.ts`
- **输出**：session profile 状态表
- **主要调用者**：session runtime、client protocol reviewers
- **核心逻辑**：
  - v1 session message family widened 至 8 kinds（`session.start/resume/cancel/end/stream.event/stream.ack/heartbeat/followup_input`）：Frozen
  - `session_frame`: Frozen（A1 P3 已完成 `stream_id -> stream_uuid` rename）
  - `SessionContext`: Frozen（A1 P3 已完成 `trace_uuid / producer_key / stamped_by_key` rename）
  - formal follow-up / multi-round family：Frozen（A1 P3 已把最小 shape `session.followup_input.body = { text, context_ref?, stream_seq? }` 正式纳入 v1；queue/replace/merge 仍属于 out-of-scope 扩张）
- **边界情况**：
  - 当前 reality 被冻住，不代表 future v2 family 可以跳过 Phase 0 直接在 runtime 私造
- **一句话收口目标**：✅ **`session 现在到底冻了哪些消息与字段，一眼可见`**

#### F3: `Runtime Seam Matrix`

- **输入**：observability envelope、LLM/provider adapters、public seam decisions
- **输出**：Directional / Deferred 状态表
- **主要调用者**：observability、llm-wrapper、future API design
- **核心逻辑**：
  - observability trace naming：Directional Only（命名 law 已定，substrate 未定）
  - provider raw IDs：Deferred to translation zone only
  - public API / DDL：Deferred
- **边界情况**：
  - truly platform-level alerts 可作为 trace_uuid 例外单独注明
- **一句话收口目标**：✅ **`方向已定但实现未定的 surface，不再被误认为已冻结`**

#### F4: `Review Gate Matrix`

- **输入**：所有 PR 涉及的 contract diff
- **输出**：越界/合法的快速判断依据
- **主要调用者**：code review、owner review
- **核心逻辑**：凡触碰 Frozen surface 的 breaking 变更，一律需要 versioning policy + migration plan；凡触碰 Deferred surface 的新增，一律回到 phase discussion。
- **边界情况**：
  - docs wording update 不算 matrix change
- **一句话收口目标**：✅ **`matrix 可以直接被拿来做 review gate，而不只是说明文`**

### 7.3 非功能性要求

- **性能目标**：无。
- **可观测性要求**：每个状态项都应能追溯到代码证据。
- **稳定性要求**：matrix 与 plan/design/review 文档口径保持一致。
- **测试覆盖要求**：后续 contract tests 应围绕 matrix 的 Frozen 项建立。

### 7.4 Freeze Matrix 本体

| Surface | 当前代码 reality | Phase 0 状态 | 备注 |
|--------|------------------|--------------|------|
| `core.header` | `producer_key` / `consumer_key` 已落位，`schema_version = 1.1.0` | Frozen | rename 完成，迁移由 `migrate_v1_0_to_v1_1` 承担 |
| `core.authority` | `stamped_by_key` 已落位 | Frozen | bare handle 已退出 canonical |
| `core.trace` | `trace_uuid / stream_uuid / span_uuid` 已落位 | Frozen | `trace_uuid` 是唯一 canonical trace identity |
| `core.control` | `reply_to_message_uuid` 已落位 | Frozen | 显式关联 message |
| `core.refs` | 已稳定 | Frozen | `tenants/{team_uuid}/` 规则已明确 |
| `core.extra` | safety valve | Frozen | 不扩张语义 |
| `session message family v1` | widened 至 8 kinds（含 `session.followup_input`） | Frozen | Q1+Q8 最小冻结 shape 落地；更丰富的 queue/replace/merge 留到下一阶段 |
| `session frame` | `stream_uuid` 已落位 | Frozen | 命名已与 law 对齐 |
| `session stream event current catalog` | 当前 reality 已存在 | Frozen | 不在本阶段扩展事件面 |
| `formal follow-up / multi-round input family` | `session.followup_input` 已正式进入 `nacp-session` 真相层 | Frozen | 仅覆盖单条 client-produced shape；queue semantics 留给后续阶段 |
| `observability trace naming` | `trace_uuid` 已成为 core canonical，observability 接线在 P2 | Directional Only | 命名法已冻结；substrate 仍走 P1 decision memo |
| `provider raw IDs` | adapter 内部已有 `tool_call_id`（带 translation-zone 注释） | Deferred to translation zone | 不能进 canonical model |
| `public API / frontend contract` | 未定 | Deferred | 下一阶段首个工作流 |
| `business DDL / registry schema` | 未定 | Deferred | 等 runtime evidence 后再做 |

**Gate note (A1 收口后同步 — 2026-04-18)**

- A1 Phase 2/3 已把 `core.trace`、`session frame`、`SessionContext` 的 identifier-law rename 全部落地；后续 phase（P2 / P3 / P4 / P6）可以直接把 `trace_uuid` 当作 **跨包已成立的 canonical reality**，不再需要把它视为「尚未 migration 的 target law」。
- 退出点由 A1 P5 的 baseline cut + `NACP_VERSION = "1.1.0"` / `NACP_VERSION_KIND = "frozen"` 标记；这两个常量与 `migrate_v1_0_to_v1_1` compat shim 一同构成 Layer 0 的 「1.0 payload 自动升级到 1.1」路径，让 pre-freeze client 仍可继续工作。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/logger.py:43-83` | 早期项目常靠“日志即事实” | 说明缺 matrix 时会默认用实现细节做口径 | 正是我们要避免的 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/otel/src/trace_context.rs:19-47` | trace context surface 很明确 | 某些高价值 surface 必须足够稳定 | freeze matrix 需要抓住这些“必须稳定”的面 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/utils/telemetry/events.ts:42-74` | 统一事件骨架 | matrix 应优先覆盖这种高复用骨架面 | 不必覆盖所有细枝末节 |

### 8.4 需要避开的“反例”位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `packages/nacp-session/src/messages.ts:10-84` | 当前 reality 明确，但若没有 matrix，未来很容易继续在 runtime 层私造 follow-up wire | 需要明确写成“当前 reality Frozen + formal follow-up family 必须由 Phase 0 协议扩展补位” |
| `packages/nacp-core/src/observability/envelope.ts:12-20` | naming law 与 observability 口径尚未完全收敛 | 说明有些面只能先标 Directional Only |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`Contract Freeze Matrix` 是一份高密度、低篇幅、直接服务执行的治理文档。它不负责深挖每个问题的来龙去脉，而是负责告诉团队：现在哪些 surface 可以放心依赖，哪些只是方向已定，哪些明确不能在本阶段继续扩展。它的价值不在于“写了多少字”，而在于能否减少未来的边界争论。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 当前阶段最需要清晰边界 |
| 第一版实现的性价比 | 5 | 成本极低，但能显著降低协作摩擦 |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 4 | 主要是治理杠杆，但非常关键 |
| 对开发者自己的日用友好度 | 5 | 直接减少“这块算不算现在做”的争论 |
| 风险可控程度 | 5 | 风险主要来自不维护，而不是文档本身 |
| **综合价值** | **5** | **是 Phase 0 执行与评审的必要看板** |

### 9.3 下一步行动

- [x] **决策确认**：matrix 中 `Frozen / Directional Only / Deferred` 的状态划分已在 A1 Phase 0 完成；执行后 `Frozen with Rename` 已全部转为 `Frozen`。
- [x] **关联 Issue / PR**：A1-contract-and-identifier-freeze.md 已逐项对齐本 matrix；后续 rename PR 不再新增。
- [ ] **待深入调查的子问题**：
  - [ ] observability alert 的 `trace_uuid` 例外条件在 A3 observability 落地时再评估是否单独列成一项。
- [x] **需要更新的其他设计文档**：已同步
  - `A1-contract-and-identifier-freeze.md`（执行计划 + 已知限制回填）
  - `P0-identifier-law.md`（§9.3 已转为 closed checklist）
  - `P0-nacp-versioning-policy.md`（§3 预期状态 + §9.3 checklist 同步）

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：是否只靠 prose design，不单独做 matrix
  - **A 方观点**：已有 design 足够
  - **B 方观点**：没有状态矩阵就无法直接指导执行
  - **最终共识**：matrix 作为单独文档保留

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.2 | `2026-04-18` | `GPT-5.4` | 根据 PX-QNA Q8 将 formal follow-up input family 从 Deferred 调整为 Directional Only，并要求其在 Phase 0 结束前被冻结 |
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
