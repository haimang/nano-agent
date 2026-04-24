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
但如果按 Opus v2 的完整构想一次性推进，阶段会过重。更稳妥的做法是：**保留它的方向，缩减它的 first-wave 吸收面，并把“真实用户价值”放在“架构终态优雅”之前。**

我对本阶段的最终定义是：

> **zero-to-real = 让 nano-agent 从“已闭合的 orchestration façade”进入“第一个真实用户可持续使用的闭环”，其最低交付是：真实身份、真实持久化、真实 LLM、真实会话历史、真实客户端实验。**

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

### C. `orchestration.auth` 作为独立 worker 的方向是对的

这是本轮我最认同 Opus 的架构判断之一。  
原因很直接：

1. `smind-admin` 已证明 auth / user / team / password / API key 这类 control-plane 能力完全可以形成独立 worker。
2. 把 JWT 签发与身份写入职责从 runtime mesh 中剥离出去，是更健康的 secret 边界。
3. 这也符合 orchestration-facade 已建立的“public façade + private runtime mesh”大方向。

**但我不同意把它第一波就做成完整 admin 面。** 见下文。

## 3.2 我认为需要收紧或修正的部分

### A. Opus 的第一版执行面仍然偏重

Opus v2 的主要问题不是方向错，而是**一次性想落太多终态元素**：

1. 新建 `orchestration.auth`
2. 重塑 `orchestration.core`
3. 引入 D1 三大模块子集
4. 让 `agent.core` 接真 LLM
5. 加 quota 账本
6. 加 WeChat bridge
7. 加 Mini Program
8. 启动 internal RPC
9. 加冷归档 / Alarm 驱动数据迁移

这些每一项单独看都合理，但如果作为一个阶段的首轮执行面，会严重放大 scope risk。

### B. `smind-06` 的吸收粒度应更小

`smind-06-conversation-context-session.sql` 非常完整，但它的完整度也意味着成本很高。  
它有：

1. `smind_conversations`
2. `smind_conversation_participants`
3. `smind_conversation_sessions`
4. `smind_conversation_turns`
5. `smind_conversation_messages`
6. `smind_conversation_message_parts`
7. `smind_conversation_context_snapshots`
8. `smind_conversation_context_items`

对于 zero-to-real，**不需要 day-1 全吸收**。  
当前 nano-agent 的真实 first-wave 仍然是：

- 单 host user 主导
- private conversation 为主
- message timeline 比 participant/collab 更重要
- real history 比 rich multimodal message part 更重要

因此我建议：

**first-wave 只吸收：**

1. `nano_conversations`
2. `nano_conversation_sessions`
3. `nano_conversation_messages`
4. `nano_conversation_context_snapshots`（若 compact/context 层需要）

**延后：**

1. participants
2. turns
3. message_parts
4. context_items

理由不是它们不重要，而是**它们不是“从 zero 到 real”的第一道门槛**。

### C. `smind-09` 的吸收粒度也应更小

Opus 已经把 billing 全延后，这点是对的。  
但即便只看 quota 平面，`smind-09` 也不应该 first-wave 一次性吸收成完整体系。

`smind_usage_events` + `smind_quota_balances` 已经足够支撑：

1. 每次 side-effect 前做一次 quota check
2. allow / deny mock
3. usage event 写入审计
4. balance 快照更新

`smind_quota_policies` 和 `smind_quota_ledger_entries` 当然更完备，但不是 zero-to-real 的最低门槛。

**所以我的建议是：**

- first-wave：`nano_usage_events` + `nano_quota_balances`
- second-wave：`nano_quota_policies`
- later：`nano_quota_ledger_entries`

### D. WeChat bridge 不应成为本阶段前半段的阻塞项

这是我与 Opus v2 最大的执行顺序分歧之一。

事实基础：

1. `smind-admin` 没有现成的 WeChat bridge 代码可直接吸收。
2. 微信小程序 + WeChat auth + WS 行为 + mobile quirks 会把调试面大幅扩大。
3. 本阶段更核心的 first proof 应是：**email/password + web harness + real LLM + persisted history**。

所以：

- **我支持 WeChat bridge 进入 zero-to-real**
- **但我不支持让它进入前半程的基础 phase**

更合理的顺序是：

1. 先用 email/password 跑通真实 auth substrate
2. 先用 web thin client 跑通真实 loop
3. 再把 WeChat + Mini Program 接上

这样一旦出问题，我们知道是：

- auth substrate 有问题
- runtime / WS 有问题
- 还是 Mini Program / WeChat bridge 本身有问题

### E. internal RPC 不是 zero-to-real 的前半程主线

我认可 Opus 对 WorkerEntrypoint / RPC 的技术判断，但**不认可它在 zero-to-real 中的优先级**。

原因很简单：

1. 当前 fetch-based service binding 已经在 orchestration-facade 阶段证明可用。
2. internal RPC 改善的是**内部工程质量与类型安全**，不是 first real user value。
3. 在 auth / D1 / LLM / WS / Mini Program 都没稳定前，引入新 transport 只会让排错维度变多。

因此我的建议是：

- `zero-to-real` 内部 transport **继续以 fetch-backed binding 为主**
- RPC 只作为 **late optional track** 或 **zero-to-real 后续阶段** 启动

### F. 冷归档 / R2 cold layer 不是 zero-to-real 的关键门槛

Opus v2 把冷归档放进第三段，我认为仍然偏早。

业主已经明确：

1. 持久化是永久的
2. first real run 才是当前核心目标

在 first real run 阶段，**最重要的是先把真实数据留住并可审计**，而不是先做冷热层优化。  
zero-to-real 完全可以先接受：

- D1 热写真相
- 暂不做冷迁移
- 先把历史、查询、审计、gap 暴露出来

冷层优化更适合在 first real run 稳定后再做。

---

## 4. 我建议的阶段内 scope 边界

### 4.1 本阶段必须落地的内容

1. **真实 auth substrate**
   - register / login / verify-token
   - multi-tenant identity + membership 真相

2. **最小真实 D1**
   - identity core
   - conversation/history core
   - usage/quota minimal core

3. **真实模型接线**
   - 至少一个 non-fake provider

4. **真实执行前 quota hook**
   - allow / deny
   - usage event 写入

5. **真实 history / timeline 持久化**
   - session 结束后历史还在

6. **真实实验客户端**
   - 先 web，再 Mini Program

### 4.2 本阶段不应强行吞下的内容

1. 完整 `smind-06` richness
2. 完整 `smind-09` quota ledger / alert / policy plane
3. 完整 team admin / API key 管理面
4. cold archive / R2 history offload
5. internal RPC 主导迁移
6. context/filesystem 的 public promotion
7. multi-tenant-per-deploy 的复杂策略升级

---

## 5. 推荐的架构收紧方案

### 5.1 `orchestration.auth`：保留，但第一波只做最小 auth 核心

我建议保留 `orchestration.auth`，但把 first-wave surface 收紧到：

1. `POST /internal/auth/register`
2. `POST /internal/auth/login`
3. `POST /internal/auth/verify-token`
4. `POST /internal/auth/password/reset`（可选）

**延后到后段：**

1. WeChat bridge
2. API key 管理
3. team CRUD / tenant members admin

理由：

- `smind-admin` 证明 auth service 很容易独立成 worker
- 但 first real client loop 根本不需要一开始就做完整 admin 控制面

### 5.2 D1 schema：缩成 “01 core + 06 thin + 09 minimal”

我建议 zero-to-real first-wave 的 D1 只冻结以下表：

| 组 | 推荐 first-wave | 延后 |
| --- | --- | --- |
| identity | `nano_users`, `nano_user_profiles`, `nano_user_identities`, `nano_teams`, `nano_team_memberships` | `nano_team_api_keys`, invites |
| conversation | `nano_conversations`, `nano_conversation_sessions`, `nano_conversation_messages` | participants / turns / message_parts / context_items |
| context | `nano_conversation_context_snapshots`（仅当 compact wire 必需） | richer snapshot composition |
| quota | `nano_usage_events`, `nano_quota_balances` | policies / ledger / alerts |
| secrets | `nano_tenant_secrets`（仅当 DeepSeek BYO key 提前进入） | 更复杂 secret governance |

### 5.3 real LLM provider 的顺序：先 Workers AI，再 DeepSeek BYO key

这里我与 Opus v2 的建议不同。

Opus主张：

1. 主 DeepSeek
2. fallback Workers AI

我的建议是反过来：

1. **first real provider = Workers AI**
2. **second provider = DeepSeek**
3. **再考虑 fallback chain**

原因是事实性的：

1. Workers AI 是平台原生 binding，不需要先引入 `nano_tenant_secrets`、加密、轮转、缓存失效。
2. DeepSeek BYO key 会直接扩大 D1、secret、admin API、rotation、TTL 失效的调试面。
3. zero-to-real 的第一目标是**最快得到真实模型输出**，不是第一天就把 provider 策略做到最优。

**建议顺序：**

- 先接 Workers AI，把 fake provider 拔掉
- 再引入 DeepSeek adapter
- 再做 per-tenant key / fallback chain

### 5.4 `orchestration.core`：先做 D1 持久化与 history，再做 full user-DO rebuild

`smind-contexter` 强烈证明了 user-level DO SQLite + Alarm + 双向 WS 是对的。  
但我不建议把它作为 zero-to-real 的第一波改造面。

更合理的是两波：

#### Wave A：先让 shared truth 落地

1. conversations / sessions / messages 写 D1
2. history API 可查
3. 当前 façade / user DO 继续承担轻量代理

#### Wave B：再把 user DO 升级为 stateful orchestrator

1. DO SQLite
2. active conversation hint
3. bidirectional WS
4. alarm-driven background jobs
5. local intent dispatcher

这样可以避免把：

- D1 schema
- auth worker
- real LLM
- user DO 重构
- WeChat client

全部压到同一波。

### 5.5 密码学吸收要取“工程结构”，不要取“具体算法”

`smind-admin` 的 `auth.service.ts`、`password.service.ts`、`errors.ts`、`env.ts` 很值得吸收；  
但 `infra/security.ts` 里的 `SHA-256(salt:raw)` 不应原样继承到 nano-agent。

zero-to-real 是新系统，不应把“迁移友好型密码方案”作为自己长期基线。

---

## 6. 我推荐的执行阶段划分

我建议把 zero-to-real 切成 **4 个执行阶段 + 1 个文档冻结前导阶段**。

## Z0 — Contract Freeze

### 目标

把 zero-to-real 的 first-wave contract 收紧成可执行版本，防止“边做边加终态”。

### 本阶段要冻结

1. JWT claim schema
2. `orchestration.auth` first-wave surface
3. D1 first-wave table 清单
4. real provider 首选顺序（建议 Workers AI first）
5. zero-to-real 内明确 deferred 的内容

### Exit

1. charter/design/action-plan 可写
2. 不再把 full 06 / full 09 / RPC / cold archive 混入基础阶段

## Z1 — Identity + Persistence Baseline

### 目标

第一次让系统拥有**真实用户、真实租户、真实历史**，哪怕 LLM 还没接真 provider。

### 必做

1. 新建 `nano-agent-db`
2. 落 identity core：users / profiles / identities / teams / memberships
3. 落 conversation thin core：conversations / sessions / messages
4. 新建 `orchestration.auth` worker（最小 auth surface）
5. orchestration.core 接 auth proxy + public auth routes
6. 两个真实用户注册登录并隔离

### 明确不做

1. WeChat bridge
2. API key admin 面
3. DO SQLite 重构
4. internal RPC
5. DeepSeek tenant secrets

### Exit

1. 两个真实用户能登录
2. JWT 能驱动完整 session 流
3. conversation/message 能写入 D1
4. user A 看不到 user B 的数据

## Z2 — Real Runtime

### 目标

让 agent loop 第一次跑到**真实模型**，并把 execution-time quota hook 变成 runtime truth。

### 必做

1. `agent.core` 接入 **Workers AI** adapter
2. 移除 fake provider 作为主路径
3. `bash.core` 真正接 `beforeCapabilityExecute`
4. 落最小 quota 面：`nano_usage_events` + `nano_quota_balances`
5. allow / deny mock 可切

### 可选增量

1. DeepSeek adapter skeleton
2. `nano_tenant_secrets`（若 owner 坚持 DeepSeek 优先）

### 明确不做

1. full fallback chain 优化
2. WeChat bridge
3. user DO SQLite 重构
4. internal RPC

### Exit

1. agent loop 返回真实模型内容
2. capability 执行前真实过 quota hook
3. usage events 有持久化证据

## Z3 — Stateful Orchestrator

### 目标

把 `orchestration.core` 从“public façade”升级为真正的 **user-stateful orchestrator**。

### 必做

1. user DO 引入 DO SQLite
2. active conversation pointer
3. bidirectional WebSocket
4. conversation list / activate / history
5. optional context snapshot 持久化
6. Alarm 只做本地 flush / housekeeping，不做 cold archive

### 明确不做

1. R2 冷归档
2. full intent intelligence
3. internal RPC 迁移

### Exit

1. web client 可通过 WS 双向交互
2. conversation 切换与历史读取稳定
3. reconnect 语义与 user-level state 一致

## Z4 — Mini Program + WeChat + First Real Run

### 目标

让真实移动端实验进场，并用它暴露最后一批 runtime/auth/gap。

### 必做

1. `orchestration.auth` 实装 WeChat bridge
2. Mini Program 接入
3. 真实用户实验
4. gap triage + 修复

### 可选增量

1. DeepSeek BYO key
2. team secrets 管理
3. Web / Mini Program 双 client 对照调试

### 明确不做

1. full RPC retirement
2. cold archive
3. 完整 admin 面

### Exit

1. Mini Program 能完成 login -> start -> input -> stream -> history
2. 有真实 gap 清单与修复闭环
3. 连续使用无阻塞 blocker

---

## 7. 我对 Opus v2 三段式的改写建议

如果要保留 Opus 的三段式外观，我建议至少改成下面的内容：

| Opus v2 | 我建议的改写 |
| --- | --- |
| zero-to-real-1: Foundation | **只做 auth + D1 thin schema + persisted history**，不要塞 conversation full rebuild |
| zero-to-real-2: Runtime 接真 + 用户态补齐 | **拆成两段**：先 real LLM/quota，再 user DO/WS/stateful orchestrator |
| zero-to-real-3: 对外 + 冷层 + first real run | **移除 cold layer 与 RPC**，聚焦 WeChat/Mini Program/real-run hardening |

也就是说，我更推荐 **4 段**，而不是 3 段。

原因不是形式主义，而是：

1. **real LLM** 和 **stateful user orchestrator** 都是大工程，不该放在同一波
2. **Mini Program/WeChat** 会带来独立调试维度，不该和底层架构重构重叠
3. **cold archive / RPC** 都不是 zero-to-real 的第一性用户价值

---

## 8. 推荐的 deferred/backlog 明细

以下内容我建议明确写成 **zero-to-real 之后** 的 backlog，而不是继续漂浮在本阶段：

1. internal RPC 全面推进
2. `/internal/*` HTTP 退役
3. DeepSeek per-tenant secrets 完整治理
4. quota policy / ledger / alerts 完整化
5. conversation participants / turns / message parts / context items 完整化
6. cold archive / R2 history offload
7. API key admin plane
8. richer admin product surface

---

## 9. 最终 verdict

### 9.1 对业主

你的方向判断是对的：  
**下一阶段不该继续停在文档、抽象或 façade polishing，而应该第一次把系统“真的跑起来”。**

### 9.2 对 Opus

Opus v2 的优点是：

1. 重新定义了正确的阶段目标
2. 找到了三份 context 真正能借鉴的地方
3. 把 `orchestration.auth`、D1、real LLM、user-level orchestrator 都纳入了同一张图

它的问题不是判断错，而是：

> **终态视野太完整，导致 first-wave 执行面仍偏重。**

### 9.3 我的最终推荐

**采用 `zero-to-real` 这个新名字。**  
**保留 Opus v2 的方向。**  
**但按本文的 Z0-Z4 切分执行，并把 cold archive / full RPC / full 06 / full 09 明确降级到后续 backlog。**

一句话收口：

> **zero-to-real 应该先追求“真实可用”，再追求“终态完整”，最后才追求“内部优雅”。**

