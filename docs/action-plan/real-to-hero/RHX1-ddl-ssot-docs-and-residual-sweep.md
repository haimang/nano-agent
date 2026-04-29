# Nano-Agent 行动计划 — RHX1 DDL SSOT + Docs/Index Hygiene + Deferred Sweep

> 服务业务簇: `real-to-hero / RHX1`
> 计划对象: `在 RH6 之后做一个专项收敛阶段：整理 orchestrator-core migration DDL，建立按业务簇可读的 schema SSOT；更新 workers/package/test 的 README 与索引；扫 RH0-RH6 遗留问题，能解决的继续解决，不能解决的在 RHX1 closure 里说明原因`
> 类型: `refactor + docs + cleanup`
> 作者: `Owner + Copilot`
> 时间: `2026-04-29`
> 文件位置:
> - `workers/orchestrator-core/migrations/**`
> - `workers/*/README.md`
> - `packages/*/README.md`
> - `test/index.md`
> - `docs/issue/real-to-hero/RHX1-closure.md`
> 上游前序 / closure:
> - `docs/issue/real-to-hero/RH4-closure.md`
> - `docs/issue/real-to-hero/RH5-closure.md`
> - `docs/issue/real-to-hero/RH6-closure.md`
> - `docs/charter/plan-real-to-hero.md` §16
> 文档状态: `executed`

---

## 0. 执行背景与目标

RH0-RH6 解决了产品主链，但仓库层面仍存在三类“进入下一阶段前必须收敛”的维护性问题：

1. **migration 目录已经成为时间顺序日志，不再是可读的 schema 真相入口**。现在 `workers/orchestrator-core/migrations/` 内的 SQL 大量散落，DDL 想按业务簇理解（auth、session truth、usage、models、files、devices、API keys）需要跨多个文件来回跳转。
2. **worker/package/test 的 README 与索引不足或过期**。当前各个 `workers/*/README.md`、`packages/*/README.md` 基本都落后于 RH6 后的真实目录结构与命令入口；`test/` 下面也缺少统一的导航索引。
3. **RH0-RH6 deferred / carry-over 需要再扫一轮**。有些问题已经在代码现实里被部分消化，有些仍然应该继续修，有些则必须诚实地继续 deferred，不能只留在散落 closure 里。

RHX1 的目标不是重新打开产品需求，而是把上述三类工程债一次收敛成 **可读、可导航、可追责** 的基线。

---

## 1. 核心策略

### 1.1 DDL SSOT 采用“当前目录自身固化”

RHX1 不再为 DDL 额外建立 `ssot/` 子目录或 README，而是直接把 **`workers/orchestrator-core/migrations/` 当前 SQL 集合本身** 整理成 SSOT：

1. 对零散 SQL 做业务簇分析；
2. 清理开发过程中不和谐、重复、风格不统一的部分；
3. 把当前 SQL 文件重组为可直接阅读、可按业务簇理解的固化集合。

执行时仍需保留对“已发布编号 / 已 apply 现实”的可追溯性，但 SSOT 载体就是整理后的当前 migration 文件本身，而不是额外再造一层目录。

### 1.2 文档更新采用“叶子 README 全量校正 + test 索引补齐”

RHX1 不把重点放在新建 `workers/README.md` 或 `packages/README.md`，而是要求：

1. **把现有全部 `workers/*/README.md` 更新到当前代码现实**
2. **把现有全部 `packages/*/README.md` 更新到当前代码现实**
3. **在 `test/` 下补一份索引文件**，更好地引导测试

所有更新后的 README 统一包含：

- 目录树
- 角色 / 责任
- 关键入口文件
- 主要验证命令
- 与其他 worker/package/test 的关系

### 1.3 Deferred sweep 采用“三分法”

每个 RH0-RH6 遗留项必须落入以下三类之一：

1. **在 RHX1 内解决**
2. **在 RHX1 内明确降级 / 不解决，并说明原因**
3. **超出 RHX1 范围，明确 handoff 到 hero-to-platform 或 owner-side**

不允许继续保持“只在旧 closure 里提过一次”的悬空状态。

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** `workers/orchestrator-core/migrations/*.sql` 全量扫描与业务簇重组
- **[S2]** 当前 `workers/orchestrator-core/migrations/*.sql` 自身的业务簇重组、合并与格式统一
- **[S3]** 全量 `workers/*/README.md`、`packages/*/README.md` stale 内容校正
- **[S4]** test 索引文件与测试导航增强
- **[S5]** RH0-RH6 deferred / carry-over 复盘与 RHX1 处理映射
- **[S6]** `docs/issue/real-to-hero/RHX1-closure.md`

### 2.2 Out-of-Scope

- **[O1]** 修改 production 数据库现实；preview/test D1 reset 仅在 owner 明确要求后执行
- **[O2]** 新功能 / 新 endpoint / 新 provider / 新 worker
- **[O3]** manual evidence 采集
- **[O4]** hero-to-platform 级别的大平台设计

---

## 3. 直接产出

1. **DDL SSOT**
   - `workers/orchestrator-core/migrations/*.sql` 本身完成业务簇重组与统一格式
2. **README / index 校正**
   - 全量 `workers/*/README.md`
   - 全量 `packages/*/README.md`
   - `test/index.md`
3. **RHX1 closure**
   - `docs/issue/real-to-hero/RHX1-closure.md`

---

## 4. Phase 总览

| Phase | 名称 | 规模 | 依赖 |
|------|------|------|------|
| Phase 1 | Migration inventory + cluster map | M | RH6 closure |
| Phase 2 | Current migrations consolidation | L | Phase 1 |
| Phase 3 | worker/package README refresh | M | Phase 1 |
| Phase 4 | test index / test guidance refresh | S | Phase 3 |
| Phase 5 | RH0-RH6 deferred sweep + opportunistic fixes | M | Phase 1-4 |
| Phase 6 | RHX1 closure | S | Phase 1-5 |

---

## 5. 业务工作总表

| 编号 | Phase | 工作项 | 类型 | 文件 | 风险 |
|------|-------|--------|------|------|------|
| X1-01 | 1 | migration inventory + DDL cluster map | docs | `workers/orchestrator-core/migrations/**` | medium |
| X1-02 | 2 | 当前 migration 文件按业务簇合并与格式统一 | refactor | `workers/orchestrator-core/migrations/*.sql` | medium |
| X1-03 | 3 | 全量 worker/package README 校正 | docs | `workers/*/README.md`, `packages/*/README.md` | medium |
| X1-04 | 4 | `test/index.md` + test tree 导航 | add/docs | `test/index.md` | low |
| X1-05 | 5 | RH0-RH6 deferred triage matrix | docs | `docs/issue/real-to-hero/RHX1-closure.md` | low |
| X1-06 | 5 | 可闭合 residual 的代码/文档修补 | mixed | repo-wide targeted files | medium |
| X1-07 | 6 | RHX1 closure 定稿 | docs | `docs/issue/real-to-hero/RHX1-closure.md` | low |

---

## 6. Phase 详细说明

### 6.1 Phase 1 — Migration inventory + cluster map

- 扫描 `workers/orchestrator-core/migrations/*.sql` 的全部 DDL。
- 把 schema 划分到业务簇：
  1. identity / auth / teams
  2. session truth / turns / timeline / history
  3. usage / evidence
  4. models / model policy
  5. files / artifacts
  6. devices / API keys
- 明确每个业务簇由哪些历史 migration 累积而来。

### 6.2 Phase 2 — Current migrations consolidation

- 直接在 `workers/orchestrator-core/migrations/` 当前文件集合内完成业务簇重组。
- 清理碎片、合并不和谐 SQL、统一格式与头部说明。
- 目标不是再加一层目录，而是让 **当前 migration 文件本身** 变成可固化阅读的 DDL SSOT。

### 6.3 Phase 3 — worker/package README refresh

- 全量更新现有 `workers/*/README.md` 与 `packages/*/README.md`
- 使用树状结构概览目录、职责、入口、验证命令
- 至少覆盖：
  - `workers/agent-core/README.md`
  - `workers/orchestrator-core/README.md`
  - `workers/context-core/README.md`
  - `workers/filesystem-core/README.md`
  - `workers/bash-core/README.md`
  - `packages/nacp-session/README.md`
  - `packages/nacp-core/README.md`
  - `packages/orchestrator-auth-contract/README.md`
  - `packages/storage-topology/README.md`
  - `packages/workspace-context-artifacts/README.md`
  - `packages/eval-observability/README.md`

### 6.4 Phase 4 — test index / guidance refresh

- 新建 `test/index.md`
- 说明：
  - root contracts
  - `test/package-e2e`
  - `test/cross-e2e`
  - worker-local tests（例如 `workers/orchestrator-core/test`）
- 给出按业务链条查找测试的导航方式

### 6.5 Phase 5 — RH0-RH6 deferred sweep + opportunistic fixes

- 以 `real_to_hero_deferred_map`、RH4/RH5/RH6 closure、blocked todo 为输入
- 逐项判断：
  - 已在 RH0-RH6 期间实际解决但文档未收口
  - 适合在 RHX1 顺手闭合
  - 明确不应在 RHX1 解决
- 仅当问题与 DDL/README/index/test-hygiene 或低风险 residual 强相关时，才纳入 RHX1 代码修补

### 6.6 Phase 6 — RHX1 closure

RHX1 closure 必须包含：

1. 之前 deferred / carry-over 的完整台账
2. 哪些在 RHX1 内解决了
3. 哪些仍未解决
4. 每个未解决项**为什么不解决**
5. 是否 blocker、下游落点、是否需要 owner

---

## 7. 风险与约束

| 风险 | 描述 | 判断 | 应对 |
|------|------|------|------|
| DDL SSOT 与真实 migration 漂移 | 只做文档整理，不核回 SQL 细节会产生新 SSOT 假象 | high | 逐 migration 扫描、按表/索引/约束回绑 |
| README 过度理想化 | 文档写成“目标结构”而不是“当前结构” | medium | 全部以当前代码树与命令为准 |
| Deferred sweep 越界 | 把 hero-to-platform 问题误收进 RHX1 | medium | 每项都写 why-in / why-out |
| 顺手修 residual 引入回归 | RHX1 以整理为主，补代码应保持低风险 | medium | 只做 targeted fix，并跑对应验证 |

---

## 8. 收口标准

1. 当前 `migrations/` 文件自身已按业务簇整理并统一格式，可直接承担 DDL SSOT
2. 全量现有 worker/package README 已与当前代码现实对齐
3. `test/index.md` 已建立并可导航
4. RHX1 closure 已明确列出“之前 deferred 哪些解决了、哪些没解决、为什么不解决”
5. RHX1 不引入新的 schema / docs / test drift

---

## 9. RHX1 closure 约定

RHX1 完成后，必须回填：

- `docs/issue/real-to-hero/RHX1-closure.md`

closure 至少要有以下 4 节：

1. **一句话 verdict**
2. **当前 migration SQL 整理结果 + README/index 导航产出**
3. **deferred / carry-over 处理台账**
4. **仍未解决项与原因**

---

## 10. 工作日志回填

### 10.1 DDL inventory 与业务簇重组

扫描 `workers/orchestrator-core/migrations/` 原 12 个 migration 后确认问题不是缺一个 README，而是 SQL 本身已经变成开发期时间线：

- session truth 先在 `002` 建表，再由 `003` hardening table-swap，再由 `006` pending/expired table-swap 修补；
- usage/quota 先在 `004` 建表，再由 `005` 加 `provider_key`，再由 `011` 加 model/tokens/cost evidence，最后由 `012` repair stale FK；
- model catalog 在 `008` 建表、`011` 扩展 seed；
- team display / API key salt / auth session device_uuid 落在 `009`；
- files/devices 分散在 `010` / `007`。

RHX1 将当前 migration 目录原地收敛为 5 个业务簇：

1. `001-identity-core.sql`
   - users、profiles、identities、teams、memberships、auth sessions、team API keys；
   - 合并 `team_name`、`team_slug`、`key_salt`、`device_uuid`；
   - 补齐当前 runtime 需要的索引与 FK。
2. `002-session-truth-and-audit.sql`
   - conversations、sessions、turns、messages、context snapshots、activity logs；
   - 固化 `pending/starting/active/detached/ended/expired`；
   - 固化 audit payload 8 KiB 上限、session/turn/message indexes 与 recent audit view。
3. `003-usage-quota-and-models.sql`
   - quota balances、usage events、provider/model/token/cost/request evidence；
   - model catalog、team model policy、25 条 RH5 模型 seed；
   - 把 stale FK repair 直接转化为当前正确建表形态。
4. `004-session-files.sql`
   - D1 file metadata、R2 key unique、session/team indexes。
5. `005-user-devices.sql`
   - device canonical truth 与 revoke audit。

删除开发期碎片：

- `003-session-truth-hardening.sql`
- `004-usage-and-quota.sql`
- `005-usage-events-provider-key.sql`
- `006-pending-status-extension.sql`
- `007-user-devices.sql`
- `008-models.sql`
- `009-team-display-and-api-keys.sql`
- `010-session-files.sql`
- `011-model-capabilities-seed.sql`
- `012-usage-events-fk-repair.sql`

### 10.2 D1 preview/test reset 与 migration apply

按 owner 要求先列出远端 D1，确认只处理明确属于 nano-agent preview/test 的数据库：

- 删除 `nano-agent-preview` / `71a4b089-93e0-4d8f-afb8-bc9356a97cfa`
- 删除 `nano_agent_spike_do_storage_d1_r2` / `702a9160-a3f3-453f-bde4-aa65d5f2bd30`
- 删除 `nano_agent_spike_do_storage_d1` / `e9adb012-4896-473e-bf3b-c9e1f4890842`

未删除 `smind-*`、`wbca_db` 等非 nano-agent 数据库。

重新创建：

- `nano-agent-preview` / `421bf213-f3af-4d79-9de0-9cdb5e61e747` / `APAC`

同步更新：

- `workers/orchestrator-core/wrangler.jsonc`
- `workers/orchestrator-auth/wrangler.jsonc`
- `workers/agent-core/wrangler.jsonc`
- `workers/filesystem-core/wrangler.jsonc`

验证：

- local D1 apply consolidated 5 migrations 成功；
- remote D1 apply consolidated 5 migrations 成功；
- remote schema 出现 20 张 `nano_*` 表；
- `nano_models` seed count = 25；
- write/FK smoke 覆盖 user/team/session/turn/message/activity/usage/file/device/revoke/model-policy 后清理测试行；
- `wrangler d1 migrations list nano-agent-preview --remote` 显示 no pending migrations。

### 10.3 README / test index 刷新

刷新或补齐：

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
- `test/INDEX.md` 旧引用兼容指针

刷新过程中纠正的 stale facts：

- `bash-core` 不再是 shell-only；
- `context-core` / `filesystem-core` 是 library-runtime + health-probe shell；
- `orchestrator-core` README 增加当前 D1 migration SSOT 文件树；
- `orchestrator-auth`、`jwt-shared` 缺失 per-unit README，已补齐；
- `nacp-session` README 保留 root guardian 依赖的 baseline/compat/followup_input 契约文本。

### 10.4 Live 验证暴露并修复 agent-core start 回归

preview redeploy 后首次 sequential live E2E 暴露真实断点：

- auth、health、files 链路可用；
- 所有需要 `agent-core internal start` 的 session 链路返回 502；
- D1 audit 中记录 `session.start.failed` / `{"error":"agent-rpc-throw"}`；
- `wrangler tail` 显示实际异常为：
  - `TypeError: Cannot read properties of undefined (reading 'capability')`

定位原因：

- `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` 在 assembly 阶段创建 live kernel runner；
- 旧实现通过 `ctx.getCapabilityTransport()` 间接调用 `this.getCapabilityTransport()`；
- 此时 `this.subsystems` 尚未在 `NanoSessionDO` constructor 中赋值；
- 因此 live RPC start 在真正进入 session turn 前抛错。

修复：

- `runtime-assembly.ts` 改为从已构造的 `subsystems.capability.serviceBindingTransport` 读取 capability transport；
- 不再在 assembly 阶段触碰未初始化的 `this.subsystems`；
- agent-core 重新 typecheck/build/test/deploy preview。

### 10.5 验证结果

通过：

- `pnpm --filter @haimang/orchestrator-core-worker typecheck`
- `pnpm --filter @haimang/orchestrator-core-worker build`
- `pnpm --filter @haimang/orchestrator-core-worker test` — 17 files / 159 tests
- `pnpm --filter @haimang/orchestrator-auth-worker typecheck`
- `pnpm --filter @haimang/orchestrator-auth-worker build`
- `pnpm --filter @haimang/orchestrator-auth-worker test` — 4 files / 19 tests
- `pnpm --filter @haimang/agent-core-worker typecheck`
- `pnpm --filter @haimang/agent-core-worker build`
- `pnpm --filter @haimang/agent-core-worker test` — 100 files / 1067 tests
- `pnpm --filter @haimang/filesystem-core-worker typecheck`
- `pnpm --filter @haimang/filesystem-core-worker build`
- `pnpm --filter @haimang/filesystem-core-worker test`
- `pnpm check:cycles`
- `pnpm test:contracts`
- `pnpm test:e2e`
- `NANO_AGENT_LIVE_E2E=1 node --test --test-concurrency=1 test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs`
  - final result: `56 tests / 27 pass / 29 skipped / 0 fail`

### 10.6 Deferred sweep 结论

RHX1 内解决：

- DDL fragmentation / migration repair residue；
- stale worker/package README；
- test navigation；
- missing per-unit README；
- preview/test D1 reset + redeploy；
- live start assembly 初始化 bug。

继续 deferred：

- manual browser / 微信开发者工具 / 真机 evidence pack：owner/device-side；
- token-level live streaming 产品决策：hero-to-platform / protocol-product；
- DO websocket heartbeat lifecycle platform-fit hardening：hero-to-platform runtime hardening；
- tool registry 与 client session helper SSOT 抽取：SDK/platform architecture；
- richer admin/billing/control plane：平台功能；
- broader multi-tenant-per-deploy：平台 tenancy/RPC；
- RH4 Lane E 全量 consumer sunset：独立迁移；
- RH6 `user-do-runtime.ts` handler 级继续拆分：后续专项 refactor。
