# F1 — Bring-up and First Roundtrip

> 服务业务簇: `orchestration-facade / F1 / bringup-and-first-roundtrip`
> 计划对象: `创建 orchestrator-core，并打通 public start -> agent internal -> first event relay`
> 类型: `add`
> 作者: `GPT-5.4`
> 时间: `2026-04-24`
> 文件位置: `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`
> 关联设计 / 调研文档:
> - `docs/plan-orchestration-facade.md`
> - `docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`
> - `docs/design/orchestration-facade/F0-compatibility-facade-contract.md`
> - `docs/design/orchestration-facade/F0-agent-core-internal-binding-contract.md`
> - `docs/design/orchestration-facade/F0-stream-relay-mechanism.md`
> - `docs/design/orchestration-facade/F0-user-do-schema.md`
> - `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md`
> - `docs/design/orchestration-facade/F4-authority-policy-layer.md`
> - `docs/design/orchestration-facade/FX-qna.md`
> 文档状态: `executed`

---

## 0. 执行背景与目标

F1 是 orchestration-facade 的第一段真实实现周期。它不追求“一次写完整个 façade”，只回答一件必须先答的问题：

> **public `start` 能否经 `orchestrator.core` 打进 `agent.core`，并把 first event 稳定地带回来？**

如果这一条做不通，那么 F2 的完整 session seam、F3 的 cutover、F4 的 authority hardening 都没有现实基础。相反，只要它跑通，项目就从“纸面 façade”进入“真实 public orchestrator + private runtime mesh”的第一轮可运行状态。

这里的 F1 **不是重写 `agent-core` 现有 session runtime**。当前 `agent-core` 已经是成熟 public session edge；F1 要做的是新增一个 **thin but real 的 `orchestrator-core` façade owner**，并把 `agent-core` 往 internal runtime host 方向 inwardize，而不是复制一套 loop / timeline / tool orchestration。

- **服务业务簇**：`orchestration-facade / F1`
- **计划对象**：`Bring-up and First Roundtrip`
- **本次计划解决的问题**：
  - `orchestrator-core` 还不存在，canonical public ingress 仍未落地
  - `agent-core` 仍没有真正的 `/internal/*` contract
  - first event relay 尚未通过真实 worker 链路证明可行
- **本次计划的直接产出**：
  - `workers/orchestrator-core/` worker shell + per-user DO 基础结构
  - `agent-core` `/internal/sessions/*` 最小可用 contract（至少 `start/input/cancel/stream`）
  - `orchestrator-core` preview probe + minimal live roundtrip evidence

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先 scaffold，再接 ingress/registry，再接 internal binding，最后拉通 first event + preview proof** 的方式推进。F1 不追求 surface 完整；它的目标是先形成一条 narrow but real 的 public -> internal -> relay 通路。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | orchestrator-core 脚手架 | `M` | 新建 worker shell、wrangler、DO、probe | `F0 closed` |
| Phase 2 | public ingress 与 user DO 起步 | `L` | JWT ingress、session mint、start request 路由到 user DO | `Phase 1` |
| Phase 3 | internal binding 最小落地 | `L` | `agent-core` 最小 `/internal/*` + shared secret gate | `Phase 2` |
| Phase 4 | first event relay | `L` | NDJSON stream 打通、orchestrator 读到 first frame | `Phase 3` |
| Phase 5 | preview proof 与 F1 closure | `M` | probe / minimal live E2E / F1 closure | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — orchestrator-core 脚手架**
   - **核心目标**：让仓库里先有真正的 `workers/orchestrator-core`
   - **为什么先做**：没有 worker shell，就没有任何 canonical ingress reality
2. **Phase 2 — public ingress 与 user DO 起步**
   - **核心目标**：接住 public `start`，mint `session_uuid`，由 user DO 成为 façade owner
   - **为什么放在这里**：F1 的起点不是 internal contract，而是先让 façade 自己站起来
3. **Phase 3 — internal binding 最小落地**
   - **核心目标**：让 `orchestrator.core` 能通过 `/internal/*` 而不是 legacy public path 调 `agent.core`
   - **为什么放在这里**：只有 façade ingress 起步后，internal contract 的 caller 才真实存在
4. **Phase 4 — first event relay**
   - **核心目标**：`agent -> orchestrator` NDJSON stream 真正跑起来
   - **为什么放在这里**：先有 route，再谈 relay；否则 stream 无 caller / 无 session owner
5. **Phase 5 — preview proof 与 F1 closure**
   - **核心目标**：给 F1 一个 deployable / testable / closable 终点
   - **为什么放在最后**：proof 必须建立在真实通路已跑通之后

### 1.4 执行策略说明

- **执行顺序原则**：`先让 orchestrator-core 存在，再让它真正调用 agent-core，最后给出 preview 证据`
- **风险控制原则**：`只实现 narrow start/input/cancel/stream baseline，不提前铺满 F2/F3 全量 surface`
- **测试推进原则**：`先 package-level build/test，再做最小 live probe + session-start roundtrip`
- **文档同步原则**：`F1 只同步必要的 worker README / closure / action-plan 引用，不提前做 F3 docs cutover`

### 1.5 本次 action-plan 影响目录树

```text
F1 Bring-up and First Roundtrip
├── workers/orchestrator-core/
│   ├── package.json
│   ├── tsconfig.json
│   ├── wrangler.jsonc
│   ├── src/index.ts
│   ├── src/user-do/*
│   ├── src/ingress/*
│   └── test/*
├── workers/agent-core/
│   ├── src/index.ts
│   ├── src/host/routes.ts
│   └── src/host/internal/*
├── test/package-e2e/orchestrator-core/
│   ├── 01-preview-probe.test.mjs
│   └── 02-session-start.test.mjs
├── test/shared/live.mjs
└── docs/issue/orchestration-facade/F1-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 新建 `workers/orchestrator-core/` shell、wrangler、preview probe、per-user DO 骨架
- **[S2]** 实现 public `POST /sessions/:session_uuid/start` 的 façade ownership 起步
- **[S3]** 为 `agent-core` 增加最小 `/internal/sessions/:id/{start,input,cancel,stream}` contract 与 secret gate
- **[S4]** 打通 `agent -> orchestrator` first event NDJSON relay，并给出最小 live 证据

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 完整实现 public `input/verify/status/timeline/ws/reconnect`
- **[O2]** 做 F3 cutover、legacy deprecation、README/INDEX 大迁移
- **[O3]** 做 F4 完整 authority helper / negative test 体系
- **[O4]** 直接开放 `context-core` / `filesystem-core` 给 orchestrator

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `cancel` internal path | `in-scope` | D2 明确 F1 至少要有 start + cancel 两条 integration proof | `F1 执行期` |
| `input` internal path | `in-scope` | 这是 F2 public input 的 follow-up base，先冻住 internal seam 避免二次 invent route/error shape | `F1 执行期` |
| public `input` / `verify` / `status` / `timeline` | `out-of-scope` | 这些属于 F2 完整 session seam | `F2` |
| legacy public route deprecation | `out-of-scope` | F3 才切 canonical ingress | `F3` |
| `TEAM_UUID` bootstrap hardening | `defer` | F1 只做最小 ingress，F4 再补法律闭环 | `F4` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | orchestrator-core worker shell | `add` | `workers/orchestrator-core/*` | 让 canonical public worker 真实存在 | `medium` |
| P1-02 | Phase 1 | orchestrator probe marker | `add` | `workers/orchestrator-core/src/index.ts` | 形成 preview deploy truth | `low` |
| P2-01 | Phase 2 | public start ingress | `add` | `workers/orchestrator-core/src/ingress/*` | façade 接住 `start` | `high` |
| P2-02 | Phase 2 | per-user DO registry shell | `add` | `workers/orchestrator-core/src/user-do/*` | façade 获得最小持久 owner，并写入完整初始 SessionEntry | `high` |
| P3-01 | Phase 3 | agent internal route family 起步 | `update` | `workers/agent-core/src/index.ts` `workers/agent-core/src/host/internal/*` | `/internal/start/input/cancel/stream` 真正存在 | `high` |
| P3-02 | Phase 3 | internal auth gate | `update` | `workers/agent-core/*` `workers/orchestrator-core/*` | shared secret gate 真实执行 | `high` |
| P4-01 | Phase 4 | NDJSON first event relay | `add` | `orchestrator-core user DO + stream reader` | first frame 可被 relay | `high` |
| P4-02 | Phase 4 | relay cursor 初始写入 | `update` | `user DO session entry` | cursor 语义与 design 对齐 | `medium` |
| P5-01 | Phase 5 | orchestrator package-e2e 最小集 | `add` | `test/package-e2e/orchestrator-core/01-02*` | 给 F1 最小 live 证据 | `medium` |
| P5-02 | Phase 5 | F1 closure | `add` | `docs/issue/orchestration-facade/F1-closure.md` | 解锁 F2 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — orchestrator-core 脚手架

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | worker shell | 新建 `workers/orchestrator-core` 基础文件、workspace 纳管、wrangler bindings 与 DO class | `workers/orchestrator-core/*` | canonical public worker 可 build/deploy | typecheck/build | shell 完整且可被 CI 消费 |
| P1-02 | probe marker | 实现 `GET /` / `GET /health` 返回 `worker:"orchestrator-core"` 与 `phase:"orchestration-facade-F1"` | `src/index.ts` | preview truth 稳定可断言 | package test / preview probe | probe shape 冻结 |

### 4.2 Phase 2 — public ingress 与 user DO 起步

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | public start ingress | 接 `POST /sessions/:id/start`，完成最小 JWT ingress / request parse / user DO routing | `src/ingress/*` `src/index.ts` | façade 可接住 start | worker tests | public `start` 已进入 orchestrator |
| P2-02 | user DO registry shell | 实现 `user_uuid` owner、接住 client-provided `session_uuid`，并从 F1 起写入完整初始 `SessionEntry`（`created_at / last_seen_at / status / last_phase / relay_cursor=-1 / ended_at`） | `src/user-do/*` | façade 不再是无状态转发层 | worker tests | user DO 能保存 starting session，且 F2 不再扩字段 |

### 4.3 Phase 3 — internal binding 最小落地

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | `/internal/*` 最小集 | 在 `agent-core` 实现 `start/input/cancel/stream` 四条 internal path，采用 `index.ts` 早退 + 独立 `routeInternal()` / skeleton 404，不污染 legacy parser | `workers/agent-core/*` | internal contract 真正存在 | agent-core tests | 不再依赖 legacy public path |
| P3-02 | secret gate | 增加 `x-nano-internal-binding-secret` 校验与 typed `401 invalid-internal-auth` | orchestrator-core + agent-core | internal call 有显式 gate | package/integration tests | secret 缺失/错误可被断言 |

### 4.4 Phase 4 — first event relay

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | NDJSON relay reader | 让 orchestrator user DO 读取 `StreamFrame`，至少消费 `meta` 与 first `event` | `orchestrator-core user DO` | first event 被 relay 到 façade owner | integration tests | first frame 真实可见 |
| P4-02 | cursor 初始语义 | 冻结 `relay_cursor = -1` 为“尚未 forward 任何 frame”，并在首次 forward 后更新为 `last_forwarded.seq` | `user DO registry` | D3/D5 语义不再停留在文档 | integration tests | cursor 与 frame seq 一致，无 off-by-one |

### 4.5 Phase 5 — preview proof 与 F1 closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | minimal live suite | 新增 `orchestrator-core/01-preview-probe` 与 `02-session-start` | `test/package-e2e/orchestrator-core/*` `test/shared/live.mjs` | F1 有最小 live evidence | live e2e | probe + session-start 都通过 |
| P5-02 | F1 closure | 写明 start->internal->first-event 已打通，列清 F2 入口条件 | `docs/issue/orchestration-facade/F1-closure.md` | F1 正式闭合 | 文档 review | F2 可直接引用 |

---

## 5. Phase 详情

### 5.1 Phase 1 — orchestrator-core 脚手架

- **Phase 目标**：让 `orchestrator.core` 从概念变成真实 worker 资产
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/package.json`
  - `workers/orchestrator-core/tsconfig.json`
  - `workers/orchestrator-core/wrangler.jsonc`
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/user-do/*.ts`
- **本 Phase 修改文件**：
  - `pnpm-workspace.yaml`
  - `.github/workflows/workers.yml`
- **具体功能预期**：
  1. orchestrator-core 可被 workspace 和 CI 识别
  2. probe marker 与 design doc 完全一致
  3. user DO class 有合法壳但不提前长厚业务
- **具体测试安排**：
  - **单测**：`orchestrator-core probe / DO shell tests`
  - **集成测试**：`无`
  - **回归测试**：`pnpm --filter @haimang/orchestrator-core-worker typecheck build test`（命名以实际 package 为准）
  - **手动验证**：`preview probe 返回 worker/phase`
- **收口标准**：
  - worker shell 完整
  - probe marker 固定
  - DO binding 与 preview deploy path 可建立
- **本 Phase 风险提醒**：
  - 最容易把 Phase 1 写成“直接实现完整 ingress”
  - 最容易忘记给新 worker 加入 CI / workspace

### 5.2 Phase 2 — public ingress 与 user DO 起步

- **Phase 目标**：让 façade 先拥有自己的 public owner 身份
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/src/ingress/*.ts`
  - `workers/orchestrator-core/src/user-do/registry.ts`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
- **具体功能预期**：
  1. `POST /sessions/:id/start` 由 orchestrator 接住
  2. façade mint 或注册 canonical `session_uuid`
  3. user DO 写入完整初始 SessionEntry，但仍只服务于 narrow F1 roundtrip
- **具体测试安排**：
  - **单测**：`ingress parse / user DO registry tests`
  - **集成测试**：`orchestrator -> user DO flow`
  - **回归测试**：`orchestrator-core typecheck/build/test`
  - **手动验证**：`检查 registry 中 session entry`
- **收口标准**：
  - public start 不再直打 agent-core
  - user DO 成为 session owner 起点
  - 最小 session entry 与 design 对齐
- **本 Phase 风险提醒**：
  - 最容易跳过 façade owner，直接在 worker.fetch 里写 ad-hoc forwarding

### 5.3 Phase 3 — internal binding 最小落地

- **Phase 目标**：让 façade 调 runtime 的通路不再借道 legacy public path
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `workers/agent-core/src/host/internal/*.ts`
- **本 Phase 修改文件**：
  - `workers/agent-core/src/index.ts`
  - `workers/orchestrator-core/src/ingress/*.ts`
- **具体功能预期**：
  1. `/internal/start/input/cancel/stream` 四条 path 存在
  2. secret gate 与 typed 401 存在
  3. `routeInternal()` 与 legacy parser 共存，`validateInternalAuthority()` 在 parse 后、DO fetch 前运行
- **具体测试安排**：
  - **单测**：`agent-core internal routing/auth tests`
  - **集成测试**：`orchestrator -> agent internal start/input/cancel`
  - **回归测试**：`agent-core typecheck/build/test`
  - **手动验证**：`错误 secret 返回 invalid-internal-auth`
- **收口标准**：
  - orchestrator 不再复用 legacy public `/sessions/*`
  - agent-core internal reject shape 稳定
- **本 Phase 风险提醒**：
  - 最容易为图快而直接复用 legacy route parser

### 5.4 Phase 4 — first event relay

- **Phase 目标**：证明 NDJSON relay 是真实可行的
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/src/user-do/stream-relay.ts`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/user-do/*.ts`
- **具体功能预期**：
  1. orchestrator 能读 `meta` / first `event`
  2. cursor 在首帧前为 `-1`，首个已 forward frame 后写成 `last_forwarded.seq`
  3. first event 可被 façade 层观察到，F1 live proof 仍限定为 single-turn `start -> first event -> terminal`
- **具体测试安排**：
  - **单测**：`frame parse / cursor update tests`
  - **集成测试**：`start -> internal stream -> first event relay`
  - **回归测试**：`orchestrator-core test`
  - **手动验证**：`检查 frame 与 cursor`
- **收口标准**：
  - first event 真正到达 façade owner
  - cursor 与 design 对齐
- **本 Phase 风险提醒**：
  - 最容易只证明 stream open，而没证明 first business event

### 5.5 Phase 5 — preview proof 与 F1 closure

- **Phase 目标**：给 F1 一个可以被下游引用的真实终点
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - `test/package-e2e/orchestrator-core/01-preview-probe.test.mjs`
  - `test/package-e2e/orchestrator-core/02-session-start.test.mjs`
  - `docs/issue/orchestration-facade/F1-closure.md`
- **本 Phase 修改文件**：
  - `test/shared/live.mjs`
- **具体功能预期**：
  1. preview probe 可证明 worker 存在
  2. minimal session-start live test 可证明 single-turn first roundtrip 成立
  3. closure 写明 public follow-up / WS attach 等内容仍留给 F2，而 internal `input` 仅作为 follow-up base 已提前落位
- **具体测试安排**：
  - **单测**：`无新增`
  - **集成测试**：`minimal worker integration`
  - **回归测试**：`relevant worker tests + live e2e opt-in`
  - **手动验证**：`preview deploy URL + session-start smoke`
- **收口标准**：
  - `orchestrator-core` preview probe 为绿
  - public `start` 已经通过 orchestrator 路由到 agent 并带回 first event
  - F1 closure 明确列清 F2 入口
- **本 Phase 风险提醒**：
  - 最容易把 minimal live evidence 写成“本地只看日志”

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 当前结论

本阶段 **无新增 owner-level blocker**。  
Q1 / Q2 / Q5 等 F1 硬前置答案已在 `FX-qna.md` 冻结，且 `业主回答` 字段已回填；F1 应直接消费这些答案实施。

### 6.2 问题整理建议

- `TEAM_UUID` 缺失时返回 `503` 还是 throw，可在 F4 实现期决定，不阻塞 F1
- package 名与 worker 名的具体命名若需微调，可在实现时跟随现有 workspace 命名约定

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| orchestrator-core 从 0 到 1 | 新 worker 不存在，容易范围失控 | `high` | 严格限制到 shell + start + first event |
| internal route 图快复用 legacy parser | 会把 F3 tech debt 带进 F1 | `high` | 用 `index.ts` 早退 + 独立 `routeInternal()` |
| first event relay 只到 meta 不到业务 event | 证明力不足 | `medium` | P4 明确要求 first business event |

### 7.2 约束与前提

- **技术前提**：`F0 已 closure，D1/D2/D3/D5/D6 与 FX-qna 为 F1 SSOT，且 FX-qna Q1/Q2/Q5 owner answers 均已回填`
- **运行时前提**：`可新增一个 Cloudflare worker 与相关 bindings/secrets`
- **组织协作前提**：`F1 不擅自扩 scope 到 F2/F3/F4`
- **上线 / 合并前提**：`preview probe 与 minimal session-start live evidence 必须真实存在`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/orchestration-facade/F0-agent-core-internal-binding-contract.md`
  - `docs/design/orchestration-facade/F0-stream-relay-mechanism.md`
- 需要同步更新的说明文档 / README：
  - `workers/orchestrator-core/README.md`
- 需要同步更新的测试说明：
  - `test/shared/live.mjs`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `orchestrator-core build/test 可运行`
  - `agent-core internal start/input/cancel/stream 可被断言`
- **单元测试**：
  - `orchestrator ingress / user DO / stream parse / internal auth gate`
- **集成测试**：
  - `public start -> internal start -> first event relay`
- **端到端 / 手动验证**：
  - `preview probe + minimal session-start live e2e`
- **回归测试**：
  - `受影响 worker package tests`
- **文档校验**：
  - `F1 closure 与 F2 action-plan 边界一致`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `workers/orchestrator-core/` 真实存在并可 preview deploy
2. `GET /` / `GET /health` 返回稳定 probe marker
3. public `start` 已通过 orchestrator 打进 agent internal path
4. first event 已通过 NDJSON relay 被 façade owner 读到
5. `relay_cursor` 在首帧前为 `-1`、首帧后与 `last_forwarded.seq` 对齐
6. `F1-closure.md` 已明确解锁 F2

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `最小 canonical ingress 与 first roundtrip 已成立` |
| 测试 | `worker tests + minimal live evidence 为绿` |
| 文档 | `F1 closure 与相关 README / live harness 已同步` |
| 风险收敛 | `不再依赖 legacy public route 充当 internal target` |
| 可交付性 | `F2 可以在真实 orchestrator baseline 上继续扩 seam` |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`Phase 3/4 最容易因 internal route 与 stream 细节而膨胀`
- **哪些编号的拆分还不够合理**：`若 relay 与 cursor 仍常被一起返工，可再拆出单独小项`
- **哪些问题本应更早问架构师**：`若 F1 仍冒出新的 owner blocker，说明 FX-qna 仍有漏项`
- **哪些测试安排在实际执行中证明不够**：`若只有 probe 绿而 session-start 证据不足，应增强 P5`
- **模板本身还需要补什么字段**：`future 可增加 “new worker scaffold” 专用 checklist`

---

## 10. 结语

这份 action-plan 以 **让 `orchestrator.core` 从概念变成真实 public ingress baseline** 为第一优先级，采用 **先 scaffold、再 narrow route、再 first-event relay、最后 preview proof** 的推进方式，优先解决 **canonical worker 尚不存在** 与 **internal contract 仍未落地** 两个问题，并把 **不提前做完整 session seam / cutover / authority hardening** 作为主要约束。整个计划完成后，`orchestration-facade / F1` 应达到 **public start -> agent internal -> first event relay 已真实成立** 的状态，从而为后续的 **F2 完整 session seam、F3 cutover、F4 authority hardening** 提供稳定基础。


---

## 11. 工作日志回填（executed）

### 11.1 执行结果总览

- **结论**：F1 已按 action-plan 完成，并达到 `F1-closure.md` 的关闭条件。
- **核心变化**：`orchestrator-core` 已从不存在变成真实 public façade worker，`agent-core` 已拥有可用的 guarded internal seam，`start -> first event` 已可经 façade 往返一次。

### 11.2 本轮新增文件

1. `workers/orchestrator-core/.gitignore`
2. `workers/orchestrator-core/README.md`
3. `workers/orchestrator-core/package.json`
4. `workers/orchestrator-core/tsconfig.json`
5. `workers/orchestrator-core/wrangler.jsonc`
6. `workers/orchestrator-core/src/auth.ts`
7. `workers/orchestrator-core/src/index.ts`
8. `workers/orchestrator-core/src/user-do.ts`
9. `workers/orchestrator-core/test/smoke.test.ts`
10. `workers/orchestrator-core/test/user-do.test.ts`
11. `workers/agent-core/src/host/internal.ts`
12. `test/package-e2e/orchestrator-core/01-preview-probe.test.mjs`
13. `test/package-e2e/orchestrator-core/02-session-start.test.mjs`
14. `docs/issue/orchestration-facade/F1-closure.md`

### 11.3 本轮修改文件

1. `workers/agent-core/src/index.ts`
2. `workers/agent-core/test/smoke.test.ts`
3. `workers/agent-core/README.md`
4. `.github/workflows/workers.yml`
5. `test/shared/live.mjs`
6. `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`

### 11.4 F1 实际完成的工作项

1. **P1-01 / P1-02 — orchestrator-core 脚手架**
   - 新建 `workers/orchestrator-core/` 的 package / wrangler / README / tests / DO class。
   - 固定 probe marker 为 `worker=orchestrator-core / phase=orchestration-facade-F1`。
2. **P2-01 / P2-02 — public ingress 与 user DO 起步**
   - public `POST /sessions/:session_uuid/start` 现在由 `orchestrator-core` 接住。
   - 以 `JWT sub -> idFromName(user_uuid)` 建立 per-user DO owner，并写入完整初始 `SessionEntry`。
3. **P3-01 / P3-02 — internal binding 最小落地**
   - `agent-core` 新增 `/internal/sessions/:id/{start,input,cancel,stream}`。
   - shared secret gate 采用 `x-nano-internal-binding-secret` + typed `401 invalid-internal-auth`。
4. **P4-01 / P4-02 — first event relay**
   - user DO 读取 `agent-core` internal NDJSON stream，并消费 `meta / event / terminal`。
   - `relay_cursor` 初始值固定为 `-1`，首个已 forward frame 后更新。
5. **P5-01 / P5-02 — proof 与 closure**
   - 新增 orchestrator package-e2e 最小集与 live harness URL。
   - 新增 `F1-closure.md`，明确解锁 F2。

### 11.5 关键发现与裁定

1. F1 可以非常薄，但不能是空心 façade；真正有价值的是 **user DO owner + internal seam + first event relay** 这一整条链路。
2. `agent-core` 内部通路不需要重写 DO runtime，本轮只是在 worker 边界上补 guarded internal contract，并复用既有 HTTP fallback / timeline / replay 真相。
3. F2 现在可以专注于补齐 public session seam，而不必再回头争论 `orchestrator-core` 是否只是另一个转发壳。


### 11.6 Preview deploy 与 live 证据

1. `agent-core` preview 已重新部署：`https://nano-agent-agent-core-preview.haimang.workers.dev`
   - Version ID: `f819b896-5d92-4a93-b2ce-9ec17686a2f3`
2. `orchestrator-core` preview 已首次部署：`https://nano-agent-orchestrator-core-preview.haimang.workers.dev`
   - Version ID: `c7795357-e319-48a5-a72a-f302397610e5`
3. live proof 已完成：
   - `node --test test/package-e2e/orchestrator-core/*.test.mjs` → `2/2` 通过
   - `pnpm test:package-e2e`（live） → `26/26` 通过（仓库汇总）
   - `pnpm test:cross`（live） → `37/37` 通过（仍主要验证 legacy `agent-core` ingress）
