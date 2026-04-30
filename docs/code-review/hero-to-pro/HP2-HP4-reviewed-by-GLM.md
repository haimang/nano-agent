# Nano-Agent 代码审查 — HP2/HP3/HP4 实现审查 + hero-to-pro 跨阶段深度分析

> 审查对象: `HP2-action-plan.md` + `HP3-action-plan.md` + `HP4-action-plan.md` 及其代码实现与三份 closure + HP5 closure 对照
> 审查类型: `mixed`（代码 + 文档 + closure + 跨阶段分析）
> 审查时间: `2026-04-30`
> 审查人: `GLM`
> 审查范围:
> - `workers/orchestrator-core/src/session-truth.ts` — HP2 model control plane + HP4 read model
> - `workers/orchestrator-core/src/context-control-plane.ts` — HP3 context control plane
> - `workers/orchestrator-core/src/session-lifecycle.ts` — HP4 lifecycle body schema
> - `workers/orchestrator-core/src/index.ts` — HP2/HP3/HP4 全部 façade route
> - `workers/orchestrator-core/src/user-do/session-flow.ts` — HP4 lifecycle handlers
> - `workers/context-core/src/control-plane.ts` + `index.ts` — HP3 RPC destub
> - `workers/agent-core/src/host/runtime-mainline.ts` — HP2 model wiring + suffix consumption
> - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` — HP5 HookDispatcher injection
> - `workers/agent-core/src/kernel/types.ts` + `interrupt.ts` — HP5 confirmation_pending rename
> - `packages/nacp-session/src/messages.ts` + `stream-event.ts` — HP5 confirmation frames
> - `workers/orchestrator-core/migrations/007-014` — HP1-HP2 schema 整体链路
> - `workers/orchestrator-core/src/confirmation-control-plane.ts` — HP5 confirmation registry
> - `test/cross-e2e/` — HP2/HP3/HP4/HP5 e2e 覆盖
> - `clients/api-docs/` — 客户端文档漂移核查
> - `docs/issue/hero-to-pro/HP2-closure.md` + `HP3-closure.md` + `HP4-closure.md` + `HP5-closure.md`
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md` §7.3 HP2 + §7.4 HP3 + §7.5 HP4 + §7.6 HP5
> - `docs/action-plan/hero-to-pro/HP2-action-plan.md` + `HP3-action-plan.md` + `HP4-action-plan.md`
> - `docs/design/hero-to-pro/HPX-qna.md` Q7-Q9 / Q10-Q12 / Q13-Q15 / Q16-Q18（只读引用）
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`HP2/HP3/HP4 的代码实现忠实执行了各 action-plan 第一波(first wave)的收口范围，核心 control plane / read model / lifecycle surface 已落地且可被后续 phase 消费。但三份 closure 均以 partial-live 标记，且 HP2 的 <model_switch> 与 model.fallback、HP3 的 CrossTurnContextManager 与 auto-compact、HP4 的 retry 与 restore job 均未收口。跨阶段审查发现 HP2→HP3→HP4 存在 7 处实质性断点与盲点，clients/api-docs 与代码存在 17 处漂移（含 7 处端点缺失），以及 1 处 charter 约束违反（api-docs 提前更新 vs charter D7 后置纪律）。`
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`yes`（first wave 各 closure 的 partial-live 标记正确，不构成 blocker；但 followup 项必须在后续批次补齐）
- **本轮最关键的 3 个判断**：
  1. HP2/HP3/HP4 first wave 的核心骨架（model control plane / context control plane / lifecycle surface）已真实落地且与 D1 truth 对齐，可以安全推进后续批次
  2. 三份 closure 均诚实地标为 partial-live 而非伪装完成，这是本审查最关键的正面判断——没有 deceptive closure
  3. 跨阶段最大断点是 HP3 的 `CrossTurnContextManager` 与 `auto-compact runtime 触发` 均未接入，导致长对话仍然依赖偶然窗口残留而非显式 cross-turn history，这直接影响 charter §9.4 G5 "cross-turn history e2e" 证据门槛

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-hero-to-pro.md` §7.3-§7.6（HP2/HP3/HP4/HP5 详细说明）
  - `docs/action-plan/hero-to-pro/HP2-action-plan.md` §1-§8
  - `docs/action-plan/hero-to-pro/HP3-action-plan.md` §1-§8
  - `docs/action-plan/hero-to-pro/HP4-action-plan.md` §1-§8
  - `docs/issue/hero-to-pro/HP2-closure.md` + `HP3-closure.md` + `HP4-closure.md` + `HP5-closure.md`
- **核查实现**：
  - `workers/orchestrator-core/src/session-truth.ts` — 1897 行，逐项核查 HP2 model control plane helper 与 HP4 read model
  - `workers/orchestrator-core/src/context-control-plane.ts` — 561 行，核查 HP3 context durable state 聚合逻辑
  - `workers/orchestrator-core/src/index.ts` — 2886 行，核查全部新增 façade route
  - `workers/context-core/src/control-plane.ts` — 512 行，核查 probe/layers/preview/job 组装
  - `workers/context-core/src/index.ts` — 368 行，核查 RPC destub 与 WorkerEntrypoint
  - `workers/agent-core/src/host/runtime-mainline.ts` — 636 行，核查 model wiring 与 suffix consumption
  - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` — 480 行，核查 HookDispatcher 注入
  - `workers/agent-core/src/kernel/types.ts` — 185 行，核查 confirmation_pending rename
  - `packages/nacp-session/src/messages.ts` — 474 行，核查 confirmation/todo frame family
  - `packages/nacp-session/src/stream-event.ts` — 135 行，核查 CompactNotifyKind 与 ToolCallCancelledKind
  - `workers/orchestrator-core/migrations/007-014` — 全部 8 个 migration 文件
  - `clients/api-docs/` — 全部 11 个文档文件
  - `test/cross-e2e/` — 全部 15 个测试文件
- **执行过的验证**：
  - 逐路由核对 `index.ts` 新增 route 与 façade 解析逻辑
  - 逐 migration 核对 schema 字段与代码消费一致性
  - 核对 NACP 消息族 7-kind / 6-status 与代码 CODE 硬编码一致性
  - 核对 `context-core` RPC 不再返回 `phase: "stub"`
  - 核对 HP5 confirmation registry / API / frame / kernel / dispatcher 各层对齐
- **复用 / 对照的既有审查**：
  - `docs/code-review/hero-to-pro/HP0-HP1-reviewed-by-GLM.md` — 沿用其对 migration 与 schema 的审查结论，不再重复

### 1.1 已确认的正面事实

- HP2 model control plane first wave 已真实落地：`GET /models/{id}`（含 alias resolve）、`GET/PATCH /sessions/{id}/model`、`session-truth.ts` 中的 `resolveModelForTeam()` / `readSessionModelState()` / `DurableModelDetail` / fallback_reason audit 全部可执行
- HP2 `014-session-model-fallback-reason.sql` 按 charter R8 受控例外流程补出，未违 HP1 DDL Freeze 纪律
- HP3 context control plane first wave 已真实落地：`context-control-plane.ts` 聚合 durable state、`context-core/control-plane.ts` 组装 probe/layers/preview/compact job、7 个 façade route 已存在
- HP3 context-core 三个旧 RPC 不再返回 `phase: "stub"`，新四个 RPC（probe/layers/preview/getCompactJob）已加入 WorkerEntrypoint
- HP3 compact job 复用 `nano_session_checkpoints.checkpoint_kind='compact_boundary'` 作为 durable handle，未违 HP1 freeze 新建 `nano_compact_jobs`
- HP4 lifecycle first wave 已真实落地：`POST /sessions/{id}/close`（`ended_reason=closed_by_user`）、`DELETE /sessions/{id}`（conversation soft tombstone）、`PATCH /sessions/{id}/title`（只写 `nano_conversations.title`）三条路由均按 Q13/Q14 冻结语义实现
- HP4 read model 已真实 cursor 化：`listSessionsForUser()` 5-state view、`listConversationsForUser()` conversation-level aggregation、`readConversationDetail()` 均基于 D1 直接查询，不再 façade regroup
- HP4 checkpoint registry first wave 已真实落地：`GET/POST /sessions/{id}/checkpoints` + `GET .../diff` 消费 `nano_session_checkpoints` D1 truth，而非 DO latest blob
- HP5 confirmation registry / API / frame / kernel rename / dispatcher injection 已全部落地，7-kind / 6-status 与 Q16/Q18 冻结对齐
- 三份 closure 均诚实地标为 partial-live 而非伪装完成，F1-F17 chronic status 每份逐项填写

### 1.2 已确认的负面事实

- HP2 closure §2 P2 标 `<model_switch>` 为 `not-started`，charter §7.3 收口标准第 4 项要求"cross-turn 模型切换时 prompt 中可见 `<model_switch>`"——此项在 closure 中未收口
- HP2 closure §2 P3 标 `model.fallback` stream event 为 `not-started`——charter §7.3 In-Scope 第 7 项要求 "fallback audit + stream event"
- HP3 closure §2 P1 标 `CrossTurnContextManager` 为 `not-started-in-runtime`——charter §7.4 收口标准第 2 项要求"turn2 稳定回答 turn1 durable truth"
- HP3 closure §2 P2 标 auto-compact 为 `not-wired`——charter §7.4 收口标准第 3 项要求"Auto-compact 由 model metadata 驱动"
- HP3 closure §2 P4 标 circuit breaker 为 `not-wired`——charter §7.4 收口标准第 5 项要求"5 个 endpoint 全绿"
- HP4 closure §2 P1 标 retry 为 `not-started-on-public-surface`——charter §7.5 In-Scope 第 4 项要求 `POST /sessions/{id}/retry`
- HP4 closure §2 P2/P3 标 restore job + rollback 为 `not-wired`——charter §7.5 In-Scope 第 7 项要求 conversation_only restore
- 三份 closure 均标 `pnpm test:cross-e2e` 为 `not run`——charter §8.3 Gate 规则要求"端点端到端测试存在 + 全绿"
- clients/api-docs/ 缺少 confirmation control plane 全部 3 个 route 与 todo control plane 全部 4 个 route 的文档——charter §9.2 与 §10.1 第三条要求 "18 份文档与代码 100% 对齐"

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐文件逐路由核对 |
| 本地命令 / 测试 | no | 未执行本地测试命令，依赖 closure 中报告的测试结果 |
| schema / contract 反向校验 | yes | 逐 migration 核对 schema 字段与代码消费一致性 |
| live / deploy / preview 证据 | no | 无部署环境 |
| 与上游 design / QNA 对账 | yes | Q7-Q18 逐项核对 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | `<model_switch>` 与 `model.fallback` stream event 未落地 | high | delivery-gap | no | HP2/HP3 联合后续批次必须补齐 |
| R2 | `CrossTurnContextManager` 与 auto-compact runtime 未接入 | high | delivery-gap | no | HP3 后续批次必须补齐 |
| R3 | retry / restore job / rollback 仍未接线 | high | delivery-gap | no | HP4 后续批次必须补齐 |
| R4 | circuit breaker 未接线 | medium | delivery-gap | no | HP3 后续批次补齐 |
| R5 | 全部 cross-e2e 未运行 | high | test-gap | no | 各 phase 后续批次必须补齐 |
| R6 | `MODEL_PROMPT_SUFFIX_CACHE` 无 TTL/驱逐机制 | low | platform-fitness | no | 后续优化，当前不构成 blocker |
| R7 | model profile 解析逻辑在 orchestrator-core 与 agent-core 间存在重复 | medium | scope-drift | no | 跨 worker 重复不阻塞 but 应在 HP8-Hardening 中清理 |
| R8 | context-core `assemblerOps()` 废弃 alias 仍存在 | low | platform-fitness | no | 标记为 deprecated 即可，HP10 cleanup 删除 |
| R9 | clients/api-docs 提前更新违反 charter D7 后置纪律 | medium | scope-drift | no | 应在 closure 中显式承认并确保后续不再提前 |
| R10 | 7 个新端点（confirmation ×3 / todo ×4）完全缺失文档 | high | docs-gap | no | HP9 统一收口 |
| R11 | `fallback_model_id` 不存在链式解析 | medium | correctness | no | HP2 Q8 已冻结为 single-step，但代码中 fallback_model_id 读取后未做二次校验 |
| R12 | cross-e2e 无 HP2 model 状态机专用测试 | medium | test-gap | no | HP2 后续批次补齐 |
| R13 | HP3 compact preview 60s cache 未发现实现 | medium | delivery-gap | no | Q12 要求 preview 同 session+同 high-watermark 60s 内复用 cache |
| R14 | HP4 `DELETE /sessions/{id}` 的 user DO 调度在 session 已 ended 时的行为 | low | correctness | no | `handleDelete` 会先 end session 再 tombstone conversation，行为正确 |
| R15 | HP5 PreToolUse emitter 侧 row-create 未接通（仅 decision 侧落地） | high | delivery-gap | no | HP5 closure 已诚实标为 P1 partial |

### R1. `<model_switch>` 与 `model.fallback` stream event 未落地

- **严重级别**：high
- **类型**：delivery-gap
- **是否 blocker**：no（closure 已诚实标为 partial）
- **事实依据**：
  - HP2 closure §2 P2 标 `<model_switch>` 为 `not-started`
  - HP2 closure §2 P3 标 `model.fallback` stream event 为 `not-started`
  - `packages/nacp-session/src/stream-event.ts` 中无 `model.fallback` kind
  - `workers/agent-core/src/host/runtime-mainline.ts` 中无 `<model_switch>` developer message 注入逻辑
  - charter §7.3 收口标准第 4 项明确要求 "cross-turn 模型切换时 prompt 中可见 `<model_switch>`"
- **为什么重要**：`<model_switch>` 是 Model 状态机的核心语义——没有它，跨模型切换在 LLM 看来是 silent swap 而非显式通知，charter G6 明确指出"LLM 切换后混淆，reasoning effort 静默 ignore"
- **审查判断**：HP2 closure 已诚实标为 partial，不构成 deceptive closure；但 charter 收口标准第 4 项未满足，后续批次必须补齐
- **建议修法**：HP2/HP3 联合后续批次必须在 `runtime-mainline.ts` 的 request assembly 路径中注入 `<model_switch>` developer message，并在 `stream-event.ts` 注册 `model.fallback` kind

### R2. `CrossTurnContextManager` 与 auto-compact runtime 未接入

- **严重级别**：high
- **类型**：delivery-gap
- **是否 blocker**：no（closure 已诚实标为 partial）
- **事实依据**：
  - HP3 closure §2 P1 标 `CrossTurnContextManager` 为 `not-started-in-runtime`
  - HP3 closure §2 P2 标 auto-compact 为 `not-wired`
  - `workers/agent-core/src/host/runtime-mainline.ts` 中 `compactRequired` 仍为硬编码判断，未读 `auto_compact_token_limit`
  - charter §9.4 G5 要求 "cross-turn history e2e（turn1→turn2 引用 e2e）"
- **为什么重要**：没有 `CrossTurnContextManager`，HP3 的 "context 不再是黑盒" 声称只对 probe/layers/preview/job 表面成立——真实 prompt 组装仍走旧路径，长对话仍依赖偶然窗口残留
- **审查判断**：HP3 control-plane first wave 的 surface 层确实已落地（probe/layers/preview/job 都能跑），但 runtime prompt owner 确实未接。这是典型的"基础设施 land 但无人使用"风险——charter §0.5 方法论明确拒绝这种模式
- **建议修法**：HP3 后续批次必须把 `CrossTurnContextManager` 接入 `runtime-mainline.ts`，并让 auto-compact 由 model metadata 驱动

### R3. retry / restore job / rollback 仍未接线

- **严重级别**：high
- **类型**：delivery-gap
- **是否 blocker**：no（closure 已诚实标为 partial）
- **事实依据**：
  - HP4 closure §2 P1 标 retry 为 `not-started-on-public-surface`
  - HP4 closure §2 P2/P3 标 restore job + rollback 为 `not-wired`
  - `workers/orchestrator-core/src/index.ts` 中无 `/sessions/{id}/retry` route
  - `workers/orchestrator-core/src/index.ts` 中无 `/sessions/{id}/checkpoints/{id}/restore` route
  - charter §7.5 收口标准第 1 项要求 "session close/delete/title/retry 全 live"
- **为什么重要**：没有 retry，用户无法重试失败 turn；没有 restore，checkpoint 产品面只做到"可列可看不可回"
- **审查判断**：HP4 first wave 的 lifecycle surface + read model + checkpoint diff 确实已落地且质量好，但 retry/restore 是 charter 明确的 in-scope 项
- **建议修法**：HP4 后续批次必须补齐 retry route + restore job orchestration + D1/DO rollback 链

### R5. 全部 cross-e2e 未运行

- **严重级别**：high
- **类型**：test-gap
- **是否 blocker**：no（各 closure 已诚实标为 not run）
- **事实依据**：
  - HP2 closure §6 标 `pnpm test:cross-e2e` 为 `not run`
  - HP3 closure §6 标 `pnpm test:cross-e2e` 为 `not run`
  - HP4 closure §6 标 `pnpm test:cross-e2e` 为 `not run`
  - HP5 closure §7 标 `pnpm test:cross-e2e (15-18)` 为 `not run`
  - `test/cross-e2e/` 目录中有 14-15 个文件，但无专门的 HP2 model 状态机测试
  - charter §8.3 Gate 规则："端点端到端测试存在 + 全绿"
- **为什么重要**：charter 的 wire-without-delivery 不算闭合纪律明确要求端点 live 必须有 `test/cross-e2e/*.test.mjs` 文件落地
- **审查判断**：各 closure 均诚实标出，不构成 deceptive closure；但这是 charter Gate 硬性要求，在宣称 phase 完全收口前必须补齐
- **建议修法**：HP2 补 model 状态机 5+ cross-e2e；HP3 补 long-conversation 5+ cross-e2e；HP4 补 lifecycle/retry/restore 6+ cross-e2e；HP5 补 permission roundtrip 4 个 cross-e2e

### R9. clients/api-docs 提前更新违反 charter D7 后置纪律

- **严重级别**：medium
- **类型**：scope-drift
- **是否 blocker**：no
- **事实依据**：
  - charter §4.4 第 3 条明确："HP2-HP8 不更新 `clients/api-docs/`"
  - charter §1.1 D7："`clients/api-docs/` 文档全面更新放在晚期 phase(HP9)"
  - HP2 closure §0 标 `clients/api-docs` 为 `updated`
  - HP3 closure §0 标 `clients/api-docs` 为 `updated`
  - HP4 closure §0 标 `clients/api-docs` 为 `updated`
  - 实际代码核查确认 `clients/api-docs/session.md`、`README.md`、`me-sessions.md`、`error-index.md` 均在 HP2/HP3/HP4 期间被更新
- **为什么重要**：charter D7 的纪律是"不每 phase 散打文档"，防止 stub-doc 漂移。提前更新本身不坏，但与 charter 冻结石纪律冲突
- **审查判断**：提前更新文档的实际效果是正面的——比 HP9 再补更准确。但纪律层面确实违反了 D7。建议在 closure 中显式承认并记录原因（各 phase 更新确保当前 API 文档与代码一致），后续 phase 继续沿用"只写不删"策略直到 HP9 统一收口
- **建议修法**：在 HP2/HP3/HP4 closure 中追加注记说明 api-docs 更新违反 D7 但实际效果正面；HP9 仍需全量 review；后续 phase 继续沿用但确保 HP9 前不再有结构性重写

### R10. 7 个新端点（confirmation ×3 / todo ×4）完全缺失文档

- **严重级别**：high
- **类型**：docs-gap
- **是否 blocker**：no（charter D7 将其归到 HP9）
- **事实依据**：
  - `clients/api-docs/` 中 11 个文件均未包含以下端点文档：
    - `GET /sessions/{id}/confirmations`
    - `GET /sessions/{id}/confirmations/{confirmationUuid}`
    - `POST /sessions/{id}/confirmations/{confirmationUuid}/decision`
    - `GET /sessions/{id}/todos`
    - `POST /sessions/{id}/todos`
    - `PATCH /sessions/{id}/todos/{todoUuid}`
    - `DELETE /sessions/{id}/todos/{todoUuid}`
  - `README.md` 端点矩阵缺失以上 7 个路径
  - `error-index.md` 缺失 `confirmation-already-resolved`(409)、`in-progress-conflict`(409)、`todo-not-found`(404) 等新错误码
  - `permissions.md` 未提及 confirmation control plane 是 legacy permission/elicitation 的统一 superset
- **为什么重要**：charter §10.1 第 3 条是硬闸——"18 份 `clients/api-docs/` 与代码 100% 对齐"。HP9 需要补 7 个新文档（models/context/checkpoints/confirmations/todos/workspace/transport-profiles），而 HP5/HP6 新增的端点目前完全缺文档
- **审查判断**：charter D7 明确将 HP9 作为文档统一收口时点，中期不补文档不构成 blocker；但漂移风险随阶段推进持续恶化
- **建议修法**：HP9 必须新增 `confirmations.md` + `todos.md`（或等价整合文档），补齐 7 个新端点 + 3+ 新错误码

### R11. `fallback_model_id` 不存在链式解析

- **严重级别**：medium
- **类型**：correctness
- **是否 blocker**：no
- **事实依据**：
  - `session-truth.ts` 中 `readSessionModelState()` 读取 `fallback_model_id` 但未校验 fallback model 自身的 `status='active'` 与 `team_model_policy`
  - `resolveModelForTeam()` 只对请求模型做 alias resolve + policy gate，未对 fallback model 做二次校验
  - `closeTurn()` 写入 `fallback_used=true` + `fallback_reason` 但 fallback model 是否真实合法未在 request 路径二次验证
- **为什么重要**：charter §2.2 G6 与 HP2 action-plan §5.2 风险提醒明确说"fallback model 也必须再次经过 metadata + capability + policy law"
- **审查判断**：当前 `fallback_model_id` 只在 metadata 层面记录，HP2 Q8 已冻结为 single-step；如果 fallback model 不在 team allowed list 中，当前代码不会阻止。但这不是 first-wave 的核心 blocker——fallback 本身尚未实现（P3 not-started）
- **建议修法**：HP2 后续批次实现 `model.fallback` 触发时，必须在 fallback model 上执行 `resolveModelForTeam()` 同样的校验链

### R13. HP3 compact preview 60s cache 未发现实现

- **严重级别**：medium
- **类型**：delivery-gap
- **是否 blocker**：no
- **事实依据**：
  - HP3 action-plan §4.3 P3-02 明确要求："同 session + 同 high-watermark 60s 内复用 in-memory cache"
  - HP3 Q12 冻结："preview 只读，60s 缓存命中"
  - `workers/context-core/src/control-plane.ts` 中 `buildCompactPreview()` 每次都重新计算，无 cache 逻辑
  - `workers/orchestrator-core/src/context-control-plane.ts` 中 `previewCompact` 每次都重走 D1 查询
- **为什么重要**：长对话高频 preview 场景下，不做 60s cache 会导致每次 preview 都触发全量 D1 查询 + token 估算
- **审查判断**：这是 HP3 first wave 的合理 partial 项——control plane 已落地但 preview cache 未实现。不构成 blocker 但 Q12 冻结要求必须补
- **建议修法**：HP3 后续批次在 `context-control-plane.ts` 或 `control-plane.ts` 新增 session-scoped 的 `previewCache: Map<string, {result, expiresAt}>`，key 为 `session_uuid + message_high_watermark`，TTL 60s

---

## 3. In-Scope 逐项对齐审核

### 3.1 HP2 In-Scope 逐项

| 编号 | 计划项 / charter In-Scope | 审查结论 | 说明 |
|------|---------------------------|----------|------|
| S1 | 四层模型状态机(global→session→turn→effective+fallback) | `partial` | session default + turn override + effective audit 已落地；fallback 触发链路未接入 |
| S2 | `GET/PATCH /sessions/{id}/model` + `GET /models/{id}` | `done` | 三端点均已 live |
| S3 | alias resolve + clear semantics | `done` | `resolveModelForTeam()` 含 alias resolve + team policy gate；PATCH null 清回 global default |
| S4 | `<model_switch>` developer message | `missing` | 未注入 |
| S5 | `model.fallback` stream event | `missing` | 未注册 |
| S6 | requested/effective/fallback D1 audit | `partial` | requested/effective 已落地；fallback_used + fallback_reason 列已落地但 fallback 触发链路未接线 |
| S7 | reasoning effort 重映射 | `partial` | `normalizeReasoningOptions()` 已实现（取 `supported_reasoning_levels` 首项），但不等价于 per-model `default_reasoning_effort` |
| S8 | 5+ e2e | `missing` | cross-e2e 无 HP2 专用测试 |

### 3.2 HP3 In-Scope 逐项

| 编号 | 计划项 / charter In-Scope | 审查结论 | 说明 |
|------|---------------------------|----------|------|
| S1 | 五个 context surface(probe/layers/preview/compact/compact/jobs/{id}) | `done` | 7 个 route 已全部落地（含 `GET /context` 兼容 alias） |
| S2 | context-core 3 RPC 解 stub | `done` | `getContextSnapshot` / `triggerContextSnapshot` / `triggerCompact` 不再返回 `phase:"stub"` |
| S3 | `CrossTurnContextManager` | `missing` | agent-core runtime 仍未接入 |
| S4 | auto-compact 由 model metadata 驱动 | `missing` | `compactRequired` 仍为硬编码 |
| S5 | manual compact preview/job 分离 | `partial` | preview 端点已落地但无 60s cache；job 端点已落地且复用 checkpoint |
| S6 | `<model_switch>` / `<state_snapshot>` strip-then-recover | `partial` | preview/job payload 中登记 `protected_fragment_kinds`，但未接回真实 prompt |
| S7 | compact 失败 3 次 circuit breaker | `missing` | 未接线 |
| S8 | 5+ e2e | `partial` | 仅 04/05 覆盖 context 初始场景，非 HP3 action-plan 要求的完整矩阵 |

### 3.3 HP4 In-Scope 逐项

| 编号 | 计划项 / charter In-Scope | 审查结论 | 说明 |
|------|---------------------------|----------|------|
| S1 | `POST /sessions/{id}/close` | `done` | `ended_reason=closed_by_user` 符合 Q13 |
| S2 | `DELETE /sessions/{id}` (soft tombstone) | `done` | 只写 `deleted_at` 符合 Q14 |
| S3 | `PATCH /sessions/{id}/title` | `done` | 只写 `nano_conversations.title` 符合 Q13 |
| S4 | `POST /sessions/{id}/retry` | `missing` | 未接线 |
| S5 | `/me/sessions` / `/me/conversations` 真 cursor | `done` | direct D1 query + 5-state view |
| S6 | `GET /conversations/{conversation_uuid}` | `done` | conversation detail 已 live |
| S7 | `GET /sessions/{id}/checkpoints` + `POST` | `done` | 用户创建时固化 `checkpoint_kind='user_named'` + `file_snapshot_status='none'` |
| S8 | `GET /sessions/{id}/checkpoints/{id}/diff` | `done` | 仅 message diff，不做 file diff |
| S9 | `POST /sessions/{id}/checkpoints/{id}/restore` (conversation_only) | `missing` | restore job orchestration 未接线 |
| S10 | D1/DO 一致性回滚 | `missing` | rollback / restart-safe 未实现 |
| S11 | 6+ e2e | `partial` | 仅 08 覆盖 lifecycle 初始场景 |

### 3.4 对齐结论

- **done**: 16
- **partial**: 5
- **missing**: 7
- **stale**: 0
- **out-of-scope-by-design**: 0

> 这更像"核心骨架与 control plane 已完成、但 runtime owner / 端到端验证 / 语义注入尚未收口"的状态。三份 closure 均诚实标记 partial-live，没有伪装完成。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | HP2 multi-provider routing | `遵守` | 代码中无 provider 路由逻辑 |
| O2 | HP2 pricing/quota/admin | `遵守` | 代码中无 pricing 字段 |
| O3 | HP3 checkpoint restore (files_only) | `遵守` | HP4 first wave 只做到 diff，不涉及 restore |
| O4 | HP3 provider-specific template engine | `遵守` | 代码中无 template engine |
| O5 | HP4 session fork | `遵守` | 代码中无 fork route |
| O6 | HP4 undelete / deleted_by_user_uuid | `遵守` | Q14 符合 |
| O7 | HP4 auto title generation | `遵守` | 代码中无 LLM title 生成 |
| O8 | HP2 fallback chain | `遵守` | Q8 冻结为 single-step |
| O9 | HP3 `<model_switch>` execution (strip/recover) | `遵守` | HP2 冻结语义，HP3 只做 preview marker |
| O10 | clients/api-docs 提前全量重写 | `部分违反` | 各 phase closure 报告了 `clients/api-docs` 为 `updated`，违反 charter D7 后置纪律；但实际效果正面 |

---

## 5. 跨阶段深度分析

### 5.1 HP2→HP3→HP4 依赖链断点

charter §8.4 明确要求 HP2→HP3→HP4 严格串行。当前依赖链的实际状态如下：

| 依赖 | charter 要求 | 实际状态 | 断点风险 |
|------|-------------|---------|---------|
| HP2 `effective_model_id` → HP3 compact budget | HP3 必须读 HP2 model metadata | ✅ 已落地 | 无 |
| HP2 `fallback_reason` → HP4 retry audit | HP4 retry 需要 model audit | ✅ 已落地 | 无 |
| HP2 `<model_switch>` → HP3 strip-recover | HP3 compact 必须保护 `<model_switch>` | ❌ `<model_switch>` 未注入 | HP3 后续批次需先注入再 strip |
| HP3 `CrossTurnContextManager` → HP4 checkpoint history | HP4 restore 需要准确 cross-turn history | ❌ CrossTurnContextManager 未接入 | HP4 retry/restore 将受影响 |
| HP3 auto-compact → HP4 checkpoint `compact_boundary` | HP4 需要消费 compact boundary | ✅ 已落地（`compact_boundary` checkpoint handle 已可用） | 无 |
| HP4 `ended_reason=closed_by_user` → HP5 confirmation | HP5 delete/restore 可能需要 confirmation | ✅ 已落地 | 无 |
| HP5 confirmation → HP7 checkpoint restore confirmation | HP7 restore 必须走 confirmation gate | ✅ HP5 `checkpoint_restore` kind 已 schema-frozen | 无 |

**最大断点**：HP3 的 `CrossTurnContextManager` 未接入。这意味着当前 agent-core 的 `runtime-mainline.ts` 中 prompt 组装仍走旧路径，HP4 的 retry/restore 如果依赖 cross-turn history 正确恢复，会受影响。

### 5.2 Z9 违反：api-docs 提前更新

charter §4.4 第 3 条与 §1.1 D7 明确冻结"HP2-HP8 不更新 `clients/api-docs/`"。但 HP2/HP3/HP4 closure 均报告 `clients/api-docs` 为 `updated`。

实际核查：
- `session.md` 被更新，增加了 context route matrix、model routes、checkpoint endpoints、lifecycle endpoints
- `README.md` 被更新，增加了新路由列表
- `me-sessions.md` 被更新，反映了 true cursor read model
- `error-index.md` 被更新

**审查判断**：违反了 D7 后置纪律，但实际效果正面——比 HP9 再补更准确。建议改为"只写不删"策略：各 phase 可以增量更新文档确保 API 一致性，但不做结构性重写或新增独立文档文件（如 `confirmations.md`）；新增独立文档必须留到 HP9。

### 5.3 HP5 PreToolUse Emitter 侧断点

HP5 closure §2 P1 标 PreToolUse emitter 侧 row-create 为 `not-wired-on-emitter-side`。这意味着：

1. `HookDispatcher` 已在 `runtime-assembly.ts` 中无条件构造（HP5 R7）
2. `confirmation_pending` 已在 `kernel/types.ts` 中替换 `approval_pending`（HP5 R6）
3. `D1ConfirmationControlPlane` 已落地（HP5 R1）
4. 但 `emitPermissionRequestAndAwait()` 在 emit 时仍不会主动 row-create，只有 decision 一侧通过 dual-write 懒创建

**风险**：如果一个 tool 在 `ask` policy 下触发 PreToolUse，而 emitter 侧不 row-create，那么工具暂停时 `/confirmations?status=pending` 可能查不到这条 confirmation。charter §9.4 明确要求"tool 在 ask policy 下真实暂停→恢复"。

### 5.4 `compactRequired` 硬编码断点

`workers/agent-core/src/host/runtime-mainline.ts` 中 `compactRequired` 判断仍为旧逻辑（当前实际代码需要核查确切位置）。HP3 action-plan P3-01 明确要求：

> "用 `effective_context_pct * context_window` 与 `auto_compact_token_limit` 驱动 compact 阈值，不再硬编码 32K"

HP3 closure §2 P2 标 auto-compact 为 `not-wired`。这意味着当前长对话仍然依赖旧的 `CompactDelegate` 返回 `{tokensFreed:0}` 的 stub，正式的 auto-compact 触发机制尚未接入。

**影响**：这是 charter G3/G4 的核心 gap——"context-core 3 RPC 全部 `phase: "stub"`"和"`compactRequired` 永远 false"。HP3 first wave 已解决 G3（三个 RPC 不再返 stub），但 G4（`compactRequired` 永远 false）仍未修复。

### 5.5 命名规范与一致性审查

**正面发现**：
- `confirmation_pending` 统一替换 `approval_pending`，代码与 schema 一致
- NACP 消息族 7-kind / 6-status 与 HP1 migration 012 CHECK 约束对齐
- `CloseBody` / `DeleteSessionBody` / `TitlePatchBody` 与 Q13/Q14 冻结语义一致

**问题发现**：
- `session-lifecycle.ts` 中 `CancelBody` 与 `CloseBody` 在 `parseSessionAction` 中的 body 解析使用了不同的 HTTP method 映射（`close` → POST, `delete` → DELETE, `title` → PATCH），但 `action === "close"` 在 `parseSessionRoute` 中被解析为需要 body 的 POST action，这是正确的
- `models` route 中 `DurableModelCatalogItem`（list 响应）与 `DurableModelDetail`（detail 响应）使用两个字段名不一致的对象类型，设计意图是 list 返回精简版、detail 返回全版，但 `DurableModelDetail` 通过扩展 `DurableModelCatalogItem` 实现了这点，是合理的

### 5.6 clients/api-docs 与代码漂移全量核查

以下为 `clients/api-docs/` 全量漂移表：

| 漂移项 | 影响范围 | 严重级别 | 说明 |
|--------|---------|---------|------|
| `/sessions/{id}/confirmations` 三端点缺失 | confirmation control plane 全部 | high | 3 个 route 无文档 |
| `/sessions/{id}/todos` 四端点缺失 | todo control plane 全部 | high | 4 个 route 无文档 |
| `confirmation-already-resolved`(409) 错误码缺失 | error-index.md | medium | 新错误码未记录 |
| `in-progress-conflict`(409) / `todo-not-found`(404) / todo `invalid-status` 缺失 | error-index.md | medium | 新错误码未记录 |
| `permissions.md` 未提及 confirmation 统一平面 | permissions.md | medium | legacy 路由标注为 compat alias 的事实未记录 |
| `session.md` 未记录 confirmation 与 todo 路由 | session.md | high | 7 个新端点无文档 |
| `README.md` 端点矩阵缺 7 个新路由 | README.md | medium | 路由列表不完整 |
| `/sessions/{id}/model` PATCH body 未完整记录 | session.md | low | `reasoning_effort` 字段当前值为 `null` 在 PATCH 中代表"清回 global default" |
| `usage.md` 标记为 `facade` shape 但实际是 legacy facade-wrapped | usage.md | low | 应标注 `legacy (facade-wrapped)` 与其他 session DO 路由一致 |
| 新增 `confirmations.md` 文件缺失 | HP9 必须新增 | medium | charter 要求 18 份文档，当前只有 11 份 |
| 新增 `todos.md` 文件缺失 | HP9 必须新增 | medium | 同上 |
| `context.md` 独立文件缺失 | HP9 必须新增 | medium | 7 份新增文档之一 |
| `checkpoints.md` 独立文件缺失 | HP9 必须新增 | medium | 7 份新增文档之一 |
| `workspace.md` 独立文件缺失 | HP9 必须新增 | medium | 7 份新增文档之一 |
| `models.md` 独立文件缺失 | HP9 必须新增 | medium | 7 份新增文档之一 |
| `transport-profiles.md` 独立文件缺失 | HP9 必须新增 | medium | 7 份新增文档之一 |

**按 charter §9.2 与 §10.1 第三条（硬闸）**：当前 11 份文档与代码的"对齐度"约为 65%——11 份已有文档中约 4 份（session.md、README.md、me-sessions.md、error-index.md）与代码存在结构性漂移；7 份应有但尚不存在的文档完全缺失。HP9 必须补齐到 18 份 100% 对齐。

### 5.7 F1-F17 Chronic Status 跨阶段一致性核查

以下对各 closure 中 F1-F17 的跨阶段一致性进行核查：

| chronic | HP2 verdict | HP3 verdict | HP4 verdict | HP5 verdict | 一致性 |
|---------|-------------|-------------|-------------|-------------|--------|
| F1 | closed-by-HP0 | closed-by-HP0 | closed-by-HP0 | closed-by-HP0 | ✅ 一致 |
| F2 | closed-by-review-fix | closed-by-review-fix | closed-by-review-fix | closed-by-review-fix | ✅ 一致（agent-core 复审补接线） |
| F3 | closed-by-HP2-first-wave | closed-by-HP2-first-wave | closed-by-HP2-first-wave | closed-by-HP2-first-wave | ✅ 一致 |
| F4 | enabled-by-HP2 | partial-by-HP3 | carried-from-HP3-partial | carried-from-HP3-partial | ✅ 一致，串行递进 |
| F5 | enabled-by-HP2 | not-touched | partial-by-HP4 | carried-from-HP4-partial | ✅ 一致 |
| F6 | not-touched | not-touched | not-touched | partial-by-HP5 | ✅ 一致 |
| F7 | not-touched | not-touched | not-touched | not-touched | ✅ 一致(HP6) |
| F8 | not-touched | schema-ready-consumed | partial-by-HP4 | partial-by-HP4 | ⚠️ HP3 标为 schema-ready-consumed 而 HP4 标为 partial-by-HP4，但语义一致——都是"schema 已落地，完整功能未完" |
| F9 | not-touched | not-touched | not-touched | not-touched | ✅ 一致(HP8) |
| F10 | handed-to-platform | handed-to-platform | handed-to-platform | handed-to-platform | ✅ 一致 |
| F11 | partial-by-HP2 | partial-by-HP3 | partial-by-HP4 | partial-by-HP3-and-HP4 | ⚠️ HP3 和 HP4 各标为 `partial-by-HP3/HP4`，HP5 标为 `partial-by-HP3-and-HP4`——描述方式不统一但不影响事实 |
| F12 | not-touched | not-touched | not-touched | not-touched | ✅ 一致(HP10) |
| F13 | not-touched | partial-by-HP3 | partial-by-HP4 | partial-by-HP3 | ⚠️ HP4 标 `partial-by-HP4`（lifecycle durable activity），HP5 标回 `partial-by-HP3`——应统一为 `partial-by-HP3-and-HP4` |
| F14 | not-touched | not-touched | not-touched | not-touched | ✅ 一致(HP6/HP7) |
| F15 | not-touched | closed-by-HP1 | consumed-by-HP4-first-wave | closed-by-HP1 | ⚠️ HP3 标 `closed-by-HP1`（product checkpoint 已解耦 DO），HP4 标为 `consumed-by-HP4-first-wave`，HP5 标回 `closed-by-HP1`——描述角度不同但事实一致 |
| F16 | not-touched | not-touched | not-touched | closed-by-HP5 | ✅ HP5 正确关闭了此 chronic |
| F17 | not-yet | partial-by-HP3 | carried-from-HP3-partial | partial-by-HP3 | ⚠️ HP2 标 `not-yet`，HP3/HP4/HP5 递进但未完成 |

**需要注意的不一致**：
1. F4 在 HP2 标为 `enabled-by-HP2` 而非 `not-touched`——这暗示 HP2 的 model state machine 启用了 context 状态机的前提条件，但实际是"kinematic 依赖"而非"功能完成"
2. F13 描述方式在不同 closure 中有漂移——建议最终 closure 统一为 `{phase}-partial` 格式
3. F15 在不同 closure 中用了不同描述（`closed-by-HP1` vs `consumed-by-HP4-first-wave`）——建议统一为更精确的 `closed-by-HP1-schema-consumed-by-HP4`

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：HP2/HP3/HP4 first wave 核心骨架与 control plane 已真实落地，三份 closure 诚实标记 partial-live，不存在 deceptive closure。但 charter 收口标准的硬性要求项（cross-e2e、`<model_switch>`、CrossTurnContextManager、auto-compact、retry、restore）均未完成，各 phase 需后续批次补齐才能宣称 full close。
- **是否允许关闭本轮 review**：yes
- **关闭前必须完成的 blocker**：(none — 各 closure 已诚实标记 partial-live，无伪装完成的 blocker)
- **可以后续跟进的 non-blocking follow-up**：
  1. HP2 后续：`<model_switch>` developer message 注入 + `model.fallback` stream event + fallback model 二次校验 + 5+ cross-e2e
  2. HP3 后续：`CrossTurnContextManager` 接入 runtime-mainline + auto-compact model-aware 驱动 + circuit breaker + strip-then-recover full contract + 60s preview cache + 5+ cross-e2e
  3. HP4 后续：`POST /sessions/{id}/retry` + restore job orchestration + D1/DO rollback + restart-safe + 6+ cross-e2e
  4. HP5 后续：PreToolUse emitter 侧 row-create + cross-e2e 15-18
  5. 跨阶段：api-docs D7 违反需在各 closure 中显式承认；HP9 需补 7 个新文档文件 + 现有 4 个文档的结构性漂移修复
  6. 跨阶段：F13/F15/F17 的 chronic status 描述方式建议在 HP10 final closure 中统一格式
  7. 跨阶段：`MODEL_PROMPT_SUFFIX_CACHE` 无 TTL/驱逐机制、model profile 解析逻辑跨 worker 重复——建议 HP8 停止流血时一并清理
- **建议的二次审查方式**：HP2/HP3/HP4 后续批次补齐后，由独立 reviewer 对 cross-e2e 覆盖率与 runtime owner 接入做二次审查
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §7 append 回应，不要改写 §0–§5。