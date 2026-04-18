# A1. Nano-Agent Contract & Identifier Freeze 执行计划

> 服务业务簇: `NACP / Contract Governance`
> 计划对象: `after-skeleton / Phase 0 / contract-and-identifier-freeze`
> 类型: `migration`
> 作者: `GPT-5.4`
> 时间: `2026-04-18`
> 执行序号: `A1 / 10`
> 上游前序: `-`
> 下游交接: `A2`, `A3`, `A4`
> 文件位置: `packages/nacp-core/**`, `packages/nacp-session/**`, `packages/llm-wrapper/**`, `README.md`, `docs/design/after-skeleton/P0-*.md`
> 关键仓库锚点: `packages/nacp-core/src/{envelope,version,compat/migrations}.ts`, `packages/nacp-session/src/{messages,ingress,websocket,frame}.ts`
> 参考 context / 对标来源: `context/codex/codex-rs/tools/src/tool_registry_plan.rs`, `context/claude-code/services/tools/toolExecution.ts`
> 关联设计 / 调研文档:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P0-contract-and-identifier-freeze.md`
> - `docs/design/after-skeleton/P0-contract-freeze-matrix.md`
> - `docs/design/after-skeleton/P0-identifier-law.md`
> - `docs/design/after-skeleton/P0-nacp-versioning-policy.md`
> - `docs/design/after-skeleton/PX-QNA.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

P0 的 design suite 已经完成，且 `PX-QNA.md` 中对 Phase 0 真正会改变执行路径的关键问题已经给出业主答案：`trace_uuid` 是唯一 canonical truth、Freeze Matrix 四档状态继续沿用、`stamped_by -> stamped_by_key` 与 `reply_to -> reply_to_message_uuid` 必须并入本轮迁移、当前 `1.0.0` 只是 provisional baseline，以及 **formal follow-up input family 必须纳入 Phase 0 的 `nacp-session` contract freeze**。这意味着 Phase 0 已不再缺“设计方向”，而是缺一份可以直接指导分批执行的落地计划。

当前代码现实也已经足够明确：`packages/nacp-core/src/envelope.ts` 仍以 `producer_id / consumer_hint / stamped_by / trace_id / stream_id / span_id / reply_to` 为 canonical 字段；`packages/nacp-core/src/version.ts` 仍把 `1.0.0` 写成当前/兼容版本；`packages/nacp-core/src/compat/migrations.ts` 仍是 placeholder；`packages/nacp-session/src/messages.ts` 只有 7 条已冻结 message types；`packages/nacp-session/src/websocket.ts` / `ingress.ts` / `frame.ts` 仍以 `trace_id / producer_id / stamped_by / stream_id` 参与 session reality。P0 action-plan 的目标，就是把这些“已经看清的问题”拆成可执行批次，而不是继续在 design 层重复讨论。

- **服务业务簇**：`NACP / Contract Governance`
- **计划对象**：`after-skeleton / Phase 0 / contract-and-identifier-freeze`
- **本次计划解决的问题**：
  - `nacp-core` / `nacp-session` 的 canonical contract 仍存在系统性的 legacy naming 漂移
  - `schema_version / compat / migration chain` 还没有进入真正可执行状态
  - Q8 已把 formal follow-up input family 提升为 Phase 0 in-scope，但仓内还没有对应的执行分批
- **本次计划的直接产出**：
  - 一份可执行的 P0 分批实施顺序与文件修改清单
  - 一条覆盖 core / session / direct consumers 的 rename + compat + tests 路线
  - 一套清晰的 P0 收口门禁：baseline、compat、tests、docs、review gate

---

## 1. 执行综述

### 1.1 总体执行方式

这份 action-plan 采用 **先 inventory/estimate，再 core baseline，再 session freeze widening，再 downstream adoption，最后 evidence/exit pack** 的方式推进。核心原则不是“全仓同时大改名”，而是 **先把 P0 的 contract baseline 和 versioning backbone 建起来，再把 `nacp-session` widened v1 surface（含 formal follow-up family）冻结进去，最后收口 direct consumers、tests 与 docs**。这样可以避免 rename、follow-up family freeze、compat chain 三件事互相打架。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Inventory & Migration Estimate | `S` | 列清 legacy field map、影响面、follow-up family micro-spec 决策输入 | `-` |
| Phase 2 | Core Baseline & Compat Backbone | `M` | 完成 `nacp-core` rename、version 口径、migration chain、core tests | `Phase 1` |
| Phase 3 | Session Freeze Completion | `M` | 完成 `nacp-session` rename，并把 formal follow-up family 纳入 frozen surface | `Phase 2` |
| Phase 4 | Downstream Adoption & Guardrail | `M` | 更新 direct consumers、translation zone 边界、review blocker / checklist | `Phase 3` |
| Phase 5 | Freeze Evidence & Exit Pack | `S` | 用 tests/docs/baseline cut 把 P0 正式收口 | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — Inventory & Migration Estimate**
   - **核心目标**：先把“要改什么、改到哪里、影响哪些测试、follow-up family 还差哪一个微决策”列清楚。
   - **为什么先做**：Q3 已明确要求 migration estimate 先行；没有这个 Phase，后面的大规模 rename 容易边改边发现新债。
2. **Phase 2 — Core Baseline & Compat Backbone**
   - **核心目标**：先把 `nacp-core` 这个上游 truth 改对，并把 versioning / compat 正式接通。
   - **为什么放在这里**：`nacp-session`、cross-package consumers 都是建立在 core envelope 上的；core 不先冻结，后续都是浮动目标。
3. **Phase 3 — Session Freeze Completion**
   - **核心目标**：把 `nacp-session` 从“当前 7 kinds reality + renamed frame/context”推进到“ widened v1 surface + formal follow-up family frozen”。
   - **为什么放在这里**：Q8 已改变 Phase 0 边界，follow-up family 必须在这里进入 `nacp-session` 真相层，而不能留给 runtime 私造。
4. **Phase 4 — Downstream Adoption & Guardrail**
   - **核心目标**：把 direct consumers、translation zone 例外、review blocker 一起收口，防止 law 只停在 core/session 内。
   - **为什么放在这里**：只有 core/session 真相层稳定后，才能准确判断哪些 consumer 应立即跟进、哪些属于后续 Phase 才接。
5. **Phase 5 — Freeze Evidence & Exit Pack**
   - **核心目标**：把 P0 从“文档上说完成”变成“baseline / compat / tests / docs / checklist 都闭合”。
   - **为什么放在这里**：P0 的价值不只是改字段名，而是产出后续所有 Phase 可以依赖的 owner-aligned baseline。

### 1.4 执行策略说明

- **执行顺序原则**：`先上游 canonical truth，再下游 consumer；先 rename/migration，再 widened session family；先 package-local tests，再 cross-package regression`
- **风险控制原则**：`先做 migration estimate；compat layer 吸收 retired aliases；禁止 runtime 私造 follow-up wire；provider/raw IDs 只留在 translation zone`
- **测试推进原则**：`每个 Phase 先修最近的 package tests；Phase 5 再做 typecheck/build/test/cross-test 总收口`
- **文档同步原则**：`matrix / identifier law / versioning policy / README / version 注释 / action-plan 必须在同一口径下收口`

### 1.5 本次 action-plan 影响目录树

```text
contract-and-identifier-freeze
├── packages/nacp-core
│   ├── src/envelope.ts
│   ├── src/version.ts
│   ├── src/compat/migrations.ts
│   └── test/{envelope,version,compat,transport,messages,tenancy}/*.ts
├── packages/nacp-session
│   ├── src/messages.ts
│   ├── src/frame.ts
│   ├── src/ingress.ts
│   ├── src/session-registry.ts
│   ├── src/websocket.ts
│   └── test/{messages,frame,ingress,websocket,integration}/*.ts
├── packages/llm-wrapper
│   └── src/adapters/openai-chat.ts
├── docs
│   ├── action-plan/after-skeleton/A1-contract-and-identifier-freeze.md
│   ├── design/after-skeleton/P0-*.md
│   └── README.md
└── root
    └── package.json / test:cross path
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 对 `nacp-core` canonical envelope 执行 P0 rename batch：`producer_id / consumer_hint / stamped_by / trace_id / stream_id / span_id / reply_to`
- **[S2]** 为 `nacp-core` 建立真实的 versioning/compat backbone：`provisional baseline` 口径、migration chain、compat tests
- **[S3]** 对 `nacp-session` 执行 frame/context rename，并把 **formal follow-up input family** 冻结进 session profile
- **[S4]** 更新 direct consumers / package tests / README / P0 docs，使 P0 baseline 可以被后续 Phase 直接消费
- **[S5]** 明确 translation-zone exception 与 review blocker，防止 canonical code 新增非法 `*_id`

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** Trace substrate benchmark / P1 decision memo：属于下一份 action-plan
- **[O2]** `TraceEventBase.traceUuid` 的 observability 落地：Q6 已确认，但属于 P2 action-plan 主体
- **[O3]** formal follow-up family 之外的 queue / replace / merge / approval-aware 调度语义
- **[O4]** public API / frontend contract / business DDL / full fake bash / full context compression

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `core.header / authority / trace / control` rename | `in-scope` | P0 最直接的 canonical drift 就在这些 section | Phase 0 完成后仅以 breaking change 方式重评 |
| `formal follow-up / multi-round input family` | `in-scope` | Q8 已明确要求纳入 P0 的 `nacp-session` contract freeze | 在 Phase 3 coding 前确认最终 message shape |
| follow-up queue / replace / merge policy | `out-of-scope` | 这是 runtime/UX 调度语义，不应混进 P0 freeze | P3 / 下一阶段 session design 重评 |
| `TraceEventBase.traceUuid` | `depends-on-phase` | Q6 已确认方向，但实现责任属于 P2 observability foundation | P2 action-plan 启动时执行 |
| provider raw `tool_call_id` | `out-of-scope` | translation zone 可保留 foreign ID，不进入 P0 canonical rename | 仅在 adapter redesign 时重评 |
| frozen baseline 最终版本号（建议 `1.1.0`） | `depends-on-decision` | Q4 只冻结了 provisional baseline 口径，最终 cut tag 仍需确认 | P0 Phase 5 baseline cut 前拍板 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Legacy Field Inventory | `update` | `packages/nacp-core/src/envelope.ts`, `packages/nacp-session/src/{messages,frame,ingress,session-registry,websocket}.ts`, related tests | 列清所有 P0 rename / widen surface 的真实影响面 | `medium` |
| P1-02 | Phase 1 | Migration Estimate & Batch Map | `add` | `docs/action-plan/after-skeleton/A1-contract-and-identifier-freeze.md` | 给 rename、compat、tests、docs 建立明确批次 | `low` |
| P1-03 | Phase 1 | Follow-up Family Micro-Spec Prep | `add` | `packages/nacp-session/src/messages.ts`, `session-registry.ts`, `test/messages.test.ts` | 在编码前收敛 formal follow-up family 的最小 frozen shape | `high` |
| P2-01 | Phase 2 | Core Schema Rename | `update` | `packages/nacp-core/src/envelope.ts` | 把 core canonical field suffix 收敛到 owner law | `high` |
| P2-02 | Phase 2 | Versioning & Compat Backbone | `update` | `packages/nacp-core/src/version.ts`, `src/compat/migrations.ts`, `test/{version,compat}.ts` | 让 provisional baseline 与 migration chain 变成真实执行件 | `high` |
| P2-03 | Phase 2 | Core Test & Schema Sync | `update` | `packages/nacp-core/test/**`, `packages/nacp-core/package.json`, `scripts/{export-schema,gen-registry-doc}.ts` | 用 tests/schema/docs 证明 core baseline 已稳定 | `medium` |
| P3-01 | Phase 3 | Session Message Family Widening | `update` | `packages/nacp-session/src/messages.ts`, `session-registry.ts`, `index.ts`, tests | 把 formal follow-up family 正式补进 session profile | `high` |
| P3-02 | Phase 3 | Session Frame & Context Rename | `update` | `packages/nacp-session/src/{frame,ingress,websocket}.ts`, integration tests | 完成 `stream_id / trace_id / producer_id / stamped_by` 的 session-level rename | `high` |
| P3-03 | Phase 3 | Session Validation / Registry / Integration Sync | `update` | `packages/nacp-session/test/**` | 让 widened session profile 在 phase/role/ingress/replay tests 中闭合 | `medium` |
| P4-01 | Phase 4 | Direct Consumer Sweep | `update` | `packages/llm-wrapper/**`, direct NACP consumers, root tests | 修复 P0 rename 对 direct consumers 的编译/契约影响 | `medium` |
| P4-02 | Phase 4 | Translation-Zone Guard | `update` | `packages/llm-wrapper/src/adapters/openai-chat.ts`, review checklist/docs | 确保 foreign IDs 不泄漏到 canonical model | `medium` |
| P4-03 | Phase 4 | Review Blocker & Checklist Sync | `update` | `README.md`, `docs/design/after-skeleton/P0-*.md` | 让 naming law 变成执行纪律，而不是只留在 prose | `low` |
| P5-01 | Phase 5 | Whole-Plan Test Gate | `update` | `packages/nacp-core`, `packages/nacp-session`, root `test:cross` | 用 typecheck/build/test 收口 P0 baseline | `medium` |
| P5-02 | Phase 5 | Baseline Cut & Exit Pack | `update` | `docs/design/after-skeleton/P0-*.md`, `README.md`, version notes | 产出可供 P1/P2/P3 消费的 owner-aligned baseline 说明 | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Inventory & Migration Estimate

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Legacy Field Inventory | 扫描 core/session 及其 tests 中的 legacy field；把 canonical、translation-zone、future-phase 三类分开 | `packages/nacp-core/src/envelope.ts`, `packages/nacp-session/src/**`, `packages/nacp-core/test/**`, `packages/nacp-session/test/**` | 得到完整字段映射与影响文件清单 | `rg` 扫描 + 手工归类 | 所有 P0 目标字段都有 source->target map，且不把 provider raw IDs 误计入 canonical rename |
| P1-02 | Migration Estimate & Batch Map | 把 rename、compat、tests、docs、consumer sweep 拆成 Phase 2-5 的执行批次 | 本 action-plan 文档 | 批次顺序固定，避免后面边改边扩 scope | 文档自审 | 每个批次都有输入/输出/门禁，不再依赖口头顺序 |
| P1-03 | Follow-up Family Micro-Spec Prep | 基于 Q8 与 context/ agent-cli 参考，收敛 formal follow-up family 的最小 message shape、body 范围、phase/role gate 输入 | `packages/nacp-session/src/messages.ts`, `session-registry.ts`, `test/messages.test.ts` | 为 Phase 3 coding 准备可冻结的最小协议说明 | 设计核对 + 测试草案核对 | 能回答“新增几条 message、谁可 produce、何时允许、body 最小字段是什么” |

### 4.2 Phase 2 — Core Baseline & Compat Backbone

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Core Schema Rename | 按 identifier law 重命名 header/authority/trace/control 字段；保留 `refs` / `extra` 现状 | `packages/nacp-core/src/envelope.ts` | core canonical schema 与 owner law 对齐 | `pnpm --filter @nano-agent/nacp-core test` | `producer_id / consumer_hint / stamped_by / trace_id / stream_id / span_id / reply_to` 不再以 canonical 字段名出现 |
| P2-02 | Versioning & Compat Backbone | 更新 `version.ts` 注释和口径；实现 `migrate_v1_0_to_v1_1`；把 retired aliases 限定在 compat layer | `packages/nacp-core/src/version.ts`, `src/compat/migrations.ts`, `test/version.test.ts`, `test/compat.test.ts` | provisional baseline、frozen baseline、compat floor、migration chain 全部成形 | `pnpm --filter @nano-agent/nacp-core test` | `compat.test.ts` 不再只验证 placeholder；旧 raw payload 可经 migration 进入当前 parse |
| P2-03 | Core Test & Schema Sync | 更新 envelope/transport/messages/tenancy tests；如有 schema/docs build，同步刷新说明 | `packages/nacp-core/test/**`, `packages/nacp-core/package.json`, generated schema/docs | core baseline 在 tests 与文档产物里一致 | `pnpm --filter @nano-agent/nacp-core typecheck`, `build`, `test`, `build:schema`, `build:docs` | 测试、schema、registry docs 全部使用新 canonical naming |

### 4.3 Phase 3 — Session Freeze Completion

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | Session Message Family Widening | 把 formal follow-up family 正式补入 `SESSION_MESSAGE_TYPES`、`SESSION_BODY_SCHEMAS`、`SESSION_BODY_REQUIRED` 与 `SESSION_ROLE_REQUIREMENTS` | `packages/nacp-session/src/messages.ts`, `session-registry.ts`, `index.ts`, `test/messages.test.ts`, `test/session-registry.test.ts` | widened v1 surface 进入 `nacp-session` 真相层 | `pnpm --filter @nano-agent/nacp-session test` | follow-up family 不再只存在于 design/README，而是被 session package 正式冻结 |
| P3-02 | Session Frame & Context Rename | 完成 `stream_id -> stream_uuid`、`trace_id -> trace_uuid`、`producer_id -> producer_key`、`stamped_by -> stamped_by_key` 等 rename | `packages/nacp-session/src/frame.ts`, `ingress.ts`, `websocket.ts`, `index.ts` | session frame/context 与 P0 law 对齐 | `pnpm --filter @nano-agent/nacp-session test` | SessionContext、frame、normalized ingress、WS helper 不再传播 retired field names |
| P3-03 | Session Validation / Integration Sync | 更新 frame/ingress/websocket/replay/integration tests，确认 widened surface 与 rename 后的 phase/role legality 一致 | `packages/nacp-session/test/**` | session package 在 unit + integration 层闭合 | `pnpm --filter @nano-agent/nacp-session test`, `test:integration`, `typecheck` | tests 明确覆盖首轮 + follow-up family、role/phase gate、replay/ack/heartbeat 与 renamed frame/context |

### 4.4 Phase 4 — Downstream Adoption & Guardrail

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | Direct Consumer Sweep | 扫描并修复直接依赖 renamed fields 的包与 root cross tests | `packages/**`, root `test/**/*.test.mjs` | direct consumers 不再因 P0 rename 破坏编译/契约 | package tests + root cross test | 当前 workspace 内 direct consumers 均能消费新 naming |
| P4-02 | Translation-Zone Guard | 明确 `tool_call_id` 等 foreign IDs 只能留在 adapter-local raw type；禁止上渗到 canonical model | `packages/llm-wrapper/src/adapters/openai-chat.ts`, related canonical types/docs | provider naming 与 canonical naming 边界固定 | targeted package tests / typecheck | 能明确区分 “adapter raw” 与 “canonical internal” 两个命名层次 |
| P4-03 | Review Blocker & Checklist Sync | 把 P0 rename / widened family / versioning 结论回填到 README、P0 docs、review checklist | `README.md`, `docs/design/after-skeleton/P0-*.md` | naming law 与 baseline 口径形成 review gate | 文档核对 | 不再出现 README / design / tests 三方各说一套 |

### 4.5 Phase 5 — Freeze Evidence & Exit Pack

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | Whole-Plan Test Gate | 执行 core/session package tests、typecheck/build、root cross tests | `packages/nacp-core`, `packages/nacp-session`, root `package.json` | P0 baseline 具备最小证据闭环 | `pnpm --filter @nano-agent/nacp-core test`, `pnpm --filter @nano-agent/nacp-session test`, root `test:cross` | rename / compat / widened family 在现有 test surface 下全部通过 |
| P5-02 | Baseline Cut & Exit Pack | 明确 frozen baseline 注释、compat floor、migration checklist、docs sync 清单 | `version.ts`, `README.md`, `docs/design/after-skeleton/P0-*.md` | 产出后续 Phase 可依赖的 baseline cut 说明 | 文档核对 + fixture 核对 | P1/P2/P3 后续 action-plan 不再需要重新解释 P0 口径 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Inventory & Migration Estimate

- **Phase 目标**：把 P0 的真实改动面、测试影响面、follow-up family 最小补位范围一次性看清。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - 无
- **本 Phase 修改文件**：
  - `docs/action-plan/after-skeleton/A1-contract-and-identifier-freeze.md`
  - `packages/nacp-core/src/envelope.ts`
  - `packages/nacp-session/src/messages.ts`
  - `packages/nacp-session/src/session-registry.ts`
- **具体功能预期**：
  1. 给出完整的 legacy field inventory，分清 canonical rename、translation-zone exemption、future-phase items。
  2. 形成一份明确的 migration estimate，说明哪些文件/测试会被 P0 rename 打穿。
  3. 为 formal follow-up family 提供最小 micro-spec 输入，避免 Phase 3 coding 时临场拍脑袋。
- **具体测试安排**：
  - **单测**：无新增运行逻辑，以扫描与现有 tests 影响清单为主
  - **集成测试**：无
  - **回归测试**：确认现有 `nacp-core` / `nacp-session` tests 作为后续基线可复用
  - **手动验证**：人工核对字段映射是否覆盖 `stamped_by`、`reply_to`、`trace_id`、`stream_id`、`producer_id`
- **收口标准**：
  - P0 rename map 覆盖所有 Q1-Q4 / Q8 直接影响字段
  - P2-P5 的批次顺序不再含糊
  - formal follow-up family 的未决点被压缩到最少
- **本 Phase 风险提醒**：
  - 如果 inventory 漏掉 direct consumers，后续会在编译或 tests 里被动发现
  - 如果 follow-up family micro-spec 继续模糊，P3 会重新退化成设计讨论

### 5.2 Phase 2 — Core Baseline & Compat Backbone

- **Phase 目标**：先把 `nacp-core` 这个上游 canonical truth 变成 owner-aligned baseline。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - 视实现需要可新增 compat fixtures（如 `packages/nacp-core/test/fixtures/**`）
- **本 Phase 修改文件**：
  - `packages/nacp-core/src/envelope.ts`
  - `packages/nacp-core/src/version.ts`
  - `packages/nacp-core/src/compat/migrations.ts`
  - `packages/nacp-core/test/**`
- **具体功能预期**：
  1. core canonical schema 中的 identity / key / reply 字段全部符合 `identifier-law.md`
  2. `1.0.0` 的 provisional baseline 口径与 `migrate_v1_0_to_v1_1` 真实接通
  3. compat tests 能证明 retired aliases 只在 compat layer 生存，而不再进入 canonical parse
- **具体测试安排**：
  - **单测**：`packages/nacp-core/test/envelope.test.ts`, `version.test.ts`, `compat.test.ts`, `messages/messages.test.ts`
  - **集成测试**：如现有无独立 integration 目录，则以 transport/tenancy tests 作为协议交叉校验
  - **回归测试**：`pnpm --filter @nano-agent/nacp-core typecheck`, `build`, `test`
  - **手动验证**：检查 schema/docs 生成产物不再使用 retired field names
- **收口标准**：
  - `producer_id / consumer_hint / stamped_by / trace_id / stream_id / span_id / reply_to` 不再是 core canonical 字段名
  - `compat.test.ts` 有真实 migration evidence，不再只对 placeholder 做 smoke
  - `version.ts` 注释与 design / README 的 provisional baseline 口径一致
- **本 Phase 风险提醒**：
  - 如果 core rename 与 compat 一起改得不完整，后续 session 与 consumers 会进入双语状态
  - 如果 baseline version 说明不清，外部读者会继续把当前 `1.0.0` 当 frozen truth

### 5.3 Phase 3 — Session Freeze Completion

- **Phase 目标**：把 `nacp-session` 从“当前 reality”升级成 widened v1 session profile truth。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - 视需要新增 follow-up family 相关 tests / fixtures
- **本 Phase 修改文件**：
  - `packages/nacp-session/src/messages.ts`
  - `packages/nacp-session/src/session-registry.ts`
  - `packages/nacp-session/src/frame.ts`
  - `packages/nacp-session/src/ingress.ts`
  - `packages/nacp-session/src/websocket.ts`
  - `packages/nacp-session/src/index.ts`
  - `packages/nacp-session/test/**`
- **具体功能预期**：
  1. formal follow-up family 进入 `SESSION_MESSAGE_TYPES` / `SESSION_BODY_SCHEMAS` / role/phase registry
  2. session frame / ingress / websocket helper 使用 `trace_uuid / stream_uuid / producer_key / stamped_by_key`
  3. widened v1 surface 与现有 replay / ack / heartbeat / role/phase gate 之间没有新的双真相
- **具体测试安排**：
  - **单测**：`messages.test.ts`, `frame.test.ts`, `ingress.test.ts`, `session-registry.test.ts`, `websocket.test.ts`
  - **集成测试**：`test/integration/{ack-window,heartbeat-timeout,reconnect-replay}.test.ts`
  - **回归测试**：`pnpm --filter @nano-agent/nacp-session typecheck`, `test`, `test:integration`
  - **手动验证**：核对 follow-up family 没有被实现成 runtime 私有消息路径
- **收口标准**：
  - `formal follow-up / multi-round input family` 已从 Directional Only 升级为真正 frozen session surface
  - SessionContext 与 frame/ingress/websocket 不再传播 retired trace/producer/stamp/stream field names
  - session tests 能清楚表达首轮与 follow-up 这两类 ingress 的 phase/role legality
- **本 Phase 风险提醒**：
  - 如果 follow-up family shape 未先拍板，P3 很容易重新陷入 scope 膨胀
  - 如果 queue semantics 被不小心混进来，会打破“P0 只冻协议，不冻调度语义”的边界

### 5.4 Phase 4 — Downstream Adoption & Guardrail

- **Phase 目标**：让 P0 freeze 不止停在 core/session 内部，而是形成 direct consumer 和 review 层的真实纪律。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - 无强制新增
- **本 Phase 修改文件**：
  - `packages/llm-wrapper/src/adapters/openai-chat.ts`
  - direct NACP consumers
  - `README.md`
  - `docs/design/after-skeleton/P0-*.md`
- **具体功能预期**：
  1. direct consumers 不再依赖 retired field names
  2. foreign/provider IDs 被明确圈在 translation zone，不再被误当 internal canonical naming
  3. naming law 进入 README / review checklist / matrix 说明层，成为执行纪律
- **具体测试安排**：
  - **单测**：direct consumer 相关包的现有 tests
  - **集成测试**：root `test:cross`
  - **回归测试**：所有受影响 package 的 typecheck/build
  - **手动验证**：人工检查 `tool_call_id` 等字段只停留在 adapter-local raw type
- **收口标准**：
  - P0 rename 不再只影响局部 package
  - translation zone 与 canonical domain 的边界有文档、有代码、有 review 口径
  - README / design / tests 的术语不再冲突
- **本 Phase 风险提醒**：
  - 如果 direct consumers 没扫全，P0 baseline 仍会在后续 action-plan 中反复炸出 compile breaks
  - 如果 review blocker 只写在 design 文档里，执行阶段仍可能新增新的非法 `_id`

### 5.5 Phase 5 — Freeze Evidence & Exit Pack

- **Phase 目标**：把 P0 正式封箱成后续 Phase 可以直接继承的 baseline cut。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - 视需要新增 migration checklist / fixture corpus
- **本 Phase 修改文件**：
  - `README.md`
  - `docs/design/after-skeleton/P0-*.md`
  - `packages/nacp-core/src/version.ts`
- **具体功能预期**：
  1. 全部 package tests / cross tests 通过，P0 rename 与 widened family 不再是“理论完成”
  2. baseline cut 说明能清楚解释 provisional baseline、compat floor、frozen cut 与 deferred surfaces
  3. P1/P2/P3 后续 action-plan 不需要重新解释 P0 contract 口径
- **具体测试安排**：
  - **单测**：core/session 全量 tests
  - **集成测试**：session integration + root cross tests
  - **回归测试**：受影响 package 的 build/typecheck
  - **手动验证**：README / P0 docs / version 注释 / generated schema 口径一致
- **收口标准**：
  - P0 baseline 有完整 exit pack
  - compat 与 docs 都能解释“为什么现在可以进入后续 Phase”
  - Phase 0 的 contract freeze 不再依赖口头背景说明
- **本 Phase 风险提醒**：
  - 如果只跑 package-local tests 不跑 cross tests，P0 baseline 仍可能在跨包路径上漏水
  - 如果 baseline cut 注释不完整，后续团队仍会误读 `1.0.0`

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 1 / Phase 3`
- **为什么必须确认**：Q8 已确认 formal follow-up family 必须进入 Phase 0，但当前 design 仍没有冻结“最小 v1 shape 到底是一条消息还是多条消息、命名是什么、body 最小字段是什么”。这会直接改变 `messages.ts`、`session-registry.ts`、`ingress.ts` 与 tests 的实现路径。
- **当前建议 / 倾向**：`建议先冻结一条最小的 client-produced follow-up input message，使 widened v1 contract 成立，但不要把 queue / replace / merge 语义一起塞进去`
- **Q**：`formal follow-up input family 的最小 frozen shape，是否确认采用“单条 follow-up input message + 最小 string/context body”的路线？如果确认，canonical message name 倾向哪一个？`
- **A**：`待确认`

#### Q2

- **影响范围**：`Phase 2 / Phase 5`
- **为什么必须确认**：Q4 已确认“当前 1.0.0 只是 provisional baseline”，但 action-plan 在真正切 baseline 时仍需要一个明确的 frozen version label；否则 compat tests、docs 注释与 README 会在最后一步继续模糊。
- **当前建议 / 倾向**：`建议把 Phase 0 结束后的 first frozen baseline 记为 1.1.0`
- **Q**：`Phase 0 baseline cut 时，是否正式采用 1.1.0 作为 first owner-aligned frozen baseline？`
- **A**：`待确认`

### 6.2 问题整理建议

- 优先回答 **Q1**，因为它会直接影响 `nacp-session` widened surface 的实现方式
- **Q2** 虽不影响早期 rename，但会影响 Phase 5 的收口与 compat 说明
- 其余问题若不改变本 action-plan 的批次顺序，可在执行中自然收敛，不必提前升级成 owner 问题

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| migration estimate 不完整 | direct consumers / tests 遗漏会导致后续边改边炸 | `high` | Phase 1 先做全量 inventory，再进入 schema rename |
| follow-up family shape 继续模糊 | Q8 已改边界，但未决 shape 会拖慢 P3 | `high` | 在 Phase 1 就准备 micro-spec，并要求 Q1 尽早拍板 |
| compat layer 变成长期双语状态 | 若 retired aliases 直接混入 canonical parse，会破坏 versioning policy | `high` | 强制 aliases 只存在于 `compat/migrations.ts` 或 adapter-local raw types |
| docs/test 口径不同步 | README、design、tests 三方不一致会重复制造 P0 歧义 | `medium` | Phase 4-5 把 docs sync 与 test gate 作为独立工作项收口 |

### 7.2 约束与前提

- **技术前提**：`P0 只处理 contract surface、identifier law、versioning/compat，不提前实现 P2 trace carrier 与 P3 runtime orchestration`
- **运行时前提**：`session-do-runtime 不得先发明 private follow-up wire；provider raw IDs 只允许留在 translation zone`
- **组织协作前提**：`Freeze Matrix 四档状态继续作为唯一治理语言；P0 design suite 视为 owner-aligned baseline`
- **上线 / 合并前提**：`core/session package tests、必要的 build/typecheck、root cross tests 与 docs sync 必须一起过线`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/after-skeleton/P0-contract-and-identifier-freeze.md`
  - `docs/design/after-skeleton/P0-contract-freeze-matrix.md`
  - `docs/design/after-skeleton/P0-identifier-law.md`
  - `docs/design/after-skeleton/P0-nacp-versioning-policy.md`
- 需要同步更新的说明文档 / README：
  - `README.md`
- 需要同步更新的测试说明：
  - `packages/nacp-core/test/**`
  - `packages/nacp-session/test/**`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 使用代码搜索确认 targeted canonical packages 不再新增非法 `*_id` 命名
  - 确认 `formal follow-up input family` 已进入 `nacp-session` truth，而不是 runtime 私有消息
- **单元测试**：
  - `pnpm --filter @nano-agent/nacp-core test`
  - `pnpm --filter @nano-agent/nacp-session test`
- **集成测试**：
  - `pnpm --filter @nano-agent/nacp-session test:integration`
  - root `test:cross`
- **端到端 / 手动验证**：
  - 手工检查 provisional baseline / compat floor / frozen baseline 注释与 README/P0 docs 完全一致
  - 手工检查 provider raw IDs 未穿透到 canonical internal model
- **回归测试**：
  - `pnpm --filter @nano-agent/nacp-core typecheck && pnpm --filter @nano-agent/nacp-core build`
  - `pnpm --filter @nano-agent/nacp-session typecheck && pnpm --filter @nano-agent/nacp-session build`
- **文档校验**：
  - matrix、identifier law、versioning policy、README、action-plan 对 P0 边界的说法必须一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `nacp-core` 与 `nacp-session` 的 canonical contract naming 已与 owner law 对齐。
2. retired aliases 只存在于 compat layer 或 adapter-local raw types，不再污染 canonical parse。
3. formal follow-up input family 已正式进入 `nacp-session` 的 frozen surface。
4. core/session/direct consumers 的 tests、typecheck、build 与 root cross tests 全部通过。
5. P0 baseline、compat、docs、review gate 已形成后续 Phase 可直接依赖的 exit pack。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `core rename + compat + versioning + session widened family + direct consumer adoption` 全部落地 |
| 测试 | `nacp-core` / `nacp-session` / root cross-test 形成最小证据闭环 |
| 文档 | P0 design docs、README、version 注释、action-plan 口径一致 |
| 风险收敛 | 不再存在 runtime 私造 follow-up wire、canonical code 新增非法 `*_id`、长期双语 alias |
| 可交付性 | Phase 1-7 后续 action-plan 可以直接把 P0 作为 owner-aligned baseline 使用 |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

这份 action-plan 以 **先把 P0 变成真实 baseline** 为第一优先级，采用 **先上游 canonical truth、再 widened session contract、再下游 adoption、最后 evidence/exit pack** 的推进方式，优先解决 **legacy naming 漂移、compat placeholder、formal follow-up family 无执行路径** 这三类问题，并把 **不提前进入 P2/P3/Pnext 的运行时/产品语义** 作为主要约束。整个计划完成后，`NACP / Contract Governance` 应达到 **字段命名、versioning、compat、session widened surface 都可被后续 Phase 直接消费** 的状态，从而为后续的 **trace-first observability、session edge closure、external seam closure 与 context/storage evidence** 提供稳定基础。
