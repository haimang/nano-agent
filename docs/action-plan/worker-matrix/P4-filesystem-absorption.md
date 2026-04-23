# P4 — filesystem-core Absorption + Host-Local Posture

> 服务业务簇: `worker-matrix / Phase 4 — filesystem-core Absorption`
> 计划对象: `D04(filesystem-core D1 WCA filesystem slice + D2 storage-topology residual 吸收 + Q4a host-local posture + mixed helper artifact 迁出 + tenant wrapper 不绕过守护)`
> 类型: `migration`(D1 slice + D2 整包 byte-identical)+ `modify`(WCA split 完成 filesystem 部分)+ `new`(`workers/filesystem-core/src/` 真实 runtime + posture 决策 PR)
> 作者: `Claude Opus 4.7 (1M context)`
> 时间: `2026-04-23`
> 文件位置:
> - `workers/filesystem-core/src/{types,paths,refs,artifacts,prepared-artifacts,promotion,mounts,namespace,backends,evidence-emitters-filesystem,storage}/**`
> - `workers/filesystem-core/test/**`
> - `packages/workspace-context-artifacts/**`(D1 filesystem slice 迁;packages 保留 D1 duplicate 直到 P5)
> - `packages/storage-topology/**`(D2 整包吸收;packages 保留直到 P5)
> - `workers/filesystem-core/{package.json, wrangler.jsonc}`
> 关联设计 / 调研文档:
> - `docs/plan-worker-matrix.md` §4.4 / §5.3 P4.A-P4.C / §6.4(P4 DoD)
> - `docs/design/worker-matrix/D04-filesystem-core-absorption-and-posture.md` v0.1
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`(D1 代表 blueprint,与 C2 成对)
> - `docs/design/worker-matrix/blueprints/D2-storage-topology-residual-absorption-blueprint.md`(P0 补齐)
> - `docs/issue/worker-matrix/P3-closure.md`(P4 kickoff gate — 可与 P3 并行)
> - `docs/eval/worker-matrix/filesystem-core/index.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

P4 与 P3 可并行(W3 blueprint 已把 WCA split 的 C2 / D1 分清,mixed helper owner 表在 D03 §4.1 / D04 §4.1 已明确)。P3 吸收 context slice + mixed helper 的 context 部分(assembly / compact / snapshot);P4 吸收 filesystem slice + mixed helper 的 filesystem 部分(artifact)+ D2 整包(`storage-topology`)。

P4 的关键约束是 **workspace truth 单一源** + **tenant wrapper 不绕过**(B9 契约):bash.core / context.core / filesystem.core / agent.core 共用同一套 `WorkspaceNamespace` + `MountRouter` + `backends/*` + `refs/*` + `promotion/*` 行为,不得 fork;所有 storage use-site 仍必须经 `getTenantScopedStorage()`。

Posture 已定为 **Q4a host-local 继续**(charter §7 Q4):不建 `workspace.fs.*` remote RPC family 为 shipped runtime;不升级 W1 RFC;不取消 `FILESYSTEM_CORE` wrangler 注释;`ReferenceBackend.connected` 默认保持 `false`。

- **服务业务簇**:`worker-matrix / Phase 4 — filesystem-core absorption`
- **计划对象**:D1 WCA filesystem slice + mixed helper artifact 部分 + D2 storage-topology residual + Q4a 显式 + tenant wrapper 守护
- **本次计划解决的问题**:
  - `workers/filesystem-core/src/index.ts` 仍是 version-probe;无 filesystem runtime`
  - D1 filesystem slice 未迁;mixed helper artifact 部分仍在 packages`
  - D2 `storage-topology` 整包仍在 packages;tenant wrapper 物理归属不在 workers`
  - Q4a "host-local 继续" 在 wrangler / composition / 文档层面未显式落盘`
  - `ReferenceBackend.connected: false` 默认未在 kickoff PR 里文档化`
- **本次计划的直接产出**:
  - `workers/filesystem-core/src/` 含:types / paths / refs / artifacts / prepared-artifacts / promotion / mounts / namespace / backends / storage(D1 slice + D2)+ `evidence-emitters-filesystem.ts`(mixed helper artifact 部分)
  - Q4a 显式:wrangler `FILESYSTEM_CORE` 保持注释;composition 层注释说明 "host-local"
  - tenant wrapper 绝对守护:所有 storage 调用经 `getTenantScopedStorage`
  - posture 决策 PR merged
  - `workers/filesystem-core` dry-run 绿;preview 可 defer
  - W3 pattern 第 3 placeholder(循环引用)若 P3 未回填则 P4 补

---

## 1. 执行综述

### 1.1 总体执行方式

**组内序列**:D1 WCA filesystem slice + mixed helper artifact 部分 → D2 整包 → posture 决策 + tenant wrapper 守护 → preview dry-run(可 defer deploy) → closure。组间与 P3 并行;WCA split 的执行须与 P3 Phase 2 交叉核对(mixed helper 不 overlap)。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 0 | P4 kickoff gate check | `XS` | P2 closed(live loop 绿)+ WCA split 代表 blueprint 最新 + tenant wrapper 契约确认 | P2 closed(P3 可并行)|
| Phase 1 | D1 WCA filesystem slice 吸收 | `L` | `packages/workspace-context-artifacts/src/{types,paths,refs,artifacts,prepared-artifacts,promotion,mounts,namespace}.ts` + `backends/*` → `workers/filesystem-core/src/` | Phase 0 |
| Phase 2 | mixed helper artifact 部分迁出 | `S` | `evidence-emitters.ts` 的 artifact 部分 → `workers/filesystem-core/src/evidence-emitters-filesystem.ts`;与 P3 mixed helper 切分交叉核对 | Phase 1 |
| Phase 3 | D2 storage-topology 整包吸收 | `M` | `packages/storage-topology/src/{tenant*,placement,adapters,calibration}/**` → `workers/filesystem-core/src/storage/**` | Phase 2 |
| Phase 4 | Q4a posture + tenant wrapper 显式 | `S` | 代码 + 文档显式 Q4a;`FILESYSTEM_CORE` wrangler 注释保持;`ReferenceBackend.connected: false` 默认确认;tenant wrapper 全部 use-site 经 `getTenantScopedStorage` | Phase 3 |
| Phase 5 | `workers/filesystem-core` dry-run(preview 可 defer)| `XS` | dry-run 绿 | Phase 4 |
| Phase 6 | 全仓回归 + W3 pattern 第 3 placeholder(若 P3 未填)+ P4 closure | `S` | 全绿 + closure memo | Phase 1-5 |

### 1.3 Phase 说明

1. **Phase 0 — kickoff gate**:P2 DoD 绿 + live loop preview URL 仍可用 + WCA split 代表 blueprint / mixed helper owner 表与 P3 交叉无 overlap
2. **Phase 1 — D1 WCA filesystem slice**:9 个 `.ts` + `backends/{memory,reference,types}.ts` 搬到 `workers/filesystem-core/src/`;保持 byte-identical;`MountRouter + WorkspaceNamespace + backends + refs + promotion` 完整迁;packages 保留 duplicate(共存期)
3. **Phase 2 — mixed helper artifact 部分**:`evidence-emitters.ts` 的 artifact 类 helper(buildArtifactEvidence / emitArtifact / 以及 2 结构类型中的 filesystem 归属那条)→ `workers/filesystem-core/src/evidence-emitters-filesystem.ts`;**与 P3 context slice 切分不 overlap**;packages 侧保留的 context 部分在 P3 已切,本 phase 切走 filesystem 部分后 packages evidence-emitters 可以保留 re-export 或 stub
4. **Phase 3 — D2 storage-topology**:整包搬;包含 `tenant*`(B9 契约核心)/`placement` / `adapters` / `calibration`;tenant wrapper(`getTenantScopedStorage` / `tenantDoStorage*` / `tenantKvStorage*` / `tenantR2Storage*`)完整保留;use-site 必须仍在 bash.core / agent.core / context.core / filesystem.core 中经 wrapper 调;grep 验证
5. **Phase 4 — Q4a posture + tenant wrapper 显式**:
   - `workers/agent-core/wrangler.jsonc` `FILESYSTEM_CORE` binding 仍注释;workers/agent-core composition 的 workspace handle 仍 `composeWorkspaceWithEvidence` host-local 版本;加注释 "per charter Q4a"
   - `ReferenceBackend.connected: false` 默认 unchanged;加注释
   - 写一条 grep guard:`grep -r "storage.put\|storage.get\|storage.list" workers/*/src/` 预期每处都有 `getTenantScopedStorage` 作前置(或通过 adapter);违规 0
   - `docs/design/worker-matrix/D04` 若需要 v0.2 校准,本 phase 补
6. **Phase 5 — preview dry-run**:`pnpm --filter workers/filesystem-core run deploy:dry-run` 绿;preview deploy 可 defer(charter §6.4 允许);若 deploy,URL + Version ID 记录
7. **Phase 6 — 回归 + closure**:B7 LIVE + 98 root + 112 cross + P2 两条 e2e + 四 workers test + dry-run 全绿;若 WCA split 在 P3 未遇循环引用,P4 执行中若遇则回填 W3 pattern 第 3 placeholder;写 `docs/issue/worker-matrix/P4-closure.md`

### 1.4 执行策略说明

- **执行顺序原则**:Phase 序列;Phase 2(mixed helper filesystem)可与 Phase 1 合并 PR;D2(Phase 3)独立 PR
- **风险控制原则**:tenant wrapper grep guard 硬闸;workspace truth 单一源(bash/context/agent 三处不得 fork namespace 行为)
- **测试推进原则**:每 PR 跑 B7 LIVE + workspace unit + backends tests + P2 e2e;Phase 5 跑 dry-run
- **文档同步原则**:D04 若漂移 v0.2 补;Q4a 代码注释 + wrangler 注释双落盘

### 1.5 本次 action-plan 影响目录树

```text
worker-matrix/P4/
├── Phase 1 — D1 WCA filesystem slice 吸收/
│   ├── workers/filesystem-core/src/
│   │   ├── types.ts
│   │   ├── paths.ts
│   │   ├── refs.ts
│   │   ├── artifacts.ts
│   │   ├── prepared-artifacts.ts
│   │   ├── promotion.ts
│   │   ├── mounts.ts
│   │   ├── namespace.ts
│   │   └── backends/{memory.ts, reference.ts, types.ts}
│   └── workers/filesystem-core/test/ [D1 tests]
├── Phase 2 — mixed helper artifact 部分迁出/
│   └── workers/filesystem-core/src/evidence-emitters-filesystem.ts
├── Phase 3 — D2 storage-topology 整包吸收/
│   ├── workers/filesystem-core/src/storage/
│   │   ├── tenant-do-storage.ts
│   │   ├── tenant-kv-storage.ts
│   │   ├── tenant-r2-storage.ts
│   │   ├── placement/**
│   │   ├── adapters/**
│   │   └── calibration/**
│   └── workers/filesystem-core/test/storage/
├── Phase 4 — Q4a posture + tenant wrapper 守护/
│   ├── workers/agent-core/wrangler.jsonc       [FILESYSTEM_CORE 保持注释 + 注释解释 Q4a]
│   ├── workers/agent-core/src/host/composition/index.ts  [comment: workspace host-local per Q4a]
│   └── grep guard 脚本 / PR review gate(tenant wrapper 不绕过)
├── Phase 5 — dry-run + (可选) preview/
│   └── workers/filesystem-core  [deploy:dry-run 或 deploy:preview + URL/Version ID]
└── Phase 6 — closure/
    ├── docs/issue/worker-matrix/P4-closure.md
    └── docs/design/pre-worker-matrix/W3-absorption-pattern.md  [第 3 placeholder 回填 if applicable]
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** Phase 1:`packages/workspace-context-artifacts/src/{types,paths,refs,artifacts,prepared-artifacts,promotion,mounts,namespace}.ts` + `backends/{memory,reference,types}.ts` → `workers/filesystem-core/src/**`;tests 对应迁
- **[S2]** Phase 2:`evidence-emitters.ts` artifact 部分(+ 相关 2 结构类型的 filesystem 归属)→ `workers/filesystem-core/src/evidence-emitters-filesystem.ts`;packages 原文件 context 部分(P3 已切)+ filesystem 部分 diff 最小化
- **[S3]** Phase 3:`packages/storage-topology/src/{tenant*,placement,adapters,calibration}/**` → `workers/filesystem-core/src/storage/**`;tests 对应迁
- **[S4]** Phase 4:
  - `workers/agent-core/wrangler.jsonc` `FILESYSTEM_CORE` binding **保持注释**(per Q4a);注释中加 reason
  - `workers/agent-core/src/host/composition/index.ts` workspace handle 装配处加注释 "per charter Q4a:workspace host-local,不走 FILESYSTEM_CORE 远端"
  - `ReferenceBackend.connected: false` 默认不变;加注释 "per charter Q4a default;opt-in 由 owner gate"
  - **tenant wrapper 不绕过 guard**:新增一个 grep / review gate(或 CI check),验证 bash.core / agent.core / context.core / filesystem.core 所有 storage use-site 都经 `getTenantScopedStorage`;违规 0
- **[S5]** Phase 5:`workers/filesystem-core` dry-run 绿;preview 可 defer(Phase 6 closure 注明)
- **[S6]** Phase 6:B7 LIVE + 98 root + 112 cross + P2 两条 e2e + 四 workers test + dry-run 全绿;W3 pattern 第 3 placeholder 若 P3 未填,P4 若遇则填
- **[S7]** P4 closure memo

### 2.2 Out-of-Scope

- **[O1]** `workspace.fs.*` remote RPC family shipped runtime(W1 RFC 继续 direction-only)
- **[O2]** 取消注释 `FILESYSTEM_CORE` wrangler binding(Q4a host-local;除非 posture 决策改变,本 phase 不激活)
- **[O3]** `ReferenceBackend.connected: true` 默认(owner gate)
- **[O4]** filesystem-core remote service preview deploy **激活** agent-core 对 filesystem 的 binding(Q4a 保持 host-local)
- **[O5]** D09 Tier B DEPRECATED banner(归 P5)
- **[O6]** 物理删除 packages(归 下一阶段)
- **[O7]** `storage.put/get/list` 绕过 tenant wrapper(B9 契约)
- **[O8]** 改 `MountRouter` / `WorkspaceNamespace` API shape(保留 byte-identical)
- **[O9]** 改 NACP wire / schema / tenant law(B9 / W0)

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `FILESYSTEM_CORE` wrangler 激活 | `out-of-scope P4` | Q4a host-local;激活要走独立 posture charter | charter Q4 重评 |
| `ReferenceBackend.connected: true` 默认 | `out-of-scope` | owner gate | NOT revisit |
| tenant wrapper 绕过 | `forbidden` | B9 硬约束 | NOT revisit |
| `workspace.fs.*` shipped | `out-of-scope` | W1 RFC direction | charter O2 |
| mixed helper artifact 迁 filesystem-core | `in-scope` | D04 §4.1 表 | — |
| packages 物理删 | `out-of-scope` | 共存期 | 下一阶段 |
| filesystem-core real preview deploy | `in-scope / can defer` | Q4a host-local,deploy 非硬需 | closure memo 明 |
| `MountRouter` shape 改 | `out-of-scope` | byte-identical | NOT revisit |
| storage-topology `tenant*` API shape 改 | `out-of-scope` | B9 契约 | NOT revisit |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P0-01 | Phase 0 | kickoff gate check | check | P2 closure + WCA blueprint + tenant wrapper 契约 | 全 ✓ | low |
| P1-01 | Phase 1 | D1 slice 9 .ts 搬 | migration | `packages/workspace-context-artifacts/src/{types,paths,refs,artifacts,prepared-artifacts,promotion,mounts,namespace}.ts` → `workers/filesystem-core/src/**` | byte-identical | high |
| P1-02 | Phase 1 | D1 backends 搬 | migration | `.../backends/{memory,reference,types}.ts` → `workers/filesystem-core/src/backends/` | byte-identical | medium |
| P1-03 | Phase 1 | D1 tests 搬 | migration | filesystem-related WCA tests → `workers/filesystem-core/test/` | 全绿 | medium |
| P2-01 | Phase 2 | mixed helper artifact 切 | migration + split | `evidence-emitters.ts` artifact 部分 → `workers/filesystem-core/src/evidence-emitters-filesystem.ts` | context / filesystem 两端不 overlap | high |
| P2-02 | Phase 2 | packages WCA index.ts 更新 | update | `packages/workspace-context-artifacts/src/index.ts` | re-export 或 duplicate 维持老 consumer | medium |
| P3-01 | Phase 3 | D2 storage-topology src 搬 | migration | `packages/storage-topology/src/{tenant*,placement,adapters,calibration}/**` → `workers/filesystem-core/src/storage/**` | tenant wrapper byte-identical | high |
| P3-02 | Phase 3 | D2 tests 搬 | migration | `packages/storage-topology/test/**` → `workers/filesystem-core/test/storage/` | 全绿 | medium |
| P4-01 | Phase 4 | wrangler 注释 + reason | update | `workers/agent-core/wrangler.jsonc` | `FILESYSTEM_CORE` 保持注释 + 写 "Q4a host-local" reason | low |
| P4-02 | Phase 4 | composition 注释 | update | `workers/agent-core/src/host/composition/index.ts` | workspace handle 装配加 "per Q4a" 注释 | low |
| P4-03 | Phase 4 | `ReferenceBackend.connected: false` 注释 | update | `workers/filesystem-core/src/backends/reference.ts` | default 不变 + reason 注释 | low |
| P4-04 | Phase 4 | tenant wrapper grep guard | new | 可选 CI / review gate | 四 workers 所有 storage use-site 经 `getTenantScopedStorage`;违规 0 | medium |
| P5-01 | Phase 5 | dry-run | test | `workers/filesystem-core` | 绿 | low |
| P5-02 | Phase 5 | preview deploy(可 defer)| optional | `workers/filesystem-core` | URL live 或 defer note | medium |
| P6-01 | Phase 6 | 全仓回归 | test | 全仓 | B7 LIVE + 98 root + 112 cross + P2 e2e + 四 workers test + dry-run 全绿 | medium |
| P6-02 | Phase 6 | W3 pattern 第 3 placeholder(可选)| update | `docs/design/pre-worker-matrix/W3-absorption-pattern.md` | 若 P3 未填,P4 遇则填 | low |
| P6-03 | Phase 6 | P4 closure memo | add | `docs/issue/worker-matrix/P4-closure.md` | DoD 证据 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 0 — gate check

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P0-01 | gate check | P2 DoD 绿 + live loop preview URL 可 curl + WCA split 代表 blueprint v 最新 + tenant wrapper 契约(B9)口径一致 | P2 closure + blueprint + B9 closure | 全 ✓ | 目视 + curl | ✓ |

### 4.2 Phase 1 — D1 WCA filesystem slice 吸收

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | 9 .ts 搬 | `cp packages/workspace-context-artifacts/src/{types,paths,refs,artifacts,prepared-artifacts,promotion,mounts,namespace}.ts workers/filesystem-core/src/` | workers/filesystem-core/src/ | 9 文件齐 | `pnpm --filter workers/filesystem-core typecheck` 绿 | 9 在 |
| P1-02 | backends 搬 | `cp packages/workspace-context-artifacts/src/backends/* workers/filesystem-core/src/backends/` | workers/filesystem-core/src/backends/ | 3 文件齐 | typecheck 绿 | 3 在 |
| P1-03 | tests 搬 | filesystem-related WCA tests → `workers/filesystem-core/test/` | workers/filesystem-core/test/ | tests 齐 | `pnpm --filter workers/filesystem-core test` | 全绿 |
| P1-04 | import rewrite | 内部相对 import 保持;对 mixed helper context 部分(P3 已迁)的引用改为从 `workers/context-core` 的 alias import;对 mixed helper filesystem 部分(Phase 2)预留 import | 被搬 .ts | 无 dangling | typecheck 绿 | — |
| P1-05 | 全仓回归 | B7 LIVE + 98 root + 112 cross + P2 e2e + 三 workers test(含 agent/bash/context)+ dry-run | 全仓 | 全绿 | 命令组 | 0 failure |

### 4.3 Phase 2 — mixed helper artifact 部分迁出

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | artifact helper 切 | 按 D04 §4.1 owner 表切:artifact 类 helper(buildArtifactEvidence / emitArtifact 等)→ `workers/filesystem-core/src/evidence-emitters-filesystem.ts` | packages + workers | context / filesystem 不 overlap | `grep "buildArtifactEvidence" workers/filesystem-core/src/` ≥ 1;`grep ... packages/workspace-context-artifacts/src/evidence-emitters.ts` == 0(若完全切,否则接受 duplicate 注释) | 切分干净 |
| P2-02 | packages WCA index.ts 更新 | 维护 public API 兼容;共存期 duplicate 允许;如 P3 选择 duplicate 路径,本 phase 对齐 | packages | 老 consumer 不破 | `pnpm -r run test` | 绿 |

### 4.4 Phase 3 — D2 storage-topology 整包吸收

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | D2 src 搬 | `packages/storage-topology/src/{tenant*,placement,adapters,calibration}/**` → `workers/filesystem-core/src/storage/**`;byte-identical | workers/filesystem-core/src/storage | 齐 | typecheck 绿 | 所有 tenant* 文件在 |
| P3-02 | D2 tests 搬 | tests → `workers/filesystem-core/test/storage/` | workers/filesystem-core/test/storage | 齐 | `pnpm --filter workers/filesystem-core test` | 全绿 |
| P3-03 | tenant wrapper API shape 校验 | grep `getTenantScopedStorage` / `tenantDoStorage*` / `tenantKvStorage*` / `tenantR2Storage*` 的 export signature 不漂移 | workers/filesystem-core/src/storage + 所有 use-site | shape 一致 | grep signature 对比 | 0 diff |

### 4.5 Phase 4 — Q4a posture + tenant wrapper 守护

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | wrangler 注释 + reason | `workers/agent-core/wrangler.jsonc` 的 `FILESYSTEM_CORE` slot 继续注释;注释里加 "// kept commented per charter Q4a host-local" | workers/agent-core/wrangler.jsonc | 注释 + reason | grep `Q4a` | ≥ 1 |
| P4-02 | composition 注释 | `workers/agent-core/src/host/composition/index.ts` workspace handle 装配处加注释 "per Q4a: workspace host-local via composeWorkspaceWithEvidence;unused binding FILESYSTEM_CORE remains commented" | composition | comment | grep `Q4a` | ≥ 1 |
| P4-03 | ReferenceBackend 注释 | `workers/filesystem-core/src/backends/reference.ts` default `connected: false` 不变 + 注释 "per Q4a default;opt-in by owner gate" | backends/reference.ts | comment | grep `Q4a` | ≥ 1 |
| P4-04 | tenant wrapper grep guard | 新增 review gate / PR checklist:`grep -rE "this.ctx.storage.(put\|get\|list)" workers/*/src/` 每处必须在 `getTenantScopedStorage` 的 adapter 下;违规 0;建议写 1 条 unit test 验证 composition 调 tenant wrapper 正确 | 四 workers 所有 storage use-site | 无违规 | grep + test | 0 violations |

### 4.6 Phase 5 — preview dry-run(可 defer deploy)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | dry-run | `pnpm --filter workers/filesystem-core run deploy:dry-run` | workers/filesystem-core | 绿 | wrangler dry-run | 0 error |
| P5-02 | preview deploy(可 defer)| 若 owner 决策 Q2 baseline deploy,`deploy:preview` | workers/filesystem-core | URL live 或 defer note | curl | URL 或 note in closure |

### 4.7 Phase 6 — 全仓回归 + closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P6-01 | 全仓回归 | `pnpm -r run test && pnpm --filter './workers/*' run deploy:dry-run && node --test test/*.test.mjs && npm run test:cross` | 全仓 | 全绿 | 命令组 | 0 failure;P2 两条 e2e 仍绿 |
| P6-02 | W3 pattern 第 3 placeholder(可选)| 若 P3 未填,P4 执行中遇到循环引用场景,回填 | `docs/design/pre-worker-matrix/W3-absorption-pattern.md` | 节非空 | grep placeholder | placeholder -1 |
| P6-03 | P4 closure memo | 写 `docs/issue/worker-matrix/P4-closure.md`:D1/D2 LOC / PR link / mixed helper artifact 切分 diff / Q4a 显式落盘证据 / tenant wrapper guard 0 violations / dry-run / preview URL 或 defer note | closure | 300-500 行 | grep DoD | §DoD 全 checked |

---

## 5. Phase 详情

### 5.1 Phase 0 — gate check

- **Phase 目标**:P4 kickoff 前 P2 DoD 绿 + WCA blueprint + B9 tenant wrapper 契约一致
- **本 Phase 对应编号**:`P0-01`
- **收口标准**:全 ✓

### 5.2 Phase 1 — D1 WCA filesystem slice 吸收

- **Phase 目标**:9 `.ts` + 3 backends → workers/filesystem-core;byte-identical
- **本 Phase 对应编号**:`P1-01` 至 `P1-05`
- **本 Phase 新增文件**:`workers/filesystem-core/src/{types,paths,refs,artifacts,prepared-artifacts,promotion,mounts,namespace}.ts` + `backends/{memory,reference,types}.ts` + tests
- **本 Phase 修改文件**:无(packages 原文件不动)
- **具体功能预期**:
  1. 9 `.ts` + 3 backends 齐
  2. `WorkspaceNamespace` / `MountRouter` / `ReferenceBackend` 等 public API shape 不漂移
  3. tests 全绿
- **具体测试安排**:
  - **单测**:`pnpm --filter workers/filesystem-core test`
  - **集成测试**:B7 LIVE / 98 root / 112 cross / P2 两条 e2e 全绿
  - **手动验证**:API shape grep 对比
- **收口标准**:tests 全绿 + shape 一致
- **本 Phase 风险提醒**:
  - `ReferenceBackend` 若在搬迁时 `connected` default 被改成 `true`,会破坏 Q4a;grep 守护
  - mixed helper filesystem 部分先不动(Phase 2 处理)

### 5.3 Phase 2 — mixed helper artifact 部分迁出

- **Phase 目标**:`evidence-emitters.ts` artifact 部分切到 `workers/filesystem-core/src/evidence-emitters-filesystem.ts`;与 P3 context 切分不 overlap
- **本 Phase 对应编号**:`P2-01` `P2-02`
- **本 Phase 新增文件**:`workers/filesystem-core/src/evidence-emitters-filesystem.ts`
- **本 Phase 修改文件**:
  - `packages/workspace-context-artifacts/src/evidence-emitters.ts`(filesystem 部分切后剩 minimal 或全 re-export)
  - `packages/workspace-context-artifacts/src/index.ts`(维持 public API 兼容)
- **具体功能预期**:artifact 类 helper + 相关结构类型在 filesystem-core;context 类在 context-core(P3 已做);packages 侧 evidence-emitters 为共存期空壳或 re-export(视 workspace boundary)
- **具体测试安排**:
  - **单测**:workers/filesystem-core + workers/context-core 分别 test 绿
  - **集成测试**:B7 LIVE + P2 e2e
- **收口标准**:切分干净 + tests 绿
- **本 Phase 风险提醒**:
  - 与 P3 Phase 2 的 context 切分路径交叉 — 如果 P3 Phase 2 选了 "packages duplicate" 策略,本 Phase 也走 duplicate;保持一致

### 5.4 Phase 3 — D2 storage-topology 整包吸收

- **Phase 目标**:`storage-topology` 整包搬;tenant wrapper API shape 不漂移
- **本 Phase 对应编号**:`P3-01` 至 `P3-03`
- **本 Phase 新增文件**:`workers/filesystem-core/src/storage/**` + `test/storage/**`
- **本 Phase 修改文件**:无(packages 原文件不动)
- **具体功能预期**:
  1. `tenant-do-storage.ts` / `tenant-kv-storage.ts` / `tenant-r2-storage.ts` byte-identical
  2. `placement / adapters / calibration` 完整
  3. `getTenantScopedStorage` signature 不改
- **具体测试安排**:
  - **单测**:workers/filesystem-core/test/storage
  - **集成测试**:全仓回归
- **收口标准**:shape 一致 + tests 绿
- **本 Phase 风险提醒**:
  - `tenant*` 任一内部实现漂移会让 B9 契约红;必须 byte-identical

### 5.5 Phase 4 — Q4a posture + tenant wrapper 显式

- **Phase 目标**:Q4a 代码 + wrangler + reference backend 三处注释显式;tenant wrapper 0 违规
- **本 Phase 对应编号**:`P4-01` 至 `P4-04`
- **本 Phase 新增文件**:可选 grep guard script(`scripts/check-tenant-wrapper.sh` 或等价)
- **本 Phase 修改文件**:
  - `workers/agent-core/wrangler.jsonc`
  - `workers/agent-core/src/host/composition/index.ts`
  - `workers/filesystem-core/src/backends/reference.ts`
- **具体功能预期**:
  1. 3 处 `Q4a` 注释存在
  2. wrangler FILESYSTEM_CORE 注释 + reason
  3. `ReferenceBackend.connected: false` 默认 + reason
  4. tenant wrapper grep guard 0 违规
- **具体测试安排**:
  - **手动验证**:`grep -r "Q4a" workers/ | wc -l` ≥ 3;tenant wrapper grep 0 violations
- **收口标准**:4 条全 ✓
- **本 Phase 风险提醒**:
  - tenant wrapper guard 若在 agent-core absorb 时漏覆盖 edge case(如 kernel 直接访问 storage),必须补 adapter 使其经 wrapper

### 5.6 Phase 5 — dry-run + preview(可 defer)

- **Phase 目标**:filesystem-core dry-run 绿;preview defer 允许
- **本 Phase 对应编号**:`P5-01` `P5-02`
- **收口标准**:dry-run 绿;preview URL 或 defer note

### 5.7 Phase 6 — 全仓回归 + closure

- **Phase 目标**:P4 DoD 全绿 + closure shipped
- **本 Phase 对应编号**:`P6-01` `P6-02` `P6-03`
- **收口标准**:charter §6.4 P4 DoD 全 checked

---

## 6. 需要业主 / 架构师回答的问题清单

### Q1 — tenant wrapper grep guard 执行方式

- **影响范围**:Phase 4
- **为什么必须确认**:grep guard 可以 CI 化(GitHub Actions step)、pre-commit hook、PR review checklist;CI 化需额外 .github/workflows 改动
- **当前建议 / 倾向**:**PR review checklist + 写 1 条 unit test**(最小 surface;若未来漂移,CI 化作为 follow-up)
- **Q**:CI 化还是 review + test?
- **A**:_pending_

### Q2 — filesystem-core preview deploy 做不做

- **影响范围**:Phase 5
- **为什么必须确认**:host-local posture 下 preview deploy 非硬要求;但一次 baseline deploy 有利于 P5 production flip 对比
- **当前建议 / 倾向**:**Phase 5 做 baseline preview;不激活 binding**(URL + Version ID 记录即可)
- **Q**:deploy 还是 defer?
- **A**:_pending_

### Q3 — WCA split 最终 packages 形态

- **影响范围**:Phase 2 + 与 P3 对齐
- **为什么必须确认**:P3 Phase 2 选了 "packages duplicate" 还是 "packages re-export 指向 workers" 影响 Phase 2 路径
- **当前建议 / 倾向**:**与 P3 对齐 — packages duplicate 保留直到 P5/D09**
- **Q**:与 P3 同策略?
- **A**:_pending_

### Q4 — W3 pattern 第 3 placeholder 若未遇循环

- **影响范围**:Phase 6
- **为什么必须确认**:如果 P3 + P4 都未遇循环引用,第 3 placeholder 永远填不出;是否留空 / 改写为 "未遇,保留 template"
- **当前建议 / 倾向**:**未遇则在 P4 closure memo 注明 "第 3 placeholder 未触发"**,W3 pattern 文件留空
- **Q**:若未遇,如何处理?
- **A**:_pending_

### 6.2 问题整理建议

- Q1 影响 CI 工程量;Q2 / Q3 影响 PR 负担;Q4 是结论性问题

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| tenant wrapper 绕过 | B9 契约破坏 | `high` | Phase 4 grep guard 0 violations 硬闸 |
| `MountRouter` / `WorkspaceNamespace` shape 漂移 | Phase 1 byte-identical 未守住 | `high` | grep signature 对比 |
| `ReferenceBackend.connected: true` 误改 | Phase 1 / 4 | `medium` | grep + 单测 |
| mixed helper artifact 与 context 部分 overlap | Phase 2 与 P3 交叉 | `high` | D03/D04 §4.1 owner 表严格;PR review 交叉 check |
| `FILESYSTEM_CORE` 意外取消注释 | Phase 4 | `medium` | grep `FILESYSTEM_CORE` 行以 `//` 开头 |
| P2 两条 e2e 红 | Phase 1-4 任一 | `high` | block merge |
| B7 LIVE 红 | 任一 phase | `high` | block |
| workspace cross-import 限制(同 P3 Q1)| Phase 1-3 | `medium` | 同 P3 Q1 策略 |

### 7.2 约束与前提

- **技术前提**:P2 closed;P3 可并行(不强制先完成)
- **运行时前提**:Cloudflare preview deploy 凭证(若 Phase 5 deploy)
- **组织协作前提**:workspace cross-import 策略(与 P3 Q1 同)
- **上线 / 合并前提**:每 phase 独立 PR;B7 LIVE + P2 e2e + tenant wrapper 0 违规 硬闸

### 7.3 文档同步要求

- 需要同步更新的设计文档:
  - `docs/design/worker-matrix/D04-filesystem-core-absorption-and-posture.md`(若执行中漂移,v0.2)
- 需要同步更新的说明文档 / README:
  - `workers/filesystem-core/README.md`(若存在)
- 需要同步更新的测试说明:无

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**:
  - `ls workers/filesystem-core/src/{types.ts,paths.ts,refs.ts,artifacts.ts,prepared-artifacts.ts,promotion.ts,mounts.ts,namespace.ts,backends,storage,evidence-emitters-filesystem.ts}` 全在
  - `grep -r "Q4a" workers/` ≥ 3
  - `grep -vE "^\s*//" workers/agent-core/wrangler.jsonc | grep FILESYSTEM_CORE` == 0(= 仍是注释)
  - tenant wrapper grep guard 0 violations
- **单元测试**:`pnpm -r run test`
- **集成测试**:`pnpm --filter './workers/*' run deploy:dry-run`
- **端到端 / 手动验证**:`node --test test/*.test.mjs`;P2 两条 e2e 仍绿
- **回归测试**:B7 LIVE 5 / 98 root / 112 cross 全绿
- **文档校验**:closure memo §DoD 全 checked

### 8.2 Action-Plan 整体收口标准(= charter §6.4 P4 DoD)

1. `workers/filesystem-core/src/` 含吸收后的 D1 + D2 runtime
2. connected-mode / remote posture 决策 PR merged:**Q4a host-local 继续**(显式)
3. workspace truth 仍单一:bash.core / context.core / filesystem.core / agent.core 均消费同一套 `WorkspaceNamespace`,无 fork
4. `filesystem-core` preview deploy 成功(或 defer 记录)
5. `storage-topology::tenant*` 仍 load-bearing;tenant wrapper 不绕过(grep guard 0 violations)
6. B7 LIVE 5 全绿;P2 两条 e2e 全绿

### 8.3 完成定义(Definition of Done)

| 维度 | 完成定义 |
|------|----------|
| 功能 | D1 slice + D2 整包 + mixed helper artifact 迁入 filesystem-core;Q4a 三处注释落盘;tenant wrapper 0 violations |
| 测试 | B7 LIVE + 98 root + 112 cross + P2 两条 e2e + 四 workers test + dry-run 全绿 |
| 文档 | closure memo shipped;D04 v0.x 与事实一致 |
| 风险收敛 | workspace truth 单一源 + tenant wrapper 守住 + WCA split 干净 |
| 可交付性 | P5 可 kickoff — 全部 4 workers absorb 完成,cutover + deprecation 有输入 |

---

## 9. 执行后复盘关注点

- mixed helper 切分是否真 0 overlap(与 P3)
- tenant wrapper 0 violations guard 是否在 PR review 中被真实 enforce
- `ReferenceBackend.connected: false` 是否在任一 PR 中被误改
- filesystem-core preview deploy 是否最终 deploy 或 defer
- WCA split 在 P3 / P4 两次执行后,packages 侧最终形态

---

## 10. 结语

这份 P4 action-plan 以 **"filesystem-core runtime ownership 从 packages/ 迁到 workers/ + Q4a host-local 显式 + tenant wrapper 0 violations"** 为第一优先级,采用 **"Phase 序列(gate → D1 → mixed helper artifact → D2 → posture/wrapper → dry-run → closure)"** 的推进方式,优先解决 **"workers/filesystem-core 仍 probe / WCA filesystem slice 未迁 / mixed helper artifact 未迁 / D2 整包未吸 / Q4a posture 非显式 / tenant wrapper guard 未硬闸"** 六件欠账,并把 **"B9 tenant wrapper 不绕过 / workspace truth 单一源 / Q4a host-local 保持 / ReferenceBackend.connected: false default / MountRouter shape byte-identical / mixed helper 不 overlap"** 作为主要约束。整个计划完成后,`filesystem.core` 应达到 **"host-local typed substrate 真实 ownership + tenant wrapper 在四 workers 都严格经过 + WCA split 干净 + preview baseline 可选"**,从而为后续的 **P5 cutover + Tier B per-worker deprecation** 提供稳定基础。
