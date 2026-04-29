# real-to-hero：阶段设想与工作安排（by Opus）

> 作者: `Claude Opus 4.7`（实现者，结合 zero-to-real partial-close 真实修复与 4 家 reviewer 评审）
> 撰写日期: `2026-04-29`
> 输入材料:
> - `docs/issue/zero-to-real/zero-to-real-final-closure.md`（partial-close / handoff-ready，§4 列出 15 条未完成项）
> - `docs/eval/real-to-hero/api-gap-study-by-{GLM,GPT,deepseek,kimi}.md`（4 家 API gap 调查，撰写于 2026-04-28，部分 gap 已在 2026-04-29 ZX5 Lane D 收口期间被解决）
> - `docs/eval/real-to-hero/runtime-session-study-by-GPT.md`（runtime/session DO 拆分专项，否决 SQLite-DO 主线，推荐先拆 NanoSessionDO 巨石）
> - 当前 6-worker 真实代码（已经过本轮 implementer 修复 + 4 家 reviewer 审查）

---

## 0. 我对当前真实状态的认定（与 api-gap-study 撰写时已变更的部分）

api-gap-study 4 家文档撰写于 2026-04-28，本轮 implementer fix（2026-04-29）与 ZX5 Lane D 修复期间，下列 gap-study 中标为"missing"的事项**已经落地或部分落地**，编制 real-to-hero plan 时不应再当成 P0 新工作：

| gap-study 中描述为 missing | 当前真实状态 | 证据 |
|---|---|---|
| `POST /sessions/{id}/messages` 不存在 | **已落地（routes wired，handler 实现，request body 透传已修）** | `workers/orchestrator-core/src/index.ts` route 白名单含 messages；DS R1 needsBody 修复后 body 透传；`user-do.ts handleMessages` ~200 行 |
| `GET /sessions/{id}/files` 不存在 | **已落地（metadata-only）** | route 白名单含 `files`；handleFiles 走 artifact_ref 扫描 |
| `GET /me/conversations` 不存在 | **已落地（D1-only，KV 双源未对齐）** | route 白名单含 `me/conversations`；handleMeConversations 仅查 D1（DS R8 / closure §4 item 14 标注） |
| `POST /me/devices/revoke` 不存在 | **已落地（仅写 D1，不进入 access/refresh/WS auth gate）** | route 白名单含 `me/devices/revoke`；migration 007 建 nano_user_devices；GP R1 / closure §4 item 8 标注 auth gate 缺失 |
| `nano_conversation_sessions.session_status` 不含 pending/expired | **已落地** | migration 006 已扩展 enum，含 pending/expired |
| catalog 返回空数组 | **已落地（CATALOG_SKILLS/COMMANDS/AGENTS 静态内容）** | 静态内容来自 `catalog-content.ts`；并非真实 plug-in 注册框架 |
| nano_user_devices 表缺失 | **已落地** | migration 007-user-devices.sql |

仍然 missing 的事项（以下章节展开）：
- `GET /models`（无 route）
- `GET /sessions/{id}/context`（InspectorFacade 仅库级）
- `verifyApiKey` 仍为 `supported:false` reserved-for-future-phase stub
- Lane F live runtime（hook.emit no-op、scheduler 不产生 hook_emit、emitPermissionRequestAndAwait 零调用方）
- Lane E consumer migration（agent-core 的 CONTEXT_CORE / FILESYSTEM_CORE binding 仍注释）
- KV/R2 binding 全部 6 worker 均无声明
- D6 device revoke auth gate（access/refresh/WS gate 不读 D1 device status）
- WS bidirectional flow（onUsageCommit WS push、permission round-trip、tool result frame、incremental tool call delta 全未 wire）
- nano_teams 缺 team_name/team_slug
- jwt-shared lockfile 断裂（GP R4 blocked）
- ZX5 product endpoints 缺直达测试（GP R5）
- NanoSessionDO 巨石（2078 行）+ user-do.ts 巨石（2285 行）

---

## 1. real-to-hero 核心命题

real-to-hero 不是再做一次架构清洁度提升，也不是把现有内部抽象抛光得更漂亮。它的命题是：

> **让 nano-agent 第一次拥有一个可被真实 web / mini-program / CLI 客户端持续使用的产品基线，而不只是"看起来端到端能跑"的 demo。**

衡量这个命题是否完成的硬指标，参照 api-gap-study 4 家共识，归结为三道闭环：

1. **Session 消费闭环** — client 能选择模型、发送结构化消息（含多模态/附件/idempotency）、收到结构化回包（含 tool result、permission request、usage update）、查询 context window 真实状态。
2. **租户可达闭环** — client 能看到可读的租户名、列出 conversation 历史、管理多设备、撤销设备 token、用 API key 做 server-to-server 鉴权。
3. **Live runtime 闭环** — Lane F live runtime（permission round-trip / elicitation / usage push）真正激活，不再只是 contract + storage helper。

zero-to-real partial-close 的 §4 deferred items 与 api-gap-study 的 first-wave 需求**并不互斥**：前者是"已经识别但需独立 sprint 的内部 hardening"，后者是"产品面缺口"。real-to-hero 必须把两者作为一组工作并行规划。

---

## 2. 阶段总览

| 阶段 | 主题 | 预估周数 | 关键 DoD |
|---|---|---|---|
| **Phase 0** | bug 修复 + 前期准备（lockfile / 测试矩阵 / 基础设施 binding / NanoSessionDO 拆分预备） | 1.5 周 | jwt-shared 可独立 build/test；ZX5 endpoint 直达测试 ≥ 5 条；KV/R2 binding 落 wrangler；NanoSessionDO 拆分到 ≤1200 行 facade |
| **Phase 1** | Lane F 完整闭合（dispatcher / scheduler / WS push） | 2 周 | hook.emit 真实 delegate；scheduler 产生 hook_emit；onUsageCommit → WS push live；permission round-trip 端到端 |
| **Phase 2** | 客户端可见性闭环（/models + /context + tool result frame + bidirectional WS） | 2 周 | `GET /models` 暴露 13 个 Workers AI 模型；`GET /sessions/{id}/context` 与 InspectorFacade 数据互通；WS 协议升级到 NACP frame；tool.call.progress / tool.call.result 真实 emit |
| **Phase 3** | 租户产品面（device auth gate / team display / api key / /me/conversations 双源） | 2 周 | D6 device revoke 进入 access/refresh/WS gate；nano_teams 加 team_name/slug；verifyApiKey 落地；/me/conversations 与 handleMeSessions 读取对齐 |
| **Phase 4** | filesystem 真实持久化 + Lane E consumer migration | 2 周 | KV/R2 binding 在 filesystem-core 与 agent-core 落地；agent-core CONTEXT_CORE / FILESYSTEM_CORE binding 活化；R2 file upload pipeline；artifact 真实可下载 |
| **Phase 5** | 多模型 + 多模态 + reasoning 模型上线 | 1.5 周 | 注册全部 13 个 Workers AI function-calling 模型 + 4 个 vision 模型；reasoning effort 参数贯通；llama-4-scout 多模态激活 |
| **Phase 6** | 巨石拆分 + 三层真相冻结 + manual evidence | 2 周 | NanoSessionDO 拆为 facade + 7 文件；user-do.ts 拆为 handler-by-domain；三层真相文档冻结；manual browser/微信开发者工具 evidence pack |
| **总计** | — | **~13 周** | real-to-hero baseline，6 worker 不变，三道闭环全部成立 |

设计原则：
- **不新增 worker**（保持 6-worker 拓扑）。
- **不引入 SQLite-backed DO**（per runtime-session-study：当前 first problem 是 giant DO + product API gap，而不是缺 SQL）。
- **每阶段必须有 endpoint-level 直达测试**（不再让 ZX5 的"代码已存在但运行时不可达"再次发生）。
- **D1 是 product durable truth 的唯一来源**；DO storage = hot read model；DO memory = active loop state；三者职责冻结，不互相吸收。

---

## 3. Phase 0：Bug 修复 + 前期准备（1.5 周）

> Phase 0 的目的是"在开始任何 real-to-hero 新功能开发前，先把测试矩阵 / 基础设施 binding / 已知断点修干净"，避免后续阶段在 production 部署时被 zero-to-real 残留断点反噬。

### 3.1 P0-A：jwt-shared lockfile 与独立 build/test 修复（GP R4 blocker）

**问题**：`packages/jwt-shared` 的 standalone `pnpm build/test` 失败（vitest/tsc not found）；`pnpm-lock.yaml` 缺 `packages/jwt-shared` importer，且仍保留已物理删除的旧包 importer（`packages/agent-runtime-kernel`、`packages/capability-runtime`、`packages/context-management`）。

**做法**：
1. 在带 `NODE_AUTH_TOKEN`（classic PAT w/ `read:packages`）的环境中执行 `pnpm install`。
2. 提交更新后的 `pnpm-lock.yaml`，确保有 `packages/jwt-shared` importer 并删除已物理不存在包的 stale importer。
3. 验证：`pnpm --filter @haimang/jwt-shared build typecheck test` 全绿。

**承接位置**：closure §4 item 13。

**owner-action 依赖**：需要 owner 提供带 `NODE_AUTH_TOKEN` 的 CI 环境或本地刷新一次。

### 3.2 P0-B：ZX5 product endpoints 直达测试矩阵（GP R5）

**问题**：`/messages` / `/files` / `/me/conversations` / `/me/devices/revoke` 已落地但缺 endpoint-level 直达测试；当 needsBody 类 silent-drop 再次发生时无法被自动捕获。

**做法**：在 `workers/orchestrator-core/test/` 下新增（或扩展现有）：
1. `messages-route.test.ts`：验证 `/messages` D1 append + `AGENT_CORE.input` 被调用 + body 透传完整 + idempotency_key 行为。
2. `files-route.test.ts`：验证 `/files` 从 artifact_ref 返回 metadata + audience filter + cursor pagination 行为。
3. `me-conversations-route.test.ts`：验证 `/me/conversations` header authority + listSessionsForUser D1 query + cursor null 文档化。
4. `me-devices-revoke-route.test.ts`：验证 `/me/devices/revoke` ownership / idempotent / audit insert + D1 batch behavior。
5. `permission-decision-route.test.ts`、`elicitation-answer-route.test.ts`、`policy-permission-mode-route.test.ts`：验证 needsBody 修复后这三条 POST 路由 body 透传。

**DoD**：每条 route 至少 5 个测试用例（happy path / 401 / 400 body / 500 internal / idempotency replay）。

**承接位置**：closure §4 item 15。

### 3.3 P0-C：KV / R2 binding 在 wrangler 中声明（不启用业务，仅占位）

**问题**：所有 6 worker 的 wrangler.jsonc 均无 `kv_namespaces` / `r2_buckets` 声明；账号中已存在 `nano-agent-spike-do-storage-probe*` 探针资源（DeepSeek 调查确认），但 worker 运行时无法访问。Phase 4 的 file upload pipeline 依赖此 binding。

**做法**：
1. 创建 production-grade KV namespace（如 `nano-agent-session-cache`）和 R2 bucket（如 `nano-agent-artifacts`），preview 用 spike 资源。
2. 在 `workers/filesystem-core/wrangler.jsonc` 与 `workers/agent-core/wrangler.jsonc` 添加 `kv_namespaces` 与 `r2_buckets` binding（与 D1 同样使用 `default` + `env.preview` 双套配置）。
3. 暂不实装业务读写路径；只确保 `wrangler deploy --dry-run` 通过、binding 在 Worker 启动时可见。
4. 添加 `tests/binding-presence.test.ts`：断言 binding env keys 存在。

**owner-action 依赖**：owner 在 Cloudflare dashboard 创建 production R2 bucket 与 KV namespace（约 5 分钟操作）。

### 3.4 P0-D：NanoSessionDO 拆分预备（per runtime-session-study Phase 1）

**问题**：`workers/agent-core/src/host/do/nano-session-do.ts` 当前 2078 行；`user-do.ts` 当前 2285 行。在不拆分的情况下，Phase 1 的 Lane F live runtime 改造、Phase 2 的 WS bidirectional 改造都会在巨石内继续堆积，提高 conflict / regression 风险。

**做法**（per runtime-session-study §5 推荐拆分顺序）：

只在 Phase 0 完成最低风险的两项 pure refactor，作为后续阶段的脚手架：

1. **拆出 `session-do-verify.ts`**：preview verification + capability probes 相关代码迁出，无路由变更、无存储语义变更。
2. **拆出 `session-do-persistence.ts`**：checkpoint / restore / tenant-scoped storage 相关代码迁出。

**DoD**：
- NanoSessionDO 主文件 ≤ 1500 行。
- 拆分前后所有 agent-core 测试（1056 / 1056）全绿。
- 不改 route shape、不改 storage key、不改 runtime 语义。

**剩余拆分（ws / ingress / bootstrap / orchestration-deps / identity）**：留给 Phase 6，以避免与 Lane F live runtime 改动冲突。

### 3.5 P0-E：本轮 implementer fix 部署验证

**问题**：本轮已修复 14 项 + partially-fixed 6 项，但仅在本地通过测试；尚未 deploy 到 preview，验证：
- DS R1 needsBody 修复后 5 条 POST 路由的 body 透传在 live preview 上工作；
- DS R5 WorkerEntrypoint 默认导出修复后 RPC 方法在 service binding 下可达；
- DS R23 JWT_LEEWAY_SECONDS 修复后 token 时钟漂移容差在生产环境工作。

**做法**：
1. 部署到 preview：`pnpm preview:deploy`（或 owner 触发 CI deploy）。
2. 执行 manual smoke：
   - curl `POST /sessions/{uuid}/messages` 验证 body 不再被 silent-drop。
   - 通过 service binding 调用 context-core / filesystem-core RPC 方法（probe / contextOps / filesystemOps）验证 RPC 可达。
   - 用故意延迟 +200s 的 token 测试 JWT 验证仍通过（leeway 内）。
3. 在 `docs/issue/zero-to-real/post-fix-verification.md` 记录部署 evidence。

### 3.6 Phase 0 退出条件

- ✅ jwt-shared standalone 测试全绿。
- ✅ ZX5 product endpoints 至少 5 条 endpoint-level 测试覆盖（含 needsBody 回归保护）。
- ✅ KV/R2 binding 落地 wrangler.jsonc（仅占位，不启用业务）。
- ✅ NanoSessionDO 拆出 verify + persistence 两个文件，主文件 ≤1500 行。
- ✅ 本轮 fix 已 preview 部署并有 manual evidence。

---

## 4. Phase 1：Lane F live runtime 完整闭合（2 周）

> closure §4 item 9 + 10：scheduler 产生 hook_emit 决策、hook.emit delegate 实装、emitPermissionRequestAndAwait 找到调用方、onUsageCommit WS push。

### 4.1 P1-A：hook.emit kernel delegate 真实化（DS R2）

**当前**：`runtime-mainline.ts:295-298` 中 `hook: { async emit() { return undefined; } }` 是无条件 no-op。

**做法**：
1. 定义 `HookEmitDelegate` 接口：`emit(event: HookEvent, payload: HookPayload): Promise<HookEmitResult>`，其中 `HookEmitResult` 包含 `verdict: allow | deny | wait` + `pending_uuid?`。
2. 实装 `kernelHookEmitDelegate(deps: { dispatcher, ws, sessionDoStorage, evalSink })`：将 hook event 路由到 hook dispatcher（PreToolUse / PostToolUse / PermissionRequest 等 18 catalog 事件）。
3. 在 `createMainlineKernelRunner` 时通过 deps 注入真实 delegate（替换 no-op）。
4. 添加 unit test：18 个 catalog hook 事件在 mock dispatcher 下能被 emit 并收到 verdict。

### 4.2 P1-B：scheduler 产生 hook_emit 决策（DS R6）

**当前**：`workers/agent-core/src/kernel/scheduler.ts:27-67` 仅产生 `wait/compact/tool_exec/llm_call/finish` 五种决策；`KernelDecision` types 已包含 `hook_emit` 但 scheduler 永不触发。

**做法**：
1. 在 `SessionState` 中加入 `pendingHooks: HookEmitRequest[]` 字段（per turn 收集）。
2. scheduler 优先级：`cancel > timeout > pendingHook > compact > tool_exec > llm_call > finish`（hookEmit 在 compact 之前以避免被 compaction 淹没）。
3. PreToolUse 在 `tool_exec` 决策前自动注入；PostToolUse 在 tool_exec 完成后自动注入；PermissionRequest 在 capability policy 返回 `ask` 时注入。
4. 在 `runner.ts handleHookEmit` 调用 delegate 后根据 verdict 更新 state（`allow → 继续 tool_exec`、`deny → finish + audit`、`wait → pending_uuid 存入 DO storage 等待 resume`）。
5. 添加 unit test：scheduler 在不同 state 下产生正确的 hook_emit 序列。

### 4.3 P1-C：emitPermissionRequestAndAwait / emitElicitationRequestAndAwait 真实激活（DS R4）

**当前**：两个 method 在全代码库零调用方；method 内部 WS frame emit 注释为 `void this.sessionUuid;` no-op。

**做法**：
1. 在 P1-A 的 hook.emit delegate 中：当 `wait` verdict 返回时，调用 `NanoSessionDO.emitPermissionRequestAndAwait(decisionUuid, payload)`。
2. 实装 method 内部：通过 `this.wsHelper.send(buildSessionPermissionRequestFrame(...))` 真实推送 NACP `session.permission.request` frame；调用 `awaitAsyncAnswer(decisionUuid, timeoutMs)` 等待 client 端 `POST /sessions/{uuid}/permission/decision` 回写到 DO storage。
3. `handlePermissionDecisionRecord` 写入 DO storage 后，唤醒同 `decisionUuid` 的 waiter（已有 deferredAnswers Map 基础设施）。
4. 添加 e2e 测试：tool call → policy ask → WS permission request → HTTP decision → tool exec resume。
5. elicitation 同样模式。

### 4.4 P1-D：onUsageCommit WS push 完整路径（DS R3 / closure §4 item 10）

**当前**：onUsageCommit callback 已注册（本轮 implementer fix），但实现为 console.log；未通过 orchestrator-core 推送到 client。

**做法**：
1. 在 `NanoSessionDO.createLiveKernelRunner` 中将 callback 改为：构造 NACP `session.usage.update` frame → 通过 `wsHelper.send()` 推到 attached client。
2. 在 orchestrator-core 端：因为 WS 实际由 user-do 持有（per orchestrator-core wrangler binding 拓扑），需要 internal channel：agent-core NanoSessionDO → user-do → client WS。
3. 实装 internal action `session.usage.update` 由 NanoSessionDO 调用 user-do 的 `forwardServerFrameToClient(sessionUuid, frame)` RPC。
4. user-do 通过本地 attachment map 找到对应 WebSocket 并 send。
5. 添加 e2e 测试：LLM call commit → onUsageCommit → user-do → client WS 收到 usage frame。

### 4.5 P1-E：handleUsage HTTP snapshot 真实化

**当前**：`/sessions/{uuid}/usage` 返回 token/tool/cost null placeholders。

**做法**：
1. handleUsage 查询 D1 `nano_usage_events` + `nano_quota_balances`，返回真实 token/tool/cost。
2. 与 P1-D 保持 snapshot vs push 的一致性：HTTP snapshot 是 strict-consistent，WS push 是 best-effort。

### 4.6 Phase 1 退出条件

- ✅ hook.emit delegate 真实工作，18 个 catalog 事件可被触达。
- ✅ scheduler 在 PreToolUse/PostToolUse/PermissionRequest 自动产生 hook_emit。
- ✅ Permission round-trip 端到端 e2e（≥3 测试用例：allow/deny/timeout）。
- ✅ Elicitation round-trip 端到端 e2e。
- ✅ onUsageCommit → WS push live evidence（preview deploy + curl + ws client 验证）。
- ✅ /sessions/{uuid}/usage HTTP 不再返回 null。

---

## 5. Phase 2：客户端可见性闭环（2 周）

> 4 家 api-gap-study 共识 first-wave：`GET /models` + `GET /sessions/{id}/context` + bidirectional WS + tool result visibility。

### 5.1 P2-A：`GET /models` 端点

**当前**：无 route；模型硬编码在 `gateway.ts WORKERS_AI_REGISTRY`（仅 2 个）。

**做法**：
1. 新增 D1 表 `nano_models`：`model_id, provider_key, display_name, supports_tools, supports_vision, supports_reasoning, input_modalities, context_window, max_output_tokens, default_for_team_uuid?, owner_policy_json`。
2. seed 初始化：注册 13 个 Workers AI function-calling 模型 + 4 个 vision 模型（granite-4.0-h-micro / llama-4-scout-17b / kimi-k2.6 / gpt-oss-120b / glm-4.7-flash / nemotron-3-120b / gemma-4-26b 等）。**注意**：context window 修正为真实值（131K，不是 128K）。
3. 新增 route `GET /models`：返回 `{ default_model_id, models: [...] }`，per team_uuid policy filter。
4. orchestrator-core 通过 RPC `agent-core.listModels(teamUuid)` 获取（不直接查 D1，因为模型 catalog 是 agent-core 的 runtime concern）。
5. 添加测试：5 测试用例（默认 catalog / team policy filter / 401 / cursor / ETag）。

### 5.2 P2-B：`GET /sessions/{id}/context` 端点

**当前**：InspectorFacade 是 library-only；在 `INSPECTOR_FACADE_ENABLED` env var 后才启用，且仅用于 internal debug。

**做法**：
1. 暴露 InspectorFacade 数据为 NanoSessionDO RPC method：`getContextSnapshot(sessionUuid)` 返回 `{ context_window, total_tokens, free_tokens, layers: [...], compact: {...} }`。
2. 新增 route `GET /sessions/{id}/context` 在 orchestrator-core；user-do 通过 NanoSessionDO RPC 取数据。
3. 同时新增 `POST /sessions/{id}/context/snapshot` 与 `POST /sessions/{id}/context/compact`（per Claude Code `/context` 设计）。
4. 添加测试：3 测试用例（基础 query / 并发 snapshot / compact 触发）。

### 5.3 P2-C：WS 协议升级到 NACP full frame

**当前**：WS wire 仍是 lightweight `{kind, ...}`；NACP `validateSessionFrame` 在代码完备但未在真实 WS path 上生效。

**做法**：
1. 在 `NanoSessionDO` 的 WS send/receive path 启用 `validateSessionFrame()`。
2. **不强求一次切换**：保留 lightweight 兼容 1 个 release，但所有新增 frame 必须 NACP-conformant（permission.request / elicitation.request / usage.update / tool.call.progress / tool.call.result）。
3. 新增 `meta(opened)` server frame on connection establishment（per api-gap-study 7.1a 共识）。
4. 处理 client → server 消息（之前 user-do 收到后只 touch liveness）：
   - `session.stream.ack` → 更新 ackWindow + relay cursor
   - `session.resume` → 触发 replay
   - `session.permission.decision` → 写 DO storage 并 unblock waiter（与 P1-C 联动）
   - `session.elicitation.answer` → 同上

### 5.4 P2-D：Tool call 增量流式 + tool result frame

**当前**：tool call 是单个 `llm.delta(content_type=tool_use_start)` atomic event；tool result 完全不发到 client。

**做法**：
1. 在 LLM stream parser 中识别 `tool_use_start / tool_use_delta / tool_use_stop`，分别 emit 对应 NACP frame。
2. 在 KernelRunner.handleToolExec 完成后，emit `tool.call.result` NACP frame（含 success/error + 输出预览 + artifact_ref?）。
3. 添加 e2e 测试：模拟一次 ls 工具调用，client 应收到 tool_use_start → tool_use_delta（参数流式）→ tool_use_stop → tool.call.progress → tool.call.result。

### 5.5 Phase 2 退出条件

- ✅ `GET /models` 暴露 ≥13 模型 + per-team policy filter。
- ✅ `GET /sessions/{id}/context` 数据与 InspectorFacade 互通。
- ✅ WS 升级到 NACP frame，含 meta(opened) + bidirectional 消息处理。
- ✅ Tool call 增量流式 + tool result frame 端到端 e2e。

---

## 6. Phase 3：租户产品面（2 周）

### 6.1 P3-A：D6 device revoke 进入 access/refresh/WS auth gate（GP R1 / closure §4 item 8）

**当前**：`/me/devices/revoke` 仅写 D1，已发 access token 直到 exp 仍可用；refresh chain 不被 device truth gate 拒绝。

**做法**：
1. 在 `mintAccessToken` 中将 `device_uuid` 纳入 `AccessTokenClaimsSchema` 与 `IngressAuthSnapshot`。
2. 在 `verifyAccessToken` 中：除签名/exp 验证外，**额外查 D1**：`SELECT status FROM nano_user_devices WHERE device_uuid = ? AND status = 'active'`；若 revoked 则返回 401。
3. 同样在 `refresh` path 检查 device status；revoke 后 refresh 立即失效。
4. WS attach path 通过 `authenticateRequest` 走同样 device 检查。
5. `/me/devices/revoke` 成功后通过 `forwardServerFrameToClient` 给同 device 的 attached WS 推送 `meta(force-disconnect, reason: device-revoked)` 然后服务端关闭连接。
6. 性能优化：device status 缓存到 user-do KV（5 分钟 TTL），revoke 操作主动清缓存。

### 6.2 P3-B：nano_teams 加 team_name / team_slug（DeepSeek + kimi 共识）

**当前**：`nano_teams` 仅有 `team_uuid / owner_user_uuid / created_at / plan_level`；`/auth/me` 返回的 team 仅含 UUID，前端不可读。

**做法**：
1. migration 008-tenant-display-fields.sql：`ALTER TABLE nano_teams ADD COLUMN team_name TEXT; ADD COLUMN team_slug TEXT UNIQUE;`。
2. 注册时自动生成：`team_name = ${display_name}'s workspace`；`team_slug = slugify(display_name) + '-' + random6chars`。
3. `/auth/me` 响应增加 `team_name / team_slug`。
4. 新增 `PATCH /me/team` 允许 owner 更新 team_name（不允许改 slug，避免 link rot）。

### 6.3 P3-C：API key verify 实装（GLM R4 / closure §4 item 12）

**当前**：`verifyApiKey` 永远返回 `{supported: false, reason: "reserved-for-future-phase"}`；`nano_team_api_keys` DDL 已存在但零读写。

**做法**（最小路径，per zero-to-real charter Z1 In-Scope）：
1. 实装 `service.verifyApiKey(rawMeta)`：从 header `Authorization: Bearer nak_...` 中解析 raw key，HMAC-SHA256(salt:raw) 后查 `nano_team_api_keys`，返回 `{supported: true, team_uuid, key_uuid, scopes, plan_level}`。
2. 不实装 admin plane（list/create/revoke UI）；仅提供 owner-side 的 internal RPC `createApiKey(team_uuid, label, scopes)` 用于 manual 测试。
3. 在 `authenticateRequest` 中支持双轨：JWT Bearer / API key Bearer（根据前缀区分 `eyJ`(JWT) vs `nak_`(API key)）。
4. 添加测试：5 测试用例。

### 6.4 P3-D：/me/conversations D1+KV 双源对齐（DS R8 / closure §4 item 14）

**当前**：`handleMeConversations` 仅查 D1；`handleMeSessions` 同时查 KV+D1；同一用户可能在两处看到不同数据集。

**做法**：
1. 与 handleMeSessions 对齐读取策略：先查 user-do KV `conversation/index`（hot）→ 不足再回 D1（cold）→ merge。
2. 如果 session 仅在 KV 而 D1 未迁移，handleMeConversations 应该看到（per Z2 "real loop 可持久、可回看" 要求）。
3. 添加 cursor-based pagination（KM R5）：基于 `latest_session_started_at` 的 keyset cursor，限 50/page。
4. 添加测试：4 测试用例（仅 D1 / 仅 KV / 双源 merge / cursor 分页）。

### 6.5 P3-E：refresh / access token 与 device_uuid 绑定

**当前**：refresh token 没有 device 维度；用户登录后所有 device 共享同一 refresh chain。

**做法**：
1. login / register / wechat-login 时自动 mint device_uuid（client 可在 header `X-Device-Hint` 提供 fingerprint），并写 `nano_user_devices`。
2. refresh token rotation 时保留 device_uuid 绑定。
3. `/me/devices` GET 列出当前用户所有 active device，包含 platform / last_seen_at / created_at。

### 6.6 Phase 3 退出条件

- ✅ Device revoke 后 access token 立即失效（含 WS）。
- ✅ `/auth/me` 返回 team_name / team_slug。
- ✅ verifyApiKey 真实工作，server-to-server bearer 鉴权可用。
- ✅ /me/conversations 与 handleMeSessions 数据集一致 + cursor pagination。
- ✅ /me/devices 列举 + revoke 完整闭环。

---

## 7. Phase 4：filesystem 真实持久化 + Lane E consumer migration（2 周）

> closure §4 item 11 + api-gap-study 共识 P1：filesystem-core 不能再是 in-memory + library-only。

### 7.1 P4-A：filesystem-core wrangler binding 启用（per Phase 0 占位）

**当前**：filesystem-core wrangler 无 KV/R2 binding；ArtifactStore 是 InMemoryMap；StubArtifactPreparer 只 fake key。

**做法**：
1. filesystem-core wrangler 加 `r2_buckets` (artifacts) + `kv_namespaces` (metadata cache) + `d1_databases` (session_files)。
2. 实装 `R2ArtifactStore`：`writeArtifact(team_uuid, session_uuid, file_uuid, body, mime, size, audience)` → R2 put + D1 metadata insert + KV cache invalidate。
3. 实装 `R2ArtifactReader`：`readArtifact(file_uuid, scope)` → D1 metadata + R2 get；`listSessionFiles(session_uuid, cursor, audience)` → D1 query + KV cache。
4. 实装 prepared artifact pipeline：image → resize/thumbnail；pdf → text extraction；audio → transcript（这些可以是 Phase 4 内最小占位 stub，留 Phase 5+ 完善）。

### 7.2 P4-B：filesystem-core RPC 真实业务方法

**当前**：filesystem-core WorkerEntrypoint 仅 `probe / nacpVersion / filesystemOps`，op-list only。

**做法**：
1. 在 `FilesystemCoreEntrypoint` 添加业务 RPC：
   - `writeArtifact(input, meta)` → R2 put + D1 metadata
   - `readArtifact(input, meta)` → R2 get + D1 metadata join
   - `listSessionFiles(input, meta)` → D1 query + cursor
   - `prepareArtifact(input, meta)` → 触发 prepared pipeline
2. RPC meta 同 bash-core：authority + caller 白名单 + trace_uuid + request_uuid。
3. 添加 unit test：5+5 测试用例每方法。

### 7.3 P4-C：DDL `nano_session_files`（FS metadata read model）

**问题**：D1 缺 `nano_session_files` 表来支撑 client-visible file listing。

**做法**：
1. migration 009-session-files.sql：`nano_session_files (file_uuid PK, session_uuid FK, conversation_uuid FK, team_uuid, artifact_ref, mime, size_bytes, audience, prepared_state, created_at)`。
2. handleFiles 改为查此表（替换当前的 artifact_ref 扫描）。

### 7.4 P4-D：Lane E consumer migration（agent-core 切 RPC-first）

**当前**：agent-core 仍通过 `import { appendInitialContextLayer } from "@haimang/context-core-worker/context-api/..."` library import；CONTEXT_CORE / FILESYSTEM_CORE binding 注释。

**做法**：
1. 解开 agent-core wrangler.jsonc 中 CONTEXT_CORE / FILESYSTEM_CORE binding 注释。
2. 添加 env flag `NANO_AGENT_CONTEXT_RPC_FIRST` / `NANO_AGENT_FILESYSTEM_RPC_FIRST`（boolean，preview=true，prod=false 默认）。
3. 在 `nano-session-do.ts` 的 context/filesystem consumer 路径添加 dual-track：flag=true 走 RPC，flag=false 走 library import（短期 shim）。
4. cross-e2e 测试稳定 2 周后，prod flag 切到 true；最终删除 library import。

### 7.5 P4-E：File upload pipeline（client-facing）

**做法**：
1. 新增 `POST /sessions/{id}/files`：client 上传 file（multipart/form-data 或预签名 URL）。
2. 短期最小路径：multipart/form-data 直传到 orchestrator-core → 转 filesystem-core RPC writeArtifact。
3. 长期路径（Phase 5+）：3-step（create file_uuid → presigned R2 PUT URL → finalize）per Codex 设计。

### 7.6 Phase 4 退出条件

- ✅ filesystem-core 真实 R2/KV/D1 binding 工作。
- ✅ filesystem-core 业务 RPC（writeArtifact / readArtifact / listSessionFiles）可被 agent-core / orchestrator-core 调用。
- ✅ agent-core RPC-first flag 在 preview 启用，cross-e2e 稳定。
- ✅ POST /sessions/{id}/files 端到端可用，能上传 image 到 R2。

---

## 8. Phase 5：多模型 + 多模态 + reasoning 模型上线（1.5 周）

### 8.1 P5-A：注册全部 13 个 Workers AI function-calling 模型

**当前**：`gateway.ts` 仅注册 granite-4.0-h-micro + llama-4-scout-17b 两个模型；context window 错标为 128K。

**做法**：
1. 在 `nano_models` 表 seed 13 个模型（per GLM api-gap-study 6.2a）：
   - granite-4.0-h-micro（131K, default-for-general）
   - llama-4-scout-17b（131K, multimodal, default-for-vision）
   - llama-3.3-70b-instruct-fp8-fast（24K）
   - mistral-small-3.1-24b-instruct（128K）
   - gemma-4-26b-a4b-it（256K, reasoning）
   - gpt-oss-120b（128K, reasoning, default-for-reasoning）
   - gpt-oss-20b（128K, reasoning）
   - qwen3-30b-a3b-fp8（32K, reasoning）
   - kimi-k2.5（256K, reasoning）
   - kimi-k2.6（262K, reasoning）
   - nemotron-3-120b-a12b（256K, reasoning）
   - glm-4.7-flash（131K, reasoning）
   - hermes-2-pro-mistral-7b（24K）
2. 修正 context window 真实值（131K 取代 128K）。

### 8.2 P5-B：Per-session model selection

**当前**：`SessionStartBodySchema` / `SessionInputBodySchema` / `SessionMessagesBodySchema` 不接受 `model_id` 字段。

**做法**：
1. 在三个 body schema 加 `model_id?: string`。
2. 在 user-do 转 agent-core 时透传 model_id。
3. agent-core kernel runner 在 LLM call 时使用透传的 model_id；如果未提供则用 team policy default。
4. 添加 team policy validation：用户只能选择 `nano_models.owner_policy_json` 允许的模型。

### 8.3 P5-C：Vision 模型激活（多模态）

**当前**：`ModelCapabilities.supportsVision = false` 即使 llama-4-scout 是 natively multimodal。

**做法**：
1. 修正 `nano_models` seed：llama-4-scout / llama-3.2-11b-vision / llava-1.5-7b / gemma-3-12b-it 的 `supports_vision = true`。
2. 在 `buildExecutionRequest()` 移除"vision capability rejection"硬限制；如果 model 不支持 vision，返回明确的 capability error 而非 silent drop。
3. POST /sessions/{id}/messages 支持 `image_url` content part（与 P4-E file upload 协同）。

### 8.4 P5-D：Reasoning effort 参数贯通

**当前**：8 个 reasoning 模型可用；`CanonicalLLMRequest` 不支持 thinking/reasoning 参数。

**做法**：
1. 在 `CanonicalLLMRequest` 加 `reasoning?: { effort: "low" | "medium" | "high" }`（per Codex 设计）。
2. Workers AI adapter 将 `reasoning` 翻译成 Workers AI native 参数（具体名称由 Workers AI doc 决定）。
3. 在 message body 透传 reasoning effort；如果 model 不支持，返回 capability error。
4. 添加测试：5 测试用例（4 effort 等级 + 不支持 model 的拒绝）。

### 8.5 Phase 5 退出条件

- ✅ `GET /models` 返回 13 模型 + 4 vision + 8 reasoning。
- ✅ Per-session model_id 端到端可用。
- ✅ POST /sessions/{id}/messages 支持 image_url + 多模态。
- ✅ Reasoning effort 参数贯通到 8 个 reasoning 模型。

---

## 9. Phase 6：巨石拆分 + 三层真相冻结 + manual evidence（2 周）

### 9.1 P6-A：NanoSessionDO 完整拆分（per runtime-session-study）

**Phase 0 已完成**：verify + persistence。**Phase 6 完成余下 5 个**：
- session-do-bootstrap.ts
- session-do-identity.ts
- session-do-ingress.ts
- session-do-ws.ts
- session-do-orchestration-deps.ts

**DoD**：NanoSessionDO 主文件 ≤ 400 行（仅保留 constructor + fetch + webSocketMessage + webSocketClose + alarm + 字段定义）。

### 9.2 P6-B：user-do.ts 按 domain 拆分（KM R3）

**当前**：2285 行，含 15+ handler。

**做法**：拆为 `handlers/{start, input, messages, cancel, verify, files, me-conversations, me-devices, permission-decision, elicitation-answer}.ts`；共用基础设施（D1 repo、KV、auth）提取为 `user-do-infrastructure.ts`。

**DoD**：user-do.ts 主文件 ≤ 500 行；每 handler 文件 ≤ 250 行。

### 9.3 P6-C：三层真相冻结文档（per runtime-session-study Phase B/C）

**做法**：在 `docs/architecture/three-layer-truth.md` 写明：
1. **session DO memory** = 当前 loop truth（OrchestrationState、wsHelper、heartbeatTracker、ackWindow 等）
2. **user DO storage** = 每用户 hot index/read model（sessions/{uuid}、conversation/index、recent-frames/{uuid}、cache/{name}）
3. **D1** = product durable truth（identity、conversation、session、turn、message、activity、usage、device、files、models）
4. **明确禁止**：将 session hot path 推到 KV/R2；checkpoint/replay/recent-frames 必须留在 DO memory + DO storage。

### 9.4 P6-D：Manual evidence pack（closure §4 item 1）

**做法**：
1. 在浏览器（Chrome / Safari）跑 web client，录制 console + network；归档至 `docs/evidence/web-manual-2026-XX/`。
2. 在微信开发者工具跑 mini program，归档至 `docs/evidence/wechat-manual-2026-XX/`。
3. 在真机（iOS / Android 微信）跑一次端到端：register → login → start session → send message → receive WS frames → revoke device → 重新 attach 被拒。

**owner-action**：需要 owner 配合在浏览器与微信开发者工具中执行手动测试，以及一台真机。

### 9.5 P6-E：cleanup 残余（closure §4 item 3）

**做法**：删除 dead `deploy-fill` compatibility residue；清理 forwardInternalJson（已 @deprecated）；删除 ZX5 short-term shim 中已不需要的 dual-track 代码。

### 9.6 Phase 6 退出条件

- ✅ NanoSessionDO 拆分完成，主文件 ≤400 行。
- ✅ user-do.ts 按 domain 拆分完成。
- ✅ 三层真相文档冻结。
- ✅ Manual browser + 微信开发者工具 + 真机 evidence pack 归档。
- ✅ Dead code residue 清理完成。

---

## 10. 与 zero-to-real partial-close §4 残余项的全量映射

| closure §4 item | 在本 plan 中的承接 |
|---|---|
| 1. manual browser / 微信开发者工具 / 真机证据 | Phase 6.4 |
| 2. token-level live streaming 或 snapshot-vs-push 决策 | Phase 1.5（handleUsage 真实化）+ Phase 2.4（tool call 增量流式） |
| 3. dead `deploy-fill` compatibility residue 清理 | Phase 6.5 |
| 4. DO websocket heartbeat lifecycle 的 platform-fit hardening | Phase 2.3（WS NACP frame）顺带处理 |
| 5. tool registry 与 client session helper 的单一真相源抽取 | Phase 5（model registry）+ Phase 6.3（三层真相冻结） |
| 6. richer quota/bootstrap hardening、admin plane、billing/control plane | **out-of-scope**：admin plane / billing 不在 real-to-hero（保持 zero-to-real charter §1.4 边界）；quota hardening 在 Phase 1.5 处理 |
| 7. broader multi-tenant-per-deploy 与更深的 internal RPC 演进 | **out-of-scope**：多 deploy 维度暂不引入 |
| 8. D6 device revoke auth gate | Phase 3.1 |
| 9. Lane F dispatcher 完整闭合 | Phase 1.1 + 1.2 + 1.3 |
| 10. onUsageCommit WS push | Phase 1.4 |
| 11. Lane E consumer migration | Phase 4.4 |
| 12. API key verify 运行时路径 | Phase 3.3 |
| 13. jwt-shared lockfile | Phase 0.1 |
| 14. /me/conversations D1+KV 双源对齐 | Phase 3.4 |
| 15. ZX5 product endpoints 测试 | Phase 0.2 |

---

## 11. 与 api-gap-study 4 家共识的全量映射

| api-gap-study 共识 first-wave 项 | 在本 plan 中的承接 |
|---|---|
| `POST /sessions/{id}/messages` (含多模态、idempotency、model_id) | 已在 ZX5 Lane D 落地 base；Phase 5.3 加 image_url；Phase 5.2 加 model_id |
| `GET /sessions/{id}/files` | 已在 ZX5 Lane D 落地 base；Phase 4.5 加 upload pipeline |
| `GET /me/conversations` | 已在 ZX5 Lane D 落地 base；Phase 3.4 加 KV 双源 + cursor |
| `GET /sessions/{id}/context` | Phase 2.2 |
| `GET /models` | Phase 2.1 |
| `POST /me/devices/revoke` 完整 auth gate | Phase 3.1 |
| `verifyApiKey` 实装 | Phase 3.3 |
| Permission round-trip live | Phase 1.3 |
| Usage WS push live | Phase 1.4 |
| Tool call 增量流式 + tool result frame | Phase 2.4 |
| Pending session DDL（已落地 migration 006） | **already done** |
| catalog 真实内容 | **out-of-scope first-wave**（已有静态 CATALOG_SKILLS/COMMANDS/AGENTS 占位；真实 plug-in 注册框架是 real-to-hero v2 工作） |
| device 表（已落地 migration 007） | **already done** |
| nano_teams team_name/slug | Phase 3.2 |
| KV/R2 binding 落 wrangler | Phase 0.3（占位）+ Phase 4.1（启用） |
| 多模型注册（13 + 4 vision） | Phase 5.1 + 5.3 |
| Reasoning model 支持 | Phase 5.4 |
| WS NACP full frame + meta(opened) + bidirectional | Phase 2.3 |
| Logout / token revocation | **out-of-scope first-wave**（device revoke 已经覆盖核心场景；显式 logout endpoint 是 v2 polish） |
| Multi-provider LLM routing | **out-of-scope first-wave**（Workers AI 13 模型已经覆盖核心需求；DeepSeek throw-skeleton + OpenAI adapter 启用是 v2） |
| Prompt caching / structured output | **out-of-scope first-wave**（依赖 provider-specific 特性，需要先有 multi-provider 路由） |
| Sandbox 隔离 / streaming progress for bash | **out-of-scope first-wave**（bash-core 当前 fake 实现已能支撑 demo； sandbox 是 hardening 阶段工作） |

---

## 12. 与 runtime-session-study Phase A-D 路线的全量映射

| runtime-session-study 推荐 | 在本 plan 中的承接 |
|---|---|
| Phase A：先纯拆分 NanoSessionDO，不改存储语义 | Phase 0.4（verify + persistence）+ Phase 6.1（剩余 5 个文件） |
| Phase B：冻结三层真相 | Phase 6.3 |
| Phase C：（可选）user DO 升 SQLite | **out-of-scope first-wave**（per study 推荐：当前 first problem 不是缺 SQL；list/分页可在 user-do KV index 中先实现 cursor，不需要 SQLite） |
| Phase D：（可选）session DO 升 SQLite for checkpoint/replay | **out-of-scope first-wave**（同上） |

---

## 13. 风险与不确定性

1. **Phase 1 hook dispatcher 改造范围大**：scheduler / runner / delegate / DO storage 四层联动；可能影响 agent-core 1056 个测试中的相当一部分。建议在独立 feature branch 开发，cross-e2e 稳定后再合主。
2. **Phase 4 R2/KV 真实接线后，可能暴露 multi-tenant 边界 bug**：当前 fake backend 不会在 path 编码 team_uuid；切真实 R2 后需要严格的 key namespace 校验。建议在 R2 path 引入 `tenants/{teamUuid}/...` 强制前缀。
3. **Phase 5 多模型上线后，cost / quota 需要 per-model 区分**：当前 `nano_quota_balances` 仅区分 `quota_kind IN ('llm', 'tool')`，不区分模型。考虑在 Phase 5 末尾加 migration 010 扩展为 per-model quota（DS R5 / kimi 共识，但优先级 P2）。
4. **Phase 6 拆分时与 Phase 1 改造的合并冲突**：建议 Phase 6.1 的拆分在 Phase 1 全部 merge 后启动，避免 rebase hell。
5. **Owner-action 依赖**：Phase 0.1 jwt-shared lockfile 需 NODE_AUTH_TOKEN；Phase 0.3 R2 bucket / KV namespace 创建；Phase 6.4 manual evidence。这些不能由 implementer 独立完成，需提前与 owner 同步。

---

## 14. 最终判断

real-to-hero 不是一次"全面重构"，而是一次"把 zero-to-real partial-close 残留 + api-gap-study 共识 + runtime-session-study 路线"压成一组**有明确退出条件、不新增 worker、不引入未必要的 SQLite、preserve 三层真相**的 6 阶段计划。

**为什么 Phase 0 必须先做**：因为 jwt-shared lockfile 不修，CI 环境 reproducibility 会拖累后续每个 phase；ZX5 endpoint 测试不补，DS R1 这种 silent-drop 会再次发生且无法被自动捕获；KV/R2 binding 不占位，Phase 4 的 file pipeline 会在 deploy 时被卡住；NanoSessionDO 不预拆，Phase 1 的 Lane F 改造会在 2078 行里继续堆积。

**为什么不做 SQLite-DO 主线**：per runtime-session-study，当前 first problem 不是缺 SQL；session loop memory-first 性能没坏；D1 已是清晰 product truth 来源。强行引入 DO SQLite 会在巨石未拆时绑死"重构 + 存储语义切换"两件事，排障成本太高。等 Phase 6 三层真相冻结后，如果 user-do 的 list/分页确实需要 SQL，再做 SQLite read model 不迟。

**为什么不扩 worker 数**：zero-to-real charter 与 worker-matrix charter 都明确 6-worker 是阶段事实；新增 worker 会触发新一轮 binding/RPC/authority 流转设计，与 real-to-hero "把已有原料打穿成产品基线"的命题正交。

**预期效果**：完成 Phase 0-6 后，nano-agent 第一次拥有：
- 真实可运行的 web/mini-program/CLI 客户端（`/messages` + `/files` + `/me/conversations` + `/me/devices` + `/models` + `/sessions/{id}/context` 全闭环）。
- 真实 live runtime（permission round-trip、elicitation、usage push、tool result frame）。
- 真实 multi-tenant 安全（device revoke auth gate、API key、team display）。
- 真实多模型 / 多模态 / reasoning（13 模型 + 4 vision + 8 reasoning，per-session 选择）。
- 真实持久化（R2 file upload、KV cache、D1 metadata read model）。
- 整洁的代码结构（NanoSessionDO + user-do.ts 巨石拆分完成；三层真相冻结）。

到这一步，"hero" 不再是过度宣称，而是有可验证、可恢复、可演进的实际基线。
