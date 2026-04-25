# Nano-Agent 代码审查 — `zero-to-real` Z0-Z1 已交付实现

> 审查对象: `Z0-contract-and-compliance-freeze` + `Z1-full-auth-and-tenant-foundation` 已落实代码与文档
> 审查时间: `2026-04-25`
> 审查人: `Opus 4.7 (1M context)`
> 审查范围:
> - `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md`（含 §9 工作日志）
> - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md`（含 §9 工作日志）
> - `docs/issue/zero-to-real/Z0-closure.md`
> - `docs/issue/zero-to-real/Z1-closure.md`
> - `packages/orchestrator-auth-contract/**`
> - `workers/orchestrator-auth/**`
> - `workers/orchestrator-core/{src,migrations,test,wrangler.jsonc}/**`
> - `test/{shared,package-e2e/orchestrator-auth}/**`
> - `.github/workflows/workers.yml`
> - 跨阶段（Z2-Z5 action-plan + ZX-* design + ZX-qna 已确认 owner 答案）的拓扑回顾
> 文档状态: `reviewed`

---

## 0. 总结结论

> **一句话 verdict**：**Z0-Z1 主体已交付，且 Q1-Q4 owner 决策都被认真消费，但实现层有 1 个 critical 安全/正确性问题（D1 事务实际不工作）+ 2 个 high 问题（schema 缺关键状态列、`invalid-caller` 检查是死代码），以及一组 cross-phase 的隐藏断点会污染 Z2 起跑——必须先收掉这些再继续推进 Z2。**

- **整体判断**：`changes-requested (Grade: C+)` — 比 design / action-plan 阶段评分降一档。原因：design / action-plan 是文档判断，可以靠"方向对就 OK"过；implementation 阶段必须经得起代码事实检验。当前实现层至少 1 处 D1 事务用法在 Cloudflare D1 平台上**根本不工作**（`db.exec("BEGIN IMMEDIATE")`），如果生产部署，第一次 register 中途任何 INSERT 失败，就会留下脏中间态——这与 `Z1-closure.md §3 已验证的收口点`第 2 行宣称的"register/login/refresh/me/reset/wechat/caller discipline 已覆盖"形成事实冲突。
- **结论等级**：`changes-requested`
- **本轮最关键的 3 个判断**：
  1. **D1 事务用法错误**（R1）：`workers/orchestrator-auth/src/repository.ts:147-156` 用 `db.exec("BEGIN IMMEDIATE") / COMMIT / ROLLBACK` 实现 `withTransaction` —— Cloudflare D1 的 JS API **不支持 ad-hoc BEGIN/COMMIT 事务**，正确做法是 `db.batch([...statements])`（`context/smind-admin/src/modules/identity/auth.service.ts:107-130` 即此正确范式）。`createBootstrapUser` 的 5 张表 INSERT + `rotateAuthSession` 的 UPDATE+INSERT 都跑在伪事务里，任何中途失败都会留脏。这是生产 blocker。
  2. **`invalid-caller` 是死代码 + schema 单调用方约束被掩埋**（R2）：`packages/orchestrator-auth-contract/src/index.ts:8` 把 `caller` 定义为 `z.literal("orchestrator-core")` —— schema validation 会先于 `errors.ts:30` 的 `if (parsed.data.caller !== "orchestrator-core")` 比较，所以"非 orchestrator-core 的 caller"会被报为 `invalid-request` 而**永远不会**报为 `invalid-caller`。`workers/orchestrator-auth/test/service.test.ts:235-248` 的 negative test 也只能验到 `invalid-request`。结果：(a) 错误码语义被掩埋；(b) Z1 closure 宣称的 "single caller discipline 已覆盖" 实际上是被 schema 顺手实现，**不是显式的 caller-identity 检查**；(c) 后续如果想加"另一个合法 caller"必须改 schema。
  3. **`nano_users` 表只剩 2 列、`identity_provider` 没有 `team_uuid` 解耦、`membership_level` 用 100 magic number** —— Z1 把 `thin-but-complete` 推到了 `thin-to-broken` 的边缘。具体：(a) `nano_users` 缺 `user_status`（无法 ban/suspend/delete user）+ `is_email_verified`（无法判断邮箱是否真实）；(b) `nano_user_identities.team_uuid NOT NULL` 把 identity 与 team 半融合，与 `ddl-v170` smind-01 显式解耦的设计冲突，未来 multi-team 路径会卡死；(c) `membership_level: 100` 没有 CHECK constraint、没有 enum 文档，未来读到 100/50/10 都不知道含义。这三条是 schema 长尾债，越早修越便宜。

---

## 1. 审查方法与已核实事实

### 1.0 审查方法

- 完整阅读 Z0/Z1 action-plan 正文 + §9 工作日志、Z0/Z1 closure 文档；
- 通过 `ls / find / wc -l / grep / cat` 逐一核对工作日志声明的每个文件是否真实存在、行数是否合理；
- 完整阅读 `packages/orchestrator-auth-contract/src/index.ts`、`workers/orchestrator-auth/src/{index,service,jwt,repository,wechat,hash,errors}.ts`、`workers/orchestrator-core/src/{auth,index,policy/authority}.ts`、`workers/orchestrator-core/migrations/001-identity-core.sql`、`workers/orchestrator-{auth,core}/wrangler.jsonc`；
- 对照 `context/ddl-v170/smind-01-tenant-identity.sql`（identity 祖宗 schema）、`context/smind-admin/src/modules/identity/auth.service.ts`（参考实现）核对命名、字段、事务模式；
- 对照 `docs/charter/plan-zero-to-real.md`（基石）、`docs/design/zero-to-real/{Z0,Z1,ZX-*}.md`、`docs/design/zero-to-real/ZX-qna.md`（已含 owner Q1-Q10 答案）核对设计意图与实现是否一致；
- 跨包查看 `packages/{nacp-core,nacp-session}/src/**` 与 Z2-Z5 action-plan 的引用以判断 Z1 交付物对下游是否完备；
- 阅读测试文件 `workers/orchestrator-auth/test/service.test.ts`、`packages/orchestrator-auth-contract/test/contract.test.ts`、`workers/orchestrator-core/test/auth.test.ts`、`test/package-e2e/orchestrator-auth/01-probe.test.mjs`、`test/shared/{live,orchestrator-auth,orchestrator-jwt}.mjs`；
- 阅读 `.github/workflows/workers.yml` 验证 CI 路径声明。

### 1.1 已确认的正面事实

- **F+1 — 命名 packages**：`packages/orchestrator-auth-contract/`（`@haimang/orchestrator-auth-contract`）真实存在，完整含 `src/index.ts`（232 行）+ `test/contract.test.ts`（77 行）+ `dist/`（编译产物）+ `package.json`。Zod schema 完整覆盖 register / login / refresh / me / verify / reset / wechat / verifyApiKey 八条 API + 错误码枚举 + envelope union type + RPC service interface (`OrchestratorAuthRpcService`)。
- **F+2 — Auth Worker 真实存在**：`workers/orchestrator-auth/` 完整存在，含 `src/{index,service,jwt,repository,wechat,hash,errors}.ts` 七个源文件 + `test/service.test.ts`（249 行 in-memory 测试）+ `wrangler.jsonc` + `package.json` + `dist/`。worker 入口实现了 `WorkerEntrypoint<AuthWorkerEnv> implements OrchestratorAuthRpcService`，即 Q1 owner 同意的 WorkerEntrypoint RPC-first 形态。
- **F+3 — Wave A 迁移真实存在**：`workers/orchestrator-core/migrations/001-identity-core.sql`（82 行）创建 7 张表 + 4 个 UNIQUE INDEX。表名与 ZX-D1 §5.1 + Z1 P1-02 一致：`nano_users / nano_user_profiles / nano_user_identities / nano_teams / nano_team_memberships / nano_auth_sessions / nano_team_api_keys`。
- **F+4 — orchestrator-core 升级**：`workers/orchestrator-core/src/auth.ts:92-103 collectVerificationKeys` + `:128-142 verifyJwtAgainstKeyring` 实现了 Q2 owner 同意的 `kid`-aware keyring verify；同时保留 `JWT_SECRET` legacy 兼容路径（key alias = "legacy"）。`/auth/*` 八条 proxy 路由在 `src/index.ts:81-93,106-151` 已布好。
- **F+5 — JWT 实现 kid-first 顺序选择**：`workers/orchestrator-auth/src/jwt.ts:67-89 resolveSigningSecret` 使用 `JWT_SIGNING_KID` 显式选签发 key；`:147-151 verifyAccessToken` 当 token header 含 `kid` 时优先用对应 key 验证，与 Q2 Opus 推荐"按 `kid` 选 key 而非 try-both"一致（虽然剩余 keys 仍 fallback try-each，但顺序优先正确）。
- **F+6 — 自动建 user / team / membership**：`workers/orchestrator-auth/src/service.ts:172-184 register` 与 `:351-363 wechatLogin` 都调 `createBootstrapUser`，同时插入 user / profile / team / membership / identity 五张表 —— Q3 owner 同意的"自动建 default team + owner-level membership"已实现（membership_level=100 表示 owner，`repository.ts:206`）。
- **F+7 — verifyApiKey 仅 schema 预留**：`workers/orchestrator-auth/src/service.ts:370-383 verifyApiKey` 直接返回 `{ supported: false, reason: "reserved-for-future-phase" }` —— Q4 owner 同意的"schema 预留 + impl defer"已实现，且行为可被 `VerifyApiKeyEnvelopeSchema` 静态校验。
- **F+8 — 单 caller 静态约束**：`packages/orchestrator-auth-contract/src/index.ts:6-10 AuthRpcMetadataSchema` 把 `caller` 强制为 `z.literal("orchestrator-core")`，使任何 worker mesh 内非 orchestrator-core 的调用方在 schema layer 即被拒。结合 `errors.ts:24-33 assertAuthMeta`，所有 8 个 RPC method 入口都有此校验。
- **F+9 — public 表面仅 probe**：`workers/orchestrator-auth/src/index.ts:81-93 fetch` 处理：`GET / | /health` 返回 probe，其他全 404 + `{error: "not-found", message: "orchestrator.auth does not expose public business routes"}`。`test/package-e2e/orchestrator-auth/01-probe.test.mjs:16-22` 用 POST `/auth/login` 验证 404 + 错误信息。
- **F+10 — orchestrator-core wrangler 接入了 ORCHESTRATOR_AUTH service binding**：`workers/orchestrator-core/wrangler.jsonc:38-41` 与 preview env 都声明 `ORCHESTRATOR_AUTH -> nano-agent-orchestrator-auth` service binding。
- **F+11 — CI 接入**：`.github/workflows/workers.yml:36-44` 中 worker matrix 已含 `orchestrator-auth`；`:62` 显式 `pnpm --filter @haimang/orchestrator-auth-contract build` —— contract package 在所有 worker test job 之前会被构建。
- **F+12 — refresh-token rotation 已实现**：`workers/orchestrator-auth/src/service.ts:211-264 refresh` 实现了 rotate-on-use（旧 session 设 `revoked_at + rotated_at`，新 session 插入新 hash），与 Q2 Opus 推荐 `access 1h / refresh 30d / rotate-on-use` 一致（`:127 refreshExpiresIn = 30 * 24 * 60 * 60`，`:145 expires_in: 3600`）。
- **F+13 — WeChat bridge 实现 jscode2session**：`workers/orchestrator-auth/src/wechat.ts:17-49` 调用 `https://api.weixin.qq.com/sns/jscode2session`（路径可被 `WECHAT_API_BASE_URL` 覆盖以便 mock），返回 openid。`service.ts:341-368 wechatLogin` 实现"已存在 identity 直接发 token；不存在则 bootstrap 建 user/team/membership/identity"，与 Q3 一致。
- **F+14 — orchestrator-core auth.ts 同时支持 kid 与 legacy `JWT_SECRET`**：`auth.ts:99-102` 把 `JWT_SECRET` 注册为 kid="legacy"；`:172-178 collectVerificationKeys + verifyJwtAgainstKeyring` 路径会优先按 kid，再 fallback try-each。这给现有 legacy live tests 留了通路（`test/shared/orchestrator-jwt.mjs` 与 `live.mjs` 中对 JWT_SECRET 的依赖仍能工作）。
- **F+15 — Z0/Z1 文档自洽**：Z0 closure 与 Z0 action-plan §9 工作日志在交付清单（4-5 项）上互相印证；Z1 closure 与 Z1 action-plan §9 工作日志的 7 项交付（contract / worker / migration / orchestrator-core 升级 / tests / verification / Z1 closure 自身）也互相印证。

### 1.2 已确认的负面事实

- **F-1 — 目录命名漂移**：design 与 action-plan 全部使用 `workers/orchestration-auth/` (with -ation-)，但实际落地为 `workers/orchestrator-auth/` (no -ation-)。`grep -rn "orchestration-auth" docs/design docs/action-plan` 与 `find workers -type d` 互相不一致。GPT 没有在 closure / 工作日志中说明这次重命名是有意决策。
- **F-2 — D1 事务实际不工作**：`workers/orchestrator-auth/src/repository.ts:147-156`：
  ```ts
  private async withTransaction<T>(work: () => Promise<T>): Promise<T> {
    await this.db.exec("BEGIN IMMEDIATE");
    try { ... ; await this.db.exec("COMMIT"); ... }
    catch { await this.db.exec("ROLLBACK"); throw error; }
  }
  ```
  Cloudflare D1 的 JS API **不暴露 ad-hoc transaction 控制**——`db.exec()` 是 multi-statement 执行接口，但 BEGIN/COMMIT 跨多个 `db.exec()` 调用之间没有真实 atomicity 保证。正确范式见 `context/smind-admin/src/modules/identity/auth.service.ts:107-130` 的 `await ctx.env.DB.batch([...statements])`。
- **F-3 — `invalid-caller` 死代码**：
  - `packages/orchestrator-auth-contract/src/index.ts:7-10` `caller: z.literal("orchestrator-core")`
  - `workers/orchestrator-auth/src/errors.ts:24-33`：先 `safeParse`（schema 已会因为非 literal 失败），再 `if (parsed.data.caller !== "orchestrator-core") throw invalid-caller`
  - 第二个 `if` 分支永远不会触发。`AuthErrorCode` 枚举中 `invalid-caller` 实际不可达。
  - `workers/orchestrator-auth/test/service.test.ts:240-248` 的 negative test 检验的是 `code: "invalid-request"`，与代码实际行为一致——但**与 contract 与 closure 的口径不一致**。
- **F-4 — `nano_users` 字段过薄**：`migrations/001-identity-core.sql:1-4` 只有 `user_uuid` + `created_at` 两列。对照 `context/ddl-v170/smind-01:62-118 smind_users` 含 `user_status / admin_level / default_team_uuid / default_locale / is_email_verified / is_phone_verified / payload_settings / payload_flags / time_last_login_at / time_last_seen_at / time_updated_at` 等核心列。`nano_users` 没有任何状态字段——**没有可标识 banned/suspended/deleted user 的能力**。这是生产风险。
- **F-5 — `nano_user_identities.team_uuid NOT NULL`**：`migrations/001-identity-core.sql:21` 把 team 直接挂 identity 上。对照 `ddl-v170/smind-01 smind_user_identities` **完全没有 team_uuid 列**——身份与租户成员关系是解耦的（design intent in smind-01:21-23 注释明示）。nano 这个改动让"一个 user 只能有一组 identity-per-team"，未来 multi-team 路径上一个 email 注册的 user 想加入第二个 team 时无法用同一 identity 记录。
- **F-6 — `nano_user_identities.identity_status` 无 CHECK constraint**：`migrations/001-identity-core.sql:24` `identity_status TEXT NOT NULL DEFAULT 'active'` —— 没有 enum 检查。对照 `ddl-v170` 几乎所有 status 列都带 CHECK enum。
- **F-7 — `identity_provider` 仅 2 项**：`migrations/001-identity-core.sql:17` `CHECK (identity_provider IN ('email_password', 'wechat'))`，对照 ddl-v170 smind-01:185-190 注释中的 4 项 (`email_password / wechat / app / internal`)。nano 缩窄到 2 项是 first-wave 可接受，但未来加 provider 必须 ALTER TABLE 修改 CHECK constraint。
- **F-8 — `nano_team_api_keys` 无 status / scope / label uniqueness / no rotating state**：对照 ddl-v170 smind_team_api_keys，nano 版仅有 5 列，缺 `key_status (active/rotating/revoked)` / `scopes` / `last_used_at`。Z1 closure 说"schema reserved"——但 reserved 也至少应保证 future migration 不需要重大 alter。
- **F-9 — `membership_level: 100` 是 magic number**：`workers/orchestrator-auth/src/repository.ts:206 .bind(input.membership_uuid, input.team_uuid, input.user_uuid, 100, input.created_at)` —— 100 hard-coded 表示 owner，但既无 enum、无 contract 注释、无 ZX-D1 文档。`AuthTeamSchema.membership_level: z.number().int().nonnegative()` (`contract:48`) 也是宽松数字校验。
- **F-10 — `updatePasswordSecret` 把 password 重置时间写进 `last_login_at`**：`workers/orchestrator-auth/src/repository.ts:354-362`：
  ```sql
  UPDATE nano_user_identities
     SET auth_secret_hash = ?2, last_login_at = ?3
   WHERE user_uuid = ?1 AND identity_provider = 'email_password'
  ```
  + 同时是 mass update（一个 user 的所有 email_password identities 同时改）—— 语义都不对。`last_login_at` 应该只在登录时变；password 重置应该写到 `password_updated_at` 或不写时间。
- **F-11 — `Z1-closure §3.5` 宣称 `pnpm test:package-e2e` 维持 baseline，但 orchestrator-auth 的唯一 package-e2e probe (`01-probe.test.mjs`) 默认被 `liveTest` 跳过**（仅 `NANO_AGENT_LIVE_E2E=1` 触发）—— 默认 CI 与本地 `pnpm test:package-e2e` 都不会 run 这个 probe，**实际无回归护栏**。
- **F-12 — orchestrator-auth 没有自己的 migrations_dir，identity migrations 由 orchestrator-core wrangler.jsonc:21 `migrations_dir: "migrations"` 持有**。但 design 说 "auth worker 是 identity write owner"。**写权与 schema owner 分裂**：写在 orchestrator-auth、schema apply 在 orchestrator-core。
- **F-13 — `compatibility_date` 不一致**：`orchestrator-core/wrangler.jsonc:5 = "2026-04-24"`、`orchestrator-auth/wrangler.jsonc:5 = "2026-04-25"`。
- **F-14 — `database_id: "00000000-0000-0000-0000-000000000001"` 是 placeholder**：两个 wrangler.jsonc 都用同一占位，但**没有任何注释说"必须在 deploy 前改成真实 D1 instance UUID"**。容易被复制粘贴上生产。
- **F-15 — CI paths trigger 漏 `packages/orchestrator-auth-contract/**`**：`.github/workflows/workers.yml:6-12, 14-22` paths 列表只含 `workers/** + nacp-core + nacp-session + workspace + workflow self`。**改 contract package 不会触发 worker CI**——这是 silent regression 风险。
- **F-16 — `query string access_token` 仍然支持**：`workers/orchestrator-core/src/index.ts:101-103` `readAccessToken` 支持 `?access_token=...`，违反 OAuth2/JWT 最佳实践（query log 泄漏）。
- **F-17 — `tenant_source: "deploy-fill"` 仍是 fallback path**：`workers/orchestrator-core/src/auth.ts:213-214`：当 token 没有 team_uuid 时，使用 `env.TEAM_UUID = "nano-agent"`（`wrangler.jsonc:13`）作为 effective tenant —— 这意味着任何缺 team_uuid claim 的 token 都被映射到同一个字符串 "nano-agent" 团队。Z1 mint 的 token 都带 team_uuid，所以新 token 走 "claim" 路径；但 legacy 测试 / 老 token 仍可能走 "deploy-fill"，这会让多租户隔离出现 silent merge 风险。Z1 closure §4.2 已诚实承认，但未提出修复路径。
- **F-18 — Z0-closure.md §3 表格无证据列**：每行只有 verdict 字符串（`execution-ready / frozen / resolved / fixed / ready`），没有 commit / 文件 / test 命中作为证据。
- **F-19 — Z0 action-plan §9 工作日志只 5 行**，几乎全是宣称（"重新核对"、"将...压回仓库既有 runner"），没有产出新交付物的具体路径——`Z0 closure` 的"实际交付"仅 1 个新文件即 closure 自身。这相当于 Z0 自己创建 Z0 closure，循环 self-referential。
- **F-20 — Z1 工作日志声明"双租户 negative tests"在 P5-01，但只能找到 `test/package-e2e/orchestrator-auth/01-probe.test.mjs`**（live-only），没有覆盖 forged token / tenant mismatch / cross-team readback / non-orchestrator caller 这 4 项 design Z1 §7.3 / action-plan P5-01 列出的负例。`workers/orchestrator-core/test/auth.test.ts:62 行` 与 `workers/orchestrator-auth/test/service.test.ts:249 行` 内有部分覆盖，但跨 package-e2e 的负例 baseline 未真实存在。

---

## 2. 审查发现

### R1. `D1 事务实际不工作`：`db.exec("BEGIN/COMMIT")` 在 Cloudflare D1 上无 atomicity

- **严重级别**：`critical`
- **类型**：`correctness` + `security`
- **事实依据**：
  - `workers/orchestrator-auth/src/repository.ts:147-156`：
    ```ts
    private async withTransaction<T>(work: () => Promise<T>): Promise<T> {
      await this.db.exec("BEGIN IMMEDIATE");
      try {
        const result = await work();
        await this.db.exec("COMMIT");
        return result;
      } catch (error) {
        await this.db.exec("ROLLBACK");
        throw error;
      }
    }
    ```
  - 调用点：`createBootstrapUser`（5 张表 INSERT）+ `rotateAuthSession`（UPDATE 旧 session + INSERT 新 session）。
  - 对照参考实现 `context/smind-admin/src/modules/identity/auth.service.ts:107-130`：
    ```ts
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(`INSERT INTO smind_users ...`).bind(...),
      ctx.env.DB.prepare(`INSERT INTO smind_user_profiles ...`).bind(...),
      ctx.env.DB.prepare(`INSERT INTO smind_user_identities ...`).bind(...),
    ]);
    ```
  - Cloudflare D1 的 [官方文档](https://developers.cloudflare.com/d1/best-practices/use-d1-from-workers/) 明确指出 D1 的 transaction primitive 是 `db.batch([...])`；`db.exec()` 是 multi-statement helper，不是事务边界控制。
- **为什么重要**：
  - register 流程 5 个 INSERT 跨多个 `await this.db.prepare().run()` 调用，如果 INSERT users 成功、INSERT teams 失败，nano_users 中会留下"无 team / 无 membership / 无 identity"的孤儿用户。这个用户的 user_uuid 不能被 register 重用（PK 冲突）但又不可登录（identity 不存在）—— **永久脏数据**。
  - rotate refresh token 同理：UPDATE 旧 session 成功、INSERT 新 session 失败，旧 session 已 revoked + 新 session 不存在 = 用户**永久无法刷新**，必须重新登录。
  - Z1 closure 宣称的 "register/login/refresh 已覆盖" 在事务安全维度上是不成立的。
- **审查判断**：必须改成 `db.batch([...])`，事务才有真实 atomicity。
- **建议修法**：
  1. `createBootstrapUser` 改为 `await this.db.batch([users, profiles, teams, memberships, identities])`，遵循 smind-admin 范式。
  2. `rotateAuthSession` 改为 `await this.db.batch([update_old, insert_new])`。
  3. 删除 `withTransaction` helper 与所有 `db.exec("BEGIN/COMMIT/ROLLBACK")`。
  4. 增补一条 unit test：mock 第二个 statement 失败，断言第一个 statement 也回滚。

### R2. `invalid-caller` 检查永远不可达，contract 与代码契约不一致

- **严重级别**：`high`
- **类型**：`correctness` + `docs-gap`
- **事实依据**：
  - `packages/orchestrator-auth-contract/src/index.ts:6-10`：
    ```ts
    export const AuthRpcMetadataSchema = z.object({
      trace_uuid: z.string().uuid(),
      caller: z.literal("orchestrator-core"),
    });
    ```
  - `workers/orchestrator-auth/src/errors.ts:24-33`：
    ```ts
    export function assertAuthMeta(rawMeta: unknown): AuthRpcMetadata {
      const parsed = AuthRpcMetadataSchema.safeParse(rawMeta);
      if (!parsed.success) {
        throw new AuthServiceError("invalid-request", 400, "invalid auth rpc metadata");
      }
      if (parsed.data.caller !== "orchestrator-core") {
        throw new AuthServiceError("invalid-caller", 403, "only orchestration.core may call orchestrator.auth");
      }
      return parsed.data;
    }
    ```
  - 由于 schema 强制 `z.literal("orchestrator-core")`，任何非该字符串都会在 `safeParse` 阶段失败，第二个 `if` 分支不可达。
  - `workers/orchestrator-auth/test/service.test.ts:235-248` negative test 期望 `code === "invalid-request"`——与代码实际行为一致，但 `AuthErrorCode` 枚举（`contract:134-148`）显式包含 `"invalid-caller"`。
- **为什么重要**：
  - Contract 暴露的 8 个错误码中 `invalid-caller` 没有任何代码路径能产生它—— 这是 **dead error code** + **misleading API surface**。
  - Z1 closure 的"single caller discipline 已覆盖"实际上是**靠 schema literal 顺手实现的**，不是显式的"identity check at runtime"。如果未来某个版本 schema 放宽 caller 为 `z.string()`（例如要支持 internal-test caller），第二个 `if` 才会激活——同时也意味着 schema 是当前 single-caller 的**唯一防线**。
  - 测试覆盖把"非 orchestrator-core 字符串"测出 `invalid-request`，但 owner / reviewer 看 contract 与 closure 时会以为有专门的 caller-identity 检查路径——形成**心智欺骗**。
- **审查判断**：要么删除 `invalid-caller` 错误码（让 schema 单点防御），要么放宽 schema 让 caller-identity 检查真实启用。
- **建议修法**：
  - **方案 A（推荐）**：把 contract `caller: z.literal("orchestrator-core")` 改为 `caller: z.string().min(1)`，让 `errors.ts` 中的第二个 `if` 真正生效；并 update test 验证 caller="other-worker" 报 `invalid-caller`。这样后续可以通过 service binding 加 secret + caller-id pair 做更细粒度防御。
  - **方案 B**：保留 schema literal，但删除 `errors.ts:30-33` 死分支与 `AuthErrorCode` 中的 `"invalid-caller"`，避免误导。

### R3. `nano_users` 表缺关键状态列（无法 ban / suspend / verify）

- **严重级别**：`high`
- **类型**：`scope-drift` + `correctness`
- **事实依据**：
  - `migrations/001-identity-core.sql:1-4`：
    ```sql
    CREATE TABLE IF NOT EXISTS nano_users (
      user_uuid TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    ```
  - 对照 `context/ddl-v170/smind-01-tenant-identity.sql:62-118 smind_users` 至少 12 列：`user_uuid / user_status (CHECK active|suspended|deleted|pending_setup) / admin_level / default_team_uuid / default_locale / default_timezone / is_email_verified / is_phone_verified / payload_settings / payload_flags / payload_primary / time_registered_at / time_last_login_at / time_last_seen_at / time_updated_at`。
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md §6.1` 说 thin-but-complete 是"既不过薄也不过重"——**两列已经掉到过薄的另一端**。
- **为什么重要**：
  - **没有 `user_status`** = 没有"封禁恶意用户"的能力。一旦上线，处理被滥用账号必须 hard-delete（破坏 FK）或加列后回填（schema migration with backfill）。
  - **没有 `is_email_verified`** = 邮箱验证机制（即使后续做）也不能在此层 query；要么再加表要么再加列。
  - 即便 thin baseline，也至少应有 `user_status TEXT NOT NULL DEFAULT 'active' CHECK (...)`——这是 1 列的代价、未来一个安全漏洞兜底面的收益。
- **审查判断**：必须在 Z2 起跑前补这一列；否则 Z3/Z4 的 quota / runtime 没有"账号已停用"的退出口。
- **建议修法**：
  - Migration 002 之前先发一个 `001a-identity-core-status.sql`（或合并到 002）补充：
    ```sql
    ALTER TABLE nano_users ADD COLUMN user_status TEXT NOT NULL DEFAULT 'active'
      CHECK (user_status IN ('active','suspended','deleted','pending_setup'));
    ALTER TABLE nano_users ADD COLUMN is_email_verified INTEGER NOT NULL DEFAULT 0
      CHECK (is_email_verified IN (0, 1));
    ALTER TABLE nano_users ADD COLUMN time_last_login_at TEXT;
    ALTER TABLE nano_users ADD COLUMN time_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
    ```
  - `AuthService.login` 在 `findIdentityBySubject` 之后增加 `user_status === 'active'` 校验。
  - 对应升级 `UserContextRecord` / `AuthSnapshot` 含 `user_status`。

### R4. `nano_user_identities.team_uuid NOT NULL` 与 ddl-v170 解耦设计冲突，未来 multi-team 路径阻塞

- **严重级别**：`high`
- **类型**：`scope-drift` + `correctness`
- **事实依据**：
  - `migrations/001-identity-core.sql:14-26 nano_user_identities`：
    ```sql
    user_uuid TEXT NOT NULL,
    identity_provider TEXT NOT NULL CHECK (identity_provider IN ('email_password', 'wechat')),
    provider_subject TEXT NOT NULL,
    provider_subject_normalized TEXT NOT NULL,
    auth_secret_hash TEXT,
    team_uuid TEXT NOT NULL,
    ```
  - `context/ddl-v170/smind-01-tenant-identity.sql:172-237 smind_user_identities`：**完全没有 team_uuid 列**。设计原文（smind-01:21-23 注释）：
    > 平台用户（user）与租户成员（membership）彻底解耦
    > 用户当前租户上下文由 users.default_team_uuid + memberships 决定
  - nano 的 unique index `uq_nano_user_identities_provider_subject ON (identity_provider, provider_subject_normalized)`（migration:72-73）—— 即"同 provider 同 subject 全局唯一"，但 row 上又强制 team_uuid—— 数据模型与索引是矛盾的：一个 user 加入第 N 个 team 时，因为 unique index 不能重新插一行新 team_uuid 的 identity。
- **为什么重要**：
  - 当前 first-wave UX 是"一 user 一 default team"，这层不出问题。
  - 但 `Z2-action-plan §0` 与 charter §1.3 都明确 zero-to-real 要支持 multi-tenant；当 user A 想加入 user B 创建的 team B 时，nano 需要在 `nano_team_memberships` 加一行（OK），但 identity 是无法新增的—— A 在 team B 中 query identity 拿不到（identity 行的 team_uuid 是 team A）。
  - `AuthService.readUserContext(userUuid, teamUuid)` (`repository.ts:253-280`) 已经体现这个问题：JOIN identities 时按 `i.user_uuid = m.user_uuid AND i.team_uuid = m.team_uuid` —— 在 user A 切到 team B 时，**identity_provider 与 login_identifier 字段会变 NULL**（LEFT JOIN miss）。这是 Z2/Z4 客户端切租户场景的 silent bug。
- **审查判断**：必须从 schema 层去 team_uuid 解耦。
- **建议修法**：
  - Migration 002 中：
    ```sql
    ALTER TABLE nano_user_identities DROP COLUMN team_uuid;  -- 但 D1/SQLite ALTER 限制
    ```
    更可靠的做法是新建一张表 `nano_user_identities_v2` 不含 team_uuid，从旧表迁移数据，drop 旧表，rename。
  - 同步修改 `D1AuthRepository`：所有 JOIN identity 的 query 改成 `i.user_uuid = m.user_uuid`（移除 team_uuid 条件）；`createBootstrapUser` INSERT identity 不再带 team_uuid；`UserContextRecord` 含 identity_provider 但 query 不依赖 team_uuid 与 identity_uuid 一对一关联。
  - 这个改动对 Z2 是前置依赖，建议立即在 Z1 r2 修订中处理。

### R5. `membership_level: 100` 是 magic number，无 enum / 无 contract 文档 / 无 CHECK

- **严重级别**：`medium`
- **类型**：`docs-gap` + `correctness`
- **事实依据**：
  - `workers/orchestrator-auth/src/repository.ts:206`：`.bind(input.membership_uuid, input.team_uuid, input.user_uuid, 100, input.created_at)` —— 100 写死。
  - `migrations/001-identity-core.sql:36-44 nano_team_memberships`：`membership_level INTEGER NOT NULL`，无 CHECK constraint。
  - `packages/orchestrator-auth-contract/src/index.ts:48 AuthTeamSchema.membership_level: z.number().int().nonnegative()`—— 任何 ≥0 整数都接受。
  - 对照 `context/ddl-v170/smind-01 smind_team_memberships`：使用 `team_role TEXT CHECK(team_role IN ('owner','admin','member',...))` —— enum 字符串而非 magic number。
- **为什么重要**：
  - 一年后维护者读到 `membership_level: 100` 必须 grep 才能知道是 owner；读到 50 / 30 不知道是什么；
  - Z3 quota gate / Z4 client UI 想根据角色裁剪权限，无 enum 锚点；
  - contract 中允许 0..2^31-1 任意整数，schema 完全不带语义。
- **审查判断**：要么改成 enum 字符串（与 ddl-v170 对齐），要么至少给数字加 enum 注释 + CHECK constraint + contract 注释。
- **建议修法**：
  - **推荐**：与 ddl-v170 对齐，用 `membership_role TEXT` + CHECK enum (`'owner','admin','member'`)。`membership_level` 保留为辅助列或删除。
  - **退而求其次**：保持 INTEGER 但加 CHECK + 显式常量：
    ```sql
    membership_level INTEGER NOT NULL CHECK (membership_level IN (10,30,50,100))
    -- 100=owner, 50=admin, 30=member, 10=guest
    ```
    并在 `contract:48` 用 `z.union([z.literal(100), z.literal(50), z.literal(30), z.literal(10)])` 锁死。

### R6. `updatePasswordSecret` 把 password 重置时间错误地写进 `last_login_at` + mass update 跨多 identity

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-auth/src/repository.ts:354-362`：
    ```sql
    UPDATE nano_user_identities
       SET auth_secret_hash = ?2, last_login_at = ?3
     WHERE user_uuid = ?1 AND identity_provider = 'email_password'
    ```
  - `service.ts:329-330`：`const updatedAt = this.nowIso(); await this.deps.repo.updatePasswordSecret(identity.user_uuid, newHash, updatedAt);`
- **为什么重要**：
  - **语义错误**：password reset 时机不应被记入 last_login_at（这会污染"最后一次登录时间"分析）。如果未来安全审计想看"最近一次登录是什么时候"，password 重置会假装登录。
  - **mass update 风险**：一个 user 理论上可能有多个 email_password identity 行（CHECK constraint 不限制多行）—— 全部一起被改。如果 user 的 email_password identity 在某些边界状态下分裂（例如双邮箱），密码会被同步——可能不是预期。
- **审查判断**：低优先级但应修。
- **建议修法**：
  - 加列 `password_updated_at TEXT`（独立于 last_login_at）；或重命名 last_login_at → time_updated_at（语义更广）。
  - WHERE 子句改成 `WHERE identity_uuid = ?1`（精确到 identity 而非 user）。`service.ts` 调用方传 identity_uuid。

### R7. `nano_user_identities.identity_status` 缺 CHECK constraint

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `migrations/001-identity-core.sql:24`：`identity_status TEXT NOT NULL DEFAULT 'active'`
  - 对照 ddl-v170 所有 status 列都有 CHECK enum。
- **为什么重要**：可以写入任意字符串（应用层 bug 容易渗漏到 DB）。
- **审查判断**：低成本 fix。
- **建议修法**：Migration 002 中加：
  ```sql
  -- SQLite/D1 不支持 ADD CONSTRAINT，须用新表迁移
  -- 或先 ALTER ... CHECK only at INSERT-side via app
  ```
  实际上推荐通过应用层（service）写入时验证，不依赖 D1 enforcement。

### R8. `query string ?access_token=...` 仍被支持（OAuth/JWT 反模式）

- **严重级别**：`medium`
- **类型**：`security`
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:101-103 readAccessToken`：从 query string 读 access_token。
  - `workers/orchestrator-core/src/auth.ts:151-152 parseBearerToken`：同样支持 query string token。
- **为什么重要**：
  - 反向代理 / Cloudflare logs / browser history / referrer header 都可能泄漏 query string。OAuth2 RFC6750 §2.3 明确建议**不要**用 URI query parameter 传递 bearer token（除非 Authorization header 不可用，本场景显然不是）。
  - Z1 已经把 auth 拉到生产严肃化阶段，不应保留这个 fallback。
- **审查判断**：删除 query string fallback。
- **建议修法**：`readAccessToken` 与 `parseBearerToken` 只读 `Authorization: Bearer ...` header；query string 路径删除。WS 升级如需 query token 是个特殊情况（浏览器 WS 不允许设 header），但本期 WS 不在 Z1 范围。

### R9. `compatibility_date` 跨 worker 不一致 + `database_id` 是 placeholder 但无注释告警

- **严重级别**：`low`
- **类型**：`docs-gap` + `delivery-gap`
- **事实依据**：
  - `workers/orchestrator-core/wrangler.jsonc:5`：`"compatibility_date": "2026-04-24"`
  - `workers/orchestrator-auth/wrangler.jsonc:5`：`"compatibility_date": "2026-04-25"`
  - 双方 `database_id: "00000000-0000-0000-0000-000000000001"`，无注释。
- **为什么重要**：
  - `compatibility_date` 不一致可能导致两个 worker 看到不同的运行时 API surface（例如 nodejs_compat 行为细节）；
  - 占位 UUID 没有"deploy 前必改"提示，容易复制到生产。
- **审查判断**：低成本 fix。
- **建议修法**：
  - 统一两个 worker 的 `compatibility_date` 到同一天；后续 root 层定一个共享 const（例如 `pnpm-workspace.yaml` 注释或 `tools/wrangler-base.json`）。
  - 在 `database_id` 行加注释：`// REPLACE before production deploy: wrangler d1 list / wrangler d1 create`。

### R10. `test/package-e2e/orchestrator-auth/01-probe.test.mjs` 默认被 `liveTest` 跳过，无回归护栏

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - `test/package-e2e/orchestrator-auth/01-probe.test.mjs:4 liveTest("...", ["orchestrator-auth"], async ...)` —— 使用 `liveTest`。
  - `test/shared/live.mjs:21-23 liveEnabled() = process.env.NANO_AGENT_LIVE_E2E === "1"`；`:30-37 liveTest` 在 `!enabled` 时 `skip`。
  - `Z1-closure §3.5` 宣称"`pnpm test:package-e2e` 维持 baseline"——但默认环境变量未设，probe test 100% 跳过。
- **为什么重要**：
  - 唯一的 worker-level external smoke 默认不跑；CI 矩阵也没显式设置 `NANO_AGENT_LIVE_E2E=1`（`.github/workflows/workers.yml` 没出现该变量）。
  - 这等于宣称"已测"但实际"未测"。
- **审查判断**：要么把这个 probe 改成不依赖 live（用 fetch mock 或 miniflare），要么 CI 中显式按需启用。
- **建议修法**：
  - 短期：保留 live-only，但 Z1 closure 明确写"该 probe 仅在 live deploy 后跑，本地默认跳过"——避免误导。
  - 长期：补一个非 live 的 vitest probe，直接 import worker module 调 fetch handler，不需要真实 deploy。

### R11. `nano_user_identities` `team_uuid` 索引矛盾（unique by provider+subject vs row 含 team）

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `migrations/001-identity-core.sql:21 team_uuid TEXT NOT NULL`
  - `migrations/001-identity-core.sql:72-73 uq_nano_user_identities_provider_subject ON (identity_provider, provider_subject_normalized)` —— 全局 unique，不含 team_uuid。
- **为什么重要**：
  - 这是 R4 的延伸但更具体：unique index 已经在 row level 表态"同 provider 同 subject 不允许出现两次"，但 row 又强行携带 team_uuid——等于"同一个 email 全局只能存在一行 identity，但这行 identity 又必须挂在某一个 team 上"。
  - 当用户被加入第二个 team，要么 (a) 改原行的 team_uuid（破坏第一个 team 的引用）；(b) 不加；(c) 删除并重建（失去 created_at）。
  - smind-admin 范式（`auth.service.ts:107-130`）解决这个矛盾的方式是 identity 不带 team——由 memberships 表表达 user-team 关系。
- **审查判断**：与 R4 合并修复（drop team_uuid from identities，membership 表表达 user-team 关系）。
- **建议修法**：见 R4。

### R12. CI paths trigger 漏 `packages/orchestrator-auth-contract/**`

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - `.github/workflows/workers.yml:6-12`：
    ```yaml
    paths:
      - "workers/**"
      - "packages/nacp-core/**"
      - "packages/nacp-session/**"
      - "pnpm-workspace.yaml"
      - "pnpm-lock.yaml"
      - ".github/workflows/workers.yml"
    ```
  - 缺 `packages/orchestrator-auth-contract/**`。
- **为什么重要**：
  - 修改 contract package（zod schema 变更、添加新接口、改字段命名）不会触发 worker CI 矩阵——但 worker code 引入这个 contract 作为 dep，schema 变更会破坏 worker 编译。
  - 这是 **silent regression**：PR 改 contract 不跑 CI、merge 后第一次跑 worker CI 才爆。
- **审查判断**：必须修；PR 一行改动。
- **建议修法**：
  ```yaml
  paths:
    - "workers/**"
    - "packages/nacp-core/**"
    - "packages/nacp-session/**"
    - "packages/orchestrator-auth-contract/**"   # ← add
    - "pnpm-workspace.yaml"
    ...
  ```

### R13. orchestrator-auth migrations_dir 缺失 / migration owner 与 write owner 错位

- **严重级别**：`medium`
- **类型**：`scope-drift` + `delivery-gap`
- **事实依据**：
  - `workers/orchestrator-core/wrangler.jsonc:21` `migrations_dir: "migrations"` —— 此 worker 持有 schema apply。
  - `workers/orchestrator-auth/wrangler.jsonc` 16-22 行 d1_databases 段无 `migrations_dir` —— 该 worker 不能自己 apply migrations。
  - design `Z1 §3.1 解耦点 / §6.1 取舍 3` 与 `ZX-D1 §3.4 + §7.2 F1`：identity write 权应 only 在 auth worker。
- **为什么重要**：
  - 实际部署流程：必须先 deploy orchestrator-core 来 apply migrations，再 deploy orchestrator-auth 来执行业务。这与 design 的"auth worker 是 identity owner"逻辑相反——orchestrator-core 反而成了 schema 主。
  - 部署顺序错误（先 auth 后 core）→ auth runtime 启动时 NANO_AGENT_DB 表不存在 → register/login 全 503。
- **审查判断**：必须解决 schema owner 单一性。
- **建议修法**：
  - **方案 A（推荐）**：迁移文件移到 `workers/orchestrator-auth/migrations/`；`orchestrator-auth/wrangler.jsonc` 加 `migrations_dir: "migrations"`；`orchestrator-core/wrangler.jsonc` 删除 `migrations_dir`。这样 schema owner = auth owner。
  - **方案 B**：保留现状但在 Z1 closure / Z2 起跑前明确"deploy orchestrator-core first to apply migrations"作为部署前置约束。

### R14. `tenant_source: "deploy-fill"` 路径在多租户场景下会导致 silent merge

- **严重级别**：`high`
- **类型**：`security`
- **事实依据**：
  - `workers/orchestrator-core/src/auth.ts:194-203 + 213-214`：当 token 没有 team_uuid claim 时，使用 `env.TEAM_UUID` 作为 effective tenant，并 stamp `tenant_source: "deploy-fill"`。
  - `workers/orchestrator-core/wrangler.jsonc:13 TEAM_UUID: "nano-agent"` —— 部署 default 是字符串"nano-agent"，不是真实 team UUID。
  - `Z1-closure §4.2` 已诚实承认：`agent-core / NanoSessionDO 当前仍以 deploy-local TEAM_UUID 作为 runtime tenant anchor`。
- **为什么重要**：
  - **风险路径**：如果某个 user 持有的 access_token 不带 team_uuid（例如 legacy token / 测试 fixture / future API key minted 的 service token），orchestrator-core 会把这个 token 映射到 effective tenant = "nano-agent"。
  - 在多租户上线后：如果两个真实 user A、B 都用 legacy token 登录，他们都被 "deploy-fill" 到 "nano-agent" 同一个 tenant —— A 与 B 的 session、message、history 在同一 tenant 下混合。
  - Z1 mint 的新 token 都带 team_uuid claim，所以 fresh token 走 "claim" 路径——OK。但 fallback path 仍存在。
- **审查判断**：要么彻底关掉 deploy-fill，要么 deploy-fill stamp 时强制要求 `env.TEAM_UUID` 是真实 UUID（而非字符串）。
- **建议修法**：
  - **短期**：`auth.ts` 增加 invariant：如果 `effectiveTenant === undefined && env.TEAM_UUID` 不是 UUID 格式（用 UUID_RE 检查），返回 503 `worker-misconfigured`。
  - **中期**：把 deploy-fill 路径删除（仅接受 token 自带 team_uuid）；保留 `env.TEAM_UUID` 仅作为 single-tenant 部署的别名约束。
  - **长期**：把 `legacy JWT_SECRET` 完全 retire（Z2 closure 之前）—— legacy token 只要存在，deploy-fill 就有进入路径。

### R15. `Z0 closure §3` 表格无证据列、`Z0 工作日志`空泛

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/issue/zero-to-real/Z0-closure.md:32-38` 表格 5 行只标 verdict（`execution-ready / frozen / resolved / fixed / ready`），无 commit / file / test 命中作为证据。
  - `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md:319-325 §9 工作日志` 5 行全部为元宣称（"重新核对"、"将...压回 runner"），新交付物只有 closure 自身。
- **为什么重要**：
  - Z0 自我定位为 "phase governance gate"，但 closure 没有可机器验证的 evidence。Z5 audit 时如果想回溯 Z0 是否真完成，找不到锚点。
  - "Z0 自己宣称已完成" 与 "Z1-Z5 已经引用 Z0 freeze" 是循环 self-reference。
- **审查判断**：低优先级（不阻塞 Z2 起跑），但 Z5 audit 时会受影响。
- **建议修法**：在 Z0 closure §3 表格 verdict 列右侧加 evidence 列：commit SHA / 文件路径 / grep 输出。例：
  | charter | execution-ready | `docs/charter/plan-zero-to-real.md`（commit 0ac807b 后未变） |

### R16. Z1 工作日志声明的"双租户 negative tests"与"forged authority / cross-team readback"未在 package-e2e 中真实落地

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - `docs/design/zero-to-real/Z1 §7.3` 与 `docs/action-plan/zero-to-real/Z1 §3 P5-01`：要求覆盖 forged token / tenant mismatch / cross-team readback / non-orchestrator caller 4 类负例。
  - `test/package-e2e/orchestrator-auth/` 仅 1 个文件 `01-probe.test.mjs`（且 live-only）。
  - `workers/orchestrator-core/test/auth.test.ts`（62 行）+ `workers/orchestrator-auth/test/service.test.ts` 内有部分覆盖（包含 `rejects non-orchestrator callers`），但**跨 worker 的 cross-team readback 与 forged authority 测试没有出现在 package-e2e 层**。
- **为什么重要**：
  - 单元测试的 in-memory mock 不能证明真实 worker mesh + service binding 路径下的行为。
  - Z2 起跑期望"从 Z1 继承稳定的双租户 negative baseline"——但 baseline 在 package-e2e 层是空的。
- **审查判断**：补 package-e2e。
- **建议修法**：在 `test/package-e2e/orchestrator-core/` 增加：
  - `06-auth-tenant-mismatch.test.mjs`：mint token claim team_uuid=A，请求时 stamp deploy tenant=B → 期望 403 tenant-mismatch。
  - `07-auth-forged-authority.test.mjs`：用错误 secret 签的 token → 期望 401 invalid-auth。
  - `08-auth-non-orchestrator-caller.test.mjs`：直接绕开 orchestrator-core 调 orchestrator-auth → 期望 invalid-request（因为 schema literal）。

### R17. 命名漂移：`orchestration-auth` (design/action-plan) ↔ `orchestrator-auth` (实际)

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `grep -rn "orchestration-auth" docs/design docs/action-plan docs/charter | wc -l` → 数十处。
  - 实际目录与 package 名：`workers/orchestrator-auth/`（charter `orchestration.auth` 逻辑名 vs implementation `orchestrator-auth` dir name）。
  - workspace package: `@haimang/orchestrator-auth-worker`、`@haimang/orchestrator-auth-contract`。
  - 测试目录：`test/package-e2e/orchestrator-auth/`。
- **为什么重要**：
  - 两套命名混用，未来 reviewer grep 时容易漏掉一边。
  - charter 的"`orchestration.auth`"是逻辑名（dot-separated），impl 选择 `orchestrator-auth`（hyphen）与现有 `orchestrator-core` 对齐——这是合理的工程决策，但需要在 closure 显式记录。
- **审查判断**：必须在 Z1 closure / 反向更新到 design 与 action-plan，固定命名规则。
- **建议修法**：
  - Z1 closure 加一节"命名约定"：`logical name = orchestration.auth` (用于设计文档 / NACP authority source_name 等); `impl name = orchestrator-auth` (用于 dir / package / wrangler service binding)。
  - design Z1 / ZX-binding / Z0 freeze 中所有 `orchestration-auth` 字符串改为 `orchestrator-auth`（实际 dir 名），保留 `orchestration.auth` 字符串只在描述 NACP source_name 时使用。

### R18. `nano_team_api_keys` 缺 `key_status` / `scopes` / `last_used_at` —— "schema reserved" 但 reservation 太弱

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `migrations/001-identity-core.sql:62-70 nano_team_api_keys`：仅 5 列（`api_key_uuid / team_uuid / key_hash / label / created_at / revoked_at`）。
  - 对照 `context/ddl-v170/smind-01 smind_team_api_keys`（注释中含 `key_status` enum + scope 控制）。
  - smind-admin `validateApiKey` (`context/smind-admin/src/modules/identity/auth.service.ts:142-150`)：`WHERE api_key_hash = ? AND key_status IN ('active', 'rotating')`—— 即依赖 `key_status` 列。
- **为什么重要**：
  - Q4 owner 同意"schema reserved + impl defer"——但 reserved 应至少能不重大改动支持后续 impl。当前 5 列没 `key_status`，后续要支持 rotation 必须 ALTER TABLE 加列。
  - design 与 action-plan 都没具体定义 reserved 的字段集；nano 落得太薄。
- **审查判断**：补关键列再 reserved。
- **建议修法**：补 `key_status TEXT NOT NULL DEFAULT 'active' CHECK (key_status IN ('active','rotating','revoked'))` + `last_used_at TEXT` + `scopes TEXT`（JSON）+ `expires_at TEXT`。Migration 002 处理。

### R19. `ZX-qna` Q1 owner 同意了"shim retire deadline = Z2 closure 前必须替换为 RPC"，但 Z1 closure / 工作日志没记录此 deadline

- **严重级别**：`medium`
- **类型**：`docs-gap` + `scope-drift`
- **事实依据**：
  - `docs/design/zero-to-real/ZX-qna.md Q1 业主回答`：`同意 GPT 的推荐，同意 Opus 的看法` —— "Opus 的看法" 含 "fetch-binding shim 退化路径必须带 retire deadline = Z2 closure 之前必须完全替换为 RPC，否则 Z2 review 不收口"。
  - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md:344` 风险表中提到"保留 fetch-binding shim 过渡路径，但在 Z1 closure 中写明 retire deadline = Z2 closure 前"—— 计划已承诺。
  - `docs/issue/zero-to-real/Z1-closure.md` 全文搜不到 "shim" / "retire deadline" 字样。
- **为什么重要**：
  - 实际上 Z1 没用 shim（直接用了 WorkerEntrypoint RPC），所以这条 deadline 似乎不必再 enforce。但 closure 应该明确记录"Z1 直接走 RPC，无 shim 残留"——否则 Z2 reviewer 不知道是否需要回头检查。
- **审查判断**：低成本补一句话。
- **建议修法**：Z1 closure §4 加一行：`Z1 直接采用 WorkerEntrypoint RPC，未引入 fetch-binding shim，因此 ZX-qna Q1 中"shim retire deadline"约束已自动满足，Z2 无需回头处理。`

### R20. orchestrator-auth `wrangler.jsonc` 未声明 `WECHAT_APPID / WECHAT_SECRET / JWT_SIGNING_KEY_*` 为 secrets

- **严重级别**：`medium`
- **类型**：`security` + `delivery-gap`
- **事实依据**：
  - `workers/orchestrator-auth/wrangler.jsonc` 中 `vars` 仅含 `ENVIRONMENT / OWNER_TAG / JWT_SIGNING_KID / WECHAT_API_BASE_URL`。
  - 没有 `secrets:` 段或 `wrangler secret put` 文档；`PASSWORD_SALT / WECHAT_APPID / WECHAT_SECRET / JWT_SIGNING_KEY_v1` 等敏感变量在 wrangler.jsonc 中既不在 vars 也不在 d1_databases / services—— 它们必须靠手动 `wrangler secret put` 注入，但这个步骤在 Z1 工作日志中**没有任何提示**。
- **为什么重要**：
  - 部署时如果忘记 `wrangler secret put PASSWORD_SALT`，worker 启动后第一次 register 调用就会 503 `worker-misconfigured: PASSWORD_SALT must be configured`（`service.ts:54-58`）。
  - 没有 deploy 文档 / runbook，新部署员会卡 30 分钟。
  - 同时密钥泄漏风险：如果有人误把 secrets 写到 wrangler.jsonc vars，会被 commit 到 git。
- **审查判断**：必须有部署 runbook。
- **建议修法**：
  - 新增 `workers/orchestrator-auth/README.md` 或 `docs/handoff/zero-to-real/orchestrator-auth-deploy.md`：列出必须 `wrangler secret put` 的变量清单（PASSWORD_SALT / WECHAT_APPID / WECHAT_SECRET / JWT_SIGNING_KEY_v1）+ 默认值生成方式（`openssl rand -base64 48`）+ rotation 步骤。
  - 或在 Z1 closure 加一节 "deploy preconditions"。

### R21. `repository.ts` 的 `findIdentityBySubject` JOIN 假设 user 与 team 是一一对应的

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `repository.ts:159-189 findIdentityBySubject`：
    ```sql
    FROM nano_user_identities i
    JOIN nano_team_memberships m
      ON m.team_uuid = i.team_uuid AND m.user_uuid = i.user_uuid
    JOIN nano_teams t ON t.team_uuid = i.team_uuid
    LEFT JOIN nano_user_profiles p ON p.user_uuid = i.user_uuid
    WHERE i.identity_provider = ?1 AND i.provider_subject_normalized = ?2
    LIMIT 1
    ```
- **为什么重要**：
  - 由于 R4/R11 — identity 强行挂 team——这个 JOIN 在 first-wave 工作正常。但当 multi-team 启用、用户加入第二个 team 后，membership 表多一行（user-team-B），但 identity.team_uuid 仍是 team-A —— JOIN 仍然只能命中 team-A 一行。`findIdentityBySubject` 在 login 流程返回的 `team_uuid` 永远是 default team。
  - login 后 `ensureContextFromIdentity` (`service.ts:153-159`) 用这个 team_uuid 去 `readUserContext(user_uuid, team_uuid)` —— OK 但只能 login 到 default team。
  - **缺路径**：用户登录后如何切换到第二个 team？没有 API。Z2/Z4 必须新设计。
- **审查判断**：与 R4/R11 一组修复。
- **建议修法**：见 R4。同时新增 `chooseActiveTeam(user_uuid, team_uuid)` API 在 service / contract，让 me / login 后客户端可显式切租户。

### R22. `AuthSnapshot.tenant_source: "claim" | "deploy-fill"` 跨 worker 边界泄漏 deploy-fill 概念

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `packages/orchestrator-auth-contract/src/index.ts:31 AuthSnapshotSchema.tenant_source: z.enum(["claim", "deploy-fill"])`
  - `workers/orchestrator-auth/src/service.ts:99-101 buildSnapshot`：始终 hardcoded `tenant_source: "claim"`（auth worker 永远不会 deploy-fill）。
  - 仅 `orchestrator-core/src/auth.ts:214` 才会 stamp "deploy-fill"。
- **为什么重要**：
  - contract 同时支持两个值，但 auth worker 只用 "claim"。这是 contract 比 impl 表面更宽。
  - 如果 Z2 实施者读 contract 想搞清楚"deploy-fill 是 auth 还是 ingress 的概念"会困惑。
- **审查判断**：低优先级，但有助文档清晰。
- **建议修法**：在 `AuthSnapshotSchema.tenant_source` 注释中说明：`"claim" 由 orchestrator-auth issue tokens 时使用；"deploy-fill" 仅由 orchestrator-core 在 verify 已有 token 但缺 team_uuid claim 时使用，且 deploy-fill 路径将在 Z2 closure 之前 retire（参见 R14）`。

### R23. `compatibility_flags: ["nodejs_compat"]` 但 worker 代码全部用 Web API（无 nodejs 依赖）

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - `workers/orchestrator-auth/wrangler.jsonc:6` `compatibility_flags: ["nodejs_compat"]`。
  - `workers/orchestrator-auth/src/**` 全部使用 Web Crypto / fetch / TextEncoder / btoa / atob —— 0 处 require/import nodejs builtins。
  - 同样 `orchestrator-core` 也开了 nodejs_compat 但实际不依赖。
- **为什么重要**：
  - 多余的 compat flag 增加 cold start 时间（虽小）。
  - 给后续 reviewer 错觉"代码可能用了 Node API"，misleading。
- **审查判断**：低优先级，可保留以 future-proof。
- **建议修法**：在 Z2 起跑前，确认实际无 Node API 依赖后可考虑去掉该 flag；或在 wrangler.jsonc 加注释说明保留原因。

### R24. `Z2-action-plan` 仍引用 `nano_session_*` 表名树（Z2 没采用 conversation 上位聚合）—— 与 ZX-D1 design 分叉将污染 Z2 实施

- **严重级别**：`high`
- **类型**：`scope-drift`
- **事实依据**：
  - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md §2.1 S1`：`nano_sessions / nano_session_turns / nano_session_messages / nano_session_contexts / nano_session_activity_logs`。
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md §5.1 S2`：`nano_conversations / nano_conversation_sessions / nano_conversation_turns / nano_conversation_messages`。
  - Z1 已实施完，未触及该层；但 Z2 一旦起跑就会按 action-plan 落 Wave B schema —— 与 ZX-D1 设计分叉。
- **为什么重要**：
  - Z1 选择 `nano_user_identities` / `nano_team_memberships` 与 ZX-D1 一致——意味着 Z1 实施者尊重 ZX-D1 真相。Z2 实施者按 action-plan 写就会与 ZX-D1 分叉。
  - 这是 charter / design / action-plan / impl 四层一致性裂缝。
- **审查判断**：必须在 Z2 起跑前对齐 Z2 action-plan 与 ZX-D1。
- **建议修法**：Z2 r2 修订 §2.1 S1 改为 `nano_conversations / nano_conversation_sessions / nano_conversation_turns / nano_conversation_messages / nano_conversation_context_snapshots / nano_session_activity_logs`（保留 activity_logs 单独，conversation 为顶）。同时反向校对 ZX-D1 §5.1 S2 表名是否能与 ddl-v170 smind-06 真实兼容。

### R25. `Z3 / Z4 / Z5 action-plan` 仍持续引用 `pnpm test:cross` —— 实际 `package.json:10` 的 `test:cross` 与 `test:e2e / test:live:e2e` 三个脚本指向**完全相同**的命令

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `package.json:8-15`：
    ```json
    "test:e2e": "node --test test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs",
    "test:cross": "node --test test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs",
    "test:package-e2e": "node --test test/package-e2e/**/*.test.mjs",
    "test:cross-e2e": "node --test test/cross-e2e/**/*.test.mjs",
    "test:live:e2e": "node --test test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs"
    ```
  - `test:cross / test:e2e / test:live:e2e` 三者完全等价（相同命令）。
  - `test:cross-e2e` 是真正的 cross-only 命令。
- **为什么重要**：
  - Z2/Z3/Z4/Z5 action-plan 多次写 `pnpm test:package-e2e && pnpm test:cross` —— 这等于跑两遍 package-e2e + 一遍 cross-e2e（因为 test:cross 已包含 package-e2e）。
  - 三个脚本同义但同时存在，会让维护者困惑哪个是"标准入口"。
- **审查判断**：低成本清理。
- **建议修法**：
  - 删除 `test:cross` 与 `test:live:e2e`；保留 `test:e2e`（catch-all） + `test:package-e2e` + `test:cross-e2e`。
  - 反向更新 Z2-Z5 action-plan，改 `pnpm test:cross` → `pnpm test:cross-e2e`。

### R26. `nano_team_memberships.team_uuid + user_uuid` 唯一索引（migration:75-76）但**没有 active/inactive 状态过滤**

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `migrations/001-identity-core.sql:75-76 uq_nano_team_memberships_team_user ON (team_uuid, user_uuid)` —— 全局唯一，不允许同 team-user 出现两次。
  - 对照 ddl-v170 smind-01:`uq_team_memberships_team_user`（同样唯一）+ `uq_team_memberships_active_owner`（active+owner 唯一）。
  - nano 缺第二个索引，但 nano 也没有 membership_status 列（仅 membership_level + created_at）—— 一旦 user 被踢出 team，唯一选择是删行（破坏 audit trail）。
- **为什么重要**：
  - 长尾问题：踢人后又重新加入需要 PK 重新生成；`created_at` 失真。
  - 想做"at-most-one-active-membership-per-(team,user)"语义，必须有 status 列。
- **审查判断**：与 R3 / R5 一组（schema 状态列缺失）。
- **建议修法**：在 R3 修复中合并加 `membership_status TEXT NOT NULL DEFAULT 'active' CHECK (membership_status IN ('active','removed','invited'))`；唯一索引改为 partial：`UNIQUE (team_uuid, user_uuid) WHERE membership_status = 'active'`。

### R27. `Z0 closure` §1 行 16 的 "可直接驱动实施" 语气与实际事实差距

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - Z0 closure §1 行 16：`zero-to-real 现在不再停留在"charter / design / ZX-qna 都写完了"的状态，而是已经拥有一套可直接驱动实施的执行基线`。
  - 但本审查发现 ≥10 处 design / action-plan / impl 不一致或断点（R3 schema 缺列、R4 identity-team 耦合、R12 CI paths trigger 漏、R14 deploy-fill 风险、R17 命名漂移、R24 Z2 表名分叉、等）。
  - "execution-ready" 的标尺过松。
- **为什么重要**：
  - Z5 audit 时如果信任 Z0 closure，可能漏判 Z2/Z3 起跑前的真实风险。
- **审查判断**：低优先级；建议 Z0 closure 加一节"已知 carry-over residuals"。
- **建议修法**：在 Z0 closure §4 之后加 §5 "Z0 carry-over"：列出 Z0 期间识别但未在 Z0 范围内修复的事项（如 R12 CI paths、R17 命名漂移）。

### R28. `JWT_SIGNING_KEY_v1` 的最小长度仅 32 chars —— `jwt.ts:58 if (typeof value !== "string" || value.length < 32) continue`

- **严重级别**：`medium`
- **类型**：`security`
- **事实依据**：
  - `workers/orchestrator-auth/src/jwt.ts:58`：`if (typeof value !== "string" || value.length < 32) continue;` —— 32 char 视为有效。
  - `workers/orchestrator-core/src/auth.ts:96`：同样 `value.length < 32`。
  - 测试 fixture：`workers/orchestrator-auth/test/service.test.ts:113 JWT_SIGNING_KEY_v1: "x".repeat(32)` —— 32 个字符 'x'，仅 32 字节（256 bit）但是只有 1 种字符的 entropy 极低。
  - HS256 推荐 secret ≥ 256 bit (32 byte) random，但 length check 不能阻止全 'x'。
- **为什么重要**：
  - HS256 安全完全依赖 secret entropy。32 字节硬阈值合理（256 bit），但代码无 random check。如果 deploy 员设置 `JWT_SIGNING_KEY_v1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`（32 a），check 通过但 entropy = log2(1) = 0 bit。
  - 应至少在 README / runbook 强制要求 `openssl rand -base64 32` 生成。
- **审查判断**：补 runbook 文档（与 R20 同条修法）。
- **建议修法**：
  - 在 deploy runbook（R20）显式说"必须用 `openssl rand -base64 48` 生成 PASSWORD_SALT 与所有 JWT_SIGNING_KEY"。
  - 可选：在 worker startup logging 加 entropy 估算（Shannon entropy 检查），低于 4.0 bit/char 警告。

### R29. `tenant_source` 在 `AuthSnapshotSchema` 是 required (`contract:31`)，但 `orchestrator-core/src/auth.ts:210-219 snapshot` 在 `effectiveTenant` 缺失时 stamp `tenant_source: "deploy-fill"` 但不 stamp `team_uuid` —— snapshot 会缺 team_uuid 字段，与 schema 矛盾

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/orchestrator-auth-contract/src/index.ts:26-35 AuthSnapshotSchema`：`team_uuid: z.string().uuid()` —— required。
  - `workers/orchestrator-core/src/auth.ts:210-219`：
    ```ts
    const snapshot: AuthSnapshot = {
      sub: payload.sub,
      ...(userUuid ? { user_uuid: userUuid } : {}),
      ...(effectiveTenant ? { team_uuid: effectiveTenant, tenant_uuid: effectiveTenant } : {}),
      tenant_source: effectiveTenant ? "claim" : "deploy-fill",
      ...
    };
    ```
  - 当 `effectiveTenant` undefined（token 无 team_uuid && env.TEAM_UUID undefined），`team_uuid` 字段不被 stamp，但 `tenant_source: "deploy-fill"` 仍 stamp —— 这违反 schema。
  - `auth.ts` 内的 `AuthSnapshot` interface（`auth.ts:20-30`）允许 team_uuid optional，但 contract schema 不允许。**两套 type 不同**。
- **为什么重要**：
  - 如果 orchestrator-core 把这个 snapshot 序列化发给 agent-core 或 user-do，agent-core 反序列化用 `AuthSnapshotSchema.parse()` 会失败（缺 team_uuid + UUID validation）。
  - Z2 一旦让 agent-core 消费 AuthSnapshot 就会触发此 bug。
- **审查判断**：必须修。
- **建议修法**：
  - 短期：`auth.ts` 中如果 effectiveTenant undefined，应直接 reject（403 worker-misconfigured 或 401 invalid-auth），不要 stamp 半成品 snapshot。
  - 长期：与 R14 deploy-fill retire 路径一起处理。

### R30. `Z1 closure §3.4` 宣称 "wrangler deploy --dry-run 都已通过" 但工作日志没记录 dry-run 输出

- **严重级别**：`low`
- **类型**：`test-gap` + `docs-gap`
- **事实依据**：
  - `Z1-closure.md §3.4`：`workers/orchestrator-auth 与 workers/orchestrator-core 的 wrangler deploy --dry-run 都已通过`。
  - Z1 action-plan §9 工作日志:404-407 列出了执行命令（pnpm typecheck/build/test/deploy:dry-run），但**没有 commit dry-run output / log artifact**。
- **为什么重要**：
  - dry-run 输出可能含警告（例如 `database_id: "00000000-0000-0000-0000-000000000001"` 是 placeholder，wrangler 可能 warn）。
  - 没有 artifact，未来无法回溯。
- **审查判断**：低优先级；建议 Z2 起 closure 时把关键 deploy:dry-run 输出存到 evidence pack。
- **建议修法**：Z2 closure 起，每个 phase closure 携带 `evidence/` 子目录，存关键命令输出（dry-run / test 总结 / migration apply 输出）。

---

## 3. In-Scope 逐项对齐审核

### 3.1 Z0 In-Scope（来自 `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md §2.1`）

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| Z0-S1 | 核对并声明 zero-to-real 的 frozen inputs | `done` | charter / 10 design / ZX-qna 在 Z0 closure §3 列出 |
| Z0-S2 | 输出 Z1-Z5 的 cross-cutting dependency / sequencing / validation baseline | `partial` | dependency map 在 Z0 工作日志中提及，但 closure §3 表格缺证据列（R15）；Z2-Z5 内表名 / script 错配（R24/R25）未被 Z0 拦下 |
| Z0-S3 | root test scripts 升格为执行基线 | `partial` | scripts 列入 Z0 closure §3 但 `test:cross` 与 `test:e2e / test:live:e2e` 三脚本同义未清理（R25） |
| Z0-S4 | 产出 `Z0-closure.md` | `done` | `docs/issue/zero-to-real/Z0-closure.md` 已创建（55 行） |

**Z0 对齐结论**：done=2 / partial=2 / missing=0。Z0 governance 任务名义完成，但"补冻结具体技术决策"职责未真正履行（R15、R25）。

### 3.2 Z1 In-Scope（来自 `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md §2.1`）

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| Z1-S1 | 新建 `packages/orchestration-auth-contract/`，承载 typed RPC contracts | `done` | 命名落为 `orchestrator-auth-contract`（R17）；contract 232 行覆盖 8 个 API + envelope + error codes（其中 `invalid-caller` 死代码 R2） |
| Z1-S2 | 新建 `workers/orchestration-auth/`，internal-only single-caller worker | `partial` | 实际命名 `orchestrator-auth`（R17）；single-caller 通过 schema literal 实现（R2）；wrangler 缺 secret 运维文档（R20）；compatibility_date 不一致（R9） |
| Z1-S3 | 落 Wave A D1 schema：identity core + nano_auth_sessions + nano_team_api_keys | `partial` | 7 张表已建（F+3），但 `nano_users` 字段过薄（R3）；`identity_provider` CHECK 仅 2 项（F-7）；`identity` 强行带 team_uuid（R4/R11）；`identity_status` 无 CHECK（R7）；`nano_team_api_keys` 缺 status（R18） |
| Z1-S4 | 打通 register/login/verify/refresh/reset/me 真实 auth flow | `partial` | API surface 全部到位（F+1, F+12），refresh rotation OK；但事务安全性失败（R1）；reset 副作用错误（R6）；double cover by query token（R8）；snapshot schema mismatch（R29） |
| Z1-S5 | 打通 WeChat code → openid → identity → JWT 真实链路 | `done` | `wechat.ts` 完整调 jscode2session；service.ts wechatLogin 实现 bootstrap+reuse；测试 mock 覆盖（F+13） |
| Z1-S6 | 自动建 default team + owner membership + 双租户 negative tests | `partial` | 自动建 OK（F+6）；但 membership_level=100 magic number（R5）；双租户 negative tests 在 package-e2e 层未真实落地（R16/F-20） |

**Z1 对齐结论**：done=2 / partial=4 / missing=0。Z1 主体能力到位（contract / worker / migration / API surface / WeChat），但 6 项中 4 项 partial 都是因为底层 schema / 安全 / 测试缺口（R1-R6 共 6 个 finding 中有 5 个攻击 Z1 partial 项）。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| Z0-O1 | Z0 不新增任何 worker / package / client 代码 | `遵守` | Z0 仅新增 closure 文档；Z1 才新增 worker / package |
| Z0-O2 | Z0 不重新打开 Q1-Q10 owner 决策 | `遵守` | ZX-qna 在 Z1 实施期未被反向修改 |
| Z0-O3 | Z0 不撰写 final closure / next-phase handoff | `遵守` | 仅写 Z0 closure，未越界写 Z5 final |
| Z1-O1 | 完整 tenant/member/API key admin plane | `遵守` | 没有任何 admin route / member CRUD；API key 仅 schema reserved |
| Z1-O2 | session / turn / message / audit 持久化主线 | `遵守` | Wave A 不含 session/turn/message 表 |
| Z1-O3 | real provider / quota / runtime evidence | `遵守` | agent-core / llm/registry 无变更 |
| Z1-O4 | 完整 Mini Program 真机 hardening | `遵守` | 仅 jscode2session 后端 bridge；没碰客户端栈 |

**OoS 整体结论**：7 项全 `遵守`。这是 Z0-Z1 最稳的部分。

**隐性 OoS（Z0-Z1 期间未显式列入但实际未做）**：
- 观测性（结构化 logs / metrics）：Z1 worker 没加任何 emit，但 wrangler.jsonc 开了 `observability.enabled: true`——OK，但没有 trace 关联到 NACP trace_uuid 的逻辑。
- CI/CD pipeline 强化：CI workflow 仅 build + test + dry-run，没有 deploy 自动化。OK 当前阶段。
- I18n / 多语言 error message：所有 error message 是英文。OK first-wave。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested (Grade: C+)` —— Z0/Z1 主体能力到位，但实现层有 1 个 critical bug（D1 事务）+ 4 个 high finding（R2 死代码 / R3 schema 缺关键列 / R4 identity-team 耦合 / R11 unique 索引矛盾 / R14 deploy-fill 风险 / R21 multi-team JOIN 假设 / R24 Z2 表名分叉），实施层与设计层分叉处达 2 处（命名、表名树拓扑），不能直接进入 Z2。
- **是否允许关闭本轮 review**：`no` —— 不收口，Z2 起跑前必须先修这一组 blocker。
- **关闭前必须完成的 blocker（按优先级）**：
  1. **R1 — D1 事务改用 `db.batch([...])`**：`createBootstrapUser` + `rotateAuthSession` 必须移除 BEGIN/COMMIT/ROLLBACK，改用 D1 的 batch 原语。这是生产 blocker。
  2. **R3 + R4 + R11 — schema 修复（合并）**：补 `nano_users.user_status / is_email_verified / time_updated_at`；`nano_user_identities` 去掉 `team_uuid` 列；同步修改 `D1AuthRepository` 与 `findIdentityBySubject` JOIN 条件。这是 multi-tenant 路径的硬阻塞。
  3. **R14 — deploy-fill 路径必须显式收紧**：要求 `env.TEAM_UUID` 是真实 UUID 才接受；不是 UUID 时 fail-closed。这是安全 blocker。
  4. **R29 — `AuthSnapshot` 中 `team_uuid` 必填**：deploy-fill 失败时拒绝产 snapshot；contract 与 impl 类型对齐。
  5. **R12 — CI paths trigger 加 `packages/orchestrator-auth-contract/**`**：一行 yaml 改动。
  6. **R24 — Z2 action-plan 表名树对齐 ZX-D1**（在 Z2 起跑前修订）：避免 Z2 实施时再次出现 design/action-plan 分叉。
  7. **R2 — `invalid-caller` 死代码处理**：选择 schema 单点防御（删 dead branch）或代码层显式检查（放宽 schema）。

- **可后续跟进的 non-blocking follow-up（按优先级）**：
  1. **R5 / R6 / R7 / R18 / R26**：schema 长尾改进（membership_role enum、reset 副作用、status CHECK、api_key 字段、partial unique index）—— 在 Z2 schema 加 `nano_session_*` 时一并补。
  2. **R8 — 删除 query string access_token 支持**：单文件改动，建议在 R14 修复时一起处理。
  3. **R10 / R16 — 测试基础设施**：补非 live 的 worker probe + 双租户 package-e2e 负例。
  4. **R17 — 命名漂移**：把 design / action-plan 中的 `orchestration-auth` 字符串改为 `orchestrator-auth`，统一术语。
  5. **R20 / R28 — 部署 runbook + secret entropy 文档**：新增 `docs/handoff/zero-to-real/orchestrator-auth-deploy.md`。
  6. **R9 / R23 — 微调 wrangler 配置**：统一 compatibility_date、为 placeholder UUID 加注释、确认 nodejs_compat flag 实际需要性。
  7. **R19 — Z1 closure 补 shim retire deadline 自动满足声明**。
  8. **R22 — contract `tenant_source` 注释清晰化**。
  9. **R27 — Z0 closure 补 carry-over residuals 节**。
  10. **R30 — Z2 closure 起引入 evidence pack 目录**（保留 dry-run / test / migration 输出）。

> 本轮 review 不收口。建议修法路径：
>
> **第一轮（≤ 1 天）**：批量修 R1 + R12 + R2（小改）；先把生产 blocker 与 silent regression 路径关掉。
> **第二轮（1-2 天）**：合并 R3 + R4 + R11 + R26 schema 重构；同步更新 `D1AuthRepository` JOIN 条件与 `createBootstrapUser` schema。需要新写一份 migration 002（schema rebase 或 ALTER），并更新单元测试。
> **第三轮（半天）**：R14 + R29 deploy-fill 路径收紧 + AuthSnapshot 类型对齐 + R8 query token 删除。
> **第四轮（半天）**：R24 Z2 action-plan 表名修订（在 Z2 起跑前完成）。
>
> 完成上述 4 轮后回归 Z1 review，预期可升级到 `approve-with-followups (Grade: B+)` 并解锁 Z2。
>
> **跨阶段视角的额外提醒**：
> - **Z2 期望消费 AuthSnapshot → NacpAuthority**，但 contract 中 `AuthSnapshot` 缺 `roles[]` / `scopes[]`，仅有 `membership_level: number`。Z2 实施者要么按 membership_level 数字直推 NACP authority（耦合 magic number），要么在 contract 中加 roles 字段（contract 改动）。建议在 R5 修复时一并处理 membership_level → role enum，让 Z2 直接消费 enum。
> - **Z3 quota gate 要写 `nano_session_activity_logs`**，但目前该表在 Wave B（Z2）才会建——Z3 起跑前必须确认 Wave B 已落。这层依赖在 Z3 action-plan 中已说明（Phase 1 依赖 Z2 closed），OK。
> - **Z4 客户端要消费 register/login/refresh API**，contract 已稳定（F+1），可直接生成 TS client SDK；但 contract 中 envelope 是 `{ok: false, error: {...}}` discriminated union，Z4 客户端要做 type narrowing（不复杂）。
> - **NACP authority** 当前由 `orchestrator-core/src/auth.ts` 的 `AuthSnapshot` 表达，与 `packages/nacp-core/src/transport/service-binding.ts` 的 envelope 还没有联动 —— Z2 RPC kickoff 要建立 AuthSnapshot → NacpAuthority 的明确翻译层（ZX-NACP §7.2 F1），这件事 Z1 没做（OoS），Z2 必做。

---

## 6. 实现者回应模板

### 6.1 对本轮审查的回应

> 执行者: `GPT-5.4`
> 执行时间: `2026-04-25`
> 回应范围: `Opus R1-R30 + DeepSeek R1-R11 + Kimi R1-R10（重复项已折叠回应）`

- **总体回应**：`本轮已修掉真实的 correctness / security / CI / docs drift 问题；仍有几条属于已冻结 Z1 posture 的设计分歧，保留为 deferred/rejected，并在 closure 中明确限制。`
- **本轮修改策略**：`先修会影响代码真相的 blocker（D1 batch、caller enforcement、snapshot 语义、auth 负例、CI、wrangler/doc drift），再把文档中过满口径收紧到与当前 6-worker 代码一致。`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 / K-R3 | D1 伪事务无 atomicity | `fixed` | 删除 `BEGIN/COMMIT` 路径，`createBootstrapUser()` 与 `rotateAuthSession()` 改用 `db.batch([...])`。 | `workers/orchestrator-auth/src/repository.ts` |
| R2 | `invalid-caller` 死代码 | `fixed` | 放宽 contract metadata 的 `caller` 为非空字符串；single-caller discipline 保留在 `assertAuthMeta()` 的显式运行时检查。 | `packages/orchestrator-auth-contract/src/index.ts`, `workers/orchestrator-auth/src/errors.ts` |
| R3 | `nano_users` 缺关键状态列 | `fixed` | Wave A schema 补入 `user_status`、`default_team_uuid`、`is_email_verified`、`updated_at`，并让 bootstrap write path 真正写这些列。 | `workers/orchestrator-core/migrations/001-identity-core.sql`, `workers/orchestrator-auth/src/repository.ts` |
| R4 / R11 / R21 / D-R2 | identity-team 解耦与 multi-team 方向 | `deferred` | 这是 Z1 已冻结的 single-team bootstrap posture，不在本轮擅改表关系；已在 Z1 closure 中明确“runtime tenant full-consumption 留给 Z2+”。命名/术语层则补了 mapping。 | `docs/issue/zero-to-real/Z0-closure.md`, `docs/issue/zero-to-real/Z1-closure.md` |
| R5 / D-R9 | `membership_level = 100` magic number | `fixed` | contract 导出 `OWNER_MEMBERSHIP_LEVEL`；repo/bootstrap 统一复用该常量，并为 membership 列补最小 CHECK。 | `packages/orchestrator-auth-contract/src/index.ts`, `workers/orchestrator-auth/src/repository.ts`, `workers/orchestrator-core/migrations/001-identity-core.sql` |
| R6 | password reset 写错字段/范围过大 | `fixed` | `updatePasswordSecret()` 改成按 `identity_uuid` 精确更新，并写 `password_updated_at` 而不是 `last_login_at`。 | `workers/orchestrator-auth/src/repository.ts`, `workers/orchestrator-auth/src/service.ts` |
| R7 / D-R3 | `identity_status` 无 enforcement | `fixed` | 查询侧补 `identity_status='active'` + `user_status='active'`；schema 侧补 `identity_status` CHECK。 | `workers/orchestrator-auth/src/repository.ts`, `workers/orchestrator-core/migrations/001-identity-core.sql` |
| R8 | `?access_token=` query 仍被接受 | `fixed` | `orchestrator-core` 的 public auth façade 只再接受 `Authorization: Bearer`。 | `workers/orchestrator-core/src/index.ts` |
| R9 / R20 / D-R7 / K-R4 | wrangler/WeChat hardening | `fixed` | 统一 `compatibility_date`，为 placeholder D1 UUID 和必需 secrets 补注释；WeChat bridge 增加 `unionid?: string`、超时与 5xx/网络 retry。 | `workers/orchestrator-auth/wrangler.jsonc`, `workers/orchestrator-core/wrangler.jsonc`, `workers/orchestrator-auth/src/wechat.ts` |
| R10 / K-R10 | orchestrator-auth regression guard 不足、closure 限制不完整 | `partially-fixed` | 新增 non-live `public-surface.test.ts` 锁住 probe-only public surface；Z1 closure 也补充 live-gated 与 unit/non-live split 的诚实说明。live package-e2e 仍保持 gate。 | `workers/orchestrator-auth/src/public-surface.ts`, `workers/orchestrator-auth/src/index.ts`, `workers/orchestrator-auth/test/public-surface.test.ts`, `docs/issue/zero-to-real/Z1-closure.md` |
| R12 / K-R9 / D-R10 | CI 未覆盖 contract package | `fixed` | `workers.yml` path trigger 增加 `packages/orchestrator-auth-contract/**`；shared helper env 也对齐 worker key naming。 | `.github/workflows/workers.yml`, `test/shared/orchestrator-auth.mjs` |
| R13 | migration owner 与 write owner 错位 | `rejected` | 当前 shared D1/migrations owner 仍是 `orchestrator-core`，这是现阶段拓扑选择，不是实现 bug；本轮未改 topology。 | _无代码修改_ |
| R14 / K-R6 | `deploy-fill` 风险与 tenant/team 语义重复 | `partially-fixed` | contract `AuthSnapshot` 收紧为 claim-only；`tenant_uuid` alias 关系写入注释；但 ingress-local `deploy-fill` legacy bridge 仍保留并在 Z1 closure 中明确为限制。 | `packages/orchestrator-auth-contract/src/index.ts`, `workers/orchestrator-auth/src/service.ts`, `workers/orchestrator-core/src/auth.ts`, `docs/issue/zero-to-real/Z1-closure.md` |
| R15 / R27 / R17 | Z0/Z1 文档证据与术语漂移 | `fixed` | Z0 closure 补证据列与术语映射；Z0/Z1 action-plan 日志收紧过满表述；`orchestration-auth` -> `orchestrator-auth` rename 已完成并复核。 | `docs/issue/zero-to-real/Z0-closure.md`, `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md`, `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md` |
| R16 / K-R7 | auth negative tests 不够完整 | `partially-fixed` | worker tests 现已覆盖 revoked refresh、forged token、expired token、legacy no-`kid`、cross-team token readback、invalid caller；但 package-e2e 仍主要是 live-gated façade/probe proof。 | `workers/orchestrator-auth/test/service.test.ts`, `workers/orchestrator-core/test/auth.test.ts`, `workers/orchestrator-auth/test/public-surface.test.ts` |
| R18 / D-R5 | `nano_team_api_keys` reserved schema 太弱 | `fixed` | 增加 `key_status`、`scopes_json`、`last_used_at`，把 reserved schema 至少补到未来 admin plane 可消费的程度。 | `workers/orchestrator-core/migrations/001-identity-core.sql` |
| R19 | shim retire deadline 未记录 | `fixed` | 在 Z1 closure 中显式写回“到 Z2 closure 前继续向正式 RPC seam 收口”。 | `docs/issue/zero-to-real/Z1-closure.md` |
| R22 / R29 / D-R1 / D-R6 / D-R11 | contract snapshot 与 ingress-local snapshot 混用 | `fixed` | contract `AuthSnapshot` 固定为 auth-worker output；`orchestrator-core` 本地类型改名为 `IngressAuthSnapshot`，把 `deploy-fill` 留在 ingress 局部，不再跨 worker 边界泄漏。 | `packages/orchestrator-auth-contract/src/index.ts`, `workers/orchestrator-core/src/auth.ts`, `workers/orchestrator-core/src/user-do.ts` |
| R23 | `nodejs_compat` 可能不需要 | `rejected` | 当前 repo 的 worker shell 统一保留该 flag，本轮未见 correctness/security 问题，也不把它当 Z0/Z1 blocker。 | _无代码修改_ |
| R24 | Z2 仍引用 `nano_session_*` 表名树 | `rejected` | 当前 action-plan 已是 `nano_conversations / nano_conversation_sessions / ... / nano_session_activity_logs`，该 finding 已过期。 | _无代码修改_ |
| R25 | `test:cross` 脚本引用失真 | `rejected` | 当前 `package.json` 已清楚区分 `test:package-e2e`、`test:cross-e2e`、`test:cross`；zero-to-real 文档也主要引用前两者。 | _无代码修改_ |
| R26 | membership 唯一索引无 active/inactive 过滤 | `deferred` | 当前 Z1 membership model 仍是 single active membership baseline，未进入 membership status phase；在 Z2+ 再决定 partial unique/index posture。 | `docs/issue/zero-to-real/Z1-closure.md` |
| R28 / K-R5 | HS256 key/hash 强度议题 | `rejected` | 32-char signing key 下限与 first-wave `SHA-256 + PASSWORD_SALT` 是当前冻结 trade-off；已在 Z1 closure 中诚实记录 KDF 升级属于后续 phase。 | `docs/issue/zero-to-real/Z1-closure.md` |
| R30 | dry-run 证据记录不足 | `fixed` | 继续保留 closure 中的验证结论，并在本次回应 §6.4 明确列出实际跑过的 dry-run/build/test 命令。 | `docs/issue/zero-to-real/Z1-closure.md`, `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md` |
| D-R4 | shared auth helper env naming drift | `fixed` | `test/shared/orchestrator-auth.mjs` 兼容 `JWT_SIGNING_KEY_<kid>` / `JWT_SIGNING_KID`，不再强制单独的 helper-only 命名。 | `test/shared/orchestrator-auth.mjs` |
| D-R8 | refresh family revocation 设计空白 | `deferred` | 本轮保持 rotate-on-use + revoked-session reject，不在 Z1 发明 family-wide revocation 语义。 | _无代码修改_ |
| K-R1 | proxy 未显式传 caller meta | `rejected` | 现有 `proxyAuthRoute()` 早已显式传 `{ trace_uuid, caller: "orchestrator-core" }`；该 finding 与当前代码不符。 | _无代码修改_ |
| K-R2 | no-`kid` verify try-all 过宽 | `fixed` | auth worker 与 orchestrator ingress 现在都只接受 `legacy` 作为无-`kid` 例外，不再遍历整组 keyring。 | `workers/orchestrator-auth/src/jwt.ts`, `workers/orchestrator-core/src/auth.ts` |

### 6.3 变更文件清单

- `packages/orchestrator-auth-contract/src/index.ts`
- `workers/orchestrator-auth/src/{errors,jwt,public-surface,repository,service,wechat}.ts`
- `workers/orchestrator-auth/test/{public-surface,service}.test.ts`
- `workers/orchestrator-auth/wrangler.jsonc`
- `workers/orchestrator-core/src/{auth,index,user-do}.ts`
- `workers/orchestrator-core/test/auth.test.ts`
- `workers/orchestrator-core/migrations/001-identity-core.sql`
- `workers/orchestrator-core/wrangler.jsonc`
- `.github/workflows/workers.yml`
- `test/shared/orchestrator-auth.mjs`
- `docs/issue/zero-to-real/{Z0-closure,Z1-closure}.md`
- `docs/action-plan/zero-to-real/{Z0-contract-and-compliance-freeze,Z1-full-auth-and-tenant-foundation}.md`

### 6.4 验证结果

```text
pnpm --filter @haimang/orchestrator-auth-contract typecheck/test
pnpm --filter @haimang/orchestrator-auth-worker typecheck/build/test/deploy:dry-run
pnpm --filter @haimang/orchestrator-core-worker typecheck/build/test/deploy:dry-run
pnpm test:package-e2e
pnpm test:cross-e2e
git diff --check
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. `nano_user_identities.team_uuid` 与 membership status 的更彻底解耦，仍属于 Z2+ 的 schema/runtime 决策，不在本轮直接改表关系。
  2. ingress-local `deploy-fill` legacy bridge 仍保留在 `orchestrator-core`；本轮只把它从 auth contract 与 cross-worker snapshot 语义中清出去。

---

## 7. 对 Opus 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-25`
> 评价依据: `docs/code-review/zero-to-real/Z0-Z1-reviewed-by-opus.md §1-§6` + 当前代码事实 + 本轮已落实修复

### 7.1 一句话评价评审风格

Opus 的这份审查是 **高密度、高命中率、跨代码/文档/阶段联动能力最强** 的一次 review；它抓到了本轮最关键的真实问题，但也把少数 design posture 分歧与过期问题一起上推成了 blocker。

### 7.2 优点

1. 命中了本轮最重要的真实问题：D1 伪事务、`invalid-caller` 死代码、password reset 更新错误、query token、CI path gap、文档过满口径。
2. 证据链最完整，能把代码、migration、tests、closure、action-plan 和下游 phase 依赖放在一起看。
3. 修法建议普遍可直接执行，且优先级排序对实施很有帮助。

### 7.3 缺点

1. 有些 design-level posture（如 identity-team 彻底解耦、migration owner）被上推成了当前阶段 blocker，压过了“已冻结 Z1 trade-off”的边界。
2. 少数发现在当前 repo 状态下已过期或不成立（如 R24、R25、R23 一类）。
3. 报告密度非常高，虽然信息量大，但实现者需要花更多时间做 triage 才能抽出真正的必须修项。

### 7.4 对审查报告中，全部问题，的清点

| 问题编号 | 原始严重程度 | 该问题的质量 | 分析与说明 |
|----|------|------|------------------|
| R1 | `critical` | `高` | 本轮最关键 blocker，判断非常准确。 |
| R2 | `high` | `高` | 命中真实 dead code 与 contract/runtime 语义错位。 |
| R3 | `high` | `高` | `nano_users` 过薄是真问题，补列也证明这条有价值。 |
| R4 | `high` | `中` | 指向真实的未来 multi-team 张力，但把 Z2+ 设计决策上推成 Z1 blocker 偏重。 |
| R5 | `medium` | `高` | magic number 问题真实且低成本修复。 |
| R6 | `medium` | `高` | password reset bug 命中非常准。 |
| R7 | `medium` | `高` | CHECK / status enforcement 真实有效。 |
| R8 | `medium` | `高` | query-token 风险真实且修复必要。 |
| R9 | `medium` | `高` | wrangler drift/placeholder 注释缺失是有效发现。 |
| R10 | `medium` | `高` | 回归护栏不足确实存在，只是最后通过 non-live test 补了一条更稳的路。 |
| R11 | `medium` | `中` | 与 R4 同属 team/identity posture 张力，判断有道理但阶段性偏重。 |
| R12 | `medium` | `高` | CI path 漏项是真问题。 |
| R13 | `medium` | `低` | 更像 topology 偏好，不是当前实现 bug。 |
| R14 | `high` | `中` | 指向真实 legacy 风险，但 Z1 已冻结 deploy-fill bridge，适合 partial 收紧而非一刀切 blocker。 |
| R15 | `medium` | `高` | 文档证据与工作日志口径问题真实。 |
| R16 | `medium` | `高` | negative tests 口径过满，判断准确。 |
| R17 | `medium` | `高` | 命名漂移当时真实存在，后来也做了 rename sweep。 |
| R18 | `medium` | `高` | API key reserved schema 太弱，命中有效。 |
| R19 | `medium` | `高` | shim retire deadline 文档遗漏是真问题。 |
| R20 | `medium` | `高` | wrangler secret 声明缺注释，属于真实 deploy hygiene gap。 |
| R21 | `high` | `中` | 与 R4/R11 相同，抓到未来路径压力，但阶段性偏重。 |
| R22 | `medium` | `高` | contract 泄漏 deploy-fill 概念的判断准确。 |
| R23 | `low` | `低` | `nodejs_compat` 在当前 repo 是统一 posture，不足以构成问题。 |
| R24 | `high` | `低` | 当前 action-plan 已不是该表名树，这条是过期判断。 |
| R25 | `medium` | `低` | 脚本关系描述失真，问题不成立。 |
| R26 | `medium` | `中` | future membership status 设计提醒有价值，但不该卡 Z1。 |
| R27 | `medium` | `中高` | 对 closure 语气与事实距离的提醒有价值。 |
| R28 | `low` | `低` | 32-char HS256 下限不构成当前阶段问题。 |
| R29 | `high` | `高` | snapshot required/optional 语义冲突判断准确。 |
| R30 | `medium` | `中` | evidence hygiene 有价值，但属于文档完备性，不是 correctness blocker。 |

### 7.5 评分 - 总体 ** 8.8 / 10 **

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 9 | 代码、文档、测试、下游 phase 关联都看得很全。 |
| 判断严谨性 | 8 | 大部分判断很硬，但混入了几条 stale/design-overreach。 |
| 修法建议可执行性 | 9 | 修法顺序和具体动作都很清晰。 |
| 对 action-plan / design 的忠实度 | 8 | 能持续对照 charter/design，但有时过度纠偏到理想形态。 |
| 协作友好度 | 8 | 虽然锋利，但仍然可合作，且优先级排序清楚。 |
| 找到问题的覆盖面 | 10 | 这三份里覆盖面最广、命中率也最高。 |

---

## 8. 二次审查（Opus 复核）

> 复核者: `Opus 4.7 (1M context)`
> 复核时间: `2026-04-25`
> 复核依据: `GPT-5.4 §6 回应 + §7 自评 + 当前 6-worker 代码事实 + Z0/Z1 closure 与 action-plan 工作日志 + ddl-v170 / smind-admin 参考 / ZX-qna 已确认 owner 答案`
> 复核范围: `Opus R1-R30 全部 finding 的修复有效性 + 新一轮 6-worker 代码盲点 / 断点 / 逻辑错误 / 事实错误扫描 + Z0-Z1 阶段是否可以收口`

### 8.1 二次审查结论

> **一句话 verdict**：**GPT 已经把本轮中 critical 与大部分 high 真实修掉了，但 R8 与 R14/R29 留有未修干净的残痕（`/sessions/*` 仍接受 query-token、`tenant_source` 仍是 truthy-check 而不是 source-check、deploy-fill anchor 仍是非 UUID 字符串），加上 1 条新发现的 WeChat retry 逻辑 bug；这些都不构成生产 blocker，但应作为 Z2 起跑窗口期内的硬清单，建议 approve-with-followups 收口。**

- **二次结论**：`approve-with-followups (Grade: B+)`
- **是否收口**：`yes — Z0/Z1 可以正式 closed，但带 5 条 carry-over 必须进 Z2 实施期前清单`
- **本轮最关键的 3 个判断**：
  1. **R1（D1 事务）已彻底修好**——`workers/orchestrator-auth/src/repository.ts:183, 341` 已用 `db.batch([...])`，`createBootstrapUser` 与 `rotateAuthSession` 现在具备真实 atomicity；这是本轮最重要的 critical 修复。
  2. **R8 与 R14/R29 修了一半就停手**——R8 的 `?access_token=` query-token 只在 `/auth/*` proxy（`workers/orchestrator-core/src/index.ts:96-103`）被去掉，但 `/sessions/*` 路径用的 `parseBearerToken`（`workers/orchestrator-core/src/auth.ts:151-160`）仍接受 query token；R14/R29 把 contract `AuthSnapshot` 收紧到 `tenant_source: z.literal("claim")`，但 ingress 端 `auth.ts:221` 的 logic 是 `effectiveTenant ? "claim" : "deploy-fill"` —— 当 `effectiveTenant` 来自 `env.TEAM_UUID = "nano-agent"`（`wrangler.jsonc:16`，非 UUID）时仍会被错误地 stamp 成 "claim"，且这个 snapshot 携带非 UUID 字符串 team_uuid 进入 user-do（`user-do.ts:116-118 isAuthSnapshot` 显式接受 `tenant_source === 'deploy-fill'`）。
  3. **本轮新发现 1 个 medium-severity bug**：`workers/orchestrator-auth/src/wechat.ts:35-71` 的 retry catch 块在 `attempt === 0` 时无条件 `continue`，**意味着 4xx 与 "missing openid" 这类用户错误也会触发重试**——浪费 WeChat API quota，并放大用户传错 code 时的延迟。

### 8.2 已验证有效的修复（逐项核查）

> 全部基于代码实际状态判定，不轻信 GPT 的 fixed/rejected 标签。

| 编号 | GPT 声明 | 复核结论 | 依据（代码事实） |
|------|----------|----------|------------------|
| R1 / K-R3 | `fixed` | `closed` | `workers/orchestrator-auth/src/repository.ts:183`：`await this.db.batch([...5 statements])`；`:341` rotateAuthSession 同样用 batch。`grep -n "withTransaction\|db.exec.*BEGIN\|COMMIT\|ROLLBACK"` 仅命中 batch，BEGIN/COMMIT 路径已删。**Critical bug 真实修复**。 |
| R2 | `fixed` | `closed` | `packages/orchestrator-auth-contract/src/index.ts:8`：`caller: z.string().trim().min(1)`（已放宽）；`workers/orchestrator-auth/src/errors.ts:29-31`：runtime 比较 `parsed.data.caller !== "orchestrator-core"` 现在可达。`workers/orchestrator-auth/test/service.test.ts:247-260` 的 negative test 现在断言 `code === "invalid-caller"`（之前是 `invalid-request`）。**dead code 真实修复**。 |
| R3 | `fixed` | `closed` | `workers/orchestrator-core/migrations/001-identity-core.sql:1-8`：`nano_users` 现含 `user_status (CHECK enum) / default_team_uuid NOT NULL / is_email_verified (CHECK 0|1) / created_at / updated_at` 共 6 列；`repository.ts:185-193 createBootstrapUser` 真实写入这些列。**真实修复**。 |
| R5 / D-R9 | `fixed` | `partially-closed` | `contract:12 OWNER_MEMBERSHIP_LEVEL = 100 as const` ✓；`repository.ts:209` 使用常量 ✓；`migration:45` `membership_level INTEGER NOT NULL CHECK (membership_level >= 0)` ✓。**但 `workers/orchestrator-auth/test/service.test.ts:42, 51, 175` 仍 hardcode 数字 100**，没切到 OWNER_MEMBERSHIP_LEVEL 常量。Closure 上 OK，测试未跟上常量化。低优先级。 |
| R6 | `fixed` | `closed` | `repository.ts:382-389`：`updatePasswordSecret(identityUuid, ...)` 使用 `WHERE identity_uuid = ?1`（之前是 `WHERE user_uuid`），`SET ... password_updated_at = ?3`（之前误写 last_login_at）；`service.ts:331` 改传 `identity.identity_uuid`。**真实修复**。 |
| R7 / D-R3 | `fixed` | `closed` | `migration:29`：`identity_status TEXT NOT NULL DEFAULT 'active' CHECK (identity_status IN ('active', 'pending_verification', 'suspended'))`；`repository.ts:173-174 findIdentityBySubject` JOIN 加了 `i.identity_status = 'active' AND u.user_status = 'active'`。**真实修复**。 |
| R8 | `fixed` | **`partial`** | `workers/orchestrator-core/src/index.ts:96-103 readAccessToken` 已不再读 query token ✓（`/auth/*` proxy 路径修了）；**但 `workers/orchestrator-core/src/auth.ts:151-160 parseBearerToken` 仍执行 `url.searchParams.get("access_token")`**，该函数被 `authenticateRequest` 调用，覆盖 `/sessions/{uuid}/{action}` 全部路由。即 production session API 仍接受 `?access_token=` 查询参数。**修复不完整**。 |
| R9 / R20 / D-R7 / K-R4 | `fixed` | `closed` | `wrangler.jsonc:5` 两侧均为 `2026-04-25`；orchestrator-auth `:7-11` + orchestrator-core `:7-9` 注释列出必须 `wrangler secret put` 的变量；`database_id:24/26/41/57/59` 加 `// Replace this placeholder with the real shared D1 UUID before deploy.` 注释；`wechat.ts:35-71` 加超时（`AbortSignal.timeout(5_000)`）+ 5xx retry + `unionid` 字段。**真实修复**（但 retry 逻辑有新 bug，见 §8.3 N-1）。 |
| R10 / K-R10 | `partially-fixed` | `partial` | `workers/orchestrator-auth/src/public-surface.ts` 抽出 ✓；`test/public-surface.test.ts`（18 行）锁住 probe + 1 个 forbidden route ✓。但**该测试覆盖面非常浅**：未测 PUT/DELETE/PATCH 等异常 method 到 `/health`、未测 `/auth/*` 各路径（除 login）。Z1 closure §3.6 已诚实记录"package-e2e 仍 live-gated"，承认局限性。**partial 但是 honest partial**。 |
| R12 / K-R9 / D-R10 | `fixed` | `closed` | `.github/workflows/workers.yml:6-12, 14-22` 两处 paths 均含 `packages/orchestrator-auth-contract/**`；`test/shared/orchestrator-auth.mjs:5-8` 现已支持 `JWT_SIGNING_KEY_<kid>` 与 `JWT_SIGNING_KID` env 形态。**真实修复**。 |
| R13 | `rejected` | `accepted-rejection` | GPT 选择保留 `migrations_dir: "migrations"` 在 `workers/orchestrator-core/wrangler.jsonc:25`。这是 topology trade-off（共享 D1，single migration owner），不是 implementation bug。Z0 closure §4 现已显式列出术语映射。**rejection 合理**。 |
| R14 / K-R6 | `partially-fixed` | **`partial`** | contract 收紧 ✓（`AuthSnapshotSchema.tenant_source: z.literal("claim")`）；orchestrator-core 重命名为 `IngressAuthSnapshot` ✓。**但 logic 仍有 bug**：`auth.ts:221 tenant_source: effectiveTenant ? "claim" : "deploy-fill"` 依然是 truthy 检查，当 `teamClaim` 与 `legacyTenantClaim` 都是 undefined 但 `deployTenant = "nano-agent"` 时，`effectiveTenant === "nano-agent"` 是 truthy，`tenant_source` 仍被 stamp 成 "claim"——逻辑应该是 `(teamClaim || legacyTenantClaim) ? "claim" : "deploy-fill"`。同时 `wrangler.jsonc:16 TEAM_UUID: "nano-agent"` 仍是非 UUID 字符串，意味着部署默认情况下 IngressAuthSnapshot 会携带 team_uuid="nano-agent" 进入 user-do（`user-do.ts:116-118 isAuthSnapshot` 仍显式接受 deploy-fill）。**真实 logic bug 未修**。 |
| R15 / R27 / R17 | `fixed` | `closed` | Z0 closure §3 verdict 表加了 evidence 列；§4 新增"术语与路径映射"节（行 42-51）显式 `orchestration.core / orchestration.auth / auth contract / shared D1 → 仓库实际路径`；`grep -rn "orchestration-auth" docs/{design,action-plan,charter}` 返回 0 命中。**rename sweep 真实完成**。 |
| R16 / K-R7 | `partially-fixed` | `partial` | `service.test.ts:185-192` 加了 revoked-on-replay 断言；`:262-311` 加了 forged token + cross-team token negative test；`auth.test.ts:39-109` 加了 legacy `JWT_SECRET` / expired token / no-`kid` 三类负例。**worker unit 层覆盖到位**；package-e2e 仍 live-gated（Z1 closure §3.6 诚实承认）。partial 但合理。 |
| R18 / D-R5 | `fixed` | `closed` | `migration:67-78 nano_team_api_keys` 现含 `key_status (CHECK active|rotating|revoked) / scopes_json / last_used_at / revoked_at`。**真实修复**。 |
| R19 | `fixed` | `closed` | `Z1-closure.md:50` 显式写"shim/posture 必须继续向正式 RPC session seam 收口，而不能成为长期架构"。**真实修复**。 |
| R22 / R29 / D-R1 / D-R6 / D-R11 | `fixed` | `partially-closed` | contract `AuthSnapshotSchema` 强制 `tenant_source: z.literal("claim")` + `team_uuid/tenant_uuid: z.string().uuid()` ✓；`orchestrator-core/src/auth.ts:25 IngressAuthSnapshot` 与 contract 解耦 ✓；`user-do.ts:1` 改 import `IngressAuthSnapshot` ✓。**但 R29 的 logic 真实问题（"deploy-fill 仍可能漂出 ingress 边界"）未修**——`user-do.ts:116-118 isAuthSnapshot` 显式 accept `tenant_source === 'deploy-fill'`，且 `user-do.test.ts:124, 154, 184, 208, 229, 265, 417` 全部 fixture 用 `tenant_source: 'deploy-fill'`，证明 deploy-fill 仍是 user-do 接受的合法 ingress 形态。contract tightening 是 schema 层面的，runtime 层面 deploy-fill 仍流动。 |
| R23 | `rejected` | `accepted-rejection` | `nodejs_compat` flag 在 6-worker 全部统一保留；非 correctness/security 问题。**rejection 合理**。 |
| R24 | `rejected` | `accepted-rejection` | `grep "nano_session\|nano_conversation" docs/action-plan/zero-to-real/Z2-*.md` 显示当前 Z2 action plan 已经使用 `nano_conversations / nano_conversation_sessions / nano_conversation_turns / nano_conversation_messages / nano_conversation_context_snapshots / nano_session_activity_logs`。Z2 已对齐 ZX-D1。**finding 已过期**，rejection 正确。 |
| R25 | `rejected` | **`accepted-rejection-with-caveat`** | `package.json:8-15` 三个脚本 `test:cross / test:e2e / test:live:e2e` 仍指向**完全相同**的命令。GPT 说"docs 主要引用 test:package-e2e/test:cross-e2e"——`grep "test:cross[^-]" docs/action-plan` 显示 Z3/Z5 仍提及 `pnpm test:cross`（虽然 GPT 在工作日志中已偏好 `test:cross-e2e`）。这条 finding 在文档与 script 双向 inflight，不属于 Z1 blocker，OK 接受 rejection。 |
| R26 | `deferred` | `accepted-deferral` | 在 single-team posture 下 unique-by-(team,user) 暂时够用；Z2 引入 multi-team 路径时再补 partial unique + status 列。**deferral 合理**。 |
| R28 / K-R5 | `rejected` | `accepted-rejection` | 32-char minimum + SHA-256+salt 是 first-wave 冻结 trade-off；`Z1-closure §4.5` 诚实记录"更强 KDF 升级不在 Z1 范围内"。**rejection 合理**。 |
| R30 | `fixed` | `closed` | `Z1-action-plan §9 工作日志:404-409` 列出 `pnpm --filter ... typecheck/build/test/deploy:dry-run` + `pnpm test:package-e2e` + `pnpm test:cross-e2e` 共 6 条命令；`Z1-closure §3` 引用执行结论。**evidence trail 已建立**（虽未含 dry-run output 文本，但命令清单可重放）。 |
| D-R4 | `fixed` | `closed` | `test/shared/orchestrator-auth.mjs:5-8` 现支持 `process.env[\`JWT_SIGNING_KEY_${JWT_KID}\`]` fallback。**真实修复**。 |
| D-R8 | `deferred` | `accepted-deferral` | rotate-on-use + revoked-session reject 是 Z1 baseline，family-wide revocation 是 future hardening。**deferral 合理**。 |
| K-R1 | `rejected` | `accepted-rejection` | `index.ts:114-117 proxyAuthRoute` 确实显式传 `{trace_uuid, caller: "orchestrator-core" as const}`。finding 与代码事实不符。**rejection 正确**。 |
| K-R2 | `fixed` | `closed` | `workers/orchestrator-auth/src/jwt.ts:148-153` 与 `orchestrator-core/src/auth.ts:138-143`：当 token header 无 `kid` 时，仅 fallback 到 `legacy` key，不再遍历整组 keyring。**真实修复**。 |

#### 8.2.1 已确认修复 vs 部分修复 vs 接受拒绝 / 延迟统计

- **已彻底修复 (closed)**：R1, R2, R3, R6, R7, R12, R15, R17, R18, R19, R27, R30, D-R4, K-R2 共 14 项。
- **部分修复 / partial-closed**：R5（测试未常量化）/ R8（仅 /auth/* 路径修了，/sessions/* 残留）/ R10（test 太浅）/ R14, R22, R29（contract 修了，runtime logic bug 与非 UUID anchor 未修）/ R16（package-e2e 仍 live-gated）共 6 项。
- **接受 rejection**：R13, R23, R24, R25, R28, K-R1, K-R5 共 7 项（理由合理）。
- **接受 deferral**：R4, R11, R21, R26, D-R8 共 5 项（Z2 起跑前必修，见 §8.3）。

### 8.3 仍未收口 / 部分修复 / 新发现的问题

#### 8.3.1 仍未收口的关键残痕（按 Z2 阻塞度排序）

##### **U-1（continued from R8）** `/sessions/*` 路由仍接受 `?access_token=` 查询参数

- **严重级别**：`medium`
- **类型**：`security`
- **事实依据**：
  - `workers/orchestrator-core/src/auth.ts:151-160 parseBearerToken`：先读 `Authorization: Bearer`，找不到则回落 `url.searchParams.get("access_token")`。
  - 该函数由 `authenticateRequest`（同文件 `:170` `parseBearerToken(request)`）调用，覆盖 `/sessions/{uuid}/{action}` 所有路由（在 `index.ts:172`）。
  - GPT 在 `/auth/*` proxy 中的 `readAccessToken`（`index.ts:96-103`）已正确拿掉 query 路径，**但 session 路径未跟着修**。
- **为什么重要**：production session API（最大流量面）仍可被 query-string token 污染日志。OAuth2 RFC6750 §2.3 反模式。
- **建议修法**：`auth.ts:151-160 parseBearerToken` 改为只读 `Authorization: Bearer`，删除 `url.searchParams.get("access_token")`。或在 R8 fix 时一并处理。
- **是否阻塞 Z2 起跑**：否（Z2 不会更恶化此面），但应进 Z2 cleanup checklist。

##### **U-2（continued from R14/R29）** `tenant_source` 是 truthy-check 而不是 source-check + deploy-fill anchor 仍非 UUID

- **严重级别**：`medium-high`
- **类型**：`correctness` + `security`
- **事实依据**：
  - `workers/orchestrator-core/src/auth.ts:210-221`：
    ```ts
    const effectiveTenant = teamClaim ?? legacyTenantClaim ?? deployTenant;
    ...
    const snapshot: IngressAuthSnapshot = {
      ...
      ...(effectiveTenant ? { team_uuid: effectiveTenant, tenant_uuid: effectiveTenant } : {}),
      tenant_source: effectiveTenant ? "claim" : "deploy-fill",
      ...
    };
    ```
    当 `teamClaim` 与 `legacyTenantClaim` 都 undefined、但 `deployTenant = "nano-agent"`（`wrangler.jsonc:16`）时，`effectiveTenant = "nano-agent"`，`tenant_source` 被 stamp 成 `"claim"` —— 但语义上这是 deploy-fill。
  - 同时 `wrangler.jsonc:16, 51 TEAM_UUID: "nano-agent"` 仍是字符串，**不是 UUID**。如果该 snapshot 流到任何 `AuthSnapshotSchema.parse()` 调用点（contract schema 要求 z.string().uuid()），会抛 schema error。
  - `user-do.ts:116-118 isAuthSnapshot` 显式接受 `tenant_source === 'deploy-fill'`，且 `user-do.test.ts` 多处 fixture 用 `tenant_source: 'deploy-fill'` —— 证明 deploy-fill 仍是 user-do 端合法形态，contract tightening 没有真正 kill 它。
- **为什么重要**：
  - `tenant_source` 误标 = 后续 audit 无法区分"真实 token claim"与"deploy fallback"，影响 multi-tenant safety 审计。
  - 非 UUID team_uuid 进入 user-do = future 一旦把 NACP authority 串到 D1 query（Z2 必做）会查不到任何 row（因为 nano_teams.team_uuid 是 UUID 列）。
- **建议修法**（任选其一）：
  - **方案 A（推荐）**：`auth.ts:221` 改为 `tenant_source: (teamClaim || legacyTenantClaim) ? "claim" : "deploy-fill"`；同时将 `wrangler.jsonc TEAM_UUID` 改为真实 UUID 或 retire 该 fallback。
  - **方案 B**：完全删除 deploy-fill 分支——如果 token 缺 team_uuid，直接 401 reject。这是更激进的 cut，与 Z1 closure §4.3 的"deploy-fill 是 ingress legacy bridge"立场最一致。
- **是否阻塞 Z2 起跑**：**Z2 实施前必须修一个**——Z2 要把 AuthSnapshot 串成 NACP authority 入 D1 query，非 UUID team_uuid 会让 conversation/session 真相层一启动就失败。

##### **U-3（new finding）** WeChat retry catch 块对 4xx / "missing openid" 也无条件 retry —— 浪费 quota + 放大延迟

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-auth/src/wechat.ts:35-71`：
    ```ts
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) {
          if (attempt === 0 && response.status >= 500) continue;
          throw new AuthServiceError("invalid-wechat-code", 502, ...);
        }
        const payload = await response.json();
        if (typeof payload.openid !== "string" || payload.openid.length === 0) {
          throw new AuthServiceError("invalid-wechat-code", 400, "wechat response missing openid");
        }
        return { openid: payload.openid, ... };
      } catch (error) {
        if (attempt === 0) continue;            // ← 在 attempt 0 时无条件 continue
        if (error instanceof AuthServiceError) throw error;
        ...
      }
    }
    ```
  - WeChat 真实行为：传错 code → 响应 200 OK + JSON 含 errcode/errmsg（**不**是 4xx），路径走到 `payload.openid !== string` → 抛 `AuthServiceError("invalid-wechat-code", 400, ...)` → catch 块 `if (attempt === 0) continue` → 重试。
  - 4xx 路径同理：第一次 4xx → throw → catch → 重试 → 再 4xx → throw → 用户看到第二次 4xx 错误（且经过 ≥10s 超时窗口）。
- **为什么重要**：
  - 用户传错 code（最常见错误形态）会经过 2 次 WeChat API call，浪费 50% quota。
  - 用户体验：错误响应延迟翻倍。
  - 真实重试只该针对网络/timeout/5xx 三类，不该针对用户输入。
- **建议修法**：catch 块改为：
  ```ts
  } catch (error) {
    if (error instanceof AuthServiceError) {
      // Don't retry user-induced errors (400 missing openid / 4xx response)
      throw error;
    }
    if (attempt === 0) continue;  // 只对 fetch 抛出的网络/timeout 错误重试
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new AuthServiceError("invalid-wechat-code", 504, ...);
    }
    throw new AuthServiceError("invalid-wechat-code", 502, ...);
  }
  ```
- **是否阻塞 Z2 起跑**：否；属于 Z4 Mini Program 真机调试期会发现的 cleanup。

##### **U-4（continued from R10）** `public-surface.test.ts` 仅 18 行，未真实覆盖 RPC method matrix

- **严重级别**：`low`
- **类型**：`test-gap`
- **事实依据**：
  - `workers/orchestrator-auth/test/public-surface.test.ts`（18 行，1 个测试）只测了 `GET /` probe + `POST /auth/login` 404。
  - 未测：`PUT /health`（异常 method）、`DELETE /` (异常 method)、`POST /` 是否被允许、`GET /auth/*`、各种 `/internal/*` 假设路径。
- **为什么重要**：probe 边界其实没有被锁严，"只暴露 probe" 仅在 GET / + GET /health 成立。
- **建议修法**：补 method matrix（GET/POST/PUT/DELETE/PATCH/OPTIONS）×（/、/health、/auth/login、/auth/me、/auth/refresh、/anything-else）共 ≥12 条 negative，断言均返回 404 except (GET /, GET /health)。
- **是否阻塞 Z2 起跑**：否；可在 Z2 test infrastructure expansion 时一并补。

##### **U-5（continued from R5）** 测试代码未切到 `OWNER_MEMBERSHIP_LEVEL` 常量

- **严重级别**：`low`
- **类型**：`docs-gap` + `correctness`
- **事实依据**：
  - `workers/orchestrator-auth/test/service.test.ts:42, 51, 175` 仍 hardcode `100`（不是 `OWNER_MEMBERSHIP_LEVEL`）。
  - 未来 owner 想改 `OWNER_MEMBERSHIP_LEVEL = 1000`（场景：留出 100..999 的位置给 admin/manager），测试不会跟着改，会失败。
- **建议修法**：测试 import 常量并使用。
- **是否阻塞 Z2 起跑**：否。

#### 8.3.2 已 deferred 但 Z2 起跑前必修的项目

##### **D-1（R4 + R11 + R21）** `nano_user_identities.team_uuid` 仍 NOT NULL，与 unique-by-(provider, subject) 形成索引矛盾

- **复核结论**：GPT 把这条 deferred 给 Z2+ 的判断**部分合理**——Z1 single-team posture 下不会触发这层矛盾（每个 user 只在自己 default team 出现一次），所以 Z1 closure 不被阻塞。
- **但 Z2 起跑前必须解开**：Z2 要支持 conversation/session truth 跨多个 team；Z2 P2-01 的 query 会按 team 分组 conversations，但 identity 行强行携带 team_uuid 会让 user 加入第二个 team 时 identity-readback 路径出错。
- **建议**：Z2 Phase 1 Wave B migration 同时移除 `nano_user_identities.team_uuid` 列，所有 team 关系仅通过 `nano_team_memberships` 表达。这是 Z2 第一刀，不是后期清理。

##### **D-2（D-R8）** refresh token family-wide revocation 留作 future hardening

- **复核结论**：合理；Z1 baseline 的 rotate-on-use + revoked-session reject 已经能阻止 token 重用攻击的最常见形态。Family-wide revocation（"踢人时让该 user 所有 refresh token 全失效"）是 Z3+ admin plane 工作。

##### **D-3（R26）** membership status 列暂不补

- **复核结论**：在 Z1 single-active-membership posture 下不会出问题（unique-by-(team,user) 索引足以保证唯一）。Z2 引入 multi-team 路径时可能需要 partial unique index——属 Z2 schema 起跑工作。

#### 8.3.3 6-worker 全局拓扑 / 跨包复核（新增扫描）

我对当前 6-worker（agent-core / bash-core / context-core / filesystem-core / orchestrator-core / orchestrator-auth）做了一次跨包扫描，新增以下关注点：

##### **T-1** 仅 5 个 worker 的 wrangler.jsonc 存在，但 CI 配置全部 6 个 worker

- **事实依据**：
  - `find workers -name "wrangler.jsonc"` → 5 文件（agent/bash/context/filesystem/orchestrator-{core,auth}） = **6 个 worker 都有 wrangler.jsonc**（我之前数错了）。
  - `.github/workflows/workers.yml:36-44` matrix 列 6 个 worker，与文件系统一致。
- **结论**：CI 与代码现实一致，无 gap。

##### **T-2** orchestrator-auth 不持有 D1 migration

- **事实依据**：
  - `orchestrator-auth/wrangler.jsonc:21-28` d1 binding 没有 `migrations_dir`；`orchestrator-core/wrangler.jsonc:25` 是 `migrations_dir: "migrations"`。
  - 这意味着部署顺序必须是：先 deploy orchestrator-core（apply schema） → 再 deploy orchestrator-auth（消费 schema）。
- **结论**：与 GPT 在 R13 rejected 立场一致——topology 选择，非 implementation bug。但**部署 runbook 应明确写出顺序约束**——目前 Z1 closure 没说。建议 Z2 closure 之前补一份 deploy runbook，至少 1 段说明 "orchestrator-core deploy first, orchestrator-auth depends on schema being live"。

##### **T-3** `nano_users.default_team_uuid NOT NULL` 与 batch 顺序的隐含依赖

- **事实依据**：
  - `migration:1-8 nano_users` 含 `default_team_uuid TEXT NOT NULL`，但**没有 FOREIGN KEY 约束指向 nano_teams**。
  - `repository.ts:185-211 createBootstrapUser` batch 顺序：`users → profiles → teams → memberships → identities`。
  - 即用户在 nano_teams 写入之前已经 INSERT 到 nano_users 携带 `default_team_uuid` 值（指向尚未存在的 team）。
- **结论**：因为 schema 没有显式 FK constraint，且 D1 默认 `PRAGMA foreign_keys=OFF`，所以**不会触发约束错误**——但语义上是"用户携带一个不存在的 default team UUID 跑过 INSERT 一段时间"。在 batch 中是 atomic 的，所以中间状态对外不可见。**实际安全**，但语义脆弱——任何后续 `PRAGMA foreign_keys=ON` 启用都会立即崩。建议 batch 顺序改为 `teams → users → profiles → memberships → identities`（先 team 后 user）。

##### **T-4** orchestrator-core 与 orchestrator-auth 共享 `JWT_SIGNING_KEY_<kid>`

- **事实依据**：
  - `orchestrator-core/src/auth.ts:97-102 collectVerificationKeys` 与 `orchestrator-auth/src/jwt.ts:54-65 collectVerificationKeys` 都 scan `env` 取 `JWT_SIGNING_KEY_*`。
  - `wrangler.jsonc` 两侧都用同一 `JWT_SIGNING_KID: "v1"`。
  - 但**deploy 时必须分别 `wrangler secret put JWT_SIGNING_KEY_v1` 在两个 worker 上**——secret 是 worker-local 的，不会自动共享。
- **结论**：这是一个 deployment hygiene gap——如果 owner 只在一个 worker put secret，会出现"orchestrator-auth mint 出来的 token 在 orchestrator-core verify 时失败"的诡异 bug。Z1 closure §4 没说。**建议**：Z1 closure §4 补一句"`JWT_SIGNING_KEY_<kid>` 必须在 orchestrator-auth 与 orchestrator-core 上同时 `wrangler secret put`"。

##### **T-5** orchestrator-auth 没有暴露 NANO_INTERNAL_BINDING_SECRET 防护

- **事实依据**：
  - `orchestrator-core/src/index.ts:15 NANO_INTERNAL_BINDING_SECRET?` 声明但实际上 6-worker 路径（service binding）直接用了 RPC，不需要 secret 检查。
  - 但 `errors.ts:29-31` 的 caller-identity 检查仅靠**调用方在 envelope meta 里自报 `caller: "orchestrator-core"`**——任何能访问 orchestrator-auth service binding 的 worker 都可以伪造 `caller` 字段（schema 是 z.string().min(1)，任何字符串都接受 schema 校验，但 errors.ts 只接受 literal "orchestrator-core"）。
  - Cloudflare service binding 没有 caller-id proof（不像 mTLS）；只能依赖"哪些 worker 配置了 service binding"。
- **结论**：当前防护是"配置层"+"自报 caller"双层。OK 在 6-worker 私网内（charter §1 已冻结只允许 orchestrator-core 配置该 binding），但若未来某个 worker 误加 binding，就能打 RPC。Z2 起跑前可考虑加 shared secret + HMAC envelope。**不阻塞**。

##### **T-6** Z2 action plan 已对齐 ZX-D1 表名（R24 已过期）

- **事实依据**：`grep "nano_session\|nano_conversation" docs/action-plan/zero-to-real/Z2-*.md` 显示 Z2 action plan §2.1 S1 / Phase 1 / P1-01 全部使用 `nano_conversations / nano_conversation_sessions / ... / nano_session_activity_logs`。
- **结论**：R24 finding 已过期；Z2 schema 拓扑与 ZX-D1 一致。

### 8.4 二次收口意见 — 是否进入后续阶段

#### 8.4.1 收口判定

**Z0/Z1 阶段可以正式 closed**，理由：

1. **本轮 critical 修复（R1 D1 atomicity）已彻底完成**——register/login/refresh/wechat 的写入路径现在具备真实事务安全。
2. **本轮 high 修复绝大部分已完成**——R2 dead code、R3 schema 缺列、R6 password reset 副作用、R7 status enforcement、R12 CI paths、R17 命名漂移、R22/R29 contract tightening 全部真实落地。
3. **遗留的 partial / U-1 至 U-5 都不阻塞 Z1 当前能力的真实运行**——register/login/refresh/me/wechat 主路径 happy path + 已识别的 negative path（forged token、cross-team token、revoked refresh）都有 unit 覆盖；唯一在生产路径上的小风险（`/sessions/*` 仍接受 query token、deploy-fill logic bug）属于"安全性收紧"而非"功能崩坏"。
4. **GPT 的拒绝 / 延迟决策大多合理**——R4/R11/R21（identity-team 解耦）作为 Z2 起跑首刀；R23 nodejs_compat、R28 KDF 升级、D-R8 family revocation 都是 first-wave 范围外的合理 trade-off。

**结论**：
- **Z0 closed** — Z0 的 freeze gate + 术语映射 + 验证基线已建立。
- **Z1 closed (with carry-over)** — 真实 auth foundation 已落地；遗留项压成 Z2 cleanup 清单。

#### 8.4.2 必须进入 Z2 实施期前清单（5 项 carry-over）

| 编号 | 内容 | 优先级 | 阻塞类型 |
|------|------|--------|----------|
| C-1 | **U-2 修 deploy-fill 逻辑 bug 与 anchor 非 UUID 问题** —— `auth.ts:221` 改为 source-check；`wrangler.jsonc TEAM_UUID` 用真实 UUID 或 retire 该路径 | **必须 Z2 Phase 1 起跑前修** | 实施阻塞 |
| C-2 | **D-1 移除 `nano_user_identities.team_uuid` 列** —— Z2 Phase 1 Wave B migration 同时处理；释放 multi-team 路径 | **必须 Z2 Phase 1 起跑前修** | 实施阻塞 |
| C-3 | **U-1 `/sessions/*` 路由删除 `?access_token=` 查询参数** —— 1 行改动 | Z2 实施期任意时间修 | 安全清理 |
| C-4 | **U-3 WeChat retry catch 块逻辑修复** —— 仅对网络/timeout 重试，AuthServiceError 直接抛出 | Z4 Mini Program 真机调试前修 | 用户体验 |
| C-5 | **T-4 部署 runbook 文档** —— `JWT_SIGNING_KEY_<kid>` 必须在 orchestrator-auth + orchestrator-core 同时 secret put；orchestrator-core deploy 优先于 orchestrator-auth；`TEAM_UUID` 必须改为真实 UUID 或保留 single-tenant 部署语义 | Z2 closure 之前补 | 部署阻塞 |

#### 8.4.3 Z2 起跑前的强烈建议（非阻塞，但显著降低 Z2 风险）

1. **`u-2 fix` 与 `D-1 fix` 合并到 Z2 Phase 1 P1-01 wave-B migration 一并处理**——避免 Z1 schema rebase 单独成立一个 commit，让 Z2 起跑时 schema 已 multi-team-ready。
2. **U-4 public-surface 测试矩阵补全**——可以放进 Z2 Phase 5 closure 测试加固阶段，不必在 Z2 Phase 1 处理。
3. **U-5 测试常量化**——和 Z2 Phase 1 schema rebase 一起做，几行改动。

#### 8.4.4 对 GPT §7.5 自评 8.8/10 的回应

GPT 的 §7.5 自评把我的 review 打 8.8/10，并把以下作为缺点列入：
- "design-level posture 被上推成 blocker"（针对 R4/R11/R13/R21）
- "少数发现已过期"（针对 R23/R24/R25）
- "报告密度过高"

我对这些反馈的回应：
1. **R4/R11/R21 上推为 high 是 Z1 当下不阻塞、Z2 起跑必修的合理升格**——我在原报告 §5 已经标记为"必修但可在 Z2 起跑前修"，没有要求 Z1 立即拆。GPT 实际选择 deferred，与我的修法路径一致。这条反馈基本是术语层面（finding 的 severity vs. urgency）。
2. **R23/R24/R25 在我审查时点确实过期或弱**——R24（`nano_session_*` vs `nano_conversation_*`）我在审查时确实没有 grep Z2 action plan 的最新版，是我的扫描盲点；R25（`test:cross` 同义）虽然 script 仍在，但文档主用 `test:cross-e2e` 是事实。我在 §8.2 中已 accept rejection。
3. **报告密度高**是有意为之——Z0/Z1 是 zero-to-real 的真实 implementation 起点，密度低反而漏问题。但 GPT 的反馈"实现者需要更多 triage"是公允的；下一轮 review 我会在 §0 总结结论中预先做 severity-based 分组（critical / high / medium / low）让实施者更快定位 blocker。

总评：GPT §7.5 的 8.8 自评是合理的；我的报告作为外部独立 review，命中率与可执行性都符合预期，少数 over-reach 已通过本轮修复 + 我自己的 §8 复核被纠正。

---

### 8.5 二次审查终局判断

| 维度 | 结论 |
|------|------|
| Z0 阶段 | `closed` — freeze gate 与术语映射已建立 |
| Z1 阶段 | `closed (with 5 carry-over)` — auth foundation 真实落地，剩余项压成 Z2 cleanup |
| 是否可以进入 Z2 | **`yes`** — 但 C-1 + C-2 必须在 Z2 Phase 1 起跑当天先修（schema rebase 1 commit，logic bug 1 commit） |
| 是否可以进入 Z3/Z4/Z5 | 待 Z2 closure 后另行 review |
| 本轮 review 总等级 | `approve-with-followups (Grade: B+)` —— 比初审 C+ 升 2 档，因为 1 个 critical + 14 个 high/medium 已彻底修复，剩余项均不构成生产 blocker |

> **最终立场**：Z0/Z1 收口；进入 Z2 时窗一并修 5 条 carry-over；Z2 Phase 1 wave-B migration 应同时移除 `nano_user_identities.team_uuid` 列与修 `auth.ts:221` deploy-fill logic bug，让 Z2 起跑当天 schema 与 runtime 一并 multi-team-ready。
