# Nano-Agent 行动计划

> 服务业务簇: `pro-to-product / PP3 — Reconnect & Session Recovery`
> 计划对象: `把 last_seen_seq replay、detached recovery、replay_lost degraded 与 session state recovery bundle 接成可信断线恢复链`
> 类型: `modify`
> 作者: `GPT-5.5`
> 时间: `2026-05-03`
> 文件位置: `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md`
> 上游前序 / closure:
> - `docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md`
> - `docs/issue/pro-to-product/PP1-closure.md`
> - `docs/design/pro-to-product/04-reconnect-session-recovery.md`
> 下游交接:
> - `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md`
> - `docs/action-plan/pro-to-product/PP5-policy-reliability-hardening-action-plan.md`
> - `docs/action-plan/pro-to-product/PP6-api-contract-docs-closure-action-plan.md`
> - `docs/issue/pro-to-product/PP3-closure.md`
> 关联设计 / 调研文档:
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> - `docs/design/pro-to-product/PPX-qna.md` Q12-Q14
> 冻结决策来源:
> - `docs/design/pro-to-product/PPX-qna.md` Q12（PP3 不承诺 exactly-once replay）
> - `docs/design/pro-to-product/PPX-qna.md` Q13（继续 single attachment，不支持多活动 attachment）
> - `docs/design/pro-to-product/PPX-qna.md` Q14（replay gap 禁止 silent fallback，必须显式 degraded）
> 文档状态: `draft`

---

## 0. 执行背景与目标

PP3 的目标是让前端在刷新、断线、重连、DO hibernation 或 socket supersede 后仍能得到可信 session 状态。当前 nano-agent 已具备 first-wave substrate：WS attach 解析 `last_seen_seq`，single attachment 会发 `session.attachment.superseded` 并关闭旧 socket（`workers/orchestrator-core/src/user-do/ws-runtime.ts:72-145`），socket close 会标记 `detached`（`ws-runtime.ts:237-245`），HTTP resume 已能返回 `replay_lost` 并写 audit（`surface-runtime.ts:280-319`）；agent-core persistence 也已经通过 `buildWsHelperStorage()` + `helper.checkpoint()` 写入 helper replay 状态（`workers/agent-core/src/host/do/session-do-persistence.ts:154-160`）。但仍有两个关键断点：WS attach 的 replay gap 不能 silent；主 checkpoint object 内的 `replayFragment` 仍 hard-code 为 `null`，且 `restoreFromStorage()` 仍未恢复 helper replay 状态（`session-do-persistence.ts:176`, `193-222`）。

参考 agent 的共同启发是：Codex 明确把 client-agent 交互建成 submission/event queue，高层接口就是 send submission / receive event，并在 Session 中保存 active turn、mailbox、agent status 等状态（`context/codex/codex-rs/core/src/codex.rs:399-410`, `837-862`）；Claude Code 的 resume picker 不只是“读文本”，还处理 cross-project/失败路径（`context/claude-code/commands/resume/resume.tsx:107-170`），backgrounding hook 会同步 messages/loading/abort controller（`context/claude-code/hooks/useSessionBackgrounding.ts:76-144`）。nano-agent 不照搬本地 AppState，但必须向远程前端提供等价的 recovery bundle。

- **服务业务簇**：`pro-to-product / PP3 — Reconnect & Session Recovery`
- **计划对象**：`WS reconnect + HTTP resume + durable session state recovery`
- **本次计划解决的问题**：
  - `last_seen_seq` gap 在 WS attach 上缺早期 degraded verdict，可能被 latest state silent fallback 掩盖。
  - DO hibernation / restore 的 replayFragment 持久化与恢复不对称。
  - 前端恢复 UI 所需的 session phase、active turn、pending interaction、runtime/context/items read models 还没有被定义成 recovery bundle。
- **本次计划的直接产出**：
  - WS attach early `session.replay.lost` degraded frame，与 HTTP resume `replay_lost` 对齐。
  - helper replay / stream seq state 的 persist + restore 对称修复。
  - `docs/issue/pro-to-product/PP3-closure.md`，登记 T3/T4 truth、single attachment、detached recovery 与 latency alert。
- **本计划不重新讨论的设计结论**：
  - PP3 不承诺 exactly-once replay，只承诺 best-effort replay + explicit degraded（来源：`PPX-qna.md` Q12）。
  - PP3 继续 single attachment + supersede，不做多端协作（来源：`PPX-qna.md` Q13）。
  - replay gap 禁止 silent latest-state fallback，WS attach 与 HTTP resume 都要 early degraded（来源：`PPX-qna.md` Q14）。

---

## 1. 执行综述

### 1.1 总体执行方式

PP3 采用 **先修 replay/gap 语义，再修 persistence symmetry，最后定义 recovery bundle** 的方式。第一步让前端在 attach/resume 决策点立即知道 replay 是否完整；第二步修复 agent-core helper checkpoint/restore 的对称性；第三步把重连后必须刷新哪些 HTTP read models 与 WS frames 固化为 frontend recovery bundle，并输出 e2e evidence。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Cursor & Early Degraded Law | `M` | 对齐 WS attach 与 HTTP resume 的 `last_seen_seq` / `replay_lost` 行为 | `PP1 closure` |
| Phase 2 | Replay Persistence Symmetry | `M` | 修复 helper replay/stream seq state 的 persist + restore 对称性 | `Phase 1` |
| Phase 3 | Detached & Attachment State | `S` | 固化 single attachment、supersede、detached、terminal rejection 行为 | `Phase 2` |
| Phase 4 | Recovery Bundle & Closure Evidence | `M` | 定义前端恢复状态包，并输出 reconnect truth e2e / closure | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — Cursor & Early Degraded Law**
   - **核心目标**：明确 `last_seen_seq`、`relay_cursor` 与 replay gap 的 public 语义。
   - **为什么先做**：如果 gap 仍 silent，后续 state bundle 只是 latest-state 兜底，不能证明恢复可信。
2. **Phase 2 — Replay Persistence Symmetry**
   - **核心目标**：修掉 `replayFragment: null` 与 restore 不恢复 helper 的不对称。
   - **为什么放在这里**：WS replay 不只发生在同一个热 DO 实例；hibernation/restore 是 PP3 必须覆盖的后端现实。
3. **Phase 3 — Detached & Attachment State**
   - **核心目标**：确认 single attachment supersede、socket close detached、terminal session rejection 行为稳定。
   - **为什么放在这里**：Q13 已冻结 single attachment，PP3 只要 harden 现有合同，不扩多端。
4. **Phase 4 — Recovery Bundle & Closure Evidence**
   - **核心目标**：定义前端 reconnect 后必须读取/订阅的最小状态集合，并形成 T3/T4 evidence。
   - **为什么放在最后**：只有 replay、persistence、attachment 语义稳定，bundle 才是可信 contract。

### 1.4 执行策略说明

- **执行顺序原则**：public gap semantics → DO/agent persistence → attachment lifecycle → frontend recovery bundle。
- **风险控制原则**：不承诺 exactly-once，不引入 event-store v2，不支持多活动 attachment。
- **测试推进原则**：先补 WS/HTTP route/DO tests，再补 agent-core persistence tests，最后做 reconnect cross-e2e。
- **文档同步原则**：必要最小同步 WS/resume docs；完整 docs pack 由 PP6 逐项对账。
- **回滚 / 降级原则**：无法完整 replay 时必须 early degraded；不能静默 latest-state fallback。

### 1.5 本次 action-plan 影响结构图

```text
PP3 Reconnect & Session Recovery
├── Phase 1: Cursor & Early Degraded Law
│   ├── workers/orchestrator-core/src/user-do/ws-runtime.ts
│   ├── workers/orchestrator-core/src/user-do/surface-runtime.ts
│   └── clients/api-docs/session-ws-v1.md（必要最小同步）
├── Phase 2: Replay Persistence Symmetry
│   ├── workers/agent-core/src/host/do/session-do-persistence.ts
│   ├── packages/nacp-session/src/replay.ts
│   └── agent-core persistence tests
├── Phase 3: Detached & Attachment State
│   ├── workers/orchestrator-core/src/user-do/ws-runtime.ts
│   └── orchestrator-core WS/DO tests
└── Phase 4: Recovery Bundle & Closure Evidence
    ├── test/cross-e2e/**/*.test.mjs
    ├── docs/issue/pro-to-product/PP3-closure.md
    └── docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md handoff
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** WS attach 检测 `client last_seen_seq > relay_cursor` 时 early emit `session.replay.lost` 或等价 top-level degraded frame。
- **[S2]** HTTP resume 保持同步返回 `replay_lost`，并与 WS degraded frame 语义一致。
- **[S3]** 修复 agent-core helper replay / stream seq checkpoint：persist 与 restore 都必须覆盖。
- **[S4]** single attachment supersede、socket close detached、terminal session rejection 有测试和 docs truth。
- **[S5]** 定义 frontend recovery bundle：WS replay + confirmations + context probe + runtime + items/todos/tool calls + active/pending state。
- **[S6]** PP3 closure 直接证明 T3 reconnect truth 与 T4 session state truth，PP6 只负责 docs 对账。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 不建设永久 event-store v2，不承诺 exactly-once replay。
- **[O2]** 不支持多活动 attachment、多端协作或 presence plane。
- **[O3]** 不重做 HITL ask/elicitation 主线；PP3 只消费 PP1 已稳定 substrate。
- **[O4]** 不重做 compact prompt mutation；若 PP2 已闭合，PP3 只在 recovery bundle 中消费其 compact boundary read-model，未闭合时对应字段标 `pending-PP2`。
- **[O5]** 不做 full client docs sweep；只同步 PP3 必需的 reconnect truth。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| WS `last_seen_seq` replay | `in-scope` | 前端重连核心入口 | 无 |
| HTTP resume `replay_lost` | `in-scope` | 已有 public precedent，需与 WS 对齐 | 无 |
| helper replay restore | `in-scope` | 现在 persist/restore 不对称，会破坏 hibernation recovery | 无 |
| exactly-once delivery | `out-of-scope` | Q12 冻结不承诺 | 下一阶段 event-store charter |
| 多活动 attachment | `out-of-scope` | Q13 冻结 single attachment | platform-foundations 阶段 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | WS replay gap degraded frame | `update` | `workers/orchestrator-core/src/user-do/ws-runtime.ts` | replay gap attach 后立即可见 | `high` |
| P1-02 | Phase 1 | HTTP/WS replay_lost parity | `update` | `surface-runtime.ts`, ws tests | 两条恢复入口语义一致 | `medium` |
| P2-01 | Phase 2 | Helper replay checkpoint persist | `update` | `session-do-persistence.ts` | 冻结 `replayFragment` 去留，checkpoint 不再维持语义不明的 `null` | `high` |
| P2-02 | Phase 2 | Helper replay restore | `update` | `session-do-persistence.ts`, replay helper | restore 后 replay buffer/seq 可用 | `high` |
| P3-01 | Phase 3 | Single attachment tests | `add` | `ws-runtime.ts` tests | supersede + close 行为稳定 | `medium` |
| P3-02 | Phase 3 | Detached/terminal state tests | `add` | User DO tests | close 后 detached，terminal 拒绝恢复 | `medium` |
| P4-01 | Phase 4 | Recovery bundle spec | `add` | `PP3-closure.md`, minimal docs | 前端知道重连后读哪些 state | `medium` |
| P4-02 | Phase 4 | Reconnect truth e2e | `add` | `test/cross-e2e` | last_seen replay/gap/detached 有证据 | `high` |
| P4-03 | Phase 4 | PP3 closure | `add` | `docs/issue/pro-to-product/PP3-closure.md` | T3/T4 truth 可被 PP6 引用 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Cursor & Early Degraded Law

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | WS replay gap degraded frame | 在 attach 时检测 client seq 超前并先发 degraded frame，再继续后续流程 | `ws-runtime.ts` | replay gap 不 silent | WS/DO test | attach 后首个相关信号包含 replay lost |
| P1-02 | HTTP/WS replay_lost parity | 对齐 HTTP resume body 与 WS frame 的字段、code、audit detail | `surface-runtime.ts`, `ws-runtime.ts` | 两条入口一致 | route/WS tests | 前端不需要猜哪条 contract 更权威 |

### 4.2 Phase 2 — Replay Persistence Symmetry

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Helper replay checkpoint persist | 保存 replay fragment、stream seqs 或 helper checkpoint reference，并在实现期明确 `replayFragment` 是保留双写还是废弃为 helperStorage-only | `session-do-persistence.ts` | checkpoint 包含恢复所需 replay state | agent-core persistence test | checkpoint schema 验证通过，且 `replayFragment` 去留有明确决策 |
| P2-02 | Helper replay restore | restore 时调用对应 helper restore path，恢复 replay buffer/seq | `session-do-persistence.ts`, replay helper | fresh DO 仍可 replay | agent-core test | persist/restore 对称 |

### 4.3 Phase 3 — Detached & Attachment State

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | Single attachment tests | 覆盖第二个 attach supersede 第一 socket、frame、audit、close code | `ws-runtime.ts` tests | Q13 有测试证据 | WS/DO test | 无多 attachment 竞态 |
| P3-02 | Detached/terminal state tests | 覆盖 socket close → detached、reattach → active、terminal session rejection | User DO tests | 断线不是结束，终态不可恢复 | WS/DO test | session status transition 清晰 |

### 4.4 Phase 4 — Recovery Bundle & Closure Evidence

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | Recovery bundle spec | 定义 reconnect 后必须刷新 confirmations/context/runtime/items/tool-calls 等 read models | closure/docs | 前端可重建 UI | docs review | bundle 可映射到 public routes |
| P4-02 | Reconnect truth e2e | 覆盖 replay success、replay_lost、detached reattach、pending recovery | cross-e2e | T3/T4 有 evidence | e2e | evidence shape 与 PP0 一致 |
| P4-03 | PP3 closure | 写 truth verdict、latency alert、known issues 与 PP5/PP6 handoff | `PP3-closure.md` | PP3 不 overclaim | docs review | T3/T4 verdict 诚实 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Cursor & Early Degraded Law

- **Phase 目标**：让 replay gap 在前端决策点立即可见。
- **本 Phase 对应编号**：`P1-01`, `P1-02`
- **本 Phase 新增文件**：
  - WS attach / resume parity tests。
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/user-do/ws-runtime.ts`
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts`
- **具体功能预期**：
  1. `last_seen_seq > relay_cursor` 时，WS attach 不 silent。
  2. HTTP resume 与 WS degraded 使用同一语义：client seq、relay cursor、reason/code、trace。
  3. degraded verdict 在 attach/resume 早期可见，而不是 turn 结束后补发。
- **具体测试安排**：
  - **单测**：cursor parse / replay gap decision。
  - **集成测试**：User DO WS attach route。
  - **回归测试**：`pnpm --filter @haimang/orchestrator-core-worker test`。
  - **手动验证**：对照 `clients/api-docs/session-ws-v1.md` 的 `last_seen_seq` 文档入口。
- **收口标准**：
  - silent latest-state fallback 不存在。
  - `session.replay_lost` audit/frame 可追溯。
- **本 Phase 风险提醒**：
  - 不要把 degraded frame 设计成只有 docs 有、runtime 不发。

### 5.2 Phase 2 — Replay Persistence Symmetry

- **Phase 目标**：修复 hibernation/restore 对 replay state 的破坏。
- **本 Phase 对应编号**：`P2-01`, `P2-02`
- **本 Phase 新增文件**：
  - agent-core persistence targeted tests。
- **本 Phase 修改文件**：
  - `workers/agent-core/src/host/do/session-do-persistence.ts`
  - 可能的 WS helper storage/restore helpers。
- **具体功能预期**：
  1. `helper.checkpoint(helperStorage)` 现有通道继续保留，但主 checkpoint object 的 `replayFragment` 去留必须在 PP3 实施期做出明确选择（双写保留或 helperStorage-only）。
  2. restore path 恢复 helper replay buffer / stream seqs。
  3. checkpoint validator 与真实 shape 对齐。
- **具体测试安排**：
  - **单测**：checkpoint shape validation。
  - **集成测试**：persist → fresh context restore → replay。
  - **回归测试**：`pnpm --filter @haimang/agent-core-worker test`。
  - **手动验证**：persist 与 restore 两端都改，不只修一端。
- **收口标准**：
  - replay fragment persist/restore 对称。
  - hibernation 后不直接丢 replay buffer。
- **本 Phase 风险提醒**：
  - checkpoint schema 一旦变化，要确认是否触发 docs/compat 说明；默认不新增 D1。

### 5.3 Phase 3 — Detached & Attachment State

- **Phase 目标**：把 single attachment + detached lifecycle 固化为测试证据。
- **本 Phase 对应编号**：`P3-01`, `P3-02`
- **本 Phase 新增文件**：
  - orchestrator-core WS lifecycle tests。
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/user-do/ws-runtime.ts`（如发现 race gap）。
- **具体功能预期**：
  1. 第二 attachment 使第一 socket 收到 `session.attachment.superseded` 并 close。
  2. socket close 后 session 进入 detached，reattach 后 active。
  3. terminal/ended session 不被恢复成 active。
- **具体测试安排**：
  - **单测**：无或 helper。
  - **集成测试**：User DO WS lifecycle。
  - **回归测试**：orchestrator-core tests。
  - **手动验证**：Q13 single attachment 不被误写成 multi-device 支持。
- **收口标准**：
  - single attachment law 有 code + test + closure 证据。
  - 多端协作仍 out-of-scope。
- **本 Phase 风险提醒**：
  - 不要新增“多 attachment 协调”代码来解决 single attachment race。

### 5.4 Phase 4 — Recovery Bundle & Closure Evidence

- **Phase 目标**：让前端知道重连后如何重建 UI，并证明 T3/T4。
- **本 Phase 对应编号**：`P4-01`, `P4-02`, `P4-03`
- **本 Phase 新增文件**：
  - reconnect cross-e2e。
  - `docs/issue/pro-to-product/PP3-closure.md`
- **本 Phase 修改文件**：
  - 必要的 `clients/api-docs/session-ws-v1.md` / `workspace.md` / recovery docs 最小同步。
- **具体功能预期**：
  1. recovery bundle 列出必须刷新/读取的 public surfaces：confirmations、context probe、runtime、items/tool calls、session status。
  2. e2e 覆盖 replay success、replay lost、detached reattach、pending interaction recovery。
  3. PP3 closure 明确 T4 session state truth 由 PP3 负责运行时证据；若 PP2 尚未闭合，compact/context 相关字段必须显式标 `pending-PP2`，不制造硬依赖。
- **具体测试安排**：
  - **单测**：无。
  - **集成测试**：route/read-model bundle tests。
  - **回归测试**：`pnpm test:cross-e2e` 或 targeted live/cross e2e。
  - **手动验证**：bundle 每项都能映射到 frontend-facing public route/frame。
- **收口标准**：
  - T3/T4 truth 有真实证据，不由 PP6 docs 替代。
  - replay gap latency ≤2s 只作 alert 登记。
- **本 Phase 风险提醒**：
  - 如果只能恢复 latest state 但无法恢复 pending/active truth，PP3 必须 cannot close 或 close-with-blocker，不能 overclaim。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q12 | `PPX-qna.md` Q12 | 不承诺 exactly-once，采用 best-effort + degraded | 若要求 exactly-once，需 event-store charter |
| Q13 | `PPX-qna.md` Q13 | 继续 single attachment + supersede | 多端协作全部 defer |
| Q14 | `PPX-qna.md` Q14 | replay gap 必须 early degraded，不 silent | 未实现则 PP3 cannot close |
| T3 | `plan-pro-to-product.md` §10.1 | reconnect replay/lagged 是硬闸 | 未满足不得宣称 reconnect closed |
| T4 | `plan-pro-to-product.md` §10.1 | session state truth 由 PP3 提供运行时证据 | PP6 docs 不能替代 PP3 evidence |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| seq owner 分叉 | relay_cursor、event_seq、stream_seq 混用导致 replay 错位 | `high` | PP3 必须指定 public seq owner 与转换规则 |
| degraded 太晚 | replay_lost 直到 turn 结束才出现 | `high` | attach/resume early verdict test |
| checkpoint shape 漂移 | replayFragment 改非空可能影响 validator/compat | `medium` | 同步 validator + tests，不新增 D1 |
| PP1 共享文件冲突 | `session-do-runtime.ts` 仍在 PP1 高频修改 | `medium` | PP3 只在 PP1 closure 冻结共享 owner file 清单并暴露可复用 extension point 后修改 shared file |

### 7.2 约束与前提

- **技术前提**：PP1 的 ask/elicitation wakeup 主线已稳定；若 PP2 已闭合，compact boundary 可被 recovery bundle 消费，否则相关字段标 `pending-PP2`。
- **运行时前提**：User DO WS attach 与 HTTP resume 均可测试。
- **组织协作前提**：FE-2 review 需要检查 reconnect/loading/pending/degraded UX 假设。
- **上线 / 合并前提**：不得宣称 multi-device 支持或 exactly-once replay；若修改触及 D1 例外，必须先确认当前 migration baseline 仍从 `017` 起连续，再按“当前最新编号 + 1”顺延。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - 原则上无；若 replay guarantee 改变，回到 `PPX-qna.md`。
  - 若实现期发现 design/QNA 与代码事实冲突，必须先在本 action-plan 或 `PP3-closure.md` 记录发现，再判断是否回到 `PPX-qna.md` 补充 / 修订答案，并同步通知 PP4 / PP5 / PP6。
- 需要同步更新的说明文档 / README：
  - `docs/issue/pro-to-product/PP3-closure.md`
  - 必要时最小更新 `clients/api-docs/session-ws-v1.md`
- 需要同步更新的测试说明：
  - reconnect e2e evidence 与运行脚本写入 closure。

### 7.4 完成后的预期状态

1. WS reconnect 成功时能 replay；失败时能 early degraded。
2. HTTP resume 与 WS attach 对 replay_lost 的语义一致。
3. DO hibernation/restore 后 replay helper state 不再丢失。
4. 前端有明确 recovery bundle，可重建 active/pending/degraded UI。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `git --no-pager diff --check -- docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md`
- **单元测试**：
  - cursor/replay gap helper tests。
  - persistence checkpoint/restore tests。
- **集成测试**：
  - User DO WS attach/supersede/detached tests。
  - HTTP resume route tests。
- **端到端 / 手动验证**：
  - reconnect e2e：normal replay、seq gap degraded、detached reattach、pending state recovery。
- **回归测试**：
  - `pnpm --filter @haimang/orchestrator-core-worker test`
  - `pnpm --filter @haimang/agent-core-worker test`
  - `pnpm test:cross-e2e`（若扩展跨 worker e2e）
- **文档校验**：
  - `pnpm run check:docs-consistency`（若改 clients/api-docs）。

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. replay gap 不 silent，WS/HTTP 都有 early degraded。
2. replay persistence persist/restore 对称。
3. single attachment / detached / terminal lifecycle 有测试证据。
4. recovery bundle 支撑前端恢复 active turn、pending interaction、runtime/context 等最小状态。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | best-effort replay + explicit degraded + recovery bundle 成立 |
| 测试 | WS/HTTP/persistence/e2e 覆盖主要恢复路径 |
| 文档 | PP3 closure 与必要 WS/resume docs truth 同步 |
| 风险收敛 | 无 exactly-once overclaim、无 silent fallback、无 multi-attachment scope creep |
| 可交付性 | PP4/PP5/PP6 可基于稳定 recovery contract 继续执行 |

---

## 9. 执行工作报告（2026-05-03）

1. **P1-01 / WS replay gap degraded frame 已完成**：在 `workers/orchestrator-core/src/user-do/ws-runtime.ts` 中，当 WS attach 的 `last_seen_seq > relay_cursor` 时，先写 `session.replay_lost` audit，再发 top-level `session.replay.lost` frame，然后才进入 replay forwarding。该 frame 包含 `session_uuid`、`client_last_seen_seq`、`relay_cursor`、`reason`、`degraded`、`emitted_at` 与可选 `trace_uuid`。
2. **P1-02 / HTTP 与 WS replay_lost parity 已完成**：`workers/orchestrator-core/src/user-do/surface-runtime.ts` 的 HTTP resume response 新增 additive `replay_lost_detail`，并与 WS frame/audit detail 使用同一 `{ client_last_seen_seq, relay_cursor, reason, degraded }` 语义。`clients/api-docs/session.md` 与 `clients/api-docs/session-ws-v1.md` 已同步说明。
3. **protocol registry 已补齐**：`packages/nacp-session` 已新增 `session.replay.lost` body schema、message type、required body、role/phase registry 与 type-direction matrix；`workers/orchestrator-core/src/frame-compat.ts` 已映射该 frame，使 lightweight server frame 进入 schema validation。
4. **P2-01 / P2-02 replay persistence symmetry 已完成**：`workers/agent-core/src/host/do/session-do-persistence.ts` 在 `restoreFromStorage()` 中恢复 `SessionWebSocketHelper` 的 helper storage，使 helper replay / stream seq 与既有 `helper.checkpoint()` 写入路径对称。
5. **P3-01 / P3-02 attachment lifecycle 已核实**：沿用既有 single attachment + supersede 语义；User DO tests 覆盖 supersede frame/close、last_seen replay、replay_lost attach、missing/ended typed rejection。PP3 未新增多活动 attachment 逻辑，符合 Q13。
6. **P4-01 / recovery bundle 已登记**：`clients/api-docs/session-ws-v1.md` 明确 reconnect flow：client 持有 max seen seq，attach 时传 `last_seen_seq`，遇到 `session.replay.lost` 或 HTTP `replay_lost` 时刷新 runtime、confirmations、context probe、todos/items/tool-call read models，并用 timeline 做 reconciliation。
7. **P4-02 / reconnect truth e2e 未 overclaim**：本轮未新增 live/cross-worker e2e；closure 明确登记为 `not-claimed`，当前 PP3 first-wave evidence 来自 package tests、worker targeted tests、docs/governance gates 与独立 code review。
8. **测试与治理 gate 已通过**：已执行 `@haimang/nacp-session` typecheck/build/test，`@haimang/orchestrator-core-worker` typecheck + `test/user-do.test.ts` / `test/observability-runtime.test.ts`，`@haimang/agent-core-worker` typecheck + checkpoint roundtrip test，`pnpm run check:docs-consistency`、`pnpm run check:megafile-budget`、`pnpm run check:envelope-drift` 与 `git --no-pager diff --check`。
9. **独立审查已完成**：第一轮 PP3 code review 未发现重大问题；HTTP resume parity 小修后，第二轮窄范围 parity review 也未发现重大问题。
10. **closure 已输出**：`docs/issue/pro-to-product/PP3-closure.md` 已记录 verdict、resolved items、行为矩阵、recovery bundle、validation evidence、known issues 与 PP4/PP5/PP6 交接事项。
