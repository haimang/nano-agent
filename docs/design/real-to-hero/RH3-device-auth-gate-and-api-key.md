# Nano-Agent 功能簇设计模板

> 功能簇: `RH3 Device Auth Gate and API Key`
> 讨论日期: `2026-04-29`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告:
> - `docs/charter/plan-real-to-hero.md`
> - `docs/investigation/api-docs-after-ZX5-reviewed-by-GPT.md`
> 关联 QNA / 决策登记:
> - `docs/design/real-to-hero/RHX-qna.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

RH3 的任务是把当前“看起来已经有 end-user auth truth，实际上 device revoke 与 API key 仍是半成品”的局面拉直到真正产品面：device revoke 进入 access/refresh/WS gate，team display 进入 auth view，server-to-server 可用 API key 鉴权，`/me/conversations` 与 `/me/sessions` 读模型对齐。它是 zero-to-real auth criterion 真正闭环的 phase。

- **项目定位回顾**：RH3 是 `tenant/product surface closure`。
- **本次讨论的前置共识**：
  - 不做 admin plane / membership management / invite flow
  - JWT 与 API key 双轨必须都经同一 façade auth law
- **本设计必须回答的问题**：
  - device revoke 怎样从 D1 写入变成即时 auth gate？
  - team display / API key 应暴露到什么粒度，才不会膨胀成 admin plane？
- **显式排除的讨论范围**：
  - OAuth federation
  - API key UI / full admin plane

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`RH3 Device Auth Gate and API Key`
- **一句话定义**：`把 device truth、team display 和 minimal server-to-server auth 收敛成真实租户产品面。`
- **边界描述**：这个功能簇**包含** device claim 与 revoke gate、team_name/team_slug、verifyApiKey runtime path、`/me/conversations` 双源对齐与 cursor；**不包含** API key admin plane、team invite、OAuth。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| device auth gate | device_uuid 进入 access/refresh/WS attach 鉴权 | 不只是写 D1 revoke 行 |
| team display | team_name/team_slug 对客户端可见 | 不等于多团队管理 |
| verifyApiKey | server-to-server bearer 验证最小路径 | first-wave 不做 admin plane |
| dual-source conversations | `/me/conversations` 与 `/me/sessions` 同口径数据集 | 只读面收敛 |

### 1.2 参考调查报告

- `docs/charter/plan-real-to-hero.md` — §7.4、§10.1、§12 Q1
- `docs/investigation/api-docs-after-ZX5-reviewed-by-GPT.md` — 当前 device revoke / verifyApiKey / me-conversations drift 记录

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- RH3 在整体架构里扮演 **tenant truth productization** 的角色。
- 它服务于：
  - authenticated end-user client
  - server-to-server caller
  - final closure 的“租户可达闭环”
- 它依赖：
  - RH1 的 WS push / force-disconnect 基础路径
  - auth contract package
  - D1 device / team / refresh session truth
  - RHX-qna Q1
- 它被谁依赖：
  - RH6 manual evidence 的 device revoke 场景
  - hero-to-platform 的 admin plane / membership 扩展

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| RH1 Lane F | RH1 -> RH3 | 中 | WS force-disconnect 复用 live relay |
| orchestrator-auth contract | RH3 <-> auth | 强 | team/device/API key 都会改变 auth view 和 verify law |
| me read model | RH3 <-> orchestrator-core | 强 | conversations / devices / team patch 都走 façade |
| RH6 evidence | RH3 -> RH6 | 中 | device revoke 是 final evidence 关键场景 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`RH3 Device Auth Gate and API Key` 是 **把租户与设备安全语义做成真实产品面的 phase**，负责 **闭合 device revoke、team display、API key verify 与 conversation read model**，对上游提供 **可信的 tenant/auth truth**，对下游要求 **closure 不再把 auth blocker 伪装成 polish**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| API key admin plane | “既然有 verify 顺手做管理” 的诱因 | 直接越界到 hero-to-platform | hero-to-platform |
| 只在 refresh path 生效的 device revoke | 当前半成品现实 | 不能算真正 auth gate | 否 |
| 只加 team_name 不定义 team_slug law | 想先最小暴露 | 后续 schema / URL / display 仍会漂移 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| `AuthView` team 字段 | `packages/orchestrator-auth-contract` | 加入 team display 真相 | 后续可扩 richer team profile |
| API key runtime path | `verifyApiKey` + `authenticateRequest` 双轨 | first-wave verify only | hero-to-platform 再加 list/create/revoke |
| conversation pagination | `next_cursor` keyset | first-wave cursor read model | 后续 archive/search/title |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：API key verify vs API key admin plane
- **解耦原因**：RH3 只需要 server-to-server ingress 能工作，不需要产品化管理界面。
- **依赖边界**：verify 进入 auth gate；admin plane 明确留到下一阶段。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：access/refresh/WS device gate、team display、API key bearer
- **聚合形式**：全部收敛到同一套 auth contract 与 façade ingress law
- **为什么不能分散**：分散之后会出现不同入口对“当前用户/设备/团队是谁”给出不同答案

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 当前 auth contract 的做法

- **实现概要**：`AuthView` 已存在 user/team/snapshot，但尚未携带 RH3 所需 team display / device truth 细化。
- **亮点**：
  - public auth HTTP 合约已有单一事实源
- **值得借鉴**：
  - 所有 auth response shape 都继续收敛到 contract package
- **不打算照抄的地方**：
  - 让 façade自己拼装 auth shape

### 4.2 当前 device / me surface 的做法

- **实现概要**：`/me/devices`、`/me/devices/revoke`、`/me/conversations` 已有 surface，但 device revoke 仍停留在 D1 写入，verifyApiKey 仍返回 reserved。
- **亮点**：
  - façade 路由已经在正确位置
- **值得借鉴**：
  - 继续由 orchestrator-core 维护 user-facing read model
- **不打算照抄的地方**：
  - 把“下一次 token 过期才失效”当成 revoke 完成

### 4.3 RH3 的设计倾向

- **实现概要**：先把最小 tenant/product truth 做实，不碰 admin plane。
- **亮点**：
  - scope 边界清楚
- **值得借鉴**：
  - 把 dual-source read model 与 auth law 一起收敛
- **不打算照抄的地方**：
  - 继续让 `/me/conversations` 与 `/me/sessions` 口径分裂

### 4.4 横向对比速查表

| 维度 | 当前代码 | RH3 目标 | nano-agent 倾向 |
|------|----------|----------|------------------|
| device revoke | D1 write only | access/refresh/WS gate | 真正即时拒绝 |
| API key | reserved | verify-only runtime path | 不做 admin plane |
| team display | 基础 team object | team_name/team_slug 可见 | 最小产品面 |
| `/me/conversations` | 双源未对齐 | 与 `/me/sessions` 一致 | 收敛读模型 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** device_uuid claim 注入与 access/refresh/WS gate（**当前全链路为零**：`AccessTokenClaims`/`AuthSnapshot`/`nano_auth_sessions` 均无 device_uuid 字段；login/register 不 mint device_uuid；migration 009 必须新增 `nano_auth_sessions.device_uuid` 列）
- **[S2]** team_name/team_slug 与 `/me/team` patch（**migration 009 必须为 `nano_teams` 新增 `team_name TEXT NOT NULL DEFAULT ''` + `team_slug TEXT UNIQUE`**；当前表无这两列；同步更新 `AuthTeamSchema`，触发 `orchestrator-auth-contract` 版本升级）
- **[S3]** verifyApiKey runtime path + `authenticateRequest` 双轨（**migration 009 必须为 `nano_team_api_keys` 新增 `key_salt TEXT NOT NULL` 列**；或改用无 salt 的 argon2 方案并在本设计内冻结决议）
- **[S4]** `/me/conversations` D1+KV 对齐 + cursor pagination（参考 `handleMeSessions` 的双源合并逻辑）
- **[S5]** `/me/devices` 与 refresh binding 对齐
- **[S6]** `GET /me/teams` 只读 list（charter §4.3 灰区已 in-scope；用户可能已属多个 team —— 注册自动建 1 个 + 被邀请加入其他；不含 create/invite/remove/change-role）

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** API key list/create/revoke UI — admin plane；重评条件：hero-to-platform
- **[O2]** team invite / membership management — 多团队产品面；重评条件：hero-to-platform
- **[O3]** OAuth federation — 独立 GTM 范围；重评条件：hero-to-platform

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `verifyApiKey` 返回 supported=false | out-of-scope | RH3 必须把它接成 runtime path | RH3 |
| 注册时自动 team_name 但无 team_slug law | out-of-scope | 会让 migration 009 不完整 | RH3 + RHX-qna Q1 |
| revoke 后 access token 继续有效到 exp | out-of-scope | 不满足 auth criterion | RH3 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **device revoke 立即进入 access/refresh/WS gate** 而不是 **只在 refresh path 生效**
   - **为什么**：否则“device revoke 已成立”是伪命题。
   - **我们接受的代价**：每次鉴权都可能多一次 device truth 读取或缓存一致性治理。
   - **未来重评条件**：无。

2. **取舍 2**：我们选择 **API key verify-only** 而不是 **顺手做 admin plane**
   - **为什么**：first-wave 只需要 server-to-server ingress 能工作。
   - **我们接受的代价**：创建 / 撤销先通过 internal/manual path。
   - **未来重评条件**：hero-to-platform。

3. **取舍 3**：我们选择 **`/me/conversations` 与 `/me/sessions` 双源对齐** 而不是 **保留两个各说各话的读模型**
   - **为什么**：这类差异会直接污染客户端理解。
   - **我们接受的代价**：需要更认真设计 cursor / sort key。
   - **未来重评条件**：无。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| access token 每次都查 D1 带来延迟 | strict device gate | auth 路径变慢 | 允许短 TTL cache，但必须有 revoke 主动清 |
| team_slug law 未冻结 | RH2/RH3 并行 | migration 009 漂移 | 依赖 RHX-qna Q1 在 RH2 启动前冻结 |
| API key 与 JWT 冲突 | bearer 双轨并存 | ingress 判定歧义 | 以前缀/shape 明确区分 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：可以诚实地宣称 auth criterion 真正成立。
- **对 nano-agent 的长期演进**：为 hero-to-platform 的 admin plane 预留了干净 runtime foundation。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：租户与设备安全语义稳定后，客户端能力才有可靠边界。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Device Auth Gate | access/refresh/WS 全链检查 revoked device；**全链路 schema 落地**（AccessTokenClaims + AuthSnapshot + nano_auth_sessions + login/register mint + refresh rotation 绑定）| ✅ `revoke 后设备立即失效` |
| F2 | Team Display Surface | team_name/team_slug 进入 auth/me product surface；**migration 009 表结构变更 + AuthTeamSchema 升版** | ✅ `客户端第一次看见稳定 team identity` |
| F3 | API Key Runtime Verify | bearer 双轨支持 JWT + API key；**migration 009 为 `nano_team_api_keys` 加 salt 列** | ✅ `server-to-server caller 可通过 façade ingress` |
| F4 | Conversation Read Model Alignment | `/me/conversations` 与 `/me/sessions` 同口径，D1+KV 双源合并参考 `handleMeSessions` | ✅ `客户端读模型不再分裂` |
| F5 | Team List Read Surface | 只读 `GET /me/teams`，返回当前用户所属全部 team（charter §4.3 灰区 in-scope）| ✅ `多团队归属用户可见到自己所有 team，但不引入 admin plane` |

### 7.2 详细阐述

#### F1: `Device Auth Gate`

- **输入**：device_uuid claim、`nano_user_devices` 状态、WS attachment map
- **输出**：access/refresh/WS 三处一致的 device allow/deny verdict
- **主要调用者**：`authenticateRequest`、refresh path、WS attach path
- **核心逻辑**：登录/注册生成 device_uuid，refresh rotation 保持绑定，revoke 后三条入口都立即拒绝，已 attached WS 被 force-disconnect。
- **边界情况**：
  - revoked-but-already-attached 必须收到明确终止，而不是只对未来请求生效。
- **一句话收口目标**：✅ **`device revoke 成为真实 auth gate，而不是 D1 记账`**

#### F2: `Team Display Surface`

- **输入**：team display schema、slug law、注册自动生成 / patch 更新
- **输出**：`/auth/me`、`/me/team`、auth responses 中的稳定 team 字段
- **主要调用者**：客户端 team picker / profile display
- **核心逻辑**：team_name 面向展示，team_slug 面向可读标识；二者都进入 contract package，而不是 façade拼装。
- **边界情况**：
  - slug law 必须先经 RHX-qna Q1 冻结。
- **一句话收口目标**：✅ **`team identity 第一次以稳定产品字段暴露给 client`**

#### F3: `API Key Runtime Verify`

- **输入**：`nak_...` bearer、hash/salt 存储、`verifyApiKey`
- **输出**：server-to-server 可通过 façade auth
- **主要调用者**：internal/manual server caller
- **核心逻辑**：auth worker 负责 verify，façade 负责双轨入口分派，不把 verify 逻辑散落到多处。
- **边界情况**：
  - JWT 与 API key 的 bearer 形态必须无歧义。
- **一句话收口目标**：✅ **`API key 从 reserved 变成真实可用的 runtime ingress`**

#### F4: `Conversation Read Model Alignment`

- **输入**：D1+KV session truth、cursor keyset、conversation 聚合
- **输出**：一致的 `/me/conversations` 与 `/me/sessions`
- **主要调用者**：client history list / conversation overview
- **核心逻辑**：同样的数据集用不同视角呈现，但不能出现集合与状态口径漂移。
- **边界情况**：
  - next_cursor 必须在末页显式为 null。
- **一句话收口目标**：✅ **`客户端读到的 conversation/session 不再互相打架`**

### 7.3 非功能性要求与验证策略

- **性能目标**：device gate 不应把 auth latency 无控制放大
- **可观测性要求**：revoke / verify / force-disconnect 都可审计
- **稳定性要求**：JWT 与 API key 双轨不冲突
- **安全 / 权限要求**：跨 user/device/team 访问必须被拒绝
- **测试覆盖要求**：endpoint-level、internal RPC、device gate、多租户边界测试同时覆盖
- **验证策略**：通过 access/refresh/WS revoke 证据、API key smoke 和 dual-source read model tests 证明 RH3 成立

---

## 8. 可借鉴的代码位置清单

### 8.1 Auth contract / current auth gap

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `packages/orchestrator-auth-contract/src/index.ts:102-184` | `AuthView` / `VerifyTokenResult` / `ResetPasswordResult` / `VerifyApiKeyResult` | RH3 所有 auth shape 变更必须回到 contract package | single source |
| `workers/orchestrator-auth/src/service.ts:402-413` | `verifyApiKey()` 当前返回 `supported:false` | RH3 的明确 runtime gap | reserved reality |

### 8.2 Current me surface

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/orchestrator-core/src/index.ts:648-724` | `/me/devices` 与 revoke 当前行为、TODO 注释 | RH3 要把 TODO 全部接满 | device gap written in code |
| `workers/orchestrator-core/src/index.ts:618-645` | `/me/conversations` façade route | RH3 在此保持 public surface 不变，只收紧读模型 | read model owner |

### 8.3 Current session/user truth

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/orchestrator-core/src/user-do.ts:1262-1415` | resume / permission / elicitation current relay | RH3 device revoke force-disconnect 复用同类 user-do relay owner | current relay owner |
| `workers/orchestrator-core/src/index.ts:667-812` | D1 设备列表 / revoke SQL 现实 | RH3 在现有 D1 truth 基础上升级成真正 gate | current D1 truth |

### 8.4 RH3 涉及的 migration 009 schema 变更清单

> 来源：deepseek/kimi/GLM 多审查共识。RH3 是 real-to-hero 阶段唯一改写 `nano_teams` / `nano_team_api_keys` / `nano_auth_sessions` 的 phase；migration 009 必须一次到位。

| 表 | 变更 | 影响 |
|----|------|------|
| `nano_teams` | `ALTER TABLE ADD COLUMN team_name TEXT NOT NULL DEFAULT ''` + `team_slug TEXT UNIQUE` | F2 |
| `nano_team_api_keys` | `ALTER TABLE ADD COLUMN key_salt TEXT NOT NULL` | F3（HMAC-SHA256 方案）|
| `nano_auth_sessions` | `ALTER TABLE ADD COLUMN device_uuid TEXT` + 索引 | F1 device-session 绑定 |

### 8.5 contract package 影响

| 文件 | 变更 |
|------|------|
| `packages/orchestrator-auth-contract/src/index.ts` | `AuthTeamSchema` 加 `team_name`/`team_slug`；`AccessTokenClaimsSchema` 加 `device_uuid`；`AuthSnapshotSchema` 加 `device_uuid`；`VerifyApiKeyResultSchema` 改为成功 shape；package version bump |

---

## 9. 多审查修订记录（2026-04-29 design rereview）

| 编号 | 审查者 | 原 finding | 采纳的修订 |
|------|--------|-------------|------------|
| GPT-R3 | GPT | RH3 漏 charter §4.3 灰区已 in-scope 的 `GET /me/teams` 只读 | §5.1 新增 [S6]、§7.1 新增 F5 |
| kimi-R4 / GLM-R8 共识 | kimi/GLM | `nano_teams` 当前完全无 `team_name`/`team_slug` 列 | §5.1 [S2] 显式 migration 009 schema；§8.4 schema 变更清单 |
| kimi-R5 | kimi | `nano_team_api_keys` 无 `salt` 列，与设计 HMAC-SHA256 方案不兼容 | §5.1 [S3] 显式 migration 009 加 salt；§8.4 列入清单 |
| GLM-R12 | GLM | device tracking 全链路为零（claim/snapshot/sessions/login/register/refresh 全部缺）| §5.1 [S1] 改写为"全链路为零"+全链路改造清单；§8.4 加 `nano_auth_sessions.device_uuid` |
| GLM-R8 | GLM | AuthView 缺 team display 字段未量化 contract 影响 | §8.5 contract package 影响清单 + 版本升级要求 |
| deepseek-R6 | deepseek | RH3 行号引用偏移（`/me/devices` 区域）| §8.2 行号在 action-plan 阶段以函数级边界（`handleMeDevicesList` / `handleMeDevicesRevoke`）二次校验 |
| GLM-R5 | GLM | RH3 对 `/me/conversations` 的双源描述停留在 facade 层 | F4 描述补"参考 `handleMeSessions` 双源合并"|
