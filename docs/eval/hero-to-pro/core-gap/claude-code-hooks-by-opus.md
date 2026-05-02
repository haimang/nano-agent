# Hooks Core-Gap — claude-code vs nano-agent

> Reviewer: Claude Opus 4.7 (1M context)
> Date: 2026-05-02
> Scope baseline: `context/claude-code/` 真实代码 + `workers/agent-core/src/hooks/` + `packages/nacp-core/src/hooks-catalog` + `packages/nacp-core/src/messages/hook.ts` + `clients/api-docs/*` + `docs/charter/plan-hero-to-pro.md` + `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md` + `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md`
> 引用纪律:文中所有 `path:Lstart-Lend` 均为一手代码引用,可直接 jump-to-line。

---

## 0. TL;DR(1 段定论)

**结论一句话**:nano-agent 的 hooks **拼图骨架已经很完整**(catalog / dispatcher / registry / runtimes / audit / broadcast / snapshot / guards / 18 events / 4 payload schema 全部 in-place),但**对外完全不可用、对内只有 4 个事件真正在 emit**,而真正让 claude-code 的 hooks 成为"agent loop 控制平面"的核心机制 — **用户配置层 + 4 hook 类型(command/prompt/agent/http)+ async/asyncRewake + sync 决策回路(decision/permissionDecision/updatedInput)+ 21 个 emit 站点中的 14 个** — **全部缺席**。

**3 条阻断级断点(Block-grade)**:
1. **B-Hook-1 — Registry 永远是空的**:`runtime-assembly.ts:156` `new HookRegistry()` 之后,**production 代码内 0 个 `registry.register(handler)` 调用**;`HookHandlerConfig.source` 三个枚举值 `platform-policy / session / skill` 中**没有一个有真实 register 路径**(grep 仅命中 dispatcher 自身和 snapshot 接口)。dispatcher 永远走 `aggregateOutcomes([], eventName)` → `finalAction: "continue"` → no-op。
2. **B-Hook-2 — 18 events 中 14 个永不 emit**:`agent-core/src/host/orchestration.ts:238/244/250/512` + `host/shutdown.ts:97/104` 一共**只**emit 5 个唯一事件:`Setup / SessionStart / UserPromptSubmit / SessionEnd / Stop`。**`PreToolUse / PostToolUse / PostToolUseFailure / PreCompact / PostCompact / PermissionRequest / PermissionDenied / ContextPressure / ContextCompactArmed / ContextCompactPrepareStarted / ContextCompactCommitted / ContextCompactFailed / EvalSinkOverflow / 14 个 claude-code 独有事件` 共 14+ 处 emit 站点未接通**。其中 PreToolUse/PostToolUse 是整个 hooks 体系**最核心**的 2 个事件。
3. **B-Hook-3 — 客户端零 hooks API**:`clients/api-docs/README.md:40-256` 的 22-doc pack 内**没有任何**面向客户端的 hooks 配置 / 注册 / 列表 / 触发审计的端点;唯一与 hooks 相关的对外契约是 `clients/api-docs/session-ws-v1.md:67` 的 `hook.broadcast` WS 帧(标 `RHX2` 来源 = 历史阶段 placeholder),但产线代码内 **0 处** call `hookEventToSessionBroadcast()`(`workers/agent-core/src/hooks/session-mapping.ts:37` 仅被 export,无 import-as-call)。

**1 条次级断点(High-grade)**:
4. **H-Hook-4 — 4 hook 类型 0/4 实现**:claude-code 的 `command / prompt / agent / http` 4 种执行体(`context/claude-code/utils/hooks/execHttpHook.ts:1-242` / `execAgentHook.ts:1-339` / `execPromptHook.ts:1-211` / `utils/hooks.ts:747-1335` shell)在 nano-agent 内**只有 1 种半**:`local-ts`(进程内函数,`workers/agent-core/src/hooks/runtimes/local-ts.ts`)与 `service-binding`(同 worker DC 内的 RPC,`runtimes/service-binding.ts`),都没有 user-supplied 执行能力。

---

## 1. 度量尺:claude-code 的 hooks 究竟做了什么

### 1.1 事件目录(27 events)

`context/claude-code/entrypoints/sdk/coreTypes.ts:25-53` 的 `HOOK_EVENTS` 是冻结的 **27 个事件名**:

```
PreToolUse, PostToolUse, PostToolUseFailure, Notification,
UserPromptSubmit, SessionStart, SessionEnd, Stop, StopFailure,
SubagentStart, SubagentStop, PreCompact, PostCompact,
PermissionRequest, PermissionDenied, Setup, TeammateIdle,
TaskCreated, TaskCompleted, Elicitation, ElicitationResult,
ConfigChange, WorktreeCreate, WorktreeRemove,
InstructionsLoaded, CwdChanged, FileChanged
```

### 1.2 事件触发位点(代码引用)

- **PreToolUse / PostToolUse / PostToolUseFailure**:`context/claude-code/services/tools/toolHooks.ts:39-50, 100-120, 193-206`(每次 tool 执行前/后/失败)
- **Stop / StopFailure / SubagentStart / SubagentStop**:`context/claude-code/query/stopHooks.ts:180-189`(query loop 终止 + subagent 边界)
- **SessionStart / Setup / SessionEnd / CwdChanged / FileChanged**:`context/claude-code/utils/hooks/sessionHooks.ts:68-86`(session lifecycle + 文件系统 watcher)
- **UserPromptSubmit / PreCompact / PostCompact / Notification / PermissionRequest / PermissionDenied / ConfigChange**:`context/claude-code/utils/hooks.ts:1604-1670`(主 query loop)
- **Elicitation / ElicitationResult**:同上,在 elicitation 协议位点
- **Async re-entry**:`context/claude-code/utils/hooks/AsyncHookRegistry.ts:113-268` 的 `checkForAsyncHookResponses()` 在 query loop 间隙 poll 后台已完成的 hook 响应

### 1.3 同步决策回路(关键)

`context/claude-code/types/hooks.ts:50-166` 的 `syncHookResponseSchema` 决定了 hook **能改变 agent loop 的什么**:

| 字段 | 语义 | 影响 |
|------|------|------|
| `decision: "block"` | 阻断本步 | tool 不执行,error 通过 `hook_blocking_error` attachment 回到 LLM(`utils/hooks.ts:531-536, 2659-2668`) |
| `permissionDecision: "allow"|"deny"|"ask"` (PreToolUse) | 覆盖 PermissionResult | 但**仍受** settings.json `permissions` rule 阻断(`services/tools/toolHooks.ts:372-391`) |
| `updatedInput` (PreToolUse only) | 改写 tool args | last-non-undefined wins,后 hook 覆盖前 hook(`utils/hooks.ts:2851-2868`) |
| `additionalContext` | 注入到 LLM 上下文 | newline 拼接,所有匹配 hook 累加 |
| `continue: false, stopReason` | 终止整个 query | 通过 `preventContinuation` 信号上抛 |
| `suppressOutput` | UI 隐藏 stdout | UI-only |
| `systemMessage` | UI 警告 | UI-only |
| `hookSpecificOutput.watchPaths` (SessionStart/CwdChanged/FileChanged) | 注册文件 watcher | `fileChangedWatcher.ts:1-191` 反向触发 FileChanged |

### 1.4 异步回路

`context/claude-code/schemas/hooks.ts:55-64` 的 BashCommandHookSchema:

- `async: true` → hook 进入后台,主 loop 不等待;后续 `AsyncHookRegistry.checkForAsyncHookResponses()`(`AsyncHookRegistry.ts:113-268`)在 query 间隙 poll 已完成的 hook,把 `{continue: false}` 等回填进 loop。
- `asyncRewake: true` → 后台 hook 退出码 2(blocking)时**主动唤醒模型**(`utils/hooks.ts:205-245`),回到主 loop。
- 默认 `asyncTimeout: 15s`(`AsyncHookRegistry.ts:51`)。

### 1.5 4 种 hook 执行体

`context/claude-code/schemas/hooks.ts:30-189` 用 zod discriminated union 定义 4 种:

| 类型 | 执行体 | 关键文件 |
|------|--------|----------|
| `command` | shell 子进程(bash / pwsh) | `utils/hooks.ts:747-1335`, `subprocessEnv.ts` |
| `prompt` | 小快模型 + `$ARGUMENTS` | `utils/hooks/execPromptHook.ts:1-211` |
| `agent` | 子 agent 验证(headless subagent) | `utils/hooks/execAgentHook.ts:1-339` |
| `http` | POST 到 URL(SSRF + env-var allowlist) | `utils/hooks/execHttpHook.ts:1-242`, `ssrfGuard.ts:1-295` |

### 1.6 配置层

`context/claude-code/utils/hooks/hooksConfigSnapshot.ts:18-134` + `hooksConfigManager.ts:1-400`:

- 6 层来源:`policySettings`(managed)> `projectSettings`(`.claude/settings.json`)> `userSettings`(`~/.claude/settings.json`)> `localSettings`(`.claude/settings.local.json`)> registered(SDK / plugin)> session(in-memory)
- snapshot 模式:启动时 `captureHooksConfigSnapshot()`,`/hooks` 命令或文件 watcher 触发时 `updateHooksConfigSnapshot()` 重读
- 信任门:`utils/hooks.ts:286-296` 所有 hook 在交互模式都需 workspace trust(SDK / headless 隐式信任)

### 1.7 安全模型(只在 claude-code 存在,nano-agent 无)

- SSRF guard:阻断 RFC1918 + link-local;loopback 显式放行;有代理时跳过(`ssrfGuard.ts:1-295`)
- env var allowlist:HTTP header `Bearer $TOKEN` 仅当 `allowedEnvVars` 列出才插值(`execHttpHook.ts:89-108`)
- 命令沙箱:filtered env、PowerShell `-NoProfile -NonInteractive`、Git Bash on Windows
- `if: "Bash(git *)"` permission-rule 语法 pre-spawn filter(`utils/hooks.ts:1390-1421, 1808-1848`)

### 1.8 聚合规则(多 hook 命中同事件)

`utils/hooks.ts:2820-2847`:**第一个 deny 胜出**(然后 ask,然后 allow);`additionalContexts` 累加;`updatedInput` last-wins;**并行执行** non-blocking,**串行**执行 blocking(`utils/hooks.ts:1952-2972`)。

---

## 2. nano-agent 的 hooks 拼图(从代码读出)

### 2.1 已经构建的(meta-data 完整)

| 组件 | 文件:行 | 状态 |
|------|---------|------|
| 18-event catalog(B5 expansion 后) | `workers/agent-core/src/hooks/catalog.ts:68-233` | ✅ 完整 |
| Dispatcher(timeout / depth / fail-closed guards) | `workers/agent-core/src/hooks/dispatcher.ts:45-149` | ✅ 完整 |
| Registry(source-priority `platform-policy > session > skill`) | `workers/agent-core/src/hooks/registry.ts:18-72` | ✅ 完整 |
| Outcome reducer(strictest-wins,allowedOutcomes 校验) | `workers/agent-core/src/hooks/outcome.ts:52-126` | ✅ 完整 |
| Matcher(`exact / wildcard / toolName`) | `workers/agent-core/src/hooks/matcher.ts:22-44` | ✅ 完整(语法极简 vs claude-code permission-rule) |
| 2 runtimes(`local-ts` + `service-binding`) | `workers/agent-core/src/hooks/runtimes/{local-ts,service-binding}.ts` | ✅ 完整 |
| Audit record builder(`event_kind: "hook.outcome"`) | `workers/agent-core/src/hooks/audit.ts:67-115` | ✅ 完整 |
| Session broadcast mapping(`hook.broadcast` WS frame) | `workers/agent-core/src/hooks/session-mapping.ts:37-60` | ✅ 完整 |
| Permission verdict 翻译层(`continue/block` → `allow/deny`) | `workers/agent-core/src/hooks/permission.ts:50-58` | ✅ 完整 |
| Snapshot / Restore(DO hibernation) | `workers/agent-core/src/hooks/snapshot.ts:30-54` | ✅ 完整 |
| Guards(timeout 10s default,maxDepth 3) | `workers/agent-core/src/hooks/guards.ts:24-84` | ✅ 完整 |
| Wire schemas(`hook.emit` + `hook.outcome`) | `packages/nacp-core/src/messages/hook.ts:4-30` | ✅ 完整 |
| 18 payload schemas | `packages/nacp-core/src/hooks-catalog/index.ts:30-193` | ✅ 完整 |
| Catalog 注册接口 | `workers/agent-core/src/hooks/types.ts:30-38` | ✅ 完整 |
| KV key reservation(`hooksPolicy/{teamUuid}`) | `packages/nacp-core/src/storage-law/constants.ts:23` | ✅ 预留 |
| Storage topology 预留(`hooks-config` data-item) | `packages/storage-topology/src/data-items.ts:117-127` | ✅ 预留 |

### 2.2 真实运行时接通的(very thin)

| 接通点 | 文件:行 | 现状 |
|--------|---------|------|
| Dispatcher 实例化 | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:155-160` | ✅ HP5 已注入,但 registry **空** |
| `hook.emit` delegate 接到 dispatcher | `workers/agent-core/src/host/runtime-mainline.ts:793-811` | ✅ HP5 已接,但 dispatcher 拿不到任何 handler |
| Audit 写盘(`emitHook` → `recordAuditEvent`) | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:354-432` | ✅ 接通,但只在 `outcome.action !== "continue"` 时写 — 而 `continue` 是 0-handler 的常态 |
| `kernel/runner.ts` `hook_emit` 决策处理 | `workers/agent-core/src/kernel/runner.ts:412-436` | ✅ 接通,但 `pendingHookEvents` 队列 **0 producer** |

### 2.3 真实在 emit 的 5 个事件(全部声明性 lifecycle)

```
Setup            — orchestration.ts:238 (actor unattached → attached)
SessionStart     — orchestration.ts:244 (turnCount === 0)
UserPromptSubmit — orchestration.ts:250 (每个 turn 开始)
SessionEnd       — orchestration.ts:512 + shutdown.ts:104
Stop             — shutdown.ts:97
```

### 2.4 14+ 个声明但永不 emit 的事件

`workers/agent-core/src/hooks/catalog.ts:92-232` 已注册但**全 codebase 0 处 emit**:

- `PreToolUse` — capability 执行路径无 emit(`runtime-mainline.ts:617-792` capability 块内 0 处 `emitHook("PreToolUse", ...)`)
- `PostToolUse` / `PostToolUseFailure` — 同上
- `PreCompact` / `PostCompact` — 自动 compact 触发位点(`orchestration.ts:332-339`)未 emit
- `PermissionRequest` / `PermissionDenied` — `bash-core/src/permission.ts:1-60` 定义了 authorizer interface,但**没有任何 host 注入实现**;executor 仍走 `policy-ask` 静态返回
- `ContextPressure / ContextCompactArmed / ContextCompactPrepareStarted / ContextCompactCommitted / ContextCompactFailed` — async-compact 5 事件归 context-core,通过 `bridgeToHookDispatcher()`(`workers/context-core/src/async-compact/events.ts:79`)预备,但 nano-agent **没有 cross-worker dispatcher binding**(dispatcher 只活在 agent-core session DO 内,context-core 拿不到引用)
- `EvalSinkOverflow` — `eval-observability` 未升级为 producer

### 2.5 客户端能看到的 hook surface(几乎为零)

- `clients/api-docs/session-ws-v1.md:67` 列出 `hook.broadcast` 帧;但 `hookEventToSessionBroadcast()`(`workers/agent-core/src/hooks/session-mapping.ts:37`)在 production 代码内**0 个 import-as-call**;`kernel/runner.ts:419-426` push `hook.broadcast` runtime event,但 `pendingHookEvents` 永不被 enqueue → 帧从未上线
- `clients/api-docs/worker-health.md:142` 列出 `hook.outcome` audit table 列;HPX5 audit 路径有写入(`runtime-assembly.ts:399-416`),但只在 `action !== "continue"` 时 — 0-handler 路径不写
- 22-doc pack(`README.md:40-256`)**没有**任何 `/hooks/*` 路由;没有 `/me/hooks_config`、`/sessions/{id}/hooks`、`/teams/{id}/hooks_policy` 端点
- 没有 `settings.json` / `.claude/` 等价物;没有 plugin / skill 注册 hooks 的入口

### 2.6 charter 已经知道这个 gap

`docs/charter/plan-hero-to-pro.md:168` G7 直说:
> Permission/elicitation kernel interrupt 不存在(`approval_pending` 枚举存在但永不触发);**hook dispatcher 实例无注入**(F12 慢性五阶段)。

`plan-hero-to-pro.md:192-193` 错误前提 6 反思:
> **错误前提 6**:"hook dispatcher 已经 wire 完成"
> **为什么错**:wire 完整,但 `hooks/permission.ts` 无调用方,跨 ZX5 → RH6 五阶段 silently 漂着。HP7 必须真接通。

(实际上 HP5 接通了 dispatcher 实例,但仍没有 register 任何 handler — 见 §2.1。)

---

## 3. Gap 矩阵(claude-code → nano-agent)

逐项对账。**评分**:`A` = nano-agent 已对齐;`B` = 部分;`C` = 仅 schema 预留无 emit;`D` = 完全缺失。

### 3.1 27 events × emit 站点

| claude-code event | nano-agent catalog | nano-agent emit site | 评分 |
|---|---|---|---|
| **PreToolUse** | ✅ catalog.ts:92-97 | ❌ 无 | **D**(blocker) |
| **PostToolUse** | ✅ catalog.ts:98-103 | ❌ 无 | **D**(blocker) |
| **PostToolUseFailure** | ✅ catalog.ts:106-111 | ❌ 无 | **D** |
| **Notification** | ❌ 不在 18-event catalog | ❌ | **D** |
| UserPromptSubmit | ✅ catalog.ts:86-91 | ✅ orchestration.ts:250 | **A** |
| SessionStart | ✅ catalog.ts:72-77 | ✅ orchestration.ts:244 | **A** |
| SessionEnd | ✅ catalog.ts:78-83 | ✅ orchestration.ts:512 | **A** |
| Stop | ✅ catalog.ts:144-149 | ✅ shutdown.ts:97 | **A** |
| **StopFailure** | ❌ | ❌ | **D** |
| **SubagentStart / SubagentStop** | ❌(D4 nano-agent 不做 subagent) | ❌ | **D**(out-of-scope per charter D4)|
| **PreCompact** | ✅ catalog.ts:112-117 | ❌ orchestration.ts:332-339 仅 probe,无 emit | **C** |
| **PostCompact** | ✅ catalog.ts:120-125 | ❌ context-core compact-committed 路径无 emit | **C** |
| **PermissionRequest** | ✅ catalog.ts:160-165 | ❌ bash-core/src/permission.ts authorizer interface 未注入 | **C** |
| **PermissionDenied** | ✅ catalog.ts:170-175 | ❌ 同上 | **C** |
| Setup | ✅ catalog.ts:135-140 | ✅ orchestration.ts:238 | **A** |
| **TeammateIdle / TaskCreated / TaskCompleted** | ❌ | ❌ | **D**(若引入 teammate 协议要扩 catalog)|
| **Elicitation / ElicitationResult** | ❌(走独立 confirmation kind 路径) | ⚠️ confirmation 路径有 dual-mapping 但不是 hook | **D** |
| **ConfigChange** | ❌ | ❌(`/sessions/{id}/runtime` PATCH 是 HPX6 新增,可挂)| **D** |
| **WorktreeCreate / WorktreeRemove** | ❌(workspace = R2 而非 git worktree) | ❌ | **D**(语义不直接对应)|
| **InstructionsLoaded** | ❌ | ❌ | **D** |
| **CwdChanged** | ❌(workspace 无 cwd) | ❌ | **D**(语义不对应)|
| **FileChanged** | ⚠️ Class C deferred 显式说"B7 才补"(catalog.ts:29) | ❌ | **C** |
| ContextPressure / CompactArmed / PrepareStarted / Committed / Failed | ✅ catalog.ts:184-222 | ❌ context-core async-compact 走 `bridgeToHookDispatcher()` 但 dispatcher 不在 context-core | **C** |
| EvalSinkOverflow | ✅ catalog.ts:227-232 | ❌ eval-observability 未升级 | **C** |

**总分**:`A=4 / B=0 / C=10 / D=13`(claude-code 27 vs 已实装 4 — 覆盖率 14.8%,真实 emit ≤ 5/27)。

### 3.2 决策回路(同步)

| claude-code 字段 | nano-agent 等价 | 评分 |
|---|---|---|
| `decision: "block"` | ✅ `HookOutcome.action: "block"` + outcome reducer 短路(dispatcher.ts:138-141) | **A** |
| `permissionDecision: "allow"|"deny"|"ask"` | ⚠️ 只在 `PermissionRequest` 上通过 `verdictOf()` 翻译 `continue/block`(permission.ts:50-58),不通用 | **B** |
| `updatedInput` | ✅ `aggregateOutcomes` 仅在 `allowedOutcomes` 含 `updatedInput` 的事件上生效(outcome.ts:80-85)— 仅 PreToolUse | **A**(但 PreToolUse 不 emit,所以**事实上无人能用**)|
| `additionalContext` | ✅ outcome.ts:88-90 | **A** |
| `continue: false, stopReason` | ⚠️ 没有 `stop` action 在大部分事件上,只有 `PostToolUseFailure` 含 `stop`(catalog.ts:108) | **B** |
| `suppressOutput / systemMessage` | ❌ outcome shape 无字段 | **D** |
| `hookSpecificOutput.watchPaths` (FileChanged) | ❌(无 watcher 子系统)| **D** |

### 3.3 异步回路

| claude-code 机制 | nano-agent 等价 | 评分 |
|---|---|---|
| `async: true`(后台执行) | ❌ dispatcher 全同步 await | **D** |
| `asyncRewake`(主动唤醒模型)| ❌ kernel runner 无 wake-on-hook 入口 | **D** |
| `AsyncHookRegistry` poll-back | ❌ | **D** |
| `asyncTimeout` per-hook | ❌(只有 `timeoutMs` 同步超时,guards.ts:24-72)| **D** |

### 3.4 4 hook 执行体

| 类型 | claude-code | nano-agent | 评分 |
|---|---|---|---|
| `command` (bash) | ✅ utils/hooks.ts:747-1335 | ❌(Workers 无 child_process,不能直接 port) | **D**(语义需走 bash-core sandbox)|
| `prompt` (LLM verifier) | ✅ utils/hooks/execPromptHook.ts:1-211 | ❌(可借用 Workers AI 实现,但当前 0 行) | **D** |
| `agent` (subagent verifier) | ✅ utils/hooks/execAgentHook.ts:1-339 | ❌(D4 不做 subagent) | **D**(out-of-scope) |
| `http` (POST + SSRF) | ✅ utils/hooks/execHttpHook.ts:1-242 + ssrfGuard.ts:1-295 | ❌(可加 service-binding runtime + 出站 fetch + DNS guard) | **D** |
| `local-ts` / `service-binding` | ❌(claude-code 无) | ✅ workers/agent-core/src/hooks/runtimes/* | **A**(独有,服务平台 hook;非 user-supplied) |

**结论**:nano-agent 的 2 个 runtime 只能跑**平台自带的代码**,**用户/租户根本无法注册自己的 hook**。

### 3.5 配置层

| claude-code 来源 | nano-agent 等价 | 评分 |
|---|---|---|
| `~/.claude/settings.json`(用户)| ❌ 无 | **D** |
| `.claude/settings.json`(项目)| ❌ 无(可对齐到 team-level KV)| **D** |
| `.claude/settings.local.json`(本地)| ❌ 无 | **D** |
| 6-source snapshot 模式 | ❌ | **D** |
| Plugin / Skill / Frontmatter 注册 | ❌(`HookSource: "skill"` 在 types.ts:12 显式标"deferred for v1") | **D** |
| Tenant policy(`KV_KEYS.hooksPolicy(teamUuid)`)| ⚠️ key 预留(constants.ts:23),无 reader/writer | **C** |
| Session-scoped(`appState.sessionHooks`)| ⚠️ DO_KEYS.SESSION_HOOKS_CONFIG(constants.ts:11)预留;`HookSource: "session"` 在 types.ts:12 enum 内,无路由 | **C** |
| `if: "Bash(git *)"` permission-rule filter | ⚠️ matcher.ts 仅 `exact / wildcard / toolName` 3 种 | **B** |
| 信任门(workspace trust)| ❌(nano-agent 是 server-side,trust 由 auth 隐式)| **A**(语义不直接对应) |

### 3.6 安全模型

| claude-code 控制 | nano-agent 等价 | 评分 |
|---|---|---|
| SSRF guard(RFC1918 / link-local 阻断,loopback 放行) | ❌(无 HTTP runtime,所以无 SSRF 面)| **D**(若引入 HTTP hook 必须补) |
| env var allowlist | ❌ | **D** |
| 命令 sandbox(filtered env / pwsh -NoProfile) | ⚠️ bash-core 有 sandboxed exec 但与 hooks 解耦 | **B** |
| Shell prefix(CLAUDE_CODE_SHELL_PREFIX)| ❌ | **D** |
| Trust dialog | ❌(server-side 由 auth 替代)| **A**(N/A) |

### 3.7 观察性

| claude-code | nano-agent | 评分 |
|---|---|---|
| `tengu_run_hook` metric(per-event)| ❌ | **D** |
| `tengu_repl_hook_finished` aggregate | ❌ | **D** |
| `internal: true` 排除 user metrics | ⚠️ 无 internal 标记字段 | **C** |
| `HookExecutionEvent`(started / progress / response)→ SDK | ⚠️ `hook.broadcast` 帧 schema 存在但无 emit producer | **C** |
| `setAllHookEventsEnabled` SDK gate | ❌ | **D** |
| Debug logging | ✅ logger.warn 在 `runtime-assembly.ts:419-426` | **A** |
| Audit record(durable)| ✅ audit.ts:67-115 + recordAuditEvent | **A** |

### 3.8 聚合规则

| claude-code | nano-agent | 评分 |
|---|---|---|
| 第一个 deny 胜出 | ✅ outcome.ts:73-78(strictest-wins:stop > block > continue) | **A** |
| `additionalContexts` 累加 | ✅ outcome.ts:88-90(newline join) | **A** |
| `updatedInput` last-wins | ✅ outcome.ts:80-85 | **A** |
| 并行 non-blocking,串行 blocking | ✅ dispatcher.ts:130-145 | **A** |
| Per-source dedup(project + user 同 command 合并)| ❌(registry.ts 仅 id 去重) | **D** |

**Gap 矩阵总结**:
- **API formal coverage**(catalog / outcome / runtime interface): **A** 居多 — 设计层面已经 mature。
- **Wire emit coverage**(emit producer 真接通): **C/D** 居多 — 14/27 事件无 producer。
- **User-facing surface**(配置 / 注册 / 4 类执行体 / 异步回路): **D** 全面缺失。
- **Safety**(SSRF / env / sandbox 在 hook 上下文): **D** 缺失,但当前没有 user-supplied hook 所以**临时安全**。

---

## 4. 关键断点详解(8 处必须解决,带代码引用)

### 4.1 B-Hook-1 — Registry 永远是空的

**证据**:
- `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:155-160`:
  ```ts
  function createSessionHookDispatcher(): HookDispatcher {
    const registry = new HookRegistry();
    const runtimes = new Map([
      ["local-ts" as const, new LocalTsRuntime()],
    ]);
    return new HookDispatcher(registry, runtimes);
  }
  ```
- 之后 grep `hookRegistry.register|registry: HookRegistry` 在 production 代码中 **0 命中**(test 不算)。
- `workers/agent-core/src/hooks/registry.ts:25`(`register(handler)`)的真实调用方为 0。

**影响**:dispatcher.emit() 在 `dispatcher.ts:71-80` 走 `handlers = []` → `aggregateOutcomes([], eventName)` → `finalAction: "continue"` → 调用方拿到 `outcome.blocked: false` → 永不阻塞。

**事实结论**:**已部署的 18-event hook 系统 0 handler,即使 emit 都接通也不会有任何效果**。

### 4.2 B-Hook-2 — 14+ 事件永不 emit

**证据**(emit 全清单,无遗漏):
```
orchestration.ts:238 — emitHook("Setup", ...)
orchestration.ts:244 — emitHook("SessionStart", ...)
orchestration.ts:250 — emitHook("UserPromptSubmit", ...)
orchestration.ts:512 — emitHook("SessionEnd", ...)
shutdown.ts:97       — emitHook("Stop", ...)
shutdown.ts:104      — emitHook("SessionEnd", ...) (重复)
```

**对照**:`workers/agent-core/src/hooks/catalog.ts:68-233` 注册的 18 事件,production emit **5 unique** (`Setup / SessionStart / UserPromptSubmit / SessionEnd / Stop`)。

**关键 14+ 缺失**:
- `PreToolUse / PostToolUse / PostToolUseFailure` — 整个 hooks 系统**最大价值**就在 tool 边界,这 3 个不 emit 等于 hooks 在 tool 上**无效**。
- `PreCompact / PostCompact` — auto-compact 已经 wire(HPX5 F3,`runtime-assembly.ts:285-321`),但 compact 触发**没有 emit hook**;`orchestration.ts:332-339` 只 set `compactRequired` flag,没有 `await this.deps.emitHook("PreCompact", ...)`。
- `PermissionRequest / PermissionDenied` — bash-core 定义了 `CapabilityPermissionAuthorizer` interface(`workers/bash-core/src/permission.ts:56-60`),但**没有任何 host wire 它**(grep `CapabilityPermissionAuthorizer` 全 codebase 仅 type 定义,无 instance);更别说 emit hook。
- 5 个 ContextCompact* — `context-core/src/async-compact/events.ts:79` 的 `bridgeToHookDispatcher()` 是个 factory,**没有任何 caller**。
- EvalSinkOverflow — `workers/eval-observability` 升级为 producer 的 PR 不存在。

**影响**:
- `clients/api-docs/session-ws-v1.md:67` 文档化的 `hook.broadcast` 帧从未上线 → 客户端看不到任何 hook 反馈(audit 通道 `worker-health.md:142` 同理 — 只在 `action !== "continue"` 时写,而 `continue` 是常态)。
- `docs/charter/plan-hero-to-pro.md:168` G7 标记的 "hook dispatcher 实例无注入" 实际上**已在 HP5 解决**,但**深层问题**(emit + register)没有解决,charter 误以为已通。

### 4.3 B-Hook-3 — 客户端零 hooks API

**证据**:
- `clients/api-docs/README.md:40-256` 的 22-doc 完整 endpoint matrix 内**0 个 `/hooks` 端点**:
  - 无 `/me/hooks_config` GET/PATCH
  - 无 `/sessions/{id}/hooks` 列表 / 注册
  - 无 `/teams/{id}/hooks_policy` admin 配置
  - 无 `/hooks/{handler_id}/test` dry-run
- 没有 `settings.json` 等价物,租户/用户**无法配置任何 hook**。
- `KV_KEYS.hooksPolicy(teamUuid)`(`packages/nacp-core/src/storage-law/constants.ts:23`)只是预留 key,无 reader/writer。

**影响**:这是把 nano-agent 与 claude-code 在 hooks 上分开的**最大裂缝**。claude-code 的 hook 价值 80% 来自"用户能自己加 hook";nano-agent 把所有 hook 锁在平台代码内 → 等价于**没有 user hooks**。

### 4.4 H-Hook-4 — 4 hook 类型 0/4(无 user-supplied 执行体)

**证据**:
- `workers/agent-core/src/hooks/runtimes/` 仅 2 个 runtime:`local-ts` + `service-binding`,均为**平台代码绑定**。
- `workers/agent-core/src/hooks/types.ts:14-15`:
  ```ts
  export type HookRuntimeKind = "local-ts" | "service-binding";
  ```
- 无 `command` / `prompt` / `agent` / `http` 类型枚举或对应 runtime。

**Cloudflare 适配可行性**:
- `command`:Workers 无 `child_process`,**不能直接 port**;若必须做,需要走 bash-core 的 sandboxed exec(类似已经存在的 capability 路径)或 Workers Runner-as-a-service。
- `prompt`:Workers AI 已经在 binding(`AI` env),实现 hook 走 LLM 验证完全可行,200 行内能做完。
- `http`:Workers 原生 `fetch()`,但**必须**先做 SSRF guard(Cloudflare runtime 无 default DNS resolver,需要在 fetch 前做 IP 解析 + RFC1918 阻断,或借 Cloudflare 的 `subnetMatch`)+ env-var 白名单。
- `agent`:D4 显式禁止 subagent,这条 OOS。

### 4.5 H-Hook-5 — 异步 hook 0/3

**证据**:
- `workers/agent-core/src/hooks/dispatcher.ts:108-114` `await withTimeout(...)` 全同步;
- `workers/agent-core/src/hooks/types.ts:30-38` `HookHandlerConfig` 无 `async / asyncRewake / asyncTimeout` 字段;
- `kernel/runner.ts:419` `const payload = await this.delegates.hook.emit(...)` 全同步,无 `wakeOnAsync` 入口。

**影响**:无法做 claude-code 风格的"hook 跑大事在后台,主 loop 继续推进,完成后 wake 模型"。对长跑 verifier(test runner / lint)无解。

### 4.6 H-Hook-6 — Cross-worker dispatcher 不共享

**证据**:
- Dispatcher 实例**只在** `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:554-556` 创建,作用域 = NanoSessionDO 单实例。
- `workers/context-core/src/async-compact/events.ts:79` 的 `bridgeToHookDispatcher(dispatcher: HookDispatcher)` 期待外部传入 dispatcher,但 context-core service binding 路径没有任何方式拿到 agent-core 内 DO 私有实例。
- `bash-core/src/permission.ts:56-60` 的 `CapabilityPermissionAuthorizer` 同理 — interface 在 bash-core 但实现需要 dispatcher,**跨 worker 拿不到**。

**影响**:5 个 ContextCompact* + PermissionRequest/PermissionDenied 的 emit producer**架构上**无法在自己 worker 内接通,要么拆到 cross-worker RPC,要么 bridge 到 nacp `hook.emit` 协议帧 → 单一 dispatcher worker。

### 4.7 H-Hook-7 — `hook.broadcast` 帧 producer 0

**证据**:
- `workers/agent-core/src/hooks/session-mapping.ts:37` `hookEventToSessionBroadcast()` 仅被 `hooks/index.ts:78` re-export;`grep -rn "hookEventToSessionBroadcast" workers/ packages/ | grep -v test/ | grep -v "index\.ts\|session-mapping\.ts"` → **0 命中**。
- `kernel/runner.ts:419-426` 的 `hook.broadcast` 是 runtime event(被 `kernel/session-stream-mapping.ts:30` 映射到 stream-event kind `hook.broadcast`),仅当 `pendingHookEvents` 队列有内容时才走;但 `scheduler.ts:28` 的 `pendingHookEvents` 字段**0 producer**(grep `pendingHookEvents` 全 codebase 只命中 scheduler.ts 自身的 type 定义)。

**影响**:`session-ws-v1.md:67` 文档化的客户端 hook 反馈通道**自始至终没上线**。

### 4.8 H-Hook-8 — `if` filter 表达力差距

**证据**:
- claude-code:`schemas/hooks.ts:19-27` `if: "Bash(git *)"` 复用 permission rule 语法,有 `tool.preparePermissionMatcher()`(`utils/hooks.ts:1390-1421`)
- nano-agent:`workers/agent-core/src/hooks/matcher.ts:22-44` 仅 3 种:
  ```ts
  case "exact":    return config.value === eventName;
  case "wildcard": return config.value === "*";
  case "toolName": return context?.toolName === config.value;
  ```

**影响**:不能写 `Bash(git push *)` 这样的精细前置过滤,所有 PreToolUse hook 都得在 handler 内自己解析 args。租户 policy 注册大规模 hook 时,会浪费 dispatcher 调用预算。

---

## 5. 业务流程断点(用户视角的故事性 gap)

### 5.1 故事 1 — 团队管理员要禁止 LLM 自主执行 `git push`

- **claude-code 路径**:管理员在 `.claude/settings.json` 加:
  ```json
  { "hooks": { "PreToolUse": [{"matcher": "Bash", "hooks": [
    {"type": "command", "command": "echo '{\"decision\":\"block\",\"reason\":\"git push 必须人工\"}'", "if": "Bash(git push *)"}
  ]}] } }
  ```
  hook 在每个 git push 前阻断,LLM 立刻拿到 reason 重新规划。
- **nano-agent 路径**:**做不了**。原因:
  1. 没有 PreToolUse emit(§4.2 B-Hook-2)
  2. 没有 user 配置端点(§4.3 B-Hook-3)
  3. 没有 `if` permission-rule 表达力(§4.8 H-Hook-8)
  4. 即使能配,registry 没人 register(§4.1 B-Hook-1)

### 5.2 故事 2 — 在 tool 调用前注入额外 context

- **claude-code**:`hookSpecificOutput.additionalContext` 在 PreToolUse → 字符串注入到下一次 LLM prompt
- **nano-agent**:`HookOutcome.additionalContext` reducer 已实现(outcome.ts:88-90),但 PreToolUse 不 emit → **链路断在第一步**

### 5.3 故事 3 — auto-compact 之前先备份当前 workspace

- **claude-code**:PreCompact hook 跑 backup 命令,blocking 直到完成
- **nano-agent**:PreCompact 在 catalog 里(catalog.ts:112-117 `blocking: true`)但 `orchestration.ts:332-339` 的 compact 触发位点没有 `await this.deps.emitHook("PreCompact", ...)` → **必须在 HPX5 F3 旁边补一行**

### 5.4 故事 4 — turn 结束后跑 lint / test 验证

- **claude-code**:Stop hook + `decision: "block"` 让 LLM 修 lint 错误后再退出
- **nano-agent**:Stop emit 在 `shutdown.ts:97` 但是 **graceful shutdown** 路径,而不是 turn-end;并且 outcome 的 `block` action 在 catalog `Stop: { allowedOutcomes: ["diagnostics"] }`(catalog.ts:144-149)被 demote 为 continue → **永远阻塞不了**

### 5.5 故事 5 — 任意 tool 调用都发到 webhook 做合规审计

- **claude-code**:`type: "http", url: "https://compliance.corp/audit", allowedEnvVars: ["AUDIT_TOKEN"]`
- **nano-agent**:**做不了**。无 HTTP runtime(§4.4 H-Hook-4),无 user 配置端点。

---

## 6. API 是否能支撑当前 agent loop 循环 — 直接回答

> 业主问题:"我们的 API 是否可以支撑我们的整个 agent loop 循环?"

### 6.1 当前态(HPX5 已收口,HPX6 未收口)

**部分 yes,具体看维度**:

| Agent loop 维度 | 当前能否 | 备注 |
|---|---|---|
| Lifecycle anchor(start / first-prompt / end / shutdown) | ✅ Yes | 5 emit 全 live;audit + trace 写盘 |
| Tool 边界控制(PreToolUse / PostToolUse / blocking)| ❌ **No** | catalog 有,emit 0,registry 0 |
| Permission ask 自定义 | ❌ **No**(HP5 confirmation 走另一路径,与 hook 体系**未联通**)| `bash-core/permission.ts` 接口未注入 |
| Auto-compact 前后注入 | ⚠️ **Partial** | HPX5 F3 接通了 probe,但没 emit hook |
| 客户端可见的 hook 反馈 | ❌ **No** | `hook.broadcast` 帧 0 producer |
| 用户 / 租户 配置 hook | ❌ **No** | 0 endpoint,0 storage reader |
| 4 hook 类型(command/prompt/agent/http) | ❌ **No** | 0/4 实现 |
| 异步 hook(后台 + asyncRewake) | ❌ **No** | dispatcher 全同步 |
| 跨 worker emit(context-core / bash-core 触发 hook) | ❌ **No** | dispatcher 单 DO 实例,无 cross-worker bridge |

**总结**:**当前 hooks 系统能 cover "lifecycle anchor" 那一小角的可观察性需求(audit + trace),不能 cover "agent loop control plane" 这件事**。HPX5/HPX6 frozen 文档**完全没提 hooks**(action-plan grep `hook` 仅命中 deps name + scheduler.ts:54-58 注释),因此 hooks 在 hero-to-pro 收口时**仍然是 charter G7 + F12 的衍生留痕**,虽然 dispatcher 实例已注入,但事实上的产品价值 = 0。

### 6.2 与 charter 一致性

`docs/charter/plan-hero-to-pro.md:1089` HP5 closure gate:
> "F12 hook dispatcher closed" — 必须有 P1-10 cross-e2e 文件全绿。

**实际情况**:HP5 closure 通过了 dispatcher 实例注入这一极窄 gate(`runtime-assembly.ts:155-160` 实例化 + `runtime-mainline.ts:793-811` 接到 emit delegate);但**这是误以为 closed**,因为深层 wire-with-delivery 法律(charter §0.1 与 plan-hero-to-pro.md:305 反复强调"wire-without-delivery 不算闭合")没有被验证 — 没有真实 emit producer + 真实 register handler + 真实 e2e 闭环。本文 §4 的 8 个断点就是对 "F12 真接通" 的精确分解。

---

## 7. 推荐(若开 HPX7,该做什么 — 按 ROI 排序)

| 优先级 | 工作 | 估时 | 影响 | 关联代码位置 |
|--------|------|------|------|------------|
| **P0** | **emit PreToolUse / PostToolUse / PostToolUseFailure** | S | 让"hook 控制 tool"从 0 → 可用 | `runtime-mainline.ts:617-792` capability 块前后插 emit;outcome.blocked → throw 中断 capability execute |
| **P0** | **emit PreCompact / PostCompact** | XS | 让 hook 介入压缩决策 | `orchestration.ts:332-339` 加 emit;`workers/context-core/src/async-compact/events.ts:79` 真接 dispatcher |
| **P1** | **租户级 hooks_policy KV reader/writer + `/teams/{id}/hooks_policy` GET/PATCH** | M | 让 admin 第一次能配 hook(从 0 → mvp)| `packages/nacp-core/src/storage-law/constants.ts:23` 已预留 key;新建 facade route |
| **P1** | **registry register 路径 + DO storage 持久化(SESSION_HOOKS_CONFIG)** | M | 把 KV policy 在 session start 时 hydrate 到 registry | `runtime-assembly.ts:155-160` 改成读 KV → register;`snapshot.ts:30` 已支持 hibernate 持久化 |
| **P1** | **`http` runtime + SSRF guard + env-var 白名单**(走 service-binding 风格,但 transport = `fetch()`)| M | user-supplied hook 第一种类型 | 新建 `runtimes/http.ts`;借 Cloudflare `fetch` + 自实现 IP 解析 |
| **P2** | **`prompt` runtime(Workers AI binding)** | S | user-supplied hook 第二种类型 | 新建 `runtimes/prompt.ts`;复用 `runtime-mainline.ts` 的 LLM call helper |
| **P2** | **PermissionRequest / PermissionDenied 真接通** | M | confirmation 控制平面与 hooks 体系融合 | `workers/bash-core/src/permission.ts:56-60` 注入 dispatcher-backed 实现 |
| **P2** | **`hook.broadcast` 帧 producer**(在每次 dispatcher.emit 后 push 到 attached client) | XS | `session-ws-v1.md:67` 文档化的帧第一次上线 | `runtime-assembly.ts:354-432` emitHook 路径 + `pushServerFrameToClient` |
| **P3** | **async / asyncRewake**(需要 kernel runner 增加 wake-on-hook 入口) | L | 解锁长跑 hook(test runner / lint) | `kernel/runner.ts:412-436` 加 async branch + `AsyncHookRegistry` 移植 |
| **P3** | **`if` filter 升级为 permission-rule 语法**(`Bash(git *)` 等) | S | 大规模 hook 性能 | `matcher.ts:22-44` 加 `permissionRule` 类型 |
| **P3** | **`command` runtime via bash-core sandboxed exec** | M | 接住 claude-code shell hook 习惯 | 与 bash-core capability 共享 sandbox |
| **OOS** | SubagentStart / SubagentStop / TeammateIdle / TaskCreated / TaskCompleted | — | D4 charter 不做 subagent | 留 hero-to-platform |
| **OOS** | WorktreeCreate / WorktreeRemove / CwdChanged / FileChanged | — | workspace = R2,语义不对应 | 等 workspace 升级到 git-like 抽象再看 |

**最小补丁集(P0 only)**:估 1-2 个 sprint,不动协议,不引 user 配置,**只**让"PreToolUse/PostToolUse/PreCompact/PostCompact emit + dispatcher.emit 后真 push hook.broadcast 帧" — 立刻让 hooks 系统从 "0% 价值" 跳到 "agent loop 控制平面骨架" 状态,跟 hero-to-pro 阶段宣称的"成熟 LLM wrapper"对齐。

---

## 8. Trade-offs 与跨平台差异

### 8.1 Cloudflare Workers vs claude-code CLI 的根本差异

| 维度 | claude-code | nano-agent | 影响 hook 设计 |
|---|---|---|---|
| 运行环境 | local CLI(Node.js)| Cloudflare Workers(V8 isolate)| 无 child_process → command hook 必须改写;无 fs → SessionStart watchPaths 不适用 |
| 用户身份 | OS user(`~/.claude/`)| OAuth user + team(`teamUuid` + KV 命名空间)| settings.json → KV/D1;trust → bearer auth |
| 文件系统 | local fs(`pathExists`, watcher)| R2 + DO storage | FileChanged / WorktreeCreate 语义需重定义;workspace = R2 prefix |
| 外发网络 | 走系统 stack | Workers fetch(无默认 DNS)| http hook 要自实现 SSRF |
| 长跑任务 | 子进程后台 | DO alarm + Cloudflare Queue | async hook 要走 alarm/queue |

### 8.2 当前已有适配优势(借 nano-agent 的杠杆)

- **HPX6 计划的 Cloudflare Queue + DO alarm**(action-plan §1.2 Phase 4):本身就是 async hook 的天然底座 — 可以让 `async: true` hook 直接走 Queue producer,consumer 完成后通过 `session.followup_input` 帧触发 wake。
- **HPX6 新增 `nano_team_permission_rules` D1 表**(action-plan §1.2 Phase 3):可以无缝扩展为 `nano_team_hooks_config`,共用 admin 路径。
- **HPX5 emit-helpers + `pushServerFrameToClient` 已 live**:`hook.broadcast` 帧只需 5-10 行就能接通(`runtime-assembly.ts:354-432` 内 plug)。
- **NACP `hook.emit / hook.outcome` wire schemas 已注册**(`packages/nacp-core/src/messages/hook.ts`):跨 worker bridge 不需要新协议帧,直接复用。

---

## 9. 一句话收尾

nano-agent 已经把 hook 系统的**所有积木**搬到桌上(catalog / dispatcher / registry / runtimes / audit / broadcast / snapshot / wire schemas / 18 events),但**没有一个 user-facing 端点**、**没有一个 user-registered handler**、**14/18 事件 0 emit producer**;当前事实上的 hook 价值 = 5 个 lifecycle anchor 的 audit 写盘。**它不能撑起 hero-to-pro charter 宣称的"成熟 LLM wrapper 控制平面"**。HPX5/HPX6 频段没有触及这块,意味着这是 hero-to-pro 阶段最大的、未被 charter 显式承认的、wire-with-delivery 慢性 deferral。**charter G7 + F12 的"hook dispatcher 真接通"实际只完成了 dispatcher 实例化,深层 wire-with-delivery 8 项断点(本文 §4)仍待 HPX7 或 hero-to-platform 收口。**
