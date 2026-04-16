# Nano-Agent Capability Runtime 功能簇设计

> 功能簇: `Capability Runtime`
> 讨论日期: `2026-04-16`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/eval/vpa-fake-bash-by-GPT.md`
> - `docs/action-plan/nacp-core.md`
> - `docs/action-plan/nacp-session.md`
> - `docs/design/hooks-by-GPT.md`
> - `docs/design/llm-wrapper-by-GPT.md`
> - `README.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

### 0.1 为什么现在必须冻结 Capability Runtime

README 与 fake bash 分析已经把方向说清楚了：

> **nano-agent 不能把 shell 当系统真相，但必须给 LLM 一个 bash-shaped compatibility surface。**

这意味着，接下来要做的不是“写一个假的 bash 包装器”，而是先冻结：

1. nano-agent 的**最小能力面**是什么；
2. fake bash 如何路由到 **typed capability runtime**；
3. policy / approval / progress / cancel / service binding 如何在 Worker 宿主里成立。

### 0.2 本次讨论的前置共识

- fake bash 是 **LLM compatibility surface**，不是系统内核。
- nano-agent 不以 Linux、真实 bash、真实本地文件系统为宿主真相。
- Tool / command 的真正执行面应是 **typed、声明式、可治理、可回放** 的 capability runtime。
- `NACP-Core` 负责 internal contracts；`NACP-Session` 负责 progress / result 对客户端的 stream。
- v1 必须支持 **TypeScript-first** 的能力执行路径；是否未来出 WASM，不影响当前接口设计。
- fake bash 不应从零再造一套 shell runtime；第一版应明确建立在 `just-bash` 的 **browser entry + `Bash` + `defineCommand` / `customCommands`** 机制之上，把解析与命令外形复用下来，再路由到 capability plan。

### 0.3 显式排除的讨论范围

- 不讨论完整 shell parser / AST 实现细节
- 不讨论 provider 模型调用（属于 `LLM Wrapper`）
- 不讨论 virtual FS 细节（属于 `Workspace / Context / Artifacts`）
- 不讨论 skill registry 的持久化格式
- 不讨论完整浏览器自动化 DSL

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Capability Runtime`
- **一句话定义**：Capability Runtime 是 nano-agent 的**受控能力执行层**，负责把 fake bash / tool surface 映射成 Worker-native 的声明式执行单元，并统一处理 approval、policy、progress、cancel、result。
- **边界描述**：
  - **包含**：capability registry、command surface、execution targets、approval/policy gate、progress/cancel/result contract、minimal fake bash mapping
  - **不包含**：完整 POSIX shell、真实进程管理、完整 Git 实现、完整 workspace 持久化、完整 skill registry

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|------|------|------|
| **Capability** | 一个可声明、可授权、可执行的能力单元 | 如 `read-file`、`grep`、`fetch-url`、`ts-exec` |
| **Command Surface** | 给 LLM / 用户看的命令外形 | 如 bash command 或 structured tool |
| **Capability Registry** | 所有 capability 的中央注册表 | 包含 name、schema、policy、execution target |
| **Execution Target** | capability 真正执行的位置 | 如 `local-ts`、`service-binding`、`browser-rendering` |
| **Approval Gate** | capability 运行前的显式许可检查点 | 可以来自 policy、hooks、user approval |
| **Capability Progress** | 执行过程中的增量状态 | 后续映射为 `session.stream.event` |
| **Virtual Git Subset** | 对 git 工作流先验的最小兼容层 | 不是完整 git runtime |
| **Fake Bash Adapter** | 将命令文本映射到 capability plan 的适配层 | 第一版基于 just-bash browser entry / customCommands，而不是自写独立 shell |

### 1.3 参考调查报告

- `context/just-bash/src/Bash.ts` — AST-first shell runtime（`1-220`）
- `context/just-bash/src/commands/registry.ts` — 命令注册模型（`1-260`）
- `context/just-bash/src/fs/interface.ts` — 可替换 FS 抽象（`110-220`）
- `context/codex/codex-rs/tools/src/tool_definition.rs` — tool metadata / schemas（`4-26`）
- `context/codex/codex-rs/tools/src/tool_registry_plan.rs` — registry plan / handler kind / approval-aware assembly（`67-260`）
- `context/codex/codex-rs/exec-server/src/sandboxed_file_system.rs` — 通过 sandbox context 路由文件系统能力（`28-240`）
- `context/claude-code/tools.ts` — tool pool 组装与 deny-rule 过滤（`253-389`）
- `context/mini-agent/mini_agent/tools/bash_tool.py` — 本地 shell/background process 管理（`1-240`）
- `context/mini-agent/mini_agent/tools/file_tools.py` — 直接路径文件工具（`63-260`）

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**：受控能力执行层 + fake bash 兼容层的内核
- **服务对象**：
  1. agent runtime kernel
  2. hooks / permission / policy
  3. llm-wrapper（作为 tool schema / tool result 来源）
  4. session stream
- **它依赖于**：
  - workspace/context/artifact runtime
  - hooks / permission / policy seam
  - service bindings / Worker-native APIs
  - `NACP-Core` / `NACP-Session`
- **它被谁依赖**：
  - fake bash adapter
  - agent runtime kernel
  - hooks runtime
  - observability / eval harness

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `Agent Runtime Kernel` | 双向 | 强 | kernel 负责调度，capability runtime 负责执行 |
| `Workspace / Context / Artifacts` | 双向 | 强 | 绝大多数 capability 都读写 workspace 或 artifact refs |
| `Hooks` | 双向 | 强 | `PreToolUse / PostToolUse / Failure` 直接围绕 capability runtime |
| `LLM Wrapper` | Capability -> LLM | 中 | tool schema / tool result 进入模型请求 |
| `NACP-Core` | Runtime -> Core | 中 | service-binding / queue / hook emit 等内部调用可能走 Core |
| `NACP-Session` | Runtime -> Session | 强 | progress / result / error 要统一映射为 session stream |
| `Permission / Policy` | Policy -> Runtime | 强 | capability runtime 是最关键的治理边界之一 |
| `Browser / External Services` | Runtime -> External | 中 | 通过 service binding 或 CF 原生服务挂接 |
| `Storage Topology` | Runtime -> Storage | 中 | 哪些结果持久化、哪些只做瞬态输出，会影响后续存储收敛 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Capability Runtime` 是 **受控能力执行层**，负责 **把 fake bash / tool surface 转换成 Worker-native 的声明式 capability 调用**，对上游提供 **可治理、可取消、可观察的执行 contract**，对下游要求 **typed schema、明确 execution target、明确 policy/approval 边界**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 完整 POSIX / 完整 bash 幻觉 | just-bash | Worker 宿主不该背完整 Linux 兼容债 | 否 |
| 本地子进程 / background shell manager | mini-agent bash_tool | 与 V8 isolate / Worker 宿主冲突 | 否 |
| 任意 python3 / node child process 执行 | just-bash / 本地 CLI | v1 先做 TS-first，避免宿主假设错位 | 可能 |
| 真实 git 命令集 | 本地 agent CLI | nano-agent 只需要 virtual git subset | 可能 |
| 工具池全家桶一次性开放 | claude-code / codex | 过大能力面会让治理和 prompt drift 失控 | 否 |
| shell script runtime 直接成为系统内核 | just-bash | fake bash 是 compatibility surface，不是 kernel | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| Execution Target | `local-ts | service-binding | browser-rendering` | v1 只稳定 `local-ts` 与 `service-binding` | queue / wasm / remote worker |
| Command Surface | `bash-command | structured-tool` | v1 两种都支持，但内部统一进 registry | richer plan DSL |
| Capability Kind | `fs | search | net | exec | vcs | browser | context` | v1 保持最小集 | 增加更多 kinds |
| Approval Policy | `always-allow | ask | deny | hook-gated` | v1 保持简单枚举 | 更细粒度 rule engine |
| Progress Channel | `stream` callback / async iterator | v1 对长时任务开放 | finer event taxonomy |
| Virtual Git Subset | `status | diff | commit-buffer` | v1 只留接口，不全做 | 逐步增加 |

### 3.3 完全解耦点（哪里必须独立）

- **Capability Registry 与执行实现**
  - **解耦原因**：registry 负责声明能力，执行器负责真正运行；不能反过来让执行器自己定义对外协议。
  - **依赖边界**：registry 持有 schema / metadata / policy；executor 持有 target-specific logic。

- **Fake Bash Adapter 与 Capability Registry**
  - **解耦原因**：command surface 是兼容层，不应成为能力真相。
  - **依赖边界**：adapter 产出 capability plan；registry 决定能不能执行。

- **Policy / Approval 与执行器**
  - **解耦原因**：approval 是治理层，不是某个 capability handler 的私有逻辑。
  - **依赖边界**：执行前统一判定，执行器只消费结果。

- **Progress / Result 与 Session Stream Mapping**
  - **解耦原因**：capability runtime 负责产出 typed progress/result，不直接决定客户端事件长什么样。
  - **依赖边界**：由 session adapters 统一映射到 `NACP-Session`。

### 3.4 聚合点（哪里要刻意收敛）

- **所有 capability 声明都进 `CapabilityRegistry`**
- **所有 command-to-capability 路由都进 `FakeBashAdapter` / `CommandPlanner`**
- **所有 approval / deny 决策都进 `CapabilityPolicyGate`**
- **所有 progress / result / error 都进统一 result schema**
- **所有 execution target dispatch 都进 `CapabilityExecutor` façade**

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：提供真实 bash tool 与真实本地 file tools：`bash_tool.py` 管前后台 shell 执行与 bash_id（`1-240`），`file_tools.py` 直接基于 `Path` 读写本地文件（`63-260`）。
- **亮点**：
  - 能力面直观
  - read/write/edit 的入门设计很清楚
- **值得借鉴**：
  - 最小工具面应该围绕真实工作流，而不是从平台能力倒推一堆抽象名词
  - 文件工具对输入/输出 shape 的定义值得借鉴
- **不打算照抄的地方**：
  - 真实 shell / 真实本地 FS
  - background process manager
  - 以宿主 cwd 为真相

### 4.2 codex 的做法

- **实现概要**：`ToolDefinition` 只保留 name / description / schema / deferred-loading（`tool_definition.rs:4-26`）；`tool_registry_plan.rs:67-260` 则集中决定工具池、handler kind、shell 变体、approval tool、dynamic tools；文件系统访问又通过 `sandboxed_file_system.rs:28-240` 绑定 sandbox context。
- **亮点**：
  - registry plan 先于 tool 调度
  - handler kind 清楚
  - capability 与 sandbox/policy 的边界清楚
- **值得借鉴**：
  - 先定义 capability metadata，再决定对模型/运行时暴露什么
  - execution target / handler kind 要成为一等建模对象
- **不打算照抄的地方**：
  - shell / unified exec / sandbox 模式矩阵过重
  - 本地 sandbox 成本太高，不适合 Worker-first v1

### 4.3 claude-code 的做法

- **实现概要**：`tools.ts:253-389` 先组装工具池，再用 deny rules 过滤，最后与 MCP tools 合并；`toolExecution.ts` 则把 permission、hooks、telemetry、tool result persistence 串到一次工具执行里。
- **亮点**：
  - 工具池组装与过滤逻辑成熟
  - deny rules 会在“模型看见工具之前”就生效
  - tool execution 不只是函数调用，而是治理/审计链条的一部分
- **值得借鉴**：
  - tool pool 组装必须集中
  - blanket deny 这类规则应该在 prompt 前过滤，而不只是 call time 才拒绝
  - tool result persistence 是 capability runtime 必须考虑的现实问题
- **不打算照抄的地方**：
  - Node/local FS 假设过重
  - 工具池和本地 CLI mode 绑定过深
  - MCP / REPL / coordinator 混在一个本地工具装配图里

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| 工具抽象层次 | 低 | 中高 | 高 | 中高 |
| registry 中心化程度 | 低 | 高 | 高 | 高 |
| approval / policy 接入 | 低 | 中高 | 高 | 高 |
| 宿主假设 | 真实 shell / FS | 本地 sandbox / shell | 本地 CLI / Node | Worker / DO / service bindings |
| fake bash 兼容意识 | 弱 | 中 | 中 | 强 |
| 对 Worker 宿主适配度 | 低 | 低 | 低 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] Capability Registry**
  - 所有 capability 的 name、schema、execution target、policy metadata 必须在一个中央注册表里冻结。

- **[S2] Fake Bash → Capability Plan Adapter**
  - fake bash 只负责把熟悉命令面映射为 capability plan，不负责成为运行内核。

- **[S3] Minimal Capability Pack**
  - 至少覆盖：`pwd`、`ls`、`cat/read`、`write`、`rg/grep`、`curl/fetch`、`ts-exec`。

- **[S4] Approval / Policy Gate**
  - capability 执行前必须可被 hook / policy / permission 层阻断或改写。

- **[S5] Progress / Cancel / Result Contract**
  - capability runtime 要统一产出 progress/result/error/cancel shape，便于 `NACP-Session` 映射。

- **[S6] Service Binding Execution Target**
  - 允许某些能力不在本 session DO 内执行，而是通过 service binding 路由出去。

- **[S7] Virtual Git Subset 的接口占位**
  - 即使第一版不完整，也要留出“LLM 熟悉的版本工作流”接口。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] 完整 POSIX shell**
- **[O2] 真实本地进程 / 后台 shell 进程管理**
- **[O3] 完整 git 实现**
- **[O4] apt / npm / pip 这种宿主级包管理**
- **[O5] 任意二进制 / native runtime**
- **[O6] Python-first runtime**
- **[O7] 任意 socket / daemon / watch mode**

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `curl` 形状 | in-scope | 这是 LLM 最强的工作流先验之一，但内部必须走受控 fetch |
| `bash script` 自由执行 | out-of-scope | v1 不承诺完整 shell 语言与子进程模型 |
| `ts-exec` | in-scope | README 已明确 worker-native TS execution 是核心能力之一 |
| `python3` | out-of-scope | 未来可重评，但当前会把宿主复杂度拉高 |
| browser 执行能力 | defer | execution target 可以预留，但 DSL 与具体命令面后做 |
| virtual git subset | defer-but-reserve | 接口要留，第一版不必做全 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **声明式 capability registry** 而不是 **任意命令直转发**
   - **为什么**：这能保证 Worker-native runtime 的治理、可观察、可审核。
   - **我们接受的代价**：要写 registry / plan / adapter / schema。
   - **未来重评条件**：只有某些 command family 被证明足够稳定，才考虑放宽 adapter 自由度。

2. **取舍 2**：我们选择 **bash-shaped surface + typed runtime** 而不是 **完整 fake Linux**
   - **为什么**：我们要吸收 LLM 先验，但不能把平台能力反向绑死。
   - **我们接受的代价**：用户与模型会偶尔撞上“不支持”的边界。
   - **未来重评条件**：只有某些命令语义在 Worker 内确实能稳定模拟，才考虑补。

3. **取舍 3**：我们选择 **TS-first execution** 而不是 **多语言 runtime 并存**
   - **为什么**：TypeScript 与 Worker 宿主一致，能最快形成最小骨架。
   - **我们接受的代价**：数据分析/脚本类工作流一开始不如 Python 直观。
   - **未来重评条件**：当 WASM / sandbox runtime 真正确立后，再考虑 Python 等其他 execution target。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| fake bash 承诺过多 | 命令面铺太大 | prompt drift、实现负担失控 | 先冻结最小命令集与明确不支持清单 |
| capability registry 过抽象 | 只谈架构不落能力面 | v1 难以起跑 | 最小命令集 + 最小 execution target 同时冻结 |
| progress/cancel 语义不清 | 长时能力进入时 | session stream 混乱 | 一开始就统一 progress/cancel/result contract |
| policy 接入过晚 | 工具先写、治理后补 | 安全与审计返工 | approval gate 从第一版就是 registry 字段 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：以后新增能力时，只要注册 capability，而不是在 prompt、hook、session stream、permission 里到处加特判。
- **对 nano-agent 的长期演进**：为 service-composable skills / browser / future WASM runtime 留出正确边界。
- **对"上下文管理 / Skill / 稳定性"三大深耕方向的杠杆作用**：
  - 上下文管理：tool 结果能被结构化裁剪与持久化
  - Skill：skill 能注册或调用 capability，而不是绕过内核
  - 稳定性：progress / cancel / policy / approval 路径统一

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Capability Registry | 中央注册所有能力声明 | ✅ **所有能力的 name/schema/target/policy 都可集中查询** |
| F2 | Fake Bash Adapter | 将命令形状转为 capability plan | ✅ **bash 只是输入适配层，不是执行真相** |
| F3 | Capability Executor | 按 execution target 派发执行 | ✅ **local-ts 与 service-binding 两类 target 都能统一调用** |
| F4 | Policy / Approval Gate | 执行前治理 | ✅ **每个 capability 都能在执行前被 deny / ask / hook-gate** |
| F5 | Progress / Cancel Contract | 长时能力统一协议 | ✅ **progress / cancel / result / error shape 统一** |
| F6 | Minimal Capability Pack | 第一版关键能力面 | ✅ **最小命令集可以支撑真实 agent skeleton 验证** |

### 7.2 详细阐述

#### F1: `CapabilityRegistry`

- **输入**：capability declarations
- **输出**：可查询 metadata / schema / policy / execution target
- **主要调用者**：kernel、fake bash adapter、hooks/policy、tool prompt builder
- **核心逻辑**：注册能力，禁止匿名能力与无 schema 能力
- **边界情况**：同名 capability 冲突、deferred capability 加载
- **一句话收口目标**：✅ **所有 capability 都能被中央注册与枚举，而不是分散在 handler 里。**

#### F2: `FakeBashAdapter`

- **输入**：bash-shaped command / structured command
- **输出**：capability plan
- **主要调用者**：LLM 产生的 tool call、用户命令输入
- **核心逻辑**：
  - 复用 `just-bash` browser entry 提供的 `Bash`、`defineCommand`、`customCommands` 与受限命令表做“外形兼容”
  - 每个命令实现都只负责把参数整理成 capability plan，不直接持有宿主真相
- **边界情况**：不支持的命令必须显式拒绝，不做模糊 fallback
- **一句话收口目标**：✅ **命令表面与能力真相完全分离。**

#### F3: `CapabilityExecutor`

- **输入**：capability plan
- **输出**：typed progress / result / error
- **主要调用者**：agent runtime kernel
- **核心逻辑**：按 target dispatch 到 local-ts 或 service-binding
- **边界情况**：不可取消 target、超时 target、只读/写能力差异
- **一句话收口目标**：✅ **execution target 切换不影响上层 contract。**

#### F4: `CapabilityPolicyGate`

- **输入**：capability plan、session context、policy context
- **输出**：allow / ask / deny / hook-gated
- **主要调用者**：kernel、hooks runtime
- **核心逻辑**：执行前唯一治理入口
- **边界情况**：session-scoped 临时许可、持久 deny、hook veto
- **一句话收口目标**：✅ **治理逻辑不散落在各 capability 实现里。**

#### F5: `CapabilityExecutionResult`

- **输入**：target-specific execution output
- **输出**：normalized progress / result / error / cancel
- **主要调用者**：session stream adapter、audit sink
- **核心逻辑**：统一字段、统一错误分类、统一 progress shape；并明确区分 **transport-level progress stream** 与最终 `tool.call.response`
- **边界情况**：结果过大、需要 artifact persistence、长时任务断线恢复
- **一句话收口目标**：✅ **任何 capability 的输出都能走同一条 session/event 路。**

#### F6: `Minimal Capability Pack`

- **输入**：第一版命令/能力需求
- **输出**：`pwd` / `ls` / `cat` / `write` / `rg` / `curl` / `ts-exec`
- **主要调用者**：fake bash adapter、LLM tools
- **核心逻辑**：
  - 优先支撑真实开发/调试/验证场景
  - `rg` 在 Worker / isolate 内不是 native ripgrep：第一版应明确走 **纯 TS 命名空间扫描** 或 **service-binding search worker**，而不是承诺真实 `rg` 二进制
- **边界情况**：写能力与网络能力的 approval 默认值要比读能力更严格
- **一句话收口目标**：✅ **最小能力面足以驱动第一轮端到端 session 验证。**

### 7.2a `tool.call.*` / progress contract 对齐矩阵

> `Capability Runtime` 不只是“执行工具”，它还是 `NACP-Core` tool-call contract 的主要承接层。

| contract | capability runtime 责任 | 说明 |
|----------|-------------------------|------|
| `tool.call.request` | 由 registry 校验后的 capability plan 生成 | `tool_name` / `tool_input` 是对外 wire shape，不是内部执行真相 |
| `NacpProgressResponse.progress` | 作为 transport-level 增量流被消费 | progress 不是独立 Core message type，而是 `ReadableStream<NacpEnvelope>` |
| `tool.call.response` | 把 target output 归一成 ok/error 结果 | 再映射到 `tool.call.result` session event |
| `tool.call.cancel` | 将 kernel 的 cancel / timeout / interrupt 转成 target cancel | 本地 target 用 `AbortSignal`，远端 target 继续走 Core cancel |
| `system.error` | 对 transport / target 异常做统一 error normalization | 避免 capability target 泄漏宿主异常形状 |

### 7.2b 推荐的 execution route

| capability family | v1 推荐 target | 原因 |
|-------------------|----------------|------|
| `pwd` / `ls` / `cat` / `write` | `local-ts` | 直接跑在虚拟 workspace namespace 上最简单 |
| `rg` | `local-ts` for small mounted workspace; `service-binding` for larger/remote search | isolate 没有原生 ripgrep，必须主动声明降级路径 |
| `curl` | `local-ts` 受控 fetch 或 `service-binding` 网络 worker | 必须保留 CF/策略层治理 |
| `ts-exec` | `local-ts` 受限执行器 | 这是 Worker-native 的核心能力之一 |
| browser / external specialized ops | `service-binding` | 避免把浏览器或重能力直接塞进 session isolate |

### 7.3 非功能性要求

- **性能目标**：capability dispatch 不应引入大规模 runtime reflection
- **可观测性要求**：每次 capability 调用至少有 start/progress/end/error 四类标准事件
- **稳定性要求**：所有 target 必须支持 timeout / error normalization
- **测试覆盖要求**：registry、adapter、policy gate、result normalization、最小命令集各自独立测试

---

## 8. 可借鉴的代码位置清单

### 8.0 来自已冻结的 NACP 包

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `packages/nacp-core/src/messages/tool.ts:4-36` | `tool.call.*` schema | tool wire shape 的 source of truth | 本文 7.2a 直接对齐 |
| `packages/nacp-core/src/transport/service-binding.ts:1-77` | `ServiceBindingTransport` | validate + tenant boundary + admissibility + progress stream | capability 远端执行优先复用 |
| `packages/nacp-core/src/transport/types.ts:28-31` | `NacpProgressResponse` | progress 是 transport-level stream，不是独立 message type | 本文 F5 / 7.2a 直接引用 |
| `packages/nacp-session/src/stream-event.ts:10-25` | `tool.call.progress` / `tool.call.result` | capability 结果的 client-visible 外形 | session 映射应对齐 |

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/tools/file_tools.py:63-260` | read/write/edit 文件工具 | 最小工具输入输出 shape | 借鉴 tool surface，不借宿主假设 |
| `context/mini-agent/mini_agent/tools/bash_tool.py:52-214` | background shell manager | 说明“真实 shell + 进程管理”会带来怎样的复杂度 | 反向借鉴 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/tools/src/tool_definition.rs:4-26` | tool metadata | registry 元信息最小核心 | 强烈借鉴 |
| `context/codex/codex-rs/tools/src/tool_registry_plan.rs:67-260` | registry plan / handler kind / approval-aware assembly | 先 registry、后装配 | 强烈借鉴 |
| `context/codex/codex-rs/exec-server/src/sandboxed_file_system.rs:28-240` | sandbox context 路由文件系统能力 | execution target 与 sandbox/policy 分层 | 借鉴 execution target 思想 |

### 8.3 来自 just-bash 与 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/just-bash/src/browser.ts:1-62` | browser-compatible entry exports | 证明 just-bash 有浏览器入口可复用 | 直接支持本设计的 vendor 策略 |
| `context/just-bash/src/custom-commands.ts:29-67` | `defineCommand` / lazy custom command | fake bash 命令注册应以命令映射能力 plan 为主 | 强烈借鉴 |
| `context/claude-code/tools.ts:253-389` | tool pool 组装与 deny filtering | tool pool 中心化 + pre-filter deny rules | 强烈借鉴 |
| `context/claude-code/services/tools/toolExecution.ts:126-245` | permission/hook/telemetry 与 tool execution 串联 | capability execution 不只是纯函数调用 | 借鉴 side-effect seam |
| `context/claude-code/utils/toolResultStorage.ts:26-199` | 大工具结果持久化 | tool results 需要 artifact/persistence seam | 强烈借鉴 |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `context/mini-agent/mini_agent/tools/bash_tool.py:1-240` | 真实 shell + 后台进程管理 | Worker/V8 isolate 下不成立 |
| `context/just-bash/src/commands/registry.ts:15-114` | 命令面过宽，容易给出完整 Linux 幻觉 | nano-agent 早期必须严格收窄命令集 |
| `context/just-bash/src/Bash.ts:95-208` | shell runtime 直接承载过多宿主能力 | 我们要的是 capability-native runtime，不是 shell-native kernel |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

Capability Runtime 在 nano-agent 中会以一个**中央 registry + 多 target executor + bash adapter** 的形式存在。它是 fake bash、hooks、policy、session stream 的共同交汇点，但不应该自身膨胀成完整 shell 系统。代码量级预计 **中等偏上**，复杂度主要来自治理与 target abstraction，而不是命令数量本身。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 没有 capability runtime，fake bash 只是口号 |
| 第一版实现的性价比 | 5 | 先做最小命令集和统一 contract，收益极高 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 5 | skills、hooks、workspace 都会经过这里 |
| 对开发者自己的日用友好度 | 4 | 初期要多写 schema / registry，但后续扩展会更稳定 |
| 风险可控程度 | 4 | 主要风险是命令面失控；通过最小命令集可控 |
| **综合价值** | **5** | 这是 nano-agent 从“协议设计”走向“可干活 skeleton”的关键层 |

### 9.3 下一步行动

- [ ] **决策确认**：业主确认 v1 最小命令集与 execution target 范围
- [ ] **关联 Issue / PR**：创建 `docs/action-plan/capability-runtime.md`
- [ ] **待深入调查的子问题**：
  - `ts-exec` 的安全沙箱策略
  - browser-rendering target 的最小输入输出协议
- [ ] **需要更新的其他设计文档**：
  - `docs/design/workspace-context-artifacts-by-GPT.md`
  - `docs/design/session-do-runtime-by-GPT.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-16` | `GPT-5.4` | 初稿 |
| v0.2 | `2026-04-16` | `GPT-5.4` | 根据 Kimi / Opus 审核补充 just-bash vendor 对齐、tool.call.* 映射与 `rg` 执行路径 |
