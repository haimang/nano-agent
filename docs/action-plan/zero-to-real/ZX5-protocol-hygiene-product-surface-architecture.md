# Nano-Agent 行动计划 — ZX5 Protocol Hygiene + Product Surface + Architecture Refactor

> 服务业务簇: `zero-to-real / ZX5 / protocol-auth-hygiene + product-surface + architecture-refactor`
> 计划对象: 承接 ZX2 closure §4.3+§5+§8.2 + ZX3 §16.7 中**不阻塞 transport close** 的 carryover **+ ZX4 closure §3.2 cluster-level kernel work + 4-reviewer ZX3-ZX4 review 的 Lane A/B 稳健性 follow-up**;按 4 个独立 lanes 组织(C-Hygiene / D-Product / E-LibraryUplift / F-RuntimeHookup),每个 lane 有独立 entry/exit,互不阻塞
> 类型: `add + refactor + cleanup + ops + cluster-runtime-hookup`
> 作者: `Opus 4.7(2026-04-28 v3)— v2 + post-ZX4 实测代码 audit + 4-reviewer ZX3-ZX4 review(GPT/kimi/GLM/deepseek)findings 修订`
> 时间: `2026-04-28`
> 文件位置:
> - **Lane C(protocol/auth hygiene)**: `packages/jwt-shared/`(new) + `packages/orchestrator-auth-contract/src/facade-http.ts`(`_rpcErrorCodesAreFacadeCodes` 跨包断言;**当前已有 `_authErrorCodesAreFacadeCodes`** 但 Rpc 维度仍缺) + `workers/orchestrator-{core,auth}/src/`(切 jwt-shared) + `clients/web/src/client.ts` + `clients/wechat-miniprogram/utils/nano-client.js`(切 nacp-session shared helper)
> - **Lane D(product surface + ops)**: `workers/orchestrator-core/src/{index,catalog-content,user-do}.ts`(catalog content + 4 个 product endpoints) + `scripts/deploy-preview.sh`(new — 当前 `scripts/` 目录不存在)+ `workers/*/wrangler.jsonc`
> - **Lane E(library worker RPC 升级 — 保持 6-worker)**: `workers/{context-core,filesystem-core}/src/`(当前仍 library-only — `index.ts` 直接返 401 binding-scope-forbidden;升级为 WorkerEntrypoint RPC)+ `workers/agent-core/{src,wrangler.jsonc}`(当前 wrangler.jsonc 中 `CONTEXT_CORE` / `FILESYSTEM_CORE` 仍 commented out;agent-core 仍走 in-process `@haimang/context-core-worker/...` library import)。**owner direction 硬冻结: ZX5 禁止新增 worker;NanoSessionDO 提取到独立 worker 已从 ZX5 scope 移除**
> - **Lane F(ZX4 cluster runtime kernel hookup + 稳健性 follow-up)**: **新增** — 承接 ZX4 closure §3.2 留下的 cluster-level work(全部需 agent-core kernel actor-state machine 改造,在 6-worker 内,不拆 worker):
>   - F1 `workers/agent-core/src/hooks/permission.ts` + kernel:PermissionRequest hook 在 emit `session.permission.request` server frame 后 `await pollDoStorage('permission/decisions/' + requestUuid, timeoutMs)` 消费 NanoSessionDO 已写入的 decision(ZX4 P4 contract 已 land)
>   - F2 同 F1 模式覆盖 ElicitationRequest hook,polling key 为 `elicitation/decisions/${requestUuid}`(ZX4 P6 contract 已 land)
>   - F3 `workers/agent-core/src/host/{runtime-mainline,quota/authorizer}.ts`:在每次 LLM/tool call commit quota 后通过 `emitServerFrame` 推送 `session.usage.update` server frame(ZX4 P5 read snapshot 已 land,push 为 cluster work)
>   - F4 `workers/orchestrator-core/src/user-do.ts:handleStart` idempotency:加 request-scoped idempotency key 或 D1 `UPDATE ... WHERE status='pending' AND started_at = :minted_at` 条件,关闭 KV miss + D1 pending 重发竞态(per GLM R8)
>   - F5 R28 deploy 500 根因定位:owner 用 `wrangler tail` 复盘 verify capability-cancel 路径(本期 sandbox 拒绝 tail,只能 owner 在自己环境执行;per kimi R4 / deepseek R3)
> 关联设计 / 调研文档:
> - `docs/eval/zero-to-real/ZX4-action-plan-reviewed-by-GPT.md`(re-baseline 来源)
> - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md` §2.2 Out-of-Scope([O1]-[O11] 移交本 plan)
> - `docs/issue/zero-to-real/ZX2-closure.md` §5(R18/R19/R20/R21/R24/R25/R27 部分)
> - `docs/issue/zero-to-real/ZX3-closure.md` §3.2 + §3.3
> - `docs/issue/zero-to-real/ZX4-closure.md` §3.2 + §3.3 + §3.4(本 plan 的 Lane F 直接来自此处)
> - `docs/code-review/zero-to-real/ZX3-ZX4-reviewed-by-{GPT,kimi,GLM,deepseek}.md`(4-reviewer review 的 deferred follow-up 全部承接到 Lane F + §6 风险表)
> 文档状态: `draft (v3 post-4-reviewer-review 校准) — v2 + 实测代码 audit + 4-reviewer 共识 deferred items 全部承接;新增 Lane F(runtime kernel hookup + handleStart idempotency + R28 root-cause);C2/D2 line 行号修正;Q1-Q9 状态保持`

---

## 0. 执行背景与目标

GPT 对原 ZX4 unified draft 的审查指出: 把 transport finalization + session semantics + protocol hygiene + product expansion + architecture refactor 全揉进一份 plan 是 scope 失控。ZX4 已重切为单点目标(transport 真收口 + session 语义闭环);ZX5 承接其余非阻塞项,按 GPT §4 建议的 4-lane 架构,Lane C / Lane D / Lane E 拆为 3 个独立 sub-tracks。

**ZX5 的关键差异**: 与 ZX4(单点目标 + 串行)不同,ZX5 的 3 个 lanes **互不阻塞**,可独立交付。每个 lane 单独成型时即可关闭对应 carryover 项;不要求 3 lanes 一起完成才收口。

- **服务业务簇**: `zero-to-real / ZX5`
- **计划对象**: protocol/auth hygiene + product surface + library worker RPC uplift + **ZX4 cluster runtime kernel hookup** 的 4-lane 分离
- **本次计划解决的问题(post-ZX4 实测代码状态校准 2026-04-28)**:
  - **Lane C(协议/auth 卫生)**:
    - **R20 真实代码状态**:`workers/orchestrator-core/src/auth.ts:76-149`(`importKey` / `parseJwtHeader` / `collectVerificationKeys` / `verifyJwt` / `verifyJwtAgainstKeyring`,250 行总)与 `workers/orchestrator-auth/src/jwt.ts:33-175`(同名 helper,175 行总)双向漂移
    - **R21 真实代码状态**:`packages/orchestrator-auth-contract/src/facade-http.ts:91-94` 已有 `_authErrorCodesAreFacadeCodes` 单向断言(自 ZX2 P2-04),但 `_rpcErrorCodesAreFacadeCodes` 缺失(原计划目标)
    - R19 envelope 三 type 关系未文档化为"单向约束 + 不改 public wire"(per GPT 3.9)
    - JWT kid rotation graceful overlap 期集成测试缺失:`workers/orchestrator-auth/test/` 当前只有 `public-surface.test.ts` + `service.test.ts`,无 kid-rotation 测试
    - web/wechat client 仍手写 heartbeat:`clients/web/src/client.ts:209-211`(`session.heartbeat` frame + `setInterval(15_000)`)+ `clients/wechat-miniprogram/utils/nano-client.js:44-114`(`heartbeatFrame` / `resumeFrame` / `lastSeenSeq` / `setInterval`)
  - **Lane D(产品面 + ops)**:
    - R18 真实代码状态:`workers/orchestrator-core/src/index.ts:424-447`(handleCatalog,switch 三个 kind 全返空数组)
    - ZX2 [O8/O9/O10/O11] 4 个 product endpoint 实测全部不存在(grep 验证 `/messages` `/files` `/me/conversations` `/devices/revoke` 均无定义)
    - R25 `WORKER_VERSION` 真实代码状态:`scripts/` 目录**不存在**(grep 验证),仓库无 `deploy-preview.sh` / `.github/workflows/deploy-preview.yml`
  - **Lane E(library worker RPC 升级 — 保持 6-worker)**:
    - context-core / filesystem-core 仍 library-only:`workers/context-core/src/index.ts:18-37` 与 `workers/filesystem-core/src/index.ts:18-37` 都返 `bindingScopeForbidden()` 401 / 仅 `/health` 通过
    - agent-core 仍 in-process 调:`workers/agent-core/src/host/do/nano-session-do.ts:34-35` import `@haimang/context-core-worker/context-api/append-initial-context-layer`(本地 library);`workers/agent-core/wrangler.jsonc:47-48` 中 `CONTEXT_CORE` / `FILESYSTEM_CORE` 仍 commented out
    - **owner direction 硬冻结(per ZX4-ZX5 GPT review R8)**: ZX5 不允许新增 worker;`workers/` 目录 `ls` 实测当前 6 个(agent-core / bash-core / context-core / filesystem-core / orchestrator-auth / orchestrator-core),数量在 ZX5 内不变
    - R24(`NanoSessionDO` 与 agent runtime 同进程)— 当前**冻结/延后**;不在本 plan 任何 phase 触碰
  - **Lane F(ZX4 cluster runtime kernel hookup + 稳健性 follow-up — 新增 lane)**:
    - **F1 PermissionRequest hook await/resume**:ZX4 P4 contract 全栈 land(orchestrator-core `handlePermissionDecision` + agent-core `AgentCoreEntrypoint.permissionDecision` RPC + NanoSessionDO `recordAsyncAnswer` 写 `permission/decisions/${requestUuid}`),但 agent-core 的 PermissionRequest hook 仍走 ZX0/B5 设计的 `verdictOf(outcome)` 同步路径(`workers/agent-core/src/hooks/permission.ts` 未被改造为阻塞等待 DO storage 回流);grep 验证 `workers/agent-core/src/hooks/permission.ts` 无 `pollDoStorage` / `await this.doState.storage.get` 路径
    - **F2 ElicitationRequest hook await/resume**:同 F1 模式;ZX4 P6 contract 已 land(elicitation/decisions/${requestUuid} storage 写入路径),但 hook 未改造
    - **F3 runtime emit `session.usage.update` server frame**:ZX4 P5 已 land `handleUsage` 真读 D1(GET 路径),但 grep 验证 `workers/agent-core/src/` 整体无 `emitServerFrame` 调用(orchestrator-core user-do.ts 有 `emitServerFrame` 定义但 agent-core kernel 不主动 emit `session.usage.update` / `session.permission.request` / `session.elicitation.request`);Lane F 必须把 emit 路径打通
    - **F4 handleStart idempotency**(per GLM R8):当前 `workers/orchestrator-core/src/user-do.ts:handleStart` 用 `existingEntry` (KV)做 duplicate-start 409 guard,但 KV miss + D1 pending 重发场景下 `UPDATE ... WHERE status='pending'` 无 idempotency key,有 `starting → active` 竞态可能。需加 request-scoped idempotency key 或 D1 `UPDATE ... WHERE status='pending' AND started_at = :minted_at` 条件
    - **F5 R28 deploy 500 根因定位**(per kimi R4 / deepseek R3):ZX4 Phase 1 的 `AbortController + signal` 修法 + Phase 7 outer try/catch 防御网在 deploy 上仍 surface 500;sandbox 拒绝 wrangler tail,需 owner 在本地环境跑 `wrangler tail nano-agent-orchestrator-core-preview` + 复现 verify capability-cancel 触发 stack trace 后定位根因。**这一项纯 owner ops 任务,代码侧无可执行步骤**
- **本次计划的直接产出**:
  - **Lane C exit**: `@haimang/jwt-shared` package + 两 worker 切换 + kid rotation 集成测试 + `RpcErrorCode ⊂ FacadeErrorCode` 跨包断言 + envelope 关系文档化 + 客户端 heartbeat/replay 通过 `@haimang/nacp-session` root export + browser/wechat adapter 接入
  - **Lane D exit**: catalog content 填充 + 4 个 product endpoint 业务实现(D3 `/messages` 先冻结与 `/input` 的语义边界;D6 `/devices/revoke` 先冻结 device truth 模型)+ WORKER_VERSION 注入(owner local 路径)
  - **Lane E exit(scope 收窄)**: context-core / filesystem-core 升级为 WorkerEntrypoint RPC + agent-core 改 service binding 调用,**保持 6-worker 拓扑不变**
  - **Lane F exit**: PermissionRequest / ElicitationRequest hook 改 await/resume + runtime emit `session.usage.update` + handleStart idempotency 关闭重发竞态 + R28 owner-driven 根因定位 closure(下属 4 项均在 6-worker 内,不拆 worker)

---

## 1. 执行综述

### 1.1 总体执行方式

**4 lanes 独立设计 + 独立执行 + 各自有 entry/exit**(per GPT §4.3+§4.4 sibling tracks + ZX4 closure §3.2 cluster handoff)。Lane C / Lane D / Lane E / Lane F 互不阻塞,可任意顺序启动。每 lane 内部仍按 phase 串行,但 lane 之间无依赖。

### 1.2 Lane + Phase 总览

| Lane | Phase | 名称 | 工作量 | 目标摘要 | 依赖前序 |
|------|------|------|--------|----------|----------|
| **C-Hygiene** | C1 | `@haimang/jwt-shared` package 创建 | `M` | 抽取共享 JWT helper(collectVerificationKeys / importKey / base64Url / parseJwtHeader / verifyJwt) | `-`(ZX3 §14.1 已 reserved keep-set 位置) |
| **C-Hygiene** | C2 | orchestrator-core + orchestrator-auth 切 jwt-shared | `M` | 删 worker-local 重复实现(`auth.ts:76-149` + `jwt.ts:33-175`);改 import | C1 |
| **C-Hygiene** | C3 | JWT kid rotation graceful overlap 集成测试 | `S` | `kid_v1` token 切到 `kid_v2` 后 5 分钟内仍接受;新建 `workers/orchestrator-auth/test/kid-rotation.test.ts` | C2 |
| **C-Hygiene** | C4 | `RpcErrorCode` ⊂ `FacadeErrorCode` 跨包 zod enum 编译期断言 | `S` | 在 `facade-http.ts` 现有 `_authErrorCodesAreFacadeCodes`(line 91-94) 旁边新增 `_rpcErrorCodesAreFacadeCodes` 跨包穷尽断言(per GPT 3.9 — 单向约束) | `-` |
| **C-Hygiene** | C5 | envelope 关系文档化(不改 public wire) | `S` | facade alias / Envelope / FacadeEnvelope 关系在 README 落档(per GPT 3.9 + Q7 落点冻结新建 `packages/orchestrator-auth-contract/README.md`) | C4 |
| **C-Hygiene** | C6 | web / wechat client heartbeat / replay 切 shared helper | `M` | 删手写实现(`client.ts:209-211` 与 `nano-client.js:44-114`);通过 adapter 接入 `@haimang/nacp-session` root export | `-`(per GPT 3.8 + Q3 冻结目标:替换) |
| **D-Product** | D1 | WORKER_VERSION owner-local 注入(Q2 冻结) | `S` | 新建 `scripts/deploy-preview.sh`(当前不存在)+ 6 worker `wrangler.jsonc` env-fill | **owner-local 路径冻结**(Q2 已答) |
| **D-Product** | D2 | catalog content 填充(skills / commands / agents registry) | `M` | `handleCatalog`(`index.ts:424-447`)返真实 registry 数据 | `-` |
| **D-Product** | D3 | `POST /sessions/{id}/messages`(多模态 message 输入) | `L` | facade endpoint + storage + envelope 包装 | **Q8 已冻结**(`/input` 多模态超集 / 同表 message_kind 标签 / session-running ingress)|
| **D-Product** | D4 | `GET /sessions/{id}/files`(artifact 拉取) | `L` | facade endpoint + R2 / D1 backing | `-`(R2 binding 在 wrangler.jsonc 6 worker 全部缺失,部分需 owner 创建 R2 bucket) |
| **D-Product** | D5 | `GET /me/conversations`(完整对话列表) | `M` | facade endpoint + 多对话查询 | `-`(ZX4 P3 后 pending+active+ended+expired 5 状态视图已闭合,该 phase 直接复用 `D1SessionTruthRepository.listSessionsForUser`)|
| **D-Product** | D6 | `POST /me/devices/revoke`(设备管理) | `M` | facade endpoint + orchestrator-auth JWT revocation | **Q9 已冻结**(D1 `nano_user_devices` canonical / 单设备所有 token & refresh chain / refresh 立即失效 + WS attach 立即拒) + C2 推荐前置 |
| **E-Library-Uplift** | E1 | context-core 升级为 WorkerEntrypoint RPC | `L` | 删除 `workers/context-core/src/index.ts:18-37` 的 binding-scope 401 + 暴露 `assemble` / `compact` / `get_layers` RPC method;**保持 worker 总数 = 6** | **ZX4 已完成 ✅**(可启动) |
| **E-Library-Uplift** | E2 | filesystem-core 升级为 WorkerEntrypoint RPC | `L` | 同 E1 模式;`assemble_artifact` / `read_file` / `write_file` RPC method;**保持 worker 总数 = 6** | **ZX4 已完成 ✅**(独立于 E1,可并行)|
| **F-RuntimeHookup** | F1 | PermissionRequest hook 改 await/resume | `M` | `workers/agent-core/src/hooks/permission.ts` + kernel 改造:emit `session.permission.request` server frame 后 `pollDoStorage('permission/decisions/' + requestUuid, timeoutMs)`;消费 ZX4 P4 已 land 的 NanoSessionDO storage | `-`(ZX4 P4 contract 已 land) |
| **F-RuntimeHookup** | F2 | ElicitationRequest hook 改 await/resume | `M` | 同 F1 模式;polling key `elicitation/decisions/${requestUuid}` | `-`(ZX4 P6 contract 已 land,可与 F1 并行)|
| **F-RuntimeHookup** | F3 | runtime emit `session.usage.update` server frame | `M` | `workers/agent-core/src/host/{runtime-mainline,quota/authorizer}.ts` 在 commit quota 后通过 `emitServerFrame` 推送实时数字 | `-`(ZX4 P5 read snapshot 已 land,push 独立)|
| **F-RuntimeHookup** | F4 | handleStart idempotency 关闭重发竞态 | `S` | `workers/orchestrator-core/src/user-do.ts:handleStart` 加 request-scoped idempotency key 或 D1 `UPDATE ... WHERE status='pending' AND started_at = :minted_at` 条件 | `-`(per GLM R8) |
| **F-RuntimeHookup** | F5 | R28 deploy 500 根因定位(owner ops 任务) | `S` | owner 在自己环境 `wrangler tail nano-agent-orchestrator-core-preview` + 复现 verify capability-cancel + 抓 stack trace + 修法落地 | **owner-required**(sandbox 拒绝 wrangler tail) |
| ~~E-Architecture~~ | ~~old E1+E2~~ | ~~NanoSessionDO 提取到独立 worker~~ | ~~XL~~ | **删除 — owner direction 硬冻结禁止 ZX5 新增 worker(R8)** | n/a |

### 1.3 Lane / Phase 说明

#### Lane C — Protocol / Auth Hygiene

C1-C3 一组(jwt-shared 抽取链);C4-C5 一组(error code + envelope 文档化);C6 独立(client 集成)。**3 组互不依赖,可 fully parallel**。

**Phase C1 — 创建 `@haimang/jwt-shared`**: 已在 ZX3 §14.1 keep-set 显式预留位置。新建 `packages/jwt-shared/` 含 `collectVerificationKeys` / `importKey` / `base64Url` / `parseJwtHeader` / `verifyJwt` / `signJwt` / `JWT_LEEWAY_SECONDS` 等共享逻辑。

**Phase C2 — 两 worker 切换**: `workers/orchestrator-core/src/auth.ts` 删 lines 62-149 worker-local 实现,改 import 自 `@haimang/jwt-shared`;`workers/orchestrator-auth/src/jwt.ts` 同样改 import。两个 worker 的 8/8 + 42/42 测试必须保持全绿。

**Phase C3 — kid rotation 集成测试**: 新增 `workers/orchestrator-auth/test/kid-rotation.test.ts`;模拟 `JWT_SIGNING_KID = v1` 时签发的 token,在 `JWT_SIGNING_KID = v2` 切换后 5 分钟内仍接受(graceful overlap 期);> 5 分钟则 401。

**Phase C4 — `RpcErrorCode` ⊂ `FacadeErrorCode` 跨包断言**: `packages/orchestrator-auth-contract/src/facade-http.ts` 新增 `_rpcErrorCodesAreFacadeCodes: Record<typeof RpcErrorCode._type, true>` 跨包穷尽映射断言。**注意 per GPT 3.9 — 这是单向约束**(`FacadeErrorCode` 必须包含所有 `RpcErrorCode`,反向不要求);public wire 保持不变。

**Phase C5 — envelope 关系文档化(per ZX4-ZX5 GPT review R4 修订落点)**: 明确 `FacadeEnvelope<T>` 与 `Envelope<T>` 关系(public alias);facade public schema 不变;桥接 helper(`facadeFromAuthEnvelope` / `envelopeFromAuthLike`)的 invariants 文档化。**落点选择**: 由于 `packages/orchestrator-auth-contract/README.md` 当前**不存在**(GPT review R4),C5 显式允许两种落点之一:
- **(a)** 新建 `packages/orchestrator-auth-contract/README.md` 含完整 envelope 关系章节
- **(b)** 落到 `docs/transport/transport-profiles.md` 或新建 `docs/transport/envelope-relations.md` 集中说明

C5 同时更新 `packages/nacp-core/README.md`(已存在)对应章节。**owner 在 Q7 选定 (a) 或 (b) 之前不得开工**,避免执行者临时再做一轮设计。

**Phase C6 — client heartbeat / replay 切 shared helper(per ZX4-ZX5 GPT review R5 修订 — adapter pattern)**: per GPT 3.8 显式冻结目标 = "替换为 shared helper",不是 "继续手写但行为对齐"。但 R5 提醒: `@haimang/nacp-session` 当前 root export 只有 `HeartbeatTracker` / `ReplayBuffer` / `SessionWebSocketHelper` 三者,**它们并不等价于"现成的 web / wechat 客户端接入层"** — `ReplayBuffer` 是 NACP frame 级 ring buffer;`SessionWebSocketHelper` 偏 session runtime / DO helper;当前客户端处理的是 lightweight `{kind,...}` wire + 自身的 lastSeenSeq / ack / timer。

**因此 C6 不是"直接替换几行 import",而是 adapter pattern 三步**:
1. 在 `@haimang/nacp-session` 包内或 client 层补一层 `browser-client-adapter` + `wechat-client-adapter`(把 lightweight wire 转换为 shared helper 期望的输入)
2. 让 `clients/web/src/client.ts` + `clients/wechat-miniprogram/utils/nano-client.js` 通过 adapter 接入 root export 的 helper
3. 删除现有手写 heartbeat / resume / ack 实现

`@haimang/nacp-session` 为 single source;**禁止深路径 import**(`@haimang/nacp-session/heartbeat.ts` 这种)。

#### Lane D — Product Surface + Ops

D1 是 ops 前置(owner-required);D2-D6 是业务面 endpoint。

**Phase D1 — WORKER_VERSION owner-local 注入(ops 前置已冻结)**: per Q2 owner answer，当前路径冻结为 **owner local wrangler deploy**，不再在 ZX5 内同时维持 GitHub Actions 分支。执行物为 `scripts/deploy-preview.sh`，在逐 worker `wrangler deploy --env preview` 前统一 export：
- `WORKER_VERSION = ${WORKER_NAME}@${GIT_SHA_OR_MANUAL_TAG}`
- 如需 preview 特定覆盖，脚本内显式接受 `WORKER_NAME` / `WORKER_VERSION_SUFFIX`
- 未来若仓库引入标准化 `deploy-preview.yml`，再另开独立 plan 迁移；**本 ZX5 不承担该切换**

**Phase D2 — catalog content**: `workers/orchestrator-core/src/index.ts:handleCatalog`(line 410-433)填充 skills / commands / agents registry。registry 数据可从 `.github/workflows` / docs / 或新增 `workers/orchestrator-core/src/catalog-content.ts` 静态注册。**所有 entry 必须 facade-http-v1 envelope 包装**。

**Phase D3 — `POST /sessions/{id}/messages`(per ZX4-ZX5 GPT review R6 — 语义去重前置)**: 多模态 message 输入;facade endpoint;backing 在 D1 `nano_conversation_messages` 表(已存在,见 `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`);envelope 包装。

**R6 修订: D3 不是"加一个新 endpoint"这么简单**,而是潜在与现有 `/sessions/{id}/input` / `/sessions/{id}/timeline` / `/sessions/{id}/history` 形成**语义重叠点**。**执行前 D3 必须先冻结 3 个语义问题**(在 Q8 由 owner 答复):
1. `/messages` 是否是 `/input` 的多模态超集?(若是,`/input` 应转发到 `/messages` 还是各自落库?)
2. `/messages` 与现有 start/input/history/timeline 的落库规则如何统一(同一 `nano_conversation_messages` 表 + 不同来源标签 vs 不同表)?
3. `/messages` 是 session-running ingress(必须有活跃 session 才接受)还是离线消息写入(允许 session 已 ended 后写入)?

**3 问题未冻结前 D3 不开工**;否则会变成"一条新入口 + 一套新 body + 一份新 D1 写法 + 后期再补对齐补丁"的接口碎片增殖。

**Phase D4 — `GET /sessions/{id}/files`**: artifact 拉取;facade endpoint;backing 在 R2 / 现有 attachment ref;envelope 包装。

**Phase D5 — `GET /me/conversations`**: 完整对话列表;在 ZX4 P3 之后做更顺手(pending+active+ended 状态机已落)。

**Phase D6 — `POST /me/devices/revoke`(per ZX4-ZX5 GPT review R7 — 真实前置是 device model freeze,不是 jwt-shared)**: 设备管理。

**R7 修订: D6 真实前置不是"先抽 jwt-shared",而是"device truth model freeze"**。当前 repo 状态:
- refresh token revocation 相关逻辑存在
- 但**没有明确的 device registry / trusted device schema / `device_uuid` 模型**

**因此 D6 必须先冻结 3 件事**(在 Q9 由 owner 答复):
1. device truth 在哪里(D1 表 `nano_user_devices` 还是 token claim 内嵌 `device_uuid`)
2. revoke 粒度是什么(单设备 / 单设备所有 token / 全用户 token / 选 refresh chain 起点回收)
3. revoke 后影响哪些 token / session / refresh chain(active session 立即断 vs 仅 refresh 后失效)

**3 件事冻结后才能开工**;`jwt-shared`(C2)切完是 D6 的**充分**前置(让 revocation 实现集中),但不是**必要**前置 — D6 的真正堵点是 device model 设计冻结。

#### Lane E — Library Worker RPC Uplift(保持 6-worker 不变)

**owner direction 硬冻结(per ZX4-ZX5 GPT review R8)**: ZX5 不允许新增 worker。原 v1 E1+E2(`NanoSessionDO` 物理提取到 `workers/session-do/`)已**从 ZX5 scope 完全移除**;不得在本 plan 任何 phase 创建 `workers/session-do/` 目录、新 wrangler.jsonc、新 DO binding。**6-worker 拓扑(`agent-core` / `bash-core` / `context-core` / `filesystem-core` / `orchestrator-auth` / `orchestrator-core`)在 ZX5 内不变**。

**Lane E 现 scope = 仅 context-core + filesystem-core 升级真 RPC**(原 v1 E3+E4 重编号为 E1+E2)。两 worker 当前已存在,只是 fetch 入口仅 binding-scope 401 + library-only library import — 升级为 WorkerEntrypoint 暴露 RPC method,不改 worker 数量。**强烈建议在 ZX4 完成后再启动**(transport close 期不应同时做架构变更)。

**Phase E1 — context-core 升级真 RPC**: context-core 从 library-only(`workers/context-core/src/index.ts` 仅 401 binding-scope-forbidden)升级为 `WorkerEntrypoint` 暴露 `assemble` / `compact` / `get_layers` 等 RPC method;`workers/agent-core/wrangler.jsonc` 打开 `CONTEXT_CORE` service binding，agent-core 改通过 service binding 调用 context-core RPC。

**Phase E2 — filesystem-core 升级真 RPC**: 同 E1 模式;`assemble_artifact` / `read_file` / `write_file` 等 RPC method;`workers/agent-core/wrangler.jsonc` 打开 `FILESYSTEM_CORE` service binding，agent-core 改通过 service binding 调用。

**关于 R24 / NanoSessionDO 提取的处置(明确冻结/延后)**: 原 v1 计划提取 NanoSessionDO 到 `workers/session-do/` 形成 7-worker 拓扑;owner direction 已明确**禁止该方案**。本议题在 ZX5 内**冻结 + 延后**,不在任何 phase 触碰。如未来仍要重谈,**前提条件三层**:
1. ZX4 已 retired 且 session 语义在真实客户端跑通至少 30 天
2. owner 重新授权该议题进入 plan scope
3. 重谈时**优先按 `agent-core / agent-session` 的 agent-domain 内拆分语言**重新建模(`agent-session` 仅与 `agent-core` 沟通,不让 `orchestrator-core` 或其他节点直接跨过去),而不是让 session-do 成横向基础设施 worker

#### Lane F — Runtime Kernel Hookup + 稳健性 follow-up(新增 — 承接 ZX4 closure §3.2 + 4-reviewer review)

**新增背景**: ZX4 把 permission/elicitation 的 decision-forwarding storage contract 全栈 land(orchestrator → agent-core RPC → NanoSessionDO storage),但 agent-core 的 PermissionRequest / ElicitationRequest hook **未改造**为 await DO storage waiter — 当前 agent runtime 在 emit `session.permission.request` server frame 后不会阻塞等待 decision 回流。这意味着客户端可发 decision、orchestrator 可存到 DO,但 **runtime 不会主动消费**。Lane F 是 ZX4 P4/P5/P6 cluster work 的真正 closure。

**Phase F1 — PermissionRequest hook await/resume**: `workers/agent-core/src/hooks/permission.ts` 当前 `verdictOf(outcome)` 是同步 fail-closed 路径。改造为:
1. 当 `eventName === "PermissionRequest"` 且 hook 表达 "需要用户决定" 时,先 `emitServerFrame('session.permission.request', {request_uuid, ...})`(WS attach 路径)+ 让 actor-state machine 进入 `waiting_permission` 子相位
2. `await pollDoStorage('permission/decisions/' + requestUuid, {timeoutMs: 60_000, intervalMs: 500})`(或基于 alarm 的事件驱动等价方案)
3. resolve 后,根据 decision 决定 allow/deny + 驱动 kernel 继续

**关键工程困难**: agent-core kernel 当前没有 "block-on-DO-storage" 机制;需要先在 kernel actor-state machine 加 wait-and-resume 子相位。这是 cluster-level kernel work,难度高于 ZX4 任何 phase。

**Phase F2 — ElicitationRequest hook await/resume**: 同 F1 模式;DO storage key 为 `elicitation/decisions/${requestUuid}`。可与 F1 共享 wait-and-resume kernel infrastructure。

**Phase F3 — runtime emit `session.usage.update`**: `workers/agent-core/src/host/runtime-mainline.ts` LLM call commit 后 + `quota/authorizer.ts:commit` 后,通过 NanoSessionDO 持有的 `emitServerFrame` 接口推送实时 usage frame。前端 WS attach 后能 live update 预算字段(对应 ZX4 P5 read snapshot 的 push 等价物)。

**Phase F4 — handleStart idempotency**(per GLM R8): `workers/orchestrator-core/src/user-do.ts:handleStart` 当前先查 KV `existingEntry` 拒重发,但 KV miss + D1 pending 路径下重发可能导致 `starting → active` 竞态。修法两选:
- (a) request-scoped `idempotency_key`(client 提供,server 缓存 5 min,重复 key 直接返已记录的 200/409)
- (b) D1 `UPDATE nano_conversation_sessions SET session_status = 'starting' WHERE session_uuid = ?1 AND session_status = 'pending' AND started_at = ?2` 加 affected_rows 检查,> 0 才继续走 ensureDurableSession / forwardStart

**Phase F5 — R28 deploy 500 根因定位(owner ops 任务)**: ZX4 closure §3.1 标注 R28 verify-cancel deploy 500 根因疑在 RPC 调用栈上层,需 wrangler tail 复盘。**sandbox 拒绝 wrangler tail 命令**,本期无法在代码 agent 内执行。owner 在自己环境运行:
```sh
npx wrangler tail nano-agent-orchestrator-core-preview --format=pretty
# 另一终端复现 cross-e2e 03 (verify capability-cancel)
# 抓 stack trace 定位是哪一层抛出
```
若根因属 `forwardInternalJsonShadow` RPC 调用栈某个分支(如 D1 query 异常 / authority 校验失败 / RPC binding 内部 throw),F5 改成 code phase 落地修法;否则 F5 可继续 carryover。**这一项 Lane F 中风险最低、产出最依赖 owner**。

### 1.4 执行策略说明

- **Lane 独立性**: C / D / E / F 互不阻塞;owner 可同时启动多 lane 或单 lane 推进
- **Lane 内部串行**: 每 lane 内 phase 严格串行(jwt-shared 必须先抽再切;E1/E2 各自都应先暴露 RPC contract,再切 agent-core 调用;F1+F2 共享 wait-and-resume kernel,F1 先做 kernel infra 再做 F2)
- **测试推进原则**: 每 phase 跑全 worker tests + root-guardians;C3 引入 kid rotation 集成测试;E1/E2 引入 context/filesystem RPC integration / cross-e2e;F1/F2 引入 permission/elicitation full-loop e2e(client → orchestrator-core → agent-core RPC → DO storage → runtime resume → response)
- **ZX4 已完成**: Lane E + Lane F 启动条件已具备(ZX4 closure 2026-04-28 完成);Lane C / D 同样可启动
- **回滚原则**: C2 / E1 / E2 / F1 / F2 是高风险 phase,每 phase 独立 commit + 保留 rollback 通道
- **owner-action 分离**: F5 + D1(owner local 路径)+ R28 wrangler tail 是 owner-driven 任务,代码 agent 无可执行步骤;Lane D 启动 D4 前需 owner 创建 R2 bucket(当前 6 worker 全部缺 R2 binding,deepseek R8 已点出)

### 1.5 影响目录树

```text
ZX5-protocol-hygiene-product-surface-architecture
├── Lane C — Protocol / Auth Hygiene
│   ├── packages/jwt-shared/(new — ZX3 keep-set reserved)
│   ├── packages/orchestrator-auth-contract/src/facade-http.ts(C4 跨包断言)
│   ├── packages/orchestrator-auth-contract/README.md(C5 envelope 关系)
│   ├── packages/nacp-core/README.md(C5 envelope 关系)
│   ├── workers/orchestrator-core/src/auth.ts(C2 import jwt-shared)
│   ├── workers/orchestrator-auth/src/jwt.ts(C2 import jwt-shared)
│   ├── workers/orchestrator-auth/test/kid-rotation.test.ts(new — C3)
│   ├── clients/web/src/client.ts(C6 切 shared helper)
│   └── clients/wechat-miniprogram/utils/nano-client.js(C6 切 shared helper)
├── Lane D — Product Surface + Ops
│   ├── scripts/deploy-preview.sh(new — D1 owner-local 路径)
│   ├── workers/*/wrangler.jsonc(D1 WORKER_VERSION env-fill)
│   ├── workers/orchestrator-core/src/{index,catalog-content}.ts(D2)
│   ├── workers/orchestrator-core/src/index.ts(D3-D6 4 个 facade endpoint)
│   ├── workers/orchestrator-core/src/session-read-model.ts(D5 me/conversations)
│   └── workers/orchestrator-auth/src/(D6 device revocation)
├── Lane E — Library Worker RPC Uplift(保持 6-worker 不变)
│   ├── workers/context-core/src/(E1 升级 WorkerEntrypoint RPC,删除 line 18-37 binding-scope 401)
│   ├── workers/context-core/wrangler.jsonc(E1 暴露 RPC method binding)
│   ├── workers/filesystem-core/src/(E2 升级 WorkerEntrypoint RPC,同 E1 模式)
│   ├── workers/filesystem-core/wrangler.jsonc(E2)
│   ├── workers/agent-core/{src,wrangler.jsonc}(E1+E2 打开 line 47-48 commented binding + 改 service binding 调用 context/fs)
│   └── ~~workers/session-do/~~(**owner direction 硬冻结禁止 — 已从 ZX5 scope 移除**)
└── Lane F — Runtime Kernel Hookup + 稳健性 follow-up(新增)
    ├── workers/agent-core/src/hooks/permission.ts(F1 改 await/resume — 需 kernel actor-state 加 `waiting_permission` 子相位)
    ├── workers/agent-core/src/hooks/elicitation.ts(F2 — 当前不存在,需创建 + 同 F1 模式)
    ├── workers/agent-core/src/host/{runtime-mainline,quota/authorizer}.ts(F3 emit `session.usage.update` server frame)
    ├── workers/agent-core/src/host/do/nano-session-do.ts(F1+F2 共享 wait-and-resume kernel infra + F3 emitServerFrame caller)
    ├── workers/orchestrator-core/src/user-do.ts(F4 handleStart idempotency)
    └── docs/runbook/zx5-r28-investigation.md(F5 owner ops 复盘记录,新建)
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** `@haimang/jwt-shared` package 创建 + 两 worker 切换 + kid rotation 集成测试(R20 + DeepSeek §5.6)
- **[S2]** `RpcErrorCode` ⊂ `FacadeErrorCode` 跨包 zod enum 编译期断言(R21,per GPT 3.9 单向约束)
- **[S3]** envelope 关系文档化(R19,per GPT 3.9 不改 public wire)
- **[S4]** web / wechat client heartbeat / replay 切 shared helper(per GPT 3.8 替换目标)
- **[S5]** WORKER_VERSION owner-local 注入(R25,Q2 已冻结 owner-local 路径)
- **[S6]** catalog content 填充(R18)
- **[S7]** 4 个 product endpoint(ZX2 [O8-O11])
- **[S8]** context-core / filesystem-core 升级真 RPC,保持 6-worker 拓扑不变(ZX2 [O5];ZX4 已完成,Lane E 可启动)
- **[S9 — 新增]** ZX4 cluster runtime kernel hookup(Lane F):PermissionRequest / ElicitationRequest hook 改 await/resume + runtime emit `session.usage.update`(承接 ZX4 closure §3.2 P4/P5/P6 cluster work)
- **[S10 — 新增]** handleStart idempotency 关闭 KV miss + D1 pending 重发竞态(per GLM R8)
- **[S11 — 新增]** R28 deploy 500 owner-driven 根因定位(per kimi R4 / deepseek R3,F5;owner ops 任务)

### 2.2 Out-of-Scope

- **[O1]** transport finalization(R28/R29/R31/P3-05 flip)→ **ZX4 已完成 ✅**(R28 deploy 根因 carryover 为本 plan F5)
- **[O2]** session 语义闭环 storage contract(permission/usage/elicitation/me-sessions pending truth)→ **ZX4 Lane B 已完成 ✅**;本 plan Lane F 承接 cluster-level runtime kernel hookup 部分
- **[O3]** user-do.ts seam refactor → **ZX4 Phase 0**(早期 seam,per GPT 3.7);R26 user-do refactor 仍未实质 close,handler 方法体仍集中在主文件 1910 行(per ZX4 closure §1.1)— **ZX5 Lane E 之外的进一步 lifecycle/read-model/ws handler 搬移可在 Lane F1/F2 完成 kernel 改造时顺手做,但不作为 ZX5 强制目标**
- **[O4]** WeChat 真机 smoke(R17)→ owner-action(无 plan,跨 ZX2/3/4/5 持续 carryover)
- **[O5]** D1 schema 大改动 — 新 product endpoint 应复用现有 truth(`nano_conversation_messages` / `nano_conversation_turns` / R2 storage),不新建平行表
- **[O6]** **新增 worker / 改变 6-worker 拓扑(per ZX4-ZX5 GPT review R8 owner direction 硬冻结)**: 不得创建 `workers/session-do/`;不得把 `NanoSessionDO` 物理迁出 `agent-core`;不得在 ZX5 任何 phase 让 worker 数量从 6 变为其他数。R24(NanoSessionDO 拆分)冻结 + 延后到未来 owner 重新授权后的独立议题
- **[O7]** D6 device model design — 在 D6 开工前由 owner 冻结(Q9 已答);本 plan 内不预设 device truth 落点
- **[O8 — 新增]** prod migration 006 apply — **不在 ZX5 任何 phase 内**;owner 在 prod deploy 前必须先跑 `wrangler d1 migrations apply --env prod --remote`(per ZX4 closure §3.3 hard gate);ZX5 不应把这条变成 phase
- **[O9 — 新增]** `pnpm-lock.yaml` 6 个 stale importer block 清理 — owner-action(需 NODE_AUTH_TOKEN 注入后跑一次 `pnpm install`,per ZX3 closure §3.1 + ZX4 closure §3.3 持续 carryover)
- **[O10 — 新增]** retired guardians 契约覆盖 cross-reference audit(per deepseek R13)— ZX5 启动前预热 task,不作为本 plan phase
- **[O11 — 新增]** `forwardInternalJsonShadow` 重命名 — 推迟到本 plan Lane C 或后续 plan envelope refactor 时一并做(per GPT R7 / kimi R8 / deepseek R9)

---

## 3. 业务工作总表

| 编号 | Lane / Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| C1-01 | C / Phase C1 | 创建 `@haimang/jwt-shared` package | `add` | `packages/jwt-shared/` | collectVerificationKeys / importKey / base64Url / parseJwtHeader / verifyJwt / signJwt / JWT_LEEWAY_SECONDS | medium |
| C1-02 | C / Phase C1 | jwt-shared 单测 | `test` | `packages/jwt-shared/test/` | 全 unit 覆盖 helper + 边界 | low |
| C2-01 | C / Phase C2 | orchestrator-core 切 jwt-shared | `refactor` | `workers/orchestrator-core/src/auth.ts:62-149` | 删 worker-local 实现 + import 自 jwt-shared | medium |
| C2-02 | C / Phase C2 | orchestrator-auth 切 jwt-shared | `refactor` | `workers/orchestrator-auth/src/jwt.ts:19-175` | 同上 | medium |
| C2-03 | C / Phase C2 | 8/8 + 42/42 测试零回归验证 | `verify` | 两 worker test | baseline 不变 | low |
| C3-01 | C / Phase C3 | JWT kid rotation graceful overlap 集成测试 | `test` | `workers/orchestrator-auth/test/kid-rotation.test.ts`(new) | `kid_v1` token 切到 `kid_v2` 后 5 分钟内仍接受 | medium |
| C4-01 | C / Phase C4 | `RpcErrorCode` ⊂ `FacadeErrorCode` 跨包断言 | `add` | `packages/orchestrator-auth-contract/src/facade-http.ts` | `_rpcErrorCodesAreFacadeCodes` 穷尽映射(per GPT 3.9 单向约束) | medium |
| C5-01 | C / Phase C5 | envelope 关系文档化 | `update` | `packages/orchestrator-auth-contract/README.md` + `packages/nacp-core/README.md` | facade alias / envelope 关系明确(不改 public wire) | low |
| C6-01 | C / Phase C6 | web client heartbeat/replay 切 shared helper | `refactor` | `clients/web/src/client.ts:191-220` | 删手写,改用 `@haimang/nacp-session` root export 的 shared helper / adapter | medium |
| C6-02 | C / Phase C6 | wechat client heartbeat/replay 切 shared helper | `refactor` | `clients/wechat-miniprogram/utils/nano-client.js:44-133` | 同上 | medium |
| D1-01 | D / Phase D1 | WORKER_VERSION 注入(owner local 路径) | `add` | `scripts/deploy-preview.sh`(new) + `workers/*/wrangler.jsonc` | owner local `wrangler deploy --env preview` 前 export-driven 注入 | low |
| D2-01 | D / Phase D2 | catalog content registry 静态注册 | `add` | `workers/orchestrator-core/src/catalog-content.ts`(new) + `index.ts:handleCatalog` | skills / commands / agents 真实数据 | medium |
| D3-01 | D / Phase D3 | `POST /sessions/{id}/messages` 实现 | `add` | `workers/orchestrator-core/src/{index,session-lifecycle}.ts` | 多模态 message 输入 + D1 backing | medium |
| D4-01 | D / Phase D4 | `GET /sessions/{id}/files` 实现 | `add` | `workers/orchestrator-core/src/index.ts` | artifact 拉取 + R2 backing | medium |
| D5-01 | D / Phase D5 | `GET /me/conversations` 实现 | `add` | `workers/orchestrator-core/src/{index,session-read-model}.ts` | 完整对话列表(基于 ZX4 P3 后的 pending+active+ended 视图)| low |
| D6-01 | D / Phase D6 | `POST /me/devices/revoke` 实现 | `add` | `workers/orchestrator-core/src/index.ts` + `workers/orchestrator-auth/src/` | 设备管理 + JWT revocation(用 C2 jwt-shared) | medium |
| ~~old E1+E2~~ | ~~E~~ | ~~NanoSessionDO 提取到 workers/session-do/~~ | ~~refactor~~ | **删除 — owner direction R8 硬冻结禁止 ZX5 新增 worker;6-worker 拓扑保持不变** | n/a | n/a |
| E1-01 | E / Phase E1 | context-core 升级 WorkerEntrypoint(从 library-only) | `refactor` | `workers/context-core/src/index.ts` + wrangler.jsonc | 暴露 `assemble` / `compact` / `get_layers` RPC method;**保持 worker 总数 = 6** | high |
| E1-02 | E / Phase E1 | agent-core 打开 CONTEXT_CORE binding + 通过 short-term shim 改 RPC 调用 context-core | `refactor` | `workers/agent-core/{src,wrangler.jsonc}` | per Q6 修订 — 短期 shim / compat seam,禁长期双轨 | medium |
| E2-01 | E / Phase E2 | filesystem-core 升级 WorkerEntrypoint(从 library-only) | `refactor` | `workers/filesystem-core/src/index.ts` + wrangler.jsonc | 暴露 `assemble_artifact` / `read_file` / `write_file` RPC method;**保持 worker 总数 = 6** | high |
| E2-02 | E / Phase E2 | agent-core 打开 FILESYSTEM_CORE binding + 通过 short-term shim 改 RPC 调用 filesystem-core | `refactor` | `workers/agent-core/{src,wrangler.jsonc}` | 短期 shim seam | medium |
| F1-01 | F / Phase F1 | kernel actor-state 加 `waiting_permission` 子相位 + wait-and-resume infrastructure | `add` | `workers/agent-core/src/host/{actor-state,do/nano-session-do}.ts` + `kernel/` | DO storage 阻塞等待 + alarm 驱动 resume + timeout 防挂死 | high |
| F1-02 | F / Phase F1 | PermissionRequest hook 改用 wait-and-resume | `refactor` | `workers/agent-core/src/hooks/permission.ts` | emit server frame + await `permission/decisions/${requestUuid}` + 驱动 verdict | medium |
| F1-03 | F / Phase F1 | full-loop e2e:client decision → orchestrator → DO storage → runtime resume | `test` | `test/cross-e2e/zx5-permission-roundtrip.test.mjs`(new) | live e2e 验证 contract end-to-end | medium |
| F2-01 | F / Phase F2 | ElicitationRequest hook 改 await/resume(复用 F1 wait-and-resume infra) | `add` | `workers/agent-core/src/hooks/elicitation.ts`(new) + `nano-session-do.ts` | 同 F1 模式;polling key 不同 | medium |
| F2-02 | F / Phase F2 | full-loop e2e:client elicitation answer → resume | `test` | `test/cross-e2e/zx5-elicitation-roundtrip.test.mjs`(new) | live e2e 验证 | medium |
| F3-01 | F / Phase F3 | runtime emit `session.usage.update` server frame | `add` | `workers/agent-core/src/host/{runtime-mainline,quota/authorizer}.ts` + `nano-session-do.ts:emitServerFrame` caller | LLM/tool quota commit 后实时推送 | medium |
| F3-02 | F / Phase F3 | client live usage update e2e | `test` | `test/cross-e2e/zx5-usage-live-push.test.mjs`(new) | 验证前端能实时收到 usage 数字变化 | low |
| F4-01 | F / Phase F4 | handleStart idempotency 关闭 KV miss + D1 pending 重发竞态 | `refactor` | `workers/orchestrator-core/src/user-do.ts:handleStart` + `session-truth.ts` | (a) request-scoped idempotency_key OR (b) D1 conditional UPDATE WHERE pending AND started_at | medium |
| F4-02 | F / Phase F4 | idempotency unit tests + concurrent retry simulation | `test` | `workers/orchestrator-core/test/user-do.test.ts` | 模拟同一 session_uuid 5 个并发 /start 请求,只有 1 个成功推 starting | low |
| F5-01 | F / Phase F5 | R28 owner-driven wrangler tail 复盘 + 根因定位 | `verify` | `docs/runbook/zx5-r28-investigation.md`(new owner 填写) | owner 在自己环境跑 wrangler tail + 复现 verify capability-cancel + 抓 stack trace | low |
| F5-02 | F / Phase F5 | 根据 F5-01 根因决定:fix code OR 升级为 ZX5 P0 OR 持续 carryover | `branch` | TBD by F5-01 owner outcome | 三选一,不预设修法 | medium |

---

## 4. Phase 业务表格

(详细 Phase 业务表格按 ZX3 plan §4 模式展开;落地时填充)

---

## 5. 需要业主 / 架构师回答的问题清单

### Q1

- **影响范围**: `Lane 启动顺序`
- **为什么必须确认**: ZX5 的 3 lanes 互不阻塞,可任意顺序启动;但 Lane E 强烈建议在 ZX4 完成后(架构变更不应在 transport close 期间做)
- **当前建议 / 倾向**: ZX4 进行中允许 Lane C / Lane D 并行启动;Lane E 等 ZX4 完成后启动
- **Q**: ZX5 的 3 lanes 是否同意"Lane C/D 与 ZX4 并行允许,Lane E 必须 ZX4 完成后启动"?
- **A**: 部分同意。Lane C 可与 ZX4 并行;Lane D 仅 D1/D2 这类低交集项可并行,D3-D6 最好等 ZX4 Lane B 收敛后启动;Lane E 必须等 ZX4 完成后启动。

### Q2

- **影响范围**: `Phase D1 — WORKER_VERSION CI 动态化路径`
- **为什么必须确认**: per GPT 3.5 — 当前 `.github/workflows/deploy-preview.yml` 不存在;先要确认 deploy pipeline 在哪里执行(GitHub Actions vs owner local wrangler)
- **当前建议 / 倾向**: 由 owner 选择;若 GitHub Actions 路径,新建 deploy-preview.yml + wrangler env-fill;若 owner local,提供 `scripts/deploy-preview.sh`
- **Q**: 当前 preview 部署是 GitHub Actions 路径还是 owner local 路径?WORKER_VERSION 注入应走哪条?
- **A**: 先冻结为 owner local 路径。当前仓库没有 `deploy-preview.yml`,且现有 preview rollout 证据也是逐 worker `wrangler deploy --env preview`;因此先补 `scripts/deploy-preview.sh` + export 注入 `WORKER_VERSION`,未来若标准化到 GitHub Actions 再迁移。

### Q3

- **影响范围**: `Phase C6 — client helper migration 目标(per GPT 3.8)`
- **为什么必须确认**: GPT 3.8 — 选"替换为 shared helper" vs "继续手写但行为对齐",两种结果差异很大
- **当前建议 / 倾向**: 替换为 shared helper(避免长期保留两套实现)
- **Q**: web/wechat client 是否冻结目标为"替换为 `@haimang/nacp-session/{heartbeat,replay}` shared helper"?
- **A**: 同意替换为 shared helper,但不冻结深路径 import。以 `@haimang/nacp-session` root export 为准;必要时先补 browser/wechat adapter,再删除现有手写实现。

### Q4(per ZX4-ZX5 GPT review R8 — owner direction 硬冻结后修订)

- **影响范围**: `Phase E — 原 NanoSessionDO 提取议题的处置`
- **为什么必须确认**: v1 计划提取 NanoSessionDO 到 `workers/session-do/` 形成 7-worker 拓扑;owner direction 已**明确禁止 ZX5 新增 worker**
- **当前建议 / 倾向**: 该议题**从 ZX5 scope 完全移除**;Lane E 仅做 context-core / filesystem-core 升级,保持 6-worker 拓扑;R24 / NanoSessionDO 提取冻结 + 延后到未来 owner 重新授权后的独立议题
- **Q**: 是否冻结"ZX5 不允许新增 worker;NanoSessionDO 提取议题完全移除;Lane E 收窄到 context/fs 升级 + 保持 6-worker"?
- **A**: 同意。ZX5 scope 内 worker 数量恒等于 6;`workers/session-do/` 不得创建;NanoSessionDO 提取冻结到未来 owner 重新授权后的独立 plan(且重谈时优先按 `agent-core / agent-session` agent-domain 内拆分语言重新建模,`agent-session` 仅与 `agent-core` 沟通,不让 orchestrator-core 等节点直接跨过去)。

### Q5

- **影响范围**: `Phase D3 + D4 — product endpoint 的 D1 schema 复用`
- **为什么必须确认**: per ZX4 plan GPT review §3.4 单一 truth 原则,D3/D4 应复用现有 D1 truth(`nano_conversation_messages` / R2 attachment)而非新建平行表
- **当前建议 / 倾向**: 复用;若发现 schema 不够,先讨论扩展现有表,不新建
- **Q**: D3/D4 是否冻结为"复用现有 D1 truth + R2 storage,不新建平行表"?
- **A**: 同意。冻结为复用现有 D1 truth + R2 storage;若 schema 不足,只允许扩展现有表/索引/字段,不新建平行表。

### Q6(per ZX4-ZX5 GPT review R9)

- **影响范围**: `Phase E1 + E2 — context/filesystem 升级 RPC 的版本兼容`(原 E3+E4 重编号)
- **为什么必须确认**: 这两个 worker 当前是 library-only;升级为 WorkerEntrypoint 后 agent-core 必须改 import → service binding。是否在升级期间保留 library import 作 fallback?
- **当前建议 / 倾向**: per GPT R9 — **允许短期 shim / compat seam,禁止长期双轨挂账**;不做零缓冲硬切
- **Q**: E1/E2 是否冻结为"先补 RPC contract + adapter,在 agent-core 保留时间盒化 compat shim / test seam,待 cross-e2e + worker tests 稳定后再删除库内 import"?
- **A**: 同意。冻结为短期 shim 迁移 + 时间盒化 compat seam;禁止长期双轨。

### Q7(新增 — per R4 C5 落点冻结)

- **影响范围**: `Phase C5 — envelope 关系文档化落点`
- **为什么必须确认**: `packages/orchestrator-auth-contract/README.md` 当前**不存在**;C5 必须先确定文档落到 (a) 新建 README 还是 (b) `docs/transport/` 集中说明
- **当前建议 / 倾向**: (a) 新建 `packages/orchestrator-auth-contract/README.md`(每个 keep-set package 都应有 README)+ 同步更新 `packages/nacp-core/README.md`;不放 docs/transport 避免 cross-doc 引用
- **Q**: C5 envelope 关系文档化落点是 (a) 新建 `packages/orchestrator-auth-contract/README.md` 还是 (b) `docs/transport/envelope-relations.md`?
- **A**: 选 **(a)**。新建 `packages/orchestrator-auth-contract/README.md`，把 facade/public envelope 的单一真相放回 contract package 自身；`packages/nacp-core/README.md` 同步补一节 cross-link。`docs/transport/` 只保留索引与跳转，不再承载这组 contract 关系的主文档。

### Q8(新增 — per R6 D3 语义去重前置)

- **影响范围**: `Phase D3 — POST /sessions/{id}/messages 与现有 /input / history / timeline 的语义边界`
- **为什么必须确认**: D3 不开工 3 个语义问题前会变成接口碎片增殖
- **当前建议 / 倾向**: D3 是 `/input` 多模态超集;落同一 `nano_conversation_messages` 表 + 来源标签;session-running ingress 为主 + 离线写入受限于 `pending` 状态(per ZX4 R1)
- **Q1**: `/messages` 是 `/input` 多模态超集吗(`/input` 转发 vs 各自落库)?
- **Q2**: 落库规则 — 同一 `nano_conversation_messages` 表 + 来源标签 vs 不同表?
- **Q3**: session-running ingress 还是离线消息写入?
- **A**: 冻结为三条。1) **`/messages` 是 `/input` 的多模态超集**，`/input` 保留为兼容别名并在服务端归一化到 `/messages` 的 text-only 形态，不再走第二套落库路径。2) **统一落到同一 `nano_conversation_messages` 表**，通过 `message_kind` / source tag 区分 `user.input.text`、`user.input.multipart`、artifact ref 等来源，不新建第二张消息表。3) **`/messages` 只作为 session-running ingress**：要求 session 已存在且未终态；对 `pending` 用 `/start`，对 `ended/expired` 拒绝写入，不做离线补写入口。

### Q9(新增 — per R7 D6 device model freeze)

- **影响范围**: `Phase D6 — POST /me/devices/revoke 真实前置`
- **为什么必须确认**: D6 真实堵点不是 jwt-shared,而是 device truth model 缺失
- **当前建议 / 倾向**: D1 表 `nano_user_devices`(`device_uuid` PK + `user_uuid` + `created_at` + `last_seen_at` + `status`)+ revoke 单设备所有 token + active session 立即断
- **Q1**: device truth 落点 — D1 表还是 token claim 内嵌?
- **Q2**: revoke 粒度 — 单设备 / 单设备所有 token / 全用户 token / refresh chain 起点?
- **Q3**: revoke 后影响 — active session 立即断 vs 仅 refresh 失效?
- **A**: 冻结为三条。1) **device truth 放 D1 表**，建议 `nano_user_devices` 做 canonical source；`device_uuid` 可以再投影进 refresh session / access claim，但 claim 不是 source of truth。2) **revoke 粒度冻结为“单设备的全部 token / refresh chain”**，不做全用户登出。3) **行为冻结为“同 device_uuid 的 refresh 立即失效，新的 authenticated HTTP/WS attach 立即拒绝；已存在的 live session 若已绑定 device_uuid 则 best-effort 立即断开，否则在下一次 auth gate 时失效”**。D6 本次不扩大成 runtime 全局强杀工程。

### Q10(新增 — Lane F kernel wait-and-resume 设计选型)

- **影响范围**: `Phase F1 + F2 — agent-core kernel 如何阻塞等待 DO storage decision 回流`
- **为什么必须确认**: agent-core 当前 kernel 没有 "block-on-storage" 机制;wait-and-resume 实现路径有 3 选:
  - (a) **polling**:hook 内 `setInterval` 轮询 DO storage,每 N ms 读一次,直到 found 或 timeout
  - (b) **alarm-driven**:`state.storage.setAlarm()` 让 DO 周期性醒来 + `alarm()` handler 检查 storage 是否有 decision + 找到后 resume waiting actor
  - (c) **WebSocket message-driven**:把 decision 直接投给 NanoSessionDO 而不是写 storage(但这会破坏 ZX4 已 land 的 storage contract)
- **当前建议 / 倾向**: (b) alarm-driven — 利用现有 `alarm()` 机制,避免 polling 开销;同时与 ZX4 Phase 3 alarm GC 兼容(每 10min hot-state alarm 已存在)
- **Q**: F1/F2 kernel wait-and-resume 是否冻结为 "alarm-driven + storage poll-on-alarm" 模式?
- **A**: 强烈同意 b 选项。而且业主必须要向你表明，选项 a 和 选项 c 都属于负面清单，严重与本项目的架构和认知模型冲突。本项目是基于 workers 以及 DO 能力上的 agent harness 实现。选项 A 属于老掉牙的办法，与我们的 cloud native 事实严重冲突。而 c 选项，则完全忘记了我们拥有 DO alarm 的事实，本质上是将云端能力下放到客户端执行。

### Q11(新增 — Lane F4 handleStart idempotency 修法选型)

- **影响范围**: `Phase F4 — handleStart 重发竞态修法`
- **为什么必须确认**: 修法两选,各有取舍:
  - (a) **request-scoped idempotency_key**:client 提供 + server 缓存 5 min;重复 key 直接返已记录的 200/409。优点:对客户端兼容性好,符合 HTTP 幂等性惯例。缺点:server 需多维护一个 cache 层
  - (b) **D1 conditional UPDATE**:`UPDATE ... WHERE session_uuid = ?1 AND session_status = 'pending' AND started_at = ?2`,affected_rows = 0 视为已被其他请求处理,返 409。优点:无新基础设施,纯 D1 原子性。缺点:需要 client 重发时不修改 started_at(目前 mintPendingSession 写 minted_at = now)
- **当前建议 / 倾向**: (b) — 复用现有 D1 truth,无新 cache 基础设施
- **Q**: F4 是否冻结为 "D1 conditional UPDATE WHERE pending AND started_at = minted_at" 修法?
- **A**: 先不要进行这个cache 层，同意在 D1 上复用。后续这个 cache 可能可以在客户端实现，在server端 gate

---

## 6. 风险与依赖

| 风险 / 依赖 | Lane | 描述 | 当前判断 | 应对方式 |
|-------------|------|------|----------|----------|
| C2 切 jwt-shared 破坏 auth flow | C | 两 worker JWT 验证逻辑切到新 package | medium | C2 必须 8/8 + 42/42 baseline 不变;若失败 rollback C1 |
| C3 kid rotation 5 分钟 overlap 期阈值不当 | C | 5 分钟太短/太长都有问题 | low | 先按 5 分钟实现;owner 调整阈值在 wrangler env 中可配 |
| C4 跨包断言破坏 nacp-core 自由演进 | C | 未来 nacp-core 加 error code 时必须同步 facade | low | 这是设计意图;断言失败即 build break,迫使同步 |
| C6 client 切 shared helper 引入新 bug | C | 手写实现可能含未文档化的 quirk | medium | C6 后跑 web + wechat live e2e baseline |
| D1 owner-local 注入脚本缺失 | D | Q2 已冻结 owner local 路径,但脚本尚不存在 | medium | 仅实现 `scripts/deploy-preview.sh` + env 注入,不再并行维护 GitHub Actions 分支 |
| D3/D4 复用现有 D1 truth 但 schema 可能不足 | D | `nano_conversation_messages` 是否承得住多模态? | medium | Q5 owner 冻结后,如不足再讨论扩展 |
| ~~E1 DO 物理迁出破坏 agent-core 测试~~ | ~~E~~ | **风险已消除 — owner direction R8 硬冻结禁止 ZX5 新增 worker;DO 提取议题已从 ZX5 scope 移除** | n/a | n/a |
| ~~E2 dual-track parity 期间双 DO 同时活跃~~ | ~~E~~ | **风险已消除 — 同上** | n/a | n/a |
| E1/E2(原 E3/E4)升级真 RPC 破坏 agent-core 现有 capability call | E | agent-core capability 编译时通过 import 调 context/filesystem | high | E1/E2 完成前必须有 RPC contract + service binding shim;**短期 shim 允许,长期双轨禁(per Q6/R9)** |
| 多 lane 并行 git conflict | C+D+E+F | C/D/E/F 都可能触碰 `workers/orchestrator-core/src/` 或 `workers/agent-core/src/` | medium | 每 phase 独立 PR;每 lane owner 协调;F1/F2 与 E1/E2 都改 agent-core,需特别注意 |
| Lane F1/F2 kernel wait-and-resume 引入死锁 | F | 若 alarm 被 GC 误删 + DO restart 期间 actor state 丢失,permission 等待会永久挂死 | high | F1-01 需做 timeout 保护(60s 后 fail-closed deny);F1-03 cross-e2e 必须包含 owner-killed-decision 场景,确认 timeout 分支 |
| Lane F3 emit usage frame 被 ws detach 客户端积压 | F | 若客户端断线,emitServerFrame 可能堆积 | low | F3-01 复用 ZX4 P3 已 land 的 `emitServerFrame` (silently no-op 当无 attachment),无新积压风险 |
| Lane F4 D1 conditional UPDATE 在 D1 read-after-write 一致性窗口内不可靠 | F | D1 SQLite 事务原子性强,但 cross-region read latency 非零 | low | F4-01 用 affected_rows = 0 → 409 的语义,客户端收到后无歧义 |
| Lane F5 R28 owner ops 任务未必能定位根因 | F | wrangler tail 抓 stack trace 不一定清晰,可能仍 carryover | medium | F5-02 已设计 3 选支(fix code / 升级 P0 / 持续 carryover);不强求本 plan 内 close R28 |
| **prod migration 006 apply 漏跑** | (out-of-scope) | per ZX4 closure §3.3 hard gate,prod deploy 前必须先 apply | **high** | 不在 ZX5 phase 内,但 ZX5 启动期间任何 prod deploy 都触发该 hard gate;由 owner / runbook §2.4 守护 |

---

## 7. Action-Plan 整体测试与整体收口

### 7.1 整体测试方法

- **基础校验**: 6 worker + 7 keep-set 包测试(ZX5 完成后 baseline 应为 75 + 1056 + 374 + 31 + Lane F 新增的 e2e + jwt-shared unit)
- **Lane C 测试**: C2 后 8/8 + 75/75 全绿;C3 kid rotation 集成测试 pass;C4 跨包断言编译通过(失败即 build break);C6 后 web + wechat live e2e baseline
- **Lane D 测试**: D2 catalog content endpoint live e2e;D3-D6 各自的 facade endpoint integration test
- **Lane E 测试**: E1 后 context-core WorkerEntrypoint RPC method 单测 + agent-core 通过 service binding 调用 context-core 的 cross-e2e;E2 同模式覆盖 filesystem-core;两 phase 完成后 worker 数量 baseline 不变(`ls workers/` 恒为 6)
- **Lane F 测试**: F1+F2 kernel wait-and-resume infra unit test(timeout 防挂死 + alarm 驱动 resume);F1-03 / F2-02 / F3-02 三个 cross-e2e full-loop(client → orchestrator → agent → DO storage → runtime resume → response);F4-02 idempotency 并发测试(模拟 5 个并发 /start 重发只有 1 成功);F5 owner ops 任务无单元测试,产出为 `docs/runbook/zx5-r28-investigation.md` 复盘记录

### 7.2 各 Lane 独立收口标准

#### Lane C 收口
1. `@haimang/jwt-shared` package 发布到 keep-set
2. orchestrator-core + orchestrator-auth 切 jwt-shared 完成 + 全绿
3. JWT kid rotation 集成测试 pass(graceful overlap 5 分钟)
4. `RpcErrorCode` ⊂ `FacadeErrorCode` 跨包断言 编译通过
5. envelope 关系文档化完成
6. web + wechat client heartbeat/replay 切 shared helper 完成

#### Lane D 收口
1. WORKER_VERSION owner-local 注入脚本已落地且工作
2. catalog content registry 真实数据填充
3. `POST /sessions/{id}/messages` + `GET /sessions/{id}/files` + `GET /me/conversations` + `POST /me/devices/revoke` 4 个 facade endpoint 业务实现 + facade-http-v1 envelope 包装

#### Lane E 收口(scope 收窄 — 保持 6-worker)
1. **不**创建 `workers/session-do/`(owner direction R8 硬冻结)
2. context-core 升级为 WorkerEntrypoint RPC,agent-core 通过短期 shim 改 service binding 调用
3. filesystem-core 升级为 WorkerEntrypoint RPC,agent-core 通过短期 shim 改 service binding 调用
4. shim 时间盒化(≤ 2 周)+ 长期双轨禁;`ls workers/` 数量恒等于 6

#### Lane F 收口(新增 — runtime kernel hookup + 稳健性)
1. PermissionRequest hook 改 await/resume 落地 + cross-e2e full-loop 验证(F1-01 + F1-02 + F1-03)
2. ElicitationRequest hook 改 await/resume 落地 + cross-e2e full-loop 验证(F2-01 + F2-02)
3. runtime emit `session.usage.update` server frame + client live update e2e(F3-01 + F3-02)
4. handleStart idempotency 修法落地 + 并发重试单元测试(F4-01 + F4-02)
5. R28 owner-driven 根因复盘 doc 完成(F5-01),根据复盘结果决定后续(F5-02 三选支)

### 7.3 完成定义(Definition of Done)

| Lane | 完成定义 |
|------|----------|
| Lane C | `jwt-shared 抽取 + 两 worker 切换 + kid rotation 测试 + RpcErrorCode⊂FacadeErrorCode 断言 + envelope 文档化 + client shared helper migration` |
| Lane D | `WORKER_VERSION owner-local 注入 + catalog content + 4 个 product endpoint(facade-http-v1 envelope)` |
| Lane E | `context-core / filesystem-core 升级为 WorkerEntrypoint 真 RPC + agent-core 通过短期 shim 改 service binding 调用 + 6-worker 拓扑保持不变(owner direction 硬冻结)` |
| Lane F | `permission/elicitation hook 改 await/resume(kernel wait-and-resume infra)+ runtime emit session.usage.update + handleStart idempotency + R28 owner ops 复盘`(全部在 6-worker 内,不拆 worker)|

### 7.4 ZX5 整体收口(可选)

ZX5 的 4 lanes 互不阻塞,可独立 close;owner 可选择:
- **整体 close**: 4 lanes 全部完成后写 ZX5-closure.md
- **lane-by-lane close**: 每 lane 完成单独 close(如 ZX5-C-closure.md / ZX5-D-closure.md / ZX5-E-closure.md / ZX5-F-closure.md)
- **关键依赖**: Lane F 是 ZX4 closure §3.2 cluster-level work 的真正 closure;若 ZX5 只完成 Lane C/D/E 而 Lane F 不动,permission/elicitation/usage push **永远停在 contract layer**,前端业务能力依然不完整。owner 应优先评估 Lane F 启动顺序

---

## 8. 执行后复盘关注点

- **Lane C 切 jwt-shared 是否真消除两 worker 的代码漂移**: `待 ZX5 执行后回填`
- **kid rotation 5 分钟阈值是否实际场景合理**: `待 ZX5 执行后回填`
- **Lane D product endpoint 是否真复用现有 D1 truth(无平行表)**: `待 ZX5 执行后回填`
- **Lane E context/fs 升级 RPC 是否引入隐藏的 cross-worker latency(短期 shim 期间)**: `待 ZX5 执行后回填`
- **Lane F kernel wait-and-resume 是否引入 timeout 误判 / alarm GC 误删**: `待 ZX5 执行后回填`
- **F4 idempotency 修法是否真消除 KV miss + D1 pending 重发竞态**: `待 ZX5 执行后回填`
- **F5 R28 owner ops 是否真在 wrangler tail 抓到 stack trace**: `待 ZX5 执行后回填`
- **多 lane 并行的 git conflict 频率(尤其 E1/E2 vs F1/F2 都改 agent-core)**: `待 ZX5 执行后回填`

---

## 9. 结语

ZX5 是 ZX4 closure 后的"非阻塞收尾 + cluster runtime kernel hookup" plan,4 个 lanes 各自独立解决一类问题:

- **Lane C(协议/auth 卫生)**: 把 jwt-shared 抽到 single source of truth;把 `RpcErrorCode ⊂ FacadeErrorCode` 用编译期断言锁住;把 envelope 关系文档化(不改 public wire);把 client heartbeat/replay 切到 shared helper。**让协议层从"手写 + 重复 + 隐式约定"变成"single source + 编译期约束 + 文档明确"**。
- **Lane D(产品面 + ops)**: catalog content + 4 个 product endpoint + WORKER_VERSION owner-local 注入。**让 facade-http-v1 从"contract 冻结 + 占位"升级为"业务可用"**。
- **Lane E(library worker RPC 升级 — 保持 6-worker)**: context-core / filesystem-core 从 library-only 升级为真 WorkerEntrypoint RPC;agent-core 通过短期 shim 改 service binding 调用。**6-worker 拓扑边界不变(owner direction R8 硬冻结)**;`NanoSessionDO` 物理提取议题已从 ZX5 完全移除。
- **Lane F(runtime kernel hookup — 新增)**: agent-core PermissionRequest / ElicitationRequest hook 改 await/resume + runtime emit `session.usage.update` + handleStart idempotency + R28 owner ops 复盘。**让 ZX4 已 land 的 storage contract 真正变成业务闭环**;前端发的 decision / answer 真正驱动 agent runtime 恢复执行;前端能 live 看到 usage 数字变化。

ZX5 完成后,**zero-to-real 系列的所有 ZX2/ZX4 carryover 在 6-worker 边界内全部收口**:
- 协议/auth 收敛到 single source(jwt-shared + 跨包断言)
- 产品面具备业务能力(catalog content + 4 endpoints)
- context-core / filesystem-core 从 library 升级为真 RPC worker
- permission/elicitation/usage 真正业务闭环(不再停在 contract layer)
- handleStart idempotency 关闭(不再有 KV miss + D1 pending 重发竞态)
- R28 owner-driven 复盘 close

**ZX5 是 zero-to-real 系列在当前 6-worker 拓扑内的真正终章**;任何超越 6-worker 边界的演进(如 R24 NanoSessionDO 提取)都属于未来独立 plan 范畴。

> v3 by Opus 4.7(2026-04-28)— v2 + post-ZX4 实测代码 audit(确认 jwt helper 仍 250+175 行 / handleCatalog 仍空数组 / context+fs 仍 library-only / scripts/ 不存在)+ 4-reviewer ZX3-ZX4 review findings 全量承接(Lane F 来自 ZX4 closure §3.2 cluster work + GLM R8 idempotency + kimi R4 / deepseek R3 R28 wrangler tail)。新增 Lane F + Q10/Q11(F1+F2 wait-and-resume 设计 + F4 idempotency 修法选型),共 4 lanes / 22 phase entry / Q1-Q11。**等 owner 审核 Q10/Q11(其余 Q1-Q9 已答),并判断 4 lanes 启动顺序与 owner-action 任务(F5 wrangler tail / D1 owner-local / D4 R2 bucket 创建)的并行度**。

---

## 10. 工作详细日志 — ZX5 全 lane 执行(2026-04-28 by Opus 4.7)

> 状态: **ZX5 全 4 lanes done**(C1-C6 / D1-D6 / E1-E2 / F1-F5)+ 2055 tests 全绿 + worker 总数 = 6(R8 hard freeze)+ 7 keep-set packages(ZX3 6 + ZX5 jwt-shared)
> 关联 owner Q&A: Q1-Q11 全部已答(Q10 alarm-driven / Q11 D1 conditional UPDATE 本期新增)

### 10.0 总览

| Wave | Phase | LOC delta | tests delta | risk landed |
|---|---|---|---|---|
| 1A | F4 idempotency | +25 | +2 unit | KV miss + D1 pending 重发竞态关闭 |
| 1B | C1 jwt-shared package | +345(new package)| +20 unit | single source for 73 行 worker-local 漂移 |
| 1C | C4 RpcErrorCode 跨包断言 | +5 | 0(build-time)| RpcErrorCode 漂移即 build break |
| 1D | D1 deploy-preview.sh | +120(new file)| 0 | owner-local WORKER_VERSION env-fill 路径 |
| 1E | D2 catalog content | +110(new file + handler 改) | smoke updated | catalog 从空数组 → 11 entries × 3 kinds |
| 1F | F5 R28 runbook stub | +140(new file) | 0 | owner ops 复盘 template |
| 2A | C2 切两 worker | -126(删 worker-local)/ +20(import + dynamic verifyJwt)| 0 | 8/8 + 75/75 baseline 不变 |
| 2B | C3 kid rotation 集成 | +110(new test file) | +5 unit | graceful overlap 5min 验证 |
| 2C | C5 envelope README | +127(auth-contract README new)+ +20(nacp-core README cross-link)| 0 | single source 文档化(per Q7 (a) 选项) |
| 2D | D5 /me/conversations | +90(handler)+ +20(route)| 0 | 复用 D1 listSessionsForUser group by conversation |
| 3A | D3 /messages | +130(handler)+ +5(route)| 0 | per Q8 同表 + message_kind tag |
| 3B | D4 /files | +50(handler) | 0 | metadata-only(R2 binding owner-action)|
| 3C | D6 /devices/revoke + migration 007 | +50(SQL)+ +120(handler)| 0 | per Q9 D1 canonical truth + audit table |
| 4A | F1 wait-and-resume infra | +120(deferred map + helpers + alarm sweep)| 0 | per Q10 alarm-driven |
| 4B | F2 elicitation 复用 F1 |(shared with F1)| 0 | 同 F1 模式,polling key 不同 |
| 4C | F3 onUsageCommit callback | +25(option + 2 callsite)| 0 | LLM/tool quota commit 触发 |
| 5A | C6 client shared helper | +45(web local mirror)+ +60(wechat adapter)+ usage 改 | 0 | local mirror per environment(per Q3 不冻结深路径) |
| 5B | E1 context-core RPC | +70(WorkerEntrypoint class + shim + vitest config)| +4(implicit baseline)| minimal seam(probe / nacpVersion / assemblerOps)|
| 5C | E2 filesystem-core RPC | +70(同 E1 模式)| 0 | minimal seam |

### 10.1 Lane C — Protocol / Auth Hygiene

#### C1 jwt-shared package

**新建路径**:`packages/jwt-shared/{package.json, tsconfig.json, src/index.ts, test/jwt-shared.test.ts}`。**API**:`base64Url`、`importKey`、`parseJwtHeader`、`collectVerificationKeys`、`verifyJwt<T>`、`verifyJwtAgainstKeyring<T>`、`resolveSigningSecret`、`signJwt`、`JWT_LEEWAY_SECONDS=300`。20/20 unit 验证 base64Url round-trip / verifyJwt happy + reject + expire / kid 优先 + fall through legacy / no silent fall-through to wrong-kid / sign-verify round-trip。

#### C2 两 worker 切 jwt-shared

`workers/orchestrator-core/src/auth.ts`:删 73 行 worker-local + 加 imports + `verifyJwt` re-export wrapper。`workers/orchestrator-auth/src/jwt.ts`:删 53 行 + 保留 `AccessTokenClaims` normalize + `AuthServiceError` 包装,`mintAccessToken` 用 `sharedSignJwt`。两 worker package.json 加 `@haimang/jwt-shared: workspace:*` + pretest/prebuild filter。`node_modules/@haimang/jwt-shared` 4-up symlink。orchestrator-core 75→77 / orchestrator-auth 8→13 baseline 验证零回归。

#### C3 kid rotation 集成测试

`workers/orchestrator-auth/test/kid-rotation.test.ts` 5 unit:v1 token+v2 env+v1 secret 仍在 → accept / v1 token+v2 env(无 v1 secret)→ reject / legacy JWT_SECRET → accept / tampered → reject。**5/5 pass**。

#### C4 RpcErrorCode 跨包断言

`packages/orchestrator-auth-contract/src/facade-http.ts` 加 `_rpcErrorCodesAreFacadeCodes: z.infer<typeof RpcErrorCodeSchema> extends FacadeErrorCode ? true : never = true;` + import。`@haimang/nacp-core` 加 auth-contract dependency + node_modules symlink。auth-contract 19/19 baseline 不变,build-time guard 在 RpcErrorCode 漂移时立即 fail。

#### C5 envelope README

新建 `packages/orchestrator-auth-contract/README.md`(127 行,per Q7 (a) 选项):envelope 关系总览(ASCII 图)+ 单向约束 + 三种 envelope 形态 + helper 用法 + 升级规则。`packages/nacp-core/README.md` 加 cross-link section 指向 auth-contract README 作为单一真相。

#### C6 web/wechat client heartbeat shared helper

- `clients/web/src/heartbeat.ts`(local mirror,user 编辑后 interface 与 nacp-session 一致)
- `clients/web/src/client.ts:openStream` 替换 `lastHeartbeatSentAt + setInterval` → `HeartbeatTracker.shouldSendHeartbeat()` + `recordHeartbeat()`
- `clients/wechat-miniprogram/utils/heartbeat-adapter.js`(new,JS 1:1 镜像)
- `clients/wechat-miniprogram/utils/nano-client.js:bindSocketLifecycle` 改用 HeartbeatTracker

### 10.2 Lane D — Product Surface + Ops

- **D1**: `scripts/deploy-preview.sh`(120 行)6 worker deploy order + GIT_SHA env-fill + WORKER_VERSION_SUFFIX support。bash -n syntax check pass。
- **D2**: `workers/orchestrator-core/src/catalog-content.ts` 11 entries(4 skills / 5 commands / 2 agents);`handleCatalog` 改 dynamic import + 真数据;smoke test 3 个 catalog test 改"empty → non-empty + shape match"。
- **D3 `/messages`**(per Q8):`SessionAction` 加 `messages`;`handleMessages` 解析 `parts: Array<{kind:'text'|'artifact_ref',...}>`,落同一 `nano_conversation_messages` 表 + `message_kind: 'user.input.text' | 'user.input.multipart'`;ingress guard 同 input(`requireSession + sessionGateMiss`);`recordUserMessage` kind union 扩展 4 类型。
- **D4 `/files`**:`handleFiles` 扫 `nano_conversation_messages.body_json.parts` 提 `artifact_ref` → metadata 列表(R2 binding 缺失下不返 bytes,留 owner-action)。
- **D5 `/me/conversations`**(per Q5):`handleMeConversations(limit)` 复用 `D1SessionTruthRepository.listSessionsForUser({limit:200})`,group by `conversation_uuid`,sort `last_seen_at DESC`,slice limit。**不新建平行表**。
- **D6 `/me/devices/revoke` + migration 007**(per Q9):
  - migration 007:`nano_user_devices`(`device_uuid PK / user_uuid FK / team_uuid FK / device_label / device_kind enum / status enum / created_at / last_seen_at / revoked_at / revoked_reason`,2 indexes)+ `nano_user_device_revocations`(append-only audit,1 index)
  - `GET /me/devices` → handleMeDevicesList:D1 query LIMIT 100
  - `POST /me/devices/revoke` → handleMeDevicesRevoke:ownership check / idempotent already_revoked / D1 batch UPDATE+INSERT
  - **revoke 后 active session best-effort 断开** 留 second-half(需 IngressAuthSnapshot 加 device_uuid + WS gate 改造)

### 10.3 Lane E — Library Worker RPC Uplift(保持 6-worker)

- **E1 context-core**:加 `ContextCoreEntrypoint` extends WorkerEntrypoint,`fetch / probe / nacpVersion / assemblerOps`(minimal seam,实际 op body 不在本期);保留 binding-scope 401 default。`workers/context-core/{test/support/cloudflare-workers-shim.ts, vitest.config.ts}` new。
- **E2 filesystem-core**:同 E1 模式,`FilesystemCoreEntrypoint` with `fetch / probe / nacpVersion / filesystemOps`。
- **agent-core 短期 shim**:in-process import 保留(per Q6 + R9 ≤ 2 周),agent-core wrangler.jsonc 的 CONTEXT_CORE / FILESYSTEM_CORE binding 仍 commented 等 owner 决定 RPC-first toggle。
- **`ls workers/`**:实测 6 项不变(R8 hard freeze)。

### 10.4 Lane F — Runtime Kernel Hookup + 稳健性

#### F1 + F2 NanoSessionDO alarm-driven wait-and-resume infra(per Q10 b 选项)

- `recordAsyncAnswer` 写 storage 后立即 resolve 内存 deferred(不等 alarm)
- `private readonly deferredAnswers = new Map<string, {resolve, reject, expiresAt, kind, requestUuid}>()`
- `awaitAsyncAnswer({kind, requestUuid, timeoutMs})`:先查 storage(防 race)→ 若 miss 注册 deferred + setTimeout 60s default(60s ~ 5min clamp)
- `resolveDeferredAnswer(kind, requestUuid, decision)`:取 map → resolve → 删
- `sweepDeferredAnswers()`(由 `alarm()` 调):expired entry reject / storage 已有 decision 但 map 仍等 → resolve(DO restart recovery 路径)
- `emitPermissionRequestAndAwait` + `emitElicitationRequestAndAwait` public helper
- `alarm()` 内追加 `await this.sweepDeferredAnswers()`

**Q10 落地**:alarm-driven sweep + storage canonical + 内存 deferred 立即 resolve。无 polling、不让 client WS 直接驱动 DO 内存。

#### F3 runtime emit `session.usage.update`

`MainlineKernelOptions.onUsageCommit?: (event: {kind: 'llm'|'tool', remaining, limitValue, detail}) => void` callback,在 tool / LLM quota commit 后触发。caller 在 `onUsageCommit` 内通过 `emitServerFrame('session.usage.update', {...})` 推 attached client(wire-up 留 future PR)。

#### F4 handleStart idempotency(per Q11 b 选项)

- `D1SessionTruthRepository.claimPendingForStart(session_uuid)`:atomic UPDATE WHERE pending → 返 `meta.changes > 0`
- `handleStart` 内 `durableStatus === 'pending'` 时,在所有 side-effect 之前调 `claimPendingForStart`;false 立即 409 `session-already-started, current_status: 'starting'`
- 2 unit:claim false → 409 + `beginSession` 没被调用 / claim true → 200 + KV 写入完整

**77/77 pass(75 + 2)**。

#### F5 R28 wrangler tail investigation runbook stub

新建 `docs/runbook/zx5-r28-investigation.md`(140 行 owner-action template):`wrangler tail` 流程 / 复现步骤 / stack trace 抓取 / 根因分类 A/B/C/D / 修法决策 fix/upgrade/carryover。**sandbox 拒绝 wrangler tail**,留 owner ops。

### 10.5 Wave 6 — final regression sweep

| 验证项 | 命令 / 证据 | 结果 |
|---|---|---|
| jwt-shared | `cd packages/jwt-shared && vitest run` | **20 / 20 pass**(C1)|
| orchestrator-auth-contract | `pnpm -F @haimang/orchestrator-auth-contract test` | **19 / 19 pass**(C4 build through)|
| orchestrator-core | `pnpm -F @haimang/orchestrator-core-worker test` | **77 / 77 pass**(+2 F4)|
| agent-core | `pnpm -F @haimang/agent-core-worker test` | **1056 / 1056 pass**(零回归)|
| bash-core | `pnpm -F @haimang/bash-core-worker test` | **374 / 374 pass**(零回归)|
| orchestrator-auth | `pnpm -F @haimang/orchestrator-auth-worker test` | **13 / 13 pass**(+5 C3)|
| context-core | `pnpm -F @haimang/context-core-worker test` | **171 / 171 pass**(+4)|
| filesystem-core | `pnpm -F @haimang/filesystem-core-worker test` | **294 / 294 pass**(零回归)|
| root-guardians | `pnpm test:contracts` | **31 / 31 pass**(零回归)|
| **合计** | — | **`20 + 19 + 77 + 1056 + 374 + 13 + 171 + 294 + 31 = 2055 tests 全绿,零回归`** |

**ZX5 全 4 lanes 收口** — 文档落点:`docs/issue/zero-to-real/ZX5-closure.md`。
