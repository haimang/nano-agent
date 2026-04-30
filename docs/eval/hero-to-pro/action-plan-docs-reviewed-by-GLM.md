# Nano-Agent 行动计划文档审查

> 审查对象: `docs/action-plan/hero-to-pro/HP0-HP10`
> 审查类型: `docs-review`
> 审查时间: `2026-04-30`
> 审查人: `GLM-5.1`
> 审查范围:
> - `docs/action-plan/hero-to-pro/HP0-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP1-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP2-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP3-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP4-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP5-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP6-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP7-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP8-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP9-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP10-action-plan.md`
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md` (基石文件)
> - `docs/templates/code-review.md` (审查模板)
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：11 份行动计划文档整体架构成熟，与基石 charter 的对齐度高，阶段划分合理，依赖关系清晰，可以作为 hero-to-pro 阶段开发工作的指导。但存在若干需要关注的盲点、逻辑断点和事实偏差，主要集中在跨 phase 依赖跟踪不完整、部分 charter 要求的行动计划覆盖不足、以及个别事实引用需要验证。
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`no` — 需要跟进处理下方 R1-R7 中标记为 blocker 的问题后，方可视作审查通过。
- **本轮最关键的 3 个判断**：
  1. **HP3 与 HP5 的 kernel interrupt 依赖存在隐性断点**：charter §7.6 明确要求 HP5 依赖"kernel interrupt 路径已通(HP3-HP4 内已有基础)"，但 HP3/HP4 的行动计划中均未显式创建 `confirmation_pending` kernel interrupt 基础路径，这会导致 HP5 启动时发现其 Phase 2 的前提不成立。(R1)
  2. **`forwardInternalJsonShadow` / `parity-bridge.ts` 的 HP8 清理决策流存在断链**：charter §2.2 G17 和 §7.1 规定这些残留代码的终局判定在 HP8-B (R29 postmortem 后)，但 HP8 行动计划未显式跟踪这一从 HP0 到 HP8 再到 HP10 的完整决策链。(R3)
  3. **charter §9.4 证据不足不允许宣称的内容在部分行动计划中缺少对应验证机制**：尤其是"cross-turn history e2e(turn1→turn2 引用)失败"作为 NOT-成功退出条件，HP3 行动计划的 e2e 场景描述未明确覆盖此验收标准。(R2)

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-hero-to-pro.md` (基石 charter，全文 1331 行)
  - 11 份行动计划文档 (HP0-HP10)
- **核查实现**：
  - 行动计划引用的代码锚点（行号）已与原文核对，但未运行代码验证
  - charter §1.2 已冻结系统真相与行动计划声明的一致性已逐条对照
  - charter §6 Phase 总览与行动计划 phases 的一致性已逐表比对
- **执行过的验证**：
  - charter §7 各 Phase 详细说明与行动计划 In-Scope/Out-of-Scope 的一致性逐条比对
  - charter §4.4 硬纪律在行动计划中的体现逐条检查
  - 跨 phase 依赖链完整性验证
  - 行动计划引用的 QNA Q ID 与 charter 引用的一致性验证

### 1.1 已确认的正面事实

- **F1**：11 份行动计划文档结构统一，均遵循 §0 执行背景→§1 执行综述→§2 In-Scope/Out-of-Scope→§3 业务工作总表→§4 Phase 业务表格→§5 Phase 详情→§6 冻结设计决策→§7 风险/依赖→§8 整体收口 的统一格式。
- **F2**：所有行动计划均正确引用了 `docs/charter/plan-hero-to-pro.md` 作为上游前序，且在 §6 中引用了 `docs/design/hero-to-pro/HPX-qna.md` 的具体 Q ID 作为冻结决策来源。
- **F3**：charter §4.4 的 8 条硬纪律在行动计划中均有体现：(1) DDL 集中纪律在 HP1 中严格遵守；(2) e2e 文件落地纪律在 HP2-HP7 的 §8 中均有 cross-e2e 要求；(3) 文档后置纪律在 HP2-HP8 中均未提到更新 `clients/api-docs/`；(4) manual evidence 硬闸在 HP9 中正确体现；(5) chronic explicit 纪律在 HP8/HP10 中有对应 register；(6) 行数 stop-the-bleed 在 HP8 中有 CI gate；(7) deception-flag 纪律在 HP8 R29 postmortem 中体现；(8) NACP 协议 backward compat 在 HP5 中有 compat alias 保留策略。
- **F4**：所有行动计划的 Out-of-Scope 与 charter §4.2 的全局 Out-of-Scope 完全一致，未发现越界设计。
- **F5**：HP0 正确处理了 charter R3 修订中关于 CONTEXT_CORE binding 和 `forwardInternalJsonShadow`/parity-bridge 的约束——HP0 只做 verify 不做 wiring 变更，不强删 R29 依赖残留。
- **F6**：HP1 正确处理了 charter R2 修订关于 migration 编号的约束——从 007 起编号，不存在旧版暗示的 007/008 历史。
- **F7**：HP3 的 `<model_switch>` strip-then-recover 设计（Q11）与 HP2 的 `<model_switch>` 注入设计（Q9）存在显式交接，HP3 行动计划 §5.4 Phase 4 正确引用了 HP2 冻结的 contract。

### 1.2 已确认的负面事实

- **N1**：HP3 行动计划的规模远大于其他实现阶段——包含 5 个 Phase 和 10 个工作项（P1-01 到 P5-02），涵盖 surface 重构、cross-turn manager、auto-compact、preview/job、strip-recover、circuit breaker 共 6 个差异化能力域。对比 HP2（4 Phase 9 工作项）和 HP4（5 Phase 10 工作项），HP3 的认知负载和实现风险明显更高，但行动计划未对此提出额外的分阶段风险缓解策略。
- **N2**：行动计划普遍引用了 `docs/design/hero-to-pro/HPX-qna.md` 中的具体 Q ID，但这些 Q ID 的实际内容在审查中无法验证（文件不在审查范围内）。如果 QNA 文件中的冻结决策与行动计划的理解不一致，将导致执行偏差。
- **N3**：多个行动计划引用了具体代码文件和行号（如 `session-lifecycle.ts:41-57`、`message-runtime.ts:134-161`），这些行号引用在代码演进后可能失效，但行动计划中没有版本锚点或"以仓库实际为准"的兜底声明。
- **N4**：HP5 行动计划在 §1.6 第5点引用了 `onUsageCommit` 和 `pushServerFrameToClient` 作为 F13 usage push seam 的证据，但 charter §2.2 G8 明确指出 F13 是"慢性的 pushServerFrameToClient round-trip e2e 文件不存在"的问题。行动计划将 usage push e2e (18 号) 纳入 F13 闭合是正确的，但需要确认这 4 个 e2e 文件（15-18）与 charter §9.1 中提到的"F13 慢性四阶段"是否完全对应。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `partial` | 行动计划引用的代码锚点行号已读取，但未在运行时验证其准确性 |
| 本地命令 / 测试 | `no` | 未执行任何测试命令 |
| schema / contract 反向校验 | `yes` | DDL schema 引用与 charter §7.2 HP1 交付物已逐条对照 |
| live / deploy / preview 证据 | `no` | 无运行时环境验证 |
| 与上游 design / QNA 对账 | `partial` | QNA Q ID 引用无法完全验证（文件不在审查范围），但 charter 与行动计划的对账已完成 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | HP3→HP5 kernel interrupt 依赖隐性断点 | `high` | `scope-drift` | `yes` | 在 HP3/HP4 行动计划中显式增加 kernel interrupt 基础路径的工作项 |
| R2 | charter §9.4 NOT-成功退出条件缺少行动计划级别验证机制 | `high` | `delivery-gap` | `yes` | 在 HP2-HP7 的 e2e 场景中增加与 §9.4 对应的显式验收标准 |
| R3 | `forwardInternalJsonShadow`/`parity-bridge` 从 HP0→HP8→HP10 的决策链不完整 | `medium` | `docs-gap` | `no` | 在 HP0 closure 与 HP8 行动计划之间增加显式的残留跟踪条款 |
| R4 | HP3 行动计划规模过大，未设分阶段风险缓解 | `medium` | `platform-fitness` | `no` | 考虑将 HP3 拆分为至少两个可独立验收的子阶段或增加 checkpoint 机制 |
| R5 | HP4 行动计划 Q38 依赖表述与 charter 不完全一致 | `medium` | `correctness` | `no` | 明确 Q38 条件触发时的具体流程 |
| R6 | HP7 行动计划与 charter HP7 §7.8 在 checkpoint lazy/eager 策略描述上存在细微偏差 | `low` | `protocol-drift` | `no` | 对齐 Q22 的精确措辞 |
| R7 | HP8 行动计划缺少 `forwardInternalJsonShadow`/`parity-bridge` 清理决策的显式跟踪 | `medium` | `docs-gap` | `no` | 在 HP8 Phase 4 中增加从 HP0→HP8→HP10 的完整残留决策链跟踪 |
| R8 | HP9 行动计划的文档 review 方式与 charter 不完全匹配 | `low` | `docs-gap` | `no` | 对齐 charter §7.10 提到的 4 家 review 模式 |
| R9 | HP0 行动计划 P4-02 与 charter §7.1 交付物清单存在细微差异 | `low` | `correctness` | `no` | 补充 binding-presence test 文件名到 P4-01 |
| R10 | 多个行动计划缺少与上游设计文档的已存在性验证 | `medium` | `delivery-gap` | `no` | 在每个行动计划执行前验证其引用的 design doc 实际存在 |

### R1. HP3→HP5 kernel interrupt 依赖隐性断点

- **严重级别**：`high`
- **类型**：`scope-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - charter §7.6 HP5 收口标准明确要求："HP5 在 HP4 closure 后启动，kernel interrupt 路径已通(HP3-HP4 内已有基础)"
  - charter §7.6 HP5 In-Scope 第2条要求："`confirmation_pending` wait 语义、kind metadata、HookDispatcher 真注入"
  - HP3 行动计划中没有显式工作项创建 kernel interrupt 基础路径（如 `approval_pending` → `confirmation_pending` 的重命名或扩展工作）
  - HP4 行动计划中也没有提及 kernel interrupt 相关的基础建设
  - HP5 行动计划 Phase 2 P2-01 要求"kernel 内部统一到 `confirmation_pending`"，但这要求从 `approval_pending` 变为 `confirmation_pending` 是一个 breaking change，而 HP3/HP4 并未为此铺路
- **为什么重要**：HP5 的行动计划的进入条件"kernel interrupt 路径已通"在 HP3/HP4 中没有对应的工作项来满足。如果 HP3 结束时 kernel 仍然只有 `approval_pending`，HP5 Phase 2 需要额外的工作来重命名/扩展，但这部分工作在 HP3/HP4 中没有被显式分配。
- **审查判断**：虽然 HP5 行动计划自身包含了 P2-01"kernel wait unification"工作项，可以在 HP5 内部完成这一变更，但 charter 规定的"HP3-HP4 内已有基础"这一进入条件无法在 HP3/HP4 closure 时声明满足。这是一个隐性依赖断点。
- **建议修法**：在 HP3 行动计划中显式增加一个注释或工作项，说明 kernel interrupt 类型扩展（从 `approval_pending` 到更通用的类型预留）为 HP5 铺路，或者在 HP5 行动计划中明确说明"HP5 Phase 2 将从零创建 kernel interrupt 统一路径"，而非依赖 HP3-HP4 的基础。或者在 charter 中调整 HP5 的进入条件描述，改为"HP4 closure 后启动；kernel interrupt 统一在 HP5 内部完成"。

### R2. charter §9.4 NOT-成功退出条件缺少行动计划级别验证机制

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - charter §9.4 列出了 10 项 NOT-成功退出识别，包括："compact 真实运行但 24K context_window 模型仍溢出 crash"、"cross-turn history e2e(turn1→turn2 引用)失败"等
  - HP3 行动计划 §5.5 Phase 5 的 e2e 场景要求"131K 与 24K 模型在相近上下文密度下会触发不同 compact 阈值"，但没有明确连接到 charter §9.4 的"compact 真实运行但 24K 仍溢出 crash"这一退出条件
  - HP2 行动计划 §4.4 Phase 4 的 "cross-e2e matrix" 要求 "reasoning↔non-reasoning、vision↔non-vision、131K↔24K、alias、fallback 至少 5 个 cross-e2e"，但没有明确连接到 charter §9.4 的退出条件
- **为什么重要**：如果行动计划只定义了自己的收口标准而没有链接到 charter 的硬性退出条件，执行团队可能在满足行动计划收口标准时忽略了 charter 层面的 NOT-成功退出条件。
- **审查判断**：行动计划的收口标准与 charter 的退出条件之间存在语义鸿沟。行动计划的收口标准更具体但可能覆盖不全，而 charter 的退出条件更全面但行动团队可能不会回头到 §9.4 逐条验证。
- **建议修法**：在 HP2-HP7 的 §8 整体收口标准中增加显式引用 charter §9.4 相关退出条件的对照，或在每个行动计划的 §7.2 约束与前提中增加"本 phase 收口时必须对照 charter §9.4 识别的 NOT-成功退出条件"条款。

### R3. `forwardInternalJsonShadow`/`parity-bridge` 从 HP0→HP8→HP10 的决策链不完整

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - charter §2.2 G17 明确列出 `forwardInternalJsonShadow` / `parity-bridge.ts` dead code、3 envelope type 漂移、user-do-runtime 行数回涨为 residual item
  - charter §7.1 HP0 的收口标准第5点要求："HP0-closure.md 显式列出 forwardInternalJsonShadow / parity-bridge dead helpers 等 R29-dependent dead code 留 HP10 cleanup 决议"
  - HP0 行动计划正确地在 §2.3 边界判定表中将这两项标记为 out-of-scope，并说明"Q3 明确保留到 HP8/HP10 决议"
  - HP8 行动计划 §1.6 第3点提到了历史大文件名已经失真，但在 Phase 4 的工作项中没有显式包含 `forwardInternalJsonShadow`/`parity-bridge` 的终局判定工作
  - HP10 行动计划 §4.2 Phase 2 P2-01 提到了"对已被 R29/HP8 判为可删的 residue 做物理删除"并列出了 `parity-bridge.ts` 的代码锚点
  - **问题**：HP8 到 HP10 之间的决策传递不显式——HP8 应该做出"删还是留"的判定，但行动计划的 P4-03 "Lane E final-state decision" 并不覆盖 `forwardInternalJsonShadow`/`parity-bridge` 的判定
- **为什么重要**：charter 要求这些残留代码的终局判定走 HP8-B (R29 postmortem) → HP10 cleanup 的路径，但 HP8 行动计划覆盖了 R29 postmortem 和 Lane E 终态，却没有显式跟踪 `forwardInternalJsonShadow`/`parity-bridge` 的终局判定。
- **审查判断**：虽然 HP10 最终会处理物理删除，但 HP8 阶段的判定结果（删还是留）应该有显式的工作项或注册机制。
- **建议修法**：在 HP8 行动计划 Phase 1 P1-01 "chronic register baseline" 中显式增加 `forwardInternalJsonShadow`/`parity-bridge` 作为 chronic register 条目，并在 P4-03 或独立工作项中包含它们的终局判定。或者，在 HP0 closure 模板中显式建立从 HP0 → HP8 → HP10 的残留跟踪链，确保 HP8 closure 必须声明这两个残留的终局判定结果。

### R4. HP3 行动计划规模过大，未设分阶段风险缓解

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - HP3 行动计划包含 5 个 Phase、10 个工作项（P1-01 到 P5-02），涵盖 context surface 重构、CrossTurnContextManager、auto-compact、manual compact preview/job、strip-recover 和 circuit breaker 共 6 个差异化能力域
  - 对比之下，HP2 有 4 Phase 9 工作项，HP4 有 5 Phase 10 工作项，HP6 有 5 Phase 11 工作项
  - HP3 是整个 hero-to-pro 阶段中认知负载最高的 phase，因为它需要同时处理 context-core 解 stub（G3）、cross-turn history（G5）和 compact 机制（G4）
  - charter §8.3 中 HP3 的风险提醒明确指出了两个关键风险："token estimation 误差"和"compact 与 `<model_switch>` 的剥离顺序"
- **为什么重要**：HP3 的实现复杂度远超其他 phase，一旦卡住将阻塞后续所有 phase（HP4-HP10 均依赖 HP3 closure）。行动计划没有为这种关键路径上的高风险 phase 设置中间 checkpoint 或分阶段验收机制。
- **审查判断**：这是一个结构风险而非逻辑错误。行动计划的内在逻辑是正确的，但缺少针对关键路径 phase 的风险缓解策略。
- **建议修法**：考虑在 HP3 行动计划中增加 Phase 2 和 Phase 3 之间的 checkpoint 机制——Phase 2 CrossTurnContextManager 完成后应能独立验收（e.g., "turn2 稳定记住 turn1 durable truth"），而不是等到全部 5 个 Phase 完成后才做整体 closure。或者，在 charter 或 action-plan 中显式说明 HP3 可以在 Phase 2 完成后进行 pre-closure checkpoint，确认 cross-turn context 基础先落地。

### R5. HP4 行动计划 Q38 依赖表述与 charter 不完全一致

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - HP4 行动计划 §2.3 边界判定表将 Q38 描述为"HP1 未 closure 时默认不走 collateral DDL"
  - charter §4.4 R8 的 DDL 集中纪律更详细："若 HP3-HP7 业务执行中发现 HP1 schema 真实 blocker（且 charter §13.1 HP1 design doc review 时未识别），处理流程为：① 不允许私自加 migration；② 必须先 owner 批准并修订本 charter §7.2 + HP1 schema doc + 标 `HP1 schema correction`；③ 新 migration 编号继 HP1 序列（`014-...` 起）；④ 在 HP10 final closure 中显式登记 schema correction 列表与原因"
  - HP4 行动计划的边界判定只说"默认不走 collateral DDL"，但没有说明如果真的触发 Q38 时的完整流程（即 charter R8 的 5 步流程）
- **审查判断**：虽然 HP4 不越界添加 DDL 的原则是正确的，但边界判定表应显式引用 charter R8 的完整 correction 流程，而非仅说"默认不走"。
- **建议修法**：在 HP4 行动计划 §6 依赖的冻结设计决策表中，将 Q38 的"若不成立的处理"从"仅在 owner 明确批准时启动 correction law"扩展为显式引用 charter §4.4 R8 的完整 5 步 correction 流程。

### R6. HP7 行动计划与 charter HP7 §7.8 在 checkpoint lazy/eager 策略描述上存在细微偏差

- **严重级别**：`low`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - charter §7.8 In-Scope 第2条："Lazy snapshot：每个 turn-end 标"待物化"（`nano_session_checkpoints.file_snapshot_status=none`），用户主动 `POST /checkpoints` 时才真物化（写 `file_snapshot_status=pending → materialized`）"
  - HP7 行动计划 §4.1 P1-02 描述为："turn-end auto checkpoint 严格 lazy；user-named checkpoint 尽量 eager，失败转 pending"
  - Q22 冻结的是"file snapshot baseline 采用 lazy materialization，user-named checkpoint 尽量 eager；失败转 pending"
  - Charter 的描述没有明确区分 turn-end 和 user-named 的不同策略，而行动计划和 QNA 有更精确的区分
- **审查判断**：行动计划的精确度高于 charter 原文，且与 QNA 一致。这不是偏差，而是 charter 文本不够精确导致的理解差异。
- **建议修法**：无需修改行动计划。可以在 charter r2 修订中将 §7.8 的 lazy 描述与 Q22 对齐，但行动计划本身已正确引用 Q22。

### R7. HP8 行动计划缺少 `forwardInternalJsonShadow`/`parity-bridge` 清理决策的显式跟踪

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - HP8 行动计划 §1.6 列出的代码锚点中包含 `parity-bridge.ts:48-63,182-219` 和 `message-runtime.ts:72-78`（后者包含 `forwardInternalJsonShadow`）
  - HP8 的整体目标包括"chronic deferrals 系统收口"和 "F5 行数 stop-the-bleed"
  - 但 HP8 的 Phase 1-5 工作项中均没有显式包含"R29 postmortem 判定后决定 `forwardInternalJsonShadow`/`parity-bridge` 删除或保留"这一工作项
  - HP8 P4-03 "Lane E final-state decision" 只涵盖 Lane E 的终态判定，不涵盖 `forwardInternalJsonShadow`/`parity-bridge`
  - charter §7.1 HP0 收口标准第5点明确要求"HP0-closure.md 显式列出 forwardInternalJsonShadow / parity-bridge dead helpers 等 R29-dependent dead code 留 HP10 cleanup 决议"，且 charter §7.9 HP8 的 In-Scope 包含 "F15 R29 verify-initial-context 502 显式 postmortem"
- **审查判断**：HP8 的 R29 postmortem (P1-02) 应该产生判定结果，但该判定结果对 `forwardInternalJsonShadow`/`parity-bridge` 命运的影响没有显式的工作项来跟踪。即使 HP10 最终处理物理删除，HP8 也应该显式做出"删还是保留"的判定并注册到 chronic register。
- **建议修法**：在 HP8 P1-01 chronic register baseline 中显式包含 `forwardInternalJsonShadow`/`parity-bridge` 作为 chronic item，其终态判定依赖 P1-02 R29 postmortem 的结果。在 P4-03 或 Phase 5 closure 中显式声明这两个态项的判定结果（retained-with-reason 或 handed-to-HP10-cleanup）。

### R8. HP9 行动计划的文档 review 方式与 charter 不完全匹配

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - charter §7.10 提到"沿用 RHX2 4 家 review pattern(GPT/kimi/GLM/deepseek)对 6 份新增 + 4 份 rewrite 共 10 份做 review"
  - HP9 行动计划 §0 修正了文档数量为 18 份（11 现有 + 7 新增），与 charter r1 修订一致
  - HP9 行动计划 §5.5 Phase 5 提到"4-review 修订"
  - 行动计划中的"4-review"概念与 charter 中的"4 家 review"不是同一个概念——行动计划指的是"4类reviewer进行审查修订流程"，而 charter 指的是"4家(GPT/kimi/GLM/deepseek)进行review"
  - 实际上仔细阅读，HP9 行动计划 §0 第38行说"4 家 review"与 charter 一致
- **审查判断**：经过仔细比对，行动计划与 charter 在 review 方式上是一致的。原以为是偏差，实则为一致。此条降级为信息说明。
- **建议修法**：无需修改。

### R9. HP0 行动计划 P4-01 与 charter §7.1 交付物列表存在细微差异

- **严重级别**：`low`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - charter §7.1 HP0 交付物第3条："`tests/binding-presence.test.ts` 新增 — 断言 CONTEXT_CORE binding 存在 + LANE_E_RPC_FIRST env var 存在（verify-only，不改 wrangler 配置）"
  - HP0 行动计划 §4.4 Phase 4 中 P4-01 工作项名称为"binding-presence verify + residue grep evidence"，描述为"新增/补齐 verify case，记录 CONTEXT_CORE wiring 与 LANE_E_RPC_FIRST 当前值"
  - 行动计划的工作项描述与 charter 交付物一致，但行动计划没有在 §0 执行背景或 §8 整体收口中显式重复 charter 的交付物列表（如"binding-presence.test.ts"作为文件名）
- **审查判断**：行动计划 §4.4 Phase 4 的工作项内容覆盖了 charter 交付物，但具体文件名可能需要在执行时确认。
- **建议修法**：在 HP0 行动计划 §0 执行背景或 §3 工作总表的"涉及模块/文件"列中显式列出 `tests/binding-presence.test.ts`，以与 charter 交付物保持一致。

### R10. 多个行动计划缺少与上游设计文档的已存在性验证

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - 所有 11 份行动计划都引用了 `docs/design/hero-to-pro/HP*-*.md` 和 `docs/design/hero-to-pro/HPX-qna.md` 作为"关联设计/调研文档"和"冻结决策来源"
  - 这些文件在行动计划执行前必须存在，但行动计划本身没有包含"验证设计文档存在性"的前置检查步骤
  - charter §13.4 建议撰写顺序中明确要求"每个 HPN(N=2..8)依次：design → action-plan → 启动 → closure"
  - 如果设计文档尚未完成或 QNA 的某些 Q ID 尚未冻结，行动计划中的冻结决策引用就是空中楼阁
- **审查判断**：行动计划假设了设计文档和 QNA 的存在性，但缺少显式的前置验证步骤。在实际执行中，如果 QNA 的某些问题尚未冻结，行动计划的"若不成立的处理"条款将无法触发。
- **建议修法**：在每份行动计划的 §7.2 约束与前提中增加："本行动计划引用的 QNA Q IDs 与 design doc 必须在执行开始前已实际存在且冻结；否则，引用的冻结决策不成立，需要退回 design 阶段补充。"

---

## 3. In-Scope 逐项对齐审核

> 对照 charter §4.1 I1-I11 (In-Scope) 和 §4.2 O1-O15 (Out-of-Scope) 与行动计划的 In-Scope/Out-of-Scope 逐项比对。

| 编号 | 计划项 / 设计项 / charter 要求 | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | HP0 前置 defer 修复 (I1) | `done` | HP0 行动计划完整覆盖了 charter I1 的所有子项：model_id/reasoning 透传、system prompt suffix 骨架、binding verify、archive cleanup、conditional lockfile |
| S2 | HP1 DDL 集中扩展 (I2) | `done` | HP1 行动计划完整覆盖了 charter I2 的所有 DDL 改动：model metadata 10 字段、session/turn audit 6 字段、alias、todos、temp files、confirmations、checkpoint 三表 |
| S3 | HP2 Model 状态机 (I3) | `done` | HP2 行动计划覆盖了 4 层模型状态机、/sessions/{id}/model、/models/{id}、alias、<model_switch>、fallback audit |
| S4 | HP3 Context 状态机 (I4) | `done` | HP3 行动计划覆盖了 context-core 解 stub、cross-turn history、auto-compact、probe、compact preview+job、layers |
| S5 | HP4 Chat 生命周期 (I5) | `done` | HP4 行动计划覆盖了 close/delete/title/retry、cursor pagination、conversation-level view、checkpoint conversation_only |
| S6 | HP5 Confirmation 收拢 + Hook dispatcher + F12/F13 (I6) | `done` | HP5 行动计划覆盖了 7 类 confirmation kind、hook dispatcher 真注入、4 个 round-trip e2e。但存在 R1 关于 kernel interrupt 依赖的隐性问题 |
| S7 | HP6 Tool/Workspace 状态机 (I7) | `done` | HP6 行动计划覆盖了 todo、workspace temp file CRUD、tool inflight、workspace→artifact promotion、R2 multi-tenant 安全审查 |
| S8 | HP7 Checkpoint 全模式 revert (I8) | `done` | HP7 行动计划覆盖了 files_only、conversation_and_files、session fork、R2 file shadow snapshot |
| S9 | HP8 Runtime hardening + chronic 收口 (I9) | `partial` | HP8 行动计划覆盖了 F14 R28、F15 R29 postmortem、F6 alarm、F4 Lane E、F5 stop-the-bleed、F8 tool catalog、envelope 收敛。但缺少 `forwardInternalJsonShadow`/`parity-bridge` 终局判定的显式跟踪（R7） |
| S10 | HP9 clients/api-docs + manual evidence (I10) | `done` | HP9 行动计划覆盖了 18 份文档、manual evidence pack、prod schema baseline。与 charter §7.10 一致 |
| S11 | HP10 Final closure (I11) | `done` | HP10 行动计划覆盖了 final closure、cleanup register、deferral 收口、hero-to-platform stub |

### 3.1 对齐结论

- **done**: 9
- **partial**: 1 (HP8 缺少残留决策链显式跟踪)
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0

整体对齐度高，仅 HP8 在 chronic 残留跟踪完整性上有 partial 评定。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Multi-provider LLM routing (charter O1) | `遵守` | 所有行动计划均未引入 multi-provider |
| O2 | Sub-agent / multi-agent (charter O2) | `遵守` | 所有行动计划均未引入 sub-agent |
| O3 | Admin plane / billing (charter O3/O4) | `遵守` | 所有行动计划均未做 admin/billing |
| O4 | Remote ThreadStore API (charter O5) | `遵守` | HP4 行动计划只做 D1+DO based restore |
| O5 | Complete SDK extraction (charter O6) | `遵守` | HP8 只做 tool catalog SSoT |
| O6 | Complete handler refactor (charter O7) | `遵守` | HP8 只做 stop-the-bleed gate |
| O7 | WORKER_VERSION CI (charter O8) | `遵守` | 无行动涉及 |
| O8 | 3-tier observability → single emit (charter O9) | `遵守` | HP5 行动计划明确保留 dual-emit 兼容窗口 |
| O9 | Prompt caching / structured output (charter O10) | `遵守` | 无行动涉及 |
| O10 | Sandbox isolation / streaming progress (charter O11) | `遵守` | 无行动涉及 |
| O11 | SQLite-backed DO (charter O12) | `遵守` | 所有行动计划未引入 SQLite-DO |
| O12 | F10 multi-tenant per-deploy (charter O13) | `遵守` | 无行动涉及 |
| O13 | F11 client package extraction (charter O14) | `遵守` | 无行动涉及 |
| O14 | TodoWrite V2 task graph (charter O15) | `遵守` | HP6 行动计划 O2 明确排除 |
| O15 | DDL 散布（charter D6 纪律） | `遵守` | HP2-HP10 均未引入新 migration，所有 DDL 改动集中在 HP1 |

Out-of-Scope 核查全部通过，无违反。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：11 份行动计划文档整体与基石 charter 对齐度高，阶段划分、依赖关系、工作项覆盖和纪律约束基本正确。但存在 2 个 blocker 级别问题（R1 kernel interrupt 依赖隐性断点、R2 charter 退出条件缺少验证机制）、3 个 medium 级别问题和 3 个 low 级别问题需要跟进。
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **R1**：在 HP3 或 HP4 行动计划中增加 kernel interrupt 基础路径的显式工作项或前置条件说明，或在 HP5 行动计划中明确说明"HP5 Phase 2 将从零创建 kernel interrupt 统一路径"而非依赖 HP3-HP4 已有的基础，并相应调整 charter §7.6 HP5 的进入条件描述。
  2. **R2**：在 HP2-HP7 中至少一份（建议 HP3 和 HP5）的 §8 整体收口标准中增加显式引用 charter §9.4 相关 NOT-成功退出条件的对照条款，确保行动计划收口时不会遗漏 charter 层面的硬性验证。
- **可以后续跟进的 non-blocking follow-up**：
  1. **R3/R7**：在 HP0 closure 模板和 HP8 行动计划中增加 `forwardInternalJsonShadow`/`parity-bridge` 的显式残留跟踪链。
  2. **R4**：考虑为 HP3 增加中间 checkpoint 或分阶段验收机制。
  3. **R5**：在 HP4 行动计划的 Q38 依赖描述中扩展为完整 correction 流程引用。
  4. **R9**：在 HP0 行动计划中显式列出 `tests/binding-presence.test.ts` 文件名。
  5. **R10**：在每份行动计划 §7.2 中增加设计文档存在性前置验证条款。
- **建议的二次审查方式**：same reviewer rereview（GLM 对 R1/R2 修正后的 HP3/HP5 行动计划进行再审查）
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §6 append 回应，不要改写 §0–§5。