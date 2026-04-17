# Nano-Agent External Seam Closure 功能簇设计

> 功能簇: `External Seam Closure`
> 讨论日期: `2026-04-17`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P3-session-edge-closure.md`
> - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
> - `docs/design/after-skeleton/P2-observability-layering.md`
> - `docs/design/after-nacp/capability-runtime-by-GPT.md`
> - `docs/design/after-nacp/hooks-by-GPT.md`
> - `docs/design/after-nacp/llm-wrapper-by-GPT.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

在 Phase 3 收口 session edge 之后，nano-agent 仍然处在一个很明显的“**in-process 假闭环**”状态里：

- `session-do-runtime` 已有 `CompositionFactory` seam，但默认 factory 仍只返回 `undefined` handle bag（`packages/session-do-runtime/src/composition.ts:32-75`）。
- `SessionRuntimeEnv` 只显式保留了 `SESSION_DO / R2_ARTIFACTS / KV_CONFIG / SKILL_WORKERS`，并没有把 hook worker、fake provider worker、compact worker 等外部 seam 真正纳入 runtime env reality（`packages/session-do-runtime/src/env.ts:14-34`）。
- `@nano-agent/hooks` 的 `ServiceBindingRuntime` 仍然是直接抛错的 stub（`packages/hooks/src/runtimes/service-binding.ts:1-25`）。
- `@nano-agent/capability-runtime` 的 `ServiceBindingTarget` 已经把 `request → progress* → response → cancel` contract 做出来了，但 transport 仍需 deploy 层真正注入（`packages/capability-runtime/src/targets/service-binding.ts:1-215`）。
- `@nano-agent/llm-wrapper` 已有 `InferenceGateway` interface，但当前真实执行路径仍是 `LLMExecutor + local fetch`，远端 gateway 还没有落地（`packages/llm-wrapper/src/gateway.ts:1-15`, `packages/llm-wrapper/src/executor.ts:59-198`）。
- `@nano-agent/nacp-core` 的 `ServiceBindingTransport` 已收口三段式前置校验：`validateEnvelope → verifyTenantBoundary → checkAdmissibility`，说明协议层已经具备 worker-to-worker 基础 transport reality（`packages/nacp-core/src/transport/service-binding.ts:1-68`）。

所以 Phase 4 的任务不是“把所有外部服务都接真”，而是：

> **把 Session DO 与外部 worker / fake provider / remote capability / remote hook 之间的 seam 真正冻结，并让这些 seam 进入 deploy-shaped reality。**

- **项目定位回顾**：nano-agent 是 Cloudflare-native、DO-centered、WebSocket-first 的 agent runtime；外部能力扩展首先走 Worker / service binding，而不是本地 shell/plugin 旁路。
- **本次讨论的前置共识**：
  - `trace_uuid` 是全链路 runtime 第一事实，任何跨 worker 调用都不能丢失 trace。
  - `nacp-session` 已是 session edge legality 的 source of truth；本阶段不重开 client-facing 协议。
  - fake bash 只是 compatibility surface；真正执行面是 typed capability runtime。
  - v1 仍以 `local-ts / local-fetch` 作为 reference execution path；remote seam 的价值是 **闭合边界** 与 **deploy-shaped verification**，而不是把一切都远端化。
- **显式排除的讨论范围**：
  - 不讨论真正的 inference gateway 商业/流量策略
  - 不讨论 queue fan-out / observer queue / async workflow engine
  - 不讨论 DDL / registry persistence
  - 不讨论 sub-agent / cross-DO federation

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`External Seam Closure`
- **一句话定义**：它负责把 Session DO 内核与外部 worker 能力之间的边界冻结为少数几条稳定 seam，并明确这些 seam 的 binding contract、消息 contract、trace/tenant propagation、failure contract 与 deploy profile。
- **边界描述**：**包含** fake provider worker、capability worker、hook worker、service binding transport、composition profile、cross-worker trace law；**不包含**完整真实 provider 平台、HTTP callback transport、组织级 registry、复杂 workflow 编排。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **External Seam** | Session DO 调出当前 isolate 的那条能力边界 | v1 主要是 service binding |
| **Reference Path** | 当前已经能真实工作的本地执行路径 | `local-ts` / `local-fetch` |
| **Remote Delegate** | 通过 service binding 调用的外部 worker 能力 | hook worker / capability worker / fake provider worker |
| **Fake Provider Worker** | 用于 deploy-shaped 验证的 LLM provider 替身 worker | 先验证 boundary，不先接真 provider 矩阵 |
| **Capability Worker** | 承载 remote tool/capability execution 的 worker | 不等于 shell runtime |
| **Hook Worker** | 承载 remote hook handler 的 worker | 与 client-visible hook broadcast 分层 |
| **Binding Profile** | 某个 deploy 形态实际启用哪些 Worker bindings | local-dev / dry-run / real-smoke |
| **Seam Contract** | 跨边界调用时必须满足的消息、身份、trace、错误、超时语义 | 不是某个包私有约定 |

### 1.2 参考调查报告

- `context/codex/codex-rs/tools/src/tool_registry_plan.rs` — codex 把 tool surface、handler kind、approval-aware assembly 放在 registry plan 中心（`67-260`）
- `context/codex/codex-rs/otel/src/trace_context.rs` — codex 对跨边界 trace continuation 极严肃（`19-88`）
- `context/claude-code/services/tools/toolExecution.ts` — claude-code 把 tool execution、permission、hooks、telemetry 串成真实执行链（`126-131`, `173-245`）
- `context/claude-code/services/analytics/index.ts` — sink 未 attach 时先排队，说明 startup / boundary 过渡态必须被认真处理（`70-164`）
- `context/just-bash/src/Bash.ts` 与 `context/just-bash/src/commands/registry.ts` — compatibility surface 与 command registry 是两层，不应混成系统内核（`15-24`, `141-169`; `1-240`）

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **runtime 对外扩展边界冻结层**。
- 它服务于：
  1. `session-do-runtime`
  2. `capability-runtime`
  3. `hooks`
  4. `llm-wrapper`
  5. `eval-observability`
- 它依赖：
  - `session-edge-closure.md`
  - `trace-first-observability-foundation.md`
  - `@nano-agent/nacp-core` service-binding transport reality
  - `CompositionFactory` / `SessionRuntimeEnv` seam
- 它被谁依赖：
  - Phase 5 deployment dry-run
  - future real provider / real capability worker wiring
  - storage/context evidence closure

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `Session Edge Closure` | Closure -> External | 强 | session DO 是所有 external seam 的发起方 |
| `Trace-first Observability Foundation` | External -> Trace | 强 | 跨 worker 调用必须传播 `trace_uuid` / audience / redaction |
| `NACP-Core` | External -> Core | 强 | service binding transport 与 internal message family 的承载层 |
| `Capability Runtime` | 双向 | 强 | fake bash / structured tool 的 remote 版本都走这里 |
| `Hooks` | 双向 | 强 | inline 与 remote hook runtime 都受其影响 |
| `LLM Wrapper` | 双向 | 中强 | local-fetch 是 reference path，gateway/fake provider 是 external seam |
| `Deployment Dry-Run` | External -> Verification | 强 | Phase 5 的验证对象主要就是这些 seam |
| `Storage & Context Evidence Closure` | External -> Evidence | 中 | remote 输出、promotion、trace 要成为 evidence 输入 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`External Seam Closure` 是 **Session DO 对外能力边界的冻结层**，负责 **把 hook / capability / fake provider 这些外部 worker seam 统一收敛成 service-binding-first 的 deploy contract**，对上游提供 **稳定的 remote delegate 语义**，对下游要求 **tenant/trace/error/progress/cancel 不能在跨 worker 边界发生漂移**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 一上来把 LLM 主路径切成 remote inference gateway | 平台型推理系统常见倾向 | 当前 `LLMExecutor` 的 local-fetch path 才是已存在 reality | 可能 |
| shell-command hook runtime | codex / claude-code | 与 Worker 宿主和 typed runtime 冲突 | 否 |
| 把所有 capability 都强制 remote 化 | 远端 worker 过度化 | 会让 reference path 消失，调试与回归更难 | 否 |
| HTTP callback 作为主 external seam | transport 扩张冲动 | 当前 repo 已经围绕 service binding 与 DO runtime 成型 | 可能 |
| 在 Phase 4 就设计 organization registry / binding discovery DDL | platform-first 冲动 | 当前更缺的是 seam correctness，不是 control plane | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| Hook remote runtime | `ServiceBindingRuntime.execute()` | 真正接 service binding transport | queue / observer delivery |
| Capability remote target | `ServiceBindingTarget` | request/progress/cancel/response | richer long-running task protocol |
| Fake provider worker | `InferenceGateway` / fake provider binding | deploy-shaped fake path | real gateway worker |
| Composition profile | `CompositionFactory` + env binding profile | local vs remote mix装配 | KV-driven dynamic composition |
| Binding manifest | wrangler profile / env contract | 小而固定 | team/org level feature flags |

### 3.3 完全解耦点（哪里必须独立）

- **Reference path 与 remote path**
  - **解耦原因**：`local-ts` / `local-fetch` 是当前 repo 的真实执行基线，不能为了 remote seam 把它们抹掉。
  - **依赖边界**：同一 capability / hook / provider seam 必须允许 local 与 remote 两种实现共享同一个 typed contract。

- **Service-binding transport 与 domain runtime**
  - **解耦原因**：transport 负责 envelope、tenant boundary、admissibility；domain runtime 负责 hook/tool/provider 语义。
  - **依赖边界**：不得在 hook/capability/llm 包内各自重写 tenant/trace precheck。

- **Fake provider worker 与 real provider integration**
  - **解耦原因**：fake provider worker 的职责是 deploy-shaped seam verification，不是产品化推理面。
  - **依赖边界**：其输出必须仍走 `LLMExecutor` / `StreamNormalizer` 同一内部事件形状。

### 3.4 聚合点（哪里要刻意收敛）

- **所有 external binding names 都进入统一 env / profile 文档**
- **所有跨 worker precheck 都走 `ServiceBindingTransport`**
- **所有 remote failure code 都收敛成有限错误族**
- **所有 cross-seam trace / authority propagation 进入统一 law**
- **所有 fake external workers 归到同一 dry-run profile，而不是散落在测试各处**

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：基本不存在真正的 external worker seam；大多数能力直接在单进程内完成。
- **亮点**：
  - 心智模型简单
  - reference path 非常清楚
- **值得借鉴**：
  - 始终保留一个可直接调试的 reference path
- **不打算照抄的地方**：
  - 不把单进程闭环误当成 Cloudflare-native runtime 的真实闭环

### 4.2 codex 的做法

- **实现概要**：tool registry plan 先冻结 handler kind，再决定工具暴露与执行路线；trace context continuation 也被严格建模。
- **亮点**：
  - handler kind / registry plan 很成熟
  - 对跨边界 trace continuation 很认真
- **值得借鉴**：
  - 先冻结 seam contract，再装配 remote implementation
  - 工具池与 transport 不应由调用点临时拼装
- **不打算照抄的地方**：
  - 不复制其本地 shell / sandbox / MCP 复杂矩阵

### 4.3 claude-code 的做法

- **实现概要**：tool execution 是一个真实平台 seam，挂接 permission、hooks、telemetry；analytics sink 对 startup 过渡态也有专门队列。
- **亮点**：
  - execution chain 很真实
  - sink 未 attach 时也不丢事件
- **值得借鉴**：
  - external seam 不只是“能 call 到对面”，还要有 progress、hook、telemetry、startup queue
- **不打算照抄的地方**：
  - 不引入其 Node/local CLI 的本地进程与 IDE 前提

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| reference path 清晰度 | 高 | 中高 | 中 | 高 |
| handler kind / registry 中心化 | 低 | 高 | 中高 | 高 |
| cross-boundary trace 严肃度 | 低 | 高 | 中 | 高 |
| startup / sink 过渡态意识 | 低 | 中 | 高 | 中高 |
| 对 Worker / service binding 环境适配 | 低 | 低 | 低 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] External binding catalog 与 composition profile**
  - 必须明确 session runtime 到外部 worker 的 binding 面，不再只靠 `SKILL_WORKERS` 这一条模糊 binding。

- **[S2] Hook worker seam closure**
  - 必须把 `ServiceBindingRuntime` 从 stub 提升为真实 remote runtime，保证 `hook.emit / hook.outcome` 真能跨 worker。

- **[S3] Capability worker seam closure**
  - 必须把 `ServiceBindingTarget` 的 transport seam 真正装配起来，让 request/progress/cancel/response 成为 deploy-shaped reality。

- **[S4] Fake provider worker seam**
  - 必须提供一个 deploy-shaped fake provider 边界，用来验证 remote provider seam，而不是直接拿真实 provider 作为第一个 boundary 试验场。

- **[S5] Cross-seam trace / tenant / request propagation law**
  - 必须明确 remote delegate 至少传哪些身份字段，否则 trace-first 在 external seam 上会断裂。

- **[S6] Explicit failure / fallback contract**
  - 必须明确什么时候应该 `not-connected`、什么时候应该 `transport-error`、什么时候允许 local fallback。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] 真正的 inference gateway 平台**
- **[O2] queue-based async orchestration**
- **[O3] HTTP callback transport**
- **[O4] organization-level registry / discovery plane**
- **[O5] generalized compact worker / OCR worker / arbitrary remote worker zoo**

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `LLMExecutor` local-fetch | in-scope | 这是当前真实 provider path，不应被 Phase 4 推翻 |
| fake provider worker | in-scope | 它是 deploy-shaped boundary proof，不是产品主路径 |
| `hooks` local-ts runtime | in-scope | 必须继续存在，作为 reference path |
| browser-rendering target 真接 Cloudflare Browser Rendering | out-of-scope | 仅保留 seam，不在本 phase 真接 |
| compact worker binding | defer | 先冻结 capability / hook / fake provider 三条主 seam |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **“先闭合 fake external workers”** 而不是 **“直接冲真实 provider / 真实复杂 worker”**
   - **为什么**：当前 repo 还存在多个明确 stub；先用 fake-but-faithful external workers 验证 seam correctness，性价比最高。
   - **我们接受的代价**：业务价值不会立刻来自真实外部能力，而来自 boundary correctness。
   - **未来重评条件**：当 fake worker seam 已稳定，才逐步换入真实 provider / browser / compactor。

2. **取舍 2**：我们选择 **dual path（reference local path + remote path）** 而不是 **“一刀切 remote-first”**
   - **为什么**：current code reality 仍以 local-ts / local-fetch 为基线；如果先消灭 reference path，回归与诊断会立刻变差。
   - **我们接受的代价**：同一能力会短期维持两条实现。
   - **未来重评条件**：只有当 remote path 在 correctness、latency、diagnostic 上全面优于 local path，才考虑默认切换。

3. **取舍 3**：我们选择 **typed service-binding contract** 而不是 **裸 `fetch()` / 自由 JSON body**
   - **为什么**：nacp-core 已经给出了 envelope、tenant boundary、admissibility pipeline；继续裸调只会重新制造 contract drift。
   - **我们接受的代价**：需要在 hook/capability/provider seam 上做更明确的 builder/adapter。
   - **未来重评条件**：无；这是 Worker-native internal RPC 的基础 law。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| remote seam 过多，Phase 4 变成大爆炸 | 同时接太多 worker | 工程分散 | 只收口 hook / capability / fake provider 三条主 seam |
| local 与 remote 合同漂移 | 各自独立演进 | 回归混乱 | 所有 seam 共享同一 typed input / output contract |
| startup 时 external sink / worker 未 ready | 真实 deploy 初始化顺序复杂 | 早期事件丢失 | 借鉴 claude-code 的 queue-before-sink 模式，在 runtime 装配层缓存关键 early events |
| trace_uuid 在 external seam 丢失 | remote call 只传业务 body | observability 断链 | 将 trace / authority / request identity 设为 external seam 最低必带字段 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：不再停留在“包之间看起来能拼起来”，而是真正证明 Session DO 能通过外部 seam 调出 worker 能力。
- **对 nano-agent 的长期演进**：为 real provider、browser-rendering、skill worker、compactor worker 留出统一接线方式。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：Skill 与稳定性会立刻受益；上下文管理也因此获得未来 external compact / preprocess worker 的统一入口。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Binding Catalog | 冻结 external worker binding profile 与 composition contract | Session runtime 对外 worker 面不再靠隐式约定 |
| F2 | Hook Worker Seam | 把 remote hook runtime 真正接上 service binding | hook 不再只有 local-ts 才是真的 |
| F3 | Capability Worker Seam | 把 capability remote target 变成真实 deploy seam | fake bash / structured tool 都能跨 worker 执行 |
| F4 | Fake Provider Worker Seam | 用 deploy-shaped fake provider 验证 remote provider boundary | provider seam 可先验真，再上真实 provider |
| F5 | Cross-Seam Propagation Law | 冻结 trace / tenant / request / timeout / error 的最低法则 | remote 调用不再丢身份、丢 trace、丢错误语义 |

### 7.2 详细阐述

#### F1: `Binding Catalog`

- **输入**：`SessionRuntimeEnv`、`CompositionFactory`、wrangler binding reality
- **输出**：一组最小 binding profile
- **主要调用者**：`session-do-runtime`
- **核心逻辑**：
  1. `SessionRuntimeEnv` 必须从“只有 `SKILL_WORKERS` 的模糊 env”升级到可表达 `CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER` 的 profile。
  2. `CompositionFactory` 根据 profile 决定某条 seam 走 local 还是 service-binding。
  3. 这些 profile 必须是 deploy artifact 的一部分，而不是测试私有常量。
- **边界情况**：
  - 缺 binding 时可以退回 local reference path，但不能 silently pretend remote connected。
- **一句话收口目标**：✅ **`session-do-runtime` 能显式说清楚“这条能力今天走本地还是走外部 worker”`**

#### F2: `Hook Worker Seam`

- **输入**：`HookDispatcher.emit()`、`hook.emit / hook.outcome` codec
- **输出**：一个真实可调用的 remote hook runtime
- **主要调用者**：`hooks`、`session-do-runtime`
- **核心逻辑**：
  1. 保留 `HookDispatcher` 作为唯一 entry point（`packages/hooks/src/dispatcher.ts:45-149`）。
  2. `ServiceBindingRuntime` 不再抛 `not yet connected`，而是通过 nacp-core transport 发送 `hook.emit`、接收 `hook.outcome`。
  3. remote hook 仍受 timeout、depth guard、outcome allowlist 约束。
- **边界情况**：
  - remote hook 失败不得中断整个 dispatcher 的 guard model；仍应被聚合为 diagnostics-bearing outcome。
- **一句话收口目标**：✅ **`remote hook 与 local-ts hook 在主循环看来只剩“runtime kind 不同”，不再是两套协议世界`**

#### F3: `Capability Worker Seam`

- **输入**：`CapabilityPlan`、`ServiceBindingTarget`
- **输出**：request/progress/cancel/response 的真实 remote capability path
- **主要调用者**：`capability-runtime`、`FakeBashBridge`
- **核心逻辑**：
  1. fake bash 继续只做 plan/execute adapter（`packages/capability-runtime/src/fake-bash/bridge.ts:1-141`）。
  2. `ServiceBindingTarget` 的 `call / cancel / onProgress` seam 成为 remote capability worker 的唯一入口（`packages/capability-runtime/src/targets/service-binding.ts:58-176`）。
  3. capability worker 可以是 fake tool worker，但必须遵守 `tool.call.request / progress / cancel / response` 语义。
- **边界情况**：
  - pre-aborted signal、transport cancel 失败、partial progress 后 error，都要保持明确 error shape。
- **一句话收口目标**：✅ **`capability remote path 已能真实传 progress/cancel，而不是只剩一个“以后再接”的 target stub`**

#### F4: `Fake Provider Worker Seam`

- **输入**：`InferenceGateway` seam、`LLMExecutor` current path、fake provider responses
- **输出**：deploy-shaped provider boundary proof
- **主要调用者**：`llm-wrapper`、Phase 5 dry-run
- **核心逻辑**：
  1. 保持 `LLMExecutor + OpenAIChatAdapter` 作为主 reference path。
  2. 增加 fake provider worker，仅用于 remote seam verification：它输出与 Chat Completions-compatible provider 等价的成功/错误/stream 场景。
  3. worker 侧不直接把 raw provider SSE 透给 session；仍必须回到 `StreamNormalizer` / session stream mapping。
- **边界情况**：
  - 真实 provider smoke 不在 Phase 4 完成；fake provider worker 只证明 boundary，不证明商务/性能。
- **一句话收口目标**：✅ **`provider seam 已具备“可跨 worker 验证”的 deploy reality，但仍不强迫主路径脱离 local-fetch`**

#### F5: `Cross-Seam Propagation Law`

- **输入**：`ServiceBindingTransport`、trace-first foundation、tenant scoped laws
- **输出**：一组 external seam 最低法则
- **主要调用者**：全部 remote delegate
- **核心逻辑**：
  1. 每次跨 worker 调用至少携带 `team_uuid`、`trace_uuid`、`request_uuid`、timeout/deadline、audience/redaction context。
  2. 所有 remote 调用都必须先经过 `validateEnvelope → verifyTenantBoundary → checkAdmissibility`。
  3. response / progress / error 也必须能回到同一 trace 上。
- **边界情况**：
  - 允许平台级 alert 无 request trace，但不允许 request-scoped remote work 无 trace。
- **一句话收口目标**：✅ **`跨 worker 调用从 tenant、trace、timeout 到错误语义都不再依赖调用点自觉`**
