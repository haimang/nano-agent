# Zero-to-Real 阶段规划 — 完整分析 v2

> **文档性质**:`exploratory analysis`(**非正式 charter**,作为后续 charter 起草的直接输入)
> **日期**:`2026-04-24`
> **作者**:`Claude Opus 4.7 (1M context)`
> **相对前作**:本文档**完整重写**,替代 `plan-analysis-by-opus.md` 的 v0.1/v0.2/v0.3。前作是在对话推进中逐步修补的探索过程记录;本文档是**基于 owner 最终确认的 5 个部分**(orchestration.auth / orchestration.core 增强 / 真实 DDL / agent.core LLM+秘钥 / 内部 RPC 推动 HTTP 退役)一次性成文的连贯分析。
> **独立性**:所有结论来自独立对 `workers/` / `context/smind-admin/` / `context/smind-contexter/` / `context/ddl-v170/` 的 first-principle 事实核查 + owner 明确表达。未参考任何其他 reviewer。

---

## 目录

- §0 阶段定义与目标
- §1 6-worker 终态拓扑 + Service Binding 矩阵
- §2 orchestration.auth Worker 完整设计
- §3 orchestration.core Worker 完整重塑
- §4 nano-agent 专用 D1 Schema 设计
- §5 agent.core 增强:LLM Wrapper + 秘钥工程
- §6 内部 RPC 启动 + HTTP 退役推进
- §7 依赖关系与子阶段切分
- §8 Risk / Decision Matrix
- §9 Open Questions(最终版)
- §10 一句话总结

---

## §0 阶段定义与目标

### §0.1 一句话定义

> **"zero-to-real" = 把 orchestration-facade 建好的 scaffold(public façade + authority law + private runtime mesh)变成一个**真实可被用户使用**的多租户 Agent SaaS 系统底座 —— 包括真实 LLM、真实持久化、真实用户态编排、真实多用户多会话隔离、以及真实的鉴权入口。**

### §0.2 5 条 first-principle(owner 已确认)

1. **nano-agent 与 smind 家族完全独立**。smind-admin / smind-contexter / ddl-v170 仅作为"降低认知与执行风险的参考上下文",不是我们的上游,不接入,不共享。
2. **multi-tenant 从 day-1**(SaaS 预留 + NACP 协议强制要求),行级 `team_uuid` 隔离。
3. **持久化 = 永久**,retention 不设过期。未来冷热分层(DO SQLite 热 / D1 温 / R2 冷),但 agent runtime session 元数据与历史"不可清空"。
4. **D1(nano-agent 自己的)**= 业务稳定态真相源,跨 worker 共享,可观测,可 admin panel 读。**DO SQLite**(per-user DO) = 用户强边界热数据(秘钥、热 context、alarm 调度、当前活跃对话指针等),per-user 独占。两者**互补分工**,不是二选一。
5. **不收费**,但**credit/quota 接口预留 + 强制走校验**(mock 可切 allow-all / insufficient-credit,运行逻辑中所有 side-effect 都要过 quota hook)。

### §0.3 阶段成功的 6 条硬指标

1. 真实 JWT 登录流(含 WeChat bridge)跑通,new user 能 register / login,拿到的 token 能走完整 session 流程。
2. 两个真实 user 在同一 deploy 下并发使用,**tenant 隔离由行级 `team_uuid`** 保证,互不可见对方 session/conversation。
3. `agent.core` turn loop 真正调 LLM(Cloudflare Workers AI 或 DeepSeek OpenAI-compat),**非 fake provider**。
4. 每次 capability 执行前经过 `beforeCapabilityExecute` quota hook,mock 层可切 allow / deny,真实消耗写 `nano_usage_events`。
5. 用户 WebSocket 可以**双向**发消息(当前只支持单向),Mini Program 可用。
6. orchestrator.core user DO **有** DO SQLite + Alarm + 持久化用户态(conversation 列表、active_conversation_uuid、秘钥缓存等),**不再是纯 session 代理**。

### §0.4 阶段非目标

- **不收费**,不建 billing_plan / invoice / payment_transactions
- **不做 RAG**(smind 的 knowledge / vector / rag/ 目录不吸收)
- **不做 skill.core**(继续延后)
- **不建 CMS / CRM / project 等业务模块**(smind DDL 的 07/08/12 不吸收)
- **不迁移 legacy SMCP 客户端**(nano-agent 没有历史包袱)
- **不追求 transport 一次性重写完**(internal RPC 只是**启动**推进,不是完成)

---

## §1 6-Worker 终态拓扑 + Service Binding 矩阵

### §1.1 拓扑终态

```
                           ┌───────────────────────────────┐
                           │   Client (Mini Program / Web) │
                           └───────────────────────────────┘
                                        │
                  HTTP ingress (public)  │  WebSocket (public)
                                        │
                  ┌─────────────────────▼─────────────────────┐
                  │         orchestration.core                │
                  │  (唯一对外 façade)                         │
                  │                                           │
                  │  ├─ public auth routes (proxy to          │
                  │  │   orchestration.auth via binding)      │
                  │  ├─ public session routes                 │
                  │  ├─ public WS 双向                         │
                  │  ├─ per-user DO (DO SQLite + Alarm +      │
                  │  │   conversation 聚合 + intent dispatch)  │
                  │  └─ D1 binding (nano-agent 自己)           │
                  └───┬──────────┬───────────┬─────────────────┘
                      │          │           │
       service binding│          │service binding (唯一入口)
                      │          │
    ┌─────────────────▼──────┐   │
    │ orchestration.auth     │   │
    │  (internal-only)       │   │
    │                        │   │
    │  ├─ JWT mint           │   │
    │  ├─ register / login   │   │
    │  ├─ WeChat bridge      │   │
    │  ├─ API key 管理        │   │
    │  ├─ user / tenant CRUD │   │
    │  └─ D1 binding         │   │
    └────────────────────────┘   │
                                 │
               ┌─────────────────▼──────────────┐
               │         agent.core             │
               │  (per-session DO + turn loop)  │
               │                                │
               │  ├─ LLM wrapper (Workers AI +  │
               │  │   DeepSeek adapter)         │
               │  ├─ 秘钥解密 + runtime 热缓存     │
               │  ├─ compact default-wire       │
               │  └─ D1 binding (conversation/  │
               │     session/turn 持久化)       │
               └────┬────────┬──────────┬───────┘
                    │        │          │
         service binding     │          │
                    │        │          │
         ┌──────────▼──┐  ┌──▼──────┐ ┌─▼──────────┐
         │ bash.core   │  │ context │ │ filesystem │
         │ (capability)│  │ .core   │ │ .core      │
         │             │  │         │ │            │
         │ ├─ quota    │  │ (compact│ │            │
         │ │  hook     │  │ + layer │ │            │
         │ │  真实消费 │  │  mgmt)  │ │            │
         │ │  D1       │  │         │ │            │
         └─────────────┘  └─────────┘ └────────────┘
```

### §1.2 每个 worker 的终态职责

| worker | 身份 | 对外? | 主要增量工作 |
|---|---|---|---|
| **orchestration.core** | 唯一 public façade + per-user 编排 DO | ✅ 唯一对外 | 从 contexter 吸收 user DO 运行模式,增强用户态编排(intent / conversation / DO SQLite / Alarm / 双向 WS)|
| **orchestration.auth** | JWT + tenant + user 鉴权中心 | ❌ internal-only,只接受 orchestration.core binding | **全新建立**,从 smind-admin 吸收 auth 代码 + 加 WeChat bridge |
| **agent.core** | downstream per-session runtime host | ❌ internal | LLM wrapper wire 真 provider + 秘钥工程 + compact default-wire |
| **bash.core** | governed capability worker | ❌ internal | `beforeCapabilityExecute` 真 wire 消费 nano_quota |
| **context.core** | context library worker | ❌ internal | compact 配合 agent.core 落 conversation_context_snapshots |
| **filesystem.core** | workspace/storage substrate | ❌ internal | 基本不变,future R2 冷归档配合 |

### §1.3 Service Binding 矩阵(**关键安全边界**)

| 调用方 ↓ \ 被调用方 → | orchestration.core | orchestration.auth | agent.core | bash.core | context.core | filesystem.core |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| **public client** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **orchestration.core** | — | ✅ | ✅ | ❌ | ❌ | ❌ |
| **orchestration.auth** | ❌ | — | ❌ | ❌ | ❌ | ❌ |
| **agent.core** | ❌ | ❌ | — | ✅ | ✅ | ✅ |
| **bash.core** | ❌ | ❌ | ❌ | — | ❌ | ❌ |
| **context.core** | ❌ | ❌ | ❌ | ❌ | — | ❌ |
| **filesystem.core** | ❌ | ❌ | ❌ | ❌ | ❌ | — |

**关键纪律**:

1. **`orchestration.auth` 只接受 `orchestration.core` 一个 caller**(owner 明确要求)。其他任何 worker 想验 JWT / 查用户,都要绕道 orchestration.core 请求 auth。这是**最重要的安全边界**:JWT 签发能力永远不进入 runtime mesh。
2. **orchestration.core 不直接 bind context/filesystem**:这与 orchestration-facade 的 §6.2 O5 纪律一致,避免 façade 变成超级路由器。context/filesystem 只被 agent.core 消费。
3. **agent.core bind bash/context/filesystem**:runtime 内部调用,不经 orchestrator。
4. 所有 worker 都**可以** bind D1(但 orchestration.auth 是 D1 写 + 读主力,orchestrator.core + agent.core + bash.core 是 read-heavy + 特定表 write,context/filesystem 默认不需要 D1)。

### §1.4 Wrangler 配置变化

相对 orchestration-facade 终态的增量:

- **新建** `workers/orchestration-auth/wrangler.jsonc`
- **新增 5 worker 的 D1 binding**:orchestration.core / orchestration.auth / agent.core / bash.core 都 bind `database_name = "nano-agent-db"`(context/filesystem 首轮不引,future 看需要)
- **orchestration.core 增加 binding**:`AUTH_CORE` 指向 orchestration.auth
- **TEAM_UUID** 语义调整:从 "deploy tenant truth" 降格为 "default tenant hint";真相由 forwarded authority 携带(**multi-tenant 动态化**)

---

## §2 `orchestration.auth` Worker 完整设计

### §2.1 定位与约束

- **位置**:`workers/orchestration-auth/`
- **角色**:nano-agent 的 auth/identity/tenant 管理 worker
- **对外**:**不提供 public routes**,只通过 service binding 接收 orchestration.core 的调用
- **唯一消费者**:orchestration.core
- **核心资源**:D1 binding(nano-agent 自己的 `nano-agent-db`,读写 `nano_users / nano_teams / nano_user_identities / nano_team_memberships / nano_team_api_keys`)
- **wrangler 配置**:**不配置 routes**,只 `[[d1_databases]]` + `[vars]`(`JWT_SECRET_KEY` / `PASSWORD_SALT`)

### §2.2 从 smind-admin 吸收的代码(adapt-pattern,非直接 copy)

| smind-admin 源 | nano-agent 对应位置 | 改动 |
|---|---|---|
| `src/infra/security.ts::{createJwt, verifyJwt, hashSecret}` | `orchestration-auth/src/infra/jwt.ts + hash.ts` | 用 `jose` 库,HS256,7d exp。**JWT claim schema 沿用 orchestrator.core 当前格式** `{sub, tenant_uuid, membership_level, realm?, source_name?, exp}`,**不用** smind 的 `{uuid, tid, tpl}` —— 避免 orchestrator 侧重写 auth.ts |
| `src/infra/db.ts::{firstRow, run, batch, nowIso}` | `orchestration-auth/src/infra/db.ts` | D1 query helper,直接 adapt |
| `src/infra/errors.ts::HttpError` | `orchestration-auth/src/infra/errors.ts` | 错误分类 + status code,直接 adapt |
| `src/modules/identity/auth.service.ts::{login, register, validateApiKey}` | `orchestration-auth/src/services/auth.ts` | schema 名去 `smind_` 改 `nano_`;其他逻辑同 |
| `src/modules/identity/password.service.ts::resetPassword` | `orchestration-auth/src/services/password.ts` | 直接 adapt |
| `src/modules/identity/user.service.ts + team.service.ts` | `orchestration-auth/src/services/users.ts + teams.ts` | CRUD + 成员管理,直接 adapt |
| `src/http/v1/{auth,users,teams,api_keys}.ts` route handlers | **不吸收**(不对外暴露) | 改为 internal RPC handler,通过 service binding 接收 orchestration.core 的调用 |
| `src/http/middleware.auth.ts::requireAuth` | `orchestration-auth/src/services/verify.ts` | 改为 pure function `verifyJwtContext(token)`,由 orchestration.core 作为 binding consumer 调用 |

### §2.3 **不吸收**的 smind-admin 内容

- `src/modules/workflow/*` — smind 业务工作流,与 nano-agent 无关
- `src/modules/asset/*` — smind 文件上传/静态托管,与 nano-agent 无关
- `src/http/v1/{workflows, uploads, static_files, storage}.ts` — 同上
- `src/compat/legacy_smcp.ts + console_backfill.ts` — 向后兼容 smind 旧客户端,nano-agent 无此需要
- `src/infra/queues.ts + r2.ts` — smind 的 queue/R2 绑定,nano-agent 若后期需要可独立设计

### §2.4 新增(smind-admin 无,nano-agent 需要)

#### §2.4.1 WeChat bridge 实装

smind-admin 的 `smind_user_identities` 表有 `identity_provider` 字段预留多 provider,但 **代码只实装 `email_password`**(grep 确认)。WeChat bridge 是 nano-agent 自己要建的:

```
orchestration-auth/src/services/wechat.ts

wechatBridge(code):
  1. POST https://api.weixin.qq.com/sns/jscode2session
     with { appid, secret, js_code: code, grant_type: "authorization_code" }
  2. 拿到 {openid, unionid?, session_key}
  3. 查 nano_user_identities
     WHERE identity_provider = 'wechat' AND provider_subject = openid
  4. 若存在 → login(拉 user + team),签 JWT
  5. 若不存在 → register(create user + identity + default team),签 JWT
  6. 返回 {token, user_uuid, team_uuid, is_new_user}
```

**秘钥依赖**:`WECHAT_APPID` + `WECHAT_APP_SECRET`(wrangler secret,非 vars)。

#### §2.4.2 Internal RPC surface(对 orchestration.core 唯一)

service binding 接口(orchestration.core → orchestration.auth),用 `POST /internal/*` 路径命名约定(不是 public path):

| Internal path | 用途 | 消费方 |
|---|---|---|
| `POST /internal/auth/register` | 注册新用户 | orchestration.core 收到 public `POST /auth/register` 后代理 |
| `POST /internal/auth/login` | 邮箱/密码登录 | 同上 |
| `POST /internal/auth/wechat/bridge` | WeChat code 登录 | 同上 |
| `POST /internal/auth/verify-token` | 解析 JWT 拿 context(每次 orchestrator public ingress 鉴权)| orchestration.core auth middleware |
| `POST /internal/auth/password/reset` | 密码重置 | public auth endpoint 代理 |
| `POST /internal/api-keys/validate` | server-to-server API key 验证 | orchestration.core API key 鉴权 |
| `POST /internal/users/me` | 读当前 user profile | orchestration.core 为前端 `GET /users/me` 代理 |
| `POST /internal/tenants/:id` | 读 tenant 信息 | 同上 |
| `POST /internal/tenants/:id/api-keys` | 管理 API key(list/create/revoke) | admin 面 |

**鉴权 gate**:orchestration.auth 只接受 `x-nano-internal-binding-secret` header(与 agent.core internal 同款),验证失败 typed 401。不需要 trace/authority(因为 orchestration.core 还没有 authorit 的时候就要调 auth 来 verify JWT),这是个**鸡生蛋问题**:

- 验证 JWT 之前,orchestration.core 不知道用户身份 → 没 authority
- 所以 orchestration.auth 的 verify-token 不能要 authority,只要 secret gate
- 其他 internal 接口(register / login / wechat/bridge)本身就是**创建 authority 的源头**,所以它们也只要 secret gate
- 只有 `users/me` / `tenants/:id` 等**已鉴权请求**,orchestration.core 可以 forward 原 JWT 的 authority。但 orchestration.auth 可能重新查 D1 最新数据(不信 cache)

**最简约定**:orchestration.auth 所有 internal endpoint 都只要 secret gate + optional authority passthrough(仅用于审计日志,不做二次校验)。

### §2.5 D1 binding

orchestration-auth 直接连 `nano-agent-db`,读写:
- `nano_users`
- `nano_user_profiles`
- `nano_user_identities`
- `nano_teams`
- `nano_team_memberships`
- `nano_team_invites`(延后)
- `nano_team_api_keys`

**写入权**:**只**给 orchestration.auth(其他 worker 对 identity 表只读,用查询减少 RPC 调用)。这是"写入职责单一化"的纪律 —— 避免 10 个 worker 乱写 user 表造成数据漂移。

### §2.6 秘钥管理

```
[vars]              (public 可见)
TEAM_UUID = "nano-agent"  # default tenant hint

[secrets]           (wrangler secret put)
JWT_SECRET_KEY            # HS256 签发 key(重要,rotation 需同步 orchestrator.core 验证 key)
PASSWORD_SALT             # hashSecret 用(永久,rotation 相当于重置所有密码)
NANO_INTERNAL_BINDING_SECRET  # internal gate 共享 secret
WECHAT_APPID              # 微信小程序 AppID(vars 也可,但一起作 secret 简化管理)
WECHAT_APP_SECRET         # 微信小程序 secret
```

**JWT_SECRET_KEY 共享纪律**:orchestration.auth 签发,orchestration.core 验证。两者必须有**同一个** JWT_SECRET_KEY。rotation 时需要:

1. 先把新 key 加到 orchestration.core(但不删旧 key,验证时尝试 old→new)
2. 然后把新 key 换到 orchestration.auth
3. orchestration.auth 用新 key 签的 token 两边都能 verify
4. 等旧 token 全部过期(7d)后,从 orchestration.core 删旧 key

---

## §3 `orchestration.core` Worker 完整重塑

### §3.1 当前空白回顾(owner 说 "似乎没有吸收到任何这方面的内容")

通过对比 contexter `engine_do.ts`,当前 orchestrator.core user DO 缺失 4 大类用户态能力(见 §1 service binding 矩阵下方文本,具体核查见前作 §15.5):

1. **DO SQLite 未用**:当前 `ctx.storage.get/put` KV,无法 query(例如 "列出用户最近 10 个 conversation 按 last_active 排序")
2. **Alarm 未用**:没有 `async alarm()` 方法,无法调度冷归档 / token cache refresh 等 background 工作
3. **双向 WS 未实装**:WS 是 server → client 单向 event relay,client 发消息必须走 HTTP POST(对 Mini Program 体验差)
4. **conversation 聚合层空白**:直接按 session_uuid 索引,无 "用户多 conversation, active conversation 切换" 概念
5. **Intent dispatch 空白**:所有 public 请求都是 "你给我 command,我 forward 给 agent.core",没有"判断是否需要 agent runtime / 走 fast path / 走 admin query 等"分流

### §3.2 从 contexter 吸收的完整列表

**吸收**(adapt-pattern):

| contexter 源 | orchestration.core 对应位置 | 说明 |
|---|---|---|
| `src/engine_do.ts` constructor 初始化模式(logger + DOSqliteManager + AlarmManager + 业务对象)| `orchestration-core/src/user-do.ts` constructor | 增加 DOSqliteManager、AlarmManager、IntentDispatcher(新) |
| `src/engine_do.ts::handleWebsocketUpgrade` 的 `server.addEventListener('message', dispatchCicpAction)` 模式 | `orchestration-core/src/user-do.ts::handleWsAttach` | 扩双向 WS,client 发的消息走 dispatch |
| `src/engine_do.ts::dispatchCicpAction` switch-by-intent | `orchestration-core/src/user-do.ts::dispatchClientMessage` | switch by message type(start/input/cancel/command/...),各种 public action 的 fanout |
| `src/engine_do.ts` `waitUntil` 后台处理模式(用户提交 message 后立刻 ack,后台处理)| `orchestration-core/src/user-do.ts::handleInput`(增强)| 先 ack 200,agent.core 调用走 waitUntil |
| `core/alarm.ts::AlarmManager` 模式(intent prefill / ETL)| `orchestration-core/src/alarm.ts`(新)| 任务单不同:冷归档、token refresh、stale session cleanup |
| `core/db_do.ts::DOSqliteManager` 模式(migrate + queries + DO SQLite abstraction)| `orchestration-core/src/user-sqlite.ts`(新)| schema 不同:conversation_active_hint / user_secrets_cache / alarm_schedule |
| `core/broadcast.ts::Broadcaster` 模式(多 WS 广播)| 延后 | first-wave 仍是 single active writable attachment |
| `core/log.ts::initLogger`(持久化 D1 logger)| `orchestration-core/src/logger.ts`(新)| 模式参考,写 nano-agent 自己 D1 `nano_activity_logs` |
| `ai/intent.ts::IntentAnalyzer` | `orchestration-core/src/intent.ts`(新)| **只**吸收"dispatch by intent type"模式,**不**吸收 vector matching / LLM intent classify |

**不吸收**:

- `context/director.ts + producer.ts + writer.ts` — RAG 业务编排,nano-agent 是 agent runtime 不是 RAG
- `ai/gen.ts + topK.ts + topN.ts + vec.ts` — RAG 向量/生成,不吸收
- `rag/internal_retrieve.ts` — 同上
- `core/schemas_cicp.ts + schemas_smcp.ts` — CICP/SMCP 协议,nano-agent 用 NACP
- `core/db_d1.ts + db_vec.ts + prompt_manager.ts` — RAG 特定

### §3.3 user DO 终态结构

```typescript
export class NanoOrchestratorUserDO {
  // §1 persistent state
  private readonly sql: UserSqliteManager;      // NEW — ctx.storage.sql (DO SQLite)
  private readonly alarmManager: AlarmManager;   // NEW
  private readonly logger: Logger;               // NEW
  
  // §2 runtime state
  private readonly attachments = new Map<string, AttachmentState>();
  private readonly intentDispatcher: IntentDispatcher;  // NEW
  
  // §3 cached user context
  private activeConversationUuid: string | null = null;  // NEW
  private lastAuthSnapshot: AuthSnapshot | null = null;
  private cachedUserSecrets: Map<string, string> = new Map();  // NEW — per-user 解密 key 热缓存
  
  constructor(state: DurableObjectState, env: Env) {
    this.sql = new UserSqliteManager(state.storage.sql);
    this.state.blockConcurrencyWhile(async () => await this.sql.migrate());
    this.alarmManager = new AlarmManager(state, env);
    this.logger = new Logger(state, env.DB);
    this.intentDispatcher = new IntentDispatcher(...);
  }
  
  async fetch(request: Request): Promise<Response> {
    // 路由:
    //   POST /sessions/:id/{start,input,cancel,verify,status,timeline}  → dispatch
    //   GET  /sessions/:id/ws                                            → handleWsAttach(双向)
    //   GET  /users/me/conversations                                     → list (via D1)
    //   POST /users/me/conversations                                     → create
    //   POST /users/me/conversations/:cid/activate                       → switch active
    //   GET  /users/me/conversations/:cid/history                        → cold-aware read
  }
  
  async alarm(): Promise<void> {
    // 周期性任务:
    //   1. 压缩 stale session 到 D1(ended_at > 7d 的 runtime state flush)
    //   2. user_secrets_cache TTL 检查
    //   3. activity_log 批量 flush 到 D1
  }
  
  private async handleWsAttach(sessionUuid, request) {
    // WebSocketPair + accept + add to attachments map
    // NEW: server.addEventListener('message', async (evt) => {
    //   const parsed = JSON.parse(evt.data);
    //   await this.intentDispatcher.dispatch(parsed, this);
    // });
  }
  
  private async handleInput(sessionUuid, body) {
    // 当前已有 + 补:先 ack,waitUntil 调 agent.core
  }
  
  // ... handleStart / handleCancel / handleVerify 大致不变,但改为 intent-dispatch 入口
}
```

### §3.4 Intent dispatch 层(orchestration.core 独有)

**非 RAG 的 intent**,只做 message type fanout:

```typescript
class IntentDispatcher {
  async dispatch(msg: ClientMessage, userDo: NanoOrchestratorUserDO) {
    switch (msg.type) {
      case 'session.start':
      case 'session.input':
      case 'session.cancel':
        return this.dispatchToAgent(msg, userDo);
      
      case 'conversation.activate':
      case 'conversation.list':
      case 'conversation.history':
        return this.dispatchToLocal(msg, userDo);  // DO SQLite + D1
      
      case 'user.settings.get':
      case 'user.settings.set':
        return this.dispatchToLocal(msg, userDo);
      
      case 'system.ping':
        return { ok: true, pong: Date.now() };
      
      default:
        return { error: 'unknown-intent', type: msg.type };
    }
  }
}
```

这一层刻意不做 "用 LLM 判断 intent" — 本阶段先覆盖 typed message(client 知道自己在做什么),future 阶段再看是否需要自然语言 intent 判断。

### §3.5 对外 API 面(public routes)

orchestration.core 的 public routes(合并 auth 代理 + session + 用户管理):

| Method | Path | 说明 | 实装 |
|---|---|---|---|
| POST | `/auth/register` | 注册 | proxy → orchestration.auth `/internal/auth/register` |
| POST | `/auth/login` | 邮箱密码登录 | proxy → orchestration.auth `/internal/auth/login` |
| POST | `/auth/wechat/bridge` | 微信 code 登录 | proxy → orchestration.auth `/internal/auth/wechat/bridge` |
| POST | `/auth/password/reset` | 密码重置 | proxy → orchestration.auth `/internal/auth/password/reset` |
| POST | `/auth/api-keys/validate` | server-to-server API key 验证 | proxy |
| GET | `/users/me` | 当前用户 profile | proxy(orchestration.auth 查 D1)|
| PATCH | `/users/me` | 更新 profile | 同上 |
| GET | `/tenants/me` | 当前 tenant 信息 | 同上 |
| GET | `/tenants/me/members` | tenant 成员列表 | 同上 |
| GET | `/tenants/me/api-keys` | API key 列表(admin)| 同上 |
| POST | `/tenants/me/api-keys` | 创建 API key | 同上 |
| DELETE | `/tenants/me/api-keys/:id` | 吊销 API key | 同上 |
| GET | `/users/me/conversations` | 我的 conversation 列表(分页) | orchestration.core 直接查 D1 `nano_conversations` + DO SQLite active 指针 |
| POST | `/users/me/conversations` | 创建新 conversation | 同上 |
| POST | `/users/me/conversations/:cid/activate` | 切换 active conversation | 同上,更新 DO SQLite `conversation_active_hint` |
| GET | `/users/me/conversations/:cid/history` | conversation 历史(分页 + 冷层透明读)| D1 + R2(冷层)|
| POST | `/sessions/:id/start` | 起 session | 既有 + 意图分流 |
| POST | `/sessions/:id/input` | 追加输入 | 既有 + waitUntil |
| POST | `/sessions/:id/cancel` | 取消 | 既有 |
| POST | `/sessions/:id/verify` | preview verify | 既有 |
| GET | `/sessions/:id/status` | 读状态 | 既有 |
| GET | `/sessions/:id/timeline` | 读 timeline | 既有,追加 D1 查询 |
| GET | `/sessions/:id/ws` | **双向** WebSocket | 既有 + **补 message listener** |

合计 ~22 public routes(当前 7 → 22)。新增 ~15 条,其中 11 条 pure proxy,4 条要接 D1。

---

## §4 nano-agent 专用 D1 Schema 设计

### §4.1 database 命名

- **database_name**: `nano-agent-db`
- **binding name**(在 4 个 worker 的 wrangler): `DB`(简短,与 smind-admin 同)
- **表前缀**: `nano_`(与 smind 的 `smind_` 区分,避免将来共存冲突)

### §4.2 从 ddl-v170 copy+adapt 的模块

| ddl-v170 模块 | 吸收? | 产物 | 行数估计(SQL)|
|---|---|---|---|
| **smind-01 tenant-identity** | ✅ 核心吸收 | `nano_users / nano_user_profiles / nano_user_identities / nano_teams / nano_team_memberships / nano_team_api_keys` | ~500 |
| smind-01 子集 | ❌ 不吸收 | `nano_team_invites + nano_team_storage`(延后)| — |
| smind-02 workflow | ❌ | — | — |
| smind-03 asset-files | ⚠️ 延后 | 若支持用户附件 upload,才需要 `nano_assets` | — |
| smind-04 runtime-process | ❌ | runtime state 在 agent-core DO,不需要独立表 | — |
| smind-05 knowledge-vector | ❌ 延后 | 未来 RAG charter | — |
| **smind-06 conversation-session** | ✅ 核心吸收 | `nano_conversations / nano_sessions / nano_turns / nano_messages / nano_message_parts / nano_conversation_context_snapshots` | ~600 |
| smind-07 CMS | ❌ | — | — |
| smind-08 CRM | ❌ | — | — |
| **smind-09 quota (subset)** | ✅ 部分吸收 | `nano_usage_meter_definitions / nano_usage_events / nano_quota_policies / nano_quota_balances / nano_quota_ledger_entries` | ~400 |
| smind-09 billing | ❌ | billing_* 全部延后(不收费阶段)| — |
| smind-10 skill | ❌ 延后 | skill.core 继续延后 | — |
| smind-11 inbox | ❌ | — | — |
| smind-12 project | ❌ | — | — |

**合计 schema**:~1500 LOC SQL(3 模块 adapt)

### §4.3 视图(views)吸收策略

ddl-v170 有一些 Read Model Helper views(`v_smind_*_live`),提供 JOIN 好的查询入口。nano-agent 应该**吸收这些 view 模式**,建立 `v_nano_*_live` 对应视图,避免上层代码写复杂 JOIN。

推荐吸收的 views:

| ddl-v170 view | nano-agent 对应 | 用途 |
|---|---|---|
| `v_smind_user_default_team_context` | `v_nano_user_default_team_context` | 登录后一次 query 拿到 user + team + plan_level |
| `v_smind_team_active_membership` | `v_nano_team_active_membership` | tenant admin panel 列 active 成员 |
| `v_smind_conversation_live` | `v_nano_conversation_live` | 用户最近 N 个 active conversation |
| `v_smind_conversation_message_timeline` | `v_nano_conversation_message_timeline` | conversation 详情页 |
| `v_smind_conversation_context_live` | `v_nano_conversation_context_live` | compact 后的 context snapshot 查询 |
| `v_smind_team_quota_live` | `v_nano_team_quota_live` | tenant 当前 quota 余额(热) |
| `v_smind_team_usage_daily_live` | `v_nano_team_usage_daily_live` | 每日用量聚合 |

这些 view 让上层 worker 代码 SELECT 一条 row 就够,不用客户端做多次 join。**是降低认知负担的直接杠杆**。

### §4.4 D1 migration 策略

**自动 migration**模式(参考 contexter `DOSqliteManager.migrate()`):

1. `nano_schema_version` 表,单行记录 `version`
2. orchestration-auth worker 启动时第一个请求触发 `migrator.migrate()`
3. migrator 按版本号顺序执行 DDL patch:
   ```
   migrations/001-init.sql       ← 模块 01 + 06 + 09 subset 的完整 CREATE
   migrations/002-add-assets.sql ← 若未来引入 assets
   migrations/003-add-billing.sql
   ...
   ```
4. 每次 migration 在 transaction 内执行,失败回滚

**生产部署**:`wrangler d1 execute nano-agent-db --file=migrations/001-init.sql` 是 manual path;同时 worker 内也跑一次 migrate() 做 idempotent check。

### §4.5 **不**共享 smind-db-v170

Owner 已明确 nano-agent 独立。D1 各自一个:

- `smind-db-v170`(smind 家族用,nano-agent 不 touch)
- `nano-agent-db`(nano-agent 专用)

虽然命名看起来像 "smind_* 和 nano_* 可以共存在一个 DB",但**不要这样做**。理由:
- DB-level 隔离更彻底,任何一方 schema migration 不影响另一方
- 权限边界清晰:同一个 Cloudflare account 可以 issue 两份 wrangler secret,各自绑定自己的 DB
- 将来 nano-agent 若想开源 / 独立商业化,DB 隔离是必须条件

---

## §5 `agent.core` 增强:LLM Wrapper + 秘钥工程

### §5.1 当前 LLM 真相(事实核查)

- `workers/agent-core/src/llm/` 有 1092 LOC 框架(attachment-planner / executor / canonical / request-builder / session-stream-adapter / stream-normalizer 等)
- `llm/adapters/openai-chat.ts` 存在(322 行)但**当前 production 路径不用**
- `llm/gateway.ts` 15 行 stub 注释 "not implemented in v1"
- 当前 kernel `runner.ts:143 this.delegates.llm.call(...)` 走 `FAKE_PROVIDER_WORKER` service binding
- 所以 **turn loop 是真的 loop,但 LLM 是假的**。一切流式、tool_call 解析、usage 统计框架都在,只差 provider 接线

### §5.2 Provider adapter:Workers AI

**Cloudflare Workers AI** binding 特征:
- `env.AI` binding(不是 service binding,是 platform AI binding)
- 调用:`env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages: [...], stream: true })`
- 返回:ReadableStream(OpenAI-compatible 或 CF-native,取决于模型)
- **价格**:free tier 够用,超额才收费
- **模型选择**:Llama / Mistral / Qwen 等 chat 模型

**新增文件**:`workers/agent-core/src/llm/adapters/workers-ai.ts`(~250 LOC)

```typescript
export class WorkersAiAdapter implements LlmAdapter {
  constructor(private ai: Ai, private config: { model: string }) {}
  
  async *call(messages: ChatMessage[]): AsyncIterable<LlmChunk> {
    const stream = await this.ai.run(this.config.model, {
      messages: messages.map(toWorkersAiMessage),
      stream: true,
    });
    // 解析 stream,yield {type: "content", content} / {type: "tool_calls"} / {type: "usage"}
  }
}
```

### §5.3 Provider adapter:DeepSeek(OpenAI-compatible)

DeepSeek API 兼容 OpenAI chat completion shape。可以**直接复用** `openai-chat.ts:322` 基础代码,只改 baseURL + API key 来源。

**新增文件**:`workers/agent-core/src/llm/adapters/deepseek.ts`(~80 LOC,大量 reuse openai-chat.ts 基础)

关键差异:
- baseURL: `https://api.deepseek.com/v1/`
- API key 来源:per-tenant 解密(见 §5.4 秘钥工程)
- 模型选择:`deepseek-chat` / `deepseek-reasoner`(R1)
- DeepSeek 支持的 tool_call / JSON mode 与 OpenAI 一致

### §5.4 秘钥管理工程(新)

**问题**:不同 provider 秘钥来源不同:
- Workers AI: **无 per-tenant key**,用 Cloudflare account 级别平台绑定
- DeepSeek: **per-tenant API key**(tenant 可以用自己的 DeepSeek key 避免 quota 争抢)

**秘钥存储方案**:

| 秘钥类型 | 存储 | 访问 |
|---|---|---|
| Workers AI(platform-level) | wrangler secret `CF_ACCOUNT_AI_TOKEN`(如果需要)或 `env.AI` binding 自动 | agent-core 直接用 |
| DeepSeek per-tenant API key | **加密后**存 D1 `nano_tenant_secrets` 表 | agent-core 请求时解密 |
| WeChat AppID/Secret(orchestration.auth 用)| wrangler secret | orchestration.auth 直接用 |

**加密方案**:

- 用 **AES-GCM** 加密 per-tenant API key
- **加密 key**:一个 **platform master key**(wrangler secret `TENANT_SECRETS_MASTER_KEY`)
- **热缓存**:agent-core 第一次查 tenant API key 时,走 `nano_tenant_secrets` SELECT → decrypt → 存 `ctx.storage`(session DO 内)。后续同 session 复用。**DO restart 后缓存失效需要重新解密**(这也是 DO SQLite 热缓存 pattern 的一个用例 —— 但我不推荐把秘钥写进 DO SQLite,应该只活在 in-memory cache)。

**新增 D1 table**(未列入 §4.2,因为是本 track 独有):

```sql
CREATE TABLE nano_tenant_secrets (
    tenant_secret_uuid TEXT PRIMARY KEY,
    team_uuid TEXT NOT NULL,
    secret_key TEXT NOT NULL,        -- e.g. 'deepseek_api_key'
    secret_value_encrypted TEXT NOT NULL,
    key_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (team_uuid, secret_key)
);
```

**API**(orchestration.core 提供,admin 级):
- `PUT /tenants/me/secrets/:key`(写入,body 是明文,worker 加密后存 D1)
- `GET /tenants/me/secrets/:key/exists`(检查是否配置,不返回值)
- `DELETE /tenants/me/secrets/:key`

**tenant rotate DeepSeek key**:orchestration.core 发 PUT 覆盖,agent-core 的 in-memory 缓存可能未过期。**解决方案**:orchestration.core 写秘钥时通过 service binding 通知 agent-core 主动 invalidate 对应 tenant 的热缓存,或设置 5 分钟 TTL。**简化优先**:先用 5 分钟 TTL,tenant rotate 后最多 5 分钟生效。

### §5.5 Provider chain 策略

**首选**:

- **主 provider:DeepSeek**(性价比 + 中文好 + 有 per-tenant key 控制成本)
- **Fallback:Workers AI**(DeepSeek 429/超时/配置错误时,自动降级)

**fallback 实现**:

```typescript
class FallbackChainAdapter implements LlmAdapter {
  constructor(private primary: LlmAdapter, private fallback: LlmAdapter) {}
  
  async *call(messages): AsyncIterable<LlmChunk> {
    try {
      yield* this.primary.call(messages);
    } catch (err) {
      if (isTransientError(err)) {
        // 发 system.notify 告诉 client "降级到 fallback model"
        yield* this.fallback.call(messages);
      } else {
        throw err;
      }
    }
  }
}
```

**provider 选择权**:tenant 可以在 profile 里选(`settings.llm_primary = "deepseek" | "workers_ai"`),default 是 DeepSeek。

### §5.6 rate limit / retry / timeout

当前 `llm/errors.ts` 只有通用错误。需要补:

- `RateLimitExceededError`(DeepSeek 429 / CF limits)→ retry with backoff(3 次),超过触发 fallback
- `ProviderTimeoutError`(30s 无响应)→ abort + switch to fallback
- `InvalidApiKeyError`(DeepSeek 401)→ 不 retry,返回 tenant-facing error "请检查 DeepSeek API key 配置"

---

## §6 内部 RPC 启动 + HTTP 退役推进

### §6.1 当前 internal transport 真相

- F1-F5 使用 **fetch-backed service binding**(`env.AGENT_CORE.fetch(new Request("https://agent.internal/internal/...", ...))`)
- 这是 Cloudflare service binding 的**原始接口**,每次调用构造一个 Request/Response 对象
- 问题:HTTP overhead / URL 硬编码 / 缺少 TypeScript 类型安全 / 错误处理依赖 status code 而非 typed error

### §6.2 Cloudflare WorkerEntrypoint RPC(2024 新特性)

Cloudflare 2024 introduced **WorkerEntrypoint** class + RPC binding,允许:

```typescript
// Worker A exports a class
export class AgentCoreEntrypoint extends WorkerEntrypoint {
  async startSession(sessionId: string, body: SessionStartBody): Promise<StartResponse> { ... }
  async cancelSession(sessionId: string): Promise<CancelResponse> { ... }
}

// Worker B uses RPC binding
const resp = await env.AGENT_CORE.startSession("uuid", { initial_input: "..." });
```

**优势**:
- 类型安全(TypeScript 完整)
- 没有 URL 魔法字符串
- 参数/返回值直接是 JS object,不用 JSON.stringify
- 错误直接 throw,不用解析 status code

### §6.3 过渡路径(不是一次性全切)

**zero-to-real 阶段只 "启动" 不 "完成"**。

Step 1:**orchestration.auth 直接从 RPC 开始**(新 worker,无历史包袱)
- `orchestration-auth/src/entrypoint.ts` 导出 `export default class AuthEntrypoint extends WorkerEntrypoint`
- orchestration.core `env.AUTH_CORE.register(input)` 类型完整

Step 2:**agent.core /internal/* 保留**,但新 RPC entrypoint **并行存在**
- 继续支持 current `/internal/sessions/:id/start` HTTP path(orchestration.core 已消费)
- **同时** export `AgentCoreEntrypoint` class with RPC methods
- 新 orchestration.core 代码用 RPC,老测试保持 HTTP 直到 next phase 迁完

Step 3(**下一阶段才做**):全部迁到 RPC,删除 agent.core /internal/* HTTP path。

这样本阶段 RPC 的工作只是 "**orchestration.auth 纯 RPC + agent.core 加 RPC 并行**",不用一次性重写所有 internal call。

### §6.4 向下兼容与 test harness

**潜在破坏点**:当前 F0-F5 积累的 package-e2e / cross-e2e tests 大多通过 HTTP 驱动测试 worker binding。RPC 引入后:

- live e2e 测试**不受影响**(它们是 public HTTP / WS,不是 internal binding)
- worker-unit 测试需要同时测 HTTP path + RPC path(两套入口,同套业务逻辑)

**不破坏纪律**:新 RPC entrypoint 只是**增加**接口面,不改既有 `/internal/*` 行为。直到下一阶段才 retire HTTP internal。

---

## §7 依赖关系与子阶段切分

### §7.1 内部依赖 DAG

```
[§4 D1 Schema 冻结]
       ↓
[§2 orchestration.auth 建立] ←── uses D1
       ↓
[§3 orchestration.core 增强] ←── uses auth via binding + DO SQLite + D1
       │
       ├─ §3.1-§3.3 DO SQLite + Alarm + 双向 WS + conversation 层
       └─ §3.5 public API 扩展
       ↓
[§5 agent.core LLM wire + 秘钥] ←── uses D1 (tenant secrets) + 认 forwarded authority
       ↓
[§6 internal RPC 启动] (可与 §5 并行,不阻塞)
       ↓
[first real run + gap 修复]
```

### §7.2 推荐三段式

**zero-to-real-1: Foundation**(~1 月)

- D1 schema 建立(`nano_users / nano_teams / nano_conversations / nano_sessions / nano_turns / nano_messages / nano_quota_*`)
- `orchestration.auth` worker 建立(JWT mint + register/login + API key + user/tenant admin,**不含** WeChat bridge)
- orchestration.core 初步改造:D1 binding + 接入 orchestration.auth + 补 `/auth/*` proxy routes
- agent.core multi-tenant 动态化:`buildIngressContext` 消费 forwarded authority
- 5-worker TEAM_UUID 在 wrangler 的语义调整(default hint)

**Exit**:两个真实 user(自己注册两个)能登录、拿 JWT、起 session、session 真正跑(即使 LLM 仍是 fake)、tenant 隔离可证(user A 看不见 user B 的 session)。

**zero-to-real-2: Runtime 接真 + 用户态补齐**(~1.5 月)

- agent.core LLM wrapper:Workers AI adapter + DeepSeek adapter + fallback chain
- 秘钥工程:tenant_secrets 表 + encryption + 热缓存
- context.core compact default-wire
- bash.core `beforeCapabilityExecute` 真 wire,消费 nano_quota_balances + 写 nano_usage_events
- orchestration.core user DO **完整重塑**:
  - DO SQLite migrate
  - AlarmManager 实装
  - 双向 WS message listener
  - conversation 聚合层
  - IntentDispatcher
- orchestration.auth WeChat bridge

**Exit**:真实 LLM 跑 agent loop;双向 WS 可用;quota mock 可切 allow/deny 且真实写账本;conversation 列表可查;可做 WeChat 登录。

**zero-to-real-3: 对外 + 冷层 + first real run**(~1 月)

- orchestration.core 补 session/conversation list / history API(paging + 冷层透明读)
- 内部 RPC entrypoint 引入(orchestration.auth 纯 RPC,agent.core 加并行 RPC)
- R2 冷归档 job(alarm-driven,把 ended_at > 7d 的 conversation 归档)
- 内部 5-10 人真实使用 + WeChat Mini Program 接入
- gap triage + 修复

**Exit**:真实用户日常使用 1 周无阻塞 blocker。

### §7.3 关键 milestone

| Milestone | 属于 | 指标 |
|---|---|---|
| M1: Auth Flow 跑通 | zero-to-real-1 | 自己注册 2 个 user,login 拿到 JWT,verify 通过 |
| M2: Multi-tenant Runtime 隔离 | zero-to-real-1 | user A / user B 发 session,agent-core 能 verify tenant boundary |
| M3: 真 LLM Response | zero-to-real-2 | DeepSeek or Workers AI 返回真实 content(不是 fake provider 固定 reply)|
| M4: Quota 真实扣减 | zero-to-real-2 | 一次 capability 执行写 nano_usage_events,balance -=1 |
| M5: 双向 WS | zero-to-real-2 | Mini Program 通过 WS 发 message,server 收到并转 input |
| M6: WeChat Login 可用 | zero-to-real-2/3 | Mini Program wx.login → code2session → JWT |
| M7: First real run green | zero-to-real-3 | 5-10 人用 1 周,crash 率 < 1% |

---

## §8 Risk / Decision Matrix

### §8.1 技术风险

| 风险 | 严重度 | 缓解 |
|---|---|---|
| DO SQLite migration 在 production 失败 | 中 | `blockConcurrencyWhile` + idempotent migration,**新 user DO 本就没有数据**,风险集中在已 deploy 后的 schema alter |
| DeepSeek API rate limit / 宕机 | 中 | Workers AI fallback 自动触发;tenant 可换自己 key |
| per-tenant 秘钥加密 key rotation | 中 | 用 key_version 字段,支持同时 verify N 个版本的加密数据 |
| Multi-tenant 行级隔离漏掉某个 SELECT 不加 `team_uuid` 过滤 | **高** | lint rule + code review checklist + D1 integration test 专门验证 tenant 隔离 |
| JWT_SECRET_KEY rotation 期间 orchestrator / auth 不同步 | 中 | 见 §2.6 三步走 rotation 协议 |
| 冷归档 R2 write 失败导致数据丢失 | 中 | 归档后等一个周期再 delete D1 的 row;或写 R2 + D1 mark 软归档(两步不原子,但最终一致) |
| 双向 WS 实现 Mini Program 特定 bug | 中 | 并行跑一个 pure web client 做对照组(owner 前期已提)|

### §8.2 架构决策(在 G0 冻结)

| 决策 | 推荐 | 备选 |
|---|---|---|
| JWT claim schema | 沿用 orchestrator.core 当前 `{sub, tenant_uuid, membership_level, realm?, source_name?, exp}` | smind 式 `{uuid, tid, tpl}` |
| D1 共享/分开 | 共用 1 个 `nano-agent-db`(auth + core 都 bind) | 分开 auth-db + core-db |
| DDL 引入粒度 | `01 + 06 + 09 subset` 三模块 | Min(01+06)/ Full(+ 02/04/05) |
| LLM 主/fallback | 主 DeepSeek + fallback Workers AI | 反过来 / 只 Workers AI |
| orchestration.auth 对内 transport | **RPC(WorkerEntrypoint)从 day-1** | fetch-based HTTP |
| internal RPC 全面推进时机 | zero-to-real-3 启动,**下一阶段完成** | 本阶段完成(scope 过大) |
| DO SQLite 迁移策略 | 立刻全切(无老用户数据)| 双写期 |
| conversation 聚合层引入 | day-1(与 Foundation 一起落)| Runtime 阶段再补 |
| tenant secrets 加密位置 | D1 表 + platform master key | KV + per-tenant master key |

### §8.3 非技术风险

| 风险 | 缓解 |
|---|---|
| 和 smind 家族的代码相似度 high,future 维护者误以为是 smind 的 fork | **README 顶部明确** "nano-agent 独立于 smind 家族,代码模式相似仅因降风险借鉴"。每个 copied 模式文件顶部 comment 说明 ancestry。 |
| WeChat Mini Program 并行开发,接口对齐反复 ping-pong | 本阶段先建立 **OpenAPI / JSON schema doc**(orchestration.core public API 精确描述),Mini Program 那边直接读 doc 对接,不靠 Slack 协调 |
| scope 超期(实际投入 5-6 个月甚至更多)| 三段式内每段 exit criteria 硬;严禁跳段 |

---

## §9 Open Questions(最终版)

按需 G0 启动前回答:

### §9.1 结构性(必答)

1. **JWT claim schema**:是否同意沿用 orchestrator.core 当前格式,让 orchestration.auth 适配签发?(推荐 yes)
2. **D1 共用**:是否同意 `nano-agent-db` 单一 DB,4 个 worker 都 bind?(推荐 yes)
3. **DDL 粒度**:接受 `01 + 06 + 09 subset` 三模块吗?(推荐 yes,~1500 LOC SQL)
4. **LLM 主选**:DeepSeek 主 + Workers AI fallback?(推荐 yes)
5. **internal RPC**:本阶段"启动不完成",是否同意?(推荐 yes)

### §9.2 实现细节(可以 G0 期间回答)

6. **tenant secret 加密**:platform master key 还是 per-tenant master key?(推荐 platform)
7. **WeChat 登录**:放 orchestration.auth 还是另起 wechat bridge 子 worker?(推荐放 orchestration.auth)
8. **orchestration.auth RPC 还是 HTTP binding?**(推荐 RPC,新 worker 没有遗留)
9. **user DO SQLite 的热数据清单**:推荐表清单?(见 §3.3 建议:`conversation_active_hint / user_secrets_cache / alarm_schedule / activity_buffer`)
10. **Alarm interval**:多久触发一次?(推荐 5 分钟,按需可调)

### §9.3 产品决策(future)

11. **Mini Program 发布节奏**:与 nano-agent 同步 deploy 还是晚一周 beta?
12. **API key 发布面**:API key 是 tenant admin 手动创建,还是 platform 自动分配?
13. **free plan 额度**:quota_policies 初始值(例如 / user / day / 100 turn)

---

## §10 一句话总结

> **`zero-to-real` 是把 orchestration-facade 的 scaffold 变成 multi-tenant Agent SaaS 系统底座的阶段。5 个具体 track:(1) 新建 `orchestration.auth` 作为只对 `orchestration.core` 的内部 auth worker;(2) 大幅增强 `orchestration.core` user DO —— 吸收 contexter 运行模式(除 RAG/CICP 外),补 DO SQLite + Alarm + 双向 WS + conversation 聚合 + intent dispatch;(3) 建立 nano-agent 专用 D1(`nano-agent-db`,3 模块 ~1500 LOC SQL,表前缀 `nano_`);(4) agent.core 接真 LLM(DeepSeek 主 + Workers AI fallback)+ per-tenant 秘钥加密工程;(5) 启动 internal RPC 推进 HTTP 退役(本阶段只启动,不完成)。**
>
> **阶段规模 ~5500 LOC / 3.5-4.5 月,6-worker 终态。smind 家族仅作为代码与 schema 的参考上下文,nano-agent 完全独立。**

---

## §11 与前版(v0.1 / v0.2 / v0.3)的关系

本 v2 **不是** 前文档 v0.1/v0.2/v0.3 的 append。前版是在对话推进中的探索过程记录:

- **v0.1**:不了解 smind 上下文时的初版探索
- **v0.2**(被撤回):错误地将 nano-agent 视为 "嵌入 smind 生态"
- **v0.3**(补丁):撤回 v0.2 后的修正

v2 是在 owner 给出 5 部分明确分工后**一次性成文**的 coherent 分析。具体差别:

| 维度 | v0.1 | v0.2 | v0.3 | **v2** |
|---|---|---|---|---|
| 框架 | 从零建 | 嵌入 smind | 独立建 + 参考 smind | 独立建 + 参考 smind |
| worker 数 | 5 | 5 | 6 | **6(含 orchestration.auth)** |
| orchestration.auth | — | — | ✅ | ✅(详细设计)|
| orchestration.core 增强 | 表面 | 表面 | 指出 gap | **完整重塑路径**(DO SQLite + Alarm + 双向 WS + conversation + intent) |
| D1 | 讨论选项 | 共享 smind | 自建 | **自建,表前缀 + 模块清单 + 视图策略 + migration 流程** |
| LLM wire | 泛泛谈 | 泛泛谈 | 泛泛谈 | **Workers AI + DeepSeek 双 adapter + fallback chain + 秘钥加密工程** |
| internal RPC | 未提 | 未提 | 未提 | **本阶段启动 HTTP 退役推进** |
| scope 估计 | ~3100 | ~2600(错) | ~5500 | **~5500** |

前版作为 ancestry 保留在 `plan-analysis-by-opus.md`,本 v2 是之后工作的**单一真相源**(single source of truth for zero-to-real planning)。

---

## §12 版本历史

| 版本 | 日期 | 修改者 | 变更 |
|---|---|---|---|
| v2.0 | 2026-04-24 | Claude Opus 4.7 (1M context) | 基于 owner 明确的 5 部分分工(orchestration.auth / orchestration.core 增强 / 真实 DDL / agent.core LLM+秘钥 / internal RPC 启动 HTTP 退役)一次性成文的 coherent 分析。替代前版 v0.1/v0.2/v0.3 的 ad-hoc 探索过程。6-worker 终态拓扑,~5500 LOC / 3.5-4.5 月。独立完成,未参考其他 reviewer。 |
