# Action-Plan Batch 1 审核报告 — Opus to GPT

> 审核对象:
> - `docs/action-plan/agent-runtime-kernel.md`
> - `docs/action-plan/capability-runtime.md`
> - `docs/action-plan/llm-wrapper.md`
> - `docs/action-plan/workspace-context-artifacts.md`
> 审核者: `Claude Opus 4.6 (1M context)`
> 审核时间: `2026-04-16`
> 审核方法:
> 1. 逐份通读 4 份 action-plan 全文（共 ~2100 行）
> 2. 派出 3 个并行验证 agent 分别核查：NACP 包内 9 个关键符号/API、context/ 下 15 个引用文件/目录、9 个设计文档引用路径
> 3. 对照 `README.md` 的 §1–§4 判断 README 精神一致性
> 4. 对照 `docs/design/*-by-opus.md` 3 份设计文档（已基于 GPT+Kimi review 修订至 v0.2）判断跨文档对齐性
> 5. 对照 `packages/nacp-core/` 和 `packages/nacp-session/` 已实现代码判断基座对齐性
> 6. 逐份检查 Q&A 回答是否已充分反映到计划正文中
> 文档状态: `reviewed`

---

## 0. 代码引用验证结果

在审核正文之前，先交代事实核查结论。

### 0.1 NACP 包引用（9 项）

| 引用文件 | 引用符号 | 验证结果 |
|---------|---------|---------|
| `packages/nacp-core/src/messages/tool.ts` | `ToolCallRequestBodySchema` / `ResponseBodySchema` / `CancelBodySchema` | ✅ 存在且签名匹配 |
| `packages/nacp-core/src/transport/service-binding.ts` | `ServiceBindingTransport` | ✅ 存在，含 `send()` / `sendWithProgress()` |
| `packages/nacp-core/src/transport/types.ts` | `NacpProgressResponse` | ✅ 存在，`{ response, progress?: ReadableStream }` |
| `packages/nacp-core/src/envelope.ts` | `NacpRefSchema` | ✅ 存在（line 193-208） |
| `packages/nacp-core/src/messages/context.ts` | `ContextCompactRequestBodySchema` / `ResponseBodySchema` | ✅ 存在且已注册 |
| `packages/nacp-session/src/stream-event.ts` | 9 种 `SessionStreamEventBody` kinds | ✅ 全部存在且有 `STREAM_EVENT_KINDS` 常量 |
| `packages/nacp-session/src/websocket.ts` | `SessionWebSocketHelper.checkpoint()` / `.restore()` | ✅ 存在（line 223-239） |
| `packages/nacp-session/src/replay.ts` | `ReplayBuffer.checkpoint()` / `.restore()` | ✅ 存在（line 82-102） |
| `packages/nacp-session/src/redaction.ts` | `redactPayload()` | ✅ 存在（line 6-16） |

**结论：NACP 包引用 9/9 全部通过。**

### 0.2 Context 参考代码引用（15 项）

| 引用路径 | 关键符号 | 验证结果 |
|---------|---------|---------|
| `context/codex/codex-rs/core/src/state/session.rs` | `SessionState` struct | ✅ line 20 |
| `context/codex/codex-rs/core/src/state/turn.rs` | `TurnState`, `ActiveTurn` | ✅ line 98, 27 |
| `context/codex/codex-rs/model-provider-info/src/lib.rs` | `ModelProviderInfo`, `WireApi` | ✅ line 75, 43 |
| `context/codex/codex-rs/tools/src/tool_definition.rs` | `ToolDefinition` | ✅ line 7 |
| `context/codex/codex-rs/otel/src/events/session_telemetry.rs` | telemetry events | ✅ 存在 |
| `context/codex/codex-rs/rollout/` | recorder/state_db/policy | ✅ 19 个文件 |
| `context/codex/codex-rs/exec-server/` | `ExecServerClient`, `ExecutorFileSystem` | ✅ 存在 |
| `context/claude-code/services/api/logging.ts` | telemetry logging | ✅ 存在 |
| `context/claude-code/services/compact/compact.ts` | compact logic | ✅ 存在 |
| `context/claude-code/utils/toolResultStorage.ts` | `PERSISTED_OUTPUT_TAG`, truncation | ✅ 存在 |
| `context/claude-code/utils/attachments.ts` | attachment handling | ✅ 存在 |
| `context/mini-agent/mini_agent/llm/` | `LLMClientBase` 等 5 个文件 | ✅ 存在 |
| `context/mini-agent/mini_agent/tools/file_tools.py` | `truncate_text_by_tokens` | ✅ 存在 |
| `context/just-bash/src/fs/mountable-fs/mountable-fs.ts` | `MountableFs`, `MountConfig` | ✅ line 24, 34 |
| `context/just-bash/src/commands/bash/bash.ts` | `bashCommand`, `execute()` | ✅ line 20, 23 |

**结论：Context 引用 15/15 全部通过。**

### 0.3 设计文档引用（9 项）

| 引用路径 | 验证结果 |
|---------|---------|
| `docs/design/agent-runtime-kernel-by-GPT.md` | ✅ 存在 |
| `docs/design/hooks-by-GPT.md` | ✅ 存在 |
| `docs/design/llm-wrapper-by-GPT.md` | ✅ 存在 |
| `docs/design/capability-runtime-by-GPT.md` | ✅ 存在 |
| `docs/design/workspace-context-artifacts-by-GPT.md` | ✅ 存在 |
| `docs/action-plan/nacp-core.md` | ✅ 存在 |
| `docs/action-plan/nacp-session.md` | ✅ 存在 |
| `docs/plan-after-nacp.md` | ✅ 存在 |
| `docs/eval/vpa-fake-bash-by-GPT.md` | ✅ 存在 |

**结论：设计文档引用 9/9 全部通过。**

### 0.4 代码引用核查总结

> **33 项代码/文档引用全部通过验证，无路径错误、无符号缺失、无 API 签名不一致。GPT 在引用层面的工作极其准确。**

---

## 1. 总体评价

### 1.1 评级总览

| 文档 | 评级 | 核心判断 |
|------|------|----------|
| `agent-runtime-kernel.md` | ⭐⭐⭐⭐⭐ (5/5) | 最扎实的一份。类型 → 调度 → 事件 → checkpoint → scenario 的推进路径完全正确，与 NACP 现实的对齐是四份中最严谨的。 |
| `llm-wrapper.md` | ⭐⭐⭐⭐⭐ (5/5) | canonical model 先行的策略完全正确。Chat Completions 作为唯一 wire、local-fetch 优先、不过早协议化 `llm.invoke` 三条约束都站得住。 |
| `workspace-context-artifacts.md` | ⭐⭐⭐⭐☆ (4.5/5) | 语义先于物理拓扑的方法论正确。mount-based truth + artifact-first + NacpRef 对齐都做对了。扣分在 compact post-structure 的描述不够具体。 |
| `capability-runtime.md` | ⭐⭐⭐⭐☆ (4.5/5) | 架构方向完全正确。扣分在 Q1 回答（全量 just-bash 移植）与计划正文（最小命令集）之间存在未消化的张力。 |

### 1.2 四份文档的共同优点

1. **全部坚持 README 精神**
   - 没有一份试图恢复 Linux/POSIX 心智
   - 全部坚持 Cloudflare Workers / V8 isolate / 单线程 / 无真实子进程
   - 全部坚持 `packages/*` 独立仓策略

2. **全部消费 NACP 现实而不绕开它**
   - `tool.call.*` / `context.compact.*` / `session.stream.event` 被当作已冻结合同使用
   - 没有一份试图发明新的 Core message family（正确地把 `llm.invoke` 放在 out-of-scope）
   - 全部引用的是**已实现代码**而非仅引用 action-plan 文档

3. **全部采用"先类型/接口，后实现"的推进策略**
   - Phase 1 都是包骨架 + 领域类型
   - Phase 2-3 是核心逻辑
   - Phase 4-5 是对齐 + 测试 + 文档
   - 这与 `nacp-core` / `nacp-session` 的已证明有效的开发节奏一致

4. **全部有明确的 Q&A 机制**
   - 关键决策点都有显式问题
   - 业主的回答已填入
   - 边界判定表清楚区分了 in-scope / out-of-scope / defer

5. **全部考虑了 WebSocket-first + HTTP fallback 的双入口**
   - 多处明确提到 session delivery layer 不应只依赖 WebSocket heartbeat
   - normalized output body 应可被两种入口复用

---

## 2. 逐份审核

### 2.1 `agent-runtime-kernel.md`

#### 做得对的地方

1. **状态模型直接吸收 codex 的 Session/Turn 双层分离**（P1-02），且不复制 provider realtime 复杂度——这是正确的取舍。`context/codex/codex-rs/core/src/state/session.rs:20` 的 `SessionState` 和 `turn.rs:98` 的 `TurnState` 都被准确引用。

2. **reducer + scheduler + interrupt controller 的三中心设计**（P2-01/02/03）是正确的。这避免了"状态转移散落在 delegate 里"的常见错误。

3. **Phase 3 的 NACP 对齐层是四份中最严谨的**：
   - `message-intents.ts` 映射到已有 `nacp-core` message families（不发明新的）
   - `session-stream-mapping.ts` 收敛到已有 9 个 event kinds（不突破）
   - 这直接回应了 Kimi review 中指出的"RuntimeEventEmitter 与 session.stream.event 映射未显式化"的断点

4. **checkpoint 只导出 kernel fragment，不抢 Session DO 的存储职责**（P4-01）——正确理解了 kernel 与 session runtime 的责任边界。

5. **Q&A 回答全部合理**：
   - Q1：冻结 single-active-turn + caller-managed health + delegate-based kernel ✅
   - Q2：v1 不允许 background lane，但留接口 ✅
   - Q3：compact 由独立引擎提供，kernel 只接信号 ✅

#### 需要注意的问题

**问题 A（中等）：Turn Ingress Contract 缺失未被显式标记**

`session-do-runtime-by-opus.md` v0.2 已经在 S5b 中显式标记了"turn ingress contract 尚未冻结"——即"正常用户 turn 输入走什么消息类型"这个问题。但 kernel action-plan 在边界判定表中只写了 `session prompt ingress contract: defer / depends-on-decision`，没有进一步说明这对 kernel 的 `pending_input` 模型意味着什么。

**影响**：kernel 的 reducer 需要知道"用户输入从哪里进来"才能正确建模 `StepDecision::WaitForInput`。如果 session-do-runtime 后续定义了 `session.prompt` 消息类型，kernel 的 pending input 模型可能需要调整。

**建议**：在 P1-02 的状态类型中为 pending input 留一个 `PendingWait` variant（已在计划中提到），并在 Phase 5 的 scenario tests 中覆盖"input arrives while turn is idle"路径。

**问题 B（低）：Version.ts 的版本号策略未明确**

`P1-01` 提到 `src/version.ts`，但没说版本号是否与 `nacp-core` / `nacp-session` 的 `1.0.0` 对齐，还是从 `0.1.0` 开始。

**建议**：保持与现有包一致即可，不需要改计划。

### 2.2 `llm-wrapper.md`

#### 做得对的地方

1. **Canonical model 先行**（P1-02）是完全正确的策略。`CanonicalLLMRequest` 与 OpenAI request body 脱钩，意味着后续切换 provider 不需要重写 agent loop。

2. **Chat Completions 作为唯一 wire**（边界判定表第 1 行）——这是 v1 的正确收敛。业主在 Q1 也确认了这一点。

3. **Attachment planner 的四路径模型**（S5: `inline | signed-url | proxy-url | prepared-text`）是成熟的设计。直接借鉴了 claude-code 的 `attachments.ts` 但适配了 Worker 环境。

4. **`PreparedArtifactRef` 继续以 `NacpRef` 为底层 wire truth**（Phase 2 功能预期第 3 条）——直接回应了 Kimi review 中指出的"ArtifactRef 与 NacpRefSchema 关系"断点。

5. **Gateway seam 只保留接口不实现**（P4-03）——正确。业主 Q3 也确认了 v1 只用 local-fetch。

#### 需要注意的问题

**问题 A（中等）：Q1 回答中的 API key 轮换需求未充分反映到 Registry 设计**

业主在 Q1 回答中明确说：
> "我们支持的是规范...这些 vendor 的 base url 和 apikey 都不同。而且 apikey 可能还涉及到轮换，以抵抗 429 rate limit 错误。"

但 `P2-01 provider registry` 和 `P2-03 registry loader` 的描述只提到"静态默认值 + env/config overlay"，没有显式提到：
- 多 API key 池
- key 轮换策略
- 429 后自动切换 key

**影响**：如果 registry 不在 v1 就为 key 轮换预留字段，后续加 key rotation 可能需要改 registry interface。

**建议**：在 `P2-01 provider registry` 的 profile 字段中显式加入 `api_keys: string[]`（复数）和 `key_rotation_policy?: "round-robin" | "on-429"`。这不需要在 v1 完整实现轮换逻辑，但字段槽位应该先留好。

**问题 B（中等）：Q2 回答中的 mime_type 路由概念未充分反映到 Attachment Planner**

业主在 Q2 回答中说：
> "可以通过 mime_type 在 v1 进行限缩，在后期通过增加 mime_type 的注册范围，来规范不同模态、文件类型的路由、存储、拉取、以及转换规范。"

但 `P2-05 attachment planner` 只提到"规划 URL / prepared-text / inline 路径"，没有显式引入 mime_type 作为路由键。

**建议**：在 attachment planner 的路由决策中加入 `mime_type` 作为第一级判断键。v1 只注册 `image/*` 和 `application/pdf` 两类，其他 mime_type 走 `reject` 或 `prepared-text` fallback。

**问题 C（低）：Session stream adapter 提到 `llm.delta` 但未提到 `turn.begin` / `turn.end` 的职责归属**

Phase 4 功能预期第 2 条正确地说"turn begin/end 仍由 kernel/session runtime 负责"——但这应该更显式地标记在 session-stream-adapter 的接口文档中，避免后续实现者把 turn 边界事件误放到 llm-wrapper 里。

### 2.3 `capability-runtime.md`

#### 做得对的地方

1. **just-bash 定位为参考代码而非 runtime dependency**——这是正确的。`§0` 明确说"它是参考代码与行为基线，不是运行时依赖"。

2. **命令外形与能力真相分离**（P2-01 command planner）——这是 capability runtime 最关键的架构决策。planner 把 `bash-shaped command` 映射成 `capability plan`，而不是让 fake bash 直接执行。

3. **两类 execution target 的分离**（P3-03 local-ts + P3-04 service-binding）——正确对齐了 Worker 宿主环境。local-ts 用于 V8 isolate 内执行，service-binding 用于远端 capability worker。

4. **artifact promotion seam 不负责物理存储**（P4-02）——正确地把持久化职责留给 workspace package。

5. **Q2 回答很有价值**：browser-rendering 不是为了实现功能，而是作为 service-binding + bash 命令耦合的验证测试对象。这是一个很好的工程判断。

#### 需要注意的问题

**问题 A（高）：Q1 回答与计划正文存在未消化的张力**

这是四份计划中最需要注意的问题。

业主在 Q1 回答中说：
> "v1 完整实现 just-bash 的移植工作，支持 just-bash 提供的全部映射面"

但计划正文在多个地方仍然按"最小命令集"描述：
- `§0 本次计划的直接产出`："以最小命令集 `pwd/ls/cat/write/rg/curl/ts-exec` 跑通"
- `§2.1 S13`："至少先覆盖 `pwd`、`ls`、`cat/read`、`write`、`rg`、`curl/fetch`、`ts-exec`"
- `P5-01`："落地 `pwd/ls/cat/write/rg/curl/ts-exec` 与 virtual git subset seam"

Q1 的回答（全量映射面）与正文（最小命令集）之间存在显著差距。虽然 `§2.1 S13` 末尾和 `P5-01` 中加了"以 just-bash 可迁移映射面为基线继续补齐"的尾注，但这个尾注的力度不足以表达 Q1 回答的全量要求。

**影响**：执行者可能按最小命令集实现后就收口，而业主期望的是全量 just-bash 映射面。这会导致交付预期错配。

**建议**：
1. 把 `§0 本次计划的直接产出` 和 `§2.1 S13` 改写为："以 just-bash 的完整可迁移命令面为 v1 目标，分两步实现——Phase 5a 先完成核心路径（filesystem + search + network + exec），Phase 5b 补齐剩余映射面"
2. 在 Phase 5 中增加一个 `P5-01b` 工作项：对照 just-bash 命令注册表做差分检查，确保所有可迁移命令都有映射
3. 更新工作量预估——全量移植可能把 Phase 5 从 M 提升到 L

**问题 B（中等）：`rg` 在 V8 isolate 中的降级路径需要更明确**

边界判定表正确地指出"isolate 内无原生 ripgrep，必须明确降级为 TS scan / service-binding search"。但如果 Q1 要求全量 just-bash 映射面，那 `rg` 的行为差异（TS scan vs 真正 ripgrep）必须在 fake bash bridge 中被显式处理，包括：
- 哪些 rg flag 被支持
- 大文件搜索的性能上限
- 何时自动切换到 service-binding search worker

**建议**：在 `P5-01` 的收口标准中加入"rg 降级行为文档化"。

**问题 C（低）：只引用了 `vpa-fake-bash-by-GPT.md`，未引用 `vpa-fake-bash-by-opus.md`**

两份 fake bash 分析文档都存在于 `docs/eval/` 下。Opus 版本可能包含不同的命令集分析和 just-bash 深度评估。

**建议**：在 §0 关联文档中补充 `docs/eval/vpa-fake-bash-by-opus.md`。

### 2.4 `workspace-context-artifacts.md`

#### 做得对的地方

1. **语义先于物理拓扑**（`§1.1`："v1 如果过早把 DO/KV/R2 placement 写死，后面一旦调整就会全面返工"）——这完美回应了 GPT review 对 `storage-topology-by-opus.md` 的"过早冻结"批评。

2. **`ArtifactRef` / `PreparedArtifactRef` 明确是 `NacpRef` 的语义包装**（`§2.1 S3`）——直接解决了 Kimi review 中指出的"ArtifactRef 与 NacpRefSchema 关系不清"断点。

3. **mount router 借鉴 just-bash 但在仓内重写**（`§5.2`）——与 capability-runtime 的"不直接引用 just-bash runtime"约束一致。

4. **compact boundary 对齐 `context.compact.request/response`**（P4-02）——已验证 `packages/nacp-core/src/messages/context.ts` 确实有 `ContextCompactRequestBodySchema`（含 `history_ref`）和 `ContextCompactResponseBodySchema`（含 `summary_ref`）。

5. **snapshot builder 只导出 fragment，不直接写 DO/KV/R2**（P5-01）——正确地把物理存储职责留给 session runtime。

#### 需要注意的问题

**问题 A（中等）：Compact post-structure 描述不够具体**

`storage-topology-by-opus.md` v0.2 已经在 SessionCheckpoint 中加入了注释说明 compact 后 messages 结构的变化（`[...recentMessages, CompactBoundaryRecord]`），但 workspace action-plan 的 `P4-02 compact boundary` 只说"对齐 `context.compact.request/response` 的 history_ref/summary_ref contract"，没有显式描述 compact 后的 messages array 结构变化。

**建议**：在 P4-02 的功能预期中加入一句：
> "compact 后 `session:messages` 的结构变为 `[...CompactBoundaryRecord[], ...recentMessages[]]`，其中 CompactBoundaryRecord 含 `summary_ref: NacpRef` 指向 R2 archive 的旧 turn 完整内容。"

**问题 B（低）：`_platform/` namespace 例外未提及**

`storage-topology-by-opus.md` v0.2 已经声明 `_platform/` 是 tenant namespace 规则的唯一例外（用于 feature flags）。但 workspace action-plan 的 namespace / mount router 设计中没有提到这个例外。

**建议**：在 P2-01 的功能预期中加入对 `_platform/` prefix 的显式处理说明。

**问题 C（低）：Redaction helper 与 nacp-session 已有 redactPayload() 的关系未明确**

P4-03 定义了 `src/redaction.ts`，但 `packages/nacp-session/src/redaction.ts` 已经实现了 `redactPayload()`。这两者的关系（继承？包装？独立？）应该被显式说明。

**建议**：在 P4-03 中加入："workspace redaction helper 消费 `@nano-agent/nacp-session` 的 `redactPayload()` 作为底层实现，在其上增加 workspace-specific 的 preview / audience scope 逻辑。"

---

## 3. 跨文档一致性检查

### 3.1 四份计划之间的依赖一致性

| 依赖关系 | 声明方 | 被依赖方 | 对齐状态 |
|---------|--------|---------|---------|
| kernel → NACP event catalog | kernel P3-03 | nacp-session stream-event.ts | ✅ 一致 |
| kernel → NACP message families | kernel P3-02 | nacp-core messages/*.ts | ✅ 一致 |
| capability → kernel delegate contract | capability §0 | kernel P1-04 delegates.ts | ✅ 一致 |
| capability → nacp-core tool-call | capability P3-04 | nacp-core messages/tool.ts | ✅ 一致 |
| capability → workspace artifact promotion | capability P4-02 | workspace P3-03 promotion.ts | ✅ 一致 |
| llm-wrapper → nacp-session event reality | llm P4-02 | nacp-session stream-event.ts | ✅ 一致 |
| llm-wrapper → workspace prepared artifact | llm P2-05 | workspace P3-02 prepared-artifacts.ts | ✅ 一致 |
| workspace → NacpRef wire truth | workspace S3 | nacp-core envelope.ts NacpRefSchema | ✅ 一致 |
| workspace → compact NACP contract | workspace P4-02 | nacp-core messages/context.ts | ✅ 一致 |

**结论：四份计划之间的依赖声明全部一致，无断裂点。**

### 3.2 与 Opus 设计文档的对齐检查

| 设计决策 | Opus 设计文档 | GPT Action Plan | 对齐状态 |
|---------|-------------|----------------|---------|
| Session/Core phase 边界 | session-do-runtime v0.2 §8.2：Session phase 不走 Core admissibility | kernel P3-02：只做 Core message intent，不抢 Session phase | ✅ 一致 |
| RuntimeEventEmitter → stream event 映射 | session-do-runtime v0.2 附录 B.1：9 行映射表 | kernel P3-03：收敛到 9 kinds | ✅ 一致 |
| ArtifactRef = NacpRef wrapper | session-do-runtime v0.2 附录 B.2 | workspace S3 + llm P2-05 | ✅ 一致 |
| Compact 触发权归属 | session-do-runtime v0.2 附录 B.3：kernel 留 interrupt，Session DO 负责调用 | kernel Q3：compact 由独立引擎 | ✅ 一致 |
| Storage topology provisional | storage-topology v0.2 §7.1："候选假设" | workspace §1.1："不抢跑物理拓扑" | ✅ 一致 |
| Durable/live trace 三分法 | eval-observability v0.2 §5.3 | llm P4-02："不泄漏 provider 原始 wire" | ✅ 一致 |
| Turn ingress contract 缺失 | session-do-runtime v0.2 S5b："尚未冻结" | kernel §2.3 边界表："defer" | ✅ 一致 |
| Single-active-turn | session-do-runtime v0.2 S5 | kernel §2.3 边界表：confirmed | ✅ 一致 |

**结论：与 Opus 设计文档（v0.2 修订版）全部对齐，包括 GPT/Kimi review 后新增的修订项。**

### 3.3 与 README 的对齐检查

| README 原则 | 四份计划的体现 |
|------------|--------------|
| 不以 Linux 为宿主真相 | ✅ 无一份假设真实 bash/FS/进程 |
| V8 isolate 约束 | ✅ 全部提到 128MB 内存 / 无子进程 / 单线程 |
| WebSocket-first | ✅ 全部提到 WebSocket 优先 + HTTP fallback 保留 |
| Fake bash 是 compatibility surface | ✅ capability runtime 明确分离外形与真相 |
| Service-composable capabilities | ✅ capability runtime 的 service-binding target |
| 分层上下文 + 外部化 | ✅ workspace 的 context assembler + compact boundary |
| 单 agent 单线程为早期核心 | ✅ kernel 的 single-active-turn |
| packages/* 独立仓 | ✅ 全部按 packages/ 建新包 |

**结论：与 README §1–§4 完全一致。**

---

## 4. Q&A 完整性审查

### 4.1 已回答的问题审查

| 计划 | Q# | 问题 | 回答 | 是否充分反映到正文 |
|------|-----|------|------|-------------------|
| kernel | Q1 | 冻结 single-active-turn 三原则 | 冻结 | ✅ 已反映 |
| kernel | Q2 | long-running capability 是否脱离 active turn | 不行，v1 不允许多线程 | ✅ 已反映 |
| kernel | Q3 | compact 策略由谁提供 | 独立引擎，非 kernel | ✅ 已反映 |
| capability | Q1 | 最小命令集还是全量移植 | **全量 just-bash 移植** | ⚠️ **未充分反映**（见 §2.3 问题 A） |
| capability | Q2 | browser-rendering target | 尽力而为，作为测试对象 | ✅ 已反映 |
| capability | Q3 | 大结果 promotion 策略 | 超阈值或注册 mime_type 可直接提升 | ✅ 已反映 |
| llm | Q1 | 单 adapter 还是多 vendor | generic OpenAI-compatible，支持 key 轮换 | ⚠️ **key 轮换未充分反映**（见 §2.2 问题 A） |
| llm | Q2 | 多模态路径 | 图片+PDF，mime_type 路由 | ⚠️ **mime_type 路由未充分反映**（见 §2.2 问题 B） |
| llm | Q3 | local-fetch 还是 gateway | local-fetch，密钥在主 worker toml | ✅ 已反映 |
| workspace | Q1 | mount-based + artifact-first | 同意 | ✅ 已反映 |
| workspace | Q2 | prepared artifact 种类 | 三类够 v1 | ✅ 已反映 |
| workspace | Q3 | snapshot fragment 职责 | workspace 只负责 fragment | ✅ 已反映 |

### 4.2 是否有新的 Q&A 需要回答

**需要业主确认的新问题：**

**Q-New-1**（影响 capability-runtime Phase 5）：
> just-bash 的完整命令注册表包含哪些命令？是否包括 `mkdir`、`rm`、`mv`、`cp`、`chmod`、`head`、`tail`、`wc`、`sort`、`uniq`、`diff`、`patch`、`tar`、`gzip` 等？如果"全量移植"是指所有 just-bash 已注册的命令，需要一份明确的命令清单来评估工作量。

包括 just-bash 的完整移植。请当做全量来尽力而为
mkdir 必须匹配至 r2中的真实路径， 或者 kv 中暂存的虚拟路径， 或者 d1 中注册的虚拟路径
mv 必须是真实的 r2 路径移动，或者 kv / d1 中注册的虚拟路径改变

但我们必须认识到 worker v8-isolate 能力上的限制，任何设计到 OOM 风险的操作，必须有额外的风险提示，以及回退策略
比如 TAR 明显会产生 OOM 风险，这样的命令必须在 v1 阶段禁止

我无法准确为你提供完整移植的清单。请你维护两张表。允许的清单，以及 OOM 风险清单。优先实现无风险的允许命令。OOM 的可以后续在进行
但不改变口径，口径仍然为在不同阶段，需要完整移植 just-bash 的全量能力


**Q-New-2**（影响 llm-wrapper Phase 2）：
> v1 的 API key 轮换是否需要在 registry 层实现？还是可以先用环境变量切换，后续再加自动轮换？这直接影响 provider registry 的字段设计。

应该是在环境变量，先简单的在 toml 中进行处理。比如用逗号隔开。我们 v1 可以先比较简单的来。后续我们在进行复杂处理。
尤其是你考虑多租户。租户拥有自己的环境变量，租户会拥有自己的注入机制。因此在 v1 我们不要想太复杂，直接在 toml 中进行注册和轮询即可。


---

## 5. 盲点与断点分析

### 5.1 已识别的盲点

**盲点 1（高）：缺少 Session DO Runtime 的 action plan**

四份计划都提到了 "session-do-runtime" 作为最终组装层，但没有对应的 action plan。Kernel、LLM Wrapper、Capability Runtime、Workspace 四个包都是**被组装的子系统**，而 Session DO 是**组装者**。

- kernel 说"后续 session-do-runtime 可接入 runner"
- llm 说"kernel/session runtime 能直接 import 本包"
- capability 说"kernel、hooks、future session runtime 可直接 import"
- workspace 说"capability runtime、llm-wrapper、kernel、future session runtime 可直接复用"

但"谁来做这个组装"没有 action plan。

**影响**：四个包各自正确，但拼在一起的"胶水层"没有人负责。这是从子系统到可运行系统的最后一步。

**建议**：在这四份计划执行完成后（或部分并行），需要一份 `session-do-runtime` action plan 来定义 Worker entry + DO class + 子系统 composition。

**盲点 2（中）：四包之间的集成测试策略缺失**

每份计划都有自己的 fake delegate / mock 测试，但没有一份提到"四个包放在一起跑"的集成测试。例如：
- kernel 用 fake capability delegate 测试 tool turn
- capability 用 fake workspace 测试 local-ts
- llm 用 mock fetch 测试 stream
- workspace 用 fake backend 测试 mount

但"kernel 调 real capability runtime 调 real workspace"这条端到端路径没有测试覆盖。

**建议**：在 session-do-runtime action plan 中包含一个"cross-package integration test phase"，或在 `plan-after-nacp.md` 中规划一次跨包集成验证。

**盲点 3（低）：Hooks 没有独立 action plan**

`docs/design/hooks-by-GPT.md` 和 `docs/design/hooks-by-opus.md` 都存在，但 hooks 没有出现在这批 action plan 中。Kernel 的 delegate contract 包含 `HookDelegate`（P1-04），capability 的 policy gate 包含 `hook-gated`（P3-01），但 hooks 本身的 dispatcher 实现没有计划。

**影响**：v1 可以用 fake hook delegate 跑通，但如果 hooks 是 v1 必需的产品功能，需要补计划。

**建议**：确认 hooks 是否在 v1 scope 内。如果是，需要补一份 hooks action plan；如果不是，在 kernel 和 capability 的 fake hook delegate 中留好 seam 即可。

### 5.2 执行顺序建议

四份计划的 Phase 1 都是独立的（只依赖 NACP 包），因此可以并行启动。但从 Phase 2 开始存在依赖：

```
Phase 1（并行）:
  kernel P1 ──┐
  llm P1 ─────┤ ─── 都只依赖 nacp-core / nacp-session
  capability P1 ┤
  workspace P1 ─┘

Phase 2-3:
  kernel P2-P3 ─── 独立（用 fake delegates）
  workspace P2-P3 ─── 独立（用 memory backend）
  llm P2-P3 ──── 需要 workspace P1 的 PreparedArtifactRef 类型
  capability P2-P3 ── 需要 workspace P1 的 namespace 类型

Phase 4-5:
  kernel P4-P5 ─── 需要 nacp-session checkpoint/restore 对齐
  llm P4-P5 ──── 需要 nacp-session stream-event.ts 对齐
  capability P4-P5 ── 需要 workspace P3 的 artifact promotion seam
  workspace P4-P5 ── 需要 nacp-core context.compact.* 对齐
```

**推荐执行顺序**：
1. **同时启动** kernel P1 + workspace P1（互不依赖）
2. **紧接** llm P1 + capability P1（等 workspace P1 的类型稳定后）
3. **各自推进** Phase 2-5（用 fake delegates / fake backends）
4. **最后** session-do-runtime 组装 + 跨包集成测试

---

## 6. 总结性陈述

### 6.1 一句话概括

> **GPT 的四份 action plan 在方向、结构、引用准确性和 NACP 基座对齐方面都达到了可直接执行的水平。最大的问题不在计划本身，而在 Q&A 回答（尤其是 capability Q1 的全量移植要求）尚未被充分消化到正文中。**

### 6.2 最终 Verdict

| 文档 | Verdict | 前置条件 |
|------|---------|---------|
| `agent-runtime-kernel.md` | **✅ 通过，可直接执行** | 无 |
| `llm-wrapper.md` | **✅ 通过，建议先补 key 轮换字段和 mime_type 路由键** | 补 provider registry 的 `api_keys[]` 字段和 attachment planner 的 mime_type 判断 |
| `workspace-context-artifacts.md` | **✅ 通过，建议补 compact post-structure 描述** | 补 P4-02 的 compact 后 messages 结构说明 |
| `capability-runtime.md` | **⚠️ 通过，但必须先解决 Q1 全量移植与正文最小命令集的矛盾** | 重写 §0 产出描述和 P5-01 收口标准以反映全量 just-bash 映射面 |

### 6.3 对业主的建议

1. **最优先**：让 GPT 更新 capability-runtime 计划正文以匹配 Q1 全量移植回答
2. **次优先**：让 GPT 在 llm-wrapper registry 中加入 `api_keys[]` 和 mime_type 路由
3. **可并行**：四份计划的 Phase 1 可以立即并行启动
4. **后续**：需要一份 session-do-runtime action plan 作为组装层
5. **确认**：回答 Q-New-1（just-bash 完整命令清单）和 Q-New-2（key 轮换策略）

---

## 附录

### A. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v1.0 | 2026-04-16 | Opus 4.6 | 初版审核报告 |
