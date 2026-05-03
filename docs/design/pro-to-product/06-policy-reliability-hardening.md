# PP5 / Policy Honesty + Reliability Hardening

> 功能簇: `PP5 / Policy Honesty + Reliability Hardening`
> 讨论日期: `2026-05-02`
> 讨论者: `GPT-5.5`
> 关联调查报告:
> - `docs/charter/plan-pro-to-product.md`
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> 关联 QNA / 决策登记:
> - `docs/charter/plan-pro-to-product.md` §10 T6
> 文档状态: `draft`

---

## 0. 背景与前置约束

- **项目定位回顾**：前端需要可信 runtime controls；不能把“可 PATCH 的字段”误认为“执行层已 enforce 的策略”。
- **本次讨论的前置共识**：
  - PP5 已被 charter 收窄为 policy honesty + reliability hardening，不承担 API docs 最终 closure。
  - PP1-PP4 负责 HITL/context/reconnect/hook 主闭环，PP5 负责把这些闭环中的 policy/error/retry/降级口径拉直。
- **本设计必须回答的问题**：
  - 哪些 runtime 字段已经 enforce？哪些只是 durable config？
  - ask/deny/allow、hook、confirmation 的优先级如何诚实表达？
  - retry/fallback/system.error 如何成为前端可处理状态？
- **显式排除的讨论范围**：
  - 不新增复杂 policy language。
  - 不在 PP5 关闭所有 PP1-PP4 功能，只处理 policy/reliability truth。

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Policy Honesty + Reliability Hardening`
- **一句话定义**：把 runtime policy、错误、重试、fallback 与降级行为从“字段存在”收敛成“执行语义真实或明确 not-enforced”。
- **边界描述**：包含 runtime config honesty、tool permission decision order、network/web/workspace 字段 enforce 状态、LLM retry/fallback、system.error、latency alert；不包含新 policy DSL、新 provider ecosystem、新 UI。

| 术语 | 定义 | 备注 |
|------|------|------|
| `policy honesty` | API 字段必须说明是否执行层 enforce | 不能 overclaim |
| `runtime config` | `/sessions/{id}/runtime` 返回的 durable config | 当前已 D1-backed |
| `decision order` | session rule → tenant rule → approval policy | 当前工具授权已实现 |
| `degraded` | 系统不能满足完整语义时的显式状态 | system.error/notify/docs |
| `stream retry` | streaming LLM 失败后的重试行为 | 当前不同于 non-stream |

### 1.2 参考调查报告

- `clients/api-docs/runtime.md` — runtime config current docs。
- `docs/design/pro-to-product/02-hitl-interrupt-closure.md` — ask 必须进 HITL。
- `docs/design/pro-to-product/05-hook-delivery-closure.md` — hook/policy 优先级。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

PP5 是防止产品化阶段“假能力”外泄的最后一道实现闸。它不追求再堆更多字段，而是检查已有字段是否真的改变 runtime behavior：`approval_policy` 已参与工具授权；`permission_rules` 已按 session/tenant 匹配；但 `network_policy`、`web_search`、`workspace_scope` 是否被各执行层 enforce 需要逐项证明或明确标为 config-only / not-yet-enforced。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| `02-hitl-interrupt-closure` | `06 ↔ 02` | 强 | `ask` fallback 必须接 confirmation，而非 error |
| `03-context-budget-closure` | `06 ↔ 03` | 中 | context failure/compact failed 需要 degraded |
| `04-reconnect-session-recovery` | `06 ↔ 04` | 强 | replay_lost/system.error 影响恢复 UX |
| `05-hook-delivery-closure` | `06 ↔ 05` | 强 | hook block 与 policy deny 优先级 |
| `07-api-contract-docs-closure` | `06 → 07` | 强 | PP6 必须记录 enforce 状态 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Policy Honesty + Reliability Hardening` 是 **执行语义对账层**，负责 **把 runtime controls、retry/fallback、system.error 与降级状态对齐真实执行行为**，对上游提供 **可信策略控制**，对下游要求 **docs 不把 config-only 字段写成 enforced capability**。

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 新 policy DSL | runtime config 诱因 | 当前已有 rules + approval policy | 企业策略阶段 |
| 新 web/network sandbox | Codex precedent | PP5 只 harden现有字段 | dedicated sandbox phase |
| 完整 provider routing system | LLM reliability 诱因 | 先修 retry/fallback truth | provider platform phase |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 | 第一版行为 | 未来可能的演进方向 |
|--------|----------|------------|---------------------|
| `network_policy.mode` | runtime field | config truth / limited enforcement | network sandbox |
| `web_search.mode` | runtime field | config truth / not-enforced unless proven | web tool integration |
| `workspace_scope.mounts` | runtime field | config truth / path law tie-in | mount ACL |
| `system.error.retryable` | structured error | frontend retry/report | policy-aware retry |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：runtime config persistence 与 runtime enforcement。
- **解耦原因**：字段可读写不等于每个 executor 已使用该字段。
- **依赖边界**：docs/API 必须分别标明 `configured`、`enforced`、`not-yet-enforced`。
- **D1 纪律**：PP5 默认 zero migration；若 enforce matrix 证明需要 schema 例外，只能按 charter §4.5 申请 `018+`，不能在 hardening 过程中静默扩列。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：tool authorization decision。
- **聚合形式**：`authorizeToolUse()` 是工具 policy 的单一主入口；hook 与 confirmation 只能在此链路中明确排序，不能另起旁路。
- **为什么不能分散**：多入口会产生前端看到 allow 但 executor deny 的矛盾。

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 gemini-cli 的做法

- **实现概要**：Gemini policy engine 对工具 call 做 check，client-initiated ask 可 implicit allow，non-interactive ask 会明确报错，confirmation outcome 可更新 policy。
- **亮点**：
  - `ASK_USER` 且 client initiated 时可按规则转 allow（`context/gemini-cli/packages/core/src/scheduler/policy.ts:76-88`）。
  - `ASK_USER` 且 non-interactive 会直接抛出 unsupported confirmation 错误（`context/gemini-cli/packages/core/src/scheduler/policy.ts:90-102`）。
  - confirmation outcome 可持久化到 workspace/user policy scope（`context/gemini-cli/packages/core/src/scheduler/policy.ts:114-184`）。
- **值得借鉴**：policy 必须知道运行环境是否能 ask；不能假装可交互。
- **不打算照抄的地方**：不把 policy persistence 做成本地 workspace files；nano-agent 用 D1 runtime config。

### 4.2 codex 的做法

- **实现概要**：Codex 明确 approval policy 何时禁止把 prompt 展示给用户，并对 network deny 给出可读 reason。
- **亮点**：
  - `prompt_is_rejected_by_policy()` 返回明确 rejection reason（`context/codex/codex-rs/core/src/exec_policy.rs:124-153`）。
  - network approval context 只在 ask payload 完整时生成（`context/codex/codex-rs/core/src/network_policy_decision.rs:26-44`）。
  - denied network request 会输出 user-facing detail（`context/codex/codex-rs/core/src/network_policy_decision.rs:46-72`）。
- **值得借鉴**：deny/ask 的 reason 是产品 contract，不是 debug log。
- **不打算照抄的地方**：不在 PP5 新建完整 network proxy。

### 4.3 claude-code 的做法

- **实现概要**：Claude Code 的 permission hook 将 allow/deny/ask 分支显式终结，ask 可进入 coordinator/swarm/interactive，错误/abort 也变 cancel。
- **亮点**：
  - allow 分支记录 accept 并 resolve allow（`context/claude-code/hooks/useCanUseTool.tsx:37-53`）。
  - deny 分支记录 reject 并 resolve terminal result（`context/claude-code/hooks/useCanUseTool.tsx:64-91`）。
  - ask 分支进入多层决策，最终 interactive callback resolve（`context/claude-code/hooks/useCanUseTool.tsx:93-168`）。
  - abort/error 转 cancelAndAbort（`context/claude-code/hooks/useCanUseTool.tsx:171-180`）。
- **值得借鉴**：每个 policy 分支必须有终态。
- **不打算照抄的地方**：不引入 classifier/swarm 权限系统。

### 4.4 横向对比速查表

| 维度 | gemini-cli | codex | claude-code | nano-agent 倾向 |
|------|------------|-------|-------------|------------------|
| tool decision | policy engine | exec policy | permission result | runtime rules + approval policy |
| ask support | interactive gated | approval policy gated | interactive callback | HITL confirmation |
| deny reason | policy denial | network detail | decision reason | structured error / confirmation |
| retry/fallback | stream errors | retry/notify | recovery/cancel | LLM executor + system.error |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1] Runtime field enforce matrix** — 每个 runtime 字段标明 enforced/config-only。
- **[S2] Tool policy decision order** — session rule → tenant rule → approval policy → HITL/hook。
- **[S3] Streaming reliability honesty** — non-stream retry 与 stream retry 差异必须处理或标注。
- **[S4] Structured degraded errors** — system.error / error-index 让前端能 retry/report。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1] 新 policy DSL** — 复用现有 rule shape。
- **[O2] 完整 network proxy** — 不在 PP5 临时造。
- **[O3] 完整 SDK retry abstraction** — 由前端/SDK后续承接。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `approval_policy` | enforced for tool auth | `authorizeToolUse` fallback 使用 | PP5/PP6 |
| `permission_rules` | enforced for tool auth | session/tenant matching 使用 | PP5 |
| `network_policy` | must prove or mark config-only | 当前 PATCH/GET 存在，不等于执行层使用 | PP5 |
| `web_search` | must prove or mark config-only | 当前字段存在 | PP5 |
| `workspace_scope` | partial/prove | filesystem path law 另有实现，但需与 mounts 对齐 | PP5 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **honesty matrix** 而不是 **删除未 enforce 字段**
   - **为什么**：字段已有 public contract，删除会破坏前端；但 overclaim 更危险。
   - **我们接受的代价**：docs/API 多一层状态。
   - **未来重评条件**：字段全部 enforce 后收敛标注。

2. **取舍 2**：我们选择 **统一 tool auth 入口** 而不是 **hook/confirmation 分散决策**
   - **为什么**：分散决策会造成 allow/deny 矛盾。
   - **我们接受的代价**：PP1/PP4/PP5 action-plan 必须协调优先级。
   - **未来重评条件**：policy engine 抽成独立模块。

3. **取舍 3**：我们选择 **stream reliability 明示** 而不是 **假设 non-stream retry 覆盖 stream**
   - **为什么**：当前 `execute()` 有重试，`executeStream()` 失败后直接 throw。
   - **我们接受的代价**：需要补 stream retry 或 docs 标注。
   - **未来重评条件**：stream retry 实现并测试。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| runtime 字段 overclaim | docs 写成已 enforce | 前端错误安全假设 | enforce matrix + PP6 sweep |
| ask 仍返回 error | PP1 未闭合 | HITL UX 断 | PP5 不得把 ask 写成已完成 |
| retry 行为不一致 | stream path 无 retry | 长请求中断 | system.error + retry strategy |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：避免把 durable config 与执行能力混淆。
- **对 nano-agent 的长期演进**：为后续 policy engine/network sandbox 留出明确迁移路径。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：所有复杂能力都需要可靠的错误/降级/策略表达。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Runtime Enforce Matrix | 字段逐项标注 enforce 状态 | ✅ 不再 overclaim |
| F2 | Tool Policy Chain | 统一 allow/deny/ask 优先级 | ✅ 工具授权可解释 |
| F3 | Reliability Error Contract | retries/fallback/system.error 对齐 | ✅ 前端能处理失败 |
| F4 | Latency Alert Discipline | charter latency baseline 落证据 | ✅ 慢路径可观测 |

### 7.2 详细阐述

#### F1: Runtime Enforce Matrix

- **输入**：`/runtime` config fields 与执行代码。
- **输出**：enforced/config-only/not-yet-enforced matrix。
- **主要调用者**：PP6 docs、frontend。
- **核心逻辑**：GET/PATCH/ETag 证明字段可配置；必须进一步证明执行层读取该字段。验证方法必须逐字段写清：例如 `network_policy` / `web_search` / `workspace_scope.mounts` 都要沿 agent-core、bash-core、filesystem-core、facade route 的实际消费链反查，而不是只凭字段存在与否做口头判断。
- **边界情况**：`workspace_scope` 可能由 filesystem path law 部分 enforce，但 mounts 语义仍需核对。
- **一句话收口目标**：✅ **字段存在与字段生效不再混淆。**

#### F2: Tool Policy Chain

- **输入**：tool name/input、session rules、tenant rules、approval policy、hook/confirmation。
- **输出**：allow/deny/ask terminal 或 pending。
- **主要调用者**：agent-core tool execution。
- **核心逻辑**：`authorizeToolUse()` 当前按 session rule → tenant rule → approval policy fallback；PP5 要把 ask 接 PP1，把 hook 接 PP4，并写明优先级。
- **边界情况**：db missing 当前返回 `ask/unavailable`，随后被 runtime 翻译成 `tool-permission-required` error；PP5 必须把这类 unavailable 明确改成 fail-visible（structured `system.error` 或 explicit unavailable degraded），不能借 PP1 的正常 ask interrupt 语义吞掉控制面故障。
- **一句话收口目标**：✅ **每次工具执行都有解释来源。**

#### F3: Reliability Error Contract

- **输入**：LLM executor error、system.error registry、fallback/model errors。
- **输出**：retryable structured error 或 fallback frame。
- **主要调用者**：agent-core、frontend。
- **核心逻辑**：non-stream executor 有 retry/backoff/429 key rotation；stream executor 目前失败直接 throw，需补齐或标注。
- **边界情况**：context_length 应走 PP2 compact/degraded，而不是盲重试。
- **一句话收口目标**：✅ **失败不是 unknown crash。**

#### F4: Latency Alert Discipline

- **输入**：permission/elicitation/retry/reconnect/compact path timings。
- **输出**：alert threshold evidence。
- **主要调用者**：observability/debug endpoints。
- **核心逻辑**：charter §9.2 定义 alert threshold，不是 hard exit；PP5 要确保慢路径能被观测。
- **边界情况**：preview 环境 jitter 不应直接作为 failed gate。
- **一句话收口目标**：✅ **慢路径有证据，不被误判成功。**

### 7.3 非功能性要求与验证策略

- **性能目标**：沿用 charter latency baseline。
- **可观测性要求**：system.error、trace_uuid、retry/fallback reason、policy source。
- **稳定性要求**：policy unavailable 不得 silent allow；stream failure 不得吞。
- **安全 / 权限要求**：runtime PATCH auth/session ownership/ETag 必须保留。
- **测试覆盖要求**：runtime conflict、policy chain、config-only matrix、stream/non-stream retry behavior、system.error emission。
- **验证策略**：worker unit + integration + live/e2e targeted probes。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/packages/core/src/scheduler/policy.ts:76-88` | client-initiated ASK_USER implicit allow | policy 根据上下文分支 | |
| `context/gemini-cli/packages/core/src/scheduler/policy.ts:90-102` | non-interactive ask throws | 不能假装可交互 | |
| `context/gemini-cli/packages/core/src/scheduler/policy.ts:114-184` | confirmation outcome updates policy | decision 可持久化 | |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/core/src/exec_policy.rs:124-153` | approval policy rejects prompt | ask gating | |
| `context/codex/codex-rs/core/src/network_policy_decision.rs:26-44` | network approval context | payload completeness | |
| `context/codex/codex-rs/core/src/network_policy_decision.rs:46-72` | denied network detail | user-facing denial | |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/hooks/useCanUseTool.tsx:37-53` | allow terminal branch | explicit terminal | |
| `context/claude-code/hooks/useCanUseTool.tsx:64-91` | deny terminal branch | deny reason/logging | |
| `context/claude-code/hooks/useCanUseTool.tsx:93-168` | ask interactive branch | HITL branch | |
| `context/claude-code/hooks/useCanUseTool.tsx:171-180` | abort/error cancel | no hanging policy promise | |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `workers/orchestrator-core/src/facade/routes/session-runtime.ts:27-104` | runtime PATCH validation | config surface |
| `workers/orchestrator-core/src/facade/routes/session-runtime.ts:200-265` | If-Match/ETag + runtime.update | optimistic lock |
| `workers/orchestrator-core/src/runtime-config-plane.ts:51-64` | default runtime values | default truth |
| `workers/orchestrator-core/src/entrypoint.ts:330-379` | tool auth decision order | enforced policy |
| `workers/agent-core/src/host/runtime-mainline.ts:252-260` | ask currently maps to error | PP1/PP5断点 |
| `workers/agent-core/src/llm/executor.ts:59-132` | non-stream retry/backoff | reliability precedent |
| `workers/agent-core/src/llm/executor.ts:134-198` | streaming path throws without retry loop | reliability gap |
| `packages/nacp-core/src/observability/logger/system-error.ts:41-67` | system.error structured event | frontend error contract |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| D-06-1 | config-only 字段是否保留？ | PP5/PP6 | 保留但标明 not-enforced | proposed | 本设计 |
| D-06-2 | stream retry 是否必须与 non-stream 对齐？ | PP5 | 至少补 retry/error honesty | proposed | 本设计 |
| D-06-3 | policy unavailable 是否允许 fallback allow？ | PP5 | 不允许 silent allow | proposed | 本设计 |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. runtime fields enforce matrix 完成。
2. tool policy chain 与 HITL/hook 优先级明确。
3. retry/fallback/system.error 可被前端处理。
4. latency baseline 有可观测路径，且不被误写成 hard gate。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/pro-to-product/PP5-policy-reliability-hardening-action-plan.md`
- **需要同步更新的设计文档**：
  - `07-api-contract-docs-closure.md` 的 runtime/error docs sweep。
- **需要进入 QNA register 的问题**：
  - 无；`PPX-qna.md` Q19 已是 stream retry 的唯一决策来源。PP5 action-plan 只能把选定路径执行化，不能保留语义 ambiguity 进入 closure。

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

`Policy Honesty + Reliability Hardening` 是一个“少做但必须说真话”的阶段。它不应该继续堆字段，而要把所有已有字段和失败路径逐项核成：已 enforce、config-only、not-yet-enforced、degraded。只有这样，前端才不会基于错误的安全/可靠性假设开发。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 前端可信必须依赖 policy/error truth |
| 第一版实现的性价比 | 4 | 多为对账与补桥，但跨模块 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | 5 | policy/reliability 是所有能力底座 |
| 对开发者自己的日用友好度 | 4 | 降低假安全/假可靠性 |
| 风险可控程度 | 4 | honesty matrix 降低 overclaim 风险 |
| **综合价值** | 5 | P0 必做 |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：是否把所有 runtime 字段都视为已 live。
  - **A 方观点**：字段可 PATCH，前端就可以用。
  - **B 方观点**：只有执行层读取并改变行为才算 enforce。
  - **最终共识**：PP5 以 enforce matrix 作为 truth，不删除字段但禁止 overclaim。

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-05-02` | `GPT-5.5` | 初稿 |
