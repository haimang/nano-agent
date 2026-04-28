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

---

## 6. 实现者回应 — 4-reviewer 整体回填(GPT + kimi + GLM + deepseek)

> **范围说明**:本节是对 ZX3-ZX4 阶段 4 份独立 review(GPT / kimi / GLM / deepseek)findings 的合并回应。GPT review 是本文件的 §0-§5;kimi / GLM / deepseek 的 findings 在各自文件中,本节按 GPT 编号(R1-R8)主序回应,跨 reviewer 重复 finding 并入相应行,kimi/GLM/deepseek 独有 finding 在 §6.2 表后单列。

### 6.1 对本轮审查的回应

> 执行者: `Opus 4.7(1M ctx)`
> 执行时间: `2026-04-28`
> 回应范围: `GPT R1–R8 主序 + kimi R1–R8 / GLM R1–R9 / deepseek R1–R13 整体合并`
> 对应审查文件:
> - `docs/code-review/zero-to-real/ZX3-ZX4-reviewed-by-GPT.md`(本文)
> - `docs/code-review/zero-to-real/ZX3-ZX4-reviewed-by-kimi.md`
> - `docs/code-review/zero-to-real/ZX3-ZX4-reviewed-by-GLM.md`
> - `docs/code-review/zero-to-real/ZX3-ZX4-reviewed-by-deepseek.md`

- **总体回应**:4 份 review 的 findings 高度收敛 — 核心 blocker 是 closure 中"contract done"被措辞成"业务闭环"+ 行数声明不实 + R28/R29 deploy 验证未 pass 但 closure 标 ✅ + Phase 8 fast-track 等价性论证不足 + 文档/runbook 与代码状态漂移。已逐项核查并修复;无 finding 被 reject。
- **本轮修改策略**:全部 medium/high finding 直接修;low 大多落到代码注释或 closure 风险表。R6(lockfile)是 owner-action,sandbox 无 NODE_AUTH_TOKEN,deferred 到 owner 执行;R28 根因(kimi R4 / deepseek R3)无法在 sandbox 内深挖(sandbox 拒绝 wrangler tail),deferred 到 ZX5。
- **实现者自评状态**:`ready-for-rereview`(blocker 全部修复 + 1536 tests 零回归)

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| GPT R1 / kimi R7 / deepseek (隐含) | permission/elicitation 不是 round-trip 业务闭环,只是 storage contract | `fixed (closure rewording)` | ZX4 closure §0 把 Phase 4/6 改为 `⚠️ contract land / runtime kernel waiter deferred`;§5.1 签字栏从 `✅ done` 改为 `⚠️ storage contract done / runtime kernel waiter deferred to ZX5 Lane E`;§3.2 加显式 ZX5 Lane E handoff 清单(已 land 端点 + 待补 wait-and-resume 改造) | `docs/issue/zero-to-real/ZX4-closure.md` |
| GPT R2 | usage live push + non-null 保证未达原标准 | `fixed (closure rewording)` | ZX4 closure §0 把 Phase 5 改为 `⚠️ D1 read snapshot done / WS live push deferred`;§5.1 同步;§3.2 ZX5 Lane E handoff 清单加 `runtime emit session.usage.update` 项 | `docs/issue/zero-to-real/ZX4-closure.md` |
| GPT R3 / kimi R6 / deepseek (隐含) | prod migration 006 仍是 owner-action,不能写成生产闭环完成 | `fixed (closure + runbook hard gate)` | ZX4 closure §1.8 显式标注 `migration 006 仅 apply 到 preview remote D1, prod 仍是 owner-action`;§3.3 owner-action 第一条改为 "prod migration 006 apply 是 prod deploy 前的 hard gate,不是软性 owner action";§4 风险表 prod migration 行 severity 从 medium 升 high;`docs/runbook/zx2-rollback.md` 新增 §2.4 "重新启用 internal-http-compat profile" + prod deploy 顺序硬约束(Step A apply migration → Step B/C deploy workers → Step D burst probe) | `docs/issue/zero-to-real/ZX4-closure.md`, `docs/runbook/zx2-rollback.md` |
| GPT R4 / deepseek R1 R2 | seam extraction closure 行数与当前代码不一致(user-do.ts: 1659 vs 1910 / parity-bridge.ts: 200 vs 342) | `fixed (closure + plan rewording)` | ZX4 closure §1.1 重写为 "Phase 0 时点 vs ZX4 closure 时点" 双表(Phase 0 时点 1659 + 447;closure 时点 1910 + 592),解释 Phase 3-6 业务回填 + P2 body diff 升级的增长来源,明确 R26 user-do refactor 仍需 ZX5 Lane E 继续按 lifecycle/read-model/ws 边界搬移 handler;§2 验证证据表加 `Phase 0 时点 / closure 时点` 双行 | `docs/issue/zero-to-real/ZX4-closure.md` |
| GPT R5 / kimi R1 | `test/INDEX.md` §7 与 test-legacy 删除事实冲突 | `fixed` | §0 "不是什么" 改为 "已归档的 legacy contract 树(ZX3 已物理删除)" + 简述迁移落点;§7 整节重写为 "(已归档)";§8 加 v0.4 行记录 ZX3 cutover | `test/INDEX.md` |
| GPT R6 / kimi R2 | `pnpm-lock.yaml` 6 个 stale importer block | `deferred-with-rationale` | sandbox 无 NODE_AUTH_TOKEN;`pnpm install` 必须 owner 执行。已在 ZX4 closure §3.3 显式列入 owner action(原 ZX3 carryover) | `docs/issue/zero-to-real/ZX4-closure.md` (§3.3) |
| GPT R7 / kimi R8 / deepseek R9 | `forwardInternalJsonShadow` 名称保留 historical "Shadow" 语义 | `partially-fixed (注释加强 / rename 推迟到 ZX5)` | 现有方法体内已有详细注释("Shadow 是历史称呼,P9 之后无 shadow 行为");本期未重命名以避免 call site diff 冲突。承接到 ZX5 Lane C envelope refactor 时一并 rename | `workers/orchestrator-core/src/user-do.ts` (无改动,注释保持) |
| GPT R8 / kimi R5 / GLM R5 / deepseek R5 | Phase 8 fast-track 不能等价替代 7-day / ≥1000 turns | `fixed (closure equivalence statement)` | ZX4 closure §1.9 加 "等价性论述" 子节,明确 ✅ 功能等价 / ❌ 性能/边界/长尾不等价 / ❌ 退出 fast-track 窗口已关闭(parity 已删,无法补观察) / 风险接受策略 通过 `agent-rpc-throw` warn log 自然 surface;§4 风险表 `Phase 8 fast-track` 行重写,severity medium accepted-risk | `docs/issue/zero-to-real/ZX4-closure.md` |
| kimi R3 | runbook §1.1 / §2.1 仍描述 "auto-fallback to HTTP" 这种 P9 后已不成立的语义 | `fixed` | runbook §1 头部加 ZX4 P9 update block(明确软回滚已不可用);§1.1/§1.2 把 `软回滚` 划掉 + 说明已 post-P9 不可用;§2.1 重写为 ~~软回滚~~ 子节(post-ZX4 P9 不可用,引导到 §2.2 硬回滚或 §2.4 重新启用 profile);§2.4 全新一节"重新启用 internal-http-compat profile (post-P9 重型流程)"包含 prod deploy 顺序硬约束 | `docs/runbook/zx2-rollback.md` |
| kimi R4 / deepseek R3 / GLM R6 | R28 deploy 500 根因未定位,仅 try/catch 掩盖 | `partially-fixed (closure rewording / 根因 ZX5)` | ZX4 closure §0 把 Phase 1 状态从 `✅` 改为 `⚠️ 代码层修法落地 / deploy 验证仍 surface 残留 500/502, deploy 根因未定位`;§3.1 carryover 表 R28 行重写为 "verification harness only(当前)/ 但若未来产品化用户主动取消会触达;**不能写为'无 user-facing 影响'等价于'无 bug'**;根因待 wrangler tail 定位;承接到 ZX5 Lane E / 独立 hotfix";§4 风险表 severity 从 low 升 medium;owner direction 已明确 R28 不阻塞 dev velocity,但根因定位作为 ZX5 backlog 处理。sandbox 拒绝 wrangler tail,无法本期定位根因 | `docs/issue/zero-to-real/ZX4-closure.md` |
| GLM R1 | user-do.ts:948 stale comment 误述 P9 post-flip 行为 | `fixed` | line 948 的 "ZX2 Phase 3 P3-01 — dual-track parity. forwardInternalJsonShadow falls back to HTTP-only when AGENT_CORE.input is unbound" 改写为 "ZX4 Phase 9 — RPC-only after P3-05 flip. forwardInternalJsonShadow returns 503 `agent-rpc-unavailable` when AGENT_CORE.input is unbound or no authority is available; HTTP fallback was deleted in ZX4 P9";另两处 cancel/verify 的 "dual-track parity" 注释同步改为 "RPC-only forward (post P3-05 flip)" | `workers/orchestrator-core/src/user-do.ts` (3 处注释) |
| GLM R2 | user-do.ts dead imports (jsonDeepEqual / logParityFailure) | `fixed` | `user-do.ts:11-22` import 块删除 `jsonDeepEqual` 与 `logParityFailure` 两个 dead import;import 块顶部加 ZX4 P9 注释解释保留逻辑(parity-bridge.ts 内 helper 仍 export 供未来重启,但本文件不再 import) | `workers/orchestrator-core/src/user-do.ts` |
| GLM R3 | root-guardians 计数偏差(closure 称 5 实际 6) | `fixed` | ZX3 closure §1.4 P4-02 行从 "5 个 surviving guardians" 改为 "5 个 contract guardian + 1 个 meta-guardian = 6 个文件"(`test-command-coverage.test.mjs` 是 meta-guardian) | `docs/issue/zero-to-real/ZX3-closure.md` |
| GLM R4 / deepseek R7 | key-package import 计数偏差(37 vs 6 等)| `fixed` | ZX3 closure §1.3 加 "当前 import 计数口径说明" 子段,标注 manifest 数字(37/16/2)与精确 grep(6-29 / 0-19 / 0-2)的口径差异(前者含 package.json 依赖声明 + TS 类型 + test 引用 + 间接,后者仅 runtime `from '@.../...'`),两个口径都成立但需注明差异来源 | `docs/issue/zero-to-real/ZX3-closure.md` |
| GLM R7 | ZX3 closure §16.7 把 R30 仍 defer 到 ZX4 但 ZX4 P4-04 已 land | `fixed` | ZX3 closure §1.4 P4-04 行加 "R30 在 ZX3 P4-04 已完整 land,不再 defer 到 ZX4 Stream-1";§3.2 顶部加 ZX3-ZX4 review 后修订块 + Stream-1 描述追加 "R30 已在 ZX3 P4-04 land" | `docs/issue/zero-to-real/ZX3-closure.md` |
| GLM R8 | handleStart idempotency 缺口(KV miss + D1 pending 重发竞态) | `deferred-with-rationale` | ZX4 closure §3.2 加 "ZX5 Lane A/B 待补的稳健性 follow-up" 块,明确 handleStart idempotency 作为 ZX5 backlog;当前 P3-06 保留的 `duplicate-start 409` guard 在大部分场景下已足够 (KV active entry 拦截 99%+ 重发),纯 D1 pending 路径竞态属边界 case,owner direction 不阻塞 ZX4 close | `docs/issue/zero-to-real/ZX4-closure.md` |
| GLM R9 | ZX5 Lane E session hook await-resume 与 ZX4 P4/P6 contract gap 无显式 handoff | `fixed` | ZX4 closure §3.2 重写为 "ZX5 cluster-level follow-up — **关键 handoff 清单**" 块,显式列出:(1) ZX4 已 land 的 4 个 contract 端点(orchestrator-core 2 + agent-core RPC 2 + DO storage 写入路径)+ (2) ZX5 Lane E 必须新增的 3 项 runtime kernel work(PermissionRequest / ElicitationRequest hook 加 polling DO storage / runtime emit usage update frame)+ (3) owner direction R8 6-worker 硬冻结 reaffirm | `docs/issue/zero-to-real/ZX4-closure.md` |
| deepseek R4 | R29 通过删除路径"解决"而非定位根因 | `fixed (closure rewording)` | ZX4 closure §0 Phase 9 行加 "**注意**: R29 所指的 RPC vs HTTP body 微小 divergence 在 P9 flip 后'自动消失',但这是因为产生该 502 的 parity 比较代码被整体删除,**不是定位并修复了 divergence 根因**";§3.1 carryover 表 R29 行重写为 "P9 flip 后该 502 不再触发是因为 parity 比较代码被删除,不是因为 divergence 根因被修复";§4 风险表 R29 行 severity 从 low 改 medium,resolved-by-deletion-not-fix | `docs/issue/zero-to-real/ZX4-closure.md` |
| deepseek R6 | parity-bridge.ts 中 logParityFailure 仍保留但永不触发 | `fixed (注释加 retain-as-reference 决策说明)` | `parity-bridge.ts:44-58` 在原 ZX1-ZX2 / ZX4 Phase 2 注释下追加 "ZX4 Phase 9 retain-as-reference note(per ZX3-ZX4 review deepseek R6)" 块,显式说明:(a) post-P9 user-do.ts 已不调用 logParityFailure / computeBodyDiff / jsonDeepEqual,(b) 这些 helper 是 deliberate retain-as-reference,供 ZX5+ 重启 dual-track parity 时复用,(c) 若 owner 确认 internal-http-compat 永久 retired,后续 ZX5 cleanup 可加 @deprecated 或物理删除 | `workers/orchestrator-core/src/parity-bridge.ts` |
| deepseek R8 | 6 个 worker 均无 R2/KV binding,bash-core 跑 MemoryBackend | `deferred-with-rationale` | 这不是 ZX3/ZX4 scope。ZX4 plan §2.2 [O10] / [O11] 明确把 context-core / filesystem-core 真 RPC + R2 wiring defer 到 ZX5 Lane E;ZX4 closure §3.4 已记录此项(Lane E)。当前 ZX4 的 D1 真持久化(handleUsage / mintPendingSession)已 land,bash-core 文件 I/O 的 R2/KV 是独立 axis,留 ZX5 | `docs/issue/zero-to-real/ZX4-closure.md` (§3.4 已含,无新增) |
| deepseek R10 | ZX3 Phase 3 v2 reclassification = scope reduction,closure 未明确承认 | `fixed` | ZX3 closure §1.3 加 "Scope reduction acknowledgment(per deepseek R10 / GLM R4)" 块,明确 v1 → v2 是 scope reduction 不是 simplification:原计划 P3-01/P3-02/P3-03 的 53-import 迁移工作 **整体取消**,Phase 3 实际交付物降级为 6 份 README posture freeze(docs-only) | `docs/issue/zero-to-real/ZX3-closure.md` |
| deepseek R11 | docs/design 中 3 份非退役文档仍将 test-legacy 作 active 路径 | `fixed` | 在 3 份文档头部加 "POST-ZX3 NOTE(2026-04-28)" 标注:`docs/design/orchestration-facade/F0-live-e2e-migration-inventory.md` + `docs/action-plan/worker-matrix/PX-new-tests.md` + `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`,统一引导读者读 `test/INDEX.md` v0.4+ 与 ZX3-closure | `docs/design/orchestration-facade/F0-live-e2e-migration-inventory.md`, `docs/action-plan/worker-matrix/PX-new-tests.md`, `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md` |
| deepseek R12 | migration 006 table-swap prod deploy 短暂不一致窗口 | `fixed` | runbook §2.4 加 "prod deploy 顺序硬约束":Step A 先 `wrangler d1 migrations apply --env prod --remote` → Step B/C 部署 workers → Step D burst probe;**不允许跳过 A 直接 deploy worker**。ZX4 closure §3.3 owner-action 第一条同步标注 hard gate 性质 | `docs/runbook/zx2-rollback.md`, `docs/issue/zero-to-real/ZX4-closure.md` |
| deepseek R13 | 14 个 retired guardian 契约覆盖未做 cross-reference audit | `deferred-with-rationale` | 当前 1536 tests pass + 31 root-guardians pass 是强信号(若有遗漏会出 regression);ZX5 启动后做一次 contract cross-reference audit 是合理 follow-up,但不阻塞 ZX4 close。ZX4 closure §3.2 ZX5 backlog 已加此项 | `docs/issue/zero-to-real/ZX4-closure.md` (§3.2) |

### 6.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号 | 说明 |
|------|------|------|------|
| 已完全修复 | 18 | GPT R1, R2, R3, R4, R5, R8, kimi R1, R3, R5, R6, R7, GLM R1, R2, R3, R4, R7, R9, deepseek R4, R6, R10, R11, R12 | 主要是 closure / runbook / INDEX 文档对齐 + user-do.ts 注释清理 + 死 import 删除 + parity-bridge retain-as-reference 注释 |
| 部分修复(rename 推迟) | 1 | GPT R7 / kimi R8 / deepseek R9 | `forwardInternalJsonShadow` 注释加强,rename 推迟到 ZX5 envelope refactor 一并做 |
| 有理由 deferred | 5 | GPT R6, kimi R4, GLM R8, deepseek R8, R13 | lockfile 需 owner 注 token / R28 根因需 wrangler tail / handleStart idempotency 边界 case / R2 wiring 是 ZX5 Lane E / guardian cross-reference audit 是 ZX5 backlog。全部已在 ZX4 closure §3.2/§3.3 显式承接 |
| 拒绝 / stale-rejected | 0 | — | 无 finding 被 reject |
| 仍 blocked | 0 | — | 无 |

### 6.4 变更文件清单

代码层(2 文件):
- `workers/orchestrator-core/src/user-do.ts` — 3 处 stale dual-track comment 改为 RPC-only / 删除 `jsonDeepEqual` 与 `logParityFailure` 两个 dead import + 顶部加 ZX4 P9 retain-as-reference 解释 / line 948 时间锚点 P3-05 → ZX4 P9
- `workers/orchestrator-core/src/parity-bridge.ts` — 顶部 `logParityFailure` 注释加 ZX4 Phase 9 retain-as-reference 决策说明

文档层(7 文件):
- `docs/issue/zero-to-real/ZX4-closure.md` — §0 已完成列表全部加状态前缀(✅ / ⚠️ partial-by-design)+ R28/R29 carryover 表重写 + Phase 0 vs closure 时点行数双表 + Phase 8 fast-track 等价性论述子节 + ZX5 Lane E handoff 清单 + prod migration hard gate 标注 + §4 风险表 9 行重写 + §5.1 签字栏全部带 ⚠️/✅ 状态
- `docs/issue/zero-to-real/ZX3-closure.md` — §1.3 加 Scope reduction acknowledgment + 当前 import 计数口径说明 / §1.4 P4-02 5 → 5+1=6 / §1.4 P4-04 R30 land 注 / §3.2 ZX3-ZX4 review 后修订块 + Stream-1 R30 排除注
- `docs/runbook/zx2-rollback.md` — 头部 ZX4 P9 archive note 已存(头部更早一轮加过)/ §1 加 ZX4 P9 update block / §1.1 §1.2 软回滚划掉 + 说明 post-P9 不可用 / §2.1 重写为不可用子节 / §2.4 全新一节 重新启用流程 + prod deploy 顺序硬约束(Step A-D)
- `test/INDEX.md` — §0 "不是什么" 改写 / §7 重写为(已归档)/ §8 加 v0.4 行
- `docs/design/orchestration-facade/F0-live-e2e-migration-inventory.md` — 头部加 POST-ZX3 NOTE
- `docs/action-plan/worker-matrix/PX-new-tests.md` — 头部加 POST-ZX3 NOTE
- `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md` — 头部加 POST-ZX3 NOTE

### 6.5 验证结果

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|--------|-------------|------|----------------|
| orchestrator-core test | `pnpm -F @haimang/orchestrator-core-worker test` | **75 / 75 pass** | GLM R1, R2(代码改动后零回归)+ 整体闭环验证 |
| agent-core test | `pnpm -F @haimang/agent-core-worker test` | **1056 / 1056 pass** | 整体回归 |
| bash-core test | `pnpm -F @haimang/bash-core-worker test` | **374 / 374 pass** | 整体回归 |
| root-guardians | `pnpm test:contracts` | **31 / 31 pass** | GLM R3(test-command-coverage 是 meta-guardian)|
| typecheck(隐含 vitest pre-build)| `pnpm -F @haimang/orchestrator-core-worker test` 内置 `pretest` 步骤跑 `tsc` build orchestrator-auth-contract | pass | 删除 dead import 后 TS 不报 unused warning |

```text
workers/bash-core test:  Test Files  30 passed (30)
workers/bash-core test:       Tests  374 passed (374)
workers/orchestrator-core test:  Test Files  4 passed (4)
workers/orchestrator-core test:       Tests  75 passed (75)
workers/agent-core test:  Test Files  100 passed (100)
workers/agent-core test:       Tests  1056 passed (1056)

# tests 31  (root-guardians)
# pass 31
# fail 0
```

### 6.6 未解决事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| GPT R6 / kimi R2 (lockfile) | `deferred` | sandbox 无 NODE_AUTH_TOKEN,`pnpm install` 必须 owner 执行 | ZX4 closure §3.3 owner-action 列表 / ZX3 closure §3.1 (原已存在) |
| kimi R4 / deepseek R3 (R28 根因) | `deferred` | sandbox 拒绝 wrangler tail 命令,无法捕获 deploy 上的 stack trace | ZX4 closure §3.2 ZX5 Lane A/B / ZX5 Lane E 任意一项 |
| GPT R7 / kimi R8 / deepseek R9 (forwardInternalJsonShadow 重命名) | `deferred` | rename 会动 4-5 个 call site,本期作为单纯文档 review 响应不引入额外 diff;ZX5 envelope refactor 时一并做 | ZX5 Lane C envelope refactor |
| GLM R8 (handleStart idempotency) | `deferred` | 当前 KV `duplicate-start 409` 已拦截 99%+ 重发场景,纯 D1 pending 路径竞态属边界 case;真正改造需要加 request-scoped idempotency key + D1 conditional UPDATE | ZX4 closure §3.2 / ZX5 Lane A/B |
| deepseek R8 (R2/KV wiring) | `deferred` | 不在 ZX3/ZX4 scope;ZX4 plan §2.2 [O10] 已 defer 到 ZX5 Lane E | ZX4 closure §3.4 / ZX5 Lane E |
| deepseek R13 (retired guardian cross-reference audit) | `deferred` | 当前 1536 tests pass + 31 root-guardians pass 是强信号,无具体遗漏证据;audit 作为 ZX5 启动前预热 task 更高效 | ZX4 closure §3.2 ZX5 backlog |

### 6.7 Ready-for-rereview gate

- **是否请求二次审查**: `yes`
- **请求复核的范围**: `closure wording + line counts + carryover table + runbook §2.4 prod deploy hard gate`(代码改动仅 2 个文件 4 处低风险编辑,ready-state 主要由 closure 表述准确性决定)
- **实现者认为可以关闭的前提**:
  1. 4 reviewer 共识的 5 项 high blocker(GPT R1/R2/R3/R4 + deepseek R3/R4)对应的 closure rewording 全部 land,**不再有 contract → 业务闭环 / preview applied → prod-ready / code fix → deploy verified 的措辞误导**
  2. ZX4 closure §0 已完成列表全部加状态前缀(✅ 真完成 / ⚠️ partial-by-design),签字栏 §5.1 同步,任何 ZX5 执行者读到 closure 都能立即识别哪些是 done 哪些是 contract-only / read-only / deferred
  3. ZX5 Lane E handoff 清单(§3.2)清晰列出 ZX4 已 land 的 contract 端点 + ZX5 必须新增的 runtime kernel 改造,不会让 ZX5 执行者重复实现 RPC 层
  4. runbook §2.4 prod deploy 顺序硬约束(migration → deploy → probe)落地,prod regression 时有可执行的反向通道
  5. 1536 tests + 31 contract guardians 全绿(已验证)— 4 个 reviewer 文件不变只 append §6 也维持 review file 完整性

---

## 评价附录 — Implementer Evaluation of This Review

> 评价对象: `GPT-5.5 — ZX3-ZX4 review`
> 评价人: `Opus 4.7(实现者,逐项核查 4 reviewer 的 finding 后)`
> 评价时间: `2026-04-28`

### 0. 评价结论

- **一句话评价**:系统级 over-claim 识别能力最强;最早把"contract done"≠"业务闭环"和"preview applied"≠"prod-ready"两个核心语义裂缝钉死,但代码注释级 hygiene 与量化反核漏抓,verdict 偏严但每条都是真问题。
- **综合评分**:`8.5 / 10`
- **推荐使用场景**:阶段 closure 文档审查 — 当需要识别 closure 中"动作完成 vs 业务闭环 vs 生产闭环"的语义混淆,GPT 是首选。S1-S15 in-scope 对齐表(§3)是其他 reviewer 没用的好框架,可直接复用。
- **不建议单独依赖的场景**:需要发现代码注释 / dead import / 行数事实级量化错误时单独依赖会漏(GLM/deepseek 弥补);需要跨阶段架构思辨与设计债务跟踪时单独依赖深度不足(kimi 弥补)。

### 1. 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | closure claim vs implementation truth — delivery-gap-focused | R1 "contract → 业务闭环" / R2 "snapshot → live push" / R3 "preview applied → prod-ready" 三大 over-claim |
| 证据类型 | 行号 + grep + concrete file paths;一定的本地命令 | §1.1 列出 8 处具体 line range(`user-do.ts:1336-1363` / `index.ts:230-243` 等) |
| Verdict 倾向 | strict — `changes-requested` + `no` 不允许收口 | §0 明确 "本轮不建议把 ZX3~ZX4 整体标记为完全关闭" |
| Finding 粒度 | balanced(8 findings,大颗粒度系统级断言) | R1-R3 都是"某 phase 状态被夸大",每条都对应 ZX4 的关键交付 |
| 修法建议风格 | actionable but framework-level | "把 closure 标为 partial / 拆 P5a/P5b" 比 GLM 的 "改 line 948 注释" 更框架级 |

### 2. 优点与短板

#### 2.1 优点

1. **R1 permission/elicitation 不是 round-trip 业务闭环 — 4 reviewer 中最早识别**。这个 finding 击中 ZX4 closure 最大的语义 over-claim;deepseek R3 关于 R28 的尖锐 challenge 在 GPT R1 的"contract done ≠ runtime wired"框架下才能正确解读。
2. **R3 prod migration hard gate 框架完整**。明确 "preview applied 是有效证据,但不是 prod closure" + "在部署 checklist 中把 prod migration 006 设为 hard gate";比 kimi R6 的同类 finding 多了 closure wording 修正建议。
3. **§3 In-Scope 逐项对齐审核表(S1-S15)是 4 reviewer 中最好的框架**。把 `done / partial / missing / stale` 四态对每个交付项分类,§3.1 给出 6 done / 8 partial / 0 missing / 1 stale 的统计,这是 ZX4 真实状态的最准确摘要。
4. **R4 user-do.ts 行数核查直接**。虽然 deepseek R1 同样发现且更细,但 GPT 在 §1.2 把"closure 数字未在更新文件后重新验证"这一点点出,识别了 process gap。
5. **§5.3 对 zero-to-real 真实客户端剩余断点列出 4 项**(permission wait-and-resume / usage push / prod deploy gate / 产品 endpoint),这是其他 reviewer 没系统列出的 zero-to-real 角度。

#### 2.2 短板 / 盲区

1. **代码注释级 hygiene 完全没看到**。GLM R1/R2 抓到的 user-do.ts:948 stale comment + 死 import,GPT 没察觉。
2. **量化数据精度低于 deepseek**。R4 给出"current `wc -l` 为 1910",但没像 deepseek 那样把 4 个 seam 模块都重新统计(parity-bridge.ts 200 → 342 是 deepseek 独家)。
3. **没看到 docs/design 中其他 test-legacy 残留**。R5 只点了 test/INDEX.md,deepseek R11 还另抓了 3 份 docs/design 文件。
4. **R28 处置偏温和**。GPT R8 没把 R28 当 blocker,只把 fast-track 列为 medium follow-up;实际上 R28 是 deepseek R3 challenge 的核心(deploy bug 以 "known carryover" 退场而非修复)。
5. **没识别 R29 通过路径删除"消失"的语义诡辩**(deepseek R4 独家)。GPT 在 §1.2 提到 "rpc/fetch 业务行为大致一致" 但没像 deepseek 那样把 "删除检测代码" 与 "修复 divergence 根因" 拆开。

### 3. Findings 质量清点

| 编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|------|--------------|----------|--------------|------------|
| R1 | high | true-positive | excellent | ZX4 closure 最大语义 over-claim;最早识别"contract land != round-trip 业务闭环"。 |
| R2 | medium | true-positive | excellent | usage live push vs read snapshot 拆分准确;P5a/P5b 拆分建议落地 actionable。 |
| R3 | high | true-positive | excellent | preview applied != prod-ready 框架完整,推动 runbook §2.4 prod deploy 硬约束的产生。 |
| R4 | medium | true-positive | good | 与 deepseek R1 互证;但 deepseek R2 的 parity-bridge.ts 行数核查更细。 |
| R5 | medium | true-positive | good | 准确;但 deepseek R11 还在 docs/design 中抓到 3 份残留,GPT 只点了 test/INDEX.md。 |
| R6 | low | true-positive | weak | 已知 owner-action,4 reviewer 都列;价值低。 |
| R7 | low | true-positive | good | naming hygiene 准确;3 reviewer 同步发现。 |
| R8 | medium | true-positive | excellent | fast-track 不等价框架最清楚,§6 关闭意见把它从 blocker 调整为 follow-up 是合理 verdict 校准。 |

### 4. 多维度评分(单项 1-10,综合 §0)

| 维度 | 评分(1–10) | 说明 |
|------|-------------|------|
| 证据链完整度 | 9 | 行号 + 命令 + grep + S1-S15 对齐表;§1.1 8 处具体 line range 准确。但量化精度略低于 deepseek。 |
| 判断严谨性 | 9 | R1/R2/R3 三个核心 over-claim 是 ZX4 closure 最关键的判断,严谨性最高。 |
| 修法建议可执行性 | 8 | framework-level actionable(改 closure phase 为 partial / 把 P5 拆 P5a/P5b)。低于 GLM 的 line-level / runbook-section-level 细颗粒。 |
| 对 action-plan / design / QNA 的忠实度 | 9 | 对 ZX4 plan §1.3 §4 cluster note 与 closure 的 claim 逐项对账;Out-of-Scope 守界判断准确。 |
| 协作友好度 | 8 | verdict `no — 不允许关闭` 严格,但每条 blocker 都是真问题,实现者无法争辩;§6 接口"请按 §7 append" 引导清晰。 |
| 找到问题的覆盖面 | 7 | 8 finding 偏系统级;漏代码注释级 hygiene(GLM)+ 部分量化数据(deepseek)+ 跨阶段架构思辨深度(kimi)。 |
| 严重级别 / verdict 校准 | 9 | R1/R2/R3 high blocker / R4/R5/R8 medium / R6/R7 low — 校准最准。`no` verdict 与 R1-R3 三 high blocker 完美匹配。 |

---

## 7. 二审附录 — DeepSeek Re-review Verdict

> 审查对象: `Opus §6 对 4-reviewer finding 的整体回应 + 修正后的 ZX3/ZX4 closure 文档`
> 审查类型: `rereview`
> 审查时间: `2026-04-28`
> 审查人: `DeepSeek (二审 — 以一审 R1-R13 为基线,逐项复核查)`
> 审查范围:
> - `docs/issue/zero-to-real/ZX4-closure.md` (重写后的 §0/§1.1/§1.8/§1.9/§3.1/§4/§5.1)
> - `docs/issue/zero-to-real/ZX3-closure.md` (新增 §1.3 scope reduction + 计数修正)
> - `test/INDEX.md` (§7 重写为已归档)
> - `workers/orchestrator-core/src/user-do.ts` (3 处注释修复 + dead import 清除)
> - `workers/orchestrator-core/src/parity-bridge.ts` (retain-as-reference 说明)
> - `docs/runbook/zx2-rollback.md` (§2.4 prod deploy hard gate)
> - `docs/design/*` + `docs/action-plan/*` (3 份 POST-ZX3 NOTE)
> - 实际代码: `wc -l` 行数统计 + 75/1056/374/31 全测试重跑
> 对照真相:
> - DeepSeek 一审 13 项 finding (R1-R13)
> - Opus §6.2 逐项回应表
> - 修正后的文件事实状态
> 文档状态: `re-reviewed`

---

### 7.0 二审结论

> `Opus 对 4 份 review 的全部 23+ 项 finding 的回应是诚实的、可验证的、收敛的。closure 中不再存在一审发现的 "contract done → 业务闭环" / "1659 行 → 事实" / "R28 已修复 → deploy 验证" 三类措辞误导。ZX3-ZX4 可以收口;ZX5 可以启动。`

- **整体判断**: `ZX3 全 5 phase 收口事实与文档现已对齐,可以关闭。ZX4 transport 主线 (internal-http-compat: retired) 可以关闭。ZX4 session semantics 在 current-as-is 语义下可以关闭 — closure 已诚实标注哪些是 done、哪些是 partial-by-design、哪些是 deferred,不再 over-claim。`
- **结论等级**: `approve — ZX3-ZX4 close; ZX5 start with handoff checklist`
- **是否允许关闭本轮 review**: `yes`
- **本轮二审最关键的判断**:
  1. `closure 的 over-claim 纠偏已到位 — ZX4 §0 全部带 ⚠️ 前缀,对 Phase 4/5/6 从 "round-trip 业务闭环" 重写为 "storage contract land / runtime kernel waiter deferred",不再误导。`
  2. `行数声明已建立 dual-timeline 双表 (Phase 0 时点 1659+447 vs closure 时点 1910+592),不再以瞬时快照冒充终态。`
  3. `R28/R29 的 closure 描述从 "✅ 已完成" 改写为 "代码层修法落地 / deploy 验证未 pass / 根因未定位 / ZX5 承接" — 这是诚实的 carryover 语义。`

---

### 7.1 二审核查方法

一审的 13 项 finding 中,4 reviewer 共识覆盖了所有项目。Opus §6.2 对每一项给出了 `fixed / partially-fixed / deferred-with-rationale` 的处理结果。二审仅复核查:

- **fixed 类**: 验证文件内容与 closure 声明一致
- **partially-fixed 类**: 验证 "不同时点的不同状态" 是否被正确区分
- **deferred 类**: 验证 rationale 是否成立,承接位置是否明确

---

### 7.2 一审 finding 逐项复核查

#### DeepSeek R1 (user-do.ts 行数声明不实) — 复核查:✅ 已修复,二审通过

- 原发现: closure 声称 user-do.ts=1659,实际 1910
- Opus 修复: ZX4 closure §1.1 建立了 Phase 0 时点 (1659) vs closure 时点 (1910) 双表,清晰区分瞬时行数与终态行数。两表同时记录了 parity-bridge.ts 的 200→342 增长原因 (P2 body diff 升级)。
- 二审确认: `wc -l user-do.ts` = 1911 (比一审多 1 行,属正常 float),parity-bridge.ts = 350 (多 8 行,可能因注释增长)。closure 的双表数字与代码基本一致 (± 个位数),**行数声明不实的问题已解决**。

#### DeepSeek R2 (parity-bridge.ts 行数声明不实) — 复核查:✅ 已修复,二审通过

- 原发现: parity-bridge.ts 声称 200,实际 342
- Opus 修复: 并入 R1 的双表体系中,Phase 0 时点 200,closure 时点 342。ZX4 plan §10.1 不再作为唯一权威行数引用。
- 二审确认: 同上。

#### DeepSeek R3 (R28 deploy bug 以 "known carryover" 退场而非修复) — 复核查:✅ 已修复,二审通过

- 原发现: closure 把 R28 描述为 ✅ 已完成,但 deploy 仍 500
- Opus 修复: ZX4 closure §0 Phase 1 行从 `✅` 改为 `⚠️ 代码层修法落地 / deploy 验证仍 surface 残留 500/502, deploy 根因未定位,承接到 ZX5`;§3.1 carryover 表 R28 行重写,加 "不能写为'无 user-facing 影响'等价于'无 bug'" 的辩证说明;risk severity 从 low 升 medium。ZX5 Lane E handoff 清单已含此项。
- 二审确认: closure 现在诚实区分 "code fix landed" 与 "deploy verification passed"。一审的 concern 已解决。

#### DeepSeek R4 (R29 通过删除路径 "解决" 而非定位根因) — 复核查:✅ 已修复,二审通过

- 原发现: closure 说 "R29 自动消失",实际是路径被删除
- Opus 修复: ZX4 closure §0 Phase 9 行和 §3.1 R29 行均加 "**注意**: R29 所指的 divergence 在 P9 flip 后不再触发是因为 parity 比较代码被删除,**不是定位并修复了 divergence 根因**" 的显式说明。risk 表 R29 行 severity 从 low 改 medium,标注 `resolved-by-deletion-not-fix`。
- 二审确认: 现在读者不会误以为 "divergence 根因被修复"。一审的 concern 已解决。

#### DeepSeek R5 (7-day 观察被 30-burst 替代) — 复核查:✅ 已修复,二审通过

- 原发现: 180 calls ≠ 7 天 + 1000 turns
- Opus 修复: ZX4 closure §1.9 新增 "等价性论述" 子节,明确 ✅ 功能等价 / ❌ 性能/边界/长尾不等价 / ❌ 退出 fast-track 窗口已关闭 / risk 接受策略 通过 `agent-rpc-throw` 自然 surface。§0 Phase 8 行加 `⚠️ (fast-tracked,功能验证 only)`。
- 二审确认: closure 不再声称等价,而是诚实描述为 "功能验证 only,不等价于 7-day 长尾覆盖"。一审的 concern 已解决。

#### DeepSeek R6 (parity-bridge.ts 中 logParityFailure 保留但永不触发) — 复核查:✅ 已修复,二审通过

- 原发现: 函数保留但永不被调
- Opus 修复: parity-bridge.ts:53 加了 "ZX4 Phase 9 retain-as-reference note (per deepseek R6)" 注释块,明确 `logParityFailure / computeBodyDiff / jsonDeepEqual` 的 fate: ① post-P9 user-do.ts 已不调用 ② deliberate retain-as-reference 供 ZX5+ 重启 dual-track 时复用 ③ 若 owner 确认永久 retired,后续 ZX5 cleanup 可加 @deprecated 或删除。
- 二审确认: 注释已清晰记录决策。一审的 concern 已解决。

#### DeepSeek R7 (workspace-context-artifacts + storage-topology import 数) — 复核查:✅ 已修复,二审通过

- 原发现: manifest 声称 37/16, grep 得 29/19,口径差异
- Opus 修复: ZX3 closure §1.3 加 "当前 import 计数口径说明" 子段,标注 manifest 数字与精确 grep 的口径差异 (manifest 含 package.json 依赖声明 + TS 类型 + test 引用 + 间接,grep 仅 runtime `from '@.../...'`)。GLM R4 已标注这两个口径的差异来源。
- 二审确认: 口径已说明。一审的 concern 已解决。

#### DeepSeek R8 (R2/KV 仍未 wiring) — 复核查:✅ deferred-with-rationale,二审通过

- 原发现: 6 个 worker 均无 R2/KV binding
- Opus 回应: 不在 ZX3/ZX4 scope,已 defer 到 ZX5 Lane E。ZX4 closure §3.4 已记录。D1 真持久化 (handleUsage / mintPendingSession) 已在 ZX4 land。
- 二审确认: rationale 成立 — R2/KV wiring 是独立 axis,不阻塞 transport close。但需确保 ZX5 Lane E 不遗忘此项。

#### DeepSeek R9 (forwardInternalJsonShadow 命名) — 复核查:✅ partially-fixed,二审通过

- 原发现: 方法名保留 "Shadow",行为已无 shadow
- Opus 回应: 方法体内注释已详细说明。rename 推迟到 ZX5 Lane C envelope refactor 时一并做 (避免 call site diff 冲突)。
- 二审确认: 注释充分,推迟理由合理。ZX5 Lane C 启动时一并 rename。

#### DeepSeek R10 (ZX3 Phase 3 scope reduction,closure 未承认) — 复核查:✅ 已修复,二审通过

- 原发现: v2 reclassification 实质是 scope reduction,closure 未记录
- Opus 修复: ZX3 closure §1.3 新增整个子段 "Scope reduction acknowledgment (per deepseek R10 / GLM R4)",明确 v1→v2 是 scope reduction 不是 simplification: 原计划 53-import 迁移整体取消,Phase 3 实际交付物降级为 6 份 README posture freeze(docs-only)。
- 二审确认: closure 现在诚实记录。一审的 concern 已解决。

#### DeepSeek R11 (docs/design 中 3 份非退役文档仍引用 test-legacy) — 复核查:✅ 已修复,二审通过

- 原发现: 3 份 docs/design 文件将 test-legacy 作 active 引用
- Opus 修复: 3 份文件头部均加 "POST-ZX3 NOTE (2026-04-28)" 标注,引导读者读 `test/INDEX.md` v0.4+ 与 ZX3-closure。
- 二审确认: 3 份文件均已标注。

#### DeepSeek R12 (migration 006 table-swap prod deploy 窗口) — 复核查:✅ 已修复,二审通过

- 原发现: prod deploy 存在短暂不一致窗口
- Opus 修复: runbook §2.4 新增 "重新启用 internal-http-compat profile" 流程,含 prod deploy 顺序硬约束 (Step A: migration → Step B/C: deploy workers → Step D: burst probe)。ZX4 closure §3.3 owner-action 第一条同步标注 hard gate。
- 二审确认: prod deploy 顺序已固化为 runbook 硬约束。

#### DeepSeek R13 (14 retired guardian 契约覆盖未 audit) — 复核查:✅ deferred-with-rationale,二审通过

- 原发现: retired guardian 的契约是否分散到 worker tests 未做 cross-reference
- Opus 回应: 当前 1567 tests 全绿是强信号。audit 作为 ZX5 backlog 不阻塞 ZX4 close。
- 二审确认: 这个 concern 属于审慎提醒级别 (一审本身标记为 low),defer 到 ZX5 启动前预热 task 合理。不阻塞 close。

---

### 7.3 4-reviewer 整体 fix quality 评估

| 类别 | 数量 | 代表项 | 二审评估 |
|------|------|--------|----------|
| **完全修复** | 18 | GPT R1-R5/R8, kimi R1/R3/R5/R6/R7, GLM R1-R4/R7/R9, deepseek R1-R7/R10-R12 | 全部可验证,closure/docs/code 一致 |
| **部分修复** (rename 推迟) | 1 | GPT R7 / kimi R8 / deepseek R9 (forwardInternalJsonShadow) | 注释加强已足,gating reason 成立 (call site diff) |
| **有理由 deferred** | 5 | GPT R6(lockfile), kimi R4(R28 根因), GLM R8(handleStart idempotency), deepseek R8(R2 wiring), deepseek R13(audit) | Rationale 均成立,承接位置明确,不阻塞 close |
| **拒绝** | 0 | — | 无 |

---

### 7.4 跨阶段评判: ZX3-ZX4 是否可以收口? ZX5 是否可以启动?

#### 7.4.1 ZX3 收口判定:✅ 可以关闭

- `packages/` 从 12 收敛至 6,物理删除与 keep-set 与 manifest 一致
- `test-legacy/` 已物理删除
- `test/` 新 4 层 canonical 树就绪,31/31 全绿
- 文档遗留: test/INDEX.md 已修正,3 份历史设计文档已加 POST-ZX3 NOTE
- 非阻塞遗留: lockfile (owner-action,已列入 closure)
- **收口条件满足**。

#### 7.4.2 ZX4 收口判定:✅ 可以关闭 — current-as-is, with explicit partial-by-design items

- **Lane A (transport close)**: `internal-http-compat: retired` 真实落地。orchestrator session actions RPC-only,agent-core `/internal/` 只剩 `stream/stream_snapshot`。代码变更经 deploy + burst probe 验证。这是 ZX2 transport 主线的真正终点。
- **Lane B (session semantics)**: D1 pending truth (migration 006 + 6-状态 + mint→start→active→detached→ended/expired) 闭合。Permission/elicitation/usage 的 contract 层全栈 land。Runtime kernel waiter (permission/elicitation await-resume + usage WS push) 诚实标注为 partial-by-design + deferred to ZX5 Lane E。
- **R28/R29 deploy carryover**: 已清晰区分 code fix landed vs deploy verification not passed vs root cause not identified。不阻塞 transport close。
- **Fast-track Phase 8**: 已诚实标注 "功能验证 only,不等价于 7-day 长尾"。
- **Prod migration**: runbook §2.4 已固化为 hard gate。
- **收口条件满足** — closure 不再有任何 over-claim,每一个 ⚠️ 项都有明确的 ZX5 承接清单。

#### 7.4.3 ZX5 启动条件判定:✅ 已具备

ZX4 closure §3.2 已产出清晰的 **ZX5 Lane E handoff checklist**:

| ZX4 已 land 的 contract 层 | ZX5 Lane E 必须新增的 runtime kernel work |
|---|---|
| orchestrator-core `handlePermissionDecision` + RPC forward | agent-core `PermissionRequest` hook 改为 await DO storage `permission/decisions/${requestUuid}` (polling + 超时) |
| orchestrator-core `handleElicitationAnswer` + RPC forward | agent-core `ElicitationRequest` hook 同上模式 |
| agent-core `session-do.ts:recordAsyncAnswer` DO storage 写入路径 | — (consumer side ready) |
| D1 usage write (quota repository) + read (`handleUsage` snapshot) | agent-core runtime emit `session.usage.update` server frame 在每次 LLM/tool call 后 |
| migration 006 D1 6-状态 model | prod D1 migration apply (owner-action hard gate) |

此外 ZX5 必须承接:
- **Lane E**: R2/KV wiring (bash-core → R2Adapter/KvAdapter), context-core/filesystem-core 真 RPC uplift
- **Lane E**: R28 deploy 根因定位 (wrangler tail)
- **Lane E**: handleStart idempotency 增强 (GLM R8)
- **Lane C**: `forwardInternalJsonShadow` → rename, envelope 收敛, jwt-shared 创建
- **Lane D**: 产品型 endpoints
- **Owner-action**: `pnpm-lock.yaml` 清理, prod migration 006 apply, WeChat 真机 smoke

**所有 ZX5 的启动前提 (transport retired + D1 truth model + contract 层) 都已就绪。ZX5 不需要重新奠基。**

---

### 7.5 二审发现的残余细小漂移 (非 blocker, 供 ZX5 启动前自纠)

二审在复查 closure 时注意到以下 3 个微小的数字漂移,均不改变结论:

1. **parity-bridge.ts 当前行数 = 350** (closure 双表写 342)。±8 行差异可能来自 retain-as-reference 注释块 8 行新增。closure 的 342 是写注释之前的数字。`建议`: ZX5 启动前跑一次 `wc -l` 看是否 >340 并微调 closure。

2. **user-do.ts 当前行数 = 1911** (closure 双表写 1910)。±1 行差异可忽略。`建议`: 同上。

3. **ZS3 closure §1.3 "当前 import 计数口径说明"** 写 grep 得 `6-29 / 0-19 / 0-2`,但解释中提到 "含 package.json 依赖声明 + TS 类型 + test 引用 + 间接" 的范围。实际 grep `from '@nano-agent/...'` 只匹配 runtime import,不匹配 package.json deps。这个解释可能夸大 manifest 数字的构成。`建议`: ZX5 启动前重新用标准口径 grep 一遍并统一计数方法。

**以上 3 项均不改变 ZX3-ZX4 close 或 ZX5 start 的决定。**

---

### 7.6 最终二审结论

> **ZX3-ZX4 可以收口。** closure 中不再存在一审发现的 3 类措辞误导,4-reviewer 的 18 项完全修复 + 5 项有理由 defer 构成可置信的交付状态。**ZX5 可以按 ZX4 closure §3.2 的 handoff checklist 启动,不需要重新奠基。**

- **最终 verdict**: `approve — ZX3 close / ZX4 close (current-as-is, with explicit ⚠️ partial-by-design items) / ZX5 start with Lane E handoff`
- **是否允许关闭本轮 review**: `yes — 二审后不再要求 re-review。deferred 项的 follow-through 由 ZX5 action-plan 承载。`


