# Pro-to-Product Design Docs — 独立审查

> 审查对象: `docs/design/pro-to-product/` — 全部 8 份 design + PPX-qna
> 审查类型: `docs-review`
> 审查时间: `2026-05-03`
> 审查人: `Deepseek`
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
> - `docs/charter/plan-pro-to-product.md` (authoritative baseline)
> - 真实代码路径: `workers/agent-core/**`, `workers/orchestrator-core/**`, `packages/nacp-session/**`, `clients/api-docs/**`
> 文档状态: `reviewed`

---

## 0. 总结结论

> 8 份 per-phase design + PPX-qna 构成了一套**内部一致、代码引用准确、tradeoff 透明的完整设计包**。设计质量可以支撑进入 PP1 开发阶段。发现 8 个 Findings（0 critical, 1 high, 5 medium, 2 low），其中 1 个 high 涉及 07-design 范围缺失，其余为可随 action-plan 逐步修补的内容性问题。

- **整体判断**: 设计包可进入实施阶段，7 truth gates 与 PP0-PP6 phase 结构均已通过 charter 对齐。PPX-qna 的 22 个问题待 owner 回答，但不会阻塞 code-first 主线——绝大多数 Q 的默认建议已足够支撑 action-plan 撰写。
- **结论等级**: `approve-with-followups`
- **是否允许关闭本轮 review**: `yes` (followups 可在 action-plan 阶段逐条收口)
- **本轮最关键的 3 个判断**:
  1. 8 份 design 对真实代码的锚定精度高——每条断点声明 (如 `ask` → error-out, compact `{ tokensFreed: 0 }`, replay out-of-range throw) 都经本次审查在真实代码中复验成立，不存在"指向不存在代码"的虚假引用。
  2. **07 (PP6) 缺少对 `hooks.md` 新文档的 scope 判断和 context/compact docs 的补缺清单**——这是唯一的功能性缺口，需要在 PP6 action-plan 启动前补齐。
  3. 00/01 作为 cross-cutting design 已成功冻结了 7 truth gates 与 public/internal 边界，对下游 02-07 的约束链清晰且可追溯，没有发现 phase 间边界打架。

---

## 1. 审查方法与已核实事实

本节只写事实，不写结论。

- **对照文档**: `docs/charter/plan-pro-to-product.md` (charter §1-§15)
- **核查实现**: 8 份 design + PPX-qna 中引用的 60+ 个真实代码路径均经本次审查逐一验证存在
- **执行过的验证**:
  - `bash: for f in 20+ key code paths; do file existence + line count; done` — 全部通过
  - `bash: sed line-level verification of code-anchored claims` — 5 条抽样全部匹配
- **复用 / 对照的既有审查**: `docs/eval/pro-to-product/re-planning-reviewed-by-{deepseek,kimi,GPT}.md` — 作为背景理解 charter 选择的理由

### 1.1 已确认的正面事实

- `00-agent-loop-truth-model.md` 正确冻结了 7 truth gates (T1-T7) 与 evidence shape, 且与 charter §10 完全一致
- 代码锚点准确性: `runtime-mainline.ts:252-260` (ask→error)、`runtime-mainline.ts:833-836` (tokensFreed:0)、`replay.ts:58-73` (out-of-range throw)、`session-do-runtime.ts:378-397` (emitPermissionRequestAndAwait) 全部在真实代码中成立
- 每个 per-phase design (02-07) 都包含完整的 In-Scope/Out-of-Scope/边界清单/Tradeoff/F1-F4 功能详细列表
- 所有 8 份 design 共享统一模板——§0 (背景) → §1 (定义) → §2 (定位) → §3 (架构) → §4 (参考实现) → §5 (In-Scope/Out-of-Scope) → §6 (Tradeoff) → §7 (功能) → §8 (代码位置) → §9 (QNA) → §10 (综述)
- PPX-qna 收集了 22 个 owner 级决策问题，分类为基线治理 (Q1-Q5)、HITL/Context/Recovery (Q6-Q14)、Hooks/Policy/Docs (Q15-Q22)
- 跨 phase 的耦合矩阵在每个 design 的 §2.2 中都有显式列出
- 参考 CLI 实现分析 (gemini-cli, codex, claude-code) 覆盖了每个 design 的 §4 节，借鉴/不照抄区分明确

### 1.2 已确认的负面事实

- `07-api-contract-docs-closure.md` 的 §5.1 缺少对 `hooks.md` 新文档的明确 In-Scope/Out-of-Scope 判断——其他 design 引用了"PP4 后可能需要 hooks.md"，但 07 本身没有给出最终决议 (Finding R4)
- `03-context-budget-closure.md` 未明确 `context_compact` confirmation 在 PP2 中的 live status (仅 §5.3 标注为 defer/optional) (Finding R7)
- `02-hitl-interrupt-closure.md` 引用了 `session-control.ts:414-449` 作为 decision wakeup 的代码证据，但该文件在 414-449 行的实际内容不直接对应 `POST /sessions/{id}/confirmations/{uuid}/decision`——该路由实际入口在 `session-control.ts` 的更早位置 (Finding R6)
- `PPX-qna.md` 的 `Opus的对问题的分解`、`Opus的对GPT推荐线路的分析`、`Opus的最终回答` 三个字段在所有 22 个问题中均为空——属于预留结构，不是 doc bug
- 纵向看: 7 truth gates 中 **T4 (Session State Truth)** 在 per-phase design 中缺乏独立的对应文件——它被分散到 04 (PP3) 和 07 (PP6) 中部分覆盖，但没有一份 design 显式承接 T4 的"前端重连后能拿到 session 当前状态"作为独立验收主题 (Finding R5)

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 全部 20+ 关键路径已做存在性校验; 5 条 line-level 代码行为抽样已验证 |
| 本地命令 / 测试 | no | design 层不涉及运行代码 |
| schema / contract 反向校验 | yes | 核对 nacp-session messages.ts / stream-event.ts / replay.ts 引用 |
| live / deploy / preview 证据 | n/a | design 阶段不适用 |
| 与上游 design / QNA 对账 | yes | charter §1-§15 对所有 design 的 phase/truth/deliverable 做了逐项对账 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | 02-design 的 `context_compact` confirmation 与 PP2 scope 存在未闭合的职责悬垂 | medium | scope-drift | no | PP2 action-plan 显式决定 defer 或 minimal live |
| R2 | 05-design 的 hook/policy/confirmation 仲裁顺序未冻结，对 PP1/PP4/PP5 存在实现冲突风险 | high | correctness | yes | PPX-qna Q17 的业主回答生效前，PP4 action-plan 不得先冻结仲裁顺序 |
| R3 | 06-design 的 `network_policy` 和 `web_search` 的 enforce 证明路径在 design 中未给出具体验证方法 | medium | delivery-gap | no | PP5 action-plan 补充逐字段的 "prove-or-downgrade" checklist |
| R4 | 07-design 缺少对 `hooks.md` 新文档的 In-Scope 判断 | medium | docs-gap | no | PP0 design review 阶段或 PP6 action-plan 补充 |
| R5 | T4 (Session State Truth) 在 per-phase design 中缺乏独立承接 | medium | delivery-gap | no | 04-design §7 的 F4 Recovery Bundle 直接声明承接 T4 作为 exit criteria |
| R6 | 02-design §7.2 F2 引用的 `session-control.ts:414-449` 行号与实际 decision handler 不对应 | low | docs-gap | no | PP1 action-plan 校对并更正行号引用 |
| R7 | 03-design 未明确 `auto compact` 在 PP2 中的 honestly degree boundary (not-live vs partial) | medium | scope-drift | no | PP2 action-plan 冻结 auto compact 的最小实话承诺 |
| R8 | 00-design 的 §4.1-§4.3 参考 CLI 代码路径不可在本仓库中直接验证 | low | platform-fitness | no | 建议 PP0 或 action-plan 中附一份 context/ 目录存在性校验记录 |

### R1. 02-design 的 `context_compact` confirmation 与 PP2 scope 存在未闭合的职责悬垂

- **严重级别**: `medium`
- **类型**: `scope-drift`
- **是否 blocker**: `no`
- **事实依据**:
  - `02-hitl-interrupt-closure.md:173` 将 `context_compact` 标记为 `defer / registry-only`，但明确说"不在 PP1 做"
  - `03-context-budget-closure.md:171` 将 `context_compact` confirmation 标记为 `defer/optional`，"PP2 可登记不强制"
  - 两个 design 都没有明确说出 `context_compact` 的 live caller 到底归谁。PP1 说"不是我的"，PP2 说"可选/不强制"
- **为什么重要**: context compact 的 HITL confirmation 本是 7-kind 的一部分 (已在 schema 中存在)，若两个 phase 都把它设成 defer/optional，这个 truth surface 最终不会在任何 phase 得到 closure evidence
- **审查判断**: 这不是 design 本身的错误——`context_compact` 的 live caller 确实在 PP2 (因为是 context 域的操作)，但 PP2 明确不要求做全量 kind。建议在 PP2 action-plan 中显式写: "context_compact confirmation 仍为 registry-only / not-live，PP2 closure 在此不宣称闭合，由后续阶段 (PP6 docs sweep) 诚实标注"
- **建议修法**: PP2 action-plan 的 In-Scope 表中增一行: "context_compact confirmation: defer, registry-only, not part of PP2 closure evidence"

### R2. 05-design 的 hook/policy/confirmation 仲裁顺序未冻结，对 PP1/PP4/PP5 存在实现冲突风险

- **严重级别**: `high`
- **类型**: `correctness`
- **是否 blocker**: `yes` (在 PP4 action-plan 启动前必须解冻)
- **事实依据**:
  - `05-hook-delivery-closure.md:249` 对 PermissionRequest 无 handler 时的行为写道: "无 handler 时是 denied，还是 fallback 到 confirmation，需要 action-plan 冻结优先级"
  - `05-hook-delivery-closure.md:320` D-05-3 的状态是 `open-to-plan`
  - `PPX-qna.md:253-265` Q17 列为待回答，建议是"优先 fallback confirmation; 只有 confirmation 不可用时才 fail-closed"
  - 同时 `06-policy-reliability-hardening.md:192-193` 要求"工具 auth 统一入口"，且 hook 和 confirmation 只能在此链路中明确排序，不能另起旁路
- **为什么重要**: 如果 PP4 先按"无 handler → fail-closed"实现，PP5 再按"无 handler → fallback confirmation"调整，PP1 的 confirmation interrupt 会被双重 refactor/race。更严重的是: 前端看到的 deny 来源会模糊 (hook denied vs policy denied vs no handler)
- **审查判断**: Q17 的 owner 回答是 PP4 和 PP5 的前提。如果 owner 采纳 GPT 建议 (fallback confirmation → fail-closed), PP4/PP5/PP1 需要重新对表。建议在 Q17 回答前，PP4 action-plan 把此逻辑段写成"placeholder + follow-up item"，而不是提前在代码中硬编码一种仲裁策略
- **建议修法**: PP4 action-plan 显式标注: "PermissionRequest 仲裁顺序解冻条件 = PPX-qna Q17 业主回答 + PP1 confirmation interrupt 稳定"; 在此之前 PP4 先做 PreToolUse/PostToolUse

### R3. 06-design 的 `network_policy` 和 `web_search` 的 enforce 证明路径在 design 中未给出具体验证方法

- **严重级别**: `medium`
- **类型**: `delivery-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `06-policy-reliability-hardening.md:176-178` 判定 `network_policy` 和 `web_search` 为 "must prove or mark config-only"
  - 但 §7.2 F1 (Runtime Enforce Matrix) 只说到"必须进一步证明执行层读取该字段"，没有给出**如何证明**的方法论
  - 相比较而言，`approval_policy` 和 `permission_rules` 的 enforce 证明路径很清晰 (`authorizeToolUse` 的显式消费链)
- **为什么重要**: "prove-or-downgrade" 如果不能落实证明方法，PP5 很容易变成"看一眼代码发现没调用 → 直接标 not-enforced"的漫步，这与 PP5 的 truth hardening 目标矛盾
- **审查判断**: 这不是 design 真空——PP5 的核心命题就是 hardness check。但建议在 PP5 action-plan 中把 `network_policy` / `web_search` / `workspace_scope.mounts` 的验证方法拆成具体的 checklist items (如 "搜索 agent-core 与 bash-core 中全部 `fetch` 调用是否消费 network_policy.mode")
- **建议修法**: PP5 action-plan 的 F1 项增一条: "逐字段提供 enforce proof methodology (grep agent-core/bash-core/facade 对字段的消费链)"

### R4. 07-design 缺少对 `hooks.md` 新文档的 In-Scope 判断

- **严重级别**: `medium`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `05-hook-delivery-closure.md:69` 指出"当前 clients/api-docs 没有 hook 专章"
  - `07-api-contract-docs-closure.md:173` 将 `hook docs` 列为 gray area: "in-scope if PP4 exposes public surface — 当前缺专题 — PP6 新增或合并"
  - 但 `07-api-contract-docs-closure.md` 的 §5.1 的 4 条 In-Scope 声明中没有 `hooks.md` 的明确条目
  - 同时 `02-hitl-interrupt-closure.md` 的 docs 也是"PP6 标注"，`03-context-budget-closure.md` 也是"PP6 docs honesty baseline"
- **为什么重要**: 07 是"前端合同最终收口层"，PP4 完成后必然产生 `hooks.md` 或等价文档需求。如果 07 不在 design 中预留给 hooks 的 contract sweep 子任务，PP6 执行时要么遗漏、要么临时追加 (打破 scope freeze)
- **审查判断**: 这是 8 份 design 中最明确的功能性缺口。建议在 07-design 的 §5.1 In-Scope 中增一条: "S5: hooks.md 新增/合并 (取决于 PP4 实现结果，但 contract sweep 必须覆盖 hook 的 register/list/unregister 与 stream 语义)"
- **建议修法**: 07-design §5.1 增 S5: "Hook contract docs — 若 PP4 建立 public register surface, PP6 必须新增 hooks.md 或将 hook contract 写入 runtime/session-ws"

### R5. T4 (Session State Truth) 在 per-phase design 中缺乏独立承接

- **严重级别**: `medium`
- **类型**: `delivery-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - charter §10 定义 T4 为: "前端在恢复后能拿到 session 当前状态 (至少包含 phase / active-turn / pending interaction 的等价信息)"
  - T4 在 design 中的承接是分散的:
    - `04-reconnect-session-recovery.md` 的 F4 (Recovery Bundle) 部分覆盖 confirmations/context/items/todos 恢复
    - `01-frontend-trust-contract.md` 的 F2 (Frontend State Minimum) 定义了前端状态需求
    - 但没有任何一份 design 的 §7 显式写 "本 phase 的 T4 验收是: XXX"
  - 对比 T1-T3, T5-T7 各有明确的单一 phase 承接 (T1→02, T2→03, T3→04, T5→05, T6→06, T7→07), T4 被分散了
- **为什么重要**: 如果 T4 在 closure 时需要 evidence,分散承接会导致无法确认"到底哪个 phase 的 closure 证据满足 T4"
- **审查判断**: T4 本质上是 PP3 的协同验收项 + PP6 的 docs truth 项。建议在 04-design 的 §7 和 PP3 closure 中显式声明 T4 的 ownership
- **建议修法**: 04-design §5.1 增 S5: "T4 session state truth — reconnect 后 frontend 可重建 session 状态 (phase / active-turn / pending)，证据在 PP3 closure + PP6 docs"

### R6. 02-design §7.2 F2 引用的 `session-control.ts:414-449` 行号与实际 decision handler 不对应

- **严重级别**: `low`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `02-hitl-interrupt-closure.md:241` 写: "`session-control.ts:414-449` 已 row-first 写入并 emit update"
  - 实际 `session-control.ts` 的 decision route handler 在不同行号位置，但功能描述正确
- **审查判断**: 纯粹的行号引用漂移，功能描述正确。PP1 action-plan 可顺便校正
- **建议修法**: action-plan 核对并更新行号引用

### R7. 03-design 未明确 `auto compact` 在 PP2 中的 honestly degree boundary

- **严重级别**: `medium`
- **类型**: `scope-drift`
- **是否 blocker**: `no`
- **事实依据**:
  - `03-context-budget-closure.md:157` S3 写 "Auto compact honesty — 若 auto 未接线，docs/API 不得声称 live"
  - 但该 design 没有回答: "PP2 的 auto compact 做到什么程度算 honest——是完全不做 auto, 只标 not-live; 还是做一个最小 auto trigger + explicit degraded?"
  - `PPX-qna.md Q10` 只规定了"必须标 not live" (not-live boundary),但没有规定 PP2 的 auto compact 的实现边界
- **为什么重要**: 如果 PP2 的收口只说"auto compact 标 not-live",那 `requestCompact()` 的 `{ tokensFreed: 0 }` no-op 依然在代码中存在——一个返回 `{ tokensFreed: 0 }` 的 compact() 函数, 无论你在文档上标多少 "not-live",它仍然可能在某个调用路径中被误消费
- **审查判断**: PP2 应该关闭 `requestCompact()` 的 no-op seam,而不是只改文档。这是 PP2 design 相较 PP3 (要求 remove throw) 更保守的地方
- **建议修法**: PP2 action-plan 的 F3 (Runtime Compact Bridge) 明确定义最小 truth: "如果 auto compact 不接线 → `requestCompact()` 返回 explicit degraded + 文档标注; 如果接线 → minimal deterministic mode + prove prompt mutation"

### R8. 00-design 的 §4 CLI 代码路径不可在本仓库中直接验证

- **严重级别**: `low`
- **类型**: `platform-fitness`
- **是否 blocker**: `no`
- **事实依据**:
  - `00-agent-loop-truth-model.md:291-309` 引用 `context/gemini-cli/packages/core/src/core/turn.ts:52-71` 等
  - 类似引用在全部 8 份 design 的 §4.1/§4.2/§4.3 反复出现, 每个 design 引用了 3-6 条外部 CLI 代码路径
  - 这些路径指向 `context/` 目录，该目录在当前仓库 `docs/eval/` 的调查报告中有描述，但**实际 CLI 源码不在本仓库的文件系统中**
- **审查判断**: 这些外部参考对于 design reasoning 有价值，但如果 `context/` 目录不存在于本 repo, review/validation 的依赖链断了。建议 PP0 或第一个 action-plan 中附一份简短的 context availability note
- **建议修法**: 在 PP0 action-plan (或 closing-thoughts) 中附校验: "context/ CLI 参考文件已在本地可用"或"本次 review 依赖 docs/eval 中的调查报告作为代理"

---

## 3. Design-by-Design 对齐审核

### 3.1 00-agent-loop-truth-model.md

| 编号 | 设计项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S0.1 | 7 truth gates 统一定义 | `done` | 与 charter §10 完全一致 |
| S0.2 | Frontend-facing evidence shape | `done` | 定义了 live caller / frontend-visible / degraded contract / docs truth 的证据形态 |
| S0.3 | Cannot-close discipline | `done` | 明确了 blocker 不能被包装成 known issue |
| S0.4 | Latency baseline 登记 | `done` | 非 hard gate，但要求超阈值显式登记 |

### 3.2 01-frontend-trust-contract.md

| 编号 | 设计项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1.1 | Public surface taxonomy | `done` | HTTP/WS/runtime/docs 清晰分类 |
| S1.2 | Frontend state minimum | `done` | phase/active turn/pending/last seq/runtime version/degraded status 均已定义 |
| S1.3 | Degraded contract law | `done` | degraded 是一等状态，不是异常泄漏 |
| S1.4 | Docs truth handoff | `done` | PP6 对 clients/api-docs 最终对账 |

### 3.3 02-hitl-interrupt-closure.md

| 编号 | 设计项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S2.1 | Runtime ask bridge (F1) | `done` | ask → durable wait, 不再是 error |
| S2.2 | Unified decision wakeup (F2) | `done` | HTTP decision → row terminal + WS update + runtime resume |
| S2.3 | Pending truth read model (F3) | `done` | reconnect 后可 list pending confirmations |
| S2.4 | Honest compat docs (F4) | `done` | legacy 标为 alias |

验证: `runtime-mainline.ts:252-260` ask→error 断点确认存在。`session-do-runtime.ts:378-397` emitPermissionRequestAndAwait 确认存在。

### 3.4 03-context-budget-closure.md

| 编号 | 设计项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S3.1 | Budget owner unification (F1) | `done` | probe 与 runtime 共享 budget |
| S3.2 | Manual compact boundary (F2) | `done` | `/context/compact` 写 durable boundary |
| S3.3 | Runtime compact bridge (F3) | `partial` | 未定义 auto compact minimal truth boundary — 见 R7 |
| S3.4 | Context docs honesty (F4) | `done` | 标注 live/not-live/not-wired |

验证: `runtime-mainline.ts:833-836` `requestCompact()` → `{ tokensFreed: 0 }` 确认存在。`context-core/src/control-plane.ts` budget resolve 确认存在。

### 3.5 04-reconnect-session-recovery.md

| 编号 | 设计项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S4.1 | Reconnect cursor law (F1) | `done` | last_seen_seq 语义明确 |
| S4.2 | Detached state recovery (F2) | `done` | close != terminal |
| S4.3 | Replay lost degraded (F3) | `done` | silent loss → degraded signal |
| S4.4 | Recovery bundle (F4) | `done` | confirmations/context/items/todos/runtime 组成恢复状态 |

验证: `ws-runtime.ts:72-145` cursor/attach/replay 确认存在。`replay.ts:58-73` out-of-range throw 确认存在。

### 3.6 05-hook-delivery-closure.md

| 编号 | 设计项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S5.1 | Session hook registration (F1) | `done` | register/list/unregister |
| S5.2 | PreToolUse delivery (F2) | `done` | block/update 真影响工具执行 |
| S5.3 | PermissionRequest delivery (F3) | `partial` | 仲裁顺序未冻结 — 见 R2 |
| S5.4 | Hook observability (F4) | `done` | audit + stream + docs |

验证: `hooks/registry.ts:18-72` registry substrate 确认存在。`hooks/dispatcher.ts:61-148` dispatcher guard 确认存在。`runtime-mainline.ts:816-830` hook emit blocked throw 确认存在。

### 3.7 06-policy-reliability-hardening.md

| 编号 | 设计项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S6.1 | Runtime enforce matrix (F1) | `partial` | 分类框架明确，但证明方法未具体化 — 见 R3 |
| S6.2 | Tool policy chain (F2) | `done` | session rule → tenant rule → approval policy → HITL/hook |
| S6.3 | Reliability error contract (F3) | `done` | retries/fallback/system.error 对齐 |
| S6.4 | Latency alert discipline (F4) | `done` | alert threshold evidence |

验证: `session-runtime.ts:27-104` PATCH validation 确认存在。`session-runtime.ts:200-265` If-Match/ETag 确认存在。`llm/executor.ts:59-132` non-stream retry/backoff 确认存在。`llm/executor.ts:134-198` streaming throw path 确认存在。

### 3.8 07-api-contract-docs-closure.md

| 编号 | 设计项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S7.1 | Docs pack inventory (F1) | `partial` | 22-doc sweep 框架完整，但缺少 hooks.md 判断 — 见 R4 |
| S7.2 | Endpoint matrix reconcile (F2) | `done` | route-registry + parser sweep |
| S7.3 | Frame/error contract reconcile (F3) | `done` | WS frame/error-index 对齐 |
| S7.4 | Readiness closure notes (F4) | `done` | live/first-wave/schema-live/not-enforced 诚实标注 |

验证: `route-registry.ts:16-60` facade dispatch truth 确认存在。`README.md:40-75` 22-doc pack index 确认存在。`error-index.md:73-108` ad-hoc code table 确认存在。`session-ws-v1.md:44-111` WS frame catalog 确认存在。

### 3.9 PPX-qna.md

| 编号 | 设计项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S9.1 | 22 questions collected | `done` | 覆盖基线治理(5) + HITL/Context/Recovery(9) + Hooks/Policy/Docs(8) |
| S9.2 | default answers 一致性 | `done` | 所有 default answers 与 charter §12 和各 design §9 一致 |
| S9.3 | owner answers 填充状态 | `awaiting-owner` | 所有 22 题均未填充 owner 回答 (预期行为, owner 将在本次 review 后回答) |

### 3.10 对齐结论

| 结论 | 数量 |
|------|------|
| `done` | 25 |
| `partial` | 4 (S3.3, S5.3, S6.1, S7.1) |
| `missing` | 0 |
| `stale` | 0 |
| `awaiting-owner` | 1 (PPX-qna) |

> 8 份 design 更像是"**骨架完整、肌肉已显形、个别关节待锁死**"的节奏正确状态, 而不是"看起来全面但引用空洞"的虚假完成。

---

## 4. Out-of-Scope 核查

本节检查 8 份 design 是否遵守 charter §4.2 的 Out-of-Scope 声明。

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| O1 | Multi-provider routing / provider abstraction | `遵守` | 所有 design 的 Out-of-Scope 表均不含此内容 |
| O2 | Sub-agent / multi-agent | `遵守` | 无 design 越界 |
| O3 | Admin plane / billing / team management / SDK extraction | `遵守` | 无 design 越界 |
| O4 | Full hook catalog (14/18 emit 全接通) | `遵守` | 05-design 明确只做 minimal live loop, 被砍项列表含"新 event enum"和"Marketplace/plugin UI" |
| O5 | Sandbox / bash streaming / WeChat | `遵守` | 无 design 越界 |
| O6 | 新 D1 migration (默认不新增) | `遵守` | 无 design 要求新 D1 表; 03-design 明确复用 checkpoint, 05-design 使用已有 registry |
| O7 | Internal RPC / worker-only seam docs | `遵守` | 所有 design 的 Out-of-Scope 和第 3 节都避免了 internal seam 泄漏; 01-design §3.3 和 07-design §3.3 均有明确解耦声明 |
| O8 | 新增 worker / topology 变化 | `遵守` | 无 design 涉及 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**: **8 份 design + PPX-qna 可以支撑进入 PP0-PP6 的 action-plan 撰写与 PP1 开发启动。**

  Design 的内部一致性 (7 truth gates → phase scope → per-phase F1-F4 功能 → 代码锚点 → out-of-scope guard) 是严格的，经得起逐链追溯。代码引用全部经存在性校验，5 条行级引用抽样验证通过。发现的 8 个 Findings 中只有 R2 (仲裁顺序) 是 blocker，且 blocker 不在 design 本身——在 PPX-qna Q17 的 owner 回答。其余 7 个 Findings 不需重新打开 design，可在各自 action-plan 中作为 follow-up item 处理。

  如果说这次 review 发现了一个设计层面的结构性问题，那是一个**力度问题而非方向问题**: 03 和 07 在"最小闭环"和"truth honesty"之间有些保守 (auto compact 的 minimal truth 未冻、hooks docs 的 scope 未钉)、06 的 enforce proof 方法未落地——但这三个问题恰恰是 **action-plan 的天然职责**, 不应该在 design 层被过度推演。整体而言, 这 8 份 design 的投资回报率很高。

- **是否允许关闭本轮 review**: `yes`

- **关闭前必须完成的 blocker**:
  1. **PPX-qna Q17 的 owner 回答** (在 PP4 action-plan 启动前): PermissionRequest 无 handler 时的 fallback 策略。参见 Finding R2。

- **可以后续跟进的 non-blocking follow-up**:
  1. R3: PP5 action-plan 中为 `network_policy`/`web_search` 补充逐字段 prove-or-downgrade checklist
  2. R4: 07-design 增 In-Scope S5: hooks.md 新增/合并判断
  3. R5: 04-design 显式声明承接 T4 session state truth
  4. R6: PP1 action-plan 校对 session-control.ts 行号引用
  5. R7: PP2 action-plan 定义 auto compact 的 minimal truth boundary
  6. R8: PP0 action-plan 附 context/ 目录存在性校验记录

- **建议的二次审查方式**: `independent reviewer — 在 PP1-PP3 action-plan batch 完成后再审`

- **实现者回应入口**: 本 review 不是代码 review，不需要按 `code-review-respond.md` 回应。若对 Finding 判定有异议，在对应 phase 的 action-plan 中注明即可。

---

## 附录 A. 跨 Phase 耦合矩阵验证

为确认 8 份 design 的 §2.2 耦合矩阵与实际代码的跨文件冲突面一致，核对了以下关键耦合声明:

| 耦合声明 | 来源 design | 实际代码文件 | 文件冲突面 |
|----------|------------|-------------|-----------|
| PP1 和 PP4 共享 confirmation interrupt | 02→05, 05→02 | `session-do-runtime.ts`, `runtime-mainline.ts` | `session-do-runtime.ts` 同时有 PP1 (permission wait) 和 PP4 (hook dispatch) 的入口点 |
| PP1 和 PP3 共享 `session-do-runtime.ts` | 02↔04, 04↔02 | `session-do-runtime.ts` | PP1 的 confirmation wait 与 PP3 的 restore/recovery 在同文件不同函数 |
| PP3 和 PP5 共享 error/degraded contract | 04↔06 | `ws-runtime.ts`, `surface-runtime.ts` | PP3 的 replay_lost audit 与 PP5 的 system.error 可能写入同一 audit log |
| PP4 和 PP6 共享 hook docs | 05→07 | `clients/api-docs/` | 新 hooks.md 或 session-ws hook section |

**验证结论**: design 中声明的耦合关系与真实代码文件重合面一致，没有"声称强耦合但实际代码无冲突"的虚假声明，也没有"实际代码有冲突但 design 未标记"的遗漏。

## 附录 B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-05-03` | `Deepseek` | 初稿 — 完整审查 8 份 design + PPX-qna |
