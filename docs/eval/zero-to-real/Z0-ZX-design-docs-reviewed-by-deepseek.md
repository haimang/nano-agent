# Nano-Agent 代码审查模板

> 审查对象: `zero-to-real / Z0-ZX 全套设计文档（9 份）`
> 审查时间: `2026-04-25`
> 审查人: `DeepSeek v4 (deepseek-v4-pro)`
> 审查范围:
> - `docs/charter/plan-zero-to-real.md`（基石文件）
> - `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md`（前序分析）
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
> - `workers/{orchestrator-core,agent-core,bash-core,context-core,filesystem-core}/**`
> - `packages/{nacp-core,nacp-session}/**`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`设计文档作为 governance layer 成立，但作为 Z1-Z4 的实施指南存在 14 处需要填补的盲点、断点与模糊空间。当前所有的 Q1-Q10 均未获得 owner 回答，这是最大的 delivery risk。在 QnA 回填完成之前，任何一份 action-plan 都缺乏执行确定性。`
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. **ZX-qna.md 的 10 个问题无一获得 owner 回答**——这是阻断 Z1-Z4 推进的根风险，因为 Q1（auth transport）、Q5（activity log schema）、Q6（DO SQLite 最小集合）、Q7（首条 RPC 方法）、Q9（quota 覆盖范围）等直接影响实现面。不拍板，action-plan 无法定稿。
  2. **设计文档对"当前代码真实起点"的认知存在 4 处偏差**——(a) 假定 DO SQLite 是需要新增的能力，但当前全仓零 DO SQLite 使用；(b) 假定 WebSocket 仍是单向并需要双向化，但代码已实现双向 WS + replay + heartbeat；(c) 假定 context-core / filesystem-core 是独立 service binding 的 internal worker，但实际它们是 library shell，逻辑通过 package 消费；(d) 缺乏对现有 `auth.ts` 嵌入式鉴权的迁移讨论。
  3. **D1 是"零基础起步"而非"只缺 conversation 表"**——当前 5 个 worker 无一绑定 D1，wrangler 中无任何 D1 binding。设计文档将 D1 视为"补表"，但实际面临的是从零建立 D1 binding、迁移、读写纪律的基础工程。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-zero-to-real.md`（审查基线）
  - `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md`（前序约束）
- **核查实现**：
  - `workers/orchestrator-core/src/{index.ts,auth.ts,user-do.ts,module.ts}`
  - `workers/agent-core/src/{index.ts,host/**.ts,kernel/runner.ts,llm/**.ts}`
  - `workers/bash-core/src/{index.ts,executor.ts}`
  - `workers/context-core/src/{index.ts,context-assembler.ts,snapshot.ts}`
  - `workers/filesystem-core/src/{index.ts,storage/adapters/**.ts}`
  - `packages/nacp-core/src/{transport/**,evidence/**,hooks.ts,tenancy.ts}`
  - `packages/nacp-session/src/{ingress.ts,session-websocket.ts,events/**.ts}`
  - 各 worker 的 `wrangler.jsonc`（binding 与 route 事实）
- **执行过的验证**：
  - `grep` 扫描所有 worker wrangler 中的 `d1_databases`、`durable_objects`、`services` binding
  - `grep` 扫描是否存在 `orchestrator-auth` 目录
  - `grep` 扫描全仓 `DO SQLite` / `state.storage.sql` 使用
  - `grep` 扫描 WebSocket 双向实现（`addEventListener('message'`）
  - 对照设计文档中引用的代码文件与实际文件存在性
  - 交叉引用所有 Q1-Q10 在各设计文档中的引用一致性

### 1.1 已确认的正面事实

- `Z0-Z4` 与 `ZX-*` 设计文档形成了 **charter → design → QnA → action-plan 的四层治理结构**，层次耦合方向清晰（Z0 冻结边界、Z1-Z4 分别聚焦阶段目标、ZX 承载 cross-cutting 决策）。
- **In-Scope / Out-of-Scope** 在各文档间一致：完整 admin plane、cold archive、full RPC retirement 在所有文档（charter §4.2 → Z0 §3.1 → Z1 §5.2 → Z2 §5.2 → Z3 §5.2 → Z4 §5.2 → ZX-* §5.2）保持统一排除口径。
- **NACP realization** 主线贯穿所有设计文件：Z1 讨论 authority translation，Z2 讨论 session profile 使用面，Z3 讨论 evidence linkage，ZX-nacp 作为总纲。与 charter §5.1 "NACP-First-Execution" 一致。
- **Binding boundary 纪律**在 charter §1.7、ZX-binding §5.1、各 Z phase §5.1 保持一致收敛口径。
- **QnA 集中化**已经执行：所有 open questions 统一路由到 `ZX-qna.md`，各设计文档只引用 Q 编号而不各自回答问题。
- `workers/orchestrator-core/src/auth.ts` 已有 JWT + `trace_uuid` + tenant mismatch rejection。
- `workers/agent-core/src/host/internal-policy.ts` 已有 double-layer gate（secret + authority + no-escalation）。
- `packages/nacp-core` / `packages/nacp-session` 已具备设计文档要求的协议 truth。
- `workers/agent-core/src/kernel/runner.ts` 已有真实 kernel loop。
- `workers/bash-core/src/executor.ts` 已有 `beforeCapabilityExecute` 配额 seam。
- `workers/agent-core/src/llm/adapters/openai-chat.ts` 已有完整的 OpenAI adapter（322 行）。

### 1.2 已确认的负面事实

- **`workers/orchestrator-auth/` 目录不存在**，任何 git 历史中均未出现。当前 auth 能力嵌入在 `orchestrator-core/src/auth.ts` 中。
- **全仓 5 个 worker 的 wrangler.jsonc 中，无任何 `[[d1_databases]]` binding**。D1 处于零使用状态。
- **全仓零 DO SQLite（`state.storage.sql`）使用**。DO storage 全部使用 key-value API（`state.storage.get/put/delete`）。
- **`workers/context-core/` 和 `workers/filesystem-core/` 是 library worker shell**（入口各 32 行，仅 `/health`），无内部 HTTP route，无 DO class，逻辑通过 `@haimang/context-core-worker` / `@haimang/filesystem-core-worker` package 被 `agent-core` 消费为库。
- **ZX-qna.md 的 10 个问题（Q1–Q10）"业主回答"字段全部为空**。
- `workers/agent-core/wrangler.jsonc` 中 `CONTEXT_CORE` / `FILESYSTEM_CORE` service binding 已被注释。
- 不存在 `workers/agent-core/src/llm/adapters/workers-ai.ts`（Workers AI adapter）。
- 不存在内置 fake provider worker（仅 `FAKE_PROVIDER_WORKER` 外部 binding seam）。
- 不存在 Mini Program 或 web thin client 代码（client 端不在本 repo 内）。
- `workers/agent-core/src/llm/gateway.ts` 是 15 行 stub。

---

## 2. 审查发现

### R1. `ZX-qna.md` 的 10 个问题全部无业主回答——Z1-Z4 实现失去执行锚点

- **严重级别**：`critical`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/design/zero-to-real/ZX-qna.md:31-166` — 所有 `"业主回答"` 字段均为空。
  - `docs/design/zero-to-real/Z0-contract-and-compliance-freeze.md:321` — Z0 自身将 `"决策确认"` 列为下一步行动首项。
  - `docs/charter/plan-zero-to-real.md:63-67` — charter 明确将 QnA 定位为 "design 阶段的配套工件"。
- **为什么重要**：
  - Q1（auth transport form）直接决定 `orchestrator.auth` 的 bringup 路线——RPC or fetch shim。
  - Q5（activity log schema 单表 vs 拆表）直接决定 Z2 的 D1 migration 内容。
  - Q6（DO SQLite hot-state 最低集合粒度）直接决定 Z2 的 stateful uplift scope。
  - Q7（首条 dual-implemented 方法）直接决定 Z2 的 RPC kickoff 证明标准。
  - Q9（quota deny 覆盖 llm 还是仅 tool）直接决定 Z3 的 gate 实现面。
  - 这 5 个 Q 若不被回答，Z1–Z3 的 action-plan 无法定稿，因为每个 Q 都对应一个"两条可实现路线中选一条"的分叉。
- **审查判断**：
  - Z0 设计文档自已将 `"Owner 在 ZX-qna.md 回填 Q1-Q10"` 列为下一步行动首项（`Z0-contract-and-compliance-freeze.md:321`），但当前所有回答为空。这不是设计文档质量的缺失，而是设计阶段流程本身未闭合。
- **建议修法**：
  - Owner 必须在 action-plan 起草之前，对 Q1–Q10 全部回填回答。
  - 如 Q4/Q8 实际可降为条件判定（"本阶段不做"），也应显式填入该结论而非留空。

---

### R2. 设计文档对"DO SQLite"的假定与代码事实存在重大偏差

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - 全仓 `grep state.storage.sql` 无任何匹配。
  - `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md:18-19` — "DO SQLite / Alarm / conversation 聚合最低集合进入 `orchestration.core`"。
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md:99` — 将"直接把 DO SQLite 当 SSOT"列为砍项，暗示 DO SQLite 是可选替代品。
  - `docs/design/zero-to-real/ZX-qna.md:94-106` — Q6 讨论 DO SQLite 热态集合粒度。
- **为什么重要**：
  - 设计文档将 DO SQLite 视为"需要新增、需要设计"的能力，但当前全仓 **从未使用过** DO SQLite。差距不是"补表"而是"从零建立一套持久化范式"。
  - Z2 的"stateful uplift 最低集合"如果假定 DO SQLite 只需 2-3 张表，实际工作量会被低估。DO SQLite 需要：migration 范式、query helper 封装、与现有 key-value storage 的共存策略、以及从 key-value 到 SQL 的迁移路径。
  - 当前 `NanoOrchestratorUserDO` 使用 `state.storage.get/put/delete`（key-value），`NanoSessionDO` 也使用相同模式。Z2 引入 DO SQLite 需要决定：是双写迁移还是一次切换、只给 user DO 加还是 session DO 也加。
- **审查判断**：
  - 这不是设计文档的"方向性错误"（DO SQLite 作为 hot-state 本身是正确的），而是"实现复杂度被低估"的问题。设计文档的"DO SQLite / Alarm"语气像补一个已有 pattern，但实际是首次引入。
- **建议修法**：
  - 在 Z2 设计文档中追加一节 `DO SQLite Bringup Baseline`，明确：(a) 只给 `NanoOrchestratorUserDO` 还是也覆盖 `NanoSessionDO`；(b) 与现有 key-value storage 的共存策略；(c) migration 触发点（constructor `blockConcurrencyWhile` 还是首次 fetch）；(d) 4 组热态的最小 schema。
  - 将 Q6 的回答作为该节的直接输入。

---

### R3. 设计文档对 WebSocket 双向能力的假定与实际代码不一致

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:502-548` — `handleWsAttach()` 已使用 `WebSocketPair` + server `addEventListener('message')` 实现双向 WS。
  - `workers/agent-core/src/nano-session-do.ts:1259-1286` — 完整的 `attachHelperToSocket()` 双向 WS 实现，含 replay buffer、ack window、heartbeat。
  - `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md:187` — 将 "bidirectional WS message handling" 标记为 "partially in-scope" 并表示 "Z4 承接终态，Z2 只需不阻断后续"。
  - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md:186` — 将 "双向 WS message handling" 列为 in-scope（Z4 收尾）。
  - `docs/design/zero-to-real/ZX-qna.md:154-166` — Q10 讨论 "是否接受 HTTP start/input + WS stream/history 作为 first-wave"，暗示双向 WS 是待建能力。
- **为什么重要**：
  - 设计文档将"双向 WS"当作需要从单向升级的能力来规划，但当前代码已经是双向的。这导致 Z2/Z4 的设计估计中，双向 WS 被当作 Z4 的延迟工作，但其实现已经存在。
  - 如果现有双向 WS 实现在真实客户端压力下有 gap（如 Mini Program 兼容性），那这些 gap 应被显式列为 Z4 的修复项，而不是当作"新建"。
- **审查判断**：
  - 设计文档与代码真相在此处存在偏差。这不会破坏 Z2 的 closure（因为 Z2 只需"不阻断后续"），但会影响 Z4 的 scope 准确性——Z4 的"双向 WS message handling"应该重新定义为"双向 WS 在 Mini Program 环境下的 hardening"，而不是"从单向升双向"。
- **建议修法**：
  - 在 Z4 设计文档中将 F4（Delayed Stateful Work）从 "bidirectional WS / IntentDispatcher / Broadcaster" 修正为 "Mini Program WS compatibility hardening / IntentDispatcher / Broadcaster"。
  - 在 ZX-qna Q10 的 "当前建议" 中补充一句对现有实现状态的引用。

---

### R4. 设计文档的 6-worker 拓扑与 `context-core`/`filesystem-core` 的 library-shell 实际状态存在偏差

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `workers/context-core/src/index.ts:1-32` — 入口仅含 `/health`，无 DO class，无 internal route。
  - `workers/filesystem-core/src/index.ts:1-32` — 相同状态。
  - `workers/agent-core/wrangler.jsonc` — `CONTEXT_CORE` / `FILESYSTEM_CORE` service binding 被注释。
  - `workers/agent-core/package.json` — 依赖 `@haimang/context-core-worker` 和 `@haimang/filesystem-core-worker`。
  - `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md:248` — "`bash/context/filesystem` 只由 `agent.core` 消费" 被作为 binding allowlist 规则。
  - `docs/charter/plan-zero-to-real.md:343-345` — "`agent.core` 承担 runtime mesh 对 bash/context/filesystem 的内部调用"。
- **为什么重要**：
  - 设计文档将 context-core / filesystem-core 描述为通过 service binding 被 agent-core 调用的独立 worker，但实际它们是 library package——agent-core 通过 npm workspace 依赖直接 import 其代码，而非通过网络调用。
  - 这影响了 Z3 的 "runtime mesh 收紧" 判断：如果 context/filesystem 不走网络调用，就不存在 "internal HTTP seam" 需要压缩，也就不在 Z3/Z4 的 transport inventory 范围内。
  - 但也意味着：**(a) context/filesystem-core 的 worker 部署是否仍然需要？(b) 如果不需要，binding matrix 中的这两行是否可以移除？(c) 如果未来需要独立的 context/filesystem service，其启用条件是什么？**——设计文档对此完全沉默。
- **审查判断**：
  - 设计文档对拓扑的描述是"应然"（应该 6 worker 独立互通），但代码是"实然"（2 个 library shell + 3 个活跃 worker）。在 zero-to-real 阶段，按实然推进更为合理。设计文档应在 ZX-binding 中区分 "当前过渡形态" 与 "终态拓扑"。
- **建议修法**：
  - 在 `ZX-binding-boundary-and-rpc-rollout.md` 中追加一节 "Current vs Terminal Topology"，明确 context-core / filesystem-core 当前以 library 形态融入 agent-core，其 service binding 启用条件与时机作为 backlog 项。
  - 在 Z3 的 "runtime mesh 收紧" 项中，移除对 context/filesystem 的 internal HTTP 压缩要求（因为它们不存在 HTTP seam）。

---

### R5. D1 引入是"零基础起步工程"，不是"在已有 D1 基础上补表"

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - 全仓 `grep d1_databases` 在所有 wrangler.jsonc 中无匹配。
  - 全仓 `grep D1Database` 仅在 `workers/filesystem-core/src/storage/adapters/d1-adapter.ts` 有类型定义（但该 adapter 未被任何 worker 的 wrangler binding 激活）。
  - 除 filesystem-core 的 unused adapter 外，全仓无任何 `env.DB.prepare()` / `env.DB.batch()` 等 D1 运行时调用。
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md:172-177` — 列出 12-14 张表。
- **为什么重要**：
  - 设计文档最多的时候呈现的语气是"把 conversation/session/turn/message 这些表补上"，但实际上需要：(a) 在所有 4 个 bind worker 的 wrangler 中添加 `[[d1_databases]]`；(b) 决定 migration 触发机制；(c) 建立 query helper 封装；(d) 处理 D1 的 latency / cold start 特性；(e) 建立跨 worker 的读/写纪律。
  - 如果 Z1 开始写 identity 表、Z2 开始写 conversation 表、Z3 开始写 usage 表，三个阶段的 migration 顺序、表依赖、以及"谁先执行 migration"都需要提前冻结。当前 `ZX-d1-schema-and-migrations.md` 只讨论了表清单与 write ownership，但没有提出 migration sequencing 的具体方案。
- **审查判断**：
  - ZX-d1 文档作为 schema 冻结是合格的，但缺少 "D1 bringup baseline"——即"从零到有 D1"的工程基座设计。这不是要求 Z0 就写完所有 migration SQL，而是要求在 design 阶段冻结 migration strategy、trigger worker、以及 cross-worker binding 的 rollout 顺序。
- **建议修法**：
  - 在 `ZX-d1-schema-and-migrations.md` 中补充一节 "D1 Bringup Baseline"，明确：(a) `nano-agent-db` 的 wrangler 创建流程（手动 or wrangler.toml/JSONC 配置）；(b) migration 由哪个 worker 触发（建议 `orchestrator.auth` 或独立 migrator worker）；(c) Z1 identity → Z2 conversation → Z3 quota 的 migration 追加顺序；(d) 每个 bind D1 的 worker 的 query helper 封装范式。

---

### R6. `orchestrator.auth` 的设计缺少对当前嵌入式 auth 的迁移讨论

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `workers/orchestrator-core/src/auth.ts:1-165` — 完整的 `verifyJwt()` / `createJwt()` / `hashSecret()` 实现。
  - `workers/orchestrator-core/src/index.ts` — `fetch()` 入口调用 `requireAuthFromRequest()` 验证 JWT。
  - `workers/orchestrator-core/src/user-do.ts` — `handleStart()` 等接收 `AuthSnapshot`。
  - `docs/design/zero-to-real/Z1-full-auth-and-tenant-foundation.md` — 全文讨论 "新建 `orchestrator.auth`"，但从未讨论"如何从现有 `orchestrator-core/src/auth.ts` 迁移到独立 auth worker"。
  - `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md:171-173` — §2.1 明确写出 "JWT claim schema 沿用 orchestrator.core 当前格式 {sub, tenant_uuid, ...}"。
- **为什么重要**：
  - Z1 不是 greenfield 开发——`orchestrator-core` 已经有完整的 JWT mint/verify 逻辑。迁移意味着：(a) 从 `orchestrator-core` 中移除 `auth.ts` 的 JWT mint 能力（只保留 verify）；(b) 在 `orchestrator.auth` 中重建 register/login/JWT mint；(c) 确保两个 worker 的 JWT claim format 一致；(d) 处理 migration 期间的过渡期（新旧两套共存？直接切换？）。
  - 如果不讨论迁移路径，Z1 实现者可能：(a) 把 `orchestrator.auth` 写成全新的，然后发现 `orchestrator-core` 的 JWT format 不一致；(b) 忘掉从 `orchestrator-core` 移除 mint 逻辑，导致出现两个 token 签发者。
- **审查判断**：
  - 这是设计文档最明显的"断点"——Z1 设计文件讨论的是一个"即将新建"的 auth worker，却没有审查"当前 auth 在哪里、怎么撤"。这种遗漏会导致 Z1 实现时的 integration risk。
- **建议修法**：
  - 在 Z1 设计文档中追加一节 "Migration from Embedded Auth"，明确：(a) 当前 `orchestrator-core/src/auth.ts` 中哪些逻辑保留（verify only）、哪些迁移到 `orchestrator.auth`（mint/register/login）；(b) JWT claim format 保持 {sub, tenant_uuid, membership_level, ...} 不变；(c) 过渡期间是否接受双签发源。

---

### R7. Mini Program 与 web client 代码不在本 repo，设计文档缺乏 client-side API contract 的定义

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - 全仓 `grep -r "Mini Program"` 仅在设计文档中找到，无任何 `.ts/.js/.wxml` 实现。
  - 全仓无 `/client` 或 `/web` 目录。
  - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md:169-172` — Z4 in-scope 包括 "web thin client 完整 hardening" 和 "Mini Program 接入"。
  - `docs/charter/plan-zero-to-real.md:146-149` — "web thin client 是更早的稳定验证面"。
- **为什么重要**：
  - Z4 要求 "web + Mini Program 都跑通 first real run"，但设计文档没有定义：(a) web thin client 当前在哪里（另一 repo？）；(b) client-to-server API contract（包括 `/auth/*`, `/sessions/*`, `/users/me/*`, `/ws` 的精确 request/response shape）；(c) Mini Program 的 transport 最低要求（wx.request vs WebSocket，见 Q10）。
  - 如果 API contract 没有至少 skeleton-level 的定义，Z4 的 "real client full-chain proof" 无法被定量验收——什么算"跑通了"？
- **审查判断**：
  - 当前设计文档在 client 侧的产出几乎是空白。虽然 Z1-Z3 聚焦 backend，但 backend 只能通过 client 的 API contract 来定义自己的 surface。Z1 定义的 `/auth/*` route 面、Z2 定义的 `conversation list/history` read model、Z3 定义的 stream output format，都需要 client contract 作为共同参照。
- **建议修法**：
  - 在 Z4 设计文档（或新增一份 `ZX-client-api-contract.md`）中定义：(a) public API endpoint 清单与 request/response skeleton（至少 method + path + status codes + 主字段）；(b) WebSocket message type catalog（client→server 与 server→client 的 message type 名录）；(c) Mini Program transport fallback 策略（无 WS 时是否只走 HTTP polling）。

---

### R8. Provider adapter 设计缺乏对现有 OpenAI adapter 的重用讨论

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `workers/agent-core/src/llm/adapters/openai-chat.ts` — 322 行完整实现。
  - `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md:231-247` — 讨论 Workers AI Baseline，但未引用现有 OpenAI adapter。
  - `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md:556-566` — 明确说明 DeepSeek adapter "大量 reuse openai-chat.ts 基础"（~80 LOC），Workers AI adapter 预计 ~250 LOC。
- **为什么重要**：
  - 现有 OpenAI adapter 支持 SSE streaming、tool call 解析、non-stream response——这些能力 Workers AI adapter 很可能可以复用。如果设计文档不指引适配器共享的抽象层，实现者可能把 Workers AI adapter 写成完全独立的代码路径，导致 LLM adapter 接口层分裂。
  - ZX-llm 文档的 F2（Adapter Boundary）讨论了 "provider 输出统一经 runtime/session 映射"，但这是 adapter 的下游接口——adapter 的上游接口（与 `LlmAdapter` / `LLMExecutor` 的对接）没有被讨论。
- **审查判断**：
  - ZX-llm 文档作为 "provider 边界设计文档" 是合格的，但缺少对当前已存在 LLM 架构（`ProviderRegistry → LLMExecutor → adapter`）的引用和重用指引。
- **建议修法**：
  - 在 ZX-llm 文档中追加一节 "Reuse from Existing LLM Stack"，引用 `openai-chat.ts` 的已有抽象，指示 Workers AI adapter 应复用相同的 `LlmAdapter` 接口、`LLMExecutor` retry/stream 管道，以及 `ProviderRegistry` 注册点。

---

### R9. Quota gate 的"allow/deny"语义缺乏与现有 `beforeCapabilityExecute` seam 的对齐说明

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/bash-core/src/executor.ts` — `beforeCapabilityExecute()` 作为 `ExecutorOptions` 的回调。
  - `docs/design/zero-to-real/Z3-real-runtime-and-quota.md:185-187` — 将 "`beforeCapabilityExecute()` 只拦 tool" 判定为 out-of-scope，要求 Z3 "更强的 runtime truth"。
  - `docs/design/zero-to-real/ZX-qna.md:140-152` — Q9 讨论 "是否覆盖 llm/tool 两类实际消耗路径"。
- **为什么重要**：
  - 现有 quota seam 在 bash-core 的工具执行路径上。Z3 要求将 gate 扩展到 LLM invoke 路径（Q9 倾向 yes）。但设计文档没有讨论：(a) 两者走同一 gate 接口还是各自的 hook；(b) gate 的决策逻辑（查 D1 `nano_quota_balances`？查 `nano_usage_events` 最近 N 次用量？）；(c) gate 的 decision payload 格式（`{allow, reason, remaining}` 或其他）。
  - 如果 Q9 拍板为 "覆盖 llm + tool"，Z3 需要把 gate 同时接入 `agent-core/kernel/runner.ts`（LLM call 之前）和 `bash-core/executor.ts`（capability 执行之前）。这两个接入点的调用上下文完全不同，需要统一的 gate 抽象。
- **审查判断**：
  - Z3 设计文档的 F2（Runtime Quota Gate）描述是正确的方向，但对 gate 的运行时形状缺乏定义。这会在 action-plan 阶段导致歧义。
- **建议修法**：
  - 在 Z3 设计文档 F2 的阐述中追加 gate interface skeleton（至少 `beforeSideEffect(ctx: {team_uuid, session_uuid, kind: 'llm'|'tool', estimated_cost?}) => {allow, reason?, remaining?}`）。
  - 待 Q9 回答后，明确 Z3 的 gate 接入点清单。

---

### R10. Z0 的"charter-freeze vs design-handoff"二分法在 Charter 中有执行，但在 Z0 设计文档中未做成可逐项核对的 checklist

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/charter/plan-zero-to-real.md:391-397` — 列出 Z0-design-handoff 的 5 项内容（JWT claim schema → ZX-binding/Z1；D1 first-wave → ZX-d1；session profile → ZX-binding/Z2；quota contract → ZX-d1/Z3；provider → ZX-llm）。
  - `docs/design/zero-to-real/Z0-contract-and-compliance-freeze.md:173-178` — 冻结了 Z1-Z4 的 global scope 与方法论。
  - 但 Z0 设计文档的 §7（In-Scope 功能详细列表）只列出 4 个 F（Phase Boundary / Compliance / Design Plan / QnA Routing），没有 charter 中列出的那 5 项 design-handoff 追踪。
- **为什么重要**：
  - Z0 自称 "冻结 zero-to-real 的执行 baseline"，但如果 downstream 设计文档有没有承接 charter 的 handoff 项，Z0 无法自己发现（因为它没有追踪矩阵）。
- **审查判断**：
  - 这是治理层的微量遗漏。不阻塞 Z1-Z4，但会增加后续 reviewer 的对照成本。
- **建议修法**：
  - 在 Z0 设计文档中追加一个 "Design-Handoff Tracking" 表，逐项映射 charter §7.1 design-handoff 的 5 项 → 承接设计文档 → 当前承接状态（drafted / pending / deferred）。

---

### R11. 缺少一个 `ZX-current-code-baseline.md` 类型的文档来锚定设计文档的起点认知

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - 已在上面的 R2/R3/R4/R6/R8 中详细记录了设计文档对代码起点的认知偏差。
- **为什么重要**：
  - 当前设计文档引用代码位置最多的方式是 §8 "需要避开的反例"，但这是否定性引用（"不要继续这样"），而非肯定性引用（"这是当前的起点"）。没有一份文档集中记录：当前仓库已经有什么（auth.ts, bidirectional WS, kernel loop, LLM executor...）和还缺什么。这导致设计文档的起跑线假设分散且部分不准确。
- **审查判断**：
  - 这是一个锦上添花的改进项——不影响设计质量，但会降低后续 action-plan 的返工概率。
- **建议修法**：
  - 可选：新增一份 `docs/design/zero-to-real/ZX-current-code-baseline.md`，列出 charter §2.1 已成立的 shipped truth 与 §2.2 的 gap 矩阵的具体代码位置映射（如：`auth.ts:verifyJwt() → 将被 Z1 重构`）。

---

### R12. D1 写入所有权（write ownership）的分配被分散在多份设计文档中，缺少统一汇总

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `ZX-d1-schema-and-migrations.md:209-212` — 提到 "write ownership 单一化" 作为 tradeoff，但未分配具体表→worker 的映射。
  - `Z1-full-auth-and-tenant-foundation.md:115-117` — 将 identity write ownership 固定在 `orchestrator.auth`。
  - `Z2-session-truth-and-audit-baseline.md` — 未明确 conversation 表的 write ownership 是 `orchestration.core` 还是 `agent.core`。
  - `Z3-real-runtime-and-quota.md` — 未明确 usage/balance 表的 write ownership。
- **为什么重要**：
  - Charter §2.4（Opus 分析）建议 "identity write 只在 auth worker"，但 conversation / usage 表的 write ownership 在各阶段设计文档中未统一宣布。如果 Z2 假定由 `orchestration.core` 写 conversation 表，而 Z3 假定由 `agent.core` 直接写 usage 表，会在实现时产生重复写路径或冲突。
- **审查判断**：
  - 这是一个需要在 action-plan 前补上的交叉对照项。当前各文档在"避免多头写入"上口径一致，但没有显式分配。
- **建议修法**：
  - 在 ZX-d1 文档中追加一张 "Write Ownership Matrix" 表，列明每张表（或表组）的主写 worker、读 worker、以及读 worker 是否可以绕过拥有者直接读 D1。

---

### R13. Activity/Audit log 的设计意图明确但实现形态过度依赖 Q5 拍板

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md:344-345` — 将 `nano_session_activity_logs` 的单表 vs 拆表决策抛给 Q5。
  - `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md:343` — Z2 附录将 "activity log 单表还是拆表" 列为待回答的 Q5。
  - `docs/charter/plan-zero-to-real.md:139-141` — 特别声明这张表没有现成祖宗结构。
- **为什么重要**：
  - Activity log 是整个 zero-to-real "可审计"承诺的核心表。如果它的形态不确定，Z2 的 closure 标准 "real loop 已达到最低可审计基线" 就是空的——因为"可审计"的证据就是这张表。
  - 当前 Q5 的 "当前建议/倾向" 已经很具体（单 append-only 表 + views），但直到 owner 回答前，这是一个 hanging reference。
- **审查判断**：
  - 这不是设计文档的问题（QnA 本身就是留给 owner 拍板的），但需要指出：Q5 是 Z2 能否 closures 的先决条件之一，应放入 Z2 的 blocker list。
- **建议修法**：
  - 将 Q5 列为 Z2 closure 的前置条件。
  - 如果 owner 选择采纳 "当前建议/倾向"，可以直接在 ZX-d1 文档中冻结字段级 schema（`team_uuid + trace_uuid + session_uuid + conversation_uuid + event_kind + payload + created_at`），无需等待 action-plan。

---

### R14. Design 文档之间的 Q 编号交叉引用不完整且存在缺失

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - 对比各设计文档附录 "B. 开放问题清单" 与 ZX-qna.md 的 Q 列表：
    - `Z0-contract-and-compliance-freeze.md:345-346` — 列出 Q1, Q5，但 Q5 在 ZX-qna 属于 Schema/Session/Hot State 区块，Q1 属于 Auth/Boundary/RPC 区块——Z0 自己未完整列出所有 Q。
    - `Z1-full-auth-and-tenant-foundation.md:341-343` — 列出 Q1, Q3, Q4。与 ZX-qna 对齐。
    - `Z2-session-truth-and-audit-baseline.md:343-345` — 列出 Q5, Q6, Q7。与 ZX-qna 对齐。
    - `Z3-real-runtime-and-quota.md:341-342` — 列出 Q8, Q9。与 ZX-qna 对齐。
    - `Z4-real-clients-and-first-real-run.md:343` — 列出 Q10。与 ZX-qna 对齐。
    - `ZX-binding-boundary-and-rpc-rollout.md:348-349` — 列出 Q1, Q7。缺失 Q4（API key verify path）。
    - `ZX-d1-schema-and-migrations.md:346-348` — 列出 Q5, Q6。缺失 Q3（WeChat auto-team）。
    - `ZX-nacp-realization-track.md:340-341` — 列出 Q2, Q9。缺失 Q5（activity log shape, 该文档 §7.3 提到 audit 对齐）。
- **为什么重要**：
  - QnA 集中化的目的是 "后续文档只需要引用 Q 编号"。如果有些文档不完整引用相关 Q 编号，后续实现者会漏掉上游决策依赖。
- **审查判断**：
  - 这是一个机械性遗漏，不涉及架构判断。但建议在 owner 回填答案后，统一修正所有文档的 Q 引用。
- **建议修法**：
  - 每份 Z-phase 设计文档的附录 B 应完整列出本阶段依赖的所有 Q 编号（不是只列出"待回答"的，而是包括"已回答且本阶段需要遵守"的）。

---

## 3. In-Scope 逐项对齐审核

> 本节以 charter §7（各 Phase In-Scope）为唯一基准，逐项对照设计文档的承接情况。  
> 结论统一使用：`done | partial | missing | out-of-scope-by-design`。

### 3.1 Z0 — Contract + Compliance Freeze

| 编号 | Charter 项 | 审查结论 | 说明 |
|------|-----------|----------|------|
| S01 | 冻结 worker 间 binding matrix | `partial` | Z0 和 ZX-binding 均冻结了 binding 纪律（public-only / internal-only），但未形成可逐行核对的 binding allowlist 表。Opus v2 §1.3 已有完整矩阵，建议直接复用到 ZX-binding。 |
| S02 | 冻结 RPC rollout law | `done` | ZX-binding §7.2 F3 明确了 control-plane RPC-first + 至少 1 条主方法双实现。 |
| S03 | 冻结 NACP realization track 作为全程主线 | `done` | ZX-nacp 完整冻结了 authority / session / transport / evidence 的 usage law。 |
| S04 | 冻结 Z1-Z4 in-scope / out-of-scope / exit criteria | `partial` | Charter 的 §7.2-7.5 已冻结 exit criteria，Z1-Z4 设计文档各 §7 有对应的收口目标。但 exit criteria 与设计文档的收口目标之间缺乏逐行对照。 |
| S05 | 冻结 deferred / backlog 清单 | `partial` | 各文档的 Out-of-Scope 中隐含了 deferred 项（full collaboration, cold archive, full admin plane），但没有集中汇总的 backlog 清单。 |
| S06 | 产出 design / action-plan / closure 文件清单与撰写顺序 | `done` | Charter §12 完整列出了三档文档清单与撰写顺序。 |

### 3.2 Z1 — Full Auth + Tenant Foundation

| 编号 | Charter 项 | 审查结论 | 说明 |
|------|-----------|----------|------|
| S07 | 新建 `nano-agent-db` | `pending` | ZX-d1 冻结了 schema，但 D1 bringup 的工程基线（wrangler config, migration trigger）尚未冻结。 |
| S08 | 落 identity core schema | `done` | ZX-d1 §5.1 S1 包含了 5 张 identity 表。 |
| S09 | 新建 `orchestrator.auth` | `partial` | Z1 设计完整描述了 auth worker 的角色与内部路径，但缺少从 `orchestrator-core/auth.ts` 的迁移路径（见 R6）。 |
| S10 | 实装完整 end-user auth flow | `partial` | Z1 §7.2 F2 列出了 register/login/verify/refresh/reset/me，但 refresh token state（`nano_auth_sessions`）仅在 ZX-d1 §5.3 的灰色地带表中提及，未给出最小字段设计。 |
| S11 | 最小 API key verify 运行时路径 | `pending` | Z1 §5.3 标记为 conditional in-scope，Q4 未回答。 |
| S12 | `orchestrator.auth` day-1 pure internal transport | `pending` | Q1 未回答（WorkerEntrypoint RPC vs fetch shim）。 |
| S13 | public ingress → AuthSnapshot → NacpAuthority | `partial` | ZX-nacp §7.2 F1 冻结了 authority translation law，但 Z1 设计文档未给出具体 mapping 方案（JWT claims → AuthSnapshot 的逐字段映射）。 |
| S14 | 双租户 / no-escalation / negative tests | `done` | Z1 §5.1 S5 明确要求。 |

### 3.3 Z2 — Session Truth + Audit Baseline

| 编号 | Charter 项 | 审查结论 | 说明 |
|------|-----------|----------|------|
| S15 | 落 conversation truth（conversations/sessions/turns/messages） | `partial` | ZX-d1 §5.1 S2 包含这 4 张表。但未给出最简字段级设计——当前只有表名，没有列清单。thin-but-complete 的 "thin" 到底多 thin 需要 answer。 |
| S16 | 落 context snapshot truth | `partial` | ZX-d1 §5.1 S3 包含 `nano_conversation_context_snapshots`，但同样无字段级设计。 |
| S17 | 落 activity/audit truth | `pending` | Q5 未回答（单表 vs 拆表）。 |
| S18 | DO SQLite / Alarm / conversation 聚合最低集合 | `partial` | Z2 设计文档 §7.2 F2 描述了 stateful uplift，但依赖 Q6 的精确答案。同时 DO SQLite 是零基础引入（见 R2）。 |
| S19 | orchestrator 与 D1 SSOT 接起来 | `partial` | Z2 §5.1 S1-S3 涵盖了持久化面，但 `start/followup/cancel/resume/stream` 与 D1 的对接点未在 Z2 设计中逐操作对应。 |
| S20 | control-plane RPC kickoff（至少 1 条双实现） | `pending` | Q7 未回答（是否选 `start`）。 |
| S21 | `/internal/sessions/*` 保留过渡，不扩 control-plane HTTP 新面 | `done` | ZX-binding §7.2 F3 明确了 "control-plane HTTP 只减不增"。 |
| S22 | history / reconnect / timeline / conversation list 可读 | `done` | Z2 §7.1 F1/F2/F3 的收口目标覆盖了这些。 |

### 3.4 Z3 — Real Runtime + Quota

| 编号 | Charter 项 | 审查结论 | 说明 |
|------|-----------|----------|------|
| S23 | Workers AI 进入 agent loop 主路径 | `partial` | ZX-llm §7.2 F1 冻结了 Workers AI Baseline，但 Workers AI adapter 尚未有代码级设计（见 R8）。 |
| S24 | fake provider 退为 test/demo path | `done` | Z3 §7.1 F1 收口目标明确。 |
| S25 | llm/tool side-effect 前 quota allow/deny | `pending` | Q9 未回答（覆盖 llm 还是仅 tool）。现有 `beforeCapabilityExecute` 只覆盖 tool 端。 |
| S26 | 落 quota minimal truth（usage events + quota balances） | `partial` | ZX-d1 §5.1 S5 包含 2 张表。但 balance 的更新策略（增量 or 快照 or 周期性聚合）未定义。 |
| S27 | llm/tool/quota evidence 进入 trace/audit | `done` | Z3 §7.1 F4 收口目标明确，ZX-nacp §7.1 F4 覆盖 evidence linkage law。 |
| S28 | 收紧 runtime mesh binding discipline | `partial` | 以 code 事实看，agent-core 与 context/filesystem 是通过 package 消费，不是通过 binding。Z3 在此处的 "不增新 HTTP 面" 纪律是对的，但 baseline 描述需要修正（见 R4）。 |

### 3.5 Z4 — Real Clients + First Real Run

| 编号 | Charter 项 | 审查结论 | 说明 |
|------|-----------|----------|------|
| S29 | web client 完整 hardening | `partial` | Z4 §7.1 F1 提到了 web hardening，但 web client 代码不在本 repo，API contract 未定义（见 R7）。 |
| S30 | Mini Program 接入 | `partial` | Z4 §7.1 F2 覆盖了，但 transport baseline 依赖 Q10（见 R7）。 |
| S31 | WeChat login → start → input → stream → history 全链路 | `done` | Z4 §5.1 S3 明确要求。 |
| S32 | gap triage + 修复 | `done` | Z4 §7.1 F3 的收口目标覆盖了。 |
| S33 | 承接延后 stateful 工作（双向 WS / IntentDispatcher / Broadcaster） | `partial` | 双向 WS 已有代码实现（见 R3）。"承接延后 stateful"的 scope 应重新校准。 |
| S34 | 收敛剩余 internal HTTP 面（residual inventory） | `done` | Z4 §7.1 F5（Residual Transport Inventory）明确要求。 |
| S35 | first real run evidence pack | `done` | Z4 §5.1 S4（closure/handoff）覆盖了。 |

### 3.6 对齐结论

- **done**: 17
- **partial**: 16
- **pending**: 7
- **missing**: 0

> 这不是"设计不成立"，而是**设计已达"可进入 action-plan"的成熟度，但必须先在 QnA 回填 + 修正 7 处 pending 项 + 补完 16 处 partial 项中被标记为字段/迁移/路径不完整的部分**。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项（charter §4.2） | 审查结论 | 说明 |
|------|-------------------------------|----------|------|
| O01 | 完整 admin plane | `遵守` | 所有设计文档一致排除。 |
| O02 | 完整 API key admin plane（list/create/revoke/UI） | `遵守` | Z1 §5.3 将 "完整 API key admin plane" 列为 out-of-scope，仅 "minimal verify" 为 conditional in-scope（Q4）。 |
| O03 | 所有 stream/relay/WS 一步到位全面 RPC-only | `遵守` | ZX-binding §2.1 固定 "stream-plane 可过渡"。 |
| O04 | cold archive / R2 offload | `遵守` | 所有设计文档一致排除。 |
| O05 | full quota policy / ledger / alerts plane | `遵守` | Z3 §5.2 O1 排除；ZX-d1 §5.2 O2 排除。 |
| O06 | collaboration richness 全量化 | `遵守` | Z2 §5.2 O1 排除。 |
| O07 | NACP 之外的新协议家族扩张 | `遵守` | ZX-nacp §5.2 O1 排除。 |
| O08 | tenant-facing admin UI | `遵守` | 所有设计文档一致排除。 |
| O09 | platform-level observability dashboard / metrics / ops plane | `遵守` | 所有设计文档一致排除。 |

> **Out-of-Scope 核查结论：全部遵守。** 设计文档在 scope discipline 上表现优秀。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`设计文档的 governance layer 成立——Z0-Z4 的范围、边界、方法论、交付物与收口标准构成了可审查的完整体系。但在从 "design freeze" 迈向 "action-plan" 之前，必须填补 7 个 pending 项（主要是 Q1-Q10 未回答衍生的决策空位）+ 修正 16 个 partial 项中与代码事实不符的部分（DO SQLite 起点、WS 双向现状、context/filesystem library-shell 形态、auth 迁移路径、client API contract）。`

- **是否允许关闭本轮 review**：`no`

- **关闭前必须完成的 blocker**：
  1. **Owner 回填 ZX-qna.md 的 Q1–Q10**（至少 Q1/Q5/Q6/Q7/Q9 这 5 个直接影响实现面的问题）。
  2. **修正 R6（auth 迁移路径）：在 Z1 设计文档中追加 "Migration from Embedded Auth" 一节。**
  3. **修正 R2（DO SQLite 起点）：在 Z2 或 ZX-d1 设计文档中追加 "D1 Bringup Baseline" 与 "DO SQLite Bringup Baseline" 两节**，明确这两项是零基础引入而非已有能力的扩充。
  4. **修正 R4（context/filesystem library-shell）：在 ZX-binding 中追加 "Current vs Terminal Topology" 一节**，区分 library-shell 过渡态与 service binding 终态。
  5. **修正 R7（client API contract）：在 Z4 或新增 ZX-client-api-contract 中给出 public API endpoint 与 WS message type 的最小 skeleton**。

- **可以后续跟进的 non-blocking follow-up**：
  1. **R3（WS 双向现状偏差）**：将 Z4 的 "双向 WS" 从 "新建" 纠正为 "Mini Program 兼容性硬化"。
  2. **R8（现有 OpenAI adapter 引用）**：在 ZX-llm 中追加 "Reuse from Existing LLM Stack" 指引。
  3. **R9（quota gate 运行时接口）**：在 Z3 中追加 gate interface skeleton。
  4. **R10（Z0 handoff 追踪矩阵）**：在 Z0 中追加 Design-Handoff Tracking 表。
  5. **R11（代码基线文档）**：可选新增 ZX-current-code-baseline.md。
  6. **R12（write ownership 汇总表）**：在 ZX-d1 中追加 Write Ownership Matrix。
  7. **R13（activity log 前置字段设计）**：待 Q5 回答后直接冻结字段级 schema。
  8. **R14（Q 编号交叉引用完整性）**：补全所有设计文档附录 B 的 Q 引用列表。

> 本轮 review 不收口。等待 design author 按 §5 的 5 个 blocker 修正设计文档后，再进行二次审查。

---

## 8. 对 DeepSeek 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-25`
> 评价依据: `docs/eval/zero-to-real/Z0-ZX-design-docs-reviewed-by-deepseek.md` §0–§5，尤其是 R1–R7 与 §3 In-Scope 对齐表

### 8.1 一句话评价评审风格

DeepSeek 这轮评审的风格是 **强代码现实校准 + 强架构纠偏**，对“设计把当前代码想象成了什么”这件事非常敏感，能快速指出 topology / transport / storage 起点的偏差。


### 8.2 优点
1. 它最有价值的地方，是把 **当前代码真实起点** 讲得很清楚，尤其是 DO SQLite 零使用、context/filesystem 仍是 library-shell、以及 embedded auth 迁移断点，这些都直接提升了 design 的诚实度。
2. 它对 cross-cutting 结构问题的嗅觉很强，像 `Current vs Terminal Topology`、D1 zero-base bringup、embedded auth migration 这些问题，都是后续 action-plan 很容易踩坑的点。


### 8.3 缺点
1. 它对 **时效性极强的 QnA 未回答问题** 赋权过高；这些判断在审查当时成立，但在 owner/Opus 回填后迅速过期，因此长期信噪比略受影响。
2. 个别建议已经开始向 implementation-spec 或额外文档扩张，例如单独再加 baseline 文档/contract 文档，方向不差，但不一定都该在本轮 design absorption 阶段落地。


### 8.4 对审查报告中的问题的清点

| 问题编号 | 原始严重程度 | 该问题的质量 | 分析与说明 |
|----|------|------|------------------|
| R1 | critical | 中高 | 结论在审查当时完全成立，但依赖 owner 是否已回答 Q1-Q10，时效性非常强；作为 blocker 合理，作为长期质量判断则会快速过期。 |
| R2 | high | 高 | 对 DO SQLite 不是“补一点能力”而是“从零 bringup”的判断很准确，直接促成了 Z2/ZX-D1 对当前 reality 的澄清。 |
| R3 | medium | 高 | 对“双向 WS 已经存在、Z4 应讨论 hardening 而非发明能力”的提醒很有价值，纠正了设计中的一个典型心智偏差。 |
| R4 | medium | 高 | 对 `context-core / filesystem-core` 仍是 library-shell 的识别非常到位，直接推动了 ZX-binding 增加 current-vs-target topology。 |
| R5 | high | 高 | “D1 是 zero-base bringup”这个判断非常关键，帮助把 schema 讨论从“补表”拉回“基础设施带入”。 |
| R6 | high | 高 | 对 embedded auth migration 断点的识别很强，这类问题如果不在 design 层说清，实施阶段极易造成双签发或迁移混乱。 |
| R7 | medium | 中等 | 对 client API contract 的要求合理，但更像 action-plan / implementation contract 过渡带，不完全是 design freeze blocker。 |


### 8.5 评分 - 总体 ** 8 / 10 **

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 8 | 引用代码现实较扎实，尤其擅长把设计口径拉回仓库实际状态。 |
| 判断严谨性 | 8 | 大多数判断准确，少数问题受“QnA 尚未回答”的时间窗口影响较大。 |
| 修法建议可执行性 | 8 | 多数建议可直接吸收到 design 文档中，少数建议略偏向再新增一层文档。 |
| 对 action-plan / design 的忠实度 | 8 | 总体忠实，但少数建议开始向 implementation contract 扩展。 |
| 协作友好度 | 8 | 语气直接但专业，能明确指出 design 与代码真相的偏差。 |
