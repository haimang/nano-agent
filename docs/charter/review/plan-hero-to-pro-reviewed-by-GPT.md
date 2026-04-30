# Nano-Agent Charter 审查：`plan-hero-to-pro.md`

> 审查对象: `docs/charter/plan-hero-to-pro.md`  
> 审查类型: `phase-charter-review | baseline-value-review | code-collision-review`  
> 审查时间: `2026-04-30`  
> 审查人: `GPT-5.5`  
> 文档状态: `changes-requested`

---

## 0. 总结结论

`plan-hero-to-pro.md` 的中心命题是成立的：它正确识别了 real-to-hero 之后 nano-agent 的核心短板不是“能不能跑一次 session”，而是缺少成熟 LLM wrapper 所需的 **Model / Context / Chat / Tool-Workspace 四套产品状态机**，并且把 zero-to-real + real-to-hero 的长期 deferred 债务纳入统一清算。

但作为“基线纲领文件”，当前版本仍不应直接冻结。原因不是方向错误，而是存在几类会在执行中造成断点的结构性问题：

1. **当前代码事实与 charter 部分 Reality Snapshot 已不同步**：例如 `CONTEXT_CORE` binding 当前已在 `agent-core/wrangler.jsonc` 打开；`modelCatalogDb` 也已传入；当前 migration 最新是 `006`，不是 charter 多处暗示的 `008`。
2. **HP1 DDL 集中扩展没有覆盖 HP4/HP7 checkpoint 全模式 revert 的必需 schema**，但 charter 又规定 HP2-HP10 严禁新增 migration；这会让 HP4/HP7 在执行时必然破戒或只能用非结构化 payload 硬塞。
3. **HP9 文档数量和清单自相矛盾**：正文说 17 份文档，但 11 份现有 + 7 份新增实际是 18 份。
4. **owner-action 与 final closure gate 存在“硬闸 vs unresolvable”矛盾**：F1/F2 manual evidence 被写成 Primary Exit 硬闸，但 HP9 风险又允许 HP10 登记为 unresolvable。
5. **若不修正上述问题，HP0-HP10 即使逐项执行，也可能得到“端点很多、状态机不完整、证据口径不统一”的近似产物，而不是 charter 预期的成熟 LLM wrapper baseline。**

**最终 verdict**：`changes-requested`。  
**是否认可阶段方向**：`yes`。  
**是否建议按当前 charter 直接启动 HP0**：`no`，建议先修订 charter 中的 DDL、文档数量、owner-action gate、已完成/未完成事实，再进入 action-plan。

---

## 1. 审查范围与方法

### 1.1 已阅读 / 对照的 reference 文件

| 类型 | 文件 |
|---|---|
| Hero-to-pro charter | `docs/charter/plan-hero-to-pro.md` |
| 直接输入包 Part 1/2 | `docs/eval/hero-to-pro/closing-thoughts-part-1-by-opus.md`、`closing-thoughts-part-2-by-opus.md` |
| LLM wrapper studies | `docs/eval/hero-to-pro/llm-wrapper-study-by-deepseek.md`、`llm-wrapper-study-by-GLM.md`、`llm-wrapper-study-by-GPT.md` |
| API gap studies | `docs/eval/hero-to-pro/agentic-loop-api-study-by-deepseek.md`、`agentic-loop-api-study-by-GLM.md`、`agentic-loop-api-study-by-GPT.md` |
| 上阶段 closure | `docs/issue/zero-to-real/zero-to-real-final-closure.md`、`docs/issue/real-to-hero/RHX2-closure.md`、`RHX2-dual-emit-window.md`，并抽查 zero-to-real / real-to-hero closure 文件清单 |
| 当前代码事实 | `workers/orchestrator-core/`、`workers/agent-core/`、`workers/context-core/`、`workers/filesystem-core/`、`workers/bash-core/`、`packages/nacp-session/`、`clients/api-docs/` |
| 既有 charter review 体例 | `docs/charter/review/plan-real-to-hero-reviewed-by-GPT.md` |

### 1.2 已核实的关键代码事实

| 事实 | 当前证据 | 审查影响 |
|---|---|---|
| 当前 public facade 仍是 `orchestrator-core` | `clients/api-docs/README.md:1-5`；`workers/orchestrator-core/src/index.ts:651-664,675-720` | charter 6-worker / facade owner 判断成立 |
| 当前 `/models` 已 live，但只有列表端点 | `workers/orchestrator-core/src/index.ts:651-653,1347-1419` | HP2 model detail/session model API 仍有必要 |
| `/messages` 支持 `model_id/reasoning`，`/start`/`/input` public path 仍丢字段 | `workers/orchestrator-core/src/session-lifecycle.ts:41-57`；`user-do/session-flow.ts:342-347,445-454`；`message-runtime.ts:134-161,296-310` | HP0 K2 仍成立 |
| `agent-core` 已传 `modelCatalogDb` | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:123-133` | charter 已修正 DeepSeek stale finding，成立 |
| `CONTEXT_CORE` binding 当前已打开 | `workers/agent-core/wrangler.jsonc:44-51,97-101` | HP0 “解开 CONTEXT_CORE binding 注释”已过期 |
| `context-core` 三 RPC 仍是 stub | `workers/context-core/src/index.ts:135-202` | HP3 是必要主线 |
| `compactRequired` 仍硬写 false | `workers/agent-core/src/host/orchestration.ts:294-300` | HP3 compact 主线必要 |
| 当前 migrations 只有 `001`-`006` | `workers/orchestrator-core/migrations/001-identity-core.sql` 至 `006-error-and-audit-log.sql` | charter 多处 `008` / HP1 `009-016` 起点不匹配 |
| 当前 `clients/api-docs/` 现有 11 份 md | `clients/api-docs/{README,auth,catalog,error-index,me-sessions,permissions,session,session-ws-v1,usage,wechat-auth,worker-health}.md` | HP9 文档数量需修 |
| 当前 cross-e2e 文件有 14 个编号文件 + `zx2-transport`，无 `15-18` round-trip 四件套 | `test/cross-e2e/01-...14-...` | F13 “缺 e2e”判断成立 |
| `forwardInternalJsonShadow` 和 `parity-bridge` helpers 仍存在 | `workers/orchestrator-core/src/user-do-runtime.ts:751-760`；`workers/orchestrator-core/src/parity-bridge.ts:57-63,182-219` | HP0/HP8 dead code 收口仍有依据，但需区分“方法名历史残留”与“真实 shadow 行为” |

---

## 2. 正面判断：charter 主体为什么成立

### 2.1 阶段命题正确

`plan-hero-to-pro.md` 把阶段定义为“从 first-wave runtime substrate 到成熟 LLM wrapper”，这是对当前代码状态的准确概括。

当前系统确实已经具备：

1. 6-worker 拓扑；
2. NACP session schema；
3. Workers AI live loop；
4. D1 product truth；
5. DO hot/runtime checkpoint；
6. RHX2 observability/debug/audit 主线；
7. web-first spike 证明 `system.error` 双发和 debug inspector 可以被客户端消费。

但这些还不足以成为成熟 agent 产品。当前缺口集中在模型状态、上下文治理、聊天生命周期、工具/工作区控制面。charter 用四套状态机统一组织 HP0-HP10，方法论比“端点散打”更正确。

### 2.2 Out-of-Scope 划线基本健康

charter 明确不做：

1. multi-provider；
2. sub-agent / multi-agent；
3. admin plane / billing；
4. SQLite-backed DO；
5. 完整 SDK extraction；
6. 完整 handler-granularity refactor。

这些划线是合理的。当前如果把 multi-provider、sub-agent、billing 提前塞进 hero-to-pro，会让“4 套状态机 × N provider × M agent”的组合复杂度爆炸，反而破坏阶段主目标。

### 2.3 慢性 deferral explicit-only 纪律是必要的

charter 把 F1-F17 chronic deferral 纳入 HP8-HP10 的显式判定，是对 zero-to-real / real-to-hero 历史模式的正确修复。尤其是：

1. F12 hook dispatcher “wire complete but no caller”；
2. F13 `pushServerFrameToClient` round-trip e2e 缺失；
3. F15 R29 “resolved-by-deletion-not-fix”；
4. F1/F2 manual evidence 长期 carryover；
5. F16 prod schema baseline 不可知。

这些不在 hero-to-pro 清算，就会继续成为 hero-to-platform 的 inherited issue。charter 把它们压入硬闸是对的。

---

## 3. Finding 汇总

| 编号 | 标题 | 严重级别 | 类型 | 是否阻塞 charter 冻结 |
|---|---|---:|---|---|
| R1 | HP1 DDL 集中扩展缺少 checkpoint/product restore 必需 schema | `critical` | `schema-gap` | yes |
| R2 | migration 基线编号与当前仓库事实不一致 | `high` | `execution-risk` | yes |
| R3 | HP0 包含已经完成或已经改变的前置项，Reality Snapshot 需要更新 | `high` | `fact-drift` | yes |
| R4 | HP9 文档数量 17/18 自相矛盾 | `medium` | `docs-gap` | yes |
| R5 | manual evidence 是硬闸还是可登记 unresolvable，当前口径冲突 | `high` | `closure-gate-conflict` | yes |
| R6 | F13 “100% delivered:false” 表述过强，应改为“缺真实 round-trip e2e 证明” | `medium` | `evidence-overclaim` | no |
| R7 | Tool/Workspace 与 Checkpoint 的 R2/D1 retention schema 不完整 | `high` | `schema-gap` | yes |
| R8 | HP1 “DDL 集中后后续严禁 migration”纪律过硬，缺少变更管理逃生口 | `medium` | `process-risk` | no |
| R9 | reference 文件中的 Part 1 / Part 2 phase 编号与 charter 编号已重排，需防止执行者误读 | `medium` | `docs-risk` | no |

---

## 4. 详细 Findings

### R1. HP1 DDL 集中扩展缺少 checkpoint/product restore 必需 schema

- **严重级别**：`critical`
- **类型**：`schema-gap`
- **是否阻塞冻结**：`yes`

#### 事实依据

charter 在 §7.2 / HP1 中声明要一次性落 hero-to-pro 全阶段所需 D1 schema，并且 HP2-HP10 严禁新增 migration。HP1 in-scope 包括：

1. model metadata；
2. session/turn model audit；
3. `turn_attempt`；
4. message superseded marker；
5. `nano_session_todos`；
6. `nano_session_temp_files`；
7. `nano_session_confirmations`；
8. conversation tombstone。

但 HP4 / HP7 又要求：

1. `GET /sessions/{id}/checkpoints`；
2. `POST /sessions/{id}/checkpoints`；
3. `GET /sessions/{id}/checkpoints/{id}/diff`；
4. `POST /sessions/{id}/checkpoints/{id}/restore`；
5. lazy file snapshot；
6. checkpoint TTL；
7. session fork；
8. R2 snapshot path；
9. restore confirmation gate；
10. conversation_only / files_only / conversation_and_files 三模式。

当前 HP1 schema 没有任何 dedicated checkpoint 表，例如：

1. `nano_session_checkpoints`；
2. `nano_checkpoint_message_ranges`；
3. `nano_checkpoint_file_snapshots`；
4. `nano_checkpoint_restore_jobs`；
5. checkpoint TTL / mode / named checkpoint / compact-boundary checkpoint / lazy-materialization 状态字段。

当前已有 `nano_conversation_context_snapshots`，但它是 context snapshot 表，不足以表达用户可见 checkpoint timeline、file shadow snapshot、restore job、fork lineage。

#### 为什么重要

如果 HP1 不补 checkpoint schema，则 HP4/HP7 只有三种选择：

1. 破坏 charter 的 DDL Freeze Gate，在 HP4/HP7 新增 migration；
2. 把 checkpoint metadata 塞进 `payload_json`，牺牲 queryability / TTL / restore audit；
3. 只实现 conversation message supersede，放弃 files_only / conversation_and_files 的产品级 restore。

三者都会破坏 charter 预期价值。

#### 建议修法

在 HP1 DDL in-scope 中补充 checkpoint schema，至少包括：

```sql
nano_session_checkpoints (
  checkpoint_uuid TEXT PRIMARY KEY,
  session_uuid TEXT NOT NULL,
  conversation_uuid TEXT NOT NULL,
  team_uuid TEXT NOT NULL,
  turn_uuid TEXT,
  checkpoint_kind TEXT CHECK (...),
  label TEXT,
  message_high_watermark TEXT,
  latest_event_seq INTEGER,
  context_snapshot_uuid TEXT,
  file_snapshot_status TEXT CHECK (...),
  created_by TEXT CHECK ('user','system','compact','turn_end'),
  created_at TEXT NOT NULL,
  expires_at TEXT
)
```

以及 file snapshot / restore job 相关表。若 owner 不希望 HP1 加这么多表，则必须放宽 “HP2-HP10 严禁新增 migration” 纪律，至少允许 HP7 增加 checkpoint file snapshot migration。

---

### R2. migration 基线编号与当前仓库事实不一致

- **严重级别**：`high`
- **类型**：`execution-risk`
- **是否阻塞冻结**：`yes`

#### 事实依据

当前仓库真实 migrations 只有：

1. `001-identity-core.sql`
2. `002-session-truth-and-audit.sql`
3. `003-usage-quota-and-models.sql`
4. `004-session-files.sql`
5. `005-user-devices.sql`
6. `006-error-and-audit-log.sql`

但 charter 多处表述暗示当前已有 `migrations/002-008` 或 `migrations/008-models.sql`：

1. Reality Snapshot 写 `migrations/002-008`；
2. Reality Snapshot 写 `migrations/008-models.sql(per RH2)`；
3. HP1 交付物从 `009-model-metadata-enrichment.sql` 到 `016-conversation-tombstone.sql`。

实际当前模型 seed 在 `003-usage-quota-and-models.sql` 内，且 seed 条数也不是 charter 口径中的 “13+” 简单状态；当前文件中 seed 了大量 Workers AI 模型。

#### 为什么重要

migration 编号是执行中非常容易出事故的地方。若 action-plan 按 `009-016` 写，而仓库实际最新是 `006`：

1. 会制造空洞编号；
2. 可能与已有分支 / owner 认知冲突；
3. prod baseline 时难以解释 `007/008` 去向；
4. 后续 HP9 prod schema baseline 会变复杂。

#### 建议修法

二选一：

1. **按当前仓库事实重排 HP1 migration 编号**：从 `007-...` 开始；
2. **如果确有未提交的 007/008 历史**，把这些 migration 文件先落入仓库或在 charter 中明确说明“007/008 已在外部执行但未纳入当前仓库”的原因。

建议使用连续编号：

| 建议编号 | 内容 |
|---|---|
| `007-model-metadata-enrichment.sql` | model columns + aliases |
| `008-session-model-audit.sql` | session / turn model audit |
| `009-turn-attempt-and-message-supersede.sql` | retry + superseded |
| `010-agentic-loop-todos.sql` | todos |
| `011-session-temp-files.sql` | temp files |
| `012-session-confirmations.sql` | confirmations |
| `013-product-checkpoints.sql` | checkpoints / restore jobs |

---

### R3. HP0 包含已经完成或已经改变的前置项，Reality Snapshot 需要更新

- **严重级别**：`high`
- **类型**：`fact-drift`
- **是否阻塞冻结**：`yes`

#### 事实依据

HP0 in-scope 中写：

1. 解开 `agent-core wrangler.jsonc` 的 `CONTEXT_CORE` binding 注释；
2. 设置 `LANE_E_RPC_FIRST=false`；
3. `forwardInternalJsonShadow` 物理删除；
4. `parity-bridge.ts` dead helpers 删除；
5. runbook archive 删除。

但当前代码事实是：

1. `CONTEXT_CORE` binding 已经在 `workers/agent-core/wrangler.jsonc` 的 root services 与 preview services 中打开；
2. root vars 已有 `LANE_E_RPC_FIRST:false`；
3. `forwardInternalJsonShadow` 方法名仍存在，但方法注释明确 “Shadow semantic is now historical, not behavioral”，所以它不再是“fetch shadow 逻辑”，而是历史命名残留；
4. `parity-bridge.ts` helpers 仍存在，文件注释称其作为 reference implementation deliberate 保留，不是单纯遗漏。

#### 为什么重要

HP0 是后续阶段的入口。如果 HP0 action-plan 按旧事实执行，会出现两类问题：

1. 已完成项被重复执行，浪费 review / 测试成本；
2. deliberate-retained 代码被误删，可能丢掉 R29 postmortem 所需对照材料。

#### 建议修法

把 HP0 拆成两类：

| 类别 | 项目 | 建议 |
|---|---|---|
| 仍需做 | `/start` / `/input` model_id + reasoning 透传 | 保留 HP0 |
| 已完成 | `CONTEXT_CORE` binding 解封 | 改为 “验证 binding 已存在 + 增加 binding-presence test” |
| 需重新判定 | `forwardInternalJsonShadow` 删除 | 若只删方法名残留，需确认所有 call site 可重命名；若保留，HP8 标 historical naming accepted |
| 需谨慎 | `parity-bridge` helper 删除 | 建议等 R29 postmortem 后再删，避免先删除证据工具 |

---

### R4. HP9 文档数量 17/18 自相矛盾

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否阻塞冻结**：`yes`

#### 事实依据

当前 `clients/api-docs/` 现有 11 份：

1. `README.md`
2. `auth.md`
3. `catalog.md`
4. `error-index.md`
5. `me-sessions.md`
6. `permissions.md`
7. `session.md`
8. `session-ws-v1.md`
9. `usage.md`
10. `wechat-auth.md`
11. `worker-health.md`

charter HP9 写：

1. 11 份现有；
2. 新增 `models.md / context.md / checkpoints.md / confirmations.md / todos.md / workspace.md / transport-profiles.md`；
3. 但又说 “6 份新增” 和 “17 份文档”。

11 + 7 = 18，不是 17。

#### 为什么重要

HP9 是文档 freeze gate。如果文档数量都不一致，review 执行时会出现：

1. 少 review 一份；
2. closure 口径不一致；
3. evidence pack 索引与实际文件不匹配；
4. client 团队无法知道 canonical docs 集合。

#### 建议修法

选择一种：

1. **18 份路线**：保留 `transport-profiles.md`，把 HP9 全文改成 18 份；
2. **17 份路线**：不新增 `transport-profiles.md`，把 transport profiles 内容并入 `README.md` 或 `session-ws-v1.md`。

我建议保留 `transport-profiles.md`，因为当前 API 已经有 facade envelope、legacy action payload、WS lightweight frame、binary file content 多种 transport shape，独立文档更清晰。因此 HP9 应改为 **18 份文档**。

---

### R5. manual evidence 是硬闸还是可登记 unresolvable，当前口径冲突

- **严重级别**：`high`
- **类型**：`closure-gate-conflict`
- **是否阻塞冻结**：`yes`

#### 事实依据

charter §10.1 Primary Exit Criteria 写：

1. F1 + F2 manual evidence pack 完整归档是硬闸；
2. 5 套设备必须完整 e2e。

§10.3 NOT-success 又写：

1. F1+F2 manual evidence 任一设备未完成，不得宣称 hero-to-pro 收口。

但 HP9 风险提醒又写：

1. 如果 WeChat 真机仍无法完成，HP10 final closure 登记为 unresolvable。

这两种口径互相冲突。

#### 为什么重要

F1/F2 是 owner-action。若它是硬闸，则 owner 没有设备就不能 close；若它可 unresolvable，则 Primary Exit Criteria 不应写成绝对硬闸。

当前写法会让执行者到 HP9/HP10 才发现：

1. either 永远不能 closure；
2. or 修改 final closure 规则强行 close；
3. or 把 “unresolvable” 包装成 “explicit handoff”，违背 charter。

#### 建议修法

明确选择一种 closure policy：

**方案 A：manual evidence 真硬闸**

- 保留 §10.1 / §10.3；
- 删除 HP9 “HP10 登记为 unresolvable”；
- 写明 owner 未提供设备则 `cannot close`。

**方案 B：manual evidence 可 close-with-known-issues**

- 把 F1/F2 从 Primary Exit 移到 Secondary / Known Issues；
- §10.4 允许 `close-with-known-issues` 覆盖 “manual evidence not provided because owner-action unavailable”；
- 但必须写明业务风险：无法宣称真实设备产品化。

我建议方案 A。因为 hero-to-pro 的目标是“成熟产品基线”，manual evidence 如果继续缺失，本阶段就不应标 close。

---

### R6. F13 “100% delivered:false” 表述过强，应改为“缺真实 round-trip e2e 证明”

- **严重级别**：`medium`
- **类型**：`evidence-overclaim`
- **是否阻塞冻结**：`no`

#### 事实依据

charter 多处写 `pushServerFrameToClient 100% 返 delivered:false`。当前代码中 `NanoSessionDO.pushServerFrameToClient()` 已经通过 `ORCHESTRATOR_CORE.forwardServerFrameToClient()` RPC 返回结果；它在缺 binding、缺 session uuid、缺 user uuid 或 RPC error 时会 returned false，但不能仅从静态代码断言 “100% false”。

当前更坚实的事实是：

1. `test/cross-e2e/` 没有 permission / elicitation / usage push round-trip 四件套；
2. `clients/api-docs/session-ws-v1.md` 也明确 permission/elicitation public WS round-trip not live；
3. `permissions.md` 明确 runtime 不等待 decision/answer；
4. F13 的确没有被 e2e 保护。

#### 建议修法

将 charter 表述改成：

> `pushServerFrameToClient` 已有 RPC 路径，但缺少真实 permission/elicitation/usage round-trip cross-e2e 证明；在 e2e 文件落地前，不得宣称 delivered path closed。

这样既保留 F13 的严肃性，又避免 overclaim。

---

### R7. Tool/Workspace 与 Checkpoint 的 R2/D1 retention schema 不完整

- **严重级别**：`high`
- **类型**：`schema-gap`
- **是否阻塞冻结**：`yes`

#### 事实依据

HP6/HP7 设计了：

1. temp workspace 24h cleanup；
2. artifact promotion provenance；
3. checkpoint TTL；
4. R2 snapshot cleanup；
5. session fork R2 copy；
6. compact summary as artifact；
7. `source: user_upload/agent_generated/workspace_promoted/compact_summary`。

HP1 DDL 中 `nano_session_temp_files` 与现有 `nano_session_files` 不足以完整表达：

1. temp file retention policy；
2. artifact provenance；
3. workspace promotion source path；
4. checkpoint file snapshot source/destination；
5. compact summary artifact；
6. cleanup job state；
7. R2 object copy status。

#### 为什么重要

R2 是最终存储，不是一个可随意覆盖的缓存。若 schema 不表达 lifecycle/provenance：

1. cleanup 可能误删用户需要的 artifact；
2. session fork 可能引用原 session R2 key；
3. restore 无法判断某个 file snapshot 是否物化；
4. audit 无法解释 artifact 来自用户上传还是 agent 生成；
5. multi-tenant 安全审查缺数据基础。

#### 建议修法

HP1 增补：

1. `nano_session_file_provenance` 或给 `nano_session_files` 加 provenance columns；
2. `nano_workspace_cleanup_jobs` 或至少 temp file `expires_at / cleanup_status`；
3. checkpoint file snapshot 表；
4. artifact promotion source columns。

如果不愿增加表，应把 HP6/HP7 的收口标准降级，不要承诺 full provenance / TTL / fork R2 copy。

---

### R8. HP1 “DDL 集中后后续严禁 migration”纪律过硬，缺少变更管理逃生口

- **严重级别**：`medium`
- **类型**：`process-risk`
- **是否阻塞冻结**：`no`

#### 事实依据

charter 规定 HP1 后 HP2-HP10 严禁新增 migration，唯一例外是 HP9 prod baseline 发现 prod 与 migrations 不一致。

这个纪律的动机正确：避免每 phase 各自 migration 导致 prod apply 多次和 schema drift。

但考虑 HP3-HP7 的跨度和复杂度，完全禁止业务 phase 发现 schema 缺陷后补 migration，风险过高。尤其 R1/R7 指出 HP1 当前已经漏 checkpoint/provenance schema。

#### 建议修法

保留 DDL Freeze Gate，但增加受控例外：

1. 后续 phase 发现 schema blocker 时，不允许私自加 migration；
2. 必须先修订 charter + HP1 schema doc；
3. 新 migration 只能作为 `HP1 schema correction`，并在 HP10 final closure 中登记；
4. prod apply 仍由 HP9 baseline 统一验证。

---

### R9. Part 1 / Part 2 phase 编号与 charter 编号已重排，需防止执行者误读

- **严重级别**：`medium`
- **类型**：`docs-risk`
- **是否阻塞冻结**：`no`

#### 事实依据

`closing-thoughts-part-1-by-opus.md` 中的 HP0/HP1/HP2/HP3/HP4 与最终 charter 的 HP0-HP10 编号不完全一致。例如 Part 1 中 HP0 包含 DDL 扩展，而最终 charter 把 DDL 集中放到 HP1；Part 2 中 HP5 是 Tool/Workspace，而最终 charter HP5 是 Confirmation，HP6 才是 Tool/Workspace。

作为前置 study 这是正常演化，但执行者若同时阅读 Part 1/Part 2 与 charter，可能误用旧编号。

#### 建议修法

在 charter §0 或 §13 增加说明：

> `closing-thoughts-part-1/part-2` 是 pre-charter 输入，其 phase 编号已被本 charter 重排；执行时以 `plan-hero-to-pro.md §6-§7` 的 HP0-HP10 编号为唯一准绳。

---

## 5. RH0-RH10 执行后是否能得到预期输出价值

### 5.1 如果按当前 charter 原样执行

我的判断是：**不能稳定保证得到 charter 预期的完整 baseline**。

原因不是阶段主题错，而是当前 charter 存在 schema 和 gate 缺口：

1. HP1 DDL 漏 checkpoint/product restore 表，HP4/HP7 必然卡住；
2. migration 编号与当前仓库不一致，HP1 起步就会有执行偏差；
3. HP9 文档数量不一致，文档 freeze / review 范围会漂移；
4. owner-action 硬闸口径冲突，HP10 close 类型可能被迫临时解释；
5. HP0 中部分前置项过期，会让 action-plan 混入已完成工作。

最终可能得到的是：

> Model/Context/Chat/Tool/Workspace 端点大体存在，但 checkpoint/revert、R2 provenance、manual evidence、文档 freeze、schema audit 仍有“解释空间”的 `close-with-ambiguity`。

这不符合 charter 自己反复强调的 explicit-only / wire-with-delivery / 不允许 silent inherit 纪律。

### 5.2 如果修正本 review 的 blocker

修正后，我认为 HP0-HP10 可以兑现大部分预期价值：

| 目标 | 可兑现性 | 条件 |
|---|---:|---|
| Model state machine | 高 | HP1 补 model schema，HP2 写 requested/effective/fallback audit |
| Context state machine | 中高 | HP3 真接 cross-turn history + compact job；token estimate 允许误差但要 circuit breaker |
| Chat lifecycle | 中高 | HP4 依赖 turn_attempt + message superseded + product checkpoint schema |
| Confirmation control plane | 中 | HP5 必须真接 hook dispatcher + e2e，不能只补 endpoint |
| Tool/Workspace | 中 | HP6 需要 R2 namespace 安全审查 + temp/provenance schema |
| Checkpoint full revert | 中 | HP7 是高风险；必须提前在 HP1 落 schema，否则无法 full close |
| Chronic deferral 清算 | 中高 | HP8-HP10 必须坚持 explicit-only，尤其 F15 R29 |
| clients/api-docs 对齐 | 高 | 先修 HP9 文档数量和 freeze 口径 |
| manual evidence | 不确定 | 强依赖 owner 设备与 prod access；必须在 charter 中硬闸化 |

### 5.3 阶段价值判断

这份 charter 的预期价值是高的。它一旦正确执行，会把 nano-agent 从“能跑 session 的 Cloudflare-native agent substrate”推进到“有产品控制平面的 agent runtime”。尤其以下产物有明显业务价值：

1. `/sessions/{id}/model` + `/models/{id}`：让客户端能做模型选择 UI；
2. `/context/probe` + compact preview/job：让长对话不再靠盲跑；
3. `/checkpoints` + restore/fork：让 agent 工作可回退；
4. `/todos` + `/workspace/files`：让 agent 从聊天走向任务执行；
5. `/confirmations`：让所有高风险动作有统一确认面；
6. 18 份 API docs：让 web / wechat / 后续 SDK 有稳定契约。

但要获得这些价值，必须先修 schema/gate/编号/文档数量这些基线问题。

---

## 6. 建议的 charter 修订清单

### 6.1 必须修订（冻结前）

1. **修正 migration baseline**：当前最新 `006`，HP1 新 migration 从 `007` 或明确外部 `007/008` 状态。
2. **补 HP1 checkpoint schema**：新增 product checkpoint / file snapshot / restore job / fork lineage 相关 D1 表或列。
3. **补 HP1 artifact provenance / temp retention schema**：否则 HP6/HP7 的 R2 lifecycle 无法审计。
4. **更新 HP0 Reality Snapshot**：把 `CONTEXT_CORE binding 解封` 改成 `binding presence verification`；把 `forwardInternalJsonShadow` / `parity-bridge` 删除改成 “R29 postmortem 后判定”。
5. **修正 HP9 文档数量**：建议改成 18 份。
6. **明确 F1/F2 manual evidence closure policy**：建议设为硬闸，owner 未交付则 `cannot close`。
7. **修正 F13 表述**：从 “100% delivered false” 改成 “缺 round-trip e2e 证明，不得宣称 live closed”。
8. **声明 Part 1/Part 2 编号仅为 pre-charter 输入**：最终执行只看 charter HP0-HP10。

### 6.2 建议修订（冻结后也可作为 action-plan gate）

1. HP1 前先写 `docs/design/hero-to-pro/HP1-schema-extension.md`，并让该设计成为 DDL freeze 前置条件。
2. 给 HP3 token estimation 设明确 metric：中文/英文误差、样本长度、触发阈值。
3. 给 HP5 `/confirmations` 定义 backward-compatible redirect 的 exact response shape，避免旧 permission/elicitation 路径语义漂移。
4. 给 HP6 R2 namespace 做独立 security review gate。
5. 给 HP7 restore/fork 定义 failure recovery：D1 已标 superseded 但 R2 restore 失败时如何回滚。
6. HP8 行数 gate 建议先 record baseline，再阻止增长；不要把“必须降到阈值以下”与“stop-the-bleed”混写。

---

## 7. 最终审查意见

`plan-hero-to-pro.md` 是一份高价值 draft。它把上一阶段最重要的问题抽象成了正确的产品状态机，并且在方法论上比 real-to-hero 更成熟：它知道要防止 wire-without-delivery、deceptive closure、silent inherit、DDL scatter 和文档 drift。

但它现在还不是可冻结的基线纲领。最需要立即修的是 **HP1 schema 完整性** 与 **当前仓库事实校准**。如果不修，HP4/HP7 的 checkpoint/revert、HP6/HP7 的 R2 provenance、HP9 的文档 freeze、HP10 的 closure gate 都会在执行时产生解释空间。

**结论等级**：`changes-requested`  
**建议下一步**：先修订 charter，再为 HP1 schema 写独立 design doc；不要直接进入 HP0 action-plan 执行。  
**收口判断**：修订后可以作为 hero-to-pro 阶段基石；当前版本只能作为高质量草案。

---

## 8. 二次审查（2026-04-30，针对 `plan-hero-to-pro.md v0.draft-r1`）

> 审查人: `GPT-5.4`
> 结论状态: `changes-requested (narrow-scope)`

### 8.1 二次审查结论

本轮修订是**实质性改进**，不是表面改字。上一轮最关键的结构性 blocker 已经大面积关闭，尤其是：

1. HP1 已补齐 checkpoint / restore / provenance / cleanup lineage 所需 schema；
2. migration 编号已从 `007-013` 对齐当前仓库真实基线；
3. manual evidence 已统一为硬闸，不再允许用 `unresolvable` 模糊收口；
4. F13 已从“100% delivered:false”改成“缺真实 round-trip e2e 证明”；
5. pre-charter phase 编号与本 charter 编号的关系已经明确写出；
6. DDL Freeze 已加入受控例外，执行弹性比上一版健康。

因此，上一轮的 **R1 / R2 / R5 / R6 / R7 / R8 / R9**，我判断都已经**实质关闭**。

但当前版本仍然不能直接升格为 `approved`，原因不再是 schema 或 closure policy 还缺骨架，而是 charter 内部仍有两类**全局一致性残留**。它们已经从“架构 blocker”降级成“冻结前必须 scrub 的文档 blocker”，范围明显变小，但仍然会影响 action-plan 编写与 phase closure 口径。

### 8.2 已实质修复项确认

#### A1. HP1 schema 闭环已补上

上一轮最严重的问题是：HP1 没有覆盖 HP4 / HP7 所需的 product checkpoint / file snapshot / restore job / retention lineage schema。

这次修订后，charter 已明确加入：

1. `nano_session_checkpoints`
2. `nano_checkpoint_file_snapshots`
3. `nano_checkpoint_restore_jobs`
4. `nano_workspace_cleanup_jobs`
5. `nano_session_temp_files.expires_at / cleanup_status`
6. `nano_session_files` provenance columns

对应位置见 `docs/charter/plan-hero-to-pro.md:422-505`。这一点足以说明 **R1 + R7 已经实质关闭**。

#### A2. migration 基线编号已校准

charter 现在已把 HP1 migration 统一改成 `007-013`，并明确 prior `001-006` 保持不变，见 `docs/charter/plan-hero-to-pro.md:466-487`。这解决了上一轮 `008/009-016` 与当前仓库真实状态不一致的问题，说明 **R2 已关闭**。

#### A3. manual evidence 硬闸口径已统一

HP9 风险提醒、§10.1 Primary Exit、§10.3 NOT-success 现在已经收敛到同一结论：

1. F1 + F2 是硬闸；
2. owner 若无法提供 5 套设备 evidence，本阶段应标 `cannot close`；
3. 不再允许把 F1/F2 登记成 `unresolvable` 然后继续宣称阶段收口。

对应位置见 `docs/charter/plan-hero-to-pro.md:942-943,1102-1143`。因此 **R5 已关闭**。

#### A4. F13 的事实表述已回到可证据化口径

当前 charter 已改成“已有 RPC 路径，但缺 permission / elicitation / usage 的真实 round-trip cross-e2e 证明”，而不再做“100% delivered:false”的过度断言，见 `docs/charter/plan-hero-to-pro.md:169,1070-1071,1089-1090`。因此 **R6 已关闭**。

#### A5. pre-charter 编号歧义已被消除

文档已经明确声明 `closing-thoughts-part-1/part-2` 只是 pre-charter 输入，执行时只以本 charter 的 HP0-HP10 为准，见 `docs/charter/plan-hero-to-pro.md:86-92`。因此 **R9 已关闭**。

### 8.3 剩余问题（冻结前仍需修）

#### B1. “18 份文档”修正仍未全局同步，17/18 混用还在继续

- **严重级别**：`medium`
- **类型**：`global-doc-drift`
- **是否阻塞冻结**：`yes`

这次修订虽然已经在 HP9 主体处明确写出 **11 + 7 = 18 份**，但全文件并没有同步清干净，仍然存在多处 17/18 混用：

1. `§4.1 I10` 仍写 “17 份文档对齐” (`plan-hero-to-pro.md:228`)
2. `§4.4 硬纪律` 仍写 “HP9 一次性集中更新 17 份” (`:273`)
3. `§5 方法论` 仍写 “17 份文档不每 phase 同步” (`:293`)
4. `§6.1 Phase 总表` 仍写 “17 份文档对齐” (`:324`)
5. `§6.2 Phase 职责矩阵` 左列已经是 18 份，但交付输出仍写 “17 份 doc” (`:340`)
6. `§7.10 HP9 收口标准` 仍写 “17 份文档全部对齐” (`:929`)
7. `§14 最终 Verdict / 业务价值` 仍写 “17 份客户端文档对齐” (`:1300,1312`)

这说明 R4 并没有完全关闭，只是从“核心设计错误”降级成了“全局文案同步未完成”。但它仍然阻塞冻结，因为 HP9 的 docs freeze / review scope / closure 口径都依赖这个数字，不能出现两套真相。

#### B2. HP0 / HP10 的摘要层仍保留旧事实，且与详细段落出现执行顺序冲突

- **严重级别**：`medium`
- **类型**：`summary-truth-drift`
- **是否阻塞冻结**：`yes`

这次修订已经在 HP0 详细段落里正确区分了：

1. `CONTEXT_CORE` binding 已存在，HP0 只需 verify + test；
2. `LANE_E_RPC_FIRST=false` 已存在；
3. `forwardInternalJsonShadow` / `parity-bridge` 不应在 HP0 直接删，而要等 R29 postmortem 后在 HP10 cleanup 决议。

这些详细口径是对的，见 `plan-hero-to-pro.md:363-412`。

但摘要层和后续章节仍保留旧说法：

1. `§4.1 I1` 仍写 “CONTEXT_CORE binding 解封 / dead 删除” (`:219`)
2. `§6.1 Phase 总表` 仍写 “CONTEXT_CORE binding 解封、dead code 物理删除” (`:315`)
3. `§6.2 Phase 职责矩阵` 仍写 “HP0 = Lane E binding 占位 + dead code 物理删除” (`:331`)
4. `§7.11 HP10` 又写 “HP8 已物理删除 forwardInternalJsonShadow / parity-bridge dead helpers(若 HP0 漏掉)” (`:956-958`)

这里至少有两层冲突：

1. **摘要表 vs 详细 HP0**：summary 还在复述旧版“先删 dead code / 解封 binding”，会误导 action-plan 编写者；
2. **HP0 详细段 vs HP10 cleanup**：HP0 说这两个 helper 要等 HP8-B R29 postmortem 后再判定、HP10 cleanup 决议；但 HP10 又写成 “HP8 已物理删除”，导致执行顺序含糊。

这不再是上一轮那种“架构判断错误”，但仍然会影响执行者到底该在 HP0、HP8 还是 HP10 处理 dead code，因此我判断 **R3 只算部分关闭，尚未完全关闭**。

### 8.4 二次 verdict

和上一轮相比，这份 charter 已经从“存在多个结构性 blocker 的高质量草案”，前进到了“主体成立、接近可冻结，但还差最后一轮全局文本对齐”的状态。

我的更新判断是：

1. **可以认可其阶段框架与主执行顺序**；
2. **可以认可 HP1 schema、manual evidence gate、DDL Freeze、pre-charter 编号说明这些关键修订已经到位**；
3. **暂时仍不建议直接标 `approved`**，因为 17/18 文档数量与 HP0/HP10 摘要口径未全局同步，会直接污染 action-plan 和 closure 模板；
4. **一旦 Opus 再完成这两类全文 scrub，我会倾向把这份 charter 升级为可冻结基线。**

**二次结论等级**：`changes-requested (narrow-scope)`  
**二次收口判断**：大部分 blocker 已清除；当前只剩全局一致性问题。修完后，这份 `plan-hero-to-pro.md` 可以进入冻结。

---

## 9. 三次复核（2026-04-30，freeze-ready 校准）

在本次直接修订 `docs/charter/plan-hero-to-pro.md` 后，我重新核对了上一轮剩余的两个 freeze blocker：

1. **17/18 文档数量混用** 已完成全文对齐；当前仅保留对“v0.draft 曾误计 17 份”的历史说明，不再作为当前执行口径存在。
2. **HP0 / HP10 摘要 truth drift** 已完成对齐；摘要表、职责矩阵、Gate 说明、HP10 cleanup 标准现在都与详细段落一致，不再要求在 HP0 提前删除 R29-dependent residue，也不再把 manual evidence 硬闸写成可 handoff。

据此，我判断此前二次审查中的 **B1 / B2 已关闭**。

**三次结论等级**：`approved-for-freeze`  
**三次收口判断**：`plan-hero-to-pro.md` 现在可以作为 hero-to-pro 阶段基线文件冻结。
