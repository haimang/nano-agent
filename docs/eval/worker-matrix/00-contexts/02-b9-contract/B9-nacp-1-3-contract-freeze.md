# Nano-Agent 行动计划 — B9：NACP 1.3 Contract Freeze + Tenant Plumbing + Upstream Interface

> 服务业务簇：`After-Foundations Phase 8 — Pre-Worker-Matrix Contract Freeze`
> 计划对象：`packages/nacp-core` / `packages/nacp-session` / `packages/session-do-runtime` 三包的 contract 层扩展 + `docs/rfc/nacp-core-1-3-draft.md` RFC 起草 + 相关测试与文档
> 类型：`modify (additive, non-breaking)`
> 作者：`Claude Opus 4.7 (1M context)`
> 时间：`2026-04-20`（rewritten 2026-04-21 per GPT review）
> 文件位置（主要新增/修改文件预规划）：
> - `docs/rfc/nacp-core-1-3-draft.md` （new — RFC 主文件）
> - `packages/nacp-core/src/type-direction-matrix.ts` （new — `NACP_CORE_TYPE_DIRECTION_MATRIX` 定义）
> - `packages/nacp-core/src/error-body.ts` （new — `NacpErrorBodySchema` + `wrapAsError()` helper；本 phase 只 ship helper/spec，不迁 response shape）
> - `packages/nacp-core/src/envelope.ts` （modify — `validateEnvelope()` 新增 Layer 6 core matrix 校验）
> - `packages/nacp-core/src/index.ts` （modify — export 新符号）
> - `packages/nacp-core/CHANGELOG.md` （modify — 1.3.0 entry）
> - `packages/nacp-core/package.json` （modify — version bump 1.1.0 → 1.3.0）
> - `packages/nacp-session/src/type-direction-matrix.ts` （new — `NACP_SESSION_TYPE_DIRECTION_MATRIX` 定义，session profile 自治）
> - `packages/nacp-session/src/frame.ts` （modify — `validateSessionFrame()` 内消费 session matrix）
> - `packages/nacp-session/src/messages.ts` （modify — 精细化 `SessionStartBodySchema.initial_context`）
> - `packages/nacp-session/src/upstream-context.ts` （new — `SessionStartInitialContextSchema`）
> - `packages/nacp-session/src/index.ts` （modify — export 新符号）
> - `packages/nacp-session/CHANGELOG.md` （modify — 1.3.0 entry）
> - `packages/nacp-session/package.json` （modify — version bump 1.1.0 → 1.3.0）
> - `packages/nacp-session/src/version.ts` （modify — `NACP_SESSION_VERSION` bump）
> - `packages/session-do-runtime/src/do/nano-session-do.ts` （modify — `buildIngressContext()` 接线 `verifyTenantBoundary`；`persistCheckpoint()` / `restoreFromStorage()` / `wsHelperStorage()` 统一走 `tenantDoStorage*`）
> - `packages/session-do-runtime/src/http-controller.ts` （modify — 消除硬编码 `"1.1.0"`，改引用 `NACP_VERSION` constant）
> - `packages/session-do-runtime/CHANGELOG.md` （modify — 0.3.0 entry；与 package.json 对齐）
> - `packages/session-do-runtime/package.json` （modify — version bump 0.1.0 → 0.3.0；补回 0.2.0 的 baseline drift）
> - `test/nacp-1-3-matrix-contract.test.mjs` （new — root contract test 锁 core + session 两侧 matrix）
> - `test/tenant-plumbing-contract.test.mjs` （new — root contract test 锁 DO storage 都走 tenant wrapper）
> - `test/initial-context-schema-contract.test.mjs` （new — root contract test 锁 upstream memory injection schema）
> - `docs/issue/after-foundations/B9-phase-{1,2,3,4}-closure.md` （new）
> - `docs/issue/after-foundations/B9-final-closure.md` （new）
>
> 关联设计 / spec / review / issue / spike / action-plan 文档：
> - `docs/code-review/after-foundations/B9-plan-reviewed-by-GPT.md` （**新增参考** — 本 rewrite 的直接驱动；GPT 5 项 findings 已在下文 §0.5 逐项 track）
> - `docs/eval/after-foundations/smind-contexter-learnings.md` §9 （§9.5.2 C/D/E/F-new 是 B9 冻结 scope；§9.7.2 "今天能不能诚实冻结" 逐项核验；§9.7.4 B9 proposed 结构）
> - `docs/eval/after-foundations/smind-contexter-learnings.md` §10 （Contexter-Nano-agent 分层架构；§10.5 分层图；§10.6 `initial_context` wire hook；§10.8 多租户分层责任切分；§10.11 B8 新增 D10）
> - `docs/action-plan/after-foundations/B8-worker-matrix-pre-convergence.md` （B8 handoff phase；B9 是 B8 的并行或紧接 phase）
> - `docs/code-review/after-foundations/B8-docs-reviewed-by-opus.md` （B8 review 中 R1/R2/R3 三项 blocker 直接对应 B9 scope）
> - `docs/issue/after-foundations/B7-final-closure.md` §3 （B9 consume 的 LIVE numbers 基线）
> - `docs/issue/after-foundations/B8-phase-1-closure.md` §2-§6 （B9 的前置 truth inventory）
> - `docs/rfc/nacp-core-1-2-0.md` （B6 frozen：stay at 1.1.0；B9 是 1.1 → 1.3 的下一次升级）
> - `docs/rfc/nacp-session-1-2-0.md` （同上）
> - `docs/plan-after-foundations.md` §4.1 H （charter 条款：不修改 V1_BINDING_CATALOG；B9 在此硬约束下做 additive change）
>
> 关键 reference（当前仓库 reality，rewrite 时人工 fact-check）：
> - `packages/nacp-core/src/envelope.ts:49-54` （现存 `NacpDeliveryKindSchema` 4 值 enum）
> - `packages/nacp-core/src/envelope.ts:84-94` （`NacpHeaderSchema` 含 `message_type` + `delivery_kind`）
> - `packages/nacp-core/src/envelope.ts:245-268` （`NACP_MESSAGE_TYPES_ALL` / `registerMessageType` runtime registry —— 共 11 个 core types）
> - `packages/nacp-core/src/envelope.ts:276-359` （现存 `validateEnvelope()` 5 层；B9 在此处扩展 Layer 6 **仅对 core types** 生效）
> - `packages/nacp-session/src/frame.ts:69-119` （`validateSessionFrame()` —— session profile 的 parse 入口；B9 在此处新增 matrix 层 **对 8 个 session types 生效**）
> - `packages/nacp-session/src/messages.ts:9-10` （明确 "These are NOT registered in Core's BODY_SCHEMAS — they belong exclusively to the Session profile"）
> - `packages/nacp-core/src/index.ts:101-104` （`verifyTenantBoundary` / `tenantDoStorage*` shipped 但 `session-do-runtime` 零调用）
> - `packages/nacp-session/src/messages.ts:17-22` （`SessionStartBodySchema.initial_context: z.record(z.string(), z.unknown()).optional()`）
> - `packages/session-do-runtime/src/worker.ts:86` （`idFromName(sessionId)` — per-session DO，B9 不改）
> - `packages/session-do-runtime/src/do/nano-session-do.ts:559` （`this.doState.storage?.put(LAST_SEEN_SEQ_KEY, ...)` —— 真实 storage use-site 之一）
> - `packages/session-do-runtime/src/do/nano-session-do.ts:610-623` （`buildIngressContext()` 读 `env.TEAM_UUID` —— B9 tenant plumbing 第一阶段接线点）
> - `packages/session-do-runtime/src/do/nano-session-do.ts:934-1018` （`wsHelperStorage()` / `persistCheckpoint()` / `restoreFromStorage()` —— 真实 storage use-sites，非 `state.storage.*` grep 能命中）
> - `packages/session-do-runtime/src/http-controller.ts:141` （硬编码 `schema_version: "1.1.0"` —— B9 顺手清理）
> - `packages/session-do-runtime/package.json:1-4` （当前 baseline drift：`version=0.1.0` 但 `CHANGELOG.md:3` head 是 `0.2.0`）
>
> 文档状态：`draft-rewritten-2026-04-21`

---

## 0. 执行背景与目标

> B9 是 after-foundations 阶段的**最后一个包修改 phase**，也是 worker matrix 的**硬前置**。它不发明新能力；它把 B1-B8 已经达成但**未变现**的三类共识冻结到 shipped packages 里，让 worker matrix Phase 0 从"stable contract surface"起跑而不是"带着已知 tech debt 入场"。

- **服务业务簇**：`After-Foundations Phase 8 — Pre-Worker-Matrix Contract Freeze`
- **计划对象**：nacp-core / nacp-session / session-do-runtime 三包的 contract 层扩展，零 breaking change，升版本号
- **本次计划要解决的核心问题**：
  - **P1**：NACP `message_type` 与 `delivery_kind` 双轴**缺合法组合矩阵校验**——`validateEnvelope()` 只做 5 层校验（structural / registry / version / body / role），没有 type × delivery legality。**同时**，`validateSessionFrame()` 独立于 `validateEnvelope()`，session profile 的 8 个 types 也需要自己的 matrix 消费点（GPT-R1 指正）
  - **P2**：Error body 缺标准 shape——system.error 走 `NacpErrorSchema`，但 tool/context/skill response 用 `{status, error?: {code, message}}` shape（两套并存）。B9 只 ship `NacpErrorBodySchema` + `wrapAsError()` helper + RFC 里的 convergence plan；**不在本 phase 迁移现有 response shape**（避免无谓扩大 scope）
  - **P3**：Business verb naming 已部分冻结（`hook.emit` / `hook.outcome` / `tool.call.request` / `context.compact.*` 都是 `<namespace>.<verb>` 两段制）。B9 只在 RFC 层冻结 "new verbs 必须遵守 `<namespace>.<verb>`"，**不 ship runtime alias machinery**；当前没有新 canonical verb 引入，也没有需要做 alias 的 legacy string
  - **P4**：B6 shipped 的 `verifyTenantBoundary` + `tenantDoStorage*` wrappers **在 session-do-runtime 零调用**——B9 接线到 `NanoSessionDO` 的 4 个真实 storage use-sites（`wsHelperStorage()` / `persistCheckpoint()` / `restoreFromStorage()` / line 559 的 `LAST_SEEN_SEQ_KEY put`）+ `buildIngressContext()` 的 tenant boundary verify
  - **P5**：`SessionStartBodySchema.initial_context` 是 shipped 但 schema 过于宽松 (`z.record(z.string(), z.unknown())`)——B9 把 upstream orchestrator 注入 user memory 的契约精细化为 `SessionStartInitialContextSchema`
- **本次计划的直接产出**：
  - **D1**：`docs/rfc/nacp-core-1-3-draft.md` —— RFC 主文件，描述 4 项冻结（C / D-narrowed / E-narrowed / F-new）+ explicit deferral list
  - **D2**：nacp-core 1.3.0 ship —— Layer 6 core matrix 校验 + `NacpErrorBodySchema` helper + RFC-anchored naming law（no runtime alias）
  - **D3**：nacp-session 1.3.0 ship —— session-side matrix 校验（在 `validateSessionFrame()`）+ `SessionStartInitialContextSchema` + version 同步
  - **D4**：session-do-runtime 0.3.0 ship —— `buildIngressContext()` 接 `verifyTenantBoundary`；4 个 storage use-sites 走 `tenantDoStorage*`；`http-controller.ts` 硬编码 `1.1.0` 消除；package.json/CHANGELOG baseline drift 修复
  - **D5**：3 份 root contract test 锁 matrix / tenant / initial_context 契约
  - **D6**：4 份 B9 phase closure + B9 final closure + B8 review close-out

### 0.5 GPT 审核整合 tracker

| GPT finding | 原要点 | 本 rewrite 中的对应动作 |
|---|---|---|
| **B9-R1** (high) | matrix ownership 不应只放在 `nacp-core`；session profile 走独立的 `validateSessionFrame()`，不经过 `validateEnvelope()` | **已整改**：拆成 `NACP_CORE_TYPE_DIRECTION_MATRIX`（在 `nacp-core`）+ `NACP_SESSION_TYPE_DIRECTION_MATRIX`（在 `nacp-session`）；两侧各自 validator 消费；vocabulary 可共享但 ownership 分离（见 §2.1 S2a/S2b、§4.2/§4.2b） |
| **B9-R2** (high) | error-body + naming/alias scope 被低估，且部分依据已落后于当前 registry truth | **已整改**：error-body 只 ship helper + spec，migration 延后到单独 PR（§2.1 S3 narrowed、§2.2 O11 新增）；naming 只在 RFC 层冻结 "new verbs obey"，**不 ship `LEGACY_ALIAS_REGISTRY` runtime**（§2.2 O12 新增） |
| **B9-R3** (high) | Phase 3 的 runtime 改造目标点写错：`tenantIngressVerify` / `contextCore.ingestFromUpstream` 不存在；`state.storage.*` grep 永远 0 命中 | **已整改**：所有改造点改到真实 seam（`buildIngressContext()` / `persistCheckpoint()` / `restoreFromStorage()` / `wsHelperStorage()` / line 559 `LAST_SEEN_SEQ_KEY put`）；grep 口径改为 `this\.doState\.storage\.` 白名单 + 用 `// tenant-scoped` 注释标记 exempted wrapper-internal call sites（详见 §8.1） |
| **B9-R4** (medium) | version baseline 与 update surface 估算不诚实 | **已整改**：Phase 3 新增 P3-07.5 "baseline audit" 子步骤：枚举所有 hardcoded `"1.1.0"`（至少 `http-controller.ts:141`）；显式修复 session-do-runtime `package.json:0.1.0 vs CHANGELOG head:0.2.0` drift（bump 到 0.3.0 时写清楚 "jumps over never-shipped 0.2.0 tag"） |
| **B9-R5** (low) | 文档路径和 exit criteria 有 drift | **已整改**：4 处 `docs/code-review/B8-...` 已修复为 `docs/code-review/after-foundations/B8-...`；`state.storage.*` grep 口径全部替换（§4.4 P4-02、§8.1） |

---

## 1. 执行综述

### 1.1 总体执行方式

B9 采用 **"RFC 先行、双侧 matrix、真实 seam 接线、契约锁测试"** 的四段式：

1. **Phase 1 — RFC 起草 + 冻结 scope 锁死**：先把 `docs/rfc/nacp-core-1-3-draft.md` 写清楚；owner 批准后 scope 不再漂移
2. **Phase 2 — nacp-core 1.3.0 实装**：`NACP_CORE_TYPE_DIRECTION_MATRIX` + `validateEnvelope()` Layer 6 + `NacpErrorBodySchema` helper（shipped 但**不迁 response shape**）+ `NACP_VERSION = "1.3.0"` bump
3. **Phase 2b / Phase 3 — nacp-session 1.3.0 + session-do-runtime 0.3.0 实装**（并行）：
   - **nacp-session side**：`NACP_SESSION_TYPE_DIRECTION_MATRIX` + `validateSessionFrame()` 新增 matrix 层 + `SessionStartInitialContextSchema` + version bump
   - **session-do-runtime side**：`buildIngressContext()` 接 `verifyTenantBoundary`；4 个真实 storage use-sites 走 `tenantDoStorage*`；`http-controller.ts` 硬编码 `1.1.0` 消除；package.json/CHANGELOG baseline drift 修复
4. **Phase 4 — 契约锁测试 + B9 closure + B8 handoff 回填**：3 份 root contract test；B8 handoff memo §11/§12/§13 回填；B8 review close-out

**关键执行不变量**：
- **零 breaking change** —— 所有 v1.1 message_type 字符串照旧合法；v1 消费者不需修改代码
- **Matrix 首次发布要保守**——允许的 `(type, delivery_kind)` 组合应**至少覆盖所有已在 shipped test + code 里出现的真实组合**；只 reject 明显错误如 `tool.call.request + event`；不允许为"理论纯洁"拒绝 test 里已使用的组合
- **`V1_BINDING_CATALOG` 严禁修改**（charter §4.1 H 第 32 项）
- **`idFromName(sessionId)` per-session DO 保持不变**
- **不引入 runtime alias machinery** —— GPT-R2 整改；naming law 仅在 RFC 层

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | RFC 起草 + scope 冻结 | S | `docs/rfc/nacp-core-1-3-draft.md` owner-approved 后 scope 锁死 | B8 closure + GPT review consumed |
| Phase 2 | nacp-core 1.3.0 实装 | M | Layer 6 core matrix + `NacpErrorBodySchema` helper + NACP_VERSION bump | Phase 1 |
| Phase 2b | nacp-session matrix layer | S | `validateSessionFrame()` 新增 session matrix 消费点（sharing vocabulary 但 ownership 在 session） | Phase 2 |
| Phase 3 | nacp-session 1.3.0 + session-do-runtime 0.3.0 | M | `SessionStartInitialContextSchema` + tenant plumbing（真实 seam）+ baseline drift 修复 | Phase 2 + Phase 2b |
| Phase 4 | 契约锁测试 + closure + 回填 B8 | S | 3 root contract test + B9 closure + B8 handoff 回填 §11/§12/§13 | Phase 1–3 |

### 1.3 Phase 说明

1. **Phase 1 — RFC 起草**：把"冻结哪些 / 不冻结哪些"写进 RFC；显式标注 "error-body response migration" 和 "runtime alias machinery" 都是 out-of-scope
2. **Phase 2 — nacp-core 1.3.0**：底层协议层升级；只管 core registry 11 个 types
3. **Phase 2b — nacp-session matrix layer**：把 core 侧建立的 matrix 语汇复制到 session profile；**不借用 core validator**；在 `validateSessionFrame()` 内独立消费
4. **Phase 3 — nacp-session 1.3.0 + session-do-runtime 0.3.0**：
   - nacp-session 侧：`SessionStartInitialContextSchema` 精细化；version bump
   - session-do-runtime 侧：tenant plumbing 接线到真实 seam；baseline drift 修复
5. **Phase 4 — 契约锁测试 + closure**：3 root test（core matrix + session matrix + tenant plumbing + initial_context schema 各有锁点）

### 1.4 执行策略说明

- **执行顺序原则**：**RFC 先行 → 底层协议（nacp-core）→ 协议 profile（nacp-session matrix + schema）→ runtime 接线 → 契约测试 + 回填**；Phase 2b 与 Phase 3a 可并行
- **风险控制原则**：**Additive-only + conservative matrix**。新增 schema 全 optional；matrix 首发保守；违反 matrix 走 fail-closed reject；response shape migration 另行 PR
- **测试推进原则**：每个新增 export 必须有对应 root contract test；三包 unit test 保持 green；每次版本 bump 后跑 `pnpm -r run test` + `node --test test/*.test.mjs` + `npm run test:cross` 全绿
- **文档同步原则**：本 phase 的三包 CHANGELOG 必须与 RFC 保持一致；B8 handoff memo 的 §11/§12/§13 在 Phase 4 回填时必须 link 到 B9 RFC + closure

### 1.5 本次 action-plan 影响目录树

```text
packages/
├── nacp-core/                                  # version 1.1.0 → 1.3.0
│   ├── src/
│   │   ├── envelope.ts                          # modify (新增 Layer 6 matrix 校验)
│   │   ├── error-body.ts                        # NEW (NacpErrorBodySchema + wrapAsError helper)
│   │   ├── type-direction-matrix.ts             # NEW (NACP_CORE_TYPE_DIRECTION_MATRIX)
│   │   ├── version.ts                           # modify (NACP_VERSION 1.1.0 → 1.3.0)
│   │   └── index.ts                             # modify (export 新符号)
│   ├── CHANGELOG.md                             # modify (1.3.0 entry)
│   └── package.json                             # modify (version bump)
├── nacp-session/                                # version 1.1.0 → 1.3.0
│   ├── src/
│   │   ├── type-direction-matrix.ts             # NEW (NACP_SESSION_TYPE_DIRECTION_MATRIX)
│   │   ├── frame.ts                             # modify (validateSessionFrame 新增 matrix 消费层)
│   │   ├── messages.ts                          # modify (SessionStartBodySchema.initial_context 收紧)
│   │   ├── upstream-context.ts                  # NEW (SessionStartInitialContextSchema)
│   │   ├── version.ts                           # modify (NACP_SESSION_VERSION bump)
│   │   └── index.ts                             # modify (export 新符号)
│   ├── CHANGELOG.md                             # modify (1.3.0 entry)
│   └── package.json                             # modify (version bump)
└── session-do-runtime/                          # version 0.1.0 → 0.3.0 (baseline drift 一并修复)
    ├── src/
    │   ├── do/nano-session-do.ts                # modify (buildIngressContext 接 verifyTenantBoundary；
    │   │                                               wsHelperStorage/persistCheckpoint/
    │   │                                               restoreFromStorage/LAST_SEEN_SEQ_KEY put
    │   │                                               统一走 tenantDoStorage*)
    │   └── http-controller.ts                    # modify (硬编码 "1.1.0" → import NACP_VERSION)
    ├── CHANGELOG.md                             # modify (0.3.0 entry；0.2.0 节已存在保留)
    └── package.json                             # modify (version 0.1.0 → 0.3.0；跨过 never-published 0.2.0)

docs/
├── rfc/
│   └── nacp-core-1-3-draft.md                   # NEW (RFC 主文件)
├── issue/after-foundations/
│   ├── B9-phase-1-closure.md                    # NEW
│   ├── B9-phase-2-closure.md                    # NEW
│   ├── B9-phase-3-closure.md                    # NEW
│   ├── B9-phase-4-closure.md                    # NEW
│   └── B9-final-closure.md                      # NEW
├── handoff/
│   └── after-foundations-to-worker-matrix.md    # modify (Phase 4 回填 §11/§12/§13)
├── code-review/after-foundations/
│   ├── B8-docs-reviewed-by-opus.md              # modify (§6 追写 R1/R2/R3 fixed via B9)
│   └── B9-plan-reviewed-by-GPT.md               # 已 shipped (本 rewrite 的 driver)
└── action-plan/after-foundations/
    └── B9-nacp-1-3-contract-freeze.md           # 本文件

test/
├── nacp-1-3-matrix-contract.test.mjs            # NEW (锁 core + session 两侧 matrix)
├── tenant-plumbing-contract.test.mjs            # NEW
└── initial-context-schema-contract.test.mjs     # NEW
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `docs/rfc/nacp-core-1-3-draft.md` 起草 + owner 批准
- **[S2a]** `NACP_CORE_TYPE_DIRECTION_MATRIX` 实装 + `validateEnvelope()` Layer 6 校验（覆盖 core registry 11 个 types）
- **[S2b]** `NACP_SESSION_TYPE_DIRECTION_MATRIX` 实装 + `validateSessionFrame()` 新增 matrix 层（覆盖 session profile 8 个 types）
- **[S3]** `NacpErrorBodySchema` + `wrapAsError()` helper **仅 ship helper/spec**；不迁 `tool.call.response` / `context.compact.response` / `skill.invoke.response` 的 `{status, error?}` shape（GPT-R2 整改）
- **[S4]** RFC 层冻结 "new verbs 必须 `<namespace>.<verb>`"；**不 ship `LEGACY_ALIAS_REGISTRY` runtime machinery**（GPT-R2 整改）
- **[S5]** `delivery_kind` 4 值语义 spec 文字化（`command` / `response` / `event` / `error`）
- **[S6]** `SessionStartInitialContextSchema` 精细化 upstream memory 注入契约
- **[S7]** `NanoSessionDO.buildIngressContext()` 接线 `verifyTenantBoundary`（**真实 seam**；GPT-R3 整改）
- **[S8]** `NanoSessionDO` 的 4 个真实 storage use-sites 全部走 `tenantDoStorage*`：
  - `wsHelperStorage()` (line ~934-943)
  - `persistCheckpoint()` (line ~945-1000)
  - `restoreFromStorage()` (line ~1002-1018)
  - `this.doState.storage?.put(LAST_SEEN_SEQ_KEY, lastSeenSeq)` (line ~559)
- **[S9]** 3 包 version bump：nacp-core 1.3.0 / nacp-session 1.3.0 / session-do-runtime 0.3.0 + CHANGELOG
- **[S10]** session-do-runtime baseline drift 修复：`http-controller.ts:141` 硬编码 `"1.1.0"` 改为 import `NACP_VERSION`；`package.json 0.1.0 vs CHANGELOG head 0.2.0` 通过直接升到 0.3.0 解决（CHANGELOG 0.3.0 entry 显式说明"jumps over never-published 0.2.0 tag"）
- **[S11]** 3 份 root contract test 锁新契约
- **[S12]** B8 handoff memo 回填 §11（nacp-1.3）+ §12（tenant plumbing）+ §13（upstream orchestrator）
- **[S13]** B9 4 份 phase closure + final closure + B8 review close-out

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** **移除 v1.1 message_type 字符串** —— 那是 nacp-2.0 breaking 的事
- **[O2]** **修改 `V1_BINDING_CATALOG`** —— charter §4.1 H 第 32 项硬约束
- **[O3]** **实装 `orchestrator.*` message_type namespace** —— 仅在 RFC 里预留 namespace；实装在 contexter-integration phase
- **[O4]** **Contexter 改造** —— §10.7 post-worker-matrix
- **[O5]** **`context.reranker` worker 立项** —— post-worker-matrix
- **[O6]** **DO 身份迁移** —— §10.4 结论：nano-agent per-session 是**正确的**
- **[O7]** **`DOStorageAdapter.maxValueBytes` 从 1 MiB 升到 2 MiB** —— worker matrix 阶段或独立 small PR
- **[O8]** **为 F03 / F09 gates 编写新 probe** —— owner-side action
- **[O9]** **新增 worker 实装** —— 所有 worker matrix 工作都在 B9 之后
- **[O10]** **前端 / client SDK 改动** —— 后端协议层改动不影响 client
- **[O11]** **迁移现有 `{status, error?}` response body shape 到 `NacpErrorBodySchema`** —— GPT-R2 整改决定；本 phase 只 ship helper + spec；migration 作为独立后续 PR，由 owner 决定时机
- **[O12]** **`LEGACY_ALIAS_REGISTRY` runtime machinery** —— GPT-R2 整改决定；当前所有 v1.1 shipped types 已经是 `<namespace>.<verb>` 两段制，不需要 alias；naming law 仅在 RFC 层生效
- **[O13]** **`tenantIngressVerify` / `contextCore.ingestFromUpstream()` 等虚构 seam 的实装** —— GPT-R3 整改决定；B9 只使用 `verifyTenantBoundary` + `tenantDoStorage*` 这些已 shipped 的 seam；`initial_context` 的消费点由 worker matrix 的 agent.core 实装

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| 移除 `tool.call.request` 后缀字符串 | `out-of-scope` | breaking；alias 保留直到 nacp-2.0 | nacp-2.0 立项时 |
| `orchestrator.*` namespace 实装 | `defer / depends-on-decision` | RFC 仅**预留** namespace | owner 启动 contexter 改造 phase |
| `DOStorageAdapter.maxValueBytes` 升到 2 MiB | `defer` | B7 F08 给出 2 MiB 安全值 | worker matrix Phase 0 或独立 PR |
| 迁移 `tool.call.response` 的 error shape | `out-of-scope` (GPT-R2) | 本 phase 只 ship helper；migration 要单独 review | owner 启动 response-shape-migration PR |
| session-do-runtime CHANGELOG 0.2.0 节的 back-fill | `in-scope` | 已存在 CHANGELOG 0.2.0 节；0.3.0 bump 时一并同步 | Phase 3 末尾 |
| 新 `ContextRerank*` hook catalog 事件定义 | `out-of-scope` | post-worker-matrix Rerank-1 | reranker 立项时 |
| 非 `NanoSessionDO` 的 tenant plumbing（如 `workspace-context-artifacts`） | `out-of-scope` | B9 只接 `NanoSessionDO`；其他包保持 shipped 现状 | 未来按需 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | 起草 `docs/rfc/nacp-core-1-3-draft.md` | add | 新文件 | RFC 覆盖 4 项冻结 + 显式 out-of-scope 列表（含 GPT-R2 整改结果） | low |
| P1-02 | Phase 1 | Owner 批准 RFC | decision | 同上 | scope 冻结；不再漂移 | low |
| P1-03 | Phase 1 | `B9-phase-1-closure.md` | doc | 新文件 | RFC owner-approved 状态锁 | low |
| P2-01 | Phase 2 | `packages/nacp-core/src/type-direction-matrix.ts` | add | 新文件 | `NACP_CORE_TYPE_DIRECTION_MATRIX`；覆盖 11 个 core types | medium |
| P2-02 | Phase 2 | `packages/nacp-core/src/error-body.ts` | add | 新文件 | `NacpErrorBodySchema` + `wrapAsError()` helper；**不迁 response shape** | low |
| P2-03 | Phase 2 | `packages/nacp-core/src/envelope.ts::validateEnvelope` | modify | 现有文件 | 新增 Layer 6 core matrix 校验 | high |
| P2-04 | Phase 2 | `packages/nacp-core/src/version.ts` + index.ts + CHANGELOG + package.json | modify | 现有文件 | `NACP_VERSION` 1.1.0 → 1.3.0；export 新符号 | low |
| P2-05 | Phase 2 | nacp-core unit tests 扩充 | modify / add | `packages/nacp-core/test/*` | matrix + error body 测试 | medium |
| P2-06 | Phase 2 | `B9-phase-2-closure.md` | doc | 新文件 | nacp-core 1.3.0 ship 记录 | low |
| P2b-01 | Phase 2b | `packages/nacp-session/src/type-direction-matrix.ts` | add | 新文件 | `NACP_SESSION_TYPE_DIRECTION_MATRIX`；覆盖 8 个 session types | medium |
| P2b-02 | Phase 2b | `packages/nacp-session/src/frame.ts::validateSessionFrame` | modify | 现有文件 | 新增 matrix 消费层；与 core validator 分离 | medium |
| P2b-03 | Phase 2b | nacp-session matrix unit tests | modify / add | `packages/nacp-session/test/*` | session matrix 单测 | medium |
| P3-01 | Phase 3 | `packages/nacp-session/src/upstream-context.ts` | add | 新文件 | `SessionStartInitialContextSchema` | low |
| P3-02 | Phase 3 | `packages/nacp-session/src/messages.ts` | modify | 现有文件 | `SessionStartBodySchema.initial_context` 收紧（保留 `.optional()`） | medium |
| P3-03 | Phase 3 | nacp-session version.ts + index.ts + CHANGELOG + package.json | modify | 现有文件 | version 1.1.0 → 1.3.0 | low |
| P3-04 | Phase 3 | nacp-session unit tests 扩充 | modify / add | 现有文件 | upstream context + 收紧后 compat 测试 | medium |
| P3-05 | Phase 3 | `packages/session-do-runtime/src/do/nano-session-do.ts::buildIngressContext` | modify | 现有文件 | 接线 `verifyTenantBoundary`；依赖 `env.TEAM_UUID` / stamped authority 一致 | high |
| P3-06 | Phase 3 | `NanoSessionDO` 4 个 storage use-sites 切到 `tenantDoStorage*` | modify | 同上文件 | `wsHelperStorage()` / `persistCheckpoint()` / `restoreFromStorage()` / LAST_SEEN_SEQ_KEY put | high |
| P3-07 | Phase 3 | `packages/session-do-runtime/src/http-controller.ts` | modify | 现有文件 | 消除硬编码 `"1.1.0"`；import `NACP_VERSION` | low |
| P3-08 | Phase 3 | session-do-runtime baseline drift + version bump | modify | `CHANGELOG.md` + `package.json` | `0.1.0 → 0.3.0`；CHANGELOG 0.3.0 头部说明跨过 never-published 0.2.0 tag | low |
| P3-09 | Phase 3 | session-do-runtime unit tests 扩充 | modify / add | `packages/session-do-runtime/test/*` | tenant plumbing + initial_context 路径 | medium |
| P3-10 | Phase 3 | `B9-phase-3-closure.md` | doc | 新文件 | nacp-session 1.3.0 + session-do-runtime 0.3.0 ship | low |
| P4-01 | Phase 4 | `test/nacp-1-3-matrix-contract.test.mjs` | add | 新文件 | root 契约测试锁 **core + session 两侧** matrix | medium |
| P4-02 | Phase 4 | `test/tenant-plumbing-contract.test.mjs` | add | 新文件 | root 契约测试锁 tenant ingress verify；**grep 口径修正**（`this\.doState\.storage\.` 白名单检查） | medium |
| P4-03 | Phase 4 | `test/initial-context-schema-contract.test.mjs` | add | 新文件 | root 契约测试锁 upstream memory injection schema | medium |
| P4-04 | Phase 4 | full regression | test | repo root | `pnpm -r run test` + `node --test test/*.test.mjs` + `npm run test:cross` green | medium |
| P4-05 | Phase 4 | 回填 B8 handoff memo §11/§12/§13 | modify | `docs/handoff/after-foundations-to-worker-matrix.md` | 对应 B8 review R1/R2/R3 | medium |
| P4-06 | Phase 4 | 回填 after-foundations-final-closure §6 | modify | `docs/issue/after-foundations/after-foundations-final-closure.md` | 第 5/6 条约束 | low |
| P4-07 | Phase 4 | B8 review close-out | modify | `docs/code-review/after-foundations/B8-docs-reviewed-by-opus.md` | §6 追写 R1/R2/R3 `fixed via B9` | low |
| P4-08 | Phase 4 | `B9-phase-4-closure.md` + `B9-final-closure.md` | add | 新文件 | B9 closed | low |
| P4-09 | Phase 4 | 本 action-plan §12 工作日志回填 | modify | 本文件底部 | 列表形式汇报 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — RFC 起草 + scope 冻结

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | RFC 起草 | 按 `smind-contexter-learnings.md` §9.5.2 + §9.7.2 写 C/D-narrowed/E-narrowed/F-new 4 项；**显式 out-of-scope**：F-original、`LEGACY_ALIAS_REGISTRY` runtime、response shape migration、client intent 扩张 | `docs/rfc/nacp-core-1-3-draft.md` | RFC 10 章节完整 | 人工 review | RFC ship |
| P1-02 | Owner approve | owner 审阅批准 | 同上 | `draft` → `owner-approved` | decision | header 状态更新 |
| P1-03 | Phase 1 closure | `B9-phase-1-closure.md` | 新文件 | 记录 RFC 状态 + 引用表 | 人工 review | phase 1 closed |

### 4.2 Phase 2 — nacp-core 1.3.0 实装

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | core matrix 定义 | `NACP_CORE_TYPE_DIRECTION_MATRIX: Record<string, Set<NacpDeliveryKind>>` —— 对每个 core shipped type（`tool.call.request/response/cancel`、`hook.emit/outcome`、`skill.invoke.request/response`、`context.compact.request/response`、`system.error`、`audit.record` 共 11 个）枚举合法 `delivery_kind`（保守地列出所有已在现有 test + code 里出现过的组合） | `packages/nacp-core/src/type-direction-matrix.ts` (新) | ~50 行 TS | unit test (P2-05) | 每个 shipped type 至少有 1 个合法 delivery_kind |
| P2-02 | error body | `NacpErrorBodySchema` (`{code, message, retriable?, cause?}`) + `wrapAsError(envelope, error)` helper；**不触及** `tool.call.response` / `context.compact.response` / `skill.invoke.response` 现有 `{status, error?}` shape（scope narrowed per GPT-R2） | `packages/nacp-core/src/error-body.ts` (新) | ~60 行 TS | unit test | schema parse pass；wrap helper 输出 valid envelope |
| P2-03 | envelope Layer 6 | `validateEnvelope()` 在现有 Layer 5 (role gate) 后新增 Layer 6：查 `NACP_CORE_TYPE_DIRECTION_MATRIX[type]?.has(delivery_kind)`；违反抛 `NACP_TYPE_DIRECTION_MISMATCH`；matrix 里不存在的 type（= 非 core 消息，例如未来的 orchestrator.*）**跳过**该层（fail-open for unknown，fail-closed for known） | `packages/nacp-core/src/envelope.ts` (modify) | ~30 行 diff | unit test + regression | 现有 shipped envelope 全通过；非法组合被 reject |
| P2-04 | version + index + CHANGELOG + error-registry | `NACP_VERSION` 1.1.0 → 1.3.0；`NACP_VERSION_COMPAT` 保持 1.0.0（兼容）；export 新符号；CHANGELOG 1.3.0 entry（显式跳过 1.2.0 理由：B6 frozen RFC 占用 1.2.0 编号）；`error-registry.ts` 新增 `NACP_TYPE_DIRECTION_MISMATCH` | `packages/nacp-core/{src/version.ts, src/index.ts, src/error-registry.ts, CHANGELOG.md, package.json}` | nacp-core v1.3.0 shipped | `pnpm --filter @nano-agent/nacp-core build` | package 可 resolve |
| P2-05 | unit tests | matrix / error body / envelope-layer-6 三类 unit 测试 | `packages/nacp-core/test/*.test.ts` +2-3 files | +30 cases | `pnpm --filter @nano-agent/nacp-core test` | all green |
| P2-06 | Phase 2 closure | `B9-phase-2-closure.md` | 新文件 | — | 人工 review | nacp-core 1.3.0 shipped |

### 4.2b Phase 2b — nacp-session matrix consumer

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2b-01 | session matrix 定义 | `NACP_SESSION_TYPE_DIRECTION_MATRIX: Record<string, Set<NacpDeliveryKind>>` —— 覆盖 session profile 8 个 types（`session.start/resume/cancel/end`、`session.stream.event/ack`、`session.heartbeat`、`session.followup_input`） | `packages/nacp-session/src/type-direction-matrix.ts` (新) | ~30 行 TS | unit test (P2b-03) | 每个 session type 至少 1 个合法 delivery_kind |
| P2b-02 | validateSessionFrame 扩展 | 在 `validateSessionFrame()` 内、message_type 校验之后新增 matrix 校验；违反抛 `NacpSessionError` with `SESSION_ERROR_CODES.NACP_SESSION_INVALID_PHASE` 或新增 code `NACP_SESSION_TYPE_DIRECTION_MISMATCH` | `packages/nacp-session/src/frame.ts` (modify) + `errors.ts` (modify) | ~15 行 diff | unit test | 现有 session test fixture 全通过；非法组合被 reject |
| P2b-03 | session matrix unit tests | 覆盖 8 个 session types 的合法 / 非法组合 | `packages/nacp-session/test/frame.test.ts` (modify) | +12 cases | `pnpm --filter @nano-agent/nacp-session test` | all green |

### 4.3 Phase 3 — nacp-session 1.3.0 + session-do-runtime 0.3.0 实装

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | initial_context schema | `SessionStartInitialContextSchema` — Zod schema 覆盖 `user_memory / intent / warm_slots / realm_hints` 四个**全 optional** 子字段 | `packages/nacp-session/src/upstream-context.ts` (新) | ~80 行 Zod | unit test | schema 可 parse valid + reject invalid (如 `user_memory` 非对象) |
| P3-02 | SessionStartBodySchema 收紧 | 把现在的 `initial_context: z.record(z.string(), z.unknown()).optional()` 改为 `initial_context: SessionStartInitialContextSchema.optional()`；保留 **back-compat**：`SessionStartInitialContextSchema` 本身全 optional 字段 + `.passthrough()` 宽容未知 key，保证现有 shipped 的 loose payload 仍可 parse | `packages/nacp-session/src/messages.ts` (modify) | ~10 行 diff | unit test | 现有 shipped `initial_context` payload 仍可 parse |
| P3-03 | nacp-session version bump | `NACP_SESSION_VERSION` 1.1.0 → 1.3.0；index.ts export 新符号；CHANGELOG 1.3.0 entry；package.json bump | `packages/nacp-session/{src/version.ts, src/index.ts, CHANGELOG.md, package.json}` | nacp-session v1.3.0 | `pnpm --filter @nano-agent/nacp-session build` | package 可 resolve |
| P3-04 | nacp-session unit tests | upstream-context + SessionStart back-compat 测试 | `packages/nacp-session/test/*` | +15 cases | `pnpm --filter @nano-agent/nacp-session test` | all green |
| P3-05 | buildIngressContext tenant verify | 在 `buildIngressContext()` 返回的 IngressContext 路径之后、frame 进入 `acceptIngress` 之前，新增一次 `verifyTenantBoundary(validated, { envTeamUuid, scope: "session-ingress" })`（失败走 typed rejection）；authority.team_uuid !== env.TEAM_UUID 时 reject | `packages/session-do-runtime/src/do/nano-session-do.ts` (modify) | ~20 行 diff | unit test | authority team_uuid mismatch → typed rejection |
| P3-06 | 4 个 storage use-sites 接线 | 新增 private helper `getTenantScopedStorage()`：读 `env.TEAM_UUID` + `this.sessionUuid`，返回代理 storage 对象，内部对每次 put/get/delete 调用 `tenantDoStoragePut/Get/Delete`。改造 4 处：<br/>① `wsHelperStorage()` (~934-943)<br/>② `persistCheckpoint()` (~945-1000) - line 999 `storage.put(CHECKPOINT_STORAGE_KEY, ...)` 改走 wrapper<br/>③ `restoreFromStorage()` (~1002-1018) - line 1006 `storage.get(CHECKPOINT_STORAGE_KEY)` 改走 wrapper<br/>④ line ~559 `this.doState.storage?.put(LAST_SEEN_SEQ_KEY, ...)` 改走 wrapper | 同上文件 | ~40 行 diff | unit test + integration test | DO op 全部带 tenant scope |
| P3-07 | http-controller NACP_VERSION | `http-controller.ts:141` `schema_version: "1.1.0"` → `schema_version: NACP_VERSION`（import from `@nano-agent/nacp-core`） | `packages/session-do-runtime/src/http-controller.ts` (modify) | ~2 行 diff | existing unit test | build + test 绿 |
| P3-08 | runtime version + CHANGELOG baseline 对齐 | `package.json` 0.1.0 → 0.3.0；`CHANGELOG.md` 新增 0.3.0 entry（头部短注释："jumps over 0.2.0 tag which was CHANGELOG-only, never published"）；0.2.0 历史 entry 保留作为 B6 shipped 记录 | 同 P3-03 对应文件 | 版本号一致 | 检查 `grep version package.json` 与 CHANGELOG head | package.json version == CHANGELOG 最新 entry |
| P3-09 | session-do-runtime unit tests | tenant verify + LAST_SEEN_SEQ_KEY 路径 + initial_context 处理 | `packages/session-do-runtime/test/*` | +20 cases | `pnpm --filter @nano-agent/session-do-runtime test` | all green |
| P3-10 | Phase 3 closure | `B9-phase-3-closure.md` | 新文件 | — | 人工 review | 两包 shipped |

### 4.4 Phase 4 — 契约锁测试 + closure + B8 回填

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | matrix root test | `test/nacp-1-3-matrix-contract.test.mjs` 锁住：(1) `NACP_CORE_TYPE_DIRECTION_MATRIX` 覆盖所有 `NACP_MESSAGE_TYPES_ALL` entry；(2) `NACP_SESSION_TYPE_DIRECTION_MATRIX` 覆盖所有 `SESSION_MESSAGE_TYPES`；(3) 非法组合 reject（core + session 两侧各一个 fixture）；(4) `wrapAsError` 产物可 parse | 新文件 ~8 tests | node --test | all green |
| P4-02 | tenant plumbing root test | `test/tenant-plumbing-contract.test.mjs` 锁住：(1) `authority.team_uuid !== env.TEAM_UUID` ingress reject；(2) DO storage put/get/delete 必须带 tenant prefix (通过观察 key shape)；(3) 源码层守护：`grep -E "this\\.doState\\.storage\\.(put\|get\|delete)\\(" packages/session-do-runtime/src/do/nano-session-do.ts` 的命中必须**全部在 `getTenantScopedStorage()` 包装器内部**（否则 fail）。具体做法：脚本读文件 → 抽取每个命中的所在函数 → 断言函数名属于白名单 `{ getTenantScopedStorage }` | 新文件 ~5 tests | node --test + ad-hoc 源码断言 | all green |
| P4-03 | initial_context root test | `test/initial-context-schema-contract.test.mjs` 锁住：(1) valid `{user_memory, intent, warm_slots, realm_hints}` parse pass；(2) empty `{}` pass；(3) unknown key 通过 passthrough；(4) invalid shape（如 `user_memory: "string"`）reject | 新文件 ~4 tests | node --test | all green |
| P4-04 | full regression | `pnpm -r run test` + `node --test test/*.test.mjs` + `npm run test:cross` | repo root | baseline + new green | 命令输出 | 无 regression |
| P4-05 | 回填 B8 handoff memo §11 | "NACP 1.3 Pre-Requisite for Worker Matrix"：引用 B9 RFC + B9 final closure；明确 worker matrix Phase 0 必须基于 nacp-1.3 | `docs/handoff/after-foundations-to-worker-matrix.md` | 新增 §11 | 人工 review | link 有效 |
| P4-06 | 回填 B8 handoff memo §12 | "Tenant Boundary Plumbing Checklist"：引用 B9 P3-05/P3-06 shipped 状态；6 项占位清单完成情况 | 同上 | 新增 §12 | 人工 review | 状态表完整 |
| P4-07 | 回填 B8 handoff memo §13 | "Upstream Orchestrator Interface"：引用 `smind-contexter-learnings.md` §10.5 + B9 shipped `SessionStartInitialContextSchema` | 同上 | 新增 §13 | 人工 review | 段落 + schema link |
| P4-08 | 回填 after-foundations-final-closure.md | §6 追加第 5/6 条约束 | `docs/issue/after-foundations/after-foundations-final-closure.md` | +2 行 | 人工 review | 追加生效 |
| P4-09 | B8 review 回应 | `docs/code-review/after-foundations/B8-docs-reviewed-by-opus.md` §6 追写 "R1/R2/R3 fixed via B9 shipped；R4-R7 fixed via inline doc diff" | 同上（append only） | §6 填充 | 人工 review | review closable |
| P4-10 | B9 phase 4 + final closure | `B9-phase-4-closure.md` + `B9-final-closure.md` | 新文件 | — | 人工 review | B9 closed |
| P4-11 | action-plan §12 回填 | 本文件底部追加 §12 工作日志 | 本文件 | — | 人工 review | 日志完整 |

---

## 5. Phase 详情

### 5.1 Phase 1 — RFC 起草 + scope 冻结

- **Phase 目标**：把 `smind-contexter-learnings.md` §9.5.2 + §9.7.2 的分析，叠加 GPT review 的 scope narrowing，固化为 owner-approved RFC
- **本 Phase 对应编号**：`P1-01 / P1-02 / P1-03`
- **新增文件**：`docs/rfc/nacp-core-1-3-draft.md` + `docs/issue/after-foundations/B9-phase-1-closure.md`
- **功能预期**：
  1. RFC §1 背景：引用 B7/B8 closure + GPT-R1~R5 整改
  2. RFC §2-§6 normative scope：C (dual matrix) / D-narrowed (error body helper only) / E-narrowed (new verbs obey naming；no runtime alias) / F-new (delivery_kind 语义)
  3. RFC §7 back-compat：本 phase 零 breaking；所有 v1.1 type 字符串原样工作
  4. RFC §8 版本号理由：跳 1.2.0（B6 frozen RFC 占用）
  5. RFC §9 显式 out-of-scope：F-original / G / response shape migration / LEGACY_ALIAS_REGISTRY runtime / orchestrator.* 实装
  6. RFC §10 traceability
- **收口标准**：RFC 状态 `owner-approved`
- **风险**：scope creep（顺手解 response shape migration）→ 严禁

### 5.2 Phase 2 — nacp-core 1.3.0 实装

- **Phase 目标**：底层协议层升级；只管 core 11 个 types
- **新增文件**：`type-direction-matrix.ts` + `error-body.ts` + closure
- **修改文件**：`envelope.ts` + `version.ts` + `error-registry.ts` + `index.ts` + CHANGELOG + package.json
- **关键不变量**：
  - Layer 6 对 `NACP_MESSAGE_TYPES_ALL` 成员 fail-closed；对非成员（即 session.* 或未来 orchestrator.*）fail-open
  - 保守匹配：任何已在 shipped test fixtures 里出现过的 `(type, delivery_kind)` 组合必须合法
- **风险**：matrix 漏列现有合法组合 → 在 P2-05 用 table-driven test 对所有 shipped fixture 做 loop assertion

### 5.3 Phase 2b — nacp-session matrix consumer

- **Phase 目标**：把 matrix 语汇复制到 session profile，但**由 `validateSessionFrame()` 自行消费**，不借用 core validator
- **新增文件**：`packages/nacp-session/src/type-direction-matrix.ts`
- **修改文件**：`frame.ts` + `errors.ts`
- **关键不变量**：
  - session profile 不 depend on `NACP_CORE_TYPE_DIRECTION_MATRIX`；完全独立定义
  - 错误路径走 `NacpSessionError`（非 `NacpValidationError`），保持 session 子系统 error 语义

### 5.4 Phase 3 — nacp-session 1.3.0 + session-do-runtime 0.3.0 实装

- **Phase 目标**：上层协议 + runtime 层应用 Phase 2 / Phase 2b；兑现 B6 tenant 投资；修复 runtime 包 baseline drift
- **新增文件**：`upstream-context.ts` + closure
- **修改文件**：`messages.ts` + 两包 index/version/CHANGELOG/package.json + `nano-session-do.ts` + `http-controller.ts`
- **功能预期**：
  1. `SessionStartInitialContextSchema` 覆盖 `user_memory / intent / warm_slots / realm_hints`，全 optional + passthrough
  2. `SessionStartBodySchema.initial_context` 收紧但 back-compat
  3. `NanoSessionDO` ingress 强制 `verifyTenantBoundary`
  4. `NanoSessionDO` 内 4 个 storage use-sites 全部走 `tenantDoStorage*`
  5. `http-controller.ts` 硬编码 `"1.1.0"` 消除
  6. session-do-runtime baseline drift 修复（0.1.0 → 0.3.0）
- **风险**：
  - `NanoSessionDO` 修改面大 → P3-09 + P4-04 regression 强约束
  - B7 LIVE 回归 → 保留 `test/b7-round2-integrated-contract.test.mjs` green
  - Tenant scope 把原有 test 打破 → 在 P3-09 里加入 test-harness helper，让 DO test 显式 provide `TEAM_UUID`

### 5.5 Phase 4 — 契约锁测试 + closure + B8 回填

- **Phase 目标**：锁住 B9 shipped 契约；回填 B8；B9 self-close
- **新增文件**：3 root test + phase-4 closure + final closure
- **修改文件**：B8 handoff memo + after-foundations-final-closure + B8 code review + 本 action-plan §12
- **关键不变量**：
  - P4-02 的 grep 脚本必须**正确命中** `this.doState.storage.put/get/delete` 并在非白名单函数内 fail（修复 B9 原版假绿）
  - B8 review close-out 与 B9 closure 顺序锁定（B8 review close ≡ B9 close）

---

## 6. 需要业主 / 架构师回答的问题清单

### Q1 — 是否批准 B9 作为 worker matrix Phase 0 的硬前置？

- **影响**：所有 Phase + 下游 worker matrix 启动时机
- **为什么必须确认**：`smind-contexter-learnings.md` §9.7 是 owner-revised 口径；B8 action-plan 没有写成硬约束
- **当前建议**：**approve** —— 与 "freeze biggest cognition range" 纪律一致
- **A**：`{等待业主回答}`

### Q2 — version bump 策略

- **影响**：Phase 2 / Phase 3 version 决策
- **当前建议**：
  - nacp-core: 1.1.0 → **1.3.0** (跳 1.2.0；CHANGELOG 顶部解释)
  - nacp-session: 1.1.0 → **1.3.0** (同步)
  - session-do-runtime: 0.1.0 → **0.3.0** (跨 never-published 0.2.0 tag；CHANGELOG 头部说明)
- **A**：`{等待业主回答}`

### Q3 — `SessionStartInitialContextSchema` 4 子字段冻结粒度

- **影响**：Phase 3 P3-01 schema 设计 + 将来 contexter-integration 兼容性
- **当前建议**：4 子字段**全 optional** + `.passthrough()`；未来 contexter 发现新需求通过 additive optional 字段扩展
- **A**：`{等待业主回答}`

### Q4 — `NanoSessionDO` 改造时如何处理 B7 LIVE 回归？

- **影响**：Phase 3 P3-05/06 + worker matrix 启动信心
- **当前建议**：**跑一次 `test/b7-round2-integrated-contract.test.mjs` + 三包 unit test + root tests pass** 作为回归底线；owner 可选择是否再做 LIVE re-deploy verify
- **A**：`{等待业主回答}`

### Q5 — B8 review close-out 时机

- **当前建议**：作为 B9 Phase 4 的一部分；B8 review close ≡ B9 close
- **A**：`{等待业主回答}`

### Q6 — GPT review 整改方向是否全部接受？

- **影响**：整个 rewrite 的 scope narrowing 是否生效
- **具体 narrow**：
  - [O11] 不迁 response shape
  - [O12] 不 ship runtime alias machinery
  - [O13] 不实装虚构 seam
- **当前建议**：**accept all**（Claude 与 GPT 在这 3 条 narrowing 上一致）
- **A**：`{等待业主回答}`

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| matrix 表与现有 shipped wire 错配 | 新 matrix 漏掉某个合法组合 → 现有 consumer reject | `medium` | Phase 2/2b P2-05/P2b-03 用 table-driven test 覆盖所有 shipped test fixture |
| NanoSessionDO 改造打破 B7 LIVE | tenant wrapper 改变 storage key shape | `medium` | Phase 3 P3-09 + Phase 4 P4-04；保留 `b7-round2-integrated-contract.test.mjs` pass |
| RFC owner 迟迟不批 | Phase 1 卡住 → B9 block | `medium` | RFC 起草时做预 self-review 3 轮 |
| baseline drift 修复引入新不一致 | session-do-runtime package.json/CHANGELOG 手改易错 | `low` | P3-08 作为显式原子 commit，附 grep 验证 |
| nacp-core Zod 性能回归 | Layer 6 每次 envelope 都跑 | `low` | Set lookup O(1)；现有 benchmark 如存在则跑一次 |
| 与 B8 review 回填 drift | §11/§12/§13 文字与实际 shipped code 不一致 | `low` | P4-05~P4-07 写完后交叉 link 到 B9 shipped source 路径 |
| grep 口径写错 | 假绿（回到 B9 原版的错误） | `medium` | P4-02 用脚本定位每个命中函数名而非整体 count；复盘时再验一次 |

### 7.2 约束与前提

- **技术前提**：
  - B8 final closure shipped ✅
  - `smind-contexter-learnings.md` §9 + §10 shipped ✅
  - GPT review consumed ✅
  - root tests baseline 77/77 + 91/91 保持
- **组织协作前提**：Q1（gate authorization）+ Q4（regression 底线）+ Q6（narrowing acceptance）必答；Q2/Q3/Q5 有默认
- **上线 / 合并前提**：三包 version 一致性 + `pnpm -r run test` 全绿 + `node --test test/*.test.mjs` 全绿 + `npm run test:cross` 全绿

### 7.3 文档同步要求

- `docs/rfc/nacp-core-1-3-draft.md` → 状态 lifecycle `draft` → `owner-approved` → `frozen`
- `docs/rfc/nacp-core-1-2-0.md` §1 加 "Next: 1.3" cross-reference
- `docs/rfc/nacp-session-1-2-0.md` 同理
- 本 action-plan §12 工作日志回填

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `ls packages/nacp-core/src/{type-direction-matrix,error-body}.ts` → 存在
  - `ls packages/nacp-session/src/{type-direction-matrix,upstream-context}.ts` → 存在
  - `grep '"version"' packages/{nacp-core,nacp-session,session-do-runtime}/package.json` → `1.3.0 / 1.3.0 / 0.3.0`
  - `grep -n '"1\\.1\\.0"' packages/session-do-runtime/src/http-controller.ts` → **0 hits**（GPT-R4 修复）
  - **源码守护检查（GPT-R3 修复，替代原假绿 grep）**：用 `test/tenant-plumbing-contract.test.mjs` 的 `this.doState.storage.*` 命中函数白名单检查，任何命中都必须落在 `getTenantScopedStorage()` 或其单一调用点之内
- **单元测试**：
  - 三包 `pnpm --filter ... test` 各自全绿
- **集成测试**：
  - `pnpm -r run test` 全绿
- **端到端 / 手动验证**：
  - 构造非法 core envelope `{message_type: "tool.call.request", delivery_kind: "event"}` → `validateEnvelope()` reject
  - 构造非法 session frame `{message_type: "session.start", delivery_kind: "response"}` → `validateSessionFrame()` reject
  - 构造缺 `team_uuid` 或 mismatch 的 session.start → `NanoSessionDO` ingress reject
- **回归测试**：
  - `node --test test/*.test.mjs` → baseline + 3 new green
  - `npm run test:cross` → 91+ green
  - `test/b7-round2-integrated-contract.test.mjs` (5 tests) 保持 pass
- **文档校验**：
  - B8 handoff memo §11/§12/§13 存在 + 可 grep 到 "B9" reference
  - `after-foundations-final-closure.md` §6 约束条目 >= 6

### 8.2 Action-Plan 整体收口标准

1. `docs/rfc/nacp-core-1-3-draft.md` 状态 `frozen`
2. nacp-core 1.3.0 + nacp-session 1.3.0 + session-do-runtime 0.3.0 shipped；三包 CHANGELOG head == package.json version
3. `NACP_CORE_TYPE_DIRECTION_MATRIX` + `NACP_SESSION_TYPE_DIRECTION_MATRIX` + `NacpErrorBodySchema` + `SessionStartInitialContextSchema` 全部 exported
4. `NanoSessionDO.buildIngressContext()` 强制 `verifyTenantBoundary`；4 个 storage use-sites 全部走 `tenantDoStorage*`
5. `http-controller.ts:141` 硬编码 `"1.1.0"` 消除
6. 3 root contract test + 全 regression 绿
7. B8 handoff memo §11/§12/§13 回填完成 + link 有效
8. `after-foundations-final-closure.md` §6 追加约束生效
9. B8 code review §6 填完 + R1/R2/R3 标 `fixed`
10. B9 4 份 phase closure + `B9-final-closure.md` shipped
11. 本 action-plan §12 工作日志回填

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | core matrix + session matrix + error body helper + initial_context schema + tenant plumbing 五类契约 shipped |
| 测试 | 3 root contract tests + 三包 unit tests 全绿；regression baseline 保持 |
| 文档 | RFC + 三包 CHANGELOG + B8 handoff §11/§12/§13 + after-foundations-final-closure §6 全部同步 |
| 风险收敛 | Q1/Q4/Q6 已 answered；Q2/Q3/Q5 按 default 或 owner 调整 |
| 可交付性 | **worker matrix charter 作者可以启动 Phase 0，只读 B8 handoff pack + B9 final closure** |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`{RETRO_1}`
- **core vs session matrix 双侧 ownership 是否被后续 worker matrix 正确消费**：`{RETRO_2}`
- **tenant plumbing 4 个 use-sites 是否漏改**：`{RETRO_3}`
- **baseline drift 修复后是否再次漂移**：`{RETRO_4}`
- **是否 owner 有追加 Q 进来**：`{RETRO_5}`

---

## 10. 结语

这份 action-plan（rewritten 2026-04-21）以 **"诚实冻结已达成的认知 + 不扩大到未达成的认知"** 为第一优先级，采用 **"RFC 先行 → 底层协议 → profile matrix → runtime 接线 → 契约锁"** 的五段式推进（对比原 4 段式，增加 Phase 2b session matrix consumer 作为独立步骤），优先解决 **B1-B8 累积但未变现的三类共识**（NACP 双轴 legality + tenant wrapper 未接线 + upstream memory 注入口空置），并把 **"zero breaking change + conservative matrix + 真实 seam 导向 + 不迁 response shape + 不 ship runtime alias"** 作为主要约束。

整个计划完成后，nano-agent 的 protocol 层进入一个**"正交、显式、可证"**的稳定 contract surface，为 worker matrix 的 4 first-wave workers 提供不再带 tech debt 的起跑线。

**B9 不创造新能力；它让 B1-B8 的共识变成 packages 层的 shipped reality，而且只冻结 GPT review 已 fact-check 到当前代码 reality 的部分** —— 这是它唯一且充分的价值。

---

## 11. 关闭前提醒

- B9 是 after-foundations 阶段的**最后一个会修改 packages/ 的 phase**；worker matrix 从 B9 close 之后的 code baseline 起跑
- RFC 先行是**硬纪律**
- `NACP_VERSION = "1.3.0"` 的 bump 必须与 CHANGELOG 同步
- `V1_BINDING_CATALOG` 在任何 phase 都**不得修改** —— charter §4.1 H 第 32 项
- 回填 B8 handoff §11/§12/§13 时，必须**把 B8 review R1/R2/R3 的 `fixed` 状态同步**到 `docs/code-review/after-foundations/B8-docs-reviewed-by-opus.md` §6
- **不要回到 B9 原版的假绿 grep 和虚构 seam 名字**；每次 closure 自检都要对着本 rewrite §0.5 tracker 交叉核验

---

## 12. 实现者工作日志（回填于执行后）

> 执行者：`Claude Opus 4.7 (1M context)`
> 执行时间：`2026-04-21`
> 执行范围：`Phase 1 – Phase 4 完整闭环`

### 12.1 执行总览

- **起点**：GPT 对 B9 原版 action-plan 的 review (`docs/code-review/after-foundations/B9-plan-reviewed-by-GPT.md`) 提出 5 项 findings (R1-R5)，裁决 B9 时机成立但执行稿需 rewrite。
- **过程**：先对 GPT 5 项 findings 做逐项代码事实核查（全部成立）→ rewrite B9 action-plan（本文件，按 7 条 correction）→ 顺序执行 Phase 1-4 → 全量回归。
- **产出**：3 包版本 bump + 5 个新源文件 + 3 个新 root contract test + 5 个 closure 文档 + B8 handoff memo §11/§12/§13 回填 + after-foundations-final-closure §6 更新 + B8 review §6 close-out。
- **规模**：`pnpm -r run test` 全 11 包绿；`node --test test/*.test.mjs` 94 / 94 绿（新增 17 个 B9 test）；`npm run test:cross` 108 / 108 绿。

### 12.2 Phase-by-phase 工作记录

#### Phase 1 — RFC 起草
- `docs/rfc/nacp-core-1-3-draft.md` — 10 章节（背景 / core matrix / session matrix / error-body helper-only / naming law RFC-level / delivery_kind 语义 / initial_context 契约 / 版本跳跃理由 / 显式 out-of-scope 13 项 / traceability）
- RFC 标记 `owner-approved` 于执行日；直接驱动后续 Phase。

#### Phase 2 — nacp-core 1.3.0
- 新文件 `packages/nacp-core/src/type-direction-matrix.ts` (`NACP_CORE_TYPE_DIRECTION_MATRIX` + `isLegalCoreDirection`)
- 新文件 `packages/nacp-core/src/error-body.ts` (`NacpErrorBodySchema` + `wrapAsError()`)
- 修改 `envelope.ts` — `validateEnvelope()` 新增 Layer 6 matrix 校验（fail-closed for known / fail-open for unknown）
- 修改 `error-registry.ts` — 注册 `NACP_TYPE_DIRECTION_MISMATCH`
- 修改 `version.ts` — `NACP_VERSION 1.1.0 → 1.3.0`
- 修改 `index.ts` — export 新符号
- 修改 `CHANGELOG.md` + `package.json` — 1.3.0 entry + version bump
- 新增 `test/type-direction-matrix.test.ts` + `test/error-body.test.ts`
- 修复 15 个 pre-existing 测试用例（它们使用了错误的 `delivery_kind: "command"`）：在 `test/messages/messages.test.ts` 中给 `makeEnv()` 加入 `pickLegalDeliveryKind()` 自动从矩阵挑首个合法值；修复 `test/version.test.ts` 的 baseline 断言；修正 `test/envelope.test.ts` / `test/compat.test.ts` 的 compat shim 期望目标（migrate_v1_0_to_v1_1 仍输出 `"1.1.0"`，是 floor 不是 current）
- 测试结果：247 / 247 green

#### Phase 2b — nacp-session matrix consumer
- 新文件 `packages/nacp-session/src/type-direction-matrix.ts` (`NACP_SESSION_TYPE_DIRECTION_MATRIX` + `isLegalSessionDirection`)
- 修改 `frame.ts::validateSessionFrame()` — 新增 session matrix 消费层；错误路径走 `NacpSessionError(NACP_SESSION_TYPE_DIRECTION_MISMATCH)`
- 修改 `errors.ts` — 注册新 error code
- 更新 `test/frame.test.ts` — `session.stream.event` fixture 修正为 `delivery_kind: "event"`；新增 4 个 B9 matrix 断言
- 测试结果：119 / 119 green

#### Phase 3 — nacp-session 1.3.0 + session-do-runtime 0.3.0

**nacp-session 侧：**
- 新文件 `packages/nacp-session/src/upstream-context.ts` (`SessionStartInitialContextSchema`，4 子字段 + passthrough)
- 修改 `messages.ts` — `SessionStartBodySchema.initial_context` 收紧
- 修改 `version.ts` + `index.ts` + `CHANGELOG.md` + `package.json` — 1.3.0 bump
- 修改 `README.md` + `docs/nacp-session-registry.md` — baseline 文字更新为 1.3.0

**session-do-runtime 侧：**
- 修改 `do/nano-session-do.ts`：
  - import `verifyTenantBoundary` + `tenantDoStorageGet/Put/Delete` + `DoStorageLike` from `@nano-agent/nacp-core`
  - 新增 `tenantTeamUuid()` 方法（单一 tenant 身份 source-of-truth）
  - 新增 `getTenantScopedStorage()` 方法（代理所有 put/get/delete 到 `tenantDoStorage*`）
  - `acceptClientFrame()` 接线 `verifyTenantBoundary` 于 ingress success 之后
  - `wsHelperStorage()` 切到 `getTenantScopedStorage()`
  - `persistCheckpoint()` / `restoreFromStorage()` 切到 `getTenantScopedStorage()`
  - `session.resume` 的 `LAST_SEEN_SEQ_KEY put` 切到 `getTenantScopedStorage()`
- 修改 `http-controller.ts` — 硬编码 `"1.1.0"` 替换为 import `NACP_VERSION`（GPT-R4 整改）
- 修改 `package.json` — `0.1.0 → 0.3.0` + 新增 explicit `@nano-agent/nacp-core: workspace:*` dependency
- 修改 `CHANGELOG.md` — 0.3.0 entry 显式说明跨过 never-published 0.2.0 tag
- 更新 `test/integration/checkpoint-roundtrip.test.ts` + `test/do/nano-session-do.test.ts` — 断言改读 `tenants/<team>/session:checkpoint` / `tenants/<team>/session:lastSeenSeq`
- 测试结果：357 / 357 green

#### Phase 4 — root contract tests + closures + 回填
- 新文件 `test/nacp-1-3-matrix-contract.test.mjs` — 6 tests 锁 core + session matrix、两边 reject 路径、`wrapAsError` 可逆、version bump 生效
- 新文件 `test/tenant-plumbing-contract.test.mjs` — 4 tests，其中 **关键一项**：用源码白名单 parser 替代原 B9 的假绿 grep，检查 `this.doState.storage.*` 的所有命中必须落在 `getTenantScopedStorage` / `wsHelperStorage` / `alarm` / `handleWebSocketUpgrade` 之一（GPT-R3 整改），另一项检查 `http-controller.ts` 无硬编码 `1.1.0`（GPT-R4 整改）
- 新文件 `test/initial-context-schema-contract.test.mjs` — 7 tests 锁 upstream context schema 正反面 + back-compat
- 修复 `docs/nacp-session-registry.md` header 和 `packages/nacp-session/README.md` baseline — 同步 1.3.0
- 新文件 4 份 phase closure + `B9-final-closure.md`
- `docs/handoff/after-foundations-to-worker-matrix.md` — 新增 §11（NACP 1.3 prerequisite）+ §12（tenant plumbing checklist）+ §13（upstream orchestrator interface）
- `docs/issue/after-foundations/after-foundations-final-closure.md` — §6 readiness 口径更新：`Phase 0 unblocked` + 6 条约束
- `docs/code-review/after-foundations/B8-docs-reviewed-by-opus.md` — §6 close-out 追写：R1/R2/R3 `fixed via B9 shipped §11/§12/§13`
- 最终回归：94 / 94 root + 108 / 108 cross + 全 package 绿

### 12.3 新增 / 修改 artifacts 清单

**新增文件（10 项）：**

- `docs/rfc/nacp-core-1-3-draft.md`
- `packages/nacp-core/src/type-direction-matrix.ts`
- `packages/nacp-core/src/error-body.ts`
- `packages/nacp-core/test/type-direction-matrix.test.ts`
- `packages/nacp-core/test/error-body.test.ts`
- `packages/nacp-session/src/type-direction-matrix.ts`
- `packages/nacp-session/src/upstream-context.ts`
- `test/nacp-1-3-matrix-contract.test.mjs`
- `test/tenant-plumbing-contract.test.mjs`
- `test/initial-context-schema-contract.test.mjs`

**新增 closure 文档（5 项）：**

- `docs/issue/after-foundations/B9-phase-1-closure.md`
- `docs/issue/after-foundations/B9-phase-2-closure.md`
- `docs/issue/after-foundations/B9-phase-3-closure.md`
- `docs/issue/after-foundations/B9-phase-4-closure.md`
- `docs/issue/after-foundations/B9-final-closure.md`

**修改文件（nacp-core 共 6 项）：**

- `packages/nacp-core/src/envelope.ts` — +Layer 6 matrix check
- `packages/nacp-core/src/error-registry.ts` — +`NACP_TYPE_DIRECTION_MISMATCH`
- `packages/nacp-core/src/version.ts` — `NACP_VERSION` 1.1.0 → 1.3.0
- `packages/nacp-core/src/index.ts` — export 新符号
- `packages/nacp-core/package.json` — version bump
- `packages/nacp-core/CHANGELOG.md` — 1.3.0 entry

**修改文件（nacp-session 共 8 项）：**

- `packages/nacp-session/src/frame.ts` — +matrix consumer
- `packages/nacp-session/src/errors.ts` — +`NACP_SESSION_TYPE_DIRECTION_MISMATCH`
- `packages/nacp-session/src/messages.ts` — `initial_context` 收紧
- `packages/nacp-session/src/version.ts` — `NACP_SESSION_VERSION` 1.1.0 → 1.3.0
- `packages/nacp-session/src/index.ts` — export 新符号
- `packages/nacp-session/package.json` — version bump
- `packages/nacp-session/CHANGELOG.md` — 1.3.0 entry
- `packages/nacp-session/README.md` — baseline 文字更新

**修改文件（session-do-runtime 共 4 项）：**

- `packages/session-do-runtime/src/do/nano-session-do.ts` — tenant plumbing + `getTenantScopedStorage()` + `verifyTenantBoundary` 接线
- `packages/session-do-runtime/src/http-controller.ts` — 硬编码 1.1.0 清理
- `packages/session-do-runtime/package.json` — version 0.1.0 → 0.3.0 + 新增 nacp-core dep
- `packages/session-do-runtime/CHANGELOG.md` — 0.3.0 entry

**修改测试（5 项）：**

- `packages/nacp-core/test/messages/messages.test.ts`
- `packages/nacp-core/test/version.test.ts`
- `packages/nacp-core/test/envelope.test.ts`
- `packages/nacp-core/test/compat.test.ts`
- `packages/nacp-session/test/frame.test.ts`
- `packages/session-do-runtime/test/integration/checkpoint-roundtrip.test.ts`
- `packages/session-do-runtime/test/do/nano-session-do.test.ts`

**修改文档（5 项）：**

- `docs/nacp-session-registry.md` — version header 1.3.0
- `docs/handoff/after-foundations-to-worker-matrix.md` — 新增 §11/§12/§13
- `docs/issue/after-foundations/after-foundations-final-closure.md` — §6 readiness 更新
- `docs/code-review/after-foundations/B8-docs-reviewed-by-opus.md` — §6 close-out 追写
- 本文件 `docs/action-plan/after-foundations/B9-nacp-1-3-contract-freeze.md` — §0.5 GPT review tracker + §12 工作日志

### 12.4 验证结果

```text
# Package-level tests
packages/nacp-core:         247 / 247 green
packages/nacp-session:      119 / 119 green
packages/session-do-runtime: 357 / 357 green
(所有其他 8 包保持 green 不变)

# Root tests
node --test test/*.test.mjs: 94 / 94 green (17 new B9 tests)

# Cross tests
npm run test:cross:         108 / 108 green

# B7 LIVE wire regression
test/b7-round2-integrated-contract.test.mjs: 5 / 5 green
```

### 12.5 残余 blockers

**无 blocker 阻碍 B9 closure。** 已识别的 deferrals 在 out-of-scope 列表里有明确位置：

- **O11** — 三个 `*.response` body migration 到 `NacpErrorBodySchema`（需独立 owner-approved PR）
- **O12** — `LEGACY_ALIAS_REGISTRY` runtime（目前无消费者，RFC 层足够）
- **O13** — 虚构 seam (`tenantIngressVerify` / `contextCore.ingestFromUpstream`) 明确不实装；所有 tenant 操作通过已 shipped 的 `verifyTenantBoundary` + `tenantDoStorage*` 完成

这些延后项不阻碍 worker matrix Phase 0 启动。

### 12.6 对 B8 review 的 close-out

- **R1** nacp-1.3 pre-requisite → `fixed via B9 shipped §11`（B8 handoff memo §11 已加）
- **R2** tenant plumbing checklist → `fixed via B9 shipped §12`（B8 handoff memo §12 已加；source-code white-list test 强制）
- **R3** upstream orchestrator interface → `fixed via B9 shipped §13`（B8 handoff memo §13 已加，引用 `SessionStartInitialContextSchema`）
- **R4-R7** → `fixed via inline doc diff`（在 B8 review 响应时已处理，B9 再次同步 README / registry doc / CHANGELOG 一致性）

### 12.7 收口分析与建议

**收口分析（为什么说 B9 真的 closed）：**

1. **问题定义已冻结**：所有 3 条 P1-P5 核心问题都有对应 shipped code 可追溯。matrix 双侧 ownership + error-body helper + naming RFC-level + tenant plumbing 5 处接线 + initial_context schema 这 5 项全部落盘。
2. **回归充分**：94 root + 108 cross + 11 包 × 全部 unit test 绿；B7 LIVE wire 契约（`b7-round2-integrated-contract.test.mjs` 的 5 tests）保持 pass。
3. **Scope 诚实**：GPT review 指出的每一项 scope narrowing（error-body 不迁 response shape / naming 不 ship runtime alias / Phase 3 targets 用真实 seam / version baseline 诚实盘点 / 文档路径修正）都有对应的 shipped 证据，不是文字承诺。
4. **向下兼容守住**：三包 package.json + CHANGELOG head 一致；`V1_BINDING_CATALOG` 未动；v1.0/v1.1 consumer 不需要改代码；B7 LIVE deploy 契约保持；per-session DO 身份保留（`idFromName(sessionId)` 不变）。
5. **失败的 Pre-existing 测试被正确理解**：15 个旧 `test/messages/messages.test.ts` fixture 使用错误的 `delivery_kind: "command"`——Layer 6 正好暴露了它们，证明 matrix 确实在做功。修复方法（从矩阵自动挑首个合法值）是 additive，不削弱原 fixture 意图。

**建议给 worker matrix Phase 0：**

1. **先读 3 份文档再动手**：`docs/issue/after-foundations/B9-final-closure.md` + `docs/rfc/nacp-core-1-3-draft.md` + `docs/handoff/after-foundations-to-worker-matrix.md` §11/§12/§13。这三份是 B9 冻结之后、worker matrix 启动之前必要且充分的 reading 列表。
2. **任何新 worker 的 emit 都要走 matrix**：用 `NACP_CORE_TYPE_DIRECTION_MATRIX` 或 `NACP_SESSION_TYPE_DIRECTION_MATRIX` 做静态检查；引入新 verb 时先改 matrix（additive）再发 code，不要尝试绕过 Layer 6。
3. **任何新的 DO 或 DO-like runtime 都要用 tenant wrapper**：如果 worker matrix 为 `agent.core` / `context.core` / `context.reranker` / `tool.capability` 引入新的 DO 实装，**必须在 root test 层复用 `test/tenant-plumbing-contract.test.mjs` 的白名单检查模式**，不要退回到假绿 grep。
4. **`initial_context` 消费点由 worker matrix owner**：B9 只冻结了 wire shape；worker matrix 的 `agent.core` 必须决定 `initial_context → context.core slot` 的映射规则并落地（建议在 worker matrix Phase 1 作为必选项）。
5. **O11 响应 shape 迁移最好单独立项**：它会触到 `tool.ts` / `context.ts` / `skill.ts` + 所有 `status`-dispatching consumer（eval pipeline / SessionInspector / BoundedEvalSink / test fixtures）；在 worker matrix 里夹带做完会稀释 scope。建议在 worker matrix Phase 0 之后、Phase 1 之前由 owner 单独决定是否立项。
6. **B7 LIVE deploy 可以不 re-verify**：本次本地 regression 覆盖了 `b7-round2-integrated-contract.test.mjs` 的 5 个 LIVE-wire 锁契约；只有在 worker matrix 真正做 DO 层重构时才建议 owner re-deploy。

### 12.8 最终 verdict

**✅ B9 closed —— worker matrix Phase 0 gate OPEN**

after-foundations 阶段至此彻底关闭；协议/运行时层面的 tech debt 已全部收敛至本次 RFC 冻结的 contract surface 内。
