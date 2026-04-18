# A3. Nano-Agent Trace-first Observability Foundation 执行计划

> 服务业务簇: `Observability / Trace Law`
> 计划对象: `after-skeleton / Phase 2 / trace-first-observability-foundation`
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-18`
> 执行序号: `A3 / 10`
> 上游前序: `A1`, `A2`
> 下游交接: `A4`, `A5`, `A7`
> 文件位置: `packages/nacp-core/src/observability/**`, `packages/eval-observability/**`, `packages/session-do-runtime/**`, `packages/{hooks,llm-wrapper,capability-runtime,workspace-context-artifacts}/**`, `test/*.test.mjs`
> 关键仓库锚点: `packages/nacp-core/src/observability/envelope.ts`, `packages/eval-observability/src/{trace-event,audit-record}.ts`, `packages/session-do-runtime/src/traces.ts`
> 参考 context / 对标来源: `context/claude-code/services/tools/toolExecution.ts`, `context/claude-code/services/compact/microCompact.ts`, `context/mini-agent/mini_agent/logger.py`
> 关联设计 / 调研文档:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
> - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
> - `docs/design/after-skeleton/P2-observability-layering.md`
> - `docs/design/after-skeleton/PX-QNA.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

Phase 2 的核心不是“再加一些日志”，而是把 `trace_uuid` 从 owner 决策和设计语言，真正推进到 runtime 第一事实。Q6 和 Q7 已经把边界冻结：`TraceEventBase` 必须显式携带 `traceUuid`，而 observability 讨论必须统一用 Anchor / Durable / Diagnostic 三层语言。当前仓里的问题也很集中：`packages/nacp-core/src/observability/envelope.ts` 里 `trace_uuid` 仍只在 alert payload 上以 optional exception 形式出现；`packages/eval-observability/src/trace-event.ts` 只有 `sessionUuid / teamUuid / turnUuid`，没有 `traceUuid`；`packages/session-do-runtime/src/traces.ts` 仍产出 `turn.started / turn.completed` 这类与当前 event reality 漂移的名字，而且没有 trace carrier。换句话说，基础设施骨架已经有了，但 trace-first semantics 还没有闭合。

这份 action-plan 的任务，就是把 **trace law、base contract、builder/codec、anchor/recovery、cross-package instrumentation、tests/docs closure** 拆成可执行批次。它的目标不是抢跑 P5/P6，也不是直接搭 query 平台，而是让 P3 以及后续所有 runtime 设计都不再需要争论“trace 到底是不是第一事实”。

- **服务业务簇**：`Observability / Trace Law`
- **计划对象**：`after-skeleton / Phase 2 / trace-first-observability-foundation`
- **本次计划解决的问题**：
  - `trace_uuid` 虽已是 canonical naming，但仍未成为跨包 trace carrier 与 runtime law
  - eval / session / core 当前在 eventKind、trace fields、layer 语言上仍存在真实漂移
  - checkpoint/restore/alarm/replay 的 recovery seam 还没有明确的 trace anchor 与错误分类
- **本次计划的直接产出**：
  - 一套 trace-first base contract：`TraceEventBase`、alert exception policy、builder/codec 对齐
  - 一条最小可执行的 anchor / recovery path
  - 一份覆盖 core/eval/session/邻接包的 instrumentation 与测试收口计划

---

## 1. 执行综述

### 1.1 总体执行方式

这份 action-plan 采用 **先冻结 trace law 与 base contract，再收敛 builders/codec/layer，再补 anchor/recovery，之后做跨包 instrumentation sweep，最后用 tests/docs/evidence 封箱** 的方式推进。核心原则是 **先统一“什么叫 trace truth”，再统一“谁来携带它、何时能恢复它、哪些包必须产出它”**，而不是让每个包各自补一点 trace 字段。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Trace Law & Base Contract Freeze | `M` | 升级 TraceEvent base、alert exception policy、基础 trace law 矩阵 | `Phase 1 substrate decision` |
| Phase 2 | Builder / Codec / Layer Convergence | `M` | 收敛 event names、audit codec、classification、promotion registry、session trace builders | `Phase 1` |
| Phase 3 | Anchor & Recovery Wiring | `L` | 让 ingress/checkpoint/restore/alarm 具备最小 trace anchor 与 recovery path | `Phase 2` |
| Phase 4 | Cross-package Instrumentation Sweep | `L` | 把 llm/hook/tool/compact/storage/context seams 纳入 trace-first catalog | `Phase 3` |
| Phase 5 | Evidence, Tests & Doc Closure | `M` | 用 tests、cross-package contracts、docs 与 failure replay 把 Phase 2 封箱 | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — Trace Law & Base Contract Freeze**
   - **核心目标**：明确 accepted internal work 的 trace law，并把 `TraceEventBase` 升级成真正的 trace carrier。
   - **为什么先做**：没有这一步，后续 builder 和 recovery 只能继续围绕 `sessionUuid` 打补丁。
2. **Phase 2 — Builder / Codec / Layer Convergence**
   - **核心目标**：让 eval/session/core 至少对 event names、layers、audit codec 说同一种语言。
   - **为什么放在这里**：当前 `turn.started / turn.completed` 与 `turn.begin / turn.end` 的漂移，就是典型的 phase-2 before phase-3 问题。
3. **Phase 3 — Anchor & Recovery Wiring**
   - **核心目标**：把 trace law 从“字段存在”推进到“丢了也能恢复或明确失败”。
   - **为什么放在这里**：builder/codec 不先收敛，recovery path 会围绕错误 event shape 建起来。
4. **Phase 4 — Cross-package Instrumentation Sweep**
   - **核心目标**：把 hooks / llm-wrapper / capability-runtime / workspace-context-artifacts 接进同一套 trace catalog。
   - **为什么放在这里**：只有核心 carrier 和 recovery 先成形，跨包 instrumentation 才不会散掉。
5. **Phase 5 — Evidence, Tests & Doc Closure**
   - **核心目标**：用 contract tests、failure replay、docs sync 证明 trace-first foundation 不只是局部包自洽。
   - **为什么放在这里**：Phase 2 的价值在于后续所有 phase 都可以信任它，因此必须单独有 closure pack。

### 1.4 执行策略说明

- **执行顺序原则**：`先 trace law/base contract，再 builders/recovery，再 instrumentation sweep，再 cross-package closure`
- **风险控制原则**：`不把 service-binding propagation 抢到 P2；不把 query/dashboard/DDL 混进 foundation；recovery 必须显式失败而不是 silent fallback`
- **测试推进原则**：`先修 eval + session 包局部 truth，再扩到 root cross-package contracts 与 failure replay`
- **文档同步原则**：`P2 design、P2 layering、PX-QNA、相关 package public surface 与 root contract tests 必须在同一口径下更新`

### 1.5 本次 action-plan 影响目录树

```text
trace-first-observability-foundation
├── packages/nacp-core
│   └── src/observability/envelope.ts
├── packages/eval-observability
│   ├── src/{trace-event,audit-record,classification,durable-promotion-registry,inspector,timeline,index}.ts
│   ├── test/{trace-event,audit-record,classification,durable-promotion-registry,inspector}.test.ts
│   └── test/integration/{failure-replay,session-timeline,ws-inspector-http-fallback,storage-placement-evidence}.test.ts
├── packages/session-do-runtime
│   ├── src/{traces,checkpoint,alarm,orchestration,turn-ingress,do/nano-session-do}.ts
│   └── test/{traces,checkpoint,alarm}.test.ts
│       test/integration/{checkpoint-roundtrip,start-turn-resume,ws-http-fallback,graceful-shutdown}.test.ts
├── packages/{hooks,llm-wrapper,capability-runtime,workspace-context-artifacts}
│   └── src/**/*trace-related seams
└── root
    └── test/{observability-protocol-contract,hooks-protocol-contract,llm-wrapper-protocol-contract,session-do-runtime-contract,capability-toolcall-contract,workspace-context-artifacts-contract}.test.mjs
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 冻结 trace law：accepted internal work 无 `trace_uuid` 即非法；平台级 alert 例外必须被显式限制
- **[S2]** 升级 `TraceEventBase` 与相邻 carrier：至少补齐 `traceUuid`、source metadata、必要的 message/anchor hints
- **[S3]** 收敛 eval/core/session 的 builder / codec / event/layer reality，消灭 `turn.started` / `turn.completed` 这类漂移
- **[S4]** 定义并落最小 anchor / recovery path：ingress、checkpoint、restore、alarm、replay 至少能恢复或显式失败
- **[S5]** 为 llm/hook/tool/compact/storage/context seams 冻结 instrumentation catalog，并用 cross-package tests 守住

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** D1 query schema、public observability API、dashboard/exporter
- **[O2]** P4 的 service-binding trace propagation 真正落地
- **[O3]** P5 的 deploy-shaped verification 与真实 Cloudflare smoke
- **[O4]** P6 的 storage/context calibration verdict 与真实 placement evidence 闭环

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `TraceEventBase.traceUuid` | `in-scope` | Q6 已明确这是 Phase 2 成立的前提 | Phase 2 完成后仅以 breaking contract 方式重评 |
| `NacpAlertPayload.trace_uuid` 例外政策 | `in-scope` | alert exception rule 是 P2 的明确产物之一 | Phase 2 完成后只在 alert taxonomy 变更时重评 |
| `turn.started / turn.completed` -> current reality 收敛 | `in-scope` | 当前 session/eval 漂移会直接破坏 trace evidence | Phase 2 Phase 2-3 期间完成 |
| service-binding 跨 worker trace propagation | `out-of-scope` | 这是 P4 external seam closure 的职责 | Phase 4 action-plan 启动时重评 |
| local failure replay / recovery probe | `in-scope` | P2 至少要证明 recovery law 不是空话 | Phase 5/6 可在 deploy/evidence 环境继续扩展 |
| D1 query/index | `out-of-scope` | P1 已把 D1 固定为 deferred query seam | 只有未来独立 memo 通过后重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Trace Law Matrix | `update` | `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`, `packages/nacp-core/src/observability/envelope.ts` | 先把 accepted internal trace law 与 alert 例外写死 | `high` |
| P1-02 | Phase 1 | TraceEvent Base Upgrade | `update` | `packages/eval-observability/src/trace-event.ts`, `src/index.ts`, tests | 让 `TraceEventBase` 变成真正的 trace carrier | `high` |
| P1-03 | Phase 1 | Alert Exception Guard | `update` | `packages/nacp-core/src/observability/envelope.ts`, related docs/tests | 限制 `trace_uuid` optional 只属于 platform-level alerts | `medium` |
| P2-01 | Phase 2 | Audit Codec Convergence | `update` | `packages/eval-observability/src/audit-record.ts`, tests | 让 audit codec 明确携带/恢复 trace-first fields | `high` |
| P2-02 | Phase 2 | Layer & Promotion Sync | `update` | `packages/eval-observability/src/{classification,durable-promotion-registry}.ts`, tests | 把 Anchor/Durable/Diagnostic 语言映射到现有 implementation reality | `medium` |
| P2-03 | Phase 2 | Session Trace Builder Rename | `update` | `packages/session-do-runtime/src/traces.ts`, `test/traces.test.ts`, root `test/observability-protocol-contract.test.mjs` | 让 session trace builders 对齐 current event catalog 与 trace carrier | `high` |
| P3-01 | Phase 3 | Anchor Shape & Recovery Error Taxonomy | `add` | `packages/session-do-runtime/src/{checkpoint,traces,alarm}.ts`, `packages/eval-observability/src/replay.ts` | 定义最小 anchor 字段和恢复失败类型 | `high` |
| P3-02 | Phase 3 | Checkpoint / Restore / Alarm Wiring | `update` | `packages/session-do-runtime/src/{checkpoint,alarm,do/nano-session-do}.ts`, integration tests | 把 trace recovery 接到真实 lifecycle seams | `high` |
| P3-03 | Phase 3 | Ingress / Replay Recovery Guard | `update` | `packages/session-do-runtime/src/{turn-ingress,orchestration}.ts`, tests | 让 trace 丢失时能恢复或显式失败，不继续半坏状态 | `high` |
| P4-01 | Phase 4 | Instrumentation Catalog Sweep | `update` | `packages/{hooks,llm-wrapper,capability-runtime,workspace-context-artifacts}/src/**` | 把邻接包纳入统一 trace catalog | `medium` |
| P4-02 | Phase 4 | Cross-package Contract Expansion | `update` | root `test/*.test.mjs` | 用 root contract tests 守住 trace carrier 与 event/layer reality | `medium` |
| P5-01 | Phase 5 | Failure Replay & Recovery Evidence | `update` | `packages/eval-observability/test/integration/failure-replay.test.ts`, session integration tests | 用明确场景证明 recovery law 成立 | `high` |
| P5-02 | Phase 5 | Docs / Schema / Closure Pack | `update` | P2 docs, package exports/tests | 让 P2 成为后续 Phase 可直接信任的 foundation baseline | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Trace Law & Base Contract Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Trace Law Matrix | 把 accepted internal work、platform alert、ingress-generated trace、recovery failure path 的 law 写成矩阵 | `P2-trace-first-observability-foundation.md`, `nacp-core observability` | trace law 有统一裁判尺 | 文档核对 | 能明确回答哪些路径必须带 trace、哪些路径允许例外 |
| P1-02 | TraceEvent Base Upgrade | 给 `TraceEventBase` 新增 `traceUuid` 及必要 source metadata，并更新公开导出与测试 | `packages/eval-observability/src/{trace-event,index}.ts`, `test/trace-event.test.ts` | eval-observability 成为真正 trace-scoped carrier | `pnpm --filter @nano-agent/eval-observability test` | `TraceEventBase` 不再只靠 `sessionUuid/turnUuid` 旁证 |
| P1-03 | Alert Exception Guard | 限制 `trace_uuid` optional 的适用范围，并补说明/测试 | `packages/nacp-core/src/observability/envelope.ts`, tests/docs | 平台级例外与 request-scoped alert 不再混淆 | `pnpm --filter @nano-agent/nacp-core test` | request/session/turn scoped alert 不能再无 trace 通过 |

### 4.2 Phase 2 — Builder / Codec / Layer Convergence

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Audit Codec Convergence | 更新 `traceEventToAuditBody()` / `auditBodyToTraceEvent()`，让 trace-first fields 能保真进出 | `packages/eval-observability/src/audit-record.ts`, tests | audit body 不再丢失 trace carrier | `pnpm --filter @nano-agent/eval-observability test` | codec 能显式编码/恢复 trace-first 字段 |
| P2-02 | Layer & Promotion Sync | 让 classification / promotion registry 与三层 conceptual model 一致 | `classification.ts`, `durable-promotion-registry.ts`, tests | event kind 的 durable/live 归属与 review 语言统一 | targeted tests | 新旧 layer 语言不再互相打架 |
| P2-03 | Session Trace Builder Rename | 修正 `turn.started / turn.completed` 等旧名字，补 traceUuid / source fields，并对齐 root contract tests | `packages/session-do-runtime/src/traces.ts`, `test/traces.test.ts`, `test/observability-protocol-contract.test.mjs` | session runtime 产出的 trace 与 session event reality 一致 | package test + root cross test | 不再出现旧 eventKind 漂移，trace builders 直接符合新 base contract |

### 4.3 Phase 3 — Anchor & Recovery Wiring

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | Anchor Shape & Recovery Error Taxonomy | 定义最小 trace anchor、恢复优先级、错误分类 | `packages/session-do-runtime/src/{checkpoint,traces,alarm}.ts`, `packages/eval-observability/src/replay.ts` | recovery 不再是模糊 best-effort | tests + docs | 至少区分 `anchor-missing / anchor-ambiguous / checkpoint-invalid / timeline-readback-failed / compat-unrecoverable / cross-seam-trace-loss / trace-carrier-mismatch / replay-window-gap` |
| P3-02 | Checkpoint / Restore / Alarm Wiring | 把 recovery logic 接进 checkpoint/restore/alarm lifecycle | `packages/session-do-runtime/src/{checkpoint,alarm,do/nano-session-do}.ts`, integration tests | DO lifecycle 具备最小 trace survival 能力 | `pnpm --filter @nano-agent/session-do-runtime test` | checkpoint/restore/alarm 不再丢 trace 而无声继续 |
| P3-03 | Ingress / Replay Recovery Guard | 在 turn ingress / orchestration / replay 读路径上 enforce trace law | `packages/session-do-runtime/src/{turn-ingress,orchestration}.ts`, related tests | accepted internal work 无 trace 会被恢复或显式拒绝 | package integration tests | replay/resume/ingress 路径不存在半坏 trace 状态 |

### 4.4 Phase 4 — Cross-package Instrumentation Sweep

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | Instrumentation Catalog Sweep | 为 llm/hook/tool/compact/storage/context 明确 trace fields 与 event kinds | `packages/{hooks,llm-wrapper,capability-runtime,workspace-context-artifacts}/src/**` | 邻接包不再各自发明 trace shape | package-local tests | 至少能指出每个邻接包的 trace emit seam 与 carrier 形状 |
| P4-02 | Cross-package Contract Expansion | 扩 root contract tests 以覆盖新 trace carrier 与 event mapping | root `test/*.test.mjs` | trace-first foundation 不止 package-local 自洽 | `npm run test:cross` | root tests 能直接捕获跨包 trace drift |

### 4.5 Phase 5 — Evidence, Tests & Doc Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | Failure Replay & Recovery Evidence | 用 failure replay / checkpoint roundtrip / ws-http fallback 等场景给 recovery law 证据 | `packages/eval-observability/test/integration/failure-replay.test.ts`, session integration tests | recovery law 有可读证据，不只是一组接口 | integration tests | 至少一组 trace-loss 场景可恢复，至少一组场景能显式失败 |
| P5-02 | Docs / Schema / Closure Pack | 同步 P2 docs、public exports、tests 说明与 closure notes | P2 docs, package index/tests | P2 成为后续 action-plan 的稳定输入 | 文档核对 + full test pass | 后续 Phase 不再重讲 trace-first 的定义 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Trace Law & Base Contract Freeze

- **Phase 目标**：把 trace-first 的最小真相层先冻住。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - 视需要新增 trace law / alert exception 相关测试
- **本 Phase 修改文件**：
  - `packages/eval-observability/src/trace-event.ts`
  - `packages/eval-observability/src/index.ts`
  - `packages/nacp-core/src/observability/envelope.ts`
  - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
- **具体功能预期**：
  1. `TraceEventBase` 至少新增 `traceUuid`，并为 source metadata 留出稳定位
  2. `NacpAlertPayload.trace_uuid` 的 optional 语义被收紧到平台级例外
  3. accepted internal work 的 trace law 不再只是 prose，而是有实际 carrier / validator / test 输入
- **具体测试安排**：
  - **单测**：`packages/eval-observability/test/trace-event.test.ts`, `packages/nacp-core` observability 相关 tests
  - **集成测试**：无强制新增
  - **回归测试**：`pnpm --filter @nano-agent/eval-observability typecheck && pnpm --filter @nano-agent/eval-observability test`; `pnpm --filter @nano-agent/nacp-core test`
  - **手动验证**：人工核对 trace law / alert exception 与 PX-QNA Q6/Q7 口径一致
- **收口标准**：
  - `TraceEventBase` 已成为 trace-scoped contract
  - alert exception 边界清楚，不再默许 request-scoped alert 无 trace
  - P2 后续 phases 不需要再争论“traceUuid 要不要进 base contract”
- **本 Phase 风险提醒**：
  - 如果 base contract 设计过瘦，后续 recovery 和 instrumentation 还会靠旁证字段救火
  - 如果 alert 例外写得过宽，会让 trace law 失去执行力

### 5.2 Phase 2 — Builder / Codec / Layer Convergence

- **Phase 目标**：让 trace carrier、audit codec、event/layer reality 讲同一种语言。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - 视需要新增 builder/codec drift guard tests
- **本 Phase 修改文件**：
  - `packages/eval-observability/src/audit-record.ts`
  - `packages/eval-observability/src/classification.ts`
  - `packages/eval-observability/src/durable-promotion-registry.ts`
  - `packages/session-do-runtime/src/traces.ts`
  - `test/observability-protocol-contract.test.mjs`
- **具体功能预期**：
  1. audit codec 在编码/恢复时不再丢 trace carrier
  2. current `TraceLayer` reality 与 Anchor/Durable/Diagnostic 三层说明得到明确映射
  3. session trace builders 改用 current session event reality，并直接携带新 trace fields
- **具体测试安排**：
  - **单测**：`audit-record.test.ts`, `classification.test.ts`, `durable-promotion-registry.test.ts`, `traces.test.ts`
  - **集成测试**：`packages/eval-observability/test/integration/ws-inspector-http-fallback.test.ts`
  - **回归测试**：`pnpm --filter @nano-agent/eval-observability test`, `pnpm --filter @nano-agent/session-do-runtime test`, `npm run test:cross`
  - **手动验证**：人工检查不再出现 `turn.started / turn.completed` 这类过时 naming
- **收口标准**：
  - eval/session/core 的 trace objects 能直接互相对拍
  - layer 语言从 design 到 code 到 tests 一致
  - root contract tests 可直接捕获 future drift
- **本 Phase 风险提醒**：
  - 如果 builder 和 codec 只修一半，cross-package drift 会被推迟到 P3/P4 才爆
  - 如果三层 mapping 只留在 design，不进 code/tests，团队仍会继续各说各话

### 5.3 Phase 3 — Anchor & Recovery Wiring

- **Phase 目标**：让 trace-first foundation 从“字段升级”推进到“恢复闭环”。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - 视需要新增 recovery helper / error taxonomy tests
- **本 Phase 修改文件**：
  - `packages/session-do-runtime/src/checkpoint.ts`
  - `packages/session-do-runtime/src/alarm.ts`
  - `packages/session-do-runtime/src/turn-ingress.ts`
  - `packages/session-do-runtime/src/orchestration.ts`
  - `packages/session-do-runtime/src/do/nano-session-do.ts`
  - `packages/eval-observability/src/replay.ts`
- **具体功能预期**：
  1. recovery 有固定优先级与错误分类，而不是散落在调用点的 best-effort
  2. checkpoint/restore/alarm 至少能从已知锚点恢复 trace，或显式抛出错误类别
  3. ingress/replay/turn orchestration 不再允许 accepted internal work 在失去 trace 后继续执行
- **具体测试安排**：
  - **单测**：`packages/session-do-runtime/test/{checkpoint,alarm}.test.ts`
  - **集成测试**：`checkpoint-roundtrip.test.ts`, `start-turn-resume.test.ts`, `ws-http-fallback.test.ts`, `graceful-shutdown.test.ts`
  - **回归测试**：`pnpm --filter @nano-agent/session-do-runtime typecheck && pnpm --filter @nano-agent/session-do-runtime test`
  - **手动验证**：用最小 trace-loss 场景确认系统会恢复或显式拒绝，而不是 silent continue
- **收口标准**：
  - 至少一条 checkpoint/restore 路径能恢复 trace
  - 至少一条 trace-loss 场景会落到明确错误类别
  - 恢复路径不依赖模糊猜测或全量历史扫描
- **本 Phase 风险提醒**：
  - 如果 recovery 设计过重，会把 P2 拉成完整 analytics / storage project
  - 如果 recovery 设计过轻，trace law 仍会停留在“字段必须有”的表层

### 5.4 Phase 4 — Cross-package Instrumentation Sweep

- **Phase 目标**：让 trace-first semantics 走出 eval/session/core 三包。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - 视需要新增 root contract tests
- **本 Phase 修改文件**：
  - `packages/hooks/src/{audit,session-mapping}.ts`
  - `packages/llm-wrapper/src/{executor,session-stream-adapter}.ts`
  - `packages/capability-runtime/src/{events,tool-call}.ts`
  - `packages/workspace-context-artifacts/src/{compact-boundary,snapshot}.ts`
  - root `test/*.test.mjs`
- **具体功能预期**：
  1. 邻接包都能指出自己的 trace emit seam 与 carrier shape
  2. llm/hook/tool/compact/storage/context 至少有最小 trace instrumentation 入口
  3. root contract tests 能直接对拍这些包的 trace truth
- **具体测试安排**：
  - **单测**：对应 package 现有 tests
  - **集成测试**：对应 package integration tests
  - **回归测试**：`npm run test:cross`
  - **手动验证**：人工核查每类 runtime boundary 至少有一个 trace evidence 出口
- **收口标准**：
  - 邻接包不再各自 invent trace shape
  - root tests 能覆盖主要跨包 trace seams
  - P3/P4 之后的 phase 不再需要重新发明 instrumentation catalog
- **本 Phase 风险提醒**：
  - 如果 sweep 范围过大，P2 可能被拖成全仓大改
  - 如果只写 docs 不补 tests，drift 会很快回潮

### 5.5 Phase 5 — Evidence, Tests & Doc Closure

- **Phase 目标**：把 P2 foundation 变成后续 phase 可直接依赖的稳定前提。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - 视需要新增 failure replay / trace-loss fixtures
- **本 Phase 修改文件**：
  - `packages/eval-observability/test/integration/failure-replay.test.ts`
  - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
  - `docs/design/after-skeleton/P2-observability-layering.md`
  - root contract tests / package exports
- **具体功能预期**：
  1. failure replay、checkpoint roundtrip、ws-http fallback 等场景共同证明 trace-first law 成立
  2. 文档、public surface、tests 三方口径一致
  3. P3/P4/P6 后续计划无需再重讲 trace-first 的定义与前提
- **具体测试安排**：
  - **单测**：eval/session/相邻包全量 tests
  - **集成测试**：failure replay + session integration + relevant package integrations
  - **回归测试**：`pnpm --filter @nano-agent/eval-observability build && pnpm --filter @nano-agent/session-do-runtime build && npm run test:cross`
  - **手动验证**：人工核对 docs 与 package public exports 不再有旧概念残留
- **收口标准**：
  - 至少一条 recovery success 路径与一条 explicit failure 路径有自动化证据
  - root contract tests 能保护 trace carrier、event mapping、audit codec
  - P2 design / layering memo / tests / code 口径完全一致
- **本 Phase 风险提醒**：
  - 如果只看包内绿测，不看 cross-package truth，P2 closure 仍可能是局部幻觉
  - 如果 failure replay 场景过少，recovery law 仍会在真正 runtime 中暴露断点

---

## 6. 需要业主 / 架构师回答的问题清单

> **统一说明**：与本 action-plan 相关的业主 / 架构师问答，统一收录于 `docs/action-plan/after-skeleton/AX-QNA.md`；请仅在该汇总文件中填写答复，本文不再逐条填写。

### 6.1 当前判断

- 当前 **无新增必须拍板的问题**。
- Q6 已明确 `TraceEventBase` 必须携带 `traceUuid`；Q7 已明确采用三层 conceptual layering；这两条足以支撑 Phase 2 开工。
- 任何新问题只有在 **改变 trace law 本身** 或 **改变 alert exception / recovery gate 边界** 时，才应升级为 owner 问题。

### 6.2 问题整理建议

- 不要把具体字段名微调、builder 实现细节、测试夹具安排升级成 owner 问题
- 优先把会影响 recovery 语义或 runtime legality 的事项升级
- 邻接包 instrumentation 的具体落点，优先在执行中靠 code reality 收敛

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| trace law 停留在 prose | 只改 design 不改 carrier / tests | `high` | Phase 1 必须先落 `TraceEventBase` 与 alert exception guard |
| eventKind 漂移继续扩大 | session trace builders 与 current session reality 不一致 | `high` | Phase 2 强制把 builder rename 与 root contract tests 绑定 |
| recovery 设计变成模糊 best-effort | 没有 anchor shape 与 error taxonomy | `high` | Phase 3 明确 recovery priority 与错误类别 |
| instrumentation sweep 范围过大 | 邻接包同时大改导致失控 | `medium` | 只收最小 trace seams，不抢跑 P4/P6 责任 |

### 7.2 约束与前提

- **技术前提**：`A1 必须先冻结 trace_uuid naming law 与 compat cut；A2 必须先产出 benchmark memo / D1 gate；Phase 2 不重新争论热写入基座`
- **运行时前提**：`accepted internal work 无 trace 必须恢复或显式失败；禁止 broad catch / silent fallback`
- **组织协作前提**：`Anchor / Durable / Diagnostic 是 conceptual layering；当前 implementation enum 继续存在但必须可映射`
- **上线 / 合并前提**：`eval-observability / session-do-runtime / root cross-package tests 与 docs sync 必须一起收口`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
  - `docs/design/after-skeleton/P2-observability-layering.md`
  - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
  - `docs/design/after-skeleton/PX-QNA.md`
- 需要同步更新的说明文档 / README：
  - 必要时更新相关 package public surface 注释与 root planning 文档
- 需要同步更新的测试说明：
  - `packages/eval-observability/test/**`
  - `packages/session-do-runtime/test/**`
  - root `test/*.test.mjs`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 确认 `TraceEventBase`、audit codec、session trace builders 都显式携带 trace carrier，而非只靠 `sessionUuid/turnUuid`
  - 确认 `turn.started / turn.completed` 等旧 naming 不再作为 current reality 残留
- **单元测试**：
  - `pnpm --filter @nano-agent/eval-observability test`
  - `pnpm --filter @nano-agent/session-do-runtime test`
  - 受影响邻接包的现有 tests
- **集成测试**：
  - `packages/eval-observability/test/integration/{failure-replay,session-timeline,ws-inspector-http-fallback}.test.ts`
  - `packages/session-do-runtime/test/integration/{checkpoint-roundtrip,start-turn-resume,ws-http-fallback,graceful-shutdown}.test.ts`
- **端到端 / 手动验证**：
  - 手工构造 trace-loss 场景，确认系统会恢复或显式报出既定错误类别
  - 手工检查 conceptual layering 与 implementation mapping 的文档说明清楚可读
- **回归测试**：
  - `pnpm --filter @nano-agent/eval-observability typecheck && pnpm --filter @nano-agent/eval-observability build`
  - `pnpm --filter @nano-agent/session-do-runtime typecheck && pnpm --filter @nano-agent/session-do-runtime build`
  - `npm run test:cross`
- **文档校验**：
  - P2 foundation doc、layering memo、PX-QNA、相关 package public surface 与 root cross tests 口径一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `trace_uuid` 已成为 eval/core/session 共同承认的运行时第一事实。
2. `TraceEventBase`、audit codec、session trace builders 与 current event/layer reality 已收敛。
3. ingress/checkpoint/restore/alarm/replay 至少存在一条可恢复路径和一条显式失败路径。
4. llm/hook/tool/compact/storage/context 的最小 instrumentation catalog 已冻结并受 tests 保护。
5. P3 及后续 action-plan 不再需要重新定义 trace-first foundation 的基本语义。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `trace law + base contract + builder/codec convergence + anchor/recovery + instrumentation sweep` 全部落地 |
| 测试 | eval/session/邻接包 tests 与 root cross-package contracts 形成闭环 |
| 文档 | P2 docs、public exports、tests 与 root planning 文档口径一致 |
| 风险收敛 | 不再存在 trace 只靠 session/turn 旁证、旧 eventKind 漂移、silent trace loss |
| 可交付性 | Phase 3/P4/P6 可直接把 Phase 2 作为稳定 observability foundation 输入 |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

这份 action-plan 以 **把 `trace_uuid` 从命名法推进到 runtime 第一事实** 为第一优先级，采用 **先冻结 trace law/base contract、再收敛 builders/recovery、再扩 instrumentation、最后用 tests/docs 封箱** 的推进方式，优先解决 **TraceEventBase 缺 trace carrier、session/eval event reality 漂移、recovery 仍是隐性 best-effort** 这三类问题，并把 **不抢跑 D1/query/exporter、不抢跑 external seam propagation、不接受 silent trace loss** 作为主要约束。整个计划完成后，`Observability / Trace Law` 应达到 **core/eval/session/邻接包都能共享同一套 trace truth，并且关键 lifecycle 可恢复、可失败、可验证** 的状态，从而为后续的 **session edge closure、external seam closure、storage/context evidence closure** 提供稳定基础。
