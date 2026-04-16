# Nano-Agent Hooks 功能簇设计

> 功能簇: `Hooks`
> 讨论日期: `2026-04-16`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/design/hooks-by-opus.md`
> - `docs/nacp-by-opus.md`
> - `docs/value-proposition-analysis-by-GPT.md`
> - `README.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

### 0.1 为什么要重写这份文档

上一版 `hooks-by-GPT` 的方向基本正确，但它仍然停留在一个较早的判断上：

1. 它把 hooks 主要看作 **生命周期事件 + 扩展层**；
2. 但没有把 hooks 与 **NACP v2 的协议家族分层**真正对齐；
3. 也没有充分处理 **WebSocket-first / DO hibernation / session replay** 对 hook 可观测性的影响。

现在 `docs/nacp-by-opus.md` 已经明确把协议重构为：

- **NACP-Core**：内部 worker / DO / queue 的消息合同
- **NACP-Session**：client ↔ session DO 的会话流协议
- **Transport Profiles**：service-binding / queue / do-rpc / http-callback 等 wire 规则

这意味着 Hooks 也必须同步重写。否则它会继续把：

- **内部 hook 执行**
- **客户端 hook 事件流**
- **平台扩展与观测**

混成一个模糊层。

### 0.2 前置共识

- nano-agent 是 **Cloudflare-native、WebSocket-first、stateful、service-composable** 的 agent runtime。
- nano-agent **不以 Linux / shell / 本地 FS 为宿主真相**。
- fake bash 是 **LLM compatibility surface**，不是系统内核。
- hooks 的主要价值不是“方便加回调”，而是让 nano-agent 具备：
  - 平台治理能力
  - 组织策略接入点
  - 审计与可观测性骨架
  - service-binding 扩展接口
- Hooks 不是独立协议；它是 **Hooks 事件契约 + Hook 运行时 + Hook 与 NACP 的映射规则** 三部分的组合。

### 0.3 显式排除的讨论范围

- 不讨论 shell-command hook runtime
- 不讨论 sub-agent / agent-as-hook runtime
- 不讨论完整 permission 子系统，只讨论 hooks 如何与它挂接
- 不讨论 skill registry 的物理格式，只讨论 skill 如何注册 session hook
- 不讨论完整 WebSocket client 设计，只讨论 hook 事件如何进入 `NACP-Session`

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Hooks`
- **一句话定义**：Hooks 是 nano-agent 的**生命周期事件契约与平台治理扩展层**，允许受控能力在关键节点观测、阻断、增强主 agent loop。
- **边界描述**：
  - **包含**：事件目录、payload schema、handler 注册与执行、outcome 合并、审计、对客户端的只读事件流映射
  - **不包含**：tool 业务逻辑本身、permission 决策引擎本体、skill manifest 本体、LLM provider 协议

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|------|------|------|
| **Hook Event** | agent loop 某个关键节点发出的类型化事件 | 如 `PreToolUse` |
| **Handler** | 对某个 Hook Event 做出响应的受控单元 | v1 只支持 `local-ts` 与 `service-binding` |
| **Inline Hook** | 同步执行、可影响当前流程的 hook | v1 核心 |
| **Observer Hook** | 只读观测、异步派发、不改当前流程的 hook | v1 留接口，不落地 |
| **HookOutcome** | handler 返回给主循环的结构化结果 | 非自由 JSON |
| **Registration Source** | hook 的来源层级 | v1 只落 `platform-policy` 与 `session` |
| **Hook Execution Record** | 一次 hook 命中的执行记录 | 用于审计、回放、WebSocket 事件流 |
| **NACP-Core Mapping** | hook 跨 worker 执行时使用的 Core 消息映射 | `hook.emit` / `hook.outcome` |
| **NACP-Session Mapping** | hook 对客户端观测流的 Session profile 映射 | `session.stream.event` with hook kinds |

### 1.3 本文的核心设计命题

这次 Hooks 设计要回答的，不再只是“做不做 hook”，而是四个更具体的问题：

1. **哪些事件值得成为稳定平台 API**
2. **哪些 handler runtime 在 Worker 宿主里是合理的**
3. **hook 的内部执行与客户端观测，分别应该落在哪一层协议**
4. **如何让 Hooks 与 skill / context / audit / WebSocket 协同，而不把主 loop 搞成巨石**

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**：平台治理骨架 + 生命周期扩展层
- **服务对象**：
  1. 主 agent loop
  2. 平台策略 / 企业规则
  3. skill / capability 扩展作者
  4. 调试、审计、观测系统
  5. 订阅事件流的客户端

- **它依赖于**：
  - Tool runtime / fake bash capability runtime
  - Context management / compact pipeline
  - Durable Object state / storage
  - Service binding registry
  - NACP-Core / NACP-Session

- **它被下游依赖于**：
  - Permission / policy integration
  - Audit / replay
  - Skill runtime
  - Session trace UI / WebSocket stream

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| **Tool Use** | 双向 | 强 | `PreToolUse / PostToolUse / PostToolUseFailure` 是 hooks 核心 |
| **上下文管理** | 双向 | 强 | `UserPromptSubmit / PreCompact / PostCompact` 是上下文干预入口 |
| **Skill** | Skill -> Hooks | 中 | skill 可注册 session hook，但不控制 dispatcher |
| **Permission** | Hooks -> Permission | 中 | `PreToolUse` 可先行 block/normalize，但不替代 permission 引擎 |
| **Durable Object** | Hooks -> DO | 强 | registry、审计、resume 都依赖 DO state |
| **NACP-Core** | Hooks -> Core | 强 | 跨 worker hook 执行通过 `hook.emit / hook.outcome` |
| **NACP-Session** | Hooks -> Session | 强 | 客户端只读事件流通过 `session.stream.event` |
| **WebSocket Client** | Session -> Client | 中 | 只能观测，不可回写主 loop |
| **Fake Bash** | Bash -> Hooks | 中 | 一次 bash tool 调用只发一组 tool 级 hook，不事件化到子命令 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Hooks` 是 **生命周期事件契约 + 平台治理扩展层**，负责 **在关键节点把主循环暴露给受控能力**；跨 worker 执行走 **NACP-Core**，客户端观测走 **NACP-Session**，从而同时满足 **治理、扩展、审计、可回放** 四个目标。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否回补 |
|--------|--------------|----------|--------------|
| shell-command runtime | codex / claude-code | Worker 无 shell，且违背 typed capability runtime | 否 |
| `hook.broadcast` 作为 Core message | 旧版 NACP 草案 | 客户端观测不是内部 Core 合同 | 否，迁至 Session profile |
| 25 事件全集 | claude-code | 对 v1 是 API 负担 | 可能 |
| client 回写 handler | claude-code 一类富客户端想象 | 信任边界与重连一致性过重 | 可能，但非 v1 |
| regex matcher | codex | 灵活但难审计、难预测 | 可能 |
| agent runtime | claude-code | 与“单 agent、单线程”冲突，且易递归 | 中期再议 |
| `fetch-http` runtime | claude-code | 需要 SSRF、allowlist、secrets 治理，v1 成本过高 | 可能 |
| `llm-prompt` runtime | claude-code | 可由 service-binding 小模型 worker 替代 | 可能 |
| per-subcommand bash hook | 本地 shell 心智 | fake bash 子命令 trace 由自身 transform pipeline 负责 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 | v1 行为 | 未来演进 |
|--------|----------|---------|----------|
| Hook runtime | `'local-ts' \| 'service-binding' \| 'fetch-http' \| 'llm-prompt'` | v1 只实现前两种 | 增加安全 runtime |
| Observer delivery | `mode: "observer"` / `delivery: "queue"` | v1 只声明 | CF Queues / audit fan-out |
| Source 层级 | `platform-policy / session / skill / client / organization` | v1 落 `platform-policy / session` | 增加 organization / skill 实装 |
| Matcher | `eventSubType?`, `toolName?`, `*` | v1 仅 exact / wildcard | prefix / enum-set / regex |
| Session stream kinds | `hook.started` 等 | v1 固定小集合 | 扩展更多可观测节点 |
| Outcome fields | event-specific allowlist | v1 限定少量字段 | 审慎增加新字段 |

### 3.3 完全解耦点（哪里必须独立）

- **`HookEventCatalog` 独立**  
  事件名、payload schema、redaction metadata 必须集中在单独模块。

- **`HookDispatcher` 与主 loop 解耦**  
  主循环只能调用 `emit(event, payload, ctx)`，不能直连 handler。

- **`HookRuntime` 与 `HookDispatcher` 解耦**  
  runtime 各自实现，dispatcher 不感知具体 service binding / local function 细节。

- **`HookAuditSink` 与 `HookSessionStreamAdapter` 解耦**  
  审计落盘与客户端事件流是两个不同消费者，不能混成一个“broadcast”动作。

- **NACP 映射层独立**  
  `hook.emit/hook.outcome` 的 Core 映射，与 `session.stream.event` 的 Session 映射必须是两个独立适配层。

### 3.4 聚合点（哪里要刻意收敛）

- **所有 hook 注册都进入 `HookRegistry`**
- **所有 hook 触发都走 `HookDispatcher.emit()`**
- **所有 outcome 合并都走 `reduceOutcomes()`**
- **所有 redaction 都走统一 `redactHookPayload()`**
- **所有 session stream seq 分配都走统一 `HookSessionStreamAdapter`**

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：不做 hooks
- **亮点**：证明 hook 并不是 agent 的天然必需品
- **值得借鉴**：只在真实产品诉求存在时才引入 hooks
- **不照抄**：nano-agent 是平台型 runtime，不能没有 hooks

### 4.2 codex 的做法

- **实现概要**：5 事件 + shell runtime + JSON stdin/stdout
- **亮点**：
  - 事件面克制
  - outcome 结构清楚
  - 一事件一模型，组织清晰
- **值得借鉴**：
  - 小而稳的事件目录
  - outcome schema 结构化
- **不照抄**：
  - shell runtime
  - 声明多 runtime 但运行时不完整的做法

### 4.3 claude-code 的做法

- **实现概要**：25 事件 + 4 runtime + 多来源配置 + skill/session hook
- **亮点**：
  - 真正的平台化 hooks
  - `hookSpecificOutput` 的严谨性
  - session / skill hook 联动成熟
  - SSRF / allowlist / kill switch 等治理做得很全
- **值得借鉴**：
  - hooks 是平台协议，不是回调集合
  - 结果必须 event-specific
  - 技能可以注册 session hook
- **不照抄**：
  - 25 事件宇宙
  - shell/http/agent runtime 的全家桶
  - 客户端/IDE 导向很强的本地行为

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| Hooks 抽象层次 | 无 | 中 | 很高 | 中高 |
| 事件数量 | 0 | 5 | 25 | 8 |
| 执行模式 | 无 | shell | shell/prompt/http/agent | local-ts + service-binding |
| 客户端观测 | 弱 | 中 | 强 | 强，但只读 |
| 治理能力 | 无 | 中 | 很强 | 强 |
| 宿主假设 | 单进程 | 本地 shell | 本地 shell / IDE | Worker / DO / WebSocket |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent v1 要做）

- **[S1] 8 事件最小集**
  - `SessionStart`
  - `SessionEnd`
  - `UserPromptSubmit`
  - `PreToolUse`
  - `PostToolUse`
  - `PostToolUseFailure`
  - `PreCompact`
  - `PostCompact`

- **[S2] 统一事件目录与 payload schema**
- **[S3] `local-ts` 与 `service-binding` 两种 runtime**
- **[S4] `HookRegistry` + `HookDispatcher`**
- **[S5] `HookOutcome` 的 event-specific allowlist**
- **[S6] 平台策略与 session 两层 source**
- **[S7] 递归保护、超时、AbortSignal**
- **[S8] 审计日志**
- **[S9] NACP-Core 映射：`hook.emit` / `hook.outcome`**
- **[S10] NACP-Session 映射：`session.stream.event` 中的 hook 事件流**
- **[S11] payload redaction 与 audience 分层**
- **[S12] session resume 后 hook registry 恢复**

### 5.2 Out-of-Scope（nano-agent v1 不做）

- **[O1]** shell-command hook runtime
- **[O2]** agent runtime
- **[O3]** `fetch-http` runtime
- **[O4]** `llm-prompt` runtime
- **[O5]** client 回写 handler
- **[O6]** regex matcher
- **[O7]** 25 事件全集
- **[O8]** hook 的 async observer queue 真正落地
- **[O9]** per-subcommand bash hooks
- **[O10]** 用户 prompt 的任意改写权

### 5.3 边界清单（灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `SessionStart` 包含 resume 来源 | in-scope | 不单列 `SessionResume`，用 `source: startup|resume` 控制复杂度 |
| `SessionEnd` 替代旧 `Stop` | in-scope | Session 语义比抽象 Stop 更适合 WebSocket-first runtime |
| `updatedInput` | 仅 `PreToolUse` 支持 | 只允许工具入参规范化，不开放全局输入改写 |
| client 看到 hook 事件 | in-scope | 但必须走 redacted Session stream |
| `hook.broadcast` Core message | out-of-scope | 迁移到 `NACP-Session` 观测流 |
| skill 注册 session hook | in-scope（接口） | v1 可支持受控注册，但具体 skill 设计另文冻结 |
| `PreCompact` block | in-scope | 是上下文治理的关键安全阀 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **我们选择“8 个稳定事件”而不是“25 个全景事件”**
   - **为什么**：v1 需要稳定 API，不需要事件宇宙
   - **代价**：部分埋点深度要延后
   - **重评条件**：真实 hook handler 需求连续出现时再增事件

2. **我们选择“local-ts + service-binding”而不是“shell + http + agent 全家桶”**
   - **为什么**：它们最符合 Worker 宿主和 service-composable 立场
   - **代价**：外部 webhook / prompt hook 需要经 proxy worker 封装
   - **重评条件**：真实外部 webhook 需求高频出现

3. **我们选择“Hook 内部执行与客户端观测分层”而不是“一个 hook channel 走到底”**
   - **为什么**：内部执行与 session stream 的稳定性诉求不同
   - **代价**：实现上多一个适配层
   - **重评条件**：无；这是结构性原则

4. **我们选择“客户端只读订阅”而不是“客户端回写 handler”**
   - **为什么**：信任边界、重连一致性、治理复杂度都太高
   - **代价**：客户端不能直接做 blocking hook
   - **重评条件**：明确出现企业级客户端回写需求

5. **我们选择“event-specific outcome”而不是“自由 JSON outcome”**
   - **为什么**：Hooks 进入主循环，必须可验证、可审计、可回放
   - **代价**：扩展作者少一些自由度
   - **重评条件**：不会退回自由 JSON，只会增加 schema 字段

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| hook 延迟拖慢主循环 | service-binding handler 慢 | turn 卡顿 | 默认 2s 超时，上限 30s |
| hook 递归 | handler 触发 tool，再次触发 hook | 无限循环 | depth 计数，超过 3 层直接失败 |
| session stream 丢事件 | WS 断线 / 重连 | 客户端状态失真 | 使用 `NACP-Session` 的 `stream_seq / replay_from / last_seen_seq` |
| 敏感数据泄露 | 广播未打码 payload | 安全问题 | schema 标记敏感字段，统一 redaction |
| session hook 丢失 | DO hibernation / resume | 行为漂移 | registry 持久化到 DO storage |
| runtime 声明与实现不一致 | 只声明未实现 runtime | 用户困惑 | 未实现 runtime 明确抛 `NotImplemented` |

### 6.3 本次设计带来的价值

- **对上下文管理**：`UserPromptSubmit / PreCompact / PostCompact` 成为正式治理接缝
- **对 Skill**：skill 能在不污染主循环的前提下注入 session hook
- **对稳定性**：hook 审计、超时、递归保护、session stream 都变成系统级基础设施
- **对产品化**：hooks 成为组织策略、审计、计费、埋点、自动增强的统一入口

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | HookEvent Catalog | 8 个事件 + payload schema + redaction metadata | 所有发射点和消费者都共享同一事件目录 |
| F2 | HookOutcome Schema | 基础 outcome + event-specific allowlist | handler 返回值可校验、可合并、可审计 |
| F3 | HookRegistry | 管理 platform-policy / session hooks | 当前会话能稳定回答“这个事件会命中哪些 handler” |
| F4 | HookDispatcher | 匹配、排序、执行、合并结果 | 主循环只通过 `emit()` 使用 hooks |
| F5 | LocalTsRuntime | trusted in-proc runtime | 平台内部 hook 可以零序列化执行 |
| F6 | ServiceBindingRuntime | 通过 NACP-Core 调远端 hook worker | 跨 worker hook 扩展有稳定协议 |
| F7 | HookAuditSink | JSONL 审计记录 | 每次事件与 handler 结果都可回放 |
| F8 | HookSessionStreamAdapter | 映射到 NACP-Session 客户端流 | 客户端可看到 redacted hook 事件流 |
| F9 | Timeout / Abort / Recursion Guard | 执行安全网 | hook 不会无限拖死主循环 |
| F10 | Session Hook Persistence | 会话内注册与恢复 | DO hibernation 后 hook 行为不丢 |

### 7.2 事件目录（v1 冻结）

| 事件 | 触发点 | 典型 payload | 允许的 outcome |
|------|--------|--------------|----------------|
| `SessionStart` | 新建或恢复会话 | `sessionId`, `source` | `additionalContext`, `diagnostics` |
| `SessionEnd` | 会话终止 | `reason`, `usageSummary?` | `diagnostics` |
| `UserPromptSubmit` | 用户输入进入主循环后 | `prompt`, `messageId` | `additionalContext`, `diagnostics` |
| `PreToolUse` | tool/capability 调用前 | `toolName`, `toolInput`, `toolUseId` | `block`, `updatedInput`, `additionalContext`, `diagnostics` |
| `PostToolUse` | tool 成功返回后 | `toolName`, `output`, `toolUseId` | `additionalContext`, `diagnostics` |
| `PostToolUseFailure` | tool 失败后 | `toolName`, `error`, `toolUseId` | `additionalContext`, `stop`, `diagnostics` |
| `PreCompact` | compact 开始前 | `reason`, `historyRef?` | `block`, `diagnostics` |
| `PostCompact` | compact 完成后 | `summaryRef?`, `stats?` | `additionalContext`, `diagnostics` |

### 7.3 核心结构说明

#### F1: `HookEvent Catalog`

- **输入**：事件名与 raw payload
- **输出**：通过 zod 校验后的 typed payload
- **关键点**：
  - 所有事件 schema 与 redaction metadata 必须集中定义
  - 发射点 compile-time 与 runtime 双重校验
  - payload schema 是平台 API，不是内部细节
- **一句话收口目标**：✅ **所有 hook 发射点都只能发出目录中存在且 schema 正确的事件**

#### F2: `HookOutcome Schema`

- **输入**：handler 返回的 raw outcome
- **输出**：合法的 event-specific outcome
- **关键点**：
  - 基础结构：
    - `ok`
    - `block?`
    - `updatedInput?`
    - `additionalContext?`
    - `stop?`
    - `diagnostics?`
  - 每个事件有自己的允许字段表
  - 不允许字段直接过滤并记诊断
- **一句话收口目标**：✅ **任何 handler 的结果都能被验证为“当前事件允许的结果形状”**

#### F3/F4: `HookRegistry` + `HookDispatcher`

- **输入**：事件、payload、上下文
- **输出**：`AggregatedHookOutcome`
- **核心逻辑**：
  1. 从 registry 找到命中的 handler
  2. 按注册顺序执行
  3. 统一超时 / 递归保护
  4. 合并 outcome
  5. 写审计
  6. 发 session stream
- **一句话收口目标**：✅ **主循环只有一个 hook 入口，任何 hook 行为都可解释、可回放**

#### F5: `LocalTsRuntime`

- **定位**：仅供 trusted、内置、静态绑定的 hook 使用
- **明确约束**：
  - 不是 eval
  - 不是动态代码加载
  - 只是“编译进主 worker 的 async 函数”
- **一句话收口目标**：✅ **无需序列化即可为平台内部 hook 提供最低成本执行路径**

#### F6: `ServiceBindingRuntime`

- **定位**：v1 的主力扩展 runtime
- **NACP-Core 映射**：
  - 请求消息：`hook.emit`
  - 响应消息：`hook.outcome`
- **典型执行流**：
  1. dispatcher 组装 `hook.emit` Core envelope
  2. 通过 service binding 调远端 hook worker
  3. 远端返回 `hook.outcome`
  4. runtime 解析 outcome 并交还 dispatcher

- **为什么必须用 NACP-Core**：
  - 这样 hook worker 不需要理解主循环内部结构
  - 与 skill / compactor / capability worker 共享统一内部协议
  - 后续 queue / do-rpc 路径可复用

- **一句话收口目标**：✅ **任意远端 hook worker 都能通过标准 Core 合同参与 hook 执行**

#### F7/F8: `HookAuditSink` + `HookSessionStreamAdapter`

- **关键更新点**：这两者不能再混成旧思路里的 `hook.broadcast`

**审计路径**
- 落地位置：DO storage JSONL
- 内容：事件、命中 handler、耗时、结果摘要、错误、depth
- 目标：回放与治理

**客户端路径**
- 协议层：`NACP-Session`
- 发送形态：`session.stream.event`
- `kind` 建议：
  - `hook.started`
  - `hook.finished`
  - `hook.blocked`
  - `hook.errored`

- 示例：
  ```json
  {
    "message_type": "session.stream.event",
    "body": {
      "stream_id": "hooks",
      "stream_seq": 42,
      "kind": "hook.finished",
      "event_name": "PreToolUse",
      "execution_id": "uuid",
      "handler_id": "policy.tool-guard",
      "payload": { "...": "[redacted]" },
      "aggregated_outcome": { "blocked": false }
    }
  }
  ```

- **一句话收口目标**：✅ **客户端能通过 Session profile 稳定看到 hook 流，而内部 Core 注册表不被广播语义污染**

### 7.4 非功能性要求

- **性能**：默认 hook 预算 2s，最大不超过 30s
- **稳定性**：handler 超时、异常、binding 失败都不能让主循环 crash
- **安全性**：广播与日志必须使用 redaction
- **恢复性**：session hook 配置和 hook seq 必须可恢复
- **测试性**：事件 schema、outcome allowlist、合并规则、超时、递归、session replay 都必须有测试

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 Opus Hooks 设计

| 位置 | 借鉴点 | 用法 |
|------|--------|------|
| `docs/design/hooks-by-opus.md` §5 | 8 事件最小集 | 作为 v1 事件冻结基础 |
| `docs/design/hooks-by-opus.md` §7 | registry / dispatcher / outcome 的拆分 | 作为实现模块划分参考 |
| `docs/design/hooks-by-opus.md` 风险表 | 递归、超时、redaction 风险 | 直接进入本设计的风险模型 |

### 8.2 来自 NACP v2

| 位置 | 借鉴点 | 用法 |
|------|--------|------|
| `docs/nacp-by-opus.md` §5.0 | Core / Session / Transport 分层 | Hooks 的协议边界必须服从此分层 |
| `docs/nacp-by-opus.md` §6-§7 | Core 与 Session 的消息注册表分层 | `hook.emit/hook.outcome` vs `session.stream.event` |
| `docs/nacp-by-opus.md` session stream 相关字段 | `stream_seq / replay_from / last_seen_seq` | 用于 hook 事件客户端恢复 |

### 8.3 来自价值判断

| 位置 | 借鉴点 | 用法 |
|------|--------|------|
| `docs/value-proposition-analysis-by-GPT.md` §3.7 | hooks 是平台边界 | 作为为什么要做 hooks 的价值锚点 |
| `docs/value-proposition-analysis-by-GPT.md` §7.5 | hooks 应是稳定事件协议 | 支撑 event-first 而非 callback-first |

---

## 9. 综述总结与 Value Verdict

### 9.1 新版 Hooks 设计画像

新版 Hooks 设计与旧版最大的区别，不是事件从 6 个变成 8 个，也不是多了几个 runtime，而是**边界真正被切对了**：

- **Hooks 不是 NACP 本身**
- **Hooks 的跨 worker 执行要使用 NACP-Core**
- **Hooks 的客户端观测要使用 NACP-Session**
- **Hooks 的事件目录本身是平台 API**

这让 hooks 不再只是“在主循环里插几个回调”，而是变成一个能与：

- skill
- compactor
- fake bash
- policy
- audit
- WebSocket trace

长期共存的稳定功能簇。

### 9.2 Value Verdict

| 维度 | 评级 (1-5) | 一句话说明 |
|------|------------|------------|
| 对 nano-agent 平台定位的贴合度 | 5 | hooks 直接定义谁能介入 agent 行为 |
| 与 NACP v2 的结构一致性 | 5 | internal execution / session observation 已明确分层 |
| 第一版实现的性价比 | 5 | 8 事件 + 2 runtime + 2 个协议映射，复杂度可控 |
| 对上下文 / Skill / 稳定性的杠杆 | 5 | 三个方向都直接受益 |
| 风险可控程度 | 4 | 主要风险在 replay、redaction 与 service-binding 超时，但都有清晰缓解手段 |
| **综合价值** | **5** | **这是 nano-agent 最值得尽早冻结的功能簇之一** |

### 9.3 下一步建议

后续 action-plan 应围绕以下几个实现块拆解：

1. **事件目录与 outcome schema**
2. **registry / dispatcher / reducer**
3. **local-ts runtime**
4. **service-binding runtime + NACP-Core mapping**
5. **audit sink**
6. **session stream adapter + replay**
7. **session hook persistence + kill switch**

### 9.4 一句话 Verdict

> **Hooks 在 nano-agent 中不应被实现为“脚本回调系统”，而应被实现为“事件契约 + 运行时 + 协议映射”的平台治理层。只要坚持“内部执行走 NACP-Core、客户端观测走 NACP-Session、主循环只认 HookDispatcher”这三条原则，Hooks 就会成为 nano-agent 后续 action-plan 最稳的支点之一。**
