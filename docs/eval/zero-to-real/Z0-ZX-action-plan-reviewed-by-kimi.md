# Zero-to-Real Action-Plan 完整审核报告

> 审查对象: `docs/action-plan/zero-to-real/Z0-Z5 全部 action-plan 文档`
> 审查时间: `2026-04-25`
> 审查人: `Kimi (k2p6)`
> 审查范围:
> - `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md`
> - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
> - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`
> - `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`
> - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md`
> - `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md`
> - `docs/design/zero-to-real/ZX-qna.md`（对照）
> - `docs/charter/plan-zero-to-real.md`（对照）
> - `docs/design/zero-to-real/*.md`（对照）
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`zero-to-real action-plan 包框架完整、执行路径清晰、Phase 切分合理、风险意识到位；但存在显著 gap——QNA Opus 附加条件大量未被吸收进执行计划，多个关键技术决策（model ID、client 技术栈、secret 命名约定）仍悬置，Z2 文件名 typo 未修正，导致执行者将不得不在实现期自行补决策，可能引发口径漂移。`
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. **QNA Q1-Q10 虽已回答，但 Opus 在每条回答中附加的 3-4 条硬约束大量未进入 action-plan**。这些约束散落在 QNA 的 Opus 最终回答段落中，如果执行者不回头细读 QNA 全文，会直接遗漏。
  2. **多个关键技术决策未冻结进 action-plan**：Workers AI 具体 model ID、web client 技术栈、email_password 是否同样自动建 team、secret 命名约定 `JWT_SIGNING_KEY_<kid>`、D1 migration 工具选择——这些决策都已由 QNA 或 Opus 回答做出，但未显式进入 action-plan 的执行路径。
  3. **Z2 设计文件名 typo 仍未修正**：`Z2-session-truth-and-audit-baseline.md4`，action-plan 中引用的文件名没有 typo，但执行者按 action-plan 去查找 design 文件时会发现路径不匹配。

---

## 1. 审查方法与已核实事实

### 1.1 对照文档

- `docs/charter/plan-zero-to-real.md` — 基石文件，冻结全局边界
- `docs/design/zero-to-real/Z0-Z4.md` + `ZX-*.md` — 10 份设计文档
- `docs/design/zero-to-real/ZX-qna.md` — 业主 QNA，Q1-Q10 已全部回答
- `docs/action-plan/zero-to-real/Z0-Z5.md` — 6 份执行计划（本次审查对象）
- `docs/templates/code-review.md` — 输出模板
- `docs/eval/zero-to-real/Z0-ZX-design-docs-reviewed-by-kimi.md` — 上轮设计文档 review

### 1.2 核查实现

- `workers/orchestrator-core/src/user-do.ts:657-689` — `forwardInternalRaw()` 仍使用 `https://agent.internal/internal/sessions/...` fetch-backed
- `workers/agent-core/src/llm/gateway.ts` — 仍标注 "Stub interface only — not implemented in v1"
- `workers/orchestrator-core/wrangler.jsonc` — 无 D1 binding，无 `AI` binding
- `package.json` — 测试脚本：`test:package-e2e`、`test:cross`、`test:cross-e2e`
- `test/` 目录 — 存在 package-e2e / cross-e2e 测试，但无 `orchestration-auth/` 子目录
- 无 `workers/orchestration-auth/`、无 `packages/orchestration-auth-contract/`、无 `clients/`、无 migrations 目录

### 1.3 执行过的验证

- `cat package.json | grep test` — 确认测试脚本名称（发现 `test:cross` 和 `test:cross-e2e` 同时存在）
- `find test/ -name "*.test.mjs" -o -name "*.test.ts"` — 确认测试结构
- `ls workers/orchestrator-core/migrations/ 2>/dev/null || echo "no migrations dir"` — 确认无 migrations 目录
- `ls packages/orchestration-auth-contract/ 2>/dev/null || echo "no auth-contract dir"` — 确认无 auth contract package
- `ls workers/orchestration-auth/ 2>/dev/null || echo "no auth worker"` — 确认无 auth worker
- `ls clients/ 2>/dev/null || echo "no clients dir"` — 确认无客户端目录
- `ls docs/design/zero-to-real/Z2*` — 确认 Z2 文件名存在 typo

### 1.4 已确认的正面事实

- **QNA Q1-Q10 已全部回答**：业主对每个问题都回答"同意 GPT 的推荐，同意 Opus 的看法"，design freeze 的重大 blocker 已解除。
- **Action-plan 框架优秀**：每份计划都有清晰的 Phase 结构，包含业务工作总表、Phase 详情、风险与依赖、收口标准。
- **Cross-cutting 依赖引用清晰**：每份 action-plan 都明确引用了 charter、design、ZX-qna、cross-cutting design。
- **执行顺序合理**：contract/schema → worker → flow → integration → closure 的顺序符合依赖 DAG。
- **风险意识到位**：每份 plan 都有"风险提醒"小节，识别了常见实施陷阱。
- **Z1 的 typed contract package 被明确提出**：`packages/orchestration-auth-contract/` 在 Z1 目录树和业务工作总表中被列为新增项，响应了 Q1 的 Opus 附加条件。
- **测试脚本实际存在**：`pnpm test:cross` 在 package.json 中确实存在（第10行），同时也有 `test:cross-e2e`（第15行）。

### 1.5 已确认的负面事实

- **QNA Opus 附加条件大量未进入 action-plan**：如 Q2 的 `JWT_SIGNING_KEY_<kid>` 命名、Q3 的 email_password 也自动建 team、Q5 的 12 列字段集、Q6 的容量上限、Q7 的两步走策略、Q8 的 model fc smoke gate、Q9 的 beforeLlmInvoke hook、Q10 的 heartbeat ≤25s 等。
- **缺少 Workers AI 具体 model ID**：Z3 action-plan 反复说"Workers AI first-wave model"，但没有指定具体 model。
- **缺少 client 技术栈选择**：Z4 action-plan 说新建 `clients/web/` 和 `clients/wechat-miniprogram/`，但没有说明技术栈。
- **缺少总工期估算**：虽然每 Phase 有工作量标记（XS/S/M/L），但没有 zero-to-real 整体工期估算。
- **Z2 设计文件名仍有 typo**：`Z2-session-truth-and-audit-baseline.md4`
- **package.json 中 `test:cross` 和 `test:cross-e2e` 同时存在**：两者指向相同的测试文件，存在冗余但未在 action-plan 中说明使用哪个。

---

## 2. 审查发现

### R1. QNA Opus 附加条件大量未被 action-plan 吸收

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - Q1 Opus 附加条件：必须创建 typed contract package（✓ Z1 已吸收）、fetch-binding shim 必须带 retire deadline = Z2 closure 前（✗ 未进 action-plan）
  - Q2 Opus 附加条件：JWT header 必须含 `kid`、secret 命名 `JWT_SIGNING_KEY_<kid>`、claim 集 `{user_uuid, team_uuid, team_plan_level, kid, iat, exp}`、access token 1h / refresh 30d（✗ 均未进 action-plan）
  - Q3 Opus 附加条件：email_password 路径同样自动建 default team（✗ Z1 只提到 WeChat 首登自动建 team，未明确 email_password）
  - Q4 Opus 附加条件：schema 建表 `nano_team_api_keys`、impl 不进 Z1（✗ Z1 action-plan 只说"Q4 已冻结 schema reserved"，未明确是否建表）
  - Q5 Opus 附加条件：12 列字段集（含 `actor_user_uuid`、`event_seq`、`severity`）、3 条强制 index、payload max 8KB、redaction 复用 `nacp-session/src/redaction.ts`（✗ 均未进 action-plan）
  - Q6 Opus 附加条件：容量上限（conversation_index ≤200、recent_frames ≤50/session、cache TTL ≤5min）、Alarm 周期 10min、重建 invariant 测试（✗ Z2 提到 "every 10m + alarm" 但未明确容量上限）
  - Q7 Opus 附加条件：两步走——先 `status` 作为 RPC scaffold smoke，再以 `start` 作为 closure proof（✗ Z2 只提到 `start` dual-impl，未提 `status` smoke）
  - Q8 Opus 附加条件：Workers AI model 必须经过 5+ tool invoke smoke、fc 失败自动 escalate DeepSeek、DeepSeek skeleton 落点 `workers/agent-core/src/llm/adapters/deepseek/`、`nano_tenant_secrets` 暂不建表（✗ 均未进 action-plan）
  - Q9 Opus 附加条件：Tool gate 复用 `beforeCapabilityExecute`、LLM gate 新建 `beforeLlmInvoke`、deny 必须写 `nano_session_activity_logs` + user-visible stream 抛 `QUOTA_EXCEEDED`（✗ 均未进 action-plan）
  - Q10 Opus 附加条件：heartbeat ≤25s、replay cursor 重连、HTTP input 必须携 session_uuid、Web → Mini Program 顺序约束（✗ Z4 未引用这些具体要求）
- **为什么重要**：QNA 是 design freeze 后的唯一决策来源。Opus 的附加条件是业主"同意 Opus 的看法"时一并接受的。如果这些条件不进入 action-plan，执行者要么遗漏（导致 closure 时通不过 review），要么自行发挥（导致口径漂移）。
- **审查判断**：这不是 action-plan 的质量问题，而是"design freeze → action-plan"的信息传递损耗问题。每份 action-plan 都应增加"QNA 条件吸收检查表"，确保 Opus 的硬约束被逐条映射。
- **建议修法**：
  - 在 Z1 §3 业务工作总表中增加：P1-03 "JWT kid + secret naming + claim set freeze"
  - 在 Z1 §4.4 中明确：email/password register 同样自动建 default team
  - 在 Z1 §4.1 中明确：`nano_team_api_keys` 建表但不实现 verify path
  - 在 Z2 §4.1 中增加 activity log 的 12 列字段集和 3 条强制 index
  - 在 Z2 §4.3 中增加容量上限和 TTL 约束
  - 在 Z2 §4.4 中增加"先 status RPC smoke，再 start dual-impl"的两步走策略
  - 在 Z3 §4.1 中增加 Workers AI model ID 和 fc smoke gate
  - 在 Z3 §4.3 中明确 quota gate 的具体落点（beforeCapabilityExecute + beforeLlmInvoke）
  - 在 Z4 §4.2/4.3 中增加 heartbeat ≤25s 和 replay cursor 的具体要求

### R2. Z2 设计文件名 typo 未修正

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：`docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md4` 多了一个 "4"
- **为什么重要**：action-plan 中引用的是正确文件名（如 Z2 action-plan §0 关联文档写的是 `Z2-session-truth-and-audit-baseline.md`），但执行者按此路径去查找 design 文件时会发现文件不存在。
- **审查判断**：应立即修正文件名，避免执行期路径查找失败。
- **建议修法**：重命名文件为 `Z2-session-truth-and-audit-baseline.md`

### R3. Workers AI 具体 model ID 未冻结

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - Z3 §1.2 Phase 1 说"把 `AI` binding、Workers AI first-wave model、preview secrets/bindings 冻结到代码与 wrangler"
  - Z3 §4.1 P1-01 说"把 Workers AI mainline 固定进配置与 registry"
  - 但全文没有出现任何具体 model ID（如 `@cf/meta/llama-3.1-8b-instruct`、`@cf/mistral/mistral-7b-instruct-v0.1` 等）
  - Q8 Opus 回答明确要求"Workers AI model fc smoke gate：first-wave model 必须经过 5+ tool 类型 invoke smoke 测试通过才能上线"
- **为什么重要**：如果不指定 model ID，Z3 Phase 1 的执行者需要自行选择。不同 Workers AI model 的 function-calling 能力差异巨大——如果选错 model，agent loop 中的 tool 调用会失败，而 Z3 的 quota gate、session stream mapping 都建立在 tool 调用能成功的基础上。
- **审查判断**：应在 Z3 action-plan 中明确 model ID，并增加 fc smoke 测试作为 Phase 1 的收口标准。
- **建议修法**：
  - 在 Z3 §4.1 中增加："First-wave model ID = `@cf/meta/llama-3.1-8b-instruct`（或 owner 批准的等价 model）"
  - 在 Z3 §4.1 收口标准中增加："model 必须通过 5+ tool 类型 invoke smoke 测试"

### R4. Web / Mini Program 客户端技术栈未选择

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - Z4 §1.5 目录树显示 `clients/web/` 和 `clients/wechat-miniprogram/`
  - 但没有说明 web client 使用什么技术栈（React? Vue? Vanilla JS? TypeScript?）
  - 没有说明 Mini Program 使用原生开发还是框架（如 Taro、uni-app）
  - 没有说明构建工具（Vite? webpack?）
- **为什么重要**：技术栈选择会直接影响：
  - 开发效率和维护成本
  - 与现有代码库的集成方式（如是否复用 `nacp-session` 的 TypeScript 类型）
  - 构建和部署流程
  - 团队技能要求
  - 如果不提前选择，Z4 Phase 1 开始时会先花 1-2 天讨论技术栈，延误主线
- **审查判断**：Z4 action-plan 应增加技术栈选择小节。
- **建议修法**：
  - 在 Z4 §0 或 §1.4 中增加：
    - web client：推荐 Vanilla TypeScript + Vite（最小依赖，最快启动），或 owner 批准的等价方案
    - Mini Program：推荐微信原生开发（最稳定，调试成本最低），或 owner 批准的等价方案

### R5. D1 migration 工具与策略未选择

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - Z1 §4.1 提到 "Wave A schema apply 成功"
  - Z2 §4.1 提到 "Wave B schema 可 apply"
  - Z3 §4.4 提到 "migration smoke / D1 assertions"
  - 但没有说明使用什么工具执行 migration（`wrangler d1 migrations create`? 手动 `wrangler d1 execute`? worker 启动时自动 migrate?）
  - 没有说明 migration 文件命名规范
  - 没有说明 rollback 策略
- **为什么重要**：D1 schema 是 zero-to-real 的基石。如果没有 migration 策略，团队可能：
  - 手动执行 SQL，容易出错且不可复现
  - 或每个 worker 各自实现 migration，导致不一致
- **审查判断**：应在 Z1 action-plan 中增加 migration 工具与策略小节。
- **建议修法**：
  - 在 Z1 §4.1 中明确：采用 `wrangler d1 migrations create` + `wrangler d1 migrations apply` 作为 manual path
  - 同时 worker 启动时运行 idempotent `migrate()` 做自动检查
  - 命名规范：`migrations/0001-identity-core.sql`、`migrations/0002-session-truth.sql`、`migrations/0003-usage-quota.sql`

### R6. Z1 中 email_password 注册是否自动建 team 未明确

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - Z1 §4.4 P4-02 说"email/password 与 WeChat 首登都自动建 default team + owner membership"
  - 但在 §3 业务工作总表中，P4-02 的描述是"自动建 default team + owner membership"，没有明确说 email/password 路径
  - Q3 Opus 回答明确要求"email_password 路径同样应用"（注册成功立即自动建 default team + membership）
- **为什么重要**：如果不明确，实现者可能只给 WeChat 路径建 team，不给 email/password 路径建。这会导致：
  - 两条 auth path 在 tenant 行为上分叉
  - Z2/Z3 的 tenant 隔离测试用例直接翻倍
  - NACP authority 中 `team_uuid` 可能出现 null（违反 Q3 Opus 的"team_uuid 必为非 null"不变规则）
- **审查判断**：应在 Z1 §3 和 §4.4 中明确 email/password register 同样自动建 team。
- **建议修法**：在 Z1 §3 业务工作总表 P3-01 或 P4-02 的描述中明确："email/password register 与 WeChat 首登都自动建 default team + owner membership"

### R7. Z1 中 auth worker 与现有 orchestrator-core auth.ts 的集成关系未明确

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `workers/orchestrator-core/src/auth.ts` 已有 190 行 JWT verify 逻辑
  - Z1 §4.2 P2-02 说"orchestrator 只做代理，不再 mint token"
  - 但没有说明 orchestrator-core 现有的 verify 逻辑是保留、迁移还是重写
  - 如果保留，orchestrator-core 的 verify 使用哪个 key？是共享 auth worker 的 `JWT_SIGNING_KEY_<kid>` 吗？
- **为什么重要**：如果不明确，可能出现两套 JWT verify 逻辑并存（orchestrator-core 本地 verify + auth worker verify），或出现不必要的重构。
- **审查判断**：应在 Z1 action-plan 中明确现有 auth 模块的命运。
- **建议修法**：
  - 在 Z1 §4.2 中增加一条："orchestrator-core 保留 JWT verify fast-path（减少 RPC 调用），但验证 key 与 auth worker 共享，使用同一 `JWT_SIGNING_KEY_<kid>` 集合"
  - 或："orchestrator-core 的 verify 完全委托给 auth worker 的 binding call，本地只保留 emergency fallback"

### R8. Z3 中 quota gate 实现位置与覆盖范围未明确到代码落点

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - Z3 §4.3 P3-01 说"为 llm 与 tool 建统一 quota authorizer / rejection path"
  - Z3 §4.3 P3-02 说"bash-core 执行前消费 quota decision"
  - 但没有明确：
    - llm gate 的代码落点在哪里？是在 `agent-core/src/kernel/runner.ts` 新增 hook，还是在 `llm-wrapper` 层？
    - tool gate 是否复用现有的 `beforeCapabilityExecute`？
    - quota authorizer 是独立 worker 还是 agent-core 内部模块？
  - Q9 Opus 回答明确要求：Tool gate 复用 `beforeCapabilityExecute`、LLM gate 新建 `beforeLlmInvoke`、两个 hook 都通过 NACP envelope 调 quota authorizer
- **为什么重要**：如果代码落点不明确，Z3 实现者会自创位置，可能导致：
  - llm gate 与 tool gate 形态不一致
  - quota 逻辑散落在多个位置，难以维护
  - deny 事件缺少统一的 audit trail
- **审查判断**：Z3 应明确 quota gate 的架构位置和接口形态。
- **建议修法**：
  - 在 Z3 §4.3 中增加：
    - Tool gate：复用 `workers/bash-core/src/executor.ts:203 beforeCapabilityExecute`，在 hook 内调用 quota authorizer
    - LLM gate：新建 `beforeLlmInvoke` hook，落 `workers/agent-core/src/kernel/runner.ts`，在 `handleLlmCall()` 开头调用
    - Quota authorizer：作为 `workers/agent-core/src/host/quota/` 内部模块（或独立 worker，视复杂度决定）
    - Deny 事件：统一写入 `nano_session_activity_logs`（`event_kind='quota.deny'`、`severity='warn'`）

### R9. Z4 中缺少 gap triage 的具体方法论

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - Z4 §4.4 P4-02 提到"将发现的问题分为 fixed / deferred / next-phase required"
  - 但没有定义 triage 的具体流程、分类标准、优先级判断规则
  - 没有定义 evidence pack 的具体内容模板
- **为什么重要**：真实客户端实验会产生大量问题（auth gap、WS bug、history 不一致、stream 中断等），没有分类标准会导致：
  - 紧急问题被压入 backlog
  - 低优先级问题被过度修复
  - 问题描述不一致，下一阶段无法接手
- **审查判断**：Z4 应增加 gap triage 方法论小节。
- **建议修法**：
  - 在 Z4 §4.4 或 §6 中增加：
    - 分类标签：`[blocker]`（阻止 first real run）、`[follow-up]`（可延后）、`[wont-fix-z4]`（超出 zero-to-real 范围）
    - Evidence pack 模板：环境、步骤、结果、失败、trace/session UUID、截图/日志摘要

### R10. Z2 中 RPC kickoff 策略未采纳 Opus 的两步走建议

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - Z2 §4.4 P4-01 说"先把 `status` 做成 RPC-first smoke"
  - Z2 §4.4 P4-02 说"让 `start` 开始走 RPC-first seam"
  - 但没有说明两者之间的关系和顺序
  - Q7 Opus 回答明确推荐两步走：
    1. Z2 中段：`status` 作为 RPC scaffold smoke（1-2 天）
    2. Z2 closure 标志：`start` dual-impl + golden parity test 通过
- **为什么重要**：`start` 是 session 生命周期中最复杂的方法（涉及 conversation 创建、session 创建、authority 注入、初始 stream 建立）。如果直接用 `start` 作为首条 RPC 方法，RPC 基础设施的 bug 会与 `start` 业务复杂性纠缠，增加调试难度。
- **审查判断**：Z2 应明确采纳 Opus 的两步走策略。
- **建议修法**：
  - 在 Z2 §1.2 或 §4.4 中明确：
    - Phase 4 分为两个子阶段：
      - 4a: `status` RPC scaffold smoke（验证 WorkerEntrypoint binding / envelope precheck / error path）
      - 4b: `start` dual-impl + parity test（closure 标志）
    - Parity 判定标准：返回 envelope deep-equal + D1 写入 row diff = ∅ + NACP authority/trace stamp 一致

### R11. Z3 中 Workers AI adapter 架构设计缺失

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - 现有 `llm-wrapper` 框架基于 `ChatCompletionAdapter` interface（`packages/llm-wrapper/src/adapters/types.ts`）
  - `OpenAIChatAdapter`（322 行）是 fetch-based，使用 `fetch()` 调用外部 HTTP API
  - Workers AI 使用 `env.AI.run()` platform binding，返回 `ReadableStream` 或对象，不是 HTTP Response
  - `ProviderRegistry`（`packages/llm-wrapper/src/registry/providers.ts`）假设 provider 有 `baseUrl` + `apiKeys`，但 Workers AI 不需要这些
  - Z3 action-plan 中没有说明如何在现有框架内接入 Workers AI
- **为什么重要**：Z3 的核心目标是"Workers AI first"，但 action-plan 没有详细说明如何在现有 `llm-wrapper` 框架内接入 Workers AI。如果不明确，实现者可能：
  - 绕过现有框架直接写 ad-hoc Workers AI 调用，破坏 adapter boundary
  - 或过度重构现有框架以适配 Workers AI，引入不必要的复杂度
- **审查判断**：Z3 应增加 Workers AI adapter 架构小节。
- **建议修法**：
  - 在 Z3 §4.1 或 §4.2 中增加：
    - 定义 `WorkersAiAdapter implements LlmAdapter`
    - 说明 `env.AI` binding 在 `wrangler.jsonc` 中的配置（`ai = { binding = "AI" }`）
    - 说明 Workers AI 返回的 stream 如何映射到 `LlmChunk`（content / usage / tool_calls）
    - 说明 Workers AI 不支持的工具调用如何在 kernel 中 graceful degrade

### R12. Z5 的输入依赖文件当前不存在

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - Z5 §0 关联文档引用了 `docs/issue/zero-to-real/Z0-closure.md` ... `Z4-closure.md`
  - 这些 closure 文件当前都不存在
  - Z5 §1.2 Phase 1 说"汇总 Z0-Z4 closure、tests、real-run evidence"
- **为什么重要**：Z5 的 closure 和 handoff 依赖于 Z0-Z4 的 closure 输出。如果 Z0-Z4 没有产出 closure，Z5 将无事可做。
- **审查判断**：这不是 action-plan 本身的问题，而是执行顺序的提醒。每份 action-plan 都明确列出了 closure 文档作为产出，只要按顺序执行就不会有问题。
- **建议修法**：无需修改 action-plan，但在 Z0 action-plan 中应强调"每份 closure 是下阶段的输入，不可跳过"。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| S1 | Z0 冻结全局边界、方法论、文档顺序 | done | 框架完整，charter-freeze / design-handoff 二分法清晰 |
| S2 | Z0 产出 Z1-Z5 的 cross-cutting dependency map | partial | 有依赖引用，但未形成显式的 dependency matrix 表格 |
| S3 | Z0 固定 root test scripts 与 closure 路径 | partial | 路径固定，但 test script 名称存在冗余（test:cross 与 test:cross-e2e 并存） |
| S4 | Z0 产出 Z0-closure.md | done | 收口标准清晰 |
| S5 | Z1 新建 orchestration.auth（internal-only） | partial | 架构清晰，但缺少 retire deadline（Q1 Opus 条件） |
| S6 | Z1 落 Wave A D1 schema | partial | 表清单合理，但缺少具体 DDL 和 migration 工具选择 |
| S7 | Z1 打通 register/login/verify/refresh/reset/me | partial | 范围合理，但缺少 `kid`、secret 命名、claim 集等具体决策（Q2 Opus 条件） |
| S8 | Z1 WeChat bridge + tenant bootstrap | partial | 目标明确，但 email/password 是否同样自动建 team 未明确（Q3 Opus 条件） |
| S9 | Z1 双租户 negative tests | done | 收口标准明确 |
| S10 | Z2 落 Wave B D1 schema | partial | 表清单合理，但缺少 12 列字段集和 3 条强制 index（Q5 Opus 条件） |
| S11 | Z2 public session durable truth | partial | 目标明确，但缺少 D1 与 DO 双写一致性策略 |
| S12 | Z2 DO hot-state 4 组最小集合 | partial | 有 4 组分类，但缺少容量上限、TTL、Alarm 具体动作（Q6 Opus 条件） |
| S13 | Z2 heartbeat / replay / reconnect | partial | 目标明确，但缺少 rebuild invariant 测试要求（Q6 Opus 条件） |
| S14 | Z2 RPC kickoff（至少 1 条主方法双实现） | partial | 缺少两步走策略：先 status smoke，再 start dual-impl（Q7 Opus 条件） |
| S15 | Z3 Workers AI 进入主路径 | partial | 决策明确，但缺少具体 model ID 和 adapter 架构设计 |
| S16 | Z3 fake provider 退到 test/demo path | partial | 目标明确，但切换机制未定义 |
| S17 | Z3 quota dual gate（llm + tool） | partial | 目标明确，但缺少具体代码落点（beforeCapabilityExecute + beforeLlmInvoke）（Q9 Opus 条件） |
| S18 | Z3 usage/balance 写入 D1 | partial | 表清单合理，但缺少具体字段定义 |
| S19 | Z4 web thin client 完整 hardening | partial | 目标明确，但缺少技术栈选择和客户端代码位置的具体约定 |
| S20 | Z4 Mini Program 接入 | partial | 目标明确，但缺少 heartbeat ≤25s、replay cursor 等具体要求（Q10 Opus 条件） |
| S21 | Z4 first real run evidence | partial | 目标明确，但缺少 evidence pack 模板和 gap triage 方法论 |
| S22 | Z4 residual HTTP inventory | partial | 目标明确，但缺少 inventory 模板 |
| S23 | Z5 汇总 Z0-Z4 closure、形成 verdict | done | 架构清晰，依赖关系合理 |
| S24 | Z5 输出 final closure 与 handoff | done | 输出路径明确 |
| S25 | Z5 归档 residual register | done | 分类标准明确 |

### 3.1 对齐结论

- **done**: 7
- **partial**: 18
- **missing**: 0

> 这更像"框架和方向已就绪，但大量 QNA 的硬约束还未被显式吸收到执行路径中"，而不是可以直接进入执行的状态。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| O1 | 完整 admin plane | 遵守 | 各文件一致排除 |
| O2 | 完整 API key admin plane | 遵守 | Z1 只保留 schema reserved，impl 不进（Q4 Opus 条件） |
| O3 | full stream-plane RPC-only retirement | 遵守 | 明确保留过渡 seam |
| O4 | cold archive / R2 offload | 遵守 | 一致排除 |
| O5 | full quota policy / ledger / alerts | 遵守 | 只保留 minimal truth |
| O6 | collaboration richness 全量化 | 遵守 | 一致排除 |
| O7 | tenant-facing admin UI | 遵守 | 一致排除 |
| O8 | platform-level observability dashboard | 遵守 | 一致排除 |
| O9 | billing / payment / invoice | 遵守 | 一致排除 |
| O10 | 完整 product UI polish | 遵守 | Z4 明确排除 |

> Out-of-Scope 治理整体优秀，各文件口径一致。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`zero-to-real action-plan 包是方向正确、框架完整的执行蓝图，当前状态是"Phase 结构已就绪，但 QNA 的硬约束还未被显式映射到执行路径"。如果直接基于当前 action-plan 进入执行，执行者需要频繁回头查阅 QNA 全文来补决策，效率低下且容易遗漏。必须先完成 QNA 条件的显式吸收、修正 Z2 文件名 typo、冻结关键技术决策，才能进入 Z0-Z5 的正式执行。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **在全部 action-plan 中增加"QNA Opus 条件吸收检查表"**：将 Q1-Q10 的 Opus 硬约束逐条映射到对应 action-plan 的 Phase/工作项/收口标准中（最高优先级）
  2. **修正 Z2 设计文件名 typo**：`Z2-session-truth-and-audit-baseline.md4` → `Z2-session-truth-and-audit-baseline.md`
  3. **在 Z3 action-plan 中冻结 Workers AI 具体 model ID**：并增加 fc smoke gate 作为 Phase 1 收口标准
  4. **在 Z1 action-plan 中明确 email/password register 同样自动建 default team**：避免 auth path 分叉
  5. **在 Z1 action-plan 中明确 JWT secret 命名约定**：`JWT_SIGNING_KEY_<kid>`、claim 集、access/refresh lifetime
  6. **在 Z3 action-plan 中明确 quota gate 的具体代码落点**：beforeCapabilityExecute（tool）+ beforeLlmInvoke（llm）+ deny 可观测路径
  7. **在 Z4 action-plan 中选择 client 技术栈**：web（Vanilla TS / React / Vue）和 Mini Program（原生 / Taro）
  8. **在 Z1 action-plan 中明确 D1 migration 工具与策略**：`wrangler d1 migrations` + 自动 idempotent migrate()
- **可以后续跟进的 non-blocking follow-up**（可在执行阶段处理）：
  1. **增加 zero-to-real 整体工期估算**：帮助资源规划
  2. **细化收口指标的量化标准**：如"DO SQLite 包含 N 张表""RPC 覆盖率 X%"等
  3. **统一 test script 名称**：`test:cross` 与 `test:cross-e2e` 冗余，建议统一
  4. **在 Z4 中增加 gap triage 方法论**：分类标签、流程、evidence pack 模板
  5. **在 Z5 中增加 completion audit checklist**：确保 Z0-Z4 closure 被系统性审计

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新文档。


---

## 附录 A：逐文件独立分析摘要

### A.1 Z0-contract-and-compliance-freeze.md（Action-Plan）

- **状态**：draft，执行入口设计合理
- **盲点**：没有明确"design freeze → action-plan"的信息传递机制（即如何确保 action-plan 吸收了 design 和 QNA 的全部内容）
- **断点**：无重大断点
- **模糊空间**："frozen input audit"的具体检查清单未提供——执行者需要一份 checklist 来核对 charter/design/QNA/代码/测试的冲突

### A.2 Z1-full-auth-and-tenant-foundation.md（Action-Plan）

- **状态**：draft，执行路径清晰
- **盲点**：缺少 Q2/Q3/Q4 的 Opus 硬约束；缺少 migration 工具选择；缺少现有 auth.ts 与 auth worker 的集成关系
- **断点**：无重大断点
- **模糊空间**：email/password register 是否自动建 team（Q3 Opus 条件）

### A.3 Z2-session-truth-and-audit-baseline.md（Action-Plan）

- **状态**：draft，方向正确
- **盲点**：缺少 Q5/Q6/Q7 的 Opus 硬约束（12 列字段集、容量上限、两步走策略）
- **断点**：当前代码完全没有 DO SQLite 基础，Z2 需要大量重构
- **模糊空间**：DO hot-state 的"最低集合"仍未具体化到表结构

### A.4 Z3-real-runtime-and-quota.md（Action-Plan）

- **状态**：draft，决策明确
- **盲点**：缺少 Q8/Q9 的 Opus 硬约束（model fc smoke gate、beforeLlmInvoke、deny 可观测路径）；缺少 Workers AI adapter 架构设计
- **断点**：现有 `llm-wrapper` 框架与 Workers AI 的适配方式未说明
- **模糊空间**："Workers AI first-wave model"未指定具体 model ID

### A.5 Z4-real-clients-and-first-real-run.md（Action-Plan）

- **状态**：draft，目标明确
- **盲点**：缺少 Q10 的 Opus 硬约束（heartbeat ≤25s、replay cursor、HTTP input 携 session_uuid）；缺少 client 技术栈选择
- **断点**：代码库中完全没有客户端代码
- **模糊空间**："gap triage"缺少具体方法论

### A.6 Z5-closure-and-handoff.md（Action-Plan）

- **状态**：draft，架构清晰
- **盲点**：依赖的 Z0-Z4 closure 文件当前不存在（预期中的，因为 Z0-Z4 尚未执行）
- **断点**：无重大断点
- **模糊空间**："completion audit"缺少具体 checklist

---

## 附录 B：全局拓扑分析

### B.1 阶段 DAG 合理性

```
Z0 -> Z1 -> Z2 -> Z3 -> Z4 -> Z5
```

- **Z0 → Z1**：合理。必须先冻结边界，auth 才有明确的 scope。
- **Z1 → Z2**：合理。session truth 依赖真实 identity / tenant。
- **Z2 → Z3**：合理。但存在潜在并行空间：Z2 的 D1 schema 建立与 Z3 的 Workers AI adapter 开发可以部分并行。
- **Z3 → Z4**：合理。但 Z4 的 web client 开发可以与 Z3 部分并行（前端可以先 mock 后端接口）。
- **Z4 → Z5**：合理。Z5 只能基于 Z4 的真实运行证据做 closure。
- **建议**：在 action-plan 中允许 Z2/Z3 部分并行，以及 Z3/Z4 的前端部分并行，以缩短总工期。

### B.2 Cross-cutting 依赖矩阵

| 依赖方向 | 强度 | 说明 |
|----------|------|------|
| ZX-qna → Z1/Z2/Z3/Z4 | 强 | Q1-Q10 的答案直接影响各阶段的技术决策 |
| ZX-binding → Z1/Z2 | 中强 | WorkerEntrypoint RPC-first 影响 auth 和 control-plane |
| ZX-D1 → Z1/Z2/Z3 | 强 | D1 schema 是 Z1-Z3 的共享真相层 |
| ZX-LLM → Z3 | 强 | 直接决定 Z3 的实现面 |
| ZX-NACP → Z1/Z2/Z3 | 中强 | 协议合法性约束 |
| Z1 closure → Z2 | 强 | Z2 需要真实 auth/tenant truth |
| Z2 closure → Z3 | 强 | Z3 需要 session/audit baseline |
| Z3 closure → Z4 | 强 | Z4 需要真实 runtime |
| Z4 closure → Z5 | 强 | Z5 需要真实运行证据 |

### B.3 QNA 条件吸收状态矩阵

| Q 编号 | Opus 硬约束数 | 已吸收数 | 吸收率 | 主要缺失 |
|--------|--------------|----------|--------|----------|
| Q1 | 2 | 1 | 50% | retire deadline |
| Q2 | 3 | 0 | 0% | kid、secret 命名、claim 集 |
| Q3 | 3 | 1 | 33% | email_password 同样自动建 team |
| Q4 | 3 | 1 | 33% | nano_team_api_keys 是否建表 |
| Q5 | 4 | 0 | 0% | 12 列字段集、3 条 index、redaction |
| Q6 | 3 | 1 | 33% | 容量上限、TTL、重建 invariant 测试 |
| Q7 | 2 | 0 | 0% | 两步走策略（status smoke + start dual-impl） |
| Q8 | 3 | 0 | 0% | model fc smoke gate、DeepSeek 落点、tenant_secrets 暂不建表 |
| Q9 | 3 | 0 | 0% | beforeLlmInvoke、deny 可观测路径、start admission |
| Q10 | 4 | 0 | 0% | heartbeat ≤25s、replay cursor、HTTP input 携 session_uuid、顺序约束 |
| **合计** | **30** | **4** | **13%** | — |

> QNA Opus 硬约束的整体吸收率仅约 13%，这是 action-plan 包的最大 gap。

### B.4 建议的吸收顺序

**最高优先级**（影响执行路径）：
1. Q2: JWT kid + secret 命名 → Z1 Phase 1
2. Q3: email_password 同样自动建 team → Z1 Phase 4
3. Q8: Workers AI model ID + fc smoke gate → Z3 Phase 1
4. Q9: quota gate 代码落点 → Z3 Phase 3

**高优先级**（影响收口标准）：
5. Q5: activity log 12 列字段集 → Z2 Phase 1
6. Q6: DO hot-state 容量上限 + TTL → Z2 Phase 3
7. Q7: RPC 两步走策略 → Z2 Phase 4
8. Q10: heartbeat + replay cursor 要求 → Z4 Phase 2/3

**中优先级**（影响文档完整性）：
9. Q1: retire deadline → Z1 Phase 2
10. Q4: nano_team_api_keys 是否建表 → Z1 Phase 1

---

## 附录 C：已读取的代码与文档位置清单

| 文件路径 | 行数/大小 | 核查目的 |
|----------|----------|----------|
| `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md` | 307 | Z0 action-plan |
| `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md` | 365 | Z1 action-plan |
| `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md` | 359 | Z2 action-plan |
| `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md` | 367 | Z3 action-plan |
| `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md` | 355 | Z4 action-plan |
| `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md` | 261 | Z5 action-plan |
| `docs/design/zero-to-real/ZX-qna.md` | 381 | QNA 全部回答 |
| `docs/charter/plan-zero-to-real.md` | 905 | 基石文件 |
| `docs/design/zero-to-real/Z0-Z4.md` + `ZX-*.md` | ~3000 | 设计文档 |
| `package.json` | 18 | 测试脚本确认 |
| `workers/orchestrator-core/src/user-do.ts:657-689` | — | fetch-backed internal HTTP 现状 |
| `workers/agent-core/src/llm/gateway.ts` | 15 | stub 状态 |
| `workers/orchestrator-core/wrangler.jsonc` | 52 | 无 D1/AI binding |

---

*End of review — 2026-04-25 by Kimi (k2p6)*
