# Nano-Agent API Docs 审查报告

> 审查对象: `clients/api-docs/ ZX5 客户端接口文档`
> 审查类型: `docs-review`
> 审查时间: `2026-04-29`
> 审查人: `GPT`
> 审查范围:
> - `clients/api-docs/README.md`
> - `clients/api-docs/auth.md`
> - `clients/api-docs/catalog.md`
> - `clients/api-docs/me-sessions.md`
> - `clients/api-docs/permissions.md`
> - `clients/api-docs/session-ws-v1.md`
> - `clients/api-docs/session.md`
> - `clients/api-docs/usage.md`
> - `clients/api-docs/wechat-auth.md`
> - `clients/api-docs/worker-health.md`
> 对照真相:
> - `workers/orchestrator-core/src/index.ts`
> - `workers/orchestrator-core/src/user-do.ts`
> - `workers/orchestrator-core/src/session-truth.ts`
> - `workers/orchestrator-core/src/catalog-content.ts`
> - `workers/orchestrator-core/src/auth.ts`
> - `packages/orchestrator-auth-contract/src/index.ts`
> - `workers/orchestrator-auth/src/service.ts`
> - `workers/orchestrator-auth/src/wechat.ts`
> - `packages/nacp-session/src/stream-event.ts`
> - `workers/agent-core/src/kernel/session-stream-mapping.ts`
> 文档状态: `changes-requested`

---

## 0. 总结结论

> 这批 API 文档已经覆盖了 ZX5 后的大多数公开路由，但当前还不能被视为“有效、完整、正确”的客户端事实源。

- **整体判断**：`文档覆盖面已基本成型，但 auth / session lifecycle / WS / usage 仍存在多处 contract-level drift，当前不应作为冻结版客户端接口事实。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `auth.md` 中的错误码、成功返回体、/auth/verify 取 token 方式，与真实 contract 已经发生实质漂移。
  2. 文档把 session 生命周期写成“必须先 POST /me/sessions 再 /start”，但真实代码仍允许客户端直接拿任意 UUID 调 /start 建会话，这是文档与实现同时暴露出的核心断点。
  3. `session-ws-v1.md` 与 `usage.md` 仍在描述过期或不存在的 wire / aggregation 语义，会直接误导客户端实现。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `clients/api-docs/*.md`
  - `docs/templates/code-review.md`
- **核查实现**：
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/user-do.ts`
  - `workers/orchestrator-core/src/session-truth.ts`
  - `workers/orchestrator-core/src/catalog-content.ts`
  - `workers/orchestrator-core/src/auth.ts`
  - `packages/orchestrator-auth-contract/src/index.ts`
  - `workers/orchestrator-auth/src/service.ts`
  - `workers/orchestrator-auth/src/wechat.ts`
  - `packages/nacp-session/src/stream-event.ts`
  - `workers/agent-core/src/kernel/session-stream-mapping.ts`
- **执行过的验证**：
  - `git --no-pager status --short docs/investigation/api-docs-after-ZX5-reviewed-by-GPT.md docs/charter/review/plan-real-to-hero-reviewed-by-GPT.md`
  - 多轮逐文件 / 逐符号反查 `view` + `rg`，核对 route、schema、error code、返回 envelope、WS frame kind、D1/KV 行为
  - 对 `clients/api-docs` 10 份文档逐项回查对应实现 owner
- **复用 / 对照的既有审查**：
  - `none` — `本次结论仅基于我对当前代码与当前文档的独立核查，不采纳其他同事或既有审查文档的判断。`

### 1.1 已确认的正面事实

- `README.md` 对公开 facade owner、6-worker 拓扑、catalog / me / session 主体路由面的覆盖是基本完整的；`workers/orchestrator-core/src/index.ts:356-455` 能与其主矩阵大体对上。
- `permissions.md` 对“HTTP 是当前唯一 live 的 permission / elicitation API、WS round-trip 未 live、runtime 当前不等待 decision/answer”的判断与真实实现一致；见 `clients/api-docs/permissions.md:18-19,59-64,141-158`、`workers/orchestrator-core/src/user-do.ts:1286-1415`。
- `wechat-auth.md` 与 `worker-health.md` 的主体描述基本可信；分别可由 `workers/orchestrator-auth/src/wechat.ts:33-159` 与 `workers/orchestrator-core/src/index.ts:110-174` 反证。

### 1.2 已确认的负面事实

- `auth.md` 仍在使用一批过期 contract：`identity-exists`、`invalid-refresh-token`、`refresh-token-expired`、`{valid:true, expires_at}`、`{reset:true}` 等，都与当前 auth contract / service 不一致。
- `/sessions/{id}/start` 文档仍默认“只能消费 `/me/sessions` mint 出来的 pending UUID”，但真实 `handleStart()` 在 `readSessionStatus(session_uuid) === null` 时仍会直接创建会话，不要求先 mint。
- `session-ws-v1.md` 与 `usage.md` 还在描述过期的 event kind / usage 来源：前者列出不存在的 `llm.finish`、`session.phase` 等，后者写成“先读 KV hot snapshot 再 merge D1”，而真实路径是 null placeholder + D1 聚合读取。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 逐份文档与 owner 实现、contract schema、worker handler 对照。 |
| 本地命令 / 测试 | `yes` | 只做仓库状态与代码检索；本轮任务是文档事实审查，不涉及业务改动验证。 |
| schema / contract 反向校验 | `yes` | 重点对照了 `packages/orchestrator-auth-contract` 与 `packages/nacp-session`。 |
| live / deploy / preview 证据 | `no` | 本轮未以 live preview 作为真相来源。 |
| 与上游 design / QNA 对账 | `n/a` | 本轮目标是“文档是否符合当前代码事实”，不是对 charter / action-plan 收口。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | `auth.md` 的 contract 已明显落后于真实 auth schema | `high` | `protocol-drift` | `yes` | 按 contract 包与 service 结果重写 auth 文档 |
| R2 | session 生命周期文档与真实 `/start` 语义冲突 | `high` | `correctness` | `yes` | 修代码或修文档，但必须二选一收口 |
| R3 | `session-ws-v1.md` 仍在描述错误的 WS event taxonomy | `high` | `protocol-drift` | `yes` | 以 `nacp-session` + `user-do` 当前 live frame 为准重写 |
| R4 | `/me`、`timeline`、`usage` 文档对读路径与错误语义有多处漂移 | `medium` | `docs-gap` | `no` | 逐项修正文档中的 source-of-truth 描述 |
| R5 | `catalog.md` 对 `permission-gate` 的能力描述强于当前真实可用面 | `low` | `scope-drift` | `no` | 弱化为 partial / future-facing 描述 |

### R1. `auth.md` 的 contract 已明显落后于真实 auth schema

- **严重级别**：`high`
- **类型**：`protocol-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/api-docs/auth.md:138-212,250-277` 仍声明 `identity-exists`、`invalid-refresh-token`、`refresh-token-expired`、`token-expired`、`token-invalid`、`{valid:true, expires_at}`、`{reset:true}`。
  - `packages/orchestrator-auth-contract/src/index.ts:171-179,187-201,245-249` 的真实 contract 是 `VerifyTokenResult = { valid: true } & AuthView`、`ResetPasswordResult = { password_reset: true } & AuthView`，错误码是 `identity-already-exists` / `refresh-invalid` / `refresh-expired` / `refresh-revoked`。
  - `workers/orchestrator-auth/src/service.ts:285-339` 明确返回 `valid: true + buildView(...)` 与 `password_reset: true + buildView(...)`。
  - `workers/orchestrator-core/src/index.ts:323-344` 对 `/auth/verify` 实际只转发 header 中的 bearer token，文档中“body 也可传 access_token”的说法不成立。
- **为什么重要**：
  - 这是客户端最容易直接代码生成 / 写 SDK 的部分，错误码和返回体一旦写错，前端登录、刷新、重置密码、token 校验会直接按错协议解析。
  - `/auth/verify` 的 token 取值方式写错，会让调用方以为可以不带 Authorization header，实际却收到 schema 错误。
- **审查判断**：
  - `auth.md` 目前不是“少量表述问题”，而是核心 contract 漂移，不能继续作为客户端接口真相。
- **建议修法**：
  - 以 `packages/orchestrator-auth-contract/src/index.ts` 为单一 contract owner，重写 `auth.md` 的 success / error 表。
  - 明确 `/auth/verify` 当前只接受 bearer header；若要支持 body token，应先改 `orchestrator-core/src/index.ts`，再更新文档。

### R2. session 生命周期文档与真实 `/start` 语义冲突

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/api-docs/README.md:80-99`、`clients/api-docs/me-sessions.md:22-64`、`clients/api-docs/session.md:45-94` 整体把 session 生命周期写成“先 `POST /me/sessions` server-mint pending UUID，再 `POST /sessions/{id}/start` 启动”。
  - `workers/orchestrator-core/src/index.ts:508-568` 的确实现了 `/me/sessions` server-mint + D1 pending row。
  - 但 `workers/orchestrator-core/src/user-do.ts:773-857` 的 `handleStart()` 并没有要求 `durableStatus === 'pending'`；当 `readSessionStatus(session_uuid)` 返回 `null` 时，代码仍继续创建 KV entry、durable session、durable turn，并成功启动。
  - `workers/orchestrator-core/src/user-do.ts:2186-2205` 的 `sessionGateMiss()` 只约束非 `/start` 路径；这进一步说明“必须先 mint”的 invariant 尚未被 `/start` 真正执行。
- **为什么重要**：
  - 这不是单纯文档落后，而是客户端 contract 与真实 runtime 行为冲突：文档承诺“server-mint is source of truth”，但代码仍接受客户端自带 UUID 直启。
  - 该断点会影响审计、代理层约束、幂等语义和前端流程假设。
- **审查判断**：
  - 当前文档写的是“预期产品契约”，不是“当前代码事实”。
  - 如果团队认定必须先 mint，那么这里是代码缺口；如果团队接受任意 UUID 直启，那么文档缺失事实。两者至少有一个必须修。
- **建议修法**：
  - **推荐**：收紧 `handleStart()`，要求 D1 中存在 pending row 才允许 start；缺失时返回明确错误。
  - 若暂不修代码，则必须在文档中诚实写出“当前实现仍接受客户端自带 UUID 直启，`/me/sessions` 是推荐路径而非硬前置”。

### R3. `session-ws-v1.md` 仍在描述错误的 WS event taxonomy

- **严重级别**：`high`
- **类型**：`protocol-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/api-docs/session-ws-v1.md:38-63` 把 `payload.kind` 写成 `llm.delta` / `llm.finish` / `tool.call.progress` / `tool.call.result` / `session.phase` / `session.error` / `system.notify` / `system.shutdown` / `capability.output_chunk`。
  - `packages/nacp-session/src/stream-event.ts:71-95` 当前真实 stream kind 集合是 `tool.call.progress` / `tool.call.result` / `hook.broadcast` / `session.update` / `turn.begin` / `turn.end` / `compact.notify` / `system.notify` / `llm.delta`。
  - `workers/agent-core/src/kernel/session-stream-mapping.ts:15-25` 也把 runtime event 冻结映射到上述 9 类，不存在文档里列出的 `llm.finish`、`session.phase`、`session.error`、`system.shutdown`、`capability.output_chunk`。
  - `workers/orchestrator-core/src/user-do.ts:1927-1947,2055-2060,2074-2090` 显示 public WS 当前 live frame 是 `attachment_superseded`、`session.heartbeat`、`event`、`terminal`；而 `meta(opened)` 是 agent-core internal NDJSON 的概念，不是 public WS attach 路径的 live client frame。
- **为什么重要**：
  - WS 客户端往往会基于 `kind` 写 exhaustive switch；一旦 event taxonomy 写错，前端会把真实帧当未知事件，或错误等待永远不会来的 kind。
  - 这类 drift 比 HTTP 错误码更隐蔽，因为它通常在实时链路里才暴露。
- **审查判断**：
  - `session-ws-v1.md` 当前不能作为前端 WS handler 的生成依据。
- **建议修法**：
  - 以 `packages/nacp-session/src/stream-event.ts` 作为 payload.kind 单一 owner。
  - 在文档里区分清楚：`public WS frame.kind` 与 `event.payload.kind` 是两层枚举，不能混写。

### R4. `/me`、`timeline`、`usage` 文档对读路径与错误语义有多处漂移

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/api-docs/me-sessions.md:98-103` 写“仅返回已 start 的 session（pending 不在列表中）”；但 `workers/orchestrator-core/src/user-do.ts:1733-1804` 明确把 D1 `pending/expired/...` 行合并进 `/me/sessions` 结果。
  - `clients/api-docs/me-sessions.md:264-272` 用的是 `device-not-owned` / `device-not-found` / `no-database`；而 `workers/orchestrator-core/src/index.ts:744-813` 实际返回 `permission-denied` / `not-found` / `worker-misconfigured` / `internal-error`。
  - `clients/api-docs/session.md:299-302` 写 timeline 为 “D1 hot path + D1 为空 fallback RPC + parity merge”；但 `workers/orchestrator-core/src/user-do.ts:1155-1193` 实际是“有 D1 events 就直接返回 D1；否则转 RPC；不存在 merge”。
  - `clients/api-docs/usage.md:56-73` 写 usage 当前多为 null、先读 KV hot snapshot 再 merge D1；但 `workers/orchestrator-core/src/user-do.ts:1220-1256` 与 `workers/orchestrator-core/src/session-truth.ts:822-867` 实际是“先构造 null placeholder，再尝试直接读 D1 usage 聚合；有数据时返回 number，不依赖 KV usage snapshot”。
- **为什么重要**：
  - 这些不是纯文案细节，而是会影响客户端对分页、pending session 可见性、错误分支、usage 展示可信度的判断。
  - 文档如果持续把“来源”写错，后续排障时会把问题错误归因到 KV / hot storage。
- **审查判断**：
  - 这组问题多数属于 stale docs，而不是协议彻底反了；但如果要把 `clients/api-docs` 当成“对外 freeze 版”，这一层也必须修干净。
- **建议修法**：
  - 把 `/me/sessions` 改写为“KV + D1 merge，pending 也可能出现，D1 status 优先”。
  - 把 `/me/devices/revoke` 错误码改成真实 facade code。
  - 把 timeline / usage 的“数据来源”描述改成当前真实实现，不要再写 KV hot usage snapshot。

### R5. `catalog.md` 对 `permission-gate` 的能力描述强于当前真实可用面

- **严重级别**：`low`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/api-docs/catalog.md:51-55` 与 `workers/orchestrator-core/src/catalog-content.ts:43-46` 都把 `permission-gate` 描述成“agent runtime 可发 server frame 等待用户决定”。
  - 但 `clients/api-docs/permissions.md:18-19,149-158` 与 `clients/api-docs/README.md:135-143` 同时明确写着 WS permission / elicitation round-trip 尚未 live。
  - `workers/orchestrator-core/src/user-do.ts:1196-1203` 也把相关 server frame push 标成 future plumbing；当前 live 用户面仍是 HTTP fallback。
- **为什么重要**：
  - catalog 往往会被前端当“能力发现接口”；这里如果把 future-facing 描述写成 live behavior，会让客户端错误打开 UI 开关。
- **审查判断**：
  - 这更像 registry 文案 stale，而不是 route 缺失；但它仍会误导 capability discovery。
- **建议修法**：
  - 把 `permission-gate` 描述降为“decision storage / wait infra partial，public WS round-trip not live；当前使用 HTTP decision path”。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | `README.md` 总索引与 endpoint matrix | `partial` | 主路由面基本齐，但把部分 session / usage 行为写得过强。 |
| S2 | `auth.md` | `stale` | contract、错误码、verify/reset 返回形状与真实 auth 包不符。 |
| S3 | `wechat-auth.md` | `done` | 主体流程、字段约束、502/504 `invalid-wechat-code` 等描述基本符合实现。 |
| S4 | `catalog.md` | `partial` | 响应 shape 基本对，但 `permission-gate` 能力语义过强。 |
| S5 | `me-sessions.md` | `partial` | mint 路径主体正确，但 session list / device revoke 语义与错误码不够准。 |
| S6 | `permissions.md` | `done` | “HTTP-only live、runtime 不等待、best-effort forward” 与代码相符。 |
| S7 | `session.md` | `partial` | `/input`/`/messages` 主体正确，但 `/start` 契约、timeline 行为、common errors 仍漂移。 |
| S8 | `session-ws-v1.md` | `stale` | event taxonomy 明显错位。 |
| S9 | `usage.md` | `stale` | usage 来源与当前 null/number 语义写错。 |
| S10 | `worker-health.md` | `done` | 快照 shape、worker set、status 枚举与实现基本一致。 |

### 3.1 对齐结论

- **done**: `3`
- **partial**: `4`
- **missing**: `0`
- **stale**: `3`
- **out-of-scope-by-design**: `0`

> 这批文档现在更像“骨架已齐、但多个关键 contract 仍未最终校准”的状态，而不是可直接冻结给 client 的权威接口包。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | WS `session.permission.request` round-trip 未 live | `遵守` | `README.md` 与 `permissions.md` 已明确标为未 live，不能把它误判为本轮文档缺口。 |
| O2 | WS `session.elicitation.request` / `session.usage.update` 未 live | `遵守` | 文档多数位置有诚实标注；问题主要在 `catalog.md` 的语义过强。 |
| O3 | R2 file bytes download 未实现 | `遵守` | `README.md`、`session.md` 都把 `/files` 标成 metadata-only。 |
| O4 | device revoke 后 access token 立即失效仍未完成 second-half | `误报风险` | `me-sessions.md:216-218` 已标注当前 access token 在 exp 前仍可用；这不是文档漏报。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`当前 clients/api-docs 不能视为 ZX5 后客户端接口的冻结事实源；需要先修正文档中的 contract drift，并明确 session mint/start 的真实语义。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `重写 auth.md（并同步 README 摘要），以 orchestrator-auth contract 为唯一真相来源。`
  2. `就“/start 是否必须消费 server-mint pending UUID”做收口：修代码 enforce，或修文档承认当前实现。`
  3. `重写 session-ws-v1.md 的 frame.kind / payload.kind taxonomy，并修 usage.md 的真实数据来源说明。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `修正 me-sessions.md / session.md 中关于 pending 可见性、timeline parity、device revoke 错误码的细节。`
  2. `调整 catalog-content / catalog.md 中 permission-gate 的描述强度，避免被前端当成 live capability。`
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码或文档。
