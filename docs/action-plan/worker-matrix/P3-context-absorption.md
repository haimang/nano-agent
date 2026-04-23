# P3 — context-core Absorption + Context Posture

> 服务业务簇: `worker-matrix / Phase 3 — context-core Absorption`
> 计划对象: `D03(context-core C1+C2 吸收 + Q3c compact opt-in posture + D03 F4 `appendInitialContextLayer` 迁出 agent-core host-stub 并 owner 归属 context-core)`
> 类型: `migration`(C1 + C2 slice 吸收 byte-identical)+ `modify`(WCA split + 共存期 re-export)+ `new`(`workers/context-core/src/` 真实 runtime + context posture 决策 PR)
> 作者: `Claude Opus 4.7 (1M context)`
> 时间: `2026-04-23`
> 文件位置:
> - `workers/context-core/src/{budget,async-compact,inspector-facade,context-layers,context-assembler,compact-boundary,redaction,snapshot,evidence-emitters,context-api}/**`
> - `workers/context-core/test/**`
> - `packages/context-management/**`(共存期保留;不动)
> - `packages/workspace-context-artifacts/src/**`(context slice 迁后;C2 → context-core;D1 保留待 P4 吸收)
> - `workers/context-core/{package.json, wrangler.jsonc}`
> - `workers/agent-core/src/host/context-api/` 或等价位置(P2 stub 迁出到 workers/context-core)
> 关联设计 / 调研文档:
> - `docs/plan-worker-matrix.md` §4.3 / §5.3 P3.A-P3.C / §6.3(P3 DoD)
> - `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md` v0.1
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`(C2/D1 split 代表 blueprint)
> - `docs/design/worker-matrix/blueprints/C1-context-management-absorption-blueprint.md`(P0 补齐)
> - `docs/issue/worker-matrix/P2-closure.md`(P3 kickoff gate)
> - `docs/eval/worker-matrix/context-core/index.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

P2 结束时,`agent.core ↔ bash.core` 的 live turn loop 已在 preview env 跑通,`initial_context` consumer 已接线。但 context-core 仍处于 **版本探针 shell + P2 stub 临时落点** 状态:

1. `workers/context-core/src/index.ts` 仍是 W4 version-probe
2. `appendInitialContextLayer` 暂放在 `workers/agent-core/src/host/context-api/`(P2 Phase 1 临时位置),owner 归属不清
3. `packages/context-management/{budget,async-compact,inspector-facade}/` 仍在 packages,workers/context-core 无真实 runtime
4. `packages/workspace-context-artifacts/` 未 split — context slice(C2)与 filesystem slice(D1)共存一包;mixed helper `evidence-emitters.ts` 按 D03/D04 owner 表尚未分配
5. 默认 compact posture 在运行时仍是 "opt-in 未强制"(Q3c 已决策,但 PR 未体现)

P3 的任务是把这些 context-core 欠账一次性闭合:C1(context-management)整包吸收进 `workers/context-core/src/`;C2(workspace-context-artifacts 的 context slice + mixed helper 的 context 部分)slice 到 `workers/context-core/src/`;`appendInitialContextLayer` 物理迁到 workers/context-core(owner 归位);compact opt-in posture 在 composition 层显式落盘(Q3c);`packages/context-management` / `packages/workspace-context-artifacts` 继续 re-export(共存期),P5 才 DEPRECATE。

P3 与 P4 可以并行(C 与 D 的 split 按 W3 blueprint mixed helper owner 表已明确分清),但组内 C1 → C2 → posture 序列。

- **服务业务簇**:`worker-matrix / Phase 3 — context-core absorption`
- **计划对象**:C1 整包 + C2 slice + mixed helper 拆分 + compact posture 显式 + `appendInitialContextLayer` 迁出 agent-core host-stub 归位 context-core
- **本次计划解决的问题**:
  - `workers/context-core/src/index.ts` 仍是 version-probe;无真实 context runtime`
  - `appendInitialContextLayer` stub 在 agent-core 下临时落点,owner 不清`
  - `packages/workspace-context-artifacts` 的 context / filesystem slice 未拆;WCA split 是 P3+P4 共享的 critical step`
  - `evidence-emitters.ts` mixed helper 按 C2/D1 owner 表未实施`
  - compact posture(Q3c opt-in)在 composition 层未被显式落盘 / 代码注释`
- **本次计划的直接产出**:
  - `workers/context-core/src/` 含吸收后的 C1(`budget,async-compact,inspector-facade`)+ C2(`context-layers,context-assembler,compact-boundary,redaction,snapshot` + mixed helper context 部分)
  - `workers/context-core/src/context-api/append-initial-context-layer.ts`(P2 stub 迁出到 context-core)
  - C2 slice 从 `packages/workspace-context-artifacts` 移出,原 package 保留 re-export(共存期)
  - `evidence-emitters.ts` mixed helper:context slice 归 context-core / filesystem slice 保留在 packages(P4 迁)
  - composition 层 compact opt-in 显式代码注释 + 文档注记(Q3c)
  - `packages/context-management` 保留物理存在,未打 DEPRECATED(P5 / D09 才打)
  - W3 pattern spec 第 3 placeholder("循环引用解决 pattern")若在 WCA split 中出现,在此 phase 回填
  - `workers/context-core` preview deploy 成功(或明确记录 defer)

---

## 1. 执行综述

### 1.1 总体执行方式

**组内序列**:C1 整包 → C2 slice → posture 决策 PR;组间与 P4 并行;`evidence-emitters.ts` 在 WCA split 时用 W3 pattern §3.3 mixed helper owner 表划分(context slice → context-core;filesystem slice → P4 带走)。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 0 | P3 kickoff gate check | `XS` | P2 closed + live loop 绿 + WCA split blueprint 最新 | P2 closed |
| Phase 1 | C1 context-management 整包吸收 | `M` | `packages/context-management/{budget,async-compact,inspector-facade}/**` → `workers/context-core/src/**` | Phase 0 |
| Phase 2 | C2 WCA context slice 吸收 | `L` | `packages/workspace-context-artifacts` 的 `context-layers/context-assembler/compact-boundary/redaction/snapshot` + mixed helper context 部分 → `workers/context-core/src/` | Phase 1 |
| Phase 3 | `appendInitialContextLayer` 迁出 agent-core stub | `S` | P2 stub 搬到 `workers/context-core/src/context-api/`;agent-core 改 import 指向 context-core | Phase 2 |
| Phase 4 | compact posture Q3c 显式落盘 | `S` | composition 层代码注释 + 配置段明确 "默认不自动装 createKernelCompactDelegate"(per Q3c);可 opt-in | Phase 2 |
| Phase 5 | `workers/context-core` preview deploy(or defer)| `XS` | 若 posture 决策 host-local-only,可 defer 到 P5;否则 deploy | Phase 4 |
| Phase 6 | 全仓回归 + W3 pattern 第 3 placeholder(若适用)+ P3 closure | `S` | 全绿 + closure memo | Phase 1-5 |

### 1.3 Phase 说明

1. **Phase 0 — kickoff gate check**:P2 DoD 全绿;live loop preview URL 仍有效;WCA split 代表 blueprint 最新;mixed helper owner 表(D03 §4.1 / D04 §4.1)一致
2. **Phase 1 — C1 整包吸收**:`packages/context-management/{src,test}/**` → `workers/context-core/{src,test}/**`,byte-identical;`packages/context-management/` 保留 + 可 re-export 新 workers 位置(或保留原实现 + 供共存期消费者 fallback);W3 pattern §6 bug 先修原包
3. **Phase 2 — C2 WCA context slice**:`packages/workspace-context-artifacts/src/{context-layers,context-assembler,compact-boundary,redaction,snapshot}.ts` → `workers/context-core/src/`;mixed helper `evidence-emitters.ts` 按 D03 §4.1 表切 context 部分(assembly / compact / snapshot 三类 emit helper)迁入 `workers/context-core/src/evidence-emitters-context.ts`;filesystem 部分(artifact)保留在 packages,P4 迁;`packages/workspace-context-artifacts` 保留 re-export,等 D1+D2 在 P4 吸收后一起在 P5 DEPRECATE
4. **Phase 3 — `appendInitialContextLayer` 迁出**:把 P2 临时 stub 从 `workers/agent-core/src/host/context-api/append-initial-context-layer.ts` 搬到 `workers/context-core/src/context-api/append-initial-context-layer.ts`;agent-core consumer(nano-session-do.ts)的 import 改指向 context-core;packages 侧对应消费者同步
5. **Phase 4 — compact posture Q3c**:`workers/agent-core/src/host/composition/index.ts` 的 kernel handle 装配处显式写注释 "per charter Q3c:不默认装 createKernelCompactDelegate;opt-in 由 env `COMPACT_ENABLED=true` 或 config.kernelCompact 开启";添加一条 unit test 验证 default composition 里 kernel 不挂 compact delegate
6. **Phase 5 — context-core preview deploy(或 defer)**:posture 若 host-local-only,D03 §5.2 允许 defer;但建议 P3 末尾仍做一次 dry-run + preview 一键上(wrangler name `nano-agent-context-core`)以获取 preview URL 作 baseline
7. **Phase 6 — 全仓回归 + closure**:B7 LIVE + 98 root + 112 cross + 三 workers test + dry-run 全绿;P2 的两条 root e2e 仍绿(context consumer 应继续观察到 AssemblyEvidence);若 WCA split 遇到循环引用需要 pattern,则回填 W3 pattern 第 3 placeholder;写 `docs/issue/worker-matrix/P3-closure.md`

### 1.4 执行策略说明

- **执行顺序原则**:Phase 序列;Phase 2 WCA split 与 Phase 3 stub 迁出可合并 1 PR 也可分开
- **风险控制原则**:C1 / C2 每 PR 独立可 revert;mixed helper owner 表严格遵守;B7 LIVE + P2 两条 e2e 全程守护
- **测试推进原则**:每 PR 跑 `pnpm --filter workers/context-core test` + B7 LIVE + 98 root + 112 cross + `test/initial-context-live-consumer.test.mjs`;Phase 5 跑 dry-run + 可选 deploy
- **文档同步原则**:D03 事实锚点若在执行中漂移,v0.2 补;Q3c 显式落盘 in code

### 1.5 本次 action-plan 影响目录树

```text
worker-matrix/P3/
├── Phase 1 — C1 context-management 吸收/
│   ├── workers/context-core/src/
│   │   ├── budget/                [from packages/context-management/src/budget/]
│   │   ├── async-compact/         [from .../async-compact/]
│   │   └── inspector-facade/      [from .../inspector-facade/ — 默认 OFF]
│   └── workers/context-core/test/ [C1 tests]
├── Phase 2 — C2 WCA context slice 吸收/
│   ├── workers/context-core/src/
│   │   ├── context-layers.ts          [from packages/workspace-context-artifacts/src/context-layers.ts]
│   │   ├── context-assembler.ts
│   │   ├── compact-boundary.ts
│   │   ├── redaction.ts
│   │   ├── snapshot.ts
│   │   └── evidence-emitters-context.ts  [mixed helper context slice — D03 §4.1 表]
│   ├── packages/workspace-context-artifacts/
│   │   └── context slice 保留 re-export    [共存期;P5/D09 再清理]
│   └── evidence-emitters filesystem 部分保留 in packages [P4 迁]
├── Phase 3 — appendInitialContextLayer 迁出/
│   ├── workers/context-core/src/context-api/
│   │   └── append-initial-context-layer.ts  [from workers/agent-core/src/host/context-api/]
│   ├── workers/agent-core/src/host/do/nano-session-do.ts  [import 改指向 context-core]
│   └── packages/session-do-runtime/src/do/nano-session-do.ts  [同步]
├── Phase 4 — compact posture Q3c/
│   └── workers/agent-core/src/host/composition/index.ts  [+ comment + 不装 createKernelCompactDelegate default]
├── Phase 5 — preview deploy(可 defer)/
│   └── workers/context-core  [deploy:preview 或 defer note 在 closure memo]
└── Phase 6 — closure/
    ├── docs/issue/worker-matrix/P3-closure.md
    └── docs/design/pre-worker-matrix/W3-absorption-pattern.md  [第 3 placeholder 若出现循环引用情景则回填]
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** Phase 1:`packages/context-management/{src,test}/**` → `workers/context-core/{src,test}/**`;byte-identical;packages 保留
- **[S2]** Phase 2:`packages/workspace-context-artifacts/src/{context-layers,context-assembler,compact-boundary,redaction,snapshot}.ts` + 对应 tests → `workers/context-core/src/`
- **[S3]** Phase 2:`evidence-emitters.ts` mixed helper 按 D03 §4.1 owner 表切出 context slice(assembly / compact / snapshot 三类 emit helper)到 `workers/context-core/src/evidence-emitters-context.ts`;filesystem 部分(artifact 类)保留在 packages 中(P4 迁走)
- **[S4]** Phase 2:`packages/workspace-context-artifacts/src/index.ts` 改为 re-export 已迁移 slice(以 workspace import 路径)+ 原 filesystem slice 保持 inline;保证老 consumer 仍可 import 不改
- **[S5]** Phase 3:`appendInitialContextLayer` 物理从 `workers/agent-core/src/host/context-api/` 迁到 `workers/context-core/src/context-api/`;agent-core 的 consumer nano-session-do.ts 改 import 指向 `workers/context-core/src/context-api` 或同等 re-export;packages/session-do-runtime 同步
- **[S6]** Phase 4:`workers/agent-core/src/host/composition/index.ts` 显式不装 `createKernelCompactDelegate` default;加注释 "per charter Q3c";单测验证 default 不挂 compact
- **[S7]** Phase 5:`workers/context-core` `deploy:dry-run` 绿;preview deploy 如 posture 允许 host-local-only 可 defer(closure memo 注明)
- **[S8]** Phase 6:B7 LIVE + 98 root + 112 cross + P2 两条 e2e + 三 workers test + dry-run 全绿
- **[S9]** W3 pattern 第 3 placeholder("循环引用解决 pattern"):若 WCA split 执行中遇到真实循环引用场景,在 Phase 6 回填(预期发生率中;context ↔ filesystem evidence 共享可能触发)
- **[S10]** `docs/issue/worker-matrix/P3-closure.md`

### 2.2 Out-of-Scope

- **[O1]** D1 filesystem slice 吸收(归 P4)
- **[O2]** D2 storage-topology residual 吸收(归 P4)
- **[O3]** `packages/workspace-context-artifacts` 物理删除(归 P5 D09 / 下一阶段)
- **[O4]** `packages/context-management` DEPRECATED banner(归 P5 D09)
- **[O5]** 改 `appendInitialContextLayer` 深度实装(内部算法 / layer 合并逻辑);保留 P2 stub 语义,仅做物理搬迁
- **[O6]** 默认打开 InspectorFacade(D03 明确默认 OFF)
- **[O7]** `restoreVersion` 从 "throw not implemented" 改实装
- **[O8]** Remote compact delegate helper shipped(Q3c 明确不走)
- **[O9]** `CONTEXT_CORE` service binding 激活(P3 posture host-local-only;除非 posture 决策明确要远端,本 phase 不取消注释 wrangler)
- **[O10]** 改 NACP wire / schema / tenant wrapper(B9 / W0)
- **[O11]** WCA 物理删除(归 P5 / 下一阶段)

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `packages/workspace-context-artifacts` re-export 策略 | `in-scope context slice 改 re-export;filesystem slice inline 保留` | 共存期 + P4 还未吸收 D1 | P4 完成后全 re-export |
| `appendInitialContextLayer` 内部算法 | `out-of-scope` | P2 stub 已最小 work;本 phase 仅物理归位 | 未来若有 "layer 合并 / 优先级" charter |
| compact posture 走远端 delegate | `out-of-scope` | Q3c 保持 opt-in | charter Q3 重评 |
| InspectorFacade 默认 ON | `out-of-scope` | D03 默认 OFF | NOT revisit |
| context-core real preview deploy | `in-scope / can defer` | posture host-local 允许 defer | closure memo 明确 |
| mixed helper 一次全切到 context-core | `out-of-scope` | filesystem 部分归 P4 | — |
| W3 pattern 第 3 placeholder | `in-scope 有条件回填` | 仅当 WCA split 真遇循环 | — |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P0-01 | Phase 0 | P2 closed gate check | check | P2 closure + live loop preview | P2 DoD 全绿 + preview live | low |
| P1-01 | Phase 1 | C1 src 搬 | migration | `packages/context-management/src/{budget,async-compact,inspector-facade}/**` → `workers/context-core/src/**` | byte-identical | medium |
| P1-02 | Phase 1 | C1 test 搬 | migration | `packages/context-management/test/**` → `workers/context-core/test/**` | tests 全绿 | medium |
| P1-03 | Phase 1 | `packages/context-management/src/index.ts` re-export 新路径 | update | packages | 共存期 re-export | low |
| P2-01 | Phase 2 | C2 WCA context 文件搬 | migration | 5 `.ts` → `workers/context-core/src/` | slice byte-identical | high |
| P2-02 | Phase 2 | mixed helper context 切分 | migration + split | `packages/workspace-context-artifacts/src/evidence-emitters.ts` 按 D03 §4.1 表拆 | context 部分迁;filesystem 部分 inline 保留 | high |
| P2-03 | Phase 2 | `packages/workspace-context-artifacts/src/index.ts` re-export 改写 | update | packages | re-export 新 workers slice + 原 filesystem inline | medium |
| P2-04 | Phase 2 | C2 tests 搬 | migration | `packages/workspace-context-artifacts/test/**`(context 部分)→ `workers/context-core/test/**` | tests 全绿 | medium |
| P3-01 | Phase 3 | `appendInitialContextLayer` 物理搬 | migration | `workers/agent-core/src/host/context-api/` → `workers/context-core/src/context-api/` | owner 归位 context-core | medium |
| P3-02 | Phase 3 | agent-core consumer import 改 | update | `workers/agent-core/src/host/do/nano-session-do.ts` + packages 侧同步 | import 指向 context-core | medium |
| P3-03 | Phase 3 | P2 stub 迁后 unit test 调整 | update | `workers/context-core/test/context-api/append-initial-context-layer.test.ts` | 3 cases 继承从 agent-core 的 P2 tests | low |
| P4-01 | Phase 4 | compact posture Q3c 显式 | update | `workers/agent-core/src/host/composition/index.ts` | 不装 default compact;注释 + config 说明 | medium |
| P4-02 | Phase 4 | compact posture unit test | new | `workers/agent-core/test/host/composition/compactOptIn.test.ts`(P2 可能已经有)补 Q3c 验证 | default 不挂 compact | low |
| P5-01 | Phase 5 | `workers/context-core` dry-run | test | workers | dry-run 绿 | low |
| P5-02 | Phase 5 | `workers/context-core` preview deploy(可 defer)| new | workers | URL live 或 defer note | medium |
| P6-01 | Phase 6 | 全仓回归 | test | 全仓 | B7 LIVE 5 / 98 root / 112 cross / 三 workers test / dry-run / P2 两条 e2e 全绿 | medium |
| P6-02 | Phase 6 | W3 pattern 第 3 placeholder(可选)| update | `docs/design/pre-worker-matrix/W3-absorption-pattern.md` | 若 WCA split 遇循环引用真实场景,在此回填 | low |
| P6-03 | Phase 6 | P3 closure memo | add | `docs/issue/worker-matrix/P3-closure.md` | DoD 证据 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 0 — kickoff gate check

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P0-01 | P2 closed 校验 | P2 closure DoD 全 checked;live loop preview URL 仍有效 | `docs/issue/worker-matrix/P2-closure.md` + `curl <preview-url>/` | 全绿 | 目视 + curl | ✓ |

### 4.2 Phase 1 — C1 整包吸收

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | C1 src 搬 | `cp -r packages/context-management/src/* workers/context-core/src/`;保留 `budget/ async-compact/ inspector-facade/` 三子目录 | `workers/context-core/src/` | 3 子目录齐 | `pnpm --filter workers/context-core typecheck` | 绿 |
| P1-02 | C1 test 搬 | `cp -r packages/context-management/test/* workers/context-core/test/` | `workers/context-core/test/` | tests 齐 | `pnpm --filter workers/context-core test` | 全绿 |
| P1-03 | packages re-export | `packages/context-management/src/index.ts` 改 `export * from "../../workers/context-core/src/..."`(不可行 — workspace 边界) 或:保留原实现 + 加 deprecation 注释(但不打 banner,P5 才打) | `packages/context-management/src/index.ts` | re-export 或保留 | typecheck 绿 | 不破坏现有 consumer |

> **注 P1-03**:workspace 的 cross-package import 从 packages/ 指向 workers/ 通常禁止(workspace boundary);实际做法 = 保留原 package 物理实现不动,仅在 CHANGELOG 或注释标 "吸收到 workers/context-core,共存期"。P5/D09 再贴 DEPRECATED banner。

### 4.3 Phase 2 — C2 WCA context slice

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | 5 context .ts 搬 | `context-layers.ts / context-assembler.ts / compact-boundary.ts / redaction.ts / snapshot.ts` → `workers/context-core/src/` | workers/context-core/src/ | 5 文件齐 | typecheck 绿 | 5 文件在 |
| P2-02 | mixed helper 切 | `evidence-emitters.ts` 按 D03 §4.1 表切:context 部分(buildAssemblyEvidence / emitAssembly / buildCompactEvidence / emitCompact / buildSnapshotEvidence / emitSnapshot)→ `workers/context-core/src/evidence-emitters-context.ts`;filesystem 部分(artifact 类)原位保留 | packages + workers | 两处切开;无 duplicate 定义 | `grep "buildAssemblyEvidence" workers/context-core/src/` ≥ 1 且 packages/ 0(若完全搬) | 切分干净 |
| P2-03 | packages re-export | `packages/workspace-context-artifacts/src/index.ts` 改:context slice `.ts` 不再本地 export(原文件保留或删,视 workspace 可行性);filesystem slice inline 继续 export;`evidence-emitters` artifact 部分继续 export | packages | re-export 新路径 | `@nano-agent/workspace-context-artifacts` 的 public API 兼容 | 老 consumer 不破 |
| P2-04 | C2 tests 搬 | context-related tests → `workers/context-core/test/` | workers/context-core/test/ | tests 齐 | `pnpm --filter workers/context-core test` 全绿 | 0 failure |

> **注 P2-03 workspace boundary**:与 P1-03 同理,packages 内 re-export 指向 workers 通常禁止。实际做法可能是 **保留 packages 内 context slice 原文件直到 P5 切换**;同时在 workers/context-core 物理 copy 一份,让 workers 侧 runtime 从 workers 拿,packages 消费者仍从 packages 拿(共存期纪律)。P5 cutover 后,packages re-export 指向 `@haimang/*`,WCA 整包在 D09 deprecate。

### 4.4 Phase 3 — `appendInitialContextLayer` 迁出

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | stub 物理搬 | `workers/agent-core/src/host/context-api/append-initial-context-layer.ts` → `workers/context-core/src/context-api/append-initial-context-layer.ts`;`workers/agent-core` 侧删 | workers/context-core + workers/agent-core | 文件迁移 | `ls workers/context-core/src/context-api/` ≥ 1 | 物理搬 |
| P3-02 | agent-core consumer import 改 | `workers/agent-core/src/host/do/nano-session-do.ts`:`import { appendInitialContextLayer } from "../../../context-core/src/context-api/..."` 或通过某个 barrel | agent-core | import 指向 context-core | typecheck 绿 | ✓ |
| P3-03 | packages 侧对称 | `packages/session-do-runtime/src/do/nano-session-do.ts` import 同步 | packages | — | typecheck 绿 | ✓ |
| P3-04 | unit test 迁 | 把 agent-core 侧 stub 的 3 cases 迁到 `workers/context-core/test/context-api/` | workers/context-core/test | 3 cases | `pnpm --filter workers/context-core test` | 3/3 绿 |

> **注 P3-02/P3-03 workspace cross-import(per P1-P5 GPT review R3 校准)**:workers 之间的 source import 必须走 **真实已存在的 package name**。当前 `workers/context-core/package.json::name` 是 **`@haimang/context-core-worker`**(非 `@nano-agent/context-core` — 后者在仓库里不存在,是历史讨论中的 placeholder)。**落地路径**:让 `workers/context-core/src/context-api/index.ts` 暴露 `appendInitialContextLayer` 并挂到该 package public API;然后在 `workers/agent-core/package.json` 的 `dependencies` 加 `"@haimang/context-core-worker": "workspace:*"`;agent-core consumer 代码 `import { appendInitialContextLayer } from "@haimang/context-core-worker"`;`packages/session-do-runtime` 侧共存期路径做同样引用。或者(更稳妥)**不**做 worker-to-worker source import,改把共享 helper 留在 `packages/*`(例如 `packages/session-do-runtime/src/context-api/append-initial-context-layer.ts`),P3 只迁 C1 + C2 业务逻辑,helper 作为 shared seam 保持在 packages 一端;此路线不会产生 cross-worker import 的 typecheck 风险。两条路均不使用 `@nano-agent/context-core` 这个不存在的名字。具体路线由 kickoff Q1 锁定。

### 4.5 Phase 4 — compact posture Q3c

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | composition 注释 + 代码 | kernel handle 装配处加注释 "per charter Q3c:默认不装 createKernelCompactDelegate;opt-in via env/config";代码里确保不挂 default compact | `workers/agent-core/src/host/composition/index.ts` | 注释 + 代码 | `grep "Q3c" workers/agent-core/src/host/composition/` ≥ 1 | 显式 |
| P4-02 | compact opt-in unit test | `default 不挂 compact;opt-in 可开` 两断言 | `workers/agent-core/test/host/composition/compactOptIn.test.ts` | 2 cases | `pnpm --filter workers/agent-core test` | 2/2 绿 |

### 4.6 Phase 5 — `workers/context-core` preview deploy(可 defer)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | dry-run | `pnpm --filter workers/context-core run deploy:dry-run` | workers/context-core | 绿 | wrangler dry-run | 0 error |
| P5-02 | deploy preview(可 defer)| 若 owner 决策 Q2 = "deploy baseline",则 `deploy:preview`;URL live + curl probe JSON | workers/context-core | URL live 或 defer note | curl | URL 或 defer note in closure |

### 4.7 Phase 6 — 全仓回归 + closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P6-01 | 全仓回归 | `pnpm -r run test && pnpm --filter './workers/*' run deploy:dry-run && node --test test/*.test.mjs && npm run test:cross` | 全仓 | 全绿 | 命令组 | 0 failure;P2 两条 e2e 仍绿 |
| P6-02 | W3 pattern 第 3 placeholder(可选)| 若 WCA split 遇到循环引用真实场景,回填 "循环引用解决 pattern" 节 | `docs/design/pre-worker-matrix/W3-absorption-pattern.md` | 节非空 | grep | `placeholder` 数 -1 |
| P6-03 | P3 closure | 写 `docs/issue/worker-matrix/P3-closure.md`:含 C1/C2 LOC / PR link / mixed helper 切分 diff / Q3c 显式落盘证据 / e2e 全绿证据 / WCA split 第 3 placeholder 是否回填 | closure memo | 300-500 行 | grep DoD | §DoD 全 checked |

---

## 5. Phase 详情

### 5.1 Phase 0 — gate check

- **Phase 目标**:P3 开工前 P2 DoD 全绿 + preview URL live
- **本 Phase 对应编号**:`P0-01`
- **收口标准**:3 条 check 全 ✓

### 5.2 Phase 1 — C1 context-management 整包吸收

- **Phase 目标**:`workers/context-core/src/` 含 C1 runtime(3 子目录);packages 保留;B7 LIVE 仍绿
- **本 Phase 对应编号**:`P1-01` `P1-02` `P1-03`
- **本 Phase 新增文件**:`workers/context-core/src/{budget,async-compact,inspector-facade}/**`、`workers/context-core/test/**`
- **本 Phase 修改文件**:无(packages 原文件不动;index.ts re-export 由 workspace boundary 决定是否改)
- **具体功能预期**:
  1. 3 子目录 byte-identical
  2. tests 全绿
  3. packages/context-management 保留
- **具体测试安排**:
  - **单测**:`pnpm --filter workers/context-core test`
  - **集成测试**:`pnpm --filter workers/context-core run deploy:dry-run`
  - **回归测试**:B7 LIVE + 全仓 + P2 两条 e2e
  - **手动验证**:`ls workers/context-core/src/{budget,async-compact,inspector-facade}` 全在
- **收口标准**:所有 test 绿
- **本 Phase 风险提醒**:
  - async-compact 里的 delegate 调度逻辑若漂移,会影响 opt-in 开关行为
  - InspectorFacade 默认 OFF 必须保持

### 5.3 Phase 2 — C2 WCA context slice 吸收

- **Phase 目标**:5 context `.ts` + mixed helper context 部分迁入 context-core;filesystem 部分保留 in packages(P4 迁);packages re-export 维持老 consumer 可用
- **本 Phase 对应编号**:`P2-01` 至 `P2-04`
- **本 Phase 新增文件**:
  - `workers/context-core/src/{context-layers,context-assembler,compact-boundary,redaction,snapshot}.ts`
  - `workers/context-core/src/evidence-emitters-context.ts`
  - `workers/context-core/test/{context-layers,context-assembler,compact-boundary,redaction,snapshot,evidence-emitters-context}.test.ts`
- **本 Phase 修改文件**:
  - `packages/workspace-context-artifacts/src/evidence-emitters.ts`(filesystem slice 保留;context slice 删或保留视 workspace boundary)
  - `packages/workspace-context-artifacts/src/index.ts`(re-export 调整)
- **具体功能预期**:
  1. 5 文件 byte-identical
  2. mixed helper 按表切(context 3 组 / filesystem 1 组)
  3. `@nano-agent/workspace-context-artifacts` public API 兼容
- **具体测试安排**:
  - **单测**:context-core tests
  - **集成测试**:`pnpm -r run test` 含 WCA 包 tests 不破
  - **回归测试**:B7 LIVE + P2 两条 e2e
  - **手动验证**:`grep "buildArtifactEvidence" packages/workspace-context-artifacts/src/` ≥ 1(filesystem 保留);`grep "buildAssemblyEvidence" packages/workspace-context-artifacts/src/` == 0(若完全切;否则接受共存期 duplicate + 注释说明)
- **收口标准**:所有 tests 绿 + API 兼容
- **本 Phase 风险提醒**:
  - mixed helper 切分若把 artifact 部分误迁 context-core,P4 filesystem 吸收会二次返工
  - WCA split 过程中可能遇到循环引用(context 层调 filesystem 层的 namespace.write → snapshot → evidence emit → context 回);若发生,W3 pattern 第 3 placeholder 回填
  - workspace boundary 规则:packages/workers 之间的 cross-import 通常不允许;如需,通过**真实存在**的 package name(`@haimang/<worker>-worker`;per R3)+ package.json deps `workspace:*` 声明 — **不使用** `@nano-agent/context-core` 这种仓库里不存在的 alias

### 5.4 Phase 3 — `appendInitialContextLayer` 迁出

- **Phase 目标**:stub 归位 context-core;agent-core import 指向 context-core
- **本 Phase 对应编号**:`P3-01` 至 `P3-04`
- **本 Phase 新增文件**:`workers/context-core/src/context-api/append-initial-context-layer.ts` + test
- **本 Phase 修改文件**:
  - `workers/agent-core/src/host/do/nano-session-do.ts`(import 改)
  - `packages/session-do-runtime/src/do/nano-session-do.ts`(同步)
  - `workers/agent-core/src/host/context-api/append-initial-context-layer.ts`(删)
- **具体功能预期**:
  1. 物理位置:workers/context-core/src/context-api/
  2. 调用 path:agent-core → context-core(via 合法 workspace import)
  3. 单测 3 cases 在 context-core 侧
- **具体测试安排**:
  - **单测**:context-core test 3/3 绿
  - **集成测试**:P2 e2e #2 initial_context 仍绿
- **收口标准**:P2 e2e #2 绿 + 物理位置正确
- **本 Phase 风险提醒**:
  - workspace boundary(见上文);若选 cross-worker import 路线,agent-core 的 package.json 需加 `"@haimang/context-core-worker": "workspace:*"`(真实 name,per R3);若选 "helper 留 packages" 路线,则 agent-core 保持现有 `packages/session-do-runtime`(或等价)依赖不变
  - packages/session-do-runtime 同步落必须;否则共存期 bug 路径会调 undefined

### 5.5 Phase 4 — compact posture Q3c

- **Phase 目标**:default composition 代码 + 注释显式不装 compact;opt-in seam 保留
- **本 Phase 对应编号**:`P4-01` `P4-02`
- **本 Phase 新增文件**:`workers/agent-core/test/host/composition/compactOptIn.test.ts`(可能 P2 已经存在 — 本 phase 补充 Q3c 断言)
- **本 Phase 修改文件**:`workers/agent-core/src/host/composition/index.ts`(注释 + 代码 guard)
- **具体功能预期**:
  1. 注释 "per charter Q3c"
  2. default 不挂 `createKernelCompactDelegate`
  3. opt-in path 存在(env/config gate)
- **具体测试安排**:2 断言 unit test
- **收口标准**:2/2 绿 + 注释存在
- **本 Phase 风险提醒**:
  - 若不小心把 compact 挂 default,kernel 行为漂移;turn loop 可能出现额外 compact.notify 事件

### 5.6 Phase 5 — preview deploy(可 defer)

- **Phase 目标**:context-core dry-run 绿;preview 可 defer
- **本 Phase 对应编号**:`P5-01` `P5-02`
- **收口标准**:dry-run 绿;preview URL 或 defer note 在 closure

### 5.7 Phase 6 — 全仓回归 + closure

- **Phase 目标**:P3 DoD 全绿;closure memo shipped
- **本 Phase 对应编号**:`P6-01` `P6-02` `P6-03`
- **收口标准**:charter §6.3 P3 DoD 全 checked

---

## 6. 需要业主 / 架构师回答的问题清单

### Q1 — workspace cross-import 路径(per P1-P5 GPT review R3 已部分冻结)

- **影响范围**:Phase 3(agent-core → context-core 调 appendInitialContextLayer)+ 未来 bash/context/filesystem 之间的共享
- **为什么必须确认**:pnpm workspace 允许 workers/agent-core 通过真实 worker package name(当前 `workers/context-core/package.json::name` 是 `@haimang/context-core-worker`;`@nano-agent/context-core` **不存在** — R3)import,或相对路径 import `workers/context-core`(后者通常不可)。这条路径若不定,Phase 3 import 改动会被 typecheck 拒
- **当前建议 / 倾向**:**二选一**,均不发明新 package name:
  - **选项 A(cross-worker import,推荐)**:继续使用现有 `@haimang/context-core-worker` 作为 context-core worker 的 package name;在 `workers/agent-core/package.json` 的 `dependencies` 加 `"@haimang/context-core-worker": "workspace:*"`;consumer import `from "@haimang/context-core-worker"`
  - **选项 B(helper 留 packages)**:`appendInitialContextLayer` helper 保留在 `packages/session-do-runtime/src/context-api/`(或新 `packages/context-api/`);P3 只迁 C1+C2 的 substrate 业务,不强制 cross-worker import
- **Q**:选 A 还是 B?
- **A**:_pending_(**不得选择** "使用 `@nano-agent/context-core`" — 该 name 不存在,R3 已明确)

### Q2 — context-core preview deploy 时机

- **影响范围**:Phase 5
- **为什么必须确认**:posture Q3c/Q4a 都 host-local,context-core real preview 不是硬需要;但 deploy 一次 baseline 便于未来 P5 cutover 对比
- **当前建议 / 倾向**:**Phase 5 做一次 preview baseline**(URL + Version ID 记录;不 active binding);可 revert if tokens tight
- **Q**:deploy 还是 defer?
- **A**:_pending_

### Q3 — WCA split 的 packages re-export 落地方式

- **影响范围**:Phase 1-2
- **为什么必须确认**:packages 内能否 re-export 到 workers/;工程上通常禁止(workspace boundary)。若不行,context slice 文件必须在两处保留(共存期 duplicate),P5 才切
- **当前建议 / 倾向**:**packages 保留原实现 duplicate 直到 P5 / D09**;workers 侧是新的 runtime 归属;index.ts 不改 re-export 指向外部 package
- **Q**:re-export 还是 duplicate?
- **A**:_pending_

### Q4 — W3 pattern 第 3 placeholder 何时回填

- **影响范围**:Phase 6
- **为什么必须确认**:第 3 placeholder 只有 WCA split 真遇循环引用才有数据;若未遇,推 P4 回填
- **当前建议 / 倾向**:**Phase 2 执行中如遇则 Phase 6 回填;否则 P4 回填**
- **Q**:必 P3 还是可延?
- **A**:_pending_

### 6.2 问题整理建议

- Q1 / Q3 决定 Phase 2-3 可行性,P3 kickoff 前 must answer
- Q2 / Q4 是 cosmetic
- Q3 的答案会影响 D09(Phase 2 packages 实际剩多少);P5 前必须 reconcile

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| workspace boundary 限制 cross-import | Phase 3 agent-core 调 context-core | `high` | Q1 定策略;package.json deps + alias |
| mixed helper 切错 | context / filesystem evidence helper 归属漂移 | `high` | 严格遵循 D03 §4.1 owner 表;PR review grep 对照 |
| WCA split 循环引用 | context 回调 filesystem | `medium` | 若出现,用 event emitter / seam 解耦;W3 pattern 第 3 placeholder 回填 |
| B7 LIVE 红 | 任一 phase | `high` | block |
| P2 e2e #2 initial_context 红 | Phase 3 import 改后 | `high` | import 改后单独跑 e2e #2;红则 revert |
| InspectorFacade 默认 ON 漂移 | Phase 1 | `low` | grep `inspector.*OFF` 保留 |
| restoreVersion 被实装(越位)| Phase 1-2 | `low` | 保留 "throw not implemented" |
| Q3c compact default 被误开 | Phase 4 | `medium` | 单测断言 |

### 7.2 约束与前提

- **技术前提**:P2 closed;live loop preview URL 可用
- **运行时前提**:Cloudflare preview deploy 凭证(若 Phase 5 deploy)
- **组织协作前提**:Q1(cross-import)owner 决策
- **上线 / 合并前提**:每 phase 独立 PR;B7 LIVE + P2 e2e red block merge

### 7.3 文档同步要求

- 需要同步更新的设计文档:
  - `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md`(若执行中事实漂移,v0.2)
  - `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`(reality check)
- 需要同步更新的说明文档 / README:
  - `workers/context-core/README.md`(若存在)
- 需要同步更新的测试说明:无

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**:
  - `ls workers/context-core/src/{budget,async-compact,inspector-facade,context-api}` 全在
  - `ls workers/context-core/src/{context-layers.ts,context-assembler.ts,compact-boundary.ts,redaction.ts,snapshot.ts,evidence-emitters-context.ts}` 全在
  - `grep "Q3c" workers/agent-core/src/host/composition/` ≥ 1
  - P2 的 e2e #2 `initial-context-live-consumer.test.mjs` 仍绿
- **单元测试**:`pnpm -r run test`
- **集成测试**:`pnpm --filter './workers/*' run deploy:dry-run`
- **端到端 / 手动验证**:`node --test test/*.test.mjs`
- **回归测试**:B7 LIVE 5 / 98 root / 112 cross
- **文档校验**:closure memo §DoD 全 checked

### 8.2 Action-Plan 整体收口标准(= charter §6.3 P3 DoD)

1. `workers/context-core/src/` 含吸收后的 C1 + C2 runtime
2. `appendInitialContextLayer` API 在 context-core 可调;P2 的 host consumer 仍绿
3. compact posture PR merged:Q3c(保持 opt-in)明确落地
4. `context-core` preview deploy 成功(或明确 defer)
5. WCA context slice 在 workers/context-core 成立;packages 保留(P5 再处理)
6. B7 LIVE 5 全绿;P2 两条 e2e 全绿

### 8.3 完成定义(Definition of Done)

| 维度 | 完成定义 |
|------|----------|
| 功能 | C1 + C2 吸收;appendInitialContextLayer owner 归位;compact Q3c 显式 |
| 测试 | B7 LIVE + 98 root + 112 cross + P2 两条 e2e + 三 workers test + dry-run 全绿 |
| 文档 | closure memo shipped;D03 v0.x 与事实一致 |
| 风险收敛 | mixed helper 切分干净;circular import 有 pattern 或绕开 |
| 可交付性 | P4 可 kickoff;WCA filesystem slice 已 identified 待迁 |

---

## 9. 执行后复盘关注点

- Q1 cross-import 策略选 alias 还是其他;是否影响 future worker 组织方式
- WCA split 是否真遇循环引用;W3 pattern 第 3 placeholder 回填是否有用
- Phase 5 preview deploy 是否被 owner 要求
- Q3c 显式落盘后,是否有 consumer 误以为 default 就装

---

## 10. 结语

这份 P3 action-plan 以 **"context-core runtime ownership 从 packages/ 迁到 workers/ + initial_context API owner 归位 + compact Q3c 显式"** 为第一优先级,采用 **"Phase 序列(gate → C1 → C2 → API migrate → posture → deploy → closure)"** 的推进方式,优先解决 **"workers/context-core 仍是 probe / appendInitialContextLayer 临时挂 agent-core / WCA 未 split / mixed helper 未切 / compact posture 非显式"** 五件欠账,并把 **"B7 LIVE 不破 / P2 e2e 不破 / InspectorFacade 默认 OFF / restoreVersion 诚实度 / Q3c opt-in 不漂"** 作为主要约束。整个计划完成后,`context.core` 应达到 **"host-local thin substrate 有真实 ownership + API owner 归位 + compact 默认不挂"**,从而为后续的 **P4 filesystem-core 吸收(含 WCA filesystem slice + mixed helper artifact 部分迁)** 提供稳定基础。
