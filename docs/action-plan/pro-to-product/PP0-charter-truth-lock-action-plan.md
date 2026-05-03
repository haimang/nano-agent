# Nano-Agent 行动计划

> 服务业务簇: `pro-to-product / PP0 — Charter & Truth Lock`
> 计划对象: `冻结 pro-to-product 起点、truth gates、frontend contract 边界，并建立首个 truth-gate e2e skeleton`
> 类型: `new`
> 作者: `GPT-5.5`
> 时间: `2026-05-03`
> 文件位置: `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md`
> 上游前序 / closure:
> - `docs/charter/plan-pro-to-product.md` §6.1-§7.1（PP0 phase 定义与交付物）
> 下游交接:
> - `docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md`
> - `docs/issue/pro-to-product/PP0-closure.md`
> - `docs/issue/pro-to-product/pro-to-product-final-closure.md`
> 关联设计 / 调研文档:
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`（本计划锁定并校验的 cross-cutting design）
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`（本计划锁定并校验的 frontend contract design）
> - `docs/design/pro-to-product/PPX-qna.md` Q1-Q5
> - `clients/api-docs/README.md`
> - `clients/api-docs/session-ws-v1.md`
> 冻结决策来源:
> - `docs/design/pro-to-product/PPX-qna.md` Q1（7 truth gates 是唯一 hard exit）
> - `docs/design/pro-to-product/PPX-qna.md` Q2（latency baseline 是 alert threshold）
> - `docs/design/pro-to-product/PPX-qna.md` Q3（frontend 只依赖 orchestrator-core facade）
> - `docs/design/pro-to-product/PPX-qna.md` Q4（per-phase design 采用 JIT freeze）
> - `docs/design/pro-to-product/PPX-qna.md` Q5（PP6 只扫 frontend-facing public surfaces）
> 文档状态: `draft`

---

## 0. 执行背景与目标

PP0 是 pro-to-product 的入口闸，不是继续扩大文档治理的阶段。它的目标是把 `plan-pro-to-product.md`、`00-agent-loop-truth-model.md`、`01-frontend-trust-contract.md` 与 owner 已回答的 `PPX-qna.md` 统一成一个可执行基线：后续 PP1-PP6 只消费这些 frozen truth，不再重新讨论阶段目标、frontend boundary 或 closure law。

本计划必须同时避免两种错误：一是只写 charter/design 而没有任何真实 e2e skeleton；二是在 PP0 提前抢做 PP1-PP6 的主线实现。参考 agent 的共同启发是：Gemini 把 loop 表达成可消费事件（`context/gemini-cli/packages/core/src/core/turn.ts:52-71`），Codex 明确 client-agent SQ/EQ 边界与 submission trace（`context/codex/codex-rs/protocol/src/protocol.rs:1-5`, `106-116`），Claude Code 把 query loop 的跨 iteration state 显式收拢（`context/claude-code/query.ts:219-280`）。nano-agent 不照搬它们的 runtime，但必须在 PP0 建立等价的 evidence discipline。

- **服务业务簇**：`pro-to-product / PP0 — Charter & Truth Lock`
- **计划对象**：`truth gates + frontend contract boundary + e2e skeleton`
- **本次计划解决的问题**：
  - 后续 phase 可能各自定义 closure 口径，导致 7 truth gates 失去硬闸地位。
  - frontend-facing evidence shape 仍可能被 internal substrate evidence 代替。
  - 现有 root e2e harness 已存在，但还没有被 PP0 固化成 pro-to-product truth-gate skeleton。
- **本次计划的直接产出**：
  - `docs/issue/pro-to-product/PP0-closure.md`
  - 首个复用 `package.json` 中 `test:package-e2e` / `test:cross-e2e` / `test:e2e` 的 pro-to-product skeleton。
  - 一个 phase handoff checklist，供 PP1-PP6 closure 对账 truth gate、latency alert 与 docs truth。
- **本计划不重新讨论的设计结论**：
  - 7 truth gates 是唯一 hard exit；phase 内 sub-gate 必须映射到 7 gates（来源：`PPX-qna.md` Q1）。
  - latency baseline 只作为 alert threshold，但 closure 必须登记超阈值事实（来源：`PPX-qna.md` Q2）。
  - public frontend contract 只以 `orchestrator-core` facade 为 owner（来源：`PPX-qna.md` Q3）。
  - design 允许 JIT freeze，但每个 phase 开工前必须有对应 frozen design（来源：`PPX-qna.md` Q4）。

---

## 1. 执行综述

### 1.1 总体执行方式

PP0 采用 **先冻结规则，再建立证据骨架，最后交接 PP1** 的方式执行。第一步只做 truth registry 与 frontend boundary 的落文对账；第二步把现有 Node e2e harness 接成最小 skeleton，不新增测试框架；第三步完成 FE-1 review 输出与 PP0 closure，确保 PP1 开始时不再需要重新解释“什么算完成”。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Truth Registry Freeze | `XS` | 固化 7 truth gates、latency alert、cannot-close law 与 frontend boundary | `-` |
| Phase 2 | E2E Skeleton Wiring | `S` | 复用现有 root e2e harness，建立至少一条 HTTP + WS + durable read-model 的 evidence skeleton | `Phase 1` |
| Phase 3 | FE-1 Handoff & Closure | `XS` | 形成 FE-1 最低确认清单、PP1 handoff 与 PP0 closure | `Phase 2` |

### 1.3 Phase 说明

1. **Phase 1 — Truth Registry Freeze**
   - **核心目标**：把 charter §10、design 00/01 与 PPX-qna Q1-Q5 统一为 PP1-PP6 的只读入口。
   - **为什么先做**：如果 hard exit、latency、frontend boundary 没先冻结，后续 action-plan 会各自发明验收法。
2. **Phase 2 — E2E Skeleton Wiring**
   - **核心目标**：以现有 `test:package-e2e` / `test:cross-e2e` 建立 pro-to-product evidence shape。
   - **为什么放在这里**：PP0 的价值在于把文档推理压回可测现实；没有 skeleton，PP0 只是治理文档。
3. **Phase 3 — FE-1 Handoff & Closure**
   - **核心目标**：输出 frontend state minimum、surface taxonomy 与 PP1 start gate 的确认记录。
   - **为什么放在最后**：只有 truth registry 与 skeleton 都存在，FE-1 才能评审真实边界而不是抽象愿景。

### 1.4 执行策略说明

- **执行顺序原则**：先冻结跨阶段不变量，再创建可复用验证骨架，最后写 closure 和 handoff。
- **风险控制原则**：PP0 不实现 `approval_policy=ask`、compact、replay、hook 或 policy enforcement；任何主线实现都转交 PP1-PP6。
- **测试推进原则**：只复用现有 root Node harness，不新增测试框架；skeleton 以可观测 evidence shape 为目标。
- **文档同步原则**：同步 `PP0-closure.md` 与必要的 handoff checklist，不新增 debt-matrix / review-matrix 类治理文档。
- **回滚 / 降级原则**：如果首个 skeleton 无法覆盖完整 HTTP+WS+durable 三件套，允许先标记 partial skeleton，但不得把它写成 PP0 full close。

### 1.5 本次 action-plan 影响结构图

```text
PP0 Charter & Truth Lock
├── Phase 1: Truth Registry Freeze
│   ├── docs/charter/plan-pro-to-product.md
│   ├── docs/design/pro-to-product/00-agent-loop-truth-model.md
│   └── docs/design/pro-to-product/01-frontend-trust-contract.md
├── Phase 2: E2E Skeleton Wiring
│   ├── test/package-e2e/**/*.test.mjs
│   ├── test/cross-e2e/**/*.test.mjs
│   └── package.json scripts: test:package-e2e / test:cross-e2e / test:e2e
└── Phase 3: FE-1 Handoff & Closure
    ├── docs/issue/pro-to-product/PP0-closure.md
    └── docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 固化 7 truth gates 的 phase-by-phase 对账方式，明确 phase sub-gate 只能映射到 7 gates。
- **[S2]** 固化 evidence shape：`transport`、`trace_uuid`、`start_ts`、`first_visible_ts`、`terminal_or_degraded_ts`、`verdict`；phase closure 统一追加 `latency_alert.threshold_key / exceeded_count / accepted_by_owner / repro_condition`。
- **[S3]** 建立首个 pro-to-product e2e skeleton，至少能同时断言一条 HTTP control path、一条 WS event path、一个 durable/read-model truth。
- **[S4]** 完成 FE-1 handoff：public surface taxonomy、frontend state minimum、PP1 start assumptions。
- **[S5]** 输出 `PP0-closure.md`，诚实登记 skeleton 覆盖范围、latency alert 与剩余 gap。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 不实现 HITL pause-resume、confirmation decision、elicitation timeout；这些属于 PP1。
- **[O2]** 不实现 compact prompt mutation 或 token preflight；这些属于 PP2。
- **[O3]** 不修 replay restore、lagged/degraded recovery 或 session state snapshot；这些属于 PP3。
- **[O4]** 不接 PreToolUse live caller、不扩 hook catalog；这些属于 PP4。
- **[O5]** 不更新 `clients/api-docs` 全包；PP0 只建立 handoff，PP6 才做 item-by-item sweep。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| 7 truth gates registry | `in-scope` | PP0 的入口职责就是冻结 shared hard exit | 只有 owner 通过 PPX-qna 修订 |
| e2e skeleton | `in-scope` | charter §7.1 明确 PP0 不能只有文档 | 如果已有 skeleton 已覆盖三件套，可转为归档/标注 |
| FE-1 frontend review | `in-scope` | `01` design 要求 FE-1 输出可引用确认清单 | 若 frontend lead 暂不可用，closure 必须标 pending owner-action |
| PP1 HITL 实现 | `out-of-scope` | PP0 只提供 start gate 与验证骨架 | PP1 action-plan 启动 |
| API docs 全量 sweep | `out-of-scope` | 会把 PP0 膨胀成 PP6 | PP6 action-plan 启动 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Truth gate 对账表 | `add` | `docs/issue/pro-to-product/PP0-closure.md` | 把 7 gates 与 PP1-PP6 映射成 closure checklist | `low` |
| P1-02 | Phase 1 | Frontend boundary freeze | `update` | `docs/issue/pro-to-product/PP0-closure.md`, `clients/api-docs/README.md` | 确认 facade-only 与 public/internal taxonomy | `low` |
| P2-01 | Phase 2 | E2E skeleton owner file 定位 | `add` | `test/package-e2e/**/*.test.mjs`, `test/cross-e2e/**/*.test.mjs` | 选择最小可扩展测试入口，不新增框架 | `medium` |
| P2-02 | Phase 2 | Evidence shape output | `add` | e2e helper / fixture | 每条 skeleton 输出统一 evidence shape | `medium` |
| P2-03 | Phase 2 | Latency alert recording | `add` | e2e helper / closure evidence | 记录但不硬拦截 latency baseline | `low` |
| P3-01 | Phase 3 | FE-1 handoff | `add` | `docs/issue/pro-to-product/PP0-closure.md` | 形成 frontend minimum state / surface gap list | `low` |
| P3-02 | Phase 3 | PP1 start gate | `add` | `docs/issue/pro-to-product/PP0-closure.md` | 明确 PP1 可安全接手的前置条件 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Truth Registry Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Truth gate 对账表 | 把 7 truth gates 写成 PP1-PP6 closure checklist，并同步定义 closure 级 `latency_alert` 字段：`threshold_key / exceeded_count / accepted_by_owner / repro_condition` | `PP0-closure.md` | closure reviewer 不再重新解释 hard exit | 文档一致性自检 | 每个 gate 有 phase owner、证据类型、cannot-close 触发条件 |
| P1-02 | Frontend boundary freeze | 确认 frontend 只消费 orchestrator facade、WS frames、runtime/read-model/docs，不消费 internal RPC | `PP0-closure.md`, `clients/api-docs/README.md` | PP6 sweep 范围不再漂移 | 与 `PPX-qna.md` Q3/Q5 对照 | public/internal taxonomy 与 `01` design 一致 |

### 4.2 Phase 2 — E2E Skeleton Wiring

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | E2E skeleton owner file 定位 | 冻结 `test/cross-e2e/16-pro-to-product-baseline-skeleton.test.mjs` 为 PP0 skeleton owner file，避免新建平行框架 | `package.json`, `test/cross-e2e/16-pro-to-product-baseline-skeleton.test.mjs` | skeleton 能被 root scripts 运行 | `pnpm test:cross-e2e` | 新 skeleton 被现有脚本覆盖 |
| P2-02 | Evidence shape output | 为 skeleton 添加统一 evidence object：transport、trace、timestamps、terminal/degraded verdict | e2e helper / fixture | 后续 PP1-PP6 可复用证据形态 | targeted node test | 输出字段齐全且可被 closure 引用 |
| P2-03 | Latency alert recording | 记录 `first_visible_ts` 与 `terminal_or_degraded_ts`，只登记超阈值，不作为测试硬失败 | e2e helper / closure evidence | latency 不被静默忽略，也不阻塞功能 truth | targeted node test | closure 能看到超阈值次数与范围 |

### 4.3 Phase 3 — FE-1 Handoff & Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | FE-1 handoff | 形成 frontend lead 可评审的 minimum state inputs、surface taxonomy、gap list | `PP0-closure.md` | FE-1 有可引用输出 | 文档 review | FE-1 结果能被 PP1/PP3/PP6 引用 |
| P3-02 | PP1 start gate | 写明 PP1 可以启动的最小条件：truth registry frozen、skeleton owner file 存在、HITL design frozen | `PP0-closure.md` | PP1 不再回头重做 PP0 | 与 PP1 action-plan 对照 | PP1 handoff 无 scope ambiguity |

---

## 5. Phase 详情

### 5.1 Phase 1 — Truth Registry Freeze

- **Phase 目标**：把 `PPX-qna.md` Q1-Q5、design 00/01 与 charter §10 统一成可执行 checklist。
- **本 Phase 对应编号**：`P1-01`, `P1-02`
- **本 Phase 新增文件**：
  - `docs/issue/pro-to-product/PP0-closure.md`
- **本 Phase 修改文件**：
  - 仅在发现现有 docs 与 frozen owner truth 冲突时，最小修正相关文档。
- **具体功能预期**：
  1. 每条 truth gate 都有 owner phase、证据类型和 cannot-close 条件。
  2. public/internal surface taxonomy 与 `orchestrator-core facade` owner law 一致。
- **具体测试安排**：
  - **单测**：无新增单测。
  - **集成测试**：无。
  - **回归测试**：`pnpm run check:docs-consistency`（若 PP0 修改 docs pack 或 docs consistency 相关文件）。
  - **手动验证**：逐条对照 `PPX-qna.md` Q1-Q5。
- **收口标准**：
  - 7 truth gates 均可被 PP1-PP6 action-plan 引用。
  - `latency baseline != hard gate` 的登记纪律明确。
- **本 Phase 风险提醒**：
  - 不要把 phase 内 sub-gate 写成新的 independent exit law。

### 5.2 Phase 2 — E2E Skeleton Wiring

- **Phase 目标**：建立首个真实代码路径 skeleton，作为 PP1-PP6 扩展 e2e 的起点。
- **本 Phase 对应编号**：`P2-01`, `P2-02`, `P2-03`
- **本 Phase 新增文件**：
  - `test/cross-e2e/16-pro-to-product-baseline-skeleton.test.mjs`
- **本 Phase 修改文件**：
  - 必要的 e2e helper / fixture。
- **具体功能预期**：
  1. 首个 baseline skeleton 固定覆盖一条当前已 live 的 facade 控制链：`PATCH /sessions/{id}/runtime` → `session.runtime.update` → `GET /sessions/{id}/runtime` / runtime read-model truth。
  2. PP1 HITL、PP2 compact、PP3 recovery、PP4 hook 只在 PP0 标记 `pending-PP*-implementation` 扩展点，不要求 PP0 预先接通这些主线。
  3. skeleton 输出统一 evidence shape，phase closure 统一复用 `latency_alert.threshold_key / exceeded_count / accepted_by_owner / repro_condition`。
- **具体测试安排**：
  - **单测**：无。
  - **集成测试**：targeted Node e2e。
  - **回归测试**：`pnpm test:cross-e2e`；必要时 `pnpm test:e2e`。
  - **手动验证**：检查 evidence output 是否能被 closure 直接引用。
- **收口标准**：
  - skeleton 被现有 `package.json` scripts 覆盖。
  - evidence shape 包含 `trace_uuid`、开始时间、首次可见时间、终态/降级时间、verdict。
- **本 Phase 风险提醒**：
  - skeleton 不能完全 mock 掉后端事实，否则不能证明 frontend trust。

### 5.3 Phase 3 — FE-1 Handoff & Closure

- **Phase 目标**：完成 PP0 closure，并把 PP1 的 start gate 说清。
- **本 Phase 对应编号**：`P3-01`, `P3-02`
- **本 Phase 新增文件**：
  - `docs/issue/pro-to-product/PP0-closure.md`
- **本 Phase 修改文件**：
  - 无固定修改；仅在 handoff 发现文档漂移时最小修正。
- **具体功能预期**：
  1. FE-1 输出 public surface taxonomy、minimum frontend state inputs、gap list 或确认清单。
  2. PP1 start gate 明确：PP0 truth registry frozen、skeleton owner file 存在、HITL design/action-plan 可消费。
- **具体测试安排**：
  - **单测**：无。
  - **集成测试**：无。
  - **回归测试**：docs consistency（如修改相关 docs）。
  - **手动验证**：PP0 closure 与 PP1 action-plan 对照。
- **收口标准**：
  - `PP0-closure.md` 明确是 `full close`、`close-with-known-issues` 还是 `cannot close`。
  - 若 FE-1 尚未得到实际 frontend 确认，必须作为 owner-action 登记，而非静默视为完成。
- **本 Phase 风险提醒**：
  - 不要因 FE-1 未完成而伪造“前端已确认”的结论。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q1 | `docs/design/pro-to-product/PPX-qna.md` Q1 | 7 truth gates 是唯一 hard exit | 停止 PP0，回到 charter amendment |
| Q2 | `docs/design/pro-to-product/PPX-qna.md` Q2 | latency 只做 alert threshold，但必须登记 | 修正 closure law，不得把 latency 静默删掉 |
| Q3 | `docs/design/pro-to-product/PPX-qna.md` Q3 | frontend 只依赖 orchestrator facade | PP6 sweep 边界必须重写 |
| Q4 | `docs/design/pro-to-product/PPX-qna.md` Q4 | design JIT freeze，PP0 不抢写所有实现细节 | 若要求全量一次性冻结，需重排 PP0 scope |
| Q5 | `docs/design/pro-to-product/PPX-qna.md` Q5 | PP6 只扫 frontend-facing surfaces | 若翻案，PP6 会变成新 charter |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| PP0 文档膨胀 | 把 PP0 做成新的 review/debt matrix 生产阶段 | `medium` | 只交 truth registry、skeleton、closure/handoff |
| skeleton 假闭环 | e2e 只测 helper 或 mock，不走真实 facade/WS/read-model | `high` | closure 必须列出真实 owner route / frame / durable evidence |
| FE-1 暂缺 | frontend lead 未能即时 review | `medium` | 登记 owner-action，不阻塞技术 skeleton，但不能宣称 frontend confirmed |
| latency 被误用 | 超阈值被当 hard gate 或完全忽略 | `medium` | 按 Q2：alert + 登记，不做独立 hard exit |

### 7.2 约束与前提

- **技术前提**：使用现有 root e2e harness；不新增测试框架。
- **运行时前提**：PP0 skeleton 可以在 preview/live 条件不足时先覆盖本地可测路径，但必须标明 live coverage 缺口。
- **组织协作前提**：FE-1 需要 frontend 侧确认或明确 pending。
- **上线 / 合并前提**：PP0 closure 不得声称 PP1-PP6 的主线 truth 已完成。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - 原则上无；只有发现 `00/01` 与 owner QNA 冲突时才修正。
  - 若实现期发现 design/QNA 与代码事实冲突，必须先在本 action-plan 或 `PP0-closure.md` 记录发现，再判断是否回到 `PPX-qna.md` 补充 / 修订答案，并同步通知受影响下游 phase。
- 需要同步更新的说明文档 / README：
  - `docs/issue/pro-to-product/PP0-closure.md`
- 需要同步更新的测试说明：
  - 在新增 e2e skeleton 的同目录或 closure 中写明运行脚本。

### 7.4 完成后的预期状态

1. PP1-PP6 都能引用同一套 truth gates、evidence shape、latency alert 纪律。
2. 仓库存在首个 pro-to-product e2e skeleton，且被现有 `package.json` scripts 覆盖。
3. frontend-facing / internal-only surface 边界已被冻结，PP6 不会失控扩张。
4. PP1 启动时只需消费 PP0 handoff，不再回头重写阶段规则。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `git --no-pager diff --check -- docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md`
  - 对照 `PPX-qna.md` Q1-Q5 确认无未冻结问题。
- **单元测试**：
  - PP0 本身不要求新增单测。
- **集成测试**：
  - targeted e2e skeleton 所在脚本。
- **端到端 / 手动验证**：
  - `pnpm test:package-e2e` 或 `pnpm test:cross-e2e`，视 skeleton owner file 所在目录而定。
- **回归测试**：
  - 如改动共享 test helper，运行 `pnpm test:e2e`。
- **文档校验**：
  - 如改动 docs consistency 覆盖范围，运行 `pnpm run check:docs-consistency`。

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `PP0-closure.md` 存在，且明确 truth gates、evidence shape、cannot-close law。
2. 首个 e2e skeleton 存在，并被现有测试脚本覆盖。
3. FE-1 handoff 有明确确认或 pending owner-action，不伪造已确认事实。
4. PP1 start gate 明确，且不要求 PP1 重新讨论 PP0 决策。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | PP0 只完成基线冻结与 skeleton，不实现 PP1-PP6 主线 |
| 测试 | skeleton 可运行并输出统一 evidence shape |
| 文档 | PP0 closure 与 PP1 handoff 可引用 |
| 风险收敛 | 无新增 exit law、无 docs-only overclaim |
| 可交付性 | PP1 可以在该基线之上启动 |
