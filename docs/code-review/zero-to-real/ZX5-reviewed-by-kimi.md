# ZX5 Protocol Hygiene + Product Surface + Architecture + Runtime Hookup — 审查报告

> 审查对象: `ZX5 全 4 lanes (C/D/E/F)`
> 审查类型: `closure-review`
> 审查时间: `2026-04-28`
> 审查人: `kimi`
> 审查范围:
> - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`(v3)
> - `docs/issue/zero-to-real/ZX5-closure.md`
> - `packages/jwt-shared/`, `packages/orchestrator-auth-contract/`, `workers/*/src/`, `clients/`, `scripts/`, `docs/runbook/`
> 对照真相:
> - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`
> - `docs/issue/zero-to-real/ZX4-closure.md` §3.2 cluster handoff
> - `docs/code-review/zero-to-real/ZX3-ZX4-reviewed-by-{GPT,kimi,GLM,deepseek}.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：ZX5 主体骨架已落地，Lane C/D 大部分交付物成立；Lane E/F 存在显著“infra 就绪但 integration 未 wire”的 partial 状态；跨阶段累积债务（user-do.ts 膨胀、forwardInternalJsonShadow 命名、R28 根因）未收敛。
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`yes`（ZX5 closure 可收，但 §3.2/§3.3 的 follow-up 必须转入 backlog 并指派 owner）
- **本轮最关键的 1-3 个判断**：
  1. **Lane F1/F2/F3 的“infra land”不等于“业务闭环”**：NanoSessionDO 的 wait-and-resume 与 onUsageCommit callback 都已存在，但 PermissionRequest hook dispatcher、ElicitationRequest hook dispatcher、以及 NanoSessionDO 对 onUsageCommit 的 emitServerFrame 调用均未 wire。这是 closure 中刻意模糊为“partial-by-design”的核心缺口。
  2. **Lane C6 的“shared helper migration”存在语义漂移**：action plan 要求“删手写实现，改用 @haimang/nacp-session root export”，实际落地的是本地 mirror + JS adapter，并未真正通过 npm package 消费 shared helper。行为对齐 ≠ 架构对齐。
  3. **跨阶段债务持续累积**：user-do.ts 从 ZX4 的 1910 行膨胀到 2240 行（+330），ZX4 Phase 0 的 seam extraction 收益被 ZX5 新 handler 完全吞噬；forwardInternalJsonShadow 命名漂移自 ZX2 遗留至今；R28 根因从 ZX4 carryover 到 ZX5 仍未定位。

---

## 1. 审查方法与已核实事实

### 1.1 对照文档

- `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`(v3, 669 行)
- `docs/issue/zero-to-real/ZX5-closure.md`(335 行)
- `docs/issue/zero-to-real/ZX4-closure.md`(274 行, 用于 cluster handoff 对照)
- `docs/templates/code-review.md`(审查模板)

### 1.2 核查实现

- `packages/jwt-shared/src/index.ts`(238 行) + `test/jwt-shared.test.ts`(176 行, 20 unit)
- `workers/orchestrator-core/src/auth.ts`(179 行) — jwt-shared import 路径
- `workers/orchestrator-auth/src/jwt.ts`(143 行) — jwt-shared import 路径
- `packages/orchestrator-auth-contract/src/facade-http.ts`(213 行) — `_rpcErrorCodesAreFacadeCodes` 断言
- `packages/orchestrator-auth-contract/README.md`(144 行) + `packages/nacp-core/README.md`(141 行, cross-link)
- `workers/orchestrator-auth/test/kid-rotation.test.ts`(112 行, 5 unit)
- `clients/web/src/heartbeat.ts`(49 行) + `clients/wechat-miniprogram/utils/heartbeat-adapter.js`(60 行)
- `scripts/deploy-preview.sh`(126 行)
- `workers/orchestrator-core/src/catalog-content.ts`(99 行)
- `workers/orchestrator-core/src/index.ts`(854 行) — route 定义
- `workers/orchestrator-core/src/user-do.ts`(2240 行) — D3-D6 handler + F4 idempotency
- `workers/orchestrator-core/src/session-truth.ts`(899 行) — `claimPendingForStart`
- `workers/orchestrator-core/migrations/007-user-devices.sql`(57 行)
- `workers/context-core/src/index.ts`(110 行) + `workers/filesystem-core/src/index.ts`(89 行)
- `workers/agent-core/src/host/do/nano-session-do.ts`(2052 行) — F1/F2 wait-and-resume infra
- `workers/agent-core/src/host/runtime-mainline.ts`(345 行) — F3 onUsageCommit callback
- `workers/agent-core/src/hooks/permission.ts`(70 行) — 未改造为 await/resume
- `workers/agent-core/wrangler.jsonc`(95 行) — CONTEXT_CORE / FILESYSTEM_CORE 仍 commented out
- `docs/runbook/zx5-r28-investigation.md`(141 行)

### 1.3 执行过的验证

- `pnpm test:contracts` → 31 pass ✅
- `pnpm -F @haimang/jwt-shared test` → 20 pass ✅
- `pnpm -F @haimang/orchestrator-auth-contract test` → 19 pass ✅
- `pnpm -F @haimang/orchestrator-core-worker test` → 77 pass ✅
- `pnpm -F @haimang/agent-core-worker test` → 1056 pass ✅
- `pnpm -F @haimang/bash-core-worker test` → 374 pass ✅
- `pnpm -F @haimang/orchestrator-auth-worker test` → 13 pass ✅
- `pnpm -F @haimang/context-core-worker test` → 171 pass ✅
- `pnpm -F @haimang/filesystem-core-worker test` → 294 pass ✅
- `ls workers/ | wc -l` → 6 ✅
- `grep -r "emitPermissionRequestAndAwait" workers/agent-core/src/ --include="*.ts" | grep -v nano-session-do.ts` → 0 匹配 ❌
- `grep -r "onUsageCommit" workers/agent-core/src/ --include="*.ts" | grep -v runtime-mainline.ts` → 0 匹配 ❌
- `bash -n scripts/deploy-preview.sh` → OK ✅

### 1.4 复用 / 对照的既有审查

- `docs/code-review/zero-to-real/ZX3-ZX4-reviewed-by-kimi.md` — 仅作为线索，全部独立复核

### 1.5 已确认的正面事实

- `@haimang/jwt-shared` package 真实存在，API 与 action plan C1-01 一致；20 unit 覆盖 base64Url / verifyJwt / verifyJwtAgainstKeyring / resolveSigningSecret / signJwt / JWT_LEEWAY_SECONDS
- orchestrator-core `auth.ts` 与 orchestrator-auth `jwt.ts` 均已 import jwt-shared；两 worker 测试零回归
- `_rpcErrorCodesAreFacadeCodes` 跨包编译期断言在 `facade-http.ts:111-114` 真实存在，使用 `extends never` TS narrowing，build-time guard 正确
- `packages/orchestrator-auth-contract/README.md` §1 envelope 关系 ASCII 图、单向约束说明、三种 envelope 形态表、helper 用法、升级规则全部存在；`packages/nacp-core/README.md` 有 cross-link
- kid rotation 集成测试 5 unit 覆盖 v1→v2 graceful overlap / post-overlap reject / legacy / tampered，全部 pass
- catalog-content.ts 有 11 entries（4 skills / 5 commands / 2 agents），smoke test 从 empty 改为 non-empty shape match
- `POST /messages`、`GET /files`、`GET /me/conversations`、`GET /me/devices`、`POST /me/devices/revoke` 5 个 endpoint 路由与 handler 均存在于 `index.ts` 与 `user-do.ts`
- migration 007 创建 `nano_user_devices` + `nano_user_device_revocations` + 3 indexes，CHECK constraint 覆盖 device_kind / status / source
- context-core / filesystem-core WorkerEntrypoint RPC class 真实存在（`ContextCoreEntrypoint` / `FilesystemCoreEntrypoint`），含 probe / nacpVersion / assemblerOps / filesystemOps
- NanoSessionDO `deferredAnswers` Map + `awaitAsyncAnswer` + `resolveDeferredAnswer` + `sweepDeferredAnswers` + `alarm()` 调用 sweep 全部真实存在
- `runtime-mainline.ts` 在 tool quota commit 后（line 245-251）与 LLM `afterLlmInvoke` quota commit 后（line 328-339）均调用 `options.onUsageCommit?.(...)`
- `claimPendingForStart` 在 `session-truth.ts:281-289` 使用 D1 `UPDATE ... WHERE session_status='pending'` 原子操作；`user-do.ts:786-796` 在 side-effect 前调用
- F4 idempotency 2 unit 测试覆盖 claim false → 409 + claim true → 200，全部 pass
- worker 数量 = 6（agent-core / bash-core / context-core / filesystem-core / orchestrator-auth / orchestrator-core）

### 1.6 已确认的负面事实

- `hooks/permission.ts` 仍为同步 `verdictOf(outcome)`，没有任何对 `emitPermissionRequestAndAwait` 或 `awaitAsyncAnswer` 的调用
- `runtime-mainline.ts` 的 `onUsageCommit` callback 定义后，没有任何其他文件（包括 NanoSessionDO composition 层）注册或消费该 callback
- `wrangler.jsonc:47-48` CONTEXT_CORE / FILESYSTEM_CORE binding 仍被注释掉，agent-core 未真正通过 service binding 调用 context-core / filesystem-core
- `user-do.ts` 已膨胀到 2240 行（ZX4 closure 时 1910 行），新增的 handleMessages / handleFiles / handleMeDevicesList / handleMeDevicesRevoke 全部在主文件内实现，未进一步 seam 化
- R28 deploy 500 根因仍未定位，仅产出 runbook stub

### 1.7 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 全部关键文件逐行核查，行号精确引用 |
| 本地命令 / 测试 | yes | 9 组测试全部本地运行，2055/2055 pass 已验证 |
| schema / contract 反向校验 | yes | facade-http.ts 编译期断言、migration 007 schema、README cross-link 均反向验证 |
| live / deploy / preview 证据 | no | sandbox 无法 wrangler tail，未验证 deploy 行为 |
| 与上游 design / QNA 对账 | yes | Q1-Q11 owner 答复与代码实现逐项核对 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | Lane F1/F2: wait-and-resume infra 就绪但 hook dispatcher 未 wire | high | delivery-gap | no | 转入 backlog，明确“infra → integration”两阶段 |
| R2 | Lane F3: onUsageCommit callback 已加但 NanoSessionDO 未注册 | high | delivery-gap | no | 转入 backlog，在 NanoSessionDO composition 层补注册 |
| R3 | Lane C6: client heartbeat 是本地 mirror 而非真正消费 nacp-session root export | medium | scope-drift | no | 在 build pipeline 接入 npm 后删除 mirror，补 TODO |
| R4 | Lane E: agent-core wrangler.jsonc CONTEXT_CORE/FILESYSTEM_CORE 仍 commented out | medium | delivery-gap | no | owner 决定 RPC-first toggle 后打开 binding |
| R5 | Lane D3: /input 与 /messages 未真正归一化，仍两套独立 handler | medium | correctness | no | 在 user-do.ts 内补 /input → /messages 的 forwarding shim |
| R6 | Lane D6: verifyAccessToken 未做 device-active check | medium | security | no | 转入 D6 second-half PR，补 nano_user_devices.status lookup |
| R7 | Lane F4: idempotency 测试是 mock 而非真实 D1 并发 | low | test-gap | no | 补并发 retry winner 真实 D1 竞态测试 |
| R8 | 跨阶段: user-do.ts 2240 行，seam extraction 收益完全吞噬 | medium | platform-fitness | no | 规划 user-do.ts 进一步 seam 化（lifecycle / read-model / device / ws） |
| R9 | 跨阶段: forwardInternalJsonShadow 命名漂移仍未重命名 | low | protocol-drift | no | 在后续 envelope refactor 中一并处理 |
| R10 | 跨阶段: R28 根因从 ZX4 carryover 到 ZX5 仍未定位 | medium | delivery-gap | no | owner 按 runbook §2 执行 wrangler tail 复盘 |

### R1. Lane F1/F2: wait-and-resume infra 就绪但 hook dispatcher 未 wire

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/agent-core/src/host/do/nano-session-do.ts:771-803`：`emitPermissionRequestAndAwait` 与 `emitElicitationRequestAndAwait` 已定义
  - `workers/agent-core/src/hooks/permission.ts:50-58`：`verdictOf(outcome)` 仍为纯同步函数，无任何 async/await 路径
  - `grep -r "emitPermissionRequestAndAwait" workers/agent-core/src/ --include="*.ts" | grep -v nano-session-do.ts` → 0 匹配
- **为什么重要**：ZX5 action plan §7.2 Lane F 收口标准明确要求 “PermissionRequest hook 改 await/resume 落地 + cross-e2e full-loop 验证”。当前状态是“contract layer 完备，runtime kernel 不消费”。前端发的 decision 写入 DO storage 后，agent runtime 不会主动恢复执行，业务上 permission round-trip 仍未闭环。
- **审查判断**：这是 closure 中标记为 “partial-by-design” 的刻意缺口，但不应被读作“已完成”。infra 就绪 ≠ integration 完成。
- **建议修法**：
  1. 在 `hooks/permission.ts` 中新增 `async verdictOfAwaitable(...)` 路径，调用 `nanoSessionDo.emitPermissionRequestAndAwait()`
  2. 在 kernel runner 的 hook dispatch 点（`buildOrchestrationDeps.emitHook`）识别 `PermissionRequest` / `ElicitationRequest` 事件名，走 awaitable 分支
  3. 补 cross-e2e full-loop 测试（client decision → orchestrator → DO storage → runtime resume → response）

### R2. Lane F3: onUsageCommit callback 已加但 NanoSessionDO 未注册

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/agent-core/src/host/runtime-mainline.ts:108-114`：`onUsageCommit?: (event) => void` 已定义
  - `runtime-mainline.ts:245-251` 与 `328-339`：两处 callsite 均调用 `options.onUsageCommit?.(...)`
  - `grep -r "onUsageCommit" workers/agent-core/src/ --include="*.ts" | grep -v runtime-mainline.ts` → 0 匹配
  - `nano-session-do.ts` 中 `createMainlineKernelRunner({...})` 调用（line 484）未传入 `onUsageCommit` 字段
- **为什么重要**：action plan F3-01 目标是 “runtime emit `session.usage.update` server frame”，closure §1.4 F3 也声称 “caller 在 onUsageCommit 回调中通过 emitServerFrame push”。但 caller 根本不存在，callback 注册链断裂。
- **审查判断**：closure 的表述 “callback 已接通，emit 调用方留 cluster-level kernel work” 是误导 — callback 定义在 runtime-mainline，但 NanoSessionDO 作为 composition owner 没有注册它，因此 callback 从未被“接通”。
- **建议修法**：在 `NanoSessionDO.createLiveKernelRunner()`（line 481-491）中补传 `onUsageCommit` callback，内部调用 `this.emitServerFrame('session.usage.update', {...})`。

### R3. Lane C6: client heartbeat 是本地 mirror 而非真正消费 nacp-session root export

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/web/src/heartbeat.ts`(49 行)：本地实现的 `HeartbeatTracker` class，未 import `@haimang/nacp-session`
  - `clients/wechat-miniprogram/utils/heartbeat-adapter.js`(60 行)：JS 1:1 手写 mirror，未 require `@haimang/nacp-session`
  - action plan C6 要求：“删手写实现，改用 `@haimang/nacp-session` root export 的 shared helper / adapter”
- **为什么重要**：closure 解释 “vite/react app 不通过 npm registry” 和 “wechat miniprogram runtime 也不能直接 import npm package” 是环境限制事实，但 action plan 明确冻结了“替换为 shared helper”的目标。当前状态是“行为对齐的本地 copy”，不是“通过 npm package 消费 single source of truth”。未来 nacp-session 的 HeartbeatTracker 若升级（如改心跳算法、加 jitter、改 timeout 阈值），两个 client 不会自动继承。
- **审查判断**：这是 pragmatic 妥协，但存在长期维护风险。应在两个 client 文件顶部补 TODO 注释，明确“待 build pipeline 接入 npm 后删除本 mirror”。
- **建议修法**：在 `heartbeat.ts` 与 `heartbeat-adapter.js` 文件头加 TODO，指向 `@haimang/nacp-session` root export 的切换任务。

### R4. Lane E: agent-core wrangler.jsonc CONTEXT_CORE/FILESYSTEM_CORE 仍 commented out

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/agent-core/wrangler.jsonc:47-48`：`{ "binding": "CONTEXT_CORE", ... }` 与 `{ "binding": "FILESYSTEM_CORE", ... }` 仍被 `//` 注释
  - action plan E1-02 / E2-02 要求 “agent-core 打开 CONTEXT_CORE binding + 通过 short-term shim 改 RPC 调用”
- **为什么重要**：Lane E 的完成定义包含 “agent-core 通过短期 shim 改 service binding 调用”。当前 agent-core 仍然 100% 走 in-process library import（`@haimang/context-core-worker/context-api/...`），没有任何 RPC 调用路径被激活。context-core / filesystem-core 的 WorkerEntrypoint 方法即使存在，也没有被任何 caller 调用。
- **审查判断**：closure 声称 “短期 shim 期间 in-process import 保留” 是对的，但 action plan 的 “打开 commented binding” 步骤并未执行。Lane E 的完成状态应为 “RPC contract 就绪，待 owner toggle” 而不是 “agent-core 已改 service binding 调用”。
- **建议修法**：在 wrangler.jsonc 加 TODO 注释，明确 owner toggle 条件（cross-e2e 稳定 + 2 周 shim 期结束）。

### R5. Lane D3: /input 与 /messages 未真正归一化

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - Q8 owner answer 冻结：“/input 保留为兼容别名并在服务端归一化到 /messages 的 text-only 形态，不再走第二套落库路径”
  - 实际：`user-do.ts:952-1075` `handleInput` 仍独立存在，落表 kind='user.input'；`user-do.ts:1498-1617` `handleMessages` 落表 kind='user.input.text' / 'user.input.multipart'
  - 两个 handler 的落库路径完全独立，没有 forwarding 或归一化
- **为什么重要**：Q8 明确冻结“统一落到同一 nano_conversation_messages 表，通过 message_kind / source tag 区分”。当前 /input 与 /messages 不仅落库路径独立，而且 message_kind 值也不同（'user.input' vs 'user.input.text'），这会导致历史查询时需要同时处理两种 kind，违背“统一 truth”原则。
- **审查判断**：这是 D3 实现与 Q8 语义冻结的偏差。
- **建议修法**：将 `handleInput` 内部转发到 `handleMessages`（构造 `parts: [{kind:'text', text}]` 后调用），使 /input 真正成为 /messages 的兼容别名。

### R6. Lane D6: verifyAccessToken 未做 device-active check

- **严重级别**：`medium`
- **类型**：`security`
- **是否 blocker**：`no`
- **事实依据**：
  - Q9 第 3 条冻结：“行为：同 device_uuid 的 refresh 立即失效 + 新 authenticated HTTP/WS attach 立即拒绝”
  - `workers/orchestrator-auth/src/jwt.ts:76-143` `verifyAccessToken`：签名验证 + claims normalize + exp 检查后即返回，没有任何 `nano_user_devices.status` lookup
  - `workers/orchestrator-core/src/index.ts:handleMeDevicesRevoke`：D1 UPDATE + audit INSERT 已完成，但 verify 路径不检查
- **为什么重要**：revoke 后新 attach 应“立即拒绝”，但当前 verifyAccessToken 完全不知道 device revocation 状态。被 revoke 的 device 的 access token 在过期前仍然可以正常通过 auth gate。
- **审查判断**：closure 承认这是 “D6 second-half / 后续 PR”，属于已知缺口。
- **建议修法**：在 `verifyAccessToken` 后（或 `authenticateRequest` 中）加 D1 `SELECT status FROM nano_user_devices WHERE device_uuid = ?` lookup，status='revoked' 时 throw AuthServiceError。

### R7. Lane F4: idempotency 测试是 mock 而非真实 D1 并发

- **严重级别**：`low`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/test/user-do.test.ts:1184-1217`：mock `claimPendingForStart` 返回 false，验证 409
  - action plan F4-02 要求：“模拟同一 session_uuid 5 个并发 /start 请求，只有 1 个成功推 starting”
  - 测试中没有真实 D1 并发竞态，只是 mock 了 repository 返回值
- **为什么重要**：D1 conditional UPDATE 的原子性正确性无法通过 mock 验证。真实并发场景下（如 D1 read-after-write 一致性窗口、connection pool 行为）可能有不同表现。
- **审查判断**：mock 测试覆盖了分支逻辑，但未覆盖原子性保证。
- **建议修法**：补一个 integration 测试，用 5 个并行 Promise 同时调 `claimPendingForStart`，断言恰好 1 个返回 true。

### R8. 跨阶段: user-do.ts 2240 行，seam extraction 收益完全吞噬

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - ZX4 Phase 0 seam extraction 后 user-do.ts 1659 行 → ZX4 closure 1910 行 → ZX5 2240 行
  - 新增 handleMessages(+118 行) / handleFiles(+47 行) / handleMeDevicesList(+43 行) / handleMeDevicesRevoke(+83 行) / handleMeConversations(+83 行) 全部在主文件
  - 4 个 seam 模块（parity-bridge / ws-bridge / session-lifecycle / session-read-model）共 600 行，没有吸收任何新增 handler
- **为什么重要**：ZX4 花了一整 phase 做 seam extraction，目标是让 user-do.ts 从 1950 行降到 <1500 行。结果 ZX5 一阶段就回到 2240 行，seam 化工作完全失效。这是架构债务的累积。
- **审查判断**：action plan O3 承认 “ZX5 Lane E 之外的进一步 lifecycle/read-model/ws handler 搬移可在 Lane F1/F2 完成 kernel 改造时顺手做”，但 Lane F 没有做任何搬移。
- **建议修法**：规划独立 refactor PR，将 handleMessages / handleFiles / handleMeDevicesList / handleMeDevicesRevoke / handleMeConversations 搬到对应 seam 模块（session-lifecycle 或新增 device-management seam）。

### R9. 跨阶段: forwardInternalJsonShadow 命名漂移仍未重命名

- **严重级别**：`low`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:617` 方法仍叫 `forwardInternalJsonShadow`
  - ZX4 P9 已删除 shadow/parity 行为，但方法名保留以减少 diff
  - GPT R7 / kimi R8 / deepseek R9 均要求重命名
  - action plan O11：“推迟到本 plan Lane C 或后续 plan envelope refactor 时一并做”
- **为什么重要**：方法名携带错误语义（“Shadow”暗示 dual-track parity，实际已是 RPC-only），对新开发者产生误导。
- **审查判断**：这是已知低优先级债务，但已跨 3 个阶段未处理。
- **建议修法**：在后续 envelope refactor 中重命名为 `forwardAgentRpc` 或 `rpcToAgentCore`。

### R10. 跨阶段: R28 根因从 ZX4 carryover 到 ZX5 仍未定位

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - ZX4 closure §3.1 已标注 R28 “deploy 根因未定位”
  - ZX5 F5 产出 `docs/runbook/zx5-r28-investigation.md`(141 行 template)，§3 复盘记录为空
  - closure 声称 “sandbox 拒绝 wrangler tail，留 owner ops”
- **为什么重要**：R28 从 ZX2 首次 surface，经 ZX4 两轮修法（AbortController + outer try/catch）仍未消除。如果根因在 RPC 调用栈上层，未来任何新 endpoint 都可能触发同类 500。
- **审查判断**：runbook stub 是有价值的产出，但不应替代 actual root-cause analysis。ZX5 closure 将 F5 标记为 “done” 是不准确的 — 产出的是 template，不是 investigation result。
- **建议修法**：owner 按 runbook §2 Step A-D 执行 wrangler tail + 复现 + 抓 stack trace，回填 §3 后决定 fix/upgrade/carryover。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | C1: 创建 `@haimang/jwt-shared` package | done | 238 行 src + 176 行 test，20/20 pass |
| S2 | C2: 两 worker 切 jwt-shared | done | auth.ts / jwt.ts 已 import，零回归 |
| S3 | C3: kid rotation 集成测试 | done | 5 unit 覆盖 graceful overlap / post-overlap / legacy / tampered |
| S4 | C4: `RpcErrorCode ⊂ FacadeErrorCode` 跨包断言 | done | facade-http.ts:111-114，`extends never` build-time guard |
| S5 | C5: envelope 关系文档化 | done | auth-contract README + nacp-core README cross-link |
| S6 | C6: web/wechat client heartbeat shared helper | partial | 行为对齐的本地 mirror，未真正 import nacp-session root export |
| S7 | D1: WORKER_VERSION owner-local 注入 | done | deploy-preview.sh 126 行，bash -n OK |
| S8 | D2: catalog content registry | done | 11 entries，smoke test 更新 |
| S9 | D3: `POST /sessions/{id}/messages` | partial | 实现存在，但 /input 未归一化到 /messages，两套落库路径 |
| S10 | D4: `GET /sessions/{id}/files` | done | metadata-only 实现（R2 binding owner-action） |
| S11 | D5: `GET /me/conversations` | done | 复用 D1 listSessionsForUser + group by conversation_uuid |
| S12 | D6: `POST /me/devices/revoke` + migration 007 | partial | schema + endpoint + D1 写入完成；verify device-active check 缺失；active session 立即断开缺失 |
| S13 | E1: context-core 升级 WorkerEntrypoint RPC | partial | RPC class 存在，但 agent-core 未打开 binding，无真实 RPC 调用 |
| S14 | E2: filesystem-core 升级 WorkerEntrypoint RPC | partial | 同上 |
| S15 | F1: PermissionRequest hook 改 await/resume | partial | NanoSessionDO wait-and-resume infra 就绪；hooks/permission.ts 未改造，无 dispatcher integration |
| S16 | F2: ElicitationRequest hook 改 await/resume | partial | 同 F1 |
| S17 | F3: runtime emit `session.usage.update` | partial | onUsageCommit callback 定义 + 2 callsite；NanoSessionDO 未注册 callback，emitServerFrame 未 wire |
| S18 | F4: handleStart idempotency | partial | D1 conditional UPDATE 实现 + 2 unit；缺真实并发 D1 竞态测试 |
| S19 | F5: R28 wrangler tail investigation | partial | runbook stub 140 行；§3 复盘记录为空，未定位根因 |

### 3.1 对齐结论

- **done**: 8 (S1/S2/S3/S4/S5/S7/S8/S11)
- **partial**: 10 (S6/S9/S10/S12/S13/S14/S15/S16/S17/S18/S19)
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0

> 这更像“核心骨架与基础设施完成，但跨组件 integration 与端到端闭环仍有显著缺口”，而不是 fully completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | transport finalization → ZX4 已完成 | 遵守 | internal-http-compat: retired ✅ |
| O2 | session 语义闭环 storage contract → ZX4 已完成 | 遵守 | 5-state D1 truth + decision-forwarding contract land ✅ |
| O3 | user-do.ts seam refactor | 部分违反 | action plan 说 “ZX5 Lane E 之外可在 F1/F2 顺手做”，实际未做；user-do.ts 从 1910→2240 行 |
| O4 | WeChat 真机 smoke | 遵守 | 持续 carryover |
| O5 | D1 schema 大改动 — 不新建平行表 | 遵守 | D3/D4/D5 均复用现有表；D6 新建 2 表但属于 device truth 新增，非平行表 |
| O6 | 新增 worker / 改变 6-worker 拓扑 | 遵守 | ls workers/ = 6 ✅ |
| O7 | D6 device model design — Q9 已冻结 | 遵守 | nano_user_devices schema 按 Q9 实现 |
| O8 | prod migration 006/007 apply | 遵守 | owner-action hard gate |
| O9 | pnpm-lock.yaml stale importer block | 遵守 | owner-action，NODE_AUTH_TOKEN 缺失导致 |
| O10 | retired guardians 契约覆盖 cross-reference audit | 遵守 | 未作为 ZX5 phase |
| O11 | `forwardInternalJsonShadow` 重命名 | 部分违反 | 推迟到后续 plan，但已跨 3 阶段未处理 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：ZX5 在 4 lanes 的 infra 层与单点功能上取得了实质性进展：jwt-shared single source 落地、4 个 product endpoint 可用、context/filesystem WorkerEntrypoint RPC contract 就绪、handleStart idempotency 关闭竞态。但 Lane F 的“runtime kernel hookup”本质是 **infra 铺设** 而非 **integration 闭环** — PermissionRequest / ElicitationRequest hook 仍走同步路径，usage push callback 有定义无注册。closure 文档中大量“partial-by-design”的表述模糊了“已完成”与“待后续 PR”的边界。
- **是否允许关闭本轮 review**：`yes`
- **关闭前必须完成的 blocker**：
  1. 无代码 blocker（测试全绿，无回归）
- **可以后续跟进的 non-blocking follow-up**（按优先级排序）：
  1. **F1/F2 hook dispatcher integration**：在 hooks/permission.ts 中接入 `emitPermissionRequestAndAwait`，补 cross-e2e full-loop 测试
  2. **F3 callback registration**：在 NanoSessionDO.createLiveKernelRunner() 中注册 onUsageCommit，驱动 emitServerFrame
  3. **D6 verify device-active check**：在 verifyAccessToken 或 authenticateRequest 中加 nano_user_devices.status lookup
  4. **D3 /input → /messages forwarding**：在 handleInput 内构造 parts 后调用 handleMessages，统一落库路径
  5. **R28 owner wrangler tail 复盘**：按 runbook 执行，回填 §3 根因与修法决策
  6. **user-do.ts 进一步 seam 化**：将新增 handler（messages/files/devices/conversations）搬到独立 seam 模块
  7. **C6 client true npm import**：build pipeline 接入后删除本地 mirror
  8. **E1/E2 agent-core binding toggle**：owner 决定 RPC-first 后打开 wrangler.jsonc binding
  9. **forwardInternalJsonShadow 重命名**：在 envelope refactor 中处理
- **建议的二次审查方式**：`independent reviewer`（建议由 GLM 或 deepseek 对 F1/F2/F3 integration PR 做独立 review）
- **实现者回应入口**：请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。

---

> 本轮 review 不收口以下事项，等待后续独立 PR 或 owner action：
> - R1/R2（F1/F2/F3 integration）
> - R5（D3 /input 归一化）
> - R6（D6 device-active check）
> - R10（R28 根因定位）

---

## 7. 审查质量评价（Opus 4.7 修复后回填）

> 评价对象: `kimi ZX5 全 4 lane review`
> 评价人: `Opus 4.7 (1M ctx)`
> 评价时间: `2026-04-28`

---

### 7.0 评价结论

- **一句话评价**:**最强的"测试矩阵实证 + 跨阶段债务追踪"reviewer** — 唯一在 §1.3 跑全部 9 组 worker test 实证 2055/2055 + 唯一识别 R7(F4 mock vs real D1 测试 gap)与 R6(D6 verifyAccessToken 安全 gap);但 finding 严重级别校准与 platform-fitness 类问题颗粒度跟 GLM 高度重合。
- **综合评分**:**8.4 / 10**
- **推荐使用场景**:phase closure 时需要"测试矩阵 + 跨阶段债务真实状态"实证的角色;特别适合长 plan 收尾前用测试结果数据反向校准 closure claim。
- **不建议单独依赖的场景**:不擅长**单点 latent correctness bug**(完全没识别 deepseek R2 的 role 判定);finding 与 GLM 高度重合(R8 重 GLM R7 / R3 重 GLM R6 / R6 重 GLM R9 / R9 重 GLM R10),独立性不足。

---

### 7.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | **测试矩阵实证 + 跨阶段债务对账** | §1.3 跑 9 组 pnpm test 实证 + §3.1 done/partial/missing 跨 lane 统计 |
| 证据类型 | **测试运行结果 + grep 关键符号 + 跨阶段 context** | §1.3 列出 `grep -r "emitPermissionRequestAndAwait"` 0 匹配作为 R1 证据 |
| Verdict 倾向 | **balanced(approve-with-followups)** — 最宽松,允许收口但 follow-up 列表最长 | §5 "ZX5 closure 可收,但 §3.2/§3.3 的 follow-up 必须转入 backlog 并指派 owner" |
| Finding 粒度 | **balanced(10 findings,严重级别均匀)** | high(R1+R2)/ medium(R3-R6+R8+R10)/ low(R7+R9),无明显虚高/虚低 |
| 修法建议风格 | **actionable + 跨阶段 context** | R8 给 user-do.ts 行数演进表(1659→1910→2240),fix 路径建议归并到独立 refactor PR |

---

### 7.2 优点与短板

#### 7.2.1 优点

1. **§1.3 测试矩阵实证是 4 位中最完整的** — 9 组 worker test 全跑 + grep `emitPermissionRequestAndAwait` 0 匹配 + grep `onUsageCommit` 0 匹配 + `bash -n` syntax check + `ls workers/` worker 数量,证据类型最 multidimensional。其它 reviewer 多是文件层 grep。
2. **R7(F4 idempotency mock vs real D1)是 4 位中独家的 test-quality finding** — GLM R5 看到 cross-worker test asymmetry,kimi R7 看到 same-worker test 的 mock vs real D1 并发实现 gap,两人维度互补;kimi 这一条只有它看到。
3. **R6(D6 verifyAccessToken 不查 device-active)是 security 类 finding** — Q9 owner direction "revoke 后立即拒绝" 与代码 `verifyAccessToken` 不做 D1 lookup 的对账,严重级别 medium 但是 security 类(其它 reviewer 把同问题归为 delivery-gap);kimi 视角独特。
4. **§6 跨阶段全景回顾** — 与 GLM §6.1 类似但更聚焦 ZX0→ZX5 演进,把 zero-to-real 系列定位 + 跨阶段 over-claim 模式复现 + nano-session-do.ts setTimeout 在 DO 语义下的可靠性 三段一起讲,提供了 reviewer 中最完整的"系列史观"。

#### 7.2.2 短板 / 盲区

1. **完全没识别 deepseek R1 + R2** — `/messages` 不转发与 role 判定 bug 都没看到,这是 ZX5 唯一的 critical bug + latent regression。kimi §1.6 提到"agent-runtime 不会主动恢复执行"但只用作 F1/F2 partial 的辅助证据,没有把 D3 forward 缺失单独抓出。这是 kimi 与 deepseek 最大的差距。
2. **没识别 GPT R3 的 client docs 漂移** — 与 deepseek 一样 scope 锁在 worker / package 内部,client-facing docs 不在 radar。
3. **finding 与 GLM 重合度高** — R3(client mirror)≡ GLM R6;R8(行数膨胀)≡ GLM R7;R6(D6 device-active)≡ GLM R9;R9(forwardInternalJsonShadow rename)≡ GLM R10。4 条 finding 重复说明 kimi 与 GLM 的扫描维度重叠较多,独立价值打折。
4. **R10(R28 carryover)严重级别 medium 略高** — R28 是 4 阶段 carryover 的 owner-action,代码 agent 无法独立推进;作为 finding 本身价值不高(只是 acknowledge),不应占用 medium 级别。

---

### 7.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| R1 | high | **true-positive(与 deepseek R7 / GLM R2 / GPT R1 共识)** | good | F1/F2 hook dispatcher 集成缺失,与 4 位共识;closure reword 后承接 |
| R2 | high | **true-positive(与 deepseek R6 / GLM R2 / GPT R1 共识)** | good | F3 callback 注册缺失,4 位共识;closure reword 后承接 |
| R3 | medium | **true-positive(与 GLM R6 重叠)** | mixed | client mirror 与 owner Q3 trade-off 一致,实际是 known-deferred,严重级别可调低 |
| R4 | medium | **true-positive(与 GPT R2 共识)** | good | wrangler.jsonc binding 仍 commented,Lane E partial-by-design;closure reword 后承接 |
| R5 | medium | **true-positive(与 deepseek R3 / Q8 共识)** | good | `/input` 与 `/messages` 未真正归一化;fix 后 `/input` 已成为 thin alias |
| R6 | medium | **true-positive(与 GLM R9 重叠,kimi 独有 security 视角)** | good | D6 verifyAccessToken 不查 device-active 是 known D6 second-half;fix 加 TODO |
| R7 | low | **true-positive(kimi 独家)** | excellent | F4 mock test 不覆盖 real D1 并发原子性;deferred 合理 |
| R8 | medium | **true-positive(与 GLM R7 重叠)** | good | user-do.ts 行数演进表是 kimi 独家深度证据;deferred 到下一 plan |
| R9 | low | **true-positive(与 GLM R10 重叠)** | mixed | forwardInternalJsonShadow rename 是 4 阶段 carryover,与 ZX5 plan O11 一致;无独立价值 |
| R10 | medium | **owner-action carryover** | weak | R28 根因是 owner ops blocker,不应作为代码 finding 占用 medium 级别 |

---

### 7.4 多维度评分 - 单项总分 10 分

| 维度 | 评分(1–10)| 说明 |
|------|-------------|------|
| 证据链完整度 | **10** | §1.3 测试矩阵 9 组实证 + grep + bash -n + `ls`,4 位中最 multidimensional |
| 判断严谨性 | **8** | R10 把 owner-action 当 finding;其它判断都准 |
| 修法建议可执行性 | **9** | R7 + R8 修法路径具体;R10 fix 是 owner-action 不可执行 |
| 对 action-plan / design / QNA 的忠实度 | **9** | Q1-Q11 全部对账,但深度不及 deepseek |
| 协作友好度 | **9** | verdict 最宽松,允许收口 + 列出 follow-up backlog,最不让实现者紧张 |
| 找到问题的覆盖面 | **9** | 测试矩阵 + 跨阶段 + security 视角广;但与 GLM 重合度高 |
| 严重级别 / verdict 校准 | **8** | R3/R10 严重级别偏高,其它校准准 |

**加权总分:8.4 / 10**(测试矩阵实证 + 跨阶段史观 + R7 独家 test-quality finding;扣分主要来自 finding 与 GLM 重叠率 40% + 错过 deepseek R1+R2 两条 critical/high latent bug)
