# Plan After NACP — Opus 生成设计文档审核报告

> 审核者: Kimi (k2p5)
> 审核对象:
> - `docs/design/eval-observability-by-opus.md`
> - `docs/design/session-do-runtime-by-opus.md`
> - `docs/design/storage-topology-by-opus.md`
> 审核依据:
> - `README.md` (项目精神与技术栈前提)
> - `docs/action-plan/nacp-core.md` (NACP-Core 协议基座)
> - `docs/action-plan/nacp-session.md` (NACP-Session 协议基座)
> - `docs/plan-after-nacp.md` (阶段规划与缺口定义)
> - 已实现的 `packages/nacp-core/` 与 `packages/nacp-session/`
> - `context/mini-agent/`, `context/codex/`, `context/claude-code/`, `context/just-bash/` (代码事实)
> 审核日期: 2026-04-16

---

## 0. 审核方法论

本次审核采用四维验证框架：

1. **README 精神一致性**: 是否坚持 Cloudflare-native、WebSocket-first、DO-centered、无真实 Linux 宿主假设、fake bash 作为 compatibility surface。
2. **NACP 基座真实性**: 是否正确消费已实现的 NACP-Core 与 NACP-Session 代码（而非仅引用 action-plan 文档），避免重复发明。
3. **代码事实映射**: 对 mini-agent / codex / claude-code 的吸收是否准确，批判是否合理，经验迁移是否可行。
4. **演进可支撑性**: 设计是否为后续 action-plan 执行提供了稳定、可测试、可迭代的 seam。

---

## 1. 总体结论（TL;DR）

| 文档 | 评级 | 核心判断 |
|------|------|----------|
| `eval-observability-by-opus.md` | ⭐⭐⭐⭐⭐ (5/5) | 最出色的一份。对 codex OTEL/rollout 和 claude-code telemetry/cache-break-detection 的吸收极其精准，与 NACP `audit.record` 和 `session.stream.event` 的衔接自然。
| `session-do-runtime-by-opus.md` | ⭐⭐⭐⭐⭐ (5/5) | 架构扎实，lifecycle 映射清晰，与已实现的 `nacp-session` WebSocket/replay/checkpoint 接口直接对齐。对 codex `StoredThread` 和 claude-code `autoCompact` 的迁移非常到位。
| `storage-topology-by-opus.md` | ⭐⭐⭐⭐⭐ (5/5) | 极其具体：提供了完整的 key schema 常量、checkpoint 格式、三层数据分布表。真正践行了 `plan-after-nacp` "由验证反推 storage" 的语义层先行方法论。

**综合判断**: 三份文档整体质量非常高，全部符合 README 精神与 NACP 基座方向，与已实现的 `packages/nacp-core/` 和 `packages/nacp-session/` 代码直接对齐，能够强有力地支撑后续演进。

**存在的共同问题**: 只有一个——`session-do-runtime` 在实现顺序判断上与 `plan-after-nacp.md` §5.1 存在细微分歧（Opus 认为 Session DO 应在 kernel 之后实现，而 `plan-after-nacp` 明确将 Session DO Skeleton 放在 kernel 之前作为第一批）。这不是设计错误，而是工程顺序上的认知差异，需要业主拍板。

---

## 2. `eval-observability-by-opus.md` 逐条审核

### 2.1 与 README 精神的一致性

**结论: ✅ 高度一致**

- 文档明确将 observability 定义为 "验证基础设施"，回答 "主循环是否正确工作" 这个问题 (§2.1)，这与 README 强调的 "可治理、可恢复、对产品可嵌入" 完全一致。
- 坚持了 Worker 环境没有本地 terminal stdout 的核心约束 (§0.1)，因此所有调试必须走结构化事件——这是 Cloudflare-native 宿主的正确推理。
- 将多租户审计按 `team_uuid` 分区 (§0.1, §5.1 S1)，与 README 和 NACP-Core 的 tenancy-first 设计对齐。
- 明确砍掉生产级 APM / DataDog / LLM quality benchmarks (§5.2)，体现了 v1 的克制。

### 2.2 与 NACP 基座及已实现代码的契合度

**结论: ✅ 精准对齐，且直接消费了已实现代码**

- 文档引用 `packages/nacp-core/src/messages/system.ts` 的 `AuditRecordBodySchema` (§8.1)，以及 `packages/nacp-session/src/stream-event.ts` 的 9 kinds (§8.2)。我验证了这两个文件确实存在且内容匹配：
  - `system.ts` 确实定义了 `AuditRecordBodySchema` (`{event_kind, ref?}`)
  - `stream-event.ts` 确实定义了 9 种 `SessionStreamEventBody`：`tool.call.progress`, `tool.call.result`, `hook.broadcast`, `session.update`, `turn.begin`, `turn.end`, `compact.notify`, `system.notify`, `llm.delta`
- 这意味着 Opus 不是 "参考设计文档"，而是 **直接阅读了已实现的 nacp-session 代码** 来做 observability 设计。这比 GPT 生成的文档更贴近代码事实。
- 文档正确利用了 NACP-Core 的 `control.audience` (internal / audit-only / client-visible) 和 `redaction_hint` (§0.2) 来做 trace 的 audience gate (§5.1 S8)。

### 2.3 代码事实映射的准确性

**结论: ✅ 极其精准，借鉴成熟**

- **codex** (§4.2):
  - `codex-rs/otel/src/names.rs:1-38` 的 18 个 metric name 层级（`codex.tool.call` / `codex.turn.e2e_duration_ms` 等）→ 被准确提炼为 nano-agent 的 `agent.turn.*` / `agent.tool.*` / `agent.api.*` 前缀。
  - `RolloutRecorder` JSONL + 10KB output 截断（`recorder.rs:189-212`）→ 被准确迁移为 DO storage JSONL audit trail 的 truncation 策略。
  - `RequestDebugContext` 的 header 提取 pattern（`response-debug-context/src/lib.rs`）→ 被准确识别为 LLM executor 错误诊断的直接模板。
  - **不照抄 OTEL SDK** 的判断正确：Worker 里没有完整 OTEL runtime。

- **claude-code** (§4.3):
  - `promptCacheBreakDetection.ts` 的 DJB2 hash + `pendingChanges` diff 归因 → 被识别为 "observability 从记录升级到归因的关键模式"，并建议 **直接照搬**。这是三家里最精细的 cache observability 实现，Opus 的眼光非常准。
  - `_PROTO_*` PII prefix + `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` type guard → 被映射到 NACP 的 `redaction_hint`，对应关系自然。
  - `tengu_api_success` 的 per-tool content length tracking → 被指出对 storage topology 决策有直接价值。这是跨文档协同思维的体现。
  - Gateway fingerprint detection（`logging.ts:65-105`）→ 被保留为 multi-provider 场景的识别 pattern。

- **mini-agent** (§4.1):
  - `AgentLogger` 的 entry format（`[{index}] {TYPE}\nTimestamp: {ISO}\n---\n{JSON}`）→ 被作为 "最简 trace event 模板" 借鉴。
  - 正确批判 plain-text log 不可程序化 parse。

### 2.4 演进可支撑性

**结论: ✅ 优秀**

- `TraceSink` 接口 + `DoStorageTraceSink` 实现 (§7.1 F1-F2) 极其轻量，可直接在 v1 落地。
- `ScenarioRunner` (§7.1 F7) 的设计虽不复杂，但被明确定位为 "独立 test harness"，不会污染 production worker。
- `StoragePlacementLog` (§7.1 F9) 直接服务 storage-topology 的证据需求，体现了 `plan-after-nacp` 的核心方法论。

### 2.5 本文件的 verdict

> **三份文档中对参考代码吸收最深入、与 NACP 已实现代码衔接最自然的一份。 codex 的 rollout/OTEL 和 claude-code 的 promptCacheBreakDetection 都被精准转化为 nano-agent 的 Worker-native 方案。**

---

## 3. `session-do-runtime-by-opus.md` 逐条审核

### 3.1 与 README 精神的一致性

**结论: ✅ 高度一致**

- 文档将 Session DO 定位为 "物理心脏" 和 "唯一 actor" (§2.3)，完全契合 README 的 "DO-centered" 核心定位。
- 坚持 "一个 Session = 一个 DO" (§6.1 取舍 1)，明确排除多 DO 联邦、sub-agent spawning、多客户端 observer mode (§3.1)，与 README "单 agent、单线程为早期核心" 的 trade-off 对齐。
- 明确 Worker entry 只做 routing (< 50 行)，不做业务逻辑 (§3.3)，体现了 Worker/DO 分离的 Cloudflare-native 架构。
- 将 checkpoint/restore 绑定到 DO hibernation lifecycle (§7.1 F6)，符合 "stateful、可恢复" 的产品目标。

### 3.2 与 NACP 基座及已实现代码的契合度

**结论: ✅ 精准对齐，直接引用已实现代码**

- 文档大量引用 `packages/nacp-session/src/` 下的**实际实现文件**：
  - `websocket.ts` 的 `SessionWebSocketHelper` (§8.1)
  - `ingress.ts` 的 `normalizeClientFrame()` (§8.1)
  - `session-registry.ts` 的 `assertSessionPhaseAllowed()` (§8.1)
  - `replay.ts` 的 `ReplayBuffer.checkpoint()` / `.restore()` (§8.1)
- 我验证了这些文件确实存在，且 API 签名与文档描述一致。例如 `websocket.ts` 确实有 `attach()` / `detach()` / `pushEvent()` 方法；`replay.ts` 确实有 `checkpoint()` 返回 `Record<string, {events, baseSeq}>`。
- 文档同样引用了 `packages/nacp-core/src/` 的实际实现：
  - `transport/service-binding.ts` 的 `ServiceBindingTransport`
  - `tenancy/boundary.ts` 的 `verifyTenantBoundary()`
  - `admissibility.ts` 的 `checkAdmissibility()`
- 附录 A 的 Durable Object Lifecycle 映射 (§A) 非常具体，将 CF Worker `fetch` → `NanoSessionDO.fetch()` → `webSocketMessage()` → `webSocketClose()` → `alarm()` 的完整链路画清楚了。这是可直接转给开发者的蓝图。

### 3.3 代码事实映射的准确性

**结论: ✅ 非常准确，迁移判断成熟**

- **codex** (§4.2):
  - `StoredThread` 的 22 字段（`thread-store/types.ts:135-178`）→ 被作为 DO checkpoint 字段清单的直接参考。
  - `ThreadConfigSnapshot` vs `CodexThread` 的分层 → 被映射为 "DO storage 持久态 vs isolate-local 临时态"，非常自然。
  - `RolloutRecorder` JSONL 格式 → 被作为 nano-agent 审计日志模板。
  - Auto-compact trigger（`codex.rs:6404-6724`）的双检查点（post-sampling + pre-turn）+ `CompactionPhase` enum → 被建议用于 Session DO 的 compact trigger 逻辑。
  - **不照抄 SQLite state DB** 的判断正确（v1 不引入 D1）。

- **claude-code** (§4.3):
  - `AutoCompactTrackingState` 的 circuit breaker（`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES=3`）+ `effectiveWindow - 13000` 阈值（`autoCompact.ts:72-91`）→ 被标记为 **直接照搬**。我验证了 `autoCompact.ts` 确实存在这些常量，Opus 的迁移建议非常务实。
  - `cost-tracker.ts` 的 per-session per-model usage tracking + `restoreCostStateForSession()` → 被建议纳入 DO checkpoint。
  - `sessionStorage.ts` 的 `flushSessionStorage()` 锁定后批量追加 → 被对应到 DO `webSocketClose` 时的 checkpoint 逻辑。
  - Settings 4 层 cascade（`settings.ts:58-199`）→ 被映射为 KV shared config 多层合并。
  - **不照抄 React DeepImmutable store** 的判断正确。

- **mini-agent** (§4.1):
  - `_check_cancelled()` + `_cleanup_incomplete_messages()`（`agent.py:90-121`）→ 被映射为 Session DO 的 abort 路径。
  - `_summarize_messages()` 的 user-boundary 切分 → 被作为 compact 最简模型借鉴。
  - 正确批判纯内存模型无法恢复。

### 3.4 演进可支撑性

**结论: ✅ 优秀，但有一个实施顺序分歧**

- 文档对 Session DO 的职责边界定义非常清晰："编排 glue" (~500-800 行)，把 kernel output 路由到 WebSocket / storage / hooks / audit (§9.1)。
- 功能清单 F1-F13 (§7.1) 覆盖了从 Worker entry 到 tenant enforcement 的完整生命周期，可以直接转化为 action-plan 工作项。
- **实施顺序分歧** (§9.3): Opus 认为 "Session DO 的 action-plan 应当是 **post-kernel** 的第一个执行项"。但 `plan-after-nacp.md` §5.1 明确说：
  > "第一批：先做能跑通最小 session turn 的骨架
  > 1. **Session DO Runtime Skeleton**
  > 2. **Agent Runtime Kernel**"

  并且 §5.1 的解释是："先搭 Session DO 的 WebSocket attach/resume/checkpoint，再把 kernel 装进去"。

  Opus 的观点（kernel 先设计/实现，再装到 Session DO 里）从依赖关系上看也有道理（kernel 的接口不确定，DO 的编排不好写）。但 `plan-after-nacp` 强调的是 "先让 DO 能跑通最小生命周期，再填 kernel"，这是一种 "自下而上" 的骨架策略。这个分歧需要业主明确拍板。

### 3.5 本文件的 verdict

> **架构极其扎实，lifecycle 映射可直接落地，与已实现的 nacp-session 代码无缝衔接。唯一需要业主拍板的是实施顺序：是按 `plan-after-nacp` 的 "Session DO Skeleton → Kernel" 顺序，还是按 Opus 建议的 "Kernel → Session DO" 顺序。**

---

## 4. `storage-topology-by-opus.md` 逐条审核

### 4.1 与 README 精神的一致性

**结论: ✅ 高度一致**

- 文档开篇就声明 "这是 storage semantics 设计文档，不是数据库 schema 设计文档" (§0.1)，完全拥抱 `plan-after-nacp` "先设计语义层、后由验证反推物理层" 的方法论。
- 明确 v1 **不引入 D1** (§3.1, §5.2, §6.1 取舍 3)，与 README "D1 不是必需前提" 和 `plan-after-nacp` "DDL 不是第一步" 完全一致。
- 坚持 DO storage 作为唯一 hot state (§6.1 取舍 1)，KV 只放读多写少的 shared config (§6.1 取舍 2)，R2 放 cold archive + large objects。这与 README §3 的技术栈选型完全吻合。

### 4.2 与 NACP 基座及已实现代码的契合度

**结论: ✅ 精准对齐**

- 直接消费 `NacpRefSchema` (§8.1) 来定义 refs 的 `kind/key/team_uuid` 约束。
- 直接消费 `nacp-core/src/tenancy/scoped-io.ts` (§8.1) 的 `tenantR2Put/Get/List` + `tenantKvGet/Put` + `tenantDoStoragePut/Get`，确认所有 I/O 走 tenant-scoped 包装。
- 直接消费 `nacp-session/src/websocket.ts` 和 `replay.ts` (§8.2) 的 `checkpoint()` / `restore()` 来定义 DO storage 的持久化接口。
- §7.2 的 `SessionCheckpoint` 接口中明确包含 `nacp_session_replay` 和 `nacp_session_stream_seqs` 字段，与 `ReplayBuffer.checkpoint()` 的返回类型 `Record<string, {events, baseSeq}>` 完全匹配。
- §7.3 的 `R2_KEYS` 和 `KV_KEYS` 全部以 `tenants/{team_uuid}/` 开头，与 NACP-Core 的 tenant namespace 规则一致。

### 4.3 代码事实映射的准确性

**结论: ✅ 极其准确**

- **codex** (§8.3):
  - `StoredThread` 22 字段 → 被作为 DO checkpoint 字段集参考。
  - `ThreadEventPersistenceMode: Limited | Extended` → 被映射为 nano-agent 的审计深度两档 `compact` vs `full`。
  - Rollout 的 `sessions/YYYY/MM/DD/` 目录结构 → 被作为 R2 archive key 的 date-partitioned 结构。
  - Config 多层加载（`config_loader/mod.rs:89-112`）→ 被映射为 KV config cascade 层级模型。

- **claude-code** (§8.4):
  - `history.ts:25-31` 的大 paste hash reference（inline < 1024 bytes）→ 被升级为 "DO inline < 1MB，大对象存 R2 只留 `NacpRef`"。这个 scale-up 非常合理。
  - `autoCompact.ts` 的 `effectiveContextWindow - 13000` + circuit breaker → 被用于 compact demotion 触发条件。
  - `cost-tracker.ts` 的 usage tracking + `restoreCostStateForSession()` → 被纳入 DO checkpoint 字段。
  - `sessionStorage.ts` 的 50MB tombstone rewrite limit → 被作为 DO storage 归档阈值参考。
  - `cachePaths.ts` 的 DJB2 hash for > 200 chars → 被作为 R2 key 长路径处理策略。

- **mini-agent** (§8.5):
  - `.agent_memory.json` lazy init → 被映射为 "不 checkpoint 就不写" 的 DO storage 策略。
  - 3 层 config priority → 被作为 KV config 最小层级模型。

### 4.4 演进可支撑性

**结论: ✅ 优秀，极其具体**

- 这是六份设计文档（GPT 三份 + Opus 三份）中**最具体、最接近可直接编码**的一份。
- §7.1 的 "三层数据分布表" 明确列出了 20+ 种数据条目的 placement 决策、key schema、读写频率、大小预估和理由。例如：
  - `session:phase` / `session:messages` / `nacp_session:replay` 在 DO storage
  - `tenants/{t}/config/providers` / `models` / `skills` 在 KV
  - `tenants/{t}/sessions/{s}/archive/{range}.jsonl` / `attachments/{uuid}` 在 R2
- §7.2 给出了 `SessionCheckpoint` 的完整 TypeScript interface。
- §7.3 给出了 `storage-keys.ts` 的完整常量定义（`DO_KEYS` / `KV_KEYS` / `R2_KEYS`）。
- §7.4 明确了 Demotion (hot→cold) 和 Promotion (cold→hot) 的触发条件。

- **一个可优化的细节**: `SessionCheckpoint.messages: CanonicalMessage[]` 中存储完整 message history。对于长会话，这个数组可能非常大。虽然 topology 文档在 §7.1 和 §7.4 中定义了 compact 会把旧 turn 归档到 R2，但没有明确说明 `session:messages` 在 compact 后如何被替换（是变成摘要消息 + `NacpRef[]`，还是被截断？）。建议补充一句话：`session:messages` 在 compact 后会被 `CompactBoundaryManager` 替换为 `CompactBoundaryRecord[] + recentMessages[]`，其中旧 turn 的完整内容通过 `NacpRef` 指向 R2 archive。

### 4.5 本文件的 verdict

> **六份设计文档中最接近可直接编码的一份。三层数据分布表、checkpoint 格式、key schema 常量都提供了可直接转给开发者的具体定义。与 NACP 多租户规则和 `nacp-session` 的 checkpoint 接口完全对齐。建议补充 `session:messages` 在 compact 后的结构变化说明。**

---

## 5. 跨文档一致性与断点分析

### 5.1 三份 Opus 文档之间的协同性

| 协同点 | 表现 | 评价 |
|--------|------|------|
| **Session DO ↔ Storage Topology** | Session DO 的 checkpoint 格式 (§7.2 session-do-runtime, §7.2 storage-topology) 完全对齐 | ✅ 高度一致 |
| **Eval ↔ Storage Topology** | `StoragePlacementLog` (eval §7.1 F9) 直接消费 storage-topology 的 key schema | ✅ 高度一致 |
| **Session DO ↔ Eval** | Session DO 是 "最大事件源" (eval §2.2)，其 emit 的 trace events 走 `audit.record` | ✅ 高度一致 |
| **NACP-Session ↔ Storage Topology** | replay buffer checkpoint 格式与 `SessionCheckpoint.nacp_session_replay` 字段匹配 | ✅ 已实现代码级一致 |

### 5.2 Opus 文档与 GPT 文档的协同性

| 边界 | GPT 文档 | Opus 文档 | 协同评价 |
|------|---------|----------|---------|
| **Agent Kernel ↔ Session DO** | GPT 定义了 `StepScheduler` / `InterruptController` / `RuntimeEventEmitter` | Opus 定义了 Session DO 如何调用 kernel 并路由事件 | ⚠️ 需要一次联审确认 `RuntimeEventEmitter` 的 event kinds 与 `session.stream.event` 的 9 kinds 如何映射 |
| **Capability Runtime ↔ Session DO** | GPT 定义了 `CapabilityExecutor` / progress contract | Opus 定义了 Session DO 通过 `ServiceBindingTransport` 调用 capability worker | ✅ 基本对齐 |
| **Workspace/Artifacts ↔ Storage Topology** | GPT 定义了 `WorkspaceSnapshotBuilder` / `ArtifactRef` | Opus 定义了 `SessionCheckpoint` 中 `workspace_files` + `workspace_refs` 的具体字段 | ⚠️ 需要联审确认 `ArtifactRef` 是否直接复用 `NacpRefSchema`（Opus 的 `SessionCheckpoint` 中写的是 `NacpRef[]`，这暗示了复用，但 GPT 文档没有明确说明） |

### 5.3 已解决的先前断点

在 `docs/nacp-reviewed-by-GPT.md` 和 `docs/action-plan/nacp-session.md` §11 中，Opus 曾指出 GPT 的 nacp-session 计划有 4 个需要澄清的接口问题（I1-I4）。现在这些问题在 `session-do-runtime-by-opus.md` 和 `storage-topology-by-opus.md` 中得到了很好的回答：

- **I1** (Session 对 Core 的 import 清单): Session DO 明确引用了 `ServiceBindingTransport`、`verifyTenantBoundary`、`checkAdmissibility` 等具体符号 (§8.2 session-do-runtime)。
- **I2** (`frame.ts` extend `NacpEnvelopeBaseSchema`): 已验证 `packages/nacp-session/src/frame.ts` 确实 extend 了 Core envelope（`NacpSessionFrame` 类型在 `websocket.ts` 中被使用）。
- **I3** (stream_id / stream_seq 是否 required): `stream-event.ts` 的 9 kinds 通过 `SessionWebSocketHelper.pushEvent()` 消费，`streamSeqCounters` 是 per-stream 的 (§R1 fix in websocket.ts)。
- **I4** (error codes 兼容性): `storage-topology` 和 `eval-observability` 都直接引用了 `NacpRefSchema` 和 tenant-scoped error codes。

### 5.4 仍存在的跨文档断点

**断点 1: `RuntimeEventEmitter` 的 event catalog 与 `session.stream.event` kinds 的映射**

- GPT 的 `agent-runtime-kernel` 定义了 `RuntimeEventEmitter` 产出 "turn 开始、llm delta、tool progress、compact 边界、turn 结束" 等 events。
- Opus 的 `nacp-session` 已实现代码定义了 9 种 `SessionStreamEventBody`。
- 但六份文档中**没有任何一份给出明确的 1:1 映射表**。例如：kernel 的 "tool progress" runtime event 是否直接就是 `session.stream.event` 的 `tool.call.progress` kind？kernel 的 "turn 开始" 是否就是 `turn.begin`？虽然直觉上成立，但应该在 cross-doc review 中显式冻结。

**断点 2: ArtifactRef 与 `NacpRefSchema` 的关系**

- Opus 在 `SessionCheckpoint` 中使用了 `workspace_refs: NacpRef[]` (§7.2 storage-topology)，暗示 `ArtifactRef` 直接复用 `NacpRef`。
- 但 GPT 的 `workspace-context-artifacts` 中定义的是 `ArtifactRef Model` 和 `Prepared Artifact Pipeline`，没有明确说 "ArtifactRef = NacpRef + 业务字段"。
- 这个语义需要在 cross-doc review 中明确：nano-agent 的 artifact ref 是否**就是** `NacpRefSchema` 的实例（可能在 `extra` 字段中加 prepared/preview 元数据），还是 artifact ref 是一个独立的、内部包含 `NacpRef` 的 richer 类型？

**断点 3: Compact 触发权归属**

- GPT 的 `agent-runtime-kernel` 说 compact 是 "kernel 决定何时 compact" (§5.1 S1)。
- Opus 的 `session-do-runtime` 吸收了 claude-code 的 `AutoCompactTrackingState` 和 codex 的 `auto_compact_token_limit`，将 compact trigger 放在 Session DO 内 (§4.2 codex, §4.3 claude-code)。
- 这之间存在微妙的职责重叠：是 kernel 的 `StepScheduler` 在调度到某一步时触发 compact，还是 Session DO 在收到用户输入前 / LLM 调用后检查 token 阈值并触发 compact？
- 建议明确：compact 的**策略判定**（token 是否超阈值）放在 Session DO 或 kernel 都可以，但**触发动作**（调用 `context.compact.request`）必须由 Session DO 执行，因为 compact 涉及 workspace 与 R2 的交互，这是 DO runtime 的职责。

**断点 4: 实施顺序分歧**

- `plan-after-nacp.md` §5.1: Session DO Skeleton **第一批第 1 项**，Agent Runtime Kernel **第一批第 2 项**。
- Opus `session-do-runtime` §9.3: "Session DO 的 action-plan 应当是 **post-kernel 的第一个执行项**"。
- 这个分歧虽然不影响设计正确性，但会直接影响项目排期和 action-plan 编写。需要业主拍板。

---

## 6. 是否符合后续演进要求

### 6.1 对 Session DO Runtime Action-Plan 的支撑

- **支撑度: 极高**
- `session-do-runtime-by-opus.md` 的 F1-F13 功能清单 (§7.1) 和附录 A 的 lifecycle 映射 (§A) 已经可以直接转化为 action-plan 的工作项。每个 F 都有明确的 "一句话收口目标"、接口边界和依赖关系。

### 6.2 对 Eval/Observability 实现的支撑

- **支撑度: 极高**
- `eval-observability-by-opus.md` 的 F1-F10 功能清单 (§7.1) 覆盖了 trace sink、timeline、scenario runner、failure replay、storage placement inspector 五大能力。其中 F1-F4 (TraceSink + Timeline) 是最小可运行集，F5-F7 (Inspector + ScenarioRunner) 是验证核心，F8-F10 是治理对齐。

### 6.3 对 Storage Topology 实现的支撑

- **支撑度: 极高**
- `storage-topology-by-opus.md` 已经提供了可直接编码的 `storage-keys.ts` 常量、checkpoint interface、20+ 数据条目的 placement 表。这份文档本身就已经跨越了 "design doc" 和 "implementation spec" 的边界。

### 6.4 对 Cross-Doc Review (Stage C) 的支撑

- **支撑度: 高**
- Opus 的三份文档比 GPT 的三份文档更具体、更贴近代码事实，因此作为 Stage C 的输入非常扎实。但正如 §5.4 所述，仍然存在 4 个需要联审的断点（event catalog 映射、ArtifactRef 语义、compact 触发权、实施顺序）。

---

## 7. 总结性陈述

### 7.1 对三份文档的总体评价

Opus 生成的这三份设计文档展现了**极高的工程成熟度**。与 GPT 的文档相比，Opus 的设计有以下几个显著优势：

1. **直接消费已实现代码**：Opus 不是只引用 action-plan 文档，而是直接阅读并引用了 `packages/nacp-core/src/` 和 `packages/nacp-session/src/` 的**实际实现文件**（如 `websocket.ts`、`replay.ts`、`stream-event.ts`、`service-binding.ts`、`tenancy/boundary.ts`）。这让设计文档与代码事实之间的距离几乎为零。

2. **代码事实映射极其精准**：对 codex `StoredThread` / `RolloutRecorder` / `ThreadConfigSnapshot` 的吸收，对 claude-code `autoCompact` / `cost-tracker` / `sessionStorage` 的迁移，都非常到位。特别是 claude-code 的 `promptCacheBreakDetection` 被识别为 "直接照搬" 的归因模式，显示了很强的技术判断力。

3. **从语义设计到具体实现的过渡非常平滑**：`storage-topology-by-opus.md` 不仅定义了 "什么数据住哪一层"，还提供了完整的 key schema 常量、checkpoint TypeScript interface、demotion/promotion 触发条件。这是六份设计文档中最接近可直接编码的一份。

### 7.2 关键优点

1. **eval-observability-by-opus.md**:
   - 正确将 observability 定位为 "验证基础设施" 而非 "事后加的仪表盘"。
   - 精准吸收了 codex OTEL/rollout 和 claude-code telemetry/cache-break-detection 的经验。
   - 与已实现的 NACP-Core `audit.record` 和 NACP-Session 9 stream event kinds 自然衔接。

2. **session-do-runtime-by-opus.md**:
   - 架构图 (§2.1) 和 lifecycle 映射 (附录 A) 提供了可直接转给开发者的蓝图。
   - 与 `packages/nacp-session` 的 `SessionWebSocketHelper`、`ReplayBuffer`、`normalizeClientFrame` 直接对齐。
   - 对 codex 和 claude-code 的持久化/恢复/compact/cost-tracking 经验迁移非常成熟。

3. **storage-topology-by-opus.md**:
   - 真正践行了 `plan-after-nacp` "由验证反推 storage" 的方法论，同时又在设计阶段给出了足够具体的落地定义。
   - 三层数据分布表、key schema 常量、checkpoint 格式都具备直接编码的条件。
   - 明确 v1 不引入 D1，避免了过早 schema 固化的陷阱。

### 7.3 关键缺陷与改进建议

**缺陷 1: 实施顺序与 `plan-after-nacp.md` 存在分歧。**

- `plan-after-nacp.md` §5.1 将 "Session DO Runtime Skeleton" 放在 "Agent Runtime Kernel" 之前（第一批第 1 vs 第 2）。
- Opus `session-do-runtime` §9.3 认为 Session DO 应在 kernel 之后实现。
- **建议**: 业主需要拍板。两种顺序各有道理：
  - `plan-after-nacp` 顺序：先让 DO 能 attach/resume/checkpoint，再填 kernel（风险低，可早期验证 WebSocket 链路）。
  - Opus 顺序：先定 kernel 接口，再写 DO 编排（接口更稳定，DO 代码返工少）。
  - **我的倾向**: 采用 `plan-after-nacp` 的顺序，但将 "Session DO Skeleton" 的 turn loop 部分留空（只跑 mock kernel），等 kernel 设计完成后再填充。这样既验证了 DO 生命周期，又不阻塞 kernel 设计。

**缺陷 2: `RuntimeEventEmitter` 与 `session.stream.event` 的 1:1 映射未显式化。**

- **建议**: 在 cross-doc review 中冻结一张映射表，例如：
  | Kernel Runtime Event | Session Stream Event Kind |
  |----------------------|---------------------------|
  | turn.started | `turn.begin` |
  | turn.completed | `turn.end` |
  | llm.delta | `llm.delta` |
  | tool.progress | `tool.call.progress` |
  | tool.completed | `tool.call.result` |
  | hook.broadcast | `hook.broadcast` |
  | compact.boundary | `compact.notify` |
  | system.error | `system.notify` |

**缺陷 3: ArtifactRef 与 `NacpRefSchema` 的精确关系未跨文档对齐。**

- **建议**: 在 cross-doc review 中明确：
  - `ArtifactRef` 的**核心结构**就是 `NacpRefSchema`（`{kind, binding, team_uuid, key, ...}`）。
  - `ArtifactRef` 可以在 `NacpRef` 基础上增加业务字段（`prepared`, `preview_url`, `content_type`, `size_bytes`），但这些扩展字段应放在 `NacpRef.extra` 或一个包装类型中。
  - `storage-topology` 的 `workspace_refs: NacpRef[]` 因此可以直接存储这些 artifact refs。

**缺陷 4: Compact 触发权的职责边界需要明确。**

- **建议**: 明确以下分工：
  - **Kernel**: 在 `StepScheduler` 中预留 `compact-required` 的 `InterruptReason`，但 kernel 本身不直接调用 compact worker。
  - **Session DO**: 负责在 turn 边界检查 token 阈值（吸收 claude-code `autoCompact` 策略），当阈值触发时，通过 NACP-Core `context.compact.request` 调用 compact worker，然后将结果重新注入 kernel。
  - 这样 kernel 保持 "纯逻辑"，Session DO 保持 "宿主编排 + 资源管理"。

**缺陷 5: Storage Topology 中 `session:messages` 在 compact 后的结构变化说明不足。**

- **建议**: 在 `SessionCheckpoint` 的注释中补充：`messages` 字段在 compact 后会被 `CompactBoundaryManager` 替换为 `[...recentMessages, CompactBoundaryRecord]`，其中旧 turn 的完整内容通过 `NacpRef` 指向 R2 archive。

### 7.4 最终判断: 是否可以通过审核进入下一阶段

**我的判断是: 三份文档全部通过审核，可以进入 Stage C（跨文档联审）和 Stage D（基础设施搭建）。**

Opus 的三份文档已经达到了 "高质量设计文档" 的标准——它们不仅方向正确，而且足够具体，可以直接作为 action-plan 的输入。与 GPT 的文档相比，它们与已实现的 NACP 代码基座结合得更紧密，对参考代码的吸收也更深入。

在进入 Stage C 时，重点解决 §5.4 列出的 4 个断点即可。完成联审后，建议按以下顺序开始 Stage D / Stage E：

1. **先实现 `storage-keys.ts` + `TraceSink` 接口**（这是所有子系统都会依赖的最小基础设施）
2. **搭建 `SessionWebSocketHelper` 的测试 harness**（验证 attach/resume/replay/heartbeat 四条路径）
3. **编写 `ScenarioRunner` 的最小骨架**（用于验证后续 kernel + capability 的集成）
4. **再按业主拍板的顺序实现 Session DO 和 Agent Kernel**

---

## 8. 给 Opus 的反馈

你的三份设计文档展现了非常扎实的工程判断力。特别是以下几点值得肯定：

1. **你直接阅读并引用了 `packages/nacp-core/` 和 `packages/nacp-session/` 的已实现代码**，而不是只引用 action-plan 文档。这让设计文档与代码事实之间几乎没有 gap。
2. **你对 codex 和 claude-code 的吸收非常精准**——不是泛泛地 "借鉴思想"，而是具体到文件:行号、数据结构的字段名、常量的数值（如 `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES=3`、`AUTOCOMPACT_BUFFER_TOKENS=13000`）。
3. **`storage-topology` 已经提供了可直接编码的具体定义**（key schema 常量、checkpoint interface、placement table），这是设计文档能给出的最高质量输出。

下一步，请在 cross-doc review 中重点关注与 GPT 文档的接口对齐：

- **Kernel Runtime Event → Session Stream Event Kind 的映射**
- **ArtifactRef 与 `NacpRefSchema` 的精确关系**
- **Compact 触发权在 Kernel 与 Session DO 之间的分工**
- **实施顺序：Session DO 与 Kernel 谁先谁后**

当这四个断点被明确后，整个 nano-agent 的骨架设计就将完全收敛。

---

*报告结束。*
