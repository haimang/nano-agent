# Zero-to-Real — 阶段规划探索性分析

> **文档性质**:`exploratory eval / discussion material`(**不是正式 charter**)
> **日期**:`2026-04-24`
> **作者**:`Claude Opus 4.7 (1M context)`
> **对话背景**:owner 在 orchestration-facade 收口之后提出下一阶段构想,本文基于 owner 的 4 点主题调整 + 对 5 个 target 问题的回答做独立分析。
> **目的**:作为后续更详细讨论的起点,**不约束具体实施** —— 目标是把隐含的依赖、潜在陷阱、合理的子阶段切分摆到台面,让后续 charter 起草更有料。

---

## 0. TL;DR

**"zero-to-real" 这个名字我喜欢**(比我之前建议的 first-real-run / beta-zero 都更有决断力,而且直接表达"从 0 到真" 的性格,不带 "first / minimal" 那种 hedging)。

接受 owner 的 4 项重塑后,这个阶段的**真实形状**是:

> **把 orchestration-facade 建好的 scaffold + façade 真正变成一个可用的多租户 SaaS-ready agent runtime。** 不是修小洞,是**把 5 个结构性空白一次性填上**。

5 个空白:

| # | 空白 | 当前事实 | 填法难度 |
|---|---|---|---|
| 1 | LLM provider 真 wire | `FAKE_PROVIDER_WORKER` 还是 fake,真 Gemini / CF Workers AI adapter 不存在 | **中**(写新 adapter,复用既有 1092 LOC llm-wrapper 框架)|
| 2 | 持久化 & 分层存储 | 完全没有 DB;DO storage 24h+100 retention;R2/D1/KV adapter 在 `packages/storage-topology/` 但 5 worker 均未 wire | **高**(DDL + 三级 tiering 策略 + 迁移 discipline)|
| 3 | Multi-tenant 动态化 | F4 固化为 `TEAM_UUID = "nano-agent"` static-per-deploy;agent-core DO `buildIngressContext` 不消费 forwarded tenant | **高**(触及 NACP tenant law + B9 tenant wrapper 语义)|
| 4 | Context compact 默认装 | Q3c 明确 opt-in,`AsyncCompactOrchestrator` testable 但未 default-wired;产线 turn loop 尚未真消费 compact | **中**(代码底子在,主要是 wire + 边界测试 + 分层交互)|
| 5 | 对外 API(auth issuer / admin / history)| orchestrator 只 verify JWT 不 mint;没有登录/注册/admin/session 列表 endpoint | **中**(新写,但 scope 可收窄)|

这是一个比 orchestration-facade **大 1.5-2 倍**的阶段。如果硬要 "一个 charter 全做",非常容易失焦。我建议**分 3 段,每段自成 charter-scale 子阶段**,而不是 6-8 个 phase 同 charter。

详见 §5。

---

## 1. 先接住 owner 的 4 项重塑

### 1.1 WeChat Mini Program 作为独立项目,**并行**开发

**同意,且这是正确的 decouple**。

理由:
- Mini Program 的**网络限制**(域名白名单、HTTPS-only、WS timeout、`wx.request` 非 fetch 语义)会真实反向压力测试 orchestrator 的 public contract
- 同时,Mini Program 的**生态约束**(openid 登录、支付宝/微信支付如果以后要收费)不应污染 orchestrator 本仓的 scope
- 独立仓库独立 agent,**契合你提到的"通过真实实验发现 gap"这一价值**:一个外部客户端用真实 WX network 跑起来,比在本仓写 synthetic client 找出的 gap 更代表真实情况

**隐含动作**(本仓需要补的):

1. 一个**稳定的外部 API 契约文档**供 Mini Program 那边直接对接(不是读代码猜,是读契约文档)
2. Mini Program 侧的 auth 不能直接用 HS256 JWT,所以本仓要补一个 **WeChat auth bridge** 逻辑(`wx.login code → code2session → 生成内部 JWT`)—— 这可以是 orchestrator 的一个新 route,不必独立 worker
3. 两边需要一个**轻量协同机制**(比如共享的 OpenAPI / NACP schema 说明),否则 "接口需求沟通" 会变成反复 ping-pong

### 1.2 "zero-to-real" 真正做的 4 件事(重读 owner 表述)

owner 的 4 点精简:

1. **继续加强 `orchestrator.core`** → 补 auth issuer、admin surface、history / session list
2. **llm-wrapper 实装** → 现有 1092 LOC 的框架 + openai-chat adapter(未 wire)→ 真实 Gemini / CF Workers AI
3. **agent loop context window compaction + 分层存储测试/修复/强化** → `AsyncCompactOrchestrator` default-wire + 冷热分层落实
4. **最小 DDL 设计与实装**(租户 / 用户 / session)→ 从零建 DB schema + D1 binding + migration

这 4 件事 + §1.1 的 auth bridge,合计 5 件。和我 §0 表格里的 5 空白对应一致。

---

## 2. Target Profile(基于 owner 5 个回答整理)

| # | 问题 | Owner 回答 | 对本阶段的直接含义 |
|---|---|---|---|
| 1 | 给谁用 | 先自己用,但**立刻拓展到 multi-tenant / multi-user** | 不能按 "先 single-tenant 跑起来再 migrate" 切片;**multi-tenant 是 day-1 投资**,否则后期 rewrite 成本 > 1 次做对 |
| 2 | QPS | 每用户并发 session 上限 + 每 tenant 准入上限,保守值,在外部 API rate limit 内 | 需要**配额层**(哪怕是 mock)。rate limit 不能靠运气,要有真 counter 或 gate |
| 3 | Retention | **永久**。未来冷热分层(热 DO / 温 D1 / 冷 R2)。agent runtime session 不可被清 | 当前 `user-do.ts:91-93 MAX_ENDED_SESSIONS=100 + ENDED_TTL_MS=24h` 需要**下线**或**重新语义化为"热层"**;D1 / R2 wiring 是硬需求 |
| 4 | Credit | 暂不收费,但**接口预留 + 强制走 mock 校验**。mock 可切 allow-all / insufficient-credit 等 | F4 的 `beforeCapabilityExecute` seam 必须**真 wire 到 production path**;mock implementation 作为 default;测试覆盖 allow/deny 双分支 |
| 5 | Tenant | **multi-tenant,SaaS 预留,且 NACP 强制要求** | agent-core DO 的 `buildIngressContext` 必须消费 forwarded authority;B9 tenant wrapper 语义从 static env 变为 per-request;5 worker wrangler 的 `TEAM_UUID` 配置逻辑要重新设计(可能从 `vars` 变成 per-request passthrough) |

---

## 3. 当前真实起点(代码级事实核查)

本节基于对 `workers/` 目录的核查,不是转述 closure 文档。

### 3.1 LLM 层

- **1092 LOC** 的 llm-wrapper 框架已在 `workers/agent-core/src/llm/`(attachment-planner / canonical / executor / request-builder / session-stream-adapter / stream-normalizer / usage 等)
- 唯一 adapter:`llm/adapters/openai-chat.ts`(322 行)—— **但未被 production 装配链消费**
- `llm/gateway.ts` 是 15 行 stub 注释 "Stub interface only — not implemented in v1"
- 生产路径靠 `env.FAKE_PROVIDER_WORKER` 服务绑定(见 `host/remote-bindings.ts:241-342`)—— 一个 **fake LLM provider worker**
- **结论**:框架级 ready,wire 层未真。写一个 Gemini adapter + 改 composition 让 kernel 走真 provider,是 G-wire-real-llm 的核心工作。

### 3.2 持久化层

- 所有 5 worker 的 `wrangler.jsonc` **无 D1 binding**(无 `d1_databases` 字段)
- R2 / KV adapter 在 `packages/storage-topology/src/adapters/` **存在但未被任何 worker wire**(`d1-adapter.ts / kv-adapter.ts / r2-adapter.ts / do-storage-adapter.ts` 全部 export-only)
- agent-core DO 存储走 B9 tenant wrapper(`tenantDoStorageGet/Put`),key 格式 `tenants/<team_uuid>/...`
- orchestrator-core user-do 存储走纯 DO storage KV,**无** tenant wrapper(因为一个 user DO 本就单 user)
- 当前 retention: ended session `24h + 100` 条上限 purge —— 与 owner "永久 + 分层" 期望完全相反
- **结论**:**DB 建设是 0 起步**。schema 要从零设计,binding 要从零 wire,retention 策略要重写。

### 3.3 Multi-tenant 层

- 5 个 worker 的 `wrangler.jsonc` 全部 `TEAM_UUID = "nano-agent"`(F4 确认 single-tenant-per-deploy)
- `agent-core/src/host/do/nano-session-do.ts:812-826 buildIngressContext` 只读 `env.TEAM_UUID`,不读 forwarded auth
- orchestrator `internal-policy.ts:validateInternalAuthority` **已经**检查 tenant claim 与 env.TEAM_UUID 一致(只过单值)
- `@haimang/nacp-core` tenant wrapper 按 key prefix 隔离 —— 本身支持多 tenant,只是当前 env 配置锁单 tenant
- **结论**:**协议层支持 multi-tenant,但部署层 + runtime consumption 层绑死 single**。打开 multi-tenant = 改 env 语义 + agent DO 消费 forwarded authority + 可能触及 wrangler 配置模式。

### 3.4 Context compact 层

- `workers/context-core/src/async-compact/` 目录存在(代码底子 ready)
- `AsyncCompactOrchestrator` 在 `agent-core/src/hooks/catalog.ts:245` 只被**注释**提及
- 无任何 worker 代码路径自动触发 compact;opt-in only
- **结论**:**框架齐,wire 未做**。default-on 的工作主要是 (a) composition factory 注入 compact delegate,(b) 处理 mid-turn compact 的 checkpoint 语义,(c) compact 后 layer 降级到 warm / cold 存储的衔接。

### 3.5 Credit hook

- `workers/bash-core/src/executor.ts:73,197-211,366-379` `beforeCapabilityExecute` seam 已存在 + fail-closed 实现
- 但 `workers/bash-core/src/worker-runtime.ts` 构造 `CapabilityExecutor` 时**不传** `beforeCapabilityExecute` 选项(F3-F5 review R4 确认)
- **结论**:**拉一根线的事**。配置一个 default mock(例如 env-driven 的 allow-all / deny-all / scripted)+ wire 到 worker-runtime 构造器。

### 3.6 对外 API

- orchestrator 当前 public routes:`GET / | GET /health | POST /sessions/:id/start | POST /sessions/:id/input | POST /sessions/:id/cancel | GET /sessions/:id/status | GET /sessions/:id/timeline | POST /sessions/:id/verify | GET /sessions/:id/ws`
- **无**:`/auth/login`、`/auth/refresh`、`/auth/wechat/bridge`、`/tenants`、`/users`、`/sessions`(list,不是 per-id)、`/history`
- **结论**:前端真用起来,至少需要 login + session list + history 三组,剩下的 admin 可以延后。

### 3.7 现状画像

**上下文管理方面**(@哈曼核心关心的方向):
- 上下文拼装 substrate(`context-assembler` / `budget` / `redaction` / `snapshot`)齐全
- compact substrate 齐全
- **但 production turn 当前不走 compact**,换句话说现在任何真实长 session 都会撑爆 token window —— 这是 "真实使用" 会第一时间撞上的问题

**稳定性方面**:
- probe + negative retirement 测试齐
- authority law + tenant truth + no-escalation enforce 齐
- **但 LLM 流真实延迟/错误/限流场景从未被跑过**,因为 fake provider 不产生真实错误类

**Skill 方面**(未提但想到):
- worker-matrix 明确 `skill.core` reserved + deferred
- owner 本阶段目标未包含 skill,合理延后到下下阶段

---

## 4. 这个阶段本质上是 5 个"真实化" track

把 §1.2 的 4 件事 + §1.1 auth bridge 展开,本阶段 5 个 track:

### Track A — Multi-tenant 动态化

- 把 `env.TEAM_UUID` 从"服务身份锁定"降格为"default tenant hint"
- agent-core DO `buildIngressContext` 改为消费 forwarded `x-nano-internal-authority.tenant_uuid`,不再信 env 作真相源
- B9 tenant wrapper 的 key prefix 改用 forwarded tenant(当前 nacp-core `tenantDoStorageGet/Put` 已接受 `team_uuid` 参数,语义改动在调用方不是 wrapper)
- orchestrator JWT 校验:`tenant_uuid` 从 optional 升为 **required**
- **风险**:B9 契约若要求 serving_team_uuid == DO's TEAM_UUID,改 forward 来源可能破坏现有 98/98 契约测试(需验)

### Track B — 真 LLM provider wire

- 选主 provider:CF Workers AI(低成本 / free tier)vs Gemini API(质量高但收费 / rate limit)。**建议 Gemini 做主、CF Workers AI 做 fallback**(因为 Workers AI 在 session coherence 上弱于 Gemini)
- 写一个 `llm/adapters/gemini.ts` 约 300 行(参照 `openai-chat.ts:322` 规模)
- 改 `composition.ts` 让 kernel 的 `llm_call` 走真 provider,不走 FAKE_PROVIDER_WORKER
- 保留 FAKE_PROVIDER_WORKER 作为 test env 路径(不要全移除,不然 worker unit test 跑不起来)
- rate limit handling:每 provider 的 429 / quota exceeded 需要 typed error(目前 llm-wrapper 的 errors.ts 只有通用错误)
- **风险**:kernel 对延迟敏感;真 LLM 调用 2-10 秒不等,turn loop 的 checkpoint / cancel 路径需要实测

### Track C — DDL + 分层存储

- D1 schema 设计(推荐最小 3 表 + 1 索引):
  - `tenants(id TEXT PK, name TEXT, created_at INT, quota_config_json TEXT)`
  - `users(id TEXT PK, tenant_id TEXT, openid TEXT?, email TEXT?, created_at INT, last_seen INT)`
  - `sessions(id TEXT PK, user_id TEXT, tenant_id TEXT, status TEXT, created_at INT, ended_at INT?, last_hot_key TEXT?, cold_r2_key TEXT?)`
  - index `(tenant_id, user_id, created_at DESC)` 供 session list 查询
- **重要**:session **runtime state**(turn / timeline / phase)**不放 D1**,继续在 agent-core DO;D1 只放 session meta + 冷 R2 key 指针
- R2 wire:使用 `storage-topology/src/adapters/r2-adapter.ts`,为 cold tier 存归档的 timeline / turn events
- 热温冷分层触发策略:
  - **热**(DO storage):active session + 最近 7 天 ended
  - **温**(DO storage 保留 meta + 聚合 + 少量 index,D1 存 meta)—— 其实我更倾向**跳过温层**,直接"热 → 冷"两级
  - **冷**(R2):ended 超过 7 天的 timeline 压缩后归档
- 迁移触发:alarm-driven periodic job in user DO(CF DO 支持 alarm API)
- **风险**:owner 说"agent runtime session 不可被清",这意味着即使 ended 后也要能 retrieve 完整 timeline。冷层 read latency 不能太差。

### Track D — Context compact default-wire

- `AsyncCompactOrchestrator` 通过 composition factory 注入 kernel delegate
- turn loop 在 `step_count > N` 或 `prompt_tokens > budget * 0.85` 时触发 async compact
- compact 结果 layer 替换 raw layer(这是 context-layers 已有行为)
- mid-turn compact 触发的 checkpoint 保持 B7 LIVE 契约(worker-matrix P5 硬闸)
- **与 Track C 交互**:被 compact 掉的 raw turn events 是否直接**归档到 R2 冷层**?还是保留在 hot 一段时间?—— owner 说 "逐级回归", 所以应该是 compact → warm → cold 的链路
- **风险**:compact 错误引起 context 丢失比不 compact 更严重;需要 golden path 测试覆盖到位

### Track E — 对外 API 补齐 + auth bridge

- 最小新增 route(估计 10-15 个):
  - `POST /auth/register`(或 delegate 到 WeChat)
  - `POST /auth/login`(以 tenant_id + credential 换 JWT)
  - `POST /auth/wechat/bridge`(微信 code 换 JWT)
  - `POST /auth/refresh`(refresh token)
  - `GET /users/me`
  - `GET /tenants/:id`(admin)
  - `GET /sessions`(per-user list,支持 paging)
  - `GET /sessions/:id/messages`(per-session history,paging,冷层透明读)
- JWT mint 机制:HS256 延用(现有 `signTestJwt` helper 可升为 production helper)或换 RS256 if we want public key verification
- rate limit / credit mock wire 在这里也要生效

---

## 5. 建议的子阶段切分(不是强制约束,仅供讨论)

这个阶段按我的估计要 **10-14 周**(3-4 人月)。一个 charter 覆盖全部五个 track 是危险的(orchestration-facade 是 6 个 phase / ~4 周,这个至少是它的 2.5 倍)。**我强烈建议拆成 3 个 charter 级子阶段**。

### Option A:按**依赖链**切(我的首选)

```
[zero-to-real-1: Substrate]
  ├─ Track A (multi-tenant 动态化)
  ├─ Track C (DDL + 分层存储,不含冷层实装)
  └─ Track E 的一部分(auth issuer + JWT mint + WeChat bridge)
  → 目标: 系统能正确多 tenant 登录、认证、存 session meta
  → 不涉及: 真 LLM / compact wire / admin surface

[zero-to-real-2: Runtime]
  ├─ Track B (Gemini adapter + composition 接真 provider)
  ├─ Track D (compact default-wire)
  └─ Credit mock hook wire(来自 bash-core beforeCapabilityExecute)
  → 目标: 真 LLM + 真 compact 跑得动
  → 依赖: zero-to-real-1 的 multi-tenant + 存储

[zero-to-real-3: Cold tier + Admin + First real run]
  ├─ Track C 冷层(R2 归档 + 透明 read)
  ├─ Track E 剩余(session list, history, admin)
  └─ Internal 5-10 人真实使用 + gap 收集
  → 目标: 系统能真正给人用
```

这种切法的好处:每个子阶段自成完整 exit(子阶段 1 结束时可以 demo "登录 + 起 session 但 LLM 还是 fake",子阶段 2 结束时 "真跑 agent loop",子阶段 3 才引入真实用户)。

### Option B:按**垂直切片**切(稳但慢)

不拆多个子阶段,而是在一个大 charter 内部做 "minimal vertical"(登录 + 单 tenant + 真 LLM + 一条会话)→ "scale out"(multi-tenant + compact + admin)两波。

这个更像 orchestration-facade 的风格,但 charter 会更大,内部 phase 更多。

### Option C:按**风险**切

先做 "反向探测"("我们的 tenant law 在 multi-tenant dynamic 下会不会爆?")、再做 "正向建设"(新功能),最后整合。这种适合架构级不确定性高的项目。

**我的推荐是 Option A**,原因:
- Track A + C 底层是 "同一次 DB 设计"(tenant schema),合并在一个子阶段才不会改两次
- Track B 真 LLM + Track D compact wire 互相依赖(compact 要知道 real prompt size,fake provider 下测不准)
- Track E 的 admin / history 需要 冷层(Track C 尾部)到位才能真 paginate,放最后合理

---

## 6. 真实盲点与未决问题

按重要度排列。这些是本阶段启动前**必须回答**的。

### 6.1 多 tenant 的**真正部署模式**未定

用户说 "multi-tenant, SaaS 预留, NACP 强制要求",但有两种实现:

- **Mode α:单部署 / N-tenant**(单 CF worker 部署,请求 per-tenant 路由)
- **Mode β:N 部署 / N-tenant 一对一**(每 tenant 一套 worker 部署,共享代码)

这两者对代码的要求截然不同:
- α 要求 `env.TEAM_UUID` 完全消失 / 变成 default fallback,所有 tenant 信息 per-request 来自 JWT
- β 每部署仍 `TEAM_UUID = <某 tenant>`,NACP tenant law 不变(保持 F4 闪存),但需要一个 "部署管理器" 来 provision 新 tenant 时 fork 新 CF worker

**α 是 SaaS 默认心智,也是 Mini Program 想接入的那种**;但 β 对 NACP 现有契约改动最小。

**Q for owner**:是 α 还是 β?

### 6.2 LLM provider 主选 + fallback 未定

提到 CF Workers AI + Gemini API。两种组合方式:

- **主 Gemini + fallback Workers AI**(质量优先,成本二)
- **主 Workers AI + fallback Gemini**(成本优先,质量二)
- **并行 A/B**(各 50%,测 quality/cost 曲线)

**Q for owner**:商业意图是什么?这决定 llm-wrapper 里的 provider chain 实现。

### 6.3 D1 vs DO SQLite vs KV 选择

Cloudflare 实际有 3 种 "SQL-ish" 选项:
- **D1**:SQLite per-worker-binding,全局 shared instance(多 worker 可共享 DB)
- **DO SQLite**(2024 新特性):每个 DO 实例有自己的 SQLite,天然 tenant/user 隔离
- **KV**:纯 key-value

最佳选择依赖用途:
- `tenants / users / sessions meta`:**D1 最合适**(全局查询,管理员能 JOIN)
- session runtime state:**DO SQLite 或 DO storage KV**(per-session 隔离)
- conversation history cold tier:**R2**

**Q for owner**:你接受 D1 + DO SQLite 混用,还是全 D1?(后者多 worker 共 1 DB 性能瓶颈可能出现)

### 6.4 Retention "永久" 的具体含义

"永久" 有几种:
- **纯永久**:永远不删,即使 abandonment
- **永久 except opt-out**:user 主动删除
- **永久 but tier-demoted**:本地 DO 只留 7 天,R2 永久
- **永久 except tenant-level TTL**:合规要求 tenant admin 可以设策略(GDPR 等)

**Q for owner**:这决定 tier 策略,也决定冷层是否需要支持 delete。

### 6.5 Agent runtime session "不可清空" 与冷层的兼容

owner 明确说 "agent runtime session 不能被清空"。但冷层归档后,DO 内的 session state 被清理是合理的(不然 DO 占用无限增长)。这里的分界:
- **runtime state**(turn / phase / checkpoint):热层,session active 时持久
- **completed turn events / messages**:可以温 → 冷降级
- **session 元数据**(id, user_id, created_at):D1 永久

我的理解是 owner 意图是 (3) "历史不能丢失,但 runtime 可以 evict"。**请 owner 确认此解读**。

### 6.6 Credit mock 的**校验粒度**

三个候选粒度:
- **per-capability**(每个 bash 命令执行前查一次 quota)—— 当前 `beforeCapabilityExecute` hook 的设计
- **per-turn**(每个 LLM turn 前查一次)
- **per-session-start**(session 开始时预检查一次)

**Q for owner**:三者都 mock 到位,还是只做 per-capability 作为 F4 seam 的直接消费?

### 6.7 NACP 协议是否需要 bump 版本

如果 multi-tenant 从 static env 变 per-request authority:
- `@haimang/nacp-core` 的 tenant wrapper 当前要求 `serving_team_uuid` 参数。接口不变,但**调用方语义**变了。
- NACP protocol version 可能不需要 bump,但 **tenant wrapper 的文档**必须 update
- B9 契约测试(`test-legacy/` 下的那些 tenant wrapper tests)需要重跑验证

**Q for owner**:nacp-core / nacp-session 是否接受此轮再发一版(1.4.1 / 1.3.1 patch)?

---

## 7. 对 "找 gap 修 gap" 方法论的看法

owner 说 "通过实验发现全部的 gap, 然后对 gap 进行修复"。这个心智**方向对**,但有两个 nuance:

### 7.1 "真实使用" 找到的 gap 分类

至少 4 种 gap 会在实验中被发现,这 4 种**修复时机不同**:

1. **架构 gap**(比如 tenant law 崩)—— 必须立刻停机修
2. **UX gap**(比如 reconnect 后用户看不到之前 message)—— 可以排期修
3. **性能 gap**(比如 LLM 延迟让 turn 看起来卡)—— 可能是 provider 问题,不一定是我们的 bug
4. **生态 gap**(比如 WeChat WS 超时 30s 断)—— 是 Mini Program 侧 adapt,不是本仓修

**建议**:在 zero-to-real-3 的"真实使用"子阶段内部,预留一个 **gap triage sheet**,每个 gap 归类 1-4,再决定修复 phase 归属。

### 7.2 "首先自己用" 的隐性盲点

如果第一波用户就是开发者自己,发现的 gap 偏技术。真实外部用户(非技术)会撞到**我们预想不到的场景**:
- 开中文名字的输入处理
- 超长 message 粘贴
- WeChat 输入法 candidate list 干扰
- 移动网络切换时的 ws 断线

所以即使自己先用,**也要尽早把 Mini Program 交给 1-2 个非开发者朋友用 1 周**,那里的 gap 比开发者自测更贵重。

---

## 8. Orchestration-facade 留下的 follow-up 在此阶段的处理建议

从 F3-F5 review 带过来的 6 条 follow-up,按本阶段 track 归属:

| F3-F5 R | 描述 | zero-to-real 归属 |
|---|---|---|
| R1 | `deriveCanonicalUrl` hostname 脆弱 | Track E(对外 API 整理时顺手用 env var 替换)|
| R2 | SessionEntry lifecycle vs agent DO phase 无 mapping | Track C(DDL 设计时冻结 session status enum,mapping 落 doc)|
| R3 | `forwardInternalRaw` 死代码分支 | 非本阶段必做,可 skip |
| R4 | bash-core hook 未 wire 的 closure 口径 | Track B/D + credit mock wire 时顺便消掉 |
| R5 | cross-e2e/11 hook 未 wire 隐式假设 | 同 R4 |
| R6 | `x-nano-internal-authority` header 无大小护栏 | Track A 改 authority 消费时顺手加 |

**没有一条是本阶段 blocker**,都是 during-track 的 cleanup。

---

## 9. 粗略的规模预估

| Track | LOC 新增估 | 测试新增估 | 本阶段外部依赖 |
|---|---|---|---|
| A Multi-tenant 动态化 | ~300 | ~15 unit + 5 integration | nacp-core 可能 patch |
| B Gemini adapter wire | ~500(adapter)+ 200(composition 改)| ~20 unit + 2 live | Gemini API key + quota |
| C DDL + 分层 | ~800(schema + migration + DAL)+ 400(R2 冷层)| ~30 unit + 10 integration | D1 instance provision |
| D Compact wire | ~300(wire 逻辑)+ 测试 | ~15 integration | 无 |
| E API + auth bridge | ~600 | ~25 unit + 10 live | 微信 AppID(bridge 用)|

合计:~3100 代码 / ~130 测试。

作为对比:orchestration-facade 阶段新增约 `1500 LOC + 35 package-e2e`。**zero-to-real 大约是它的 2 倍**。

---

## 10. 给下一步讨论的 open questions(整理)

排序按"决策阻塞度"高到低:

1. **多 tenant 实施 Mode α vs β?**(§6.1)
2. **D1 vs DO SQLite vs 混用?**(§6.3)
3. **LLM provider chain 首选 Gemini 还是 Workers AI?**(§6.2)
4. **Retention "永久" 具体语义是?**(§6.4 + §6.5)
5. **Credit mock 校验粒度?**(§6.6)
6. **子阶段切分接受 Option A 吗?**(§5)
7. **NACP 协议是否允许 patch 一轮?**(§6.7)

---

## 11. 一句话总结

> **接受 "zero-to-real" 这个名字和主题。但 5 个 track(multi-tenant 动态化 + 真 LLM wire + DDL 分层存储 + compact default + auth/admin API)规模合计是 orchestration-facade 的 2 倍,强烈建议切成 3 个 charter 级子阶段(substrate → runtime → cold tier+admin+first run),不是 1 个 charter 多 phase。先答 §10 的 7 个 open questions 再起 G0 design freeze。**

---

## 12. 版本历史(初版)

| 版本 | 日期 | 修改者 | 变更 |
|---|---|---|---|
| v0.1 | 2026-04-24 | Claude Opus 4.7 (1M context) | 基于 owner 4 项主题调整 + 5 个 target 回答的探索性分析。核查当前代码起点(LLM / 持久化 / multi-tenant / compact / credit / API 6 个维度),识别 5 个真实化 track + 7 个 open questions。建议 Option A 三段式切分但保留讨论空间。**未参考任何其他 reviewer 对相关话题的文本**。

---

## 13. 追加章节:吸收 `context/smind-admin` + `context/ddl-v170` 后的重大判断更新

> 追加日期:`2026-04-24`
> 触发:owner 补充两个关键上下文仓库 + 对 "D1 vs DO SQLite" 的澄清
> 性质:**初版判断的重大修正**。我承认 v0.1 的部分分析基于对上游 smind 生态不了解而做出的草率推断 —— 尤其是 §6.3 (D1 vs DO SQLite)、§6.6 (credit mock)、§4 Track C/E 的 scope 估计。

### 13.1 Owner 解释回填(作为本阶段的 first-principle 真相)

Owner 对 "D1 vs DO SQLite" 的澄清:

> **D1 ← 整个系统的 DDL 与数据库。承担全部业务数据、流转、持久化状态。是系统运行的基石。**
>
> **DO SQLite ← 由 user-based DO 持有,存储以用户为边界的热数据。包含用户可能本身需要的秘钥、热上下文、以及其他状态配置(比如 alarm 启动需要的内容)。几乎都是热的,以用户为强边界。**
>
> **这两者是互补状态:D1 负责稳定 / 即时 / 可观测性;DO SQLite 是用户的唯一内容,与每一个用户自身挂钩。**

**这句话 reframe 了 v0.1 §6.3 整个问题**。我当时把 "D1 vs DO SQLite" 当成二选一,其实是**分工协作**:

| 层 | 载体 | 性质 | 例子 |
|---|---|---|---|
| **系统稳定态** | D1 `smind-db-v170` | 行级 tenant 隔离、可观测、跨 worker 共享、可被 admin panel / BI 读 | tenants、users、memberships、conversations、turns、messages、quota_balances、usage_events、billing_ledger |
| **用户强边界热态** | DO SQLite(per-user DO) | per-user 独占、低延迟、随用户 scale、alarm-driven | 用户秘钥缓存、当前活跃 session 的热 context、未 flush 的 turn 事件、alarm schedule、用户个人偏好运行态副本 |

这个区分比我 v0.1 的任何 "混用策略" 表都更清晰。**我撤回 v0.1 §6.3 "D1 vs DO SQLite vs 混用?" 这个问题本身** —— 它是伪问题。真问题是"**某一具体数据归属 D1 还是 DO SQLite?**",那是设计时逐条字段判断的事,不是阶段级 open question。

### 13.2 两个上下文仓库的事实档案

#### 13.2.1 `context/smind-admin`(v170-dev 分支)

- **身份**:SourceMind v1.7.0 Admin Worker,**系列的上游 auth 起点**
- **规模**:40 个 TS 文件,`package.json` 1.7.0,依赖 `@haimang/smind-smcp 1.7.0 + jose 5.10 + itty-router 4.2 + zod 4.1`
- **git 状态**:当前 `v170-dev` 分支,远端有 `main / dev / v5.0-refactor / main-backup / backup` 多条分支,说明这是一个长期维护的 production worker(v5.0 旧版本现在被 v1.7.0 重写所替代)
- **实装的完整能力**(都是 production,**不是 mock**):
  - **Auth issuer**:`POST /v1/auth/register | /v1/auth/login | /v1/auth/password/reset | /v1/auth/validate-api-key`,JWT 用 `jose` 库 HS256,7 天 exp
  - **Tenant admin**:`POST/GET/PATCH /v1/team`
  - **API key**:`GET /v1/team/api-keys | POST /v1/team/api-keys | DELETE /v1/team/api-keys/:id` — **SaaS server-to-server auth 已有**
  - **User self-service**:`GET/PATCH /v1/users/me`
  - **Workflow**:`GET/POST /v1/workflows`
  - **Uploads**:`POST /v1/uploads/{initiate,confirm,url-submit,api-submit}` + R2 FILES_BUCKET / STATIC_BUCKET
  - **Storage quota**:`GET /v1/storage/quota` + 初始化
  - **Static files**:CDN 类的文件代理 upload
  - **Legacy SMCP compat 层**:`compat/legacy_smcp.ts` + `compat/console_backfill.ts` — 向下兼容旧客户端
  - **Internal RPC**:`http/internal.rpc.ts` —— worker-to-worker 内部 gate
  - **Team membership middleware**:`middleware.team.ts` — 请求级 tenant 上下文解析
  - **双重认证模式**:`middleware.auth.ts` 同时支持 `Authorization: Bearer <JWT>` 和 `X-API-Key: <key>`,API key 模式下自动 resolve 到 `{user_uuid: "system-api-key", team_uuid, team_plan_level}`
  - **JWT claim schema**(重要):`{uuid: user_uuid, tid: team_uuid, tpl: team_plan_level}`
- **wrangler config**:
  - `[[d1_databases]] binding = "DB" database_name = "smind-db-v170"`
  - `[[r2_buckets]] binding = "FILES_BUCKET" bucket_name = "smind-files-v170"`
  - `[[r2_buckets]] binding = "STATIC_BUCKET" bucket_name = "smind-static-v170"`
  - `[[queues.producers]] binding = "CLEAN_DISPATCHER_INTAKE_QUEUE"`
  - `[vars] JWT_SECRET_KEY / PASSWORD_SALT / ADMIN_INTERNAL_SECRET` 都是必需 secret

#### 13.2.2 `context/ddl-v170`(12 模块,~9222 行 SQL,锚定 Cloudflare D1)

12 个模块全景:

| 模块 | 行数 | 核心表群 | 对 nano-agent 的相关性 |
|---|---|---|---|
| 01 tenant-identity | 777 | `smind_users / smind_user_profiles / smind_user_identities / smind_teams / smind_team_memberships / smind_team_invites / smind_team_api_keys / smind_team_storage` | **必引**(multi-tenant 核心) |
| 02 workflow-control-plane | 705 | 工作流 DAG / 步骤模板 | 低 — 若引入 smind workflow 整合才用 |
| 03 asset-files | 632 | 文件元数据 / 文件夹层级 / R2 对象指针 | 中 — 如果需要 "用户上传文件到 agent" |
| 04 runtime-process-execution | 861 | runtime step runs / process state | **可能引** — agent turn loop 的 持久化 runtime state 可映射到此 |
| 05 knowledge-vector-retrieval | 848 | knowledge base / chunks / vector embeddings | **可能引** — RAG 实装的话(用户曾提到 compaction 与 retrieval) |
| 06 conversation-context-session | 969 | `smind_conversations / smind_conversation_sessions / smind_conversation_turns / smind_conversation_messages / smind_conversation_message_parts / smind_conversation_context_snapshots / smind_conversation_context_items` | **必引**(agent session 持久化) |
| 07 content-cms-publication | 975 | CMS 发布 | 无关 |
| 08 crm-contact-lead | 1095 | CRM 联系人 / 线索 | 无关 |
| 09 tenant-billing-quota-usage | 981 | `billing_plan_catalog / billing_team_subscriptions / billing_team_entitlements / billing_invoices / billing_credit_ledger / usage_meter_definitions / usage_events / usage_rollups_daily / quota_policies / quota_balances / quota_ledger_entries / quota_alert_events` | **建议引 quota 子集**(替代 v0.1 里的 credit mock) |
| 10 skill-capability-tasks | 412 | skill 定义 / task 流 | skill.core 延后,不引 |
| 11 inbox-intake-messaging | 353 | inbox / intake 消息 | 无关 |
| 12 project-collaboration | 614 | 项目协作 | 无关 |

**设计哲学**(出自 README §0.1):

> - **多租户行级隔离**:每条业务数据通过 `team_uuid` 归属到一个租户,这是所有查询的第一过滤条件。
> - **资源-修订分离**:内容实体采用 "资源主表 + 修订版本表" 双表结构,确保历史不可变、发布原子切换。
> - **逻辑外键 + 应用层保证**:底层为 SQLite/D1,外键约束以注释形式表达,数据完整性由应用层保证。

这三条**就是** nano-agent 现在最需要的 multi-tenant discipline。

### 13.3 v0.1 判断的 5 条重大修正

#### 修正 1:Multi-tenant Mode α vs β — **答案明确,Mode α**

v0.1 §6.1 问 "单部署 N-tenant(α)vs N 部署 N-tenant(β)"。

**答案明确为 α**。证据:

- smind-01 DDL 所有业务表都有 `team_uuid TEXT NOT NULL`,按行过滤 tenant
- smind-admin 是 **单** worker 服务 N 个 tenant
- README 明确说 "多租户行级隔离" 是 first design principle
- 整个 smind 生态都是 α

**对 nano-agent 的含义**:
- 沿用 Mode α。`agent-core` 的 DO `buildIngressContext` 必须消费 forwarded `team_uuid`(from JWT),**不能再读 env.TEAM_UUID 作真相**
- F4 固化的 `TEAM_UUID = "nano-agent"` 单 env 配置需要语义降级为 "default fallback",不再是真相源
- NACP B9 tenant wrapper 继续使用 key prefix `tenants/<team_uuid>/`,但 `team_uuid` 参数来自 forwarded authority,不来自 env

#### 修正 2:Credit mock → Quota 真实系统(smind-09)

v0.1 §6.6 问 "credit mock 校验粒度"。

**答案**:不需要 mock。smind-09 DDL 已提供完整 production-grade quota/billing:

- `smind_usage_meter_definitions`:定义 "token 消耗 / step 数 / storage_bytes / message_send 等" meter
- `smind_usage_events`:每次 capability 消费写一条事件
- `smind_usage_rollups_daily`:日聚合
- `smind_quota_policies`:per-tenant 或 global 的配额策略(scope: global / tenant / plan)
- `smind_quota_balances`:实时余额(热计数器)
- `smind_quota_ledger_entries`:扣减 / 回补账本
- `smind_quota_alert_events`:快到上限预警

这就是 `beforeCapabilityExecute` hook 应该挂的真实逻辑:

```
beforeCapabilityExecute({plan, requestId}):
  meter = mapCapabilityToMeter(plan.capabilityName)   // bash.exec → step
  balance = SELECT available FROM smind_quota_balances
    WHERE team_uuid = forwardedTenant AND meter_code = meter
  if balance <= 0:
    throw new InsufficientQuotaError(meter)
  // pre-reserve (optional): UPDATE balance -= estimated_cost
```

执行完成后写 `smind_usage_events`,日聚合 job 维护 `quota_balances`。

**对 nano-agent 的含义**:
- v0.1 Track D 或 Track C 里的 "credit mock" 删除,替换为 "quota hook 实装(消费 smind-09)"
- `bash-core/src/executor.ts::beforeCapabilityExecute` 的 production wire 不再是 mock,而是真实 D1 query + ledger write

#### 修正 3:Auth 层完全不需要自己写

v0.1 §4 Track E 规划了 "auth issuer + /auth/login + /auth/wechat/bridge"。

**全部已存在于 smind-admin**。nano-agent 要做的只有:

- **接入** smind-admin 签发的 JWT(通过 `JWT_SECRET_KEY` 共享或通过 smind-admin 的 `/v1/auth/validate-api-key` 接口 federate)
- 对齐 JWT claim schema(见修正 4)
- WeChat Mini Program 的 auth bridge:**可能已被 smind-admin 解决**(识别 `identity_provider` 字段在 smind_user_identities 表,说明 smind 已支持多 provider,包括 WeChat)—— 需要进一步核查 smind-admin 的 user.service.ts 是否已有 wechat identity creation

**对 nano-agent 的含义**:
- v0.1 Track E 规模从 ~600 LOC 降到 ~200 LOC(只剩 session list / history 两类 endpoint + 可能的 federate thin layer)
- 如果 WeChat bridge 已在 smind-admin,**nano-agent 这边完全零改动**;WeChat Mini Program 直接调 smind-admin 登录拿 JWT

#### 修正 4:JWT claim schema **需要协调**(new gap)

v0.1 没提。现在核查发现:

- **smind-admin 的 JWT**:`{uuid: user_uuid, tid: team_uuid, tpl: team_plan_level}` — 极简 3 字段
- **nano-agent orchestrator 当前期望**:`{sub, realm?, tenant_uuid?, membership_level?, source_name?, exp?}` — 6 字段(`sub` 是 JWT 标准 claim)

**冲突**:字段名完全不同。`uuid` vs `sub`、`tid` vs `tenant_uuid`、`tpl` vs `membership_level`。realm / source_name 在 smind JWT 里不存在。

**推荐修法**(nano-agent 作为 downstream,应该适应 upstream):

- orchestrator-core `auth.ts::verifyJwt` 改为接受 smind claim 格式
- 字段映射:`uuid → sub`、`tid → tenant_uuid`、`tpl → membership_level`
- `realm / source_name` 在 smind JWT 里不存在,就让 orchestrator 去掉这两个要求,或从 smind_user_profiles 表 fetch(如果真的需要)
- 这是一个 ~30 LOC 的改动,简单

#### 修正 5:Conversation 层级(v0.1 里完全没考虑)

v0.1 只有 session。现在发现 smind DDL 层级是:

```
smind_users (1) ──┬── smind_conversations (N)
                   │        │
                   │        └── smind_conversation_sessions (N)
                   │                  │
                   │                  └── smind_conversation_turns (N)
                   │                           │
                   │                           └── smind_conversation_messages (N)
                   │                                    │
                   │                                    └── smind_conversation_message_parts (N)
```

- **conversation**:用户发起的一个 "主题" / "窗口",可能跨天,可能多个 session 属于同一个
- **session**:runtime 级别的一次交互 session(对应当前 nano-agent orchestrator 里的 session_uuid)
- **turn**:单次用户输入 → agent 输出的一轮
- **message**:turn 里的一条消息(user / assistant / tool)
- **message_part**:消息的一个 chunk(text / image / tool_call / tool_result)

**对 nano-agent 的含义**:
- 当前 orchestrator user DO `active_sessions: Map<session_uuid, ...>` 是**直接按 session 索引**,缺少 conversation 聚合层
- 引入 smind DDL 意味着:
  1. user 发起新对话时,先创建 conversation,再创建 session 挂在 conversation 下
  2. UI 显示用户的 "conversation 列表",每个 conversation 可展开看历史 session / turn / message
  3. `session list` endpoint 变 `conversation list` + `conversation.sessions` 展开
- 这是**user-facing 的重要信息架构变化**,需要在 G0 明确

### 13.4 原 7 个 open questions 的重估

按 v0.1 §10 顺序:

| # | v0.1 问题 | 13.x 重估后状态 |
|---|---|---|
| 1 | 多 tenant Mode α vs β | ✅ **已回答:α**(via smind-admin + ddl-v170)|
| 2 | D1 vs DO SQLite vs 混用 | ✅ **伪问题消解**:D1 是业务稳定态,DO SQLite 是用户边界热态,互补分工,非二选一 |
| 3 | LLM provider Gemini 主还是 Workers AI 主 | ❓ **仍需 owner 决策**(smind 生态没直接答)|
| 4 | "永久" retention 具体语义 | ✅ **部分回答**:smind-06 DDL 已是"永久持久化在 D1"模型,R2 冷归档是 optimization,用户 delete 走软删(多数表有 `time_deleted_at` 或 `status` 字段) |
| 5 | "agent runtime session 不可清空" | ✅ **在 smind 模型下清晰**:runtime state 可 evict 到 D1 持久记录;D1 的 conversation_turns / messages 表是永久真相 |
| 6 | Credit mock 校验粒度 | ✅ **伪问题消解**:不 mock。用 smind-09 的真实 quota hook |
| 7 | NACP 协议 patch 一轮? | ❓ **仍需评估**:取决于 nano-agent 是否 reuse smind JWT(若是,NACP JWT-related claims 需要 align) |

**7 个 → 2 个仍需 owner 决策**。

### 13.5 新出现的 open questions

吸收 smind 上下文后,**新**的决策点:

#### Q-A:nano-agent ↔ smind-admin 拓扑关系

三种候选:

- **α. Federate(松耦合)**:nano-agent 独立部署独立 D1,smind-admin 签 JWT 后 nano-agent 通过 `/v1/auth/validate-api-key` 类的 API 验证。用户相关数据 nano-agent 通过 smind-admin RPC 读。
- **β. Shared D1(中耦合)**:nano-agent 和 smind-admin 共用 `smind-db-v170` D1,nano-agent 直接 SQL 读 `smind_users / smind_teams`,写 `smind_conversation_*`。不通过 smind-admin RPC。
- **γ. Absorb(紧耦合)**:把 smind-admin 源码吸收到 nano-agent,成为 orchestrator-core 的一部分。smind 生态有两个独立 auth 实现。

**推荐 β**。原因:
- α 的 RPC 开销对每请求都要命(orchestrator 每 session.start 都要调 smind-admin 一次)
- γ 违背 "smind-admin 是 smind 系列上游 auth 起点" 的定位,重复代码
- β 最自然:**smind 生态的 workers 都共享一个 D1**,nano-agent 作为其中一员

#### Q-B:JWT_SECRET_KEY 共享策略

如果采用 Q-A β:
- `smind-admin` 和 `orchestrator-core` 必须用**同一个** `JWT_SECRET_KEY`
- 这是一个 cross-worker shared secret,需要严格 rotation discipline
- wrangler secret 本身不支持 "multi-worker 共享"(需要在每个 worker 上分别 `wrangler secret put`)
- 如果 rotate,需要两侧 atomic 切换

#### Q-C:DDL 引入粒度

- **Min set**(最小必要):01 tenant-identity + 06 conversation/session → ~1746 LOC SQL 应用到 D1
- **Recommended set**:min set + 09 quota subset(usage_events + quota_balances + quota_policies + usage_meter_definitions)→ ~2400 LOC
- **Full integration**:min set + 09 完整 + 04 runtime + 05 knowledge → ~3636 LOC

推荐 **Recommended set**。理由:
- 没有 quota,`beforeCapabilityExecute` 仍然是 mock,违反 owner 的 "credit 校验强制走,allow/deny 可切 mock" 要求
- 04 runtime 现在和 agent-core DO 重复(DO 里已经有 turn state),先不引
- 05 knowledge 留给 skill.core 或 future RAG charter

#### Q-D:nano-agent 是否写入 `smind_conversation_*` 表

如果 Q-A 选 β,nano-agent 会直接写 conversation / session / turn / message 表。但这些表现在可能被其他 smind worker(如 smind-contexter v170,如果迁到 v170 了)同时写入。

- **Option A**:nano-agent 是 `smind_conversation_sessions` 的**唯一** writer(其他 smind worker 只读)
- **Option B**:multi-writer,各 worker 写自己负责的 session 类型(需要 discriminator 字段,e.g. `session_type IN ('agent_loop', 'chat_rag')`)

这影响 smind-06 DDL 是否需要 patch(加 `session_type` 字段)。

#### Q-E:WeChat 登录路径

smind_user_identities 表有 `identity_provider` 字段,说明 smind 预留了多 provider。**但需要核查 smind-admin 是否已有 WeChat code2session 实现**。如果没有,Track E 仍然需要补一个 WeChat bridge(可加在 smind-admin 而不是 nano-agent,这样 nano-agent 完全不改)。

#### Q-F:Legacy SMCP compat 层 nano-agent 要不要写

smind-admin 维护 `compat/legacy_smcp.ts` 和 `compat/console_backfill.ts` —— 这是因为有旧 SMCP 客户端要兼容。

- **如果 nano-agent 是 SaaS 新产品**:不需要 legacy compat,清爽上线
- **如果 nano-agent 要被现有 smind console 消费**:需要维护 legacy 接口

### 13.6 zero-to-real 阶段 scope 重估

**v0.1 预估**:~3100 LOC / ~130 测试 / 3-4 个月

**v0.2 重估**(吸收 smind 上下文后):

| Track | v0.1 估算 | v0.2 估算 | 变化原因 |
|---|---|---|---|
| A Multi-tenant 动态化 | ~300 LOC | **~200 LOC** | smind-01 DDL + smind-admin 已是 reference;主要改 `buildIngressContext` + nacp-core tenant wrapper 调用方 |
| B LLM provider wire | ~500+200=~700 LOC | **~700 LOC**(不变)| smind 不影响 LLM 选择 |
| C DDL + 分层存储 | ~800+400=~1200 LOC | **~600 LOC** | DDL 复用 smind-01/06/09,主要工作是 D1 binding + query layer + DO↔D1 衔接;R2 冷层归档复用 smind-admin 的 R2 pattern |
| D Compact default-wire | ~300 LOC | **~300 LOC**(不变) | 内部 wire 不变;但 compact 落点可能改为写 smind_conversation_context_snapshots |
| E 对外 API + auth bridge | ~600 LOC | **~250 LOC** | auth/register/admin 全部复用 smind-admin;nano-agent 只补 session list / conversation list / history endpoints |
| F (新)Quota hook 实装 | — | **~250 LOC** | 替代原 "credit mock",消费 smind-09 真表 |
| G (新)conversation 聚合层 | — | **~300 LOC** | user DO 里加 conversation 管理,session 归属到 conversation |

**v0.2 合计**:~2600 LOC / ~100 测试 / **2-2.5 个月**

**降幅**:~15-20% LOC,~25-30% 时间。**最大节省来自 auth 层完全不需要自写**。

### 13.7 子阶段建议重写(用修正后的认知)

v0.1 §5 Option A 三段式仍然合理,但**内容重新填装**:

```
[zero-to-real-1: Substrate integration]
  ├─ Track A  (multi-tenant 动态化 + NACP tenant wrapper 调用方改造)
  ├─ Track C  (D1 binding 接 smind-db-v170 + 查/写 smind-01/06 子集)
  ├─ Track E 简化版 (接入 smind-admin JWT + claim 协调 + session/conversation list API)
  └─ Track G  (conversation 聚合层加到 user DO)
  → 目标:登录流走 smind-admin,session 起得来且业务数据持久化到 D1
  → 不涉及:真 LLM / compact wire / quota

[zero-to-real-2: Runtime 接真]
  ├─ Track B  (Gemini adapter + composition 接真 provider)
  ├─ Track D  (compact default-wire,compact 结果落 smind_conversation_context_snapshots)
  └─ Track F  (quota hook wire,beforeCapabilityExecute 消费 smind_quota_balances)

[zero-to-real-3: Cold tier + first real run]
  ├─ R2 冷层 wire(归档超期 conversation 到 R2,D1 留 meta + 冷层 key 指针)
  ├─ DDL 09 完整落(billing_ledger / usage_rollups_daily 等)
  └─ 内部 5-10 人真实使用 + gap 收集 + WeChat Mini Program 接入
```

### 13.8 最需要 owner 回答的(新 5 问)

按决策阻塞度:

1. **Q-A 拓扑**:nano-agent 与 smind-admin 是 β(shared D1)还是 α(federate)?
2. **Q-B 若 β,JWT_SECRET_KEY rotation discipline 如何?**
3. **Q-D 若 β,nano-agent 是 `smind_conversation_sessions` 的唯一 writer 还是需要 session_type 字段区分?**
4. **Q-C DDL 引入粒度:Min / Recommended / Full?**(我推荐 Recommended)
5. **Q-E WeChat 登录**:smind-admin 是否已支持 WeChat provider?若否,加在 smind-admin 还是 nano-agent?

v0.1 里保留但未回答的:

6. LLM provider 主选(Gemini vs Workers AI)— 还是需要 owner 决策

### 13.9 一句话总结重估

> **v0.1 里我以为 zero-to-real 是 "在 scaffold 上从零建 auth/DB/quota/API"。吸收 `context/smind-admin` + `context/ddl-v170` 后,真相是:**
>
> **"auth + tenant admin + DB schema + quota + R2 file layer 的 production-grade implementation 已在 smind 生态里现成可用。nano-agent 在 zero-to-real 真正的工作是(a)把 agent runtime 正确接入 smind 生态的 D1 与 auth 层,(b)真 LLM provider wire,(c)compact default-wire,(d)把 quota hook 消费 smind-09。"**
>
> **阶段 scope 因此缩小 ~20%,时间缩短 ~25%。阶段**性质**也变了 —— 不是 "建新系统",是"把 nano-agent 嵌入 smind 生态"。**

### 13.10 对 owner 解释的 "D1 vs DO SQLite" 的回填

把 owner 的澄清作为本阶段 first-principle 真相,贯穿全部设计决策:

**存储归属判定规则**(从 owner 解释推出):

| 数据类别 | 归属 | 理由 |
|---|---|---|
| tenant / team / user / membership / api_key | **D1**(smind-01) | 跨 worker 共享、admin panel 要读、合规审计要 JOIN |
| conversation / session / turn / message / message_part | **D1**(smind-06) | 永久持久化、用户可跨设备读历史、BI 要统计 turn 质量 |
| usage_event / quota_balance / quota_ledger | **D1**(smind-09) | 账本级一致性、跨 worker 扣减、对账要 query |
| session runtime state(turn 进行中的 kernel action snapshot / pending attachment / alarm schedule)| **DO SQLite**(per-user DO) | 低延迟、per-user 边界、临时性 |
| 用户秘钥缓存(e.g. refresh token snapshot / WeChat openid session)| **DO SQLite** | 每用户一份、不用跨用户 query、rotation 时整体 evict |
| 当前活跃 session 的热 context layers(compact 前的原始 turn 事件)| **DO SQLite** | compact 后降级到 D1 smind_conversation_context_snapshots,再冷归档到 R2 |
| 用户个人偏好运行态副本(`initial_context_seed` 热化版本)| **DO SQLite** | 每请求都要读,从 D1 smind_user_profiles read-through cache |
| 文件二进制(attachments / snapshots)| **R2** | 大 blob、CDN 友好 |
| 冷归档的 conversation timeline | **R2** + D1 指针 | 超期 conversation 压缩归档,D1 smind_conversation_sessions 保留 meta + `cold_r2_key` 指针 |

**这张表是 Track C 的 schema design 直接指南**,不需要另起设计 doc。

---

## 14. 版本历史(追加)

| 版本 | 日期 | 修改者 | 变更 |
|---|---|---|---|
| v0.1 | 2026-04-24 | Claude Opus 4.7 (1M context) | 初版探索性分析 |
| v0.2 | 2026-04-24 | Claude Opus 4.7 (1M context) | **追加 §13 重大修正**:吸收 `context/smind-admin`(40 TS 文件 v1.7.0 production worker)+ `context/ddl-v170`(12 模块 9222 行 D1 DDL)后,撤回 v0.1 的 5 条判断(multi-tenant mode / credit mock / auth 自写 / D1 vs DO SQLite 二选一 / scope 规模)。接受 owner "D1 = 业务稳定态 / DO SQLite = 用户边界热态互补" 的澄清作为 first principle。原 7 open questions 里 5 条已由 smind 上下文回答,新出 5 个更聚焦的拓扑 / secret / DDL 粒度问题。阶段 scope 从 ~3100 LOC 降至 ~2600 LOC,时间从 3-4 月缩至 2-2.5 月。阶段性质从 "建新系统" 重定义为 "嵌入 smind 生态"。**独立完成,未参考任何其他 reviewer 对同上下文的分析**。

---

## 15. 追加章节:完全独立架构下的再次重估(撤回 v0.2 的"嵌入 smind 生态"框架)

> 追加日期:`2026-04-24`
> 触发:owner 纠正 —— **nano-agent 与 smind 家族没有任何关联**。smind 代码和 DDL 只是"降低认知与执行风险的参考上下文",不是我们的上游。
> 性质:**v0.2 的整体框架被撤回**。v0.2 §13 建立在错误假设("nano-agent 嵌入 smind 生态")上的结论需要重写。v0.2 里对个别 smind 仓库**事实**的核查(文件 / 表结构 / 方法签名)仍然有效,但**架构立场**需要颠倒。

### 15.1 Owner 纠正的 first principle

Owner 明确:

> **我们的 nano-agent 是和 smind-admin 完全独立的系统。我们已经 break away from smind 系统了,那我们也不应该认可 smind-admin 为我们的上游。**
>
> **我们可以制作 `orchestrator.auth` 这个 worker 专门用于吸收 smind-admin 中的授权部分(JWT 问题、微信认证问题)。而 `orchestration.core` 应该吸收的是 smind-contexter 中的 user DO 和编排部分** —— 我看到我们现在的 orchestration.core 里面似乎没有吸收到任何这方面的内容,也就导致无法真实运行。
>
> **DDL 也是,我们吸收 ddl-v170 中已经验证过的 DDL 结构,直接为我们 nano-agent 服务,将其作为上下文,构建我们自己的 nano-agent 专用 D1 数据库,而不是在 ddl-170 上进行工作**。
>
> **nano-agent 和 smind 家族没有任何关联。我们只用这些代码和 DDL 更好地帮助我们稳定结构和降低认知与执行风险。**

### 15.2 v0.2 需要撤回的 4 条

- ❌ **v0.2 §13.4 修正 3 "Auth 层完全不需要自己写"** — 错。实际要写,只是用 smind-admin 作为代码参照。撤回。
- ❌ **v0.2 §13.5 新 Q-A 拓扑 "federate / shared D1 / absorb"** — 整个问题不成立,不联系。撤回 3 个选项。
- ❌ **v0.2 §13.5 新 Q-B "JWT_SECRET_KEY 共享策略"** — 不共享,是两套独立 secret。撤回。
- ❌ **v0.2 §13.6 scope 重估 ~2600 LOC / 2-2.5 月** — 这个缩减基于 "复用 smind-admin / 共用 smind-db" 假设,错误。需要重估(见 §15.8)。

### 15.3 保留 v0.2 里仍然正确的部分

- ✅ **v0.2 §13.4 修正 1 "Multi-tenant Mode α"** — ddl-v170 采用 α 行级 tenant 隔离,这个是**架构参考价值**。nano-agent 自己的 D1 schema 也应该采用 α 行级 `team_uuid` 隔离模式。
- ✅ **v0.2 §13.4 修正 5 "Conversation 层级"** — smind DDL 的 `conversation → session → turn → message → message_part` 层级是**业务模型参考价值**。nano-agent 自己的 schema 应该采用相似的层级(可简化命名)。
- ✅ **v0.2 §13.10 D1 vs DO SQLite 分工表** — owner 的澄清本身成立,这张归属表是正确的。但要注意"D1"指的是 **nano-agent 自己的 D1**,不是 smind-db-v170。
- ✅ **v0.2 §13.4 修正 2 "Quota 不是纯 mock,有 schema 可借鉴"** — smind-09 的 quota 表结构(`quota_policies / quota_balances / quota_ledger_entries / usage_events / usage_meter_definitions`)是**schema 参考价值**。nano-agent 自己的 quota 子系统可以 copy 这个结构。

### 15.4 正确的新 4-worker 拓扑

原 5-worker 变 **6-worker**:

| worker | 角色 | 状态 |
|---|---|---|
| `orchestrator.core` | 唯一 public session façade + user-level DO 编排(**需要大幅增强**)| 已存在,但用户态编排薄弱(见 §15.5)|
| `orchestrator.auth` | **新 worker**。JWT mint / register / login / WeChat bridge / API key 管理 | **全新构建**。吸收 smind-admin 代码,但独立部署独立 JWT_SECRET |
| `agent.core` | downstream per-session runtime | 已 closed |
| `bash.core` | internal capability worker | 已 closed |
| `context.core` | internal context library worker | 已 closed,但 compact wire 待做 |
| `filesystem.core` | internal workspace / storage worker | 已 closed |

**`orchestrator.auth` 这个新 worker 的存在**,是 v0.2 完全没看到的。这是本轮最大的结构性调整。

**请求流变化**:

```
WeChat Mini Program / web client
     │
     ├── /auth/register /auth/login /auth/wechat/bridge
     │        ↓
     │   orchestrator.auth  ──> nano-agent 自己的 D1
     │        ↓
     │   JWT (nano-agent 自签发,独立 secret)
     │
     ├── /sessions/:id/{start, input, cancel, ...}
     │        ↓
     │   orchestration.core (消费 JWT,查用户/租户)
     │        ↓ service binding + authority passing
     │   agent.core (执行 turn loop)
     │        ↓ internal RPC
     │   bash.core / context.core / filesystem.core
```

### 15.5 `orchestration.core` 用户态编排能力差距(对比 contexter engine_do)

这是 owner 提出的 "现在 orchestration.core 里面似乎没有吸收到任何这方面的内容,也就导致无法真实运行" 的**具体证据**。

核查:

| 用户态能力 | contexter engine_do 状态 | nano-agent orchestrator user-do 当前状态 | gap |
|---|---|---|---|
| per-user **DO SQLite** | `DOSqliteManager(ctx.storage)` + migrate() | **用 DO storage KV**(ctx.storage.get/put),无 SQLite | **有** |
| Alarm-driven background 任务 | `AlarmManager(ctx, env)` + `async alarm()` | **无 alarm 方法**,无 background maintenance | **有** |
| user-level 业务编排(conversation 切换 / history 恢复 / intent dispatch)| `Director` 类(446 LOC)handleHandshake / listConversations / switchConversation / handleUserMessage | **无**,orchestrator user-do 只做 session 代理 | **有** |
| conversation 聚合层(user → conversation → session)| `active_conversation_uuid` + conversation row | **无 conversation 概念**,直接按 session_uuid 索引 | **有** |
| 双向 WebSocket(client → server 发 message)| `server.addEventListener('message', ...)` + `dispatchCicpAction` | **单向**,WS 只接收 agent → client 流,不处理 client 发的消息(client 发消息必须走 HTTP POST /input)| **有** |
| per-user 消息广播(同一用户多 client attachment 同步)| `broadcast(packet)` 遍历 sessions Map | **strict single attachment + supersede**,明确延后多 attachment | 设计决策,不算 gap |
| 持久化 logger(每条日志写 D1)| `initLogger({db: env.DB, persistFn: ...})` | **无持久 logger**,只 console.log | **有** |
| session 代理转发 | 无(contexter 没有 runtime 下游)| **orchestrator user-do 的主要工作**(~660 LOC)| 方向相反 —— nano-agent 有而 contexter 没有 |

**关键差距明确**:

1. **DO SQLite 未用** —— owner 明确 DO SQLite 是 user 热数据的载体,当前用 KV。
2. **Alarm 未用** —— 冷归档 job、token cache refresh、热数据 flush 都需要 alarm。
3. **Director-like user 编排未实装** —— user 发 message 前的 "选哪个 conversation、决定是否新建 session、是否走 RAG" 等决策逻辑空白。
4. **WebSocket 双向未实装** —— client 发 message 必须走 HTTP POST,对 Mini Program 体验差。

Owner 说 "无法真实运行" 不是夸张 —— 这 4 个缺失**任何一个**都会让真实用户体验掉线。

### 15.6 `orchestration.core` 应该吸收 smind-contexter 的什么(具体)

**吸收**(adapt-pattern,不是直接 copy):

| contexter 源 | 吸收到 nano-agent 哪里 | 做什么改动 |
|---|---|---|
| `src/engine_do.ts` 构造器 initialization 模式(logger + DOSqliteManager + AlarmManager + Director)| `orchestrator-core/src/user-do.ts` constructor | 把 KV 存储升级为 DO SQLite;实装 AlarmManager;**不吸收** Director(因为那是 RAG 业务,nano-agent 这层只做 user-level session 编排,不做 RAG) |
| `src/engine_do.ts::handleWebsocketUpgrade` + `server.addEventListener('message')` + `dispatchCicpAction` | `orchestrator-core/src/user-do.ts::handleWsAttach` | 把当前单向 WS relay 扩展为双向,client 发的 message 通过 WS 经 orchestrator 转 internal input |
| `core/alarm.ts::AlarmManager` | `orchestrator-core/src/alarm.ts`(新建)| 模式参考,任务列表改 nano-agent 自己需求(冷归档、token refresh、session cleanup) |
| `core/db_do.ts::DOSqliteManager` | `orchestrator-core/src/user-sqlite.ts`(新建)| 模式参考,schema 改 nano-agent 自己(conversation_active_hint / user_secrets_cache / alarm_schedule 等)|
| `core/broadcast.ts::Broadcaster` | 可选,若未来支持多 client attachment 再引 | 当前延后 |
| `core/log.ts` 持久化 logger 模式 | `orchestrator-core/src/logger.ts`(新建)| 模式参考,writes 到 nano-agent 自己的 D1 |

**不吸收**:

- `context/director.ts` + `context/producer.ts` + `context/writer.ts` —— 这是 contexter-specific 的 RAG 编排,**与 nano-agent 的 agent runtime 语义不同**
- `ai/*` + `rag/*` —— smind 的 RAG 实现,nano-agent 若做 RAG 是独立设计
- `core/schemas_cicp.ts` —— CICP 协议,nano-agent 用 NACP
- `core/db_d1.ts` —— 对应的 smind D1 schema,nano-agent 有自己的 D1

### 15.7 `orchestrator.auth` 应该吸收 smind-admin 的什么(具体)

**吸收**(adapt-pattern):

| smind-admin 源 | 吸收到 orchestrator-auth 哪里 | 做什么改动 |
|---|---|---|
| `src/modules/identity/auth.service.ts::login/register/validateApiKey` | `orchestrator-auth/src/auth/login.ts + register.ts + api-key.ts` | schema 名改(nano-agent 自己的表名,去 `smind_` 前缀);JWT claim 格式统一到 nano-agent 约定 |
| `src/modules/identity/password.service.ts::resetPassword + hashSecret` | `orchestrator-auth/src/auth/password.ts` | 直接 adapt,Web Crypto API 实现 |
| `src/modules/identity/user.service.ts + team.service.ts` | `orchestrator-auth/src/admin/users.ts + tenants.ts` | User/Tenant admin API,CRUD |
| `src/infra/security.ts::createJwt + verifyJwt(用 jose 库)` | `orchestrator-auth/src/infra/jwt.ts` | 采用 jose(比当前 orchestrator-core 手写 HMAC 更稳定)|
| `src/http/router.ts + middleware.auth.ts + middleware.team.ts` | `orchestrator-auth/src/http/*` | routing + 鉴权 middleware,模式直接借 |
| `src/http/v1/auth.ts + teams.ts + users.ts + api_keys.ts` | `orchestrator-auth/src/http/v1/*` | route handler,直接借 |
| `src/contracts/http.ts`(Zod schemas)| `orchestrator-auth/src/contracts/*` | Zod schema,字段名可保留或简化 |
| `src/infra/db.ts::firstRow + run + batch` | `orchestrator-auth/src/infra/db.ts` | D1 query helper,直接借 |

**新增**(smind-admin 里没有但 nano-agent 需要):

- **WeChat bridge** (`wx.login code → code2session → 查 identity_provider=wechat → 签发 JWT`):`orchestrator-auth/src/auth/wechat.ts`
- **JWT 与 orchestrator.core 对齐**:nano-agent 的 orchestrator.core 已有 authority snapshot schema(`{sub, realm?, tenant_uuid?, membership_level?, source_name?, exp?}`),orchestrator.auth **签发时就用这个 schema**,不用 smind 的 `{uuid, tid, tpl}`
- **orchestrator.core ↔ orchestrator.auth 的 internal RPC**:可能需要(例如 orchestrator 收到请求后需要查 user profile / tenant plan,走 service binding 到 auth worker)

**不吸收**:

- `src/http/v1/workflows.ts + uploads.ts + static_files.ts + storage.ts` —— 这些是 smind-admin 的业务模块(workflow / 文件 / CMS),与 nano-agent 无关
- `src/modules/workflow/*` + `src/modules/asset/*` —— 同上
- `src/compat/legacy_smcp.ts` —— 旧 SMCP 客户端兼容,nano-agent 没历史包袱

### 15.8 `nano-agent 自己的 D1` schema 从 ddl-v170 吸收

原则:**copy structure, adapt scope, rename prefix**。

具体 mapping:

| ddl-v170 源模块 | nano-agent 是否吸收 | 如何改 | 产物 |
|---|---|---|---|
| smind-01 tenant-identity | **吸收核心表** | table prefix `smind_` → `nano_`;核心保留 `users / user_profiles / user_identities / teams / team_memberships / team_api_keys`;**不吸收** `team_invites / team_storage`(后者延后) | `nano_users / nano_user_profiles / nano_user_identities / nano_teams / nano_team_memberships / nano_team_api_keys` |
| smind-02 workflow-control-plane | **不吸收** | 这是 smind-admin 的业务模块,nano-agent 没有 workflow 概念 | — |
| smind-03 asset-files | **可能部分吸收** | 若支持用户上传附件,需要 `nano_asset_files`;否则延后 | 可能 `nano_assets` |
| smind-04 runtime-process-execution | **不吸收** | nano-agent 的 runtime state 放 agent-core DO + 增量写 nano_sessions,不需要独立 process/execution 表 | — |
| smind-05 knowledge-vector-retrieval | **延后** | 未来 RAG charter 引入,zero-to-real 不做 | — |
| smind-06 conversation-context-session | **吸收核心表** | 保留 `conversations / conversation_sessions / conversation_turns / conversation_messages / conversation_message_parts`;**重命名去 smind_**;简化字段(去掉 smind 业务独有的列如 `conversation_realm` 等)| `nano_conversations / nano_sessions / nano_turns / nano_messages / nano_message_parts` |
| smind-07 content-cms-publication | **不吸收** | CMS 与 nano-agent 无关 | — |
| smind-08 crm-contact-lead | **不吸收** | CRM 与 nano-agent 无关 | — |
| smind-09 tenant-billing-quota-usage | **吸收 quota 子集** | 保留 `usage_meter_definitions / usage_events / quota_policies / quota_balances / quota_ledger_entries`;**不吸收** `billing_plan_catalog / billing_team_subscriptions / billing_invoices / billing_payment_transactions / billing_credit_ledger`(不收费,这些延后)| `nano_usage_meter_definitions / nano_usage_events / nano_quota_policies / nano_quota_balances / nano_quota_ledger_entries` |
| smind-10 skill-capability-tasks | **不吸收** | skill.core 已明确延后 | — |
| smind-11 inbox-intake-messaging | **不吸收** | 与 nano-agent 无关 | — |
| smind-12 project-collaboration | **不吸收** | 与 nano-agent 无关 | — |

**nano-agent D1 schema 预估**:

- 吸收 01 约 500 LOC(原 777 去掉 invites + storage)
- 吸收 06 约 600 LOC(原 969 去掉业务特有列)
- 吸收 09 子集约 400 LOC(原 981 去掉 billing 真业务表)
- 合计 ~1500 LOC SQL(原 ddl-v170 的 ~16%)

**命名约定**建议:全部 `nano_` 前缀,对应 smind 的 `smind_` 前缀,这样**两套 schema 未来共存在同一 Cloudflare 账户时不冲突**。

### 15.9 scope 重估(v0.3,撤回 v0.2 的估计)

| Track | v0.1(错) | v0.2(错) | **v0.3(正确)** | 说明 |
|---|---|---|---|---|
| A Multi-tenant 动态化 | ~300 | ~200 | **~300** | 自己建,不复用 smind-admin,参考其 tenant 逻辑 |
| B LLM wire | ~700 | ~700 | ~700 | 不变 |
| C 自己 D1 + 分层 | ~1200 | ~600 | **~1100** | 从零建 nano-agent D1(1500 LOC SQL + ~1000 LOC query layer)|
| D Compact wire | ~300 | ~300 | ~300 | 不变 |
| E 对外 API(session/history + internal)| ~600 | ~250 | **~350** | 不再吸收 admin surface,但要补 session list / conversation list / history 类 endpoint |
| F Quota hook | 0(mock)| ~250 | **~300** | 真 quota hook,wire beforeCapabilityExecute + 写 D1 |
| G Conversation 聚合层 | — | ~300 | **~350** | 新增 conversation 层,user DO 需要维护 active_conversation_uuid |
| **H(新)orchestrator.auth worker** | — | — | **~1500** | 全新 worker:JWT mint / register / login / WeChat bridge / API key / user admin / tenant admin。吸收 smind-admin 约 40% 代码 |
| **I(新)orchestrator.core DO SQLite 迁移** | — | — | **~250** | user DO 从 DO storage KV 迁到 DO SQLite;fetch pattern 改 |
| **J(新)orchestrator.core Alarm 实装** | — | — | **~200** | AlarmManager 初始化 + maintenance job 定义 |
| **K(新)orchestrator.core 双向 WS** | — | — | **~200** | WS message listener + dispatch to internal input |

**v0.3 合计**:~5550 LOC / ~200 测试 / **3.5-4.5 个月**

**这个 scope 实际上比 v0.1 原估更大**(v0.1 是 ~3100)。原因:

1. 新增 `orchestrator.auth` 整个 worker(+1500 LOC)
2. orchestrator.core 的用户态补齐(H + I + J + K 共 ~850 LOC)是 v0.1 完全没想到的
3. D1 自建(~1500 LOC SQL 不算 TS)

### 15.10 子阶段重写(v0.3,撤回 v0.2 的切分)

```
[zero-to-real-1: Foundation]
  ├─ H (orchestrator.auth worker 建立,基本 JWT mint + register + login,不含 WeChat)
  ├─ C.1 (nano-agent D1 schema 设计 + DDL 应用 + orchestrator.auth D1 binding)
  ├─ A (multi-tenant 动态化:agent-core 改 buildIngressContext 消费 forwarded authority)
  ├─ I (orchestrator.core user DO 从 KV 迁到 DO SQLite,schema 建立)
  └─ 目标:登录 → JWT 签发 → multi-tenant 生效 → session 起得来 + 数据真实落 D1
  scope: ~1800 LOC,~1 个月

[zero-to-real-2: Runtime 接真 + 用户态补齐]
  ├─ B (Gemini adapter + composition 接真 provider)
  ├─ D (compact default-wire)
  ├─ F (quota hook wire,消费 nano_quota_balances / nano_usage_events)
  ├─ J (orchestrator.core AlarmManager 实装)
  ├─ K (orchestrator.core 双向 WS message dispatch)
  └─ G (conversation 聚合层,user DO 增加 conversation 管理)
  scope: ~2100 LOC,~1.5 个月

[zero-to-real-3: 对外面 + 冷层 + first real run]
  ├─ H' (orchestrator.auth 扩 WeChat bridge + API key)
  ├─ E (orchestrator.core 补 session list / conversation list / history endpoint)
  ├─ C.2 (R2 冷层 wire,归档 ended conversation)
  ├─ 接入 WeChat Mini Program (并行项目对接)
  └─ 内部 5-10 人真实使用 + gap triage
  scope: ~1650 LOC,~1 个月

总计 ~4.5 个月(含 first real run gap 修复)
```

### 15.11 新的 open questions(撤回 v0.2 的 Q-A/B/D)

保留 v0.2 的 Q-C(DDL 粒度)+ 补新问题:

1. **`orchestrator.auth` 与 `orchestrator.core` 共用同一个 D1 database 还是分开?**
   - 共用(推荐):nano-agent 只一个 D1 `nano-db`,两 worker 都 binding
   - 分开:user / tenant / identity 在 auth DB,conversation / session / turn 在 core DB
   - 推荐共用 —— SQL 需要 JOIN user + conversation,分库会很难受

2. **JWT claim schema 最终形态?**
   - 选项 α:完全用 smind-admin 的 `{uuid, tid, tpl}`(最简)
   - 选项 β:沿用 nano-agent orchestrator 当前的 `{sub, tenant_uuid, membership_level, realm?, source_name?, exp?}`(最兼容已有代码)
   - 选项 γ:混合 `{sub, tid, realm, ...}`(使用 JWT 标准 sub 但借 smind 的 tid/tpl 缩写)
   - **推荐 β**,因为 orchestrator.core 当前代码已消费这个格式,改动最小;orchestrator.auth 签发时 adapt 即可

3. **DO SQLite 迁移要不要保留 KV 兼容期?**
   - 立刻全切 SQLite:user DO 全部改,老 KV 数据一次性 migrate
   - 双写期:新写 SQLite,读时优先 SQLite fallback KV,一段时间后删 KV
   - Zero-to-real 是从零部署,推荐**立刻全切**(没有老 user 数据需要迁移)

4. **`orchestrator.auth` 的 internal RPC 与 orchestrator.core 如何通信?**
   - 方案 A:orchestrator.core 直接查 D1(auth 写 D1,orchestrator 只读同一 D1)
   - 方案 B:orchestrator.core 通过 service binding 调 orchestrator.auth 的 `/internal/*` endpoint
   - A 低延迟,B 清晰边界
   - **推荐混合**:只读(查 user profile / tenant plan)走 A 直接 D1 SQL;写(create session record / update last_seen)走 A;**鉴权决策**(例如 "这个 api_key 是否有权限执行这个 capability")走 B(让 auth worker 自己判断,orchestrator 不代理鉴权逻辑)

5. **quota 是 orchestrator 层检查还是 orchestrator.auth 层检查还是 bash.core 层检查?**
   - orchestrator:public ingress 时 pre-check,快速拒绝无效请求
   - orchestrator.auth:作为鉴权一部分一起做
   - bash.core:每 capability 执行前 recheck(已有 `beforeCapabilityExecute` seam)
   - 三层不互斥,**建议全部都加**:orchestrator 做 pre-flight(粗颗粒),bash.core 做 execution-time(细颗粒),orchestrator.auth 作为 truth source

6. **orchestrator.auth 是否处理 tenant-level config(plan level / quota policy override)还是只做 identity?**
   - 纯 identity:auth worker 只管 user + tenant CRUD,quota_policies 归别的 worker
   - identity + policy:auth 做 tenant plan 选择 + quota policy 初始化(register 新 tenant 时默认挂 free plan)
   - 推荐**identity + policy 初始化**,让 auth 成为 tenant 生命周期的真相中心

7. **D1 migration 策略?**
   - 手动(wrangler d1 execute)
   - 自动 migrator(orchestrator.auth 启动时检查 schema version,缺表自动 CREATE)
   - 推荐**自动**,模仿 contexter `DOSqliteManager.migrate()` 模式但对象换成 D1

### 15.12 认知与执行风险降低效果(owner 真实诉求)

owner 说 "我们只用这些代码和 DDL 更好地帮助我们稳定结构和降低认知与执行风险"。按这个口径评估:

| 风险 | 降低程度 | 具体体现 |
|---|---|---|
| schema 设计失误 | **大幅降低** | ddl-v170 是 production-verified schema,我们 copy 结构不是从零猜 |
| JWT 实现错误 / 不稳定 | **大幅降低** | smind-admin 的 jose HS256 模式已验证 |
| Auth API 遗漏 edge case(密码重置 / API key 轮换 / tenant 创建流程)| **大幅降低** | smind-admin 的 26 个 handler 覆盖几乎所有主流 auth edge case |
| user DO 用户态编排(conversation / alarm / DO SQLite 模式)设计失误 | **中等降低** | contexter engine_do 是真实 production 运行过的 pattern |
| 冷热分层策略 | **小幅降低** | ddl-v170 有 `time_deleted_at / last_active_at` 等分层 hint,但具体冷归档策略需要自己设计 |
| LLM provider 错误(retry / rate limit / timeout)| **不降低** | smind 生态没帮助,需要自己设计 |
| agent runtime turn loop 稳定性 | **不降低** | agent-core 是 nano-agent 独有,smind 没有对应参照 |
| multi-tenant 行级隔离正确性 | **大幅降低** | ddl-v170 每个表的 `team_uuid NOT NULL` + 对应索引 pattern 直接借 |

**结论**:smind 上下文对 "schema + auth + user DO pattern + multi-tenant 行级隔离" 四个方向的风险降低非常实在;对 "LLM wire / agent runtime / compact / 冷归档具体策略" 降低有限。这指示了 G0 的设计重点应该**花更多时间**在后者上。

### 15.13 一句话总结(v0.3)

> **撤回 v0.2 "嵌入 smind 生态" 框架。nano-agent 与 smind 家族完全独立。smind 代码和 DDL 仅作为**降风险的参考上下文**:从 smind-admin 吸收 auth 代码模式 → 新建 `orchestrator.auth` worker;从 smind-contexter 吸收 user DO 运行模式 → 增强 `orchestrator.core`(DO SQLite + Alarm + 双向 WS + conversation 聚合);从 ddl-v170 吸收 schema 结构 → 自建 nano-agent 专用 D1。**
>
> **正确的 scope 是 6-worker / ~5550 LOC / 3.5-4.5 月,比 v0.1 原估更大**,因为真相是:
> 1. 要新建一个 auth worker(v0.1 / v0.2 都低估)
> 2. orchestrator.core 当前用户态编排能力**严重不足**(v0.1 完全没看到这层 gap,v0.2 错误以为"复用 smind-admin 就行")
> 3. DO SQLite 迁移 + Alarm + 双向 WS 是新增工作(v0.1 完全没考虑)

### 15.14 给 owner 的 4 个**首选**决策问题(可以立即开始讨论)

从 §15.11 的 7 问里挑出 G0 启动前必须回答的 4 个:

1. **JWT claim schema 定哪个?**(推荐 β,沿用 orchestrator 当前)
2. **D1 共用(nano-agent 单 DB)还是分开(auth DB + core DB)?**(推荐单 DB)
3. **DDL 引入粒度**:Min(01+06)/ Recommended(+09 quota)/ Full(+业务模块)?(推荐 Recommended)
4. **子阶段切分接受 §15.10 的三段式吗?**

其余 3 个(internal RPC 方向、quota 三层检查、auth 处理 policy 初始化)可以在 G0 期间回答。

---

## 16. 版本历史(追加 v0.3)

| 版本 | 日期 | 修改者 | 变更 |
|---|---|---|---|
| v0.1 | 2026-04-24 | Claude Opus 4.7 (1M context) | 初版 |
| v0.2 | 2026-04-24 | Claude Opus 4.7 (1M context) | 基于 smind-admin + ddl-v170 的 "嵌入生态" 框架(**后被撤回**)|
| v0.3 | 2026-04-24 | Claude Opus 4.7 (1M context) | **§15 重大修正**:owner 纠正 "nano-agent 完全独立 smind 家族,smind 只是降风险参考上下文"。撤回 v0.2 §13.4-13.8 的 4 项判断(auth 层不自写 / shared D1 / scope 减少 / federate 拓扑)。保留 v0.2 中纯事实核查部分(smind 文件列表、方法签名等)。**引入新 worker `orchestrator.auth`**。对比 contexter engine_do 识别 orchestrator.core **用户态编排严重空白**(DO SQLite / Alarm / 双向 WS / conversation 聚合 全部缺失)。scope 从 v0.2 的 ~2600 重估为 **~5550 LOC / 3.5-4.5 月**(**比 v0.1 原估更大**,不是更小)。6-worker 拓扑替代原 5-worker。子阶段重写 Foundation / Runtime / 对外+冷层+first run。DDL 从 ddl-v170 copy+adapt 建立 nano-agent 专用 `nano_*` 前缀 schema。**独立完成,未参考其他 reviewer**。
