# real-to-hero：真实客户端 API gap 深度调查（by DeepSeek）

> 本报告只使用当前仓库真实代码与 `context/` 下三个外部 CLI 代码样本作为证据，不引用其他模型的分析结论。
> 目标：在最新 6-worker 架构下，判断 `orchestrator-core` 已提供的客户端接口距离"真实可运行的多租户 Agent-CLI / Web / 小程序客户端"还有多大 gap。
> 这是 DeepSeek 独立调查产出，不存在 GPT/GLM 内容污染。

---

## 0. 结论先行——zero-to-real 真正的瓶颈不在 "写更干净的代码"，而在 "打通三道闭环"

当前 nano-agent 后端已具备一定程度的运行内核原材料，但从真实客户端视角看，**zero-to-real 阶段仍未跨越"可运行真实 client"的最小门槛**。问题不是缺少单个接口文档，而是三道核心闭环仍未闭锁：

1. **Session 消费闭环** — 客户端启动 → 发消息 → 收到回复 → 关闭，当前是 `POST /me/sessions → POST /sessions/{uuid}/start → WebSocket stream → /cancel`。缺少 `POST /sessions/{id}/messages`（多模态/附件/模型选择/消息幂等离线语义），也缺少 `/models` 模型清单和 per-session model selection。

2. **上下文可观测闭环** — Agent loop 在 DO 内部运行 LLM+Caps，context assembler 和 compaction 逻辑存在，但 **public API 上没有一条 `/context` 探针**，客户端完全看不到 context window usage、层级明细、压缩历史和 token budget。这是三个外部 CLI（Gemini CLI / Codex / Claude Code）都有而 nano-agent 为零的盲区。

3. **租户可达闭环** — D1 有 identity/team/conversation/session 表，但 `/me/conversations` API 不存在（虽然 D1 已有 `nano_conversations` 表），租户没有名字没有 slug，device 管理为零，team 管理 API 为零，`verifyApiKey` 返回 `supported: false`。

这三个闭环之外，"worker 原料"确实丰富——kernel runner、scheduler、reducer、NACP wire protocol、17 个 hook 事件、6 层 context layering、RPC parity dual-track——但这些原料在没有上述三道闭环的情况下，客户端都无法消费。

---

## 1. DDL 厚度的充分性判断

### 1.1 已有的厚度（足够扎实）

当前 D1 数据库有 12 张表，分布在 5 个 migration 文件：

| # | Migration | 表名 | 核心字段 | 厚度评分 |
|---|---|---|---|---|
| 001 | identity-core | `nano_users`, `nano_user_profiles`, `nano_user_identities`, `nano_teams`, `nano_team_memberships`, `nano_auth_sessions`, `nano_team_api_keys` | user_uuid, team_uuid, identity_provider + subject, membership_level, refresh_token_hash, API key hash | **厚** — 多租户基础完整 |
| 002 | session-truth-and-audit | `nano_conversations`, `nano_conversation_sessions`, `nano_conversation_turns`, `nano_conversation_messages`, `nano_conversation_context_snapshots`, `nano_session_activity_logs` | conversation_status, session_status, turn_kind, message_role/kind, body_json, event_seq, severity | **厚** — session 真值记录完备 |
| 003 | session-truth-hardening | 同上的表，增加了 FK、UNIQUE 约束、payload CHECK(≤8192)、view | CASCADE DELETE, UNIQUE(trace_uuid, event_seq), CHECK(length ≤ 8192) | **更厚** — 硬化为生产级别 |
| 004 | usage-and-quota | `nano_quota_balances`, `nano_usage_events` | quota_kind(llm/tool), remaining/limit, verdict(allow/deny), idempotency_key | **合理** — 配额和用量基础 |
| 005 | usage-events-provider-key | `nano_usage_events` 加 `provider_key` 列 | provider_key + 索引 | **薄** — 单字段追加 |

**代码证据：**
- `workers/orchestrator-core/migrations/003-session-truth-hardening.sql:1-297` — 全量重建 + FK + 约束 + 数据迁移 + 视图
- D1 具备 `UNIQUE(identity_provider, provider_subject_normalized)` 用于快速查找（`001:80-81`）
- D1 具备 `view_recent_audit_per_team` 7 天审计滚动视图（`003:287-296`）
- 所有 session/turn/message 表都有 team_uuid 列，支持多租户隔离

### 1.2 DDL 的空白——对真实客户端来说是明显断裂

| 缺失的 DDL 实体 | 为什么需要 | 外部 CLI 证据 |
|---|---|---|
| **`nano_models` / LLM 注册表** | 客户端需要 `/models` 返回可用模型清单；owner 需要能设定业务模型策略。当前模型仅硬编码在 `workers/agent-core/src/llm/gateway.ts:20-53` 的静态 config 里。 | Codex: `GET /models` 返回 `ModelInfo[]` (`codex-api/src/endpoint/models.rs:40-73`)，Claude Code: bootstrap 返回 `model_configs` |
| **租户名称 / slug (`tenant_name`, `tenant_slug`)** | `nano_teams` 表只有 `team_uuid`, `owner_user_uuid`, `plan_level`（`001:33-39`），没有 `tenant_name` 或 `tenant_slug`。这导致前端无法展示租户名称；`/auth/me` 返回的 `team_uuid` 对用户是不可读的。注册流程也没有自动生成租户名的逻辑。 | 所有三个 CLI 的 JWT/auth profile 都有可读的 account/organization 标识 |
| **设备表 (`nano_devices`)** | `clients/api-docs/README.md:70-78` 明确标注 `POST /me/devices/revoke` 未实现。没有设备表意味着 token revocation 只能整 session 做，不能 per-device。 | Claude Code 有关键的 session ingress + device 管理 (`sessionIngress.ts`) |
| **会话文件表 (`nano_session_files`)** | `GET /sessions/{id}/files` 未实现。没有表来枚举 session 级文件（上传的附件、生成的 artifact refs）。`nano_conversation_context_snapshots` 存 payload_json 但不提供 per-file query。 | Claude Code: `Files API` (`filesApi.ts:48-245`)，Gemini CLI: `read_many_files` 支持 image/pdf/audio |
| **模型配额绑定表** | `nano_quota_balances` 限制 `quota_kind IN ('llm', 'tool')`（`004:3`），但 **不区分具体模型**。Owner 无法对不同模型设定不同配额。 | Codex: 有 rate limit + model-specific quota |

### 1.3 DDL 结论

**厚度评分：7/10**。Identity + Session 表足够生产级，但 **missing model registry、tenant name、device、file listing 这四个实体**直接导致 `zero-to-real` 无法交付完整客户端。这些表不是"可选优化"，而是客户端产品面的硬需求。

---

## 2. 上下文管理与 Agent Loop 完备性

### 2.1 Agent Loop（Kernel）——架构完备，但外部不可观测

Agent loop 本身实现扎实：

**架构：** `KernelRunner` (`workers/agent-core/src/kernel/runner.ts:48-437`) 以 step-driven 模式运行：
```
advanceStep(snapshot, signals) → scheduler.scheduleNextStep()
  → llm_call / tool_exec / compact / wait / finish / hook_emit
  → reducer.applyAction()
  → 返回 (new snapshot, events, done)
```

**代码证据：**
- `kernel/runner.ts:99-120` — 6 种 step kind 的穷尽 switch，`type: never` exhaustive check
- `kernel/scheduler.ts:27-67` — 纯函数，优先级：cancel > timeout > compact > tool_exec > llm_call > finish
- `kernel/state.ts:17-24` — SessionState: phase, turnCount, totalTokens, compactCount, lastCheckpointAt
- `kernel/checkpoint.ts:52-64` — buildCheckpointFragment + restoreFromFragment with version mismatch guard
- `kernel/delegates.ts:49-54` — 四个 delegate 接口（LLM, Capability, Hook, Compact）

### 2.2 NACP Wire Protocol——session profile 完备，但缺少上行多模态

NACP Session 侧的 WebSocket 协议已定义 15 种 message type（`packages/nacp-session/src/messages.ts:203-256`）：

| 类别 | Message types | 方向 |
|---|---|---|
| 生命周期 | `session.start`, `session.resume`, `session.cancel`, `session.end`, `session.heartbeat`, `session.stream.ack` | 双向 |
| 多轮交互 | `session.followup_input` | C→S |
| 权限门控 | `session.permission.request`, `session.permission.decision` | 双向 |
| 用量推送 | `session.usage.update` | S→C |
| 技能/命令 | `session.skill.invoke`, `session.command.invoke` | C→S |
| 询问 | `session.elicitation.request`, `session.elicitation.answer` | 双向 |
| 流事件 | `session.stream.event`（9 种 kind） | S→C |

9 种 stream event kind（`packages/nacp-session/src/stream-event.ts:85-95`）：
`tool.call.progress`, `tool.call.result`, `hook.broadcast`, `session.update`, `turn.begin`, `turn.end`, `compact.notify`, `system.notify`, `llm.delta`

Kernel RuntimeEvent 到 Stream Event 的映射表已冻结（`workers/agent-core/src/kernel/session-stream-mapping.ts:15-24`）。

### 2.3 Context Window Inspection——完全缺失

**这是 zero-to-real 最大的盲点**。NACP wire protocol 有 `compact.notify` 流事件，但没有任何客户端可以主动查询 context 状态的 API：

- 没有 `GET /sessions/{id}/context` — 无法查询当前 context window 的 token usage、层级明细、压缩历史
- 没有 token budget 报告 — `nano_conversation_context_snapshots` 表有 `prompt_token_estimate` 列，但没有任何 API 将其暴露给客户端
- `ContextAssembler` (`packages/workspace-context-artifacts/src/context-assembler.ts:66-167`) 有完整的 6 层 context layering（system → session → workspace_summary → artifact_summary → recent_transcript → injected），token budget 管理，和 `truncated` flag。但它只是在 agent-core 内部使用，没有将数据暴露给任何 public/internal RPC。

**外部 CLI 对照：**
- Claude Code：`/context` 命令展示 model、tokens/max tokens、context categories、MCP tools、system prompt sections、context-collapse status（`context/claude-code/commands/context/context-noninteractive.ts:16-186`）
- Codex：`ContextManager` 维护 visible history + token usage + compaction rollback（`codex-rs/core/src/context_manager/history.rs:32-240`）
- Gemini CLI：`ContextManager` 有 episodic context graph + token budget monitoring + consolidation triggers

**nano-agent 现状：** 0 探针。Agent loop 内部有 compact log，有 `compact.notify` 到 WS 的 push，但客户端无法主动查。

### 2.4 Hook 系统——完备但也是封闭的

Hook 系统有 18 个事件（`workers/agent-core/src/hooks/catalog.ts:68-252`），分三类：
- Class A (8): SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, PostCompact
- Class B (4): Setup, Stop, PermissionRequest, PermissionDenied
- Class D (6): ContextPressure, ContextCompactArmed, ContextCompactPrepareStarted, ContextCompactCommitted, ContextCompactFailed, EvalSinkOverflow

Hook 系统完备但完全封闭在 agent-core 内部——没有 public API 让 client 查看、注册、或管理 hook。

### 2.5 上下文 / Agent Loop 结论

**结论：Agent kernel 和 NACP wire 是 6-worker 最扎实的部分。** 断点不在内核运行能力，而在**客户端的可观测性为零**。`GET /sessions/{id}/context` 是第一优先级缺失接口。

---

## 3. Filesystem 的多模态能力与内部分层 RPC

### 3.1 库级分层——已经很厚

`@nano-agent/workspace-context-artifacts` 包（19 个源文件）提供了完整的分层抽象：

| 模块 | 文件 | 能力 |
|---|---|---|
| **Context Layers** | `context-layers.ts` | 6 层 canonical ordering：system → session → workspace_summary → artifact_summary → recent_transcript → injected |
| **Context Assembler** | `context-assembler.ts` | token-budget-aware 组装，allowlist + ordering + priority tiebreaker，truncation with `required` guarantee |
| **Compact Boundary** | `compact-boundary.ts` | `CompactBoundaryManager`, `ContextCompactRequestBody/ResponseBody` |
| **Mounts** | `mounts.ts` | `MountRouter`, per-path mount matching |
| **Backends** | `backends/memory.ts`, `backends/reference.ts` | `MemoryBackend`, `ReferenceBackend` |
| **Artifacts** | `artifacts.ts` | `InMemoryArtifactStore` |
| **Prepared Artifacts** | `prepared-artifacts.ts` | `StubArtifactPreparer` |
| **Redaction** | `redaction.ts` | Per-client redaction pipeline |
| **Snapshot** | `snapshot.ts` | `WorkspaceSnapshotFragment`, `WorkspaceSnapshotBuilder` |
| **Promotion** | `promotion.ts` | `shouldPromoteResult`, `promoteToArtifactRef` |
| **Evidence** | `evidence-emitters.ts` | Assembly, compact, artifact lifecycle, snapshot evidence records |

**代码证据：**
- Context assembler 的 token budget 管理：先放入 required layers，再在可选层中 fit budget（`context-assembler.ts:120-144`）
- Evidence emission 集成：`assemble()` 调用后通过 `evidenceSink.emit()` 发布 assembly evidence record（`context-assembler.ts:156-164`）

### 3.2 真实存储——资源存在但未绑定到 worker

**R2 和 KV 资源已存在于 Cloudflare 账号中**（经 `wrangler whoami` 重新认证后确认）：

```
$ npx wrangler r2 bucket list (20 buckets)
  nano-agent-spike-do-storage-probe     (2026-04-19)  ← nano-agent 已有 R2 probe
  nano-agent-spike-do-storage-probe-r2  (2026-04-20)  ← nano-agent 已有 R2+R2 联合探针
  agentdeck, forise, olc, simple-tax-rag, smind-agentic-foundations,
  smind-files-v170, smind-inbox-data, smind-static-assets, smind-static-v170,
  smind-templates, smind-user-data, sourcemind-general-files, sourcemind-rag-files,
  sourcemind-static-files, v4-agent, video-to-transcript, wbca-exceler-store, wbca-user-data

$ npx wrangler kv namespace list (19 namespaces)
  nano-agent-spike-do-storage-kv     ← nano-agent 已有 KV probe
  nano-agent-spike-do-storage-kv-r2  ← nano-agent 已有 KV+R2 联合探针
  p2pets, projects, smind-agentic-templates, smind-apikey-cache,
  smind-chat-history, smind-comm-webhook, smind-content-storage, smind-inbox-storage,
  tp-p2pets, tp-settings, wbca-api-key, WBCA_CHAT, wbca-drawer-templates,
  WBCA_EXCELER_TEMPLATES, WBCA_HISTORY, WBCA_PARSER_TEMPLATES, WBCA_SHARES
```

Token 权限列表包含 `workers_kv (write)`，wrangler 可管理 KV 命名空间。R2 bucket 列表可通过 `wrangler r2 bucket list` 查询。

**但所有 6 个 worker 的 `wrangler.jsonc` 中仍没有绑定这些 R2/KV 资源：**
```bash
$ grep -r '"kv"\|"r2"\|KV_NAMESPACE\|R2_BUCKET' workers/*/wrangler.jsonc
→ 无匹配
```

这意味着：
- 代码有完整的 `R2Adapter` / `KvAdapter` 实现（`packages/storage-topology/src/adapters/r2-adapter.ts`, `kv-adapter.ts`）
- Cloudflare 账号中有 R2 bucket + KV namespace 资源
- 但 worker 配置中没有声明 binding，因此运行时无法访问
- bash-core `/ capabilities/filesystem.ts` 的所有文件操作仍然走 `MemoryBackend`（纯内存）

**这不是资源缺失，而是配置缺失。** 只需在 wrangler.jsonc 中添加 `r2_buckets` / `kv_namespaces` binding 即可连通真实的持久化存储。

### 3.3 bash-core 的能力——伪文件系统 + 伪 curl

`workers/bash-core/src/index.ts` 的 capability handlers（`capabilities/filesystem.ts`, `capabilities/search.ts`, `capabilities/text-processing.ts`, `capabilities/network.ts`, `capabilities/exec.ts`, `capabilities/vcs.ts`）全都是**纯内存操作 + fake 实现**：

- `mkdir` / `write` / `read` — 操作内存中的 `WorkspaceBackend`（MemoryBackend 或 ReferenceBackend，`packages/workspace-context-artifacts/src/backends/memory.ts`）
- `curl` — `SubrequestBudget`，有 budget 限制，但没有真实网络访问
- `git` — 仅支持 `status/diff/log`，无真实 repo
- `sed` / `awk` / `jq` — 标记为 **unsupported**（`bash-core/src/index.ts:115-118,124-126`）

### 3.4 多模态能力——存在但未集成

NACP-Core 的 canonical message 模型支持 `image_url`（`workers/agent-core/src/llm/gateway.ts:79-84`）：
```typescript
case "image_url":
  return { kind: "image_url", url: typeof part.url === "string" ? part.url : "", mimeType: ... };
```

`storage-topology` 有 `MimePolicyGate`（`packages/storage-topology/src/mime-gate.ts`）支持 MIME type 过滤和 inline text 策略。但：
- **无 R2 binding** — R2 bucket 已存在（经 `wrangler r2 bucket list` 确认含 `nano-agent-spike-do-storage-probe` 和 `nano-agent-spike-do-storage-probe-r2`），但 wrangler.jsonc 未声明 binding，运行时 image/audio 文件无处存储
- **无文件上传 API** — 客户端无法 POST 文件
- **无 `GET /sessions/{id}/files`** — 客户端无法列举文件
- **Workers AI 上下文中的两个模型均不支持 vision** — `supportsVision: false`（`gateway.ts:35,46`）

### 3.5 Context/FS workers 的状态

`context-core` 和 `filesystem-core` 是 **library-only placeholders**：

```
workers/context-core/wrangler.jsonc — 无 D1, R2, KV, DO, service bindings
workers/filesystem-core/wrangler.jsonc — 同上
→ workers_dev: false
→ 所有非 health 路由 401 binding-scope-forbidden
→ 无 WorkerEntrypoint RPC
→ "consumed in-process by agent-core"
```

这是 ZX2 明确的设计决策（agent-core wrangler.jsonc:41-44 注释掉 CONTEXT_CORE 和 FILESYSTEM_CORE 的 service binding），但这也意味着 — **filesystem 没有独立的 RPC 面，不能像 bash-core 那样被 agent-core 通过 service binding 调用**。

### 3.6 Filesystem 结论

**库级能力 8/10，资源 7/10，运行时集成 2/10。** `workspace-context-artifacts` 和 `storage-topology` 两个包的分层抽象具备用于生产环境的完整度。R2 bucket 和 KV namespace 已在账号中创建（含 nano-agent 专用的探针资源），`R2Adapter` 和 `KvAdapter` 代码完备。但 worker 的 `wrangler.jsonc` 未声明 binding，bash-core 所有能力仍然基于 `MemoryBackend` 的伪实现。**从代码到真实文件操作的最后一公里是 wiring（wrangler.jsonc 配置），不是开发新能力。**

---

## 4. Auth 的多租户与多用户条件

### 4.1 已有基础——坚实的 identity 核心

Auth 服务 (`workers/orchestrator-auth/src/service.ts:43-414`) 提供：

| 能力 | 实现细节 | 代码证据 |
|---|---|---|
| **注册** | email + password，HMAC-SHA256 hash，auto-create user + team + profile + identity + membership | `service.ts:162-189` |
| **登录** | email + password 验证，access token 1h，refresh token 30d | `service.ts:191-210` |
| **Token 刷新** | HMAC-SHA256 JWT，kid 多密钥轮转，refresh token rotation（单向链） | `service.ts:212-265` |
| **WeChat 登录** | jscode2session + AES-CBC profile decrypt，unionid/openid 匹配 | `service.ts:342-400` |
| **密码修改** | 旧密码验证 + 新密码设置 | `service.ts:306-340` |
| **JWT 验证** | 多 secret keyring，kid 优先级，HMAC-SHA256 verify | `orchestrator-core/src/auth.ts:97-148` |
| **租户隔离** | JWT 必须含 `team_uuid` 或 `tenant_uuid`，否则 403 | `orchestrator-core/src/auth.ts:208-213` |

**代码证据：**
- `nano_auth_sessions` 有 `rotated_from_uuid` FK 形成 token 旋转链（`001:63`）
- JWT verification keyring 扫描所有 `JWT_SIGNING_KEY_*` env vars + legacy `JWT_SECRET`（`auth.ts:97-108`）
- `identify_provider + provider_subject_normalized` UNIQUE index 防止重复注册（`001:80-81`）

### 4.2 租户名称的完全缺失——最基础的产品面空白

**注册时不生成租户名称**（`service.ts:173-184`）：

```typescript
// createBootstrapUser 的输入
const context = await this.deps.repo.createBootstrapUser({
  identity_uuid: this.uuid(),
  user_uuid: this.uuid(),
  team_uuid: this.uuid(),   // ← 生成的是 UUID，但没有 team_name / team_slug
  membership_uuid: this.uuid(),
  display_name: input.display_name ?? this.deriveDisplayName(input.email),
  ...
});
```

`nano_teams` 表（`001:33-39`）的列是：
```sql
team_uuid TEXT PRIMARY KEY,
owner_user_uuid TEXT NOT NULL,
created_at TEXT NOT NULL,
plan_level INTEGER NOT NULL DEFAULT 0
```

**没有 `team_name`、`team_slug`、`team_description`、`team_avatar_url`**。

`/auth/me` 返回的 `team` 对象（`service.ts:117-121`）：
```typescript
team: {
  team_uuid: context.team_uuid,   // ← 只是 UUID
  membership_level: context.membership_level,
  plan_level: context.plan_level,
}
```

**前端拿到这个只能显示 UUID，用户完全不可读。**

### 4.3 缺失的多租户产品面

| 缺失项 | 影响 |
|---|---|
| **Team name/slug** | 前端无法展示租户名，用户无法分享/辨认自己的租户 |
| **Team 管理 API** | 无 `POST /teams`（修改）、`POST /teams/members`（邀请/踢出），所有 membership 操作只能通过 D1 手工操作 |
| **API Key 实际可用** | `nano_team_api_keys` 表存在（`001:67-78`），`verifyApiKey` 返回 `{supported: false, reason: "reserved-for-future-phase"}` (`service.ts:402-414`) |
| **Device 管理** | 无设备表，无 `POST /me/devices`，无 `POST /me/devices/revoke` |
| **注册时自动生成租户名** | 不实现，每个新用户的 team 只有一个 UUID |
| **多租户隔离的 endpoint enforcement** | `authenticateRequest` 要求 JWT 含 `team_uuid`（`auth.ts:208-213`），D1 表有 `team_uuid` FK，但 **没有 endpoint-level tenant boundary enforcement library** |

### 4.4 Auth 结论

**Auth 的 core flow 打分 8/10。** 但多租户的产品面打分 **2/10**。`nano_teams` 缺 `team_name` 是必须立刻修复的 DDL 变更——否则所有 `/auth/me`、`/me/conversations` 等返回都只包含一个不可读的 UUID。

---

## 5. Bash Worker 的 RPC 稳定性与探针

### 5.1 RPC 实现——生产级 authority 校验

`BashCoreEntrypoint` (`workers/bash-core/src/index.ts:486-522`) 实现了 `WorkerEntrypoint` 的 RPC：

- **`call(input, meta)`** — 执行 capability call，需要 `meta.authority` + `meta.request_uuid`
- **`cancel(input, meta)`** — 取消 capability call
- **Caller 白名单** — 只允许 `orchestrator-core`, `agent-core`, `runtime`（`index.ts:438-442`）
- **NACP authority validation** — `validateBashRpcMeta()` 验证 meta.authority 存在、caller 在白名单中、request_uuid 必填（`index.ts:444-484`）

**代码证据：**
- `index.ts:460-468` — 拒绝 free string caller
- `index.ts:491-506` — `call()` RPC 的 `parseCapabilityCallRequest` + `executeCapabilityCall` 链

### 5.2 HTTP fetch 路径——binding-secret gating

Bash-core 的 HTTP fetch handler (`index.ts:379-412`) 在 health probe 之外，所有路由必须过 `isInternalBindingCall` 检查（`x-nano-internal-binding-secret` header 匹配 `NANO_INTERNAL_BINDING_SECRET` env），否则返回 401 `binding-scope-forbidden`。

**代码证据：**
- `index.ts:360-365` — `isInternalBindingCall` 检查
- `index.ts:367-377` — `bindingScopeForbidden()` response

### 5.3 R2/KV 资源已确认存在，但未挂载到 bash-core

bash-core 的能力执行全部基于：
- `MemoryBackend` — 纯内存文件系统
- `ReferenceBackend` — 纯引用的虚拟文件系统
- `SubrequestBudget` — 计数的 curl budget，非真实网络

**Cloudflare 账号中 R2 bucket 和 KV namespace 已确认存在**（`wrangler r2 bucket list` + `wrangler kv namespace list` 可识别 `nano-agent-spike-do-storage-probe*` 探针），**但 wrangler.jsonc 中无任何 R2/KV binding 声明**（grep 确认，所有 6 个 worker 的 `wrangler.jsonc` 均无 `r2_buckets` 或 `kv_namespaces` 配置）。

### 5.4 CapabilityCallDO 的存在

`CapabilityCallDO` (`index.ts:324-353`) 是一个 Durable Object，用于按 requestId 隔离 capability 执行。但它的内部仍是调用同进程内的 `handleCapabilityCall` / `handleCapabilityCancel`。**没有 R2 offload、没有 KV cache、没有真实 curl**。

### 5.5 Bash 结论

**RPC 稳定性 9/10，能力真实性 3/10。** RPC 门控和 authority 校验已经生产就绪。能力背后仍是 fake 实现，但现在 **R2 bucket 和 KV namespace 已在账号中可用**，`R2Adapter` / `KvAdapter` 代码完备——缺少的只是 wrangler.jsonc binding 声明。从 fake bash 到真实 bash 的距离是配置（添加 R2 bucket binding + KV namespace binding），不是重建能力层。

---

## 6. LLM Wrapper 与 Workers AI 集成

### 6.1 Workers AI binding——已配置且账号就绪

Agent-core 已声明 Workers AI binding（`workers/agent-core/wrangler.jsonc:57-59`）：

```jsonc
"ai": {
  "binding": "AI"
}
```

代码中有完整的 Workers AI 适配器（`workers/agent-core/src/llm/adapters/workers-ai.ts:1-271`）：
- `AiBindingLike` 接口解耦（`workers-ai.ts:4-6`）
- Primary model: `@cf/ibm-granite/granite-4.0-h-micro`（128K context, 8192 max output, stream + tools, no vision）
- Fallback model: `@cf/meta/llama-4-scout-17b-16e-instruct`（同上）
- SSE stream parser with `\n\n` delimiter（`workers-ai.ts:148-229`）
- Tool calls normalization（`workers-ai.ts:87-125`）
- Usage normalization from `prompt_tokens`/`completion_tokens` / input_tokens/output_tokens（`workers-ai.ts:127-146`）

**wrangler 认证状态（经重新认证后）：已登录，Token 权限完整。**
```
wrangler whoami → sean.z@haimangtech.cn (Account: 8b611460403095bdb99b6e3448d1f363)
Token Permissions:
  - account (read), user (read)
  - ai (write), ai-search (write), ai-search (run)
  - workers (write), workers_scripts (write), workers_routes (write), workers_tail (read)
  - workers_kv (write), d1 (write), queues (write)
  - pages (write), browser (write)
  - pipelines (write), secrets_store (write), artifacts (write)
  - flagship (write), containers (write), cloudchamber (write)
  - connectivity (admin), email_routing (write), email_sending (write)
  - zone (read), ssl_certs (write), offline_access
```

`npx wrangler deploy --dry-run`（在 `workers/agent-core/` 目录执行）**成功通过**，确认：
```
Your Worker has access to the following bindings
(12 bindings total):
  env.SESSION_DO (NanoSessionDO)                Durable Object
  env.NANO_AGENT_DB  (nano-agent-preview)       D1 Database
  env.BASH_CORE  (nano-agent-bash-core)          Worker
  env.AI                                          AI
  env.ENVIRONMENT ("preview")                    Environment Variable
  env.OWNER_TAG ("nano-agent")                   Environment Variable
  env.WORKER_VERSION ("agent-core@preview")      Environment Variable
  env.TEAM_UUID ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaa.aaaaaaaa")  Environment Variable
  env.ORCHESTRATOR_PUBLIC_BASE_URL ("https://nano-agent-orchestrator-core-...")  Env Var
  env.NANO_AGENT_LLM_CALL_LIMIT ("200")          Environment Variable
  env.NANO_AGENT_TOOL_CALL_LIMIT ("400")         Environment Variable
  env.NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED ("true") Environment Variable
```

**这意味着 Workers AI 的部署是可行的。** 代码适配器已完成、Worker binding 已验证、account 有 `ai (write)` 权限。Worker 部署后即可在真实 Cloudflare 环境中通过 `ai.run()` 直接调用 Workers AI 推理。

### 6.2 DeepSeek adapter——throw-only skeleton

`workers/agent-core/src/llm/adapters/deepseek/index.ts:7-10`：
```typescript
export async function executeDeepSeekSkeleton(_exec: ExecutionRequest): Promise<never> {
  throw new Error(
    "DeepSeek adapter not implemented in zero-to-real first wave; Workers AI remains the only default runtime path.",
  );
}
```

这是仓库中唯一的 "zero-to-real" 代码引用。DeepSeek adapter 不仅不是 stub，而是 **主动 throw** 的 skeleton——调用它就会失败。

### 6.3 OpenAI Chat adapter——skeleton 存在但未启用

`workers/agent-core/src/llm/adapters/openai-chat.ts` 有 322 行完整实现，包括：
- `OpenAIChatAdapter` 类 — `buildRequestBody`, `buildRequestHeaders`, `parseStreamChunk`, `parseNonStreamResponse`
- SSE stream parser with `data:` lines
- OpenAI → canonical content part 映射（text, image_url, tool_call, tool_result）
- Finish reason mapping, usage aggregation, stream merging

但这条 adapter **没有在任何 gateway 或 executor 中启用**。Gateway 硬连线到 `WorkersAiGateway`（`workers/agent-core/src/llm/gateway.ts:157-263`）。

### 6.4 LLM Executor——HTTP 重试基础完备但未连接真实 API

`LLMExecutor` (`workers/agent-core/src/llm/executor.ts:44-327`) 有：
- Exponential backoff retry (max 2 by default)
- Retry-After 解析（seconds + HTTP-date）
- Rate limit key rotation (`on-429` policy)
- Timeout (60s default)
- Error classification (auth, rate_limit, invalid_request, server_error, network, timeout)

但 Executor 是为 HTTP OpenAI-compatible API 设计的，不是为 Workers AI 使用的。Workers AI 走的是 `ai.run()` 直接在 worker 内调用 binding，不经 HTTP。

**这是架构上的裂缝：`LLMExecutor` + `ChatCompletionAdapter` 的设计目标是一个多 provider HTTP gateway，但当前唯一的 runtime path（Workers AI）完全绕过这个 infrastructure**。

### 6.5 Provider/Model Registry——硬编码在 gateway

`workers/agent-core/src/llm/gateway.ts:20-53` 硬编码了注册信息：
```typescript
const WORKERS_AI_REGISTRY = loadRegistryFromConfig({
  providers: [{ name: "workers-ai", baseUrl: "cloudflare://ai", apiKeys: ["workers-ai-binding"] }],
  models: [{ modelId: "@cf/ibm-granite/granite-4.0-h-micro", ... }, { modelId: "@cf/meta/llama-4-scout-17b-16e-instruct", ... }],
});
```

`registry/loader.ts:49-91` 有 `loadRegistryFromEnv()` 可以批量从环境变量加载 provider（`LLM_PROVIDER_<NAME>_BASE_URL` / `_API_KEYS` / `_ROTATION`），但 model 注册表仍然为空——env loader 只注册 providers，不注册 models（`loader.ts:90: "Models are not loaded from env"`）。

### 6.6 LLM 结论

**代码准备度 7/10，部署就绪度 8/10。** Workers AI binding 已验证可用（`wrangler deploy --dry-run` 通过，`ai (write)` 权限已确认），适配器代码完备。剩下的 gap：
1. **从未真实部署一次 Workers AI 推理**——`wrangler deploy --dry-run` 已验证可用（AI binding 就绪、权限完备、12 个 binding 全部通过），但尚未实际 `wrangler deploy` + 发起 AI 请求串联整条 LLM 调用链。部署路径已打通，等待端到端验证。
2. DeepSeek 是 throw-skeleton（无法调用）
3. OpenAI adapter 有完整实现但未启用
4. 模型注册表硬编码且只有 2 个模型，且 `/models` API 不存在
5. Token 消耗无真实底线——尚未在真实 Workers AI 下测量 input/output token 消耗

---

## 7. LLM 配置清单与模型选择

### 7.1 `/models` API——完全不存在

orchestrator-core 的 public routes（`workers/orchestrator-core/src/index.ts:335-408`）白名单中无 `/models`：

```
auth routes:   register/login/refresh/verify/me/resetPassword/wechatLogin
catalog:       skills/commands/agents
me sessions:   POST+GET /me/sessions
session:       start/input/cancel/status/timeline/history/verify/ws/usage/resume
compound:      permission/decision, policy/permission_mode
```

**无 `/models`**。客户端无法获取可用模型清单。

### 7.2 Owner 无法制定业务模型策略

当前没有 **owner 配置层**：

- D1 无 `nano_models` 表（没有 `model_id`, `display_name`, `provider`, `capabilities_json`, `is_enabled_for_team` 等字段）
- D1 无 `nano_team_model_policies` 表（没有 per-team 的白名单/黑名单）
- 没有 `PUT /teams/{uuid}/models` 或 `POST /admin/models` 让 owner 设定哪些模型可用
- `NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED: "true"` 是唯一的开关（`agent-core wrangler.jsonc:22,70`），但这是部署级 env var，不是 per-team per-owner policy

### 7.3 Per-session model selection——不存在

当前 session start 的 body schema (`packages/nacp-session/src/messages.ts:18-25`)：

```typescript
SessionStartBodySchema = z.object({
  cwd: z.string().max(512).optional(),
  initial_context: SessionStartInitialContextSchema.optional(),
  initial_input: z.string().max(32768).optional(),
});
```

**没有 `model` 字段**。客户端无法指定本次 session 使用哪个模型。

Agent-core 的 kernel runner 不接受 model 参数：
- `advanceStep(snapshot, signals)` — 无 model 参数（`kernel/runner.ts:54-57`）
- `handleLlmCall` 调用 `this.delegates.llm.call(snapshot.activeTurn?.messages ?? [])` — 无 model 参数（`kernel/runner.ts:164-165`）

**Kernel 和 wire 协议都没有 per-session model selection。**

### 7.4 Catalog 端点——路由存在但内容是空数组

```
GET /catalog/skills   → { skills: [] }（index.ts:421-422）
GET /catalog/commands → { commands: [] }（index.ts:425-426）
GET /catalog/agents   → { agents: [] }（index.ts:427-428）
```

注释明确说 "Concrete plug-ins are registered by future plans"（`index.ts:410-413`）。这个 placeholder 足以写 API doc，但不是真实内容。

### 7.5 外部 CLI 对照

| CLI | 模型选择方式 | 证据 |
|---|---|---|
| **Claude Code** | Bootstrap API 返回 `model_configs`，client 可选择；`generationConfig` 传入 model name + thinking budget + maxTokens | `context/claude-code/services/api/*` |
| **Codex** | `GET /models` 返回 `ModelInfo[]`，含 display、reasoning effort、modalities、speed tiers、default flag；`--model` / `-m` 在 CLI 中选择 | `context/codex/codex-rs/app-server/src/models.rs:11-47` |
| **Gemini CLI** | ContentGenerator 支持 model 字符串；Gemma router 自动选择 submodel | `context/gemini-cli/packages/core/src/core/contentGenerator.ts` |

Nano-agent 的对应物：**无**。

### 7.6 LLM 配置结论

**评分：1/10。** 两个模型硬编码在 Worker 代码里，无 API、无 per-session selection、无 owner policy、model registry 不暴露。

---

## 8. 其他盲点、空白、断点与逻辑错误

### 8.1 `POST /me/sessions` 不持久化 pending row

`handleMeSessions` (`orchestrator-core/src/index.ts:447-500`) 的 POST 分支：
```typescript
const sessionUuid = crypto.randomUUID();
// ... 返回 { session_uuid, status: "pending", start_url, ttl_seconds, created_at }
// 不写入 D1
```

`POST /me/sessions` 是一个 "server-mint UUID only" 的端点——它 mint UUID 返回给 client，但不写入 D1。pending session 没有一个持久化的 row。当 client 拿到 `sessionUuid` 后调用 `/sessions/{uuid}/start` 时才首次写入。这意味着：

- Client 可以在 `/me/sessions` 列表中看到 pending session 吗？**不能**——因为 pending 不在 D1。
- 如果在 mint 和 start 之间 client 丢失状态（crash），pending session 永久丢失。
- TTL 完全是装饰性的——server 只宣称 `ttl_seconds: 86400`，但没有任何 alarm/GC 去回收未 started 的 pending session。

### 8.2 `GET /me/sessions` 读的不是 D1 而是 DO storage

`handleMeSessions` 的 GET 分支（`index.ts:490-500`）：
```typescript
const stub = env.ORCHESTRATOR_USER_DO.get(env.ORCHESTRATOR_USER_DO.idFromName(auth.value.user_uuid));
const response = await stub.fetch(new Request("https://orchestrator.internal/me/sessions", {
  method: "GET", ...
}));
```

这个路由 forward 到 User DO 的一个内部路径 `/me/sessions`，而 User DO 维护自己的 hot index (`CONVERSATION_INDEX_KEY` in DO storage)。**D1 有 `nano_conversation_sessions` 表但不直接查询**——所有 session 列表都走 DO storage。

这是有意的热度分层（DO storage 热，D1 冷），但也意味着：
- DO 崩溃 → 会话列表丢失
- 无法跨 DO 查询（team-level 会话列表需要扫所有 user DO）

### 8.3 `/me/conversations` 完全不实现

`clients/api-docs/README.md:70-78` 列出为未实现接口。D1 有完整的 `nano_conversations` 表（含 status、title、latest_session_uuid），代码基础已备。但：

- orchestrator-core 没有任何路由处理 `GET /me/conversations`
- User DO 没有任何 handler 处理 list conversations
- 前端完全无法做 conversation-level recovery

### 8.4 Success-shape 不一致——legacy vs facade envelope

`clients/api-docs/README.md:40-54` 记录了真实的 success-shape 分裂：

| 路由族 | 返回形状 |
|---|---|
| auth routes | `{ ok:true, data, trace_uuid }` — facade envelope |
| `/me/sessions` | `{ ok:true, data, trace_uuid }` — facade envelope |
| `start/input/cancel/status/timeline/history/verify` | `{ ok:true, action, ... }` — **legacy DO ack** |
| `/debug/workers/health` | debug JSON — **非 envelope** |

`wrapSessionResponse` (`index.ts:503-568`) 尝试检测并保持兼容性，但其 idempotency detection（`index.ts:532-534`）依赖于 `"data" in obj` 和 `typeof obj.action === "string"` 的启发式判断。一旦未来的 DO 返回同时含 `action` + `data` 的响应，会发生 double-wrapping。

### 8.5 WebSocket 仍然使用 lightweight `{kind,...}` 而不是 NACP frame

`clients/api-docs/README.md:17`:
```
session-ws-v1: active，当前 wire 仍是 lightweight {kind,...}
clients/api-docs/session-ws-v1.md: 只写当前 live 的 server frame / reconnect 事实
```

NACP-Session 的 `NacpSessionFrameSchema`、`validateSessionFrame`、`SESSION_MESSAGE_TYPES` 等协议代码俱全（`nacp-session/src/frame.ts`、`messages.ts`、`stream-event.ts`），但 **orchestrator-core 的实际 WebSocket wire 仍走 `{kind,...}` lightweight frame**。

这意味着：
- NACP Session 协议在代码里完备，但 real wire 上未激活
- `validateSessionFrame` 的 body 校验、方向矩阵、phase gating 等协议保障在真实 WS path 上不生效
- 这是潜在的 **协议漂移风险**——当某天切换时，可能已有大量 `{kind,...}` 旧格式流量

### 8.6 Token 预算的 ARM threshold 未定义

Kernel 的 scheduler 接收 `compactRequired: boolean` 信号（`kernel/scheduler.ts:19,43`），但 **什么条件下 `compactRequired` 为 true、ARM threshold 是多少从未在代码中定义**。Hook 系统有 `ContextPressure`（`hooks/catalog.ts:184-188`）但对应的触发逻辑未实现。

### 8.7 会话 resume 的语义不完整

`POST /sessions/{uuid}/resume` 存在于路由白名单（`index.ts:198,227`），但 Session Protocol 定义的 `session.resume` 应该基于 `last_seen_seq` 触发 resume replay（`nacp-session/src/messages.ts:29-31`）。当前 resume HTTP 端点的实际行为是什么没有明确定义——它只是一个 ack/replay hint，不是全量恢复。

### 8.8 Permission WS round-trip 未完成

`clients/api-docs/README.md:65`:
```
permissions: HTTP path 已有；WS round-trip 未真正落地
```

Permission decision HTTP endpoint 和 policy/mode HTTP endpoint 都存在（`index.ts:240-242`），但 permission request 从 server → client WS push 再 → client HTTP POST decision 这个完整的 round-trip gate 未连接。

### 8.9 Usage push 未实现

`clients/api-docs/README.md:66`:
```
usage: HTTP snapshot 已有；live WS push 未真正落地
```

NACP-Session 有 `session.usage.update` message type（`nacp-session/src/messages.ts:139-150`），WS 协议已定义，但 server 不主动 push usage update。Client 只能通过 HTTP `GET /sessions/{uuid}/usage` 主动轮询。

### 8.10 Session 启动时无 context seed 传递

`InitialContextSeed` 有 `realm_hints`, `source_name`, `default_layers`, `user_memory_ref`（`orchestrator-core/src/auth.ts:38-41`），在 `authenticateRequest` 中从 JWT claims 构建（`auth.ts:232-236`），并通过 `initial_context_seed` 字段传入 User DO 的 body。但这些字段（`default_layers: []`, `user_memory_ref: null`）永远是空的。**JWT 不包含 layers/skills/preferences/instructions**——context seed 机制存在但无实际注入数据。

### 8.11 多租户隔离在 session 路由中仅靠 JWT claim

所有 session 路由的租户隔离完全依赖于 JWT 的 `team_uuid` claim（`auth.ts:208-213`）。如果 JWT 签发时 team_uuid 指向 A 租户，而 D1 中 session_uuid 指向 B 租户的 session，**没有 cross-tenant access prevention** 在路由层做第二次 validation。D1 查询的 WHERE 条件应包含 `team_uuid` 过滤，但当前 session truth repository 的实现不透明。

### 8.12 context-core 和 filesystem-core 的 "absorbed" 状态是单向依赖

agent-core 依赖 `@haimang/context-core-worker`（`workers/agent-core/package.json:18`）和 `@nano-agent/workspace-context-artifacts`（`workers/agent-core/package.json:21`），编译前需先 build context-core（`package.json:8-10`）。这意味着：

- context-core 和 agent-core 耦合在同一个 compile dependency 上
- 一旦 context-core 需要独立部署（如被 orchestrator-core 直接调用提供 context inspection），需要同时 deploy 两个 worker
- 这违背了 6-worker 独立部署的初衷

---

## 9. 外部 CLI 对照：必备接口对比表

| 必备能力 | Gemini CLI | Codex | Claude Code | nano-agent 现状 |
|---|---|---|---|---|
| Auth (OAuth/API Key) | Google OAuth + API Key | ChatGPT OAuth + API Key | Claude OAuth + API Key | email/password JWT + WeChat，无 API key 真实现 |
| Session management | `AgentSession` async iterable | Thread/Turn/Item model, SQ/EQ | Session DO + resume dialog | `/sessions/*` life cycle，无 conversation resume list |
| Context inspection | `ContextManager` episodic graph, token budget | `ContextManager` history, truncation, rollback | `/context` command, token/MCP/context-collapse | **0 探针** |
| Model selection | per-session model, Gemma router | `/models` + `--model` | Bootstrap `model_configs` + per-session config | **0 API**，硬编码 2 模型 |
| File upload/list | `read_many_files` with image/pdf/audio | Shell tool + sandbox file ops | Files API: upload/download, 500MB cap, OAuth gated | **0 API，R2 storage exists (verified, not wired)**, 无文件上传端点 |
| Multi-turn chat | `sendMessageStream` | `POST /responses` SSE | `POST /messages` streaming | `POST /sessions/{uuid}/start` + WS stream |
| Tool/Skill catalog | Extension plugin system + AgentTool | Plugin system + dynamic tools | 44 tool dirs + SkillTool + bundled skills | catalog routes 返回空数组 |
| Permission gate | Policy engine (approval mode) | Guardian risk assessment + exec policy | hooks + approved path | HTTP endpoint exist; WS round-trip not live |
| Device/session mgmt | OAUTH sessions | Thread store on disk | session files in `~/.claude/sessions/` + device revoke | 0 device management |
| Multi-agent | Sub-agents via AgentTool | Sub-agents via `agent_job_tool` | Agent swarms + Team tools | catalog agents 返回空数组 |
| Hook ecosystem | BeforeAgent/AfterAgent/BeforeModel/BeforeToolSelection | AfterAgent | Comprehensive hooks | 18 hooks cataloged but no public API for client management |
| Compaction | ChatCompressionService + tool output masking | Local + remote `/responses/compact` | 7 compaction strategies (auto/reactive/micro/time-based) | compact delegate exists, context layer API has compact boundary manager |

---

## 10. First-Wave 优先修复建议

按照 zero-to-real 的核心理念——**缩小后端与真实可运行前端的差距**，下面按优先级列出必须实现的接口。这些接口不是"可选 feature"，而是让真实 client（Web / CLI / 小程序）可以 100% 完成一个完整用户旅程的硬需求。

### P0（阻塞性：client 无法完成完整旅程）

| 接口 | 为什么是 P0 | 依赖 |
|---|---|---|
| **`POST /sessions/{uuid}/messages`** | 替代当前的 `/sessions/{uuid}/input`（仅 text），支持多模态消息、附件引用、消息幂等、模型选择、上下文 ref。三个外部 CLI 都使用 message-based API（不是 text-only input）。 | SessionStartBody 需加 `model` 字段；DDL 需加 `nano_session_messages` 或扩展现有 message 表 |
| **`GET /me/conversations`** | D1 已有 `nano_conversations` 表。Client 需要恢复、分页、改标题、归档 conversation。没有这个接口，多 session 历史对 client 不可见。 | User DO 需加 `/me/conversations` handler 或 orchestrator-core 直接查 D1 |
| **`GET /sessions/{uuid}/context`** | 上下文可观测性为零，这是与三个外部 CLI 最大的差距。至少需返回 token usage、层级明细、compression 历史和 LLM 看到的可见消息数。 | 需将 ContextAssembler 的内部数据暴露到 RPC |
| **`GET /models`** | 客户端无法知道有哪些模型可用。 | 需 DDL 表或注册查询 API |

### P1（产品面断裂：有后端但不可用）

| 接口 | 为什么是 P1 | 依赖 |
|---|---|---|
| **`GET /sessions/{uuid}/files`** | 与 session 关联的文件列表。 | 需 R2 binding + 文件上传端点 + session_files 表 |
| **在 `nano_teams` 中加入 `team_name` / `team_slug`** | `/auth/me` 返回的 team 信息用户完全不可读。**这是 DDL migration 级别的修复。** | 需要变更 DDL + 注册/登录时赋值 |
| **`POST /me/devices` + `POST /me/devices/revoke`** | 任何多设备 client 需要 token revocation per-device。 | 需 `nano_devices` 表 |
| **Per-session model selection** | `SessionStartBodySchema` 需加 `model` 字段；kernel 需传递 model 到 LLM delegate | 需 wire protocol 拓展 + kernel 修改 |

### P2（闭环加固）

| 接口 | 为什么是 P2 | 依赖 |
|---|---|---|
| **WS 切到 NACP full frame** | 当前 lightweight `{kind,...}` 无 body validation、无 direction matrix、无 phase gating | 协议代码已完备，runtime 迁移需回归测试 |
| **Bash-core 接真实 R2 文件系统** | 当前全 fake（MemoryBackend） | R2 bucket 已存在（`nano-agent-spike-do-storage-probe*` 已确认），需 wrangler.jsonc 声明 binding + bash-core 适配切换到 `R2Adapter` / `KvAdapter` |
| **API Key 真实现** | `verifyApiKey` 返回 `supported: false` | 需 DDL 已备，逻辑需实现 |
| **Owner model policy** | Owner 无法设定 team 可用模型 | 需 `nano_team_model_policies` 表 + admin API |
| **Catalog 真实内容** | skills/commands/agents 返回空数组 | 需 plug-in 注册框架 |

---

## 11. 总结：zero-to-real 的真正 gap 不是代码少，是闭环不通

当前 nano-agent 仓库中：

- **代码行数 ~50,000+**（6 workers + 6 packages）
- **DDL 表 12 张**，FK + 约束 + 视图完备
- **NACP 协议 15 种 message type + 9 种 stream event kind**
- **Hook 系统 18 个生命周期事件**
- **Context 分层 6 层 canonical ordering**
- **Storage topology 4 类 adapter（D1/KV/R2/DO）**

从原材料角度看，这是一个非常厚的技术栈。**但从 zero-to-real 的视角看，我们还没有一个真实客户端可以跑起来的 minimum viable product。**

**根本原因：三道闭环未通。**

1. **Session 消费闭环** — `POST /sessions/{uuid}/messages`（替代 text-only `/input`）是 client→server 上行管道，`/models` 是元数据通道，per-session model selection 是运行时控制。三者加起来才能承载一个真实客户端的完整 session。

2. **上下文可观测闭环** — Agent loop 在 DO 内部做了大量工作（assembly, compaction, token tracking），但**所有产出数据都是 DO 私有状态**。Client 没有探针查看上下文——而在 3 个外部 CLI 中，context inspection 都是核心 UX 功能。

3. **租户可达闭环** — `nano_teams` 缺 `team_name`，`/me/conversations` 不存在，device 管理为零，API key 功能未实现。即使 client 认证成功，也无法展示可读的租户信息、恢复历史 conversation、管理多设备 token。

**修复这三个闭环不需要重构架构，而是从已有原材料中提取 client 可消费的 API**：D1 已有 `nano_conversations` → 加 `/me/conversations`；`ContextAssembler` 已有 token data → 加 `/sessions/{uuid}/context`；model registry 已有 2 模型 → 加 `/models`；message table 已有 `body_json` → 升级 `/input` 为 `/messages`。这些不是"new feature"而是"完成已有工程"。
