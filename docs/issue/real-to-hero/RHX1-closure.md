# Real-to-Hero — RHX1 Closure Memo

> 阶段: `real-to-hero / RHX1 — DDL SSOT + Docs/Index Hygiene + Deferred Sweep`
> 建立日期: `2026-04-29`
> 作者: `Owner + Copilot`
> 关联 charter: `docs/charter/plan-real-to-hero.md` §16
> 关联 action-plan: `docs/action-plan/real-to-hero/RHX1-ddl-ssot-docs-and-residual-sweep.md`
> 文档状态: `closed`

---

## 0. 一句话 verdict

RHX1 可以关闭：本阶段已把 `workers/orchestrator-core/migrations/` 从 12 个开发期碎片 SQL 收敛为 5 个业务簇 migration SSOT，删除并重建 preview/test D1 数据库后完成远端 apply、写入/FK smoke、preview redeploy 与 sequential live E2E；同时刷新 worker/package/test 导航文档，并修复 live E2E 暴露的 agent-core assembly 初始化回归。

---

## 1. RHX1 直接产出

### 1.1 DDL SSOT

`workers/orchestrator-core/migrations/` 当前固化为 5 个业务簇文件：

| 文件 | 业务簇 | 合并内容 |
|---|---|---|
| `001-identity-core.sql` | identity / auth / teams / API keys | users、profiles、identities、teams、memberships、auth sessions、team API keys；合并 team display、team slug、API key salt、auth session device_uuid |
| `002-session-truth-and-audit.sql` | conversations / sessions / turns / messages / context / audit | conversation/session truth、pending/expired session_status、8 KiB audit payload cap、canonical FK、recent audit view |
| `003-usage-quota-and-models.sql` | quota / usage / model catalog | quota balances、usage events、provider/model/tokens/cost/request evidence、model catalog、team model policy、25 条模型 seed |
| `004-session-files.sql` | session file metadata | D1 file metadata、R2 key uniqueness、session/team indexes |
| `005-user-devices.sql` | device truth / revoke audit | canonical user device table、device revoke event log、user/team indexes |

删除的开发期碎片：

| 删除文件 | 合并落点 |
|---|---|
| `003-session-truth-hardening.sql` | `002-session-truth-and-audit.sql` |
| `004-usage-and-quota.sql` | `003-usage-quota-and-models.sql` |
| `005-usage-events-provider-key.sql` | `003-usage-quota-and-models.sql` |
| `006-pending-status-extension.sql` | `002-session-truth-and-audit.sql` |
| `007-user-devices.sql` | `005-user-devices.sql` |
| `008-models.sql` | `003-usage-quota-and-models.sql` |
| `009-team-display-and-api-keys.sql` | `001-identity-core.sql` |
| `010-session-files.sql` | `004-session-files.sql` |
| `011-model-capabilities-seed.sql` | `003-usage-quota-and-models.sql` |
| `012-usage-events-fk-repair.sql` | `003-usage-quota-and-models.sql` |

### 1.2 Preview/test D1 reset 与 redeploy

按 owner 要求删除了明确属于 nano-agent test/preview 的 D1 数据库：

| 已删除 D1 | 旧 UUID | 判断 |
|---|---|---|
| `nano-agent-preview` | `71a4b089-93e0-4d8f-afb8-bc9356a97cfa` | 当前 preview D1 |
| `nano_agent_spike_do_storage_d1_r2` | `702a9160-a3f3-453f-bde4-aa65d5f2bd30` | 历史 spike/test D1 |
| `nano_agent_spike_do_storage_d1` | `e9adb012-4896-473e-bf3b-c9e1f4890842` | 历史 spike/test D1 |

没有删除 `smind-*`、`wbca_db` 等非 nano-agent 数据库。

重新创建：

| 新 D1 | 新 UUID | region |
|---|---|---|
| `nano-agent-preview` | `421bf213-f3af-4d79-9de0-9cdb5e61e747` | `APAC` |

同步更新了共享 preview D1 binding：

- `workers/orchestrator-core/wrangler.jsonc`
- `workers/orchestrator-auth/wrangler.jsonc`
- `workers/agent-core/wrangler.jsonc`
- `workers/filesystem-core/wrangler.jsonc`

并重新部署：

| Worker | Preview Version ID |
|---|---|
| `orchestrator-auth` | `851e56c1-e45f-44b5-99e1-b2722dee88d4` |
| `agent-core` | 初次 `51758451-7a32-433a-a2c6-0fd6dd4667c3`，修复后 `f6213302-4871-4b9a-b196-053d5d824fd2` |
| `filesystem-core` | `27b7e606-7579-4ea7-a7bf-6966902cc8ca` |
| `orchestrator-core` | `621759ce-790b-405f-a46f-0c73ef4d6a7e` |

### 1.3 README / index hygiene

更新或补齐：

- `workers/agent-core/README.md`
- `workers/bash-core/README.md`
- `workers/context-core/README.md`
- `workers/filesystem-core/README.md`
- `workers/orchestrator-auth/README.md`
- `workers/orchestrator-core/README.md`
- `workers/orchestrator-core/test/README.md`
- `packages/jwt-shared/README.md`
- `packages/nacp-core/README.md`
- `packages/nacp-session/README.md`
- `packages/orchestrator-auth-contract/README.md`
- `packages/storage-topology/README.md`
- `packages/eval-observability/README.md`
- `packages/workspace-context-artifacts/README.md`
- `test/index.md`
- `test/INDEX.md` 作为旧引用兼容跳转

修正的关键事实：

1. `bash-core` 已不是 shell-only，而是 governed fake-bash capability runtime。
2. `context-core` / `filesystem-core` 是 library-runtime + health-probe shell，不是纯空壳。
3. `orchestrator-core` 是唯一公网 live entrypoint，且 D1 migration SSOT 归 `migrations/` 当前业务簇文件。
4. `orchestrator-auth` 和 `jwt-shared` 缺失的 per-unit README 已补齐。
5. `nacp-session` README 保留 root guardian 要求的 `Baseline` / `NACP_VERSION_COMPAT` / `session.followup_input` 契约文本。

---

## 2. RHX1 内额外发现并修复的问题

| 问题 | 影响 | 修复 | 证据 |
|---|---|---|---|
| agent-core Session DO runtime assembly 在 live RPC start 时过早读取 `this.subsystems.capability` | preview live 中所有需要 `agent-core internal start` 的链路返回 502 `agent-start-failed` | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` 改为从已构造的 `subsystems` 直接读取 capability transport，避免 assembly 阶段触碰尚未赋值的实例字段 | 修复前 sequential live E2E `14 fail`；修复后 `56 tests / 27 pass / 29 skipped / 0 fail` |

这是 RHX1 验证过程中暴露出的真实断点。它不是 DDL 本身导致，但 D1 reset + preview redeploy 后的全链路 live run 让该初始化顺序 bug 首次被本阶段复现并修掉。

---

## 3. Deferred / carry-over 处理台账

### 3.1 RHX1 内已解决 / 已收口

| 继承项 | RHX1 状态 | 证据 | 说明 |
|---|---|---|---|
| migration SQL 碎片化、开发期 repair 文件过多 | `resolved` | `workers/orchestrator-core/migrations/001-005*.sql` | 当前 migration 目录自身成为业务簇 DDL SSOT，不再新建 `ssot/` 子目录 |
| stale worker/package README | `resolved` | `workers/*/README.md`、`packages/*/README.md` | 按当前源树、入口、边界、验证命令刷新 |
| test 导航不足 | `resolved` | `test/index.md`、`test/INDEX.md` | 新 canonical index；旧 uppercase 文件保留兼容指针 |
| ZX5 product endpoint tests 已解决但索引不可导航 | `resolved` | `test/index.md`、`workers/orchestrator-core/test/README.md` | 改为测试矩阵/业务链条导航问题收口 |
| dead deploy-fill compatibility residue | `closed-by-prior-phase` | RH6 closure + RHX1 ledger | RHX1 不重复改代码，仅在本台账确认已消化 |
| D6 device revoke auth gate | `closed-by-prior-phase` | live E2E `RH3 device revoke...` pass | RH3 已覆盖，RHX1 live run 再次验证 |
| Lane F dispatcher / onUsageCommit WS push | `closed-by-prior-phase` | live E2E bash/tool + RH5 usage evidence pass | RH1/RH5 已覆盖，RHX1 live run再次验证主链 |
| API key verify runtime path | `closed-by-prior-phase` | live E2E `orchestrator-core accepts nak_ bearer...` pass | RH3 已覆盖 |
| jwt-shared lockfile/SSOT | `closed-by-prior-phase + docs-refreshed` | `packages/jwt-shared/README.md` | RH0 已解决；RHX1 补文档入口 |
| `/me/conversations` D1+KV 双源对齐 | `closed-by-prior-phase` | orchestrator-core tests + live main suite | RH3 已覆盖 |
| agent-core live start initialization regression | `resolved-in-RHX1` | `runtime-assembly.ts` + live E2E final pass | RHX1 验证中新发现并修复 |

### 3.2 RHX1 不解决并继续 deferred

| 继承项 | RHX1 状态 | 不解决原因 | 下游落点 |
|---|---|---|---|
| manual browser / 微信开发者工具 / 真机 evidence pack | `deferred-owner-side` | 依赖 owner 设备、录屏、HAR、WS log，不属于仓库内 DDL/README/test cleanup | owner-side evidence pack / final real-to-hero closure |
| token-level live streaming 或 snapshot-vs-push 最终产品决策 | `deferred-product-design` | RHX1 仅验证当前 WS/event/snapshot 链路；是否推 token-level streaming 是产品/协议决策，不应在 cleanup 阶段暗改行为 | hero-to-platform / protocol-product charter |
| DO websocket heartbeat lifecycle platform-fit hardening | `deferred-platform-hardening` | 当前自动化/live 未显示 blocker；更深平台 fit 需要 Cloudflare runtime 观察窗口和设计，不适合与 DDL 重组混做 | hero-to-platform runtime hardening |
| tool registry 与 client session helper SSOT 抽取 | `deferred-architecture` | 涉及 SDK/client helper 与 tool registry 所有权切换；RHX1 已补测试/README 导航，但不做跨包 API 重构 | hero-to-platform / SDK extraction |
| richer quota/bootstrap/admin/billing/control plane | `partially-closed` / `deferred-platform` | quota/bootstrap 的当前表与 smoke 已验证；admin/billing/control plane 是新平台功能，超出 RHX1 | hero-to-platform billing/admin |
| broader multi-tenant-per-deploy 与更深 internal RPC 演进 | `deferred-platform` | 当前 preview 仍是单 deploy tenant + authority envelope 校验；多租户 per deploy 是平台架构阶段 | hero-to-platform tenancy/RPC |
| RH4 Lane E consumer / workspace-context-artifacts runtime consumer 全量 sunset | `deferred-architecture` | 当前 agent-core 仍有对 `@nano-agent/workspace-context-artifacts` 的 runtime import；彻底切换到 context/filesystem worker-local slices 会影响 host-local workspace runtime，需独立迁移计划和回归矩阵 | hero-to-platform 或专项 RHX2 |
| RH6 `user-do-runtime.ts` 继续拆到 `handlers/*` 颗粒度 | `deferred-refactor` | RH6 已完成深拆至 `user-do/*` 模块并把 `session-do-runtime.ts` 降到 731 行；继续拆 User DO 到 handler 级是低收益高风险结构重构，不应混入 DDL/README/D1 reset | 后续专项 runtime decomposition |

---

## 4. 验证记录

| 验证 | 结果 |
|---|---|
| local D1 consolidated migrations apply | 5 migrations 全部 apply，20 张 `nano_*` 表，25 条模型 seed |
| remote D1 consolidated migrations apply | 5 migrations 全部 apply 到 `nano-agent-preview` / `421bf213-f3af-4d79-9de0-9cdb5e61e747` |
| remote D1 write/FK smoke | user/team/session/turn/message/activity/usage/file/device/revoke/model-policy 写入、查询、清理成功；`PRAGMA foreign_key_check` 无输出 |
| remote D1 migration list | `No migrations to apply!` |
| preview health | `orchestrator-core@preview` health 返回 `status:"ok"` |
| `pnpm --filter @haimang/orchestrator-core-worker typecheck/build/test` | 通过，`17 files / 159 tests` |
| `pnpm --filter @haimang/orchestrator-auth-worker typecheck/build/test` | 通过，`4 files / 19 tests` |
| `pnpm --filter @haimang/agent-core-worker typecheck/build/test` | 通过，`100 files / 1067 tests` |
| `pnpm --filter @haimang/filesystem-core-worker typecheck/build/test` | 通过 |
| `pnpm check:cycles` | 通过，0 circular dependency |
| `pnpm test:contracts` | 通过，31 tests |
| `pnpm test:e2e` local skip-mode | 通过，56 tests / 1 pass / 55 skipped / 0 fail |
| sequential live E2E | 通过，`NANO_AGENT_LIVE_E2E=1 node --test --test-concurrency=1 test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs` → `56 tests / 27 pass / 29 skipped / 0 fail` |

---

## 5. 最终结论

- **是否建议关闭 RHX1**：`yes`
- **是否存在 blocker**：`no`
- **是否已经完成 owner 要求的 D1 reset/redeploy/test**：`yes`
- **仍需注意**：manual evidence、Lane E 全量 sunset、token-level streaming 决策、多租户/admin/billing/control-plane 等继续 deferred，但它们不是 RHX1 blocker。
