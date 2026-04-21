# Nano-Agent 行动计划 — B9：NACP 1.3 Contract Freeze + Tenant Plumbing + Upstream Interface

> 服务业务簇：`After-Foundations Phase 8 — Pre-Worker-Matrix Contract Freeze`
> 计划对象：`packages/nacp-core` / `packages/nacp-session` / `packages/session-do-runtime` 三包的 contract 层扩展 + `docs/rfc/nacp-core-1-3-draft.md` RFC 起草 + 相关测试与文档
> 类型：`modify (additive, non-breaking)`
> 作者：`Claude Opus 4.7 (1M context)`
> 时间：`2026-04-20`
> 文件位置（主要新增/修改文件预规划）：
> - `docs/rfc/nacp-core-1-3-draft.md` （new — RFC 主文件）
> - `packages/nacp-core/src/envelope.ts` （modify — 新增 `NACP_TYPE_DIRECTION_MATRIX` 校验层 + `NacpErrorBodySchema`）
> - `packages/nacp-core/src/error-body.ts` （new — standard error body schema）
> - `packages/nacp-core/src/naming-spec.ts` （new — verb naming convention + alias registry）
> - `packages/nacp-core/src/index.ts` （modify — 导出新符号）
> - `packages/nacp-core/CHANGELOG.md` （modify — 1.3.0 入口）
> - `packages/nacp-core/package.json` （modify — version bump 1.1.0 → 1.3.0）
> - `packages/nacp-session/src/messages.ts` （modify — 精细化 `SessionStartBodySchema.initial_context` 子 schema）
> - `packages/nacp-session/src/upstream-context.ts` （new — `SessionStartInitialContextSchema` 等 upstream 注入契约）
> - `packages/nacp-session/CHANGELOG.md` （modify — 1.3.0 入口，同步协议版本）
> - `packages/nacp-session/package.json` （modify — version bump 1.1.0 → 1.3.0）
> - `packages/session-do-runtime/src/do/nano-session-do.ts` （modify — `verifyTenantBoundary` + `tenantDoStorage*` 接线）
> - `packages/session-do-runtime/src/tenant-plumbing.ts` （new — tenant ingress verify + DO storage wrapper 包装点）
> - `packages/session-do-runtime/CHANGELOG.md` （modify — 0.3.0 入口）
> - `packages/session-do-runtime/package.json` （modify — version bump 0.1.0 → 0.3.0）
> - `test/nacp-1-3-matrix-contract.test.mjs` （new — root contract test 锁 matrix + error body + verb naming）
> - `test/tenant-plumbing-contract.test.mjs` （new — root contract test 锁 tenant ingress verify 强制性）
> - `test/initial-context-schema-contract.test.mjs` （new — root contract test 锁 upstream memory injection schema）
> - `docs/issue/after-foundations/B9-phase-{1,2,3,4}-closure.md` （new）
> - `docs/issue/after-foundations/B9-final-closure.md` （new）
>
> 关联设计 / spec / review / issue / spike / action-plan 文档：
> - `docs/eval/after-foundations/smind-contexter-learnings.md` §9 （NACP 双轴 vs CICP 辩证；§9.5.2 C/D/E/F-new 是 B9 冻结 scope；§9.7.2 "今天能不能诚实冻结" 逐项核验；§9.7.4 B9 proposed 5-phase 结构）
> - `docs/eval/after-foundations/smind-contexter-learnings.md` §10 （Contexter-Nano-agent 分层架构；§10.5 分层图；§10.6 `initial_context` wire hook；§10.8 多租户分层责任切分；§10.11 B8 新增 D10）
> - `docs/action-plan/after-foundations/B8-worker-matrix-pre-convergence.md` （B8 handoff phase；B9 是 B8 的并行或紧接 phase）
> - `docs/code-review/B8-docs-reviewed-by-opus.md` （B8 review 中 R1/R2/R3 三项 blocker 直接对应 B9 scope）
> - `docs/issue/after-foundations/B7-final-closure.md` §3 （B9 consume 的 LIVE numbers 基线）
> - `docs/issue/after-foundations/B8-phase-1-closure.md` §2-§6 （B9 的前置 truth inventory）
> - `docs/rfc/nacp-core-1-2-0.md` （B6 frozen：stay at 1.1.0；B9 是 1.1 → 1.3 的下一次升级）
> - `docs/rfc/nacp-session-1-2-0.md` （同上）
> - `docs/plan-after-foundations.md` §4.1 H （charter 条款：不修改 V1_BINDING_CATALOG；B9 在此硬约束下做 additive change）
>
> 关键 reference（当前仓库 reality）：
> - `packages/nacp-core/src/envelope.ts:49-54` （现存 `NacpDeliveryKindSchema` 4 值 enum）
> - `packages/nacp-core/src/envelope.ts:84-94` （`NacpHeaderSchema` 含 `message_type` + `delivery_kind`）
> - `packages/nacp-core/src/envelope.ts:250-261` （`NACP_MESSAGE_TYPES_ALL` 运行时 registry）
> - `packages/nacp-core/src/envelope.ts:309-315` （现存 `validateEnvelope()` 第 5 层校验 — B9 在此处扩展）
> - `packages/nacp-core/src/index.ts:101-104` （`verifyTenantBoundary` / `tenantDoStorage*` shipped 但未接线）
> - `packages/nacp-session/src/messages.ts:17-22` （`SessionStartBodySchema` 已有 `initial_context: z.record(z.string(), z.unknown()).optional()`）
> - `packages/session-do-runtime/src/worker.ts:86` （`idFromName(sessionId)` — per-session DO，B9 不改）
> - `packages/session-do-runtime/src/do/nano-session-do.ts` 9 处 `env.TEAM_UUID` 读取点（B9 改造对象）
>
> 文档状态：`draft`

---

## 0. 执行背景与目标

> B9 是 after-foundations 阶段的**最后一个包修改 phase**，也是 worker matrix 的**硬前置**。它不发明新能力；它把 B1-B8 已经达成但**未变现**的三类共识冻结到 shipped packages 里，让 worker matrix Phase 0 从"stable contract surface"起跑而不是"带着已知 tech debt 入场"。

- **服务业务簇**：`After-Foundations Phase 8 — Pre-Worker-Matrix Contract Freeze`
- **计划对象**：nacp-core / nacp-session / session-do-runtime 三包的 contract 层扩展，零 breaking change，升版本号
- **本次计划要解决的核心问题**：
  - **P1**：NACP `message_type` 与 `delivery_kind` 双轴**信息冗余**（`tool.call.request` 后缀 `.request` 和 `delivery_kind: "command"` 说的是同一件事），且**缺合法组合矩阵校验**——worker matrix 的 4 个 first-wave workers 如果首次 emit 就带着这个 tech debt，后期滚动升级代价是数量级放大（详见 `smind-contexter-learnings.md` §9.2）
  - **P2**：Error 作为一等公民**缺标准 pattern**——每个新 worker 发明自己的 error body shape，`SessionInspector` / `BoundedEvalSink` / eval pipeline 无法统一解析；B9 提供 `NacpErrorBodySchema` 统一结构
  - **P3**：Business verb naming 不统一——`tool.call` / `hook` / `context.compact` 格式各异，方向后缀约定也不一致（`.request/.response` vs `.broadcast/.return`）；B9 规定 `<namespace>.<verb>` 两段制 + 方向只走 `delivery_kind`
  - **P4**：B6 shipped 的 `verifyTenantBoundary` + `tenantDoStorage*` wrappers **在 session-do-runtime 零调用**——B9 接线这些 wrapper 到 `NanoSessionDO` ingress + 所有 DO storage 操作，把 B6 投资变现（详见 `smind-contexter-learnings.md` §10.2 + §10.8）
  - **P5**：`SessionStartBodySchema.initial_context` 是 shipped 但 schema 过于宽松 (`z.record(z.string(), z.unknown())`)——B9 把 upstream orchestrator 注入 user memory 的契约精细化为 `SessionStartInitialContextSchema`（详见 `smind-contexter-learnings.md` §10.6.1）
- **本次计划的直接产出**：
  - **D1**：`docs/rfc/nacp-core-1-3-draft.md` —— RFC 主文件，描述 4 项冻结（C/D/E/F-new）+ alias 兼容策略
  - **D2**：nacp-core 1.3.0 ship —— matrix 校验 + error body schema + naming spec + alias registry
  - **D3**：nacp-session 1.3.0 ship —— `SessionStartInitialContextSchema` + version 同步
  - **D4**：session-do-runtime 0.3.0 ship —— tenant plumbing 接线（`verifyTenantBoundary` + `tenantDoStorage*`）
  - **D5**：3 份 root contract test 锁 matrix / tenant / initial_context 契约
  - **D6**：4 份 B9 phase closure + B9 final closure

---

## 1. 执行综述

### 1.1 总体执行方式

B9 采用 **"RFC 先行、校验层扩展、实装接线、契约锁测试"** 的四段式：

1. **Phase 1 — RFC 起草 + 冻结 scope 锁死**：先把 `docs/rfc/nacp-core-1-3-draft.md` 写清楚（引用 `smind-contexter-learnings.md` §9.5.2 / §9.7.2 的逐项核验结果）；owner 批准后 scope 不再漂移
2. **Phase 2 — nacp-core 1.3.0 实装**：matrix 校验 + error body + naming spec + alias；`NACP_VERSION = "1.3.0"` bump
3. **Phase 3 — nacp-session 1.3.0 + session-do-runtime 0.3.0 实装**：upstream `initial_context` schema + tenant plumbing 接线；三包版本同步
4. **Phase 4 — 契约锁测试 + B9 closure + 对 B8 handoff pack 的回填**：3 份 root contract test 跑绿；把 B9 的产出回写到 B8 handoff memo 新增的 §11/§12/§13（即 B8 review R1/R2/R3 对应的补齐章节）

**关键执行不变量**：
- **零 breaking change** —— 所有 v1.1 message_type alias 保留；v1 消费者不需修改代码
- **`V1_BINDING_CATALOG` 严禁修改**（charter §4.1 H 第 32 项）—— B9 不碰 binding catalog，只改 envelope 校验 + body schema
- **`idFromName(sessionId)` per-session DO 保持不变** —— `smind-contexter-learnings.md` §10.4 重辩证后的结论：nano-agent 天然是 per-session runtime
- **所有新增 schema 走 zod-first + registry 显式** —— 与 nano-agent 既有工程纪律一致

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | RFC 起草 + scope 冻结 | S | `docs/rfc/nacp-core-1-3-draft.md` owner approve 后 scope 锁死 | B8 closure + `smind-contexter-learnings.md` §9/§10 已落稿 |
| Phase 2 | nacp-core 1.3.0 实装 | M | matrix 校验 + error body + naming spec + alias registry | Phase 1 |
| Phase 3 | nacp-session 1.3.0 + session-do-runtime 0.3.0 实装 | M | `SessionStartInitialContextSchema` + tenant plumbing 接线 | Phase 2 |
| Phase 4 | 契约锁测试 + closure + 回填 B8 | S | 3 份 root contract test + B9 closure + 回填 B8 handoff pack | Phase 1-3 |

### 1.3 Phase 说明

1. **Phase 1 — RFC 起草**
   - **核心目标**：把"冻结哪些 / 不冻结哪些"明确写进 RFC；owner 批准后 scope 不再漂移；显式引用 `smind-contexter-learnings.md` §9.7.2 逐项核验表（认知饱和 / 实装能力 / 不冻代价）
   - **为什么先做**：B9 scope 的最大风险是"顺手扩大"（例如把 v1.1 alias 一并移除 = breaking change）。Phase 1 的 RFC 在写代码前把边界固定
2. **Phase 2 — nacp-core 1.3.0 实装**
   - **核心目标**：`(message_type, delivery_kind)` 合法矩阵校验 + `NacpErrorBodySchema` + `VERB_NAMING_SPEC` + `LEGACY_ALIAS_REGISTRY`
   - **为什么放在这里**：nacp-core 是底层 protocol，必须先升；nacp-session / session-do-runtime 都 depends on 它
3. **Phase 3 — nacp-session + session-do-runtime 实装**
   - **核心目标**：`SessionStartInitialContextSchema` 精细化 upstream memory 注入契约 + `NanoSessionDO` ingress 接线 `verifyTenantBoundary` + 全部 DO storage 操作走 `tenantDoStorage*`
   - **为什么放在这里**：两包 depends on nacp-core 1.3；同时两包也有交叉依赖（session-do-runtime 消费 session messages），所以放同一 phase 成本最低
4. **Phase 4 — 契约锁测试 + closure + 回填 B8**
   - **核心目标**：3 份 root test 锁住 matrix / tenant plumbing / initial_context 契约；B8 handoff memo 补 §11/§12/§13；B9 自身 closure
   - **为什么放在这里**：测试必须在所有 code ship 之后；B8 回填等到 B9 能 ship 的时候才有内容可回填

### 1.4 执行策略说明

- **执行顺序原则**：**RFC 先行 → 底层协议（nacp-core）→ 上层协议 + runtime（nacp-session + session-do-runtime）→ 契约测试 + 回填**；严格串行，phase 内允许并行
- **风险控制原则**：**Additive-only**。所有新增 schema 为 `optional` 或 `nullable`；所有现存字段 semantics 不变；所有 v1.1 string alias 保留；failure mode 走 fail-closed 校验（违反 matrix 就 reject，但 alias 仍合法）
- **测试推进原则**：每个新增 export 必须有对应 root contract test；三包 unit test 保持 green；每次版本 bump 后跑 `pnpm -r run test` + `node --test test/*.test.mjs` + `npm run test:cross` 全绿
- **文档同步原则**：本 phase 的三包 CHANGELOG 必须与 RFC 保持一致；B8 handoff memo 的 §11/§12/§13 在 Phase 4 回填时必须 link 到 B9 RFC + closure

### 1.5 本次 action-plan 影响目录树

```text
packages/
├── nacp-core/                                  # version 1.1.0 → 1.3.0
│   ├── src/
│   │   ├── envelope.ts                          # modify (新增 matrix 校验层)
│   │   ├── error-body.ts                        # NEW (NacpErrorBodySchema)
│   │   ├── naming-spec.ts                       # NEW (verb naming + alias registry)
│   │   ├── type-direction-matrix.ts             # NEW (NACP_TYPE_DIRECTION_MATRIX)
│   │   └── index.ts                             # modify (export 新符号)
│   ├── CHANGELOG.md                             # modify (1.3.0 entry)
│   └── package.json                             # modify (version bump)
├── nacp-session/                                # version 1.1.0 → 1.3.0
│   ├── src/
│   │   ├── messages.ts                          # modify (SessionStartBodySchema.initial_context 精细化)
│   │   ├── upstream-context.ts                  # NEW (SessionStartInitialContextSchema)
│   │   └── index.ts                             # modify (export 新符号)
│   ├── CHANGELOG.md                             # modify (1.3.0 entry)
│   └── package.json                             # modify (version bump)
└── session-do-runtime/                          # version 0.1.0 → 0.3.0
    ├── src/
    │   ├── tenant-plumbing.ts                   # NEW (ingress verify + DO wrapper)
    │   └── do/nano-session-do.ts                # modify (接线 tenant-plumbing)
    ├── CHANGELOG.md                             # modify (0.3.0 entry)
    └── package.json                             # modify (version bump)

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
└── action-plan/after-foundations/
    └── B9-nacp-1-3-contract-freeze.md           # 本文件

test/
├── nacp-1-3-matrix-contract.test.mjs            # NEW
├── tenant-plumbing-contract.test.mjs            # NEW
└── initial-context-schema-contract.test.mjs     # NEW
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `docs/rfc/nacp-core-1-3-draft.md` 起草 + owner 批准
- **[S2]** `NACP_TYPE_DIRECTION_MATRIX` 实装 + `validateEnvelope()` 第 6 层校验（引用 `smind-contexter-learnings.md` §9.5.2 C）
- **[S3]** `NacpErrorBodySchema` + error wrapping convention（引用 `smind-contexter-learnings.md` §9.5.2 D）
- **[S4]** `VERB_NAMING_SPEC` + alias registry（引用 `smind-contexter-learnings.md` §9.5.2 E）
- **[S5]** `delivery_kind` 4 值语义 spec 文字化（引用 `smind-contexter-learnings.md` §9.5.2 F-new）
- **[S6]** `SessionStartInitialContextSchema` 精细化 upstream memory 注入契约（引用 `smind-contexter-learnings.md` §10.6.1）
- **[S7]** `NanoSessionDO` ingress 接线 `verifyTenantBoundary`（引用 `smind-contexter-learnings.md` §10.2.3 "6 项必做" + §10.8）
- **[S8]** `NanoSessionDO` 内所有 `state.storage.put/get/delete` 改走 `tenantDoStorage*`
- **[S9]** 3 包 version bump：nacp-core 1.3.0 / nacp-session 1.3.0 / session-do-runtime 0.3.0 + CHANGELOG
- **[S10]** 3 份 root contract test 锁新契约
- **[S11]** B8 handoff memo 回填 §11（nacp-1.3）+ §12（tenant plumbing）+ §13（upstream orchestrator）——即 B8 review R1/R2/R3 的补齐
- **[S12]** B9 4 份 phase closure + final closure

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** **移除 v1.1 message_type alias** —— 那是 nacp-2.0 breaking 的事，B9 只做 additive
- **[O2]** **修改 `V1_BINDING_CATALOG`** —— charter §4.1 H 第 32 项硬约束
- **[O3]** **实装 `orchestrator.*` message_type namespace** —— `smind-contexter-learnings.md` §10.10 明确 "只预留 namespace，实际定义在 contexter-integration phase"
- **[O4]** **Contexter 改造** —— `smind-contexter-learnings.md` §10.7 是 post-worker-matrix phase 的事
- **[O5]** **`context.reranker` worker 立项** —— §4.4 定义的是 post-worker-matrix；B9 不碰
- **[O6]** **DO 身份迁移** —— `smind-contexter-learnings.md` §10.4 结论：nano-agent per-session 是**正确的**，不迁移
- **[O7]** **`DOStorageAdapter.maxValueBytes` 从 1 MiB 升到 2 MiB** —— worker matrix 阶段 OR 独立 small PR（B8 action-plan out-of-scope [O9]）
- **[O8]** **为 F03 / F09 gates 编写新 probe** —— owner-side action，不是 B9 代码工作
- **[O9]** **新增 worker 实装** —— 所有 worker matrix 工作都在 B9 之后
- **[O10]** **前端 / client SDK 改动** —— B9 是后端协议层；client 不受影响（因为 alias 兼容）

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| 移除 `tool.call.request` 后缀字符串 | `out-of-scope` | breaking；alias 保留直到 nacp-2.0 | nacp-2.0 立项时 |
| `orchestrator.*` namespace 实装 | `defer / depends-on-decision` | RFC 仅**预留** namespace；owner 决定 contexter-integration phase 开工时再实装 | owner 启动 contexter 改造 phase |
| `DOStorageAdapter.maxValueBytes` 升到 2 MiB | `defer` | B7 F08 给出 2 MiB 安全值；升级是独立 calibration，与 protocol 冻结解耦 | worker matrix Phase 0 可以顺手做 |
| 清理 `eval-observability` / `session-do-runtime` 两包的 "CHANGELOG head 超前于 package.json" 不一致 | `in-scope`（顺手做） | B8 phase-1-closure §2 脚注已记录；既然 session-do-runtime 升 0.3.0，顺便把 package.json 对齐到 0.3.0 即可 | Phase 3 末尾 |
| 新 `ContextRerank*` hook catalog 事件定义 | `out-of-scope` | `smind-contexter-learnings.md` §4.4.4 规划为 "post-worker-matrix Rerank-1"，**不与** nacp-1.3 同步做 | reranker 立项时 |
| 非 `NanoSessionDO` 的 tenant plumbing（如 `workspace-context-artifacts`） | `out-of-scope` | B9 只接 nacp-core/nacp-session/session-do-runtime 三包；其他包保持 shipped 现状 | 未来按需做 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | 起草 `docs/rfc/nacp-core-1-3-draft.md` | add | 新文件 | RFC 覆盖 4 项冻结 + alias 策略 + 版本号跳 1.1→1.3 的理由 | low |
| P1-02 | Phase 1 | Owner 批准 RFC | decision | 同上 | scope 冻结，不再漂移 | low |
| P1-03 | Phase 1 | `B9-phase-1-closure.md` | doc | 新文件 | RFC owner-approved 状态锁 | low |
| P2-01 | Phase 2 | `packages/nacp-core/src/type-direction-matrix.ts` | add | 新文件 | 定义 `NACP_TYPE_DIRECTION_MATRIX` | medium |
| P2-02 | Phase 2 | `packages/nacp-core/src/error-body.ts` | add | 新文件 | 定义 `NacpErrorBodySchema` + `wrapAsError()` helper | medium |
| P2-03 | Phase 2 | `packages/nacp-core/src/naming-spec.ts` | add | 新文件 | 定义 `VERB_NAMING_SPEC` + `LEGACY_ALIAS_REGISTRY` | medium |
| P2-04 | Phase 2 | `packages/nacp-core/src/envelope.ts::validateEnvelope` | modify | 现有文件 | 扩展第 6 层 matrix 校验；现有 5 层不动 | high |
| P2-05 | Phase 2 | `packages/nacp-core/src/index.ts` | modify | 现有文件 | 导出新符号 | low |
| P2-06 | Phase 2 | nacp-core CHANGELOG + package.json | modify | 现有文件 | version 1.1.0 → 1.3.0 (跳 1.2.0 避免与 frozen RFC 混淆) | low |
| P2-07 | Phase 2 | nacp-core unit tests 扩充 | modify / add | `packages/nacp-core/test/*.test.ts` | 新增 matrix / error body / naming 三类 unit 测试 | medium |
| P2-08 | Phase 2 | `B9-phase-2-closure.md` | doc | 新文件 | nacp-core 1.3.0 ship 记录 | low |
| P3-01 | Phase 3 | `packages/nacp-session/src/upstream-context.ts` | add | 新文件 | `SessionStartInitialContextSchema` | medium |
| P3-02 | Phase 3 | `packages/nacp-session/src/messages.ts` | modify | 现有文件 | 收紧 `SessionStartBodySchema.initial_context` 到新 schema（保留 `.optional()`） | medium |
| P3-03 | Phase 3 | nacp-session index.ts + CHANGELOG + package.json | modify | 现有文件 | export + version 1.1.0 → 1.3.0 | low |
| P3-04 | Phase 3 | nacp-session unit tests 扩充 | modify / add | `packages/nacp-session/test/*` | upstream context schema 测试 | medium |
| P3-05 | Phase 3 | `packages/session-do-runtime/src/tenant-plumbing.ts` | add | 新文件 | ingress verify + DO wrapper helper | high |
| P3-06 | Phase 3 | `packages/session-do-runtime/src/do/nano-session-do.ts` | modify | 现有文件 | 所有 `state.storage.*` 改走 `tenantDoStorage*`；ingress 接 `verifyTenantBoundary` | high |
| P3-07 | Phase 3 | session-do-runtime index + CHANGELOG + package.json | modify | 现有文件 | export + version 0.1.0 → 0.3.0（对齐 CHANGELOG） | low |
| P3-08 | Phase 3 | session-do-runtime unit tests 扩充 | modify / add | `packages/session-do-runtime/test/*` | tenant plumbing + initial_context ingest 测试 | medium |
| P3-09 | Phase 3 | `B9-phase-3-closure.md` | doc | 新文件 | nacp-session 1.3.0 + session-do-runtime 0.3.0 ship | low |
| P4-01 | Phase 4 | `test/nacp-1-3-matrix-contract.test.mjs` | add | 新文件 | root 契约测试锁 matrix 校验 | medium |
| P4-02 | Phase 4 | `test/tenant-plumbing-contract.test.mjs` | add | 新文件 | root 契约测试锁 tenant ingress verify 强制性 | medium |
| P4-03 | Phase 4 | `test/initial-context-schema-contract.test.mjs` | add | 新文件 | root 契约测试锁 upstream memory injection schema | medium |
| P4-04 | Phase 4 | `pnpm -r run test` + `node --test test/*.test.mjs` + `npm run test:cross` full regression | test | root repo | 目标 77+N / 91+M green | medium |
| P4-05 | Phase 4 | 回填 B8 handoff memo §11/§12/§13 | modify | `docs/handoff/after-foundations-to-worker-matrix.md` | 对应 B8 review R1/R2/R3 补齐 | medium |
| P4-06 | Phase 4 | 回填 `after-foundations-final-closure.md` §6 第 5/6 条约束 | modify | `docs/issue/after-foundations/after-foundations-final-closure.md` | B8 review R3 补齐 | low |
| P4-07 | Phase 4 | `B9-phase-4-closure.md` + `B9-final-closure.md` | add | 新文件 | B9 phase + final closure | low |
| P4-08 | Phase 4 | 本 action-plan §12 工作日志回填 | modify | 本文件底部 | 参照 B5/B7 的 §12 模式 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — RFC 起草 + scope 冻结

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | RFC 起草 | 按 `smind-contexter-learnings.md` §9.5.2 + §9.7.2 写 C/D/E/F-new 4 项；显式 out-of-scope F-original (alias 移除) 与 G (client intent 扩张)；引用 `SessionStartInitialContextSchema` 设计（§10.6.1） | `docs/rfc/nacp-core-1-3-draft.md` | RFC 10 章节完整：§1 背景、§2 scope、§3 matrix 设计、§4 error body 设计、§5 naming spec、§6 delivery_kind 语义 spec、§7 alias 兼容策略、§8 version bump rationale (跳 1.2 → 1.3)、§9 out-of-scope 显式清单、§10 与 `smind-contexter-learnings.md` §9/§10 的引用表 | 人工 review | RFC ship 到 `docs/rfc/` |
| P1-02 | Owner approve | owner 按 nano-agent 既有纪律审阅 + 批准 | 同上 | RFC 状态从 `draft` → `owner-approved` | owner decision | RFC 顶部 header 更新状态 |
| P1-03 | Phase 1 closure | `B9-phase-1-closure.md` | 新文件 | 记录 RFC 状态 + 引用表 | 人工 review | phase 1 closed |

### 4.2 Phase 2 — nacp-core 1.3.0 实装

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | matrix 定义 | `NACP_TYPE_DIRECTION_MATRIX: Record<string, Set<NacpDeliveryKind>>` —— 对每个 shipped message_type（含 session profile）枚举合法 delivery_kind | `packages/nacp-core/src/type-direction-matrix.ts` (新文件) | ~50 行 TS；覆盖全部 NACP_MESSAGE_TYPES_ALL + SESSION_MESSAGE_TYPES | unit test (P2-07) | 每个 shipped type 至少有 1 个合法 delivery_kind |
| P2-02 | error body | `NacpErrorBodySchema` (Zod: `{code, message, retriable?, cause?}`) + `wrapAsError(envelope, error)` helper | `packages/nacp-core/src/error-body.ts` (新文件) | ~80 行 TS | unit test | schema parse pass + wrap helper 输出有效 envelope |
| P2-03 | naming spec | `VERB_NAMING_SPEC` (string "`<namespace>.<verb>`" + regex) + `LEGACY_ALIAS_REGISTRY: Map<oldString, { verb, delivery_kind }>` —— 列出 v1.1 所有现存 message_type 到 1.3 canonical 的映射 | `packages/nacp-core/src/naming-spec.ts` (新文件) | ~60 行 TS + alias registry ~20 条 | unit test | 所有 v1.1 shipped types 有 alias 映射 |
| P2-04 | envelope.ts 扩展 | `validateEnvelope()` 第 5 层后新增第 6 层 matrix 校验：查 `NACP_TYPE_DIRECTION_MATRIX[type]` 是否 `has(delivery_kind)`；违反抛 `NACP_TYPE_DIRECTION_MISMATCH` | `packages/nacp-core/src/envelope.ts` (modify) | ~30 行 diff；现有 5 层不动 | unit test + regression | 现有 shipped envelope 全部通过；非法组合被 reject |
| P2-05 | error registry | `NACP_ERROR_REGISTRY` 增加 `NACP_TYPE_DIRECTION_MISMATCH` / `NACP_ALIAS_USED_WARNING`（后者 non-fatal） | `packages/nacp-core/src/error-registry.ts` (modify) | ~10 行 | unit test | 新 error code 可 emit + retry policy 正确 |
| P2-06 | index.ts + CHANGELOG + package.json | export 新符号；CHANGELOG 加 1.3.0 entry（引用 RFC）；package.json version 1.1.0 → **1.3.0**（跳 1.2.0 避免与 B6-frozen RFC 混淆） | `packages/nacp-core/{src/index.ts, CHANGELOG.md, package.json}` | nacp-core v1.3.0 shipped | `pnpm --filter @nano-agent/nacp-core build` | npm package 可 resolve |
| P2-07 | unit tests | matrix / error body / naming / envelope-6层 校验 四类 unit 测试 | `packages/nacp-core/test/*.test.ts` 新增 ~4 个 | +50 个 test cases | `pnpm --filter @nano-agent/nacp-core test` | 现有 + 新增 test 全绿 |
| P2-08 | Phase 2 closure | `B9-phase-2-closure.md` | 新文件 | — | 人工 review | nacp-core 1.3.0 shipped |

### 4.3 Phase 3 — nacp-session 1.3.0 + session-do-runtime 0.3.0 实装

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | initial_context schema | `SessionStartInitialContextSchema` — Zod schema 覆盖 `user_memory / intent / warm_slots / realm_hints` 四个子字段（参照 `smind-contexter-learnings.md` §10.6.1 proposed shape） | `packages/nacp-session/src/upstream-context.ts` (新文件) | ~100 行 Zod | unit test | schema 可 parse valid + reject invalid |
| P3-02 | SessionStartBodySchema 收紧 | 现在 `initial_context: z.record(z.string(), z.unknown()).optional()` —— 收紧为 `initial_context: SessionStartInitialContextSchema.optional()` 同时保留**向后兼容**：提供 `LOOSE_INITIAL_CONTEXT_ALIAS` 供过渡期 opt-in | `packages/nacp-session/src/messages.ts` (modify) | ~15 行 diff | unit test | 现有 shipped `initial_context` 仍可 parse |
| P3-03 | nacp-session index + CHANGELOG + package.json | version 1.1.0 → 1.3.0 同步；CHANGELOG 1.3.0 entry | `packages/nacp-session/{src/index.ts, CHANGELOG.md, package.json}` | nacp-session v1.3.0 | `pnpm --filter @nano-agent/nacp-session build` | package 可 resolve |
| P3-04 | nacp-session unit tests | upstream-context schema + SessionStart body compat 测试 | `packages/nacp-session/test/*` | +30 cases | `pnpm --filter @nano-agent/nacp-session test` | 全绿 |
| P3-05 | tenant plumbing 新模块 | `tenantIngressVerify(env, envelope)` wraps `verifyTenantBoundary` + 错误映射；`getTenantScopedStorage(doState)` 返回代理对象自动调用 `tenantDoStorage*` | `packages/session-do-runtime/src/tenant-plumbing.ts` (新文件) | ~120 行 TS | unit test + integration test | ingress 拒绝 team_uuid 不匹配；DO op 全部带 tenant scope |
| P3-06 | NanoSessionDO 接线 | 所有 `state.storage.put/get/delete` 改走 `tenantDoStorage*`；`dispatchAdmissibleFrame` 入口前调用 `tenantIngressVerify`；`initial_context` consume 点加入 `body.initial_context` → `this.subsystems.contextCore?.ingestFromUpstream(ctx)`（如果 context.core 还没 ship，先写占位 no-op） | `packages/session-do-runtime/src/do/nano-session-do.ts` (modify) | ~80 行 diff | unit + integration test | B7 shipped DO 行为保持 + 新增 tenant + initial_context 处理 |
| P3-07 | runtime version + CHANGELOG 对齐 | B8 Phase 1 §2 脚注指出 "session-do-runtime package.json=0.1.0 但 CHANGELOG head=0.2.0" —— B9 顺手对齐：version 直接跳 0.3.0（跨过 0.2.0 的 history 入口由 CHANGELOG 本身承载） | `packages/session-do-runtime/{package.json, CHANGELOG.md}` | 版本号一致 | 检查 | version.json == CHANGELOG head |
| P3-08 | session-do-runtime unit tests | tenant verify 强制性 + initial_context 路径 | `packages/session-do-runtime/test/*` | +40 cases | `pnpm --filter @nano-agent/session-do-runtime test` | 全绿 |
| P3-09 | Phase 3 closure | `B9-phase-3-closure.md` | 新文件 | — | 人工 review | nacp-session 1.3.0 + session-do-runtime 0.3.0 shipped |

### 4.4 Phase 4 — 契约锁测试 + closure + B8 回填

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | matrix root test | `test/nacp-1-3-matrix-contract.test.mjs` — 锁住：(1) 所有 shipped type 必须在 matrix 里；(2) 非法组合 reject；(3) alias 映射完整；(4) error body wrap → parse 可逆 | 新文件 ~6 tests | node --test 通过 | `node --test test/nacp-1-3-matrix-contract.test.mjs` | all green |
| P4-02 | tenant plumbing root test | `test/tenant-plumbing-contract.test.mjs` — 锁住：(1) ingress without team_uuid → reject；(2) ingress team_uuid mismatch DO env → reject；(3) `state.storage.put` 直接 call 在 nano-session-do.ts 源码中不再出现（grep assertion） | 新文件 ~5 tests | node --test + `grep -c "state.storage.put\|state.storage.get\|state.storage.delete" packages/session-do-runtime/src/do/nano-session-do.ts` | all green + grep count = 0 raw usage |
| P4-03 | initial_context root test | `test/initial-context-schema-contract.test.mjs` — 锁住：(1) `SessionStartInitialContextSchema` parse valid `{user_memory, intent, warm_slots, realm_hints}`；(2) optional 仍成立（空对象通过）；(3) LOOSE alias 可走老形状 | 新文件 ~4 tests | node --test | all green |
| P4-04 | full regression | 跑完整 test matrix：`pnpm -r run test` + `node --test test/*.test.mjs` + `npm run test:cross` | repo root | 77+ / 91+ all green | 命令输出 | 无 regression |
| P4-05 | 回填 B8 handoff memo §11 | 按 B8 review R1 建议，新增 "NACP 1.3 Pre-Requisite for Worker Matrix" 章节：引用 B9 RFC + B9 final closure；明确 "worker matrix Phase 0 必须基于 nacp-1.3" | `docs/handoff/after-foundations-to-worker-matrix.md` | 新增 §11 | 人工 review | 段落存在 + link 有效 |
| P4-06 | 回填 B8 handoff memo §12 | 按 B8 review R2 建议，新增 "Tenant Boundary Plumbing Checklist" 章节：引用 B9 P3-05/P3-06 shipped 状态；列出 6 项占位清单完成情况 | 同上 | 新增 §12 | 人工 review | 6 项状态表完整 |
| P4-07 | 回填 B8 handoff memo §13 | 按 B8 review R3 建议，新增 "Upstream Orchestrator Interface" 章节：引用 `smind-contexter-learnings.md` §10.5 + B9 shipped `SessionStartInitialContextSchema` | 同上 | 新增 §13 | 人工 review | 段落 + schema link |
| P4-08 | 回填 after-foundations-final-closure.md | §6 Readiness statement 追加第 5 条（worker matrix 必须等 B9 close）+ 第 6 条（agent.core 必须设计为 orchestrator-ready runtime） | `docs/issue/after-foundations/after-foundations-final-closure.md` | +2 行 | 人工 review | 约束条目可追 |
| P4-09 | B8 review 回应 | 在 `docs/code-review/B8-docs-reviewed-by-opus.md` §6 追写 "R1/R2/R3 fixed via B9 shipped artifacts；R4/R5/R6/R7 fixed via inline doc diff" | 同上（append only） | §6 填充 | 人工 review | review 可 close |
| P4-10 | B9 phase 4 + final closure | `B9-phase-4-closure.md` + `B9-final-closure.md` | 新文件 | — | 人工 review | B9 closed |
| P4-11 | action-plan §12 回填 | 本文件底部追加 §12 工作日志 | 本文件 | — | 人工 review | 日志完整 |

---

## 5. Phase 详情

### 5.1 Phase 1 — RFC 起草 + scope 冻结

- **Phase 目标**：把 `smind-contexter-learnings.md` §9.5.2 + §9.7.2 的分析固化为 owner-approved RFC
- **本 Phase 对应编号**：`P1-01 / P1-02 / P1-03`
- **本 Phase 新增文件**：`docs/rfc/nacp-core-1-3-draft.md` + `docs/issue/after-foundations/B9-phase-1-closure.md`
- **本 Phase 修改文件**：无
- **具体功能预期**：
  1. RFC §1 背景：引用 B7-final-closure + B8-phase-1-closure 做 state-of-the-art
  2. RFC §2-§6 normative scope：C (matrix) / D (error body) / E (naming) / F-new (delivery_kind 语义)
  3. RFC §7 alias 兼容：完整列 `LEGACY_ALIAS_REGISTRY`
  4. RFC §8 版本号理由：为什么跳 1.2.0 → 1.3.0（1.2.0 是 B6 frozen RFC，复用会歧义）
  5. RFC §9 显式 out-of-scope：F-original / G / breaking / orchestrator.* namespace
  6. RFC §10 traceability：逐行 link `smind-contexter-learnings.md` §9.7.2 核验表
- **具体测试安排**：无（纯 doc）；Phase 1 结束前业主 review
- **收口标准**：RFC 状态 `owner-approved`
- **本 Phase 风险提醒**：
  - **Scope creep 风险**：RFC 写着写着可能想顺手解 F-original（移除 alias）——严禁；写清楚 F-original 是 out-of-scope 就停
  - **依赖 B8 closure**：必须等 B8 final closure shipped 后启动 RFC 起草，因为要 cite `B8-phase-1-closure.md` §2/§3/§4 作为 truth inventory

### 5.2 Phase 2 — nacp-core 1.3.0 实装

- **Phase 目标**：底层协议层升级；上层 Phase 3/4 依赖此 ship
- **本 Phase 对应编号**：`P2-01 ~ P2-08`
- **本 Phase 新增文件**：3 个 src 新文件（type-direction-matrix / error-body / naming-spec）+ 对应 test 文件 + closure
- **本 Phase 修改文件**：`envelope.ts` + `error-registry.ts` + `index.ts` + `CHANGELOG.md` + `package.json`
- **具体功能预期**：
  1. `NACP_TYPE_DIRECTION_MATRIX` 精确覆盖现有 17+ types
  2. `validateEnvelope()` 第 6 层校验：非法组合 reject with `NACP_TYPE_DIRECTION_MISMATCH`
  3. `NacpErrorBodySchema` + `wrapAsError()` helper 可用
  4. `LEGACY_ALIAS_REGISTRY` 保证 v1.1 消费者零改动通过
  5. nacp-core 单包 build + test 全绿
- **具体测试安排**：
  - **单测**：4 个新 test files；matrix / error body / naming / envelope-layer-6 各自独立
  - **集成测试**：nacp-core 没有集成测试（本包是 primitive）
  - **回归测试**：`pnpm --filter @nano-agent/nacp-core test` 全绿
  - **手动验证**：手工构造 envelope `{message_type: "tool.call.request", delivery_kind: "event"}` → 确认 reject
- **收口标准**：nacp-core 1.3.0 shipped；package.json version == CHANGELOG head
- **本 Phase 风险提醒**：
  - **matrix 表打错** → 会误伤现有 shipped wire；每加一个 matrix entry 都要过既有 test
  - **version 跳跃**：1.1.0 → 1.3.0 跨过 1.2.0；CHANGELOG 要解释为什么跳（B6 frozen RFC 占用了 "1.2.0" 语义）

### 5.3 Phase 3 — nacp-session 1.3.0 + session-do-runtime 0.3.0 实装

- **Phase 目标**：上层协议 + runtime 层应用 Phase 2 的 nacp-core 1.3；同时兑现 B6 tenant 投资
- **本 Phase 对应编号**：`P3-01 ~ P3-09`
- **本 Phase 新增文件**：`nacp-session/src/upstream-context.ts` + `session-do-runtime/src/tenant-plumbing.ts` + 各自 test + closure
- **本 Phase 修改文件**：`messages.ts` + 两包 index/CHANGELOG/package.json + `do/nano-session-do.ts`
- **具体功能预期**：
  1. `SessionStartInitialContextSchema` 覆盖 `user_memory / intent / warm_slots / realm_hints`
  2. `SessionStartBodySchema.initial_context` 收紧 + LOOSE alias 保兼容
  3. `NanoSessionDO` ingress 强制 `tenantIngressVerify`
  4. `NanoSessionDO` 内所有 raw `state.storage.*` 消失（grep 验证）
  5. `body.initial_context` 被正确 route 到 context 子系统（或占位）
  6. 三包联合 build + test 全绿
- **具体测试安排**：
  - **单测**：新增 upstream-context + tenant-plumbing 两类；覆盖 valid/invalid parse + ingress reject/pass + DO storage wrapper 正确 scope
  - **集成测试**：session-do-runtime 的 DO 集成测试必须全部 pass（含 B7 LIVE 相关 unit 等价 test）
  - **回归测试**：3 包 `pnpm --filter ... test` 全绿
  - **手动验证**：手工发 session.start 带 `authority.team_uuid=A`，DO env `TEAM_UUID=B` → 确认 ingress reject
- **收口标准**：两包 shipped；grep `"state.storage.put\|state.storage.get\|state.storage.delete" packages/session-do-runtime/src/do/nano-session-do.ts` = 0
- **本 Phase 风险提醒**：
  - **NanoSessionDO 修改面大**：9 处 TEAM_UUID 读取 + N 处 state.storage.* 调用；必须逐一改造 + 对应 test 保持 pass
  - **B7 LIVE 回归风险**：改动 `NanoSessionDO` 有可能打破已 LIVE 的 binding-F01/F04 契约；必须跑 `test/b7-round2-integrated-contract.test.mjs` 确认仍 pass
  - **不要在此 phase 引入 context.core**：Phase 3 只是把 `initial_context` 通道打通，具体 consumer 是 worker matrix 的事

### 5.4 Phase 4 — 契约锁测试 + closure + B8 回填

- **Phase 目标**：锁住 B9 shipped 的 3 类契约；回填 B8 review R1/R2/R3；B9 self-close
- **本 Phase 对应编号**：`P4-01 ~ P4-11`
- **本 Phase 新增文件**：3 root test + B9-phase-4 + B9-final-closure
- **本 Phase 修改文件**：B8 handoff memo + after-foundations-final-closure + B8 code review 文件 + 本 action-plan 底部
- **具体功能预期**：
  1. 3 个 root contract test 锁定 3 类契约
  2. 全 regression 测试 green
  3. B8 handoff pack 补齐 R1/R2/R3 的 3 章节
  4. B8 review close-out：opus 的 R1/R2/R3 标 `fixed`
- **具体测试安排**：
  - **单测**：3 个新 root test
  - **回归**：`pnpm -r run test` + `node --test test/*.test.mjs` + `npm run test:cross` 全绿
- **收口标准**：
  - 3 个契约 root test green
  - B8 review 可 close（R1/R2/R3 `fixed`）
  - `B9-final-closure.md` shipped
- **本 Phase 风险提醒**：
  - **B8 handoff 回填的章节要与 B9 RFC + shipped code 保持同步** —— 写完章节后再做一次交叉核验

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1 — 是否批准 B9 作为 worker matrix Phase 0 的硬前置？

- **影响范围**：所有 Phase + 下游 worker matrix 启动时机
- **为什么必须确认**：`smind-contexter-learnings.md` §9.7 owner-revised 口径是 "nacp-1.3 在 worker matrix 开工前完成 RFC+实装"；但 B8 action-plan 没有写成硬约束。B9 需要 owner 正式授权把 "B9 close" 作为 worker matrix Phase 0 启动的 gate
- **当前建议 / 倾向**：**approve** —— 与 nano-agent 既有 "freeze biggest cognition range" 纪律一致
- **Q**：同意把 B9 close 作为 worker matrix Phase 0 启动的硬前置？
- **A**：`{等待业主回答}`

#### Q2 — version bump 策略：nacp-core 1.1.0 → 1.3.0（跨过 1.2.0）是否 OK？

- **影响范围**：Phase 2 version 决策 + CHANGELOG 语义
- **为什么必须确认**：semver 规则允许跨版本跳，但某些消费者可能 assume "1.1→1.2 兼容，1.1→1.3 需要审查"；理由是 "1.2.0 是 B6 frozen-as-no-delta 的 RFC 编号，复用会歧义"
- **当前建议 / 倾向**：**跳 1.3.0**；CHANGELOG 顶部段显式解释
- **Q**：同意跨过 1.2.0 直接 bump 到 1.3.0？
- **A**：`{等待业主回答}`

#### Q3 — `SessionStartInitialContextSchema` 的 4 个子字段（user_memory / intent / warm_slots / realm_hints）是否在 B9 就全部冻结？

- **影响范围**：Phase 3 P3-01 schema 设计 + 将来 contexter-integration 时的兼容性
- **为什么必须确认**：冻结过细 = 未来 contexter 发现需要新字段就要 breaking change；冻结过粗（如 `z.record`）= 等于不冻
- **当前建议 / 倾向**：**冻结 4 个子字段的 shape，但每个都 `optional`**；将来 contexter 发现新需求时通过追加 optional 字段 additive 扩展
- **Q**：同意冻结 4 个子字段的 shape + 全 optional？
- **A**：`{等待业主回答}`

#### Q4 — `NanoSessionDO` 改造时如何处理 B7 LIVE 回归？

- **影响范围**：Phase 3 P3-06 改造 + worker matrix 启动信心
- **为什么必须确认**：B7 LIVE deploy 的 `.out/*.json` 是**当前的 wire truth**；若 B9 的 NanoSessionDO 改造破坏 wire，B7 evidence 失效
- **当前建议 / 倾向**：**跑一次 B7 LIVE re-verify（或至少 root contract `test/b7-round2-integrated-contract.test.mjs` pass）**；若 LIVE re-verify 不可行（owner gate），至少 root test 全绿
- **Q**：接受 "root test + B7 local-sim contract test pass" 作为 B9 NanoSessionDO 改造的回归底线？
- **A**：`{等待业主回答}`

#### Q5 — B8 handoff memo §11/§12/§13 的回填是 B9 Phase 4 的一部分，还是 B8 review 单独 close 后的 follow-up？

- **影响范围**：Phase 4 P4-05/06/07 + B8 review 收口时机
- **为什么必须确认**：如果回填是 B9 P4 的一部分 = B9 完成前 B8 review 无法关闭；如果是 follow-up = B8 review 可以先 close (with deferred R1/R2/R3)
- **当前建议 / 倾向**：**作为 B9 Phase 4 的一部分** —— 因为 R1/R2/R3 的内容本身就是 B9 shipped artifacts 的 doc 反映；B8 review close 依赖 B9 close 是自然顺序
- **Q**：接受 "B8 review close ≡ B9 close" 的顺序？
- **A**：`{等待业主回答}`

### 6.2 问题整理建议

- 优先问 **Q1 (authorization)** + **Q4 (regression guarantee)** —— 这两个直接影响能否启动 B9
- Q2/Q3/Q5 可以按 "当前建议" 默认执行，业主事后否决再回滚

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| matrix 表与现有 shipped wire 错配 | 新 matrix entries 漏掉现有某个 message_type 组合 → 现有 consumer reject | `medium` | Phase 2 P2-07 unit test 必须 enumerate 所有 shipped type 并 assert 通过 |
| NanoSessionDO 改造打破 B7 LIVE | tenant wrapper 接线可能改 DO storage IO 次数或 order | `medium` | Phase 3 P3-08 + Phase 4 P4-04 regression；必要时 owner 跑 B7 re-deploy |
| RFC owner 迟迟不批 | Phase 1 卡住 → B9 整体 block | `medium` | RFC 写时预先 self-review 多轮，降低业主返工；Phase 1 设置 2-week soft deadline |
| version bump 误发 npm | 若配置 accident 发布 1.3.0-pre 到 npm | `low` | 遵循 `private: true` / workspace-local 策略；不走 npm publish |
| nacp-core Zod 性能回归 | 第 6 层 matrix 校验每次 envelope 都跑 | `low` | matrix 用 Set lookup O(1)；压测 envelope validation 速率 |
| 与 B8 review 回填的文档 drift | B8 memo 的 §11/§12/§13 写完后与 B9 shipped 实际不一致 | `low` | Phase 4 回填时 cross-link 每个 statement 到 B9 shipped code/test path |

### 7.2 约束与前提

- **技术前提**：
  - B8 `B8-final-closure.md` shipped 且 `after-foundations-final-closure.md` shipped（B9 的 RFC 要 cite 它们）
  - `smind-contexter-learnings.md` §9 + §10 shipped（B9 的 RFC 就是它们的正式 protocol-化版本）
  - root tests baseline 77/77 + 91/91 保持
- **运行时前提**：无特殊要求（B9 纯协议层升级）
- **组织协作前提**：owner Q1 (gate authorization) + Q4 (regression底线) 必答；Q2/Q3/Q5 有默认
- **上线 / 合并前提**：
  - 三包 version 一致性（CHANGELOG head == package.json version）
  - `pnpm -r run test` 全绿
  - `node --test test/*.test.mjs` 全绿（包括 3 个新契约 test）
  - `npm run test:cross` 全绿

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/rfc/nacp-core-1-3-draft.md` → 状态 `draft` → `owner-approved` → `frozen` 的 lifecycle
  - `docs/rfc/nacp-core-1-2-0.md`（B6 frozen）需要在 §1 加一个 "Next: 1.3" cross-reference
  - `docs/rfc/nacp-session-1-2-0.md` 同理
- 需要同步更新的说明文档 / README：
  - `packages/nacp-core/README.md`（若存在）加一段 "1.3 double-axis explicit" 说明
  - `packages/nacp-session/README.md` 同理
- 需要同步更新的测试说明：
  - 本 action-plan §8.1 规定的 3 个 root contract test 必须首次加入后更新 `test/README.md`（若有）

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `ls packages/nacp-core/src/{type-direction-matrix,error-body,naming-spec}.ts` → 三个新文件存在
  - `ls packages/nacp-session/src/upstream-context.ts` → 存在
  - `ls packages/session-do-runtime/src/tenant-plumbing.ts` → 存在
  - `grep '"version"' packages/{nacp-core,nacp-session,session-do-runtime}/package.json` → `1.3.0 / 1.3.0 / 0.3.0`
  - `grep -c "state.storage.put\|state.storage.get\|state.storage.delete" packages/session-do-runtime/src/do/nano-session-do.ts` → `0`
- **单元测试**：
  - 三包 `pnpm --filter ... test` 各自全绿
- **集成测试**：
  - `pnpm -r run test` 全绿
- **端到端 / 手动验证**：
  - 构造非法 envelope `{message_type: "tool.call.request", delivery_kind: "event"}` → `validateEnvelope()` reject with `NACP_TYPE_DIRECTION_MISMATCH`
  - 构造缺 `team_uuid` 的 session.start → `NanoSessionDO` ingress reject
- **回归测试**：
  - `node --test test/*.test.mjs` → 77 + 3 new = **80/80** green（若 B8 期间新增其他 root test，加总之）
  - `npm run test:cross` → 91+ green
  - `test/b7-round2-integrated-contract.test.mjs` (5 tests) 保持 pass（binding-F04 契约不受 B9 影响）
- **文档校验**：
  - B8 handoff memo §11/§12/§13 存在 + 可 grep 到 "B9" reference
  - `after-foundations-final-closure.md` §6 约束条目 >= 6

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后：

1. `docs/rfc/nacp-core-1-3-draft.md` 状态 `frozen`
2. nacp-core 1.3.0 + nacp-session 1.3.0 + session-do-runtime 0.3.0 shipped；三包 CHANGELOG head == package.json version
3. `NACP_TYPE_DIRECTION_MATRIX` + `NacpErrorBodySchema` + `LEGACY_ALIAS_REGISTRY` + `SessionStartInitialContextSchema` 全部 exported
4. `NanoSessionDO` ingress `tenantIngressVerify` 强制；raw `state.storage.*` grep count = 0
5. 3 个 root contract test 全绿
6. 全 regression: `pnpm -r run test` + `node --test test/*.test.mjs` + `npm run test:cross` 全绿
7. B8 handoff memo §11/§12/§13 回填完成 + link 到 B9 RFC + shipped code 有效
8. `after-foundations-final-closure.md` §6 追加约束生效
9. B8 code review (`docs/code-review/B8-docs-reviewed-by-opus.md`) §6 回应填完 + R1/R2/R3 标 `fixed`
10. B9 4 份 phase closure + `B9-final-closure.md` shipped
11. 本 action-plan §12 工作日志回填

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | matrix / error body / naming / initial_context / tenant plumbing 五类契约全部 shipped |
| 测试 | 3 root contract tests + 三包 unit tests 全绿；regression baseline 保持 |
| 文档 | RFC + 三包 CHANGELOG + B8 handoff §11/§12/§13 + after-foundations-final-closure §6 全部同步 |
| 风险收敛 | Q1/Q4 已 answered；Q2/Q3/Q5 按 default 或 owner 调整 |
| 可交付性 | **worker matrix charter 作者可以启动 Phase 0，只读 B8 handoff pack + B9 final closure** |

---

## 9. 执行后复盘关注点

> 执行结束后回填。

- **哪些 Phase 的工作量估计偏差最大**：`{RETRO_1}`
- **matrix entries 的枚举是否有遗漏**：`{RETRO_2}`
- **NanoSessionDO 改造的 8 处 state.storage 是否都真的换了**：`{RETRO_3}`
- **B8 handoff 回填的 3 章节是否被 worker matrix charter 真的消费**：`{RETRO_4}`（跨 phase 反馈，延后）
- **是否 owner 有追加 Q 进来**：`{RETRO_5}`

---

## 10. 结语

这份 action-plan 以 **"诚实冻结已达成的认知"** 为第一优先级，采用 **"RFC 先行 → 底层协议 → 上层协议 + runtime → 契约锁"** 的四段式推进，优先解决 **B1-B8 累积但未变现的三类共识**（NACP 双轴冗余 + tenant wrapper 未接线 + upstream memory 注入口空置），并把 **"zero breaking change + alias 兼容 + V1_BINDING_CATALOG 不动"** 作为主要约束。

整个计划完成后，nano-agent 的 protocol 层进入一个**"正交、显式、一致"**的稳定 contract surface，为 worker matrix 的 4 first-wave workers 提供不再带 tech debt 的起跑线。

**B9 不创造新能力；它让 B1-B8 的共识变成 packages 层的 shipped reality** —— 这是它唯一且充分的价值。

---

## 11. 关闭前提醒

- B9 是 after-foundations 阶段的**最后一个会修改 packages/ 的 phase**；worker matrix 从 B9 close 之后的 code baseline 起跑
- RFC 先行是**硬纪律**——不要在 Phase 2 边写 code 边调整 scope
- `NACP_VERSION = "1.3.0"` 的 bump 必须与 CHANGELOG 同步；两包 (nacp-core + nacp-session) 同步升；session-do-runtime 跟进到 0.3.0
- `V1_BINDING_CATALOG` 在 Phase 2 / Phase 3 任何点都**不得修改** —— charter §4.1 H 第 32 项
- B9 回填 B8 handoff §11/§12/§13 的时候，必须**把 B8 review R1/R2/R3 的 `fixed` 状态同步**到 `docs/code-review/B8-docs-reviewed-by-opus.md` §6；两文档双向引用

---

## 12. 实现者工作日志（2026-XX-XX 回填）

> 执行者：`{IMPLEMENTER}`
> 执行时间：`{DATE}`
> 执行范围：`Phase 1 – Phase 4 完整闭环`

### 12.1 执行总览

`{填}`

### 12.2 Phase-by-phase 工作记录

`{按 B5/B7 action-plan §12 模式填}`

### 12.3 新增 / 修改 artifacts 清单

`{按本 action-plan §1.5 目录树核对}`

### 12.4 验证结果

```text
{pnpm -r run test / node --test test/*.test.mjs / npm run test:cross output summary}
```

### 12.5 残余 blockers

`{填}`

### 12.6 对 B8 review 的 close-out

- R1 nacp-1.3 pre-requisite → `fixed via B9 shipped §11`
- R2 tenant plumbing checklist → `fixed via B9 shipped §12`
- R3 upstream orchestrator interface → `fixed via B9 shipped §13`
- R4 B8 review posture → `fixed by this phase 4 回填`
- R5/R6/R7 inline doc diff → `fixed`

### 12.7 最终 verdict

**{✅ / ⚠️} B9 closed —— worker matrix Phase 0 gate OPEN**
