# Zero-to-Real 阶段规划加固 — by GPT

> **文档性质**：`plan hardening / charter input`
> **日期**：`2026-04-24`
> **作者**：`GPT-5.4`
> **直接输入**：
> 1. `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md`
> 2. `context/ddl-v170/{README.md,GLOSSARY.md,smind-01-tenant-identity.sql,smind-06-conversation-context-session.sql,smind-09-tenant-billing-quota-usage.sql}`
> 3. `context/smind-admin/{wrangler.toml,src/**,tests/**}`
> 4. `context/smind-contexter/{src/chat.ts,src/engine_do.ts,core/jwt.ts}`

---

## 0. 一句话结论

**`zero-to-real` 比 `bridging-the-gap` 更准确。**  
但本阶段不该被理解为“继续做最小面”。更准确的定义是：**把范围收成“最小但完整的真实闭环”——以 NACP 为硬基石，落完整 end-user auth（含 WeChat）、多租户门禁、真实 agent loop、真实 audit/context truth、真实客户端实验。**

我对本阶段的最终定义是：

> **zero-to-real = 让 nano-agent 从“已闭合的 orchestration façade”进入“第一个真实用户可持续使用的闭环”，其最低交付是：NACP-first 的完整身份授权、多租户安全门禁、真实持久化、真实 LLM、真实会话/审计/上下文真相，以及真实客户端实验。**

---

## 1. 关于阶段命名：为什么 `zero-to-real` 优于 `bridging-the-gap`

`bridging-the-gap` 的问题在于：它强调“补差距”，但不说明**要补到什么状态**。  
而当前阶段的真实目标，不是继续打磨 façade，也不是做一次抽象性增强，而是要把系统推进到：

1. **真实 user identity**
2. **真实 tenant boundary**
3. **真实 agent loop**
4. **真实 persistent truth**
5. **真实 client experiment**

`docs/eval/zero-to-real/plan-analysis-by-opus-v2.md` §0.1 把阶段定义为“从 scaffold 走到真实可用的多租户 Agent SaaS 底座”，这个方向是对的。  
从命名上看，`zero-to-real` 更准确地表达了：**不是继续拼基础件，而是第一次让系统“真的活起来”。**

---

## 2. 我认可的事实底座

### 2.1 `ddl-v170` 给出的事实

`context/ddl-v170/README.md` 和 `GLOSSARY.md` 不是普通数据库说明书，而是**Agent 可执行的 schema context pack**。其中最重要的 4 个事实是：

1. **多租户的第一真相是 `team_uuid`**
   `README.md` §0.3 和 `GLOSSARY.md` §1.2 都把 `team_uuid` 作为统一隔离边界；所有查询都必须先过租户过滤。

2. **身份与成员关系是分离的**
   `smind-01-tenant-identity.sql` 明确把 `smind_users`、`smind_user_identities`、`smind_teams`、`smind_team_memberships` 拆开，不再把 `team_uuid/team_role` 硬塞进用户主表。

3. **会话域与上下文域是分层的**
   `smind-06-conversation-context-session.sql` 把 `conversation`、`session`、`turn`、`message`、`message_part`、`context_snapshot`、`context_item` 分成明确层次，并明确说明：**DO 里的缓存不是 SSOT，D1 才是共享真相层。**

4. **用量与配额是事件 + 余额，而不是散落逻辑**
   `smind-09-tenant-billing-quota-usage.sql` 里 `smind_usage_events`、`smind_quota_balances`、`smind_quota_ledger_entries` 形成了“事件 → 快照 → 账本”的清晰分工。

**对 zero-to-real 的启示**：  
`ddl-v170` 证明了 **D1 schema 必须从 day-1 就按“真实隔离 + 真实审计 + 真实读取模型”来设计**，但它同时也提醒我们：**不要一次性把成熟平台的全部广度搬进来。**

### 2.2 `smind-admin` 给出的事实

`context/smind-admin` 是一个真实的 Cloudflare Worker 控制面实现。对本阶段最有参考价值的，不是它的业务域，而是它的工程手法：

1. **薄入口 + 清晰 service 层**
   `src/index.ts` 很薄，`src/http/router.ts` 明确路由，业务主要放在 `src/modules/**`。

2. **Auth / identity / team 的分层是真实可运行的**
   `src/modules/identity/auth.service.ts`、`password.service.ts`、`team.service.ts` 展示了 Worker 内 control-plane 如何组织用户、团队、API key、密码重置等能力。

3. **环境变量、错误模型、测试护栏都很明确**
   - `src/infra/env.ts` 用 Zod 做 fail-fast
   - `src/infra/errors.ts` 做 typed error
   - `tests/storage_security.test.ts`、`contracts_guard.test.ts` 证明它把 guard 当成一等公民

4. **它没有实现 WeChat**
   `smind_user_identities` 在 DDL 上支持多 provider，但 `smind-admin` 的代码事实仍以 `email_password` 为主。  
   这意味着：**WeChat bridge 对 nano-agent 来说是新工程，不是直接 copy 即可。**

5. **它的密码散列实现不应该原样吸收**
   `src/infra/security.ts` 使用 `SHA-256(salt:raw)`；这对成熟迁移包有现实性，但对 nano-agent 这个新系统而言，不应作为长期密码方案直接继承。

**对 zero-to-real 的启示**：  
`smind-admin` 非常适合拿来做 **auth/control-plane 工程样板**，但不适合整包吸收，更不适合把它的所有 team/admin/API key surface 一次性都拉进 zero-to-real。

### 2.3 `smind-contexter` 给出的事实

`context/smind-contexter` 最关键的不是 RAG，而是它已经证明了以下模式能工作：

1. **per-user DO 是真实的业务执行单元**
   `src/engine_do.ts` 用 user 维度 Durable Object 持有会话、WebSocket 连接池、DO SQLite、AlarmManager。

2. **Gateway / DO 分层是成立的**
   `src/chat.ts` 的 ChatGateway 负责 JWT 验证、trace/source_name 注入、WS upgrade，再把请求送入 user DO。

3. **双向 WebSocket 与 user-level stateful loop 是可实现的**
   `engine_do.ts` 的 WS handling 已经不是单向推送，而是收消息、验包、dispatch。

4. **DO SQLite + Alarm 是热态能力，不是 D1 替代品**
   `engine_do.ts` 的模式证明了：**DO SQLite 用于 user-level hot state 很合理，但它不应替代共享持久化真相。**

**对 zero-to-real 的启示**：  
`smind-contexter` 强烈支持 Opus 关于“orchestration.core 最终要变成真正的 user-level stateful orchestrator”的判断。  
但它也反向提醒我们：**这类升级很重，不能和 auth、D1、real LLM、Mini Program 一起在第一波全吞。**

---

## 3. 对业主与 Opus v2 判断的评价

## 3.1 我明确同意的部分

### A. 业主关于“真实第一次跑起来”的方向判断是对的

这比继续做抽象层更重要。  
当前仓库已经有 façade、authority law、private runtime mesh；下一阶段如果还不进入真实登录、真实持久化、真实模型、真实客户端，那系统会继续停留在“结构正确但没有产品重力”的状态。

### B. Opus 对阶段主目标的重新定义是对的

`plan-analysis-by-opus-v2.md` §0.1、§0.3 把目标改写为：

1. 真实 JWT / WeChat 登录
2. 多租户 day-1
3. 真实 D1
4. 真实 LLM
5. 真实用户态 orchestrator
6. quota hook 真正生效

这个目标方向没有问题，且和 `ddl-v170`、`smind-admin`、`smind-contexter` 的事实一致。

### C. `orchestrator.auth` 作为独立 worker 的方向是对的

这是本轮我最认同 Opus 的架构判断之一。  
原因很直接：

1. `smind-admin` 已证明 auth / user / team / password / API key 这类 control-plane 能力完全可以形成独立 worker。
2. 把 JWT 签发与身份写入职责从 runtime mesh 中剥离出去，是更健康的 secret 边界。
3. 这也符合 orchestration-facade 已建立的“public façade + private runtime mesh”大方向。

**但我不同意把它第一波就做成完整 admin 面。** 见下文。

## 3.2 我修正后的判断

结合业主后续四点反馈、当前仓库真实代码以及三份 context，我认为前一版 hardening 需要做 4 个实质修正。

### A. auth 不能只做“最小面”，而必须做完整 end-user auth flow

这一点业主是对的。  
如果 zero-to-real 的目标真的是 **first real client loop**，那么 auth 不能只停留在 register / login / verify-token 的最小流，而应该明确包含：

1. email/password register / login
2. verify-token / refresh-token
3. password reset
4. current user / tenant readback
5. **WeChat bridge**

这里要区分两件事：

- **我同意完整 end-user auth flow 必须进入 zero-to-real**
- **我仍不同意 first-wave 直接吞下完整 admin plane**

也就是说，`orchestrator.auth` 应该做强，但它要强在 **真实用户入口**，而不是一开始就膨胀成完整的 tenant admin / API key product surface。

### B. 多租户 + NACP compliance 不是附属约束，而是主线

业主这条批评也是对的。  
我前一版文档虽然写了 `team_uuid`、写了 day-1 multi-tenant，但没有把它展开成真正的执行 law。

而当前仓库已经有明确事实说明，这条线必须进入主线：

1. `workers/orchestrator-core/src/auth.ts`
   - public ingress 已要求 JWT + `trace_uuid`
   - claim tenant 与 deploy tenant 不一致时会拒绝
2. `workers/agent-core/src/host/internal-policy.ts`
   - internal ingress 已要求 `x-trace-uuid`、`x-nano-internal-authority`
   - body/header 的 trace 与 authority 不能分叉
   - internal path 已有 no-escalation truth
3. `packages/nacp-core/src/envelope.ts`
   - `authority`, `trace`, `tenant_delegation`, `quota_hint`, tenant-prefixed `refs` 都是协议一等字段
4. `packages/nacp-session/src/ingress.ts`
   - client frame 不得 author authority
   - authority 必须 server-stamped 后再进入 session parse path

所以 zero-to-real 不该只写成 “建 D1、接模型、做客户端”，而应明确写成：

> **把多租户安全门禁、trace/authority 双头校验、tenant boundary、NACP compliance 变成 runtime law。**

### C. `nacp-core` / `nacp-session` 必须从“协议存在”推进到“执行真理”

这条批评也完全成立。  
前一版 hardening 没有把 NACP 写得足够重，容易让人误解成“协议是背景板，真正的主线是 auth + D1 + client”。

更准确的说法应该是：

1. `@haimang/nacp-core`
   - 冻结 internal envelope / authority / trace / control / transport / tenancy / evidence vocabulary
2. `@haimang/nacp-session`
   - 冻结 client ↔ session DO profile：`session.start`、`session.followup_input`、ack / heartbeat / replay / resume
3. zero-to-real 必须冻结：
   - JWT claims -> `AuthSnapshot` -> `NacpAuthority`
   - public ingress -> Session profile
   - internal binding -> NACP envelope + no-escalation
   - storage / refs -> tenant boundary
   - runtime events / audit -> trace-linked evidence

这意味着我前一版把 “internal RPC 可以后放” 与 “NACP 可以后放” 说得太近了。  
正确关系应是：

- **transport 可以后演进**
- **NACP law 不能后演进**

### D. real loop 的最低门槛必须抬高到“可审计、可回放、可追责”

业主第四条的批评，我认为是“部分同意，但必须做实质修正”。

当前代码不是空壳：

1. `workers/agent-core/src/kernel/runner.ts`
   - 已经有真实 loop scaffold：LLM call、tool exec、runtime events
2. `workers/agent-core/src/llm/gateway.ts`
   - 真实欠缺主要在 provider 仍是 stub seam
3. `workers/agent-core/src/host/traces.ts`
   - trace / audit event vocabulary 已经存在
4. `workers/context-core/src/context-assembler.ts`、`snapshot.ts`
   - context layering / snapshot truth 也已有包级实现

所以问题不是 nano-agent 只能做 mockup；  
问题是我前一版把 “thin persistence” 切得太瘦了，低于 real loop 的验证门槛。

我现在修正为：

> zero-to-real 的最低真实闭环，至少必须同时拥有：**真实 auth、真实 provider、真实 session/turn/message 持久化、真实 context snapshot、真实 trace/audit sink、真实 client loop。**

---

## 4. 修正后的阶段 scope 边界

### 4.1 本阶段必须落地的内容

1. **完整 end-user auth substrate**
   - register / login / verify / refresh / reset
   - WeChat bridge
   - current user / tenant readback

2. **NACP-first 的多租户安全门禁**
   - JWT -> `AuthSnapshot` -> `NacpAuthority` 映射冻结
   - public/internal ingress 双头校验
   - tenant boundary / no-escalation / trace law

3. **thin-but-complete 的 D1 真相层**
   - identity core
   - conversation / session / turn / message core
   - context snapshot core
   - activity / audit / trace linkage
   - usage/quota minimal core

4. **真实模型接线**
   - 至少一个 non-fake provider

5. **真实执行前 quota hook**
   - allow / deny
   - usage event 写入
   - quota balance 更新

6. **真实 client experiment**
   - web thin client
   - Mini Program real run

### 4.2 本阶段明确不强行吞下的内容

1. 完整 team admin / tenant member admin plane
2. 完整 API key admin plane
3. 完整 `smind-09` policy / ledger / alerts 平面
4. `smind-06` 的 full collaboration richness（participants / message_parts / context_items 全量化）
5. internal RPC 主导迁移
6. cold archive / R2 history offload
7. context/filesystem 的 public promotion

---

## 5. 修正后的架构收紧方案

### 5.1 `orchestrator.auth`：做完整 end-user auth，不做完整 admin 面

`orchestrator.auth` 仍然是对的，而且现在应当更明确：
它不是“最小 auth 核心”，而是 **zero-to-real 的完整 end-user auth substrate**。

建议 first-wave surface 至少包含：

1. `POST /internal/auth/register`
2. `POST /internal/auth/login`
3. `POST /internal/auth/verify-token`
4. `POST /internal/auth/refresh-token`
5. `POST /internal/auth/password/reset`
6. `POST /internal/auth/wechat/*`
7. `GET /internal/auth/me`

但仍然明确延后：

1. tenant admin CRUD
2. member admin / invite
3. API key admin plane

### 5.2 D1 schema：从“thin”改成“thin-but-complete”

我修正对 `smind-06` 的吸收建议：  
zero-to-real 不需要 day-1 吞下 full richness，但需要吸收到足以支撑真实 loop 审计。

因此 first-wave D1 更合理的冻结面应是：

| 组 | 推荐 first-wave | 延后 |
| --- | --- | --- |
| identity | `nano_users`, `nano_user_profiles`, `nano_user_identities`, `nano_teams`, `nano_team_memberships` | team admin / invites / API keys |
| auth/session | `nano_auth_sessions` 或同等 refresh/token state | 更复杂 device/session governance |
| conversation | `nano_conversations`, `nano_conversation_sessions`, `nano_conversation_turns`, `nano_conversation_messages` | participants / message_parts |
| context | `nano_conversation_context_snapshots` | richer context items / materialization |
| audit | `nano_session_activity_logs` 或同等 trace-linked audit table | 更复杂 BI / reporting projection |
| quota | `nano_usage_events`, `nano_quota_balances` | policies / ledger / alerts |
| secrets | `nano_tenant_secrets`（仅当 DeepSeek BYO key 提前进入） | 更复杂 secret governance |

### 5.3 增加一条显式主线：NACP realization track

zero-to-real 不能只按“业务模块”推进，还必须有一条贯穿全部阶段的 **NACP realization track**。

这条主线要冻结 5 件事：

1. **Authority mapping**
   - JWT claims -> `AuthSnapshot` -> `NacpAuthority`
2. **Session profile**
   - client input 统一进入 `session.start` / `session.followup_input`
3. **Internal envelope**
   - `orchestrator.auth` / `orchestration.core` / `agent.core` / `bash.core` 全部走 trace + authority + no-escalation
4. **Storage law**
   - D1 / DO / KV / R2 / refs 都受 `team_uuid` 边界约束
5. **Evidence law**
   - session / tool / llm / quota / context / audit 事件都能回挂到 trace / session / team

### 5.4 real LLM provider 顺序：仍建议 Workers AI first

在 auth 与 NACP 都被抬高之后，我仍然维持一个判断：  
**first real provider 仍应优先 Workers AI。**

原因没有变化：

1. 它是平台原生 binding，最小化 secret 与轮转复杂度
2. zero-to-real 的第一目标是尽快得到真实模型输出
3. DeepSeek BYO key 更适合在 auth/secrets plane 稳定后再引入

建议顺序：

1. Workers AI first
2. DeepSeek second
3. 再做 provider fallback chain

### 5.5 `orchestration.core`：shared truth 优先，但不得低于 real loop 门槛

我仍然认为：**shared truth 先落 D1，比一开始就 full user-DO rebuild 更稳妥。**  
但这里必须补一句前一版缺失的话：

> 如果当前 façade + user DO 形态无法满足 session/turn/audit/context 的真实写入与重连语义，那么对 `orchestration.core` 的 stateful uplift 不能继续往后拖。

因此更准确的执行口径是：

1. 优先保证 D1 成为 SSOT
2. 保证当前 user DO / façade 能真实承接：
   - start / followup / cancel / resume / stream
   - history / reconnect / audit
3. 若现有形态不足，则在 zero-to-real 中直接补 user-level stateful uplift

换句话说，**stateful uplift 是从属于 real loop 目标的，不是一个可无限后移的“优雅改造项”。**

### 5.6 密码学吸收仍然要取结构，不取具体算法

这一条结论不变。  
`smind-admin` 的工程分层值得吸收，但其 `SHA-256(salt:raw)` 不应成为 nano-agent 新系统的密码基线。

---

## 6. 修正后的执行阶段划分

我现在推荐把 zero-to-real 切成 **5 个执行阶段**，并把 **NACP realization track** 作为全程并行主线。

| 阶段 | 目标 | 关键产出 | Exit truth |
| --- | --- | --- | --- |
| Z0 | Contract + Compliance Freeze | auth / D1 / NACP / provider / deferred freeze | action-plan 可执行 |
| Z1 | Full Auth + Tenant Foundation | `orchestrator.auth` + identity core + WeChat bridge | 真实用户与真实租户成立 |
| Z2 | Session Truth + Audit Baseline | session/turn/message/context/audit D1 truth | real loop 可持久、可重连、可追责 |
| Z3 | Real Runtime + Quota | Workers AI + quota gate + usage/balance truth | real model + runtime guard 生效 |
| Z4 | Real Clients + First Real Run | web + Mini Program + gap hardening | 真实 client loop 连续可用 |

### Z0 — Contract + Compliance Freeze

#### 目标

把 zero-to-real 的 baseline 收紧成“最小但完整的真实闭环”。

#### 本阶段要冻结

1. end-user auth surface（明确包含 WeChat）
2. JWT -> `AuthSnapshot` -> `NacpAuthority` 映射
3. Session profile：`session.start` / `session.followup_input` / ack / heartbeat / resume
4. D1 first-wave tables
5. runtime quota minimal contract
6. provider 顺序
7. deferred/backlog 清单

#### Exit

1. charter/design/action-plan 能按同一 baseline 展开
2. multi-tenant / NACP compliance 有显式 checklist
3. 不再把 admin plane / RPC / cold archive 混入 baseline

### Z1 — Full Auth + Tenant Foundation

#### 目标

第一次让系统拥有 **真实用户、真实租户、真实 JWT 授权入口**。

#### 必做

1. 新建 `nano-agent-db`
2. 落 identity core：users / profiles / identities / teams / memberships
3. 新建 `orchestrator.auth`
4. 落完整 end-user auth flow：
   - register / login / verify / refresh / reset
   - WeChat bridge
   - `me` / tenant readback
5. 冻结 public ingress -> `AuthSnapshot` -> `NacpAuthority`
6. 跑双租户 negative tests

#### 明确不做

1. 完整 tenant admin plane
2. API key admin plane
3. internal RPC
4. cold archive

#### Exit

1. 两个真实 tenant 的用户能独立登录
2. Web 与 WeChat auth tokens 都能被正确验证
3. authority / trace / tenant truth 已进入真实 ingress
4. no-escalation negative cases 能稳定拒绝

### Z2 — Session Truth + Audit Baseline

#### 目标

第一次让系统拥有 **真实 session truth**，而不是只靠内存热态。

#### 必做

1. 落 conversation core：conversations / sessions / turns / messages
2. 落 context snapshot truth
3. 落 trace-linked activity / audit log
4. `orchestration.core` 把 start / followup / cancel / resume / stream 与 D1 SSOT 接起来
5. history / reconnect / timeline / conversation list 可读
6. Web thin client 先跑通真实 persistence loop

#### 明确不做

1. full collaboration model
2. message_parts / context_items 全量 richness
3. cold archive

#### Exit

1. session 结束后 history 仍可查询
2. reconnect 后 timeline 不丢
3. turn/message/context/audit 能对齐同一 trace/session
4. real loop 已经“可持久、可追责、可回看”

### Z3 — Real Runtime + Quota

#### 目标

把 loop 中“假”的那一部分换成真的：真实 provider 与真实 runtime guard。

#### 必做

1. `agent.core` 接入 Workers AI
2. fake provider 退为 test/demo path
3. `bash.core` / capability 执行前真实过 quota hook
4. 落 `nano_usage_events` + `nano_quota_balances`
5. trace / audit 里能看到 llm/tool/quota evidence

#### 可选增量

1. DeepSeek adapter skeleton
2. `nano_tenant_secrets`（若 owner 坚持加速 DeepSeek）

#### 明确不做

1. full fallback chain
2. full quota ledger / policies / alerts
3. internal RPC 迁移

#### Exit

1. agent loop 返回真实模型内容
2. quota allow / deny 成为 runtime truth
3. usage / balance / trace / audit 形成闭环证据

### Z4 — Real Clients + First Real Run

#### 目标

让真实客户端全面进场，并用真实运行暴露最后一批 gap。

#### 必做

1. web client 完整 hardening
2. Mini Program 接入
3. WeChat login -> start -> input -> stream -> history 全链路跑通
4. gap triage + 修复
5. 若 Z2 暴露出 user-level stateful 缺口，则在本阶段补齐 stateful uplift

#### 可选增量

1. DeepSeek BYO key
2. Web / Mini Program 双 client 对照调试

#### 明确不做

1. full RPC retirement
2. cold archive
3. 完整 admin plane

#### Exit

1. Web 与 Mini Program 都能完成连续真实 loop
2. session/history/audit/context 在真实客户端下稳定
3. 剩余 gap 已收敛为明确 backlog，而非 blocker

---

## 7. 推荐的 deferred/backlog 明细

以下内容我建议明确写成 **zero-to-real 之后** 的 backlog：

1. internal RPC 全面推进
2. `/internal/*` HTTP 退役
3. DeepSeek per-tenant secrets 完整治理
4. quota policy / ledger / alerts 完整化
5. conversation participants / message parts / context items 完整化
6. cold archive / R2 history offload
7. API key admin plane
8. richer tenant admin product surface

---

## 8. 最终 verdict

### 8.1 对业主

你的方向判断是对的，而且需要比我前一版文档写得更强。  
**zero-to-real 不是“做一个更完整的 demo”，而是第一次把 nano-agent 推到 production-grade baseline。**

### 8.2 对 Opus

Opus v2 的大方向仍然是对的：

1. 阶段目标被重新定义对了
2. 三份 context 的借鉴方向基本对了
3. `orchestrator.auth` / D1 / real LLM / user-level orchestrator 被放进了同一张图

需要修正的点不再只是“太重”，而是：

> **必须把 NACP-first、多租户安全门禁、完整 end-user auth、以及可审计的 real loop baseline 写得更显式。**

### 8.3 我的最终推荐

**采用 `zero-to-real` 这个新名字。**  
**保留 Opus v2 的总体方向。**  
**但按本文修正后的 Z0-Z4 切分执行，并把 NACP realization track 提升为全程主线。**

一句话收口：

> **zero-to-real 要追求的不是“更少功能”，而是“更小但完整的真实闭环”。**

---

## 附录 A — 2026-04-24 针对业主四点反馈的追加说明

> **说明**：本附录保留本轮辩证讨论的结论，作为后续继续理解 `zero-to-real` 的上下文。若与本文前文存在冲突，以本附录推动后的正文为准。

### A.1 关于 “auth 不该做最小面，而应完整包括 WeChat”

我的修正结论是：**基本同意。**

1. 业主的目标是 first real client loop，而不是 auth mock
2. 如果 Mini Program / WeChat 是真实目标入口，那么 WeChat bridge 就不是可随意后移的装饰项
3. `smind-admin` 证明 auth/control-plane 可以独立成 worker，但它没有现成 WeChat 代码可直接吸收，因此这是新工程而不是 copy 工作

因此我的最终口径变成：

> zero-to-real 必须实现完整 end-user auth flow，包括 WeChat bridge；但它不等于 first-wave 就把完整 admin 面一次性做完。

### A.2 关于 “多租户、安全门禁、多头校验、NACP compliance 被低估了”

我的修正结论是：**完全同意。**

关键事实已经在当前仓库中存在：

1. `workers/orchestrator-core/src/auth.ts`
   - JWT + `trace_uuid` 已是 public ingress truth
   - tenant mismatch 会被拒绝
2. `workers/agent-core/src/host/internal-policy.ts`
   - internal authority / trace / no-escalation 已是 shipped truth
3. `packages/nacp-core/src/envelope.ts`
   - authority / trace / tenant_delegation / quota / refs 都已是一等协议字段
4. `packages/nacp-session/src/ingress.ts`
   - authority 必须 server-stamped，client 不得伪造

因此 zero-to-real 不能只写 D1 / provider / client，而必须写成：

> 多租户安全门禁与 NACP compliance 是执行主线，而不是附属约束。

### A.3 关于 “没有把 `nacp-core` / `nacp-session` 讲清楚”

我的修正结论是：**完全同意。**

前一版 hardening 把协议说得太轻，容易造成误解。  
更准确的口径是：

1. `nacp-core` 冻结 internal contract family
2. `nacp-session` 冻结 client ↔ session profile
3. zero-to-real 的 auth、ingress、storage、audit、runtime 都必须能映射回这两层协议

也就是说：

- internal RPC 可以后做
- transport profile 可以后演进
- **但 NACP law 不能后做**

### A.4 关于 “前一版过于保守，可能导致无法验证真实 loop / session log / audit / context”

我的修正结论是：**部分同意，但必须做实质修正。**

我不同意“当前 nano-agent 只能做 mockup”的判断，因为仓库已经有真实底座：

1. `workers/agent-core/src/kernel/runner.ts`
   - 已有真实 loop scaffold
2. `workers/agent-core/src/llm/gateway.ts`
   - 当前主要假的部分是 provider seam
3. `workers/agent-core/src/host/traces.ts`
   - 已有 trace / audit vocabulary
4. `workers/context-core/src/context-assembler.ts`、`snapshot.ts`
   - 已有 context layering / snapshot truth

但我承认：**我前一版对 D1/session/context/audit 的 first-wave 切法偏瘦，低于 real loop 的验证门槛。**

所以最终修正为：

> zero-to-real 的 baseline 至少必须同时拥有：真实 auth、真实 provider、真实 session/turn/message 持久化、真实 context snapshot、真实 trace/audit sink、真实 client loop。

### A.5 本轮讨论后的总收口

本轮讨论后，我对 zero-to-real 的最终定义变成：

> **以 NACP 为硬基石，完成完整 end-user auth、多租户安全门禁、真实持久化、真实 agent loop、真实 audit/context truth、真实客户端实验的 first production-grade baseline。**
