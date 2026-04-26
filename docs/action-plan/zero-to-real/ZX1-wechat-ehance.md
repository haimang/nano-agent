# ZX1 — WeChat Enhance and Debug Surfaces

> 服务业务簇: `zero-to-real / ZX1 / wechat-enhance-and-debug-surfaces`
> 计划对象: `把小程序从 code-level 登录 baseline 推进到可解密自动登录，并补齐 worker health/debug 与前端 API 文档资产`
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-25`
> 文件位置: `docs/action-plan/zero-to-real/ZX1-wechat-ehance.md`
> 关联设计 / 调研文档:
> - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
> - `docs/handoff/zero-to-real-to-next-phase.md`
> - `docs/issue/zero-to-real/Z4-closure.md`
> - `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
> - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md`
> - `docs/design/zero-to-real/ZX-qna.md`
> 文档状态: `executed`

---

## 0. 执行背景与目标

zero-to-real 已经闭合，但 `clients/wechat-miniprogram` 当前仍主要停留在 **`wx.login -> code -> /auth/wechat/login`** 的 baseline：`orchestrator-auth` 只调用 `jscode2session` 获取 `openid`，并据此做 bootstrap 登录；它还没有把微信登录升级为 **带 `session_key` 解密能力的自动登录主路径**，也没有为前端提供统一的 worker live/debug 观察面与正式 API 文档资产。

因此 ZX1 的目标不是重开 zero-to-real，而是在已成立的 6-worker baseline 上做一轮 **微信登录增强 + 配置入口规范化 + worker health 聚合 + clients/api-docs 建设**：

- **把 WeChat auth 从 code-level baseline 升级到可解密自动登录**
- **把 auth worker 的 JWT / salt / WeChat 配置入口做成明确、可开发、可迁移到 Cloudflare secrets 的形态**
- **让前端可以通过 `orchestrator-core` 看到每个 worker 当前是否 live、跑的是什么版本**
- **把面向前端的接口使用说明沉淀到 `clients/api-docs/`**

- **服务业务簇**：`zero-to-real / ZX1`
- **计划对象**：`WeChat Enhance and Debug Surfaces`
- **本次计划解决的问题**：
  - 小程序当前只具备 `code -> openid` 登录，不具备 `encryptedData + iv` 的服务器端解密与自动登录链路
  - auth worker 的 JWT / salt / WeChat 秘钥只有入口雏形，缺少“开发期可接入、上线期迁 secret”的成套约定
  - 6 个 worker 虽大多已有 `/health` 或 shell probe，但没有统一版本字段，也没有 `orchestrator-core` 聚合 debug 面
  - `clients/` 下没有按业务簇组织的正式 API 文档目录
- **本次计划的直接产出**：
  - `packages/orchestrator-auth-contract/**` 的 WeChat 登录输入升级
  - `workers/orchestrator-auth/**` 的 WeChat 解密与配置入口增强
  - `workers/orchestrator-core/**` 的 worker health 聚合 debug façade
  - `clients/api-docs/**`
  - `docs/issue/zero-to-real/ZX1-closure.md`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先冻结 contract 与安全边界，再做 WeChat 登录增强，再补 health/debug，最后沉淀 API docs 与 closure** 的方式推进。ZX1 不是一次“前端方便性补丁”，而是一轮 **backend supporting pack**：所有小程序增强都必须以 auth contract、worker config、health/debug truth 为中心，而不是只改客户端页面。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Contract & Secret Surface Freeze | `S` | 冻结 WeChat decrypt 输入、secret 命名与 debug health 返回字段 | `Z5 closed` |
| Phase 2 | WeChat Decrypt Auto-Login | `M` | 在 `orchestrator-auth` 建立 `code + session_key + decrypt` 自动登录主链 | `Phase 1` |
| Phase 3 | Auth Config Hygiene | `S` | 建立 JWT / salt / WeChat 开发入口与 secret 迁移纪律 | `Phase 2` |
| Phase 4 | Worker Health Matrix | `M` | 统一 6-worker health/version shape，并由 `orchestrator-core` 聚合代理 | `Phase 1` |
| Phase 5 | Client API Docs | `S` | 在 `clients/api-docs/` 按业务簇沉淀接口清单与示例 | `Phase 2` `Phase 4` |
| Phase 6 | ZX1 Closure | `S` | 写 closure，声明真实接通面、调试面与残留问题 | `Phase 5` |

### 1.3 Phase 说明

1. **Phase 1 — Contract & Secret Surface Freeze**
   - **核心目标**：把“微信登录到底收哪些字段、secret 到底怎么进、health 到底返回什么”先写死。
   - **为什么先做**：如果不先 freeze，后续实现会同时在客户端、auth worker、debug route 三头漂移。
2. **Phase 2 — WeChat Decrypt Auto-Login**
   - **核心目标**：把 `wechatLogin` 从 `code-only` 升级到 `code + decrypt payload`。
   - **为什么放这里**：这是小程序真实接口接通的核心业务值。
3. **Phase 3 — Auth Config Hygiene**
   - **核心目标**：让 JWT/salt/appid/secret 的开发入口明确，但不把真实 secret check-in。
   - **为什么独立成 Phase**：这是安全与工程纪律问题，不能埋在业务改动里。
4. **Phase 4 — Worker Health Matrix**
   - **核心目标**：让前端有统一 debug 观察面，而不是逐 worker 猜测谁挂了。
   - **为什么放这里**：小程序进入真请求后，最需要的是 worker live/version 可见性。
5. **Phase 5 — Client API Docs**
   - **核心目标**：把 auth/session/health 的前端消费方式写清楚。
   - **为什么放在这里**：文档必须基于已落地的 route/shape，而不是预写 wishlist。
6. **Phase 6 — ZX1 Closure**
   - **核心目标**：给 ZX1 一个诚实结论：哪些接口是真接通、哪些仍只是 baseline。
   - **为什么放最后**：closure 需要建立在真实调通与 smoke 之上。

### 1.4 执行策略说明

- **执行顺序原则**：`先 freeze 输入与 secret surface，再改 auth，再补 health，再写 docs`
- **安全原则**：`仓库里只新增 config entry / key name / local-dev ingress，不提交真实 JWT/WeChat secret`
- **public-owner 原则**：`所有前端可见 debug 接口仍由 orchestrator-core 暴露；不新增第二个 public auth/debug owner`
- **worker-health 原则**：`每个 worker 维持 canonical /health；orchestrator-core 再做聚合代理，而不是让前端分别打内部 worker`
- **文档同步原则**：`clients/api-docs 只记录当前真实 façade，不为未来内部接口写外露文档`

### 1.5 本次 action-plan 影响目录树

```text
ZX1 WeChat Enhance and Debug Surfaces
├── clients/
│   ├── wechat-miniprogram/
│   └── api-docs/                             [new]
│       ├── README.md                         [new]
│       ├── auth.md                           [new]
│       ├── wechat-auth.md                    [new]
│       ├── session.md                        [new]
│       └── worker-health.md                  [new]
├── packages/
│   └── orchestrator-auth-contract/
│       └── src/index.ts
├── workers/
│   ├── orchestrator-auth/
│   │   ├── src/{index,service,wechat}.ts
│   │   └── wrangler.jsonc
│   ├── orchestrator-core/
│   │   ├── src/index.ts
│   │   └── wrangler.jsonc
│   ├── agent-core/
│   │   ├── src/index.ts
│   │   └── wrangler.jsonc
│   ├── bash-core/
│   │   ├── src/index.ts
│   │   └── wrangler.jsonc
│   ├── context-core/
│   │   ├── src/index.ts
│   │   └── wrangler.jsonc
│   └── filesystem-core/
│       ├── src/index.ts
│       └── wrangler.jsonc
├── test/
│   ├── package-e2e/orchestrator-core/
│   └── cross-e2e/
└── docs/
    └── issue/zero-to-real/
        └── ZX1-closure.md                    [new]
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 扩展 WeChat 登录 contract，使后端可接收并处理解密自动登录所需字段
- **[S2]** 在 `orchestrator-auth` 中实现 `jscode2session + session_key decrypt + identity bootstrap/update`
- **[S3]** 明确 `PASSWORD_SALT` / JWT signing key / `WECHAT_APPID` / `WECHAT_SECRET` 的开发入口与迁移到 Cloudflare secret 的流程
- **[S4]** 统一 6 个 worker 的 health/version 输出字段，并通过 `orchestrator-core` 聚合代理
- **[S5]** 新建 `clients/api-docs/`，按业务簇沉淀接口文档

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 把真实 `JWT_SECRET` / `WECHAT_SECRET` check-in 到仓库
- **[O2]** 重做完整微信账号体系、手机号授权、UnionID 运营体系
- **[O3]** 开放每个内部 worker 的单独 public debug 面
- **[O4]** 将 `clients/wechat-miniprogram` 升级为产品级完整 UI

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `code + encrypted_data + iv` 登录 | `in-scope` | 这是“自动登录”最小业务值 | `ZX1 执行期` |
| 真实 secret 入仓 | `out-of-scope` | 不符合安全纪律；只能建立入口与非提交式本地开发方案 | `永不重评` |
| `/debug/workers/health` 聚合面 | `in-scope` | 前端要感知 6-worker live/version，必须有 façade | `ZX1 执行期` |
| 手机号解密 / 用户资料完整档案 | `out-of-scope` | 超出 first-wave mini-program login hardening | `后续 identity/product 阶段` |
| `clients/api-docs/*` | `in-scope` | 当前 clients 已成为 real baseline，需要正式前端消费文档 | `ZX1 执行期` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | wechat auth contract freeze | `update` | `packages/orchestrator-auth-contract/**` | 冻结 WeChat decrypt 登录输入与 envelope 边界 | `high` |
| P1-02 | Phase 1 | secret surface freeze | `update` | `workers/orchestrator-auth/wrangler.jsonc` docs | 写死 config key 名、开发入口与 secret 迁移纪律 | `high` |
| P1-03 | Phase 1 | health response freeze | `update` | `workers/*/src/index.ts` | 冻结每个 worker health/version 输出字段 | `medium` |
| P2-01 | Phase 2 | jscode2session upgrade | `update` | `workers/orchestrator-auth/src/wechat.ts` | 让 WeChat client 返回 `session_key` 等 decrypt 所需事实 | `high` |
| P2-02 | Phase 2 | decrypt auto-login service | `update` | `workers/orchestrator-auth/src/service.ts` | 建立 code + decrypt payload 自动登录主链 | `high` |
| P2-03 | Phase 2 | mini-program auth payload align | `update` | `clients/wechat-miniprogram/**` | 小程序改为上送 decrypt 所需字段，而非只传 code | `medium` |
| P3-01 | Phase 3 | auth local-dev secret ingress | `update` | `workers/orchestrator-auth/wrangler.jsonc` | 增加开发期可注入的 key/salt/appid/secret 入口 | `high` |
| P3-02 | Phase 3 | secret migration docs | `add` | `clients/api-docs/auth.md` / closure | 说明本地开发与 Cloudflare secret 迁移方式 | `medium` |
| P4-01 | Phase 4 | worker self health standardization | `update` | `workers/*/src/index.ts` | 6 个 worker 都返回统一的 health/version shape | `medium` |
| P4-02 | Phase 4 | orchestrator debug aggregation | `update` | `workers/orchestrator-core/**` | `orchestrator-core` 代理全部 worker health | `high` |
| P4-03 | Phase 4 | client debug consumption baseline | `update` | `clients/web/**` `clients/wechat-miniprogram/**` | 前端可查看 worker live/version | `medium` |
| P5-01 | Phase 5 | api-docs scaffold | `add` | `clients/api-docs/**` | 建立按业务簇分文件的接口文档目录 | `low` |
| P5-02 | Phase 5 | auth/session/debug docs fill | `add` | `clients/api-docs/*.md` | 把请求格式、返回样例、错误样例写清楚 | `medium` |
| P6-01 | Phase 6 | ZX1 closure | `add` | `docs/issue/zero-to-real/ZX1-closure.md` | 形成 ZX1 的真实结论与 residual | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Contract & Secret Surface Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | wechat auth contract freeze | 扩展 `WeChatLoginInputSchema`，至少允许 `code`、`encrypted_data`、`iv`，并明确哪些字段 first-wave 必填/可选；保留 response envelope 不漂移 | `packages/orchestrator-auth-contract/src/index.ts` | auth contract 不再停留在 code-only | contract tests | schema 与客户端 payload 对齐 |
| P1-02 | secret surface freeze | 明确 `PASSWORD_SALT`、`JWT_SIGNING_KID`、`JWT_SIGNING_KEY_<kid>`、`WECHAT_APPID`、`WECHAT_SECRET`、`WECHAT_API_BASE_URL` 的命名与开发入口 | `workers/orchestrator-auth/wrangler.jsonc` | config surface 清晰 | doc/config review | key 名与用途被写死 |
| P1-03 | health response freeze | 冻结 worker health 标准字段：`worker`、`status`、`worker_version`、`phase`、`nacp_core_version?`、`nacp_session_version?`、`bindings/config flags` | `workers/*/src/index.ts` | health 输出格式统一 | worker tests | 6 个 worker 输出 shape 一致 |

### 4.2 Phase 2 — WeChat Decrypt Auto-Login

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | jscode2session upgrade | `createWeChatClient()` 不再只返回 `openid`；需返回 `session_key` 以及可选 `unionid`，供后续 decrypt 使用；`session_key` 只在服务端使用，不向 client 回传 | `workers/orchestrator-auth/src/wechat.ts` | decrypt 所需事实进入 auth worker | unit tests | 可得到 server-side decrypt input |
| P2-02 | decrypt auto-login service | `wechatLogin()` 支持 `code + encrypted_data + iv`；能解密拿到稳定身份资料后登录/注册；若 decrypt 缺失或失败，按 frozen policy 明确 reject 还是 fallback | `workers/orchestrator-auth/src/service.ts` | 微信登录进入真正“自动登录”链路 | unit tests / package tests | code-only baseline 与 decrypt baseline 的取舍被写死并实现 |
| P2-03 | mini-program auth payload align | 小程序从 `wx.login` + profile/session payload 组装 auth 请求；不再只发送 `{ code }` | `clients/wechat-miniprogram/pages/auth/index.js` `utils/api.js` | 小程序向后端发送完整 auth payload | mini-program smoke | 真请求 payload 与 contract 一致 |

### 4.3 Phase 3 — Auth Config Hygiene

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | auth local-dev secret ingress | 在 `wrangler.jsonc` 明确 required secrets 注释与开发期入口；如需本地开发，采用非提交式 `.dev.vars` / shell env / `wrangler secret put`，而不是硬编码真实值 | `workers/orchestrator-auth/wrangler.jsonc` | 开发期可配置、仓库不泄密 | config review | 入口明确但无真实 secret 入仓 |
| P3-02 | secret migration docs | 说明“开发期入口 → preview/prod Cloudflare secret”的迁移步骤与注意事项 | `clients/api-docs/auth.md` `ZX1-closure.md` | 前后端与部署者都知道怎么迁 | doc review | 流程不再靠口头传递 |

### 4.4 Phase 4 — Worker Health Matrix

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | worker self health standardization | 统一 6 个 worker 的 `/health` 结果；推荐新增 `worker_version`（来自 deploy env 或 build stamp），保留已有 `phase`/binding booleans | `workers/*/src/index.ts` | self probe 统一且可比较 | worker tests | 每个 worker 都能回答 live/version |
| P4-02 | orchestrator debug aggregation | `orchestrator-core` 新增聚合 debug route（建议 `/debug/workers/health`），汇总 self + auth + agent + bash + context + filesystem | `workers/orchestrator-core/src/index.ts` `wrangler.jsonc` | 前端只调一个 façade 就能看到 6-worker 健康矩阵 | package-e2e / cross-e2e | orchestrator 返回聚合 JSON，且不会要求前端直接打内部 worker |
| P4-03 | client debug consumption baseline | web 与 mini-program 加最小 debug 面板或调试页，显示 worker live/version/status | `clients/web/**` `clients/wechat-miniprogram/**` | 前端调试面成立 | client smoke | 可肉眼确认 worker live/version |

### 4.5 Phase 5 — Client API Docs

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | api-docs scaffold | 新建 `clients/api-docs/README.md` 与业务簇文档骨架 | `clients/api-docs/**` | 文档目录正式存在 | doc review | 目录结构稳定 |
| P5-02 | auth/session/debug docs fill | 至少写 `auth.md`、`wechat-auth.md`、`session.md`、`worker-health.md`；每份包含 route、method、鉴权要求、请求体、成功/失败示例、字段说明、常见错误 | 同上 | 前端有正式消费手册 | doc review | 文档能指导前端直接发请求 |

### 4.6 Phase 6 — ZX1 Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P6-01 | ZX1 closure | 写 `ZX1-closure.md`，说明哪些链路真实接通、哪些仍是 baseline，哪些残余留给下一阶段 | `docs/issue/zero-to-real/ZX1-closure.md` | ZX1 有可消费结论 | doc review | closure 与真实代码/调试面一致 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Contract & Secret Surface Freeze

- **Phase 目标**：先冻结登录输入、安全入口与 health/debug 输出，避免实现期再争边界
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `packages/orchestrator-auth-contract/src/index.ts`
  - `workers/orchestrator-auth/wrangler.jsonc`
  - `workers/*/src/index.ts`
- **具体功能预期**：
  1. WeChat auth input 不再只有 `code`。
  2. secret key 名与开发入口被明确写死。
  3. health/version 输出形成统一格式。
- **具体测试安排**：
  - **单测**：`auth contract schema tests`
  - **集成测试**：`无`
  - **回归测试**：`相关 worker existing tests`
  - **手动验证**：`review config + route shape`
- **收口标准**：
  - contract 与客户端 payload 边界清晰
  - 仓库内不出现真实 secret
  - health 返回字段被冻结
- **本 Phase 风险提醒**：
  - 最容易一边改 auth、一边临时扩字段，最后 contract 漂移

### 5.2 Phase 2 — WeChat Decrypt Auto-Login

- **Phase 目标**：把微信登录升级为后端可解密、可自动登录的真实主路径
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `workers/orchestrator-auth/src/{wechat,service}.ts`
  - `clients/wechat-miniprogram/**`
- **具体功能预期**：
  1. auth worker 拿到 `session_key` 后可在服务端做 decrypt。
  2. 小程序不再只依赖 openid bootstrap。
  3. decrypt 失败路径与 fallback policy 被明确表达，而不是 silent fallback。
- **具体测试安排**：
  - **单测**：`wechat client / auth service`
  - **集成测试**：`orchestrator-auth package tests`
  - **回归测试**：`auth-related package-e2e`
  - **手动验证**：`微信开发者工具一次真实登录`
- **收口标准**：
  - 小程序可走 decrypt 登录链
  - 新老 payload 边界清晰
  - 错误以 typed envelope 暴露
- **本 Phase 风险提醒**：
  - 最容易把 decrypt 失败自动降级为成功 bootstrap，导致身份真相不诚实

### 5.3 Phase 3 — Auth Config Hygiene

- **Phase 目标**：建立可开发、可部署、但不泄密的 auth 配置纪律
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `workers/orchestrator-auth/wrangler.jsonc`
  - `clients/api-docs/auth.md`
- **具体功能预期**：
  1. 本地开发知道去哪里填 key/salt/appid/secret。
  2. preview/prod 知道如何迁到 Cloudflare secret。
  3. 仓库不会因此变成 secret 容器。
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`deploy:dry-run`
  - **回归测试**：`auth worker typecheck/build/test`
  - **手动验证**：`config walkthrough`
- **收口标准**：
  - required secrets 清单存在
  - local-dev 与 deploy 迁移路径明确
  - 没有真实 secret committed
- **本 Phase 风险提醒**：
  - 最容易为了“先跑通”把真实 key 直接写进 `wrangler.jsonc`

### 5.4 Phase 4 — Worker Health Matrix

- **Phase 目标**：让前端通过 `orchestrator-core` 获取 6-worker live/version truth
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/**`
  - `workers/agent-core/**`
  - `workers/orchestrator-auth/**`
  - `workers/bash-core/**`
  - `workers/context-core/**`
  - `workers/filesystem-core/**`
  - `clients/web/**`
  - `clients/wechat-miniprogram/**`
- **具体功能预期**：
  1. 每个 worker 都能回答自己的 live/version。
  2. `orchestrator-core` 返回一个聚合 health 矩阵。
  3. 前端不需要知道内部 worker URL，就能判断后端哪里挂了。
- **具体测试安排**：
  - **单测**：`health payload builders`
  - **集成测试**：`orchestrator-core health aggregation tests`
  - **回归测试**：`package-e2e / cross-e2e`
  - **手动验证**：`web / mini-program debug 面`
- **收口标准**：
  - 6-worker health 返回统一 shape
  - orchestrator-core 聚合 route 可用
  - 前端能显示 worker live/version
- **本 Phase 风险提醒**：
  - 最容易把内部 topology 过度泄漏给匿名公网；debug 字段应克制并保留 owner façade

### 5.5 Phase 5 — Client API Docs

- **Phase 目标**：让前端有可直接消费的 auth/session/debug 使用说明
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - `clients/api-docs/README.md`
  - `clients/api-docs/auth.md`
  - `clients/api-docs/wechat-auth.md`
  - `clients/api-docs/session.md`
  - `clients/api-docs/worker-health.md`
- **本 Phase 修改文件**：
  - `无`
- **具体功能预期**：
  1. 文档按业务簇拆分，不做大杂烩。
  2. 每份文档都包含 route、request、response、error、usage notes。
  3. 前端可按 façade 使用，而不是阅读 worker 源码猜接口。
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`无`
  - **手动验证**：`按文档发请求做 spot-check`
- **收口标准**：
  - `clients/api-docs/` 成立
  - 业务簇拆分合理
  - 示例基于真实接口而非伪造
- **本 Phase 风险提醒**：
  - 最容易把内部 worker route 误写成前端 public route

### 5.6 Phase 6 — ZX1 Closure

- **Phase 目标**：把 WeChat 增强、debug 面与文档交付压成一份诚实结论
- **本 Phase 对应编号**：
  - `P6-01`
- **本 Phase 新增文件**：
  - `docs/issue/zero-to-real/ZX1-closure.md`
- **本 Phase 修改文件**：
  - `无`
- **具体功能预期**：
  1. closure 能回答“微信自动登录是否真实成立”。
  2. closure 能回答“前端是否能看到 6-worker live/version”。
  3. closure 能说明 `clients/api-docs` 是否足够覆盖当前 façade。
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`引用 ZX1 执行期 automated results`
  - **手动验证**：`最终 doc + smoke 对照`
- **收口标准**：
  - closure 诚实写出已完成与未完成
  - 不把 dev-only config 说成 production ready
- **本 Phase 风险提醒**：
  - 最容易把“有入口”写成“已完成 secret 迁移”

---

## 6. 关键冻结决策

### 6.1 WeChat 登录输入冻结

ZX1 建议把 first-wave WeChat 登录输入冻结为：

1. `code`：必填
2. `encrypted_data`：建议必填（若 owner 仍需兼容 baseline，可在 ZX1 初期临时 optional，但 closure 必须诚实声明）
3. `iv`：与 `encrypted_data` 成对出现
4. `display_name`：仅作 bootstrap fallback，不是身份真相

**原则**：`session_key` 仅存在于 server-side auth flow；不返回给 client，不写入持久层，不进入 debug 响应。

### 6.2 Secret 入口冻结

ZX1 建议明确以下键名：

- `PASSWORD_SALT`
- `JWT_SIGNING_KID`
- `JWT_SIGNING_KEY_<kid>`（推荐主路径）
- `JWT_SECRET`（仅 legacy compatibility，不再鼓励新接入）
- `WECHAT_APPID`
- `WECHAT_SECRET`
- `WECHAT_API_BASE_URL`

**原则**：

1. `wrangler.jsonc` 只声明 key 名、默认非敏感 var 与 required-secret 注释
2. 本地开发通过 **非提交式** `.dev.vars` / shell env / `wrangler secret put`
3. preview/prod 通过 Cloudflare secret 落地
4. 不接受把真实 key/salt/app secret 写入仓库

### 6.3 Health/debug 返回冻结

ZX1 建议每个 worker 的 canonical `/health` 至少包含：

- `worker`
- `status`
- `worker_version`
- `phase`
- `nacp_core_version`（适用时）
- `nacp_session_version`（适用时）
- `bindings` 或等价布尔字段

`orchestrator-core` 聚合 debug 路由建议返回：

```json
{
  "status": "ok",
  "generated_at": "2026-04-25T00:00:00.000Z",
  "workers": [
    {
      "worker": "orchestrator-core",
      "live": true,
      "worker_version": "preview-<sha>",
      "phase": "orchestration-facade-closed",
      "details": {}
    }
  ]
}
```

**原则**：只暴露前端 debug 真正需要的 live/version/status，不向匿名侧过量泄漏内部 topology 细节。

---

## 7. 风险与依赖

| 风险 / 依赖 | 描述 | 缓解方式 |
|-------------|------|----------|
| WeChat decrypt 字段未先冻结 | 客户端与 auth worker 会来回改 payload | Phase 1 先 freeze contract |
| 真实 secret 被误提交 | “为了先跑通”最容易出现的错误 | 明确禁止真实 secret 入仓，只建立入口与非提交式本地开发方案 |
| health 聚合变成 topology 泄漏面 | debug 接口可能过宽 | 统一经 `orchestrator-core` 暴露，并限制返回字段 |
| worker version truth 不统一 | 前端看到的版本字段无意义 | 引入统一 `worker_version` 约定 |
| API docs 先于真实实现 | 文档会变成谎言 | 先落地 route/shape，再写 `clients/api-docs` |

---

## 8. 验证与收口要求

ZX1 执行完成前，至少要形成以下验证层：

1. **auth contract / auth worker**
   - `pnpm --filter @haimang/orchestrator-auth-contract typecheck build test`
   - `pnpm --filter @haimang/orchestrator-auth-worker typecheck build test`
2. **orchestrator / agent**
   - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
   - `pnpm --filter @haimang/agent-core-worker typecheck build test`
3. **first-wave regression**
   - `pnpm test:package-e2e`
   - `pnpm test:cross-e2e`
4. **client/manual smoke**
   - 微信开发者工具一次真实登录
   - web / mini-program 至少各跑一次 worker health debug route
5. **documentation proof**
   - `clients/api-docs/*` 与真实 façade route 对照
   - `ZX1-closure.md` 明确说明 secret 是“入口已建立”还是“已完成 Cloudflare secret 迁移”

---

## 9. 完成判定（ZX1 exit criteria）

ZX1 只有在以下条件同时成立时才可视为完成：

1. **微信自动登录主链成立**：`orchestrator-auth` 已能基于 decrypt 输入完成真正的自动登录，而不是只靠 openid bootstrap baseline
2. **auth 配置入口明确**：JWT/salt/appid/secret 的 key 名、开发入口与 Cloudflare secret 迁移路径都写清楚，且没有真实 secret 入仓
3. **6-worker health 可聚合观察**：前端通过 `orchestrator-core` 能看到全部 worker 的 live/version
4. **前端 API 文档成立**：`clients/api-docs/` 已按业务簇拆分，并能指导真实请求
5. **closure 诚实**：ZX1 明确说明哪些已 production-ready、哪些仍是 preview/debug baseline

---

## 10. 工作日志回填

### 10.1 实际完成的实现面

1. **WeChat contract / auth worker**
   - `packages/orchestrator-auth-contract/src/index.ts`
   - `packages/orchestrator-auth-contract/test/contract.test.ts`
   - `workers/orchestrator-auth/src/wechat.ts`
   - `workers/orchestrator-auth/src/service.ts`
   - `workers/orchestrator-auth/src/public-surface.ts`
   - `workers/orchestrator-auth/src/index.ts`
   - `workers/orchestrator-auth/test/{service,public-surface}.test.ts`
2. **6-worker health/version**
   - `workers/orchestrator-core/src/index.ts`
   - `workers/orchestrator-core/test/smoke.test.ts`
   - `workers/agent-core/src/index.ts`
   - `workers/bash-core/src/index.ts`
   - `workers/context-core/src/{index,types}.ts`
   - `workers/filesystem-core/src/{index,types}.ts`
   - `workers/{orchestrator-auth,orchestrator-core,agent-core,bash-core,context-core,filesystem-core}/wrangler.jsonc`
3. **client debug / login consumption**
   - `clients/wechat-miniprogram/pages/{auth,index}/index.js`
   - `clients/wechat-miniprogram/pages/index/index.wxml`
   - `clients/wechat-miniprogram/utils/wechat-auth.js`
   - `clients/wechat-miniprogram/apiRoutes.js`
   - `clients/web/src/{client,main}.ts`
4. **docs / closeout**
   - `clients/api-docs/{README,auth,wechat-auth,session,worker-health}.md`
   - `docs/issue/zero-to-real/ZX1-closure.md`

### 10.2 关键实现决策

1. **WeChat decrypt 当前是 preferred path，但保留 code-only compatibility**
   - 当前 schema 要求 `encrypted_data` 与 `iv` 成对出现，但不强制所有调用方立即提供。
   - 这样可以让小程序新入口先切到 decrypt-capable payload，同时不立刻打断旧调试调用。
2. **decrypt 身份校验走 `openid` 对拍**
   - 服务端先 `jscode2session`，再解密 profile payload。
   - 如果 decrypted `openid` 与 `jscode2session.openid` 不一致，直接返回 `invalid-wechat-payload`。
3. **worker health 继续由 `orchestrator-core` 统一对外**
   - 前端不直接打内部 worker。
   - 聚合接口固定为 `/debug/workers/health`。

### 10.3 WeChat secret / JWT 设置指南

#### 本地开发

在 `workers/orchestrator-auth/.dev.vars` 中放置非提交式配置：

```dotenv
PASSWORD_SALT=replace-with-long-random-salt
JWT_SIGNING_KID=v1
JWT_SIGNING_KEY_v1=replace-with-32-byte-or-longer-secret
WECHAT_APPID=wx-your-appid
WECHAT_SECRET=your-wechat-secret
```

#### Cloudflare preview / production

```bash
cd workers/orchestrator-auth
npx wrangler secret put PASSWORD_SALT --env preview
npx wrangler secret put JWT_SIGNING_KEY_v1 --env preview
npx wrangler secret put WECHAT_APPID --env preview
npx wrangler secret put WECHAT_SECRET --env preview
```

如果要轮换 JWT key：

1. 写入新的 `JWT_SIGNING_KEY_v2`
2. 把 `JWT_SIGNING_KID` 改为 `v2`
3. 重新部署 `orchestrator-auth` 与 `orchestrator-core`

#### worker version 约定

6 个 worker 统一新增 `WORKER_VERSION`：

- `orchestrator-auth@preview`
- `orchestrator-core@preview`
- `agent-core@preview`
- `bash-core@preview`
- `context-core@preview`
- `filesystem-core@preview`

建议后续在 CI/deploy 中改写为 `worker-name@<git-sha-or-release>`.

### 10.4 验证回填

```text
pnpm --filter @haimang/orchestrator-auth-contract typecheck build test
pnpm --filter @haimang/orchestrator-auth-worker typecheck build test
pnpm --filter @haimang/orchestrator-core-worker typecheck build test
pnpm --filter @haimang/agent-core-worker typecheck build test
pnpm --filter @haimang/bash-core-worker test
pnpm --filter @haimang/context-core-worker test
pnpm --filter @haimang/filesystem-core-worker test
./workers/agent-core/node_modules/.bin/tsc -p clients/web/tsconfig.json --noEmit
node --check clients/wechat-miniprogram/pages/auth/index.js
node --check clients/wechat-miniprogram/pages/index/index.js
node --check clients/wechat-miniprogram/utils/wechat-auth.js
pnpm test:package-e2e
pnpm test:cross-e2e
```

### 10.5 本轮最终结论

ZX1 已从“计划”推进到“已执行 supporting pack”：WeChat 登录具备 decrypt-capable 主路径，6-worker 已具备统一 `worker_version` probe 与 façade 聚合 debug 面，客户端与 `clients/api-docs/` 也已经同步吸收当前真实接口与配置纪律。
