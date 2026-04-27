# Nano-Agent 行动计划 — ZX2 Transport Enhance

> 服务业务簇: `orchestrator-core / orchestrator-auth / agent-core / bash-core / context-core / filesystem-core (6-worker matrix)`
> 计划对象: `内部 HTTP 退役 + NACP 协议强制约束（双头校验）+ 内部/对外 envelope 统一 + 前端 facade 必需能力补完`
> 类型: `migration + refactor + add`
> 作者: `Opus 4.7 (1M ctx)`，吸收 GPT 附加审查（2026-04-27）后修订
> 时间: `2026-04-27`（v2 修订）
> 文件位置:
> - `workers/{orchestrator-core,orchestrator-auth,agent-core,bash-core}/src/`
> - `packages/{nacp-core,nacp-session,orchestrator-auth-contract}/src/`
> - `clients/api-docs/`
> - `clients/{web,wechat-miniprogram}/src|utils/`
> 关联设计 / 调研文档:
> - `docs/eval/zero-to-real/state-of-transportation-by-opus.md`
> - `docs/eval/zero-to-real/state-of-transportation-by-GPT.md`
> - `.tmp/{topology,internal-http-retirement,rpc-shapes,cli-host-gaps,external-api-gaps}.md`
> - `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md`（前置上下文）
> 文档状态: `draft (v2)`

> **v2 修订要点**（吸收业主与 GPT 共识，原 v1 见 git 历史 / §11）：
> 1. **不新建 `packages/orchestrator-rpc-contract`。** 通用协议对象（envelope、authority、trace、error registry、transport precheck）回收到 `nacp-core`；session WS frame 回收到 `nacp-session`；facade HTTP 公约扩 `orchestrator-auth-contract`（按需改名 `orchestrator-facade-contract`）。worker-specific RPC interface（`AgentCoreRpc` / `BashCoreRpc`）以轻量 TS interface + zod schema 直接放在 `nacp-session` 或对应 worker `src/contract.ts`，**禁止**重新定义 NACP 已有的协议对象。
> 2. **NACP 协议双头校验落地**：所有 internal RPC 调用方在 send 前 `validateEnvelope()`，被调用方在 entrypoint 同样 `validateEnvelope() + verifyTenantBoundary() + checkAdmissibility()`，与 `ServiceBindingTransport` 现有 precheck 同形。
> 3. **Q1 解：agent-core preview 也 `workers_dev: false`**（采纳 GPT 意见）。preview 与 production 安全模型对齐，调试脚本必须走 facade。
> 4. **Phase 5 拆分为 Phase 5（facade 必需）+ Phase 6（客户端同步与 e2e）**；产品型能力（multi-modal `/messages`、`/files`、`/conversations`、`/devices/revoke`）从 ZX2 移出，进入 ZX3 候选清单。
> 5. **P1-03 重写**：保留 BASH/CONTEXT/FS service-binding，但加 binding-scope 守卫（`pathname !== '/health'` 一律 401），不再 fetch-by-URL（避免 §11.3 #1 的互相抵消）。
> 6. **stream RPC 不返回 NDJSON 字符串**：改成 `Envelope<{ events, next_cursor }>` cursor-paginated snapshot；持续推流仍走 WS frame 不入 RPC。
> 7. **bash-core authority** 增加 `caller`、`source`、`request_uuid`、`session_uuid?` 字段，与 NACP `Authority` 对齐，便于审计与幂等。
> 8. **P3-05（HTTP 路径删除）增加 runtime feature flag + 回滚 runbook + 1 周 compat 窗口**；翻转后 `internal-http-compat` 仍在 transport-profiles.md 保留 `retired-with-rollback` 状态。
> 9. **WS server frame 不发明新 envelope**：直接采用 `NacpSessionFrameSchema`；`session-ws-v1.md` 把现有 frame 与新 5 族 frame 都映射到该 schema；compat 层只做 alias，不引新形状。

---

## 0. 执行背景与目标

ZX1 已经 ship 了 wechat 一键登录闭环；接下来 ZX2 集中处理 transport 层的"修边收口"。两份调查（Opus + GPT）一致认为：6-worker 的安全边界设计正确，NACP 内部协议高度统一，但**运行时 transport 仍处于混合迁移态**——auth 已 100% RPC、agent 仅 28%（start/status）dual-track parity、bash-core 完全 HTTP 形态；同时对外 envelope 在 auth 路径与 session 路径之间不同形，前端写两套 narrow，前端急需的 permission / usage / catalog 等高阶能力又全部缺失。

ZX2 的工作方向严格对应业主提出的四点：① HTTP→RPC 退役收尾 + 安全边界加固；② **以 NACP 协议为唯一内部契约源、强制双头校验**；③ 对外 envelope 与内部对齐、降低前端心智负担；④ 补全前端**facade 必需**的 HTTP/WS 接口（产品型功能拆到 ZX3）。

- **服务业务簇**：6-worker matrix 的 transport 层
- **计划对象**：内部 HTTP 退役 + NACP 协议双头强制约束 + envelope 统一 + 前端 facade 必需接口补完
- **本次计划解决的问题**：
  - **P1** 内部 HTTP 退役不彻底：agent-core 5/7 action 缺 RPC shadow，bash-core 完全无 RPC 入口、缺 internal-binding-secret 与 authority 校验，与 orchestrator→agent 形态不对称
  - **P2** 安全边界存在 P0 风险：bash-core / context-core / filesystem-core / orchestrator-auth 的 `workers_dev` 默认值未审计；orchestrator-core 同时 service-bind 仅作健康探针的 BASH/CONTEXT/FS，缺 binding-scope 守卫
  - **P3** envelope 三种共存（AuthEnvelope / `{status,body}` / NACP tool envelope）+ error 四种 shape；session 路径与 auth 路径外层不同形；ZX2 需要把 envelope 收敛到 NACP-Core，**而非新造一套**
  - **P4** transport profile 没有冻结的命名；新增动作易再生碎片
  - **P5** 前端缺 permission gate / usage push / catalog / server-minted session list / resume 等 5 类 facade 必需能力（multi-modal / files / conversations / devices revoke 推迟到 ZX3）
  - **P6** WS server frame 在文档（`message_type`）与代码（部分用 `kind`）之间不一致；ZX2 必须以 `nacp-session` 现有 `NacpSessionFrameSchema` 为规范，不发明新 envelope
- **本次计划的直接产出**：
  - `nacp-core` 公开 `Envelope<T>` / `RpcMeta` / `RpcErrorCode` / `validateRpcCall` 等协议对象（如已存在则补齐 export 与文档化），并提供"双头校验"helper
  - `nacp-session` 接收 5 族新 message_type（`session.permission.{request,decision}` / `session.usage.update` / `session.skill.invoke` / `session.command.invoke` / `session.elicitation.{request,answer}` —— 共 7 个 message_type）；server frame 统一对齐到 `NacpSessionFrameSchema`
  - `orchestrator-auth-contract` 扩为 facade-http-v1 公约（`{ok,data,trace_uuid}` / `{ok:false,error,trace_uuid}`），不新建包
  - agent-core 7 个 session action 全 RPC（含 cursor-paginated stream snapshot）+ dual-track parity；7 天观察 + runtime flag + 回滚 runbook 后翻转真相、删除 fetch 路径
  - bash-core 取得 `WorkerEntrypoint` + secret + NACP authority（含 `caller` / `source` / `request_uuid`）
  - 5 个 transport profile 名称冻结；所有 wrangler.jsonc 完成 `workers_dev` 显式审计（**含 agent-core preview 也设为 `false`**）
  - orchestrator-core 公开 session 路径外层 envelope 化，与 auth 同形；新增 5 个**facade 必需** HTTP 端点 + 7 类 WS frame
  - `clients/api-docs/` 全量更新，含 `transport-profiles.md`、`session-ws-v1.md`（基于 `NacpSessionFrameSchema`）、4 篇必需端点文档

---

## 1. 执行综述

### 1.1 总体执行方式

整体策略 = **"先名后形、先内后外、协议为唯一约束源"**。
- Phase 1 冻结 5 个 transport profile 命名 + P0 安全收口；
- Phase 2 把通用协议对象补齐到 NACP（不新建包），并在 orchestrator-auth-contract 上扩 facade HTTP 公约；
- Phase 3 沿"NACP 协议契约 → 双头校验 → 内部 RPC 化 → parity → 翻转"的链条把 HTTP 退役做完；
- Phase 4 把内/外 envelope 与 WS frame 全部对齐到 NACP，**不发明新形状**；
- Phase 5 补**facade 必需**的 HTTP 端点 + WS frame；
- Phase 6 客户端同步 + e2e 收口；
- 产品型能力（multi-modal / files / conversations / devices revoke）显式 out-of-scope，由 ZX3 候选清单承接。

任何阶段都不允许在没有 NACP 契约先冻结的情况下改 worker 实现；任何阶段都不允许重新定义 NACP 已有的协议对象。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Transport-profile 命名 + P0 安全收口 | M | 冻结 5 profile；wrangler audit（含 agent-core preview = false）；保留 health-only service-binding 但加 binding-scope 守卫 | `-` |
| Phase 2 | NACP 协议补齐 + facade contract 扩展 + 双头校验 | M | `nacp-core` 补 `Envelope<T>` / `RpcMeta` / `RpcErrorCode` 公开 surface；`nacp-session` 落 5 族新 message_type；`orchestrator-auth-contract` 扩 facade-http-v1；提供 caller-side `validateRpcCall` helper | Phase 1 |
| Phase 3 | 内部 HTTP→RPC 退役补完 | L | agent-core 7 个 action 全 RPC（stream 走 cursor-paginated snapshot）+ parity；bash-core `WorkerEntrypoint` + secret + NACP authority（含 caller/source/request_uuid）；context/fs library-only 落档；P3-05 加 runtime flag + rollback runbook | Phase 2 |
| Phase 4 | 对外 envelope 统一 + WS frame 对齐 NACP | M | orchestrator-core session 路径外层 facade-http-v1；DO 不再吐自定义形状；server frame 统一到 `NacpSessionFrameSchema`，不发明新 envelope | Phase 2 |
| Phase 5 | 前端 facade 必需 HTTP/WS 接口补完 | M | 5 个 facade 必需 HTTP（permission decision / policy / usage / `/me/sessions` 含 server-mint 语义冻结 / resume / catalog 三联）+ 7 个新 message_type 接入；产品型功能拆到 ZX3 | Phase 4 |
| Phase 6 | 客户端同步 + e2e + 文档收口 | M | web / wechat 客户端切单一 narrow + 调用新端点；live preview e2e；docs/transport + clients/api-docs 全量同步 | Phase 5 |

### 1.3 Phase 说明

1. **Phase 1 — Transport-profile 命名 + P0 安全收口**
   - **核心目标**：用 `docs/transport/transport-profiles.md` 把 `nacp-internal` / `internal-http-compat` / `facade-http-v1` / `session-ws-v1` / `health-probe` 五个 profile 一次性命名清楚；同步 audit 所有 wrangler.jsonc，**agent-core preview 与 production 都 `workers_dev: false`**；保留 BASH/CONTEXT/FS service-binding（避免与 §11.3 #1 互相抵消），但在 fetch 入口加 binding-scope 守卫，非 `/health` 路径一律 401。
   - **为什么先做**：契约名称是后续所有 PR 的引用基；P0 安全风险（bash-core 公网入口、agent-core preview 公网入口）必须最先关闭。

2. **Phase 2 — NACP 协议补齐 + facade contract 扩展 + 双头校验**
   - **核心目标**：把通用协议对象（`Envelope<T>` / `RpcMeta` / `RpcErrorCode` / `Authority`）固化在 `nacp-core` 的公开 surface（如已存在则补 export + 文档），并提供 caller-side `validateRpcCall(env, target, input, meta)` helper；`nacp-session` 落 5 族（7 个）新 message_type 的 zod schema 与 registry；`orchestrator-auth-contract` 扩展为 facade-http-v1（HTTP `{ok,data,trace_uuid}` / `{ok:false,error,trace_uuid}`）。
   - **为什么放在这里**：契约先于实现；所有后续阶段必须从 NACP 拿型与校验，绝不重复。

3. **Phase 3 — 内部 HTTP→RPC 退役补完**
   - **核心目标**：agent-core 给 `input/cancel/verify/timeline` 4 个 action 加 RPC shadow + dual-track parity；`stream` 改为 `Envelope<{events, next_cursor}>` cursor-paginated snapshot RPC（持续推流走 WS，不进 RPC parity）；现网观察 7 天 + runtime feature flag 后翻转真相、删除 fetch 路径，并保留 1 周 RPC→HTTP 回滚开关 + deploy runbook。bash-core 改 `WorkerEntrypoint`，新增 `call/cancel` 两个 RPC method（套 `Envelope<ToolCallResponseBody>`），fetch 入口加 NACP `validateInternalAuthority`，authority 含 `sub` / `team_uuid` / `caller`（`orchestrator-core | agent-core | runtime`）/ `source` / `request_uuid` / `session_uuid?`。context-core / filesystem-core 维持 library-only 并落档。
   - **为什么放在这里**：profile + contract 都齐了之后才能保证退役收口的对称性，并且双头校验的实施直接依赖 Phase 2 提供的 helper。

4. **Phase 4 — 对外 envelope 统一 + WS frame 对齐 NACP**
   - **核心目标**：orchestrator-core session 路径外层包 facade-http-v1 envelope；`jsonPolicyError` → `Envelope.error`；DO 内 `HttpController` 不再吐 `{ ok:true, action, phase }`；server frame 统一对齐到 `NacpSessionFrameSchema`（不发明 flat `{message_type,seq,...}` 新形）；compat 层把现有轻量 frame 映射回 NACP frame。
   - **为什么放在这里**：Phase 3 完成后，内部 transport 已收口；外层只剩"如何把 NACP 拍平给前端"，且严禁发明新 envelope。

5. **Phase 5 — 前端 facade 必需 HTTP/WS 接口补完**
   - **核心目标**：补 5 个**facade 必需**端点：`POST /sessions/{id}/permission/decision`、`POST /sessions/{id}/policy/permission_mode`、`GET /sessions/{id}/usage`、`POST /me/sessions` + `GET /me/sessions`（含 server-minted UUID 语义冻结：客户端不再自带 UUID，server mint 为唯一真相；TTL、跨设备 resume、重复 start 全部明确）、`POST /sessions/{id}/resume`、`GET /catalog/{skills,commands,agents}`；7 个新 message_type 接入 orchestrator-core WS。
   - **为什么放在这里**：仅暴露与 transport/facade 直接相关的最小集合；多模态 messages / files artifact / conversations / devices revoke 推到 ZX3 候选。

6. **Phase 6 — 客户端同步 + e2e + 文档收口**
   - **核心目标**：`clients/web` 与 `clients/wechat-miniprogram` 切单一 narrow + 接入新端点；live preview e2e 跑通 register→start→permission→deny→cancel + sessions list；`clients/api-docs/` 全量同步。
   - **为什么放在这里**：等 Phase 5 接口稳定后再动客户端；分两 PR 让 server / client 可独立 review。

### 1.4 执行策略说明

- **执行顺序原则**：契约先行；NACP 是唯一协议源，所有 worker import NACP 而非 import 兄弟 worker；同一类形状变更（envelope）一次到位、不分多次破坏；安全收口（P0）放最前不阻塞补能；客户端切换放最后。
- **风险控制原则**：HTTP→RPC 翻转使用 dual-track parity 7 天 + runtime feature flag + 回滚 runbook + 1 周 compat 窗口（沿用并强化现有 `agent-rpc-parity-failed` 502 模式）；任何 envelope 变更同时给 web + wechat 客户端打覆盖测试，preview env 全程不中断；profile 命名冻结后 *任何* 新增端点必须在 PR 描述里声明所属 profile + NACP 契约引用点。
- **测试推进原则**：每个 worker 单测必跑（`pnpm -F`）；Phase 2 之后所有 RPC 调用方与被调方都跑 NACP `validateEnvelope` 的双头校验单测；cross-worker integration `test/cross-e2e/*` 覆盖 parity + envelope；live preview e2e 在 Z4 first-real-run 与 ZX1 wechat 基础上加 ZX2 permission gate 闭环。
- **文档同步原则**：所有 phase 必须在合并前更新 `clients/api-docs/`、`docs/transport/transport-profiles.md`、关联 worker `README.md`；Q/A 答案同步回 §6。

### 1.5 本次 action-plan 影响目录树

```text
nano-agent/
├── packages/
│   ├── nacp-core/                       ← Phase 2 公开 Envelope/RpcMeta/RpcErrorCode + validateRpcCall helper
│   │   └── src/{envelope.ts, rpc.ts, errors.ts, transport/service-binding.ts}
│   ├── nacp-session/                    ← Phase 2 + 4 落 5 族 (7 message_type) + frame 对齐
│   │   └── src/messages/{permission.ts, usage.ts, skill.ts, command.ts, elicitation.ts}
│   ├── orchestrator-auth-contract/      ← Phase 2 扩 facade-http-v1（不新建包）
│   │   └── src/{index.ts, facade-http.ts}
│   └── ...                              ← 其他包不动
├── workers/
│   ├── orchestrator-core/
│   │   ├── src/index.ts                 ← Phase 4 envelope 化；Phase 5 新增 5 端点
│   │   ├── src/user-do.ts               ← Phase 3 dual-track parity 扩展；Phase 4 envelope；Phase 5 routes/frame
│   │   ├── src/policy/authority.ts      ← Phase 4 jsonPolicyError → envelope
│   │   ├── wrangler.jsonc               ← Phase 1 audit；保留 BASH/CONTEXT/FS service-binding，加 binding-scope 守卫
│   │   └── README.md                    ← Phase 1 profile 标注
│   ├── orchestrator-auth/
│   │   ├── src/index.ts                 ← Phase 2 切到统一 Envelope（兼容旧 type alias）
│   │   └── wrangler.jsonc               ← Phase 1 显式 workers_dev:false
│   ├── agent-core/
│   │   ├── src/index.ts                 ← Phase 3 增 input/cancel/verify/timeline + cursor stream RPC
│   │   ├── src/host/internal.ts         ← Phase 3 翻转真相后清理 fetch 路径（含回滚 flag）
│   │   ├── src/host/internal-policy.ts  ← Phase 3 NACP authority 校验 helper 复用
│   │   ├── src/host/do/nano-session-do.ts ← Phase 4 envelope 化；frame 对齐 NacpSessionFrameSchema
│   │   ├── src/host/http-controller.ts  ← Phase 4 改造
│   │   └── wrangler.jsonc               ← Phase 1 显式 workers_dev:false（preview & production 一致）
│   ├── bash-core/
│   │   ├── src/index.ts                 ← Phase 3 WorkerEntrypoint + secret + NACP authority(caller/source/request_uuid)
│   │   ├── src/worker-runtime.ts        ← Phase 3 输出 Envelope；接入双头校验
│   │   └── wrangler.jsonc               ← Phase 1 显式 workers_dev:false
│   ├── context-core/                    ← Phase 1 README+wrangler 注释标 library-only；workers_dev:false；binding-scope 守卫
│   └── filesystem-core/                 ← 同 context-core
├── clients/
│   ├── api-docs/
│   │   ├── README.md                    ← Phase 1 加 profile 索引
│   │   ├── transport-profiles.md        ← 新建（Phase 1）
│   │   ├── auth.md                      ← Phase 4 标注 facade-http-v1
│   │   ├── session.md                   ← Phase 4 重写为 facade-http-v1 + WS v1
│   │   ├── session-ws-v1.md             ← 新建（Phase 4）基于 NacpSessionFrameSchema 的 server-frame registry
│   │   ├── permissions.md               ← 新建（Phase 5）
│   │   ├── usage.md                     ← 新建（Phase 5）
│   │   ├── catalog.md                   ← 新建（Phase 5）
│   │   ├── me-sessions.md               ← 新建（Phase 5）含 server-mint UUID 与 TTL/resume 语义
│   │   └── worker-health.md             ← 保留
│   ├── web/src/client.ts                ← Phase 6 单一 narrow + 调用新端点
│   └── wechat-miniprogram/{apiRoutes.js,utils/}  ← Phase 6 同步
├── test/
│   ├── cross-e2e/                       ← Phase 3 dual-track parity；Phase 5 permission/usage e2e；Phase 6 web 客户端闭环
│   ├── package-e2e/                     ← Phase 2 双头校验单测；各 worker 单 e2e
│   └── worker-health/                   ← 保留
└── docs/
    ├── transport/transport-profiles.md  ← 新建（Phase 1）
    └── eval/zero-to-real/state-of-transportation-by-{opus,GPT}.md  ← 已有，结尾标注 ZX2 已落地
```

业务链路视角：

```text
ZX2-transport-enhance
├── Phase 1: Profile 命名 + P0 安全收口
│   ├── docs/transport/transport-profiles.md
│   ├── workers/*/wrangler.jsonc(workers_dev audit, agent-core preview=false)
│   └── orchestrator-core binding-scope 守卫（保留 service-binding，仅 /health 通过）
├── Phase 2: NACP 协议补齐 + facade contract + 双头校验
│   ├── packages/nacp-core 公开协议对象
│   ├── packages/nacp-session 5 族 (7 message_type)
│   └── packages/orchestrator-auth-contract 扩 facade-http-v1
├── Phase 3: 内部 HTTP→RPC 退役
│   ├── agent-core 5 action shadow + cursor stream RPC + parity
│   ├── bash-core WorkerEntrypoint + secret + NACP authority(caller/source/request_uuid)
│   └── 翻转真相 + runtime flag + rollback runbook
├── Phase 4: Envelope 与 WS frame 对齐 NACP
│   ├── orchestrator-core session 路径 facade-http-v1
│   └── server frame 对齐 NacpSessionFrameSchema（不发明新形状）
├── Phase 5: 前端 facade 必需接口
│   ├── 5 个 HTTP 端点（permission/policy/usage/me-sessions/resume/catalog 三联）
│   └── 7 个新 message_type 接入
└── Phase 6: 客户端同步 + e2e
    ├── web + wechat 客户端切换
    └── live preview e2e 收口
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 冻结 `nacp-internal` / `internal-http-compat` / `facade-http-v1` / `session-ws-v1` / `health-probe` 五个 transport profile 命名与边界
- **[S2]** 所有 worker `wrangler.jsonc` 显式 `workers_dev` 状态审计；**agent-core preview 与 production 都为 `false`**；orchestrator-core 保留 BASH/CONTEXT/FS service-binding 但加 binding-scope 守卫（仅 `/health` 放行）
- **[S3]** `nacp-core` 公开 `Envelope<T>` / `RpcMeta` / `RpcErrorCode` / `Authority` / `validateRpcCall` 等协议对象与 helper（已存在则补 export 与文档；不存在则补齐）
- **[S4]** `nacp-session` 接收 5 族（7 个）新 message_type 的 zod schema 与 registry 入册
- **[S5]** `orchestrator-auth-contract` 扩为 facade-http-v1 公约（不新建包）；删除 worker 内重复定义
- **[S6]** **NACP 协议双头校验**：caller-side 在 send 前 `validateRpcCall`；callee-side 在 entrypoint `validateEnvelope + verifyTenantBoundary + checkAdmissibility`；任何不通过一律 4xx + envelope.error
- **[S7]** agent-core `input/cancel/verify/timeline` 4 个 RPC method shadow 化 + dual-track parity；`stream` 走 `Envelope<{events,next_cursor}>` cursor-paginated snapshot RPC；7 天 + runtime flag 后翻转真相，保留 1 周回滚开关与 deploy runbook
- **[S8]** bash-core 改 `WorkerEntrypoint`：`call/cancel` 两个 RPC + 同步 fetch 入口的 NACP authority 校验（authority 含 `sub` / `team_uuid` / `caller` / `source` / `request_uuid` / `session_uuid?`）
- **[S9]** orchestrator-core 公开 session 路径外层 facade-http-v1；`jsonPolicyError` → `Envelope.error`；DO `HttpController` 不再吐自定义形状
- **[S10]** server WS frame 统一对齐 `NacpSessionFrameSchema`；compat 层只 alias，不引新形状
- **[S11]** 新增 5 个 facade 必需 HTTP 端点：`POST /sessions/{id}/permission/decision`、`POST /sessions/{id}/policy/permission_mode`、`GET /sessions/{id}/usage`、`POST /me/sessions` + `GET /me/sessions`（含 server-mint UUID + TTL + 跨设备 resume 语义冻结）、`POST /sessions/{id}/resume`、`GET /catalog/{skills,commands,agents}`
- **[S12]** 撰写 `docs/transport/transport-profiles.md` + `clients/api-docs/{transport-profiles.md, session-ws-v1.md, permissions.md, usage.md, catalog.md, me-sessions.md}`；更新 `web` / `wechat-miniprogram` 客户端到统一 narrow
- **[S13]** 单测、cross-e2e（含双头校验 + parity）、live preview e2e 全绿；分阶段提交 6 个独立 PR（PR-A 到 PR-F）

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 把 context-core / filesystem-core 升级为真 RPC worker（保留 library-only 决策）
- **[O2]** 引入 MCP 服务器管理端点
- **[O3]** rewind / fork 这些影响 D1 truth 的能力
- **[O4]** 替换底层 transport 协议（不做 SSE / gRPC / 切换 WS 子协议）
- **[O5]** 改动 D1 schema（如 `/me/sessions` 能在现有 conversations + sessions truth 上 read，则不动 schema）
- **[O6]** 弃用 legacy `JWT_SECRET` 兜底或动 JWT 体系
- **[O7]** `/_internal/` path prefix 重命名（待 Phase 1 末复盘决议）
- **[O8]** **`POST /sessions/{id}/messages`（多模态 user message）**——推到 ZX3 候选
- **[O9]** **`GET /sessions/{id}/files`（artifact 列表）**——推到 ZX3 候选
- **[O10]** **`GET /me/conversations`（深层 conversation 列表）**——推到 ZX3 候选
- **[O11]** **`POST /me/devices/revoke`（设备管理）**——推到 ZX3 候选
- **[O12]** **新建 `packages/orchestrator-rpc-contract`**——v2 已撤销；通用协议对象由 `nacp-core` 承担
- **[O13]** gemini-cli 能力面对照（证据缺失，由后续 plan 补 investigation 后再评估）

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| context-core / filesystem-core 升级真 RPC | `out-of-scope` | library-only 模式正确，迁移收益小 | ZX3 / W5 决议升级时 |
| MCP server 管理 API | `out-of-scope` | MCP 未真正接入业务 | MCP 接入时另起 plan |
| rewind / fork 端点 | `out-of-scope` | 涉及 D1 truth + UI 设计 | ZX4 |
| `/sessions/{id}/messages` 多模态 | `out-of-scope` | 涉及 attachment storage / UI 产品决策 | ZX3 候选 |
| `/sessions/{id}/files` artifact | `out-of-scope` | 与 filesystem-core RPC 升级耦合 | ZX3 候选 |
| `/me/conversations` 列表 | `out-of-scope` | 涉及 D1 read-model 设计 | ZX3 候选 |
| `/me/devices/revoke` | `out-of-scope` | 涉及 trustedDevice schema 与 wechat bridge | ZX3 候选 |
| 新建 `orchestrator-rpc-contract` 包 | `out-of-scope` | 与 NACP 职责重复（v2 撤销） | 不重评 |
| `/_internal/` path prefix 重命名 | `defer / depends-on-decision` | 对运行无功能影响、对长期可读性有益 | Phase 1 末复盘 |
| 删除 `JWT_SECRET` legacy 兜底 | `out-of-scope` | 与 transport 不正交 | ZX5 auth hardening |
| gemini-cli 能力面对照 | `out-of-scope` | 当前无源码与调查文档证据 | 补证后另立 plan |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | 撰写 `docs/transport/transport-profiles.md` 冻结 5 profile 命名 | add | `docs/transport/transport-profiles.md` | 给所有后续 PR 提供 profile 引用基 | low |
| P1-02 | Phase 1 | 全 worker `wrangler.jsonc` `workers_dev` 显式审计（含 agent-core preview=false） | update | `workers/*/wrangler.jsonc` | 关闭 P0 公网入口风险 | medium |
| P1-03 | Phase 1 | orchestrator-core 保留 BASH/CONTEXT/FS service-binding 但加 binding-scope 守卫；非 facade worker fetch 入口默认 401（除 `/health`） | refactor | `workers/orchestrator-core/src/index.ts`、`workers/{bash,context,filesystem}-core/src/index.ts` | health-only binding；不 fetch-by-URL | medium |
| P1-04 | Phase 1 | `clients/api-docs/README.md` 加 profile 索引 + 链接 | update | `clients/api-docs/README.md` | 文档单一入口 | low |
| P2-01 | Phase 2 | `nacp-core` 公开 `Envelope<T>` / `RpcMeta` / `RpcErrorCode` / `Authority`（已存在则补 export + 文档；不存在则补齐） | add/update | `packages/nacp-core/src/{envelope.ts, rpc.ts, errors.ts, index.ts}` | 单一协议源 | medium |
| P2-02 | Phase 2 | `nacp-core` 提供 caller-side `validateRpcCall(env, target, input, meta)` helper | add | `packages/nacp-core/src/rpc.ts` | 双头校验的发送端 | medium |
| P2-03 | Phase 2 | `nacp-session` 落 5 族（7 个）新 message_type zod schema + registry 入册 | add | `packages/nacp-session/src/messages/{permission,usage,skill,command,elicitation}.ts`, `index.ts` | WS frame 契约化 | medium |
| P2-04 | Phase 2 | `orchestrator-auth-contract` 扩 facade-http-v1 公约 | update | `packages/orchestrator-auth-contract/src/{index.ts, facade-http.ts}` | 对外 envelope 单一来源 | low |
| P3-01 | Phase 3 | agent-core 增 RPC method `input/cancel/verify/timeline` 并接入 dual-track parity；caller/callee 双头 NACP 校验 | add | `workers/agent-core/src/index.ts`, `workers/orchestrator-core/src/user-do.ts` | 5/7→7/7 RPC 覆盖 | medium |
| P3-02 | Phase 3 | agent-core 增 cursor-paginated stream snapshot RPC `Envelope<{events,next_cursor}>`；持续推流仍走 WS | add | `workers/agent-core/src/index.ts`, `src/host/internal.ts` | 解决 NDJSON 字符串 envelope size/语义风险 | medium |
| P3-03 | Phase 3 | bash-core `WorkerEntrypoint` + RPC `call/cancel`；NACP authority 含 `caller/source/request_uuid/session_uuid?` | refactor | `workers/bash-core/src/index.ts`, `worker-runtime.ts` | 与 orchestrator→agent 形态对称 + 审计可追 | high |
| P3-04 | Phase 3 | agent-core `makeCapabilityTransport` 切到 RPC binding 调用，HTTP 作 7 天兼容 fallback | refactor | `workers/agent-core/src/host/remote-bindings.ts` | 退役 agent→bash 的 HTTP path | medium |
| P3-05 | Phase 3 | 7 天 parity + runtime feature flag + rollback runbook 后翻转 agent-core 真相到 RPC、删除 fetch 路径 | remove | `workers/agent-core/src/host/internal.ts`, `workers/orchestrator-core/src/user-do.ts` | 真正完成 HTTP 退役 | high |
| P3-06 | Phase 3 | context-core / filesystem-core README 与 wrangler 注释落档 library-only | update | `workers/{context,filesystem}-core/README.md` | 防止后续误扩业务表面 | low |
| P4-01 | Phase 4 | orchestrator-core `jsonPolicyError` → `Envelope.error` 升级 | refactor | `workers/orchestrator-core/src/policy/authority.ts`, `src/index.ts` | 错误结构 1 种 | medium |
| P4-02 | Phase 4 | orchestrator-core session 路径外层 facade-http-v1 envelope 化 | refactor | `workers/orchestrator-core/src/index.ts`, `user-do.ts` | session 与 auth 同形 | medium |
| P4-03 | Phase 4 | `HttpController` 输出改 envelope（不再 `{ok:true,action,phase}`） | refactor | `workers/agent-core/src/host/http-controller.ts` | DO 内出口形状统一 | medium |
| P4-04 | Phase 4 | server WS frame 统一对齐 `NacpSessionFrameSchema`；compat 层把现有 `{kind,...}` 映射回 NACP frame；不发明新 envelope | refactor | `workers/agent-core/src/host/{do/nano-session-do.ts, internal.ts}`、`workers/orchestrator-core/src/user-do.ts` | 文档与代码 frame 一致 | medium |
| P4-05 | Phase 4 | 写 `clients/api-docs/session-ws-v1.md`：基于 `NacpSessionFrameSchema` 的 server-frame registry，含 close codes、ack 语义、frame size 上限、heartbeat 超时、顺序保证、resume 语义 | add | `clients/api-docs/session-ws-v1.md` | 9 类 frame + 7 新 message_type 全文档化 | low |
| P5-01 | Phase 5 | 新增 facade 必需 HTTP 端点 `POST /sessions/{id}/permission/decision`、`POST /sessions/{id}/policy/permission_mode`、`GET /sessions/{id}/usage`、`POST /sessions/{id}/resume`、`GET /catalog/{skills,commands,agents}` | add | `workers/orchestrator-core/src/index.ts`, `user-do.ts` | facade 必需能力 | medium |
| P5-02 | Phase 5 | `POST /me/sessions` + `GET /me/sessions`（server-mint UUID + TTL + 跨设备 resume + 重复 start 行为冻结） | add | `workers/orchestrator-core/src/{index.ts, user-do.ts}` | session identity 单一真相 | medium |
| P5-03 | Phase 5 | 7 个新 message_type 在 orchestrator-core WS / DO 接入；permission round-trip 30s 超时；usage update backpressure | add | `workers/orchestrator-core/src/user-do.ts`、`workers/agent-core/src/host/do/nano-session-do.ts` | 5 族 frame 闭环 | medium |
| P5-04 | Phase 5 | `clients/api-docs/{permissions,usage,catalog,me-sessions}.md` + 更新 `session.md` 引用 ws v1 | add/update | `clients/api-docs/*.md` | 对外公约完整 | low |
| P6-01 | Phase 6 | `clients/web/src/client.ts` 单一 narrow + 调用新端点 + permission gate UI 跑通 | update | `clients/web/src/{client.ts, main.ts}` | 前端单一形状 | medium |
| P6-02 | Phase 6 | `clients/wechat-miniprogram/{apiRoutes.js, utils/api.js, utils/nano-client.js}` 同步新端点 | update | `clients/wechat-miniprogram/**` | 小程序对齐 | medium |
| P6-03 | Phase 6 | live preview e2e：register→login→start→permission round-trip→usage update→cancel→sessions list | add | `test/cross-e2e/zx2-transport.test.ts` | 收口 evidence | medium |
| P6-04 | Phase 6 | `state-of-transportation-by-{opus,GPT}.md` 标注 ZX2 已落地；transport-profiles.md `internal-http-compat` 状态更新 | update | `docs/{eval/zero-to-real,transport}/*.md` | 文档收口 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Transport-profile 命名 + P0 安全收口

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | profile 命名文档 | 写 `docs/transport/transport-profiles.md`，列每个 profile：name / 范围 / wire / 信任栈 / 引用 / 退役状态 | `docs/transport/transport-profiles.md` | 一份冻结的命名表 | doc review；与 GPT/Opus 报告交叉验证 | 文档合并；后续 PR 描述能引用 profile 名 |
| P1-02 | wrangler audit | `bash-core` / `context-core` / `filesystem-core` / `orchestrator-auth` / `agent-core`（preview & production）显式 `"workers_dev": false`；orchestrator-core 保留 `true` | `workers/*/wrangler.jsonc` | 仅 orchestrator-core 公网可达 | `npx wrangler deploy --dry-run`；preview 部署后 curl 验证 | 非 facade worker `*.workers.dev` 返回 404/拒绝 |
| P1-03 | binding-scope 守卫 | 保留 BASH/CONTEXT/FS service-binding；在每个非 facade worker 的 fetch 入口加 `if (pathname !== '/health') return 401`；orchestrator-core health 探针仍走 service-binding（不改 fetch-by-URL） | `workers/orchestrator-core/src/index.ts:120-150`、`workers/{bash,context,filesystem}-core/src/index.ts` | health-only binding；非 health 路径一律 401 | 单测：每个 worker 非 `/health` 路径 401；集成：`/debug/workers/health` 仍报 6 worker | binding 数量保持，但 attack surface 由代码守卫保证 |
| P1-04 | api-docs 索引 | `clients/api-docs/README.md` 加 profile 简表 + 链接 | `clients/api-docs/README.md` | 前端 30 秒可定位 facade-http-v1 | doc review | 新读者可自助找到 transport 体系 |

### 4.2 Phase 2 — NACP 协议补齐 + facade contract 扩展 + 双头校验

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | 公开 NACP 协议对象 | `nacp-core` 把 `Envelope<T>` / `RpcMeta` / `RpcErrorCode` / `Authority` 加入 public surface（已存在则确认 export + 补 docs；不存在则补齐） | `packages/nacp-core/src/{envelope.ts, rpc.ts, errors.ts, index.ts}` | 任何 worker 引 `@haimang/nacp-core` 即可拿到型 | 单测：union narrow / parse 成功失败；类型测试 | `pnpm -F @haimang/nacp-core test` 全绿；下游 import 0 break |
| P2-02 | caller-side `validateRpcCall` helper | 在 `nacp-core/src/rpc.ts` 提供 `validateRpcCall(env, target, input, meta)` —— 调用前对 input/meta 做 zod parse + tenant boundary 预检 | 同上 | RPC 发送端契约保护 | 单测：合法 / tenant mismatch / meta 缺失 | helper 被 orchestrator-core / agent-core 实际接入 |
| P2-03 | nacp-session 5 族 message_type | 新增 `session.permission.request` / `.permission.decision` / `.usage.update` / `.skill.invoke` / `.command.invoke` / `.elicitation.request` / `.elicitation.answer`（5 族 / 7 个）的 zod schema + registry 入册 | `packages/nacp-session/src/messages/{permission,usage,skill,command,elicitation}.ts`, `src/index.ts` | WS frame schema-validated；registry 完整 | 单测：每个 message_type 一组（合法 / 无效 / 边界） | nacp-session test 全绿 |
| P2-04 | facade-http-v1 公约 | `orchestrator-auth-contract` 扩 `facade-http.ts`：导出 `FacadeSuccess<T>` / `FacadeError`（带 `trace_uuid`），并 re-export `nacp-core` 的 `Envelope<T>` / `RpcErrorCode`；删除现有 worker 内重复定义 | `packages/orchestrator-auth-contract/src/{index.ts, facade-http.ts}` | 对外 HTTP 契约单一来源 | 单测；orchestrator-auth + orchestrator-core 编译通过 | 旧 type alias 保留 6 个月 |

### 4.3 Phase 3 — 内部 HTTP→RPC 退役补完

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | agent-core 4 RPC method shadow | `AgentCoreEntrypoint` 加 `input/cancel/verify/timeline`；orchestrator-core 复用 dual-track parity 模板；caller 调用前 `validateRpcCall`，callee 入口 `validateEnvelope + verifyTenantBoundary + checkAdmissibility` | `workers/agent-core/src/index.ts`, `workers/orchestrator-core/src/user-do.ts` | 6/7 RPC 覆盖（stream 见 P3-02） | 单测：每个 method 双头校验；cross-e2e parity ok / mismatch | preview 7 天 0 `agent-rpc-parity-failed` |
| P3-02 | agent-core stream snapshot RPC | 增 `streamSnapshot(input, meta)` 返回 `Envelope<{events:Event[], next_cursor:string\|null}>`；持续推流仍走 WS（不进 RPC parity） | `workers/agent-core/src/index.ts`, `src/host/internal.ts` | 取代 NDJSON 字符串模式；envelope size 可控 | 单测：events / 无 events / 终态 / cursor 翻页 | NDJSON 字符串旧路径删除；前端不再 parse NDJSON over RPC |
| P3-03 | bash-core RPC + secret + NACP authority | bash-core `WorkerEntrypoint` + RPC `call/cancel` 套 `Envelope<ToolCallResponseBody>`；fetch 入口加 `validateInternalAuthority`；authority 必填 `sub` / `team_uuid` / `caller`（`orchestrator-core\|agent-core\|runtime`）/ `source` / `request_uuid` / `session_uuid?`；`NANO_INTERNAL_BINDING_SECRET` 必填 | `workers/bash-core/src/index.ts`, `worker-runtime.ts` | bash 与 orchestrator→agent 形态对称且可审计 | 单测：合法 / 缺 secret / 缺 caller / 错 authority；集成：agent ↔ bash 含 secret | bash-core fetch 入口默认 401（除非带 secret + authority） |
| P3-04 | agent-core 切换到 bash RPC | `makeCapabilityTransport` 改用 `binding.call(...)` 而非 `binding.fetch(...)`；保留 fetch 作 7 天兼容 fallback；调用前 `validateRpcCall` | `workers/agent-core/src/host/remote-bindings.ts` | RPC 优先、fetch 回退 | 单测；cross-e2e tool 调用走 RPC | 7 天 0 fallback 触发 |
| P3-05 | 翻转 agent-core 真相 + 回滚保障 | parity 7 天通过 + runtime feature flag + deploy rollback runbook 就位后：`forwardInternalRaw` 替换为 RPC 调用；删除 `agent.internal/internal/sessions/...` fetch 路径；保留 1 周回滚开关；`internal-http-compat` 在 transport-profiles.md 标 `retired-with-rollback` | `workers/agent-core/src/host/internal.ts`、`workers/orchestrator-core/src/user-do.ts`、`docs/transport/transport-profiles.md`、`docs/runbook/zx2-rollback.md`（新建） | 内部 HTTP 完全退役（仅 health probe 保留） | 单测；cross-e2e；preview live | preview 1 周后 `internal-http-compat` 状态可标 `retired` |
| P3-06 | context/fs library-only 落档 | README + wrangler 注释 "library-only worker, do not add business RPC routes here" | `workers/{context,filesystem}-core/README.md` | 防回流 | doc review | README + wrangler 注释一致 |

### 4.4 Phase 4 — 对外 envelope 统一 + WS frame 对齐 NACP

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | jsonPolicyError 升级 | `{error,message}` 改 `Envelope.error = {code,message,status,details?}`；引用 nacp-core `RpcErrorCode` enum | `workers/orchestrator-core/src/policy/authority.ts`, `src/index.ts` | 错误结构 1 种 | 单测：每个 error code 一个 case | 所有 4xx/5xx 通过 facade-http-v1 zod 校验 |
| P4-02 | session 外层 envelope | session 路径成功响应包成 `{ok:true, data:{...}, trace_uuid}`；user-do 内部仍业务字段，由 facade 统一包装 | `workers/orchestrator-core/src/index.ts`, `user-do.ts` | session 与 auth 同形 | 单测：每个 action；cross-e2e narrow 单一 | web client `envelope()` 帮手能直接处理 session 响应 |
| P4-03 | HttpController 改造 | DO 内 `HttpController` 不再吐 `{ok:true,action,phase}`；改 `{phase, ...}`，由外层 facade 包 envelope | `workers/agent-core/src/host/http-controller.ts` | 责任分层清楚 | 单测；cross-e2e | 输出形状满足 facade-http-v1 zod |
| P4-04 | WS frame 对齐 NacpSessionFrameSchema | server frame 直接构造 `NacpSessionFrameSchema` 实例；现有 `{kind,...}` 改 alias / compat 映射；不发明 flat `{message_type,seq,...}` 新形 | `workers/agent-core/src/host/{do/nano-session-do.ts,internal.ts}`、`workers/orchestrator-core/src/user-do.ts` | frame 形状统一到 NACP | 单测；cross-e2e WS 可消费；NACP transport precheck 全过 | web client 收到的 event 全部匹配 nacp-session schema |
| P4-05 | session-ws-v1.md 撰写 | 完整 server-frame registry：以 `NacpSessionFrameSchema` 为底座，列 9 类 server frame + 7 个新 message_type；含 close codes、ack 语义、frame size 上限、heartbeat 超时、顺序保证、resume 语义 | `clients/api-docs/session-ws-v1.md` | 文档与代码 1:1 | doc review；GPT §6.3 cross-check | 全部 frame 文档化 |

### 4.5 Phase 5 — 前端 facade 必需 HTTP/WS 接口补完

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | 5 个 facade 必需 HTTP 端点 | `POST /sessions/{id}/permission/decision`、`POST /sessions/{id}/policy/permission_mode`、`GET /sessions/{id}/usage`、`POST /sessions/{id}/resume`、`GET /catalog/{skills,commands,agents}`；全部走 facade-http-v1；session-bound 经 `authenticateRequest` + `validateInternalAuthority` 链路 | `workers/orchestrator-core/src/index.ts`, `user-do.ts` | 端点全部 200 + envelope；4xx/5xx 全部 envelope.error | 单测；cross-e2e per endpoint | preview 全部 endpoint 可被客户端调通 |
| P5-02 | `/me/sessions` 含 server-mint 语义 | `POST /me/sessions` server-mint UUID（客户端自带 UUID 一律 400）；`GET /me/sessions` 列我所有 session（含 status / last_seen_at / pending TTL）；冻结：UUID TTL 24h 未 start 自动 GC、跨设备 resume 走同一 UUID、重复 start 返回 409 | `workers/orchestrator-core/src/{index.ts, user-do.ts}` | session identity 单一真相 | 单测：mint / list / TTL 过期 / 重复 start；cross-e2e | 客户端无法再自造 UUID 入业务 |
| P5-03 | 7 个新 message_type 接入 | server→client：`session.permission.request` / `.usage.update` / `.elicitation.request`；client→server：`session.permission.decision` / `.skill.invoke` / `.command.invoke` / `.elicitation.answer`；frame 走 `NacpSessionFrameSchema`；permission round-trip 默认 30s 超时；usage update ≥1Hz 自动合并 backpressure | `workers/orchestrator-core/src/user-do.ts`, `workers/agent-core/src/host/do/nano-session-do.ts` | 5 族 frame 闭环跑通 | 单测；cross-e2e：permission deny round-trip | preview 1 个 permission 闭环 |
| P5-04 | api-docs 4 篇必需文档 | `permissions.md` / `usage.md` / `catalog.md` / `me-sessions.md`；更新 `session.md` 引用 ws v1 | `clients/api-docs/*.md` | 对外公约完整 | doc review | 新读者按文档自助接入 |

### 4.6 Phase 6 — 客户端同步 + e2e + 文档收口

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P6-01 | web client 切换 | `clients/web/src/client.ts` 单一 narrow（统一 facade-http-v1）；`main.ts` 加按钮跑 permission decision / usage refresh / sessions list；删除自造 sessionUuid 路径，改走 `POST /me/sessions` | `clients/web/src/{client.ts, main.ts}` | 前端单一形状 | 浏览器手动 + 自动 e2e | preview 完成 register→start→permission→deny→cancel 闭环 |
| P6-02 | 小程序 client 同步 | `apiRoutes.js` 新增端点；`utils/api.js` 单一 envelope；新增 `permissionDecision` / `usageRefresh` / `meSessionsCreate` 工具 | `clients/wechat-miniprogram/apiRoutes.js`, `utils/api.js` | 小程序对齐 | 小程序开发者工具手动验证 + 单测 | preview 拉 sessions list |
| P6-03 | live e2e | 新建 `test/cross-e2e/zx2-transport.test.ts`：register→login→start→permission round-trip→usage update→cancel→sessions list；assert facade-http-v1 + NacpSessionFrameSchema | `test/cross-e2e/zx2-transport.test.ts` | 全链路 evidence | `pnpm -w run test:cross-e2e` + preview live | 7 天连续绿 |
| P6-04 | 文档收口 | `state-of-transportation-by-{opus,GPT}.md` 末尾标注 ZX2 已落地；`transport-profiles.md` `internal-http-compat` 状态更新 | `docs/{eval/zero-to-real,transport}/*.md` | 文档体系内部一致 | doc review | 全部链接闭合 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Transport-profile 命名 + P0 安全收口

- **Phase 目标**：把 5 个 transport profile 的命名冻结成可索引文档；同步关闭 P0 安全风险（公网入口、binding-scope）。所有后续 PR 必须能在描述里引用 profile 名。
- **本 Phase 对应编号**：P1-01, P1-02, P1-03, P1-04
- **本 Phase 新增文件**：
  - `docs/transport/transport-profiles.md`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/{src/index.ts, wrangler.jsonc}`
  - `workers/orchestrator-auth/wrangler.jsonc`
  - `workers/agent-core/wrangler.jsonc`
  - `workers/bash-core/{src/index.ts, wrangler.jsonc}`
  - `workers/context-core/{src/index.ts, wrangler.jsonc}`
  - `workers/filesystem-core/{src/index.ts, wrangler.jsonc}`
  - `clients/api-docs/README.md`
- **具体功能预期**：
  1. profile 文档列出每个 profile：name / 范围 / wire / 信任栈 / 引用文档 / 退役状态
  2. 所有 worker `workers_dev` 显式声明；**agent-core preview 与 production 都为 `false`**（采纳 GPT/业主 Q1 决策）；仅 orchestrator-core 保留 `true`
  3. orchestrator-core 保留 BASH/CONTEXT/FS service-binding；非 facade worker fetch 入口加 `if (pathname !== '/health') return 401`
- **具体测试安排**：
  - **单测**：每个非 facade worker 非 `/health` 路径返回 401
  - **集成测试**：`/debug/workers/health` 仍正常聚合 6 worker
  - **回归测试**：preview 部署后所有现有 e2e 跑一遍
  - **手动验证**：`curl https://nano-agent-bash-core-preview.haimang.workers.dev/` → 应该 404（workers_dev:false 起效）
- **收口标准**：
  - profile 文档合并；后续 PR 描述里引用 profile name
  - 非 facade worker 公网入口关闭；agent-core preview 也无公网入口
  - binding-scope 守卫单测全绿
- **本 Phase 风险提醒**：
  - agent-core preview 关公网后，本地开发回环必须切到 `wrangler dev` 或经 orchestrator-core facade；通知所有依赖人
  - 非 facade worker 加 binding-scope 守卫前，确认现有 service-binding 真的只用 `/health`

### 5.2 Phase 2 — NACP 协议补齐 + facade contract 扩展 + 双头校验

- **Phase 目标**：把通用协议对象固化在 NACP 公开 surface（`Envelope<T>` / `RpcMeta` / `RpcErrorCode` / `Authority` / `validateRpcCall`）；`nacp-session` 落 5 族新 message_type；`orchestrator-auth-contract` 扩 facade-http-v1。零运行时变更，但后续所有 PR 从 NACP 拿型与校验。
- **本 Phase 对应编号**：P2-01, P2-02, P2-03, P2-04
- **本 Phase 新增文件**：
  - `packages/nacp-core/src/rpc.ts`（如不存在，承载 `RpcMeta` / `validateRpcCall`）
  - `packages/nacp-core/src/errors.ts`（如不存在，承载 `RpcErrorCode` enum）
  - `packages/nacp-session/src/messages/{permission.ts, usage.ts, skill.ts, command.ts, elicitation.ts}`
  - `packages/orchestrator-auth-contract/src/facade-http.ts`
  - `packages/{nacp-core,nacp-session,orchestrator-auth-contract}/test/zx2-*.test.ts`
- **本 Phase 修改文件**：
  - `packages/nacp-core/src/{envelope.ts, index.ts}`
  - `packages/nacp-session/src/index.ts`（registry）
  - `packages/orchestrator-auth-contract/src/index.ts`（re-export，删除局部重复定义）
- **本 Phase 删除文件**：
  - 无（旧 type alias 保留 6 个月，过期再删）
- **具体功能预期**：
  1. `nacp-core` 公开 `Envelope<T>` / `RpcMeta` / `RpcErrorCode` / `Authority`；`validateRpcCall(env, target, input, meta)` 提供 caller-side 双头校验入口
  2. `nacp-session` 接收 5 族（7 个）新 message_type，registry 完整
  3. `orchestrator-auth-contract` 扩 `facade-http.ts`：`FacadeSuccess<T> = { ok:true, data:T, trace_uuid }`，`FacadeError = { ok:false, error: { code, status, message, details? }, trace_uuid }`
- **具体测试安排**：
  - **单测**：每个 schema 的 parse 成功/失败 case；`validateRpcCall` 合法 / tenant mismatch / meta 缺失；7 个 message_type 各一组
  - **集成测试**：workers/orchestrator-auth + orchestrator-core import 后编译通过 + 现有 RPC 调用不破坏
  - **回归测试**：所有现有 worker 编译 + 测试不破坏
  - **手动验证**：`pnpm -F @haimang/nacp-core build && test`、`pnpm -F @haimang/nacp-session build && test`
- **收口标准**：
  - 所有 worker 引 `@haimang/nacp-core` / `@haimang/nacp-session` 即可拿到型与 helper
  - `pnpm -w run test` 全绿；旧 type alias 保留兼容
  - 双头校验单测覆盖 caller / callee 两端
- **本 Phase 风险提醒**：
  - zod 版本必须与 nacp-core / nacp-session / orchestrator-auth-contract 完全对齐
  - `validateRpcCall` 要避免与 `ServiceBindingTransport` 现有 precheck 双重抛错；建议在 helper 里直接复用 transport precheck

### 5.3 Phase 3 — 内部 HTTP→RPC 退役补完

- **Phase 目标**：agent-core 7 个 session action 全部 RPC（`stream` 走 cursor-paginated snapshot）+ dual-track parity；7 天 + runtime flag + 回滚 runbook 后翻转真相、删除 fetch 路径。bash-core 上 RPC 入口、加 secret + NACP authority（含 caller / source / request_uuid）。context/fs library-only 落档。
- **本 Phase 对应编号**：P3-01, P3-02, P3-03, P3-04, P3-05, P3-06
- **本 Phase 新增文件**：
  - `workers/agent-core/test/{rpc-input,rpc-cancel,rpc-verify,rpc-timeline,rpc-stream-snapshot}.test.ts`
  - `workers/bash-core/test/{rpc-call,rpc-cancel,internal-authority}.test.ts`
  - `test/cross-e2e/zx2-agent-rpc-parity.test.ts`
  - `test/cross-e2e/zx2-bash-rpc.test.ts`
  - `docs/runbook/zx2-rollback.md`（HTTP→RPC 翻转回滚 runbook）
- **本 Phase 修改文件**：
  - `workers/agent-core/src/{index.ts, host/internal.ts, host/internal-policy.ts, host/remote-bindings.ts}`
  - `workers/orchestrator-core/src/user-do.ts`
  - `workers/bash-core/src/{index.ts, worker-runtime.ts}`
  - `workers/context-core/README.md`、`workers/filesystem-core/README.md`、wrangler 注释
  - `docs/transport/transport-profiles.md`（`internal-http-compat` 状态）
- **本 Phase 删除文件**（P3-05 翻转后）：
  - `workers/agent-core/src/host/internal.ts` 中的 fetch 路径分支
  - `workers/orchestrator-core/src/user-do.ts` `forwardInternalRaw` 中 fetch 分支
- **具体功能预期**：
  1. agent-core 7 个 RPC method 全部 shadow，前 6 个进 dual-track parity；`streamSnapshot` 返回 `Envelope<{events:Event[], next_cursor:string\|null}>`，**不返回 NDJSON 字符串**
  2. bash-core 接收 secret + NACP authority；authority 必填 `sub` / `team_uuid` / `caller` / `source` / `request_uuid`，可选 `session_uuid`；缺任一字段 401；RPC 输出 `Envelope<ToolCallResponseBody>`
  3. agent-core 调用 bash-core 默认走 RPC，HTTP 作 fallback 7 天
  4. parity 7 天 + runtime feature flag + rollback runbook 后翻转真相，保留 1 周回滚开关，`internal-http-compat` 标 `retired-with-rollback`
- **具体测试安排**：
  - **单测**：每个 RPC method 一组（合法 / 缺 trace / 缺 authority / authority mismatch / body parse 失败 / caller 缺失 / source 缺失）
  - **集成测试**：cross-e2e 双 worker miniflare，跑 RPC + parity；故意制造 mismatch 观察 502；故意切 feature flag 观察回滚
  - **回归测试**：Z4 first-real-run；现有 worker-health
  - **手动验证**：preview 7 天观察 `agent-rpc-parity-failed` count；bash 调用走 RPC 的 evidence；rollback runbook dry-run
- **收口标准**：
  - preview 连续 7 天 `agent-rpc-parity-failed` = 0 且触发量 ≥ 1000 turns
  - bash-core fetch 入口默认 401（除非带 secret + authority）
  - feature flag 切换 + rollback runbook 演练通过
  - `internal-http-compat` profile 标 `retired-with-rollback`
- **本 Phase 风险提醒**：
  - parity 比对脆弱性：trace_uuid / 时间戳必须在两路调用前 deterministic mint；mismatch 分类记录
  - bash-core 加 secret + authority 后，所有 e2e 必须先 inject；CI 校验 secret 存在
  - 翻转真相是 destructive；必须有 feature flag + runbook + 1 周 compat 窗口三重保障
  - cursor-paginated snapshot 的 cursor 设计要稳定（建议 monotonic seq）

### 5.4 Phase 4 — 对外 envelope 统一 + WS frame 对齐 NACP

- **Phase 目标**：orchestrator-core session 路径外层 facade-http-v1 化与 auth 同形；DO HttpController 不再吐自定义形状；server frame 对齐 `NacpSessionFrameSchema`，**不发明新 envelope**；`session-ws-v1.md` 完整文档化。
- **本 Phase 对应编号**：P4-01, P4-02, P4-03, P4-04, P4-05
- **本 Phase 新增文件**：
  - `clients/api-docs/session-ws-v1.md`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/{index.ts, user-do.ts, policy/authority.ts}`
  - `workers/agent-core/src/host/{http-controller.ts, do/nano-session-do.ts, internal.ts}`
  - `clients/api-docs/{session.md, auth.md}`
- **具体功能预期**：
  1. session 路径所有响应包成 facade-http-v1 envelope `{ok:true, data, trace_uuid}` / `{ok:false, error:{code,message,status}, trace_uuid}`
  2. server frame 直接构造 `NacpSessionFrameSchema` 实例；现有 `{kind,...}` 由 compat 层 alias，不再混用
  3. nacp-session 接受 5 族新 message_type，通过 zod 校验
  4. session-ws-v1.md 完整描述 9 类 server frame + 7 个新 message_type + close code 表 + ack 语义 + frame size 上限 + heartbeat 超时 + resume 语义
- **具体测试安排**：
  - **单测**：每条新 message_type 一组；HttpController 输出 schema 校验
  - **集成测试**：cross-e2e WS 跑 9 类 frame + 7 新 message_type；NACP transport precheck 全过
  - **回归测试**：现有 web/wechat 客户端旧 narrow 仍能 work（compat 层兜底）
  - **手动验证**：浏览器 devtools 看 WS frame 结构与 doc 一致
- **收口标准**：
  - facade-http-v1 / session-ws-v1 文档冻结
  - WS frame 全部通过 nacp-session zod 校验
  - 没有引入新的 flat envelope，全部对齐 NACP
- **本 Phase 风险提醒**：
  - envelope 切换会破坏现有 web/wechat 客户端，必须在 Phase 6 同 PR 串联或灰度 7 天
  - server frame 对齐时必须保留 `seq` 字段语义（resume 依赖）

### 5.5 Phase 5 — 前端 facade 必需 HTTP/WS 接口补完

- **Phase 目标**：补 5 个 facade 必需端点 + 7 个新 message_type；`/me/sessions` 冻结 server-mint UUID 语义；产品型功能（messages/files/conversations/devices）out-of-scope。
- **本 Phase 对应编号**：P5-01, P5-02, P5-03, P5-04
- **本 Phase 新增文件**：
  - `clients/api-docs/{permissions.md, usage.md, catalog.md, me-sessions.md}`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/{index.ts, user-do.ts}`
  - `workers/agent-core/src/host/do/nano-session-do.ts`（5 族 frame 落地）
  - `clients/api-docs/{README.md, session.md}`
- **具体功能预期**：
  1. 5 个 HTTP 端点对外可用，passing facade-http-v1 schema
  2. `POST /me/sessions` server-mint UUID（客户端自带 UUID 一律 400）；TTL 24h；跨设备 resume 走同一 UUID；未 start 的 pending UUID 24h 后 GC；重复 start 同一 UUID → 409
  3. `GET /me/sessions` 列我所有 session（基于现有 D1 conversations + sessions truth read，不动 schema）
  4. 7 个 message_type 接入 WS；permission 30s 超时 default deny；usage update ≥1Hz auto-merge backpressure
- **具体测试安排**：
  - **单测**：每个新 endpoint 一组；server-mint UUID / TTL / 重复 start 各一组
  - **集成测试**：`zx2-transport.test.ts` 跑 permission 闭环 + usage update
  - **回归测试**：Z4 first-real-run + ZX1 wechat 全回归
  - **手动验证**：浏览器跑 permission deny；session list 显示
- **收口标准**：
  - 5 端点 + 7 message_type 在 preview env 可被客户端调通
  - `/me/sessions` 语义文档化、单测覆盖
  - cross-e2e permission 闭环通过
- **本 Phase 风险提醒**：
  - permission gate 依赖 nacp-session 新 message_type；上线顺序必须 nacp-session 先发包再 worker 部署
  - usage frame 频率高，必须做 backpressure；否则 WS buffer 会爆
  - server-mint UUID 切换会破坏所有客户端自造 UUID 的旧调用，Phase 6 必须同 PR 串联

### 5.6 Phase 6 — 客户端同步 + e2e + 文档收口

- **Phase 目标**：把前端切到统一 narrow + 调用新端点；live preview e2e 跑通；docs/transport + clients/api-docs 全量同步。
- **本 Phase 对应编号**：P6-01, P6-02, P6-03, P6-04
- **本 Phase 新增文件**：
  - `test/cross-e2e/zx2-transport.test.ts`
- **本 Phase 修改文件**：
  - `clients/web/src/{client.ts, main.ts}`
  - `clients/wechat-miniprogram/{apiRoutes.js, utils/api.js, utils/nano-client.js}`
  - `clients/api-docs/README.md`
  - `docs/transport/transport-profiles.md`（更新 `internal-http-compat` 终态）
  - `docs/eval/zero-to-real/state-of-transportation-by-{opus,GPT}.md`（结尾标注 ZX2 已落地）
- **具体功能预期**：
  1. web client 单一 narrow（统一 facade-http-v1）；自带 sessionUuid 路径删除，改走 `POST /me/sessions`
  2. 小程序 client 同步；`apiRoutes.js` 新增 5 个端点；`utils/api.js` 单一 envelope 帮手
  3. `zx2-transport.test.ts` 跑 register→login→start→permission round-trip→usage update→cancel→sessions list；assert facade-http-v1 + NacpSessionFrameSchema
  4. 文档体系内部一致；transport-profiles.md `internal-http-compat` 状态在 P3-05 翻转一周后改 `retired`
- **具体测试安排**：
  - **单测**：web client envelope narrow 帮手；小程序 api 帮手
  - **集成测试**：`zx2-transport.test.ts` 全闭环
  - **回归测试**：Z4 first-real-run + ZX1 wechat
  - **手动验证**：浏览器 + 微信开发者工具 preview env 各跑一遍
- **收口标准**：
  - 6 篇新 doc 合并；client README 同步
  - cross-e2e 7 天连续绿
  - web client 在 preview 上能跑 ZX2 demo
  - GPT/Opus 报告标注 ZX2 已落地
- **本 Phase 风险提醒**：
  - 客户端切换是破坏式合并，必须在 Phase 5 之后立刻跟进，不能延迟
  - WS 长连接 e2e 受网络影响，关键 assert 不依赖时间

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1（v2 已解，保留作为决策记录）

- **影响范围**：Phase 1（P1-02）
- **为什么必须确认**：agent-core preview 是否还需要 `workers_dev: true` 公网入口；如果保留，preview 与 production 之间的安全模型不一致
- **当前建议 / 倾向**：~~preview 保留 `workers_dev:true`~~（v1 倾向已撤销）→ **v2 决策：preview 与 production 都为 `false`**，调试脚本必须走 facade
- **Q**：agent-core preview 的 `workers_dev: true` 是否可以保留？
- **A**：**不保留。** 采纳 GPT/业主共识：preview 与 production 安全模型对齐，`workers_dev: false`；本地开发用 `wrangler dev` 或经 orchestrator-core facade。若调试脚本依赖直接公网入口，限期改造（不晚于 Phase 1 末）。

#### Q2

- **影响范围**：Phase 3（P3-03, P3-04）
- **为什么必须确认**：bash-core 的 `internal-authority` 形状要素
- **当前建议 / 倾向**：照抄 agent-core 模式（必填 `tenant_uuid`），并**额外**要求 `caller`（`orchestrator-core | agent-core | runtime`）、`source`、`request_uuid`、`session_uuid?`，便于审计与幂等
- **Q**：bash-core 的 authority 是否要 100% 复用 agent-core 的 `IngressAuthSnapshot`？是否需要扩 caller / source / request_uuid？
- **A**：复用 + 扩展。authority 的核心字段沿用 `IngressAuthSnapshot`（`sub` / `team_uuid` / `tenant_source` 等），并在 NACP `Authority` 上新增 `caller` / `source` / `request_uuid` / `session_uuid?`，由 `nacp-core` 统一定义。

#### Q3

- **影响范围**：Phase 4（P4-02, P4-03）+ Phase 6（P6-01, P6-02）
- **为什么必须确认**：envelope 切换是否需要 server-side 新旧双支持
- **当前建议 / 倾向**：不做 server-side 双支持，envelope + 客户端切换在 Phase 6 同 PR；preview 灰度 7 天后再 promote production
- **Q**：是否允许 envelope 切换 + 客户端更新打包成单 PR（绿带破坏式合并）？
- **A**：允许。Phase 4 + Phase 6 在 preview env 串联灰度 7 天后再 promote production；rollback runbook 同时覆盖 envelope 与 frame。

#### Q4

- **影响范围**：Phase 5（P5-02）
- **为什么必须确认**：`/me/sessions` 语义冻结
- **当前建议 / 倾向**：**server-mint UUID 唯一真相**——客户端自带 UUID 一律 400；TTL 24h；跨设备 resume 同一 UUID；重复 start → 409；不动 D1 schema（基于现有 conversations + sessions truth read）
- **Q**：`/me/sessions` POST 走 lazy 还是 eager 创建 D1 row？客户端是否还能自带 UUID？
- **A**：lazy 创建（首次 `/start` 时落 D1 row），但 UUID 必须 server-mint；客户端自带 UUID 拒绝。

#### Q5

- **影响范围**：Phase 5（P5-03）
- **为什么必须确认**：permission round-trip timeout 与 default fall-back
- **当前建议 / 倾向**：30 秒；超时 default 拒绝；frame 里 `expires_at` 由 server 决定，客户端展示倒计时
- **Q**：permission decision 默认超时与 default fall-back？
- **A**：30s default deny；可被 `policy_permission_mode = always_allow` 覆盖。

#### Q6

- **影响范围**：Phase 3（P3-05）
- **为什么必须确认**：parity 翻转判定阈值
- **当前建议 / 倾向**：`触发量 ≥ 1000 turns 且 mismatch = 0 且连续 ≥ 7 天`；任一不满足继续 parity；翻转 PR 需 owner 手动批准；保留 1 周回滚开关
- **Q**：parity 翻转判定？
- **A**：同意上述三门槛 + owner 批准 + 1 周回滚窗口；mismatch 必须分类归因后才能重启观察窗口。

### 6.2 问题整理建议

- v2 修订后 Q1-Q6 已全部有 default 答；Q1 业主已认可
- Phase 1 末做一次 Q/A review，确认所有 default 仍成立后再进入 Phase 2

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| `wrangler workers_dev` 默认变更 | 旧版 wrangler 默认值差异 | medium | 显式声明 + preview 部署后 curl 验证 |
| parity 比对脆弱 | `jsonDeepEqual` 对随机字段敏感 | high | 两路调用前 deterministic mint trace_uuid；时间戳走 deterministic source；mismatch 分类记录 |
| envelope 破坏前端 | session 形状切换可能破坏 web/wechat | high | Phase 4 + 6 同 PR；preview 灰度 7 天 |
| nacp 包发版同步 | `nacp-core` / `nacp-session` 必须先发包再 worker 部署 | high | minor bump；deployment script 强制顺序；CI 校验包版本 |
| bash-core secret + authority 注入 | preview / production 必须先 set secret 再切 RPC | high | wrangler secret put 写进 runbook；CI 校验 secret 存在；authority 字段缺失立即 401 |
| 客户端 narrow 切换 | web `envelope()` vs `json()` 双路径合并 | medium | 单一帮手 + 单测覆盖 envelope union |
| live preview e2e 不稳 | WS 长连接受网络影响 | medium | e2e 加重试 + 关键 assert 不依赖时间 |
| feature flag 漏切 | P3-05 翻转后某 env 状态不一致 | high | runbook 强制 dry-run；CI 校验 flag 状态对齐 |

### 7.2 约束与前提

- **技术前提**：cloudflare-workers `WorkerEntrypoint` API 通用；wrangler 4 可见；zod 版本统一（与 nacp-core 对齐）；NACP `validateEnvelope` / `verifyTenantBoundary` / `checkAdmissibility` 已在 `ServiceBindingTransport` 落地，可被 `validateRpcCall` 直接复用
- **运行时前提**：D1 schema 不变；R2 / KV 不引入；DO 类不变
- **组织协作前提**：架构师在 Phase 1 末批准 §6 Q1-Q6 default 答；Phase 3 翻转需要 owner 手动批准
- **上线 / 合并前提**：6 个 PR（PR-A 到 PR-F）；preview 7 天观察期后 promote production；任何 hotfix 不跨 PR 合并

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/transport/transport-profiles.md`（新建）
  - `docs/runbook/zx2-rollback.md`（新建）
  - `docs/eval/zero-to-real/state-of-transportation-by-{opus,GPT}.md`（结尾标注 ZX2 已落地）
- 需要同步更新的说明文档 / README：
  - `clients/api-docs/README.md` + `auth.md` + `session.md` + 4 篇必需端点文档 + `session-ws-v1.md`
  - `workers/{context,filesystem}-core/README.md`（library-only 落档）
  - `workers/orchestrator-core/README.md`（profile 标注）
  - `workers/bash-core/README.md`（secret/authority 注入指南）
- 需要同步更新的测试说明：
  - `test/cross-e2e/README.md`（加 zx2-transport.test.ts 说明）

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `pnpm -w run typecheck` 全绿
  - `pnpm -w run build` 全绿
- **单元测试**：
  - 每个 worker `pnpm -F <worker> test` 全绿
  - `nacp-core` / `nacp-session` 新 surface 100% line coverage（`Envelope` / `RpcMeta` / `RpcErrorCode` / `validateRpcCall` / 7 个新 message_type）
  - `orchestrator-auth-contract` facade-http-v1 zod 校验单测
  - 所有内部 RPC 调用方 + 被调方双头校验单测
- **集成测试**：
  - `test/cross-e2e/zx2-agent-rpc-parity.test.ts`（双 worker miniflare）
  - `test/cross-e2e/zx2-bash-rpc.test.ts`（含 caller/source/request_uuid）
  - `test/cross-e2e/zx2-transport.test.ts`（permission round-trip / usage / sessions list）
  - 现有 `test/cross-e2e/*` + `test/package-e2e/*` 不破坏
- **端到端 / 手动验证**：
  - preview env web client 跑 register→start→permission→deny→cancel
  - 微信开发者工具 preview env 跑 wechat login + sessions list
  - `curl` 验证非 facade worker `*.workers.dev` 返回 404
  - rollback runbook dry-run 演练通过
- **回归测试**：
  - Z4 first-real-run e2e
  - ZX1 wechat e2e
  - worker-health snapshot 仍报 6 worker
- **文档校验**：
  - `clients/api-docs/` + `docs/transport/transport-profiles.md` + `docs/runbook/zx2-rollback.md` markdown lint
  - 引用关系闭合
  - 新读者按文档自助接入实测

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. 5 个 transport profile 在 `docs/transport/transport-profiles.md` 命名冻结，`internal-http-compat` 经过 `retired-with-rollback` → `retired` 状态迁移
2. 全部 6 worker 的 `wrangler.jsonc` `workers_dev` 显式审计；非 facade worker（含 agent-core preview）公网入口关闭
3. agent-core 7 个 session action 全部 RPC（含 cursor-paginated stream snapshot；HTTP 路径已删除，回滚开关在期保留）；bash-core 走 `WorkerEntrypoint` + secret + NACP authority（含 caller/source/request_uuid）；context/fs library-only 落档
4. 内部 RPC 全部走 NACP `Envelope<T>` + `RpcMeta`；caller/callee 双头校验全绿；error shape 1 种；orchestrator-core session 路径外层与 auth 路径同形（facade-http-v1）
5. `nacp-session` 接收 5 族（7 个）新 message_type；server WS frame 全部对齐 `NacpSessionFrameSchema`；`session-ws-v1.md` 完整文档化
6. 5 个 facade 必需 HTTP 端点 + 7 个新 message_type 在 preview env 可被 web/wechat 客户端调通；`/me/sessions` 语义冻结
7. cross-e2e 7 天连续绿；first-real-run + wechat e2e 不回归；rollback runbook 演练通过

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | 6 个 PR (PR-A 到 PR-F) 全部 merge；agent-core/bash-core HTTP 内部路径删除；5 个新 HTTP + 7 个新 message_type 可用；`/me/sessions` server-mint 生效 |
| 测试 | 所有单测、cross-e2e、live preview e2e 全绿 7 天；parity 触发 ≥ 1000 turns 0 mismatch；双头校验单测全绿 |
| 文档 | profile 文档、4 篇 facade-必需 api-docs、`session-ws-v1.md`、worker README、runbook、GPT/Opus 报告标注 ZX2 已落地 |
| 风险收敛 | P0 风险关闭（公网入口 + agent-core preview + binding-scope）；envelope 碎片归 1（基于 NACP）；error shape 归 1；rollback runbook 演练通过 |
| 可交付性 | preview env 可演示 register→start→permission→deny→cancel；wechat 小程序拉 sessions list；非 facade worker 公网默认 404 |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`{RETRO_1}`
- **哪些编号的拆分还不够合理**：`{RETRO_2}`
- **哪些问题本应更早问架构师**：`{RETRO_3}`
- **哪些测试安排在实际执行中证明不够**：`{RETRO_4}`
- **模板本身还需要补什么字段**：`{RETRO_5}`
- **NACP 协议补齐过程中是否暴露了已有协议层的盲区**：`{RETRO_6}`

---

## 10. 结语

这份 action-plan v2 以 **transport 层"修边收口、契约统一、协议为唯一约束源"** 为第一优先级，采用 **"先名后形、先内后外、NACP 双头校验"** 的推进方式，优先解决 **HTTP→RPC 退役不彻底 + envelope 碎片 + facade 必需能力缺口** 三个根问题，并把 **dual-track parity 7 天观察 + runtime feature flag + rollback runbook + 1 周 compat 窗口** 作为主要风险约束。整个计划完成后，nano-agent 6-worker matrix 的 transport 层应达到 **"5 profile 命名冻结、内部全 RPC、内外 envelope 同形且统一基于 NACP、前端 facade 必需能力闭环"** 的稳定目标态，从而为后续的 **multi-modal messages / files artifact / conversations / devices revoke / MCP / rewind / fork** 等高阶能力（ZX3 候选）提供单一形态、可验证、可演进的契约基础。

---

## 11. GPT 附加审查意见（2026-04-27）

### 11.1 对新增 `packages/orchestrator-rpc-contract` 的判断

**结论：不建议按当前计划新建一个同时承载 `Envelope<T>` / `RpcMeta` / `RpcErrorCode` / worker RPC interface 的大包。** 该安排容易把 NACP 已经拥有的协议职责复制一份，形成第二套“准协议层”。

理由：

1. `@haimang/nacp-core` 已经是内部消息与 transport 的单一协议层，包含 envelope、authority、trace、error registry、transport precheck、tenant boundary 和 admissibility。ZX2 若再在 `orchestrator-rpc-contract` 里定义通用 `Envelope<T>` / `RpcMeta` / `RpcErrorCode`，会和 NACP-Core 的职责重叠。
2. `@haimang/nacp-session` 已经是 client ↔ session DO / WebSocket profile，且现有 frame 已经基于 `NacpEnvelopeBaseSchema` 扩展。`session-ws-v1` 的新增 message types 更适合进入 `nacp-session`，而不是进入一个 orchestrator 专属 contract 包。
3. `orchestrator-auth-contract` 已经承载 auth worker 的业务 RPC contract。Auth 的 `{ok,data}` / `{ok,false,error}` 可以向一个 shared facade envelope 迁移，但不应由新包重新定义一套与 NACP 并列的“内部 RPC envelope”。

建议拆分为：

| 内容 | 建议归属 |
|---|---|
| 内部 NACP envelope、authority、trace、generic error body、transport precheck | `packages/nacp-core` |
| session WS message/frame schema、ack/heartbeat/replay、permission/usage/skill/command/elicitation WS frames | `packages/nacp-session` |
| public facade HTTP `{ok,data}` / `{ok,false,error}`、trace field、error status shape | 可放 `packages/orchestrator-auth-contract` 扩展为 `orchestrator-facade-contract`，或新建更明确的 `packages/orchestrator-facade-contract` |
| `AgentCoreRpc` / `BashCoreRpc` 等 worker-specific WorkerEntrypoint interface | 可新建轻量 worker contract 包，但它必须 import/reuse NACP types，不得重新定义 Envelope/RpcMeta/ErrorCode |

因此，如果保留新包，我建议把它改名/缩小为 **worker-specific contract package**，只放 `AgentCoreRpc`、`BashCoreRpc`、输入输出 schema 和 facade-specific helper；通用协议对象应吸收到 `nacp-core` / `nacp-session`，不要复制。

### 11.2 已代答的 Q&A 与留空项

我已按规则直接填写 Q2-Q6：这些问题与 GPT 前序调查结论一致，或可通过补充约束达成一致。

**Q1 保持留空，需要业主决策。** 我不同意 Opus 当前倾向“agent-core preview 保留 `workers_dev:true`”。理由是：ZX2 的核心目标之一是确立 `orchestrator-core` 为唯一业务 public facade；agent-core 的 direct public session 面已经处于退休/兼容状态，preview 如果继续公网可达，会让 preview 与 production 安全模型长期不一致，也会让前端/调试脚本绕过 facade 的坏路径继续存在。我的建议是：preview 也默认走 orchestrator-core facade；若短期必须保留 agent-core preview 公网入口，应只开放 `/health` 与明确退休响应，所有 `/internal/*` 和业务路径必须依赖 binding secret/authority 或直接不可公网访问，并设定移除日期。

### 11.3 增强计划的盲点 / 断点

1. **P1-03 “移除 service-binding，health 改 fetch-by-URL”与“非 facade worker workers_dev:false”存在断点。** 如果非 facade worker 不再公开，公网 URL health probe 就不可用；如果为了 health 重新暴露 URL，又会抵消关闭公网入口的安全收益。更稳妥做法是保留只用于 health 的 service binding，或把 health truth 改为部署元数据/内部 binding probe，而不是改成 public URL fetch。
2. **`nacp-session` 已有 frame/envelope 基础，P4 不应再发明 flat WS envelope。** 计划里的 `{message_type, seq, trace_uuid, session_uuid, body, error?}` 与现有 `NacpSessionFrameSchema` 字段不完全一致。建议 `session-ws-v1.md` 以 `nacp-session` frame 为规范，compat 层再映射现有轻量 frame。
3. **“5 类 message_type”实际列出了 7 个 message types。** `permission.request/decision`、`usage.update`、`skill.invoke`、`command.invoke`、`elicitation.request/answer` 是 5 个功能族但 7 个 message types。文档应统一写法，避免测试和 registry 漏项。
4. **`streamSnapshot` RPC 返回 `Envelope<{ndjson:string}>` 有尺寸和语义风险。** NDJSON 字符串会丢失 streaming/backpressure 语义，也可能触发 envelope size 上限。更建议复用 `NacpProgressResponse`、ReadableStream，或定义 cursor/paginated snapshot。
5. **Phase 5 端点范围偏大，可能把 transport enhance 扩成产品功能大包。** permission、usage、catalog、sessions list 是 transport/facade 必需；devices revoke、files、conversations 深层语义可能涉及 auth、filesystem、D1 truth 和 UI 产品决策，建议标 P1/P2 优先级或拆为 follow-up，避免 ZX2 失焦。
6. **`/me/sessions` 与既有 `/sessions/{sessionUuid}/start` 路径关系需要冻结。** 如果引入 server-minted session，客户端是否还能自带 UUID？重复 start、未 start 的 pending UUID、TTL 到期、跨设备 resume 都需要明确，否则会形成新的 session identity 碎片。
7. **bash-core authority 不能只“照抄字段”，还要定义调用来源。** capability call 应记录 producer/source（agent-core/session/runtime）与 request_uuid，以便审计和幂等；否则即便 tenant 正确，也难以追踪 capability 滥用。
8. **删除 internal HTTP path 的回滚策略需要更明确。** P3-05 是 destructive；除了 7 天 parity，还应保留 runtime flag、deploy rollback runbook 和 compatibility window。否则一旦 WorkerEntrypoint 在某 env 表现不同，恢复成本偏高。
9. **context/gemini-cli 证据仍缺失。** GPT 调查时当前 checkout 没有 `context/` 源码树，也没有找到 gemini-cli 调查材料。ZX2 引用三类 CLI 作为能力缺口依据时，应区分“已由 docs/investigation 支撑的 claude/codex”与“待补证的 gemini-cli”。

### 11.4 总体建议

ZX2 的方向正确：先冻结 transport profile，再补内部 RPC，再统一 facade HTTP/WS，最后补前端能力。但建议在执行前先做三处修订：

1. 把 `orchestrator-rpc-contract` 缩小或拆分，通用协议内容回收到 `nacp-core` / `nacp-session`。
2. 重写 P1-03 health probing 方案，避免“关公网入口”与“fetch-by-URL health”互相抵消。
3. 将 Phase 5 端点分级，先交付 transport/facade 必需能力，产品型能力拆到后续 plan。

> **v2 落地状态**：§11.4 三条建议已全部落到正文 §0-§10：① §1.5 / §2.2[O12] 撤销新包，通用协议回收 NACP；② §4.1 P1-03 改为保留 service-binding + binding-scope 守卫；③ §4.5 / §4.6 拆 Phase 5 → Phase 5 (facade 必需) + Phase 6 (客户端同步)，§2.2[O8-O11] 把产品型功能列入 ZX3 候选。§11.3 #1-#9 同步在正文标注解决方案（P1-03 / P3-02 stream snapshot / P3-03 bash authority / P3-05 rollback / P4-04 frame 对齐 / P5-02 `/me/sessions` 语义 / Q1 决策；§11.3 #9 列入 §2.2[O13]）。

---

## 12. 执行日志（Phase 1 + Phase 2 实施报告）

> 执行人: Opus 4.7（1M ctx）
> 时间: 2026-04-27
> 范围: ZX2 Phase 1（4 工作项）+ Phase 2（4 工作项）实施完成；Phase 3-6 待后续执行
> 关联收尾文档: `docs/issue/zero-to-real/ZX2-closure.md`

### 12.1 完成情况速查

| Phase | 编号 | 状态 | 证据 |
|---|---|---|---|
| Phase 1 | P1-01 profile 命名文档 | ✅ done | `docs/transport/transport-profiles.md`（284 行）冻结 5 profile |
| Phase 1 | P1-02 wrangler workers_dev audit | ✅ done | 6 个 wrangler.jsonc 全部显式声明：orchestrator-core=true，其余=false（含 agent-core preview=false，采纳 Q1 决策） |
| Phase 1 | P1-03 binding-scope 守卫 | ✅ done | 4 个非 facade worker fetch 入口加 401 binding-scope-forbidden（bash 检 secret，context/fs/auth 直接 401） |
| Phase 1 | P1-04 api-docs README profile 索引 | ✅ done | `clients/api-docs/README.md` 加 5 profile 表 + 9 篇文档分级 |
| Phase 2 | P2-01/02 NACP rpc.ts | ✅ done | `packages/nacp-core/src/rpc.ts`（约 320 行）+ index 导出；30/30 单测全绿 |
| Phase 2 | P2-03 nacp-session 5 族 7 message_types | ✅ done | `messages.ts` / `type-direction-matrix.ts` / `session-registry.ts` 同步扩；27/27 新单测 + 修 1 个 size assert |
| Phase 2 | P2-04 facade-http-v1 in auth-contract | ✅ done | `packages/orchestrator-auth-contract/src/facade-http.ts`（约 170 行）+ index 导出；15/15 新单测全绿 |

### 12.2 测试矩阵

| 包 / Worker | tests | 通过 | 备注 |
|---|---|---|---|
| `@haimang/nacp-core` | 289 | 289 ✅ | 含 30 新增 rpc.test.ts |
| `@haimang/nacp-session` | 146 | 146 ✅ | 含 27 新增 zx2-messages.test.ts；修 1 个旧 registry size assert |
| `@haimang/orchestrator-auth-contract` | 19 | 19 ✅ | 含 15 新增 facade-http.test.ts |
| `workers/orchestrator-auth` | 8 | 8 ✅ | 修 1 个 public-surface.test.ts（404→401 + worker 字段） |
| `workers/orchestrator-core` | 36 | 36 ✅ | 无修改 |
| `workers/agent-core` | 1049 | 1049 ✅ | 无修改 |
| `workers/bash-core` | 360 | 360 ✅ | 修 2 个 smoke.test.ts（注入 secret）+ 加 1 个新 binding-scope reject 测试 |
| `workers/context-core` | 171 | 171 ✅ | 修 1 个 smoke.test.ts（404→401 binding-scope-forbidden） |
| `workers/filesystem-core` | 294 | 294 ✅ | 修 1 个 smoke.test.ts（同上） |
| **合计** | **2372** | **2372 ✅** | |

### 12.3 文件改动清单（22 modified + 7 new）

**新增**（7 个）:
- `docs/transport/transport-profiles.md` — 5 profile 命名冻结
- `packages/nacp-core/src/rpc.ts` — Envelope/RpcMeta/RpcErrorCode/validateRpcCall
- `packages/nacp-core/test/rpc.test.ts` — 30 测试
- `packages/nacp-session/test/zx2-messages.test.ts` — 27 测试
- `packages/orchestrator-auth-contract/src/facade-http.ts` — facade-http-v1 contract
- `packages/orchestrator-auth-contract/test/facade-http.test.ts` — 15 测试
- `docs/issue/zero-to-real/ZX2-closure.md` — 收尾专项文档

**修改 packages**（5 个）:
- `packages/nacp-core/src/index.ts` — 加 rpc.ts 公开导出
- `packages/nacp-session/src/messages.ts` — +143 行：5 族 7 message_type 的 schema
- `packages/nacp-session/src/type-direction-matrix.ts` — +11 行：7 个 type-direction
- `packages/nacp-session/src/session-registry.ts` — +48 行：role + phase
- `packages/nacp-session/src/index.ts` — 加 ZX2 导出
- `packages/nacp-session/test/messages.test.ts` — 1 行 assert 升级
- `packages/orchestrator-auth-contract/src/index.ts` — 加 facade-http 导出

**修改 workers**（11 个）:
- `workers/orchestrator-core/wrangler.jsonc` — workers_dev:true 显式
- `workers/orchestrator-auth/wrangler.jsonc` — workers_dev:false
- `workers/orchestrator-auth/src/public-surface.ts` — 404→401 + binding-scope-forbidden
- `workers/orchestrator-auth/test/public-surface.test.ts` — 同步
- `workers/agent-core/wrangler.jsonc` — workers_dev:false（含 preview，采纳 Q1）
- `workers/bash-core/wrangler.jsonc` — workers_dev:false
- `workers/bash-core/src/index.ts` — binding-scope guard + secret 校验
- `workers/bash-core/test/smoke.test.ts` — 2 测试加 secret + 1 新 reject 测试
- `workers/context-core/wrangler.jsonc` — workers_dev:false
- `workers/context-core/src/index.ts` — binding-scope-forbidden
- `workers/context-core/test/smoke.test.ts` — 同步
- `workers/filesystem-core/wrangler.jsonc` — workers_dev:false
- `workers/filesystem-core/src/index.ts` — binding-scope-forbidden
- `workers/filesystem-core/test/smoke.test.ts` — 同步

**修改 clients**（1 个）:
- `clients/api-docs/README.md` — profile 索引 + 9 篇文档分级表

### 12.4 落地的关键设计决策

1. **NACP 单一协议源**（v2 修订采纳）：通用协议对象（`Envelope<T>` / `RpcMeta` / `RpcErrorCode` / `validateRpcCall` / `envelopeFromThrown` / `envelopeFromAuthLike`）落在 `packages/nacp-core/src/rpc.ts`；不再新建 `orchestrator-rpc-contract` 包。`facade-http-v1` 落在 `orchestrator-auth-contract/src/facade-http.ts`，并在编译期通过 `_authErrorCodesAreFacadeCodes` assignment 保证 `AuthErrorCode ⊂ FacadeErrorCode`。

2. **双头校验机制就绪**：`validateRpcCall(rawInput, rawMeta, options)` 提供 caller-side 双头校验入口，支持 `requireAuthority` / `requireTenant` / `requireSession` / `requireRequestUuid` 四种约束开关。callee-side 的 `validateEnvelope` + `verifyTenantBoundary` + `checkAdmissibility` 已在 `nacp-core` 现成，Phase 3 实施时只需在每个 RPC method 入口调用。

3. **5 族 7 message_type 注册**：`session.permission.{request,decision}`、`session.usage.update`、`session.skill.invoke`、`session.command.invoke`、`session.elicitation.{request,answer}` 全部落 `messages.ts` + `type-direction-matrix.ts` + `session-registry.ts`（role 与 phase 三处全部注册）。`SESSION_MESSAGE_TYPES` 从 8 升至 15。

4. **agent-core preview 公网入口关闭**（Q1 决策）：`agent-core/wrangler.jsonc` 的 `workers_dev` 从 `true` 改为 `false`，preview 与 production 安全模型对齐。本地开发改用 `wrangler dev` 或经 orchestrator-core facade。

5. **binding-scope 守卫与 service-binding 共存**（采纳 GPT §11.3 #1）：未移除 orchestrator-core 对 BASH/CONTEXT/FS 的 service-binding；改为在每个非 facade worker 的 fetch 入口加 `if (pathname !== '/health') return 401`。bash-core 额外检查 `x-nano-internal-binding-secret` header，为 Phase 3 P3-03 的 NACP authority 校验留出对接位。

6. **错误响应统一为 `binding-scope-forbidden`**：所有非 facade worker 拒绝公网请求时返回 `{ error: "binding-scope-forbidden", message, worker }` + HTTP 401。orchestrator-auth 旧 404 `not-found` 也升级为同形（与监控 grep 一致）。

### 12.5 风险与遗留事项

| ID | 风险/遗留 | 状态 | 后续动作 |
|---|---|---|---|
| R1 | bash-core 未加 NACP authority 校验（仅 secret） | open | Phase 3 P3-03 落地 NACP authority + caller/source/request_uuid |
| R2 | agent-core 仍只有 start/status RPC（5 个 action 缺 shadow） | open | Phase 3 P3-01/02 |
| R3 | orchestrator-core session 路径未 envelope 化 | open | Phase 4 P4-02 |
| R4 | DO `HttpController` 仍吐 `{ok:true,action,phase}` | open | Phase 4 P4-03 |
| R5 | server WS frame 未对齐 `NacpSessionFrameSchema` | open | Phase 4 P4-04 |
| R6 | facade 必需 5 端点 + WS 接入未实施 | open | Phase 5 P5-01/02/03 |
| R7 | web/wechat 客户端未切到统一 narrow | open | Phase 6 P6-01/02 |
| R8 | live preview e2e 未跑通 | open | Phase 6 P6-03 |
| R9 | rollback runbook 未撰写 | open | Phase 3 P3-05 |

### 12.6 与 ZX2 plan 总收口标准的对照

| §8.2 收口项 | 进度 |
|---|---|
| 1. 5 profile 在 transport-profiles.md 命名冻结 | ✅ 完成（含 `frozen-v1` 标签） |
| 2. 全 6 worker wrangler.jsonc 显式审计 + 非 facade 公网关闭 | ✅ 完成 |
| 3. agent-core 7 action 全 RPC + bash-core RPC + secret + authority | 🟡 部分（P1-03 binding-secret 已落，NACP authority 与 stream snapshot 待 Phase 3） |
| 4. 内部 RPC 走 Envelope+RpcMeta；error 1 种；session 与 auth 同形 | 🟡 部分（contract 已落，runtime 切换待 Phase 3+4） |
| 5. nacp-session 5 族；server frame 对齐 NacpSessionFrameSchema；session-ws-v1.md | 🟡 schema 已落（Phase 2 P2-03），frame 对齐 + 文档撰写待 Phase 4 |
| 6. 5 个 facade 必需 HTTP + 7 个新 message_type 在 preview env 跑通；/me/sessions 语义冻结 | ⏳ 未开始（Phase 5） |
| 7. cross-e2e 7 天连续绿；first-real-run + wechat e2e 不回归；rollback runbook 演练通过 | ⏳ 未开始（Phase 6） |

> Phase 1+2 是 ZX2 整个计划的"地基"——profile 命名 + NACP 协议补齐 + facade 公约扩展 + 安全收口；Phase 3-6 都依赖它们。本次实施已经把"契约层"全部交付，接下来 Phase 3-6 可以按 plan 逐步执行而不需要重新决策接口形状。

### 12.7 收尾文档

详细的工作内容、证据、后续动作清单见 `docs/issue/zero-to-real/ZX2-closure.md`（本次同时撰写的收尾专项文件）。
