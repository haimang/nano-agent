# Real-to-Hero 设计文档审查 — GLM 独立审查

> 审查对象: `docs/design/real-to-hero/RH0–RH6 + RHX-qna`（共 8 份设计文档）
> 审查类型: `docs-review`
> 审查时间: `2026-04-29`
> 审查人: `GLM-5.1`
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
> - `docs/charter/plan-real-to-hero.md`
> - `workers/` + `packages/` 实际代码
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：8 份设计文档与 charter 的对齐度较高，scope 划分清晰，out-of-scope 边界明确，方法论自洽。但与实际代码之间存在若干事实性偏差、遗漏和盲点，若不修正将导致 implementation 阶段出现代码路径对不上设计意图的问题。
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 3 个判断**：
  1. RH1 对 Lane F 四链断裂状态的理解有根本性倒置——`emitPermissionRequestAndAwait`/`emitElicitationRequestAndAwait` 实际上是"有等待、无发送"（await 机制完整但零调用方零 WS 推送），而非设计文档暗示的"只记录不等待"；`forwardServerFrameToClient` RPC 在代码中完全不存在。
  2. RH3/RH4/RH5 多处行号引用与实际代码不匹配，且 RH5 的核心字段名有事实性错误（`model_id` 实际是 `model`，`context_window` 实际是 `contextWindow`）。
  3. RH4 对 filesystem-core 当前状态的描述是过时的——它已是 WorkerEntrypoint hybrid 状态，而非纯 library-only；同时 InMemoryArtifactStore 的实际位置在共享包而非 filesystem-core 本身。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-real-to-hero.md`（全文 1017 行）
  - 8 份 design 文档全文
- **核查实现**：
  - `workers/agent-core/src/host/do/nano-session-do.ts`（2078 行全文核查）
  - `workers/orchestrator-core/src/user-do.ts`（2285 行全文核查）
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `workers/agent-core/src/kernel/scheduler.ts` + `types.ts`
  - `workers/agent-core/src/llm/adapters/workers-ai.ts`
  - `workers/agent-core/src/llm/gateway.ts` + `registry/models.ts`
  - `workers/agent-core/src/llm/canonical.ts` + `request-builder.ts`
  - `workers/agent-core/wrangler.jsonc`
  - `workers/orchestrator-core/src/index.ts` + `wrangler.jsonc`
  - `workers/orchestrator-auth/src/service.ts`
  - `packages/orchestrator-auth-contract/src/index.ts`
  - `packages/nacp-session/src/messages.ts` + `stream-event.ts` + `frame.ts`
  - `packages/nacp-session/src/ingress.ts`
  - `workers/filesystem-core/src/index.ts` + `artifacts.ts`
  - `packages/workspace-context-artifacts/src/artifacts.ts`
  - `workers/orchestrator-core/migrations/007-user-devices.sql`
  - `workers/orchestrator-core/migrations/001-identity-core.sql`
  - `pnpm-lock.yaml`
  - 各包 `package.json`
- **执行过的验证**：
  - 对所有设计文档引用的代码行号做了实际对照
  - 对 charter §1.2 冻结真相表与代码实际状态做了校验
  - 对 WS frame 验证路径做了端到端追踪
  - 对 auth 合约（AccessTokenClaims / AuthView / VerifyApiKeyResult）做了 schema 级审核
  - 对 migration 文件做了清单核查
  - 对 pnpm-lock.yaml 做了 jwt-shared importer 缺失核查
- **复用 / 对照的既有审查**：无——本审查为独立进行

### 1.1 已确认的正面事实

- 设计文档与 charter 的 scope/in-scope/out-of-scope 划分高度一致，没有越界
- 所有 8 份文档均遵循统一的设计模板，traceability 良好
- RH2 LLM Delta Policy 作为独立策略文档冻结了 streaming 边界，避免 RH2/RH5 反复漂移
- RHX-qna 准确识别了 5 个必须 owner 拍板的决策点
- 巨石行数（2078/2285）与实际代码完全吻合
- KV/R2 binding 缺失、CONTEXT_CORE/FILESYSTEM_CORE 注释状态均已准确描述
- Device auth gate 缺口（nano_user_devices 表有 DDL 但零运行时写入）已识别
- nano_team_api_keys ghost table 状态已识别
- verifyApiKey {supported: false} 状态已识别
- 7 份 migration 文件编号与名称均已准确列出

### 1.2 已确认的负面事实

- RH1 对 Lane F 断裂状态的描述有根本性倒置
- RH2/RH4/RH5/H6 多处代码行号引用与实际不符
- RH5 有 2 个核心字段名的事实性错误
- RH4 对 filesystem-core 当前状态的描述过时
- 多份文档未覆盖代码中实际存在的关键子系统或路径
- RH1 文档引用的 `forwardServerFrameToClient` 在代码中完全不存在
- RH3 对 /me/conversations 双源问题的描述停留在 facade 层面，未追踪到 User DO 内部
- RH2 Delta Policy 文档未区分代码中实际存在的两层 LLM 归一化路径

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 对所有设计文档引用的行号做了逐行对照 |
| 本地命令 / 测试 | no | 未运行测试套件 |
| schema / contract 反向校验 | yes | 对 Zod schema、DDL、TypeScript interface 做了反向校验 |
| live / deploy / preview 证据 | no | 无 preview deploy 环境 |
| 与上游 design / QNA 对账 | yes | 与 charter §1.2 冻结真相表、§2.2 核心 gap 表做了逐条对账 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | RH1 Lane F 四链断裂状态描述倒置 | critical | correctness | yes | 修正 RH1 对 emitPermission/Elicitation 的描述 |
| R2 | forwardServerFrameToClient RPC 不存在 | critical | correctness | yes | RH1 需将此标注为新实现而非"接线" |
| R3 | handleUsage 已非 null placeholder | high | correctness | no | 修正 RH1/RH0 对 handleUsage 的过时描述 |
| R4 | RH5 核心字段名错误 | high | correctness | yes | model_id→model, context_window→contextWindow |
| R5 | RH4 filesystem-core 状态描述过时 | high | correctness | no | 更新为 hybrid WorkerEntrypoint + bindingScopeForbidden 残留 |
| R6 | InMemoryArtifactStore 有两份拷贝 | medium | docs-gap | no | RH4 应标注 canonical 位置在 workspace-context-artifacts |
| R7 | RH0 NanoSessionDO 行号偏移（P4 claim） | medium | docs-gap | no | 修正 8.2 中 emitPermission 行号 |
| R8 | RH3 AuthView 缺少 team display 字段但未量化 | medium | scope-drift | no | RH3 应显式说明需要修改 contract schema |
| R9 | RH5 /messages 入口不支持 image_url | high | correctness | yes | RH5 需增加 image_url ingress 路径 |
| R10 | RH2 未区分两层 LLM 归一化路径 | medium | docs-gap | no | 补充 LlmChunk vs NormalizedLLMEvent 的说明 |
| R11 | RH6 未覆盖 verification subsystem 和 durable truth subsystem | medium | docs-gap | no | 补充这两个遗漏的拆分候选 |
| R12 | RH3 device tracking 全链路为零 | high | correctness | no | 设计意图正确但实现 gap 应更明确标注 |
| R13 | orchestrate-core WS bypasses NACP validation | medium | protocol-drift | no | RH2 应标注此 protocol gap |
| R14 | pnpm-lock.yaml jwt-shared 缺失更严重 | medium | correctness | no | RH0 应修正"stale importer"为"absent" |
| R15 | orchestrator-auth-contract nacp-core 依赖版本标注错误 | medium | correctness | no | 检查 "*" vs "workspace:*" |
| R16 | RH5 当前两个模型均 supportsVision=false | high | correctness | yes | RH5 需说明 vision 激活是注册新模型而非切换 flag |

### R1. RH1 Lane F 四链断裂状态描述倒置

- **严重级别**：critical
- **类型**：correctness
- **是否 blocker**：yes
- **事实依据**：
  - `nano-session-do.ts:695-829`：`deferredAnswers` Map 和 `awaitAsyncAnswer`/`resolveDeferredAnswer`/`sweepDeferredAnswers` 已完整可工作
  - `nano-session-do.ts:797-829`：`emitPermissionRequestAndAwait` 和 `emitElicitationRequestAndAwait` 确实调用了 `awaitAsyncAnswer`（真实等待），但 **不发射 WS frame 到 client**——`void this.sessionUuid; void helper;` 是 no-op
  - **零调用方**：grep 全代码库，`emitPermissionRequestAndAwait` 和 `emitElicitationRequestAndAwait` 无任何调用者
  - `scheduler.ts` 完全不产生 `hook_emit` decision；`SchedulerSignals` interface 无 `approvalPending` 等信号字段
- **为什么重要**：RH1 设计文档 §4.1 将 permission/elicitation 描述为"可记录，可转发"（参考"当前 runtime 的做法"），暗示已有"转发"。实际上"转发"只存在于 orchestrator-core 的 HTTP mirror（best-effort），**DO 内的 await 机制有完整等待能力但从未被调用**。正确描述应该是"等待机制完整但零触发零推送，而不是仅写存储"。
- **审查判断**：如果不修正，implementer 可能误以为只需"接线上已有 seam"，而实际上需要：①让 scheduler 产生 hook_emit signal ②让 runtime delegate 调用 emit 方法 ③实现跨 worker WS push RPC（forwardServerFrameToClient 不存在，见 R2）。
- **建议修法**：RH1 §8.2 应改为"emitPermissionRequestAndAwait 有完整 await 机制但零调用方、零 WS 推送；forwardServerFrameToClient 需从零实现"。§4.1 应改为"'可等待但未触发，可 HTTP mirror 但未推 WS'而非'可记录可转发'"。

### R2. forwardServerFrameToClient RPC 不存在

- **严重级别**：critical
- **类型**：correctness
- **是否 blocker**：yes
- **事实依据**：
  - Grep 全代码库 `forwardServerFrameToClient`：**零结果**
  - `user-do.ts:1204` 存在 `emitServerFrame(sessionUuid, frame)` 方法，但它只能在 **同一 user-do DO 实例内** 推送给已 attached 的 WS
  - agent-core (NanoSessionDO) 与 orchestrator-core (User DO) 是**两个不同 DO**，没有跨 worker RPC 让 agent-core 调用 user-do 的 `emitServerFrame`
  - RH1 设计文档 §7.2 交付物 4 提到 `forwardServerFrameToClient RPC handler`，但这需要**全新实现**
- **为什么重要**：onUsageCommit WS push 的完整路径是 NanoSessionDO → user-do → client WS。前半段（onUsageCommit callback）在 agent-core，后半段（emitServerFrame）在 user-do。缺少中间的跨 worker RPC，整条链路不可通。
- **审查判断**：这不只是"接线"问题，而是需要实现一个不存在的跨 worker RPC 通道。RH1 需要明确标注这是新实现，不是"接线"。
- **建议修法**：RH1 §7.2 交付物 4 应改为"新增 user-do forwardServerFrameToClient RPC method + agent-core 调用路径（当前代码中不存在此 RPC）"。

### R3. handleUsage 已非 null placeholder

- **严重级别**：high
- **类型**：correctness
- **是否 blocker**：no
- **事实依据**：
  - `user-do.ts:1220-1257`：`handleUsage` 已经调用 `repo.readUsageSnapshot()` 从 D1 读取真实数据
  - 当 D1 有 usage 数据时返回真实 token/tool/cost 值，null 只是无数据时的 fallback
- **为什么重要**：charter §2.2 G10 和 RH1 §0 说的 "handleUsage HTTP null placeholders" 已不完全是当前代码状态。ZX4 P5-01 已经升级了 handleUsage。
- **审查判断**：不 blocker，但设计文档应反映当前状态。
- **建议修法**：RH1 §7.2 将 handleUsage 收口目标从"不再返回 null"改为"确保 handleUsage 在无数据时也返回完整结构体而非 null 字段"。

### R4. RH5 核心字段名错误

- **严重级别**：high
- **类型**：correctness
- **是否 blocker**：yes
- **事实依据**：
  - `canonical.ts:67-77`：字段名是 `model` 而非 `model_id`；RH5 全文使用 `model_id`
  - `models.ts:8-18`：字段名是 `contextWindow`（camelCase）而非 `context_window`（snake_case）；RH5 §8.1 写 `context_window`
  - charter §7.6 也用 `model_id`，但代码实际是 `model`
- **为什么重要**：如果 implementer 按 RH5 使用 `model_id`，将产生 schema 不匹配。
- **审查判断**：需要决定是在代码中 rename 还是在设计文档中修正。无论哪种，必须统一。
- **建议修法**：RH5 须明确 `model` vs `model_id` 的决策——是 public surface 仍用 `model_id`（在 nacp-session schema 层）而 canonical request 用 `model`？还是统一 rename？同样 `contextWindow` 须在文档中修正为 camelCase。

### R5. RH4 filesystem-core 状态描述过时

- **严重级别**：high
- **类型**：correctness
- **是否 blocker**：no
- **事实依据**：
  - `filesystem-core/src/index.ts` 已有 `FilesystemCoreEntrypoint` class（ZX5 Lane E E2 uplift）
  - 但同时存在 `bindingScopeForbidden()` 返回 401 "filesystem-core is a library-only worker"
  - `shell` response 仍含 `library_worker: true`
  - 设计文档 §8.1 引用行 19-23,50-85 是准确的，但 §4.1 描述为"library-only + in-memory"忽略了 hybrid 状态
- **为什么重要**：implementer 需要知道 RPC 形状已存在但处于 hybrid 状态（RPC entrypoint 存在 + fetch 仍 401）。
- **建议修法**：RH4 §4.1 应改为"filesystem-core 已有 WorkerEntrypoint RPC 形状但 fetch 仍返回 401 + InMemoryArtifactStore，处于 hybrid 过渡态"。

### R6. InMemoryArtifactStore 有两份拷贝

- **严重级别**：medium
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：
  - `workers/filesystem-core/src/artifacts.ts` 有一份
  - `packages/workspace-context-artifacts/src/artifacts.ts` 有一份相同内容
  - `nano-session-do.ts` 从 `@nano-agent/workspace-context-artifacts` 导入，不是从 filesystem-core
- **为什么重要**：RH4 将 InMemoryArtifactStore 定位在 filesystem-core 是不精确的。
- **建议修法**：RH4 §8.1 应标注 canonical 位置是 `packages/workspace-context-artifacts`。

### R7. RH0/RH1 代码行号偏移

- **严重级别**：medium
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：
  - RH0 §8.2 引用 `nano-session-do.ts:481-502` 的 `createLiveKernelRunner`——实际范围更宽（477-501）
  - RH0 §8.2 引用 `nano-session-do.ts:159-2078`——主类确实从 159 行开始，但 DO class header 范围是 155-2078
  - RH1 §8.2 引用 `nano-session-do.ts:640-790`——recordAsyncAnswer 从 640 开始是对的，但整个块到 829，不是 790
  - RH1 §8.2 引用 `nano-session-do.ts:490-501` 的 onUsageCommit 注释——实际回调代码在 494-501
  - RH3 §8.1 引用 `auth-contract/index.ts:102-184`——AuthViewSchema 在 102-107，但 permission schemas 在 89-134，不在 102-184 的统一范围内
  - RH5 §8.3 引用 `messages.ts:18-25`——SessionStartBodySchema 在 18-25 是准确的
  - RH5 §8.3 引用 `messages.ts:136-199`——实际 permission schemas 从 89 开始
  - RH4 §8.1 引用 `filesystem-core/index.ts:19-23,50-85`——大致准确
  - RH4 §8.2 引用 `nano-session-do.ts:353,2066-2071`——353 行是对的，但 2066-2071 是 verifyFilesystemPosture 对 env 的检测，不是 InMemoryArtifactStore 的位置
- **为什么重要**：行号偏移会导致 code review 时难以快速定位。
- **建议修法**：各文档补充"行号截至 2026-04-29 代码快照"注释，并修正关键偏移。

### R8. RH3 AuthView 缺少 team display 字段但未量化改动范围

- **严重级别**：medium
- **类型**：scope-drift
- **是否 blocker**：no
- **事实依据**：
  - `AuthTeamSchema` 当前只有 `{team_uuid, membership_level, plan_level}`
  - `nano_teams` 表只有 `{team_uuid, owner_user_uuid, created_at, plan_level}`
  - RH3 需要新增 `team_name` + `team_slug` 字段到**两个地方**：`nano_teams` DDL + `AuthTeamSchema`
  - 这意味着 `orchestrator-auth-contract` package 需要发版更新
- **为什么重要**：设计文档 §8.1 只写了 "RH3 所有 auth shape 变更必须回到 contract package"，但没有量化这个 contract 变更的影响范围。
- **建议修法**：RH3 应显式列出需要变动的 Zod schema 列表和 contract package 版本更新。

### R9. RH5 /messages 入口不支持 image_url

- **严重级别**：high
- **类型**：correctness
- **是否 blocker**：yes
- **事实依据**：
  - `user-do.ts:1456`：`kind` 值只接受 `'text' | 'artifact_ref'`
  - `CanonicalLLMRequest` 确实有 `ImageUrlContentPart` 类型定义
  - `request-builder.ts:82-92` 有 vision capability check
  - 但从 `/messages` 入口到 `ImageUrlContentPart` 之间没有适配代码——`kind: 'image_url'` 会被 400 拒绝
- **为什么重要**：RH5 的 F3 "Multimodal Vision Path" 声称"image 输入不再被 silent-drop"，但当前入口层直接拒绝 image_url kind。需要新增 image_url → CanonicalLLMRequest 的适配路径。
- **建议修法**：RH5 F3 需明确增加"在 /messages 入口适配 image_url kind 到 CanonicalLLMRequest 的转换路径"作为实现步骤。

### R10. RH2 未区分两层 LLM 归一化路径

- **严重级别**：medium
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：
  - `workers-ai.ts` 产生 `LlmChunk`（3 variants: content/usage/tool_calls）
  - `session-stream-adapter.ts` / `canonical.ts` 产生 `NormalizedLLMEvent`（5 variants: llm.request.started/delta/tool_call/finish/error）
  - 两者是不同代码路径
  - RH2 §8.2 写"provider SSE -> canonical chunk normalisation"仅对应 `LlmChunk` 层
- **为什么重要**：如果 RH2 要修改 streaming 行为，需要清楚两层哪个是改动点。
- **建议修法**：RH2 §8.2 应区分 LlmChunk（Workers AI adapter output）和 NormalizedLLMEvent（session stream adapter output）两层。

### R11. RH6 未覆盖 verification subsystem 和 durable truth subsystem

- **严重级别**：medium
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：
  - `nano-session-do.ts:1723-2078`（~355 行）是一个完整的 preview verification subsystem，包含 5 个 verify 方法
  - `user-do.ts:286-500`（~215 行）是 D1 durable session truth helper 子系统
  - RH6 的拆分方案未提及这两个独立子系统
- **为什么重要**：如果按当前拆分方案，这两个子系统可能继续留在主文件中，增加主文件行数。
- **建议修法**：RH6 F1 的拆分列表应增加 `session-do-verify`（对应 §8.1 已有引用但未作为独立拆分目标）和复核 D1 truth helpers 是否应独立抽取。

### R12. RH3 device tracking 全链路为零

- **严重级别**：high
- **类型**：correctness
- **是否 blocker**：no
- **事实依据**：
  - `AccessTokenClaimsSchema` 没有 `device_uuid` 字段
  - `AuthSnapshotSchema` 没有 `device_uuid` 字段
  - `nano_auth_sessions` 没有 `device_uuid` 列
  - login/register 流程不 mint device_uuid
  - `nano_user_devices` 表有完整 DDL 但零运行时写入
  - RC3 设计意图正确（需要实现完整链路），但 gap 描述应更精确
- **为什么重要**：RH3 的"从 D1 写入变成即时 auth gate"描述暗示 auth 系统已有部分 device awareness，但实际上**全链路为零**：没有 device claim 注入、没有 session-device 关联、没有 refresh 绑定。
- **建议修法**：RH3 §8.3 应明确标注"device_uuid claim 注入需要同时修改 AccessTokenClaimsSchema + AuthSnapshotSchema + issueTokens + login/register + refresh rotation + nano_auth_sessions DDL"。

### R13. orchestrator-core WS bypasses NACP validation

- **严重级别**：medium
- **类型**：protocol-drift
- **是否 blocker**：no
- **事实依据**：
  - `user-do.ts:1196-1203` 的 `emitServerFrame` 直接使用 lightweight `{kind, ...}` JSON，不经过 `validateSessionFrame`
  - `user-do.ts:1905-1981` 的 `handleWsAttach` 不经过 NACP frame validation
  - `session-edge.ts:142` 的 `acceptIngress` 调用 `validateSessionFrame`，但只在 agent-core 层
  - orchestrator-core 的 heartbeat push 也不走 NACP validation
  - 这意味着 orchestrator-core 发出的 WS 帧类型（`session.heartbeat`, `attachment_superseded`, `terminal`）不在 nacp-session 的类型注册表中
- **为什么重要**：RH2 WS NACP frame upgrade 需要同时覆盖 orchestrator-core 的 WS emit 路径，否则会出现"agent-core 走 NACP，orchestrator-core 走 lightweight"的双协议状态。
- **建议修法**：RH2 应显式标注"orchestrator-core emitServerFrame 和 handleWsAttach 路径需要升级到 NACP frame"。

### R14. pnpm-lock.yaml jwt-shared 缺失比"stale"更严重

- **严重级别**：medium
- **类型**：correctness
- **是否 blocker**：no
- **事实依据**：
  - `pnpm-lock.yaml` 的 `importers` 完全不包含 `packages/jwt-shared`
  - 这不是一个"stale importer"问题——jwt-shared 从未被 lockfile 追踪
  - 设计文档和 charter 都描述为"lockfile 断裂"或"stale importer"
- **建议修法**：RH0 应将问题描述从"stale importer / lockfile 断裂"改为"jwt-shared 完全不在 lockfile importers 中，需要 pnpm install 重新生成"。

### R15. orchestrator-auth-contract nacp-core 依赖版本标注

- **严重级别**：medium
- **类型**：correctness
- **是否 blocker**：no
- **事实依据**：
  - `packages/orchestrator-auth-contract/package.json` 中 `@haimang/nacp-core` 的依赖标注为 `"*"` 而非 `"workspace:*"`
  - 这可能导致解析到 published 版本而非 workspace 版本
- **建议修法**：RH0 P0-A lockfile 修复范围应包含此依赖修正。

### R16. RH5 当前两个模型均 supportsVision=false

- **严重级别**：high
- **类型**：correctness
- **是否 blocker**：yes
- **事实依据**：
  - `gateway.ts`: 当前注册的 2 个模型（`@cf/ibm-granite/granite-4.0-h-micro` 和 `@cf/meta/llama-4-scout-17b-16e-instruct`）均 `supportsVision: false`
  - `llama-4-scout` 实际支持 vision，但 `ModelCapabilities` 中标记为 false
  - `request-builder.ts:82-92` 的 vision check 会 **显式拒绝** 任何包含 `image_url` 的请求："Model does not support vision capability"
  - 这不是"注册但不激活"，而是"注册时 capability 标记错误 → 请求被 capability gate 显式拒绝"
- **为什么重要**：RH5 F3 声称"image 输入不再被 silent-drop"。但当前代码中 image_url 被 **显式拒绝**（不是静默丢弃）。实现 vision 需要同时：①注册新模型或修正 llama-4-scout 的 supportsVision ②在 /messages 入口支持 image_url kind ③确保 CanonicalLLMRequest.image_url 正确传递
- **建议修法**：RH5 F3 应明确标注"vision 激活需要同时修正 existing model capability 标记 + 新增 image_url ingress 适配"。

---

## 3. In-Scope 逐项对齐审核

> 以下按每份设计文档，对照 charter §4.1 In-Scope 表逐项审核。

### RH0 对齐

| 编号 | charter §7.1 In-Scope | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | jwt-shared 独立构建基线 | partial | 设计正确识别了问题，但 lockfile 问题比描述更严重（absent 非 stale） |
| S2 | ZX5 endpoint 直达测试 | partial | 设计覆盖了需要测试的端点，但未具体列出 6 个零覆盖 route handler |
| S3 | KV/R2 binding 占位 | done | 与代码现状一致 |
| S4 | NanoSessionDO verify/persistence 预拆分 | partial | 设计未提及 verification subsystem（355 行）作为潜在独立切面 |
| S5 | bootstrap hardening | done | 与 charter 对齐 |
| S6 | owner-action checklist | done | 与 charter 对齐 |

### RH1 对齐

| 编号 | charter §7.2 In-Scope | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | hook.emit delegate 激活 | missing | 设计正确识别了 no-op，但未识别 scheduler 需新增 approval 信号 |
| S2 | scheduler hook_emit 决策 | partial | 设计引用了 scheduler.ts 但未识别 SchedulerSignals 缺少 hook 触发字段 |
| S3 | emitPermission/emitElicitation 真实激活 | partial | 描述倒置——实际是"有等待无推送零调用方"而非"只记录不等待"，见 R1 |
| S4 | onUsageCommit WS push | partial | 跨 worker RPC 完全不存在（见 R2），且 handleUsage 已非 null（见 R3） |
| S5 | handleUsage HTTP 真实化 | stale | handleUsage 在 ZX4 已升级为 D1 查询，不再是 null placeholder |

### RH2 对齐

| 编号 | charter §7.3 In-Scope | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | GET /models | done | 设计对齐 |
| S2 | GET /sessions/{id}/context | done | 设计对齐 |
| S3 | WS NACP frame upgrade | partial | 未标注 orchestrator-core WS emit 路径不走 NACP（见 R13） |
| S4 | Tool call semantic-chunk | partial | 未区分两层 LLM 归一化路径（见 R10） |
| S5 | LLM delta policy | done | 策略冻结合理 |

### RH3 对齐

| 编号 | charter §7.4 In-Scope | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | Device auth gate | partial | 设计意图正确但 gap 描述应更精确——全链路为零（见 R12） |
| S2 | Team display | partial | 需要同步修改 contract package，影响范围未量化（见 R8） |
| S3 | verifyApiKey 实装 | done | 与代码现状一致（supported:false literal） |
| S4 | /me/conversations 双源对齐 | partial | 设计仅描述了 facade 层面，未追踪到 User DO 内部合并逻辑 |
| S5 | refresh+device 绑定 | missing | 设计未列出需要修改的 schema 清单（AccessTokenClaims + nano_auth_sessions） |

### RH4 对齐

| 编号 | charter §7.5 In-Scope | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | R2/KV/D1 持久化 | done | 设计对齐 |
| S2 | filesystem-core 业务 RPC | partial | 当前状态是 hybrid 而非 library-only（见 R5） |
| S3 | Lane E consumer migration | done | 与 charter 对齐 |
| S4 | POST /sessions/{id}/files | partial | 当前 handleFiles 只返回 metadata 不返回字节，设计未明确 |
| S5 | Multi-tenant namespace | done | 设计对齐 |

### RH5 对齐

| 编号 | charter §7.6 In-Scope | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | nano_models seed | done | 设计对齐 |
| S2 | per-session model_id 透传 | partial | 字段名应为 `model` 非 `model_id`（见 R4） |
| S3 | Vision capability 激活 | partial | 当前模型均 supportsVision=false，需修正标记+入口适配（见 R16） |
| S4 | Reasoning effort 贯通 | done | 设计对齐 |

### RH6 对齐

| 编号 | charter §7.7 In-Scope | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | NanoSessionDO 拆 7 文件 | partial | 未覆盖 verification subsystem 和 durable truth subsystem（见 R11） |
| S2 | user-do.ts 按 domain 拆 | partial | domain 列表遗漏了 usage/resume/permission/elicitation/policy（见 R11） |
| S3 | 三层真相文档 | done | 设计对齐 |
| S4 | Manual evidence | done | 设计对齐 |
| S5 | Cleanup 残余 | done | 设计对齐 |

### 3.1 对齐结论

- **done**: 10
- **partial**: 16
- **missing**: 2
- **stale**: 1
- **out-of-scope-by-design**: 0

> 这更像"方向正确但实现细节与代码现实存在显著偏差"——大部分 partial 项是可以通过修正设计文档解决的，但 2 个 missing 项（RH1 scheduler hook 信号、RH3 contract schema 清单）需要补设计。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | admin plane | 遵守 | 所有设计文档均未涉及 |
| O2 | billing / quota policy | 遵守 | RH5 明确标记 per-model quota out-of-scope |
| O3 | second LLM provider | 遵守 | RH5 明确 Workers AI only |
| O4 | catalog plug-in framework | 遵守 | 无文档涉及 |
| O5 | sandbox isolation | 遵守 | 无文档涉及 |
| O6 | OAuth federation | 遵守 | RH3 明确 out-of-scope |
| O7 | logout endpoint | 遵守 | 无文档涉及 |
| O8 | SQLite-DO | 遵守 | RH6 明确 out-of-scope |
| O9 | 第 7 个 worker | 遵守 | 无文档涉及 |
| O10 | NACP error envelope | 遵守 | 无文档涉及 |
| O11 | 三层信封统一 | 遵守 | 无文档涉及 |
| O12 | prompt caching | 遵守 | RH5 明确 out-of-scope |
| O13 | bash streaming progress | 遵守 | 无文档涉及 |
| O14 | conversation title/FTS | 遵守 | 无文档涉及 |
| O15 | user preferences | 遵守 | 无文档涉及 |
| O16 | full evidence per phase | 遵守 | RH6 明确 only Tier-A per phase |

---

## 5. 逐设计文档审查结论

### RH0 Bug Fix and Prep

**结论**：设计方向正确，但 lockfile 问题描述不准确（absent 非 stale），endpoint test 基线未列出具体零覆盖的 6 个 handler，NanoSessionDO 预拆分方案未考虑 verification subsystem 作为潜在独立切面。建议补充这 6 个 handler 列表、修正 lockfile 问题描述、并复核 verification subsystem 的拆分优先级。

### RH1 Lane F Live Runtime

**结论**：**需要重大修正**。Lane F 四链断裂状态的描述有根本性倒置——不是"只记录不等待"而是"完整等待但零触发零推送"。`forwardServerFrameToClient` 跨 worker RPC 在代码中完全不存在，需要新实现而非接线。scheduler 完全不产生 `hook_emit` signal。`AgentRpcMethodKey` 类型不包含 `permissionDecision`/`elicitationAnswer`。这些 gap 未被准确识别将导致 implementer 走错方向。

### RH2 LLM Delta Policy

**结论**：策略冻结合理，semantic-chunk vs token-level 边界清晰。主要问题：未区分代码中两层 LLM 归一化路径（LlmChunk vs NormalizedLLMEvent）；未覆盖 orchestrator-core WS emit 路径不走 NACP validation 的 protocol gap。

### RH3 Device Auth Gate and API Key

**结论**：scope 边界清晰，out-of-scope 划分正确。主要问题：device tracking 全链路为零——不仅是"D1 写入但未进 auth gate"，而是从 device_uuid minting 到 claim 注入到 session 关联到 auth gate 全部缺失；需要修改的 contract schema 清单未列出；team display 变更需要同时修改两个 schema（AuthTeamSchema + DDL）和 contract package 版本；/me/conversations 双源问题的分析停留在 facade 层面。

### RH4 Filesystem R2 Pipeline and Lane E

**结论**：R2 pipeline 和 Lane E migration 设计清晰。主要问题：filesystem-core 当前状态的描述过时（已是 hybrid WorkerEntrypoint + bindingScopeForbidden 残留，不是纯 library-only）；InMemoryArtifactStore 的 canonical 位置在 shared package 而非 filesystem-core；handleFiles 当前实现返回 metadata 但不返回字节，设计应明确。

### RH5 Multi-Model Multimodal Reasoning

**结论**：**需要修正**。两个核心字段名错误：`model_id` 应为 `model`，`context_window` 应为 `contextWindow`。当前 2 个模型均 `supportsVision: false`，vision 激活需要同时修正 capability 标记和新增 ingress 适配，而非简单的"激活"。`/messages` 入口不支持 `image_url` kind，需要显式适配步骤。session.start 不支持 model 选择，model 透传只在 /messages 级别。Workers AI model registry 是 serial fallback 而非 parallel。

### RH6 DO Megafile Decomposition

**结论**：拆分方向正确，三层真相冻结目标清晰。主要问题：拆分方案遗漏了两个独立子系统——verification subsystem（355 行）和 durable session truth helpers（215 行）。user-do.ts 的 domain 列表遗漏了 usage/resume/permission/elicitation/policy 等多个 handler。

### RHX-qna

**结论**：5 个 owner 决策点识别准确，reasoning 清晰。Q1 (team_slug) 的最晚冻结时点"RH2 启动前"与 charter §12 一致。Q2 (dual-track sunset ≤2 周) 合理。Q3 (per-model quota 不引入) 合理。Q4 (evidence 范围) 合理。Q5 (owner checklist) 合理。无重大问题。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：8 份设计文档与 charter 的 scope/边界/方法论对齐度较高，但与实际代码之间存在若干事实性偏差和遗漏，需要修正后才能可靠指导 implementation。
- **是否允许关闭本轮 review**：no
- **关闭前必须完成的 blocker**：
  1. RH1 必须修正 Lane F 四链断裂状态的描述（R1），并标注 `forwardServerFrameToClient` 为新实现（R2）
  2. RH5 必须修正核心字段名（R4），并增加 vision 激活的完整实现路径（R16）和 image_url ingress 适配（R9）
- **可以后续跟进的 non-blocking follow-up**：
  1. 各文档代码行号校正（R7）
  2. RH4 filesystem-core hybrid 状态描述更新（R5）
  3. RH2 补充两层 LLM 归一化路径说明（R10）
  4. RH2 标注 orchestrator-core WS bypass NACP 的 protocol gap（R13）
  5. RH6 补充 verification subsystem 和 durable truth subsystem（R11）
  6. RH3 补充 contract schema 变更清单（R8）和 device tracking 全链路空白标注（R12）
  7. RH0 修正 lockfile 问题描述为 absent（R14）
  8. RH0 修正 handleUsage 状态描述（R3）
  9. 检查 orchestrator-auth-contract nacp-core 依赖版本（R15）
  10. RH4 标注 InMemoryArtifactStore canonical 位置（R6）
- **建议的二次审查方式**：独立 reviewer rereview（修正后 cross-check）
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §6 append 回应，不要改写 §0–§5。

---

## 7. 审查质量评估（appended by Opus 4.7, 2026-04-29）

### 7.0 评价结论

- **一句话评价**：4 份审查中 finding 数量最多（16 条）、code reality 切入最深、独家发现两个 critical 根本性问题（R1 Lane F 描述倒置 + R2 forwardServerFrameToClient 不存在）；这两条若不修，RH1 implementer 必然走错方向，因此整体价值最高。
- **综合评分**：`9.5 / 10`
- **推荐使用场景**：design 与代码现实的全面对账、协议运行态 trace、字段名级 drift 探测、cross-cutting protocol gap（如 orchestrator-core WS bypass NACP）。
- **不建议单独依赖的场景**：当只想要"≤5 条最关键 blocker"的精炼 verdict 时（GPT 更精炼）；当 reviewer 时间预算紧张时（GLM 16 条会让收口拖长）。

### 7.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | code reality 深 trace + 协议字段反向校验 | R1 跟 `nano-session-do.ts:797-829` + 全代码库 grep 调用方；R2 全代码库 grep `forwardServerFrameToClient` 0 结果 |
| 证据类型 | line references + grep + Zod schema parse + DDL 反向校验 | 几乎每 finding 都有 schema 或 DDL 级证据 |
| Verdict 倾向 | strict（changes-requested）；2 critical + 5 high | 严格但与 finding 质量匹配 |
| Finding 粒度 | fine | 同一 phase 内可拆出 2-3 条不同维度的 finding（如 RH3 R8/R12 + RH5 R4/R9/R16）|
| 修法建议风格 | actionable，且常给"需要同时修改的 schema 清单" | R12 一次列出 6 个需改 schema/DDL；R8 列出 contract package 升版条件 |

### 7.2 优点与短板

#### 7.2.1 优点

1. **2 个 critical 根本性 finding 是 4 reviewer 独家**：R1（Lane F 描述倒置：等待机制完整 vs 设计文档暗示的"只记录不等待"）+ R2（`forwardServerFrameToClient` 0 grep 匹配，是全新 RPC 而非"接线"）。这两条若不修，RH1 P1-D 工作量被低估 ≥ 50%，且方向错误。
2. **schema/DDL 反向校验最深**：R4 同时核查 canonical.ts:68 / models.ts:15 两处字段名；R12 一次定位 6 处 schema/DDL 缺口；R16 把 "vision 激活" 拆成 capability flag + ingress + canonical 三个独立步骤。
3. **cross-cutting protocol gap 嗅觉准确**：R13（orchestrator-core WS bypass NACP validation）是 4 reviewer 中独家——这条直接进入 RH2 P2-08 实施步骤，是协议 single source 真实落地的关键。
4. **每 finding 配"如果不修会怎样"**：例如 R1 说"implementer 可能误以为只需接线"——为 implementer 提供决策依据，不只是 critique。

#### 7.2.2 短板 / 盲区

1. **finding 数量偏多导致优先级稀释**：R15（nacp-core 依赖版本 `*` vs `workspace:*`）虽 valid，但 severity 偏低混在 16 条里容易被埋。
2. **没有抓 charter alignment 类的 governance 问题**：例如 RHX Q3/Q4 编号倒置（GPT R7）、charter §4.3 已 in-scope 的 `GET /me/teams` 漏掉（GPT R3）—— GLM 16 条没有覆盖到这层。
3. **未识别"已建成但未激活"资产**：hooks dispatcher 149 行 / storage adapters 484 行（deepseek R3/R4 独家）—— GLM 在 R5 提到 filesystem-core hybrid 状态但没深入到 storage adapters 已生产级。
4. **R3 表述偏严**：`handleUsage 已非 null placeholder` 标 high 略保守（实际是 partial：D1 已查但无 rows 仍 fallback null），与 charter §7.2 P1-E 的 in-scope 状态对接更准确（GPT R1 取的角度更恰当）。

### 7.3 Findings 质量清点

| 编号 | 原始严重 | 事后判定 | Finding 质量 | 分析 |
|------|---------|----------|--------------|------|
| R1 | critical | true-positive | excellent | 4 reviewer 独家 critical；RH1 §4.2/§5.1/§7.2 F2 全部据此重写 |
| R2 | critical | true-positive | excellent | 全代码库 grep 0 匹配，是最强一手证据；RH1 §7.2 F3 + §8.3 据此新增 |
| R3 | high | true-positive | good | partial 而非 fully stale；与 GPT R1 互补 |
| R4 | high | true-positive | excellent | RH5 §1.1 关键术语据此重写；与 kimi R6 共识 |
| R5 | high | true-positive | excellent | RH4 §0/§4.1 hybrid 状态描述据此修订 |
| R6 | medium | true-positive | excellent | RH4 §8.1 canonical 位置 (workspace-context-artifacts) 据此修正 |
| R7 | medium | true-positive | good | 行号偏移；批量发现，留 action-plan 校验 |
| R8 | medium | true-positive | excellent | RH3 §8.5 contract package 影响清单据此新增 |
| R9 | high | true-positive | excellent | RH5 §5.1 [S3] / §7.2 F3 实施步骤据此重写 |
| R10 | medium | true-positive | excellent | RH2-llm-delta-policy §8.2 两层归一化据此重写 |
| R11 | medium | true-positive | excellent | RH6 §5.1 [S1]/[S2] verification subsystem + durable truth helpers 据此新增 |
| R12 | high | true-positive | excellent | RH3 §5.1 [S1] / §8.4 schema 变更清单据此细化 |
| R13 | medium | true-positive | excellent | RH2 §7.2 F3 实施步骤 + §8.4 facade 路由层缺口表据此新增 |
| R14 | medium | true-positive | good | 与 kimi R1 / deepseek R5 三方共识；术语精确化（absent vs stale） |
| R15 | medium | true-positive | mixed | valid 但 severity 偏高；属轻量 action-plan 修整项 |
| R16 | high | true-positive | excellent | RH5 vision 激活 3 步路线据此重写 |

### 7.4 多维度评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 证据链完整度 | 10 | grep + schema parse + DDL 反向校验 + line references 全配套 |
| 判断严谨性 | 10 | 0 false-positive；critical 标记节制（仅 R1/R2，且都验证为根本性）|
| 修法建议可执行性 | 10 | 几乎每条带"修改 schema/DDL 清单" |
| 对 action-plan / design / QNA 的忠实度 | 8 | charter alignment 维度覆盖弱；RHX QNA 编号倒置等治理问题没识别 |
| 协作友好度 | 8 | 16 条略多；implementer 需较高 ROI 筛选成本（虽然每条都 valid）|
| 找到问题的覆盖面 | 10 | 16/16 valid；横跨 schema/DDL/protocol/code-reality 四类 |
| 严重级别 / verdict 校准 | 9 | 2 critical + 5 high + 9 medium 分布合理；R3 略保守 |

**综合**：`9.5 / 10`。R1 + R2 两条 critical 是 RH1 的"方向问题"，独此一份；其余 14 条 100% 落地修订。GLM 这份 review 的价值不能用 finding 数量平摊衡量，而要用"如果实现者不读这份会走错多远"的反事实量度——RH1 / RH3 / RH5 三个 phase 各有一个根本性方向被 GLM 校正。
