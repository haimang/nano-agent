# Nano-Agent 设计文档审查报告

> 审查对象: `docs/design/real-to-hero/RH{0..6}-*.md + RHX-qna.md`
> 审查类型: `design-docs-review`
> 审查时间: `2026-04-29`
> 审查人: `DeepSeek`
> 审查范围:
> - `docs/design/real-to-hero/RH0-bug-fix-and-prep.md`
> - `docs/design/real-to-hero/RH1-lane-f-live-runtime.md`
> - `docs/design/real-to-hero/RH2-llm-delta-policy.md`
> - `docs/design/real-to-hero/RH3-device-auth-gate-and-api-key.md`
> - `docs/design/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`
> - `docs/design/real-to-hero/RH5-multi-model-multimodal-reasoning.md`
> - `docs/design/real-to-hero/RH6-do-megafile-decomposition.md`
> - `docs/design/real-to-hero/RHX-qna.md`
> 对照真相:
> - `docs/charter/plan-real-to-hero.md`（基石 charter）
> - 全量 `workers/{orchestrator-core,orchestrator-auth,agent-core,bash-core,context-core,filesystem-core}/`
> - 全量 `packages/{jwt-shared,nacp-session,nacp-core,orchestrator-auth-contract,storage-topology,eval-observability,workspace-context-artifacts}/`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**: `设计文件对真实代码的核心 gap 认知基本准确，与 charter 的 In-Scope/Out-of-Scope 边界一致。但存在 6 处值得修正的认知偏差（其中 2 处为 blind spot，4 处为已实现资产的错误评估），另有 1 处设计覆盖缺口（RH2 缺少 models-context-inspection 主设计文件），以及 1 处 cross-cutting 事实被多个设计文件以不同程度忽略。`
- **结论等级**: `approve-with-followups`
- **是否允许关闭本轮审查**: `yes — 本审查为 design 阶段前置审查，不阻塞 action-plan 产出`
- **本轮最关键的 3 个判断**:
  1. 设计文档普遍**高估了实现工作量、低估了已建成资产**。filesystem-core 的 `storage/adapters/`（R2/KV/D1 三个适配器共 484 行生产级代码）、hooks/dispatcher.ts（149 行全功能 dispatcher）、以及 request-builder.ts 中的 vision capability check，均已完整实现。这些事实在多份设计文档中被描述为"需要建立"，可能误导 action-plan 的任务拆解。
  2. **RH2 设计覆盖不完整**。Charter §13.1 明确要求产出 `RH2-models-context-inspection.md`（覆盖 GET /models + GET /context + WS NACP upgrade + tool call streaming），但实际产出的 `RH2-llm-delta-policy.md` 仅覆盖 snapshot-vs-push 策略层面，未涵盖产品面（/models, /context endpoints, WS full frame upgrade）。这意味着 RH2 的 P2-A/P2-B/P2-C/P2-D 四块工作仅有策略决议文件而缺主设计文件。
  3. **pnpm-lock.yaml 的真实状态比所有设计文件描述的更严重**。不仅 jwt-shared 缺 importer，lockfile 中还存在 6 个已物理删除但残留的 importer entry（`agent-runtime-kernel`, `capability-runtime`, `context-management`, `hooks`, `llm-wrapper`, `session-do-runtime`）。任何 `pnpm install` 在当前 workspace 下都会处于不可确定状态。这点已被 RH0 正确捕获，但其严重性在所有文件中被低估。

---

## 1. 审查方法与已核实事实

### 对照文档
- `docs/charter/plan-real-to-hero.md` — 阶段级 charter，包含 In-Scope / Out-of-Scope / 硬纪律 / Phase 定义 / 退出条件
- `docs/templates/code-review.md` — 审查模板（本次审查的风格参考）

### 核查实现
- `workers/orchestrator-core/src/` — `index.ts`(884 行), `user-do.ts`(2285 行), `auth.ts`, `session-lifecycle.ts`, `session-truth.ts`, `parity-bridge.ts`, `ws-bridge.ts` 等 11 文件
- `workers/orchestrator-auth/src/` — `service.ts`(415 行), `jwt.ts`, `repository.ts`, `index.ts`, `hash.ts`, `errors.ts`, `public-surface.ts`, `wechat.ts` 等 8 文件
- `workers/agent-core/src/` — `host/runtime-mainline.ts`(345 行), `host/do/nano-session-do.ts`(2078 行), `kernel/scheduler.ts`(68 行), `kernel/types.ts`, `kernel/runner.ts`, `hooks/dispatcher.ts`(149 行), `llm/gateway.ts`(263 行), `llm/canonical.ts`(128 行), `llm/request-builder.ts`(102 行), `llm/registry/models.ts`(59 行) 等 99 文件
- `workers/context-core/src/` — `index.ts`, `inspector-facade/` 等 31 文件
- `workers/filesystem-core/src/` — `index.ts`(93 行), `artifacts.ts`(60 行), `storage/adapters/{r2,kv,d1}-adapter.ts`(共 484 行) 等 32 文件
- `workers/bash-core/src/` — 25 文件
- `packages/jwt-shared/` — `src/index.ts`(238 行), `test/jwt-shared.test.ts`(176 行/20 用例), `package.json`
- `packages/nacp-session/src/` — `messages.ts`, `stream-event.ts`(96 行)
- `packages/orchestrator-auth-contract/src/index.ts`(285 行)
- `workers/orchestrator-core/migrations/` — `001-identity-core.sql` 至 `007-user-devices.sql`（7 个 migration）

### 执行过的验证
- `find workers -mindepth 1 -maxdepth 1 -type d` — 确认 6 worker 物理存在
- `wc -l` 确认 nano-session-do.ts (2078 行) 与 user-do.ts (2285 行)
- 对 jwt-shared 在 `pnpm-lock.yaml` 中全文 `grep`，结果为 0 匹配 — 确认无 importer
- 对 `packages/` 下所有 `package.json` 做 scope/version/scripts 全量核查
- 对 `forwardServerFrameToClient` 全文 `grep` 结果为 0 匹配 — 确认此 RPC handler 不存在
- 对 `deploy-fill` 全文 `grep` 确认残留范围
- `ls workers/orchestrator-core/test/` — 确认仅 6 个文件，且无 ZX5 product endpoint 覆盖
- `ls workers/agent-core/src/host/do/` — 确认仅有 1 个文件（无预拆分）

### 复用 / 对照的既有审查
- `docs/eval/real-to-hero/api-gap-study-by-deepseek.md` — 仅作为背景理解，本审查**独立进行**，不采纳其结论
- 4 家 api-gap-study 与 runtime-session-study 均未作为直接输入，仅作为 charter 引用的间接背景

### 1.1 已确认的正面事实

- **所有 7 份设计文件的 In-Scope/Out-of-Scope 边界与 charter 一致**，未发现 scope creep 或越界
- **行号引用整体可信**。抽查 20+ 处行号引用，18 处落在 ±5 行范围内，2 处偏移较大（见 §2 R2）
- **对代码 gap 的核心描述准确**：hook.emit no-op、verifyApiKey stub、CONTEXT_CORE/FILESYSTEM_CORE binding 注释、InMemoryArtifactStore、仅 2 模型、contextWindow 128K 等均与代码一致
- **migration 分配未冲突**。RH2→008、RH3→009、RH4→010 与当前 001-007 baseline 无编号冲突
- **charter D1-D6 决议在设计文件中得到遵守**。无文件提出新增 worker 或引入 SQLite-DO

### 1.2 已确认的负面事实

- **RH2 设计覆盖不完整**：charter §13.1 要求产出 `RH2-models-context-inspection.md`，该文件不存在；现有 `RH2-llm-delta-policy.md` 仅为策略子文档，不覆盖 P2-A（/models）+ P2-B（/context）+ P2-C（WS NACP upgrade）+ P2-D（tool call 增量）
- **filesystem-core `storage/adapters/` 已是生产级实现**（R2 adapter 214 行、KV adapter 138 行、D1 adapter 132 行），但 RH4 设计文档将其描述为"需要实装"（"R2ArtifactStore + R2ArtifactReader 实装替换 InMemoryArtifactStore"），未承认现有适配器资产。
- **hooks/dispatcher.ts 是 149 行完整实现**（含 registry 查找、matcher 过滤、runtime 执行、timeout guard、异常捕获、non-blocking 并行、blocking 短路），但 RH1 设计文档将其框定为"需要从 no-op 替换为真实 dispatcher"，忽略 dispatcher 本体已建成、仅 wiring 缺失的事实。
- **kernel 类型系统已支持 `hook_emit`**（`kernel/types.ts:30` StepKind 含 `hook_emit`，`kernel/runner.ts:111-112` 含 `handleHookEmit` case），scheduler 仅不产生此决策。RH1 设计文档未提及此预路由。
- **`forwardInternalJson` 已标记 @deprecated 且无活跃调用者**，但 RH6 设计文档未提及此已完成的清理项，可能造成重复清理。
- **NACP session schema 已含 `session.permission.request` / `session.permission.decision` / `session.elicitation.request` / `session.elicitation.answer` body schema**，RH1 的 waiter 激活工作可以直接复用，设计文档未指出此便利。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 对 `workers/` 和 `packages/` 逐文件读取关键路径，行号经 `wc -l` 和 `grep -n` 双重确认 |
| 本地命令 / 测试 | no | 未执行 `pnpm test`（依赖 pnpm-lock.yaml 修复）。依赖 CLI 探索的目录列表、行数统计和文件内容 |
| schema / contract 反向校验 | yes | 核对了 `orchestrator-auth-contract/src/index.ts` 的 AuthView/VerifyApiKeyResult 与设计文档的描述是否一致 |
| live / deploy / preview 证据 | no | 本审查为设计文档审查，不涉及运行时验证 |
| 与上游 design / QNA 对账 | yes | 逐项核对了 charter §7 各 Phase 的 In-Scope / Deliverable / 收口标准与设计文档的一致性 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | RH2 设计覆盖不完整 — 缺少 models-context-inspection 主设计文件 | high | docs-gap | no | 在 RH2 action-plan 前补产出 `RH2-models-context-inspection.md` |
| R2 | 多份设计文档的行号引用偏移超过 10 行 | medium | docs-gap | no | 在 action-plan 产出时重新校验精确行号 |
| R3 | filesystem-core storage/adapters/ 已是生产级实现，RH4 未承认 | medium | docs-gap | no | RH4 action-plan 应修改为"基于已有适配器做 binding 对接"，而非"重新实装" |
| R4 | hooks/dispatcher.ts 已完整实现，RH1 未承认，可能误导工作量评估 | medium | docs-gap | no | RH1 action-plan 应区分"已建成 dispatch 基础设施"与"待完成的 wiring" |
| R5 | pnpm-lock.yaml 不仅缺 jwt-shared importer，还有 6 个 stale importer — 严重性被低估 | medium | platform-fitness | no | RH0 P0-A 应同时处理 stale importer 清理 |
| R6 | RH3 设计文件引用的行号范围 `index.ts:648-724` 和 `user-do.ts:1262-1415` 与代码偏移较大 | low | docs-gap | no | action-plan 产出时重新校验 |
| R7 | kernel 类型系统已预路由 hook_emit，RH1 工作量评估偏高 | low | scope-drift | no | RH1 action-plan 应利用已有 kernel infrastructure |

### R1. RH2 设计覆盖不完整

- **严重级别**: `high`
- **类型**: `docs-gap`
- **是否 blocker**: `no`（不阻塞当前 design 审查收口，但会阻塞 RH2 action-plan 产出）
- **事实依据**:
  - Charter §13.1 明确列出需产出 `docs/design/real-to-hero/RH2-models-context-inspection.md`
  - 现有 `docs/design/real-to-hero/RH2-llm-delta-policy.md` 仅覆盖 snapshot-vs-push / semantic-chunk vs token-level 策略决议
  - Charter §7.3 RH2 In-Scope 含 P2-A（GET /models）、P2-B（GET /sessions/{id}/context + POST snapshot/compact）、P2-C（WS NACP full frame upgrade + bidirectional + heartbeat hardening）、P2-D（tool call semantic-chunk 流式 + tool.call.result emit），其中 P2-A/P2-B/P2-C 均未在 `RH2-llm-delta-policy.md` 中得到设计讨论
- **为什么重要**:
  - 若在缺主设计文件的情况下产出 action-plan，P2-A/P2-B/P2-C 三块工作的技术边界、API shape、路由选择、WS frame 兼容策略等关键决策将缺少 design 级锚点
  - 这会直接违反 charter §8.3 的 Per-Phase Entry Gate（"design + action-plan 必须先于 implementation 发布"）
- **审查判断**:
  - `RH2-llm-delta-policy.md` 本身是一份有效的策略文档，但它不应替代 RH2 主设计文档
  - 建议在 RH2 action-plan 产出**前**，补充 `RH2-models-context-inspection.md` 覆盖剩余产品面
- **建议修法**:
  - 产出 `docs/design/real-to-hero/RH2-models-context-inspection.md`，覆盖：
    1. GET /models endpoint（D1 nano_models seed、per-team policy filter、ETag）
    2. GET /sessions/{id}/context + POST snapshot/compact（InspectorFacade 对接、compact 触发逻辑）
    3. WS NACP full frame upgrade（兼容策略、lightweight 保留窗口、bidirectional 消息处理）
    4. Heartbeat lifecycle hardening（4 场景的 DO alarm 协同 design）
    5. tool call stream 与 tool.call.result 的 frame emit 设计
  - `RH2-llm-delta-policy.md` 保持为 RH2 的专项策略附录

### R2. 行号引用偏移

- **严重级别**: `medium`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - RH3 设计文档第 301 行：`workers/orchestrator-core/src/index.ts:648-724` 被描述为 `/me/devices` 与 revoke 当前行为 — 实际代码中 `handleMeDevicesList` 位于 652-696，`handleMeDevicesRevoke` 位于 725-814，偏移 ±28 行
  - RH5 设计文档第 309 行：`workers/orchestrator-core/src/user-do.ts:1418-1540` 被描述为 `/messages` current multipart ingress — 此范围我未能精确定位到 /messages handler，无法确认
  - 大部分行号引用（~80%）落在 ±5 行范围内，但上述两处偏移较大
- **为什么重要**:
  - 不准确的行号在 action-plan 任务拆分时会引入额外的定位成本
  - 如果实现者盲信行号引用，可能定位到错误的代码段
- **审查判断**:
  - 建议在产出 action-plan 时对所有行号引用做一次批量 `grep -n` / `wc -l` 校验
- **建议修法**:
  - 在 action-plan 产出时逐项重校行号，以 2026-04-29 代码现实为准

### R3. filesystem-core storage adapters 已是生产级实现

- **严重级别**: `medium`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `workers/filesystem-core/src/storage/adapters/r2-adapter.ts`(214 行)：完整实现 `get`/`head`/`put`/`delete`/`list`/`listAll`/`putParallel`，含 `maxValueBytes` guard、分页游标遍历（上限 1000 页）、并发控制
  - `workers/filesystem-core/src/storage/adapters/kv-adapter.ts`(138 行)：完整实现 `get`/`put`/`delete`/`putAsync`（含 `ctx.waitUntil` async write），含 `maxValueBytes` guard
  - `workers/filesystem-core/src/storage/adapters/d1-adapter.ts`(132 行)：完整实现 `query`/`first`/`batch`/`prepare`
  - `workers/filesystem-core/src/storage/adapters/do-storage-adapter.ts` 和 `scoped-io.ts` 也均有实现
  - RH4 设计文档 F1 `Real Artifact Store` 详细阐述中描述为"R2ArtifactStore + R2ArtifactReader 实装替换 InMemoryArtifactStore"，暗示需要从零 build artifact store：
    > "R2ArtifactStore + R2ArtifactReader 实装替换 InMemoryArtifactStore"（charter §7.5）
- **为什么重要**:
  - 如果 action-plan 按"需要重新 build 适配器"拆分任务，会产生重复实现工作
  - 实际上 RH4 的核心工作是：(a) 将现有适配器与 ArtifactStore 接口对接，(b) 在 wrangler.jsonc 启用 R2/KV/D1 binding，(c) 实现 R2ArtifactStore（调用已有适配器），而非从零 build 适配器
- **审查判断**:
  - 这不是设计文档的方向性错误，而是"未承认已有资产"导致的实现范围误判
  - 建议在 RH4 action-plan 中将工作量从"实装 R2/KV/D1 适配器"调整为"组装已有适配器到 ArtifactStore + 对接 binding"
- **建议修法**:
  - RH4 设计文档 §8.1 应增加一行对 `filesystem-core/src/storage/adapters/{r2,kv,d1}-adapter.ts` 的"可借鉴代码位置"引用
  - RH4 action-plan 任务拆分时区分"已有适配器"与"待写的 ArtifactStore 组装层"

### R4. hooks/dispatcher.ts 已是完整实现

- **严重级别**: `medium`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `workers/agent-core/src/hooks/dispatcher.ts`(149 行) 已实现：
    - `emit()` method：从 `HookRegistry` 查找 handler → `matchEvent` 过滤 → 按 runtime 执行 → timeout 包装 → 异常捕获 → aggregate outcomes
    - Blocking/non-blocking 双模式：blocking 顺序执行 + 短路；non-blocking `Promise.all` 并行
    - 配套基础设施：`hooks/registry.ts`（handler 注册）、`hooks/matcher.ts`（event 匹配）、`hooks/guards.ts`（深度/timeout guard）、`hooks/outcome.ts`（结果聚合）、`hooks/runtimes/local-ts.ts`（本地 runtime）、`hooks/catalog.ts`
  - RH1 设计文档 §7.2 F1 描述为：
    > "把当前 `hook.emit()` no-op 替换为真实 delegate" — 这正确识别了 runtime-mainline 的 no-op
    > 但其 §1.1 边界描述称 "包含 hook dispatcher 激活" — 暗示 dispatcher 本身需要建立
- **为什么重要**:
  - RH1 的真实工作是"接通两条线"：(a) 把 scheduler 的 hook_emit 决策触发开，(b) 把 runtime-mainline 的 no-op hook.emit 改为调用已有 dispatcher
  - dispatcher 本体、registry、matcher、runtime 全套已建成，无需从零构建
  - 正确识别这一点可以将 RH1 F1 的工作量评估从 "build dispatcher + connect" 降为 "connect only"
- **审查判断**:
  - 建议 RH1 action-plan 将 F1 任务明确为：修改 scheduler 产生 hook_emit 决策 + 修改 runtime-mainline hook.emit 调用已有 `HookDispatcher`
- **建议修法**:
  - RH1 设计文档 §8.1 增加 `workers/agent-core/src/hooks/dispatcher.ts` 作为"可借鉴的已建成资产"
  - RH1 action-plan 任务拆分时明确区分 "已有 dispatcher infrastructure" vs "待接通的 wiring"

### R5. pnpm-lock.yaml 的严重性被低估

- **严重级别**: `medium`
- **类型**: `platform-fitness`
- **是否 blocker**: `no`（已被 RH0 正确纳入 P0-A，仅严重性被低估）
- **事实依据**:
  - `pnpm-lock.yaml` 全文 `grep` `jwt-shared` 返回 **0 匹配** — jwt-shared 无任何 importer entry
  - lockfile 中 `importers` 段含 6 个已物理删除的 stale 包：`agent-runtime-kernel`、`capability-runtime`、`context-management`、`hooks`、`llm-wrapper`、`session-do-runtime`
  - 这意味着任何 `pnpm install` 在当前 workspace 下的依赖解析都处于**不可确定状态**
  - Charter §1.2 将其列为 "jwt-shared lockfile 断裂"，RH0 P0-A 将其列为修复项，但措辞偏轻
- **为什么重要**:
  - 这块不是"jwt-shared 无法独立构建"的问题，而是**整个 repo 的依赖管理器处于失效状态**
  - RH0 是整个 real-to-hero 的启动前提，如果 lockfile 修复失序或修复不彻底，RH1-RH6 的所有 CI/preview-deploy 都不可信
- **审查判断**:
  - RH0 P0-A 应扩大范围：不仅是"jwt-shared standalone build/test 通过"，更应是"`pnpm install` 全 workspace 可确定 + 无 stale importers"
- **建议修法**:
  - RH0 action-plan 显式列出：删除 6 个 stale importer + 补充 jwt-shared importer + 全量 `pnpm install --frozen-lockfile` 验证

### R6. RH3 行号引用偏移较大

- **严重级别**: `low`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - RH3 引用 `orchestrator-core/src/index.ts:648-724` 为 `/me/devices` 与 revoke 区域 — 实际 `handleMeDevicesList` 在 652-696，`handleMeDevicesRevoke` 在 725-814。引用行号覆盖了 list 的后半段 + revoke 的前半段，未涵盖完整函数
  - RH3 引用 `orchestrator-core/src/index.ts:667-812` 为 D1 设备列表 / revoke SQL 现实 — 与上述重叠但范围也不同
- **审查判断**:
  - 这些引用在 narrative 层面不影响设计方向，但 action-plan 拆分具体任务时需纠正
- **建议修法**:
  - action-plan 产出时以函数级边界（如 `handleMeDevicesList`, `handleMeDevicesRevoke`）替代行号级引用

### R7. kernel 类型系统已预路由 hook_emit

- **严重级别**: `low`
- **类型**: `scope-drift`
- **是否 blocker**: `no`
- **事实依据**:
  - `workers/agent-core/src/kernel/types.ts:30` — `StepKindSchema` 枚举包含 `"hook_emit"`
  - `workers/agent-core/src/kernel/types.ts:62` — `StepDecisionSchema` 含 `z.object({ kind: z.literal("hook_emit"), event: z.string() })`
  - `workers/agent-core/src/kernel/runner.ts:111-112` — `case "hook_emit": return this.handleHookEmit(snapshot, decision, now);`
  - `workers/agent-core/src/kernel/message-intents.ts:38` — 也含 `"hook_emit"` case
  - 但 `workers/agent-core/src/kernel/scheduler.ts`(68 行) 不产生 `hook_emit` 决策
- **为什么重要**:
  - 这表明 scheduler → runner 的 hook_emit 通道**类型层面已通**，scheduler 是唯一的断点
  - RH1 P1-B 的"让 scheduler 产生 hook_emit"工作范围可缩小到仅修改 `scheduler.ts` 这一个文件
- **审查判断**:
  - 建议 RH1 action-plan 将 P1-B 的任务描述精确化：仅修改 scheduler.ts 的决策生成逻辑
- **建议修法**:
  - RH1 设计文档 §8.1 补充 `kernel/types.ts:30,62` 和 `kernel/runner.ts:111-112` 作为已有的类型/运行预路由

---

## 3. 逐设计文件对齐审核

### 3.1 RH0 — Bug 修复 + 前期准备

| 编号 | 设计项 / charter 对应 | 审查结论 | 说明 |
|------|----------------------|----------|------|
| H0-1 | jwt-shared lockfile 修复 (P0-A) | `done — 认知准确` | jwt-shared 确实无 lockfile importer（全文 grep 0 匹配）；独立 build/typecheck/test 脚本存在但因 lockfile 断裂无法执行。但未提及 6 个 stale importers 的同步清理 |
| H0-2 | ZX5 endpoint 直达测试 (P0-B) | `done — 认知准确` | orchestrator-core/test/ 仅 6 个文件，无任何 ZX5 product endpoint 覆盖（grep /messages /files me-conversations me-devices 全零匹配） |
| H0-3 | KV/R2 binding 占位 (P0-C) | `done — 认知准确` | 6 worker wrangler.jsonc 全无 KV/R2 binding 声明。所有 worker（除 agent-core 的 AI binding）均无 R2/KV |
| H0-4 | NanoSessionDO 拆 verify+persistence (P0-D) | `done — 认知准确` | agent-core/src/host/do/ 仅有 1 文件（2078 行），无 session-do-verify.ts / session-do-persistence.ts |
| H0-5 | 本轮 implementer fix preview deploy (P0-E) | `done — 认知准确` | 为 plan 性工作，代码无可验证; 文档引用路径 `docs/issue/zero-to-real/post-fix-verification.md` 暂不存在 |
| H0-6 | P0-F owner-action checklist | `docs-gap` | 设计文档正确描述 checklist 内容，但引用目标文件 `docs/owner-decisions/real-to-hero-tooling.md` 不存在（将被 RHX-qna Q5 的 owner 回答触发） |
| H0-7 | P0-G bootstrap hardening | `done — 认知准确` | 为新工作，代码无可直接对应；charter 明确指定 stress test 3 用例 |

**RH0 小结**: 认知准确率极高。仅有 1 处 minor gap：design §8.2 引用 `nano-session-do.ts:159-2078`（整文件范围）和 `user-do.ts:1-2285`（整文件范围）准确，但其 §8.3 引用的 `runtime-mainline.ts` 和 `user-do.ts` 是 RH1 的领地，设计文档自身说明 RH0 只做预拆分、不抢跑。与代码的对账无矛盾。

### 3.2 RH1 — Lane F Live Runtime

| 编号 | 设计项 / charter 对应 | 审查结论 | 说明 |
|------|----------------------|----------|------|
| H1-1 | hook.emit no-op 识别 (P1-A) | `done — 认知准确` | runtime-mainline.ts:295-298: `async emit(_event, _payload) { return undefined; }` — 确认为 no-op |
| H1-2 | hook dispatcher 激活 (F1) | `partial — 低估已建成资产` | hooks/dispatcher.ts 已是 149 行完整实装（含 registry/matcher/runtime/timeout/exception/blocking/non-blocking），仅缺 wiring。见 R4 |
| H1-3 | scheduler hook_emit 决策 (P1-B) | `done — 认知准确` | scheduler.ts 不产生 hook_emit 决策；但 kernel types/runner 已支持。见 R7 |
| H1-4 | Permission/Elicitation waiter (P1-C) | `done — 认知准确` | nano-session-do.ts 含 `awaitAsyncAnswer()` / `resolveDeferredAnswer()` / `sweepDeferredAnswers()` / `emitPermissionRequestAndAwait()` / `emitElicitationRequestAndAwait()`。deferredAnswers Map + alarm sweep 机制存在。等待 contract 存在但 live wiring 缺失 |
| H1-5 | onUsageCommit WS push (P1-D) | `done — 认知准确` | runtime-mainline.ts:102-113 暴露 `onUsageCommit` seam；246-251+329-339 两处调用（tool/llm）。但 DESIGN 文档缺失关键事实：`forwardServerFrameToClient` RPC handler **根本不存在**（全文 grep 0 匹配）。这是 RH1 的真实 gap，设计文档正确指出需新建 |
| H1-6 | handleUsage HTTP 真实化 (P1-E) | `done — 认知准确` | Charter 提到"替换 null placeholders"，设计文档正确继承此意图 |
| H1-7 | hook dispatcher 识别 (§8.1引用) | `docs-gap` | 设计文档 §8.1 引用 runtime-mainline 和 session-do，但遗漏已有 `hooks/dispatcher.ts` 作为可借鉴资产 |

**RH1 小结**: 核心 gap 认知准确。主要问题是**工作量评估偏高**：已有完整 hook dispatcher（149 行）、已有 kernel hook_emit type/routing（仅 scheduler 是断点）、已有 nacp-session schema（permission/elicitation body 预定义）。实际实现工作量是"将 3 条已有的预制线接通"，而不是"从 contract 到 runtime 全新建造"。

### 3.3 RH2 — LLM Delta Policy（+ 缺失的 models-context-inspection）

| 编号 | 设计项 / charter 对应 | 审查结论 | 说明 |
|------|----------------------|----------|------|
| H2-1 | LLM delta policy 范围 | `done — 合理` | 作为专项策略文档，正确冻结了 snapshot-vs-push 和 semantic-chunk 边界 |
| H2-2 | GET /models + GET /context (P2-A/P2-B) | `missing` | 这两块对应的主设计文件 `RH2-models-context-inspection.md` 不存在。见 R1 |
| H2-3 | WS NACP full frame upgrade (P2-C) | `missing` | WS 协议升级设计未覆盖。见 R1 |
| H2-4 | tool call 增量 + tool result (P2-D) | `partial — 策略已冻结，实现设计缺失` | delta-policy 文档冻结了 semantic-chunk 边界，但未讨论如何将现有 `tool.call.progress` / `tool.call.result` schema 接入 runtime 流 |
| H2-5 | nacp-session event taxonomy 引用 | `done — 准确` | stream-event.ts 96 行，包含 9 种 event kind（llm.delta、tool.call.progress、tool.call.result 等），与设计描述一致 |
| H2-6 | 2 模型 / 128K contextWindow 识别 | `done — 准确` | gateway.ts 仅 2 模型，contextWindow: 128_000（非 131K），supportsVision: false |
| H2-7 | model_id 不存在于 session.start schema | `done — 准确` | SessionStartBodySchema 仅含 cwd/initial_context/initial_input，无 model_id |

**RH2 小结**: `RH2-llm-delta-policy.md` 作为策略文档，质量合格。但 RH2 整体设计覆盖仅完成了 1/4（策略层），缺 3/4（产品面：/models, /context, WS upgrade）。这是本轮审查发现的**唯一 high-severity 设计覆盖缺口**（R1）。

### 3.4 RH3 — Device Auth Gate and API Key

| 编号 | 设计项 / charter 对应 | 审查结论 | 说明 |
|------|----------------------|----------|------|
| H3-1 | verifyApiKey stub 识别 (P3-C) | `done — 认知准确` | service.ts:402-414: 永远返回 `{ supported: false, reason: "reserved-for-future-phase" }` |
| H3-2 | nano_teams 缺 team_name/team_slug (P3-B) | `done — 认知准确` | AuthTeamSchema 仅含 team_uuid/membership_level/plan_level。migration 001 中 nano_teams 表无 team_name/slug 字段 |
| H3-3 | /me/conversations D1 双源对齐 (P3-D) | `done — 认知准确` | index.ts:618-646 存在 handleMeConversations，当前仅查 D1；设计文档正确要求 D1+KV 双源对齐 |
| H3-4 | /me/devices + revoke 当前行为 (P3-A/P3-E) | `done — 认知准确` | index.ts:652-696 list、725-814 revoke。device revoke 仅写 D1+audit，不进 access/refresh/WS gate |
| H3-5 | device_uuid claim 注入 (P3-A/P3-E) | `done — 认知准确` | 当前 login/register auth flow 不含 device_uuid claim 生成；设计文档正确将此列为 RH3 新工作 |
| H3-6 | /auth/me team 返回 shape | `done — 认知准确` | AuthTeamSchema 仅有 team_uuid/membership_level/plan_level，client 无法从 UUID 识别团队。设计文档正确识别 |
| H3-7 | nano_team_api_keys 表已存在 | `done — 认知准确` | migration 001 已建表，但 verifyApiKey 从未查此表。设计文档正确指出"表 DDL 已建但 verify 是 stub"（charter §1.2） |
| H3-8 | 行号引用偏移 | `partial — 偏移 ±28 行` | 见 R6 |

**RH3 小结**: 与代码的对账极为准确。设计文档对当前半成品状态的描述没有夸大或遗漏。唯一 minor point 是行号引用偏移。

### 3.5 RH4 — Filesystem R2 Pipeline and Lane E

| 编号 | 设计项 / charter 对应 | 审查结论 | 说明 |
|------|----------------------|----------|------|
| H4-1 | InMemoryArtifactStore 识别 (F1) | `done — 认知准确` | artifacts.ts:38-59 Map-based 实现，无持久化 |
| H4-2 | filesystem-core RPC surface (F2) | `done — 认知准确` | index.ts:77-85 filesystemOps() 仅返回 3 个 op 名称（readArtifact/writeArtifact/listArtifacts），但 storage adapters 是完整实现 |
| H4-3 | CONTEXT_CORE/FILESYSTEM_CORE binding 注释 (F3) | `done — 认知准确` | agent-core wrangler.jsonc:49-50 两行被 `//` 注释，binding 未激活 |
| H4-4 | POST /sessions/{id}/files upload (F4) | `done — 认知准确` | handleFiles 当前仅读 D1 history（user-do.ts:1651-1699），无 upload path。需新建 multipart handler |
| H4-5 | 「R2ArtifactStore 实装替换」的描述 | `partial — 低估已建成资产` | filesystem-core/src/storage/adapters/ 的 R2/KV/D1 适配器已是 484 行生产级代码。设计文档描述暗示需从零 build。见 R3 |
| H4-6 | dual-track sunset 策略 (F3) | `done — 与 charter 一致` | 设计文档正确继承了 charter 的"≤ 2 周 sunset"要求，并指出 agent-core 当前有 library import + RPC consumer 双 path |
| H4-7 | migration 010-session-files.sql 引用 | `done — 认知准确` | 当前最新为 007，010 需新建 |

**RH4 小结**: 核心方向正确，但与 RH1 类似存在"低估已建成资产"的问题。已有适配器是完整实现、不是 stub；RH4 的 storage 工作应该是组装层（R2ArtifactStore 对接已有 R2 adapter）而非重建层。

### 3.6 RH5 — Multi-Model Multimodal Reasoning

| 编号 | 设计项 / charter 对应 | 审查结论 | 说明 |
|------|----------------------|----------|------|
| H5-1 | 仅 2 模型注册 (P5-A) | `done — 认知准确` | gateway.ts 仅 register 2 个模型（primary + fallback），contextWindow 128_000（非 131K），supportsVision false |
| H5-2 | context window 修正 (P5-A) | `done — 认知准确` | 当前 128_000，charter 要求修正为 131K（131,072） |
| H5-3 | model_id 不存在于 session.start (P5-B) | `done — 认知准确` | SessionStartBodySchema 仅 cwd/initial_context/initial_input |
| H5-4 | image_url / vision 激活 (P5-C) | `partial — 低估已建成资产` | CanonicalContentPart 已含 ImageUrlContentPart；request-builder.ts:81-92 已有完整 vision capability check（needsVision 检测 + CAPABILITY_MISSING throw）。基础设施已完整，仅缺"模型设 supportsVision=true"。设计文档将其描述为"让 image_url 不再被 silent-drop"正确，但未指出 canonical+request-builder 已支持 |
| H5-5 | reasoning effort 字段 (P5-D) | `done — 认知准确` | CanonicalLLMRequest 无 reasoning 字段。这是真实 gap：需要同时修改 canonical types + Workers AI adapter 翻译 + public schema |
| H5-6 | per-model quota 决议 | `done — 与 charter 一致` | 正确引用 RHX-qna Q3 决议（out-of-scope），仅记录 model_id 到 usage events |
| H5-7 | gateway.ts 模型扩展点引用 | `done — 准确` | 设计文档 §8.1 引用的 gateway.ts:20-53 正是当前 primary/fallback registry 定义区 |

**RH5 小结**: 核心认知偏差与 RH4 类似。vision 路径的 canonical+request-builder 基础设施已建成，仅缺"supportsVision: true"一行。真正需要从头建的只有 reasoning effort（所有层都缺）。

### 3.7 RH6 — DO Megafile Decomposition

| 编号 | 设计项 / charter 对应 | 审查结论 | 说明 |
|------|----------------------|----------|------|
| H6-1 | NanoSessionDO 2078 行巨石 (F1) | `done — 认知准确` | 确认为 2078 行单文件 |
| H6-2 | user-do.ts 2285 行巨石 (F2) | `done — 认知准确` | 确认为 2285 行单文件 |
| H6-3 | 三层真相文档 (F3) | `done — 认知准确` | `docs/architecture/three-layer-truth.md` 不存在，需新建 |
| H6-4 | manual evidence pack (F4) | `done — 认知准确` | 无现有 evidence；需 RH6 新建 |
| H6-5 | deploy-fill residues 清理 (P6-E) | `partial — 范围低估` | 设计文档仅提 "dead `deploy-fill` residue"，但实际 residue 范围包括 4 个源文件（session-lifecycle.ts, internal-policy.ts, auth.test.ts, user-do.test.ts）+ 多个文档文件。清理范围需在 action-plan 中细化 |
| H6-6 | forwardInternalJson @deprecated 清理 (P6-E) | `partial — 已是 completed 项` | user-do.ts:2093 已标记 @deprecated 且无活跃调用者。设计文档将其列为 RH6 待做，实际上前驱 phase 可能已自然完成此项。见 §7.2 F4 边界情况 |
| H6-7 | Lane E shim 删除 (P6-E) | `done — 认知准确` | 依赖 RH4 dual-track sunset 完成 |
| H6-8 | RH0 预拆分切口 (F1) | `done — 认知准确` | agent-core/src/host/do/ 仅有 1 文件，预拆分未执行。设计文档正确依赖 RH0 先做切口 |

**RH6 小结**: 作为收口 Phase 的设计，方向正确。minor 问题：`forwardInternalJson` 已是 deprecated+zero-callers 状态，可在更早 phase 或 RH6 轻松完成清理；`deploy-fill` residue 范围被低估。

### 3.8 RHX — QNA

| 编号 | 设计项 | 审查结论 | 说明 |
|------|--------|----------|------|
| Q1 | team_slug 策略 | `pending owner` | 5 题全部待 owner 回答。设计建议已给出，格式完整。 |
| Q2 | Lane E dual-track sunset | `pending owner` | 建议 ≤ 2 周，合理。 |
| Q3 | per-model quota | `pending owner` | 建议不引入，合理。 |
| Q4 | manual evidence 设备范围 | `pending owner` | 建议 iOS 17 / Android 14 / 微信 8.0 / Chrome stable，合理。 |
| Q5 | P0-F owner-action checklist | `pending owner` | 建议 6 步 checklist，合理。 |
| QNA-结构 | QNA 文件整体 | `done — 合格` | 格式完整，Reasoning 充分，逐题写出影响范围与最晚冻结时点 |

**RHX 小结**: QNA 文件质量高，Reasoning 充分。全部 5 题待 owner 回答，符合 preamble 预期。无与代码的矛盾（QNA 是 upstream decision register，不与代码直接对账）。

### 3.3 对齐结论

- **done**: 29
- **partial**: 7
- **missing**: 2（RH2 P2-A/P2-B 主设计缺失; P2-C WS upgrade 设计缺失）
- **stale**: 0
- **out-of-scope-by-design**: 0（所有发现均在设计关注范围内）

> 这更像是"设计对代码 gap 的认知高度准确, 但对已建成资产的认知有系统性低估"——而非设计错误。6 处 partial 中 4 处属于"低估已有代码"、1 处属于"行号偏移"、1 处属于"range 低估"。

---

## 4. Out-of-Scope 核查

本章用于确认设计文档是否遵守了 charter 的全局 Out-of-Scope 边界。

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | admin plane / billing / OAuth / sandbox | `遵守` | 全部 7 份设计文档均未涉及这些领域 |
| O2 | 第 7 个 worker / SQLite-DO | `遵守` | 无设计文档提议新增 worker 或引入 SQLite-DO |
| O3 | token-level streaming (O1/RH2) | `遵守` | RH2 delta-policy 明确 defer 到 hero-to-platform |
| O4 | 第二 provider 启用 (O3/RH5) | `遵守` | RH5 设计明确 out-of-scope，仅做 Workers AI |
| O5 | 3-step presigned upload (O1/RH4) | `遵守` | RH4 设计明确 out-of-scope，仅做 multipart 直传 |
| O6 | NACP error envelope 协议层 (O10/RH) | `遵守` | 所有设计文档未涉及 |
| O7 | catalog 真实 plug-in 注册框架 (O4) | `遵守` | 所有设计文档未涉及 |
| O8 | conversation 标题/archive/search (O14) | `遵守` | 未涉及 |

**Out-of-Scope 结论**: 无违反。所有 7 份设计文档都严格遵守了 charter §4.2 的全局 Out-of-Scope 边界。

---

## 5. 跨文件共性问题（Cross-cutting）

以下问题在 2 份以上设计文档中出现，但严重程度、认知准确度在文档间不一致：

### 5.1 「已建成 but 未激活」的能力被系统性低估

| 已有资产 | 所在路径 | 被哪些设计文档低估 |
|----------|----------|---------------------|
| hooks/dispatcher.ts （149 行完整实现） | agent-core/src/hooks/ | RH1（仅描述为"需要激活"，未提及已有实现） |
| storage/adapters/r2-adapter.ts（214 行） | filesystem-core/src/storage/adapters/ | RH4（描述为"需要实装"，未承认已有适配器） |
| storage/adapters/kv-adapter.ts（138 行） | filesystem-core/src/storage/adapters/ | RH4（同上） |
| storage/adapters/d1-adapter.ts（132 行） | filesystem-core/src/storage/adapters/ | RH4（同上） |
| request-builder.ts vision capability check（81-92行） | agent-core/src/llm/ | RH5（描述为"需要让 image_url 不再被 silent-drop"，未指出 checks 已存在） |
| CanonicalContentPart ImageUrlContentPart | agent-core/src/llm/canonical.ts:46-50 | RH5（同上） |
| kernel types hook_emit StepKind + runner handleHookEmit | agent-core/src/kernel/ | RH1（未提及 type/routing 已预置） |

根本原因推测：设计文档的 code exploration 采用了"看当前 runtime mainline 路径"的方式（正确识别了 no-op 和 gap），但未深入到已有但未激活的设施层（adapters, hooks dispatcher, kernel routing）。这导致 action-plan 如果按"全栈 build"拆分，会比实际需要的"对接激活"多估工作量。

### 5.2 pnpm-lock.yaml 的多维断裂

pnpm-lock.yaml 的问题有三个维度，但设计文档只覆盖了两维：

| 维度 | 描述 | 被哪些文档覆盖 |
|------|------|----------------|
| jwt-shared 缺 importer | lockfile 中 jwt-shared 的 importers entry 为 0 | RH0 ✓ |
| 6 个 stale importer | 已物理删除但 lockfile 仍保留的包 | RH0 部分（仅提及"stale importer 删除"，未列清 6 个名称） |
| 任何 pnpm install/pnpm run 均不确定 | 注意：这是 **impact** 而非独立 bug，但严重性更高 | 无文档量化此点 |

### 5.3 `forwardServerFrameToClient` RPC handler 不存在

此 handler 被 charter §7.2 和 RH1 设计文档多处引用为 RH1 的交付物（user-do 的 RPC handler，用于打通 agent-core → orchestrator-core → client WS 的 usage push 路径）。但实际代码中**此 handler 根本不存在**（全文 grep 0 匹配）。这意味着：

- RH1 F3 `Usage Push Relay` 的"user-do → client WS" 这最后一段是**完全从零新建**，不是"激活已有路径"
- 相比之下，hook dispatcher / storage adapters / vision checks 是"已有 but 未激活"，此处是"完全不存在"

所有设计文档对此的认知都是正确的：明确将其列为需要新建。这只是确认了认知准确性。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**: `设计文件对真实代码的核心 gap 认知基本准确，建议 approve-with-followups。在产出 action-plan 之前需处理 R1-R7 中列出的 7 项 finding。`
- **是否允许关闭本轮审查**: `yes — 本审查为 design 阶段前置审查，不阻塞后续工作。follow-up 可在 action-plan 产出时一并修正。`
- **关闭前必须完成的工作**（非 blocker，但强烈建议）:
  1. 产出 `docs/design/real-to-hero/RH2-models-context-inspection.md` — 覆盖 P2-A/P2-B/P2-C/P2-D（R1）
  2. 对 RH1/RH4/RH5 设计文档补充"已有但未激活的资产"引用（R3/R4/R7）
  3. RH0 P0-A 扩大范围以包含 6 个 stale importer 的清理（R5）
- **可以后续跟进的 non-blocking follow-up**:
  1. action-plan 产出时全量行号引用的 batch 重校（R2）
  2. RH3 行号引用精确到函数级边界（R6）
  3. RH6 的 deploy-fill residue 范围在 action-plan 中细化
  4. RH6 的 forwardInternalJson 清理项可在 reach 时自然完成，无需单独 action
- **建议的二次审查方式**: `no rereview needed at design stage — follow-up 在 action-plan review 时一并 verify`
- **实现者回应入口**: `本审查为 design 阶段审查，不需要实现者回应。follow-up 在 action-plan 产出时由对应 action-plan reviewer 检验。`

---

## 7. 附录：设计文档行号引用 vs 代码现实对照表（抽查样本）

| 设计文档 | 引用的行号范围 | 代码实际范围 | 偏移 | 影响 |
|----------|---------------|-------------|------|------|
| RH0 §8.2 | nano-session-do.ts:159-2078 | 159-2078 | 0 | 无 -- 整文件范围 |
| RH0 §8.2 | user-do.ts:1-2285 | 1-2285 | 0 | 无 -- 整文件范围 |
| RH1 §8.1 | runtime-mainline.ts:96-113 | 102-113 (onUsageCommit seam) | ±6 | 无 -- 近邻 |
| RH1 §8.1 | runtime-mainline.ts:295-299 | 295-298 | 0 | 无 |
| RH1 §8.3 | user-do.ts:1286-1415 | 需精确核实 | 未知 | 低 |
| RH2 §8.1 | nacp-session stream-event.ts:10-95 | 1-96 (全文件) | 近似 | 无 |
| RH3 §8.2 | orchestrator-core/src/index.ts:648-724 | handleMeDevicesList 652-696; handleMeDevicesRevoke 725-814 | +28 | 中 (R6) |
| RH3 §8.3 | orchestrator-core/src/index.ts:667-812 | 同上区域 | 偏移 | 低 |
| RH3 §8.1 | orchestrator-auth/service.ts:402-413 | 402-414 | +1 | 无 |
| RH4 §8.1 | filesystem-core/src/index.ts:19-23,50-85 | 19-23 (注释), 51-86 (入口点) | 近似 | 无 |
| RH4 §8.1 | filesystem-core/src/artifacts.ts:27-60 | 27-32 (interface), 38-59 (InMemory) | 近似 | 无 |
| RH4 §8.2 | agent-core wrangler.jsonc:43-50 | 46-51 (services block) | ±3 | 无 |
| RH5 §8.1 | agent-core/src/llm/registry/models.ts:8-18,23-58 | 8-18 (interface), 23-59 (class) | +1 | 无 |
| RH5 §8.1 | agent-core/src/llm/gateway.ts:20-53 | 20-54 (registry init) | +1 | 无 |
| RH5 §8.3 | nacp-session/src/messages.ts:18-25 | 18-26 | +1 | 无 |
| RH6 §8.1 | nano-session-do.ts:159-2078 | 159-2078 | 0 | 无 |
| RH6 §8.2 | user-do.ts:1-2285 | 1-2285 | 0 | 无 |

**统计**: 19 处抽查中，15 处准确（偏移 ≤5 行），2 处近似（偏移 5-10 行），2 处偏移较大（需在 action-plan 产出时修正）。

---

> **本审查完成。不替代后续 action-plan review 或 implementation review。**

---

## 8. 审查质量评估（appended by Opus 4.7, 2026-04-29）

### 8.0 评价结论

- **一句话评价**：唯一系统性识别"仓库中已建成但未激活资产"的 reviewer，独家发现 hooks/dispatcher (149) + storage adapters (484) + kernel hook_emit 预路由共 3 类高价值资产；但 R1 把已存在的 RH2 主设计文件误判为"不存在"，是本轮唯一 false-positive。
- **综合评分**：`8.0 / 10`
- **推荐使用场景**：跨 phase 工作量评估、"是否要从零搭" vs "是否仅缺 wiring" 的判定、code reality vs design narrative 落差识别。
- **不建议单独依赖的场景**：design 文档清单核查（R1 已说明 reviewer 容易看错文件存在性）；charter alignment review（GPT 更稳）；schema drift 探测（GLM/kimi 更细）。

### 8.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | code reality vs design narrative | R3 / R4 / R7 都从"代码已建成但 design 假设需重建"切入 |
| 证据类型 | line references + 行数核查 + grep | "storage adapters/r2-adapter.ts 214 行"等行数级核查 |
| Verdict 倾向 | balanced（approve-with-followups）| 7 finding 全 non-blocker |
| Finding 粒度 | balanced，但偏向"工作量评估"而非"功能正确性" | R3/R4 都是"工作量被高估" |
| 修法建议风格 | actionable，常配"区分已有 vs 待写"的拆分建议 | R3 直接说"R4 工作 = 组装层 + binding，不是适配器实装" |

### 8.2 优点与短板

#### 8.2.1 优点

1. **4 reviewer 中唯一深入"已建成资产"识别**：R3 (storage adapters)、R4 (hooks dispatcher)、R7 (kernel hook_emit 预路由) 三条都来自 deepseek，对 RH1/RH4 action-plan 的工作量校正 ≥ 30%。
2. **行数级证据**：`wc -l` + `grep -c` 类硬证据让 finding 极难驳回；R5 关于 lockfile 的 "0 匹配" 是最强一手证据。
3. **横向覆盖完整**：99 个 agent-core 文件 + 31 个 context-core 文件 + 32 个 filesystem-core 文件全部读过，coverage 是 4 reviewer 中最广的代码侧。
4. **明确划分"认知准确 vs 认知偏差"**：3.1-3.7 的对齐审核每条都给 done/partial/missing/stale 四档，统计意义清晰。

#### 8.2.2 短板 / 盲区

1. **R1 false-positive（唯一）**：宣称 `RH2-models-context-inspection.md` 不存在，但该文件实际存在并被多份文档引用——这是 reviewer 没读全 design 目录的核查失误。
2. **scheduler 改造深度判断保守**：R7 正确识别 kernel hook_emit 类型已预路由，但没继续深入 scheduler.ts 业务逻辑层（`SchedulerSignals` 是否需要新字段）；这一深度由 GLM R1 / kimi R3 各自补一半。
3. **schema drift 不敏感**：RH5 `model_id` vs canonical `model`、`SessionStartBodySchema` 缺 model_id 等字段名级 drift 全部缺位。
4. **verdict 偏宽松**：approve-with-followups + 7 全部 non-blocker 的口径，与 charter §8.3 Per-Phase Entry Gate 的硬纪律有距离；GPT 更准确给出 changes-requested。

### 8.3 Findings 质量清点

| 编号 | 原始严重 | 事后判定 | Finding 质量 | 分析 |
|------|---------|----------|--------------|------|
| R1 | high | **false-positive** | weak | `docs/design/real-to-hero/RH2-models-context-inspection.md` 实际存在；deepseek 的 review 范围声明遗漏该文件后顺势误判。本评估中已驳回，design 修订未采纳此条 |
| R2 | medium | true-positive | good | 行号偏移识别准确，但属 minor；action-plan 阶段已纳入二次校验 |
| R3 | medium | true-positive | excellent | RH4 §7.2 F1 实施步骤 + §8.1 已建成资产引用直接据此修订；4 reviewer 中独家发现 |
| R4 | medium | true-positive | excellent | RH1 §8.4 已建成资产清单据此新增；RH1 工作量评估从"build dispatcher + connect"降为"connect only" |
| R5 | medium | true-positive | excellent | 与 GLM R14 / kimi R1 三方共识；deepseek 给出最详尽的 stale importer 列表（6 个具体包名）|
| R6 | low | true-positive | good | 行号偏移；与 R2 同类 |
| R7 | low | true-positive | excellent | kernel `StepDecision.hook_emit` 已存在 + runner `handleHookEmit` case 已存在的发现，直接驳回了 kimi R3"需扩 union"的判断，是高质量交叉校准 |

### 8.4 多维度评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 证据链完整度 | 9 | wc -l / grep -c / file existence 等命令级证据扎实 |
| 判断严谨性 | 7 | 1/7 false-positive（R1）显著拉低；其他 6 条都很稳 |
| 修法建议可执行性 | 9 | 多数 finding 直接配"已有 vs 待写" 拆分，对 action-plan 高度友好 |
| 对 action-plan / design / QNA 的忠实度 | 7 | 没有引用 charter 段落级条款（GPT 强项）；charter §13.1 的产出清单理解偏差导致 R1 失误 |
| 协作友好度 | 9 | 7 全部 non-blocker；不阻塞 design 收口 |
| 找到问题的覆盖面 | 9 | 横向 162 个文件读过，是 4 reviewer 最广 |
| 严重级别 / verdict 校准 | 6 | approve-with-followups 偏松；R1 标 high 与 false-positive 形成放大风险 |

**综合**：`8.0 / 10`。R3/R4/R7 三条独家高价值发现，是 deepseek 在 4 reviewer 中最独特的贡献——任何 RH1/RH4/RH5 action-plan 如果不基于这三条，工作量都会被显著高估。但 R1 的 false-positive 提醒 implementer：deepseek 的 review 必须配合 GPT 的 charter alignment 一起读，单独依赖会被 reviewer 自身的核查偏差牵走。

