# Nano-Agent 行动计划 — ZX5 Protocol Hygiene + Product Surface + Architecture Refactor

> 服务业务簇: `zero-to-real / ZX5 / protocol-auth-hygiene + product-surface + architecture-refactor`
> 计划对象: 承接 ZX2 closure §4.3+§5+§8.2 + ZX3 §16.7 中**不阻塞 transport close** 的 carryover 项;按 3 个独立 lanes 组织(C-Hygiene / D-Product / E-Architecture),每个 lane 有独立 entry/exit,互不阻塞
> 类型: `add + refactor + cleanup + ops`
> 作者: `Opus 4.7(2026-04-28 v2)— v1 + ZX4-ZX5 GPT review(R4-R9 + owner direction 硬边界)修订`
> 时间: `2026-04-28`
> 文件位置:
> - **Lane C(protocol/auth hygiene)**: `packages/jwt-shared/`(new) + `packages/orchestrator-auth-contract/src/facade-http.ts`(RpcErrorCode⊂FacadeErrorCode 断言) + `workers/orchestrator-{core,auth}/src/`(切 jwt-shared) + `clients/web/src/client.ts` + `clients/wechat-miniprogram/utils/nano-client.js`(切 nacp-session shared helper)
> - **Lane D(product surface + ops)**: `workers/orchestrator-core/src/{index,catalog-content,user-do}.ts`(catalog content + 4 个 product endpoints) + `scripts/deploy-preview.sh`(WORKER_VERSION owner-local 注入前置)+ `workers/*/wrangler.jsonc`
> - **Lane E(library worker RPC 升级 — 保持 6-worker)**: `workers/{context-core,filesystem-core}/src/`(升级真 RPC,from library-only)+ `workers/agent-core/{src,wrangler.jsonc}`(打开 service binding 并切调用)。**owner direction 硬冻结: ZX5 禁止新增 worker;NanoSessionDO 提取到独立 worker 已从 ZX5 scope 移除**
> 关联设计 / 调研文档:
> - `docs/eval/zero-to-real/ZX4-action-plan-reviewed-by-GPT.md`(re-baseline 来源)
> - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md` §2.2 Out-of-Scope([O1]-[O11] 移交本 plan)
> - `docs/issue/zero-to-real/ZX2-closure.md` §5(R18/R19/R20/R21/R24/R25/R27 部分)
> - `docs/issue/zero-to-real/ZX3-closure.md` §3.2 + §3.3
> 文档状态: `draft (v2 post-ZX4-ZX5-GPT-review) — Lane E 已按 owner direction 硬边界改写: ZX5 不允许新增 worker,删除 E1+E2(NanoSessionDO 提取);保留 E3+E4(context/fs RPC 升级,在 6-worker 内);C5/C6/D3/D6 细节按 R4-R7 修订`

---

## 0. 执行背景与目标

GPT 对原 ZX4 unified draft 的审查指出: 把 transport finalization + session semantics + protocol hygiene + product expansion + architecture refactor 全揉进一份 plan 是 scope 失控。ZX4 已重切为单点目标(transport 真收口 + session 语义闭环);ZX5 承接其余非阻塞项,按 GPT §4 建议的 4-lane 架构,Lane C / Lane D / Lane E 拆为 3 个独立 sub-tracks。

**ZX5 的关键差异**: 与 ZX4(单点目标 + 串行)不同,ZX5 的 3 个 lanes **互不阻塞**,可独立交付。每个 lane 单独成型时即可关闭对应 carryover 项;不要求 3 lanes 一起完成才收口。

- **服务业务簇**: `zero-to-real / ZX5`
- **计划对象**: protocol/auth hygiene + product surface + architecture refactor 的多 lane 分离
- **本次计划解决的问题**:
  - **Lane C(协议/auth 卫生)**:
    - R20 `orchestrator-core` 与 `orchestrator-auth` 的 JWT helper 重复实现(`workers/orchestrator-core/src/auth.ts:62-149` vs `workers/orchestrator-auth/src/jwt.ts:19-175`)
    - R21 `RpcErrorCode` ⊂ `FacadeErrorCode` 跨包编译期断言缺失(目前只有 `AuthErrorCode ⊂ FacadeErrorCode`)
    - R19 envelope 三 type 关系未文档化为"单向约束 + 不改 public wire"(per GPT 3.9 — 不是泛泛"收敛")
    - JWT kid rotation graceful overlap 期集成测试缺失(DeepSeek §5.6)
    - web/wechat client 仍手写 heartbeat / replay / ack,未切到 `@haimang/nacp-session` root export 的 shared helper(per GPT 3.8)
  - **Lane D(产品面 + ops)**:
    - R18 `handleCatalog` 返空数组(workers/orchestrator-core/src/index.ts:410-433);registry 内容未填充
    - ZX2 [O8] `POST /sessions/{id}/messages`(多模态 message 输入)未实现
    - ZX2 [O9] `GET /sessions/{id}/files`(artifact 拉取)未实现
    - ZX2 [O10] `GET /me/conversations`(完整对话列表)未实现
    - ZX2 [O11] `POST /me/devices/revoke`(设备管理)未实现
    - R25 `WORKER_VERSION` 静态 `@preview`(per GPT 3.5 — 仓库 `.github/workflows/deploy-preview.yml` **不存在**;先确认 deploy pipeline 在哪里执行)
  - **Lane E(library worker RPC 升级 — 保持 6-worker)**:
    - context-core / filesystem-core 仍是 library-only(ZX2 [O5] 显式 out-of-scope) — 升级为真 RPC worker 解锁 capability 隔离
    - **owner direction 硬冻结(per ZX4-ZX5 GPT review R8)**: ZX5 不允许新增 worker;`NanoSessionDO` 物理提取到独立 worker(原 v1 E1+E2)已**从 ZX5 scope 移除**;Lane E 在本 plan 内仅做 context-core / filesystem-core 升级,不动 6-worker 拓扑边界
    - R24(`NanoSessionDO` 与 agent runtime 同进程的限制)— 当前**冻结/延后**;若未来重谈,优先按 `agent-core` / `agent-session` 域内拆分语言重新建模(且需 owner 重新授权),不在本 plan 内任何 phase 触碰
- **本次计划的直接产出**:
  - **Lane C exit**: `@haimang/jwt-shared` package + 两 worker 切换 + kid rotation 集成测试 + `RpcErrorCode ⊂ FacadeErrorCode` 跨包断言 + envelope 关系文档化 + 客户端 heartbeat/replay 通过 `@haimang/nacp-session` root export + browser/wechat adapter 接入
  - **Lane D exit**: catalog content 填充 + 4 个 product endpoint 业务实现(D3 `/messages` 先冻结与 `/input` 的语义边界;D6 `/devices/revoke` 先冻结 device truth 模型)+ WORKER_VERSION 注入(owner local 路径)
  - **Lane E exit(scope 收窄)**: context-core / filesystem-core 升级为 WorkerEntrypoint RPC + agent-core 改 service binding 调用,**保持 6-worker 拓扑不变**

---

## 1. 执行综述

### 1.1 总体执行方式

**3 lanes 独立设计 + 独立执行 + 各自有 entry/exit**(per GPT §4.3+§4.4 sibling tracks)。Lane C / Lane D / Lane E 互不阻塞,可任意顺序启动。每 lane 内部仍按 phase 串行,但 lane 之间无依赖。

### 1.2 Lane + Phase 总览

| Lane | Phase | 名称 | 工作量 | 目标摘要 | 依赖前序 |
|------|------|------|--------|----------|----------|
| **C-Hygiene** | C1 | `@haimang/jwt-shared` package 创建 | `M` | 抽取共享 JWT helper(collectVerificationKeys / importKey / base64Url / parseJwtHeader / verifyJwt) | `-`(ZX3 §14.1 已 reserved keep-set 位置) |
| **C-Hygiene** | C2 | orchestrator-core + orchestrator-auth 切 jwt-shared | `M` | 删 worker-local 重复实现;改 import | C1 |
| **C-Hygiene** | C3 | JWT kid rotation graceful overlap 集成测试 | `S` | `kid_v1` token 切到 `kid_v2` 后 5 分钟内仍接受 | C2 |
| **C-Hygiene** | C4 | `RpcErrorCode` ⊂ `FacadeErrorCode` 跨包 zod enum 编译期断言 | `S` | 新增 `_rpcErrorCodesAreFacadeCodes` 跨包穷尽断言(per GPT 3.9 — 单向约束) | `-` |
| **C-Hygiene** | C5 | envelope 关系文档化(不改 public wire) | `S` | facade alias / Envelope / FacadeEnvelope 关系在 README / transport docs 落档(per GPT 3.9) | C4 |
| **C-Hygiene** | C6 | web / wechat client heartbeat / replay 切 shared helper | `M` | 删手写实现;改用 `@haimang/nacp-session` root export 的 shared helper / adapter | `-`(per GPT 3.8 显式冻结目标:替换 vs 行为对齐 → 选替换) |
| **D-Product** | D1 | WORKER_VERSION CI 动态注入(ops 前置确认) | `M` | per GPT 3.5 — 先确认 deploy pipeline 在哪里执行;再写 wrangler env-fill `worker-name@${GITHUB_SHA}` | **owner-required: 确认 deploy pipeline** |
| **D-Product** | D2 | catalog content 填充(skills / commands / agents registry) | `M` | `handleCatalog` 返真实 registry 数据 | `-` |
| **D-Product** | D3 | `POST /sessions/{id}/messages`(多模态 message 输入) | `L` | facade endpoint + storage + envelope 包装 | `-` |
| **D-Product** | D4 | `GET /sessions/{id}/files`(artifact 拉取) | `L` | facade endpoint + R2 / D1 backing | `-` |
| **D-Product** | D5 | `GET /me/conversations`(完整对话列表) | `M` | facade endpoint + 多对话查询 | `-`(可在 ZX4 P3 后做 — pending+active+ended 视图已闭合) |
| **D-Product** | D6 | `POST /me/devices/revoke`(设备管理) | `M` | facade endpoint + orchestrator-auth JWT revocation | C2(jwt-shared 切完后再做更稳) |
| **E-Library-Uplift** | E1 | context-core 升级为 WorkerEntrypoint RPC | `L` | context-core 从 library-only 升级为真 RPC worker(在 6-worker 内,不新增 worker) | **ZX4 完成后**(架构变更不应在 transport close 期同时执行) |
| **E-Library-Uplift** | E2 | filesystem-core 升级为 WorkerEntrypoint RPC | `L` | filesystem-core 从 library-only 升级为真 RPC worker(在 6-worker 内,不新增 worker) | **ZX4 完成后**(独立于 E1,可与 E1 并行) |
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

### 1.4 执行策略说明

- **Lane 独立性**: C / D / E 互不阻塞;owner 可同时启动多 lane 或单 lane 推进
- **Lane 内部串行**: 每 lane 内 phase 严格串行(jwt-shared 必须先抽再切;E1/E2 各自都应先暴露 RPC contract，再切 agent-core 调用)
- **测试推进原则**: 每 phase 跑全 worker tests + root-guardians;C3 引入 kid rotation 集成测试;E1/E2 引入 context/filesystem RPC integration / cross-e2e
- **ZX4 优先**: Lane E 强烈建议在 ZX4 完成后启动;Lane C / D 可在 ZX4 进行中并行(但 git conflict 需协调)
- **回滚原则**: C2 / E1 / E2 是高风险 phase,每 phase 独立 commit + 保留 rollback 通道

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
└── Lane E — Library Worker RPC Uplift(保持 6-worker 不变)
    ├── workers/context-core/src/(E1 升级 WorkerEntrypoint RPC)
    ├── workers/context-core/wrangler.jsonc(E1 暴露 RPC method binding)
    ├── workers/filesystem-core/src/(E2 升级 WorkerEntrypoint RPC)
    ├── workers/filesystem-core/wrangler.jsonc(E2)
    ├── workers/agent-core/{src,wrangler.jsonc}(E1+E2 打开 binding + 改 service binding 调用 context/fs)
    └── ~~workers/session-do/~~(**owner direction 硬冻结禁止 — 已从 ZX5 scope 移除**)
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** `@haimang/jwt-shared` package 创建 + 两 worker 切换 + kid rotation 集成测试(R20 + DeepSeek §5.6)
- **[S2]** `RpcErrorCode` ⊂ `FacadeErrorCode` 跨包 zod enum 编译期断言(R21,per GPT 3.9 单向约束)
- **[S3]** envelope 关系文档化(R19,per GPT 3.9 不改 public wire)
- **[S4]** web / wechat client heartbeat / replay 切 shared helper(per GPT 3.8 替换目标)
- **[S5]** WORKER_VERSION CI 动态注入(R25,per GPT 3.5 ops 前置确认)
- **[S6]** catalog content 填充(R18)
- **[S7]** 4 个 product endpoint(ZX2 [O8-O11])
- **[S8]** context-core / filesystem-core 升级真 RPC,保持 6-worker 拓扑不变(ZX2 [O5];Lane E 在 ZX4 完成后启动)

### 2.2 Out-of-Scope

- **[O1]** transport finalization(R28/R29/R31/P3-05 flip)→ **ZX4**
- **[O2]** session 语义闭环(permission/usage/elicitation/me-sessions pending truth)→ **ZX4 Lane B**
- **[O3]** user-do.ts seam refactor → **ZX4 Phase 0**(早期 seam,per GPT 3.7)
- **[O4]** WeChat 真机 smoke(R17)→ owner-action(无 plan)
- **[O5]** D1 schema 大改动 — 新 product endpoint 应复用现有 truth(`nano_conversation_messages` / `nano_conversation_turns` / R2 storage),不新建平行表
- **[O6]** **新增 worker / 改变 6-worker 拓扑(per ZX4-ZX5 GPT review R8 owner direction 硬冻结)**: 不得创建 `workers/session-do/`;不得把 `NanoSessionDO` 物理迁出 `agent-core`;不得在 ZX5 任何 phase 让 worker 数量从 6 变为其他数。R24(NanoSessionDO 拆分)冻结 + 延后到未来 owner 重新授权后的独立议题
- **[O7]** D6 device model design — 在 D6 开工前由 owner 冻结(Q9);本 plan 内不预设 device truth 落点

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
| 多 lane 并行 git conflict | C+D+E | C/D/E 都触碰 `workers/orchestrator-core/src/` | medium | 每 phase 独立 PR;每 lane owner 协调 |

---

## 7. Action-Plan 整体测试与整体收口

### 7.1 整体测试方法

- **基础校验**: 6 worker + 7 keep-set 包测试(ZX4 P0 后 + jwt-shared 创建后)
- **Lane C 测试**: C2 后 8/8 + 42/42 全绿;C3 kid rotation 集成测试 pass;C4 跨包断言编译通过(失败即 build break);C6 后 web + wechat live e2e baseline
- **Lane D 测试**: D2 catalog content endpoint live e2e;D3-D6 各自的 facade endpoint integration test
- **Lane E 测试**: E1 后 context-core WorkerEntrypoint RPC method 单测 + agent-core 通过 service binding 调用 context-core 的 cross-e2e;E2 同模式覆盖 filesystem-core;两 phase 完成后 agent-core baseline 不变(`ls workers/` 数量恒为 6)

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

### 7.3 完成定义(Definition of Done)

| Lane | 完成定义 |
|------|----------|
| Lane C | `jwt-shared 抽取 + 两 worker 切换 + kid rotation 测试 + RpcErrorCode⊂FacadeErrorCode 断言 + envelope 文档化 + client shared helper migration` |
| Lane D | `WORKER_VERSION CI 动态注入 + catalog content + 4 个 product endpoint(facade-http-v1 envelope)` |
| Lane E | `context-core / filesystem-core 升级为 WorkerEntrypoint 真 RPC + agent-core 通过短期 shim 改 service binding 调用 + 6-worker 拓扑保持不变(owner direction 硬冻结)` |

### 7.4 ZX5 整体收口(可选)

ZX5 的 3 lanes 互不阻塞,可独立 close;owner 可选择:
- **整体 close**: 3 lanes 全部完成后写 ZX5-closure.md
- **lane-by-lane close**: 每 lane 完成单独 close(如 ZX5-C-closure.md / ZX5-D-closure.md / ZX5-E-closure.md)

---

## 8. 执行后复盘关注点

- **Lane C 切 jwt-shared 是否真消除两 worker 的代码漂移**: `待 ZX5 执行后回填`
- **kid rotation 5 分钟阈值是否实际场景合理**: `待 ZX5 执行后回填`
- **Lane D product endpoint 是否真复用现有 D1 truth(无平行表)**: `待 ZX5 执行后回填`
- **Lane E context/fs 升级 RPC 是否引入隐藏的 cross-worker latency(短期 shim 期间)**: `待 ZX5 执行后回填`
- **多 lane 并行的 git conflict 频率**: `待 ZX5 执行后回填`

---

## 9. 结语

ZX5 是 ZX4 GPT review re-baseline 后的"非阻塞收尾" plan,3 个 lanes 各自独立解决一类问题:

- **Lane C(协议/auth 卫生)**: 把 jwt-shared 抽到 single source of truth;把 `RpcErrorCode ⊂ FacadeErrorCode` 用编译期断言锁住;把 envelope 关系文档化(不改 public wire);把 client heartbeat/replay 切到 shared helper。**让协议层从"手写 + 重复 + 隐式约定"变成"single source + 编译期约束 + 文档明确"**。
- **Lane D(产品面 + ops)**: catalog content + 4 个 product endpoint + WORKER_VERSION CI 动态注入。**让 facade-http-v1 从"contract 冻结 + 占位"升级为"业务可用"**。
- **Lane E(library worker RPC 升级 — 保持 6-worker)**: context-core / filesystem-core 从 library-only 升级为真 WorkerEntrypoint RPC;agent-core 通过短期 shim 改 service binding 调用。**6-worker 拓扑边界不变(owner direction R8 硬冻结)**;`NanoSessionDO` 物理提取议题已从 ZX5 完全移除,冻结/延后到未来 owner 重新授权后的独立议题(届时优先按 `agent-core / agent-session` agent-domain 内拆分语言重新建模)。

ZX5 完成后,**zero-to-real 系列的所有 ZX2 carryover 在 6-worker 边界内全部收口**;协议/auth 收敛到 single source(jwt-shared + 跨包断言);产品面具备业务能力(catalog content + 4 endpoints);context-core / filesystem-core 从 library 升级为真 RPC worker。**ZX5 是 zero-to-real 系列在当前 6-worker 拓扑内的真正终章**;任何超越 6-worker 边界的演进都属于未来独立 plan 范畴。

> v2 by Opus 4.7(2026-04-28)— after ZX4-ZX5 GPT review(R4-R9)+ owner direction 硬边界(R8 — ZX5 不允许新增 worker)修订。3 lanes 独立设计;Lane E scope 收窄到 context/fs 升级,DO 提取已移除。等 owner 审核 Q1-Q9(其中 Q4 已按 owner direction 自答;Q1/Q2/Q3/Q5/Q6 已自答;Q7/Q8/Q9 新增待答)。
