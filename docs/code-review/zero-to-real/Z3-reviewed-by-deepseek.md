# Nano-Agent 代码审查模板

> 审查对象: `zero-to-real / Z3 Real Runtime and Quota`
> 审查时间: `2026-04-25`
> 审查人: `deepseek`
> 审查范围:
> - `workers/agent-core/wrangler.jsonc`
> - `workers/agent-core/src/host/runtime-mainline.ts`
> - `workers/agent-core/src/host/quota/authorizer.ts`
> - `workers/agent-core/src/host/quota/repository.ts`
> - `workers/agent-core/src/host/do/nano-session-do.ts`
> - `workers/agent-core/src/kernel/runner.ts`
> - `workers/agent-core/src/llm/adapters/workers-ai.ts`
> - `workers/bash-core/src/worker-runtime.ts`
> - `workers/orchestrator-core/migrations/004-usage-and-quota.sql`
> - `workers/orchestrator-core/migrations/003-session-truth-hardening.sql`
> - `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`
> - `docs/issue/zero-to-real/Z3-closure.md`
> - `docs/design/zero-to-real/Z3-real-runtime-and-quota.md`
> - `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md`
> - `docs/design/zero-to-real/ZX-qna.md`
> - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
> - `docs/charter/plan-zero-to-real.md`
> - `docs/code-review/zero-to-real/Z2-reviewed-by-deepseek.md`
> - `docs/issue/zero-to-real/Z2-closure.md`
> - `context/ddl-v170/smind-01-tenant-identity.sql`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`Z3 的 Workers AI mainline、quota dual gate、durable usage/balance 三层主体全部落地且正确，但存在两个关键缺失——(1) 003 schema hardening 迁移作为修复 Z2 review 6+ 项发现的重磅迁移完全未被任何 action-plan 或 closure 追踪；(2) quota exhausted/quota recover 的测试在代码中完全不存在，违反了 action-plan P5-01 的收口标准。Z3 的 closure 不应在缺失这些证明的情况下声称已满足全部 exit criteria。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `003-session-truth-hardening.sql 是一座"幽灵迁移"——它做了 6 项 Z2 review finding 的修复（Q5 nullable 收口、8KB CHECK 约束、全表 FOREIGN KEY、新索引、审计视图），但未被 Z3 action-plan 的 "Phase 4 — P4-01" 或任何 closure 章节提及。这在工程追溯性上是严重缺失。`
  2. `action-plan P5-01 要求 "覆盖 real llm run、tool happy path、quota exhausted、quota recover 等场景"，但实际测试目录中完全不存在任何 quota 相关测试（agent-core test、bash-core test、test/package-e2e、test/cross-e2e 均无 quota 匹配）。Z3 closure 声称的 "quota exhausted / recover" 证据未在测试层面体现。`
  3. `D1QuotaRepository.ensureTeamSeed() 在缺失 deploy team row 时自动创建 synthetic user（user_uuid == team_uuid，is_email_verified=1，plan_level=0），这是一个绕过 auth 系统的架构 hack——它使 D1 quota 写入在单租户 preview 下可工作，但会沉默地创建不真实的 identity 行，且行为不可关闭。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`（Z3 action-plan）
  - `docs/design/zero-to-real/Z3-real-runtime-and-quota.md`（Z3 design doc）
  - `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md`（cross-cutting LLM design）
  - `docs/design/zero-to-real/ZX-qna.md` 中 Q8/Q9（owner 冻结的 provider/quota 决策）
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`（D1 schema write ownership）
  - `docs/charter/plan-zero-to-real.md`（zero-to-real charter）
  - `docs/code-review/zero-to-real/Z2-reviewed-by-deepseek.md`（Z2 review 发现）
  - `docs/issue/zero-to-real/Z2-closure.md` / `Z3-closure.md`

- **核查实现**：
  - `workers/orchestrator-core/migrations/004-usage-and-quota.sql`（33 行，quota tables）
  - `workers/orchestrator-core/migrations/003-session-truth-hardening.sql`（297 行，Wave B rebuild + FK + 8KB constraint + view）
  - `workers/agent-core/src/host/runtime-mainline.ts`（256 行，Workers AI + quota + capability 统一 assembler）
  - `workers/agent-core/src/host/quota/authorizer.ts`（201 行，QuotaAuthorizer 类）
  - `workers/agent-core/src/host/quota/repository.ts`（354 行，D1QuotaRepository）
  - `workers/agent-core/src/host/do/nano-session-do.ts`（1742 行，`buildQuotaAuthorizer()`/`createLiveKernelRunner()` 等新增方法）
  - `workers/agent-core/src/kernel/runner.ts:31-42,149-259`（`KernelRunnerHooks` 接口 + `handleLlmCall` 中的 beforeLlmInvoke/afterLlmInvoke）
  - `workers/agent-core/src/llm/adapters/workers-ai.ts`（318 行，Workers AI adapter）
  - `workers/agent-core/wrangler.jsonc`（88 行，新增 AI/NANO_AGENT_DB/quota limit vars）
  - `workers/bash-core/src/worker-runtime.ts`（257 行，quota ticket second gate）
  - `test/package-e2e/**` / `test/cross-e2e/**`（无 quota 相关测试）

- **执行过的验证**：
  - 逐字段对比 `004-usage-and-quota.sql` 与 `ZX-d1-schema-and-migrations.md` §7.3.1 冻结字段
  - 逐字段对比 `003-session-truth-hardening.sql` 新 schema 与 Z2 review 发现 R2/R5/R7/R9/R10/R11 的修法建议
  - 核对了 `QuotaAuthorizer.authorize()`/`commit()` 的 LLM + tool 双 gate 路径
  - 核对了 `QuotaExceededError` 的 typed surface（`code='QUOTA_EXCEEDED'`）
  - 核对了 `beforeLlmInvoke`/`afterLlmInvoke` hooks 在 `KernelRunner.handleLlmCall()` 中的调用位
  - 核对了 bash-core `beforeCapabilityExecute` 中的 quota ticket 4 项校验（verdict / quota_kind / request_id / tool_name）
  - 核查了全项目 quota 相关测试的存在性
  - 对比了 Z3 action-plan §9 的工作日志与实际文件变更

### 1.1 已确认的正面事实

- `workers/agent-core/wrangler.jsonc` 已新增 `AI` binding（§52-54）、`NANO_AGENT_DB` binding（§45-51）、`NANO_AGENT_LLM_CALL_LIMIT=200`（§16）、`NANO_AGENT_TOOL_CALL_LIMIT=400`（§17）——至此 agent-core 首次拥有 D1 写入能力（解决了 Z2 review R1/R12 中 agent-core 无 D1 binding 的阻塞）
- `workers/agent-core/src/llm/adapters/workers-ai.ts` 完整实现：primary model `@cf/ibm-granite/granite-4.0-h-micro` + fallback `@cf/meta/llama-4-scout-17b-16e-instruct`（Q8 冻结的 escalation path）、SSE 流解析、tool_call → `LlmChunk` 归一化、usage (inputTokens/outputTokens) 提取
- `createMainlineKernelRunner()` 在 `runtime-mainline.ts` 中将 AI binding、`QuotaAuthorizer`、capability transport 组装为单一 `KernelRunner`，LLM 路径经 `beforeLlmInvoke`/`afterLlmInvoke` hooks 接入 quota authorize/commit
- `QuotaAuthorizer` 实现了三个核心方法：`authorize()`（余额不足时抛 `QuotaExceededError` 并写入 deny usage + activity）、`commit()`（allow 路径写入 usage + 扣减 balance + 写入 activity）、`inspect()`/`setBalance()`
- `QuotaExceededError` 携带 `code = "QUOTA_EXCEEDED"`（与 Q9 冻结的 typed error 一致）
- `D1QuotaRepository` 实现了：idempotency-key 防重（`UNIQUE(team_uuid, resource_kind, idempotency_key)`）、8KB payload 截断（`MAX_ACTIVITY_PAYLOAD_BYTES=8192`）、activity log redaction（复用 `redactPayload`）、unique constraint 碰撞时的 3 次重试
- `workers/bash-core/src/worker-runtime.ts` 的 `beforeCapabilityExecute` hook 中实现了 quota ticket 4 项校验：`verdict === "allow"`、`quota_kind === "tool"`、`request_id === requestId`、`tool_name === plan.capabilityName`
- `kernel/runner.ts` 中 `beforeLlmInvoke` 在 LLM 调用前触发 quota authorize，`afterLlmInvoke` 在 LLM 调用后触发 quota commit（携带 usage），provider 失败时 `handleLlmCall` 正确捕获 `QUOTA_EXCEEDED` 并生成 `system.notify`
- `004-usage-and-quota.sql` 表结构正确：`nano_quota_balances` 复合主键 `(team_uuid, quota_kind)` + FK → nano_teams + CHECK constraint；`nano_usage_events` 有 `idempotency_key` UNIQUE + 2 条索引 + FK + CHECK constraint
- `003-session-truth-hardening.sql` 实际上修复了 Z2 review 的全部 critical/high findings（见 R2 详细分析）
- preview 真实部署并 remote apply 了全量 migration（001-004），live E2E 36/36 + 12/12 全绿
- `D1QuotaRepository.serializeActivityPayload()` 在 payload 超 8KB 时截断并写入 `{ truncated: true, original_bytes, preserved_keys }` metadata
- kernel runner 的 `handleLlmCall` 在 Provider error 时（包含 `QUOTA_EXCEEDED`）产生 `complete_turn` action，避免卡死 loop

### 1.2 已确认的负面事实

- **迁移 003**（297 行、6 表 rebuild + FK + 8KB constraint + audit view）不存在于 Z3 action-plan 的任何 Phase 或工作项中，Z3 closure 全文未提及此项
- **全项目无 quota 测试**：`grep` 在 `workers/agent-core/test/`、`workers/bash-core/test/`、`test/package-e2e/`、`test/cross-e2e/` 中均无 `quota`/`QuotaExceeded`/`beforeLlmInvoke` 匹配
- `D1QuotaRepository.ensureTeamSeed()` 创建 `user_uuid == team_uuid` 的 synthetic user（`is_email_verified=1`、`plan_level=0`），无真实 auth identity 支撑
- `QuotaAuthorizer.authorize()` 的 `remaining < 1` 检查与 `recordUsage` 的 `deductBalance` 之间存在非原子读-写窗口，无悲观锁
- `QuotaAuthorizer.appendActivity()` 与 `D1SessionTruthRepository.appendActivity()` 使用同一张 `nano_session_activity_logs` 表但各自独立计算 `event_seq`（从同一 trace_uuid 取 MAX），在 003 迁移添加 `UNIQUE(trace_uuid, event_seq)` 后可能出现冲突
- `workers-ai.ts` 中的 `WORKERS_AI_TOOLSET` 是硬编码的 6 个 tool（pwd/ls/cat/rg/curl/git），不与 bash-core 的 capability registry 动态同步
- `createLiveKernelRunner()` 在无 `AI` binding 时静默返回 `null`，不产生任何 signal——外部 DEBUG 无从判断是"配置缺失"还是"有意走了 stub path"

---

## 2. 审查发现

### R1. 迁移 003-session-truth-hardening.sql 是未在 action-plan / closure 中声明的"幽灵迁移"

- **严重级别**：`critical`
- **类型**：`docs-gap`
- **事实依据**：
  - `workers/orchestrator-core/migrations/003-session-truth-hardening.sql` 存在且为 297 行
  - 该迁移执行了完整的 6 表 schema rebuild（RENAME old → CREATE new with FK + checks → INSERT data → DROP old → CREATE indexes + audit view）
  - Z3 action-plan §2（In-Scope）未提及此迁移；§4.4（Phase 4）只列出 `004-usage-and-quota.sql` 作为新增 migration
  - Z3 action-plan §9 工作日志完全未提及 003 的存在
  - Z3 closure §2 实际交付列表 7-8 项只列出 004 migration 和 wrangler.jsonc 变更，无 003
  - 该迁移修复了以下 Z2 review 发现：
    - **R2（critical）**: `actor_user_uuid`/`conversation_uuid`/`session_uuid` 从 NOT NULL 改为 nullable（见 003:79-83）
    - **R5（medium）**: payload 添加 `length(CAST(payload AS BLOB)) <= 8192` CHECK 约束（003:88）
    - **R7（medium）**: 全表添加 FOREIGN KEY（003:22,35-36,49-52,63-67,81-83）
    - **R9（medium）**: `last_event_seq` 添加 `UNIQUE(trace_uuid, event_seq)` 约束（003:90）
    - **R10（low）**: 添加 `idx_nano_conversation_turns_team_created_at` 索引（003:278-279）
    - **R11（low）**: 添加 `idx_nano_conversation_messages_turn_created_at` 索引（003:284-285）
    - **Q5 view**: 新增 `view_recent_audit_per_team` 审计视图（003:287-297）
- **为什么重要**：
  - 这是一座承上启下的"硬链接迁移"——它将 Z2 交付的 schema 进行了破坏性重建（RENAME → CREATE → INSERT → DROP），是修复 Z2 review 6+ 项发现的"超级补丁"。这样规模的 schema change 如果不被任何 phase 文档追踪，未来任何人都无法理解"为什么 002 和 004 之间有一座奇怪的 003"。
  - D1 的 RENAME+DROP 操作是不可逆的——如果 003 的 INSERT 步骤因为数据量、约束冲突、或 D1 限制而失败，old 表已被 RENAME 但 new 表未完全填充，数据处于不可恢复的中间态。这样的风险在文档中完全未被识别。
  - 003 是在 Z2 review 指出问题后 GPT 独立修复的——但修复未经过 owner 审批，也未被纳入任何 action-plan 或 closure。这破坏了"所有 schema change 必须先进入 ZX-D1 设计文档冻结、再进入 action-plan 执行"的纪律。
- **审查判断**：
  - 003 migration 的内容本身是正确且必要的（它修复了 Z2 review 的全部 core findings）。问题在于它作为代码存在于 repo 中，但设计决策与执行记录为其空白——这在工程追溯性上是不合格的。
- **建议修法**：
  - **(a)** 在 Z3 closure 中明确记录 003 migration 的存在、其修复的 Z2 review finding 编号、以及为何在 Z3 而非 Z2 中完成（因 Z2 已 closure 且 D1 不支持 ALTER TABLE 修改列约束）。
  - **(b)** 回修 ZX-D1 §7.3.1 的字段级冻结表，使其与 003 的最终 schema 一致（nullable 列、CHECK 约束、FOREIGN KEY 等）。
  - **(c)** 记录 003 的 RENAME+DROP 策略的风险评估与回滚预案。

### R2. Action-plan P5-01 要求的 quota exhausted/recover 测试完全缺失

- **严重级别**：`critical`
- **类型**：`test-gap`
- **事实依据**：
  - Z3 action-plan §4.5 P5-01 收口标准："覆盖 real llm run、tool happy path、quota exhausted、quota recover 等场景"；"至少一轮真实 prompt->tool->response 成功，负例 reject 正常"
  - `grep -r "quota\|QuotaExceeded\|beforeLlmInvoke" workers/agent-core/test/` → 0 结果
  - `grep -r "quota\|QuotaExceeded\|beforeLlmInvoke" test/package-e2e/ test/cross-e2e/` → 仅在 `11-orchestrator-public-facade-roundtrip.test.mjs` 的一条注释中出现 "quota" 字样，非测试用例
  - Z3 closure §3.1-3.3 列出的验证证据中不包含任何 quota-specific test command 或 test result
- **为什么重要**：
  - 这是 action-plan 的收口标准明确要求的证据。没有 quota exhausted 的负例测试，就无法证明 `QUOTA_EXCEEDED` 这个 typed error 在真实 runtime path 上能被正确抛出、被 client-visible stream 捕获、被 activity log 记录。
  - quota recover 场景（允许额度耗尽后补额再成功执行）是证明`nano_quota_balances` 的 remaining/limit 写回路径有效的唯一手段。没有它，balance writer 的正确性只能靠代码阅读而非 runtime 验证。
  - live E2E 36/36 的通过不能替代 quota-specific 测试——live E2E 的 auth/session/cancel paths 可以全部通过，但 quota 逻辑可能在 preview 上由于永远不耗尽余额（default 200/400 calls）而从未被触发。
- **审查判断**：
  - 当前状态不符合 action-plan P5-01 的收口标准。需要在 Z3 closure 被接受前补齐至少一条 quota exhausted 负例 + 一条 quota recover 补额测试。
- **建议修法**：
  - 新增测试 `test/package-e2e/agent-core/07-quota-exhausted.test.ts`：设置 `remaining=0` → 发起 llm invoke → 断言触发 `QUOTA_EXCEEDED` → 断言 activity log 中存在 `quota.deny` 记录。
  - 新增测试 `test/package-e2e/agent-core/08-quota-recover.test.ts`：设置 `remaining=0` → 发起 llm invoke → 断言拒绝 → `setBalance(100)` → 再次发起 → 断言接受 → 断言 balance 正确扣减。
  - 如果 Workers AI 在本地测试环境中不可用（无 AI binding），可使用 mock `AiBindingLike` 并验证 quota gate 行为独立于真实 provider。

### R3. `ensureTeamSeed()` 在缺失 deploy team row 时创建 synthetic identity，是一个绕过 auth 系统的架构 hack

- **严重级别**：`high`
- **类型**：`scope-drift`
- **事实依据**：
  - `workers/agent-core/src/host/quota/repository.ts:71-94` — `ensureTeamSeed()`:
    ```typescript
    const ownerUserUuid = teamUuid;
    await this.db.batch([
      this.db.prepare(`INSERT OR IGNORE INTO nano_users (
        user_uuid, user_status, default_team_uuid, is_email_verified, created_at, updated_at
      ) VALUES (?1, 'active', ?2, 1, ?3, ?3)`, ownerUserUuid, teamUuid, now),
      this.db.prepare(`INSERT OR IGNORE INTO nano_teams (
        team_uuid, owner_user_uuid, created_at, plan_level
      ) VALUES (?1, ?2, ?3, 0)`, teamUuid, ownerUserUuid, now),
    ]);
    ```
  - 这意味着 `user_uuid == team_uuid`（例如 team_uuid=`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` 则 user_uuid 相同），`is_email_verified=1`，`default_team_uuid=self`
  - Z3 closure §5.3 已诚实记录此项："quota repo 现在会为缺失 deploy team row 的单租户 preview posture 自动 seed synthetic owner user + team；这解决了 FK truth，但更完整的 tenant bootstrap owner 仍应在后续 identity/runtime 统一时收回到更上层 owner。"
  - 但与 ZX-qna.md Q3（业主同意的 Opus 约束 #1）冲突："team 命名确定性...NACP authority 不变规则：登录后 team_uuid 必为非 null（如果建 team 失败，应整体回滚 user 注册并报错；不允许'user 已建、team 未建'中间态"。此处创建的 user+team 完全绕过了 auth worker，违反了 owner 同意的 NACP authority 纪律。
  - `context/smind-admin/src/modules/identity/auth.service.ts` 的祖宗实现中，register flow 通过 `D1` 事务写入 user + profile + identity + team + membership，由 auth service 统一负责。但 `ensureTeamSeed()` 是一个 runtime quota repo 方法——它根本不在 auth service 的控制流中。
- **为什么重要**：
  - 这个 synthetic identity 绕过了整个 auth 体系——它创造了没有真实 identity/WeChat/email_password 记录的 user，创造了没有 membership 记录的 team owner。任何后续 admin/audit 查询都会发现这些"幽灵用户"。
  - 该行为在当前 preview 单租户 posture 下是"刚好能工作"的 patch，但一旦 Z4 Mini Program 真机上线带多租户，该 `INSERT OR IGNORE` 路径的触发条件、scope、行为完全不可控。
  - Z3 closure 正确地称其为 residual，但没有给出"return to owner"的具体路径和时间点（应该在哪个 phase 由谁收回）。
- **审查判断**：
  - 该 hack 是解决 D1 FK constraint + preview 单租户无预 seed 数据的务实方案。但在工程纪律上，它应该在 action-plan 中被明确标注为"技术债 / 后续由 Z4/Z5 identity bootstrap 统一收回"，而不是作为 quota repo 的隐式副作用存在。
- **建议修法**：
  - 添加环境变量 `NANO_AGENT_SKIP_AUTO_SEED` 控制该行为（preview 开启，production 强制关闭）。
  - 在 Z3 closure 中标注 "return to owner = Z4 identity bootstrap"，而非模糊的"后续更上层 owner"。

### R4. 两个 D1 写入者独立计算 `event_seq` 在 003 迁移添加 `UNIQUE(trace_uuid, event_seq)` 后存在冲突风险

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/session-truth.ts:387-391` — `D1SessionTruthRepository.appendActivity()` 使用 `SELECT COALESCE(MAX(event_seq), 0) + 1 FROM nano_session_activity_logs WHERE trace_uuid = ?` 计算 event_seq
  - `workers/agent-core/src/host/quota/repository.ts:290-303` — `D1QuotaRepository.appendActivity()` 使用 `SELECT COALESCE(MAX(event_seq), 0) + 1 FROM nano_session_activity_logs WHERE trace_uuid = ?5` 计算 event_seq
  - `workers/orchestrator-core/migrations/003-session-truth-hardening.sql:90` — 新增 `UNIQUE (trace_uuid, event_seq)` 约束
  - 这意味着：如果同一 trace_uuid 下，`D1SessionTruthRepository` 和 `D1QuotaRepository` 在并发或短时间内各自写入 activity log，且两者都基于调用时的 MAX(event_seq) 计算出相同值，第二个写入会因 UNIQUE 约束冲突而失败
- **为什么重要**：
  - 当前 preview 单用户测试环境中，orchestrator-core 的 activity 写入（session.start、stream events）和 agent-core 的 activity 写入（quota.deny、runtime.llm.invoke）可能共用同一个 trace_uuid。在 002 migration 阶段（无 UNIQUE 约束），两者各自写入不同 event_seq 没有问题。但 003 加了 UNIQUE 约束后，并发计算相同值会直接导致 D1 INSERT 失败。
  - `D1QuotaRepository.appendActivity()` 有 3 次 unique constraint 重试逻辑，每次重试会重新 UUID 和重新查询 MAX(event_seq)，理论上可以 converge，但会引入 latency 和额外的 D1 read。
- **审查判断**：
  - 003 添加 UNIQUE 约束是正确方向（Q5 要求 per-trace 严格递增，UNIQUE 是 enforcing mechanism），但它在设计上没有为此约束的跨 writer 写入分配独立的 seq domain。当前 architecture 下，两个 repo 独立计算 event_seq，UNIQUE 约束是必要的 correctness guard，但 writer 之间未协调 seq scope。
  - 短期 risk 可控（单 user preview + 3 次重试），但应被识别为 cross-writer seq allocation 的未完成设计。
- **建议修法**：
  - 在 Z3 closure 中识别此项为 known technical debt：跨 worker 共享 activity log 写入需要统一 seq 分配机制（例如 seq_server 或 reserved seq range per writer）。
  - 追踪 `D1QuotaRepository.appendActivity()` 的 retry 次数作为可观测性指标，检测 UNIQUE 冲突频率。

### R5. Workers AI tool schema 硬编码，不与 bash-core capability registry 同步

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `workers/agent-core/src/llm/adapters/workers-ai.ts:11-54` — `WORKERS_AI_TOOLSET` 包含 6 个硬编码工具：pwd、ls、cat、rg、curl、git
  - `workers/bash-core/src/worker-runtime.ts:112-147` — bash-core runtime 注册了约 20+ 个 capability（filesystem、search、text-processing、network、exec、vcs）+ px_sleep
  - 两个清单不一致：bash-core 有更多工具（write/tojson/sed/awk/nl 等），Workers AI adapter 只报告了 6 个
- **为什么重要**：
  - Worker AI 的 tool-calling 能力依赖于 `payload.tools` 中声明的工具列表。如果 adapter 只报告 6 个固定 tool，模型将无法 call 其他 14+ 个 bash-core capability，即使这些 capability 已正确注册且可执行。
  - action-plan Phase 1 说 "默认 model=`@cf/ibm-granite/granite-4.0-h-micro`，Workers AI 内部 fallback=`@cf/meta/llama-4-scout-17b-16e-instruct`，只有两者都过不了 fc smoke 才升级 DeepSeek required"。如果 model 只能看到 6 个 tool，fc smoke 即使通过也无法证明完整的 tool 覆盖。
- **审查判断**：
  - 硬编码 6 个 tool 作为 first-wave baseline 是合理的简化——runtime-mainline 的 architecture 并不提供从 bash-core 动态拉取 capability registry 的能力。但 6 tool 的 hardcoded 范围应被文档记录为 "Z3 first-wave hardcoded toolset"，并在后续 phase 中由动态 capability sync 替代。
- **建议修法**：
  - 在 `workers-ai.ts` 或 `runtime-mainline.ts` 的注释中说明 "first-wave toolset is deliberately hardcoded; dynamic sync from bash-core capability registry is a Z4/Z5 follow-up"。
  - 在 Z3 closure residuals 中补充此项。

### R6. `createLiveKernelRunner()` 在无 AI binding 时静默 fallback，无显式 signal

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `workers/agent-core/src/host/do/nano-session-do.ts:471-481`:
    ```typescript
    private createLiveKernelRunner() {
      const runtimeEnv = this.env as Partial<SessionRuntimeEnv> | undefined;
      if (!runtimeEnv?.AI) return null;
      return createMainlineKernelRunner({...});
    }
    ```
  - 当 `AI` binding 不存在时，该方法静默返回 `null`，不记录日志、不抛出错误、不产生任何可观测信号
  - 上层 call site（在 `buildOrchestrationDeps()` 中调用 `createLiveKernelRunner()`）在 runner 为 null 时 fallback 到 stub composition factory
- **为什么重要**：
  - 如果 deploy 配置错误（wrangler.jsonc 漏配 `ai.binding`），系统会静默退回到 stub/fake provider path，所有测试（包括 live E2E）会继续通过，但真实 LLM 调用从未发生。操作者无法从任何 runtime signal 中察觉"系统根本没有走 Workers AI"。
  - 这与 Z3 design doc §7.2 F1 的收口标准直接冲突："fake provider 不再是默认 deploy path"。如果一个配置错误就导致全系统回退到 fake path，就无法声称 Workers AI 是 mainline。
- **审查判断**：
  - 建议在 `createLiveKernelRunner()` 返回 null 时至少 emit 一条 `system.notify` event 到 eval sink，或在 shell response 中增加 `ai_binding: false` 字段。
- **建议修法**：
  - 在 `createLiveKernelRunner()` 返回 null 的路径中添加 eval trace event `system.notify(severity: warn, message: "AI binding not configured, falling back to stub kernel")`。
  - 在 agent-core 的 shell response 中添加 `real_provider_active: boolean` 字段。

### R7. `nano_quota_balances.remaining` 递减存在非原子读-写竞态窗口

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `QuotaAuthorizer.authorize()`（`workers/agent-core/src/host/quota/authorizer.ts:57`）：读取 `balance.remaining` 并检查 `< 1`
  - `D1QuotaRepository.recordUsage()`（`workers/agent-core/src/host/quota/repository.ts:219-235`）：`UPDATE nano_quota_balances SET remaining = CASE WHEN remaining >= ?3 THEN remaining - ?3 ELSE 0 END`
  - 在 authorize() 读余额和 recordUsage() 写余额之间，没有 pessimistic lock (SELECT FOR UPDATE) 或 optimistic lock (version column check)
  - D1 是单 writer SQLite，同一 DO 实例内不会并发。但如果同一 team 在不同 session DO 中同时触发 quota check，两个 DO 可能看到相同的 remaining 值（例如 both see 1），都通过 authorize()，都执行 UPDATE，结果为 remaining=0（而非 -1，因为 CASE 保护）
- **为什么重要**：
  - 在当前 architecture 下（一个 team 在同一时刻通常只有一个 active session DO），竞态窗口极小。但 architecture 本身不保证这一点——如果 Z4 Mini Program + web 同时为同一 team 创建 session，system 没有 enforcement mechanism 保证只有一个 DO 实例。
  - CASE 保护（`remaining >= ?3 THEN remaining - ?3 ELSE 0`）防止了负余额，但不能防止"双重消费"——两个 invoke 都进 allow 路径但只消耗了 1 的余额。
- **审查判断**：
  - 对于 Z3 first-wave，此 risk 被 CASE 保护缓解到可接受程度。但应在 Z3 closure residual 中标识为 "quota balance 的并发安全 = best-effort for single-DO Z3 deploy"，并在 Z4/Z5 中升级为 optimistic lock 或 atomic decrement。
- **建议修法**：
  - 在 Z3 closure residual 中添加此项。
  - 在 `D1QuotaRepository.recordUsage()` 的 balance UPDATE 后 re-read balance 并验证 remaining >= 0，若为 0 且 deductBalance=true 且 quantity>remaining，写一条 severity=warn 的 activity log 记录。

### R8. Workers AI primary/fallback model IDs 没有出现在任何配置文件中供运维替换

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - model IDs 硬编码在 `workers/agent-core/src/llm/adapters/workers-ai.ts:7-9`:
    ```typescript
    export const WORKERS_AI_PRIMARY_MODEL = "@cf/ibm-granite/granite-4.0-h-micro";
    export const WORKERS_AI_FALLBACK_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
    ```
  - 不在 wrangler.jsonc 的 vars 中，不在任何环境变量中
  - 切换 model 需要修改源代码并重新 build+deploy
- **为什么重要**：
  - ZX-llm-adapter-and-secrets.md §7.2 F1 明确要求 "fc smoke 不过时先在 Workers AI 内换 model"——如果 model ID 硬编码在源码中，换 model = 改代码 + redeploy，这在 pre-production 快速迭代阶段不灵活。
- **审查判断**：
  - 对 Z3 first-wave 来说可接受，但应在 Z4/Z5 closure 前将 model ID 迁移到 wrangler vars。
- **建议修法**：
  - 添加可选 vars `NANO_AGENT_WORKERS_AI_PRIMARY_MODEL` / `NANO_AGENT_WORKERS_AI_FALLBACK_MODEL`，在 wrangler.jsonc 中配置，`workers-ai.ts` 读取时优先 vars fallback 常量。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| [S1] | `AI` binding + Workers AI first-wave model 成为 mainline provider | `done` | AI binding 已加，adapter 完整实现（streaming/tool_calls/usage/fallback），kernel runner 正确接入 |
| [S2] | agent loop 真实走 Workers AI，fake provider 退为 test/demo path | `partial` | 主路径正确，但缺 AI binding 时静默 fallback stub（R6），无 signal 告知运维当前 runtime 状态 |
| [S3] | llm + tool 统一 quota dual gate | `done` | `beforeLlmInvoke`（runner.ts）+ `beforeCapabilityExecute`（bash-core）双 gate 完整，QuotaAuthorizer 共享同一套 authorize/commit logic |
| [S4] | `nano_usage_events / nano_quota_balances` durable truth 落地 | `partial` | 004 migration 正确落地，但 ensureTeamSeed 创建 synthetic identity（R3），balance 递减有竞态窗口（R7） |
| [S5] | accepted/rejected runtime evidence 写入 activity/audit/eval stream | `partial` | QuotaAuthorizer 正确写入 activity log 和 trace event，但与 orchestrator-core 共享 event_seq domain 存在 UNIQUE 冲突风险（R4） |

### 3.1 对齐结论

- **done**: `2`（S1, S3）
- **partial**: `3`（S2, S4, S5）
- **missing**: `0`

**结论**: Z3 的 runtime mainline（S1/S3）完成度最高，quota gate 的双端接法（LLM + tool）干净、一致。S2/S4/S5 的 partial 状态源于架构层面的未完成设计决策（静默 fallback、synthetic identity、跨 writer seq domain）和缺失的 quota 专项测试，而非实现错误。Z3 closure 不应在这些 partial 项被诚实记录并拿到 owner 批准前声称已完全满足 exit criteria。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| [O1] | 多 provider GA 与复杂路由 | `遵守` | Workers AI 为唯一 required provider，DeepSeek skeleton 未进入 default runtime |
| [O2] | 细粒度 billing/statement/finance admin UI | `遵守` | 未引入 |
| [O3] | 完整 browser-rendering productization | `遵守` | 未引入 |
| [O4] | 大规模 client hardening 与产品包装 | `遵守` | 未引入 |

---

## 5. 跨阶段跨包深度分析

### 5.1 Z2 review findings 的 Z3 闭合状态

上一轮 Z2 review（`Z2-reviewed-by-deepseek.md`）全部 14 项发现中，以下在本轮得到了实质性闭合：

| Z2 Review 发现 | 闭合文件 / 机制 | 闭合质量 |
|----------------|----------------|---------|
| R1+R12 (write ownership) | agent-core wrangler.jsonc 新增 `NANO_AGENT_DB` binding | ✅ done — agent-core 现在拥有 D1 写入能力，但实际 quota tables 也由 agent-core 写入（符合 ZX-D1 ownership 的原始设计意图 `agent.core → usage events, quota balances`） |
| R2 (activity log nullable) | 003 migration 将 `actor_user_uuid`/`conversation_uuid`/`session_uuid` 改为 nullable（003:79-83） | ✅ done |
| R4 (字段命名差异) | 003 migration 保留原有命名（`owner_user_uuid`、`session_status`、`turn_kind` 等），未回修 ZX-D1 设计文档 | ⚠️ schema 已稳定但 ZX-D1 设计文档仍不一致 |
| R5 (8KB payload) | 003 migration 添加 `length(CAST(payload AS BLOB)) <= 8192` CHECK constraint（003:88）+ `D1QuotaRepository` 中 8KB 截断逻辑 | ✅ done |
| R7 (FK 约束) | 003 migration 全表添加 FOREIGN KEY（003:22,35-36,49-52,63-67,81-83） | ✅ done |
| R9 (last_event_seq 不更新) | 003 migration 添加 `UNIQUE(trace_uuid, event_seq)` 约束（003:90）——该约束 enforce 了 seq 唯一性，但不解决"两 writer 独立计算 seq"的问题（见 R4） | ⚠️ partial |
| R10 (turn 缺 team 索引) | 003 migration 添加 `idx_nano_conversation_turns_team_created_at`（003:278-279） | ✅ done |
| R11 (message 缺 turn 索引) | 003 migration 添加 `idx_nano_conversation_messages_turn_created_at`（003:284-285） | ✅ done |
| R6 (DO hot-state rebuild invariant 测试) | 未闭合 | ❌ 仍未闭合 |
| R3 (agent-core RPC 仍为 fetch-backend) | Z2 closure residual，Z3 未处理 | ❌ 延后到 Z4/Z5 |
| R13+R14 (alarm checkpoint + cache eviction) | Z3 未处理 | ❌ 延后 |

**关键发现**: 003 migration 在代码层面修复了 Z2 review 的 7/14 项发现（含 2 critical、3 high、2 medium）。但该 migration 未被任何文档追踪（见 R1）。这导致修复本身是有效的，但"谁修复了、何时修复了、以什么决策依据修复了"这三个关键信息完全缺失。

### 5.2 Z3 的 design doc vs action-plan vs 实际代码的三向对齐分析

| 维度 | Z3 design doc (§7) | Z3 action-plan (§4) | 实际代码 |
|------|-------------------|---------------------|---------|
| Workers AI model | `@cf/ibm-granite/granite-4.0-h-micro` | same + fallback `@cf/meta/llama-4-scout-17b-16e-instruct` | `workers-ai.ts:7-9` — 完全一致 |
| beforeLlmInvoke 落点 | "在 kernel/runner.ts 的 invoke path 前" | `workers/agent-core/src/kernel/runner.ts::beforeLlmInvoke()` | `runner.ts:32-35,160-161` — 完全一致 |
| beforeCapabilityExecute 复用 | "复用 bash-core executor.ts" | `workers/bash-core/src/executor.ts` | `worker-runtime.ts:128-143`（在 bash worker runtime 层，非 executor.ts 内部）— 设计落点略有偏差但逻辑等价 |
| tool gate 共享 authorizer | 同一套 law | 同一套 law | `QuotaAuthorizer` 同时服务 `beforeLlmInvoke` 和 `buildToolQuotaAuthorization` — 正确 |
| deny typed error | `code='QUOTA_EXCEEDED'` | same | `QuotaExceededError.code = "QUOTA_EXCEEDED"` — 完全一致 |
| 004 migration | `nano_usage_events / nano_quota_balances` | same + 索引 | 004 migration — 完全一致 |
| quota deny 写 activity log | `event_kind='quota.deny'`, `severity='warn'` | Q9 要求 | `authorizer.ts:70-85` — 完全一致 |
| usage events 幂等 | `idempotency_key` | same | `UNIQUE(team_uuid, resource_kind, idempotency_key)` — 完全一致 |
| quota tests | "覆盖 real llm run、quota exhausted、quota recover" | P5-01 收口标准 | **缺失** — 见 R2 |

### 5.3 Z3 对 Z4 的直接影响

1. **Workers AI mainline 已就位**：Z4 的 web/Mini Program 客户端可以开始消费真实的 LLM 输出和 tool 执行结果，不再依赖 mock/fake path。
2. **Quota gate 对 Z4 客户端可见**：`QUOTA_EXCEEDED` 错误通过 `system.notify` 进入 session stream。Z4 客户端需要正确处理该 typed error 的 UI 提示。当前该 error 在 `runner.ts:199-209` 中作为 `system.notify(severity: warning)` 产生，Z4 需要将该 event 映射为用户可见的"额度不足"提示。
3. **Quota balance 恢复路径不经过 public API**：`QuotaAuthorizer.setBalance()` 是内部方法，没有通过 `/auth/*` 或 session route 暴露给客户端。Z4 如果要展示余额或提供充值路径，需要新增 auth/admin 路由或由 orchestrator-core proxy。
4. **003 migration 的 RENAME-DROP 策略意味着所有 preview data 在 migration apply 后已 rebuild**：如果 Z4 测试依赖 preview 上的历史 conversation 数据，需确认 INSERT 步骤的数据完整性。
5. **hardcoded toolset**：Z4 Mini Program 用户如果尝试 call 不在 6 tool list 中的 capability，Workers AI 模型不会返回对应 tool_call——因为模型根本不知道这些 tool 存在。这限制了 first real run 中可用的 tool 范围。

### 5.4 Z3 对 Z5 closure 的 carry-over items

以下项目应在 Z5 final closure 时重新评估闭合状态：

1. `nano_usage_events` 的 `quantity=1, unit='call'` 对 LLM 调用来说是一种简化（LLM 消耗的是 token，不是 call）。Z5 需要决定是否升级为 token-based billing。
2. `ensureTeamSeed()` 的 synthetic identity 需要由 Z4/Z5 的 identity bootstrap 统一收回。
3. Workers AI toolset dynamic sync from bash-core capability registry。
4. agent-core RPC 路径从 fetch-backed 迁移到真正的 DO RPC（Z2 review R3 carry-over）。
5. quota balance 并发安全升级。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：`Z3 的核心工程——Workers AI mainline、quota dual gate、durable usage/balance/audit truth——已全部落地且正确。但存在两个 blocker：003 migration 的文档追溯完全空白（R1），以及 action-plan 要求的 quota 专项测试完全缺失（R2）。此外，ensureTeamSeed synthetic identity（R3）和跨 writer event_seq UNIQUE 风险（R4）需要在 closure 被接受前获得 owner 对当前方案的知情同意。Z3 closure 不应在 R1 和 R2 未闭合的情况下标记为 approved。`

- **是否允许关闭本轮 review**：`no — changes-requested`

- **关闭前必须完成的 blocker**：
  1. **R1**: 在 Z3 closure §2 和 §5 中补入 003 migration 的完整文档记录：修复的 Z2 review 发现编号、采取的 RENAME→CREATE→INSERT→DROP 策略、风险评估、以及回修 ZX-D1 字段冻结表使其与 003 最终 schema 一致。
  2. **R2**: 补齐至少一条 quota exhausted 负例测试（llm/tool deny + typed error verification）和一条 quota recover 测试（补额后成功执行）。如果 Workers AI 在 CI 中不可用，使用 mock `AiBindingLike` 验证 quota gate 行为独立于 provider。
  3. **R3**: 获得 owner 对 `ensureTeamSeed()` synthetic identity 策略的知情同意，或添加环境变量控制其开关（preview 开启 / production 禁用），并在 Z3 closure 中标注 "return to owner deadline = Z4 identity bootstrap"。

- **可以后续跟进的 non-blocking follow-up**：
  1. **R4**: cross-writer event_seq 冲突风险 — Z3 closure 记录为 known debt，Z4/Z5 追踪。
  2. **R5**: Workers AI toolset 硬编码 — Z3 closure 记录为 Z4/Z5 follow-up。
  3. **R6**: AI binding 缺失时的静默 fallback — 添加 `system.notify` signal（小改动，建议 Z3 修正期完成）。
  4. **R7**: quota balance 竞态窗口 — Z3 closure 记录，Z4/Z5 升级。
  5. **R8**: model ID 硬编码 — Z4/Z5 迁移到 wrangler vars。
  6. Z2 review R6（DO hot-state rebuild invariant 测试）— 仍未闭合，Z4 真机测试前必须补齐。
  7. ZX-D1 §7.3.1 字段冻结表有 10+ 处与 003/004 实际 schema 不一致（Z2 review R4 carry-over），Z5 closure 前回修。
