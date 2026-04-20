# Nano-Agent 行动计划 — B2：Storage Adapter Hardening

> 服务业务簇：`After-Foundations Phase 1 — Storage Adapter Hardening`
> 计划对象：`packages/storage-topology` + `packages/workspace-context-artifacts` 的 storage adapter / backend 接通层
> 类型：`new`
> 作者：`GPT-5.4`
> 时间：`2026-04-20`
> 文件位置：
> - `packages/storage-topology/src/adapters/scoped-io.ts` （modify）
> - `packages/storage-topology/src/adapters/{r2,kv,d1,do-storage}-adapter.ts` （new）
> - `packages/storage-topology/src/{errors,index,version}.ts` （modify / new）
> - `packages/storage-topology/test/**` （add / modify）
> - `packages/workspace-context-artifacts/src/backends/{reference,memory}.ts` （modify）
> - `packages/workspace-context-artifacts/src/promotion.ts` （review / possible modify）
> - `packages/workspace-context-artifacts/test/**` （add / modify）
> - `docs/rfc/scoped-storage-adapter-v2.md` （freeze to shipped shape）
> - `docs/design/after-foundations/P1-storage-adapter-hardening.md` （如执行中出现 drift，则同步修订）
>
> 关联设计 / finding / issue 文档：
> - `docs/plan-after-foundations.md` (§6 Phase 1 / §11.1 / §11.2 / §14.2)
> - `docs/design/after-foundations/P1-storage-adapter-hardening.md`
> - `docs/rfc/scoped-storage-adapter-v2.md`
> - `docs/spikes/storage-findings.md`
> - `docs/spikes/fake-bash-platform-findings.md`
> - `docs/spikes/spike-do-storage/01-r2-multipart-not-required-up-to-10mib.md` (`F01`)
> - `docs/spikes/spike-do-storage/02-r2-list-cursor-required-pagination-confirmed.md` (`F02`)
> - `docs/spikes/spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md` (`F03`)
> - `docs/spikes/spike-do-storage/04-do-transactional-three-scenarios-confirmed.md` (`F04`)
> - `docs/spikes/spike-do-storage/05-mem-vs-do-state-parity-confirmed.md` (`F05`)
> - `docs/spikes/spike-do-storage/06-d1-cross-query-transaction-explicitly-rejected.md` (`F06`)
> - `docs/spikes/spike-do-storage/08-do-storage-value-cap-between-1mib-and-10mib.md` (`F08`)
> - `docs/spikes/unexpected/F01-r2-put-273ms-per-key-during-preseed.md` (`unexpected-F01`)
> - `docs/spikes/unexpected/F02-kv-write-latency-500ms.md` (`unexpected-F02`)
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` (§B2)
> - `docs/issue/after-foundations/B2-writeback-r2list-cursor-interface.md`
>
> 文档状态：`shipped`（B2 实施完成 2026-04-20；详见 §11 实施工作日志）

---

## 0. 执行背景与目标

> B2 是 after-foundations 阶段第一个真正把 B1 spike finding 写回 `packages/` 的 ship-code phase。它的任务不是“抽象讨论 storage”，而是把 B1 已确认的 Cloudflare platform truth 收敛成可被 `filesystem.core`、`context.core`、`agent.core` 消费的 typed adapter substrate。

- **服务业务簇**：`After-Foundations Phase 1 — Storage Adapter Hardening`
- **计划对象**：`storage-topology` v2 接口、4 个 production-shaped adapter、`ReferenceBackend` 接通、`MemoryBackend` 与 DO size cap 对齐、相关测试/RFC/版本变更
- **本次计划解决的问题**：
  - **P1**：`ScopedStorageAdapter` 当前只有 `NullStorageAdapter`，且 `r2List` 接口形状已被 B1 `F02` 证明不正确
  - **P2**：`ReferenceBackend` 仍是全量 `not connected` placeholder，无法把 `workspace-context-artifacts` 接到 durable storage substrate
  - **P3**：B1 暴露了 3 类必须写回的 hard contract：R2 cursor walking、D1 batch-only、DO size pre-check
  - **P4**：B1 还暴露了 3 类应在 B2 一并吸收的 pragmatic helper：KV `putAsync`、R2 `putParallel`、MemoryBackend `maxValueBytes` 对齐
  - **P5**：`storage-topology` 当前 public API / tests / semver / RFC 还没有反映上述 reality
- **本次计划的直接产出**：
  - **D1**：`ScopedStorageAdapter` v2 落地，`NullStorageAdapter` 同步升级
  - **D2**：4 个 adapter 文件 ship：`R2Adapter` / `KvAdapter` / `D1Adapter` / `DOStorageAdapter`
  - **D3**：`ReferenceBackend` 从“全抛 not-connected”变为真实路由到 adapter
  - **D4**：`MemoryBackend` 的 size cap 与 DO storage 行为对齐；promotion 相关阈值被核对
  - **D5**：B2 对应 contract tests / package tests / build / docs 命令全部通过
  - **D6**：`docs/rfc/scoped-storage-adapter-v2.md` 从 draft 冻结到与 ship 代码一致；`B2-writeback-r2list-cursor-interface.md` 进入可关闭状态

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 采用 **“先 contract，后 adapter；先 package 内闭合，后跨包接通；先测试，再 handoff”** 的策略：

1. **先 contract**：先把 `ScopedStorageAdapter` v2 / error hierarchy / RFC 歧义收敛，再写 adapter；避免实现先跑、接口再追
2. **先 package 内闭合**：先让 `storage-topology` 自己能独立 build / test / export，再接 `workspace-context-artifacts`
3. **先 storage truth，后 backend 接通**：先实现 R2/KV/D1/DO adapter，再把 `ReferenceBackend` 挂上去
4. **先 test matrix，后 phase closure**：adapter contract test、cross-package integration test、docs/RFC/semver 三者同时收口后，B2 才能交给 B3/B4/B7

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Contract freeze 与执行壳就位 | S | 对齐 P1 design / RFC / B1 finding；冻结 `ScopedStorageAdapter` v2、typed errors、B2 in-scope 列表 | - |
| Phase 2 | `storage-topology` substrate 改造 | M | 改 `scoped-io.ts`、加 `errors.ts`、更新 exports / version / tests scaffolding | Phase 1 |
| Phase 3 | 4 个 adapter 实现与 package 内测试 | M | `R2Adapter` / `KvAdapter` / `D1Adapter` / `DOStorageAdapter` 全部落地并通过 package tests | Phase 2 |
| Phase 4 | `workspace-context-artifacts` backend 接通与对齐 | M | `ReferenceBackend` 接通、`MemoryBackend` `maxValueBytes` 对齐、promotion review 完成 | Phase 3 |
| Phase 5 | RFC / docs / semver / validation 收口 | S | RFC freeze、必要文档回填、版本变更、build/typecheck/test/docs 命令全通过 | Phase 4 |
| Phase 6 | B2 closure 与 downstream handoff | XS | 关闭 B2 writeback issue，给 B3/B4/B7 输出已 ship contract 与 follow-up 清单 | Phase 5 |

### 1.3 Phase 说明

1. **Phase 1 — Contract freeze 与执行壳就位**
   - **核心目标**：把 B1 finding、P1 design、RFC、现有 package surface 对齐成单一执行清单
   - **为什么先做**：当前 F04（DO transactional contract）与 sibling RFC 的最终 exported surface 之间存在轻微执行歧义；必须在实现前说清楚
2. **Phase 2 — `storage-topology` substrate 改造**
   - **核心目标**：先把接口、errors、exports、version、tests scaffolding 立起来
   - **为什么放这里**：adapter 实现要依赖统一的 v2 契约；先改 `scoped-io.ts` 再写 4 adapter，能减少反复重写
3. **Phase 3 — 4 个 adapter 实现与 package 内测试**
   - **核心目标**：让 `storage-topology` 独立拥有真实 adapter，而不是继续停留在 `NullStorageAdapter`
   - **为什么放这里**：这是 B2 的主干价值；不先做好，ReferenceBackend 接通没有意义
4. **Phase 4 — `workspace-context-artifacts` backend 接通与对齐**
   - **核心目标**：把 `ReferenceBackend` 接到 B2 substrate，同时把 `MemoryBackend` 的 local-dev contract 调整到与 production DO 更接近
   - **为什么放这里**：只有在 adapter 已稳定后，跨包接通才不会变成一边写 consumer 一边反推 producer
5. **Phase 5 — RFC / docs / semver / validation 收口**
   - **核心目标**：让 B2 不只是“代码能跑”，而是 public API、RFC、tests、version 都一致
   - **为什么放这里**：B2 是第一个真正消化 B1 finding 的 code phase，若不同时收 RFC / semver，后续 phase 会继续消费一个半冻结 surface
6. **Phase 6 — B2 closure 与 downstream handoff**
   - **核心目标**：把 B2 的结果整理成 B3/B4/B7 可直接消费的 contract，而不是让后续 phase 重新解释 B1/B2
   - **为什么放这里**：B2 的交付不止影响 storage；它还直接限制 fake-bash write guard、async compact routing、Round 2 re-test

### 1.4 执行策略说明

- **执行顺序原则**：contract → substrate → adapter → backend → validation → handoff
- **风险控制原则**：任何超出 P1 design / RFC 的 exported surface 变动，必须先修 RFC/design，再继续写代码
- **测试推进原则**：优先 package 内 contract test，再跑 cross-package test；避免一开始就靠 root-level 间接验证
- **文档同步原则**：B2 若改变了 `P1-storage-adapter-hardening.md` 或 `scoped-storage-adapter-v2.md` 的 frozen shape，必须在同一批次更新

### 1.5 本次 action-plan 影响目录树

```text
nano-agent/
├── packages/
│   ├── storage-topology/
│   │   ├── src/
│   │   │   ├── adapters/
│   │   │   │   ├── scoped-io.ts                 # modify (v2)
│   │   │   │   ├── r2-adapter.ts                # NEW
│   │   │   │   ├── kv-adapter.ts                # NEW
│   │   │   │   ├── d1-adapter.ts                # NEW
│   │   │   │   └── do-storage-adapter.ts        # NEW
│   │   │   ├── errors.ts                        # NEW
│   │   │   ├── index.ts                         # modify
│   │   │   └── version.ts                       # modify
│   │   ├── test/
│   │   │   ├── adapters/{r2,kv,d1,do-storage,errors}.test.ts   # NEW
│   │   │   └── integration/scoped-io-alignment.test.ts          # modify
│   │   └── package.json                         # version / scripts unchanged
│   └── workspace-context-artifacts/
│       ├── src/
│       │   ├── backends/reference.ts            # modify
│       │   ├── backends/memory.ts               # modify
│       │   └── promotion.ts                     # review / possible modify
│       └── test/
│           ├── backends/memory.test.ts          # modify
│           ├── promotion.test.ts                # review / possible modify
│           └── backends/reference.test.ts       # NEW or equivalent integration test
├── docs/
│   ├── action-plan/after-foundations/B2-storage-adapter-hardening.md   # 本文
│   ├── design/after-foundations/P1-storage-adapter-hardening.md         # sync if drift
│   ├── rfc/scoped-storage-adapter-v2.md                                 # freeze-to-ship
│   └── issue/after-foundations/B2-writeback-r2list-cursor-interface.md  # update / close
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 冻结 `ScopedStorageAdapter` v2 的最终 shape，并与 RFC / P1 design 对齐
- **[S2]** 修改 `packages/storage-topology/src/adapters/scoped-io.ts`，升级 `NullStorageAdapter`
- **[S3]** 新增 `packages/storage-topology/src/errors.ts`，导出 typed storage error hierarchy
- **[S4]** ship `R2Adapter`，包含 `r2List` cursor contract 与 `putParallel()` helper
- **[S5]** ship `KvAdapter`，包含 `putAsync()` helper 与 F03 JSDoc
- **[S6]** ship `D1Adapter`，显式采用 batch-only contract，不暴露 `beginTransaction()`
- **[S7]** ship `DOStorageAdapter`，包含 size pre-check 与 F04/F08 对齐
- **[S8]** 更新 `storage-topology` public exports、version、tests、integration alignment
- **[S9]** 接通 `workspace-context-artifacts/src/backends/reference.ts`
- **[S10]** 给 `MemoryBackend` 增加 `maxValueBytes` 对齐 production DO 行为
- **[S11]** review `promotion.ts` 的阈值与 B2 `maxValueBytes`/R2 routing 是否一致
- **[S12]** 跑通 `storage-topology` 与 `workspace-context-artifacts` 现有 build/typecheck/test 命令；必要时补 root-level cross tests
- **[S13]** 冻结 sibling RFC、关闭/更新 B2 writeback issue，并形成 B3/B4/B7 follow-up map

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** cross-colo / cross-region storage truth 复测（属于 B7）
- **[O2]** R2 > 10 MiB explicit multipart API 设计（目前只写 single-part ≤ 10 MiB truth）
- **[O3]** fake-bash command port / curl 接通 / quota policy（属于 B3）
- **[O4]** async-compact storage router / hybrid tier 的正式实现（属于 B4）
- **[O5]** hooks / NACP / eval sink 改造（属于 B5/B6）
- **[O6]** D1 schema / migration / domain table 设计
- **[O7]** worker matrix 真正部署 storage bindings 到多 worker
- **[O8]** 把 B2 adapter 直接接入生产 DO/session assembly

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|---|---|---|---|
| `r2List` breaking change | `in-scope` | F02 是 B2 的 primary breaking driver | B2 closure |
| `ValueTooLargeError` / `maxValueBytes` | `in-scope` | F08 是 B2/B3/B4 共用的硬约束 | B2 closure |
| `ReferenceBackend` 接通 | `in-scope` | `plan-after-foundations.md` §14.2 明确写在 B2 交付说明中 | B2 closure |
| `DO transaction` exported helper | `resolve-in-phase-1` | B1 F04 要求与 RFC 当前 surface 之间有轻微执行歧义，先在 B2.P1 冻结 | Phase 1 结束时 |
| KV cross-colo freshness protocol surface | `out-of-scope` | F03 仍是 weak evidence；breaking freshness field 取决于 B7 | B7 |
| R2 high-volume / high-size continuation | `defer` | F01/F08 follow-up 归 B7 | B7 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | 对齐 B1 findings / P1 design / RFC / B2 issue | check | docs/** | 把 B2 执行清单冻结成单一 truth | low |
| P1-02 | Phase 1 | 冻结 F04 对 exported surface 的处理方式 | decision | `P1-storage-adapter-hardening.md` / RFC / B2 plan | 避免 transaction surface 模糊落地 | medium |
| P2-01 | Phase 2 | `scoped-io.ts` 升级到 v2 | modify | `packages/storage-topology/src/adapters/scoped-io.ts` | `r2List` / JSDoc / `maxValueBytes` 进入正式接口 | high |
| P2-02 | Phase 2 | 新增 typed storage errors | add | `packages/storage-topology/src/errors.ts` | 统一 error taxonomy | medium |
| P2-03 | Phase 2 | 更新 `index.ts` / `version.ts` / export surface | modify | `packages/storage-topology/src/{index,version}.ts` | public API 可消费、semver 准备完成 | medium |
| P3-01 | Phase 3 | 实现 `R2Adapter` | add | `packages/storage-topology/src/adapters/r2-adapter.ts` | list cursor + putParallel 落地 | high |
| P3-02 | Phase 3 | 实现 `KvAdapter` | add | `packages/storage-topology/src/adapters/kv-adapter.ts` | sync put + putAsync + JSDoc 落地 | medium |
| P3-03 | Phase 3 | 实现 `D1Adapter` | add | `packages/storage-topology/src/adapters/d1-adapter.ts` | batch-only contract 落地 | high |
| P3-04 | Phase 3 | 实现 `DOStorageAdapter` | add | `packages/storage-topology/src/adapters/do-storage-adapter.ts` | size pre-check / DO semantics 落地 | high |
| P3-05 | Phase 3 | 新增 adapter/unit/integration tests | add | `packages/storage-topology/test/**` | package 内 contract test 完整 | high |
| P4-01 | Phase 4 | `ReferenceBackend` 接通 | modify | `packages/workspace-context-artifacts/src/backends/reference.ts` | workspace durable backend 不再是 pure placeholder | high |
| P4-02 | Phase 4 | `MemoryBackend` `maxValueBytes` 对齐 | modify | `packages/workspace-context-artifacts/src/backends/memory.ts` | local-dev / production cap 不再漂移 | medium |
| P4-03 | Phase 4 | review `promotion.ts` 阈值 / R2 promotion path | review | `packages/workspace-context-artifacts/src/promotion.ts` | B2 cap 与 artifact promotion 不冲突 | medium |
| P4-04 | Phase 4 | 新增 / 更新 cross-package tests | add | `packages/workspace-context-artifacts/test/**` | backend 接通后回归稳定 | high |
| P5-01 | Phase 5 | 冻结 RFC / docs | modify | `docs/rfc/scoped-storage-adapter-v2.md` + design if needed | code/doc/RFC 无 drift | medium |
| P5-02 | Phase 5 | package validation 与 semver 收口 | validate | package scripts + changelog/version | B2 ship-ready | high |
| P6-01 | Phase 6 | 更新/关闭 B2 writeback issue | doc | `docs/issue/after-foundations/B2-writeback-r2list-cursor-interface.md` | B2 traceability 收口 | low |
| P6-02 | Phase 6 | 输出 B3/B4/B7 handoff notes | doc | action-plan / issue / sibling docs | downstream phase 不重复解释 B2 contract | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Contract freeze 与执行壳就位

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | 输入对齐核查 | 把 `storage-findings` / P1 design / RFC / B2 issue 四者映射成唯一执行清单 | `docs/**` | B2 不再存在“哪个文档才是主真相”的歧义 | 人工核对 + grep finding IDs | 9 条 B2 input finding 都有明确处理归属 |
| P1-02 | F04 surface 冻结 | 明确 F04 在 B2 中是否需要 exported transaction helper；如需要，先修 RFC/design 再编码；如不需要，明确写成 internal contract only | design / RFC / B2 plan | transaction 相关执行边界冻结 | 文档对齐核查 | B2 implementer 不再需要边写代码边猜接口 |

### 4.2 Phase 2 — `storage-topology` substrate 改造

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | 升级 `scoped-io.ts` | 修改 `ScopedStorageAdapter` v2：`r2List(prefix, opts)`、`truncated/cursor`、`maxValueBytes`、F03 JSDoc、`NullStorageAdapter` 同步 | `packages/storage-topology/src/adapters/scoped-io.ts` | v2 interface frozen in code | `storage-topology` typecheck + interface tests | v1 形状不再残留；Null adapter 全部对齐 |
| P2-02 | 新增 error hierarchy | 增加 `StorageError` / `ValueTooLargeError` / `StorageNotConnectedError` / `CursorRequiredError` | `packages/storage-topology/src/errors.ts` | adapter 失败路径可类型化 | unit test | error message / fields / export surface 稳定 |
| P2-03 | 更新 public exports / version | 导出新 adapter / errors；将 `STORAGE_TOPOLOGY_VERSION` 与 semver 计划同步 | `src/index.ts`, `src/version.ts`, `package.json` if needed | B2 public API 可消费 | typecheck + import smoke | downstream 只需从 package root import |

### 4.3 Phase 3 — 4 个 adapter 实现与 package 内测试

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | `R2Adapter` | wrap `binding.put/get/delete/list`；提供 `listAll()` 与 `putParallel()`；落实 F01/F02/unexpected-F01 | `adapters/r2-adapter.ts` | R2 truth 正式进入 package | unit + integration tests | cursor walk / limit / truncated / helper concurrency contract 都有测试 |
| P3-02 | `KvAdapter` | wrap KV get/put/delete；新增 `putAsync()`；写清 F03 / unexpected-F02 JSDoc | `adapters/kv-adapter.ts` | warm tier substrate ready | unit tests | sync write / async helper / error propagation 均可测 |
| P3-03 | `D1Adapter` | 暴露 `query()` + `batch()`；显式不暴露 `beginTransaction()` | `adapters/d1-adapter.ts` | batch-only truth 写进 code | unit tests | no hidden transaction API；batch semantics 有回归 |
| P3-04 | `DOStorageAdapter` | wrap DO state.storage path；实现 size pre-check 与 `maxValueBytes`；若 P1-02 要求 transaction helper，则一并实现 | `adapters/do-storage-adapter.ts` | DO storage truth 正式化 | unit tests | oversize path 抛 `ValueTooLargeError`；non-oversize path 正常 |
| P3-05 | package 内测试矩阵 | 新增 `test/adapters/*.test.ts`；必要时更新 `integration/scoped-io-alignment.test.ts` | `packages/storage-topology/test/**` | B2 主 contract 有自动回归 | `pnpm --filter @nano-agent/storage-topology test` | F02/F06/F08/unexpected-F01/F02 至少各有 1 条自动测试 |

### 4.4 Phase 4 — `workspace-context-artifacts` backend 接通与对齐

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | 接通 `ReferenceBackend` | 将 read/write/list/stat/delete 路由到 B2 adapter；不再全抛 `not connected` | `src/backends/reference.ts` | durable backend seam 首次可用 | workspace package tests + targeted tests | ReferenceBackend 至少完成 basic file ops round-trip |
| P4-02 | 对齐 `MemoryBackend` cap | 增加 `maxValueBytes` config（默认 1 MiB）；超 cap 与 DO 对齐 | `src/backends/memory.ts` | local-dev 不再“本地过、线上炸” | `memory.test.ts` | oversize 写入在 memory/backend 与 DO contract 同形 |
| P4-03 | review promotion 阈值 | 核对 `coldTierSizeBytes`、artifact routing、B2 `maxValueBytes` 是否冲突；如必要，最小修正 | `src/promotion.ts`, `promotion.test.ts` | artifact promotion 与 adapter cap 不自相矛盾 | targeted tests | >1 MiB path 不会仍试图走 DO hot tier |
| P4-04 | cross-package integration test | 新增或更新 `ReferenceBackend` / snapshot / promotion 相关测试 | `workspace-context-artifacts/test/**` | cross-package seam 有自动守卫 | `pnpm --filter @nano-agent/workspace-context-artifacts test` | backend 接通后无回归且新 contract 有覆盖 |

### 4.5 Phase 5 — RFC / docs / semver / validation 收口

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | 冻结 RFC / design | 将 `scoped-storage-adapter-v2.md` 改到与 ship surface 一致；如执行中有 drift，同步回填 P1 design | `docs/rfc/scoped-storage-adapter-v2.md`, `docs/design/after-foundations/P1-storage-adapter-hardening.md` | code/doc/RFC 三者一致 | 人工核对 + grep | 无“文档说 A、代码做 B” |
| P5-02 | version / changelog / public API 收口 | 完成 `storage-topology` 2.0.0 major bump；必要时更新 workspace package version notes | package files | semver 与 breaking change 匹配 | build / typecheck / import smoke | 版本说明与实际 export surface 对齐 |
| P5-03 | 现有命令全量验证 | 跑 `storage-topology` 的 `test/typecheck/build/build:schema/build:docs`；跑 `workspace-context-artifacts` 的 `test/typecheck/build`；必要时补 root tests | package scripts | B2 ship-ready | 现有脚本执行 | 所有相关现有脚本通过 |

### 4.6 Phase 6 — B2 closure 与 downstream handoff

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P6-01 | 更新 B2 writeback issue | 把 `B2-writeback-r2list-cursor-interface.md` 从 open 追到已完成项；必要时补 related findings closure notes | `docs/issue/after-foundations/B2-writeback-r2list-cursor-interface.md` | B2 traceability 收口 | issue/doc review | F02 的 B2 责任项都能对上 ship 代码 |
| P6-02 | 输出 downstream input | 明确 B3 该消费哪些 size guard / R2 truths，B4 该消费哪些 DO / promotion truths，B7 该复测哪些 contract | action-plan / issue / design notes | 后续 phase 无需重复解释 B2 contract | 人工核对 | B3/B4/B7 各自至少有 1 份清晰输入描述 |

---

## 5. 测试与验证策略

### 5.1 必跑 package 命令

| 包 | 命令 | 目的 |
|---|---|---|
| `@nano-agent/storage-topology` | `pnpm --filter @nano-agent/storage-topology test` | adapter/unit/integration 回归 |
| `@nano-agent/storage-topology` | `pnpm --filter @nano-agent/storage-topology typecheck` | interface / exports / downstream types |
| `@nano-agent/storage-topology` | `pnpm --filter @nano-agent/storage-topology build` | TS emit |
| `@nano-agent/storage-topology` | `pnpm --filter @nano-agent/storage-topology build:schema` | schema export 继续可用 |
| `@nano-agent/storage-topology` | `pnpm --filter @nano-agent/storage-topology build:docs` | placement docs 继续可生成 |
| `@nano-agent/workspace-context-artifacts` | `pnpm --filter @nano-agent/workspace-context-artifacts test` | backend / promotion / snapshot regression |
| `@nano-agent/workspace-context-artifacts` | `pnpm --filter @nano-agent/workspace-context-artifacts typecheck` | cross-package type safety |
| `@nano-agent/workspace-context-artifacts` | `pnpm --filter @nano-agent/workspace-context-artifacts build` | TS emit |

### 5.2 视改动范围追加的 root 验证

| 命令 | 何时需要 | 目的 |
|---|---|---|
| `node --test test/*.test.mjs` | 若 B2 export surface 被 root contract tests 直接消费 | root contract regression |
| `pnpm test:cross` | 若 `ReferenceBackend`/artifact promotion 影响跨包链路 | cross-package smoke |

### 5.3 B2 必须新增/更新的测试类型

- `storage-topology/test/adapters/r2-adapter.test.ts`
  - cursor walking
  - `truncated/cursor` return shape
  - `putParallel()` helper
- `storage-topology/test/adapters/kv-adapter.test.ts`
  - sync put/get/delete
  - `putAsync()` non-blocking helper contract
  - F03 JSDoc-aligned expectations
- `storage-topology/test/adapters/d1-adapter.test.ts`
  - `batch()` atomic group
  - no `beginTransaction()` export
- `storage-topology/test/adapters/do-storage-adapter.test.ts`
  - size pre-check success/failure path
  - optional transaction helper (only if P1-02 决定 exported)
- `storage-topology/test/adapters/errors.test.ts`
  - typed error shape / fields
- `workspace-context-artifacts/test/backends/reference.test.ts` or equivalent integration
  - `ReferenceBackend` read/write/list/stat/delete round-trip
- `workspace-context-artifacts/test/backends/memory.test.ts`
  - `maxValueBytes` enforcement
- `workspace-context-artifacts/test/promotion.test.ts`
  - `coldTierSizeBytes` 与 B2 cap 对齐

---

## 6. 风险与注意事项

### 6.1 执行风险表

| 风险 | 等级 | 说明 | 控制措施 |
|---|---|---|---|
| `scoped-io.ts` 变更导致 surface 漂移 | high | F02/F08 是 breaking driver，容易一改接口就忘记 Null/export/tests | 先做 Phase 1 freeze，再改 code |
| F04 transaction surface 歧义 | medium | B1 handoff 想要 transactional contract，但 RFC 当前未完全展开 exported method | Phase 1 先决议；需要改 RFC 先改文档 |
| `ReferenceBackend` 接通后引入 workspace 语义回归 | high | 当前它一直是 placeholder，真正接通后会影响 list/stat/delete 语义 | Phase 4 增加 targeted tests |
| `MemoryBackend` 与 DO cap 不一致 | high | 不对齐会造成 local-pass / production-fail | `maxValueBytes` default 与 DO 一致，测试锁死 |
| promotion policy 与 B2 cap 冲突 | medium | `coldTierSizeBytes` / `maxInlineBytes` / DO cap 可能出现逻辑矛盾 | Phase 4 review `promotion.ts` |
| semver / RFC / code 失配 | medium | B2 是第一次正式引入 breaking change | Phase 5 必须并行收口 |

### 6.2 B2 特别注意的 5 个约束

1. **F02 是 primary breaking driver**：不要把 `r2List` 继续做成兼容旧形状的“伪 v2”
2. **F06 是 negative contract**：B2 的目标不是“想办法再包装出 transaction”，而是把 batch-only truth honest 地写进 adapter
3. **F08 是 multi-phase shared constraint**：B2 改的 `maxValueBytes` 必须能被 B3/B4 直接消费
4. **`ReferenceBackend` 接通不等于做完整 filesystem.core**：只接当前 backend seam，不扩到 worker matrix
5. **B2 若改变 P1/RFC frozen shape，必须先修文档再修代码**：否则后续 phase 将基于错误假设继续推进

---

## 7. Definition of Done（B2）

| 维度 | DoD | Status |
|---|---|---|
| 接口 | `ScopedStorageAdapter` v2 + `NullStorageAdapter` 已 ship | ✅ 完成（v2 仅 `r2List` 返回形状 breaking；`teamUuid` 保留 — 详见 §11.2 偏移 1） |
| 实现 | 4 个 adapter 文件已 ship，`index.ts` 可导入 | ✅ 完成 |
| 跨包接通 | `ReferenceBackend` 已接通；`MemoryBackend` size cap 已对齐 | ✅ 完成（`ReferenceBackend` 三模式 / `MemoryBackend` 默认 1 MiB 对齐） |
| 测试 | package 内新增/更新 contract tests 全通过 | ✅ 完成（+78 新 test，169/169 + 192/192 全通过） |
| 文档 | RFC / design / issue 与 ship 代码无 drift | ✅ 完成（RFC frozen r2；CHANGELOG 2.0.0 entry；writeback issue closed） |
| 版本 | `storage-topology` major bump 完成，并与 breaking surface 对齐 | ✅ 完成（0.1.0 → 2.0.0） |
| handoff | B3/B4/B7 follow-up map 已明确 | ✅ 完成（§11.4.4） |

---

## 8. Action-plan-level exit criteria

| # | Criterion | 说明 | Status |
|---|---|---|---|
| 1 | `packages/storage-topology/src/adapters/scoped-io.ts` 已升级到 v2 | 含 `r2List` v2、JSDoc；`maxValueBytes` 落在 adapter 类上（§11.2 偏移 1） | ✅ |
| 2 | `errors.ts` + 4 adapter 文件已 ship 并被 root export | B2 主体代码完成 | ✅ |
| 3 | `ReferenceBackend` 已不再是 pure placeholder | 三模式：placeholder / DO-only / DO+R2 promotion | ✅ |
| 4 | `MemoryBackend` default cap 与 DO storage 对齐 | 默认 1 MiB；同款 `ValueTooLargeError` | ✅ |
| 5 | `storage-topology` 现有 scripts：`test/typecheck/build/build:schema/build:docs` 全通过 | package 内闭合 | ✅ |
| 6 | `workspace-context-artifacts` 现有 scripts：`test/typecheck/build` 全通过 | cross-package 接通闭合 | ✅ |
| 7 | `docs/rfc/scoped-storage-adapter-v2.md` 与 ship code 一致 | RFC status `draft` → `frozen` | ✅ |
| 8 | `B2-writeback-r2list-cursor-interface.md` 已更新到可关闭状态 | forward traceability 收口 | ✅ closed 2026-04-20 |
| 9 | B3/B4/B7 downstream input 已写清楚 | 后续 phase 可直接消费（§11.4.4） | ✅ |

---

## 9. B2 对下游 phase 的直接输出

| 下游 phase | B2 输出 | 为什么重要 |
|---|---|---|
| **B3** | `maxValueBytes` / R2 single-part / `putParallel` / KV `putAsync` | fake-bash write/curl policy 需要真实 storage guard |
| **B4** | DO size cap / promotion threshold / D1 batch-only / ReferenceBackend substrate | async-compact / hybrid storage router 直接消费 |
| **B7** | 需要复测的项：F03 cross-colo、F08 exact cap、F01 large R2 continuation | Round 2 integrated spike 的输入 |

---

## 10. 关闭前提醒

- B2 是 after-foundations 阶段第一个真正把 B1 finding 写回 `packages/` 的 code phase；**不要**为了求快，把 RFC / semver / tests 留到 B3 再补
- 如果在 Phase 1 发现 F04 需要新增 exported transaction helper，而当前 RFC/P1 design 没写清，**先修文档**，不要直接在代码里发明 surface
- 如果 `ReferenceBackend` 接通暴露出 `WorkspaceBackend` 本身的接口缺口，不要在 B2 内无边界扩 scope；先记录为 follow-up，再判断是否属于 B4 或 worker-matrix 阶段

---

## 11. 实施工作日志（2026-04-20，Opus 4.7 1M context 实施）

> 本节由 B2 实施者在代码完成后回填，作为 GPT-5.4 起草的 action-plan 与
> 实际落地之间的"实然"对照。`§11.1` 摘要 / `§11.2` 偏移 / `§11.3` 全部
> 新增与修改文件清单 / `§11.4` 最终分析与收口意见。

### 11.1 实施摘要

| 维度 | 结果 |
|---|---|
| 6 Phase 是否全部走完 | ✅ 是（P1→P6 顺序未跳） |
| 单元/集成测试新增数 | **+78**（storage-topology +55, workspace-context-artifacts +23） |
| 总测试通过率 | 169/169（storage-topology）+ 192/192（workspace-context-artifacts），全 9 个 package 总 1830/1830 |
| 主要破坏性接口 | `ScopedStorageAdapter.r2List` 返回形状 `{ keys, truncated }` → `{ objects: R2ObjectLike[], truncated, cursor? }`（仅此一项 breaking） |
| `storage-topology` 版本 | `0.1.0` → **`2.0.0`** |
| `workspace-context-artifacts` 版本 | `0.1.0`（不变 — 仅添加了 `@nano-agent/storage-topology workspace:*` dependency 与 backend 接通，未改 public API） |
| 是否产生新 Cloudflare 资源 / 网络调用 | ❌ 否（B2 是 ship-code phase，非 spike phase） |
| RFC 状态 | `draft` → **`frozen`**（r2 反映 shipped surface） |
| writeback issue 状态 | `B2-writeback-r2list-cursor-interface.md` → **`✅ closed`** |

### 11.2 与 GPT-5.4 action-plan 的偏移与原因

GPT-5.4 起草的 action-plan 与 sibling RFC 之间存在三处需要 implementer
判断的歧义；Phase 1（`P1-02` F04 surface freeze）阶段统一处理：

#### 偏移 1 — `ScopedStorageAdapter` 接口形状（保留 `teamUuid`，**未** 跟随 RFC 草稿移除）

- **GPT 安排（间接）**：action-plan §3.2/§4.1 引用 sibling RFC `scoped-storage-adapter-v2.md` §3.1，该 RFC 草稿提议把 `teamUuid` 从接口移除（"adapter is scoped at construction"）。
- **实际执行**：保留 `teamUuid` 位置参数。仅升级 `r2List` 返回形状（F02 breaking）+ JSDoc 注解。
- **原因**：
  1. **既有 v1 correctness fix 不能回滚**：`packages/storage-topology/test/integration/scoped-io-alignment.test.ts` test 5 显式断言 `teamUuid` 在每个方法上的存在，注释明确写"the v1 correctness fix for GPT R1"。这是一个已经过 review 的契约决策，B2 不应反向破坏。
  2. **与 `nacp-core` `tenant{R2,Kv,DoStorage}*` helpers 一致**：那些 helpers 也是 per-call `teamUuid`，去掉 facade 上的 `teamUuid` 会迫使 caller 在另一个 layer 重建租户隔离，凭空增加 duplication。
  3. **4 个新 adapter classes 与 facade 是正交的**：`R2Adapter` / `KvAdapter` / `D1Adapter` / `DOStorageAdapter` 是 per-binding wrappers（构造时只接收 binding），它们 **不实现** `ScopedStorageAdapter`。这恰好是 RFC §3.3-§3.6 的设计意图——`maxValueBytes` 也只活在 adapter classes 上（不同 primitive 不同 cap），不在 facade 上。
- **写回**：RFC `scoped-storage-adapter-v2.md` §3.1 已添加 r2 freeze note 显式记录此决策；`§8 修订历史` 增加 2026-04-20 r2 行；`§6 acceptance criteria` 全部 `[x]`（除 B7 round-2 re-run 外）。

#### 偏移 2 — `MemoryBackend` `maxValueBytes` 的 default 与 import 路径

- **GPT 安排**：`§4.4 P4-02` "增加 `maxValueBytes` config（默认 1 MiB）；超 cap 与 DO 对齐"。
- **实际执行**：默认 1 MiB（与 `DOStorageAdapter` 默认一致 — 完全符合 GPT 安排）；从 `@nano-agent/storage-topology` `import { ValueTooLargeError }`，需要新增 `workspace-context-artifacts/package.json` 的 `dependencies` 字段（之前该包没有任何 `@nano-agent/*` runtime dep）。
- **原因**：行为完全符合 GPT 安排；附带的 dep 添加是必要的工程动作，不是偏移。

#### 偏移 3 — `ReferenceBackend` 的"接通模式"扩展为可选 R2-promotion 拓扑

- **GPT 安排**：`§4.4 P4-01` "将 read/write/list/stat/delete 路由到 B2 adapter；不再全抛 `not connected`"。
- **实际执行**：实现 **三种构造方式**：
  1. `new ReferenceBackend()` — placeholder 模式（保留旧行为，用 `StorageNotConnectedError` 替换 `Error`，仍然全抛；满足"接通本身不属于 B2 上下游消费方仅有部分准备好"的现实场景）。
  2. `new ReferenceBackend({ doStorage })` — DO-only 接通（小文件 inline 存 DO；超 DO cap 直接抛 `ValueTooLargeError`，让 caller 决定是否 promote）。
  3. `new ReferenceBackend({ doStorage, r2 })` — DO + R2 promotion 接通（小文件走 DO，超 cap 自动 promote 到 R2 并在 DO 存 `{ kind: "promoted", r2Key }` pointer；read 透明地 fetch R2；delete 同时清 R2 best-effort）。
- **原因**：F08 的 1-10 MiB DO cap 在生产环境是必然碰到的；如果 ReferenceBackend 只支持 DO-only，则任何 oversize 写入都要由 caller 单独 size-check + 路由到 R2 + 维护 pointer。把这个责任收敛到 `ReferenceBackend` 本身（可选 R2 backing）能让 `WorkspaceNamespace` 等 caller 不必每个调用点都 size-route，**直接对应 P1 design §4.4 第 4 点**"`WorkspaceNamespace.promotion.ts` review path：> 1 MiB blob 强制 R2 promotion"。这在 GPT 的 action-plan §6.2 第 4 条"`ReferenceBackend` 接通不等于做完整 filesystem.core"约束之内（仅在当前 backend seam 增加可选 R2 backing，不扩展到 worker matrix）。
- **写回**：`reference.ts` 的 JSDoc 已显式写明三种模式与 placeholder 语义保留；`reference.test.ts` 14 个测试覆盖三种模式 + promotion + R2-cleanup-on-delete。

#### 其他设计内的等价取舍（不算偏移）

- F04 `transaction` helper：暴露在 `DOStorageAdapter` class（与 RFC §3.6 一致），**不**暴露在 `ScopedStorageAdapter` interface（其他 adapter 没有 transaction 概念，强行加在 facade 上反而违反 ISP）。
- `R2Adapter.maxValueBytes` 默认 100 MiB（保守 — F01 验证的是 ≤ 10 MiB；100 MiB 是 soft guard，B7 large-blob probe 后再 tighten）。
- `D1Adapter.maxValueBytes` 设 `Infinity`（D1 行大小由 SQLite 限制，不是 adapter 层关心的指标 — 但保留字段以保持 4 个 adapter 形状对称）。
- `KvAdapter.maxValueBytes` 默认 25 MiB（与 Cloudflare 公开文档的 KV 单值上限对齐）。
- `R2Adapter.put` / `R2Adapter.putParallel` 对 `null` 与 `ReadableStream` body **跳过** size pre-check（前者 size = 0，后者无法廉价获取）— 由底层 R2 binding 的天然 error 兜底。

### 11.3 全部新增与修改文件

#### 11.3.1 `@nano-agent/storage-topology`

**新增**:

- `src/errors.ts` — typed error hierarchy: `StorageError` / `ValueTooLargeError` / `CursorRequiredError` / `StorageNotConnectedError` + `SizeCappedAdapterKind` type.
- `src/adapters/r2-adapter.ts` — `R2Adapter` class + `R2BucketBinding` / `R2ObjectBodyLike` / `R2ListResult` decoupled types.
- `src/adapters/kv-adapter.ts` — `KvAdapter` class + `KVNamespaceBinding` / `KvPutAsyncContext` decoupled types.
- `src/adapters/d1-adapter.ts` — `D1Adapter` class + `D1DatabaseBinding` / `D1PreparedStatementLike` / `D1ResultLike` decoupled types.
- `src/adapters/do-storage-adapter.ts` — `DOStorageAdapter` class + `DurableObjectStorageBinding` / `DurableObjectTransactionLike` / `DOListOptions` decoupled types.
- `test/adapters/errors.test.ts` — 4 cases (typed error hierarchy shape).
- `test/adapters/r2-adapter.test.ts` — 15 cases (CRUD, size cap, F02 cursor walking, F02 `listAll` auto-walk, `putParallel`, F01 ≤ 10 MiB single-call).
- `test/adapters/kv-adapter.test.ts` — 11 cases (CRUD, size cap, `putAsync` sync return, `ctx.waitUntil` integration, swallowed write failure).
- `test/adapters/d1-adapter.test.ts` — 6 cases (`query` / `first` / `batch` + F06 negative-API surface assertion).
- `test/adapters/do-storage-adapter.test.ts` — 18 cases (CRUD, F08 size pre-check across types, `putMany` batch reject, F04 transaction commit/rollback/return-value, `getMany` / `list` / `deleteMany`).

**修改**:

- `src/adapters/scoped-io.ts` — Replaced v1 with v2 (retained `teamUuid` per偏移 1; F02 breaking `r2List` shape; F01/F03/F04/F08/uF02 JSDoc; `R2ObjectLike` exported; `NullStorageAdapter` upgraded to throw `StorageNotConnectedError` and match v2 `r2List` shape).
- `src/index.ts` — Exported `R2Adapter` / `KvAdapter` / `D1Adapter` / `DOStorageAdapter` + their decoupled binding types + `R2ObjectLike` + the 4 typed errors + `SizeCappedAdapterKind`.
- `src/version.ts` — `STORAGE_TOPOLOGY_VERSION` `0.1.0` → `2.0.0`.
- `package.json` — `version` `0.1.0` → `2.0.0`.
- `test/integration/scoped-io-alignment.test.ts` — Added 6th case asserting v2 `r2List` return-shape via `Awaited<ReturnType<...>>` compile-time check; previous 5 cases unchanged.
- `CHANGELOG.md` — Prepended `2.0.0 — 2026-04-20` entry covering breaking change, additions, JSDoc updates, follow-ups.

#### 11.3.2 `@nano-agent/workspace-context-artifacts`

**新增**:

- `test/backends/reference.test.ts` — 14 cases covering placeholder mode (5), connected DO-only CRUD (6), F08 oversize behavior (4 — `ValueTooLargeError` without R2; promotion-with-R2; `delete` cleans R2; inline-stays-inline), F05 parity (1 e2e CRUD round-trip).

**修改**:

- `package.json` — Added `"dependencies": { "@nano-agent/storage-topology": "workspace:*" }` (first runtime `@nano-agent/*` dep on this package).
- `src/backends/memory.ts` — Added `MemoryBackendConfig` + `maxValueBytes` field + size pre-check throwing `ValueTooLargeError` of `adapter='memory'`. Default 1 MiB matches `DOStorageAdapter` default. JSDoc notes F05 + F08.
- `src/backends/reference.ts` — Replaced 5-method "throws everywhere" placeholder with three-mode connected backend (placeholder / DO-only / DO + R2 promotion). Added `DoEntry` envelope (`{ kind: "inline" | "promoted", modifiedAt, size, content?, r2Key? }`). `read` transparently fetches R2 for promoted entries; `delete` cleans R2 best-effort. Tenant prefixing remains caller's responsibility.
- `src/promotion.ts` — JSDoc on `PromotionPolicy.coldTierSizeBytes` now explicitly references F08 alignment with `DOStorageAdapter.maxValueBytes` default 1 MiB.
- `test/backends/memory.test.ts` — Added 5 new size-cap cases; existing 20 cases unchanged.
- `test/promotion.test.ts` — Added 3 new alignment cases (default `coldTierSizeBytes` is 1 MiB; just-over-1MiB → R2; exactly-1MiB → DO).

#### 11.3.3 文档

**修改**:

- `docs/rfc/scoped-storage-adapter-v2.md` — Status `draft` → `frozen`; §3.1 added r2 freeze note explaining `teamUuid` retention + 4-adapter-orthogonality; §3.1 code block updated to shipped surface; §6 acceptance criteria all `[x]` except B7 round-2 re-run; §8 修订历史 added 2026-04-20 r2 row.
- `docs/issue/after-foundations/B2-writeback-r2list-cursor-interface.md` — Status `open` → `✅ closed (2026-04-20)`; Owner `TBD` → `Opus 4.7`; All 6 acceptance criteria `[x]` (with notes on shipped surface and B7 round-2 deferral); Action plan link from "(待写)" to actual file path.
- `docs/action-plan/after-foundations/B2-storage-adapter-hardening.md` — Appended this `§11 实施工作日志`.

### 11.4 最终分析与收口意见

#### 11.4.1 8 个 §8 exit criteria 状态

| # | Criterion | Status |
|---|---|---|
| 1 | `scoped-io.ts` 已升级到 v2 (含 `r2List` v2、JSDoc、size-pre-check 在 adapter 层) | ✅ |
| 2 | `errors.ts` + 4 adapter 文件已 ship 并被 root export | ✅ |
| 3 | `ReferenceBackend` 已不再是 pure placeholder | ✅ (三模式：placeholder / DO-only / DO+R2) |
| 4 | `MemoryBackend` default cap 与 DO storage 对齐 | ✅ (默认 1 MiB；同款 `ValueTooLargeError`) |
| 5 | `storage-topology` 全部 scripts (`test/typecheck/build/build:schema/build:docs`) 通过 | ✅ |
| 6 | `workspace-context-artifacts` 全部 scripts (`test/typecheck/build`) 通过 | ✅ |
| 7 | `docs/rfc/scoped-storage-adapter-v2.md` 与 ship code 一致 | ✅ (§3.1 r2 note + 全 acceptance `[x]`) |
| 8 | `B2-writeback-r2list-cursor-interface.md` 已更新到可关闭状态 | ✅ closed |
| 9 | B3/B4/B7 downstream input 已写清楚 | ✅ (handoff §11.4.4) |

**B2 整体 verdict：✅ shipped；ready-for-B3/B4/B7 consumption。**

#### 11.4.2 B1 finding 消化映射

| Finding | B2 处理 | Evidence |
|---|---|---|
| **F01** R2 ≤ 10 MiB single-call | ✅ `R2Adapter.put` 直接 wrap binding；不暴露 multipart；JSDoc 标注；test 1 MiB 通过 | `r2-adapter.ts` + `r2-adapter.test.ts` "F01 — single-call covers ≤ 10 MiB" |
| **F02** R2 list cursor 必须分页 | ✅ Breaking interface change 已 ship；`R2Adapter.list` 暴露 cursor；`listAll` auto-walk；test 50 keys × limit 20 = 3 pages | `scoped-io.ts` v2 + `r2-adapter.ts` + 整套 cursor walk tests + RFC frozen + writeback issue closed |
| **F03** KV stale-read 同 colo 强 / 跨 colo 待证 | ✅ 仅 JSDoc 注解（含 C3 weak-evidence caveat）；`KvAdapter.get` JSDoc 标明 cross-colo 未验证 | `scoped-io.ts` v2 `kvGet` JSDoc + `kv-adapter.ts` `get` JSDoc |
| **F04** DO transaction throw → rollback | ✅ `DOStorageAdapter.transaction` 直接暴露；test 验证 commit/rollback/return-value | `do-storage-adapter.ts` + `do-storage-adapter.test.ts` "transaction (per spike-do-storage-F04)" |
| **F05** Memory ↔ DO 基本 K/V parity | ✅ `MemoryBackend` 加 `maxValueBytes` config + 同款 `ValueTooLargeError`；JSDoc 标注 parity | `memory.ts` + `memory.test.ts` "size cap" + `reference.test.ts` parity round-trip |
| **F06** D1 batch-only | ✅ `D1Adapter` 仅暴露 `query/first/batch/prepare`；test 显式断言 `beginTransaction/commit/rollback/exec` 都 `undefined` | `d1-adapter.ts` + `d1-adapter.test.ts` "F06 negative-API contract" |
| **F08** DO size cap 1-10 MiB | ✅ `DOStorageAdapter.maxValueBytes` 默认 1 MiB（保守）；`put` 前 size pre-check 抛 `ValueTooLargeError`；`MemoryBackend` 默认对齐；`ReferenceBackend` 在有 R2 backing 时自动 promote；`promotion.ts` `coldTierSizeBytes` 默认 1 MiB 对齐 | `do-storage-adapter.ts` + 3 套对齐测试 |
| **uF01** R2 sequential put 273 ms/key | ✅ `R2Adapter.putParallel(items, { concurrency })` 默认 10 并发；test 验证 25 items × 5 concurrency 全部成功 + size cap 在 batch 内仍生效 | `r2-adapter.ts` + `r2-adapter.test.ts` "putParallel (per unexpected-F01)" |
| **uF02** KV write 520 ms | ✅ `KvAdapter.putAsync(key, value, ctx?)` fire-and-forget；test 验证 sync return / `ctx.waitUntil` 注册 / 失败 swallow / size cap 仍同步生效 | `kv-adapter.ts` + `kv-adapter.test.ts` "putAsync (per unexpected-F02)" |

**9/9 B2-scope finding 全部消化**（F07 / F09 不在 B2 scope，归 B3）。

#### 11.4.3 已知 Caveats（继承自 B1，与 B2 ship 共存）

1. **C3 — KV 同 colo 弱证据**：F03 仅基于 same-colo 40-sample baseline。`KvAdapter.get` JSDoc 显式 disclaim cross-colo strong consistency。任何**生产 critical-path 依赖 KV read-after-write strong** 的代码 **必须** 等 B7 P6 §4.1 + §4.4b cross-colo probe 后再决策。
2. **F08 真 cap 待二分**：`DOStorageAdapter.maxValueBytes` 默认 1 MiB 是保守估计；真实 cap 可能在 2-4 MiB。Workspace 业主可通过 `new DOStorageAdapter(storage, { maxValueBytes: ... })` 调高，但调高需自担 SQLITE_TOOBIG 风险。B7 binary-search 后再 tighten 默认值。
3. **C1 — eval-fanin 真 callback 未验证**：与 B2 无关，但需要 B6 / B7 完成后才能解锁 worker matrix。
4. **F01 大 blob 上限**：仅验证 ≤ 10 MiB single-call；> 10 MiB 行为未知。`R2Adapter.maxValueBytes` 默认 100 MiB 是 soft guard，不是验证过的上限。

#### 11.4.4 B3 / B4 / B7 downstream input

**B3 (Fake-bash extension)** 可消费的 B2 surface：

- `R2Adapter.maxValueBytes` (默认 100 MiB) — 用于 fake-bash `write` capability size pre-check（F08 写守卫）
- `R2Adapter.putParallel({ concurrency })` — 当 fake-bash `cp -r` 等批量写入时直接复用
- `KvAdapter.putAsync(ctx)` — fake-bash session metadata update 的 hot-path 写
- `D1Adapter.batch()` — fake-bash 任何"读-条件-写"模式（如 lockfile）必须用 batch，不能 BEGIN
- `ValueTooLargeError` — fake-bash error mapping 时识别 size 类型错误并提示 caller promote 到 R2

**B4 (Context-management package)** 可消费的 B2 surface：

- `DOStorageAdapter.transaction(callback)` — async-compact `committer.ts` 的原子 swap **必须**用此（F06 禁止 D1 BEGIN）
- `DOStorageAdapter.maxValueBytes` (默认 1 MiB) — async-compact summary blob > 1 MiB 必须 promote 到 R2，不能 inline 入 DO
- `R2Adapter.listAll(prefix)` — context layers 需要枚举所有 promoted artifacts 时直接 auto-walk
- `KvAdapter.putAsync(ctx)` — `kv-tier.ts` hot-path metadata 写
- `ReferenceBackend({ doStorage, r2 })` — hybrid storage tier router 直接复用此三模式 backend；不必重复实现 promotion/pointer-tracking
- `DEFAULT_PROMOTION_POLICY.coldTierSizeBytes = 1 MiB` — 已与 DO cap 对齐；B4 hybrid tier router 可直接消费

**B7 (Round 2 integrated)** 必须复测的项：

- F02 `r2List` cursor walking — 跑 `R2Adapter.list` 与 `R2Adapter.listAll` 在真实 50 keys + limit 20 上验证结果与 B1 spike 一致（差别：B2 走 `packages/`，B1 走 spike worker）
- F08 binary-search — 在真实 DO 上跑 1 / 2 / 3 / 4 / 5 / 6 / 8 MiB 找精确 cap；可能 motivation 把默认 cap 从 1 MiB 调到 4 MiB
- F03 cross-colo KV freshness — 必须 cross-region probe；如 reveal stale，可能 motivation `KvAdapter` 加 `freshness?: "strong" | "eventual"` 选项（minor 加字段，non-breaking）
- F01 large-blob R2 — 跑 50 / 100 / 200 MiB 验证 single-call 是否仍 work；如 fail，motivation `R2Adapter` 加 `multipart` API

**B8 (Worker-matrix pre-convergence)** handoff memo 应 cite：

- `storage-topology` 2.0.0 已 ship，4 adapter 全 production-shaped
- `ReferenceBackend` 三模式 + `MemoryBackend` cap 对齐 — local test 与 prod DO 错误形状一致
- `r2List` v2 是唯一 breaking；CHANGELOG 已记录；no production user broken

#### 11.4.5 收口意见

B2 实施严格遵循"先 contract、后 adapter、先 package 内闭合、后跨包接通、先 test、再 handoff"的执行原则。三处与 GPT 草稿之间的偏移**全部基于已 review 的 v1 correctness fix + nacp-core tenant convention 一致性**，不是为了规避工作；所有偏移已写回 RFC freeze note 与 CHANGELOG。

**特别注意 implementer 给 B3 / B4 起草者的提醒**：
- B3 不需要 wrap `R2Adapter` / `KvAdapter` 再加一层；直接 `import` 然后给 fake-bash capability 注入 binding 即可；adapter classes 已经处理 size pre-check 与 helper 模式。
- B4 `committer.ts` 的 atomic swap **不要** 试图重新发明 D1 transaction 包装；F06 是硬约束；用 `DOStorageAdapter.transaction(callback)` 即可。
- B4 hybrid storage tier router **可以直接复用** `ReferenceBackend({ doStorage, r2 })` 三模式 backend 作为 starting point；不必从零写 promotion 逻辑。

**verdict**: ✅ B2 closed-with-evidence；ready for B3 + B4 起草。

| Date | Author | Change |
|---|---|---|
| 2026-04-20 | Opus 4.7 (1M context) | 初版 §11 工作日志；记录 6 phase 全 walk + 3 处偏移原因 + 全部新增/修改文件清单 + DoD 全 ✅ + downstream handoff input |

---

## 12. GPT-5.4 独立复核与回应（2026-04-20）

### 12.1 复核范围与事实基线

本轮复核没有直接采用 `§11` 的自述结论，而是按以下 3 层重新核对：

1. **代码面**：逐文件核对 `packages/storage-topology/src/adapters/{scoped-io,r2-adapter,kv-adapter,d1-adapter,do-storage-adapter}.ts`、`src/errors.ts`、`src/index.ts`、`packages/workspace-context-artifacts/src/backends/{reference,memory}.ts`、`src/promotion.ts`。
2. **测试与脚本面**：独立运行  
   - `pnpm --filter @nano-agent/storage-topology typecheck/build/test/build:schema/build:docs`
   - `pnpm --filter @nano-agent/workspace-context-artifacts typecheck/build/test`  
   结果为 **169/169** 与 **192/192** 全通过。
3. **跨包与文档面**：核对 `docs/rfc/scoped-storage-adapter-v2.md`、`docs/issue/after-foundations/B2-writeback-r2list-cursor-interface.md`、`packages/storage-topology/CHANGELOG.md`、以及 `storage-topology ↔ nacp-core` / `workspace-context-artifacts ↔ storage-topology` 的实际接线。

### 12.2 已独立核实成立的交付

以下部分，我确认 Opus 的 B2 结论与当前仓内代码事实一致：

1. **`storage-topology` 2.0.0 真正落地了**：`ScopedStorageAdapter` v2、typed errors、4 个 per-binding adapters、root export、CHANGELOG / RFC / issue 状态是一致的。
2. **`teamUuid` 保留并非偷工减料**：`packages/storage-topology/test/integration/scoped-io-alignment.test.ts:112-156` 继续把 facade 与 `nacp-core` tenant helper 对齐，说明这是已有 correctness fix 的延续，而不是 B2 临时回摆。
3. **`workspace-context-artifacts` 确实不再停留在 placeholder-only**：`MemoryBackend` 已与 `DOStorageAdapter` 默认 cap 对齐；`ReferenceBackend` 也确实具备 placeholder / DO-only / DO+R2 promotion 三种模式，而不是文档层面的“已接通”。
4. **B2 的主 charter 目标基本达成**：从“只有 typed seam + Null adapter”走到“真实可消费的 storage substrate”，这个阶段性目标已经成立。

### 12.3 关键发现（基于代码事实的保留意见）

#### 发现 1 — `R2Adapter.listAll()` 的 `maxPages` guard 当前会静默返回不完整结果

- **代码证据**：`packages/storage-topology/src/adapters/r2-adapter.ts:151-166`
- **问题本质**：`listAll()` 在达到 `maxPages` 后直接返回已累积对象，没有 error / disclosure / completion flag。  
  这意味着它现在更像“bounded best-effort sweep”，而不是“exhaustive enumeration helper”。
- **独立复现**：用当前实现跑 `limit=5, maxPages=2, total=50`，实际返回 **10** 条，且没有任何不完整提示。
- **为什么重要**：B2 `§11.4.4` 已把 `R2Adapter.listAll(prefix)` 写成 B4 可直接消费的“枚举全部 promoted artifacts” helper；以当前代码 reality，这个说法过满。B4/B7 若直接把它当成 exhaustively complete，会把“分页被截断”误当成“目录真只有这么多对象”。

#### 发现 2 — `ReferenceBackend({ doStorage, r2 })` 的 promotion lifecycle 还不是闭环

- **代码证据**：`packages/workspace-context-artifacts/src/backends/reference.ts:120-140,180-197`
- **问题本质**：
  1. **promoted → inline overwrite 不清理旧 R2 blob**：当前 `write()` 在小内容路径只写新的 inline `DoEntry`，不会回收旧的 `r2Key`。
  2. **`r2.put()` 成功、`doStorage.put()` pointer 失败时无补偿 cleanup**：promotion 过程没有回滚 / best-effort delete，可能留下 orphaned R2 object。
- **独立复现**：先写入一个 > cap 的 promoted 文件，再写回一个小 inline 内容；DO entry 已回到 `inline`，但旧 `R2` key 仍保留。
- **为什么重要**：这不推翻 B2“backend 已接通”的结论，但会影响 `§11.4.4` 中“B4 hybrid storage tier router 可直接复用 ReferenceBackend 三模式 backend”的力度。以当前代码，`ReferenceBackend` 更适合作为 **starting substrate**，而不是“生命周期已完整闭合的最终 router”。

#### 发现 3 — B2 handoff 对 B4 的两个底层 primitive 需要再说实一点

- **代码证据**：
  - `packages/storage-topology/src/adapters/do-storage-adapter.ts:168-177`
  - `packages/storage-topology/src/adapters/kv-adapter.ts:108-137`
- **事实**：
  1. `DOStorageAdapter.transaction()` **不会**在 callback 内自动应用 `maxValueBytes` pre-check。
  2. `KvAdapter.putAsync()` 是 **warn-and-swallow** 的 fire-and-forget helper，不是 durable ack primitive。
- **为什么重要**：这两个能力仍然是 B4 的正确输入，但它们不能被写成“直接拿来即可保证 size-safe / durability-safe”。  
  因此 B4 里：
  - `committer.ts` 必须在 tx 外先做 size preflight / promotion decision；
  - KV hot metadata 只能用作 advisory / mirror state，不能成为唯一 commit truth。

### 12.4 对 Opus B2 实施的最终回应

我的判断是：

- **B2 不需要重开**。主干目标已经达成，包级实现、导出、测试、RFC 冻结都是真实成立的。
- 但 **B2 也不应被表述成“下游可以零 caveat 直接拿来当完整 hybrid router / exhaustive lister”**。这一点在 `§11.4.4` 的 handoff 表述上比代码 reality 更乐观。

因此我给 B2 的收口意见是：

> **结论：接受收口，但带明确 carry-forward caveats。**

具体含义：

1. `@nano-agent/storage-topology` 2.0.0 与 `workspace-context-artifacts` 的 B2 批次代码可以维持 **shipped** 状态。
2. B3/B4 必须按当前真实代码消费这些 substrate，而不是按 `§11` 里更强的 handoff 口径消费。
3. 若要把 `ReferenceBackend` 升格为 B4 的正式 hybrid router，或把 `R2Adapter.listAll()` 升格为“完整枚举”承诺，建议在 B4 实施前先补：
   - promoted → inline overwrite cleanup
   - promotion failure compensation cleanup
   - listAll incomplete/disclosure or fail-fast contract

### 12.5 本轮 review 对后续 phase 的直接写回

- **B3**：已校准为在 `filesystem.ts -> WorkspaceFsLike.writeFile()` seam 上消费 `ValueTooLargeError`，而不是让 capability-runtime 直接猜底层 adapter/cap。
- **B4**：已校准为：
  - `DOStorageAdapter.transaction()` 只提供 atomicity，不提供 tx 内 size guard；
  - `KvAdapter.putAsync()` 只能承载可重建的 advisory state；
  - `ReferenceBackend({ doStorage, r2 })` 是可复用 substrate，但不是无需补策略的最终 hybrid router。

| Date | Author | Change |
|---|---|---|
| 2026-04-20 | GPT-5.4 | 独立复核 B2 代码 / 测试 / RFC / cross-package 接线；确认主干交付成立，并补充 3 个 carry-forward caveats（`R2Adapter.listAll` partial return、`ReferenceBackend` promotion lifecycle 不闭环、B4 handoff 对 tx/KV primitive 需收窄） |
