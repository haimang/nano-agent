# Nano-Agent `hero-to-pro` 阶段 Charter

> **适用范围**:`phase charter`
> **不适用范围**:`auto-generated registry | code review | closure memo | handoff memo | design doc | action-plan`

---

# `hero-to-pro:从 first-wave runtime substrate 到成熟 LLM wrapper`

> **文档对象**:`nano-agent 6-worker + NACP + Workers AI 架构在 real-to-hero 之后的下一个产品基线`
> **状态**:`draft`
> **日期**:`2026-04-30`
> **作者**:`Claude Opus 4.7(基于 6 份 hero-to-pro 前置 study + 25 份 zero-to-real/real-to-hero closure 全量审计 + 当前真实 6-worker 代码碰撞)`
> **文档性质**:`phase charter`
> **文档一句话定义**:`让 nano-agent 第一次具备 Claude Code / Codex / Gemini CLI 同档位的 LLM wrapper 控制平面,完成 4 套产品状态机闭环,并系统性收口 zero-to-real + real-to-hero 留下的 105 项 deferred 残留。`
>
> **修订历史**:
> - `2026-04-30 v0.draft — 首版,基于 closing-thoughts-part-1 + part-2 合成`
> - `2026-04-30 v0.draft-r1 — 基于 GPT 审查(R1-R9)修订:R1 HP1 补 checkpoint/restore schema、R2 migration 编号 007-013 校准、R3 HP0 Reality Snapshot 与已完成项区分、R4 文档数量 17→18、R5 manual evidence 硬闸口径统一、R6 F13 表述弱化、R7 R2 retention/provenance schema 补齐、R8 加 DDL Freeze 受控例外、R9 Part1/Part2 编号说明`
>
> **直接输入包(authoritative)**:
> 1. `docs/eval/hero-to-pro/closing-thoughts-part-1-by-opus.md` — Model/Context/Chat 三套状态机切分
> 2. `docs/eval/hero-to-pro/closing-thoughts-part-2-by-opus.md` — Tool/Workspace 状态机 + chronic deferral 收口 + 文档+evidence
> 3. `docs/eval/hero-to-pro/agentic-loop-api-study-by-{deepseek,GLM,GPT}.md` — 3 家 API 面 gap 调查
> 4. `docs/eval/hero-to-pro/llm-wrapper-study-by-{deepseek,GLM,GPT}.md` — 3 家 wrapper 机制 gap 调查
> 5. `docs/issue/zero-to-real/zero-to-real-final-closure.md` — zero-to-real partial-close §4 deferred items 15 项
> 6. `docs/issue/real-to-hero/RH0-RH6 closure / RHX1-RHX2 closure` — 阶段 §4 carry-over 累计
> 7. 当前 6-worker 真实代码(`workers/orchestrator-core / orchestrator-auth / agent-core / bash-core / context-core / filesystem-core`)
>
> **ancestry-only / 背景参考(不作为直接入口)**:
> - `docs/charter/plan-real-to-hero.md`(real-to-hero charter,本阶段直接承接的 charter)
> - `docs/charter/plan-zero-to-real.md`(zero-to-real charter,业务 surface 边界)
> - `docs/charter/plan-worker-matrix.md`(6-worker 拓扑边界)
> - `context/claude-code/`、`context/codex/`、`context/gemini-cli/`(三家 reference agent CLI,用于产品状态机对照)
>
> **下游预期产物**:
> - 各 phase design doc(`docs/design/hero-to-pro/HP*-*.md`)
> - 各 phase action-plan doc(`docs/action-plan/hero-to-pro/HP*-*.md`)
> - 各 phase closure doc(`docs/issue/hero-to-pro/HP*-closure.md`)
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`(阶段最终收口)
> - `docs/charter/plan-hero-to-platform.md`(下一阶段入口 stub,本阶段 HP10 创建)

---

## 0. 为什么这份 charter 要现在写

### 0.1 当前时点的根本原因

real-to-hero 阶段(RH0-RH6 + RHX1-RHX2)已经在 2026-04-30 完成 RHX2 收尾。当前 nano-agent 具备:**6-worker 拓扑 + NACP 协议 + Workers AI live loop + D1 product truth + DO checkpoint + RHX2 三层 observability**。但 6 份 hero-to-pro 前置 study 与对 25 份 zero-to-real/real-to-hero closure 的深度审计共同得出一个无法回避的结论:

> **当前 API 适合"启动一条会话并读回流",不适合"用户可控、可回滚、可审计、可跨模型切换、可主动压缩、可管理工具与临时工作区"的成熟 agentic loop 产品。**

charter 必须现在写,因为:

1. real-to-hero 已经收尾,继续散乱地补端点会让"hero" 名称与产品事实持续漂移;
2. zero-to-real + real-to-hero 留下的 105 项 deferred 残留中,有 17 项 chronic deferral(双层/三层/最高六层 carryover),不在本阶段系统收口将永久成为 hero-to-platform inherited issue;
3. 4 套产品状态机(Model / Context / Chat / Tool-Workspace)是"成熟 LLM wrapper" 的统一审视维度,不应被打碎成无关 sprint;
4. `clients/api-docs/` 11 份文档与代码越走越远(RHX2 已暴露"stub ack 误读为压缩完成"风险);
5. Hook dispatcher 实例注入(F12)、`pushServerFrameToClient` round-trip e2e(F13)等 wire-without-delivery gap 必须在产品基线封板前消除。

### 0.2 这份文档要解决的模糊空间

1. **hero-to-pro 与 hero-to-platform 的边界究竟在哪** — multi-provider / sub-agent / admin / billing 是 hero-to-pro 还是 hero-to-platform?(本 charter 给出明确二分)
2. **chronic deferrals 的最终命运** — F1 manual evidence 五阶段 carryover、F15 R29 deceptive closure 等是继续 silently 漂着,还是必须 explicit-resolve 或 explicit-handoff?(本 charter 强制 explicit)
3. **DDL 改动应该集中还是散布** — 4 套状态机各自需要 DDL,是每 phase 各自加 migration,还是统一在前置 phase 一次性收口?(本 charter 选择 HP1 集中)
4. **`clients/api-docs/` 文档轮次的时点** — 是每个 phase 完成时同步更新,还是统一在晚期一次性 review?(本 charter 选择晚期 HP9 集中)
5. **Tool/Workspace 状态机里的 todo / temp file / artifact promotion 三件套到底是同一 phase 还是分开** — 三家 reference 产品语义紧耦合,本 charter 决定 HP6 整合处理。
6. **F4 Lane E sunset 是真 sunset 还是 permanent fallback** — 取决于 F14 R28 deploy bug 能否定位。本 charter 在 HP9 内强制做出二选一,不再无限 shim。

### 0.3 这份 charter 的职责,不是别的文件的职责

- **本 charter 负责冻结**:
  - hero-to-pro 阶段的中心命题(成熟 LLM wrapper 控制平面)与一句话目标
  - 4 套产品状态机的 in-scope 边界与对 hero-to-platform 的 out-of-scope 划线
  - 11 个 phase(HP0 → HP10)的职责边界、进入条件、收口标准
  - chronic deferrals(F1-F17)在哪个 phase 终结或显式 handoff
  - 不能跳过的 gate(DDL 集中、e2e 文件落地、文档晚期收口)
- **本 charter 不负责展开**:
  - 各 phase 的具体设计与端点 schema(应在 `docs/design/hero-to-pro/HP*-*.md`)
  - 各 phase 的逐任务执行 plan(应在 `docs/action-plan/hero-to-pro/HP*-*.md`)
  - 各 phase 的执行过程证据与回填(应在 `docs/issue/hero-to-pro/HP*-closure.md`)
  - 各 phase 的 Q&A 详细回答(应在各 phase design doc 自身的 Q&A 章节;本 charter §12 仅冻结跨 phase 决策)

### 0.4 关于 Part 1 / Part 2 输入文档的编号说明(R9)

`closing-thoughts-part-1-by-opus.md` 与 `closing-thoughts-part-2-by-opus.md` 是本 charter 的 pre-charter 输入文档。其中的 phase 编号(Part 1 HP0-HP6 + Part 2 HP5-HP10)是构思阶段编号,**已在本 charter 重排**:

- Part 1 HP0(原"DDL 集中")并入本 charter HP1。
- Part 2 HP5(原"Tool/Workspace")在本 charter 重排为 HP6;Part 2 HP6(原"Confirmation")在本 charter 重排为 HP5。
- 部分 in-scope 项目(如 file shadow snapshot)在 Part 1/Part 2 边界上,本 charter 统一归入 HP7。

**执行时以本 charter §6-§7 的 HP0-HP10 编号为唯一准绳**;Part 1/Part 2 仅作 pre-charter 思路追溯,不应作为 action-plan 编号依据。

---

## 1. 本轮已确认的 Owner Decisions 与基石事实

### 1.1 Owner Decisions(直接生效)

| 编号 | 决策 | 影响范围 | 来源 |
|------|------|----------|------|
| D1 | hero-to-pro 不新增 worker,继续 6-worker 拓扑 | 全阶段架构 | real-to-hero closing thoughts §2 + plan-worker-matrix charter |
| D2 | hero-to-pro 不引入 SQLite-backed DO | 全阶段存储边界 | runtime-session-study(real-to-hero 时期)+ closing-thoughts-part-1 §2.3 |
| D3 | hero-to-pro 不做 multi-provider LLM,继续 Workers AI 单一 provider | LLM wrapper 边界 | closing-thoughts-part-1 §2.3 + part-2 §10 |
| D4 | hero-to-pro 不做 sub-agent / multi-agent,继续单 agent loop | kernel runner 边界 | part-2 §10 |
| D5 | hero-to-pro 不做 admin plane / billing | 产品形态边界 | part-2 §10,留 hero-to-platform |
| D6 | DDL 改动统一在 HP1 一次性收口,不散布 | 全阶段 schema 治理 | 本 charter 决断,owner 明确要求 |
| D7 | `clients/api-docs/` 文档全面更新放在晚期 phase(HP9),不每 phase 散打 | 文档治理 | owner 明确要求 |
| D8 | F4 Lane E 必须在 hero-to-pro 内二选一终态(sunset 或 permanent fallback),不再无限 shim | 架构债务 | part-2 §6.4 |
| D9 | F15 R29 deceptive closure(`resolved-by-deletion-not-fix`)必须显式 postmortem,不允许 silent inherit | 架构债务 | part-2 §6.2 |
| D10 | manual evidence pack(F1+F2)必须 owner 配合在 HP9 完成,不再传给 hero-to-platform | owner-action | part-2 §7.2 |

### 1.2 已冻结的系统真相

| 主题 | 当前真相 | 本阶段如何继承 |
|------|----------|----------------|
| 6-worker 拓扑 | `orchestrator-core / orchestrator-auth / agent-core / bash-core / context-core / filesystem-core` | 不动边界,所有新工作分配到现有 worker |
| 三层真相 | D1 = product durable truth;DO storage = hot/runtime;DO memory = active loop state | 所有 DDL 与状态新增严格遵守,不向 DO storage 倾倒 D1 truth |
| NACP session schema | `packages/nacp-session` 已支持 13 种消息 + 9 种 stream event kind | 新 confirmation/todo/workspace 事件新增至 schema,不破坏 backward compat |
| RHX2 dual-emit window | `system.error` + `system.notify(error)` 双发期 active,end-date 未定 | 本阶段继续 dual-emit;Part 2 显式 out-of-scope 单发切换 |
| Workers AI 模型目录 | D1 `nano_models` 已 seed 多个 Workers AI 模型(在 `003-usage-quota-and-models.sql` 内,本 charter 不假设确切条数,以仓库实际为准);`/models` 端点 ETag + team policy filter | HP1 扩展字段,不新建表 |
| GitHub Packages publish scope | `@haimang/*`(不是 `@nano-agent`,GitHub namespace 冲突) | 继续沿用 |
| jwt-shared lockfile | real-to-hero P0-A 已修复 standalone build/test | 本阶段不再担心 |
| modelCatalogDb 通电 | `runtime-assembly.ts:123-133` 已传 `NANO_AGENT_DB` 给 `createMainlineKernelRunner`,D1 模型在 LLM 调用前真加载 | 本阶段直接利用,不再修补 |
| **CONTEXT_CORE binding(R3 修订)** | `agent-core/wrangler.jsonc` root services(line ~50)与 preview services(line ~100)**均已打开**,`LANE_E_RPC_FIRST=false` env var 已在 root vars(line ~22)与 preview vars(line ~86)落位 | HP0 不再"解封 binding",改为"verify binding 存在 + binding-presence test" |
| **当前 migrations baseline(R2 修订)** | 仓库实际 migrations 为 `001-identity-core` 至 `006-error-and-audit-log` 共 6 个文件,**最新编号 006** | HP1 新 migration 从 `007` 起编号,不存在 charter 旧版暗示的 `007/008` 历史 |
| **`forwardInternalJsonShadow` 命名残留(R3 修订)** | `user-do-runtime.ts:753` 注释明确 "Method name preserved (forwardInternalJsonShadow) so call sites stay … shadow semantic is now historical, not behavioral",**已不是 fetch shadow 行为,仅是命名残留** | HP0 不直接物理删除,改为"重命名评估 + R29 postmortem 结果出来后判定";若直接删,可能丢失 R29 对照材料 |
| **`parity-bridge.ts` helpers(R3 修订)** | `logParityFailure` / `computeBodyDiff` 仍存在,但文件注释明确为 reference implementation deliberate retention | HP0 不直接删,等 HP8-B R29 postmortem 完成后判定;若 R29 选"零 diff" 则可在 HP10 cleanup 删除,若选"有 diff"或"不可验证"则保留作为重启诊断工具 |

### 1.3 明确不再重讨论的前提

1. **6-worker 拓扑** — D1 决议,plan-worker-matrix charter 已冻结。
2. **Workers AI 单 provider** — D3 决议,multi-provider 整体留 hero-to-platform。
3. **D1 = product truth 单一来源** — 三层真相在 real-to-hero Phase 6.3 已冻结,本阶段继承。
4. **NACP 协议 backward compat** — 任何新增消息族不破坏现有 13 种消息,permission/elicitation 旧端点保留双发兼容期(HP7 内)。
5. **不引入 ESLint** — real-to-hero 已决议,drift guard 用 node 脚本(`scripts/check-*.mjs`)不依赖 ESLint。
6. **published packages = `@haimang/nacp-core / @haimang/nacp-session / @haimang/jwt-shared`** — namespace 与 publish 路线已冻结。

---

## 2. 当前真实起点(Reality Snapshot)

### 2.1 已成立的 shipped / frozen truth

| 主题 | 当前现实 | 证据 |
|------|----------|------|
| Session live loop | `agent-core` Workers AI live loop + tool round-trip + quota usage commit | `runtime-mainline.ts:286-574` |
| `/models` endpoint | D1 query + team policy filter + ETag | `index.ts:1347-1426` |
| `/messages` 多模态消息 | model_id + reasoning + parts + image_url 通电 | `message-runtime.ts:134-310` |
| D1 product truth | 5 张核心表(conversations/sessions/turns/messages/snapshots)+ usage ledger + activity log + error/audit log | `migrations/001-006` 共 6 个 migration(R2 修订:实际仓库基线) |
| WS protocol | NACP frame schema gate live;heartbeat 15s timer-based | `host/do/session-do/ws-runtime.ts` |
| RHX2 observability | system.error + system.notify dual-emit;`/debug/logs` `/debug/recent-errors` `/debug/audit` `/debug/packages` 端点 live | `RHX2-closure.md` |
| Device gate | RH3 D6 device revoke 进入 access/refresh/WS auth gate | `RH3-closure.md §3` |
| File pipeline | RH4 R2 + filesystem-core RPC + `/files` 上传/下载/列表 live | `RH4-closure.md §3` |
| Workers AI model registry | D1 `nano_models` 已 seed 多个 Workers AI 模型 | `migrations/003-usage-quota-and-models.sql`(模型 seed 在此文件内,不是独立 008 文件) |
| Hibernation restore | DO `session:checkpoint` blob + `restoreFromStorage()` | `host/do/session-do-persistence.ts:142-222` |

### 2.2 当前仍然存在的核心 gap

| 编号 | gap | 为什么必须在本阶段处理 | 若不处理会怎样 |
|------|-----|------------------------|----------------|
| G1 | `/start`/`/input` public 路径丢 `model_id`/`reasoning` | K2 6 家 study 共识;3 行代码即可修;不修则 model_id 端点不一致 | 客户端无法可靠选择模型,只能走 `/messages` |
| G2 | DDL `nano_models` 字段薄(无 max_output_tokens / reasoning_efforts / effective_context_pct / auto_compact_token_limit / fallback / input_modalities / base_instructions_suffix) | K3 6 家共识;Context 状态机依赖 model metadata | 自动压缩无法 per-model 触发,模型切换无 context 适配 |
| G3 | context-core 3 RPC 全部 `phase: "stub"` | K1 6 家共识;`/context/probe` `/compact/preview` `/compact` 无真实数据 | 长对话必然超 context window 溢出,无降级 |
| G4 | `compactRequired` 永远 false,CompactDelegate 返回 `{tokensFreed:0}` | K1/K8 共识;无压缩闭环 | 同 G3 |
| G5 | 无 cross-turn history 进入 LLM prompt | K4 共识;LLM 看不到上一 turn,看似 chat 实则 single-turn | chat 体验失忆 |
| G6 | 无模型切换语义(`<model_switch>` developer message + reasoning effort 重映射) | K7 共识 | LLM 切换模型后混淆,reasoning effort 静默 ignore |
| G7 | Permission/elicitation kernel interrupt 不存在(`approval_pending` 枚举存在但永不触发);hook dispatcher 实例无注入(F12 慢性五阶段) | K6 共识 + F12 chronic deferral | tool 在 ask policy 下不暂停,permission 协议形同虚设 |
| G8 | `pushServerFrameToClient` 已有 RPC 路径(`ORCHESTRATOR_CORE.forwardServerFrameToClient`),但缺真实 permission/elicitation/usage round-trip cross-e2e 证明;P1-10/P1-11/P1-12/usage-push round-trip e2e 文件不存在(F13 慢性四阶段)— 在 e2e 文件落地前不得宣称 delivered path closed(R6 修订) | RH1 closure §3 + 本机 `test/cross-e2e/` 14 个文件中无 round-trip 四件套 | Lane F live runtime 永远无 e2e 保护 |
| G9 | 无产品级 checkpoint revert / rollback / fork | K5 共识 | 用户无法回到第 N turn 重做 |
| G10 | 无 todo/plan API(K9)、无 workspace temp file CRUD(K10)、无 tool inflight 列表 | 三家 reference 全都有,nano-agent 完全空白 | 不是成熟 agent,只是 chatbot 底座 |
| G11 | 无统一 confirmation control plane(model_switch / compact / fallback / restore 各自为政) | GPT 7.4 提议 + Part 2 §4.3 | 新增 confirmation kind 必须扩散 4 个端点 |
| G12 | `clients/api-docs/` 11 份文档与代码漂移;`/context/compact` 返 `compacted:true` 但实际 stub | RHX2 已暴露;Part 2 §7.1 首版列出 17 份文档需求,本 charter r1 已校正为 18 份目标 | 客户端开发者再次被 stub 误导 |
| G13 | `turn_index UNIQUE` 阻止 retry/重试 | K16 共识 | 失败 turn 重试触发 D1 唯一冲突 |
| G14 | F14 R28 verify-cancel deploy 500 root cause 未定位 | 慢性三阶段;owner-action runbook stub | Lane E 无法确定能否真 sunset |
| G15 | F15 R29 verify-initial-context 502 — `resolved-by-deletion-not-fix` | deceptive closure flag | 不允许"删除检测 = 修 bug" 成为先例 |
| G16 | F1 manual evidence + F2 WeChat 真机 smoke 五/六阶段 carryover | owner-action;最后一笔 evidence 债务 | 产品基线封板时仍无真实设备验证 |
| G17 | `forwardInternalJsonShadow` / `parity-bridge.ts` dead code、3 envelope type 漂移、user-do-runtime 行数回涨(1049→1171) | G/F5 残骸 | 持续性维护成本 |

### 2.3 本阶段必须拒绝的错误前提

- **错误前提 1**:"Lane E 短期 shim ≤2 周即可终态"
  **为什么错**:ZX5 标 ≤2 周,实际已超 ~6 个月。本阶段 HP9 必须二选一终态(sunset 或 permanent fallback),不允许再 shim。
- **错误前提 2**:"删除 parity 检测代码 = 解决 R29 divergence"
  **为什么错**:ZX4 P9 删除检测后 502 不再触发,但 divergence 即使存在也不再被检测。HP9 必须显式 postmortem 真根因。
- **错误前提 3**:"已经有 LLM wrapper 等于产品级 LLM wrapper"
  **为什么错**:agent-core 有 model registry / request builder / Workers AI gateway / tool round-trip,但缺 model state machine / context 治理 / compaction / model switch / user confirmation / checkpoint+revert / durable audit;前者完成不等于后者完成。
- **错误前提 4**:"DO `session:checkpoint` 是 product checkpoint"
  **为什么错**:它是 hibernation 内部状态(单 blob,只保留最新),不是用户可见 checkpoint timeline。HP4+HP7 必须建立独立 product checkpoint。
- **错误前提 5**:"`/sessions/{id}/files` 等于 workspace API"
  **为什么错**:它是 artifact API(用户上传 + tool generated 长期产物),不是 agent 临时 scratch file CRUD。HP6 必须建立独立 workspace temp file 命名空间。
- **错误前提 6**:"hook dispatcher 已经 wire 完成"
  **为什么错**:wire 完整,但 `hooks/permission.ts` 无调用方,跨 ZX5 → RH6 五阶段 silently 漂着。HP7 必须真接通。
- **错误前提 7**:"`pushServerFrameToClient` 已经 live"
  **为什么错**:RH3 已修 user_uuid 投影,但 P1-10/P1-11/P1-12 round-trip e2e 文件至今不在 `test/cross-e2e/`。无 e2e 保护 = 未 live。

---

## 3. 本阶段的一句话目标

> **阶段目标**:让 nano-agent 第一次具备 Claude Code / Codex / Gemini CLI 同档位的 LLM wrapper 控制平面 — Model / Context / Chat / Tool-Workspace 4 套产品状态机闭环 + zero-to-real/real-to-hero 105 项 deferred 残留全部 explicit-resolve 或 explicit-handoff。

### 3.1 一句话产出

完成 11 个 phase(HP0-HP10)、4 套状态机硬闸、18 份 `clients/api-docs/` 与代码 100% 对齐、`hero-to-pro-final-closure.md` + `plan-hero-to-platform.md` 入口 stub。

### 3.2 一句话非目标

**不**做 multi-provider LLM、**不**做 sub-agent、**不**做 admin plane / billing、**不**新增 worker、**不**引入 SQLite-DO、**不**做完整 SDK extraction、**不**做完整 handler-granularity refactor。

---

## 4. 本阶段边界:全局 In-Scope / Out-of-Scope

### 4.1 全局 In-Scope(本阶段必须完成)

| 编号 | 工作主题 | 为什么必须在本阶段完成 | 对应 Phase |
|------|----------|------------------------|------------|
| I1 | **HP0 前置 defer 修复** — `/start`/`/input` model_id 透传、per-model system prompt suffix 骨架、binding-presence verify、jwt-shared dynamic import 评估、R29-dependent dead code cleanup 决议准备、archive runbook 删除 | "可以立刻完成的 defer 项" 必须在 4 套状态机展开前清掉,避免每 phase 被同泥泞拖慢 | HP0 |
| I2 | **HP1 DDL 集中扩展** — model metadata(7 字段)+ session/turn 模型审计(6 字段)+ alias 表 + todos + temp_files + confirmations + turn_attempt + message superseded marker | DDL 改动一次性完成,后续 phase 不重复 migration;owner D6 决断 | HP1 |
| I3 | **HP2 Model 状态机** — 4 层模型状态、`/sessions/{id}/model`、`/models/{id}`、alias、`<model_switch>`、fallback audit | K2/K7 + Model state machine 必须 | HP2 |
| I4 | **HP3 Context 状态机** — context-core 解 stub、cross-turn history、auto-compact、`/context/probe`、`/compact/preview`+job、layers | K1/K4/K8/K13 + Context state machine 必须 | HP3 |
| I5 | **HP4 Chat 生命周期** — close/delete/title/retry、cursor pagination、conversation-level view | K11 + Chat state machine 子集 | HP4 |
| I6 | **HP5 Confirmation control plane + Hook dispatcher 真接通 + F12/F13 closure** — 7 类 confirmation kind 统一端点、hook dispatcher 实例注入、4 个 round-trip e2e | F12/F13 慢性五/四阶段必须终结 | HP5 |
| I7 | **HP6 Tool/Workspace 状态机** — todo + workspace temp file CRUD + tool inflight + workspace→artifact promotion | K9/K10 + Tool-Workspace state machine 必须 | HP6 |
| I8 | **HP7 Checkpoint 全模式 revert** — conversation_only + files_only + conversation_and_files + session fork + R2 file shadow snapshot | K5 + Chat/Context state machine 收尾 | HP7 |
| I9 | **HP8 Runtime hardening + chronic deferrals 系统收口** — F14 R28、F15 R29 postmortem、F6 alarm 化、F4 Lane E 终态、F5 行数 stop-the-bleed gate、F8 tool catalog SSoT、envelope 收敛 | 慢性 deferral 不能再传站 | HP8 |
| I10 | **HP9 `clients/api-docs/` 全面更新 + manual evidence pack** — 18 份文档对齐 + F1/F2 5 套设备 evidence + F16 prod schema baseline | owner D7 决断,文档晚期集中 | HP9 |
| I11 | **HP10 Final closure** — `hero-to-pro-final-closure.md` + `plan-hero-to-platform.md` 入口 stub + 残余 cleanup 决议后可删项物理删除 | 阶段封板 | HP10 |

### 4.2 全局 Out-of-Scope(本阶段明确不做)

| 编号 | 项目 | 为什么现在不做 | 重评条件 / 下游落点 |
|------|------|----------------|----------------------|
| O1 | Multi-provider LLM routing(DeepSeek/OpenAI/Anthropic adapter) | 4 套状态机 × N provider 会爆增边界设计;Workers AI 13+ 模型已覆盖核心需求 | hero-to-platform 第一优先 |
| O2 | Sub-agent / multi-agent(Codex `Op::MultiAgentsSpawnV2`、Gemini sub-agent) | 引入会改变 6-worker 拓扑事实(可能需 spawn DO),与 D1 决议冲突 | hero-to-platform |
| O3 | Admin plane(API key list/create/revoke UI、模型 catalog 管理、team management) | 与 wrapper 控制面正交;owner D5 | hero-to-platform |
| O4 | Billing / cost-aware quota / per-model pricing / token 单价 / 配额预警 | 同 O3 | hero-to-platform |
| O5 | Remote ThreadStore API(Codex 跨设备 session resume) | D1 truth + DO restoreFromStorage 已部分覆盖 | hero-to-platform |
| O6 | 完整 SDK extraction(F8 升级路径) | HP8-G 已做 tool catalog,SDK 包发布是 platform 工程 | hero-to-platform |
| O7 | 完整 handler-granularity refactor(F5 升级路径) | HP8-E 只做行数 stop-the-bleed gate,完整 refactor 排他工作量大 | hero-to-platform |
| O8 | WORKER_VERSION CI 切换(从 owner-local 到 GitHub Actions git-sha) | 与 wrapper 收口正交;ZX5 D1 manual 路径够用 | hero-to-platform |
| O9 | 3-tier observability spike → 单发切换(RHX2 deferred) | 等真实客户端数据观察;dual-emit 窗口未到准入 | dual-emit window 关闭后独立 PR |
| O10 | Prompt caching / structured output | 依赖 multi-provider 路由先到 | hero-to-platform |
| O11 | Sandbox 隔离 / streaming progress for bash | bash-core fake 实现已能支撑 demo | hero-to-platform 或独立 hardening |
| O12 | SQLite-backed DO(user-do KV 升 SQLite) | runtime-session-study 否决;list/分页用 KV cursor + D1 keyset 即可 | hero-to-platform |
| O13 | F10 multi-tenant per-deploy / 更深 internal RPC 演进 | 与 wrapper 收口正交 | hero-to-platform tenancy |
| O14 | F11 client package extraction(JS shim) | Z5 priority 5 silent dropped,平台级工程 | hero-to-platform 或独立 client SDK |
| O15 | TodoWrite tool 升级到 task graph V2(parent-child execution + sub-task spawn) | HP6-A 只做 V1 flat + 简单 parent_uuid;V2 task graph 涉及 sub-agent | hero-to-platform |

### 4.3 灰区判定表(用来消除模糊空间)

| 项目 | 判定 | 判定理由 | 若要翻案,需要什么新事实 |
|------|------|----------|--------------------------|
| `<model_switch>` developer message 注入 | `in-scope` | K7 共识,Codex 范式;Workers AI 模型对 system prompt 上下文理解差异显著,不注入会让 LLM 误解 | 若 LLM 对模型切换 zero impact 实测 |
| File revert(restore 三模式 conversation_and_files) | `in-scope (HP7)` | Gemini CLI 范式;completes Chat 状态机的 file 维度 | 若 owner 接受"product checkpoint 仅限 conversation_only" |
| Session fork | `in-scope (HP7)` | Codex `thread/fork` 范式;A/B 调试核心 UX | 若工作量超 5 天,降级为可选 |
| 通用 `/confirmations` 端点 | `in-scope (HP5)` | GPT 7.4 提议;7 类 confirmation kind 散布到 4 个端点会持续散乱 | N/A |
| Permission/elicitation 旧端点物理删除 | `defer / later-phase` | HP5 内只做 redirect 兼容期;3 个月后(可选)删除,但本阶段 HP10 不强制 | 若客户端在 HP9 都已迁移 |
| Tool registry 真 SDK 包发布 | `out-of-scope` | F8 升级路径,HP8-G 只做 catalog 化 + drift guard | hero-to-platform |
| 自动 session title 生成(LLM summary) | `defer / later-phase` | Gemini `SessionSummaryService`;HP4 只支持手动 PATCH title | hero-to-platform 或独立 polish PR |
| Logout endpoint(显式) | `out-of-scope` | device revoke 已覆盖核心;显式 logout 是 v2 polish | hero-to-platform |
| F2 WeChat 真机 smoke | `in-scope (HP9)` | 六阶段 chronic carryover,owner D10 决断必须完成 | N/A,owner 必须配合 |
| `forwardInternalJsonShadow` 物理删除 | `conditional in-scope (HP10 after HP8-B)` | 仅在 R29 postmortem 判定可删时进入 cleanup | 若 R29 判定需保留 reference implementation |
| `docs/runbook/zx2-rollback.md` 物理删除 | `in-scope (HP0)` | archive 日期 2026-05-12 已过 | 若 owner 决定保留为永久档案 |
| WeChat miniprogram 完整适配 | `defer / later-phase` | RHX2 §5 已 explicit defer 到独立适配专项 | 客户端适配独立 plan |
| F2 真机 smoke 与 WeChat miniprogram 适配的关系 | `两者分离` | F2 是已有最简 client 的真机回归;miniprogram 适配是新写完整客户端;HP9 只做 F2 evidence,不做完整适配 | N/A |

### 4.4 必须写进 charter 的硬纪律

1. **DDL 集中纪律(R8 修订)** — 任何新 D1 表 / 列 必须进入 HP1 集中 migration;后续 phase(HP2-HP10)默认严禁加新 migration 文件,只允许在 HP1 已落表上写数据。**受控例外**:若 HP3-HP7 业务执行中发现 HP1 schema 真实 blocker(且 charter §13.1 HP1 design doc review 时未识别),处理流程为:① 不允许私自加 migration;② 必须先 owner 批准并修订本 charter §7.2 + HP1 schema doc + 标 `HP1 schema correction`;③ 新 migration 编号继 HP1 序列(`014-...` 起);④ 在 HP10 final closure 中显式登记 schema correction 列表与原因;⑤ prod apply 仍由 HP9 baseline 统一验证。常规 DROP COLUMN 等清理仍允许在 HP10 进行。
2. **e2e 文件落地纪律** — 任何 phase 宣称"端点 live" 必须有对应 `test/cross-e2e/*.test.mjs` 文件落地;HP5 必须补齐 P1-10/P1-11/P1-12 三个 round-trip e2e 文件(本机已验证缺失)。
3. **`clients/api-docs/` 后置纪律** — HP2-HP8 不更新 `clients/api-docs/`(允许写 design 文档作为内部参考),HP9 一次性集中更新 18 份。
4. **manual evidence 强制纪律** — HP9 不通过 owner 的 manual evidence pack 配合,Charter §10.3 NOT-成功退出识别会立即 trigger,HP10 final closure 不得放行。
5. **chronic deferral explicit 纪律** — F1-F17 每项必须在指定 phase 终结或显式 handoff,不允许 silent inherit;HP10 final closure 必须逐项判定。
6. **行数 stop-the-bleed 纪律** — HP8-E 加 CI gate 后,任何新 PR 不能让 nano-session-do.ts / user-do-runtime.ts / session-do/* 子文件 进一步增长。
7. **不删检测代码替代修 bug 纪律** — 受 F15 R29 教训,任何 phase 不允许"删除检测代码作为闭合 bug 的方式";若需要删除某检测,必须在 closure 内显式说明"已通过其他手段消除根因"。
8. **NACP 协议 backward compat 纪律** — 任何 phase 新增消息族不破坏现有 13 种消息;permission/elicitation 兼容路径在 HP5 内保留 redirect,本阶段不删除。

### 4.5 必须写明的例外(如有)

- **HP1 DDL 集中纪律的唯一例外**:HP9 在登记 prod schema baseline 时,若发现 prod 与 migrations/ 不一致,允许加补救 migration(但需在 HP9 closure 显式说明)。
- **e2e 文件落地纪律的唯一例外**:HP9 manual evidence 不要求 `test/cross-e2e/`(其本身就是 manual);HP10 final closure 不要求新 e2e。

---

## 5. 本阶段的方法论

| 方法论 | 含义 | 它避免的错误 |
|--------|------|--------------|
| **状态机优先** | 4 套产品状态机(Model/Context/Chat/Tool-Workspace)是 phase 切分的统一审视维度,不是端点 list | 避免"端点散打式"补 API,造成跨 phase 行为漂移 |
| **DDL 集中** | 所有 D1 表/列改动一次性在 HP1 完成,后续 phase 只写数据不改 schema | 避免每 phase 各自 migration、prod migration apply 多次 owner-action、schema 不一致 |
| **文档晚期收口** | `clients/api-docs/` 18 份文档不每 phase 同步,HP9 一次集中 review | 避免 phase 内"先做完再写文档"的 stub-doc 漂移 + 每 phase 都要 review 文档的成本爆炸 |
| **chronic explicit-only** | F1-F17 每项必须 explicit-resolve / explicit-handoff,不允许 silent inherit | 避免"传到下一阶段就好"成为习惯,杜绝五/六阶段慢性 carryover |
| **wire-without-delivery 不算闭合** | wire 完整但无调用方 / 无 e2e 不算 phase 闭合(吸取 F12/F13 教训) | 避免再次出现"基础设施 land 但无人使用"的 silent gap |
| **deception-flag** | 删除检测代码不等于修 bug;F15 R29 教训永远性反例 | 避免后续 phase 用"删除检测 = 闭合"的捷径 |
| **owner-action explicit 时点** | 每个 owner-action 必须在 charter 显式登记最晚冻结时点(per HP9 manual evidence) | 避免"等 owner 配合"成为永久占位符 |

### 5.1 方法论对 phases 的直接影响

- **状态机优先** 影响:HP2-HP4 + HP6 + HP7 共 5 个 phase 各自对应一套状态机的核心承担,HP5 是 4 套状态机的 confirmation 收拢公共层
- **DDL 集中** 影响:HP1 是阶段最大的"Big Bang migration",所有后续 phase 受其约束
- **文档晚期收口** 影响:HP9 工作量为 ~2 周,与其他 phase 并行风险低
- **chronic explicit-only** 影响:HP8 + HP9 + HP10 三个 phase 共同承接 F1-F17 的最终判定
- **wire-without-delivery 不算闭合** 影响:HP5 必须补 round-trip e2e 文件,不允许只补 hook dispatcher 注入

---

## 6. Phase 总览与职责划分

### 6.1 Phase 总表

| Phase | 名称 | 类型 | 核心目标 | 主要风险 |
|------|------|------|----------|----------|
| HP0 | 前置 defer 修复 | freeze + cleanup | `/start`/`/input` model_id 透传、per-model system prompt suffix 骨架、binding-presence verify、archive runbook 删除 | 与 HP1 DDL 集中的字段命名需提前对齐;禁止误删 R29-dependent residue |
| HP1 | DDL 集中扩展 | freeze + migration | 一次性落 4 套状态机所需全部 D1 表/列改动 | prod migration apply 是 owner-action,不能保证 HP1 closure 时 prod 同步 |
| HP2 | Model 状态机 | implementation | 4 层模型状态、`/sessions/{id}/model`、`/models/{id}`、alias、`<model_switch>`、fallback audit | DDL 已在 HP1 落表,只剩业务逻辑;低风险 |
| HP3 | Context 状态机 | implementation | context-core 解 stub、cross-turn history、auto-compact、`/context/probe`、`/compact/preview`+job、layers | 体量最大;token estimation 不准是已知风险 |
| HP4 | Chat 生命周期 | implementation | close/delete/title/retry、cursor pagination、conversation-level view、checkpoint conversation_only | turn_attempt 改造涉及 D1 唯一约束改动(已在 HP1 完成) |
| HP5 | Confirmation 收拢 + Hook dispatcher 真接通 + F12/F13 closure | implementation + chronic | 7 类 confirmation 统一端点、hook dispatcher 实例注入、4 个 round-trip e2e 文件 | hook dispatcher 改造与 HP3 kernel interrupt 协同;需在 HP3 全部 merge 后启动 |
| HP6 | Tool/Workspace 状态机 | implementation | todo + workspace temp file CRUD + tool inflight + workspace→artifact promotion | R2 multi-tenant 边界 path traversal 安全审查必须 |
| HP7 | Checkpoint 全模式 revert | implementation | files_only + conversation_and_files + session fork + R2 file shadow snapshot | R2 snapshot 成本可观;长 session 多 checkpoint 复制策略需调优 |
| HP8 | Runtime hardening + chronic 收口 | hardening + chronic | F14 R28、F15 R29 postmortem、F6 alarm、F4 Lane E 终态、F5 行数 gate、F8 tool catalog、envelope 收敛 | F14 R28 owner-action;F15 R29 可能不能定论 |
| HP9 | `clients/api-docs/` + manual evidence | docs + chronic | 18 份文档对齐 + 5 套设备 evidence + prod schema baseline | F1/F2 owner-action 必须配合 |
| HP10 | Final closure | closure | hero-to-pro-final-closure + plan-hero-to-platform 入口 stub + cleanup 决议后可删残骸删除 | 不放行未完成 chronic 与 manual evidence |

### 6.2 Phase 职责矩阵

| Phase | 本 Phase 负责 | 本 Phase 不负责 | 进入条件 | 交付输出 |
|------|---------------|----------------|----------|----------|
| HP0 | 立刻可完成的 defer 修复(K2 + K12 + binding-presence verify + archive cleanup) | DDL 改动(留 HP1)、状态机业务逻辑(留 HP2-HP6)、R29-dependent dead code 终局判定(留 HP8-B/HP10) | real-to-hero 已收尾 + RHX2 spike 双发期 active | 修复 PR + HP0-closure.md |
| HP1 | 全部 D1 表/列改动一次性落地 + 模型 metadata 扩展 seed | 业务逻辑(HP2-HP6)、prod migration apply(留 HP9 owner-action) | HP0 已 closure | migration 文件 + HP1-closure.md + 各表 schema 文档 |
| HP2 | Model 状态机 4 层闭环 + cross-turn 模型切换语义 + fallback audit | Context state(留 HP3)、checkpoint(留 HP4/HP7) | HP1 已 closure | 端点 + e2e + HP2-closure.md |
| HP3 | Context state 完整闭环(probe + compact + cross-turn history + layers) | DDL(已在 HP1)、checkpoint(留 HP4/HP7) | HP2 已 closure;`<model_switch>` 与 compact 剥离逻辑联动已对齐 | 端点 + e2e + HP3-closure.md |
| HP4 | Chat 生命周期 + checkpoint conversation_only | files revert(留 HP7)、confirmation 完整(留 HP5) | HP3 已 closure | 端点 + e2e + HP4-closure.md |
| HP5 | Confirmation 收拢 + F12 hook dispatcher + F13 round-trip e2e | Tool/Workspace(留 HP6) | HP4 已 closure;kernel interrupt 路径已通(HP3-HP4 内已有基础) | 4 个 e2e 文件 + 端点 + HP5-closure.md |
| HP6 | Tool/Workspace 状态机完整 + R2 multi-tenant 边界审查 | checkpoint files_only(留 HP7) | HP5 已 closure | DDL 已用 + 端点 + e2e + R2 namespace + HP6-closure.md |
| HP7 | Checkpoint 全模式 + session fork + file shadow snapshot | runtime hardening(留 HP8) | HP6 已 closure;workspace temp file 已 live(snapshot 依赖) | 端点 + e2e + R2 snapshot 路径 + HP7-closure.md |
| HP8 | Chronic deferrals 系统收口 + runtime hardening | docs / evidence(留 HP9) | HP7 已 closure | F14/F15 postmortem + 行数 gate CI + envelope 收敛 + Lane E 终态文档 + HP8-closure.md |
| HP9 | 18 份 `clients/api-docs/` 全部对齐 + manual evidence pack + prod schema baseline | dead code cleanup 终局决议(留 HP10) | HP8 已 closure;owner 已确认 manual evidence 时点 | 18 份 doc + evidence pack + prod schema baseline + HP9-closure.md |
| HP10 | Final closure 文档 + cleanup 决议后的残余可删项删除 + hero-to-platform 入口 stub | hero-to-platform 实质内容 | HP9 已 closure;F1-F17 全部 explicit | hero-to-pro-final-closure.md + plan-hero-to-platform.md(stub)|

### 6.3 Phase 之间的交接原则

1. **每 phase closure 必须显式声明 chronic deferral 状态** — F1-F17 每项在每 phase closure 中标 `closed`/`partial`/`not-touched`/`handed-to-platform`,HP10 汇总。
2. **DDL 改动只在 HP1 — 后续 phase 严禁** — 例外见 §4.5。
3. **`clients/api-docs/` 改动只在 HP9 — 中间 phase 写 design doc 内部参考即可**。
4. **wire-without-delivery 不算 phase 闭合** — 任何端点宣称 live 必须有 cross-e2e 文件;manual evidence 不替代自动化 e2e。
5. **下一 phase 不能在前 phase closure 之前启动** — 严格串行(并行风险:DDL 字段命名冲突、kernel interrupt 接通顺序);HP9 与 HP8 之间允许部分重叠(文档 review 与 hardening 工作正交)。

---

## 7. 各 Phase 详细说明

### 7.1 HP0 — 前置 defer 修复

#### 实现目标

把 6 份 study + 25 份 closure 审计中识别出的"立刻可完成的 defer 项" 一次性清掉,为 HP1 DDL 集中和后续 4 套状态机展开提供干净的 baseline。这些是不需要新 schema、不需要新业务、不需要 owner-action 的修复。

#### In-Scope(R3 修订:区分"仍需做" / "已完成需 verify" / "依赖 R29 后判定")

**仍需做(HP0 真正承担)**:
1. `StartSessionBody` / `FollowupBody` 加 `model_id?` + `reasoning?` 字段;`forwardStart()` / `handleInput()` 透传字段(K2 / G1)。
2. `withNanoAgentSystemPrompt()` 接受可选 `modelId` 参数,从 `nano_models.base_instructions_suffix` 读 per-model suffix(暂用空字符串占位,字段在 HP1 落地后真填)— **注意:此项依赖 HP1,HP0 仅落代码骨架,HP1 落表后真启用**。
3. `docs/runbook/zx2-rollback.md` 物理删除(archive 日期 2026-05-12 已过,G97)。
4. `pnpm-lock.yaml` 6 stale importer 清理(若 RH0 P0-A1 后再次漂移)。

**已完成需 verify(HP0 仅做存在性验证 + 测试加固)**:
5. **CONTEXT_CORE binding 已存在**(`agent-core/wrangler.jsonc` root services line ~50 + preview services line ~100 已打开),HP0 不再"解封注释",改为新增 `tests/binding-presence.test.ts` 断言 binding env keys 存在。
6. **`LANE_E_RPC_FIRST=false` env flag 已存在**(root vars line ~22 + preview vars line ~86),HP0 不再设置,改为 binding-presence test 同时断言此 env var。

**依赖 R29 postmortem 后判定(HP0 不直接执行,HP10 cleanup 内决议)**:
7. `forwardInternalJsonShadow` method 当前注释为 historical naming retention(`user-do-runtime.ts:753`),非 fetch shadow 行为;HP0 不直接物理删除,等 HP8-B R29 postmortem 完成后判定:若 R29 选"零 diff" → HP10 cleanup 重命名或删除;若选"有 diff"或"不可验证" → 保留。
8. `parity-bridge.ts` `logParityFailure` / `computeBodyDiff` 是 reference implementation deliberate retention,HP0 不删,等 HP8-B R29 postmortem 后判定(同上)。

#### Out-of-Scope

1. 任何 D1 schema 改动(留 HP1)。
2. 任何状态机业务逻辑(留 HP2-HP6)。
3. F12 hook dispatcher 真接通(留 HP5,需 kernel interrupt 配套)。
4. F14 R28 owner-action runbook 回填(留 HP8)。
5. `clients/api-docs/` 文档更新(留 HP9)。

#### 交付物(R3 修订)

1. `/start`/`/input` 路径 model_id+reasoning 透传 PR + 6 个回归测试用例(3 入口 × 2 case)。
2. `withNanoAgentSystemPrompt(modelId?)` 改造 PR(suffix 暂空,占位 API)。
3. `tests/binding-presence.test.ts` 新增 — 断言 CONTEXT_CORE binding 存在 + LANE_E_RPC_FIRST env var 存在(verify-only,不改 wrangler 配置)。
4. `docs/runbook/zx2-rollback.md` archive 物理删除 PR。
5. `pnpm-lock.yaml` stale importer 清理(若漂移)。
6. `docs/issue/hero-to-pro/HP0-closure.md`,显式声明 forwardInternalJsonShadow / parity-bridge helpers 等 R29-dependent dead code 留 HP10 cleanup 决议。

#### 收口标准(R3 修订)

1. ✅ `/start`/`/input`/`/messages` 三入口模型字段一致,e2e 覆盖。
2. ✅ `tests/binding-presence.test.ts` 通过(断言 CONTEXT_CORE binding + LANE_E_RPC_FIRST env var 都存在)。
3. ✅ runbook archive 物理删除验证(`docs/runbook/zx2-rollback.md` 不存在)。
4. ✅ 现有测试全绿(orchestrator-core ~700+,agent-core ~1056,packages 全部)。
5. ✅ HP0-closure.md 显式列出 forwardInternalJsonShadow / parity-bridge dead helpers 等 R29-dependent dead code 留 HP10 cleanup 决议。

#### 什么不算完成

1. `withNanoAgentSystemPrompt(modelId?)` 改造完成但 `nano_models.base_instructions_suffix` 字段未在 HP1 落表 — 这种情况 HP0 closure 只能标 `partial`,等 HP1 完成后回填。
2. binding-presence test 写了但未跑通 — 必须 verify CI 通过。
3. R29-dependent dead code 在 HP0 内被错误删除(违反 R3 决议),会丢失 R29 postmortem 对照材料。

#### 本 Phase 风险提醒

- **与 HP1 字段命名提前对齐风险**:HP0 改造的 `withNanoAgentSystemPrompt(modelId?)` 依赖 HP1 落表 `base_instructions_suffix`。若 HP1 字段命名与 HP0 不一致,需 HP1 内修正。建议 HP0 启动前先冻结 HP1 字段命名(`HP1-schema-extension.md` design doc 在 HP0 启动前完成 review)。
- **lock file 漂移风险**:Z3-RH0 都修过 lockfile,可能再次漂移。HP0 内不主动 rebuild,只在 grep 检查时若发现再修。
- **R29-dependent dead code 误删风险(R3)**:执行者若按旧 charter 逻辑直接删 forwardInternalJsonShadow / parity-bridge helpers,会丢 R29 对照材料;HP0 action-plan 必须显式禁止此项。

---

### 7.2 HP1 — DDL 集中扩展

#### 实现目标

一次性完成 hero-to-pro 全部 11 个 phase 所需的 D1 表/列改动,作为 4 套状态机 + checkpoint 全模式 revert + R2 retention 的 schema 基石。后续 HP2-HP10 默认严禁加新 migration(受控例外见 §4.4 R8 修订)。

#### In-Scope(R1 + R2 + R7 修订:补 checkpoint/restore/provenance schema + migration 编号 007 起)

**1. Model state machine schema**
- `nano_models` 加 `max_output_tokens / effective_context_pct / auto_compact_token_limit / supported_reasoning_levels(JSON) / input_modalities(JSON) / provider_key / fallback_model_id / base_instructions_suffix / description / sort_priority` 共 10 列。
- 新建 `nano_model_aliases (alias_id PK, target_model_id FK, created_at)`。
- `nano_conversation_sessions` 加 `default_model_id / default_reasoning_effort`。
- `nano_conversation_turns` 加 `requested_model_id / requested_reasoning_effort / effective_model_id / effective_reasoning_effort / fallback_used`。

**2. Chat state machine schema**
- `nano_conversation_turns` 加 `turn_attempt INTEGER NOT NULL DEFAULT 1`;`UNIQUE(session_uuid, turn_index)` 改 `UNIQUE(session_uuid, turn_index, turn_attempt)`(SQLite 需 rebuild 表)。
- `nano_conversation_messages` 加 `superseded_at / superseded_by_turn_attempt`。
- `nano_conversations` 加 `deleted_at`(soft-delete tombstone)。

**3. Tool/Workspace state machine schema(R7 增补)**
- 新建 `nano_session_todos (todo_uuid PK, session_uuid FK, conversation_uuid FK, team_uuid, parent_todo_uuid, content, status[pending/in_progress/completed/cancelled/blocked], created_at, updated_at, completed_at)`。
- 新建 `nano_session_temp_files (temp_file_uuid PK, session_uuid FK, team_uuid, virtual_path, r2_object_key, mime, size_bytes, content_hash, last_modified_at, written_by[user/agent/tool], created_at, expires_at, cleanup_status[pending/scheduled/done], UNIQUE(session_uuid, virtual_path))` — **expires_at + cleanup_status 是 R7 retention 必需**。
- 现有 `nano_session_files` 加 provenance columns:`provenance_kind[user_upload/agent_generated/workspace_promoted/compact_summary/checkpoint_restored]` / `source_workspace_path`(若 promoted)/ `source_session_uuid`(若 fork) — **R7 artifact provenance 必需**。

**4. Confirmation control plane schema**
- 新建 `nano_session_confirmations (confirmation_uuid PK, session_uuid FK, kind[tool_permission/elicitation/model_switch/context_compact/fallback_model/checkpoint_restore/context_loss], payload_json, status[pending/allowed/denied/modified/timeout/superseded], decision_payload_json, created_at, decided_at, expires_at)`。

**5. Product checkpoint schema(R1 critical 增补 — HP4/HP7 必需)**
- 新建 `nano_session_checkpoints (checkpoint_uuid PK, session_uuid FK, conversation_uuid FK, team_uuid, turn_uuid FK, turn_attempt INTEGER, checkpoint_kind[turn_end/user_named/compact_boundary/system], label TEXT, message_high_watermark TEXT, latest_event_seq INTEGER, context_snapshot_uuid FK?, file_snapshot_status[none/pending/materialized/failed], created_by[user/system/compact/turn_end], created_at, expires_at)`。
- 新建 `nano_checkpoint_file_snapshots (snapshot_uuid PK, checkpoint_uuid FK, session_uuid FK, team_uuid, source_temp_file_uuid FK?, source_artifact_file_uuid FK?, source_r2_key, snapshot_r2_key, virtual_path, size_bytes, content_hash, snapshot_status[pending/materialized/copied_to_fork/failed], created_at)` — 表达 lazy materialization 与 fork copy。
- 新建 `nano_checkpoint_restore_jobs (job_uuid PK, checkpoint_uuid FK, session_uuid FK, mode[conversation_only/files_only/conversation_and_files/fork], target_session_uuid TEXT?, status[pending/running/succeeded/partial/failed/rolled_back], confirmation_uuid FK, started_at, completed_at, failure_reason TEXT)` — 表达 restore audit + R7 failure rollback 路径。

**6. R2 cleanup audit(R7 增补)**
- 新建 `nano_workspace_cleanup_jobs (job_uuid PK, session_uuid FK, team_uuid, scope[session_end/explicit/checkpoint_ttl], target_count INTEGER, deleted_count INTEGER, status[pending/running/done/failed], scheduled_at, started_at, completed_at)` — 表达 cleanup lineage,防止 R6/HP7 误删。

**7. Workers AI model metadata 真 seed**
- 在 `nano_models` 现有 seed 基础上回填 7-10 个新列的真值(closing-thoughts-part-1 §4.2 列出参考清单);具体模型条数以仓库 `003-usage-quota-and-models.sql` 现有 seed 与 owner 决议为准,本 charter 不冻结确切数字。

**8. Alias seed**
- `@alias/fast / @alias/balanced / @alias/reasoning / @alias/vision` 4 条。

**9. 每张新表的索引**
- `idx_todos_session(session_uuid, status)` / `idx_temp_files_session(session_uuid)` / `idx_temp_files_cleanup(cleanup_status, expires_at)` / `idx_confirmations_session_status(session_uuid, status)` / `idx_checkpoints_session(session_uuid, created_at)` / `idx_checkpoint_snapshots_status(snapshot_status)` / `idx_restore_jobs_session(session_uuid, status)` 等。

#### Out-of-Scope

1. 业务逻辑接通(留 HP2-HP7)。
2. prod migration apply(owner-action,留 HP9 显式登记 baseline)。
3. R2 路径策略文档具体内容(留 HP6 design;HP1 schema 中只表达 R2 key 字段,不冻结 path 规则)。

#### 交付物(R2 修订:migration 编号 007 起,7 个文件)

1. `migrations/007-model-metadata-and-aliases.sql`(model 10 列 + `nano_model_aliases`)。
2. `migrations/008-session-model-audit.sql`(session.default_* + turn.requested/effective/fallback_used)。
3. `migrations/009-turn-attempt-and-message-supersede.sql`(turn_attempt + UNIQUE rebuild + message superseded marker + conversation deleted_at)。
4. `migrations/010-agentic-loop-todos.sql`(`nano_session_todos`)。
5. `migrations/011-session-temp-files-and-provenance.sql`(`nano_session_temp_files` 含 expires_at/cleanup_status + `nano_session_files` provenance columns)。
6. `migrations/012-session-confirmations.sql`(`nano_session_confirmations`)。
7. `migrations/013-product-checkpoints.sql`(`nano_session_checkpoints` + `nano_checkpoint_file_snapshots` + `nano_checkpoint_restore_jobs` + `nano_workspace_cleanup_jobs`)。
8. `docs/architecture/hero-to-pro-schema.md`(每张新表/新列的字段说明 + 业务用途 + 各 phase 消费关系 + R7 retention 与 R1 checkpoint lineage)。
9. Workers AI 模型 metadata seed 回填(在 `003-usage-quota-and-models.sql` 现有 seed 基础上,通过 migration 007 的 UPDATE statement 完成)+ 4 alias seed。
10. `docs/issue/hero-to-pro/HP1-closure.md`。

#### 收口标准

1. ✅ 7 个新 migration 文件(`007-013`)local apply 通过,且 prior `001-006` 保持不变。
2. ✅ orchestrator-core test 全绿(包括新表的 schema 一致性测试 + checkpoint/restore/provenance/cleanup_jobs 表的字段断言)。
3. ✅ `nano_models` 全部 active 模型新列回填完成 + 4 alias seed 验证。
4. ✅ schema 文档 review 通过(对齐 HP4/HP7 的 checkpoint full-mode revert 需求 + HP6 的 R2 retention/provenance 需求)。
5. ✅ HP0 的 `base_instructions_suffix` 占位 API 可读到真值(回填 HP0 partial)。
6. ✅ 后续 HP2-HP10 默认不需要再加 migration(charter §4.4 R8 受控例外保留)。
7. ✅ HP1-closure.md 显式登记 prod 状态待 HP9 baseline。

#### 什么不算完成

1. local migration apply 通过但有 schema-mismatch test 失败。
2. checkpoint 三表中任一(`nano_session_checkpoints` / `nano_checkpoint_file_snapshots` / `nano_checkpoint_restore_jobs`)缺失或字段不全 — 这会让 HP4/HP7 必然破戒(R1)。
3. `nano_session_temp_files` 缺 `expires_at` / `cleanup_status` 或 `nano_session_files` 缺 provenance 列 — R7 retention 无法审计。
4. Model metadata seed 某条不真实(如 context_window 错标 128K vs 真实 131K)。
5. prod migration 未 apply 不算 HP1 不完成(留 HP9 owner-action),但 HP1 closure 必须显式登记 prod 状态待 HP9 baseline。

#### 本 Phase 风险提醒

- **SQLite ALTER 限制**:SQLite 不支持 DROP CONSTRAINT,turn_attempt 改 UNIQUE 必须 rebuild 表(create new + insert + drop old + rename)。需在 migration 009 中谨慎处理避免锁表过久。
- **DDL 字段命名一旦冻结不可改**:后续 HP2-HP10 都基于此 schema,字段重命名成本极高。HP1 必须先写 `HP1-schema-extension.md` design doc 并 review 后再合并(charter §13.1 + §13.4 已规定)。
- **R1 checkpoint schema 复杂度**:checkpoint 三表 + R2 lineage 字段较多,易出现"小漏一字段后续 HP7 破戒"。HP1 design doc review 必须对照 HP4/HP7 In-Scope 逐项 sanity check。
- **JSON 列(supported_reasoning_levels / input_modalities)无 schema 校验**:SQLite 不强制 JSON 格式;应用层必须严格校验,seed 数据必须正确。
- **prod migration 多次 apply 风险(F16 慢性七阶段)**:HP1 落地的是 local migration;prod apply 是 owner-action,可能与现有 prod 真实状态有 drift。HP9 强制做 baseline 对齐。
- **R8 受控例外**:HP3-HP7 若发现 HP1 schema 真实 blocker(本 design doc review 时未识别),必须先 owner 批准 + charter 修订 + 标 `HP1 schema correction`,新 migration 编号继 `014-...` 起;不允许私自加 migration。

---

### 7.3 HP2 — Model 状态机闭环

#### 实现目标

完成 4 层模型状态机(global default → session default → turn override → effective+fallback)端到端可见,模型切换具备语义注入,fallback 进入 D1 audit。

#### In-Scope

1. `recordTurnStart()` 写 `requested_model_id / requested_reasoning_effort`;`recordTurnEnd()` 写 `effective_*` + `fallback_used`。
2. `GET /sessions/{id}/model` + `PATCH /sessions/{id}/model` 端点。
3. `GET /models/{id}` 单模型 detail 端点(暴露 HP1 落地的 10 个新字段)。
4. Alias 解析层:`requireAllowedModel()` 在 D1 lookup 前先 alias resolve;`/models` response 含 alias 节。
5. `<model_switch>` developer message 注入:`extractTurnInput()` 与 active turn message 之间 detect 模型变更并插入。
6. Reasoning effort 重映射:新模型 `supported_reasoning_levels` 不含 client 请求的 effort 时降级到 default,不静默 ignore。
7. Fallback chain 执行:`gateway.ts` 改读 `nano_models.fallback_model_id`,fallback 触发后写 D1 audit + emit `model.fallback` NACP stream event(stream-event registry 加新 kind)。
8. e2e 覆盖:同 session reasoning↔non-reasoning、vision↔non-vision、131K↔24K window 切换。

#### Out-of-Scope

1. Multi-provider routing(O1)。
2. 模型升级路径(`upgrade_to` 字段)— 当前 seed 模型集不需要,留 hero-to-platform。
3. Per-team model billing / quota 字段 — 留 hero-to-platform。

#### 交付物

1. Model 状态机端点(GET/PATCH `/sessions/{id}/model`、GET `/models/{id}`)。
2. `<model_switch>` developer message 注入逻辑。
3. Fallback audit + stream event。
4. e2e 测试 5+ 用例。
5. `docs/design/hero-to-pro/HP2-model-state-machine.md`(内部参考,不是 client doc)。
6. `docs/issue/hero-to-pro/HP2-closure.md`。

#### 收口标准

1. ✅ 4 层模型状态完整可审计(D1 中 turn 表能反查每个 turn 的 requested + effective)。
2. ✅ 5+ e2e 用例全绿。
3. ✅ Alias 解析:客户端用 `@alias/reasoning` 等价于 `@cf/openai/gpt-oss-120b`。
4. ✅ `<model_switch>` 在 cross-turn 切换时被 LLM 看到(prompt 验证)。

#### 什么不算完成

1. 端点 live 但 D1 audit 列未真写。
2. fallback 触发时无 stream event emit。
3. e2e 仅覆盖 happy path,不覆盖 reasoning/vision/window 切换。

#### 本 Phase 风险提醒

- **`<model_switch>` 与 HP3 compact 的耦合**:compact 时如何处理已注入的 `<model_switch>` 片段是 Codex 已踩过的坑。HP2 内只做注入,HP3 compact 流程必须显式扫描 developer message 剥离再恢复。
- **fallback chain 单层避免无穷级联**:HP1 schema 只有单 `fallback_model_id`,不支持 chain;若 fallback model 也失败,直接 surface error。

---

### 7.4 HP3 — Context 状态机闭环

#### 实现目标

context-core 3 RPC 解 stub + cross-turn history 进入 LLM prompt + auto-compact + manual compact preview/job + context layers 暴露。完成 K1/K4/K8/K13 全部共识收口。

#### In-Scope

1. `getContextSnapshot` / `triggerContextSnapshot` / `triggerCompact` 三 RPC 解 stub:从 agent-core Session DO + D1 messages + workspace assembler 拉真实数据。
2. `CrossTurnContextManager`(放 agent-core,避免每次 LLM call RPC 跨 worker):LLM call 前从 D1 readHistory 读最近 N 个 message,与当前 turn 合并;已 compact 历史用 D1 boundary snapshot 替代。
3. `compactRequired` 信号:`runtime-mainline.ts` LLM call 前累计 estimatedPromptTokens(字节启发式),与 model.auto_compact_token_limit 比较。
4. `CompactDelegate.requestCompact()` 实装:调 LLM 摘要 + 写 boundary snapshot + emit `compact.notify` stream event。
5. `<model_switch>` 与 `<state_snapshot>` 片段在 compact 时按 Codex/Gemini 套路剥离再恢复。
6. Compact 失败 3 次 circuit breaker。
7. 端点:`GET /sessions/{id}/context/probe`、`POST /sessions/{id}/context/compact/preview`、`POST /sessions/{id}/context/compact`、`GET /sessions/{id}/context/compact/jobs/{id}`、`GET /sessions/{id}/context/layers`。
8. `budget/policy.ts` 不再硬编码 32K,改读 model.effective_context_pct * model.context_window。
9. e2e 覆盖:131K 模型 prompt ~118K 触发 auto-compact;24K 模型 ~22K 触发;长对话不再溢出 crash。

#### Out-of-Scope

1. File revert(留 HP7)。
2. checkpoint list / restore(留 HP4 conversation_only + HP7 全模式)。
3. Per-model `instructions_template` 完整 template engine — HP0 已落 `base_instructions_suffix`,完整 template 留 hero-to-platform。

#### 交付物

1. context-core 3 RPC 解 stub 实装。
2. CrossTurnContextManager + integration 测试。
3. 5 个新 context endpoint。
4. compact LLM 摘要逻辑 + boundary snapshot 持久化。
5. e2e 用例(长对话自动压缩、cross-turn history 验证、layer probe)。
6. `docs/design/hero-to-pro/HP3-context-state-machine.md`。
7. `docs/issue/hero-to-pro/HP3-closure.md`。

#### 收口标准

1. ✅ 三个 context-core RPC 不再返 `phase: "stub"`。
2. ✅ Cross-turn history 进入 LLM prompt(e2e 通过:turn1 "我叫张三" → turn2 "我叫什么" → assistant 回 "张三")。
3. ✅ Auto-compact 由 model metadata 驱动,131K 与 24K 模型阈值不同。
4. ✅ 5 个 endpoint 全绿。
5. ✅ G3 / G4 / G5 全部消除。

#### 什么不算完成

1. RPC 解 stub 但 cross-turn history 未接通。
2. compact 真实运行但失败 3 次后无 circuit breaker。
3. token estimation 误差 > 50%(中文场景 ~30% 可接受,但 50% 必须告警)。

#### 本 Phase 风险提醒

- **token estimation 不准**:字节启发式中文 ~30% 误差。`effective_context_pct=0.95` + `auto_compact_token_limit < context_window` 双层缓冲应可控,但需 e2e 监控。
- **compact 与 `<model_switch>` 的剥离顺序**:HP2 已注入,HP3 compact 必须正确处理。建议在 design doc 显式列出 strip-then-recover 算法。
- **compact 失败 circuit breaker**:三次后停止,但 LLM 仍可能溢出。需有 surface error 路径。

---

### 7.5 HP4 — Chat 生命周期 + checkpoint conversation_only

#### 实现目标

补全 session 生命周期(close/delete/title/retry)+ cursor pagination + conversation-level view + 简易 conversation_only checkpoint revert。

#### In-Scope(R1 修订:checkpoint schema 来自 HP1)

1. `POST /sessions/{id}/close`(正常关闭,区别 cancel 中断)。
2. `DELETE /sessions/{id}`(soft tombstone via `nano_conversations.deleted_at`)。
3. `PATCH /sessions/{id}/title`(写 `nano_conversations.title`)。
4. `POST /sessions/{id}/retry`(基于 turn_attempt 改造,重试最近失败 turn)。
5. `/me/conversations` 与 `/me/sessions` 统一 cursor pagination + KV/D1 双源对齐。
6. `GET /conversations/{conversation_uuid}` conversation-level view。
7. Checkpoint conversation_only(消费 HP1 落地的 `nano_session_checkpoints` + `nano_checkpoint_restore_jobs` 表):
   - `GET /sessions/{id}/checkpoints` 列锚点(turn-end / user-named / compact-boundary)— 从 `nano_session_checkpoints` 查
   - `POST /sessions/{id}/checkpoints` 用户主动创建命名 checkpoint(`checkpoint_kind=user_named`,本 phase `file_snapshot_status=none`,留 HP7 物化)
   - `GET /sessions/{id}/checkpoints/{id}/diff` 显示 superseded message 列表(本 phase 仅 message diff,file diff 留 HP7)
   - `POST /sessions/{id}/checkpoints/{id}/restore` body `{ mode: "conversation_only" }` — 写 `nano_checkpoint_restore_jobs` 记录,kernel restore 完成后回填 `status=succeeded`
8. Revert 逻辑:写 restore_job → 标 D1 messages superseded → DO restoreFromStorage 到对应 turn kernelSnapshot → 一致性校验 → 更新 restore_job 状态。
9. e2e 覆盖:close + delete + title + retry + revert 各 1+ 用例;失败回滚 e2e(标 D1 superseded 后 DO restore 失败时 restore_job=`rolled_back` + D1 superseded 反标)。

#### Out-of-Scope

1. Checkpoint files_only / conversation_and_files 模式(留 HP7)。
2. Session fork(留 HP7)。
3. R2 file shadow snapshot(留 HP7)。
4. 自动 session title LLM 生成(灰区 defer)。

#### 交付物

1. 7 个新端点。
2. Checkpoint conversation_only 端到端逻辑。
3. DO + D1 一致性 e2e。
4. `docs/design/hero-to-pro/HP4-chat-lifecycle.md`。
5. `docs/issue/hero-to-pro/HP4-closure.md`。

#### 收口标准

1. ✅ session close/delete/title/retry 全 live。
2. ✅ `/me/conversations` cursor pagination + 双源对齐。
3. ✅ checkpoint conversation_only restore 后 LLM prompt 不再看 superseded message。
4. ✅ DO + D1 一致性 e2e:revert + 继续对话 + 再 revert 三步全绿。

#### 什么不算完成

1. Restore 后 D1 superseded 但 DO kernelSnapshot 未同步重置。
2. Cursor pagination 实现但 KV/D1 数据集不一致。

#### 本 Phase 风险提醒

- **DO + D1 revert 非事务**:先标 D1 superseded(幂等),DO restoreFromStorage 在 worker 启动时自动从 D1 最新非 superseded 状态重建。需要专门 e2e 验证 mid-revert worker restart。
- **soft tombstone 不影响 D1 audit ledger**:`nano_session_activity_logs` 仍保留;只是 `/me/conversations` list 时过滤。

---

### 7.6 HP5 — Confirmation 收拢 + Hook dispatcher 真接通 + F12/F13 closure

#### 实现目标

完成 7 类 confirmation kind 统一端点 + F12 hook dispatcher 实例真注入(慢性五阶段终结)+ F13 `pushServerFrameToClient` round-trip e2e 4 件套(慢性四阶段终结)。

#### In-Scope

1. `hooks/permission.ts` 改造:`PreToolUse` hook 不再返同步 verdict;`policy.shouldAsk()` 返 `ask` 时调 `dispatcher.requestPermission()` → `NanoSessionDO.emitPermissionRequestAndAwait()` → kernel 进入 `approval_pending` interrupt → 等 client `/permission/decision` HTTP 写 DO storage → `awaitAsyncAnswer` resolve → hook 拿 verdict。
2. `createMainlineKernelRunner` 把 `HookDispatcher` 实例注入(deps 注入)。
3. Kernel 加 `elicitation_pending` interrupt(同 permission 模式)。
4. `/confirmations` 端点 3 件套:`GET /sessions/{id}/confirmations?status=pending` / `GET /sessions/{id}/confirmations/{uuid}` / `POST /sessions/{id}/confirmations/{uuid}/decision`。
5. 7 类 kind 统一进入 `nano_session_confirmations`(HP1 已落表)。
6. permission/elicitation 旧端点保留 redirect 兼容(双发期);NACP 新增 `session.confirmation.request` / `session.confirmation.update` 帧。
7. **e2e 4 件套**:
   - `test/cross-e2e/15-permission-roundtrip-allow.test.mjs`
   - `test/cross-e2e/16-permission-roundtrip-deny.test.mjs`
   - `test/cross-e2e/17-elicitation-roundtrip.test.mjs`
   - `test/cross-e2e/18-usage-push-live.test.mjs`(F13 onUsageCommit WS push)

#### Out-of-Scope

1. Tool/Workspace 状态机(留 HP6)。
2. Checkpoint files_only(留 HP7)。
3. permission/elicitation 旧端点物理删除(留 hero-to-platform 或独立 PR)。

#### 交付物

1. Hook dispatcher 实例注入逻辑。
2. `elicitation_pending` interrupt 加入 kernel。
3. 3 个 `/confirmations` 端点。
4. NACP `session.confirmation.*` 帧族。
5. permission/elicitation redirect 路径。
6. 4 个 cross-e2e 文件。
7. `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`。
8. `docs/issue/hero-to-pro/HP5-closure.md`。

#### 收口标准

1. ✅ F12 终结:`emitPermissionRequestAndAwait` 第一次有真调用方。
2. ✅ F13 终结:4 个 cross-e2e 文件落地并全绿。
3. ✅ 7 类 confirmation kind 全部进入统一表 + 端点。
4. ✅ permission/elicitation 兼容期 e2e。
5. ✅ tool call 在 ask policy 下真实暂停 → 恢复(allow/deny/timeout 三态)。

#### 什么不算完成

1. Hook dispatcher 注入但 e2e 仅 mock,不是真启动 6-worker stack。
2. `/confirmations` 端点 live 但 7 类 kind 未全部接通。
3. permission/elicitation 旧端点 break,而非保留兼容。

#### 本 Phase 风险提醒

- **HP3 kernel interrupt 与本 phase hook dispatcher 的合并冲突**:HP3 `runtime-mainline.ts` 改动与 HP5 hooks/permission.ts 改动可能 race。建议 HP5 在 HP4 closure 后启动,kernel interrupt 路径已通。
- **e2e 启动 6-worker stack 成本**:沿用 `test/cross-e2e/01-stack-preview-inventory` 套路,wrangler dev 多端口。可能需要 RH3 的 13-device-revoke-force-disconnect 测试基础设施。

---

### 7.7 HP6 — Tool/Workspace 状态机

#### 实现目标

补齐 4 套状态机的最后一套:Tool/Workspace 完整闭环(todo + workspace temp file CRUD + tool inflight + workspace→artifact promotion)。

#### In-Scope(R7 修订:消费 HP1 落地的 expires_at/cleanup_status/provenance 列 + cleanup_jobs 表)

1. **Todo 状态机**:NACP `session.todos.write` / `session.todos.update` 消息族;agent-core kernel 加 `WriteTodos` capability;orchestrator-core 4 端点(`GET/POST/PATCH/DELETE /sessions/{id}/todos`);"at most 1 in_progress" 约束。
2. **Workspace temp file CRUD**:filesystem-core 4 RPC(`readTempFile / writeTempFile / listTempFiles / deleteTempFile`);R2 命名 `tenants/{team_uuid}/sessions/{session_uuid}/workspace/{virtual_path}`;orchestrator-core 5 端点(`GET/PUT/DELETE /workspace/files/{*path}` + `GET ?prefix` + `POST /workspace/cleanup`);agent-core kernel 加 `ReadTempFile/WriteTempFile/ListTempFiles` capability;mtime check via content_hash;**写入时同步设 `nano_session_temp_files.expires_at`(default = session.end + 24h)与 `cleanup_status=pending`**;session.end + 24h cron 清理 — 每次清理写 `nano_workspace_cleanup_jobs` 一行 audit。
3. **Tool call inflight**:agent-core kernel 加 `pendingToolCalls: Map`;`GET /sessions/{id}/tool-calls?status=` 端点(从 D1 message 表抓取);`POST /sessions/{id}/tool-calls/{request_uuid}/cancel` 端点(走 bash-core/filesystem-core `capability/cancel` RPC);emit `tool.call.cancelled` stream event。
4. **Workspace → artifact promotion**:`POST /sessions/{id}/artifacts/promote` 端点 — promote 时写 `nano_session_files.provenance_kind=workspace_promoted` + `source_workspace_path`;`GET /sessions/{id}/artifacts/{file_uuid}/provenance` 端点直接读 `nano_session_files` provenance 列(HP1 已落)。
5. **R2 multi-tenant 边界审查**:path traversal 防御 + bucket policy review + tenants/ 强制前缀单元测试 + virtual_path 拒绝 `..` / 绝对路径。
6. e2e 覆盖:LLM 写 todo;LLM 写 temp file 跨 turn 读回;cancel 单 tool;promote 后 artifact 跨 session 下载;cleanup_jobs audit 行被正确写入。

#### Out-of-Scope

1. TodoWrite V2 task graph(parent-child execution + sub-task spawn,涉及 sub-agent,O15)。
2. `WriteFileTool` 完整 read-before-write 编辑模式(本 phase 只做整文件 PUT;diff/patch 模式留 hero-to-platform)。
3. shadow git snapshot(留 HP7)。

#### 交付物

1. NACP todo 消息族。
2. 9 个新端点(4 todo + 5 workspace)。
3. agent-core 4 个新 capability(WriteTodos + 3 个 file)。
4. filesystem-core 4 个新 RPC。
5. R2 namespace 单元测试。
6. e2e 用例。
7. `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`(同时含 R2 namespace 设计)。
8. `docs/issue/hero-to-pro/HP6-closure.md`。

#### 收口标准

1. ✅ Todo 状态机端到端 live。
2. ✅ Workspace temp file CRUD live + R2 真实接线(非 in-memory)。
3. ✅ Tool call inflight + 单 tool cancel live。
4. ✅ Workspace → artifact promotion live。
5. ✅ R2 path traversal 测试无 bypass。
6. ✅ session.end + 24h 清理验证。

#### 什么不算完成

1. R2 真实接线但 multi-tenant 前缀可被 bypass。
2. Todo 端点 live 但 LLM `WriteTodos` capability 未接通。
3. cancel 单 tool 但下层 capability/cancel RPC 不响应。

#### 本 Phase 风险提醒

- **R2 multi-tenant 安全**:`tenants/{team_uuid}/` 前缀必须严格校验;virtual_path 不允许 `..` / 绝对路径。建议本 phase 完成后做 owner/security review pass。
- **R2 成本**:workspace 文件 + 24h cron 清理,但若用户长期不结束 session,会持续占用。HP6 设置 default `cleanup_after_session_end: 24h`,owner 可调整。

---

### 7.8 HP7 — Checkpoint 全模式 revert

#### 实现目标

补齐 checkpoint 全模式(files_only + conversation_and_files)+ session fork + R2 file shadow snapshot。完成 Chat/Context state machine 的最后一笔。

#### In-Scope(R1+R7 修订:消费 HP1 checkpoint/file_snapshots/restore_jobs/cleanup_jobs 表)

1. **R2 file shadow snapshot**:命名 `tenants/{team_uuid}/sessions/{session_uuid}/snapshots/{checkpoint_uuid}/{virtual_path}`;filesystem-core 加 `createFileSnapshot` / `restoreFileSnapshot` RPC;每个 snapshot 写 `nano_checkpoint_file_snapshots` 一行(snapshot_status 跟踪 pending → materialized → copied_to_fork)。
2. **Lazy snapshot**:每个 turn-end 标"待物化"(`nano_session_checkpoints.file_snapshot_status=none`,无 file_snapshots 行),用户主动 `POST /checkpoints` 时才真物化(写 `file_snapshot_status=pending` → `materialized`)。状态存 D1(`nano_session_checkpoints.file_snapshot_status` 列),不存 DO memory。
3. **Checkpoint TTL 策略**:turn-end rotate 10 个(via `nano_session_checkpoints.expires_at` + cron);user-named 30 天;compact-boundary 与 compact summary 同 TTL;session.end + 90d cron 清理 — 所有 cleanup 操作写 `nano_workspace_cleanup_jobs` audit 行。
4. **Restore 模式扩展**:`mode: "files_only"` / `"conversation_and_files"`;`/diff` 端点扩展含 file diff(对比 `nano_checkpoint_file_snapshots` 与当前 `nano_session_temp_files` + `nano_session_files`);restore 前必触发 `kind: "checkpoint_restore"` confirmation(via HP5)— 写 `nano_checkpoint_restore_jobs.confirmation_uuid`;**failure recovery**:R2 restore 失败时写 `restore_job.status=rolled_back` + `failure_reason`,并反标 D1 superseded。
5. **Session fork**:`POST /sessions/{id}/fork` body `{ from_checkpoint_uuid, new_session_label? }` → 复制 D1 messages 到该 checkpoint + R2 file snapshot copy 到新 session 路径(写 `nano_checkpoint_file_snapshots.snapshot_status=copied_to_fork`)+ 启动新 DO kernel;新 session 的 R2 namespace 严格隔离(不引用原 session R2 key)。
6. e2e 覆盖:三模式 restore + fork + checkpoint TTL + confirmation gate + restore failure rollback。

#### Out-of-Scope

1. 跨 conversation fork(只支持 session fork,不支持把一个 conversation 的 history 移到另一 conversation)。
2. checkpoint diff visualizer(只返 JSON,不渲染 UI)。
3. Checkpoint export/import(留 hero-to-platform)。

#### 交付物

1. R2 snapshot 命名 + filesystem-core 2 RPC。
2. lazy snapshot 调度逻辑。
3. TTL cron 任务(turn-end rotate + 90d cleanup)。
4. Restore 三模式 + diff 端点 + confirmation gate 联动。
5. Session fork 端点。
6. e2e 用例。
7. `docs/design/hero-to-pro/HP7-checkpoint-revert.md`。
8. `docs/issue/hero-to-pro/HP7-closure.md`。

#### 收口标准

1. ✅ Restore 三模式 e2e 通过(conversation_only + files_only + conversation_and_files)。
2. ✅ Restore 前必有 confirmation(via HP5 `/confirmations`)。
3. ✅ Diff 端点显示 message + file 完整变更。
4. ✅ Session fork 后新 session 与原 session 独立。
5. ✅ TTL 策略 cron 验证(turn-end rotate=10,user-named 30 天)。

#### 什么不算完成

1. files_only restore 但 R2 实际未 restore(只标记)。
2. session fork 后两 session R2 路径冲突。
3. checkpoint TTL cron 未真启用(配置存在但 alarm 不 fire)。

#### 本 Phase 风险提醒

- **R2 snapshot 成本**:长 session 多 checkpoint 复制成本可观。turn-end rotate=10 可能仍偏多;owner 在本 phase 内监控成本后调整。
- **fork 与 multi-tenant**:fork 必须严格隔离 R2 namespace;新 session 不能引用原 session 的 R2 路径。
- **lazy snapshot 调度风险**:turn-end 标"待物化"后,若 worker 重启,信息可能丢失。建议存 D1 而非 DO memory。

---

### 7.9 HP8 — Runtime hardening + chronic deferrals 系统收口

#### 实现目标

集中收口 7 项跨阶段 chronic deferrals(F4/F5/F6/F8/F14/F15/G99 envelope)+ runtime hardening。

#### In-Scope

1. **F14 R28 verify-cancel deploy 500 root cause**:owner 跑 wrangler tail 抓 trace + 修复或显式 hero-to-platform handoff;`docs/runbook/zx5-r28-investigation.md` §3 真实回填。
2. **F15 R29 verify-initial-context 502 显式 postmortem**:写 `scripts/verify-initial-context-divergence.mjs` + preview 跑 5 个真实 session diff + `docs/issue/zero-to-real/R29-postmortem.md` 写最终判定(零 diff / 有 diff / 不可验证)。
3. **F6 DO heartbeat alarm 化**:`NanoSessionDO` heartbeat 从 attachment-lifetime timer 改 DO `alarm()` 调度;abnormal disconnect 4 scenario cross-e2e 覆盖。
4. **F4 Lane E 终态判定**:二选一 — 路径 A(物理删除 workspace-context-artifacts host-local consumer)或路径 B(显式 permanent fallback 文档化);取决于 F14 R28 结果。
5. **F5 行数 stop-the-bleed CI gate**:`scripts/check-megafile-budget.mjs` + `package.json` `check:megafile-budget`;约束 nano-session-do.ts ≤800 行 / user-do.ts facade ≤200 行 / user-do-runtime.ts ≤1100 行 / 各子文件 ≤500 行。
6. **F8 tool registry SSoT**:`packages/nacp-core/src/tools/tool-catalog.ts` 集中 tool schema + description + capability bindings;agent-core 与 bash-core 改读 catalog;`scripts/check-tool-drift.mjs` schema-level drift guard。
7. **G99 envelope 三型收敛**:`AuthEnvelope` / `Envelope` / `FacadeEnvelope` 收敛到 `FacadeEnvelope` 唯一对外形状(本机 RHX2 review 已落地,HP8 verify + cleanup)。

#### Out-of-Scope

1. `clients/api-docs/` 文档更新(留 HP9)。
2. manual evidence(留 HP9)。
3. SDK extraction(O6 留 hero-to-platform)。
4. 完整 handler-granularity refactor(O7 留 hero-to-platform)。

#### 交付物

1. R28 runbook 回填 + R29 postmortem。
2. DO heartbeat alarm 改造 + 4 scenario e2e。
3. Lane E 终态决议文档(`docs/architecture/lane-e-final-state.md`)。
4. 行数 CI gate + `package.json` 集成。
5. tool catalog + drift guard。
6. envelope 收敛 verify。
7. `docs/issue/hero-to-pro/HP8-closure.md`。

#### 收口标准

1. ✅ F14 R28 显式判定(root cause 定位 OR explicit hero-to-platform handoff,不允许 silent)。
2. ✅ F15 R29 postmortem 写明真实判定(三选一)。
3. ✅ F6 alarm 化 + abnormal disconnect 4 scenario e2e 全绿。
4. ✅ F4 Lane E 二选一终态文档化。
5. ✅ F5 行数 CI gate 阻止任何超限 PR。
6. ✅ F8 tool catalog 单源 + drift guard CI live。
7. ✅ envelope 三型收敛 verify(grep 验证)。

#### 什么不算完成

1. R29 postmortem 标 "silently resolved" 无证据。
2. Lane E 既未 sunset 也未 permanent fallback,仍标"shim"。
3. 行数 gate 写了但未集成 CI(`pnpm check:megafile-budget` 不在 test pipeline)。
4. tool catalog 写了但 agent-core/bash-core 未真改读。

#### 本 Phase 风险提醒

- **F14 R28 owner 配合风险**:owner 可能 2 周内无法跑 wrangler tail 复盘。HP8 接受 explicit handoff 作为合法终态,但禁止 silent。
- **F15 R29 可能不能定论**:删除检测后再回查根因是反向工程。HP8 接受三种判定,不强求"找到根因"。
- **F4 Lane E 路径 A 依赖 F14**:若 R28 未修,只能选路径 B。两条路径都有技术成本,owner 在 HP8 启动时决断。

---

### 7.10 HP9 — `clients/api-docs/` 全面更新 + manual evidence pack

#### 实现目标

完成 18 份 `clients/api-docs/` 与代码 100% 对齐 + F1+F2 manual evidence pack 完整归档(慢性五/六阶段终结)+ F16 prod schema baseline。

#### In-Scope

1. **`clients/api-docs/` 18 份文档(R4 修订)**:
   - 11 份现有(README/auth/catalog/error-index/me-sessions/permissions/session/session-ws-v1/usage/wechat-auth/worker-health)— rewrite 4 份(session/permissions/usage/error-index)+ sanity check 7 份。
   - **7 份新增**:`models.md` / `context.md` / `checkpoints.md` / `confirmations.md` / `todos.md` / `workspace.md` / `transport-profiles.md`。
   - 11 + 7 = **18 份**(charter v0.draft 版误计 17 份,r1 修正)。
2. **manual evidence pack**:owner 在 5 套设备(Chrome web / Safari iOS / Android Chrome / WeChat 开发者工具 / WeChat 真机)做完整 e2e 录制(register → login → start session → send message → receive WS → use todo/workspace/compact/checkpoint restore → revoke device → 重 attach 被拒);归档至 `docs/evidence/hero-to-pro-manual-2026-XX/`;`docs/issue/hero-to-pro/manual-evidence-pack.md` 写完整索引。
3. **F16 prod schema baseline**:owner 跑 `wrangler d1 migrations list nano-agent-orchestrator-core --env prod --remote`;若与 migrations/ 不一致,补救 migration(charter §4.5 唯一例外);`docs/issue/hero-to-pro/prod-schema-baseline.md` 记录 prod 真实 schema dump。
4. **文档 review 流程**:沿用 RHX2 4 家 review pattern(GPT/kimi/GLM/deepseek)对 6 份新增 + 4 份 rewrite 共 10 份做 review;其余 7 份只 sanity check。

#### Out-of-Scope

1. WeChat miniprogram 完整适配(灰区 defer,独立专项)。
2. SDK extraction(O6)。
3. dead code 物理删除(留 HP10)。

#### 交付物

1. 18 份 `clients/api-docs/` 文档(11 现有 + 7 新增)。
2. 5 套设备 manual evidence pack。
3. `docs/issue/hero-to-pro/manual-evidence-pack.md` 索引。
4. `docs/issue/hero-to-pro/prod-schema-baseline.md`。
5. 4 家 review 报告(每家一份)。
6. `docs/issue/hero-to-pro/HP9-closure.md`。

#### 收口标准

1. ✅ 18 份文档全部对齐当前代码 + 4 家 review 通过(critical 0、high 全部修复)。
2. ✅ F1 + F2 manual evidence 5 套设备完整归档。
3. ✅ F16 prod schema baseline 文档化。
4. ✅ HP9 closure 显式登记 F1/F2/F16 终结。

#### 什么不算完成

1. 文档 live 但代码已变(如 session.md 写 `/context/compact` 返 `compacted: true` 但实际 HP3 已改返真实 job_id)— 必须代码 freeze 后再写文档。
2. manual evidence 缺一个设备。
3. prod schema baseline 写了但 migrations/ 与 prod 仍不一致。

#### 本 Phase 风险提醒

- **owner-action 强依赖(R5 修订:硬闸路线)**:F1+F2+F16 全部需 owner 配合;若 owner 不能完整配合,HP9 不能 closure,HP10 final closure 不得放行,本阶段标 `cannot close`。F1/F2 manual evidence 是 §10.1 硬闸,不允许 unresolvable 登记。
- **WeChat 真机 smoke 六阶段历史**:F2 反复未交付,根因可能是物理设备约束。HP9 启动前(per §12 Q2)owner 必须锁定 5 套设备;若设备不可得,本阶段不应启动 HP9 / HP10,而应延期或放宽阶段范围(charter 主修订)。
- **review 成本**:沿用 RHX2 4 家 review 模式 × 10 份文档 ≈ 40 份 review;建议串行进行,可能延伸 HP9 时间。

---

### 7.11 HP10 — Final closure + 残余清理

#### 实现目标

完成阶段封板 — `hero-to-pro-final-closure.md` + `plan-hero-to-platform.md` 入口 stub + 残余 cleanup 决议后可删项物理删除。

#### In-Scope

1. **残余 cleanup 决议后可删项处理**:
   - 对 HP8-B R29 postmortem 判定为可删的 `forwardInternalJsonShadow` / `parity-bridge` historical residue 做物理删除;若判定需保留,则在 final closure 显式登记 `retained-with-reason`。
   - C2 jwt-shared dynamic import 评估(若可换回 static,本 phase 改;若不,explicit 保留)。
   - dead deploy-fill enum/type grep 验证零结果。
   - 14 retired guardians 在 `docs/architecture/test-topology.md` 显式列出。
2. **`hero-to-pro-final-closure.md`**:沿用 `zero-to-real-final-closure.md` 体例:
   - §1 阶段总览(11 个 phase 状态 + 4 套状态机最终状态)
   - §2 105 项 deferred 残留逐项归集(closed / accepted-as-risk / handed-to-platform)
   - §3 慢性 deferral F1-F17 最终判定
   - §4 与 hero-to-platform 衔接清单(明确 inherited issues)
3. **`plan-hero-to-platform.md` 入口 stub**:框架登记 hero-to-pro inherited issues(O1-O15);具体内容由 hero-to-platform 阶段写。

#### Out-of-Scope

1. hero-to-platform 实质内容(O1-O15)。
2. 任何新代码功能(本 phase 仅 cleanup + closure)。
3. 任何 manual evidence 补充(已在 HP9)。

#### 交付物

1. 残余 cleanup PR + grep / retained-registry 验证报告。
2. `docs/architecture/test-topology.md` 14 retired guardians 索引。
3. `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`。
4. `docs/charter/plan-hero-to-platform.md`(stub)。
5. `docs/issue/hero-to-pro/HP10-closure.md`(本 phase 自身的 closure)。

#### 收口标准

1. ✅ 需删除项 grep 验证全零;需保留项在 final closure 中显式登记 `retained-with-reason`。
2. ✅ final-closure 105 项 + F1-F17 全部 explicit 标判定。
3. ✅ hero-to-platform 入口 stub 创建。
4. ✅ HP10 closure 本身合规。

#### 什么不算完成

1. final-closure 标 "silently resolved" 任意一项。
2. hero-to-platform 入口 stub 未创建,导致下一阶段无入口。
3. 应删除项仍残留,或应保留项未登记理由。

#### 本 Phase 风险提醒

- **closure 合规风险**:final-closure 必须严格按 §10.4 收口类型判定表分类;若任一 Primary Exit Criteria 未达,本 phase 不得放行。
- **hero-to-platform 入口 stub 范围控制**:不要替 hero-to-platform 写实质内容;只登记 hero-to-pro inherited issues 与 O1-O15 的清单。

---

## 8. 执行顺序与 Gate

### 8.1 推荐执行顺序

1. **HP0(前置)** — 立即执行。
2. **HP1(DDL)** — HP0 closure 后。**所有后续 phase 必须等 HP1 closure**。
3. **HP2 → HP3 → HP4 → HP5 → HP6 → HP7 → HP8** 严格串行。
4. **HP9** — HP8 closure 后启动;部分文档 review 工作可与 HP8 末段并行(`F4 Lane E 终态文档` 是文档轮次的一部分)。
5. **HP10** — HP9 closure 后启动,本 phase ~1 周。

### 8.2 推荐 DAG / 依赖关系

```text
HP0 (前置)
└── HP1 (DDL 集中)
    ├── HP2 (Model)
    │   └── HP3 (Context)
    │       └── HP4 (Chat lifecycle + checkpoint conversation_only)
    │           └── HP5 (Confirmation + Hook dispatcher + F12/F13 e2e)
    │               └── HP6 (Tool/Workspace)
    │                   └── HP7 (Checkpoint full revert + fork)
    │                       └── HP8 (Hardening + chronic 收口)
    │                           └── HP9 (Docs + manual evidence + prod baseline)
    │                               └── HP10 (Final closure)
```

### 8.3 Gate 规则

| Gate | 含义 | 必须满足的条件 |
|------|------|----------------|
| **DDL Freeze Gate** | HP1 closure 标志 schema 冻结 | 7 个新 migration(007-013)local apply 通过 + schema doc review 通过 + checkpoint/provenance/cleanup 表 sanity check;HP2-HP10 默认禁止新 migration,受控例外见 §4.4 R8 |
| **wire-with-delivery Gate** | 任何 phase 宣称端点 live 必须有 cross-e2e 文件 | 端点端到端测试存在 + 全绿;特别针对 HP5 的 F12/F13 e2e 4 件套 |
| **chronic explicit Gate** | 每 phase closure 必须显式声明 F1-F17 状态 | 每项标 closed/partial/not-touched/handed-to-platform |
| **Documentation Freeze Gate** | HP9 启动前代码必须 freeze | HP8 closure 后所有代码改动停止,文档基于 freeze 版本写 |
| **Owner-Action Gate** | F14 R28、F1+F2 manual evidence、F16 prod baseline 必须 owner 配合 | 每项最晚冻结时点登记;若 owner 无法配合,必须显式登记阻塞状态。对 F1/F2/F16 这类硬闸项,阶段进入 `cannot close`,不得 handoff 后继续宣称本阶段收口 |
| **Final Closure Gate** | HP10 才能合法启动 | HP9 closure 通过 + F1/F2/F16 全部 explicit + 105 项 deferred 全部判定 |

### 8.4 为什么这样排

- **HP0 先于 HP1**:先完成可立即关闭的 defer 修复 + binding-presence verify + 字段命名提前对齐(HP0 `withNanoAgentSystemPrompt(modelId?)` 占位 + HP1 真落表);R29-dependent dead code 不在 HP0 强删,避免带着错误结论进入后续 phase。
- **HP1 是 Big Bang Migration**:所有后续 phase 受其约束;一次性完成避免 7 个 phase 各自 migration 引发 prod migration apply 多次 owner-action(F16 慢性教训)。
- **HP2-HP4 严格串行**:Model → Context → Chat 是状态机依赖关系(Context 需要 model 的 auto_compact_token_limit;Chat 需要 turn_attempt 已落)。
- **HP5 在 HP4 之后**:hook dispatcher 改造需要 kernel interrupt 路径已通(HP3-HP4 已构建)。
- **HP6 在 HP5 之后**:Tool/Workspace 状态机的 confirmation 复用 HP5 `/confirmations`。
- **HP7 在 HP6 之后**:file shadow snapshot 依赖 workspace temp file 已 live。
- **HP8 在 HP7 之后**:hardening 需要 4 套状态机已稳定。
- **HP9 在 HP8 之后**:文档基于 freeze 版本,manual evidence 也需要全部状态机 live。
- **HP10 最后**:closure 必须等所有 phase 关闭。

---

## 9. 测试与验证策略

### 9.1 继承的验证层

1. **Contract test**(各 worker `test/` 下的单元测试)— 继承 real-to-hero ~700+ orchestrator-core / ~1056 agent-core / packages 测试。
2. **Cross-E2E**(`test/cross-e2e/`)— 当前 14 个测试文件,HP5 必须补 4 个新文件(F13 慢性四阶段终结)。
3. **Drift guard**(`scripts/check-*.mjs`)— RHX2 已落 cycles + observability-drift 两个 guard;HP8 加 megafile-budget + tool-drift。
4. **Schema test**(每张新 D1 表的 schema 一致性测试)— HP1 集中。
5. **Manual evidence**(F1+F2)— HP9 集中。

### 9.2 本阶段新增的验证重点

| 类别 | 验证内容 | 目的 |
|------|----------|------|
| Model state machine | Cross-turn 模型切换 e2e(reasoning↔non-reasoning / vision↔non-vision / 131K↔24K)+ fallback audit | 确保 G6 闭环 |
| Context state machine | 长对话 auto-compact 不溢出 + cross-turn history 正确 + token estimation 误差监控 | 确保 G3/G4/G5 闭环 |
| Confirmation 收拢 | 7 类 kind 统一端点 + permission/elicitation 双发兼容期 | 确保 G7/G11 闭环 |
| Hook dispatcher 真接通 | tool 在 ask policy 下真实暂停 → 恢复 e2e(allow/deny/timeout)| 确保 F12 终结 |
| `pushServerFrameToClient` 真投递 | P1-10/P1-11/P1-12 + onUsageCommit WS push e2e 4 件套 | 确保 F13 终结 |
| Tool/Workspace state machine | LLM 写 todo + 跨 turn 读 temp file + cancel 单 tool + promote artifact | 确保 G10 闭环 |
| Checkpoint full revert | conversation_only + files_only + conversation_and_files + fork e2e | 确保 G9 闭环 |
| R2 multi-tenant 边界 | path traversal 防御 + tenants/ 强制前缀 | 确保 R2 真实接线后无 cross-tenant leak |
| Heartbeat alarm | abnormal disconnect 4 scenario | 确保 F6 终结 |
| 文档 review | 18 份 `clients/api-docs/` 4 家 review 关键 finding 修复 | 确保 G12 闭环 |

### 9.3 本阶段不变量

1. **6-worker 拓扑不变** — 不新增 worker。
2. **D1 = product truth 不变** — 不向 DO storage 倾倒 D1 truth,不向 D1 倾倒 runtime state。
3. **NACP 协议 backward compat 不变** — 任何新增不破坏现有 13 种消息。
4. **Workers AI 单 provider 不变** — 不引入其他 provider。
5. **6-worker RPC 拓扑不变** — bash-core / context-core / filesystem-core 仍是 service binding consumer。
6. **三层真相不变** — DO memory = active loop;DO storage = hot/runtime;D1 = product truth。

### 9.4 证据不足时不允许宣称的内容

1. "F12 hook dispatcher closed" — 必须有 P1-10 cross-e2e 文件全绿。
2. "F13 round-trip closed" — 必须有 4 个 cross-e2e 文件全绿。
3. "F14 R28 closed" — 必须有 wrangler tail trace 真定位 OR explicit hero-to-platform handoff 文档。
4. "F15 R29 closed" — 必须有 `R29-postmortem.md` 写明真实判定(三选一)。
5. "F1/F2 closed" — 必须有 5 套设备 evidence pack 实物(录像 + HAR + WS log)。
6. "F4 Lane E sunset" — 必须有 host-local consumer grep 验证零;若选 permanent fallback,必须有 `lane-e-final-state.md` 显式登记。
7. "Compact 真实运行" — 必须有 long-conversation e2e 不再溢出 crash 的证据。
8. "Cross-turn history" — 必须有 turn1→turn2 LLM 引用 e2e。

---

## 10. 收口分析(Exit / Non-Exit Discipline)

### 10.1 Primary Exit Criteria(硬闸)

1. **4 套产品状态机全部 live + e2e 全绿** — Model(HP2)+ Context(HP3)+ Chat(HP4)+ Tool/Workspace(HP6),配套 confirmation(HP5)+ checkpoint(HP4/HP7)。
2. **F1-F17 全部 explicit-resolve 或 explicit-handoff** — HP10 final closure 必须逐项判定;不允许 silent inherit。
3. **18 份 `clients/api-docs/` 与代码 100% 对齐** — HP9 4 家 review 关键 finding 全部修复(critical 0,high 全部修)。
4. **F1 + F2 manual evidence pack 完整归档** — 5 套设备 × 完整 e2e。
5. **F16 prod schema baseline 文档化** — HP9 prod schema 与 migrations/ 对齐验证。
6. **F12 + F13 e2e 4 件套全部就位** — `test/cross-e2e/15-18` 4 个文件全绿。
7. **HP1 DDL freeze 不被破坏** — HP2-HP10 无新 migration(charter §4.5 例外除外)。
8. **DO + D1 一致性 e2e 全绿** — checkpoint revert + 重启 worker 后两源不漂移。

### 10.2 Secondary Outcomes(结果加分项,不是硬闸)

1. F14 R28 root cause 真定位(若不能,explicit handoff 也算合法终态)。
2. F15 R29 postmortem 三选一中选"零 diff"(若选"有 diff" 或 "不可验证",也算合法终态)。
3. F4 Lane E 选路径 A(物理 sunset)而非路径 B(permanent fallback)。
4. user-do-runtime.ts 行数从 1171 真实下降(HP8 只做 stop-the-bleed,不强求下降)。
5. 4 家 review 反馈中的 medium/low finding 全部修复(critical/high 是硬闸,medium/low 是 secondary)。

### 10.3 NOT-成功退出识别

以下任一成立,则**不得**宣称 hero-to-pro 收口:

1. F12 hook dispatcher 未真接通(`hooks/permission.ts` 仍走同步 verdict)。
2. F13 round-trip e2e 4 件套任一缺失或不绿。
3. F1+F2 manual evidence 任一设备未完成。
4. 18 份 `clients/api-docs/` 任一与代码漂移(critical/high finding 未修)。
5. F4 Lane E 仍标"短期 shim"而非二选一终态。
6. F15 R29 标"silently resolved" 无证据。
7. R2 multi-tenant 测试存在 path traversal bypass。
8. HP10 final closure 缺失 105 项任一项的判定。
9. compact 真实运行但 24K context_window 模型仍溢出 crash。
10. cross-turn history e2e(turn1→turn2 引用)失败。

### 10.4 收口类型判定表

| 收口类型 | 含义 | 使用条件 | 文档要求 |
|----------|------|----------|----------|
| `full close` | 阶段核心目标与硬闸全部满足 | Primary Exit 1-8 全绿 + Secondary 至少 3 项 + NOT-成功识别全部不成立 | hero-to-pro-final-closure.md 标 `full close`;无 known-issues 残留 |
| `close-with-known-issues` | 主线已完成,但残留问题被明确降级且不破坏阶段目标 | Primary Exit 1-8 全绿,但 Secondary 中 F14 R28 / F15 R29 三选一中选了"不可验证"或"explicit handoff" | hero-to-pro-final-closure.md 标 `close-with-known-issues`;§3 列出残留 + 影响 + 下游落点 |
| `cannot close` | 仍存在 blocker / truth drift / 证据不足 | NOT-成功退出识别中任一成立 | hero-to-pro-final-closure.md 不允许写;阶段不得宣称收口;owner 决定后续 plan |

### 10.5 这一阶段成功退出意味着什么

完成 hero-to-pro 后,nano-agent 第一次具备:

1. **真实 4 层模型状态机**(default → session → turn → effective+fallback,全部 D1 audit)。
2. **真实跨 turn 上下文**(LLM 看到完整历史,不再单 turn 失忆)。
3. **真实 auto-compact + manual compact preview/job**(per-model 阈值,不再溢出 crash)。
4. **真实 permission/elicitation 工具暂停 + 恢复**(NACP 协议第一次端到端通电,F12/F13 终结)。
5. **真实 conversation/files/conversation_and_files 三模式 revert + session fork**(用户可以回到 turn N 重做或 A/B 分叉)。
6. **真实 7 类 confirmation 统一控制平面**。
7. **真实 todo/plan + workspace temp file CRUD + tool inflight + workspace→artifact promotion**。
8. **18 份 `clients/api-docs/` 与代码 100% 对齐 + F1/F2 manual evidence 完整归档**。
9. **慢性 deferral F1-F17 全部 explicit**,zero-to-real/real-to-hero 历史债务清算完毕。

到这一步,nano-agent 与 Claude Code / Codex / Gemini CLI 在 4 套产品状态机上同档位,允许个别 advanced 特性(如 sub-agent / multi-provider)仍 out-of-scope;hero-to-platform 可以从干净 baseline 出发。

### 10.6 这一阶段成功退出**不意味着**

1. **不**意味着 nano-agent 是 multi-provider LLM 平台(O1)。
2. **不**意味着 nano-agent 支持 sub-agent / multi-agent(O2)。
3. **不**意味着 nano-agent 有完整 admin plane / billing(O3/O4)。
4. **不**意味着 nano-agent 是跨设备 session resume 平台(O5)。
5. **不**意味着 NanoSessionDO + user-do-runtime 已完整 handler-granularity decomposition(O7;只是 stop-the-bleed)。
6. **不**意味着 prompt caching / structured output 已就绪(O10)。
7. **不**意味着 sandbox 隔离已就绪(O11)。

---

## 11. 下一阶段触发条件

### 11.1 下一阶段(hero-to-platform)会正式纳入 In-Scope 的内容

1. Multi-provider LLM routing(DeepSeek / OpenAI / Anthropic adapter 接入)。
2. Sub-agent / multi-agent(`Op::MultiAgentsSpawn` 等价能力)。
3. Admin plane(API key 管理 / 模型 catalog 管理 / team management UI)。
4. Billing / cost-aware quota / per-model pricing。
5. Remote ThreadStore API(跨设备 session resume)。
6. SDK extraction(F8 升级路径,真实包发布)。
7. 完整 handler-granularity refactor(F5 升级路径)。
8. WORKER_VERSION CI 切换(GitHub Actions git-sha)。
9. Prompt caching / structured output(依赖 multi-provider)。
10. Sandbox 隔离 / streaming progress for bash。
11. SQLite-backed DO(若 user-do KV 真出 list/分页瓶颈)。
12. F10 multi-tenant per-deploy / 更深 internal RPC。
13. F11 client package extraction(JS shim)。
14. TodoWrite V2 task graph(parent-child execution + sub-task spawn)。
15. WeChat miniprogram 完整适配(独立专项)。
16. 3-tier observability spike → 单发切换(O9,等真实数据观察)。

### 11.2 下一阶段的开启前提

1. hero-to-pro `full close` 或 `close-with-known-issues`(由 HP10 final closure 标定)。
2. hero-to-pro inherited issues 已在 `plan-hero-to-platform.md` stub 完整登记。
3. 4 套产品状态机已 live(Primary Exit 1)。
4. 18 份 `clients/api-docs/` 已与代码对齐(Primary Exit 3)。

### 11.3 为什么这些内容不能前移到本阶段

- **Multi-provider / Sub-agent 等 O1-O15** — 4 套状态机闭环优先;在 wrapper 控制面没收口前做,会让"4 套状态机 × N provider × M sub-agent"爆增到不可控。
- **Admin / billing / SDK** — 与 wrapper 控制面正交;hero-to-pro 命题是产品基线,这些是平台特性。
- **完整 handler refactor** — 排他工作量大,与 HP2-HP7 改动撞;HP8 只做行数 stop-the-bleed gate。
- **SQLite-DO** — 当前 D1 + DO storage 已支撑 hibernation;list/分页用 KV cursor + D1 keyset 即可;真出瓶颈再做。

---

## 12. Owner / Architect 决策区

> 本节只冻结**必须在 charter 阶段就回答的跨 phase 决策**;每个 phase 内部的 Q&A 应在该 phase design doc。

### Q1 — F14 R28 owner-action 时点

- **为什么必须回答**:HP8-A 依赖 owner 跑 wrangler tail;若 owner 配合不及时,F4 Lane E 终态判定也受阻(路径 A 依赖 R28 修)。
- **当前建议 / 默认答案**:HP8 启动前 2 周内 owner 跑 wrangler tail 复盘;若不能,explicit handoff hero-to-platform。
- **最晚冻结时点**:HP8 启动日。

### Q2 — F1+F2 manual evidence pack 时点

- **为什么必须回答**:HP9 owner-action 强依赖;5 套设备录制需要物理资源。
- **当前建议 / 默认答案**:HP9 启动前 owner 锁定 5 套设备 + 制定录制脚本;HP9 启动后 1 周内完成。
- **最晚冻结时点**:HP9 启动日。

### Q3 — F16 prod migration apply 节奏

- **为什么必须回答**:HP1 落地 7 个新 migration(`007-013`),prod apply 是 owner-action;若 HP9 baseline 验证发现漂移,需补救 migration(charter §4.4 R8 受控例外)。
- **当前建议 / 默认答案**:HP1 closure 后 owner 立即 prod apply;HP9 baseline 时 verify。
- **最晚冻结时点**:HP9 启动日。

### Q4 — F4 Lane E 二选一终态决断

- **为什么必须回答**:HP8-D 必须做出二选一;路径 A(sunset)依赖 R28 修;路径 B(permanent fallback)无依赖但放弃架构清洁。
- **当前建议 / 默认答案**:取决于 Q1 的结果;若 R28 修 → 路径 A;若不修 → 路径 B + 显式登记。
- **最晚冻结时点**:HP8 启动日。

### Q5 — permission/elicitation 旧端点物理删除时点

- **为什么必须回答**:HP5 内只做 redirect;3 个月后(可选)删除,但本阶段 HP10 不强制。
- **当前建议 / 默认答案**:hero-to-pro 内不删除;留 hero-to-platform 或独立 cleanup PR。
- **最晚冻结时点**:HP5 design doc 内。

---

## 13. 后续文档生产清单

### 13.1 Design 文档

- `docs/design/hero-to-pro/HP1-schema-extension.md`(HP1 启动前先写,作为 DDL 字段命名提前对齐)
- `docs/design/hero-to-pro/HP2-model-state-machine.md`
- `docs/design/hero-to-pro/HP3-context-state-machine.md`
- `docs/design/hero-to-pro/HP4-chat-lifecycle.md`
- `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`
- `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`(同时含 R2 multi-tenant 设计)
- `docs/design/hero-to-pro/HP7-checkpoint-revert.md`
- `docs/design/hero-to-pro/HP8-runtime-hardening.md`
- `docs/architecture/hero-to-pro-schema.md`(HP1 交付)
- `docs/architecture/lane-e-final-state.md`(HP8-D 交付)

### 13.2 Action-Plan 文档

- `docs/action-plan/hero-to-pro/HP0-action-plan.md`
- `docs/action-plan/hero-to-pro/HP1-action-plan.md`
- `docs/action-plan/hero-to-pro/HP2-action-plan.md`
- `docs/action-plan/hero-to-pro/HP3-action-plan.md`
- `docs/action-plan/hero-to-pro/HP4-action-plan.md`
- `docs/action-plan/hero-to-pro/HP5-action-plan.md`
- `docs/action-plan/hero-to-pro/HP6-action-plan.md`
- `docs/action-plan/hero-to-pro/HP7-action-plan.md`
- `docs/action-plan/hero-to-pro/HP8-action-plan.md`
- `docs/action-plan/hero-to-pro/HP9-action-plan.md`
- `docs/action-plan/hero-to-pro/HP10-action-plan.md`

### 13.3 Closure / Handoff 文档

- `docs/issue/hero-to-pro/HP0-closure.md` 至 `docs/issue/hero-to-pro/HP10-closure.md`(每 phase 一份)
- `docs/issue/hero-to-pro/manual-evidence-pack.md`(HP9 交付)
- `docs/issue/hero-to-pro/prod-schema-baseline.md`(HP9 交付)
- `docs/issue/zero-to-real/R29-postmortem.md`(HP8-B 交付,虽放在 zero-to-real 文件夹但本阶段写)
- `docs/runbook/zx5-r28-investigation.md` §3 真实回填(HP8-A,owner-action)
- `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`(HP10 交付)
- `docs/charter/plan-hero-to-platform.md`(HP10 交付,stub)

### 13.4 建议撰写顺序

1. HP1 design doc(`HP1-schema-extension.md`)— HP0 启动前完成,作为字段命名提前对齐参考。
2. HP0 action-plan + HP0 启动 + HP0 closure。
3. HP1 action-plan + HP1 启动 + HP1 closure(DDL Freeze Gate 触发)。
4. 每个 HPN(N=2..8)依次:design → action-plan → 启动 → closure。
5. HP9 action-plan + HP9 启动(Documentation Freeze Gate 已触发,代码 freeze)。
6. HP9 内部:文档 → 4 家 review → 修复 → manual evidence(owner-action)→ prod baseline → HP9 closure。
7. HP10 action-plan + HP10 启动 + final closure(`hero-to-pro-final-closure.md`)+ `plan-hero-to-platform.md` 入口 stub。

---

## 14. 最终 Verdict

### 14.1 对本阶段的最终定义

hero-to-pro 是 nano-agent 第一次完整具备 LLM wrapper 控制平面的产品基线阶段:**4 套产品状态机闭环 + 105 项 deferred 残留全部 explicit + 18 份客户端文档对齐 + 5 套设备 manual evidence**。它继承 real-to-hero 的 6-worker / NACP / D1 truth 基础,但不再容忍 wire-without-delivery、deceptive closure、慢性 deferral silent inherit 这些历史模式。

### 14.2 工程价值

- **架构清晰**:4 套产品状态机替代散乱端点,后续每个产品需求落地都有明确状态机归属。
- **历史债务清算**:zero-to-real(13 份 closure)+ real-to-hero(12 份 closure)留下的 105 项 deferred 一次性归集 + explicit。F12/F13/F15 三类 deceptive 模式被显式拒绝,杜绝再传站。
- **schema 一次冻结**:HP1 集中 DDL 后,HP2-HP10 严禁加新 migration,prod migration apply 只做一次(F16 慢性教训)。
- **wire-with-delivery 纪律**:F12 hook dispatcher 5 阶段 + F13 round-trip e2e 4 阶段慢性 carryover 终结,任何"wire 完整但无调用方"将不再被接受为 phase 闭合。

### 14.3 业务价值

- **客户端可建产品**:`/sessions/{id}/model` + `/context/probe` + `/checkpoints` + `/todos` + `/workspace/files` + `/confirmations` 共同构成完整产品控制面;前端可基于这些端点构建可控、可回滚、可审计的 agent 客户端。
- **运营可信**:F1+F2 manual evidence 5 套设备完整归档;`clients/api-docs/` 18 份文档与代码对齐;prod schema baseline 已知。
- **Workers AI 多模型可消费**:现有 seed 模型集 + 4 alias + reasoning effort 完整暴露;客户端可主动选择 fast / balanced / reasoning / vision。
- **长对话不再 crash**:auto-compact + cross-turn history + `<model_switch>` 注入,长对话 + 模型切换不再溢出。
- **用户可回滚**:checkpoint 三模式 + session fork,Agent 调试 / A/B 对比成为产品语义。

### 14.4 一句话总结

> **hero-to-pro = 让 nano-agent 第一次拥有成熟 LLM wrapper 的全部产品状态机,并把 zero-to-real + real-to-hero 留下的所有 silent gap 与 deceptive closure 一次性清算,为 hero-to-platform 提供干净 baseline。**

---

## 15. 维护约定

1. **charter 只更新冻结边界、Phase 定义、退出条件,不回填逐任务执行日志。**
2. **执行过程中的具体变更进入各 phase action-plan / closure。**
3. **若阶段方向被重写,必须在文首修订历史说明:改了什么、为什么改。**
4. **若某项由 in-scope 改为 out-of-scope(或反向),必须同步更新 §4、§7、§10、§11。**
5. **若采用 `close-with-known-issues`,必须在 final-closure 文档里复写对应残留问题、影响范围与下游落点。**
6. **DDL 字段命名一旦在 HP1 closure 冻结,后续 phase 严禁重命名;若必须改名,charter 主修订(版本号 +1)。**
7. **F1-F17 任一项的 phase 归属调整必须同步修订 §6.3 + §10.3。**

---

## 16. 附加阶段（HPX1–HPX7）执行回填

### 16.1 回填说明

本章记录的是 **charter 冻结后新增的 7 个附加阶段**。它们不是对 HP0–HP10 原始职责矩阵的推翻，而是对 hero-to-pro 后期真实落地面的补充说明：在原始状态机 / chronic / docs / closure 主线之外，我们又完成了一批 **测试归真、full-closure 修复、API 合规、巨石拆分、wire-up 接线、workbench 控制面补完、closure honesty uplift** 工作。这些内容已经真实进入代码与文档，因此需要在基石文件底部留下阶段级摘要。

### 16.2 HPX1–HPX7 分阶段总结

| 附加阶段 | 核心补题 | 已落地的额外工作 | 对本阶段基石判断的补充 |
|------|----------|----------------|------------------------|
| **HPX1** | 测试资产归真 | 清理与当前 6-worker reality 冲突的 leaf-worker package-e2e / placeholder cross-e2e；把 bash-core / orchestrator-auth / orchestrator-core 的关键边界回迁到 worker-local；同步 `test/index.md` 与 `docs/architecture/test-topology.md` | hero-to-pro 后期的测试基线不再建立在历史残影与空壳 e2e 上，而是建立在与现行拓扑一致的分层测试树上 |
| **HPX2** | Full-closure gate 修复 | 修复 public websocket façade 的 `101` attach / reconnect / revoke-close 链路；把 `initial_context` gate 改为稳定 invariant；把 HP2 model live contract 与 RH5 reasoning / vision evidence 修回真实运行时；重新打通 full live-e2e gate | hero-to-pro 的封板证据从“环境可用但 closure gate 不绿”推进到“preview live gate 可作为真实阶段证据” |
| **HPX3** | API 合规收口 | 分两批修复 facade error envelope / error code 漂移、ownership 缺口、路由测试缺口与 client docs 漂移；补齐 `facade-http-v1` 与多簇 API 的 code/doc/test 一致性 | hero-to-pro 不再只是“功能存在”，而是把 public contract 收束到可验证、可审计、可对外声明的合规状态 |
| **HPX4** | façade 巨石拆分 | 将 `workers/orchestrator-core/src/index.ts` 从 3015 行拆到 18 行薄入口；抽出 `facade/shared/**`、`facade/routes/**`、`route-registry.ts`；对 `user-do/session-flow.ts` 做 second pass；把新增 owner file 全部纳入 megafile gate | 本阶段后期的 orchestrator façade 已不再是结构性瓶颈，HP8 硬化出的行数纪律在代码结构上真正落地 |
| **HPX5** | schema-frozen wire-up | 新建 `emit-helpers` 统一 emit seam；接通 confirmation / todos / `model.fallback` 的真实 emit；让 LLM 可直接 `write_todos`；接通 workspace temp file bytes `/content`；接上 auto-compact wiring 与 compact body 透传；新增 `client-cookbook.md`，并让 `/start` 返回 `first_event_seq` | 原来停留在 schema / stub / absorbed 层的多条能力，首次变成前端可直接消费的 delivered surface |
| **HPX6** | workbench-grade controls | 升级 `@haimang/nacp-session` 到 1.5.0；落地 tool-call ledger、public WS `session.followup_input` 转发、`/runtime` + permission rules、legacy `permission_mode` hard delete、Queue-backed executor path（在保持 6-worker 拓扑前提下落到 orchestrator-core）、`/items` 对象层与 `file_change` item；client docs 扩展到 22-doc pack | hero-to-pro 的实际终盘已从“成熟 wrapper 控制平面”继续推进到“workbench-grade agent loop backend”，且没有打破 6-worker 基本拓扑 |
| **HPX7** | closure honesty uplift | 修正 HP5 HookDispatcher 的 deceptive closure 口径；让 `tool.call.cancelled` 补上 live producer 与 public cancel WS forward；把 `/runtime` 升级为 `ETag / If-Match` public optimistic lock；用 route-level tests 验证 `/items` 7-kind public truth；最终把 hero-to-pro final closure 从 `partial-close / 7-retained` 收敛到 `close-with-known-issues / 4 owner-action retained` | hero-to-pro 的最终交接不再只是“代码大体存在”，而是把最后一层 honesty / residual / retained map 收束到可承接 PP0 的可信状态 |

### 16.3 这 7 个附加阶段共同改写了哪些后期现实

1. **测试现实更诚实了**：HPX1 + HPX2 之后，本阶段后期的验证体系不再依赖 placeholder e2e、失效 direct probe 或模糊 closure 口径。
2. **public contract 更可宣称了**：HPX3 之后，hero-to-pro 的 HTTP / WS facade 不只是“能跑”，而是更接近 code / schema / docs 三者锁步。
3. **结构债务被真正压下去了**：HPX4 让 HP8 的 megafile hardening 从纪律文本变成了真实文件结构。
4. **bridging API gap 进入 delivered 状态**：HPX5 把 emit / bytes / compact / write_todos / first-event window 这些前端真正依赖的能力接成了实线。
5. **后期实际客户端文档基线已扩到 22 份**：相较 charter 正文里的 18-doc 目标，后续执行新增了 `client-cookbook.md`、`runtime.md`、`items.md`、`tool-calls.md`，使文档面更接近 workbench 真实消费方式。
6. **6-worker 基石仍然成立**：虽然 HPX6 引入了 Queue executor 主路径，但最终选择是在 `orchestrator-core` 内承接 consumer，而没有把系统改写成新的 7-worker 常态拓扑。
7. **阶段 closure 终于和真实代码对齐了**：HPX7 之后，hero-to-pro 不再把工程 cleanup、verification-only 结果与 owner-action retained 混写成单一“未完成”块，final closure 能更诚实地表达当前工程状态。

### 16.4 回填后的阶段定位

回看整个 hero-to-pro，原始 charter 定义的 **“4 套产品状态机闭环 + chronic deferral explicit 化 + client docs 对齐”** 仍然成立；但经过 HPX1–HPX7 之后，本阶段的**实际完成面**已经更接近：

> **在不打破 6-worker 基石的前提下，把 nano-agent 从“成熟 LLM wrapper 控制平面”继续推到“具备 workbench-grade controls、对象层与 reconnect/reconcile 友好面的 agent loop backend”。**
