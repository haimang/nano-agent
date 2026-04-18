# After-Skeleton 10 份 Action-Plan · E2E 链条簇评审

> 审查对象: `docs/action-plan/after-skeleton/A1-A10` 共 10 份 ~4,058 行
> 审查人: `Claude Opus 4.7 (1M context)`
> 审查时间: `2026-04-18`
> 审查依据:
> - `packages/**` 当前代码事实（18 条命题逐一 spot-check）
> - `context/smcp/` + `context/safe/` — `trace_uuid` vs `trace_id` 对标
> - `context/just-bash/` — fake bash 可 port 的实现参考
> - `context/{claude-code, codex, mini-agent}/` — 3 个 agent-CLI
> - `docs/design/after-skeleton/PX-QNA.md` 全部 20 条业主答案（含 Q8 反转）
> - `docs/plan-after-skeleton.md` 指导文件
> - 前置评审 `docs/eval/after-skeleton-design-reviewed-by-opus.md`

---

## 0. 总结结论（TL;DR）

- **整体判断**：`approve-with-staged-followups` —— 10 份 action-plan 在 **结构性、可执行性、对 QNA 的响应度** 三个维度都达到 **production-grade**。GPT 精确把业主在 PX-QNA 中的 20 条决策（包括 Q8 multi-round 反转）全部拉进 action-plan；DAG 依赖图（A1 → 其他 + A7/A8/A9/A10 尾部）无环无悬；每份 A 文件都产出 In-Scope/Out-of-Scope/边界判定/工作总表/Phase 详情/风险/DoD 六段完整结构。
- **主要缺口**：存在 **2 条 CRITICAL 级阻塞性决策漏空**（A1 Q1 follow-up family shape 与 A9 P3-01 ts-exec substrate 决策），以及 **7 条 HIGH 级执行前需要 owner 再次拍板或补 artifact 的项目**。若这些在 Phase 启动前不解决，A1/A9 会在 Phase 1 或 Phase 3 被自己"先等决策"的逻辑卡住。
- **Ground Truth 对齐度**：`17/18` 命题命中（见 §2.1），仅 "`trace_uuid` 在 repo 已有占比" 的数据存在偏差（实测 `trace_id` 40 处，`trace_uuid` 仅 10 处 — **A1 rename batch 的工作量比文档暗示大**）。

### 0.1 关键判断（按风险递减）

1. **A1 里 follow-up input family shape 仍在 Q1 待业主决策**，但 A1 P3-01 (Session Message Family Widening) 直接依赖它。若 owner 不在 A1 Phase 1 结束前给出 shape，Phase 3 会被自己的依赖卡住。
2. **`trace_uuid` 全局 rename 比 action-plan 描述的规模大**。spot-check 发现 `trace_id` 在 `packages/` 里有 **40 处** 而不是"若干 trace 字段"。A1 影响目录树列出 3 个核心 package，但实际波及面更广。
3. **A3 P3-01 Recovery Law 只列了 4 类错误**（`anchor-missing / anchor-ambiguous / compat-unrecoverable / cross-seam-trace-loss`），而我的 design review §C3 明确要求 **8-10 类场景**。工程深度仍然不足。

---

## 1. 评估方法论: E2E 链条簇模型

### 1.1 为什么不按 A1-A10 单列评估

10 份 action-plan 不是 10 条独立工作——它们构成 **一个 DAG**。按编号单列评估会错过 **链条级风险**：上游 action-plan 的延期会以复合方式传导到下游。

### 1.2 四条 E2E 链条簇

我把 10 份 action-plan 折叠成 4 条 E2E 链条，每条覆盖一个端到端业务语义：

```
Chain A · Contract/Identity Flow
  A1 ─────► A2 ─────► A3 ─────► A7
  (合同冻结)  (trace 物理基座)  (trace carrier/recovery)  (evidence 闭环)

Chain B · Runtime Closure Flow
  A1 ─────► A3 ─────► A4 ─────► A5 ─────► A6
  (合同)    (trace law)  (session 边界)  (external seam)  (deploy 验证)

Chain C · Verification/Evidence Flow
  A5 ─────► A6 ─────► A7
  (external seam)  (L1/L2 smoke)  (evidence pack)

Chain D · Capability/Fake Bash Flow
  A7 ─────► A8 ─────► A9 ─────► A10
  (evidence 基线)  (workspace/search)  (network/script)  (VCS/治理)
```

### 1.3 每条链条的评估维度

- **链条完整性**：上游输出是否满足下游输入？
- **Ground Truth 锚定**：是否与 `packages/` 代码事实一致？
- **QNA 响应度**：是否正确消费业主 PX-QNA 答案？
- **context/ 对标准确性**：是否正确引用 smcp/safe/just-bash/agent-CLI？
- **可执行性**：Phase 切分、任务编号、收口标准是否可直接开工？
- **风险可控性**：关键决策点是否都有答案？

---

## 2. Ground Truth 基线

### 2.1 `packages/` 代码事实（18 条命题）

| # | 命题 | 验证结果 |
|---|---|---|
| 1 | `nacp-session` 只有 6 个 session message families，无 follow-up 家族 | ✅ `messages.ts:56-84` |
| 2 | `turn-ingress.ts` 除 `session.start` 外其他消息都返回 null | ✅ `turn-ingress.ts:75-104` |
| 3 | `NacpTraceSchema` 字段还是 `trace_id`（不是 `trace_uuid`） | ✅ `envelope.ts:114-121` |
| 4 | **repo 内 `trace_id` 出现 40 次，`trace_uuid` 出现 10 次** | ⚠️ 规模比 action-plan 暗示大 |
| 5 | `producer_id / consumer_hint / stamped_by / reply_to / stream_id / span_id` 全部以 legacy 名字存在 | ✅ `envelope.ts:83-178` |
| 6 | `compat/migrations.ts` 仍是 placeholder | ✅ 只有 migrate_noop + migrate_v1_0_to_v1_1 throw stub |
| 7 | `normalizeClientFrame()` 已公开 export | ✅ `ingress.ts:25` |
| 8 | `webSocketMessage()` 仍然 raw JSON.parse + switch | ✅ `nano-session-do.ts:205,215` |
| 9 | `wrangler.jsonc` 仅有 `SESSION_DO` binding | ✅ |
| 10 | `ServiceBindingTransport` 接口已公开 | ✅ `service-binding.ts:81-84` |
| 11 | `hooks/ServiceBindingRuntime` 仍抛 "not yet connected" | ✅ |
| 12 | `DoStorageTraceSink` key 格式 = `tenants/{teamUuid}/trace/{sessionUuid}/{date}.jsonl` | ✅ `do-storage.ts:42` |
| 13 | `PLACEMENT_HYPOTHESES` 存在 + 全部 provisional | ✅ `placement.ts:108-124` |
| 14 | `StoragePlacementLog` 目前 **仅用于 tests**，无 runtime emitter | ⚠️ A7 必须补 runtime wiring |
| 15 | 12 个 minimal commands 已注册 | ✅ `pwd/ls/cat/write/mkdir/rm/mv/cp/rg/curl/ts-exec/git` |
| 16 | `capabilities/search.ts` 的 `rg` 仍是 degraded TS scan stub | ✅ `search.ts:24-41` |
| 17 | `parseSimpleCommand()` 只支持简单 argv，无 pipes/redirects | ✅ `planner.ts:16` 注释 |
| 18 | `test/` 有 8 mjs、`test/e2e/` 有 14 mjs | ✅ |

**结论**：action-plan 对 repo 现状的描述 **17/18 命题完全命中**，仅在 `trace_id` 实际占比上描述得偏轻。

### 2.2 业主 PX-QNA 答案（20 条）

| Q | 答案 | 关键影响 |
|---|---|---|
| Q1 | 确认 + **trace_uuid 全局使用** | A1 必须做全仓 rename |
| Q2 | 确认 | Freeze Matrix 四档是审阅语言 |
| Q3 | 确认 | `stamped_by_key` / `reply_to_message_uuid` 进 A1 批次 |
| Q4 | 确认 | `1.0.0` = provisional，`1.1.0` = frozen |
| Q5 | 确认 + **同意 Opus benchmark 要求** | A2 必须产 `trace-substrate-benchmark.md` |
| Q6 | 确认 | `TraceEventBase.traceUuid` 必须有 |
| Q7 | 确认 | Anchor / Durable / Diagnostic 是 conceptual layering |
| **Q8** | **反转 — 采纳 Opus 建议，multi-round follow-up 进 Phase 0** | **A1 P1-03 / P3-01 必须冻结 follow-up shape** |
| Q9 | 确认 | SKILL_WORKERS 仍 reserved |
| Q10 | 确认 | P5 是 verification gate |
| Q11 | 确认 | hybrid：L1=`dev --remote`, L2=`deploy + smoke` |
| Q12 | 确认 | `gpt-4.1-nano` golden path |
| Q13 | 确认 | P6 四档 verdict |
| Q14 | 确认 | P6 / PX 术语永久分离 |
| Q15 | 确认 | `rg` 是 canonical |
| **Q16** | **确认 — grep→rg alias 尽早做** | A8 P3-02 必须在 Phase 3 做 |
| Q17 | 确认 | curl richer options 只走 structured |
| Q18 | 确认 | git v1 = `status/diff/log` only |
| Q19 | 确认 | 5 级 + ask-gated |
| Q20 | 确认 | D1 升格必须先出 benchmark memo |

**结论**：action-plan 对 20 条答案全部正确消费。**特别要点**：Q8 的反转（multi-round follow-up 进 Phase 0）已被 A1 明确纳入 P1-03 + P3-01（Session Message Family Widening），但 **Q1 follow-up family shape 仍在 A1 §6.1 Q1 待拍板** —— 这是 action-plan 自己埋下的 CRITICAL 阻塞点。

### 2.3 context/ 对标验证

| 对标对象 | action-plan 引用情况 | 准确性 |
|---|---|---|
| **smcp** `trace_uuid`（optional in control_payload） | A1/A3 引用 | ⚠️ smcp 的 `trace_uuid` 是 **optional**，不是 required；业主选了 smcp 的 **命名** 但 Safe 的 **严格度**（见 §6 MID-2） |
| **safe** `trace_id`（required in SafeTrace） | A3 间接引用 | ✅ 严格度继承，命名被 owner 覆盖 |
| **just-bash** mount-based FS + `rg` | A8 引用 `mountable-fs.ts:49-220` + `rg/rg.ts` | ✅ 作为 upper bound，不作为 v1 承诺 |
| **codex** `tool_registry_plan.rs` + `trace_context.rs` | A4/A5/A10 多次引用 | ✅ registry-first 思维贯穿 |
| **claude-code** `toolExecution.ts` + `microCompact.ts` + `toolHooks.ts` | A5/A7/A9 引用 | ✅ 高风险治理 + compact lifecycle + queue-before-sink |
| **mini-agent** `logger.py` | A2/A3/A7 作为反例 | ✅ "无 trace law 时只能人肉排查" |

---

## 3. Chain Cluster A — Contract / Identity Flow (A1 → A2 → A3 → A7)

### 3.1 链条业务含义
从 **合同冻结** 走到 **trace carrier 完整** 再到 **storage/context evidence 闭环**。这是 nano-agent 可治理性的主干。

### 3.2 链条完整性核查

| 上游输出 → 下游输入 | 是否衔接 |
|---|---|
| A1 P2-01 Core Schema Rename → A2 P3-02 Recovery Probe（使用 checkpoint + `trace_uuid`） | ✅ 衔接 |
| A1 P3-01 Session Family Widening → A2 benchmark runner 场景 `restart-readback` | ⚠️ **A2 场景未显式覆盖 follow-up family ingestion 的 benchmark** |
| A2 P4-02 Decision & Gate → A3 P1-01 Trace Law Matrix | ✅ A3 明确声明依赖 "Phase 1 substrate decision" |
| A3 P2-01 Audit Codec → A7 P2-02 Placement-to-Calibration Bridge（依赖 trace carrier 完整） | ✅ 衔接 |
| A3 P4-01 Cross-package Instrumentation Sweep → A7 P3-01/P3-02/P3-03/P3-04 evidence streams | ✅ 衔接 |
| A7 P4-01 五类 verdict → **下一阶段 API/data design** | ⚠️ **无下游 action-plan 承接**（这是预期的，因为 after-skeleton 止于 A10）|

### 3.3 Ground Truth 锚定

- A1 §0 写 `trace_id/stream_id/span_id` 漂移 — ✅ 与 `envelope.ts:114-121` 一致
- A2 §0 写 `DoStorageTraceSink` 已有 `tenants/{teamUuid}/trace/...` — ✅ 与 `do-storage.ts:42` 一致
- A3 §0 写 `TraceEventBase` 缺 `traceUuid` — ✅ 与 `trace-event.ts:13-27` 一致
- A7 §0 写 `StoragePlacementLog` 基本只在 tests 存在 — ✅ 与 spot-check §2.1 #14 一致

### 3.4 链条风险评估

- **CRITICAL**: A1 Q1（follow-up family shape）未决时，A1 P1-03 无法产出 micro-spec，P3-01 无法冻结。链条起点就可能卡住。
- **HIGH**: A1 rename batch 波及面被低估（40 处 `trace_id` + 可能的 stream_id/span_id 占比），A1 Phase 1 工作量估计偏小（`S`）。
- **HIGH**: A3 Phase 3 Recovery Law 仍只列 4 类错误，我的 design review §C3 要求 8-10 类场景 —— 仍未扩充。
- **MID**: A7 P4-01 的 5 类 verdict × 4 级 = 20 个单元，但 action-plan 没给 "assembly 的 evidence-backed 具体是什么条件" 的 matrix。

---

## 4. Chain Cluster B — Runtime Closure Flow (A1 → A3 → A4 → A5 → A6)

### 4.1 链条业务含义
从 **合同** 走到 **Cloudflare-native runtime 真的可被部署验证**。这是 nano-agent 可用性的主干。

### 4.2 链条完整性核查

| 上游输出 → 下游输入 | 是否衔接 |
|---|---|
| A1 P3-02 Session Rename → A4 P1-02 Normalized Ingress Pipeline | ✅ 衔接（`normalizeClientFrame()` 消费 renamed frame） |
| A3 P1-02 TraceEvent Upgrade → A4 P4-01 Edge Trace Wiring | ✅ 衔接 |
| A4 P2-02 SessionWebSocketHelper Wiring → A5 P2-03 Session Runtime Hook/Capability Composition | ✅ 衔接（Session DO 已有 helper reality 后，才能装 composition） |
| A5 P1-01 Binding Catalog Freeze → A6 P1-02 Profile & Binding Matrix Freeze | ✅ 衔接 |
| A5 P3-01 Fake Provider Worker Contract → A6 P4-01 Real Provider Golden Path | ✅ 衔接（fake 与 real 都走 OpenAI-compatible） |

### 4.3 Ground Truth 锚定

- A4 §0 精确引用 `webSocketMessage() 仍是 raw JSON.parse + switch` — ✅
- A4 §0 说 `WsController` / `HttpController` 仍是 stub — ✅
- A5 §0 说 `CompositionFactory` 默认返回 `undefined` handles — ✅
- A5 §0 说 hooks `ServiceBindingRuntime` 抛 "not yet connected" — ✅
- A6 §0 说仓内只有一份 `wrangler.jsonc` 且只有 `SESSION_DO` — ✅

### 4.4 链条风险评估

- **HIGH**: A4 scope 很大 —— 包括 `webSocketMessage()` 重写 + `WsController/HttpController` 装配 + `turn-ingress.ts` 消费 widened session + edge trace wiring + 5 类 integration tests。总工作量估计 `M+M+M+M+S` 偏小，可能需要 `L+L+M+M+S`。
- **HIGH**: A5 P3-01 fake provider worker 放在 `test/fixtures/external-seams/fake-provider-worker.ts` —— 但 **这是一个 fixture .ts 文件，不是独立的 wrangler Worker 项目**。要在 `wrangler dev --remote` 里被 service-binding 调用，需要独立的 Worker 部署结构。A5/A6 没讨论如何把它打包成真正的 Cloudflare Worker。
- **HIGH**: A6 P4-01 Real Provider Golden Path 需要 OpenAI API Key，但 action-plan **没指明 secret 注入机制**（是 wrangler secrets？是 env var？是 owner-local `.env` 文件？）。这是 Phase 4 启动前必须敲定的执行细节。
- **MID**: A5 P4-03 "Startup Queue / Early Event Guard" 说"位置在 session runtime composition / eval seam" —— **实际位置仍未决**（design review M5 已指出）。
- **MID**: A4 的 Phase 3 "HTTP Fallback Closure" 没给 polling interval / back-pressure 的具体数字，执行时还要再决策。

---

## 5. Chain Cluster C — Verification / Evidence Flow (A5 → A6 → A7)

### 5.1 链条业务含义
**external seam 真实运行 → L1/L2 真实 smoke → 真实证据进 evidence pack**。这是 nano-agent "不自证" 的主干。

### 5.2 链条完整性核查

| 上游输出 → 下游输入 | 是否衔接 |
|---|---|
| A5 P5-02 Docs / Profile / P5 Handoff Pack → A6 P1-01 Verification Ladder Freeze | ✅ 衔接 |
| A6 P4-02 Real Cloud Binding Spot-check → A7 P2-03 Placement Spot-check Integration | ✅ 衔接 |
| A6 P5-02 P6 Handoff Evidence Pack → A7 Phase 1 输入 | ✅ 显式衔接 |
| A7 P4-02 Real Storage Spot-check 依赖 A6 real bundle | ✅ |

### 5.3 链条风险评估

- **HIGH**: 这条链条的 total cost 严重依赖 L2 real smoke 的成本。A6 L2 是 `wrangler deploy + workers.dev smoke`，每次 iteration ~10s deploy + provider call 成本 + 可能的 rate limit。如果 A6 Phase 4 遇到 provider 失败或 binding 失败，会 **反向阻塞** A7 evidence closure。
- **MID**: A7 Phase 4 P4-03 "Threshold / Revisit Rules" 写的是 "maintain / needs-revisit / contradicted-by-evidence 的阈值与触发条件" —— 但 **没给具体阈值**（比如 "connect 3 条 evidence 后升格为 evidence-backed"）。
- **LOW**: A6 没有约定 `green / yellow / red` 的判定阈值（例如 "0 失败 = green，1-2 partial failure = yellow"），只说"有 verdict"。

---

## 6. Chain Cluster D — Capability / Fake Bash Flow (A7 → A8 → A9 → A10)

### 6.1 链条业务含义
**evidence 基线 → workspace/search 冻结 → network/script 冻结 → 治理收口**。这是 nano-agent 对 LLM 友好度的主干。

### 6.2 链条完整性核查

| 上游输出 → 下游输入 | 是否衔接 |
|---|---|
| A7 P3-01 Context Assembly Evidence → A8 P4-02 Snapshot / Evidence Alignment | ✅ 衔接 |
| A7 P3-03 Artifact Lifecycle → A9 P3-03 Script Output Boundaries（promotion 复用） | ✅ 衔接 |
| A8 P1-02 Search Canon & Disclosure Sync → A9/A10 capability disclosure | ✅ 共用 PX inventory |
| A8 workspace truth → A10 P2-03 Readonly Workspace Alignment for git | ✅ |

### 6.3 Ground Truth 锚定

- A8 §0 明确 `rg` 仍是 degraded TS scan stub — ✅ 与 `search.ts:24-41` 一致
- A8 §0 明确 `mkdir` 只是 compatibility ack — ✅
- A9 §0 明确 `capabilities/network.ts` 只 URL 校验 + stub 文案 — ✅
- A9 §0 明确 `capabilities/exec.ts` 只 code length ack — ✅
- A10 §0 明确 `vcs.ts` 只 `status/diff/log` stubs — ✅

### 6.4 链条风险评估

- **CRITICAL**: A9 P3-01 "ts-exec Substrate Decision" 是一个 **major architectural decision**（本地 sandbox / 远程 tool-runner / 保守 partial 三选一），action-plan 把它放在 Phase 3 内部作为工作项。**这个决策应该在 P7b Phase 3 启动前作为 owner decision 解决**，否则 A9 Phase 3 会停在决策讨论。
- **HIGH**: A8 P2-02 "`mkdir` Partial Closure" 同样是个 "补 primitive / 保留 ack" 二选一决策，放在 Phase 2 内部。建议也前置到 Phase 1 freeze。
- **HIGH**: A9 P2-03 "Egress Guard & Timeout Policy" 说要 block "private address / localhost"，但没给 RFC1918 IP ranges 的实际列表（`10.0.0.0/8 / 172.16.0.0/12 / 192.168.0.0/16 / 169.254.0.0/16 / fc00::/7 / ::1`）。Worker fetch 底层的行为也需 benchmark。
- **MID**: A10 P4-01 "Inventory Drift Guard" 的实现形式未决（lint 脚本 vs manual review checklist）。
- **MID**: A8 没讨论 `rg` 的 **输出截断算法** —— P3-03 "Bounded Search Output" 说"超界结果可转 ref"，但没给 character-count / line-count / regex-complexity-limit 具体数字。

---

## 7. 逐 Action-Plan 独立评估摘要

### 7.1 A1 — Contract & Identifier Freeze（484 行）
- **强项**：精确吸收 Q8 反转（follow-up family → Phase 0）；5 个 Phase 分工清晰；P5 有单独 Exit Pack。
- **弱项**：Q1（follow-up shape）仍未决，但 P3-01 强依赖；`trace_id` 实际规模（40 处）被低估；未讨论 15 条 root contract test 的 mass update 工作量。
- **Verdict**：`ready-to-start-with-blocker-Q1`

### 7.2 A2 — Trace Substrate Decision Investigation（411 行）
- **强项**：response 到 Q5/Q20 完整；4 个 Phase = Reality → Harness → Execute → Decide，顺序合理；`trace-substrate-benchmark.md` 作为明确 artifact。
- **弱项**：benchmark runner 的 fake storage double 可能与真 DO storage 行为有差距，§7.1 风险行里已自承 "synthetic 风险"但未给缓解方案；benchmark scenarios 只定义 4 类（steady/burst/restart/live-durable split），未覆盖 `follow-up family ingestion` 相关场景。
- **Verdict**：`ready-to-start`

### 7.3 A3 — Trace-first Observability Foundation（467 行）
- **强项**：5 个 Phase 覆盖 trace law / builders / recovery / cross-package / evidence；对 Q6/Q7 消费正确；cross-package instrumentation sweep 明确到 llm/hook/tool/compact/storage/context。
- **弱项**：**Recovery Law 仅 4 类错误**，未达 design review §C3 要求的 8-10 类；Anchor shape 的具体字段（`message_uuid / request_uuid / reply_to / parent_message_uuid / session_uuid / stream_id`）优先级未给；chaos/failure injection scenarios 缺位。
- **Verdict**：`ready-to-start-with-depth-gap`

### 7.4 A4 — Session Edge Closure（461 行）
- **强项**：精确消费 Q8 widened session 进入 runtime；5 个 Phase 覆盖 ingress/helper/fallback/trace/exit pack；single-active-turn invariant 明确。
- **弱项**：总 scope 大；P2-02 `SessionWebSocketHelper` wiring 替代 DO 的手写 replay/ack/heartbeat — 工作量估计 `M` 可能偏小；没讨论 WebSocket close codes (`1000/1001/1011`) 对 client reconnect 策略的影响；replay buffer 大小未给数字。
- **Verdict**：`ready-to-start-with-size-concern`

### 7.5 A5 — External Seam Closure（485 行）
- **强项**：5 个 Phase 从 catalog → hook/capability → fake provider → cross-seam law → handoff；对 Q9/Q10/Q12 精确响应；保留 `local-ts/local-fetch` reference path。
- **弱项**：fake provider worker 作为 `.ts` fixture，未讨论如何打包成独立 wrangler Worker；`Startup Queue / Early Event Guard` 位置仍双指（session runtime composition / eval seam）；Skill worker 仍完全留白（H9 design issue 未解）。
- **Verdict**：`ready-to-start-with-worker-packaging-gap`

### 7.6 A6 — Deployment Dry-Run（475 行）
- **强项**：吸收 Q10/Q11/Q12 完整；5 个 Phase = Gate → Surface → L1 → L2 → Verdict；verdict bundle 4-artifact 输出（trace/timeline/placement/summary）明确。
- **弱项**：`green/yellow/red` 阈值未给；OpenAI API secret 注入机制未规定；wrangler dev --remote vs deploy 的 DO 语义差异（local-first DO 行为 vs cloud DO）未深入；chaos testing 缺位。
- **Verdict**：`ready-to-start-with-secret-policy-gap`

### 7.7 A7 — Storage & Context Evidence Closure（484 行）
- **强项**：5 条 evidence streams 分工最清晰；精确响应 Q5/Q13/Q14/Q20；Phase 5 single-pack out（report + principles + exit pack）。
- **弱项**：5 streams × 4 verdicts 的 20-cell matrix 未展开；"real storage spot-check" 依赖 A6 L2，串行成本高；P4-03 "Threshold Rules" 只给结构不给具体阈值数字。
- **Verdict**：`ready-to-start-depends-on-A6`

### 7.8 A8 — Minimal Bash Search and Workspace（267 行）
- **强项**：Q15/Q16 精确响应（`rg` canonical + `grep→rg` alias）；workspace truth 明确；partial disclosure 诚实。
- **弱项**：`mkdir` contract 决策放在 Phase 2 内部；`rg` 输出截断具体数字未给；搜索结果的 artifact promotion 阈值未给；注意 A8 文档较短（267 行），**缺少 §6 需要业主回答的问题清单章节**（与其他 A 文件结构不一致）。
- **Verdict**：`ready-to-start-with-mkdir-decision-pending`

### 7.9 A9 — Minimal Bash Network and Script（264 行）
- **强项**：Q17 精确响应；bash/structured 路径分离明确；restricted curl + ts-exec 治理姿态正确。
- **弱项**：**`ts-exec` substrate decision 未决**（Phase 3 内部决策）；private address 列表未给；同样缺 §6 owner-questions 章节；`curl` 输出 body size cap 具体数字未给。
- **Verdict**：`ready-to-start-with-ts-exec-substrate-blocker`

### 7.10 A10 — Minimal Bash VCS and Policy（260 行）
- **强项**：Q18/Q19 精确响应；5 个 Phase 覆盖 freeze → baseline → enforcement → drift guard → exit pack；hard-fail contract 继承 mvp wave 2nd round fixings 资产。
- **弱项**：Inventory drift guard 实现形式未决；`git status/diff/log` 的具体实现算法（HEAD vs workspace snapshot）未给；同样缺 §6 章节。
- **Verdict**：`ready-to-start`

---

## 8. 共性观察

### 8.1 A1-A7 vs A8-A10 的结构差异

A1-A7（长文档，~400-485 行）都有完整 10 章节（0-10），包括 §6 owner-questions、§8 整体测试/收口、§9 复盘关注点。  
**A8-A10（短文档，~260-267 行）都缺 §6/§7 owner-questions 章节**，直接从 §5 Phase 详情跳到 §6 风险依赖验收。

这不是 bug，但造成 **治理纪律不一致**：Phase 7 里的重要决策点（mkdir partial / ts-exec substrate / drift guard 形式）因此没有显式 Q-list 供业主拍板。

### 8.2 action-plan 对 context/ 的引用深度

10 份 action-plan 都在 header "参考 context" 字段引用了具体的 context/ 文件和行号：

| context 对标 | 引用频次 |
|---|---|
| `codex/trace_context.rs` | A1/A2/A3/A4/A5 (5 次) |
| `claude-code/toolExecution.ts` | A3/A5/A6/A9/A10 (5 次) |
| `just-bash/mountable-fs.ts` | A8 (1 次) |
| `mini-agent/logger.py` | A2/A3/A7 (3 次) |
| `claude-code/microCompact.ts` | A7 (1 次) |

**观察**：just-bash 只被 A8 引用一次。Phase 7b/7c 的 action-plan (A9/A10) **没有引用 just-bash 具体命令实现位置**（如 `curl/curl.ts:177-240`、`grep/grep.ts`、`js-exec/js-exec.ts:1-130`）。这可能错过了 direct-port 的机会 —— 例如 `rg` 最小实现可以直接借鉴 `just-bash/src/commands/rg/rg.ts`。

### 8.3 `trace_uuid` 选型的现实代价未被充分估算

业主 Q1 选择 "全局使用 `trace_uuid`"，这意味着：
1. `nacp-core/envelope.ts` 的 `NacpTraceSchema.trace_id` → `trace_uuid` rename
2. 15 条 root contract tests (`test/*.test.mjs`) 全部更新
3. 14 条 cross-package E2E tests 全部更新
4. 每个 package 的 package tests 里涉及 trace 字段的也全部更新
5. Cloudflare Worker deploy 版本需要 compat migration 支持读旧版

A1 只在 `packages/nacp-core` + `packages/nacp-session` + `packages/llm-wrapper` 三个包下列出影响。**实际影响面比 action-plan 列出的大 2-3 倍**。

### 8.4 `trace_uuid` 命名的对标准确性

smcp 使用 `trace_uuid`（optional, 嵌在 control_payload）；safe 使用 `trace_id`（required, 独立 SafeTrace 类）。业主选了 smcp 的 **命名** 但要求 safe 的 **严格度**（required + 不允许 silent continue）。这是一个合理的 hybrid，但 action-plan 文档没有显式说明这点。读者可能误以为完全跟 smcp 走。

### 8.5 Skill composition 仍然缺位

全部 10 份 action-plan 里只有 A5 §3.1 提到 "skill worker 继续保留为 reserved seam"，没有一份 action-plan 讨论 Skill 的 design 何时启动。README §3 / §4.1 把 Skill 列为 nano-agent 三大差异化之一，但 after-skeleton 全程没有 action 覆盖。

---

## 9. 最终问题列表

> 本节是本评审的执行指南。CRITICAL 必须在对应 A 启动前解决；HIGH 必须在对应 A 的 Phase 1 启动前解决；MID 可以在 A 执行过程中解决；LOW 可以在 follow-up 或 exit pack 中解决。

### 9.1 CRITICAL（必须在启动对应 A 前解决）

- **C1. A1 Q1 — follow-up input family 最小 frozen shape 未决**
  - **文件位置**：A1 §6.1 Q1
  - **阻塞关系**：A1 P1-03 / P3-01 依赖；若不决，A1 Phase 3 无法启动
  - **需要业主答复**：(a) 单条 follow-up message 还是多条系列？(b) canonical message name (`session.continue` / `session.followup_input` / 其他)？(c) body 最小字段（text / context_ref / 其他）？
  - **建议答案**：单条 `session.followup_input` + body = `{ text: string, context_ref?: NacpRef }`，与 `session.start.initial_input` 形成最小平行结构

- **C2. A9 P3-01 — `ts-exec` substrate decision 未决**
  - **文件位置**：A9 §4.3 P3-01
  - **阻塞关系**：A9 Phase 3 整体依赖；`ts-exec` 是 LLM 高频工具，决策延迟会影响 capability inventory 的对外披露
  - **需要业主答复**：三选一 — (a) 本地 V8 isolate sandbox (`quickjs-emscripten` / `sandboxjs`) / (b) 远程 tool-runner worker / (c) v1 保留为 partial，只做 syntax check
  - **建议答案**：**v1 保留 partial**（c），因为本地 sandbox 需要评估 `quickjs-emscripten` 的 V8 isolate compat，远程 worker 需要先有 P4 fake provider 稳定后再接；保守是正确选择

### 9.2 HIGH（必须在对应 A 的 Phase 1 启动前解决）

- **H1. A1 rename 影响面被低估**
  - **现状**：repo 内 `trace_id` 实际出现 40 处，`stream_id/span_id/producer_id/stamped_by/reply_to` 各自有多处；15 root contract tests + 14 e2e tests 也涉及
  - **缓解**：在 A1 Phase 1 的 migration estimate 里必须 grep 全仓，不能只在 `nacp-core` + `nacp-session` + `llm-wrapper` 三包内列

- **H2. A3 Recovery Law 深度不足（design review §C3 未解）**
  - **现状**：A3 P3-01 只列 4 类错误（`anchor-missing / anchor-ambiguous / compat-unrecoverable / cross-seam-trace-loss`）
  - **缓解**：补齐 recovery scenarios 至 8-10 条（include: ingress without trace / mid-turn trace loss / checkpoint anchor mismatch / replay across trace boundary / cross-worker trace discontinuity / alarm-wake trace recovery / compact boundary trace straddle / HTTP fallback trace re-attach）

- **H3. A5 fake provider worker 打包成 Cloudflare Worker 的机制未定**
  - **现状**：`test/fixtures/external-seams/fake-provider-worker.ts` 是 fixture 文件，不是独立 Worker 项目
  - **缓解**：A5 Phase 3 前必须决定 — 是扩展 `packages/` 下独立 Worker 包，还是在 `test/fixtures/workers/` 下建 mini-Worker project with own `wrangler.jsonc`？后者更轻但需要 CI 能 wrangler publish

- **H4. A6 real provider secret 注入机制未定**
  - **现状**：A6 Phase 4 需要 OpenAI API key，但 action-plan 没说从哪来
  - **缓解**：Phase 4 启动前定 — (a) `wrangler secret put OPENAI_API_KEY` + owner-local login；(b) `.env.local` with `.gitignore`；(c) 手动 export。建议 (a)，跟 Cloudflare-native 一致

- **H5. A6 `green/yellow/red` 阈值未定**
  - **现状**：A6 P5-01 说"输出 verdict"但未定义判定条件
  - **缓解**：P1-01 Verification Ladder Freeze 增加具体阈值（例如: L1 全绿 + L2 main-path 通过 = green；L1 全绿 + L2 有 1-2 non-critical failure = yellow；L1 有 failure 或 L2 main-path 失败 = red）

- **H6. A8 `mkdir` partial vs real 决策应前置**
  - **现状**：A8 P2-02 把决策放在 Phase 2 内部
  - **缓解**：前置到 Phase 1 freeze。建议答案：**保留 compatibility ack + 显式 partial**，因为 backend directory primitive 需要修改 `WorkspaceBackend` 接口，会影响多个 package

- **H7. Skill composition 整个 after-skeleton 缺位**
  - **现状**：10 份 action-plan 对 Skill 只字未提（仅 A5 §3.1 一句 "reserved seam"）
  - **缓解**：在 A10 exit pack 或新增 A11（或在下一阶段的 plan-after-action-plan 中）明确 Skill composition 何时启动

- **H8. Chaos / failure injection testing 在 A3/A6 缺位（design review §H5 未解）**
  - **现状**：recovery law 只在 A3 P5-01 有 `failure-replay.test.ts`，但没有 chaos scenarios（DO hibernation mid-turn / D1 unavailability / WebSocket abort on flush）
  - **缓解**：A3 Phase 5 增加至少 3 种 chaos scenarios；A6 Phase 4 增加 "deploy-time failure injection"

- **H9. Performance budget 缺位（design review §H5 未解）**
  - **现状**：A4 没给 hot-path latency budget；A2 只测 substrate latency 不测 end-to-end
  - **缓解**：A4 Phase 5 收口时必须产出 WS → DO → provider p50/p99 baseline；A6 Phase 4 P4-03 的 Hot-path Latency Baseline 应该同时反向回灌给 A4

- **H10. A9 private address block 具体 IP 列表未定**
  - **现状**：A9 P2-03 提 localhost/private guard 但未给 RFC1918
  - **缓解**：Phase 2 之前定具体列表 — `127.0.0.0/8 / 169.254.0.0/16 / 10.0.0.0/8 / 172.16.0.0/12 / 192.168.0.0/16 / ::1 / fc00::/7 / fe80::/10`

### 9.3 MID（可以在 A 执行过程中解决）

- **M1. A2 benchmark scenarios 未覆盖 follow-up family ingestion**（跟 Q8 反转同步影响）
- **M2. A2 fake DO storage double 与真实 DO 行为差距未量化**
- **M3. A3 Anchor priority 未定**：`message_uuid > request_uuid > reply_to > parent_message_uuid > session_uuid > stream_id` 优先级需写清
- **M4. A4 WebSocket close code 语义未列**：1000/1001/1011 对应什么 reason
- **M5. A4 replay buffer 大小未定**
- **M6. A5 Startup Queue 实现位置（session runtime composition / eval seam）仍双指**
- **M7. A6 L0/L1/L2 的 iteration 成本对比未给**（L2 可能 10s/run，L1 <1s/run）
- **M8. A7 5 × 4 verdict matrix 未展开**
- **M9. A7 `evidence-backed` 升格阈值未给**（"≥ N 条 evidence" 具体 N）
- **M10. A8 `rg` 输出截断算法未定**（character count? line count? regex complexity?）
- **M11. A8-A10 缺 §6 owner-questions 章节，与 A1-A7 结构不一致**
- **M12. A10 Inventory drift guard 实现形式未定**（lint 脚本 / manual review / CI check）
- **M13. A9-A10 未直接引用 just-bash 具体命令实现位置，错失 direct-port 机会**

### 9.4 LOW（follow-up / exit pack 解决即可）

- **L1. A1-A10 都没给总工作量 wall-clock 估算**（只有 Phase 级 S/M/L）
- **L2. A2 benchmark 结果格式（JSON + Markdown）是否 machine-readable 未强调**
- **L3. A3 `audit-record` codec 兼容性测试的工作量估算不足**
- **L4. A5 fake hook worker / fake capability worker 的 fixture 复用关系未明确**
- **L5. A6 多 provider matrix 的 "为什么 defer" 理由不够强**（只说 "不做矩阵爆炸"）
- **L6. A7 `context-layering-principles` 的最终 shape 未预览**（只说要写）
- **L7. A7-A10 的 report artifact 存放位置（docs/eval/ vs docs/progress-report/）未统一**
- **L8. A8 `grep-rg` alias 的 compat flags 具体列表未给**（只说 `-i / -n`）
- **L9. A10 git subset 的实现算法（HEAD snapshot vs git binary vs libgit2-wasm）未讨论**

---

## 10. Verdict & Next Steps

### 10.1 整体判断

- **方向**：`approve`
- **结构**：`approve`
- **Ground Truth 锚定**：`approve`（17/18 命题命中）
- **QNA 响应度**：`approve`（20/20 答案被正确消费，含 Q8 反转）
- **可执行性**：`approve-with-staged-followups`（2 CRITICAL + 10 HIGH 需前置解决）
- **风险可控度**：`approve-with-staged-followups`

### 10.2 推荐启动顺序

| 阶段 | 动作 | 依赖 |
|---|---|---|
| **Pre-Phase 0** | 业主回答 C1（follow-up shape）+ C2（ts-exec substrate） | — |
| **Phase 0 prep** | 补 H1-H10 的决策与 artifact | C1/C2 答案 |
| **Phase 0 exec** | 启动 A1 | Pre-Phase 0 完成 |
| **Phase 1 exec** | 启动 A2（可与 A1 Phase 3-5 部分并行） | A1 Phase 2 完成 |
| **Phase 2 exec** | 启动 A3 | A2 完成 |
| **Phase 3 exec** | 启动 A4 | A3 Phase 1-2 完成 |
| **Phase 4 exec** | 启动 A5 | A4 Phase 2 完成 |
| **Phase 5 exec** | 启动 A6（verification gate） | A4 + A5 完成 |
| **Phase 6 exec** | 启动 A7 | A6 Phase 4-5 完成 |
| **Phase 7 exec** | 启动 A8 → A9 → A10（串行） | A7 完成 |
| **post-A10** | 评估 Skill composition 的下一阶段设计入口（H7） | A10 exit pack |

### 10.3 关键守则

1. **不要让 action-plan 自己解决 CRITICAL 决策** — C1/C2 必须先走 owner-review flow
2. **不要在 A6 L2 smoke 通过前宣布 A7 evidence closed**（串行依赖真实）
3. **不要让 Phase 7（A8-A10）偷渡 owner-decision 级选择**（M11 结构缺失问题）
4. **不要让 `trace_uuid` rename 在 A1 P2-01 之前开工**（所有受影响测试必须一起迁）

### 10.4 一句话收尾

> 这 10 份 action-plan 是**迄今为止最具执行力的 phase charter 集合**——它把 15 份 design + 20 条 QNA 答案精准落成 10 份可开工的工程执行文件，DAG 无环无悬、Ground Truth 对齐度 17/18、QNA 响应度 20/20。但 A1-Q1（follow-up shape）与 A9-P3-01（ts-exec substrate）两条 CRITICAL 决策仍在 action-plan 内部"自己等自己"——这两条不前置解决，Phase 0 与 Phase 7b 会在启动后被自身的"先决策再执行"逻辑卡住。**C1/C2 拍板 + H1-H10 前置，即可作为 after-skeleton 阶段的正式工程执行文件使用。**
