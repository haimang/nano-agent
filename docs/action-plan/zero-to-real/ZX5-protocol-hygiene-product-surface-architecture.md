# Nano-Agent 行动计划 — ZX5 Protocol Hygiene + Product Surface + Architecture Refactor

> 服务业务簇: `zero-to-real / ZX5 / protocol-auth-hygiene + product-surface + architecture-refactor`
> 计划对象: 承接 ZX2 closure §4.3+§5+§8.2 + ZX3 §16.7 中**不阻塞 transport close** 的 carryover 项;按 3 个独立 lanes 组织(C-Hygiene / D-Product / E-Architecture),每个 lane 有独立 entry/exit,互不阻塞
> 类型: `add + refactor + cleanup + ops`
> 作者: `Opus 4.7(2026-04-28 v1)— created after ZX4 GPT review re-baseline`
> 时间: `2026-04-28`
> 文件位置:
> - **Lane C(protocol/auth hygiene)**: `packages/jwt-shared/`(new) + `packages/orchestrator-auth-contract/src/facade-http.ts`(RpcErrorCode⊂FacadeErrorCode 断言) + `workers/orchestrator-{core,auth}/src/`(切 jwt-shared) + `clients/web/src/client.ts` + `clients/wechat-miniprogram/utils/nano-client.js`(切 nacp-session shared helper)
> - **Lane D(product surface + ops)**: `workers/orchestrator-core/src/{index,catalog-content,user-do}.ts`(catalog content + 4 个 product endpoints) + `.github/workflows/*`(WORKER_VERSION CI 前置 ops)+ `workers/*/wrangler.jsonc`
> - **Lane E(architecture refactor)**: `workers/orchestrator-core/src/`(DO 提取候选)+ 新建 `workers/session-do/`(候选)+ `workers/{context-core,filesystem-core}/src/`(升级真 RPC)
> 关联设计 / 调研文档:
> - `docs/eval/zero-to-real/ZX4-action-plan-reviewed-by-GPT.md`(re-baseline 来源)
> - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md` §2.2 Out-of-Scope([O1]-[O11] 移交本 plan)
> - `docs/issue/zero-to-real/ZX2-closure.md` §5(R18/R19/R20/R21/R24/R25/R27 部分)
> - `docs/issue/zero-to-real/ZX3-closure.md` §3.2 + §3.3
> 文档状态: `draft (v1) — 3 lanes 独立设计,各自有 entry/exit,不互相阻塞;待 owner 审核 Q1-Q6`

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
  - **Lane E(架构 refactor)**:
    - R24 `NanoSessionDO` 仍在 `agent-core` worker 内;DO 与 agent runtime 同进程的限制(per ZX2 closure §5 R24)
    - context-core / filesystem-core 仍是 library-only(ZX2 [O5] 显式 out-of-scope) — 升级为真 RPC worker 解锁 capability 隔离
- **本次计划的直接产出**:
  - **Lane C exit**: `@haimang/jwt-shared` package + 两 worker 切换 + kid rotation 集成测试 + `RpcErrorCode ⊂ FacadeErrorCode` 跨包断言 + envelope 关系文档化 + 客户端 heartbeat/replay 切到 shared helper
  - **Lane D exit**: catalog content 填充 + 4 个 product endpoint 业务实现 + WORKER_VERSION CI 动态注入(前置 ops 确认后)
  - **Lane E exit**: `NanoSessionDO` 提取到独立 worker(`workers/session-do/`)+ context-core/filesystem-core 升级为 WorkerEntrypoint RPC

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
| **E-Architecture** | E1 | `NanoSessionDO` 提取到独立 worker(`workers/session-do/`) | `XL` | DO class 物理迁出 agent-core;新 wrangler.jsonc + service binding | **ZX4 完成后**(架构变更不应在 transport close 期同时执行) |
| **E-Architecture** | E2 | agent-core → session-do service binding 切换 + dual-track parity | `L` | agent-core 通过 service binding 调 session-do;短期 dual-track 验证 | E1 |
| **E-Architecture** | E3 | context-core 升级为 WorkerEntrypoint RPC | `L` | context-core 从 library-only 升级 | `-`(独立于 E1) |
| **E-Architecture** | E4 | filesystem-core 升级为 WorkerEntrypoint RPC | `L` | filesystem-core 从 library-only 升级 | `-`(独立于 E1) |

### 1.3 Lane / Phase 说明

#### Lane C — Protocol / Auth Hygiene

C1-C3 一组(jwt-shared 抽取链);C4-C5 一组(error code + envelope 文档化);C6 独立(client 集成)。**3 组互不依赖,可 fully parallel**。

**Phase C1 — 创建 `@haimang/jwt-shared`**: 已在 ZX3 §14.1 keep-set 显式预留位置。新建 `packages/jwt-shared/` 含 `collectVerificationKeys` / `importKey` / `base64Url` / `parseJwtHeader` / `verifyJwt` / `signJwt` / `JWT_LEEWAY_SECONDS` 等共享逻辑。

**Phase C2 — 两 worker 切换**: `workers/orchestrator-core/src/auth.ts` 删 lines 62-149 worker-local 实现,改 import 自 `@haimang/jwt-shared`;`workers/orchestrator-auth/src/jwt.ts` 同样改 import。两个 worker 的 8/8 + 42/42 测试必须保持全绿。

**Phase C3 — kid rotation 集成测试**: 新增 `workers/orchestrator-auth/test/kid-rotation.test.ts`;模拟 `JWT_SIGNING_KID = v1` 时签发的 token,在 `JWT_SIGNING_KID = v2` 切换后 5 分钟内仍接受(graceful overlap 期);> 5 分钟则 401。

**Phase C4 — `RpcErrorCode` ⊂ `FacadeErrorCode` 跨包断言**: `packages/orchestrator-auth-contract/src/facade-http.ts` 新增 `_rpcErrorCodesAreFacadeCodes: Record<typeof RpcErrorCode._type, true>` 跨包穷尽映射断言。**注意 per GPT 3.9 — 这是单向约束**(`FacadeErrorCode` 必须包含所有 `RpcErrorCode`,反向不要求);public wire 保持不变。

**Phase C5 — envelope 关系文档化**: `packages/orchestrator-auth-contract/README.md` + `packages/nacp-core/README.md` 加章节明确 `FacadeEnvelope<T>` 与 `Envelope<T>` 关系(public alias);facade public schema 不变;桥接 helper(`facadeFromAuthEnvelope` / `envelopeFromAuthLike`)的 invariants 文档化。

**Phase C6 — client heartbeat / replay 切 shared helper**: per GPT 3.8 显式冻结目标 = "替换为 shared helper",不是 "继续手写但行为对齐"。`clients/web/src/client.ts:191-220` 与 `clients/wechat-miniprogram/utils/nano-client.js:44-133` 的手写 heartbeat / resume / ack 删除;改用 `@haimang/nacp-session` root export 的 shared helper / adapter(必要时先补 browser/wechat adapter,而不是依赖未导出的深路径 import)。

#### Lane D — Product Surface + Ops

D1 是 ops 前置(owner-required);D2-D6 是业务面 endpoint。

**Phase D1 — WORKER_VERSION CI 动态化(ops 前置)**: per GPT 3.5 — 当前 `.github/workflows/deploy-preview.yml` **不存在**;`.github/workflows/` 只有 `workers.yml` + `publish-nacp.yml`。本 phase 先 owner-confirm 三件事:
- preview 部署 pipeline 在哪里执行?(GitHub Actions 还是 owner local wrangler?)
- 若 GitHub Actions: 新建 `deploy-preview.yml` workflow;wrangler env-fill `WORKER_VERSION = ${WORKER_NAME}@${GITHUB_SHA}`
- 若 owner local: 提供 `scripts/deploy-preview.sh` 并在 owner local 执行时 export 注入

**Phase D2 — catalog content**: `workers/orchestrator-core/src/index.ts:handleCatalog`(line 410-433)填充 skills / commands / agents registry。registry 数据可从 `.github/workflows` / docs / 或新增 `workers/orchestrator-core/src/catalog-content.ts` 静态注册。**所有 entry 必须 facade-http-v1 envelope 包装**。

**Phase D3 — `POST /sessions/{id}/messages`**: 多模态 message 输入;facade endpoint;backing 在 D1 `nano_conversation_messages` 表(已存在,见 `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`);envelope 包装。

**Phase D4 — `GET /sessions/{id}/files`**: artifact 拉取;facade endpoint;backing 在 R2 / 现有 attachment ref;envelope 包装。

**Phase D5 — `GET /me/conversations`**: 完整对话列表;在 ZX4 P3 之后做更顺手(pending+active+ended 状态机已落)。

**Phase D6 — `POST /me/devices/revoke`**: 设备管理;依赖 C2 jwt-shared 切完(JWT revocation 在 jwt-shared 内部统一)。

#### Lane E — Architecture Refactor

E1-E2 一组(DO 提取);E3-E4 一组(context/fs 升级)。**两组独立,可同时启动;但每组内部串行**。**强烈建议在 ZX4 完成后再启动 Lane E**(transport close 期不应同时做大架构变更)。

**Phase E1 — `NanoSessionDO` 提取**: `workers/agent-core/src/host/do/nano-session-do.ts` → 新 worker `workers/session-do/`;新 wrangler.jsonc 含 DO binding;agent-core 移除 DO migrations,改通过 service binding 调用。

**Phase E2 — agent-core → session-do service binding 切换**: agent-core 内部 `forwardHttpAction` / `forwardRpcAction` 改通过 `env.SESSION_DO_BINDING.fetch()` 调用 session-do worker;短期 dual-track 验证(agent-core 内 DO call vs service binding call 行为一致)。

**Phase E3 — context-core 升级真 RPC**: context-core 从 library-only(`workers/context-core/src/index.ts` 仅 401 binding-scope-forbidden)升级为 `WorkerEntrypoint` 暴露 `assemble` / `compact` / `get_layers` 等 RPC method;agent-core 改通过 service binding 调用 context-core RPC。

**Phase E4 — filesystem-core 升级真 RPC**: 同 E3 模式;`assemble_artifact` / `read_file` / `write_file` 等 RPC method;agent-core 改通过 service binding 调用。

### 1.4 执行策略说明

- **Lane 独立性**: C / D / E 互不阻塞;owner 可同时启动多 lane 或单 lane 推进
- **Lane 内部串行**: 每 lane 内 phase 严格串行(jwt-shared 必须先抽再切;DO 必须先提取再 binding 切换)
- **测试推进原则**: 每 phase 跑全 worker tests + root-guardians;C3 引入 kid rotation 集成测试;E2 引入 DO service binding e2e
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
│   ├── .github/workflows/deploy-preview.yml(new — D1 ops 前置后)
│   ├── workers/*/wrangler.jsonc(D1 WORKER_VERSION env-fill)
│   ├── workers/orchestrator-core/src/{index,catalog-content}.ts(D2)
│   ├── workers/orchestrator-core/src/index.ts(D3-D6 4 个 facade endpoint)
│   ├── workers/orchestrator-core/src/session-read-model.ts(D5 me/conversations)
│   └── workers/orchestrator-auth/src/(D6 device revocation)
└── Lane E — Architecture Refactor
    ├── workers/session-do/(new — E1)
    ├── workers/session-do/wrangler.jsonc(E1)
    ├── workers/agent-core/(E1+E2 移除 DO + 改 service binding)
    ├── workers/context-core/src/(E3 升级 WorkerEntrypoint)
    └── workers/filesystem-core/src/(E4 升级 WorkerEntrypoint)
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
- **[S8]** `NanoSessionDO` 提取到独立 worker(R24,Lane E 强建议 ZX4 完成后)
- **[S9]** context-core / filesystem-core 升级真 RPC(ZX2 [O5])

### 2.2 Out-of-Scope

- **[O1]** transport finalization(R28/R29/R31/P3-05 flip)→ **ZX4**
- **[O2]** session 语义闭环(permission/usage/elicitation/me-sessions pending truth)→ **ZX4 Lane B**
- **[O3]** user-do.ts seam refactor → **ZX4 Phase 0**(早期 seam,per GPT 3.7)
- **[O4]** WeChat 真机 smoke(R17)→ owner-action(无 plan)
- **[O5]** D1 schema 大改动 — 新 product endpoint 应复用现有 truth(`nano_conversation_messages` / `nano_conversation_turns` / R2 storage),不新建平行表

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
| D1-00 | D / Phase D1 | **owner-action: deploy pipeline 确认** | `ops` | n/a | 确认 preview 部署在 GitHub Actions 还是 owner local;再决定 WORKER_VERSION 注入策略 | medium |
| D1-01 | D / Phase D1 | WORKER_VERSION 注入(GH Actions 路径)| `add` | `.github/workflows/deploy-preview.yml`(new) | wrangler env-fill `WORKER_VERSION = ${WORKER_NAME}@${GITHUB_SHA}` | low |
| D1-02 | D / Phase D1 | WORKER_VERSION 注入(owner local 路径) | `add` | `scripts/deploy-preview.sh`(new) | export-driven 注入 | low |
| D2-01 | D / Phase D2 | catalog content registry 静态注册 | `add` | `workers/orchestrator-core/src/catalog-content.ts`(new) + `index.ts:handleCatalog` | skills / commands / agents 真实数据 | medium |
| D3-01 | D / Phase D3 | `POST /sessions/{id}/messages` 实现 | `add` | `workers/orchestrator-core/src/{index,session-lifecycle}.ts` | 多模态 message 输入 + D1 backing | medium |
| D4-01 | D / Phase D4 | `GET /sessions/{id}/files` 实现 | `add` | `workers/orchestrator-core/src/index.ts` | artifact 拉取 + R2 backing | medium |
| D5-01 | D / Phase D5 | `GET /me/conversations` 实现 | `add` | `workers/orchestrator-core/src/{index,session-read-model}.ts` | 完整对话列表(基于 ZX4 P3 后的 pending+active+ended 视图)| low |
| D6-01 | D / Phase D6 | `POST /me/devices/revoke` 实现 | `add` | `workers/orchestrator-core/src/index.ts` + `workers/orchestrator-auth/src/` | 设备管理 + JWT revocation(用 C2 jwt-shared) | medium |
| E1-01 | E / Phase E1 | 创建 `workers/session-do/` worker | `add` | `workers/session-do/` 完整目录 | 新 worker shell + wrangler.jsonc + DO binding | high |
| E1-02 | E / Phase E1 | `NanoSessionDO` 物理迁移到 session-do | `refactor` | `workers/agent-core/src/host/do/` → `workers/session-do/src/` | DO class + migrations 迁出 agent-core | high |
| E2-01 | E / Phase E2 | agent-core 改 service binding 调用 session-do | `refactor` | `workers/agent-core/src/host/internal.ts` + `workers/agent-core/wrangler.jsonc` | 通过 `env.SESSION_DO_BINDING.fetch()` 调用 | high |
| E2-02 | E / Phase E2 | dual-track parity 验证(agent-core local DO vs service binding) | `verify` | parity-bridge | 短期双轨,确认行为一致后切单 | medium |
| E3-01 | E / Phase E3 | context-core 升级 WorkerEntrypoint | `refactor` | `workers/context-core/src/index.ts` + wrangler.jsonc | 暴露 `assemble` / `compact` / `get_layers` RPC method | high |
| E3-02 | E / Phase E3 | agent-core 改 RPC 调用 context-core | `refactor` | `workers/agent-core/src/` + service binding | 用 RPC 取代 library import | medium |
| E4-01 | E / Phase E4 | filesystem-core 升级 WorkerEntrypoint | `refactor` | `workers/filesystem-core/src/index.ts` + wrangler.jsonc | 暴露 `assemble_artifact` / `read_file` / `write_file` RPC method | high |
| E4-02 | E / Phase E4 | agent-core 改 RPC 调用 filesystem-core | `refactor` | 同 E3-02 | 用 RPC 取代 library import | medium |

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

### Q4

- **影响范围**: `Phase E1 — NanoSessionDO 提取的迁移策略`
- **为什么必须确认**: DO 提取需要 D1 migration tag 规划(避免与 agent-core 现有 migration 冲突);也涉及现有 DO storage(SQLite-backed DO)的迁移
- **当前建议 / 倾向**: E1 第一周仅做物理迁移 + 兼容路径(agent-core 内仍可调本地 DO);E2 切 service binding;dual-track parity ≥ 24h 后再切单
- **Q**: Lane E 的 DO 迁移是否同意"物理迁出 → 兼容期 → service binding 切换 → dual-track 验证 → 切单"五步?
- **A**: 同意,但兼容期必须时间盒化,且文档口径要同步改成"6 个业务 worker + 1 个 session-do 基础设施 worker"而不是继续写成 6 个真 worker。

### Q5

- **影响范围**: `Phase D3 + D4 — product endpoint 的 D1 schema 复用`
- **为什么必须确认**: per ZX4 plan GPT review §3.4 单一 truth 原则,D3/D4 应复用现有 D1 truth(`nano_conversation_messages` / R2 attachment)而非新建平行表
- **当前建议 / 倾向**: 复用;若发现 schema 不够,先讨论扩展现有表,不新建
- **Q**: D3/D4 是否冻结为"复用现有 D1 truth + R2 storage,不新建平行表"?
- **A**: 同意。冻结为复用现有 D1 truth + R2 storage;若 schema 不足,只允许扩展现有表/索引/字段,不新建平行表。

### Q6

- **影响范围**: `Phase E3 + E4 — context/filesystem 升级 RPC 的版本兼容`
- **为什么必须确认**: 这两个 worker 当前是 library-only;升级为 WorkerEntrypoint 后 agent-core 必须改 import → service binding。是否在升级期间保留 library import 作 fallback?
- **当前建议 / 倾向**: 不保留 library 双轨(避免 ZX2 internal-http-compat 类似的 retired-with-rollback 长期挂账);一次性切换
- **Q**: E3/E4 是否冻结为"一次性切 service binding,不保留 library fallback"?
- **A**: 不同意无缓冲一次性切换。冻结为短期 shim 迁移: 先补 RPC contract + adapter,在 agent-core 保留明确时间盒化 compat shim / test seam,待 cross-e2e 与 worker tests 稳定后再删除库内 import;禁止长期双轨,但不做零缓冲硬切。

---

## 6. 风险与依赖

| 风险 / 依赖 | Lane | 描述 | 当前判断 | 应对方式 |
|-------------|------|------|----------|----------|
| C2 切 jwt-shared 破坏 auth flow | C | 两 worker JWT 验证逻辑切到新 package | medium | C2 必须 8/8 + 42/42 baseline 不变;若失败 rollback C1 |
| C3 kid rotation 5 分钟 overlap 期阈值不当 | C | 5 分钟太短/太长都有问题 | low | 先按 5 分钟实现;owner 调整阈值在 wrangler env 中可配 |
| C4 跨包断言破坏 nacp-core 自由演进 | C | 未来 nacp-core 加 error code 时必须同步 facade | low | 这是设计意图;断言失败即 build break,迫使同步 |
| C6 client 切 shared helper 引入新 bug | C | 手写实现可能含未文档化的 quirk | medium | C6 后跑 web + wechat live e2e baseline |
| D1 deploy pipeline 不存在 | D | per GPT 3.5 当前 `.github/workflows/deploy-preview.yml` 不存在 | medium | D1-00 先 owner-confirm;不冻结路径之前不写代码 |
| D3/D4 复用现有 D1 truth 但 schema 可能不足 | D | `nano_conversation_messages` 是否承得住多模态? | medium | Q5 owner 冻结后,如不足再讨论扩展 |
| E1 DO 物理迁出破坏 agent-core 现有测试 | E | 1057 agent-core test 中很多直接 instance NanoSessionDO | high | E1 保留 agent-core 兼容期(同时含 import + service binding 双路径);测试逐步迁移 |
| E2 dual-track parity 期间双 DO 同时活跃 | E | 短期 agent-core local DO + session-do worker 都活跃 | high | dual-track 期 ≥ 24h;parity log 监控;0 误报后切单 |
| E3/E4 升级真 RPC 破坏 agent-core 现有 capability call | E | agent-core capability 编译时通过 import 调 context/filesystem | high | E3/E4 完成前必须有 RPC contract + service binding shim;不允许同时改 import + service binding |
| 多 lane 并行 git conflict | C+D+E | C/D/E 都触碰 `workers/orchestrator-core/src/` | medium | 每 phase 独立 PR;每 lane owner 协调 |

---

## 7. Action-Plan 整体测试与整体收口

### 7.1 整体测试方法

- **基础校验**: 6 worker + 7 keep-set 包测试(ZX4 P0 后 + jwt-shared 创建后)
- **Lane C 测试**: C2 后 8/8 + 42/42 全绿;C3 kid rotation 集成测试 pass;C4 跨包断言编译通过(失败即 build break);C6 后 web + wechat live e2e baseline
- **Lane D 测试**: D2 catalog content endpoint live e2e;D3-D6 各自的 facade endpoint integration test
- **Lane E 测试**: E1 后 session-do worker tests + agent-core baseline 不变;E2 dual-track parity ≥ 24h 0 误报;E3/E4 升级后 agent-core 通过 service binding 调用 context/filesystem 的 cross-e2e

### 7.2 各 Lane 独立收口标准

#### Lane C 收口
1. `@haimang/jwt-shared` package 发布到 keep-set
2. orchestrator-core + orchestrator-auth 切 jwt-shared 完成 + 全绿
3. JWT kid rotation 集成测试 pass(graceful overlap 5 分钟)
4. `RpcErrorCode` ⊂ `FacadeErrorCode` 跨包断言 编译通过
5. envelope 关系文档化完成
6. web + wechat client heartbeat/replay 切 shared helper 完成

#### Lane D 收口
1. WORKER_VERSION CI 动态注入(GH Actions 或 owner local 路径已选定且工作)
2. catalog content registry 真实数据填充
3. `POST /sessions/{id}/messages` + `GET /sessions/{id}/files` + `GET /me/conversations` + `POST /me/devices/revoke` 4 个 facade endpoint 业务实现 + facade-http-v1 envelope 包装

#### Lane E 收口
1. `NanoSessionDO` 提取到 `workers/session-do/` 独立 worker
2. agent-core 通过 service binding 调用 session-do(单轨,non-dual-track)
3. context-core 升级为 WorkerEntrypoint RPC,agent-core 改 service binding 调用
4. filesystem-core 升级为 WorkerEntrypoint RPC,agent-core 改 service binding 调用

### 7.3 完成定义(Definition of Done)

| Lane | 完成定义 |
|------|----------|
| Lane C | `jwt-shared 抽取 + 两 worker 切换 + kid rotation 测试 + RpcErrorCode⊂FacadeErrorCode 断言 + envelope 文档化 + client shared helper migration` |
| Lane D | `WORKER_VERSION CI 动态注入 + catalog content + 4 个 product endpoint(facade-http-v1 envelope)` |
| Lane E | `NanoSessionDO 独立 worker + context-core/filesystem-core 真 RPC + agent-core 改 service binding 调用` |

### 7.4 ZX5 整体收口(可选)

ZX5 的 3 lanes 互不阻塞,可独立 close;owner 可选择:
- **整体 close**: 3 lanes 全部完成后写 ZX5-closure.md
- **lane-by-lane close**: 每 lane 完成单独 close(如 ZX5-C-closure.md / ZX5-D-closure.md / ZX5-E-closure.md)

---

## 8. 执行后复盘关注点

- **Lane C 切 jwt-shared 是否真消除两 worker 的代码漂移**: `待 ZX5 执行后回填`
- **kid rotation 5 分钟阈值是否实际场景合理**: `待 ZX5 执行后回填`
- **Lane D product endpoint 是否真复用现有 D1 truth(无平行表)**: `待 ZX5 执行后回填`
- **Lane E DO 提取是否引入隐藏的 cross-worker latency**: `待 ZX5 执行后回填`
- **多 lane 并行的 git conflict 频率**: `待 ZX5 执行后回填`

---

## 9. 结语

ZX5 是 ZX4 GPT review re-baseline 后的"非阻塞收尾" plan,3 个 lanes 各自独立解决一类问题:

- **Lane C(协议/auth 卫生)**: 把 jwt-shared 抽到 single source of truth;把 `RpcErrorCode ⊂ FacadeErrorCode` 用编译期断言锁住;把 envelope 关系文档化(不改 public wire);把 client heartbeat/replay 切到 shared helper。**让协议层从"手写 + 重复 + 隐式约定"变成"single source + 编译期约束 + 文档明确"**。
- **Lane D(产品面 + ops)**: catalog content + 4 个 product endpoint + WORKER_VERSION CI 动态注入。**让 facade-http-v1 从"contract 冻结 + 占位"升级为"业务可用"**。
- **Lane E(架构 refactor)**: NanoSessionDO 提取 + context/filesystem 升级真 RPC。**让拓扑从当前 6-worker + library/DO 混合态演进为 6 个业务 worker + 1 个 session-do 基础设施 worker的独立协作形态**。

ZX5 完成后,**zero-to-real 系列的所有 ZX2 carryover 全部收口**;架构升级到 6 个业务 worker + 1 个 session-do 基础设施 worker 的独立协作形态;协议/auth 收敛到 single source;产品面具备业务能力。**ZX5 是 zero-to-real 系列的真正终章**。

> v1 by Opus 4.7(2026-04-28)— created after ZX4 GPT review re-baseline。3 lanes 独立设计;Lane E 强建议 ZX4 完成后再启动。等 owner 审核 Q1-Q6 + 选定 lane 启动顺序。
