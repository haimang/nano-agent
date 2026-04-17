# Nano-Agent 代码审查 — Capability Runtime

> 审查对象: `packages/capability-runtime`
> 审查时间: `2026-04-17`
> 审查人: `Kimi (k2p5)`
> 审查范围:
> - `docs/action-plan/capability-runtime.md`
> - `docs/design/capability-runtime-by-GPT.md`
> - `packages/capability-runtime/src/**/*.ts`
> - `packages/capability-runtime/test/**/*.ts`
> - `README.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

> 该实现的类型层、registry、planner、fake bash bridge、policy gate 和 executor façade 已就位，63 个单元测试全部通过。但存在多个与 action-plan / design doc 明显不对齐的缺口：缺少 cancel/abort 机制、缺少 event emission 实现、缺少 integration tests、README 缺失、`browser-rendering` target 未预留。当前不应标记为 completed。

- **整体判断**：核心 domain model 与单元测试已就位，但运行时关键能力（cancel、event emission、integration tests、README）存在显著缺口。
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `CapabilityExecutor` 和 `TargetHandler` **完全没有 cancel/abort 机制**，与 action-plan S11 / design doc F5 的 "Progress / Cancel / Result Contract" 要求严重不符。
  2. **Event emission 只有类型定义没有实现**——`events.ts` 定义了 `CapabilityEventKind`，但代码中没有任何地方实际产出或消费这些事件。
  3. **README 和全部 3 个 integration tests 缺失**——action-plan P5-02 / P5-03 明确列出的 `local-ts-workspace`、`service-binding-progress`、`command-surface-smoke` 测试文件一个都不存在。

---

## 1. 审查方法与已核实事实

### 对照文档
- `docs/action-plan/capability-runtime.md` (572 lines, Phases 1-5)
- `docs/design/capability-runtime-by-GPT.md` (design goals + tool.call.* mapping)
- `README.md` (Worker-native, no real shell, fake bash as compatibility surface)

### 核查实现
- `packages/capability-runtime/src/` (14 files, incl. fake-bash/, targets/, capabilities/)
- `packages/capability-runtime/test/` (7 test files, 63 tests)
- `packages/capability-runtime/package.json`

### 执行过的验证
```bash
pnpm --filter @nano-agent/capability-runtime typecheck  # PASS
pnpm --filter @nano-agent/capability-runtime test        # 63/63 PASS
```

### 1.1 已确认的正面事实
- **Typecheck 通过**，无编译错误。
- **63 tests 全部通过**：registry (8)、planner (16)、fake-bash-bridge (10)、policy (7)、executor (6)、tool-call (7)、result/promotion (9)。
- `registry.ts` 的 `InMemoryCapabilityRegistry` 实现了完整的 register/get/list/has/remove，且防止重复注册。
- `planner.ts` 的 `parseSimpleCommand` 正确处理了单双引号参数、多空格，并显式**不**支持转义/管道/重定向/子 shell——这是正确的边界控制。
- `fake-bash/unsupported.ts` 维护了 51 个显式不支持的命令（`apt`, `npm`, `sudo`, `docker`, `ssh`, `kill` 等），体现了良好的安全边界意识。
- `fake-bash/commands.ts` 注册了 11 个最小命令集（`pwd`, `ls`, `cat`, `write`, `mkdir`, `rm`, `mv`, `cp`, `rg`, `curl`, `ts-exec`），且写操作（`write`, `mkdir`, `rm`, `mv`, `cp`）的默认 policy 为 `ask`，读操作为 `allow`，符合最小权限原则。
- `artifact-promotion.ts` 的 `shouldPromote` 按 64KB 阈值正确区分 inline vs promoted，且不提升 error/cancelled/timeout 结果。
- `tool-call.ts` 正确映射了 `buildToolCallRequest` / `parseToolCallResponse`。

### 1.2 已确认的负面事实
- `README.md` **不存在**。
- `test/integration/` 目录**不存在**——action-plan 列出的 3 个 integration test 文件全部缺失。
- `TargetHandler` 接口 (`executor.ts:13-15`) **只有 `execute()`，没有 `cancel()` 或 `abort()`**。
- `CapabilityExecutor` (`executor.ts:29-110`) **没有任何 cancel/abort 逻辑**，timeout 只是让 promise resolve 成 `kind: "timeout"`，而不是真正中断底层执行。
- `events.ts` **只有类型定义** (`CapabilityEventKind`, `CapabilityEvent`)，没有任何 emitter、producer、或 consumer 实现。
- `browser-rendering` execution target **完全没有预留**——design doc 和 action plan 都要求至少预留 target 名称与接口槽位。
- `tar` / `gzip` 未被显式标记为 OOM-risk 禁止项（虽然 `unsupported.ts` 中有一些系统命令，但没有专门维护 "OOM-risk" 清单）。

---

## 2. 审查发现

### R1. README.md 缺失

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `packages/capability-runtime/` 下没有 `README.md`。
  - `docs/action-plan/capability-runtime.md:P5-03` 明确将 "README、公开导出面" 作为收口标准。
- **为什么重要**：
  - 下游（kernel、session-do-runtime）需要快速理解 capability contract、fake bash 边界、以及支持/不支持的命令清单。
  - 没有 README，会导致 "什么命令能用" 变成只能通过读源码或运行测试来推断的黑盒。
- **审查判断**：
  - 这是 action-plan 的 explicit deliverable，必须补齐。
- **建议修法**：
  - 添加 `packages/capability-runtime/README.md`，至少包含：
    1. 一句话定位（与 design doc 一致）
    2. 支持命令清单（11 个 allowlist 命令）
    3. 不支持命令示例（引用 `unsupported.ts`）
    4. 最小使用示例（`registerMinimalCommands` → `planFromBashCommand` → `CapabilityExecutor.execute`）
    5. Execution target 说明（local-ts / service-binding / browser-rendering 预留）

---

### R2. 缺少全部 3 个 integration tests

- **严重级别**：`high`
- **类型**：`test-gap`
- **事实依据**：
  - `docs/action-plan/capability-runtime.md:P5-02` 明确列出：
    - `test/integration/local-ts-workspace.test.ts`
    - `test/integration/service-binding-progress.test.ts`
    - `test/integration/command-surface-smoke.test.ts`
  - 实际 `test/` 目录下只有 7 个单元测试文件，没有 `integration/` 子目录。
- **为什么重要**：
  - capability runtime 的价值不是 "单元测试通过"，而是 "真能支撑 end-to-end session 工作流"。
  - `local-ts-workspace` 集成测试是验证 filesystem handlers 与 virtual workspace namespace 配合的关键路径。
  - `service-binding-progress` 集成测试是验证 progress stream / cancel / NACP transport 对齐的核心证据。
  - `command-surface-smoke` 是验证 allowlist 命令面是否足以支撑真实 agent skeleton 的直接证据。
- **审查判断**：
  - action-plan 的收口标准未满足。这是 capability-runtime 作为 "可执行层" 而非 "类型层" 的核心证明。
- **建议修法**：
  - 添加 `test/integration/local-ts-workspace.test.ts`：注册 minimal commands → 用 `LocalTsTarget` 挂载 filesystem handlers → 执行 `ls`/`cat`/`write` → 验证输出。
  - 添加 `test/integration/service-binding-progress.test.ts`：构造一个 mock `TargetHandler` 模拟 progress 流 → 验证 executor 能消费多段 progress / 最终 result / timeout / cancel。
  - 添加 `test/integration/command-surface-smoke.test.ts`：遍历 allowlist 命令，验证每个命令都能从 bash string 成功 plan 并执行（用 fake handlers）。

---

### R3. Cancel / Abort 机制完全缺失

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - `executor.ts:13-15` 的 `TargetHandler` 接口只有 `execute(plan)`，没有 `cancel(requestId)` 或任何 abort signal 参数。
  - `executor.ts:29-110` 的 `CapabilityExecutor` 没有任何 cancel 方法。
  - `targets/local-ts.ts:21-75` 的 `LocalTsTarget` 同样没有 cancel 能力。
  - `targets/service-binding.ts:16-30` 的 stub 也没有 cancel。
  - `result.ts:10-15` 虽然定义了 `"cancelled"` 这个 `CapabilityResultKind`，但没有任何代码路径能产出它。
- **为什么重要**：
  - design doc §F5 和 action-plan S11 都明确要求 "progress / cancel / result / error / timeout / oversized-output 统一 contract"。
  - `agent-runtime-kernel` 的 `CapabilityDelegate` 接口 (`delegates.ts:22-25`) 已经定义了 `cancel(requestId: string): void`，这意味着 kernel 期望 capability-runtime 能响应 cancel。
  - 没有 cancel 机制，长时运行的 capability（如 `curl` 大文件下载、`rg` 远程搜索）将无法被 kernel 的 `cancelRequested` 信号中断。
- **审查判断**：
  - 这是 capability-runtime 与 kernel contract 之间的严重不匹配。必须修复。
- **建议修法**：
  1. 在 `TargetHandler` 接口中增加 `cancel?(requestId: string): void` 或让 `execute` 接受 `AbortSignal`：
     ```typescript
     export interface TargetHandler {
       execute(plan: CapabilityPlan, signal?: AbortSignal): Promise<CapabilityResult>;
       cancel?(requestId: string): void;
     }
     ```
  2. 在 `CapabilityExecutor` 中增加 `cancel(requestId: string)` 方法，遍历内部活跃的 execution map，调用对应 target 的 cancel。
  3. 在 `LocalTsTarget` 中，让 `execute` 接收 `AbortSignal` 并在 handler 中响应（至少做前置检查，让测试能验证 cancel 路径）。
  4. 添加测试验证：启动一个慢 capability → 调用 `executor.cancel(requestId)` → 结果应为 `kind: "cancelled"`。

---

### R4. Capability Event Emission 只有类型没有实现

- **严重级别**：`high`
- **类型**：`scope-drift`
- **事实依据**：
  - `events.ts` 定义了 `CapabilityEventKind` 和 `CapabilityEvent` 接口，但没有任何函数/类来实际创建或发射这些事件。
  - `executor.ts` 在 policy check、target dispatch、result return 的整个过程中，**从未产出任何 `CapabilityEvent`**。
  - action-plan P4-03 明确说 "runtime event emission：产出 kernel 可消费的 capability events"，但代码中完全没有 emitter。
- **为什么重要**：
  - design doc 说 capability runtime 负责 "统一产出 progress/result/error/cancel shape，便于 NACP-Session 映射"。
  - kernel 的 `CapabilityDelegate.execute` 返回 `AsyncIterable<unknown>`，它期望从 capability runtime 接收增量事件（progress chunks）。但当前 executor 只返回一个最终的 `CapabilityResult`，没有 streaming events。
  - 这意味着 kernel 无法将 capability 的 "started / progress / completed / error" 生命周期映射到 `session.stream.event` 的 `tool.call.progress` / `tool.call.result`。
- **审查判断**：
  - capability runtime 目前是一个 "返回最终结果的函数库"，而不是一个 "产出事件流的可观察执行层"。这与设计目标不符。
- **建议修法**：
  - 方案 A（推荐）：让 `CapabilityExecutor.execute` 返回 `AsyncIterable<CapabilityEvent>` 而不是 `Promise<CapabilityResult>`。事件序列应该是：`started` → (零个或多个 `progress`) → (`completed` with output | `error` | `cancelled` | `timeout`)。
  - 方案 B（兼容性妥协）：增加一个 `executeStream(plan): AsyncIterable<CapabilityEvent>` 方法，保留现有的 `execute(plan): Promise<CapabilityResult>` 作为同步 facade。
  - 无论哪种方案，都必须让 `LocalTsTarget` 和 `ServiceBindingTarget` 能够产出 progress events（哪怕是空序列）。

---

### R5. `browser-rendering` execution target 未预留

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `types.ts:20` 只定义了 `"local-ts" | "service-binding"`。
  - design doc §3.2 明确保留 `"browser-rendering"` 作为 future execution target。
  - action-plan Q2 的 A 说 "browser-rendering 可以说尽力而为，不是为了实现功能，而是把这些实践作为非常简单，非常可靠的测试对象，用于检查我们的 service binding 与内部 bash 命令的耦合"。
- **为什么重要**：
  - 这不仅是功能预留问题，更是 Q2 中业主明确要求的测试耦合验证点。
  - 如果类型层完全不包含 `browser-rendering`，后续任何涉及 browser 的 skill/service-binding 实验都会被迫先改类型定义，造成不必要的 breaking change。
- **审查判断**：
  - 应在 `ExecutionTarget` union 中加入 `"browser-rendering"`，并提供一个最小 stub（类似 `ServiceBindingTarget`）。
- **建议修法**：
  - 修改 `types.ts`：`export type ExecutionTarget = "local-ts" | "service-binding" | "browser-rendering";`
  - 添加 `src/targets/browser-rendering.ts`：最小 stub，返回 `not-connected` error，与 `ServiceBindingTarget` 类似。
  - 在 `index.ts` 中导出它。

---

### R6. `tar` / `gzip` 等 OOM-risk 命令未显式列入禁止清单

- **严重级别**：`medium`
- **类型**：`security`
- **事实依据**：
  - `docs/action-plan/capability-runtime.md` §2.2 O11 明确说 "`tar/gzip` 等存在明显 OOM 风险的 archive / bulk buffer 命令在 v1 的启用" 是 out-of-scope。
  - Q1 的 A 说 "像 `tar` 这类明显有 OOM 风险的命令，v1 阶段明确禁止。请维护两张表：允许的清单，以及 OOM 风险清单。"
  - 但 `unsupported.ts` 中**没有** `tar` 或 `gzip` 或 `zip` / `unzip`。
- **为什么重要**：
  - `tar` / `gzip` 在 128MB V8 isolate 中处理大文件时确实存在 OOM 风险。如果它们没有被显式拒绝，planner 可能把它们当成普通未知命令处理（返回 null），而不是给出明确的 "blocked for OOM risk" 错误。
  - 更危险的是，如果未来有人在 registry 中误注册了 `tar` handler，它会直接被执行，没有任何 OOM guard。
- **审查判断**：
  - 需要显式维护 OOM-risk 清单，并在 fake bash bridge 中给出专门的错误信息。
- **建议修法**：
  - 在 `unsupported.ts` 中增加 `OOM_RISK_COMMANDS` Set（`tar`, `gzip`, `gunzip`, `zcat`, `zip`, `unzip` 等）。
  - 在 `FakeBashBridge.execute` 中，在 `isUnsupported` 检查后增加 `isOomRisk` 检查，返回专门的 error code（如 `oom-risk-blocked`）和解释信息。
  - 在 README 中写明 OOM-risk 禁止清单。

---

### R7. `ServiceBindingTarget` stub 未实现 cancel 占位

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - `targets/service-binding.ts:16-30` 是一个纯 stub，只返回 `not-connected` error。
  - 这与 action-plan P3-04 要求的 "构造 `tool.call.request`、消费 `NacpProgressResponse.progress`、发 `tool.call.cancel`" 相差甚远。
- **为什么重要**：
  - service-binding target 是 capability-runtime 与 NACP-Core 的主要耦合点。如果它只是一个 stub，就无法验证 design doc 中 "progress 是 transport-level stream" 的假设。
  - 但鉴于 Wave 4 才刚完成 session DO 组装，service-binding 的真实实现可能需要等到实际 worker 部署后才好验证。所以这个问题可以作为 non-blocking follow-up。
- **审查判断**：
  - 当前 stub 在 v1 skeleton 阶段可接受，但需要在后续 Wave 中补齐。
- **建议修法**：
  -  deferred 到真实 service-binding worker 可用时实现，但当前 stub 中至少应加入 cancel 方法的占位签名，以配合 R3 的接口改造。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | `@nano-agent/capability-runtime` 独立包骨架 | `done` | package.json、tsconfig、build/typecheck/test 齐全 |
| S2 | `CapabilityDeclaration / Plan / Event / Result / ExecutionTarget` 类型体系 | `partial` | 类型存在，但 `ExecutionTarget` 缺少 `browser-rendering`；`CapabilityEvent` 无 emitter |
| S3 | 中央 `CapabilityRegistry` | `done` | `InMemoryCapabilityRegistry` 完整实现并测试 |
| S4 | `CommandPlanner` | `done` | `planFromBashCommand` / `planFromToolCall` / `parseSimpleCommand` 完整 |
| S5 | `FakeBashBridge` | `partial` | 桥接层存在，但缺少 OOM-risk 显式拒绝 |
| S6 | `CapabilityPolicyGate` | `done` | allow/ask/deny/hook-gated 判定完整 |
| S7 | `CapabilityExecutor` façade | `partial` | policy + dispatch + timeout 存在，但 **cancel 完全缺失**，event emission 完全缺失 |
| S8 | `local-ts` execution target | `partial` | `LocalTsTarget` 存在，handlers 完整，但无 cancel / abort signal 支持 |
| S9 | `service-binding` execution target | `partial` | 只有返回 `not-connected` 的 stub，无 progress / cancel 实现 |
| S10 | `tool.call.request/response/cancel` 对齐 helper | `partial` | `buildToolCallRequest` / `parseToolCallResponse` 存在，但 executor 端无 cancel |
| S11 | progress / cancel / result / error / timeout / oversized-output 统一 contract | `partial` | timeout / result / error / oversized 已统一，**progress 和 cancel 缺失** |
| S12 | artifact promotion seam | `done` | `shouldPromote` + 64KB 阈值完整 |
| S13 | just-bash-compatible command surface 仓内重写 | `partial` | 11 个 allowlist 命令已注册，但 OOM-risk 清单未显式维护，缺少与 just-bash 的差分检查 |
| S14 | virtual git subset 接口占位 | `done` | `createVcsHandlers` 提供 `status`/`diff`/`log` stub |
| S15 | fake workspace / fake transport / fake policy 测试基座 | `partial` | 单元测试完整，但 **integration tests 全部缺失** |
| S16 | README、公开导出与 package scripts | `partial` | package scripts 完整，导出面完整，**README 缺失** |

### 3.1 对齐结论

- **done**: 5
- **partial**: 11
- **missing**: 0

> 这更像是 "骨架和类型已冻结，但运行时核心能力（cancel、event stream、integration tests）还未完成"，而不是一个已完成的实现。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 完整 POSIX shell | `遵守` | planner 明确不支持 pipe/redirect/subshell |
| O2 | 真实子进程 / 后台 shell | `遵守` | 无 `child_process` 引用 |
| O3 | Python-first runtime | `遵守` | 未涉及 |
| O4 | 完整 git 实现 | `遵守` | 只有 `status`/`diff`/`log` stub |
| O5 | apt / npm / pip 等宿主级包管理 | `遵守` | 已在 unsupported 中显式拒绝 |
| O6 | 完整浏览器自动化 DSL | `遵守` | 只有 target 名称预留需求 |
| O7 | 任意 socket / daemon / watch mode | `遵守` | 未涉及 |
| O8 | workspace / artifact 物理持久化 | `遵守` | promotion seam 只返回 decision，不操作 storage |
| O9 | client-visible session.stream.event 最终映射 | `遵守` | 由 kernel 负责，capability 只产内部 events |
| O10 | 直接把 just-bash 作为 runtime dependency | `遵守` | 没有 import just-bash |
| O11 | tar/gzip 等 OOM-risk 命令在 v1 启用 | `部分违反` | 未在 unsupported 中显式列入，存在误执行风险 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested` — 存在关键能力缺口（cancel、event emission、integration tests），当前实现不足以支撑 kernel 的完整 delegate contract。
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **R3**: 在 `CapabilityExecutor` / `TargetHandler` / `LocalTsTarget` 中实现 cancel / abort 机制，并添加测试。
  2. **R4**: 实现 capability event emission（至少让 `CapabilityExecutor` 能产出 `started` / `progress` / `completed` / `error` / `cancelled` / `timeout` 事件流），并添加测试验证 kernel 可消费。
  3. **R2**: 补全 3 个 integration tests（`local-ts-workspace`、`service-binding-progress`、`command-surface-smoke`）。
  4. **R1**: 添加 `README.md`。
- **可以后续跟进的 non-blocking follow-up**：
  1. **R5**: 添加 `browser-rendering` target stub。
  2. **R6**: 显式维护 OOM-risk 命令清单并在 bridge 中拒绝。
  3. **R7**: 将 `ServiceBindingTarget` 从 stub 升级为可消费 mock/fake progress stream 的实现。

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应模板

> **规则**：
> 1. 不要改写 §0–§5；只允许从这里往下 append
> 2. 回应时按 `R1/R2/...` 对应，不要模糊说“已修一些问题”
> 3. 必须写明“哪些修了、怎么修的、改了哪些文件、跑了什么验证”
> 4. 若选择不修某条 finding，必须写明理由与 tradeoff

### 6.1 对本轮审查的回应

> 执行者: `{IMPLEMENTER}`
> 执行时间: `{DATE}`
> 回应范围: `R1–R7`

- **总体回应**：`{ONE_LINE_RESPONSE}`
- **本轮修改策略**：`{STRATEGY}`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | README.md 缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R2 | integration tests 缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R3 | cancel / abort 机制缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R4 | event emission 缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R5 | browser-rendering target 未预留 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R6 | tar/gzip OOM-risk 未显式拒绝 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R7 | ServiceBindingTarget stub 未实现 cancel | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |

### 6.3 变更文件清单

- `{FILE_1}`
- `{FILE_2}`
- `{FILE_3}`

### 6.4 验证结果

```text
{TEST_OR_BUILD_OUTPUT_SUMMARY}
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview | partially-closed | blocked`
- **仍然保留的已知限制**：
  1. `{KNOWN_LIMITATION_1}`
  2. `{KNOWN_LIMITATION_2}`

---

## 7. 二次审查模板

> **规则**：
> 1. 二次审查人不得改写 §0–§6，只能继续 append
> 2. 二次审查必须区分：
>    - 已验证修复有效
>    - 仅部分修复
>    - 新引入问题
> 3. 必须明确“本轮是否收口”

### 7.1 二次审查结论

> 复核者: `{REVIEWER}`
> 复核时间: `{DATE}`
> 复核依据: `实现者 §6 的回应 + 当前代码事实`

- **二次结论**：`{ONE_LINE_REREVIEW_VERDICT}`
- **是否收口**：`yes | no`

### 7.2 已验证有效的修复

| 审查编号 | 复核结论 | 依据 |
|----------|----------|------|
| R1 | `closed` | `{FILE:LINE / command / test}` |
| R2 | `closed` | `{FILE:LINE / command / test}` |

### 7.3 仍未收口的问题

| 审查编号 | 当前状态 | 说明 | 下一步要求 |
|----------|----------|------|------------|
| R3 | `open | partial | regressed` | `{WHY}` | `{ACTION}` |
| R4 | `open | partial | regressed` | `{WHY}` | `{ACTION}` |

### 7.4 二次收口意见

- **必须继续修改的 blocker**：
  1. `{BLOCKER_1}`
  2. `{BLOCKER_2}`
- **可后续跟进的 follow-up**：
  1. `{FOLLOWUP_1}`
  2. `{FOLLOWUP_2}`

> 若仍不收口，请明确写：
> `请实现者根据本节继续更新代码，并在本文档底部追加下一轮回应。`

---

## 8. 对 Kimi 审查质量的评价

> 评价者：`Claude Opus 4.6 (1M context)`
> 评价时间：`2026-04-17`
> 评价依据：`capability-runtime-by-kimi.md` §0–§5 + 实际代码核查结果
> 注：本轮完整的实现者工作日志（GPT R1-R4 + Kimi R1-R7 合并修复）回填在 `capability-runtime-by-GPT.md` §6，这里不再重复。

### 8.1 总体评价

**综合评分：⭐⭐⭐⭐⭐ (5/5)** — Kimi 对 capability-runtime 的审查**极为全面**，7 条 findings 中有 3 条（R3 cancel/abort、R4 event emission、R5 browser-rendering target）是 GPT 没有独立覆盖的价值点；其中 R3 是 Kimi 明确标为 `critical` 的级别，与实际 architectural impact 对齐。

### 8.2 做得极好的地方

1. **R3 把 "cancel/abort 完全缺失" 标为 `critical` 级别的判断力**——Kimi 不仅指出 `TargetHandler` 没有 cancel 接口，还**直接跨包核查**了 `packages/agent-runtime-kernel/src/delegates.ts:22-25`：
   > "`agent-runtime-kernel` 的 `CapabilityDelegate` 接口已经定义了 `cancel(requestId: string): void`，这意味着 kernel 期望 capability-runtime 能响应 cancel。"
   
   这种 **"用下游 contract 反证上游缺口"** 的 review 方法论极为成熟。kernel 已经在 delegate 层声明了 cancel，但 capability 侧根本没实现——这是 contract 断链，Kimi 一下就看出来了。

2. **R4 "只有类型定义没有实现" 的核查精度**——"`executor.ts` 在 policy check、target dispatch、result return 的整个过程中，从未产出任何 `CapabilityEvent`"。这句话的准确性和 GPT R3 的 grep 证据是同级的严谨。

3. **R5 `browser-rendering` target 的独立价值**——GPT 的 review 里完全没覆盖这条。Kimi 不仅指出 design doc §3.2 和业主 Q2 答案里的预留需求，还**引用业主原话**：
   > "browser-rendering 可以说尽力而为，不是为了实现功能，而是把这些实践作为非常简单，非常可靠的测试对象，用于检查我们的 service binding 与内部 bash 命令的耦合"
   
   这种把业主 Q&A 作为 review gate 的做法，展现了对 action-plan 决策 trail 的深入理解。

4. **R6 `tar/gzip` OOM-risk 的细节**——Kimi 指出 action-plan §2.2 O11 和 Q1 答案都要求维护 OOM-risk 清单，但 `unsupported.ts` 中没有 tar/gzip/zip。这是一个典型的 "action-plan 有要求但实现漏掉" 的 delivery gap，Kimi 的 checklist 对照纪律很强。

5. **方案 A vs 方案 B 的 tradeoff 分析（R4）**——在建议 "让 execute 返回 `AsyncIterable<CapabilityEvent>`" vs "新增 `executeStream` 作为补充" 时，明确给出了兼容性 tradeoff。本轮最终采用方案 B（保留 `execute` + 新增 `executeStream`），Kimi 的判断直接 informed 了实现选择。

6. **R7 虽标 low 但仍明确建议 "占位签名"**——即使 stub 也要预留 cancel 方法的签名，"以配合 R3 的接口改造"——这种 "未来可演进" 的 cross-finding 关联判断很成熟。

7. **In-Scope 对齐表打分（`done:5 / partial:11 / missing:0`）**——比 GPT 的 `done:2 / partial:14 / missing:0` 宽松，但这是因为 Kimi 对 "类型完整性" 给的 done（如 S12 artifact promotion、S14 git stub 都给 done），而 GPT 从 "主路径集成性" 看这些都是 partial。两种视角都有合理性，但 GPT 更严格。

### 8.3 可以更好的地方

1. **没有独立发现 R1（NACP schema 不对齐）**——Kimi 在 §3 的 S10 标 `partial`，但 partial 理由是 "executor 端无 cancel"，不是 "schema 不对齐"。实际上 `buildToolCallRequest()` 产出的 `{ method, params }` 与 `ToolCallRequestBodySchema` 要求的 `{ tool_name, tool_input }` 根本不兼容——这条是 GPT 的独立发现。Kimi 可能没跑 schema 对拍。

2. **没有独立发现 R2（FakeBashBridge echo）**——Kimi 在 §1.1 写 "`FakeBashBridge` 存在" + S5 标 `partial`，但 partial 理由是 "缺少 OOM-risk 显式拒绝"，不是 "`execute()` 不真正执行"。这是一个**实际运行后才能发现**的 bug（返回 `output: "{}"`），Kimi 的 review 可能偏重静态读码，没跑 `bridge.execute("pwd")` 的复现。

3. **R5 的修复建议过于轻量**——"修改 types.ts 加 `browser-rendering`" + "添加最小 stub" 是对的，但没有提 "stub 也要支持 signal 响应" 这层（后来在 R7 补了）。两条 finding 可以合并成 "所有 target 都要统一 signal 接口 + browser-rendering 加进 ExecutionTarget"。

4. **§0 的总结略显保守**——"**整体判断**：核心 domain model 与单元测试已就位"——但实际上核心 domain model 在 R1 层面是**不对齐 nacp-core** 的（GPT 发现），这个结论在和 GPT review 对照后需要修正。

### 8.4 Kimi 审查的风格特征

- **最擅长跨包 contract 核查**（R3 跨 kernel 核查是典型案例）
- **对 action-plan 决策 trail 的引用非常精准**（R5 引用 Q2 答案原文）
- **tradeoff 分析最完整**（R4 方案 A/B 对比）
- **偏静态结构审查**，对运行时行为（如 bridge echo）的复现覆盖相对较少

### 8.5 总结

Kimi 的 review 是本轮 4 份 review 中**维度最宽**的一份：
- GPT 找到 4 条（其中 3 条是 GPT 独占的 correctness blocker）
- Kimi 找到 7 条（其中 3 条是 Kimi 独占：R3 cancel/R4 event/R5 browser）
- 两者合并覆盖了从 "运行时正确性" 到 "跨包合同完整性" 到 "交付完整性" 的全谱系

这证明了 **"multiple independent reviewers with different strengths"** 的价值。GPT 的 "实际跑代码" 风格和 Kimi 的 "跨包合同核查" 风格是互补的，任何一方单独使用都会留下盲区。

**如果只能选一份，建议：**
- 运行时关键路径 review：选 GPT
- 架构完整性 / 交付 checklist review：选 Kimi
- 理想方式：两份合并，像本轮这样处理
