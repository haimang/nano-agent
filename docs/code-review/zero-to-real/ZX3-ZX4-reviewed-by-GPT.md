# Nano-Agent 代码审查 — ZX3~ZX4 reviewed by GPT

> 审查对象: `zero-to-real / ZX3 Components Deprecation + ZX4 Transport True Close + Session Semantics`
> 审查类型: `mixed`
> 审查时间: `2026-04-28`
> 审查人: `GPT-5.5`
> 审查范围:
> - `docs/action-plan/zero-to-real/ZX3-components-deprecation.md`
> - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md`
> - `docs/issue/zero-to-real/ZX3-closure.md`
> - `docs/issue/zero-to-real/ZX4-closure.md`
> - `packages/`
> - `test/`
> - `workers/orchestrator-core/`
> - `workers/agent-core/`
> 对照真相:
> - ZX3/ZX4 action-plan 的原始 scope、工作日志与 closure claim
> - 当前工作区真实代码与轻量命令验证
> 文档状态: `changes-requested`

---

## 0. 总结结论

ZX3 的组件退役与 `test-legacy/` 物理删除主线基本成立；ZX4 的 `internal-http-compat` 退役和 D1 pending truth 主线也成立，但 ZX4 closure 把“decision-forwarding contract 已落”写成“permission / elicitation round-trip 业务闭环”，并把“usage read from D1”接近写成“usage live push / 真客户端闭环”，存在实质性 over-claim。本轮不建议把 ZX3~ZX4 整体标记为完全关闭；可以关闭 ZX3，ZX4 需要以 follow-up / rereview 形式承认并修正 runtime consumer、usage push、prod migration 与文档漂移。

- **整体判断**：`ZX3 approve-with-followups；ZX4 changes-requested；整体不应标记为 fully closed`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. ZX3 的物理退役事实成立：`packages/` 已收敛为 6 个 keep-set，`test-legacy/` 已不存在，`test/root-guardians` 31 个合同测试通过。
  2. ZX4 的 transport 收口事实成立：orchestrator 已 RPC-only，agent-core `/internal/` 只保留 `stream` / `stream_snapshot`，但 `forwardInternalJsonShadow` 命名仍保留历史语义。
  3. ZX4 的 session semantics 不是完整业务闭环：permission / elicitation 只写入 DO storage，runtime waiter 明确未接；usage 已有 D1 写读路径，但 `session.usage.update` live push 仍未落地，prod migration 仍是 owner-action。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/zero-to-real/ZX3-components-deprecation.md`
  - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md`
  - `docs/issue/zero-to-real/ZX3-closure.md`
  - `docs/issue/zero-to-real/ZX4-closure.md`
- **核查实现**：
  - `package.json`
  - `pnpm-workspace.yaml`
  - `pnpm-lock.yaml`
  - `test/INDEX.md`
  - `test/root-guardians/*.test.mjs`
  - `workers/orchestrator-core/src/user-do.ts`
  - `workers/orchestrator-core/src/session-{lifecycle,read-model,truth}.ts`
  - `workers/orchestrator-core/migrations/006-pending-status-extension.sql`
  - `workers/agent-core/src/index.ts`
  - `workers/agent-core/src/host/internal.ts`
  - `workers/agent-core/src/host/do/nano-session-do.ts`
  - `workers/agent-core/src/host/quota/{authorizer,repository}.ts`
  - `workers/agent-core/src/host/runtime-mainline.ts`
- **执行过的验证**：
  - `node --test test/root-guardians/*.test.mjs` — 31/31 pass
  - `find packages -mindepth 1 -maxdepth 1 -type d`
  - `test -e test-legacy`
  - `find test/root-guardians -maxdepth 1 -name '*.test.mjs'`
  - `wc -l workers/orchestrator-core/src/user-do.ts workers/orchestrator-core/src/session-lifecycle.ts workers/orchestrator-core/src/session-read-model.ts workers/orchestrator-core/src/ws-bridge.ts workers/orchestrator-core/src/parity-bridge.ts`
  - `rg` 核对删除包引用、`permission-decision`、`elicitation-answer`、`nano_usage_events`、`SUPPORTED_INTERNAL_ACTIONS`
- **复用 / 对照的既有审查**：
  - `none` — 本报告只使用 action-plan、closure、当前代码和命令输出作为依据；未采纳其他 reviewer 的判断。

### 1.1 已确认的正面事实

- `packages/` 当前只有 `eval-observability` / `nacp-core` / `nacp-session` / `orchestrator-auth-contract` / `storage-topology` / `workspace-context-artifacts` 六个目录，符合 ZX3 v2 keep-set 收敛口径。
- `test-legacy/` 当前不存在；`test/root-guardians/` 当前有 6 个 `.test.mjs` 文件，`package.json` 的 `test:contracts` 已指向 `test/root-guardians/*.test.mjs`。
- `node --test test/root-guardians/*.test.mjs` 实测 31/31 pass。
- ZX4 migration 006 真实扩展了 `nano_conversation_sessions.session_status` CHECK 到 `pending / starting / active / detached / ended / expired`，并创建 pending GC index。
- `DurableSessionStatus` 与 `SessionStatus` 都已扩展到 6 状态。
- `D1SessionTruthRepository.mintPendingSession()` 使用 D1 `batch()` 同时插入 `nano_conversations` 与 `nano_conversation_sessions(status='pending')`，避免新建平行 pending 表。
- `orchestrator-core` 的 start/status/input/cancel/verify/timeline 路径已切到 RPC-only，缺 binding 时返回 `agent-rpc-unavailable`。
- `agent-core/src/host/internal.ts` 的 worker-level `/internal/` surface 已收紧为 `stream` / `stream_snapshot`。
- permission / elicitation 的 public facade → orchestrator user DO → agent-core RPC → session DO storage 写入链路已经存在。
- usage 不是纯 placeholder：`agent-core` 的 quota repository 会写 `nano_usage_events`，runtime mainline 对 Workers AI LLM path 调用 quota authorize / commit，orchestrator `handleUsage()` 会读 D1 snapshot。

### 1.2 已确认的负面事实

- `test/INDEX.md` 仍写着 `test-legacy/` 继续保留历史 contract / guardian 价值，和 ZX3 物理删除事实冲突。
- `pnpm-lock.yaml` 仍保留已删除 package 的 importer block：`agent-runtime-kernel`、`capability-runtime`、`context-management`、`hooks`、`llm-wrapper`、`session-do-runtime`。
- ZX3 closure 说 Phase 5 docs sync 已完成，但 `test/INDEX.md` 未同步；closure 说 5 guardians 迁移，但当前 `test/root-guardians` 有 5 个迁移 + 1 个新 guardian。
- ZX4 action-plan 原始 Phase 4/5/6 写的是 permission consumer/resolver、usage live push、full path；当前代码只完成 contract/read 部分，runtime waiter 与 `session.usage.update` push 明确留到 ZX5。
- `workers/agent-core/src/host/do/nano-session-do.ts` 注释明确说明 permission decision 存到 `permission/decisions/${requestUuid}` 后，“future kernel waiter” 仍未接入。
- `docs/issue/zero-to-real/ZX4-closure.md` 同时声称 migration 006 applied，并在风险表里写 prod 待 owner deploy；实际验证表命令是 `nano-agent-preview --remote`，不能等同 prod ready。
- `docs/issue/zero-to-real/ZX4-closure.md` 声称 `user-do.ts` 1950 → 1659 行；当前工作区 `wc -l` 为 `1910`，而 `session-lifecycle.ts` / `session-read-model.ts` 也声明 DO 方法体仍留在 `user-do.ts`。
- Phase 8 原计划是 7-day / ≥1000 turns parity observation；closure 承认按 owner direction fast-track 为 30-session burst × 2，即 180 facade calls，不是等价证据。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 所有 finding 均引用当前工作区文件与行号 |
| 本地命令 / 测试 | `yes` | 跑了 root guardians；做了目录、lockfile、行数核查 |
| schema / contract 反向校验 | `yes` | 核对了 migration 006、TS union、RPC action set、DO storage contract |
| live / deploy / preview 证据 | `no` | 未重新跑 preview deploy 或 live e2e；仅审查 closure 中给出的 live 证据是否与代码一致 |
| 与上游 design / QNA 对账 | `yes` | 对照 ZX3/ZX4 action-plan 与 closure 的 claim |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | ZX4 permission / elicitation 不是完整 round-trip，只是 storage contract | `high` | `delivery-gap` | `yes` | 修正 closure，或在 ZX5 前补 runtime waiter + e2e |
| R2 | ZX4 usage 已有 D1 read/write，但 live push 与 non-null 保证未达 action-plan 原标准 | `medium` | `delivery-gap` | `yes` | 把 Phase 5 标为 partial，补 `session.usage.update` server frame |
| R3 | Prod migration 006 仍是 owner-action，不能写成生产闭环完成 | `high` | `platform-fitness` | `yes` | 明确 preview/prod 状态，prod deploy gate 前必须 apply |
| R4 | ZX4 seam extraction closure 行数与当前代码不一致，拆分深度被夸大 | `medium` | `docs-gap` | `no` | 更新 closure 与 plan，承认当前只是 helper seam |
| R5 | ZX3 `test/INDEX.md` 与 `test-legacy/` 删除事实冲突 | `medium` | `docs-gap` | `no` | 立即更新 `test/INDEX.md` §7 |
| R6 | `pnpm-lock.yaml` 仍有已删 packages importer block | `low` | `delivery-gap` | `no` | owner 注入 `NODE_AUTH_TOKEN` 后跑一次 install |
| R7 | `forwardInternalJsonShadow` 名称保留历史 Shadow 语义，误导后续维护 | `low` | `naming` | `no` | 重命名或加过渡 deprecation 注释 |
| R8 | Phase 8 fast-track 不能等价替代 7-day / ≥1000 turns 证据 | `medium` | `test-gap` | `no` | closure 改成 owner-accepted risk，不写成等价完成 |

### R1. ZX4 permission / elicitation 不是完整 round-trip，只是 storage contract

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md:79-82` 把 Phase 4/6 定义为 permission producer + consumer + resolver、elicitation full path。
  - `workers/orchestrator-core/src/user-do.ts:1336-1363` 只做 best-effort `permissionDecision` RPC forward，失败不影响 200 ack。
  - `workers/orchestrator-core/src/user-do.ts:1371-1427` 只做 elicitation answer local KV + RPC forward。
  - `workers/agent-core/src/index.ts:230-243` 暴露 `permissionDecision` / `elicitationAnswer` RPC，并注释“future runtime kernel waiter resolves on this key”。
  - `workers/agent-core/src/host/do/nano-session-do.ts:606-612` 明确说明记录到 storage 后，等待 storage 的 runtime hook “left unwired”。
  - `docs/issue/zero-to-real/ZX4-closure.md:38-41` 也承认 agent-core PermissionRequest / ElicitationRequest hook 改造 defer 到 ZX5。
- **为什么重要**：
  - 对真实客户端而言，permission / elicitation 的价值不是“HTTP ack 已收到”，而是运行中的 agent loop 能被用户决定解除等待、继续或拒绝。当前链路只能证明 answer 被存储，不能证明运行时已消费。
- **审查判断**：
  - 这是 ZX4 最大的语义断点。可以称为 “decision-forwarding contract landed”，不能称为 “permission / elicitation round-trip 业务闭环”。
- **建议修法**：
  - 修改 ZX4 closure 的 Phase 4/6 状态为 `partial`。
  - 在 agent-core runtime hook 内实现带超时的 DO storage waiter，消费 `permission/decisions/${requestUuid}` 与 `elicitation/decisions/${requestUuid}`。
  - 增加一条从 facade decision 到 agent loop resume 的 e2e / integration 测试。

### R2. ZX4 usage 已有 D1 read/write，但 live push 与 non-null 保证未达 action-plan 原标准

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md:80-82` 要求 Phase 5 “usage live push + 真预算 snapshot”，并写 `/usage` 返回 non-null 与 `session.usage.update` 推送。
  - `workers/orchestrator-core/src/user-do.ts:1226-1267` 的 `handleUsage()` 会读 D1，但无 rows 时保留 null-placeholder fallback。
  - `workers/orchestrator-core/src/session-truth.ts:798-843` 的 `readUsageSnapshot()` 确实聚合 `nano_usage_events` 并读 `nano_quota_balances`。
  - `workers/agent-core/src/host/quota/repository.ts:191-218` 会写 `nano_usage_events`。
  - `workers/agent-core/src/host/runtime-mainline.ts:289-308` 对 Workers AI LLM path 做 quota authorize / commit。
  - `workers/orchestrator-core/src/user-do.ts:1209-1213` 仍把 `session.usage.update` 描述为未来“would allow”推送的 server frame。
  - `docs/issue/zero-to-real/ZX4-closure.md:38-41` 明确把 runtime emit `session.usage.update` server frame defer 到 ZX5。
- **为什么重要**：
  - GET `/usage` 可读和实时 WS usage push 是两个不同产品能力。前者有用，但不能替代真实 CLI/前端运行时的 live usage update。
- **审查判断**：
  - usage D1 read/write 比早期 placeholder 前进了一大步，不应被否定；但 ZX4 action-plan 原标准没有完全达成，closure 应拆成 “GET snapshot done / live push deferred”。
- **建议修法**：
  - 更新 ZX4 closure，把 Phase 5 改为 `partial` 或拆成 P5a/P5b。
  - 补 `session.usage.update` server frame 的 runtime emit，或把它明确移入 ZX5 Lane E acceptance criteria。

### R3. Prod migration 006 仍是 owner-action，不能写成生产闭环完成

- **严重级别**：`high`
- **类型**：`platform-fitness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/issue/zero-to-real/ZX4-closure.md:72-80` 写 migration 006 已 apply 到 remote D1。
  - `docs/issue/zero-to-real/ZX4-closure.md:139-142` 的验证命令实际是 `wrangler d1 migrations apply nano-agent-preview --remote`。
  - `docs/issue/zero-to-real/ZX4-closure.md:188-197` 风险表又写 migration 006 仅 apply 到 preview D1，prod 待 owner deploy。
  - `docs/issue/zero-to-real/ZX4-closure.md:225-228` owner action 仍要求 prod deploy 前先 apply migration 006。
  - `workers/orchestrator-core/migrations/006-pending-status-extension.sql:27-40` 真实修改 `nano_conversation_sessions` 表 CHECK 与字段约束。
- **为什么重要**：
  - `/me/sessions` mint pending、start 状态迁移、expired GC 都依赖 prod D1 schema。prod 未 apply 时，生产路径会遇到 CHECK / schema mismatch 风险。
- **审查判断**：
  - preview applied 是有效证据，但不是 prod closure。closure 的“remote D1”说法必须改成“preview remote D1”。
- **建议修法**：
  - 在部署 checklist 中把 prod migration 006 设为 hard gate。
  - closure 中删除“生产闭环完成”的歧义表达。

### R4. ZX4 seam extraction closure 行数与当前代码不一致，拆分深度被夸大

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/issue/zero-to-real/ZX4-closure.md:17-18` 声称 `user-do.ts` 1950 → 1659 行。
  - 本轮 `wc -l` 当前工作区结果：`workers/orchestrator-core/src/user-do.ts` 为 1910 行；`session-lifecycle.ts` 134 行、`session-read-model.ts` 69 行、`ws-bridge.ts` 47 行、`parity-bridge.ts` 342 行。
  - `workers/orchestrator-core/src/session-lifecycle.ts:1-5` 明确声明 `handleStart` / `handleInput` / `handleCancel` / `handleVerify` 方法体仍在 `user-do.ts`。
  - `workers/orchestrator-core/src/session-read-model.ts:1-6` 明确声明 `handleStatus` / `handleTimeline` / `handleHistory` / `handleMeSessions` / `handleUsage` 方法体仍在 `user-do.ts`。
- **为什么重要**：
  - ZX4 closure 把“seam extraction”写成了较大瘦身，但当前实现更像“类型、常量、pure helper extraction”。这对后续判断 `user-do.ts` 是否仍是热点文件很关键。
- **审查判断**：
  - 拆分方向正确，但不应把当前状态描述为真正解巨石；R26 仍未实质关闭。
- **建议修法**：
  - 更新 closure 行数与模块职责描述。
  - 把下一步拆分目标改成搬移 handler 方法体，而不是只维护 helper seam。

### R5. ZX3 `test/INDEX.md` 与 `test-legacy/` 删除事实冲突

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/action-plan/zero-to-real/ZX3-components-deprecation.md:81-84` 明确要求 README、closure、`test/INDEX.md` 同步改口。
  - `docs/action-plan/zero-to-real/ZX3-components-deprecation.md:889-899` 工作日志写 Phase 5 已 `rm -rf test-legacy/` 并 docs sync。
  - `docs/issue/zero-to-real/ZX3-closure.md:63-67` 也写 `test-legacy/` 物理删除 + docs sync。
  - `test/INDEX.md:176-178` 仍写 `test-legacy/` 继续保留历史 contract / guardian 价值。
- **为什么重要**：
  - 测试目录索引是后续贡献者最容易读到的 truth 文档；它继续宣称 legacy tree 存在，会直接误导测试新增位置。
- **审查判断**：
  - 这是 ZX3 的非功能性文档缺口，不影响代码可运行，但说明 Phase 5 docs sync 没有完全完成。
- **建议修法**：
  - 立即更新 `test/INDEX.md` §7：说明 `test-legacy/` 已在 ZX3 P5 删除，有价值 guardians 已迁到 `test/root-guardians/`，fixtures 已迁到 `test/shared/fixtures/`。

### R6. `pnpm-lock.yaml` 仍有已删 packages importer block

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/issue/zero-to-real/ZX3-closure.md:28-30` 已把 `pnpm-lock.yaml` 一次清理列为 owner-action。
  - 本轮 `rg` 命中 `pnpm-lock.yaml:11`、`:23`、`:35`、`:72`、`:91`、`:159`，仍含已删 `agent-runtime-kernel` / `capability-runtime` / `context-management` / `hooks` / `llm-wrapper` / `session-do-runtime` importer block。
- **为什么重要**：
  - 当前不阻塞测试，但 lockfile 与 workspace 真实状态不一致会影响安装审计、依赖差异审查和后续 package governance。
- **审查判断**：
  - 作为已知 owner-action 可接受，但不应被忘记。
- **建议修法**：
  - 在可用 `NODE_AUTH_TOKEN` 的环境里执行一次 `pnpm install`，提交 lockfile 清理。

### R7. `forwardInternalJsonShadow` 名称保留历史 Shadow 语义，误导后续维护

- **严重级别**：`low`
- **类型**：`naming`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:581-585` 注释写方法名保留只是为了减少 diff，Shadow 语义已经是 historical。
  - `workers/orchestrator-core/src/user-do.ts:591-603` 实际逻辑已只有 RPC binding，无 fetch fallback / parity shadow。
- **为什么重要**：
  - 名字仍暗示双轨 shadow 行为，后续排查 transport 问题时会误导读者以为还有 fallback。
- **审查判断**：
  - 非 blocker，但建议在下次触碰该文件时重命名。
- **建议修法**：
  - 改名为 `forwardInternalJsonRpc` 或 `forwardSessionRpcJson`，保留一层临时 wrapper 以降低 diff。

### R8. Phase 8 fast-track 不能等价替代 7-day / ≥1000 turns 证据

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md:83-85` 原计划 Phase 8 是 7-day parity observation，`agent-rpc-parity-failed = 0 + ≥1000 turns`。
  - `docs/issue/zero-to-real/ZX4-closure.md:30-33` 写 owner direction fast-track。
  - `docs/issue/zero-to-real/ZX4-closure.md:120-125` 和 `:147-149` 的实测证据是 30 sessions × 3 endpoints × 2 runs = 180 facade calls。
- **为什么重要**：
  - 180 calls clean 是有价值 smoke，但覆盖不了长时间运行、非线性负载、边缘状态迁移与真实用户输入组合。
- **审查判断**：
  - owner 可以接受风险换速度，但 closure 不应把 fast-track 说成等价完成原观察门槛。
- **建议修法**：
  - closure 改成 `accepted risk`，并把 post-ZX4 的观察指标接入后续开发期 monitor。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | ZX3 Phase 1 manifest freeze | `done` | `docs/action-plan/zero-to-real/ZX3-components-deprecation.md:672-694` 给出 keep/delete manifest；当前 `packages/` 与 keep-set 一致 |
| S2 | ZX3 Phase 2 删除 6 个 duplicate package | `done` | 当前目录不存在这 6 个 package；workers/test 中无 active import，只有注释和历史文档引用 |
| S3 | ZX3 Phase 3 v2 reclassification | `done` | 三个 utility package 保留为 keep-set，避免 53-import 高风险迁移；这是合理修订 |
| S4 | ZX3 Phase 4 root guardians + fixture cutover | `done` | `test/root-guardians` 有 6 个测试文件，31/31 pass；`package.json:7-13` 指向新 test 树 |
| S5 | ZX3 Phase 5 physical cleanup + docs sync | `partial` | `test-legacy/` 已删除，但 `test/INDEX.md:176-178` 未同步 |
| S6 | ZX3 lockfile cleanup | `partial` | closure 已列 owner-action；`pnpm-lock.yaml` 仍有 stale importer blocks |
| S7 | ZX4 Phase 0 seam extraction | `partial` | helper/type seam 已抽出，但 `user-do.ts` 当前仍 1910 行，handler 方法体仍在主文件 |
| S8 | ZX4 Phase 1 R28/R29 fix | `partial` | 本地单测 closure 通过，但 closure 仍承认 deploy-only R28 500、R29 parity 502 / post-flip 消失，不是彻底根因关闭 |
| S9 | ZX4 Phase 3 D1 pending truth | `done` | migration、TS union、mint pending、GC、guard 都有真实代码证据；prod apply 另见 S14 |
| S10 | ZX4 Phase 4 permission round-trip | `partial` | facade→RPC→DO storage contract done；runtime waiter 未接 |
| S11 | ZX4 Phase 5 usage live read / push | `partial` | D1 write/read path done；WS `session.usage.update` live push 未接，null fallback 仍存在 |
| S12 | ZX4 Phase 6 elicitation answer | `partial` | answer storage + RPC contract done；runtime waiter 未接 |
| S13 | ZX4 Phase 9 internal-http-compat retired | `done` | `agent-core` `/internal/` 只剩 stream/snapshot；orchestrator session actions RPC-only |
| S14 | ZX4 migration applied / prod-ready | `partial` | preview remote applied；prod migration 仍是 owner-action |
| S15 | ZX4 7-day / ≥1000 turns observation | `stale` | 被 owner fast-track 替代为 180 facade calls；这是风险接受，不是原门槛完成 |

### 3.1 对齐结论

- **done**: `6`
- **partial**: `8`
- **missing**: `0`
- **stale**: `1`
- **out-of-scope-by-design**: `0`

这更像“ZX3 主体收口 + ZX4 transport 主线收口 + session semantics contract partial land”，而不是“ZX3~ZX4 全部 completed”。如果按真实客户端可运行性衡量，permission/elicitation wait-and-resume 与 usage push 仍是关键断点。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | ZX5 不新增第 7 个 worker | `遵守` | ZX4 closure 明确 owner direction：所有 follow-up 在 6-worker 内演进，不拆新 worker |
| O2 | 产品型 endpoints `/sessions/{id}/messages` / `/files` / `/me/conversations` / `/devices/revoke` | `遵守` | ZX4 closure 将其 defer 到 ZX5 Lane D；本轮不把它们算 ZX4 blocker |
| O3 | `@haimang/jwt-shared` / envelope 三 type / JWT kid rotation | `遵守` | ZX4 closure 将其 defer 到 ZX5 Lane C；本轮只指出不能把 ZX4 写成 protocol hygiene 完成 |
| O4 | WeChat 真机 smoke | `遵守` | 被列为 owner-action；不作为 ZX3/ZX4 实现 blocker |
| O5 | context-core / filesystem-core 真 RPC uplift | `遵守` | defer 到 ZX5；但后续应避免把 package/transport closure 误读为 library worker RPC 完成 |

---

## 5. 跨阶段 / 跨包进一步分析

### 5.1 Zero-to-real 的真实进展

ZX3~ZX4 对 zero-to-real 的价值是真实的：仓库从“历史包与 legacy test 共存”推进到 “6-worker + 6 keep-set package + canonical test tree”；transport 也从“RPC/HTTP dual-track + parity fallback”推进到 “session action RPC-only + stream-only `/internal/`”。这两个方向都明显降低了后续客户端开发的架构噪音。

但 zero-to-real 的目标不是只关闭技术债，而是缩短真实客户端运行差距。按这一目标看，ZX4 的 closure 仍有三个需要辩证看待的事实：

1. **contract 不等于业务闭环**：permission / elicitation 的 answer 能存入 DO storage，但没有 runtime waiter，真实 agent loop 无法因此继续。
2. **read snapshot 不等于 live client surface**：GET `/usage` 已可从 D1 聚合，但 `session.usage.update` push 尚未 emit，前端仍缺实时预算体验。
3. **preview clean 不等于 prod close**：migration 006 对 session 状态机是强依赖；prod 未 apply 前不能把 session semantics 写成生产已闭合。

### 5.2 命名与事实漂移

- `forwardInternalJsonShadow` 是一个典型命名漂移：实现已无 shadow，但方法名保留旧语义。
- `user-do.ts` seam extraction 是职责边界的开端，不是巨石拆分完成；当前 handler 方法体仍集中在主文件。
- ZX3 的 `test/INDEX.md` 是文档 truth 漂移；它把已删除的 `test-legacy/` 写成仍存在。
- ZX4 closure 对 “remote D1” 的表述应拆成 preview remote 与 prod remote，否则会误导 owner 对生产迁移的风险判断。

### 5.3 对真实客户端的剩余断点

- permission / elicitation wait-and-resume 尚未完整打通。
- `session.usage.update` live push 尚未完整打通。
- prod migration / deployment gate 需要制度化。
- 产品接口仍缺 `/sessions/{id}/messages`、`/sessions/{id}/files`、`/me/conversations` 等真实客户端最小集 API；这些虽 defer 到 ZX5，但意味着 zero-to-real 仍未达到完整 client-ready。
- `user-do.ts` 仍是 1900 行级热点文件，未来产品 endpoint 全落进去会继续扩大维护风险。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：`ZX3 可以关闭但需文档/lockfile follow-up；ZX4 transport 可关闭但 session semantics 只能 partial close；ZX3~ZX4 整体不建议 fully closed`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 修正 ZX4 closure：把 permission / elicitation 从 “round-trip 业务闭环” 改为 “decision-forwarding storage contract done；runtime waiter deferred”。
  2. 修正 ZX4 closure：把 usage 从 “live push + 真预算闭环” 改为 “D1 usage write/read snapshot done；`session.usage.update` deferred”。
  3. 明确 migration 006 只验证到 preview remote；prod apply 是 deploy hard gate，不得写成 prod-ready。
  4. 修正 `test/INDEX.md` §7，删除 `test-legacy/` 继续保留的过时说法。
- **可以后续跟进的 non-blocking follow-up**：
  1. 清理 `pnpm-lock.yaml` 中已删 package importer block。
  2. 将 `forwardInternalJsonShadow` 重命名为 RPC-only 语义。
  3. 继续拆 `user-do.ts`，把 handler 方法体按 lifecycle/read-model/ws 分离，而不只是 helper seam。
  4. 把 post-fast-track 的 transport observation 指标纳入 ZX5 开发期监控。
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §7 append 回应，不要改写 §0–§6。`

本轮 review 不收口，等待实现者按 §7 响应并再次更新代码 / closure 文档。
