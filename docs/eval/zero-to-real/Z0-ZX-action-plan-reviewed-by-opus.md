# Nano-Agent 代码审查 — `zero-to-real` action-plan pack（Z0-Z5）

> 审查对象: `docs/action-plan/zero-to-real/Z0-Z5 全部 6 份执行计划文档`
> 审查时间: `2026-04-25`
> 审查人: `Opus 4.7 (1M context)`
> 审查范围:
> - `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md`
> - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
> - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`
> - `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`
> - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md`
> - `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

> 一句话 verdict：**这套 action-plan 已经把 charter / design / QnA 真实压成了"明天可以开干"的执行包，但有 5 个高优级断点会让实际执行偏离已经冻结的设计——尤其是 `nano_session_*` 与 `nano_conversation_*` 表名分叉、`test:cross` 脚本含义错配、Workers AI model ID 仍然未冻结这三件事，会在 Z2/Z3 实施期立刻翻锅。**

- **整体判断**：`approve-with-followups (Grade: B+)` — 比 design pack 更具体（每份都有 phase 表 + work item 编号 + 测试方式 + 收口标准），文件路径 ≥95% 锚定真实代码现实，QnA 已确认的 owner 决策（Q1-Q10 全部同意）也已被消费；但 5 个高优级 finding 中的任意一个不修都会在实施期立即返工。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 3 个判断**：
  1. **`nano_session_*` vs `nano_conversation_*` 表名层级分叉**（R2）：Z2 action-plan 用 `nano_sessions / nano_session_turns / nano_session_messages / nano_session_contexts`，但 ZX-D1 §5.1 S2 冻结的是 `nano_conversations / nano_conversation_sessions / nano_conversation_turns / nano_conversation_messages`——后者有 conversation 上位聚合层，前者直接拍平到 session。这是阶段性语义漂移，必须在 Z2 实施前先回头对齐 ZX-D1。
  2. **`test:cross` 脚本含义错配**（R1）：根 `package.json:10` 的 `test:cross` 实际等价于 `node --test test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs`（**两者都跑**）；但 Z1-Z5 的 5 处 "pnpm test:package-e2e && pnpm test:cross" 把 `test:cross` 当作 cross-e2e-only 用——一旦实施期发现，phase closure 标准里全部"跑两套"就会在心智上变成"跑了三套（两次 package-e2e + 一次 cross-e2e）"。这不是测试错，是**收口判据错**。
  3. **Workers AI model ID 仍然未冻结**（R5）：Z3 P1-01 收口标准 = `不再存在"mainline provider 未定"的口径`，但 `workers/agent-core/wrangler.jsonc` 与 `src/llm/registry/{providers,models}.ts` 里到底冻结哪个 `@cf/...` 模型，6 份 action-plan 与 ZX-LLM 0 处提及。这是 design review R4 在 design pack 留下的洞，action-plan 没有补上——Z3 P1 实施者还是要回头问。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-zero-to-real.md`（基石）
  - `docs/design/zero-to-real/{Z0-Z4 + ZX-binding + ZX-d1-schema + ZX-llm-adapter + ZX-nacp-realization + ZX-qna}.md`
  - `docs/eval/zero-to-real/Z0-ZX-design-docs-reviewed-by-opus.md`（我自己 design 阶段的 review）
  - `docs/templates/{action-plan.md, code-review.md}`
- **核查实现**：
  - `workers/{agent-core,bash-core,context-core,filesystem-core,orchestrator-core}/src/**`
  - `workers/orchestrator-core/src/{auth,index,user-do}.ts` + `src/policy/authority.ts`
  - `workers/agent-core/src/{eval,hooks,host,kernel,llm,index.ts}/**`
  - `workers/bash-core/src/{executor,tool-call,policy,capabilities}/**`
  - `packages/{nacp-core,nacp-session}/src/**`
  - `test/{shared,cross-e2e,package-e2e/orchestrator-core,package-e2e/agent-core,package-e2e/bash-core}/**`
  - `package.json` test scripts
- **执行过的验证**：
  - `wc -l docs/action-plan/zero-to-real/*.md` → 总计 2014 行（Z0=307, Z1=365, Z2=359, Z3=367, Z4=355, Z5=261）。
  - `ls workers/orchestrator-auth/` → **不存在**（与 Z1 一致；新建 worker）。
  - `find workers -name "migrations" -type d` → **0 命中**（所有 wave-A/B/C migrations 都是新建）。
  - `find workers -name "wrangler.jsonc"` → 5 个（agent/bash/context/filesystem/orchestrator-core 各一份，无 orchestrator-auth）。
  - `ls workers/agent-core/src/llm/registry/` → `loader.ts / models.ts / providers.ts` ✓
  - `ls workers/agent-core/src/host/do/` → `nano-session-do.ts` ✓
  - `ls workers/agent-core/src/host/` → 包含 `checkpoint.ts / eval-sink.ts / internal.ts / routes.ts / session-edge.ts / ws-controller.ts` ✓（Z2/Z3 全部引用都存在）
  - `ls workers/agent-core/src/kernel/` → 包含 `runner.ts / session-stream-mapping.ts` ✓
  - `ls workers/agent-core/src/llm/` → 包含 `gateway.ts / session-stream-adapter.ts / executor.ts / request-builder.ts / canonical.ts / registry/` ✓
  - `ls workers/orchestrator-core/src/` → `auth.ts / index.ts / user-do.ts / policy/authority.ts` ✓
  - `ls workers/bash-core/src/` → 包含 `executor.ts / tool-call.ts / policy.ts / capabilities/` ✓
  - `grep -n "test:cross\|test:package-e2e" package.json` → `test:cross` = `node --test test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs`（**重要：包含 package-e2e**）；`test:cross-e2e` 才是 cross-only。
  - `ls test/package-e2e/orchestrator-core/` → 包含 `02-session-start / 04-reconnect / 05-verify-status-timeline / 06-auth-negative` ✓（Z1/Z2 引用都存在）
  - `ls test/cross-e2e/` → 11 个 numbered tests，含 `02-agent-bash-tool-call-happy-path / 09-capability-error-envelope-through-agent / 11-orchestrator-public-facade-roundtrip` ✓
  - `ls test/shared/` → `live.mjs / orchestrator-auth.mjs / orchestrator-jwt.mjs` ✓（Z1 P3-02 引用全部存在）
  - `ls test/package-e2e/orchestrator-auth/` → **不存在**（与 Z1 [new] 标记一致）

### 1.1 已确认的正面事实

- **F+1**：6 份 plan 全部严格遵循 `docs/templates/action-plan.md` 结构（§0 / §1 / §2 / §3 / §4 / §5 / §6 / §7 / §8）；§3 业务工作总表与 §4 phase 业务表格的编号体系一致（P1-01 / P2-01 ...）。
- **F+2**：QNA 全部 10 个 owner answer 已正确消费——Q1（WorkerEntrypoint RPC-first + typed contract package）落在 Z1 P1-01；Q2（HS256 + kid + dual verify）落在 Z1 P3-02；Q3（自动建 default team）落在 Z1 P4-02；Q5（单 append-only activity log）落在 Z2 P2-02；Q6（4 组热态 + 10m alarm）落在 Z2 P3-01/P3-02；Q7（status smoke 先 + start 后续）落在 Z2 P4-01/P4-02；Q8（Workers AI required + DeepSeek skeleton）落在 Z3 P1-01；Q9（llm + tool 双 gate）落在 Z3 P3-01/P3-02；Q10（HTTP-in/WS-out + web 先 mini-program 后）落在 Z4 Phase 1/2 顺序。
- **F+3**：所有 worker 文件路径引用 ≥95% 与真实仓库结构对齐。Z2 引用的 `host/{checkpoint,eval-sink,internal,routes,session-edge,ws-controller}.ts` + `kernel/runner.ts` + `host/do/nano-session-do.ts` 全部 `ls` 命中；Z3 引用的 `llm/registry/{providers,models}.ts` + `bash-core/src/{executor,tool-call,policy}.ts` + `agent-core/src/llm/session-stream-adapter.ts` + `kernel/session-stream-mapping.ts` 全部 `ls` 命中。零臆造路径。
- **F+4**：每份 plan 的 Phase 总览表都给出工作量估值（XS/S/M/L/XL）与依赖前序，phase ordering 严格遵守 charter §6 Z0→Z5 顺序，没有偷渡跨阶段依赖。
- **F+5**：Z1 P1-01 已显式承担 `packages/orchestrator-auth-contract/` typed contract package（这是我 Q1 Opus 第二意见的硬约束之一）——证明 owner 同意了的 Opus 推荐已被吸收。
- **F+6**：Z1 P2-01 列出新 worker 需要的 env vars 清单 `PASSWORD_SALT / WECHAT_APPID / WECHAT_SECRET / JWT_SIGNING_KEY_<kid>`——这正面回应了我 design review R5（WeChat 凭证落点）与 Q2（kid 命名约定）。
- **F+7**：Z2 P4-01/P4-02 显式采用"先 status smoke 再 start parity"两步走（与我 Q7 Opus 第二意见一致），不是 charter/Q7 原始的"一次到位 start 双实现"。证明 owner 同意的 Opus 修正路径已被纳入。
- **F+8**：Z2 / Z4 都引入了 evidence pack 概念——Z2 §1.4 提及 `每 10m + alarm` checkpoint 的 evidence sink；Z4 P4-01 创建 `docs/eval/zero-to-real/first-real-run-evidence.md`。这把"靠跑通"的不可观测 closure 部分转成了文档资产。
- **F+9**：Z5 §6 风险表把"阶段完成度被高估"列为风险并要求"以 tests/evidence/charter exit criteria 复核，而非信任摘要"——这是健康的 closure-against-evidence 纪律。

### 1.2 已确认的负面事实

- **F-1**：`grep -n "test:cross" package.json` → `test:cross` = `node --test test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs`（**两个 suite 都跑**）；`test:cross-e2e` 才是 cross-e2e-only。Z1 P5-01（行 192）/ Z2 P5-01（行 187）/ Z3 P5-01（行 191）/ Z4 P5-01（行 185）/ Z5 §1.4 都使用 `pnpm test:package-e2e && pnpm test:cross` 模式——后者已经包含前者，是冗余 + 误导。
- **F-2**：`grep -n "nano_conversations\|nano_conversation_sessions" docs/action-plan/zero-to-real/*.md` → **0 命中**。Z2 全文使用 `nano_sessions / nano_session_turns / nano_session_messages / nano_session_contexts / nano_session_activity_logs`（5 张表，session 为顶层）。但 ZX-D1 §5.1 S2 冻结的是 `nano_conversations / nano_conversation_sessions / nano_conversation_turns / nano_conversation_messages`（4 张表，conversation 为顶层 + session 为子层）。**两份文档表名树拓扑不一致**。
- **F-3**：`grep -n "nano_usage_events\|nano_usage_ledger" docs/action-plan/zero-to-real/*.md` → Z3 P4-01 用 `nano_usage_ledger`（行 184）；ZX-D1 §5.1 S5 冻结为 `nano_usage_events / nano_quota_balances`。又一次表名分叉。
- **F-4**：`find workers -name "migrations" -type d` → 0 命中。但 Z1 P1-02 / Z2 P1-01 / Z3 P4-01 都把 migrations 放在 `workers/orchestrator-core/migrations/`——而 ZX-D1 §3.2 / §7.2 F1 说 `所有身份写入权集中在 auth worker`（即 orchestrator.auth）。**所有 migrations 在 orchestrator-core 而身份写入在 orchestrator-auth**——deploy ordering 与 owner 责任链不一致。
- **F-5**：`grep -n "@cf/\|model.*ID\|llama\|qwen\|deepseek" docs/action-plan/zero-to-real/*.md` → 仅 1 处（Z3 §6 风险表的 "Workers AI 配置与配额不稳定"），无具体 model ID。Z3 P1-01 收口标准 = "不再存在 'mainline provider 未定' 的口径"，但本身没冻结 model ID。
- **F-6**：`grep -n "wrangler d1 migrations\|wrangler d1\|migration apply" docs/action-plan/zero-to-real/*.md` → Z1 P1-02 与 Z2 P1-01 使用 "migration apply smoke" / "migration smoke" 但**未指定工具**（`wrangler d1 migrations apply`? 自定义 script? `pnpm migrate`?）。
- **F-7**：Z1 §1.4 directory tree（行 99）列出 `workers/orchestrator-auth/wrangler.jsonc [new]`，但 Z1 P2-01 收口标准与 §5.2 都没有指明该 wrangler 的 D1 binding 是 `NANO_AGENT_DB`（同一个 D1 实例）还是独立 binding。Z1 P3-02 收口标准也只说 "refresh state 进入 nano_auth_sessions"——没说该表是哪个 worker 的 D1 binding 名。
- **F-8**：`grep -n "shim retire\|retire deadline\|fetch-binding shim" docs/action-plan/zero-to-real/*.md` → 仅 Z1 §6 风险表（行 344）的"保留 fetch-binding shim 过渡路径，但在 Z1 closure 中写明 retire deadline = Z2 closure 前"——这是我 Q1 Opus 第二意见的核心约束，**只在 Z1 出现一次，Z2/Z3 都没有 enforce 这条 retire deadline**。Z2 P4-02 收口标准 = "public start 与 internal start 共享同一 durable truth"——比"shim 已退役"弱。
- **F-9**：`grep -n "byte-equal\|deep-equal\|parity" docs/action-plan/zero-to-real/*.md` → 0 命中"byte-equal" / "parity test" / 类似硬指标。Z2 P4-02 仅说"first-wave kickoff"——比我 Q7 Opus 推荐的 parity proof（envelope deep-equal + D1 row diff = ∅ + authority/trace stamp 一致）弱很多。
- **F-10**：`grep -n "framework\|React\|Vue\|Svelte\|Taro\|uni-app" docs/action-plan/zero-to-real/*.md` → 0 命中。Z4 P1-01 与 P2-01 都说"建 minimal client baseline"但**未指定前端栈**（web 用什么 framework？mini-program 用 native MP / Taro / uni-app？）——这两个选择都会显著影响 build pipeline 与维护成本。
- **F-11**：Z3 §1.4 directory tree（行 88-103）列 `workers/agent-core/src/host/quota/**`（建议性，"可新增"）作为 quota authorizer 落点；但我 Q9 Opus 第二意见推荐 LLM gate 落 `workers/agent-core/src/kernel/runner.ts`（命名 `beforeLlmInvoke`，对称于 bash-core 的 `beforeCapabilityExecute`）。Z3 P3-01 详情没有指认具体 hook 函数名也没有指认具体 invoke point——quota 落点仍然 fuzzy。
- **F-12**：`grep -n "event_kind='quota.deny'\|event_kind=quota\|quota\\.deny" docs/action-plan/zero-to-real/*.md` → 0 命中。我 Q9 Opus 推荐的 "deny 必须写 nano_session_activity_logs 一行 event_kind='quota.deny' severity='warn'" 在 Z3 P4-02 中只描述为"accepted/rejected runtime decisions 可回放"——具体 event_kind / severity 字段值未指定。
- **F-13**：Z2 P1-01 工作内容：`依据 ZX-D1 落 session / turn / message / context / activity tables 与索引`——但 ZX-D1 自身（按 design review R2 still partial）也没列字段。这是**链式延迟**：action-plan 依赖 design 给字段，design 依赖 Q5 给字段，Q5 已答复（owner 同意 GPT + Opus 推荐 12 列结构），但**没有任何文档把这 12 列正式写进 ZX-D1 §7**——action-plan 实施者还得回去找。
- **F-14**：Z0 `actually freeze 了什么` 的实质内容很薄。§3 业务工作总表（行 134-141）的 6 个 work item 全部是"audit / mapping / freeze"类元工作；P1-01/P1-02/P2-01/P2-02/P3-01/P4-01 的"涉及文件 / 模块"全部是 `docs/**` 而非任何 `workers/**` 或 `packages/**`。Z0 不写代码 OK，但 7 个 review R3-R5 留下的具体冻结项（model ID、D1 binding 名、migration tool）**Z0 也没冻结**——它做了"已经 freeze 的 audit"而不是"补 freeze"。
- **F-15**：Z5 P1-02 工作内容："对照 charter primary exit criteria 逐条判断"——但 `docs/charter/plan-zero-to-real.md §10` 没有一份显式编号的 "primary exit criteria 清单"（§10 是叙述性的"完成态 / 下一阶段"）。Z5 audit 的 ground truth 不存在，等于打靶时没靶子。

---

## 2. 审查发现

> 编号 R1 起，按 severity + 影响范围排序。每条 finding 都附 file:line / grep / ls 事实依据。

### R1. `pnpm test:cross` 脚本含义错配，Z1-Z5 五处收口判据被这个错配污染

- **严重级别**：`high`
- **类型**：`correctness` + `delivery-gap`
- **事实依据**：
  - `package.json:10` `"test:cross": "node --test test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs"` —— **同时跑两套 suite**。
  - `package.json:14` `"test:package-e2e"` —— 只跑 package-e2e。
  - `package.json:15` `"test:cross-e2e"` —— 只跑 cross-e2e（这才是 plan 里"cross"实际想要的）。
  - Z1 P5-01（行 192）："`pnpm test:package-e2e` / `pnpm test:cross`" 列在测试方式。
  - Z2 P5-01（行 187）："`pnpm test:package-e2e` / `pnpm test:cross`"。
  - Z3 P5-01（行 191）："`pnpm test:package-e2e && pnpm test:cross`"。
  - Z4 P5-01（行 185）/ §5.5 测试安排："`pnpm test:package-e2e && pnpm test:cross`"。
  - Z5 §1.4 "复用 `pnpm test:package-e2e` / `pnpm test:cross`"。
- **为什么重要**：
  - 实施期任何运行 `pnpm test:package-e2e && pnpm test:cross` 的人都会**跑两遍 package-e2e**——一次显式、一次被 test:cross 隐式包含。如果 package-e2e 含 stateful side-effect（preview deploy / DB 重置），重复运行可能触发奇怪状态。
  - 但更严重的是 closure 心智被污染：plan 作者意图是"跑专属 cross-e2e 来证明 cross-worker 行为 ok"，实际 `test:cross` 是 superset，无法区分"package-e2e 通过"与"cross-e2e 通过"的独立信号。Z2 P5-01 收口标准 = "replay / timeline / activity 都有 green proof" 在脚本错配下**无法证明 cross 部分独立成立**。
  - Z5 P1-01 audit 也会出错：审计员看 "test:cross 通过" 实际等于 "package-e2e 通过 + cross-e2e 通过"，但 charter exit criteria 可能特别看 cross-e2e。
- **审查判断**：这是 5 处 phase closure 标准里同时存在的同型缺口，必须统一替换为 `test:cross-e2e`。
- **建议修法**：
  1. 把 Z1-Z5 五处 `pnpm test:cross` 全部替换为 `pnpm test:cross-e2e`（专跑 cross-e2e）。
  2. 整体回归用 `pnpm test:e2e` 或 `pnpm test:cross`（两者等价，跑全部）做 catch-all。
  3. Z0 P3-01 validation baseline freeze 增加一句明确："`pnpm test:package-e2e` = package 内独立验证；`pnpm test:cross-e2e` = cross-worker 独立验证；`pnpm test:cross` / `pnpm test:e2e` = 同义全量回归。"

### R2. `nano_session_*` (Z2) 与 `nano_conversation_*` (ZX-D1) 表名树拓扑分叉

- **严重级别**：`high`
- **类型**：`scope-drift` + `correctness`
- **事实依据**：
  - `Z2-session-truth-and-audit-baseline.md` §2.1 S1（行 113）："落 Wave B D1 schema：`nano_sessions / nano_session_turns / nano_session_messages / nano_session_contexts / nano_session_activity_logs`"——5 张表，session 为顶层。
  - `Z2 §3 业务工作总表` P1-01（行 142）描述同上。
  - `ZX-d1-schema-and-migrations.md` §5.1 S2（行 173）："会话核心：`nano_conversations / nano_conversation_sessions / nano_conversation_turns / nano_conversation_messages`"——4 张表，**conversation 为顶层、session 为子层**。
  - `ZX-d1 §3.4 聚合点`（行 117-119）："聚合对象：identity core、conversation core、activity/audit、usage/quota；以 conversation 为上位聚合中心"——design 显式选择两层结构。
  - `ZX-d1 §6.1 取舍 2`（行 204-206）："conversation 作为聚合中心 而不是 继续只按 session_uuid 思考"——这是 design 已经辩证后的取舍，action-plan 直接绕过了。
- **为什么重要**：
  - Z4 客户端的 `history / list / reconnect` 都按 `conversation_uuid` 聚合（design Z2 §6.1 取舍 2 的明确决定）。如果 Z2 实际落表只有 `session_uuid` 顶层，Z4 实施者会被迫现挖一层 conversation——Z2 closure 通过、Z4 实施期立即失败。
  - 这影响 ZX-NACP §7.1 F4 evidence linkage："llm/tool/quota/history/audit 都能挂到同一 trace/session/team"——design 默认 trace 通过 conversation 关联，action-plan 拆掉 conversation 这一层后，跨 session 的同一对话场景无法被 evidence 串起来。
  - Z2 P1-01 的 5 张表里多了一张 `nano_session_contexts`（design 是 `nano_conversation_context_snapshots`）——再次拍平后 context 与 conversation 失联。
- **审查判断**：这是 action-plan 与 design 之间最大的语义漂移。**实施前必须回头修一个**：要么 action-plan 改回 conversation 层级，要么 ZX-D1 反向修订（但 design review R2 已经说 design 是对的方向）。
- **建议修法**：
  - Z2 §2.1 S1 表名改回 `nano_conversations / nano_conversation_sessions / nano_conversation_turns / nano_conversation_messages / nano_conversation_context_snapshots / nano_session_activity_logs`（最后一张 activity log 仍然以 session 为粒度，因为它是 trace-wise 的）。
  - Z2 §3 P1-01 与 §4.1 同步更新表名。
  - Z2 P2-01 工作内容显式指出"start 时若该 user 无 active conversation 则先建 conversation 再建 session"——这是双层结构必需的实现细节。

### R3. `nano_usage_ledger` (Z3) vs `nano_usage_events` (ZX-D1) 表名分叉

- **严重级别**：`high`
- **类型**：`scope-drift`
- **事实依据**：
  - `Z3-real-runtime-and-quota.md` P4-01（行 184，§4.4）："落 `nano_usage_ledger`、quota balance/read model 等 durable tables"。
  - `Z3 §5.4 详情`（行 285-286）：同样使用 `nano_usage_ledger`。
  - `ZX-d1-schema-and-migrations.md` §5.1 S5（行 176）："quota 核心：`nano_usage_events / nano_quota_balances`"。
  - `ZX-d1 §3.2`（行 107）："`nano_usage_events` / `nano_quota_balances`"。
- **为什么重要**：
  - "events" 是 append-only 事件流（每次 LLM/tool 调用一行），"ledger" 在金融语境通常指 double-entry 账本（借方/贷方）——两者建模不同。
  - design 选 events 是因为 charter 与 ZX-LLM 都说"first-wave 不做 ledger / billing 大工程"（OoS）。action-plan 用 ledger 名字会让实施者误以为要做 ledger 风格 schema（reference table、credit/debit columns、period closing），实际只需 append-only 事件。
- **审查判断**：表名错配会直接导致 schema 实现层语义偏离。低成本修法。
- **建议修法**：
  - Z3 §3 P4-01、§4.4 P4-01、§5.4 详情统一改为 `nano_usage_events / nano_quota_balances`，与 ZX-D1 一致。
  - 如果 owner 的确想用 ledger 概念，需先回去修 ZX-D1（但 ledger 是 OoS，不应回修）。

### R4. Identity migrations 的 worker 归属与 design 的 write owner 分叉

- **严重级别**：`high`
- **类型**：`scope-drift` + `delivery-gap`
- **事实依据**：
  - `Z1 §3 P1-02`（行 146）：`涉及模块 / 文件 = workers/orchestrator-core/migrations/001-identity-core.sql`——migrations 落在 orchestrator-core。
  - `Z2 §3 P1-01`（行 142）：`workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`——同样在 orchestrator-core。
  - `Z3 §3 P4-01`（行 151）：`workers/orchestrator-core/migrations/003-usage-and-quota.sql`——同样在 orchestrator-core。
  - `ZX-d1-schema-and-migrations.md §3.2`（行 107）：`identity providers | nano_user_identities.provider | email_password + wechat | 更多 providers`，且 §3.4 + §6.1 取舍 3 都明确"write ownership 单一化"。
  - `ZX-d1 §7.2 F1`（行 244-251）：`Identity Core | 主要调用者 = orchestrator.auth | 核心逻辑：所有身份写入权集中在 auth worker`。
  - `Z1-full-auth §3.1 解耦点`（design 行 109-112）："auth worker 不进入 runtime mesh；JWT mint、WeChat secret、identity write 权不应进入 agent.core / bash.core"。
- **为什么重要**：
  - Cloudflare D1 binding 可以跨 worker 共享，但**migration 的 owner = 拥有 D1 binding 并触发 `wrangler d1 migrations apply` 的 worker**。
  - 把 identity migrations 放在 orchestrator-core 意味着：(a) orchestrator-core 持有该 D1 的写权限（违反 design 的"identity write 权只在 auth worker"原则）；或 (b) orchestrator-core 仅用作 schema 容器但实际写由 orchestrator-auth 做（这就要求 orchestrator-auth 也 bind 同一个 D1，但 plan 没说）。
  - Deploy 时序：如果 orchestrator-core 在 orchestrator-auth 之前 deploy，且 schema 在 orchestrator-core，那 schema 已经存在但无人能写；反之同理。
- **审查判断**：必须在 Z1 实施前明确 D1 ownership 模型。
- **建议修法**：
  - 推荐方案 A：所有 migrations 改放 `workers/orchestrator-auth/migrations/`（auth worker 是身份写主），后续 wave-B/C 再分别归属（例 wave-B session migrations 留在 orchestrator-core，wave-C usage migrations 放在 agent-core 或单独的 quota worker）。
  - 推荐方案 B：建立单一"migration-owner worker"，所有 wave 都由它持有 schema；其他 worker 通过 service binding 的 D1 binding 读写但不持有 schema。
  - 不论选哪个，Z1 P1-02 / Z2 P1-01 / Z3 P4-01 都需要补一句"D1 binding 名 = `NANO_AGENT_DB`，所有写 worker 在 wrangler.jsonc 里 bind 同一 D1 instance"。

### R5. Workers AI model ID 仍未冻结，Z3 P1-01 收口标准自相矛盾

- **严重级别**：`high`
- **类型**：`delivery-gap` + `correctness`
- **事实依据**：
  - `Z3 P1-01`（行 164）：工作内容 = `把 AI binding、Workers AI first-wave model、preview/local env contract 写入 agent-core`；收口标准 = `不再存在"mainline provider 未定"的口径`。
  - `Z3 §5.1 详情`（行 209-212）：具体功能预期 = `AI binding 真正进入 agent-core 环境契约 / Workers AI first-wave model 成为 canonical mainline / DeepSeek 仅保留 skeleton position`。
  - 但**全文 0 处出现** `@cf/meta/llama` / `@cf/qwen` / 任何具体 model ID。
  - `grep -n "@cf/" docs/design/zero-to-real/*.md` → 0 命中。
  - `grep -n "@cf/" docs/charter/plan-zero-to-real.md` → 0 命中。
- **为什么重要**：
  - Workers AI 50+ models 中 function-calling 能力差异巨大（design review R4 已指出）：Llama-3.1-8b 的 fc 偏弱、Qwen-2.5-Coder-32b 较好、Hermes-2-Pro 强。Z3 P5-01 收口标准 = "至少一轮真实 prompt->tool->response 成功"——如果 model 选错，这个收口直接走不通。
  - 我 Q8 Opus 第二意见已经预设了"Workers AI model fc smoke gate；如失败自动 escalate DeepSeek"——但 action-plan 没继承这条 escalation rule。
  - Z3 P1-01 收口判定方式 = "package-e2e / preview probe"——但要 probe，必须知道用哪个 model！这是循环依赖。
- **审查判断**：必须在 Z3 P1-01 之前（或在 Z0 closure 里）冻结具体 model ID，否则 Z3 实施期立即停摆。
- **建议修法**：
  - Z3 §1.5 directory tree 之前增加 §0.1 "Workers AI first-wave model freeze"：明确写 `model_id = '@cf/<vendor>/<model>'`（owner 选 1 个），并 hash-pin 在 `workers/agent-core/src/llm/registry/models.ts` 的 `firstWaveModel` 常量。
  - Z3 §6 风险表增加一行："first-wave model fc 不达标 → 自动 escalate DeepSeek 为 required（不需 owner 重决策；只需 Z3 closure 追加修订记录）"——继承 Q8 Opus escalation 设计。
  - 或者：把 model ID 选择正式提一个 Q11 进 ZX-qna，让 owner 在 Z2 closure 之前回答——避免 Z3 P1 实施期 block。

### R6. D1 migration apply 工具与 D1 binding 名都未在任何 plan 显式冻结

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `find workers -name "migrations" -type d` → **0 命中**（migrations 全部从 0 开始）。
  - Z1 P1-02 / Z2 P1-01 / Z3 P4-01 测试方式都说 "migration smoke" / "migration apply smoke"——但**未指定工具**。
  - `grep -n "wrangler d1\|wrangler.jsonc.*d1\|d1_databases" docs/action-plan/zero-to-real/*.md` → 0 命中具体绑定配置。
  - Z0 §5.2 P2-01 cross-cutting dependency map 提到 `NANO_AGENT_DB` 但无 D1 instance UUID / wrangler config 段。
- **为什么重要**：
  - Cloudflare D1 的 migration 工具有：(a) `wrangler d1 migrations apply <DB_NAME>`（标准）；(b) 自定义 SQL runner（少数项目用）；(c) GitHub Actions migration step。这些 work flow 完全不同。
  - 如果 owner 没指定，Z1 P1-02 实施者要先猜——猜错会导致后续 Z2/Z3 wave 不能 apply。
- **审查判断**：低成本修法，但是 blocker 级。
- **建议修法**：Z0 §3 业务工作总表增加 P2-03 "D1 migration tooling freeze"：在 Z0 closure 前确认 (a) D1 binding 名 = `NANO_AGENT_DB`；(b) D1 instance UUID（通过 `wrangler d1 list` 或 `wrangler d1 create nano-agent-db`）；(c) migration runner = `wrangler d1 migrations apply NANO_AGENT_DB`；(d) preview 与 production 两套环境是否共用同一 D1 instance（推荐分两个）。

### R7. Z1 P1-02 schema 列表（7 张表）超出 ZX-D1 §5.1 S1（5 张表），未在 design 反向更新

- **严重级别**：`medium`
- **类型**：`scope-drift` + `docs-gap`
- **事实依据**：
  - `Z1 P1-02`（行 165）：`nano_users / nano_user_profiles / nano_user_identities / nano_teams / nano_team_memberships / nano_auth_sessions / nano_team_api_keys`——**7 张表**。
  - `ZX-d1-schema-and-migrations.md §5.1 S1`（行 172）：仅 `nano_users / nano_user_profiles / nano_user_identities / nano_teams / nano_team_memberships`——**5 张表**。
  - `ZX-d1 §5.3 灰区`（行 189-190）："`nano_auth_sessions` | in-scope" + "`nano_tenant_secrets` | conditional in-scope"。
  - **`nano_team_api_keys` 在 ZX-D1 中没有任何 mention**——它是从 design review R2 + Q4 owner 答复（同意 schema reserved）来的，但还没回灌到 ZX-D1。
- **为什么重要**：
  - design pack 的目的是让 implementer 单看 design 就能编程；如果 ZX-D1 还在写 5 张表而 action-plan 已经在落 7 张，二次审查时会出现"design 与 action-plan 谁是 ground truth"的争议。
  - 我 design review R8 已经指出 ZX-D1 §5.1 漏 `nano_auth_sessions`，应该提级至 S 级；现在 action-plan 走在前头但 design 没补——长期看是文档债。
- **审查判断**：低成本修法，且 ZX-D1 r2 应该已经准备好做这件事。
- **建议修法**：
  - 在 Z0 P1-02 audit 阶段或 Z1 P1-01 之前，反向更新 ZX-D1 §5.1 S1 = 7 张表（加 `nano_auth_sessions` + `nano_team_api_keys`）。
  - 同步 ZX-D1 §7.1 F1 Identity Core 的"输出"扩列。

### R8. shim retire deadline 仅在 Z1 风险表出现一次，Z2/Z3/Z4 不 enforce

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `Z1 §6 风险表`（行 344）："保留 fetch-binding shim 过渡路径，但在 Z1 closure 中写明 retire deadline = Z2 closure 前"——该约束我 Q1 Opus 第二意见的核心。
  - `grep -n "shim\|retire\|fetch-binding" docs/action-plan/zero-to-real/Z2-*.md docs/action-plan/zero-to-real/Z3-*.md docs/action-plan/zero-to-real/Z4-*.md` → 0 命中"retire" / "fetch-binding shim"。
  - `Z2 P4-02 收口标准`（行 181）："public start 与 internal start 共享同一 durable truth"——比"shim 已退役"弱很多。
  - `workers/orchestrator-core/src/user-do.ts:483, 490, 653, 657, 692, 701` `forwardInternalRaw` 仍然走 fetch-backed `https://agent.internal/internal/...`——shim 现实存在。
- **为什么重要**：
  - shim 永久化是 internal transport 治理最大失败模式（design review 与 Q1 Opus 第二意见都指出过）。
  - 如果 Z2 closure 不 enforce "shim 已退役" 这条硬指标，Z2 通过后 shim 与 RPC 长期共存，charter 的"control-plane RPC-first" 主线名存实亡。
- **审查判断**：必须在 Z2 closure 标准里硬性引入 retire deadline。
- **建议修法**：
  - Z2 §3 业务工作总表 P4-02 收口标准追加："且 `grep -rn 'forwardInternalRaw\\|agent.internal/internal' workers/orchestrator-core/src/` 行数从 6 处降至 ≤ 1 处（仅保留 stream-plane 过渡 seam）"——这是机器可验证的 retire proof。
  - Z2 §5.5 P5-02 closure 标准追加："列出剩余 internal HTTP seam 并标注 retire owner（推荐 Z3 / Z4）"。

### R9. Z2 P4-02 parity 标准过弱，无法证明 Q7 Opus 推荐的 byte-equal parity

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - `Z2 §3 P4-02`（行 148）：目标一句话 = "让 `start` 开始走 RPC-first seam"——是"开始走"，不是"完成等价证明"。
  - `Z2 §4.4 P4-02 收口标准`（行 181）："public `start` 与 internal `start` 共享同一 durable truth"——"共享 truth"是必要不充分条件。
  - `Z2 §5.4 P4-02 收口标准`（行 297-300）："`status` 经 RPC 返回真实状态 / `start` 至少完成 first-wave kickoff / no-escalation / envelope truth 仍成立"。
  - 我 Q7 Opus 第二意见明确："Z2 closure 标志 = `start` dual-impl + golden parity test 通过；parity 判定 = (a) 返回 envelope deep-equal；(b) D1 写入 row diff = ∅；(c) NACP authority/trace stamp 一致"——三项 AND 条件。
- **为什么重要**：
  - "Kickoff" / "first-wave" 这种修辞是 design 阶段可接受的，但 action-plan 阶段必须给可机器验证的 closure 判据（参考 design review R6）。
  - "共享 truth" 字面上 fetch path 和 RPC path 写同一张 D1 表也算共享——但两者写入数据可能不等价（field 顺序、序列化差异、authority stamp 时机）。
- **审查判断**：低成本但重要。
- **建议修法**：
  - Z2 §4.4 P4-02 收口标准重写："给定相同 fixtures（含 forged authority、tenant mismatch、合法 happy path），public-via-fetch path 与 internal-via-RPC path 跑出来的：(a) 返回 envelope JSON deep-equal；(b) `nano_conversation_sessions / nano_conversation_messages / nano_session_activity_logs` 三表的写入 row diff = ∅；(c) `trace_uuid + authority.tenantUuid + authority.userUuid` 三字段 byte-equal。三项 AND。"
  - Z2 §3 业务工作总表 P4-02 风险等级从 `high` 保持，但工作内容补"产出 golden parity test fixtures"。

### R10. Z3 quota authorizer 落点 fuzzy，与 design review R9 的 LLM gate 落点未对齐

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `Z3 §1.4 directory tree`（行 88）：建议性 `可新增 workers/agent-core/src/host/quota/**`。
  - `Z3 §3 P3-01`（行 149）：涉及模块 = `workers/agent-core/src/host/** + src/kernel/**`——两个 dir 都列。
  - `Z3 §5.3 详情`（行 257-264）：本 phase 修改文件 = `workers/agent-core/src/host/** / src/kernel/** / bash-core/{executor,tool-call,policy}.ts`——仍然不指认具体函数。
  - 我 Q9 Opus 第二意见明确：tool gate 落 `workers/bash-core/src/executor.ts:73 beforeCapabilityExecute`（已存在）；LLM gate 新建 hook `beforeLlmInvoke` 落 `workers/agent-core/src/kernel/runner.ts`（命名对称）。
  - `grep -n "beforeLlmInvoke" docs/action-plan/zero-to-real/Z3-*.md` → 0 命中。
- **为什么重要**：
  - charter 与 ZX-binding 都说 bash-core 只能由 agent-core 调用，因此 quota authorizer 必须在 agent-core 一侧（bash-core 通过 capability invocation 拿到 quota decision，不能反向调 quota service）。
  - 如果不指认具体 hook 函数名与 invoke point，实施者要么落到 host/quota/ 里建一个 service（多一层抽象），要么直接散在 runner.ts / kernel.ts 里——结果不可预测。
- **审查判断**：低成本但显著影响实施一致性。
- **建议修法**：
  - Z3 §4.3 P3-01 工作内容追加："具体落点：LLM gate = `workers/agent-core/src/kernel/runner.ts` 在 invoke gateway 之前新建 hook `beforeLlmInvoke()`；tool gate = 复用 `workers/bash-core/src/executor.ts:73 beforeCapabilityExecute`，在 hook 内追加 quota authorizer 调用。两个 hook 都通过共享的 `QuotaAuthorizer` 接口（落 `workers/agent-core/src/host/quota/authorizer.ts`）调用。"
  - Z3 §5.3 详情同步增补。

### R11. quota deny 的 activity log event_kind / severity / payload 字段值未具体冻结

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `Z3 §3 P4-02`（行 152）：目标 = "accepted/rejected runtime evidence 可读"——抽象描述。
  - `Z3 §4.4 P4-02 收口标准`（行 185）："replay/history 可看到关键 runtime 决策"——同样抽象。
  - 我 Q9 Opus 第二意见明确："deny 必须写一行 `nano_session_activity_logs`，`event_kind='quota.deny'`、`severity='warn'`、`payload` 含 deny reason + remaining balance + requested cost"。
  - Q5 Opus 推荐扩展字段集（actor_user_uuid / event_seq / severity）尚未回灌到 ZX-D1。
- **为什么重要**：
  - audit 数据契约必须前置——上线后无法修。
  - Z4 客户端要在 UI 上显示"配额不足"错误必须知道 typed `event_kind` 取什么值。
- **审查判断**：低成本但影响 Z4 客户端实现。
- **建议修法**：
  - Z3 §4.4 P4-02 收口标准追加："`nano_session_activity_logs` 包含至少：(a) accepted llm invoke：`event_kind='llm.invoke', severity='info', payload={model_id, prompt_tokens, completion_tokens, cost_units}`；(b) rejected by quota：`event_kind='quota.deny', severity='warn', payload={resource='llm'|'tool', requested_cost, remaining_balance, reason_code}`；(c) accepted tool：`event_kind='tool.invoke', severity='info', payload={capability, tool_name, cost_units}`。三类 event_kind 至少有一条 e2e test 验证写入。"

### R12. Z4 客户端前端栈 (web framework / mini-program framework) 未冻结

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `Z4 §3 P1-01`（行 138）：涉及模块 = `clients/web/**`，无 framework 指认。
  - `Z4 §5.1 P1-01`（行 197）：本 Phase 新增文件 = `clients/web/**`，仍然无 framework。
  - `Z4 §3 P2-01`（行 140）：`clients/wechat-miniprogram/**`——同样无 framework（native MP / Taro / uni-app）。
  - `grep -n "React\|Vue\|Svelte\|Next\|Vite\|Taro\|uni-app\|wepy" docs/action-plan/zero-to-real/Z4-*.md` → 0 命中。
- **为什么重要**：
  - 前端栈选择影响：(a) build pipeline (vite vs webpack vs no-build)；(b) 依赖体积；(c) state management；(d) 类型化 vs 不类型化；(e) 团队技能匹配。
  - 不冻结，Z4 P1-01 实施者会按个人偏好选——后续维护者要切换栈成本巨大。
- **审查判断**：必须前置选择，但选什么不是 Opus 该决定的（owner / 前端实施者权限）。
- **建议修法**：
  - Z0 §3 P2-01 cross-cutting dependency map 追加一项："Z4 client tech stack freeze (web framework + mini-program framework)"——属于 owner 决策。
  - 若 owner 暂无偏好，推荐 web = Vite + React + TypeScript（成熟、文档全、Cloudflare Pages 支持好）；mini-program = native（最少抽象，最贴 WeChat 平台行为）。
  - Z4 §6 风险表增加："client 栈未冻结 → P1/P2 实施期争议 → 通过 Z0 closure 之前回答 owner 决定"。

### R13. `nano_session_activity_logs` 字段集仍然链式延迟到 Q5（ZX-D1 → Q5），实施者需横跨 3 文档

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `Z2 §4.1 P1-01 工作内容`（行 160）："依据 ZX-D1 落 session / turn / message / context / activity tables 与索引"——把字段定义委派给 ZX-D1。
  - `ZX-d1-schema-and-migrations.md §5.1 S4`（行 175）：仅写表名，**字段未列**。
  - `ZX-d1 §5.3 灰区`（行 191）："`nano_session_activity_logs` 拆表 | pending | 由 Q5 拍板"。
  - `ZX-qna.md Q5`：owner 已答复（"同意 GPT 的推荐，同意 Opus 的看法"），Opus 推荐扩展为 12 列字段集。
  - **但 ZX-D1 §7 / §7.4 没有反向更新写入这 12 列**——design review R2 已指出，仍未修复。
- **为什么重要**：
  - Z2 P1-01 实施者读 action-plan → ZX-D1 → ZX-qna Q5 → Opus 推荐 → 才能拿到字段表。**3 跳引用链**。
  - 实施期任何一个文档同步漏掉，schema 就会与设计意图分叉。
- **审查判断**：与 design review R2 联动。Z0 freeze 阶段是补这个的最后机会。
- **建议修法**：
  - Z0 P1-01 audit 阶段强制要求："如发现 ZX-D1 字段未列但 action-plan 必需 → 在 Z0 closure 之前反向更新 ZX-D1 §7.4 字段表节"——否则 Z0 closure 不能成立。
  - 具体把 Q5 Opus 12 列字段集写入 ZX-D1：`activity_uuid (PK) / team_uuid / actor_user_uuid / conversation_uuid / session_uuid / turn_uuid / trace_uuid / event_seq / event_kind / severity / payload (JSON, max 8KB) / created_at` + 三条 index。

### R14. Z0 缺乏"补冻结"职责，未对 design review 留下的明显空白做收尾

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `Z0 §3 业务工作总表`（行 134-140）的 6 项全部是元工作（audit / mapping / freeze / closure），无任何"补冻结具体技术决策"。
  - `Z0 §0 执行背景与目标`（行 23-25）说"如果没有 Z0 action-plan，把这些内容压成统一执行基线、关闭残留漂移"——但实际 6 项工作没有"关闭残留漂移"的动作。
  - design review（自审）已留 R3-R5 + R7-R8 + R12-R13 共 7 条具体冻结缺口（Workers AI model ID / D1 binding 名 / migration tool / WeChat 凭证 env vars / refresh-token lifetime / payload 字段集 / 评估包格式），其中：
    - WeChat 凭证 env vars 已被 Z1 P2-01 吸收（F+6）——good。
    - 其余 6 条**没有任何 action-plan 处理**。
- **为什么重要**：
  - Z0 自我定位是"phase governance + freeze gate"，但实际只对 charter / design / QnA 做了"已经 freeze 的 audit"——这等于 doc review，不等于 freeze。
  - 真正的 frozen-by-Z0-closure 应该是 charter + design + Q1-Q10 + Z0 自身追加的具体落点决策（model ID / binding 名 / migration tool / 等）。
- **审查判断**：要么扩 Z0 职责（推荐），要么把这些落点放到具体 Z1/Z2/Z3 实施期。前者风险更低。
- **建议修法**：
  - Z0 §3 业务工作总表新增 P2-03 "specific implementation freeze"，下含 6 个子项：
    1. Workers AI first-wave model ID（推荐 `@cf/meta/llama-3.1-8b-instruct` 或同等 fc-capable）。
    2. D1 binding 名 (`NANO_AGENT_DB`) + D1 instance UUID (via `wrangler d1 list`).
    3. D1 migration tool (`wrangler d1 migrations apply`).
    4. refresh-token lifetime (推荐 access 1h / refresh 30d / rotate-on-use).
    5. activity log payload 12 列字段集（同步到 ZX-D1）。
    6. Z4 evidence pack 模板（field set + 文件命名约定）。
  - 这 6 项不是 owner-level 决策（除 model ID），是 Opus / GPT / 实施者层面的"补冻结"——Z0 是最适合做的位置。

### R15. Z5 audit 的 ground truth（charter exit criteria 清单）不存在

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `Z5 §3 P1-02`（行 123）：工作内容 = "对照 charter primary exit criteria 逐条判断"。
  - `Z5 §4.1 P1-02 收口标准`（行 137）："不再出现'感觉已完成'的表述"。
  - `docs/charter/plan-zero-to-real.md §10`（charter 自身）是叙述性"完成态 / 下一阶段"——**没有显式编号的 exit criteria 清单**（如 EC1 / EC2 / EC3 ...）。
- **为什么重要**：
  - 没有 ground truth 的 audit 等于 audit 自由心证——这正是 Z5 §6 风险表"阶段完成度被高估"试图规避的事情。
  - charter 已经过 r1 review，不应该在 Z5 实施期修。
- **审查判断**：要么 Z5 自己定义 exit criteria 清单（基于 charter 文本提炼），要么 Z0 closure 在前期补一份明确清单。后者更稳。
- **建议修法**：
  - Z0 §3 业务工作总表新增 P3-02 "charter exit criteria extraction"：从 charter §10 文本中提炼 ≥ 8 条编号 EC（如 EC1 = "register/login real path 通过"；EC2 = "WeChat 真实登录跑通至少 1 次"；EC3 = "Workers AI 真实 inference 至少 1 次"；...），落到 `docs/issue/zero-to-real/Z0-closure.md` §charter-exit-criteria 节。
  - Z5 P1-02 引用此清单做 audit。

### R16. orchestrator-auth wrangler binding 配置（D1 / 共享 secret / single-caller enforcement）未明确

- **严重级别**：`medium`
- **类型**：`security` + `delivery-gap`
- **事实依据**：
  - `Z1 §1.4 directory tree`（行 99-100）：`workers/orchestrator-auth/wrangler.jsonc [new]`——文件标记 new，但内容未指认。
  - `Z1 §3 P2-01`（行 147）：工作内容 = "新建 workers/orchestrator-auth/，接 NANO_AGENT_DB、PASSWORD_SALT、WECHAT_APPID、WECHAT_SECRET、JWT_SIGNING_KEY_<kid>"——绑定枚举 OK，但**未说"single-caller enforcement"如何实现**。
  - 设计层 ZX-binding §7 多次说 "auth worker single caller"，但 Cloudflare service binding 默认不携带 caller 身份证明——必须靠 shared secret + envelope check。
  - 现有 `workers/agent-core/src/host/internal-policy.ts` 已实现这个 pattern（design review §1.1 F+5 已确认）。
- **为什么重要**：
  - 如果 orchestrator-auth 默认接受任何 service binding 调用，单 caller 规则名存实亡——任何 internal worker 都能调 mint endpoint。
  - 这是 charter §1 "auth worker internal-only single caller" 的 hard requirement。
- **审查判断**：必须显式 enforcement。
- **建议修法**：
  - Z1 §4.2 P2-01 收口标准追加：
    1. wrangler.jsonc bind 列表：`[{name: 'DB', d1: 'NANO_AGENT_DB'}, {name: 'AUTH_INTERNAL_SECRET', secret_text: '<rotated>'}]`。
    2. 入口 `workers/orchestrator-auth/src/index.ts` 在每个 RPC method 起始处调 `assertOrchestratorCaller(env)` helper（pattern 复用 `internal-policy.ts`）。
    3. negative test：从 agent-core / bash-core / context-core / filesystem-core 直接调 auth worker → 必须 typed reject。Z1 P5-01 含此 test。

### R17. Z4 first-real-run evidence pack 模板未指认

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `Z4 §3 P4-01`（行 144）：涉及模块 = `docs/eval/zero-to-real/first-real-run-evidence.md`。
  - `Z4 §4.4 P4-01 收口标准`（行 178）："evidence 含环境、步骤、结果、失败与截图/日志摘要"——大致 OK。
  - 但**无具体字段表 / Markdown 模板 / heading 列表**。
  - design review R13 / Q16 已指出该缺口未补。
- **为什么重要**：
  - evidence pack 是 closure 的事实基础；如果格式不统一，后续 audit 难比对。
- **审查判断**：低成本，建议落 Z0。
- **建议修法**：Z0 §3 P3-01 validation baseline freeze 追加："evidence pack 模板 = `docs/eval/zero-to-real/first-real-run-evidence.md` 至少含 §0 环境（preview/prod、commit SHA、worker version）/ §1 测试账户 / §2 步骤序列 / §3 观察到的事件（含 trace_uuid）/ §4 失败 + 修复 / §5 残留 backlog。"

### R18. Z3 P2-01 preview 环境的 Workers AI binding 可用性未验证

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - `Z3 §4.2 P2-01 收口标准`（行 170）："preview 上可完成真实 prompt -> delta/result"。
  - Cloudflare Workers AI 在 preview deploy 通常可用，但**真实 inference 计费**——长跑测试会花钱。
  - 没有 dedicated test environment（free tier / mock）的指认。
- **为什么重要**：
  - 实施期 P2-01 调试可能因为预算/限速被卡住。
- **审查判断**：低优先级。
- **建议修法**：Z3 §6 风险表追加："Workers AI preview 环境的真实 inference 计费 / rate-limit → 通过 mock provider（DeepSeek skeleton 可复用）做长跑测试，仅在 Phase 5 closure smoke 用真实 binding。"

### R19. Z2 RPC kickoff 没有引用 `packages/nacp-core/src/transport/{service-binding,do-rpc}.ts`

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `Z2 §3 P4-01`（行 147）：涉及模块 = `workers/agent-core/src/host/internal.ts + workers/orchestrator-core/src/index.ts`——只提 worker 端。
  - 但 RPC envelope precheck 的实现在 `packages/nacp-core/src/transport/service-binding.ts`（已确认存在）。
  - `grep -n "nacp-core/src/transport\|service-binding\|do-rpc" docs/action-plan/zero-to-real/Z2-*.md` → 0 命中。
- **为什么重要**：
  - 实施者会重新实现 envelope precheck 逻辑而不是复用已有 nacp-core primitives——浪费精力 + 偏离协议。
- **审查判断**：低优先级，但应在 Z2 P4-01 工作内容里 explicitly 提及。
- **建议修法**：Z2 §4.4 P4-01 工作内容追加："RPC envelope 复用 `packages/nacp-core/src/transport/service-binding.ts` 提供的 precheck primitive，不在 worker 内重新实现。"

### R20. Z1 P1-01 contract package 接口列表未枚举

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `Z1 §4.1 P1-01`（行 164）：工作内容 = "新建 packages/orchestrator-auth-contract/，定义 WorkerEntrypoint RPC input/output、shared auth envelope、typed error codes"——抽象。
  - `Z1 §5.1 P1-01 详情`（行 199-225）：未列具体接口名。
- **为什么重要**：
  - typed contract package 的价值是 caller/callee 类型完全锁死；如果接口集合定义模糊，packages 价值打折。
- **审查判断**：低优先级，但建议预先列。
- **建议修法**：Z1 §4.1 P1-01 工作内容追加接口清单："至少含 `RegisterRequest/Response`、`LoginRequest/Response`、`RefreshRequest/Response`、`MeRequest/Response`、`WechatLoginRequest/Response`、`VerifyApiKeyRequest/Response`（schema-only，Q4）+ `AuthEnvelope`（trace_uuid / authority）+ `AuthErrorCode` enum。"

---

## 3. In-Scope 逐项对齐审核

### 3.1 `Z0-contract-and-compliance-freeze.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| Z0-S1 | 核对并声明 zero-to-real 的 frozen inputs | `done` | charter / 10 design / ZX-qna 明确列入 |
| Z0-S2 | 输出 Z1-Z5 的 cross-cutting dependency / sequencing / validation baseline | `partial` | dependency map 在 P2-01 但具体冻结项（model ID / D1 binding / migration tool）缺（R6/R5/R14） |
| Z0-S3 | root test scripts 升格为执行基线 | `partial` | 升格存在；但 `test:cross` 含义错配未识别（R1） |
| Z0-S4 | 产出 `Z0-closure.md` | `done` | P4-01 明确产出 |

**对齐结论**：done=2 / partial=2 / missing=0。Z0 governance 任务基本完成，但"补冻结"职责缺失（R14）。

### 3.2 `Z1-full-auth-and-tenant-foundation.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| Z1-S1 | `packages/orchestrator-auth-contract/` typed contract | `partial` | 已纳入 in-scope；但接口枚举未列（R20） |
| Z1-S2 | 新建 `workers/orchestrator-auth/` internal-only single-caller | `partial` | 创建动作明确；single-caller enforcement 配置未落实（R16） |
| Z1-S3 | Wave A D1 schema | `partial` | 7 张表列出；但 owner / migrations 落点漂（R4）+ tooling 未指（R6）+ ZX-D1 未反向更新到 7 张（R7） |
| Z1-S4 | 打通 register/login/verify/refresh/reset/me 真实 auth flow | `done` | P3-01/P3-02 明确，refresh-token + kid + dual verify window 都有 |
| Z1-S5 | WeChat code → openid → identity → JWT 真实链路 | `done` | P4-01 明确，env vars 已列 |
| Z1-S6 | 自动建 default team + owner membership + 双租户 negative tests | `done` | P4-02 + P5-01 明确 |

**对齐结论**：done=3 / partial=3 / missing=0。Z1 的核心 auth 路径成熟；阻塞点在 schema migration ownership（R4）与 contract 接口枚举（R20）。

### 3.3 `Z2-session-truth-and-audit-baseline.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| Z2-S1 | Wave B D1 schema | `partial` | 5 张表列出；但表名层级与 ZX-D1 严重分叉（R2）+ 字段集链式延迟（R13） |
| Z2-S2 | `start/input/history/timeline/verify` 消费 D1 truth | `partial` | P2-01 明确；但 conversation 上位聚合层缺（R2 副作用）|
| Z2-S3 | DO hot-state 4 组最小集合 + 10m alarm | `done` | P3-01 明确，与 Q6 Opus 12 列要求对齐 |
| Z2-S4 | heartbeat / replay cursor / reconnect first-wave truth | `done` | P3-02 明确 |
| Z2-S5 | internal `status` smoke + `start` RPC-first | `partial` | status smoke OK；start parity 标准过弱（R9）+ shim retire 不 enforce（R8）+ nacp-core 引用缺（R19） |
| Z2-S6 | append-only `nano_session_activity_logs` + redaction | `partial` | append 路径 OK；但 event_kind/severity 字段值未冻结（R11） |

**对齐结论**：done=2 / partial=4 / missing=0。Z2 的 4 个 partial 全部需要在实施前先回头改 ZX-D1 或 plan 自身。R2 是其中最严重的，必须先修。

### 3.4 `Z3-real-runtime-and-quota.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| Z3-S1 | `AI` binding + Workers AI first-wave model 成为 mainline | `partial` | binding 概念明确；model ID 完全未冻结（R5） |
| Z3-S2 | agent loop 真实走 `llm/**` + `kernel/**` | `partial` | 文件路径全部锚定真实代码；但 preview 环境 Workers AI 验证未检（R18） |
| Z3-S3 | llm + tool 双 quota gate | `partial` | 概念明确；落点 fuzzy（R10）+ deny 字段值未冻结（R11） |
| Z3-S4 | `nano_usage_*` / `nano_quota_balances` durable truth | `partial` | 表名分叉为 `nano_usage_ledger`（R3）+ migration ownership（R4） |
| Z3-S5 | accepted/rejected runtime evidence 写入 activity/eval | `partial` | 概念明确；event_kind 未具体（R11） |

**对齐结论**：done=0 / partial=5 / missing=0。Z3 看起来"全 partial"是因为 R5（model ID 未冻结）这一个上游断点污染了下游每一项。修了 R5 + R3 + R10 + R11，剩下大部分 partial 都升级为 done。

### 3.5 `Z4-real-clients-and-first-real-run.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| Z4-S1 | `clients/web/` + register/login/session start/input/stream/history baseline | `partial` | 路径明确；但 framework 未冻结（R12） |
| Z4-S2 | `clients/wechat-miniprogram/` + WeChat auth 与 session baseline | `partial` | 同上；mini-program framework 未冻结（R12） |
| Z4-S3 | heartbeat / replay cursor / history readback / quota/error disclosure | `partial` | P3-01/P3-02 概念明确；但依赖 Z3 R11 已落实 |
| Z4-S4 | first real run evidence + residual inventory | `partial` | 路径明确；evidence pack 模板未冻结（R17） |

**对齐结论**：done=0 / partial=4 / missing=0。Z4 是"前置依赖最重"的 phase，每一项都依赖 Z1/Z2/Z3 的 closure；但 R12 (framework) 是 Z4 自己的盲点。

### 3.6 `Z5-closure-and-handoff.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| Z5-S1 | 汇总并审计 Z0-Z4 closure / tests / evidence | `partial` | 流程明确；但 charter exit criteria ground truth 不存在（R15）+ test:cross 含义错配（R1） |
| Z5-S2 | zero-to-real 最终 verdict | `partial` | 流程明确；依赖 Z5-S1 修复 |
| Z5-S3 | final closure + next-phase handoff | `done` | 路径明确（`docs/issue/zero-to-real/zero-to-real-final-closure.md` + `docs/handoff/zero-to-real-to-next-phase.md`）|
| Z5-S4 | residual / deferred / OoS register | `done` | P3-01 明确 |

**对齐结论**：done=2 / partial=2 / missing=0。Z5 的 partial 主要源于 R15（charter exit criteria 不存在）——上游 Z0 需要补这件事。

### 3.7 整体对齐总览

- **done**: 9
- **partial**: 20
- **missing**: 0

> 这更像"**主线方向已对齐，6 个上游断点污染了下游 14 项**"，而不是"action-plan 整体 incomplete"。修复 R1 + R2 + R3 + R5 + R14 五个上游断点，partial 数会从 20 降到 ≤ 8。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | Z0 不新增任何 worker / package / client 代码 | `遵守` | §3 业务工作总表全部为 docs/** 修改 |
| O2 | Z0 不重新打开 Q1-Q10 owner 决策 | `遵守` | §2.3 边界判定表显式 out-of-scope |
| O3 | Z0 不撰写 final closure / next-phase handoff | `遵守` | 转交 Z5 |
| O4 | Z1 不做完整 tenant/member/API key admin plane | `遵守` | §2.3 边界判定表 + Q4 答案对齐 |
| O5 | Z1 不做 session/turn/message/audit 持久化主线 | `遵守` | 转交 Z2 |
| O6 | Z1 不做 real provider / quota / runtime evidence | `遵守` | 转交 Z3 |
| O7 | Z1 不做完整 Mini Program 真机 hardening | `遵守` | 仅 code-level smoke；真机交 Z4 |
| O8 | Z2 不做 Workers AI provider 与 quota gate | `遵守` | 转交 Z3 |
| O9 | Z2 不做完整 client UI 与真机链路 | `遵守` | 转交 Z4 |
| O10 | Z2 不做丰富 admin analytics / BI query layer | `遵守` | append-only baseline |
| O11 | Z2 不做 HTTP public surface 全面退役 | `遵守` | 但 internal HTTP shim retire deadline 不 enforce（R8）|
| O12 | Z3 不做多 provider GA / 复杂路由 | `遵守` | DeepSeek 仅 skeleton |
| O13 | Z3 不做细粒度 billing / statement / finance UI | `遵守` | append-only events + balances 仅 |
| O14 | Z3 不做完整 browser-rendering / 客户端产品化 | `遵守` | 转交 Z4 |
| O15 | Z4 不做完整产品化 UI / 设计系统 | `遵守` | thin validation client |
| O16 | Z4 不做多端同步 / 离线缓存 / 复杂消息渲染 | `遵守` | minimal |
| O17 | Z4 不做完整运营后台 / 计费中心 / 管理台 | `遵守` | 显式 OoS |
| O18 | Z4 不做客户端 SDK 产品化发布 | `遵守` | 显式 OoS |
| O19 | Z5 不修补 Z1-Z4 实现 bug | `遵守` | §1.4 风险控制 + §2.2 O1 |
| O20 | Z5 不重写 charter / design 包 | `遵守` | 显式 OoS |
| O21 | Z5 不提前创建下一阶段 design | `遵守` | 显式 OoS |
| O22 | Z5 不把 residual 全部清零 | `遵守` | residual 是 handoff 输入，不是 Z5 修复对象 |

**OoS 一致性结论**：22 项 OoS 全部 `遵守`，无越界。这是这套 action-plan 最稳的部分。
**隐性 OoS 与 design 一致**：观测性（logs/metrics）/ CI/CD pipeline / i18n 在所有 plan 中都隐性 OoS——与 design review §4.2 提及的 4 项一致，但仍未显式写出。建议 Z0 §2.2 显式补一条："zero-to-real OoS = platform observability / CI hardening / i18n / 多语言客户端 全部 deferred 到下一阶段"——一处声明，6 份引用。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`approve-with-followups (Grade: B+)` — 比 design pack 的 B 高了半级，因为 6 份 plan 里 ≥95% 文件路径是对的、QnA 已确认 owner 决策已被消费、phase 顺序正确；但 5 个 high-severity finding 必须修。
- **是否允许关闭本轮 review**：`no` — 不收口，等待 r2 修订
- **关闭前必须完成的 blocker**：
  1. **R1 修复**：Z1-Z5 的 5 处 `pnpm test:cross` 全部替换为 `pnpm test:cross-e2e`（一行 grep + 替换）。
  2. **R2 修复**：Z2 的 5 张表名 `nano_session_*` 改回 `nano_conversations / nano_conversation_sessions / nano_conversation_turns / nano_conversation_messages / nano_conversation_context_snapshots`（保留 `nano_session_activity_logs`）。
  3. **R3 修复**：Z3 P4-01 把 `nano_usage_ledger` 改回 `nano_usage_events`（与 ZX-D1 一致）。
  4. **R4 修复**：决定 D1 migration owner——推荐方案 = identity migrations 移到 `workers/orchestrator-auth/migrations/`，session/usage migrations 留在各自写主 worker；或全部放共享 `migrations/` 顶层目录。
  5. **R5 修复**：Z3 P1-01 之前冻结 Workers AI first-wave model ID（推荐 `@cf/meta/llama-3.1-8b-instruct`，含 fc smoke 验证 + DeepSeek 自动 escalate fallback），写入 `workers/agent-core/src/llm/registry/models.ts` 常量。

- **可以后续跟进的 non-blocking follow-up**：
  1. **R6-R8**：D1 binding/migration tool 显式冻结 / Z1 schema 列表反向更新 ZX-D1 / shim retire deadline enforce 到 Z2 closure。
  2. **R9-R11**：parity 判定标准强化 / quota authorizer 落点指认 / activity log event_kind 字段值冻结。
  3. **R12-R13**：Z4 client framework 选定 / activity log payload 12 列字段集回灌 ZX-D1。
  4. **R14-R16**：Z0 扩 "specific implementation freeze" 职责 / Z5 charter exit criteria 提炼 / orchestrator-auth single-caller enforcement 配置。
  5. **R17-R20**：evidence pack 模板 / preview Workers AI 验证 / nacp-core 引用 / contract package 接口枚举。

> 本轮 review 不收口。建议 r2 修法路径：
>
> **第一轮（半天工作量）**：批量修 R1-R5 五个 blocker（grep+替换 + 表名重命名 + 表名 ledger→events + 选 model + 选 migration owner）。
> **第二轮（半天工作量）**：补 R6-R8 + R14（Z0 扩职责）。
> **第三轮（落实施前）**：R9-R20 在 implementer 落地时按 phase 修，不阻塞 r2 closure。

---

## 6. 实现者回应模板

> **规则**：
> 1. 不要改写 §0–§5；只允许从这里往下 append
> 2. 回应时按 `R1/R2/...` 对应，不要模糊说"已修一些问题"
> 3. 必须写明"哪些修了、怎么修的、改了哪些文件、跑了什么验证"
> 4. 若选择不修某条 finding，必须写明理由与 tradeoff

### 6.1 对本轮审查的回应

> 执行者: `GPT-5.4`
> 执行时间: `2026-04-25`
> 回应范围: `R1–R20（并一并吸收 DeepSeek / Kimi 的同类与独有问题）`

- **总体回应**：`本轮已把 action-plan pack 中真实存在的脚本口径、表名树、Workers AI freeze、quota gate、client stack、evidence/audit freeze 等问题收回到当前 charter / design / QnA / 5-worker 代码事实；少数 finding 的前提已过期，则在保留 reviewer 证据的同时按现状判为 rejected。`
- **本轮修改策略**：`先按代码与已冻结 design/QnA 逐条核真伪，再只修真实断点；优先修会污染执行面的上游口径（test taxonomy、schema/table truth、model/runtime freeze、quota/audit/client evidence），同时把 DeepSeek / Kimi 的重复问题折叠进同一组补丁，避免对同一主题做三套平行修文。`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | `pnpm test:cross` 脚本含义错配 | `fixed` | 将 Z1/Z2/Z3/Z4 的 phase 回归口径统一改成 `pnpm test:cross-e2e`，并在 Z0 明确 `test:package-e2e` / `test:cross-e2e` / `test:cross(test:e2e)` 三者职责；Z5 completion audit 也同步改成 package-e2e + cross-e2e + full regression 三层口径。该补丁同时吸收了 DeepSeek / Kimi 对测试脚本语义的同类担忧。 | `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md` `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md` `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md` `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md` `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md` `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md` |
| R2 | `nano_session_*` vs `nano_conversation_*` 表名分叉 | `fixed` | Z2 已整体改回 conversation-centered tree：`nano_conversations / nano_conversation_sessions / nano_conversation_turns / nano_conversation_messages / nano_conversation_context_snapshots / nano_session_activity_logs`；同时补上“无 active conversation 时先建 conversation 再建 session”的执行语义。DeepSeek 关于 Wave B truth 漂移的同类问题一并关闭。 | `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md` |
| R3 | `nano_usage_ledger` vs `nano_usage_events` 表名分叉 | `fixed` | Z3 已将 Wave C durable truth 改回 `nano_usage_events / nano_quota_balances`，并在 phase 表、详情、收口标准里同步更新。DeepSeek 对 `nano_tenant_secrets` first-wave out-of-scope 的提醒也一并写入同阶段。 | `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md` |
| R4 | identity migrations worker 归属错配 | `partially-fixed` | 当前 design 真相并不是“必须把所有 migration owner 移到 auth worker”；ZX-D1 现状已冻结 shared D1 baseline 仍从 `workers/orchestrator-core/migrations/` 进入。因此本轮没有反向改 charter/design owner boundary，而是把 Z1/Z2 的 D1 alias、shared migration dir、manual apply path、auth/orchestrator 共用同一 D1 instance 的事实写实，消除执行歧义。DeepSeek 关于 migration/operator 说法的同类问题按此并入。 | `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md` `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md` |
| R5 | Workers AI model ID 未冻结 | `fixed` | Z3 P1-01 已冻结默认 model=`@cf/ibm-granite/granite-4.0-h-micro`，Workers AI 内部 fallback=`@cf/meta/llama-4-scout-17b-16e-instruct`，并明确只有二者都过不了 fc smoke 才升级 DeepSeek required。Kimi/DeepSeek 对 Z3 provider freeze 的同类问题一并吸收。 | `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md` |
| R6 | D1 migration apply 工具与 binding 名未冻结 | `fixed` | Z1 已明确 `NANO_AGENT_DB` alias、`workers/orchestrator-core/migrations/` 目录与 `wrangler d1 migrations apply NANO_AGENT_DB` manual path；Z2 进一步把 shared D1 binding 写回 orchestrator-core 与 agent-core。DeepSeek R12 / Kimi R5 同类问题一并收口。 | `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md` `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md` |
| R7 | Z1 P1-02 表数与 ZX-D1 §5.1 S1 分叉 | `rejected` | 该 finding 依据的是旧版 design 现实。当前 ZX-D1 已是 7 张 Wave-A identity tables（含 `nano_auth_sessions`、`nano_team_api_keys`），Z1 action-plan 与现行 design/QnA 已一致，因此未再对表数做二次改写；本轮仅补强了 migration/binding/tooling 的执行口径。 | `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md` `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md` |
| R8 | shim retire deadline 不 enforce | `fixed` | Z1 已把 fetch-binding shim retire deadline 明确写成 `Z2 closure 前`；Z2 P4-02 则把它升级成 closure gate：`start` 进入 dual-impl parity，fetch shim 仅允许保留明确过渡 seam，并在 Z2 closure 中强制列出 residual / deadline。 | `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md` `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md` |
| R9 | Z2 P4-02 parity 标准过弱 | `fixed` | Z2 P4-02 现已把 parity proof 写成三条件：`public-via-fetch` 与 `internal-via-RPC` 返回 envelope JSON deep-equal、关键 D1 rows diff=`∅`、`trace_uuid + authority` stamp 一致；同时保留 `status` smoke -> `start` parity 的两步推进。DeepSeek / Kimi 关于 RPC kickoff 过弱的同类意见一并吸收。 | `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md` |
| R10 | Z3 quota authorizer 落点 fuzzy | `fixed` | Z3 已明确 LLM gate 落在 `workers/agent-core/src/kernel/runner.ts::beforeLlmInvoke()`，tool gate 复用 `workers/bash-core/src/executor.ts::beforeCapabilityExecute()`，并共享 `QuotaAuthorizer`。Kimi 对 gate 落点的同类问题已并入。 | `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md` |
| R11 | quota deny event_kind/severity 未冻结 | `fixed` | Z3 P4-02 与 Phase 4/5 详情已冻结 `quota.deny / llm.invoke / tool.invoke` 等关键 event kind，以及 `info|warn` severity；同时 user-visible reject 统一要求 typed `QUOTA_EXCEEDED`。DeepSeek 对 quota/audit disclosure 的同类问题一并关闭。 | `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md` `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md` |
| R12 | Z4 client framework 未冻结 | `fixed` | Z4 已冻结 `clients/web = Vite + Vanilla TypeScript`、`clients/wechat-miniprogram = 微信原生小程序工程`，并在 Phase 1/2、执行策略与风险表里保持一致。Kimi 对 client stack 未定的同类问题同步关闭。 | `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md` |
| R13 | activity_logs 字段集链式延迟 | `fixed` | 直接把 Q5 冻结的 12 列 activity log schema 与 3 条 index 写回 ZX-D1，并让 Z2 P1-01 / P5-02 显式依赖这一字段集；不再要求实施者从 action-plan -> design -> QnA 三跳回溯。DeepSeek 对 audit evidence 细项的同类问题同时吸收。 | `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md` `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md` |
| R14 | Z0 缺"补冻结"职责 | `fixed` | Z0 已新增/强化“implementation freeze register”语义：把 validation baseline、specific implementation freezes、evidence/audit ground truth 都明确挂进 Z0，而不是只做 meta-audit。 | `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md` |
| R15 | Z5 charter exit criteria ground truth 不存在 | `rejected` | 该 finding 前提已过期：当前 `docs/charter/plan-zero-to-real.md` 已有 `§10.1 Primary Exit Criteria`。本轮未改 charter，而是在 Z0/Z5 中把对 `§10.1` 的引用写实，避免实施者漏看现成 ground truth。 | `docs/charter/plan-zero-to-real.md` `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md` `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md` |
| R16 | orchestrator-auth wrangler binding 配置缺 | `fixed` | Z1 P2-01 已明确 `workers/orchestrator-auth/` 需要接 `NANO_AGENT_DB`、`PASSWORD_SALT`、`WECHAT_APPID`、`WECHAT_SECRET`、`JWT_SIGNING_KEY_<kid>`、`NANO_INTERNAL_BINDING_SECRET`，并显式复用 `workers/agent-core/src/host/internal-policy.ts` 的 single-caller enforcement pattern；P2-02 也明确 orchestrator 只保留 verify fast-path 且共享同一组 signing keys。Kimi 关于 verify fast-path / default team / caller enforcement 的相关意见一并吸收。 | `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md` |
| R17 | Z4 evidence pack 模板未冻结 | `fixed` | Z4 P4-01 已把 evidence 模板最小字段集写死：环境、commit SHA、worker version、测试账户、步骤、`trace_uuid/session_uuid`、失败与修复摘要；P4-02 也把 residual inventory 标签冻结为 `[blocker] / [follow-up] / [wont-fix-z4]` + fixed/deferred/next-phase required 映射。DeepSeek/Kimi 对 evidence pack 与 triage 规范的同类问题一起关闭。 | `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md` |
| R18 | Z3 preview 环境 Workers AI binding 未验证 | `fixed` | 作为 action-plan 文档问题已修：Z3 风险表明确补入 preview inference 的计费 / rate-limit 风险，并要求长跑测试优先走 mock/fallback，真实 Workers AI 只在 closure smoke 做少量验证。 | `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md` |
| R19 | Z2 RPC kickoff 未引用 nacp-core primitives | `fixed` | Z2 P4-01 已显式引用 `packages/nacp-core/src/transport/{service-binding,do-rpc}.ts`，要求复用 precheck primitive，不在 worker 内重造 envelope 校验。 | `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md` |
| R20 | Z1 P1-01 contract package 接口未枚举 | `fixed` | Z1 P1-01 现已枚举 contract package 的最小接口集：`Register/Login/Refresh/Me/ResetPassword/WechatLogin/VerifyApiKey` request/response、`AuthEnvelope`、`AuthErrorCode`。 | `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md` |

**补充：DeepSeek / Kimi 独有编号的处理**

- **Kimi R2（`Z2-session-truth-and-audit-baseline.md4` typo）**：`rejected`。这是旧 review 遗留；当前真实文件已是 `.md`，本轮无需再改 action-plan 本体。
- **Kimi R11（`packages/llm-wrapper/**` 适配层顾虑）**：`fixed`。Z3 P2-01 已补明：zero-to-real mainline 以 `workers/agent-core/src/llm/**` 为 runtime boundary；若复用 `packages/llm-wrapper/**`，也必须经 `workers-ai` adapter，不能把 Workers AI 强塞回 `baseUrl + apiKeys` fetch-only 假设。
- **Kimi R12（Z5 引用未来 closure 文件）**：`rejected`。这些 closure 文档本来就是 Z0-Z4 执行后的预期产物，不是 action-plan 自身的路径错误；本轮仅把 Z5 completion audit 的输入表达改成 `Z0-closure.md ... Z4-closure.md` 的明确集合。
- **DeepSeek R6（DO storage migration 表述漂移）**：`fixed`。Z2 已把 DO hot-state 收敛到 Q6 的四组集合，并显式要求“清空 DO storage 后可从 D1 重建”；durable owner 仍是 D1，不再让 migration 语义与 DO state 混写。
- **DeepSeek R9（WeChat 仅写 code-level smoke，缺失败回滚证明）**：`fixed`。Z1 Phase 4 已新增 `jscode2session` 成功但后续 D1 写入失败时的回滚证明，并把“失败不留脏中间态”写入收口标准。
- **DeepSeek R10（`nano_tenant_secrets` 是否误入 Wave C）**：`fixed`。Z3 P4-01 已显式声明 `nano_tenant_secrets` first-wave out-of-scope。
- **DeepSeek R13（Z5 metadata `type` 应为 `update`）**：`fixed`。Z5 文件头已改正。
- **DeepSeek R14（S/M/L 粒度映射过粗）**：`rejected`。这属于 planning 颗粒度偏好，不会制造执行歧义，也不影响当前 gate truth；本轮不再为此重排整套 phase sizing。

### 6.3 变更文件清单

- `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md`
- `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
- `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`
- `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`
- `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md`
- `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md`
- `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`

### 6.4 验证结果

```text
1. git --no-pager diff --check -- docs/action-plan/zero-to-real docs/design/zero-to-real/ZX-d1-schema-and-migrations.md docs/eval/zero-to-real/Z0-ZX-action-plan-reviewed-by-opus.md
   -> exit 0（无 whitespace / patch hygiene 问题）

2. rg "nano_usage_ledger|nano_sessions|nano_session_turns|nano_session_messages|nano_session_contexts" docs/action-plan/zero-to-real docs/design/zero-to-real/ZX-d1-schema-and-migrations.md
   -> no matches（旧表名已从 action-plan / ZX-D1 主体清出）

3. rg "beforeLlmInvoke|quota\\.deny|QUOTA_EXCEEDED|JWT_SIGNING_KEY_<kid>|Vite \\+ Vanilla TypeScript|微信原生|conversation_index<=200|wrangler d1 migrations apply NANO_AGENT_DB" docs/action-plan/zero-to-real docs/design/zero-to-real/ZX-d1-schema-and-migrations.md
   -> expected matches in Z1 / Z2 / Z3 / Z4 / ZX-D1（新 freeze 点均已落文）

4. git --no-pager diff --stat -- docs/action-plan/zero-to-real docs/design/zero-to-real/ZX-d1-schema-and-migrations.md
   -> 7 files changed, 140 insertions(+), 94 deletions(-)
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. 本轮是文档级收口，不涉及真实 worker/runtime 代码实施；因此像 migration owner 最终物理归属、Workers AI preview 计费预算等，仍要在执行期按当前 design/charter 再落一轮代码事实。
  2. 若后续 design/charter 再变更（尤其是 D1 owner boundary 或 LLM mainline provider），需要先回写 source-of-truth，再重跑本 review 的文档一致性校验。

## 9. 对 Opus 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-25`
> 评价依据: `本文档 §0–§5；本文档 §6 的实现者回应；当前 action-plan / ZX-D1 / ZX-qna / package.json / 5-worker 代码事实`

### 9.1 一句话评价评审风格
Opus 的审查风格是**高密度工程审计型**：证据链最完整、优先级排序最准、能把 review 直接压成可执行修文清单，但少数 finding 因设计文档后续已更新而变成了“当时合理、落地时过期”的结论。

### 9.2 优点
1. **证据组织能力最强**：脚本语义、表名树、代码路径、QnA 约束、charter gate 被统一拉到一个审查坐标系里，几乎每个核心 finding 都有直接 grep/ls/file:line 依据。
2. **优先级排序优秀**：把 `test:cross`、两处表名漂移、model freeze 放在最前，实际证明这几个就是最先需要修的上游污染项。
3. **修法建议可执行性很高**：大量建议都能直接翻译成 action-plan 文案修改，review 到 patch 的路径很短。

### 9.3 缺点
1. **个别 finding 会被后续文档演进淘汰**：R7、R15 在实现者回头核实时已经属于旧版 source-of-truth 残影，不应再按 blocker 对待。
2. **少数建议略带“指定方案”色彩**：如 R4 的 migration owner、R5 的具体 model 推荐，帮助很大，但已经接近架构选择而非纯审查判断。
3. **报告密度非常高**：适合严肃收口，但对快速 review 循环来说阅读和吸收成本较高。

### 9.4 对审查报告中的问题的清点

| 问题编号 | 原始严重程度 | 该问题的质量 | 分析与说明 |
|----|------|------|------------------|
| R1 | high | 高质量有效 | 准确抓到 `test:cross` 语义错配，直接修正了 Z1-Z5 的回归口径。 |
| R2 | high | 高质量有效 | conversation-centered schema 漂移是最核心的 Z2 blocker 之一。 |
| R3 | high | 高质量有效 | usage/quota 表名分叉真实存在，且会污染 Wave C migration。 |
| R4 | high | 中质量、部分有效 | 真实抓住了 migration owner / runner 歧义，但推荐“迁到 auth worker”过于具体，和最终 shared-baseline 口径不完全一致。 |
| R5 | high | 高质量有效 | model ID 未冻结是真问题，且对 Z3 影响巨大。 |
| R6 | medium | 高质量有效 | D1 binding / migration tool 明写是执行前必须补的文档事实。 |
| R7 | medium | 低质量、已过期 | 依赖旧版 ZX-D1 表数事实；到实现者核对时已不再成立。 |
| R8 | medium | 高质量有效 | shim retire deadline 从风险提醒提升为 closure gate，这条很有价值。 |
| R9 | medium | 高质量有效 | parity proof 三条件直接提升了 Z2 RPC kickoff 的可验证性。 |
| R10 | medium | 高质量有效 | quota gate 落点 fuzzy 是真实问题，后来也被补成对称 hook。 |
| R11 | medium | 高质量有效 | `quota.deny` event kind / severity freeze 是很好的 observability-grade 要求。 |
| R12 | medium | 高质量有效 | client stack freeze 的提醒非常到位，直接减少 Z4 开工时的分歧。 |
| R13 | medium | 高质量有效 | activity log 字段链式延迟是真问题，且后来必须回写 ZX-D1 才能收口。 |
| R14 | medium | 高质量有效 | Z0 不能只 audit 不能补 freeze，这条判断对整个 pack 的治理质量提升最大。 |
| R15 | medium | 低质量、已过期 | charter `§10.1 Primary Exit Criteria` 在核实时已存在，因此“ground truth 不存在”不再成立。 |
| R16 | medium | 高质量有效 | orchestrator-auth single-caller / binding / verify fast-path 关系需要写实，这条非常实用。 |
| R17 | low | 高质量有效 | evidence pack 模板虽非 blocker，但一旦补上能显著提升 Z4/Z5 收口质量。 |
| R18 | low | 中质量有效 | preview inference 计费 / rate-limit 风险判断合理，但更多属于运营提醒而非 action-plan correctness。 |
| R19 | low | 高质量有效 | 明确引用 nacp-core transport primitive 是很好的“避免重造轮子”提醒。 |
| R20 | low | 高质量有效 | contract package 接口枚举虽小，但对 typed RPC 边界非常有帮助。 |

### 9.5 评分 - 总体 ** 9.2 / 10 **

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 10 | 三角交叉了文档、代码、脚本语义，证据最硬。 |
| 判断严谨性 | 9 | 大多数判断都准确，少数因 source-of-truth 演进而过期。 |
| 修法建议可执行性 | 9 | 很多建议可直接变成 patch。 |
| 对 action-plan / design 的忠实度 | 9 | 基本忠于 current truth，少数条目带入了 reviewer 自己更偏好的方案。 |
| 协作友好度 | 8 | 质量高，但密度和长度较大，对快速协作有阅读成本。 |
| 找到问题的覆盖面 | 10 | 三份 review 里覆盖最全，且主次分明。 |
