# Nano-Agent 功能簇设计模板 — Hooks

> 功能簇: `Hooks`
> 讨论日期: `2026-04-15`
> 讨论者: `Claude Opus 4.6 (1M context)`
> 关联调查报告:
> - `docs/investigation/codex-by-opus.md` §4
> - `docs/investigation/claude-code-by-opus.md` §4
> - `docs/investigation/mini-agent-by-opus.md` §4
> - `docs/value-proposition-analysis-by-opus.md` §1.7
> - `docs/value-proposition-analysis-by-GPT.md` §3.7、§7.5
> - `docs/vpa-fake-bash-by-opus.md` §3.6
> - `README.md`（顶层立场：Cloudflare-native、WebSocket-first、service-composable）
> 文档状态: `draft`

---

## 0. 背景与前置约束

### 0.1 为什么现在讨论 Hooks

README 把 nano-agent 的产品形态定义为**"Cloudflare-native 的持久化 agent runtime"**，并明确列出"hooks / skills / capability bindings"为扩展模型的三件套。Hooks 在这个架构里的权重比在本地 CLI 里**更高**——因为 nano-agent 是平台型 agent，**谁可以在何时介入、谁可以读取/修改什么上下文、哪些行为可以被审计/转发/替换** 这三件事，共同决定了它作为平台的边界。

同时，Hooks 是三家代表 agent 在"可扩展性 / 平台化"维度上**差异最大的**一个功能簇——mini-agent 完全没做（1/5），codex 是极简 shell-only 路径（4/5），claude-code 是同类标杆（5/5，25 事件 + 4 执行模式）。nano-agent 坐落在 Worker 上，**三家的实现都不能原样照搬**：codex/claude-code 都假设本地 shell 可用，mini-agent 的"不做"又显然不够。必须主动设计。

### 0.2 前置共识（来自 README + VPA 文档）

- **运行时共识**：nano-agent 跑在 Cloudflare Worker V8 isolate / Durable Object 内，无本地 shell、无本地 FS、无本地子进程。
- **通信共识**：WebSocket 为主通信协议，DO hibernation + alarm 提供持久性。
- **扩展共识**：能力扩展优先走 **service binding**，第二选项走 **fetch to allow-listed URL**，第三选项走 **本地 TypeScript 回调**。
- **LLM 心智共识**：nano-agent 对 LLM 暴露 "bash-shaped compatibility surface"，但内部是 typed capability runtime。这意味着 hook 的**执行模式**不是 shell，是 worker-native 的调用形态。
- **三大深耕方向**：上下文管理 / Skill / 稳定性。Hook 是**稳定性**方向的重要基础设施（审计、观测、错误恢复都靠它），也是 **上下文**方向的重要杠杆（PreCompact/PostCompact/UserPromptSubmit 可以注入 additionalContext）。

### 0.3 显式排除的讨论范围

- **不讨论**"shell-only hook handler"——Worker 里没有 shell，这条路物理上不成立。
- **不讨论** claude-code 那种 25 事件的完整目录——我们要从 v1 的最小可用集出发。
- **不讨论** codex / claude-code 的具体 Rust / TypeScript 实现细节复用——它们的 handler 抽象假设本地进程，对我们无直接价值。
- **不讨论** skill / capability 的整体设计（那是另一个功能簇的议题）；本文只讨论 **skill frontmatter 如何声明 hooks 并注册为 session-hook**——这是 claude-code 里值得借鉴的唯一 skill × hook 联动点。
- **不讨论** permission mode（plan/auto/default）的完整规则，本文只讨论 **hook 如何表达 allow/deny/updatedInput**。

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Hooks`
- **一句话定义**：**Hooks 是 nano-agent 在会话生命周期关键节点上发出的、可被配置的、类型化的事件；每个事件允许注册 handler 去观测、阻断、修改输入、注入上下文，从而让客户端、组织策略、平台服务、外部 worker 都成为 agent 行为的一部分。**
- **边界描述**：
  - **包含**：事件定义与发射点、handler 的注册与解析、handler 的执行模型、事件对主 agent loop 的影响语义、hook 配置的来源分层与合并、hook 的可观测性与审计、与 skill/permission/context 子系统的挂接点。
  - **不包含**：具体工具实现（tool use）、上下文压缩算法本身（compact 算法）、permission mode 的规则引擎（policy engine）、skill registry 的物理格式（skill manifest）、LLM 调用本身的重试逻辑。Hooks 只在这些子系统的**生命周期边界**上做事件发射与回调分发。

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|------|------|------|
| **Event** | 主 agent loop 在某个关键点发出的一次类型化通知，携带结构化 payload | 事件名与 payload schema 形成**稳定契约**，是 hook 系统的 API |
| **Handler** | 对某个 event 做出响应的可调用单元 | 在 nano-agent 里是 worker-native 的（不是 shell） |
| **Handler Runtime**（执行模式） | handler 的物理形态：`local-ts` / `service-binding` / `fetch-http` / `llm-prompt`（后三者按需） | v1 只必须支持前两种 |
| **Matcher** | 对 event payload 做筛选的规则，决定某个 handler 是否触发 | 最简形态：按 tool 名 / event 子类型字符串 |
| **Dispatcher** | 事件触发时负责挑 handler、排顺序、收集结果、聚合回主 loop 的调度器 | 单 DO 内同步执行；禁止 handler 自己起子 agent |
| **HookOutcome** | handler 返回给主 loop 的结构化结果：`{ ok, block?, updatedInput?, additionalContext?, stop? }` | 统一 schema 避免每个事件各写各的 |
| **Blocking vs Observing** | handler 是否能**改变**主 loop 流程；observing handler 只读不写 | 由 handler 声明，dispatcher 据此跳过不必要的结果合并 |
| **Registration Source** | hook 来源的层级：`project` / `session` / `skill` / `client` / `platform-policy` | 决定优先级、审计归因、熔断策略 |

### 1.3 参考调查报告

- `docs/investigation/codex-by-opus.md` §4 — codex 的 shell-only hook 路径、5 事件枚举、regex matcher、JSON stdin/stdout 协议
- `docs/investigation/claude-code-by-opus.md` §4 — claude-code 的 25 事件 / 4 执行模式 / SSRF + allowlist 多层防御 / `hookSpecificOutput` 结构
- `docs/investigation/mini-agent-by-opus.md` §4 — mini-agent 显式不做 hook 的极简决策
- `docs/value-proposition-analysis-by-GPT.md` §3.7 — "hooks 是平台型 agent 的核心产品化机会" 的立场
- `docs/value-proposition-analysis-by-opus.md` §1.7 — "service binding hook 是独有能力" 的判断

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**：**可插拔扩展层 + 平台治理骨架**。从 LLM 的角度看 hooks 不存在（它只看到 tool result）；但从**运维者 / 产品集成方 / 审计人**的角度看，hooks 是 nano-agent 的主要能力界面之一。
- **服务对象**：
  1. **开发者自己**（主要）：用 hook 做 debug/trace/实验性能力注入（例如 "每次 PreToolUse 打一条日志到 DO storage"）
  2. **平台策略**（次要但长期重要）：未来把 nano-agent 作为后端时，企业审计、配额、合规拦截都走这里
  3. **skill / 技能扩展**：skill 可以声明自己需要的 session 级 hooks
  4. **客户端**：WebSocket 上的客户端可以订阅 hook 事件流（作为一种 tap，不一定是回写 handler）
- **上游依赖**：
  - 主 agent loop（事件发射点）
  - Capability runtime（hook runtime 之一是 service binding，依赖它解析绑定）
  - DO storage（hook 配置持久化 + 审计日志）
  - Secure fetch 层（hook runtime 之一是 allow-listed HTTP）
- **下游被依赖**：
  - Context assembler（`UserPromptSubmit` / `SessionStart` / `PreCompact` 的 `additionalContext` 注入）
  - Permission engine（`PreToolUse` 的 allow/deny/updatedInput 决策）
  - 可观测性管道（所有事件都是 trace 的原料）
  - Skill runtime（skill 可以在激活时注册 session hook）

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|---------|---------|------|
| **LLM 请求层** | `UserPromptSubmit` / `LLMCallPre` / `LLMCallPost` 在 LLM 调用前后发射 | 中 | Hook 可读 prompt、可观测 usage；不直接修改 LLM 参数 |
| **Tool Use** | `PreToolUse` / `PostToolUse` / `PostToolUseFailure` 在每次 tool 调用前后发射 | 强 | Hook 是 tool 决策与观测的主要插入点 |
| **上下文管理** | `SessionStart` / `UserPromptSubmit` / `PreCompact` / `PostCompact` 发射 | 强 | `additionalContext` 是 hook 对上下文的主要作用途径 |
| **Skill** | skill frontmatter 声明 hooks → 激活时注册为 session hook | 中 | 参考 claude-code 的 `registerSkillHooks`；生命周期与 skill 绑定 |
| **Permission** | `PreToolUse` 的 `HookOutcome.permissionDecision` → permission engine 消费 | 强 | Hook 可以先于 permission engine 表态；也可被它覆盖 |
| **TUI / Client** | 所有事件都通过 WebSocket 广播（可订阅）；特定事件的回写 handler 由客户端提供 | 弱 | 客户端 hook 是"远端注册"，需要强鉴权 |
| **Durable Object** | 事件发射时自动写审计日志到 `state.storage`；hook 配置也存这里 | 强 | DO 是 hook 的物理持久化底座 |
| **Fake Bash** | `PreToolUse` 的 tool_name 是 `bash`（fake bash 内的命令不单独事件化）；`bash` 命令内部的 trace 由 Transform plugin 负责 | 弱 | 避免 event 爆炸：一次 `bash` 调用只发一次 Pre/Post，不为每条子命令事件化 |
| **Session 持久化** | `SessionStart` / `SessionEnd` / `SessionResume` 都是 hook 事件 | 中 | resume 时 hook 配置要从 DO 恢复 |

### 2.3 一句话定位陈述

> **在 nano-agent 里，`Hooks` 是"可插拔扩展层 + 平台治理骨架"**，负责**在会话生命周期的关键节点上发出类型化事件并聚合 handler 结果回主 loop**，对上游提供 **"稳定的事件契约 + 结构化 HookOutcome"**，对下游要求 **"runtime 必须是 worker-native（local-ts 或 service-binding），禁止调用本地 shell，所有执行必须有硬性超时与 AbortSignal 传播"**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| Shell-command handler runtime | codex、claude-code 的 `type: "command"` | Worker 没有 shell；就算有也违背 "typed capability runtime" 的定位 | **永不回补** |
| 25 个事件的完整目录 | claude-code | v1 只需最小可用子集（见 §7.1 的 8 个事件）；剩余事件按需扩展 | 按需回补 |
| Agent runtime (起 sub-agent 做 hook) | claude-code 的 `execAgentHook.ts` | 与 README 的 "单 agent、单线程为早期核心" 冲突；也会引起 hook→hook 递归 | 中期按需 |
| `CwdChanged` / `FileChanged` fs-watcher | claude-code | 我们没有真实 fs；fs 变更意味着 R2/DO 写入，直接走 `PostToolUse` 就够 | 不计划 |
| `TeammateIdle` / `TaskCreated` / `TaskCompleted` | claude-code | v1 无 sub-agent / task 系统 | 同 sub-agent 一起重评 |
| 多 config layer 的复杂合并（4 层 settings + plugin + session） | claude-code | v1 只需 2 层（platform-policy + session），合并规则一张表解释完 | 按需扩展 |
| `once: true` 的 single-shot hook | claude-code | v1 能用 session hook 的显式 unregister 替代 | 可能补 |
| Prompt-only hook runtime | claude-code `execPromptHook` | 能用 service-binding 到 "small-model worker" 实现；不必在主 isolate 里起 LLM 子调用 | 用 service-binding 覆盖 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 | v1 行为 | 未来可能演进 |
|--------|----------|---------|--------------|
| **`HookRuntime` 枚举** | `'local-ts' \| 'service-binding' \| 'fetch-http' \| 'llm-prompt'` 的联合类型 | v1 只实现 `local-ts` 与 `service-binding`，其他两个**类型声明**但 runtime 抛 `NotImplemented` | fetch-http 加 allow-list + SSRF；llm-prompt 走 AI 绑定 |
| **`HookEvent` 字符串联合** | `"SessionStart" \| "UserPromptSubmit" \| "PreToolUse" \| ...` | v1 只发 8 个事件，但类型系统里保留"未来可能的"事件名作为注释 | 新事件只改类型 + 发射点 |
| **`HookOutcome` 可选字段** | `{ block?, updatedInput?, additionalContext?, stop?, feedback? }` | v1 只消费 `block` / `updatedInput` / `additionalContext`；其他字段字段**保留但忽略** | 未来按事件开放新字段 |
| **Registration source 层级** | `'platform-policy' \| 'project' \| 'session' \| 'skill' \| 'client'` | v1 先支持 `session` + `platform-policy`（后者来自 env var / wrangler.toml） | `project` / `skill` / `client` 按子系统成熟度补 |
| **Hook `priority` 字段** | 数字字段，排序 handler 执行顺序 | v1 按注册顺序执行，priority 字段**存但不读** | 多来源叠加时需要 |
| **Hook `async` 标志** | handler 是 fire-and-forget 还是 await | v1 全部 await；`async: true` **类型存在但 runtime 强制忽略** | 等可观测性成熟后放开 |
| **DO 持久化的 hook 配置 key** | `/.nano/hooks/config.json` (R2-like) + `/.nano/hooks/audit-YYYY-MM-DD.jsonl` | v1 直接读写 DO storage；key schema 规定好 | 版本化 schema 可以无缝升级 |
| **Hook 事件流广播到 WebSocket** | `{type: "hook.event", event: "...", payload: ...}` 消息类型 | v1 发送但客户端可选订阅；**必须有一个 subprotocol version 字段**让将来能加新事件 | 客户端可注册 filter |

### 3.3 完全解耦点（哪里必须独立）

- **`HookDispatcher` 独立模块**：`src/hooks/dispatcher.ts`，只依赖 `HookEvent` / `HookOutcome` 类型和 `HookRegistry`；**不依赖**任何主 loop 具体模块。主 loop 通过 **注入 dispatcher 实例**或**调用 `dispatcher.emit(event, payload)`** 来使用它——永远不 import 主 loop 符号。
  - 原因：让 hook 系统能在单元测试里独立跑通；让主 loop 的重构不破坏 hook 契约。
- **`HookRuntime` 实现模块与 dispatcher 分离**：`src/hooks/runtime/local-ts.ts`、`src/hooks/runtime/service-binding.ts`、（未来）`fetch-http.ts`、`llm-prompt.ts`。每个 runtime 是一个独立文件，实现同一个 `HookRuntime` 接口。
  - 原因：新加 runtime 不应需要改 dispatcher；runtime 的依赖（例如 service binding 的 env 读取）也不污染 dispatcher。
- **审计日志写入与 dispatcher 分离**：`src/hooks/audit.ts` 订阅 dispatcher 的发射流，**不在 dispatcher 内部写日志**。这样测试时可以 mock 日志，也能把审计侧 pipeline 换成 Queue / D1 而不动 dispatcher。
- **事件类型 + payload schema 独立**：`src/hooks/events.ts` 只包含类型声明 + zod schema + `isHookEvent(x)` 守卫。不含任何执行逻辑，可以被 client SDK 直接 import。

### 3.4 聚合点（哪里要刻意收敛）

- **所有事件发射点都走 `HookDispatcher.emit`，不允许主 loop 里直接 call handler**：即便是最简单的 "log 一下当前 step"，也必须走事件化。这是为了让**将来所有 trace / audit / debug 都有唯一数据源**。
- **所有 hook 配置在 `HookRegistry` 里聚合**：platform-policy、session、skill 注册的 hook 都在一个统一 registry 里被存储，注册时打"来源"标签，dispatcher 查询时按事件筛选、按 priority+registration order 排序。
  - 原因：避免出现 "某个事件的 handler 散落在 5 个地方" 的失控状态。
- **所有 hook 的 outcome 合并逻辑在一处**：`HookDispatcher.reduceOutcomes(results)` 单函数决定如何把 N 个 HookOutcome 合成一个最终 outcome（block 优先、updatedInput 按来源顺序 override、additionalContext 叠加拼接）。
  - 原因：合并规则是 hook 系统**最容易出 bug** 的地方，集中一处才能审查清楚。
- **所有错误与超时处理在 runtime 层统一**：每个 runtime 的 `run(handler, payload)` 必须自己处理 AbortSignal、超时、异常；dispatcher 收到 `HookOutcome` 就是干净数据，不需要再 try/catch。

---

## 4. 三个代表 Agent 的实现对比

> 为 nano-agent 设计服务，仅列**能决策 in/out-of-scope 的要点**，不复述 investigation 细节。

### 4.1 mini-agent 的做法

- **实现概要**：**完全没做** Hook 系统。`Agent.run()` 就是 "call LLM → execute tools → append messages" 的三步循环，中间没有任何插桩点（mini-agent investigation §4）。
- **亮点**：极简决策本身就是一种亮点——它证明 hook 在"个人教学级 agent"上并非必需。
- **值得借鉴**：**这个功能簇的存在必须被真正的产品诉求驱动，否则就是工程冗余**。对 nano-agent 来说，README 已经明确 "hooks 是 skill/service binding 的一等合作者"，所以驱动存在。
- **不打算照抄的**：显式不做。nano-agent 不是教学 agent。

### 4.2 codex 的做法

- **实现概要**：JSON 配置 + 5 事件（`PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `Stop` / `SessionStart`）+ **只能跑 shell 命令**（JSON stdin / JSON stdout / 600s 默认超时）+ 串行执行 + regex matcher。配置中的 `type: "prompt"` / `type: "agent"` 被 discovery 阶段**显式跳过**——文档承诺大于实现。
- **亮点**：
  - **JSON payload + JSON outcome** 的协议很简洁，handler 侧只需处理两个结构。
  - **事件类型与 outcome 结构分文件**（`events/pre_tool_use.rs` 等），对贡献者的阅读成本低。
  - **5 个事件就够一个能力过得去的 agent 跑**——这是 v1 事件范围的一个参考下限。
- **值得借鉴**：
  - **事件结构：一事件一类型定义 + 一个 outcome struct**——我们也这样组织 `src/hooks/events.ts`。
  - **5 事件最小集作为 v1 起点**——但我们要加 3 个 Worker 特色事件（见 §7.1）。
  - **handler 返回 `should_block + block_reason`** 这个 shape 值得抄进 `HookOutcome`。
- **不打算照抄的**：
  - **Shell runtime**（物理不成立）。
  - **文档承诺 vs 实现不匹配**的坑——我们的 `HookRuntime` 枚举必须在类型层严格标注 "v1 已实现 / v1 声明但抛 NotImplemented"。

### 4.3 claude-code 的做法

- **实现概要**：**25 事件 + 4 执行模式 (shell/prompt/HTTP/agent) + 4 层 settings 合并 + plugin + session hook**；带 SSRF 守卫、URL 白名单、env var 白名单、workspace trust、policy 熔断（`allowManagedHooksOnly` / `disableAllHooks`）。事件的 `hookSpecificOutput` 是按事件类型开放不同字段的联合结构。
- **亮点**：
  - **事件密度足够让 agent 的几乎所有行为都可插桩**——这在本质上把 agent 变成平台而不是工具。
  - **执行模式分层**（shell < prompt < HTTP < agent）让不同复杂度的 hook 各自有合适的 runtime。
  - **`registerSkillHooks`**：skill 可以在 frontmatter 里声明 hooks，激活时注入为 session hook——这是 skill×hook 联动的教科书式实现。
  - **SSRF 守卫**（`ssrfGuard.ts`）把 hook 层的网络访问安全做到了位。
  - **`hookSpecificOutput`** 的按事件开放字段让 outcome schema 严格可审。
  - **Policy 熔断**（`allowManagedHooksOnly` / `disableAllHooks`）是企业场景的关键开关。
- **值得借鉴**：
  - **`hookSpecificOutput` 的 shape**——我们的 `HookOutcome` 用同样的"base 字段 + 按事件扩展字段"。
  - **Policy 熔断**——我们的 `HookRegistry` 从 day 1 就支持"全局 kill switch"。
  - **SSRF 守卫与 allow-list**——等 `fetch-http` runtime 开启时直接抄 just-bash 的 `allow-list.ts`（已在 fake bash 设计里梳理过）。
  - **Skill → session hook 的注册流程**——`registerSkillHooks` 值得在 skill 功能簇设计时跨文档引用。
- **不打算照抄的**：
  - **25 个事件**——太多，在 nano-agent 不成熟的早期会成为"API 负担"。我们从 8 个事件起步，按需扩展。
  - **4 个 config layer**——本地 CLI 需要，我们是托管服务，2 层（platform-policy + session）足够。
  - **Shell runtime**（物理不成立）。
  - **Agent runtime**（起 sub-agent 跑 hook）——与 "单 agent / 单线程为早期核心" 的 README 立场冲突，也会引起 hook→hook 递归。

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | **nano-agent 倾向** |
|------|-----------|-------|-------------|--------------------|
| 事件数量 | 0 | 5 | 25 | **8（v1）** |
| 执行模式 | — | shell only | shell/prompt/HTTP/agent | **local-ts + service-binding** |
| Config layers | — | 3（system/user/project） | 4（+policy+plugin+session） | **2（platform-policy + session）** |
| Matcher 能力 | — | 按 tool 名 regex | 按事件类型的结构化字段 + regex | **按事件子类型字符串精确匹配 + glob-style wildcard** |
| Outcome 合并 | — | 串行最后一个覆盖 | 按 hookSpecificOutput 字段按优先级 | **block 优先；updatedInput 按注册顺序 override；additionalContext 叠加** |
| Handler 隔离 | — | 无（本地 shell） | 4 模式各自隔离；HTTP 有 SSRF | **service-binding 天然跨 worker；local-ts trusted 共享主 isolate** |
| 审计 | — | 无 | 通过 log 事件 | **DO storage JSONL，每条事件一行** |
| 熔断 | — | 无 | `allowManagedHooksOnly` / `disableAllHooks` | **`HOOKS_DISABLED` env flag + `platform-policy` 覆盖一切** |
| 与 skill 联动 | — | 无 | `registerSkillHooks` | **v1 占位；skill 设计时回填** |
| 客户端可订阅事件 | — | 无 | 无 | **v1 支持只读订阅（WebSocket 广播）** |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent v1 要做）

- **[S1] 8 事件最小集 + 稳定的事件-payload 契约**：`SessionStart` / `SessionEnd` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PostToolUseFailure` / `PreCompact` / `PostCompact`。每个事件有明确的 zod schema，是 nano-agent 平台的 API。
- **[S2] 两种 Handler Runtime**：`local-ts`（trusted 回调，直接跑在主 isolate）与 `service-binding`（通过 Worker service binding 调用另一个 worker）。两者共享统一的 `HookRuntime` 接口。
- **[S3] 统一 `HookOutcome` schema**：`{ ok: boolean, block?: {reason: string}, updatedInput?: unknown, additionalContext?: string, stop?: boolean, diagnostics?: string }`；按事件开放字段子集。
- **[S4] `HookRegistry` + `HookDispatcher`**：单进程内聚合所有 hook 配置；dispatcher 负责筛选、排序、执行、合并结果、写审计日志。
- **[S5] 两层 Registration Source**：`platform-policy`（来自 wrangler env / bootstrap 注入，最高优先级）+ `session`（session 启动时由客户端或 skill 注入）。其他来源（project / client / skill frontmatter）在**类型层声明但 runtime 层 v1 不实现**。
- **[S6] Matcher**：按事件子类型字符串精确匹配 + `*` 通配；**不支持 regex**（减少攻击面和语义负担）。
- **[S7] 硬性超时 + AbortSignal 传播**：每个 handler 有默认 2 秒超时（可覆盖，上限 30 秒）；超时触发 AbortSignal，runtime 负责清理。
- **[S8] Outcome 合并规则**：`block` 一票否决；`updatedInput` 按注册顺序依次 override；`additionalContext` 按注册顺序拼接；`stop` 以"最后一个非 undefined 值"为准。
- **[S9] 熔断开关**：`HOOKS_DISABLED` env flag + `platform-policy` 可强制关闭所有 session hook。
- **[S10] 审计日志 (DO storage)**：每一次事件发射都写一条 JSONL 记录到 `/.nano/hooks/audit-YYYY-MM-DD.jsonl`（通过 DoStorageFs 或直接 DO storage API），包含 event、matched handlers、每个 handler 的耗时与 outcome 摘要。
- **[S11] WebSocket 事件广播（只读订阅）**：客户端可以订阅 hook 事件流作为 trace，但不能注册回写 handler（v1）。消息 schema `{type: "hook.event", ts, event, payload, aggregatedOutcome}`。
- **[S12] 类型化的 `HookEvent` 联合 + 发射点类型检查**：发射点调 `dispatcher.emit("PreToolUse", payload)` 时，TS 编译器检查 payload 是否匹配该事件 schema。类型错配不能过 CI。
- **[S13] Dry-run 工具**：一个 CLI / admin endpoint，给定当前 hook 配置和一个 mock event，打印会触发哪些 handler、顺序、以及 outcome 合并结果——不实际执行。

### 5.2 Out-of-Scope（v1 不做）

- **[O1] Shell-command runtime**：永不做。Worker 物理不成立，且与 typed capability runtime 立场冲突。
- **[O2] Agent runtime（起子 agent 跑 hook）**：与 "单 agent 单线程为核心" 冲突；且容易诱发 hook→hook 递归。等 sub-agent 子系统成熟后再评估。
- **[O3] `fetch-http` runtime**：需要 SSRF 守卫 + URL allow-list + env var 白名单等一整套安全基础设施，v1 先用 service binding 覆盖同样场景（让用户写一个 proxy worker）。类型声明保留。
- **[O4] `llm-prompt` runtime**：同 O3，用 service binding 到 AI 绑定的 worker 替代。
- **[O5] Regex matcher**：v1 不开放 regex；等见到真实的"通配符不够用"的场景再说。减少攻击面与语义负担。
- **[O6] 完整的 25 事件集**：`TeammateIdle` / `TaskCreated` / `TaskCompleted` / `Elicitation*` / `WorktreeCreate/Remove` / `CwdChanged` / `FileChanged` / `PermissionDenied` / `PermissionRequest` / `Notification` / `StopFailure` / `InstructionsLoaded` / `ConfigChange` / `Setup` / `SubagentStart` / `SubagentStop` 全部不做。
- **[O7] 4 层 settings 合并**：`project` / `client` / `skill` 来源在 v1 不落地。
- **[O8] 客户端回写 handler**：v1 客户端只能订阅事件流；不能注册会影响主 loop 的 handler（鉴权与治理的复杂度太高）。
- **[O9] Handler 优先级字段**：声明但不消费；v1 按注册顺序执行。
- **[O10] Async fire-and-forget handler**：声明但不消费；v1 所有 handler 都 await。
- **[O11] `once: true` single-shot handler**：声明但不消费；v1 用显式 `dispatcher.unregister(id)` 替代。

### 5.3 边界清单（灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| Skill 激活时注入 session-hook | **In-Scope（类型层）+ Out-of-Scope（运行时）** | v1 的 registry 支持 `source: "skill"` 的标签，但 skill 子系统 v1 不实际注册——等 skill 功能簇设计时回填 |
| Fake bash 执行期间的子命令级事件 | **Out-of-Scope** | 一次 `bash` 调用只发一次 `PreToolUse/PostToolUse`；子命令级 trace 由 fake bash 自己的 transform plugin 负责。避免事件爆炸 |
| LLM 调用前后事件 | **v1 不做** | 需要 `LLMCallPre / LLMCallPost` 两个新事件；与 `UserPromptSubmit` 有重叠但不完全等价；等上下文管理功能簇设计时决定 |
| Hook 对 `context.assembled` 的修改权 | **Out-of-Scope** | context 装配是上下文管理子系统的内部逻辑；hooks 只能在 `UserPromptSubmit` 通过 `additionalContext` 间接影响 |
| Hook 配置热更新 | **In-Scope（session）+ Out-of-Scope（platform-policy）** | session hook 可以在会话中动态 register/unregister；platform-policy 只在 DO 启动时读取一次 |
| Hook handler 之间共享状态 | **Out-of-Scope** | 每个 handler 被视为无状态函数；需要状态就自己写到 DO storage 或 KV |
| PreCompact 阻断压缩 | **In-Scope** | 上下文管理方向的关键安全阀；允许 handler 返回 `block: {reason}` 阻止本次压缩 |
| `HookOutcome.additionalContext` 的长度上限 | **In-Scope**（硬上限 8 KB） | 防止 handler 往上下文里塞爆炸性数据；超过则截断 + diagnostics 记录 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **"local-ts + service-binding 两种 runtime"** 而不是 **"复刻 claude-code 的 4 种 runtime"**
   - **为什么**：local-ts 是"trusted 内联代码"，相当于 just-bash 的 `defineCommand` 模式，开发成本几乎为零；service-binding 是 Worker 平台的最自然扩展点。这两种覆盖了"快速写一个观测回调" + "接入远端复杂能力"两个核心场景。HTTP / LLM-prompt 都能用 service-binding 封装出来（用户写一个 proxy worker 即可），不必 v1 内建。
   - **接受的代价**：(1) 用户想配 HTTP webhook 必须先部署一个 proxy worker，门槛略高；(2) 失去 claude-code 那种 "prompt hook 一行配置即用" 的低成本；(3) 失去 "agent hook" 这种"用一个 mini agent 做决策" 的高级能力。
   - **未来重评条件**：当 platform-policy 配置里出现 "超过 30% 的 handler 实际是 HTTP webhook" 时，考虑回补 `fetch-http` runtime。

2. **取舍 2**：我们选择 **"8 事件最小集"** 而不是 **"一步到位 25 事件"**
   - **为什么**：事件是 API，API 的稳定性比数量重要。我们希望 v1 发出的每个事件都有清晰的"为什么存在 / 谁会用它"的答案；剩余 17 个事件里**很多是 claude-code 为它自己具体功能（teammate / worktree / elicitation）定制的**，对 nano-agent 无意义。从 8 个事件扩展到更多，比从 25 个事件里反悔要容易得多。
   - **接受的代价**：(1) 某些精细埋点场景（例如想观测"被权限拒绝了的工具调用"）需要等 `PermissionDenied` 事件回补；(2) 平台化路径的"审计/埋点"深度受限。
   - **未来重评条件**：当我们自己写 hook handler 时，超过 3 次"希望有某个事件但没有"的场景，就新增该事件。

3. **取舍 3**：我们选择 **"2 层 registration source（platform-policy + session）"** 而不是 **"复刻 4 层 settings"**
   - **为什么**：nano-agent 是托管服务，不存在 "本地用户 / 项目 config 文件" 的概念；platform-policy 覆盖了运维侧的一切（审计、熔断、合规），session 覆盖了运行时侧的一切（skill 注入、客户端配置）。中间那些层（project / client / plugin）都是本地 CLI 的产物，在托管场景下会被 platform-policy 吞掉。
   - **接受的代价**：(1) 失去 "在项目根目录放 .hooks.json" 的开发者体验；(2) 团队级别的"项目共享 hook 配置"需要走另外的路径（例如存 DO storage 作为 session 配置模板）。
   - **未来重评条件**：当多租户支持成为正式需求，且租户想"在组织级别配置 hook 而不每次都在 session 里重复声明"时，加一层 `organization` 来源。

4. **取舍 4**：我们选择 **"WebSocket 事件流只读订阅"** 而不是 **"客户端可注册回写 handler"**
   - **为什么**：允许客户端注册回写 handler = 让任意 WebSocket 连接成为主 loop 的一部分。鉴权、信任、延迟、重连一致性都是难点。v1 先实现**观测订阅**（成本低、价值高、无治理风险），让客户端做 trace UI、实时日志、debug 面板完全够用。
   - **接受的代价**：(1) 客户端不能做"阻断型 hook"（例如 IDE 插件想在 PreToolUse 时弹窗确认）——这类场景要走 session hook 由服务器代理。
   - **未来重评条件**：客户端 "请求回写 handler 能力" 的需求超过 3 次时，单独做一个 "client hook" 子系统，带 JWT 鉴权 + rate limit。

5. **取舍 5**：我们选择 **"hook 审计用 DO storage JSONL"** 而不是 **"D1 结构化表 / Analytics Engine"**
   - **为什么**：DO storage 是会话**强一致**的底座，审计日志和会话本身一起原子化持久；DO storage 的 JSONL 追加写成本低、恢复容易；查询需求在 v1 很少——有需求时单独起一个 "audit ingestion worker" 从 DO 抓数据写进 D1 或 Analytics Engine。
   - **接受的代价**：(1) 单 DO 50GB 上限对"跨 session 查询"不友好；(2) 没有 SQL 查询能力；(3) 需要自己实现日期轮转与归档。
   - **未来重评条件**：当出现"想要跨 session 统计 hook 触发次数/失败率" 的需求时，引入 D1 或 Analytics Engine 做二级存储，DO 只保留最近 N 天。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| **Hook handler 失控延迟主 loop** | 某个 service-binding handler 响应慢（几秒） | 用户体验受损；整个 session 卡住 | 硬性 2s 默认超时 + 30s 上限；超时 = `{ ok: false, diagnostics: "timeout" }` 继续 |
| **Hook 链式递归（hook 触发 tool，tool 又触发 hook）** | 不严谨的 handler 在 PostToolUse 里再触发 tool | 无限循环 + 耗尽 DO CPU 预算 | dispatcher 内部维护 `depth` 计数器，超过 3 层报错退出 |
| **Platform-policy 配置错误全盘锁死** | `platform-policy` 里一个 handler 永远 block 所有工具 | 整个 session 无法工作 | `HOOKS_DISABLED` env flag 作为"最后逃生舱"；同时审计日志记录每个被阻断的事件便于诊断 |
| **Hook 向 additionalContext 塞爆炸性数据** | 一个 handler 把整份 R2 bucket 拼成 context | 上下文窗口被塞满；LLM 调用失败 | `HookOutcome.additionalContext` 硬上限 8 KB，超过截断 + diagnostics |
| **Service-binding handler 的 worker 崩溃** | 目标 worker 宕机或返回异常 | 事件错误被吞没 | runtime 层面 catch + 转 `{ ok: false, diagnostics }`；审计日志记录；不 propagate 到主 loop |
| **Hook 事件流 WebSocket 泄露敏感数据** | 客户端订阅后看到了 PreToolUse 的完整 tool_input（可能含凭据） | 数据泄露 | payload 在广播前经过 `redact(payload, event)` 函数；凭据类字段由事件 schema 标 `sensitive: true`，广播时打码 |
| **类型声明与 runtime 不一致（codex 同款坑）** | HookRuntime 枚举里声明了 fetch-http 但 runtime 不支持 | 用户配置了但无声失败 | runtime 的 dispatch 函数对"类型声明但未实现"的 kind 直接抛 `NotImplementedError("fetch-http runtime not in v1")` |
| **Hook 在 DO hibernation 唤醒后丢失 session 配置** | 客户端重连，但 session hook 未持久化 | session hook 丢失，用户困惑 | session hook 配置写入 DO storage；DO 唤醒时从 storage 恢复 registry |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：
  - **v1 成本极低**：local-ts runtime 几乎是"注册一个 async 函数"那么简单；我们可以立刻用它做 trace / debug / 埋点而不写复杂基础设施。
  - **服从 README 的平台治理立场**：不必在本地 CLI 与托管服务两个心智之间反复横跳。
  - **阻断递归、硬性超时** 这些"安全网"让我们第一次加 hook 时不会立刻被坑。
- **对 nano-agent 的长期演进**：
  - **类型化的 `HookEvent` 联合 + zod schema** 让未来加新事件是"一次 commit"的成本，而不是"大重构"。
  - **审计 = dispatcher 的副产品**，未来做 compliance / 配额 / SaaS 化时不需要回头补基础设施。
  - **service-binding 默认作为主力 runtime** 让 hook 天然地与 skill、capability 子系统共享同一套"worker-as-extension"心智。
- **对三大深耕方向的杠杆**：
  - **上下文管理**：`PreCompact` / `PostCompact` / `UserPromptSubmit` / `SessionStart` 的 `additionalContext` 是上下文注入的主渠道之一。
  - **Skill**：skill 可以在 frontmatter 声明自己需要的 hook，激活时注入为 session hook——这是 skill × hook 的共生点。
  - **稳定性**：所有事件都落 DO 审计，崩溃后 replay、调试、回放都有原始数据；`PostToolUseFailure` 是错误恢复的主要钩子。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | `HookEvent` 类型 + zod schema | 8 个事件的 TypeScript 字符串联合，每个事件对应一个 `HookPayloadSchema` | ✅ **`emit("PreToolUse", payload)` 时 TS 编译器能在编译期拒绝错误 payload，zod 在 runtime 再校验一次** |
| F2 | `HookOutcome` 统一 schema | `{ ok, block?, updatedInput?, additionalContext?, stop?, diagnostics? }` + 按事件的字段开放表 | ✅ **任意 handler 返回的结果都能通过 `parseOutcome(event, raw)` 得到类型安全的 outcome 对象** |
| F3 | `HookRegistry` | 持有所有已注册 hook（来源、事件、runtime 配置、priority、matcher、timeout） | ✅ **`registry.lookup(event, payload) -> Handler[]` 按事件类型 + matcher 返回有序 handler 列表** |
| F4 | `HookDispatcher` | 聚合器：调用 lookup → 依次 run → 合并 outcome → 写审计 → 广播 WebSocket | ✅ **`dispatcher.emit(event, payload) -> Promise<AggregatedOutcome>` 是主 loop 唯一入口，任何发射点必须走它** |
| F5 | `LocalTsRuntime` | runtime 之一：直接 await 一个 in-proc async 函数；超时走 AbortSignal | ✅ **注册方式 `registry.register({ event, runtime: { kind: "local-ts", fn } })` 一行生效** |
| F6 | `ServiceBindingRuntime` | runtime 之二：调用 `env[bindingName][method](payload)`，超时走 AbortSignal | ✅ **注册方式 `registry.register({ event, runtime: { kind: "service-binding", binding, method } })` 一行生效，binding 在 wrangler.toml 声明** |
| F7 | Outcome 合并规则（`reduceOutcomes`） | block 一票否决；updatedInput 按顺序 override；additionalContext 按顺序拼接并截断 8 KB；stop 以最后非 undefined 为准 | ✅ **单函数 `reduceOutcomes(event, outcomes[]) -> AggregatedOutcome`，带单元测试覆盖全部合并组合** |
| F8 | `platform-policy` 加载器 | 启动时从 wrangler env / bootstrap 注入 JSON 读取 policy 级 hook 配置 | ✅ **DO 启动完成时，`platform-policy` hooks 已全部在 registry 中** |
| F9 | Session hook 注册 API | 运行时 `registry.registerSession(...)` / `registry.unregister(id)` | ✅ **WebSocket 协议或 skill runtime 可以在会话期间动态增删 hook，DO storage 持久化** |
| F10 | 超时与 AbortSignal 传播 | 每个 handler 有默认 2s / 最大 30s；dispatcher 使用 `AbortController` 控制 | ✅ **超时 = outcome `{ ok: false, diagnostics: "timeout-<seconds>s" }`，主 loop 不抛异常** |
| F11 | 递归深度保护 | dispatcher 维护 `ALS` (AsyncLocalStorage) 或 `context.depth`，超过 3 报错 | ✅ **第 4 层嵌套 emit 时直接抛出 `HookRecursionError`，审计日志记录** |
| F12 | 熔断开关 | `HOOKS_DISABLED` env flag + `platform-policy` 强制关闭所有 session hook | ✅ **设置 env 后，dispatcher 的 emit 立即返回空聚合结果；policy 侧的 `disableAllHooks` 同效** |
| F13 | 审计日志 | dispatcher 订阅 emit 事件，写 JSONL 到 DO storage 的 `/.nano/hooks/audit-YYYY-MM-DD.jsonl` | ✅ **每一次事件 emit 至少产生一条 audit record，含 event、matched handler id、每个 handler 的耗时与 outcome 摘要** |
| F14 | WebSocket 事件广播（只读） | 每次 emit 完成后把 `{type: "hook.event", ts, event, payload (redacted), aggregated}` 广播给订阅的客户端 | ✅ **客户端可通过 `subscribe("hook.event", filter?)` 拿到实时事件流；`sensitive` 字段被 redact** |
| F15 | Redact 函数 | 根据事件 schema 把 `sensitive: true` 的字段替换为 `"[redacted]"` | ✅ **`redact(event, payload)` 对所有广播/日志路径调用一次，单元测试覆盖每个事件的 sensitive 字段** |
| F16 | Dry-run CLI/endpoint | 输入 mock event + current registry，输出"会触发哪些 handler / 顺序 / 合并结果"（不真实执行） | ✅ **开发者可以用它验证新 hook 配置的行为而不污染真实 session** |
| F17 | `HookRuntime` 类型扩展接口 | `fetch-http` / `llm-prompt` 在类型层声明；runtime dispatch 表对 v1 不支持的 kind 抛 `NotImplementedError` | ✅ **用户配置了未实现 runtime 时立即失败而不是沉默忽略** |

### 7.2 详细阐述（前 6 个核心功能）

#### F1: `HookEvent` 类型 + zod schema

- **输入**：事件名（字符串字面量） + raw payload
- **输出**：type-safe `HookPayload<E>`
- **主要调用者**：主 loop 的发射点、dispatcher、client 订阅者、审计日志
- **核心逻辑**：
  ```ts
  // src/hooks/events.ts
  export const HOOK_EVENTS = [
    "SessionStart", "SessionEnd",
    "UserPromptSubmit",
    "PreToolUse", "PostToolUse", "PostToolUseFailure",
    "PreCompact", "PostCompact",
  ] as const;
  export type HookEvent = typeof HOOK_EVENTS[number];

  export const HookPayloadSchemas = {
    SessionStart: z.object({ sessionId: z.string(), source: z.enum(["startup","resume"]) }),
    PreToolUse: z.object({ toolName: z.string(), toolInput: z.unknown(), toolUseId: z.string() }),
    // ...
  } satisfies Record<HookEvent, z.ZodTypeAny>;

  export type HookPayload<E extends HookEvent> = z.infer<typeof HookPayloadSchemas[E]>;
  ```
- **边界情况**：
  - 事件名拼错 → TS 编译错
  - payload 结构错 → zod parse 错，dispatcher 降级为 `emit` 失败并写审计
- **一句话收口目标**：✅ **`emit("PreToolUse", payload)` 时 TS 编译期拒绝错误事件名/payload，zod runtime 再校验一次；每个 event 的 schema 100% 有单元测试**

#### F2: `HookOutcome` 统一 schema

- **输入**：handler 返回的原始对象
- **输出**：`AggregatedOutcome`（经合并后）
- **核心逻辑**：
  ```ts
  export const HookOutcomeSchema = z.object({
    ok: z.boolean(),
    block: z.object({ reason: z.string() }).optional(),
    updatedInput: z.unknown().optional(),
    additionalContext: z.string().max(8192).optional(),
    stop: z.boolean().optional(),
    diagnostics: z.string().optional(),
  });

  // 按事件类型开放字段的"许可表"
  export const AllowedOutcomeFields: Record<HookEvent, (keyof HookOutcome)[]> = {
    SessionStart:   ["ok", "additionalContext", "diagnostics"],
    PreToolUse:     ["ok", "block", "updatedInput", "additionalContext", "diagnostics"],
    PreCompact:     ["ok", "block", "diagnostics"],
    // ...
  };
  ```
- **边界情况**：handler 返回了某事件"不允许"的字段（例如 SessionStart 里返回 `updatedInput`）→ 被 dispatcher 过滤并写一条 diagnostic 到审计日志
- **一句话收口目标**：✅ **所有 handler 返回值都经过一次 `normalizeOutcome(event, raw)`，无法绕过"按事件开放字段"的许可表；违反许可的字段静默丢弃 + 写 diagnostic**

#### F3: `HookRegistry`

- **输入**：`registerPolicy(spec)` / `registerSession(spec)` / `unregister(id)`
- **输出**：`lookup(event, payload) -> Handler[]`
- **核心逻辑**：内部 `Map<HookEvent, HandlerEntry[]>`；lookup 时按 matcher 过滤 + 按 `(source priority desc, registration order asc)` 排序
- **边界情况**：
  - 同一 id 重复注册 → 返回旧 id 的 `unregister` warning
  - `platform-policy` 的 hook 不能被 session 覆盖
- **一句话收口目标**：✅ **`lookup(event, payload)` 返回的 handler 列表顺序可预测、可审计；重复注册、跨源覆盖都有明确的语义并被测试覆盖**

#### F4: `HookDispatcher`

- **输入**：`emit(event, payload)`
- **输出**：`AggregatedOutcome`
- **核心逻辑**：
  1. 熔断检查（`HOOKS_DISABLED` / `platform-policy.disableAllHooks`）
  2. zod 校验 payload
  3. 递归深度检查
  4. `registry.lookup(event, payload)`
  5. 依次 `runtime.run(handler, payload, signal)`，收集 outcomes
  6. `reduceOutcomes(event, outcomes)`
  7. 写审计日志 + 广播 WebSocket
  8. 返回聚合结果给主 loop
- **边界情况**：
  - 某个 handler 超时 → 当成 `{ ok: false, diagnostics: "timeout" }`，不中断其他 handler
  - 聚合结果里有 `block` → 主 loop 据此拒绝当前操作
  - 所有 handler 都失败 → 仍然返回一个"无阻断"的聚合结果，主 loop 正常继续
- **一句话收口目标**：✅ **`dispatcher.emit` 永不抛异常到主 loop，任何 handler 层面的错误都转成 outcome.diagnostics；主 loop 只消费聚合结果**

#### F5: `LocalTsRuntime`

- **输入**：`HandlerSpec<"local-ts">` + payload + signal
- **输出**：`HookOutcome`
- **核心逻辑**：
  ```ts
  async run(spec, payload, signal) {
    const timeoutMs = spec.timeoutMs ?? 2000;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), Math.min(timeoutMs, 30_000));
      const merged = anySignal(signal, controller.signal);
      const raw = await spec.fn(payload, { signal: merged });
      clearTimeout(t);
      return normalizeOutcome(spec.event, raw);
    } catch (e) {
      return { ok: false, diagnostics: `local-ts:${e.message}` };
    }
  }
  ```
- **边界情况**：handler 抛异常、超时、返回非对象
- **一句话收口目标**：✅ **注册一个 `async (payload, ctx) => outcome` 函数即可工作；超时 / 异常 / 非法返回都被标准化为 `{ ok: false, diagnostics: ... }`**

#### F6: `ServiceBindingRuntime`

- **输入**：`HandlerSpec<"service-binding">` `{ binding: "MY_HOOK_WORKER", method?: "fetch" | "rpc-method", timeoutMs? }` + payload + signal
- **输出**：`HookOutcome`
- **核心逻辑**：
  ```ts
  async run(spec, payload, signal) {
    const target = this.env[spec.binding];
    if (!target) return { ok: false, diagnostics: `no binding: ${spec.binding}` };
    // fetch 模式：POST JSON 到 target
    // rpc 模式（WorkerEntrypoint）：await target[method](payload)
    // 两种模式统一包一层超时 + 异常捕获
  }
  ```
- **边界情况**：binding 不存在、目标 worker 崩溃、返回结构不符合 HookOutcome
- **一句话收口目标**：✅ **用户在 wrangler.toml 声明 `[[services]]` 绑定后，一行配置即可让 hook handler 跑在另一个 worker 里；所有失败路径都转成 diagnostics**

### 7.3 非功能性要求

- **性能**：single-handler emit 的开销 < 1ms；10 个 handler 的聚合 < 20ms（不含 handler 自身耗时）
- **可观测性**：每一次 emit 都必须产生审计日志条目；每个 handler 的耗时可在 DO storage 查询
- **稳定性**：dispatcher 永不抛异常到主 loop；handler 层的任何错误都降级为 outcome
- **测试覆盖**：100% 的事件 schema、100% 的合并规则组合、90%+ 的 dispatcher 路径、主要 runtime 的 happy path + 4 种错误路径

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/retry.py` 全文 | 极简异步重试装饰器 | **反例**：mini-agent 选择完全不做 hook——提醒我们 v1 要克制，只做必要的事件 | — |
| `context/mini-agent/mini_agent/llm/base.py:38` | `self.retry_callback = None` | 唯一接近"可注册回调"的点；说明**即便最小化的 agent 也需要一个 callback 接缝**，但它们没做成通用 hook | 提醒我们"callback 不是 hook" |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/hooks/src/engine/config.rs` | Hook JSON schema（handler / matcher） | **直接借鉴**：一文件一类型 + JSON schema 的组织方式；nano-agent 的 `events.ts` 以类似粒度组织 | 我们用 zod 替代 serde |
| `context/codex/codex-rs/hooks/src/engine/dispatcher.rs` | 事件→handler 分发 | **结构借鉴**：dispatcher 只做 lookup + 调度，不做副作用（副作用在独立模块） | 我们的 `HookDispatcher` 同构 |
| `context/codex/codex-rs/hooks/src/events/pre_tool_use.rs` | `PreToolUse outcome` 结构 `{ should_block, block_reason }` | **直接借鉴**：把 `should_block + reason` 作为所有 pre-* 事件的公共字段 | — |
| `context/codex/codex-rs/hooks/src/events/stop.rs` | `continuation_fragments` 字段 | **参考避坑**：不采用。我们不在 v1 开放"继续对话" 能力给 hook；太危险 | 作为 out-of-scope 的例子 |
| `context/codex/codex-rs/hooks/src/engine/discovery.rs:132-167` | 扫描配置时 `warn` 跳过 async/prompt/agent 类型 | **反例**：**类型声明与 runtime 不匹配就是坑**。nano-agent 对未实现的 `HookRuntime.kind` **必须抛 error 而不是 warn 跳过** | 映射到 F17 的收口目标 |
| `context/codex/codex-rs/core/src/hook_runtime.rs:281-299` | `record_additional_contexts()` 把 hook 返回的文本注入 developer instructions | **直接借鉴**：`additionalContext` 的注入点应在**上下文装配**而不是主 loop；我们也这么分层 | — |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/utils/hooks/hooksConfigManager.ts:1-124` | 多 config layer 合并 + snapshot | **结构借鉴**：合并与 snapshot 分离；snapshot 在 DO 启动时创建，之后不变（policy 层） | 我们简化为 2 层 |
| `context/claude-code/utils/hooks/hookEvents.ts` | 事件元数据（matcher 字段、payload shape） | **直接借鉴**：按事件定义 matcher 字段而不是全局 regex | 我们的 matcher 字符串精确匹配就够 |
| `context/claude-code/utils/hooks/AsyncHookRegistry.ts` | 运行时 handler 注册表 | **结构借鉴**：registry 的数据结构与 lookup 路径；**但不要异步 fire-and-forget** | — |
| `context/claude-code/utils/hooks/execHttpHook.ts` 全文 | HTTP runtime + URL allow-list + env var allow-list | **未来借鉴**：等 v2 实现 `fetch-http` runtime 时直接抄这个文件的结构 | v1 跳过但要存档 |
| `context/claude-code/utils/hooks/ssrfGuard.ts` | SSRF 守卫（私有 IP / loopback / 云 metadata） | **未来借鉴**：等 `fetch-http` 开启时与 just-bash 的 `allow-list.ts` 一起用 | — |
| `context/claude-code/utils/hooks/execPromptHook.ts` | LLM prompt runtime | **参考避坑**：v1 不做；用户需要时用 service-binding 到专用 worker 替代 | out-of-scope 证据 |
| `context/claude-code/utils/hooks/execAgentHook.ts:36-339` | Agent runtime（起子 agent 验证条件） | **主动避开**：与"单 agent 单线程"冲突；会诱发 hook→hook 递归 | 写进 §5.2 O2 |
| `context/claude-code/utils/hooks/registerSkillHooks.ts` 全文 | skill frontmatter → session hook 的注册流程 | **skill 功能簇回填参考**：v1 的 registry 预留 `source: "skill"` 标签，真正注册逻辑等 skill 子系统设计时写 | — |
| `context/claude-code/utils/hooks.ts:330-376` | `hookSpecificOutput` 解析 | **直接借鉴**：按事件开放 outcome 字段的"许可表"思路 | 我们的 `AllowedOutcomeFields` 是它的类型化版本 |
| `context/claude-code/types/hooks.ts:49-200` | 事件类型联合与 outcome 字段联合 | **直接借鉴**：zod 版的等价表达 | — |
| `context/claude-code/utils/hooks/hooksConfigSnapshot.ts` | `allowManagedHooksOnly` / `disableAllHooks` 熔断 | **直接借鉴**：F12 的熔断语义完全照抄 | — |

### 8.4 来自 just-bash（hook-relevant）

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/just-bash/src/transform/types.ts:1-29` | `TransformPlugin` 的链式 context + metadata 合并 | **结构借鉴**：hook dispatcher 的 "逐 handler 合并 outcome" 与 transform pipeline 同构，可复用心智 | — |
| `context/just-bash/src/transform/plugins/command-collector.ts` 全文 | AST walker 风格统计 | **间接借鉴**：fake bash 的 CommandCollectorPlugin 是"事件驱动观测"的另一层示范；说明"一次 tool_use 发一个 Pre/Post，不为每条子命令发事件"的分层是合理的 | §5.3 的灰色地带判断依据 |
| `context/just-bash/src/Bash.ts:645-655` | Transform pipeline 调用 | **参考**：hook dispatcher 与 transform pipeline 物理上是两个独立系统，但心智一致 | — |

### 8.5 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `context/codex/codex-rs/hooks/src/engine/discovery.rs:132-167` | 配置里的 `type: "prompt"` / `type: "agent"` 被 discovery **warn-skip**，用户看不到问题 | 我们对未实现的 runtime **硬抛 error**（F17） |
| `context/claude-code/utils/hooks/execAgentHook.ts:36-339` | 允许 hook 起一个有 tool 的 sub-agent 去验证条件 | 违反"单 agent 单线程"；会诱发 hook→hook→tool→hook 的无限递归；v1 用 local-ts + service-binding 代替 |
| `context/claude-code/utils/hooks/hooksConfigManager.ts` 中的 4 layer 合并 | 4 个来源的优先级与覆盖规则太复杂 | 我们收敛到 2 层（platform-policy + session） |
| `context/codex` 整个 hook 子系统的 **shell-only 假设** | 物理上在 Worker 不成立 | 我们明确文档中声明"nano-agent 的 hook runtime 不包括 shell" |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

Nano-agent 的 Hooks 子系统在 v1 是一个**"类型化事件 + 两种 worker-native runtime + 统一 outcome 合并 + DO 审计日志"**的紧凑实现。它不追求事件数量和执行模式的广度，而追求**API 稳定性**与**治理边界清晰度**。8 个事件覆盖"会话 / 用户输入 / 工具调用 / 上下文压缩"四条主线的生命周期关键点；两种 runtime (`local-ts` + `service-binding`) 覆盖"快速内联回调" + "跨 worker 扩展能力"两类使用场景；统一的 `HookOutcome` 结构让 `block / updatedInput / additionalContext` 的语义可预测、可审计、可合并。预估核心代码量 **800–1500 行 TypeScript**（不含测试），测试覆盖率目标 90%+。v1 结束时，**主 loop 的所有扩展点都通过 `dispatcher.emit` 走**，任何未来的平台化、审计、埋点需求都在这个接缝上继续生长，不需要重构主 loop。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 直接支撑 "Cloudflare-native 托管 agent runtime" 的平台治理边界 |
| 第一版实现的性价比 | 5 | 8 事件 + 2 runtime + 统一 outcome + DO 审计，预估 1500 行 TypeScript 可落地 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 5 | PreCompact/UserPromptSubmit 对接上下文，registerSkillHooks 对接 skill，审计日志对接稳定性 |
| 对开发者自己的日用友好度 | 4 | local-ts runtime 像写 React useEffect；service-binding 需要先部署 worker 门槛略高 |
| 风险可控程度 | 4 | 硬超时 / 深度限制 / 熔断 / redact 四道安全网到位；主要残留风险是"客户端泄露"（靠 redact 缓解） |
| **综合价值** | **5** | **少即是多：用最小表面做出正确的 API 契约，留给未来版本生长空间** |

### 9.3 下一步行动

- [ ] **决策确认**：本文档由 Opus 起草；建议在与 GPT 的 hooks-by-GPT 设计文档完成后做一次对比会审（target: 2026-04-22 前）
- [ ] **关联 Issue / PR**：暂无（v1 尚未开始编码）
- [ ] **待深入调查的子问题**：
  - `platform-policy` 的具体注入格式（env var JSON / wrangler.toml binding / bootstrap JS？）
  - DO storage JSONL 审计日志的**日期轮转** + **体量上限**策略
  - WebSocket 事件广播的 **subscribe filter** 语法是否在 v1 就开放
  - **skill 功能簇设计**完成后，回填 `registerSkillHooks` 的真正 registry 注册路径
  - `PreCompact` / `PostCompact` 事件的 payload 需要 **上下文管理功能簇设计** 完成后才能冻结
  - **LLM 请求层是否需要独立的 `LLMCallPre` / `LLMCallPost` 事件**（目前被 `UserPromptSubmit` / `PostToolUse` 近似覆盖）
- [ ] **需要更新的其他设计文档**：
  - 未来的 `docs/design/context-management-by-opus.md` — 应引用本文的 `PreCompact` / `PostCompact` / `additionalContext` 契约
  - 未来的 `docs/design/skill-by-opus.md` — 应引用本文的 `source: "skill"` 标签与 `registerSessionHook` API
  - 未来的 `docs/design/permission-by-opus.md` — 应定义 `PreToolUse` 的 `permissionDecision` 与本 hook 系统的 `updatedInput / block` 协同
  - 未来的 `docs/design/tool-use-by-opus.md` — 应把"每次 tool 调用前后调 `dispatcher.emit`"写进核心循环

---

## 附录

### A. 讨论记录摘要

- **分歧 1**：v1 是否应该支持 `fetch-http` runtime？
  - **论点 A**：支持——和 claude-code 对齐，用户可以直接配 webhook URL，门槛低
  - **论点 B**：不支持——SSRF 守卫、URL allowlist、env var allowlist 等安全基础设施的开发成本高；用户完全可以写一个 "proxy worker" 用 service-binding 替代，复杂度更低
  - **最终共识**：采纳 B。`fetch-http` 进 §5.2 Out-of-Scope (O3)，类型层声明但 runtime 层抛 `NotImplementedError`。当平台政策里的 handler 有 > 30% 属于 webhook 类型时回评。

- **分歧 2**：是否为 `PreCompact` 提供 `block` 能力？
  - **论点 A**：提供——上下文压缩是"信息丢失"的潜在风险点，需要逃生阀
  - **论点 B**：不提供——会让 session 进入 "卡在 compact 边界" 的死状态
  - **最终共识**：采纳 A，但 `block` 在 `PreCompact` 的语义是 "延迟到下一次 turn 再试"，不是"永久拒绝"；连续 3 次被 block 会降级为 warning 并强制 compact。

- **分歧 3**：事件命名用 `camelCase` 还是 `snake_case`？
  - **最终共识**：`PascalCase`（`PreToolUse`），与 claude-code / codex 一致，降低跨项目阅读负担。

### B. 开放问题清单

- [ ] **Q1**：`HookOutcome.updatedInput` 在 `PreToolUse` 的类型——是 `unknown` 还是 `Partial<ToolInput<T>>`？后者类型更强但需要 per-tool schema，v1 先用 `unknown` 还是直接上强类型？
- [ ] **Q2**：审计日志的日期轮转与归档 → 落 R2 bucket 还是 Cloudflare Logpush？
- [ ] **Q3**：`platform-policy` 配置支持**热更新**吗？默认"启动时快照"是否够？如果不够，用 `KV namespace` 做 pull 还是 `Queue` 做 push？
- [ ] **Q4**：`HookEvent` 未来新增事件的兼容性策略——旧客户端订阅时如何处理未知事件名？是 "忽略" 还是 "发 version-mismatch 错误"？
- [ ] **Q5**：WebSocket 事件流的 **subprotocol version** 字段格式与升级策略？
- [ ] **Q6**：`local-ts` runtime 的 handler 代码放在哪里——和主 worker 同 bundle 还是独立 chunk？v1 可以接受同 bundle 吗？

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-15 | Opus 4.6 | 初稿：8 事件 / 2 runtime / 统一 outcome / DO 审计 / WebSocket 只读订阅 |
