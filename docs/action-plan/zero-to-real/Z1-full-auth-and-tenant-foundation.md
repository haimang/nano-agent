# Z1 — Full Auth and Tenant Foundation

> 服务业务簇: `zero-to-real / Z1 / full-auth-and-tenant-foundation`
> 计划对象: `建立 internal-only orchestration.auth、真实 end-user auth、WeChat bridge 与 tenant foundation`
> 类型: `migration`
> 作者: `GPT-5.4`
> 时间: `2026-04-25`
> 文件位置: `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
> 关联设计 / 调研文档:
> - `docs/charter/plan-zero-to-real.md`
> - `docs/design/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
> - `docs/design/zero-to-real/ZX-qna.md`
> - `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md`
> - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
> - `docs/design/zero-to-real/ZX-nacp-realization-track.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

Z1 是 zero-to-real 的第一道真实入口门。当前仓库只有 `workers/orchestrator-core/src/auth.ts` 的 verify reality，没有 `orchestration.auth` worker、没有 JWT mint/refresh 真路径、没有 D1 identity core、没有 WeChat bridge。后续的 Z2 session truth、Z3 runtime、Z4 clients 都不能建立在这个“只有 verify、没有真实登录”的入口之上。

因此 Z1 的执行目标不是“加几个 auth route”，而是一次性完成 4 个基础面：新建 `orchestration.auth` internal-only worker、落 Wave A D1 identity schema、建立 register/login/refresh/me 的真实链路、以及打通 WeChat 首登自动建 team 的 tenant foundation。做到这一点之后，系统才算拥有真实 user/team/token truth。

- **服务业务簇**：`zero-to-real / Z1`
- **计划对象**：`Full Auth and Tenant Foundation`
- **本次计划解决的问题**：
  - `workers/orchestrator-core/src/auth.ts` 只有 verify，没有 mint/refresh/WeChat reality
  - `workers/orchestration-auth/` 与 `packages/orchestration-auth-contract/` 尚不存在
  - `NANO_AGENT_DB` 的 identity core、`nano_auth_sessions`、`nano_team_api_keys` 尚未落成
  - web / Mini Program 需要真实 register/login/refresh/WeChat 入口，不能再靠假 token
- **本次计划的直接产出**：
  - `packages/orchestration-auth-contract/**`
  - `workers/orchestration-auth/**` + `workers/orchestrator-core/**` auth proxy wiring
  - `workers/orchestrator-core/migrations/001-identity-core.sql`（或等价 wave-A migrations）
  - `docs/issue/zero-to-real/Z1-closure.md`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先合同与数据基底、再建 internal auth worker、再接 full user flow、最后接 WeChat + tenant negative tests** 的方式推进。先把 contract / schema / worker skeleton 建起来，避免实现 register/login 后再回头拆 transport 与 D1。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Contract + Wave A Schema | `M` | 建 `packages/orchestration-auth-contract/`、identity core migrations、worker bindings baseline | `Z0 closed` |
| Phase 2 | Auth Worker Bringup | `M` | 新建 `workers/orchestration-auth/`，让 `orchestration.core` 通过 WorkerEntrypoint RPC 调它 | `Phase 1` |
| Phase 3 | Full User Auth Flow | `L` | 打通 register/login/verify/refresh/reset/me 与 refresh rotation truth | `Phase 2` |
| Phase 4 | WeChat Bridge + Tenant Bootstrap | `M` | 接 WeChat `code -> openid -> JWT` 与 default team bootstrap | `Phase 3` |
| Phase 5 | Negative Tests + Z1 Closure | `S` | 跑双租户 / forged authority / auth proxy 证明并写 closure | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — Contract + Wave A Schema**
   - **核心目标**：让 auth boundary 与 D1 identity truth 在代码结构上先站住。
   - **为什么先做**：Q1/Q2/Q3/Q4 已冻结，必须先把 contract / schema 落点定好，后续实现才不会漂。
2. **Phase 2 — Auth Worker Bringup**
   - **核心目标**：把 `orchestration.auth` 真正建出来，并让 `orchestration.core` 只做代理。
   - **为什么放在这里**：没有 worker skeleton 与 binding，full auth flow 无法落地。
3. **Phase 3 — Full User Auth Flow**
   - **核心目标**：完成 register/login/verify/refresh/reset/me 的真实 JWT 流。
   - **为什么放在这里**：只有 auth worker 存在后，full flow 才有真实 owner。
4. **Phase 4 — WeChat Bridge + Tenant Bootstrap**
   - **核心目标**：把 code-level WeChat 登录变成真实 tenant-safe 登录链路。
   - **为什么放在这里**：它必须建立在已存在的 JWT / identity / membership truth 之上。
5. **Phase 5 — Negative Tests + Z1 Closure**
   - **核心目标**：用负例与 closure 证明 auth boundary、tenant boundary、WeChat bridge 都成立。
   - **为什么放在最后**：closure 只能建立在 full flow 与 WeChat 链路都打通之后。

### 1.4 执行策略说明

- **执行顺序原则**：`先 contract + schema，再 worker skeleton，再 user flow，再 WeChat/tenant，再 closure`
- **风险控制原则**：`auth worker 只接受 orchestration.core 调用；不让 auth 逻辑继续散落回 runtime mesh`
- **测试推进原则**：`优先复用 package-e2e / cross-e2e；新增 auth worker tests 与双租户负例，不另建平行 runner`
- **文档同步原则**：`Q1-Q4 只从 ZX-qna 消费；Z1 closure 与 ZX-D1 / ZX-NACP / ZX-binding 保持同口径`

### 1.5 本次 action-plan 影响目录树

```text
Z1 Full Auth and Tenant Foundation
├── packages/
│   └── orchestration-auth-contract/           [new]
├── workers/
│   ├── orchestration-auth/                    [new]
│   │   ├── src/
│   │   └── wrangler.jsonc
│   └── orchestrator-core/
│       ├── src/index.ts
│       ├── src/auth.ts
│       ├── src/policy/authority.ts
│       ├── wrangler.jsonc
│       └── migrations/
│           └── 001-identity-core.sql          [new]
├── test/
│   ├── shared/
│   │   ├── orchestrator-auth.mjs
│   │   └── orchestrator-jwt.mjs
│   ├── package-e2e/
│   │   ├── orchestration-auth/                [new]
│   │   └── orchestrator-core/
│   └── cross-e2e/
└── docs/issue/zero-to-real/Z1-closure.md      [new]
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 新建 `packages/orchestration-auth-contract/`，承载 typed RPC contracts
- **[S2]** 新建 `workers/orchestration-auth/`，并让其成为 internal-only single-caller worker
- **[S3]** 落 Wave A D1 schema：identity core + `nano_auth_sessions` + `nano_team_api_keys`
- **[S4]** 打通 register/login/verify/refresh/reset/me 真实 auth flow
- **[S5]** 打通 WeChat `code -> openid -> nano_user_identities -> JWT` 真实链路
- **[S6]** 自动创建 default team + owner membership，并完成双租户 negative tests

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 完整 tenant/member/API key admin plane
- **[O2]** session / turn / message / audit 持久化主线
- **[O3]** real provider / quota / runtime evidence
- **[O4]** 完整 Mini Program 真机 hardening

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `packages/orchestration-auth-contract/` | `in-scope` | Q1 已冻结 typed contract package 是 Z1 必需 deliverable | `Z1 执行期` |
| `nano_team_api_keys` schema | `in-scope` | Q4 已冻结 schema reserved 进入 Wave A | `Z1 执行期` |
| API key verify runtime impl | `out-of-scope` | Q4 仅保留 schema reserved，不抢跑实现 | `下一阶段有 S2S consumer 时` |
| password hash 升级到更强 KDF | `out-of-scope` | 设计已冻结 first-wave 继续 `SHA-256 + PASSWORD_SALT` | `下一阶段安全 hardening` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | auth contract package | `add` | `packages/orchestration-auth-contract/**` | 凝固 caller/callee 的 typed contract | `medium` |
| P1-02 | Phase 1 | wave-A migrations | `add` | `workers/orchestrator-core/migrations/001-identity-core.sql` `workers/orchestration-auth/wrangler.jsonc` `workers/orchestrator-core/wrangler.jsonc` | 建立 identity / token state / api key reserved schema 与 shared D1 baseline | `medium` |
| P2-01 | Phase 2 | auth worker scaffold | `add` | `workers/orchestration-auth/**` | 建出 internal-only auth worker | `high` |
| P2-02 | Phase 2 | orchestrator auth proxy wiring | `update` | `workers/orchestrator-core/src/index.ts` `src/auth.ts` `wrangler.jsonc` | 让 public auth surface 只走 orchestration.core | `high` |
| P3-01 | Phase 3 | register/login/me/verify | `update` | `workers/orchestration-auth/src/**` | 建立基础 JWT 与 user/team readback | `high` |
| P3-02 | Phase 3 | refresh/reset/token rotation | `update` | `workers/orchestration-auth/src/**` `test/shared/orchestrator-jwt.mjs` | 完成 refresh state 与 `kid`/rotation baseline | `high` |
| P4-01 | Phase 4 | WeChat bridge | `update` | `workers/orchestration-auth/src/**` | 接通 `jscode2session` 与 identity upsert | `high` |
| P4-02 | Phase 4 | tenant bootstrap | `update` | `workers/orchestration-auth/src/**` | 自动建 default team + owner membership | `medium` |
| P5-01 | Phase 5 | auth negative tests | `update` | `test/package-e2e/**` `test/cross-e2e/**` | 证明 tenant/no-escalation/auth proxy 成立 | `medium` |
| P5-02 | Phase 5 | Z1 closure | `add` | `docs/issue/zero-to-real/Z1-closure.md` | 形成 Z1 完成证明 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Contract + Wave A Schema

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | auth contract package | 新建 `packages/orchestration-auth-contract/`，定义 `Register/Login/Refresh/Me/WechatLogin` request/response、shared `AuthEnvelope`、typed `AuthErrorCode`，以及 schema-reserved `VerifyApiKey*` contract stub | `packages/orchestration-auth-contract/**` | auth boundary 的 caller/callee 语义固定 | typecheck / package tests | orchestrator 与 auth worker 都从同一 package import contract；接口集合不再靠实现期猜测 |
| P1-02 | wave-A migrations | 依据 ZX-D1 建 `nano_users / nano_user_profiles / nano_user_identities / nano_teams / nano_team_memberships / nano_auth_sessions / nano_team_api_keys`，并冻结 D1 alias=`NANO_AGENT_DB`、migration 目录=`workers/orchestrator-core/migrations/`、manual apply=`wrangler d1 migrations apply NANO_AGENT_DB` | `workers/orchestrator-core/migrations/001-identity-core.sql` `workers/orchestration-auth/wrangler.jsonc` `workers/orchestrator-core/wrangler.jsonc` | identity truth 与 token state 真相层存在 | migration smoke / D1 schema review | `NANO_AGENT_DB` wave-A schema 可被 preview 环境 apply，且 auth/orchestrator 对同一 D1 instance 共享 binding |

### 4.2 Phase 2 — Auth Worker Bringup

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | auth worker scaffold | 新建 `workers/orchestration-auth/`，接 `NANO_AGENT_DB`、`PASSWORD_SALT`、`WECHAT_APPID`、`WECHAT_SECRET`、`JWT_SIGNING_KEY_<kid>`、`NANO_INTERNAL_BINDING_SECRET`，并复用 `workers/agent-core/src/host/internal-policy.ts` 的 single-caller enforcement pattern | `workers/orchestration-auth/**` | auth worker 成为真实 owner | package-e2e / preview probe | worker 可 deploy / probe，且无 public business route；非 `orchestration.core` caller 被 typed reject |
| P2-02 | orchestrator auth proxy wiring | `orchestration.core` 仅保留 public proxy 与 verify fast-path；verify 继续消费同一组 `JWT_SIGNING_KEY_<kid>`，所有 mint/write/WeChat 走 WorkerEntrypoint RPC | `workers/orchestrator-core/src/index.ts` `src/auth.ts` `wrangler.jsonc` | public auth surface 与 internal auth owner 解耦 | package-e2e / grep | `grep` 不再显示 orchestrator-core 内的生产签发路径；verify/mint owner 不再双份漂移 |

### 4.3 Phase 3 — Full User Auth Flow

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | register/login/me/verify | 实现 email/password register/login、JWT verify、`me`/tenant readback | `workers/orchestration-auth/src/**` `workers/orchestrator-core/src/index.ts` | web client 可用真实用户进入系统 | package-e2e / cross-e2e | register/login/me 通过，tenant readback 与 D1 一致 |
| P3-02 | refresh/reset/token rotation | 实现 refresh-token、revoke/rotate-on-use、`kid` + dual verify window、password reset，并冻结 claim set=`{user_uuid, team_uuid, team_plan_level, kid, iat, exp}` | `workers/orchestration-auth/src/**` `test/shared/orchestrator-jwt.mjs` | token lifecycle 可持续运行 | package-e2e / shared auth tests | access=1h、refresh=30d、`JWT_SIGNING_KEY_<kid>` 命名成立，revoked/expired/old-kid token 被正确处理 |

### 4.4 Phase 4 — WeChat Bridge + Tenant Bootstrap

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | WeChat bridge | 调 `jscode2session`，将 `openid` 写入 `nano_user_identities`，再 mint JWT；Z1 只要求开发者工具/等价 mock 的 code-level smoke，不把真机联调偷渡进来 | `workers/orchestration-auth/src/**` | Mini Program 具备真实 code-level 登录 | package-e2e / manual smoke | `code -> openid -> JWT` 可跑通，失败不留下脏中间态 |
| P4-02 | tenant bootstrap | email/password 与 WeChat 首登都自动建 default team + owner membership | `workers/orchestration-auth/src/**` | auth path 不再在 tenant 语义上分叉 | package-e2e / D1 row assertions | 两条路径都返回非空 `team_uuid`，且 membership 为 `owner` |

### 4.5 Phase 5 — Negative Tests + Z1 Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | auth negative tests | 覆盖 forged token、tenant mismatch、cross-team readback、non-orchestrator caller 等负例 | `test/package-e2e/orchestration-auth/**` `test/package-e2e/orchestrator-core/**` `test/cross-e2e/**` | Z1 安全面可证明 | `pnpm test:package-e2e` / `pnpm test:cross-e2e` | 双租户与 forged authority 负例稳定 reject |
| P5-02 | Z1 closure | 写 `Z1-closure.md`，记录 auth worker、wave-A schema、WeChat chain、negative tests 的完成状态 | `docs/issue/zero-to-real/Z1-closure.md` | Z1 可以被 Z2 直接消费 | 文档 review | closure 可直接列为 Z2 前置输入 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Contract + Wave A Schema

- **Phase 目标**：先把 auth boundary 与 identity truth 的代码落点固定住
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `packages/orchestration-auth-contract/**`
  - `workers/orchestrator-core/migrations/001-identity-core.sql`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/wrangler.jsonc`
- **具体功能预期**：
  1. auth contract 由单一 package 持有。
  2. `NANO_AGENT_DB` 的 wave-A schema 已能支撑 Z1 全部流程。
  3. migration runner / binding alias / tool path 不再留给实现期猜测。
  4. schema reserved 与 impl-in-scope 的边界清晰（特别是 API key）。
- **具体测试安排**：
  - **单测**：`packages/orchestration-auth-contract` 类型/shape tests
  - **集成测试**：`migration apply smoke`
  - **回归测试**：`现有 orchestrator auth negative tests`
  - **手动验证**：`检查 migration 与 ZX-D1 字段冻结一致`
- **收口标准**：
  - contract package 可被 orchestrator/auth worker 同时消费
  - wave-A schema apply 成功
  - `wrangler d1 migrations apply NANO_AGENT_DB` 成为共享 manual path，worker 只做 schema version/assertion，不在启动期偷跑 DDL
  - Q1-Q4 的关键结构已具象到代码落点
- **本 Phase 风险提醒**：
  - 最容易漏掉 `nano_auth_sessions` / `nano_team_api_keys`
  - 最容易把 `orchestration.auth` contract 漂成 ad-hoc JSON

### 5.2 Phase 2 — Auth Worker Bringup

- **Phase 目标**：让 auth ownership 真正离开 runtime mesh，进入独立 internal worker
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `workers/orchestration-auth/src/index.ts`
  - `workers/orchestration-auth/wrangler.jsonc`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/auth.ts`
  - `workers/orchestrator-core/wrangler.jsonc`
- **具体功能预期**：
  1. `orchestration.auth` 成为 internal-only single-caller worker。
  2. `orchestration.core` 保留 verify fast-path，但与 auth worker 共享同一组 `JWT_SIGNING_KEY_<kid>`。
  3. `orchestration.core` 不再承担生产签发路径。
  4. preview deploy 可证明 auth worker 已真实存在。
- **具体测试安排**：
  - **单测**：`auth worker handler / contract validation`
  - **集成测试**：`orchestrator -> auth WorkerEntrypoint RPC smoke`
  - **回归测试**：`现有 orchestrator-core auth negative tests`
  - **手动验证**：`确认无 public auth worker route`
- **收口标准**：
  - `workers/orchestration-auth/` 可独立 deploy
  - `NANO_INTERNAL_BINDING_SECRET` + no-public-route + negative tests 共同证明 single-caller discipline
  - orchestrator 只做代理，不再 mint token
  - non-orchestrator caller 被 typed reject
- **本 Phase 风险提醒**：
  - 最容易把 verify/mint 逻辑保留成双份 owner

### 5.3 Phase 3 — Full User Auth Flow

- **Phase 目标**：把真实 JWT / refresh / me 入口打通到可被 web 消费的程度
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `test/package-e2e/orchestration-auth/**`
- **本 Phase 修改文件**：
  - `workers/orchestration-auth/src/**`
  - `test/shared/orchestrator-auth.mjs`
  - `test/shared/orchestrator-jwt.mjs`
- **具体功能预期**：
  1. email/password 路径可完成 register/login/refresh/me。
  2. JWT 使用 `HS256 + kid + single-sign + dual-verify-window`。
  3. access token=1h、refresh token=30d、rotate-on-use、secret 命名=`JWT_SIGNING_KEY_<kid>`。
  4. refresh rotation truth 进入 `nano_auth_sessions`。
- **具体测试安排**：
  - **单测**：`JWT mint/verify helpers`
  - **集成测试**：`register/login/refresh/me`
  - **回归测试**：`orchestrator-core package-e2e`
  - **手动验证**：`旧 kid token 在窗口内仍可验证`
- **收口标准**：
  - access=1h、refresh=30d、rotate-on-use 与 Q2 一致
  - JWT header 含 `kid`，claim set=`{user_uuid, team_uuid, team_plan_level, kid, iat, exp}`
  - me / tenant readback 与 D1 truth 一致
  - invalid/revoked token 被 typed reject
- **本 Phase 风险提醒**：
  - 最容易把 refresh token 仅放内存或仅做 happy path

### 5.4 Phase 4 — WeChat Bridge + Tenant Bootstrap

- **Phase 目标**：让 Mini Program 的 auth 入口从 code-level smoke 进化成真实 tenant-safe 登录
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `workers/orchestration-auth/src/**`
  - `test/package-e2e/orchestration-auth/**`
- **具体功能预期**：
  1. `WECHAT_APPID / WECHAT_SECRET` 驱动真实 `jscode2session`。
  2. WeChat 与 email/password 两条入口都自动建 default team。
  3. 不出现 `user 已建但 team 未建` 中间态。
- **具体测试安排**：
  - **单测**：`WeChat response mapping`
  - **集成测试**：`code -> openid -> JWT`，以及 `jscode2session` 成功但后续 D1 写入失败时的回滚证明
  - **回归测试**：`tenant bootstrap + readback`
  - **手动验证**：`Mini Program 开发者工具 smoke`
- **收口标准**：
  - `nano_user_identities.identity_provider='wechat'` 可读
  - `team_uuid` 非空且 membership 正确
  - WeChat 失败不会留下脏数据（含 `jscode2session` 成功但下游写失败的回滚场景）
- **本 Phase 风险提醒**：
  - 最容易让两条 auth path 在 tenant 行为上分叉

### 5.5 Phase 5 — Negative Tests + Z1 Closure

- **Phase 目标**：用负例和 closure 证明 Z1 已经建立真实入口
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - `docs/issue/zero-to-real/Z1-closure.md`
- **本 Phase 修改文件**：
  - `test/package-e2e/orchestrator-core/06-auth-negative.test.mjs`
  - `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs`
- **具体功能预期**：
  1. forged token / tenant mismatch / non-caller auth invoke 全部被证明会失败。
  2. Z1 closure 可被 Z2 直接当输入文档。
  3. auth pure-RPC boundary 有明确证明。
- **具体测试安排**：
  - **单测**：`无新增单测要求`
  - **集成测试**：`auth negative fixtures`
  - **回归测试**：`pnpm test:package-e2e && pnpm test:cross-e2e`
  - **手动验证**：`closure 对照 Q1-Q4 + D1 rows`
- **收口标准**：
  - 双租户负例通过
  - WeChat smoke 至少通过一次
  - `docs/issue/zero-to-real/Z1-closure.md` 写明 deliverables / tests / known limitations
- **本 Phase 风险提醒**：
  - 最容易只证明 happy path，漏掉 no-escalation / caller discipline

---

## 6. 风险与依赖

| 风险 / 依赖 | 描述 | 缓解方式 |
|-------------|------|----------|
| RPC-first auth bringup 受平台限制 | WorkerEntrypoint 可能在实际预览中暴露兼容问题 | 保留 fetch-binding shim 过渡路径，但在 Z1 closure 中写明 retire deadline = Z2 closure 前 |
| WeChat 外部依赖不稳定 | `jscode2session` 调试与开发者工具 smoke 依赖外部平台 | 先完成 code-level smoke，再让 Z4 消费 |
| token truth 分叉 | orchestrator-core 与 auth worker 同时保留 mint path | 以 `packages/orchestration-auth-contract/` + grep + tests 强制单 owner |

---

## 7. 完成后的预期状态

Z1 完成后，系统将具备：

1. internal-only `orchestration.auth`
2. 真实 D1 identity / tenant / token truth
3. email/password + WeChat 两条真实登录链
4. 可被 Z2 session truth 与 Z4 clients 直接消费的 auth baseline

---

## 8. 本计划完成后立即解锁的后续动作

1. 启动 `Z2-session-truth-and-audit-baseline.md`
2. 以 `team_uuid` 非空、`AuthSnapshot -> NacpAuthority` 可用为前提推进 Z2
3. 在 Z4 client 侧开始消费真实 register/login/refresh/WeChat surface
