# ZX1-ZX2 reviewed by GPT

> 审查对象: `zero-to-real ZX1 + ZX2 执行结果`
> 审查类型: `mixed`
> 审查时间: `2026-04-27`
> 审查人: `GPT-5.5`
> 审查范围:
> - `docs/action-plan/zero-to-real/ZX1-wechat-ehance.md`
> - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`
> - `docs/issue/zero-to-real/ZX1-closure.md`
> - `docs/issue/zero-to-real/ZX2-closure.md`
> - ZX1/ZX2 相关 packages / workers / clients / tests / docs 当前代码事实
> 对照真相:
> - `docs/templates/code-review.md`
> - ZX1 / ZX2 action-plan 的 in-scope、exit criteria、执行日志与 closure claim
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：ZX1 的主体交付成立；ZX2 的 contract 与大量本地 runtime 改动也真实存在，但 ZX2 不能按当前 closure 口径关闭为 `ALL-DONE`，只能关闭为“契约层 + 本地实现层已大体落地，preview publish / live e2e / 7 天 parity / internal HTTP 最终翻转仍未完成”。
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. ZX2 closure 把仍需 publish、preview deploy、live e2e、7 天 parity、P3-05 删除 fetch 路径的后续动作写成“不阻塞收口”，但这些正是 ZX2 action-plan 自己定义的 DoD / exit criteria。
  2. `session-ws-v1` 与 “7 个 message_type WS 接入” 的描述过度乐观：当前代码有 schema、registry、compat helper 和少量 HTTP mirror，但 wire 仍是 lightweight `{kind,...}`，permission/usage/elicitation 等 live round-trip 没有端到端闭合。
  3. `/me/sessions` 的 server-mint UUID 已有入口，但 TTL、pending session truth、重复 start 409、跨设备 resume 语义还没有真正落到持久状态机。

---

## 1. 审查方法与已核实事实

本次审查只使用 ZX1/ZX2 action-plan、两份 closure、当前代码与测试结果；没有引用 Kimi、Deepseek、Opus 的其他 code-review / eval 分析报告。ZX2 action-plan / closure 本身的作者字段属于被审对象的一部分，不作为外部审查意见采纳。

- **对照文档**：
  - `docs/action-plan/zero-to-real/ZX1-wechat-ehance.md`
  - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`
  - `docs/issue/zero-to-real/ZX1-closure.md`
  - `docs/issue/zero-to-real/ZX2-closure.md`
- **核查实现**：
  - `packages/orchestrator-auth-contract/src/index.ts`
  - `packages/nacp-core/src/rpc.ts`
  - `packages/nacp-session/src/messages.ts`
  - `packages/orchestrator-auth-contract/src/facade-http.ts`
  - `workers/orchestrator-auth/src/{wechat,service,public-surface}.ts`
  - `workers/orchestrator-core/src/{index,user-do,frame-compat}.ts`
  - `workers/agent-core/src/{index,host/internal,host/remote-bindings}.ts`
  - `workers/bash-core/src/index.ts`
  - `clients/web/src/client.ts`
  - `clients/wechat-miniprogram/{apiRoutes.js,utils/api.js,utils/wechat-auth.js}`
  - `clients/api-docs/**`
  - `docs/transport/transport-profiles.md`
  - `docs/runbook/zx2-rollback.md`
  - `test/cross-e2e/zx2-transport.test.mjs`
- **执行过的验证**：
  - `pnpm --filter @haimang/orchestrator-auth-contract test` -> `19/19 passed`
  - `pnpm --filter @haimang/orchestrator-auth-worker test` -> `8/8 passed`
  - `pnpm --filter @haimang/orchestrator-core-worker test` -> `41/41 passed`
  - `pnpm --filter @haimang/bash-core-worker test` -> `370/370 passed`
  - `pnpm --filter @haimang/agent-core-worker test` -> `1054/1054 passed`
  - `node --test test/cross-e2e/zx2-transport.test.mjs` -> skipped because `NANO_AGENT_LIVE_E2E` is not set
- **复用 / 对照的既有审查**：
  - `none` — 本次按用户要求独立审查，不读取其他 reviewer 报告。

### 1.1 已确认的正面事实

- ZX1 的 WeChat contract 已不再是 code-only：`WeChatLoginInputSchema` 接收 `code`、`encrypted_data`、`iv`、`display_name`，并强制 `encrypted_data` 与 `iv` 成对出现；`invalid-wechat-payload` 已进入 auth error code。
- ZX1 的 auth worker 具备 decrypt-capable path：`wechat.ts` 从 `jscode2session` 获取 `session_key`，用 AES-CBC 解密 profile，并校验 watermark appid；`service.ts` 对拍 decrypted `openid` 与 `jscode2session.openid`。
- ZX1 的 6-worker health matrix 已有真实代码：各 worker `/health` 带 `worker_version`，`orchestrator-core` 暴露 `/debug/workers/health` 并通过 service binding 聚合 self + auth + agent + bash + context + filesystem。
- ZX1 的前端文档资产存在：`clients/api-docs/{README,auth,wechat-auth,session,worker-health}.md` 覆盖 auth/session/health。
- ZX2 的 NACP 协议 surface 确实新增：`packages/nacp-core/src/rpc.ts`、`RpcMetaSchema`、`RpcErrorCodeSchema`、`validateRpcCall` 与 helper 已存在并被测试覆盖。
- ZX2 的 `nacp-session` 5 族 / 7 message types 已进 `SESSION_BODY_SCHEMAS`：`session.permission.{request,decision}`、`session.usage.update`、`session.skill.invoke`、`session.command.invoke`、`session.elicitation.{request,answer}`。
- ZX2 的 `facade-http-v1` contract 已存在：`packages/orchestrator-auth-contract/src/facade-http.ts` 提供 `FacadeEnvelope`、`facadeOk`、`facadeError`、`facadeFromAuthEnvelope`。
- ZX2 的 bash-core RPC 入口已存在：`BashCoreEntrypoint.call/cancel` 使用 `RpcMetaSchema`，并要求 `request_uuid` for call。
- ZX2 的 agent-core 侧新增 `input/cancel/verify/timeline/streamSnapshot` RPC method，orchestrator-core 的 `forwardInternalJsonShadow` 做 dual-track parity。
- ZX2 的新 HTTP facade 入口已存在：`/catalog/{skills,commands,agents}`、`/me/sessions`、`/sessions/{id}/usage`、`/sessions/{id}/resume`、`/sessions/{id}/permission/decision`、`/sessions/{id}/policy/permission_mode`。

### 1.2 已确认的负面事实

- `docs/action-plan/zero-to-real/ZX2-transport-enhance.md` 顶部仍是 `文档状态: draft (v2)`，但同一文件底部又写 `Phase 1-6 全部落地`。
- `docs/issue/zero-to-real/ZX2-closure.md` 标题与 TL;DR 使用 `ALL-DONE` / `收口` / `2392 tests 全绿` 的强口径，但 §4.1 / §4.2 / §6.3 / §7 明确仍需 publish、dep bump、preview deploy、live e2e、7 天 parity 与 P3-05 翻转。
- `packages/nacp-core/package.json` 仍是 `1.4.0`，`packages/nacp-session/package.json` 仍是 `1.3.0`；`workers/{orchestrator-core,agent-core,bash-core}/package.json` 仍依赖 `@haimang/nacp-core: 1.4.0` 与 `@haimang/nacp-session: 1.3.0`。
- ZX2 执行日志 §13.4 明确承认曾用 dist overlay 解决 pnpm cache / 已发布包不含 `rpc.ts` 的问题；这说明“仓库本地 green”与“可部署依赖链 green”不是同一个事实。
- `test/cross-e2e/zx2-transport.test.mjs` 当前 live-gated，默认只 skip；即使设置 token，它也明确“stops short of starting a real session”，不覆盖 action-plan 原写的 `start → permission round-trip → usage update → cancel → sessions list`。
- `frame-compat.ts` 与 `user-do.ts` 当前明确保留 lightweight `{kind,...}` WS wire；`transport-profiles.md` 却写 `session-ws-v1` wire “必须满足 `NacpSessionFrameSchema`”，两者不一致。
- `handlePermissionDecision()` 只把 decision 写入 hot index；注释明确说 live round-trip 会在 nacp-session permission frames wired through agent-core 后再接入。
- `/me/sessions` POST 只返回一个 UUID 与 TTL 数字，不写 pending truth；`handleStart()` 对同一 session UUID 没有重复 start 409 guard。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 核查了 ZX1/ZX2 action-plan、closure、相关 packages/workers/clients/tests/docs。 |
| 本地命令 / 测试 | `yes` | 相关 auth/orchestrator/agent/bash tests 通过；ZX2 live e2e 默认 skip。 |
| schema / contract 反向校验 | `partial` | 核查了 zod schema、registry 与 tests；未写新的 runtime safeParse harness。 |
| live / deploy / preview 证据 | `no` | 当前 review 没有 preview env secret/token，且 ZX2 closure 自身承认 preview live e2e 待跑。 |
| 与上游 design / QNA 对账 | `yes` | 对账 ZX1/ZX2 action-plan 的 S/O 项、DoD、Q1-Q6 决策与执行日志。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | ZX2 `ALL-DONE` closure 口径与 action-plan DoD 冲突 | `critical` | `scope-drift` | `yes` | 降级 closure 状态，拆出 publish / preview / parity / P3-05 翻转收尾清单。 |
| R2 | NACP publish / dep bump 未完成，当前依赖链仍指向旧版本 | `high` | `delivery-gap` | `yes` | 完成 package bump/publish/consumer dep update，或在 closure 明确“本地 workspace-only”。 |
| R3 | `session-ws-v1` 文档宣称 NACP wire，但代码仍发 lightweight `{kind,...}` | `high` | `protocol-drift` | `yes` | 改文档为 compat wire，或真正把 wire 切到 `NacpSessionFrameSchema`。 |
| R4 | permission / usage / elicitation 等 WS round-trip 未真正闭合 | `high` | `delivery-gap` | `yes` | 把 closure 的“接入”改为 schema/helper ready，或补 producer/consumer + e2e。 |
| R5 | `/me/sessions` server-mint 语义只完成入口，TTL / pending / duplicate start 未落地 | `high` | `correctness` | `yes` | 建立 pending session truth 与 duplicate start guard，或收窄语义声明。 |
| R6 | ZX1 缺真实微信开发者工具 / health debug 手动 smoke 证据 | `medium` | `test-gap` | `no` | 在 closure 补 evidence，或把 ZX1 状态限定为 local/unit verified。 |
| R7 | 文档状态、文件命名与执行者口径存在治理漂移 | `medium` | `docs-gap` | `no` | 修正 ZX2 action-plan 状态、ZX1 文件名 typo，并统一执行者/状态字段。 |

### R1. ZX2 `ALL-DONE` closure 口径与 action-plan DoD 冲突

- **严重级别**：`critical`
- **类型**：`scope-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md` §8.2/§8.3 把 `internal-http-compat` 迁到 `retired`、HTTP 路径删除、live preview e2e、7 天连续绿、parity ≥1000 turns 0 mismatch、rollback runbook 演练通过列为整体收口标准 / DoD。
  - `docs/issue/zero-to-real/ZX2-closure.md` §4.1 仍列出 `nacp-core 1.4.1 publish`、consumer dep bump、preview deploy、live preview e2e；§4.2 仍列出 7 天观察后删除 fetch fallback / `internal-http-compat` 推进到 `retired`；§6.3 写 “preview 待部署后 curl 验证”。
  - `docs/issue/zero-to-real/ZX2-closure.md` §8 又写 `Phase 1-6 全部落地`、`ALL-DONE`、`Total: 27/27 工作项交付`。
- **为什么重要**：
  - 这不是普通文档措辞问题。ZX2 的核心目标就是 transport 收口和 internal HTTP 退役；如果把“仍在 rollback / parity / publish 前状态”写成 all-done，后续阶段会错误地以为可以删除兼容讨论、依赖发布、preview 观测和 live rollback 演练。
  - 当前事实更像 `implemented-local + contract-frozen + rollout-pending`，不是 `closed-final`。
- **审查判断**：
  - ZX2 不能按当前 closure 标记为全量关闭。可以承认本地代码和单测大面积成立，但必须把 closure verdict 改为分层状态。
- **建议修法**：
  - 将 `ZX2-closure.md` 顶部 `ALL-DONE` 改成 `local-implementation-complete / rollout-pending` 或等价状态。
  - 把 §4.1/§4.2/§6.3 中的 publish、preview deploy、live e2e、7 天 parity、P3-05 翻转改成 `blocking-to-final-close` 清单，而不是“不阻塞收口”。
  - `transport-profiles.md` 中 `internal-http-compat` 保持 `retiring` 或 `retired-with-rollback`，不要写成事实上已 retired。

### R2. NACP publish / dep bump 未完成，当前依赖链仍指向旧版本

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `packages/nacp-core/package.json` 当前版本是 `1.4.0`。
  - `packages/nacp-session/package.json` 当前版本是 `1.3.0`。
  - `workers/orchestrator-core/package.json`、`workers/agent-core/package.json`、`workers/bash-core/package.json` 仍依赖 `@haimang/nacp-core: "1.4.0"` 与 `@haimang/nacp-session: "1.3.0"`。
  - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md` §13.4 明确说 “dist overlay 解决 pnpm cache 问题”，正式发布时 `nacp-core` 应 bump `1.4.1`。
  - `docs/issue/zero-to-real/ZX2-closure.md` §4.1 把 publish + dep bump 列为后续动作。
- **为什么重要**：
  - ZX2 的核心是把 `rpc.ts`、new message types 与 facade contract 变成可部署 contract。只在 workspace 源码中存在、不发布到 GitHub Packages，不能保证 worker preview/prod 在真实 install/deploy 时拿到同一协议版本。
  - dist overlay 是本地 workaround，不应被 closure 包装成最终交付完成。
- **审查判断**：
  - 这是 ZX2 final-close blocker。除非项目明确规定所有 worker deploy 都只用 monorepo workspace build，否则 package publish 与 dep bump 是 transport contract 的一部分。
- **建议修法**：
  - 发布 `@haimang/nacp-core@1.4.1` 与 `@haimang/nacp-session@1.3.1`，并把 consumer deps 改到新版本范围。
  - 或在 closure 中明确：当前仅支持 monorepo workspace deploy，外部 package deploy 尚未完成，不允许写 `final`。

### R3. `session-ws-v1` 文档宣称 NACP wire，但代码仍发 lightweight `{kind,...}`

- **严重级别**：`high`
- **类型**：`protocol-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/transport/transport-profiles.md` §2.4 写 `session-ws-v1` wire “必须满足 `NacpSessionFrameSchema`”，并禁止 flat / lightweight shape 绕过 schema。
  - `workers/orchestrator-core/src/frame-compat.ts` 明确写 “keep the lightweight shape on the wire”，`liftLightweightFrame()` 是兼容映射，不是实际 wire。
  - `workers/orchestrator-core/src/user-do.ts` 的 heartbeat 仍发送 `JSON.stringify({ kind: 'session.heartbeat', ts: Date.now() })`；attachment superseded 也发送 `{kind:'attachment_superseded', ...}`。
  - `clients/web/src/client.ts` 的 WS reader 仍直接接收 `SessionEvent`，看 `seq/kind` 并发送 `{ message_type: "session.stream.ack", body: ... }`。
- **为什么重要**：
  - 这会让前端、SDK、后续 reviewer 误以为 WS wire 已经是 NACP envelope，可以直接按 `NacpSessionFrameSchema` parse。真实代码则仍需要 lightweight parser。
  - 这类协议文档错误会在客户端 SDK 抽象时变成破坏性 bug。
- **审查判断**：
  - 当前真实状态应描述为 `session-ws-v1 lightweight wire + NACP-compatible lift helper`，不是 “wire 已满足 NacpSessionFrameSchema”。
- **建议修法**：
  - 二选一：
    1. 修文档：把 `session-ws-v1` 定义为 lightweight wire，`NacpSessionFrameSchema` 仅为 canonical mapping / future v2；或
    2. 修代码：所有 server frame 真正发送 `NacpSessionFrameSchema` envelope，并同步 web / mini-program parser。

### R4. permission / usage / elicitation 等 WS round-trip 未真正闭合

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `packages/nacp-session/src/messages.ts` 已注册 7 个 message types，但 `workers/orchestrator-core/src/user-do.ts` 只提供 `emitServerFrame()` helper。
  - `emitServerFrame()` 的注释写 “Used by future plumbing”，说明当前还不是业务路径。
  - `handlePermissionDecision()` 的注释写 “live round-trip lives on the WS path; ... plumbed once nacp-session permission frames are wired through agent-core”，实际只 `put(permission_decision/<uuid>)`。
  - `handleUsage()` 返回 usage 字段全为 `null`，注释写 placeholders until real budget pipe lands。
  - `test/cross-e2e/zx2-transport.test.mjs` 注释明确 “stops short of starting a real session”，没有覆盖 permission round-trip / usage update / cancel / sessions list full path。
- **为什么重要**：
  - ZX2 action-plan 的目标不是只注册 schema，而是前端 facade 必需能力闭环。当前更像 “schema + HTTP snapshot/mirror + future hook ready”，不等于 WS round-trip 已接入。
- **审查判断**：
  - closure 中 “7 个新 WS message_type 接入” 和 “permission/usage 闭环”应降级。可以写 `registered + partially surfaced`，不能写 fully wired。
- **建议修法**：
  - 补从 agent/runtime permission gate 触发 `session.permission.request` 的 producer。
  - 补客户端通过 WS/HTTP decision 回流到正在等待的 runtime request 的 resolver。
  - 补 usage budget pipe 与 `session.usage.update` 推送。
  - 补 live-gated e2e：`start -> permission request -> deny/allow -> usage update -> cancel -> sessions list`。

### R5. `/me/sessions` server-mint 语义只完成入口，TTL / pending / duplicate start 未落地

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts` 的 `POST /me/sessions` 只生成 `crypto.randomUUID()` 并返回 `{status:"pending", ttl_seconds, start_url}`；没有写入 DO storage、D1、KV 或其他 pending index。
  - `GET /me/sessions` 转发到 User DO 的 hot conversation index；pending UUID 未 start 前不会出现在该 index。
  - `workers/orchestrator-core/src/user-do.ts` 的 `handleStart()` 没有检查同一个 `sessionUuid` 是否已经 started / active / detached，调用会覆盖 `sessionKey(sessionUuid)` 并创建新 turn。
  - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md` §4.5 P5-02 明确要求 TTL 24h 未 start 自动 GC、跨设备 resume、重复 start 返回 409；§13.4 又写 `/me/sessions POST 不写 D1`。
- **为什么重要**：
  - “server-mint UUID 是单一真相”必须有服务器端 pending truth。否则 POST 只是随机数服务，无法表达 TTL、跨设备恢复、重复 start、未 start 清理。
  - 客户端无法通过 `GET /me/sessions` 找回已 mint 但未 start 的 UUID，跨设备 resume 语义不成立。
- **审查判断**：
  - 当前 `/me/sessions` 可作为 “server-side UUID generator + rejects client-supplied UUID” 收口，但不能作为 action-plan 所写完整 session identity truth 收口。
- **建议修法**：
  - 在 User DO 或 D1 truth 中新增 pending session record，包含 `session_uuid`、`created_at`、`expires_at`、`status: pending`、owner user/team。
  - `GET /me/sessions` 返回 pending + started sessions。
  - `handleStart()` 若 session 已 started/active/detached/ended，按冻结规则返回 409 或明确幂等策略。
  - alarm / cleanup 实现 TTL GC。

### R6. ZX1 缺真实微信开发者工具 / health debug 手动 smoke 证据

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/action-plan/zero-to-real/ZX1-wechat-ehance.md` §8 要求 “微信开发者工具一次真实登录” 与 “web / mini-program 至少各跑一次 worker health debug route”。
  - `docs/issue/zero-to-real/ZX1-closure.md` §3 只列自动化命令，没有真实微信开发者工具截图、请求/响应样本、trace_uuid、preview URL 或 health debug 输出锚点。
  - 代码层和单测证明了 decrypt-capable path，但没有证明真实 WeChat appid/secret + 微信开发者工具链路已跑通。
- **为什么重要**：
  - 微信登录增强高度依赖平台侧 `jscode2session` 与真实 `encryptedData/iv`，仅单测和 mock 不能完全替代一次真实工具 smoke。
- **审查判断**：
  - ZX1 可按 `decrypt-capable code path + docs + unit/integration verified` 关闭；若 closure 要写“真实接通”，需要补手动证据。
- **建议修法**：
  - 在 `ZX1-closure.md` 补一段 manual smoke evidence：时间、环境、trace_uuid、请求字段脱敏摘要、响应 envelope、health matrix 输出摘要。
  - 如果未跑真实微信工具，把 closure 口径改为 “developer-tool smoke pending”。

### R7. 文档状态、文件命名与执行者口径存在治理漂移

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/action-plan/zero-to-real/ZX1-wechat-ehance.md` 文件名为 `ehance`，不是 `enhance`。
  - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md` 顶部 `文档状态: draft (v2)`，底部和 closure 又写全量落地。
  - 用户描述“GPT 完成 ZX1~ZX2”，但 `ZX2-closure.md` 的执行人字段写 `Opus 4.7`；如果这是历史事实，应保持，但在本次审查链路中需要避免把执行者和 reviewer 角色混淆。
- **为什么重要**：
  - zero-to-real 阶段文档已成为后续计划的基石，文件名、状态、执行者字段会被后续自动检索、handoff 和审查引用。
- **审查判断**：
  - 不是运行时 blocker，但会降低文档系统的可信度。
- **建议修法**：
  - 若不破坏链接，新增正确拼写 alias 或 rename `ZX1-wechat-ehance.md` -> `ZX1-wechat-enhance.md` 并修引用。
  - 将 ZX2 action-plan 顶部状态改为与事实一致的 `executed-local / rollout-pending`，不要保留 `draft`。
  - closure 中明确“实现者 / closure 作者 / reviewer”三种角色。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | ZX1 WeChat 登录 contract 支持 decrypt payload | `done` | `WeChatLoginInputSchema` 已支持 `encrypted_data + iv` 成对输入。 |
| S2 | ZX1 auth worker 支持 `jscode2session + session_key decrypt` | `done` | `wechat.ts` 和 `service.ts` 已实现 exchange/decrypt/openid 对拍。 |
| S3 | ZX1 secret / JWT 配置入口 | `done` | closure 与 docs 写明 `.dev.vars` / `wrangler secret put`；未发现真实 secret 入仓证据。 |
| S4 | ZX1 6-worker health matrix | `done` | `/debug/workers/health` 与 worker_version probe 已实现，orchestrator-core tests 覆盖 6 worker 聚合。 |
| S5 | ZX1 clients/api-docs | `done` | README/auth/wechat-auth/session/worker-health 存在。 |
| S6 | ZX1 manual WeChat/devtools smoke | `partial` | action-plan 要求真实工具 smoke；closure 只给自动化命令。 |
| S7 | ZX2 transport profiles | `partial` | 5 profile 文档存在，但 `session-ws-v1` wire 描述与代码事实冲突。 |
| S8 | ZX2 workers_dev / binding-scope guard | `done` | wrangler audit 与 non-health 401 guard 基本成立；preview curl 尚待部署后验证。 |
| S9 | ZX2 NACP core RPC surface | `done` | `rpc.ts` 与 tests 存在；但 package publish 未完成。 |
| S10 | ZX2 nacp-session 7 message types | `done` | schema / registry 已落。 |
| S11 | ZX2 facade-http-v1 contract | `done` | contract 与 orchestrator wrapping 已落。 |
| S12 | ZX2 agent-core 7 action RPC shadow / parity | `partial` | RPC methods 和 shadow parity 存在；HTTP fallback 仍是真路径组成，7 天 parity 与删除路径未完成。 |
| S13 | ZX2 bash-core WorkerEntrypoint + authority | `done` | `BashCoreEntrypoint.call/cancel` 与 `RpcMetaSchema` 校验存在。 |
| S14 | ZX2 external session envelope | `partial` | HTTP wrapping 存在；DO 内部旧形状仍通过 idempotent wrapper 兼容。 |
| S15 | ZX2 WS frame 对齐 NACP | `partial` | compat lift helper 存在；wire 未切 NACP frame。 |
| S16 | ZX2 5 facade 必需 HTTP endpoints | `partial` | routes 存在，但 usage/permission/me-sessions 多为占位或未完成语义。 |
| S17 | ZX2 web / mini-program client sync | `partial` | 方法存在；e2e 没覆盖完整真实路径，web 仍保留 caller-supplied sessionUuid method。 |
| S18 | ZX2 live preview e2e / 7 天 parity | `missing` | live e2e 默认 skip；closure 明确待 deploy 后跑。 |
| S19 | ZX2 package publish / dep bump | `missing` | package versions 和 consumer deps 仍是旧版本。 |

### 3.1 对齐结论

- **done**: `10`
- **partial**: `7`
- **missing**: `2`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

当前状态更像：

> `ZX1 支撑包基本成立；ZX2 契约与本地实现大体成立，但最终 transport 收口、WS 真实统一、session identity 语义和 rollout evidence 尚未闭合。`

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | ZX1 不做完整微信手机号 / UnionID 运营体系 | `遵守` | 当前仅补 decrypt-capable login，没有扩展完整账号产品体系。 |
| O2 | ZX1 不开放每个内部 worker public debug 面 | `遵守` | 前端仍通过 orchestrator-core `/debug/workers/health` 聚合。 |
| O3 | ZX2 不新增 `packages/orchestrator-rpc-contract` | `遵守` | 通用协议进入 `nacp-core` / `nacp-session`，未见新大包。 |
| O4 | ZX2 不升级 context-core / filesystem-core 为真 RPC | `遵守` | 两者仍是 library-only / health probe。 |
| O5 | ZX2 不做 product 型 `/messages` / `/files` / `/conversations` / devices revoke | `遵守` | 这些未进入当前实现。 |
| O6 | ZX2 不修改 D1 schema | `遵守但带来语义限制` | `/me/sessions` 未落 pending truth，正是“不动 schema / 不写 D1”带来的收口不足。 |
| O7 | ZX2 不做 gemini-cli 能力面对照 | `遵守` | action-plan 将其列入后续补证。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested — ZX1 可作为 decrypt-capable supporting pack 关闭；ZX2 不能以 ALL-DONE/final 关闭，必须改为 rollout-pending，并修正 WS、permission/usage、/me/sessions 与 publish/parity 口径。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **R1**：重写 `ZX2-closure.md` 的阶段状态，承认 publish / preview / live e2e / parity / P3-05 翻转未完成，不再使用 `ALL-DONE` final 口径。
  2. **R2**：完成 NACP package publish + consumer dep bump，或明确标注本轮只支持 monorepo workspace-local deploy。
  3. **R3**：修正 `session-ws-v1` 文档与 `transport-profiles.md` 的 wire 事实，或真正切换代码到 NACP frame wire。
  4. **R4**：把 permission/usage/WS “接入”降级为 schema/helper ready，或补真实 producer/consumer + e2e。
  5. **R5**：补 `/me/sessions` pending truth / TTL / duplicate start 语义，或收窄 closure 中的 session identity claim。
- **可以后续跟进的 non-blocking follow-up**：
  1. **R6**：补 ZX1 真实微信开发者工具与 health debug 手动 smoke evidence。
  2. **R7**：修正文档状态、文件名 typo 与执行者字段治理漂移。
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码/文档。
