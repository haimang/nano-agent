# Nano-Agent 代码审查报告 — HP2-HP4 阶段综合审查

> 审查对象: `hero-to-pro 阶段 HP2/HP3/HP4（含 HP5 first-wave）`
> 审查类型: `mixed（code-review + docs-review + closure-review + cross-phase 深度分析）`
> 审查时间: `2026-04-30`
> 审查人: `Deepseek`
> 审查范围:
> - `workers/orchestrator-core/src/`（session-truth / context-control-plane / checkpoint-restore-plane / confirmation-control-plane / session-lifecycle / session-flow / message-runtime / index.ts / entrypoint.ts / user-do-runtime.ts）
> - `workers/context-core/src/`（control-plane.ts / index.ts / context-assembler.ts）
> - `workers/agent-core/src/host/`（runtime-mainline.ts / orchestration.ts / runtime-assembly.ts / kernel/）
> - `packages/nacp-session/src/`（messages.ts / stream-event.ts / type-direction-matrix.ts / session-registry.ts）
> - `clients/api-docs/`（11 份文档全部核查）
> - `workers/orchestrator-core/migrations/`（007-014 全部核查）
> - `docs/action-plan/hero-to-pro/HP2/HP3/HP4-action-plan.md`
> - `docs/issue/hero-to-pro/HP2/HP3/HP4/HP5-closure.md`
> - `docs/charter/plan-hero-to-pro.md`
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md`（§7.3 HP2 / §7.4 HP3 / §7.5 HP4 / §7.6 HP5）
> - `docs/action-plan/hero-to-pro/HP{2,3,4}-action-plan.md`（含工作日志回填）
> - `docs/issue/hero-to-pro/HP{2,3,4,5}-closure.md`（收口声明）
> - `docs/design/hero-to-pro/HP{2,3,4,5}-*.md`（设计文档）
> - `docs/design/hero-to-pro/HPX-qna.md`（冻结决策）
> - 真实代码与测试面（`workers/*/test/`）
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**: HP2-HP4 三个阶段的 first wave 主体成立——所有 closure 中声明的 `done-first-wave`（model control plane、context control plane、chat lifecycle/checkpoint registry）均可在代码中找到对应实现且单元测试全绿。但 closure 的 `partial` 自评诚实：剩余 gap（`<model_switch>` / model.fallback / CrossTurnContextManager / auto-compact / retry / restore）均未接入 runtime 真实链路。此外，本次审查发现 **跨阶段连线断裂**（orchestrator-core 组装好的状态链未完整进入 agent-core）、**wire-without-public-route**（checkpoint-restore-plane 544 行完整逻辑无 HTTP 路由）、以及 **charter 文档纪律漂移**（`clients/api-docs/` 散落更新）等多项问题。

- **结论等级**: `changes-requested`

- **是否允许关闭本轮 review**: `no`（需针对 blocker 级别的发现做出回应/修复，方可重新审查）

- **本轮最关键的 3 个判断**:
  1. **跨阶段连线断裂** — agent-core runtime-mainline 从 message payload 读 modelId 自建推理链，但 orchestrator-core 中已实现的 `turn override > session default > global default` 三层模型解析结果未以结构化方式完整传递到 agent-core，形成一个 `session model API 能读能写但 runtime 不完全消费` 的断点。
  2. **checkpoint-restore-plane 是一个典型的 wire-without-delivery 案例** — 544 行 restore job / rollback / snapshot lineage 逻辑存在，但 `index.ts` 中无任何 HTTP 路由注册。这重演了 F12/F13 的教训：数据层完备但对外不可达。
  3. **`clients/api-docs/` 更新违反了 charter §4.4 纪律 3** — charter 明确说"HP2-HP8 不更新 clients/api-docs/"，但 HP2、HP3、HP4 的 closure 均声称已更新。本轮审查确认文档内容本身与代码对齐良好，但执行纪律已漂移。

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/charter/plan-hero-to-pro.md`（全 1331 行审读）
  - `docs/action-plan/hero-to-pro/HP2-action-plan.md`（全 437 行）
  - `docs/action-plan/hero-to-pro/HP3-action-plan.md`（全 482 行）
  - `docs/action-plan/hero-to-pro/HP4-action-plan.md`（全 498 行）
  - `docs/issue/hero-to-pro/HP2/HP3/HP4/HP5-closure.md`（共 506 行）
- **核查实现**:
  - `workers/orchestrator-core/src/index.ts`（~2500 行，含所有新路由注册）
  - `workers/orchestrator-core/src/session-truth.ts`（~1500 行，含 model/lifecycle/cursor/checkpoint truth）
  - `workers/orchestrator-core/src/context-control-plane.ts`（561 行）
  - `workers/orchestrator-core/src/checkpoint-restore-plane.ts`（544 行）
  - `workers/orchestrator-core/src/confirmation-control-plane.ts`（293 行）
  - `workers/orchestrator-core/src/entrypoint.ts`（含 4 个 context RPC）
  - `workers/orchestrator-core/src/user-do/session-flow.ts`（含 handleClose/handleDelete/handleTitle）
  - `workers/orchestrator-core/src/user-do/message-runtime.ts`（含三层模型选择链）
  - `workers/context-core/src/control-plane.ts`（512 行）
  - `workers/context-core/src/index.ts`（解 stub 后实现）
  - `workers/agent-core/src/host/runtime-mainline.ts`（含 model prompt suffix 接线）
  - `workers/agent-core/src/host/orchestration.ts`（compactRequired 硬编码位置）
  - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`（HookDispatcher 注入位）
  - `packages/nacp-session/src/messages.ts`（confirmation 帧族）
  - `packages/nacp-session/src/stream-event.ts`（stream event registry）
  - `clients/api-docs/`（11 份文档全部核查）
  - `workers/orchestrator-core/migrations/`（007-014 全部核查）
- **执行过的验证**:
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test` → **300/300 通过**
  - `pnpm --filter @haimang/agent-core-worker typecheck build test` → **1077/1077 通过**
  - `pnpm --filter @haimang/context-core-worker typecheck build test` → **178/178 通过**
  - `pnpm --filter @haimang/nacp-session typecheck build test` → **191/191 通过**
  - `grep` 全仓搜索 `<model_switch>` / `model.fallback` / `CrossTurnContextManager` / `compactRequired` / `restore` / `retry` / `forwardInternalJsonShadow`
  - `clients/api-docs/` 与代码路由表逐项对账
- **复用 / 对照的既有审查**:
  - `docs/code-review/hero-to-pro/HP2-HP4-reviewed-by-GLM.md` 和 `HP2-HP4-reviewed-by-GPT.md` 存在于目录中但**未被本审查采纳或参考**（独立完成）

### 1.1 已确认的正面事实

- **HP2 Model Control Plane 完整落地**: `GET /models/{id}` (支持 encoded canonical id + `@alias/*`)、`GET/PATCH /sessions/{id}/model`（含 set/clear/reasoning）、alias resolve、global default 选取、requested/effective turn audit 已全部写入 D1 且 `session-truth.ts` 单源管控。
- **HP3 Context Control Plane 解 stub**: context-core 三个原 stub RPC 全部解封，`getContextProbe`/`getContextLayers`/`previewCompact`/`getCompactJob` 新增 4 个真实 RPC；façade 暴露 7 个细分 context 路由（probe/layers/snapshot/compact-preview/compact/compact-job/legacy alias）。`compact.notify` stream event 已在 manual compact 完成时写入。
- **HP4 Chat Lifecycle First Wave 完整**: close/delete/title 三个 lifecycle 操作均已落地，复用 `ended_reason=closed_by_user`/`deleted_at`/`title` 的 durable truth；`/me/sessions` 与 `/me/conversations` 从内存 regroup 升级为 direct D1 cursor read model；checkpoint list/create/diff 已 live；`GET /conversations/{conversation_uuid}` 已 live。
- **HP5 Confirmation First Wave 部分落地**: `D1ConfirmationControlPlane` 完整 7-kind / 6-status 注册、`/confirmations` 三件套 API、`session.confirmation.request/update` NACP 帧族、kernel `confirmation_pending` 统一（淘汰 `approval_pending`）、HookDispatcher 无条件注入、legacy compat dual-write 全部实现。
- **14 个 migration 文件全部存在**（001-014），DDL 集中纪律基本遵守（唯一例外 HP2 补 `014-session-model-fallback-reason.sql`，按 charter §4.4 R8 受控例外流程完成，closure 中显式登记）。
- **所有单包测试全绿**（1746 个测试，0 失败），构建与 typecheck 均无报错。
- **`clients/api-docs/` 11 份文档**内容与当前代码事实对齐良好，并诚实在 `session.md:202-203` 标注了 "仍未开放" 的 gap。
- **设计文档全套存在**: 12 份 HP0-HP10 + HPX-qna.md design doc 悉数就位，`docs/architecture/hero-to-pro-schema.md` 也已交付。

### 1.2 已确认的负面事实

- **R1: `compactRequired` 硬编码 `false`** — `workers/agent-core/src/host/orchestration.ts:296,429` 两处硬编码 `compactRequired: false`。kernel scheduler（`scheduler.ts:50`）已支持 `signals.compactRequired` 检查，但 host 永不置 true。这意味着 auto-compact 完全不会触发，context-plane 的 budget/probe/preview 仅服务于手动 compact。
- **R2: `checkpoint-restore-plane.ts` 无 HTTP 路由** — 该文件 544 行实现（含 4 种 restore mode、rollback 逻辑、fork lineage、snapshot 状态机），但 `index.ts` 中未注册任何 restore 路由。closure 自身也坦承 "restore job: not-wired"。
- **R3: `<model_switch>` developer message 不存在于 agent-core** — `model_switch` 仅作为 confirmation kind 和 context protection tag 存在，未在任何 agent-core 代码中检测跨 turn 模型变化并注入 developer message。
- **R4: `model.fallback` stream event 不存在** — `packages/nacp-session/src/stream-event.ts` 当前 11 种 event kind 中无 `model.fallback`。closure 也坦承 "not-yet"。
- **R5: `CrossTurnContextManager` 不存在** — 在 agent-core 中全局搜索零结果。cross-turn history 仍通过原来 `contextProvider` seam + message 直传处理，而非通过统一的 context manager。
- **R6: retry 路由不存在** — `POST /sessions/{id}/retry` 在 `index.ts` 中无路由注册。closure 也坦承 "not-started-on-public-surface"。
- **R7: agent-core 与 orchestrator-core 之间模型状态传递路径断裂** — `runtime-mainline.ts:218-222` 从 message payload 自读 `modelId`（并 fallback 到 `defaultModel` 参数），但 `session-truth.ts` 已建立的三层解析结果（`turn override > session default > global default`）中 session-level 的 `default_model_id` 没有通过结构化 channel 传递到 agent-core 的 LLM 调用链路。agent-core 的 `readLlmRequestEvidence()` 只从消息中提取 `model_id`，而非从 durable truth 反查。
- **R8: `clients/api-docs/` 更新违反 charter §4.4 纪律 3** — charter 明确规定 "HP2-HP8 不更新 clients/api-docs/（允许写 design 文档作为内部参考），HP9 一次性集中更新"。但 HP2 closure §0、HP3 closure §0、HP4 closure §0 均声称本轮已更新 API docs。经核查，更新内容与代码事实对齐良好（无 stub 残留、无错误声明），但执行纪律本身已漂移。
- **R9: `docs/action-plan/hero-to-pro/HP3-action-plan.md` 文档状态为 `draft`** — 但该文件第 469-482 行包含了完整的工作日志回填。HP2 和 HP4 的 action-plan 分别标注 `executed` 和 `executing`。HP3 action-plan 的 `draft` 标签与实际执行进度不符。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 所有 closure/schema/实现文件均被读取并核实行号 |
| 本地命令 / 测试 | yes | 全部 4 包 typecheck + build + test（1746 tests，0 failures） |
| schema / contract 反向校验 | yes | migration 文件 007-014 逐一验证，NACP 帧族 schema 与代码对账 |
| live / deploy / preview 证据 | no | 未做 preview deploy，cross-e2e 未执行 |
| 与上游 design / QNA 对账 | yes | HPX-qna Q7-Q18/Q38/Q39 对照代码实现逐项核查 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | `compactRequired` 硬编码 false 导致 auto-compact 不触发 | high | correctness | yes | 在 agent-core host 中接入 budget 信号，设 `compactRequired: true` |
| R2 | `checkpoint-restore-plane.ts` 无 HTTP 路由 — 经典 wire-without-delivery | high | delivery-gap | yes | 在 `index.ts` 注册 restore 路由，或显式声明 defer-to-HP7 |
| R3 | `<model_switch>` developer message 完全缺失 | high | delivery-gap | no (closure 已标注) | HP2/HP3 后续批次中实现注入逻辑 |
| R4 | `model.fallback` stream event 完全缺失 | high | delivery-gap | no (closure 已标注) | HP2 后续批次中新增 nacp-session event kind |
| R5 | `CrossTurnContextManager` 不存在于 agent-core | high | delivery-gap | no (closure 已标注) | HP3 后续批次中实现 |
| R6 | retry 路由不存在 | high | delivery-gap | no (closure 已标注) | HP4 后续批次中实现 |
| R7 | agent-core ↔ orchestrator-core 模型状态传递断裂 | high | correctness | yes | 建立结构化 channel 传递 session-level model default 到 agent-core |
| R8 | `clients/api-docs/` 散落更新违反 charter §4.4 纪律 3 | medium | scope-drift | no | HP9 启动时全面复查，确保无新漂移 |
| R9 | HP3 action-plan 文档状态标注 `draft` 与实际不符 | low | docs-gap | no | 修改为 `executed` |
| R10 | 全部 HP2-HP5 cross-e2e 未执行 | medium | test-gap | no (closure 已标注) | HP5 后续批次补齐 15-18，HP2-HP4 相应批次补 e2e |
| R11 | `model.fallback` stream event 不存在 | dup of R4 | — | — | — | — |
| R12 | confirmation emitter 侧 row-create 未接通 | medium | delivery-gap | no (closure 已标注) | HP5 后续批次中接通 PreToolUse emitter |
| R13 | 三个 context-core RPC 解 stub 后新增了 context-plane RPC 但旧方法签名仍保留 | low | correctness | no | 确认 `contextOps` 返回列表正确且无残留 stub code path |
| R14 | HP2-HP5 全部 closure 均标 `partial` — 不存在一个完成的 phase | medium | scope-drift | no | 后续批次明确 timebox 或进行 partial-close 归档 |

### R1. `compactRequired` 硬编码 false — auto-compact 死链路

- **严重级别**: high
- **类型**: correctness
- **是否 blocker**: yes
- **事实依据**:
  - `workers/agent-core/src/host/orchestration.ts:296`: `compactRequired: false,`
  - `workers/agent-core/src/host/orchestration.ts:429`: `compactRequired: false,`
  - `workers/agent-core/src/kernel/scheduler.ts:50`: scheduler 已检查 `signals.compactRequired` 的逻辑路径存在
  - `workers/context-core/src/control-plane.ts:176` (`resolveBudget`): budget 计算逻辑完善，能基于 `auto_compact_token_limit` / `effective_context_pct` 判断是否需要 compact
  - `workers/orchestrator-core/src/context-control-plane.ts:315-340`: `readContextDurableState` 能返回完整的 token usage 估算
- **为什么重要**:
  - charter §7.4 HP3 将 auto-compact 列为 In-Scope，要求 "compactRequired 信号由 model metadata 驱动"。当前实现了全套 budget 计算和控制面（probe/preview），但运行时永远不会走自动压缩分支。这意味着长对话真正超出 context window 时，不会自动触发 compact，LLM 调用将直接失败或溢出。
  - 这是一个典型的 "infrastructure complete but not triggered" 模式，与 F12 hook dispatcher 的五阶段慢性 carryover 性质相似。
- **审查判断**: 在 auto-compact 未真实接入 runtime 信号的情况下，宣称 "context state machine first wave done" 是成立的（因为 control-plane 确实 live），但与 charter 全局目标（G3/G4/G5 闭环）有显著距离。
- **建议修法**:
  1. 在 `runtime-mainline.ts` 的 LLM call 前累积 estimated prompt tokens（利用 context-plane 的 budget 估算逻辑，或直接在 agent-core 内做简单字节启发式）。
  2. 与 model metadata 的 `auto_compact_token_limit` 比较，超过阈值时设 `compactRequired: true`。
  3. kernel scheduler 收到 `compactRequired` 后触发 `CompactDelegate.requestCompact()`。

### R2. `checkpoint-restore-plane.ts` 无 HTTP 路由 — wire-without-delivery

- **严重级别**: high
- **类型**: delivery-gap
- **是否 blocker**: yes
- **事实依据**:
  - `workers/orchestrator-core/src/checkpoint-restore-plane.ts`: 544 行完整实现，包含 `RESTORE_MODES`（conversation_only / files_only / conversation_and_files / fork）、restore job 状态机、rollback 逻辑（Q24 seed baseline checkpoint）、snapshot lineage 追踪等
  - `workers/orchestrator-core/src/index.ts`: grep "restore" 返回 0 条结果 — 无任何 HTTP 路由注册
  - `clients/api-docs/session.md:203`: 诚实标注 "`/restore` 仍未开放"
  - `workers/orchestrator-core/migrations/013-product-checkpoints.sql`: `nano_checkpoint_restore_jobs` 表已存在
- **为什么重要**:
  - 这是 hero-to-pro 阶段最危险的 pattern 复现——F12（hook dispatcher 五阶段 wire 完整但无调用方）和 F13（pushServerFrameToClient round-trip 四阶段无 e2e）都是因为 "基础设施已落但对外不可达" 而成为慢性 carryover。checkpoint-restore-plane 正在重演这个模式。
  - 544 行的 restore plane 实现质量不低，但如果 HTTP 路由不注册，HP4 checkpoint registry（list/create/diff）的工作就成了 "只有保存入口没有恢复出口" 的半截产品面。
- **审查判断**: 建议在 HP4 后续批次或 HP7 中将 restore 路由上线。如果确定 defer 到 HP7，必须在 `index.ts` 中显式标注或在 HP4 closure §5 下游交接中明确说明状态。
- **建议修法**:
  1. 选项 A（推荐，如果 HP4 后续批次有资源）: 注册 `POST /sessions/{id}/checkpoints/{checkpoint_uuid}/restore { mode: "conversation_only" }` 路由，使用已存在的 `checkpoint-restore-plane.ts` 逻辑。
  2. 选项 B: 如果确定 defer 到 HP7，在 `checkpoint-restore-plane.ts` 文件顶部添加注释说明 "Route registration deferred to HP7" 并在 HP4 closure §2 中显式说明原因。

### R7. agent-core ↔ orchestrator-core 模型状态传递断裂

- **严重级别**: high
- **类型**: correctness
- **是否 blocker**: yes
- **事实依据**:
  - `workers/orchestrator-core/src/user-do/message-runtime.ts:222-260`: 完整实现了 `requestedModel ?? sessionDefaultModel ?? globalDefaultModel` 三层解析链，结果写入 `selectedModelId` 并传递到 `handleFollowupMessage`
  - `workers/orchestrator-core/src/user-do/durable-truth.ts`: `recordTurnStart()` 写入 `requested_model_id`，`recordTurnEnd()` 回填 `effective_model_id` + `fallback_used` + `fallback_reason` 到 D1
  - `workers/agent-core/src/host/runtime-mainline.ts:218-237`: `readLlmRequestEvidence()` 从 message payload 提取 `modelId` 和 `reasoning.effort`，但这是在 agent-core 内部进行的独立推断，不从 D1 反查 session-level default
  - `workers/agent-core/src/host/runtime-mainline.ts:355-368`: LLM 调用前读取 `base_instructions_suffix` 并注入 system prompt — 这是 HP4 action-plan §12 review-fix 完成的工作
  - 关键 gap: **session-level `default_model_id` 从未以结构化方式传递到 agent-core 的 LLM 调用入口**
- **为什么重要**:
  - 用户通过 `PATCH /sessions/{id}/model` 修改了 session default model 后，如果后续 `/messages` 不带显式 `model_id`，orchestrator-core 会正确将 session default 作为 selected model 并发起 LLM 调用。但这依赖的是 orchestrator-core 在 `/messages` handler 内完成的组装——如果 agent-core 有独立于 orchestrator-core 的 LLM 调用路径（如 resume/重试），session default 可能丢失。
  - 更关键的是: charter 声称 "4 层模型状态机闭环" 但它不完整——turn 层 request/effective 在 D1 可查，但 session default 在 agent-core runtime 内部不可直接获取。这使 `CrossTurnContextManager` 的实现变得更复杂（它需要知道自己应该以什么模型去思考）。
- **审查判断**: 这不是一个会造成立刻 crash 的 bug（因为 orchestrator-core 作为 façade 主路径已正确处理），但它是产品状态机的一个架构债务：4 层模型的第 2 层（session default）在 agent-core 内部不可知。HP3 的 `CrossTurnContextManager` 和 HP4 的 restore/retry 都可能因此需要反向查询 D1。
- **建议修法**:
  1. 在 `MainlineKernelOptions` 中添加 `modelDefaults: { modelId?: string; reasoning?: string }` 字段。
  2. 在 `runtime-assembly.ts` 的 `createLiveKernelRunner` 调用链中，从 session lifecycle 读取 `default_model_id` / `default_reasoning_effort` 并传入。
  3. 在 `runtime-mainline.ts` 的 LLM 调用前优先使用传入的 session default，再 fallback 到 message payload 自提取的 modelId。

### R8. `clients/api-docs/` 散落更新违反 charter §4.4 纪律 3

- **严重级别**: medium
- **类型**: scope-drift
- **是否 blocker**: no
- **事实依据**:
  - `docs/charter/plan-hero-to-pro.md` §4.4 纪律 3: "HP2-HP8 不更新 clients/api-docs/（允许写 design 文档作为内部参考），HP9 一次性集中更新 18 份"
  - `docs/issue/hero-to-pro/HP2-closure.md` §7: "clients/api-docs updated（README.md / session.md / error-index.md 已同步 HP2 first-wave surface）"
  - `docs/issue/hero-to-pro/HP3-closure.md` §7: "clients/api-docs updated（session.md / README.md 已同步新的 context route matrix）"
  - `docs/issue/hero-to-pro/HP4-closure.md` §7: "clients/api-docs updated（README.md / me-sessions.md / session.md / error-index.md 已同步 HP4 first-wave surface）"
- **为什么重要**:
  - 经核查，更新内容与代码事实对齐良好——没有发现 stub 残留、错误声明或不实 endpoint 描述。文档质量本身没有问题。
  - 但纪律漂移本身值得关注：如果执行者在 HP2-HP4 散落更新 `clients/api-docs/`，到了 HP6/HP7 可能继续这个模式。HP9 的 "一次性集中 review" 目标可能变为 "review 已经在各 phase 中半散打完成的文档"。
  - charter §4.4 纪律 3 的原始意图之一是 `避免 phase 内"先做完再写文档"的 stub-doc 漂移 + 每 phase 都要 review 文档的成本爆炸`。HP2-HP4 的执行并未产生 stub-doc 漂移（文档诚实标注 gap），但确实产生了 "每 phase 都 review 文档的成本"。
- **审查判断**: 不需要回滚已有的文档更新（因为它们是对齐的且诚实的），但建议在 HP5-HP8 执行中严格遵守 charter 纪律——不再更新 `clients/api-docs/` 直到 HP9。
- **建议修法**:
  1. HP2/HP3/HP4 closure 在 §7 中标注此纪律漂移（self-aware）。
  2. HP5-HP8 强制遵守，不更新 `clients/api-docs/`。
  3. HP9 启动时以 HP8 代码 freeze 版本为基准做 18 份文档的全面对齐。

### R9. HP3 action-plan 文档状态标注错误

- **严重级别**: low
- **类型**: docs-gap
- **是否 blocker**: no
- **事实依据**:
  - `docs/action-plan/hero-to-pro/HP3-action-plan.md` 第 29 行: `文档状态: draft`
  - 同一文件第 469-482 行包含完整的工作日志回填（12 条详细日志），内容覆盖 HP3 first-wave 全部工作
  - 对比 HP2 action-plan（标注 `executed`）和 HP4 action-plan（标注 `executing`），HP3 的标注不一致
- **为什么重要**: 低优先级，但可能误导后续读者认为 HP3 尚未执行
- **审查判断**: 纯粹的文档标注疏忽
- **建议修法**: 将 `draft` 改为 `executed`（或与 HP4 一致使用 `executing` 表示仍有后续批次工作）

### R10. 全部 HP2-HP5 cross-e2e 未执行

- **严重级别**: medium
- **类型**: test-gap
- **是否 blocker**: no（但必须在宣称 phase 闭合前完成）
- **事实依据**:
  - HP2 closure §6: `pnpm test:cross-e2e: not run`
  - HP3 closure §6: `pnpm test:cross-e2e: not run`
  - HP4 closure §6: `pnpm test:cross-e2e: not run`
  - HP5 closure §6: `pnpm test:cross-e2e (15-18): not run`
  - `test/cross-e2e/` 目录中无 HP2-HP5 对应的 e2e 测试文件
- **为什么重要**:
  - charter §9.4 规定多条 "证据不足时不允许宣称的内容"，包括 "Cross-turn history 必须有 turn1→turn2 LLM 引用 e2e"、"compact 真实运行必须有 long-conversation e2e"
  - 虽然 closures 均诚实标注 `not run`，但缺少 e2e 意味着在真实 6-worker 链路中无法证明新端点与 runtime 行为一致
  - 没有 cross-e2e 保护的 "first wave done" 是脆弱的——单包测试无法覆盖跨 worker RPC、DO lifecycle、WS push 等场景
- **审查判断**: 在 HP2-HP4 first wave 阶段不要求 cross-e2e（单包测试覆盖了 route/schema/truth），但在 phase 最终 closure 前（full HP2/HP3/HP4 done），cross-e2e 是不可跳过的硬闸
- **建议修法**: 在 HP5 后续批次补齐 HP2-HP5 的全部 cross-e2e（含 HP5 的 15-18）

---

## 3. In-Scope 逐项对齐审核

> 本节逐项对照 action-plan 中的业务工作项，以代码事实判定完成度。

### 3.1 HP2 逐项对齐

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| P1-01 | model detail API (`GET /models/{id}`) | `done` | `index.ts:2187-2225`，支持 encoded id + alias，expose HP1 10 个 metadata 字段 |
| P1-02 | session current model API (`GET/PATCH /sessions/{id}/model`) | `done` | `index.ts:2227-2331`，含 set/clear/reasoning，409 on ended/expired |
| P1-03 | alias resolve + clear semantics | `done` | `session-truth.ts:421-471` alias resolve；`{ model_id: null }` 清回 global default |
| P2-01 | requested/effective/fallback durable audit | `done-first-wave` | `message-runtime.ts:222-260` 三层链；`durable-truth.ts` turn 写回；`fallback_used`/`fallback_reason` 列存在但值始终 `false`/`null`（因为无真 fallback 触发） |
| P2-02 | canonical request explicit model wiring | `partial` | agent-core `runtime-mainline.ts:355-368` 已读 `base_instructions_suffix` 但模型传递路径弱（见 R7） |
| P3-01 | `<model_switch>` developer message | `missing` | agent-core 中完全不存在 |
| P3-02 | `model.fallback` stream event | `missing` | nacp-session `stream-event.ts` 中不存在 |
| P4-01 | cross-e2e matrix (5+ 用例) | `missing` | 未执行 |
| P4-02 | HP2 closure | `partial` | closure 诚实标注 `partial-live` |

### 3.2 HP3 逐项对齐

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| P1-01 | façade context surface refactor | `done` | 7 个细分路由（probe/layers/snapshot/compact-preview/compact/compact-job/legacy alias）已 live |
| P1-02 | context-core RPC destub | `done` | 所有 RPC 不再返回 `phase: "stub"`，全部走真实 durable truth |
| P2-01 | `CrossTurnContextManager` | `missing` | agent-core 中不存在 |
| P2-02 | assembler contract reuse | `done` | `ContextAssembler` canonical layer ordering (`CANONICAL_LAYER_ORDER`) 被 context-core probe 与 control-plane 共享 |
| P3-01 | model-aware auto-compact | `partial` | budget 计算逻辑完善（`resolveBudget` in `control-plane.ts:176`），但 `compactRequired` 硬编码 false（R1） |
| P3-02 | manual compact preview/job | `done` | preview 只读 + `would_create_job_template` hint + compact 写 `compact_boundary` checkpoint + `/compact/jobs/{id}` 跨 worker 重读 |
| P4-01 | strip-then-recover contract | `partial` | `PROTECTED_FRAGMENT_TAGS = ["model_switch", "state_snapshot"]` 在 preview/job payload 中登记，但未接回下一次真实 prompt |
| P4-02 | circuit breaker | `missing` | 不存在 3 次失败 breaker |
| P5-01 | long-conversation e2e | `missing` | 未执行 |
| P5-02 | HP3 closure | `partial` | closure 诚实标注 `partial-live` |

### 3.3 HP4 逐项对齐

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| P1-01 | lifecycle route surface | `done` | `POST /close` / `DELETE /{id}` / `PATCH /title` 三个路由均在 `index.ts` 注册 |
| P1-02 | terminal/tombstone durable semantics | `done` | close 写 `ended_reason=closed_by_user` + delete 写 `deleted_at` + title 写 `nano_conversations.title` |
| P2-01 | latest-turn retry | `missing` | 不存在 |
| P2-02 | true cursor read models | `done` | `/me/sessions` + `/me/conversations` 改为 direct D1 cursor；`GET /conversations/{id}` 已 live |
| P3-01 | checkpoint registry surface | `done` | `GET/POST /sessions/{id}/checkpoints` 消费 D1 checkpoint registry |
| P3-02 | checkpoint diff | `done` | `GET .../checkpoints/{id}/diff` 返回 message supersede diff |
| P4-01 | restore job orchestration | `partial` | `checkpoint-restore-plane.ts` 544 行逻辑存在，但无 HTTP 路由（R2） |
| P4-02 | rollback + restart safety | `partial` | 同样在 `checkpoint-restore-plane.ts` 中实现了 rollback 逻辑但无路由 |
| P5-01 | lifecycle/retry/restore e2e | `missing` | 未执行 |
| P5-02 | HP4 closure | `partial` | closure 诚实标注 `partial-live` |

### 3.4 HP5 逐项对齐（简要核查）

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| — | D1ConfirmationControlPlane | `done` | 7-kind / 6-status 注册、list/read/create/applyDecision |
| — | `/confirmations` 三件套 API | `done` | list (含 `?status=` filter) / detail / decision 409 冲突 |
| — | `session.confirmation.*` 帧族 | `done` | `request` / `update` + direction matrix + phase 矩阵 |
| — | kernel `confirmation_pending` | `done` | `approval_pending` 完全淘汰 |
| — | HookDispatcher 真注入 | `done` | `runtime-assembly.ts:465` 无条件构造，暴露在 assembly interface |
| — | PreToolUse emitter live caller | `missing` | emitter 侧 row-create 未接通（closure 坦承） |
| — | cross-e2e 15-18 | `missing` | 未执行（closure 坦承） |

### 3.5 对齐结论

- **done**: 20 项
- **partial**: 7 项（P2-02(runtime wiring)、P3-01(auto-compact)、P4-01(strip-recover)、P4-01/P4-02(restore)、emitter caller）
- **missing**: 8 项（P3-01(switch msg)、P3-02(fallback event)、P4-01(e2e HP2)、P2-01(context manager)、P4-02(breaker)、P5-01(e2e HP3)、P2-01(retry)、P5-01(e2e HP4)）
- **stale**: 0 项
- **out-of-scope-by-design**: 0 项

> **一句话总结**: 这更像 "所有 first-wave control plane 骨架完成，但 runtime enforcement / transport / semantic injection 仍未收口"，而非 completed。每个 phase 的 closure 自评 `partial-live` 是准确和诚实的。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Multi-provider routing | `遵守` | 代码中无任何 multi-provider 逻辑 |
| O2 | Sub-agent / multi-agent | `遵守` | 不存在 |
| O3 | Admin plane / billing | `遵守` | 不存在 |
| O4 | Session fork (HP4 scope) | `遵守` | `checkpoint-restore-plane.ts` 中有 fork 逻辑但归 HP7，不在 HP4 scope 内；HP4 只做了 conversation_only |
| O5 | File revert / files_only restore | `遵守` | 仅 `checkpoint-restore-plane.ts` 有类型定义，无执行逻辑 |
| O6 | Permission/elicitation 旧端点物理删除 | `遵守` | legacy endpoints 保留 compat redirect |
| O7 | 自动 session title LLM 生成 | `遵守` | 不存在 |
| O8 | `forwardInternalJsonShadow` 物理删除 | `遵守` | charter 要求保留至 HP10（R29 postmortem 后判定），当前仍保留且注释说明 "historical naming retention" |
| O9 | `parity-bridge.ts` 物理删除 | `遵守` | charter 要求保留至 HP10，当前仍保留 |
| O10 | 新建 `nano_compact_jobs` 表 | `遵守` | 复用 `compact_boundary` checkpoint UUID，未新增表 |
| O11 | close 新增 `closed` 状态 | `遵守` | 正确复用 `ended + ended_reason=closed_by_user`（Q13） |

---

## 5. 跨阶段跨包深度分析

### 5.1 模型状态链的跨包断裂

这是本轮审查发现的最深层问题。4 层模型状态机（global default → session default → turn override → effective+fallback）在代码中的现状是:

**orchestrator-core 侧（完整）**:
```
session-truth.ts:
  readGlobalDefaultModelForTeam()    —— 第 1 层
  readSessionModelState()            —— 第 2 层（从 D1 nano_conversation_sessions.default_model_id）
  message-runtime.ts:
    handleFollowupMessage()          —— 第 3 层（从 message body model_id）+ 三层链组合
  durable-truth.ts:
    recordTurnStart() / recordTurnEnd() —— 第 4 层（D1 写回）
```

**agent-core 侧（不完整）**:
```
runtime-mainline.ts:
  readLlmRequestEvidence()           —— 只从 message payload 自提取 modelId
  buildWorkersAiExecutionRequestFromMessages() —— 未接收 session-level default
```

session default 在 agent-core 内部是一个盲区。这意味着:
1. 如果 `CrossTurnContextManager` 未来需要独立的 LLM 调用（如 compact summary），它不知道当前 session 的默认模型是什么
2. 如果 retry/resume 路径绕过了 orchestrator-core 的完整 handler 而直接从 agent-core 发起调用，session default 丢失
3. `PATCH /sessions/{id}/model` 修改 session default 后，agent-core 在下一次 LLM 调用时可能不知道这个变更（除非这个变更通过 message body 再次传递到 agent-core）

### 5.2 compact 逻辑的三层割裂

context compact 在三个包中处于三种状态:

| 包 | compact 状态 | 说明 |
|----|-------------|------|
| `context-core` | **完整** | budget 计算、probe/layers/preview/job 全部实现 |
| `orchestrator-core` | **完整** | 路由注册、durable truth 写回、stream event emit |
| `agent-core` | **死链路** | `compactRequired: false` 硬编码，无 compact manager |

这造成了 "查看 compact 状态（probe/preview）和手动触发 compact 可以正常工作，但 LLM 运行时不会自动触发 compact" 的产品行为。对用户来说: 长对话中如果接近 context window 上限，不会收到任何预警或自动压缩——除非用户主动发出 compact preview → compact 请求。

### 5.3 checkpoint-restore: 又一个 wire-without-delivery

`checkpoint-restore-plane.ts`（544 行）的代码质量不低，实现了完整的 restore 状态机（pending/running/succeeded/partial/failed/rolled_back）、4 种 restore mode、rollback baseline checkpoint（Q24）、snapshot 物化跟踪。但它没有 HTTP 路由。

这种行为模式与以下历史教训完全一致:
- **F12 hook dispatcher**: ZX5 → RH6 五阶段 silently 漂着，因为 `hooks/permission.ts` 存在但无调用方
- **F13 pushServerFrameToClient**: 路径存在但无 round-trip e2e

hero-to-pro charter 中明确提出的 "wire-without-delivery 不算闭合" 方法论（§5）和纪律（§4.4 纪律 2），但 checkpoint-restore-plane 正在重复这个模式。

### 5.4 NACP 协议 13 种消息 + backward compat 检查

核查确认:
- 现有 13 种 NACP 消息未被破坏
- HP5 新增 `session.confirmation.request` 和 `session.confirmation.update` 两个 server→client 帧，正确注册在 `SERVER_MESSAGE_SCHEMAS` 中
- direction matrix 新增了 confirmation 帧的 phase/direction/role 约束（server→client only）
- permission/elicitation 旧端点保留为 compat alias
- ✅ NACP backward compat 纪律严格遵守

### 5.5 Migration 文件完备性检查

| 编号 | 文件名 | 对应 charter 交付物 | 状态 |
|------|--------|---------------------|------|
| 007 | model-metadata-and-aliases | model 10 列 + aliases | ✅ |
| 008 | session-model-audit | session.default_* + turn 审计 | ✅ |
| 009 | turn-attempt-and-message-supersede | turn_attempt + supersede + deleted_at | ✅ |
| 010 | agentic-loop-todos | nano_session_todos | ✅ |
| 011 | session-temp-files-and-provenance | nano_session_temp_files + provenance | ✅ |
| 012 | session-confirmations | nano_session_confirmations | ✅ |
| 013 | product-checkpoints | checkpoints + snapshots + restore_jobs + cleanup_jobs | ✅ |
| 014 | session-model-fallback-reason | fallback_reason 列 (HP2 correction) | ✅ 按 charter §4.4 R8 受控例外 |

HP2 closure §1 R6 显式登记了 `014` 作为 HP1 schema correction，符合 charter 受控例外流程。DDL Freeze 纪律基本遵守。

### 5.6 API docs (`clients/api-docs/`) 逐份审计

| 文件 | 行数 | 与代码对齐 | 发现问题 |
|------|------|-----------|----------|
| `README.md` | 137 | ✅ | HP2-HP4 路由完整登记，含 "⚠️ 仍未开放" 标注 |
| `session.md` | 897 | ✅ | 所有 HP2-HP4 端点均有准确描述和 payload 示例；诚实标注 `<model_switch>` / `model.fallback` / `/retry` / `/restore` 未开放 |
| `auth.md` | ~200 | ✅ | 未被 HP2-HP4 改动 |
| `catalog.md` | ~40 | ✅ | 未被 HP2-HP4 改动 |
| `error-index.md` | ~350 | ✅ | 新增错误码已登记 |
| `me-sessions.md` | ~130 | ✅ | 已反映 cursor read model 变更 |
| `permissions.md` | ~150 | ✅ | 未被 HP2-HP4 改动 |
| `session-ws-v1.md` | ~150 | ✅ | 未被 HP2-HP4 改动 |
| `usage.md` | ~100 | ✅ | 未被 HP2-HP4 改动 |
| `wechat-auth.md` | ~100 | ✅ | 未被 HP2-HP4 改动 |
| `worker-health.md` | ~150 | ✅ | 未被 HP2-HP4 改动 |

**总体评价**: 11 份文档与代码对齐全橘，无不实声明，无 stub 残留。这是 "文档晚期收口" 纪律虽被打破但结果尚可的情况。

### 5.7 命名规范与执行逻辑一致性

**正面发现**:
- `fallback_reason` column 在 migration 014 中加入，D1 schema 使用 snake_case 与全仓一致
- `ended_reason` 通过 `closed_by_user` / `completed` / `cancelled` / `error` 四个 enum 值表达，语义清晰
- `ended` / `expired` / `active` / `detached` / `starting` / `pending` 六个 session_status 值使用一致
- 新文件（`context-control-plane.ts`、`checkpoint-restore-plane.ts`、`confirmation-control-plane.ts`）都采用 `*-plane.ts` 命名模式，一致性良好
- NACP 帧族命名: `session.confirmation.request/update` 遵循 `{domain}.{entity}.{action}` 现有约定

**问题发现**:
- `runtime-mainline.ts:218-222` 同时检查 `message.model_id` 和 `message.modelId`（camelCase fallback）——后者在 nacp-session schema 中并非官方字段，这是对旧消息格式的残留兼容
- HP3 action-plan 标注 `draft` 但实际已执行（见 R9）

### 5.8 残留代码回收与 charter 纪律遵守

| 项目 | charter 要求 | 当前状态 | 判定 |
|------|-------------|----------|------|
| `forwardInternalJsonShadow` | 保留至 HP10（HP0 closure 要求） | 保留，注释 "historical naming retention" | ✅ 遵守 |
| `parity-bridge.ts` | 保留至 HP10（HP0 closure 要求） | 保留，注释 "reference implementation deliberate retention" | ✅ 遵守 |
| `docs/runbook/zx2-rollback.md` | HP0 物理删除 | 已删除（确认不存在） | ✅ 遵守 |
| CONTEXT_CORE binding | HP0 verify | binding-presence test 存在且通过 | ✅ 遵守 |
| `LANE_E_RPC_FIRST=false` | HP0 verify | binding-presence test 断言存在 | ✅ 遵守 |
| `clients/api-docs/` 更新节奏 | 仅 HP9 更新 | HP2/HP3/HP4 散落更新 | ⚠️ 违反 §4.4 纪律 3（见 R8） |
| DDL 新 migration | 仅 HP1 集中 | HP1 007-013 + HP2 014 correction（受控例外） | ✅ 基本遵守 |

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**: HP2-HP4 first wave 的实现质量可接受——所有 `done-first-wave` 标记的交付物均在代码中找到对应实现且通过单包测试。但存在 3 个必须在 next batch 中解决的 blocker（R1 compactRequired 死链路、R2 checkpoint-restore 无路由、R7 模型状态跨包传递断裂），以及多项 closure 已坦承的未完成项。**当前不应宣称任一个 HP 阶段为 `completed`。**

- **是否允许关闭本轮 review**: `no`

- **关闭前必须完成的 blocker**:
  1. **R1**: 解除 `orchestration.ts:296,429` 的 `compactRequired: false` 硬编码，接入真实 budget 信号使 auto-compact 可触发（或在 HP3 closure 中显式 defer 到后续批次并有明确的实现 plan）。
  2. **R2**: `checkpoint-restore-plane.ts` 注册 HTTP 路由或在 HP4 closure §2 中显式说明 defer 状态（包含: defer 到哪个 phase、当前 544 行代码哪些可用、哪些需要修订、是否有 merge conflict 风险）。
  3. **R7**: 建立 agent-core 与 orchestrator-core 之间的结构化模型状态传递通道（至少提供 session-level `default_model_id` 作为 `MainlineKernelOptions` 参数）。

- **可以后续跟进的 non-blocking follow-up**:
  1. R3: `<model_switch>` developer message 注入（HP2 后续批次）
  2. R4: `model.fallback` stream event 新增（HP2 后续批次）
  3. R5: `CrossTurnContextManager` 实现（HP3 后续批次）
  4. R6: retry 路由实现（HP4 后续批次）
  5. R8: `clients/api-docs/` 散打纪律在 HP5-HP8 中恢复遵守
  6. R9: HP3 action-plan 文档状态修正
  7. R10: HP2-HP5 cross-e2e 补齐
  8. R12: confirmation emitter 侧 row-create 接通（HP5 后续批次）

- **建议的二次审查方式**: `same reviewer rereview` — 在 3 个 blocker 修复后重新审查相关文件

- **实现者回应入口**: `请按 docs/templates/code-review-respond.md 在本文档 §7 append 回应，不要改写 §0–§6。`

---

## 7. 附录: 补充验证结果

### 7.1 单元测试完整矩阵

| 包 | 测试文件数 | 测试数 | 状态 |
|----|----------|--------|------|
| `@haimang/orchestrator-core-worker` | 32 | 300 | ✅ |
| `@haimang/agent-core-worker` | 103 | 1,077 | ✅ |
| `@haimang/context-core-worker` | 20 | 178 | ✅ |
| `@haimang/nacp-session` | 18 | 191 | ✅ |
| **总计** | **173** | **1,746** | **全部通过** |

### 7.2 新增测试文件（HP2-HP5 期间）

| 文件 | 行数 | 覆盖内容 |
|------|------|----------|
| `orchestrator-core/test/models-route.test.ts` | 300 | model detail API |
| `orchestrator-core/test/session-model-route.test.ts` | 326 | session model GET/PATCH |
| `orchestrator-core/test/migrations-schema-freeze.test.ts` | - | schema correction 验证 |
| `orchestrator-core/test/context-route.test.ts` | - | context surface wiring |
| `orchestrator-core/test/me-sessions-route.test.ts` | - | cursor read model |
| `orchestrator-core/test/me-conversations-route.test.ts` | - | conversation cursor + detail |
| `orchestrator-core/test/chat-lifecycle-route.test.ts` | - | close/delete/title routes |
| `orchestrator-core/test/user-do-chat-lifecycle.test.ts` | - | lifecycle user-do handlers |
| `orchestrator-core/test/confirmation-control-plane.test.ts` | - | confirmation registry (10 tests) |
| `orchestrator-core/test/confirmation-route.test.ts` | - | confirmation routes (7 tests) |
| `orchestrator-core/test/confirmation-dual-write.test.ts` | - | dual-write law (5 tests) |
| `context-core/test/rpc-context-control-plane.test.ts` | - | context RPC surface |
| `agent-core/test/host/system-prompt-seam.test.ts` | - | model suffix seam |
| `agent-core/test/host/runtime-mainline.test.ts` | - | runtime model wiring |
| `agent-core/test/llm/gateway.test.ts` | - | explicit modelId/reasoning |
| `agent-core/test/host/do/runtime-assembly.dispatcher.test.ts` | - | HookDispatcher injection (2 tests) |
| `nacp-session/test/hp5-confirmation-messages.test.ts` | - | confirmation frames (18 tests) |

### 7.3 设计文档完备性

| 文件 | 状态 |
|------|------|
| `docs/design/hero-to-pro/HP0-pre-defer-fixes.md` | ✅ |
| `docs/design/hero-to-pro/HP1-schema-extension.md` | ✅ |
| `docs/design/hero-to-pro/HP2-model-state-machine.md` | ✅ |
| `docs/design/hero-to-pro/HP3-context-state-machine.md` | ✅ |
| `docs/design/hero-to-pro/HP4-chat-lifecycle.md` | ✅ |
| `docs/design/hero-to-pro/HP5-confirmation-control-plane.md` | ✅ |
| `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md` | ✅ |
| `docs/design/hero-to-pro/HP7-checkpoint-revert.md` | ✅ |
| `docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md` | ✅ |
| `docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md` | ✅ |
| `docs/design/hero-to-pro/HP10-final-closure-and-cleanup.md` | ✅ |
| `docs/design/hero-to-pro/HPX-qna.md` | ✅ |
| `docs/architecture/hero-to-pro-schema.md` | ✅ |

### 7.4 此次审查未核查的项目（已知限制）

- `pnpm test:cross-e2e`: 所有 closure 均标注未运行，本轮审查也未执行
- Live preview deploy 验证: 未执行（需要 Workers AI binding + D1 remote + R2 binding 等完整环境）
- DO checkpoint restore 一致性 e2e: 需要在真实 Workers runtime 中验证，单包测试无法覆盖
