# Nano-Agent 代码审查 — ZX1-ZX2 阶段审查

> 审查对象: `zero-to-real / ZX1 WeChat Enhance + ZX2 Transport Enhance`
> 审查类型: `mixed (code-review + closure-review)`
> 审查时间: `2026-04-27`
> 审查人: `GLM-5.1`
> 审查范围:
> - `docs/action-plan/zero-to-real/ZX1-wechat-ehance.md`
> - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`
> - `docs/issue/zero-to-real/ZX1-closure.md`
> - `docs/issue/zero-to-real/ZX2-closure.md`
> - `packages/orchestrator-auth-contract/**`
> - `packages/nacp-core/src/rpc.ts`
> - `packages/nacp-session/src/messages.ts`
> - `workers/orchestrator-auth/src/**`
> - `workers/orchestrator-core/src/**`
> - `workers/agent-core/src/index.ts`
> - `workers/bash-core/src/{index,worker-runtime}.ts`
> - `workers/context-core/src/index.ts`
> - `workers/filesystem-core/src/index.ts`
> - `clients/web/src/{client,main}.ts`
> - `clients/wechat-miniprogram/{apiRoutes,utils/api,utils/wechat-auth}.js`
> - `clients/api-docs/**`
> - `docs/transport/transport-profiles.md`
> - `test/cross-e2e/zx2-transport.test.mjs`
> - `workers/*/wrangler.jsonc`
> 对照真相:
> - `docs/action-plan/zero-to-real/ZX1-wechat-ehance.md`
> - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`
> - `docs/issue/zero-to-real/ZX1-closure.md`
> - `docs/issue/zero-to-real/ZX2-closure.md`
> - `docs/transport/transport-profiles.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`ZX1-ZX2 的实现主体成立，action-plan 与 closure 的全部 27+5=32 个工作项均有代码落地和测试覆盖，可以作为已交付阶段收口——但存在 2 个 medium 级别 open item 需要后续运维跟进（npm publish + preview 部署），以及 3 个跨包设计债务需要在 ZX3 前后关注。`
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`yes`
- **本轮最关键的 3 个判断**：
  1. ZX1 微信解密登录链路、6-worker health 矩阵、API 文档三项交付均与代码一致，action-plan 的 5 项 exit criteria 全部达成。
  2. ZX2 6 phase 全部落地，2392/2392 测试全绿，transport profile 命名冻结、NACP 协议补齐、内部 RPC 化、envelope 统一、facade 必需端点、客户端同步——7 项收口标准中 6 项完全达成，第 7 项（live preview 7 天观察）尚需运维执行，不阻塞代码层面收口。
  3. 跨阶段存在 3 项设计债务（3 种 envelope 形状并存、JWT 验证逻辑在 2 个 worker 重复、FacadeErrorCode 与 RpcErrorCode 需手工同步），均不阻塞 ZX1-ZX2 收口，但应在 ZX3 前后安排收敛。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/zero-to-real/ZX1-wechat-ehance.md`（628 行）
  - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`（1022 行，含 §11 GPT 附加审查 + §12-§13 执行日志）
  - `docs/issue/zero-to-real/ZX1-closure.md`（75 行）
  - `docs/issue/zero-to-real/ZX2-closure.md`（306 行）
  - `docs/transport/transport-profiles.md`（190 行，frozen-v1）
- **核查实现**：
  - 逐一核对 ZX1 closure §2-§7 与 `orchestrator-auth-contract/src/index.ts`、`orchestrator-auth/src/wechat.ts`、`orchestrator-auth/src/service.ts`、`orchestrator-core/src/index.ts`、6 个 worker `wrangler.jsonc`、`clients/api-docs/` 全部文件
  - 逐一核对 ZX2 closure §1.1-§1.10 与 `nacp-core/src/rpc.ts`、`nacp-session/src/messages.ts`、`orchestrator-auth-contract/src/facade-http.ts`、`orchestrator-core/src/{index.ts,user-do.ts}`、`agent-core/src/index.ts`、`bash-core/src/index.ts`、`context-core/src/index.ts`、`filesystem-core/src/index.ts`、`clients/web/src/client.ts`、`clients/wechat-miniprogram/apiRoutes.js`、`clients/wechat-miniprogram/utils/api.js`
- **执行过的验证**：
  - `pnpm -F @haimang/nacp-core test` — 289/289 ✅
  - `pnpm -F @haimang/nacp-session test` — 146/146 ✅
  - `pnpm -F @haimang/orchestrator-auth-contract test` — 19/19 ✅
  - `pnpm -F @haimang/orchestrator-auth-worker test` — 8/8 ✅
  - `pnpm -F @haimang/orchestrator-core-worker test` — 41/41 ✅
  - `pnpm -F @haimang/agent-core-worker test` — 1054/1054 ✅
  - `pnpm -F @haimang/bash-core-worker test` — 370/370 ✅
  - `pnpm -F @haimang/context-core-worker test` — 171/171 ✅
  - `pnpm -F @haimang/filesystem-core-worker test` — 294/294 ✅
  - 合计：**2392 tests, 0 failed** — 与 ZX2 closure §2 声明一致
- **复用 / 对照的既有审查**：
  - `docs/code-review/zero-to-real/ZX1-ZX2-reviewed-by-GPT.md` — 作为参考线索，了解 GPT 审查角度，但本审查结论全部基于独立 reasoning
  - `docs/code-review/zero-to-real/ZX1-ZX2-reviewed-by-kimi.md` — 同上
  - Z0-Z4 各阶段审查报告 — 了解跨阶段连续性

### 1.1 已确认的正面事实

1. **ZX1 5 项 exit criteria 全部达成**：decrypt-capable login 主链落地、JWT/salt/appid/secret 配置入口明确无泄密、6-worker health 聚合可用、`clients/api-docs/` 5 篇文档成立、closure 诚实声明 residual（code-only 保留、debug-first 定位、operational secret handoff 待做）。
2. **ZX2 2392 测试全绿**，与 closure §2 声明完全吻合，各 worker 包测试数量逐一核对无误。
3. **NACP 单一协议源决策正确落地**：通用协议对象（`Envelope<T>` / `RpcMeta` / `RpcErrorCode` / `validateRpcCall`）全部归入 `nacp-core`，`facade-http-v1` 归入 `orchestrator-auth-contract`，未新建 `orchestrator-rpc-contract` 包——这采纳了 GPT §11.1 的审查建议，决策与执行一致。
4. **`workers_dev` 审计完全执行**：6 个 wrangler.jsonc 全部显式声明，orchestrator-core=true 其余=false（含 agent-core preview=false），与 closure §1.5 表格一致。
5. **binding-scope 守卫代码实现一致**：4 个非 facade worker（orchestrator-auth、bash-core、context-core、filesystem-core）的 fetch 入口对非 `/health` 路径返回 401 `binding-scope-forbidden`，代码实地验证通过。bash-core 额外校验 `x-nano-internal-binding-secret` header。
6. **7 个 facade 必需 HTTP 端点全部落地**：`index.ts` 和 `user-do.ts` 可验证 7 个端点的 handler 实际存在——`/sessions/{id}/permission/decision`、`/sessions/{id}/policy/permission_mode`、`/sessions/{id}/usage`、`/sessions/{id}/resume`、`/catalog/{skills,commands,agents}`、`POST /me/sessions`、`GET /me/sessions`。
7. **ZX2 closure 对残留风险 R1-R10 的跟踪诚实**：每个 risk 都标注了 v3 解决状态或 open 状态，没有遮掩。

### 1.2 已确认的负面事实

1. **3 种 envelope 形状并存未收敛**：`AuthEnvelope<T>` (auth-contract)、`Envelope<T>` (nacp-core rpc.ts)、`FacadeEnvelope<T>` (auth-contract facade-http.ts)。ZX2 closure §1.7 声称"session 与 auth 同形"，实际上 `FacadeEnvelope` 是对 `AuthEnvelope` 的包装层（`facadeFromAuthEnvelope`），而 `Envelope` 是 RPC 内部形状——三者在 type level 是不同类型，运行时靠 helper 函数桥接。这不是 bug，但 closure 的"同形"表述有误导性。
2. **JWT 验证逻辑在 2 个 worker 内重复实现**：`orchestrator-core/src/auth.ts` 和 `orchestrator-auth/src/jwt.ts` 各自独立实现了 `collectVerificationKeys`、`importKey`、`base64Url`、`parseJwtHeader`、`verifyJwt`/`verifyAccessToken`——两段逻辑几乎相同，但分布在两个 worker 的独立环境中。这是一个 DRY 违反，运行时无影响（Cloudflare Worker 隔离部署），但维护时会增加不一致风险。
3. **`FacadeErrorCode` 与 `RpcErrorCode` 需手工保持对齐**：`facade-http.ts` 的 `_authErrorCodesAreFacadeCodes` 编译期断言只保证 `AuthErrorCode ⊂ FacadeErrorCode`，但 `RpcErrorCode`（在 `nacp-core`）和 `FacadeErrorCode`（在 `orchestrator-auth-contract`）之间没有自动同步机制。未来新增 error code 时如果只改一处，会导致跨包行为漂移。
4. **nacp-core 1.4.1 和 nacp-session 1.3.1 尚未 npm publish**：ZX2 closure §4.1 明确标注为 open item。当前 bash-core 和 orchestrator-core 通过 dist overlay 稳定 diff 矩阵解决（closure §13.4 §8），但正式发布前下游 worker 的 `package.json` 仍然指向 `1.4.0`/`1.3.0`。这不影响本地测试（workspace 依赖用 `workspace:*`），但 preview 部署前必须执行。
5. **所有 wrangler.jsonc 使用同一个 D1 database placeholder**：`71a4b089-93e0-4d8f-afb8-bc9356a97cfa` 出现在所有 6 个 worker 的 wrangler.jsonc 中，注释写的是"Replace this placeholder with the real shared D1 UUID before deploy"。如果这就是 preview D1，注释有误导性；如果不是，则在部署前需要替换。
6. **`AuthSnapshotSchema` 的 `team_uuid` 字段在 contract 中为必填，但 `AccessTokenClaimsSchema` 中为 optional**：`user-do.ts` 多处使用 `authSnapshot.team_uuid ?? authSnapshot.tenant_uuid` 做 fallback，这意味着 legacy token 可能只有 `tenant_uuid` 没有 `team_uuid`，contract schema 的 `team_uuid: z.string().uuid()` 比实际运行时行为更严格。
7. **ZX2 e2e 测试窄度较高**：`zx2-transport.test.mjs` 仅 74 行，只覆盖了 catalog public read + `/me/sessions` mint/reject/list 三个场景。closure 声称"live preview e2e 测试就绪"，但实际 e2e 并未覆盖 permission round-trip、usage update、RPC parity、dual-track 等核心链路——这些依赖 preview 部署后的 `NANO_AGENT_LIVE_E2E` 环境变量。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 逐一对照 closure 声明与实际代码文件 |
| 本地命令 / 测试 | `yes` | 9 个 worker/package 的测试命令全部执行通过，合计 2392 tests |
| schema / contract 反向校验 | `yes` | 核查了 `WeChatLoginInputSchema`、`FacadeErrorCode` vs `RpcErrorCode`、`AuthSnapshotSchema` vs `AccessTokenClaimsSchema` |
| live / deploy / preview 证据 | `no` | preview 环境尚未部署，无法验证公网入口关闭和端点可观测性 |
| 与上游 design / QNA 对账 | `yes` | 交叉比对 ZX1 action-plan、ZX2 action-plan（含 §11 GPT 附加审查）、两份 closure |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | 三种 envelope 类型并存且 closure 表述有误导 | medium | protocol-drift | no | ZX3 前后收敛至单一 envelope 源；closure 措辞修正 |
| R2 | JWT 验证逻辑在 2 个 worker 重复实现 | low | delivery-gap | no | ZX3 安排抽取 shared JWT 工具到 `packages/` |
| R3 | FacadeErrorCode 与 RpcErrorCode 无自动同步机制 | medium | protocol-drift | no | 引入跨包 zod enum 编译期全量断言 |
| R4 | nacp-core/nacp-session 版本未 publish | medium | delivery-gap | no | 执行 closure §4.1 publish 流程 |
| R5 | D1 database placeholder 注释混淆 | low | docs-gap | no | 确认是否为 preview database，更新注释 |
| R6 | AuthSnapshotSchema.team_uuid 必填 vs 运行时 optional | medium | correctness | no | 在 contract 层加 comment 说明 fallback 语义，或改 optional |
| R7 | e2e 测试覆盖窄度较高 | medium | test-gap | no | preview 部署后补充 permission/usage/RPC parity e2e |
| R8 | 用户 UI 中硬编码演示密/密码 | low | security | no | 无阻塞，上线前移除 |
| R9 | internal-http-compat 运行时代码未移除 | low | scope-drift | no | 按 P3-05 runbook 7 天 parity 后移除 |
| R10 | action-plan 标题 ZX1 文件名拼写 `ehance` | low | docs-gap | no | 不影响功能，但应修正为 `enhance` |

### R1. 三种 envelope 类型并存且 closure 表述有误导

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `packages/orchestrator-auth-contract/src/index.ts` 定义 `AuthEnvelope<T>`（`{ok, data} | {ok:false, error}`）
  - `packages/nacp-core/src/rpc.ts` 定义 `Envelope<T>`（`RpcSuccessEnvelope<T> | RpcErrorEnvelope`，含 `trace_uuid`/`meta`）
  - `packages/orchestrator-auth-contract/src/facade-http.ts` 定义 `FacadeEnvelope<T>`（`{ok:true, data, trace_uuid} | {ok:false, error:{code,status,message}, trace_uuid}`）
  - ZX2 closure §1.7 声称"session 与 auth 同形"——实际上 `wrapSessionResponse` 做的是 idempotent 包装，内层 user-do 仍吐 `{ok:true, action, phase}` 旧格式
- **为什么重要**："同形"在 type level 不成立，只有运行时行为在经过 facade 包装后对外表现一致。如果后续维护者误认为 envelope 已统一，可能在 user-do 内部直接引入 nacp envelope 类型，破坏分层。
- **审查判断**：ZX2 的设计意图是正确的——三形态在 transition 期共存，通过 `facadeFromAuthEnvelope` 和 `envelopeFromAuthLike` 桥接。但 closure 对"统一"的表述应改为"对外输出统一为 facade-http-v1 envelope"，而非"内部形状统一"。
- **建议修法**：在 closure §1.7 补充精确描述："session 路径和 auth 路径对外输出统一为 `{ok,data|error,trace_uuid}" facade-http-v1 形状；内部仍有 3 种 type（AuthEnvelope / Envelope / FacadeEnvelope），通过 helper 桥接。ZX3 应收敛至 Envelope 单一来源。"

### R2. JWT 验证逻辑在 2 个 worker 重复实现

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/auth.ts:55-100` 实现了 `collectVerificationKeys`、`importKey`、`base64Url`、`parseJwtHeader`、`verifyAccessToken`
  - `workers/orchestrator-auth/src/jwt.ts:20-80` 实现了近乎相同的逻辑
  - 两者都支持 `JWT_SIGNING_KEY_<kid>` keyring 和 `JWT_SECRET` legacy fallback
- **为什么重要**：两份独立实现的 API 签名相同但代码路径不同，未来修 JWT 逻辑时如果只改一处会引入不一致。Cloudflare Worker 隔离部署使运行时无影响，但维护成本倍增。
- **审查判断**：这是 zero-to-real 阶段的历史遗留，不阻塞 ZX1-ZX2 收口。应在 ZX3 前后抽取 shared JWT 工具到 `packages/`。
- **建议修法**：在 ZX3 候选清单中安排"JWT 验证逻辑收敛到 shared package"。

### R3. FacadeErrorCode 与 RpcErrorCode 无自动同步机制

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `packages/orchestrator-auth-contract/src/facade-http.ts:38-78` 定义 `FacadeErrorCodeSchema`（59 个 code）
  - `packages/nacp-core/src/rpc.ts:20-55` 定义 `RpcErrorCodeSchema`（30 个 code）
  - 两者存在大量重叠字符串（如 `"invalid-input"`, `"unauthorized"`, `"forbidden"`, `"not-found"`）
  - `_authErrorCodesAreFacadeCodes` 编译期断言只保证 `AuthErrorCode ⊂ FacadeErrorCode`
  - **没有跨包断言**保证 `RpcErrorCode ⊂ FacadeErrorCode` 或两者完全对齐
- **为什么重要**：如果未来在 nacp-core 新增一个 error code（如 `"rate-limited"`），但忘记在 facade-http.ts 同步新增，前端消费 `FacadeErrorCode` 就会遇到未覆盖的 error code，导致运行时行为漂移。
- **审查判断**：当前状态可接受，因为两份 code list 在 ZX2 收口时已对齐。但跨包维护风险应在 ZX3 解决。
- **建议修法**：在 ZX3 安排引入跨包 zod enum 编译期全量断言——例如在 facade-http.ts 中新增 `_rpcErrorCodesAreFacadeCodes: Record<keyof typeof import('nacp-core').RpcErrorCodeEnum, true> = ...` 的穷尽映射断言。

### R4. nacp-core/nacp-session 版本未 publish

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`（不阻塞代码层面收口，但阻塞 preview 部署）
- **事实依据**：
  - ZX2 closure §4.1 明确标注："nacp-core 1.4.1 未 publish"为 open item
  - 各 worker `package.json` 中 `@haimang/nacp-core` 指向 `1.4.0`（pinned）
  - 本地 workspace 依赖 `workspace:*` 可正常工作，但 dist overlay 是临时方案（closure §13.4 §8）
- **为什么重要**：preview 部署时 pnpm 解析会从 registry 拉老版本 1.4.0，不含 ZX2 新增的 `rpc.ts` 内容。bash-core 和 orchestrator-core 在本地通过 dist overlay 绕过此问题，但在 CI/CD 和 preview 环境中会包解析失败。
- **审查判断**：ZX2 closure 已诚实标注此为 open item，不阻塞本轮 review 收口。
- **建议修法**：执行 closure §4.1 流程：`cd packages/nacp-core && pnpm version 1.4.1 --no-git-tag-version && pnpm publish`，然后升级下游 worker dep。

### R5. D1 database placeholder 注释混淆

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - 所有 6 个 worker 的 `wrangler.jsonc` 中 D1 `database_id` 为 `71a4b089-93e0-4d8f-afb8-bc9356a97cfa`
  - 注释为 "Replace this placeholder with the real shared D1 UUID before deploy"
  - 如果这就是实际使用的 preview D1 database，注释是错误的
- **为什么重要**：新维护者可能误以为需要替换此 UUID，导致破坏 preview 部署。
- **审查判断**：低风险，属于注释债务。
- **建议修法**：确认此 UUID 是否为 preview D1 database ID。如果是，更新注释为 "Preview D1 database ID — production uses env-specific value"；如果不是，加 `TODO` 标记。

### R6. AuthSnapshotSchema.team_uuid 必填 vs 运行时 optional

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `packages/orchestrator-auth-contract/src/index.ts` 中 `AuthSnapshotSchema` 定义 `team_uuid: z.string().uuid()`（必填）
  - `AccessTokenClaimsSchema` 中 `team_uuid` 为 `z.string().uuid().optional()`
  - `user-do.ts` 多处使用 `authSnapshot.team_uuid ?? authSnapshot.tenant_uuid` fallback
  - 这暗示运行时存在 legacy token 只有 `tenant_uuid` 没有 `team_uuid` 的场景
- **为什么重要**：contract schema 承诺 `team_uuid` 必填，但运行时代码防御性地为其提供了 fallback。如果上游 auth worker 未来发了一个不含 `team_uuid` 的 JWT（例如配置错误），contract 校验会在 RPC 入口 reject，但 user-do 内部路径会 fallback 到 `tenant_uuid`——这创造了一个校验层和行为层之间的语义裂缝。
- **审查判断**：这是一个真实的 inconsistency，但当前被 operational fallback 正确兜住。不阻塞 ZX1-ZX2 收口。
- **建议修法**：在 `AuthSnapshotSchema` 注释中明确说明"team_uuid 在 auth-worker 签发的 JWT 中必填（tenant_source=claim），但 orchestrator-core ingress 可能遇到 legacy deploy-fill token 只有 tenant_uuid"的实际语义。或者在 ZX3 中将 `team_uuid` 改为 optional 并明确优先级。

### R7. e2e 测试覆盖窄度较高

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `test/cross-e2e/zx2-transport.test.mjs` 仅 74 行，测试 4 个场景：public catalog read（3 个）、server-mint UUID、reject client UUID、list sessions
  - 没有覆盖：permission round-trip、usage update、resume、dual-track parity 比对、bash-core RPC + NACP authority、WS frame shape 对齐、facade-http-v1 envelope narrow
  - closure §1.9 称"live preview e2e"测试就绪，但实际 e2e 应用需要 `NANO_AGENT_LIVE_E2E=1` 环境变量才能在 CI 执行
  - Closure §6.3 标注"公网入口审计（preview 待部署后 curl 验证）"仍为 open
- **为什么重要**：单元测试全绿不代表端到端链路已验证。permission round-trip、usage update、RPC parity 等核心链路目前只有 worker 级别单测，没有跨 worker 集成测试。
- **审查判断**：当前单测覆盖足够，cross-e2e 窄度是已知限制。ZX2 closure 对此保持了诚实的 open 态度。
- **建议修法**：preview 部署后优先补充以下 e2e 场景：permission deny round-trip（ZX2 P5-03 验收核心）、bash-core RPC+authority、agent-core dual-track parity mismatch 监控。

### R8. 用户 UI 中硬编码演示密码

- **严重级别**：`low`
- **类型**：`security`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/web/src/main.ts:36` — `password: "NanoAgent!z4-client"`
  - `clients/wechat-miniprogram/pages/index/index.js:9` — `password: "NanoAgent!z4-mini"`
  - 这些是测试/演示 UI 的默认值，不是生产密码，但仍然硬编码在源码中
- **为什么重要**：如果生产部署时忘记移除或替换，任何人都可以用这些密码登录。
- **审查判断**：当前为 demo/preview 阶段，低风险。
- **建议修法**：在两个文件中加 `// TODO: remove default password before production` 注释，或在 ZX3 中改为 env 配置。

### R9. internal-http-compat 运行时代码未移除

- **严重级别**：`low`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts` 中 `forwardInternalJsonShadow` 仍保留 HTTP fetch fallback
  - `workers/agent-core/src/host/internal.ts` 仍保留旧 fetch action handlers
  - ZX2 closure 明确标注 `internal-http-compat` 处于 `retired-with-rollback` 状态
  - P3-05 要求 7 天 parity 观察 + owner 批准后才能移除
- **为什么重要**：残留的 HTTP fallback 代码意味着运行时仍有两条路径，直到 P3-05 翻转执行。
- **审查判断**：这是 ZX2 plan 的设计决策（保守翻转策略），不是遗漏。但应在 7 天 parity 观察期结束后尽快执行 P3-05。
- **建议修法**：按 closure §7.2 流程执行翻转，7 天后删除 `forwardInternalJsonShadow` 的 fetch 分支。

### R10. ZX1 action-plan 文件名拼写错误

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - 文件名为 `ZX1-wechat-ehance.md`（少了一个 `n`）
  - 正确拼写应为 `ZX1-wechat-enhance.md`
  - 不影响任何功能，但作为长期参考文档，拼写错误会传播
- **审查判断**：纯文档问题，不影响代码。
- **建议修法**：重命名文件并更新所有引用（如果有的话）。

---

## 3. In-Scope 逐项对齐审核

### 3.1 ZX1 In-Scope 对齐

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | WeChat 登录 contract 扩展（encrypted_data + iv） | `done` | `WeChatLoginInputSchema` 已含 `encrypted_data` + `iv` 成对约束 + `superRefine` 校验 |
| S2 | orchestrator-auth 实现 jscode2session + decrypt + identity | `done` | `wechat.ts` 实现 AES-CBC 解密 + watermark 校验；`service.ts` 的 `wechatLogin()` 支持解密后 openid 对拍 |
| S3 | JWT/salt/appid/secret 配置入口明确 | `done` | wrangler.jsonc 声明 key 名；`.dev.vars` 示例存在；closure §5 有完整配置指南 |
| S4 | 6-worker health 统一 + orchestrator-core 聚合 | `done` | 所有 worker `WORKER_VERSION` env + `/health` route + `/debug/workers/health` 聚合面 |
| S5 | clients/api-docs 建立 | `done` | 5 篇文档：README/auth/wechat-auth/session/worker-health |

### 3.2 ZX2 In-Scope 对齐

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | 5 transport profile 命名冻结 | `done` | `docs/transport/transport-profiles.md` 已冻结，含跨界规则与形状碎片治理 |
| S2 | 全 worker workers_dev 审计 + agent-core preview=false | `done` | 6 个 wrangler.jsonc 全部显式声明，与 closure 表格一致 |
| S3 | nacp-core 公开协议对象 + validateRpcCall | `done` | `rpc.ts` 376 行，导出 Envelope/RpcMeta/RpcErrorCode/RpcCaller/validateRpcCall + 4 helper |
| S4 | nacp-session 5 族 7 message_type | `done` | `messages.ts` 新增 7 个 type，SESSION_MESSAGE_TYPES 从 8 升至 15 |
| S5 | orchestrator-auth-contract 扩 facade-http-v1 | `done` | `facade-http.ts` 193 行，含 FacadeErrorCode/FacadeEnvelope/facadeOk/facadeError/facadeFromAuthEnvelope |
| S6 | NACP 双头校验 | `done` | `validateRpcCall` 提供 caller-side 入口；callee-side `validateEnvelope` + `verifyTenantBoundary` + `checkAdmissibility` 在 nacp-core 已有 |
| S7 | agent-core 7 RPC method + dual-track parity | `done` | `start/status/input/cancel/verify/timeline/streamSnapshot` — 7 method 全部落地 |
| S8 | bash-core WorkerEntrypoint + secret + NACP authority | `done` | `BashCoreEntrypoint` 含 call/cancel 2 个 RPC + `validateBashRpcMeta` + binding-secret |
| S9 | session+auth 外层 facade-http-v1 | `done` | `wrapSessionResponse` idempotent 包装 + auth proxy 用 `facadeFromAuthEnvelope` |
| S10 | WS frame 对齐 NacpSessionFrameSchema | `partial` | compat 层 `liftLightweightFrame()` 已落地，但 wire 上仍为 `{kind,...}` 旧格式（closure §1.7 确认为 compatibility decision，非遗漏） |
| S11 | 5 个 facade 必需 HTTP 端点 | `done` | 7 个端点（含 `/me/sessions` GET+POST）全部落地 |
| S12 | api-docs + transport-profiles + session-ws-v1 | `done` | 9 篇文档 + transport-profiles.md + session-ws-v1.md + 4 篇必需端点文档 |
| S13 | 单测 + cross-e2e + 文档收口 | `done` | 2392/2392 单测全绿；cross-e2e 文件就绪但需 live env |

### 3.3 对齐结论

- **done**: 16
- **partial**: 1（S10 WS frame wire 仍为旧格式，compat 层已落地，按 closure 确认为 session-ws-v2 统一时机）
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0

> ZX1-ZX2 的核心骨架与业务链路已完成。唯一的 partial 项（S10）是设计决策而非遗漏——WS wire 格式的完全统一推迟到 session-ws-v2，当前 compat 层已提供 NACP-shaped 映射能力。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|-----------------|----------|------|
| O1 | ZX1: 真 secret 入仓 | `遵守` | 代码中无真实 secret，仅有测试占位和默认值 |
| O2 | ZX1: 完整微信账号体系/手机号/UnionID | `遵守` | 仅实现 decrypt profile login，未引入手机号或 UnionID |
| O3 | ZX1: 开放各 worker 单独 debug 面 | `遵守` | 只有 orchestrator-core 公开 `/debug/workers/health` |
| O4 | ZX1: 把小程序升级为产品级完整 UI | `遵守` | 仅修改登录和调试页，UI 变更最小化 |
| O5 | ZX2: 把 context/fs 升级为真 RPC worker | `遵守` | 两者仍为 library-only，README + wrangler 注释已落档 |
| O6 | ZX2: 引入 MCP 服务器管理端点 | `遵守` | 未引入 |
| O7 | ZX2: rewind/fork D1 truth 端点 | `遵守` | 未引入 |
| O8 | ZX2: POST /sessions/{id}/messages 多模态 | `遵守` | 未引入 |
| O9 | ZX2: GET /sessions/{id}/files artifact | `遵守` | 未引入 |
| O10 | ZX2: GET /me/conversations 完整列表 | `遵守` | 未引入 |
| O11 | ZX2: POST /me/devices/revoke 设备管理 | `遵守` | 未引入 |
| O12 | ZX2: 新建 orchestrator-rpc-contract 包 | `遵守` | 采纳 GPT §11.1 审查建议，未新建，通用协议归入 nacp-core |
| O13 | ZX2: gemini-cli 能力面对照 | `遵守` | 列入 ZX3 候选 |

> 全部 Out-of-Scope 项均被遵守，没有越界实现。

---

## 5. 跨阶段跨包深度分析

### 5.1 zero-to-real 全阶段连续性审查

| 阶段 | 核心交付 | 与 ZX1-ZX2 的衔接 |
|------|----------|-------------------|
| Z0 | Contract baseline（nacp-core envelope/authority/trace） | ZX2 在此基础上扩展 `rpc.ts` + `Envelope<T>` + `RpcMeta` + `validateRpcCall`。连续性良好。 |
| Z1 | JWT kid-aware keyring + auth worker | ZX1 在此基础上增加 wechat decrypt profile；ZX2 的 facade-http-v1 在 auth-contract 上扩展。JWT 验证逻辑的 2 处重复是 Z1 遗留债务。 |
| Z2 | D1 session truth + audit | ZX2 的 `/me/sessions` 直接基于 Z2 的 D1 truth 读取（lazy create + server-mint UUID）。连续性良好。 |
| Z3 | agent-core live loop + bash-core capability | ZX2 的 agent-core 7 RPC method 和 bash-core `WorkerEntrypoint` 建立在 Z3 的 runtime 之上。ZX2 把 Z3 的 HTTP 路径升级为 RPC+parity。连续性良好。 |
| Z4 | Web/wechat 客户端 + first real run | ZX1 更新了 wechat 登录页；ZX2 Phase 6 更新了 web + wechat 客户端到统一 narrow。连续性良好。 |
| Z5 | Closure & handoff | ZX1-ZX2 是 Z5 之后的增强阶段，与 Z5 closure 中指出的"微信登录仅为 code baseline"和"transport 混合态"完全对齐。 |

**判断**：zero-to-real 全阶段（Z0-Z5 + ZX1-ZX2）的交付物形成了完整的纵向链路，不存在 Z 阶段之间的断点。ZX1 的 WeChat 解密链路、ZX2 的 envelope 统一和 RPC 化都正确地叠加在 Z0-Z5 的基础上。

### 5.2 跨包依赖与命名规范分析

| 包 | 版本对齐状态 | 命名规范 |
|----|-------------|----------|
| `nacp-core` | `1.4.0`（需 bump 至 `1.4.1`） | 导出类型命名一致：`Envelope<T>`, `RpcMeta`, `RpcErrorCode`, `validateRpcCall` |
| `nacp-session` | `1.3.0`（需 bump 至 `1.3.1`） | message_type 命名遵循 `session.<domain>.<action>` 模式，与 plan 一致 |
| `orchestrator-auth-contract` | `0.0.0`（workspace 内部） | `AuthEnvelope<T>` / `FacadeEnvelope<T>` 与 nacp-core `Envelope<T>` 异名但语义明确 |
| `orchestrator-core-worker` | — | `wrapSessionResponse` idempotent 包装，facade-http-v1 对外 |
| `orchestrator-auth-worker` | — | `facadeFromAuthEnvelope` 桥接 AuthEnvelope → FacadeEnvelope |

**关键发现**：3 种 envelope 命名（`AuthEnvelope` / `Envelope` / `FacadeEnvelope`）有明确的语义分层——auth 内部用 `AuthEnvelope`，RPC 内部用 `Envelope`，facade 对外用 `FacadeEnvelope`——但 closure 用"同形"一词有误导，应为"对外输出同形"。

### 5.3 安全边界验证

| 安全项 | ZX1-ZX2 要求 | 实际状态 |
|--------|-------------|----------|
| 真 secret 不入仓 | no real secrets committed | ✅ 无真实 secret，仅有占位和测试值 |
| workers_dev:false for non-facade | 5 worker false, 1 true | ✅ 6 个全部显式声明 |
| binding-scope 守卫 | 非 /health 一律 401 | ✅ 代码验证通过 |
| bash-core NACP authority | call 需 caller/source/request_uuid | ✅ `validateBashRpcMeta` 强制校验 |
| JWT_SECRET legacy | 保留但标注为 fallback | ✅ 两处代码均有 `// legacy` 注释 |

### 5.4 断点与盲点

1. **断点**：nacp-core 版本未 publish 是 ZX2-ZX3 之间的部署断点——如果直接部署而不执行 §4.1 流程，bash-core 和 orchestrator-core 的 `rpc.ts` 新增内容不会被正确解析。
2. **盲点**：`AuthSnapshotSchema.team_uuid` 必填与运行时 optional 之间的语义裂缝——如果遇到 legacy token，contract 层校验会 reject 但 user-do fallback 会接受，存在行为不一致。
3. **盲点**：`FacadeErrorCode` 与 `RpcErrorCode` 之间没有自动同步断言——这是跨包维护盲点，未来新增 error code 时可能遗漏。
4. **盲点**：`zx2-transport.test.mjs` 覆盖面窄——未测 permission round-trip、bash-core RPC、agent-core parity 等核心链路，这些在 preview 部署后是最高优先级验证项。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：`ZX1-ZX2 代码层面审查通过。action-plan 的 27+5=32 个工作项均有代码落地和测试覆盖，Out-of-Scope 项全部遵守，跨阶段连续性良好。存在 2 个 medium 级别 delivery-gap（npm publish + e2e 窄度）和 3 个设计债务（envelope 三形态、JWT 重复、error code 同步），均在 ZX3 候选范围内，不阻塞 ZX1-ZX2 收口。`
- **是否允许关闭本轮 review**：`yes`
- **关闭前必须完成的 blocker**：（无）
- **可以后续跟进的 non-blocking follow-up**：
  1. 执行 ZX2 closure §4.1 npm publish 流程（nacp-core 1.4.1 + nacp-session 1.3.1）
  2. Preview 部署后优先补充 permission round-trip、bash-core RPC、agent-core parity 的 live e2e
  3. ZX3 安排 envelope 收敛至单一来源（`Envelope<T>`）+ JWT 验证逻辑抽取 shared package + `FacadeErrorCode`/`RpcErrorCode` 跨包自动同步断言
  4. 7 天 parity 结束后按 P3-05 runbook 执行 HTTP fetch 路径移除
  5. 确认 D1 database placeholder UUID 是否为 preview database，更新 wrangler 注释
  6. 修正 ZX1 action-plan 文件名拼写 `ehance` → `enhance`
  7. `AuthSnapshotSchema.team_uuid` 注释说明 legacy fallback 语义
- **建议的二次审查方式**：`no rereview needed — non-blocking follow-up 在 ZX3 前后安排即可`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §7 append 回应，不要改写 §0–§5。`

---

## 7. 审查质量评估(由 review-of-reviews 评价人 append)

> 评价对象: `GLM 对 ZX1-ZX2 的独立 review`
> 评价人: `Opus 4.7(1M ctx)— ZX1-ZX2 实现者 + rollout 执行者(2026-04-27)`
> 评价时间: `2026-04-27`
> 评价依据: 横向对照 4 位 reviewer + owner 授权后真实 deploy + cross-e2e 9/14 pass(GPT review §6.5b)

### 7.0 评价结论

- **一句话评价**: 4 位 reviewer 中结构最规范、跨包跨阶段视角最全面的一份;但 verdict 校准最宽松 — 没有把 closure ALL-DONE 的诚实度漂移识别为 blocker,与 GPT/DeepSeek/Kimi 的严判出现明显分歧。
- **综合评分**: `7.0 / 10`
- **推荐使用场景**: 需要"approve-friendly"基调下的全面健康度盘点;关心跨包依赖、命名一致性、安全边界(JWT / D1 placeholder)、type 收敛战略议题的场景;希望以"approve-with-followups"快速收口的场景。
- **不建议单独依赖的场景**: ① closure / action-plan 治理漂移敏锐度要求高的场景(GPT 一刀切到 scope-drift 根因,GLM 把同类问题归于 follow-up);② 需要识别代码层细粒度缺陷的场景(Kimi 在 caller enum / idempotency / 边界检查领先);③ 严判阈值场景(GLM `yes` 与 GPT/DeepSeek `no` 形成对立,事后看后两者更接近真相 — closure 确需重写)。

---

### 7.1 审查风格画像

| 维度 | 观察 | 例证 |
|---|---|---|
| 主要切入点 | `cross-package architecture + naming + DRY + 安全边界`,以"系统健康度"为视角 | R1 envelope 三形态并存;R2 JWT 两 worker 重复实现;R3 FacadeErrorCode vs RpcErrorCode 缺自动同步;§5.2 跨包版本对齐表 |
| 证据类型 | `line-references + 跨包对照表 + 单测命令` | §1.1 7 个正面事实 + §1.2 7 个负面事实带 file:line;§5.2 跨包版本对齐表是 4 位中最系统的 |
| Verdict 倾向 | `optimistic`,`approve-with-followups + yes` | 10 个 finding 中 0 个标 yes-blocker — `4 位中阈值最宽松` |
| Finding 粒度 | `coarse-to-balanced`,10 个 finding 偏战略 | R1-R3 是跨包设计债务;R4-R5 是运维待办;R6-R7 是契约语义 |
| 修法建议风格 | `ZX3-deferred 居多`,具体代码 fix 较少 | R1: ZX3 收敛 envelope 单一来源;R2: ZX3 抽 shared JWT package;R3: ZX3 跨包 zod enum 编译期断言 |

---

### 7.2 优点与短板

#### 7.2.1 优点

1. **跨包架构视角最系统**: R1(envelope 三形态)+ R2(JWT 重复)+ R3(error code 同步) 三个跨包设计债务 finding,以及 §5.2 跨包版本对齐表、§5.3 安全边界验证表,是 4 位 reviewer 中唯一系统性扫描"跨包契约一致性 + DRY + 安全栈层级"的。
2. **R5 D1 placeholder 注释命中**: 注释 "Replace this placeholder with the real shared D1 UUID before deploy" 在 6 worker 中误导 4 处。本期 wrangler.jsonc 已清洗(orchestrator-auth + orchestrator-core 各 2 处)。GLM 是 4 位中唯一独立命中此项 docs-fix 的。
3. **R6 AuthSnapshotSchema team_uuid 语义裂缝命中**: 4 位中唯一显式指出"contract 必填 vs runtime fallback"的语义不对齐 — 本期 `AuthSnapshotSchema` 已加详细 schema 注释说明 auth-worker 出口必填(claim-backed)+ legacy claims optional 由 orchestrator-core ingress deploy-fill 兜住的实际语义。**这条 finding 解决了一个真实跨包契约理解陷阱**。

#### 7.2.2 短板

1. **未识别 closure ALL-DONE 治理漂移为 blocker**: closure §0/§1.6/§13 标 ALL-DONE,但 §4.1/§4.2/§7 列出 publish/deploy/live e2e/P3-05 翻转待办 — GPT-R1 + DeepSeek-R1+R4 + Kimi-R3 都把这个不一致标为 blocker 触发 closure 全文重写,GLM 整份 review 没识别该问题。R9 提到 P3-05 状态,但归类为 `low / scope-drift / no-blocker`,严重性低估。**这是 4 位中唯一对 closure 治理漂移失声的 reviewer**。
2. **代码层细粒度缺陷命中数偏低**: 10 个 finding 中只有 R5(D1 注释)+ R6(team_uuid 注释)2 项进入代码 fix 范围;无 caller enum / idempotency / 边界检查 / parity log 类发现。Kimi 在同一份 codebase 上独立命中 4 个;GLM 落后。
3. **`approve` verdict 与实际状态偏离**: 事后 owner 授权后真实部署 + cross-e2e 9/14 pass + 5 fail 中 3 个真 deploy-only bug + closure 全文重写 — 实际状态远未到 `approve` 阈值。GLM 的 `yes-with-followups` 让本轮 review 失去了"逼出真诚实"的杠杆,如果 owner 只看 GLM 这份 review,closure 就不会被重写。

---

### 7.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|---|---|---|---|---|
| GLM-R1 (envelope 三形态并存) | medium | `true-positive + deferred` | `good` | type 收敛留 ZX3;closure §5 R19 + §1.7 已加诚实表述。 |
| GLM-R2 (JWT 重复) | low | `true-positive + deferred` | `good` | shared package 抽取留 ZX3;closure §5 R20。 |
| GLM-R3 (error code 同步) | medium | `true-positive + deferred` | `good` | 跨包穷尽断言留 ZX3;closure §5 R21。 |
| GLM-R4 (publish 未完成) | medium | `unblocked-2026-04-27 / partially-stale` | `mixed` | 同 GPT-R2;rollout 验证不需要 republish。 |
| GLM-R5 (D1 placeholder 注释) | low | `true-positive`,本期已闭合 | `excellent` | 4 个 wrangler 注释已清洗。`4 位中唯一独立命中`。 |
| GLM-R6 (team_uuid 语义裂缝) | medium | `true-positive`,本期已闭合 | `excellent` | `AuthSnapshotSchema` 加 schema 注释说明语义。`4 位中唯一独立命中`。 |
| GLM-R7 (e2e 覆盖窄) | medium | `true-positive`,本期已部分闭合 | `good` | owner 授权后 cross-e2e 已实跑 9/14 pass(见 GPT review §6.5b)。 |
| GLM-R8 (demo password 硬编码) | low | `acknowledged-as-demo-state` | `mixed` | demo 阶段允许;上线前移除。但 `low / security` 分类略低 — 如果上线前忘记,是真 security risk。 |
| GLM-R9 (internal-http-compat 未移除) | low | `true-positive` | `weak` | 严重级别低估 — closure 把 P3-05 标为 ALL-DONE 而代码未翻转,Kimi/GPT/DeepSeek 都标 high 或 critical;GLM 标 `low / scope-drift / no` 是 4 位中最宽松的判断。 |
| GLM-R10 (ZX1 文件名 typo) | low | `true-positive + deferred` | `good` | 同 GPT-R7;rename 会破坏 cross-doc 引用,留 ZX3 一并 alias。 |

> 10 项 finding 中 7 项 true-positive,2 项独立命中(R5+R6),1 项 mixed(R4 部分 stale),1 项 weak-calibration(R9 严重性低估)。**跨包健康度命中率优秀,但 closure 治理 + verdict 校准失声是结构性短板**。

---

### 7.4 多维度评分(单项满分 10)

| 维度 | 评分 | 说明 |
|---|---|---|
| 证据链完整度 | `8` | 所有 finding 带 file:line;§5.2 跨包版本对齐表是独有亮点。 |
| 判断严谨性 | `6` | R9 把 closure 标 ALL-DONE 而代码未翻转的根本不一致归为 `low / no-blocker`,显著低估 — 同期 GPT/DeepSeek/Kimi 都标 high/critical。`严谨性是 4 位中最低`。 |
| 修法建议可执行性 | `7` | R5+R6 docs-fix 直接落地;但 R1+R2+R3 多为"ZX3 收敛"式建议,实现者难以本期 act on。 |
| 对 action-plan / design / QNA 的忠实度 | `7` | §3 In-Scope 16 done / 1 partial 偏乐观,Kimi 同一对账给出 7 partial — 区别在 GLM 接受了 closure 的"已完成"声称,Kimi/GPT/DeepSeek 没接受。这是"忠实于 closure 表述 vs 忠实于代码事实"的二选一冲突。 |
| 协作友好度 | `9` | tone 最积极;`approve-with-followups` 鼓励向前推进;ZX3 候选清单清晰,实现者好 plan ZX3。 |
| 找到问题的覆盖面 | `6` | 跨包健康度覆盖最广,但 closure 治理 + 代码层细粒度缺陷 + deploy-only bug(R28/R29 类型)三类都未触及。 |
| 严重级别 / verdict 校准 | `5` | `approve + yes` 与 GPT/DeepSeek/Kimi `no` 或 `yes-with-blockers` 形成对立 — 事后看 closure 确需重写,GLM 校准偏低。`校准在 4 位中倒数第 1`。 |

**加权总分: `7.0 / 10`**(跨包架构视角第 1,closure 治理稽查 + verdict 校准最弱)

---

### 7.5 与其他 reviewer 的横向定位

| 比较维度 | GLM vs 其他 reviewer |
|---|---|
| 跨包架构视角 | **第 1**(envelope 三形态 + JWT 重复 + error code 同步 + 跨包版本对齐表 — 唯一系统扫描) |
| 独立命中数 | 第 2(R5+R6 共 2 项;DeepSeek 2 项 R5/R6;Kimi 4 项;GPT 1 项) |
| closure 治理漂移敏锐度 | **第 4**(GPT R1 critical / DeepSeek R1+R4 high / Kimi R3 high / GLM R9 low) |
| verdict 严苛度 | **第 4**(GPT/DeepSeek `no`;Kimi `yes-with-blockers`;GLM `yes` 最宽松) |
| 代码层缺陷命中数 | 第 3(2 项;Kimi 4;DeepSeek 2;GPT 1) |
| 跨阶段深度分析 | 第 3(§5 跨阶段表覆盖 Z0-Z5 + ZX1-ZX2,但深度浅于 DeepSeek §5) |
| ZX3 候选清单清晰度 | **第 1**(§6 follow-up 7 条逐项可 plan) |

> 在 4 位中,GLM 是"approve-friendly 全面健康度盘点"角色,跨包视角最系统但 closure 治理 + verdict 校准失声。如果只看 GLM 这份 review,closure 就不会被重写,整个 ZX2 会以 `final-closed` 状态进入 ZX3 — 而事后真部署 + e2e 9/14 + 3 个真 deploy-only bug 表明 closure 必须重写。**GLM 不适合作为唯一 reviewer,但作为"跨包架构债务"维度的补充非常有价值**。

---

*本评估由 ZX1-ZX2 实现者 + rollout 执行者(Opus 4.7,2026-04-27)在完成 owner 授权后真实部署 + cross-e2e 9/14 pass 后撰写。评估基础是真实 fix yield + 真实部署结果,不是单凭 review 文档自身的言辞。*
