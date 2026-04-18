# Nano-Agent NACP Versioning Policy 功能簇设计

> 功能簇: `NACP Versioning Policy`
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

**A1 收口后状态（2026-04-18）**：`packages/nacp-core/src/version.ts` 现已写入 `NACP_VERSION = "1.1.0"` / `NACP_VERSION_COMPAT = "1.0.0"` / `NACP_VERSION_KIND = "frozen"`，且 `packages/nacp-core/src/compat/migrations.ts` 已落地真实的 `migrate_v1_0_to_v1_1`（不再是 placeholder），覆盖 Phase 0 identifier-law rename 与 session follow-up family widening 两条 baseline 线。本文档下述策略即为 A1 落地时遵循的 owner-aligned policy；保留原讨论脉络以便后续 reviewer 审阅。

（原始背景）当时 owner 明确要求进行一轮带 breaking 性质的命名收敛（`trace_uuid` / `*_uuid` / 取消 `*_id`），并把 formal follow-up input family 纳入 Phase 0 contract freeze。**nano-agent 当时最缺的不是再加一个版本常量，而是先把“什么变化算 breaking、何时允许迁移、alias 可以活多久、哪些 widened session surfaces 应直接进入 frozen baseline”讲清楚。**

- **项目定位回顾**：nano-agent 不是一个本地 CLI 里“差不多能跑就行”的临时协议；它后面要承载 DO hibernation、WebSocket replay、context assembly、service-binding tools。
- **本次讨论的前置共识**：
  - `schema_version` 是 NACP family 的真实兼容字段，不是装饰性字符串。
  - canonical schema 不应长期接受 retired field aliases。
  - migration 必须发生在 raw-to-raw translation 层，而不是在业务代码里到处写双字段兼容。
  - Session profile 与 Core profile 属于同一 NACP family，应共享版本治理原则。
  - Phase 0 的第一条真实 migration 就是 `trace_id / stream_id / span_id -> *_uuid` 与相关 `*_id -> *_key` 收敛；formal follow-up input family 则属于同一 frozen-baseline cut 中必须明确写入的 session contract widening。
  - 在 rename migration 真正进入 compat chain 之前，后续 phase 一律不得把 rename target 误写成既成事实；在 follow-up family 真正被 `nacp-session` 冻结之前，也不得把它继续当成下一阶段事务。
- **显式排除的讨论范围**：
  - 不讨论 npm package semver 与 monorepo release 流程
  - 不讨论 public REST/WebSocket API 的版本策略
  - 不讨论业务 DDL migration

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`NACP Versioning Policy`
- **一句话定义**：它规定 NACP 合同如何声明版本、如何判断兼容、如何进行 raw migration，以及哪些变化必须被视为 breaking。
- **边界描述**：**包含** `schema_version`、compat floor、migration chain、change classification、alias policy；**不包含** provider API versioning、产品接口版本、数据库 migration。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **Current Version** | 当前 writer 输出到 `header.schema_version` 的版本 | 例如未来的 `1.1.0` |
| **Compat Floor** | 当前 reader 仍可读取的最低 schema 版本 | 例如 `1.1.0` 或 `1.2.0` 读取 `1.1.0` |
| **Migration Chain** | 从旧 raw schema 转到当前 raw schema 的函数链 | 在 parse 前执行 |
| **Breaking Change** | 会让既有消息在不迁移时无法被当前 canonical schema 接受的变化 | 改名、删字段、必填化都算 |
| **Additive Change** | 旧消息仍可合法解析，新消息只增加可忽略信息 | 可选字段、可选事件、非强制枚举扩展 |
| **Alias Window** | 旧命名存在的短期过渡期 | 只能存在于 migration/adapter，不进 canonical schema |

### 1.2 参考调查报告

- `docs/investigation/mini-agent-by-opus.md` — mini-agent 基本没有正式 schema versioning
- `docs/investigation/codex-by-opus.md` — codex 更依赖成熟内部 crate 与协议层 discipline，而不是 ad-hoc 兼容
- `docs/investigation/claude-code-by-opus.md` — claude-code 在事件与 telemetry 上稳定，但其 contract 主要由实现演进，不是单一 protocol family

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **协议演进守门人** 的角色。
- 它服务于：
  1. `nacp-core`
  2. `nacp-session`
  3. 所有需要读取 durable / replay / archived NACP payload 的 runtime
- 它依赖：
  - frozen contract matrix
  - identifier law
  - 当前代码 reality 与未来 owner-aligned baseline
- 它被谁依赖：
  - observability durable trace reader
  - session restore / replay
  - future client / gateway adapters
  - code review 与 release discipline

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `NACP-Core` | Policy -> Core | 强 | version constants 与 migrations 位于 core |
| `NACP-Session` | Policy -> Session | 强 | session profile 共享 family version discipline |
| `Contract Freeze Matrix` | 双向 | 强 | matrix 告诉 policy 哪些 surface 已冻结 |
| `Identifier Law` | 双向 | 强 | 字段重命名直接决定 breaking class |
| `Eval / Observability` | Policy -> Eval | 中 | durable payload 读取必须知道 compat floor |
| `Session DO Runtime` | Policy -> Runtime | 中 | restore / replay 场景依赖旧消息可读性 |
| `Public API / Frontend` | Policy -> Public | 弱 | 暂不直接治理，但 future public seam 会消费其结论 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`NACP Versioning Policy` 是 **协议演进守门人**，负责 **定义 NACP family 的版本、兼容与迁移规则**，对上游提供 **何时可改、何时必须迁移、何时算 breaking 的统一标准**，对下游要求 **canonical schema 不再无期限容忍历史字段漂移**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| “先不写 migration，等需要再说” | 常见早期项目习惯 | nano-agent 已经要做 durable replay / restore，不能靠侥幸 | 否 |
| canonical schema 长期接受双字段别名 | 低治理兼容路径 | 会把 docs、tests、runtime 一起拖进双语状态 | 否 |
| 每个包各自独立定义协议版本 | 多包项目常见漂移 | `nacp-core` / `nacp-session` 必须共享家族治理 | 否 |
| 把 provider/raw schema 也纳入 NACP version line | adapter-first 做法 | 会把外部系统变动传导进内部协议 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| Migration registry | `compat/migrations.ts` | 先从 Phase 0 normalization batch 开始 | 多 minor 链式迁移 |
| Change-class guide | 设计文档 + review checklist | 手工判类 | 自动 lint / release gating |
| Compat tests | root contract tests + package tests | 验证 current/compat 两端 | durable corpus replay tests |
| Deprecated-field adapters | translation-only helper | 只用于迁移期 | 最终删除 |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：NACP family versioning vs provider adapter versioning
- **解耦原因**：OpenAI / gateway / browser API 的演进不应改变内部协议版本线。
- **依赖边界**：adapter 负责吸收外部版本差异；NACP 只看 canonical internal contract。

- **解耦对象**：schema migration vs business logic
- **解耦原因**：业务代码不应知道旧字段名，也不应到处写 `trace_id ?? trace_uuid`。
- **依赖边界**：只允许 compat layer 做 raw migration。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：NACP 的 current version / compat floor / migration registry
- **聚合形式**：`packages/nacp-core/src/version.ts` + `packages/nacp-core/src/compat/*`
- **为什么不能分散**：若各包各自判断兼容，最终 durable replay 与 live ingest 会读出两套真相。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：以本地运行与直接日志为主，没有系统化的 protocol versioning。
- **亮点**：
  - 迭代快
  - 早期认知成本低
- **值得借鉴**：
  - 不把 versioning 设计搞成巨型框架
- **不打算照抄的地方**：
  - 不做“无版本治理”的 runtime

### 4.2 codex 的做法

- **实现概要**：codex 更依赖稳定 crate 边界与强 trace discipline，而不是松散字符串协议。
- **亮点**：
  - 对 trace 和 context propagation 足够严肃
  - 内部边界分层明确
- **值得借鉴**：
  - 版本治理应服务于 runtime correctness，而不是只服务于文档
- **不打算照抄的地方**：
  - 不把内部工程复杂度直接复制到 nano-agent

### 4.3 claude-code 的做法

- **实现概要**：claude-code 的 telemetry / event 面稳定，但更像 runtime platform convention。
- **亮点**：
  - 事件 metadata 纪律强
  - 对真实生产约束有大量经验
- **值得借鉴**：
  - 变更时要保留对历史数据/历史事件的可读性
- **不打算照抄的地方**：
  - 不让 implementation convention 替代 protocol versioning

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| 正式 schema_version | 低 | 中 | 中 | 高 |
| 迁移链意识 | 低 | 中高 | 中 | 高 |
| breaking 变更治理 | 低 | 中高 | 中 | 高 |
| 对 replay / durable read 的支撑 | 低 | 高 | 中高 | 高 |
| 第一版复杂度 | 低 | 高 | 高 | 中 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] 定义 NACP family current version / compat floor 规则**：这是任何 durable 协议都绕不开的基础。
- **[S2] 为 Phase 0 normalization batch 建立迁移机制**：否则 owner 决策落地时只能硬切。
- **[S3] 定义 breaking / additive / translation-only 分类**：后续 review 才能有统一判尺。
- **[S4] 规定 alias 只能存在于 compat/adapter 层**：防止 canonical schema 被污染。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] npm package semver 治理**：它和协议 semver 有关联，但不是一回事。
- **[O2] public API versioning**：下一阶段再定。
- **[O3] 数据库 migration 策略**：属于 business DDL 与 substrate 选型之后的问题。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `trace_id -> trace_uuid` 重命名 | in-scope | Phase 0 的核心 breaking migration |
| formal follow-up input family 扩展 | in-scope | Q8 已确认其属于 widened v1 contract surface，而不是下一阶段 v2 才补 |
| provider `tool_call_id` 保留 | out-of-scope | 仅属于 adapter raw wire |
| `session.stream.event` kind 扩展 | out-of-scope（本阶段） | 当前只冻结 reality，不扩展事件面 |
| current `1.0.0` 的语义澄清 | in-scope | 当前代码已写死 version，必须解释其地位 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **显式 migration chain** 而不是 **schema parser 隐式宽松兼容**
   - **为什么**：显式迁移更容易审计、测试和删除历史债务。
   - **我们接受的代价**：compat 目录与测试会变多。
   - **未来重评条件**：只有当某个外部依赖确实需要超长兼容窗口，才考虑增加 alias window。

2. **取舍 2**：我们选择 **把 current `1.0.0` 视为 pre-freeze provisional baseline** 而不是 **假装它已经是最终 frozen truth**
   - **为什么**：当前代码显然还未符合 owner 的 naming law，继续把它当 frozen truth 会制造更多混乱。
   - **我们接受的代价**：需要在文档里明确说明“1.0.0 先前只是内部前基线”。
   - **未来重评条件**：Phase 0 rename batch 与 formal follow-up family freeze 落地后，再切 owner-aligned frozen baseline。

3. **取舍 3**：我们选择 **alias 只活在 compat/adapter** 而不是 **让 canonical schema 永久双读**
   - **为什么**：长期双读会使 contract 永远无法真正收敛。
   - **我们接受的代价**：短期迁移需要更集中地改测试与调用方。
   - **未来重评条件**：仅在存在真实外部生态兼容要求时，才讨论延长 alias 窗口。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| 版本策略过于理想化，代码没接上 | 文档先行但无 action-plan | 实际无效 | 后续 action-plan 先做 version/migration wiring |
| `1.0.0` 的 provisional 解释被误读 | 外部读者直接看代码常量 | 口径混乱 | 在 README / CHANGELOG / core docs 明确标注 |
| compat floor 维护不严 | 缺少 regression corpus | restore/replay 失败 | 引入 fixture-based raw corpus tests |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：以后每次字段改动，不再需要靠“感觉”判断影响面。
- **对 nano-agent 的长期演进**：durable trace、checkpoint、replay、archived transcript 都会从中受益。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：任何长期持久化数据都需要可读性与升级路径，versioning policy 是稳定性的基础件。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Version Baseline Policy | 定义 current / compat / provisional baseline 关系 | 所有人都知道现在的 NACP version 到底意味着什么 |
| F2 | Migration Chain | 建立 raw migration 的固定入口 | breaking rename 不再靠业务代码兼容 |
| F3 | Change Classification | 定义 breaking / additive / translation-only | 每次协议变更都能统一判类 |
| F4 | Compatibility Evidence | 要求 contract tests 覆盖 current/compat | replay / restore 有可验证兼容性 |

### 7.2 详细阐述

#### F1: `Version Baseline Policy`

- **输入**：当前 `NACP_VERSION = 1.0.0`、owner Phase 0 决策
- **输出**：一份明确的 baseline 解释
- **主要调用者**：core/session runtime、docs、review
- **核心逻辑**：
  1. 当前代码中的 `1.0.0` 视为 **pre-freeze provisional baseline**
  2. Phase 0 的 owner-aligned frozen baseline 必须同时吸纳 naming law 收敛与 formal follow-up input family freeze
  3. 在上述 Phase 0 cut 落地后，切出第一版 **owner-aligned frozen baseline**
  4. 建议该 frozen baseline 记为 `1.1.0`，并在文档中注明 `1.0.0` 为 pre-freeze internal line
- **边界情况**：
  - 若业主更偏好重新声明 `1.0.0`，也必须同步 rewrite 全部 compatibility 口径
- **一句话收口目标**：✅ **`当前版本号的语义不再模糊`**

#### F2: `Migration Chain`

- **输入**：旧 raw payload、新 canonical schema
- **输出**：可审计的 migration function 链
- **主要调用者**：ingest、restore、replay、audit reader
- **核心逻辑**：所有 breaking rename 都先经 compat layer raw migration，再进入当前 schema parse。
- **边界情况**：
  - canonical schema 不接受 retired alias
  - migration 不负责业务推断，只做结构归一化
- **一句话收口目标**：✅ **`所有历史字段别名都只存在于 compat layer`**

#### F3: `Change Classification`

- **输入**：任意 schema diff
- **输出**：patch / minor / major 或 translation-only 分类
- **主要调用者**：review、release、docs
- **核心逻辑**：
  - **patch**：无 wire/schema 变化
  - **minor**：仅 additive，可选字段/可选事件/向后兼容扩展
  - **major**：删除、改名、required 化、枚举收紧、语义改变
  - **translation-only**：只发生在 provider/raw adapter，不影响 NACP
- **边界情况**：
  - 即便字段类型没变，只要语义改了，也应视为 breaking
- **一句话收口目标**：✅ **`任何 contract 改动都能被明确归类`**

#### F4: `Compatibility Evidence`

- **输入**：fixtures、durable raw payload、cross-package tests
- **输出**：current/compat 双侧证据
- **主要调用者**：CI、release、review
- **核心逻辑**：至少要验证 current writer 产出的 payload 被 current reader 接受，以及 compat floor 的旧 payload 经 migration 后可被当前 reader 接受。
- **边界情况**：
  - provider raw payload 不算 NACP compat corpus
- **一句话收口目标**：✅ **`兼容性不再只靠文档宣称，而有实际 corpus 支撑`**

### 7.3 非功能性要求

- **性能目标**：migration 应在 parse 前完成，保持结构简单，避免高成本深层业务推断。
- **可观测性要求**：compat path 触发时应可被 audit/metrics 看到。
- **稳定性要求**：canonical schema 与 compat schema 必须始终单向收敛，不允许双向漂移。
- **测试覆盖要求**：至少覆盖 current write/current read、compat read、invalid old shape reject 三类情形。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/logger.py:53-81` | 直接序列化 request payload | 说明早期项目确实容易缺失正式版本层 | 正好是我们要避免的空白 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/otel/src/trace_context.rs:19-59` | 稳定 trace context 提取与传递 | 协议/上下文边界要严肃治理 | 虽不是 versioning 文件，但体现“严肃边界” |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/utils/telemetry/events.ts:42-74` | 所有事件都注入统一字段 | 稳定 contract 的价值不止在 parse，也在后续 observability | 事件面再大也要有稳定骨架 |
| `context/claude-code/services/api/logging.ts:107-139` | 外部 gateway 差异吸收到 adapter/logging 层 | 外部变化不必拉动内部协议版本 | 非常适合 translation-only 规则 |

### 8.4 需要避开的“反例”位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `packages/nacp-core/src/version.ts:1-10` | 已有 version 常量，但缺少与 owner 决策对齐的政策说明 | 只写版本号不写政策，等于没有 versioning |
| `packages/nacp-core/src/compat/migrations.ts:1-18` | migration chain 还是 placeholder | Phase 0 不能停留在 pattern 展示 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`NACP Versioning Policy` 的复杂度不在代码量，而在于它会决定未来所有 durable / replay / restore / audit 载荷能否长期可读。它应该以一套很小但很刚性的 policy 存在：明确 baseline、明确 compat floor、明确 migration 入口、明确 change class。写好之后，nano-agent 才有资格把协议视为“可以长期持有”的资产。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | DO + replay + durable trace 天生需要 versioning |
| 第一版实现的性价比 | 4 | 需要少量基础设施，但收益长期稳定 |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 5 | 所有长期状态都受益 |
| 对开发者自己的日用友好度 | 4 | 会增加变更门槛，但能减少未来返工 |
| 风险可控程度 | 4 | 关键是尽快把 placeholder 变成真实 policy |
| **综合价值** | **5** | **应作为 Phase 0 contract freeze 的标准件** |

### 9.3 下一步行动

- [x] **决策确认**：「1.0.0 provisional → 1.1.0 frozen」口径已由 A1 Phase 5 落盘；`NACP_VERSION_KIND = "frozen"` 是 runtime 可观测的当前 baseline。
- [x] **关联 Issue / PR**：`nacp-core` 的 `migrate_v1_0_to_v1_1` 与 `compat.test.ts` 14 个 case 已落地，接入 `validateEnvelope` Layer 0 compat shim。
- [x] **待深入调查的子问题**：
  - [x] frozen baseline 命名为 `1.1.0`
  - [x] compat floor 保留在 `1.0.0`（A1 owner decision — 跨一个 minor 足够）
- [x] **需要更新的其他设计文档**：已同步
  - `A1-contract-and-identifier-freeze.md`
  - `P0-contract-freeze-matrix.md`
  - `P0-identifier-law.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：是否保留长期 alias 兼容
  - **A 方观点**：保留 alias 更平滑
  - **B 方观点**：alias 只会扩大历史债务
  - **最终共识**：alias 只能存在于 compat/adapter 层

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.2 | `2026-04-18` | `GPT-5.4` | 根据 PX-QNA Q8 补充 Phase 0 frozen baseline 需吸纳 formal follow-up input family widening 的版本治理口径 |
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
