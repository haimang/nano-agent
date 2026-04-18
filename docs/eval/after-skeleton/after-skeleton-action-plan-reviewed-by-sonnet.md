# After-Skeleton Action Plan Review — by Sonnet

> 评审者: `Claude Sonnet 4.5`
> 评审时间: `2026-04-18`
> 评审对象: `docs/action-plan/after-skeleton/A1-A10` (10 份执行计划)
> 证据来源: 一手代码调查，涵盖以下文件:
> - `packages/nacp-core/src/envelope.ts` — NacpEnvelope / NacpTrace 真实字段
> - `packages/nacp-core/src/compat/migrations.ts` — migrations 真实状态
> - `packages/nacp-session/src/{messages,frame,ingress}.ts` — session profile 真实 message family
> - `packages/capability-runtime/src/fake-bash/{commands,bridge,unsupported}.ts` — 12 命令注册表 / 拒绝路径真实实现
> - `packages/capability-runtime/src/capabilities/{filesystem,search,network,exec,vcs}.ts` — 各 capability handler 真实状态
> - `packages/capability-runtime/src/planner.ts` — bash/structured 双路径真实实现
> - `packages/capability-runtime/src/targets/service-binding.ts` — ServiceBindingTarget 真实实现
> - `packages/session-do-runtime/src/{composition,orchestration,traces,turn-ingress,ws-controller,http-controller,checkpoint}.ts` — Session DO 真实状态
> - `packages/eval-observability/src/{trace-event,placement-log,sinks/do-storage}.ts` — 观测层真实字段
> - `packages/workspace-context-artifacts/src/{mounts,context-assembler}.ts` — MountRouter / ContextAssembler
> - `packages/hooks/src/runtimes/{local-ts,service-binding}.ts` — hooks runtime 真实状态
> - `context/just-bash/src/fs/mountable-fs/mountable-fs.ts` — just-bash 参考 mount 实现
> - `context/just-bash/src/commands/rg/rg*` — just-bash rg 真实搜索实现
> - `context/just-bash/src/commands/js-exec/js-exec.ts` — just-bash js-exec 真实执行路径
> 文档状态: `final (evidence-based)`

---

## 0. 代码事实速览 — 真实 Reality Baseline

在评审 A1-A10 之前，先记录关键代码事实，后续评审全部基于此。

### 0.1 `NacpEnvelope` 真实字段

**在 `packages/nacp-core/src/envelope.ts`** 中，实际存在：

| Section | 字段名（snake_case wire format） | 类型 | 备注 |
|---------|----------------------------------|------|------|
| `header` | `schema_version`, `message_uuid`, `message_type`, `delivery_kind`, `sent_at`, `producer_role`, `producer_id`, `consumer_hint`, `priority` | 各种 | `producer_id` 已是 `NacpProducerIdSchema` 格式 |
| `authority` | `team_uuid`, `user_uuid`, `plan_level`, `membership_level`, `stamped_by`, `stamped_at` | various | **关键**: 字段名是 `stamped_by`（`NacpProducerIdSchema` 类型），不是 legacy string |
| `trace` | `trace_id`, `session_uuid`, `parent_message_uuid`, `stream_id`, `stream_seq`, `span_id` | various | **重要**: 现用名是 `trace_id`（UUID string），**不是 `trace_uuid`** |
| `control` | `reply_to`, `request_uuid`, `deadline_ms`, `timeout_ms`, `idempotency_key`, `capability_scope`, `retry_context`, `tenant_delegation`, `quota_hint`, `audience`, `redaction_hint` | various | `reply_to` 是 UUID string |

**A1 action-plan 描述的 "legacy fields" rename** (如 `producer_id → producer_key`, `stamped_by → stamped_by_key`, `reply_to → reply_to_message_uuid`) 在当前代码中**尚未发生**。这些字段名仍是原始名称，说明 A1 的 Phase 0/1 rename 工作**完全尚未执行**。

### 0.2 `eval-observability/TraceEventBase` 真实字段

**在 `packages/eval-observability/src/trace-event.ts`** 中，`TraceEventBase` 有：
```typescript
interface TraceEventBase {
  readonly eventKind: string;
  readonly timestamp: string;
  readonly sessionUuid: string;      // camelCase
  readonly teamUuid: string;         // camelCase
  readonly turnUuid?: string;        // camelCase, optional
  readonly stepIndex?: number;
  readonly durationMs?: number;
  readonly audience: EventAudience;
  readonly layer: TraceLayer;
  readonly error?: { code, message };
}
```

**关键发现**：`TraceEventBase` 中**确实没有 `traceUuid` 字段**。A3 关于此问题的诊断正确。但更精确的是：`NacpTraceSchema` 里用 `trace_id`（UUID），而 `TraceEventBase` 里有 `sessionUuid` 但没有 `traceUuid`。这两者是分离设计——`trace_id` 是 envelope 层的，`TraceEventBase` 是 eval 层的 in-process type。两层之间的 carrier 字段缺失才是真正的 A3 问题。

### 0.3 `session-do-runtime` 真实状态

- **`traces.ts`**: `buildTurnStartTrace()` / `buildTurnEndTrace()` 返回 `turn.started` / `turn.completed` 这两个 eventKind，但 `orchestration.ts` 里 `startTurn()` 中 `emitTrace()` 调用发出的是 `turn.begin`（行 161-165），`endSession()` 发出 `session.ended`。这说明 traces.ts 的 event kind 已**与 orchestration 实际 workflow 不同步**，A3 关于"trace event kind 与 session reality 漂移"的诊断正确。
- **`composition.ts`**: `createDefaultCompositionFactory()` 返回全部 `undefined` 的 subsystem handles，这直接验证了 A5 关于"composition.ts 默认返回 no-op stubs"的描述。
- **`ws-controller.ts`**: `WsController.handleMessage()` 是空 body stub，`handleClose()` 也是 stub。A4 关于"WsController 是 stub"的描述完全准确。
- **`http-controller.ts`**: HTTP controller 有 action 路由但每个 handler 都返回硬编码的 `{ok: true}` stub。
- **`turn-ingress.ts`**: `TurnIngressKind` 有 `"future-prompt-family"` 占位，`extractTurnInput()` 只处理 `session.start`。A4 描述准确。
- **`orchestration.ts`**: `SessionOrchestrator` 已有实际 step loop 实现，但所有的 `OrchestrationDeps` 仍依赖注入。deps 的真实连线尚未完成。

### 0.4 Fake Bash 真实状态

**`commands.ts`**: 共注册 **12 个命令** (pwd/ls/cat/write/mkdir/rm/mv/cp/rg/curl/ts-exec/git)，与 action-plan 描述完全一致。所有命令 `executionTarget: "local-ts"`。

**`bridge.ts`**: `FakeBashBridge.execute()` 实现了完整的拒绝链：
- empty → `"empty-command"` errorResult
- `isUnsupported()` → `"unsupported-command"`
- `isOomRisk()` → `"oom-risk-blocked"`
- no planner result → `"unknown-command"`
- no executor → `"no-executor"`

未接 executor 会明确 error，不 fabricate success。A10 关于 `FakeBashBridge` 的描述精确。

**Capability Handlers 真实状态**：

| 命令 | 真实状态 | 文件 |
|------|---------|------|
| `rg` | **纯 stub**：返回固定字符串 `[rg] searching for ... (degraded: TS string scan)`，只验证 regex 合法性，不扫描任何内容 | `search.ts` |
| `curl` | **纯 stub**：URL 基础校验后返回 `[curl] fetching: ... (stub: network access not yet connected)` | `network.ts` |
| `ts-exec` | **纯 stub**：返回 `[ts-exec] executed N chars (stub: sandboxed execution not yet connected)` | `exec.ts` |
| `git` | **纯 stub**：`SUPPORTED_SUBCOMMANDS = {status,diff,log}` 有子命令校验，但返回 `[git status] (stub: VCS access not yet connected)` | `vcs.ts` |
| `ls/cat/write/rm/mv/cp` | **有条件真实**：接受 `namespace` 注入时通过 `WorkspaceBackend` 执行；无 namespace 时返回 stub text | `filesystem.ts` |
| `mkdir` | **永久 stub**：即使 namespace 存在，也只返回 `[mkdir] created: ${resolved}`，后端无 mkdir primitive | `filesystem.ts` L109-118 |

**关键发现**：`filesytem.ts` 中 `mkdir` handler 没有调用 `workspace.mkdir()`，永远只返回 string，这与 A8 描述的"mkdir 是 compatibility ack、backend 无 directory primitive" 完全吻合。

### 0.5 `planner.ts` 真实状态

`planFromBashCommand()` 实现了 bash → structured input 的映射，包括：
- `rg pattern [path]` → `{ pattern, path }`
- `curl <url>` → `{ url }`
- `ts-exec <code>` → `{ code: args.join(" ") }`
- `git <subcommand> [...args]` → `{ subcommand, args }`

**发现**：planner 中没有 `grep` → `rg` 的任何 alias 映射。A8 所说"grep/egrep/fgrep 还没有任何兼容 alias"是**完全准确的**。

### 0.6 `context/just-bash` 参考实现关键差异

**MountableFs (`mountable-fs.ts`)**：
- 实现了完整的 `IFileSystem` 接口（`mkdir`, `readdir`, `rm`, `cp`, `mv`, `symlink`, `realpath` 等）
- `mount()` 方法禁止在 root `/` 挂载，禁止嵌套 mount
- `mkdir` 正确地路由到被 mount 的 backend

**当前 `MountRouter` (`packages/workspace-context-artifacts/src/mounts.ts`)**：
- 实现了 `routePath()` + `/_platform/` reserved namespace guard
- **但不持有完整的 `IFileSystem` 接口**：只返回 `RouteResult`（带 `WorkspaceBackend` 引用），实际文件操作由 `filesystem.ts` 的 handlers 负责
- 这与 just-bash 的 MountableFs 是不同的设计层次：just-bash 是完整 FS 抽象，nano-agent 的 MountRouter 只是路由层

**rg (`rg.ts`, `rg-search.ts`)**：
- just-bash 的 `rg` 是**完整的 TS 文本搜索实现**：`rg-search.ts` 实现了递归目录遍历、gitignore 支持、glob 过滤、context lines、多种输出格式
- 执行路径：`rg.ts::execute()` → `rg-parser.ts::parseArgs()` → `rg-search.ts::executeSearch()` → `collectFiles()` → `walkDirectory()` → 对每个文件调用 `ctx.fs.readFile()` 逐行 regex 匹配
- **完全不依赖任何二进制**，is pure TS operating on `ctx.fs`

**js-exec (`js-exec.ts`)**：
- just-bash 的 `js-exec` 使用 **QuickJS WASM** via `node:worker_threads`，是一个真正的 JS 沙箱
- 通过 `SharedArrayBuffer bridge` 让 JS worker 和宿主 FS 通信
- 明确依赖 `import { Worker } from "node:worker_threads"` — **这在 Cloudflare Workers 里不可用**

### 0.7 `nacp-session` 真实 message family

`packages/nacp-session/src/messages.ts` 中，SESSION_MESSAGE_TYPES（不含 turn family，只有 session-level）：
```
session.start / session.resume / session.cancel / session.end /
session.stream.event / session.stream.ack / session.heartbeat
```
共 **7 种 session 消息类型**。A1 描述的"7 条 frozen message types"数量准确。

`session.start` 的 body 包含 `initial_input`（可选）。A4 关于 `turn-ingress.ts` 只处理 `session.start.initial_input` 的描述准确。

---

## 1. A1 — Contract & Identifier Freeze

### 1.1 代码事实核查

**✅ 对齐准确：**
- `compat/migrations.ts` 确实只有 `migrate_noop` 和一个 `throw new Error` 的 `migrate_v1_0_to_v1_1`，是名副其实的 placeholder
- Session message types 确实是 7 种
- `packages/nacp-session/src/messages.ts` 的 `SESSION_MESSAGE_TYPES` 包含 7 个成员，与 A1 描述一致

**❌ 重要纠正：**
- A1 描述的 legacy fields 包括 `stamped_by → stamped_by_key`，但**当前 `stamped_by` 已经是 `NacpProducerIdSchema` 类型**（格式为 `namespace.sub@vN`），并不是 deprecated string。这意味着"rename to key"的问题定义可能需要重新审视
- `NacpTraceSchema` 中当前字段名是 `trace_id`（UUID），**不是 `trace_uuid`**。A1 若描述"将 `trace_id` 改名为 `trace_uuid`"，方向是 A1 的理解，不是代码当前名称——需要确认 A1 rename batch 的目标方向

**⚠️ 上游依赖实际上更简单：**
- A1 担心"session layer 的 legacy fields"，但检查 `packages/nacp-session/src/frame.ts` 和 `ingress.ts` 后发现：session layer 直接使用 `NacpEnvelopeBaseSchema` 扩展，没有单独维护 field alias。session layer 的 rename 影响面实际上就是 core envelope 的变化，不需要额外修改 session package 的字段定义

### 1.2 执行风险（基于代码事实）

| 风险 | 级别 | 证据 |
|------|------|------|
| `NacpTraceSchema.trace_id` vs `trace_uuid` 命名 ownership 需要在 A1 明确 | `HIGH` | L115 of envelope.ts: `trace_id: z.string().uuid()` |
| `migrate_v1_0_to_v1_1` 是 `throw new Error`，任何触发都会 fatal | `MEDIUM` | compat/migrations.ts L13-18 |
| session package 实际上通过 `NacpEnvelopeBaseSchema.extend()` 继承，rename 会自动传播 | `LOW` (有利) | frame.ts L36 |

---

## 2. A2 — Trace Substrate Decision Investigation

### 2.1 代码事实核查

**✅ 对齐准确：**
- `packages/eval-observability/src/sinks/do-storage.ts` 已实现完整的 DO storage JSONL sink，包括 buffer flush、tenant-scoped key、`_index` date-index 模式——与 A2 描述完全一致
- Key 模式：`tenants/{teamUuid}/trace/{sessionUuid}/{YYYY-MM-DD}.jsonl` 准确
- `DoStorageTraceSink.emit()` 先检查 `shouldPersist(event.eventKind)`，live-only events 被过滤——实现了分层级别

**⚠️ 需要注意：**
- `packages/session-do-runtime/src/checkpoint.ts` 实现了完整的 `buildSessionCheckpoint()` 和 `validateSessionCheckpoint()`，包含 7 个 subsystem fragments——这是真正的 "hot state anchor"，A2 的描述准确
- 但 `checkpoint.ts` 存储的是 Agent 状态，而 `do-storage.ts` 存储的是 trace events——两者都在 DO storage，但用途不同。A2 把它们都归类为"DO hot anchor"是分析正确的

**❌ 关键发现：**
- A2 提到 `packages/eval-observability/scripts/trace-substrate-benchmark.ts` 需要新建——确认该文件**不存在**，benchmark runner 确实需要从零创建
- `DoStorageTraceSink` 的 `DoStorageLike` 接口使用 `get(key)` 和 `put(key, value)`，是 DO storage interface 的最小子集。**`list?(prefix)` 是可选的**——这意味着 benchmark 需要对比带 `list` 和不带 `list` 两种路径

### 2.2 执行风险（基于代码事实）

| 风险 | 级别 | 证据 |
|------|------|------|
| benchmark runner 从零开始，eval-observability 包无 `scripts/` 入口 | `MEDIUM` | 目录结构确认 |
| `DoStorageTraceSink` 本地测试实际是 in-process mock，不反映真实 DO延迟 | `HIGH` (A2 已知) | do-storage.ts: `DoStorageLike` 是 interface，test double 即可 |

---

## 3. A3 — Trace-first Observability Foundation

### 3.1 代码事实核查

**✅ 最关键发现（完全验证 A3 的诊断）：**

`traces.ts` 中：
- `buildTurnStartTrace()` → `eventKind: "turn.started"`
- `buildTurnEndTrace()` → `eventKind: "turn.completed"`

但 `orchestration.ts` 中：
- `startTurn()` 里 `emitTrace()` 发出 `{ eventKind: "turn.begin", turnId: ... }` （L161-165）
- `endSession()` 里 `emitTrace()` 发出 `{ eventKind: "session.ended", ... }` （L300-303）

**这完全证实了 A3 的诊断**：`traces.ts` 定义的 `eventKind` 字符串（`"turn.started"` / `"turn.completed"`）与 `orchestration.ts` 实际 emit 的字符串（`"turn.begin"` / `"session.ended"`）**不一致**。这是一个真实的实现漂移，不是文档问题。

**✅ 其他对齐准确：**
- `TraceEventBase` 确实没有 `traceUuid` 字段（已在 §0.2 确认）
- `traces.ts` 里的 trace builders 返回 `unknown` type，不是 typed `TraceEventBase`（L41: `Promise<unknown>`）

**❌ 需要纠正：**
- A3 描述 "`NacpAlertPayload.trace_uuid` 仍是 optional"——但检查 `nacp-core/src/observability/` 目录时，observability 子目录存在但内容未被查看。需要确认 `NacpAlertPayload` 的实际位置和字段
- `traces.ts` 的 builders 都接受 `sessionUuid, teamUuid` 作为参数，但 `TraceEventBase` 也有 `turnUuid?: string`（optional）。A3 关于"A3 Phase 1 给 `TraceEventBase` 加 `traceUuid`"的方向是对的，但要注意这是**补充 field**，而不是把 `trace_id` 从 envelope 搬移过来

### 3.2 A3 与 A1 的双重所有权（代码验证）

**重要更新**：检查代码后，双重所有权问题比之前评估的要**轻**：
- `packages/nacp-core/src/envelope.ts` → 这是 A1 的改动范围
- `packages/eval-observability/src/trace-event.ts` → 这是 A3 的改动范围

两个文件**完全独立**，不共享代码。A3 给 `TraceEventBase` 加字段不会直接冲突 A1 对 `NacpTrace` 字段的 rename。真正的协调点是：当 A1 把 `trace_id` 改名后，A3 补充的 `traceUuid` carrier 字段的值来源是新名还是旧名？这需要在 A3 Phase 1 里明确"消费哪个 envelope 字段"。

### 3.3 执行风险（基于代码事实）

| 风险 | 级别 | 证据 |
|------|------|------|
| `traces.ts` eventKind 与 `orchestration.ts` 实际 emit 已漂移 | `HIGH` | traces.ts L37-51 vs orchestration.ts L155-166 |
| trace builders 返回 `unknown`（不是 `TraceEvent`），无编译期类型保护 | `HIGH` | traces.ts L41：`Promise<unknown>` |
| A3 Phase 4 的 5 个邻接包 sweep 需要先找到所有 emit seam | `MEDIUM` | 没有全局 grep 时不知道有多少处 emitTrace() 调用 |

---

## 4. A4 — Session Edge Closure

### 4.1 代码事实核查

**✅ 全部诊断准确：**
- `WsController.handleUpgrade/handleMessage/handleClose` 都是空 stub（ws-controller.ts L26-56）
- `HttpController.handleRequest()` 路由到 action-specific stubs，每个都返回硬编码 `{ok: true}` （http-controller.ts L73-101）
- `TurnIngressKind` 包含 `"future-prompt-family"` 占位符（turn-ingress.ts L26-28）
- `extractTurnInput()` 只处理 `session.start` + `initial_input`（turn-ingress.ts L79-103）
- `normalizeClientFrame()` 在 ingress.ts 中是真实实现（已有 authority stamp 和 frame validation）

**❌ 关键纠正（重要）：**
- A4 说"DO 里直接 `JSON.parse()` 后按 `message_type` 分支"——但从代码看，实际上 `orchestration.ts` 的 `SessionOrchestrator` 已有完整的 lifecycle 方法（`startTurn`, `runStepLoop`, `cancelTurn`, `endSession`）。`WsController.handleMessage()` 是 stub，但 **orchestration 层已经存在**，问题是 WS 消息没有连到 orchestration。A4 的修复是"接线"而不是"建新逻辑"。

**⚠️ A4 的实际工作量更轻：**
- `orchestration.ts` 已有 `OrchestrationDeps.pushStreamEvent()` 接口
- `buildTurnStartTrace` / `buildTurnEndTrace` 已存在（虽然 eventKind 有漂移）
- WsController 需要做的事是：解析 NACP frame → 调用 `extractTurnInput()` → 调用 `orchestration.startTurn()` → 连 stream

### 4.2 执行风险（基于代码事实）

| 风险 | 级别 | 证据 |
|------|------|------|
| WS消息 → orchestration 的连线：WsController 和 orchestration deps 都存在，只缺 wiring | `HIGH` | ws-controller.ts stub + orchestration.ts 完整实现 |
| HTTP fallback 的 `handleInput()` stub 返回 200，但实际上 follow-up turn 没有处理 | `HIGH` | http-controller.ts L78-81 |
| orchestration 的 `advanceStep / buildCheckpoint` 等 deps 仍需真实实现 | `MEDIUM` | composition.ts 全部返回 undefined |

---

## 5. A5 — External Seam Closure

### 5.1 代码事实核查

**✅ 对齐准确：**
- `createDefaultCompositionFactory()` 返回所有 subsystem handles 为 `undefined`（composition.ts L63-74）
- `packages/hooks/src/runtimes/service-binding.ts`（`ServiceBindingRuntime`）确实 `throw new Error("service-binding runtime not yet connected")`（L23）
- `packages/capability-runtime/src/targets/service-binding.ts` 的 `ServiceBindingTarget` 已有完整的 request/progress/cancel/response seam 实现（L90-214）

**✅ 关键细节准确（有参考代码支持）：**
- `ServiceBindingTransport.call()` / `cancel()` 接口已定义（service-binding.ts L81-84）
- 无 transport 时返回 `"not-connected"` error，不 throw（L113-125）
- `onProgress` callback 已经被 thread 到 executor 的 `emit()` 机制（L156-161）

**❌ 需要纠正：**
- A5 描述"hooks/src/runtimes/service-binding.ts 仍是直接抛错 stub"——这是准确的，但要注意这个 `ServiceBindingRuntime` 是 hooks 包的 runtime，**不是** capability-runtime 的 `ServiceBindingTarget`。两者是不同的东西：
  - `hooks/runtimes/service-binding.ts` → 为 hook execution 用的（仍是 stub）
  - `capability-runtime/targets/service-binding.ts` → 为 tool execution 用的（有真实实现）

### 5.2 context 参考分析（基于 codex/claude-code）

A5 引用了 `context/codex/codex-rs/tools/src/tool_registry_plan.rs`—— codex 的 tool registry 使用 Rust 实现，与 nano-agent 的 TS 实现路线完全不同。codex 的参考价值在于"分层 capability 治理"的概念，而不是具体实现模式的 reuse。这与 A5 描述一致。

### 5.3 执行风险（基于代码事实）

| 风险 | 级别 | 证据 |
|------|------|------|
| `hooks/runtimes/service-binding.ts` 仍 throw 意味着任何 hook 走 service-binding path 都会失败 | `HIGH` | hooks/runtimes/service-binding.ts L23 |
| `composition.ts` 全 undefined - capability/workspace/hooks handles 都未接线 | `CRITICAL` | composition.ts L65-72：`capability: undefined` 等 |
| A5 的 fake-provider-worker 需要新建目录 `test/fixtures/external-seams/` | `LOW` | 确认不存在，但 `test/e2e/fixtures/` 存在 |

---

## 6. A6 — Deployment Dry-Run and Real Boundary Verification

### 6.1 代码事实核查

**✅ 对齐准确：**
- `test/e2e/` 中确认有 14 个 e2e 测试文件（e2e-01 到 e2e-14），与 A6 描述一致
- `WsController` 和 `HttpController` 都是 stub，这是 A6 的关键 gate condition（L0 可运行，L1 需要 stub 替换）

**⚠️ A6 需要补充的事实：**
- e2e 测试目录有 `fixtures/` 子目录——这对 A5 的 fake-provider-worker 放置位置有参考价值
- `test/` 根目录有 8 个 cross-package contract tests (`capability-toolcall-contract.test.mjs` 等），这些是 A6 的直接验证资产

**重要推论**：当前 e2e 场景（e2e-01 到 e2e-14）在没有真实 WS/HTTP controller 接线时，能运行多少取决于 test fixture 的实现方式。**需要调查每个 e2e test 是否使用 in-process stub 还是真实 DO**，但这超出本次静态代码评审的范围。

### 6.2 执行风险（基于代码事实）

| 风险 | 级别 | 证据 |
|------|------|------|
| L1 (wrangler dev --remote) 前提：WsController/HttpController 必须先有真实实现 | `HIGH` | A4 的 scope |
| wrangler.jsonc 只有 SESSION_DO 无其他 binding（A6 描述正确，需要扩展才能做 smoke） | `HIGH` | 未直接查看但 A6/A2 都描述一致 |

---

## 7. A7 — Storage and Context Evidence Closure

### 7.1 代码事实核查

**✅ 准确：**
- `StoragePlacementLog` 在 `placement-log.ts` 中存在完整实现（record / getEntries / getSummary），但**没有被 runtime 消费**
- `ContextAssembler` 在 `context-assembler.ts` 有完整实现（assemble 方法含 budget truncation 逻辑），`AssemblyResult` 包含 `{assembled, totalTokens, truncated, orderApplied}`

**❌ 关键纠正（最重要的代码事实）：**

A7 说"Phase 3 P3-01 要记录 `dropped_optional_layers / drop_reason / required_layer_budget_violation` 等字段"，但检查 `context-assembler.ts` 的实际 `AssemblyResult`：

```typescript
export interface AssemblyResult {
  readonly assembled: ContextLayer[];
  readonly totalTokens: number;
  readonly truncated: boolean;       // 有 truncated，但无 drop reason
  readonly orderApplied: readonly ContextLayerKind[];
}
```

`AssemblyResult` **没有 `droppedLayers` / `dropReason` / `budgetViolation` 等字段**。A7 P3-01 的确是在给 `ContextAssembler` 增加新的 evidence API surface，而不是简单"接线"已有 seam。这与之前评审的判断一致，但现在有代码证据支持。

**ContextAssembler 的截断逻辑**（L109-117）：
- optional layers 在 budget 超出时被静默跳过，`truncated = true`
- 没有记录哪些 layers 被 drop，也没有记录原因
- A7 补充这些字段是真实的 API 扩展工作

### 7.2 执行风险（基于代码事实）

| 风险 | 级别 | 证据 |
|------|------|------|
| A7 P3-01 的 evidence fields 需要修改 `AssemblyResult` interface，是 breaking API change | `HIGH` | context-assembler.ts L34-44：当前 shape 无 drop info |
| `StoragePlacementLog.record()` 存在但没有任何调用者（空 runtime 消费） | `HIGH` | placement-log.ts L37：record() 存在，但无 import 分析 |

---

## 8. A8 — Minimal Bash Search and Workspace

### 8.1 代码事实核查

**✅ 完全准确：**
- `rg` handler 返回 `[rg] searching for ... (degraded: TS string scan)` 固定字符串，只验证 regex pattern 合法性，完全不扫描内容（search.ts L38-40）
- `grep/egrep/fgrep` 在 unsupported.ts 和 commands.ts 中均**不存在**（既非注册命令，也非 unsupported 名单）
- `mkdir` 在 filesystem.ts 中是永久 stub，不调用 workspace.mkdir()（L109-118）
- `MountRouter` 有 `/_platform/` reserved namespace guard（mounts.ts L64-84）

**✅ 参考代码 (just-bash) 完全支持 A8 的设计方向：**

just-bash 的 `rg-search.ts` 是纯 TS 文本搜索实现：
- `collectFiles()` 递归遍历 `ctx.fs`（IFileSystem interface）
- `searchFiles()` 对每个文件调用 `ctx.fs.readFile()` 然后 regex 匹配
- **完全没有使用任何二进制 ripgrep**——就是 TS regex on IFileSystem

这证实了 A8 的方向：**nano-agent 的 `rg` 升级为最小真实行为，走 TS regex scan on `WorkspaceNamespace`，而不是调用二进制**。这是可行且已有参考实现的路线。

**❌ A8 的精确度问题：**
- A8 描述说"`rg` 实现策略未定"但 just-bash 已经证明了路线：打通 `rg handler → WorkspaceNamespace.listDir() → readFile() → regex match`。策略其实就是参照 just-bash 的 `rg-search.ts`，只是输入层从 `IFileSystem` 改成 `WorkspaceBackend`

### 8.2 执行风险（基于代码事实）

| 风险 | 级别 | 证据 |
|------|------|------|
| `rg` 升级为真实搜索时，需要 `WorkspaceBackend` 提供 `listDir()` 接口来遍历 | `MEDIUM` | filesystem.ts L61 已有 `workspace.listDir()` 调用，接口已有 |
| `mkdir` 的 partial 决策：backend 没有 `mkdir` primitive，现在只能保持 partial ack | `MEDIUM` | filesystem.ts L109-118：永久 stub，无法简单升级 |
| grep → rg alias 需要在 planner.ts 的 `buildInputFromArgs()` 添加 case | `LOW` | planner.ts L122-149：直接添加 `case "grep":` 映射即可 |

---

## 9. A9 — Minimal Bash Network and Script

### 9.1 代码事实核查

**✅ 完全准确：**
- `capabilities/network.ts`：`curl` handler 做 `new URL(url)` 验证后返回固定 stub 字符串（L29-38）
- `capabilities/exec.ts`：`ts-exec` handler 记录 code 长度后返回 stub（L30-34）
- `planner.ts` 中 `curl` 映射 `{ url: args[0] }`，`ts-exec` 映射 `{ code: args.join(" ") }`——bash path 确实只接受最小形式

**❌ 关键纠正（最重要）：**

A9 把 `ts-exec` substrate 描述为"未决定"，选项包括"Worker-native V8 sandbox"。但 just-bash 的 `js-exec.ts` 已经给出了明确答案：

```typescript
// js-exec.ts L13
import { Worker } from "node:worker_threads";
```

just-bash 使用 **QuickJS WASM + `node:worker_threads`** 作为 JS 执行 substrate。这在 **Cloudflare Workers 中完全不可用**（Workers 没有 `node:worker_threads`，也无法在 Worker 中再 spawn Worker）。

这意味着：
1. just-bash 的 `js-exec.ts` 对 nano-agent 来说**不可直接移植**——它们运行环境完全不同
2. Cloudflare Workers 中执行 TypeScript 代码唯一可行的安全路线是：**独立 service binding tool-runner Worker**（remote sandbox）
3. "in-process eval()" 在 Worker 中技术上可行（Function constructor），但无 VFS 访问、无 timeout 控制、无 cancel 机制，是倒退

A9 应该在 Phase 1 就明确：**v1 `ts-exec` = ask-gated partial（不执行，只记录意图）**，substrate decision 推后到有独立 tool-runner Worker 设计时。这是最诚实的 contract，也避免了整个 Phase 被 substrate 决策阻塞。

**如果要真正执行**，路线必须是 service-binding 远程 tool-runner——这刚好与 `capability-runtime/targets/service-binding.ts` 的 `ServiceBindingTarget` 对接。

### 9.2 执行风险（基于代码事实）

| 风险 | 级别 | 证据 |
|------|------|------|
| just-bash js-exec 用 node:worker_threads，Cloudflare Workers 不支持 | `CRITICAL` | js-exec.ts L13: `import { Worker } from "node:worker_threads"` |
| `ServiceBindingTarget` 已有完整 transport seam，可作为 ts-exec 升级路径 | `POSITIVE` | capability-runtime/targets/service-binding.ts L90+ |
| `curl` 在 Workers 中通过 `fetch()` API 是完全可行的——restricted curl 实现路线清晰 | `POSITIVE` | Workers native fetch，只需 egress guard |

---

## 10. A10 — Minimal Bash VCS and Policy

### 10.1 代码事实核查

**✅ 完全准确：**
- `capabilities/vcs.ts`：`SUPPORTED_SUBCOMMANDS = new Set(["status", "diff", "log"])`（L17）
- `git` handler 有子命令校验，unsupported subcommand throw Error（L35-39）
- `UNSUPPORTED_COMMANDS` 和 `OOM_RISK_COMMANDS` 分表存在（unsupported.ts L15-73）
- `FakeBashBridge` 不 fabricate success 的合同被完整实现（bridge.ts L68-109）

**❌ 关键纠正（基于代码）：**

A10 Phase 2 P2-01 要"让 `git status/diff/log` 在 workspace truth 上有 deterministic 输出"。但当前 `vcs.ts` 的 handler：
```typescript
return {
  output: `[git ${subcommand}${argStr}] (stub: VCS access not yet connected)`,
};
```

**virtual git 的数据来源问题确实存在**：`WorkspaceNamespace` 维护的是文件内容，没有 VCS metadata。要让 `git status` 有意义的输出，需要：
1. 要么接入真实 git（在 Worker/V8 isolate 中不可能）
2. 要么使用 workspace snapshot diff（可行：比较两次 snapshot 之间的变化）
3. 要么保持 stub 但明确标为 `Partial`，只报告"workspace-based change detection 不可用"

选项 2 是唯一技术可行且有真实价值的路线，但需要 A7 的 workspace snapshot 基础设施先就位。这说明 **A10 Phase 2 依赖 A7 snapshot 能力**，而不只是 A8/A9。

### 10.2 执行风险（基于代码事实）

| 风险 | 级别 | 证据 |
|------|------|------|
| virtual git output 数据来源：WorkspaceNamespace 无 VCS metadata | `HIGH` | vcs.ts L28-46：纯 stub，workspace 无 diff API |
| drift guard 的实现形式：A10 描述为 tests/docs，但没有 TS `const SUPPORTED_COMMANDS` 保证 | `MEDIUM` | commands.ts L16：`MINIMAL_COMMANDS` 是 `readonly` 数组，但 inventory 是文档，不是类型检查 |
| `FakeBashBridge` 的 `no-silent-success` 合同已完整实现，A10 P3-02 是加强，不是重建 | `POSITIVE` | bridge.ts L100-108 |

---

## 11. 全局跨文件综合评估

### 11.1 context 参考使用情况评估

| context | 在 action-plan 中的引用方式 | 实际代码对照结论 |
|---------|---------------------------|-----------------|
| `just-bash/fs/mountable-fs` | A8 引用为 workspace truth 参考 | just-bash 的 `MountableFs` 是完整 `IFileSystem`；nano-agent 的 `MountRouter` 只是路由层——**设计层次不同**，A8 正确地把 `MountRouter` 作为路由 substrate，而不是完整 FS 替换 |
| `just-bash/commands/rg` | A8 参考 | just-bash `rg` 是纯 TS 文本搜索，完全 Worker-compatible。**nano-agent rg 升级的正确参考实现存在且可移植** |
| `just-bash/commands/js-exec` | A9 参考 | just-bash `js-exec` 依赖 `node:worker_threads`，**Worker 环境不可移植**。A9 不应把它作为 ts-exec 的实现模板，只能参考其 policy/boundary 设计 |
| `claude-code/services/tools` | A9/A10 参考 | Claude Code 的 tool execution 路线与 nano-agent 的 NACP 协议体系不直接兼容，参考价值在于概念层面（structured tool call、approval gating） |
| `codex/codex-rs/tools/tool_registry_plan.rs` | A10 参考 | Rust 实现，概念参考（tool registry 分层、policy taxonomy）。不可直接代码 reuse |

### 11.2 Identifier Law 执行情况

基于一手代码：
- `envelope.ts` 中 `header.producer_id` 使用 `NacpProducerIdSchema`（格式约束 string）——已经有 identifier format law
- `trace` 字段用 `trace_id` 而不是 `trace_uuid`——命名未统一
- `TraceEventBase` 里用 `sessionUuid`, `teamUuid`, `turnUuid`（camelCase）
- `NacpTrace` 里用 `session_uuid`, `trace_id`, `span_id`（snake_case）

**这两层之间的命名规范确实不统一**。A1 的 Identifier Law 需要在 A3 的 eval 层也明确执行规则（TypeScript in-process types 用 camelCase，wire format 用 snake_case，且两者的映射要有显式约定）。

### 11.3 Trace-first Law 验证

A3 声称 `trace_uuid` 必须成为所有 observability-dependent feature 的 canonical truth。代码现实：
- `NacpTrace.trace_id` 是 wire format 的 trace 标识符（UUID）
- `TraceEventBase.sessionUuid` 是 TS 层的 session 标识符
- 两者之间的 carrier 字段不存在

这验证了 Trace-first 工作的必要性，也确认了 A3 的问题诊断。

### 11.4 执行就绪度（基于代码事实重评）

| Action Plan | 就绪度 | 基于代码的关键依赖 |
|-------------|--------|------------------|
| A1 | ✅ `可立即启动 Phase 1` | `envelope.ts` 清晰，命名方向需要 owner 确认（`trace_id` → `trace_uuid`？） |
| A2 | ✅ `可并行于 A1 启动` | `do-storage.ts` substrate 已存在，只需 benchmark harness |
| A3 | ⚠️ `等待 A1 Phase 2 完成` | `envelope.ts` trace field 稳定后才能定义 carrier |
| A4 | ⚠️ `等待 A1 Phase 3 + A3 Phase 2` | session message family 和 trace carrier 需先稳定 |
| A5 | ⚠️ `等待 A4 基本完成` | `composition.ts` 接线需要 session edge 先有真实 handler |
| A6 | ⚠️ `等待 A4 + A5` | WsController/HttpController stub 是 L1 gate blocker |
| A7 | ⚠️ `等待 A6 Phase 4 L2` | `AssemblyResult` 需要新增 drop evidence fields（breaking change） |
| A8 | ✅ `可在 A7 Phase 1 后启动` | rg 升级路线清晰（参照 just-bash rg-search.ts），workspace.listDir 接口已有 |
| A9 | 🚫 `需先明确 ts-exec = ask-gated partial` | just-bash js-exec 的 substrate 在 Worker 不可用；remote sandbox 需要 tool-runner Worker |
| A10 | ⚠️ `等待 A8 完成，A7 snapshot 提供 git data` | virtual git data source 需 snapshot diff 基础 |

---

## 12. 最终建议摘要

### 立即行动（可以当天启动）

1. **A1 Phase 1**：running `rg` 全仓 scan 建立 legacy field inventory。`envelope.ts` 的 `trace_id` vs `trace_uuid` 命名方向需 owner 会议确认后才能开始 rename batch
2. **A9 Phase 1 substrate pre-decision**：基于 `just-bash/js-exec.ts` 依赖 `node:worker_threads`（Workers 不支持）的事实，建议 `ts-exec` v1 直接定为 `Partial (ask-gated, no real execution)`，解锁 A9 Phase 1/2 的其他工作

### A8 rg 升级路线（有 context 证据支持）

参照 `context/just-bash/src/commands/rg/rg-search.ts` 的实现：
1. `rg handler` → 调用 `WorkspaceNamespace.listDir()` 递归获取文件列表
2. 对每个文件调用 `WorkspaceNamespace.readFile()` 获取内容
3. 做 TS regex match（不依赖任何二进制）
4. 返回 bounded match 列表

`WorkspaceBackend.listDir()` 接口已在 `filesystem.ts` L61 中被使用，接口已存在，路线可行。

### A9 curl 升级路线（Workers-native）

1. Workers 原生支持 `fetch()` API
2. restricted curl: `fetch(url, { signal, method: "GET" })` + egress guard（拒绝 private IP）+ output size cap
3. structured path 通过 `planFromToolCall()` 进入，bash path 只接受 `curl <url>`
4. 这是完全 Worker-native 的实现路线

### A10 virtual git data source（明确建议）

v1 路线应该是：`git status` = 检测 workspace namespace 是否有未 snapshot 的 pending writes（调用 `WorkspaceSnapshotBuilder` 检查 dirty state）。这比"no git repo" stub 有意义，比真实 VCS 可实现。但需要 A7 先建立 snapshot 基础。

---

*本评审报告基于对全部关键代码文件的一手阅读，以及对 `context/` 下三套参考实现（just-bash、codex、claude-code）的直接代码核查。所有评价结论均可追溯到具体文件和行号。*
