# After-Skeleton Design Review

> 审查者: `Claude Sonnet 4.5`
> 审查日期: `2026-04-18`
> 审查范围: `docs/design/after-skeleton/` 全部 15 份设计文件
> 评审基准:
> - `packages/` 内已完成代码事实
> - `context/` 内 3 个 agent-cli 工具（mini-agent / codex / claude-code）
> - `context/just-bash` 实现参考
> - `docs/plan-after-skeleton.md` 的框架约束与 SMCP/trace 协议要求

---

## 执行摘要

15 份设计文件整体展示了高水平的架构思维：对 Cloudflare Worker-native 约束的理解是清晰的，对已有代码事实的引用是诚实的，In-Scope/Out-of-Scope 的边界是克制的。但在若干核心工程对齐点上，设计文件与代码事实之间存在尚未弥合的鸿沟，其中部分属于 **CRITICAL 级别**，需要在进入实现阶段前明确决策。

---

## 逐阶段评估

### P0 — Contract & Identifier Freeze（三份文件）

**P0-contract-and-identifier-freeze.md**

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| 与代码事实对齐 | ✅ 良好 | 正确识别了 `nacp-session`、`nacp-core`、`eval-observability` 三个已冻结 surface |
| 对 plan-after-skeleton.md 承诺的覆盖 | ✅ 完整 | 四大支柱（contract/identifier/trace/runtime）均被引用 |
| 可操作性 | ⚠️ 中等 | "冻结"动作本身缺乏明确的 gate criteria；如何判断"已冻结"？缺少 contract hash / type-level locking 方案 |
| 风险识别 | ✅ 良好 | 明确区分了"内部协议冻结"与"产品 API 延后" |

**P0-contract-freeze-matrix.md**

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| 与代码事实对齐 | ✅ 良好 | Surface 分类（Frozen / Frozen-Rename / Directional / Deferred）与实际包结构基本吻合 |
| 最严重遗漏 | ⚠️ 中等 | `NacpEnvelope` 里 `request_uuid` 仍是 `.optional()`；设计矩阵将其列为"已冻结"面，但代码现实还未硬化为 required |
| 实现指导性 | ✅ 实用 | 矩阵格式清晰，可直接作为 PR review checklist |

**P0-identifier-law.md**

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| 法则清晰度 | ✅ 优秀 | `*_uuid / *_key / *_name / *_ref / *_seq` 层级定义严谨 |
| 与代码现实的差距 | ❌ 存在漂移 | `TraceEventBase` 当前使用 `sessionUuid / teamUuid / turnUuid`（camelCase），而 `NacpEnvelope` 使用 `session_uuid / team_uuid`（snake_case）；两者已在同一 identifier law 下，但 law 文件未明确 casing 约定 |
| 法则执行路径 | ⚠️ 缺失 | 没有说明 identifier law 如何在 build 时、test 时、review 时被机械执行；仅是设计意图 |

**P0-nacp-versioning-policy.md**

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| 版本观清晰度 | ✅ 优秀 | `provisional baseline → frozen baseline` 的迁移路径逻辑自洽 |
| 代码事实对齐 | ✅ 良好 | `NACP_VERSION = "1.0.0"` 的 provisional 定位是诚实的 |
| 可操作性 | ⚠️ 中等 | "何时触发 frozen baseline 切换"缺乏可测量的进入条件 |

---

### P1 — Trace Substrate Decision

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| substrate 选择合理性 | ✅ 优秀 | DO hot-anchor / R2 cold-archive / D1 deferred 三层策略与 Cloudflare 生态的真实特性高度匹配 |
| 与代码事实对齐 | ✅ 良好 | `DoStorageTraceSink` 的存在印证了 DO storage 已经是热锚方向 |
| 关键漏洞 | ❌ 存在 | R2 cold archive 的触发策略（何时 promote、何时 archive）完全没有量化标准，也没有与 `PLACEMENT_HYPOTHESES` 的 provisional 状态连接；实现时极易迷失 |
| 对 SMCP 协议的尊重 | ✅ 良好 | 明确 DO storage 必须遵守 tenant namespace 隔离 |

---

### P2 — Trace-First Observability Foundation

**P2-trace-first-observability-foundation.md** — **这是最关键的阶段，问题最集中**

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| 目标方向 | ✅ 正确 | `trace_uuid` 作为第一事实是正确的架构法则 |
| **与代码现实的对齐** | ❌ **CRITICAL 漂移** | `TraceEventBase`（`packages/eval-observability/src/trace-event.ts`）**完全没有 `traceUuid` 字段**；`NacpEnvelope`（`packages/nacp-core/src/envelope.ts`）中也**没有 `trace_uuid`**；整个代码库只有 `packages/nacp-core/src/observability/envelope.ts` 有一个 `trace_uuid: z.string().uuid().optional()`，且是 optional |
| 设计意图 vs 落地路线 | ⚠️ 缺失 | P2 提出了"upgrade `TraceEventBase` to include `traceUuid`"，但没有说明升级时如何处理已有 14 个 E2E 测试的 backward compat；没有迁移语义 |
| recovery path 设计 | ✅ 有价值 | 对 missing trace 的 recovery 路径（generate 还是 reject）的分层处理是有建设性的 |

**P2-observability-layering.md**

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| 三层模型价值 | ✅ 优秀 | Anchor / Durable / Diagnostic 分层能够解决"该不该 durable"的长期争论 |
| 与当前 enum 的映射 | ✅ 良好 | `live → Diagnostic`，`durable-audit → Anchor+Durable`，`durable-transcript → Durable subset` 映射逻辑清晰 |
| 实现依赖 | ⚠️ 问题 | 如果 P2-foundation 的 `traceUuid` 添加尚未发生，那么 Anchor Layer 就没有真实锚点；两文件存在强前置依赖但未明确序列化 |

---

### P3 — Session Edge Closure

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| 问题诊断精准度 | ✅ 优秀 | 准确识别了 `NanoSessionDO.webSocketMessage()` 仍在 `JSON.parse + message_type switch` 这个核心问题 |
| 与 nacp-session 事实对齐 | ✅ 良好 | `normalizeClientFrame / assertSessionRoleAllowed / assertSessionPhaseAllowed / SessionWebSocketHelper` 的引用是真实准确的 |
| 关键误判风险 | ⚠️ 中等 | F5 (Edge Trace Wiring) 要求"attach/resume/replay/health 都 emit trace"，但此时 `TraceEventBase` 还没有 `traceUuid`；如果 P2 没先落地，P3 的 trace wiring 会 emit 无锚点的 trace，违反 trace-first law |
| 实现路径清晰度 | ✅ 良好 | refactor 步骤以 `nacp-session` 为中心边界的思路是对的 |

---

### P4 — External Seam Closure

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| 代码事实对齐 | ✅ 优秀 | 正确指出 `ServiceBindingRuntime` 仍抛错、`CompositionFactory` 仍返回 undefined handles、`InferenceGateway` 尚无落地实现 |
| 双路径策略 | ✅ 明智 | local reference path + remote service-binding path 并存的策略，是渐进式验证的正确选择 |
| Cross-seam trace propagation | ❌ **HIGH 级漂移** | F5 要求每次跨 worker 调用携带 `trace_uuid`，但 `NacpEnvelope` 当前**根本没有 `trace_uuid` 字段**；跨 worker trace propagation 在实现时会找不到 envelope 字段 |
| Fake workers 策略 | ✅ 正确 | "先用 fake-but-faithful workers 验证 seam"的策略是工程上性价比最高的路径 |

---

### P5 — Deployment Dry-Run and Real Boundary Verification

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| 验证阶梯价值 | ✅ 优秀 | L0（in-process） → L1（deploy-shaped dry-run） → L2（real smoke）的三级阶梯是务实且可操作的 |
| 前置依赖识别 | ✅ 良好 | 明确说明"WsController / HttpController 仍是 stub"是 dry-run 的前置障碍 |
| Verdict bundle 设计 | ✅ 有价值 | trace/timeline/placement/report 四件套证据包是正确的闭环工具 |
| 最大风险 | ❌ **HIGH** | wrangler.jsonc 当前只声明了 SESSION_DO；P5 要求扩充到 CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER，但这与 `CompositionFactory` 在 P4 的接线强依赖；如果 P4 没完成，P5 的 dry-run profile 会没有实际内容可验证 |

---

### P6 — Storage and Context Evidence Closure

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| 代码现实引用 | ✅ 优秀 | 对 `StoragePlacementLog / EvidenceSignal / PLACEMENT_HYPOTHESES / ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder` 的引用都是准确的 |
| Evidence 分类清晰度 | ✅ 优秀 | placement / context-assembly / compact / artifact / snapshot 五类 evidence 流的解耦是合理的 |
| 关键前置条件 | ⚠️ 中等 | 所有 evidence 必须挂 `trace_uuid`（S6 明确说明），但这依赖 P2 的 `TraceEventBase` 升级先完成；如果 P2 未落地，P6 的 evidence-binding 规则就没有锚 |
| `StoragePlacementLog` 只在测试里 | ✅ 诚实承认 | 设计文件已经清晰识别了这个问题并定义为 Phase 6 要填补的缺口 |

---

### P7a — Minimal Bash Search and Workspace

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| 代码事实对齐 | ✅ 优秀 | 对 `mkdir` 是 partial（backend 无真实 dir primitive）、`rg` 是 degraded stub 的识别完全准确 |
| 与 just-bash 的对比 | ✅ 良好 | 援引 `just-bash/src/commands/rg/rg.ts` 作为"能力上限"而非"复制目标"的定位是正确的 |
| workspace-native truth 策略 | ✅ 正确 | MountRouter + WorkspaceNamespace 作为唯一事实来源的决策是对的 |
| 潜在问题 | ⚠️ 中等 | `rg` 当前是 degraded TS scan；文件定义"canonical search command"但没有给出何时、如何将其升级为真实搜索质量的触发标准 |

---

### P7b — Minimal Bash Network and Script

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| 与代码现实对齐 | ✅ 高度准确 | `curl` stub (`network access not yet connected`)、`ts-exec` stub (`sandboxed execution not yet connected`)、planner 窄解析的描述都与代码完全一致 |
| localhost 幻觉治理 | ✅ 价值高 | 明确禁止 `npm install && node server.js && curl localhost` 这类 mental model 是必要的 |
| just-bash curl 对比 | ✅ 正确 | 援引 just-bash curl 的宽广面作为"不该学的上限"，判断合理 |
| 实现路线 | ⚠️ 中等 | structured path vs bash string 的双轨方案正确，但没有说明 `ts-exec` 的实际 sandbox 实现用什么；Worker-native inline eval 有严格的 CSP/安全约束，这在设计里完全未涉及 |

---

### P7c — Minimal Bash VCS and Policy

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| 代码事实对齐 | ✅ 良好 | `git status/diff/log` 这三个 stub 的描述是准确的 |
| 治理框架 | ✅ 优秀 | registry / prompt / TS guard 三方对齐的目标是正确的架构选择 |
| virtual VCS 的深度问题 | ⚠️ 中等 | `git status` 的输出应该反映什么？是 workspace snapshot 的 diff？还是 DO storage 的变更？文件回避了这个根本性问题，导致"virtual git"仍然停留在 ack stub 层面 |
| hard-fail policy | ✅ 正确 | "no silent success"策略是 fake bash 的核心正确性法则 |

---

### PX — Capability Inventory

| 评估维度 | 判定 | 说明 |
|---------|------|------|
| 价值 | ✅ 极高 | E0-E3 evidence grade + Supported/Partial/Deferred/Unsupported/Risk-Blocked 五级分类是非常实用的治理工具 |
| 与代码现实的一致性 | ✅ 良好 | 12 个命令的分级基本准确：`pwd/ls/cat` 是 Supported-E3，`curl/ts-exec/git/mkdir/rg` 是 Partial-E1 |
| 可维护性 | ⚠️ 风险 | 这是手动维护文档；没有 inventory drift guard 机制，很容易与代码脱节 |
| 最大遗漏 | ⚠️ 中等 | `service-binding` target 在 Target Inventory 里标为 E1（partial），但 `nacp-core` 的 `ServiceBindingTransport` 已经做得很好（E2+）；这里的 E1 是因为 hooks 里的 `ServiceBindingRuntime` 抛错，不是 transport 本体的问题；两者应该分开评级 |

---

## 优先级问题清单

### CRITICAL — 实现前必须解决

**[C1] `trace_uuid` 从未进入任何可被 trace 消费的核心合同**

- **证据**：`packages/nacp-core/src/envelope.ts` 中 `NacpEnvelope` **没有 `trace_uuid`**；`packages/eval-observability/src/trace-event.ts` 中 `TraceEventBase` **没有 `traceUuid`**；全代码库只有 `packages/nacp-core/src/observability/envelope.ts` 有一个 `trace_uuid: optional()`
- **影响**：P2 的"trace_uuid 作为第一事实"是纸面法则；P3 的 edge trace wiring、P4 的 cross-seam trace propagation、P6 的 evidence binding 全部依赖这个字段存在于各自 contract 中
- **所需决策**：明确 `trace_uuid` 应该加在哪里（`TraceEventBase`？`NacpEnvelope`？还是仅 observability envelope？），并决定 required vs optional 的边界
- **风险**：若不解决，P2-P6 所有 trace 相关 scope 都可能在实现时互相漂移或空跑

**[C2] P3/P4 对 P2 存在强编译前置依赖但无显式序列化断言**

- **证据**：P3 (F5 Edge Trace Wiring) 和 P4 (F5 Cross-Seam Propagation Law) 均要求 emit 含 `trace_uuid` 的 trace event，但两者的设计文件里没有写"如果 P2 未完成，本阶段不能开始"
- **影响**：如果只有部分实现 P2，P3/P4 发出的 trace 会成为"有结构但无锚点"的噪音，让 observability 降级为假信号而非实信号
- **所需决策**：建立阶段门控：`TraceEventBase` 必须包含 `traceUuid` 且有完整的 type-test，P3/P4 实现才能开始

---

### HIGH — 需要尽快决策

**[H1] `NacpEnvelope.request_uuid` 仍是 optional，与 identifier law 的"UUID-first"精神冲突**

- **证据**：`envelope.ts:167` 中 `request_uuid: z.string().uuid().optional()`
- **影响**：external seam 的 cross-seam propagation 要求每次调用都携带 `request_uuid`（P4 F5 section），但 contract 不强制
- **所需决策**：升级为 `required`，并分析现有测试的兼容性影响

**[H2] P5 的 dry-run profile 对 P4 有强实现依赖，但两者是否可并行从设计层面未说明**

- **证据**：P5 要求 `CompositionFactory` 能在 wrangler profile 中选择 fake capability / hook / provider worker，但 P4 的具体实现（ConnectionFactory 接线、wrangler binding 扩展）尚未完成
- **影响**：P5 的 dry-run binding profile 如果在 P4 完成前开始，会得到空壳 profile
- **所需决策**：确认 P4 的哪些具体交付物是 P5 验证的前置 gate

**[H3] `ts-exec` 在 Worker 环境下的 inline eval 缺乏具体 sandbox 方案**

- **证据**：P7b 确认 `ts-exec` handler 当前是 stub；但设计文件没有说明 Worker-native 的 TS/JS inline eval 如何在 V8 isolate 的 CSP 和 `eval()` 限制下实现
- **影响**：这是 P7b 的核心实现风险；Worker 环境下 `eval()` 默认被限制，custom sandbox 需要特殊 wrangler 配置
- **所需决策**：明确 ts-exec 的 v1 sandbox 机制（in-process eval、wrangler unsafe_eval、还是 remote worker？）

**[H4] P1 的 R2 archive 触发策略完全 provisional，但没有任何可测量的 calibration 标准**

- **证据**：`PLACEMENT_HYPOTHESES` 明确所有 placement 都是 provisional，P1 的 substrate 决策依赖这些 hypotheses 的 evidence-backed 校准，但 evidence 的积累依赖 P6 的 evidence closure
- **影响**：P1→P6 之间存在一个"先鸡后蛋"的循环：P1 需要 evidence 来校准 substrate threshold，而 evidence 系统本身需要 P6 先落地
- **所需决策**：为 Phase 1 substrate 决策提供至少一个临时的"provisional release criteria"，允许在没有 evidence 的情况下先做最小合理配置

---

### MID — 进入各阶段前应明确

**[M1] P7c `git status` 的输出语义：它应该反映 workspace 的什么状态？**

- 当前 `createVcsHandlers()` 是纯 stub 文案；但设计文件没有定义"workspace namespace 下的 git diff 语义"是什么
- 如果 git 不挂接 workspace snapshot，那么 `git diff` 的结果反映什么？turn 间的 file 变化？还是当前文件与上次 checkpoint 的差异？
- 这是实现前需要明确的语义问题，否则 handler 无法正确实现

**[M2] Identifier Law 的 casing 约定未统一**

- `TraceEventBase` 全部使用 camelCase（`sessionUuid / teamUuid / turnUuid`）
- `NacpEnvelope` 使用 snake_case（`session_uuid / team_uuid`）
- P0-identifier-law.md 没有规定 casing；两者都符合命名语义，但在 adapter/mapping 层会引发大量 `toApiCase / fromApiCase` 样板代码问题
- 需要明确：内部 TS interface 一律 camelCase，协议 wire 一律 snake_case，这是隐含约定还是需要显式声明？

**[M3] P6 的 compact evidence 与 `CompactBoundaryManager` 的当前 contract 有语义 gap**

- 设计要求记录 `history_ref / target token budget / split point / summary_ref / tokens_before / tokens_after`
- 当前 `CompactBoundaryManager.buildCompactRequest()` 返回的结构是否已经包含所有这些字段，需要核查
- 如果不完整，意味着 P6 实现 compact evidence 的同时需要修改 `CompactBoundaryManager` 的 contract，这是两件事情

**[M4] P5 的 Verdict Bundle 没有定义存储位置和格式**

- "trace/timeline/placement/report 四件套"是正确的想法，但没有说明它们存在哪里（DO storage？R2？本地文件？）
- 也没有定义 report 的 schema；"green/yellow/red + 阻塞项说明" 很好，但仍然是口头格式

**[M5] PX Capability Inventory 对 `service-binding` target 的 E1 rating 混淆了 transport 与 runtime**

- `nacp-core/ServiceBindingTransport` 已经很成熟（有 validateEnvelope → verifyTenantBoundary → checkAdmissibility 完整 pipeline），应该是 E2
- 但 `hooks/ServiceBindingRuntime` 及 `session-do-runtime/CompositionFactory` 的装配确实是 E0-E1
- 两者应该在 inventory 里分开列，否则误导实现者对 transport 层的评估

---

### LOW — 设计层面的建议

**[L1] 三份 P2 文件与 just-bash 的交叉引用集中在"反例"，对值得学习的深层设计挖掘不足**

- just-bash 的 `mountable-fs` 的 longest-prefix routing 被 P7a 充分借鉴，这是好的
- 但 just-bash 的 `commands/registry.ts` 的 lazy-loading 模式（延迟注册 handler）对 capability runtime 有参考价值，在 P7b/P7c 里只被 codex 代替引用了

**[L2] 各设计文件的"下一步行动"列表标准不一**

- P3 的"下一步"列了具体 issue/PR；P0 的"下一步"只有模糊的"确认 xxx"
- 建议将所有"下一步"统一到 action-plan 格式（task title / owner / gate criteria），避免"待深入调查"成为永远打不掉的项

**[L3] P4 的 Fake Provider Worker 对 StreamNormalizer 的依赖未在设计中明确**

- 设计说"fake provider worker 的输出仍必须回到 StreamNormalizer / session stream mapping"
- 但 `StreamNormalizer` 当前在哪个包、其 contract 是否已冻结，设计里没有引用
- 实现时需要找到这条依赖链的真实锚点

**[L4] P6 的 calibration verdict 缺少与 storage topology 的反馈机制**

- `evaluateEvidence()` 应该输入 placement evidence 并输出 verdict
- 但 `storage-topology/src/evidence.ts` 里的 `EvidenceSignal / CalibrationHint` 是否已知晓 evidence verdict 的消费方？设计层面是单向流，没有说明 verdict 如何反哺 placement policy

---

## 总体评价

| 阶段 | 整体评级 | 主要判断 |
|------|---------|---------|
| P0 (Contract Freeze) | 🟡 良好，需细化 | 框架对，gate criteria 和 casing 约定需补充 |
| P1 (Trace Substrate) | 🟡 良好，有前置隐患 | substrate 选择对，但 R2 archive 触发策略 provisional |
| P2 (Trace Foundation) | 🔴 **CRITICAL 问题** | `trace_uuid` 从未进入核心合同，是全链路最大漏洞 |
| P3 (Session Edge) | 🟡 良好，前置依赖 | 方向正确，但绕不开 P2 的 `traceUuid` 问题 |
| P4 (External Seam) | 🟡 良好，trace gap | 双路径策略正确，cross-seam trace 字段不存在 |
| P5 (Deployment Dry-Run) | 🟢 设计良好 | 三级阶梯务实，verdict bundle 思路正确 |
| P6 (Storage Evidence) | 🟢 设计良好 | 诚实的 evidence-first 方法，挂 `trace_uuid` 依赖 P2 |
| P7a (Workspace) | 🟢 设计良好 | workspace truth 定位准确，partial support 诚实 |
| P7b (Network/Script) | 🟡 良好，sandbox 空白 | 边界坚持对，ts-exec sandbox 实现未回答 |
| P7c (VCS/Policy) | 🟡 良好，语义空白 | 治理框架对，virtual git 语义未定义 |
| PX (Inventory) | 🟢 有价值 | E0-E3 分级是优秀的治理工具，transport vs runtime 评级需分离 |

**最优先解决项顺序**：C1（trace_uuid 进合同）→ C2（P3/P4 对 P2 的门控断言）→ H1（request_uuid required）→ H3（ts-exec sandbox）→ H2（P4→P5 前置依赖）

---

## 附录：关键代码事实对照

| 设计声明 | 实际代码位置 | 现实状态 |
|---------|------------|---------|
| P2: "升级 TraceEventBase 含 traceUuid" | `packages/eval-observability/src/trace-event.ts` | ❌ 无 `traceUuid` |
| P4: "cross-seam 携带 trace_uuid" | `packages/nacp-core/src/envelope.ts` | ❌ 无 `trace_uuid` 字段 |
| P3: "nacp-session 是 legality truth" | `packages/nacp-session/src/ingress.ts:25-74` | ✅ 准确 |
| P3: "WsController 仍是 stub" | `packages/session-do-runtime/src/ws-controller.ts:18-56` | ✅ 准确 |
| P4: "ServiceBindingRuntime 仍抛错" | `packages/hooks/src/runtimes/service-binding.ts` | ✅ 准确 |
| P4: "ServiceBindingTransport 有完整 precheck" | `packages/nacp-core/src/transport/service-binding.ts` | ✅ 准确，pipeline 完整 |
| P7a: "mkdir 只有 compat ack" | `packages/capability-runtime/src/capabilities/filesystem.ts` | ✅ 准确 |
| P7a: "rg 是 degraded TS scan" | `packages/capability-runtime/src/capabilities/search.ts:21-44` | ✅ 准确 |
| PX: "12 个 minimal commands" | `packages/capability-runtime/src/fake-bash/commands.ts:16-143` | ✅ 准确 |

---

*版本历史*

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|---------|
| v1.0 | `2026-04-18` | `Claude Sonnet 4.5` | 初稿，全量审查 15 份设计文件 |
