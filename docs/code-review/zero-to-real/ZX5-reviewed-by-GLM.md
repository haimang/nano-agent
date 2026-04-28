# Nano-Agent 代码审查 — ZX5 Protocol Hygiene + Product Surface + Architecture + Runtime Hookup

> 审查对象: `ZX5-protocol-hygiene-product-surface-architecture` 全 lane 实现 + closure 文档
> 审查类型: `mixed`（code-review + closure-review + 跨阶段 rereview）
> 审查时间: `2026-04-28`
> 审查人: `GLM`
> 审查范围:
> - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`（v3 action plan）
> - `docs/issue/zero-to-real/ZX5-closure.md`（Opus 收尾文档）
> - `packages/jwt-shared/`（Lane C C1）
> - `workers/orchestrator-core/src/auth.ts` + `workers/orchestrator-auth/src/jwt.ts`（C2）
> - `workers/orchestrator-auth/test/kid-rotation.test.ts`（C3）
> - `packages/orchestrator-auth-contract/src/facade-http.ts`（C4）
> - `packages/orchestrator-auth-contract/README.md`（C5）
> - `clients/web/src/heartbeat.ts` + `clients/wechat-miniprogram/utils/heartbeat-adapter.js`（C6）
> - `scripts/deploy-preview.sh`（D1）
> - `workers/orchestrator-core/src/catalog-content.ts`（D2）
> - `workers/orchestrator-core/src/user-do.ts` — handleMessages/handleFiles/handleMeConversations/handleStart（D3-D5 + F4）
> - `workers/orchestrator-core/src/index.ts` — D3-D6 路由（D3-D6）
> - `workers/orchestrator-core/migrations/007-user-devices.sql`（D6）
> - `workers/context-core/src/index.ts` + `workers/filesystem-core/src/index.ts`（E1-E2）
> - `workers/agent-core/src/host/do/nano-session-do.ts` — wait-and-resume + emitPermissionRequestAndAwait（F1-F2）
> - `workers/agent-core/src/host/runtime-mainline.ts` — onUsageCommit（F3）
> - `workers/orchestrator-core/src/session-truth.ts` — claimPendingForStart（F4）
> - `docs/runbook/zx5-r28-investigation.md`（F5）
> 对照真相:
> - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`
> - `docs/issue/zero-to-real/ZX4-closure.md` + `ZX3-closure.md` + `ZX2-closure.md`
> - `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：ZX5 Lane C/D/F4 交付明确、可验证；Lane E 是合规的 minimal seam 交付；Lane F1/F2/F3 的基础设施已落地，但 **hook dispatcher 接线和 emitServerFrame 调用两处关键 wire-up 均为空存根**——closure 文档多处措辞暗示"端到端已通"，实际处于 "infra landed, dispatcher deferred" 状态。
- **结论等级**：`approve-with-follow-ups`
- **是否允许关闭本轮 review**：`yes` — 带 2 个 high-severity follow-up 和 5 个 medium follow-up，不阻塞 ZX5 关闭但必须在下一 PR / ZX6 之前修复
- **本轮最关键的 3 个判断**：
  1. **D3 `/messages` 不转发到 agent-core 是核心功能缺口**——Q8 明确 "/messages 是 /input 的多模态超集"，但 `handleMessages` 仅写 D1 后直接 200 返回，不调用 `forwardInternalJsonShadow` 驱动 agent-runtime 处理，与 `/input` 行为**不等价**
  2. **F1/F2/F3 的 "✅ 已 landed" 措辞与实际代码状态存在系统性 over-claim**——`emitPermissionRequestAndAwait` 内部 `void` 表达式不产生任何副作用（WS emit 未接线），`onUsageCommit` callback 无消费者注册，closure §0 和 §5.1 的 "runtime kernel hookup contract land" 措辞暗示端到端已通，实际仅建立了合约骨架
  3. **`deploy-preview.sh` 缺少 `wrangler d1 migrations apply` 步骤**——D6 新增的 `007-user-devices.sql` migration 不会自动执行，`/me/devices` 和 `/me/devices/revoke` 端点在部署后会因表不存在而 500

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`（v3 完整 669 行）
  - `docs/issue/zero-to-real/ZX5-closure.md`（335 行）
  - `docs/issue/zero-to-real/ZX4-closure.md`、`ZX3-closure.md`、`ZX2-closure.md`
- **核查实现**：
  - 所有 ZX5 相关源码文件的行级核验（见上方审查范围共 17+ 关键文件）
  - `user-do.ts`（2240 行）逐函数审查 `handleMessages`/`handleFiles`/`handleMeConversations`/`handleStart`/`handleMeDevicesList`/`handleMeDevicesRevoke`/`claimPendingForStart`
  - `nano-session-do.ts`（1258+ 行）审查 `awaitAsyncAnswer`/`sweepDeferredAnswers`/`emitPermissionRequestAndAwait`/`emitElicitationRequestAndAwait`
  - `runtime-mainline.ts` 审查 `onUsageCommit` 定义与调用
  - `session-truth.ts` 审查 `claimPendingForStart` D1 条件更新
  - `index.ts` 审查 D3-D6 路由挂载
  - `jwt-shared/src/index.ts` + 两 worker jwt 切换 + `kid-rotation.test.ts`
  - `deploy-preview.sh` + `007-user-devices.sql`
  - `catalog-content.ts` + `README.md`
- **执行过的验证**：
  - `ls workers/` → 6 项（R8 硬冻结确认）
  - `ls packages/` → 7 项（ZX3 6 + ZX5 jwt-shared 确认）
  - `user-do.ts` 行数 `wc -l` → 2240（ZX4 给出 1910，净增 330 行，与 ZX4 R26 拆分目标反向）
  - `forwardInternalJsonShadow` 引用检查 → 7 处仍然存在
  - `handleMessages` 不含 `forwardInternalJsonShadow` 或 `forwardInternalRaw` 调用
  - `NanoSessionDO.emitPermissionRequestAndAwait` 内 `void` 表达式验证
  - `deploy-preview.sh` 缺 `wrangler d1 migrations apply` 检查
- **复用 / 对照的既有审查**：
  - 本审查仅使用独立推理，不采纳 GPT/kimi/GLM/deepseek 4-reviewer 分析结论，但将 ZX4 closure 和 4-reviewer review 中标记的 carryover 项作为线索核验

### 1.1 已确认的正面事实

- `packages/jwt-shared/` 包 API 完整：`base64Url`/`importKey`/`parseJwtHeader`/`collectVerificationKeys`/`verifyJwt`/`verifyJwtAgainstKeyring`/`resolveSigningSecret`/`signJwt`/`JWT_LEEWAY_SECONDS` 全部存在，20/20 单测通过
- 两 worker 已切 jwt-shared：`orchestrator-core/src/auth.ts` 删除 73 行本地实现改 import，`orchestrator-auth/src/jwt.ts` 删除 53 行改 import；`@haimang/jwt-shared: workspace:*` 依赖已加入
- `RpcErrorCode ⊂ FacadeErrorCode` 编译期断言存在（`facade-http.ts:111-114`），`_rpcErrorCodesAreFacadeCodes: z.infer<typeof RpcErrorCodeSchema> extends FacadeErrorCode ? true : never = true`，构建时断言已生效
- `orchestrator-auth-contract/README.md` 存在（144 行），envelope 关系文档化完整，包含 ASCII 关系图、单向约束、三种 envelope 形态、helper 用法
- `catalog-content.ts` 存在且填充真实数据：4 skills / 5 commands / 2 agents = 11 entries
- `claimPendingForStart` D1 条件更新实现正确：`UPDATE nano_conversation_sessions SET session_status='starting' WHERE session_uuid=?1 AND session_status='pending'`，返回 `meta.changes > 0`
- `handleStart` 在 pending 状态下先 claim 再 side-effect，claim 失败立即 409
- F4 幂等测试存在：`user-do.test.ts:1183-1219` 包含 2 个测试（claim false → 409 / claim true → 200）
- C3 kid rotation 测试存在：5 个测试覆盖 v1→v2、post-overlap 拒签、legacy 兼容、签名篡改检测
- E1/E2 `ContextCoreEntrypoint`/`FilesystemCoreEntrypoint` 存在，暴露 `probe`/`nacpVersion`/`assemblerOps`/`filesystemOps` RPC method
- `deploy-preview.sh` 存在（126 行），6 worker deploy 顺序正确
- F5 runbook 存在（141 行），owner-action template 完整
- worker 总数 = 6（R8 硬冻结维持）
- packages 总数 = 7（ZX3 6 + jwt-shared 1）

### 1.2 已确认的负面事实

- `handleMessages`（D3 `/messages`）**不调用 `forwardInternalJsonShadow` 或任何 agent-core RPC 转发**——消息写入 D1 后直接返回 200，agent-runtime 不处理该消息
- `emitPermissionRequestAndAwait` 内部 `void this.sessionUuid; void helper;` 是无副作用存根——WS frame 从未发出
- `emitElicitationRequestAndAwait` 同上——仅 `awaitAsyncAnswer` 路径有效，WS emit 为空操作
- `onUsageCommit` callback 无消费者——`NanoSessionDO` 未在 `MainlineKernelOptions` 传入 `onUsageCommit` 回调，callback 定义存在但永不被调用
- `deploy-preview.sh` 缺 `wrangler d1 migrations apply` 步骤——`007-user-devices.sql` 不会被执行
- `clients/web/src/heartbeat.ts` 是 `@haimang/nacp-session/heartbeat.ts` 的本地副本，而非 import 共享包（违反 C6 "替换为 shared helper" 目标）
- `context-core/src/index.ts` 用 `assemblerOps()` 命名 vs `filesystem-core/src/index.ts` 用 `filesystemOps()` 命名——风格不统一
- `forwardInternalJsonShadow` 方法名仍存在（7 处引用），ZX5 O11 推迟但它是 Lane C "protocol hygiene" 阶段
- `user-do.ts` 从 ZX4 时 1910 行增长到 2240 行，与 R26 拆分目标反向
- `handleMeConversations` 以 `limit: 200` 硬编码查 session 然后归并 conversation，用户 limit > conversation 数时数据不足
- `handleMeDevicesList`/`handleMeDevicesRevoke` 在 `index.ts` 中直查 D1 而非通过 User-DO，与 `/me/sessions`/`/me/conversations` 的架构模式不一致

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 17+ 关键文件的逐行审查 |
| 本地命令 / 测试 | yes | `ls`/`wc -l`/`grep` 命令用于确认文件存在性和行号 |
| schema / contract 反向校验 | yes | facade-http.ts 的编译期断言验证;007 migration FK 引用核验 |
| live / deploy / preview 证据 | no | sandbox 限制，无法跑 wrangler deploy |
| 与上游 design / QNA 对账 | yes | Q1-Q11 全部对账;ZX4/ZX3/ZX2 closure carryover 项逐项核验 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | D3 `/messages` 不转发到 agent-core | high | correctness | no（不阻塞关闭，但应优先修） | 下一个 PR 在 `handleMessages` 尾部加 `forwardInternalJsonShadow` 调用 |
| R2 | F1/F2/F3 closure over-claim | high | docs-gap | no | closure 措辞修正为 "infra/contract landed, dispatcher wiring deferred" |
| R3 | deploy-preview.sh 缺 D1 migration apply | high | delivery-gap | no | 加 `wrangler d1 migrations apply` 步骤 |
| R4 | C2 两 worker 导入策略不一致 | medium | protocol-drift | no | 统一为顶层静态 import 或文档说明差异原因 |
| R5 | kid rotation 测试仅在 orchestrator-auth，orchestrator-core 零覆盖 | medium | test-gap | no | 补 orchestrator-core auth 路径的 kid rotation 集成测试 |
| R6 | C6 web 客户端维护本地 HeartbeatTracker 副本而非使用共享包 | medium | scope-drift | no | 删除 `clients/web/src/heartbeat.ts` 并改用 `@haimang/nacp-session` import |
| R7 | user-do.ts 2240 行、5 个新 handler 直填不拆分 | medium | platform-fitness | no | 后续 PR 将 D3-D6 handler 拆到 `session-product-handlers.ts` |
| R8 | F1/F2 `setTimeout` 在 DO hibernation/restart 场景下行为未文档化 | medium | docs-gap | no | 在 `awaitAsyncAnswer` 方法文档补充 hibernation 注意事项 |
| R9 | D6 device 写入端与 IngressAuthSnapshot 读取端未连接 | medium | delivery-gap | no | closure 已自认 second-half follow-up，加 TODO 注释标注 |
| R10 | `forwardInternalJsonShadow` 命名漂移 + `index.ts:18` stale comment | low | protocol-drift | no | 最低限度更新 stale comment；完整重命名推迟到 user-do 拆分时 |
| R11 | E1/E2 RPC op 方法命名不统一 | low | platform-fitness | no | 统一为 `{domain}Ops()` 或 `listOps()` |
| R12 | `handleMeConversations` 分页不足 + `next_cursor` 恒 null | low | delivery-gap | no | 后续 PR 补 cursor-based 分页 |

### R1. D3 `/messages` 不转发到 agent-core — 消息写 D1 后不驱动 runtime

- **严重级别**：high
- **类型**：correctness
- **是否 blocker**：no
- **事实依据**：
  - `user-do.ts:1498-1617` `handleMessages` 写 D1 后返回 200，不调用 `forwardInternalJsonShadow` 或任何 RPC 转发
  - `handleInput`（`user-do.ts:952-1075`）在写 D1 后调用 `forwardInternalJsonShadow(sessionUuid, 'input', ...)` 驱动 agent-runtime
  - Q8 owner direction："`/messages` 是 `/input` 的多模态超集，`/input` 保留为兼容别名并在服务端归一化到 `/messages`"
  - 如果 `/messages` 不转发，agent 不知道用户发了消息，业务闭环断裂
- **为什么重要**：这是 ZX5 Lane D 最核心的产品面 endpoint，Q8 明确确立 `/messages` 为 `/input` 的超集，但实际上两者行为不等价——`/input` 触发 runtime，`/messages` 不触发
- **审查判断**：这是功能性缺口，不是设计决策——对比 `handleInput` 的完整链路，缺一步转发
- **建议修法**：在 `handleMessages` 尾部 `return jsonResponse(200, ...)` 之前加 `await this.forwardInternalJsonShadow(sessionUuid, 'messages', body)` 或等价 RPC 调用。需要与 agent-core 的 `acceptIngress` / `extractTurnInput` 的 `session.messages` / `session.followup_input` dispatch 对齐

### R2. F1/F2/F3 closure 措辞 over-claim — "runtime kernel hookup contract land" 暗示端到端已通

- **严重级别**：high
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：
  - closure §0："Lane F runtime kernel hookup contract land（F1/F2/F3）"
  - closure §5.1："✅ Lane F F1-F5"
  - 实际代码 `nano-session-do.ts:771-803`：`emitPermissionRequestAndAwait` 内 `void this.sessionUuid; const helper = this.getWsHelper?.bind(this); void helper;`——两个 `void` 表达式不产生副作用，WS frame 从未发出
  - `hooks/permission.ts` 的 `verdictOf(outcome)` 同步路径未改造为 `await nanoSessionDo.emitPermissionRequestAndAwait()`
  - `onUsageCommit` callback 无消费者注册——`NanoSessionDO` 不在 `MainlineKernelOptions` 传入这个回调
  - closure §3.2 自认"infra 已就绪,future PR 引入 hook 调用即可消费"——但 §0 和 §5.1 的措辞远比"infra 已就绪"更强烈
  - ZX4 closure 曾因类似 over-claim（把"storage contract 已 land"写成"permission round-trip 业务闭环"）被 4-reviewer 修正——ZX5 出现同类模式
- **为什么重要**：后续开发者或 owner 读 closure 签字栏时会误以为 permission/elicitation await-resume 已端到端打通，可能导致后续 phase 遗漏 dispatcher 集成工作
- **审查判断**：需要将 closure §0 和 §5.1 的 F1/F2 条目修正为明确的 "infra landed, dispatcher wiring deferred" 标注
- **建议修法**：closure §0 改为 "Lane F NanoSessionDO wait-and-resume infra + onUsageCommit callback（F1/F2/F3）；**hook dispatcher 集成 + emitServerFrame wiring deferred**"

### R3. deploy-preview.sh 缺 D1 migration apply 步骤

- **严重级别**：high
- **类型**：delivery-gap
- **是否 blocker**：no
- **事实依据**：
  - `scripts/deploy-preview.sh`（126 行）有 6 worker deploy 顺序和 WORKER_VERSION 注入，但没有 `wrangler d1 migrations apply` 步骤
  - `workers/orchestrator-core/migrations/007-user-devices.sql` 新建 `nano_user_devices` 和 `nano_user_device_revocations` 表
  - 如果 migration 不 apply，`/me/devices` 和 `/me/devices/revoke` 对 D1 的 `SELECT`/`INSERT` 操作会因表不存在而 500
  - 脚本注释（第21-23行）写 "preview 不需要 migration gate，因为 ZX4 P3-01 migration 006 已经 apply 到 preview D1" — 但 007 是 ZX5 新增的，需要 apply
- **为什么重要**：D6 endpoint 部署后 500 直到 owner 手动跑 migration
- **建议修法**：在 `scripts/deploy-preview.sh` 中 orchestrator-core deploy 之前加 `npx wrangler d1 migrations apply NANO_AGENT_DB --env preview` 步骤；或在脚本顶部加注释说明 007 migration 需手动 apply

### R4. C2 两 worker jwt-shared 导入策略不一致

- **严重级别**：medium
- **类型**：protocol-drift
- **是否 blocker**：no
- **事实依据**：
  - `orchestrator-core/src/auth.ts:76`：`const { verifyJwt: sharedVerifyJwt } = await import("@haimang/jwt-shared")` — 动态 `await import()`
  - `orchestrator-auth/src/jwt.ts:6-13`：顶层静态 `import { ... } from "@haimang/jwt-shared"` — 静态导入
  - 同一共享包在两个 worker 使用不同加载策略
- **为什么重要**：
  1. 动态 import 使 `verifyJwt` 每次调用都有微秒级模块解析开销（虽然 Workers bundler 通常缓存）
  2. 如果 jwt-shared 加载失败，动态 import 路径会 reject（异常行为），而静态 import 路径在模块解析时就失败（确定性行为）
  3. `jwt-shared` 的设计目标是"single source of truth"，导入方式不一致违反这个原则的精神
- **审查判断**：两种策略都能正确验证 JWT，不构成运行时 bug，但形成认知负担
- **建议修法**：统一为顶层静态 import；或在 `auth.ts` 顶部注释说明动态 import 的理由（closure 风险表只说"减少绑定时刻 issue"但未详细说明）

### R5. kid rotation 测试仅在 orchestrator-auth，orchestrator-core 零覆盖

- **严重级别**：medium
- **类型**：test-gap
- **是否 blocker**：no
- **事实依据**：
  - `workers/orchestrator-auth/test/kid-rotation.test.ts` 存在 5 个测试
  - `workers/orchestrator-core/` 下无对应 kid rotation 测试
  - `orchestrator-core/src/auth.ts` 使用 `collectVerificationKeys` + `verifyJwtAgainstKeyring`（静态导入）+ `verifyJwt`（动态导入）+ `resolveSigningSecret`
  - 两 worker 的 JWT 验证路径不同（orchestrator-core 用 `verifyJwtAgainstKeyring`，orchestrator-auth 用 `verifyAccessToken` + `verifyJwt`），但 kid rotation 逻辑共享
- **为什么重要**：如果 orchestrator-core 的 `verifyJwtAgainstKeyring` 在 kid 切换场景有行为差异，不会被现有测试捕获
- **建议修法**：在 `workers/orchestrator-core/test/` 新增至少 2 个测试覆盖 kid rotation （v1→v2 overlap / v1 post-overlap 拒签）

### R6. C6 web 客户端保留本地 HeartbeatTracker 副本而非使用共享包

- **严重级别**：medium
- **类型**：scope-drift
- **是否 blocker**：no
- **事实依据**：
  - `clients/web/src/heartbeat.ts` 存在（49 行），是 `@haimang/nacp-session/heartbeat.ts` 的完整副本
  - `clients/web/src/client.ts` 从 `./heartbeat` 导入而非从 `@haimang/nacp-session` 导入
  - `clients/wechat-miniprogram/utils/heartbeat-adapter.js`（60 行）有合理的 local mirror 理由（小程序不支持 npm import）
  - Q3 owner direction 冻结为"通过 adapter 接入 `@haimang/nacp-session` root export"
  - C6 action plan 明确"删手写,改用 `@haimang/nacp-session` root export 的 shared helper / adapter"
- **为什么重要**：web 客户端维护本地副本会随时间漂移，违背 C6 "single source of truth" 目标
- **建议修法**：删除 `clients/web/src/heartbeat.ts`，改 `client.ts` 为 `import { HeartbeatTracker } from '@haimang/nacp-session'`

### R7. user-do.ts 2240 行、5 个新 handler 直填不拆分

- **严重级别**：medium
- **类型**：platform-fitness
- **是否 blocker**：no
- **事实依据**：
  - ZX4 closure 时 `user-do.ts` 为 1910 行，已标记 R26 需要拆分
  - ZX5 直接在 `user-do.ts` 新增 `handleMessages`/`handleFiles`/`handleMeConversations`/`handleMeDevicesList`/`handleMeDevicesRevoke` 5 个 handler，增至 2240 行
  - 行数增长方向与 ZX4 review 建议的"按 lifecycle/read-model/ws 边界搬移 handler"相反
- **为什么重要**：文件可维护性持续下降
- **建议修法**：后续 PR 将 product-surface handler（D3-D6）拆到 `session-product-handlers.ts` 或按 domain 拆分

### R8. F1/F2 `setTimeout` 在 DO hibernation/restart 场景下行为未文档化

- **严重级别**：medium
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：
  - `nano-session-do.ts:710-712` 使用 `setTimeout` 作为 `awaitAsyncAnswer` 的 timeout 机制
  - `sweepDeferredAnswers` 通过 `alarm()` 调用作为 DO restart recovery 路径
  - 但 Cloudflare Workers DO 在 hibernation 时内存中的 `setTimeout` 和 `deferredAnswers` map 会丢失
  - 如果 DO 在 await 期间 hibernate/restart，setTimeout 丢失，Promise 永远不会 resolve/reject——需要 alarm sweep 兜底
  - 当前代码没有注释或文档说明 DO hibernation 对 `awaitAsyncAnswer` 行为的影响
- **为什么重要**：生产环境中 DO hibernation 是常见场景，开发者需要知道 `awaitAsyncAnswer` 在 hibernation 后依赖 alarm sweep 恢复
- **建议修法**：在 `awaitAsyncAnswer` 方法注释中补充："If DO hibernation occurs during await, the in-memory deferred map and setTimeout are lost. Recovery relies on alarm() calling sweepDeferredAnswers() to resolve/reject pending deferredAnswers from storage."

### R9. D6 device 写入与 auth gate 读取端未连接

- **严重级别**：medium
- **类型**：delivery-gap
- **是否 blocker**：no
- **事实依据**：
  - `007-user-devices.sql` 创建 `nano_user_devices` 和 `nano_user_device_revocations` 表
  - `handleMeDevicesList`/`handleMeDevicesRevoke` 可读写这些表
  - 但 `IngressAuthSnapshot` 不含 `device_uuid` 字段，refresh/verify 路径不查询 `nano_user_devices`
  - 被 revoke 的 device 的请求当前不会被 auth gate 拒绝
  - closure §3.2 自认"revoke 后 active session best-effort 断开 second-half follow-up"
- **为什么重要**：数据写入但无消费者，形成半通路径
- **建议修法**：在 `index.ts` 的 `handleMeDevicesRevoke` 和 `handleMeDevicesList` 加 TODO 注释标注 "second-half: IngressAuthSnapshot device_uuid + auth gate device-active check"

### R10. `forwardInternalJsonShadow` 命名漂移 + `index.ts:18` stale comment

- **严重级别**：low
- **类型**：protocol-drift
- **是否 blocker**：no
- **事实依据**：
  - `user-do.ts:617` 方法名 `forwardInternalJsonShadow` 保留（7 处引用包括 4 call site）
  - ZX5 O11 推迟到"envelope refactor 一并做"
  - `index.ts:18` 有 stale comment "HTTP-truth result via jsonDeepEqual" 引用已被删除的函数
- **为什么重要**：ZX5 Lane C 是 "protocol hygiene" 阶段，却推迟了命名修正；新维护者会误以为有 HTTP shadow 行为
- **建议修法**：最低限度更新 `index.ts:18` 的 stale comment；完整重命名推迟到 `user-do.ts` handler 拆分时

### R11. E1/E2 RPC op 方法命名不统一

- **严重级别**：low
- **类型**：platform-fitness
- **是否 blocker**：no
- **事实依据**：
  - `ContextCoreEntrypoint.assemblerOps()` vs `FilesystemCoreEntrypoint.filesystemOps()`
  - 前者用业务域名，后者用技术域名
- **建议修法**：统一为 `{domain}Ops()` 模式或在文档中说明命名约定

### R12. `handleMeConversations` 分页不足

- **严重级别**：low
- **类型**：delivery-gap
- **是否 blocker**：no
- **事实依据**：
  - 始终以 `limit: 200` 查询 session 再归并，用户传更小的 `limit` 不会减少 D1 查询量
  - `next_cursor` 恒 null，无法翻页
  - 一个 conversation 有很多 sessions 时，200 条 session 记录可能映射到远少于 `limit` 个 conversation
- **建议修法**：后续 PR 完善 cursor-based 分页

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | `@haimang/jwt-shared` package 创建 + 两 worker 切换 | done | 238 行 API 完整，两 worker 已切换，20 unit 测试通过 |
| S2 | `RpcErrorCode ⊂ FacadeErrorCode` 跨包编译期断言 | done | `facade-http.ts:111-114` `_rpcErrorCodesAreFacadeCodes` 存在且类型正确 |
| S3 | envelope 关系文档化 | done | `README.md`（144 行）+ nacp-core cross-link |
| S4 | web/wechat client heartbeat/replay 切 shared helper | partial | wechat adapter 已迁移；web 客户端保留本地副本 `clients/web/src/heartbeat.ts` 未用共享包 import（R6） |
| S5 | WORKER_VERSION owner-local 注入 | partial | `deploy-preview.sh` 存在但缺 D1 migration apply 步骤（R3） |
| S6 | catalog content 填充 | done | 11 entries × 3 kinds；但缺少 `/me/sessions`、`/me/conversations`、`/me/devices` 命令条目 |
| S7a | `POST /sessions/{id}/messages` | partial | endpoint 存在但**不转发到 agent-core**（R1）——Q8 要求"/messages 是 /input 的多模态超集"但两者行为不等价 |
| S7b | `GET /sessions/{id}/files` | done | metadata-only 返回符合预期（R2 binding 缺失已自认） |
| S7c | `GET /me/conversations` | partial | 端点存在但分页不足+硬编码200查询（R12） |
| S7d | `POST /me/devices/revoke` | partial | endpoint + migration 存在但 auth gate 消费端未连接（R9）+ deploy 缺 migration apply（R3） |
| S8 | context-core/upgradRPC | done | minimal seam 符合 Q6+R9 约定 |
| S9 | filesystem-core/upgradRPC | done | 同 S8 |
| S10a | F1 PermissionRequest await/resume infra | partial | `awaitAsyncAnswer`/`sweepDeferredAnswers`/`emitPermissionRequestAndAwait` 已存在但 `void` 存根 + dispatcher 未接线 |
| S10b | F2 ElicitationRequest await/resume infra | partial | 同 S10a |
| S11 | F3 runtime emit `session.usage.update` | partial | `onUsageCommit` callback 定义+调用存在但无消费者注册——callback 定义了但 NanoSessionDO 从未传入 |
| S12 | F4 handleStart idempotency | done | `claimPendingForStart` D1 conditional UPDATE 实现 + 2 unit 测试 |
| S13 | F5 R28 runbook | partial | 模板完成但 §3 空白待 owner 回填 |
| S14 | Q10 alarm-driven wait-and-resume | done | `awaitAsyncAnswer` + `sweepDeferredAnswers` + `alarm()` 集成已实现 |
| S15 | Q11 D1 conditional UPDATE | done | `claimPendingForStart` 使用 `meta.changes > 0` |
| S16 | Q8 `/messages` 是 `/input` 多模态超集 | **not done** | 写入 D1 但不转发 agent-runtime，与 `/input` 行为不等价（R1） |
| S17 | Q9 device truth model | partial | D1 canonical truth 已建但 auth gate 消费端未连接（R9） |

### 3.1 对齐结论

- **done**: 8（S1, S2, S3, S7b, S8, S9, S12, S14, S15）
- **partial**: 8（S4, S5, S7c, S7d, S10a, S10b, S11, S13）
- **missing**: 1（S16 `/messages` 转发）
- **stale**: 0
- **out-of-scope-by-design**: 0

总结：ZX5 更像"核心骨架 + 产品面 endpoint 主体 + infra 合约已定义，但 dispatcher 接线和 `/messages` 转发两处关键 wiring 缺失"，而不是 closure 文档描述的完整端到端。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | transport finalization | 已遵守 | ZX4 已完成，ZX5 未触碰 |
| O2 | session 语义闭环 storage contract | 已遵守 | ZX4 Lane B 已完成；ZX5 Lane F 承接 kernel hookup |
| O3 | user-do.ts seam refactor | 部分违反 | R26 建议拆分，但 ZX5 反向增长 330 行至 2240 行（R7） |
| O6 | 6-worker 拓扑不变 | 已遵守 | `ls workers/` = 6 |
| O7 | D6 device model design 不在 ZX5 预设 | 已遵守 | Q9 已冻结 device truth 在 D1 表 |
| O8 | prod migration 006/007 apply不在ZX5 | 已遵守 | 但 `deploy-preview.sh` 应至少提醒 007 需手动 apply（R3） |
| O11 | forwardInternalJsonShadow 重命名推迟 | 已遵守 | 推迟到 envelope refactor；但 stale comment 存在（R10） |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：ZX5 主体交付可认证，Lane C/D/E/F4 的核心工作已完成，但 Lane F1/F2/F3 的 closure 措辞需要修正（over-claim），D3 `/messages` 需要补转发逻辑，deploy 脚本需要补 migration 步骤。整体框架可接受，3 个 high-severity 问题需在下一 PR 优先处理。
- **是否允许关闭本轮 review**：yes
- **关闭前必须完成的 blocker**：
  1. D3 `handleMessages` 加 `forwardInternalJsonShadow` 调用（或等价 agent-core RPC 转发）
  2. `deploy-preview.sh` 补 D1 migration apply 步骤（或加注释提醒 007 需手动 apply）
  3. ZX5 closure 文档 §0 和 §5.1 F1/F2/F3 措辞修正为 "infra landed, dispatcher wiring deferred"
- **可以后续跟进的 non-blocking follow-up**：
  1. C2 两 worker jwt-shared 导入策略统一（R4）
  2. orchestrator-core 补 kid rotation 集成测试（R5）
  3. C6 web 客户端删除本地 `heartbeat.ts` 副本改用共享包 import（R6）
  4. `user-do.ts` handler 拆分（R7）
  5. `awaitAsyncAnswer` DO hibernation 行为文档化（R8）
  6. D6 auth gate device-active check TODO 标注（R9）
  7. `forwardInternalJsonShadow` stale comment 更新（R10）
  8. `handleMeConversations` 分页完善（R12）
- **建议的二次审查方式**：same reviewer rereview — 3 个 high-severity follow-up 修复后 GLM 复核
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §6 append 回应，不要改写 §0–§5。

---

## 6. 跨阶段分析：zero-to-real 全系列回顾

以下是对 ZX0→ZX5 全系列跨阶段的深度审视，超越 ZX5 单阶段范围。

### 6.1 持续 carryover 四阶段未决项

| 项 | ZX2 | ZX3 | ZX4 | ZX5 | 状态 |
|---|---|---|---|---|---|
| R28 verify-cancel deploy 500 | carryover | carryover | try/catch 缓解 | F5 runbook 模板（§3空） | **4 阶段未修** |
| `pnpm-lock.yaml` stale blocks | — | owner-action | owner-action | owner-action | **4 阶段未清** |
| WeChat 真机 smoke | owner-action | owner-action | owner-action | owner-action | **4 阶段未执行** |
| `forwardInternalJsonShadow` 重命名 | — | — | acknowledged | acknowledged,推迟 | **命名漂移持续** |
| user-do.ts 行数 | 1659 | — | 1910 | **2240** | **持续增长方向与 R26 相反** |

**判断**：R28 和 `pnpm-lock.yaml` 是 owner-action 类型的冻结项，代码 agent 无法独立推进，此状态可接受。但 `forwardInternalJsonShadow` 在 "protocol hygiene" 阶段（Lane C）推迟到"envelope refactor 时一并做"，这个推迟理由已不再充分——ZX5 自身就是做 envelope 关系文档化的阶段，rename 应该在本阶段完成。

### 6.2 ZX4→ZX5 的 over-claim 模式复现

ZX4 closure 曾把"permission/elicitation decision-forwarding storage contract 已 land"写成"permission round-trip 业务闭环"，经 4-reviewer 审查后修正措辞。

ZX5 出现同类模式：
- closure §0 写 "Lane F runtime kernel hookup contract land（F1/F2/F3）"
- 实际状态：`awaitAsyncAnswer` 基础设施已 land，但 `hooks/permission.ts` 中 `verdictOf(outcome)` 未改造、`emitPermissionRequestAndAwait` WS emit 为 `void` 存根、`onUsageCommit` 无消费者

**建议**：后续 closure 文档对 "infra/contract landed, wiring deferred" 类状态采用统一标注格式（如 ⚠️ 而非 ✅），避免与端到端已通的状态混淆。

### 6.3 D3 `/messages` 缺失转发的跨阶段影响

Q8 定义了 `/messages` 作为 `/input` 的多模态超集，且 "前端可以选 `/input`(text-only) 或 `/messages`(任意 parts);worker 不维护两套落库路径"。

但 `handleMessages` 确实只走落库路径，不走 runtime 转发路径。这意味着：
- 如果前端切换到 `/messages`（作为 `/input` 的超集替代），agent 不会收到通知
- `/messages` 和 `/input` 行为不等价——前端选 `/messages` 时消息落入 D1 但 agent 不处理
- 这不是 D3 的"部分完成"问题，而是 core chain 断裂——写入了 D1 但整个 processing pipeline 没有被触发

这个缺口应在 ZX5 修复前标记为 known issue，并在 closure 中明确声明。

### 6.4 `nano-session-do.ts` 的 `setTimeout` 在 Workers DO 语义下的可靠性

`awaitAsyncAnswer` 用 `setTimeout(reject, timeoutMs)` 做 timeout 保底，用 `alarm()` 里调 `sweepDeferredAnswers()` 做 DO restart recovery。

但 Cloudflare Workers DO 在 hibernation 下：
1. `setTimeout` 在 DO 内存中，hibernation 后丢失
2. `deferredAnswers` Map 在 DO 内存中，hibernation 后丢失
3. 唯一恢复路径是 alarm sweep 读 storage → resolve 新 await

代码逻辑是对的（alarm sweep 确实能恢复），但当前代码缺少对 "await 期间 DO hibernate 后恢复" 场景的显式测试——只有 timeout（60s fail-closed）和 sweep（compaction cycle 后恢复）。如果 DO hibernate 时间 > timeout 阈值，callback 会先 timeout reject，即使 storage 中已有 decision。

**建议**：在 F1/F2 的 follow-up PR 中补充 DO hibernate recovery 测试场景。

### 6.5 命名一致性深挖

- `forwardInternalJsonShadow` — 方法名暗示 dual-track 行为（shadow = HTTP fallback），但 ZX4 P9 flip 后是纯 RPC。这个命名自 ZX4 review 后已被三位 reviewer 标注，推迟理由从 "不影响运行时" 到 "envelope refactor 时一并做" 到 "user-do 拆分时一并做"——每次推迟我们都为下一个推迟找到合理化理由。
- `assemblerOps()` vs `filesystemOps()` — 同为 RPC op 列表方法，一个用业务域名一个用技术域名。minimal seam 可接受，但后续加 op method 时需要选择命名模式。
- `handleMessages` vs `handleInput` — 两者的核心区别（前者不转发 agent-core）在方法名上没有体现，也没有注释说明 `handleMessages` 当前是 "write-only" 状态。
- `_rpcErrorCodesAreFacadeCodes` vs `_authErrorCodesAreFacadeCodes` — 两个编译期断言变量命名一致，✓

### 6.6 零遗漏确认：O11 forwardInternalJsonShadow 是否应在本阶段处理

ZX5 action plan §2.2 O11 明确写着：

> `[O11 — 新增] forwardInternalJsonShadow 重命名 — 推迟到本 plan Lane C 或后续 plan envelope refactor 时一并做(per GPT R7 / kimi R8 / deepseek R9)`

"推迟到本 plan Lane C"——Lane C 是 "protocol hygiene"，其核心目标包括 "让协议层从手写+重复+隐式约定变成 single source + 编译期约束 + 文档明确"。`forwardInternalJsonShadow` 这个方法名是典型的 "隐式约定"（shadow 暗示 dual-track 但实际已非 shadow），应属于 Lane C 的清理范围。

但 O11 同时也写 "或后续 plan envelope refactor"，给了推迟的出口。考虑到 ZX5 已经相当长（4 lanes / 22 phases），推迟是合理的产能决策，但应至少更新方法注释明确当前行为的语义已变为 "RPC-only forward"。

**最终判断**：不阻塞关闭，但 `index.ts:18` 的 stale comment 必须更新。

---

> 2026-04-28 — GLM 独立审查完成。核心骨架+产品面+infra合约可行，但 D3 `/messages` 不转发 agent-core、F1/F2/F3 dispatcher+wiring 两处空存根、deploy 脚本缺 migration apply 三个 high-severity 项需下一 PR 优先修复。closure 措辞需修正 F1/F2/F3 为 "infra landed, dispatcher wiring deferred"。zero-to-real 系列跨 4 阶段的 carryover 项（R28、pnpm-lock、WeChat smoke、forwardInternalJsonShadow 重命名、user-do 行数增长）应在下一 plan 统筹处理。
---

## 7. 审查质量评价（Opus 4.7 修复后回填）

> 评价对象: `GLM ZX5 全 4 lane review`
> 评价人: `Opus 4.7 (1M ctx)`
> 评价时间: `2026-04-28`

---

### 7.0 评价结论

- **一句话评价**:**最广覆盖、运维 / 部署 / 测试 / 架构债务全维度扫描的 reviewer**;在 4 位中 finding 数量最多(12 条)、唯一识别出 deploy script 缺 migration apply 与 user-do.ts 行数膨胀这两条独家高价值 finding,代价是 finding 颗粒度更细、low-severity 噪音也更多。
- **综合评分**:**8.7 / 10**
- **推荐使用场景**:phase closure 前的"全维度扫描"角色 — code / docs / deploy script / test 覆盖盲区 / 跨阶段债务 一起扫;特别适合检查 closure 措辞与代码现实的 over-claim 偏差。
- **不建议单独依赖的场景**:不擅长定位**单点 latent correctness bug**(例如 deepseek R2 的 role 判定 bug,GLM 仅在 §1.2 提及"D3 不转发"但没单独识别 role bug);finding 列表偏长,实现者需要自行筛选 priority。

---

### 7.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | **multi-axis(code + docs + deploy ops + test gap + 跨阶段债务)** | R1 业务断裂 + R2 closure over-claim + R3 deploy gate + R5 测试覆盖 + R7 行数膨胀 + §6 跨阶段 carryover |
| 证据类型 | **行号 + 命令 + 文件不存在性 grep + ZX2-ZX5 跨阶段对账** | §6.1 表格直接给出 R28 / pnpm-lock / WeChat smoke / forwardInternalJsonShadow / user-do.ts 行数 5 项跨 4 阶段未决项 |
| Verdict 倾向 | **balanced** — `approve-with-follow-ups` + 明确分 high/medium/low | §0 写"不阻塞 ZX5 关闭但必须在下一 PR / ZX6 之前修复" |
| Finding 粒度 | **fine(12 findings,low 量级偏多)** | R10 stale comment / R11 命名不统一 这种 low-severity 项也单独列条目 |
| 修法建议风格 | **actionable** — 大部分给具体路径修复方法,但少数偏笼统 | R7 仅说"后续 PR 拆 session-product-handlers.ts",未指 method 拆分边界 |

---

### 7.2 优点与短板

#### 7.2.1 优点

1. **R3(deploy-preview.sh 缺 migration apply)是独家高价值 finding** — 4 位 reviewer 只有 GLM 看了 `scripts/deploy-preview.sh`,识别到 migration 007 不会自动 apply 会让 `/me/devices*` 部署后 500;这是一个 high-severity ops blocker,fix 已 land。
2. **R5(orchestrator-core 缺 kid rotation 测试)是 4 位中唯一的 cross-worker test asymmetry 识别** — orchestrator-auth 有 5 个 rotation 测试但 orchestrator-core 走不同的 `verifyJwtAgainstKeyring` 路径却没有覆盖,GLM 通过 grep + 跨 worker 对照定位;fix 后新增 3 unit。
3. **R8(DO hibernation 行为未文档化)和 R11(命名不统一)是 platform-fitness 关怀** — 这类 low-severity 但长期维护友好的 finding,只有 GLM 提出;reviewer 中最关注代码可读性和长期工程债务。
4. **§6.1 跨阶段 carryover 表格** — ZX2 → ZX5 跨 4 阶段的 R28 / pnpm-lock / WeChat smoke / forwardInternalJsonShadow / user-do.ts 行数 5 项追踪表,在所有 reviewer 中维度最完整,直接告诉 owner "哪些债务跨阶段没还"。

#### 7.2.2 短板 / 盲区

1. **R1 描述虽然准确但**深度**不及 deepseek R1** — GLM 只说"`/messages` 不转发 agent-core,与 `/input` 行为不等价",但没像 deepseek 那样把 Q8 owner direction 原文 + `extractTurnInput` agent-core 接受形态 + 落库分裂 三层一起讲透。
2. **完全没识别 deepseek R2 的 role 判定 bug** — GLM §1.2 提及 D3 不转发但未发现 `recordUserMessage` line 373 的 silently 错误。说明它对**单点字段级别的 latent semantic bug**敏感度不如 deepseek。
3. **R12(`/me/conversations` 分页不足)严重程度 low 但 fix 路径不清晰** — "cursor-based 分页"是大改造,与 read-model 演进相关;在没有用户基数证据下提出这条 finding 是 noise,实现者只能 deferred。
4. **R6(web 客户端 local mirror)与 kimi R3 重复** — 两条 finding 实质相同,GLM 与 kimi 撞车说明 reviewer 间没有事先去重(可能 reviewer 互不知)。

---

### 7.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| R1 | high | **true-positive(与 deepseek R1 重叠)** | good | 业务断裂识别正确,但深度不及 deepseek;fix 已 land |
| R2 | high | **true-positive(closure over-claim)** | excellent | F1/F2/F3 closure 措辞 over-claim,与 deepseek R6+R7 / kimi R1+R2 / GPT R1 共识,closure 已 reword |
| R3 | high | **true-positive(GLM 独家)** | excellent | deploy script 缺 migration apply,4 位中只有 GLM 看到 deploy 层 |
| R4 | medium | **true-positive(minor)** | good | C2 两 worker import 策略不一致,fix 已统一为静态 import |
| R5 | medium | **true-positive(GLM 独家)** | excellent | orchestrator-core 缺 kid rotation 测试,fix 后新增 3 unit |
| R6 | medium | **true-positive(与 kimi R3 重叠)** | mixed | 与 kimi R3 实质同条,且 web 客户端 mirror 是 owner-direction Q3 已知 trade-off,严重程度可调低 |
| R7 | medium | **true-positive(carryover-debt)** | good | user-do.ts 2240 行确实违反 ZX4 R26 拆分目标,但 fix 路径笼统;deferred 合理 |
| R8 | medium | **true-positive(GLM 独家)** | excellent | DO hibernation 行为未文档化,4 位中只有 GLM 看到 platform 层;fix 已加 JSDoc |
| R9 | medium | **true-positive(与 kimi R6 重叠)** | good | D6 second-half device-active check 缺失,fix 已加 TODO |
| R10 | low | **true-positive(GLM 独家)** | good | `index.ts:18` stale jsonDeepEqual 注释,fix 已 reword |
| R11 | low | **true-positive(GLM 独家)** | good | `assemblerOps` vs `filesystemOps` 命名不统一,fix 已 rename |
| R12 | low | **partial(noise)** | weak | 分页不足在没有用户证据时是 hypothetical 问题;deferred |

---

### 7.4 多维度评分 - 单项总分 10 分

| 维度 | 评分(1–10)| 说明 |
|------|-------------|------|
| 证据链完整度 | **9** | 行号 + 命令 + 跨阶段对账,但单点 latent bug 的 grep 深度不如 deepseek |
| 判断严谨性 | **8** | R12 偏推测;其它 finding 判断都准 |
| 修法建议可执行性 | **8** | 大部分 actionable,R7 user-do 拆分路径偏笼统 |
| 对 action-plan / design / QNA 的忠实度 | **8** | 引 ZX5 plan §7.2 + Q8 / Q9,但反向校验深度不如 deepseek |
| 协作友好度 | **9** | verdict 平衡,blocker 与 follow-up 区分清晰,§5 收口意见明确 |
| 找到问题的覆盖面 | **10** | code / docs / deploy / test / 跨阶段债务五个维度全扫,4 位中最广 |
| 严重级别 / verdict 校准 | **8** | high 量级偏多(R1+R2+R3 都是 high),实际只有 R3 + closure 措辞是真硬伤;low 量级 R10/R11/R12 偏多噪音 |

**加权总分:8.7 / 10**(覆盖最广 + 独家 finding 最多 = R3/R5/R8/R10/R11 五条只有 GLM 抓到,价值密度高;扣分主要来自 finding 颗粒度偏细 + 严重级别偶尔虚高)
