# Nano-Agent Contract & Identifier Freeze 功能簇设计

> 功能簇: `Contract & Identifier Freeze`
> 讨论日期: `2026-04-17`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/plan-after-skeleton.md`
> - `docs/plan-after-skeleton-reviewed-by-opus.md`
> - `README.md`
> - `docs/design/after-skeleton/P0-nacp-versioning-policy.md`
> - `docs/design/after-skeleton/P0-identifier-law.md`
> - `docs/design/after-skeleton/P0-contract-freeze-matrix.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

当前 `nano-agent` 已完成 skeleton 与第一轮 runtime 骨架，但协议层仍存在一个明确断口：**代码里已经有一套 `nacp-core` / `nacp-session` reality，业主又已经给出了新的 Phase 0 约束（`trace_uuid` canonical、UUID-only internal identity law、formal multi-round input family 必须纳入 Phase 0 contract freeze）**。如果现在不先做一次 Contract & Identifier Freeze，后续 Phase 1-7 的 observability、session runtime、hooks、LLM wrapper、storage topology 都会在不稳定边界上继续生长，造成成倍返工。

- **项目定位回顾**：nano-agent 是一个吸收 mini-agent / codex / claude-code 长处、供我们自己使用的极精简 agent runtime；未来重点深耕 **上下文管理 / Skill / 稳定性**。
- **本次讨论的前置共识**：
  - nano-agent 运行在 Cloudflare Worker / Durable Object / WebSocket-first 架构里，不以 Linux / shell / 本地 FS 为宿主真相。
  - `nacp-core` 是内部 envelope truth，`nacp-session` 是 client-visible session profile truth。
  - `trace_uuid` 是后续唯一 canonical trace identity；任何内部请求链路都不应再引入新的 `trace_id` 事实。
  - 所有 internal identity-bearing 字段应收敛到 `*_uuid`；非 UUID 的稳定句柄必须显式标注为 `*_key` / `*_name`，不能继续混在 `*_id` 里。
  - multi-round input family 不再属于 deferred bucket；它必须在 `nacp-session` 层被纳入 Phase 0 的 formal contract freeze，而不是留给 `session-do-runtime` 私造消息。
  - 完整 fake bash 扩展、完整 context compression 架构仍延后到下一阶段。
  - `P0-contract-freeze-matrix.md` 是 Phase 0 状态判定的**唯一权威 matrix**；本文件负责解释 freeze rationale、migration scope 与治理 handoff，而不是维护第二份 competing matrix。
- **显式排除的讨论范围**：
  - 不讨论 public API / frontend API 的最终产品接口
  - 不讨论业务 DDL / registry schema / analytics warehouse 设计
  - 不讨论 fake bash 命令集细节
  - 不讨论完整 observability substrate 选型

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Contract & Identifier Freeze`
- **一句话定义**：这是 post-skeleton 第一阶段的**边界冻结层**，负责把 nano-agent 当前已知、已验证、必须稳定的内部合同面与标识命名法一次性收敛，避免后续包继续在漂移的 schema 上开发。
- **边界描述**：这个功能簇**包含** `nacp-core` / `nacp-session` / internal runtime seam 的冻结范围判定、identifier migration rules、versioning handoff、freeze matrix；**不包含** public API 设计、业务存储模型、provider-specific wire protocol、下一阶段能力扩展。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **Contract Surface** | 当前阶段承诺稳定的字段、消息类型、事件类型、helper 语义总和 | 不是“所有代码”，而是“必须减少波动的那部分代码” |
| **Freeze Cut** | Phase 0 完成后产生的第一版 owner-aligned frozen baseline | 是后续 action-plan 与 review 的判定基线 |
| **Identifier Law** | 对 `*_uuid` / `*_key` / `*_name` / `*_ref` 等命名后缀的强约束 | 见 `identifier-law.md` |
| **Translation Zone** | 允许保留外部系统原生命名的边界层 | 例如 OpenAI `tool_call_id` 只能存在于 adapter 内 |
| **Deferred Surface** | 明知将来会做，但本阶段刻意不冻结的功能面 | 例如 public API / business DDL |
| **Contract Matrix** | 用来标明“现在冻结 / 只冻结方向 / 明确延后”的矩阵 | 见 `contract-freeze-matrix.md` |

### 1.2 参考调查报告

- `docs/investigation/mini-agent-by-opus.md` — mini-agent 以单体 Python runtime 为主，协议冻结极弱
- `docs/investigation/codex-by-opus.md` — codex 拥有更强的 runtime/state/trace discipline，但内部 contract surface 更偏工程实现而非统一矩阵
- `docs/investigation/claude-code-by-opus.md` — claude-code 在 hooks / telemetry / tool orchestration 上极强，但很多 contract 更像 runtime convention，而不是单一 envelope family

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **Phase 0 治理基线** 的角色。
- 它服务于：
  1. `nacp-core`
  2. `nacp-session`
  3. 未来所有 build 在 NACP 上的 runtime packages
  4. review / tests / observability / deploy wiring
- 它依赖：
  - 当前 repo 内已经存在的 `nacp-core` / `nacp-session` reality
  - owner 对 `trace_uuid` / UUID-only naming / phase ordering 的决策
  - 对标样本中可复用的 versioning / trace / event discipline
- 它被谁依赖：
  - `session-do-runtime`
  - `agent-runtime-kernel`
  - `hooks`
  - `llm-wrapper`
  - `storage-topology`
  - 所有 cross-package contract tests

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `NACP-Core` | Freeze -> Core | 强 | `header / authority / trace / control / refs` 都是冻结重点 |
| `NACP-Session` | Freeze -> Session | 强 | Session message family / stream frame / event catalog 必须纳入矩阵 |
| `Eval / Observability` | 双向 | 强 | trace_uuid law 与 durable audit shape 依赖 freeze 结果 |
| `Session DO Runtime` | Freeze -> Runtime | 强 | ingress / resume / replay / checkpoint 都必须建立在稳定 contract 上 |
| `LLM Wrapper` | Freeze -> Wrapper | 中 | canonical internal IDs 与 provider translation zone 需要冻结 |
| `Hooks` | Freeze -> Hooks | 中 | hook emit / audit record 的 envelope shape 受 freeze 约束 |
| `Storage Topology` | Freeze -> Storage | 中 | refs / tenancy path / trace anchor naming 依赖 frozen contract |
| `Frontend / Public API` | Freeze -> Public | 弱 | 只冻结内核边界，不等于 public API 已经定稿 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Contract & Identifier Freeze` 是 **post-skeleton 的边界治理层**，负责 **把已知的 NACP 内核合同与标识命名法一次性收敛成稳定基线**，对上游提供 **明确的 frozen / deferred 边界**，对下游要求 **不要再在漂移字段与漂移命名上继续扩展功能**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 一上来冻结完整 public API | 常见平台产品做法 | 当前 nano-agent 仍在 runtime closure 阶段，先冻结内核边界更重要 | 可能 |
| 一上来冻结 business DDL | 常见后端平台做法 | 会把尚未稳定的 runtime usage pattern 过早固化 | 可能 |
| 继续容忍 `trace_id` / `*_id` 混用 | 当前仓内遗留 reality | 会把命名漂移扩散到更多包 | 否 |
| 先做最小 contract、以后再慢慢补 | 低治理成本路径 | 业主已明确要求“在认知边界内最大限度冻结 known surface” | 否 |
| 把 provider/raw API 字段直接带进 canonical internal model | 本地 CLI 常见偷懒路径 | 会让外部 wire 污染内部 contracts | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| Contract registry | `docs/design/after-skeleton/*.md` + schema comments | 文档与 schema 同步冻结 | 生成 schema docs / lints |
| Migration chain | `packages/nacp-core/src/compat/*` | 先支持 Phase 0 normalization batch | 跨 minor 自动迁移 |
| Translation zone | adapter-local raw type | 仅允许外部 provider/raw protocol 使用 | 更细的 provider registry |
| Freeze matrix | `contract-freeze-matrix.md` | 标明 frozen / partial / deferred | 变成 release checklist |
| Identifier helpers | `*_uuid` / `*_key` parser & lint rule | 先建规则 | 未来建 codemod / schema generators |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：Contract freeze vs public API design
- **解耦原因**：内部 runtime closure 的冻结节奏，不能被 frontend / product API 的讨论绑架。
- **依赖边界**：Phase 0 只冻结 internal runtime truth；public API 只消费 frozen internal seams。

- **解耦对象**：Identifier law vs provider-specific raw fields
- **解耦原因**：OpenAI / browser / gateway 的外部字段不应成为 nano-agent 内核命名真相。
- **依赖边界**：raw fields 只允许停留在 translation zone。

- **解耦对象**：Contract matrix vs versioning policy
- **解耦原因**：一个回答“冻结什么”，一个回答“以后怎么演进”，两者都重要，但不能写成一坨。
- **依赖边界**：matrix 标注 surface；versioning policy 给出 change class 与 migration rules。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：所有 internal contract 的最终口径
- **聚合形式**：`contract-and-identifier-freeze.md` + `identifier-law.md` + `nacp-versioning-policy.md` + `contract-freeze-matrix.md`
- **为什么不能分散**：如果 contract、naming、versioning、freeze status 分散在十几份 design / README / tests 里，Phase 1 之后必然再次出现口径漂移。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：mini-agent 以单进程 Python runtime 为核心，日志与 tool/LLM request 都在本地对象模型里流转，协议化程度很低。
- **亮点**：
  - 结构直接，初期推进速度快
  - 日志记录简单易读
- **值得借鉴**：
  - 在早期阶段保持 execution model 简洁
  - 不为“形式上的协议完整”过度设计
- **不打算照抄的地方**：
  - 没有强 trace / version / identifier law
  - tool / LLM IDs 直接混在业务对象里，难以支撑 DO + WebSocket + replay

### 4.2 codex 的做法

- **实现概要**：codex 在 state、tool registry、trace propagation 上有很强的工程纪律，尤其重视 trace context 的显式传播。
- **亮点**：
  - trace context 处理严谨
  - runtime state 分层清晰
  - provider / tool / protocol boundary 相对干净
- **值得借鉴**：
  - 把 trace 当一等公民
  - 把 session state 与 turn state / external adapter 明确分离
- **不打算照抄的地方**：
  - 不照抄其本地 CLI /多组件工程体量
  - 不照抄其宿主假设与多层 crate complexity

### 4.3 claude-code 的做法

- **实现概要**：claude-code 在 hooks、telemetry、tool orchestration 上极其成熟，但很多 contract 是通过 runtime conventions、telemetry attributes、tool plumbing 体现，而不是统一 envelope family。
- **亮点**：
  - 事件面丰富
  - telemetry 粒度高
  - 真实生产环境打磨充分
- **值得借鉴**：
  - 事件命名与 telemetry discipline
  - 对 gateway / API logging / sequence 的细腻处理
- **不打算照抄的地方**：
  - 不复制其庞大事件面
  - 不把 runtime convention 当成我们内部协议的替代品

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| 合同显式度 | 低 | 中高 | 中 | 高 |
| 标识命名纪律 | 低 | 中 | 中 | 高 |
| 版本迁移治理 | 低 | 中 | 中 | 高 |
| Trace 一等公民程度 | 低 | 高 | 中高 | 高 |
| 对未来 context/skill 稳定性的支撑 | 低 | 高 | 中高 | 高 |
| 第一版实现成本 | 低 | 高 | 高 | 中 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] 冻结已知 internal contract surface**：`nacp-core` / `nacp-session` / internal runtime seam 必须在进入 Phase 1 之前止血。
- **[S2] 冻结 identifier law**：所有新包如果继续在 `trace_id` / `producer_id` / `stream_id` 上扩展，会把后续成本放大。
- **[S3] 明确 frozen / deferred matrix**：避免“大家都以为这个要做 / 不做”的灰区。
- **[S4] 给出 versioning handoff**：否则 Phase 0 的 rename batch 完成后，未来仍不知道什么变化算 breaking。
- **[S5] 把 formal follow-up input family 从 deferred bucket 移入 `nacp-session` contract freeze**：Q8 已确认 v1 contract surface 不能把 multi-round 继续留给下一阶段。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] Public API / frontend adaptation contract**：这是下一阶段的第一工作流，不是 Phase 0 的任务。
- **[O2] Business DDL / registry persistence**：当前更重要的是 runtime truth，而不是把未来数据库提前拍死。
- **[O3] multi-round turn scheduling / queue semantics beyond protocol freeze**：本阶段先冻结 input family，不在这里把完整调度语义一起拍死。
- **[O4] Full fake bash / full context compression**：本阶段只冻结边界，不扩张功能面。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `session.start` / `session.resume` 当前 shape | in-scope | 已经在代码中存在，必须冻结 |
| formal follow-up user input family | in-scope | Q8 已确认必须纳入 Phase 0，避免 API v1 → v2 断层 |
| `trace_uuid` 命名迁移 | in-scope | 属于 owner 直接决策，不是未来探索项 |
| provider raw response IDs | out-of-scope | 仅允许在 translation zone 存在 |
| observability trace anchor 的字段命名 | in-scope | 与 `trace_uuid` law 强耦合 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **最大限度冻结已知 surface** 而不是 **只做最小 contract**
   - **为什么**：业主已经明确要求“在认知边界内提供最大的 contract 定义”，这能显著减少 Phase 1 之后的协议摆动。
   - **我们接受的代价**：Phase 0 文档与迁移工作量会更大。
   - **未来重评条件**：只有当某个 surface 事实证明还没有足够证据时，才会从 frozen 降到 deferred。

2. **取舍 2**：我们选择 **现在一次性处理 `trace_uuid` / `*_uuid` / `*_key` 重命名** 而不是 **长期保留 alias**
   - **为什么**：持续别名兼容会把 schema、tests、docs、adapter、observability 全部拖进双语状态。
   - **我们接受的代价**：当前代码与测试会经历一轮明确的 breaking migration。
   - **未来重评条件**：仅在外部已存在真实消费者时，才讨论短期 alias window。

3. **取舍 3**：我们选择 **只冻结 internal runtime contract** 而不是 **把 public API / DDL 一并做完**
   - **为什么**：runtime 不闭合时，先做 public interface 只会引入更大返工。
   - **我们接受的代价**：前端适配与数据建模要稍后才能最终定稿。
   - **未来重评条件**：Phase 0 与 Phase 1 结束后，才进入 public API / DDL 设计。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| 文档冻结过度，实际实现仍改动大 | 对代码 reality 读得不够深 | 设计失真 | 以当前 `nacp-core` / `nacp-session` 代码为 primary evidence |
| 命名迁移范围过大 | `_id` 遗留点散落到多个包 | 实施成本上升 | 用 matrix 列全量迁移面，先改 canonical packages |
| 开发者误以为 public API 也已冻结 | 只看标题不看范围 | 误导前端与集成方 | 在 matrix 中单列 deferred public surface |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：后续每个包都能在一个稳定、单一口径上开发，不再一边写一边猜字段名。
- **对 nano-agent 的长期演进**：后续的 context、skill、observability 都能挂在清晰的 `trace_uuid + *_uuid/*_key` 语义上。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：这次 freeze 本质上是在给未来所有深耕方向铺一条不会再次塌方的协议地基。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Contract Inventory | 列清 `nacp-core` / `nacp-session` / internal seam 的当前合同面 | Phase 0 结束时，所有 frozen surface 都有明确归档 |
| F2 | Identifier Normalization | 冻结 `trace_uuid` / `*_uuid` / `*_key` 迁移原则 | 新旧命名不会再并存于 canonical model |
| F3 | Deferred Surface Registry | 记录明确延后的功能面 | 任何后续 PR 都不能误把 deferred surface 混进 Phase 0 |
| F4 | Freeze Governance | 建立 versioning / review / test handoff | 后续 contract 变更都能被分级为 additive / breaking |

### 7.2 详细阐述

#### F1: `Contract Inventory`

- **输入**：当前 `nacp-core`、`nacp-session`、已存在 cross-package contract tests
- **输出**：一份明确的 frozen surface 列表与一份 deferred surface 列表
- **主要调用者**：Phase 0 owner review、后续 action-plan
- **核心逻辑**：先以代码 reality 为准，再用 owner 决策修正命名与 phase boundary，最后写成 matrix。
- **实现约束**：状态判定以 `P0-contract-freeze-matrix.md` 为唯一 truth；本文件只解释为什么这些 surface 应被纳入、为什么某些 surface 必须延后。
- **边界情况**：
  - 文档里提到但代码里还没落地的内容，不得直接标记 frozen
  - `follow-up input family` 已不再属于 deferred expansion；它必须作为本阶段必须补齐的 `nacp-session` contract surface 被单独追踪
- **一句话收口目标**：✅ **`所有当前要继续依赖的 internal contract，都能在 matrix 里被准确找到`**

#### F2: `Identifier Normalization`

- **输入**：`trace_id` / `producer_id` / `stream_id` / `span_id` / `tool_call_id` 等遗留命名
- **输出**：canonical internal naming law 与 translation zone 边界
- **主要调用者**：`nacp-core` / `nacp-session` / `llm-wrapper` / observability
- **核心逻辑**：UUID 身份统一进 `*_uuid`，非 UUID 机器句柄统一进 `*_key`，provider raw IDs 不得穿透 canonical layer。
- **迁移约束**：这是一轮显式 breaking normalization batch，必须通过 `P0-nacp-versioning-policy.md` 中定义的 compat/migration chain 落地，而不是假装当前代码 reality 已天然符合新 law。
- **边界情况**：
  - provider adapter 可保留 raw `tool_call_id`
  - observability 的非请求级平台警报可临时允许没有 `trace_uuid`
- **一句话收口目标**：✅ **`canonical internal code 中不再新增任何新的 *_id 命名`**

#### F3: `Deferred Surface Registry`

- **输入**：业主的 out-of-scope 决策与现有 README / plan 口径
- **输出**：被明确延后的 surface 名录
- **主要调用者**：Phase 1-7 规划与代码审查
- **核心逻辑**：把“将来会做，但现在不做”的东西单列出来，减少争论空间；同时把已经被业主从 deferred bucket 中移出的 surface（尤其是 formal follow-up input family）显式排除在该名录之外。
- **边界情况**：
  - “当前 reality 已存在”不等于“当前要扩展”
  - “下一阶段第一工作流”不等于“本阶段 freeze”
- **一句话收口目标**：✅ **`任何 deferred surface 都有清晰的延后理由与回到议程的入口`**

#### F4: `Freeze Governance`

- **输入**：Phase 0 文档、versioning policy、后续 review 纪律
- **输出**：后续 contract 变更的判定方法
- **主要调用者**：代码评审、协议评审、release check
- **核心逻辑**：把 additive / breaking / translation-only 变化的分类标准固定下来。
- **边界情况**：
  - 文档修辞变化不等于 contract 变化
  - raw provider adapter 变化不自动影响 NACP contract version
- **一句话收口目标**：✅ **`后续所有 contract 变更，都能被统一判类而不是靠感觉争论`**

### 7.3 非功能性要求

- **性能目标**：本功能簇以治理为主，无单独 runtime latency 指标。
- **可观测性要求**：所有 freeze / deferred / migration 决策都应可追溯到明确代码事实。
- **稳定性要求**：设计文档必须与当前 repo reality 一致，不能建立在想象中的未来实现之上。
- **测试覆盖要求**：后续代码迁移时需增加 contract tests，验证新命名与 matrix 一致。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/logger.py:53-83` | 直接记录 messages / tools / tool_call_id | 早期阶段可先保持记录面简单 | 但没有版本/trace discipline |
| `context/mini-agent/mini_agent/logger.py:159-175` | append-only log entry | 证明“先把事件记下来”是可行的 | 不足以支撑 multi-tenant replay |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/otel/src/trace_context.rs:19-47` | current span trace context / trace id 提取 | trace 是一等公民，且应可传播 | 很适合 nano-agent 的 trace-first 方向 |
| `context/codex/codex-rs/otel/src/trace_context.rs:49-88` | W3C trace context -> runtime context | external trace 与 internal runtime 之间要有清晰 translation | 我们不照抄其宿主，只吸收 discipline |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/utils/telemetry/events.ts:21-75` | event name / timestamp / sequence / prompt.id 统一注入 | 事件结构必须有稳定公共字段 | 适合 observability side，不等价于 internal envelope |
| `context/claude-code/services/api/logging.ts:65-139` | gateway detection / metadata gathering | 不同外部系统的原生 shape 应停留在 adapter 层 | 说明 translation zone 很有必要 |

### 8.4 需要避开的“反例”位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `packages/nacp-core/src/envelope.ts:83-121` | `message_uuid` / `session_uuid` 与 `producer_id` / `trace_id` / `stream_id` 混用 | 同一 schema 内混合多套命名法，会放大后续迁移成本 |
| `packages/nacp-session/src/websocket.ts:29-37` | `SessionContext` 仍使用 `trace_id` / `producer_id` | 说明 Phase 0 必须先做 naming freeze，否则 runtime 继续扩散遗留命名 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`Contract & Identifier Freeze` 不是一个会直接“对外演示”的大功能，而是 nano-agent post-skeleton 阶段最关键的一层治理地基。它的工作不是增加更多能力，而是把已经确定的 contract surface 停止漂移，把命名法从“历史混用”收敛到“单一真相”，并为 versioning / review / tests 提供统一判尺。代码量本身不会太大，但它会直接决定后续所有包的返工成本和评审噪音。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 这是 Cloudflare-native agent runtime 继续扩展前必须先做的治理动作 |
| 第一版实现的性价比 | 5 | 成本主要是思考与迁移，但能大量减少后续返工 |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 5 | 三条主线都依赖稳定的 contract 与 naming |
| 对开发者自己的日用友好度 | 4 | 短期会更严格，长期会更省脑 |
| 风险可控程度 | 4 | 风险在于迁移范围较大，但边界清晰可控 |
| **综合价值** | **5** | **应被视为 Phase 0 的首要设计治理任务** |

### 9.3 下一步行动

- [ ] **决策确认**：业主确认本设计与 `plan-after-skeleton.md` 口径一致。
- [ ] **关联 Issue / PR**：进入 Phase 0 action-plan 时，先做 canonical field rename 与 contract tests。
- [ ] **待深入调查的子问题**：
  - [ ] `observability envelope` 中非请求级 alert 是否允许无 `trace_uuid`
  - [ ] `reply_to` 是否统一重命名为 `reply_to_message_uuid`
- [ ] **需要更新的其他设计文档**：
  - `docs/design/after-skeleton/P0-nacp-versioning-policy.md`
  - `docs/design/after-skeleton/P0-identifier-law.md`
  - `docs/design/after-skeleton/P0-contract-freeze-matrix.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：是先做最小 contract 还是最大限度冻结 known surface
  - **A 方观点**：先最小化，后面边实现边补
  - **B 方观点**：对已知 surface 立即冻结，减少波动
  - **最终共识**：按业主要求，对已知 surface 做最大限度冻结

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.2 | `2026-04-18` | `GPT-5.4` | 根据 PX-QNA Q8 业主决策，将 formal follow-up input family 从 deferred 调整为 Phase 0 in-scope contract surface |
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
