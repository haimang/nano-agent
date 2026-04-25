# Zero-to-Real 设计文档完整审核报告

> 审查对象: `docs/design/zero-to-real/Z0-ZX 全部设计文档`
> 审查时间: `2026-04-25`
> 审查人: `Kimi (k2p6)`
> 审查范围:
> - `docs/charter/plan-zero-to-real.md`
> - `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md`
> - `docs/design/zero-to-real/Z0-contract-and-compliance-freeze.md`
> - `docs/design/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
> - `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md`
> - `docs/design/zero-to-real/Z3-real-runtime-and-quota.md`
> - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md`
> - `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md`
> - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
> - `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md`
> - `docs/design/zero-to-real/ZX-nacp-realization-track.md`
> - `docs/design/zero-to-real/ZX-qna.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`zero-to-real 设计文档框架完整、方向正确、thin-but-complete 口径把握得当；但存在显著的设计-实现 gap 未诚实量化，10 个核心 QnA 悬置未答，多个收口指标过于定性，导致 action-plan 若直接基于当前设计推进将面临范围漂移与工期低估风险。`
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. **设计-实现 gap 高达 ~80% 的"从零建设"需求被文档措辞掩盖**：当前代码完全没有 D1 binding、auth worker、DO SQLite、Workers AI adapter、WeChat bridge、web/Mini Program 客户端；设计文件使用"推进""接入""补齐"等词汇，易让 reader 误以为已有相当基础。
  2. **ZX-qna.md Q1-Q10 全部未回答，直接阻塞 7 个核心设计模糊点**：auth transport 形态、WeChat 自动建租户、activity log 表结构、hot-state 粒度、首条 RPC 方法、quota gate 范围、Mini Program transport baseline——这些决策必须在 action-plan 前冻结。
  3. **收口指标大量依赖定性描述**（"最低集合已成立""明确的过渡 seam"），缺少可量化的验收标准或 checklist，closure 时容易主观认定。

---

## 1. 审查方法与已核实事实

### 1.1 对照文档

- `docs/charter/plan-zero-to-real.md` — 基石文件，冻结全局边界与阶段目标
- `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md` — Opus v2 分析，提供 6-worker 终态拓扑与 ~5500 LOC / 3.5-4.5 月估算
- `docs/design/zero-to-real/Z0-Z4.md` + `ZX-*.md` — 10 份设计文档，覆盖 Z0-Z4 与 5 份 cross-cutting 设计
- `docs/templates/code-review.md` — 输出模板

### 1.2 核查实现

- `workers/orchestrator-core/src/user-do.ts` — user DO 当前只使用 `ctx.storage` KV，无 DO SQLite / Alarm
- `workers/orchestrator-core/src/auth.ts` — 已有 JWT verify，但无 mint / refresh / WeChat
- `workers/orchestrator-core/src/index.ts` — 唯一 public façade，只暴露 `/sessions/*` 路由
- `workers/orchestrator-core/wrangler.jsonc` — 无 D1 binding，只有 AGENT_CORE service binding
- `workers/agent-core/src/index.ts` + `src/host/internal.ts` — 承接 `/internal/sessions/*` fetch-backed 调用
- `workers/agent-core/src/kernel/runner.ts` — 真实 loop 骨架，但 `this.delegates.llm.call()` 走 fake provider
- `packages/llm-wrapper/src/gateway.ts` — 明确标注 "Stub interface only — not implemented in v1"
- `packages/llm-wrapper/src/adapters/openai-chat.ts` — 322 行 fetch-based adapter，无 Workers AI adapter
- `packages/llm-wrapper/src/registry/providers.ts` — provider registry 假设 `baseUrl` + `apiKeys`，不适用于 Workers AI
- `workers/bash-core/src/executor.ts` — 已有 `beforeCapabilityExecute` hook seam，但未 wire quota
- `workers/*/wrangler.jsonc` — 全部无 D1 binding；context-core / filesystem-core 无 service binding
- `packages/nacp-core/src/transport/service-binding.ts` — 已有 `ServiceBindingTransport` 框架，但 runtime 未使用 WorkerEntrypoint RPC
- `packages/nacp-core/src/tenancy/boundary.ts` — 已有 `verifyTenantBoundary`，在 nano-session-do.ts 中被调用
- `workers/agent-core/src/host/do/nano-session-do.ts` — 已使用 `tenantDoStorageGet/Put/Delete` 和 `verifyTenantBoundary`
- `context/mini-agent/` — Python CLI 项目，非 web/Mini Program 客户端

### 1.3 执行过的验证

- `find workers/ -name "*.ts" | head -100` — 确认 worker 代码结构
- `grep -r "D1\|d1_database\|DB" workers/*/wrangler.jsonc` — 确认无 D1 binding
- `grep -r "orchestration-auth" workers/` — 确认无 auth worker
- `grep -r "wechat\|WeChat\|wx\." workers/ packages/` — 确认无 WeChat 代码
- `grep -r "WorkerEntrypoint" workers/ packages/` — 确认无 WorkerEntrypoint RPC 使用
- `grep -r "env\.AI" workers/ packages/` — 确认无 Workers AI binding 使用
- `ls -la workers/orchestrator-core/src/` — 确认无 DO SQLite / Alarm 模块

### 1.4 已确认的正面事实

- **NACP 基础设施已成立**：`nacp-core` 的 envelope / tenancy / transport 框架完整；`nacp-session` 的 message schemas / frame validation 完整；`nano-session-do.ts` 已实际调用 `verifyTenantBoundary` 和 `tenantDoStorageGet/Put`。
- **internal authority hardening 已就位**：`orchestrator-core/src/auth.ts` 有 JWT verify + `AuthSnapshot`；`agent-core/src/host/internal-policy.ts` 有 shared secret + authority + trace + no-escalation 校验。
- **kernel loop 骨架完整**：`agent-core/src/kernel/runner.ts` 的 step-driven runner、tool exec、lifecycle events 已存在，只差 real provider 接线。
- **capability hook seam 已预留**：`bash-core/src/executor.ts:203-218` 的 `beforeCapabilityExecute` 为 quota gate 预留了接入点。
- **thin-but-complete 口径把握得当**：所有设计文档一致排除 full admin plane / full RPC retirement / cold archive，避免了 scope creep。
- **binding matrix 纪律清晰**：`orchestration.core` 唯一 public façade、`orchestration.auth` internal-only 等原则在所有文件中一致。

### 1.5 已确认的负面事实

- **无 D1 基础设施**：所有 wrangler.jsonc 无 D1 binding；代码中无 `nano-agent-db` 相关引用。
- **无 auth worker**：无 `workers/orchestration-auth/` 目录；无 JWT mint / register / login / WeChat 代码。
- **无 DO SQLite / Alarm**：`user-do.ts` 只使用 `ctx.storage.get/put`；无 `state.storage.sql` 调用。
- **无 Workers AI adapter**：`llm-wrapper` 有 OpenAI adapter 但无 Workers AI；`gateway.ts` 是 stub。
- **无 web / Mini Program 客户端**：代码库中无前端代码目录；`context/mini-agent/` 是 Python CLI。
- **全部 internal 调用仍为 fetch-backed**：`user-do.ts:692` 使用 `https://agent.internal/internal/sessions/...`；无 WorkerEntrypoint RPC。
- **ZX-qna.md Q1-Q10 全部未回答**：所有"业主回答"字段为空。

---

## 2. 审查发现

### R1. 设计-实现 gap 未在文档中诚实量化

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:766-775` 只使用 `ctx.storage` KV，没有 DO SQLite
  - 所有 `workers/*/wrangler.jsonc` 都没有 `[[d1_databases]]` binding
  - `packages/llm-wrapper/src/gateway.ts:6-7` 明确标注 "Stub interface only — not implemented in v1"
  - `workers/orchestrator-core/src/user-do.ts:692` 使用 `https://agent.internal/internal/sessions/...` fetch 调用
  - 没有 `workers/orchestration-auth/` 目录
  - 没有 web client 或 Mini Program 代码
- **为什么重要**：设计文件反复使用"推进""接入""补齐""启动"等词汇，reader 容易误以为当前代码已有相当基础。实际上需要从零建设的部分占比极高：auth worker (~800 LOC)、D1 schema + migrations (~1500 LOC)、DO SQLite uplift (~400 LOC)、Workers AI adapter (~250 LOC)、WeChat bridge (~200 LOC)、web client (~500 LOC)、Mini Program (~400 LOC)。Opus v2 估算的 ~5500 LOC 中，当前已 shipped 的骨架可能只占 ~1000-1500 LOC。
- **审查判断**：每份设计文档的"背景与前置约束"应增加"当前代码真实起点"小节，明确列出哪些已有、哪些需从零建设，防止工期估算偏低。
- **建议修法**：
  - 在 `Z1-full-auth-and-tenant-foundation.md` §0 增加："当前 orchestrator-core 已有 JWT verify（`auth.ts`），但无 JWT mint、无 auth worker、无 identity tables、无 WeChat bridge"
  - 在 `Z2-session-truth-and-audit-baseline.md` §0 增加："当前 user DO 只使用 `ctx.storage` KV，无 DO SQLite、无 Alarm、无 conversation 聚合"
  - 在 `Z3-real-runtime-and-quota.md` §0 增加："当前 `llm-wrapper` 有 OpenAI adapter 但无 Workers AI adapter；`gateway.ts` 仍是 stub"
  - 在 `Z4-real-clients-and-first-real-run.md` §0 增加："当前代码库无 web client 或 Mini Program 代码"

### R2. ZX-qna.md Q1-Q10 全部未回答，阻塞 7 个核心模糊点

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：`docs/design/zero-to-real/ZX-qna.md` 中 Q1-Q10 的"业主回答"字段全部为空（第 33、46、60、74、92、106、120、138、152、166 行）
- **为什么重要**：这 10 个问题直接影响：
  - **Q1**：auth worker 是 WorkerEntrypoint RPC-first 还是 fetch-binding shim → 决定 Z1 实现路线
  - **Q3**：WeChat 首次登录是否自动建 default team → 决定 Z1 identity core 的 onboarding 逻辑
  - **Q5**：activity log 单表还是拆表 → 决定 Z2 D1 schema
  - **Q6**：DO SQLite hot-state 最低集合粒度 → 决定 Z2 stateful uplift 范围
  - **Q7**：首条 dual-implemented control-plane 方法 → 决定 Z2 RPC kickoff 目标
  - **Q8**：DeepSeek 是否仅保留 skeleton → 决定 Z3 secret engineering 范围
  - **Q9**：quota deny 是否覆盖 llm + tool → 决定 Z3 gate 范围
  - **Q10**：Mini Program first-wave transport baseline → 决定 Z4 客户端优先级
- **审查判断**：QnA 必须在 action-plan 制定前完成，否则 action-plan 将建立在未冻结的假设上，推进中必然出现多文档口径不一致。
- **建议修法**：Owner 应在 ZX-qna.md 中回答 Q1-Q10；若有条件性问题（如 Q4 的 server-to-server ingress），应明确触发条件而非留空。

### R3. Z2 文件名存在 typo

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：文件名 `Z2-session-truth-and-audit-baseline.md4` 多了一个 "4"
- **为什么重要**：会导致引用该文件时出现路径错误，也影响 professionalism。
- **审查判断**：应立即修正。
- **建议修法**：重命名为 `Z2-session-truth-and-audit-baseline.md`

### R4. Z2 "DO SQLite 最低集合"未具体化到表/字段级别

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - Z2 §7.2 F2 说"DO SQLite + Alarm 组织的热态辅助层"
  - 附录 Q6 建议了"4 组热态"（conversation index、active pointers、reconnect hints、short-lived caches）
  - 但无具体表结构、字段、索引设计
  - `user-do.ts` 当前使用 `ctx.storage` KV，key 结构为 `sessions/${uuid}`、`user/meta` 等，与 DO SQLite 的关系模式完全不同
- **为什么重要**：如果不具体化，Z2 实现时容易过度设计（如把完整 conversation 历史也塞进 DO SQLite）或设计不足（如缺少 reconnect 必需的 cursor 字段）。
- **审查判断**：应在 ZX-d1-schema-and-migrations.md 或 Z2 文档中增加"DO SQLite first-wave schema"小节，明确表名、字段、索引。
- **建议修法**：
  - 在 `ZX-d1-schema-and-migrations.md` 增加 §X "DO SQLite Hot-State Schema"
  - 明确：`conversation_index`（uuid, title, last_active, team_uuid）、`active_pointers`（user_uuid, active_conversation_uuid, active_session_uuid）、`reconnect_hints`（session_uuid, last_seen_seq, cursor）、`alarm_schedule`（next_alarm_at, task_type）

### R5. Z3 Workers AI adapter 设计缺失——现有框架适配方式未说明

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - 现有 `llm-wrapper` 框架基于 `ChatCompletionAdapter` interface（`packages/llm-wrapper/src/adapters/types.ts`）
  - `OpenAIChatAdapter`（322 行）是 fetch-based，使用 `fetch()` 调用外部 HTTP API
  - Workers AI 使用 `env.AI.run()` platform binding，返回 `ReadableStream` 或对象，不是 HTTP Response
  - `packages/llm-wrapper/src/registry/providers.ts` 假设 provider 有 `baseUrl` + `apiKeys`，但 Workers AI 不需要这些
  - `executor.ts` 调用 `this.delegates.llm.call(messages)`，返回 `AsyncIterable<LlmChunk>`
- **为什么重要**：Z3 的核心目标是"Workers AI first"，但设计文件没有详细说明如何在现有 `llm-wrapper` 框架内接入 Workers AI。如果不明确，实现者可能：
  - 绕过现有框架直接写 ad-hoc Workers AI 调用，破坏 adapter boundary
  - 或过度重构现有框架以适配 Workers AI，引入不必要的复杂度
- **审查判断**：`ZX-llm-adapter-and-secrets.md` 应增加"Workers AI adapter 架构"小节，说明如何在现有框架内接入 `env.AI`。
- **建议修法**：
  - 定义 `WorkersAiAdapter implements LlmAdapter`
  - 说明 `env.AI` binding 在 `wrangler.jsonc` 中的配置（`ai = { binding = "AI" }`）
  - 说明 Workers AI 返回的 stream 如何映射到 `LlmChunk`（content / usage / tool_calls）
  - 说明 Workers AI 不支持的工具调用如何在 kernel 中 graceful degrade

### R6. Quota gate 实现位置与覆盖范围未明确

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `bash-core/src/executor.ts:203-218` 有 `beforeCapabilityExecute` hook，适合拦截 tool execution
  - 但 llm call 在 `agent-core/src/kernel/runner.ts:143`（`this.delegates.llm.call(...)`），无对应 hook
  - Z3 §5.3 的边界清单提到"`beforeCapabilityExecute()` 只拦 tool"是 out-of-scope，说明设计意识到这个问题
  - 但 Z3 §7.2 F2 说"llm/tool side-effect 前 allow/deny"，没有明确 llm gate 的实现位置
- **为什么重要**：如果实现位置不明确，Z3 可能只实现了 tool gate 而漏掉 llm gate，导致 quota 只覆盖 ~30% 的真实资源消耗。
- **审查判断**：应在 Z3 或 ZX-nacp-realization-track.md 中明确 quota gate 的统一架构。
- **建议修法**：
  - 定义 quota gate 的两种接入方式：
    1. **Tool gate**：复用 `bash-core` 的 `beforeCapabilityExecute` hook
    2. **LLM gate**：在 `agent-core` 的 `KernelRunner.handleLlmCall()` 中增加 `await this.delegates.quota.check(...)` 调用
  - 或者定义独立的 `quota.core` worker（internal-only），通过 service binding 被 agent.core 和 bash.core 调用

### R7. 缺少从零建设部分的工期与人力评估

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - Opus v2 估算 "~5500 LOC / 3.5-4.5 月"
  - 但这是基于 6-worker 终态的估算，且假设了大量从 smind-admin / smind-contexter 吸收的代码
  - 实际上当前代码与终态差距巨大，且吸收 adapt-pattern 也需要时间
  - 没有按 Z0-Z4 分阶段的 LOC 或工期估算
- **为什么重要**：如果工期估算不准，会导致里程碑延期和 scope 压缩。zero-to-real 的目标不是"做多少"而是"在多长时间内做到什么状态"。
- **审查判断**：应在 action-plan 中明确每阶段的估算，但设计文档也应提供 rough sizing。
- **建议修法**：
  - 在 `plan-zero-to-real.md` §8 增加每阶段的 rough sizing：
    - Z1: ~1200 LOC（auth worker + identity migrations + WeChat bridge + tests）
    - Z2: ~1500 LOC（D1 conversation/audit migrations + DO SQLite uplift + RPC scaffold + tests）
    - Z3: ~1000 LOC（Workers AI adapter + quota gate + usage tables + tests）
    - Z4: ~800 LOC（web hardening + Mini Program + gap triage + tests）

### R8. Web client / Mini Program 代码位置与仓库结构未定义

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - 代码库中没有前端代码目录
  - `context/mini-agent/` 是 Python CLI 项目（`mini_agent/cli.py`、`pyproject.toml`），不是 web/Mini Program 客户端
  - Z4 §7.2 F1 提到"web thin client"和"Mini Program"，但没有说明代码放在哪里
- **为什么重要**：Z4 需要真实客户端，但设计文件没有说明客户端代码的组织方式。这会导致：
  - 前端代码与后端代码混在同一仓库还是独立仓库？
  - 如果是同一仓库，目录结构是什么？
  - Mini Program 的代码是否需要特殊构建工具？
- **审查判断**：Z4 应增加"客户端代码位置与仓库结构"小节。
- **建议修法**：
  - 在 Z4 §0 或 §7 中明确：
    - web client → `clients/web/`（或 `apps/web/`）
    - Mini Program → `clients/mini-program/`（或 `apps/mini-program/`）
    - 或若独立仓库，说明仓库名与接口契约版本

### R9. Z1 与现有 orchestrator-core auth.ts 的集成关系未明确

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `orchestrator-core/src/auth.ts` 已有 190 行 JWT verify 逻辑，包括 `verifyJwt()`、`parseBearerToken()`、`authenticateRequest()`
  - Z1 要求新建 `orchestration.auth` worker，负责 JWT mint / verify / refresh
  - 但设计文件没有说明 orchestrator-core 现有的 verify 逻辑是保留、迁移还是重写
- **为什么重要**：如果不明确，可能出现两套 JWT 逻辑并存（orchestrator-core 的本地 verify + auth worker 的 verify），或出现不必要的重构。
- **审查判断**：Z1 应明确现有 auth 模块的命运。
- **建议修法**：
  - 在 Z1 §7.2 F1 或 §3.3 中明确：
    - `orchestrator-core` 保留 JWT verify 作为 fast-path（减少 RPC 调用），但验证 key 与 `orchestration.auth` 共享
    - 或 `orchestrator-core` 的 verify 完全委托给 `orchestration.auth` 的 binding call
    - `orchestration.auth` 负责 JWT mint、refresh、WeChat bridge、identity CRUD

### R10. D1 migration 策略与工具未选择

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `filesystem-core/src/storage/adapters/d1-adapter.ts` 有 D1 封装，但只用于 filesystem 场景
  - 代码中没有通用的 migration 框架或工具
  - Opus v2 §4.4 建议了 `nano_schema_version` 表 + 自动 migration 模式，但设计文件未采纳
  - `ZX-d1-schema-and-migrations.md` 只冻结了表清单，没有 migration 策略
- **为什么重要**：D1 schema 是 zero-to-real 的基石。如果没有 migration 策略，团队可能：
  - 手动执行 `wrangler d1 execute`，容易出错且不可复现
  - 或每个 worker 各自实现 migration，导致不一致
- **审查判断**：`ZX-d1-schema-and-migrations.md` 应增加 migration 工具与策略小节。
- **建议修法**：
  - 明确采用"`wrangler d1 migrations create` + worker 启动时 idempotent migrate()"双轨策略
  - 或明确采用 Opus v2 建议的 `nano_schema_version` 表 + 自动 migration
  - 定义 migration 文件命名规范（`migrations/001-identity-core.sql`、`migrations/002-conversation-core.sql` 等）

### R11. Z4 "gap triage" 缺少具体方法论

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - Z4 §6.2 提到"gap triage 漂移"风险，说"问题散在各处，下一阶段无法接手"
  - 但没有定义 triage 的具体流程、分类标准、优先级判断规则
- **为什么重要**：真实客户端实验会产生大量问题（auth gap、WS bug、history 不一致、stream 中断等），没有分类标准会导致：
  - 紧急问题被压入 backlog
  - 低优先级问题被过度修复
  - 问题描述不一致，下一阶段无法接手
- **审查判断**：Z4 应增加"gap triage 方法论"小节。
- **建议修法**：
  - 定义分类标签：`[blocker]`（阻止 first real run）、`[follow-up]`（可延后）、`[wont-fix-z4]`（超出 zero-to-real 范围）
  - 定义 triage 流程：发现 → 复现 → 分类 → 修复/入 backlog → 验证
  - 定义 evidence pack 结构：问题描述 + 复现步骤 + trace/session UUID + 截图/日志

### R12. 跨阶段收口指标不一致或过于定性

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - Z2 收口标准 #3: "user DO 的 hot-state 最低集合已成立" —— "最低集合"未定义
  - Z4 收口标准 #3: "剩余 internal HTTP 已被压缩到明确的过渡 seam" —— "明确"未定义
  - Z3 收口标准 #3: "runtime mesh 未继续扩 internal HTTP 新面" —— 是负面指标（不做什么），无正面验证方式
  - 各阶段收口标准之间缺少关联：Z2 的 RPC kickoff 如何影响 Z4 的 residual inventory？
- **为什么重要**：定性指标容易被主观解读。 closure 时可能出现"我觉得已经够了" vs "我觉得还不够"的争议。
- **审查判断**：收口指标应尽可能量化或提供 checklist。
- **建议修法**：
  - Z2 收口标准 #3 改为："DO SQLite 包含至少 4 张表（conversation_index, active_pointers, reconnect_hints, alarm_schedule），且能通过 integration test 验证 reconnect 后 timeline 不丢"
  - Z4 收口标准 #3 改为："列出所有剩余 internal HTTP seam（含 URL pattern、保留原因、下一步退役计划），经 reviewer 确认"
  - Z3 收口标准 #3 增加正面指标："新增 internal HTTP 控制面接口数为 0，且现有接口有 deprecation 标注"

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| S1 | Z0 冻结全局边界、方法论、文档顺序 | done | 框架完整，charter-freeze / design-handoff 二分法清晰 |
| S2 | Z0 产出 design / action-plan / closure 文件清单 | done | 清单完整，撰写顺序合理 |
| S3 | Z1 新建 orchestration.auth（internal-only） | partial | 架构清晰，但与现有 auth.ts 集成关系未明确；Q1/Q2/Q3/Q4 未回答 |
| S4 | Z1 完整 end-user auth flow | partial | 范围合理，但 refresh token 存储机制未定义 |
| S5 | Z1 WeChat bridge | partial | 目标明确，但 Q3（自动建租户）未回答 |
| S6 | Z2 conversation/session/turn/message 落 D1 | partial | 表清单合理，但缺少具体 DDL；migration 策略未选择 |
| S7 | Z2 context snapshot 落 D1 | partial | 目标明确，但 snapshot 格式与存储频率未定义 |
| S8 | Z2 activity/audit truth 落 D1 | partial | Q5（单表 vs 拆表）未回答；activity log 具体字段未定义 |
| S9 | Z2 DO SQLite / Alarm / conversation 聚合最低集合 | partial | "最低集合"建议了 4 组但未具体化到表结构；Q6 未回答 |
| S10 | Z2 control-plane RPC kickoff（至少 1 条主方法双实现） | partial | Q7（首条方法）未回答；WorkerEntrypoint 技术可行性未在代码中验证 |
| S11 | Z3 Workers AI 进入主路径 | partial | 决策明确，但 adapter 架构设计缺失；Q8 未回答 |
| S12 | Z3 fake provider 退到 test/demo path | partial | 目标明确，但切换机制未定义（env var? config? runtime flag?） |
| S13 | Z3 quota allow/deny 成为 runtime truth | partial | Q9（是否覆盖 llm）未回答；gate 实现位置未明确 |
| S14 | Z3 usage/balance 写入 D1 | partial | 表清单合理，但缺少具体字段定义 |
| S15 | Z4 web thin client 完整 hardening | partial | 目标明确，但客户端代码位置未定义 |
| S16 | Z4 Mini Program 接入 | partial | 目标明确，但 Q10（transport baseline）未回答；客户端代码位置未定义 |
| S17 | Z4 WeChat login -> start -> input -> stream -> history 全链路 | partial | 依赖 Z1-Z3 全部完成，但缺少端到端测试策略 |
| S18 | Z4 gap triage + 修复 | partial | 目标明确，但 triage 方法论未定义 |
| S19 | Z4 延后 stateful work（双向 WS / IntentDispatcher / Broadcaster） | partial | 范围合理，但优先级未排序 |
| S20 | ZX-binding 冻结 6-worker binding matrix | done | 矩阵清晰，single-caller rule 明确 |
| S21 | ZX-binding control-plane RPC-first 顺序 | partial | 原则冻结，但 exact transport 未具体化；Q1/Q7 未回答 |
| S22 | ZX-D1 冻结 first-wave 表清单 | done | 表清单合理，thin-but-complete 口径把握得当 |
| S23 | ZX-D1 冻结 write ownership | partial | 原则正确，但每组的具体写入 worker 未完全明确 |
| S24 | ZX-LLM 冻结 Workers AI first + DeepSeek skeleton | done | 决策明确，required/optional 分层合理 |
| S25 | ZX-LLM 冻结 secret discipline | partial | 原则正确，但 Workers AI 无 per-tenant secret，与现有 registry 模型冲突 |
| S26 | ZX-NACP 冻结 authority / trace / session profile | done | 方向正确，与现有 nacp-core / nacp-session 一致 |
| S27 | ZX-NACP 冻结 evidence linkage | partial | 目标明确，但具体 payload 格式未定义 |
| S28 | ZX-QnA 收集并归档核心问题 | done | 问题收集完整，Reasoning 写得很好 |
| S29 | ZX-QnA 获得 owner 回答 | missing | Q1-Q10 全部未回答 |

### 3.1 对齐结论

- **done**: 11
- **partial**: 17
- **missing**: 1

> 这更像"核心骨架与决策框架已完成，但大量执行细节仍悬置在 QnA 和模糊空间中"，而不是可以立即进入 action-plan 的 completed 状态。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| O1 | 完整 admin plane | 遵守 | 各文件一致排除，Z1 只保留最小 me/tenant readback |
| O2 | 完整 API key admin plane | 遵守 | 一致排除，只保留最小 verify 路径（条件性 in-scope） |
| O3 | full stream-plane RPC-only retirement | 遵守 | 明确保留过渡 seam，Z4 才 inventory |
| O4 | cold archive / R2 offload | 遵守 | 一致排除 |
| O5 | full quota policy / ledger / alerts | 遵守 | 只保留 minimal truth，口径一致 |
| O6 | collaboration richness 全量化 | 遵守 | 一致排除 |
| O7 | tenant-facing admin UI / 自助控制台 | 遵守 | 一致排除 |
| O8 | platform-level observability dashboard | 遵守 | 一致排除 |
| O9 | NACP 之外的新协议家族 | 遵守 | ZX-NACP 明确排除 |
| O10 | billing / payment / invoice | 遵守 | Opus v2 和 charter 都明确排除 |

> Out-of-Scope 治理整体优秀，各文件口径一致，没有明显的 scope creep。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`zero-to-real 设计文档是方向正确、框架完整的蓝图，但当前状态是"决策框架已就绪，执行细节未冻结"。如果直接基于当前设计进入 action-plan，将面临：10 个核心决策悬置、多个设计-实现 gap 未诚实披露、收口指标过于定性。必须先完成 QnA 回答、补充缺失的 adapter/schema 细节、修正文件名 typo，才能进入 action-plan。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **完成 ZX-qna.md Q1-Q10 的 owner 回答**（最高优先级，阻塞 7 个核心模糊点）
  2. **修正 Z2 文件名 typo**：`Z2-session-truth-and-audit-baseline.md4` → `Z2-session-truth-and-audit-baseline.md`
  3. **在 ZX-llm-adapter-and-secrets.md 中增加 Workers AI adapter 架构设计**：说明如何在现有 `llm-wrapper` 框架内接入 `env.AI.run()`，包括 binding 配置、stream 映射、tool call degrade 策略
  4. **在 ZX-d1-schema-and-migrations.md 中增加 migration 策略与工具选择**：明确是采用 `wrangler d1 migrations` 还是 `nano_schema_version` 自动 migration，或两者结合
  5. **在 Z1 中明确与现有 orchestrator-core auth.ts 的集成关系**：现有 verify 是保留、迁移还是重写；JWT key 共享纪律
  6. **在 Z3 中明确 quota gate 的架构位置与覆盖范围**：是统一服务还是分散 hook；是否覆盖 llm call；Q9 回答后更新
- **可以后续跟进的 non-blocking follow-up**（可在 action-plan 阶段处理）：
  1. **增加每阶段的 rough LOC 与工期估算**：帮助资源规划
  2. **细化收口指标的量化标准**：如"DO SQLite 包含 N 张表""RPC 覆盖率 X%"等
  3. **定义 web client / Mini Program 的代码仓库位置**：`clients/web/`、`clients/mini-program/` 或独立仓库
  4. **在 Z4 中增加 gap triage 方法论**：分类标签、流程、evidence pack 结构
  5. **增加设计-实现 gap 的诚实披露**：每份文档的 §0 增加"当前代码真实起点"小节

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新文档。

## 附录 A：逐文件独立分析摘要

### A.1 Z0-contract-and-compliance-freeze.md

- **状态**：draft，治理层设计合理
- **盲点**：没有明确"设计文件何时冻结"的时间线；没有说明如果 QnA 答案与 charter 冲突的处理流程
- **断点**：无重大断点
- **模糊空间**：QnA 与 charter 的优先级关系未定义（虽然 charter 说"下游 design 若与本 charter 冲突，以本 charter 为准"，但如果 QnA 答案与 charter 冲突呢？）

### A.2 Z1-full-auth-and-tenant-foundation.md

- **状态**：draft，架构清晰
- **盲点**：refresh token 存储机制未定义（D1? KV?）；JWT claim 字段语义未完全对齐现有 `auth.ts`（如 `membership_level` 在代码中存在但在设计中未定义其取值范围）
- **断点**：与现有 `orchestrator-core/src/auth.ts` 的集成关系未明确
- **模糊空间**：最小 API key verify 的条件性 in-scope（"仅当 server-to-server ingress 确实需要"）——触发条件未定义

### A.3 Z2-session-truth-and-audit-baseline.md

- **状态**：draft（文件名有 typo），方向正确
- **盲点**：DO SQLite 与 D1 的数据一致性策略未定义（双写？失效？重建？）；activity log 的保留策略未定义
- **断点**：当前代码完全没有 DO SQLite 基础，Z2 需要大量重构
- **模糊空间**："至少 1 条 control-plane 主方法双实现可用"——验收标准是什么？旧 HTTP 路径和新 RPC 路径都通过同一测试即算？

### A.4 Z3-real-runtime-and-quota.md

- **状态**：draft，决策明确
- **盲点**：Workers AI 的模型选择未冻结（`@cf/meta/llama-3.1-8b-instruct`？还是其他？）；provider 失败后的重试策略未定义
- **断点**：现有 `llm-wrapper` 框架与 Workers AI 的适配方式未说明
- **模糊空间**："fake provider 退到 test/demo path"——切换机制未定义

### A.5 Z4-real-clients-and-first-real-run.md

- **状态**：draft，目标明确
- **盲点**：没有 Mini Program 的具体接口契约；没有"first real run evidence pack"的具体内容定义
- **断点**：代码库中完全没有客户端代码
- **模糊空间**："delayed stateful work"的范围不明确——Z2 未完成的部分 vs Z4 新发现的部分如何区分？

### A.6 ZX-binding-boundary-and-rpc-rollout.md

- **状态**：draft，原则清晰
- **盲点**：没有具体说明 WorkerEntrypoint RPC 的接口定义方式（TypeScript interface? Zod schema?）；没有说明如何在保持现有 fetch-backed HTTP 的同时并行引入 RPC
- **断点**：当前代码完全没有 WorkerEntrypoint RPC 的使用痕迹
- **模糊空间**："exact transport form 在本文档冻结"——但实际上只冻结了原则（WorkerEntrypoint RPC-first），没有冻结 exact transport 的具体接口签名

### A.7 ZX-d1-schema-and-migrations.md

- **状态**：draft，表清单合理
- **盲点**：没有具体的 SQL DDL；没有字段级定义；没有索引设计；没有视图的具体 SELECT 逻辑
- **断点**：代码中没有任何 D1 binding 或表定义
- **模糊空间**："write ownership 单一化"——identity 表由 auth worker 写，但 conversation 表是 orchestration.core 写还是 agent.core 写？未完全明确

### A.8 ZX-llm-adapter-and-secrets.md

- **状态**：draft，边界清晰
- **盲点**：没有 Workers AI adapter 的具体设计；没有 `env.AI` binding 的配置说明；secret cache 的 TTL 和失效策略未定义
- **断点**：代码中没有 Workers AI adapter
- **模糊空间**："optional DeepSeek adapter skeleton"——哪些文件/接口需要 skeleton？是只保留一个空文件，还是要实现完整的 adapter interface 但不 wire 到主路径？

### A.9 ZX-nacp-realization-track.md

- **状态**：draft，方向正确
- **盲点**：没有明确 "authority translation zone" 的具体代码位置；没有说明 `tenant_source: "deploy-fill"` 在 multi-tenant 动态化后的处理（当前 wrangler 中 TEAM_UUID 是 static）
- **断点**：当前代码中已有 `AuthSnapshot` 和 `InternalAuthorityPayload`，但设计文件要求它们成为"runtime truth"，这需要更多的 enforcement 代码
- **模糊空间**："transport legality"的具体检查点未完全枚举——控制面需要检查哪些字段？stream 面需要检查哪些？

### A.10 ZX-qna.md

- **状态**：draft answer register，问题收集完整
- **盲点**：缺少对 Z0-Z4 收口标准的 owner 确认（如"两个真实 tenant 的用户能独立登录"是否被 owner 接受为 Z1 的硬指标？）
- **断点**：全部 Q1-Q10 未回答
- **模糊空间**：如果 owner 对某个 Q 的回答与设计文件的当前倾向不一致，文档如何同步？

---

## 附录 B：全局拓扑分析

### B.1 阶段 DAG 合理性

```
Z0 -> Z1 -> Z2 -> Z3 -> Z4
```

- **Z0 -> Z1**：合理。必须先冻结边界，auth 才有明确的 scope。
- **Z1 -> Z2**：合理。session truth 依赖真实 identity / tenant。
- **Z2 -> Z3**：合理。但存在潜在并行空间：Z2 的 D1 schema 建立与 Z3 的 Workers AI adapter 开发可以部分并行，因为两者技术栈独立。
- **Z3 -> Z4**：合理。但 Z4 的 web client 开发可以与 Z3 部分并行（前端可以先 mock 后端接口）。
- **建议**：在 action-plan 中允许 Z2/Z3 部分并行，以及 Z3/Z4 的前端部分并行，以缩短总工期。

### B.2 跨阶段依赖强度矩阵

| 依赖方向 | 强度 | 说明 |
|----------|------|------|
| Z1 auth -> Z2 session | 强 | session 必须挂在真实 user/team 上 |
| Z2 D1 schema -> Z3 quota | 中 | quota 依赖 usage/balance 表，但 Workers AI adapter 不依赖 D1 |
| Z2 DO SQLite -> Z4 reconnect | 强 | reconnect 体验依赖 hot-state |
| ZX-binding -> Z1/Z2/Z3/Z4 | 中强 | 边界原则贯穿所有阶段，但 exact transport 只影响 Z1/Z2 |
| ZX-D1 -> Z1/Z2/Z3 | 强 | D1 是 Z1-Z3 的共享真相层 |
| ZX-LLM -> Z3 | 强 | 直接决定 Z3 的实现面 |
| ZX-NACP -> Z1/Z2/Z3 | 中强 | 协议合法性约束，但已有相当代码基础 |

### B.3 风险拓扑

**高风险路径**：
1. **Z1 auth worker + WeChat bridge**：技术复杂度中高，且需要外部依赖（微信开发者工具、小程序 AppID/Secret）
2. **Z2 DO SQLite uplift**：当前代码完全没有基础，需要重构 user DO 的存储层
3. **Z3 Workers AI adapter**：技术不确定性较高（Workers AI 的 stream 格式、工具调用支持）

**中风险路径**：
1. **Z2 control-plane RPC**：Cloudflare WorkerEntrypoint RPC 的成熟度
2. **Z4 Mini Program**：需要微信生态知识和调试环境

**低风险路径**：
1. **Z1 identity core D1 schema**：有 ddl-v170 作为参考
2. **Z3 usage/balance tables**：schema 简单
3. **ZX-NACP realization**：已有相当代码基础

### B.4 收口指标建议（量化版）

| 阶段 | 定性指标（原文） | 建议量化补充 |
|------|----------------|-------------|
| Z1 | 两个真实 tenant 的用户能独立登录 | 增加：login latency < 500ms；JWT verify 通过率 100%（negative test 100% reject） |
| Z1 | `orchestration.auth` 无 public route | 增加：port scan / route probe 验证只有 orchestration.core 可调用 |
| Z2 | session 结束后 history 仍可查询 | 增加：history API 返回最近 N 条 message 的 latency < 200ms |
| Z2 | user DO 的 hot-state 最低集合已成立 | 增加：DO SQLite 包含 4 张表（conversation_index, active_pointers, reconnect_hints, alarm_schedule） |
| Z2 | 至少 1 条主方法双实现可用 | 增加：`start` 方法同时有 HTTP 和 RPC 实现，且通过同一套 integration test |
| Z3 | agent loop 返回真实模型内容 | 增加：Workers AI 调用成功率 > 95%（7 天统计） |
| Z3 | quota allow/deny 成为 runtime truth | 增加：llm + tool 调用 100% 经过 quota gate；deny 事件 100% 写入 audit |
| Z4 | Web 与 Mini Program 都能完成连续真实 loop | 增加：端到端测试覆盖 login -> start -> input -> stream -> history；crash 率 < 1% |
| Z4 | 剩余 internal HTTP 已被压缩到明确的过渡 seam | 增加：列出所有剩余 seam 的 URL pattern、保留原因、计划退役时间 |

---

## 附录 C：已读取的代码位置清单

| 文件路径 | 行数 | 核查目的 |
|----------|------|----------|
| `workers/orchestrator-core/src/user-do.ts` | 788 | user DO 当前状态：KV storage、无 DO SQLite、fetch-backed internal HTTP |
| `workers/orchestrator-core/src/auth.ts` | 190 | JWT verify 逻辑、AuthSnapshot 定义 |
| `workers/orchestrator-core/src/index.ts` | 118 | public façade 路由、当前只有 `/sessions/*` |
| `workers/orchestrator-core/wrangler.jsonc` | 52 | 无 D1 binding，只有 AGENT_CORE service binding |
| `workers/agent-core/src/index.ts` | 129 | internal route 承接、legacy retirement |
| `workers/agent-core/src/host/internal.ts` | 179 | `/internal/sessions/*` 路由、validateInternalAuthority |
| `workers/agent-core/src/host/internal-policy.ts` | 252 | shared secret + authority + trace + no-escalation |
| `workers/agent-core/src/kernel/runner.ts` | 355 | kernel loop、llm call delegate、tool exec |
| `workers/agent-core/src/host/do/nano-session-do.ts` | 1602 | Session DO、tenant boundary、storage |
| `workers/agent-core/wrangler.jsonc` | 63 | 无 D1 binding，BASH_CORE service binding |
| `workers/bash-core/src/executor.ts` | 744 | beforeCapabilityExecute hook、capability execution |
| `workers/bash-core/wrangler.jsonc` | 46 | 无 D1 binding |
| `packages/llm-wrapper/src/gateway.ts` | 15 | stub — not implemented in v1 |
| `packages/llm-wrapper/src/adapters/openai-chat.ts` | 322 | fetch-based OpenAI adapter |
| `packages/llm-wrapper/src/registry/providers.ts` | 110 | provider registry，假设 baseUrl + apiKeys |
| `packages/nacp-core/src/transport/service-binding.ts` | 77 | ServiceBindingTransport 框架，未在 runtime 使用 |
| `packages/nacp-core/src/tenancy/boundary.ts` | 98 | verifyTenantBoundary，已在大规模使用 |
| `packages/nacp-core/src/envelope.ts` | 408 | NacpEnvelope 定义 |
| `packages/nacp-core/src/index.ts` | 262 | nacp-core 公共 API |
| `packages/nacp-session/src/index.ts` | 89 | nacp-session 公共 API |
| `workers/context-core/wrangler.jsonc` | 24 | 无 service binding |
| `workers/filesystem-core/src/storage/adapters/d1-adapter.ts` | ~150 | D1Adapter 封装，但只用于 filesystem |

---

*End of review — 2026-04-25 by Kimi (k2p6)*

---

## 8. 对 Kimi 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-25`
> 评价依据: `docs/eval/zero-to-real/Z0-ZX-design-docs-reviewed-by-kimi.md` §0–§5，尤其是 R1–R12 与 §3 In-Scope 对齐表

### 8.1 一句话评价评审风格

Kimi 这轮评审的风格是 **项目管理风险导向 + 实施落地导向**，很擅长从“如果现在直接开干，会在哪些地方低估工作量或失去交付锚点”这个角度找问题。


### 8.2 优点
1. 它对 **design-implementation gap** 的感知很强，能把“现在其实还没有 auth worker / D1 / Workers AI / client”这类现实直接翻译成 delivery risk，这对阶段排程很有帮助。
2. 它给出的很多建议都偏实操，例如 client 目录位置、Workers AI adapter 适配方式、quota gate 落点，这些都对后续 action-plan 拆分有直接帮助。


### 8.3 缺点
1. 它夹带了一些 **不够稳定的或已被事实推翻的问题**，例如文件名 typo 那条就是明显误报，这会拉低整体严谨性。
2. 个别建议越过了本轮 design absorption 的边界，比如 rough LOC / 工期估算，更像项目管理层 follow-up，而不是设计文档必须立刻冻结的内容。


### 8.4 对审查报告中的问题的清点

| 问题编号 | 原始严重程度 | 该问题的质量 | 分析与说明 |
|----|------|------|------------------|
| R1 | high | 高 | 对“设计语言掩盖了从零建设比例”的判断很有价值，直接推动了多个文档补 current reality。 |
| R2 | high | 中高 | 在审查当时成立，但高度依赖 owner 是否已回答 ZX-qna；因此它更像时效性 blocker，而不是长期设计质量问题。 |
| R3 | low | 低 | 这是明显误报；目标文件当时并不存在 `md4` 命名问题，因此这条不应计入有效 finding。 |
| R5 | high | 高 | 对 Workers AI adapter 如何接进现有 `llm-wrapper` 的提醒很实用，也确实是 design 必须冻结的桥接面。 |
| R6 | medium | 高 | 对 quota gate 只在 tool path 有现成 seam、LLM path 尚未落点的判断准确，且建议可执行。 |
| R8 | medium | 高 | 对 `clients/web/` / Mini Program 代码位置的提醒很务实，后来也直接被设计文档吸收。 |
| R10 | medium | 中高 | 对 migration tool/strategy 的要求合理，虽然更偏 implementation baseline，但对 D1 zero-base 项目依然有帮助。 |
| R12 | medium | 中等 | 对收口指标过于定性的判断成立，但它本身没有像 Opus 那样把可验证判定方法系统化到跨文档层。 |


### 8.5 评分 - 总体 ** 7 / 10 **

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 7 | 大部分问题有事实支持，但存在个别误报。 |
| 判断严谨性 | 6 | 方向多数正确，但混入了文件名 typo 这类不应出现的失准项。 |
| 修法建议可执行性 | 8 | 很多建议偏落地，直接可转成 design/action-plan 补丁。 |
| 对 action-plan / design 的忠实度 | 7 | 总体忠实，少数建议更像项目管理或实现阶段事项。 |
| 协作友好度 | 8 | 表达清晰，站在交付风险角度给反馈，协作感较强。 |
