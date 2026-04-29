# Nano-Agent 行动计划 — RH3 Device Auth Gate and API Key

> 服务业务簇: `real-to-hero / RH3`
> 计划对象: `把 device truth、team display 与 minimal server-to-server auth 收敛成真实租户产品面`
> 类型: `add + update + migration`
> 作者: `Owner + Opus 4.7`
> 时间: `2026-04-29`
> 文件位置:
> - `workers/orchestrator-core/migrations/009-team-display-and-api-keys.sql`
> - `workers/orchestrator-auth/src/{service,public-surface,jwt}.ts`
> - `workers/orchestrator-core/src/{auth,index,user-do}.ts`
> - `packages/orchestrator-auth-contract/src/index.ts`
>
> 📝 **行号引用提示**：行号截至 2026-04-29 main 分支快照；以函数 / 表名为锚点。
>
> 📝 **业主已签字 QNA**：业主同意 RHX-qna Q1 (slug law) 与 Q5。**关键表名澄清**：用户-团队关联表是 `nano_team_memberships`（migration 001 line 41-49），不是 `nano_user_teams`（不存在）；本 plan 全文以 `nano_team_memberships` 为准。
> 上游前序 / closure:
> - `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md` 完成（force-disconnect 复用 cross-worker push）
> - `docs/charter/plan-real-to-hero.md` r2 §7.4
> 下游交接:
> - `docs/action-plan/real-to-hero/RH6-do-megafile-decomposition.md`（manual evidence 含 device revoke scenario）
> 关联设计 / 调研文档:
> - `docs/design/real-to-hero/RH3-device-auth-gate-and-api-key.md`（含 §9 修订 + §8.4 schema + §8.5 contract 影响）
> - `docs/investigation/api-docs-after-ZX5-reviewed-by-GPT.md`
> 冻结决策来源:
> - `docs/design/real-to-hero/RHX-qna.md` Q1（业主同意 Opus 路线：ASCII slug + 6 base36 + global UNIQUE NOT NULL + ≤32 + `[a-z0-9-]`）
> 文档状态: `draft`

---

## 0. 执行背景与目标

ZX5 closure 把 user/team/refresh/device 的 truth surface 立起来了，但 device revoke 仍只写 D1，verifyApiKey 仍是 `{supported:false}` stub，team_name/team_slug 表里没有列，`/me/conversations` 与 `/me/sessions` 双源不对齐，`GET /me/teams` 只读列表不存在。RH3 把这一切补成可信 tenant/auth truth：device_uuid 全链路落地（claim+snapshot+sessions+login+register+refresh）；migration 009 一次到位（team_name/team_slug + api_key salt + auth_sessions.device_uuid）；API key verify-only runtime path；`/me/conversations` 双源对齐；`GET /me/teams` 只读 list。

- **本次计划解决的问题**：
  - device tracking 全链路为零（GLM R12 verified）
  - `nano_teams` 无 team_name/team_slug
  - `nano_team_api_keys` 无 salt
  - `verifyApiKey()` 仍 supported:false
  - `/me/teams` GET 不存在
  - `/me/conversations` 与 `/me/sessions` 数据集不对齐
- **本次计划的直接产出**：
  - migration 009：3 表变更 + slug 索引
  - `orchestrator-auth-contract` 升版（AuthTeam / AccessTokenClaims / AuthSnapshot / VerifyApiKeyResult shape）
  - `orchestrator-auth` JWT mint + refresh path 含 device_uuid
  - `orchestrator-core/auth.ts` device gate + force-disconnect on revoke
  - `verifyApiKey` runtime + `authenticateRequest` 双轨
  - `/me/team` PATCH + `GET /me/teams`
  - `/me/conversations` 双源 + cursor
- **本计划不重新讨论的设计结论**：
  - team_slug = ASCII slug + `-` + 6 base36 char + global UNIQUE + ≤32 + `[a-z0-9-]`（来源：RHX Q1）
  - API key admin plane out-of-scope（hero-to-platform）
  - `/me/teams` 只读，无 invite/create/remove（`charter §4.3`）
  - device gate timeout 短 TTL cache 允许，但 revoke 必须主动清（`design RH3 §6.2`）

---

## 1. 执行综述

### 1.1 总体执行方式

RH3 采用 **migration → contract → JWT mint/refresh → device gate → API key → me 读模型 → e2e** 自下而上：先把 D1 schema + auth contract 冻好，再让 token mint 与 refresh 真带 device_uuid，再让 access/refresh/WS 三处一致校验，最后把 verifyApiKey、`/me/team` PATCH、`GET /me/teams` 与 `/me/conversations` 双源对齐做完，preview 阶段以 device revoke + force-disconnect 端到端 manual evidence 收口。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 依赖前序 |
|------|------|------|----------|
| Phase 1 | Migration 009 | M | RH1 closure |
| Phase 2 | Auth Contract Upgrade | S | Phase 1 |
| Phase 3 | Device_uuid Mint + Refresh Bind (P3-A 上半 + P3-E) | M | Phase 2 |
| Phase 4 | Device Auth Gate (P3-A 下半) | M | Phase 3 |
| Phase 5 | API Key Runtime (P3-C) | M | Phase 2 |
| Phase 6 | Team Display + /me/team PATCH + GET /me/teams (P3-B) | M | Phase 1-2 |
| Phase 7 | /me/conversations 双源 + cursor (P3-D) | M | Phase 1 |
| Phase 8 | E2E + Preview Smoke | M | Phase 1-7 |

### 1.3 执行策略说明

- **执行顺序**：migration → contract → 主链路（device claim → gate → revoke）→ 旁支（API key、team display、conversations）→ e2e
- **风险控制**：device gate 改动会进 hot path，必须保证短 TTL cache + revoke 主动清；API key bearer 形态用前缀（`nak_`）严格区分 JWT
- **测试**：每 endpoint ≥5；device gate 跨 worker e2e；revoke force-disconnect e2e
- **文档**：`docs/api/auth-protocol.md` 升级
- **回滚**：JWT mint 增加字段是兼容（旧 client 忽略）；device gate 失败则保留短 TTL grace（不允许 silent allow）

### 1.4 影响结构图

```text
RH3
├── Phase 1: migration 009
├── Phase 2: contract package
├── Phase 3: device claim mint + refresh bind
├── Phase 4: device gate access/refresh/WS
├── Phase 5: API key runtime
├── Phase 6: team display + /me/team + /me/teams
├── Phase 7: /me/conversations 双源 + cursor
└── Phase 8: e2e + preview smoke
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** migration 009 (forward-only)：(a) `nano_teams` add `team_name TEXT NOT NULL DEFAULT ''` + `team_slug TEXT` + atomic data-fill 现有行 + `UNIQUE INDEX` (D1 不支持 `ALTER COLUMN ... NOT NULL`，由 application layer + 已 fill 数据保证非空)；(b) `nano_team_api_keys` add `key_salt TEXT NOT NULL DEFAULT ''`（现有 row salt 在首次 verify 升级路径处理）；(c) `nano_auth_sessions` add `device_uuid TEXT` + 索引
- **[S2]** `orchestrator-auth-contract` 升版：`AuthTeam` 加 `team_name`/`team_slug`；`AccessTokenClaims` 加 `device_uuid`；`AuthSnapshot` 加 `device_uuid`；`VerifyApiKeyResult` 改成功 shape
- **[S3]** login/register mint device_uuid + 写 `nano_auth_sessions.device_uuid` + 写 `nano_user_devices`
- **[S4]** refresh rotation 保持 device_uuid 绑定 + 验证 device 是否被 revoke
- **[S5]** `authenticateRequest` 在 access path 校验 device_uuid 状态（短 TTL cache + revoke 主动清）
- **[S6]** WS attach 校验 device_uuid；revoke 后通过 `forwardServerFrameToClient` `attachment_superseded` + `terminal` 主动 disconnect
- **[S7]** `verifyApiKey` 真查 `nano_team_api_keys`（HMAC-SHA256(salt:raw)）；`authenticateRequest` 双轨支持 `nak_*` bearer
- **[S8]** team display：注册时自动生成 slug；`PATCH /me/team` 更新 team_name；`GET /me/team` 返回当前；`GET /me/teams` 列出全部
- **[S9]** `/me/conversations` D1+KV 双源合并 + cursor（参考 `handleMeSessions`）

#### 2.1.1 RH0-RH2 carry-over inheritance(2026-04-29 reviewer 复审追加)

> 4 reviewer (GPT/deepseek/GLM/kimi) 在 RH0-RH2 复审中累积识别 17 项 carry-over,deepseek R10 警告 RH3 容量风险。本节显式登记 RH3 必须在自身 9 项 In-Scope 之外吸纳的关键 carry-over,并对每项做容量评估。
>
> | carry-over ID | 来源 | 状态 | RH3 处置 | 工作量 |
> |---|---|---|---|---|
> | C1 — `IngressAuthSnapshot.user_uuid` 进入 NanoSessionDO,解锁 `pushServerFrameToClient` 真投递 | RH1 P1-08 wire-only(deepseek R1 / GPT R2 / GLM R2 / kimi R6 一致 high blocker)| **RH3 D6 必须落地**(charter §10.3 NOT-成功退出第 1 条;否则 RH1 Lane F live runtime 不闭合)| **吸纳为 P3-S6 一部分**:device gate 落地时 IngressAuthSnapshot 加 `user_uuid` 字段,NanoSessionDO 在 attach/start 时从 snapshot 取 user_uuid 赋值给 `this.env.USER_UUID` 等价访问路径(或新增 `this.userUuid` 字段)| S(1 个 wire 字段 + 1 个赋值点 + 1 个 e2e 验证)|
> | C2 — P1-10 / P1-11 / P1-12 三个 round-trip e2e 文件 | RH1 P1-10/11/12 missing | C1 落地后 RH3 必须补;无此 3 文件不能宣称 Lane F live runtime 闭合 | **吸纳为 P3 新增工作项 P3-CO-RH1**:补 `tests/cross-e2e/permission-round-trip.e2e.test.ts` / `elicitation-round-trip.e2e.test.ts` / `usage-push.e2e.test.ts` | M(3 个 e2e ≈ 200 行/each,需 miniflare wrap)|
> | C3 — WS lifecycle hardening 4 must-cover scenario(normal close / abnormal disconnect / heartbeat miss / replay-after-reconnect)+ DO alarm wire | RH2 Phase 4 charter §7.3 P2-C deferred(deepseek R4 / GLM 隐含 / kimi 隐含)| **RH3 device gate 落地后 client 真 attached → 4 scenario 才可验证**;吸纳为 P3-S6 配套 | **吸纳为 P3 新增工作项 P3-CO-RH2-WS**:`user-do.ts` handleWsAttach 升级 + heartbeat alarm + 4 scenario 用例 | M-L(DO alarm + 4 lifecycle case ≈ 400 行)|
> | C4 — migration 008-models.sql apply 到 preview D1 | RH2 owner-action(GPT R4 / GLM R6 / deepseek R7 / kimi 隐含)| **RH3 启动前 owner 必须 apply**(GLM R6 已要求 entry-gate enforce)| **RH3 entry-gate prereq**(本 action-plan §7 风险表显式补)| 0(owner-action,不占 RH3 工作量)|
> | C5 — entrypoint.ts kind-whitelist defense-in-depth | GLM R12 / kimi R5 / RH1 P1-06b shift to RH2 | non-blocking | 在 P3-S5 access path 校验时一并加(轻量 if statement)| XS(5 行) |
> | C6 — bootstrap-hardening charter-grade strength(miniflare/D1 100-concurrent + 5s slow + 真 storm)| RH0 P0-G partial(GPT R2 / kimi R2 / deepseek R6 / GLM R4)| **RH6 e2e harness 接续**,RH3 不吸纳 | 不在 RH3 scope | 0 |
> | C7 — 7 份 RH0 route test 行为面与 action-plan 漂移(messages-route 403 wrong-device / me-devices revoked exclusion 等)| GPT F3 / kimi R3 / GLM R5 | **RH3 device gate 落地时同步升级 7 份 route test** | 吸纳为 P3-S5 / P3-S6 配套(行为面对齐:`me-devices` 加 status='active' 过滤 + assertion;`messages-route` 加 wrong-device 403 ;`permission-decision` 加 unknown request_uuid 等)| S-M(每文件 1-2 个 case 调整)|
> | C8 — context-route.test.ts 9 → 15 case(GET 5 + snapshot 5 + compact 5)| RH2 r1 partial(kimi R4 / GLM R10)| **RH2 closure r2 已补足 6 case → 15 case**;无 RH3 吸纳工作 | 已闭合 | 0(已落地)|
> | C9 — context-core 真实 per-session inspector(替换 `phase: "stub"`)| RH2 Phase 3 inspector-stub(deepseek R2 / GLM R3)| **RH4 file pipeline 落地后接入 inspector-facade** | 不在 RH3 scope | 0 |
> | C10 — Web + Wechat client adapter 升级(消费 `session.attachment.superseded` / `tool.call.result` / `llm.delta` / `session.permission.request` / `session.elicitation.request` / `session.usage.update`)| RH2 Phase 6 audit-only(deepseek R8 / GPT O1)| **RH3 D6 落地后 owner-action**;UI live 观察 cross-worker push | 不在 RH3 scope(owner-action) | 0 |
>
> **RH3 容量评估**:S1-S9(原 9 项)+ C1(吸纳到 S6)+ C2 / C3(各为新工作项)+ C5 / C7(配套吸纳)= **RH3 实质规模从 M 上调到 M-L**(deepseek R10 警告吸收;C2 / C3 是其中最大增量)。如 C2 / C3 在 RH3 实施中暴露超容量,可降级 C2 到 RH4 / C3 到 RH3.5,但 **C1 不可降级**(无 user_uuid 则 Lane F live 不闭合,RH3 自身的 device gate 也无 attached client 可验证)。

### 2.2 Out-of-Scope

- **[O1]** API key admin plane（list/create UI）→ hero-to-platform
- **[O2]** team invite / member management → hero-to-platform
- **[O3]** OAuth federation → hero-to-platform
- **[O4]** user-supplied slug → hero-to-platform

### 2.3 边界判定表

| 项目 | 判定 | 理由 |
|------|------|------|
| 注册时让 user 自定 slug | out-of-scope | RHX Q1 业主已同意完全自动 |
| revoke 后 access token 继续有效到 exp | out-of-scope | 不满足 charter auth criterion |
| `/auth/api-keys/list` UI | out-of-scope | admin plane |
| internal `createApiKey` RPC（owner manual 用）| in-scope | charter §1.2 grey box |

---

## 3. 业务工作总表

| 编号 | Phase | 工作项 | 类型 | 文件 | 风险 |
|------|-------|--------|------|------|------|
| P3-01 | 1 | migration 009 | add | `migrations/009-team-display-and-api-keys.sql` | medium |
| P3-02 | 2 | contract schema 升级 | update | `orchestrator-auth-contract/src/index.ts` + version bump | low |
| P3-03 | 3 | login/register mint device_uuid | update | `orchestrator-auth/src/{service,public-surface}.ts` | medium |
| P3-04 | 3 | refresh rotation bind device | update | `orchestrator-auth/src/service.ts` | medium |
| P3-05 | 4 | authenticateRequest device gate | update | `orchestrator-core/src/auth.ts` | high |
| P3-06 | 4 | WS attach device gate | update | `user-do.ts:handleWsAttach` | high |
| P3-07 | 4 | revoke force-disconnect | add | `orchestrator-core/src/index.ts:handleMeDevicesRevoke` 或 `auth.ts` | high |
| P3-08 | 5 | verifyApiKey 真实化 | update | `orchestrator-auth/src/service.ts:402-413` | medium |
| P3-09 | 5 | authenticateRequest API key 双轨 | update | `orchestrator-core/src/auth.ts` | medium |
| P3-10 | 5 | internal createApiKey RPC | add | `orchestrator-auth/src/service.ts` | low |
| P3-11 | 6 | team_slug 自动生成 | update | `orchestrator-auth/src/service.ts:register` | low |
| P3-12 | 6 | `/me/team` GET + PATCH | add | `orchestrator-core/src/index.ts` + `user-do.ts` | low |
| P3-13 | 6 | `GET /me/teams` | add | 同上 | low |
| P3-14 | 7 | `/me/conversations` 双源 + cursor | update | `orchestrator-core/src/index.ts:618-646` + `user-do.ts:1810+` | medium |
| P3-15 | 8 | endpoint test ≥5×N | add | test files | low |
| P3-16 | 8 | device revoke e2e（含 force-disconnect）| add | `test/cross-e2e/device-revoke.e2e.test.ts` | medium |
| P3-17 | 8 | API key smoke | add | `tests/api-key-smoke.test.ts` | low |
| P3-18 | 8 | preview smoke + 归档 | manual | `docs/issue/real-to-hero/RH3-evidence.md` | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Migration 009

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P3-01 | 三表变更（含 forward-only slug data-fill 序列）| **完整 SQL 序列（同一 migration 文件 atomic）**：<br/>(1) `ALTER TABLE nano_teams ADD COLUMN team_name TEXT NOT NULL DEFAULT '';`<br/>(2) `ALTER TABLE nano_teams ADD COLUMN team_slug TEXT;` (先允许 NULL)<br/>(3) data fill: `UPDATE nano_teams SET team_slug = lower(substr(replace(coalesce(nullif(team_name,''), 'team-' \|\| substr(team_uuid,1,8)),' ','-'),1,25)) \|\| '-' \|\| lower(hex(randomblob(3))) WHERE team_slug IS NULL;`<br/>(4) `CREATE UNIQUE INDEX uq_nano_teams_team_slug ON nano_teams(team_slug);`<br/>(5) (D1 不支持 `ALTER COLUMN ... SET NOT NULL`；通过 application layer + insert 默认生成保证后续行非空，旧行 fill 后均非空)<br/>(6) `ALTER TABLE nano_team_api_keys ADD COLUMN key_salt TEXT NOT NULL DEFAULT '';` (现有行 salt = '' 由 RH3 P3-08 verifyApiKey 路径在首次成功 verify 时升级；新建 key 用 P3-10 internal RPC mint salt)<br/>(7) `ALTER TABLE nano_auth_sessions ADD COLUMN device_uuid TEXT;` + `CREATE INDEX idx_nano_auth_sessions_device_uuid ON nano_auth_sessions(device_uuid);` | `migrations/009-team-display-and-api-keys.sql` | `wrangler d1 migrations apply` 全绿；现有数据 fill 后无 NULL slug；application layer 保证新建非空 |

### 4.2 Phase 2 — Contract Upgrade

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P3-02 | schema 升级 | `AuthTeamSchema` 加 `team_name: z.string()` + `team_slug: z.string().regex(/^[a-z0-9-]{1,32}$/)`；`AccessTokenClaimsSchema` + `AuthSnapshotSchema` 各加 `device_uuid: z.string()`；`VerifyApiKeyResultSchema` 改为成功 shape `{supported: true, team_uuid, key_id, ...}`；package version bump | `orchestrator-auth-contract/src/index.ts` | contract test 全绿；下游 worker import 不破 |

### 4.3 Phase 3 — Device Mint + Refresh Bind

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P3-03 | mint device_uuid | login/register handler 内：若请求未带 `device_uuid` header（client-supplied stable id）则服务端生成 UUIDv4；写入 `nano_user_devices` + 把 device_uuid 注入 access/refresh JWT claim + 写 `nano_auth_sessions.device_uuid` | `orchestrator-auth/src/{service,public-surface}.ts` | 单测 + endpoint test 验证 access token decode 含 device_uuid |
| P3-04 | refresh bind | refresh rotation 时校验旧 token 的 device_uuid 与 `nano_user_devices` 状态；revoked 直接 401；正常则保持 device_uuid 不变 | `orchestrator-auth/src/service.ts` | 单测：rotate 维持 device_uuid；rotate revoked → 401 |

### 4.4 Phase 4 — Device Auth Gate

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P3-05 | access path | `authenticateRequest` decode JWT → 读 device_uuid claim → 查 `nano_user_devices` 状态（含短 TTL ≤30s memory cache）；revoked → 401 + 同时按 user-team 把 cache 失效 | `orchestrator-core/src/auth.ts` | 单测 + e2e：revoke 后 ≤30s 内 access fail |
| P3-06 | WS attach | `handleWsAttach` 在 attach 前同样校验；revoked device 直接拒绝 + 关闭 WS | `user-do.ts:1905-1981` | e2e：revoked device 不能 attach |
| P3-07 | force-disconnect | `handleMeDevicesRevoke` 写 D1 后，找出该 device 当前 attached 的所有 session（通过 `nano_user_devices` ↔ `nano_auth_sessions` ↔ `session truth`），通过 `forwardServerFrameToClient` 推 `terminal` frame 关闭 WS | `index.ts:725-814` + `user-do.ts` cooperate | e2e：revoke 触发 force-disconnect ≤2s |

### 4.5 Phase 5 — API Key Runtime

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P3-08 | verifyApiKey | parse `nak_*` bearer → 通过 `key_id` prefix 查 `nano_team_api_keys` → HMAC-SHA256(salt:raw) 比对 hash → 返回 `{supported: true, team_uuid, key_id}`；keys 含 `revoked_at` 已撤销直接拒 | `orchestrator-auth/src/service.ts:402-414` | 单测 + smoke：`nak_*` bearer 通过；wrong key 401 |
| P3-09 | authenticateRequest 双轨 | bearer 以 `nak_` 开头 → 走 verifyApiKey；否则走 JWT；填入相同 `AuthSnapshot` shape（device_uuid 对 API key 用空串占位） | `orchestrator-core/src/auth.ts` | endpoint test：JWT + API key 各 ≥3 case |
| P3-10 | internal createApiKey | 新增 RPC method（**无 public route**）：参数 `{team_uuid, label}`；生成 `nak_<uuid>`、salt、hash 写 D1；返回 raw key 1 次 | `orchestrator-auth/src/service.ts` + RPC table | 单测：调用一次 + 返回 + 再调 verify 通过 |

### 4.6 Phase 6 — Team Display + /me/team + /me/teams

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P3-11 | team_slug 自动生成 | Workers runtime 友好实现（不可用 `Buffer.toString('base36')`，`'base36'` 不是 Node Buffer 的合法编码）：```const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';\nconst bytes = new Uint8Array(6);\ncrypto.getRandomValues(bytes);\nconst suffix = Array.from(bytes, b => ALPHABET[b % 36]).join('');\nconst slug = `${slugify(team_name).slice(0, 25)}-${suffix}`;```；冲突时**循环重试 ≤ 5 次**（理论冲突率 ≈ 36⁻⁶ ≈ 4.6e-10，retry 1 次已极少；retry 5 次后仍冲突则 500 + alert）；写 D1 | `orchestrator-auth/src/service.ts:register` | endpoint test：注册返回的 team 含 slug；slug regex `/^[a-z0-9-]{1,32}$/` 匹配；retry-loop 单测 |
| P3-12 | /me/team GET + PATCH | GET 返回 `AuthTeam` 当前；PATCH 仅允许更新 `team_name`（不能改 slug） | `index.ts` route + `user-do.ts` handler | endpoint test ≥5 |
| P3-13 | GET /me/teams | 返回 user 所属全部 team list；SQL 模式：`SELECT t.team_uuid, t.team_name, t.team_slug, m.membership_level FROM nano_teams t INNER JOIN nano_team_memberships m ON m.team_uuid = t.team_uuid WHERE m.user_uuid = ?`；只读 | 同上 | endpoint test ≥5（401, single team, multi team, 跨 user 不可见, 字段 shape）|

### 4.7 Phase 7 — /me/conversations 双源 + cursor

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P3-14 | 双源 + cursor | **前置分析步骤**：先在 PR description 内列出当前 `handleMeConversations`（user-do.ts:1810+，仅 D1 by `conversation_uuid`）vs `handleMeSessions`（user-do.ts:1738-1805，D1+KV 合并）在 数据源 / 合并逻辑 / 排序 / 分页 / status filter 上的逐项差异，并判定差异是 **bug**（implementer 漏 KV merge）还是 **设计意图**（conversations 是 D1 product truth 只读视图）；如判定 bug → 改为参考 `handleMeSessions` 的 D1+KV 合并逻辑；如判定设计意图 → 不需 KV merge，但补 docs 解释 conversations 的语义。**默认假设为 bug**（charter §1.2 G12 已标 conversations/sessions 不一致为 partial-close 残留）。分页用 keyset cursor `(updated_at, session_uuid)`；末页 `next_cursor=null` | `index.ts:618-646` + `user-do.ts:1810+` + PR description 含差异分析表 | endpoint test ≥5（first page / cursor 翻 / 末页 null / 跨 user 不可见 / 401）|

### 4.8 Phase 8 — E2E + Preview Smoke

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P3-15 | endpoint test | 所有新 endpoint 各 ≥5 case | test files | 全绿 |
| P3-16 | device revoke e2e | 跨 worker：login → start session → revoke device → 验证 access 401 + WS 收 terminal | `test/cross-e2e/device-revoke.e2e.test.ts` | 1 e2e 通过 |
| P3-17 | API key smoke | curl `nak_*` bearer 调 `/auth/me` 与 `/sessions/*` | `tests/api-key-smoke.test.ts` | 通过 |
| P3-18 | preview smoke | preview deploy → 业主 manual：注册 / 登录 / 在第二台设备 revoke 第一台 / 第一台 WS 自动断开 | `docs/issue/real-to-hero/RH3-evidence.md` | 文档 ≥1KB + 截图 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Migration 009

- **风险**：业主已同意 slug NOT NULL，**需要在 migration 内对现有 nano_teams 行做 data fill**（按当前 team_uuid 生成 slug 并 upsert）；avoid breaking ZX5 production data
- **回滚**：migration 是 forward-only；如失败需要新 migration 010 修复，不允许直接 down

### 5.2 Phase 2 — Contract Upgrade

- **依赖**：Phase 1 完成
- **风险**：contract package 版本升级会触发所有依赖 worker 重新 install；先在 lockfile 锁定再发版
- **测试**：现有 contract test + 新增 negative case

### 5.3 Phase 3-4 — Device 全链路

- **核心目标**：device claim 全链路 + access/refresh/WS gate + force-disconnect
- **风险**：access path 加 D1 查询会增加 hot path latency；解决方案 = ≤30s memory cache + revoke 主动清；revoke 路径必须**同时**在 service binding 通知所有 worker 实例做 cache invalidation（first-wave 用单 DO 维护 cache + Periodic refresh 即可）
- **测试**：cross-worker e2e + cache invalidation unit

### 5.4 Phase 5 — API Key

- **风险**：bearer 形态歧义，必须严格按 `nak_` 前缀区分；JWT mint 时**禁止**生成 `nak_` 开头的 sub
- **测试**：5×JWT + 5×API key + 1 cross-bearer-confusion negative

### 5.5 Phase 6 — Team Display

- **风险**：slug 自动生成在极少情况下冲突，重试 1 次；2 次失败直接 500；observability 加 alert
- **测试**：endpoint test 含 multi-team 场景

### 5.6 Phase 7 — Conversations 双源

- **风险**：D1+KV 合并的 freshness window 与 `handleMeSessions` 必须一致，否则两个 endpoint 对同一会话状态判定不同
- **测试**：构造同会话出现于 D1 但 KV 缺、KV 但 D1 缺、双有 不同 status 三 case

### 5.7 Phase 8 — E2E + Smoke

- **风险**：preview smoke 必须在两台真实设备上做 revoke；business 数据隔离要求业主不要 revoke production demo 帐号

---

## 6. 依赖的冻结设计决策

| 决策 | 来源 | 影响 |
|------|------|------|
| RHX Q1 slug law | `RHX-qna Q1` | Phase 1 / 6 实施按此规范 |
| API key admin plane out-of-scope | charter §7.4 | Phase 5 仅 verify-only + internal RPC |
| OAuth out-of-scope | charter §7.4 | 无 |
| `/me/teams` 只读 | charter §4.3 | Phase 6 不引入 invite |
| device gate timeout 短 TTL cache 允许 | design RH3 §6.2 | Phase 4 加 ≤30s cache |
| migration 编号 = 009 | charter §8.4 | Phase 1 编号锁定 |

---

## 7. 风险、依赖、完成后状态

### 7.1 风险

| 风险 | 描述 | 判断 | 应对 |
|------|------|------|------|
| device gate hot path latency | 每 access 多一次 D1 | high | ≤30s memory cache + revoke 主动清 |
| force-disconnect cross-worker timing | revoke 与 WS terminal 之间窗口 | medium | revoke 完成后 sync push terminal，先 commit D1 再 push |
| migration 009 现有数据 slug fill | NOT NULL 约束需先填值 | medium | data migration 在同一 migration 文件内 |
| API key bearer 与 JWT 冲突 | shape 区分不严 | high | `nak_` 前缀 + JWT 禁止生成相同 prefix |

### 7.2 约束

- **技术前提**：RH1 closure；`forwardServerFrameToClient` RPC 可用
- **运行时前提**：D1 schema 009 部署
- **组织协作**：业主 Phase 8 提供 2 设备 revoke evidence

### 7.3 文档同步

- `docs/api/auth-protocol.md`
- `docs/api/api-key-howto.md`（internal use only）
- `docs/api/me-surface.md`

### 7.4 完成后状态

1. device 全链路 live：mint / refresh bind / access gate / WS gate / force-disconnect
2. `nak_*` API key 可作 bearer 通过 façade ingress
3. `/me/team` GET+PATCH、`/me/teams` GET、`/me/conversations` 双源 + cursor 全部就位
4. `orchestrator-auth-contract` 升版完成
5. RH4 / RH5 / RH6 可基于 RH3 closure 启动

---

## 8. 整体测试与收口

### 8.1 整体测试

- **基础**：6 worker dry-run；既有测试不回归
- **单测**：mint/rotate/verify/cache invalidation 全套
- **集成**：device revoke + force-disconnect e2e；API key smoke
- **端到端**：业主双设备 manual revoke evidence
- **回归**：RH0 P0-B 5 endpoint test 不破

### 8.2 整体收口

1. migration 009 部署；3 表变更生效
2. device 5 链路（mint / refresh / access / WS / revoke）e2e 全绿
3. API key 双轨认证 + 5 case smoke
4. team display + 3 me endpoint + conversations 双源 全部 ≥5 case
5. 业主 device revoke evidence 归档
6. RH4 Per-Phase Entry Gate 满足

### 8.3 DoD

| 维度 | 完成定义 |
|------|----------|
| 功能 | device live + API key live + team display live + conversations 对齐 |
| 测试 | endpoint ≥30 case + cross-worker e2e ≥3 |
| 文档 | 3 份 API doc + RH3-evidence.md |
| 风险收敛 | force-disconnect ≤2s；access path latency 增加 ≤5ms p99 |
| 可交付性 | RH4/5/6 可启动 |
