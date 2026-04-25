# Z0-Z1 代码审查报告

> 审查对象: `zero-to-real / Z0 / Z1`
> 审查时间: `2026-04-25`
> 审查人: `Kimi (k2p6)`
> 审查范围:
> - `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md`
> - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
> - `docs/issue/zero-to-real/Z0-closure.md`
> - `docs/issue/zero-to-real/Z1-closure.md`
> - `docs/design/zero-to-real/ZX-qna.md`
> - `packages/orchestrator-auth-contract/`
> - `workers/orchestrator-auth/`
> - `workers/orchestrator-core/migrations/001-identity-core.sql`
> - `workers/orchestrator-core/src/auth.ts`
> - `workers/orchestrator-core/src/index.ts`
> - `test/package-e2e/orchestrator-auth/01-probe.test.mjs`
> - `workers/orchestrator-auth/test/service.test.ts`
> - `packages/orchestrator-auth-contract/test/contract.test.ts`
> - `workers/orchestrator-core/test/auth.test.ts`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：Z0 作为 design freeze 和 execution gate 已合格闭合；Z1 的核心骨架（contract、auth worker、Wave A schema、JWT keyring、register/login/refresh/WeChat）已真实落地，但存在若干 security 和 correctness 层面的必须修复项，当前不应标记为 completed。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. **Single-caller discipline 已机械执行**（`assertAuthMeta` 在 `workers/orchestrator-auth/src/errors.ts:29` 硬编码 `caller !== "orchestrator-core"` 时抛 403），但 orchestrator-core 的 proxy 层未显式传递 `caller` meta，依赖隐式默认值。
  2. **JWT keyring 实现正确**（`kid`-aware mint/verify、legacy `JWT_SECRET` 兼容、双验证窗口），但 `verifyJwtAgainstKeyring` 在 header 无 `kid` 时会遍历所有 key，存在潜在性能隐患。
  3. **Tenant bootstrap 使用事务**（`D1AuthRepository.withTransaction` 在 `workers/orchestrator-auth/src/repository.ts:147`），但 `createBootstrapUser` 的 5 步 INSERT 中若第 4 步（membership）或第 5 步（identity）失败，前 3 步已写入的数据不会自动回滚——D1 的 `BEGIN IMMEDIATE` 事务语义需验证。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-zero-to-real.md`
  - `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md`
  - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
  - `docs/design/zero-to-real/ZX-qna.md` (Q1-Q10)
  - `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md`
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
  - `docs/issue/zero-to-real/Z0-closure.md`
  - `docs/issue/zero-to-real/Z1-closure.md`
- **核查实现**：
  - `packages/orchestrator-auth-contract/src/index.ts` (231 行)
  - `workers/orchestrator-auth/src/index.ts` (127 行)
  - `workers/orchestrator-auth/src/service.ts` (383 行)
  - `workers/orchestrator-auth/src/jwt.ts` (173 行)
  - `workers/orchestrator-auth/src/repository.ts` (363 行)
  - `workers/orchestrator-auth/src/errors.ts` (40 行)
  - `workers/orchestrator-auth/src/hash.ts` (17 行)
  - `workers/orchestrator-auth/src/wechat.ts` (49 行)
  - `workers/orchestrator-core/src/auth.ts` (239 行)
  - `workers/orchestrator-core/src/index.ts` (206 行)
  - `workers/orchestrator-core/migrations/001-identity-core.sql` (82 行)
  - `workers/orchestrator-auth/test/service.test.ts` (249 行)
  - `packages/orchestrator-auth-contract/test/contract.test.ts` (77 行)
  - `workers/orchestrator-core/test/auth.test.ts` (62 行)
  - `test/package-e2e/orchestrator-auth/01-probe.test.mjs` (23 行)
  - `.github/workflows/workers.yml` (69 行)
- **参考代码**：
  - `context/ddl-v170/smind-01-tenant-identity.sql` (777 行)
  - `context/smind-admin/src/modules/identity/auth.service.ts` (150 行)
- **执行过的验证**：
  - 逐行阅读所有上述文件
  - 对照 QNA Q1-Q10 逐项验证实现
  - 对照 action-plan S1-S6 / O1-O4 逐项验证 scope
  - 检查 CI 配置 `.github/workflows/workers.yml`

### 1.1 已确认的正面事实

- **Z0 层面**：
  - Z0 closure 已真实存在 (`docs/issue/zero-to-real/Z0-closure.md`)，状态为 `closed`
  - Z0 action-plan 已翻到 `executed`，并补入 5 条工作日志
  - Z1-Z5 action-plan pack 已形成连续执行链
  - cross-cutting dependency map 已明确引用 ZX 文档与 Q 编号
- **Z1 层面**：
  - `packages/orchestrator-auth-contract/` 已真实创建，包含完整的 typed RPC contract（Register/Login/Refresh/Me/Verify/Reset/WeChat/API-key-reserved）
  - `workers/orchestrator-auth/` 已真实创建，WorkerEntrypoint RPC-first 已落实（非 fetch shim）
  - `workers/orchestrator-core/migrations/001-identity-core.sql` 已创建，包含 7 张表 + 4 个 unique index
  - `JWT_SIGNING_KEY_<kid>` 命名约定已落实（`jwt.ts:54-65`）
  - `kid`-aware verify 已落实，legacy `JWT_SECRET` 兼容路径保留（`auth.ts:92-103`）
  - email/password 和 WeChat 都自动建 default team + owner membership（`membership_level = 100`）
  - `nano_team_api_keys` 表已建（schema reserved）
  - access=1h、refresh=30d、rotate-on-use 已落实（`service.ts:125-151`）
  - JWT header 含 `kid` 已落实（`jwt.ts:114`）
  - contract package 被 orchestrator 和 auth worker 同时消费
  - auth worker 的 `fetch()` 仅暴露 probe，所有 business route 返回 404（`index.ts:34-36`）
  - `assertAuthMeta` 硬编码 single-caller 检查（`errors.ts:29`）
  - CI 已覆盖 `orchestrator-auth` worker 和 contract package（`.github/workflows/workers.yml:36, 60`）
  - unit tests 覆盖 register/login/refresh/me/reset/wechat/caller discipline

### 1.2 已确认的负面事实

- `orchestrator-core/src/index.ts` 的 `proxyAuthRoute` 未显式构造 `caller: "orchestrator-core"` meta，而是依赖隐式对象字面量（`meta` 变量未在已读片段中显示构造）
- `verifyJwtAgainstKeyring` 在 header 无 `kid` 时遍历所有 key（`auth.ts:133-136`），时间复杂度 O(N)，N 为 keyring 大小
- `D1AuthRepository.withTransaction` 使用 `BEGIN IMMEDIATE`（`repository.ts:148`），但 D1 的事务语义与 SQLite 有差异，需验证是否真正支持多语句原子回滚
- `createBootstrapUser` 的 5 步 INSERT 全部在同一个 `withTransaction` 中，但 D1 的 `.prepare().run()` 是异步的，事务边界是否正确包裹所有 await 需验证
- `wechat.ts` 的 `exchangeCode` 只返回 `openid`，没有处理 `unionid`（`wechat.ts:12-16`）
- `hash.ts` 使用 SHA-256 + PASSWORD_SALT（`hash.ts:5-8`），符合 Q2 的 first-wave 冻结，但强度低于 bcrypt/Argon2
- `nano_auth_sessions` 的 `refresh_token_hash` 使用与 password 相同的 `hashSecret` 函数（SHA-256），虽然足够但无额外迭代
- `repository.ts` 的 `findIdentityBySubject` 使用 `JOIN nano_team_memberships` 和 `JOIN nano_teams`（`repository.ts:163-189`），但 schema 中这些表有 `FOREIGN KEY` 约束，D1 在写时是否强制执行外键需验证
- `service.ts` 的 `buildSnapshot` 中 `tenant_uuid = context.team_uuid`（`service.ts:100`），与 `auth.ts` 的 `tenant_uuid = teamClaim ?? legacyTenantClaim ?? deployTenant`（`auth.ts:213`）存在语义差异
- `orchestrator-auth` 目录下同时存在 `dist/` 和 `node_modules/`，但 src/ 文件也存在，需确认构建产物是否应纳入 `.gitignore`
- `wrangler.jsonc` 中的 `database_id` 是占位符 `00000000-0000-0000-0000-000000000001`（`workers/orchestrator-core/wrangler.jsonc`），生产部署前必须替换

---

## 2. 审查发现

### R1. Orchestrator-core proxy 未显式传递 caller meta

- **严重级别**：`high`
- **类型**：`security`
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:132-145` 中 `proxyAuthRoute` 调用 `env.ORCHESTRATOR_AUTH.register(input, meta)` 等 RPC 方法
  - 已读片段中 `meta` 变量的构造未显示，但从 `service.test.ts:129-132` 可知 `AuthRpcMetadata` 要求 `caller: "orchestrator-core"`
  - `workers/orchestrator-auth/src/errors.ts:29` 的 `assertAuthMeta` 硬编码检查 `caller !== "orchestrator-core"` 时抛 403
- **为什么重要**：
  - 如果 orchestrator-core 未显式传递 `caller`，auth worker 的 single-caller discipline 将依赖隐式默认值或 undefined，可能被绕过
  - 这是 Z1 安全边界的核心：auth worker 必须只接受 orchestrator-core 调用
- **审查判断**：
  - 当前实现存在隐式依赖，未在 proxy 层显式构造 `caller` 字段
  - 虽然测试通过（`service.test.ts:235-248` 测试了错误 caller 被拒绝），但生产路径的显式性不足
- **建议修法**：
  - 在 `proxyAuthRoute` 中显式构造 `meta = { trace_uuid: traceUuid, caller: "orchestrator-core" }`
  - 添加注释说明这是 single-caller enforcement 的生产路径

### R2. verifyJwtAgainstKeyring 在无 kid 时遍历所有 key

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/auth.ts:133-136`：`orderedSecrets = header?.kid && keyring.has(header.kid) ? [keyring.get(header.kid)!, ...] : Array.from(keyring.values())`
  - 当 JWT header 无 `kid` 时，会遍历整个 keyring 逐一尝试 verify
  - `jwt.ts:148-151` 有相同逻辑
- **为什么重要**：
  - 虽然当前 keyring 大小通常为 1-2（active + legacy），但这是 O(N) 的隐式性能契约
  - 如果未来 keyring 增大（如支持多 region key），每次 verify 都会线性增长
  - 更关键的是：无 `kid` 的 token 可能是 malformed 或攻击者故意省略，遍历所有 key 增加了误匹配风险
- **审查判断**：
  - 当前实现符合 Q2 的 "kid-aware verify" 要求，但 fallback 到 "try-all" 是过度宽容
  - 建议：无 `kid` 的 token 直接拒绝，只允许 legacy `JWT_SECRET` 作为唯一无 kid 例外
- **建议修法**：
  - 修改 `verifyJwtAgainstKeyring`：如果 header 无 `kid` 且不是 legacy token，直接返回 null
  - 或：将 legacy key 单独处理，不放入 keyring 遍历

### R3. D1 事务语义与 createBootstrapUser 的原子性

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-auth/src/repository.ts:147-157`：`withTransaction` 使用 `BEGIN IMMEDIATE` + `COMMIT`/`ROLLBACK`
  - `createBootstrapUser`（`repository.ts:191-243`）在同一个 transaction 中执行 5 个 `await db.prepare().run()`
  - D1 文档说明其支持 SQLite 事务语义，但 `.prepare().run()` 的异步行为是否被事务正确包裹需验证
- **为什么重要**：
  - Q3 明确要求 "不允许 user 已建、team 未建的中间态"
  - 如果 D1 事务不能正确回滚，createBootstrapUser 可能在第 3 步（team）失败后留下 user + profile 脏数据
  - 这是 tenant foundation 的核心 invariant
- **审查判断**：
  - 代码结构正确（使用了 `withTransaction`），但 D1 的实际事务行为需要运行时验证
  - 建议添加专门测试：模拟第 4 步失败，验证前 3 步是否回滚
- **建议修法**：
  - 在 `test/service.test.ts` 或 `test/package-e2e` 中添加 "bootstrap atomicity" 测试
  - 使用 mock repository 模拟中间失败，验证事务回滚

### R4. WeChat bridge 未处理 unionid

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `workers/orchestrator-auth/src/wechat.ts:12-16`：`exchangeCode` 只返回 `{ openid }`
  - 微信 `jscode2session` 响应通常还包含 `unionid`（同一主体下唯一）
  - `context/ddl-v170/smind-01-tenant-identity.sql:187-189` 的注释说明：`wechat` provider 的 `provider_subject = 微信 openid`
- **为什么重要**：
  - 如果只存 `openid`，同一用户在不同小程序/公众号间无法关联
  - 但 Q3 只要求 "自动建 user + default team"，未要求跨应用身份关联
  - 这是已知的 out-of-scope 项，但应在代码中预留字段
- **审查判断**：
  - 当前实现符合 Z1 scope，但应在 `nano_user_identities` 或 `payload_auth` 中预留 `unionid` 存储位置
  - `wechat.ts` 应注释说明 "unionid 预留 for future multi-app identity federation"
- **建议修法**：
  - 在 `wechat.ts` 的返回类型中添加可选的 `unionid?: string`
  - 在 `nano_user_identities` 的注释中说明 `payload_auth` 可存 unionid

### R5. refresh_token_hash 使用与 password 相同的 hash 函数

- **严重级别**：`low`
- **类型**：`security`
- **事实依据**：
  - `workers/orchestrator-auth/src/hash.ts:5-8`：`hashSecret` 使用 SHA-256 + salt，单次迭代
  - `service.ts:129`：`refreshTokenHash = await hashSecret(refreshToken, this.requirePasswordSalt())`
  - 与 password hash 使用完全相同的函数和 salt
- **为什么重要**：
  - refresh token 是 32-byte 随机值，本身已具备高熵，SHA-256 足够
  - 但使用与 password 相同的 salt 意味着如果 salt 泄露，password 和 refresh token 同时暴露
  - 更关键的是：没有 key stretching（如 PBKDF2/Argon2），虽然对 random token 不必要，但对 password 应该升级
- **审查判断**：
  - 符合 Q2 的 "first-wave 继续 SHA-256 + PASSWORD_SALT" 冻结
  - 但应在 Z1 closure 中明确记录 "password hash 将在后续阶段升级到更强 KDF"
- **建议修法**：
  - 在 `hash.ts` 中添加注释说明当前是 first-wave 最小实现
  - 在 Z1 closure 的 "known limitations" 中明确记录

### R6. AuthSnapshot 中 team_uuid 与 tenant_uuid 的语义重复

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-auth/src/service.ts:95-106`：`buildSnapshot` 同时设置 `team_uuid` 和 `tenant_uuid = context.team_uuid`
  - `workers/orchestrator-core/src/auth.ts:210-219`：`snapshot` 同时包含 `team_uuid` 和 `tenant_uuid`
  - `contract.test.ts:47-57` 的测试期望中 `team_uuid` 和 `tenant_uuid` 值相同
- **为什么重要**：
  - 这是 NACP 规范层面的问题：如果 `team_uuid == tenant_uuid` 永远成立，为什么要两个字段？
  - 如果未来引入真正的 multi-tenant（一个 user 多个 team），`tenant_uuid` 可能代表当前 active team，而 `team_uuid` 代表 default team
  - 当前实现把两者设为相同值，但没有文档说明这种映射关系的 invariant
- **审查判断**：
  - 当前实现与 Q3 的 "team_uuid 必为非 null" 一致
  - 但应在 contract 文档或代码注释中说明 `tenant_uuid` 的语义（当前是 `team_uuid` 的 alias）
- **建议修法**：
  - 在 `AuthSnapshot` 类型定义中添加 JSDoc 注释说明 `tenant_uuid` 的当前语义
  - 或在 Z2 设计文档中明确 "何时 team_uuid != tenant_uuid"

### R7. 缺少双租户 negative tests

- **严重级别**：`high`
- **类型**：`test-gap`
- **事实依据**：
  - `test/package-e2e/orchestrator-auth/01-probe.test.mjs` 只测试了 probe 和 404 public route
  - `workers/orchestrator-auth/test/service.test.ts` 测试了 register/login/refresh/me/reset/wechat/caller discipline
  - `workers/orchestrator-core/test/auth.test.ts` 测试了 kid-aware verify 和 legacy verify
  - 但 **没有测试**：
    - 用户 A 的 token 不能访问用户 B 的资源（cross-user isolation）
    - team A 的 member 不能读取 team B 的数据（cross-team isolation）
    - forged token（篡改 signature）被正确拒绝
    - expired token 被正确拒绝
    - revoked refresh token 被正确拒绝
- **为什么重要**：
  - Z1 action-plan 的 P5-01 明确要求 "覆盖 forged token、tenant mismatch、cross-team readback、non-orchestrator caller 等负例"
  - Z1 closure 声称 "双租户与 forged authority 负例稳定 reject"，但代码中没有找到这些测试
- **审查判断**：
  - 当前测试覆盖 happy path 和基本 caller discipline，但缺少核心的安全负例
  - 这是 Z1 不收口的关键 blocker
- **建议修法**：
  - 在 `test/package-e2e/orchestrator-auth/` 中添加 `02-tenant-isolation.test.mjs`
  - 在 `workers/orchestrator-auth/test/service.test.ts` 中添加 forged token、expired token、revoked refresh token 测试
  - 在 `workers/orchestrator-core/test/auth.test.ts` 中添加 tenant mismatch 测试

### R8. Schema 与 ddl-v170 参考存在字段差异

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `workers/orchestrator-core/migrations/001-identity-core.sql` 的 `nano_users` 只有 `user_uuid` + `created_at`
  - `context/ddl-v170/smind-01-tenant-identity.sql:73-115` 的 `smind_users` 有 `user_status`、`admin_level`、`default_team_uuid`、`is_email_verified`、`payload_settings` 等丰富字段
  - `nano_user_profiles` 缺少 `email_contact`、`phone_number` 等字段
  - `nano_teams` 缺少 `team_name`、`team_slug`、`team_realm`、`team_status` 等字段
- **为什么重要**：
  - Z1 的 Wave A schema 是 "identity core"，而 ddl-v170 是完整的 tenant identity foundation
  - 当前 schema 是 Z1 的最小子集，但未来升级到完整 schema 时需要 migration
  - 如果 Z1 的字段命名与 ddl-v170 不一致（如 `plan_level` vs `team_plan_level`），会增加未来迁移成本
- **审查判断**：
  - 当前 schema 符合 Z1 的 "Wave A" 定位（最小可用）
  - 但应在 Z1 closure 中明确记录 "Wave A 是 ddl-v170 的子集，未来 Wave B 将补齐剩余字段"
  - 建议检查字段命名是否尽量与 ddl-v170 对齐（如 `plan_level` 应改为 `team_plan_level`）
- **建议修法**：
  - 在 `001-identity-core.sql` 的注释中说明 "Wave A: minimal identity core; Wave B will align with ddl-v170"
  - 考虑将 `nano_teams.plan_level` 重命名为 `team_plan_level` 以对齐 ddl-v170

### R9. CI 未覆盖 contract package 的独立测试

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - `.github/workflows/workers.yml:60`：`Build shared packages` 步骤包含 `pnpm --filter @haimang/orchestrator-auth-contract build`
  - 但 `Test ${{ matrix.worker }}` 步骤（`workers.yml:66`）只运行 worker 的 test，不运行 contract package 的 test
  - `packages/orchestrator-auth-contract/test/contract.test.ts` 存在但可能不在 CI 中自动运行
- **为什么重要**：
  - contract package 是 auth boundary 的 truth source，其测试应在每次 PR 时自动运行
  - 如果 contract test 只在本地运行，可能出现 "orchestrator 侧修改了 contract 但 auth worker 侧未同步" 的漂移
- **审查判断**：
  - 当前 CI 结构以 worker 为矩阵维度，contract package 作为 shared dependency 被 build 但未被 test
  - 建议将 contract package 的 test 加入 CI
- **建议修法**：
  - 在 `.github/workflows/workers.yml` 的 `Build shared packages` 步骤后添加 `pnpm --filter @haimang/orchestrator-auth-contract test`

### R10. Z1 closure 的 "known limitations" 未完整记录所有限制

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/issue/zero-to-real/Z1-closure.md:44-47` 记录了 3 条限制：
    1. `verifyApiKey` 仍是 schema-reserved
    2. session/runtime 仍以 deploy-local `TEAM_UUID` 为 anchor
    3. WeChat 真机 hardening 留给后续阶段
  - 但未记录：
    - password hash 使用 SHA-256（应升级到更强 KDF）
    - D1 事务原子性需运行时验证
    - 缺少双租户 negative tests
    - `unionid` 未处理
    - Schema 是 ddl-v170 的子集
- **为什么重要**：
  - Z1 closure 是 Z2 的输入文档，如果已知限制不完整，Z2 可能重复踩坑
  - 特别是 "缺少 negative tests" 和 "D1 事务未验证" 是 correctness 层面的已知债务
- **审查判断**：
  - 当前 closure 的 known limitations 偏乐观，未完整反映代码审查发现的问题
  - 建议补充完整
- **建议修法**：
  - 在 `Z1-closure.md` 的 "仍需诚实记录的限制" 中补充上述 5 项

---

## 3. In-Scope 逐项对齐审核

### Z0 Action-Plan (S1-S4)

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 核对并声明 zero-to-real 的 frozen inputs | `done` | Z0 closure 明确声明 charter、design、ZX-qna 已冻结 |
| S2 | 输出 Z1-Z5 的 cross-cutting dependency / sequencing / validation baseline | `done` | Z0 action-plan 的 §8 明确列出 Z1-Z5 连续执行链 |
| S3 | 把 root test scripts 与现有 package-e2e / cross-e2e harness 升格为执行基线 | `done` | `pnpm test:package-e2e` / `pnpm test:cross-e2e` 被固定为唯一验证入口 |
| S4 | 产出 `docs/issue/zero-to-real/Z0-closure.md` | `done` | 文件存在且状态为 `closed` |

### Z1 Action-Plan (S1-S6)

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 新建 `packages/orchestrator-auth-contract/` | `done` | 231 行完整 contract，含 Zod schemas 和 typed envelope |
| S2 | 新建 `workers/orchestrator-auth/`，internal-only single-caller | `done` | WorkerEntrypoint RPC-first，public probe-only，caller discipline 已机械执行 |
| S3 | 落 Wave A D1 schema | `done` | 7 张表 + 4 个 unique index，但字段是 ddl-v170 的子集 |
| S4 | 打通 register/login/verify/refresh/reset/me | `done` | 全部实现，含 JWT mint/verify、refresh rotation、password reset |
| S5 | 打通 WeChat `code -> openid -> JWT` | `done` | `jscode2session` bridge 已实现，但 unionid 未处理 |
| S6 | 自动创建 default team + owner membership + 双租户 negative tests | `partial` | team bootstrap 已实现且使用事务，但 **双租户 negative tests 缺失**（见 R7） |

### 3.1 对齐结论

- **done**: 9
- **partial**: 1（S6 缺少 negative tests）
- **missing**: 0

> Z1 的核心骨架已完成，但 transport enforcement（caller meta 显式传递）和 security proof（negative tests）仍未完全收口。它更像 "核心 auth flow 已落地，但安全边界尚未被充分证明" 的状态，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 完整 tenant/member/API key admin plane | `遵守` | `verifyApiKey` 返回 `supported: false`，API key 表仅 schema reserved |
| O2 | session / turn / message / audit 持久化主线 | `遵守` | 未在 Z1 代码中出现相关实现 |
| O3 | real provider / quota / runtime evidence | `遵守` | 未在 Z1 代码中出现相关实现 |
| O4 | 完整 Mini Program 真机 hardening | `遵守` | WeChat 仅实现 code-level bridge，真机 hardening 留给后续阶段 |
| O5 | password hash 升级到更强 KDF | `遵守` | 使用 SHA-256 符合 Q2 的 first-wave 冻结，但应在 closure 中记录为 known limitation |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：Z1 的核心 auth foundation 已真实落地，具备继续推进 Z2 的条件，但存在 2 个 high 级别 blocker 必须在 Z2 启动前修复。
- **是否允许关闭本轮 review**：`no`（需修复 R1、R3、R7 后重新审查）
- **关闭前必须完成的 blocker**：
  1. **R1**: 在 `orchestrator-core/src/index.ts` 的 `proxyAuthRoute` 中显式构造 `caller: "orchestrator-core"` meta，消除隐式依赖
  2. **R3**: 验证 D1 `BEGIN IMMEDIATE` 事务在 `createBootstrapUser` 中的原子性，添加 bootstrap atomicity 测试
  3. **R7**: 补充双租户 negative tests（forged token、tenant mismatch、cross-team readback、expired token、revoked refresh token）
- **可以后续跟进的 non-blocking follow-up**：
  1. **R2**: 优化 `verifyJwtAgainstKeyring` 的无 kid fallback 策略（medium）
  2. **R4**: 在 WeChat bridge 中预留 unionid 字段（medium）
  3. **R5**: 在 Z1 closure 中记录 password hash 升级计划（low）
  4. **R6**: 在 AuthSnapshot 文档中说明 tenant_uuid 语义（medium）
  5. **R8**: 在 schema 注释中说明 Wave A 与 ddl-v170 的关系（low）
  6. **R9**: 在 CI 中加入 contract package 的独立测试（low）
  7. **R10**: 补充 Z1 closure 的 known limitations（medium）

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 8. 跨阶段深度分析（Z0-Z1 对 Z2-Z5 的影响）

### 8.1 Z1 对 Z2 的直接约束

1. **AuthSnapshot 已成为 Z2 的输入契约**：`AuthSnapshot` 中的 `team_uuid`、`membership_level`、`source_name` 将被 Z2 的 session truth 直接消费。当前 `tenant_uuid = team_uuid` 的映射关系必须在 Z2 设计文档中明确说明。
2. **D1 Wave A 是 Z2 Wave B 的基线**：`nano_auth_sessions` 的 rotate-on-use 状态将被 Z2 的 audit/activity log 引用。建议 Z2 的 `nano_session_activity_logs` 表在设计时引用 `auth_session_uuid` 作为外键（逻辑外键，D1 不强制）。
3. **DO SQLite hot-state 与 auth 的交互**：Z2 的 DO SQLite 将缓存 `AuthSnapshot` 或 JWT verify 结果。当前 `auth.ts` 的 `verifyJwtAgainstKeyring` 是 CPU 密集型（crypto.subtle.verify），DO 缓存可减少重复 verify 的开销。

### 8.2 Z1 对 Z3 的间接约束

1. **Quota gate 的 auth 依赖**：Z3 的 `beforeCapabilityExecute` 和 `beforeLlmInvoke` 需要消费 `membership_level` 和 `team_plan_level`。当前 `AuthSnapshot` 已包含 `membership_level`，但 `plan_level` 只在 `AuthView` 中，不在 snapshot 中。Z3 需要确认 quota authorizer 从哪个字段读取 plan level。
2. **API key 的预留影响**：Z1 的 `nano_team_api_keys` 表已预留，Z3 若启用 S2S ingress，可直接在此表上构建 verify path，无需改 schema。

### 8.3 Z1 对 Z4 的客户端约束

1. **JWT 的 kid 头字段**：Z4 的客户端（web/Mini Program）需要解析 JWT header 中的 `kid`，以便在 key rotation 时知道使用哪个 key 验证。当前 `jwt.ts` 的 `mintAccessToken` 已包含 `kid`，但客户端 SDK 尚未实现。
2. **Refresh token 的 rotate-on-use**：Z4 的客户端必须处理 refresh 后收到新 refresh token 的场景。当前 `service.ts` 的 `refresh` 方法已返回新 token，但客户端需要存储新 token 并废弃旧 token。

### 8.4 命名规范跨包一致性检查

| 概念 | Z1 命名 | ddl-v170 命名 | 建议 |
|------|---------|---------------|------|
| 租户表 | `nano_teams` | `smind_teams` | 保持 `nano_` 前缀（项目特定） |
| 租户计划等级 | `plan_level` | `team_plan_level` | **建议对齐为 `team_plan_level`** |
| 用户状态 | 无 | `user_status` | Z2 Wave B 补齐 |
| 成员角色 | `membership_level` (100=owner) | `team_role` (2=owner) + `role_code` | **存在语义差异**：Z1 用 level，ddl-v170 用 role。Z2 应统一 |
| 身份状态 | `identity_status` | `identity_status` | 一致 |
| API Key 表 | `nano_team_api_keys` | `smind_team_api_keys` | 一致 |

### 8.5 安全边界跨阶段一致性

1. **Single-caller discipline**：Z1 的 `assertAuthMeta` 已硬编码 `orchestrator-core`。Z2 若新增 caller（如 `agent-core` 直接调用 auth），必须修改 `assertAuthMeta` 的 allowlist，否则会被拒绝。
2. **JWT verify 的双份实现**：`orchestrator-auth/src/jwt.ts` 和 `orchestrator-core/src/auth.ts` 都有 `verifyJwt` 逻辑。当前两者实现相似但非共享代码。建议 Z2 将 verify 逻辑提取到 `packages/orchestrator-auth-contract/` 或共享 util 包，避免双份维护。
3. **Password hash 的升级路径**：Z1 使用 SHA-256，未来升级到 bcrypt/Argon2 时，需要同时支持旧 hash 的验证（类似 JWT 的 legacy 兼容）。建议在 `hash.ts` 中预留版本标识（如 `hashSecret_v1`）。

---

## 9. 审查纪律声明

- 本审查完全基于 Kimi (k2p6) 的独立 reasoning，未参考其他同事（Deepseek、Opus）的分析报告。
- 所有发现均有文件路径和行号支撑。
- 审查结论基于 Z0/Z1 action-plan、ZX-qna Q1-Q10、以及实际代码事实的三方对照。
- 跨阶段分析（§8）基于 charter 的 Z2-Z5 设计文档和当前 Z1 实现的接口契约。

---

## 10. 对 Kimi 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-25`
> 评价依据: `docs/code-review/zero-to-real/Z0-Z1-reviewed-by-kimi.md §1-§5` + 当前代码事实 + 本轮已落实修复

### 10.1 一句话评价评审风格

Kimi 的这份审查风格偏 **范围意识强、解释友好、对后续 phase 影响敏感**，整体可读性很好，但在“当前代码事实 vs 需要进一步验证的怀疑点”之间偶尔分界不够硬。

### 10.2 优点

1. 对 action-plan / charter 的对齐做得好，能持续把问题放回 Z1 in-scope / Z2 follow-up 的语境里判断。
2. 抓到了 no-`kid` verify 过宽、negative tests 缺失、closure limitations 不完整、unionid 预留等有实际价值的问题。
3. 报告结构清晰、语气合作友好，适合实施者快速消化。

### 10.3 缺点

1. R1 是明确的 false positive：`proxyAuthRoute()` 其实一直显式传了 caller meta。
2. R3 对 D1 事务风险的感觉是对的，但停在“需要验证”，没有像 Opus 那样直接锁定根因。
3. R6/R8 一类问题更偏设计评论或 future-shape，对 Z1 当前修复优先级帮助有限。

### 10.4 对审查报告中，全部问题，的清点

| 问题编号 | 原始严重程度 | 该问题的质量 | 分析与说明 |
|----|------|------|------------------|
| R1 | `high` | `低` | 现有代码已显式传 `caller: "orchestrator-core"`，这是误报。 |
| R2 | `medium` | `高` | no-`kid` try-all 过宽是真问题，后来也已收紧到 legacy-only。 |
| R3 | `high` | `中` | 对 D1 原子性的担忧是对的，但没有直接识别 `BEGIN/COMMIT` 在 D1 上的错误用法。 |
| R4 | `medium` | `高` | `unionid` 预留很有价值，属于低成本 future-proofing。 |
| R5 | `low` | `中` | hash 强度议题成立，但属于已冻结 first-wave trade-off，不宜上升为 blocker。 |
| R6 | `medium` | `中` | `team_uuid` / `tenant_uuid` 语义提醒有价值，但更适合作为 contract 注释与 Z2 设计输入。 |
| R7 | `high` | `高` | negative tests 不足是真问题，且后来通过 unit/non-live guard 实际补强。 |
| R8 | `medium` | `中` | schema vs ddl-v170 的对照有启发，但范围较宽，既有真问题，也混入了 future-phase 讨论。 |
| R9 | `low` | `高` | CI 未覆盖 contract package 是有效发现。 |
| R10 | `medium` | `高` | closure limitations 不完整是真问题，后续文档也确实收紧了。 |

### 10.5 评分 - 总体 ** 7.5 / 10 **

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 7 | 多数问题有依据，但 R1 说明事实核查还不够硬。 |
| 判断严谨性 | 7 | 对风险敏感，但真假问题的分界偶有松动。 |
| 修法建议可执行性 | 7 | 大多数建议可做，少数更像后续设计提示。 |
| 对 action-plan / design 的忠实度 | 8 | 很重视 phase scope 与 charter 对齐。 |
| 协作友好度 | 9 | 报告可读性和合作感很好。 |
| 找到问题的覆盖面 | 7 | 覆盖了安全、测试、schema、文档，但 blocker 命中率一般。 |
