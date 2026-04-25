# Plan Zero-to-Real — NACP-First Real Auth, Persistence, Runtime, and Client Validation

> 文档对象:`nano-agent / zero-to-real phase charter`
> 刷新日期:`2026-04-24 (r2)`
> 作者:`GPT-5.4`
> 文档性质:`phase charter / NACP-first real-loop bringup / auth+persistence+runtime+client validation`
>
> **修订历史:**
> - **r1 draft (2026-04-24)**: 基于 `orchestration-facade` 闭合事实、`docs/eval/zero-to-real/plan-analysis-by-opus-v2.md`、`docs/eval/zero-to-real/plan-hardening-by-GPT.md` 与 `context/{ddl-v170,smind-admin,smind-contexter}` 的代码事实，起草 zero-to-real 基石文件草稿。当前版本刻意**不包含 QnA**；QnA 留到 design 阶段再做。
> - **r2 (2026-04-24)**: 基于 `docs/charter/review/plan-zero-to-real-reviewed-by-opus.md` 的事实核查与结构性反馈，完成 8 项修订：(1) Z0 拆分为 charter-freeze 与 design-handoff；(2) Z2 纳入 stateful uplift 最低集合；(3) Z4 改为只承接延后 stateful 工作；(4) 全局 Out-of-Scope 补齐 admin UI / observability；(5) 明确 API key verify 运行时路径与 API key admin plane 的边界；(6) 补 `ZX-d1-schema-and-migrations.md` 与 `ZX-llm-adapter-and-secrets.md` 两份 cross-cutting design；(7) 补 `Workers AI first` decision-trail；(8) 补 `nano_session_activity_logs` 无 ddl-v170 直接祖宗的说明。
>
> **输入依据:**
> - `docs/handoff/orchestration-facade-to-next-phase.md`
> - `docs/issue/orchestration-facade/orchestration-facade-final-closure.md`
> - `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md`
> - `docs/eval/zero-to-real/plan-hardening-by-GPT.md`
> - `docs/charter/review/plan-zero-to-real-reviewed-by-opus.md`
> - `context/ddl-v170/{README.md,GLOSSARY.md,smind-01-tenant-identity.sql,smind-06-conversation-context-session.sql,smind-09-tenant-billing-quota-usage.sql}`
> - `context/smind-admin/{wrangler.toml,src/**,tests/**}`
> - `context/smind-contexter/{src/chat.ts,src/engine_do.ts,core/jwt.ts}`
> - 当前 `workers/**`、`packages/nacp-core/**`、`packages/nacp-session/**`、`workers/orchestrator-core/**`、`workers/agent-core/**` 真实代码事实

---

## 0. 为什么这份文档要现在写

`orchestration-facade` 已经把 nano-agent 从“单 worker 内部拼装”推进到“public façade + private runtime mesh + authority hardening”的状态，但系统仍然没有进入真正的 first real run：

1. **auth 仍不完整**
   - 真实 end-user auth substrate 尚未独立成形
   - WeChat bridge 尚未实现
2. **共享持久化真相仍不完整**
   - D1 还没有成为 session / turn / message / context / audit 的 SSOT
3. **runtime 仍有 fake path**
   - kernel loop 已存在，但 provider 仍未进入真实 production path
4. **真实 client experiment 尚未闭合**
   - web / Mini Program 还没有把 login -> start -> input -> stream -> history 跑成真闭环

如果继续停留在“局部设计正确但没有真实使用面”的状态，nano-agent 会长期停在 scaffold / façade 阶段，而无法验证它最核心的产品 proposition。

因此本 charter 的作用是：

> **把下一阶段从“继续补 gap”明确改写为“第一次把 nano-agent 推到可持续真实运行的 baseline”。**

### 0.1 为什么叫 `zero-to-real`

`bridging-the-gap` 只说明“还有 gap”，但不说明要补到什么状态。  
本阶段真正要到达的是：

1. 真实身份
2. 真实租户边界
3. 真实 agent loop
4. 真实持久化真相
5. 真实客户端实验

因此 `zero-to-real` 比 `bridging-the-gap` 更准确。

### 0.2 这份 charter 当前**不**包含 QnA

本版本按 owner 要求，**不在 charter 中展开 QnA**。  
原因不是 QnA 不重要，而是要把本阶段的基石定义、边界、阶段目标、设计清单先冻结，再在 design 阶段用专题 QnA 去收束每个 phase 的执行细节。

因此：

- 本 charter **不产出** `QnA / FX-qna / ZX-qna` 文件
- QnA 将作为 design 阶段的配套工件，在本 charter owner-approved 后再进入

---

## 1. 本轮已经确认的 Owner Decisions 与基石事实

### 1.1 `zero-to-real` 的目标不是“更小功能”，而是“更小但完整的真实闭环”

这一点已经由本轮讨论重新校准。  
本阶段不再追求“最小 demo 面”，而追求：

> **NACP-first 的完整 end-user auth、多租户安全门禁、真实持久化、真实模型输出、真实 audit/context truth、真实客户端实验。**

### 1.2 NACP 不是背景板，而是执行真理

当前仓库真实代码已经说明：

1. `@haimang/nacp-core`
   - 已冻结 envelope / authority / trace / control / transport / tenancy / evidence vocabulary
2. `@haimang/nacp-session`
   - 已冻结 `session.start`、`session.followup_input`、ack / heartbeat / resume / replay 的 session profile
3. `workers/orchestrator-core/src/auth.ts`
   - 已有 public ingress 的 JWT + `trace_uuid` + tenant mismatch rejection
4. `workers/agent-core/src/host/internal-policy.ts`
   - 已有 internal authority / trace / no-escalation 校验

因此 zero-to-real 的所有 auth / persistence / runtime / client 工作，都必须在 **NACP law 已成立** 的前提下推进。

### 1.3 auth 必须是完整 end-user auth flow，而不是最小 login demo

本轮讨论已经明确修正：

1. zero-to-real **必须**包含完整 end-user auth substrate
2. 这条线**必须**包括 WeChat bridge
3. 但它**不等于** first-wave 就要吞下完整 admin plane / API key product surface

换句话说，本阶段要做强的是：

- user entry
- token truth
- tenant truth
- real client auth loop

而不是完整 control-plane richness。

### 1.4 多租户门禁、双头校验、tenant boundary 必须进入主线

当前仓库已经有一部分 shipped truth：

1. public ingress 有 tenant claim / deploy tenant 对齐
2. internal ingress 有 body/header authority 与 trace 的 no-escalation
3. `nacp-core` 的 `authority`, `trace`, `tenant_delegation`, tenant-prefixed refs 都是 first-class
4. `nacp-session` 明确 authority 只能 server-stamped

因此 zero-to-real 必须把：

- JWT claims -> `AuthSnapshot` -> `NacpAuthority`
- public / internal 双头校验
- D1 / DO / KV / R2 / refs 的 tenant boundary

统一写成主线，而不是边角条件。

### 1.5 D1 first-wave 必须是 thin-but-complete，而不是 too-thin

本轮讨论已经明确，real loop 的 first baseline 不能只落 conversation/message 两三张表，而必须至少覆盖：

1. identity core
2. conversation / session / turn / message core
3. context snapshot core
4. trace-linked activity / audit core
5. usage / quota minimal core

这不是在做 full richness，而是在保证 **真实 loop 可持久、可回看、可追责**。

> **注**：文中提到的 `nano_session_activity_logs` 是 **nano-agent 在 zero-to-real 阶段的新设计**，不是 `ddl-v170` 中可直接照搬的祖宗表。`ddl-v170` 中最接近的是 `smind-04` 里的 process/event 语义，但该模块整体不在本阶段吸收范围内；因此 activity/audit schema 需要在 `ZX-d1-schema-and-migrations.md` 中单独冻结。

### 1.6 真实客户端不是附属验证，而是本阶段目标的一部分

本阶段必须同时承认两件事：

1. web thin client 是更早的稳定验证面
2. Mini Program + WeChat 是 owner 明确要求的真实目标入口

因此 zero-to-real 不能只做到 backend proof；它必须以真实 client loop 作为 exit truth 的一部分。

### 1.7 RPC / binding / internal HTTP 退役是本阶段边界治理主线之一

这也是本轮对 charter 的关键修正点。  
前一版若把 `internal RPC` 笼统打入 out-of-scope，会误导为“本阶段不处理 worker 间 transport 边界”。这与 owner + Opus 已确认的方向不一致。

当前更准确的判断是：

1. **`orchestration.core` 必须继续是唯一对外入口**
   - public HTTP / WebSocket 只进 `orchestration.core`
   - 其他 worker 都是 internal-only
2. **`orchestrator.auth` 必须从 day-1 就是 pure internal binding / RPC**
   - 不开 public route
   - 只接受 `orchestration.core` 一个 caller
   - 其 exact transport form（WorkerEntrypoint RPC vs 过渡期 fetch-binding shim）在 `ZX-binding-boundary-and-rpc-rollout.md` 冻结；charter 本体只冻结 **single caller / no public route / internal-only** 三条硬纪律
3. **`orchestration.core -> agent.core` 的 control-plane 调用必须在本阶段启动 RPC 化**
   - `start / followup / cancel / status / verify / timeline` 这类 control-plane 适合 typed RPC
4. **internal HTTP 全面退役完成不是本阶段硬 gate**
   - 尤其 `stream` / relay / WS attach 相关 stream-plane 可以保留过渡期
   - 但其范围必须被显式收窄，而不能继续无限扩张

一句话收口：

> **zero-to-real 要把 RPC 当成 internal security boundary 与 binding discipline 的主线之一推进，而不是把它整体拖到后续阶段。**

### 1.8 Workers AI first 是显式 charter 决策，不是默认漂移

在 provider 顺序上，本 charter 明确采用：

1. **Z3 first provider = Workers AI**
2. **DeepSeek adapter = optional 增量 / 后续 fallback track**

这是一个**显式决策**，不是默认值。  
它来自 `docs/eval/zero-to-real/plan-hardening-by-GPT.md` 对 Opus v2 `DeepSeek primary` 建议的修正，理由是：

1. Workers AI 是 platform-native binding
2. 不引入 day-1 per-tenant secret / rotation / cache invalidation 复杂度
3. 能最快把 fake provider 从 production path 上拿掉

因此后续 design 阶段冻结的是：

- 模型选择
- fallback 触发条件
- DeepSeek adapter / tenant secrets 的具体工程

而**不是**重新打开“本阶段 first provider 是谁”的根决策。

---

## 2. 当前仓库的真实起点

### 2.1 已成立的 shipped truth

1. **orchestration-facade 已闭合**
   - public ingress owner 已切到 `orchestrator-core`
   - internal authority hardening 已成立
   - canonical façade 与 relay path 已打通

2. **NACP core / session 已可作为协议基石**
   - `nacp-core` 与 `nacp-session` 已有明确 published surface
   - trace / authority / session profile 已冻结

3. **kernel runtime scaffold 已存在**
   - `workers/agent-core/src/kernel/runner.ts` 已有真实 loop、tool exec、runtime events

4. **trace / audit vocabulary 已存在**
   - `workers/agent-core/src/host/traces.ts` 已有 trace-law compliant event builders

5. **context 包级基础已存在**
   - `workers/context-core/src/context-assembler.ts`
   - `workers/context-core/src/snapshot.ts`
6. **transport primitives 已具备，但 runtime worker 还没有真正用起来**
   - `packages/nacp-core/src/transport/service-binding.ts` 已有 `ServiceBindingTransport`
   - `packages/nacp-core/src/transport/do-rpc.ts` 已有 `DoRpcTransport`
   - 当前 runtime worker 仍主要使用 fetch-backed service binding + guarded `/internal/*`
7. **`orchestration.core` user DO 仍是 registry / relay owner，不是完整 user-state host**
   - 当前有 WS attach / session registry / relay 能力
   - 但还没有 DO SQLite、Alarm、conversation 聚合最低集合

### 2.2 本阶段必须补齐的核心 gap

| gap | 当前事实 | 本阶段对应 |
| --- | --- | --- |
| 完整 end-user auth 不存在 | 没有独立 `orchestrator.auth`; WeChat bridge 缺失 | Z1 |
| internal boundary 仍停在 fetch-backed internal HTTP | `orchestrator-core -> agent-core` 仍通过 `/internal/*` + secret header + URL path 调用 | Z0-Z3 |
| user-stateful substrate 不完整 | 当前 user DO 尚无 DO SQLite / Alarm / conversation 聚合最低集合 | Z2-Z4 |
| 共享 D1 真相层不完整 | session / turn / context / audit 还没成为 D1 SSOT | Z2 |
| real provider 未上 production path | kernel 有 loop, provider 仍是假路径 | Z3 |
| quota runtime truth 不存在 | quota hook 还未成为 side-effect gate | Z3 |
| real client loop 未闭合 | web / Mini Program 未形成连续真实链路 | Z4 |

### 2.3 本阶段明确不负责的内容

1. 完整 tenant admin / API key admin 面
2. internal HTTP **全面**退役完成 / 所有 internal seam 一次性 RPC-only 化
3. cold archive / R2 history offload
4. `smind-06` / `smind-09` full richness 全量吸收
5. platform-level SLO / billing / dashboard / ops plane
6. tenant-facing admin UI / 自助控制台 / 前端管理面板
7. platform-level observability dashboard / metrics plane / ops console

---

## 3. 本阶段的一句话目标

> **在 orchestration-facade 已闭合、NACP 已可作为协议基石的基础上，完成 5 件事：Z0 收紧 contract、binding boundary 与 compliance baseline；Z1 建立完整 end-user auth 与 tenant foundation，并让 auth worker 从 day-1 走 pure RPC；Z2 建立 session / turn / message / context / audit 的 D1 真相层，并启动 `orchestration.core -> agent.core` 的 control-plane RPC 化；Z3 让 real provider、quota gate 与下游 binding discipline 成为 production truth；Z4 用 web + Mini Program 跑通 first real run，并把剩余 internal HTTP 收敛为明确的过渡面与 backlog。**

---

## 4. 本阶段边界：全局 In-Scope / Out-of-Scope

### 4.1 全局 In-Scope

1. NACP realization track
2. 完整 end-user auth（含 WeChat）
3. multi-tenant / no-escalation / tenant boundary 真实落地
4. binding boundary freeze + internal RPC kickoff
5. `orchestration.core` 继续作为唯一 public façade
6. thin-but-complete D1 schema 与持久化真相
7. real provider 接线
8. quota minimal runtime truth
9. web + Mini Program 真实实验

### 4.2 全局 Out-of-Scope

1. 完整 admin plane
2. 完整 API key **admin** plane（list/create/revoke/rotate/UI），不包含最小运行时 verify 路径
3. 所有 internal stream / relay / WS 相关路径一步到位全面 RPC-only 化
4. cold archive / R2 offload
5. full quota policy / ledger / alerts plane
6. collaboration richness 全量化
7. NACP 之外的新协议家族扩张
8. tenant-facing admin UI / 自助控制台 / 前端管理面板
9. platform-level observability dashboard / metrics / ops plane

---

## 5. 本阶段的方法论

### 5.1 NACP-First-Execution

所有功能都先回答 3 个问题，再进入实现：

1. 它对应哪类 authority / trace / session message？
2. 它的 tenant boundary 在哪里？
3. 它怎样回挂到 audit / evidence / persistent truth？

### 5.2 Thin-But-Complete Persistence

本阶段不追求 `smind-06` / `smind-09` 的 full breadth，但也绝不接受“薄到无法验证真实 loop”的 D1 切法。

### 5.3 Real-Client-Driven Validation

web 与 Mini Program 不是 demo，而是用来暴露 auth / WS / history / reconnect / context / audit 的真实 gap。

### 5.4 Runtime Truth Before Internal Elegance

在 zero-to-real 内：

- real auth
- real D1 truth
- real provider
- real client loop

优先级高于：

- full RPC retirement
- cold layer
- admin richness

### 5.5 RPC-First For Internal Control Plane

在 worker-to-worker 互通里，本阶段采用分层纪律：

1. **control-plane 优先 RPC 化**
   - auth verify / register / login / reset
   - session start / followup / cancel / status / verify / timeline
2. **stream-plane 渐进退役**
   - `stream`
   - relay / NDJSON frame pull
   - WS attach / reconnect 相关过渡面

这意味着 zero-to-real 内部 transport 的正确口径不是“HTTP vs RPC 二选一”，而是：

> **先把 control-plane 的 internal HTTP 逐步退掉，再按真实 gap 收缩 stream-plane 的残留过渡面。**

### 5.6 Boundary-First Binding Discipline

本阶段的 binding 纪律如下：

1. `orchestration.core` = **唯一 public façade**
2. `orchestrator.auth` = **internal-only / only called by orchestration.core**
3. `agent.core` = **runtime host / only internal**
4. `bash.core / context.core / filesystem.core` = **only internal**
5. `orchestration.core` 不直接扩成超级路由器，不应继续直接 bind context/filesystem
6. `agent.core` 承担 runtime mesh 对 bash/context/filesystem 的内部调用

### 5.7 Gap-Driven Stateful Uplift

`orchestration.core` 是否要进一步 stateful uplift，不按“抽象优雅感”决定，而按真实 loop 暴露出的 gap 决定。  
若现有 façade + user DO 无法承接真实 session/history/reconnect 语义，则该 uplift 必须在本阶段内解决。

---

## 6. Phase 总览

| Phase | 名称 | 类型 | 核心目标 | 主要风险 |
| --- | --- | --- | --- | --- |
| **Z0** | Contract + Compliance Freeze | charter/design freeze | 冻结 auth / D1 / NACP / binding boundary / RPC rollout / deferred baseline | 范围继续漂移，design 阶段失焦 |
| **Z1** | Full Auth + Tenant Foundation | auth + persistence | 建立完整 end-user auth、tenant truth、auth pure RPC boundary | auth surface 过宽、WeChat bridge 调试面扩大 |
| **Z2** | Session Truth + Audit Baseline | persistence + orchestrator wiring | 建立 real loop 的 D1 SSOT、user-state hot path 最低集合，并启动 control-plane RPC 化 | schema 过薄或过重、stateful uplift 不足、history/audit 语义断裂 |
| **Z3** | Real Runtime + Quota | runtime + provider | 接入真实模型、quota gate，并收紧 runtime mesh transport | provider / quota / trace / RPC 并行面闭环不一致 |
| **Z4** | Real Clients + First Real Run | client + hardening | 跑通 web + Mini Program 真实闭环，并压缩剩余 internal HTTP 面 | mobile / WS / reconnect / auth gap 集中暴露 |

---

## 7. 各 Phase 详细说明

### 7.1 Z0 — Contract + Compliance Freeze

#### 实现目标

把 zero-to-real 的执行 baseline 收紧成“最小但完整的真实闭环”，并明确 design / action-plan 的起跑线。

#### In-Scope

**Z0-charter-freeze（由本 charter 自己冻结）**

1. 冻结 worker 间 binding matrix：
   - 只有 `orchestration.core` 对外
   - `orchestrator.auth` internal-only
   - `agent.core` 只作为 runtime host 被内部调用
2. 冻结 RPC rollout law：
   - `orchestrator.auth` 走 pure internal transport
   - `orchestration.core -> agent.core` control-plane RPC-first
   - stream-plane 作为 transitional surface 渐进退役
3. 冻结 NACP realization track 作为全程主线
4. 冻结 `Z1-Z4` 的 in-scope / out-of-scope / exit criteria
5. 冻结 deferred / backlog 清单
6. 产出 design / action-plan / closure 文件清单与撰写顺序

**Z0-design-handoff（显式留给 design 阶段冻结）**

7. JWT claim schema 的字段级冻结（在 `ZX-binding-boundary-and-rpc-rollout.md` + `Z1-full-auth-and-tenant-foundation.md`）
8. D1 first-wave 精确 table / migration / FK / view 清单（在 `ZX-d1-schema-and-migrations.md`）
9. Session profile 使用面的逐消息冻结（在 `ZX-binding-boundary-and-rpc-rollout.md` + `Z2-session-truth-and-audit-baseline.md`）
10. quota minimal contract 的逐字段冻结（在 `ZX-d1-schema-and-migrations.md` + `Z3-real-runtime-and-quota.md`）
11. provider adapter / fallback / secrets 的细化冻结（在 `ZX-llm-adapter-and-secrets.md`）

#### Out-of-Scope

1. 任何具体 auth / D1 / runtime 代码实现
2. QnA 细节收束
3. admin plane scope 扩张
4. full stream-plane retirement 方案定稿
5. cold archive 方案设计

#### 交付物

1. `docs/charter/plan-zero-to-real.md`（本文件）
2. `docs/design/zero-to-real/` 与 `docs/action-plan/zero-to-real/` 文件规划清单
3. `docs/issue/zero-to-real/Z0-closure.md`

#### 收口标准

1. Z1-Z4 的目标、边界、design 清单、action-plan 清单已书面冻结
2. 本阶段明确不再把 QnA 混进 charter
3. charter-freeze 与 design-handoff 的边界已显式写清
4. binding boundary / RPC rollout law 已冻结
5. deferred items 已从 baseline 中剥离

### 7.2 Z1 — Full Auth + Tenant Foundation

#### 实现目标

第一次让系统拥有 **真实用户、真实租户、真实 JWT / WeChat 授权入口**。

#### In-Scope

1. 新建 `nano-agent-db`
2. 落 identity core：
   - `nano_users`
   - `nano_user_profiles`
   - `nano_user_identities`
   - `nano_teams`
   - `nano_team_memberships`
3. 新建 `orchestrator.auth`
4. 实装完整 end-user auth flow：
   - register
   - login
   - verify-token
   - refresh-token
   - password reset
   - `me` / tenant readback
   - WeChat bridge
5. 最小 API key **verify** 运行时路径（不含 admin plane）：
   - 仅用于 server-to-server 鉴权校验
   - 不引入 list/create/revoke/rotate/UI
6. `orchestrator.auth` 从 day-1 就走 pure internal transport：
   - 不开 public route
   - 只接受 `orchestration.core` 一个 caller
   - exact transport form 在 `ZX-binding-boundary-and-rpc-rollout.md` 冻结；charter 当前偏向 WorkerEntrypoint RPC-first
7. `orchestration.core` 作为唯一 public auth proxy
8. 冻结并实装 public ingress -> `AuthSnapshot` -> `NacpAuthority`
9. 跑双租户 / no-escalation / negative tests

#### Out-of-Scope

1. 完整 tenant admin CRUD
2. 完整 invite / member admin / API key admin plane
3. `agent.core` internal HTTP 退役
4. session / turn / message / context / audit 持久化
5. real provider 接线
6. Mini Program 全链路实验

#### 交付物

1. `workers/orchestrator-auth/` 或 owner-approved 等价位置
2. D1 identity core migrations
3. auth RPC entrypoint / binding contracts / tests
4. `docs/issue/zero-to-real/Z1-closure.md`

#### 收口标准

1. 两个真实 tenant 的用户能独立登录
2. Web 与 WeChat token 都能被正确验证
3. `orchestrator.auth` 无 public route，且只接受 `orchestration.core` 调用
4. authority / trace / tenant truth 已进入真实 ingress
5. 用 Mini Program 开发者工具或等价 mock 至少跑通一次 `code -> openid -> JWT` code-level 链路
6. negative cases 能稳定拒绝

### 7.3 Z2 — Session Truth + Audit Baseline

#### 实现目标

第一次让系统拥有 **真实 session truth**，使 real loop 具备“可持久、可回看、可追责”的最低能力。

#### In-Scope

1. 落 conversation truth：
   - `nano_conversations`
   - `nano_conversation_sessions`
   - `nano_conversation_turns`
   - `nano_conversation_messages`
2. 落 context snapshot truth：
   - `nano_conversation_context_snapshots`
3. 落 trace-linked activity / audit truth：
   - `nano_session_activity_logs` 或 owner-approved 等价表
4. `orchestration.core` user DO 的 stateful uplift 最低集合：
   - DO SQLite（或 owner-approved 等价 durable hot-state substrate）
   - Alarm / housekeeping baseline
   - conversation 聚合最低集合（至少支撑 history / reconnect / timeline 的真实热读路径）
5. `orchestration.core` 把：
   - start
   - followup
   - cancel
   - resume
   - stream
   与 D1 SSOT 接起来
6. 启动 `orchestration.core -> agent.core` 的 control-plane RPC：
   - `start`
   - `followup`
   - `cancel`
   - `status`
   - `verify`
   - `timeline`
7. 现有 `/internal/sessions/*` 保留为过渡面，但不再继续扩 control-plane HTTP 新面
8. history / reconnect / timeline / conversation list 可读
9. web thin client 先跑通真实 persistence loop

#### Out-of-Scope

1. `smind-06` full collaboration richness
2. `message_parts` / `context_items` 全量模型
3. cold archive / R2 offload
4. stream-plane 一步到位全面 RPC-only retirement
5. 双向 WS message handling / IntentDispatcher / Broadcaster 的完整终态
6. Mini Program 全链路 hardening

#### 交付物

1. D1 conversation/context/audit migrations
2. orchestrator persistence wiring
3. user DO stateful uplift 最低集合
4. control-plane RPC entrypoint / adapter scaffolding
5. history/timeline/conversation APIs
6. web thin client persistence proof
7. `docs/issue/zero-to-real/Z2-closure.md`

#### 收口标准

1. session 结束后 history 仍可查询
2. reconnect 后 timeline 不丢
3. user DO 的 hot-state 最低集合已成立，history / reconnect 不依赖纯冷路径兜底
4. `orchestration.core -> agent.core` 的 RPC entrypoint 已 scaffold，且至少 1 条主方法（推荐 `start`）具备双实现可用
5. turn/message/context/audit 可对齐到同一 trace / session
6. real loop 已达到最低可审计基线

### 7.4 Z3 — Real Runtime + Quota

#### 实现目标

把 loop 里当前仍是“假的”那部分换成真的：真实 provider 与真实 runtime quota guard。

#### In-Scope

1. `agent.core` 接入 Workers AI（本阶段唯一 required first provider）
2. fake provider 退为 test / demo path
3. capability / tool 执行前真实过 quota hook
4. 落 quota minimal truth：
   - `nano_usage_events`
   - `nano_quota_balances`
5. trace / audit 里可见 llm/tool/quota evidence
6. 收紧 runtime mesh 的 binding discipline：
   - `agent.core -> bash.core / context.core / filesystem.core`
   - 不再新增多余 internal HTTP 面
7. 可选增量：DeepSeek adapter skeleton（不要求作为 required provider）
8. 保证 provider / quota / audit / D1 的闭环一致

#### Out-of-Scope

1. full fallback chain
2. full quota policy / ledger / alerts plane
3. DeepSeek per-tenant secret governance 完整化
4. 所有 stream-plane 全面 RPC 化
5. Mini Program 真实运行

#### 交付物

1. Workers AI adapter
2. quota minimal schema + hooks
3. usage / balance update path
4. runtime mesh binding / transport adjustments
5. optional DeepSeek adapter skeleton
6. runtime evidence / trace integration
7. `docs/issue/zero-to-real/Z3-closure.md`

#### 收口标准

1. agent loop 返回真实模型内容
2. quota allow / deny 成为 runtime truth
3. runtime mesh 未继续扩 internal HTTP 新面
4. Workers AI first provider 决策已进入真实运行路径
5. llm/tool/quota evidence 能进入 trace / audit / persistence

### 7.5 Z4 — Real Clients + First Real Run

#### 实现目标

让真实客户端全面进场，并用真实运行把剩余 blocker 暴露出来、修掉、收敛掉。

#### In-Scope

1. web client 完整 hardening
2. Mini Program 接入
3. WeChat login -> start -> input -> stream -> history 全链路跑通
4. gap triage + 修复
5. 承接延后 stateful 工作：
   - 双向 WS message handling
   - IntentDispatcher
   - Broadcaster / richer user-state fanout
   - Z2 未闭环的 user-state gap 修复
6. 收敛剩余 internal HTTP 面：
   - 明确哪些 stream-plane 仍保留
   - 明确哪些 control-plane HTTP 已可退役
7. 形成 first real run evidence pack

#### Out-of-Scope

1. full RPC retirement across every remaining stream-plane seam
2. cold archive
3. 完整 admin plane
4. collaboration richness 全量化
5. platform SLO / billing / dashboards

#### 交付物

1. web client hardening changes
2. Mini Program integration
3. internal HTTP retirement inventory / remaining-seam memo
4. first real run evidence / issue list / closure note
5. `docs/issue/zero-to-real/Z4-closure.md`
6. `docs/issue/zero-to-real/zero-to-real-final-closure.md`
7. `docs/handoff/zero-to-real-to-next-phase.md`

#### 收口标准

1. Web 与 Mini Program 都能完成连续真实 loop
2. auth / history / context / audit 在真实客户端下稳定
3. 剩余 internal HTTP 已被压缩到明确的过渡 seam
4. 剩余问题已收敛为明确 backlog，而不是 blocker

---

## 8. 执行顺序与 DAG

### 8.1 推荐执行顺序

1. **Z0** — Contract + Compliance Freeze
2. **Z1** — Full Auth + Tenant Foundation
3. **Z2** — Session Truth + Audit Baseline
4. **Z3** — Real Runtime + Quota
5. **Z4** — Real Clients + First Real Run

### 8.2 推荐 DAG

```text
Z0 -> Z1 -> Z2 -> Z3 -> Z4
           |      |
           |      └-> runtime mesh / stream-plane residuals 在 Z3-Z4 收缩
           └----------> auth / tenant truth 与 auth pure RPC 作为 Z2-Z4 全程前置
```

### 8.3 为什么这样排

1. **Z0 必须先做**
   - 不先冻结 baseline，design 与 action-plan 会漂
2. **Z1 必须先于 Z2**
   - session / audit / history 的所有真相都依赖真实 identity / tenant truth
   - `orchestrator.auth` 的 internal-only / pure RPC boundary 也必须先成立
3. **Z2 必须先于 Z3**
   - provider 接真之前，先把 session/audit/persistence 的 SSOT 与 control-plane RPC 基线落地，避免只有模型输出但没有真 history
4. **Z3 必须先于 Z4**
   - client experiment 不该跑在 fake provider 上，也不该跑在完全未收紧的 internal transport 上
5. **Z4 是最终 gap hardening**
   - 只有真实 client 进场，最后一批 WS / reconnect / mobile / WeChat 问题才会暴露

---

## 9. 测试与验证策略

### 9.1 继承的验证层

1. worker-level unit / integration tests
2. root contract tests
3. cross-worker / package-e2e tests
4. preview / live verification
5. real client experiment evidence

### 9.2 本阶段新增的验证重点

| 验证项 | 说明 | 主要 Phase |
| --- | --- | --- |
| multi-tenant negative tests | user A / tenant A 不得越权到 tenant B | Z1 |
| auth pure-RPC boundary proof | `orchestrator.auth` 无 public route，且只接受 `orchestration.core` caller | Z1 |
| authority / trace no-escalation | public + internal body/header 双头校验 | Z1-Z3 |
| D1 truth consistency | session / turn / message / context / audit 对齐 | Z2 |
| user-state hot-path proof | history / reconnect / timeline 的热路径不只靠冷 D1 round-trip 兜底 | Z2 |
| control-plane RPC parity | `orchestration.core -> agent.core` 的 RPC 与既有 control-plane 语义一致 | Z2-Z3 |
| reconnect / history correctness | WS 重连后 timeline 不丢 | Z2-Z4 |
| real provider proof | 返回真实模型内容，不再走 fake 主路径 | Z3 |
| quota runtime proof | side-effect 前 gate 生效，usage/balance 写入成立 | Z3 |
| real client full-chain proof | login -> start -> input -> stream -> history | Z4 |

### 9.3 本阶段不变量

1. tenant boundary 不得倒退
2. NACP legality / session profile 不得绕过
3. authority 必须 server-stamped / no-escalation
4. session truth 必须可回看
5. audit / evidence 必须可回挂到 trace / session / team

---

## 10. 本阶段的退出条件

### 10.1 Primary Exit Criteria

1. **完整 end-user auth truth 已成立**
   - email/password + WeChat 都可用
   - JWT / refresh / tenant readback 成立
   - `orchestrator.auth` 为 internal-only pure RPC worker
   - 若 server-to-server ingress 被启用，最小 API key verify 运行时路径成立
2. **multi-tenant / NACP compliance 成为 runtime truth**
   - public/internal 双头校验成立
   - no-escalation / tenant boundary 有负例证明
3. **session truth 已持久化**
   - conversations / sessions / turns / messages / context snapshots / audit 已形成 D1 baseline
   - user-state hot-path 最低集合已成立
   - `orchestration.core -> agent.core` control-plane RPC 已启动，且至少 1 条主方法已具备双实现
4. **real runtime 已成立**
   - real provider 成为主路径
   - quota minimal runtime gate 生效
5. **real clients 已闭合**
   - web 与 Mini Program 都能完成真实 loop
   - 剩余 internal HTTP 已收敛为明确过渡 seam，而不是广泛 control-plane 依赖
6. **剩余问题已被压成明确 backlog**
   - 不再存在阻塞 first real run 的未定义大项

### 10.2 NOT-成功退出识别

若出现以下任一，本阶段不能视为 closed：

1. WeChat auth 仍未进入真实链路
2. tenant boundary / no-escalation 仍存在可复现洞
3. session/history/context/audit 仍主要依赖热态而非 SSOT
4. `orchestrator.auth` 仍暴露 public route 或非 `orchestration.core` caller
5. runtime 仍主要走 fake provider
6. history / reconnect 只能依赖冷路径兜底而无 hot-state 最低集合
7. Mini Program 无法完成连续真实 loop

---

## 11. 下一阶段将如何被打开

zero-to-real 闭合后，下一阶段不再是“让系统第一次跑起来”，而会转向：

1. remaining backlog 收敛
2. internal RPC / transport 演进
3. cold archive / deeper quota governance
4. richer collaboration / admin plane
5. production hardening / operational posture

换句话说，zero-to-real 结束后，nano-agent 应该已经拥有一个 **可持续验证、可持续迭代** 的真实基线。

---

## 12. 后续文档生产清单

### 12.1 Design 文档

路径:`docs/design/zero-to-real/`

| 对应 Phase | 文件路径 | 类型 |
| --- | --- | --- |
| Z0 | `docs/design/zero-to-real/Z0-contract-and-compliance-freeze.md` | Design |
| Z0 | `docs/design/zero-to-real/ZX-nacp-realization-track.md` | Cross-cutting Design |
| Z0 | `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md` | Cross-cutting Design |
| Z0 | `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md` | Cross-cutting Design |
| Z1 | `docs/design/zero-to-real/Z1-full-auth-and-tenant-foundation.md` | Design |
| Z2 | `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md` | Design |
| Z3 | `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md` | Cross-cutting Design |
| Z3 | `docs/design/zero-to-real/Z3-real-runtime-and-quota.md` | Design |
| Z4 | `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md` | Design |

**说明：**

1. 当前 charter **不包含 QnA**
2. design 阶段如确有必要，可单独新增：
   - `docs/design/zero-to-real/ZX-qna.md`
3. `ZX-binding-boundary-and-rpc-rollout.md` 用于专门冻结：
   - public/internal 边界
   - binding matrix
   - control-plane vs stream-plane transport law
   - internal HTTP 退役顺序
4. `ZX-d1-schema-and-migrations.md` 用于专门冻结：
   - first-wave table 清单
   - migration order / FK / views
   - audit table 设计
5. `ZX-llm-adapter-and-secrets.md` 用于专门冻结：
   - provider/fallback 策略
   - tenant secrets 存储与加密
   - cache / TTL / rotation / retry 纪律
6. 该 QnA 文件**不属于本 charter 的当前输出要求**

### 12.2 Action-Plan 文档

路径:`docs/action-plan/zero-to-real/`

| 对应 Phase | 文件路径 |
| --- | --- |
| Z0 | `docs/action-plan/zero-to-real/Z0-contract-and-compliance-freeze.md` |
| Z1 | `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md` |
| Z2 | `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md` |
| Z3 | `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md` |
| Z4 | `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md` |
| Closure | `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md` |

### 12.3 Closure / Handoff 文档

路径:`docs/issue/zero-to-real/` 与 `docs/handoff/`

| 对应 Phase | 文件路径 |
| --- | --- |
| Z0 | `docs/issue/zero-to-real/Z0-closure.md` |
| Z1 | `docs/issue/zero-to-real/Z1-closure.md` |
| Z2 | `docs/issue/zero-to-real/Z2-closure.md` |
| Z3 | `docs/issue/zero-to-real/Z3-closure.md` |
| Z4 | `docs/issue/zero-to-real/Z4-closure.md` |
| Final | `docs/issue/zero-to-real/zero-to-real-final-closure.md` |
| Handoff | `docs/handoff/zero-to-real-to-next-phase.md` |

### 12.4 建议撰写顺序

**第一批：**

1. `Z0-contract-and-compliance-freeze.md`
2. `ZX-nacp-realization-track.md`
3. `ZX-binding-boundary-and-rpc-rollout.md`
4. `ZX-d1-schema-and-migrations.md`
5. `Z1-full-auth-and-tenant-foundation.md`

**第二批：**

6. `Z2-session-truth-and-audit-baseline.md`
7. `ZX-llm-adapter-and-secrets.md`
8. `Z3-real-runtime-and-quota.md`
9. `Z4-real-clients-and-first-real-run.md`（至少先出 Mini Program / WeChat / WS 接口期待 skeleton）

**第三批：**

10. `Z4-real-clients-and-first-real-run.md` 完整版
11. `Z0-Z4` 对应 action-plan
12. `Z5-closure-and-handoff.md`

### 12.5 如果先控制文档数量，优先看哪 5 份

1. `docs/design/zero-to-real/ZX-nacp-realization-track.md`
2. `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md`
3. `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
4. `docs/design/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
5. `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md`

---

## 13. 最终 Verdict

### 13.1 对本阶段的最终定义

本阶段不应被描述为：

> “继续把 orchestration-facade 做得更完整一点”

而应被描述为：

> **“在 orchestration-facade 已闭合、NACP 已可作为执行基石的基础上，第一次让 nano-agent 进入真实用户、真实租户、真实持久化、真实模型、真实客户端共同成立，并由 `orchestration.core` 作为唯一对外入口、internal-only worker mesh 通过 binding / RPC 互通的闭环阶段。”**

### 13.2 一句话总结

> **Zero-to-real is the phase where nano-agent stops proving that its structure is correct and starts proving that a real, tenant-safe, NACP-governed agent loop can continuously run for real users.**

### 13.3 对上一阶段的承接关系

`orchestration-facade` 留下的是：

1. public façade + private runtime mesh
2. internal authority hardening
3. NACP / session protocol baseline
4. real loop scaffold

本阶段要留下的是：

1. 完整 auth truth
2. persistent session truth
3. real runtime truth
4. real client truth
5. 可继续扩展的 production-grade baseline

---

## 14. 维护约定

1. 本 charter owner-approved 后，不应频繁漂移
2. 修订时必须在顶部修订历史中显式追加 `r2 / r3 / ...`
3. 下游 design / action-plan 若与本 charter 冲突，以本 charter 为准；除非 owner 给出新决策，再回修本 charter
4. 本阶段故意不含 QnA；若 design 阶段补出 QnA，不应反向污染本 charter 的 scope 定义
