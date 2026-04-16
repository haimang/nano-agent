# Post-NACP Design Documents Review — Opus to GPT

> 审查对象:
> - `docs/design/agent-runtime-kernel-by-GPT.md`
> - `docs/design/capability-runtime-by-GPT.md`
> - `docs/design/workspace-context-artifacts-by-GPT.md`
> 审查时间: `2026-04-16`
> 审查者: `Claude Opus 4.6 (1M context)`
> 审查基础:
> - 根目录 `README.md`（项目立场 + 技术栈 + trade-off 表）
> - `docs/action-plan/nacp-core.md`（已收口的 Core 基座事实）
> - `docs/action-plan/nacp-session.md`（已收口的 Session 基座事实）
> - `docs/plan-after-nacp.md`（后续规划蓝图）
> - `context/codex/`、`context/claude-code/`、`context/mini-agent/` 原始代码
> 文档状态: `reviewed`

---

## 0. 审查方法

1. 逐份通读三篇 GPT 设计文档的 §0–§9 + 附录（共 ~1450 行）
2. 核对 GPT 引用的 12 个代码位置是否存在 + 内容是否一致（全部命中）
3. 对照 `README.md` 的 §1–§4 判断"精神一致性"
4. 对照 `nacp-core.md` / `nacp-session.md` 判断"基座对齐性"
5. 对照 `plan-after-nacp.md` §4 的推荐设计顺序判断"时序正确性"
6. 在代码层面抽查 GPT 描述的 codex `SessionState`/`TurnState` 字段、claude-code `toolOrchestration` 批次逻辑、mini-agent `Agent.__init__` 字段——全部与代码事实一致

---

## 1. 对三份文档的逐份评价

### 1.1 `agent-runtime-kernel-by-GPT.md` — ⭐⭐⭐⭐⭐ (5/5)

**这是三份里质量最高的一份。**

**与 README 精神的对齐度**：完全一致。
- §0.2 前置共识逐条复述了 README 的核心立场（Cloudflare-native / 不以 Linux 为宿主真相 / 单 agent 单线程为早期核心 / caller-managed health enforcement）
- §3.1 精简表的"递归式模型自驱"和"giant orchestrator"两行精准地回应了 README §4.2 的"不复刻形态"原则

**与 NACP 基座的对齐度**：强。
- §0.2 明确引用了 `nacp-session` 的 caller-managed health 合同——这意味着 Session DO 的 tick/health 必须在 kernel 内有显式调度点
- §2.2 交互矩阵正确地把 NACP-Core 定为"中"耦合（内部 hook/tool/audit 消息外送），NACP-Session 定为"强"耦合（所有 client-visible 进展都走 session.stream.event）
- §5.1 的 S4（Runtime Event Emitter）与 NACP-Session 的 9 种 `session.stream.event` kinds 直接对接

**代码引用的准确性**：全部核实通过。
- `codex/core/src/state/session.rs:19-229` 的 `SessionState` 字段（history / rate limits / dependency_env / startup_prewarm / granted_permissions）与 GPT 描述一致
- `codex/core/src/state/turn.rs:26-247` 的 `ActiveTurn` / `TurnState` / `MailboxDeliveryPhase` 与 GPT 描述一致
- `claude-code/services/tools/toolOrchestration.ts:19-177` 的 `partitionToolCalls` + `isConcurrencySafe` 批次逻辑与 GPT 描述一致
- `claude-code/services/compact/compact.ts:55-240` 的 compact 边界管理与 GPT 描述一致

**关键设计决策的合理性**：
- **Session/Turn 双层状态机**（S1）：完全正确。codex 已证明这是成熟模式；nano-agent 的 DO storage checkpoint 天然需要这种分层。
- **显式 Step Scheduler**（S2）：正确。避免调度逻辑散落在 hooks/llm/tool delegates 里。
- **delegate-based kernel**（取舍 3）：正确。让 hooks/llm-wrapper/capability runtime 可以作为独立包演进。
- **单活跃 turn**（O1）：与 README §4.2 的"单 agent 单线程为早期核心"完全对齐。

**唯一的微小建议**：
- §7.1 的 F6（Checkpoint Contract）应该显式引用 NACP-Session 的 `SessionWebSocketHelper.checkpoint()` / `.restore()` 已有格式——kernel 的 checkpoint 应该是 session checkpoint 的**超集**，不是平行设计。

**结论**：可以直接进入 action-plan。

---

### 1.2 `capability-runtime-by-GPT.md` — ⭐⭐⭐⭐☆ (4/5)

**方向完全正确，代码引用准确，有一处需要收紧。**

**与 README 精神的对齐度**：高度一致。
- §0.1 准确引用了 README 的"bash-shaped compatibility surface, not system kernel"原则
- §3.1 精简表把"完整 POSIX shell"和"shell script runtime 直接成为系统内核"明确砍掉——与 `vpa-fake-bash-by-opus.md` 的立场一致
- §6.1 取舍 2（"bash-shaped surface + typed runtime" 而不是 "完整 fake Linux"）是 README §4.2 的直接推论

**与 NACP 基座的对齐度**：准确。
- §2.2 正确地把 `NACP-Core` 定为中耦合（service-binding/queue/hook emit 走 Core），`NACP-Session` 定为强耦合（progress/result/error 映射到 session stream）
- §5.1 S5（Progress/Cancel/Result Contract）与 NACP-Session 的 `tool.call.progress` / `tool.call.result` stream event kinds 对接
- §5.1 S6（Service Binding Execution Target）与 `nacp-core` 的 `ServiceBindingTransport` 对接

**代码引用的准确性**：全部核实通过。
- `codex/tools/src/tool_definition.rs:4-26` 的 tool metadata 描述准确
- `codex/tools/src/tool_registry_plan.rs:67-260` 的 registry plan + handler kind 描述准确
- `claude-code/tools.ts:253-389` 的 tool pool 组装 + deny filtering 描述准确
- `claude-code/services/tools/toolExecution.ts:126-245` 的 permission/hook/telemetry 串联描述准确
- `claude-code/utils/toolResultStorage.ts:26-199` 的大工具结果持久化描述准确

**需要收紧的一处**：
- §7.1 F2（Fake Bash Adapter）的描述偏抽象："只做解析/映射/参数校验，不直接执行"。但 `vpa-fake-bash-by-opus.md` 已经做了非常具体的决策：**vendor just-bash 的 browser 入口 + 裁剪命令集 + 自写 customCommands**。GPT 的 capability-runtime 设计应该**显式引用**这个已有决策，而不是重新定义一个"Adapter"概念。否则 GPT 的 FakeBashAdapter 与 Opus 的 just-bash vendor 策略之间会出现"两条路线"的歧义。

  **建议修正**：在 F2 详细阐述里加一条：
  > "FakeBashAdapter 在实现层面复用 just-bash 的 `Bash` class（browser 入口）+ `defineCommand` 自定义命令 API；adapter 本身只是 just-bash 与 CapabilityRegistry 之间的粘合层，不是独立的 shell runtime。"

**结论**：修正 F2 描述后可以进入 action-plan。

---

### 1.3 `workspace-context-artifacts-by-GPT.md` — ⭐⭐⭐⭐☆ (4/5)

**方向正确，代码引用准确，有两处需要与已有实现对齐。**

**与 README 精神的对齐度**：高度一致。
- §0.1 准确地指出了"不冻结此层会导致 fake bash 不知道读什么文件 / llm-wrapper 不知道何时 inline / compact 不知道裁什么 / DO/KV/R2 不知道分什么"
- §6.1 取舍 1（mount-based virtual workspace）是 README §3 "Virtual FS / mount-based workspace"的直接落地
- §6.1 取舍 2（artifact ref / prepared artifact）与 LLM Wrapper 设计的 `AttachmentRef` / `Prepared Artifact` 概念完全对齐

**与 NACP 基座的对齐度**：部分需要收紧。

**Gap 1**：GPT 的 `ArtifactRef` 概念与 NACP-Core 已有的 `NacpRefSchema` 之间的关系不清晰。
- NACP-Core 已经在 `envelope.ts` 里定义了 `NacpRefSchema`（`{kind: "r2"|"kv"|"do-storage"|"d1"|"queue-dlq", binding, team_uuid, key, role: "input"|"output"|"attachment"}`），并且有 tenant namespace refine。
- GPT 的 `ArtifactRef`（§1.2 术语表）描述为"对大对象/附件/导出物的稳定引用"——这与 `NacpRef` 的 `role: "attachment"` 变体功能重叠。
- **建议修正**：`ArtifactRef` 应该被定义为 `NacpRef` 的一个 **typed wrapper**（构造时强制 `role: "attachment"` 或 `role: "output"` + 附加 `artifact_kind` 字段），而不是一个完全独立的引用模型。否则系统里会有两套引用体系。

**Gap 2**：GPT 的 `WorkspaceNamespace` 概念与 just-bash 的 `MountableFs` + `IFileSystem` 之间的关系不清晰。
- `vpa-fake-bash-by-opus.md` §3 已经做了具体决策：vendor just-bash 的 `InMemoryFs` + `MountableFs`，再自写 `R2BackedFs` / `DoStorageFs`。MountableFs 的 `routePath()` 方法（`mountable-fs.ts:182-221`）已经是"mount-based namespace"的完整实现。
- GPT 的 `WorkspaceNamespace`（F1）应该**显式声明**它是 just-bash `MountableFs` 的 Worker-native 变体，而不是从零设计一个新的 namespace 抽象。否则会重新造 `MountableFs` 的轮子。

  **建议修正**：在 F1 详细阐述里加一条：
  > "WorkspaceNamespace 在实现层面基于 just-bash 的 `MountableFs` class，挂载 `InMemoryFs`（/tmp）+ `R2BackedFs`（/workspace）+ `DoStorageFs`（/.nano）。不从零写 mount/route 逻辑。"

**代码引用的准确性**：全部核实通过。
- `just-bash/src/fs/interface.ts:110-220` 的 IFileSystem 接口描述准确
- `just-bash/src/fs/mountable-fs/mountable-fs.ts:50-240` 的 mount 模型描述准确
- `claude-code/utils/attachments.ts:1-260` 的 attachment 注入描述准确
- `claude-code/services/compact/compact.ts:122-145,202-240` 的 compact strip/reinjection 描述准确
- `claude-code/utils/toolResultStorage.ts:26-199` 的大结果持久化描述准确

**结论**：修正两个 Gap 后可以进入 action-plan。

---

## 2. 跨文档一致性检查

| 检查项 | agent-runtime-kernel | capability-runtime | workspace-context-artifacts | 结论 |
|--------|---------------------|-------------------|---------------------------|------|
| 是否引用 NACP-Core/Session | ✅ §0.2 + §2.2 | ✅ §2.2 | ✅ §2.2 | 一致 |
| 是否坚持 Worker-native 宿主 | ✅ §0.2 + §3.1 | ✅ §0.2 + §3.1 | ✅ §0.1 + §3.1 | 一致 |
| 是否坚持单 agent 单线程 | ✅ §0.2 + O1 | 未明确提及 | 未明确提及 | kernel 覆盖了，其他两份依赖 kernel |
| Session/Turn 双层状态 | ✅ S1 | 未直接提及（依赖 kernel） | 未直接提及（依赖 kernel） | 一致：capability 和 workspace 不需要重复定义 |
| Compact 的位置 | ✅ kernel 显式 step | 未提及（正确：compact 不是 capability） | ✅ F5 CompactBoundaryManager | 一致：kernel 调度 compact，workspace 定义 compact 边界 |
| Progress/Cancel contract | ✅ F4 Runtime Event | ✅ S5 + F5 | 未直接提及（progress 是 capability 而非 workspace 的事） | 一致 |
| delegate contract 统一性 | ✅ F5 Kernel Delegates | ✅ F3 Capability Executor | ✅ F1 WorkspaceNamespace 作为读写接口 | 一致 |
| 术语 "ArtifactRef" vs "NacpRef" | 未提及 | 未提及 | ⚠️ ArtifactRef 与 NacpRef 关系不清 | **需修正** |
| 术语 "FakeBashAdapter" vs "just-bash vendor" | 未提及 | ⚠️ Adapter 与 just-bash 关系不清 | 未提及 | **需修正** |

---

## 3. 对 NACP 基座事实的对齐验证

| NACP 基座事实 | agent-runtime-kernel | capability-runtime | workspace-context-artifacts |
|--------------|---------------------|-------------------|---------------------------|
| NACP-Core 有 `tool.call.request/response/cancel` 三个 Core message type | ✅ §2.2 提到 Core 内部消息 | ✅ §2.2 提到 service-binding | ❌ 未提及（应在 compact request/response 对齐） |
| NACP-Session 有 `session.stream.event` 9 kinds | ✅ §5.1 S4 提到 event emission | ✅ §5.1 S5 提到 progress 映射 | ❌ 未提及（应在 compact.notify 对齐） |
| NACP-Session `SessionWebSocketHelper.checkpoint()` | ❌ §5.1 S6 只说 "定义什么能 checkpoint"，未引用已有实现 | N/A | ❌ F6 SnapshotBuilder 未引用 |
| NACP-Core `ServiceBindingTransport` 在 send 前跑 validate+boundary+admissibility | N/A | ✅ §5.1 S6 提到 service binding | N/A |
| NACP-Core `verifyTenantBoundary()` | ❌ 未提及 | ❌ 未提及（capability runtime 也应在调用前验 tenant） | ❌ 未提及 |
| NACP-Core `NacpRefSchema` 的 tenant namespace refine | N/A | N/A | ⚠️ ArtifactRef 应与 NacpRef 对齐 |

**结论**：三份文档在"精神层面"对齐良好，但在**具体代码接口层面**的 NACP 引用偏弱——尤其是 `SessionWebSocketHelper.checkpoint()`、`verifyTenantBoundary()`、`NacpRefSchema` 这些已经在代码里冻结的 API 没有被显式引用。

---

## 4. 对 plan-after-nacp.md 的时序检查

`plan-after-nacp.md` §4.1 推荐设计顺序：
1. Agent Runtime Kernel → ✅ 已由 GPT 完成
2. Workspace / Context / Artifacts → ✅ 已由 GPT 完成
3. Capability Runtime / Fake Bash → ✅ 已由 GPT 完成
4. Session DO Runtime → ✅ 已由 Opus 完成
5. Eval / Observability → ✅ 已由 Opus 完成
6. Storage Topology → ✅ 已由 Opus 完成

**时序符合计划**。GPT 完成了前 3 个设计（偏"骨架定义"），Opus 完成了后 3 个设计（偏"运行时组装 + 数据分层"）。两组之间没有循环依赖。

---

## 5. 总结性陈述

### 5.1 agent-runtime-kernel-by-GPT.md

**这份文档是三份中最强的，可以直接进入 action-plan 阶段。** 它正确地把 codex 的 Session/Turn 双层状态、claude-code 的 compact-as-first-class-step、mini-agent 的 loop 可读性三家精华提炼成了一个"delegate-based kernel"设计。所有代码引用都经过核实为正确。唯一建议：F6 Checkpoint Contract 应显式引用 `SessionWebSocketHelper.checkpoint()` 已有格式。

### 5.2 capability-runtime-by-GPT.md

**方向完全正确，代码引用准确，但 FakeBashAdapter 需要与 just-bash vendor 策略对齐。** 当前 F2 的描述是"只做解析/映射/参数校验"，但 `vpa-fake-bash-by-opus.md` 已经做了非常具体的技术决策（vendor just-bash browser 入口 + defineCommand）。如果不在设计文档里显式桥接两者，后续 action-plan 会出现"两条路线"的风险。修正后即可进入 action-plan。

### 5.3 workspace-context-artifacts-by-GPT.md

**方向正确，代码引用准确，但有两个 Gap 需要收紧。** Gap 1：ArtifactRef 应被定义为 NacpRef 的 typed wrapper 而非独立引用体系。Gap 2：WorkspaceNamespace 应声明基于 just-bash `MountableFs` 而非从零设计。这两个 Gap 都不是方向错误——只是"已有实现已经冻结了某些接口，设计文档必须显式接上"。修正后即可进入 action-plan。

### 5.4 综合 Verdict

| 维度 | 评级 | 说明 |
|------|------|------|
| 与 README 精神的一致性 | 5/5 | 三份文档全部忠实于"Cloudflare-native / 不复刻 Linux / bash-shaped surface + typed runtime"原则 |
| 与 NACP 基座的对齐度 | 4/5 | 精神一致，但具体 API 引用（checkpoint / tenantBoundary / NacpRef）偏弱 |
| 代码引用的准确性 | 5/5 | 12 个代码位置全部核实存在且内容一致 |
| 对后续 action-plan 的可执行性 | 4/5 | kernel 可直接进；capability 和 workspace 修正 2 个 Gap 后可进 |
| 三份文档之间的一致性 | 5/5 | 术语 / 职责边界 / 依赖方向互不矛盾 |
| **综合 Verdict** | **⭐⭐⭐⭐☆ (4.5/5)** | **三份设计的方向、结构和代码根据全部正确。唯一不足是对已有 NACP + just-bash 实现的具体 API 引用需要收紧。修正 3 个具体 Gap 后，6 份设计文档（3 GPT + 3 Opus）可以共同构成 post-NACP skeleton 的完整蓝图。** |

### 5.5 建议的修正清单

| # | 文档 | 位置 | 修正内容 |
|---|------|------|---------|
| 1 | agent-runtime-kernel | F6 Checkpoint Contract | 引用 `SessionWebSocketHelper.checkpoint()` / `.restore()` 已有格式 |
| 2 | capability-runtime | F2 FakeBashAdapter | 明确声明基于 just-bash vendor + `defineCommand` API，不是独立 shell runtime |
| 3 | workspace-context-artifacts | F2 ArtifactRef | 定义为 `NacpRef` 的 typed wrapper（`role: "attachment"` + `artifact_kind`） |
| 4 | workspace-context-artifacts | F1 WorkspaceNamespace | 声明基于 just-bash `MountableFs` + 自写 `R2BackedFs` / `DoStorageFs` |
| 5 | 全部三份 | §8 代码清单 | 补充 `packages/nacp-core/` 和 `packages/nacp-session/` 的具体已冻结 API 引用 |
