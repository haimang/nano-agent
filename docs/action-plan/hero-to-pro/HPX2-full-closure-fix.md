# Nano-Agent 行动计划 — HPX2 Full Closure Fix

> 服务业务簇: `hero-to-pro / HPX2`
> 计划对象: `收敛 HP-full-closure-test-report 暴露的 8 个 live-e2e 失败项，恢复 hero-to-pro full-closure green gate`
> 类型: `modify + test + docs`
> 作者: `Owner + GPT-5.4`
> 时间: `2026-05-01`
> 文件位置:
> - `workers/orchestrator-core/src/{index.ts,auth.ts,user-do/ws-runtime.ts,user-do-runtime.ts}`
> - `workers/agent-core/src/host/{runtime-mainline.ts,quota/repository.ts}`
> - `test/cross-e2e/{04-agent-context-initial-context.test.mjs,11-orchestrator-public-facade-roundtrip.test.mjs,13-device-revoke-force-disconnect.test.mjs,15-hp2-model-switch.test.mjs}`
> - `test/package-e2e/orchestrator-core/{02-session-start.test.mjs,03-ws-attach.test.mjs,04-reconnect.test.mjs,11-rh5-models-image-reasoning.test.mjs}`
> - `clients/api-docs/{models.md,session-ws-v1.md,session.md}`
> - `docs/issue/hero-to-pro/{HP-full-closure-test-report.md,hero-to-pro-final-closure.md,HP10-closure.md}`
> - `docs/architecture/test-topology.md`
> 上游前序 / closure:
> - `docs/issue/hero-to-pro/HP-full-closure-test-report.md`
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
> - `docs/issue/hero-to-pro/HP10-closure.md`
> - `docs/charter/plan-hero-to-pro.md`
> 下游交接:
> - `docs/issue/hero-to-pro/HPX2-full-closure-fix-closure.md`
> - 回填 `docs/issue/hero-to-pro/HP-full-closure-test-report.md`
> 关联设计 / 调研文档:
> - `docs/issue/hero-to-pro/HP-full-closure-test-report.md`
> - `docs/architecture/test-topology.md`
> - `test/index.md`
> - `clients/api-docs/models.md`
> - `clients/api-docs/session-ws-v1.md`
> 冻结决策来源:
> - `docs/design/hero-to-pro/HPX-qna.md` Q33-Q36（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `executed`

---

## 0. 执行背景与目标

`HP-full-closure-test-report.md` 已经证明：当前 preview 环境的 **权限、发布、D1、6-worker 绑定、package truth** 都是通的，但这不等于“环境满足 full closure gate”。这里的“环境还不满足”，不是指 Cloudflare、GitHub 或数据库离线，而是指 **当前 preview 部署还不能作为 hero-to-pro 阶段的最终封板环境**，因为它对应的 intended live-e2e gate 还存在 8 个失败项，说明运行时链路、测试契约或 evidence truth 仍有缺口。

这 8 个失败项里，只有一部分是纯测试断言漂移；另外一部分是明确的 runtime 断点：最重的是 public WebSocket attach/reconnect 链路，另外还有 RH5 usage evidence 的 `is_reasoning` truth 漂移。HPX2 的任务不是“再跑一次测试”，而是把这 8 个失败项逐一分类成 **runtime 修复 / test 契约回刷 / docs truth 对齐** 三类，然后把 closure gate 修回到可以重新主张 `full live-e2e green` 的状态。

- **服务业务簇**：`hero-to-pro / HPX2`
- **计划对象**：`full-closure live-e2e failure closure`
- **本次计划解决的问题**：
  - public WebSocket attach/reconnect 链路在 preview live 环境下拿不到稳定 `101`，导致 4 个用例同步红灯。
  - initial_context 校验依赖 transient pending queue，导致 full run 出现 flaky / race。
  - HP2 model live 测试仍停留在匿名 `/models` placeholder，和当前 authenticated route / real fallback truth 不一致。
  - RH5 usage evidence 的 `is_reasoning` / `is_vision` 提取与真实请求形状存在漂移。
- **本次计划的直接产出**：
  - 修复 WebSocket public façade attach/reconnect 运行时链路。
  - 修复或重写 8 个失败项对应的 live tests，使其与当前 runtime truth 对齐。
  - 修复 RH5 reasoning/vision usage evidence 持久化 truth。
  - 重新跑 full live-e2e，并更新 closure / test-topology / api-docs 的最终口径。
- **本计划不重新讨论的设计结论**：
  - 只有 `orchestrator-core` 是 public live 入口；5 个 leaf worker 保持 `workers_dev:false`，继续通过 service binding 被验证（来源：`test/shared/live.mjs`、`docs/architecture/test-topology.md`）。
  - `/models` / `/models/{modelRef}` 当前是 **authenticated route**，HPX2 不会在无上游 design 变更的前提下把它改成 anonymous public list（来源：`workers/orchestrator-core/src/index.ts` 当前实现 + `clients/api-docs/models.md`）。
  - final closure 禁止把 live failure 标成 `silently resolved`；不能修复的项必须显式 retained / downgraded，并同步改写 gate 表述（来源：`docs/design/hero-to-pro/HPX-qna.md` Q33-Q36）。

---

## 1. 执行综述

### 1.1 总体执行方式

HPX2 采用 **先 failure truth freeze → 再修 public WS runtime → 再修 model/evidence/runtime drift → 最后回刷 live tests 与 closure docs** 的顺序。原因很简单：当前 8 项里有 4 项共享同一个 WebSocket 根因，如果不先把 shared runtime seam 修掉，后面的 device revoke / reconnect / roundtrip 都会继续因为同一个 101 问题假红；同样，HP2 model 两个失败项目前是 placeholder test，不先把 contract truth 重写清楚，后面无论修 runtime 还是 rerun，都无法证明“这条线真的闭环了”。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Failure Truth Freeze + Contract Alignment | `M` | 把 8 个失败项按 runtime / flaky / test drift 分类，并冻结修复口径 | `-` |
| Phase 2 | Public WS Chain Repair | `L` | 修 public `/sessions/{id}/ws` façade → User DO attach/reconnect 真实链路 | `Phase 1` |
| Phase 3 | Model / Evidence Runtime Repair | `M` | 修 RH5 usage evidence，补上 HP2 alias/fallback 的真实 live contract | `Phase 1` |
| Phase 4 | Green Gate Revalidation + Docs Sync | `M` | 重新跑 targeted + full live-e2e，并同步 closure / api-docs / topology | `Phase 2-3` |

### 1.3 Phase 说明

1. **Phase 1 — Failure Truth Freeze + Contract Alignment**
   - **核心目标**：明确 8 个失败项里哪些是 runtime 真断点，哪些是 test drift，哪些是 flaky。
   - **为什么先做**：不先分类，后续很容易拿“修测试”掩盖 runtime 漏洞，或拿“修 runtime”去覆盖纯测试错误。
2. **Phase 2 — Public WS Chain Repair**
   - **核心目标**：恢复 `orchestrator-core` public ws attach / supersede / reconnect / revoke-close 的 live 可用性。
   - **为什么放在这里**：4 个失败项共享这个根因，是 full-green gate 的第一 blocker。
3. **Phase 3 — Model / Evidence Runtime Repair**
   - **核心目标**：把 HP2 model live tests 改成真实 contract，把 RH5 evidence drift 修回真实请求。
   - **为什么放在这里**：这些问题不阻止 deploy/health，但会直接阻止 closure gate。
4. **Phase 4 — Green Gate Revalidation + Docs Sync**
   - **核心目标**：拿新的 targeted/full live runs 重新证明环境 readiness，并把 closure 文档说法收敛。
   - **为什么最后**：没有 rerun 证据，前面所有修复都还只是代码层假设。

### 1.4 执行策略说明

- **执行顺序原则**：先共享根因（WS）后单项漂移（model/evidence），先稳定 runtime 再稳定测试。
- **风险控制原则**：不允许只“改断言让测试变绿”而不解释对应 product/runtime truth；每个 failure 都必须有 root cause note。
- **测试推进原则**：每修一类根因，都先跑 targeted live tests，再跑 full `pnpm test:live:e2e`。
- **文档同步原则**：代码 truth 变化必须同步 `HP-full-closure-test-report.md`、`clients/api-docs/`、`test-topology.md`。
- **回滚 / 降级原则**：若某项在 HPX2 周期内无法修成 live runtime truth，必须明确 downgraded gate 与 retained reason，不能继续写成 full-ready。

### 1.5 本次 action-plan 影响结构图

```text
HPX2 full closure fix
├── Phase 1: Failure Truth Freeze + Contract Alignment
│   ├── initial_context verify contract
│   ├── /models authenticated live law
│   └── 8-failure truth matrix
├── Phase 2: Public WS Chain Repair
│   ├── public /sessions/{id}/ws façade
│   ├── User DO attach / supersede / reconnect
│   └── device revoke close path
├── Phase 3: Model / Evidence Runtime Repair
│   ├── RH5 reasoning / vision usage evidence
│   ├── HP2 model alias live path
│   └── model.fallback runtime/event truth
└── Phase 4: Green Gate Revalidation + Docs Sync
    ├── targeted live reruns
    ├── full live-e2e rerun
    └── closure / api docs / topology sync
```

### 1.6 当前 8 个失败项完整分析

| Failure ID | 测试文件 | 当前症状 | 当前代码事实 | 根因判定 | HPX2 修复口径 |
|------------|----------|----------|--------------|----------|----------------|
| F1 | `test/cross-e2e/04-agent-context-initial-context.test.mjs` | `verify.json.pendingCount >= 1` 在 full run 中偶发失败，单独重跑可过 | `verifyInitialContext()` 读取的是 `peekPendingInitialContextLayers()`；pending queue 是 transient / drain-once 语义，不是 durable truth | `flaky / contract mismatch` | 把 live gate 从 raw `pendingCount` 改成稳定 invariant；必要时扩展 verify payload，避免把 ephemeral queue 当产品契约 |
| F2 | `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs` | WS open 失败：`non-101` | public `/ws` 路由在 `orchestrator-core/src/index.ts` 里 synthetic 了一个新 `Request`，只保留极少 headers；User DO attach runtime 需要真实 upgrade 语义 | `runtime blocker` | 修 façade → User DO 的 upgrade passthrough，保留真实 ws handshake 上下文 |
| F3 | `test/cross-e2e/13-device-revoke-force-disconnect.test.mjs` | 因 ws attach 失败，后续 revoke-close 无法验证 | revoke 逻辑本身未先暴露出错误，测试被上游 ws attach failure 短路 | `runtime blocker (dependent)` | 跟随 Phase 2 一起修；attach 恢复后再验证 close code `4001` + old token invalidation |
| F4 | `test/cross-e2e/15-hp2-model-switch.test.mjs` (`model alias resolve`) | 匿名 `GET /models` 返回 401，断言失败 | 当前 `/models` 与 `/models/{modelRef}` 都先过 `authenticateRequest()`；alias resolve 真入口其实是 `GET /models/{modelRef}` | `test drift` | 改成 authenticated live path，并真正验证 alias → canonical resolve，而不是匿名探测 `/models` |
| F5 | `test/cross-e2e/15-hp2-model-switch.test.mjs` (`model.fallback stream event`) | 当前用例只是匿名 `GET /models` placeholder；既不 auth，也不验证 fallback event | 协议 schema 已注册 `model.fallback`，但仓库搜索表明 runtime emitter 还未落地 | `test drift + runtime gap` | 不接受继续用 placeholder 混过关；要么补真实 fallback emit，要么显式降级 gate/docs。HPX2 目标是补真实链路 |
| F6 | `test/package-e2e/orchestrator-core/03-ws-attach.test.mjs` | 首次 ws attach 就拿不到 `101`，稳定复现 | `user-do/ws-runtime.ts` 明确需要 `isWebSocketUpgrade(request)`；当前 public façade 透传方式高概率丢失握手关键 headers / request semantics | `runtime blocker` | 同 F2，一次修掉 attach + superseded 语义 |
| F7 | `test/package-e2e/orchestrator-core/04-reconnect.test.mjs` | reconnect attach 拿不到 `101` | reconnect 依赖同一 public `/ws` chain；不是独立第二根因 | `runtime blocker (dependent)` | 跟随 Phase 2 一起验证；attach 修后再断言 detached reconnect |
| F8 | `test/package-e2e/orchestrator-core/11-rh5-models-image-reasoning.test.mjs` | `nano_usage_events.is_reasoning` 为 `0`，预期 `1` | `readLlmRequestEvidence()` 只读第一条 record，且只看 `content`，不看 `parts`；实际 `/messages` 请求带的是 `parts + reasoning`，容易被历史消息或首条 record 吞掉 | `runtime evidence drift` | 把 evidence 提取切到“当前触发 turn 的真实消息”与 `parts` 形状，并把 `is_reasoning` / `is_vision` 与 usage commit 对齐 |

### 1.7 已核对的当前代码锚点

1. **public `/ws` 路由当前 synthetic 了一个新请求，极可能丢失原始 upgrade 语义**
   - `workers/orchestrator-core/src/index.ts:787-806`
2. **User DO attach runtime 明确要求 `isWebSocketUpgrade(request)`，并在 attach 时返回 `101`**
   - `workers/orchestrator-core/src/user-do/ws-runtime.ts:49-148`
3. **`/models` 与 `/models/{modelRef}` 当前都要求鉴权**
   - `workers/orchestrator-core/src/index.ts:2287-2329`
   - `workers/orchestrator-core/src/index.ts:2338-2375`
4. **HP2 alias resolve 真入口已存在，但 live test 目前没打到它**
   - `workers/orchestrator-core/src/index.ts:1095-1109`
5. **`model.fallback` 目前只有 schema / inspector catalog，没有 runtime emitter 命中**
   - `packages/nacp-session/src/stream-event.ts`
   - `workers/agent-core/src/eval/inspector.ts`
6. **RH5 evidence 提取当前在 `readLlmRequestEvidence()` 里过早返回第一条 record，且 vision 仅看 `content`**
   - `workers/agent-core/src/host/runtime-mainline.ts:230-260`
   - `workers/agent-core/src/host/runtime-mainline.ts:371-393`
   - `workers/agent-core/src/host/runtime-mainline.ts:623-648`
7. **initial_context verify 当前读的是 pending queue，不是 durable acceptance truth**
   - `workers/context-core/src/context-api/append-initial-context-layer.ts:134-153`
   - `workers/agent-core/src/host/do/session-do-verify.ts:272-299`

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 修 public `/sessions/{id}/ws` attach / supersede / reconnect live runtime。
- **[S2]** 修 `device revoke → ws close` 在 live 环境下的真实验证链路。
- **[S3]** 稳定 initial_context verify，使 full run 不再依赖 transient pending queue。
- **[S4]** 把 HP2 model alias / fallback live tests 改成与当前 authenticated route 和 runtime truth 对齐。
- **[S5]** 修 RH5 reasoning / vision usage evidence 的持久化 truth。
- **[S6]** 重新跑 targeted + full live-e2e，并同步 closure / api-docs / test-topology。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 把 5 个 leaf workers 改成 public `workers.dev` URL。
- **[O2]** production deploy / prod schema / manual evidence owner-action。
- **[O3]** 重写 HP2-HP10 的全部功能设计；HPX2 只修 closure 暴露出来的真问题。
- **[O4]** 引入新的 model/product policy 讨论；若需要改变 `/models` auth law，必须回到上游 design/QNA。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| leaf worker 直连 public probe | `out-of-scope` | 当前拓扑冻结为 orchestrator-only public façade | 上游 charter 明确改 topology |
| `/models` 改匿名 public | `out-of-scope` | 当前 product/auth law 已冻结在代码与 client docs | 上游 design/QNA 重开 |
| `model.fallback` runtime emit | `in-scope` | 当前 schema 已有、test 也把它列为 gate，不能继续 placeholder | 若 owner 决定降级 gate，需先改 closure/docs |
| initial_context pending queue 本身改成 durable store | `defer / depends-on-design` | HPX2 先修 closure gate，不在无必要时扩展架构面 | 若稳定验证必须依赖 durable redesign |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | failure truth freeze | `update` | report + test files + runtime anchors | 给 8 个失败项建立唯一根因表 | `medium` |
| P1-02 | Phase 1 | initial_context stable contract | `update` | `session-do-verify.ts`, `04-agent-context-initial-context.test.mjs`, `02-session-start.test.mjs` | 去掉对 transient pending queue 的 gate 依赖 | `medium` |
| P1-03 | Phase 1 | HP2 model live contract rewrite | `update` | `15-hp2-model-switch.test.mjs`, `/models` docs | 让 alias/fallback 测试打到真实 contract | `medium` |
| P2-01 | Phase 2 | public ws passthrough repair | `refactor` | `workers/orchestrator-core/src/index.ts` | 保留真实 ws handshake 语义到 User DO | `high` |
| P2-02 | Phase 2 | ws lifecycle regression closure | `update` | `user-do/ws-runtime.ts` + 4 个 ws 相关 live tests | 让 attach/supersede/reconnect/revoke-close 一起恢复 | `high` |
| P3-01 | Phase 3 | RH5 evidence extraction fix | `refactor` | `runtime-mainline.ts`, `quota/repository.ts`, RH5 live test | 让 `is_reasoning` / `is_vision` 与真实 turn 对齐 | `high` |
| P3-02 | Phase 3 | model.fallback runtime truth | `add` | agent-core/orchestrator-core model/fallback chain + live test | 把 schema-only 变成真实 runtime 行为 | `high` |
| P4-01 | Phase 4 | full live gate rerun | `update` | test commands + report | 用新的 targeted/full live runs 重新证明环境 readiness | `high` |
| P4-02 | Phase 4 | docs + closure sync | `update` | `HP-full-closure-test-report.md`, `hero-to-pro-final-closure.md`, `HP10-closure.md`, `clients/api-docs/*`, `test-topology.md` | 把最终 truth 收敛到文档层 | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Failure Truth Freeze + Contract Alignment

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | failure truth freeze | 把 8 个失败项逐条记录为 `runtime blocker / dependent blocker / flaky / test drift / runtime evidence drift`，并回挂到具体代码锚点 | `HP-full-closure-test-report.md`, 本 action-plan | 后续实现与 closure 不再对 8 项的性质各说各话 | review | 每个 failure 都有唯一分类与 owner workstream |
| P1-02 | initial_context stable contract | 审核 `verifyInitialContext()` 的 pending-queue 语义，决定稳定 gate 改法：优先把测试断言迁到 stable invariant；必要时扩展 verify payload 的 stable counters/source | `session-do-verify.ts`, `04-agent-context-initial-context.test.mjs`, `02-session-start.test.mjs` | initial_context 不再因 full run 时序而假红 | targeted live rerun | 同一测试 full run / 单独 run 结果一致 |
| P1-03 | HP2 model live contract rewrite | 让 alias resolve test 走 authenticated `/models/{modelRef}`，让 fallback test 不再用匿名 `/models` placeholder，而是显式走真实 fallback scenario | `15-hp2-model-switch.test.mjs`, `clients/api-docs/models.md`, `session-ws-v1.md` | HP2 live tests 重新成为“真测试” | targeted live rerun | 两条测试都能说明真实行为，不再只是 reachability 占位 |

### 4.2 Phase 2 — Public WS Chain Repair

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | public ws passthrough repair | 重做 public `/sessions/{id}/ws` → User DO 的 request forwarding，保留原始 upgrade headers / method / ws handshake 语义，同时继续注入 internal authority | `workers/orchestrator-core/src/index.ts`, `auth.ts`, `ws-bridge.ts` | preview live attach 能稳定拿到 `101` | worker tests + targeted live rerun | `03-ws-attach` 与 `04-reconnect` 不再出现 non-101 |
| P2-02 | ws lifecycle regression closure | attach 修复后，补齐 superseded signal、detached reconnect、roundtrip、device revoke close code `4001` 的回归验证；必要时修 `user-do/ws-runtime.ts` 生命周期状态更新 | `user-do/ws-runtime.ts`, `11-orchestrator-public-facade-roundtrip.test.mjs`, `13-device-revoke-force-disconnect.test.mjs`, `03-ws-attach.test.mjs`, `04-reconnect.test.mjs` | 4 个 ws 失败项一起关单，而不是只把第一条 attach 修绿 | targeted live rerun | F2/F3/F6/F7 全部转绿 |

### 4.3 Phase 3 — Model / Evidence Runtime Repair

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | RH5 evidence extraction fix | 重写 `readLlmRequestEvidence()` 的取值策略：不再只看第一条 record；必须识别当前触发 turn 的 `model_id / reasoning / parts(image_url)`，并确保 commit 写入的 `is_reasoning / is_vision` 与真实请求一致 | `workers/agent-core/src/host/runtime-mainline.ts`, `workers/agent-core/src/host/quota/repository.ts`, `11-rh5-models-image-reasoning.test.mjs` | RH5 usage evidence 与 message shape 对齐 | unit + targeted live rerun | RH5 live test 查询到 `is_reasoning=1`、`is_vision=1` |
| P3-02 | model.fallback runtime truth | 不接受继续 schema-only + placeholder test：要么落真实 fallback emitter，要么先改 closure/docs 降级 gate。HPX2 默认目标是实现 fallback emit、持久化 requested/fallback reason，并把 live test 改成真实触发链路 | `workers/agent-core/src/llm/*`, `workers/orchestrator-core/src/session-truth.ts`, `15-hp2-model-switch.test.mjs`, `clients/api-docs/session-ws-v1.md` | `model.fallback` 从 placeholder claim 变成真实 runtime truth | unit + targeted live rerun | fallback test 能观察到真实 frame / truth row，而不是匿名 `/models` reachability |

### 4.4 Phase 4 — Green Gate Revalidation + Docs Sync

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | full live gate rerun | 先跑 ws / initial_context / HP2 / RH5 targeted rerun，再跑 `NANO_AGENT_LIVE_E2E=1 pnpm test:live:e2e`，确认 8 个 failure 关闭或被显式降级 | test commands + temp logs | HPX2 结束时有新的 readiness truth | targeted + full live runs | 不再出现原 8 个红灯；若仍 retained，必须有 reason |
| P4-02 | docs + closure sync | 回写 `HP-full-closure-test-report.md`、`hero-to-pro-final-closure.md`、`HP10-closure.md`、`clients/api-docs/*`、`test-topology.md`，确保不再夸大 readiness | docs + client docs | 阶段 closure 口径与最新 runtime truth 一致 | diff/review | 文档不再写 “环境不满足” 而无具体 failure ledger；ready/not-ready 口径有凭据 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Failure Truth Freeze + Contract Alignment

- **Phase 目标**：先把 8 个失败项的性质和修复方式冻结，避免实现阶段误修。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/HP-full-closure-test-report.md`
  - `test/cross-e2e/04-agent-context-initial-context.test.mjs`
  - `test/package-e2e/orchestrator-core/02-session-start.test.mjs`
  - `test/cross-e2e/15-hp2-model-switch.test.mjs`
- **具体功能预期**：
  1. initial_context 验证不再把 transient pending queue 当唯一 closure gate。
  2. alias resolve / model.fallback 测试都使用 authenticated live contract，不再匿名打 `/models`。
  3. `model.fallback` 若仍未 live，必须被写成显式 gap，而不是假装已有测试覆盖。
- **具体测试安排**：
  - **单测**：必要时为 verify payload 或 model detail route 增补小型 contract tests。
  - **集成测试**：无单独集成 gate，以 targeted live 为主。
  - **回归测试**：`node --test test/cross-e2e/04-agent-context-initial-context.test.mjs test/cross-e2e/15-hp2-model-switch.test.mjs`
  - **手动验证**：用 bearer 实测 `/models` 与 `/models/{modelRef}`。
- **收口标准**：
  - `F1/F4/F5` 的 root cause 和 fix law 写清楚。
  - 后续代码实施不再需要二次讨论“/models 到底该不该匿名”。
- **本 Phase 风险提醒**：
  - 若只给 HP2 测试补 auth，却不补真实 fallback contract，会把 placeholder 伪装成绿灯。

### 5.2 Phase 2 — Public WS Chain Repair

- **Phase 目标**：修掉当前 preview 最重的 shared runtime blocker。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/user-do/ws-runtime.ts`
  - `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs`
  - `test/cross-e2e/13-device-revoke-force-disconnect.test.mjs`
  - `test/package-e2e/orchestrator-core/03-ws-attach.test.mjs`
  - `test/package-e2e/orchestrator-core/04-reconnect.test.mjs`
- **具体功能预期**：
  1. public `/sessions/{id}/ws` 能稳定完成 upgrade，live attach 返回 `101`。
  2. second attach 能收到 superseded signal，reconnect 能在 detached session 上恢复。
  3. device revoke 后 attached socket 被服务器端关闭，并保留旧 token invalidation 行为。
- **具体测试安排**：
  - **单测**：补 public ws forwarding / upgrade preservation contract test。
  - **集成测试**：`workers/orchestrator-core` 针对 ws route 的 worker-level regression。
  - **回归测试**：4 个失败 ws live tests 必跑。
  - **手动验证**：真实 bearer + ws URL 手工 attach 一次，确认 `101`。
- **收口标准**：
  - `F2/F3/F6/F7` 全部转绿。
  - 不再出现 `Received network error or non-101 status code`。
- **本 Phase 风险提醒**：
  - 修 ws route 时不能丢掉 internal authority / trace_uuid 注入，也不能为了保 upgrade 而破坏 auth gate。

### 5.3 Phase 3 — Model / Evidence Runtime Repair

- **Phase 目标**：收敛 model/runtime/evidence 真值，而不是继续维护 placeholder。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 修改文件**：
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `workers/agent-core/src/host/quota/repository.ts`
  - 可能涉及 `workers/agent-core/src/llm/*`
  - `test/cross-e2e/15-hp2-model-switch.test.mjs`
  - `test/package-e2e/orchestrator-core/11-rh5-models-image-reasoning.test.mjs`
  - `clients/api-docs/models.md`
  - `clients/api-docs/session-ws-v1.md`
- **具体功能预期**：
  1. RH5 live path 查询到的 `nano_usage_events` 与真实 `/messages` 请求的 reasoning/image 形状一致。
  2. alias resolve live test 直接验证 `/models/{modelRef}` 的 resolved result。
  3. `model.fallback` 不再只有 schema；要么有真实 emitter 与 evidence，要么 gate/docs 显式降级。
- **具体测试安排**：
  - **单测**：`runtime-mainline` evidence extraction、fallback emission（如实现）单测。
  - **集成测试**：必要时补 model state / fallback repo contract test。
  - **回归测试**：`15-hp2-model-switch.test.mjs`、`11-rh5-models-image-reasoning.test.mjs`
  - **手动验证**：auth 访问 `/models`，并在 preview 上观察 fallback frame（若实现）。
- **收口标准**：
  - `F8` 转绿。
  - `F4/F5` 变成真实 live assertions，而不是探活占位。
- **本 Phase 风险提醒**：
  - 如果 `model.fallback` 最终仍决定保留 schema-only，必须同步把 closure gate 从“期待 live frame”降级，不然 full-green 仍是伪命题。

### 5.4 Phase 4 — Green Gate Revalidation + Docs Sync

- **Phase 目标**：把 HPX2 的结果从“代码上看像修好了”变成新的 closure 证据。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/HP-full-closure-test-report.md`
  - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
  - `docs/issue/hero-to-pro/HP10-closure.md`
  - `docs/architecture/test-topology.md`
  - `clients/api-docs/{models.md,session-ws-v1.md,session.md}`
- **具体功能预期**：
  1. targeted rerun 先证明 shared root cause 已关单。
  2. full live-e2e rerun 给出新的 pass/fail ledger。
  3. closure / api-docs / topology 对 readiness 的描述与 rerun 结果一致。
- **具体测试安排**：
  - **基础校验**：`git diff --check`
  - **回归测试**：targeted live tests → `NANO_AGENT_LIVE_E2E=1 pnpm test:live:e2e`
  - **文档校验**：检查新 report / final closure / docs 是否互相一致
- **收口标准**：
  - HPX2 有新的执行报告与 closure 证据。
  - hero-to-pro 阶段是否 ready-for-full-closure 有明确 yes/no，不再用模糊语言。
- **本 Phase 风险提醒**：
  - 若 rerun 仍有 retained failures，文档必须显式说 retained，不允许“修了大部分所以默认 ready”。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q33-Q36 closure law | `docs/design/hero-to-pro/HPX-qna.md` | HPX2 不能把 failure 模糊结案；必须 repair 或 explicit retained | 若 owner 要改 closure law，需回 design/QNA |
| orchestrator-core 是唯一 public façade | `test/shared/live.mjs`, `docs/architecture/test-topology.md` | WS 修复只能落在 orchestrator public route，不是给 leaf workers 开公网 | 若 topology 改变，需另起 design/charter |
| `/models` 当前需要 auth | `workers/orchestrator-core/src/index.ts`, `clients/api-docs/models.md` | alias/fallback live tests 必须带 bearer，不能继续匿名探测 | 若要改匿名，必须回上游设计冻结 |
| preview deploy 是当前 full live gate 环境 | `scripts/deploy-preview.sh`, `HP-full-closure-test-report.md` | HPX2 的 rerun 目标环境仍是 preview，不混入 production 结论 | 若切 prod gate，需新建 release plan |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| WS root cause 不是单点 | attach 修好后，可能暴露第二层 revoke / reconnect 逻辑问题 | `high` | Phase 2 以 4 个 ws tests 全关为收口，而不是只看 attach |
| fallback runtime 仍未设计完毕 | `model.fallback` 可能需要补 emitter 与 state persistence | `high` | HPX2 不允许保留 placeholder；若确实无法 live，必须同步降级 gate/docs |
| initial_context flake 与 transient queue 耦合 | 单纯增加 sleep 可能治标不治本 | `medium` | 优先把 gate 改成 stable invariant，而不是调 timeout |
| RH5 evidence fix 可能暴露更多 usage shape 问题 | `is_reasoning` 修后，`is_vision` / request_uuid 也可能需要一并对齐 | `medium` | 一次性补全 reasoning + vision + request_uuid 多消息场景测试 |

### 7.2 约束与前提

- **技术前提**：必须复用当前 repo 现有 preview deploy / live-e2e harness，不新造第二套发布测试体系。
- **运行时前提**：Cloudflare preview、D1、Workers AI、GitHub Packages 权限仍保持本轮已验证通过状态。
- **组织协作前提**：若 HPX2 期间需要改变 `/models` auth law 或 fallback 产品语义，必须先回上游 design/QNA 冻结。
- **上线 / 合并前提**：HPX2 结束前必须有新的 full live-e2e ledger；否则不得宣称 full closure ready。

### 7.3 文档同步要求

- 需要同步更新的设计/closure文档：
  - `docs/issue/hero-to-pro/HP-full-closure-test-report.md`
  - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
  - `docs/issue/hero-to-pro/HP10-closure.md`
- 需要同步更新的说明文档 / README：
  - `clients/api-docs/models.md`
  - `clients/api-docs/session-ws-v1.md`
  - `clients/api-docs/session.md`
- 需要同步更新的测试说明：
  - `docs/architecture/test-topology.md`
  - `test/index.md`（如 HP2 model / ws gate 说明发生变化）

### 7.4 完成后的预期状态

1. public ws attach/reconnect/device-revoke close 在 preview live 环境下恢复为可验证真相。
2. RH5 reasoning/image usage evidence 与真实 message payload 对齐，不再出现 `is_reasoning=0` 假值。
3. HP2 model alias / fallback live tests 不再是匿名 placeholder，而是与当前 authenticated/runtime truth 一致的真测试。
4. `HP-full-closure-test-report.md` 与 `hero-to-pro-final-closure.md` 能明确给出新的 ready / not-ready 结论，而不是模糊措辞。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `git --no-pager diff --check`
  - worker/package 受影响模块的 typecheck / test
- **单元测试**：
  - `workers/orchestrator-core` ws route / model route 相关 tests
  - `workers/agent-core` runtime-mainline / usage evidence / fallback 相关 tests
- **集成测试**：
  - 受影响 worker 的 `pnpm --filter ... test`
- **端到端 / 手动验证**：
  - targeted live rerun：
    - `test/cross-e2e/04-agent-context-initial-context.test.mjs`
    - `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs`
    - `test/cross-e2e/13-device-revoke-force-disconnect.test.mjs`
    - `test/cross-e2e/15-hp2-model-switch.test.mjs`
    - `test/package-e2e/orchestrator-core/03-ws-attach.test.mjs`
    - `test/package-e2e/orchestrator-core/04-reconnect.test.mjs`
    - `test/package-e2e/orchestrator-core/11-rh5-models-image-reasoning.test.mjs`
  - full rerun：`NANO_AGENT_LIVE_E2E=1 pnpm test:live:e2e`
- **回归测试**：
  - `pnpm test`
  - 受影响 worker targeted test commands
- **文档校验**：
  - closure / api-docs / topology 三处 readiness 口径一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. 原 8 个失败项全部关闭，或其 retained reason 已显式写入 closure/gate 文档。
2. 4 个 ws 失败项不再出现 `non-101`。
3. RH5 live test 查询到的 usage evidence 与请求 truth 对齐。
4. HP2 alias/fallback tests 成为真实 live assertions，不再是匿名 placeholder。
5. `HP-full-closure-test-report.md` 回填新的 rerun 结果并给出明确 ready/not-ready verdict。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | 8 个失败项对应的 runtime/test/doc gaps 都有明确落点并完成修复或显式降级 |
| 测试 | targeted live reruns 与 full `pnpm test:live:e2e` 结果可支持新的 closure 结论 |
| 文档 | report / final closure / api-docs / topology 全部更新到同一真相 |
| 风险收敛 | 不再存在“测试绿了但 runtime 没解释”或“runtime 修了但 docs 仍写旧 truth” |
| 可交付性 | hero-to-pro 是否满足 full-closure gate 有一份新的可审计证据链 |

---

## 11. 工作日志回填

1. 修复 public websocket façade：
   - `orchestrator-core` 不再 synthetic websocket request；
   - User DO 增补 ws 场景下的原始 token 回退鉴权；
   - `attachServerTimings()` 对 `101/1xx` 透传，消除 response wrapper 对 handshake 的二次破坏。
2. 关闭 4 个 ws live failures：
   - `03-ws-attach`
   - `04-reconnect`
   - `11-orchestrator-public-facade-roundtrip`
   - `13-device-revoke-force-disconnect`
3. 收敛 initial_context gate：
   - `04-agent-context-initial-context.test.mjs`
   - `02-session-start.test.mjs`
   - live 断言切到 durable `/context/layers`，不再依赖 transient pending queue。
4. 回刷 HP2 model live contract：
   - alias resolve 改为 authenticated `/models/{modelRef}`;
   - fallback 用例改为 schema-live metadata truth，不再匿名 placeholder 探测 `/models`。
5. 修正 RH5 运行时与 live gate：
   - agent-core evidence 提取支持全消息扫描和 `parts.image_url`;
   - orchestrator-core model detail 在 capability=true 但 detail arrays 缺失时回填默认 reasoning/image truth；
   - RH5 live 用例改为等待 durable turn/message 持久化结果。
6. 本轮验证结果：
   - `pnpm test` 通过；
   - `NANO_AGENT_LIVE_E2E=1 pnpm test:live:e2e` 通过；
   - full live e2e 最终为 `92 tests / 63 pass / 0 fail / 29 skip`。
