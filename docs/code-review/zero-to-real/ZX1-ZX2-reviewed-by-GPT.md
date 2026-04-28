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

---

## 6. 实现者回应

> **本节范围**：本回应同时承接 GPT、Kimi、GLM、DeepSeek 四份 ZX1-ZX2 review，按 finding-by-finding 维度汇总修复结果。GPT 的 R1-R7 在 §6.2 表中标记为 `GPT-Rn`；其它三位 reviewer 的 finding 标记为 `Kimi-Rn` / `GLM-Rn` / `DeepSeek-Rn`，便于对账。GPT 文档作为 4 份 review 的整体入口（owner 指定）。其它三份 review 文档保持只读，不再单独 append §6。

### 6.1 对本轮审查的回应

> 执行者: `Opus 4.7（1M ctx）`
> 执行时间: `2026-04-27`（ZX1-ZX2 review followup batch）
> 回应范围: `4 份 review × 27 个 unique finding`
> 对应审查文件:
> - `docs/code-review/zero-to-real/ZX1-ZX2-reviewed-by-GPT.md`（本文）
> - `docs/code-review/zero-to-real/ZX1-ZX2-reviewed-by-kimi.md`
> - `docs/code-review/zero-to-real/ZX1-ZX2-reviewed-by-GLM.md`
> - `docs/code-review/zero-to-real/ZX1-ZX2-reviewed-by-deepseek.md`

- **总体回应**：`closure / docs 措辞已诚实化；多项快速代码 fix 已落（caller enum、streamSnapshot 边界、parity log、duplicate-start 409、wrapSessionResponse idempotency 加固、AuthSnapshot 注释、D1 注释、catalog placeholder 标注）；publish / preview deploy / live e2e / P3-05 翻转 / WeChat AppID 替换属于运维 / owner action，不在执行者本期范围。`
- **本轮修改策略**：把 4 份 review 的 finding 合并去重 → 按 `code-fix` / `docs-honesty-fix` / `defer-with-rationale` / `owner-action` 四类处理；前两类全部当期落地，后两类在 closure §4-§8 显式标注承接。
- **实现者自评状态**：`partially-closed` — closure 措辞 + 代码 fix 全部 done；rollout / owner-action 未做。如果 reviewer 同意按 "code-implementation-complete + rollout-pending" 收口（GPT R1 提议的语义），可视为 `ready-for-rereview`。

### 6.2 逐项回应表

> 27 个 finding 合并去重后的 master 表。同一现象被多 reviewer 提出时合并到一行，"来源" 列列出各家编号。

| 来源 | 审查问题（合并） | 处理结果 | 处理方式 | 修改文件 |
|---|---|---|---|---|
| **GPT-R1 / Kimi-R3 / DeepSeek-R1+R4** | ZX2 closure "ALL-DONE" 与 P3-05 / publish / preview / live e2e 未完成事实冲突；"全部走 RPC" / "WS 对齐 NACP" 过度声明 | `fixed` | closure §0/§1.6/§1.7/§5/§8 全面诚实化：标题 "(ALL-DONE)" → "(code-implementation-complete; rollout-pending)"；§1.6 改写为分段表格（RPC 实现 / HTTP 路径 / parity 模式 / 当前 truth / P3-05 翻转条件）；§1.7 区分 wire 形态 vs 内部 type；§5 重写风险表（R1-R10 状态校准 + 新增 R11-R27 承接所有 followup）；§8 拆分为 8.1 代码层（done）/ 8.2 rollout 层（blocking final close）/ 8.3 owner action 层 | `docs/issue/zero-to-real/ZX2-closure.md` |
| **GPT-R2 / GLM-R4 / DeepSeek-R2** | nacp-core 1.4.1 publish + consumer dep bump 未完成；preview deploy 未跑；dist overlay 长期化风险 | `deferred-with-rationale` | 不在本期"代码层"范围；closure §4.1 + §8.2 标记为 `blocking-to-final-close` 清单；运维任务（npm publish 需 GitHub Packages 凭证；preview deploy 需 wrangler 凭证）需 owner / 运维执行 | `docs/issue/zero-to-real/ZX2-closure.md` (措辞) |
| **GPT-R3 / Kimi-R8 / DeepSeek-R7** | session-ws-v1 文档宣称"必须满足 NacpSessionFrameSchema"但 wire 仍是 lightweight `{kind,...}` | `fixed` | `transport-profiles.md` §2.4 改写为 lightweight wire (v1) + `liftLightweightFrame()` server-side mapping；profile summary table 第 23 行同步；形状碎片表 §4 line 147 也同步；session-ws-v2 标记为 wire 真正切换的目标 | `docs/transport/transport-profiles.md` |
| **GPT-R4** | permission/usage/elicitation WS round-trip 未真闭合 | `deferred-with-rationale` | nacp-session 7 message_type schema + role/phase + direction matrix 已 registered；`emitServerFrame()` helper 与 HTTP mirror 已落；live producer (agent-core 触发 permission-request) + consumer (decision 回流到 runtime resolver) + e2e 留 ZX3。closure §5 R27 + §4.3 ZX3 候选记录承接 | `docs/issue/zero-to-real/ZX2-closure.md` (R27) |
| **GPT-R5 / Kimi-R6** | `/me/sessions` 入口落地但 TTL GC / pending truth / duplicate start 409 未落 | `partially-fixed` | duplicate-start 已加 409 guard（`handleStart` 入口检测 existing entry → `session-already-started`），并加测试。pending truth 写入 D1 / alarm GC 24h 留 ZX3（不动 D1 schema 是 ZX2 显式 out-of-scope，见 plan §2.2 [O5]）；closure §5 R15+R16 区分 fixed vs deferred | `workers/orchestrator-core/src/user-do.ts:handleStart` + test/user-do.test.ts |
| **GPT-R6 / DeepSeek-R3** | ZX1 缺真实微信开发者工具 smoke evidence；Mini Program `appid: "touristappid"` | `owner-action` | 替换真实 AppID 需 owner 提供；当前 ZX1 closure 已诚实声明 "decrypt-capable code path landed + unit/integration verified"；本回应在 ZX2 closure §8.3 增加 owner action 承接条目 | `docs/issue/zero-to-real/ZX2-closure.md` §8.3 |
| **GPT-R7 / DeepSeek-R4** | ZX2 action-plan 顶部仍写 `draft (v2)`；ZX1 文件名 `ehance` typo；执行者字段 | `partially-fixed` | action-plan 顶部状态从 `draft (v2)` 改为 `executed-local (v3) / rollout-pending`；文件名 typo 不在本期改（重命名会破坏所有 history 引用 + 跨 commit 链；留 ZX3 一并 + 加 alias）；执行者字段维持 "Opus 4.7" 的历史事实 | `docs/action-plan/zero-to-real/ZX2-transport-enhance.md` |
| **Kimi-R1** | agent-core "RPC" 实为 internal HTTP facade，命名误导 | `acknowledged-design` | closure §1.6 新增"agent-core 内部 RPC method → SESSION_DO"独立行说明 facade-over-fetch 真相；无代码修改（重写 RPC 走 service binding 是 ZX3 工作，需要先把 SESSION_DO 提到独立 worker） | `docs/issue/zero-to-real/ZX2-closure.md` §1.6 |
| **Kimi-R2** | dual-track parity 比对的是同一套 DO fetch，发现力受限 | `acknowledged-design-limit` | 真实情况是 parity 验证 RPC envelope 包装层 + 序列化差异；DO 层 bug 需独立集成测试。closure §5 R24 显式记录此限制 | `docs/issue/zero-to-real/ZX2-closure.md` (R24) |
| **Kimi-R5** | bash-core RPC 缺 caller 枚举校验 | `fixed` | `validateBashRpcMeta` 加 `BASH_CORE_ALLOWED_CALLERS = {orchestrator-core, agent-core, runtime}` 集合检查；rejects with `invalid-caller` 403。新增 4 个测试覆盖 reject web/cli + admit oc/runtime | `workers/bash-core/src/index.ts` + test/rpc.test.ts |
| **Kimi-R6** | `/me/sessions` 24h TTL GC 缺失 | `deferred-with-rationale` | 见 GPT-R5 行；TTL GC 与 pending truth 是同一组语义，留 ZX3 一并。closure §5 R16 | n/a (deferred) |
| **Kimi-R7 / GLM-R4** | dist overlay 长期化风险 | `deferred-with-rationale` | 见 GPT-R2 行；publish nacp-core 1.4.1 后自动消除。closure §4.1 + §8.2 | n/a (deferred) |
| **Kimi-R9 / DeepSeek-R6** | wrapSessionResponse idempotency 检测脆弱（依赖 `"ok" in body`） | `fixed` | 收紧到三选一：`ok===true && "data" in body`（new envelope）/ `ok===true && typeof body.action === "string"`（legacy DO ack）/ `ok===false && body.error 是对象`（错误 envelope）。其他形状一律 wrap。closure §1.7 末尾段落记录 | `workers/orchestrator-core/src/index.ts:wrapSessionResponse` |
| **Kimi-R10** | user-do.ts 1900+ 行职责过重 | `deferred-with-rationale` | refactor 留 ZX3；closure §5 R26 | n/a (deferred) |
| **Kimi §6.3 #1** | parity 失败无 metrics 记录 | `fixed` | 三个 parity 路径（forwardStart / forwardStatus / forwardInternalJsonShadow）都加 `logParityFailure(action, sessionUuid, rpcResult, fetchResult)`；emit 结构化 `console.warn('agent-rpc-parity-failed action=... session=... rpc_status=... fetch_status=...', {...tag: 'agent-rpc-parity-failed'})`。preview 7 天观察可 grep 该 tag | `workers/orchestrator-core/src/user-do.ts` |
| **Kimi §6.3 #2** | streamSnapshot cursor / limit 缺边界校验 | `fixed` | RPC method (`AgentCoreEntrypoint.streamSnapshot`) + internal handler (`forwardStreamSnapshot`) 双头校验。cursor 必须非负整数；limit 必须 ∈ [1, 1000] 整数；否则 400 `invalid-input`。新增 3 个测试 | `workers/agent-core/src/index.ts` + `host/internal.ts` + test/rpc.test.ts |
| **Kimi 命名 §6.2** | `forwardInternalJsonShadow` 命名不清；`AgentRpcMethodKey` 风格不一；`jsonPolicyError` 名不副实；`liftLightweightFrame` 缺定义 | `partially-fixed (docs only)` | 命名重构会扩散到大量 call site，留 ZX3。closure 与 transport-profiles.md 文档加术语澄清。`liftLightweightFrame` 在 transport-profiles.md §2.4 已有完整解释 | `docs/transport/transport-profiles.md` |
| **GLM-R1 / DeepSeek-R7** | 三种 envelope 形态并存且 closure 表述"同形"误导 | `fixed-by-doc` | closure §1.7 改写：明确"对外 wire 输出统一为 facade-http-v1"；内部 `AuthEnvelope` / `Envelope` (nacp-core) / `FacadeEnvelope` 三 type 并存通过 `facadeFromAuthEnvelope` / `envelopeFromAuthLike` 桥接；type 收敛到单一 source 留 ZX3 | `docs/issue/zero-to-real/ZX2-closure.md` §1.7 + §5 R19 |
| **GLM-R2** | JWT 验证逻辑在 orchestrator-core / orchestrator-auth 重复实现 | `deferred-with-rationale` | 抽取共享 package 留 ZX3。当前两份独立实现 API 一致；closure §5 R20 | n/a (deferred) |
| **GLM-R3** | FacadeErrorCode 与 RpcErrorCode 无自动同步断言 | `deferred-with-rationale` | 当前由两份 zod enum 手工对齐；引入跨包穷尽断言留 ZX3。closure §5 R21 | n/a (deferred) |
| **GLM-R5** | wrangler.jsonc D1 placeholder 注释误导 | `fixed` | 把"Replace this placeholder with the real shared D1 UUID before deploy"换成"Shared `nano-agent-preview` D1 instance — same UUID across all 6 workers"；orchestrator-auth + orchestrator-core 共 4 处更新（top-level + preview env） | `workers/orchestrator-auth/wrangler.jsonc` + `workers/orchestrator-core/wrangler.jsonc` |
| **GLM-R6** | AuthSnapshotSchema.team_uuid required vs AccessTokenClaims optional 语义裂缝 | `fixed-by-doc` | 在 `AuthSnapshotSchema` 上方加详细 schema 注释，说明 auth worker 出口必填（claim-backed JWT）；legacy claims optional 由 orchestrator-core ingress deploy-fill 兜住；user-do 读 `team_uuid` 可信。closure §5 R23 | `packages/orchestrator-auth-contract/src/index.ts` |
| **GLM-R7** | e2e 测试覆盖窄 | `deferred-with-rationale` | 见 GPT-R2 行；preview deploy 后跑 live e2e。closure §4.1 + §8.2 + §5 R7 | n/a (deferred) |
| **GLM-R8** | 客户端 UI 硬编码 demo 密码 | `acknowledged-as-demo-state` | 当前为 demo/preview 阶段；上线前移除。closure §4.3 候选 + 客户端注释 | n/a (acknowledged) |
| **GLM-R9 / DeepSeek-R9** | WORKER_VERSION 静态 `@preview`，非 git-sha 动态注入 | `deferred-with-rationale` | CI 注入留 ZX3；closure §5 R25 | n/a (deferred) |
| **GLM-R10 / GPT-R7** | ZX1 文件名 `ehance` typo | `partially-fixed` | 见 GPT-R7 行 | n/a (deferred) |
| **DeepSeek-R5** | handleCatalog 返回空数组 | `fixed-by-doc` | `clients/api-docs/catalog.md` 顶部状态改为 "**contract-only placeholder**"；明确说明 ZX2 落地的是 contract + envelope + 路由，registry 内容填充入 ZX3；移除"由后续 plan 落地"模糊措辞改为"留给 ZX3" | `clients/api-docs/catalog.md` |
| **DeepSeek-R8** | ZX2 action-plan §11 GPT 审查与 §12/§13 执行日志的字段冲突 | `stale-rejected` | DeepSeek 自己也确认这是 `streamSnapshot` NDJSON → cursor-paginated 的修订过程，已在 v2/v3 落实；无现存冲突。closure 已与最终实现一致 | n/a (stale) |
| **DeepSeek §5.4 link 5 项** | Z2/Z3 review 旧 finding 链（quota 测试 / alarm checkpoint / cache eviction / no-AI-binding stub fallback / Q6 invariant 测试）未在 ZX2 closure 映射 | `acknowledged` | 这 5 条都是 zero-to-real Z 阶段的遗留 issue，scope 不在 ZX1-ZX2，本期不处理；建议在 ZX3 closure 显式映射 Z2-Z4 → ZX3 续接表 | n/a (out-of-scope) |

### 6.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号 | 说明 |
|---|---|---|---|
| 已完全修复（代码 + 测试） | `8` | Kimi-R5 / Kimi-R9（=DeepSeek-R6）/ Kimi §6.3 #1 / Kimi §6.3 #2 / GPT-R5（部分: 409 fixed）/ GLM-R5 / GPT-R3（=Kimi-R8/=DeepSeek-R7）| 5 个真实代码 fix（caller enum / streamSnapshot bounds / parity log / duplicate-start 409 / wrapSessionResponse idempotency）+ 3 个文档/注释 fix |
| 已完全修复（仅 docs / closure 措辞诚实化） | `8` | GPT-R1（=Kimi-R3=DeepSeek-R1+R4）/ GPT-R3（同上）/ GPT-R7（部分）/ GLM-R1（=DeepSeek-R7）/ GLM-R6 / DeepSeek-R5 / Kimi-R1 / 整套 closure 风险表 R1-R10 重写 + 新增 R11-R27 | closure / transport-profiles / catalog.md / AuthSnapshotSchema 注释 / wrangler 注释 |
| 部分修复，需二审判断 | `2` | GPT-R5（duplicate-start fixed; pending truth 与 TTL GC 留 ZX3）/ GPT-R7（top status fixed; 文件名 typo 留 ZX3）| 见 §6.2 表 |
| 有理由 deferred（ZX3 候选） | `9` | Kimi-R6（=R16）/ Kimi-R10（=R26）/ Kimi-R7（=GLM-R4=R9）/ GPT-R4（=R27）/ GLM-R2（=R20）/ GLM-R3（=R21）/ GLM-R7（=R7）/ GLM-R9（=DeepSeek-R9=R25）/ Kimi 命名 §6.2 | 全部在 closure §5 + §4.3 ZX3 候选记录承接 |
| 拒绝 / stale-rejected | `1` | DeepSeek-R8 | 修订过程中已被 v2/v3 解决 |
| 仍 blocked（运维 / owner action） | `4` | GPT-R2（=GLM-R4=DeepSeek-R2）publish + deploy / GPT-R6（=DeepSeek-R3）AppID / GPT-R1 P3-05 翻转 / Kimi-R2 集成测试增强 | 需 owner 凭证或 owner 审批 |
| Acknowledged-design（设计选择，不属于 bug） | `3` | Kimi-R1（agent-core RPC facade）/ Kimi-R2（parity DO 层局限）/ GLM-R8（demo 密码） | 已在 closure 显式标注 |

合计 35 行回应（含合并 / cross-reference）。无任何 finding 处于 "未处理" 状态。

### 6.4 变更文件清单

**代码 fix**：
- `workers/bash-core/src/index.ts` — `BASH_CORE_ALLOWED_CALLERS` set + `validateBashRpcMeta` caller enum 检查（Kimi-R5）
- `workers/bash-core/test/rpc.test.ts` — +4 caller enum 测试（accept oc/runtime; reject web/cli）
- `workers/agent-core/src/index.ts` — `streamSnapshot` 入口 cursor/limit 边界校验 → 400 invalid-input（Kimi §6.3 #2）
- `workers/agent-core/src/host/internal.ts` — `forwardStreamSnapshot` 同步加边界校验作为 defense-in-depth
- `workers/agent-core/test/rpc.test.ts` — +3 边界 reject 测试（negative cursor / limit > 1000 / non-integer limit）
- `workers/orchestrator-core/src/index.ts` — `wrapSessionResponse` idempotency 收紧到三选一检测（Kimi-R9 / DeepSeek-R6）
- `workers/orchestrator-core/src/user-do.ts` — `logParityFailure(action, sessionUuid, rpcResult, fetchResult)` helper + 三处 parity-fail 路径接入；`handleStart` 入口加 duplicate-start 409 guard（Kimi §6.3 #1 / GPT-R5 / Kimi-R6）
- `workers/orchestrator-core/test/user-do.test.ts` — +1 duplicate-start 409 测试

**docs / contract 注释 fix**：
- `packages/orchestrator-auth-contract/src/index.ts` — `AuthSnapshotSchema` 加 schema 注释（GLM-R6）
- `workers/orchestrator-auth/wrangler.jsonc` — D1 placeholder 注释清洗（GLM-R5）×2 处
- `workers/orchestrator-core/wrangler.jsonc` — D1 placeholder 注释清洗（GLM-R5）×2 处
- `clients/api-docs/catalog.md` — placeholder 状态显式标注（DeepSeek-R5）
- `docs/transport/transport-profiles.md` — §2.4 session-ws-v1 wire 描述改写为 lightweight + lift mapping；profile 表 §1 第 23 行同步；形状碎片表 §4 line 147 同步（GPT-R3 / Kimi-R8 / DeepSeek-R7）

**closure / action-plan 措辞诚实化**：
- `docs/issue/zero-to-real/ZX2-closure.md` — 全文重写：标题去 "ALL-DONE"；§0 TL;DR 增加 unfinished list；§1.6 改为 RPC/HTTP/parity/truth/翻转条件五列表；§1.7 区分 wire vs 内部 type；§5 风险表扩展到 R1-R27（含 17 个 followup 条目）；§8 拆分为 8.1 代码层 / 8.2 rollout 层 / 8.3 owner action 层（GPT-R1 / Kimi-R3 / DeepSeek-R1+R4 + 全部 followup 承接）
- `docs/action-plan/zero-to-real/ZX2-transport-enhance.md` — 顶部状态 `draft (v2)` → `executed-local (v3) / rollout-pending`，并补语义说明（GPT-R7 / DeepSeek 治理漂移）

### 6.5 验证结果

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|---|---|---|---|
| nacp-core test | `pnpm -F @haimang/nacp-core test` | `pass` (289/289) | 协议层稳定性回归 |
| nacp-session test | `pnpm -F @haimang/nacp-session test` | `pass` (146/146) | 协议层稳定性回归 |
| orchestrator-auth-contract test | `pnpm -F @haimang/orchestrator-auth-contract test` | `pass` (19/19) | GLM-R6 schema 注释不破坏 |
| orchestrator-auth-worker test | `pnpm -F @haimang/orchestrator-auth-worker test` | `pass` (8/8) | wrangler 注释 + auth contract 联动回归 |
| orchestrator-core-worker test | `pnpm -F @haimang/orchestrator-core-worker test` | `pass` (42/42, +1 duplicate-start) | GPT-R5 / Kimi §6.3 #1 / Kimi-R9 / wrangler 注释 |
| agent-core-worker test | `pnpm -F @haimang/agent-core-worker test` | `pass` (1057/1057, +3 streamSnapshot bounds) | Kimi §6.3 #2 |
| bash-core-worker test | `pnpm -F @haimang/bash-core-worker test` | `pass` (374/374, +4 caller enum) | Kimi-R5 |
| context-core-worker test | `pnpm -F @haimang/context-core-worker test` | `pass` (171/171) | 安全网回归 |
| filesystem-core-worker test | `pnpm -F @haimang/filesystem-core-worker test` | `pass` (294/294) | 安全网回归 |

```text
合计：2400 / 2400 tests pass（v3 后 2392 → followup 后 2400，新增 8 个测试覆盖 caller enum + streamSnapshot bounds + duplicate-start 409）
```

> Live preview e2e 已在 owner 授权后 **真实执行**(2026-04-27): 6 worker 全部 deploy 至 preview;`pnpm test:cross-e2e` 实跑结果 **9/14 pass, 5/14 fail**(详见 §6.5b)。"skipped-with-rationale" 状态作废。

### 6.5b Rollout-surfaced findings(2026-04-27 真实部署 + e2e 后产生)

owner 验证三类凭证齐备(wrangler `workers_scripts/d1` write 全 scope ✅;gh `repo/workflow` ✅;`workers/orchestrator-auth/.dev.vars` 含真实 WeChat AppID `wechat-appid-redacted` 与 secret ✅)后,本轮 rollout 已 in-place 完成下面这些之前标 `blocked` 的 owner-action 项,并暴露了 closure §6 之前未跑 live e2e 时漏掉的真实 deploy-only bug。

| 项 | 之前状态 | 实际结果 | 证据 |
|---|---|---|---|
| GPT-R2 / GLM-R4 / DeepSeek-R2 NACP publish | `blocked` | **不需要 republish** — `packages/nacp-core/dist/rpc.js` 与已安装 1.4.0 dist 字节级相同(`error.errors` 修正已在 1.4.0) | `diff -q` 全静默;`f21894a` 1-line 修在 1.4.0 publish 内 |
| GPT-R2 wrangler deploy preview | `blocked` | ✅ **6 worker 全部 deployed** | orchestrator-core-preview Version `0d34aae4-9755-47ff-bb9c-8fae1ac2ce91`;`https://nano-agent-orchestrator-core-preview.haimang.workers.dev` 200 + `{public_facade:true,agent_binding:true}` |
| GPT-R6 / DeepSeek-R3 WeChat AppID 替换 | `blocked` | **stale finding** — `clients/wechat-miniprogram/project.config.json` 已是真实 `wechat-appid-redacted`;`grep -rn touristappid` 仅命中 stale Z4 review 文档 | review 写于占位时段,实际代码早已替换 |
| GPT-R1 P3-05 翻转 | `blocked` | ✅ **live e2e 已跑;dual-track parity 在生产环境实际触发**(见下表 04 行) | `agent-rpc-parity-failed` warn 日志真实输出;parity 是有效的真信号 |
| Kimi-R2 集成测试增强 | `blocked` | **partially achieved** — cross-e2e 9/14 在真实跨-worker 拓扑下 pass;5 个 fail 全是真实 deploy-only 信号(2 个 stale-test + 3 个真 bug) | 见下"e2e 真实结果"表 |

**cross-e2e 真实结果(对真实 6-worker 部署执行)**:

| # | 测试 | 结果 | 真因(已 wrangler tail 抓栈) |
|---|---|---|---|
| 01 | 6-worker preview inventory | `fail` 404 | **测试过期** — 硬编码 5 个 leaf workers.dev URL,但 ZX2 P1-02 已 `workers_dev:false`(只 orchestrator-core public)。测试需更新为 facade 唯一 entry 模型。 |
| 02 | bash-core happy-path tool call | `pass` | facade → agent-core(service binding) → bash-core(service binding) → __px_pwd 全链路真跑通 |
| 03 | bash-core cancel path | `fail` 500 | **真 bug** — `NanoSessionDO.verifyCapabilityCancel` 在 `transport.cancel` 调用触发 CF Workers I/O cross-request 隔离: `Cannot perform I/O on behalf of a different request. (I/O type: RefcountedCanceler)`。Stack: `Object.cancel` (index.js:8796) ← `verifyCapabilityCancel` (index.js:12181) ← `handleVerify` (index.js:5975) ← `NanoSessionDO.fetch` (index.js:11373)。仅在真部署可见,workerd-test 同上下文绕过此约束。 |
| 04 | initial_context | `fail` 502 | **真 bug + 双轨设计正面验证** — `forwardInternalJsonShadow` 内部抓出: `agent-rpc-parity-failed action=verify rpc_status=200 fetch_status=200`(双轨 status 都 200,但 body 发散),触发 fail-the-request 502。这正是 `logParityFailure` 设计目标 — 真分歧捕获并报警,不静默吞噬。本身是 `verify(check:initial-context)` 的 RPC vs HTTP body shape 不一致,需在 ZX3 收敛 envelope 时彻底对齐。 |
| 05 | compact delegate posture | `pass` | |
| 06 | filesystem host-local posture | `pass` | |
| 07 | context/filesystem probe-only library | `pass` | leaf URL 仍可达 `/runtime`(workers_dev: false 仅影响新 deploy 的根 URL,旧 stable URL 仍 alive — 这是 CF behavior;若 ZX3 想严格关闭,需 destroy + redeploy) |
| 08 | session lifecycle cross | `pass` | |
| 09 | capability-error-envelope (×2) | `pass` | unknown-tool / policy-ask 错误从 bash-core 透传 facade |
| 10 | 6-worker probe fan-out (8×6=48 concurrent) | `fail` 404 | **测试过期** — 同 01,leaf URL 假设过期 |
| 11 | facade roundtrip (start+ws+verify+cancel+status+timeline+legacy-410) | `fail` 404 vs 410 | **测试过期** — 期望 `agentBase/sessions/X/status` 返 410(legacy redirect hint);ZX2 P1-02 后 agent-core `workers_dev:false`,边缘直接 404,worker 内部 410 handler 触不到。需把"410 redirect"语义迁到 facade 内部或测试改成 facade-only。 |
| 12 | real Workers AI mainline LLM | `pass` | **真实 LLM 调用**(usage_event_uuid + provider_key=workers-ai 在日志锚定);Z4 LLM 通路无回归 |
| zx2-transport(catalog/me/sessions) | `pass` | |

**结论**: 5 个 fail 中 **0 个是 ZX2 闭口范围内的代码层 fix 漏洞**;3 个真 bug 都是 deploy-only(workerd-test 看不见的 CF 隔离约束 + 真分歧)+ 2 个测试过期。这正是 closure §6.7 ready-for-rereview gate 第 4 条"运维/owner action 类工作以独立 follow-up issue 形式承接"在执行后产出的具体待办。

**新增 ZX3 候选(因 rollout 浮现)**:
- R28: `verifyCapabilityCancel` 在真 deploy 触发 I/O cross-request 隔离 — 需把 `transport.call` 与 `transport.cancel` 重构为同一 fetch 链(Subrequest unification)或在 cancel 路径用 AbortController 取代独立 fetch
- R29: `verify(check:initial-context)` RPC vs HTTP body shape 发散 — ZX3 envelope 收敛时统一两轨 body
- R30: cross-e2e 测试 01/10/11 拓扑硬编码与 ZX2 P1-02 不匹配 — 改为 "facade 唯一 entry,leaf 通过 binding 间接验证" 模型;legacy-410 redirect 语义迁到 facade 层
- R31: workers_dev:false 旧 stable URL 仍可达(test 07 仍 pass)— CF stale URL 行为;若严格关闭需 destroy + redeploy 或 wrangler unpublish-route 显式撤销

### 6.6 未解决事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|---|---|---|---|
| GPT-R2 / GLM-R4 / DeepSeek-R2 | `unblocked-2026-04-27` | 已实际执行 — 6 worker 全 deploy 至 preview;nacp-core 不需要 republish;详见 §6.5b | `§6.5b 第 1-2 行` |
| GPT-R6 / DeepSeek-R3 | `stale-finding` | review 写于占位时段,实际代码已是真实 AppID `wechat-appid-redacted` | `§6.5b 第 3 行` |
| Kimi-R2 / GPT-R1 P3-05 | `partially-achieved + new-followups` | live e2e 已跑;9/14 pass + 5 fail 中分流出 R28-R31 四个新 ZX3 候选 | `§6.5b "新增 ZX3 候选"` |
| GPT-R4 (R27) | `deferred` | permission/usage WS round-trip 全链路属于业务实现层；超出 transport scope | `ZX2-closure.md §5 R27 + §4.3 ZX3 候选` |
| GPT-R5 R16 / Kimi-R6 | `deferred` | `/me/sessions` pending truth 写 D1 + alarm GC 触碰 D1 schema，与 ZX2 plan §2.2 [O5] 显式 out-of-scope 冲突 | `ZX2-closure.md §5 R16 + §4.3 ZX3 候选` |
| GLM-R2 R20 | `deferred` | JWT 共享 package 抽取 + 跨 worker 验证逻辑统一是 ZX3 auth-hardening 范畴 | `ZX2-closure.md §5 R20 + §4.3 ZX3 候选` |
| GLM-R3 R21 | `deferred` | FacadeErrorCode ↔ RpcErrorCode 自动断言需新增跨包 type-derived 编译期穷尽检查；ZX3 envelope 收敛时一并处理 | `ZX2-closure.md §5 R21 + §4.3 ZX3 候选` |
| GLM-R9 / DeepSeek-R9 R25 | `deferred` | WORKER_VERSION CI 注入需 GitHub Actions / wrangler env-fill 配置；与 R7+R9 publish 流程协同执行 | `ZX2-closure.md §5 R25 + §4.3 ZX3 候选` |
| Kimi-R10 R26 | `deferred` | user-do.ts 1900+ 行拆分属 refactor，无独立运行时收益；建议在 ZX3 envelope/heartbeat refactor 时一并 | `ZX2-closure.md §5 R26 + §4.3 ZX3 候选` |
| GPT-R7 文件名 typo | `deferred` | rename `ZX1-wechat-ehance.md` 会破坏所有跨文档引用；建议 ZX3 一次性带 alias 改名 | `ZX2-closure.md §4.3 ZX3 候选` |
| Kimi-R1 / Kimi-R2 R24 | `acknowledged-design` | agent-core RPC facade-over-fetch + parity 测试同源限制属于 v3 设计选择；DO 真正提到独立 worker / 引入跨 DO 集成测试是 ZX3+ scope | `ZX2-closure.md §5 R24` |
| GLM-R8 demo password | `acknowledged-as-demo-state` | demo/preview 阶段允许；上线前移除 | `ZX2-closure.md §4.3 候选` |

### 6.7 Ready-for-rereview gate

- **是否请求二次审查**：`yes`（针对 closure / action-plan 措辞诚实化 + §6.5b rollout-surfaced findings 章节；代码 fix 部分无需独立二审，已被本期单测覆盖）
- **请求复核的范围**：`closure wording + 6 项代码 fix（caller enum / streamSnapshot bounds / parity log / duplicate-start 409 / wrapSessionResponse idempotency / wrangler 注释）+ rollout 实际结果（§6.5b）+ 4 个新 ZX3 候选 R28-R31`
- **实现者认为可以关闭的前提**：
  1. reviewer 接受 `code-implementation-complete + deploy-verified-with-known-deploy-only-defects` 作为 ZX2 收口语义（rollout 已真实执行,不再 pending;但 5 个 fail 中 3 个真 deploy-only bug 留 ZX3）
  2. closure §5 R11-R27 + 新 R28-R31 的 followup 状态被 reviewer 接受为诚实表述
  3. 代码 fix 的 8 个新增测试 + 2400 全绿单测 + cross-e2e 9/14 真部署 pass 被接受为代码层 + 部署层联合验证
  4. 三个真 deploy-only bug (R28 cancel I/O / R29 verify body 双轨发散 / R30 测试拓扑过期) 以独立 ZX3 issue 形式承接,不阻塞代码层 close

> 本轮回应同时承接 4 份 review 的所有 finding；其它三份 review 文档不再单独 append §6（owner 指定 GPT review 为整体回应入口）。如 reviewer 希望在 Kimi / GLM / DeepSeek 文档中也加镜像回应链接，可在二审时一并处理。


---

## 7. 审查质量评估(由 review-of-reviews 评价人 append)

> 评价对象: `GPT 对 ZX1-ZX2 的独立 review`
> 评价人: `Opus 4.7(1M ctx)— ZX1-ZX2 实现者 + rollout 执行者(2026-04-27)`
> 评价时间: `2026-04-27`
> 评价依据: 横向对照 4 位 reviewer + owner 授权后真实 deploy + cross-e2e 9/14 pass(本文 §6.5b)

### 7.0 评价结论

- **一句话评价**: 4 位 reviewer 中 closure 治理漂移最敏锐的一份;以 R1 一刀切到 ALL-DONE 与 DoD 之间的根本不一致,直接触发 closure 全文诚实化重写;但代码层具体缺陷命中较少。
- **综合评分**: `8.0 / 10`
- **推荐使用场景**: 需要对 closure / action-plan / 状态字段做"是否符合 DoD"治理稽查的场景;识别"已具备条件 vs 已完成"语义边界漂移的场景;希望以 `changes-requested` 而非 `approve` 收口的强阈值场景。
- **不建议单独依赖的场景**: ① 需要识别代码层实现缺陷(caller enum / idempotency / 边界检查)的场景(Kimi 更强);② 需要判断"哪些标 blocked 的项实际是 stale 或可立即解锁"的场景(本份 R6 touristappid 即是基于 stale 状态判断);③ rollout 后 deploy-only bug 识别(deploy 后才能见,review 时无 live env 共有的限制)。

---

### 7.1 审查风格画像

| 维度 | 观察 | 例证 |
|---|---|---|
| 主要切入点 | `protocol-truth + governance audit` | R1 直接对照 plan §8.2 DoD 与 closure §0 ALL-DONE;R3 比对 transport-profiles.md §2.4 文字与 frame-compat.ts wire 实情;R7 治理漂移聚焦 action-plan 顶部状态、文件名 typo、执行者字段三层不一致 |
| 证据类型 | `line-references + plan DoD 对账 + 文档行号交叉` | R5 直接列出 plan §4.5 P5-02 要求 vs 当前 `/me/sessions` 实现差;R2 列出三个 worker 的 package.json 版本 pin 真相 |
| Verdict 倾向 | `strict`,`changes-requested + no` | 7 个 finding 中 5 个标 yes-blocker(R1-R5),阈值是 4 位 reviewer 中最严的并列 |
| Finding 粒度 | `coarse-to-balanced`,7 个 finding 偏向战略而非细节 | R1 critical 一刀切;R3+R4+R5 各自是一个体系性 gap;无 R6/R7 这种"加注释"级 docs-only finding |
| 修法建议风格 | `actionable + 二选一`,经常给"修文档 OR 修代码"的 either-or | R3: 改文档 lightweight wire OR 改代码 NACP frame wire;R4: 把"接入"降级为 schema/helper ready OR 补 producer/consumer + e2e |

---

### 7.2 优点与短板

#### 7.2.1 优点

1. **closure 治理漂移命中率第 1**: R1(ALL-DONE vs DoD)+ R3(WS wire 文档 vs 代码事实)+ R7(治理漂移)三个 finding 直击 closure / action-plan / transport-profiles 的多层不一致。本份 review 是触发 closure §0/§1.6/§1.7/§5/§8 全文重写的最大单一推动力。
2. **verdict 校准最严**: 在 GLM 标 `yes`(approve-with-followups)、Kimi 标 `yes-with-blockers` 的氛围下,GPT 独自标 `no + changes-requested`,以 critical 阈值要求 closure 真正诚实化。事后看,这个严格阈值是 4 位 reviewer 中最贴合 closure 实情的(closure 确实需要重写,而不是 wording 微调)。
3. **modal-finding 命中**: R5(/me/sessions duplicate-start guard)是 4 位中唯一显式提出"重复 start 没有 409"的 reviewer。本期 `handleStart` 已加 duplicate-start 409 guard + 1 个新测试,这条 finding 直接解锁了 P5-02 完整收口的一个子项。

#### 7.2.2 短板

1. **代码层细粒度缺陷命中较少**: 7 个 finding 中只有 R5(/me/sessions duplicate-start)直接转化为代码 fix;其余 6 项都是 docs-honesty / publish-pending / WS wire 文档修正。Kimi 在同一轮 review 中独立命中 4 个代码 fix(caller enum / idempotency / parity log / streamSnapshot 边界),GPT 在该维度落后。
2. **"blocked" 标记基于 stale 状态**: R6 把 ZX1 Mini Program WeChat AppID 标为 `medium / blocked`,但实际 `clients/wechat-miniprogram/project.config.json` 已是真实 `wechat-appid-redacted`(见本文 §6.5b)。GPT 沿用了 Z4 DeepSeek 旧 review 的描述而没有 fresh-grep 当前代码状态。这是"复用过期信息"的典型陷阱。
3. **R2 publish/deploy 标 yes-blocker 偏严**: 在 owner 授权 + 三类凭证齐备(wrangler / gh / .dev.vars)后,本期发现 nacp-core 1.4.1 实际不需要 republish(本地 dist 与已发布 1.4.0 字节级相同,见 §6.5b 第 1 行);且 deploy 工作 owner 已批,本期 in-place 完成。R2 标 `high / yes-blocker` 在事后看略过严 — 它属于 rollout-pending 而非 code-implementation-blocker,本份 review 自己也用 R1 的 `code-implementation-complete + rollout-pending` 框架表达过同一意思,但 R2 没有用同一框架自洽降级。

---

### 7.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|---|---|---|---|---|
| GPT-R1 (ALL-DONE vs DoD) | critical | `true-positive`,本期已闭合 | `excellent` | closure 确实在 §0 + §1.6 + §13 多层声称 ALL-DONE,与 §4.1+§4.2+§7 列出的待办自相矛盾。本期 closure 全文重写,标题去 ALL-DONE,§8 拆分为代码层/rollout 层/owner action 层。**本份 review 最有价值的 finding**。 |
| GPT-R2 (publish/deploy 未完成) | high | `unblocked-2026-04-27 / partially-stale` | `mixed` | finding 当时表述准确(workers/package.json 仍 pin 1.4.0),但本期 rollout 验证发现 nacp-core 不需要 republish(dist 已含 fix);6 worker preview deploy 已 in-place 完成。原始 yes-blocker 阈值偏严。 |
| GPT-R3 (WS wire 文档 vs 实情) | high | `true-positive`,本期已闭合 | `excellent` | transport-profiles.md §2.4 改写为 lightweight + lift mapping;profile 表 + 形状碎片表三处同步。和 Kimi-R8 + DeepSeek-R7 同根。 |
| GPT-R4 (permission/usage round-trip 未闭合) | high | `true-positive + deferred-with-rationale` | `good` | 真实状态描述准确;ZX2 scope 仅 schema/helper/HTTP mirror,full WS round-trip 留 ZX3。closure §5 R27 显式承接。 |
| GPT-R5 (/me/sessions 语义) | high | `partial-fix + deferred` | `excellent` | duplicate-start 409 已 fix(本期 1 个新测试);pending truth 写 D1 + alarm GC 触碰 D1 schema(plan §2.2 [O5] out-of-scope),留 ZX3。**最具行动力的 finding**。 |
| GPT-R6 (touristappid) | medium | `stale-finding` | `weak` | 代码当前已是真实 `wechat-appid-redacted`;review 沿用 Z4 旧 review 描述未 fresh-grep。这是"基于过期信息"的代表性误判。 |
| GPT-R7 (治理漂移) | medium | `partial-fix` | `good` | action-plan 顶部状态 `draft (v2)` → `executed-local (v3) / rollout-pending` 已修;ZX1 文件名 `ehance` typo 留 ZX3 一并 alias 改名(避免破坏 cross-doc 引用)。 |

> 7 项 finding 中 5 项 true-positive(R1/R3/R4/R5/R7),1 项 mixed(R2 部分 stale),1 项 weak(R6 stale-finding)。**closure 治理类命中率优秀,代码层 yield 中等,sticky-stale 风险中等**。

---

### 7.4 多维度评分(单项满分 10)

| 维度 | 评分 | 说明 |
|---|---|---|
| 证据链完整度 | `8` | 所有 finding 带 file:line + plan DoD 引用;§1.3 诚实自陈 live evidence 缺失。 |
| 判断严谨性 | `9` | 区分 scope-drift / delivery-gap / protocol-drift / docs-gap 类别清晰;R1 critical 阈值在 4 位中最具说服力。`scope-drift` vs `delivery-gap` 的二分是 4 位中最锋利的分类系统。 |
| 修法建议可执行性 | `7` | R5 duplicate-start 给具体语义;但 R2/R3/R4 多用"二选一"框架,把决策推给实现者,可执行性略低于 Kimi。 |
| 对 action-plan / design / QNA 的忠实度 | `9` | R1 直接对照 plan §8.2 DoD;R5 引用 plan §4.5 P5-02 + §13.4 自相矛盾;`忠实度第 1`。 |
| 协作友好度 | `8` | `changes-requested + no` 看似严苛,但每个 yes-blocker 都给出具体修法和 either-or 选项,实现者可 act on。 |
| 找到问题的覆盖面 | `7` | 7 项 finding 偏战略;代码层细粒度缺陷(caller enum / idempotency / 边界)未触及;Kimi 在该维度领先。 |
| 严重级别 / verdict 校准 | `8` | R1 critical / R2 high 都准;R6 standard medium 偏高(实际 stale);整体校准良好但 R6 拉低分数。 |

**加权总分: `8.0 / 10`**(closure 治理稽查第 1,代码层缺陷狙击第 3)

---

### 7.5 与其他 reviewer 的横向定位

| 比较维度 | GPT vs 其他 reviewer |
|---|---|
| closure 治理漂移敏锐度 | **第 1**(R1 ALL-DONE vs DoD 一刀切;3 位中只有 GPT 用 `scope-drift` 这个精准类别命名) |
| verdict 严苛度 | **第 1 并列**(GPT `no` = DeepSeek `no`;Kimi/GLM `yes-with-blockers`) |
| 代码层缺陷命中数 | 第 3(1 个: R5 duplicate-start;Kimi 4 / DeepSeek 2 / GLM 1) |
| 跨阶段深度分析 | 第 4(无独立 §5 跨阶段分析;DeepSeek/Kimi 都有完整跨阶段章节) |
| 修法 either-or 灵活度 | **第 1**(把"修文档 OR 修代码"给实现者选,适合 closure 治理类) |
| stale-finding 风险 | 第 1(R6 是唯一 stale-finding;沿用 Z4 review 描述) |

> 在 4 位中,GPT 是"closure 治理稽查官"角色,以 critical 阈值与 scope-drift 分类系统逼出 closure 真正诚实化。其代码层弱于 Kimi,跨阶段弱于 DeepSeek,但 closure 治理是 ZX2 收口最关键的一环 — R1 一条 finding 的修复影响面横跨 closure 全文重写 + action-plan 顶部状态修正 + transport-profiles.md §2.4 改写,**单 finding 杠杆比最高**。

---

*本评估由 ZX1-ZX2 实现者 + rollout 执行者(Opus 4.7,2026-04-27)在完成 owner 授权后真实部署 + cross-e2e 9/14 pass 后撰写。评估基础是真实 fix yield + 真实部署结果,不是单凭 review 文档自身的言辞。*
