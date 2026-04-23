# Blueprint — `context-management` → `workers/context-core/src/`

> 类型：on-demand absorption blueprint(非代表,P0 补齐)
> 状态：draft(worker-matrix P0 Phase 2 产出)
> 直接上游：
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`(C1 归属)
> - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`
> - `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`
> - `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md`(C1 聚合于 context-core)
> - `docs/plan-worker-matrix.md` §7 Q3c(opt-in 保持 default 不自动装)
> 相关原始素材：
> - `packages/context-management/package.json`(dependencies:`@nano-agent/{storage-topology,workspace-context-artifacts,eval-observability}`)
> - `packages/context-management/src/budget/{types,env,index,policy}.ts`
> - `packages/context-management/src/async-compact/{13 files}.ts`
> - `packages/context-management/src/inspector-facade/{5 files}.ts`
> - `packages/context-management/test/{budget,async-compact,inspector-facade,integration}/...`

---

## 1. 这个 blueprint 解决什么问题

1. `context-management` 是 `context.core` 的三个 opt-in 能力子模块:budget policy(token/compact 预算)、async-compact(PX 规范生命周期)、inspector-facade(上下文侧 HTTP/WS 检视)。它们不是 default composition 的 always-on 组件,是 **per-session opt-in**(Q3c 决策)。
2. 它代表的是 **"opt-in 能力子模块 + multi-submodule exports + runtime 跨包依赖(WCA / storage-topology / eval-observability)"** 的 absorption 难度;规模 ~3398 src + ~1934 test ≈ 5332 LOC,大部分集中在 `async-compact/` 子模块。
3. 进入 worker-matrix 时,这份 blueprint 让 P3 / C1 PR 作者少想:
   - 哪些子模块整体迁(全部 3 个)
   - **opt-in 纪律**(default 不自动 wire compact;host 必须主动 mount inspector facade)如何在 `workers/context-core/src/` 保持
   - `@nano-agent/workspace-context-artifacts` 依赖如何处理(D03 / D04 WCA split merge 后,该 dep 自动解析到 new location;C1 sub-PR 内不得自行 inline WCA types)
   - `@nano-agent/eval-observability` dep 与 A5(agent-core 内部)的跨 worker 边界

---

## 2. 当前代码事实与源路径

### 2.1 package-level 事实

- `package.json` 关键信息:
  - 名称:`@nano-agent/context-management`
  - 版本:`0.1.0`
  - scripts:`build / typecheck / test / test:coverage`
  - `exports`:root + 3 subpath exports(`./budget` / `./async-compact` / `./inspector-facade`)
  - **`dependencies`**:
    - `@nano-agent/storage-topology`(workspace:\*)
    - `@nano-agent/workspace-context-artifacts`(workspace:\*)
    - `@nano-agent/eval-observability`(workspace:\*)
  - `peerDependencies.zod >= 3.22.0`
- **实测:`src/async-compact/` 多个文件 `import type { ContextLayer } from "@nano-agent/workspace-context-artifacts"`** — 这是 **C1 → C2 slice 的类型耦合**,D03 合并后会自动切到 new location
- public surface:`src/index.ts`(80 行)+ 3 subpath `src/{budget,async-compact,inspector-facade}/index.ts`
- 实测 LOC:src ~3398(主要在 async-compact/index.ts 774 LOC + committer.ts 327 LOC + inspector-facade/index.ts 371 LOC + types.ts 230)/ test ~1934

### 2.2 核心源码锚点

| 职责 | 源路径 | 备注 |
|------|--------|------|
| public API root | `packages/context-management/src/index.ts` | 再次 re-export 3 子模块 |
| version | `src/version.ts` | `CONTEXT_MANAGEMENT_VERSION` |
| **budget/** | `src/budget/{types,env,index,policy}.ts` | `DEFAULT_COMPACT_POLICY` / `shouldArm / shouldHardFallback` / env override / `CompactPolicy` shape |
| **async-compact/** | `src/async-compact/{13 files}.ts` | `AsyncCompactOrchestrator`(index.ts 774 LOC)+ scheduler / planner / prepare-job / committer / events / kernel-adapter / fallback / threshold / types / version-history |
| **inspector-facade/** | `src/inspector-facade/{5 files}.ts` | `InspectorFacade / mountInspectorFacade / buildUsageReport / redactSecrets / parseBearer / isIpAllowed` + `UsageReport / LayerView / PolicyView / CompactStateInspectorView / SubscribeFilter / StreamSubscription` |
| unit tests | `test/budget/policy.test.ts` + `test/async-compact/{6 files}.test.ts` + `test/inspector-facade/facade.test.ts` | |
| integration | `test/integration/kernel-adapter.test.ts` | |

### 2.3 跨包 import 事实表

| 依赖包 | 消费文件 | 类型 | 迁移后该如何处理 |
|--------|----------|------|------------------|
| `@nano-agent/workspace-context-artifacts` | `async-compact/{committer,index,kernel-adapter,planner,types}.ts` 5 files | `import type { ContextLayer }` | D03 合并后自动切到 `workers/context-core/src/context-layers.ts` 的 ContextLayer 类型;C1 sub-PR 需在 merge 前确认 D03 slice 已完成或 coexist |
| `@nano-agent/storage-topology` | 可能在 async-compact 内(若涉及 persistence)| value / type | D04 storage-topology 吸收后切到 `workers/filesystem-core/src/storage/` 或共存期保留 |
| `@nano-agent/eval-observability` | 可能在 async-compact events / inspector-facade 内 | trace sink / evidence | **跨 worker 边界**:C1 属 context-core,A5 属 agent-core;C1 sub-PR 不应 inline A5 的 runtime,而是通过 evidence / trace seam 调用 |

---

## 3. 目标落点

### 3.1 建议目录结构

```text
workers/context-core/
  src/
    management/
      index.ts                        # C1 public API aggregator
      version.ts
      budget/
        index.ts
        policy.ts
        env.ts
        types.ts
      async-compact/
        index.ts
        scheduler.ts
        planner.ts
        prepare-job.ts
        committer.ts
        events.ts
        kernel-adapter.ts
        fallback.ts
        threshold.ts
        types.ts
        version-history.ts
      inspector-facade/
        index.ts
        inspector-auth.ts
        inspector-redact.ts
        usage-report.ts
        types.ts
  test/
    management/
      budget/
        policy.test.ts
      async-compact/
        committer.test.ts
        orchestrator.test.ts
        persistence-and-retry.test.ts
        planner.test.ts
        prepare-job.test.ts
        scheduler.test.ts
      inspector-facade/
        facade.test.ts
      integration/
        kernel-adapter.test.ts
```

### 3.2 文件映射表

| 源文件 / 目录 | 目标文件 / 目录 | 搬迁方式 | 备注 |
|---------------|------------------|----------|------|
| `src/index.ts` | `workers/context-core/src/management/index.ts` | 重建 exports | |
| `src/version.ts` | `management/version.ts` | 原样迁移 | |
| `src/budget/{4 files}` | `management/budget/{4}` | 原样迁移 | |
| `src/async-compact/{13 files}` | `management/async-compact/{13}` | 原样迁移 | 重点关注 `ContextLayer` import 改写 |
| `src/inspector-facade/{5 files}` | `management/inspector-facade/{5}` | 原样迁移 | |
| `test/{budget,async-compact,inspector-facade,integration}/...` | `test/management/{同名}` | 调整相对 import | |

---

## 4. 依赖与 import 处理

### 4.1 保留为 package dependency

- `zod`:peerDependency 保持
- **`@haimang/nacp-core` / `@haimang/nacp-session`**:C1 本身未直接 import,但 context-core worker 本身需要(D03 F3 evidence / D06 composition)

### 4.2 跟随 absorb 一起内化

- 全部 3 子模块(22 src + 9 test)随 C1 进 `workers/context-core/src/management/`
- `ContextLayer` 类型 import 在 D03 C2 slice 完成后切到 worker-local 路径(`../context-layers.js`)

### 4.3 cross-worker 依赖(明确不归 C1 自行解决)

1. **`@nano-agent/workspace-context-artifacts::ContextLayer`**:D03 先合并,C1 消费 D03 的 `workers/context-core/src/context-layers.ts`;同 worker 内,相对 import 即可
2. **`@nano-agent/storage-topology`**:D04 storage-topology 吸收到 filesystem-core;C1 若 persist 依赖,通过 cross-worker import(`@haimang/filesystem-core-worker`)或仍保留 Tier B 共存期 package dep — **按 P3 Q1 owner 决策执行**(A=cross-worker import / B=shared helper in packages)
3. **`@nano-agent/eval-observability::TraceSink / TraceEvent`**:A5 吸收到 agent-core;C1 若需要 emit trace,通过 evidence seam(`AssemblyEvidenceRecord` 等)与 context-core 本地 evidence 接合,不跨 worker 引 A5 runtime

### 4.4 opt-in 纪律(Q3c)

- C1 的三个子模块 **default OFF** — context-core host 不自动装配 compact / inspector facade
- 装配方式:host 主动调用 `mountInspectorFacade(env, options)` / 显式构建 `AsyncCompactOrchestrator` 注入 host
- C1 sub-PR 不得在 context-core 的 `wrangler.jsonc` / `src/worker.ts` 默认 main 上默认接入这些子模块 — 保持 "compact/inspector 不是 always-on" 约束

### 4.5 不在本 blueprint 内解决

- inspector-facade 的远端 inspector worker 激活(归 D06)
- async-compact 的 summarizer provider(`LlmSummarizeProvider`)的真实 provider 装配(归 A3 / D06)
- `kernel-adapter` 的远端 kernel worker 调用(不在 scope;C1 与 kernel 同 worker 的话走 in-process adapter)

---

## 5. 测试与验证继承

| 当前测试面 | 进入 worker 后如何继承 |
|------------|------------------------|
| 9 package-local tests(budget / async-compact / inspector-facade / integration)| 1:1 迁到 `workers/context-core/test/management/` |
| integration kernel-adapter.test.ts | 迁到 `test/management/integration/`;保持 in-process mock kernel |
| root cross-tests(若将来有 context 侧 B7 LIVE-like)| 按 root guardians 纪律处理 |

---

## 6. 风险与禁止事项

### 6.1 主要风险

1. **`ContextLayer` import 路径漂移**:D03 C2 slice 合并顺序若晚于 C1,C1 sub-PR 必须通过 coexist(仍 import 自 `@nano-agent/workspace-context-artifacts`)或等 D03 先合;**建议:D03 在 C1 之前合并**
2. **opt-in 被误变成 default**:C1 sub-PR 不得修改 context-core `worker.ts` 或 `composition` 自动装配 compact / inspector facade
3. **`@nano-agent/eval-observability` 跨 worker import**:若 C1 内部 require A5 的 runtime(非 type-only),会违反 cross-worker 边界 — 必须只消费 evidence / trace interface 层,不 inline 运行时
4. **inspector facade 的 tenant gate**:`parseBearer / isIpAllowed` 必须随搬;C1 sub-PR 不得在搬家时偷懒删 gate(auth 纪律保持)
5. **async-compact/index.ts 774 LOC 的单文件耦合**:搬家后应保持单文件,不拆 — C1 sub-PR 不 refactor

### 6.2 明确禁止

1. C1 sub-PR 内把 3 个子模块中任一改为 always-on default
2. C1 sub-PR 内 refactor `AsyncCompactOrchestrator` / `InspectorFacade` 的 public API
3. C1 sub-PR 内新加 compact policy / inspector seam
4. C1 sub-PR 内删除 `packages/context-management/`(归 D09)

---

## 7. 收口证据

1. **源路径列表**:`packages/context-management/src/{index,version}` + `src/{budget,async-compact,inspector-facade}/{22 files}` + `test/{budget,async-compact,inspector-facade,integration}/{9 tests}`
2. **目标路径列表**:`workers/context-core/src/management/{3 子目录 + index.ts + version.ts}` + `test/management/{同构}`
3. **依赖处理说明**:`ContextLayer` import 在 D03 merge 后切本地;`storage-topology` / `eval-observability` 跨 worker seam 按 P3 Q1 / P4 决策;opt-in 纪律保持
4. **测试迁移说明**:9 test 1:1 迁
5. **optional / deferred 项声明**:
   - Live remote inspector worker 归 D06
   - `LlmSummarizeProvider` 实装归 A3 / D06
   - `storage-topology` / `eval-observability` 跨 worker 接入细节归 P3 Q1 / D06

---

## 8. LOC 与工作量估算

| 维度 | 估算值 | 依据 |
|------|--------|------|
| 源 LOC | ~3398 | 22 src(3 subpath 子模块)|
| 测试 LOC | ~1934 | 9 test |
| 搬家工作量 | **M** | 多子模块 subpath;跨包 import 需协调 D03 顺序 |
| 预估时长 | 2-3 工作日 | 与 D03 C2 merge 协调 ≈ 额外 0.5-1 天 |
| 关键风险项 | D03 merge 顺序 / opt-in 纪律 / async-compact 单文件完整性 | |

---

## 9. 一句话 verdict

C1 是 P3 context-core PR 中 **跨子模块 subpath exports + runtime 跨包依赖最复杂** 的 unit:3 子模块随搬 / `ContextLayer` 依赖由 D03 C2 slice merge 决定切点 / opt-in 纪律保持 default OFF / `eval-observability` 跨 worker 边界只走 interface 层。合并建议:**D03 先合 → C1 随后进 context-core**,避免 coexist 期 drift。
