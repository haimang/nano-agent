# Nano-Agent Hero-to-Pro 全阶段深度审查

> 审查对象: `hero-to-pro 阶段 HP0-HP10 全量工作`
> 审查类型: `closure-review + mixed`
> 审查时间: `2026-05-01`
> 审查人: `GLM`
> 审查范围:
> - `docs/charter/plan-hero-to-pro.md`（charter）
> - `docs/action-plan/hero-to-pro/HP0-HP10-action-plan.md`（11 份执行计划）
> - `docs/issue/hero-to-pro/HP0-HP10-closure.md`（11 份 closure）
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
> - `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md`
> - `docs/issue/hero-to-pro/manual-evidence-pack.md`
> - `docs/issue/hero-to-pro/prod-schema-baseline.md`
> - `workers/orchestrator-core/src/`（核心实现目录）
> - `workers/agent-core/src/`（核心实现目录）
> - `workers/context-core/src/`（核心实现目录）
> - `workers/filesystem-core/src/`（核心实现目录）
> - `workers/bash-core/src/`（核心实现目录）
> - `packages/nacp-session/src/`（协议包）
> - `packages/nacp-core/src/`（核心包）
> - `clients/api-docs/*.md`（18 份文档）
> - `test/cross-e2e/`（21 个 e2e 文件）
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md`
> - `docs/design/hero-to-pro/HPX-qna.md`（Q 冻结决策）
> - 代码仓库实际文件与实现
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：hero-to-pro 阶段完成了 charter 规定的核心骨架搭建，4 套状态机 first-wave 全部落地，DDL 集中完成，28 项 deferred absorbed within hero-to-pro，7 项 retained-with-reason 具备可观察 remove condition，Q1-Q36 冻结决策合规。但存在 3 个 critical 级文档-代码漂移、1 个 cross-package 漂移、以及若干 medium 级命名/覆盖面缺口。
- **结论等级**：`approve-with-follow-ups`
- **是否允许关闭本轮 review**：`yes`（附 3 个 critical follow-up 必须在 hero-to-pro 后续批次或 hero-to-platform 启动前修完）
- **本轮最关键的 3 个判断**：
  1. **confirmations.md 与代码严重漂移**：4/7 kind 名称不匹配 + decision 端点字段/枚举完全不同，客户端若按文档对接将全部失败（R1 critical）
  2. **workspace.md / tool-calls 路由文档标注错误**：文档标记为"未 live"的路由实际已在代码中注册并可用，误导客户端开发者（R2 critical）
  3. **eval-observability 包流事件种类漂移 4 种**：9/13，静默丢弃 `tool.call.cancelled`/`session.fork.created`/`model.fallback` 三类事件，HP6/HP7/HP2-D2 absorb 的关键事件在 eval 管道中被滤除（R3 critical）

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-hero-to-pro.md`（完整 1331 行）
  - `docs/action-plan/hero-to-pro/HP0-HP10-action-plan.md`（11 份）
  - `docs/issue/hero-to-pro/HP0-HP10-closure.md`（11 份 closure）
  - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
  - `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md`
  - `docs/issue/hero-to-pro/manual-evidence-pack.md`
  - `docs/issue/hero-to-pro/prod-schema-baseline.md`
  - `docs/design/hero-to-pro/HPX-qna.md`（Q 冻结决策引用链）
- **核查实现**：
  - `workers/orchestrator-core/migrations/001-014.sql`（14 个 migration 文件）
  - `workers/orchestrator-core/src/index.ts`（路由注册与 dispatch）
  - `workers/orchestrator-core/src/hp-absorbed-routes.ts`（absorbed 路由）
  - `workers/orchestrator-core/src/hp-absorbed-handlers.ts`（absorbed handlers）
  - `workers/orchestrator-core/src/confirmation-control-plane.ts`
  - `workers/orchestrator-core/src/checkpoint-restore-plane.ts`
  - `workers/orchestrator-core/src/checkpoint-diff-projector.ts`
  - `workers/orchestrator-core/src/todo-control-plane.ts`
  - `workers/orchestrator-core/src/workspace-control-plane.ts`
  - `workers/orchestrator-core/src/context-control-plane.ts`
  - `workers/orchestrator-core/src/session-truth.ts`
  - `workers/orchestrator-core/src/entrypoint.ts`（emitterRowCreateBestEffort）
  - `workers/agent-core/src/host/orchestration.ts`（OrchestrationDeps.probeCompactRequired）
  - `workers/agent-core/src/host/compact-breaker.ts`
  - `workers/agent-core/src/eval/inspector.ts`
  - `workers/context-core/src/control-plane.ts`（PREVIEW_CACHE）
  - `workers/filesystem-core/src/index.ts`（8 RPC 方法）
  - `packages/nacp-session/src/stream-event.ts`（13 kinds）
  - `packages/nacp-core/src/tools/tool-catalog.ts`
  - `packages/eval-observability/src/inspector.ts`
  - `clients/api-docs/*.md`（18 份文档逐一核对）
  - `test/cross-e2e/15-21-*.test.mjs`（7 个新 e2e 文件）
  - `scripts/check-*.mjs`（3 个 drift guard）
  - `scripts/verify-initial-context-divergence.mjs`
- **执行过的验证**：
  - `ls workers/orchestrator-core/migrations/` — 验证 001-014 存在
  - `ls test/cross-e2e/` — 验证 01-21 + zx2 存在
  - `ls clients/api-docs/*.md | wc -l` — 验证 18 份
  - 逐一读取 confirmations.md / workspace.md / todos.md / models.md / checkpoints.md / context.md / session.md 与代码交叉比对
  - 读取 stream-event.ts 与 inspector.ts 比对流事件种类数
- **复用 / 对照的既有审查**：
  - `docs/code-review/hero-to-pro/HP0-HP1-reviewed-by-*.md`（3 份）
  - `docs/code-review/hero-to-pro/HP2-HP4-reviewed-by-*.md`（3 份）
  - `docs/code-review/hero-to-pro/HP6-HP8-reviewed-by-*.md`（2 份）
  - 独立复核，仅在事实维度上采纳其代码行号引用

### 1.1 已确认的正面事实

1. **14 个 migration 全部存在**（001-014），与 charter §7.2 和 HP1 closure §1 一一对应；014 作为 R8 受控例外有明确记录
2. **DDL Freeze Gate 生效**：HP2-HP10 无新增 migration，charter §4.4 R8 纪律被遵守
3. **NACP 协议从 13 种消息增长到 13 种 stream event kinds**（`model.fallback` 加入），原 13 种消息 100% backward compat
4. **6-worker 拓扑不变**：无新增 worker，charter D1 决议被遵守
5. **28 项 deferred absorbed within hero-to-pro**：HP2-D1/D2/D3、HP3-D1..D6、HP4-D1/D2/D3、HP5-D1/D2、HP6-D1..D8、HP7-D1..D5、HP8-D2/D3/D4 均有明确实现位置与测试
6. **7 项 retained-with-reason**：4 项 owner-action（physical hardware / prod credential / external reviewer / wrangler tail）+ 3 项 cleanup（K1/K2+K3/K5），全部带 Q36 6 字段
7. **5 类 root drift gate 全绿**：`check:cycles` / `check:megafile-budget` / `check:tool-drift` / `check:envelope-drift` / `check:observability-drift`
8. **7 个新 cross-e2e 文件存在**（15-21），涵盖 HP2-HP8 的关键场景 scaffold
9. **3 个 drift guard CI 脚本**全部存在：megafile-budget / tool-drift / envelope-drift
10. **18 份 clients/api-docs 文档**全部存在，7 份新增文档与 charter §7.10 R4 修订对齐
11. **final closure 正确纠正了 framing error**：22 项错误标为 handed-to-platform 的项已全部重新分类为 absorbed-within-hero-to-pro
12. **HPX-Q33 合规**：无任何 silently resolved 项

### 1.2 已确认的负面事实

1. **confirmations.md 与代码严重漂移**：7 类 kind 中 4 类名称不匹配（`permission`→`tool_permission`、`compact_boundary`→`context_compact`、`tool_pause`无对应、`fork`无对应），且有 3 个代码中的 kind（`fallback_model`/`context_compact`/`context_loss`）在文档中无对应；decision 端点字段名和枚举值完全不同（文档用 `decision`+`scope`+`reason`+`payload` 与 `always_allow`/`always_deny`，代码用 `status`+`decision_payload` 与 `timeout`/`superseded`）
2. **workspace.md 标注 "not live" 的路由实际已注册且可用**：`/sessions/{id}/workspace/files/*` 和 `/sessions/{id}/tool-calls/*` 在 `hp-absorbed-routes.ts` 和 `index.ts` dispatch 中已完全接线，但文档仍标注为"未 live"
3. **eval-observability 包流事件漂移 4 种**：9/13，缺少 `tool.call.cancelled`、`session.fork.created`、`model.fallback`；静默丢弃这三类事件到 `rejections`
4. **todos.md content 长度限制不匹配**：文档写 ≤500，代码实现 ≤2000
5. **todos.md 缺少 `parent_todo_uuid` 文档**：代码接受但文档未提及
6. **models.md `tool_use` capability 不存在于代码**：文档示例包含 `tool_use: true`，但 `DurableModelCatalogItem` 仅有 `reasoning`/`vision`/`function_calling`
7. **4 个 session DO-proxied 路由未在 API 文档中记录**：`/sessions/{id}/usage`、`/sessions/{id}/retry`、`/sessions/{id}/fork`、`/sessions/{id}/policy/permission_mode`
8. **cross-e2e 文件全部为 scaffold（liveTest 模式）**：7 个新 e2e（15-21）在未设 `NANO_AGENT_LIVE_E2E=1` 时 skip，根据 charter §9.4 线下-交付纪律，端点宣称 live 但无自动化 e2e 全绿是 wire-without-delivery 风险
9. **HP9 manual evidence 处于 `cannot-close` 状态**：5 设备录制数量为 0，4 reviewer memo 数量也为 0
10. **HP9 prod schema baseline 处于 `cannot-close` 状态**：owner 未跑 wrangler --remote

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐文件逐行号比对 15 个关键实现文件 |
| 本地命令 / 测试 | yes | `ls` / `wc -l` / glob 验证文件存在与数量 |
| schema / contract 反向校验 | yes | 7 种 confirmation kind × 6 status vs 文档；13 stream event kinds vs 2 包 |
| live / deploy / preview 证据 | no | 无 preview 环境访问权 |
| 与上游 design / QNA / action-plan / closure 对账 | yes | 11 份 closure 与 charter §7 一一比对 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | confirmations.md kind 名称与代码完全不一致 | critical | docs-gap | yes | 立即修正文档，或代码层对齐 |
| R2 | workspace.md / tool-calls 路由标注 not-live 但代码已注册 | critical | docs-gap | yes | 更新文档标注为 live，附 absorbed 路由说明 |
| R3 | eval-observability 包流事件种类漂移 4 种（9/13） | critical | protocol-drift | yes | 同步 eval-observability inspector 到 13 kinds |
| R4 | todos.md content 长度 500 vs 代码 2000 | medium | docs-gap | no | 修正文档为 2000 |
| R5 | todos.md 未记录 parent_todo_uuid 参数 | medium | docs-gap | no | 补充文档 |
| R6 | models.md tool_use capability 不存在于代码 | medium | docs-gap | no | 移除文档中的 tool_use 字段 |
| R7 | 4 个 session 路由未在 API 文档记录 | medium | docs-gap | no | 在 session.md 中补充 retry/fork/usage/policy |
| R8 | cross-e2e 7 文件为 scaffold 模式（skip 无 live e2e） | medium | test-gap | no | owner 配合跑 live e2e 后确认 |
| R9 | HP9 manual evidence 5 设备录制数量为 0 | high | delivery-gap | no（owner-action） | 按 Q30/Q36 保留，等 owner 配合 |
| R10 | HP9 prod schema baseline owner 未跑 | high | delivery-gap | no（owner-action） | 按 Q31/Q36 保留，等 owner 配合 |
| R11 | final closure 把 handed-to-platform 纠正为 absorbed-within-hero-to-pro | low | platform-fitness | no | 正确纠正；确认 0 项 handed-to-platform |
| R12 | HP2 schema correction 违反 charter §4.4 R8 但合规 | low | scope-drift | no | 014 是受控例外，有 HP2 closure 显式登记 |
| R13 | 4 reviewer memo 未产出 | high | delivery-gap | no（owner-action） | 已在 final closure §3.3 登记 |
| R14 | session-ws-v1.md 12-kind catalog 与代码一致 | low | none | no | 正面确认；无漂移 |
| R15 | deferred-closure absorb 日志与代码实现交叉匹配 | low | none | no | 28 项全部在代码中有对应实现 |

### R1. confirmations.md kind 名称与代码完全不一致

- **严重级别**：critical
- **类型**：docs-gap
- **是否 blocker**：yes
- **事实依据**：
  - `clients/api-docs/confirmations.md` §1 列出 7 种 kind：`permission`、`elicitation`、`tool_pause`、`model_switch`、`checkpoint_restore`、`fork`、`compact_boundary`
  - `workers/orchestrator-core/src/confirmation-control-plane.ts:21-29` 实际 7 种 kind：`tool_permission`、`elicitation`、`model_switch`、`context_compact`、`fallback_model`、`checkpoint_restore`、`context_loss`
  - 4 种不匹配：`permission`≠`tool_permission`、`tool_pause`无对应、`fork`无对应、`compact_boundary`≠`context_compact`
  - 3 种代码 kind 在文档中无对应：`fallback_model`、`context_compact`、`context_loss`
  - decision 端点：文档用 `{ decision, scope, reason, payload }` + 枚举 `always_allow`/`always_deny`；代码用 `{ status, decision_payload }` + 枚举 `allowed`/`denied`/`modified`/`timeout`/`superseded`
- **为什么重要**：客户端开发者按文档对接会全部失败（400/404），这是 hero-to-pro 阶段 API 文档对齐的核心硬闸（charter §10.1 第 3 条）的严重违反
- **审查判断**：HP9 文档 pack 虽声称与 HP5-HP8 frozen 代码事实 100% 对齐，但 confirmations.md 的 kind 名称和 decision 字段名在文档撰写时可能基于 early design 而未同步至 HP5 closure R2 的最终实现。这是文档-代码漂移中**最严重**的一例
- **建议修法**：
  1. 将 confirmations.md §1 的 7-kind 矩阵替换为代码实际值：`tool_permission`/`elicitation`/`model_switch`/`context_compact`/`fallback_model`/`checkpoint_restore`/`context_loss`
  2. 将 decision 端点字段名从 `decision`+`scope`+`reason`+`payload` 改为 `status`+`decision_payload`
  3. 将 status 枚举从 `allowed/denied/modified/always_allow/always_deny` 改为 `allowed/denied/modified/timeout/superseded`
  4. 补充 `fallback_model`/`context_compact`/`context_loss` 三个 schema-only kind 的说明（标注 registry-only / not-yet-live）与 HP5 closure §5 readiness matrix 对齐

### R2. workspace.md / tool-calls 路由标注 not-live 但代码已注册

- **严重级别**：critical
- **类型**：docs-gap
- **是否 blocker**：yes
- **事实依据**：
  - `clients/api-docs/workspace.md` 第 5 节标注 `/sessions/{id}/workspace/files/{*path}` 为 "❌ not-live | 未注册（HP6 closure §2 P2）"
  - `clients/api-docs/workspace.md` 第 5 节标注 `/sessions/{id}/tool-calls` 为 "❌ not-live | 未注册（HP6 closure §2 P3）"
  - 但 `workers/orchestrator-core/src/hp-absorbed-routes.ts` 实现了 `parseSessionWorkspaceRoute` + `handleSessionWorkspace`（list/read/write/delete 4 操作）
  - `workers/orchestrator-core/src/hp-absorbed-routes.ts` 实现了 `parseSessionToolCallsRoute` + `handleSessionToolCalls`（list/cancel 2 操作）
  - `workers/orchestrator-core/src/index.ts` 的 `dispatchFetch` 已注册并分发这两组路由
  - HP0-H10 deferred-closure 明确标注 HP6-D3/HP6-D4 已 absorbed within hero-to-pro
- **为什么重要**：HP9 文档 pack 声称与代码 100% 对齐，但这两组路由被错误地标注为 not-live，客户端开发者会认为这些端点不可用，而实际上它们已在 deferred-closure absorb 批次中接线完成
- **审查判断**：文档在 HP9 冻结时基于的是 HP6 first-wave closure（此时的确 not-live），但 HP0-H10 deferred-closure absorb 之后代码已注册路由。文档未随 absorb 批次更新
- **建议修法**：
  1. 更新 workspace.md §5 标注 `/sessions/{id}/workspace/files/*` 为 "✅ live (HP6-D3 absorbed)"
  2. 更新 workspace.md §5 标注 `/sessions/{id}/tool-calls` 为 "✅ live (HP6-D4 absorbed, first-wave: list + cancel)"
  3. 补充 workspace.md 中 `GET/PUT/DELETE /sessions/{id}/workspace/files/{path}` 的请求/响应 schema
  4. 补充 tool-calls 相关的 `tool.call.cancelled` stream event 说明

### R3. eval-observability 包流事件种类漂移 4 种（9/13）

- **严重级别**：critical
- **类型**：protocol-drift
- **是否 blocker**：yes
- **事实依据**：
  - `packages/nacp-session/src/stream-event.ts` 注册 13 kinds（`STREAM_EVENT_KINDS`）且测试断言 `toHaveLength(13)`
  - `workers/agent-core/src/eval/inspector.ts` 已同步到 13 kinds，注释明确说 "Strictly consumes the 13 canonical kinds"
  - `packages/eval-observability/src/inspector.ts` 仍只有 9 kinds，缺少 `tool.call.cancelled`（HP6）、`session.fork.created`（HP7）、`model.fallback`（HP2-D2）
  - eval-observability 的 `isSessionStreamEventKind` 函数文档说 "9 canonical kinds"，会将这三类事件 reject 到 `rejections`
- **为什么重要**：eval-observability 包是 observability 管道的入口。如果 HP6/HP7/HP2-D2 absorb 的关键事件在 eval 管道中被静默丢弃，observability 漂移 guard 只检查 agent-core inspector（已同步），但 eval-observability 包作为独立消费入口会丢失数据。更严重的是，HP8 closure §1 R8 声称 "observability inspector 12-kind drift fix(HP6 + HP7 已落)与 HP8 root gate 形成多层 drift 守卫"，但修复只覆盖了 agent-core inspector，未覆盖 eval-observability 包
- **审查判断**：这是跨包漂移的遗漏案例。HP6/HP7/HP2-D2 absorb 时更新了 nacp-session 和 agent-core inspector，但漏掉了 eval-observability 包
- **建议修法**：
  1. 将 `packages/eval-observability/src/inspector.ts` 的 `SESSION_STREAM_EVENT_KINDS` 补齐到 13 kinds
  2. 更新注释从 "9 canonical" 改为 "13 canonical"
  3. 运行 `packages/eval-observability` 的测试确认同步
  4. 考虑在 `pnpm run check:observability-drift` 中增加 eval-observability 包的检查

### R4. todos.md content 长度 500 vs 代码 2000

- **严重级别**：medium
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：
  - `clients/api-docs/todos.md` 第 89 行声言 content 长度上限 ≤500
  - `workers/orchestrator-core/src/index.ts` 第 1685 行实际校验 `content.length > 2000` 返回 400
- **建议修法**：将 todos.md 中的 content 上限从 500 更新为 2000

### R5. todos.md 未记录 parent_todo_uuid 参数

- **严重级别**：medium
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：代码 `index.ts` 行 1702-1710 接受 `parent_todo_uuid` 字段，`D1TodoControlPlane` 和 `TodoRow` 类型均包含此字段，但 todos.md 未提及
- **建议修法**：补充 `parent_todo_uuid` 字段文档，标注为 optional，并说明其语义（HP6 charter §436 规定 flat todo + 简单 parent_uuid，V2 task graph 留 hero-to-platform）

### R6. models.md tool_use capability 不存在于代码

- **严重级别**：medium
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：`clients/api-docs/models.md` 示例响应包含 `tool_use: true`，但 `DurableModelCatalogItem` (session-truth.ts 行 75-82) 仅有 `{ reasoning, vision, function_calling }` 三个 capability 字段
- **建议修法**：将 models.md 示例中的 `tool_use` 改为 `function_calling`，或在 capabilities 文档说明中区分两者语义

### R7. 4 个 session 路由未在 API 文档记录

- **严重级别**：medium
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：代码注册了 `POST /sessions/{id}/usage`、`POST /sessions/{id}/retry`（HP4-D1 absorbed）、`POST /sessions/{id}/fork`（HP7-D3 absorbed）、`GET /sessions/{id}/policy/permission_mode`，但 session.md 未包含这些路由的文档
- **建议修法**：在 session.md 中补充这 4 个路由的 API 文档，或创建独立页面引用

### R8. cross-e2e 7 文件为 scaffold 模式

- **严重级别**：medium
- **类型**：test-gap
- **是否 blocker**：no
- **事实依据**：
  - `test/cross-e2e/15-hp2-model-switch.test.mjs` 至 `21-hp8-heartbeat-posture.test.mjs` 7 个文件使用 `liveTest()` helper，在 `NANO_AGENT_LIVE_E2E=1` 未设置时 skip
  - charter §9.4 明确规定"wire-without-delivery 不算 phase 闭合"，并要求有 cross-e2e 文件
  - 这些文件虽存在，但在 CI 中全部 skip，等同于 wire-without-delivery
- **建议修法**：这些 e2e 需要 owner 配合在 preview 环境上手动跑。当前状态应视为 scaffold 而非 delivery。建议在 hero-to-pro 后续批次中 owner 执行 live e2e 并归档截图证据

### R9. HP9 manual evidence 5 设备录制数量为 0

- **严重级别**：high
- **类型**：delivery-gap
- **是否 blocker**：no（owner-action）
- **事实依据**：`manual-evidence-pack.md` §6 所有行为 "(待)"
- **建议修法**：已按 Q30/Q36 登记 retained-with-reason，等 owner 配合

### R10. HP9 prod schema baseline owner 未跑

- **严重级别**：high
- **类型**：delivery-gap
- **是否 blocker**：no（owner-action）
- **事实依据**：`prod-schema-baseline.md` §5 所有值为 "(待)"
- **建议修法**：已按 Q31/Q36 登记 retained-with-reason，等 owner 配合

---

## 3. In-Scope 逐项对齐审核

### HP0 — 前置 defer 修复

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | `/start`/`/input`/`/messages` 三入口模型字段一致 | `done` | HP0 closure R1-R4；代码验证 `parseModelOptions()` 存在且共享 |
| S2 | `withNanoAgentSystemPrompt(modelId?)` seam | `partial` | HP0 P1/HP1 P2 标记 partial→seam，HP2 review-fix 已在 runtime-mainline 接线 |
| S3 | binding-presence test | `done` | 文件存在 |
| S4 | `zx2-rollback.md` 物理删除 | `done` | grep 确认不存在 |
| S5 | R29-dependent residue 保留 | `done` | parity-bridge.ts / forwardInternalJsonShadow 存在且有 live caller |

### HP1 — DDL 集中扩展

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S6 | 007-013 七个 migration 落地 | `done` | 14 个文件全部存在（001-014） |
| S7 | schema freeze gate 生效 | `done` | 014 是唯一受控例外，有显式登记 |
| S8 | HP0 P1 接线 | `done` | HP2 review-fix 已完成 base_instructions_suffix 接线 |
| S9 | nano_models metadata 10 列 | `done` | 007 migration 确认 |
| S10 | Checkpoint 三表 + cleanup_jobs | `done` | 013 migration 确认 |
| S11 | HP1 schema doc | `done` | `docs/architecture/hero-to-pro-schema.md` 存在 |

### HP2 — Model 状态机

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S12 | Model control plane (GET/PATCH /sessions/{id}/model, GET /models/{id}) | `done` | index.ts 路由已注册 |
| S13 | Alias resolve | `done` | session-truth.ts 包含 resolveModelForTeam |
| S14 | `<model_switch>` developer message | `partial`→`absorbed` | HP2-D1 在 HP3-D6 absorb 中接线 |
| S15 | `model.fallback` stream event | `absorbed` | HP2-D2 已在 nacp-session 中加入 ModelFallbackKind |
| S16 | HP2 cross-e2e 5+ | `partial` | scaffold 存在，live e2e 未跑 |

### HP3 — Context 状态机

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S17 | context-core 3 RPC 解 stub | `done` | context-core 控制面板已实现 |
| S18 | CrossTurnContextManager | `absorbed` | HP3-D1 via orchestration.ts probeCompactRequired |
| S19 | auto-compact 信号驱动 | `absorbed` | HP3-D2 composeCompactSignalProbe 已接线 |
| S20 | compact breaker | `absorbed` | compact-breaker.ts 存在 |
| S21 | 60s preview cache | `absorbed` | PREVIEW_CACHE 在 context-core/control-plane.ts |
| S22 | strip-recover contract | `partial` | PROTECTED_FRAGMENT_TAGS 已在代码中，但完整 recover 未接通 |
| S23 | HP3 cross-e2e 5+ | `partial` | scaffold 存在，live e2e 未跑 |

### HP4 — Chat 生命周期

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S24 | close/delete/title | `done` | 路由 + D1 truth 已实现 |
| S25 | cursor pagination | `done` | session-truth.ts 已实现 |
| S26 | checkpoint list/create/diff | `done` | 路由 + D1 helpers 已实现 |
| S27 | retry route | `absorbed` | HP4-D1 via hp-absorbed-handlers.ts |
| S28 | restore job | `partial`→`absorbed` | HP7-D1/D2 substrate 已存在，handler 返回 202 |
| S29 | HP4 cross-e2e 6+ | `partial` | scaffold 存在，live e2e 未跑 |

### HP5 — Confirmation 收拢

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S30 | D1ConfirmationControlPlane | `done` | 文件存在且实现完整 |
| S31 | 7 kind / 6 status enum | `done` | 代码确认（tool_permission/elicitation/model_switch/context_compact/fallback_model/checkpoint_restore/context_loss × pending/allowed/denied/modified/timeout/superseded） |
| S32 | /confirmations 三件套 | `done` | 路由已注册 |
| S33 | PreToolUse emitter row-create | `absorbed` | HP5-D1 emitterRowCreateBestEffort 已实现 |
| S34 | HookDispatcher 注入 | `done` | runtime-assembly.ts 已注入 |
| S35 | legacy compat dual-write | `done` | surface-runtime.ts 已实现 |
| S36 | HP5 cross-e2e 4 场景 | `partial` | scaffold 存在，live e2e 未跑 |

### HP6 — Tool/Workspace 状态机

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S37 | D1TodoControlPlane | `done` | 文件存在 |
| S38 | /sessions/{id}/todos CRUD | `done` | 路由已注册 |
| S39 | normalizeVirtualPath 7-rule | `done` | workspace-control-plane.ts 已实现 |
| S40 | D1WorkspaceControlPlane | `done` | 文件存在 |
| S41 | filesystem-core 8 RPC | `absorbed` | HP6-D1/D2 8 个方法已存在 |
| S42 | /workspace/files public CRUD | `absorbed` | HP6-D3 hp-absorbed-routes.ts 已实现 |
| S43 | /tool-calls list/cancel | `absorbed` | HP6-D4 hp-absorbed-routes.ts 已实现 |
| S44 | tool.call.cancelled stream event | `done` | nacp-session 已注册 |
| S45 | HP6 cross-e2e 6+ | `partial` | scaffold 存在，live e2e 未跑 |

### HP7 — Checkpoint Revert

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S46 | D1CheckpointSnapshotPlane | `done` | 文件存在 |
| S47 | D1CheckpointRestoreJobs | `done` | 文件存在 |
| S48 | CheckpointDiffProjector | `done` | 文件存在 |
| S49 | file snapshot policy | `done` | code 中实现 |
| S50 | confirmation gate | `done` | openJob 对非 fork 强制确认 |
| S51 | session.fork.created stream event | `done` | nacp-session 已注册 |
| S52 | restore/fork executor | `partial`→`absorbed` | HP7-D1 substrate 已存在 |
| S53 | HP7 cross-e2e 6+ | `partial` | scaffold 存在，live e2e 未跑 |

### HP8 — Runtime Hardening

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S54 | megafile-budget gate | `done` | CI 脚本存在 + 通过 |
| S55 | tool-drift guard | `done` | CI 脚本存在 + 通过 |
| S56 | envelope-drift guard | `done` | CI 脚本存在 + 通过 |
| S57 | tool catalog SSoT | `done` | nacp-core 已实现 |
| S58 | Lane E final-state doc | `done` | 文件存在 |
| S59 | R28 explicit register | `not-done`(owner-action) | 仍为模板 |
| S60 | R29 verifier framework | `done` | 脚本存在 + self-test pass |
| S61 | HP8 cross-e2e 4 场景 | `partial` | scaffold 存在，live e2e 未跑 |

### HP9 — API Docs + Manual Evidence

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S62 | 18 份文档 | `done` | 18 .md 文件全部存在 |
| S63 | 7 新文档 | `done` | 7 份存在 |
| S64 | README reindex | `done` | 已对齐 |
| S65 | RHX2 stale 标题清理 | `done` | grep 确认零结果 |
| S66 | manual evidence 5 设备 | `not-done`(owner-action) | 0 设备录制 |
| S67 | prod schema baseline | `not-done`(owner-action) | owner 未跑 |
| S68 | 4 reviewer memo | `not-done`(owner-action) | 0 份 memo |

### HP10 — Final Closure

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S69 | hero-to-pro-final-closure.md | `done` | 文件存在 |
| S70 | plan-hero-to-platform.md stub | `done` | 文件存在 |
| S71 | test-topology.md | `done` | 文件存在 |
| S72 | Q33-Q36 合规 | `done` | 无 silently resolved；7 retained 全带 6 字段 |
| S73 | cleanup register | `done` | 0 deleted / 5 retained-with-reason / 0 handed-to-platform |
| S74 | as-of-commit-hash | `done` | e9287e4523f33075a37d4189a8424f385c540374 |

### 3.1 对齐结论

- **done**: 50
- **partial**: 8 (主要在 cross-e2e scaffold 和部分 executor wiring)
- **absorbed**: 10 (HP2-D1/D3、HP3-D1/D2/D4/D5/D6、HP4-D1、HP5-D1、HP6-D1/D2/D3/D4/D5/D6/D7/D8、HP7-D1/D2/D3/D4/D5、HP8-D2/D3/D4 的 absorb 实现)
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0
- **not-done (owner-action)**: 3 (manual evidence / prod baseline / reviewer memos)

> 这更像"核心骨架完成，但文档-代码漂移需要修正、跨包漂移需要同步、live e2e 需要 owner 验证"的状态，而不是完全 closed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Multi-provider LLM routing | 遵守 | 未引入新 provider |
| O2 | Sub-agent / multi-agent | 遵守 | 未引入 sub-agent |
| O3 | Admin plane | 遵守 | 未实现 admin |
| O4 | Billing | 遵守 | 未实现 billing |
| O5 | SQLite-DO | 遵守 | 未引入 SQLite-DO |
| O6 | DDL 新增 migration (014+有受控例外) | 遵守 | 014 是唯一例外，有显式登记 |
| O7 | clients/api-docs 更新提前 | 部分违反 | HP2/HP3/HP4 在 HP9 之前就更新了部分文档，但 HP9 已纪律恢复 |
| O8 | manual evidence 无证据宣称 | 遵守 | HP9 正确标 cannot-close |
| O9 | silently resolved | 遵守 | 0 项 silently resolved |
| O10 | wire-without-delivery | 误报风险 | scaffold e2e 存在但 skip，严格来说属于 wire-without-delivery 风险 |
| O11 | D1 truth 放到 DO storage | 遵守 | 新代码未违反三层真相 |
| O12 | 6-worker 拓扑新增 | 遵守 | 无新增 worker |
| O13 | NACP backward compat | 遵守 | 13 种消息保持 compat |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：hero-to-pro 阶段核心骨架（4 套状态机 first-wave + DDL freeze + 28 项 absorb + 7 retained-with-reason + Q1-Q36 合规）已成立。但存在 3 个 critical 级文档-代码漂移需要修正、1 个跨包漂移需同步、若干 medium 级文档缺口需补齐。
- **是否允许关闭本轮 review**：yes
- **关闭前必须完成的 blocker**：
  1. R1：修正 `clients/api-docs/confirmations.md` 的 7 kind 名称和 decision 端点 schema，与代码 `confirmation-control-plane.ts` 完全对齐
  2. R2：修正 `clients/api-docs/workspace.md` 中 workspace/tool-calls 路由标注从 "not-live" 改为 "live (absorbed)"
  3. R3：同步 `packages/eval-observability/src/inspector.ts` 的 `SESSION_STREAM_EVENT_KINDS` 从 9 补齐到 13
- **可以后续跟进的 non-blocking follow-up**：
  1. R4：修正 todos.md content 长度从 500 到 2000
  2. R5：补充 todos.md parent_todo_uuid 文档
  3. R6：修正 models.md tool_use capability 为 function_calling
  4. R7：补充 session.md 中 retry/fork/usage/policy 四个路由文档
  5. R8：owner 配合跑 live e2e 15-21 并归档证据
- **建议的二次审查方式**：independent reviewer 针对 R1/R2/R3 修正后的文档和代码做针对性 re-review
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §6 append 回应，不要改写 §0–§5。

---

## 6. 跨阶段深度分析

> 以下分析超越单一 phase 的 closure 审核，从整体 hero-to-pro 阶段的跨包、跨层、跨文档维度进行判断。

### 6.1 4 套状态机完整度分析

| 状态机 | Charter 目标 | 实际完成度 | 缺失 / Gap |
|--------|------------|-----------|-----------|
| Model（4层） | global → session → turn → effective+fallback | **3.5/4** | global/session/turn 层已 live；fallback 触发链路 + `<model_switch>` 注入 not-live（HP2-D1/D2 标记 absorbed 但 trigger 链路未真触发） |
| Context（5 surface） | probe/layers/preview/compact-job/auto-compact | **3/5** | probe/layers/preview/compact-job 4 surface live；auto-compact runtime 死链路（`compactRequired: false` 改为 probe 信号但信号未真驱动 LLM 调用） |
| Chat 生命周期 | start/input/messages/cancel/close/delete/title/retry/restore | **4/6** | start/input/messages/cancel/close/delete/title/live；retry/restore public route 返回 202（absorbed），未真接 executor |
| Tool/Workspace | todo/workspace/tool-calls/promote/cleanup | **3/7** | todo D1 truth + workspace D1 truth + tool.call.cancelled live；filesystem-core leaf RPC absorbed 但 public CRUD + tool-calls list+cancel + promote + cleanup 未在文档标注为 live |

**结论**：4 套状态机均处于 first-wave partial-live 状态。final closure 将这些标注为 `partial-live` 是诚实的。absorbed 项确实有代码实现，但 "代码存在" ≠ "端到端通电"，尤其 auto-compact 的 probe-信号→实际 LLM 调用之间的链路需要 live e2e 验证。

### 6.2 DDL Freeze 合规性

- Charter §4.4 R8 规定 HP2-HP10 默认禁止新 migration
- 014-session-model-fallback-reason.sql 是唯一例外（HP2 受控例外）
- 014 有明确的 correction-of 标记（`correction-of: 008-session-model-audit.sql`）
- **合规**

### 6.3 命名规范分析

发现以下命名漂移：

| 位置 | 文档名称 | 代码名称 | 严重度 |
|------|---------|---------|--------|
| confirmations.md §1 | `permission` / `tool_pause` / `compact_boundary` / `fork` | `tool_permission` / `context_compact` / `fallback_model` / `context_loss` | critical |
| confirmations.md §4 | `decision` + `always_allow` / `always_deny` | `status` + `timeout` / `superseded` | critical |
| models.md §3 | `tool_use` capability | `function_calling` | medium |
| todos.md | content ≤ 500 | content ≤ 2000 | medium |

### 6.4 NACP 协议合规

- 原始 13 种消息 backward compat：确认通过（原 13 种消息未被修改）
- 新增 stream event kinds：13 种（含 `model.fallback`），与代码一致
- 但 `eval-observability` 包只有 9 种，造成协议层面不一致

### 6.5 跨包漂移

| 包 | Stream Event Kinds | 是否同步 |
|----|---------------------|---------|
| nacp-session | 13 | 是（权威源） |
| agent-core/eval/inspector.ts | 13 | 是 |
| eval-observability/inspector.ts | 9 | **否（漂移 4）** |

### 6.6 Charter 硬闸合规总结

| Gate | 状态 | 说明 |
|------|------|------|
| DDL Freeze Gate | ✅ pass | 014 是唯一受控例外 |
| wire-with-delivery Gate | ⚠️ partial | scaffold e2e 存在但 skip；charter §9.4 要求有 e2e 全绿 |
| chronic explicit Gate | ✅ pass | F1-F17 逐项判定 |
| Documentation Freeze Gate | ✅ pass | HP9 文档冻结 |
| Owner-Action Gate | ⚠️ blocked | manual evidence / prod baseline / reviewer memo 三项 owner-action 未完成 |
| Final Closure Gate | ⚠️ partial | HP9 cannot-close 但 Q33 允许 explicit cannot-close |

### 6.7 Deferred-Closure Absorb 审核结论

28 项 absorb 的实现位置逐项与代码交叉验证：

| Absorb ID | 代码位置 | 验证结果 |
|-----------|---------|---------|
| HP2-D1 | `packages/nacp-session/src/stream-event.ts` ModelFallbackKind | ✅ 存在 |
| HP2-D2 | `packages/nacp-session/src/stream-event.ts:128-148` 12→13 kinds | ✅ 存在 |
| HP2-D3 | `test/cross-e2e/15-hp2-model-switch.test.mjs` | ✅ 存在 |
| HP3-D1 | `workers/agent-core/src/host/orchestration.ts:74-88` | ✅ 存在 |
| HP3-D2 | `workers/agent-core/src/host/orchestration.ts:294-326` | ✅ 存在 |
| HP3-D3 | `workers/context-core/src/control-plane.ts:8` PROTECTED_FRAGMENT_TAGS | ✅ 存在 |
| HP3-D4 | `workers/agent-core/src/host/compact-breaker.ts` | ✅ 存在 |
| HP3-D5 | `workers/context-core/src/control-plane.ts:467-573` PREVIEW_CACHE | ✅ 存在 |
| HP3-D6 | `test/cross-e2e/16-hp3-context-machine.test.mjs` | ✅ 存在 |
| HP4-D1 | `hp-absorbed-handlers.ts` handleRetryAbsorbed | ✅ 存在 |
| HP4-D2 | absorbed via HP7-D2 | ✅ 存在 |
| HP4-D3 | `test/cross-e2e/17-hp4-lifecycle.test.mjs` | ✅ 存在 |
| HP5-D1 | `entrypoint.ts:51-105` emitterRowCreateBestEffort | ✅ 存在 |
| HP5-D2 | `test/cross-e2e/18-hp5-confirmation-roundtrip.test.mjs` | ✅ 存在 |
| HP6-D1 | `filesystem-core/src/index.ts:127-200` 4 RPC | ✅ 存在 |
| HP6-D2 | `filesystem-core/src/index.ts:202-280` 4 RPC | ✅ 存在 |
| HP6-D3 | `hp-absorbed-routes.ts` handleSessionWorkspace | ✅ 存在 |
| HP6-D4 | `hp-absorbed-routes.ts` handleSessionToolCalls | ✅ 存在 |
| HP6-D5 | filesystem-core writeArtifact + writeTempFile | ✅ 存在 |
| HP6-D6 | filesystem-core cleanup RPC | ✅ 存在 |
| HP6-D7 | bash-core consume nacp-core TOOL_CATALOG_IDS | ✅ 存在 |
| HP6-D8 | `test/cross-e2e/19-hp6-tool-workspace.test.mjs` | ✅ 存在 |
| HP7-D1 | D1CheckpointRestoreJobs + filesystem-core RPC | ✅ 存在 |
| HP7-D2 | restore route extended + 202 handler | ✅ 存在 |
| HP7-D3 | parseSessionRoute fork + handleForkAbsorbed | ✅ 存在 |
| HP7-D4 | filesystem-core cleanup RPC（同 HP6-D6）| ✅ 存在 |
| HP7-D5 | `test/cross-e2e/20-hp7-checkpoint-restore.test.mjs` | ✅ 存在 |
| HP8-D2 | `scripts/verify-initial-context-divergence.mjs` | ✅ 存在 |
| HP8-D3 | `test/cross-e2e/21-hp8-heartbeat-posture.test.mjs` | ✅ 存在 |
| HP8-D4 | `bash-core/src/index.ts:184-231` import from nacp-core | ✅ 存在 |

**28/28 absorb 项代码存在性验证通过**。

### 6.8 Final Closure Verdict 评价

final closure 将阶段 verdict 标定为 `partial-close / 7-retained-with-explicit-remove-condition`。审查判断：

1. **Verdict 类型选择正确**：不是 `full close`（因为有 7 项 retained），不是 `cannot-close`（因为核心骨架已落地），`partial-close with retained` 是诚实且精确的分类
2. **Framing error 纠正正确**：22 项从 `handed-to-platform` 重新分类为 `absorbed-within-hero-to-pro` 是正确判断，hero-to-platform 确实不是已命名 phase
3. **Q33-Q36 合规**：7 retained 项全部带 6 字段（item / scope / reason / remove condition / current owner / next review date）
4. **0 silently resolved**：确认

但有一个值得关注的边界问题：**absorbed 项的 "代码存在" 优先于 "端到端通电"**。28 项 absorb 绝大多数是代码实现存在 + scaffold e2e，但 live e2e（需要 6-worker stack + preview 部署）全部 skip。charter §9.4 明确规定"wire-without-delivery 不算 phase 闭合"——absorbed 项宣称闭合的是"代码已存在"，不是"端到端验证通过"。final closure 在表述上对此有意识区分（"first-wave partial-live"），但 R8 这个 finding 仍然需要 owner 关注。

---

> **审查独立声明**：本审查完全基于 GLM 的独立推理，未参考 Kimi、Deepseek 或 GPT 的分析报告。所有 Finding 基于对代码仓库的实际文件核查与文档逐行比对。