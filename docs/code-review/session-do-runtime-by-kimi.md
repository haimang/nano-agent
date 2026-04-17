# Nano-Agent 代码审查模板

> 审查对象: `@nano-agent/session-do-runtime`
> 审查时间: `2026-04-17`
> 审查人: `Kimi`
> 审查范围:
> - `docs/action-plan/session-do-runtime.md`
> - `docs/design/session-do-runtime-by-opus.md`
> - `packages/session-do-runtime/src/**`
> - `packages/session-do-runtime/test/**`
> 文档状态: `reviewed`

---

## 0. 总结结论

> 该实现作为 MVP skeleton 的单元测试与集成测试覆盖度极佳，但缺失 Worker 入口文件与 README，导致其作为“首个 deploy-oriented runtime package”的定位无法闭环。

- **整体判断**：核心 actor 状态机、health/alarm、checkpoint/shutdown、orchestration 骨架均已落地并通过 211 项测试；但 Worker entry (`src/worker.ts`) 完全缺失，WebSocket 升级与 DO storage 也仍停留在 stub 层面。
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `src/worker.ts` 缺失是本包最严重的结构性缺口——没有 Worker fetch handler，wrangler.jsonc 中 `main: "dist/worker.js"` 指向的是不存在的产物。
  2. `README.md` 缺失使得 deploy/use 边界无法被 review，也与 action-plan P1-01 / P6-02 直接冲突。
  3. `NanoSessionDO` 的生命周期方法（fetch / webSocketClose / alarm）均未接入真实的 DO API（`acceptWebSocket`、`state.storage.setAlarm`、storage persistence），当前仍是“可在 vitest 中运行的类”，而非“可在 Cloudflare 上运行的 DO”。

---

## 1. 审查方法与已核实事实

> 这一节只写事实，不写结论。
> 明确你看了哪些文件、跑了哪些命令、核对了哪些计划项/设计项。

- **对照文档**：
  - `docs/action-plan/session-do-runtime.md`
  - `docs/design/session-do-runtime-by-opus.md`
  - `README.md`
- **核查实现**：
  - `packages/session-do-runtime/src/version.ts`
  - `packages/session-do-runtime/src/env.ts`
  - `packages/session-do-runtime/src/composition.ts`
  - `packages/session-do-runtime/src/routes.ts`
  - `packages/session-do-runtime/src/http-controller.ts`
  - `packages/session-do-runtime/src/ws-controller.ts`
  - `packages/session-do-runtime/src/turn-ingress.ts`
  - `packages/session-do-runtime/src/actor-state.ts`
  - `packages/session-do-runtime/src/health.ts`
  - `packages/session-do-runtime/src/orchestration.ts`
  - `packages/session-do-runtime/src/checkpoint.ts`
  - `packages/session-do-runtime/src/alarm.ts`
  - `packages/session-do-runtime/src/shutdown.ts`
  - `packages/session-do-runtime/src/traces.ts`
  - `packages/session-do-runtime/src/do/nano-session-do.ts`
  - `packages/session-do-runtime/src/index.ts`
  - `packages/session-do-runtime/test/actor-state.test.ts`
  - `packages/session-do-runtime/test/alarm.test.ts`
  - `packages/session-do-runtime/test/checkpoint.test.ts`
  - `packages/session-do-runtime/test/health.test.ts`
  - `packages/session-do-runtime/test/orchestration.test.ts`
  - `packages/session-do-runtime/test/routes.test.ts`
  - `packages/session-do-runtime/test/shutdown.test.ts`
  - `packages/session-do-runtime/test/traces.test.ts`
  - `packages/session-do-runtime/test/do/nano-session-do.test.ts`
  - `packages/session-do-runtime/test/integration/start-turn-resume.test.ts`
  - `packages/session-do-runtime/test/integration/ws-http-fallback.test.ts`
  - `packages/session-do-runtime/test/integration/heartbeat-ack-timeout.test.ts`
  - `packages/session-do-runtime/test/integration/graceful-shutdown.test.ts`
  - `packages/session-do-runtime/wrangler.jsonc`
- **执行过的验证**：
  - `pnpm --filter @nano-agent/session-do-runtime typecheck`
  - `pnpm --filter @nano-agent/session-do-runtime test`
  - `ls packages/session-do-runtime/src/`（确认 `worker.ts` 不存在）
  - `ls packages/session-do-runtime/test/`（确认 `http-controller.test.ts`、`ws-controller.test.ts`、`turn-ingress.test.ts` 不存在）

### 1.1 已确认的正面事实

- 211 项测试全部通过（13 个测试文件），类型检查零错误。
- `actor-state.ts` 的 phase 机（`unattached → attached → turn_running → ended`）与非法 transition 拒绝逻辑完整。
- `health.ts` + `alarm.ts` 的 caller-managed heartbeat/ack 检查与关闭逻辑有 12 项集成测试覆盖。
- `checkpoint.ts` 的 fragment 组装与 `validateSessionCheckpoint` 有 23 项单元测试覆盖。
- `shutdown.ts` 的 graceful shutdown 序列（hook → checkpoint → save → flush → close）有 10 项集成测试覆盖。
- `routes.ts` 的 WS/HTTP 路由分离清晰，单测覆盖边界情况。
- `wrangler.jsonc` 存在并给出了最小 DO binding skeleton。

### 1.2 已确认的负面事实

- `src/worker.ts` 文件在源码目录中完全不存在；`wrangler.jsonc` 的 `main` 字段指向 `dist/worker.js` 但没有源文件可编译出该产物。
- `README.md` 文件不存在。
- `NanoSessionDO.fetch()` 在 WebSocket upgrade 分支中没有调用 `this.ctx.acceptWebSocket()`，也没有返回真正的 WebSocket pair；它仅返回一个 synthetic 101/200 Response。
- `NanoSessionDO` 持有 `doState: unknown` 但从未读写 `state.storage`；checkpoint 与 alarm scheduling 均停留在注释层面。
- `test/` 目录下缺少 action-plan §1.5 与 §8.1 明确列出的 `http-controller.test.ts`、`ws-controller.test.ts`、`turn-ingress.test.ts`。

---

## 2. 审查发现

> 使用稳定编号：`R1 / R2 / R3 ...`
> 每条 finding 都应包含：严重级别、事实依据、为什么重要、审查判断。
> 只写真正影响 correctness / security / scope / delivery 的问题，不写样式意见。

### R1. `src/worker.ts` 缺失 —— deploy-oriented package 缺少 Worker 入口

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/action-plan/session-do-runtime.md` §1.5 目录树与 §4.2 `P2-01` 均明确列出 `src/worker.ts` 为新增文件。
  - `packages/session-do-runtime/src/` 目录 listing 中无 `worker.ts`（仅有 16 个文件/目录）。
  - `packages/session-do-runtime/wrangler.jsonc:6` 配置 `"main": "dist/worker.js"`，但无对应源文件。
- **为什么重要**：
  - 本包被定义为“首个 deploy-oriented runtime package”。Worker fetch handler 是 Cloudflare 部署的法定入口；缺少它意味着整个包目前无法被部署，wrangler 配置与源码脱节。
- **审查判断**：
  - 这是结构性缺失，必须补上至少一个最小 Worker entry（routing WS upgrade → DO fetch / HTTP fallback → DO fetch）。
- **建议修法**：
  - 新建 `src/worker.ts`，导出 `export default { fetch }`，实现：从请求中提取 session ID → 构造 DO stub → `env.SESSION_DO.get(id).fetch(request)`。

### R2. `README.md` 缺失

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/action-plan/session-do-runtime.md` §1.5 目录树与 §4.6 `P6-02` 均要求 `README.md`。
  - `packages/session-do-runtime/README.md` 不存在。
- **为什么重要**：
  - README 需要说明本包是 runtime assembly layer（而非子系统实现全集）、部署方式、环境变量与 wrangler binding 要求。缺少它会导致下游无法正确组装与部署。
- **审查判断**：
  - 必须补充，内容至少覆盖：包定位、Worker/DO 架构图、本地测试命令、部署 checklist、支持/不支持边界。
- **建议修法**：
  - 新建 `README.md`，对齐 action-plan §8.3 的完成定义与 design doc §2.1 的架构图。

### R3. 缺失 3 个核心单元测试文件

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - `docs/action-plan/session-do-runtime.md` §1.5 明确列出：
    - `test/http-controller.test.ts`
    - `test/ws-controller.test.ts`
    - `test/turn-ingress.test.ts`
  - `ls packages/session-do-runtime/test/` 结果中无上述三个文件。
- **为什么重要**：
  - 虽然 integration tests（如 `ws-http-fallback.test.ts`）部分覆盖了 controller 行为，但 action-plan 明确将 controller/ingress 单测列为收口标准。缺少它们会降低边界 case 的独立回归能力。
- **审查判断**：
  - 需要补齐。可以小而精，覆盖各自模块的边界与错误路径即可。
- **建议修法**：
  - `http-controller.test.ts`：覆盖 6 个 action 的 200 响应、404、400、HTTP fallback disabled 场景。
  - `ws-controller.test.ts`：覆盖 handleUpgrade 成功/失败、handleMessage、handleClose。
  - `turn-ingress.test.ts`：覆盖 extractTurnInput 的各 message_type 分支与 null 返回路径。

### R4. `NanoSessionDO.fetch()` 未执行真实的 WebSocket upgrade

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/session-do-runtime/src/do/nano-session-do.ts:112-122` 中，websocket 路由仅调用 `this.wsController.handleUpgrade(route.sessionId)` 并返回 synthetic `new Response(null, { status: 101 })`。
  - 代码中没有任何 `this.ctx.acceptWebSocket(ws)` 或 `new WebSocketPair()` 的调用。
- **为什么重要**：
  - 在 Cloudflare Durable Objects 中，WebSocket 升级必须通过 `state.acceptWebSocket()` 完成。当前实现只在 vitest 中“看起来像 101”，在真实 Workers 运行时无法建立 WebSocket 连接。
- **审查判断**：
  - 作为 MVP skeleton 可接受 stub，但必须在代码中显式标记 `TODO: implement real WebSocket accept` 并说明阻塞条件（如 `@nano-agent/nacp-session` 的 `SessionWebSocketHelper` 集成）。
- **建议修法**：
  - 在 `fetch` 的 websocket 分支中接入 `nacp-session` 的 `SessionWebSocketHelper`（或至少构造 `WebSocketPair` 并调用 `acceptWebSocket`），并在未实现处抛出显式错误或在注释中标注 blocker。

### R5. `NanoSessionDO` 完全未使用 DO storage API

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/session-do-runtime/src/do/nano-session-do.ts:47-48`：`doState: unknown; env: unknown;`
  - 全文搜索 `storage` 或 `setAlarm` 无调用；`webSocketClose` 中的 checkpoint 逻辑是空注释；`alarm()` 中的 alarm scheduling 也是空注释。
- **为什么重要**：
  - DO 的核心价值在于 `state.storage` 的强一致性持久化与 `setAlarm` 的自唤醒。如果这两者都不使用，Session DO 就退化成了普通内存类，无法在 hibernation 后恢复状态。
- **审查判断**：
  - 属于骨架阶段的已知缺口，但必须在 Worker entry 补完后同步把 `state.storage` 接入 checkpoint / restore / alarm 路径。
- **建议修法**：
  - 将 `doState` 类型从 `unknown` 约束为 `DurableObjectState`；在 `webSocketClose` 中调用 `this.doState.storage.put("checkpoint", ...)`；在 `alarm()` 中调用 `this.doState.storage.setAlarm(Date.now() + interval)`。

### R6. `validateSessionCheckpoint` 未深度校验 fragment 结构

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/session-do-runtime/src/checkpoint.ts:78-96` 的 `validateSessionCheckpoint` 仅检查顶层字段的类型（string / number / object），未校验 `kernelFragment`、`replayFragment`、`workspaceFragment`、`hooksFragment` 的内部结构。
  - 设计文档 §5.1 S13 要求 checkpoint seam 组合 kernel/websocket/workspace 片段并“restore 后可继续运行”。
- **为什么重要**：
  - 浅层校验意味着损坏或版本不兼容的 fragment 可能在 restore 时才暴露，导致运行时崩溃或状态静默损坏。
- **审查判断**：
  - 至少应增加 version 字段校验与 fragment 最小 shape 断言（如 `kernelFragment.version`、`workspaceFragment.version`）。
- **建议修法**：
  - 在 `validateSessionCheckpoint` 中增加对 `kernelFragment?.version`、`workspaceFragment?.version` 等关键字段的断言；若 version 不匹配则返回 false 并可选地记录原因。

---

## 3. In-Scope 逐项对齐审核

> 如果存在 action-plan / design doc，就必须有这一节。
> 结论统一使用：`done | partial | missing | out-of-scope-by-design`。

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 独立包骨架 | `done` | package.json、tsconfig、wrangler.jsonc、exports 完整，typecheck/test 通过。 |
| S2 | Worker fetch entry | `missing` | `src/worker.ts` 不存在，wrangler main 指向虚空。 |
| S3 | `NanoSessionDO` class | `partial` | 类存在且通过 22 项测试，但 fetch/close/alarm 均未接入真实 DO API。 |
| S4 | `SessionWebSocketHelper` 装配 | `partial` | `WsController` 存在，但未实际使用 `nacp-session` helper 或 `acceptWebSocket`。 |
| S5 | nacp-session phase/role gate | `partial` | `actor-state.ts` 有 phase 机，但未集成 `assertSessionPhaseAllowed()`。 |
| S6 | WS/HTTP 双入口共享模型 | `partial` | 路由与控制器共享 `ActorState`，但 Worker 入口缺失导致双入口未真正闭环。 |
| S7 | 最小 turn ingress (`session.start.initial_input`) | `done` | `turn-ingress.ts` 明确实现并留注释说明后续 family 未冻结。 |
| S8 | `TurnIngressAdapter` seam | `done` | `extractTurnInput` 返回 `TurnInput` 结构，为后续扩展预留接口。 |
| S9 | single-active-turn guard | `partial` | `orchestration.ts` 的 `startTurn` 有 guard，但基于 stub 的 `advanceStep`。 |
| S10 | kernel step orchestration | `partial` | `SessionOrchestrator` 骨架完整，有 27 项测试，但 kernel 真实驱动未接入。 |
| S11 | delegates wiring | `partial` | `composition.ts` 定义了 seam，但所有 handle 为 `unknown`，实际接线全为 stub。 |
| S12 | caller-managed ack/heartbeat | `done` | `health.ts` + `alarm.ts` 完整实现，有 12 项集成测试覆盖。 |
| S13 | checkpoint / restore seam | `partial` | checkpoint 组装与校验存在，但 DO storage 持久化与 restore 未落地。 |
| S14 | alarm handler | `done` | `AlarmHandler` 与 `HealthGate` 集成完整，健康检查逻辑闭环。 |
| S15 | graceful shutdown | `done` | `shutdown.ts` 与集成测试完整覆盖 4 种 reason 与错误恢复路径。 |
| S16 | integration fixtures / README | `partial` | 4 项集成测试全部到位，但 `README.md` 缺失。 |

### 3.1 对齐结论

- **done**: `6`
- **partial**: `9`
- **missing**: `1`

> 这更像“核心 actor 骨架与 health/checkpoint/shutdown 已成立，但 Worker 入口与 DO API 真实接入仍未收口”的状态，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | sub-agent spawning / multi-DO federation | `遵守` | 源码中无任何 multi-DO 或 fork 逻辑。 |
| O2 | multi-client attach / observer mode | `遵守` | DO 类仅维护单一 WS 状态，无 observer 语义。 |
| O3 | kernel step scheduling 本体 | `遵守` | `advanceStep` 以 stub 形式存在，未在本包实现调度算法。 |
| O4 | llm provider request construction | `遵守` | llm handle 为 `unknown`，请求构造不在本包。 |
| O5 | capability command registry | `遵守` | capability handle 为 `unknown`，命令注册表不在本包。 |
| O6 | workspace storage topology / DDL | `遵守` | workspace fragment 由外部注入，本包未写死 storage 策略。 |
| O7 | production analytics / billing | `遵守` | traces 仅到 `TraceSink` seam，无 billing 管道。 |
| O8 | 跨区域迁移 / DO sharding | `遵守` | 未涉及。 |
| O9 | 在本包抢跑新的 nacp-session profile | `遵守` | `turn-ingress.ts` 明确声明后续 prompt family 未冻结，未自造消息。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **补上 `src/worker.ts`**：实现最小 Worker fetch handler（route → DO stub → forward），并确保 wrangler.jsonc 的 `main` 路径与实际构建产物一致。
  2. **补上 `README.md`**：说明包定位、Worker/DO 架构、部署方式、环境变量与不支持边界。
  3. **补齐 3 个缺失的单测文件**：`test/http-controller.test.ts`、`test/ws-controller.test.ts`、`test/turn-ingress.test.ts`。
- **可以后续跟进的 non-blocking follow-up**：
  1. 在 `NanoSessionDO.fetch()` 中接入真实 `acceptWebSocket()`（可随 `nacp-session` helper 集成一起推进）。
  2. 将 `doState` 类型收窄为 `DurableObjectState` 并接入 `state.storage` checkpoint / alarm。
  3. 增强 `validateSessionCheckpoint` 的 fragment version / shape 校验。

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
> 回应范围: `R1–R6`

- **总体回应**：`{ONE_LINE_RESPONSE}`
- **本轮修改策略**：`{STRATEGY}`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | `src/worker.ts` 缺失 | `pending` | `pending` | `pending` |
| R2 | `README.md` 缺失 | `pending` | `pending` | `pending` |
| R3 | 缺失 3 个核心单测 | `pending` | `pending` | `pending` |
| R4 | WS upgrade 未真实接入 | `pending` | `pending` | `pending` |
| R5 | DO storage 未使用 | `pending` | `pending` | `pending` |
| R6 | checkpoint 校验过浅 | `pending` | `pending` | `pending` |

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
| R1 | `pending` | `pending` |
| R2 | `pending` | `pending` |

### 7.3 仍未收口的问题

| 审查编号 | 当前状态 | 说明 | 下一步要求 |
|----------|----------|------|------------|
| R3 | `pending` | `pending` | `pending` |
| R4 | `pending` | `pending` | `pending` |

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

## 9. 对 Kimi 代码审查质量的评价

> 评价人: `Claude Opus 4.7 (1M context)`
> 评价时间: `2026-04-17`
> 评价依据: `Kimi 审查（§1–§5）与最终代码复核结果的对照`
>
> 注：本次修复的具体工作日志全部写在 `docs/code-review/session-do-runtime-by-GPT.md §7`，不在此重复。

### 9.1 一句话评价

**deploy 层与单测覆盖层抓得齐；协议真相层与 assembly 装配真空没抓到**：Kimi 把 `src/worker.ts` 缺失 / wrangler main 坏、3 个控制器单测缺失、`NanoSessionDO.fetch` 的 `acceptWebSocket` stub、`DurableObjectState.storage` 未接入等 5 条交付物级缺口全部准确命中，但对 orchestrator 发明 session event kind 与 `session.resume` 读错字段这两条协议真相漂移完全漏判。

### 9.2 优点

1. **R1 `src/worker.ts` 缺失 + wrangler main 坏点到位**：这是 "deploy-oriented package 看似完整实则无法部署" 的关键结构性缺口。给出的修法（提取 sessionId → 构 DO stub → forward）直接可用。
2. **R2 README 缺失判 high 合理**：不是鸡蛋里挑骨头——README 承载了 deploy/use 边界与 composition contract 说明，缺 README 对下游接入是实质阻塞。
3. **R3 把 action-plan §1.5 明确要求但缺失的 3 个控制器/ingress 单测文件名点全**（`http-controller.test.ts` / `ws-controller.test.ts` / `turn-ingress.test.ts`）。GPT 没具体点到文件名。
4. **R4 `acceptWebSocket()` 分析精准**：指出 WebSocket upgrade "在 vitest 中看起来像 101，但真实 Workers 运行时无法建立连接"。这类测试通过 / 生产不通的陷阱值得高亮。
5. **R5 把 `doState: unknown` + 未读写 `state.storage` + 未 `setAlarm` 三点一起锁住**：剖析到位，修法（把 `doState` 收紧为 `DurableObjectState` + storage put/get + `setAlarm`）也落地。
6. **R6 checkpoint 校验过浅**：虽然 severity 判 medium（GPT 判为 `high delivery-gap` 的一部分），但 Kimi 至少抓到 "浅层校验意味着损坏 fragment 可能在 restore 时才暴露" 这条运行时风险。

### 9.3 可以更好的地方

1. **协议真相层漂移两条完全漏判**：
   - Kimi §3 把 `S10 kernel step orchestration` 判为 partial，理由是 "依赖 stub"；但真正的核心问题是 orchestrator 发明了 `turn.started` / `turn.cancelled` / `session.ended` 这些不在 `SessionStreamEventBodySchema` catalog 里的 kind，`system.notify` 的 body 字段名从 `severity` 被错写成 `level`——这组错误一接真实 schema 就爆。Kimi 没有做 `SessionStreamEventBodySchema.safeParse()` 反向校验这一步。
   - 同理，Kimi 把 `S5 nacp-session phase/role gate` 判 partial，但没有指出 `session.resume` 主路径读 `parsed.checkpoint` 而不是 `body.last_seen_seq` 这个 correctness-level 错误。
2. **Verdict `changes-requested` 正确，但 blocker 只列了 3 条**（`worker.ts` / README / 3 单测）：把 orchestrator schema 漂移或 `session.resume` 字段错误纳入 blocker 会更严格。
3. **缺 "跨包 safeParse 实机" 证据**：GPT 的 R1 / R2 每条都有实机复现；Kimi §1 的 "执行过的验证" 列了 `typecheck` + `test` + `ls`，没有跨包 schema 反向校验。如果 Kimi 做了 `SessionStreamEventBodySchema.safeParse(pushed_event)`，会直接把协议层漂移暴露出来。
4. **R6 修法建议偏弱**：只建议 "增加 version 字段校验与 fragment 最小 shape 断言"，没深挖 `sessionUuid` UUID / `actorPhase` enum / `streamSeqs` 非负整数这些 action-plan 真正期望的 invariants。GPT R4 给了更完整的建议。
5. **Out-of-scope 清单省事**：§4 每条都只写 "遵守" 一行，没给文件证据；对比 GPT §4 `O9 部分违反`（抓到 orchestrator 抢跑新 session event kind），Kimi 也没看见 O9 的 "部分违反"。

### 9.4 评分

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 4 | 行号精准，缺跨包 safeParse / 运行时复现 |
| 判断严谨性 | 3.5 | 两条协议真相层漂移漏判；O9 违反未识别 |
| 修法建议可执行性 | 4.5 | R1–R6 六条修法都具体到接口 / 文件名 |
| 对 action-plan / design 的忠实度 | 4.5 | §1.5 / P2-01 / P6-02 都引到；但 `SessionStreamEventBodySchema` 这条真相未核 |
| 协作友好度 | 5 | `changes-requested` + 清晰的 blocker / follow-up 分层 |

总体 **4.2 / 5** — Kimi 的 review 在交付物层（worker entry、README、单测、DO API 接入）覆盖度比 GPT 细，是最好的 "deploy readiness checklist" 之一；但对最高风险的 session stream event 协议漂移和 `session.resume` 字段错误没抓到。与 GPT 并读互补极强；单独使用会在协议层留下隐患。
