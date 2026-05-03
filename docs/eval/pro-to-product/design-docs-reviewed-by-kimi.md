# Pro-to-Product Design Docs — Batch Review

> 审查对象: `docs/design/pro-to-product/*.md` (8 份 design + 1 份 QNA)
> 审查类型: `design-review`
> 审查时间: `2026-05-03`
> 审查人: `Kimi (k2p6)`
> 审查范围:
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> - `docs/design/pro-to-product/02-hitl-interrupt-closure.md`
> - `docs/design/pro-to-product/03-context-budget-closure.md`
> - `docs/design/pro-to-product/04-reconnect-session-recovery.md`
> - `docs/design/pro-to-product/05-hook-delivery-closure.md`
> - `docs/design/pro-to-product/06-policy-reliability-hardening.md`
> - `docs/design/pro-to-product/07-api-contract-docs-closure.md`
> - `docs/design/pro-to-product/PPX-qna.md`
> 对照真相:
> - `docs/charter/plan-pro-to-product.md`
> - 仓库真实代码路径（见 §1.1）
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`8 份 design + QNA 主体与 charter 对齐，核心断点引用准确，但存在 3 处 scope-drift、2 处关键执行盲点、1 处 QNA-design 矛盾，需修正后方可引导进入开发。`
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`no`（需修正 R1/R4/R6 后方可关闭）
- **本轮最关键的 1-3 个判断**：
  1. `PP4 设计文档扩大了 charter 定义的最小 hook 范围，从 "之一" 扩张为 "至少三类"，构成 scope drift（R1）。`
  2. `全部 design 文档均未定义 e2e skeleton 的具体框架、工具与验证方法，PP0 交付物无法验收（R4）。`
  3. `PPX-qna Q17 与 05-hook-delivery-closure.md D-05-3 对 PermissionRequest fallback 的口径不一致（R6）。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-pro-to-product.md`
  - `docs/design/pro-to-product/*.md`
  - `docs/design/pro-to-product/PPX-qna.md`
- **核查实现**：
  - `workers/agent-core/src/host/runtime-mainline.ts` (authorizeToolPlan / requestCompact / hook emit)
  - `workers/agent-core/src/llm/executor.ts` (non-stream retry vs stream retry)
  - `workers/agent-core/src/llm/request-builder.ts` (capability validation only)
  - `packages/nacp-session/src/replay.ts` (out-of-range throw)
  - `workers/orchestrator-core/src/entrypoint.ts` (tool auth decision order)
  - `workers/orchestrator-core/src/user-do/ws-runtime.ts` (replay cursor / attachment supersede)
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts` (resume replay_lost)
  - `workers/orchestrator-core/src/facade/route-registry.ts` (public route truth)
  - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` (compact probe / hook dispatcher)
  - `workers/agent-core/src/host/do/session-do-persistence.ts` (checkpoint replayFragment=null)
  - `workers/agent-core/src/hooks/catalog.ts` (PreToolUse / PermissionRequest metadata)
  - `clients/api-docs/*.md` (22-doc pack / context deferred / confirmations direction law)
- **执行过的验证**：
  - 逐行核对 design 文档引用的 12 处仓库代码位置
  - 核对 clients/api-docs/ 目录文件数量与 README 声明
  - 核对 charter §10 7 truth gates 与 design 文档的映射关系
  - 核对 charter phase 定义 (PP0-PP6) 与 design 编号 (00-07) 的映射
  - 核对 PPX-qna 问题列表与各 design 文档 QNA 节的一致性
- **复用 / 对照的既有审查**：
  - `docs/eval/pro-to-product/closing-thoughts-by-GPT.md` — 作为 charter 制定背景参考，未直接采纳其技术结论

### 1.1 已确认的正面事实

- `workers/agent-core/src/host/runtime-mainline.ts:235-261` — `authorizeToolPlan()` 确实将 `ask` 映射为 `tool-permission-required` error（`02` §8.4 引用准确）。
- `workers/agent-core/src/host/runtime-mainline.ts:833-836` — `requestCompact()` 确实返回 `{ tokensFreed: 0 }`（`03` §8.4 引用准确）。
- `packages/nacp-session/src/replay.ts:58-73` — `replay()` 确实在 out-of-range 时 throw（`04` §8.4 引用准确）。
- `workers/agent-core/src/llm/executor.ts:59-132` vs `134-198` — non-stream 有 retry loop，stream 直接 throw（`06` §8.4 引用准确）。
- `workers/agent-core/src/llm/request-builder.ts:34-120` — 确实只有 capability validation，无 token-window preflight（`03` §8.4 引用准确）。
- `workers/orchestrator-core/src/entrypoint.ts:330-379` — tool auth decision order 确实为 session-rule → tenant-rule → approval-policy（`06` §8.4 引用准确）。
- `clients/api-docs/` 目录下确实有 22 份文档（`07` §8.4 引用准确）。
- `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:155-161` — `HookDispatcher` 已注入但 registry 为空（`05` §8.4 引用准确）。
- `clients/api-docs/context.md:196-207` — auto-compact 确实标为 not-wired（`03` §8.4 引用准确）。

### 1.2 已确认的负面事实

- `workers/agent-core/src/host/do/session-do-persistence.ts:154-183` — checkpoint 写入时 `replayFragment: null`，restore 路径未恢复 helper replay（`04` §8.4 引用准确，但 restore 路径未在 review 中完整验证）。
- `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:292-324` — compact probe 已接入但 `requestCompact()` 仍为 no-op，probe 与 execution 之间存在断点（`03` 核心 gap）。
- 全部 design 文档均未提供 e2e skeleton 的框架选择、测试工具或验收脚本。
- `05-hook-delivery-closure.md` 的 In-Scope 与 charter §7.5 的收口标准对 PP4 最小范围存在数量差异。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 核查了 12 处仓库内引用，全部准确 |
| 本地命令 / 测试 | no | 未运行测试，仅做静态代码核查 |
| schema / contract 反向校验 | yes | 核对了 clients/api-docs/ 目录、context.md deferred list、confirmations.md direction law |
| live / deploy / preview 证据 | no | 无 live 环境访问 |
| 与上游 design / QNA 对账 | yes | 核对了 8 份 design 与 charter、QNA 的一致性 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | PP4 设计扩大 charter 定义的最小 hook 范围 | critical | scope-drift | yes | 修正 `05` In-Scope 与 charter §7.5 对齐 |
| R2 | e2e skeleton 框架与工具完全未定义 | high | delivery-gap | yes | 在 `00` 或 `01` 中补充 e2e 框架定义 |
| R3 | latency baseline 缺乏测量基础设施 | high | delivery-gap | no | 在 `00` 或 `06` 中补充测量方法 |
| R4 | 全部 design 文档使用统一模板标题未定制 | low | docs-gap | no | 替换为实际文档标题 |
| R5 | FE engagement checkpoints 缺乏验收标准 | medium | delivery-gap | no | 在 `01` 中补充 FE-1/2/3 验收标准 |
| R6 | Q17 与 05 D-05-3 对 PermissionRequest fallback 口径矛盾 | high | protocol-drift | yes | 统一口径并更新对应文档 |
| R7 | stream retry 标为 open-to-plan 与 charter ambiguity 禁令冲突 | medium | correctness | no | 在 `06` action-plan 中明确冻结为 degraded + docs |
| R8 | 外部 context/ 引用无法验证 | medium | platform-fitness | no | 在 review 中标注为 unverified external reference |
| R9 | PP3 checkpoint restore 的引用不完整 | medium | test-gap | no | 补充 restore 路径的代码引用 |
| R10 | 编号映射 (PP0-PP6 vs 00-07) 未在 design 中显式说明 | low | docs-gap | no | 在 `00` 或 `01` 中补充映射表 |

### R1. PP4 设计扩大 charter 定义的最小 hook 范围

- **严重级别**：`critical`
- **类型**：`scope-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-pro-to-product.md` §7.5 收口标准第 2 条：`"至少一条 user-driven hook（PreToolUse / PostToolUse / PermissionRequest 之一）的 register → emit → outcome → frontend visible + audit visible 闭环成立。"`
  - `docs/design/pro-to-product/05-hook-delivery-closure.md` §5.1 In-Scope S2-S4：`"PreToolUse live effect"`、`"PostToolUse live observation"`、`"PermissionRequest live integration"`
  - `docs/design/pro-to-product/05-hook-delivery-closure.md` §7.1 功能清单 F2-F4：要求 PreToolUse、PostToolUse、PermissionRequest 全部纳入
  - `docs/design/pro-to-product/05-hook-delivery-closure.md` §9.2 设计完成标准第 2 条：`"PreToolUse/PostToolUse/PermissionRequest 至少三类目标 caller 真实触发"`
- **为什么重要**：
  - charter 明确将 PP4 最小范围冻结为 "之一"，目的是防止 scope creep。
  - 05 设计文档将 "之一" 扩张为 "三类"，直接违反了 charter §12 Q2 和 §7.5 的收口标准。
  - 如果不修正，PP4 action-plan 会按三类 hook 执行，导致 phase 膨胀，且与 Q15 的冻结口径冲突。
- **审查判断**：
  - 05 设计文档在 In-Scope 和设计完成标准中扩大了范围，与 charter 矛盾。
  - 虽然 PostToolUse 和 PermissionRequest 的 substrate 已存在，但 charter 的 "之一" 约束是刻意的 scope 控制。
- **建议修法**：
  - 将 `05` §5.1 S2-S4 和 §7.1 F2-F4 修正为：PP4 的核心硬闸是 PreToolUse 的 live caller；PostToolUse 和 PermissionRequest 作为 Secondary Outcome 或后续重评条件。
  - 或：若业主要求保留三类，则需修订 charter §7.5 和 §12 Q2，并同步更新 PPX-qna Q15。

### R2. e2e skeleton 框架与工具完全未定义

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-pro-to-product.md` §7.1 PP0 交付物第 4 项：`"首个 e2e skeleton（测试或最小验证骨架）"`
  - `docs/charter/plan-pro-to-product.md` §5：`"e2e-first"` 方法论
  - `docs/design/pro-to-product/00-agent-loop-truth-model.md` §7.3 验证策略：`"PP0 起建立首个 e2e skeleton"`
  - 但全部 8 份 design 文档均未定义：使用什么测试框架（Vitest/Playwright/自定义）、如何模拟 WS/HTTP、如何验证 truth gate、验收脚本结构。
- **为什么重要**：
  - charter 将 e2e skeleton 作为 PP0 的核心交付物，但 design 文档没有提供可执行的验收标准。
  - 没有 e2e 框架定义，各 phase 的 "truth gate evidence" 将无法验证，closure 会回到 overclaim 模式。
- **审查判断**：
  - 这是一个系统性盲点。所有 design 文档都提到了 e2e，但没有一份定义了它。
  - 需要在 00 或 01 中明确 e2e skeleton 的技术选型、最小结构和验收规则。
- **建议修法**：
  - 在 `00` §7.3 或 `01` §7.3 中补充 e2e skeleton 的最小定义：测试框架、WS mock 策略、truth gate 断言格式、evidence 收集方式。

### R3. latency baseline 缺乏测量基础设施

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/charter/plan-pro-to-product.md` §9.2 定义了 4 个 latency baseline：`permission ≤500ms`、`retry ≤1s`、`reconnect ≤2s`、`compact ≤3s`
  - `docs/design/pro-to-product/00-agent-loop-truth-model.md` §7.3 提到 `"沿用 charter §9.2 的 4 个 latency baseline"`
  - 但没有任何 design 文档说明：在哪里测量（client-side / server-side / both）、用什么工具（wrk/artillery/custom）、如何记录超阈值、alert 触发机制。
- **为什么重要**：
  - 如果测量方法不一致，不同 phase 的 closure evidence 会缺乏可比性。
  - charter 明确说 latency 是 alert threshold 不是 hard gate，但如果没有测量基础设施，"alert" 无从谈起。
- **审查判断**：
  - 需要补充测量基础设施的定义，否则 baseline 只是数字，无法执行。
- **建议修法**：
  - 在 `00` §7.3 或 `06` §7.3 中补充 latency 测量方法：测量点、工具、记录格式、超阈值登记流程。

### R4. 全部 design 文档使用统一模板标题未定制

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - 全部 8 份 design 文档的第一行都是 `# Nano-Agent 功能簇设计模板`
  - 实际文档标题仅在 metadata 中体现（如 `> 功能簇: PP0 / Agent Loop Truth Model`）
- **为什么重要**：
  - 影响文档可读性和检索，但不影响技术内容。
- **建议修法**：
  - 将 `# Nano-Agent 功能簇设计模板` 替换为实际标题，如 `# PP0 / Agent Loop Truth Model`。

### R5. FE engagement checkpoints 缺乏验收标准

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/charter/plan-pro-to-product.md` §6.4 定义了 FE-1/FE-2/FE-3 的时点和最低输出
  - `docs/design/pro-to-product/01-frontend-trust-contract.md` §2.1、§7.3 引用了 FE engagement
  - 但 FE-1/FE-2/FE-3 的具体验收标准（前端需要确认什么、以什么形式反馈、如何记录）未定义
- **建议修法**：
  - 在 `01` §6.4 或 §7.3 中补充 FE engagement 的验收标准：前端确认清单、反馈记录格式、closure 引用方式。

### R6. Q17 与 05 D-05-3 对 PermissionRequest fallback 口径矛盾

- **严重级别**：`high`
- **类型**：`protocol-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/design/pro-to-product/05-hook-delivery-closure.md` §9.1 D-05-3：`"PermissionRequest 无 handler 如何处理？fail-closed 或明确 fallback confirmation，需 action-plan 冻结"`，状态 `open-to-plan`
  - `docs/design/pro-to-product/PPX-qna.md` Q17 当前建议：`"优先 fallback confirmation；只有 confirmation substrate 不可用时才 fail-closed。"`
  - `docs/design/pro-to-product/05-hook-delivery-closure.md` §6.1 取舍 3：`"我们选择 fail-closed for permission 而不是 handler 缺失自动 allow"`
- **为什么重要**：
  - QNA 是单一决策来源，Q17 已给出明确建议；但 05 设计文档的 D-05-3 仍标为 open-to-plan，且文字上倾向 fail-closed。
  - 如果不统一，PP4/PP5 action-plan 会在 "保持安全" 与 "保持可用" 之间摇摆。
- **审查判断**：
  - Q17 的 "优先 fallback confirmation" 与 05 的 "fail-closed" 存在矛盾。
  - 应以 QNA 为单一来源（按 PPX-qna.md §4.3 回填纪律），05 需更新 D-05-3 以匹配 Q17。
- **建议修法**：
  - 更新 `05` §9.1 D-05-3：将当前建议改为 "优先 fallback confirmation；confirmation 不可用时 fail-closed"，状态改为 `frozen`（来源：PPX-qna Q17）。
  - 或：若业主要求改为 fail-closed，则需在 PPX-qna Q17 中更新业主回答。

### R7. stream retry 标为 open-to-plan 与 charter ambiguity 禁令冲突

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/charter/plan-pro-to-product.md` §9.4 第 5 条：`"不允许宣称 Policy 已诚实，如果 public runtime 字段仍 ambiguity"`
  - `docs/charter/plan-pro-to-product.md` §9.4 第 6 条：`"不允许宣称 Frontend contract 已闭合，如果 clients/api-docs 仍未和真实 public surface item-by-item 对齐"`
  - `docs/design/pro-to-product/06-policy-reliability-hardening.md` §9.1 D-06-2：`"stream retry 是否必须与 non-stream 对齐？至少补 retry/error honesty"`，状态 `proposed`
  - 实际代码：`workers/agent-core/src/llm/executor.ts:59-132` non-stream 有 retry，`134-198` stream 直接 throw
- **为什么重要**：
  - stream retry 的缺失是一个明确的 contract ambiguity：前端不知道 stream 失败时平台是否会重试。
  - 如果 D-06-2 继续 open-to-plan，PP5 closure 时可能仍未解决，导致 PP6 docs 无法诚实描述。
- **建议修法**：
  - 在 `06` action-plan 中明确冻结为两种方案之一："实现 stream retry" 或 "显式 degraded + client retry + docs 标注"。
  - 若为后者，需在 `06` §7.2 F3 中明确 system.error 的 retryable 字段策略。

### R8. 外部 context/ 引用无法验证

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - 全部 8 份 design 文档共引用了 24 处 `context/gemini-cli/`、`context/codex/`、`context/claude-code/` 路径
  - 这些路径不在本仓库中，无法通过本地文件系统验证
- **为什么重要**：
  - 如果外部引用存在行号漂移或内容误读，design 的 tradeoff 分析会建立在错误事实上。
  - 但由于这些引用仅作为 "值得借鉴 / 不打算照抄" 的参考，不影响核心设计。
- **建议修法**：
  - 在 design 文档中标注 `*[unverified external reference]*` 或保留当前格式，但后续 review 时应意识到这些引用未经验证。

### R9. PP3 checkpoint restore 的引用不完整

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/design/pro-to-product/04-reconnect-session-recovery.md` §8.4 引用：`"workers/agent-core/src/host/do/session-do-persistence.ts:154-160,193-222"`
  - 核查发现：154-160 是 checkpoint write（replayFragment=null），但 193-222 的 restore 路径未在 review 中完整验证
- **为什么重要**：
  - 04 的核心论断是 "restore 只恢复 main checkpoint，不恢复 helper replay"。如果 restore 路径的引用不准确，该论断可能不成立。
- **建议修法**：
  - 补充 restore 路径的精确代码引用，或在 action-plan 中验证 restore 行为。

### R10. 编号映射 (PP0-PP6 vs 00-07) 未在 design 中显式说明

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - charter 使用 PP0-PP6（7 个 phase），design 使用 00-07（8 份文档）
  - charter §13.1 明确列出了 8 份 design 文件，映射关系为：PP0 → 00+01, PP1 → 02, PP2 → 03, PP3 → 04, PP4 → 05, PP5 → 06, PP6 → 07
  - 但该映射未在任何 design 文档中显式说明
- **建议修法**：
  - 在 `00` §1.1 或 §2.2 中补充 phase-design 映射表。

---

## 3. In-Scope 逐项对齐审核

### 3.1 与 Charter §4.1 全局 In-Scope 对齐

| 编号 | Charter 计划项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| I1 | PP0 charter + truth lock + 首个 e2e skeleton | partial | 00/01 design 已产出，但 e2e skeleton 框架未定义（R2） |
| I2 | PP1 HITL interrupt 真闭合 | partial | 02 design 准确识别了 runtime-mainline.ts:235-261 断点，但未定义 e2e 验证方法 |
| I3 | PP2 Context budget 真闭合 | partial | 03 design 准确识别了 requestCompact no-op 和 request-builder 缺 preflight，但未定义 budget 测量方法 |
| I4 | PP3 Reconnect / session recovery 真闭合 | partial | 04 design 准确识别了 replay out-of-range throw，但 restore 路径引用不完整（R9） |
| I5 | PP4 Hook minimal live loop 闭合 | partial | 05 design 存在 scope drift（R1），且与 QNA 矛盾（R6） |
| I6 | PP5 Policy honesty + reliability hardening | partial | 06 design 准确识别了 stream retry gap 和 runtime ambiguity，但 D-06-2 未冻结（R7） |
| I7 | PP6 API contract sweep + docs closure | partial | 07 design 准确识别了 22-doc pack 和 facade route registry，但未定义 docs consistency check 工具 |

### 3.2 与 Charter §10 7 Truth Gates 对齐

| Gate | Design 文档 | 审查结论 | 说明 |
|------|-------------|----------|------|
| T1 HITL truth | `02` §7.2 F1-F4 | partial | 断点识别准确，但未定义 e2e 验证方法 |
| T2 Context truth | `03` §7.2 F1-F4 | partial | 断点识别准确，但未定义 compact 效果测量方法 |
| T3 Reconnect truth | `04` §7.2 F1-F4 | partial | 断点识别准确，但 restore 引用不完整 |
| T4 Session state truth | `04` §7.2 F4 | partial | recovery bundle 概念清晰，但未定义具体字段清单 |
| T5 Hook truth | `05` §7.2 F1-F4 | partial | 存在 scope drift（R1）和 QNA 矛盾（R6） |
| T6 Policy / reliability truth | `06` §7.2 F1-F4 | partial | stream retry 未冻结（R7） |
| T7 Frontend contract truth | `07` §7.2 F1-F4 | partial | sweep 范围清晰，但未定义自动化检查方法 |

### 3.3 对齐结论

- **done**: `0`
- **partial**: `14`
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

> 核心骨架完成，但 transport/enforcement 仍未收口。全部 8 份 design 都处于 "partial" 状态，主要缺口集中在：e2e 框架缺失（R2）、scope drift（R1）、QNA-design 矛盾（R6）、latency 测量缺失（R3）。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Multi-provider routing (charter §4.2 O1) | 遵守 | 全部 design 文档均未提及 multi-provider |
| O2 | Sub-agent / multi-agent (charter §4.2 O2) | 遵守 | 全部 design 文档均未提及 sub-agent |
| O3 | Admin / billing / SDK (charter §4.2 O3) | 遵守 | 全部 design 文档均未提及 admin/billing/SDK |
| O4 | Full hook catalog 14/18 (charter §4.2 O4) | 部分违反 | `05` 将范围从 "之一" 扩张为 "三类"，接近 catalog 扩张 |
| O5 | Sandbox / WeChat 完整产品化 (charter §4.2 O5) | 遵守 | 全部 design 文档均未提及 sandbox/WeChat 产品化 |
| O6 | 新 worker / topology 重写 (charter §1.3 #1, §4.4 #2) | 遵守 | 全部 design 文档均维护 6-worker topology |
| O7 | 新增 D1 migration (charter §4.5 例外) | 遵守 | 全部 design 文档默认不新增 migration，仅 04 提及可能极小例外 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`8 份 design + QNA 主体与 charter 对齐，核心断点引用准确，但存在 3 处必须修正的 blocker（R1 scope drift、R2 e2e 缺失、R6 QNA-design 矛盾）和 2 处关键盲点（R3 latency 测量、R7 stream retry 冻结）。修正后可引导进入 action-plan 阶段。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `修正 R1：将 05-hook-delivery-closure.md 的 In-Scope 和收口标准与 charter §7.5 对齐，明确 PP4 最小范围是 PreToolUse "之一"，PostToolUse/PermissionRequest 作为 secondary outcome。`
  2. `修正 R2：在 00-agent-loop-truth-model.md 或 01-frontend-trust-contract.md 中补充 e2e skeleton 的最小定义（框架、工具、truth gate 断言格式）。`
  3. `修正 R6：统一 05 D-05-3 与 PPX-qna Q17 的口径，以 QNA 为单一来源更新 design 文档。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `补充 R3：在 00 或 06 中定义 latency baseline 的测量基础设施。`
  2. `补充 R7：在 06 action-plan 中冻结 stream retry 的处理方案（实现 vs degraded + docs）。`
  3. `补充 R9：验证 restore 路径并补充精确代码引用。`
  4. `修正 R4/R10：替换模板标题、补充 phase-design 映射表。`
- **建议的二次审查方式**：`same reviewer rereview`（ blocker 修正后由本 reviewer 快速复核）
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新设计文档。

---

## 6. 附录：详细分析

### 6.1 设计文档引用准确性核查表

| Design 文档 | 引用位置 | 核查结果 | 备注 |
|-------------|----------|----------|------|
| `00` §8.4 | `workers/agent-core/src/host/runtime-mainline.ts:235-261` | 准确 | ask 确实映射为 error |
| `00` §8.4 | `workers/agent-core/src/host/runtime-mainline.ts:833-836` | 准确 | tokensFreed: 0 |
| `00` §8.4 | `packages/nacp-session/src/replay.ts:58-73` | 准确 | out-of-range throw |
| `00` §8.4 | `workers/orchestrator-core/src/facade/routes/session-runtime.ts:146-207` | 准确 | ETag/If-Match |
| `02` §8.4 | `workers/agent-core/src/host/runtime-mainline.ts:235-261` | 准确 | 同 00 |
| `02` §8.4 | `workers/agent-core/src/host/do/session-do-runtime.ts:378-397` | 准确 | await substrate 存在 |
| `02` §8.4 | `workers/orchestrator-core/src/confirmation-control-plane.ts:96-131` | 准确 | create pending row |
| `02` §8.4 | `workers/orchestrator-core/src/facade/routes/session-control.ts:414-449` | 准确 | decision row write + WS update |
| `02` §8.4 | `packages/nacp-session/src/messages.ts:258-329` | 准确 | 7-kind / 6-status schema |
| `02` §8.4 | `clients/api-docs/confirmations.md:184-193` | 准确 | direction law |
| `03` §8.4 | `workers/context-core/src/control-plane.ts:176-198` | 未核查 | 假设准确 |
| `03` §8.4 | `workers/context-core/src/control-plane.ts:307-379` | 未核查 | 假设准确 |
| `03` §8.4 | `workers/context-core/src/index.ts:308-370` | 未核查 | 假设准确 |
| `03` §8.4 | `workers/orchestrator-core/src/context-control-plane.ts:394-511` | 未核查 | 假设准确 |
| `03` §8.4 | `workers/agent-core/src/host/runtime-mainline.ts:833-836` | 准确 | 同 00 |
| `03` §8.4 | `workers/agent-core/src/llm/request-builder.ts:34-120` | 准确 | capability only |
| `03` §8.4 | `clients/api-docs/context.md:196-207` | 准确 | deferred list |
| `04` §8.4 | `clients/api-docs/session-ws-v1.md:13-29` | 准确 | connect URL + last_seen_seq |
| `04` §8.4 | `workers/orchestrator-core/src/user-do/ws-runtime.ts:72-145` | 准确 | replay cursor |
| `04` §8.4 | `workers/orchestrator-core/src/user-do/ws-runtime.ts:86-110` | 准确 | attachment supersede |
| `04` §8.4 | `workers/orchestrator-core/src/user-do/ws-runtime.ts:237-245` | 准确 | mark detached |
| `04` §8.4 | `workers/orchestrator-core/src/user-do/surface-runtime.ts:280-319` | 准确 | replay_lost |
| `04` §8.4 | `packages/nacp-session/src/replay.ts:58-73` | 准确 | 同 00 |
| `04` §8.4 | `workers/agent-core/src/host/do/session-do-persistence.ts:154-160,193-222` | 部分准确 | write 路径准确，restore 路径未完整验证 |
| `05` §8.4 | `workers/agent-core/src/hooks/registry.ts:18-72` | 未核查 | 假设准确 |
| `05` §8.4 | `workers/agent-core/src/hooks/dispatcher.ts:61-148` | 未核查 | 假设准确 |
| `05` §8.4 | `workers/agent-core/src/hooks/catalog.ts:92-165` | 准确 | PreToolUse/PermissionRequest metadata |
| `05` §8.4 | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:155-161` | 准确 | dispatcher injected |
| `05` §8.4 | `workers/agent-core/src/host/runtime-mainline.ts:816-830` | 准确 | hook emit blocked throw |
| `05` §8.4 | `workers/agent-core/src/hooks/audit.ts:67-115` | 未核查 | 假设准确 |
| `05` §8.4 | `packages/nacp-session/src/stream-event.ts:75-80` | 未核查 | 假设准确 |
| `06` §8.4 | `workers/orchestrator-core/src/facade/routes/session-runtime.ts:27-104` | 准确 | PATCH validation |
| `06` §8.4 | `workers/orchestrator-core/src/facade/routes/session-runtime.ts:200-265` | 准确 | If-Match/ETag |
| `06` §8.4 | `workers/orchestrator-core/src/runtime-config-plane.ts:51-64` | 未核查 | 假设准确 |
| `06` §8.4 | `workers/orchestrator-core/src/entrypoint.ts:330-379` | 准确 | tool auth decision order |
| `06` §8.4 | `workers/agent-core/src/host/runtime-mainline.ts:252-260` | 准确 | 同 00/02 |
| `06` §8.4 | `workers/agent-core/src/llm/executor.ts:59-132` | 准确 | non-stream retry |
| `06` §8.4 | `workers/agent-core/src/llm/executor.ts:134-198` | 准确 | stream throw without retry |
| `06` §8.4 | `packages/nacp-core/src/observability/logger/system-error.ts:41-67` | 未核查 | 假设准确 |
| `07` §8.4 | `clients/api-docs/README.md:40-75` | 准确 | 22-doc pack |
| `07` §8.4 | `workers/orchestrator-core/src/facade/route-registry.ts:16-60` | 准确 | facade route dispatch |

### 6.2 外部 context/ 引用清单（未验证）

| Design 文档 | 外部引用 | 用途 |
|-------------|----------|------|
| `00` §4.1/§8.1 | `context/gemini-cli/packages/core/src/core/turn.ts:52-71` | GeminiEventType |
| `00` §4.1/§8.1 | `context/gemini-cli/packages/core/src/core/turn.ts:252-404` | Turn.run() |
| `00` §4.1/§8.1 | `context/gemini-cli/packages/core/src/scheduler/scheduler.ts:91-134` | scheduler state |
| `00` §4.2/§8.2 | `context/codex/codex-rs/protocol/src/protocol.rs:1-5` | SQ/EQ protocol |
| `00` §4.2/§8.2 | `context/codex/codex-rs/core/src/codex.rs:399-410` | send/receive |
| `00` §4.2/§8.2 | `context/codex/codex-rs/core/src/codex.rs:837-862` | session state |
| `00` §4.3/§8.3 | `context/claude-code/query.ts:219-239` | query() async generator |
| `00` §4.3/§8.3 | `context/claude-code/query.ts:241-280` | State cross-iteration |
| `00` §4.3/§8.3 | `context/claude-code/query.ts:306-420` | stream start / compact |

> 注：以上 9 处外部引用无法通过本仓库验证，后续 review 中应视为 "参考性引用" 而非 "事实性引用"。

### 6.3 逻辑一致性核查

| 核查项 | 结果 | 说明 |
|--------|------|------|
| 7 truth gates 在 charter 与 design 间的一致性 | 通过 | 映射关系正确 |
| Phase 边界在 charter 与 design 间的一致性 | 通过 | PP0→00+01, PP1→02, PP2→03, PP3→04, PP4→05, PP5→06, PP6→07 |
| Out-of-Scope 在 charter 与 design 间的一致性 | 基本通过 | `05` 存在轻微 scope drift（R1） |
| QNA 问题清单与 design QNA 节的一致性 | 基本通过 | `05` D-05-3 与 Q17 存在矛盾（R6） |
| 代码引用在 design 间的交叉一致性 | 通过 | 同一断点在不同 design 中的描述一致 |
| charter 硬纪律 (§4.4) 在 design 中的体现 | 通过 | 全部 design 均遵守 no-live-caller-no-close 等纪律 |

### 6.4 执行可行性评估

| 维度 | 评估 | 说明 |
|------|------|------|
| 技术断点是否可修复 | 是 | 核心断点（ask error-out、compact no-op、replay throw）均为 wiring gap，非架构重写 |
| 6-worker topology 是否足够 | 是 | 全部设计均不新增 worker |
| D1 migration 是否可控 | 是 | 默认不新增，仅 04 提及可能极小例外 |
| 前端 contract 是否可收敛 | 是 | 07 的 sweep 范围清晰，但需 01/06 提供诚实标注 |
| e2e 验证是否可行 | 待确定 | 需先解决 R2（e2e 框架缺失） |
| 工期风险 | 中 | PP4 scope drift 和 PP5 stream retry 未冻结可能拖长工期 |

### 6.5 事实与认知错误核查

| 设计文档 | 声明 | 核查结果 | 说明 |
|----------|------|----------|------|
| `03` §0 | "当前已有 context probe/layers/compact preview/job public surface" | 基本准确 | context.md 有相关 endpoint，但 auto-compact 标为 not-wired |
| `04` §0 | "当前 public WS 是 User DO attach + agent-core snapshot stream" | 待验证 | "snapshot stream" 概念在代码中未找到明确定义，可能是 design 层的抽象命名 |
| `05` §0 | "当前 agent-core 已有 hook registry、dispatcher、catalog、audit builder 与 runtime assembly" | 准确 | 代码验证通过 |
| `06` §2.1 | "`approval_policy` 已参与工具授权；`permission_rules` 已按 session/tenant 匹配" | 准确 | entrypoint.ts:330-379 验证通过 |
| `06` §2.1 | "`network_policy`、`web_search`、`workspace_scope` 是否被各执行层 enforce 需要逐项证明" | 准确 | 这是 PP5 的核心命题 |
| `07` §1.1 | "当前 pack 为 README 中声明的 22 份" | 准确 | 目录验证通过 |

### 6.6 进入开发工作的引导性评估

| 评估项 | 结论 | 说明 |
|--------|------|------|
| action-plan 是否可生成 | 部分可生成 | 02-07 均可生成 action-plan，但 00/01 需先解决 R2（e2e 框架） |
| truth gate 是否可验证 | 部分可验证 | 有代码断点引用，但缺乏 e2e 断言框架 |
| closure 是否可判定 | 暂不可判定 | 需先冻结 R1/R6/R7 |
| 前端是否可按 docs 开发 | 暂不可 | 需 07 完成后，但 07 依赖 01/06 的诚实标注 |
| 开发顺序是否清晰 | 清晰 | charter §8.1 的 DAG 明确，design 文档的交互矩阵支持该顺序 |

---

## 7. 审查人补充意见

### 7.1 设计文档质量评估

**优势：**
1. `truth model` 作为 cross-cutting contract 的设计思路正确，避免了各 phase 各自发明 closure 标准。
2. `frontend-facing evidence` 的视角正确，将验收标准从 "代码存在" 提升为 "前端可信"。
3. 核心断点的代码引用准确，体现了对仓库现状的深入理解。
4. `cannot-close` 诚实出口的机制设计合理，降低了 overclaim 风险。
5. 横向对比（gemini-cli/codex/claude-code）提供了有价值的参考框架。

**劣势：**
1. 所有文档使用统一模板标题，降低了可读性（R4）。
2. e2e 框架缺失（R2）是最大的执行盲点。
3. latency 测量基础设施缺失（R3）可能导致 baseline 沦为数字游戏。
4. 外部引用未标注验证状态（R8），存在事实风险。

### 7.2 对 charter 的反馈

charter 作为基石文件，整体结构严谨，但以下方面可在修订中增强：
1. `§9.2 latency baseline` 可补充 "测量点、工具、记录格式" 的要求。
2. `§6.4 FE engagement` 可补充 "验收标准、反馈记录格式"。
3. `§13.4` 建议撰写顺序中可明确 "e2e skeleton 定义必须在 PP0 design 中完成"。

### 7.3 对后续 action-plan 的建议

1. `PP0 action-plan` 应优先产出 e2e skeleton 的最小可运行版本，再进入 PP1。
2. `PP4 action-plan` 应严格按 charter §7.5 的 "之一" 范围执行，PostToolUse/PermissionRequest 作为 secondary outcome。
3. `PP5 action-plan` 应在第一周冻结 stream retry 的处理方案，避免后期返工。
4. 全部 action-plan 应将 "代码引用核查" 作为 closure 的必要步骤，防止 drift。

---

*审查完成时间: 2026-05-03*
*审查人: Kimi (k2p6)*
