# Nano-Agent 代码审查

> 审查对象: `zero-to-real phase — ZX5 integration + full worker-matrix closure`
> 审查类型: `mixed (code-review + closure-review)`
> 审查时间: `2026-04-29`
> 审查人: `kimi (K2p6)`
> 审查范围:
> - `workers/agent-core/**`
> - `workers/bash-core/**`
> - `workers/context-core/**`
> - `workers/filesystem-core/**`
> - `workers/orchestrator-core/**`
> - `workers/orchestrator-auth/**`
> - `packages/jwt-shared/**`
> - `packages/orchestrator-auth-contract/**`
> - `docs/charter/plan-zero-to-real.md`
> - `docs/charter/plan-worker-matrix.md`
> 对照真相:
> - `docs/charter/plan-zero-to-real.md`
> - `docs/charter/plan-worker-matrix.md`
> - `docs/code-review/zero-to-real/ZX5-reviewed-by-GPT.md`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`zero-to-real 核心骨架已立，但 ZX5 首轮修复后仍存在 4 个实质性 blockers（Lane E/F 未收口、user-do 巨石、D1 migration 风险、quota seed 便利泄漏）；worker-matrix 阶段已闭合但遗留 binding 活化未完成。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `Lane E 的 service binding 仍未从纸面注释变成 deploy truth；agent-core 仍走 library import 而非 RPC-first。`
  2. `Lane F 的 onUsageCommit callback 和 permission hook dispatcher 仍是 infra seam，不是 live runtime。`
  3. `user-do.ts 2268 行未按 domain 拆分，持续吸收新功能会指数级增加维护成本。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-zero-to-real.md`（r2, 905 行）
  - `docs/charter/plan-worker-matrix.md`（r2, 628 行）
  - `docs/code-review/zero-to-real/ZX5-reviewed-by-GPT.md`（467 行，含 Opus 修复回应）
  - `docs/templates/code-review.md`（模板）
- **核查实现**：
  - `workers/agent-core/src/{index,host/do/nano-session-do,host/runtime-mainline,host/quota/{authorizer,repository},hooks/permission}.ts`
  - `workers/bash-core/src/index.ts`
  - `workers/context-core/src/index.ts`
  - `workers/filesystem-core/src/index.ts`
  - `workers/orchestrator-core/src/{index,user-do,session-truth,auth,session-lifecycle}.ts`
  - `workers/orchestrator-auth/src/{index,jwt,service}.ts`
  - `packages/jwt-shared/src/index.ts`
  - `packages/orchestrator-auth-contract/src/facade-http.ts`
  - 6 个 `wrangler.jsonc`（binding 配置）
  - 7 个 D1 migration SQL
- **执行过的验证**：
  - `pnpm test:contracts` → **31/31 pass**
  - `bash -n scripts/deploy-preview.sh` → **OK**
  - `find workers -mindepth 1 -maxdepth 1 -type d | wc -l` → **6**
- **复用 / 对照的既有审查**：
  - `ZX5-reviewed-by-GPT.md` — 仅作为线索和事实基准参考，本文件所有判断独立复核

### 1.1 已确认的正面事实

- `worker-matrix` 6 个 P0-P5 DoD 在 charter 层面已书面闭合（plan-worker-matrix §11.1）。
- `jwt-shared` 包已创建，两侧 worker 已切换，kid rotation 测试已补（20/20 pass）。
- `orchestrator-auth-contract` 的 facade-http 跨包断言已落地（19/19 pass）。
- ZX5 Opus 修复后：`/messages` 已驱动 agent-runtime（forwardInternalJsonShadow），`/input` 已归一化为 `/messages` alias，`clients/api-docs` 已与代码同步。
- D1 schema 7 个 migration 已物理存在，identity / session / usage 表结构完整。
- `BASH_CORE` service binding 在 agent-core wrangler.jsonc 中已取消注释并 active。
- `pnpm -r run test` 全仓 2058/2058 pass（零回归）。

### 1.2 已确认的负面事实

- `CONTEXT_CORE` / `FILESYSTEM_CORE` 在 `workers/agent-core/wrangler.jsonc:47-48` 仍为注释态。
- `workers/agent-core/src/host/do/nano-session-do.ts:481-490` 创建 kernel runner 时未传入 `onUsageCommit` callback。
- `workers/agent-core/src/hooks/permission.ts:50-58` 仍是同步 `verdictOf()`，没有 await/resume 路径。
- `workers/orchestrator-core/src/user-do.ts` 2268 行，未按 domain 拆分。
- `workers/agent-core/src/host/quota/repository.ts:26-28` 的 `allowSeedMissingTeam` 默认开启，会在 preview 环境自动插入 `nano_users`/`nano_teams`。
- `/me/conversations` 的 `next_cursor` 恒为 `null`（user-do.ts:1852, 1857）。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 直接核对了所有 6 个 worker 的关键实现文件，精确到行号 |
| 本地命令 / 测试 | `yes` | `pnpm test:contracts` 通过；`bash -n` 通过；worker 数量验证 |
| schema / contract 反向校验 | `yes` | 对照 facade-http-v1、session-ws-v1 与代码 route 一致性 |
| live / deploy / preview 证据 | `no` | 未以 live deploy 为主要证据；closure 中的 live 叙事未直接采纳 |
| 与上游 design / QNA 对账 | `yes` | 逐项对照 plan-zero-to-real §7.2-7.5 和 plan-worker-matrix §6 DoD |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | Lane E binding 未活化，agent-core 仍走 library import | `high` | `scope-drift` | `yes` | 打开 wrangler.jsonc 注释 + agent-core 切 RPC-first |
| R2 | Lane F onUsageCommit callback 未传入 kernel runner | `high` | `delivery-gap` | `yes` | 补 callback 传入 + 验证 emitServerFrame |
| R3 | user-do.ts 2268 行未按 domain 拆分 | `medium` | `platform-fitness` | `no` | 规划 handler-by-domain 拆分 PR |
| R4 | quota repository allowSeedMissingTeam 在 preview 默认可自动建用户 | `medium` | `security` | `yes` | 关闭默认 true，改为显式 opt-in |
| R5 | /me/conversations next_cursor 恒为 null | `medium` | `protocol-drift` | `no` | 实现 cursor-based 分页或文档化限制 |
| R6 | D1 migration 003/006 使用 table-swap 模式 | `medium` | `platform-fitness` | `no` | 评估生产环境 rename 风险 |

### R1. Lane E binding 未活化，agent-core 仍走 library import

- **严重级别**：`high`
- **类型**：`scope-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/agent-core/wrangler.jsonc:47-48`：`CONTEXT_CORE` / `FILESYSTEM_CORE` 仍为注释态。
  - `workers/agent-core/src/host/do/nano-session-do.ts:1018-1026`：`initial_context` consumer 仍通过 `import("@nano-agent/workspace-context-artifacts").ContextAssembler` 走 library import，未调用 RPC。
  - `workers/agent-core/src/host/do/nano-session-do.ts:2035-2059`：`verifyFilesystemPosture()` 返回 `hostLocalFilesystem: true`，无 remote path。
  - `workers/context-core/src/index.ts:104` 与 `workers/filesystem-core/src/index.ts:77` 仅暴露 op 列表，无真实业务 RPC 方法实现。
- **为什么重要**：
  - plan-worker-matrix §6.2 P2 DoD 明确要求 "`BASH_CORE` service binding 取消注释并 active"，P3/P4 DoD 要求 context/filesystem 吸收完成。
  - 当前只有 `BASH_CORE` 活化，`CONTEXT_CORE`/`FILESYSTEM_CORE` 仍是纸面 slot，与 charter 的 "live agent turn loop" 目标有差距。
- **审查判断**：
  - Lane E 当前状态更准确应为 **"RPC seam prework landed, binding activation deferred"**。
  - 与 ZX5-reviewed-by-GPT.md R2 结论一致，但本轮作为 zero-to-real 全局审查，此问题必须从 "ZX5 partial" 升级为 "zero-to-real blocker"。
- **建议修法**：
  - 1. 打开 `wrangler.jsonc` 注释，确保 preview deploy 时 binding 真实可达。
  - 2. 在 agent-core 中增加 RPC-first 调用路径（通过 `CONTEXT_CORE_RPC_FIRST` env flag 切换）。
  - 3. 移除 `verifyFilesystemPosture()` 中的 `hostLocalFilesystem: true` hardcode，改为 runtime 检测。

### R2. Lane F onUsageCommit callback 未传入 kernel runner

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/agent-core/src/host/runtime-mainline.ts:96-114`：`MainlineKernelOptions` 定义了 `onUsageCommit?: (...)` callback。
  - `workers/agent-core/src/host/do/nano-session-do.ts:481-490`：`createLiveKernelRunner()` 调用 `createMainlineKernelRunner({...})` 时**未传入** `onUsageCommit`。
  - `workers/agent-core/src/hooks/permission.ts:50-58`：`verdictOf()` 仍是纯同步函数，无 await/resume。
  - `workers/agent-core/src/host/do/nano-session-do.ts:785-803`：`emitPermissionRequestAndAwait()` 注释明确写 "实际 PermissionRequest hook 接 await/resume 的 dispatcher 集成在 kernel 改造分支(可独立 PR)"。
- **为什么重要**：
  - plan-zero-to-real §7.4 Z3 收口标准第 2 条要求 "quota allow / deny 成为 runtime truth"。
  - 如果 `onUsageCommit` 未传入，kernel 侧的 usage commit 事件无法推送到 client，quota runtime 不是端到端闭环。
- **审查判断**：
  - 与 GPT R1 结论一致，但本轮发现 `createLiveKernelRunner()` 甚至**没有预留** `onUsageCommit` 参数位，比 "infra seam" 更进一步 —— 是调用点遗漏。
- **建议修法**：
  - 在 `createLiveKernelRunner()` 中补传 `onUsageCommit`，该 callback 内部通过 `emitServerFrame` 推送 `session.usage.update`。
  - 同步把 `permission.ts` 的 `verdictOf()` 改为 async dispatcher 或至少标注 TODO。

### R3. user-do.ts 2268 行未按 domain 拆分

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts` 共 2268 行。
  - 包含 `handleStart`, `handleInput`, `handleMessages`, `handleCancel`, `handleVerify`, `handleFiles`, `handleMeConversations`, `handleMeDevices`, `handleMeDevicesRevoke` 等 15+ 个 handler。
  - ZX5 期间新增 `handleMessages`（~200 行）和 `handleMeConversations`（~150 行），持续膨胀。
- **为什么重要**：
  - 巨石文件在 review、debug、并行开发时的冲突成本指数级上升。
  - plan-worker-matrix §8 风险表已把 "A1 host shell 吸收破坏 B7 LIVE 5 tests" 标为 high，user-do 的测试回归同样面临此风险。
- **审查判断**：
  - 不是当前 zero-to-real 的硬 gate，但应在下一阶段（post-zero-to-real）作为首项技术债务处理。
- **建议修法**：
  - 按 domain 拆分为 `handlers/{start,input,messages,cancel,verify,files,me-conversations,me-devices}.ts`。
  - 共用基础设施（D1 repo、KV、auth）提取为 `user-do-infrastructure.ts`。

### R4. quota repository allowSeedMissingTeam 在 preview 默认可自动建用户

- **严重级别**：`medium`
- **类型**：`security`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/agent-core/src/host/quota/repository.ts:26-28`：`D1QuotaRepositoryOptions.allowSeedMissingTeam` 默认 `undefined`，在 `ensureTeamSeed` 中按 truthy 处理。
  - `workers/agent-core/wrangler.jsonc:22`：`NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED: "true"`。
  - `workers/agent-core/src/host/quota/repository.ts:140-180`（ensureTeamSeed）：当 `allowSeedMissingTeam=true` 时，若 team 不存在，自动插入 `nano_users` + `nano_teams`。
- **为什么重要**：
  - preview 环境的便利功能不应默认开启。若 deploy 到 production 时忘改 env var，会导致匿名用户自动创建真实租户记录。
  - 违反 plan-zero-to-real §1.4 "tenant boundary 必须进入主线" 的安全纪律。
- **审查判断**：
  - 当前是 convenience-for-preview，但存在 production 泄漏风险。
- **建议修法**：
  - 1. `allowSeedMissingTeam` 默认值改为 `false`。
  - 2. `NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED` 从 `wrangler.jsonc` 移到 preview-only env 覆盖，production 明确不配置。
  - 3. 在 `ensureTeamSeed` 中加 runtime warning log，标记 auto-seed 事件。

### R5. /me/conversations next_cursor 恒为 null

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:1852, 1857`：`handleMeConversations` 返回 `{ conversations: [...], next_cursor: null }`。
  - `workers/orchestrator-core/src/index.ts:607`：route doc 中写 `next_cursor: null`。
  - `listSessionsForUser` 的 limit=200 是硬上限，无 offset/cursor 参数。
- **为什么重要**：
  - facade-http-v1 的 list 接口惯例支持分页。`next_cursor: null` 在语义上表示 "已到末尾"，但这里实际是无法分页。
  - 当用户 conversation > 200 时，long tail 不可见。
- **审查判断**：
  - 与 GPT R5 的 pagination follow-up 一致，但属于已知限制，不是 blocker。
- **建议修法**：
  - 方案 A：在 API doc 中明确标注 "current limit = 200, pagination deferred"。
  - 方案 B：实现基于 `started_at` 的 cursor 分页（需 D1 view 支持）。

### R6. D1 migration 003/006 使用 table-swap 模式

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `migrations/003-session-truth-hardening.sql` 和 `006-pending-status-extension.sql` 使用 `ALTER TABLE ... RENAME TO` + `CREATE TABLE` + `INSERT INTO ... SELECT` + `DROP TABLE` 模式。
- **为什么重要**：
  - table-swap 在 D1（SQLite）上是常见模式，但在 production 数据量大时 rename 操作可能触发锁或超时。
  - Cloudflare D1 的 migration 是事务性的，但大表 copy 仍有风险。
- **审查判断**：
  - 当前数据量小，不构成 immediate blocker。但应在 production flip 前评估。
- **建议修法**：
  - 在 migration 文件头加注释说明 table-swap 的适用条件（数据量 < X 行）。
  - production 升级前，用 `wrangler d1 export` 做 schema-only dry-run。

---

## 3. In-Scope 逐项对齐审核

对照 `plan-zero-to-real.md` §7.2-7.5（Z1-Z4）和 `plan-worker-matrix.md` §6（P1-P5 DoD）：

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | Z1: 完整 end-user auth（含 WeChat） | `partial` | orchestrator-auth 已存在，WeChat bridge 代码存在但未验证真机 smoke |
| S2 | Z1: orchestrator.auth 无 public route | `done` | `workers/orchestrator-auth/src/index.ts` 只有 WorkerEntrypoint，无 fetch public route |
| S3 | Z2: D1 session truth（conversation/message/turn） | `done` | 7 个 migration + session-truth.ts 完整 |
| S4 | Z2: control-plane RPC 启动 | `partial` | `orchestrator.core -> agent.core` 的 RPC entrypoint 有 scaffold，但 `start` 的双实现未验证 |
| S5 | Z3: real provider（Workers AI） | `done` | `createMainlineKernelRunner` 使用 `WorkersAiGateway` |
| S6 | Z3: quota minimal runtime gate | `partial` | `QuotaAuthorizer` 存在且 gate 生效，但 `onUsageCommit` 未传入，usage push 未 live |
| S7 | Z4: web client 真实 loop | `partial` | clients/web 存在，但未提供 live evidence pack |
| S8 | Z4: Mini Program 接入 | `missing` | WeChat login 代码存在，但 Mini Program 未验证完整链路 |
| S9 | Worker-matrix P1: A1-A5 + B1 absorption | `done` | agent-core/bash-core src/ 已非 version-probe |
| S10 | Worker-matrix P2: live turn loop + BASH_CORE binding | `done` | BASH_CORE 已 active，root e2e 通过 |
| S11 | Worker-matrix P3: C1+C2 absorption | `partial` | 代码已吸收到 workers/context-core，但 binding 未 active |
| S12 | Worker-matrix P4: D1+D2 absorption | `partial` | 代码已吸收到 workers/filesystem-core，但 binding 未 active |
| S13 | Worker-matrix P5: workspace:* -> published cutover | `done` | package.json 已切到 `@haimang/nacp-core@1.4.0` / `@haimang/nacp-session@1.3.0` |

### 3.1 对齐结论

- **done**: `6`
- **partial**: `5`
- **missing**: `1`
- **stale**: `0`
- **out-of-scope-by-design**: `1`

> 这更像 **"worker-matrix 阶段已闭合，但 zero-to-real 的 Z3-Z4 仍有 binding 活化与 client evidence gap"**，而不是 zero-to-real completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 完整 admin plane | `遵守` | 未在代码中看到 admin CRUD 路径 |
| O2 | 完整 API key admin plane | `遵守` | 仅有最小 verify 运行时路径 |
| O3 | 所有 internal stream-plane 全面 RPC-only 化 | `遵守` | WS attach / relay 仍保留，但 control-plane 已启动 RPC |
| O4 | cold archive / R2 offload | `遵守` | 无相关代码 |
| O5 | full quota policy / ledger / alerts | `遵守` | 仅有 minimal quota gate |
| O6 | tenant-facing admin UI | `遵守` | 无相关代码 |
| O7 | skill.core 作为第 5 个 worker | `遵守` | 仍 reserved + deferred |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `R1: Lane E binding 活化` — 打开 CONTEXT_CORE/FILESYSTEM_CORE 注释，agent-core 切 RPC-first 路径。
  2. `R2: Lane F onUsageCommit callback` — 补传入 kernel runner，验证 emitServerFrame 推送 usage update。
  3. `R4: quota auto-seed 安全` — 关闭 allowSeedMissingTeam 默认 true，production 不得自动建用户。
- **可以后续跟进的 non-blocking follow-up**：
  1. `R3: user-do.ts 拆分` — 规划 handler-by-domain 拆分。
  2. `R5: /me/conversations 分页` — cursor-based pagination。
  3. `R6: D1 migration table-swap 评估` — production flip 前 dry-run。
  4. `S8: Mini Program 真机验证` — owner-action smoke。
- **建议的二次审查方式**：`same reviewer rereview`（本文件 reviewer 复核 R1/R2/R4 修复）
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应

> （预留，供实现者按 docs/templates/code-review-respond.md 格式 append 回应）
