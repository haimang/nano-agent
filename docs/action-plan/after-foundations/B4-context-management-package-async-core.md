# Nano-Agent 行动计划 — B4：Context-Management Package Async Core

> 服务业务簇：`After-Foundations Phase 3 — Context-Management New Package (with async compact core)`
> 计划对象：`packages/context-management/` 新包 + 与其直接耦合的 `workspace-context-artifacts` / `session-do-runtime` / `agent-runtime-kernel` / `storage-topology` companion seam
> 类型：`new`
> 作者：`GPT-5.4`
> 时间：`2026-04-20`
> 文件位置：
> - `packages/context-management/package.json` （new）
> - `packages/context-management/tsconfig.json` （new）
> - `packages/context-management/{README,CHANGELOG}.md` （new）
> - `packages/context-management/src/{index,version}.ts` （new）
> - `packages/context-management/src/budget/{index,types,policy,env}.ts` （new）
> - `packages/context-management/src/async-compact/{index,types,threshold,scheduler,planner,prepare-job,committer,version-history,fallback,events}.ts` （new）
> - `packages/context-management/src/inspector-facade/{index,types,usage-report,http-route,ws-route,inspector-auth,inspector-redact,route-mount}.ts` （new）
> - `packages/context-management/test/**` （new）
> - `packages/workspace-context-artifacts/src/{context-layers,compact-boundary,snapshot,index}.ts` （modify / review）
> - `packages/session-do-runtime/src/{routes,worker,index}.ts` （modify / review）
> - `packages/agent-runtime-kernel/src/{types,scheduler,runner,index}.ts` （modify / review）
> - `packages/storage-topology/src/{placement,promotion-plan,index}.ts` （review / possible modify）
> - `docs/design/after-foundations/P3-context-management-async-compact.md` （如执行中出现 drift，则同步修订）
> - `docs/design/after-foundations/P3-context-management-inspector.md` （如执行中出现 drift，则同步修订）
> - `docs/design/after-foundations/P3-context-management-hybrid-storage.md` （作为映射输入消费；若执行位置与 charter r2 冲突，则明确回写）
>
> 关联设计 / spec / eval / issue / review 文档：
> - `docs/plan-after-foundations.md` (§4.1 D / §7.4 / §11.1 / §14.2)
> - `docs/plan-after-foundations-reviewed-by-GPT.md` (§2.3 / §2.4 / §2.5)
> - `docs/design/after-foundations/PX-async-compact-lifecycle-spec.md`
> - `docs/design/after-foundations/P3-context-management-async-compact.md`
> - `docs/design/after-foundations/P3-context-management-inspector.md`
> - `docs/design/after-foundations/P3-context-management-hybrid-storage.md`
> - `docs/eval/after-foundations/context-management-eval-by-GPT.md`
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` (§B4)
> - `docs/spikes/spike-do-storage/04-do-transactional-three-scenarios-confirmed.md` (`F04`)
> - `docs/spikes/spike-do-storage/06-d1-cross-query-transaction-explicitly-rejected.md` (`F06`)
> - `docs/spikes/spike-do-storage/08-do-storage-value-cap-between-1mib-and-10mib.md` (`F08`)
> - `docs/spikes/spike-binding-pair/01-binding-latency-sub-10ms-and-cancellation-works.md` (`binding-F01`)
> - `docs/spikes/spike-binding-pair/02-anchor-headers-survive-but-lowercased.md` (`binding-F02`)
> - `docs/spikes/spike-binding-pair/03-hooks-callback-latency-and-error-shape-confirmed.md` (`binding-F03`)
> - `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md` (`binding-F04`)
> - `docs/spikes/unexpected/F02-kv-write-latency-500ms.md` (`unexpected-F02`)
> - `docs/issue/after-foundations/B6-writeback-eval-sink-dedup.md`
>
> 文档状态：`draft`

---

## 0. 执行背景与目标

> B4 是 after-foundations 第一个 **新建 package** 的 phase，而且它不是在空地上搭包，而是在已有 foundations 之上补出“上下文治理 runtime”。当前仓库已经有 `workspace-context-artifacts` 的 layered assembler / compact boundary / snapshot，也有 `eval-observability` 的 `SessionInspector`，还有 `agent-runtime-kernel` 的 turn loop；B4 的任务是把这些 primitives 组织成一个新的 context-management 包，而不是把旧包职责重写一遍。

- **服务业务簇**：`After-Foundations Phase 3 — Context-Management New Package (with async compact core)`
- **计划对象**：新建 `packages/context-management/`，并完成它与现有 runtime / workspace / inspection / placement seam 的最小接线
- **本次计划解决的问题**：
  - **P1**：仓库当前还没有 `packages/context-management/` 实体包；B4 首先是 package-creation phase
  - **P2**：charter r2 已把 B4 scope 收窄为 `budget/ + async-compact/ + inspector-facade/`，但 P3 design family 仍存在两处 drift：
    1. 没有独立的 `budget/` design
    2. `P3-context-management-hybrid-storage.md` 仍把 tier router 放在 `context-management` 包内，而 charter r2 已明确把物理 tier routing 留在新包之外
  - **P3**：`workspace-context-artifacts` 已有 `ContextLayer` / `CompactBoundaryManager` / `WorkspaceSnapshotBuilder`，`eval-observability` 已有 `SessionInspector`；若 B4 不处理边界，很容易把 foundations 再切一次
  - **P4**：B4 设计里对 hooks / inspector / async compact 的几个假设，与当前代码 reality 之间仍有断点：
    - `HookDispatcher.emit()` 只接受严格的 `HookEventName` union，不能像设计稿里那样先 emit 再等 B5 补 catalog
    - `SessionInspector` 目前没有 dedup by `messageUuid`，而 inspector facade 设计明确把 dedup 责任放在 B6
    - `session-do-runtime` 当前只识别 `/sessions/:sessionId/...` 路由，尚无 `/inspect/...` mount surface
  - **P5**：B4 还必须吸收 B1 findings：F04/F06/F08、binding-F02/F04、unexpected-F02，不能把 async compact / inspection 做成脱离 platform truth 的“本地 CLI 版心智”
- **本次计划的直接产出**：
  - **D1**：创建 `@nano-agent/context-management` 新包骨架与 3 个子模块
  - **D2**：在 `budget/` 中冻结 `BufferPolicy + CompactPolicy + env override` 的最小 contract，并与现有 assembler 的 `maxTokens - reserveForResponse` reality 对齐
  - **D3**：在 `async-compact/` 中落地 PX canonical lifecycle 的 packaging：scheduler / planner / prepare / commit / version-history / fallback
  - **D4**：在 `inspector-facade/` 中提供 context-specific HTTP/WS facade，但继续 **wrap 而不是 rewrite** `SessionInspector`
  - **D5**：完成与 `workspace-context-artifacts` / `agent-runtime-kernel` / `session-do-runtime` 的最小 integration seam，使 B4 不是孤立包
  - **D6**：明确哪些依赖属于 B5/B6（hooks catalog / dedup / NACP），并把这些顺序关系写成 action-plan-level gate，而不是实现时临场判断

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 采用 **“先收窄边界，再建包；先 budget/async core，再挂 facade；先消费已有 primitives，再决定最少 companion changes”** 的策略：

1. **先收窄边界**：B4 以 current charter r2 为 source of truth。`P3-context-management-hybrid-storage.md` 作为 mapping / evidence 输入被消费，但其实现位置必须在 Phase 1 重新对齐
2. **先建 package skeleton，再落 3 个子模块**：避免子模块先分散实现、最后才补 package public API / scripts / tests
3. **先复用 foundations，再开 companion seams**：`CompactBoundaryManager`、`WorkspaceSnapshotBuilder`、`SessionInspector`、kernel turn loop 都是现有资产；只有在它们无法承接时，才做最窄 companion changes
4. **把 B5/B6 依赖显式化**：hooks catalog 与 inspector dedup 都不是 B4 内部可以默默解决的问题；必须写成 ship gate / soft dependency

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Scope reconciliation 与 contract freeze | S | 对齐 charter r2 / P3 family / current code；冻结 budget surface、hybrid-storage 落点、B4↔B5↔B6 依赖 | - |
| Phase 2 | New package skeleton + budget core | S-M | 创建 `packages/context-management/` 包壳、公共导出、`budget/` 子模块、最小 bridge types | Phase 1 |
| Phase 3 | `async-compact/` core implementation | M | 实现 lifecycle 6+ units，并接 `workspace-context-artifacts` / `llm-wrapper` / `storage-topology` seam | Phase 2 |
| Phase 4 | `inspector-facade/` + session edge mount | M | 实现 HTTP/WS facade、auth/redact、conditional route mount，并消费 `SessionInspector` | Phase 3 |
| Phase 5 | Integration companion changes + package tests | M | 接 `agent-runtime-kernel` / `workspace-context-artifacts` / `storage-topology` / `session-do-runtime` 最小 integration，并补测试矩阵 | Phase 4 |
| Phase 6 | Docs / changelog / validation / handoff closure | S | package 文档、验证、B5/B6/B7/B8 handoff 收口 | Phase 5 |

### 1.3 Phase 说明

1. **Phase 1 — Scope reconciliation 与 contract freeze**
   - **核心目标**：解决 B4 当前最大的 3 个 drift：`budget/` 无独立 design、`hybrid-storage` 实现位置冲突、hooks/dedup 的顺序依赖
   - **为什么先做**：如果不先冻结这些边界，B4 会一边建新包，一边重写旧包职责
2. **Phase 2 — New package skeleton + budget core**
   - **核心目标**：先把新包作为 workspace package 正式建立，再把 budget 变成一个可被 async-compact / inspector 共用的正式 surface
   - **为什么放这里**：`budget/` 缺 design，但它是 async-compact 与 inspector usage report 的公共底座
3. **Phase 3 — `async-compact/` core implementation**
   - **核心目标**：把 PX lifecycle spec 转成真实 package 文件与 orchestrator API
   - **为什么放这里**：这是 B4 的主价值，也是 B5/P5 后续 producer reality 的来源
4. **Phase 4 — `inspector-facade/` + session edge mount**
   - **核心目标**：把 context-specific inspection surface 搭出来，但继续复用 `SessionInspector`
   - **为什么放这里**：只有 async state 与 budget policy 已有稳定 shape，inspection facade 才不会成为空壳
5. **Phase 5 — Integration companion changes + package tests**
   - **核心目标**：让新包真的接上 kernel / workspace / session edge，而不是只在自己的单测里成立
   - **为什么放这里**：B4 的本质是 orchestration package，不做 integration 就没有价值
6. **Phase 6 — Docs / validation / handoff closure**
   - **核心目标**：把 B4 变成一个可被 B5/B6/B7/B8 直接消费的现实 package
   - **为什么放这里**：B4 是 B5/B6 的 producer reality 来源，必须把下游输入写清楚

### 1.4 执行策略说明

- **执行顺序原则**：scope freeze → package skeleton → budget → async core → inspector facade → integration → docs/handoff
- **职责保护原则**：B4 只新增 **context-management runtime**；不重写 `workspace-context-artifacts` / `eval-observability` / `storage-topology`
- **source-of-truth 原则**：charter r2 的 B4 scope 高于 P3-hybrid-storage 的旧落点；后者的 mapping / evidence 被消费，但实现位置必须服从新 charter
- **依赖显式原则**：凡是当前代码不能直接承接的设计假设（例如 unknown hook event names、SessionInspector dedup），都必须在计划里显式写成 gate / caveat
- **companion-change 最小化原则**：外包修改只做为了承接 B4，不顺手做 B5/B6/worker-matrix 的工作

### 1.5 本次 action-plan 影响目录树

```text
nano-agent/
├── packages/
│   ├── context-management/                        # NEW package
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── README.md
│   │   ├── CHANGELOG.md
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── version.ts
│   │   │   ├── budget/
│   │   │   │   ├── index.ts
│   │   │   │   ├── types.ts
│   │   │   │   ├── policy.ts
│   │   │   │   └── env.ts
│   │   │   ├── async-compact/
│   │   │   │   ├── index.ts
│   │   │   │   ├── types.ts
│   │   │   │   ├── threshold.ts
│   │   │   │   ├── scheduler.ts
│   │   │   │   ├── planner.ts
│   │   │   │   ├── prepare-job.ts
│   │   │   │   ├── committer.ts
│   │   │   │   ├── version-history.ts
│   │   │   │   ├── fallback.ts
│   │   │   │   └── events.ts
│   │   │   └── inspector-facade/
│   │   │       ├── index.ts
│   │   │       ├── types.ts
│   │   │       ├── usage-report.ts
│   │   │       ├── http-route.ts
│   │   │       ├── ws-route.ts
│   │   │       ├── inspector-auth.ts
│   │   │       ├── inspector-redact.ts
│   │   │       └── route-mount.ts
│   │   └── test/
│   │       ├── budget/**/*.test.ts
│   │       ├── async-compact/**/*.test.ts
│   │       ├── inspector-facade/**/*.test.ts
│   │       └── integration/**/*.test.ts
│   ├── workspace-context-artifacts/
│   │   └── src/{context-layers,compact-boundary,snapshot,index}.ts   # modify / review
│   ├── session-do-runtime/
│   │   └── src/{routes,worker,index}.ts                              # modify / review
│   ├── agent-runtime-kernel/
│   │   └── src/{types,scheduler,runner,index}.ts                     # modify / review
│   └── storage-topology/
│       └── src/{placement,promotion-plan,index}.ts                   # review / possible modify
└── docs/
    ├── action-plan/after-foundations/B4-context-management-package-async-core.md
    └── design/after-foundations/P3-*.md / PX-async-compact-lifecycle-spec.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 创建 `packages/context-management/` 包骨架与 workspace package metadata
- **[S2]** 冻结并实现 `budget/`：`BufferPolicy`、`CompactPolicy`、soft/hard threshold、env override、与 `reserveForResponse` 的对齐
- **[S3]** 实现 `async-compact/`：scheduler / planner / prepare-job / committer / version-history / fallback / events
- **[S4]** 让 `async-compact/` 真实消费已有 primitives：`CompactBoundaryManager`、`WorkspaceSnapshotBuilder`、`LLMExecutor`/gateway seam、B2 storage adapter seam
- **[S5]** 实现 `inspector-facade/`：usage report、HTTP read routes、谨慎 control routes、WS subscribe、auth/redact、route mount helper
- **[S6]** 与 `session-do-runtime` 接出 `/inspect/...` 条件路由与 worker entry mount seam
- **[S7]** 与 `agent-runtime-kernel` 接出 turn-boundary compact decision seam
- **[S8]** 在 `workspace-context-artifacts` 里补 B4 所需的最小 bridge（例如 context tag / snapshot reason / compact boundary export），但不重写其 data plane
- **[S9]** 消费 `P3-context-management-hybrid-storage.md` 的 mapping / evidence 结论，并把真正需要的 placement companion changes 写回 `storage-topology`（若当前 placement surface 不足以承接）
- **[S10]** 明确处理 B4↔B5↔B6 的依赖：class-D hook event、SessionInspector dedup、NACP 不在本阶段落地
- **[S11]** 跑通新包及受影响包的现有 build/typecheck/test 命令

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 在 `context-management` 包内重建 `storage/` tier router 实现
- **[O2]** 重写 `SessionInspector`
- **[O3]** B5 hook catalog expansion / metadata freeze
- **[O4]** B6 `messageUuid` dedup 实现与 NACP 1.2.0 升级
- **[O5]** worker-matrix 阶段的 `context.core` worker shell / service binding 包装
- **[O6]** 生产级 dashboard / OAuth / RBAC / cross-region inspector aggregation
- **[O7]** full microcompact / full memory extraction 子系统
- **[O8]** B7 round-2 spikes（exact cap / high-volume curl / inspector endpoint real deploy probe）

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|---|---|---|---|
| `budget/` 子模块 | `in-scope` | charter r2 明确写进 Phase 3，但当前没有独立 design；B4 必须先补成可执行 contract | Phase 1 结束时 |
| `hybrid-storage` mapping/evidence | `consume-as-input` | P3-hybrid-storage 仍有价值，但其实现位置已与 charter r2 冲突 | Phase 1 |
| 物理 tier router 落在 `context-management` | `out-of-scope` | current charter r2 与 GPT review 都要求收窄包边界 | worker-matrix / future placement phase |
| `storage-topology` companion writeback | `in-scope-if-required` | 若 B4 的 async-compact/inspector 无法消费现有 placement truth，则需最窄 companion change | Phase 5 |
| async lifecycle hook emission 直接走现有 `HookDispatcher.emit(Context*...)` | `resolve-in-phase-1` | 现有 `HookEventName` 是 strict union，不能按设计稿假设先发后补 catalog | Phase 1 |
| inspector facade 默认认为 dedup 已存在 | `soft-dependency-only` | 当前 `SessionInspector` 无 dedup；B4 只能显式 caveat，不能假设 B6 已完成 | B6 |
| context inspection 走 NACP envelope | `out-of-scope` | current charter + inspector design 都明确独立 HTTP/WS | P5 之后如确有需要再重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | 对齐 charter / P3 family / current code reality | check | docs/** + packages/** | 冻结 B4 单一真相 | high |
| P1-02 | Phase 1 | 冻结 `budget/` 最小 surface | decision | `budget/*` + eval inputs | 补齐缺失 design | high |
| P1-03 | Phase 1 | 解决 hybrid-storage 落点冲突 | decision | `storage-topology` / `workspace-context-artifacts` / P3-hybrid-storage doc | 避免 B4 scope 漂移 | high |
| P1-04 | Phase 1 | 冻结 B4↔B5↔B6 seam | decision | hooks / eval-observability / inspector design | 顺序依赖显式化 | high |
| P2-01 | Phase 2 | 新建 package skeleton | add | `packages/context-management/*` | 新包可 build/typecheck/test | high |
| P2-02 | Phase 2 | 实现 `budget/` 子模块 | add | `src/budget/*` | budget policy 成为正式 API | medium |
| P2-03 | Phase 2 | 补最小 bridge types / exports | modify | `workspace-context-artifacts/src/context-layers.ts` + new package exports | 为 async core 提供共享 vocabulary | high |
| P3-01 | Phase 3 | 实现 orchestrator / threshold / scheduler | add | `src/async-compact/{index,types,threshold,scheduler}.ts` | async lifecycle 入口成立 | high |
| P3-02 | Phase 3 | 实现 planner / prepare-job | add | `src/async-compact/{planner,prepare-job}.ts` | CoW fork + background summarize 路径成立 | high |
| P3-03 | Phase 3 | 实现 committer / version-history / fallback / events | add | `src/async-compact/{committer,version-history,fallback,events}.ts` | atomic swap / snapshot / fallback / event seam 成立 | high |
| P4-01 | Phase 4 | 实现 inspector usage/report/auth/redact | add | `src/inspector-facade/{types,usage-report,inspector-auth,inspector-redact}.ts` | context-specific inspection surface 成立 | medium |
| P4-02 | Phase 4 | 实现 HTTP/WS routes + mount helper | add | `src/inspector-facade/{http-route,ws-route,route-mount}.ts` + `session-do-runtime` | facade 可被条件挂载 | high |
| P5-01 | Phase 5 | 接 turn loop compact seam | modify | `agent-runtime-kernel/src/{types,scheduler,runner,index}.ts` | kernel 可在 turn boundary 调用 compact orchestration | high |
| P5-02 | Phase 5 | 处理 workspace / snapshot / placement companion changes | modify | `workspace-context-artifacts` + `storage-topology` | foundations 能承接 B4 runtime | medium |
| P5-03 | Phase 5 | 新增 package / integration tests | add | `packages/context-management/test/**` + companion package tests | B4 不是孤立单测 | high |
| P6-01 | Phase 6 | README / changelog / design drift / validation 收口 | modify | docs + package metadata | code/doc/package truth 一致 | medium |
| P6-02 | Phase 6 | 输出 B5/B6/B7/B8 handoff | doc | action-plan / sibling docs | downstream 不重复解释 B4 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Scope reconciliation 与 contract freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | 输入对齐核查 | 把 `plan-after-foundations` r2、GPT review §2.3/§2.4/§2.5、P3 family、B1 handoff、现有 packages reality 对成唯一执行清单 | `docs/**`, `packages/**` | B4 不再存在“包边界到底归谁”的歧义 | 人工核对 + grep | 所有 B4 代码目标都能映射到真实现有包 |
| P1-02 | `budget/` 最小 surface 冻结 | 基于 charter §7.4、`context-management-eval-by-GPT.md` §3.1 与 `ContextAssemblyConfig.reserveForResponse` reality，冻结 `BufferPolicy` / `CompactPolicy` / env override / usage calc surface | `budget/*`, eval docs, `workspace-context-artifacts/src/context-layers.ts` | B4 有明确 budget API，而不是“实现时再想” | 设计/计划核对 | `budget/` 不再依赖缺失 design 文稿 |
| P1-03 | hybrid-storage 落点统一 | 采用 current charter r2：`context-management` 不拥有 `storage/`；消费 `P3-hybrid-storage` 的 tag→tier / F08 / unexpected-F02 结论，但真正的 placement writeback 落在 `storage-topology` / `workspace-context-artifacts` companion seam | P3-hybrid-storage doc + `storage-topology` | B4 scope 不扩张 | 设计/计划核对 | action-plan 明确“消费 mapping，不在新包内重建 router” |
| P1-04 | B4↔B5↔B6 seam 冻结 | 明确：现有 `HookDispatcher.emit()` 不能接受未知 `Context*` event name；B4 不直接完成 B5 catalog work。另明确 inspector facade 在 B6 dedup 前的 duplicate caveat | `packages/hooks/src/{catalog,dispatcher}.ts`, `eval-observability/src/inspector.ts` | 顺序依赖 honest 可执行 | 代码事实核对 | B4 不再假设“先 emit 再补 catalog” |

### 4.2 Phase 2 — New package skeleton + budget core

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | 创建 package 骨架 | 新建 `package.json` / `tsconfig.json` / `README.md` / `CHANGELOG.md` / `src/index.ts` / `src/version.ts` / `test/` | `packages/context-management/*` | 新包正式进入 workspace | `pnpm --filter @nano-agent/context-management typecheck/build` | 包能被 workspace 识别并构建 |
| P2-02 | `budget/` 实现 | 创建 `types.ts` / `policy.ts` / `env.ts` / `index.ts`，定义 `BufferPolicy`、`CompactPolicy`、默认 soft/hard threshold、env override、headroom 计算 helper | `src/budget/*` | async-compact 与 inspector 可共享 budget truth | unit tests | `budget/` 输出不与 `reserveForResponse` 现有语义冲突 |
| P2-03 | bridge vocabulary | 在 `workspace-context-artifacts` 中补最小 context tag / snapshot reason / compact state bridge（如确需），并从新包 root 导出 budget-related types | `workspace-context-artifacts/src/{context-layers,index,snapshot}.ts`, `context-management/src/index.ts` | B4 与既有 layered context vocabulary 对齐 | typecheck + import smoke | 不复制已有 `ContextLayer`，只补最小 bridge |

### 4.3 Phase 3 — `async-compact/` core implementation

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | orchestrator + threshold + scheduler | 实现 `AsyncCompactOrchestrator` 入口、threshold 计算、scheduler ARMED/PREPARE 判定 | `src/async-compact/{index,types,threshold,scheduler}.ts` | lifecycle 入口成立 | unit tests | policy/threshold 行为稳定、无未定义状态 |
| P3-02 | planner + prepare-job | 实现 CoW fork / candidate build / background LLM summarize seam；复用 `CompactBoundaryManager` 与 `llm-wrapper` `LLMExecutor`/gateway interface，而不是自造 provider API | `src/async-compact/{planner,prepare-job}.ts`, companion `workspace-context-artifacts` exports | prepare path 可被 fake provider 驱动 | unit tests | current turn 不被 destructive mutate；fake provider 可覆盖 timeout / error |
| P3-03 | committer + version-history + fallback | 实现 DO transaction commit、snapshot 保存、hard-threshold sync fallback；严格消费 B2 `DOStorageAdapter` truth，不碰 D1 tx | `src/async-compact/{committer,version-history,fallback}.ts` | COMMIT / rollback / fallback 成立 | unit + integration tests | F04/F06/F08 均有对应自动测试 |
| P3-04 | lifecycle event seam | 实现 `events.ts`，先提供内部 lifecycle event builder / adapter seam；若 B5 catalog 尚未落地，则不直接依赖未知 `HookEventName` | `src/async-compact/events.ts` | B4 不被 B5 阻塞，但保留可接 catalog 的明确 seam | unit tests | 不在 B4 内偷改 hooks catalog；B5 可直接接入 |

### 4.4 Phase 4 — `inspector-facade/` + session edge mount

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | usage/report/auth/redact | 实现 `UsageReport` builder、policy snapshot、bearer/IP allowlist、secret redact filter | `src/inspector-facade/{types,usage-report,inspector-auth,inspector-redact}.ts` | inspector 不只是 route shell | unit tests | claude-code-shape usage report + nano-agent 扩展字段成立 |
| P4-02 | HTTP/WS route surface | 实现 `/inspect/sessions/:id/context/{usage,layers,policy,snapshots,compact-state}` + WS stream；严格使用 lowercase header constants | `src/inspector-facade/{http-route,ws-route}.ts` | context-specific inspection surface 成立 | unit tests | binding-F02 lowercase law 可测 |
| P4-03 | route mount + session worker 接线 | `route-mount.ts` 提供 conditional mount helper，并在 `session-do-runtime` worker entry / routes 中接出 `/inspect/...` 前缀 | `src/inspector-facade/route-mount.ts`, `packages/session-do-runtime/src/{routes,worker,index}.ts` | facade 可以按 env flag 显式挂载 | integration tests | 默认关闭、启用时路由可达、未启用时攻击面为零 |

### 4.5 Phase 5 — Integration companion changes + package tests

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | kernel compact seam | 在 kernel scheduler/runner/types 中补最小 compact orchestration seam：turn boundary 检查 `shouldArm/tryArm/tryCommit/forceSyncCompact`；不把 context-management 逻辑塞回 kernel reducer | `packages/agent-runtime-kernel/src/{types,scheduler,runner,index}.ts` | async-compact 真进入 turn loop | integration tests | kernel 只接 decision seam，不吸收 B4 业务逻辑 |
| P5-02 | workspace / snapshot bridge | 若 B4 需要 context tag / snapshot reason / compact boundary export，补最窄 companion change；继续复用现有 builder/manager | `packages/workspace-context-artifacts/src/{context-layers,compact-boundary,snapshot,index}.ts` | B4 能无 duplication 地消费 foundations | package tests | `workspace-context-artifacts` 职责不被重写 |
| P5-03 | placement companion writeback | 若 `async-compact` / `inspector-facade` 需要 tag-aware placement truth，优先复用 `storage-topology` 现有 `placement.ts` / `promotion-plan.ts`；若 generic table 无法表达，再做最窄 context-specific helper，而不是把 router 搬回新包 | `packages/storage-topology/src/{placement,promotion-plan,index}.ts` | B4 可消费 placement truth 且不回退到包内 router | package tests | charter r2 的边界保持成立 |
| P5-04 | package / integration tests | 新增 `budget` / `async-compact` / `inspector-facade` / integration tests，并补必要 companion package tests | `packages/context-management/test/**` + affected packages | B4 不是纸面 package | package tests + cross-package smoke | fake provider 生命周期、route mount、kernel seam 至少各有 1 条自动测试 |

### 4.6 Phase 6 — Docs / changelog / validation / handoff closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P6-01 | package docs / changelog / design drift 回填 | 完成 `README.md` / `CHANGELOG.md` / package exports 文档；若执行位置与 P3-hybrid-storage / async-compact / inspector design 有 drift，则同步修订 | `packages/context-management/*`, `docs/design/after-foundations/P3-*.md` | code/doc/package truth 一致 | doc review | 不留“设计说 A、代码做 B” |
| P6-02 | downstream handoff | 明确 B5 要消费哪些 producer reality，B6 要解决哪些 inspector/cross-seam 问题，B7/B8 如何验证/继承 B4 | action-plan / sibling docs / issues | 下游 phase 无需重解释 B4 | 人工核对 | B5/B6/B7/B8 各至少有 1 条明确输入 |

---

## 5. 测试与验证策略

### 5.1 必跑 package 命令

| 包 | 命令 | 目的 |
|---|---|---|
| `@nano-agent/context-management` | `pnpm --filter @nano-agent/context-management test` | 新包 unit/integration 回归 |
| `@nano-agent/context-management` | `pnpm --filter @nano-agent/context-management typecheck` | 新包 surface / imports / types |
| `@nano-agent/context-management` | `pnpm --filter @nano-agent/context-management build` | TS emit |
| `@nano-agent/workspace-context-artifacts` | `pnpm --filter @nano-agent/workspace-context-artifacts test` | bridge companion changes |
| `@nano-agent/workspace-context-artifacts` | `pnpm --filter @nano-agent/workspace-context-artifacts typecheck` | cross-package types |
| `@nano-agent/workspace-context-artifacts` | `pnpm --filter @nano-agent/workspace-context-artifacts build` | TS emit |
| `@nano-agent/agent-runtime-kernel` | `pnpm --filter @nano-agent/agent-runtime-kernel test` | turn loop compact seam 回归 |
| `@nano-agent/agent-runtime-kernel` | `pnpm --filter @nano-agent/agent-runtime-kernel typecheck` | scheduler/runner types |
| `@nano-agent/agent-runtime-kernel` | `pnpm --filter @nano-agent/agent-runtime-kernel build` | TS emit |
| `@nano-agent/session-do-runtime` | `pnpm --filter @nano-agent/session-do-runtime test` | `/inspect/...` mount 与 route 回归 |
| `@nano-agent/session-do-runtime` | `pnpm --filter @nano-agent/session-do-runtime typecheck` | route mount imports |
| `@nano-agent/session-do-runtime` | `pnpm --filter @nano-agent/session-do-runtime build` | TS emit |

### 5.2 按改动范围追加的 companion package 验证

| 包 | 何时需要 | 命令 |
|---|---|---|
| `@nano-agent/storage-topology` | 若写回 placement/promotion helper | `pnpm --filter @nano-agent/storage-topology test && pnpm --filter @nano-agent/storage-topology typecheck && pnpm --filter @nano-agent/storage-topology build && pnpm --filter @nano-agent/storage-topology build:schema && pnpm --filter @nano-agent/storage-topology build:docs` |
| `@nano-agent/eval-observability` | 若 inspector facade 需要 narrow helper/export | `pnpm --filter @nano-agent/eval-observability test && pnpm --filter @nano-agent/eval-observability typecheck && pnpm --filter @nano-agent/eval-observability build` |
| `@nano-agent/hooks` | 仅当 B4 不得不碰 hooks adapter seam | `pnpm --filter @nano-agent/hooks test && pnpm --filter @nano-agent/hooks typecheck && pnpm --filter @nano-agent/hooks build && pnpm --filter @nano-agent/hooks build:schema && pnpm --filter @nano-agent/hooks build:docs` |

### 5.3 视改动范围追加的 root 验证

| 命令 | 何时需要 | 目的 |
|---|---|---|
| `node --test test/*.test.mjs` | 若 root contract tests 直接消费新 package exports / session edge truth | root contract regression |
| `pnpm test:cross` | 若 B4 integration 进入现有 root cross/e2e harness | cross-package smoke |

### 5.4 B4 必须新增/更新的测试类型

- `packages/context-management/test/budget/*.test.ts`
  - default policy
  - env override
  - `reserveForResponse` / headroom calculation
- `packages/context-management/test/async-compact/*.test.ts`
  - threshold / scheduler state transitions
  - planner CoW fork non-mutation
  - prepare-job fake provider happy/timeout/error path
  - committer DO transaction happy / rollback / oversize promotion path
  - fallback sync compact path
- `packages/context-management/test/inspector-facade/*.test.ts`
  - usage report shape
  - lowercase header law
  - auth / redact
  - route mount enabled vs disabled
  - duplicate caveat before B6 dedup
- `packages/context-management/test/integration/*.test.ts`
  - fake provider driven 4-stage lifecycle
  - kernel turn-boundary compact seam
  - `/inspect/...` route + WS stream smoke
- `packages/workspace-context-artifacts/test/**`
  - if new context tag / snapshot reason / compact export is added
- `packages/session-do-runtime/test/**`
  - route parser / worker mount smoke for `/inspect/...`
- `packages/agent-runtime-kernel/test/**`
  - compact scheduler signals / runner integration

---

## 6. 风险与注意事项

### 6.1 执行风险表

| 风险 | 等级 | 说明 | 控制措施 |
|---|---|---|---|
| 新包 scope 再次膨胀 | high | 若把 hybrid router / workspace primitives / inspector primitives 全塞回新包，会重切 foundations | Phase 1 先做 scope freeze；charter r2 为唯一真相 |
| `budget/` 无 design 导致实现临场发明 | high | async-compact 与 inspector 会围绕它反复返工 | 用 Phase 1 明确冻结最小 surface |
| hooks 顺序依赖被忽略 | high | 现有 `HookEventName` 是 strict union，B4 无法假装 B5 已完成 | 将 B5 依赖写成 explicit gate / seam |
| inspector dedup 被误报已完成 | high | 当前 `SessionInspector` 无 dedup；facade 若默认 dedup 会产生错误承诺 | B4 明确 duplicate caveat，B6 再完成真正 writeback |
| new package only-green-in-isolation | high | B4 是 orchestration package，若不接 kernel/session/workspace，价值为零 | 强制 integration + companion package tests |
| 过度修改 `workspace-context-artifacts` / `storage-topology` | medium | 容易顺手把 B5/B6/worker-matrix 工作提前做掉 | companion changes 只做最小承接 |

### 6.2 B4 特别注意的 7 个约束

1. **charter r2 高于旧落点**：`P3-context-management-hybrid-storage.md` 的 mapping 值得保留，但其实现位置不能覆盖当前 charter
2. **`budget/` 必须从现有 assembler reality 长出来**：不要另起一套脱离 `reserveForResponse` 的 token 心智
3. **F04/F06/F08 是 async-compact 的硬约束**：commit 只能走 DO tx，summary 必须 size-aware
4. **`SessionInspector` 是 wrap seam，不是待重写对象**
5. **B4 不能偷做 B5/B6**：hook catalog 扩展、dedup、NACP 都不是这个 phase 的 code ownership
6. **route mount 必须 default disabled**：inspection surface 是 dev/staging seam，不是默认对外端口
7. **如果 `storage-topology` 现有 placement 表达不了 B4 所需 truth，优先加 narrow helper，不要把 router 搬回新包**

---

## 7. Definition of Done（B4）

| 维度 | DoD | Status |
|---|---|---|
| 包骨架 | `@nano-agent/context-management` 已成为正式 workspace package | `待完成` |
| 预算治理 | `budget/` surface 已冻结并可被 async-compact / inspector 共用 | `待完成` |
| 异步压缩 | `async-compact/` 4 阶段 + fallback + version-history 已有真实实现与 fake-provider 测试 | `待完成` |
| 检查面 | `inspector-facade/` 已提供 context-specific HTTP/WS surface，并 wrap `SessionInspector` | `待完成` |
| 集成 | kernel / session edge / workspace bridge 至少完成最小接线 | `待完成` |
| 文档 | package README / changelog / P3 design drift 已收口 | `待完成` |
| handoff | B5/B6/B7/B8 follow-up 已明确 | `待完成` |

---

## 8. Action-plan-level exit criteria

| # | Criterion | 说明 |
|---|---|---|
| 1 | `packages/context-management/` 已存在且能 build/typecheck/test | 新包完成最小成立 |
| 2 | `budget/` 已冻结 `BufferPolicy` / `CompactPolicy` / override surface | 缺失 design 被补成现实 contract |
| 3 | `async-compact/` 已 conform `PX-async-compact-lifecycle-spec.md` 的 state machine | B4 主体行为成立 |
| 4 | `committer.ts` 只通过 B2 DO storage seam 完成 atomic swap，不使用 D1 tx | F04/F06 writeback 完成 |
| 5 | `inspector-facade/` 已 wrap `SessionInspector` 并提供 conditional `/inspect/...` mount | inspection surface 成立 |
| 6 | B4 已对 hooks strict union 与 inspector dedup 依赖给出显式解决方式 | 顺序依赖不再隐藏 |
| 7 | `workspace-context-artifacts` / `agent-runtime-kernel` / `session-do-runtime` companion seam 已闭合 | B4 不是孤立 package |
| 8 | 所有受影响 package 的现有验证命令全通过 | package-level 闭合 |
| 9 | B5/B6/B7/B8 downstream input 已写清楚 | 后续 phase 可直接消费 |

---

## 9. B4 对下游 phase 的直接输出

| 下游 phase | B4 输出 | 为什么重要 |
|---|---|---|
| **B5** | async compact 的真实 producer reality：lifecycle event seam、payload builders、blocking/non-blocking 边界 | B5 不能在没有 producer reality 的情况下冻结 class-D catalog |
| **B6** | inspector facade 对 dedup / lowercase headers / non-NACP route 的真实消费点 | B6 需要据此完成 `SessionInspector` dedup 与 NACP 边界收口 |
| **B7** | 待 round-2 验证项：real worker async lifecycle、inspector route real deploy、cross-colo freshness caveat | B4 先建立 contract，B7 再验证 platform reality |
| **B8 / worker-matrix** | `context-management` package 作为 future `context.core` 的 in-package prototype | worker matrix 可直接包一层 worker shell，而不是重新发明 context runtime |

---

## 10. 关闭前提醒

- B4 的真正目标是 **新建一个 context runtime package**，不是重新切 foundations 包边界
- `budget/` 缺 design 不是理由去跳过它；相反，这正是 B4 Phase 1 必须先做 contract freeze 的原因
- `P3-context-management-hybrid-storage.md` 仍然重要，但它在 B4 中应被理解为 **mapping/evidence 输入**，而不是“把 router 放回新包”的许可
- 如果实现中发现必须修改 hooks catalog 才能让 B4 站住脚，说明顺序依赖已经碰到边界，应显式转成 B5 前置，而不是在 B4 内顺手吞掉

