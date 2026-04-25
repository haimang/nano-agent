# Z3 代码审查报告

> 审查对象: `zero-to-real / Z3 / real-runtime-and-quota`
> 审查时间: `2026-04-25`
> 审查人: `Kimi (k2p6)`
> 审查范围:
> - `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`
> - `docs/issue/zero-to-real/Z3-closure.md`
> - `docs/design/zero-to-real/Z3-real-runtime-and-quota.md`
> - `docs/design/zero-to-real/ZX-qna.md` (Q8-Q9)
> - `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md`
> - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
> - `workers/agent-core/src/llm/adapters/workers-ai.ts`
> - `workers/agent-core/src/kernel/runner.ts`
> - `workers/agent-core/src/host/runtime-mainline.ts`
> - `workers/agent-core/src/host/quota/authorizer.ts`
> - `workers/agent-core/src/host/quota/repository.ts`
> - `workers/agent-core/src/host/do/nano-session-do.ts`
> - `workers/bash-core/src/worker-runtime.ts`
> - `workers/bash-core/src/executor.ts`
> - `workers/agent-core/wrangler.jsonc`
> - `workers/orchestrator-core/migrations/004-usage-and-quota.sql`
> - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`
> - `test/package-e2e/agent-core/*`
> - `test/package-e2e/bash-core/*`
> - `test/cross-e2e/*`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：Z3 的核心交付物（Workers AI adapter、quota dual gate、usage/balance D1 schema、runtime evidence path）已真实落地，preview live evidence 成立（36/36 + 12/12）。但存在 D1 事务缺失、activity_log schema 与 Q5 冲突、Z2 遗留 blocker 未修复等结构性问题，当前不应标记为 completed。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. **Quota repository 的 recordUsage 非原子**：INSERT usage event 与 UPDATE balance 不在同一事务中，失败时会产生 usage event 已记录但 balance 未更新的数据不一致。
  2. **Activity log schema 仍为 NOT NULL**：`quota/repository.ts` 的 `appendActivity` 向 `actor_user_uuid` 和 `conversation_uuid` 插入 `NULL`，但 `002-session-truth-and-audit.sql` 仍标记为 `NOT NULL`——这与 Q5 设计冲突，且会导致 quota evidence 写入失败或被静默吞掉。
  3. **Z2 核心 blocker 未在 Z3 修复**：`session-truth.ts` 的 D1 事务缺失（Z2 R1）和 activity_log schema 不一致（Z2 R2）在 Z3 中仍未解决，现在被 quota path 直接依赖。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-zero-to-real.md`（§7.4 Z3 收口标准）
  - `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`（Phase 1-5）
  - `docs/design/zero-to-real/Z3-real-runtime-and-quota.md`（F1-F4）
  - `docs/design/zero-to-real/ZX-qna.md`（Q8-Q9）
  - `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md`
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
  - `docs/issue/zero-to-real/Z3-closure.md`
  - `docs/code-review/zero-to-real/Z2-reviewed-by-kimi.md`（Z2 遗留问题追踪）
- **核查实现**：
  - `workers/agent-core/src/llm/adapters/workers-ai.ts`（318 行）
  - `workers/agent-core/src/kernel/runner.ts`（437 行）
  - `workers/agent-core/src/host/runtime-mainline.ts`（256 行）
  - `workers/agent-core/src/host/quota/authorizer.ts`（201 行）
  - `workers/agent-core/src/host/quota/repository.ts`（354 行）
  - `workers/agent-core/src/host/do/nano-session-do.ts`（1742 行，quota 接入片段）
  - `workers/bash-core/src/worker-runtime.ts`（257 行）
  - `workers/bash-core/src/executor.ts`（744 行）
  - `workers/agent-core/src/llm/gateway.ts`（15 行）
  - `workers/agent-core/wrangler.jsonc`（88 行）
  - `workers/orchestrator-core/migrations/004-usage-and-quota.sql`（33 行）
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`（97 行）
  - `test/package-e2e/agent-core/01-preview-probe.test.mjs`
  - `test/cross-e2e/02-agent-bash-tool-call-happy-path.test.mjs`
  - `test/cross-e2e/09-capability-error-envelope-through-agent.test.mjs`
- **参考代码**：
  - `context/ddl-v170/smind-09-tenant-billing-quota-usage.sql`
  - `context/smind-admin/src/modules/identity/auth.service.ts`
- **执行过的验证**：
  - 逐行阅读所有上述文件
  - 对照 QNA Q8-Q9 逐项验证实现
  - 对照 action-plan Phase 1-5 逐项验证 scope
  - 对照 Z3 design doc F1-F4 判定标准验证
  - 追踪 Z2 审查发现项的修复状态
  - 验证 preview live evidence（36/36 + 12/12）

### 1.1 已确认的正面事实

- **Workers AI Mainline**：
  - `workers-ai.ts` 实现了完整的 adapter：primary model (`@cf/ibm-granite/granite-4.0-h-micro`) + fallback model (`@cf/meta/llama-4-scout-17b-16e-instruct`)、SSE stream parsing、tool call normalization、usage extraction
  - `wrangler.jsonc` 已接入 `AI` binding、`NANO_AGENT_DB`、quota limit vars
  - `runtime-mainline.ts` 的 `createMainlineKernelRunner` 整合了 Workers AI + quota + capability transport
- **Quota Dual Gate**：
  - `QuotaAuthorizer` 实现了 `authorize`（pre-gate）和 `commit`（post-usage）方法，覆盖 llm 和 tool
  - `kernel/runner.ts` 已接入 `beforeLlmInvoke` / `afterLlmInvoke` hooks
  - `bash-core/src/worker-runtime.ts` 实现了 quota ticket second gate（`pendingQuotaAuthorizations` Map），校验 verdict/quota_kind/request_id/tool_name 四字段
  - `executor.ts` 的 `beforeCapabilityExecute` hook 已消费 quota ticket
- **D1 Usage/Balance**：
  - `004-usage-and-quota.sql` 已创建 `nano_quota_balances`（PK: team_uuid + quota_kind）和 `nano_usage_events`（含 idempotency_key UNIQUE 约束）
  - `D1QuotaRepository` 实现了 `ensureBalance`（幂等 seed）、`setBalance`（UPSERT）、`recordUsage`（idempotent INSERT + conditional UPDATE）
  - `recordUsage` 使用 `${quotaKind}:${verdict}:${requestId}` 作为 idempotency key，防止重复记账
- **Runtime Evidence**：
  - `QuotaAuthorizer.authorize` 在 deny 时写入 `quota.deny` activity + trace event
  - `QuotaAuthorizer.commit` 在 allow 时写入 `runtime.llm.invoke` / `runtime.tool.invoke` activity + trace event
  - `repository.ts` 的 `appendActivity` 使用 `INSERT ... SELECT COALESCE(MAX(event_seq), 0) + 1` 修复了 Z2 的并发 seq 问题
  - `serializeActivityPayload` 实现了 payload 大小限制（8KB）和 redaction
- **Preview 验证**：
  - `pnpm test:package-e2e` → 36/36 pass
  - `pnpm test:cross-e2e` → 12/12 pass
  - Preview D1 已 remote apply Wave C migration
  - 三个 worker 已 preview deploy

### 1.2 已确认的负面事实

- `recordUsage` 的 INSERT usage event 与 UPDATE balance 不在同一事务中
- `002-session-truth-and-audit.sql` 的 `actor_user_uuid` 和 `conversation_uuid` 仍为 `NOT NULL`，但 `quota/repository.ts` 的 `appendActivity` 插入 `NULL`
- `session-truth.ts` 的 D1 写操作仍无事务保护（Z2 R1 未修复）
- `runtime-mainline.ts` 的 `beforeLlmInvoke` 在 `llmRequestIds.set` 后调用 `authorize`，如果 `authorize` 失败则 entry 泄漏
- Q8 要求的 DeepSeek skeleton 目录（`workers/agent-core/src/llm/adapters/deepseek/`）未创建
- `ensureTeamSeed` 创建 synthetic user 时缺少 `nano_user_identities` 记录
- `nano_usage_events.quantity` 固定为 1（call count），不记录实际 token usage
- `gateway.ts` 仍是 stub interface，未被替代

---

## 2. 审查发现

### R1. recordUsage 的 INSERT + UPDATE 非原子

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `repository.ts:192-216`：先 `INSERT OR IGNORE INTO nano_usage_events`
  - `repository.ts:218-234`：判断 `inserted` 后，再 `UPDATE nano_quota_balances SET remaining = ...`
  - 两个操作之间没有任何事务包裹
  - `recordUsage` 的调用方（`authorizer.ts` 的 `authorize` 和 `commit`）没有 retry 逻辑
- **为什么重要**：
  - 如果 INSERT 成功但 UPDATE 失败（如 D1 连接中断、并发冲突），会产生 usage event 已记录但 balance 未更新的不一致状态
  - 这意味着用户被计费（usage event 存在）但余额未扣减，导致 quota 控制失效
  - 更严重的是：idempotency key 已使用，重试时 `INSERT OR IGNORE` 会跳过（因为 key 已存在），但 balance 仍不会被更新
  - 这是 Z3 "quota 成为 runtime truth" 核心目标的 correctness gap
- **审查判断**：
  - 代码在单线程/低并发下工作，但在 Cloudflare D1 的分布式环境中存在数据一致性风险
  - `INSERT OR IGNORE` + 后续 UPDATE 的模式在没有事务保护时不具备原子性
- **建议修法**：
  - 方案 A：使用 `BEGIN IMMEDIATE` 事务包裹 `INSERT` + `UPDATE`
  - 方案 B：将 UPDATE 改为 `INSERT OR REPLACE` 的 UPSERT 模式（但无法关联到 usage event 的插入状态）
  - 方案 C（推荐）：在 `recordUsage` 开始时 `BEGIN IMMEDIATE`，在方法结束时 `COMMIT`；任何异常时 `ROLLBACK`
  - 同时需要在 `authorizer.ts` 的调用方添加事务失败时的 graceful degradation（如记录 warning 但不阻塞 runtime）

### R2. activity_log schema 与 Q5 设计仍不一致

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - Q5（`ZX-qna.md:153-167`）明确设计：`actor_user_uuid TEXT (nullable, 系统事件可为空)`、`conversation_uuid TEXT (nullable)`
  - `002-session-truth-and-audit.sql:72-73`：`actor_user_uuid TEXT NOT NULL`、`conversation_uuid TEXT NOT NULL`
  - `quota/repository.ts:293-294` 的 `appendActivity` SQL：`SELECT ?1, ?2, NULL, NULL, ?3, ...` —— 向 NOT NULL 列插入 `NULL`
  - `runner.ts:243-256`：如果 `afterLlmInvoke` 失败（如 `appendActivity` 抛 NOT NULL 约束错误），会捕获并转为 `system.notify` + `complete_turn`
- **为什么重要**：
  - 如果 schema 保持 NOT NULL，`appendActivity` 会抛出 `NOT NULL constraint failed` 错误
  - 这个错误会被 `runner.ts` 的 `afterLlmInvoke` catch 块捕获，导致 LLM 调用被标记为 `llm-postprocess-failed`
  - 但这不是 LLM 的问题，而是 quota evidence 写入的问题——系统会错误地归因于 LLM 失败
  - 更严重的是：`commit` 路径中 `recordUsage` 已执行（INSERT usage event + UPDATE balance），但 `appendActivity` 失败会导致 `commit` 整体失败，而 usage/balance 已变更——这是一种 silent inconsistency
  - Z2 审查 R2 已指出此问题，Z3 中仍未修复，且现在被 quota evidence 路径直接依赖
- **审查判断**：
  - 这是一个跨阶段未修复的 blocker
  - Preview E2E 全绿（36/36 + 12/12）**不能**证明此问题不存在，因为 E2E 不验证 D1 中 activity log 的内容
  - 如果 preview 环境中 schema 已被手动修改（允许 NULL），则 migration 文件与 runtime schema 已漂移
- **建议修法**：
  - 立即修改 `002-session-truth-and-audit.sql`，将 `actor_user_uuid` 和 `conversation_uuid` 的 `NOT NULL` 移除
  - 如果 preview D1 已手动修改，需要重新 apply migration 或使用 ALTER TABLE
  - 添加 E2E 断言：验证 `nano_session_activity_logs` 中 quota event 的写入成功

### R3. Z2 遗留的 D1 事务缺失未修复

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - Z2 审查 R1 指出：`session-truth.ts` 的 `beginSession`（5 步操作）、`createTurn`（3 步操作）未使用事务
  - Z3 代码中 `session-truth.ts` 仍未添加事务保护
  - Z3 新增 `quota/repository.ts`，同样缺乏事务
- **为什么重要**：
  - 这是跨阶段的技术债务，直接影响 Z3 的 quota correctness
  - 如果 `beginSession` 在 INSERT conversation 后、INSERT session 前失败，会产生孤儿 conversation——这个 conversation 之后可能被 quota 系统误认为是有效 session 的上下文
  - `recordUsage` 的非原子性（R1）是同一类问题的 Z3 实例
- **审查判断**：
  - Z2 审查明确要求 "在 `D1SessionTruthRepository` 中添加 `withTransaction` 辅助方法"
  - Z3 未响应此要求，且新增代码重复了同样的问题
- **建议修法**：
  - 在 `D1SessionTruthRepository` 中添加 `withTransaction`（参考 Z1 auth worker 的 `repository.ts:147-157`）
  - 在 `D1QuotaRepository` 中添加相同的事务辅助方法
  - 将所有多步 D1 操作包裹在事务中

### R4. beforeLlmInvoke 的内存泄漏

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `runtime-mainline.ts:234-240`：
    ```typescript
    beforeLlmInvoke: async ({ turnId }) => {
      const context = options.contextProvider();
      if (!options.quotaAuthorizer || !context) return;
      const requestId = `llm-${turnId}-${crypto.randomUUID()}`;
      llmRequestIds.set(turnId, requestId);  // ← set 在 authorize 之前
      await options.quotaAuthorizer.authorize("llm", context, requestId, {});
    },
    ```
  - 如果 `authorize` 抛出 `QuotaExceededError`，`llmRequestIds` 中的 entry 不会被删除
  - `afterLlmInvoke`（`runtime-mainline.ts:241-251`）只在成功路径中 `delete` entry
- **为什么重要**：
  - 在 long-running session 中，如果用户多次触发 quota exceed（如余额不足时反复尝试），`llmRequestIds` Map 会无限增长
  - 虽然 Map 的 key 是 `turnId`（同一个 turn 的多次调用会覆盖），但如果 turn 数量很多（如数百个 turns），Map 仍可能积累大量 entry
  - 更关键的是：如果 `beforeLlmInvoke` 失败，对应的 requestId 已生成但不会被使用——这是无意义的内存占用
- **审查判断**：
  - 这是一个明确的 cleanup gap
  - 当前实现中 `llmRequestIds` 是 module-level Map，DO 实例生命周期内不会自动 GC
- **建议修法**：
  - 将 `llmRequestIds.set` 移动到 `authorize` 成功之后：
    ```typescript
    beforeLlmInvoke: async ({ turnId }) => {
      const context = options.contextProvider();
      if (!options.quotaAuthorizer || !context) return;
      const requestId = `llm-${turnId}-${crypto.randomUUID()}`;
      await options.quotaAuthorizer.authorize("llm", context, requestId, {});
      llmRequestIds.set(turnId, requestId);
    },
    ```
  - 或在 catch 块中添加 cleanup：
    ```typescript
    try {
      await options.quotaAuthorizer.authorize(...);
    } catch {
      llmRequestIds.delete(turnId);
      throw;
    }
    ```

### R5. DeepSeek skeleton 未创建

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - Q8（`ZX-qna.md:264-267`）明确要求："建 `workers/agent-core/src/llm/adapters/deepseek/` 目录，仅含 adapter shape interface 与一个 throw-not-implemented 函数"
  - 当前 deepseek 目录不存在（`ls` 验证失败）
  - `gateway.ts` 仍是 15 行的 stub interface，未被 DeepSeek skeleton 替代
- **为什么重要**：
  - Q8 是 owner 已冻结的答案，Z3 action-plan 明确将其列为 in-scope
  - 如果不创建 skeleton，future BYO-key 接入时需要重构 boundary，增加后续工作量
  - 更关键的是：`gateway.ts` 的注释 "Stub interface only — not implemented in v1" 暗示它会在 Z3 被替代
- **审查判断**：
  - 这是一个明确的 delivery gap
  - 虽然不影响当前 Workers AI mainline，但违背了 Q8 的冻结答案
- **建议修法**：
  - 创建 `workers/agent-core/src/llm/adapters/deepseek/index.ts`
  - 定义 adapter shape interface（`DeepSeekAdapter`）
  - 实现 `throwNotImplemented()` 函数
  - 更新 `gateway.ts` 的注释，说明其角色已被 DeepSeek skeleton 替代

### R6. ensureTeamSeed 创建不完整 synthetic identity

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `repository.ts:71-94` 的 `ensureTeamSeed`：
    - INSERT `nano_users`（含 `user_status`、`default_team_uuid`、`is_email_verified`）
    - INSERT `nano_teams`（含 `owner_user_uuid`）
    - **没有 INSERT `nano_user_identities`**
  - `nano_user_identities` 有 `FOREIGN KEY (user_uuid) REFERENCES nano_users(user_uuid)`
  - `nano_teams` 的 `owner_user_uuid` 被设为 `teamUuid`（即 owner_user_uuid == team_uuid）
- **为什么重要**：
  - 如果后续代码（如 auth service、admin query）尝试从 `nano_user_identities` 查找这个 synthetic user 的 identity，会找不到记录
  - `owner_user_uuid = teamUuid` 违反了身份隔离原则：user UUID 和 team UUID 应该是不同的命名空间
  - Z3 closure 的 residual 3 承认这是 "preview posture 的权宜之计"，但未说明这是已知限制
- **审查判断**：
  - 这是 preview 环境的权宜之计，但代码中缺少注释说明这是 temporary
  - 更完整的方式是：在 `ensureTeamSeed` 中同时 INSERT `nano_user_identities`，使用 `identity_provider = 'internal'` 和 `provider_subject = teamUuid`
- **建议修法**：
  - 在 `ensureTeamSeed` 中添加 `nano_user_identities` 的 INSERT
  - 或在方法顶部添加 TODO 注释："synthetic owner user 缺少 identity 记录，需在后续 identity/runtime 统一时修复"
  - 考虑使用独立的 synthetic user UUID（如 `uuid_v5(teamUuid, 'synthetic-owner')`），而不是直接使用 teamUuid

### R7. usage event 不记录实际 token 消耗

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `runtime-mainline.ts:247-250` 的 `afterLlmInvoke` 传入 `input_tokens` 和 `output_tokens`
  - 但 `authorizer.ts:123-134` 的 `commit` 调用 `recordUsage` 时：`quantity: 1, unit: "call"`
  - `nano_usage_events` 表有 `quantity` 和 `unit` 字段，但 design doc F3 的判定方法说 "allow/deny fixtures 都会写入 `nano_usage_events`，并带 `idempotency_key` 防重复记账"
  - `quantity` 固定为 1，不反映实际的 input/output tokens
- **为什么重要**：
  - Q9（`ZX-qna.md:291-296`）要求 deny 的 payload 含 "deny reason + remaining balance + requested cost"
  - 当前 "requested cost" 被简化为 `quantity=1`，不是真实的 token cost
  - 这意味着 quota 是按 call count 限制，而不是按 token 数限制——这与真实的 LLM 计费模型不符
  - 如果用户发起一个消耗 10K tokens 的调用，和另一个消耗 100 tokens 的调用，quota 扣除相同（都是 1 call）
- **审查判断**：
  - 当前实现符合 Z3 的 "minimal runtime truth" 定位（call-level gating）
  - 但 action-plan 的 Phase 4 收口标准说 "accepted path 带 usage delta 与余额写回"，"usage delta" 应指真实的资源消耗
  - 建议在 `nano_usage_events` 中增加 `input_tokens` 和 `output_tokens` 字段，或把 `quantity` 改为 token 总数
- **建议修法**：
  - 方案 A：修改 `nano_usage_events` schema，增加 `input_tokens INTEGER` 和 `output_tokens INTEGER` 字段
  - 方案 B：在 `commit` 时计算 `quantity = input_tokens + output_tokens`，`unit = "token"`
  - 方案 C（推荐）：保留当前 call-level 记录，但增加 token-level 字段作为扩展；不改现有 quota 逻辑，但为后续 billing 留下数据

### R8. Z3 closure 的 known limitations 不完整

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `Z3-closure.md:89-95` 记录了 4 条 residuals：
    1. auth bootstrap team UUID 随机 vs deploy tenant 固定
    2. quota activity 只落到 session scope，缺少 durable turn mapping
    3. quota repo 的 synthetic owner user + team
    4. billing/admin/product surfaces out-of-scope
  - 但未记录：
    - D1 事务缺失（R1、R3）
    - activity_log schema 与 Q5 不一致（R2）
    - DeepSeek skeleton 未创建（R5）
    - usage event 不记录 token 消耗（R7）
    - `beforeLlmInvoke` 内存泄漏（R4）
- **为什么重要**：
  - Z3 closure 是 Z4 的输入文档，如果已知限制不完整，Z4 可能重复踩坑
  - 特别是 D1 事务缺失和 schema 不一致，会直接影响 Z4 的 client 体验和 billing 准确性
- **审查判断**：
  - 当前 closure 的 residuals 偏乐观，未完整反映代码审查发现的结构性问题
- **建议修法**：
  - 在 `Z3-closure.md` 的 "仍需诚实记录的 residuals" 中补充上述 5 项
  - 对每项标注严重级别和对 Z4 的潜在影响

---

## 3. In-Scope 逐项对齐审核

### Z3 Action-Plan Phase 1-5

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| P1-01 | AI binding freeze | `done` | `AI` binding、`NANO_AGENT_DB`、quota limit vars 已接入 wrangler.jsonc；Workers AI adapter 已实现 |
| P2-01 | real llm execution path | `done` | `KernelRunner` 真实走 Workers AI；fake provider 已退役；`gateway.ts` 仍为 stub 但不被主路径使用 |
| P2-02 | session stream/runtime mapping | `done` | LLM events 映射到 session stream；timeline/history 可读 |
| P3-01 | quota authorizer | `partial` | `QuotaAuthorizer` 已实现 authorize/commit，但 **recordUsage 非原子**（R1）；**activity log schema 与 Q5 冲突**（R2） |
| P3-02 | bash-core gate integration | `done` | `worker-runtime.ts` 的 second gate 已验证 verdict/quota_kind/request_id/tool_name 四字段 |
| P4-01 | usage/quota migrations | `done` | `004-usage-and-quota.sql` 已创建；preview D1 已 apply；idempotency key 约束已落实 |
| P4-02 | audit/eval evidence | `partial` | deny/allow 都写入 activity + trace，但 **activity 写入可能因 schema 冲突失败**（R2）；**不记录 token 消耗**（R7） |
| P5-01 | runtime/quota tests | `partial` | 36/36 + 12/12 全绿，但 **缺少 quota negative 的 D1 row 断言**；**缺少 redaction 验证** |
| P5-02 | Z3 closure 文档 | `partial` | 文档存在，但 **known limitations 不完整**（R8） |

### Z3 Design Doc F1-F4

| 编号 | 功能项 | 审查结论 | 说明 |
|------|--------|----------|------|
| F1 | Workers AI Mainline | `done` | adapter 完整，primary+fallback model，SSE parsing，tool normalization |
| F2 | Runtime Quota Gate | `partial` | dual gate 已落地，但 **D1 写入非原子**（R1）；**activity schema 冲突**（R2） |
| F3 | Usage/Balance Persistence | `partial` | 表已建，idempotency 已落实，但 **不记录 token 消耗**（R7）；**balance UPDATE 非原子**（R1） |
| F4 | Runtime Evidence | `partial` | trace/audit 路径已建立，但 **activity 写入可靠性受 schema 冲突影响**（R2） |

### 3.1 对齐结论

- **done**: 4（P1-01、P2-01、P2-02、P3-02）
- **partial**: 5（P3-01、P4-02、P5-01、P5-02 + F2-F4）
- **missing**: 1（P5-05 DeepSeek skeleton — Q8 要求但未实现）

> Z3 的核心交付物已真实落地，Workers AI adapter 和 quota gate 已工作，preview live evidence 成立。但 D1 事务缺失、activity_log schema 冲突、Z2 遗留 blocker 未修复等问题表明，它更像 "runtime 骨架完成，但 durable correctness 仍未收口" 的状态，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 多 provider GA 与复杂路由 | `遵守` | 仅 Workers AI 是 mainline，DeepSeek 是 skeleton（但 skeleton 未创建） |
| O2 | 细粒度 billing/statement/finance admin UI | `遵守` | 仅最小 usage/balance 表 |
| O3 | 完整 browser-rendering productization | `遵守` | 未涉及 |
| O4 | 大规模 client hardening 与产品包装 | `遵守` | Z4 负责 |
| O5 | `nano_tenant_secrets` 表 | `遵守` | 明确未建表，符合 Q8 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：Z3 的 runtime mainline、quota dual gate、usage D1 schema 已真实落地，具备继续推进 Z4 的条件，但存在 3 个 high 级别 blocker 必须在 Z4 启动前修复或明确记录。
- **是否允许关闭本轮 review**：`no`（需修复 R1、R2、R3 后重新审查）
- **关闭前必须完成的 blocker**：
  1. **R1**: 为 `D1QuotaRepository.recordUsage` 添加 SQLite 事务保护，确保 INSERT usage event 与 UPDATE balance 原子性
  2. **R2**: 修正 `002-session-truth-and-audit.sql`，使 `actor_user_uuid` 和 `conversation_uuid` 与 Q5 设计一致（允许 nullable），并验证 preview D1 schema 同步
  3. **R3**: 修复 Z2 遗留的 `session-truth.ts` 事务缺失问题，或至少为 `D1SessionTruthRepository` 和 `D1QuotaRepository` 统一添加事务辅助方法
- **可以后续跟进的 non-blocking follow-up**：
  1. **R4**: 修复 `beforeLlmInvoke` 的内存泄漏（medium）
  2. **R5**: 创建 DeepSeek skeleton 目录（medium）
  3. **R6**: 完善 `ensureTeamSeed` 的 synthetic identity（medium）
  4. **R7**: 在 usage event 中记录 token 消耗（medium）
  5. **R8**: 补充 Z3 closure 的 known limitations（medium）

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者响应模板

> 实现者应按以下格式回应每条 R1-R8：

```markdown
### 对 R{X} 的响应

- **状态**：`已修复 | 计划修复 | 不接受`
- **修复位置**：`file.ts:line`
- **修复说明**：...
- **验证方式**：...
```

---

## 7. 跨阶段深度分析（Z0-Z3 对 Z4-Z5 的影响）

### 7.1 Z3 对 Z4 的直接约束

1. **D1 事务缺失将放大 Z4 的 client 体验风险**：
   - Z4 的 Web/Mini Program 真实 loop 会在高频场景下触发大量 quota check 和 usage write
   - 如果 `recordUsage` 非原子，高并发时可能出现 balance 不一致，导致用户看到 "余额充足但被拒绝" 或 "余额不足但已扣费" 的混乱体验
   - **建议**：Z4 开始前必须先修复 R1

2. **Activity log schema 冲突将阻断 audit 链路**：
   - Z4 的 client 需要读取 runtime evidence（如 quota deny reason）
   - 如果 `appendActivity` 因 schema 冲突失败，client 看到的 error 是 `llm-postprocess-failed` 而不是 `QUOTA_EXCEEDED`
   - **建议**：Z4 开始前必须先修复 R2

3. **Token-level usage 缺失将影响 Z4 的 billing hint**：
   - Z4 的 client 可能需要显示 "已使用 X tokens" 或 "剩余 Y tokens"
   - 当前 usage event 只记录 call count，无法提供 token-level 反馈
   - **建议**：在 Z4 中增加 token-level 字段（R7）

### 7.2 Z3 对 Z5（Final Closure）的间接约束

1. **Quota evidence 的完整性是 final closure 的核心证据**：
   - zero-to-real final closure 需要证明 "real runtime + quota + audit" 闭环
   - 如果 D1 事务缺失和 schema 冲突未修复，final closure 的 audit 证据不可信
   - **建议**：在 Z5 前完成所有 quota D1 的正确性修复

2. **DeepSeek skeleton 的位置将影响 handoff**：
   - `docs/handoff/zero-to-real-to-next-phase.md` 需要说明 provider 扩展路径
   - 如果没有 DeepSeek skeleton，handoff 文档需要额外说明 "provider adapter boundary 尚未建立"
   - **建议**：在 Z4 或 Z5 前创建 DeepSeek skeleton（R5）

### 7.3 命名规范跨包一致性检查

| 概念 | Z3 命名 | Z2 命名 | ddl-v170 命名 | 建议 |
|------|---------|---------|---------------|------|
| 配额类型 | `quota_kind` (`llm`/`tool`) | — | — | 与 Q9 一致，保持 |
| 使用事件 | `nano_usage_events` | — | — | 与 design doc 一致，保持 |
| 余额表 | `nano_quota_balances` | — | — | 与 design doc 一致，保持 |
| 裁决 | `verdict` (`allow`/`deny`) | — | — | 清晰，保持 |
| 资源类型 | `resource_kind` | — | — | 与 `quota_kind` 同义，建议统一为 `quota_kind` |
| 数量 | `quantity` + `unit` | — | — | 当前 `quantity=1, unit="call"`，建议未来增加 `input_tokens`/`output_tokens` |
| 幂等键 | `idempotency_key` | — | — | 标准命名，保持 |

### 7.4 安全边界跨阶段一致性

1. **Quota gate 的 tenant 边界**：
   - Z3 的 `QuotaAuthorizer` 使用 `teamUuid` 作为 balance 的 partition key
   - `ensureTeamSeed` 在缺失 team 时创建 synthetic team——这在 preview 单租户场景下工作，但 multi-tenant 场景下可能导致不同 tenant 共享同一个 seed
   - **建议**：在 Z4 的 multi-tenant negative tests 中验证 quota isolation

2. **LLM + tool 双 gate 的一致性**：
   - Z3 已实现 dual gate，但 tool gate 的 second-gate（bash-core）和 llm gate（agent-core）使用不同的 error 传播路径
   - llm gate 的 `QuotaExceededError` 会被 `runner.ts` 捕获并转为 `system.notify`
   - tool gate 的 `QuotaExceededError` 会被 `runtime-mainline.ts` 捕获并转为 `result` error
   - 两者最终都到达 client，但 envelope shape 不同——Z4 需要统一处理

3. **Usage event 的防 replay**：
   - Z3 的 `idempotency_key` 使用 `${quotaKind}:${verdict}:${requestId}`
   - 如果同一个 requestId 被重放（如 client retry），`INSERT OR IGNORE` 会跳过
   - 但 `recordUsage` 的 `inserted` 判断基于 `insert.meta.changes`，如果跳过则 `inserted=false`，不会触发 balance UPDATE
   - 这是正确的幂等行为，但需要文档说明

---

## 8. 审查纪律声明

- 本审查完全基于 Kimi (k2p6) 的独立 reasoning，未参考其他同事（Deepseek、Opus、GPT）的分析报告。
- 所有发现均有文件路径和行号支撑。
- 审查结论基于 Z3 action-plan、Z3 design doc、ZX-qna Q8-Q9、以及实际代码事实的多方对照。
- 跨阶段分析（§7）基于 charter 的 Z4-Z5 设计文档和当前 Z3 实现的接口契约。
- Z2 审查发现项的修复状态已独立验证。

---

(End of review)

## 9. 对 Kimi 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-25`
> 评价依据: `docs/code-review/zero-to-real/Z3-reviewed-by-kimi.md §0–§8`

### 9.1 一句话评价评审风格
Kimi 的审查风格偏 **快速 correctness 扫描**，能抓到几个真问题，但对当前仓库的**已生效 schema truth 和 D1 语义**掌握不够稳，导致误报比例偏高。

### 9.2 优点
1. **能迅速命中最危险的局部 correctness 问题**：`recordUsage` 非原子、`beforeLlmInvoke` leak、DeepSeek skeleton 缺失，这几条都是真问题。
2. **会追 Z2 carry-over**：不是把 Z3 当孤立工作，而是尝试检查前一阶段遗留债务是否真的被吸收。
3. **对 closure 完整性有敏感度**：已知限制写不全、evidence 过度乐观，这类文档问题也被纳入判断。

### 9.3 缺点
1. **对当前有效 schema 的把握明显不足**：R2 基于 `002` 而忽略已存在的 `003`，属于关键前提没核准就下结论。
2. **部分事务建议不够贴近 Cloudflare D1 实情**：把 `BEGIN/COMMIT` 当成默认推荐路径，忽略了本仓库已有 `db.batch()` 可用语义。
3. **作用域有时放得过大**：像 token-level usage、session-truth 全量事务化，都是有讨论价值的 follow-up，但被写成了比实际更硬的 blocker。

### 9.4 对审查报告中，全部问题，的清点

| 问题编号 | 原始严重程度 | 该问题的质量 | 分析与说明 |
|----|------|------|------------------|
| R1 | `high` | `高` | `recordUsage` 非原子是真问题，直接推动了本轮 `db.batch()` 修复。 |
| R2 | `high` | `低` | 结论依赖对 `002` 的静态阅读，但忽略了已存在的 `003-session-truth-hardening.sql`；属于前提失真导致的误报。 |
| R3 | `high` | `低` | “Z2 遗留 D1 事务缺失未修复” 里把 `session-truth.ts` 一概判成未修，忽略了关键路径已使用 `db.batch()` 的事实，判断过重。 |
| R4 | `medium` | `高` | `beforeLlmInvoke` 先 `set` 后 `authorize` 的 leak 判断准确，也确实被本轮修复。 |
| R5 | `medium` | `高` | DeepSeek skeleton 缺失判断准确，且修复成本/收益比很高。 |
| R6 | `medium` | `中` | synthetic identity 不完整这条有价值，但更本质的问题是 write ownership 和 preview-only gate；它触及了问题，但没打到最核心层。 |
| R7 | `medium` | `中低` | “usage event 不记录 token 消耗” 更像设计 tradeoff，而不是 Z3 当前错误；可以提，但不宜抬太高。 |
| R8 | `medium` | `高` | 认为 closure 的 known limitations 不完整，这条是成立的，后来也被补写。 |

### 9.5 评分 - 总体 ** 6.3 / 10 **

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 6 | 有证据，但几条关键判断建立在未校准的 schema 前提上。 |
| 判断严谨性 | 5 | 真问题和误报并存，且误报集中在高严重度项。 |
| 修法建议可执行性 | 6 | 部分建议可落地，部分过于理想化或不贴 D1 语义。 |
| 对 action-plan / design 的忠实度 | 7 | 有持续对照 plan/design，但对实际生效 schema truth 校准不足。 |
| 协作友好度 | 7 | 语气可合作，表达清楚。 |
| 找到问题的覆盖面 | 7 | correctness、docs、carry-over 都覆盖到了。 |
