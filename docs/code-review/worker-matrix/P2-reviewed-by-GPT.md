# Nano-Agent 代码审查

> 审查对象: `worker-matrix / P2 live-loop activation`
> 审查时间: `2026-04-23`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/action-plan/worker-matrix/P2-live-loop-activation.md`
> - `docs/issue/worker-matrix/P2-closure.md`
> - `workers/agent-core/**`
> - `packages/session-do-runtime/**`
> - `test/tool-call-live-loop.test.mjs`
> - `test/initial-context-live-consumer.test.mjs`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`P2 的 D03/D05/D06 主体实现真实存在，但当前不应标记为 completed；BASH_CORE service binding 只在 wrangler 配置层激活，尚未在运行时 composition 层真正接通。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `agent-core preview 的 root probe 与 /sessions/... forwarding 都已成立，但 capability transport 仍在运行时读取旧名 CAPABILITY_WORKER，而不是实际注入的 BASH_CORE。`
  2. `P2 的 root e2e #1 没有守住 action-plan 承诺的 session.start → tool.call → stream 闭环，且用错了 binding 名，因此掩盖了真实 bug。`
  3. `在当前代码真相下，P2 还不能作为 P3/P4 的正式 truth layer 收口移交；只能说 initial_context / composition 这两块已基本可复用。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/worker-matrix/P2-live-loop-activation.md`
  - `docs/issue/worker-matrix/P2-closure.md`
  - `docs/plan-worker-matrix.md`
- **核查实现**：
  - `workers/agent-core/src/index.ts`
  - `workers/agent-core/src/host/env.ts`
  - `workers/agent-core/src/host/composition.ts`
  - `workers/agent-core/src/host/remote-bindings.ts`
  - `workers/agent-core/src/host/do/nano-session-do.ts`
  - `workers/agent-core/src/host/context-api/append-initial-context-layer.ts`
  - `workers/agent-core/wrangler.jsonc`
  - `packages/session-do-runtime/src/{env,remote-bindings,do/context-api}/*`
  - `test/tool-call-live-loop.test.mjs`
  - `test/initial-context-live-consumer.test.mjs`
- **执行过的验证**：
  - `pnpm --filter @haimang/agent-core-worker test`
  - `pnpm --filter ./packages/session-do-runtime test`
  - `node --test test/*.test.mjs`
  - `npm run test:cross`
  - `pnpm --filter @haimang/agent-core-worker run deploy:dry-run`
  - `pnpm --filter @haimang/bash-core-worker run deploy:dry-run`
  - `curl -fsSL https://nano-agent-agent-core-preview.haimang.workers.dev/`
  - `curl -fsSL https://nano-agent-agent-core-preview.haimang.workers.dev/sessions/probe-demo/status`
  - `curl -fsSL https://nano-agent-bash-core-preview.haimang.workers.dev/`
  - `pnpm --filter @haimang/agent-core-worker build` + 本地导入 `dist/host/composition.js` 复现 `BASH_CORE` / `CAPABILITY_WORKER` 绑定差异

### 1.1 已确认的正面事实

- `workers/agent-core/src/index.ts` 已修复为真实 entry wrapper：`GET /` 与 `GET /health` 返回 P2 probe shape，`/sessions/:id/...` 会真实转发到 `NanoSessionDO`，live preview `GET /sessions/probe-demo/status` 返回 `{"ok":true,"action":"status","phase":"unattached"}`。  
- `appendInitialContextLayer` helper 与 D05 consumer 已落盘到 worker/package 两侧，且 `initial_context` 的 canonical `session` kind 映射、`system.notify severity=error` 错误口径、`no initial_context kind` 这些约束都有实现与测试支撑。  
- P2 声称的大部分回归都是真实的：`agent-core` / `session-do-runtime` / root tests / cross tests / 两个 worker dry-run / 双 preview URL 均可验证通过。  

### 1.2 已确认的负面事实

- `workers/agent-core/wrangler.jsonc` 与 `src/index.ts` 的 live binding 名已改为 `BASH_CORE`，但 `workers/agent-core/src/host/env.ts`、`composition.ts`、`remote-bindings.ts`、`do/nano-session-do.ts` 以及 `packages/session-do-runtime` 镜像仍在读取旧名 `CAPABILITY_WORKER`。  
- 本地复现实测：当 env 仅提供真实的 `BASH_CORE` binding 时，`readCompositionProfile()` 仍给出 `capability: "local"`，`createDefaultCompositionFactory()` 也返回 `capability.transport === "unavailable"`；只有伪造 `CAPABILITY_WORKER` 时才变成 `service-binding`。  
- `test/tool-call-live-loop.test.mjs` 以及多组 worker/package tests 也都还在用 `CAPABILITY_WORKER` 构造 mock env；因此它们没有验证 wrangler 的真实配置名，更没有跑 action-plan 承诺的 `session.start → kernel → tool_call → stream` 闭环。  

---

## 2. 审查发现

### R1. `BASH_CORE` 与 `CAPABILITY_WORKER` 名称漂移导致 capability transport 在真实部署中未接通

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - `workers/agent-core/wrangler.jsonc:28-55` 真实 service binding 名是 `BASH_CORE`，preview env 也是 `BASH_CORE -> nano-agent-bash-core-preview`。
  - `workers/agent-core/src/index.ts:6-36` 的 probe shape 也用 `env.BASH_CORE` 计算 `capability_binding`。
  - 但 `workers/agent-core/src/host/env.ts:45-77,113-120` 仍把 v1 catalog 与 profile flip 全部定义为 `CAPABILITY_WORKER`。
  - `workers/agent-core/src/host/composition.ts:154-156,205-233` 仍只读取 `env.CAPABILITY_WORKER`。
  - `workers/agent-core/src/host/remote-bindings.ts:335-338` 与 `workers/agent-core/src/host/do/nano-session-do.ts:72-82` 也仍以 `CAPABILITY_WORKER` 作为 capability remote seam 判断条件。
  - `packages/session-do-runtime/src/{env,remote-bindings,do/nano-session-do}.ts` 保持同样旧名镜像。
  - 本地复现实测：
    - 仅传 `BASH_CORE` 时：`readCompositionProfile(...) => {"capability":"local",...}`，`createDefaultCompositionFactory(...).capability.transport === "unavailable"`。
    - 仅传 `CAPABILITY_WORKER` 时：`capability.transport === "service-binding"`。
- **为什么重要**：
  - 这意味着 P2 的“binding activated”只在 wrangler 配置和 probe 字段层成立，在真正的 runtime assembly 层并没有把 capability seam 接到 live bash-core。
  - 更严重的是，这个漂移同时存在于 worker truth、package mirror truth、profile resolution、remote factory 选择和测试 mock 里，因此不是单点 typo，而是一整条 capability path 仍然停留在旧命名协议上。
- **审查判断**：
  - `P2 DoD #5 / #6 / #7` 不能判 done；当前最多只能说 “BASH_CORE 已声明且 preview live”，不能说 “agent↔bash live tool.call loop 已激活”。
- **建议修法**：
  - 统一 capability seam 的 binding 名：要么把运行时代码全面迁到 `BASH_CORE`，要么把 wrangler 恢复成 `CAPABILITY_WORKER`；但 worker probe / wrangler / env.ts / composition.ts / remote-bindings.ts / do selection / package mirror / tests 必须全链一致。
  - 修完后重新验证：
    1. `readCompositionProfile()` 在真实 env shape 下返回 `capability: "remote"`  
    2. `createDefaultCompositionFactory()` 在真实 env shape 下返回 `service-binding`  
    3. root e2e 与 live preview 口径同步更新

### R2. root e2e #1 与 action-plan/closure 的 “live turn loop” 承诺不一致，测试没有守住真实交付面

- **严重级别**：`high`
- **类型**：`test-gap`
- **事实依据**：
  - `docs/action-plan/worker-matrix/P2-live-loop-activation.md:105,152,209,267` 明确把 root e2e #1 定义为：`session.start → kernel tool_call → binding → bash-core → response → session.stream.event`。
  - `docs/action-plan/worker-matrix/P2-live-loop-activation.md:528` 与 `:547,657` 进一步把 P2 总结成 “preview env 真实跑通 live turn loop / tool.call 双向闭环”。
  - `test/tool-call-live-loop.test.mjs:13-27` 自己却明确写着：**full live turn loop gated on kernel / llm going from P2-stub to live — a later charter**。
  - 同文件 `:58-134` 的实际测试内容只是：
    1. 扫 wrangler 源确认 `BASH_CORE` 声明；
    2. 直接用 `CAPABILITY_WORKER` mock env 调 `createDefaultCompositionFactory()`；
    3. 手工对 `serviceBindingTransport.fetch()` 发一个 request。
  - `workers/agent-core/src/host/composition.ts:235-249` 也明确表明 `kernel / llm / hooks` 当前仍是 `phase: "P2-stub"`。
- **为什么重要**：
  - 这不是单纯“命名不严谨”。当前 test 和 closure 一起把 P2 说成了 live turn loop activation，但代码真相只是：`initial_context` consumer 落了，workspace/eval/capability seam 升级了，tool.call transport slot 做了准备。
  - 正因为 e2e #1 没有守住真实 wrangler env + real DO/runtime path，它才没有抓到 R1 的 binding 名漂移。
- **审查判断**：
  - P2 现状更准确的描述是 **“host consumer + composition upgrade + binding seam readiness”**，而不是 **“tool.call live turn loop closed”**。
- **建议修法**：
  - 二选一：
    1. **收紧文档口径**：把 P2 的 headline / DoD / closure 全部改成“binding seam activated/readiness”，明确 full kernel→tool.call live loop 不在本 phase；  
    2. **补真实测试**：新增真正以 `session.start` 驱动、使用真实 binding 名、穿过 DO/runtime 入口的 test，至少守住 capability seam 在真实 env shape 下可达。
  - 不论选哪条，`test/tool-call-live-loop.test.mjs` 都必须先改成使用真实 binding 名，否则仍会继续掩盖 R1。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | P2 prerequisite：bash-core preview live + Version ID 可用 | `done` | bash-core preview 仍 live，root 与 `/capability/*` 行为可复验。 |
| S2 | D03 F4 `appendInitialContextLayer` helper + worker/package 镜像 | `done` | helper/镜像/测试均已落盘，且遵守 R1：不改 assembler API、不发明 `initial_context` kind。 |
| S3 | D06 `createDefaultCompositionFactory` 6 handle 非 undefined | `done` | workspace / eval / stub handles 都已实装，相关 worker tests 可通过。 |
| S4 | D06 `makeRemoteBindingsFactory` 4 nullable 显式处理 | `done` | kernel/workspace/eval/storage 的 `null` 语义与测试都已存在。 |
| S5 | D05 host consumer 接线 + package mirror | `done` | `dispatchAdmissibleFrame("session.start")` 的 consumer 与 `system.notify` 错误口径已落盘。 |
| S6 | agent-core entry routing 修复 + preview redeploy | `done` | live `/sessions/probe-demo/status` 已证明真实 forwarding 到 DO。 |
| S7 | D07 capability binding activation | `partial` | wrangler/config/probe 层已用 `BASH_CORE` 激活，但 composition/runtime 仍读取旧名 `CAPABILITY_WORKER`。 |
| S8 | root e2e #1 tool.call live loop | `partial` | test 存在，但实际只测 mock transport seam；既没跑 action-plan 承诺的 session.start 闭环，也没使用真实 binding 名。 |
| S9 | root e2e #2 initial_context dedicated | `done` | 测试与实现对齐，能证明 consumer 与 canonical kind 映射生效。 |
| S10 | P2 可作为 P3/P4 kickoff truth layer | `partial` | initial_context / composition 部分可用，但 capability seam truth 仍错位，不能 formal close。 |

### 3.1 对齐结论

- **done**: `7`
- **partial**: `3`
- **missing**: `0`

`这更像“P2 的 host/workspace/context 主线已经闭合，但 capability binding 与 live-loop 叙述仍未收口”，而不是 completed。`

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 不激活 `CONTEXT_CORE` / `FILESYSTEM_CORE` binding | `遵守` | 这两项仍保持注释态，未越位进入 P3/P4。 |
| O2 | 不新增 top-level `assembler` handle | `遵守` | `workspace.assembler` 仍是唯一合法落点，相关 shape tests 也在。 |
| O3 | 不改 NACP wire / 不发明 `system.error` / `initial_context` kind | `遵守` | R1/R2 的禁止项当前都被遵守。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`P2 不应在当前状态收口。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `统一 capability seam 的 binding 名（wrangler / index / env / composition / remote-bindings / DO / package mirror / tests），让真实的 BASH_CORE 配置在运行时确实变成 service-binding transport。`
  2. `修正 root e2e #1 与 closure/action-plan 的交付口径：要么用真实 env shape 补足测试，要么收紧文档，不再把当前状态表述成 full live turn loop。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `修复后补一条针对真实 binding 名的 regression test，避免以后再出现 probe 字段真、composition 假的双层漂移。`
  2. `等 P2 真闭合后，再把 P3/P4 kickoff unblocked 的判断回填到 closure memo。`

`本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。`

---

## 6. Closeout Addendum（2026-04-23）

在本 review 发出后，P2 的两条 blocker 已被代码与 live preview 事实关闭：

1. **R1 已关闭**：`BASH_CORE` 现已成为 canonical capability binding；`workers/agent-core/**` 与 `packages/session-do-runtime/**` 的 env / composition / remote binding / DO 默认远端选择已全部对齐，`CAPABILITY_WORKER` 仅保留 legacy alias。
2. **R2 已关闭**：`test/tool-call-live-loop.test.mjs` 已改写为 **seam-readiness guard**，不再 overclaim full live turn loop；同时它已显式守护真实的 `BASH_CORE` binding、default remote selection、DO remote selection、transport seam 与 canonical wire truth。

对应收口证据见：

- `docs/issue/worker-matrix/P2-closure.md` v0.2
- `docs/action-plan/worker-matrix/P2-live-loop-activation.md` §11 更新日志

因此，这份 review 的**历史结论**仍然成立（当时确有 blocker），但 **当前代码状态** 已不再是 `changes-requested` 阶段；P2 后续已完成 closeout，并作为 P3 / P4 的实际启动基线被消费。
