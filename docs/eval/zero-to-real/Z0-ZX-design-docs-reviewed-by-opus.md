# Nano-Agent 代码审查 — `zero-to-real` design docs（Z0 + Z1-Z4 + ZX-*）

> 审查对象: `docs/design/zero-to-real/Z0-ZX 全部 10 份设计文档`
> 审查时间: `2026-04-25`
> 审查人: `Opus 4.7 (1M context)`
> 审查范围:
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

> 一句话 verdict：**这套 design 在“边界、顺序、phase governance”层做得比 charter 更扎实，但在“可执行细节、可验证收口、greenfield deliverable”三层上仍是 charter-level 的复述**——它已经够用来阻止 scope 漂移，但还没到“凭这些文档就能直接拆 action-plan 而不再回头开会”的程度。

- **整体判断**：`approve-with-followups (Grade: B)` — 主线判断与 charter 一致，结构闭合；但 §7.2 详细阐述系统性只覆盖前 2 项功能，`nano_*` 表均无字段级清单，Workers AI 的 binding/model 0 处提及，新建 `workers/orchestrator-auth/` 这件事在 10 份文档里没有任何一份处理过。这些不是观点分歧，而是“后面 action-plan 必然会被这些洞重新拉回 design 阶段”的明确债务。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 3 个判断**：
  1. **`§7.2 详细阐述`系统性只覆盖前 2 项功能** — Z1/Z2/Z3/Z4 全部存在“§7.1 列了 4-5 个 F，§7.2 只详化前 2 个”的同型缺口，且 Z2/Z4 的 §7.2 标题与 §7.1 编号还存在错位。这是 design 阶段最重要的“逐项展开”节，集体被压缩成示例两条。
  2. **ZX-D1 只到表名为止，不到字段** — `nano_users / nano_user_identities / nano_conversation_messages / nano_session_activity_logs / nano_quota_balances ...` 全部仅列表名，没有“thin-but-complete 到底保留了哪些列、丢弃了哪些列、index 是什么”。`thin-but-complete` 当前是修辞，不是清单。
  3. **三个明显的 greenfield deliverable 在所有文档里没有 owner** — (a) `workers/orchestrator-auth/` 目录、wrangler.jsonc、env/secret 绑定；(b) Workers AI 的 binding 名称与 model ID（`@cf/...`）；(c) WeChat 的 `appid/secret/jscode2session` 凭证管理。前两项是 Z1/Z3 必交付的工程项，第三项是 Mini Program 真实链路必备凭证；charter 与 design 都没指认归属表/归属 worker。

---

## 1. 审查方法与已核实事实

> 这一节只写事实，不写结论。

- **对照文档**：
  - `docs/charter/plan-zero-to-real.md`（基石文件，r1）
  - `docs/charter/review/plan-zero-to-real-reviewed-by-opus.md`（我自己 r1 review）
  - `docs/eval/zero-to-real/plan-hardening-by-GPT.md`
  - `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md`
  - `docs/templates/code-review.md`（本文件模板）
  - `context/ddl-v170/smind-01-tenant-identity.sql`（identity 表族祖宗）
  - `context/ddl-v170/smind-06-conversation-context-session.sql`（conversation 表族祖宗）
  - `context/ddl-v170/smind-09-tenant-billing-quota-usage.sql`（quota 表族祖宗）
  - `context/smind-admin/src/modules/identity/auth.service.ts:1-150`（参考 auth 实现）

- **核查实现**：
  - `workers/agent-core/src/llm/gateway.ts`（15 行，stub interface）
  - `workers/agent-core/src/host/internal-policy.ts`（252 行）
  - `workers/agent-core/src/kernel/runner.ts`（355 行）
  - `workers/orchestrator-core/src/auth.ts`（190 行，`verifyJwt` only，无 mint）
  - `workers/orchestrator-core/src/user-do.ts`（788 行，含 `forwardInternalRaw`）
  - `workers/bash-core/src/executor.ts`（744 行，`beforeCapabilityExecute` hook）
  - `packages/nacp-core/src/transport/{service-binding,do-rpc,cross-seam,queue}.ts`
  - `packages/nacp-session/src/{ingress,delivery,frame,heartbeat,replay,session-registry,messages,websocket,...}.ts`

- **执行过的验证**：
  - `wc -l` on 6 关键 worker 文件（行数核对）
  - `grep -n "forwardInternalRaw\|agent.internal\|/internal/sessions" workers/orchestrator-core/src/user-do.ts` → 6 处命中（行 483, 490, 653, 657, 692, 701）
  - `grep -rn "createJwt\|verifyJwt\|mintJwt\|signJwt" workers/orchestrator-core/src/ workers/agent-core/src/` → 仅 2 处命中，均为 `verifyJwt`
  - `grep -n "beforeCapabilityExecute" workers/bash-core/src/executor.ts` → 行 73, 203, 204, 206, 372, 373, 375
  - `ls workers/orchestrator-auth/` → **不存在**
  - `grep -rn "@cf/\|env.AI\|workers AI binding" docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md` → 仅文字提及 "Workers AI"，无 model ID、无 binding 名
  - `grep -n "appid\|appsecret\|wechat.*secret\|jscode2session" docs/design/zero-to-real/*.md` → **0 命中**
  - `grep -c "✅" docs/design/zero-to-real/Z[1-4]-*.md` → Z1=6, Z2=6, Z3=6, Z4=7（全部为 emoji 形式的“一句话收口目标”，无可机器验证形式）

### 1.1 已确认的正面事实

- **F+1**：所有 10 份文档结构整齐，统一遵循 `docs/templates/design.md`（功能簇模板）；§0 / §1 / §2 / §3 / §5 / §6 / §7.1 / §9 在每份文档里都齐全。
- **F+2**：Z0 与 4 份 ZX-* 形成的“phase-freeze + cross-cutting”分层是健康的——把 binding boundary、D1 schema、LLM adapter、NACP realization、QnA 各自独立成单一冻结点，避免了 charter 直接吞下字段级细节。这是 charter r1 之后做对的最重要一步。
- **F+3**：`ZX-binding-boundary-and-rpc-rollout.md` §7.2 F1 显式列出 4 条 binding 规则（`orchestration.core` 唯一对外、`orchestrator.auth` 单 caller、`agent.core` 为 internal mesh head、`bash/context/filesystem` 仅由 `agent.core` 调用），与现状代码事实（`workers/orchestrator-core/src/user-do.ts:657 forwardInternalRaw -> https://agent.internal/internal/sessions/...`）形成"现状 → 终态"的明确对照。
- **F+4**：`ZX-qna.md` 收纳 10 个 owner 决策点，其中 Q1/Q2/Q3/Q5/Q6/Q7/Q9/Q10 都给出了明确的 GPT 推荐线路 + Reasoning，且都预留了 `Opus的对问题的分解 / 对GPT推荐线路的分析 / 最终回答` 三段独立填位——这套机制对“我（Opus）后续如何参与决策”是友好且可继承的。
- **F+5**：`ZX-nacp-realization-track.md` 正确识别了协议层不能继续被当作背景板，并把 authority translation、transport legality、evidence linkage 三件事统一处理；这与 `packages/nacp-core/` 与 `packages/nacp-session/` 的现实代码（`ingress.ts` 已 server-stamp authority；`service-binding.ts` 已有 precheck）严格对齐，没有臆造能力。
- **F+6**：所有"反例位置"指向真实文件且语义正确——`workers/agent-core/src/llm/gateway.ts` 确为 15 行 stub（首页注释 "Stub interface only — not implemented in v1"）；`workers/orchestrator-core/src/user-do.ts` 确实仍主用 `forwardInternalRaw` fetch-backed `https://agent.internal/internal/...`。零臆造。
- **F+7**：Z3 §0 正确把 `beforeCapabilityExecute()` 标识为现成 quota seam，与 `workers/bash-core/src/executor.ts:73` 一致；Z3 §3.3 也正确指出"LLM invoke gate vs tool gate"应统一入口、不必统一实现，反映了 hook 当前只在 bash-core 而非 agent-core 的事实。
- **F+8**：`ZX-d1-schema-and-migrations.md` §0 正确识别"`nano_session_activity_logs` 是 nano-agent 新设计，不是现成祖宗表"——这与 `context/ddl-v170/` 12 个 smind-* 模块中确实没有 audit/activity 表族的事实一致（最接近的是 smind-04 的 `process_events`，但那是 module 04 = workflow control plane，已被 charter 列为 OoS）。

### 1.2 已确认的负面事实

- **F-1**：`workers/orchestrator-auth/` 目录在文件系统中**不存在**。Z1 §1.1 把它当作既有 worker 引用（"`orchestrator.auth`，负责 identity/token truth 的 internal worker"），ZX-binding §7.2 F1 也直接把它列入 binding 矩阵，但**没有任何一份文档**说"Z1 包含创建一个新的 worker 目录、wrangler.jsonc、deploy script 这件工程动作"。
- **F-2**：`grep "createJwt\|mintJwt\|signJwt"` 在 `workers/` 内**仅匹配 `verifyJwt` 一处函数定义**（`workers/orchestrator-core/src/auth.ts:75`），即当前仓库里**没有任何 worker 能 mint JWT**。Z1 §7.2 F1 说"把 token mint/verify、identity write、WeChat bridge 集中到 auth worker"——但这是从零开始建造，design 没有给出 mint helper 的形态（HS256? RS256? `jose` 库还是 Web Crypto？payload claim shape？）。
- **F-3**：跨全部 10 份 design 文档对 `wechat`、`appid`、`appsecret`、`jscode2session`、`open_id` 的 `grep` 结果——**`appid/appsecret/jscode2session` 命中 0 次**。Mini Program first real run 必备的 WeChat 凭证管理（appid/secret 落 env? 落 `nano_tenant_secrets`? 落 wrangler vars?）在 Z1 / ZX-LLM-and-secrets / ZX-D1 三份本应承担的文档里都没有归属。
- **F-4**：`ZX-llm-adapter-and-secrets.md` 内 `grep "@cf/\|env.AI\|model.*name\|llama\|qwen"` 结果——**0 处命中**具体 model ID 或 binding 名。"Workers AI first" 是 9 处，但全部停留在策略层，没有"用哪个 model、binding 取什么名、是否走 streaming"的执行级 freeze。
- **F-5**：所有 4 份 Z* 文档（Z1/Z2/Z3/Z4）的 §7.2 详细阐述都**只展开了 §7.1 表格中的前 2 个 F**，跳过 F3-F5。例：
  - Z1 §7.1 = F1/F2/F3 (WeChat Bridge)/F4 (Tenant Foundation)；§7.2 仅 F1+F2，**WeChat 与 Tenant 两件最关键事项无 detail**（行 240-260）。
  - Z2 §7.1 F1=Conversation Truth, F2=Context/Audit Truth, F3=Stateful Uplift, F4=RPC Kickoff；§7.2 标"F1 Conversation Truth"+"F2 Stateful Uplift"——**§7.2 的 F2 实际上是 §7.1 的 F3**（行 233-260）。
  - Z3 §7.1 = F1/F2/F3 (Usage/Balance Persistence)/F4 (Runtime Evidence)；§7.2 仅 F1+F2，**Usage 持久化与 Evidence linkage 无 detail**（行 230-260）。
  - Z4 §7.1 = F1=Web Hardening, F2=Mini Program Run, F3=Gap Triage, F4=Delayed Stateful, F5=Residual Transport；§7.2 标"F1 Mini Program Run"+"F2 Residual Transport Inventory"——**§7.2 F1 实际是 §7.1 的 F2，§7.2 F2 实际是 §7.1 的 F5；F1 Web Hardening / F3 Gap Triage / F4 Delayed Stateful 全部无 detail**（行 240-262）。
- **F-6**：`ZX-d1-schema-and-migrations.md` §5.1 S1-S5 的全部 11 个表只到表名，**§7.2 的 F1/F2 detail 也只到"输入/输出/调用者/核心逻辑"层**，没有任何字段级 column list、index 设计、type 选择（TEXT vs INTEGER vs BLOB）、或迁移 wave 拆分。`thin-but-complete` 的"complete"在文档里目前是抽象修辞。
- **F-7**：`ZX-d1-schema-and-migrations.md` §5.1 In-Scope 的 S1-S5 **不包含 `nano_auth_sessions`**。该表仅在 §5.3 灰区被标"in-scope"（行 189）。但 `Z1-full-auth-and-tenant-foundation.md` §5.1 S2 明确包含 "refresh-token / password reset"——refresh-token 必须有 token state 表，因此 `nano_auth_sessions` 与 Z1 in-scope 强相关却未被 ZX-D1 提升至 S 级清单。这是 doc 之间的一致性缺口。
- **F-8**：所有 Z* 文档 §7.3 "非功能性要求"都包含"测试覆盖要求"，但**全部 design 中无一处提及测试基础设施**（miniflare? vitest? cross-e2e? package-e2e?）。Recent commit `0ac807b test: add new cross-e2e and package-e2e tests` 表明仓库里这些已经存在并被使用，但 design 没有把这条事实拉进当前 phase baseline——即"我们用什么手段证明 Z1 closure"是空白。
- **F-9**：`ZX-qna.md` 共 10 题，但**至少 6 题缺位**：(a) Workers AI 的具体 model ID 与 binding 名（影响 Z3）；(b) D1 binding 名与 migration 工具（`wrangler d1 migrations apply`?）；(c) WeChat appid/secret 落点（env vs `nano_tenant_secrets` vs wrangler vars）；(d) refresh-token lifetime 与 rotation 策略（Z1 in-scope 但 design 内未定义）；(e) `deploy-fill` claim audit 语义（`ZX-nacp-realization-track.md` §7.2 F1 边界情况里自己提到"由 QnA 定死"，但 ZX-qna 里没有这个 Q）；(f) Z4 `gap triage` evidence pack 的格式契约。
- **F-10**：所有"一句话收口目标"（每份文档共 4-5 个 ✅ 项）均为**修辞性而非可机器验证**。例：
  - "✅ fake provider 不再是 production default"（Z3 F1）→ 没说"production default" 的判定方法（grep？env flag？某测试通过？）。
  - "✅ history/timeline 能从 D1 读取，而非只靠热态残留"（Z2/ZX-D1 F2）→ 没说"读取"的对外 API 形状（GET 路径？返回 schema？）。
  - "✅ 至少 1 条主方法双实现可用"（ZX-binding F3）→ 没说 "parity" 的判定（黄金对比测试？产出 byte-equal？业务 equal？）。

---

## 2. 审查发现

> 编号 R1 起，按 severity + 影响范围排序。每条 finding 都附 file:line 或 grep 事实。

### R1. `§7.2 详细阐述` 在 4 份 Z 文档中系统性只覆盖前 2 项 F，且 Z2/Z4 的标题与 §7.1 编号错位

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：
  - `Z1-full-auth-and-tenant-foundation.md` §7.1 列 F1-F4，§7.2 仅展开 F1（行 240）+ F2（行 250）；F3 WeChat Bridge / F4 Tenant Foundation 无 detail。
  - `Z2-session-truth-and-audit-baseline.md` §7.1 列 F1=Conversation Truth/F2=Context/Audit Truth/F3=Stateful Uplift/F4=RPC Kickoff（行 233-238）；§7.2 标 "F1 Conversation Truth"（行 241）+ "F2 Stateful Uplift"（行 251）——**§7.2 F2 = §7.1 F3 编号错位**。
  - `Z3-real-runtime-and-quota.md` §7.1 列 F1-F4，§7.2 仅展开 F1+F2；F3 Usage/Balance Persistence / F4 Runtime Evidence 无 detail。
  - `Z4-real-clients-and-first-real-run.md` §7.1 列 F1=Web Hardening/F2=Mini Program Run/F3=Gap Triage/F4=Delayed Stateful/F5=Residual Transport（行 232-237）；§7.2 标 "F1 Mini Program Run"（行 241）+ "F2 Residual Transport Inventory"（行 251）——**§7.2 F1 = §7.1 F2，§7.2 F2 = §7.1 F5**，编号错位且 F1 Web Hardening / F3 Gap Triage / F4 Delayed Stateful 全无 detail。
- **为什么重要**：
  - design 的 §7.2 是把"功能名"翻译成"输入 / 输出 / 主要调用者 / 核心逻辑 / 边界情况"的关键节，是后续 action-plan 拆分任务的最直接依据。
  - WeChat Bridge（Z1 F3）、Gap Triage（Z4 F3）、Delayed Stateful Work（Z4 F4）这三项恰好是 charter 与 owner 强调最多、争议面最大的功能；它们没有 detail = action-plan 阶段必然回头讨论。
  - Z2/Z4 的编号错位会让 reviewer 误以为前 2 个 F 已被覆盖，实际上 Z2 的 F2 (Context/Audit) / Z4 的 F1 (Web Hardening) 同样无 detail。
- **审查判断**：这是同型缺口，怀疑作者把 template 里的"按需展开 2 个示例"当成了完成线。每份 Z 文档都需要补足 §7.2 直至覆盖所有 F。
- **建议修法**：
  - Z1 补 F3 WeChat Bridge（`code → jscode2session → openid → upsert nano_user_identities → 若 first time 自动建 user/team/membership[Q3] → mint JWT`）+ F4 Tenant Foundation（`nano_team_memberships` 写入 ownership、双租户 negative test 列表）。
  - Z2 修正编号 + 补 F2 Context/Audit Truth（snapshot 写入时机、payload 字段集）+ F4 RPC Kickoff（`start` 双实现的 parity 判定方法）。
  - Z3 补 F3 Usage/Balance Persistence（`nano_usage_events` 写入时机：成功 / 失败 / 部分；幂等 key）+ F4 Runtime Evidence（trace_uuid 的产生与传播路径）。
  - Z4 修正编号 + 补 F1 Web Hardening + F3 Gap Triage（evidence pack 字段表 + backlog tag 体系）+ F4 Delayed Stateful（与 `packages/nacp-session/{frame,heartbeat,replay}.ts` 既有 primitives 的对接面）。

### R2. `ZX-d1-schema-and-migrations.md` 仅到表名，未到字段；`thin-but-complete` 的"complete"目前是修辞

- **严重级别**：`high`
- **类型**：`delivery-gap` + `docs-gap`
- **事实依据**：
  - `ZX-d1-schema-and-migrations.md` §5.1 列 11 个表名（行 172-176），§7.1 列 5 个 F 概念（行 234-240），§7.2 仅 F1+F2 detail（行 244-265），但**全文无任何字段级 column list、index 设计、CHECK constraint 或 type 选择**。
  - 对照 `context/ddl-v170/smind-01-tenant-identity.sql:172-237`：smind_user_identities 至少包含 18+ 列（identity_uuid, user_uuid, identity_provider, provider_subject, provider_subject_normalized, auth_secret_hash, identity_status, is_primary, is_verified, time_created_at, time_updated_at, ...）+ 2 unique index。这些哪些 nano_* 保留、哪些丢弃，design 完全无定义。
  - 对照 `context/ddl-v170/smind-06-conversation-context-session.sql`：单文件 8 张表（conversations / conversation_participants / conversation_sessions / conversation_turns / conversation_messages / conversation_message_parts / conversation_context_snapshots / conversation_context_items），charter 与 design 决定丢弃 participants / message_parts / context_items（OoS），但 nano_conversations / nano_conversation_messages 自身保留哪些列，0 处定义。
- **为什么重要**：
  - "thin" 是相对度量；"complete" 必须有字段级清单才能与 ddl-v170 形成可审计的 diff。当前 design 的 OoS 是"砍 participants/message_parts/context_items 三张表"，但 In-Scope 的"哪些列对 first real run 是必要的"完全空白。
  - Z1 的 `me / tenant readback`、Z2 的 `history/timeline read path`、Z3 的 `usage event 字段` 三件事都直接依赖列定义。没有列就没有 read API contract，没有 read API 就没有客户端契约，没有客户端契约就没有 Z4 first real run。
  - 这是 charter r1 → design r1 流程里最该被冻结的事，反而被推迟到了 action-plan。
- **审查判断**：design 阶段必须给出每张 in-scope 表的字段集（即使是"延续 smind-* 主键 + 时间字段 + 必要业务字段，丢弃 X / Y / Z"格式的 diff 表）。否则 ZX-D1 实际还停在 charter 视角。
- **建议修法**：
  - 在 §7 后增加 §7.4 "First-Wave 表与字段清单"，每张表给出至少：主键、外键、tenant_uuid、时间戳、业务必要字段、明确丢弃字段、最小 index 列表。
  - 推荐用 "vs `smind_*`" 的 diff 表格式：保留列 / 丢弃列 / 新增列 / 改名列。这样审查者能看到 nano-agent 与 smind-admin 的祖宗关系。
  - 把 `nano_session_activity_logs` 的字段集（来自 Q5 推荐：`team_uuid + conversation_uuid/session_uuid/turn_uuid + trace_uuid + event_kind + payload + created_at`）正式落入 §7.4，不要继续依赖 Q5 答案。
  - 显式枚举 migration waves：wave-1（Z1 identity 6 表）/ wave-2（Z2 conversation/audit 5 表）/ wave-3（Z3 quota 2 表）；并指明 down 策略（drop 还是 archive）。

### R3. `workers/orchestrator-auth/` 是 greenfield 创建动作，10 份文档无任何一份处理它

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `ls workers/orchestrator-auth/` → 不存在（仅 `agent-core / bash-core / context-core / filesystem-core / orchestrator-core` 5 个 worker）。
  - `Z1 §1.1` 行 32-33 把 `orchestrator.auth` 当既有概念引用："auth worker | `orchestrator.auth`，负责 identity/token truth 的 internal worker"。
  - `ZX-binding-boundary-and-rpc-rollout.md §7.2 F1` 行 244-251 直接列入 4-rule binding matrix，但全文无"创建该 worker"动作。
  - 对照 charter `plan-zero-to-real.md` §1（已确认决策）也没有列出"创建新 worker 目录"作为显式 deliverable。
- **为什么重要**：
  - 创建一个新的 Cloudflare Worker 需要：目录骨架、`wrangler.jsonc`（含 D1 binding、env vars、secret bindings、route 配置）、入口文件、deploy script、CI/CD 流水线接入、`packages/` 共享代码引用。这些都是工程项，不是"协议层"决定就能消化的。
  - Z1 closure 的硬指标（"register / login / refresh / WeChat bridge 全部 work"）依赖这个 worker 已经能 deploy。如果到 action-plan 才发现 deploy 流程里没有 it，会立即阻塞 Z1。
  - charter 的 "6-worker terminal state" 与现实的 "5-worker reality" 之间的 delta 在 design 里没有显式 owner。
- **审查判断**：这不是观点，是空白。Z1 必须显式承担"建立 workers/orchestrator-auth/ 工程骨架"作为其第 0 步。
- **建议修法**：
  - Z1 §7.1 增加 F0 "Auth Worker Scaffolding"，承担：目录创建、`wrangler.jsonc`（D1=`nano-agent-db` 共享 binding、env=`JWT_SECRET_KEY` / `PASSWORD_SALT` / `WECHAT_APPID` / `WECHAT_SECRET`、单 caller binding from orchestration.core）、入口、smoke deploy。
  - ZX-binding §7 增加一条"current vs target worker topology"对照（5 worker → 6 worker，谁先建、谁先 deploy）。
  - ZX-D1 §5 把 D1 binding 名（推测 `DB` / `NANO_DB` / `nano-agent-db`）作为 in-scope freeze 项。

### R4. `ZX-llm-adapter-and-secrets.md` 不到 model ID / binding 名 / streaming 选择 / tool-calling 三件 freeze

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `grep "@cf/\|env.AI\|model.*ID\|llama\|qwen\|llama-3\|streaming"` on `ZX-llm-adapter-and-secrets.md` → 0 命中具体 ID。
  - 全文 9 处提 "Workers AI"，全部停留在策略层（"Workers AI first" / "platform-native binding"）。
  - 对照 `workers/agent-core/src/kernel/runner.ts`（355 行）已是 streaming-first runtime；如果 first-wave 模型选 non-streaming，会需要 adapter 内部 chunking。
- **为什么重要**：
  - Cloudflare Workers AI 提供 50+ 模型，function-calling/tool-calling 支持差异巨大（Llama-3.1 支持有限、Qwen-2.5-Coder 较好、Hermes-2-Pro 强）。如果 agent loop 依赖 tool calling，model 选错就是 runtime 失败。
  - Z3 closure 的"Workers AI happy path"测试无法编写直到 model 选定。
  - secret discipline 的 §7.2 F2 提到"platform secret 优先；tenant secret 仅作为条件扩展位"——但 Workers AI 的 platform binding 是 `env.AI.run("@cf/...")`，不是 secret 形态，design 没区分这两种 secret type。
- **审查判断**：必须 freeze model ID（哪怕只是 first-wave 默认）+ binding 名 + tool-calling 能力期望。
- **建议修法**：
  - ZX-LLM §5.1 S1 改为 "Workers AI first provider baseline (model: `@cf/meta/llama-3.1-8b-instruct` 或同等级 fc-capable model；binding: `AI`)"。
  - 在 §7.2 F1 补充：streaming 默认 ON、tool-calling 期望 ON、prompt template 转换由 adapter 内部完成。
  - ZX-qna 增加 Q11 "first-wave Workers AI model ID 与 binding 名是否冻结？"。

### R5. WeChat 凭证管理在 10 份文档中无归属

- **严重级别**：`high`
- **类型**：`security` + `delivery-gap`
- **事实依据**：
  - `grep "appid\|appsecret\|wechat.*secret\|jscode2session" docs/design/zero-to-real/*.md` → 0 命中。
  - Z1 §1.1 仅描述 WeChat bridge 为 "code -> openid -> identity -> JWT"（行 39），未触及 appid/secret 来源。
  - ZX-LLM-and-secrets §0 显式仅讨论 LLM provider secret，§5.1 S4 说 "tenant secret reserved path"——但 WeChat 凭证是平台级（按 appid 维度，不必 per-tenant），仍应有归属。
  - ZX-D1 §5.3 把 `nano_tenant_secrets` 列为 conditional in-scope，但条件文字仅指 BYO key，未指 WeChat。
- **为什么重要**：
  - Mini Program first real run 依赖 `code → jscode2session(appid, secret, code) → openid + session_key`。该 RPC 调用必须由后端发起，appid/secret 在 Cloudflare Worker 哪里？env var? wrangler secret? 共享 D1?
  - 如果落 env var，rotation 与 multi-environment（dev/prod）就需要 wrangler secret 命名约定；如果落 D1 `nano_tenant_secrets`，则 boot-time 解密依赖 KEK 链。
  - 这是 Z4 闭环的硬阻塞，但 charter + design 都把它假设成已解决。
- **审查判断**：必须显式 owner。最简单的路线：Z1 决定 WeChat 凭证落 wrangler secret（env var）+ 在 Z1 §0 前置约束补一句"WeChat 凭证由 platform secret 提供，不进入 nano_tenant_secrets"。
- **建议修法**：
  - Z1 §0 前置约束补充 "WeChat appid/secret 来源 = wrangler secret bindings (`WECHAT_APPID`, `WECHAT_SECRET`)，不进入 D1。"
  - ZX-LLM-and-secrets §0 显式声明 "本设计仅覆盖 LLM provider secret；非 LLM 平台凭证（如 WeChat）的归属见 Z1 / 部署文档。"
  - ZX-qna 增加 Q12 "WeChat appid/secret 是否冻结为 wrangler secret + env binding 作为 first-wave？"。

### R6. 收口指标全部为修辞性 ✅，无机器可验证形式

- **严重级别**：`high`
- **类型**：`test-gap` + `delivery-gap`
- **事实依据**：
  - `grep -c "✅" Z[1-4]-*.md` → Z1=6, Z2=6, Z3=6, Z4=7。
  - 例（Z3 §7.2 F1 行 248）："✅ agent loop 已真实触发模型调用"——无判定方法。
  - 例（Z2 §7.2 F1 行 250）："✅ 用户断线/重连/稍后回来时仍能看到一致历史"——无 reconnect timeout 数值、无 history 一致性谓词、无验证脚本。
  - 例（ZX-binding §7.2 F2 行 266）："✅ control-plane 的 internal HTTP 已进入"只减不增"状态"——无监测机制（CI grep？code review checklist？）。
- **为什么重要**：
  - charter `§9 / §10` 已表明每个阶段需要"可执行验证项"；design 是把 charter 验证项落到具体形态的层级。当前 design 反而把 charter 已说的"可执行"退回到了 emoji 修辞。
  - 这会直接污染 review/closure 流程：reviewer 无法判断 closure 是否成立，最后只能凭"感觉差不多了"通过。
- **审查判断**：每条 ✅ 都需要补一句"判定方法"（哪条测试通过 / 哪个 grep 为空 / 哪个 metric 命中）。
- **建议修法**（示例转写）：
  - Z3 F1：✅ → "判定：`workers/agent-core/test/e2e/workers-ai-real.test.ts` 通过且生成的 `nano_usage_events` 行 `provider='workers-ai'` 出现"。
  - Z2 F1：✅ → "判定：(a) `nano_conversation_messages` 行数 ≥ 1 在 session end 之后；(b) GET history API 返回的 messages 与 D1 直接 SELECT 完全 equal"。
  - ZX-binding F2：✅ → "判定：`grep -rn 'fetch.*agent.internal' workers/orchestrator-core/src/` 行数在 Z2 closure 时 ≤ N（N 为 Z2 开始时基线行数）"。

### R7. NACP authority translation 无字段映射表

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `ZX-nacp-realization-track.md` §7.1 F1 行 231："Authority Translation: JWT / auth result 映射到 NACP authority"。
  - §7.2 F1 行 240-247 仅给出 5 行抽象描述，没有 "JWT claims `{user_uuid, team_uuid, team_plan_level}` → `NacpAuthority {tenantUuid, userUuid, plan, roles[], scopes[]}`" 这种字段对照表。
  - 对照 `context/smind-admin/src/modules/identity/auth.service.ts:62-69` 已经显式 mint claim 集 `{user_uuid, team_uuid, team_plan_level}`。
- **为什么重要**：
  - Z1 实现者落地 `mintJwt` 时必须知道哪些 claim 入；`orchestration.core` 接到 JWT 后，translation 又必须知道映射规则；否则会出现"两端各自约定"的漂移。
  - 多租户安全直接依赖这个映射的完备性（缺 `team_uuid` 映射 = tenant 越权可能）。
- **审查判断**：必须有字段表，且应在 ZX-NACP 而非 Z1 中冻结（因为 Z1 只是消费者，translation 法律是 cross-cutting）。
- **建议修法**：在 ZX-NACP §7.2 F1 增加字段映射表三行（JWT claim 字段 / AuthSnapshot 字段 / NacpAuthority 字段），并指明 deploy-fill 默认值。

### R8. ZX-D1 §5.1 In-Scope 漏列 `nano_auth_sessions`，与 Z1 refresh-token in-scope 不一致

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `Z1-full-auth-and-tenant-foundation.md` §5.1 S2（行 169）："register / login / verify-token / refresh-token / password reset"——refresh-token 是 in-scope。
  - `ZX-d1-schema-and-migrations.md` §5.1 S1（行 172）仅列 5 张身份表：`nano_users / nano_user_profiles / nano_user_identities / nano_teams / nano_team_memberships`。
  - 同文件 §5.3 灰区（行 189）："`nano_auth_sessions` | in-scope | refresh / verify-token 需要最小 token state"——但灰区不等于正式 In-Scope 清单。
- **为什么重要**：
  - 灰区表无法形成 ZX-D1 §7 的 F* 功能；Z1 实施者读 ZX-D1 §5.1 时会以为只需建 5 张表。
  - 一致性问题：Z1 in-scope 推动的 deliverable 必须在 ZX-D1 in-scope 找到表支撑。
- **审查判断**：把 `nano_auth_sessions` 提升到 §5.1 S1（identity 核心扩展为 6 张表），或显式在 §7.1 增加 F6 "Token State"。
- **建议修法**：ZX-D1 §5.1 S1 → 6 张表；§7.1 列 F6 Token State；§7.2 给出 token state 字段集（refresh_token_hash, user_uuid, expires_at, revoked_at, created_at, ip_meta?）。

### R9. quota gate 在 LLM 路径上的位置未冻结，与 `beforeCapabilityExecute` seam 不对应

- **严重级别**：`medium`
- **类型**：`correctness` + `delivery-gap`
- **事实依据**：
  - `Z3-real-runtime-and-quota.md` §0 明确指认 "最接近 quota 的现成 seam 是 `workers/bash-core/src/executor.ts` 里的 `beforeCapabilityExecute()`"（行 13）。
  - `grep -n "beforeCapabilityExecute" workers/bash-core/src/executor.ts` → 行 73, 203, 372。该 hook 仅在 bash-core 即 capability/tool 执行路径，**不在 agent-core 的 LLM 调用路径上**。
  - Q9（ZX-qna）推荐 "覆盖所有会产生资源消耗或副作用的 llm/tool path"，但 Z3 design §7.2 F2 只描述"在 side-effect 前做 gate"，没说 LLM 侧 gate 落在哪个文件、哪个函数。
  - `workers/agent-core/src/kernel/runner.ts`（355 行）是 LLM call 的最近现成位置，但 design 没有指认。
- **为什么重要**：
  - Z3 闭环必须证明 LLM gate 真实工作。如果 gate 仅在 bash-core capability 侧，LLM 侧成为绕行面，Q9 推荐落空。
  - 这是 charter 与 design 之间的具体落点漂移：charter 说"quota 必须是门禁"，design 没指认 LLM 门禁的具体宿主。
- **审查判断**：Z3 必须显式指出 LLM gate 在 agent-core 的位置（推测：`kernel/runner.ts` 在 LLM invoke 前调一个新 helper `enforceQuotaForLlm()` 通过 service binding 调 quota worker 或直接读 D1）。
- **建议修法**：
  - Z3 §7.2 F2 补充："LLM gate 落点 = `workers/agent-core/src/kernel/runner.ts`，在 invoke gateway 之前；tool gate 落点 = `workers/bash-core/src/executor.ts:73 beforeCapabilityExecute`。两处均通过 NACP envelope 调用 quota authorizer。"
  - 显式指出 quota authorizer 是独立 worker 还是 D1 直读（charter 没说）。

### R10. `nacp-session/messages.ts / frame.ts / heartbeat.ts / replay.ts` 已存在的 primitives 未被 Z2 / Z4 设计文档拉进 in-scope

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `ls packages/nacp-session/src/` → 已有 `messages.ts / frame.ts / heartbeat.ts / replay.ts / session-registry.ts / ingress.ts / delivery.ts / websocket.ts` 等 14 个文件。
  - `Z2-session-truth-and-audit-baseline.md` §1.1 提及 "session profile" 但 §7 没有指出哪些 messages 在 first-wave 走通、哪些延后。
  - `Z4-real-clients-and-first-real-run.md` §0 提及 "双向 WS message handling、IntentDispatcher、Broadcaster"——其中 IntentDispatcher 与 Broadcaster 在仓库代码里**不存在**（grep `class IntentDispatcher\|class Broadcaster` workers/ packages/ 0 命中）。
- **为什么重要**：
  - Z2/Z4 复用 `nacp-session` 既有 primitives 是最经济路径；如果 design 不显式拉进，实施者会重新实现 frame/heartbeat 等。
  - "IntentDispatcher / Broadcaster" 看起来像是 hardening 文档延续过来的概念，但在仓库里没有对应代码。这两个名字是 Z4 应实现的新组件 / 是别名 / 是 nacp-session 既有 abstraction？design 没有澄清。
- **审查判断**：Z2 §7.2 F4 应列出 first-wave 在用的 message types（基于 `messages.ts`）；Z4 应澄清 IntentDispatcher / Broadcaster 是什么文件、什么类，避免概念悬空。
- **建议修法**：
  - Z2 §7.2 F4 RPC Kickoff 补：消费的 nacp-session messages 集 = `session.start / session.followup_input / session.cancel / session.ack / session.heartbeat`；延后的 = `session.resume / session.replay`。
  - Z4 §1.1 关键术语补：IntentDispatcher 与 Broadcaster 是新组件还是既有 alias，落到具体文件预计位置。

### R11. Z0 自身无 closure 标准，"phase governance"无可验收形式

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `Z0-contract-and-compliance-freeze.md` §9.3 行 321-330 仅列 "owner 在 ZX-qna.md 回填 Q1-Q10 / 起草 Z1-Z4 action-plan / 待深入调查的子问题"——这是 to-do 而不是 closure 标准。
  - 全文无类似 Z1-Z4 §7 "一句话收口目标" 的章节（Z0 没有 §7.1 详细 F 列表，仅 §7.1 4 行 F1-F4 概念）。
- **为什么重要**：
  - Z0 是 phase 1 of 5；如果它自己不说"什么时候算完"，整套 Z0-Z4 closure 流程就缺一个起点。
  - charter / design / action-plan 三层之间，charter 由 charter review 收口，action-plan 由代码 review 收口；design 自己的收口标准本应在 design layer 给出。Z0 兼任 design layer + governance layer，更应说清楚。
- **审查判断**：Z0 应在 §9.3 之上加一节 "Z0 closure 标准"。
- **建议修法**：
  - Z0 §9.3 之前增加 "Z0 closure 标准"：(a) ZX-qna 全部 10 题有 owner answer；(b) 5 份 ZX-* + 5 份 Z* design 文档都已 r1 reviewed-by-opus；(c) 至少 1 份 action-plan 已基于 design r1 起草。

### R12. Z1 refresh-token / password 哈希 / 速率限制三件安全相关默认未冻结

- **严重级别**：`medium`
- **类型**：`security` + `docs-gap`
- **事实依据**：
  - `Z1 §5.1 S2` 包含 refresh-token，但 design 内无 refresh-token lifetime（推测应是 access 1h / refresh 30d，但未定义）。
  - 对照 `context/smind-admin/src/modules/identity/auth.service.ts:32-33`：smind-admin 的 password 哈希是 `hashSecret(input.password, ctx.env.PASSWORD_SALT)`——文件外的 `infra/security` 实现，等价于 SHA-256 + 静态盐（不是 bcrypt/argon2/scrypt）。Z1 design 未指明 nano-agent 是延续这个还是升级。
  - Z1 内无对 login 失败次数限制 / 时间窗 brute-force 防御的提及。
- **为什么重要**：
  - 静态盐 + SHA-256 在 2026 年是已知弱方案；Z1 是产品真实化阶段，安全 baseline 不该靠"延续 smind-admin"隐性带过。
  - 没有 rate limit，password reset endpoint 是邮箱枚举漏洞面。
- **审查判断**：design 阶段必须指认安全 baseline，即使是"延续 smind-admin 当前形态，作为 Z1 OoS 项延后升级"也要写清楚。
- **建议修法**：
  - Z1 §0 前置约束新增："密码哈希延续 smind-admin 现状（`hashSecret = SHA-256+PASSWORD_SALT`）作为 first-wave；升级到 argon2id 在下一阶段处理（已知 trade-off）。"
  - Z1 §5.2 OoS 显式列 "rate limiting / brute force defense（first-wave OoS，延后到下一阶段）"。
  - Z1 §7.2 F2 增加 refresh-token lifetime（默认 access 1h / refresh 30d / rotation on use）。

### R13. ZX-qna 缺 6 个明显应有的决策点

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：基于上述 R4/R5/R7/R12 已识别的空白：
  - 缺 Q：Workers AI 具体 model ID 与 binding 名（R4）
  - 缺 Q：D1 binding 名与 migration 工具（R3）
  - 缺 Q：WeChat appid/secret 落点（R5）
  - 缺 Q：refresh-token lifetime / rotation 策略（R12）
  - 缺 Q：deploy-fill claim audit 语义（ZX-NACP §7.2 F1 自己提到"由 QnA 定死"但 ZX-qna 无此 Q）
  - 缺 Q：Z4 gap triage evidence pack 的格式契约
- **为什么重要**：
  - ZX-qna 本身 §0 自我定位为"业主只在本文件填写回答"——missing Q 意味着这些决策不会被 owner 看到，等于 design 决定权落到了实施者。
  - ZX-qna 当前有 10 题，负载不重；扩到 16 题在 owner 时间成本上仍可接受。
- **审查判断**：补 Q11-Q16，每个 Q 提供 GPT 推荐线路 + Reasoning。
- **建议修法**：
  - Q11 — Workers AI 具体 model（推荐：`@cf/meta/llama-3.1-8b-instruct` 或 fc-capable 同等级 model；binding `AI`）。
  - Q12 — WeChat 凭证（推荐：wrangler secret env vars `WECHAT_APPID`/`WECHAT_SECRET`）。
  - Q13 — D1 binding 名 + migration tool（推荐：`DB`/`nano-agent-db`，`wrangler d1 migrations`）。
  - Q14 — refresh-token lifetime（推荐：access 1h / refresh 30d / rotate on use）。
  - Q15 — deploy-fill claim audit（推荐：缺失 claim 用 deploy default 填充并写入 activity log `event_kind='auth.deploy_fill'`）。
  - Q16 — Z4 evidence pack 形态（推荐：JSON 文件 `docs/closure/z4/evidence-{trace_uuid}.json`，包含 trace timeline + activity log subset + outcome verdict）。

### R14. `nano_*` 命名 vs smind-* 列名一致性未约定

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - smind-01-tenant-identity.sql:179 列名 `identity_provider` (smind 风格 `<noun>_<modifier>`)。
  - 各 design 文档行文中混用 `provider` 与 `identity_provider`（例 Z1 §3.2 "identity providers" 用 `nano_user_identities.provider`）——但 ddl-v170 用的是 `identity_provider`。
- **为什么重要**：
  - 表名前缀已决定 `nano_` 替换 `smind_`，但列名是否复刻仍未冻结。如果 nano- 改为 `provider` 简写，与 ddl-v170 形成 schema diff，code-share 与 ETL 都要二次映射。
- **审查判断**：低优先，但 design 阶段一句声明就能避免后续返工。
- **建议修法**：ZX-D1 §0 前置约束加一句："nano-agent first-wave 列名延续 smind-* 风格（如 `identity_provider`），仅前缀替换 `smind_` → `nano_`。"

### R15. `nano_session_activity_logs` payload 字段集 / max size / PII 策略未冻结

- **严重级别**：`low`
- **类型**：`security` + `docs-gap`
- **事实依据**：
  - Q5 推荐字段集（行 84）：`team_uuid + conversation_uuid/session_uuid/turn_uuid + trace_uuid + event_kind + payload + created_at`。
  - ZX-D1 / ZX-NACP 都把 `nano_session_activity_logs` 列入 in-scope，但无人定义 payload 形态（JSON TEXT? max length? PII redaction posture?）。
  - 对照 `packages/nacp-session/src/redaction.ts` 已存在 — design 没引用。
- **为什么重要**：
  - audit log 一旦上线，payload 内什么内容能进、什么不能进（user 输入文本？token 值？）必须前置；事后清理不现实。
- **审查判断**：低优先（不阻塞首发），但应在 design 阶段记录"payload redaction 复用 `packages/nacp-session/redaction.ts`"。
- **建议修法**：ZX-D1 §7.4（新增字段表节）里给 `nano_session_activity_logs.payload` 注明 "JSON TEXT, max 8KB, write-side redaction 走 `packages/nacp-session/redaction.ts`"。

### R16. ZX-binding 未具体化 `WorkerEntrypoint RPC` 方法签名

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `ZX-binding-boundary-and-rpc-rollout.md §7.2 F2`（行 254-266）"control-plane RPC kickoff" 只到"Z2 scaffold RPC entrypoint，至少把 `start` 做成首条双实现方法"。
  - 没有给出 `class AgentCoreEntrypoint extends WorkerEntrypoint { async startSession(...) }` 的方法签名（参数 / 返回类型）。
  - 对照 `packages/nacp-core/src/transport/service-binding.ts` / `do-rpc.ts` 已经有 transport precheck primitive 但没有 RPC method shape spec。
- **为什么重要**：
  - 双实现 = 旧 fetch path + 新 RPC path 共存。如果方法签名不冻结，两 path 不可能 byte-equal parity。
- **审查判断**：低优先（可以在 action-plan 给出），但 design 给一段 TypeScript signature 草案对实施者帮助巨大。
- **建议修法**：ZX-binding §7.2 F2 增加 RPC signature 草案：
  ```ts
  export class AgentCoreEntrypoint extends WorkerEntrypoint<Env> {
    async startSession(req: { authority: NacpAuthority; trace: NacpTrace; session: SessionStartInput }): Promise<SessionStartOutput> { ... }
  }
  ```

### R17. 测试基础设施 baseline 未拉入 design

- **严重级别**：`low`
- **类型**：`test-gap`
- **事实依据**：
  - 全部 Z* 文档 §7.3 都包含"测试覆盖要求"行为（双租户负例、RPC parity、Workers AI happy path 等），但**无一处指明用什么基础设施**（miniflare? vitest workers pool? cross-e2e harness?）。
  - 仓库 commit `0ac807b` 已添加 cross-e2e + package-e2e tests，事实存在。
- **为什么重要**：
  - design 不引用既有 test infra = action-plan 实施者必须重头评估，浪费一轮。
- **审查判断**：低优先，但每份 Z 在 §7.3 加一行"测试基础设施延续仓库现有 cross-e2e / package-e2e harness"即可。
- **建议修法**：在 Z0 §0 前置约束统一声明测试基础设施 baseline（一处声明，4 份 Z* 引用）。

### R18. NACP cross-seam transport 未被 ZX-NACP 引用

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `packages/nacp-core/src/transport/cross-seam.ts` 文件存在（确认 `ls` 命中）。
  - `ZX-nacp-realization-track.md` 仅引用 `service-binding.ts` 与 `do-rpc.ts`（行 254），未提 `cross-seam.ts`。
- **为什么重要**：
  - cross-seam 通常表示跨 worker / 跨 process / 跨进程边界的协议层（vs single-process service-binding）。如果它在 first-wave 也被使用，ZX-NACP 应说明；如果不用，应显式 OoS。
- **审查判断**：低优先；一行 OoS 即可。
- **建议修法**：ZX-NACP §5.2 加一条 OoS："cross-seam transport（`packages/nacp-core/src/transport/cross-seam.ts`）在 zero-to-real 不进入 first-wave；保留扩展位。"

### R19. Workers AI / DeepSeek 选择权变化的 decision trail 缺失

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md`（v2 review）曾推荐 DeepSeek 作为 primary。
  - charter r1 + design 全部转向 "Workers AI first"。
  - `ZX-llm-adapter-and-secrets.md §6.1 取舍 1` 行 194-197 给了 "为什么 Workers AI first"，但**无引用 v2 之前推荐的反向意见**——decision trail 在文档里看不到反对线路。
- **为什么重要**：
  - 未来如果 BYO key 真实需求出现，需要回看"为什么 zero-to-real 选 Workers AI 不选 DeepSeek primary"。当前 design 假装两线路对等，实际上 v2 review 是有立场的。
- **审查判断**：低优先；附录 A 加一行即可。
- **建议修法**：ZX-LLM §A 讨论记录补一条："v2 review 曾建议 DeepSeek primary（参见 `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md`）；charter r1 倒转为 Workers AI primary，原因是 platform-native binding 可最快让 fake provider 退场。"

### R20. Z4 IntentDispatcher / Broadcaster 概念悬空（与 R10 关联）

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `Z4 §0` 行 19："双向 WS message handling、IntentDispatcher、Broadcaster 等 richer stateful 工作可在 Z4 收尾"。
  - `grep -rn "class IntentDispatcher\|class Broadcaster" workers/ packages/` → 0 命中。
  - 既不是 nacp-session 既有 primitive，也不是 charter 显式定义的新组件。
- **为什么重要**：
  - 这些名字看起来像是从 hardening 文档继承过来的工程术语，但 design 没有定义边界、归属、依赖。Z4 实施者必须澄清 = 多一轮往返。
- **审查判断**：低优先；在 Z4 §1.1 关键术语表里给一句定义即可。
- **建议修法**：Z4 §1.1 关键术语补 "IntentDispatcher = `agent.core` 内部把 user input 路由到 capability/llm 的 dispatcher；Broadcaster = `orchestration.core` user DO 内部把 stream events 多端 fanout 的组件。两者在仓库当前不存在，Z4 内若实现走 stateful uplift 增量、若不实现进 residual inventory。"

---

## 3. In-Scope 逐项对齐审核

> 每份 design 各自的 §5.1 In-Scope 项与该文档 §7（功能详细列表）+ 实施可达性的对齐。

### 3.1 `Z0-contract-and-compliance-freeze.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| Z0-S1 | 冻结 zero-to-real 全局 In-Scope / Out-of-Scope | `done` | §4 charter / §5 design 已分层冻结 |
| Z0-S2 | 冻结 `orchestration.core` public-only / 其他 internal-only | `partial` | 概念冻结（§2.3）；具体由 ZX-binding 承担——这是健康的分层但 Z0 自己应明确转交 |
| Z0-S3 | 冻结 NACP-first / thin-but-complete / real-client-driven 方法论 | `partial` | NACP-first 已冻结；thin-but-complete 的 "complete" 仍待 ZX-D1 给字段（R2） |
| Z0-S4 | 冻结 Z1-Z4 design / action-plan 文件清单 | `done` | §3.1 / §3.4 显式列入 |
| Z0-S5 | QnA 集中转交 ZX-qna.md | `done` | 但 ZX-qna 自身缺 6 题（R13） |

**对齐结论**：done=3 / partial=2 / missing=0。Z0 的 governance 任务基本完成，但 Z0 自身缺 closure 标准（R11）。

### 3.2 `Z1-full-auth-and-tenant-foundation.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| Z1-S1 | `orchestrator.auth` internal-only bringup | `partial` | 边界冻结；但"创建该 worker 工程骨架"无 owner（R3） |
| Z1-S2 | register / login / verify-token / refresh-token / password reset | `partial` | 列入 in-scope；refresh-token 字段集（R8） + 哈希 / lifetime / rate-limit（R12）未冻结 |
| Z1-S3 | `me` / tenant readback | `partial` | 概念冻结；具体 read API 形状无 |
| Z1-S4 | WeChat bridge | `partial` | 列入 in-scope；§7.2 F3 detail 缺失（R1）+ appid/secret 归属（R5）+ 自动建租户（Q3）未确认 |
| Z1-S5 | 双租户 negative tests / no-escalation proof | `partial` | 提到"必须存在"；测试基础设施未指（R17） |

**对齐结论**：done=0 / partial=5 / missing=0。每条 in-scope 都"已冻结方向、未到执行"——这是 design 阶段可接受的，但比 Z0 留下的执行准备度低，需要 R1/R3/R5/R12 的修法补齐。

### 3.3 `Z2-session-truth-and-audit-baseline.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| Z2-S1 | conversation/session/turn/message 真相落 D1 | `partial` | 表名列入；字段集缺（R2） |
| Z2-S2 | context snapshot 真相落 D1 | `partial` | 同上；Z2 §7.2 未独立 detail（R1） |
| Z2-S3 | activity/audit truth 落 D1 | `partial` | Q5 给推荐字段；正式入 §7（R15） |
| Z2-S4 | DO SQLite/Alarm/conversation 聚合最低集合 | `partial` | Q6 给四组类别；Alarm 触发条件未冻结 |
| Z2-S5 | `orchestration.core -> agent.core` control-plane RPC kickoff | `partial` | 边界冻结；RPC method 签名（R16）+ parity 判定（R6）未给 |

**对齐结论**：done=0 / partial=5 / missing=0。Z2 是 zero-to-real 最复杂阶段；每条 in-scope 都需要 ZX-D1（字段）+ ZX-binding（RPC sig）共同补齐。

### 3.4 `Z3-real-runtime-and-quota.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| Z3-S1 | Workers AI 进入主路径 | `partial` | 策略冻结；model ID / binding / streaming / fc 三件未冻结（R4） |
| Z3-S2 | fake provider 退到 test/demo | `done` | 方向明确，Z3 §5.1 S2 直接列入 |
| Z3-S3 | llm/tool side-effect 前 quota allow/deny | `partial` | LLM gate 落点未指（R9） |
| Z3-S4 | `nano_usage_events` / `nano_quota_balances` 写入 | `partial` | 表名在 ZX-D1 列入；字段未给；幂等策略未给 |
| Z3-S5 | llm/tool/quota evidence 进 trace/audit | `partial` | 与 NACP realization §7 F4 关联；evidence 字段集未给 |

**对齐结论**：done=1 / partial=4 / missing=0。Z3 的 "Workers AI 接入" + "quota 真实化" + "evidence linkage" 三条主线都需要 ZX-LLM + ZX-D1 + ZX-NACP 三份 ZX 共同补字段级清单。

### 3.5 `Z4-real-clients-and-first-real-run.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| Z4-S1 | web thin client hardening | `partial` | §7.2 F1 detail 缺（R1） |
| Z4-S2 | Mini Program 接入 | `partial` | WeChat 凭证（R5）+ Q10 未确认 |
| Z4-S3 | WeChat login → start → input → stream → history 全链路 | `partial` | 依赖 Z1 S4 / Z2 S5 / Z3 S1 全部 partial |
| Z4-S4 | gap triage + 修复 | `partial` | evidence pack 格式（R13/Q16）未冻结 |
| Z4-S5 | delayed stateful work + residual HTTP inventory | `partial` | IntentDispatcher / Broadcaster 概念悬空（R20） |

**对齐结论**：done=0 / partial=5 / missing=0。Z4 的状态高度依赖前 3 阶段 + Q10 决策。

### 3.6 `ZX-binding-boundary-and-rpc-rollout.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| ZX-B-S1 | 6-worker binding matrix | `partial` | 4 条 binding 规则已列；但 6th worker `orchestrator.auth` 不存在（R3） |
| ZX-B-S2 | `orchestrator.auth` internal-only / single caller | `done` | Q1 推荐已给 |
| ZX-B-S3 | control-plane RPC-first 顺序 | `partial` | "start 优先"已 freeze；method signature 未给（R16） |
| ZX-B-S4 | stream-plane 仅作过渡 seam | `done` | §5.3 / §7 显式列入 |
| ZX-B-S5 | internal gate 最小安全纪律 | `partial` | "secret + authority + trace" 已声明；但 RPC 世界里 secret 怎么传未给 |

**对齐结论**：done=2 / partial=3 / missing=0。这是 ZX 系列里最具体的一份，但仍欠 method signature 与 RPC 时代的 caller-identity proof。

### 3.7 `ZX-d1-schema-and-migrations.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| ZX-D-S1 | 身份核心 5 张表 | `partial` | 表名已列；漏 nano_auth_sessions（R8）；字段未给（R2） |
| ZX-D-S2 | 会话核心 4 张表 | `partial` | 同 R2 |
| ZX-D-S3 | 上下文核心 1 张表 | `partial` | 同 R2 |
| ZX-D-S4 | 审计核心 1 张表 | `partial` | Q5 给字段推荐；正式入 §7（R2/R15） |
| ZX-D-S5 | quota 核心 2 张表 | `partial` | 同 R2 |

**对齐结论**：done=0 / partial=5 / missing=0。R2 是这份 ZX 的核心改进项；补完字段表后这五条都会立即 done。

### 3.8 `ZX-llm-adapter-and-secrets.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| ZX-L-S1 | Workers AI first provider baseline | `partial` | 策略冻结；model / binding / streaming / fc 未给（R4） |
| ZX-L-S2 | provider adapter boundary 冻结 | `partial` | adapter 落点未指（哪个文件 / 是否替换 `gateway.ts`） |
| ZX-L-S3 | optional DeepSeek skeleton | `done` | 方向明确 |
| ZX-L-S4 | tenant secret reserved path | `done` | conditional in-scope 表态明确 |
| ZX-L-S5 | basic secret rotation/cache discipline | `partial` | 未给 SLO（rotation 周期？）+ cache TTL |

**对齐结论**：done=2 / partial=3 / missing=0。R4 修法可一次性把 S1+S2+S5 升到 done。

### 3.9 `ZX-nacp-realization-track.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| ZX-N-S1 | JWT → AuthSnapshot → NacpAuthority translation zone | `partial` | 字段映射表未给（R7） |
| ZX-N-S2 | public/internal no-escalation law | `done` | 复用现有 `internal-policy.ts` 与 `auth.ts`，方向清楚 |
| ZX-N-S3 | client session message 合法使用面 | `partial` | first-wave message 集未列（R10） |
| ZX-N-S4 | worker-to-worker NACP-only transport | `partial` | service-binding / do-rpc 已引；cross-seam 漏（R18） |
| ZX-N-S5 | trace / audit / evidence 最小回挂面 | `partial` | 字段集与 activity log 重叠未明确（R15） |

**对齐结论**：done=1 / partial=4 / missing=0。R7+R10+R15 修法可一次拉齐。

### 3.10 `ZX-qna.md`

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| ZX-Q-S1 | 收纳 owner 必须拍板的决策 | `partial` | 当前 10 题；R13 列出至少 6 个明显缺位 |
| ZX-Q-S2 | 每题给 GPT 推荐 + Reasoning + Opus 三段 | `done` | 模板严格执行 |
| ZX-Q-S3 | 业主回答区清晰可填 | `done` | 模板严格执行 |

**对齐结论**：done=2 / partial=1 / missing=0。补 Q11-Q16 后即 done。

### 3.11 整体对齐总览

- **done**: 11
- **partial**: 38
- **missing**: 0

> 这更像"主线方向已对齐，每条都缺一段执行级 freeze"，而不是"已经可以直接拆 action-plan"。10 份文档的整体成熟度 ≈ B（强 design baseline，弱 deliverable specifics）。

---

## 4. Out-of-Scope 核查

### 4.1 各 design 自身 OoS 一致性

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | Z0 不写字段级 schema | `遵守` | charter 与 design 分层正确 |
| O2 | Z0 不开 admin plane / billing / dashboard | `遵守` | 5 份 Z* + 5 份 ZX-* 都没越界 |
| O3 | Z0 不要求 internal HTTP 全面退役完成 | `遵守` | ZX-binding §5.3 灰区显式允许过渡 |
| O4 | Z1 不做完整 tenant/member/API key admin plane | `遵守` | API key minimum verify 走 Q4 conditional |
| O5 | Z1 不允许 auth worker public route | `遵守` | ZX-binding §5.3 灰区显式禁止 |
| O6 | Z1 不处理 session/history/persistence 主线 | `遵守` | 转交 Z2 |
| O7 | Z2 不处理 full collaboration richness | `遵守` | OoS participants/message_parts/context_items |
| O8 | Z2 不处理 cold archive / R2 offload | `遵守` | ZX-D1 §5.2 O3 显式列入 |
| O9 | Z2 不处理 all stream-plane RPC-only | `遵守` | ZX-binding §5.2 O1 显式列入 |
| O10 | Z3 不做 full quota product plane | `遵守` | usage_events + balances 仅最小集 |
| O11 | Z3 不做 multi-provider required baseline | `遵守` | Workers AI single required |
| O12 | Z3 不做 BYO key 平台 | `遵守` | DeepSeek 仅 skeleton |
| O13 | Z4 不做 full product UI polish | `遵守` | thin validation client posture |
| O14 | Z4 不做 platform ops/dashboard/SLO | `遵守` | 显式 OoS |

### 4.2 跨 design OoS 漂移检查

- **OoS 与 charter 是否一致**：14 条 OoS 都能在 `docs/charter/plan-zero-to-real.md` §4 全局 OoS 找到对应或细化关系，**无越界**。
- **In-Scope vs OoS 矛盾点**：Z1 S2 包含 refresh-token，但 ZX-D1 S1 不含 nano_auth_sessions（R8）——这是技术性矛盾，不是 OoS 漂移。
- **隐性 OoS 但应显式的项**：
  - **观测性 (logs / metrics / alerting)** 在所有 design 中既未 In-Scope 也未 OoS——是隐性 OoS。建议显式列入"OoS（first-wave 仅依靠 Cloudflare worker logs，不引入独立观测系统）"。
  - **CI/CD / release pipeline** 同上隐性 OoS。
  - **i18n / 多语言客户端**（charter 提到 default `zh-CN`）也是隐性 OoS。
  - 建议 Z0 §5.2 显式补一句 "platform observability / CI hardening / i18n 全部为 zero-to-real OoS，由下一阶段承担"。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`approve-with-followups (Grade: B)`
- **是否允许关闭本轮 review**：`no` — 不收口，等待 r2 修订
- **关闭前必须完成的 blocker**：
  1. **R1 修复**：Z1/Z2/Z3/Z4 的 §7.2 必须覆盖 §7.1 中所有 F，并修正 Z2/Z4 的编号错位。
  2. **R2 修复**：ZX-D1 必须新增字段级清单节（推荐 §7.4），覆盖全部 11 张 in-scope 表。
  3. **R3 修复**：Z1 必须显式承担 `workers/orchestrator-auth/` greenfield scaffolding（建议作为 F0）。
  4. **R4 修复**：ZX-LLM 必须冻结 first-wave Workers AI model ID + binding 名 + streaming/fc 期望。
  5. **R5 修复**：WeChat 凭证落点必须显式 owner（推荐：wrangler secret，落 Z1 §0 前置约束）。
  6. **R6 修复**：所有 ✅ 一句话收口目标必须补"判定方法"（grep / test / metric）。
- **可以后续跟进的 non-blocking follow-up**：
  1. **R7-R9**：authority 字段映射 / `nano_auth_sessions` 提级 / quota gate LLM 落点（可在 r2 一次处理，但单独看不阻塞）。
  2. **R10**：nacp-session 既有 primitives 拉进 Z2/Z4 in-scope。
  3. **R11**：Z0 自身 closure 标准。
  4. **R12-R13**：Z1 安全 baseline + ZX-qna 补 Q11-Q16。
  5. **R14-R20**：低优先文档清洁度（命名一致性 / payload 字段 / RPC 签名草案 / 测试基础设施引用 / cross-seam OoS / Workers AI decision trail / IntentDispatcher 概念定义）。

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新设计文档。建议 r2 优先处理 6 个 blocker（R1-R6），然后在 r3 review 中处理 R7-R20 的 follow-ups。

---

## 6. 实现者回应

### 6.1 对本轮审查的回应

> 执行者: `GPT-5.4`
> 执行时间: `2026-04-25`
> 回应范围: `Opus + Kimi + DeepSeek 全部 design review findings（忽略用户已明确过期的“QnA 未回答”类判断）`

- **总体回应**：`三位同事指出的 blocker / medium issues 已按代码事实与已回填的 ZX-qna 答案完成吸收；设计包现已收口到可进入 action-plan / implementation 的状态。`
- **本轮修改策略**：`先冻结 owner 已回答的 Q1-Q10，再补 current-reality、字段级清单、greenfield deliverable owner、RPC/Workers AI/NACP 映射与客户端证据包，最后把 stale review judgement 明确降级为已过期口径。`

### 6.2 逐项回应表

| 同事问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|
| **Opus R1/R11/R17** + **Kimi R2** + **DeepSeek R1**：`§7.2` 未展开、Z0 closure 缺失、测试基线未入 design、QnA 未消费 | `fixed` | 已把 `ZX-qna.md` 改为 answered freeze register；Z0-Z4 全部补入完整 `§7.2`、closure/判定方法、测试基础设施基线，并把“去 ZX-qna 回答”旧口径改为“已冻结答案需在实施中消费” | `docs/design/zero-to-real/ZX-qna.md`, `Z0-contract-and-compliance-freeze.md`, `Z1-full-auth-and-tenant-foundation.md`, `Z2-session-truth-and-audit-baseline.md`, `Z3-real-runtime-and-quota.md`, `Z4-real-clients-and-first-real-run.md` |
| **Opus R2/R8/R14/R15** + **Kimi R4** + **DeepSeek R2/R5**：ZX-D1 只有表名、缺字段/index/ownership、`nano_auth_sessions` 未进正式 in-scope、命名与 payload/redaction 未冻结 | `fixed` | ZX-D1 现已补成字段级最小冻结、最小索引、migration waves、binding alias、migration tool、write ownership matrix；`nano_auth_sessions` / `nano_team_api_keys` 已提升为 S1 身份核心；`nano_user_identities` 列名收紧为 `identity_provider / provider_subject_normalized`；`nano_session_activity_logs.payload_json` 增加 `JSON text + 8KB + redaction.ts` discipline | `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md` |
| **Opus R3/R5/R12** + **Kimi R1** + **DeepSeek R6**：`workers/orchestrator-auth/` greenfield deliverable 无 owner、WeChat secret 落点缺失、auth 当前 reality 与迁移路径不清、refresh/password baseline 漂移 | `fixed` | Z1 §0/§7.2 现已显式写明当前只有 verify path、`workers/orchestrator-auth/` 为 greenfield deliverable、WeChat 凭证固定为 wrangler secrets、refresh token = `1h/30d/rotate-on-use`、password hash first-wave 延续 `smind-admin` 的 `SHA-256 + PASSWORD_SALT` 基线、rate limiting 明确 OoS | `docs/design/zero-to-real/Z1-full-auth-and-tenant-foundation.md` |
| **Opus R4/R19** + **Kimi R5**：Workers AI binding/model 未冻结、DeepSeek/Workers AI decision trail 不清 | `fixed` | ZX-LLM 已冻结 first-wave `AI` binding 与默认 model `@cf/ibm-granite/granite-4.0-h-micro`，并写明 fallback model、`env.AI.run(..., { messages, stream: true })` 调用形态、DeepSeek 仅 skeleton、以及此前 DeepSeek-primary 评论为何未被采用 | `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md` |
| **Opus R6/R16** + **DeepSeek R4**：binding/topology 与 RPC 签名不具体、context/filesystem 现实姿态与 design 有漂移 | `fixed` | ZX-binding 已新增 current-vs-target topology 表，明确当前是 5-worker reality + `orchestrator.auth` greenfield；同时明确 `context.core / filesystem.core` 在 zero-to-real 里按 library-shell / probe-only posture 处理，并补入 `startSession` RPC signature 草案、Auth internalization、residual stream inventory | `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md` |
| **Opus R7/R18**：JWT/AuthSnapshot/NacpAuthority 映射表缺失、`cross-seam.ts` 是否 first-wave 未说明 | `fixed` | ZX-NACP 已新增字段映射表（JWT/AuthSnapshot -> NacpAuthority）、first-wave session message set、Evidence linkage，并明确 `cross-seam.ts` 在 zero-to-real 仅作 future transport primitive，不进入 first-wave 必经路径 | `docs/design/zero-to-real/ZX-nacp-realization-track.md` |
| **Opus R9** + **Kimi R6**：quota gate 在 LLM 路径落点未冻结 | `fixed` | Z3 现已把 tool gate 明确绑到 `bash-core` 的 `beforeCapabilityExecute()`，把 LLM gate 明确绑到 `workers/agent-core/src/kernel/runner.ts` invoke 前的对称 hook，并补 usage/balance persistence 与 runtime evidence 两个缺失 F | `docs/design/zero-to-real/Z3-real-runtime-and-quota.md` |
| **Opus R10/R20** + **DeepSeek R3** + **Kimi R8**：`nacp-session` 既有 primitives 未被 Z2/Z4 消费、IntentDispatcher/Broadcaster 概念悬空、客户端代码位置未定义 | `fixed` | Z2 / Z4 现已显式消费 `messages.ts / frame.ts / heartbeat.ts / replay.ts` 既有 primitives；Z4 重新定义为 HTTP in + WS out baseline 的 hardening 而非“重新发明双向 WS”；同时冻结 `clients/web/` 与 `clients/wechat-miniprogram/` 目录，并把 `IntentDispatcher` / `Broadcaster` 限定为 `agent.core` input routing seam 与 `orchestration.core` user DO fanout seam | `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md`, `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md` |
| **Opus R13**：建议继续给 ZX-qna 新增 Q11-Q16 | `rejected` | 该建议在 review 时成立，但随后 owner 与 Opus 已完成 Q1-Q10 回填。为避免重新打开决策面，本轮选择把缺失决策直接冻结进对应 design docs，而不是继续膨胀 QnA surface。相关内容现已分别落到 Z1 / Z3 / Z4 / ZX-D1 / ZX-LLM / ZX-NACP | `ZX-qna.md` 保持 10 题；变更落在对应 design docs |
| **Kimi R7**：要求在 design 中加入工时/LOC 粗估 | `rejected` | 这是有价值的执行管理建议，但不属于本轮设计收口阻塞项；且当前用户要求是 design absorption，而不是重新回写 timeline/estimate。该信息保留给后续 action-plan 或项目管理层处理 | 无 |
| **所有“ZX-qna 未回答”类判断** | `stale` | 这些判断在 review 时成立，但当前已被 owner+Opus 的 Q1-Q10 回答与设计文档消费所覆盖；因此本轮只保留与现行文档仍有关的 structural issues，不再重复扩写过期 blocker | `docs/design/zero-to-real/ZX-qna.md` + 全部已修正文档 |

### 6.3 变更文件清单

- `docs/design/zero-to-real/ZX-qna.md`
- `docs/design/zero-to-real/Z0-contract-and-compliance-freeze.md`
- `docs/design/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
- `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md`
- `docs/design/zero-to-real/Z3-real-runtime-and-quota.md`
- `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md`
- `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md`
- `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
- `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md`
- `docs/design/zero-to-real/ZX-nacp-realization-track.md`

### 6.4 文字评估与修复清单

- **整体评估**：这轮修复把 design pack 从“charter-ready but implementation-thin”推进到“可直接支撑 action-plan / implementation 拆分”的状态。最关键的变化不是字数变多，而是 **owner 已回答的问题被真正消费成冻结约束**，以及 **greenfield deliverable / schema / runtime / client proof 的 owner 与判定方法终于落盘**。
- **本轮新增/更新的关键内容**：
  1. **把 Q1-Q10 从 QnA 文本升级为设计约束**：所有相关 Z/ZX 文档都不再把这些项当开放问题。
  2. **补齐了 Z1-Z4 全量 `F*` 详细展开**：尤其是 Z1 WeChat/Tenant、Z3 usage/evidence、Z4 web/gap-triage/stateful hardening。
  3. **给 ZX-D1 增加字段级最小冻结、migration waves、ownership 与 payload discipline**。
  4. **给 ZX-binding 增加 current-vs-target topology、auth greenfield owner 与 RPC signature 草案**。
  5. **给 ZX-LLM 冻结 Workers AI binding/model 与 DeepSeek skeleton posture**。
  6. **给 ZX-NACP 冻结 authority translation 表、first-wave session message set 与 evidence linkage**。
  7. **把所有“✅ 一句话收口目标”补上判定方法**，降低后续 action-plan closure 的主观性。

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **对设计文件是否收口的判断**：`yes — 已收口到可进入 action-plan / implementation 的程度`
- **仍然保留的已知限制**：
  1. 本轮是 design absorption，不新增任何运行时代码；`workers/orchestrator-auth/`、`clients/web/`、`clients/wechat-miniprogram/`、Workers AI adapter 等仍待实施阶段落地。
  2. DO SQLite 的“4 组 hot-state”已经在 design 层冻结到对象组级别；若实施阶段需要更细的表/索引草案，应在 Z2 action-plan 内继续细化，而不是重新回滚整个 design pack。

---

## 8. 对 Opus 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-25`
> 评价依据: `docs/eval/zero-to-real/Z0-ZX-design-docs-reviewed-by-opus.md` §0–§6，尤其是 R1–R20 与其 blocker/follow-up 分层

### 8.1 一句话评价评审风格

Opus 这轮评审的风格是 **结构化、证据密集、对 design freeze 标准极其敏感**，能把“哪里还停留在 charter 级别、哪里还不足以直接拆 action-plan”讲得非常清楚。


### 8.2 优点
1. 它最强的地方是 **系统性**：不是只抓单点错误，而是把 `§7.2 未展开`、`ZX-D1 无字段清单`、`greenfield deliverable 无 owner` 这种会反复复现的结构性缺口一次性提出来。
2. 它的 **修法建议可执行性非常高**。很多建议几乎可以直接翻译成文档 patch，像 Workers AI binding/model 冻结、判定方法补齐、RPC signature 草案、schema waves 等都属于高价值反馈。


### 8.3 缺点
1. 个别 follow-up 有些 **过度扩张决策面**，例如建议继续把 ZX-qna 扩到 Q11–Q16；在 owner 已回填 Q1–Q10 后，这种路线的必要性就明显下降了。
2. 低优先级文档清洁项和高优先级 blocker 混在同一长报告里，虽然分层已经做得不错，但实际消费时仍需要实现者主动二次归并优先级。


### 8.4 对审查报告中的问题的清点

| 问题编号 | 原始严重程度 | 该问题的质量 | 分析与说明 |
|----|------|------|------------------|
| R1 | high | 极高 | 这是全轮最关键的结构性问题之一，直接指出 4 份 Z 文档 `§7.2` 系统性未展开且有编号错位。 |
| R2 | high | 极高 | 对 ZX-D1 仍停留在表名层的判断非常准确，也是后续修复量最大的 blocker 之一。 |
| R3 | high | 极高 | 对 `workers/orchestrator-auth/` greenfield deliverable 无 owner 的提醒非常关键，避免了后续 action-plan 把它当成“已存在 worker”。 |
| R4 | high | 极高 | 对 Workers AI binding/model 未冻结的指出非常精准，且直接对应到 Z3 可执行性。 |
| R6 | high | 极高 | 对“✅ 收口目标缺少判定方法”的批评非常到位，推动了整套 design 从修辞性 closure 转向可验证 closure。 |
| R7 | medium | 高 | JWT/AuthSnapshot/NACP 映射表的提醒质量很高，是典型 cross-cutting 真缺口。 |
| R13 | medium | 中等 | 当时建议补 Q11-Q16 有其逻辑，但在 owner 已完成 Q1-Q10 回填后，继续扩 QnA surface 的收益明显下降。 |
| R15 | low | 高 | `payload_json` redaction / size discipline 属于低优先但高质量的“以后很难补”的问题，值得被提早指出。 |


### 8.5 评分 - 总体 ** 9 / 10 **

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 10 | 事实引用密度很高，文件、行号、grep 和设计层关系都给得很足。 |
| 判断严谨性 | 9 | 大多数判断都经得起复核，少数建议只是略偏扩张而非错误。 |
| 修法建议可执行性 | 10 | 许多建议几乎可以直接翻译成具体 patch。 |
| 对 action-plan / design 的忠实度 | 9 | 整体非常忠实于 design freeze 语境，少数 follow-up 开始触及额外 QnA 扩张。 |
| 协作友好度 | 9 | 语气严格但专业，分 blocker / follow-up 的方式对执行者很友好。 |
