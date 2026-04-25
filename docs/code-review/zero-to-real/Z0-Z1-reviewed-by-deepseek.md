# Nano-Agent 代码审查报告

> 审查对象: `zero-to-real / Z0-Z1 阶段完整工作产出`
> 审查时间: `2026-04-26`
> 审查人: `DeepSeek v4 (deepseek-v4-pro)`
> 审查范围:
> - `docs/issue/zero-to-real/Z0-closure.md` / `docs/issue/zero-to-real/Z1-closure.md`
> - `packages/orchestrator-auth-contract/**`（新建 typed contract package）
> - `workers/orchestrator-auth/**`（新建 internal-only auth worker）
> - `workers/orchestrator-core/**`（修改：auth.ts/index.ts/wrangler.jsonc/migrations）
> - `test/package-e2e/orchestrator-auth/**`、`test/shared/**`（新增 + 修改）
> - `workers/orchestrator-core/test/**`（新增 auth.test.ts + 扩展 smoke.test.ts）
> - `context/ddl-v170/smind-01-tenant-identity.sql`（参考祖宗 schema）
> - `context/smind-admin/src/modules/identity/auth.service.ts`（参考祖宗实现）
> - `docs/charter/plan-zero-to-real.md`（基石文件）
> - `docs/design/zero-to-real/*.md`（设计文件）
> - `docs/design/zero-to-real/ZX-qna.md`（Q1-Q10 owner 回答 + Opus 约束）
> - `docs/action-plan/zero-to-real/Z0-*.md` / `Z1-*.md`（执行计划）
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`Z0-Z1 阶段的工作产出在架构正确性和工程纪律上主体成立。typed contract package、internal-only auth worker、kid-aware JWT keyring、WeChat bridge、D1 identity schema 与 caller discipline 均达成交付目标。存在 2 处需要修正的类型归属问题（AuthSnapshot 重复定义、contract "deploy-fill" 语义死代码），以及 3 处建议在 Z2 启动前规整的命名/状态/流转问题。整体可进入 Z2。`

- **结论等级**：`approve-with-followups`

- **本轮最关键的 1-3 个判断**：
  1. **`orchestrator-core/src/auth.ts` 自行定义了第二套 `AuthSnapshot` 接口**——与 `@haimang/orchestrator-auth-contract` 中的同名类型语义重叠但不完全一致。一个系统有两套 auth type 定义是后续漂移的根因。建议 orchestrator-core 直接从 contract package 导入 `AuthSnapshot`，仅保留其独有的 `AuthContext`、`InitialContextSeed`、`JwtPayload` 等非标准 type。
  2. **charter/设计文档中的命名 `orchestration.core` / `orchestration.auth` 与代码中的 `orchestrator-core` / `orchestrator-auth` 形成永久性的术语断层**——这不是 Z0-Z1 的执行错误（代码命名沿用了 repo 既有风格），但如果不在 Z2 启动前做一次文档术语与代码命名的显式对照，后续实现者将持续在两个命名空间之间跳跃。
  3. **Z1 的实际交付质量整体较高**：contract typed、WorkerEntrypoint RPC-first、kid-based keyring、`jscode2session` 真实调用、rotate-on-use refresh、D1 事务性建 bootstrap user、caller discipline 全部到位。与 smind-admin 参考实现相比，nano-agent 的 auth 实现在 token 轮换、多 provider、租户启动方面更完整；最显著的差异是 nano-agent 选择 opaque refresh token 而非 JWT refresh token，这是一个更安全的设计选择。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-zero-to-real.md` §7.2 / §9 / §10（Z1 in-scope、验证策略、退出条件）
  - `docs/design/zero-to-real/Z1-full-auth-and-tenant-foundation.md`（Z1 设计约束）
  - `docs/design/zero-to-real/ZX-qna.md`（Q1-Q4 owner 回答 + Opus 约束）
  - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md`（Z1 执行基线）
- **核查实现**：
  - `packages/orchestrator-auth-contract/src/index.ts` — 231 行 typed contract
  - `workers/orchestrator-auth/src/{index,service,jwt,repository,hash,errors,wechat}.ts` — 6 个源文件 + 1 个测试文件
  - `workers/orchestrator-core/src/{index,auth}.ts` — 修改后的 façade 与认证模块
  - `workers/orchestrator-core/migrations/001-identity-core.sql` — 82 行 Wave A DDL
  - `workers/orchestrator-auth/wrangler.jsonc` + `workers/orchestrator-core/wrangler.jsonc` — binding 配置
  - `context/ddl-v170/smind-01-tenant-identity.sql` — smind 祖宗 schema（对照基表结构）
  - `context/smind-admin/src/modules/identity/auth.service.ts` — smind 祖宗实现（对照 auth flow）
- **执行过的验证**：
  - 逐文件通读所有新建/修改的源文件
  - 类型对账：contract package 的 Zod schema → auth worker 的 import/parse → orchestrator-core 的 import
  - 表名对账：migration SQL → repository SQL → ZX-d1 design doc
  - JWT kid 链路对账：mint → header.kid → verify → collectVerificationKeys
  - caller discipline 验证：contract schema `z.literal("orchestrator-core")` → `assertAuthMeta()` → service.test.ts 负例 → smoke.test.ts mock
  - D1 binding 对账：wrangler.jsonc binding name → index.ts env interface → repository.ts constructor

### 1.1 已确认的正面事实

- **typed contract package 已建成**：`packages/orchestrator-auth-contract/` 提供 `OrchestratorAuthRpcService` 接口 + 8 组 Zod schema + 12 种 error code + envelope 辅助函数。contract 的输入/输出全部 typed，且被 auth worker 和 orchestrator-core 双方消费（`workspace:*` 依赖）。
- **WorkerEntrypoint RPC-first 已实现**：`class OrchestratorAuthEntrypoint extends WorkerEntrypoint<AuthWorkerEnv> implements OrchestratorAuthRpcService`（`workers/orchestrator-auth/src/index.ts:77-80`），8 个 RPC 方法全部 delegate 到 `AuthService`。
- **auth worker 为 internal-only**：fetch handler 仅接受 `GET /` 和 `GET /health`，其余返回 404 `"orchestrator.auth does not expose public business routes"`。probe response 显式声明 `public_business_routes: false`。package-e2e probe test 验证了 `POST /auth/login` → 404。
- **kid-aware JWT keyring**：mint 端（auth worker `jwt.ts:67-89`）通过 `JWT_SIGNING_KID` env var 选 active key，verify 端（auth worker `jwt.ts:136-173` 与 orchestrator-core `auth.ts:128-142`）按 `kid` 选 key、失败后 fallback 到其他 key。与 Q2 Opus 约束完全一致。
- **access_token 3600s / refresh_token 2592000s (30d)**：`service.ts:127` 和 `service.ts:145-146`。与 Q2 Opus 要求一致。
- **JWT header 含 `kid`**：mint 端 `jwt.ts:114` 写入 `{ alg: "HS256", typ: "JWT", kid }`。与 Q2 Opus 第 1 条约束一致。
- **JWT signing secret 落点 wrangler secret + env var 命名 `JWT_SIGNING_KEY_<kid>`**：`jwt.ts:56-58` 扫描所有以 `JWT_SIGNING_KEY_` 开头的 env var。与 Q2 Opus 第 2 条约束一致。
- **WeChat bridge 真实调 `jscode2session`**：`wechat.ts:27-34` 构造 `https://api.weixin.qq.com/sns/jscode2session` GET 请求，传 `appid` / `secret` / `js_code` / `grant_type`。失败时抛 `invalid-wechat-code` error。
- **WeChat 首登自动建 user + default team + membership**：`service.ts:352-363` 在 WeChat 首登时调用 `createBootstrapUser`（插入 5 张表）。email_password 注册同样走 `createBootstrapUser`（`service.ts:172-183`）。两条 auth path 在 tenant 行为上一致，与 Q3 Opus 第 2 条约束一致。
- **membership.role = owner (100)**：`repository.ts:205-207` 在 `createBootstrapUser` 中插入 `membership_level = 100`。与 Q3 Opus 第 3 条约束一致。
- **`nano_team_api_keys` schema reserved, impl deferred**：migration 中有 `nano_team_api_keys` 表（`001-identity-core.sql:62-70`）。contract 有 `verifyApiKey` RPC 方法但返回 `{ supported: false, reason: "reserved-for-future-phase" }`（`service.ts:370-382`）。与 Q4 Opus 约束完全一致。
- **caller discipline enforced**：`errors.ts:24-33` 的 `assertAuthMeta()` 使用 Zod `AuthRpcMetadataSchema` 校验 `caller` 必须为 `z.literal("orchestrator-core")`。Zod 层面的 `z.literal` 比 string compare 更强的类型强制。service.test.ts:235-248 验证了非 orchestrator caller 被拒绝。
- **D1 事务性建 bootstrap user**：`repository.ts:191-243` 使用 `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` 包裹 5 张表的 INSERT。与 Q3 Opus 第 4 条 "不允许 user 已建、team 未建中间态" 一致。
- **opaque refresh token (32-byte random base64url)**：`hash.ts:9` 使用 `crypto.getRandomValues` 生成，`hash.ts:2-7` 用 SHA-256 + PASSWORD_SALT 哈希后存入 D1。这比 smind-admin 的 JWT refresh token（直接签发 JWT）更安全：refresh token 本身不承载信息，泄露不暴露用户身份。
- **单元测试覆盖完整**：contract package 测试（Zod schema validation）、auth worker service 测试（register/login/refresh/me/reset/wechat/caller discipline full cycle）、orchestrator-core auth 测试（kid scoped + legacy verify）、orchestrator-core smoke 测试（auth proxy + missing binding）、live E2E probe 测试（auth worker internal-only）。
- **wrangler 配置正确**：两个 worker 的 `[[d1_databases]]` binding 都指向 `nano-agent-preview`，orchestrator-core 额外配置 `migrations_dir: "migrations"`。service binding `ORCHESTRATOR_AUTH` 在 orchestrator-core 的 `services` 中配置，preview env 同样配置。
- **migration SQL 表命名全部使用 `nano_` 前缀**：7 张表 + 4 个唯一索引。repository.ts 的 SQL 查询与 migration 表名完全一致。

### 1.2 已确认的负面事实

- **`orchestrator-core/src/auth.ts:20-30` 定义了第 2 套 `AuthSnapshot` 接口**：该接口有 `tenant_source: "claim" | "deploy-fill"` 字段，与 contract package 的 `AuthSnapshotSchema`（`tenant_source: z.enum(["claim", "deploy-fill"])`）字面上相同但类型实现上独立。contract 的 `AuthSnapshot` 还要求 `sub` / `user_uuid` / `team_uuid` / `tenant_uuid` / `membership_level` 全部为 required + non-optional，而 orchestrator-core 的本地 `AuthSnapshot` 把这些字段标记为 optional。两套类型语义冲突。
- **contract package 的 `AuthSnapshot.tenant_source` 枚举包含 `"deploy-fill"`**：但 auth worker 的 `buildSnapshot()`（`service.ts:95-106`）永远返回 `tenant_source: "claim"`。`"deploy-fill"` 值仅在 orchestrator-core 的 legacy `auth.ts:214` 中使用（当 token 无 team 声明时回填 `TEAM_UUID` 环境变量）。这意味着 contract package 为了兼容 legacy 行为而容纳了一个 auth worker 永远不会产生的值——形成 contract 层面的 dead code。
- **charter/design 文档的 `orchestration.core` / `orchestration.auth` 命名与代码的 `orchestrator-core` / `orchestrator-auth` 命名不一致**：代码沿用 repo 既有命名风格（`orchestrator-core`），但所有设计/计划/ closure 文档使用 `orchestration.core`。contract package 名为 `orchestrator-auth-contract`，更接近代码命名。这种双层命名会在 Z2-Z4 的文档-代码对照中持续产生歧义。
- **contract package 名为 `orchestrator-auth-contract`**：使用 `orchestrator`（单数执行者）而非 `orchestration`（抽象概念）前缀。这与 worker 目录命名 `orchestrator-auth` 一致，但与设计文档的 `orchestration.auth` 不一致。
- **`test/shared/orchestrator-auth.mjs` 使用 `NANO_AGENT_ORCHESTRATOR_JWT_SECRET` 和 `NANO_AGENT_ORCHESTRATOR_JWT_KID` 作为 env var 名**：而 auth worker 的 `jwt.ts` 使用 `JWT_SIGNING_KEY_<kid>` 和 `JWT_SIGNING_KID`。shared helper 与 worker 代码使用了不同的环境变量命名约定，E2E 测试运行者需要设置两套 env var 才能同时满足 shared helper 和 worker 实际需要。
- **`findIdentityBySubject()` 查询未过滤 `identity_status`**：`repository.ts:163-189` 的 SQL 在 `WHERE` 子句中只有 `identity_provider` 和 `provider_subject_normalized`，没有 `AND identity_status = 'active'` 过滤。对比 smind-admin 的 `auth.service.ts:20-21` 明确写了 `AND identity_status = 'active'`。这意味着如果将来引入非 active 状态（如 `suspended`、`pending_verification`），这些身份的登录不会被正确阻止。
- **`nano_team_api_keys` 表缺少 `status` 列**：对比 smind-admin 的 `smind_team_api_keys` 表有 `status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','rotating','revoked'))`，nano-agent 版本仅有 `revoked_at` 时间戳字段。缺少显式状态枚举会在未来实现 API key admin plane 时导致状态语义模糊。
- **无需重试/超时配置在 WeChat bridge 中**：`wechat.ts:34` 的 `fetch()` 调用无 `signal`（AbortController timeout）和 retry 逻辑。如果 `jscode2session` 响应超时或瞬时故障，用户会直接收到 `invalid-wechat-code` 错误而无自动重试。

---

## 2. 审查发现

### R1. `orchestrator-core/src/auth.ts` 自行定义了第二套 `AuthSnapshot` 类型，导致一个 repo 出现两种同名 auth type

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/auth.ts:20-30` — 定义了本地的 `AuthSnapshot` 接口，字段全部 optional + `tenant_source` 支持 `"deploy-fill"`。
  - `packages/orchestrator-auth-contract/src/index.ts:26-35` — 定义了 contract 的 `AuthSnapshotSchema`，字段多数 required + `tenant_source` 枚举 `["claim", "deploy-fill"]`。
  - `workers/orchestrator-core/src/auth.ts:1-5` — import 列表中**没有** import `AuthSnapshot` from contract package。
  - `workers/orchestrator-core/src/index.ts:3` — 仅 import 了 `type OrchestratorAuthRpcService`，未 import `AuthSnapshot` 或其他 contract type。
  - `workers/orchestrator-auth/src/service.ts:95-106` — `buildSnapshot()` 返回的 snapshot 符合 contract `AuthSnapshot` 的严格 shape（所有字段 required，`tenant_source: "claim"`）。
- **为什么重要**：
  - 两套 `AuthSnapshot` 在字段可选性（required vs optional）上语义不同——contract 版保证 `team_uuid` / `membership_level` 非空，orchestrator-core 本地版允许这些字段缺失（因为 legacy token 可能不含）。如果 Z2/Z3 的 session truth 或 runtime evidence 使用 contract 版的 strict shape 做类型校验，而 orchestrator-core 仍向 session DO 注入本地版的 loose shape，会导致类型推断错误或运行时 undefined 传播。
  - 更糟糕的是，`tenant_source: "deploy-fill"` 的值仅在 orchestrator-core 本地版中存在（auth worker 永远不产生），但 contract package 为了兼容而将其列入枚举。这是 contract 向 legacy 妥协的痕迹——要么 contract 不应包含 `"deploy-fill"`，要么 orchestrator-core 应该改用 contract 类型并通过显式转换兼容 legacy。
- **审查判断**：
  - 这是一个架构洁癖问题而非运行错误——当前的类型重复不会在 runtime 产生 crash，但会在 Z2/Z3 引入更多 consumer 后形成类型分叉。建议现在修正，成本最低。
- **建议修法**（推荐方案二选一）：
  - **方案 A（收束）**：从 contract package 导出 `AuthSnapshot` 类型（Zod inferred type），删除 `orchestrator-core/src/auth.ts` 中的本地定义，统一 import。对于 orchestrator-core 独有的 legacy 逻辑（deploy-fill），在 `authenticateRequest()` 内部显式构造符合 contract shape 的 snapshot（即确保 team_uuid/tenant_uuid/membership_level 在 deploy-fill 时有 fallback 值而非 undefined）。
  - **方案 B（分离）**：contract package 的 `AuthSnapshot` 改名为 `AuthViewSnapshot`（或 `AuthWorkerSnapshot`），明确它仅描述 auth worker 的输出。orchestrator-core 保留自己的 `AuthSnapshot` 作为 ingress 内部类型。两套类型通过一个 `toAuthViewSnapshot()` 转换函数连接。另，contract 中移除 `"deploy-fill"` 枚举值（因为它从来不被 auth worker 产生），改由 orchestrator-core 在消费侧处理。

---

### R2. charter/设计文档的 `orchestration.core` / `orchestration.auth` 命名与代码 `orchestrator-core` / `orchestrator-auth` 之间存在永久性术语断层

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/charter/plan-zero-to-real.md` — 全篇使用 `orchestration.core` / `orchestration.auth` / `agent.core` 等点号分隔的抽象名称。
  - `docs/design/zero-to-real/*.md` — 全系列设计文档沿用 charter 命名。
  - `docs/action-plan/zero-to-real/*.md` — 全系列 action-plan 沿用 charter 命名。
  - `workers/orchestrator-core/` — 实际 worker 目录名为 `orchestrator-core`（含 `-` 连接线）。
  - `workers/orchestrator-auth/` — 新建的 auth worker 目录名为 `orchestrator-auth`。
  - `packages/orchestrator-auth-contract/` — 新建的 contract package 名为 `orchestrator-auth-contract`。
  - `workers/orchestrator-core/wrangler.jsonc:3` — wrangler name = `nano-agent-orchestrator-core`。
  - `workers/orchestrator-auth/wrangler.jsonc:3` — wrangler name = `nano-agent-orchestrator-auth`。
- **为什么重要**：
  - 文档使用 `orchestration.core` 暗示这是一个抽象的服务概念名称（类似微服务命名），而代码使用 `orchestrator-core` 是具体的目录/wrangler 部署名称。在 Z0 的 design docs review 阶段这仅属于 low-priority naming gap，但在进入 Z2-Z4 的实际实现阶段后，实现者每次对照文档都需要做一次心理映射（"文档说的 orchestration.auth 就是 workers/orchestrator-auth"）。当 Z2 引入 `agent.core` RPC kickoff 时，类似的双层命名同样存在（文档中 agent.core 的 wrangler name = `nano-agent-agent-core`）。
  - 特别是 contract package 的 npm 名称 `@haimang/orchestrator-auth-contract` 与设计文档中的 "auth contract" 指代之间的关系——设计文档没有一处提到 npm package 名称，只描述功能。
- **审查判断**：
  - 这不是 Z1 实现错误——代码命名沿用了 repo 既有风格（`orchestrator-core` 在 orchestration-facade 阶段就已确立）。问题出在 charter/design/action-plan 层面，文档选择了与代码不同的命名风格但又互相引用。
- **建议修法**（选择最不影响下游 Z2-Z4 的路径）：
  - 不改代码命名（改动面太大，涉及 wrangler name、service binding、DO class name、npm package name）。
  - 在 `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md` 或新增一份简短对照表中追加 "术语：文档 vs 代码" 映射表，统一 Z2-Z5 实现者的认知：
    ```
    orchestration.core → workers/orchestrator-core (wrangler: nano-agent-orchestrator-core)
    orchestration.auth  → workers/orchestrator-auth (wrangler: nano-agent-orchestrator-auth)
    agent.core          → workers/agent-core (wrangler: nano-agent-agent-core)
    auth contract       → packages/orchestrator-auth-contract (@haimang/orchestrator-auth-contract)
    ```

---

### R3. `findIdentityBySubject()` 查询缺少 `identity_status` 过滤——与 smind-admin 参考实现的防御深度存在差异

- **严重级别**：`medium`
- **类型**：`security`
- **事实依据**：
  - `workers/orchestrator-auth/src/repository.ts:163-189` — `findIdentityBySubject()` 的 SQL WHERE 子句为：
    ```sql
    WHERE i.identity_provider = ?1
      AND i.provider_subject_normalized = ?2
    ```
  - `context/smind-admin/src/modules/identity/auth.service.ts:18-21` — smind-admin 的等阶查询为：
    ```sql
    WHERE identity_provider = 'email_password'
      AND provider_subject_normalized = ?
      AND identity_status = 'active'
    ```
  - `workers/orchestrator-core/migrations/001-identity-core.sql:24` — `nano_user_identities` 表定义了 `identity_status TEXT NOT NULL DEFAULT 'active'` 列，但没有定义 CHECK 约束（对比 smind-admin 的 `smind_users` 有 `CHECK(user_status IN ('pending_setup','active',...))`）。
- **为什么重要**：
  - 当前 migration 中 `identity_status` 的默认值是 `'active'`，因此在 Z1 阶段不会出现非 active 的 identity 行。但如果未来引入邮箱验证（`identity_status = 'pending_verification'`）或账号冻结（`identity_status = 'suspended'`），`findIdentityBySubject()` 会把非 active 的身份当作可登录返回，导致绕过验证或冻结。
  - smind-admin 作为一个已经上线的参考实现，在 auth flow 中显式过滤 `identity_status = 'active'` 是有生产经验的选择。nano-agent 不应丢失这层防御。
- **审查判断**：
  - 当前不构成 runtime bug（因为所有 identity 都是 `'active'`），但这是一个 "前向安全性缺陷"——随着 Z2-Z4 引入更多 identity 状态逻辑后，这个 gap 会被放大。
- **建议修法**：
  - 在 `findIdentityBySubject()` 的 SQL 中追加 `AND i.identity_status = 'active'`。
  - 同时在 `nano_user_identities` 表定义中追加 CHECK 约束：`CHECK (identity_status IN ('active', 'suspended', 'pending_verification'))`，与 smind-admin 的防御深度对齐。
  - 如果当下不想新增 migration（因为尚不需要其他状态），至少应在 Z1 closure 的 "known limitations" 中显式记录这个 gap，并在 Z2 的 audit-related migration 中修复。

---

### R4. `test/shared/orchestrator-auth.mjs` 的环境变量命名约定与 worker 代码不一致

- **严重级别**：`low`
- **类型**：`test-gap`
- **事实依据**：
  - `test/shared/orchestrator-auth.mjs`（30 行）— 读取 env var `NANO_AGENT_ORCHESTRATOR_JWT_SECRET` 和 `NANO_AGENT_ORCHESTRATOR_JWT_KID`。
  - `workers/orchestrator-auth/src/jwt.ts:56-58` — 扫描 `JWT_SIGNING_KEY_<kid>` 格式的 env var，使用 `JWT_SIGNING_KID` 选择 active key。
  - `workers/orchestrator-core/src/auth.ts:92-103` — 同样使用 `JWT_SIGNING_KEY_<kid>` + `JWT_SECRET` legacy fallback。
- **为什么重要**：
  - E2E 测试的 shared helper 使用一套命名，worker 代码使用另一套命名。运行 E2E 测试的人需要分别在 CI/本地设置两套独立的环境变量，或者 shared helper 必须额外做一次命名转换。
  - 如果只有 shared helper 的 env var 被设置了而 worker 的 `JWT_SIGNING_KEY_<kid>` 没被设置，worker 会 fallback 到 `JWT_SECRET` legacy——这可能导致 E2E 测试"偶然通过"（因为 legacy path 恰好 work），掩盖了 kid-aware keyring 的真实行为。
- **审查判断**：
  - 这是一个 testing infrastructure 层面的不一致。不会导致逻辑错误，但增加了 E2E 测试的 setup 负担。
- **建议修法**：
  - 将 `test/shared/orchestrator-auth.mjs` 的 env var 命名对齐到 `JWT_SIGNING_KEY_<kid>` + `JWT_SIGNING_KID` 约定。E2E runner 设置 `JWT_SIGNING_KEY_v1` 和 `JWT_SIGNING_KID=v1` 即可同时满足 shared helper 和两个 worker 的需要。

---

### R5. `nano_team_api_keys` 表缺少显式 `status` 列

- **严重级别**：`low`
- **类型**：`scope-drift`
- **事实依据**：
  - `workers/orchestrator-core/migrations/001-identity-core.sql:62-70` — `nano_team_api_keys` 表仅有 `api_key_uuid / team_uuid / key_hash / label / created_at / revoked_at`，无 `status` 列。
  - `context/ddl-v170/smind-01-tenant-identity.sql` — smind 的对应表 `smind_team_api_keys` 有 `status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','rotating','revoked'))`。
  - `docs/design/zero-to-real/ZX-qna.md:118-120` — Q4 Opus 回答推荐 "Schema：建表 `nano_team_api_keys`（mirror smind 结构）"。
- **为什么重要**：
  - 当 Z1 closure 声明 "verifyApiKey 为 schema-reserved / not-supported" 时，这代表 API key 的 runtime verify 实现在未来阶段。但 "mirror smind 结构" 意味着应该复制 smind 的表结构，包括 `status` 列。缺少 `status` 列意味着未来实现 API key admin plane 时可能需要一次 migration alter，而不是直接复用已有列。
  - 当前仅靠 `revoked_at IS NULL` 判断是否有效，但无法区分 `active` / `rotating` 状态。Key rotation 是 Q4 Opus 回答中明确覆盖的能力。
- **审查判断**：
  - 这是 schema 预留不够完整的问题。Q4 Opus 推荐 "建表零成本" 的理由正是避免后续 migration alter。现在补上 `status` 列的成本为零（当前还没有 API key 数据）。
- **建议修法**：
  - 在 `001-identity-core.sql` 的 `nano_team_api_keys` 表定义中追加 `key_status TEXT NOT NULL DEFAULT 'active' CHECK(key_status IN ('active','rotating','revoked'))`。这是与 smind 结构对齐的最简修改，不需要新增 migration。

---

### R6. Contract package 的 `AuthSnapshot.tenant_source` 包含 `"deploy-fill"` 但 auth worker 永远不产生它

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `packages/orchestrator-auth-contract/src/index.ts:31` — `tenant_source: z.enum(["claim", "deploy-fill"])`。
  - `workers/orchestrator-auth/src/service.ts:95-106` — `buildSnapshot()` 硬编码 `tenant_source: "claim"`。
  - `workers/orchestrator-core/src/auth.ts:214` — `authenticateRequest()` 在 token 无 team 声明时设置 `tenant_source: "deploy-fill"`。
- **为什么重要**：
  - Contract package 声称自己是 "orchestrator-auth 的 RPC contract"——它的 schema 应该精确描述 auth worker 的输出。如果 `"deploy-fill"` 永远不会被 auth worker 返回，那它就不应该出现在 contract 中。Contract 的 `AuthSnapshot` 与 orchestrator-core 的本地 `AuthSnapshot` 之间的差异（见 R1）正是因为 contract 试图兼容一个它不产生的值。
  - 这会导致 future consumer（如 Z2 session DO）在消费 contract `AuthSnapshot` 时，需要处理一个在 auth worker output 中永远不会出现的 `"deploy-fill"` 分支——形成死代码。
- **审查判断**：
  - 这是一个 contract 混层的问题。Contract 应该只描述 "auth worker 产生什么"，而 `"deploy-fill"` 是属于 "orchestrator-core ingress 如何处理缺失的 tenant claim" 的逻辑。两者应该分离。
- **建议修法**：
  - 从 contract package 的 `AuthSnapshotSchema` 中移除 `"deploy-fill"` 枚举值，`tenant_source` 改为 `z.literal("claim")`。orchestrator-core 的本地 snapshot 构造中保留 `"deploy-fill"`（因为它确实需要这个值），但这是一个内部 ingress 细节，不应进入 contract。

---

### R7. WeChat bridge 缺少超时与重试配置

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - `workers/orchestrator-auth/src/wechat.ts:34` — `const response = await fetch(url, { method: "GET" })` — 无 `signal`、无 `retry`、无 `timeout`。
  - `workers/orchestrator-auth/src/service.ts:343` — `this.requireWeChatClient().exchangeCode(input.code)` — 一次调用，无 retry wrapper。
  - `docs/charter/plan-zero-to-real.md:478` — Z1 收口标准第 5 条仅要求 "至少跑通一次 code-level 链路"，未要求生产级 resilience。
- **为什么重要**：
  - WeChat `jscode2session` 是一个外部 HTTP API，在网络抖动或 WeChat 服务端瞬时故障时可能超时。当前实现会将任何非 ok 响应（包括网络超时）统一映射为 `invalid-wechat-code` error，用户无法区分 "code 真的无效" vs "WeChat 服务临时不可用"。
  - Charter 的 Z1 收口标准是 "至少跑通一次"，这允许 Z1 不做生产级 resilience。但 Z4 的 "Mini Program 真机 hardening" 会依赖 WeChat bridge 的稳定性——如果 Z4 发现 WeChat bridge 在真实客户端环境下频繁超时，回修 Z1 的成本更高。
- **审查判断**：
  - 非 blocker。可以在 Z1 closure 的 known limitations 中记录 "WeChat bridge 无超时/重试配置"，并在 Z4 Mini Program hardening 中统一处理。
- **建议修法**：
  - 短期：在 Z1 closure 的 "仍需诚实记录的限制" 中追加 "WeChat bridge 当前无 fetch timeout 与 retry 配置"。
  - Z4 阶段：为 `exchangeCode()` 添加 `AbortSignal.timeout(5000)` + 指数退避 retry (max 2 retries)。

---

### R8. `nano_auth_sessions` 表的 `refresh_token_hash` 唯一索引与 rotate-on-use 的 "family revocation" 存在设计空白

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/migrations/001-identity-core.sql:78-79` — `CREATE UNIQUE INDEX uq_nano_auth_sessions_refresh_hash ON nano_auth_sessions(refresh_token_hash)`。
  - `workers/orchestrator-auth/src/repository.ts:334-352` — `rotateAuthSession()` 在执行时：UPDATE 当前 session 的 `revoked_at` / `rotated_at` → 然后 INSERT 新 session（新的 `refresh_token_hash`）。
  - `workers/orchestrator-auth/src/service.ts:211-263` — `refresh()` 在发现 refresh token 后：校验未 revoke / 未 expire → 生成新 refresh token → 调用 `rotateAuthSession()`。
- **为什么重要**：
  - 当前 rotate-on-use 的行为：每次 refresh 产生新 token 并 revoke 旧 token。但如果攻击者窃取了一个 refresh token，在 legitimate user 使用它 refresh 之后，旧的 refresh token 已经被 revoke 了——攻击者再使用这个 token 会得到 `refresh-revoked`。这本身是正确的。
  - 但 "family revocation" 指的是：如果攻击者使用了已经被 revoke 的 token，系统检测到 "refresh token reuse"，应该将整个 token family（所有关联的 auth sessions）全部 revoke。这是 OWASP 推荐的 refresh token rotation 最佳实践。当前实现缺少这层检测——它只会返回 `refresh-revoked`，不会触发全 family 撤销。
  - 是否需要在 Z1 实现 family revocation？Charter 和 QnA 都没有提到。这是一个安全硬化项，不属于 zero-to-real 的 Z1 硬要求。
- **审查判断**：
  - 非 blocker。当前 rotate-on-use 已经超出 "简单永不过期 token" 的安全性基线。
- **建议修法**：
  - 在 Z1 closure 的 "known limitations" 中记录 "refresh token 未实现 family revocation（token reuse detection → 全链撤销）"。
  - 未来安全硬化阶段（如 SOC 2 准备期）再补。

---

### R9. `membership_level = 100` 作为 owner 使用 magic number，缺少常量定义

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `workers/orchestrator-auth/src/repository.ts:206` — `INSERT INTO ... membership_level ... VALUES ... 100`。
  - `workers/orchestrator-auth/src/service.ts:89` — `membership_level: context.membership_level`（透传 repository 返回的值）。
  - `workers/orchestrator-auth/test/service.test.ts:42` — `membership_level: 100`（硬编码在测试中）。
  - `workers/orchestrator-core/test/smoke.test.ts:194` — `membership_level: 100`（硬编码在测试 mock 中）。
- **为什么重要**：
  - `100` 作为 owner 的最高角色在 smind-admin 中同样使用（继承自 legacy smind 约定）。但 nano-agent 没有一处定义 `const OWNER_MEMBERSHIP_LEVEL = 100` 或等价的枚举/常量。如果未来需要 `admin = 50`、`member = 10` 等更细粒度的角色，`100` 的语义在 5 处出现点（repository 1 处 + service 1 处 + 3 test 文件）需要分别修改。
  - 这不是 Z1 的 blocker，但会在 Z2/Z3 的 session authorization 逻辑（如 `membership_level >= ADMIN_THRESHOLD` 的判断）时产生重构需求。
- **审查判断**：
  - 低优先级。contract package 是定义共享常量的最佳位置。
- **建议修法**：
  - 在 contract package 中导出 `MEMBERSHIP_OWNER = 100` 常量（或等价的 `MembershipLevel` enum）。所有引用处（repository, service, tests）统一 import。

---

### R10. 新建 worker/package 缺少 CI 配置

- **严重级别**：`low`
- **类型**：`test-gap`
- **事实依据**：
  - 通过探索全仓 CI 配置（`.github/workflows/`）——未知当前 CI 是否已覆盖新的 worker/package。
  - `workers/orchestrator-auth/package.json` 有 `"test": "vitest run"` script。
  - `packages/orchestrator-auth-contract/package.json` 有 `"test": "vitest run"` script。
  - 但若 CI 没有 glob match 到这些新目录，它们的测试不会在 CI 上运行。
- **为什么重要**：
  - Z1 新增了约 600 行测试代码（contract test + service test + auth test + smoke test 扩展 + E2E probe），如果 CI 不覆盖它们，后续 Z2-Z4 的退行性修改不会被自动捕获。
- **审查判断**：
  - CI 配置可能通过 monorepo 工具（`pnpm -r test` 或 turborepo）自动覆盖所有 workspace packages。需要确认。
- **建议修法**：
  - 确认 `pnpm -r test` 或 CI 等价命令已覆盖 `packages/orchestrator-auth-contract` 和 `workers/orchestrator-auth` 两个 workspace。若未覆盖，追加 CI 配置。

---

### R11. `orchestrator-core/src/auth.ts` 的 `AuthSnapshot` 字段 `user_uuid`、`team_uuid`、`tenant_uuid`、`membership_level` 全部为 optional——与 contract 的 required 语义冲突

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/auth.ts:20-30` — `AuthSnapshot` 接口中 `user_uuid?: string`、`team_uuid?: string`、`tenant_uuid?: string`、`membership_level?: number` 全部 optional。
  - `workers/orchestrator-core/src/auth.ts:210-219` — `authenticateRequest()` 的 snapshot 构造使用 spread operator `...(userUuid ? { user_uuid: userUuid } : {})`，当 token 不含 team claim 且无 `TEAM_UUID` deploy-fill 时，snapshot 将缺少 `team_uuid`。
  - `workers/orchestrator-auth/src/service.ts:95-106` — auth worker 的 `buildSnapshot()` 返回的 `team_uuid`、`tenant_uuid`、`membership_level` 全部 guaranteed present。
- **为什么重要**：
  - orchestrator-core 传出的 `AuthSnapshot` 可能缺少 `team_uuid`，而 Z2 session truth 的 `nano_conversation_sessions` 表按设计必须有 `team_uuid` 列（作为 tenant boundary 的主 anchor）。如果 Z2 的实现者期望从 `AuthSnapshot` 中取 guaranteed non-null 的 `team_uuid`，他们会在 legacy token（无 team claim）场景下收到 undefined。
  - 这是上一阶段（orchestration-facade）留下的设计现实：authenticateRequest 容忍无 team 的 token 以支持 backward compatibility。但在 zero-to-real 阶段，所有新的 session 都应该有 guaranteed team_uuid。Z1 已经建立了这个能力（auth worker 的 token 必然带 team_uuid），但 orchestrator-core 的 ingress 层仍保留了对旧 token 的兼容。
- **审查判断**：
  - 这属于 legacy compatibility 与 zero-to-real strictness 之间的灰色地带。如果 Z2 要求 `team_uuid` 必非 null，Z1 的 ingress 层应增加一个判定：对于新 token（token header 含 `kid` 且由 auth worker 签发），强制校验 `team_uuid` 非空；仅对 legacy token（无 `kid` 或 legacy `JWT_SECRET` 签发）保留 deploy-fill 兼容。
- **建议修法**：
  - 在 `authenticateRequest()` 中根据 token 是否含 `kid` + `source_name` 区分新 token 和 legacy token。对于新 token（`source_name === "orchestrator.auth"`），要求 `team_uuid` 非空，否则返回 `invalid-auth`。对于 legacy token，保留现有 deploy-fill 兼容行为。这是最精确的过渡方案。

---

## 3. In-Scope 逐项对齐审核

> 本节以 **charter §7.2 (Z1 In-Scope)** 为唯一基准，逐项对照实际代码交付。  
> 结论统一使用：`done | partial | missing | out-of-scope-by-design`。

| 编号 | Charter 项 | 审查结论 | 说明 |
|------|-----------|----------|------|
| S01 | 新建 `nano-agent-db` | `done` | `NANO_AGENT_DB` binding 在两个 worker 的 wrangler.jsonc 中配置完毕。 |
| S02 | 落 identity core：`nano_users` / `nano_user_profiles` / `nano_user_identities` / `nano_teams` / `nano_team_memberships` | `done` | `001-identity-core.sql` 含上述全部 5 张表 + `nano_auth_sessions` + `nano_team_api_keys`。 |
| S03 | 新建 `orchestration.auth` | `done` | `workers/orchestrator-auth/` 6 源文件 + 1 测试文件 + wrangler.jsonc。 |
| S04 | 实装完整 end-user auth flow（register/login/verify-token/refresh-token/password reset/me/tenant readback） | `done` | service.ts 覆盖全部 8 个 service method。reset 为 authenticated reset（需旧密码），me 返回 full AuthView。 |
| S05 | WeChat bridge | `done` | `wechat.ts` 真实调用 `jscode2session`。首登自动 bootstrap user+team+membership（见 R8 关于 retry 的 mini-gap）。 |
| S06 | 最小 API key verify 运行时路径 | `out-of-scope-by-design` | Q4 confirmed: schema reserved, impl deferred。contract 有 `verifyApiKey` RPC 但返回 `supported: false`。 |
| S07 | `orchestration.auth` day-1 pure internal transport | `done` | WorkerEntrypoint RPC + fetch handler 仅接受 `/` 和 `/health`。caller discipline 在 Zod level 强制 `caller: "orchestrator-core"`。 |
| S08 | public ingress → `AuthSnapshot` → `NacpAuthority` | `partial` | orchestrator-core 的 `authenticateRequest()` 仍产生本地版 `AuthSnapshot`（非 contract 版），且字段 optional（见 R1/R11）。NACP authority mapping 由 `auth.ts:221-226` 的 `InitialContextSeed` 承载，但在 Z1 阶段尚未完整进入 session DO 的 NACP enforcement（charter 将该工作列为 Z2 范围）。 |
| S09 | 双租户 / no-escalation / negative tests | `partial` | service.test.ts 覆盖了 caller discipline 负例。package-e2e probe 验证了 internal-only。但 **双租户交叉读写的负例**（user A 读 user B 的 me/team）仅在 closure 文本中提及但未找到对应的 automated test。 |

### 3.1 对齐结论

- **done**: 7
- **partial**: 2
- **missing**: 0
- **out-of-scope-by-design**: 1

> Z1 的代码交付在 charter 的 In-Scope 要求上达到了 **"核心功能全部落地，边界安全措施已建立，负例部分覆盖"** 的水平。2 处 partial 项（S08/S09）不属于 Z1 的 blocking gap（S08 的 NACP authority mapping 是 Z2 的工作，Z1 只需保证 auth token → AuthSnapshot 的转换链路通畅——这一条已满足；S09 的双租户负例可以安排在 Z2 的 session/audit 测试中，因为 Z1 尚无跨 user 的 session 操作面）。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项（charter §4.2） | 审查结论 | 说明 |
|------|-------------------------------|----------|------|
| O01 | 完整 admin plane | `遵守` | 无任何 admin/management UI 或 CRUD 全套实现。 |
| O02 | 完整 API key admin plane（list/create/revoke/UI） | `遵守` | `verifyApiKey` 返回 `supported: false`。仅 schema reserved。 |
| O03 | 所有 stream/relay/WS 一步到位全面 RPC-only | `遵守` | Z1 不涉及 stream-plane。 |
| O04 | cold archive / R2 offload | `遵守` | Z1 不涉及。 |
| O05 | full quota policy / ledger / alerts plane | `遵守` | Z1 不涉及。Z3 负责。 |
| O06 | collaboration richness 全量化 | `遵守` | Z1 不涉及。 |
| O07 | NACP 之外的新协议家族扩张 | `遵守` | Z1 的 auth flow 使用标准 JWT + opaque refresh token，不引入新协议。 |
| O08 | tenant-facing admin UI | `遵守` | 无 UI 产出。 |
| O09 | platform-level observability dashboard / metrics / ops plane | `遵守` | 仅 worker probe endpoint（`/health`），无 dashboard。 |

> **Out-of-Scope 核查结论：全部遵守。** Z1 在 scope 边界管理上表现优秀。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`Z0-Z1 阶段的工作产出在架构正确性、工程纪律和安全边界上主体成立。typed contract + internal-only WorkerEntrypoint RPC auth worker + kid-aware JWT keyring + WeChat bridge + D1 identity schema + caller discipline + rotate-on-use refresh 构成了一条完整的、可被 Z2 直接消费的真实 auth baseline。存在 2 处建议在 Z2 启动前修正的类型归属问题（R1/R11），以及 9 处可后续跟进的精度/命名/安全/测试改进项。`

- **是否允许关闭本轮 review**：`no`（等待 R1 与 R11 修正后进行二次审查）

- **关闭前必须完成的 blocker**：
  1. **修正 R1（AuthSnapshot 重复定义）**：选择方案 A（收束到 contract package）或方案 B（分离命名），消除 orchestrator-core 与 contract package 之间的同名异义类型。推荐方案 A（收束）：从 contract 导入 `AuthSnapshot`，在 `authenticateRequest()` 中确保 legacy token 的 deploy-fill 场景也产生符合 contract shape 的 snapshot（即 team_uuid/tenant_uuid/membership_level 必须有 fallback 值而非 undefined）。
  2. **修正 R11（AuthSnapshot 字段 optional 语义）**：在新 token（`source_name === "orchestrator.auth"`）的判断路径中强制 `team_uuid` 非空。这是 Z2 session truth 要求 `team_uuid` non-nullable 的前置条件。
  3. **产出 cross-phase 命名对照表**（R2）：在 `Z0-closure.md` 或独立文件中明确文档术语 (`orchestration.core`) 与代码命名 (`orchestrator-core`) 的对照关系，避免 Z2-Z4 实现者持续在两个命名空间之间跳跃。

- **可以后续跟进的 non-blocking follow-up**：
  1. **R3（identity_status 过滤）**：在 `findIdentityBySubject()` SQL 中追加 `AND identity_status = 'active'`。
  2. **R4（shared helper env var 对齐）**：将 `test/shared/orchestrator-auth.mjs` 的 env var 命名对齐到 `JWT_SIGNING_KEY_<kid>` 约定。
  3. **R5（nano_team_api_keys 加 status 列）**：在 `001-identity-core.sql` 中追加 `key_status` 列。
  4. **R6（contract tenant_source 移除 deploy-fill）**：从 contract 中移除 auth worker 永远不会产生的枚举值。
  5. **R7（WeChat retry/timeout）**：在 Z1 closure 的 known limitations 中记录，Z4 阶段统一处理。
  6. **R8（security: family revocation）**：在 Z1 closure 的 known limitations 中记录，未来安全硬化阶段处理。
  7. **R9（membership_level 常量）**：在 contract package 中导出 `MEMBERSHIP_OWNER = 100` 常量。
  8. **R10（CI 覆盖确认）**：确认 `pnpm -r test` 已覆盖新 workspace。

> 本轮 review 不收口。等待实现者按 §5 的 3 个 blocker 修正后，再进行二次审查。9 条 non-blocking follow-up 可在二次审查前后分别处理，不阻塞 Z2 启动。

---

## 6. 对 DeepSeek 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-25`
> 评价依据: `docs/code-review/zero-to-real/Z0-Z1-reviewed-by-deepseek.md §1-§5` + 当前代码事实 + 本轮已落实修复

### 6.1 一句话评价评审风格

DeepSeek 的这份审查风格偏 **类型/契约一致性导向**，对 contract purity、schema 预留强度和 worker/helper 口径漂移很敏感，命中了一批真实问题，但对运行时 blocker 与阶段边界的优先级区分略弱。

### 6.2 优点

1. 很早抓到了 `AuthSnapshot` 双重语义、`deploy-fill` 泄漏、required/optional 冲突这组真正会污染 Z2 的类型问题。
2. 对 helper env 命名、CI trigger、magic number、API key reserved schema 这类“容易被忽略但后面会长债”的问题很敏感。
3. 审查证据链基本完整，建议修法普遍可执行，不是空泛地提“应该更安全”。

### 6.3 缺点

1. 没有抓到本轮最硬的运行时 blocker：D1 伪事务、`invalid-caller` 死代码、query-token 反模式。
2. 若干问题更像 contract cleanliness / future-hardening，而不是当下 Z1 的直接 blocker，优先级层次感稍弱。
3. R1 与 R11 高度重叠，存在一定重复计数。

### 6.4 对审查报告中，全部问题，的清点

| 问题编号 | 原始严重程度 | 该问题的质量 | 分析与说明 |
|----|------|------|------------------|
| R1 | `high` | `高` | 命中了真实的 contract/local snapshot 分叉，是这份报告里最有价值的一条。 |
| R2 | `medium` | `中` | 术语断层确实存在，后来也通过 rename + mapping 修正，但它更偏 docs-gap，不算 Z1 blocker。 |
| R3 | `medium` | `高` | 身份状态过滤缺失是真问题，且修法明确。 |
| R4 | `low` | `高` | shared helper env drift 真实存在，影响测试体验与 key naming 一致性。 |
| R5 | `low` | `高` | API key reserved schema 偏弱是有效发现，后来也直接补到了 migration。 |
| R6 | `low` | `高` | contract 中保留 auth worker 永不产出的 `deploy-fill`，属于非常准确的契约洁净度问题。 |
| R7 | `medium` | `高` | WeChat timeout/retry 是实际韧性缺口，修法也低风险。 |
| R8 | `medium` | `中` | family revocation 是合理的安全 follow-up，但超出 Z1 已冻结 scope，作为 blocker 过重。 |
| R9 | `low` | `高` | magic number 问题真实且便宜，价值高。 |
| R10 | `medium` | `高` | CI 覆盖缺口真实存在。 |
| R11 | `medium` | `中` | 与 R1 属于同一根问题的另一种表述，事实没错，但重复度较高。 |

### 6.5 评分 - 总体 ** 8.2 / 10 **

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 8 | 大部分问题都能落到具体文件与字段。 |
| 判断严谨性 | 8 | 多数判断成立，但 blocker 优先级不如 Opus 准。 |
| 修法建议可执行性 | 8 | 建议普遍可直接落地。 |
| 对 action-plan / design 的忠实度 | 8 | 能持续把问题拉回 contract/design truth。 |
| 协作友好度 | 8 | 语气克制，问题描述清楚。 |
| 找到问题的覆盖面 | 9 | 类型、schema、helper、CI、韧性都有覆盖。 |
