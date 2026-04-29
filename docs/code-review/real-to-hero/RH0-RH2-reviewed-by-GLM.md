# Nano-Agent 代码审查 — RH0~RH2

> 审查对象: `real-to-hero / RH0-RH2 (Bug Fix & Prep / Lane F Live Runtime / Models & Context Inspection)`
> 审查类型: `closure-review + code-review`
> 审查时间: `2026-04-29`
> 审查人: `GLM-5.1`
> 审查范围:
> - `docs/charter/plan-real-to-hero.md` r2（基石纲领）
> - `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md`、`RH1-lane-f-live-runtime.md`、`RH2-models-context-inspection.md`
> - `docs/issue/real-to-hero/RH0-closure.md`、`RH1-closure.md`、`RH2-closure.md`
> - `docs/issue/real-to-hero/RH1-evidence.md`、`RH2-evidence.md`
> - RH0-RH2 全部产出代码（wrangler 配置、测试文件、migration SQL、entrypoint、session-do 拆分、scheduler/route/RPC 实装）
> 对照真相:
> - `docs/charter/plan-real-to-hero.md` §7.1-7.3（Phase 收口标准）+ §4.0-4.5（In/Out-of-Scope + 硬纪律）+ §9.2（统一测试用例数纪律）+ §10.3（NOT-成功退出识别）
> - `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md` §8.2-8.3（收口标准 + DoD）
> - `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md` §8.1-8.3
> - `docs/action-plan/real-to-hero/RH2-models-context-inspection.md` §8.1-8.3
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：RH0-RH2 的核心工程骨架（6-worker 拓扑 + 测试矩阵 + KV/R2 占位 + 巨石预拆分 + Lane F wire 接通 + 跨 Worker RPC topology 建成 + /models + /context 端点落地 + NACP schema 扩展）在结构上是成立的；跨阶段依赖链（RH0 Start Gate → RH1 cross-worker push → RH2 schema + endpoint + context-core RPC）没有断裂。但三个阶段均存在**收口口径与代码事实不一致**的问题——具体表现为 hard gate 数值的声称偏差、carry-over 项的"wire 成立但 live 不成立"口径漂移、以及部分测试名实不符。这些问题不阻塞 RH3 启动，但必须在 closure 文档中做精确修正，否则会在后续 Phase 累积为"基础设施已降落但运行时不可达"的 recurrence。
- **结论等级**：`approve-with-follow-ups`
- **是否允许关闭本轮 review**：`yes`（附条件：R1/R2/R3 必须在 closure 中修正口径，R12 必须在 RH3 启动前获得 owner 签字）
- **本轮最关键的 3 个判断**：
  1. **RH0 hard gate "nano-session-do ≤1500 行" 实际为 1594 行（含空行）/ 1488 行（不含空行）**——closure 以不含空行计数，但 charter 原文是 `wc -l` 语义，需显式声明计量方式或修正为 1594。
  2. **RH1 "4 链 lane F live" 的 live 含义被降级**——`pushServerFrameToClient` 在 `user_uuid` 缺失时返回 `delivered:false`，permission/elicitation/usage push 三链在 preview 环境下实际上不投递 frame；closure 文档称"4 链 wire PASS"是准确的，但 charter §10.3 NOT-成功退出识别第 1 条要求"hook.emit 不再 console.log"——当前 hook.emit 在无 dispatcher 注入时仍走 no-op fallback，而非 charter 要求的"真实 dispatcher"。
  3. **RH2 context-core 3 RPC 返回 `phase: "stub"`**——端点测试只验证了 stub 形状，但 charter §7.3 收口标准第 2 条要求"GET /sessions/{id}/context 与 InspectorFacade 数据互通"，当前无法满足这一条；closure 明确登记了 carry-over 但未对 charter 收口标准做显式降级声明。

---

## 1. 审查方法与已核实事实

### 1.1 审查方法

我独立完成了以下核实工作：

1. **全量阅读** charter §0-10、三份 action-plan 全文、三份 closure 全文、两份 evidence 全文、GPT 严格审查（RH0 action-plan §10）
2. **代码事实核查**：对每个 hard gate 数值做 `wc -l` / `grep -c` / 测试 suite 运行，不依赖 closure 文档声称的数字
3. **跨阶段连贯性审查**：追踪 RH0 → RH1 → RH2 的代码变更是否真正形成连续的依赖链，中间有无断点
4. **命名规范与事实一致性审查**：对比 action-plan 文件路径/函数名与实际代码是否一致
5. **不参考** Kimi、Deepseek、GPT 的分析报告，所有判断基于独立推理

### 1.2 已确认的正面事实

- RH0 P0-A lockfile 重建：`pnpm-lock.yaml` 已重建，`pnpm install --frozen-lockfile` 通过，`@haimang/jwt-shared` 20 case 全绿
- RH0 P0-B 7 份 endpoint test + RH2 新增 models-route / context-route / usage-strict-snapshot 合计 15 文件：orchestrator-core 132 case 全绿
- RH0 P0-C 6 worker `wrangler.jsonc` 全部声明 `NANO_KV` / `NANO_R2` binding
- RH0 P0-D 巨石预拆分：`session-do-verify.ts`（367 行）+ `session-do-persistence.ts`（370 行）已落地；`host/do/` 目录内 0 个新 cycle
- RH0 P0-G 3 个 stress case 存在于 `orchestrator-auth/test/bootstrap-hardening.test.ts`
- RH1 `scheduler.ts` `pendingHookEvents` + `hook_emit` 决策已实装
- RH1 `runtime-mainline.ts` `hook.emit` 已从 no-op 改为 dispatcher delegate（但 dispatcher 实例注入 deferred）
- RH1 `entrypoint.ts` 新建 `OrchestratorCoreEntrypoint` + `forwardServerFrameToClient` RPC 实装
- RH1 `pushServerFrameToClient` 在 `nano-session-do.ts` 已实装，call sites 覆盖 `onUsageCommit` / `onToolEvent` / `emitPermissionRequestAndAwait` / `emitElicitationRequestAndAwait`
- RH1 /usage strict snapshot：3 case（has-rows / no-rows / D1-fail 503）全绿
- RH2 `session.attachment.superseded` NACP schema 已注册，150 case nacp-session 全绿
- RH2 migration 008-models.sql 已落文件（`nano_models` + `nano_team_model_policy`），2-row baseline seed
- RH2 `/models` route + `handleModelsList` + ETag + team policy filter 实装，5 case 全绿
- RH2 context-core 3 RPC method（`getContextSnapshot` / `triggerContextSnapshot` / `triggerCompact`）已实装，返回 `phase: "stub"`
- RH2 `validateLightweightServerFrame` 在 `frame-compat.ts` 已实装，`emitServerFrame` 在 send 前走 schema 校验
- RH2 runtime-mainline `onToolEvent` seam 已 wire 到 `pushServerFrameToClient`
- 全量测试：jwt 20 + nacp-session 150 + orchestrator-core 132 + orchestrator-auth 16 + agent-core 1062 + context-core 171 = **1551**，全绿

### 1.3 已确认的负面事实

- **nano-session-do.ts 当前行数 1594 行**（含空行），closure 声称 1488（不含空行计数）。charter §7.1 收口标准原文为"主文件 ≤1500 行"，以 `wc -l` 计量为 1594，**超出 hard gate**
- **`pnpm check:cycles` 当前输出 10 个循环依赖**（不在 `host/do/` 目录），但全仓 0 cycle 的 hard gate 不满足
- **bootstrap-hardening.test.ts 使用 InMemoryAuthRepository 而非 miniflare/D1 路径**；第二个 case 使用 5ms 而非 5s；第三个 case 为顺序 50 代而非并发 storm。GPT 审查已指出，closure 声称的"3 stress case 全绿"的含义已被弱化
- **7 份 RH0 route test 的覆盖内容偏离 action-plan 表格中声明的行为面**（如 `messages-route` 声称 `403 wrong device` 但实测 `403 missing-team-claim`，`me-devices-route` 声称"已 revoke 不出现"但实测"revoke device 仍出现"）——GPT 审查 F3 已登记
- **6 worker preview deploy 仅 3 个 worker (orchestrator-core / agent-core / context-core) 在 RH2 有新 Version ID**；其余 3 个 worker (orchestrator-auth / bash-core / filesystem-core) 继承 RH0 部署版本——这是正确的（未变更不重部署），但意味着 **这三个 worker 的 KV/R2 占位 binding 在 preview 环境未做 deploy 验证**
- **4 条 Lane F 链中 permission / elicitation / usage push 的真投递在 preview 环境不成功**（`pushServerFrameToClient` 返回 `delivered:false, reason:'no-user-uuid-for-routing'`），瓶颈是 NanoSessionDO 不持有 `user_uuid`
- **HookDispatcher 实例未注入 NanoSessionDO**——seam 就位（`MainlineKernelOptions.hookDispatcher?`），但实例注入 deferred 到 RH3+
- **migration 008 未应用到 preview D1**——sandbox 不允许 remote D1 migrate，`/models` 返回 503

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | nano-session-do.ts 1594 行、user-do.ts 2342 行、所有 test 文件均亲查 |
| 本地命令 / 测试 | yes | `pnpm test` 全套 1551 case、`pnpm check:cycles` 10 cycle、`wc -l` 各关键文件 |
| schema / contract 反向校验 | yes | nacp-session schema 150 case、migration 008 SQL、WRANGLER binding 配置 |
| live / deploy / preview 证据 | partial | 依赖 closure/evidence 文档声称的 preview deploy；未独立做 curl 验证（sandbox 环境限制） |
| 与上游 design / QNA 对账 | yes | charter §7.1-7.3 收口标准逐条核查 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | nano-session-do 行数超出 charter hard gate | high | delivery-gap | no | 修正 closure 口径或补充说明计量方式 |
| R2 | Lane F "4 链 live" 口径与 charter NOT-成功退出条件不一致 | high | docs-gap | no | closure 显式区分 wire/live/delivered 三层语义 |
| R3 | RH2 context-core stub 不满足 charter 收口标准第 2 条 | medium | delivery-gap | no | closure 增加显式降级声明 |
| R4 | bootstrap-hardening 测试强度弱于 action-plan 承诺 | medium | test-gap | no | 已在 GPT 审查中登记；补充说明实际验证语义 |
| R5 | route test 覆盖内容与 action-plan 行为面漂移 | medium | test-gap | no | 已在 GPT 审查中登记；RH3+ 升级时对齐 |
| R6 | migration 008 未应用到 preview D1 — /models 返回 503 | high | delivery-gap | no | owner-action carry-over；必须在 RH3 启动前 apply |
| R7 | user-do.ts 行数 2342 — RH6 拆分目标 ≤500 面临重大挑战 | medium | platform-fitness | no | 观察；不阻塞 RH0-RH2 |
| R8 | pnpm check:cycles 10 cycle — 全仓 0 cycle hard gate 不满足 | low | test-gap | no | closure 已修正为 host/do/ 0 cycle；RH6 cleanup 接收 |
| R9 | NANO_KV / NANO_R2 binding 在 3 个未重部署 worker 未做 preview 验证 | low | platform-fitness | no | RH4 启用业务路径时会自然覆盖 |
| R10 | context-route.test.ts 8 case 而非 charter §9.2 要求的 15 case | medium | test-gap | no | RH4 真实接入时补足每 endpoint ≥5 case |
| R11 | RH1 onUsageCommit 推送为 fire-and-forget（void），与"WS push live"口径偏差 | medium | protocol-drift | no | closure 应显式标注 best-effort 语义 |
| R12 | RH1 P1-06b forwardServerFrameToClient 跨 DO POST 实现的 authority 校验 | medium | correctness | no | RH3+ 补 defense-in-depth header 校验 |

### R1. nano-session-do 行数超出 charter hard gate

- **严重级别**：high
- **类型**：delivery-gap
- **是否 blocker**：no
- **事实依据**：
  - Charter §7.1 收口标准原文："NanoSessionDO 主文件 ≤1500 行"
  - `wc -l workers/agent-core/src/host/do/nano-session-do.ts` = **1594**
  - Closure 声称 "1488 行"——经验证为不含空行的计数
  - P0-D2 action-plan 收口标准："`wc -l nano-session-do.ts` ≤ 1500"
- **为什么重要**：charter hard gate 的原意是限制巨石体积；以 `wc -l` 语义（含空行）计数为 1594，超出 gate 94 行。不含空行计数 1488 满足 gate，但这依赖一种特定的计量方式，action-plan 原文明确写了 `wc -l`。
- **审查判断**：代码拆分本身有效（拆出 verify 367 行 + persistence 370 行 = 737 行迁出），1330 行 net code 大幅少于原始 2078 行。问题不在拆分质量而在计量口径。
- **建议修法**：closure 修正为"nano-session-do.ts 1594 行（含空行）/ 1488 行（不含空行），charter §7.1 hard gate 以不含空行计算满足"；或在 RH3 合并时进一步压缩空行/注释使 `wc -l` 也满足 ≤1500。

### R2. Lane F "4 链 live" 口径与 charter NOT-成功退出条件不一致

- **严重级别**：high
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：
  - Charter §10.3 NOT-成功退出识别第 1 条："Lane F 四链中任一仍是 stub（如 hook.emit 仍 console.log 而非真实 dispatcher）"
  - 当前代码：`hook.emit` 在有 dispatcher 注入时调 dispatcher，无 dispatcher 时走 `return undefined` no-op fallback——既不是 `console.log`，也不是"真实投递 dispatcher"
  - Closure RH1 §0 声称"4 条 lane F side-channel 从 contract-only 升级为可观察 live 的 wire"
  - `pushServerFrameToClient` 在缺少 `user_uuid` 时返回 `delivered:false, reason:'no-user-uuid-for-routing'`——permission / elicitation / usage 三链的全部 frame 投递都走这条路径，因此 **实际 frame 不到达 client**
- **为什么重要**：charter 对 NOT-成功的定义是"hook.emit 仍 console.log"，但当前实现比 console.log 更好（有真实的 delegate 路径）又未达到"frame 真投递到 attached client"。这个中间态需要精确描述而不是笼统的"wire PASS"。
- **审查判断**：RH1 的工作是实质性的——scheduler hook_emit 决策、cross-worker RPC topology、emitPermission+Elicitation await+push、onUsageCommit 推送——全部 wire 已接通。问题在于 closure 使用了比 charter 更宽松的"live"语义。
- **建议修法**：RH1 closure §0 应修订为"4 条 lane F side-channel 的 wire 已接通（scheduler 产 hook_emit 决策 / delegate 路径就位 / emit* 已 push / onUsageCommit 已推送），但 frame 真投递到 attached client 依赖 RH3 D6 user_uuid 注入"——显式区分 wire / live / delivered 三层。

### R3. RH2 context-core stub 不满足 charter 收口标准第 2 条

- **严重级别**：medium
- **类型**：delivery-gap
- **是否 blocker**：no
- **事实依据**：
  - Charter §7.3 收口标准第 2 条："GET /sessions/{id}/context 与 InspectorFacade 数据互通"
  - 实际：context-core 3 RPC 返回 `phase: "stub"`；GET /context 返回 `{status: "ready", summary: "context-core RH2 stub: per-session inspector in RH4", artifacts_count: 0, need_compact: false}`
  - Closure 全面登记了 carry-over 但未对 charter 收口标准做"显式降级"
- **为什么重要**：charter 收口标准是硬 gate；不满足的必须显式标注为"partial"而非"done"
- **审查判断**：stub 是 RH2 原始 action-plan 设计的产物（P2-05/06/07 明确写"context-core 新增 RPC method"并以 inspector facade 为依赖），carry-over 到 RH4 是合理的。但 closure 的 §2 hard gate 表格中 "3 个 context endpoint test ≥ 5×3 = 15 case → 9 case" 也不满足每 endpoint ≥5 的 charter 纪律。
- **建议修法**：closure §2 hard gate 第 5 行应从 `✅` 改为 `partial (stub-shaped)`；同时 context-route.test.ts 应在 RH4 真实接入后补足到每 endpoint ≥5 case。

### R4. bootstrap-hardening 测试强度弱于 action-plan 承诺

- **严重级别**：medium
- **类型**：test-gap
- **是否 blocker**：no
- **事实依据**：
  - Action-plan 承诺：cold-start 100 并发 register / D1 慢响应 5s / refresh chain 旋转风暴
  - 实际：InMemoryAuthRepository 替代 miniflare/D1；5ms 替代 5s；50 顺序生成 替代 并发 storm
  - GPT 审查 F2 已指出，RH0 closure r2 已修正口径
- **审查判断**：GPT 审查 + closure 修正口径已透明处理。3 个 case 存在且通过，但实际验证的语义是"应用层 invariants"而非"平台层 stress"。真实 D1 5s 慢响应需要在 preview deploy 环境验证，这应在 RH3 Phase 6 e2e 中覆盖。
- **建议修法**：无额外行动。GPT R2 已充分处理。

### R5. route test 覆盖内容与 action-plan 行为面漂移

- **严重级别**：medium
- **类型**：test-gap
- **是否 blocker**：no
- **事实依据**：
  - GPT 审查 F3 已逐文件列出 7 份 route test 与 plan 表格的 6 项行为面偏离
  - 具体：`messages-route` 的 `403 wrong device` → `403 missing-team-claim`；`me-devices-route` 的"已 revoked 不出现" → "revoke device 仍出现"；`permission-decision-route` 的 `unknown request_uuid / 已答或超时` → `empty body / unknown sub-action`；`policy-permission-mode-route` 的 `200 read / 400 invalid mode` → `任意 mode 透传`
  - RH0 closure r2 已登记 carry-over 到 RH3+
- **审查判断**：carried over 的原因是代码当前行为确实是这样的（如 `/me/devices` 不过滤 revoked status）。测试忠实反映了现状，但现状未达 plan 的行为面。这是有意的 deferred——RH3 device gate 落地后这些测试需要在更高的行为面上重写。
- **建议修法**：无额外行动。RH3 P3-A device gate 落地时同步升级 route test 行为面。

### R6. migration 008 未应用到 preview D1 — /models 返回 503

- **严重级别**：high
- **类型**：delivery-gap
- **是否 blocker**：no（但 RH3 启动前必须 apply）
- **事实依据**：
  - `008-models.sql` 文件已 commit，schema 正确
  - preview 环境未 apply，`GET /models` 当前返回 503 `models-d1-unavailable`
  - closure 登记 carry-over："sandbox 不允许 remote D1 migrate；owner-action"
- **为什么重要**：charter §7.3 收口标准第 1 条要求"GET /models 返回 ≥ minimal 模型列表"。当前返回 503 不满足这一条。
- **审查判断**：这是预期内的环境限制，不是代码缺陷。但 closure hard gate 第 4 行写 `✅`（models endpoint 5 case test）而实际 live 返回 503——hard gate 是测试通过，不是 preview 返回 200——这两者必须区分。
- **建议修法**：closure §2 hard gate 应显式标注"(5 case test 全绿; migration apply = owner-action carry-over; /models 当前 503 直 至 apply)"。

### R7. user-do.ts 行数 2342 — RH6 拆分目标 ≤500 面临重大挑战

- **严重级别**：medium
- **类型**：platform-fitness
- **是否 blocker**：no
- **事实依据**：
  - charter §7.7 P6-B 收口标准：`user-do.ts 主文件 ≤500 行`
  - 当前 2342 行，与本 Phase (RH0-RH2) 无直接关系但影响 RH6 规划
  - RH1/RH2 在 user-do.ts 新增了 `__forward-frame` 路由、handleUsage strict snapshot、3 个 /sessions/{uuid}/context 路由 handler、models handler、validateServerFrame 等
- **审查判断**：RH6 要将 2342 行压到 ≤500 行（拆出 handlers/* + infrastructure.ts），挑战很大但 charter 已明确规划。当前 RH0-RH2 的增量是必要的功能添加，不应为 RH6 预拆而拒绝。
- **建议修法**：无。作观察项记录。

### R8. pnpm check:cycles 全仓 10 cycle — hard gate "0 global cycle" 不满足

- **严重级别**：low
- **类型**：test-gap
- **是否 blocker**：no
- **事实依据**：
  - `pnpm check:cycles` 输出 10 个循环依赖（GPT 审查时为 10 个，本次复核也是 10 个）
  - Action-plan §4.5 收口标准："`pnpm check:cycles` 0 cycle"
  - 实际：`host/do/` 目录内 0 cycle（RH0 拆分未引入新 cycle），10 个 cycle 全在 packages 与 context-core
- **审查判断**：10 个 cycle 全部 pre-existing（nacp-core / orchestrator-auth-contract / workspace-context-artifacts / agent-core/kernel / context-core），RH0-RH2 未引入任何新 cycle。问题出在 action-plan §4.5 的收口标准写的是全局 `check:cycles` 0 cycle，但 charter §7.1 的 hard gate 原文是"`host/do/` 0 cycle"——后者已经满足。
- **建议修法**：closure 已修正口径为"host/do/ 0 cycle + 全仓 13→10 baseline 不新增"；全仓 0 cycle 由 RH6 cleanup 接收。

### R9. NANO_KV / NANO_R2 binding 在 3 个未重部署 worker 未做 preview 验证

- **严重级别**：low
- **类型**：platform-fitness
- **是否 blocker**：no
- **事实依据**：
  - RH0 P0-C1 在 6 worker wrangler.jsonc 首次声明 NANO_KV + NANO_R2
  - RH0 preview deploy 了全部 6 worker
  - RH2 preview deploy 仅更新了 3 worker (context-core / orchestrator-core / agent-core)
  - 其余 3 worker (orchestrator-auth / bash-core / filesystem-core) 的 wrangler.jsonc 虽然在 RH0 就有 binding 声明，但它们自 RH0 后没有重新 deploy
- **审查判断**：Cloudflare Workers 的 binding 在 deploy 时生效，这些 worker 在 RH0 P0-E1 时已 deploy 并验证过 binding 可见。只要 wrangler.jsonc 没有被后续 PR 移除 binding，它们仍然生效。但建议在 RH3 deploy 时确认。
- **建议修法**：无。RH4 启用业务路径时会自然验证。

### R10. context-route.test.ts 测试用例数不满足 charter §9.2 "每 endpoint ≥5 case"

- **严重级别**：medium
- **类型**：test-gap
- **是否 blocker**：no
- **事实依据**：
  - Charter §9.2："每个新增 public endpoint ≥5 endpoint-level 用例"
  - Charter §7.3 收口标准第 5 条："3 个 context endpoint test ≥5×3 = 15 case"
  - 实际：`context-route.test.ts` 有 8+1=9 case（GET 5 + POST snapshot 2 + POST compact 2），不满足每 endpoint ≥5
  - Closure hard gate 表格写 "9 case" 并标注"符合 charter §7.1 ≥35 case 总线约束"——charter §9.2 要求的是"每 endpoint ≥5"而非"总线 ≥35"
- **审查判断**：POST /context/snapshot 仅 2 case (200 + 401)，POST /context/compact 仅 2 case (200 + 503)。这明显不满足 ≥5 per endpoint。但考虑到这三个 endpoint 当前全部返回 stub，真行为面在 RH4 才落地，当前测试覆盖了对 stub 响应的 facade 校验。
- **建议修法**：RH4 context-core 真实 inspector 接入时，补足每 endpoint ≥5 case。当前 closure hard gate 第 5 行应从 `✅` 改为 `partial (9/15 case, stub-shaped)`。

### R11. onUsageCommit 推送为 fire-and-forget（void），与"WS push live"口径偏差

- **严重级别**：medium
- **类型**：protocol-drift
- **是否 blocker**：no
- **事实依据**：
  - `nano-session-do.ts` line 482：`void this.pushServerFrameToClient({ kind: "session.usage.update", ... })`
  - `onUsageCommit` 用 `void` fire-and-forget，不等待投递结果
  - RH1 closure §0："onUsageCommit live"
  - Charter §4.4 硬纪律 + design §6.1："usage push = best-effort preview"
  - 实际行为：usage push 丢帧不报错，这是 best-effort 的正确语义
- **审查判断**：代码与 design 一致（best-effort），但 closure 用"live"一词容易与"guaranteed delivery"混淆。charter 已明确定义 usage 为 best-effort push，所以代码是正确的——口径修正即可。
- **建议修法**：closure 增加显式标注："`onUsageCommit` push 为 best-effort fire-and-forget（`void` 调用），与 charter §4.4 + design §6.1 usage push 纪律一致"。

### R12. forwardServerFrameToClient 跨 DO POST 实现的 authority 校验审查

- **严重级别**：medium
- **类型**：correctness
- **是否 blocker**：no
- **事实依据**：
  - `entrypoint.ts` 的 `forwardServerFrameToClient` 方法做了输入校验（sessionUuid UUID regex / frame.kind string / meta.userUuid non-empty）
  - 但 authority 校验仅检查 `meta.userUuid` 的存在性，未验证调用方的 service binding identity
  - `__forward-frame` 路由在 `user-do.ts` 仅检查 `frame.kind` 是 string 然后直接 call `emitServerFrame`
- **为什么重要**：此 RPC 是跨 Worker 内部调用（agent-core → orchestrator-core → User-DO），理论上 service binding 已提供 mTLS 保障。但如果未来有其他 worker 或外部路径到达 `__forward-frame`，authority 校验不够严格。
- **审查判断**：当前架构下 service binding mTLS 已足够。`__forward-frame` 不暴露为 public ingress（需 WS attached session），所以风险可控。但建议在未来添加一个 `X-Internal-Call` header 校验作为 defense-in-depth。
- **建议修法**：作 follow-up 记录，不阻塞 RH3 启动。RH3/RH4 添加 `__forward-frame` header 校验作为 defense-in-depth。

---

## 3. In-Scope 逐项对齐审核

> 对照 charter §4.1 / action-plan / closure claim 逐项审核

### RH0 In-Scope 对齐

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S-RH0-1 | P0-A: jwt-shared lockfile 重建 | done | pnpm-lock.yaml 重建，stale importer 删除，独立 build/typecheck/test 全绿 |
| S-RH0-2 | P0-B: ≥7 endpoint test ≥35 case | done | 7 文件 35 case 存在且全绿；但行为面有 6 项漂移（GPT F3） |
| S-RH0-3 | P0-C: KV/R2 binding 占位 | done | 6 worker wrangler.jsonc 全部声明 NANO_KV + NANO_R2 |
| S-RH0-4 | P0-D: NanoSessionDO 拆分 ≤1500 行 | partial | 含空行 1594 行（超 gate 94 行）；不含空行 1488 行满足 |
| S-RH0-5 | P0-E: preview deploy + manual smoke | done | 6 worker 健康可达；补做了 7-step 业务流 smoke |
| S-RH0-6 | P0-F: owner-action checklist | done | 8 步全 pass，文档归档 |
| S-RH0-7 | P0-G: bootstrap hardening 3 case | done | 3 case 存在且全绿；但强度弱于 plan 承诺（InMemory/5ms/顺序） |

### RH1 In-Scope 对齐

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S-RH1-1 | P1-A: hook.emit delegate 真实化 | done | runtime-mainline hook.emit 改为 dispatcher delegate；但 dispatcher 实例注入 deferred |
| S-RH1-2 | P1-B: scheduler 产生 hook_emit 决策 | done | pendingHookEvents + FIFO drain 实装，4 case 全绿 |
| S-RH1-3 | P1-C: emitPermission/Elicitation 真 emit | partial | push frame 代码已就位；但因缺少 user_uuid，delivered:false；await 路径仍工作 |
| S-RH1-4 | P1-D: onUsageCommit WS push | partial | push 代码就位；fire-and-forget (void)；delivered:false 因无 user_uuid |
| S-RH1-5 | P1-D: forwardServerFrameToClient RPC | done | entrypoint.ts + __forward-frame 路由实装并 deploy |
| S-RH1-6 | P1-E: handleUsage 不再返 null | done | 3 case（has-rows / no-rows / D1-fail）全绿，preview 验证 zero-shape live |
| S-RH1-7 | Lane F 4 链 e2e | partial | 单元覆盖 wire；真投递 e2e 待 user_uuid 注入（RH3 D6） |

### RH2 In-Scope 对齐

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S-RH2-1 | P2-A: GET /models endpoint | partial | route + handler + ETag + team filter 实装，5 case 全绿；但 /models 当前返回 503（migration 未 apply） |
| S-RH2-2 | P2-B: GET /sessions/{id}/context | partial | 3 RPC method 实装，但返回 phase: "stub"；与 InspectorFacade 无数据互通 |
| S-RH2-3 | P2-C: WS full frame upgrade | partial | validateLightweightServerFrame gate 已实装；handleWsAttach 升级 + heartbeat 4 case deferred |
| S-RH2-4 | P2-D: Tool semantic streaming | done | onToolEvent seam wire 到 pushServerFrameToClient，llm.delta + tool.call.result frame emit |
| S-RH2-5 | P2-E: LLM delta policy doc | done | docs/api/llm-delta-policy.md 存在且内容充分 |
| S-RH2-6 | NACP session.attachment.superseded schema | done | 4 case nacp-session 测试全绿 |
| S-RH2-7 | client adapter sync | audit-only | clients/web/src/RH2-AUDIT.md 落档；实际 UI 升级 deferred |

### 对齐结论

- **done**: 11
- **partial**: 6
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0

这更像"骨架已搭好，但多根肋骨是软骨而非硬骨"——wire 与 topology 成立，但 delivered/live 语义被 carry-over 到 RH3/4/6。这个状态对于 sequential phase 推进是可接受的，但 charter 收口标准的"每项必须 done 或显式降级"纪律必须严格执行。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | admin plane | 遵守 | 无 admin 相关代码产生 |
| O2 | billing / quota | 遵守 | 无 billing 代码 |
| O3 | second LLM provider | 遵守 | 无 DeepSeek/OpenAI adapter 启用 |
| O4 | catalog 真实 plug-in 注册 | 遵守 | 无新 worker 或 registry |
| O5 | sandbox 隔离 | 遵守 | 无 sandbox 代码 |
| O6 | OAuth federation | 遵守 | 无 OAuth provider |
| O7 | logout endpoint | 遵守 | 无 logout route |
| O8 | SQLite-DO | 遵守 | wrangler.jsonc 无 new_sqlite_classes |
| O9 | 第 7 worker | 遵守 | 6 worker 拓扑不变 |
| O10 | NACP error envelope 重构 | 遵守 | 无 NacpEnvelope 引入 |
| O11 | 三层错误信封统一 | 遵守 | 无 facadeFromRpcEnvelope 引入 |
| O12 | token-level streaming | 遵守 | LLM delta policy 显式 out-of-scope |
| O13 | streaming progress for bash | 遵守 | 无 long-running bash progress |
| O14 | conversation CRUD / FTS | 遵守 | 无 title / archive / search |
| O15 | user profile CRUD | 遵守 | 无 profile 更新路由 |
| O16 | Tier-B/C evidence 前 RH6 | 遵守 | 无真机 / 微信 devtool evidence |

**Out-of-Scope 全部遵守**。无越界发现。

---

## 5. 跨阶段深度分析

本节扩展审查面积，对 RH0-RH2 全阶段进行跨阶段、跨包的深度分析，识别盲点、断点、命名/逻辑错误。

### 5.1 跨阶段依赖链完整性

```
RH0 Start Gate
  ├── jwt-shared lockfile ✅ → 后续所有 build 依赖
  ├── KV/R2 binding 占位 ✅ → RH4 业务路径
  ├── endpoint test baseline ✅ → 后续所有 endpoint 修改回归基线
  ├── NanoSessionDO 预拆分 ✅ → RH1-RH5 巨石内施工成本降低
  └── bootstrap hardening ⚠️ → 强度弱，RH3+ 需补真 D1 stress

RH1 Lane F Live
  ├── scheduler hook_emit ✅ → RH2+ 所有 hook 触发
  ├── ORCHESTRATOR_CORE binding ✅ → RH2 context-core RPC + RH3 device push
  ├── forwardServerFrameToClient RPC ✅ → RH2+ 所有 server→client push
  ├── pushServerFrameToClient ⚠️ → wire 就位但 delivered:false(no user_uuid)
  ├── onUsageCommit push ⚠️ → fire-and-forget, best-effort
  └── HookDispatcher 注入 ⚠️ → seam 就位，实例 deferred

RH2 Client Visibility
  ├── /models route ✅ → RH5 model picker 依赖
  ├── context-core 3 RPC ⚠️ → stub-shaped, RH4 真实接入
  ├── NACP attachment.superseded ✅ → RH3 device-revoke 可直接 emit
  ├── validateLightweightServerFrame ✅ → 所有后续 server frame 经 schema gate
  ├── onToolEvent → push ✅ → tool 执行可见
  └── client adapter ⚠️ → audit-only, deferred
```

**关键断点**：RH1 的 Lane F wire 链中，`pushServerFrameToClient` 因缺少 `user_uuid` 而全部返 `delivered:false`。这意味着 RH3 D6 device gate（IngressAuthSnapshot.user_uuid 进入 NanoSessionDO）是整个 cross-worker push topology 从 wire 变成 live 的关键门。如果 RH3 device gate 推迟或变更方案，RH1-RH2 的 Lane F 和 RH2 的 tool stream 都无法真正投递 frame。这个风险在 closure 中没有被充分强调。

### 5.2 命名规范一致性

| 领域 | RH0-RH2 使用 | charter / design 使用 | 一致性 |
|------|--------------|----------------------|--------|
| WorkerEntrypoint | `OrchestratorCoreEntrypoint` | 设计未规定具体名字 | ✅ |
| RPC method | `forwardServerFrameToClient` | 设计写"forwardServerFrameToClient" | ✅ |
| Internal route | `__forward-frame` | action-plan 未给出具体名字 | ✅ 新增 |
| Migration | `008-models.sql` | charter §8.4 冻结 | ✅ |
| Route path | `/sessions/{uuid}/context` / `/sessions/{uuid}/context/snapshot` / `/sessions/{uuid}/context/compact` | 设计写 `/sessions/{id}/context*` | ✅ |
| Binding | `NANO_KV` / `NANO_R2` | action-plan 仅写"占位" | ✅ |
| WS frame kind | `session.permission.request` / `session.elicitation.request` / `session.usage.update` / `llm.delta` / `tool.call.result` / `session.attachment.superseded` | 设计 + charter 一致 | ✅ |

命名规范未见重大不一致。`__forward-frame` 作为内部路由使用了双下划线前缀，合理地区分了 public ingress 和 internal routing。

### 5.3 三层真相纪律审查

Charter §4.4 硬纪律第 3 条："三层真相不互相吸收（DO memory / DO storage / D1）"。

| 层 | 当前状态 | RH0-RH2 是否违反 |
|------|----------|------------------|
| DO memory (NanoSessionDO) | hook_emit 决策 / onToolEvent / emitPermission+emitElicitation await | 否——全在 DO memory 中 |
| DO storage (User-DO KV) | onUsageCommit push → User-DO emitServerFrame; /usage 查 D1 | 否——usage push 走 DO + WS；/usage HTTP 走 D1 |
| D1 | models 表 / team policy 表 / usage events 表 | 否——新增 008-models.sql 仅查 D1 |

**未发现三层真相违反。** context-core stub 返回的 `phase: "stub"` 明确标注了不是真实数据，没有用 D1 数据冒充 DO memory 数据。

### 5.4 collateral fix 审查

RH0 P0-E1 collateral fix 在 `user-do.ts` 中的 `AgentRpcMethodKey` union 增加了 `'permissionDecision' | 'elicitationAnswer'`——这两个方法在 RH1 P1-C/P1-D 才实装。RH0 把它们加入 union 是为了让 6 worker preview build green（否则 TypeScript 编译报错），这是正确的先做。

RH2 在 `entrypoint.ts` 中创建了 `OrchestratorCoreEntrypoint`，把 `main` 从 `dist/index.js` 改为 `dist/entrypoint.js`——这修改了 wrangler.jsonc 的 entrypoint。RH1 closure 确认了这一点但未在 RH2 closure 中再次确认 entrypoint 切换的影响域。实际上 `index.ts` 仍保留 `worker` 对象的命名导出，vitest 可以无障碍 import。

### 5.5 RH2 P2-14/15 Client Adapter — audit-only 的风险

RH2 closure 明确标注 P2-14/15 为 "audit-only"，`clients/web/src/RH2-AUDIT.md` 评估升级工作量 M-L。这意味着：

1. Web client 仍只消费 lightweight `{kind, ...}` frame
2. `session.attachment.superseded` / `tool.call.result` / `llm.delta` 这些新 frame type 在 web client 无消费侧代码
3. Wechat miniprogram client 同理

这个状态的实质是：**服务端 emits NACP frame 但没有客户端消费它们**。对于 tool stream 来说，这意味着 P2-D "tool semantic streaming" 在 preview 环境中是不可观测的——因为没有客户端渲染 tool_use_start/delta/result。

这不违反 out-of-scope（charter §4.2 O16），但 closure 和 evidence 不应暗示"tool stream 在客户端可见"——目前仅在服务端 wire 层面成立。

### 5.6 `onUsageCommit` best-effort 语义 vs `/usage` strict consistency

Charter §4.4 硬纪律和 design §6.1 确立了双轨政策：
- WS push = best-effort
- HTTP snapshot = strict

当前实现：
- WS push: `void this.pushServerFrameToClient(...)` — fire-and-forget，丢帧不报错 ✅
- HTTP `/usage`: `handleUsage` no-rows 返回 zero-shape 200, D1-fail 返回 503 ✅

**潜在风险**：当 `pushServerFrameToClient` 的 `delivered:false` 频繁发生（如 user_uuid 缺失期间），WS 客户端看到的 usage 是空的，但 `/usage` HTTP 端点返回的是准确的 D1 数据。这两种数据源的不一致是设计意图（best-effort vs strict），但需要在文档中清晰说明，否则客户端开发者可能以为 WS usage update 是 reliable source。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：RH0-RH2 阶段的工程骨架在结构上成立——6-worker 拓扑未变、Start Gate 基础设施已冻结、跨 Worker RPC topology 已建成、3 个新端点已落地、NACP schema 已扩展、巨石预拆分有效。但 closure 文档存在若干口径与代码事实不精确对齐的问题，需要在收口前修正。核心问题不在代码质量，而在 **wire vs live vs delivered 三层语义的精确表述**。
- **是否允许关闭本轮 review**：yes
- **关闭前必须完成的 blocker**：无硬 blocker
- **可以后续跟进的 non-blocking follow-up**：
  1. R1: 修正 nano-session-do 行数口径（含空行 1594 / 不含空行 1488），或进一步压缩使 `wc -l` ≤1500
  2. R2: RH1 closure 显式区分 wire / live / delivered 三层语义
  3. R3: RH2 closure 对 context-core stub 做 charter 收口标准显式降级声明
  4. R6: migration 008 必须在 RH3 启动前 apply 到 preview D1
  5. R10: context-route.test.ts 在 RH4 真实接入时补足每 endpoint ≥5 case
  6. R12: `__forward-frame` 添加 internal call header 校验作为 defense-in-depth
- **建议的二次审查方式**：independent reviewer（建议 RH3 完成后对 RH0-RH3 做整体 rereview，重点在 Lane F live 投递是否因 D6 user_uuid 注入而真正成立）
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §6 append 回应，不要改写 §0–§5。

---

## 附录 A — 审查质量评估(by Opus 4.7,实施者反向评价)

> 评价对象: `GLM-5.1 对 real-to-hero / RH0-RH2 三阶段的代码审查`
> 评价人: `Opus 4.7(实施者,基于 4 reviewer 整体回应中实际验证的 finding 真伪 + 修复成本)`
> 评价时间: `2026-04-29`

### A.0 评价结论

- **一句话评价**:数值精度最高的 reviewer(`wc -l` 含/不含空行的 1594 vs 1488 区分是其他 reviewer 都没做的细致工作);findings 数量最多(12 个)但 verdict 最宽松(approve-with-followups);适合做"度量精度审计 + ops/defense-in-depth follow-up 提议"。
- **综合评分**:**8.0 / 10**
- **推荐使用场景**:闭合阶段做 hard gate 数值口径核对(行数 / case 数 / 测试覆盖率)、对 ops/defense-in-depth 类小 follow-up 敏感的场景。
- **不建议单独依赖的场景**:寻找 critical 代码 fix 时,GLM 倾向于把代码层面的真实问题(如 superseded path)也归类为 medium docs-gap 而非 critical drift;verdict 偏宽松(approve-with-followups)可能掩盖核心 blocker。

### A.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | 数值精度 + checklist 完整度 + ops/defense-in-depth 视角 | R1 把"nano-session-do.ts 1594 vs 1488 行数差"提炼成"含/不含空行计量方式"的方法论问题(其他 reviewer 都默认接受 1488)|
| 证据类型 | `wc -l` 等命令实测 + 行号 + matrix 表格交叉验证 | R8 / R10 / R11 都用了"实测命令输出 + action-plan 原文 + closure 原文"三方对照 |
| Verdict 倾向 | balanced(approve-with-followups,4 reviewer 中最宽松)| §0 写 "整体判断:核心工程骨架成立...不阻塞 RH3 启动,但必须在 closure 中精确修正" |
| Finding 粒度 | fine(12 项,粒度最细,部分单点观察)| R7(user-do.ts 行数)/ R9(KV/R2 binding 未在 3 worker preview 验证)/ R12(authority 校验 defense-in-depth) 都是单点 follow-up 观察 |
| 修法建议风格 | actionable + 双轨(修文档 OR 修代码)| R1 给出"修正 closure 口径或进一步压缩 wc -l ≤1500"二选一;R5 给出"测试中显式 TODO 注释,不掩盖未实装事实"的具体编码建议 |

### A.2 优点与短板

#### A.2.1 优点

1. **数值精度最高,识别度量口径漂移** — R1 是 4 reviewer 中唯一识别"action-plan 原文 `wc -l` 语义 vs closure 实际 unit-stripped 计数"的差异的 reviewer。这种度量精度审计在 hard gate 文化下尤其重要 — 如果 reviewer 都默认接受 closure 的报数,gate 数字会逐步漂移失真。修复:RH0 closure §2 hard gate cell 显式标注 1488(unit-stripped) / 1594 (`wc -l`);RH6 megafile decomp 二次压缩兜底。
2. **§5 跨阶段深度分析** — GLM 是唯一专门做了 §5 深度分析的 reviewer(其他 reviewer 把跨阶段分析散在 §3 对齐表中)。§5.1 跨阶段依赖链完整性图、§5.3 三层真相纪律审查、§5.6 onUsageCommit best-effort vs /usage strict consistency 风险 — 这些是需要把 RH0/RH1/RH2 三阶段一起读才能产生的视角,4 reviewer 中只有 GLM 做了这个深度。
3. **ops / defense-in-depth follow-up 视角** — R12 对 `forwardServerFrameToClient` 的 authority 校验提议轻量 `X-Internal-Call` header 校验作为 defense-in-depth — 这是其他 reviewer 没有的安全工程师视角。本回应已将其纳入 RH3 §2.1.1 C5 吸纳为 P3-S5 access path 一行 if 检查(工作量 XS)。

#### A.2.2 短板 / 盲区

1. **未把 R3(context stub)/ R6(migration 008 503)升级为 high blocker** — 4 reviewer 中唯一一个 verdict 是 approve-with-followups;deepseek/GPT/kimi 都是 changes-requested。GLM 对 stub-shaped 与 503 直发的容忍度高于 charter §7.3 收口标准要求,可能源于"closure 已诚实标注 carry-over"的乐观判断;但 charter §7.3 收口标准是硬 gate,不应因 carry-over 已登记就降级为 follow-up。
2. **未捕捉 GPT R3 critical protocol drift** — GLM R3 提到 charter §7.3 第 2 条不满足,但仅停留在 "endpoint 返回 stub" 的层次;没有反向 safeParse 检查 superseded payload 与冻结 schema 的字段不符。GLM 的 schema 视角偏 routing/registry 层,没下到 zod body 字段级。
3. **R7 / R9 / R12 是 follow-up 观察而非 finding** — R7(user-do.ts 2342 行,charter §7.7 RH6 才拆)、R9(KV/R2 binding 在 3 个未重部署 worker 未做 preview 验证)、R12(authority defense-in-depth)严格意义上不是 RH0-RH2 阶段的 finding,而是"未来 phase 的预备 follow-up"。把它们列入正式 finding 表稀释了核心 blocker 的优先级感知。
4. **R10 与 RH2 closure §2 hard gate 表 cross-validation 不全** — R10 指出 context endpoint 9 case 不满足每 endpoint ≥5,但 closure §2 hard gate 行 verdict 仍 ✅。GLM 把这归到 medium follow-up,实际本轮回应里我把它升级为 fixed(补 6 case 至 15)— 因为 charter §9.2 是硬纪律,不应被 "≥35 总线" 软化。GLM 的 verdict 校准在这点上略宽。

### A.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| R1(nano-session-do 行数计量)| high | true-positive(度量精度,**missed-by-others**)| **excellent** | 4 reviewer 中唯一识别 1594 vs 1488 度量差;deepseek R3 用 1594 但未追问计量方式;GPT/kimi 默认接受 1488。修复:RH0 closure §2 cell 显式标注 + RH6 兜底。|
| R2(Lane F wire vs delivered)| high | true-positive(blocker)| excellent | 与 GPT R2 / deepseek R1 / kimi R6 cross-validation;GLM 在 charter §10.3 NOT-成功退出条件解读上略宽(认为 hook.emit no-op fallback 比 console.log 好就不算违反),实际 charter 原文是 "stub or console.log"。|
| R3(context stub 不满足 charter §7.3)| medium | true-positive | good | deepseek R2 升 high,GLM 升 medium;严重级别 GLM 偏宽;但 finding 本身正确。修复:RH2 closure §0 重写。|
| R4(bootstrap 强度不足)| medium | true-positive | good | 与 GPT R2 隐含 / deepseek R6 / kimi R2 cross-validation。修复:口径降级 + RH6 carry-over。|
| R5(route test 偏离 action-plan 行为面)| medium | true-positive | good | GPT F3 已先期登记;GLM 补充了 messages-route 403 wrong-device → 403 missing-team-claim 等具体偏离样本。修复:RH3 §2.1.1 C7 吸纳。|
| R6(migration 008 未 apply)| high | true-positive | good | deepseek/GPT 升 medium,GLM 升 high;GLM 严判合理(charter §7.3 收口标准第 1 条要求 /models 返 ≥minimal 列表)。修复:RH3 entry-gate prereq。|
| R7(user-do.ts 2342 行 RH6 挑战)| medium | partial(observation,非本阶段 finding)| weak | 这是 RH6 platform-fitness 观察,严格意义上不属于 RH0-RH2 review scope。GLM 自己也写"作观察项记录"。把它列入 finding 表稀释优先级。|
| R8(check:cycles 10 cycle)| low | true-positive | good | 与 deepseek R5 / kimi R1 / GPT R1 隐含 cross-validation;GLM 把 severity 评为 low 与 closure 已修正口径相符。|
| R9(3 worker 未重部署)| low | partial(false-alarm-ish)| weak | GLM 自己也承认 "Cloudflare Workers 的 binding 在 deploy 时生效,这些 worker 在 RH0 P0-E1 时已 deploy 并验证过 binding 可见"。这是一个先建后破的 finding,不是真问题。 |
| R10(context tests 9 vs 15)| medium | true-positive | excellent | charter §9.2 ≥5/endpoint 硬纪律,GLM 严判;实施者本轮直接补 6 case 至 15。修复:fixed。|
| R11(onUsageCommit fire-and-forget)| medium | true-positive | good | 与 charter §4.4 + design §6.1 best-effort 纪律一致;GLM 指出 "live" 措辞容易混淆。修复:RH1 closure Phase 4 verdict 加 wire-only/best-effort skip 标注。|
| R12(forwardServerFrameToClient authority defense-in-depth)| medium | partial(follow-up 观察,**missed-by-others**)| good | 唯一 ops/defense-in-depth 视角的 finding;不是 RH0-RH2 blocker,但 RH3+ 值得加。修复:RH3 §2.1.1 C5 吸纳。|

**总计**:12 个 finding,2 excellent(R1 度量精度 + R10 charter §9.2 严判)+ 7 good + 1 partial-but-good(R12 follow-up)+ 2 weak(R7 跨阶段观察 / R9 false-alarm)+ 0 false-positive(严格意义上 R9 接近 false-alarm 但 GLM 自己已声明)。命中率 ~92%,excellence 率 17%。

### A.4 多维度评分(单向总分 10 分)

| 维度 | 评分 | 说明 |
|------|------|------|
| 证据链完整度 | 9 | `wc -l` / `pnpm check:cycles` / charter §X 行号引用 三层证据齐全;部分 zod schema 反查不深(未到字段级)|
| 判断严谨性 | 7 | verdict approve-with-followups 偏宽(R3 / R6 严重级别低估);R7/R9 严重级别 / scope 校准模糊 |
| 修法建议可执行性 | 9 | R1 二选一修法 + R12 具体 header 校验代码建议都很 actionable |
| 对 action-plan / design / QNA 的忠实度 | 9 | charter §7.1/7.2/7.3 + §9.2 + §10.3 引用密度高;§9.5 evidence 三层 GLM 提议加 Tier-0 一档 |
| 协作友好度 | 9 | §5 跨阶段深度分析非常 reviewer-friendly;但 12 项 finding 表略密集,核心 blocker 与 follow-up 没充分分层 |
| 找到问题的覆盖面 | 9 | 12 项 finding,跨 RH0/RH1/RH2 + 度量 + ops + defense-in-depth + cross-phase 多维度;唯一漏 GPT R3 critical |
| 严重级别 / verdict 校准 | 6 | verdict 偏宽是 4 reviewer 中最弱项;R3/R6 严重级别低估;R7/R9 把观察当 finding 也是校准问题 |

**综合**:**8.0 / 10**

> GLM-5.1 的"度量精度 + ops follow-up + 跨阶段深度分析"是 4 reviewer 中独特的价值,但 verdict 校准偏宽(approve-with-followups)和把观察当 finding 是主要短板。最适合做"hard gate 数值审计 + RH3+ defense-in-depth follow-up 评估";单独依赖时 verdict 易偏宽,需配 GPT 或 deepseek 守住 critical / blocker 严判。