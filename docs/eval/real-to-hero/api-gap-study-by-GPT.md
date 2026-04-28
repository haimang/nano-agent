# real-to-hero：真实客户端 API gap 深度调查（by GPT）

> 本报告只使用当前仓库真实代码与 `context/` 下三个外部 CLI 代码样本作为证据，不引用其他模型的分析结论。  
> 目标不是重新设计 6-worker 拓扑，而是判断：在最新 6-worker 架构下，`orchestrator-core` 已提供的客户端接口距离“真实可运行的多租户 Agent-CLI / Web / 小程序客户端”还有多大 gap。

## 0. 结论先行

当前后端已经具备了一部分“运行内核原材料”：D1 有 identity / team / conversation / session / message / context snapshot / usage quota 表；`agent-core` 已能在有 `AI` binding 时走 Workers AI；`bash-core` 已有 WorkerEntrypoint RPC 与 authority 校验；`context-core` / `filesystem-core` 有大量库级能力。

但从真实客户端视角看，`zero-to-real` 仍没有跨过“可跑真实 client”的最小门槛。主要断点不是单个接口缺文档，而是**客户端最小产品面没有形成闭环**：

1. `POST /sessions/{id}/messages` 不存在，导致 follow-up 仍被限制在 legacy text-only `/input`，无法承载多模态、模型选择、附件引用、客户端消息幂等、离线/重试语义。
2. `GET /sessions/{id}/files` 不存在，且背后没有可列举的 session file / artifact public read model；filesystem 代码有分层原语，但不是可被 client 或 `agent-core` RPC 消费的运行服务。
3. `GET /me/conversations` 不存在，虽然 D1 已有 `nano_conversations`，客户端无法按 conversation 级别恢复、分页、改标题、归档、展示多 session 历史。
4. 模型清单/模型选择完全不是客户端能力：Workers AI 只在 `agent-core` 内部静态注册两个模型，public API 没有 `/models`、没有 owner 业务策略、没有 per-session model selection。
5. context inspection 的库级 facade 已经很厚，但没有挂到 `orchestrator-core` 的 public/internal product API 上；真实 client 缺 `/context` 类探针，不能解释 context window、压缩、层级来源和 token budget。
6. 多租户 auth 有 UUID 级 team/tenant 基础，但没有 tenant/team name/slug、device 管理、team 管理、成员邀请、device revoke 等真实多用户产品面。

因此，`real-to-hero` 的 first-wave 不应再扩散到新 worker 或抽象清洁工作，而应把已有 6-worker 原材料打穿成一组最小可运行客户端 API：`/me/conversations`、`/sessions/{id}/messages`、`/sessions/{id}/files`、`/sessions/{id}/context`、`/models`、`/me/devices`。

## 1. 调查范围与证据口径

### 1.1 当前 public facade 真相

`orchestrator-core` 是唯一客户端 public facade；wrangler 明确 `workers_dev: true`，并绑定 `AGENT_CORE`、`ORCHESTRATOR_AUTH`、`BASH_CORE`、`CONTEXT_CORE`、`FILESYSTEM_CORE` 五个服务（`workers/orchestrator-core/wrangler.jsonc:5-8,48-54`）。但是 `orchestrator-core/src/index.ts` 的 public session route 白名单只有：

| 类别 | 当前代码证据 | 说明 |
|---|---|---|
| session actions | `start/input/cancel/status/timeline/history/verify/ws/usage/resume`（`workers/orchestrator-core/src/index.ts:185-198,216-228`） | 没有 `messages`、`files` |
| compound actions | `permission/decision`、`policy/permission_mode`（`workers/orchestrator-core/src/index.ts:233-242`） | permission HTTP mirror 已有，live WS gate 未完整闭环 |
| auth | `/auth/register`、`/auth/login`、`/auth/refresh`、`/auth/verify`、`/auth/password/reset`、`/auth/wechat/login`、`/auth/me`/`/me`（`workers/orchestrator-core/src/index.ts:259-270`） | public auth 通过 facade proxy 到 `orchestrator-auth` |
| catalog | `/catalog/skills`、`/catalog/commands`、`/catalog/agents`（`workers/orchestrator-core/src/index.ts:247-255,414-433`） | 端点存在，但返回空数组 |
| my sessions | `POST/GET /me/sessions`（`workers/orchestrator-core/src/index.ts:436-500`） | mint 不持久化 pending row，list 只走 User DO hot index |

客户端 API 文档也已经承认缺失项：`POST /sessions/{id}/messages`、`GET /sessions/{id}/files`、`GET /me/conversations`、`POST /me/devices/revoke` 当前不应被前端调用（`clients/api-docs/README.md:70-78`）。

### 1.2 外部 CLI 对照基准

这次不是拿外部 CLI 当“必须照抄”的产品规范，而是抽取真实 Agent-CLI 的最低能力集合：

| CLI 样本 | 证据 | 对 nano-agent 的启发 |
|---|---|---|
| Gemini CLI | SDK session 可传 `sessionId`、`model`、resume history、tools、skills、动态 instructions，并在 loop 中调度 tool calls（`context/gemini-cli/packages/sdk/src/session.ts:65-87,151-166,171-274`） | 真实 client 需要 session/conversation resume、模型选择、工具/技能目录、动态上下文注入 |
| Gemini CLI | `read_many_files` 支持 glob、ignore、workspace path validation，并显式处理 image/pdf/audio（`context/gemini-cli/packages/core/src/tools/read-many-files.ts:58-92,216-245,296-324`） | 文件/附件 API 不能只是 text file；必须有多模态 metadata、显式请求、MIME gate |
| Codex | app-server 有 `supported_models()`，返回 model id、display、reasoning effort、input modalities、speed tiers、default 等字段（`context/codex/codex-rs/app-server/src/models.rs:11-47`） | `/models` 不能只返回 model id；需要可供前端 picker 和策略解释的完整模型清单 |
| Codex | API client 有 `GET models?client_version=...` 并处理 ETag（`context/codex/codex-rs/codex-api/src/endpoint/models.rs:40-73`） | 模型清单是客户端稳定 API，不是内部常量 |
| Codex | realtime conversation 支持 text/audio queue、handoff、realtime model、startup context token budget（`context/codex/codex-rs/core/src/realtime_conversation.rs:62-68,185-225`） | 多模态和 realtime 需要明确队列/状态/恢复语义，不能靠 `/input` 扩字段硬塞 |
| Codex | ContextManager 维护 history、token usage、context window、image modality normalization、rollback/compaction（`context/codex/codex-rs/core/src/context_manager/history.rs:32-51,89-125,136-160,190-240`） | context inspection 必须可解释 token、层级、压缩与可见历史 |
| Claude Code | Files API 有 download、session uploads 目录、500MB 上限、OAuth、路径 traversal 防护（`context/claude-code/services/api/filesApi.ts:48-83,132-180,182-245`） | `/files` 需要 upload/download/list/status，不只是内部 artifact ref |
| Claude Code | `/context` 类命令收集 context usage，展示 model、tokens/max tokens、分类、MCP tools、system prompt sections、context-collapse status（`context/claude-code/commands/context/context-noninteractive.ts:16-31,49-77,90-186`） | 真实客户端需要 context window inspection 探针 |
| Claude Code | 模型 picker 有 default、provider、custom model、1M context、cost/description 等选项（`context/claude-code/utils/model/modelOptions.ts:38-73,76-120,143-162`） | 模型选择要兼顾 owner policy、provider、价格、context window、能力 |

## 2. 问题 1：DDL 是否足够支撑完整 client？

### 2.1 已具备的厚度

D1 schema 已经不是空壳：

1. Identity / tenant 基础存在：`nano_users`、`nano_teams`、`nano_team_memberships`、`nano_user_identities`、`nano_auth_sessions`、`nano_team_api_keys`（`workers/orchestrator-core/migrations/001-identity-core.sql:1-90`）。
2. Conversation/session/message/context/audit 基础存在：`nano_conversations`、`nano_conversation_sessions`、`nano_conversation_turns`、`nano_conversation_messages`、`nano_conversation_context_snapshots`、`nano_session_activity_logs`（`workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:1-98`）。
3. hardening migration 已加 FK、turn 唯一索引、activity payload size check 与多个索引（`workers/orchestrator-core/migrations/003-session-truth-hardening.sql:20-91,263-286`）。
4. quota/usage 有 team 维度余额和 usage events，且 `005` 给 usage events 增加 `provider_key`（`workers/orchestrator-core/migrations/004-usage-and-quota.sql:1-34`，`workers/orchestrator-core/migrations/005-usage-events-provider-key.sql:1-5`）。
5. `D1SessionTruthRepository` 已能在 start 时创建/复用 conversation，写 session row、turn、message、activity（`workers/orchestrator-core/src/session-truth.ts:116-155,157-243`）。

这说明 DDL 已能支撑“session 被运行后”的基础审计、history 与 usage 记录。

### 2.2 不足以支撑完整 client 的缺口

| Gap | 当前证据 | 对真实 client 的影响 |
|---|---|---|
| pending session DDL 不成立 | `nano_conversation_sessions.session_status` 只允许 `starting/active/detached/ended`，且 `started_at`、`conversation_uuid` 都 NOT NULL（`workers/orchestrator-core/migrations/003-session-truth-hardening.sql:20-31`） | `POST /me/sessions` 现在只能“返回一个 pending UUID”，不能在 D1 中真实持久化 pending；断开后无法恢复未启动 session |
| conversation list API 缺失 | D1 有 `nano_conversations`，但 public route 白名单没有 `/me/conversations`（`workers/orchestrator-core/src/index.ts:185-198,208-245`） | 前端无法按 conversation 展示、分页、归档、改标题、恢复 |
| files / attachments 缺少 DDL read model | D1 里没有 `nano_session_files`、`nano_artifacts`、`nano_attachments` 类表；filesystem 只有库级 `ArtifactStore` / storage topology 概念 | `GET /sessions/{id}/files` 无法稳定列举；无法表达 upload status、mime、size、prepared variants、client-visible 标记 |
| device 表缺失 | 搜索未发现 `nano_user_devices`；auth sessions 只记录 refresh token hash（`workers/orchestrator-core/migrations/001-identity-core.sql:51-65`） | device revoke / multi-device session 管理不能落地 |
| tenant/team 产品字段不足 | `nano_teams` 只有 `team_uuid/owner_user_uuid/created_at/plan_level`（`workers/orchestrator-core/migrations/001-identity-core.sql:33-39`） | 注册时可自动生成 team UUID，但没有 tenant name / slug / org display / invite policy |
| model/provider 配置没有 D1/KV 产品真相 | usage event 有 `provider_key`，但没有 team/session model preference 表；`filesystem-core` catalog 只是把 `provider-config/model-registry` 标成 warm/provisional（`workers/filesystem-core/src/storage/data-items.ts:216-236`） | owner 不能配置“什么业务逻辑用什么模型 id”；前端也无法选择模型 |

**判断**：DDL 已经有中等厚度，但只覆盖“已运行 session 的审计与历史”，没有覆盖“真实 client 的产品资源模型”。first-wave 至少需要新增：

1. `nano_user_devices`：device_uuid、user_uuid、team_uuid、device_label、platform、created_at、last_seen_at、revoked_at、refresh_chain_root/session link。
2. `nano_session_files` / `nano_artifacts`：session_uuid、conversation_uuid、team_uuid、file_uuid、artifact/ref、mime、size、source、prepared_state、client_visible、created_at。
3. `nano_model_profiles` 或 `nano_team_model_policy`：team_uuid、provider_key、model_id、display_name、capabilities、context_window、input_modalities、default/pinned、owner policy。
4. pending session migration：要么允许 `pending` status + `created_at/minted_at`，要么新增 `nano_session_mints`，避免把未启动 UUID 塞进 `started_at NOT NULL` 的 session 表。

## 3. 问题 2：上下文管理与 agent loop 是否完备？

### 3.1 已有能力

`context-core` 的库级能力很厚：

1. `ContextAssembler` 有 canonical layer order、allowlist/order、required layers、token budget、truncation 和 evidence emission（`workers/context-core/src/context-assembler.ts:39-49,85-167`）。
2. `InspectorFacade` 已设计出一组 context inspection endpoint：usage、layers、policy、snapshots、compact-state、snapshot、compact、restore（`workers/context-core/src/inspector-facade/index.ts:8-21,168-230`）。
3. `NanoSessionDO` 会组合 workspace/context handle，并把 evidence sink、snapshot capture、compact manager 接入 DO（`workers/agent-core/src/host/do/nano-session-do.ts:331-388`）。
4. `agent-core` 在有 AI binding 时会创建 live kernel runner；没有 live kernel 时 `advanceStep` 会直接 `{ done: true }`，这是一种 honest-degrade（`workers/agent-core/src/host/do/nano-session-do.ts:481-490,1104-1126`）。
5. Agent loop 已有 `KernelRunner`：按 scheduler 执行 `llm_call`、`tool_exec`、`compact`、`hook_emit`，并发出 runtime events（`workers/agent-core/src/kernel/runner.ts:54-127,149-258`）。

### 3.2 不完备点

| Gap | 当前证据 | 影响 |
|---|---|---|
| context-core 仍是 library-only worker | `context-core/src/index.ts` 只允许 `/` 和 `/health`，其它路径 401 `binding-scope-forbidden`（`workers/context-core/src/index.ts:18-45`） | `orchestrator-core` 虽绑定了 `CONTEXT_CORE`，但没有真实 context RPC surface |
| agent-core 未绑定 CONTEXT_CORE | `agent-core/wrangler.jsonc` 只启用 `BASH_CORE`，`CONTEXT_CORE` / `FILESYSTEM_CORE` 注释掉（`workers/agent-core/wrangler.jsonc:45-49,80-82`） | context/filesystem 无法从 agent-core 作为独立 worker RPC 调用 |
| inspector 没挂到产品 API | `InspectorFacade` 是类库，不是 `orchestrator-core` route；public route 白名单无 `/sessions/{id}/context` 或 `/inspect` | 前端无法显示 context window、token budget、layers、compact 状态 |
| initial_context 只是入口补丁 | `NanoSessionDO` 只在 `session.start` 带 `initial_context` 时 append pending layer（`workers/agent-core/src/host/do/nano-session-do.ts:773-823`） | 不能在运行中检查/替换/追加 context layer；也没有 `/messages` 对 message-level attachments/context refs 的表达 |
| usage API 是 placeholder | `/usage` 返回 token/tool/cost null placeholders（`workers/orchestrator-core/src/user-do.ts:1466-1492`） | 客户端无法真实显示 context/usage budget |

与 Claude Code `/context` 和 Codex ContextManager 相比，nano-agent 的 context engine 是“内部材料已具备，外部探针未产品化”。真实 client 至少需要：

1. `GET /sessions/{id}/context`：返回 total/max tokens、按 layer 分类、truncated/dropped、compact state、latest snapshot。
2. `POST /sessions/{id}/context/snapshot`：触发并持久化 snapshot。
3. `POST /sessions/{id}/context/compact`：明确 sync/async、结果与错误。
4. `GET /sessions/{id}/context/layers`：支持 tag/kind/filter，前端可解释为什么模型看到这些内容。

## 4. 问题 3：filesystem 是否支持 multi-modality、上下文分层和内部 RPC？

### 4.1 代码原材料

filesystem 侧已有一些正确方向：

1. `filesystem-core` 的 storage adapters 包含 KV、R2、D1、DO storage，且 R2 adapter 支持 `put/get/head/list/listAll/delete`（`workers/filesystem-core/src/storage/adapters/r2-adapter.ts:44-57,89-188`）。
2. storage taxonomy 规定 hot/warm/cold：hot→DO storage、warm→KV、cold→R2（`workers/filesystem-core/src/storage/taxonomy.ts:17-39`）。
3. data item catalog 已把 workspace small/large file、attachment、provider config、model registry、skill manifest 等放进存储分类（`workers/filesystem-core/src/storage/data-items.ts:150-236`）。
4. mount router 支持 longest-prefix workspace mounts 和 reserved `_platform` namespace（`workers/filesystem-core/src/mounts.ts:38-91,115-158`）。
5. `ArtifactMetadata` 有 `audience: internal | client-visible` 与 `preparedState`，说明已意识到 client-visible artifact 与 prepared artifact（`workers/filesystem-core/src/artifacts.ts:15-32`）。

### 4.2 断点

| Gap | 当前证据 | 影响 |
|---|---|---|
| filesystem-core 没有业务 RPC | `filesystem-core/src/index.ts` 只允许 health，其余 401（`workers/filesystem-core/src/index.ts:18-45`） | 不能被 `agent-core`/`orchestrator-core` 以服务调用方式列文件、取文件、写 artifact |
| agent-core 未绑定 FILESYSTEM_CORE | binding 被注释（`workers/agent-core/wrangler.jsonc:45-49`） | `filesystem-core` 作为独立 worker 没进入 agent loop |
| wrangler 没有 KV/R2 binding | `filesystem-core/wrangler.jsonc` 只有 vars/observability，没有 `kv_namespaces` / `r2_buckets`（`workers/filesystem-core/wrangler.jsonc:1-29`） | 虽有 adapter 类型，部署态没有真实 KV/R2 存储 |
| ArtifactStore 是 in-memory | `InMemoryArtifactStore` 只用 `Map`（`workers/filesystem-core/src/artifacts.ts:38-60`） | 不能跨请求/跨恢复列举 client-visible files |
| PreparedArtifactPreparer 是 stub | `StubArtifactPreparer` 只合成 key 返回 success（`workers/filesystem-core/src/prepared-artifacts.ts:34-61`） | image/pdf/audio/text extraction 没有真实处理链 |
| public `/files` 缺失 | API docs 明确 `GET /sessions/{id}/files` 未实现（`clients/api-docs/README.md:70-78`） | 前端不能展示上传文件、生成文件、tool 输出 artifact、下载链接 |

对照 Gemini `read_many_files` 对 image/pdf/audio 的显式处理和 Claude Files API 的 upload/download 模型，nano-agent 需要 first-wave 文件产品面：

1. `POST /sessions/{id}/files`：上传/登记 client-visible file，返回 file_uuid、artifact_ref、prepared_state。
2. `GET /sessions/{id}/files`：列举 session files/artifacts，支持 cursor、kind、audience、prepared_state。
3. `GET /sessions/{id}/files/{file_uuid}`：metadata。
4. `GET /sessions/{id}/files/{file_uuid}/content`：受限下载/预览，按 MIME 和 size 决定 inline / signed URL / R2 object。
5. 内部 RPC：`filesystem-core.listSessionFiles`、`readFileContent`、`writeArtifact`、`prepareArtifact`，由 `agent-core` 消费。

## 5. 问题 4：auth 是否具备多租户、多用户条件？

### 5.1 具备的基础

注册会自动创建 user/team/membership/identity：

1. `RegisterInputSchema` 只接受 `email/password/display_name`（`packages/orchestrator-auth-contract/src/index.ts:113-118`）。
2. `AuthService.register()` 生成 `user_uuid`、`team_uuid`、`membership_uuid`，然后 `createBootstrapUser()`（`workers/orchestrator-auth/src/service.ts:162-185`）。
3. `createBootstrapUser()` 同批写入 `nano_users`、`nano_user_profiles`、`nano_teams`、`nano_team_memberships`、`nano_user_identities`（`workers/orchestrator-auth/src/repository.ts:182-236`）。
4. auth snapshot 中 `team_uuid` 与 `tenant_uuid` 都是必填，且当前 `tenant_uuid` alias `team_uuid`（`packages/orchestrator-auth-contract/src/index.ts:62-75`）。

这说明 UUID 级多租户边界已经存在，NACP authority 也有 team/tenant 载体。

### 5.2 产品面不足

| Gap | 证据 | 影响 |
|---|---|---|
| 注册时不能指定 tenant/team 名称 | RegisterInput 只有 email/password/display_name（`packages/orchestrator-auth-contract/src/index.ts:113-118`） | 前端无法展示组织名、工作区名；也无法 owner 选择 slug |
| `nano_teams` 无 name/slug/status | DDL 只有 `team_uuid/owner_user_uuid/created_at/plan_level`（`workers/orchestrator-core/migrations/001-identity-core.sql:33-39`） | 多团队管理、切换、邀请、审计展示不足 |
| 无 team management API | public auth routes 没有 `/teams`、`/me/teams`、`/team/members`（`workers/orchestrator-core/src/index.ts:259-270`） | 多用户团队无法运维 |
| 无 device 表/API | DDL/search 未发现 `nano_user_devices`，README 也标 `POST /me/devices/revoke` 未实现（`clients/api-docs/README.md:70-78`） | 移动端/小程序/web 多设备安全边界不完整 |

**判断**：auth 的“安全边界基础”是正确方向，但不是完整多租户产品系统。first-wave 至少要补：

1. 注册时允许 `team_name` 可选；未传则自动生成 display name（例如 `${display_name}'s workspace`），同时生成 slug。
2. `GET /me/teams`、`GET /me` 返回 current team display fields。
3. `GET /me/devices`、`POST /me/devices/revoke`。
4. refresh/access token 与 device_uuid 的绑定策略。

## 6. 问题 5：bash 内部 RPC 是否稳固，是否有 KV/R2 真实探针？

### 6.1 RPC 稳固度较高

`bash-core` 是当前 6-worker 中 RPC 化最接近完成的内部 worker：

1. `bash-core` promoted to `WorkerEntrypoint`，`call` / `cancel` RPC 方法存在（`workers/bash-core/src/index.ts:414-423,486-520`）。
2. RPC meta 要求 `trace_uuid`、`caller`、`authority`、`request_uuid`，并只允许 `orchestrator-core | agent-core | runtime`（`workers/bash-core/src/index.ts:418-483`）。
3. fetch compat path 也有 binding secret guard；公网业务路由 401（`workers/bash-core/src/index.ts:355-412`）。
4. `agent-core` remote binding adapter 会优先调用 RPC `call/cancel`，没有 RPC 时才 fallback 到 legacy HTTP `/capability/*`（`workers/agent-core/src/host/remote-bindings.ts:238-333`）。
5. `agent-core/wrangler.jsonc` 真实启用 `BASH_CORE` service binding（`workers/agent-core/wrangler.jsonc:45-49,80-82`）。

### 6.2 探针不足

`NanoSessionDO.verify` 支持 `capability-call` 和 `capability-cancel` posture（`workers/agent-core/src/host/do/nano-session-do.ts:1514-1645`），但这更像“能力调用活性探针”，不是 KV/R2 持久化探针。

当前 `bash-core/wrangler.jsonc` 没有 KV/R2 binding（`workers/bash-core/wrangler.jsonc:1-52`），`filesystem-core/wrangler.jsonc` 也没有 KV/R2 binding（`workers/filesystem-core/wrangler.jsonc:1-29`）。所以：

1. 可以验证 bash RPC、cancel、quota bridge、tool call 形状。
2. 不能验证“工具输出 promotion 到 R2 / KV 后由 client 列举或下载”的真实链路。
3. 不能验证多租户文件 key 是否贯穿到 Cloudflare KV/R2 实例。

**判断**：bash RPC 本身可进入 first-wave 依赖层；但 KV/R2-backed file/artifact 探针必须由 filesystem first-wave 一起补，不应误判为 bash 已经提供完整持久化文件能力。

## 7. 问题 6：LLM wrapper 与 Workers AI、模型配置清单是否可用？

### 7.1 Workers AI wrapper 已存在

`agent-core` 已有 Workers AI adapter：

1. `invokeWorkersAi()` 调用 `ai.run(model, payload)`，支持 stream、tools、temperature，并按 primary/fallback 两个模型尝试（`workers/agent-core/src/llm/adapters/workers-ai.ts:232-271`）。
2. `gateway.ts` 静态注册 `workers-ai` provider 与两个模型，声明 stream/tools 支持、vision/json-schema 不支持、contextWindow 128k（`workers/agent-core/src/llm/gateway.ts:20-52`）。
3. `buildWorkersAiExecutionRequestFromMessages()` 支持传 `modelId`，但默认用 primary model（`workers/agent-core/src/llm/gateway.ts:130-150`）。
4. `agent-core/wrangler.jsonc` 已绑定 `AI`（`workers/agent-core/wrangler.jsonc:57-59,90-92`）。
5. live kernel runner 在 env 有 `AI` 时会创建，并在 LLM 调用前后做 quota authorize/commit（`workers/agent-core/src/host/runtime-mainline.ts:121-177,288-309`）。

### 7.2 仍不可供真实 client 使用

| Gap | 证据 | 影响 |
|---|---|---|
| public 无 `/models` | `orchestrator-core` route 白名单没有 models（`workers/orchestrator-core/src/index.ts:185-198,247-270`） | 前端无法展示模型 picker |
| model selection 没穿过 public request | `/start`/`/input` body 只解析 text/initial_input/context_ref/stream_seq 等；`runtime-mainline` 调用 `buildWorkersAiExecutionRequestFromMessages({ tools: true })`，没有传 client model id（`workers/orchestrator-core/src/user-do.ts:960-1054,1141-1202`，`workers/agent-core/src/host/runtime-mainline.ts:130-136`） | owner/前端不能选择模型 |
| model registry 是静态内部常量 | `WORKERS_AI_REGISTRY` 写死两个模型（`workers/agent-core/src/llm/gateway.ts:20-52`） | 无法按 team/business logic 配置 |
| 多模态模型能力被关掉 | 两个 Workers AI model `supportsVision: false`（`workers/agent-core/src/llm/gateway.ts:31-48`） | 即使 `/messages` 支持 image refs，也无法进入模型选择策略 |
| wrangler whoami 不是集成测试 | 本次只确认 wrangler CLI 可用并读取用户设置；未执行 live inference，避免在调查任务中产生外部调用/成本副作用 | 需要单独 spike 以 owner 授权跑 Workers AI smoke |

**判断**：Workers AI wrapper 是可用原材料，但不是产品能力。first-wave 需要：

1. `GET /models`：public facade 返回 owner-approved model list，字段至少包括 `model_id/provider/display_name/default/context_window/input_modalities/supports_tools/supports_vision/cost_hint/reasoning_efforts`。
2. `POST /sessions/{id}/messages` 支持 `model_id` 或 `model_profile_id`，并由 backend 校验 team policy。
3. DDL/KV 中冻结 team-level default model 与 per-business-lane model policy。
4. usage events 的 `provider_key` 扩展为实际 model_id、input/output token、tool call 与估算成本。

## 8. 其他盲点、空白、断点与逻辑错误

### 8.1 Success envelope 仍碎片化

`clients/api-docs/README.md` 已说明成功返回并不完全统一：auth、catalog、usage、resume 等是 `{ ok:true, data }`，而 `start/input/cancel/status/timeline/history/verify` 仍是 legacy action payload（`clients/api-docs/README.md:40-55`）。这会让真实前端 SDK 复杂化，也会阻碍 `/messages` 设计统一。

建议：first-wave 新 API 必须全部使用 facade envelope；legacy API 不强行一次删除，但不应继续扩展 legacy shape。

### 8.2 `/me/sessions` mint 与 D1 truth 不一致

`POST /me/sessions` 只返回 UUID、status pending、ttl、start_url（`workers/orchestrator-core/src/index.ts:456-484`），没有写 D1。`GET /me/sessions` 则从 User DO hot conversation index 返回已经 start 过的会话（`workers/orchestrator-core/src/user-do.ts:1593-1624`）。因此客户端看到的是：

1. mint 成功但刷新 list 不出现；
2. 直接 start 任意合法 UUID 仍可创建 session；
3. pending TTL 只存在响应里，没有后端 GC / DB truth。

这个问题与 `/me/conversations` 必须一起修。

### 8.3 `orchestrator-core` 绑定了 context/filesystem，但 agent-core 没有

`orchestrator-core` service bindings 包含 `CONTEXT_CORE`、`FILESYSTEM_CORE`（`workers/orchestrator-core/wrangler.jsonc:48-54,73-79`），但 `agent-core` 中这两个 binding 注释掉（`workers/agent-core/wrangler.jsonc:45-49`）。这形成拓扑语义断裂：

1. public facade 看似可以健康检查所有 worker；
2. 真正运行 agent loop 的 `agent-core` 却不能 RPC 使用 context/filesystem；
3. context/filesystem 自身又是 library-only health worker。

建议：在 owner 已冻结 6-worker 的前提下，first-wave 应把现有 context/filesystem 两个 worker 升级为内部 RPC，不新增 worker。

### 8.4 Permission / usage 有接口名，没有运行闭环

`handlePermissionDecision()` 明确说只是记录 hot index，live round-trip 要等 nacp-session permission frames 通过 agent-core 接上（`workers/orchestrator-core/src/user-do.ts:1522-1563`）。`handleUsage()` 直接返回 token/tool/cost null placeholders（`workers/orchestrator-core/src/user-do.ts:1466-1492`）。真实 client 会显示“可点但不生效”的产品面。

建议：permission/usage 不应被当作已完成 first-wave；需要补 WS server frame、pending request store、runtime unblock path、usage counter update path。

### 8.5 Context/files/model/catalog 都没有 owner product policy

外部 CLI 都有“用户可见配置/策略”概念：Codex 有 config API 和 model list，Claude 有 model picker 与 context command，Gemini 有 Config、policyEngine、tools/skills。nano-agent 目前 `/catalog/*` 返回空数组（`workers/orchestrator-core/src/index.ts:410-433`），model registry 是内部静态常量，filesystem data catalog 是设计原材料。缺少 owner policy 会导致：

1. 前端不知道有哪些 agent/skill/command/model/file capability；
2. owner 无法控制业务 lane 与模型的映射；
3. permission/approval UI 无法解释“为什么这个 tool/model 被允许”。

## 9. First-wave 最小可运行 API todo-list

下面不是泛化长期 roadmap，而是为了让真实 client 从“只能跑 demo”进入“可恢复、可展示、可选择模型、可处理文件与上下文”的最小闭环。

| 优先级 | Todo | 需要改动的面 | DoD |
|---|---|---|---|
| P0 | 冻结 first-wave API profile | `clients/api-docs/README.md`、新设计/计划 | 明确所有新接口使用 `{ok,data,trace_uuid}`；legacy `/input` 只做兼容 |
| P0 | 实现 `GET /me/conversations` | D1 query、User DO 或 repository、orchestrator route、docs/tests | 返回 conversation_uuid/title/status/latest_session/latest_message/updated_at/cursor；按 team/user scope |
| P0 | 修正 server-mint session truth | DDL + `POST /me/sessions` + `/start` | pending row 或 `nano_session_mints` 二选一；刷新后可见；start 只能消费合法 mint |
| P0 | 实现 `POST /sessions/{id}/messages` | orchestrator route、User DO、agent-core ingress、nacp-session message schema、D1 messages | 支持 text + `attachments[]` + `context_refs[]` + `model_id?` + idempotency key；替代 `/input` |
| P0 | 实现 `GET /sessions/{id}/files` | file/artifact DDL、filesystem-core RPC、agent-core binding、public route | 返回 client-visible file/artifact list，含 mime/size/prepared_state/download_url 或 content route |
| P1 | 升级 filesystem-core 为内部 RPC | `filesystem-core/src/index.ts` WorkerEntrypoint、wrangler KV/R2/D1 binding、agent-core binding | `agent-core` 通过 binding 读写/list artifact，不再只用 in-memory store |
| P1 | 实现 `GET /sessions/{id}/context` | context-core RPC 或 agent-core facade、InspectorFacade adapter、public route | 返回 tokens/max/context window/layers/compact/snapshots；可对照 Claude `/context` |
| P1 | 实现 `GET /models` | model registry source、orchestrator public route、owner policy storage | 返回前端 picker 所需 fields；支持 team policy 与 default |
| P1 | 让 `/messages` 支持 model selection | request schema、policy validation、agent-core gateway | client 传 `model_id` 时被 team policy 校验；usage 写 provider_key/model_id |
| P1 | 设备管理 | DDL `nano_user_devices`、auth token/device binding、`GET /me/devices`、`POST /me/devices/revoke` | 单设备 revoke 后新 attach 立即拒绝，refresh chain 失效 |
| P2 | Permission live loop | WS frame、pending permission store、runtime unblock | permission request 能从 agent-core 到 WS，再由 HTTP/WS decision 唤醒 runtime |
| P2 | Usage live loop | quota commit → D1 → WS usage update | `/usage` 不再全 null；WS 可推 usage update |
| P2 | Catalog 真实化 | skill/command/agent registry | `/catalog/*` 不再空数组，字段可被前端渲染 |

## 10. 建议的 API 形状草案

### 10.1 `POST /sessions/{id}/messages`

```json
{
  "client_message_id": "uuid-or-client-generated-id",
  "role": "user",
  "content": [
    { "type": "text", "text": "请分析这张图和仓库代码" },
    { "type": "file_ref", "file_uuid": "..." }
  ],
  "attachments": [
    {
      "file_uuid": "...",
      "purpose": "context",
      "mime_type": "image/png"
    }
  ],
  "context_refs": [
    { "kind": "workspace_file", "path": "src/index.ts" }
  ],
  "model_id": "@cf/...",
  "idempotency_key": "..."
}
```

返回：

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "conversation_uuid": "...",
    "message_uuid": "...",
    "turn_uuid": "...",
    "status": "accepted",
    "stream": {
      "ws_url": "/sessions/{id}/ws",
      "resume_url": "/sessions/{id}/resume"
    }
  },
  "trace_uuid": "..."
}
```

### 10.2 `GET /sessions/{id}/files`

```json
{
  "ok": true,
  "data": {
    "files": [
      {
        "file_uuid": "...",
        "artifact_ref": "r2://...",
        "name": "screenshot.png",
        "mime_type": "image/png",
        "size_bytes": 12345,
        "audience": "client-visible",
        "prepared_state": "ready",
        "created_at": "...",
        "preview_url": "/sessions/{id}/files/{file_uuid}/preview"
      }
    ],
    "next_cursor": null
  },
  "trace_uuid": "..."
}
```

### 10.3 `GET /me/conversations`

```json
{
  "ok": true,
  "data": {
    "conversations": [
      {
        "conversation_uuid": "...",
        "title": "修复登录问题",
        "status": "active",
        "latest_session_uuid": "...",
        "latest_turn_uuid": "...",
        "latest_message_preview": "已经定位到...",
        "updated_at": "...",
        "created_at": "..."
      }
    ],
    "next_cursor": null
  },
  "trace_uuid": "..."
}
```

### 10.4 `GET /sessions/{id}/context`

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "model_id": "@cf/...",
    "context_window": 128000,
    "total_tokens": 18342,
    "free_tokens": 109658,
    "layers": [
      { "kind": "system", "tokens": 1200, "required": true },
      { "kind": "recent_transcript", "tokens": 9000, "truncated": false },
      { "kind": "workspace_summary", "tokens": 6000, "truncated": true }
    ],
    "compact": {
      "state": "idle",
      "last_snapshot_uuid": "..."
    }
  },
  "trace_uuid": "..."
}
```

### 10.5 `GET /models`

```json
{
  "ok": true,
  "data": {
    "default_model_id": "@cf/ibm-granite/granite-4.0-h-micro",
    "models": [
      {
        "model_id": "@cf/ibm-granite/granite-4.0-h-micro",
        "provider_key": "workers-ai",
        "display_name": "Granite 4.0 H Micro",
        "supports_tools": true,
        "supports_vision": false,
        "input_modalities": ["text"],
        "context_window": 128000,
        "max_output_tokens": 8192,
        "policy": {
          "enabled": true,
          "default_for": ["general"]
        }
      }
    ]
  },
  "trace_uuid": "..."
}
```

## 11. 最终判断

如果继续只补内部清洁度，`zero-to-real` 会继续“看起来架构更干净，但前端仍跑不起来”。当前最关键的工程策略应该是：

1. 不新增 worker，遵守 6-worker owner direction。
2. 把 `orchestrator-core` public facade 补成真实 client 最小集。
3. 把 context/filesystem 从 library-only 升级为 6-worker 内部 RPC，但只暴露给 `agent-core`/`orchestrator-core`，不开放 public business routes。
4. 把 D1 从“session 运行审计”扩展为“client product read model”：conversations、files、devices、model policy。
5. 所有新 API 从第一天使用统一 facade envelope 和明确 cursor/idempotency/trace/authority 规则。

**最小 first-wave 必须包含**：`POST /sessions/{id}/messages`、`GET /sessions/{id}/files`、`GET /me/conversations`、`GET /sessions/{id}/context`、`GET /models`。如果这五个不落地，真实客户端仍会停留在只能 start/input/status 的 demo 阶段，而不是可持续使用的多租户 Agent-CLI 产品。
