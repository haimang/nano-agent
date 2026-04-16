# Action-Plan Batch 2 审核报告 — Opus to GPT

> 审核对象:
> - `docs/action-plan/session-do-runtime.md`
> - `docs/action-plan/eval-observability.md`
> - `docs/action-plan/hooks.md`
> - `docs/action-plan/storage-topology.md`
> 审核者: `Claude Opus 4.6 (1M context)`
> 审核时间: `2026-04-16`
> 审核方法:
> 1. 逐份通读 4 份 action-plan 全文（共 ~2200 行）
> 2. 派出并行验证 agent 核查 NACP 包内 10 个关键符号/API（全部通过）
> 3. 直接验证 context/ 下 8 个引用文件的存在性与关键符号（全部通过）
> 4. 对照 `README.md` §1–§4 判断精神一致性
> 5. 对照 `docs/design/*-by-opus.md` 3 份设计文档（v0.2 修订版）判断跨文档对齐性
> 6. 对照 `docs/investigation/action-batch-1-reviewed-by-opus.md`（Batch 1 审核结论）判断跨批次连续性
> 7. 逐份检查 Q&A 回答是否已充分反映到计划正文中
> 文档状态: `reviewed`

---

## 0. 代码引用验证结果

### 0.1 NACP 包引用（10 项）

| 引用文件 | 引用符号 | 验证结果 |
|---------|---------|---------|
| `packages/nacp-core/src/messages/hook.ts` | `HookEmitBodySchema` / `HookOutcomeBodySchema` | ✅ lines 4-16 |
| `packages/nacp-core/src/messages/system.ts` | `AuditRecordBodySchema` | ✅ lines 10-14，已注册 "audit.record" |
| `packages/nacp-core/src/state-machine.ts` | `SessionPhase` / `NACP_ROLE_REQUIREMENTS` / `assertPhaseAllowed` / `assertRoleCoversRequired` | ✅ 全部存在 |
| `packages/nacp-session/src/ingress.ts` | `normalizeClientFrame()` | ✅ lines 25-74 |
| `packages/nacp-session/src/session-registry.ts` | `assertSessionPhaseAllowed()` / `assertSessionRoleAllowed()` | ✅ lines 94-104 / 38-52 |
| `packages/nacp-session/src/adapters/hook.ts` | `hookBroadcastToStreamEvent()` | ✅ lines 4-12 |
| `packages/nacp-session/src/heartbeat.ts` | `HeartbeatTracker` | ✅ lines 15-56 |
| `packages/nacp-session/src/delivery.ts` | `AckWindow` | ✅ lines 22-60 |
| `packages/nacp-core/src/tenancy/scoped-io.ts` | `tenantR2Put/Get` / `tenantKvGet/Put` / `tenantDoStoragePut/Get` | ✅ 全部存在，使用 `tenantKey()` 强制 namespace |
| `packages/nacp-core/src/envelope.ts` | `NacpRefSchema` tenant namespace constraint | ✅ lines 205-208: `.refine(r => r.key.startsWith(\`tenants/${r.team_uuid}/\`))` |

**结论：NACP 包引用 10/10 全部通过。**

### 0.2 Context 参考代码引用（8 项）

| 引用路径 | 关键符号 | 验证结果 |
|---------|---------|---------|
| `context/claude-code/utils/hooks.ts` | `PreToolUse` / `PostToolUse` / `UserPromptSubmit` hook events | ✅ 存在（159KB），含完整 hook event 体系 |
| `context/claude-code/utils/telemetry/events.ts` | telemetry events | ✅ 存在 |
| `context/claude-code/utils/sessionStorage.ts` | session storage / transcript | ✅ 存在（180KB） |
| `context/claude-code/services/api/logging.ts` | `tengu_*` telemetry events | ✅ 存在 |
| `context/codex/codex-rs/rollout/src/recorder.rs` | `RolloutRecorder` / `RolloutItem` / `SessionMeta` | ✅ line 75 / 56 / 58 |
| `context/codex/codex-rs/otel/src/events/session_telemetry.rs` | session telemetry | ✅ 存在（41KB） |
| `context/mini-agent/mini_agent/logger.py` | `AgentLogger` / `log_request` / `log_tool_result` | ✅ line 11 / 43 / 122 |
| `context/codex/codex-rs/rollout/` | rollout directory structure | ✅ 存在 |

**结论：Context 引用 8/8 全部通过。**

### 0.3 引用核查总结

> **18 项代码/符号引用全部通过验证。GPT 在 Batch 2 的引用准确性与 Batch 1 持平——无路径错误、无符号缺失。**

---

## 1. 总体评价

### 1.1 评级总览

| 文档 | 评级 | 核心判断 |
|------|------|----------|
| `session-do-runtime.md` | ⭐⭐⭐⭐⭐ (5/5) | Batch 1 审核指出的"缺少组装层 action plan"被完整回应。WebSocket-first + HTTP fallback 双入口、Session/Core phase 边界、turn ingress contract 三个 blocker 全部被正面处理。 |
| `hooks.md` | ⭐⭐⭐⭐⭐ (5/5) | 8 事件最小集 + outcome allowlist + dispatcher 的设计极其克制。对 `hook.broadcast` 作为唯一 client-visible kind 的坚持完全正确。 |
| `eval-observability.md` | ⭐⭐⭐⭐⭐ (5/5) | 三分法（Live/Durable Audit/Durable Transcript）被完整落实到 Phase 1 taxonomy。与 Opus 设计文档 v0.2 §5.3 完全对齐。 |
| `storage-topology.md` | ⭐⭐⭐⭐⭐ (5/5) | 最令人印象深刻的一份——把 Opus 设计文档的"provisional placement hypotheses"理念转化为可执行代码结构，evidence calibration seam 真正把"证据后收敛"写成了 contract 而非口号。 |

### 1.2 Batch 2 相较 Batch 1 的显著进步

1. **直接回应了 Batch 1 审核指出的盲点**
   - Batch 1 最大盲点"缺少 session-do-runtime 组装层"→ 本批直接提供了完整的 6-Phase plan
   - Batch 1 盲点"hooks 没有独立 action plan"→ 本批提供了完整的 5-Phase plan
   - Batch 1 盲点"四包之间的集成测试"→ session-do-runtime Phase 6 直接覆盖跨包 integration

2. **GPT 吸收了前一轮 review 的所有修正**
   - Session/Core phase 边界回退问题 → session-do-runtime §0 和 §2.3 显式声明"Session WebSocket legality 只走 `nacp-session`"
   - Turn ingress contract 缺失 → session-do-runtime S7/S8 显式处理 `session.start.initial_input` + future seam
   - Storage topology 过早冻结 → storage-topology 全面采用 "provisional hypothesis + evidence calibration" 架构

3. **全部计划都考虑了 WebSocket-first + HTTP fallback 双入口**
   - session-do-runtime: P2-02 WS controller + P2-03 HTTP fallback controller
   - eval-observability: S9 "WS-first + HTTP fallback-aware inspection"
   - hooks: §7.2 "WebSocket-first + HTTP fallback session delivery"
   - storage-topology: 间接通过 session-do-runtime 的 checkpoint/restore seam

---

## 2. 逐份审核

### 2.1 `session-do-runtime.md`

#### 做得对的地方

1. **明确定位为 runtime assembly layer 而非子系统实现全集**（§0）——这是正确的架构判断。"它负责编排、生命周期与入口，不负责重写下游子系统真相。"

2. **Phase 2 的 WS/HTTP 双入口设计**非常成熟：
   - Worker fetch 只做 routing（< 50 行）
   - WS path 严格消费 `normalizeClientFrame()`
   - HTTP fallback 共享同一 session model 和 output body
   - 不复制两套 runtime

3. **caller-managed health 被显式承担**（P3-02）——正确理解了 `SessionWebSocketHelper` 是 caller-managed 的事实。alarm 中显式调用 `checkHeartbeatHealth()` / `checkAckHealth()`。

4. **turn ingress contract 的处理完全正确**（S7/S8）：
   - `session.start.initial_input` 作为最小 e2e 入口
   - `TurnIngressAdapter` seam 为后续多轮输入预留
   - "不在本包里偷偷发明新的 wire truth"

5. **Q1 回答已充分反映**：v1 先以 `session.start.initial_input` 打通首个 turn，follow-up family 后续补到 Session profile。

#### 需要注意的问题

**问题 A（中等）：Q2 和 Q3 尚未回答**

Q2（HTTP fallback 是否支持写入口）和 Q3（archive/flush seam 触发责任）的 `A:` 字段为空。这两个问题直接影响 Phase 2 和 Phase 5 的实现范围。

**建议**：在执行前让业主回答。Q2 的推荐答案（"写入口最小可用 + 读取 durable + 实时流仍由 WS 承担"）是合理的。Q3 的推荐答案（"Session DO 只触发 seam，物理策略留给 storage-topology + observability"）也是合理的。

**问题 B（低）：wrangler.jsonc 的 DO binding 配置示例缺失**

P1-01 提到 `wrangler.jsonc`，但没有给出 DO class 导出和 binding 的示例配置。这对后续实际部署很关键。

**建议**：在 Phase 1 收口时补充最小 wrangler 配置示例，至少包含 `[durable_objects]` 的 `NanoSessionDO` binding。

### 2.2 `hooks.md`

#### 做得对的地方

1. **8 事件最小集极其克制**（S2）：`SessionStart / SessionEnd / UserPromptSubmit / PreToolUse / PostToolUse / PostToolUseFailure / PreCompact / PostCompact`——与 claude-code 的 `utils/hooks.ts` 中的事件体系完美对应，同时大幅收窄了范围。

2. **outcome allowlist 按事件类型区分**（S4）——这是关键的安全设计。不是所有事件都允许 `block` 或 `updatedInput`，只有 `PreToolUse` 允许 `updatedInput`（修改工具入参），只有 `Pre*` 事件允许 `block`。

3. **`hook.broadcast` 作为唯一 client-visible kind**（S12）——"严格对齐当前 `@nano-agent/nacp-session` reality，不新增 `hook.started` / `hook.finished` kind"。这直接避免了前一轮 review 中担心的"发明额外 Session event 宇宙"问题。

4. **service-binding runtime 复用 `NacpTransport` reality**（P3-03）——跨 worker hook 执行通过 `hook.emit` / `hook.outcome` Core 消息，不另造协议。

5. **snapshot/restore codec 进入 v1 scope**（P4-03）——正确理解了 DO hibernation 后 hook 行为必须可恢复的需求。

6. **三个 Q&A 全部已回答且反映充分**：
   - Q1：v1 不开放 skill 注册跨 resume 持久化 session hooks ✅
   - Q2：platform-policy fail-closed, session/observer fail-open ✅
   - Q3：audit 采用"最小可调试 detail + ref"策略 ✅

#### 需要注意的问题

**问题 A（低）：`SessionStart` 的 `source: startup|resume` 语义需要与 session-do-runtime 对齐**

边界判定表中说"用 `source: startup|resume` 表达恢复来源，避免单独发明 `SessionResume` 事件"。但 session-do-runtime 的 actor-state（P3-01）需要知道 attach vs resume 的区分。这两者的语义映射需要在实现时显式对齐。

**建议**：在 Phase 4 的 session mapping 中加入对 `source` 字段与 session-do-runtime actor state 的映射说明。

### 2.3 `eval-observability.md`

#### 做得对的地方

1. **三分法被完整落实**（§0 + S2 + S3）：
   - Live Session Stream：WebSocket-first 实时事件流
   - Durable Audit Trace：`audit.record` append-only JSONL
   - Durable Transcript：面向用户的归档视图
   
   这完美回应了 Opus 设计文档 v0.2 §5.3 的要求。

2. **"不是所有 `session.stream.event` 都必须 durable"被明确写入边界判定表**（§2.3 第 3 行）——`llm.delta` / `tool.call.progress` 全量 durable 被显式标记为 out-of-scope。

3. **Q3 回答非常有价值**：业主说"应该维护一个注册表...随时让我们回顾当前的粒度代表了什么的 replay 内容"。这意味着 durable promotion 不是一次性决策，而是需要一个**可审阅的注册表**来追踪"什么被 durable 化了、为什么"。

4. **Phase 4 的 evidence helpers 与 attribution**（P4-01/P4-02/P4-03）——把 trace 从"记录"升级为"能解释"，直接回应了 claude-code `promptCacheBreakDetection` 的归因模式。

5. **ScenarioRunner 不在生产 Worker 里常驻执行**（O9）——正确。

#### 需要注意的问题

**问题 A（中等）：Q3 回答要求的"注册表"未充分反映到计划正文**

业主说"我们应该维护一个注册表"，但计划中只有 `classification.ts` 和 `classification helper`。"注册表"意味着需要一个**可枚举、可审阅**的 durable promotion policy registry——列出"哪些事件被 durable 化了、durable 化的粒度是什么（全量/摘要/采样）、revisit 条件是什么"。

**建议**：在 Phase 1 的 `classification.ts` 中加入 `DurablePromotionRegistry` 类型，让每个 durable promotion 规则都是可枚举的 entry，而不是散落在 if/else 中的隐式判断。这与 storage-topology 的 "provisional placement + revisit" 模式一致。

**问题 B（低）：metric-names.ts 的命名基线是否与 codex 的 18 个 metric names 对齐**

P1-03 提到 `src/metric-names.ts`，但没有列出具体的命名列表。Opus 设计文档 §4.2 已经建议"沿用 `agent.turn.*` / `agent.tool.*` / `agent.api.*` 前缀"。

**建议**：在 Phase 1 收口时，metric names 应至少覆盖 codex 的 `names.rs:1-38` 中与 nano-agent 相关的层级（turn duration, tool call, api request, ttft 等）。

### 2.4 `storage-topology.md`

#### 做得对的地方

1. **"provisional hypothesis + evidence calibration" 架构是本批最大亮点**——把 Opus 设计文档中 GPT review 指出的"过早冻结"问题，转化成了一个**可执行的工程结构**：
   - `PlacementHypothesis` 类型自带 provisional 标记和 revisit 条件
   - `CalibrationHint` 和 `EvidenceSignal` 类型让重评变成代码而非文档
   - Phase 4 的 calibration rules 真正实现了"evidence → revisit → recommendation"闭环

2. **严格对齐当前代码 reality**（Phase 2）：
   - key builders 默认遵循 `tenants/{team_uuid}/...`
   - `NacpRef` 构造统一通过 builder
   - scoped-io adapter 与 `tenantR2*/tenantKv*/tenantDoStorage*` 对齐
   - 已验证 `NacpRefSchema` 确实有 `key.startsWith(\`tenants/${r.team_uuid}/\`)` refine

3. **`_platform/` 例外被正确 defer**（Q1 + 边界判定表）——"当前代码尚未正式支持"，不在 v1 偷渡。这与 Opus 设计文档 v0.2 中"声明 `_platform/` 为显式例外"的修订一致，但 action plan 更加克制——不先实现例外，只留决策空间。

4. **checkpoint candidate 是"候选字段集"而非"冻结结构"**（P3-02）——与 Opus 设计文档 v0.2 §7.2 的"候选字段集"标注完全一致。

5. **Q2 回答中业主追加了 mime_type 门禁**："可以，但一定需要有 mime_type 的门禁实现"——这与 Batch 1 中 llm-wrapper 和 capability-runtime 的 mime_type 路由需求形成一致要求。

#### 需要注意的问题

**问题 A（中等）：Q2 的 mime_type 门禁要求未充分反映到计划正文**

业主在 Q2 回答中说"一定需要有 mime_type 的门禁实现"，但计划正文的 Phase 3（placement hypotheses / checkpoint candidate）中没有显式引入 mime_type 作为 placement 决策的一个维度。

**建议**：在 P3-01 或 P3-02 中加入："workspace file 的 placement hypothesis 应包含 mime_type 作为决策输入之一。v1 先建立最小 mime_type → storage class 映射（如 `image/* → R2`、`text/* → DO inline candidate`），具体阈值由 evidence 校准。"

**问题 B（低）：Q3 回答的"留够上下文"要求**

业主说"必须要在代码中留够上下文。用于后续回顾。在后续轮次再进行决策。"这意味着 archive plan 不只是一个 type definition，还需要在代码注释或伴随文档中解释"为什么这个策略是 provisional 的、需要什么 evidence 才能冻结"。

**建议**：在 Phase 3 的收口标准中加入"每个 provisional plan 都附带一段 revisit rationale comment"。

---

## 3. 跨文档一致性检查

### 3.1 Batch 2 四份计划之间的依赖一致性

| 依赖关系 | 声明方 | 被依赖方 | 对齐状态 |
|---------|--------|---------|---------|
| session-do → kernel delegates | session-do P4-01 | kernel P1-04 delegates.ts | ✅ 一致 |
| session-do → nacp-session WebSocket helper | session-do P3-03 | nacp-session websocket.ts | ✅ 一致 |
| session-do → hooks dispatcher | session-do P4-02 | hooks P3-01 dispatcher.ts | ✅ 一致 |
| session-do → eval trace sink | session-do P5-03 | eval P2-01 sink.ts | ✅ 一致 |
| session-do → storage checkpoint | session-do P5-01 | storage P3-02 checkpoint-candidate.ts | ✅ 一致 |
| hooks → nacp-core hook.emit/outcome | hooks P3-03 | nacp-core messages/hook.ts | ✅ 一致 |
| hooks → nacp-session hook.broadcast | hooks P4-01 | nacp-session adapters/hook.ts | ✅ 一致 |
| hooks → nacp-core audit.record | hooks P4-02 | nacp-core messages/system.ts | ✅ 一致 |
| eval → nacp-core audit.record | eval P2-02 | nacp-core messages/system.ts | ✅ 一致 |
| eval → nacp-session 9 stream kinds | eval P3-01 | nacp-session stream-event.ts | ✅ 一致 |
| eval → storage placement log | eval P4-02 | storage P4-01 calibration.ts | ✅ 一致 |
| storage → nacp-core NacpRefSchema | storage P2-02 | nacp-core envelope.ts | ✅ 一致 |
| storage → nacp-core scoped-io | storage P2-03 | nacp-core tenancy/scoped-io.ts | ✅ 一致 |

**结论：四份计划之间的依赖声明全部一致，无断裂点。**

### 3.2 与 Batch 1 的跨批次一致性

| Batch 1 决策 | Batch 2 对应 | 对齐状态 |
|-------------|------------|---------|
| kernel: single-active-turn | session-do: S9 single-active-turn guard | ✅ |
| kernel: delegate-based | session-do: P4-02 delegate wiring | ✅ |
| kernel: compact 由外部引擎 | session-do: compact trigger seam | ✅ |
| llm: Chat Completions 唯一 wire | session-do: delegates wiring 不改 llm contract | ✅ |
| llm: PreparedArtifactRef = NacpRef wrapper | storage: refs.ts builder | ✅ |
| capability: fake bash 仓内重写 | session-do: S11 delegates 不重写 | ✅ |
| workspace: mount-based truth | session-do: composition factory 消费 workspace | ✅ |

**结论：Batch 2 与 Batch 1 的所有结构性决策完全连续。**

### 3.3 与 Opus 设计文档 v0.2 的对齐

| Opus 设计文档修订 | Batch 2 对应 | 对齐状态 |
|-----------------|------------|---------|
| session-do-runtime v0.2: Session/Core phase 边界 | session-do §0 + S5 | ✅ |
| session-do-runtime v0.2: turn ingress contract S5b | session-do S7/S8 + Q1 | ✅ |
| session-do-runtime v0.2: single-active-turn | session-do S9 | ✅ |
| session-do-runtime v0.2: checkpoint 触发点扩展 | session-do P5-01 | ✅ |
| session-do-runtime v0.2: 附录 B.1 RuntimeEvent 映射表 | hooks P4-01 + eval P3-01 | ✅ |
| session-do-runtime v0.2: 附录 B.2 ArtifactRef = NacpRef | storage P2-02 | ✅ |
| session-do-runtime v0.2: 附录 B.3 compact 触发权 | session-do orchestration | ✅ |
| eval-observability v0.2: 三分法 §5.3 | eval S3 + Phase 1 taxonomy | ✅ |
| eval-observability v0.2: TraceEvent evidence extensions | eval P4-03 evidence adapters | ✅ |
| eval-observability v0.2: ResponseDebugContext | eval P4-01 attribution | ✅ |
| storage-topology v0.2: provisional hypotheses | storage Phase 3 全面 provisional | ✅ |
| storage-topology v0.2: `_platform/` 例外 | storage Q1 defer | ✅ |
| storage-topology v0.2: checkpoint 候选字段集 | storage P3-02 candidate | ✅ |

**结论：Batch 2 与 Opus 设计文档 v0.2 的所有修订项全部对齐。**

---

## 4. Q&A 完整性审查

### 4.1 已回答问题

| 计划 | Q# | 状态 | 反映到正文 |
|------|-----|------|-----------|
| session-do | Q1 | ✅ 已回答 | ✅ 充分 |
| session-do | Q2 | ❌ **未回答** | — |
| session-do | Q3 | ❌ **未回答** | — |
| eval | Q1 | ✅ 已回答 | ✅ 充分 |
| eval | Q2 | ✅ 已回答 | ✅ 充分 |
| eval | Q3 | ✅ 已回答 | ⚠️ "注册表"要求未充分反映 |
| hooks | Q1 | ✅ 已回答 | ✅ 充分 |
| hooks | Q2 | ✅ 已回答 | ✅ 充分 |
| hooks | Q3 | ✅ 已回答 | ✅ 充分 |
| storage | Q1 | ✅ 已回答 | ✅ 充分 |
| storage | Q2 | ✅ 已回答 | ⚠️ mime_type 门禁未充分反映 |
| storage | Q3 | ✅ 已回答 | ⚠️ "留够上下文"要求未充分反映 |

### 4.2 需要业主回答的问题

**Q-Pending-1（session-do Q2）**：HTTP fallback 是否同时支持最小写入口 + durable 读取？

**Q-Pending-2（session-do Q3）**：Session DO 是否只承担 archive/flush 触发责任？

这两个问题的推荐答案都是合理的，建议业主直接采纳。

### 4.3 不需要新增的 Q&A

与 Batch 1 不同，Batch 2 没有需要新增的重大问题。四份计划覆盖了所有已知的架构决策点。

---

## 5. 盲点与断点分析

### 5.1 已识别的盲点

**盲点 1（中）：跨 10 个包的完整集成测试时序**

nano-agent 现在有 10 个包级 action plan：nacp-core、nacp-session、kernel、llm-wrapper、capability-runtime、workspace、hooks、eval-observability、storage-topology、session-do-runtime。session-do-runtime Phase 6 覆盖了组装层集成测试，但"先跑哪些包的 Phase 1、何时开始跨包 mock 对接"没有一份总体编排文档。

**建议**：在 `plan-after-nacp.md` 中补充一份 10-package 执行时序图，标出并行机会和关键依赖路径。

**盲点 2（低）：HTTP fallback 的 session resume 语义**

session-do-runtime 很好地处理了 WebSocket 的 attach/resume/detach 语义，但 HTTP fallback 的"resume"语义不太一样——HTTP 是 stateless 请求，每次请求都需要重新认证和定位 session。这个差异在 P2-03 中没有被显式讨论。

**建议**：在 Phase 2 的 HTTP controller 中加入"session identification via request header/path parameter"的说明，确保 HTTP 请求能定位到正确的 DO 实例。

### 5.2 执行顺序建议

```
Phase 1（可全部并行）:
  session-do P1 ──┐
  hooks P1 ───────┤ 都只依赖 nacp-core / nacp-session
  eval P1 ────────┤
  storage P1 ─────┘

Phase 2:
  storage P2 ── 独立（key/ref builders）
  eval P2 ──── 独立（sink/codec/timeline）
  hooks P2-P3 ── 独立（registry/dispatcher/runtime）
  session-do P2 ── 需要 nacp-session ingress reality

Phase 3-4:
  storage P3-P4 ── 需要 eval P4 的 StoragePlacementLog seam
  eval P3-P4 ──── 需要 nacp-session stream-event reality
  hooks P4 ─────── 需要 nacp-session adapters/hook.ts + nacp-core messages
  session-do P3-P5 ── 需要 kernel + hooks + eval + workspace + storage 的 Phase 1 类型

Phase 5-6:
  所有包 Phase 5 收口 → session-do Phase 6 最终集成
```

**推荐**：storage P1-P2 和 eval P1-P2 可以最先启动（只依赖 nacp 包），hooks P1-P3 紧随其后，session-do P2-P6 最后（依赖所有其他包的类型）。

---

## 6. 总结性陈述

### 6.1 一句话概括

> **Batch 2 的 4 份 action plan 完整回应了 Batch 1 审核指出的三个盲点（组装层缺失、hooks 缺失、跨包集成缺失），在代码引用准确性、NACP 基座对齐和 Opus 设计文档对齐方面保持了与 Batch 1 同等的高水平。最显著的进步是 storage-topology 的"provisional hypothesis + evidence calibration"架构——这是整个项目方法论从文档口号到工程结构的真正转化。**

### 6.2 最终 Verdict

| 文档 | Verdict | 前置条件 |
|------|---------|---------|
| `session-do-runtime.md` | **✅ 通过，需先回答 Q2/Q3** | 业主回答 HTTP fallback 写入口和 archive 触发责任 |
| `hooks.md` | **✅ 通过，可直接执行** | 无 |
| `eval-observability.md` | **✅ 通过，建议补 DurablePromotionRegistry** | 在 classification.ts 中加入可枚举的 durable promotion 注册表 |
| `storage-topology.md` | **✅ 通过，建议补 mime_type 作为 placement 输入** | 在 placement hypothesis 中加入 mime_type 维度 |

### 6.3 对业主的建议

1. **最优先**：回答 session-do-runtime Q2（HTTP fallback 写入口）和 Q3（archive 触发责任）
2. **次优先**：让 GPT 在 eval-observability classification.ts 中加入 DurablePromotionRegistry
3. **次优先**：让 GPT 在 storage-topology placement.ts 中加入 mime_type 作为 placement 输入维度
4. **可立即并行启动**：所有 4 份计划的 Phase 1
5. **后续**：补充 10-package 执行时序总图

### 6.4 关于两批 action plan 的总体评价

Batch 1 + Batch 2 合计 8 份 action plan（加上已完成的 nacp-core 和 nacp-session 共 10 份），覆盖了 nano-agent 从协议层到运行时组装层的完整技术栈。GPT 在以下方面表现优异：

- **代码引用准确性**：两批合计 51 项引用全部通过验证
- **NACP 基座消费**：所有计划都以已实现代码为 source of truth，不绕开协议
- **设计文档吸收**：Opus v0.2 修订版的所有修正（phase 边界、turn ingress、provisional placement、三分法等）都被完整吸收
- **跨批次连续性**：Batch 2 直接回应了 Batch 1 的审核意见，无遗漏

**nano-agent 的 10 份 action plan 已形成完整、自洽、可执行的技术蓝图。**

---

## 附录

### A. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v1.0 | 2026-04-16 | Opus 4.6 | 初版审核报告 |
