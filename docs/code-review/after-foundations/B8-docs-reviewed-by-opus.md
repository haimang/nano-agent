# Nano-Agent 代码审查 — B8 worker-matrix pre-convergence (handoff phase)

> 审查对象: `B8 deliverables` — GPT-5.4 产出的 handoff memo + naming proposal + 2 templates + 5 closure issues
> 审查时间: `2026-04-20`
> 审查人: `Claude Opus 4.7 (1M context)`
> 审查范围:
> - `docs/handoff/after-foundations-to-worker-matrix.md` (226 lines)
> - `docs/handoff/next-phase-worker-naming-proposal.md` (120 lines)
> - `docs/templates/wrangler-worker.toml` (73 lines)
> - `docs/templates/composition-factory.ts` (176 lines)
> - `docs/issue/after-foundations/B8-phase-1-closure.md` (157 lines)
> - `docs/issue/after-foundations/B8-phase-2-closure.md` (63 lines)
> - `docs/issue/after-foundations/B8-phase-3-closure.md` (62 lines)
> - `docs/issue/after-foundations/B8-final-closure.md` (75 lines)
> - `docs/issue/after-foundations/after-foundations-final-closure.md` (132 lines)
>
> 审查依据文档：
> - `docs/action-plan/after-foundations/B8-worker-matrix-pre-convergence.md` (B8 source action-plan)
> - `docs/design/after-foundations/P7-worker-matrix-pre-convergence.md` (P7 design)
> - `docs/plan-after-foundations.md` §4.1 H / §6 / §7.8 / §12 (charter requirements)
> - `docs/eval/after-foundations/smind-contexter-learnings.md` §9 (NACP 双轴 vs CICP 辩证) + §10 (Contexter-Nano-agent 分层架构) — **GPT 起稿 B8 时尚未完成**
>
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：**B8 的"doc-only handoff"定位完成质量 solid，符合 P7 设计 + B8 action-plan 的 scope；但因 GPT 不知道我们在此期间刚完成的 §9/§10 分析，handoff pack 有三个重大认知缺口必须补齐——否则 worker matrix 会带着已知可避免的 tech debt 起步。**
- **结论等级**：`changes-requested`（不重做，补 3 处认知缺口 + 微调 4 处字面）
- **本轮最关键的 3 个判断**：
  1. **认知完整性缺口**：B8 handoff pack 完全没有提到 nacp-1.3 的双轴矩阵冻结窗口、tenant wrapper "shipped 但未接线" 的 6 项占位清单、也没有提到 Contexter-as-upstream 的分层架构——这三项都是我们已经达成共识的 worker-matrix 前置认知，**不补齐等于让 worker matrix 走弯路**
  2. **技术细节准确度 OK**：9 个 shipped packages 版本号、15 finding state transition、LIVE 数字、模板 import symbols 都正确——handoff pack 的事实层面**可信**
  3. **B8 本身的 doc-only 纪律守住**：零 packages/、零 spikes/ 修改；root tests 77/77 + cross 91/91 baseline 对齐——这个纪律表现**优秀**

---

## 1. 审查方法与已核实事实

### 1.1 对照文档

- **Governing docs**:
  - `docs/action-plan/after-foundations/B8-worker-matrix-pre-convergence.md`（B8 source action-plan）
  - `docs/design/after-foundations/P7-worker-matrix-pre-convergence.md`（P7 design — B8 deliverable shape 的最终权威）
- **Knowledge delta NOT consumed by B8**:
  - `docs/eval/after-foundations/smind-contexter-learnings.md` §9 (nacp-1.3 contract surface freeze window)
  - `docs/eval/after-foundations/smind-contexter-learnings.md` §10 (Contexter orchestrator → Nano-agent runtime 分层架构重写)
  - 这两章是 **B8 起稿之后、提交之前** 产出的；GPT-5.4 没有 access

### 1.2 核查实现

- 逐行读 9 份 B8 deliverables（上述 `审查范围`）
- 交叉核验关键 shipped-package exports：
  - `DurableObjectStorageBinding` / `DOStorageAdapter` ✅ 存在于 `storage-topology/src/index.ts:79-81`
  - `AsyncCompactOrchestrator` / `InspectorFacade` / `DEFAULT_COMPACT_POLICY` ✅ 存在于 `context-management/src/index.ts:19,40,61`
  - `AsyncCompactOrchestratorConfig` 的 `doStorage` 是 **required**（不是 optional），GPT 模板用 `doStorage &&` gate 处理正确
  - `ServiceBindingTarget` / `ServiceBindingTransport` ✅ `nacp-core/src/index.ts:123,134`
  - `hookBroadcastToStreamEvent` / `toolResultToStreamEvent` ✅ `nacp-session/src/index.ts:75-76`
  - `HookDispatcher` / `HookRegistry` ✅ `hooks/src/index.ts:40,51`
  - `readCompositionProfile` / `SessionRuntimeEnv` / `BoundedEvalSink` ✅ `session-do-runtime/src/index.ts:14-45`
- 执行过的验证（由 B8 本身执行，我在 review 时只做**文档引用真实性**复核）：
  - `node --test test/*.test.mjs` → 77/77 (B8-phase-1-closure §6 报告)
  - `npm run test:cross` → 91/91 (同上)
  - `tsc -p <throwaway tsconfig>` → pass (B8-phase-3-closure §2)
  - `git --no-pager diff -- packages spikes` → empty (B8-phase-3-closure §2)

### 1.3 已确认的正面事实

- **Scope 纪律**：B8 零 packages/ / 零 spikes/ 修改，符合 P7 §5.1 + B8 action-plan §0/§1.4 硬约束 ✅
- **Shipped package 版本核对准确**：9 个包的 `package.json` version + CHANGELOG head 记录真实，包括**诚实标注**的 `eval-observability` / `session-do-runtime` 两个包 "CHANGELOG head 超前于 package.json version" 的现状（B8-phase-1-closure §2 脚注）
- **Round-2 finding state transition 表完整**：15 行，每行 evidence path 可 `ls` 到真实 `.out/*.json`
- **LIVE 数字准确**：F08 `2,199,424 / 2,200,000 / 576` 和 unexpected-F01 `336/1310/2216/4383` (2026-04-20 final run) 与 B7 closure 数字一致
- **Template import 真实可跑**：GPT 模板用 throwaway tsconfig 做 tsc pass 验证，9 处 `@nano-agent/*` import symbol 我逐个核对都在 shipped 导出中
- **`agent.core ≠ binding slot`** 正确坚持（出现在 handoff memo §5 + naming proposal §5，两处反复强调）
- **两个 owner/platform gates 显式保留**：F03 cross-colo + F09 owner URL，不折中
- **naming proposal 开头 "This is a proposal, not a frozen decision"** 明示，符合 P7 §3.2 要求

### 1.4 已确认的负面事实

- **完全缺失 nacp-1.3 冻结窗口讨论**：handoff memo / naming proposal / templates / closure docs 均未提及 `delivery_kind` 是 CICP-equivalent msg_type 轴、`(message_type, delivery_kind)` 冗余、(namespace-rule) verb naming 需要在 worker matrix 前冻结
- **完全缺失"tenant wrappers shipped 但未接线"的事实**：B8 掌握 `B6-writeback-eval-sink-dedup.md` 等 writeback issues，但没有发现 `verifyTenantBoundary` / `tenantDoStorage*` 在 `packages/session-do-runtime/src/` 内**零调用**的状态；6 项 tenant 占位清单没有进入 §9 Open Issues
- **完全缺失"Contexter 作为 upstream orchestrator"的分层认知**：handoff memo / naming proposal 把 `agent.core` 的定位停留在 "host worker"，没有承认 **"nano-agent 应作为 upstream orchestrator 的下游 session-based runtime"**；`SessionStartBodySchema.initial_context` 这个已 ship 的 upstream memory 注入口没有被识别为关键 handoff surface
- **Q5 问题沉默**：P7 设计 §3.1.1 规定 handoff memo §10 应给出具体 "recommended first phase of worker matrix"；GPT 的 §10 给了，但没有回应 B8 action-plan §6.1 提出的 Q1-Q4，也没有产生新的 Q 给 owner
- **Review 继承状态不完整**：§9.3 列了 B5-B6 / B7 两轮 review 被吸收；但没有承认 "B8 本身还未被 review" —— 本文档就是第一个 B8 review，GPT 在产出时把 "B5-B6/B7 review 皆 closed" 写成 `no review-shaped shipped-package blocker carried into worker-matrix kickoff`，这个判断**在 B8 review 未完成前下得太早**

---

## 2. 审查发现

### R1. 完全缺失 nacp-1.3 冻结窗口讨论

- **严重级别**：`high`
- **类型**：`scope-drift`（相对于 `smind-contexter-learnings.md` §9 刚刚达成的认知）
- **事实依据**：
  - `docs/handoff/after-foundations-to-worker-matrix.md` 搜索关键词 `nacp-1.3 / delivery_kind / message_type matrix` 全部无匹配
  - `docs/issue/after-foundations/B8-final-closure.md` §3 "Open issues carried over" 表没有列 nacp 协议层 tech debt
  - `smind-contexter-learnings.md` §9.1 明确：NACP 的 `delivery_kind` **已经是 CICP-equivalent msg_type 轴**（shipped 1.1.0）；§9.2 诊断方向冗余 + 合法组合矩阵缺失
  - `smind-contexter-learnings.md` §9.7 修订版明确："nacp-1.3 应在 worker matrix 开工前冻结，推迟会让 4 个 first-wave workers 带着 tech debt 起步"
- **为什么重要**：
  - B8 handoff 是 worker matrix charter 的**唯一入口**；worker matrix 作者只读 handoff pack 就开工是 B8 action-plan §8.3 的完成定义
  - 如果 handoff 没有列出 nacp-1.3 冻结 = worker matrix 会默认**沿用 v1.1 message_type 后缀命名**（`tool.call.request / .response / .result`），后期改造成本数量级放大
  - 这是我们在 `smind-contexter-learnings.md` §9 已经分析清楚的**可避免 tech debt**
- **审查判断**：必须在 B8 handoff pack 补齐，否则 worker matrix 从错误认知起步
- **建议修法**：
  - **handoff memo 新增 §11** "NACP 1.3 Pre-Requisite for Worker Matrix"：引用 `smind-contexter-learnings.md` §9.7，列出 4 项冻结范围（C/D/E/F-new）
  - **handoff memo §9 Open Issues 新增子节 9.4** "Known contract-surface tech debt to freeze before worker matrix starts"
  - **after-foundations-final-closure.md §6 Readiness statement** 在 "4 个约束" 后追加第 5 条 "worker matrix charter 必须等待 B9 nacp-1.3 contract freeze 先完成"

### R2. 完全缺失"tenant wrappers shipped 但未接线"的 6 项占位清单

- **严重级别**：`high`
- **类型**：`delivery-gap`（相对于 B6 shipped library 的消费率）
- **事实依据**：
  - `packages/nacp-core/src/index.ts:101` 导出 `verifyTenantBoundary`
  - `packages/nacp-core/src/index.ts:104` 导出 `tenantDoStorageGet / tenantDoStoragePut / tenantDoStorageDelete`
  - `grep -rn "verifyTenantBoundary\|tenantDoStorage" packages/session-do-runtime/src/` → **零匹配**（我在 B8 review 过程中亲自跑的）
  - `packages/session-do-runtime/src/do/nano-session-do.ts` 9 处直接读 `env.TEAM_UUID` 作为 trust token；`state.storage.put/get/delete` 全部走 raw DO storage 而非 `tenantDoStorage*`
  - `smind-contexter-learnings.md` §10.1.2 + §10.8 详细列出 contexter-stamp / nano-agent-verify 两侧责任切分的 6 项占位清单
  - B6 writeback issue `docs/issue/after-foundations/B6-writeback-eval-sink-dedup.md` 存在但没有 tenant-plumbing 对应的 writeback issue
- **为什么重要**：
  - B6 投资（5-rule verifier + 8-attack scenario coverage + HMAC delegation + tenant scoped R2/KV/DO wrappers）**没有变现**
  - worker matrix 在 `agent.core` 上接线时如果不知道这个缺口，会沿用"读 env.TEAM_UUID 作 trust token"的当前 pattern，等于**继承了一个已知的 security posture 降级**
  - `smind-contexter-learnings.md` §10.2.3 明确给了 6 项必做 + 6 项可延后的占位清单；不让 worker matrix 看到这张清单 = 让它从零重新决策
- **审查判断**：必须在 B8 handoff pack 补齐；这不是"变更 B2-B6 的 ship 代码"（那仍然 out of scope），而是**记录一个 shipped library 的消费缺口**
- **建议修法**：
  - **handoff memo §4 Hard Contract Requirements 扩展第 7 条** "tenant boundary verification must be enabled on agent.core ingress"，引用 `smind-contexter-learnings.md` §10.8 的 stamping / verify 责任表
  - **handoff memo 新增 §12** "Tenant Boundary Plumbing Checklist"：6 项必做 + 6 项可延后
  - **after-foundations-final-closure.md §3 "Final finding state"** 新增一行 "tenant-wrapper-plumbing: shipped-but-unused"（不作为 finding but 作为 handoff-time inventory）

### R3. 完全缺失 Contexter-as-upstream / nano-agent-as-runtime 的分层架构认知

- **严重级别**：`high`
- **类型**：`scope-drift`（相对于 `smind-contexter-learnings.md` §10 的架构澄清）
- **事实依据**：
  - `docs/handoff/after-foundations-to-worker-matrix.md` §5 把 `agent.core` 定位为 "host worker"，但没提它所在的**层级**——没有说它是 "upstream orchestrator 的下游 agent runtime"
  - `docs/handoff/next-phase-worker-naming-proposal.md` §5 强调 `agent.core ≠ binding slot`，但同样没有解释 "nano-agent 上游是谁"
  - `packages/nacp-session/src/messages.ts:19` 已 ship `initial_context: z.record(z.string(), z.unknown()).optional()` — 这是 **B5-B7 做协议时预留的 upstream memory 注入口**，但 B8 deliverables 里**零次**提到这个 wire hook
  - `smind-contexter-learnings.md` §10.5 画了完整分层架构图；§10.6 把 `initial_context` 定位为 "upstream → downstream session memory 注入的天然载体"
- **为什么重要**：
  - **nano-agent 本质是 agent runtime，天然处于某个上游 orchestrator 的下游**（§10.14 的 5 点 owner 最终立场）；这个认知决定 worker matrix 怎么设计 `agent.core` 的**入参**
  - 如果 handoff 不点明，worker matrix 会把 `agent.core` 当成"client 直连的入口"来设计——导致**重新发明 upstream orchestrator 应有的能力**（intent routing、user memory、conversation history），而 contexter 类系统已经示范了这些能力应该在上游做
  - `initial_context` wire hook 已经存在，不利用就是协议 dead field；识别出来就是**零协议修改的分层落地**
- **审查判断**：必须写进 handoff memo；这不是"改 nacp-session wire"（那是 B9 的事），而是**告诉 worker matrix 作者已经 ship 的 wire 有哪些下游 consumer 应当激活的 hook**
- **建议修法**：
  - **handoff memo 新增 §13** "Upstream Orchestrator Interface (and nano-agent as runtime)"：
    - 画 §10.5 的分层图
    - 解释 `SessionStartBodySchema.initial_context` 是 upstream memory 注入口
    - 明确 nano-agent 的职责边界（per-session + runtime + session-scoped）不承担 upstream 职责（user memory / intent routing / cross-conversation state）
  - **naming proposal §5** 补一段："`agent.core` 的上游 = 某个 orchestrator（contexter-类系统或其他）；B8 不冻结上游 worker 名字，但**要求 worker matrix 的 agent.core 设计支持 `session.start.body.initial_context` 消费**"
  - **after-foundations-final-closure.md §6 Readiness statement** 在 "4 个约束" 里补充第 6 条 "worker matrix 的 agent.core 必须设计为 'orchestrator-ready runtime'，即支持 upstream 注入 initial_context"

### R4. B8 review 未完成前过早声明 "no review-shaped blocker carried into worker-matrix kickoff"

- **严重级别**：`medium`
- **类型**：`delivery-gap`（过早 close out）
- **事实依据**：
  - `docs/handoff/after-foundations-to-worker-matrix.md` §9.3 "Review carry-over posture" 第三段："**no review-shaped shipped-package blocker is carried into worker-matrix kickoff beyond the two owner/platform gates**"
  - `docs/issue/after-foundations/B8-final-closure.md` §3 "Open issues carried over" 表把 "B5-B6 review findings" 和 "B7 review concerns" 都标 `no blocker carried`
  - **但 B8 本身的 review（即本文档）尚未开始**；GPT 提交 B8 时这轮 review 不存在
- **为什么重要**：
  - 如果 B8 review 发现了 blocker-level 问题（本文档 R1/R2/R3 就是），那么 "no review-shaped blocker" 的声明本身**是过早的**
  - 这不是 GPT 的错（他不可能预见到 B8 会被 review 并发现 blocker），但**需要在 B8 review 收口时更新 posture**
- **审查判断**：B8 final closure 的 posture 应该在 B8 review 收口之后**追加**，不是事前宣称
- **建议修法**：
  - `B8-final-closure.md` §3 补一行 "B8 review (Opus 2026-04-20)" 的结论（待本文档 §5 的 final verdict 确定后回填）
  - `handoff memo §9.3` 也做相同追加

### R5. 微调：`AsyncCompactOrchestrator` 模板里 `r2: r2` 的使用场景注释不足

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `packages/context-management/src/async-compact/index.ts:131` `r2?: R2Adapter` 注释说 "B2 substrate; optional R2 backing for summaries / snapshots > DO cap (per F08)"
  - `docs/templates/composition-factory.ts:135-144` 把 `r2` 直接传入 `AsyncCompactOrchestrator`，但注释只说 "Keep the shipped package default visible"
  - 没有告诉读者：**`r2` 存在时 compact summary 超过 DO cap 会 spill 到 R2；不存在时 summary 超过 cap 会失败**
- **为什么重要**：worker matrix 作者读模板会照抄；不知道这个 R2 spill 语义会导致 compact 路径在 2 MiB 边界上表现不可预期
- **审查判断**：模板注释补一段 F08 语义 link 即可；非 blocker
- **建议修法**：
  - `composition-factory.ts:135` `const compact =` 上方注释追加一行：
    ```ts
    // When r2 is wired, the orchestrator spills oversize summaries to R2 per F08.
    // Without r2, summaries > DOStorageAdapter.maxValueBytes fail. Worker matrix
    // must make this fallback decision explicit per worker profile.
    ```

### R6. 微调：`wrangler-worker.toml` 的 `services` 列表硬写了三个 first-wave workers，但未标注"按 Q1 owner 决策可变"

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/templates/wrangler-worker.toml:54-64` 硬列了 `BASH_CORE / FILESYSTEM_CORE / CONTEXT_CORE`
  - 这三个名字来自 proposal，不是 B8 冻结
  - 模板上方 comment 没说"若 worker matrix 调整命名，下面三个 binding name 也要跟着改"
- **为什么重要**：worker matrix 作者如果直接 copy 模板，会把这三个名字当 ground truth；但 naming proposal 明明是 non-binding
- **审查判断**：加一行 comment 即可
- **建议修法**：在 `[[services]]` 上方加一行 comment：
  ```toml
  # The three service bindings below reflect the B8 naming proposal (not a freeze).
  # If worker matrix phase renames these, update both the `binding` and `service` fields
  # consistently, and reflect the change back in `next-phase-worker-naming-proposal.md`.
  ```

### R7. 微调：Q1-Q4 from B8 action-plan §6.1 未被 handoff 回应

- **严重级别**：`low` / `docs-gap`
- **事实依据**：
  - `docs/action-plan/after-foundations/B8-worker-matrix-pre-convergence.md` §6.1 原本有 Q1-Q4（handoff 拟议内容 / agent.core 是否对外也 expose binding / maxValueBytes calibration 时机 / after-foundations-final-closure 是否 kickoff gate / owner-side rerun checklist 是否进 §9）
  - 8 deliverables 内无一处明确引用这 Q1-Q4；Q2（maxValueBytes）虽在 composition-factory 注释里接触（保持 1 MiB 默认），但没有把 "Q2 答 = 推到 worker matrix phase" 写清楚
- **为什么重要**：P7 设计 §3.1 要求 handoff memo §9 承接 "open issues at handoff"——Q1-Q4 没答 = 看不出 GPT 的 handoff 对这些问题的隐含 answer
- **审查判断**：显式在 handoff memo §9 补一段 "B8 action-plan §6.1 Q1-Q4 的 B8 disposition" 表即可

---

## 3. In-Scope 逐项对齐审核

对照 B8 action-plan §2.1 的 8 条 in-scope 项：

| 编号 | 计划项 | 审查结论 | 说明 |
|---|---|---|---|
| S1 | Truth Inventory: B1-B7 全部 closure + finding verdict + LIVE 数字 + package version | `done` | `B8-phase-1-closure.md` 6 个 section 齐全，inventory 质量高 |
| S2 | `docs/handoff/after-foundations-to-worker-matrix.md` 按 P7 §3.1 10 章节结构 | `partial` | 10 章节齐全 ✅；但缺 R1/R2/R3 三项认知（需补章节 §11/§12/§13） |
| S3 | `docs/handoff/next-phase-worker-naming-proposal.md` 按 P7 §3.2 4+1 结构 | `done` | 结构完整；non-binding 声明明确；`agent.core ≠ binding slot` 正确坚持 |
| S4 | `docs/templates/wrangler-worker.toml` with B7 LIVE evidence comments | `done` | 模板 comment 带 binding-F01 / F02 / F08 / unexpected-F01 四项证据；仅 R6 小微调 |
| S5 | `docs/templates/composition-factory.ts` import 只用 B2-B6 shipped | `done` | 9 处 import 真实 + tsc pass；仅 R5 小微调 |
| S6 | B8 phase-1/2/3 closure + B8-final-closure | `done` | 4 份 closure 齐全 |
| S7 | `docs/issue/after-foundations/after-foundations-final-closure.md` 单页 | `done` | 132 行一页收口；覆盖 phase/artifact/finding/LIVE deploy/readiness 五类 |
| S8 | handoff memo §9 列 F03/F09 open gates | `done` | §9.1 正确列出；§9.2 owner-side rerun checklist 也有 |

### 3.1 对齐结论

- **done**: 7
- **partial**: 1 (S2 handoff memo — 需补 R1/R2/R3 章节)
- **missing**: 0

> 这更像"handoff pack 主体完成，但缺失最近 48 小时对 smind-contexter 分析产生的 3 条 critical 认知"的状态。纯粹按 B8 action-plan § 范围对齐，它 **100% 覆盖**；但按 `smind-contexter-learnings.md` §9/§10 产生的新认知衡量，它**必须补齐三章**，否则 worker matrix 的 charter 作者从错误起点开始。

---

## 4. Out-of-Scope 核查

对照 B8 action-plan §2.2 的 9 条 out-of-scope：

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|---|---|---|---|
| O1 | 不改 `packages/` 任何文件 | `遵守` | `git diff -- packages` empty（B8-phase-3 §2 报告 + 我核对） |
| O2 | 不改 `spikes/` 任何 probe 代码 | `遵守` | `git diff -- spikes` empty |
| O3 | 不新增 / 不升 `@nano-agent/*` 包版本 | `遵守` | 9 个包 version 不变；CHANGELOG 不改 |
| O4 | worker matrix 阶段的实际 worker shell 实现 | `遵守` | handoff pack 只有 proposal + template，无实装 |
| O5 | binding catalog v2 接口签名 | `遵守` | §6 明确 "do not rewrite catalog; keep reserved posture" |
| O6 | skill.core 拆分决策 | `遵守` | naming proposal §4 标 `reserved only`，不消费首 phase budget |
| O7 | RBAC / OAuth / billing / tenant ops / cross-region | `遵守` | 整个 handoff pack 没有触及这些 |
| O8 | 为打开 F03/F09 gate 而编写的新 probe | `遵守` | §9.2 只列 owner-side checklist，不实装 |
| O9 | `DOStorageAdapter.maxValueBytes = 2 MiB` calibration | `遵守` | composition-factory §注释明确 "B8 not silently bake in" |

**Out-of-scope 遵守度 = 9/9 ✅**

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`（需实现者完成 R1/R2/R3 补齐后再 close）
- **关闭前必须完成的 blocker**：
  1. **R1** — handoff memo 新增 §11 "NACP 1.3 Pre-Requisite for Worker Matrix"（引用 `smind-contexter-learnings.md` §9.7）；handoff memo §9 新增 9.4 "Known contract-surface tech debt"
  2. **R2** — handoff memo §4 追加第 7 条 "tenant boundary verification on agent.core ingress"；handoff memo 新增 §12 "Tenant Boundary Plumbing Checklist"（引用 `smind-contexter-learnings.md` §10.2.3 + §10.8）
  3. **R3** — handoff memo 新增 §13 "Upstream Orchestrator Interface"（引用 `smind-contexter-learnings.md` §10.5 分层架构图 + §10.6 `initial_context` wire hook）；naming proposal §5 补上游 orchestrator 认知；after-foundations-final-closure.md §6 Readiness 追加第 5/6 条约束
- **可以后续跟进的 non-blocking follow-up**：
  1. **R4** — B8-final-closure.md §3 + handoff memo §9.3 的 "review posture" 追加本 review 的结论（在 R1/R2/R3 close 后同步）
  2. **R5** — composition-factory.ts 的 `AsyncCompactOrchestrator` r2 spill 语义注释（3 行）
  3. **R6** — wrangler-worker.toml 的 `[[services]]` 上方加 non-binding 提醒 comment（4 行）
  4. **R7** — handoff memo §9 补 B8 action-plan Q1-Q4 的 disposition 简表

### 5.1 对 worker matrix 启动的影响

**不允许 worker matrix 在本 review 补齐前启动 Phase 0**。理由：
- B8 的完成定义 (`B8 action-plan §8.3 DoD`) 是"worker matrix charter 作者**只读 handoff pack** 即可开工"
- R1/R2/R3 所缺的 3 项认知在 `smind-contexter-learnings.md` §9/§10 中已经辩证成熟
- 不补齐 = worker matrix charter 作者需要**额外读 smind-contexter-learnings.md 全文**才能获得完整认知——这违反 B8 的 "single entry" 承诺

### 5.2 与 B9 (proposed) 的关系

本 review 同时建议立项 **`B9-nacp-1-3-contract-freeze.md`** action-plan（见 `smind-contexter-learnings.md` §9.7.4 规划）：
- B9 = packages 层实装 nacp-1.3（C/D/E/F-new）+ tenant wrapper 接线 + `initial_context` schema 规范化
- B9 close 后 worker matrix Phase 0 才能启动
- **R1 补齐的 §11 "NACP 1.3 Pre-Requisite"** 应明确 link 到 B9 action-plan

> **本轮 review 不收口，等待实现者按 §6 响应并再次更新 handoff pack。**

---

## 6. 实现者回应模板

> **规则**：
> 1. 不要改写 §0–§5；只允许从这里往下 append
> 2. 回应时按 `R1/R2/R3/R4/R5/R6/R7` 对应，不要模糊说 "已修一些问题"
> 3. 必须写明 "哪些修了、怎么修的、改了哪些文件、跑了什么验证"
> 4. 若选择不修某条 finding，必须写明理由与 tradeoff

### 6.1 对本轮审查的回应

> 执行者: `GPT-5.4`
> 执行时间: `2026-04-21`
> 回应范围: `R1–R7`

- **总体回应**：`接受本轮审查结论；R1–R7 全部按代码事实与 smind §9/§10 新认知回填到了 B8 handoff pack。`
- **本轮修改策略**：`不改 §0–§5，不碰 packages/ 与 spikes/；直接补 handoff memo 的 3 个缺失章节，补 naming/template/closure 的连带口径，再用现有校验命令把文档、模板与根测试重新跑一遍。`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | nacp-1.3 pre-requisite 缺失 | `fixed` | handoff memo 新增 `§11 NACP 1.3 Pre-Requisite for Worker Matrix`，并在 `§9.4` 显式列出 contract-surface tech debt；同时把 after-foundations final closure 的 readiness 约束补到“charter 可启动，但 Phase 0 等待 proposed B9”。 | `docs/handoff/after-foundations-to-worker-matrix.md`, `docs/issue/after-foundations/after-foundations-final-closure.md`, `docs/issue/after-foundations/B8-final-closure.md` |
| R2 | tenant plumbing checklist 缺失 | `fixed` | handoff memo `§4` 增加第 7 条 hard requirement，并新增 `§12 Tenant Boundary Plumbing Checklist`，把 `verifyTenantBoundary` / `tenantDoStorage*` 已 ship 但未接线的现实写成 first-wave host 约束。 | `docs/handoff/after-foundations-to-worker-matrix.md`, `docs/issue/after-foundations/after-foundations-final-closure.md`, `docs/issue/after-foundations/B8-final-closure.md` |
| R3 | upstream orchestrator interface 缺失 | `fixed` | handoff memo 新增 `§13 Upstream Orchestrator Interface`，把 Contexter-like upstream → nano-agent runtime 的分层写清；naming proposal `§5.1` 追加上游认知；after-foundations readiness 增加 `initial_context` 约束。 | `docs/handoff/after-foundations-to-worker-matrix.md`, `docs/handoff/next-phase-worker-naming-proposal.md`, `docs/issue/after-foundations/after-foundations-final-closure.md`, `docs/issue/after-foundations/B8-final-closure.md` |
| R4 | B8 review posture 过早声明 | `fixed` | handoff memo `§9.3` 与 `B8-final-closure.md §3` 明确补入 “B8 docs review 已被当前 handoff pack 吸收”；不再把 B8 review 事前当成已不存在。 | `docs/handoff/after-foundations-to-worker-matrix.md`, `docs/issue/after-foundations/B8-final-closure.md`, `docs/issue/after-foundations/after-foundations-final-closure.md` |
| R5 | AsyncCompactOrchestrator r2 spill 注释 | `fixed` | 在 `composition-factory.ts` `const compact =` 上方补了 R2 spill / no-R2 fail 的边界注释。 | `docs/templates/composition-factory.ts` |
| R6 | wrangler services non-binding 提醒 | `fixed` | 在 `wrangler-worker.toml` 的 `[[services]]` 前补了 “proposal，不是 freeze；如改名需同步 binding+service 与 naming proposal” 注释。 | `docs/templates/wrangler-worker.toml` |
| R7 | Q1-Q4 disposition | `fixed` | handoff memo 新增 `§9.5 B8 action-plan §6.1 Q1–Q4 disposition` 表，把 4 个问题的实际 B8 答案显式写出来。 | `docs/handoff/after-foundations-to-worker-matrix.md` |

### 6.3 变更文件清单

- `docs/handoff/after-foundations-to-worker-matrix.md`
- `docs/handoff/next-phase-worker-naming-proposal.md`
- `docs/templates/wrangler-worker.toml`
- `docs/templates/composition-factory.ts`
- `docs/issue/after-foundations/B8-phase-2-closure.md`
- `docs/issue/after-foundations/B8-final-closure.md`
- `docs/issue/after-foundations/after-foundations-final-closure.md`
- `docs/action-plan/after-foundations/B8-worker-matrix-pre-convergence.md`
- `docs/code-review/after-foundations/B8-docs-reviewed-by-opus.md`

### 6.4 验证结果

```text
1. 结构/占位校验
   - `grep '^## §' docs/handoff/after-foundations-to-worker-matrix.md | wc -l` -> 13
      (其中 `§1–§10` 保留为 P7 必选结构，`§11–§13` 为本轮 review addenda)
   - `grep -ciE 'proposal|not a frozen|not binding' docs/handoff/next-phase-worker-naming-proposal.md` -> 6
   - placeholder grep on the changed handoff/template files -> empty

2. 模板/边界校验
   - `node_modules/.pnpm/node_modules/.bin/tsc -p /root/.copilot/session-state/592cb120-8b05-4ffb-8229-199bb74fd46a/files/b8-template-tsconfig.json` -> pass
   - `git --no-pager diff -- packages spikes` -> empty

3. 根测试回归
   - `node --test test/*.test.mjs` -> 77/77
   - `npm run test:cross` -> 91/91
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. 本轮只修 B8 handoff pack，不创建新的 `B9-nacp-1-3-contract-freeze.md` action-plan 文件；文档中仅将其明确为 **proposed pre-phase-0 work**。
  2. tenant boundary / `initial_context` / nacp-1.3 仍然是 **文档层显式前置条件**，不是 B8 阶段去改 packages 的代码项。

### 6.6 完整工作日志

1. 先读取并核对了 `docs/code-review/after-foundations/B8-docs-reviewed-by-opus.md` 全文，确认 Opus 的 7 条审查点中，R1–R4 是真实的 handoff 认知缺口，R5–R7 是真实但非 blocker 的文档微调。
2. 再对照 `docs/eval/after-foundations/smind-contexter-learnings.md` 的 `§9.7`、`§10.5`、`§10.6`、`§10.8`，确认：
   - `nacp-1.3` 冻结窗口确实应作为 worker-matrix Phase 0 的硬前置认知；
   - `verifyTenantBoundary` / `tenantDoStorage*` 已 ship，但 `packages/session-do-runtime/src/` 当前零调用；
   - `SessionStartBodySchema.initial_context` 已 ship，确实是 upstream memory / intent 注入的天然 wire hook。
3. 基于这些事实，重写了 handoff memo：
   - `§4` 增加 tenant boundary hard requirement；
   - `§9.3` 修正 B8 review posture；
   - 新增 `§9.4`、`§9.5`；
   - 新增 `§11` `§12` `§13` 三个 review-driven addenda。
4. 同步修了 naming proposal、wrangler 模板、composition template，使其与新的 handoff posture 保持一致：
   - naming proposal 明确 `agent.core` 有 upstream orchestrator；
   - wrangler 模板标注 `services` 名称依旧是 proposal；
   - composition template 注明 `AsyncCompactOrchestrator` 的 R2 spill 语义。
5. 再把 closure 文档追平：
   - `B8-phase-2-closure.md` 更新为 “10 个必选章节 + 3 个 post-review addenda”；
   - `B8-final-closure.md` 增加 B9 / tenant plumbing / `initial_context` / B8 review posture；
   - `after-foundations-final-closure.md` 增加 B8 docs review 行、tenant-wrapper-plumbing inventory，以及“charter 可启动但 Phase 0 等 B9”的 readiness 口径。
6. 最后把本 review 文档底部模板替换成真实回应，并按相同口径重新运行了：
   - handoff/doc 结构检查；
   - throwaway `tsconfig` typecheck；
   - `git diff -- packages spikes`；
   - 根测试 `77/77` 与 `91/91`。

---

## §6 Close-out — 2026-04-21 (via B9 shipped artifacts)

The B9 rewrite (driven by `docs/code-review/after-foundations/B9-plan-reviewed-by-GPT.md`) directly landed code + docs that close this review's outstanding items. Opus's original R1/R2/R3 are now marked `fixed via B9 shipped`; R4-R7 were resolved via inline doc diff in the same pass.

- **R1** (NACP 1.3 pre-requisite posture in handoff memo) — `fixed via B9 shipped §11`. `docs/handoff/after-foundations-to-worker-matrix.md` now has a dedicated §11 "NACP 1.3 Pre-Requisite for Worker Matrix" that cites `docs/rfc/nacp-core-1-3-draft.md` and B9 final closure.
- **R2** (tenant plumbing checklist) — `fixed via B9 shipped §12`. B8 memo §12 now lists the 6 materialized use-sites (DO checkpoint write/read, LAST_SEEN_SEQ write, WS helper replay, ingress boundary verify) plus the enforcement hook (`test/tenant-plumbing-contract.test.mjs` white-list).
- **R3** (upstream orchestrator interface clarity) — `fixed via B9 shipped §13`. B8 memo §13 now documents the wire shape (`SessionStartInitialContextSchema`), producer (non-normative — Contexter), and consumer (worker-matrix `agent.core`), with the explicit "B9 preserves the field; B9 does not dispatch" clause.
- **R4-R7** — `fixed via inline doc diff` during the B8 review response cycle and reaffirmed via B9 documentation synchronization (README, registry doc, CHANGELOG, action-plan §0.5 GPT-review tracker).

**Net verdict**: all 7 review items now have shipped artifacts. Worker matrix Phase 0 is unblocked.

Reference: `docs/issue/after-foundations/B9-final-closure.md`, `docs/action-plan/after-foundations/B9-nacp-1-3-contract-freeze.md` §12.
