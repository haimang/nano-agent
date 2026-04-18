# Nano-Agent Identifier Law 功能簇设计

> 功能簇: `Identifier Law`
> 讨论日期: `2026-04-17`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/plan-after-skeleton.md`
> - `docs/plan-after-skeleton-reviewed-by-opus.md`
> - `docs/design/after-skeleton/P0-contract-and-identifier-freeze.md`
> - `docs/design/after-skeleton/P0-contract-freeze-matrix.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

业主已经明确给出两条不可再模糊的法律：**`trace_uuid` 是唯一真理**，以及 **所有 internal identity 必须使用 UUID，并全面取消 `{业务簇}_id` 写法**。而当前 repo reality 仍同时存在 `trace_id`、`producer_id`、`stream_id`、`span_id`、`tool_call_id` 等命名。这不仅是“命名风格不好看”的问题，而是一个会直接污染 contract、observability、storage key、adapter seam、review 纪律的结构性问题。

- **项目定位回顾**：nano-agent 未来要深耕上下文管理、Skill、稳定性，这三件事都依赖清晰的“谁是谁”与“哪个字段到底是不是 UUID identity”。
- **本次讨论的前置共识**：
  - `trace_uuid` 是 canonical trace identity。
  - internal identity-bearing fields 统一收敛到 `*_uuid`。
  - 非 UUID 的稳定句柄必须显式标注为 `*_key`；人类可读标签使用 `*_name`。
  - foreign/provider-native 字段只允许存在于 translation zone。
  - 这套 law 同时约束 **wire snake_case** 与 **TypeScript camelCase** 两种表面；允许 `trace_uuid <-> traceUuid` 的 casing 差异，但不允许 suffix 语义漂移。
- **显式排除的讨论范围**：
  - 不讨论数据库主键是否用 UUIDv4 / UUIDv7
  - 不讨论最终 public API 命名
  - 不讨论业务对象全量建模

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Identifier Law`
- **一句话定义**：这是 nano-agent 对内部标识、句柄、名称、引用等字段命名的强制语义法则，目的是让一个字段名在全仓内表达稳定、单一、不歧义的含义。
- **边界描述**：**包含** suffix taxonomy、forbidden names、translation-zone exception、current field migration map；**不包含** public API naming、任意业务模型的命名细节。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **Canonical UUID** | 用于内部身份、因果链、资源归属的 UUID 字段 | 必须使用 `*_uuid` |
| **Machine Key** | 非 UUID 但稳定的机器句柄/路由键/模块键 | 必须使用 `*_key` |
| **Display Name** | 面向人类阅读的名称 | 必须使用 `*_name` |
| **Reference** | 指向外部存储对象的结构化引用 | 使用 `*_ref` 或 `refs` |
| **Sequence** | 顺序号/偏移量 | 使用 `*_seq` |
| **Foreign ID** | 外部 provider/raw wire 原生字段 | 只能活在 translation zone |
| **Casing Surface** | snake_case wire 字段与 camelCase TypeScript 字段的呈现差异 | 只允许 casing 变换，不允许 suffix 语义变化 |

### 1.2 参考调查报告

- `docs/investigation/mini-agent-by-opus.md` — 本地工具/LLM 对象普遍使用 `*_id`
- `docs/investigation/codex-by-opus.md` — trace / context propagation 较严肃，但未形成“全仓 UUID suffix law”
- `docs/investigation/claude-code-by-opus.md` — 事件与 telemetry 很成熟，但命名体系更多服务实现，不是统一 naming law

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **全仓命名语义守卫**。
- 它服务于：
  1. 协议 schema
  2. runtime state
  3. observability trace/audit
  4. storage refs / checkpoint / snapshot
  5. provider adapters
- 它依赖：
  - owner 对 `trace_uuid` 与 UUID-only identity 的决策
  - 当前代码 reality 中的遗留命名扫描
- 它被谁依赖：
  - 所有未来 schema / types / helpers
  - code review 纪律
  - lint / codemod / cross-package contract tests

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `NACP-Core` | Law -> Core | 强 | 核心 envelope 是命名迁移第一现场 |
| `NACP-Session` | Law -> Session | 强 | stream/frame/ack 都直接受影响 |
| `Eval / Observability` | Law -> Eval | 强 | trace anchor、audit record、alert payload 都需要命名清晰 |
| `LLM Wrapper` | Law -> Wrapper | 中 | provider raw IDs 必须被隔离在 translation zone |
| `Storage Topology` | Law -> Storage | 中 | refs、checkpoint、namespace key 需要与 identity law 配合 |
| `Hooks` | Law -> Hooks | 中 | hook events / outcomes 不能继续引入 `*_id` 漂移 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Identifier Law` 是 **全仓命名语义守卫**，负责 **把 identity / key / name / ref / seq 等字段的含义固定下来**，对上游提供 **单义、可审阅、可 lint 的命名标准**，对下游要求 **canonical internal code 不再混用 `*_id` 与非 UUID identity**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 继续允许 `*_id` 作为泛化后缀 | 多数现有代码库 | 语义过载，根本无法从字段名判断类型 | 否 |
| 用 bare field 表示 actor handle（如 `stamped_by`） | 当前 repo reality | 虽然不是 `_id`，但仍缺语义显式度 | 否 |
| provider raw ID 穿透到 canonical model | OpenAI/SDK 常见做法 | 会污染内部 contract | 否 |
| “之后再统一命名” | 常见延期策略 | 命名债一旦扩散，后续成本指数增长 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| Identifier parsers | `UuidSchema` / `KeySchema` / helper types | 先用于 schema 与 review | 未来做 lint / codemod |
| Translation metadata | `provider_metadata.*` / adapter-local types | 隔离 foreign IDs | richer provider registry |
| Naming checklist | review template / docs | 手工执行 | 自动化 lint |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：internal identity vs external provider correlation
- **解耦原因**：内部因果链必须可控，外部 raw IDs 不受我们控制。
- **依赖边界**：provider correlation 仅在 adapter 元数据中出现，不进入 NACP canonical fields。

- **解耦对象**：identity fields vs storage keys
- **解耦原因**：路径字符串可以包含 UUID，但路径本身不是 identity 字段。
- **依赖边界**：storage 路径使用 `key`，而不是伪装成 `id`。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：suffix taxonomy 与 forbidden names
- **聚合形式**：`identifier-law.md` + schema helpers + review checklist
- **为什么不能分散**：只要同一仓库里有人把 UUID 叫 `id`、有人叫 `uuid`、有人叫 `key`，后续所有 trace/restore/debug 都会变得更难。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：大量使用对象原生字段和 `tool_call_id` 之类的 provider 风格命名。
- **亮点**：
  - 跟模型 API 很贴近
  - 实作速度快
- **值得借鉴**：
  - translation zone 内可以保留 foreign names
- **不打算照抄的地方**：
  - 不把 foreign naming 直接变成 canonical naming

### 4.2 codex 的做法

- **实现概要**：trace propagation 很严格，但 naming law 更偏局部 discipline，而非“全仓 UUID suffix law”。
- **亮点**：
  - 把 trace 视为一等公民
  - W3C trace context 与内部 state 连接清晰
- **值得借鉴**：
  - internal tracing fields 应该保持高置信度、低歧义
- **不打算照抄的地方**：
  - 不满足于只在 tracing 局部严肃，nano-agent 需要全仓命名法

### 4.3 claude-code 的做法

- **实现概要**：prompt.id、queryChain 等语义很多，但命名体系更多是 platform-internal convention。
- **亮点**：
  - telemetry 的字段纪律很好
  - 丰富事件系统有现实压力检验
- **值得借鉴**：
  - 不同种类的 identity 应该通过稳定字段持续出现
- **不打算照抄的地方**：
  - 不延续其“实现先行、命名法后置总结”的方式

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| UUID suffix 纪律 | 低 | 中 | 中 | 高 |
| foreign ID 隔离 | 低 | 中高 | 中 | 高 |
| trace 命名明确度 | 低 | 高 | 中高 | 高 |
| review 时可快速判义 | 低 | 中 | 中 | 高 |
| 与 durable replay 的兼容度 | 低 | 高 | 中高 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] 定义 suffix taxonomy**：`*_uuid`、`*_key`、`*_name`、`*_ref`、`*_seq` 的语义必须冻结。
- **[S2] 列出现有字段迁移表**：当前 repo 的 `_id` 遗留点必须被精确映射。
- **[S3] 定义 translation-zone exception**：provider/raw 字段要有明确收容区。
- **[S4] 建立 forbidden naming 规则**：后续 PR review 才能一票否决新增 `_id`。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] 业务层所有对象命名细则**：Phase 0 只看 internal runtime contract。
- **[O2] public API field naming**：下一阶段另行设计。
- **[O3] 强制 UUID 版本选择**：先只要求“合法 UUID”，不在本设计里冻结 v4/v7。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `producer_id` | in-scope | 虽是非 UUID，但其命名已违反 law，应改 `producer_key` |
| `stamped_by` | in-scope | 应提升为 `stamped_by_key`，避免 bare actor handle |
| `tool_call_id` in OpenAI raw adapter | out-of-scope | translation zone 允许保留 |
| `reply_to` | in-scope | 应显式说明关联对象，推荐 `reply_to_message_uuid` |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **严格 suffix law** 而不是 **“命名差不多能懂就行”**
   - **为什么**：nano-agent 后面要做 trace、checkpoint、context compaction，没有单义命名会非常痛苦。
   - **我们接受的代价**：短期需要大规模 rename。
   - **未来重评条件**：无；这是基础 law，不是临时风格偏好。

2. **取舍 2**：我们选择 **UUID 与 key 显式二分** 而不是 **都叫 id**
   - **为什么**：UUID identity 和字符串路由键在 runtime 里承担的是完全不同的职责。
   - **我们接受的代价**：字段名会更长。
   - **未来重评条件**：无；只有极少数 provider translation zone 可例外。

3. **取舍 3**：我们选择 **把 foreign ID 封装在 adapter** 而不是 **把 provider naming 直接暴露给全仓**
   - **为什么**：外部协议不可控，内部 contract 必须可控。
   - **我们接受的代价**：adapter 需要做一次命名归一化。
   - **未来重评条件**：若某 provider field 被证明是跨 provider 的稳定标准，可再讨论是否提升。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| rename 范围比预期更大 | `_id` 遗留点扩散到更多包 | 迁移成本提升 | 先以 canonical packages + adapters 为主战场，矩阵列全 |
| 对 `key` 与 `name` 的边界理解不一致 | review 标准不清 | 又回到漂移状态 | 在本 law 内明确：机器稳定句柄用 `key`，人类展示用 `name` |
| bare actor fields 遗留 | 只盯 `_id` 不盯语义 | 命名半收敛 | 推荐把 `stamped_by` 一并归入 `*_key` 体系 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：调试时一眼就能知道一个字段是不是 UUID identity。
- **对 nano-agent 的长期演进**：storage、context、trace、hook、LLM wrapper 都能用同一套语言交流。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：上下文锚点、skill registry、稳定审计链都离不开清晰标识语义。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Suffix Taxonomy | 定义 `uuid/key/name/ref/seq` 五类后缀 | 所有主要字段都能被语义归类 |
| F2 | Current-to-Target Mapping | 给出现有字段迁移映射 | 当前 `_id` 漂移点全部有归宿 |
| F3 | Translation Zone Rule | 规定 foreign IDs 的唯一容器 | provider raw IDs 不再污染 canonical model |
| F4 | Review/Lint Guardrail | 建立新增命名的否决规则 | 新 PR 不再新增非法后缀 |

### 7.2 详细阐述

#### F1: `Suffix Taxonomy`

- **输入**：当前 schema / runtime state / adapter fields
- **输出**：统一命名后缀法则
- **主要调用者**：全仓 schema 与 types
- **核心逻辑**：
  - `*_uuid`：内部 identity / correlation / ownership
  - `*_key`：非 UUID 机器句柄/模块键/路由键
  - `*_name`：人类可读名称
  - `*_ref`：结构化引用
  - `*_seq`：顺序号
  - wire schema 继续使用 snake_case；TypeScript/对象属性可使用 camelCase，但必须保持同一 suffix 语义（如 `message_uuid <-> messageUuid`，`producer_key <-> producerKey`）
- **边界情况**：
  - bare `id` 一律禁用
  - 非 suffix 化字段只有极少数枚举/tag 可保留（如 `message_type`）
- **一句话收口目标**：✅ **`任何新字段只看名字就能大致判定其语义类型`**

#### F2: `Current-to-Target Mapping`

- **输入**：当前遗留字段
- **输出**：目标命名映射表
- **主要调用者**：Phase 0 rename PR
- **核心逻辑**：
  - `trace_id -> trace_uuid`
  - `stream_id -> stream_uuid`
  - `span_id -> span_uuid`
  - `producer_id -> producer_key`
  - `consumer_hint -> consumer_key`
  - `stamped_by -> stamped_by_key`
  - `reply_to -> reply_to_message_uuid`
  - canonical internal `tool_call_id -> tool_call_uuid`，provider raw 保留在 adapter
  - camelCase mirror 同步遵守相同映射（如 `traceId -> traceUuid`、`replyTo -> replyToMessageUuid`）
- **边界情况**：
  - 若某字段语义不是 identity，而是 label，则应改 `*_name` 而不是 `*_key`
- **一句话收口目标**：✅ **`当前主要漂移字段全部有目标命名，不留灰区`**

#### F3: `Translation Zone Rule`

- **输入**：provider SDK/raw APIs
- **输出**：foreign ID 的收容边界
- **主要调用者**：`llm-wrapper`、外部 service adapters
- **核心逻辑**：adapter-local interfaces 可保留原生字段名，但进入 canonical domain 时必须被映射成 law 允许的命名。
- **边界情况**：
  - raw body 可原样记录到 debug/audit artifact，但不得作为 canonical state 字段直接传播
- **一句话收口目标**：✅ **`foreign IDs 只停留在 translation zone，不穿透到 NACP canonical layer`**

#### F4: `Review/Lint Guardrail`

- **输入**：新 PR、新 schema、新 helper
- **输出**：命名法执行机制
- **主要调用者**：reviewers、未来 lint
- **核心逻辑**：新增 `*_id` 或裸 `id` 在 internal canonical code 中直接视为 review blocker。
- **边界情况**：
  - `tool_call_id` 等仅在 adapter-local raw type 中豁免
- **一句话收口目标**：✅ **`命名 law 从“建议”变成 review blocker`**

### 7.3 非功能性要求

- **性能目标**：无额外 runtime 成本要求，重点是认知成本下降。
- **可观测性要求**：trace / audit / checkpoint 里必须能从字段名直接判断 identity 类型。
- **稳定性要求**：一旦 law 冻结，canonical internal naming 不再回头。
- **测试覆盖要求**：后续应增加 schema/adapter tests 验证 translation zone 不泄漏 foreign IDs。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/logger.py:64-70` | request message 直接带 `tool_call_id` | foreign ID 可以存在，但应被限制在外缘 | 我们不让它进入 canonical model |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/otel/src/trace_context.rs:38-47` | `current_span_trace_id()` 明确返回 trace identity | trace identity 必须高度明确 | 我们进一步把它提升为 `trace_uuid` law |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/utils/telemetry/events.ts:42-53` | `event.name` / `prompt.id` 等字段清晰分工 | 不同 identifier 应承担不同职责 | 说明“都叫 id”不是好主意 |
| `context/claude-code/services/api/logging.ts:141-161` | env metadata 单独命名，不混成泛化 id | 信息分类与命名明确能减少歧义 | 借鉴其字段语义清晰度 |

### 8.4 需要避开的“反例”位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `packages/nacp-core/src/envelope.ts:83-121` | `producer_id` / `trace_id` / `stream_id` / `span_id` 与 UUID 字段并列 | 直接说明当前 canonical naming 仍未收敛 |
| `packages/llm-wrapper/src/adapters/openai-chat.ts:22-28` | adapter-local `tool_call_id` 若继续上渗，会污染内部命名法 | translation zone 必须被严格圈定 |
| `packages/nacp-core/src/observability/envelope.ts:12-20` | `trace_uuid` 作为 optional alert field，易让 trace law 口径模糊 | 必须区分“平台警报例外”与“请求链路必带 trace_uuid” |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`Identifier Law` 是一个看似“只关命名”的设计，但本质上是在给 nano-agent 建立内部语义秩序。它会以一套很短、很硬的规则存在：哪些字段必须是 UUID、哪些字段是机器键、哪些字段只是展示名、外部 raw IDs 可以活在哪里。它既影响 schema，也影响 review、tests、trace、storage 与 adapter 设计。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | trace-first + durable runtime 非常需要这套 law |
| 第一版实现的性价比 | 5 | 主要是迁移与纪律建设，但收益极大 |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 5 | 三条主线都会直接收益 |
| 对开发者自己的日用友好度 | 5 | 以后看字段名就知道其语义 |
| 风险可控程度 | 4 | 主要风险是迁移范围，但方向极清晰 |
| **综合价值** | **5** | **是 owner 决策落地的第一法律文件** |

### 9.3 下一步行动

- [x] **决策确认**：`stamped_by -> stamped_by_key` 与 `reply_to -> reply_to_message_uuid` 已与 Phase 0 rename 一并在 A1 Phase 2 落地（envelope + compat shim + tests）。
- [x] **关联 Issue / PR**：A1 P2/P3/P4 已完成 `nacp-core` / `nacp-session` / observability / llm-wrapper adapter seam 全量 rename；`rg 'trace_id|stream_id|span_id|producer_id|consumer_hint|stamped_by|reply_to' packages/**/src/**/*.ts` 只命中 compat migration 与 translation-zone 注释。
- [ ] **待深入调查的子问题**：
  - [ ] 是否引入 lint 阻止 canonical code 中新增 `_id`（A1 未做；作为 guard-rail follow-up 留到后续 governance phase）。
- [x] **需要更新的其他设计文档**：已同步
  - `P0-contract-freeze-matrix.md`
  - `P0-nacp-versioning-policy.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：是否只替换 `trace_id`，其余以后再说
  - **A 方观点**：先最小修复
  - **B 方观点**：必须连同 `_id` 语义债一起清掉
  - **最终共识**：按 owner 决策，整个 internal naming law 一次性收敛

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
