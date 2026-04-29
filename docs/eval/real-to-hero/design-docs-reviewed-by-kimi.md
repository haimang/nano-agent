# Design Docs Review — Real-to-Hero Phase (RH0–RHX)

> 审查对象: `docs/design/real-to-hero/{RH0..RH6,RHX}.md`
> 审查类型: `docs-review`
> 审查时间: `2026-04-29`
> 审查人: `Kimi (k2p6)`
> 审查范围:
> - `docs/design/real-to-hero/RH0-bug-fix-and-prep.md`
> - `docs/design/real-to-hero/RH1-lane-f-live-runtime.md`
> - `docs/design/real-to-hero/RH2-llm-delta-policy.md`
> - `docs/design/real-to-hero/RH3-device-auth-gate-and-api-key.md`
> - `docs/design/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`
> - `docs/design/real-to-hero/RH5-multi-model-multimodal-reasoning.md`
> - `docs/design/real-to-hero/RH6-do-megafile-decomposition.md`
> - `docs/design/real-to-hero/RHX-qna.md`
> - `docs/charter/plan-real-to-hero.md`
> 对照真相:
> - `workers/{agent-core,orchestrator-core,orchestrator-auth,filesystem-core,context-core}/src/**/*.ts`
> - `workers/*/wrangler.jsonc`
> - `packages/{nacp-session,jwt-shared,orchestrator-auth-contract}/src/**/*.ts`
> - `workers/orchestrator-core/migrations/*.sql`
> - `pnpm-lock.yaml`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**: `七份设计文档对当前代码 gap 的定性描述基本准确，但部分文档在 gap 的定量严重度上存在低估；RH0 对基础设施断点的描述偏乐观，RH1 对 scheduler 改造深度的判断偏浅，RH3 对 schema 现实缺口的覆盖不完整，RH5 对 canonical 类型扩展前提假设有误。`
- **结论等级**: `approve-with-followups`
- **是否允许关闭本轮 review**: `yes`
- **本轮最关键的 1-3 个判断**:
  1. `RH0 对 pnpm-lock.yaml 断点的定性是“stale importer”，但事实是 jwt-shared 在 lockfile 中完全缺失（0 条记录），且存在 2 个已不存在的包的 stale importer。 severity 应为 critical 而非 medium。`
  2. `RH0 对 KV/R2 binding 的描述是“未声明业务路径，仅占位”，但事实是 6 个 worker 的 wrangler.jsonc 中完全没有 KV namespace 或 R2 bucket 的任何声明。 severity 应为 high。`
  3. `RH5 假设 canonical LLM request 已具备 reasoning effort 字段，但 `workers/agent-core/src/llm/canonical.ts:67-77` 的 CanonicalLLMRequest 接口中完全没有 reasoning 相关字段。该设计的前提假设不成立，需要在 action-plan 中补 schema 扩展步骤。`

---

## 1. 审查方法与已核实事实

### 1.1 已确认的正面事实

> 以下事实证明设计文档的主体判断与代码现实一致，设计文档的“定性”是可信的。

- **F1** `NanoSessionDO` 主文件精确为 2078 行，`user-do.ts` 精确为 2285 行 — 与设计文档、charter §1.2 完全一致。
- **F2** `runtime-mainline.ts:295-299` 的 `hook.emit` 确实是 no-op（`async emit(_event: string, _payload: unknown) { return undefined; }`）。
- **F3** `nano-session-do.ts:494-501` 的 `onUsageCommit` 回调确实仅为 `console.log`，无 WS push 路径。
- **F4** `orchestrator-auth/src/service.ts:402-414` 的 `verifyApiKey()` 确实返回 `{supported: false, reason: "reserved-for-future-phase"}`。
- **F5** `gateway.ts:20-53` 仅注册 2 个 Workers AI 模型，且 `contextWindow: 128_000`（charter 要求修正为 131K），`supportsVision: false`。
- **F6** `orchestrator-core/src/index.ts` 中不存在 `GET /models` 路由，不存在 `GET /sessions/{id}/context` 路由。
- **F7** `filesystem-core/src/index.ts` 仍为 library-only worker：非 `/health` 路径返回 401，`library_worker: true`。
- **F8** `agent-core/wrangler.jsonc:49-50` 的 `CONTEXT_CORE` 与 `FILESYSTEM_CORE` binding 仍为注释状态。
- **F9** `nano-session-do.ts:353` 仍实例化 `new InMemoryArtifactStore()`，无 R2 持久化路径。
- **F10** `orchestrator-core/src/user-do.ts:1738-1805` 的 `handleMeSessions()` 读取 KV+D1 双源合并，而 `handleMeConversations()`（line 1810+）仅读取 D1，无 KV 合并 — 双源未对齐 gap 与设计文档描述一致。
- **F11** `orchestrator-core/src/auth.ts:105-184` 的 `authenticateRequest()` 未检查 `device_uuid` claim，未查询 `nano_user_devices` 表 — device auth gate 完全未建立。
- **F12** `orchestrator-core/migrations/001-identity-core.sql:33-39` 的 `nano_teams` 表仅有 `team_uuid`、`owner_user_uuid`、`created_at`、`plan_level`，无 `team_name`、`team_slug` 字段。
- **F13** `orchestrator-core/migrations/001-identity-core.sql:67-78` 的 `nano_team_api_keys` 表有 `key_hash`，但**无 salt 字段**。
- **F14** `orchestrator-core/test/` 目录下仅有 `auth.test.ts`、`jwt-helper.ts`、`kid-rotation.test.ts`、`parity-bridge.test.ts`、`smoke.test.ts`、`user-do.test.ts`，**无任何 ZX5 product endpoint（messages/files/me-conversations/me-devices）的 endpoint-level 直达测试**。

### 1.2 已确认的负面事实

> 以下事实证明设计文档存在 understatement、blind spot 或事实错误。

- **N1** `pnpm-lock.yaml` 中 `jwt-shared` 完全无记录（`grep -c "jwt-shared"` = 0），而非设计文档暗示的“存在但 importer 断裂”。
- **N2** `pnpm-lock.yaml` 存在 2 个 stale importer：`packages/agent-runtime-kernel` 与 `packages/capability-runtime`，但这两个目录在 `packages/` 下已不存在。
- **N3** 6 个 worker 的 `wrangler.jsonc` 中**没有任何 KV namespace 或 R2 bucket binding 声明**，不是“未启用业务路径”的问题，而是 binding 定义本身完全缺失。
- **N4** `scheduler.ts` 是纯函数，返回的 `StepDecision` union 类型中**没有任何 hook 相关变体**。当前 scheduler 根本不产生 hook 决策，这比“scheduler 不产生 hook_emit”更深 — 是“scheduler 的数据模型里根本没有 hook 这个概念”。
- **N5** `CanonicalLLMRequest`（`workers/agent-core/src/llm/canonical.ts:67-77`）没有 `reasoning` 字段。RH5 设计假设该字段已存在，但实际上需要新增 schema 扩展。
- **N6** `SessionStartBodySchema`（`packages/nacp-session/src/messages.ts:18-25`）没有 `model_id` 字段。RH5 假设 per-session model selection 只需“透传”，但公共 schema 层面需要先扩展。
- **N7** `emitPermissionRequestAndAwait()`（`nano-session-do.ts:797-815`）虽然存在，但**不真正 emit WS frame**（仅调用 `awaitAsyncAnswer`）。注释明确写着“frame emit is best-effort”且 WS helper 调用为 `void`。
- **N8** `workers/orchestrator-core/src/index.ts` 的 facade 路由白名单中没有 `/models` 或 `/sessions/{id}/context` 的匹配分支 — 这些端点不仅未实现 handler，连路由入口都不存在。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐文件 grep + Read 核对设计文档引用的行号与代码内容 |
| 本地命令 / 测试 | yes | `wc -l` 确认巨石行数、`grep -c` 确认 lockfile 缺失、`ls` 确认测试目录 |
| schema / contract 反向校验 | yes | 核对 migrations SQL schema、canonical.ts 接口、messages.ts schema |
| live / deploy / preview 证据 | no | 本 review 为 design doc review，未执行 deploy/preview |
| 与上游 design / QNA 对账 | yes | 逐条对照 charter §1.2 / §2.2 / §4.0 的 claims |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | RH0 对 pnpm-lock.yaml 断点 severity 低估 | critical | docs-gap | yes | 将 jwt-shared 完全缺失升级为 critical blocker；在 action-plan 中增加 lockfile 重建步骤 |
| R2 | RH0 对 KV/R2 binding 缺口描述不准确 | high | docs-gap | yes | 修正描述为“6 worker 全部无 KV/R2 binding 声明”，而非“未启用业务路径” |
| R3 | RH1 对 scheduler hook 改造深度判断偏浅 | high | scope-drift | no | 在 action-plan 中明确 scheduler 需要先扩展 StepDecision union 类型以包含 hook 变体 |
| R4 | RH3 未覆盖 nano_teams schema 现实缺口 | medium | docs-gap | no | 在 RH3 action-plan 中明确 migration 009 需新增 `team_name`、`team_slug` 列（当前表完全缺失） |
| R5 | RH3 对 API key salt 字段缺失未提及 | medium | docs-gap | no | 在 RH3 action-plan 中明确 migration 009 需为 `nano_team_api_keys` 新增 salt 列 |
| R6 | RH5 对 canonical schema 前提假设有误 | high | correctness | yes | 在 RH5 action-plan 中前置“CanonicalLLMRequest 新增 reasoning 字段”和“SessionStartBodySchema 新增 model_id 字段”步骤 |
| R7 | RH1 对 emitPermissionRequestAndAwait 的 WS frame emit 状态描述模糊 | medium | docs-gap | no | 明确说明当前该方法不 emit frame，仅 await storage |
| R8 | RH2 对 `/models` endpoint 缺失的定性正确但路由层缺口未提 | low | docs-gap | no | 补充说明：不仅 handler 缺失，facade 路由入口也缺失 |
| R9 | RH6 对拆分后文件行数目标合理，但未提及 import cycle 风险 | medium | docs-gap | no | 建议在 action-plan 中增加“拆后依赖图审核”步骤 |

### R1. RH0 对 pnpm-lock.yaml 断点 severity 低估

- **严重级别**: `critical`
- **类型**: `docs-gap`
- **是否 blocker**: `yes`
- **事实依据**:
  - `pnpm-lock.yaml` 中 `jwt-shared` 出现次数为 0（`grep -c "jwt-shared" pnpm-lock.yaml` = 0）。
  - 同时存在 2 个 stale importer：`packages/agent-runtime-kernel` 与 `packages/capability-runtime`，这两个目录在 `packages/` 下已物理删除。
  - `packages/jwt-shared/package.json` 存在独立 build/typecheck/test 脚本，但 lockfile 不记录该包意味着任何 fresh `pnpm install` 都无法解析 `@haimang/jwt-shared` 的依赖树。
- **为什么重要**: RH0 的收口标准包含 “`pnpm --filter @haimang/jwt-shared build typecheck test` 全绿”。若 lockfile 完全缺失 jwt-shared 的 importer，fresh install 场景下该命令会直接失败。这比“stale importer 导致不确定性”更严重 — 是确定性失败。
- **审查判断**: RH0 设计文档 §7.1 F1 和 charter §2.2 G10 将问题定性为“lockfile 断裂 / 缺 importer + 含 stale importer”，但未指出 jwt-shared 的**完全缺失**。action-plan 必须将 lockfile 重建（而非仅刷新）作为 P0-A 的首要任务。
- **建议修法**: 在 RH0 action-plan P0-A 中增加：`pnpm-lock.yaml 需完整重建（非仅刷新），确保 @haimang/jwt-shared 的 importer 和 dependency tree 被写入；同时删除 packages/agent-runtime-kernel 与 packages/capability-runtime 的 stale importer。`

### R2. RH0 对 KV/R2 binding 缺口描述不准确

- **严重级别**: `high`
- **类型**: `docs-gap`
- **是否 blocker**: `yes`
- **事实依据**:
  - 对 6 个 worker 的 `wrangler.jsonc` 执行 `grep -n "KV\|R2\|kv_namespace\|r2_buckets"` 均返回空。
  - `orchestrator-core/wrangler.jsonc` 有 `d1_databases`、`services`、`durable_objects`，但无 `kv_namespaces` 或 `r2_buckets`。
  - `agent-core/wrangler.jsonc` 同样无任何 KV/R2 声明。
- **为什么重要**: RH4 的 file pipeline 和 RH5 的 multi-model 都依赖 R2/KV binding。若 RH0 只理解为“占位声明”，实施者可能只添加空占位，但 charter 的 DoD 要求“dry-run 通过 + binding 在启动 env 中可见”。当前状态是“binding 完全不存在于配置文件中”，dry-run 即使通过也无法在 Worker env 中读取到 KV/R2 binding。
- **审查判断**: 设计文档和 charter 均将问题描述为“未声明业务路径”或“占位声明”，暗示 binding 配置已存在但业务代码未消费。事实是 binding 配置本身完全缺失。
- **建议修法**: 将 RH0 P0-C 描述修正为：“在 6 worker 的 wrangler.jsonc 中**首次声明** KV namespace 和 R2 bucket binding（当前完全缺失），确保 `wrangler deploy --dry-run` 通过且 binding 在 Worker env 中可见。”

### R3. RH1 对 scheduler hook 改造深度判断偏浅

- **严重级别**: `high`
- **类型**: `scope-drift`
- **是否 blocker**: `no`
- **事实依据**:
  - `workers/agent-core/src/kernel/scheduler.ts` 是纯函数，返回的 `StepDecision` union 仅包含 `wait | compact | tool_exec | llm_call | finish`。
  - 没有任何 hook 相关变体（如 `hook_emit`）。
  - 这意味着 RH1 不仅要“让 scheduler 产生 hook_emit 决策”，还要**先扩展 scheduler 的数据模型**。
- **为什么重要**: 若 action-plan 中未包含 StepDecision 类型扩展，实施者可能在 runtime-mainline 层硬编码 hook 逻辑，导致 scheduler 与 hook 解耦的设计意图被破坏。
- **审查判断**: RH1 设计文档 §7.2 F1 说“scheduler 产生 hook_emit 决策”，但未说明当前 scheduler 的类型系统中不存在 hook 概念。这是一个比“接线”更深的改造。
- **建议修法**: 在 RH1 action-plan P1-B 中增加前置步骤：“扩展 `StepDecision` union 类型，新增 `hook_emit` 变体；同步更新 scheduler.ts 的测试矩阵。”

### R4. RH3 未覆盖 nano_teams schema 现实缺口

- **严重级别**: `medium`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `migrations/001-identity-core.sql:33-39` 的 `nano_teams` 表仅有 `team_uuid`、`owner_user_uuid`、`created_at`、`plan_level`。
  - 无 `team_name`、无 `team_slug`、无 `display_name`。
- **为什么重要**: RH3 设计文档 §7.2 F2 说“team_name/team_slug 进入 auth/me product surface”，但未指出当前表结构**完全没有这些列**。实施者可能误以为只需在应用层添加字段映射。
- **审查判断**: 这是一个 schema 现实缺口，不是应用层缺口。migration 009 必须包含 `ALTER TABLE nano_teams ADD COLUMN team_name TEXT` 和 `ADD COLUMN team_slug TEXT`（或重建表）。
- **建议修法**: 在 RH3 action-plan P3-B 中明确：“migration 009 需为 `nano_teams` 新增 `team_name`（TEXT NOT NULL DEFAULT ''）和 `team_slug`（TEXT UNIQUE）列；注册时自动生成 slug。”

### R5. RH3 对 API key salt 字段缺失未提及

- **严重级别**: `medium`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `nano_team_api_keys` 表有 `key_hash`（TEXT NOT NULL），但无 `salt` 字段。
  - RH3 设计文档 §7.2 F3 提到“HMAC-SHA256(salt:raw) 查 nano_team_api_keys”。
- **为什么重要**: 若按设计文档的 HMAC-SHA256(salt:raw) 方案，salt 必须在表中持久化。当前 schema 不支持该方案。
- **审查判断**: 设计文档的 verify 逻辑与现有 schema 不兼容。
- **建议修法**: 在 RH3 action-plan P3-C 中明确：“migration 009 需为 `nano_team_api_keys` 新增 `key_salt TEXT NOT NULL` 列；或改用无 salt 的 bcrypt/argon2 方案并更新设计文档。”

### R6. RH5 对 canonical schema 前提假设有误

- **严重级别**: `high`
- **类型**: `correctness`
- **是否 blocker**: `yes`
- **事实依据**:
  - `workers/agent-core/src/llm/canonical.ts:67-77` 的 `CanonicalLLMRequest` 接口无 `reasoning` 字段。
  - `packages/nacp-session/src/messages.ts:18-25` 的 `SessionStartBodySchema` 无 `model_id` 字段。
- **为什么重要**: RH5 设计文档 §7.2 F2 说“`model_id` 进入 start/messages surface 并一路透传”，§7.2 F4 说“`reasoning.effort` 进入 canonical request 与 adapter 翻译”。但这两个字段在 schema 层面尚不存在，无法“透传”。
- **审查判断**: 这是前提假设错误，不是实现缺口。action-plan 必须前置 schema 扩展步骤，否则实施者会陷入“schema 没有字段但 runtime 要透传”的矛盾。
- **建议修法**: 在 RH5 action-plan 中增加前置步骤 P5-A0：“扩展 `CanonicalLLMRequest` 新增 `reasoning?: {effort: "low"|"medium"|"high"}`；扩展 `SessionStartBodySchema` 和 `SessionMessagesBodySchema` 新增 `model_id?: string`。”

### R7. RH1 对 emitPermissionRequestAndAwait 的 WS frame emit 状态描述模糊

- **严重级别**: `medium`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `nano-session-do.ts:797-815` 的 `emitPermissionRequestAndAwait()` 中，WS frame emit 被注释为“silently no-op when detached”，且代码中 `void this.getWsHelper?.bind(this)` 不执行实际 emit。
- **为什么重要**: 设计文档 §7.2 F2 说“ask/answer 进入真等待与恢复”，但未明确当前该方法**不 emit WS frame**。这可能导致实施者误以为只需接 dispatcher，而忽略 frame emit 路径也需要重建。
- **审查判断**: 该方法当前是“半 stub” — 等待基础设施存在，但 frame emit 缺失。
- **建议修法**: 在 RH1 action-plan P1-C 中明确：“`emitPermissionRequestAndAwait` 需同时完成 (a) WS `session.permission.request` frame 真实 emit 和 (b) DO storage waiter 激活。”

### R8. RH2 对 `/models` endpoint 缺失的定性正确但路由层缺口未提

- **严重级别**: `low`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `orchestrator-core/src/index.ts` 中没有 `/models` 路由匹配分支。
  - 不仅 handler 不存在，连 facade 路由入口都不存在。
- **为什么重要**: 对实施者而言，“新增端点” vs “新增路由 + handler” 的工作量评估不同。
- **审查判断**: 设计文档正确识别了 endpoint 缺失，但未提及其在 facade 路由层的完全空白。
- **建议修法**: 在 RH2 action-plan P2-A 中补充：“需在 `orchestrator-core/src/index.ts` 新增 `GET /models` 路由匹配分支。”

### R9. RH6 对拆分后文件行数目标合理，但未提及 import cycle 风险

- **严重级别**: `medium`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `nano-session-do.ts` 目前导入了大量内部模块（`../kernel/runner.js`、`../ws-controller.js`、`../http-controller.js` 等），拆分后这些依赖关系可能形成循环。
  - `user-do.ts` 同样导入了 `../auth.js`、D1 repo、KV 存储等，拆分后 cross-handler 共享代码的依赖图需要重新梳理。
- **为什么重要**: charter §10.3 NOT-成功退出识别 第 1 条明确禁止“拆出文件含 import cycle”。若 action-plan 中没有依赖图审核步骤，实施者可能在拆分后才暴露循环依赖。
- **审查判断**: 设计文档 §6.2 提到“不能引入 import cycle”，但未在 action-plan 层面给出预防步骤。
- **建议修法**: 在 RH6 action-plan P6-A/P6-B 中增加步骤：“拆分前先绘制当前模块依赖图，识别潜在循环；拆后运行 `tsc --noEmit` 和循环依赖检测脚本确认无 cycle。”

---

## 3. In-Scope 逐项对齐审核

> 结论统一使用：`done | partial | missing | stale | out-of-scope-by-design`。

### 3.1 RH0 — Bug Fix and Prep

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| RH0-S1 | jwt-shared 独立 build/test 修复 | missing | lockfile 中 jwt-shared 完全缺失（0 条记录），非仅 importer 断裂 |
| RH0-S2 | ZX5 endpoint 直达测试基线 | missing | orchestrator-core/test/ 无 messages/files/me-conversations/me-devices 的 endpoint-level 测试 |
| RH0-S3 | KV/R2 binding 占位声明 | missing | 6 worker 的 wrangler.jsonc 中完全无 KV/R2 声明 |
| RH0-S4 | NanoSessionDO verify/persistence 预拆分 | missing | 当前无 `session-do-verify.ts` 或 `session-do-persistence.ts` 文件 |
| RH0-S5 | bootstrap hardening | missing | 无 bootstrap stress test 文件 |
| RH0-S6 | owner tooling checklist | missing | 无 `docs/owner-decisions/real-to-hero-tooling.md` 文件 |

**对齐结论**: 6 项 in-scope 全部 `missing`。RH0 尚未开始 implementation，此结论符合预期，但 action-plan 需要修正 R1/R2 的 severity。

### 3.2 RH1 — Lane F Live Runtime

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| RH1-S1 | hook dispatcher 激活 | missing | hook.emit 仍为 no-op |
| RH1-S2 | scheduler 产生 hook_emit | missing | scheduler.ts 无 hook 变体；改造深度比设计文档更深 |
| RH1-S3 | permission round-trip | partial | `emitPermissionRequestAndAwait` 存在但 WS frame 不 emit；仅 storage waiter |
| RH1-S4 | elicitation round-trip | partial | 同 permission，storage waiter 存在但 frame emit 缺失 |
| RH1-S5 | onUsageCommit WS push | missing | 仍为 console.log |

**对齐结论**: 2 项 `partial`（waiter 基础设施存在但 frame emit 缺失），3 项 `missing`。RH1 的 action-plan 需要补充 scheduler 类型扩展（R3）。

### 3.3 RH2 — LLM Delta Policy

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| RH2-S1 | semantic-chunk policy 冻结 | done | 设计文档本身即为 policy freeze，无 implementation 状态 |
| RH2-S2 | snapshot-vs-push law 文档化 | done | 同上，文档本身即为交付物 |
| RH2-S3 | GET /models endpoint | missing | 路由入口和 handler 均不存在 |
| RH2-S4 | GET /context endpoint | missing | 同上 |
| RH2-S5 | WS NACP frame 升级 | missing | 当前仍为 lightweight frame |
| RH2-S6 | tool call semantic-chunk streaming | missing | runtime-mainline 仅 yield `tool_calls`/`result`，无 semantic delta |

**对齐结论**: 2 项 `done`（policy 文档），4 项 `missing`。RH2 设计文档作为 policy doc 是合格的，但下游 action-plan 需要补全 endpoint 和 frame 实现。

### 3.4 RH3 — Device Auth Gate and API Key

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| RH3-S1 | device_uuid claim 注入 | missing | `authenticateRequest` 不检查 device_uuid；JWT claims 中无 device_uuid |
| RH3-S2 | access/refresh/WS device gate | missing | `auth.ts` 无 device 状态查询 |
| RH3-S3 | team_name/team_slug | missing | `nano_teams` 表无这些列 |
| RH3-S4 | verifyApiKey runtime path | missing | 返回 `supported:false` |
| RH3-S5 | /me/conversations 双源对齐 | partial | D1 查询存在，但无 KV 合并（与 /me/sessions 不一致） |
| RH3-S6 | API key salt 字段 | missing | `nano_team_api_keys` 无 salt 列 |

**对齐结论**: 5 项 `missing`，1 项 `partial`。action-plan 需要补 schema 扩展（R4/R5）。

### 3.5 RH4 — Filesystem R2 Pipeline and Lane E

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| RH4-S1 | R2 artifact persistence | missing | `InMemoryArtifactStore` 仍在使用，无 R2ArtifactStore |
| RH4-S2 | filesystem-core 业务 RPC | partial | WorkerEntrypoint 存在但仅返回 op list，无真实业务逻辑 |
| RH4-S3 | agent-core binding 启用 | missing | CONTEXT_CORE / FILESYSTEM_CORE 仍为注释 |
| RH4-S4 | POST /sessions/{id}/files upload | missing | 无 multipart upload handler |
| RH4-S5 | Lane E dual-track sunset | missing | 无 sunset 时间盒文档化 |

**对齐结论**: 4 项 `missing`，1 项 `partial`。设计文档对当前 gap 的描述准确。

### 3.6 RH5 — Multi-Model Multimodal Reasoning

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| RH5-S1 | 13+4+8 model registry | missing | 仅 2 个模型硬编码 |
| RH5-S2 | per-session model_id 透传 | missing | `SessionStartBodySchema` 无 `model_id` 字段；`CanonicalLLMRequest` 也无 |
| RH5-S3 | vision capability 激活 | missing | `supportsVision: false`；无 image_url 到 execution path 的贯通 |
| RH5-S4 | reasoning effort 贯通 | missing | `CanonicalLLMRequest` 无 reasoning 字段 |

**对齐结论**: 4 项全部 `missing`。且存在前提假设错误（R6）：schema 扩展必须先于 runtime 透传。

### 3.7 RH6 — DO Megafile Decomposition

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| RH6-S1 | NanoSessionDO 拆 7 文件 | missing | 当前为单文件 2078 行 |
| RH6-S2 | user-do.ts 按 domain 拆 | missing | 当前为单文件 2285 行 |
| RH6-S3 | three-layer truth 文档 | missing | 无 `docs/architecture/three-layer-truth.md` |
| RH6-S4 | evidence pack | missing | 无 evidence 目录 |
| RH6-S5 | residue cleanup | missing | dead `deploy-fill` 等未清理 |

**对齐结论**: 5 项全部 `missing`，符合预期（RH6 是收口 phase）。

### 3.8 对齐结论汇总

- **done**: 2（均为 RH2 policy 文档本身）
- **partial**: 4（RH1 waiter 基础设施、RH3 D1 查询、RH4 WorkerEntrypoint 外形）
- **missing**: 29
- **stale**: 0
- **out-of-scope-by-design**: 0

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | RH0 不实现 Lane F / Models / Files 功能 | 遵守 | 设计文档明确排除 |
| O2 | RH1 不新增 client-facing endpoint | 遵守 | 设计文档明确排除 |
| O3 | RH2 不做 token-level streaming | 遵守 | 设计文档和 charter 均明确 out-of-scope |
| O4 | RH3 不做 API key admin plane | 遵守 | 设计文档明确排除 |
| O5 | RH3 不做 OAuth federation | 遵守 | 设计文档明确排除 |
| O6 | RH4 不做 3-step presigned upload | 遵守 | 设计文档明确排除 |
| O7 | RH4 不做 prepared artifact 真处理 | 遵守 | 设计文档明确排除 |
| O8 | RH5 不做 second provider | 遵守 | 设计文档明确排除 |
| O9 | RH5 不做 per-model quota | 遵守 | 设计文档明确排除 |
| O10 | RH6 不做新功能 / 新 schema | 遵守 | 设计文档明确排除 |
| O11 | RH6 不做 SQLite-DO | 遵守 | charter D2 决议冻结 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**: `七份设计文档对 real-to-hero 各 phase 的目标、边界、与当前代码 gap 的定性描述总体准确可信。但 RH0、RH1、RH3、RH5 的 action-plan 需要按本 review 的 R1-R9 进行修正，特别是 lockfile 完全缺失（R1）、KV/R2 binding 完全缺失（R2）、scheduler 类型扩展（R3）、schema 前提假设（R6）四项。`
- **是否允许关闭本轮 review**: `yes`
- **关闭前必须完成的 blocker**:
  1. `RH0 action-plan 必须将 pnpm-lock.yaml 修复从“刷新 stale importer”升级为“完整重建并验证 jwt-shared 存在”。`
  2. `RH0 action-plan 必须将 KV/R2 binding 从“占位声明”升级为“在 6 worker wrangler.jsonc 中首次声明 binding”。`
  3. `RH5 action-plan 必须在 model_id / reasoning effort 透传之前，前置 CanonicalLLMRequest 和 SessionStartBodySchema 的字段扩展步骤。`
- **可以后续跟进的 non-blocking follow-up**:
  1. `RH1 action-plan 补充 scheduler StepDecision union 扩展步骤（R3）。`
  2. `RH3 action-plan 补充 nano_teams 表新增 team_name/team_slug 列（R4）和 nano_team_api_keys 新增 salt 列（R5）。`
  3. `RH6 action-plan 增加拆前依赖图审核步骤（R9）。`
- **建议的二次审查方式**: `independent reviewer`（建议由 DeepSeek 或 GLM 对修正后的 action-plan 做独立复核）
- **实现者回应入口**: `请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待 action-plan 修正后按 §6 响应并再次更新文档。

---

## 6. 附录：逐设计文档详细核查笔记

### 6.1 RH0 — 核查笔记

**设计文档准确点**:
- `NanoSessionDO` 2078 行、`user-do.ts` 2285 行 — 精确匹配。
- `jwt-shared` 独立包脚本存在 — `packages/jwt-shared/package.json` 有 build/typecheck/test 脚本。
- root 测试脚本已分 contracts / package-e2e / cross-e2e — `package.json` 确认。

**设计文档低估点**:
- pnpm-lock.yaml 中 jwt-shared 完全缺失，非仅 importer 断裂。
- KV/R2 binding 在 6 worker 中完全缺失，非仅“未启用业务路径”。

### 6.2 RH1 — 核查笔记

**设计文档准确点**:
- `hook.emit` no-op — 精确匹配 `runtime-mainline.ts:295-299`。
- `onUsageCommit` console.log — 精确匹配 `nano-session-do.ts:494-501`。
- `emitPermissionRequestAndAwait` / `emitElicitationRequestAndAwait` 存在但为 contract-only — 精确匹配 `nano-session-do.ts:797-829`。
- permission/elicitation HTTP mirror 在 user-do.ts 存在 — `handlePermissionDecision` / `handleElicitationAnswer` 已存在（line 1286-1415）。

**设计文档低估点**:
- scheduler.ts 无 hook 概念，需先扩展类型系统。
- `emitPermissionRequestAndAwait` 不 emit WS frame，仅 await storage。

### 6.3 RH2 — 核查笔记

**设计文档准确点**:
- token-level streaming out-of-scope — 与 charter 一致。
- semantic-chunk 定义合理 — 与现有 `nacp-session` taxonomy 兼容。
- GET /models、GET /context 不存在 — 确认。

**设计文档遗漏点**:
- `/models` 和 `/context` 在 facade 路由层完全空白（连路由入口都没有）。

### 6.4 RH3 — 核查笔记

**设计文档准确点**:
- `verifyApiKey` 返回 `supported:false` — 精确匹配。
- device revoke 仅写 D1，不进 auth gate — 精确匹配（`auth.ts` 无 device 检查）。
- `/me/conversations` 与 `/me/sessions` 双源未对齐 — 精确匹配。

**设计文档遗漏点**:
- `nano_teams` 表无 `team_name`/`team_slug`。
- `nano_team_api_keys` 表无 `salt`。

### 6.5 RH4 — 核查笔记

**设计文档准确点**:
- filesystem-core library-only — 精确匹配（401 + `library_worker: true`）。
- `InMemoryArtifactStore` 仍在使用 — 精确匹配 `nano-session-do.ts:353`。
- agent-core binding 注释 — 精确匹配 `wrangler.jsonc:49-50`。

**设计文档准确点（无遗漏）**:
- 对当前 gap 的描述全面且准确。

### 6.6 RH5 — 核查笔记

**设计文档准确点**:
- 仅 2 个模型硬编码 — 精确匹配 `gateway.ts:20-53`。
- `supportsVision: false` — 精确匹配。
- contextWindow 128K（需修正为 131K）— 精确匹配当前值。

**设计文档错误点**:
- 假设 `CanonicalLLMRequest` 已有 reasoning 字段 — 实际不存在（R6）。
- 假设 `SessionStartBodySchema` 已有 `model_id` — 实际不存在（R6）。

### 6.7 RH6 — 核查笔记

**设计文档准确点**:
- 巨石行数精确。
- 拆分目标合理（≤400 行 facade）。
- three-layer truth 文档需求合理。

**设计文档遗漏点**:
- 未提及拆前依赖图审核（R9）。

### 6.8 RHX — 核查笔记

**设计文档准确点**:
- Q1-Q5 的问题定义清晰，影响范围描述准确。
- 问题写法符合“业主可直接作答”标准。
- Reasoning 写法符合模板要求。

**设计文档状态**:
- Q1-Q5 均 pending owner answer，与设计文档声明一致。
- 本 review 确认 Q1（team_slug law）、Q2（sunset ≤2 周）、Q3（no per-model quota）、Q4（evidence 范围）、Q5（tooling checklist）均需要在对应 phase 启动前冻结，与设计文档一致。

---

*End of review*

---

## 7. 审查质量评估（appended by Opus 4.7, 2026-04-29）

### 7.0 评价结论

- **一句话评价**：4 份审查中"业主可执行性最强"的一份；severity 校准最严格（4 reviewer 中第一个把 lockfile gap 标为 critical），R5（API key salt）是独家发现；R3（scheduler 改造深度）有一处核查偏差，但不影响整体可信度。
- **综合评分**：`8.5 / 10`
- **推荐使用场景**：业主直接拿来排 P0-A/P0-B/P0-C 优先级、向业主解释 severity 时；schema/DDL 现实缺口的 quick check。
- **不建议单独依赖的场景**：runtime 协议运行态深度 trace（GLM 强）；charter alignment 治理问题（GPT 强）；已建成资产识别（deepseek 强）。

### 7.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | platform fitness + DDL/schema 现实 vs 设计假设 | R1（lockfile）/ R2（KV/R2 binding）/ R4（nano_teams 表）/ R5（api_keys salt 列）|
| 证据类型 | grep -c / wc -l / file existence + DDL 反向校验 | "grep -c 'jwt-shared' = 0"等命令级一手证据 |
| Verdict 倾向 | strict-but-pragmatic | approve-with-followups + 3 blocker 显式标 yes |
| Finding 粒度 | balanced | 9 finding 覆盖 7 个 phase，每条对应一个具体 action-plan 修整 |
| 修法建议风格 | actionable + 业主可读 | 多数带"在 P0-A 中增加..."的具体定位 |

### 7.2 优点与短板

#### 7.2.1 优点

1. **R5 独家发现**：`nano_team_api_keys` 表无 `salt` 列、与 RH3 设计的 HMAC-SHA256(salt:raw) 方案不兼容——这条 4 reviewer 中只有 kimi 抓到，进入 RH3 §8.4 migration 009 schema 变更清单 + Phase 1 直接落地。
2. **severity 校准最严格**：在 lockfile / binding 两条 platform fitness finding 上，kimi 是 4 reviewer 中第一个明确标 critical（R1 critical / R2 high blocker），与 GPT changes-requested 形成共振，避免业主把 RH0 当 trivial pre-work。
3. **业主可执行性最强**：每条 finding 后都有"在 RH0 P0-A 中增加..."、"在 RH3 action-plan P3-B 中明确..."这样的下游定位，让业主可以直接转发给 implementer 而不需 review re-translation。
4. **R9（import cycle 风险）有前瞻**：拆前依赖图审核 + `madge --circular` 检测脚本的修法建议，直接进入 RH6 §6.2 风险表 + Phase 1 madge CI gate；charter §10.3 NOT-成功退出第 1 条因此可被自动化 enforcement。

#### 7.2.2 短板 / 盲区

1. **R3 核查偏差**：kimi 说"scheduler 数据模型里没有 hook 概念"，但实际上 `kernel/types.ts:30,62` 已含 `hook_emit` StepKind/StepDecision 变体；deepseek R7 已纠正此点。这条不是 false-positive（scheduler 自身确实需要扩业务逻辑），但严重度被高估为 high scope-drift。
2. **missing finding 比例偏高**：3.4 表中 RH3 一个 phase 标 5 missing + 1 partial，但没区分"业主未答" vs "schema 未实装"；kimi 把"未冻结"和"未实装"放在一起看，可能让业主以为 RH3 工作量比实际更大。
3. **runtime trace 不深**：与 GLM 相比，kimi 没有 dive 到 `forwardServerFrameToClient` 不存在 / `emitServerFrame` only same-DO 这一层运行态事实；R7 提到 frame emit 状态模糊但停在 description level。
4. **缺 charter governance 维度**：RHX QNA 编号倒置（GPT R7）、charter §4.3 灰区 `GET /me/teams` 漏（GPT R3）—— kimi 9 条没覆盖。

### 7.3 Findings 质量清点

| 编号 | 原始严重 | 事后判定 | Finding 质量 | 分析 |
|------|---------|----------|--------------|------|
| R1 | critical | true-positive | excellent | 与 GLM R14 / deepseek R5 三方共识；kimi 是首个标 critical 的 reviewer，对业主严肃度传达起作用 |
| R2 | high | true-positive | excellent | RH0 §7.1 F3 据此重写为"首次声明"；4 reviewer 独家把"占位声明" vs "完全缺失"区分清楚 |
| R3 | high | **partial** | weak | kimi 部分判断有误（StepDecision 已含 hook_emit 变体）；scheduler 业务逻辑确实需扩，但不需扩 union；评估未采纳 kimi 关于 union 扩展的建议，仅采纳"业务逻辑改"部分 |
| R4 | medium | true-positive | excellent | RH3 §5.1 [S2] / §8.4 migration 009 schema 直接据此 |
| R5 | medium | true-positive | excellent | **4 reviewer 独家**；RH3 §5.1 [S3] / §8.4 加 `key_salt TEXT NOT NULL` 列直接据此 |
| R6 | high | true-positive | excellent | 与 GPT R5 / GLM R4 / deepseek H5-5 多方共识；RH5 [S0] schema 前置据此 |
| R7 | medium | true-positive | good | 描述级 finding；与 GLM R1 互补但深度低 |
| R8 | low | true-positive | good | RH2 §8.4 facade 路由层缺口表据此新增；severity 校准偏松（kimi 标 low，但漏掉 facade 路由会让 RH2 整 phase 失败，应至少 medium）|
| R9 | medium | true-positive | excellent | RH6 §6.2 + Phase 1 madge CI gate 据此；4 reviewer 独家把 import cycle 升为可自动化 enforce 项 |

### 7.4 多维度评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 证据链完整度 | 9 | grep -c / wc -l / DDL 反向校验扎实；偶尔 schema 反向引用偏少 |
| 判断严谨性 | 7 | 1/9 partial（R3 scheduler union）；其他 8 条都很稳 |
| 修法建议可执行性 | 10 | 4 reviewer 中"业主可读"度最高；几乎每条带具体 PR 步骤 |
| 对 action-plan / design / QNA 的忠实度 | 8 | charter §1.2 对账完整；RHX QNA 治理维度未覆盖 |
| 协作友好度 | 9 | 9 finding 数量适中；severity 显式分级 |
| 找到问题的覆盖面 | 8 | 横向覆盖 7 phase；R5/R9 独家；但 runtime 深度 trace 偏弱 |
| 严重级别 / verdict 校准 | 8 | R1 critical / R2 high 校准准确；R8 标 low 偏松；R3 标 high 偏严 |

**综合**：`8.5 / 10`。kimi 的"业主可执行性"和"severity 校准严格"是其他 3 reviewer 都比不上的；R5 和 R9 各是独家高价值发现。R3 的核查偏差被 deepseek R7 自动纠正，4 份合用时该偏差不会漏到 implementer。如果业主只读 1 份 review 给团队转发，kimi 是 4 份中可读性最高的一份。

