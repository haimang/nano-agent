# Nano-Agent 代码审查

> 审查对象: `zero-to-real 全阶段 + 6-worker 全量 + packages/ 全量`
> 审查类型: `code-review`
> 审查时间: `2026-04-29`
> 审查人: `DeepSeek`
> 审查范围:
> - `workers/agent-core/**` (2066 行 `nano-session-do.ts` + host/kernel/llm/eval/hooks 全部模块)
> - `workers/bash-core/**` (capability runtime + 21-command registry + executor)
> - `workers/context-core/**` (context assembly + async-compact + budget + inspector)
> - `workers/filesystem-core/**` (workspace + storage + backends)
> - `workers/orchestrator-core/**` (public facade 881 行 + user-do 2268 行 + session-truth 908 行)
> - `workers/orchestrator-auth/**` (auth service + repository + JWT + WeChat bridge)
> - `packages/jwt-shared/**`
> - `packages/orchestrator-auth-contract/**`
> - `packages/nacp-core/**` (envelope + transport + tenancy + evidence + messages)
> - `packages/nacp-session/**`
> - `packages/eval-observability/**` (DEPRECATED)
> - `packages/storage-topology/**` (DEPRECATED)
> - `packages/workspace-context-artifacts/**` (DEPRECATED)
> - `clients/api-docs/**`
> - `test/INDEX.md`
> - `scripts/deploy-preview.sh`
> 对照真相:
> - `docs/charter/plan-zero-to-real.md` (r2, 2026-04-24)
> - `docs/charter/plan-worker-matrix.md` (r2, 2026-04-23)
> - `docs/code-review/zero-to-real/ZX5-reviewed-by-GPT.md` (§6 修复后版本)
> - `docs/issue/zero-to-real/ZX5-closure.md`
> - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**:`zero-to-real 阶段的架构方向与 6-worker 拓扑总体成立，但当前实现存在 6 个 critical correctness 断点 (4 条运行时不工作 + 2 条部署不生效) 与大量 high-severity 语义漂移、事务安全、与错误处理缺口。ZX5 修复后的代码仍未完全解决 GPT R1/R2 所指出的 Lane F/E 闭合问题，且本轮独立发现了 3 个 GPT/GLM/kimi/Opus 四份审查均未覆盖的新的 correctness 层面缺陷。`
- **结论等级**:`changes-requested`
- **是否允许关闭本轮 review**:`no`
- **本轮最关键的 1-3 个判断**:
  1. `orchestrator-core/src/index.ts:430 的 needsBody 判定遗漏 5 条路由，导致 POST /messages、POST /resume、POST permission/decision、POST policy/permission_mode、POST elicitation/answer 的 request body 在到达 user-do 之前即被丢弃为 undefined，这些端点全部不可用—这是 correctness 级别的硬断点，四份既有审查均未发现。`
  2. `agent-core 的 hook.emit kernel delegate 是一个硬编码的 no-op 函数 (runtime-mainline.ts:296-298)；同时 onUsageCommit callback 从未被传入 createMainlineKernelRunner() (nano-session-do.ts:484-490)；EmitPermissionRequestAndAwait 与 emitElicitationRequestAndAwait 方法在整个代码库中零调用方。这意味着 Lane F 的 F1/F2/F3 并非仅是 "dispatcher wiring deferred"，而是整整 4 条调用链全部断开—closure 的 over-claim 程度比 GPT 审查指出的更严重。`
  3. `context-core 和 filesystem-core 的默认导出是 legacy { fetch } worker 对象而非 WorkerEntrypoint 类 (context-core/src/index.ts:123 / filesystem-core/src/index.ts:89)，导致所有定义的 RPC 方法在 Cloudflare Workers 运行时根本不可达—"6-worker topology with service binding RPC" 的叙事对这两个 worker 完全不成立。bash-core 与 orchestrator-auth 正确导出了 WorkerEntrypoint 类，形成了仓库内部的不一致。`

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/charter/plan-zero-to-real.md` — Z0-Z4 phase 目标、binding boundary、RPC rollout law、exit criteria
  - `docs/charter/plan-worker-matrix.md` — 6 worker charter-level 定位、absorption 完成态、binding matrix
  - `docs/code-review/zero-to-real/ZX5-reviewed-by-GPT.md` — GPT 5 finding + §6 Opus 修复回应
  - `docs/issue/zero-to-real/ZX5-closure.md` — ZX5 closure claims
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md` — 全阶段 closure claims
- **核查实现**:
  - 6 个 worker 的全部 `src/` 文件 (总计约 7000+ 行 TypeScript)
  - 7 个 package 的 `src/` 文件
  - 6 个 wrangler.jsonc 配置文件
  - `clients/api-docs/README.md`
  - `test/INDEX.md`
- **执行过的验证**:
  - 跨文件函数调用链追踪 (从路由定义 → 参数解析 → handler → DO → D1/KV/RPC)
  - `export default` 与 `WorkerEntrypoint` 继承链逐 worker 核对
  - 每一处 `@deprecated` 注释与对应 alias 活性交叉验证
  - `wrangler.jsonc` service bindings 与源码引用间的逐一对账
  - 全仓 `Record<string, unknown>` 类型安全隐患的抽样审计
- **复用 / 对照的既有审查**:
  - `docs/code-review/zero-to-real/ZX5-reviewed-by-GPT.md` — 独立复核了 GPT R1-R5 的所有 claim，认同其 R1/R2/R3 方向但不认同其"已部分修复"的评估，详见 §2 各 finding 的交叉引用
  - 本轮审查**不依赖** GPT/GLM/kimi 三份审查的任何 fact 声明；所有行号与代码事实均来自本人独立文件核查

### 1.1 已确认的正面事实

- `orchestrator-core` 是唯一 `workers_dev: true` 的公共 facade，其余 5 个 worker 均为 `workers_dev: false`，符合 charter §5.6 的 binding discipline
- `orchestrator-auth` 正确实现了 WorkerEntrypoint 导出与 8 个 RPC 方法，caller 严格限制为 `orchestrator-core` (errors.ts:29)，符合 charter Z1 "internal-only pure RPC" 要求
- `orchestrator-core/wrangler.jsonc` 的 service bindings 已 bind 全部 5 个其他 worker，binding matrix 完整
- `handleStart` 的 D1 conditional claim (`session-truth.ts:290-298`) 是正确的主线 idempotency guard
- D1 migrations 已形成 7 份文件 (identity core / session truth / usage / devices 等)，覆盖 Z1-Z3 的持久化需求
- `packages/jwt-shared` 已创建并作为 `orchestrator-core` 与 `orchestrator-auth` 的共享 HMAC JWT 基础层
- `facade-http.ts` 的 compile-time guard `_rpcErrorCodesAreFacadeCodes` (line 111-114) 真实有效，契约对齐可验证
- ZX5 Lane D 的产品面 (`/messages`, `/files`, `/me/conversations`, `/me/devices*`) 代码实现已存在
- 全仓测试矩阵 (unit + e2e) 组织完整，root guardians + cross-e2e 提供了良好的回归保护

### 1.2 已确认的负面事实

- **C1 (needsBody 断点)**:`orchestrator-core/src/index.ts:430` 的 `needsBody` 判定语句 `route.action === "start" || route.action === "input" || route.action === "cancel" || route.action === "verify"` 未包含 `messages`、`resume`、`permission/decision`、`policy/permission_mode`、`elicitation/answer` 五条路由，导致这些 POST 端点的 request body 在 `index.ts:431` 被赋值为 `null`，然后在 `index.ts:439` 作为 `undefined` (因为 `body === null`) 传入 DO。user-do.ts 内各 handler 的 guard: `if (!body || ...)` -> 永为真 -> 返回 400。五个端点不可用。
- **C2 (hook emit 硬编码 no-op)**:`agent-core/src/host/runtime-mainline.ts:296-298` 中 `hook: { async emit(_event: string, _payload: unknown) { return undefined; } }` 是一个无条件 no-op delegate。kernel runner 的 `handleHookEmit()` (runner.ts:413-436) 即便被执行也会走到这个空实现，hook 事件永远无法从 kernel run loop 发出。
- **C3 (onUsageCommit 未接线)**:`agent-core/src/host/do/nano-session-do.ts:484-490` 的 `createLiveKernelRunner()` 调用 `createMainlineKernelRunner()` 时未传递 `onUsageCommit` 参数。该 callback 在 `runtime-mainline.ts:246,329` 是 LLM/tool quota commit 后推 `session.usage.update` server frame 的唯一出口，未被接线意味着 ZX5 Lane F3 完全不成立。
- **C4 (Permission/Elicitation wait-and-resume 完全孤立)**:`emitPermissionRequestAndAwait` (nano-session-do.ts:785)、`emitElicitationRequestAndAwait` (nano-session-do.ts:805) 在全代码库中零调用方；同时两个方法内的 WS frame emit 代码被注释为 void (line 795-796)；只留下 `awaitAsyncAnswer` 的超时等待+storage 读写基础设施 (line 709-760) 完整但永不被触发。
- **C5 (context-core/filesystem-core RPC 不可达)**:`workers/context-core/src/index.ts:123` 与 `workers/filesystem-core/src/index.ts:89` 的默认导出为 `export default worker`，其中 `worker` 是 trace 对象 `{ fetch }`，而非 `ContextCoreEntrypoint extends WorkerEntrypoint` 或 `FilesystemCoreEntrypoint extends WorkerEntrypoint` 类。Cloudflare Workers 部署默认导出；因此这两个 worker 的 `contextOps()`、`filesystemOps()`、`assemblerOps()` 等 RPC 方法在运行时不暴露，service binding 调用方只能拿到 `{ fetch }` 而非 RPC 方法。
- **C6 (kernel scheduler 无 hook_emit 决策)**:`agent-core/src/kernel/scheduler.ts:27-68` 的 `scheduleNextStep()` 仅产生 `wait` / `compact` / `tool_exec` / `llm_call` / `finish` 五种决策；类型定义 `types.ts:62` 中的 `"hook_emit"` 从未被任何代码路径生成。即使 hook.emit delegate 被修复，整个 hook-dispatch pipeline (scheduler → runner → delegate) 也无法激活。
- **H1 (D1 先写后验)**:`user-do.ts:1505-1534` 的 `handleMessages` 在 D1 中写入 `ensureDurableSession` + `createDurableTurn` + `recordUserMessage` + `appendDurableActivity` 后才调用 `forwardInternalJsonShadow` (line 1552)。若 agent-core RPC 失败 (line 1566)，只有 turn 被标记为 `'failed'` — 已写入的 message 和 activity 行变为孤儿数据。
- **H2 (/me/conversations D1-only)**:`user-do.ts:1798-1891` 的 `handleMeConversations` 仅读取 D1 (`listSessionsForUser`)，绝不查询 KV 的热索引。同一用户 DO 内 `handleMeSessions` (line 1726) 却同时合并 KV 和 D1。若 session 信息仅存在于 KV (如未迁移到 D1 的旧 session)，`/me/conversations` 将静默丢失这些对话。
- **H3 (alarm 无 try/catch)**:`user-do.ts:136-141` 的 `alarm()` 方法未包裹 `try/catch`。若 `trimHotState`、`cleanupEndedSessions`、或 `expireStalePendingSessions` 任一抛出，`ensureHotStateAlarm` 不会被调用，该 DO 实例的 alarm 链永久断裂。
- **H4 (void promise rejection)**:`user-do.ts:1977,1981` 的 `bindSocketLifecycle` 使用 `void this.markDetached(...)` 和 `void this.touchSession(...)`。若这些 KV 写操作失败，错误被静默吞没，客户端 attachment 状态与 DO 内部 map 可能永久不同步。
- **H5 (orchestrator-auth 错误逃逸)**:`orchestrator-auth/src/errors.ts:35-40` 的 `normalizeKnownAuthError` 对非 `AuthServiceError` 异常执行 `throw error`，而 `index.ts:47-58` 的 `invokeKnown` wrapper 同样仅 catch `AuthServiceError`。D1 数据库错误、Zod parse 错误、crypto 错误等全部会逃逸为未包装的原始异常，破坏 auth envelope 体系。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 逐文件核对调用链、路由定义、导出签名，所有 finding 均有精确行号 |
| 跨文件调用链追踪 | `yes` | 对每条关键路径做了路由→解析→handler→DO→持久化/网络的完整回溯 |
| schema / contract 反向校验 | `yes` | 核对了 facade-http 与 nacp-core 的 ErrorCode 一致性、auth contract 的接口符合性 |
| wrangler.jsonc 配置对账 | `yes` | 逐 worker 核对了 service bindings、secrets、vars 与源码引用间的缺口 |
| live / deploy / preview 证据 | `no` | 未执行 live deploy 验证；所有判断基于代码静态分析 |
| 与上游 design / charter 对账 | `yes` | 逐条对照 plan-zero-to-real.md 和 plan-worker-matrix.md 的 in-scope/boundary/exit criteria |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | `needsBody` 判定遗漏 5 条路由导致请求体被丢弃 | `critical` | `correctness` | `yes` | 将 `messages/resume/permission/decision/policy/permission_mode/elicitation/answer` 纳入 needsBody |
| R2 | hook.emit kernel delegate 为硬编码 no-op | `critical` | `correctness` | `yes` | 定义真实 hook dispatch delegate 或在 closure 中诚实标注为 "missing, not deferred" |
| R3 | onUsageCommit callback 未被传入 createMainlineKernelRunner | `critical` | `correctness` | `yes` | 在 `createLiveKernelRunner()` 中传入真实的 `onUsageCommit` handler |
| R4 | Permission/Elicitation wait-and-resume infra 完全孤立 | `critical` | `delivery-gap` | `yes` | 补 dispatcher 接线并 emit 真实 WS frame；或从 closure 中移除 "infra landed" 声明 |
| R5 | context-core / filesystem-core 默认导出非 WorkerEntrypoint | `critical` | `platform-fitness` | `yes` | 将默认导出改为 ContextCoreEntrypoint / FilesystemCoreEntrypoint 类 |
| R6 | kernel scheduler 无 hook_emit 决策生成路径 | `critical` | `correctness` | `yes` | 在 scheduler 中添加 hook_emit 决策产生逻辑或在 closure 中声明为整套未来工作 |
| R7 | D1 先写后验导致 RPC 失败时产生孤儿数据 | `high` | `correctness` | `yes` | 将 D1 写入移至 RPC forward 成功之后，或添加失败回滚逻辑 |
| R8 | `/me/conversations` D1-only 读取忽略 KV 热索引 | `high` | `correctness` | `yes` | 合并 KV 索引或明确声明 `handleMeConversations` 仅覆盖 D1 已迁移数据 |
| R9 | alarm() 无 try/catch 可能导致 alarm 链永久断裂 | `high` | `correctness` | `yes` | 在 alarm() 内部各步骤加入 try/catch 保护 |
| R10 | socket lifecycle 的 KV 写使用 void 吞没错误 | `high` | `correctness` | `no` | 改为 `.catch()` 或 await + warn 模式 |
| R11 | orchestrator-auth 非 AuthServiceError 逃逸 envelope 体系 | `high` | `security` | `no` | 在 invokeKnown 中增加通用错误→envelope 包装 |
| R12 | `inferMessageRole` 使用精确匹配导致新 message kind 被误标 | `medium` | `correctness` | `no` | 改为 `kind.startsWith('user.input')` |
| R13 | `recordStreamFrames` KV/D1 写入顺序缺少事务保护 | `medium` | `correctness` | `no` | 添加补偿逻辑或先写 D1 再同步 KV |
| R14 | `expires_in` 字段硬编码与 JWT `exp` 可能不一致 | `medium` | `protocol-drift` | `no` | 从 JWT claims 中计算真实 expires_in |
| R15 | `last_seen_at` 字段跨端点语义不一致 | `medium` | `protocol-drift` | `no` | 统一为 "最近活动时间" 或拆分为两个独立字段 |
| R16 | D1 device revoke 使用非原子 batch() | `medium` | `correctness` | `no` | 添加 batch 失败补偿或使用 D1 transaction |
| R17 | agent-core `R2_ARTIFACTS`/`KV_CONFIG` 为 required 类型但无 wrangler 绑定 | `medium` | `platform-fitness` | `no` | 改为 optional 类型或在 wrangler.jsonc 中添加对应配置 |
| R18 | `forwardInternalJson` 为死代码 | `low` | `scope-drift` | `no` | 添加 `@deprecated` 标记并计划删除 |
| R19 | `streamSnapshot` RPC 方法定义但无调用方 | `low` | `scope-drift` | `no` | 添加 consumer 或标记为 reserved |
| R20 | `handleResume` 为只读 stub，不重连 WS 不更新状态 | `low` | `delivery-gap` | `no` | 补全 resume 行为或明确标注为 future |
| R21 | orchestrator-auth / jwt-shared 缺少 README | `low` | `docs-gap` | `no` | 补最小 README |
| R22 | `checkpointOnTurnEnd` 配置标志从未被消费 | `low` | `scope-drift` | `no` | 移除标志或实现对应行为 |
| R23 | jwt-shared `verifyJwt` 未使用 `JWT_LEEWAY_SECONDS` | `low` | `correctness` | `no` | 在 exp 检查中减去 leeway，或将常量重命名 |

### R1. `needsBody` 判定遗漏 5 条路由导致请求体被丢弃

- **严重级别**:`critical`
- **类型**:`correctness`
- **是否 blocker**:`yes`
- **事实依据**:
  - `workers/orchestrator-core/src/index.ts:429-431`: `const optionalBody = route.action === "cancel"; const needsBody = route.action === "start" || route.action === "input" || route.action === "cancel" || route.action === "verify"; const body = needsBody ? await parseBody(request, optionalBody) : null;`
  - `workers/orchestrator-core/src/index.ts:431`: 当 `needsBody === false` 时 `body = null`
  - `workers/orchestrator-core/src/index.ts:439`: `body: body === null ? undefined : JSON.stringify({...})`
  - 上述逻辑导致 `messages`/`resume`/`permission/decision`/`policy/permission_mode`/`elicitation/answer` 五条 POST 路由的请求体被丢弃
  - `workers/orchestrator-core/src/user-do.ts:258-263`: `handleMessages` 以 `if (!body || !sessionUuid) { return ...400... }` 开头，证实会被 400 拦截
  - `workers/orchestrator-core/src/user-do.ts:224-230`、`234-240`、`244-250`: `handlePermissionDecision`、`handlePolicyPermissionMode`、`handleElicitationAnswer` 同样以 body 非空检查开头
  - 该缺陷存在于 ZX5 review 修复之后仍未被修正
- **为什么重要**:
  - 这不是 "Z5 产品面未完成" 的问题，而是**已完成的代码实现被路由层的参数解析错误直接短路**
  - `/messages` 是 ZX5 Lane D3 的核心 product surface；被此缺陷影响后完全不可用
  - 当前 `pnpm test:contracts` 的 root guardians (全绿 31/31) 并未包含对这些路由的 contract-level 测试
- **审查判断**:
  - 这是一个**实现级 correctness 断点**，不属于 deferred 或 scope 扩张问题
  - GPT R1-R5 审查、deepseek R1-R8 审查、GLM R1-R12 审查、kimi R1-R10 审查**均未发现此问题**，说明四份审查均未做 "路由定义 ↔ 参数解析 ↔ handler guard" 的三层调用链对账
- **建议修法**:
  - 将 `needsBody` 条件扩展为包含全部需要 request body 的 action，或反向定义为 "only health/ws/catalog 不需要 body"
  - 补一条 root e2e 或 orchestrator-core unit test 验证 POST 路由的 body 传透性

### R2. hook.emit kernel delegate 为硬编码 no-op

- **严重级别**:`critical`
- **类型**:`correctness`
- **是否 blocker**:`yes`
- **事实依据**:
  - `workers/agent-core/src/host/runtime-mainline.ts:295-298`:
    ```ts
    hook: {
        async emit(_event: string, _payload: unknown) {
            return undefined;
        },
    },
    ```
  - 该 delegate 在 `createMainlineKernelRunner` 内部作为 `KernelRunner` 构造参数传入
  - `workers/agent-core/src/kernel/runner.ts:413-436` 的 `handleHookEmit` 调用 `this.delegates.hook.emit(decision.event, {})` — 但由于 delegate 为 no-op，无论 emit 被调用多少次都不会产生任何效果
  - GPT R1 指出的 Lane F "仍在 infra seam" 实际上低估了问题：不仅 wiring 未完成，**连 wiring 的起点 (delegate) 本身都是假的**
- **为什么重要**:
  - 整个 kernel run loop 内的 hook dispatch 路径从 delegate 层就注定了不可用
  - ZX5 closure 将 hook infra 描述为 "wait-and-resume infra land, hook dispatcher integration deferred"，但实际上**没有 deferred hook dispatcher integration 可以接上**，因为 `hook.emit` 本身需要一个真实实现作为对接目标
- **审查判断**:
  - 这个问题比 R4 (Permission/Elicitation orphan) 更深层：它不是缺少调用方，而是缺少**可调用对象**
  - 即使用 ZX5 closure 的 "infra landed" 标准，也应该要求 hook.emit delegate 至少是一个真实 stub (如 log/warn 或 emit to eval sink)，而非无条件返回 undefined
- **建议修法**:
  - 将 hook.emit delegate 改为至少 emit 到 `runtimeEvents` event emitter 或 console.warn 的可观测实现
  - 在 closure 中明确标注 hook.emit delegate 的当前状态为 "placeholder no-op for all 19 hook events"

### R3. onUsageCommit callback 未被传入 createMainlineKernelRunner

- **严重级别**:`critical`
- **类型**:`correctness`
- **是否 blocker**:`yes`
- **事实依据**:
  - `workers/agent-core/src/host/do/nano-session-do.ts:481-490`:
    ```ts
    private createLiveKernelRunner() {
        const runtimeEnv = this.env as Partial<SessionRuntimeEnv> | undefined;
        if (!runtimeEnv?.AI) return null;
        return createMainlineKernelRunner({
            ai: runtimeEnv.AI,
            quotaAuthorizer: this.quotaAuthorizer,
            capabilityTransport: this.getCapabilityTransport(),
            contextProvider: () => this.buildQuotaContext(),
            anchorProvider: () => this.buildCrossSeamAnchor(),
        });
    }
    ```
  - `MainlineKernelOptions.onUsageCommit` 在 `runtime-mainline.ts:108-113` 定义为可选回调，在 `line 246,329` 两处被调用
  - NanoSessionDO 创建 kernel runner 时未传入此回调
  - GPT R1 指出了 "F3 callback contract land, emitServerFrame wiring deferred" — 但这是**callback 未被注册**的问题，不是 "contract 已成立但 wiring deferred"
- **为什么重要**:
  - `session.usage.update` server frame 是 ZX5 Lane F3 的核心交付物
  - 即使 quota commit 正常发生 (runtime-mainline.ts 内的 quota trackAndDeduct)，客户端也永远不会收到 usage push
  - 这不是 wiring 问题：`createLiveKernelRunner` 是唯一创建 kernel runner 的地方，只需加一行参数即可引入 callback
- **审查判断**:
  - 这个问题比 GPT R1 描述的 "wiring deferred" 更简单也更容易修复：它是单一函数调用的遗漏，不涉及 kernel 改造
  - 当前 closure 的 "callback land" 表述过度——callback 的类型定义存在于 interface 中，但 callback **未被实例化**
- **建议修法**:
  - 在 `createLiveKernelRunner()` 中添加 `onUsageCommit: (event) => this.emitUsageUpdate(event)` 并实现 `emitUsageUpdate`
  - 补一条 root e2e 验证 usage commit → server frame 的推流路径

### R4. Permission/Elicitation wait-and-resume infra 完全孤立

- **严重级别**:`critical`
- **类型**:`delivery-gap`
- **是否 blocker**:`yes`
- **事实依据**:
  - 全代码库搜索 `emitPermissionRequestAndAwait`、`emitElicitationRequestAndAwait` — **零调用方**
  - `nano-session-do.ts:792-796` 的 WS frame emit 代码注释为 `void this.sessionUuid;` + `const helper = this.getWsHelper?.bind(this); void helper;` — 非但无 WS frame emit，连 helper 实例都未获取
  - 依赖链：
    - `emitPermissionRequestAndAwait` / `emitElicitationRequestAndAwait` (无调用方)
    - → `awaitAsyncAnswer` (无调用方)
    - → `deferredAnswers` Map (始终为空)
    - → `sweepDeferredAnswers` (由 alarm 调用，但 map 为空)
    - → `handlePermissionDecisionRecord` / `handleElicitationAnswerRecord` (HTTP 路径可达，写 storage 后无人等待)
  - ZX5 closure 称 "F1/F2 wait-and-resume infra land" — 这些方法确实存在，但**完整的 wait-and-resume 闭环从未被触发过**
- **为什么重要**:
  - 这不是 "deferred wiring"：缺少的不是调用入口，而是**从 hook 触发到 waiter 注册的整个上游调用链**
  - 如果基础设施已成立，最少需要一条 `this.emitPermissionRequestAndAwait(...) await` 的调用路径作为 proof
- **审查判断**:
  - 当前状态更准确的描述是："Permission/Elicitation round-trip **contract + storage infra** exists, but zero runtime activation path"
  - 与 GPT R1 的判断一致，但本轮补充了四条审查均未指出的：**两个 emit 方法的 WS frame emit 代码本身就是 stub**
- **建议修法**:
  - 至少补一条调用路径 (如 hook.emit → emitPermissionRequestAndAwait → awaitAsyncAnswer → resolveDeferredAnswer 的烟火测试)
  - 或在 closure 中将 infra 状态从 "landed" 降级为 "contract + storage helper defined, never activated"

### R5. context-core / filesystem-core 默认导出非 WorkerEntrypoint

- **严重级别**:`critical`
- **类型**:`platform-fitness`
- **是否 blocker**:`yes`
- **事实依据**:
  - `workers/context-core/src/index.ts:120-123`: 定义 `ContextCoreEntrypoint extends WorkerEntrypoint<ContextCoreEnv>` 包含 `probe()`、`nacpVersion()`、`contextOps()`、`assemblerOps()` 四个 RPC 方法，但文件末尾 `export default worker` 导出的是 `{ fetch }` trace 对象
  - `workers/filesystem-core/src/index.ts:86-89`: 定义 `FilesystemCoreEntrypoint extends WorkerEntrypoint<FilesystemCoreEnv>` 包含 `probe()`、`nacpVersion()`、`filesystemOps()` 三个 RPC 方法，但末尾 `export default worker` 同样导出 trace 对象
  - Cloudflare Workers 运行时使用默认导出作为 worker entry；只有 `WorkerEntrypoint` (及 `DurableObject`) 子类才拥有 RPC 方法暴露语义
  - 对比 `workers/orchestrator-auth/src/index.ts:61` (`export default class OrchestratorAuthEntrypoint extends WorkerEntrypoint`) 和 `workers/bash-core/src/index.ts:486` (`export default class BashCoreEntrypoint extends WorkerEntrypoint`) — 这两者是正确的
  - GPT R2 指出 "Lane E 仍是 minimal RPC seam"，但未发现**这个 seam 根本就不在运行时暴露**
- **为什么重要**:
  - plan-worker-matrix.md §11.1 (P3/P4 closure 2026-04-23) 声言 "library worker RPC seam land" — 但如果 RPC 方法在运行时不可达，则 library worker 对 caller (orchestrator-core 或 agent-core) 暴露的仅是 health probe 的 fetch 路径
  - `orchestrator-core/wrangler.jsonc` 已 bind `CONTEXT_CORE` → `nano-agent-context-core` 和 `FILESYSTEM_CORE` → `nano-agent-filesystem-core` — service binding 本身存在，但绑定目标不暴露 RPC 方法
  - 这意味着 6-worker topology 的 "所有 worker 通过 service binding + RPC 互联" 叙事对 context/filesystem 两个 worker 完全不成立
- **审查判断**:
  - 这是一个**部署层面**的 correctness issue，与代码逻辑正确性无关但与**运行时可达性**直接相关
  - 其根源可能是 worker-matrix 的 conservative-first 策略 (Q3/Q4 host-local posture) 导致 context-core/filesystem-core 被有意保持为 fetch-only 部署，但代码层却添加了 RPC 方法定义
- **建议修法**:
  - 二选一：
  - 1. 将默认导出改为 `export default ContextCoreEntrypoint` / `export default FilesystemCoreEntrypoint` (若 RPC seam 确实应该生效)
  - 2. 移除 `WorkerEntrypoint` 继承和 RPC 方法定义，保留 fetch-only 壳 (若坚持 host-local posture)

### R6. kernel scheduler 无 hook_emit 决策生成路径

- **严重级别**:`critical`
- **类型**:`correctness`
- **是否 blocker**:`yes`
- **事实依据**:
  - `workers/agent-core/src/kernel/scheduler.ts:27-68` 的 `scheduleNextStep()` 函数仅生成五种决策: `wait` / `compact` / `tool_exec` / `llm_call` / `finish`
  - `workers/agent-core/src/kernel/types.ts:62` 的 `KernelDecision` 类型联合包含 `{ readonly kind: "hook_emit" }`
  - `workers/agent-core/src/kernel/runner.ts:413-436` 的 `handleHookEmit` 方法完整实现了 hook emit 的处理流程
  - 但 scheduler 从不产生 `hook_emit` 决策 → runner 的 handleHookEmit 永远不被调用 → delegate hook.emit (即便是真实实现) 永远不被触发
- **为什么重要**:
  - 这使 hook dispatch 在 kernel 层形成了一个完整但无法到达的死胡同：types → runner → delegate 全部存在，但 scheduler 这个唯一的决策入口从未触发 hook 路径
  - 与 R2 (no-op delegate) 结合，形成双重阻断
- **审查判断**:
  - 这是一个设计层面的 gap：scheduler 的决策类型扩展 `hook_emit` 在 types 层已定义，但在 scheduler 实现层从未落地
- **建议修法**:
  - 在 scheduler 中根据 session state 中的 pending hook events 生成 `hook_emit` 决策
  - 或从 `KernelDecision` union 中移除 `hook_emit`，并标记为 "future extension point"

### R7. D1 先写后验导致 RPC 失败时产生孤儿数据

- **严重级别**:`high`
- **类型**:`correctness`
- **是否 blocker**:`yes`
- **事实依据**:
  - `workers/orchestrator-core/src/user-do.ts:1505-1534`: `handleMessages` 按顺序执行: `ensureDurableSession` → `createDurableTurn` → `recordUserMessage` → `appendDurableActivity` (全部写入 D1)
  - `workers/orchestrator-core/src/user-do.ts:1552`: 然后调用 `forwardInternalJsonShadow`
  - `workers/orchestrator-core/src/user-do.ts:1566`: 若 `inputAck.response.ok === false`，仅将 turn 标记为 `'failed'` (line 1578)
  - message 和 activity 行**从未被回滚**
  - `handleStart` (line 827-885) 有显式的 `rollbackSessionStart` 保护，但 `handleMessages` 缺少对等保护
- **为什么重要**:
  - 每次 agent-core RPC 失败都会在 D1 中留下不可达的 message 和 activity 行
  - 这些行不会在任何 session history 查询中显示 (因为 turn 是 failed)，但占用存储并污染数据
- **审查判断**:
  - 这是一个**事务完整性**问题，不是 scope issue
- **建议修法**:
  - 添加 `handleMessages` 的失败回滚逻辑，或改为 "先 forward → 成功后写入 D1" 的顺序

### R8. `/me/conversations` D1-only 读取忽略 KV 热索引

- **严重级别**:`high`
- **类型**:`correctness`
- **是否 blocker**:`yes`
- **事实依据**:
  - `workers/orchestrator-core/src/user-do.ts:1798-1891` 的 `handleMeConversations` 完全通过 `repo.listSessionsForUser(...)` (D1) 查询
  - 同文件 `handleMeSessions` (line 1726) 采用 KV+D1 双源合并策略
  - 用户 DO 的 KV 是 session 的 hot index (token → sessionEntry mapping)，包含不可变的 `started_at`、status 等信息
  - 若 session 仅存在于 KV 而 D1 中未迁移，`/me/conversations` 会静默丢失该 session
- **为什么重要**:
  - 这造成 `/me/sessions` 和 `/me/conversations` 看到不同的数据集
  - plan-zero-to-real §1.5 要求 "real loop 可持久、可回看" — 数据丢失直接违反此要求
- **审查判断**:
  - 这是实现遗漏而非设计决定
- **建议修法**:
  - 在 `handleMeConversations` 中纳入 KV 索引合并逻辑，与 `handleMeSessions` 保持一致

### R9. alarm() 无 try/catch 可能导致 alarm 链永久断裂

- **严重级别**:`high`
- **类型**:`correctness`
- **是否 blocker**:`yes`
- **事实依据**:
  - `workers/orchestrator-core/src/user-do.ts:136-141`:
    ```ts
    async alarm() {
        await this.trimHotState();
        await this.cleanupEndedSessions();
        await this.expireStalePendingSessions();
        await this.ensureHotStateAlarm();
    }
    ```
  - 任何一个步骤抛出异常，`ensureHotStateAlarm()` 不被调用
  - DO alarm 不会自动重试失败的 alarm handler — 下次触发需人工干预或 redeploy
- **为什么重要**:
  - 一次 transient error (D1 timeout, KV 限流) 即可永久禁用该 DO 的 GC 机制
- **审查判断**:
  - 这是最基本的 DO alarm 编程模式错误
- **建议修法**:
  - 每个步骤包裹 try/catch，在 finally 块中调用 `ensureHotStateAlarm()`

### R10. socket lifecycle 的 KV 写使用 void 吞没错误

- **严重级别**:`high`
- **类型**:`correctness`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/orchestrator-core/src/user-do.ts:1977` `void this.markDetached(sessionUuid, timestamp)`
  - `workers/orchestrator-core/src/user-do.ts:1981` `void this.touchSession(sessionId, timestamp)`
  - KV 写入失败时错误被静默丢弃；attachment map 可能显示客户端仍连接
- **为什么重要**:
  - 在 WebSocket 断线场景下，错误的 attachment state 会导致 server frame 推送到不存在的连接
- **审查判断**:
  - 应改为非静默的错误处理
- **建议修法**:
  - 改为 `.catch((err) => console.warn(...))` 或使用 `await`

### R11. orchestrator-auth 非 AuthServiceError 逃逸 envelope 体系

- **严重级别**:`high`
- **类型**:`security`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/orchestrator-auth/src/errors.ts:35-40`: `normalizeKnownAuthError` 仅包装 `AuthServiceError`，对其它异常 `throw error`
  - `workers/orchestrator-auth/src/index.ts:47-58`: `invokeKnown` 同样仅 catch `AuthServiceError`
  - `AuthErrorCodeSchema` (orchestrator-auth-contract) 不包含 `"internal-error"` 错误码
  - D1 错误、crypto 错误等会以原始异常形式到达 WorkerEntrypoint 的 RPC 层，暴露内部堆栈
- **为什么重要**:
  - 对于 internal-only worker 这不会泄漏到客户端，但破坏了 internal RPC 的错误契约一致性
- **审查判断**:
  - 这是防御性编程的缺口
- **建议修法**:
  - 在 `invokeKnown` 中添加通用 catch 包装为 `internal-error` envelope

### R12. `inferMessageRole` 使用精确匹配导致新 message kind 被误标

- **严重级别**:`medium`
- **类型**:`correctness`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/orchestrator-core/src/session-truth.ts:95`: `return kind === "user.input" ? "user" : "system";`
  - ZX5 新增的 message kind 包括 `"user.input.text"` 和 `"user.input.multipart"` — 均不会被此函数识别为 `"user"`
  - `user-do.ts:400` 的正确实现 `kind.startsWith('user.input') ? 'user' : 'system'` 证明了期望的匹配逻辑
  - 此函数被 `appendStreamEvent` (session-truth.ts:609) 使用，影响 stream event 的 role 标注
- **为什么重要**:
  - 用户发起的 stream event 会在 D1 中被标记为 `"system"` 角色，破坏 audit 语义
- **审查判断**:
  - 这是 ZX5 新增 message kind 时的同步遗漏
- **建议修法**:
  - 改为 `kind.startsWith('user.input')`

### R13. `recordStreamFrames` KV/D1 写入顺序缺少事务保护

- **严重级别**:`medium`
- **类型**:`correctness`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/orchestrator-core/src/user-do.ts:417-420`: 先写 KV (`put(recentFramesKey...)`)
  - `workers/orchestrator-core/src/user-do.ts:426-468`: 再循环写 D1
  - 若 D1 写入中途失败，KV 已更新但 D1 只写入了部分行
- **为什么重要**:
  - KV 和 D1 之间无事务保证，导致 hot (KV) 与 durable (D1) 状态不一致
- **审查判断**:
  - 轮当前不预期在高频率 stream 场景触发，但随着系统负载增加会暴露
- **建议修法**:
  - 添加补偿逻辑：D1 写入失败后重置 KV 到写入前状态

### R14. `expires_in` 字段硬编码与 JWT `exp` 可能不一致

- **严重级别**:`medium`
- **类型**:`protocol-drift`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/orchestrator-auth/src/service.ts:146,256`: `expires_in: 3600` 硬编码
  - 实际 JWT `exp` 由 `mintAccessToken` 内部设置 — 若未来修改 JWT 有效期而忘记同步 `expires_in`，客户端将获得错误信息
- **为什么重要**:
  - 客户端依赖 `expires_in` 来决定何时刷新 token，错误值导致不必要的 refresh 或过早放弃
- **审查判断**:
  - 实现级别的代码重复问题
- **建议修法**:
  - 从 `mintAccessToken` 返回的 claims 中提取真实 `exp` 并计算 `expires_in`

### R15. `last_seen_at` 字段跨端点语义不一致

- **严重级别**:`medium`
- **类型**:`protocol-drift`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/orchestrator-core/src/user-do.ts:1835-1843`: `/me/conversations` 中 `last_seen_at = latest_session_started_at`
  - 其它地方 (SessionEntry, handleMeSessions, touchSession): `last_seen_at` 含义为 "KV entry 最后更新/触碰时间"
  - ZX5 review GPT R4 指出此问题并追加了 `latest_session_started_at` 字段 — 但 `last_seen_at` 作为 legacy alias 语义仍与其它端点不同
- **为什么重要**:
  - 同一字段名在不同端点含义不同，前端消费时需要额外判断
- **审查判断**:
  - GPT R4 修复已部分解决，但 alias 的存在延长了语义分裂
- **建议修法**:
  - 在 `/me/conversations` 中不再返回 `last_seen_at`，仅返回语义明确的 `latest_session_started_at`

### R16. D1 device revoke 使用非原子 batch()

- **严重级别**:`medium`
- **类型**:`correctness`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/orchestrator-core/src/index.ts:775-789`: D1 `db.batch()` 包含 UPDATE + INSERT 两条语句
  - D1 batch 不提供事务保证 — UPDATE 可能成功但 INSERT 失败
- **为什么重要**:
  - 设备被撤销 (UPDATE) 但审计行缺失 (INSERT)，破坏 audit completeness
- **审查判断**:
  - 影响限于 audit 完整性，不影响 security enforcement
- **建议修法**:
  - 添加 batch 失败后的错误处理日志，或在第二 PR 中迁移为 D1 transaction

### R17. agent-core `R2_ARTIFACTS`/`KV_CONFIG` 为 required 类型但无 wrangler 绑定

- **严重级别**:`medium`
- **类型**:`platform-fitness`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/agent-core/src/host/env.ts:59-61`: `SessionRuntimeEnv` 定义 `R2_ARTIFACTS: unknown` 和 `KV_CONFIG: unknown` 为 required
  - `workers/agent-core/wrangler.jsonc`: 无 `r2_buckets` 或 `kv_namespaces` 配置
  - 类型标注与实际部署环境不符
- **为什么重要**:
  - 类型系统与运行时环境不一致，长期积累后部署会神秘失败
- **审查判断**:
  - 这是类型卫生问题
- **建议修法**:
  - 改为 `optional` 类型或补齐 wrangler.jsonc 中的绑定配置

### R18-R23. 低严重级别发现

- **R18** `forwardInternalJson` 死代码 (`user-do.ts:2077-2084`): 方法定义但从未被调用，所有 RPC 转发走 `forwardInternalJsonShadow`。建议标记 `@deprecated`。
- **R19** `streamSnapshot` RPC 无调用方 (`orchestrator-core/src/index.ts:40`): `AgentRpcMethod` 类型定义了 `streamSnapshot?` 但没有 consumer 使用。建议添加 RPC consumer 或从类型中移除。
- **R20** `handleResume` 为只读 stub (`user-do.ts:1250-1272`): 返回 ack 但不更新状态/重连 WS。建议补全或明确标注为 deferred。
- **R21** `orchestrator-auth`/`jwt-shared` 缺少 README: 这两者在仓库中无 README 文件，但前者是核心 auth worker、后者是共享 JWT 基础层。建议补最小 README。
- **R22** `checkpointOnTurnEnd` 永不消费 (`env.ts:153,166`): 配置标志定义为 `true` 但 `SessionOrchestrator` 永不在 turn 结束时调用 checkpoint。建议移除标志或实现行为。
- **R23** `JWT_LEEWAY_SECONDS` 未用于 exp 检查 (`jwt-shared/src/index.ts:48,145`): `JWT_LEEWAY_SECONDS = 300` 未在 `verifyJwt` 的 `exp` 检查中减去，实际 exp 检查为严格 `Date.now() / 1000 > payload.exp`。建议应用 leeway 或将常量重命名。

---

## 3. In-Scope 逐项对齐审核

> 本节对照 plan-zero-to-real.md 的 Z0-Z4 phase in-scope 项，逐条评估当前实现状态。

### 3.1 6-Worker Binding Matrix 对齐

| Charter 要求 | 当前事实 | 审查结论 | 说明 |
|-------------|---------|---------|------|
| `orchestration.core` = 唯一 public facade | `workers_dev: true`，5 个其他 worker 均为 `false` | `done` | 符合 §5.6(1) |
| `orchestrator.auth` internal-only | `workers_dev: false`，caller 限于 `orchestrator-core` | `done` | 符合 §5.6(2) |
| `agent.core` = runtime host / only internal | `workers_dev: false`，RPC 9 方法 | `done` | 符合 §5.6(3) |
| `bash/core/context.core/filesystem.core` = only internal | `workers_dev: false` | `partial` | context-core/filesystem-core 的 RPC 方法因导出错误不可达 (R5) |
| `orchestration.core` 绑定全部 5 个 worker | wrangler.jsonc 已有 5 个 service bindings | `done` | |
| agent-core service bindings 全部激活 | 仅 BASH_CORE 激活，CONTEXT_CORE/FILESYSTEM_CORE 注释 | `partial` | 符合 short-term shim 期内 owner decision，但 closure 应标注 |

### 3.2 Z1-Z4 Phase 逐项对齐

| 编号 | Phase / 设计项 | 审查结论 | 说明 |
|------|---------------|---------|------|
| Z1.1 | D1 identity core 表已创建 | `done` | migrations/001 覆盖 users/profiles/identities/teams/memberships |
| Z1.2 | end-user auth flow (register/login/refresh/verify/me/WeChat) | `done` | orchestrator-auth 的 8 个 RPC 方法已实现 |
| Z1.3 | orchestrator.auth internal-only pure RPC | `done` | WorkerEntrypoint 导出正确，caller 严格限制 |
| Z1.4 | WeChat bridge | `partial` | 代码骨架存在，但缺少真实环境验证 |
| Z2.1 | conversation/session/turn/message D1 表 | `done` | migrations/002 覆盖 |
| Z2.2 | context snapshot D1 表 | `done` | migrations/002 覆盖 |
| Z2.3 | trace-linked activity/audit D1 表 | `done` | migrations/002 覆盖 `nano_session_activity_logs` |
| Z2.4 | user DO stateful uplift 最低集合 | `partial` | DO 有大量 KV/D1，但 alarm GC 有致命缺陷 (R9) |
| Z2.5 | history/reconnect/timeline/conversation list | `partial` | conversation list 双源不同步 (R8) |
| Z3.1 | Workers AI provider 接线 | `partial` | LLM wrapper 已就绪，但需 live env 验证 |
| Z3.2 | quota minimal truth | `done` | migrations/004 覆盖 usage_events/quota_balances |
| Z3.3 | runtime mesh binding discipline | `partial` | context/filesystem 两个 worker 的 RPC 不可达 (R5) |
| Z4.1 | web client hardening | `partial` | 客户端代码存在，但 api-docs 与代码现实不一致 |
| Z4.2 | Mini Program 接入 | `partial` | 代码存在但未真实验证 |
| Z4.3 | 收敛剩余 internal HTTP | `partial` | user-do 仍有 HTTP fetch 用于 readInternalStream (中) |
| ZX5.D3 | `/messages` endpoint | `missing-by-bug` | 代码已实现但被 needsBody 短路 (R1) |
| ZX5.D4 | `/files` endpoint | `partial` | metadata-only，body 同样被 needsBody 影响 |
| ZX5.D5 | `/me/conversations` endpoint | `partial` | 代码存在但双源不一致 (R8) |
| ZX5.D6 | `/me/devices/revoke` endpoint | `partial` | 代码存在但缺少 auth gate second-half |
| ZX5.F1/F2 | Permission/Elicitation wait-and-resume | `missing` | infra 存在但零调用方 (R4) + delegate no-op (R2) |
| ZX5.F3 | usage push | `missing` | callback 未被传入 runner (R3) |

### 3.3 对齐结论

- **done**: `12`
- **partial**: `12`
- **missing**: `3` (ZX5 F1/F2/F3)
- **missing-by-bug**: `1` (ZX5 D3 /messages)
- **stale**: `0`
- **out-of-scope-by-design**: `0`

> 这更像 **"core infrastructure 主体成立，但 5 个关键断点 (R1-R6) 使多个 feature 表面处于 '代码已存在但运行时不可达' 的状态"**。ZX5 closure 与 zero-to-real final closure 的完成主义叙事与代码事实之间存在比 GPT 审查所指出的更深的鸿沟。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 不新增 worker / 保持 6 worker 拓扑 | `遵守` | worker 数量正确，未出现第 7 个 |
| O2 | skill.core reserved + deferred | `遵守` | 无 skill.core worker |
| O3 | 完整 admin plane | `遵守` | 未发现 admin CRUD 的实现 |
| O4 | 所有 internal HTTP 全面退役 | `遵守` | charter 明确 stream-plane 为渐进退役 |
| O5 | cold archive / R2 offload | `遵守` | 未实现 |
| O6 | full quota policy / ledger | `遵守` | 仅最小 truth 已落 |
| O7 | tenant-facing admin UI | `遵守` | 未实现 |
| O8 | platform-level observability dashboard | `遵守` | 未实现 |
| O9 | D1 物理删除 Tier B packages | `遵守` | 仅打了 DEPRECATED，未物理删除 |
| O10 | W1 RFC 升级为 shipped code | `遵守` | 保持 direction-only |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**:`changes-requested — 6 个 critical 断点 (R1-R6) 必须在 zero-to-real 闭合前修复，另有 4 个 high 项需要逐条评估是否需要伴随修复或降级 closure 叙事。`
- **是否允许关闭本轮 review**:`no`
- **关闭前必须完成的 blocker**:
  1. **修复 R1** (needsBody 遗漏): 这是最少 1 行代码的修复，不应该成为 delayed issue。修复后至少用 curl 或 root e2e 验证 `/messages` 端点的 body 传透性。
  2. **修复 R5** (context-core/filesystem-core 默认导出): 二选一 — 改导出或移除 RPC 方法。当前 "代码有 RPC 但部署不可达" 的状态与 closure 叙事严重冲突。
  3. **诚实化 closure (覆盖 R2/R3/R4/R6)**: 对 Lane F (F1/F2/F3) 的 closure 描述必须从 "infra land, wiring deferred" 降级为 "contract+storage infra defined; hook.emit delegate is no-op; onUsageCommit never wired; emitPermissionRequestAndAwait has zero callers; scheduler never generates hook_emit decisions". 这不是 scope 问题，是 **correctness-by-omission** 问题。
  4. **修复 R9** (alarm no try/catch): 这是最小代价的生产稳定性修复。
- **可以后续跟进的 non-blocking follow-up**:
  1. R7 (D1 先写后验) — 在 agent-core RPC wrapper 可靠后再处理
  2. R8 (/me/conversations 双源) — 确认 KV-to-D1 迁移完成后合并
  3. R10 (void promise) — 改为 catch+log
  4. R11-R17 (medium items) — 逐条在 next phase 解决
  5. R18-R23 (low items) — 代码卫生，可批量处理
- **建议的二次审查方式**:`same reviewer rereview — 本轮发现的 6 个 critical 项修复后应逐条验证，尤其是 R1 (needsBody) 与 R5 (worker export) 这两条对代码现实影响最大`
- **实现者回应入口**:`请按 docs/templates/code-review-respond.md 在本文件 §6 append 回应，不要改写 §0–§5`

> 本轮 review 不收口，等待实现者修复 6 个 critical 项并对 4 个 high 项做出二选一处理 (修复 or 诚实降级 closure)。
>
> 最关键的判断：**zero-to-real 的 closure 必须将修复后的 truth 写清楚 — 哪些是 "代码已存在且在运行时可达"、哪些是 "代码已存在但运行时不可达 (needsBody 短路 / worker export 错误 / delegate no-op / callback never wired)"、哪些是 "infra stub 已存在但从未被系统调用链触及"**。当前 closure 文档将三者混为一谈，是对仓库可交付性最危险的轻视。

---

## 6. 实现者回应

> *本行以下留给实现者按 `docs/templates/code-review-respond.md` 格式 append 回应。*
