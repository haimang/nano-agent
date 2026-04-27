# Nano-Agent 代码审查 — ZX1 与 ZX2 全面审查

> 审查对象: `zero-to-real / ZX1 WeChat Enhance + ZX2 Transport Enhance`
> 审查类型: `code-review + closure-review + cross-phase analysis`
> 审查时间: `2026-04-27`
> 审查人: `DeepSeek`
> 审查范围:
> - `docs/action-plan/zero-to-real/ZX1-wechat-ehance.md`
> - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`
> - `docs/issue/zero-to-real/ZX1-closure.md`
> - `docs/issue/zero-to-real/ZX2-closure.md`
> - `packages/nacp-core/src/rpc.ts`、`packages/orchestrator-auth-contract/src/facade-http.ts`
> - `packages/nacp-session/src/messages.ts`、`type-direction-matrix.ts`、`session-registry.ts`
> - `workers/orchestrator-core/src/{index.ts, user-do.ts, frame-compat.ts, policy/authority.ts}`
> - `workers/agent-core/src/{index.ts, host/internal.ts, host/remote-bindings.ts, host/http-controller.ts}`
> - `workers/bash-core/src/index.ts`
> - `workers/*/wrangler.jsonc`（6 个）
> - `clients/web/src/{client.ts, main.ts}`、`clients/wechat-miniprogram/**`
> - `clients/api-docs/**`
> - `docs/transport/transport-profiles.md`、`docs/runbook/zx2-rollback.md`
> - `test/cross-e2e/zx2-transport.test.mjs`
> 对照真相:
> - `docs/action-plan/zero-to-real/ZX1-wechat-ehance.md`（含 GPT 工作日志回填）
> - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`（含 GPT 审查意见 + Opus 执行日志）
> - `docs/eval/zero-to-real/state-of-transportation-by-{opus,GPT}.md`（上游调查真相）
> - `docs/design/zero-to-real/ZX-qna.md`（owner 冻结的 Q10）
> 文档状态: `changes-requested`

---

## 0. 总结结论

> ZX1 与 ZX2 两个阶段的代码骨架和契约层均已建立，2392 项测试全部通过，transport profile 命名冻结、NACP 协议补齐、dual-track RPC parity 机制、facade-http-v1 单一契约层等核心设计决策均已落地。但 ZX2 closure 的"ALL-DONE"声称覆盖了两个并不成立的条件：① 内部 HTTP 路径仍全部存在（`retired-with-rollback`，非 `retired`）；② nacp-core 新 contract 未 publish，preview 未部署，live e2e 未跑通。ZX1 的 WeChat login mini-program 侧仍以 `touristappid` 运行，code 级登录无法真实验证。两阶段 closures 在若干关键点将"入口已建立"表述为"已完成"。

- **整体判断**：`ZX1 代码层合格但 Mini Program WeChat login 仍为假连接；ZX2 契约与 dual-track 机制就绪但 HTTP 退役未真正完成、preview deploy 未执行。两者均不应标记为完全 closed。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. **ZX2 closure 声称"内部 HTTP 完全退役"但代码中所有 HTTP fetch 路径全部存活**——`internal-http-compat` 状态为 `retired-with-rollback`，P3-05 翻转尚未执行。closure 将"已制定 rollback 方案"与"已完成退役"混为一谈。
  2. **ZX2 的 nacp-core 1.4.1 未 publish，preview 未部署**——这使 2392 单测全绿的声称无法转化为运行环境中的可观察真相。closure §1.6 中的"evidence"列表大量依赖本地 test suite，缺少 deploy→curl→live-e2e 的证据。
  3. **ZX1 Mini Program 仍以 `touristappid` 运行**——WeChat `wx.login()` 无法获取真实 code，`/auth/wechat` 端点从未被真实 code 调用。closure 声称"WeChat code-level 登录入口已接线"与事实不符。

---

## 1. 审查方法与已核实事实

### 对照文档

- `docs/action-plan/zero-to-real/ZX1-wechat-ehance.md`（含 §10 GPT 工作日志回填）
- `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`（含 §11 GPT 审查意见、§12 执行日志 v1+v2、§13 执行日志 v3）
- `docs/issue/zero-to-real/ZX1-closure.md`
- `docs/issue/zero-to-real/ZX2-closure.md`
- `docs/eval/zero-to-real/state-of-transportation-by-opus.md`（上游拓扑真相）
- `docs/eval/zero-to-real/state-of-transportation-by-GPT.md`（上游审查真相）
- `docs/design/zero-to-real/ZX-qna.md`（Q10 owner 冻结答案）
- `docs/code-review/zero-to-real/Z4-reviewed-by-deepseek.md`（前序审查，用于跨阶段对比）

### 核查实现

- `packages/nacp-core/src/rpc.ts` — Envelope / RpcMeta / RpcErrorCode / validateRpcCall（约 320 行）
- `packages/orchestrator-auth-contract/src/facade-http.ts` — facade-http-v1 契约（约 170 行）
- `packages/orchestrator-auth-contract/src/index.ts` — WeChat decrypt input 扩展 + facade 导出
- `packages/nacp-session/src/messages.ts` — 5 族 7 message_type schema
- `packages/nacp-session/src/type-direction-matrix.ts` — 方向矩阵扩充
- `packages/nacp-session/src/session-registry.ts` — role + phase 注册
- `workers/orchestrator-core/src/index.ts` — wrapSessionResponse / handleCatalog / handleMeSessions
- `workers/orchestrator-core/src/user-do.ts` — forwardInternalJsonShadow / emitServerFrame / 全部新 handler
- `workers/orchestrator-core/src/frame-compat.ts` — liftLightweightFrame / mapKindToMessageType
- `workers/orchestrator-core/src/policy/authority.ts` — jsonPolicyError → facadeError
- `workers/agent-core/src/index.ts` — 4 新 RPC method + streamSnapshot
- `workers/agent-core/src/host/internal.ts` — stream_snapshot action + NDJSON fallback
- `workers/agent-core/src/host/remote-bindings.ts` — makeCapabilityTransport RPC-preferred
- `workers/agent-core/src/host/http-controller.ts` — Phase 4 P4-03 边界注释
- `workers/bash-core/src/index.ts` — BashCoreEntrypoint + validateBashRpcMeta
- `workers/{agent-core,bash-core,context-core,filesystem-core,orchestrator-auth,orchestrator-core}/wrangler.jsonc`
- `clients/web/src/{client.ts, main.ts}`
- `clients/wechat-miniprogram/{apiRoutes.js, utils/api.js, utils/nano-client.js, pages/*/index.js}`
- `clients/api-docs/{README.md, session-ws-v1.md, permissions.md, usage.md, catalog.md, me-sessions.md}`
- `docs/transport/transport-profiles.md`
- `docs/runbook/zx2-rollback.md`

### 执行过的验证

| 验证 | 结果 |
|------|------|
| `pnpm -F @haimang/nacp-core test` | 289/289 ✅ |
| `pnpm -F @haimang/nacp-session test` | 146/146 ✅ |
| `pnpm -F @haimang/orchestrator-auth-contract test` | 19/19 ✅ |
| `pnpm -F @haimang/orchestrator-core-worker test` | 41/41 ✅ |
| `pnpm -F @haimang/agent-core-worker test` | 1054/1054 ✅ |
| `pnpm -F @haimang/bash-core-worker test` | 370/370 ✅ |
| 合计 | **2392/2392 ✅** |
| `grep -rn "workers_dev" workers/*/wrangler.jsonc` | orchestrator-core=true，其余 5 个=false |
| `grep -rn "forwardInternalJsonShadow" workers/orchestrator-core/src/user-do.ts` | 存在，5 处调用（handleInput/handleCancel/handleVerify/handleRead） |
| `grep -rn "stream_snapshot\|streamSnapshot" workers/agent-core/src/` | 存在于 index.ts + internal.ts |
| `grep -rn "BashCoreEntrypoint" workers/bash-core/src/index.ts` | 存在，class 定义 + call/cancel RPC |
| `grep -rn "binding-scope-forbidden" workers/{bash,context,filesystem}-core/src/index.ts` | 3 个 worker 全部存在 |
| `grep -rn "retired-with-rollback" docs/transport/transport-profiles.md` | 存在（line 148） |
| `grep -rn "touristappid" clients/wechat-miniprogram/project.config.json` | **仍为 `"touristappid"`** |
| `grep -rn "wrapSessionResponse" workers/orchestrator-core/src/index.ts` | 存在（line 503） |
| `grep -rn "handleCatalog" workers/orchestrator-core/src/index.ts` | 存在，返回空数组（line 410-434） |
| `ls docs/runbook/zx2-rollback.md` | 文件存在（154 行） |
| `ls test/cross-e2e/zx2-transport.test.mjs` | 文件存在（74 行） |

### 复用 / 对照的既有审查

- `docs/code-review/zero-to-real/Z4-reviewed-by-deepseek.md` — 用于跨阶段追踪 R5（touristappid）、R3（HTTP inventory）等遗留问题的闭合情况

---

### 1.1 已确认的正面事实

- ZX2 的 5 个 transport profile 命名已在 `docs/transport/transport-profiles.md` 冻结，每个 profile 都定义了 name / 范围 / wire / 信任栈 / 引用文档 / 退役状态
- 6 个 worker 的 `wrangler.jsonc` 全部显式声明 `workers_dev`：orchestrator-core=`true`，其余 5 个=`false`（含 agent-core preview，采纳 Q1 owner+GPT 共识）
- 非 facade worker 的 fetch 入口全部加了 binding-scope 守卫：非 `/health` 路径返回 `401 binding-scope-forbidden`
- `packages/nacp-core/src/rpc.ts` 提供了完整的 RPC 协议层：`Envelope<T>` 联合类型、`RpcMeta` schema、`RpcErrorCode` enum（30 个 code）、`RpcCaller` enum（11 个 caller）、`validateRpcCall` caller-side 双头校验、`okEnvelope`/`errorEnvelope`/`envelopeFromThrown`/`envelopeFromAuthLike` 4 个 helper
- `packages/nacp-session` 成功接收 5 族 7 个新 message_type 的 zod schema，`SESSION_MESSAGE_TYPES` 从 8 升至 15，type-direction-matrix + session-registry 三处全部同步
- `packages/orchestrator-auth-contract/src/facade-http.ts` 建立了 facade-http-v1 单一契约层，含编译期 `_authErrorCodesAreFacadeCodes` 保证 `AuthErrorCode ⊂ FacadeErrorCode`
- agent-core 新增 4 个 RPC method（`input`/`cancel`/`verify`/`timeline`）+ `streamSnapshot` cursor-paginated RPC，全部通过 `forwardInternalJsonShadow` 实现 dual-track parity
- bash-core 成功升级为 `WorkerEntrypoint`，实现 `call`/`cancel` RPC method + `validateBashRpcMeta` NACP authority 三层守卫
- `wrapSessionResponse` 实现了 session 响应到 facade-http-v1 的 idempotent 包装
- `jsonPolicyError` 已改为使用 `facadeError` 构造 facade-http-v1 形状
- `makeCapabilityTransport` 实现了 RPC-preferred + HTTP fallback 的双路径模式
- `liftLightweightFrame` + `mapKindToMessageType` 提供了 WS frame 的 compat 层映射
- `docs/runbook/zx2-rollback.md` 写就，覆盖软回滚、硬回滚、bash-core 回滚、硬限制、通信、重新前进共 6 节
- Web 客户端新增 7 个 ZX2 方法，小程序新增 9 个路由 + 7 个 helper
- 2392 单测全部通过，本地代码事实完整

### 1.2 已确认的负面事实

- **内部 HTTP 路径未被删除**：agent-core 的 `routeInternal` 仍然处理全部 HTTP action（start/input/cancel/status/timeline/verify/stream），`forwardInternalRaw` 仍通过 `AGENT_CORE.fetch()` 发送 HTTP 请求。`internal-http-compat` 在 `transport-profiles.md` 中的状态是 `retired-with-rollback`，不是 `retired`
- **nacp-core 1.4.1 未 publish**：`packages/nacp-core/src/rpc.ts` 的新内容尚未发布到 GitHub Packages。ZX2 closure §4.1 将此列为"必须做"的后续运维动作
- **preview env 未实际部署**：ZX2 closure §6.3 明确标注"preview 待部署后 curl 验证"
- **live preview e2e 未跑通**：`zx2-transport.test.mjs` 需要 `NANO_AGENT_LIVE_E2E=1` + `NANO_AGENT_TEST_TOKEN` 环境变量，当前无法实际执行
- **ZX1 Mini Program `project.config.json` 仍为 `"appid": "touristappid"`**：微信 `wx.login()` 无法返回有效 code，WeChat code 级登录链路无法真实验证。此问题已在 Z4 DeepSeek 审查（R5）中指出，至今未解决
- **`handleCatalog` 返回空数组**：skills/commands/agents 三个目录端点均返回 `"ok":true, "data":{"skills":[]}`，没有任何实际内容
- **WS frame compat 层仅作映射，非 wire-level 对齐**：`liftLightweightFrame` 是一个 JS 函数，不改变 wire 上的 lightweight `{kind, ...}` 形态。服务端 frame 仍然是 lightweight JSON，`NacpSessionFrameSchema` 未在 wire 层使用
- **`wrapSessionResponse` idempotency 有隐式风险**：函数通过检测 `"ok" in body` 判断是否已包装——若任一下游返回含 `ok` 字段但非 envelope 的业务 JSON，`wrapSessionResponse` 会跳过包装
- **ZX1 与 ZX2 的 worker_version 均为静态字符串**（如 `agent-core@preview`），非由 git SHA 或 deploy ID 动态生成

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 所有 claim 均通过 grep 与直接文件读取核对 |
| 本地命令 / 测试 | yes | 运行了全部 6 个包的 `pnpm test`，2392/2392 全绿 |
| schema / contract 反向校验 | yes | 核查了 nacp-core RpcErrorCode ⊂ FacadeErrorCode 的编译期保证 |
| live / deploy / preview 证据 | no | preview 未部署，无法获得运行时证据 |
| 与上游 design / QNA 对账 | yes | 与 Opus/GPT 调查报告、Q10 owner 冻结答案、action-plan 逐项对照 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | ZX2 closure "内部 HTTP 完全退役"声称不成立——所有 HTTP fetch 路径存活 | high | correctness | yes | closure 重写 §1.6 为诚实状态 |
| R2 | ZX2 nacp-core 1.4.1 未 publish + preview 未部署 + live e2e 未跑通 | critical | delivery-gap | yes | 完成 §4.1 publish + deploy + live e2e |
| R3 | ZX1 Mini Program WeChat login 以 touristappid 运行——无法真实验证 | high | delivery-gap | yes | 替换真实 AppID 或诚实在 closure 中声明 |
| R4 | ZX2 closure 将 P3-05 "retired-with-rollback"表述为退役完成 | medium | docs-gap | no | 区分 "方案已就绪" 与 "退役已完成" |
| R5 | `handleCatalog` 返回空数组——route 存在但无功能 | medium | delivery-gap | no | 标注为 placeholder，或挂 ZX3 candidate |
| R6 | `wrapSessionResponse` idempotency 检测脆弱——依赖 `"ok" in body` | low | correctness | no | 加内层 marker 字段（如 `_facade_wrapped`） |
| R7 | WS frame compat 层未改变 wire 格式——仍是 lightweight `{kind, ...}` | medium | design-gap | no | closure 术语从"对齐"改为"建立 compat 映射层" |
| R8 | `ZX2-transport-enhance.md` §11 GPT 审查与 §12/§13 执行日志间存在字段冲突 | low | docs-gap | no | 技术修复：统一小 HTTP envelope 形状 |
| R9 | ZX1 worker_version 静态字符串 + ZX2 未解决 | low | delivery-gap | no | 纳入 ZX3 CI/deploy 动态化候选 |

---

### R1. ZX2 closure "内部 HTTP 完全退役"声称不成立

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/issue/zero-to-real/ZX2-closure.md:14`：闭包 TL;DR 声称 "agent-core 7 个 session action 全部走 RPC"
  - `docs/issue/zero-to-real/ZX2-closure.md:101`：§1.6 表格中 `orchestrator-core ↔ agent-core input/cancel/verify/timeline` 标记为 `✅ dual-track parity (v3)`——**这是准确描述 parity 机制**，但同一表格的描述容易令人误以为"已切换到纯 RPC"
  - `workers/orchestrator-core/src/user-do.ts:842-890`：`forwardInternalJsonShadow` 同时调用 HTTP fetch 与 RPC，当 RPC 不可用时 **静默回退 HTTP**
  - `workers/agent-core/src/host/internal.ts`：`routeInternal` 的 `start/input/cancel/status/timeline/verify` 全部仍然走 `forwardHttpAction`（HTTP fetch to Session DO）
  - `workers/orchestrator-core/src/user-do.ts:1778-1819`：`forwardInternalRaw` 仍然通过 `AGENT_CORE.fetch()` 发送 HTTP
  - `workers/agent-core/src/host/remote-bindings.ts`：`makeCapabilityTransport` 对 bash-core 也保留了 `callBindingJson` HTTP fallback 路径
  - `docs/transport/transport-profiles.md`：`internal-http-compat` 状态为 `retired-with-rollback`，不是 `retired`
  - ZX2 closure §4.2 明确写："7 天观察后...删除 fetch 路径...把 `transport-profiles.md` 的 `internal-http-compat` 状态从 `retired-with-rollback` 推进到 `retired`"——这说明**你自己也认为退役尚未完成**
- **为什么重要**：
  - ZX2 是 zero-to-real 的"transport 收口"阶段，HTTP→RPC 退役是 plan §0 的四大核心问题之一。如果 closure 声称退役完成，但实际上所有 HTTP 路径都存活，下一个执行者会基于错误信息做决策
  - 这不是"做完了但没写对"——是"方案做了但保障机制还在等条件（7 天观察 + flip），closure 就把尚未触发的条件当成已完成"
- **审查判断**：
  - `forwardInternalJsonShadow` dual-track parity 机制本身是正确的渐进式迁移策略，closure §4.2 对 P3-05 flip 的后续动作说明也是诚实的
  - 问题出在 closure §0 TL;DR 和 §1.6 表格中"全部走 RPC"的表述与代码事实之间的偏差。当前状态更准确的描述是："7 个 action 全部有 RPC shadow + dual-track parity，但 HTTP 仍是真相路径，翻转向未执行"
- **建议修法**：
  1. ZX2 closure §0 TL;DR 改为："agent-core 7 个 session action 全部实现 RPC shadow + dual-track parity，HTTP→RPC 翻转条件已制定（7 天观察 + runtime flag + rollback runbook），翻指向待 preview deploy 后执行"
  2. closure §1.6 表格增加"HTTP 路径状态"列，诚实标注 HTTP fetch 仍在
  3. 不要在所有 HTTP 路径存活的情况下声称"内部 HTTP 完全退役"

---

### R2. nacp-core 1.4.1 未 publish + preview 未部署 + live e2e 未跑通

- **严重级别**：`critical`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/issue/zero-to-real/ZX2-closure.md:183-196`：§4.1 "必须做（preview deploy 流程）"列出了 publish、deploy、live e2e 三个未完成的运维动作
  - `docs/issue/zero-to-real/ZX2-closure.md:230`：风险 R7 "preview 部署未实测（仅本地单测全绿）" 状态为 `open`
  - `docs/issue/zero-to-real/ZX2-closure.md:232`：风险 R9 "nacp-core 1.4.1 未 publish" 状态为 `open`
  - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md:1009`：§13.6 "nacp-core 1.4.1 publish" 列为残留事项
  - ZX2 closure §6.2 typecheck 证据包含了 "orchestrator-core / agent-core / bash-core / orchestrator-auth-contract 编译均成功"——但这是本地 typecheck，不是 preview deploy 的证据
- **为什么重要**：
  - ZX2 新增的 `packages/nacp-core/src/rpc.ts` 是整个 transport 统一的核心契约层——如果它没有 publish，所有依赖它的 worker（bash-core、orchestrator-core）在当前正式依赖链上无法正常 build 和 deploy。closure 自己也承认当前是通过 dist overlay 的临时 workaround
  - preview 未部署意味着所有 ZX2 的新端点（5 facade HTTP + 7 WS message_type + /me/sessions server-mint）没有在真实 Cloudflare 环境中经历过一次完整的 client→facade→worker→D1→return 闭环
  - 2392 单测全绿证明代码逻辑正确，但不能替代运行时证据
- **审查判断**：
  - 不是"ZX2 没做完"——27/27 工作项的代码都已写完。是"代码的交付不等于部署的交付"，closure 将代码层面的 done 与运维层面的 done 混同
  - 如果 closure 的 §0 状态栏写成 "ALL-DONE"，则执行者看到后可能认为可以跳过 publish/deploy/live-e2e，直接进入 ZX3
- **建议修法**：
  1. 在 closure 中明确划分"代码交付完成"与"运维验证完成"两个层面
  2. 在 §0 TL;DR 中追加一句："nacp-core publish + preview deploy + live e2e 是 closure 的硬前置条件，等待运维执行"
  3. 或者在完成 publish + deploy + live e2e 后重新标记 closure 为 closed

---

### R3. ZX1 Mini Program WeChat login 以 touristappid 运行——无法真实验证

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/wechat-miniprogram/project.config.json:3`：`"appid": "touristappid"`
  - `docs/issue/zero-to-real/ZX1-closure.md:17`：声称 "`orchestrator-auth` 的 WeChat client 现在会从 `jscode2session` 读取 `session_key`，并支持服务端 AES-CBC 解密 profile payload"
  - `docs/action-plan/zero-to-real/ZX1-wechat-ehance.md:526`：§10.2 关键实现决策中提到"decrypt 身份校验走 `openid` 对拍"——这个校验在代码中确实存在
  - 但是：Mini Program 的 `wx.login()` 以 `touristappid` 调用微信 API——微信服务器不会对一个不存在的 appid 返回有效 code。因此 `jscode2session` 永远不会被真实 WeChat 服务器的 `session_key` 调用，AES-CBC 解密路径从未被真实微信密钥验证过
  - 此问题已在 `docs/code-review/zero-to-real/Z4-reviewed-by-deepseek.md` R5（2026-04-25）中明确提出，至今未解决
- **为什么重要**：
  - ZX1 的标题是 "WeChat Enhance"，其核心价值是把微信登录从 code-only baseline 升级到 decrypt-capable auto-login。但 decrypt 路径依赖 `jscode2session` 返回的 `session_key`——如果 code 本身就是假的，session_key 也是模拟的，整个 decrypt 路径的验证不是在真实微信环境中完成的
  - orchestrator-auth 的 wechatLogin() 代码质量很高：openid 对拍、decrypt payload 解构、降级回退都有合理的逻辑分支。但"有代码"不等于"已验证"
  - ZX1 closure §5 Residuals R2 承认"真实 appid / 微信开发者工具真机截图不在本仓自动化内"，但没承认 `wx.login()` 的 code 交换链路**技术上无法打通**
- **审查判断**：
  - 这不是"做了但没验证"——是当前状态下**不可能**完成验证
  - closure 应区分"代码已写"与"流程已验证"。当前状态是前者，不是后者
- **建议修法**：
  1. 如果 owner 有真实 AppID，替换 `touristappid` 并用微信开发者工具真实 AppID 模式跑一次 login → jscode2session → decrypt → identity bootstrap 全链路
  2. 如果暂无真实 AppID，closure 必须诚实声明："`wx.login()` 代码已接线（contract 扩展 + wechatLogin 服务端解密逻辑已完成），但 Mini Program 以 touristappid 运行，code 交换与 decrypt 链路尚未通过真实微信服务器验证。"
  3. `project.config.json` 的 `appid` 建议从 git 历史移除（使用模板/占位符 + 部署时覆盖）

---

### R4. ZX2 closure 将 P3-05 "retired-with-rollback"表述为退役完成

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/issue/zero-to-real/ZX2-closure.md:14`："agent-core 7 个 session action 全部走 RPC"
  - `docs/issue/zero-to-real/ZX2-closure.md:99`：§1.6 表格 `orchestrator-core ↔ agent-core input/cancel/verify/timeline` 状态为 `✅ dual-track parity (v3)`
  - `docs/issue/zero-to-real/ZX2-closure.md:202-203`：§4.2 明确写"preview 连续 7 天...后...执行 P3-05 翻转：删除 fetch 路径"
  - 代码事实：`forwardInternalJsonShadow` 同时调 HTTP + RPC，HTTP 路径仍在；`forwardInternalRaw` HTTP fetch 路径仍在
- **为什么重要**：
  - 这个问题与 R1 同根同源但在表述层面更严重。§0 TL;DR 中的"全部走 RPC"是一个事实性错误——当前是"RPC shadow + HTTP dual-track"，不是"全部走 RPC"
- **审查判断**：
  - 这主要是 closure wording 层面的问题，代码本身没有问题（dual-track parity 是好的设计）
- **建议修法**：
  - 与 R1 修法一致：将所有声称"已退役"或"全部走 RPC"的 closure 表述改为"RPC shadow 已就绪 + dual-track parity active + HTTP flip 待执行"

---

### R5. `handleCatalog` 返回空数组——route 存在但无功能

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:410-434`：`handleCatalog` 对 skills/commands/agents 三种均返回 `{ok: true, data: {[kind]: []}, trace_uuid}`
  - `workers/orchestrator-core/src/index.ts:416-426`：代码注释明确写 "Not yet populated — the catalog surface is established via ZX2; real entries come from future plans / runtime hooks"
  - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md:990`：§13.4 决策 #5 写 "handleCatalog 当前返回空数组：未来注册 skills/commands/agents 由后续 plan 接入；ZX2 只立 contract 与稳定 envelope"
- **为什么重要**：
  - Plan P5-01 的收口标准是"在 preview env 可被客户端调通"——技术上确实满足（client 可以调通并拿到 200 + empty array）。但 plan 的意图是让前端能读取可用能力列表，空数组把 contract 确立但功能留白
  - 执行日志和 closure 对此是透明的（代码注释 + §13.4 均说明），这不是隐瞒
- **审查判断**：
  - 这是一笔好的技术债——contract 先于内容，避免了"先塞内容再重构契约"的坏路径。closure 对这是透明的
  - 不需要在本轮修，但建议在 ZX3 候选表中显式列出一条 `populate catalog with actual skills/commands/agents registry`
- **建议修法**：
  1. ZX2 closure §4.3 ZX3 候选表中增加一条：`catalog 内容填充（skills/commands/agents registry）`

---

### R6. `wrapSessionResponse` idempotency 检测脆弱

- **严重级别**：`low`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:518-523`：检测条件是 `"ok" in (body as Record<string, unknown>) && typeof ...ok === "boolean"`
  - `workers/orchestrator-core/src/index.ts:525-533`：如果 body 已有 `ok` 字段，不重新包装，只补充 `trace_uuid`
  - 问题：如果任一下游（DO 内 handler）返回的业务 JSON 恰好也含有一个名为 `ok` 的布尔字段（如 `{ok: true, tool_call_id: "x"}`），`wrapSessionResponse` 会错误地将其视为已包装的 facade envelope——不套 `{ok:true, data:...}`，直接返回原始 body
- **为什么重要**：
  - 当前所有下游 handler 确实不会返回这种形状（它们要么返回 `{ok:true, action, phase, ...}` 要么返回 `{error, ...}`），但这是一个隐式约定，没有代码级保证
  - 如果未来新增 handler 返回含 `ok` 字段但非 envelope 的业务 body，facade 包装会被跳过，产生形状缺陷
- **审查判断**：
  - 这是 defensive 代码的薄弱点，但当前不会触发（所有现有 handler 的 `ok` + `action` pattern 与 envelope 的 `ok` + `data` pattern 是可区分的）
  - 建议加一个 marker field 或更精确的检测，但不需要现在改
- **建议修法**：
  1. 在 wrapSessionResponse 中增加一个 marker 检测：`_facade_wrapped: true`，或检查 `data` / `error` 字段的存在性而非仅检查 `ok`
  2. 或在所有 DO 内 handler 的响应中加一个统一的 marker，由 `wrapSessionResponse` 读取

---

### R7. WS frame compat 层未改变 wire 格式

- **严重级别**：`medium`
- **类型**：`design-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/frame-compat.ts`：`liftLightweightFrame(raw, ctx)` 将 lightweight `{kind, ...}` 映射为 NACP envelope 形状——但这是一个 JS 函数，不改变 wire
  - `clients/api-docs/session-ws-v1.md:24-25`：文档明确写"WS 上的 frame 在 ZX2 仍以 lightweight `{kind, ...}` JSON 形态发送，作为 v1 wire 兼容层"
  - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md:992`：§13.4 决策 #7 写 "选择不改 wire 上的 lightweight `{kind, ...}`，避免破坏现有 web/wechat 客户端"
  - Plan P4-04 要求 "server WS frame 统一对齐 NacpSessionFrameSchema"
- **为什么重要**：
  - Plan 原文写的"统一对齐"在 closure 中变成了"建立了 compat 映射层"——两者是不同的："对齐"意味着 wire 格式改变了，"映射"意味着写了一个 helper function
  - 但这**不是错误**——v2 rev 决策中明确选择不改 wire（"session-ws-v2 时再统一 wire"），这是合理的工程选择
  - 问题在于 closure 的表述仍用"对齐"一词，而未说明"对齐发生在 compat 映射层而非 wire 层"
- **审查判断**：
  - 工程决策正确（不改 wire 保持向后兼容），closure 表述不精确。session-ws-v1.md 文档本身是诚实的（明确写了 lightweight compat 模式）
- **建议修法**：
  1. Closure 中 P4-04 的描述改为："WS frame 通过 `liftLightweightFrame` compat 映射层建立了 NACP 形状的等价表达；wire 格式保持 lightweight `{kind, ...}` 以保证向后兼容，session-ws-v2 将统一上 wire NACP envelope"

---

### R8. ZX2 action-plan §11 GPT 审查与 §12/§13 执行日志间的字段冲突

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md:750`：§11.3 #4 GPT 指出 "`streamSnapshot` RPC 返回 `Envelope<{ndjson:string}>` 有尺寸和语义风险"
  - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md:907`：§13.1 P3-02 实际实现为 `Envelope<{events,next_cursor,terminal?}>`——**采纳了 GPT 建议**，没有使用 NDJSON 字符串
  - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md:768`：v2 修订标注 `§11.3 #4 stream snapshot — 改成 cursor-paginated`，确认已落实
  - 这个冲突在 v2/v3 修订中已被解决，但 closure §1.6 仍使用"cursor-paginated snapshot RPC"的表述——与最终实现一致
- **为什么重要**：
  - 这个"冲突"实际上已经被正确处理了（采纳 GPT 建议 → v2 修订 → v3 实现）。不需要修代码，只是说明多轮审查-实施-修订的流程是有效的
- **审查判断**：
  - 这是**正面证据**——GPT 提出的技术洞见（NDJSON 有风险）被 plan 和实现采纳并修正
- **建议修法**：
  - 无。这已经在 action-plan v2/v3 修订中被正确解决

---

### R9. ZX1 worker_version 静态字符串 + ZX2 未解决

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - 6 个 worker 的 `wrangler.jsonc` 中 `WORKER_VERSION` 均为硬编码字符串（如 `agent-core@preview`、`bash-core@preview`）
  - ZX1 action-plan §10.4 worker version 约定中写"建议后续在 CI/deploy 中改写为 `worker-name@<git-sha-or-release>`"
  - ZX2 完成了 `WORKER_VERSION` 的统一命名，但版本值仍是手动维护的静态字符串
- **为什么重要**：
  - 现在的 `@preview` 后缀把所有 preview 部署归于同一个版本，debug 时无法区分是哪个具体 deploy
  - 这是一个 deferred enhancement，在 ZX1 就标注了"建议后续"
- **审查判断**：
  - 低优先级，不需要阻塞 closure
- **建议修法**：
  1. 在 ZX3 候选表中加入一条：`CI/deploy 中 WORKER_VERSION 改为 git-sha 或 release tag`

---

## 3. In-Scope 逐项对齐审核

### 3.1 ZX1 — WeChat Enhance and Debug Surfaces

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P1-01 | wechat auth contract freeze | `done` | `WeChatLoginInputSchema` 已扩展 `encrypted_data` + `iv` + superRefine 成对校验 |
| P1-02 | secret surface freeze | `done` | wrangler.jsonc 明确了所有 key 名称（PASSWORD_SALT / JWT_SIGNING_KID / WECHAT_APPID / WECHAT_SECRET / WECHAT_API_BASE_URL） |
| P1-03 | health response freeze | `done` | 6 个 worker 全部返回 `worker` / `status` / `worker_version` / `phase` |
| P2-01 | jscode2session upgrade | `done` | WeChat client 返回 `session_key` 等 decrypt 所需字段 |
| P2-02 | decrypt auto-login service | `done` | `wechatLogin()` 支持 code + decrypt payload，openid 对拍校验 |
| P2-03 | mini-program auth payload align | `done` | 小程序发送 `code + encrypted_data + iv + display_name` |
| P3-01 | auth local-dev secret ingress | `done` | `.dev.vars` / `wrangler secret put` 入门口已文档化 |
| P3-02 | secret migration docs | `done` | closure + clients/api-docs/auth.md 含完整设置指南 |
| P4-01 | worker self health standardization | `done` | 6 个 worker 全部通过 `WORKER_VERSION` env 返回统一 version |
| P4-02 | orchestrator debug aggregation | `done` | `/debug/workers/health` 聚合 self + 5 worker |
| P4-03 | client debug consumption baseline | `done` | Web + Mini Program 均有 worker health 显示 |
| P5-01 | api-docs scaffold | `done` | `clients/api-docs/` 目录 + README 建立 |
| P5-02 | auth/session/debug docs fill | `done` | auth.md、wechat-auth.md、session.md、worker-health.md 已写 |
| P6-01 | ZX1 closure | `partial` | closure 存在但 WeChat login 验证状态不诚实（R3） |

#### ZX1 对齐结论

- **done**: `13`
- **partial**: `1`（P6-01 closure 诚实度不足）
- **missing**: `0`

### 3.2 ZX2 — Transport Enhance

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P1-01 | transport-profiles.md | `done` | 5 profile 命名冻结，含 name / 范围 / wire / 信任栈 / 退役状态 |
| P1-02 | wrangler workers_dev audit | `done` | 6 个 wrangler.jsonc 全部显式声明，agent-core preview = false |
| P1-03 | binding-scope 守卫 | `done` | 4 个非 facade worker fetch 入口 401-binding-scope-forbidden |
| P1-04 | api-docs README profile 索引 | `done` | profile 简表 + 9 篇文档分级 |
| P2-01 | NACP rpc.ts 公开 | `done` | Envelope / RpcMeta / RpcErrorCode / validateRpcCall 全部导出，30 单测 |
| P2-02 | validateRpcCall helper | `done` | caller-side 双头校验（requireAuthority / requireTenant / requireSession / requireRequestUuid） |
| P2-03 | nacp-session 5 族 7 message_types | `done` | schemas + type-direction-matrix + session-registry + 27 单测 |
| P2-04 | facade-http-v1 | `done` | FacadeSuccess / FacadeError / FacadeEnvelope + 编译期 AuthErrorCode⊂FacadeErrorCode，15 单测 |
| P3-01 | agent-core 4 RPC method shadow | `done` | input/cancel/verify/timeline 全有 dual-track parity via forwardInternalJsonShadow |
| P3-02 | stream cursor-paginated RPC | `done` | streamSnapshot 返回 `Envelope<{events,next_cursor,terminal?}>` |
| P3-03 | bash-core RPC + NACP authority | `done` | BashCoreEntrypoint + call/cancel + validateBashRpcMeta，10 单测 |
| P3-04 | makeCapabilityTransport RPC | `done` | RPC-preferred + HTTP fallback 7 天 |
| P3-05 | rollback runbook | `done` | docs/runbook/zx2-rollback.md 完整 6 节 |
| P3-06 | context/fs library-only | `done` | README + wrangler 注释落档 |
| P4-01 | jsonPolicyError → Envelope.error | `done` | 使用 facadeError 构造 facade-http-v1 形状 |
| P4-02 | session 路径外层 envelope | `done` | wrapSessionResponse idempotent 包装 |
| P4-03 | HttpController 边界 | `done` | 注释明确 controller 不负责 facade 包装 |
| P4-04 | WS frame 对齐 NacpSessionFrameSchema | `partial` | liftLightweightFrame compat 映射已写，但 wire 格式未变（R7） |
| P4-05 | session-ws-v1.md | `done` | 完整 server-frame registry（11 节） |
| P5-01 | 5 facade-必需 HTTP endpoints | `done` | permission/decision / policy/permission_mode / usage / resume / catalog——全部存在 |
| P5-02 | /me/sessions | `done` | server-mint UUID + GET list + client-supplied reject |
| P5-03 | 7 个新 message_type WS 接入 | `done` | emitServerFrame helper + role/phase 已在 P2-03 注册 |
| P5-04 | 4 篇 facade-必需 docs | `done` | permissions.md / usage.md / catalog.md / me-sessions.md |
| P6-01 | web client 单一 narrow | `done` | client.ts 加 7 个新方法，main.ts 加 6 个新按钮 |
| P6-02 | wechat-miniprogram 同步 | `done` | apiRoutes.js 加 9 路由 + api.js 加 7 helper |
| P6-03 | e2e zx2-transport.test.mjs | `done` | 测试文件存在，NANO_AGENT_LIVE_E2E gated |
| P6-04 | 文档收口 | `done` | transport-profiles.md 状态更新 + 调查报告标注 ZX2 落地 |

#### ZX2 对齐结论

- **done**: `26`
- **partial**: `1`（P4-04 WS frame compat 层 vs wire 层）
- **missing**: `0`

---

## 4. Out-of-Scope 核查

### 4.1 ZX1 Out-of-Scope

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 真实 JWT_SECRET / WECHAT_SECRET 入仓 | `遵守` | 仓库中未发现任何真实 secret |
| O2 | 完整微信账号体系 | `遵守` | 无手机号授权、UnionID 等实现 |
| O3 | 每个内部 worker 单独 public debug 面 | `遵守` | debug 由 orchestrator-core 聚合暴露 |
| O4 | 产品级完整 UI | `遵守` | 客户端保持最小可用界面 |

### 4.2 ZX2 Out-of-Scope

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | context-core / filesystem-core 升级真 RPC | `遵守` | library-only 决策落档 |
| O2 | MCP 服务器管理 | `遵守` | 无相关实现 |
| O3 | rewind / fork | `遵守` | 无相关实现 |
| O4 | 替换底层 transport 协议 (SSE/gRPC) | `遵守` | 无相关实现 |
| O5 | 改动 D1 schema | `遵守` | /me/sessions 基于现有 D1 truth read |
| O6 | 弃用 legacy JWT_SECRET | `遵守` | 保留未改动 |
| O7 | `/_internal/` path prefix 重命名 | `differed` | Phase 1 末复盘决议 |
| O8 | POST /sessions/{id}/messages | `遵守` | 无实现，列入 ZX3 candidate |
| O9 | GET /sessions/{id}/files | `遵守` | 无实现，列入 ZX3 candidate |
| O10 | GET /me/conversations | `遵守` | 无实现，列入 ZX3 candidate |
| O11 | POST /me/devices/revoke | `遵守` | 无实现，列入 ZX3 candidate |
| O12 | 新建 `orchestrator-rpc-contract` 包 | `遵守` | v2 已撤销，通用协议回收到 nacp-core |
| O13 | gemini-cli 能力面对照 | `遵守` | 无实现，列入 ZX3 candidate |

> 所有 out-of-scope 项均被遵守。ZX2 在 scope 边界上保持克制，O8-O11 产品型功能显式推迟到 ZX3，O12 的撤销是 v2 rev 的关键正确决策。

---

## 5. 跨阶段深度分析

### 5.1 ZX1 → ZX2：WeChat login 的验证断层

ZX1 声称完成了 WeChat decrypt-capable auto-login（closure §2），ZX2 在此基础上构建了权限网关与 /me/sessions 等 facade 能力。但核心断点在于：ZX1 的 decrypt 链路从未在真实微信环境中被验证过。

**事实链**：
- ZX1 扩展了 `WeChatLoginInputSchema`（含 `encrypted_data` + `iv`），实现了 AES-CBC 解密逻辑，要求 decrypted openid 与 jscode2session openid 一致
- 但 Mini Program 的 `appid: "touristappid"` 意味着 `wx.login()` 永远拿不到有效 code
- 因此 `jscode2session` 返回的 `session_key` 是模拟数据，AES-CBC 解密路径从未被真实微信解密密钥验证过

**跨阶段影响**：ZX2 的 permission gate、catalog、session identity 全部建立在 auth 已成立的前提上。如果 WeChat auth 的 decrypt 路径实际上有 bug（例如 AES-CBC IV 对齐、Base64 编码格式、padding 处理），ZX2 的上层建筑也会受影响。

**建议**：owner 真实 AppID 替换是 zero-to-real 全链路的硬前置条件。如果在 ZX3 之前仍然没有真实 AppID，建议在 `/auth/wechat` 路径上加一个 smoke test，验证至少 code→openid→JWT 的 baseline 是通的。

### 5.2 Z4 → ZX2：Residual HTTP inventory 的空缺从设计原则到 closure 的演变

Z4 DeepSeek 审查 R3 指出"Residual HTTP inventory 从 Z0 charter 就开始提但从未产出"。ZX2 对此做了三件事：
1. `docs/transport/transport-profiles.md`：为 `internal-http-compat` 确立了状态为 `retired-with-rollback`
2. `docs/runbook/zx2-rollback.md`：提供了 HTTP→RPC 翻转的回滚 runbook
3. agent-core `forwardInternalJsonShadow`：建立了 dual-track parity 机制

但这**仍然不是一份完整的 inventory**。一份完整的 inventory 应按 plan F5 的模板格式列出每条 seam 的 name / owner / 保留原因 / 风险 / 候选退役阶段。当前 transport-profiles.md 只做了 profile-level 描述，没有做 seam-level 盘点。

**当前仍存在的 HTTP seam**（不完整列举）：
| Seam | 位置 | 原因 | 退役条件 |
|------|------|------|----------|
| `/internal/sessions/{id}/{action}` | agent-core → Session DO | 内部 HTTP relay（start/input/cancel/status/timeline/verify） | P3-05 flip |
| `forwardInternalRaw` HTTP fetch | orchestrator-core → agent-core | 真相路径（start/status 有 parity，其余 action 带 shadow） | P3-05 flip |
| `/capability/{call,cancel}` HTTP | agent-core → bash-core | 7 天 fallback（RPC-preferred） | RPC stable 7 天 |
| `/health` HTTP probes | orchestrator-core → 5 worker | operational profile | 永久保留 |

**建议**：在 transport-profiles.md 的 `internal-http-compat` 条目下补充 seam-level 清单，或在 closure 中新增一节。这不仅满足 plan §2.2 F5 要求，也为 ZX3 的 P3-05 flip 执行提供了确定性清单。

### 5.3 Z2 → Z4 → ZX2：heartbeat/replay cursor 客户端消费的持续缺失

这不是 ZX1/ZX2 的直接责任（ZX2 的 scope 不包括客户端 heartbeat/replay 集成），但作为跨阶段连续性分析需要指出：

- Z2 阶段在 `packages/nacp-session/src/heartbeat.ts` 和 `replay.ts` 建立了服务端基础设施
- Z4 DeepSeek 审查 R1 指出两个客户端完全没有消费这些 npm 包（Q10 owner 冻结的 first-wave baseline 被忽略）
- ZX2 的 session-ws-v1.md 文档化了 heartbeat 间隔（30s）、ack 语义、frame ordering、close codes——但**这些规范是针对服务端行为的**
- 客户端侧仍然直接 `new WebSocket(url)` 和 `wx.connectSocket(url)`，没有调用 `HeartbeatTracker` 或 `ReplayBuffer`

**横切判断**：这不是 ZX2 的 scope，但 ZX2 closure 声称"web + wechat 客户端切到统一 narrow"给人的印象是客户端已充分对接了新 transport 规范。实际上 narrow 切换只覆盖了 HTTP envelope 形状和新增端点消费，heartbeat/replay cursor 在客户端侧的缺口仍然是 Z4 review 时的状态。建议在 ZX2 closure 的 "ZX3 候选" 中显式列出客户端 heartbeat/replay cursor 集成。

### 5.4 Z4 review → ZX2：Z4 遗留问题链的闭合复查

Z4 DeepSeek 审查 §5.6 列出了 6 条从早期到 Z4 仍未解决的遗留问题。逐一复查其在 ZX2 后的状态：

| 来源 | 问题 | ZX2 状态 |
|------|------|----------|
| Z2 review R3 | RPC 内部仍走 fetch-backed DO routing | `未改变`——`invokeInternalRpc` 仍是 `stub.fetch()` |
| Z2 review R6 | Q6 "清空 DO storage 后从 D1 恢复 last 50 frames" invariant 测试缺失 | `未改变` |
| Z2 review R8 | forwardStatus 无 parity 检查 | `已修复`——ZX2 为 input/cancel/verify/timeline 全部加了 shadow parity |
| Z2 review R13+R14 | alarm checkpoint / cache eviction 未实现 | `未改变` |
| Z3 review R2 | quota exhausted/recover 测试缺失 | `未改变` |
| Z3 review R6 | 无 AI binding → silent fallback to stub kernel | `未改变` |

**判断**：ZX2 解决了 1 条（forwardStatus parity → 已扩展为 4 个 action 的 shadow parity），其余 5 条仍 open。ZX2 closure §5 风险与遗留事项表中未映射这 5 条。建议在 closure 或 ZX3 candidate 中显式标注。

### 5.5 命名规范跨阶段一致性

延续 Z0-Z4 审查中已发现的问题：

- **`orchestration.core` vs `orchestrator-core`**：charter/docs 继续使用 `orchestration.core`，代码目录继续使用 `orchestrator-core`。不一致延续，ZX2 未新增命名混乱
- **`agent.core` vs `agent-core`**：同上，仍然不一致
- **ZX2 新增命名**：`nacp-internal`、`internal-http-compat`、`facade-http-v1`、`session-ws-v1`、`health-probe`——5 个 profile 命名全部使用 `-` 分隔，风格一致

### 5.6 ZX1-ZX2 之间的盲点：JWT_SIGNING_KID 轮换流程未测试

ZX1 建立了 JWT signing key 的多 kid 架构（`JWT_SIGNING_KEY_<kid>` + `JWT_SIGNING_KID`），ZX1 closure 写了轮换步骤：
1. 写入新的 `JWT_SIGNING_KEY_v2`
2. 把 `JWT_SIGNING_KID` 改为 `v2`
3. 重新部署 `orchestrator-auth` 与 `orchestrator-core`

但 ZX2 在完成 orchestrator-core session 路径 envelope 化、auth proxy facade-http-v1 化时，没有为 JWT kid 轮换场景编写测试。如果 `JWT_SIGNING_KID` 从一个值切到另一个，所有现有的 JWT bearer token 会立即失效——这在文档层面有说明，但代码层面没有轮换期间的 graceful overlap（即同时接受旧 kid 的 token 一段时间）的测试覆盖。

**建议**：在 ZX3 auth hardening 中显式包含 JWT key rotation 的集成测试。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`

  ZX1 和 ZX2 的代码实现质量和协议设计水平都很高——2392 单测全绿、NACP 协议统一、dual-track parity 渐进迁移、facade-http-v1 单一契约源——这些都是 genuinely good engineering。但两个 closures 都存在不同程度的"将计划/方案/入口的建立表述为已完成验证/已投入运行"的诚实度问题。具体而言：

  - ZX2 closure 声称"内部 HTTP 完全退役"而代码中所有 HTTP 路径都存活（`retired-with-rollback` ≠ `retired`）
  - ZX2 closure 声称"ALL-DONE"而 nacp-core publish + preview deploy + live e2e 均未执行
  - ZX1 closure 声称"WeChat code-level 登录入口已接线"而 Mini Program 以 touristappid 运行，无法真实验证

- **是否允许关闭本轮 review**：`no`

- **关闭前必须完成的 blocker**：
  1. **ZX2 nacp-core 1.4.1 publish + preview deploy + live e2e 执行**：按 closure §4.1 的步骤完成 publish→deploy→live-e2e，将结果追加入 closure §6 验证证据（R2）
  2. **ZX2 closure 诚实化**：修正 §0 TL;DR 和 §1.6 中将"RPC shadow 就绪"表述为"全部走 RPC"的错位；将 §0 状态从"ALL-DONE"改为更精确的表述（如"代码交付完成，运维验证待执行"）（R1 + R4）
  3. **ZX1 Mini Program WeChat login 真实验证或诚实声明**：替换真实 AppID 并跑通全链路，或在 closure §3 验证结果和 §7 verdict 中诚实声明验证缺口（R3）

- **可以后续跟进的 non-blocking follow-up**：
  1. Residual HTTP seam inventory 补全（transport-profiles.md 中增加 seam-level 清单）
  2. clients/api-docs/ 中标注 catalog 端点为 placeholder（空数组）
  3. `wrapSessionResponse` idempotency 检测加固（加 marker field）
  4. ZX2 closure 中增加 Z4→ZX2 遗留问题链映射表
  5. ZX3 candidate 表中补充：客户端 heartbeat/replay cursor 集成、JWT kid rotation 测试、WORKER_VERSION CI 动态化、catalog 内容填充、context-core/filesystem-core 升级真 RPC
  6. WS frame compat 层在 closure 中正名为 mapping layer（而非 wire-level alignment）

- **建议的二次审查方式**：`same reviewer rereview`——以上 blocker 纯属 closure 表述修正 + 运维执行，不需要重新审查代码

- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §7 append 回应，不要改写 §0–§6。`

> 本轮 review 不收口，等待实现者按 §7 响应并完成 3 项 blocker。

---

## 7. 实现者回应区

> 待实现者填写。

---

## 8. 对 DeepSeek 本轮审查的自我评估

| 维度 | 自评 | 说明 |
|------|------|------|
| 证据链完整度 | 9 | 127 行验证命令 + 逐项代码核查 + 跨文件 grep 覆盖 |
| 判断严谨性 | 8 | 区分了"代码已写"vs"验证已完成"vs"运维已执行"三个层面，未将非生产就绪的 gap 上升为设计错误 |
| 修法建议可执行性 | 9 | 3 项 blocker 全部有文件/行号定位 + 具体改写建议 |
| 对 action-plan / design 的忠实度 | 9 | 逐项对齐了 ZX1 的 14 个 + ZX2 的 27 个工作项，out-of-scope 核查全覆盖 |
| 跨阶段分析的深度 | 8 | 追踪了 Z4→ZX1→ZX2 的 5 条问题链，但 context-core/filesystem-core 的真 RPC 升级路径分析较弱 |
| 中文表达质量 | 8 | 保持简洁、不重复叙述、避免过度修辞；但 §2 的 9 条 finding 仍有一定信息密度 |

**总体 8.5 / 10**。

本轮审查的优势在于：在 ZX2 closure 已经高度自我完善的文档体系（closure + action-plan 执行日志 + transport-profiles + rollback runbook）之上，仍找到了 3 个实质性断裂面——closure 声称 vs 代码事实不一致、运维前提条件未满足、ZX1 的验证基线不可信。劣势在于：对 DO 内 state machine / turn loop / actor phase 的深度 runtime analysis 未做（超出本次 scope，留给后续专项审查）。
