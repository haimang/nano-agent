# Nano-Agent 代码审查

> 审查对象: `docs/action-plan/pro-to-product/PP0-PP6 全部 7 份 action-plan 文件`
> 审查类型: `docs-review`
> 审查时间: `2026-05-03`
> 审查人: `Deepseek`
> 审查范围:
> - `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md`
> - `docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md`
> - `docs/action-plan/pro-to-product/PP2-context-budget-closure-action-plan.md`
> - `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md`
> - `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md`
> - `docs/action-plan/pro-to-product/PP5-policy-reliability-hardening-action-plan.md`
> - `docs/action-plan/pro-to-product/PP6-api-contract-docs-closure-action-plan.md`
> 对照真相:
> - `docs/charter/plan-pro-to-product.md`（基石 charter，v0.active.2）
> - `docs/design/pro-to-product/PPX-qna.md`（业主已回填 Q1-Q22，总计 22 题）
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`（cross-cutting design）
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`（cross-cutting design）
> - `docs/design/pro-to-product/02-hitl-interrupt-closure.md`
> - `docs/design/pro-to-product/03-context-budget-closure.md`
> - `docs/design/pro-to-product/04-reconnect-session-recovery.md`
> - `docs/design/pro-to-product/05-hook-delivery-closure.md`
> - `docs/design/pro-to-product/06-policy-reliability-hardening.md`
> - `docs/design/pro-to-product/07-api-contract-docs-closure.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`7 份 action-plan 在宏观结构、Q1-Q22 决策吸收、phase 职责边界三个维度上表现稳健，主体成立。但存在 3 个可操作的阻断性问题（跨 action-plan 的时序语义冲突、PP0 交付物与依赖声明的循环引用、Q17 fail-closed 的具体实现路径缺失），以及 6 个中等严重性的盲点需要在本轮修正后才可以作为 PP1-PP6 的开发执行基线。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `PP4/PP5 对 Q17（fail-closed）的口径一致（均引用 Opus 意见），但在 PP4 的 Out-of-Scope 与 PP5 的 Policy Chain 中对 PermissionRequest 的处理顺序缺乏精确的分段定义，可能导致实现期两个 Phase 各自发明仲裁逻辑。`
  2. `PP0 action-plan 在 header 段将 00/01 design 列为 "upstream/closure" 与该两份 design 作为 PP0 交付物的事实存在结构性矛盾——要么 header 措辞需修正，要么 00/01 尚未冻结的事实必须诚实标注为 pending。`
  3. `PP3 与 PP4 的启动依赖在各自 action-plan 中存在不必要的串行化：PP4 明确将 PP3 closure 列为 upstream，但 charter §8.1 授权 PP3/PP4 在 PP1 后并行推进——这种偏差会人为延长 critical path。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-pro-to-product.md` §1-§15 —— 作为全局 phase 定义、truth gate、boundary law 的唯一权威来源
  - `docs/design/pro-to-product/PPX-qna.md` Q1-Q22 —— 作为已回填的 owner 决策唯一答案来源
  - `docs/design/pro-to-product/00-agent-loop-truth-model.md` 与 `01-frontend-trust-contract.md` —— cross-cutting truth model
  - `docs/design/pro-to-product/02-07-*.md` —— per-phase design 文档（已存在）
- **核查实现**：
  - 7 份 action-plan 文件的完整内容（header、§0-§8 全部章节）
  - 每份 action-plan 的 In-Scope/Out-of-Scope 声明与 charter §4、§7 对照
  - 每份 action-plan 的冻结决策表（§6）与 PPX-qna Q1-Q22 逐题对照
  - 每份 action-plan 的 Phase 依赖关系（§1.2 DAG）与 charter §8.1 执行顺序对照
- **执行过的验证**：
  - 逐题对账 PPX-qna Q1-Q22 的业主回答是否被 7 份 action-plan 正确引用
  - 逐项对账 charter §10.1 的 7 truth gates 是否在对应 action-plan 中有明确映射
  - 检查 action-plan 之间的 phase 依赖一致性
  - 检查 charter §6.4 Frontend Engagement Schedule 在各 action-plan 中的落点
  - 检查 charter §4.5 D1 exception law 是否在需要时被引用
  - 检查 latency baseline / alert threshold 纪律是否在各 action-plan 中一致
- **复用 / 对照的既有审查**：
  - `docs/eval/pro-to-product/design-docs-reviewed-by-deepseek.md` — 作为设计基线审查参考，确认 design 层面的已知问题是否在 action-plan 中被解决或承继

### 1.1 已确认的正面事实

- **P+1**：全部 7 份 action-plan 对 PPX-qna Q1-Q22 的 22 道业主决策引用正确，无一错误解释或反向引用。每份 action-plan 的 §6 "依赖的冻结设计决策" 表准确映射了本 phase 相关的 Q 编号、内容与影响。
- **P+2**：charter §10.1 的 7 truth gates (T1-T7) 在 7 份 action-plan 中均有对应的 phase ownership 映射。每份 action-plan 的 closure/DOD 段落均以对应 truth gate 为闭环标准，符合 charter §4.4(3) "每个 Phase 的 action-plan 与 closure 都必须以 truth gate 为对账单" 的纪律。
- **P+3**：7 份 action-plan 的 In-Scope/Out-of-Scope 边界总体上与 charter §4（全局 in/out scope）、§7（per-phase scope）一致。未发现 action-plan 将 charter 明确标记为 out-of-scope 的项目（multi-provider、admin、SDK extraction、full hook catalog 等）偷偷纳入 scope。
- **P+4**：PP0 action-plan 的 3-phase 结构（Truth Registry → E2E Skeleton → FE-1 Handoff）合理避免了 PP0 膨胀为文档项目。Phase 划分粒度与 charter §7.1 的 PP0 交付物要求一致。
- **P+5**：PP1 action-plan 的代码引用精确（`runtime-mainline.ts:235-261`、`session-do-runtime.ts:378-415`等），对 Q6 的三个补充边界条件（interactive ask、timeout、no-client/no-decider）均有对应的 P3-02 e2e 覆盖声明。
- **P+6**：PP5 对 Q18（not-enforced + sunset window）、Q19（degraded + client retry，不是内部 retry）、Q20（禁止 silent allow，独立 unavailable 三态）的 Opus 补强全部落到了具体工作项中（P1-02 enforce/sunset 窗口、P2-02 unavailable tri-state、P3-01 system.error retryable）。
- **P+7**：PP6 action-plan 的 5-phase 结构与 Q21（truthful readiness + 5 选 1 label）对齐精确；Q22（不引入 generator）被 P4-02 的一致性检查方法正确落实为 manual sweep。

### 1.2 已确认的负面事实

- **N-1**：PP0 action-plan header 段（行 10-12）将 `docs/design/pro-to-product/00-agent-loop-truth-model.md` 和 `01-frontend-trust-contract.md` 列为 "上游前序 / closure"。charter §7.1 将这两份文档列为 PP0 的交付物。如果 action-plan 仅引用它们作为 "已完成的设计输入"，而实际上这两份 doc 尚未完成 JIT freeze，则 action-plan 的依赖声明会产生循环引用。当前文件系统中这两份 doc 确实存在（作为 design phase 输出），但 action-plan 的措辞需要澄清它们是 "本计划锁定的对象" 而非 "已完成的前序 closure"。
- **N-2**：PP4 action-plan §1.2 DAG 表（行 13）将 PP3 closure 列为 Phase 1 的 "依赖前序"。但 charter §8.1 与 §8.2 DAG 明确允许 PP3 与 PP4 在 PP1 closure 后**并行**。PP4 对 PP3 的串行化依赖缺少明确理由，唯一可能的耦合点是 hook registration 需要 PP3 的 session state recovery bundle——但这一耦合点并未在 action-plan 中被显式论证。
- **N-3**：PP3 action-plan header 段（行 11-13）同时将 PP1 closure 和 PP2 closure 列为 "上游前序/closure"，形成 PP3 同时依赖 PP1 和 PP2 的结构。charter §8.2 DAG 中 PP3 与 PP2 是 PP1 的两个并行分支，PP3 不依赖 PP2。PP3 action-plan 的更强依赖声明与 charter 冲突。
- **N-4**：Q17（PermissionRequest 无 handler 时 fail-closed）的工程落地路径在 PP4 和 PP5 的 action-plan 中被拆分为两个阶段，但**缺少一个跨 phase 的精确仲裁分段**。PP4 说 "PermissionRequest 缺 handler 时 fail-closed"（作为 constraint），PP5 说 "固化 session rule → tenant rule → approval policy → PP1 HITL → PP4 hook 的优先级"——但 PP5 的这个策略链在何处分岔到 "no handler → fail-closed" 而非 "no handler → go to next policy layer" 并未被定义为一个可测试的 decision table。
- **N-5**：latency baseline 的登记纪律（charter §9.2 + PPX-qna Q2 Opus 补强："每条 phase closure 与 final closure 必须显式登记超阈值次数 / 是否接受 / 复现条件"）在 PP4 action-plan 中完全缺失，在 PP5 中仅在 S6 提及 alert threshold 值但未把 "登记超阈值次数/是否接受/复现条件" 作为 closure 可验证项写入 P4-01 closure deliverable。
- **N-6**：PP0 action-plan 定义的 evidence shape（`trace_uuid`, `start_ts`, `first_visible_ts`, `terminal_or_degraded_ts`, `verdict`）在 PP5 和 PP6 action-plan 中未被显式引用或接续。PP5 的 closure/DOD 应承继 PP0 evidence shape 来记录 latency alert，PP6 应使用 evidence shape 来支撑 readiness label 的数据来源——但两个 action-plan 的 §8 (DOD) 均未包含这一承继要求。
- **N-7**：所有 7 份 action-plan 均引用了 `context/` 下的参考 agent 源码（Gemini CLI、Claude Code、Codex），这些引用作为设计层面的对比参考是合理的。但未对 `context/` 目录在仓库中的实际存在性进行验证——如果这些上下文文件在仓库中不可用，则 action-plan 中的 "参考启发" 段落将成为无法追溯的声明。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 基于文件读取获取的完整行号进行事实引用 |
| 本地命令 / 测试 | `no` | 本轮为纯文档对账审查，不涉及代码运行 |
| schema / contract 反向校验 | `yes (limited)` | 基于 action-plan 自引用的代码路径与 charter 中的 source evidence 进行逻辑校验，未直接读取代码 |
| live / deploy / preview 证据 | `no` | 不适用 |
| 与上游 design / QNA 对账 | `yes` | 逐题对账 PPX-qna Q1-Q22，逐项对账 charter §4/§7/§10 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | PP0 action-plan header 将 00/01 design 列为 upstream 造成交付物-依赖循环 | `high` | `correctness` | `yes` | 修正 header 措辞：标注为 "本计划锁定的 cross-cutting design" 或注明当前冻结状态 |
| R2 | PP3 action-plan 对 PP2 的不必要串行依赖与 charter DAG 冲突 | `high` | `scope-drift` | `yes` | 移除 PP3→PP2 的硬依赖，或在本计划中显式论证为什么 PP3 需要 PP2 的 compact boundary 先行 |
| R3 | PP4→PP3 串行依赖缺乏基准论证，违反 charter 并行授权 | `high` | `scope-drift` | `yes` | 删除 PP4 header 中的 PP3 upstream 依赖，或显式登记为何 PP4 registration 需要 PP3 recovery bundle |
| R4 | Q17 fail-closed 在 PP4/PP5 之间缺少精确仲裁分段（decision table） | `high` | `delivery-gap` | `no` | PP4 §6 或 PP5 §2 新增一个 PermissionRequest 的 decision table：何时入 hook、何时跳过 hook、何时入 HITL |
| R5 | PP4 action-plan 完全缺失 latency baseline 登记纪律 | `medium` | `docs-gap` | `no` | PP4 §5.4 closure deliverable 与 §8.3 DOD 中补充 latency alert 登记要求（引用 charter §9.2 与 PPX-qna Q2） |
| R6 | PP0 evidence shape 在 PP5/PP6 中未被承继 | `medium` | `delivery-gap` | `no` | PP5 §5.4 / PP6 §5.5 的 closure deliverable 中引用 PP0 evidence shape，并说明各 phase 如何填充 |
| R7 | PP0 e2e skeleton 在 PP1-PP6 主实现未开始时适用范围模糊 | `medium` | `test-gap` | `no` | PP0 §5.2 增加说明：首个 skeleton 覆盖什么可测路径（如 facade health + WS connect + runtime read），什么需要 PP1-PP6 扩展 |
| R8 | D1 migration baseline (017) 未在 action-plan 中 audit | `low` | `correctness` | `no` | PP2 §7.2 或 PP3 §7.2 增加 D1 migration count audit 作为 start gate 的前置校验 |
| R9 | Q4 JIT design amend 纪律在 action-plan 中未落地为可执行 checklist | `low` | `docs-gap` | `no` | 各 action-plan §7.3 "需要同步更新的设计文档" 补充一条：若发现 design 冲突需 amend，按 PPX-qna Q4 Opus 补强的 "version + why amended" 纪律执行 |

---

### R1. PP0 action-plan header 将 00/01 design 列为 upstream 造成交付物-依赖循环

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md:10-12` — header 将 `00-agent-loop-truth-model.md` 和 `01-frontend-trust-contract.md` 列为 "上游前序 / closure"
  - `docs/charter/plan-pro-to-product.md:276-278` — charter §7.1 将 00/01 列为 PP0 的交付物
  - `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md:95` — 影响结构图将 00/01 design 放在 Phase 1 产出位置
  - `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md:112-115` — §2.1 S1 说的是 "固化 7 truth gates 的 phase-by-phase 对账方式"，包含对 00/01 的引用，但未产生循环逻辑
- **为什么重要**：
  - Action-plan 的 header "上游前序 / closure" 字段被下游 PP1-PP6 用作 "我可以信任这些文件已经冻结" 的信号。如果 00/01 在 PP0 action-plan header 中被标记为 upstream closure，PP1-PP6 会误以为它们已经是 frozen truth——而 charter 明确它们是 PP0 的交付物。这会导致 PP0 与 PP1 之间的 handoff 信号失真：PP1 可能误在 00/01 未完成时启动。
  - 实际文件系统中 00/01 design 已存在（design phase 产出），所以这不是 blank-file 问题，而是**语义标注错误**。
- **审查判断**：
  - 有两种修正方向：方向 A（推荐）是将 header 中的关系改为 "本计划锁定的 cross-cutting design / 本计划消费并校验的 frozen design"；方向 B 是将 00/01 移至 "关联设计 / 调研文档" 段并标注冻结状态。推荐方向 A，因为它更准确地反映 PP0 "使它们法律生效" 的职责，而不是 "它们已经生效所以我可以依赖"。
- **建议修法**：
  - 将 PP0 action-plan header 的 `上游前序 / closure:` 段中 00/01 的条目改为 `本计划锁定并校验的 cross-cutting design:` 或移入 `关联设计 / 调研文档:` 段并标注 "status: frozen-in-design, locked-by-PP0"

---

### R2. PP3 action-plan 对 PP2 的不必要串行依赖与 charter DAG 冲突

- **严重级别**：`high`
- **类型**：`scope-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md:12-13` — header 将 `PP2-context-budget-closure-action-plan.md` 和 `PP2-closure.md` 列为 upstream
  - `docs/charter/plan-pro-to-product.md:558-566` — charter §8.2 DAG 明确 PP3 与 PP2 都从 PP1 分支出来并行推进
  - `docs/charter/plan-pro-to-product.md:581-582` — charter §8.4 "PP3 可以并行，但不能在 PP1 对 `session-do-runtime.ts` 的关键改动尚未稳定时过早切入" —— 这句话只约束 PP3 不早于 PP1 稳定，不约束 PP3 必须等 PP2
- **为什么重要**：
  - 如果 PP3 action-plan 的串行依赖被执行，PP3 的实际启动将被推迟到 PP2 closure 之后，人为延长 critical path。PP2（compact）与 PP3（reconnect）没有直接的代码耦合面——PP3 的 replay/restore 不依赖 compact boundary 是否已写入。
  - 同时存在一个认知风险：PP3 action-plan 可能因为错写 PP2 依赖，而在 closure 时错误地从 PP2 的 compact boundary 读取数据来验证 replay——这会制造虚假的跨 phase 耦合。
- **审查判断**：
  - PP3 唯一合理的 PP2 引用应该是作为 "recovery bundle 需要包含 context/compact 的 read-model"（即 PP3 Phase 4 的 S5 recovery bundle 可以消费 PP2 的 compact boundary 作为 readiness 数据），但这属于 "PP3 完成后 PP6 统一扫描 recovery + context 两个面的 docs 时再对账" 的范畴，不是 PP3 start gate 的硬依赖。
  - 建议保留 PP3 Phase 4 中引用 compact boundary 的可能性说明，但从 header 的 upstream 段删除 PP2 closure 的 hard prerequisite。
- **建议修法**：
  - PP3 header 中删除 "PP2-context-budget-closure-action-plan.md" 和 "PP2-closure.md" 的 upstream 声明
  - 若 PP3 Phase 4（Recovery Bundle）需要消费 PP2 compact boundary 的 read-model，在 Phase 4 的工作项说明中标明 "若 PP2 closure 已完成，可引用其 compact boundary; 否则 recovery bundle 对应的 context 字段标注 `pending-PP2`"
  - PP3 §7.2 "技术前提" 段中移除 "PP2 compact boundary 可被恢复 bundle 消费"（当前第 322 行），改为 "PP2 compact boundary 若已完成可被 recovery bundle 消费" 或完全移除

---

### R3. PP4→PP3 串行依赖缺乏基准论证，违反 charter 并行授权

- **严重级别**：`high`
- **类型**：`scope-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md:12-13` — header 将 PP3 closure 和 PP3 action-plan 列为 upstream
  - `docs/charter/plan-pro-to-product.md:560-563` — charter §8.2 DAG: PP1 → PP4（PP4 是 PP1 的直接子分支）
  - `docs/charter/plan-pro-to-product.md:580` — charter §8.4 "PP3 可以并行"；charter §7.5 没有要求 PP4 等待 PP3
- **为什么重要**：
  - PP4 的 hook loop 不依赖 PP3 的 reconnect/recovery 逻辑。HookRegistration 在 session scope 内，不涉及 WS replay、detached policy 或 session state snapshot。
  - 如果 action-plan 隐式制造了串行依赖，PP4 可能被阻塞在 PP3 closure 之后，而 charter 明确希望两者并行以缩短 critical path。
- **审查判断**：
  - PP4 的对 PP3 的唯一潜在耦合是 PP4 Phase 4 的 e2e 可能需要在 reconnect 上下文中验证 hook handler 的持久化恢复——但这属于 PP4 closure 阶段的可选验证，不是 PP4 start gate 的硬条件。
  - 建议删除 header 中的 PP3 upstream 声明，并在 PP4 §5.4 (Phase 4) 中注明 "若 PP3 closure 已完成，e2e 可扩展覆盖 hook handler 在 session reconnect 后的持久化/恢复行为"。
- **建议修法**：
  - PP4 header "上游前序 / closure" 段删除 "PP3-reconnect-session-recovery-action-plan.md" 和 "PP3-closure.md"
  - PP4 §7.2 "技术前提" 段（行 325）删除 "PP3 recovery 已稳定"，改为 "PP1 HITL 已稳定；PP3 若已完成，hook e2e 可扩展覆盖 session recovery 场景"

---

### R4. Q17 fail-closed 在 PP4/PP5 之间缺少精确仲裁分段

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/design/pro-to-product/PPX-qna.md:269-271` — Q17 业主回答 "业主已同意 Opus 意见"（即 fail-closed）
  - `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md:50` — "PermissionRequest 缺 handler时 fail-closed，不 fallback confirmation（来源：PPX-qna.md Q17）"
  - `docs/action-plan/pro-to-product/PP5-policy-reliability-hardening-action-plan.md:178` — P2-02 "unavailable 独立于 ask，且 fail-visible"（但说的是 policy unavailable，不是 hook handler absent）
  - `docs/action-plan/pro-to-product/PP5-policy-reliability-hardening-action-plan.md:234-238` — §5.2 "固化 session rule → tenant rule → approval policy → PP1 HITL → PP4 hook 的优先级"
- **为什么重要**：
  - Q17 定义了 handler 缺失时的行为：fail-closed。但 PP4 是 hook 的注册/触发方，PP5 是 policy 的硬化方。两个阶段都可能声称自己负责 "判定 handler 是否存在并执行 fail-closed"。如果 PP4 的 dispatcher 在 emit PermissionRequest 时发现无 handler 就直接 fail-closed，而 PP5 的决策链又期望在 hook 失败后 fallback 到 HITL——这两个行为就会冲突。
  - 更具体地说：PP5 §5.2 的 "session rule → tenant rule → approval policy → PP1 HITL → PP4 hook" 这个 chain 中，PP4 hook 排在最后。如果 PermissionRequest 进入了这个 pipeline，走到 PP4 hook 阶段才发现无 handler，那么 "fail-closed" 到底是 hook 自己的职责（直接 deny），还是 PP5 chain 的职责（hook absent → 向上层报告 unavailable → 由 chain 决定 fail closed vs fallback）——这一点在两个 action-plan 中都未被精确划分。
- **审查判断**：
  - 建议在 PP4 action-plan §2 边界判定表中增加一行：明确 "PermissionRequest 的 handler absent → 由 PP4 dispatcher 返回 fail-closed decision，PP5 chain 在 hook 层收到 'no-handler' 信号时不再继续进入 HITL/allow 分支"。
  - 或者在 PP5 action-plan §5.2 (P2-02) 中显式加入：decision table 中有一行 "hook handler absent → decision=deny, source=hook-no-handler, terminal=true"，不 fall through 到 HITL。
  - 两边的责任边界必须一致，最好在一个 action-plan 中作为 primary definition，另一个中作为只读引用。
- **建议修法**：
  - PP4 §2.3 边界判定表中将 "PermissionRequest no handler" 的 "判定" 从 `in-scope as constraint` 改为 `in-scope: PP4 dispatcher 返回 fail-closed decision, PP5 chain 收到 no-handler 信号后终结不进入 HITL`
  - PP5 §5.2 "决策链" 中在 session rule → ... → PP4 hook 后增加一个分岔节点："hook handler absent → terminal deny (source=hook-no-handler)"，与 "hook outcome blocked → terminal deny (source=hook)" 并列

---

### R5. PP4 action-plan 完全缺失 latency baseline 登记纪律

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/charter/plan-pro-to-product.md:604-605` — latency baseline 覆盖所有 phase
  - `docs/design/pro-to-product/PPX-qna.md:44-46` — Q2 Opus 补强 "每条 phase closure 与 final closure 必须显式登记超阈值次数 / 是否接受 / 复现条件"
  - `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md:190-194` — §4.4 P4-02 (closure) 未提及 latency alert 登记
  - `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md:379-388` — §8.3 DOD 的维度表未包含 latency 维度
- **为什么重要**：
  - PP4 的 hook handler 执行可能引入 frontend-visible latency（handler 执行时间 + blocking wait）。如果 PP4 closure 不登记 hook latency，PP6 final closure 将缺少 hook truth 的体感证据。
- **审查判断**：
  - PP0、PP1、PP2、PP3 均在 closure deliverable 中有 latency alert 记录项，PP5 在 S6 明确写了 retry latency ≤1s 的 alert threshold。PP4 作为唯一完全缺失 latency 纪律的 action-plan，是明显的 docs gap。
- **建议修法**：
  - PP4 §5.4 (Phase 4 closure) 新增一条：closure 中登记 hook handler 执行 latency 的观测结果，引用 PP0 evidence shape 中的 `first_visible_ts` / `terminal_or_degraded_ts`
  - PP4 §8.3 DOD 维度表增加 "latency alert 登记" 行

---

### R6. PP0 evidence shape 在 PP5/PP6 中未被承继

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md:113-114` — S2 定义 unified evidence shape: `trace_uuid`, `start_ts`, `first_visible_ts`, `terminal_or_degraded_ts`, `verdict`
  - `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md:146` — P2-02 "Evidence shape output" 明确要求 "后续 PP1-PP6 可复用证据形态"
  - PP5 action-plan: 全文未出现 "evidence shape" 短语。closure 工作项 P4-01 列出 "enforce matrix、policy chain、stream degraded evidence" 但未声明这些 evidence 的 shape 应承继 PP0 定义
  - PP6 action-plan: 全文未出现 "evidence shape" 短语。Phase 5 closure 工作项 P5-02 列出 "按 7 truth gates 给出 verdict" 但未声明 verdict 应与 PP1-PP5 的 evidence shape 对齐
- **为什么重要**：
  - PP0 定义 evidence shape 的原始意图是避免每个 phase 各自发明证据格式。如果 PP5/PP6 不承继，PP6 final closure 汇总 PP1-PP5 的 evidence 时可能出现格式不一致。
- **审查判断**：
  - PP1-PP4 的 action-plan 中对 evidence shape 的提及也有限（仅在 closure 段落中简短引用）。但 PP5/PP6 完全缺失是最需要修正的，因为 PP6 是 final closure 的编写者，需要以统一格式消费 PP0-PP5 的 evidence。
- **建议修法**：
  - PP5 §8.3 DOD 维度表增加一行 "evidence shape 承继"：closure evidence 使用 PP0 定义的 unified evidence shape
  - PP6 §5.5 (Phase 5) 明确声明：final closure 的各 truth gate verdict 应引用 PP1-PP5 按 PP0 evidence shape 输出的 evidence

---

### R7. PP0 e2e skeleton 在 PP1-PP6 主实现未开始时适用范围模糊

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md:114` — S3 "至少能同时断言一条 HTTP control path、一条 WS event path、一个 durable/read-model truth"
  - `docs/charter/plan-pro-to-product.md:266` — PP0 "交付至少一个真实 e2e skeleton（HITL 或 reconnect 其一）"
  - `docs/charter/plan-pro-to-product.md:293-294` — charter §7.1 risk "若 e2e skeleton 只停在 mock，不走真实代码路径，则会失去 PP0 的意义"
- **为什么重要**：
  - 在 PP1 HITL bridge 未接通、PP3 replay 未修复的情况下，PP0 的 e2e skeleton 能测量什么"真实代码路径"？如果不明确 skeleton 的覆盖范围，它可能退化为 "HTTP health check + WS connect + GET runtime" 这种与 pro-to-product 的 7 truth gates 毫无关系的 trivial 路径。
  - charter 第 293 行的风险提醒在 action-plan 中未被可操作化——action-plan 没有定义 "什么算是真实代码路径的证据"。
- **审查判断**：
  - PP0 的 skeleton 应该在文档中明确：哪些路径是 PP0 可测的（如 facade health、runtime read-model 的一致性），哪些只能标注 "pending PP1-PP6"（如 HITL pause-resume、compact prompt mutation）。这样可以诚实地划定 skeleton 的边界，避免 PP0 closure 时 overclaim。
  - 建议 PP0 action-plan 不声明 skeleton 必须覆盖 "HITL 或 reconnect"，而是声明 skeleton 覆盖 "当前 substrate 的可测真实路径" + 为 PP1-PP6 提供可扩展的 evidence harness。
- **建议修法**：
  - PP0 §5.2 "具体功能预期" 项增加一条："明确 skeleton 的覆盖范围清单：哪些路径在 PP0 可测（列出具体 route/frame），哪些标注 `pending-PP*-implementation`"
  - PP0 §5.2 的收口标准明确：如果 skeleton 的 HTTP+WS+durable 三件套中有任何一项只能走 mock/static fixture，closure 必须诚实标注

---

### R8. D1 migration baseline (017) 未在 action-plan 中 audit

- **严重级别**：`low`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/charter/plan-pro-to-product.md:81` — "`workers/orchestrator-core/migrations/` 当前共 17 个 migration，编号连续到 `017`、无缺口"
  - `docs/charter/plan-pro-to-product.md:188` — §4.5 D1 exception law "若触发新 migration，编号必须从 `018` 起顺延"
  - `docs/action-plan/pro-to-product/PP2-context-budget-closure-action-plan.md:86` — PP2 引用 D1 exception law "从 migration `018` 起顺延"
  - `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md` — PP3 全文未引用 D1 exception law 或 migration count
- **为什么重要**：
  - charter §1.2 的 "017" 是一个声明性事实，未在 action-plan 启动时被验证。如果仓库中有 018 号 migration 已被其他人提交（或在 hero-to-pro 晚期加入），PP2/PP3 的 "从 018 起" 就会碰撞。
  - PP3 涉及 agent-core checkpoint persistence 的修改（Phase 2），可能触发 DO storage schema 变化——但 PP3 action-plan 既未声明需要 D1 exception，也未声明不需要。这使得 PP3 实现者可能在不知情的情况下触发 migration。
- **审查判断**：
  - 建议在 PP2 或 PP3 的 §7.2 "技术前提" 或 §1.4 "约束与前提" 中增加一条 migration baseline audit 作为 start gate 可选项；或者在第零节增加一个通用 start gate checklist 表。
- **建议修法**：
  - PP2 §7.2 "技术前提" 增加："确认 D1 migration 当前最新编号仍为 `017`（与 charter §1.2 一致），若已有 `018` 以上编号存在，需先与 owner 确认下一可用编号"
  - PP3 §7.2 "技术前提" 增加："若 checkpoint persistence 修改涉及 DO storage schema，必须评估是否触发 charter §4.5 D1 exception；若触发，从当前最新编号 + 1 起顺延"

---

### R9. Q4 JIT design amend 纪律在 action-plan 中未落地为可执行 checklist

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/design/pro-to-product/PPX-qna.md:71-73` — Q4 Opus 补强 "design JIT 冻结后，跨 phase 冲突仍允许 design amend（带版本号），不是只允许 closure 标 known issue。amend 必须在 PPX-qna 中登记或在 design 文档 §B 版本历史中显式记录 'why amended after frozen'"
  - 7 份 action-plan 的 §7.3 "文档同步要求" 均写了 "原则上无；若实现发现 design 决策不成立，回到 `PPX-qna.md` amend" 但未给出具体的 amend 步骤（如：谁发起、什么等级的问题需要 amend、amend 后下游 action-plan 如何同步）
- **为什么重要**：
  - 如果不把 amend 纪律转化为可执行步骤，各 phase 实现者遇到 design 冲突时可能选择三种不等价的行为：(a) 直接按代码事实改实现，不 amend design → silent drift；(b) 在 closure 标 known issue → 可能掩盖需要 design 修改的问题；(c) 在 PPX-qna 追加问题 → 可能过量使用。JIT 模式下的 amend 纪律是防止早期 design 变成 zombie contract 的唯一机制。
- **审查判断**：
  - 这不是一个 action-plan 层面的 blocker，但建议在每个 action-plan 的 §7.3 中增加一条明确的 amend path：当实现发现 design/QNA 冲突时，第一步在本 action-plan 的修订历史中记录发现，第二步判断是否需要回到 PPX-qna 补充新 Q，第三步通知下游 action-plan 的 owner。
- **建议修法**：
  - 每个 action-plan §7.3 "需要同步更新的设计文档" 第二句后追加："若实现期发现 design 决策与代码事实矛盾，步骤：(a) 本 action-plan 修订历史记录发现，(b) 评估是否需在 PPX-qna 补充新 Q 或 amend 已有 Q 答案，(c) 通知 charter 与下游 action-plan owner"

---

## 3. In-Scope 逐项对齐审核

> 以下按 charter §10.1 定义的 7 truth gates (T1-T7) 逐项审查对应 action-plan 的覆盖度。

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| T1 — HITL truth | `done` | PP1 action-plan 完整覆盖：ask bridge (P1-01)、decision wakeup (P2-01)、terminal discipline (P2-02)、pending recovery (P3-01)、e2e evidence (P3-02)。Q6 三个补充边界（interactive/timeout/no-client）均对应到工作项 |
| T2 — Context truth | `done` | PP2 action-plan 完整覆盖：budget unification (P1)、compact durable boundary (P2)、no-op 替换 (P3-01)、prompt mutation proof (P3-02)。Q9-Q11 全部正确引用 |
| T3 — Reconnect truth | `done` | PP3 action-plan 完整覆盖：WS early degraded (P1-01)、HTTP/WS parity (P1-02)、persistence symmetry (P2)、single attachment (P3)、recovery bundle (P4)。Q12-Q14 全部正确引用。受 R2 影响需修依赖声明，但不影响覆盖完整度 |
| T4 — Session state truth | `partial` | PP3 Phase 4 定义 recovery bundle 覆盖率 section phase/active turn/pending interaction，但 bundle 的字段清单仍是概念级 "如 confirmations/context/runtime/items/tool calls"，缺乏字段级 spec。对 PP6 docs sweep 来说这种粒度足够，但对于 PP3 closure 来说缺少可测试的具体 assertion |
| T5 — Hook truth | `partial` | PP4 action-plan 覆盖 PreToolUse full loop，但 (a) PermissionRequest fail-closed 未与 PP5 精确定界 (R4)，(b) 缺 latency alert 登记 (R5) |
| T6 — Policy/reliability truth | `done` | PP5 action-plan 完整覆盖：enforce matrix (P1)、policy chain hardening (P2)、stream degraded (P3)、closure (P4)。Q18-Q20 + Q20 Opus 三态建议全部落位 |
| T7 — Frontend contract truth | `partial` | PP6 action-plan 结构完整，但 (a) 22-doc pack inventory 未与当前文件系统对账确认，(b) readiness label 的 5 选 1 集在 Phase 3 中定义为 sweep 产出而非 sweep 标准——即有 label 合规性检查，但无 label 合规判定标准，(c) 缺 PP0 evidence shape 承继 |

### 3.1 对齐结论

- **done**: `4` (T1, T2, T3, T6)
- **partial**: `3` (T4, T5, T7)
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

> 这更像 "所有 7 truth gates 在 action-plan 层面都有了主题覆盖和对应的实现 phase，但 3 条 gates 的 closure 标准在被转化为可执行的、可测试的 verification checklist 之前仍存在粒度不足或跨 phase 定界不清的问题"。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Multi-provider routing (charter §4.2 O1) | `遵守` | 无任何 action-plan 越界引用 multi-provider |
| O2 | Sub-agent / multi-agent (charter §4.2 O2) | `遵守` | 无任何 action-plan 越界 |
| O3 | Admin plane / billing / SDK extraction (charter §4.2 O3) | `遵守` | PP6 正确将 SDK/typegen 标注为 next-stage handoff signal，不在本阶段实现 |
| O4 | Full hook catalog (charter §4.2 O4) | `遵守` | PP4 正确将 scope 收窄至 PreToolUse-only，PostToolUse 标记为 secondary |
| O5 | Sandbox / bash / WeChat (charter §4.2 O5) | `遵守` | PP4 正确将 shell hook 标注为 runtime 硬约束（Q16） |
| O6 | Shell hook (PPX-qna Q16) | `遵守` | PP4 §2.3 边界表中 shell hook 判定为 out-of-scope |
| O7 | LLM summary for PP2 (PPX-qna Q11) | `遵守` | PP2 正确将 LLM summary 标记为 first-wave limitation，不做 closure 前提 |
| O8 | Exactly-once replay (PPX-qna Q12) | `遵守` | PP3 正确声明 best-effort + degraded，不承诺 exactly-once |
| O9 | Multi-attachment / multi-device (PPX-qna Q13) | `遵守` | PP3 正确保持 single attachment + supersede |
| O10 | OpenAPI doc generator (PPX-qna Q22) | `遵守` | PP6 正确声明本阶段不引入 generator |
| O11 | Internal RPC / worker-to-worker seam in PP6 (PPX-qna Q5) | `遵守` | PP6 §2.2 O1 正确声明 "不扫描 internal service-binding RPC" |
| O12 | D1 exception law 引用 (charter §4.5) | `错误风险` | PP2 正确引用了 D1 exception law + 018 起编号。PP3 涉及 checkpoint persistence 修改但未声明是否需要触发 D1 exception——可能无意中漏引用 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`7 份 action-plan 主体成立，PPX-qna 22 道决策全部正确映射，charter §10.1 7 truth gates 的主题覆盖完整。但在规范 PP1-PP6 进入正式开发之前，必须完成 3 项 blocker 修正（R1/R2/R3），并以 follow-up 方式处理 6 项中等/低等严重的盲点（R4-R9）。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **R1** — 修正 PP0 action-plan header 中 00/01 design 的标注为 "本计划锁定并校验的 cross-cutting design"，消除交付物-依赖循环
  2. **R2** — 删除 PP3 action-plan 对 PP2 closure 的硬依赖声明，恢复与 charter §8.2 DAG 一致的并行拓扑
  3. **R3** — 删除 PP4 action-plan 对 PP3 closure 的硬依赖声明，恢复与 charter §8.2 DAG 一致的并行拓扑
- **可以后续跟进的 non-blocking follow-up**：
  1. **R4** — PP4/PP5 之间补上 PermissionRequest handler absent → fail-closed 的精确仲裁分段
  2. **R5** — PP4 action-plan 补上 latency baseline 登记纪律
  3. **R6** — PP5/PP6 action-plan 承继 PP0 evidence shape
  4. **R7** — PP0 action-plan 明确首个 skeleton 覆盖范围与 pending 标注
  5. **R8** — PP2/PP3 action-plan 增加 D1 migration baseline audit
  6. **R9** — 各 action-plan §7.3 增加 JIT design amend 可执行步骤
- **建议的二次审查方式**：`same reviewer rereview`——R1-R3 修改范围明确（各 action-plan header + 个别段落），适合同一 reviewer 在修改后对账。
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待实现者（GPT/action-plan author）完成 R1-R3 blocker 修正后再次提交对账。R4-R9 可直接进入实现阶段作为阶段内校正，但强烈建议在 PP1 start gate 前至少完成 R4（Q17 仲裁分段）和 R7（PP0 skeleton 范围明确）。

---

## 6. 附录：跨文件对照速查表

以下表用于快速定位审查中发现的具体行号与对照关系：

| Action-Plan | 行号 | 问题 | 对应 charter/QNA | 发现编号 |
|-------------|------|------|------------------|----------|
| PP0 | 10-12 | header 将 00/01 列 upstream | charter §7.1 00/01 是 PP0 交付物 | R1 |
| PP3 | 12-13 | header 声明 PP2 为 upstream | charter §8.2 DAG: PP3 ∥ PP2 | R2 |
| PP4 | 12-13 | header 声明 PP3 为 upstream | charter §8.2 DAG: PP4 ∥ PP3 | R3 |
| PP4 | §4.2 P4-02 | closure 缺 latency register | charter §9.2 + Q2 Opus | R5 |
| PP1 | §0 | 未引用 PP0 evidence shape | PP0 S2 evidence shape | N/A (PP1 在 §5.3 closure 中引用了) |
| PP5 | §5.4 P4-01 | closure 缺 evidence shape 继承 | PP0 S2 | R6 |
| PP6 | §5.5 P5-02 | final closure 缺 evidence shape 消费 | PP0 S2 | R6 |
| PP2 | §7.2 | 缺 D1 baseline audit (017) | charter §1.2 | R8 |
| PP3 | §7.2 | 缺 D1 exception 评估 | charter §4.5 | R8 |

---

> 以上审查基于本阶段可获取的全部 18 份相关文档（1 charter + 1 QNA + 8 design + 7 action-plan + 1 code-review-template）。所有行号引用均以文件读取时的实际行号为准，如需行号重定位，按对应文件标题查找。
