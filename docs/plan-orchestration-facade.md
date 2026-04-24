# Plan Orchestration Facade — Compatibility-First Public Facade over a Private Runtime Mesh

> **状态**：`draft charter (r2 + design pack seeded)`
> **日期**：`2026-04-24`
> **作者**：`GPT-5.4`
> **文档性质**：`phase charter` — public ingress cutover / orchestrator façade / private runtime mesh / internal contract freeze / authority law
>
> **直接输入包（authoritative）**：
> 1. `docs/plan-worker-matrix.md`
> 2. `docs/plan-orchestration-facade-reviewed-by-opus.md`
> 3. `docs/plan-orchestration-facade-reviewed-by-opus-2nd-pass.md`
> 4. `docs/eval/after-foundations/smind-contexter-learnings.md`
> 5. `docs/handoff/after-foundations-to-worker-matrix.md`
> 6. `context/smind-contexter/src/chat.ts`
> 7. `context/smind-contexter/src/engine_do.ts`
> 8. `context/smind-contexter/core/{jwt.ts,db_do.ts}`
> 9. `workers/agent-core/src/host/**`
> 10. `workers/agent-core/wrangler.jsonc`
> 11. `workers/bash-core/src/index.ts`
> 12. `workers/{context-core,filesystem-core}/src/index.ts`
> 13. `test/INDEX.md` + `test/shared/live.mjs`
> 14. owner 2026-04-24 关于 `orchestrator.core` / internal RPC / NACP authority / execution-time truth 的讨论结论

---

## 0. 为什么 r1 之后还要再写 r2

r1 已经把这份文档从一份 vision memo 收紧成了可执行 charter，但 2nd-pass 事实核查确认：**还有 5 个关键真相没有被冻住**，它们会直接影响 F1-F5 的执行质量。

这 5 个真相是：

1. **`orchestrator.core -> agent.core` 的 internal call contract**
   - r1 冻住了 `agent -> orchestrator` stream relay
   - 但没有冻住 `orchestrator -> agent` 的 internal invocation 合约
2. **first-wave tenant identity source truth**
   - 当前 runtime 代码强依赖 `env.TEAM_UUID`
   - 但 r1 又引入 façade 侧 JWT snapshot，需要明确 first-wave 到底以谁为 tenant 真相
3. **`agent.core /sessions/:id/ws` 的最终归属**
   - 它不能再假装是 future internal seam
   - 但 r1 也没有把它 retire / legacy / repurpose 三选一写死
4. **legacy `agent.core` session routes 的 deprecation semantics**
   - 到底是 additive compatibility、redirect、还是 hard fail，r1 没写死
5. **F1 真实已不再是 M**
   - r1 虽然避免了空心 scaffold phase
   - 但 F1 现有责任边界已经接近 `L`

r2 的任务不是改方向，而是把这些未冻结真相补齐，使这份文档真正具备：

> **可机械执行、可产出 F0 design freeze、且不会把关键 tech debt 带进下一阶段**

---

## 1. 已确认的基石事实与 r2 的直接决策

### 1.1 系统目标不变：唯一 public worker = `orchestrator.core`

本阶段的系统目标仍然是：

> **把 nano-agent 从“runtime 直接暴露在外”升级成“public orchestrator + private runtime mesh”。**

这意味着：

1. `orchestrator.core` 是唯一 public HTTP / WebSocket / JWT ingress
2. `agent.core` 是 downstream per-session runtime host
3. `bash.core` / `context.core` / `filesystem.core` 继续作为 internal runtime workers
4. internal-only **不等于**完全没有 HTTP 形状
   - 可以保留 probe
   - 可以保留 fetch-backed service-binding seam
   - 但不再承担新的 client-facing business ingress

### 1.2 当前仓库的精确起点

当前代码事实不是“4-worker 还没形成”，而是：

| worker | 当前真相 | 本阶段结论 |
|---|---|---|
| `agent.core` | live loop、HTTP fallback、WS ingress、verify route、`initial_context` consumer、tenant boundary verify 都已存在 | **当前 public session ingress** |
| `bash.core` | `GET /` / `GET /health` + `/capability/call` + `/capability/cancel` | **已基本 internal-only** |
| `context.core` | probe-only / library-worker posture | **已 internal-only** |
| `filesystem.core` | probe-only / library-worker posture | **已 internal-only** |

因此，本阶段真正需要 inwardize 的不是 4 个 worker 一起做一件事，而是：

> **`agent.core` 的 public session surface 必须被 `orchestrator.core` 接管。**

### 1.3 DO 身份分层已经成立，不重写

1. `orchestrator.core` 采用 **per-user DO**
   - `idFromName(user_uuid)`
2. `agent.core` 继续采用 **per-session DO**
   - `idFromName(session_uuid)`
3. 禁止把 `agent.core` 改成 per-user DO
4. 禁止让 `orchestrator.core` 越权承担 session loop / tool orchestration

这不是妥协，而是正确分层：

- **user-level orchestration**
- **session-level execution**

### 1.4 Internal RPC 的真相：transport 不是安全模型本体

internal transport 只是 transport。  
真正可信的是：

1. **NACP envelope**
2. **`trace_uuid`**
3. **authority payload**
4. **Zod / protocol validation**
5. **执行前的 truth recheck**

因此，本阶段继续采用：

> **fetch-backed service-binding transport as first-wave internal transport**

但必须同时冻结两个方向的 contract：

1. `orchestrator.core -> agent.core` internal invocation contract
2. `agent.core -> orchestrator.core` session stream relay contract

### 1.5 first-wave public surface 继续采用 compatibility-first

first-wave **不**重造全新产品 API，而是保持对外 surface 与当前 session ingress 兼容：

1. `POST /sessions/:session_uuid/start`
2. `POST /sessions/:session_uuid/input`
3. `POST /sessions/:session_uuid/cancel`
4. `GET /sessions/:session_uuid/status`
5. `GET /sessions/:session_uuid/timeline`
6. `POST /sessions/:session_uuid/verify`
7. `GET /sessions/:session_uuid/ws`

但 ownership 要改变：

1. 这些 public routes 的 **canonical owner** 变成 `orchestrator.core`
2. `agent.core` 不再是 canonical public ingress
3. richer façade API 延后到下一阶段

因此 first-wave `orchestrator.core` 的准确定义是：

> **有最小状态、最小 auth、最小 registry、最小 relay、最小 seed 能力的 compatibility façade。**

### 1.6 first-wave tenant identity truth：仍是 single-tenant-per-deploy

这是 r2 明确新增的冻结项。

当前代码事实是：

1. `NanoSessionDO` 在多个核心路径上直接读取 `env.TEAM_UUID`
2. 当前 `workers/agent-core/wrangler.jsonc` 并未显式提供 `TEAM_UUID`
3. 因此 preview 现实仍会掉到 `_unknown` fallback

基于这个真相，first-wave 明确选择：

> **仍采用 single-tenant-per-deploy truth。`TEAM_UUID` 是 serving tenant truth；JWT 的 tenant claim 若存在，必须与之匹配；multi-tenant-per-deploy 延后到下一阶段。**

这意味着：

1. `orchestrator.core` first-wave 不是 multi-tenant routing gateway
2. `agent.core` 不在本阶段改写为 authority-derived tenant source
3. `_unknown` 只能存在于本地/测试兜底，不得作为 preview / prod 的 deploy truth
4. F4.A 必须把 `TEAM_UUID` 显式配置与 reject 纪律写实

### 1.7 first-wave internal contract 分成两个方向，分别冻结

#### `orchestrator.core -> agent.core`

默认采用：

> **service binding + gated `/internal/sessions/...` 路径族 + internal auth header + authority-stamped NACP payload**

#### `agent.core -> orchestrator.core`

默认采用：

> **HTTP streaming response（Readable body）+ NDJSON framing 作为 session stream relay**

这两件事不是同一件事，也不能只冻住其中一边。

### 1.8 `agent.core /sessions/:id/ws` 不是 future internal seam

r2 明确回答：

1. `agent.core /sessions/:id/ws` 是 **legacy public WS ingress**
2. 它**不是** orchestrator 使用的 internal seam
3. `orchestrator.core` 不会对 `agent.core` 发起 worker-to-worker WS
4. 在 first-wave，worker-to-worker stream 只走 HTTP streaming

因此，这条 legacy WS route 的命运是：

> **只允许在 F3 迁移窗口中短暂作为 legacy ingress 存在；F3 exit 之后进入 hard deprecation，不再是工作路径。**

### 1.9 authority law 与 credit/quota domain 继续拆分

本阶段只做：

#### F4.A — 必须完成

1. explicit authority validation layer
2. missing `trace_uuid` / missing `authority` = 非法
3. no-escalation rule
4. Zod-first / protocol-first gating
5. execution-time truth recheck 的 hook point
6. first-wave tenant-source truth 对齐

本阶段明确不做：

#### F4.B — 延后

1. concrete credit ledger
2. quota domain
3. revocation signal fabric
4. billing / settlement / accounting truth source

---

## 2. 当前仓库的代码事实与测试事实

### 2.1 `agent.core` 当前就是 public session ingress

当前代码已经明确证明：

1. `workers/agent-core/src/index.ts`
   - 处理 `GET /` / `GET /health`
   - 再把 `/sessions/:id/...` 路由转给 `SESSION_DO`
2. `workers/agent-core/src/host/routes.ts`
   - 解析 `/sessions/:sessionId/ws`
   - 解析 `/sessions/:sessionId/:action`
3. `workers/agent-core/src/host/http-controller.ts`
   - 提供 `start/input/cancel/end/status/timeline/verify`
4. `workers/agent-core/src/host/ws-controller.ts`
   - 处理 public WS upgrade
5. `workers/agent-core/src/host/do/nano-session-do.ts`
   - 消费 `initial_context`
   - 执行 `verifyTenantBoundary`

**结论：**

`agent.core` 不是“还剩一点外口壳”。  
它就是今天的真实 public session edge。

### 2.2 其余 3 个 workers 的姿势已经收口

| worker | 当前 posture | 本阶段动作 |
|---|---|---|
| `bash.core` | internal capability worker + probe | 基本不改 public posture，只接 F4.A policy 对齐 |
| `context.core` | probe-only / library-worker | 不开放 façade direct binding |
| `filesystem.core` | probe-only / library-worker | 不开放 façade direct binding |

关键纪律：

1. `orchestrator.core` **不**直接 binding `CONTEXT_CORE`
2. `orchestrator.core` **不**直接 binding `FILESYSTEM_CORE`
3. 它们仍由 `agent.core` 统一消费

### 2.3 live E2E 的真实入口分布：不是 35/35 都打 session ingress

`test/INDEX.md` 记录的是 **35 个 live subtests**，但受 façade cutover 直接影响的不是全部。

| 测试族 | 当前入口 | 直接受 façade cutover 影响吗 |
|---|---|---|
| `package-e2e/agent-core` | `/sessions/:id/...` + probe | **是** |
| `package-e2e/bash-core` | `/capability/call` / `/capability/cancel` + probe | 否 |
| `package-e2e/context-core` | probe + `/runtime -> 404` | 否 |
| `package-e2e/filesystem-core` | probe + `/runtime -> 404` | 否 |
| `cross-e2e/02/03/04/05/06/08/09` | 经 `agent-core /sessions/:id/...` 驱动 | **是** |
| `cross-e2e/01/10` | probe / topology / concurrency | 否 |
| `cross-e2e/07` | `context-core` / `filesystem-core` `/runtime -> 404` | 否 |

因此，F3 的真实工作量是：

1. `agent-core` package-e2e 子集
2. 受 session ingress 驱动的 cross-e2e 子集
3. `test/INDEX.md`
4. `test/shared/live.mjs` 与 JWT harness
5. 相关 preview / README / docs truth

这仍然是 `L` 级，但边界必须诚实。

### 2.4 当前 tenant-source 现实是一个必须被收口的技术债

当前代码事实：

1. `NanoSessionDO` 在 ingress、trace、checkpoint、ws helper、cross-seam anchor 等路径都读取 `env.TEAM_UUID`
2. `workers/agent-core/wrangler.jsonc` 当前没有显式 `TEAM_UUID`
3. 因此 `_unknown` fallback 目前是真实存在的

本阶段不能再把这件事留成隐性前提。  
r2 选择的做法是：

> **不在本阶段做 tenant-source migration；而是先把 first-wave tenant truth 写死为 single-tenant-per-deploy，并要求显式配置 `TEAM_UUID`。**

### 2.5 当前仓库缺的不是想法，而是 7 个必须冻结的真相层

| gap | 当前状态 | 本阶段必须补什么 |
|---|---|---|
| public façade | 不存在 | `workers/orchestrator-core/` |
| user-level session registry | 不存在 | per-user DO first-wave schema |
| `session_uuid` owner | 不存在统一 owner | façade mint + lifecycle law |
| `orchestrator -> agent` internal invocation | 不存在冻结 contract | gated internal route family |
| `agent -> orchestrator` stream relay | 不存在冻结 contract | HTTP streaming relay memo |
| first-wave tenant-source truth | 代码依赖 `TEAM_UUID`，但 deploy truth 未冻结 | single-tenant-per-deploy freeze |
| concrete contexter absorption inventory | 不存在 | adopt / adapt / defer / discard 清单 |

---

## 3. 本阶段的一句话目标

> **建立一个 compatibility-first 的 `orchestrator.core`，让它成为唯一 canonical public session façade；它负责 JWT → authority、per-user registry、`session_uuid` minting、`initial_context` seed 生产与 stream relay，而现有 4-worker runtime 继续作为 private mesh 存在，并通过被冻结的 internal contract 与 façade 连接。**

---

## 4. First-wave `orchestrator.core` 的具体定义

### 4.1 它 first-wave 到底做什么

first-wave `orchestrator.core` **不是**：

- full user-memory engine
- full CRM gateway
- credit / billing service
- generic super-router

first-wave `orchestrator.core` **必须**至少做 7 件具体的事：

1. **public auth gateway**
   - JWT verify
   - trace injection
   - user / realm / source_name 解包
   - tenant claim 与 deploy `TEAM_UUID` 对齐
2. **session_uuid minting authority**
   - 为 canonical new session 生成 UUIDv4
   - 负责 attach / reconnect 的 lookup 基准
3. **per-user active session registry**
   - 记录 user 当前活跃 / 最近 session
4. **compatibility session façade**
   - 对外继续提供 `/sessions/:session_uuid/...`
5. **`initial_context` seed 生产**
   - 从 JWT claims、tenant defaults、client hints 组出 first-wave seed
6. **stream relay**
   - 消费 downstream session stream，并 relay 给 client WS
7. **attach / reconnect owner**
   - client 断线重连必须先过 `orchestrator.core`

换句话说：

> **first-wave `orchestrator.core` 是“auth + registry + mint + seed + relay + reconnect”的最小非空 façade。**

### 4.2 first-wave user DO 的最小持久化 schema

first-wave 默认选择：

> **DO storage key-value / structured object store**

而**不**直接吸收 contexter 的 SQLite manager。

建议最小 schema：

| 字段 | 类型 | 用途 | first-wave 必要性 |
|---|---|---|---|
| `user_uuid` | string | DO identity truth | 必需 |
| `active_sessions` | `Map<session_uuid, { created_at, last_seen_at, status, last_phase?, relay_cursor?, ended_at? }>` | attach / reconnect / bounded recent-ended metadata | 必需 |
| `last_auth_snapshot` | `{ sub, realm?, tenant_uuid?, membership_level?, source_name?, exp? }` | identity / authority cache | 必需 |
| `initial_context_seed` | `{ realm_hints?, source_name?, default_layers?, user_memory_ref? }` | first-wave seed builder input | 必需 |

明确不纳入 first-wave：

1. full user-memory
2. conversation history archive
3. credit ledger
4. user preference / profile domain
5. vector retrieval state

### 4.3 `session_uuid` lifecycle truth

first-wave 默认规则：

1. **minting owner**：`orchestrator.core`
2. **格式**：UUIDv4
3. **canonical new session** 只能由 façade 发起
4. `agent.core` internal contract 不接受“来自公网 client 的新 session start”

建议 lifecycle 表：

| 阶段 | owner | 状态变化 | 说明 |
|---|---|---|---|
| `minted` | `orchestrator.core` | 生成 `session_uuid`，写入 user DO registry | 尚未启动 runtime |
| `starting` | `orchestrator.core -> agent.core` | 通过 internal contract 发出 `start` | canonical start path |
| `active` | `agent.core` + registry | runtime 进入运行态 | session stream flowing |
| `detached` | `orchestrator.core` | client 断线但 runtime 可能仍活着 | reconnect 可恢复 |
| `reattached` | `orchestrator.core` | client 重新接回 relay | registry 更新 cursor |
| `ended` | `agent.core` + registry | session 结束 | 可保留最近历史 |

### 4.4 reconnect 语义必须显式设计

first-wave reconnect 必须回答：

1. 用户断 WS 后，user DO 如何找到 `active_sessions`
2. orchestrator 如何根据 registry cursor 重建 relay
3. session 已结束时，返回什么 typed result
4. 是否允许 multiple tabs / multiple attachments

first-wave 的默认建议是：

> **single active writable attachment**

也就是：

1. 同一 session 同时只允许一个活跃写入 attachment
2. 新 attachment 到来时，可接管并 supersede 旧 attachment
3. richer multi-tab / read-only mirror 行为留到下一阶段

因此 F0 必须产出：

> `F0-session-lifecycle-and-reconnect.md`

### 4.5 first-wave 明确不做什么

1. 不做 richer public product API
2. 不做 full history / memory / retrieval
3. 不做 tenant-source migration
4. 不做 credit / quota / revocation domain
5. 不做 direct context/filesystem façade routing

---

## 5. Contexter 吸收清单（concrete absorption inventory）

### 5.1 总原则

我们不是“吸收 contexter 整个系统”，而是采用四分法：

1. **adopt-as-is**
2. **adapt-pattern**
3. **defer**
4. **discard**

### 5.2 逐文件 inventory

| contexter 文件 / 模块 | label | first-wave 处理方式 |
|---|---|---|
| `core/jwt.ts` | **adopt-as-is (light adaptation)** | 迁入 `orchestrator-core/src/adapters/jwt.ts` 或等价位置 |
| `src/chat.ts::withTrace` | **adapt-pattern** | 改写为 façade trace middleware |
| `src/chat.ts::withAuth` | **adapt-pattern** | 改写为 façade JWT middleware |
| `src/chat.ts::getUserDOStub` | **adapt-pattern** | 保留 `idFromName(user_uuid)` 模式 |
| `src/chat.ts::wrapInCicp` | **discard-as-code / keep-as-idea** | 保留“ingress wrap”思想，但改写为 NACP 版本 |
| `src/engine_do.ts` 的 WS sessions map / upgrade 结构 | **adapt-pattern** | 作为 user DO client attachment 管理参考 |
| `core/db_do.ts` | **defer** | first-wave 不吸收；是否引入 SQLite 留下阶段 |
| `core/alarm.ts` | **defer** | first-wave 不需要 alarm-driven compaction |
| `core/broadcast.ts` | **adapt-pattern** | 为 relay / multi-attachment 提供参考 |
| `core/schemas_cicp.ts` | **discard** | NACP 才是协议真相 |
| `context/*` | **discard** | 属于 contexter 业务编排，不属于 façade |
| `ai/*` | **discard** | 同上 |
| `rag/*` | **discard** | 同上 |

### 5.3 为什么 first-wave 不吸收 `db_do.ts`

`core/db_do.ts` 解决的是：

- conversations
- chats
- contexts
- vec history / vec intents

这些都不是 first-wave façade 的刚需。  
如果现在吸进去，等于偷渡了一个完整 user-memory / history domain。

因此本阶段的正确动作是：

> **先把 façade 真立起来，再在下一阶段讨论是否需要 SQLite-backed richer user substrate。**

---

## 6. r2 新增的关键冻结：internal contract / tenant truth / legacy semantics

### 6.1 `orchestrator.core -> agent.core` internal invocation contract

这是 r2 必须补上的核心冻结项。

#### 默认路径族

first-wave 默认采用新的 gated internal route family：

1. `POST /internal/sessions/:session_uuid/start`
2. `POST /internal/sessions/:session_uuid/input`
3. `POST /internal/sessions/:session_uuid/cancel`
4. `GET /internal/sessions/:session_uuid/status`
5. `GET /internal/sessions/:session_uuid/timeline`
6. `POST /internal/sessions/:session_uuid/verify`
7. `GET /internal/sessions/:session_uuid/stream`

默认**不**复用现有 public `/sessions/:id/...` 作为 internal target。

#### 默认认证机制

first-wave internal invocation 采用三层要求：

1. **transport**
   - orchestrator 通过 service binding 调 `agent.core`
2. **route gate**
   - `/internal/*` 路径不作为 public client contract 发布
3. **request auth**
   - 必须带 shared internal auth header
   - 必须带 orchestrator 已翻译好的 authority / trace / session context

换句话说：

> **internal contract 不是“没有 JWT，所以什么都不要验”；而是“JWT 只在 orchestrator 验一次，agent 接收的是 gated + authority-stamped internal request”。**

#### agent.core 在 internal call 上必须做什么

1. 先验证 internal auth header
2. 再验证 trace / authority / tenant legality
3. 不重复做 public JWT 校验
4. 不允许 internal call 提权

### 6.2 `agent.core -> orchestrator.core` stream relay contract

first-wave 默认采用：

> **HTTP streaming response（Readable body）+ NDJSON framing**

理由：

1. 与现有 fetch transport 一致
2. 不引入 big-bang transport rewrite
3. 不要求 worker-to-worker WS
4. 适合 `session.start` / `input` 之后的连续事件输出

F0 必须冻结：

1. chunk / framing shape
2. relay cursor / reconnect cursor
3. cancel / end / timeout 的流结束语义
4. orchestrator user DO 如何把后端流映射到 client WS

first-wave 的默认 framing 建议是：

1. `Content-Type: application/x-ndjson`
2. `meta` / `event` / `terminal` 三类 frame
3. terminal 不能只靠 EOF 推断，必须有 explicit terminal frame

### 6.3 `agent.core /sessions/:id/ws` 的 fate

r2 明确回答：

1. 这条 WS route 只属于 **legacy public ingress**
2. 它不会成为 orchestrator 的 internal seam
3. 它不会被 repurpose 成 worker-to-worker WS
4. F3 执行期间允许短暂保留，作为迁移窗口中的 legacy path
5. F3 exit 之后，它进入 **hard deprecation**

因此，r2 不接受“先不回答，等实现时再看”。

### 6.4 legacy `agent.core` session routes 的 deprecation semantics

r2 选择的不是“永久 additive compatibility”，而是：

> **bounded migration overlap inside F3, followed by hard deprecation at F3 exit。**

也就是说：

#### F3 执行期间

1. 可短暂允许 legacy `/sessions/:id/...` 继续工作
2. 必须返回 `Deprecation` / `Sunset` 信息
3. 其唯一作用是给测试 / harness / docs migration 留出落地窗口

#### F3 exit 之后

1. legacy HTTP session routes 返回 typed `410 Gone`
2. legacy WS handshake 不再升级，返回 typed deprecation rejection
3. canonical docs / tests / harness 不再使用它们

这条冻结是 r2 的关键决策，因为它保证：

1. `session_uuid` minting owner 不会长期双轨
2. “唯一 canonical public ingress = orchestrator.core” 成为真实系统事实
3. legacy ingress 不会长期留成半死不活的 tech debt

### 6.5 first-wave tenant truth 的具体纪律

first-wave tenant law 写成下面四条：

1. `TEAM_UUID` 是 serving tenant truth
2. preview / prod 必须显式配置 `TEAM_UUID`
3. JWT 若带 `tenant_uuid` claim，则必须与 `TEAM_UUID` 一致，否则 reject
4. multi-tenant-per-deploy 与 authority-derived tenant source migration 明确延后

这意味着：

1. `orchestrator.core` first-wave 仍是 per-tenant deploy
2. 当前 runtime 不需要在本阶段把 tenant verify 根逻辑从 env 迁到 authority
3. F4.A 只需把“显式配置 + 拒绝不一致 claim”写实

---

## 7. 本阶段边界：In-Scope / Out-of-Scope

### 7.1 In-Scope（本阶段必须完成）

| 编号 | 工作项 | 归属 Phase |
|---|---|---|
| I1 | 冻结 compatibility-first façade strategy | F0 |
| I2 | 冻结 first-wave tenant-source truth（single-tenant-per-deploy） | F0 / F4.A |
| I3 | 冻结 `orchestrator -> agent` internal binding contract | F0 |
| I4 | 冻结 `agent -> orchestrator` stream relay contract | F0 |
| I5 | 冻结 contexter absorption inventory | F0 |
| I6 | 冻结 first-wave user DO schema | F0 |
| I7 | 冻结 `session_uuid` lifecycle / reconnect semantics | F0 |
| I8 | 建立 `workers/orchestrator-core/` + user DO + JWT middleware | F1 |
| I9 | 打通最小 roundtrip：public start -> orchestrator -> agent -> first event back | F1 |
| I10 | 完成 public WS / attach / reconnect / `initial_context` / input / cancel / verify / status / timeline | F2 |
| I11 | 完成 affected live E2E / docs / harness migration | F3 |
| I12 | 将 `agent.core` legacy public session routes hard deprecate | F3 |
| I13 | 建立 F4.A authority hardening：explicit policy layer + no-escalation + tenant truth alignment | F4 |
| I14 | 产出 final closure / handoff / next-phase inputs | F5 |

### 7.2 Out-of-Scope（本阶段明确不做）

| 编号 | 项目 | 为什么不做 |
|---|---|---|
| O1 | 重造全新 public product API | first-wave 先做 compatibility façade |
| O2 | multi-tenant-per-deploy | 与当前 runtime tenant truth 冲突太大 |
| O3 | full user-memory / history / retrieval domain | 与 façade cutover 正交 |
| O4 | concrete credit ledger / quota / billing domain | 属于下一阶段 |
| O5 | WorkerEntrypoint RPC / custom transport rewrite | first-wave fetch transport 足够 |
| O6 | `orchestrator.core` 直接 binding `CONTEXT_CORE` / `FILESYSTEM_CORE` | 防止 façade 变成超级路由器 |
| O7 | 第 6+ worker（skill / browser / billing / reranker） | 先把 5-worker topology 闭合 |
| O8 | 删除 probe surfaces | preview / diagnostics 仍需要 |

### 7.3 必须写进 charter 的纪律

1. `orchestrator.core` 是唯一 canonical public HTTP / WS ingress
2. internal workers 不得新增新的 client-facing business routes
3. `agent.core` 唯一允许新增的 route family 是 **gated `/internal/*` contract**
4. `orchestrator.core` 不直接调用 `context.core` / `filesystem.core`
5. `agent.core` 的 legacy public session routes 不得成为长期兼容路径
6. `TEAM_UUID` 必须成为显式 deploy truth，而不是 `_unknown` 式隐性 fallback

---

## 8. 5 个 workers 的 charter-level 定位

### 8.1 `orchestrator.core` — Compatibility-First Public Facade

- **目录 / 包**：`workers/orchestrator-core/` / `@haimang/orchestrator-core-worker`
- **身份**：唯一 canonical public session façade
- **DO 粒度**：per-user
- **first-wave 具体职责**：
  1. JWT verify
  2. trace injection
  3. authority translation
  4. tenant-claim vs `TEAM_UUID` alignment
  5. `session_uuid` minting
  6. active session registry
  7. compatibility session routes
  8. `initial_context` seed 生产
  9. stream relay
  10. attach / reconnect

- **明确不承担**：
  1. session loop / turn loop
  2. checkpoint / restore of runtime internals
  3. direct context/filesystem capability execution
  4. richer memory / RAG / billing domain

### 8.2 `agent.core` — Internal Session Runtime Host

- **身份**：downstream per-session runtime
- **继续承担**：
  1. session loop / turn loop
  2. checkpoint / restore / replay
  3. tool orchestration
  4. timeline / hook / eval emission
  5. `context.core` / `filesystem.core` / `bash.core` consumption

- **本阶段对它的变化**：
  1. canonical public ingress 被 `orchestrator.core` 接管
  2. 新增 gated `/internal/*` contract
  3. legacy public `/sessions/*` 在 F3 exit 后 hard deprecate
  4. 保留 probe

### 8.3 `bash.core` — Internal Capability Worker

- **身份**：governed fake-bash worker
- **本阶段重点**：
  1. posture 基本不变
  2. 与 F4.A authority policy 对齐
  3. execution-time truth-recheck hook 放在 `CapabilityExecutor`

### 8.4 `context.core` — Internal Context Worker

- **身份**：internal context substrate
- **本阶段重点**：
  1. 继续由 `agent.core` 消费
  2. 承接 façade 注入的 `initial_context`
  3. 不与 orchestrator 形成 direct binding

### 8.5 `filesystem.core` — Internal Workspace / Storage Worker

- **身份**：internal workspace / storage substrate
- **本阶段重点**：
  1. posture 基本不变
  2. 继续由 `agent.core` 统一消费
  3. 不与 orchestrator 形成 direct binding

---

## 9. 本阶段的方法论

### 9.1 Compatibility Before Productization

先把 public ownership 从 `agent.core` 挪到 `orchestrator.core`，再讨论 richer product façade。  
first-wave 不在 cutover 阶段重造整套 public API。

### 9.2 Concrete Freeze Before Implementation

写 façade 代码前，先把以下真相层冻结：

1. compatibility contract
2. tenant-source truth
3. internal binding contract
4. stream relay contract
5. user DO schema
6. session lifecycle / reconnect
7. contexter absorption inventory

### 9.3 Stream Reality, Not Request-Only Fantasy

session seam 不是普通 request/response。  
必须把：

- public WS
- internal stream
- reconnect
- relay cursor
- cancel / end stream shutdown

一起设计。

### 9.4 Inwardize One Worker Honestly

本阶段真正 inwardize 的是 `agent.core`。  
不要用“5-worker inwardization”这类口号掩盖真实工作量。

### 9.5 Freeze Law Now, Build Domain Later

authority / tenant / no-escalation / truth-recheck 的法律现在就冻住。  
credit / quota / revocation domain 留到下一阶段。

### 9.6 Canonical Cutover Must Finish

本阶段允许迁移窗口，但不接受“legacy agent ingress 永久活着”。  
F3 exit 必须把 canonical public ingress 真正切干净。

---

## 10. Phase 规划

### 10.1 Phase 总表

| Phase | 名称 | 目标一句话 | 预估工作量 | 依赖前序 |
|---|---|---|---|---|
| **F0** | Concrete Freeze Pack | 冻结 façade strategy、tenant truth、internal contract、stream contract、schema、reconnect | `S` | worker-matrix stable |
| **F1** | Orchestrator Bring-up + First Roundtrip | 建出 façade worker、user DO、internal contract，并打通最小 `start -> first event` roundtrip | `L` | F0 |
| **F2** | Session Seam Completion | 完成 public WS、attach / reconnect / seed / input / cancel / verify / status / timeline 全链路 | `M` | F1 |
| **F3** | Canonical Cutover + Legacy Retirement | 迁移 affected live E2E / docs / harness，并让 `agent.core` legacy session routes hard deprecate | `L` | F2 |
| **F4** | Authority Policy Hardening (A only) | 把 authority / tenant law 收口为 explicit policy layer，并留下 truth-recheck seam | `S` | F0 + F1 |
| **F5** | Closure & Handoff | 完成 final verification、closure、handoff 与下阶段触发包 | `M` | F3 + F4 |

### 10.2 推进原则

1. **F1 明确按 `L` 处理**
2. **F3 也是 `L`**
3. **F4 只做 A，不偷渡 B**
4. **F4 可在 late F1 / F2 之后部分并行**
5. **Exit-level 成果必须包含 internal call contract freeze**

### 10.3 推荐 sub-phase

1. **F0.A** compatibility façade + tenant truth freeze
2. **F0.B** internal binding contract freeze
3. **F0.C** stream relay + legacy WS disposition freeze
4. **F0.D** contexter absorption inventory
5. **F0.E** user DO schema freeze
6. **F0.F** session lifecycle + reconnect memo
7. **F0.G** affected live E2E migration inventory
8. **F1.A** `workers/orchestrator-core/` scaffold
9. **F1.B** JWT / trace middleware + user DO routing
10. **F1.C** internal `start` / `cancel` route implementation + auth gate + session minting
11. **F1.D** public `start -> internal start -> first event relay`
12. **F2.A** public WS + attach / reconnect
13. **F2.B** `initial_context` seed production
14. **F2.C** input / cancel / verify / status / timeline + stream stabilization
15. **F3.A** affected tests / harness / docs migration
16. **F3.B** flip canonical ingress to orchestrator
17. **F3.C** hard deprecate `agent.core` legacy session routes
18. **F4.A1** explicit authority policy helper + tenant truth alignment
19. **F4.A2** capability executor recheck seam + negative tests
20. **F5.A** final live topology verification
21. **F5.B** final closure + handoff

---

## 11. 各 Phase 详细说明

### 11.1 F0 — Concrete Freeze Pack

#### 实现目标

把所有会在 F1-F5 引起歧义的基础问题，在设计层先写成 truth layer。

#### In-Scope

1. compatibility façade contract
2. first-wave tenant-source truth
3. `orchestrator -> agent` internal binding contract
4. `agent -> orchestrator` stream relay mechanism
5. legacy `agent.core` WS / HTTP session routes 的 fate
6. contexter absorption inventory
7. first-wave user DO schema
8. `session_uuid` lifecycle / reconnect memo
9. affected live E2E migration inventory

#### 交付物

1. `docs/design/orchestration-facade/F0-compatibility-facade-contract.md`
2. `docs/design/orchestration-facade/F0-agent-core-internal-binding-contract.md`
3. `docs/design/orchestration-facade/F0-stream-relay-mechanism.md`
4. `docs/design/orchestration-facade/F0-contexter-absorption-inventory.md`
5. `docs/design/orchestration-facade/F0-user-do-schema.md`
6. `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md`
7. `docs/design/orchestration-facade/F0-live-e2e-migration-inventory.md`

#### 收口标准

1. compatibility-first 是否继续采用，已写死
2. first-wave tenant truth 是否仍是 single-tenant-per-deploy，已写死
3. `orchestrator -> agent` internal path / auth / authority passing convention 已写死
4. `agent -> orchestrator` stream relay framing 已写死
5. legacy `agent.core` public session routes 的 final semantics 已写死

### 11.2 F1 — Orchestrator Bring-up + First Roundtrip

#### 实现目标

建立 `workers/orchestrator-core/`，并打通一个真正可验证的最小 roundtrip：

> public start -> orchestrator -> internal start -> agent -> first event -> orchestrator relay

#### In-Scope

1. 建立 `workers/orchestrator-core/`
2. `@haimang/orchestrator-core-worker`
3. JWT middleware / trace middleware
4. user DO shell
5. façade `start` route
6. internal binding client（至少覆盖 `start` / `cancel`）
7. `session_uuid` minting
8. first roundtrip relay

#### 交付物

1. `workers/orchestrator-core/**`
2. first preview deploy URL
3. integration test：new session via internal call
4. integration test：session cancel via internal call
5. `docs/issue/orchestration-facade/F1-closure.md`

#### 收口标准

1. `orchestrator-core` preview deploy 成功
2. JWT + user DO routing smoke 通过
3. `session.start -> first event` roundtrip 跑通
4. `orchestrator -> agent` internal call 不再是 ad-hoc fetch 胶水

### 11.3 F2 — Session Seam Completion

#### 实现目标

把 façade 对 runtime 的 session seam 从“能起一个 start”扩成完整 first-wave 生命周期。

#### In-Scope

1. public WS
2. attach
3. reconnect
4. `initial_context` seed 生产
5. `input`
6. `cancel`
7. `status`
8. `timeline`
9. `verify`
10. stream relay stabilization

#### 交付物

1. public WS implementation
2. reconnect design-backed implementation
3. seed builder
4. session seam integration code
5. `docs/issue/orchestration-facade/F2-closure.md`

#### 收口标准

1. first-wave session lifecycle 可完全通过 `orchestrator.core` 驱动
2. `initial_context` seed 真正进入 runtime
3. attach / reconnect / cancel 至少各有一条可验证 live path

### 11.4 F3 — Canonical Cutover + Legacy Retirement

#### 实现目标

把 affected external session traffic 与对应 live verification，从 `agent.core` 迁到 `orchestrator.core`，并结束 legacy session ingress。

#### In-Scope

##### F3.A — migration

1. 迁移 affected live E2E
2. 更新 `test/INDEX.md`
3. 引入或完善 JWT test harness
4. 更新相关 docs / preview truth

##### F3.B — canonical cutover

5. `orchestrator.core` 成为唯一 canonical public session ingress
6. `agent.core` 不再被默认视为 public app ingress

##### F3.C — legacy retirement

7. `agent.core` legacy HTTP session routes 返回 typed `410 Gone`
8. `agent.core` legacy WS session route 不再升级
9. 继续保留 probe

#### 交付物

1. migrated live E2E subset
2. updated `test/INDEX.md`
3. updated live harness / JWT helpers
4. hard deprecation responses on legacy `agent.core` session surface
5. `docs/issue/orchestration-facade/F3-closure.md`

#### 收口标准

1. affected live tests 不再默认直打 `agent.core`
2. canonical docs / harness / preview truth 都以 orchestrator 为入口
3. `agent.core` legacy session routes 已 hard deprecate

### 11.5 F4 — Authority Policy Hardening (A only)

#### 实现目标

把已存在但分散的 authority / tenant / validation 纪律，收口成 explicit policy layer，并为 future truth recheck 留 hook。

#### In-Scope

1. missing `trace_uuid` / `authority` -> reject
2. no-escalation rule
3. Zod-first / protocol-first gating
4. explicit policy helper
5. first-wave tenant truth alignment
6. `CapabilityExecutor` recheck hook point
7. negative tests

#### 明确不在本 phase 做

1. concrete credit ledger
2. concrete quota service
3. revocation signal fabric
4. billing domain schema

#### 交付物

1. authority policy helper
2. tenant truth memo / config alignment
3. executor recheck seam
4. negative tests
5. `docs/issue/orchestration-facade/F4-closure.md`

#### 收口标准

1. authority law 不再只是分散实现
2. missing authority / escalation / tenant mismatch 均有测试
3. execution-time truth recheck 的 integration point 已存在

### 11.6 F5 — Closure & Handoff

#### 实现目标

把 façade-cutover phase 正式闭合，并为 richer orchestrator / memory / credit 下一阶段准备输入包。

#### In-Scope

1. final live topology verification
2. internal contract verification
3. closure docs
4. handoff docs
5. next-phase trigger pack

#### 交付物

1. `docs/issue/orchestration-facade/orchestration-facade-final-closure.md`
2. `docs/handoff/orchestration-facade-to-<next>.md`
3. `docs/issue/orchestration-facade/F5-closure.md`

#### 收口标准

1. façade topology 真实可跑
2. affected live suite 已 green
3. internal call contract 有冻结文档与验证
4. next-phase inputs 已整理

---

## 12. Owner decisions（本 draft 的默认答案）

### Q1 — 谁 mint `session_uuid`

- **默认答案**：`orchestrator.core`
- **格式**：UUIDv4
- **理由**：
  - 与当前 harness / WS UUID gate 一致
  - session registry 应归 façade 所有

### Q2 — first-wave public protocol 选什么

- **默认答案**：compatibility-first
- **具体形状**：沿用 `/sessions/:session_uuid/...` + `/sessions/:session_uuid/ws`
- **理由**：
  - 迁移测试 / harness 成本最低
  - 不把 façade cutover 与 public API 重造绑一起

### Q3 — first-wave user DO 存什么

- **默认答案**：只存 registry / auth snapshot / seed，不存 full memory
- **理由**：
  - 保证 orchestrator 非空
  - 又不偷渡 richer memory domain

### Q4 — contexter 哪些东西值得拿

- **默认答案**：
  - `core/jwt.ts` -> adopt
  - `chat.ts` middleware -> adapt
  - `engine_do.ts` 的 ws/session attachment 模式 -> adapt
  - `db_do.ts` -> defer
  - `CICP` / `context/*` / `ai/*` / `rag/*` -> discard

### Q5 — first-wave tenant source 选什么

- **默认答案**：single-tenant-per-deploy
- **具体纪律**：
  - `TEAM_UUID` 是 serving tenant truth
  - preview / prod 必须显式配置 `TEAM_UUID`
  - JWT 若带 tenant claim，必须与 `TEAM_UUID` 一致
- **理由**：
  - 与当前 runtime 代码真相一致
  - 避免本阶段同时触发全域 multi-tenant migration

### Q6 — internal call contract 用什么形状

- **默认答案**：gated `/internal/sessions/...` 路径族
- **认证**：service binding + shared internal auth header + authority-stamped request
- **理由**：
  - 不复用 legacy public routes
  - 为下一阶段 richer orchestrator 留下可复用 internal API

### Q7 — stream relay 用什么机制

- **默认答案**：HTTP streaming response
- **说明**：这是 first-wave 执行决策，不是假装它是唯一平台真理

### Q8 — legacy `agent.core /sessions/:id/ws` 怎么处理

- **默认答案**：只在 F3 迁移窗口短暂保留，F3 exit 后 hard deprecate
- **理由**：
  - 它不是 future internal seam
  - canonical ingress 必须真正切到 orchestrator

### Q9 — deprecation window 的具体语义是什么

- **默认答案**：
  - 迁移窗口只存在于 F3 执行期
  - F3 exit 之后 legacy session routes 进入 hard deprecation
- **理由**：
  - 避免 dual-ingress 长期并存
  - 保住 `session_uuid` 单一 owner

### Q10 — credit / quota enforcement first-wave 做到哪

- **默认答案**：
  - 本阶段做 law + hook points + negative tests
  - ledger / quota / revocation 域留到下一阶段

---

## 13. 测试与验证策略

### 13.1 六层结构

1. worker unit tests
2. worker-local integration tests
3. orchestrator -> agent internal contract tests
4. stream relay / reconnect tests
5. affected live E2E migration tests
6. authority / tenant negative tests

### 13.2 affected live suite 的迁移策略

必须区分三类：

| 类别 | 处理方式 |
|---|---|
| 以 `agent-core /sessions/:id/...` 为入口的 tests | **迁移到 `orchestrator.core`** |
| `bash-core` package-e2e | 保留为 internal verification |
| `context/filesystem` package-e2e + probe topology tests | 保留 |

### 13.3 本阶段必须具备的 11 条验证

1. JWT invalid / missing -> reject
2. façade mint `session_uuid`
3. user DO registry 能 lookup / update / expire session
4. **new session via internal call** integration test
5. **session cancel via internal call** integration test
6. first event relay over HTTP streaming seam
7. public WS attach / reconnect
8. `initial_context` seed 到达 runtime
9. `verify` / `status` / `timeline` 通过 façade 可用
10. legacy `agent.core` session routes hard deprecation
11. authority / tenant mismatch / escalation negative cases

### 13.4 不能遗漏的一条测试纪律

> **受 façade cutover 影响的现有 live E2E，必须被显式迁移，或被显式保留为 internal verification suite。**

不允许留下 ghost tests。

---

## 14. 风险与依赖

| 风险 | 描述 | 应对 |
|---|---|---|
| façade 空心化 | 只有 worker 壳，没有 registry / relay / seed 价值 | F1 必须交付 first roundtrip |
| internal contract 漂移 | orchestrator 与 agent 继续靠 ad-hoc fetch 胶水连接 | F0 单独冻结 internal binding contract |
| tenant truth 模糊 | `TEAM_UUID` 缺失或 JWT tenant claim 与 deploy truth 不一致 | F0/F4.A 明确 single-tenant law |
| stream relay 返工 | 机制未冻住就开始写代码 | F0 强制产出 relay memo |
| cutover 低估 | 迁移测试 / harness / docs 的工作量被忽略 | F3 明确按 `L` 级执行 |
| contexter 偷渡 | 不小心把 SQLite / CICP / RAG 一起带进来 | F0 inventory 先冻住 |
| F4 scope 膨胀 | façade 阶段顺手开始造 credit/billing 域 | F4.B 明确 deferred |

---

## 15. 本阶段的退出条件

### 15.1 Primary Exit Criteria（7 条硬闸）

1. **`workers/orchestrator-core/` 已存在并 preview deploy 成功**
2. **`orchestrator.core` 已成为唯一 canonical public HTTP / WS ingress**
3. **first-wave user DO schema 已落地，并承载 active session registry**
4. **`session_uuid` minting / reconnect / stream relay 机制已实现并被验证**
5. **F4.A authority hardening 已完成，tenant truth 已冻结，execution-time recheck hook 已存在**
6. **受 façade cutover 影响的 live tests / harness / docs 已显式迁移或显式保留**
7. **`orchestrator.core -> agent.core` internal call contract 已冻结，并至少有 2 个 integration tests 覆盖 `new session` + `cancel`**

### 15.2 Secondary Outcomes

1. contexter 可吸收面被正式冻结
2. `agent.core` legacy public session surface 已 hard deprecate
3. next-phase richer orchestrator / memory / credit charter inputs 已齐备

### 15.3 NOT-成功退出识别

1. `orchestrator.core` 只是空 proxy
2. `agent.core` 仍被默认视为 canonical public ingress
3. user DO 没有 registry truth
4. `session_uuid` lifecycle 没有明确 owner
5. stream relay 仍未明确机制
6. 受影响的现有 live E2E 没有显式迁移 / 保留策略
7. `orchestrator -> agent` 仍是一段未冻结的 ad-hoc fetch 胶水

---

## 16. 下一阶段触发条件

当本阶段闭合后，才适合进入这些更厚的议题：

1. **richer orchestrator public surface**
2. **multi-tenant-per-deploy / tenant-source migration**
3. **full user-memory / history / retrieval domain**
4. **credit / quota / revocation charter**
5. **shared Cloudflare adapters / substrate 抽取**
6. **skill / browser / billing / reranker workers**

---

## 17. 后续文档生产清单

### 17.1 Design 文档

1. `docs/design/orchestration-facade/F0-compatibility-facade-contract.md`
2. `docs/design/orchestration-facade/F0-agent-core-internal-binding-contract.md`
3. `docs/design/orchestration-facade/F0-stream-relay-mechanism.md`
4. `docs/design/orchestration-facade/F0-contexter-absorption-inventory.md`
5. `docs/design/orchestration-facade/F0-user-do-schema.md`
6. `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md`
7. `docs/design/orchestration-facade/F0-live-e2e-migration-inventory.md`
8. `docs/design/orchestration-facade/F4-authority-policy-layer.md`

### 17.2 Action-Plan 文档

1. `docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`
2. `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`
3. `docs/action-plan/orchestration-facade/F2-session-seam-completion.md`
4. `docs/action-plan/orchestration-facade/F3-canonical-cutover-and-legacy-retirement.md`
5. `docs/action-plan/orchestration-facade/F4-authority-hardening.md`
6. `docs/action-plan/orchestration-facade/F5-closure-and-handoff.md`

### 17.3 Closure / Handoff 文档

1. `docs/issue/orchestration-facade/F{0-5}-closure.md`
2. `docs/issue/orchestration-facade/orchestration-facade-final-closure.md`
3. `docs/handoff/orchestration-facade-to-<next>.md`

### 17.4 QNA 文档

1. `docs/design/orchestration-facade/FX-qna.md`

---

## 18. 附加章节：Design 需求与 Action-Plan 需求的明确界定

### 18.1 结论先说

就本阶段而言，我的预期是：

1. **需要 8 份 design 文档**
2. **需要 6 个 action-plan 周期**
3. 这些内容**已经在 charter 中完成了基础规划**
4. 但在 r2 之前，charter 更像“文档清单”，还不够像“执行引导”

因此本附加章节的作用是把：

- **要写多少**
- **为什么要写**
- **哪些必须先写**
- **每个周期的进入条件 / 退出条件是什么**

明确下来，作为本阶段开发工作的直接导航。

### 18.2 Design 文档的总量与角色

本阶段设计层的目标不是“多写文档”，而是**先把 F1-F5 会反复返工的歧义冻住**。  
按 r2 当前口径，design 文档总量应固定为 **8 份**：

| 类别 | 数量 | 作用 |
|---|---|---|
| F0 freeze-pack design docs | **7** | 冻结 first-wave topology、tenant truth、contract、relay、schema、reconnect、迁移面 |
| F4.A policy-layer design doc | **1** | 冻结 authority / tenant / truth-recheck policy seam |
| **合计** | **8** | 本阶段完整 design pack |

### 18.3 这 8 份 design 文档分别解决什么

| # | 设计文档 | 解决的问题 | 必须在什么时候完成 |
|---|---|---|---|
| 1 | `F0-compatibility-facade-contract.md` | first-wave public façade 的 canonical contract、legacy deprecation semantics | F1 前 |
| 2 | `F0-agent-core-internal-binding-contract.md` | `orchestrator -> agent` internal call 的路径、认证、authority passing convention | F1 前 |
| 3 | `F0-stream-relay-mechanism.md` | `agent -> orchestrator` stream framing、relay cursor、legacy WS fate | F1 前 |
| 4 | `F0-contexter-absorption-inventory.md` | contexter 的 adopt / adapt / defer / discard inventory | F1 前 |
| 5 | `F0-user-do-schema.md` | user DO 的 first-wave schema 与持久化边界 | F1 前 |
| 6 | `F0-session-lifecycle-and-reconnect.md` | `session_uuid` lifecycle、attach / reconnect truth | F1 前 |
| 7 | `F0-live-e2e-migration-inventory.md` | affected tests / harness / docs 的迁移面 | F3 前，但最好 F1 前完成 |
| 8 | `F4-authority-policy-layer.md` | authority policy helper、tenant truth alignment、executor recheck seam | F4 前 |

### 18.4 哪些 design 文档是“绝对前置”

虽然 design 总量是 8 份，但**不是 8 份都要写完才能开始任何实现**。  
真正的前置层分两档：

#### 档 A — F1 的硬前置（必须先写）

1. `F0-compatibility-facade-contract.md`
2. `F0-agent-core-internal-binding-contract.md`
3. `F0-stream-relay-mechanism.md`
4. `F0-user-do-schema.md`
5. `F0-session-lifecycle-and-reconnect.md`

没有这 5 份，F1 很容易重新掉回：

- ad-hoc fetch 胶水
- dual-ingress 模糊状态
- stream relay 返工
- user DO 变空壳

#### 档 B — 强烈建议在 F1 前完成

6. `F0-contexter-absorption-inventory.md`
7. `F0-live-e2e-migration-inventory.md`

这两份不是因为“没有就完全写不了代码”，而是因为没有它们，后面会出现：

- contexter 吸收口径漂移
- F3 迁移面再次被低估

#### 档 C — F4 前完成

8. `F4-authority-policy-layer.md`

它不是 F1 的 blocker，但它是 F4.A 的直接设计前提。

### 18.5 Action-Plan 的总量与周期划分

本阶段的 action-plan 周期应固定为 **6 个**，与 Phase 一一对应：

| Action-plan 周期 | 对应 Phase | 目标 |
|---|---|---|
| 1 | **F0** | 产出完整 concrete freeze pack |
| 2 | **F1** | 完成 orchestrator bring-up + first roundtrip |
| 3 | **F2** | 完成 first-wave session seam |
| 4 | **F3** | 完成 canonical cutover + legacy retirement |
| 5 | **F4** | 完成 authority policy hardening |
| 6 | **F5** | 完成 closure + handoff |

所以如果用 owner 执行视角去看：

> **本阶段不是“一份大 action-plan”，而是 6 个连续 action-plan 周期。**

### 18.6 为什么 action-plan 必须按 6 个周期拆开

因为这 6 个周期解决的是 6 类不同性质的工作：

1. **F0** 解决 design freeze，不写业务代码
2. **F1** 解决 topology 落地与最小 roundtrip
3. **F2** 解决生命周期完整性
4. **F3** 解决 cutover / migration / retirement
5. **F4** 解决 authority / tenant / truth-recheck 法律收口
6. **F5** 解决 closure / handoff / next-phase trigger

如果把它们混成 1-2 份大 action-plan，会直接失去两件最重要的东西：

1. 每个周期独立的进入条件
2. 每个周期独立的收口与 closure 证据

### 18.7 这 6 个 action-plan 周期的推荐进入顺序

#### 周期 1 — F0：先冻结真相

必须先完成：

1. public façade contract
2. internal binding contract
3. stream relay contract
4. tenant truth
5. user DO schema
6. reconnect truth

这是**本阶段最重要的前置周期**。

#### 周期 2 — F1：做最小但真实的 roundtrip

只回答一件事：

> public `start` 能否经 orchestrator 打进 agent，并把 first event 带回来？

若这一条做不通，后续 F2/F3 都不该启动。

#### 周期 3 — F2：把 first-wave session seam 补完整

把：

- WS
- attach / reconnect
- `initial_context`
- input / cancel / verify / status / timeline

补成完整 first-wave 生命周期。

#### 周期 4 — F3：切流量、迁测试、退役 legacy

这是最容易被低估的周期。  
它不是“改几个 URL”，而是：

1. 切 canonical ingress
2. 迁 affected live suite
3. 改 docs / harness / preview truth
4. 退役 legacy session ingress

#### 周期 5 — F4：补法律，不造 credit 域

这里只做：

1. authority policy helper
2. tenant truth alignment
3. recheck hook seam
4. negative tests

明确不在这里偷渡 credit / quota / billing domain。

#### 周期 6 — F5：正式闭合

把：

1. final verification
2. closure docs
3. handoff docs
4. next-phase inputs

一起收口。

### 18.8 这部分规划是否已经在 charter 里完成

**答案是：已经完成了 80% 的规划，但此前缺少一段“显式汇总与执行引导”。**

具体来说：

| 内容 | r2 之前是否已规划 | 之前的缺口 |
|---|---|---|
| design 文档清单 | **已规划**（§17.1） | 缺总量、优先级、硬前置说明 |
| action-plan 文档清单 | **已规划**（§17.2） | 缺“这是 6 个执行周期”的显式定义 |
| phase 结构 | **已规划**（§10 / §11） | 缺“如何从设计包进入执行”的导航 |
| closure / handoff | **已规划**（§17.3） | 缺“何时开始写 closure”的收口纪律 |

因此，这个附加章节不是推翻原规划，而是把原本散落在：

- §10 Phase 规划
- §11 Phase 详细说明
- §17 文档生产清单

里的内容，收束成一个**可执行导航层**。

### 18.9 对本阶段开发工作的直接引导

如果要按最稳妥的方式推进，本阶段应严格遵守下面的执行顺序：

1. **先写 7 份 F0 design docs**
   - 这是 F1 的 design gate
2. **把仍需 owner 拍板的问题汇总到 `docs/design/orchestration-facade/FX-qna.md`**
   - design 可以先给出推荐答案，但 F0 signoff 前必须把未冻结项集中收口
3. **再写 F0 action-plan**
   - 把 design freeze 变成执行任务
4. **F0 closed 后，进入 F1 action-plan**
   - 不要跳过 F0 直接写 orchestrator worker
5. **F1 closed 后，再进入 F2**
   - 不要在 F1 未完成 first roundtrip 时提前铺满全部 session seam
6. **F2 closed 后，再进入 F3**
   - cutover 只能发生在 first-wave lifecycle 已完整跑通之后
7. **F4 可在 late F1/F2 之后并行准备，但 closure 仍应在 F3 之后统一收口**
8. **最后才写 F5 closure / handoff**

把它收成一句话：

> **本阶段的开发导航应是：7 份 F0 design docs -> 1 个 F0 action-plan 周期 -> 5 个后续 action-plan 周期，而不是“先写 worker，再慢慢补文档”。**

---

## 19. 最终 Verdict

### 19.1 对本阶段的最终定义

这不是“再加一个 public worker”。

它的准确定义是：

> **把 nano-agent 的 public ownership 从 runtime 层剥离出来，交给一个有最小状态、最小 auth、最小 registry、最小 relay、最小 seed 能力的 upstream orchestrator，并把 orchestrator 与 runtime 之间的 internal API contract 一次性冻住。**

### 19.2 工程价值

1. 让 `agent.core` 回到它真正应该待的位置：downstream session runtime
2. 让 JWT / authority translation 有唯一 public 入口
3. 让 `session_uuid` lifecycle 有唯一 canonical owner
4. 让 richer orchestrator / memory / credit 下一阶段有可复用 internal contract
5. 避免继续把 public ingress 与 runtime 演化绑在一起

### 19.3 业务价值

1. 上游应用只需要对接一个 façade
2. 用户身份、session registry、public ingress 从 runtime 中剥离
3. 后端 runtime mesh 可以继续独立演化，而不背 public contract 包袱
4. 下一阶段更厚的 orchestrator 能建立在已冻结的 internal seam 上，而不是临时胶水上

### 19.4 与 r1 的关键差别

r2 相比 r1 的关键收紧是：

1. 明确补上 `orchestrator -> agent` internal binding contract
2. 明确 first-wave tenant truth = single-tenant-per-deploy
3. 明确 `agent.core /sessions/:id/ws` 不是 future internal seam
4. 明确 legacy session routes 的最终语义 = F3 exit 后 hard deprecate
5. 明确 F1 按 `L` 级诚实预算
6. 明确 Exit #7 = internal call contract freeze

### 19.5 一句话总结

> **Orchestration Facade r2 = 一个 compatibility-first、JWT-first、registry-backed、internal-contract-frozen 的 public façade phase；它不只迁 public ownership，还把 façade 与 runtime 之间的接口真相一起冻住。**

---

## 20. 维护约定

1. 若未来决定改成 multi-tenant-per-deploy，必须先更新 §1.6 / §6.5 / §7.1 / §12.Q5
2. 若未来改变 internal call contract，必须先更新 §6.1 / §11.1 / §15.1 #7
3. 若未来改变 stream relay 机制，必须先更新 §1.7 / §6.2 / `F0-stream-relay-mechanism.md`
4. 若未来又想把 full user-memory 拉回本阶段，必须先改 §4.5 / §7.2
5. 若 affected live tests 的迁移范围变化，必须同步更新 §2.3 / §13.2 / §15.1 #6
