# Blueprint — `hooks` (runtime residual) → `workers/agent-core/src/hooks/`

> 类型：on-demand absorption blueprint(非代表,P0 补齐)
> 状态：draft(worker-matrix P0 Phase 2 产出)
> 直接上游：
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`(A4 归属)
> - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`
> - `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`
> - `docs/design/worker-matrix/D01-agent-core-absorption.md`(A4 聚合于 A1-A5)
> 相关原始素材：
> - `packages/hooks/package.json`(dependencies.`@haimang/nacp-core: workspace:*`)
> - `packages/hooks/src/{index,version,types,catalog,permission,outcome,registry,matcher,guards,dispatcher,core-mapping,session-mapping,audit,snapshot}.ts`
> - `packages/hooks/src/runtimes/{local-ts,service-binding}.ts`
> - `packages/hooks/test/{12 unit}.test.ts` + `test/runtimes/service-binding.test.ts` + `test/integration/{4 files}.test.ts`
> - `packages/hooks/scripts/{export-schema,gen-registry-doc}.ts`(build-time;随 package metadata 迁)

---

## 1. 这个 blueprint 解决什么问题

1. `hooks` runtime residual 是 `agent.core` 的 lifecycle governance 内核:event catalog(18 events / 3 classes)+ dispatcher + registry + matcher + outcome reduction + permission verdict + runtime adapters(local-ts / service-binding)+ core-mapping / session-mapping / audit / snapshot。它是 `KernelDelegates` 中 hooks 委托的实装点,被 A1 host shell 接入。
2. 它代表的是 **"runtime residual + wire catalog 已外化到 nacp-core"** 的 absorption 难度 — 这是四个 residual 样本中 **唯一含 1 条 runtime-dep** 的(依赖 `@haimang/nacp-core::HookEventName / HOOK_EVENT_PAYLOAD_SCHEMA_NAMES`);规模 ~1598 src + ~2839 test ≈ 4437 LOC。
3. 进入 worker-matrix 时,这份 blueprint 让 P1.A / A4 sub-PR 作者少想:
   - **哪些不迁**(wire vocabulary `HookEventName` + payload schemas 归 `@haimang/nacp-core`,已在 W0 consolidation 落定)
   - **哪些迁**(全部 runtime residual:16 src + 17 test)
   - `@haimang/nacp-core` 依赖保留(不删)— 这是 runtime residual 与 wire vocabulary 的正确 seam

---

## 2. 当前代码事实与源路径

### 2.1 package-level 事实

- `package.json` 关键信息:
  - 名称:`@nano-agent/hooks`
  - 版本:`0.2.0`
  - scripts:`build / typecheck / test / test:coverage / build:schema / build:docs`
  - **`dependencies: { "@haimang/nacp-core": "workspace:*" }`**(唯一 runtime dep — wire vocabulary 来源)
  - `peerDependencies.zod >= 3.22.0`;`devDependencies: tsx / typescript / vitest / zod`
- **实测:`src/catalog.ts` 顶部 `import { HOOK_EVENT_PAYLOAD_SCHEMA_NAMES, type HookEventName } from "@haimang/nacp-core";`** — wire vocabulary 已 externalized
- public surface 由 `src/index.ts`(92 行)汇总导出(`HOOK_EVENT_CATALOG / HookDispatcher / HookRegistry / LocalTsRuntime / ServiceBindingRuntime / ...`)
- 实测 LOC:src ~1598(14 root + 2 runtimes)/ test ~2839(12 root + 1 runtimes + 4 integration)/ 合计 ~4437

### 2.2 核心源码锚点

| 职责 | 源路径 | 备注 |
|------|--------|------|
| public API aggregator | `packages/hooks/src/index.ts` | 全 export;byte-identical |
| version | `src/version.ts` | `HOOKS_VERSION` |
| base types | `src/types.ts` | `HookSource / HookRuntimeKind / HookMatcherConfig / HookHandlerConfig` |
| event catalog | `src/catalog.ts` | `HOOK_EVENT_CATALOG / HookEventMeta / isBlockingEvent / ASYNC_COMPACT_HOOK_EVENTS / CLASS_B_HOOK_EVENTS` — **import wire vocab from `@haimang/nacp-core`** |
| permission verdict | `src/permission.ts` | B5 `verdictOf / denyReason` |
| outcome reduction | `src/outcome.ts` | `aggregateOutcomes` |
| registry | `src/registry.ts` | `HookRegistry` |
| matcher | `src/matcher.ts` | `matchEvent` |
| guards | `src/guards.ts` | `withTimeout / checkDepth` |
| dispatcher | `src/dispatcher.ts` | `HookDispatcher` — 主 runtime;被 A1 host 通过 delegates 注入 |
| core-mapping | `src/core-mapping.ts` | `buildHookEmitBody / parseHookOutcomeBody / buildHookOutcomeBody` — 对接 nacp-core wire body |
| session-mapping | `src/session-mapping.ts` | `hookEventToSessionBroadcast → HookBroadcastBody` |
| audit | `src/audit.ts` | `buildHookAuditRecord / buildHookAuditEntry` |
| snapshot | `src/snapshot.ts` | `snapshotRegistry / restoreRegistry` |
| runtimes/local-ts | `src/runtimes/local-ts.ts` | `LocalTsRuntime` — in-process handler |
| runtimes/service-binding | `src/runtimes/service-binding.ts` | `ServiceBindingRuntime` — remote transport seam |
| unit tests | `test/{12 files}.test.ts` | audit / catalog / core-mapping / dispatcher / guards / matcher / outcome / permission / registry / session-mapping / snapshot |
| runtime test | `test/runtimes/service-binding.test.ts` | |
| integration | `test/integration/{compact-guard,pretool-blocking,service-binding-timeout,session-resume-hooks}.test.ts` | |
| build scripts | `scripts/{export-schema,gen-registry-doc}.ts` | build-time tsx scripts;决定是否保留至 worker-local(**建议迁至 workers/agent-core/scripts/hooks/**)|

---

## 3. 目标落点

### 3.1 建议目录结构

```text
workers/agent-core/
  src/
    hooks/
      index.ts                       # A4 public API aggregator
      version.ts
      types.ts
      catalog.ts                     # 继续 import 自 @haimang/nacp-core
      permission.ts
      outcome.ts
      registry.ts
      matcher.ts
      guards.ts
      dispatcher.ts                  # HookDispatcher — 被 A1 host 经 delegates 注入
      core-mapping.ts
      session-mapping.ts
      audit.ts
      snapshot.ts
      runtimes/
        local-ts.ts
        service-binding.ts
  test/
    hooks/
      audit.test.ts
      catalog.test.ts
      core-mapping.test.ts
      dispatcher.test.ts
      guards.test.ts
      matcher.test.ts
      outcome.test.ts
      permission.test.ts
      registry.test.ts
      session-mapping.test.ts
      snapshot.test.ts
      runtimes/
        service-binding.test.ts
      integration/
        compact-guard.test.ts
        pretool-blocking.test.ts
        service-binding-timeout.test.ts
        session-resume-hooks.test.ts
  scripts/
    hooks/
      export-schema.ts
      gen-registry-doc.ts
```

### 3.2 文件映射表

| 源文件 / 目录 | 目标文件 / 目录 | 搬迁方式 | 备注 |
|---------------|------------------|----------|------|
| `src/index.ts` | `workers/agent-core/src/hooks/index.ts` | 重建 exports | |
| `src/{14 root files}` | `hooks/{同名}` | 原样迁移 | `catalog.ts` 的 `@haimang/nacp-core` import 保留 |
| `src/runtimes/{2 files}` | `hooks/runtimes/{同名}` | 原样迁移 | |
| `test/{12 unit}.test.ts` | `test/hooks/{同名}` | 调整相对 import | |
| `test/runtimes/service-binding.test.ts` | `test/hooks/runtimes/service-binding.test.ts` | 调整相对 import | |
| `test/integration/{4 files}.test.ts` | `test/hooks/integration/{同名}` | 调整相对 import | |
| `scripts/{2 tsx scripts}` | `workers/agent-core/scripts/hooks/{同名}` | 原样迁移 | build-time only;不影响 runtime |
| `packages/hooks/package.json::dependencies.@haimang/nacp-core` | `workers/agent-core/package.json::dependencies.@haimang/nacp-core` | 合并到 worker-level dep(若 worker 已有 nacp-core,保持 single entry)| |

---

## 4. 依赖与 import 处理

### 4.1 保留为 package dependency(明确不迁)

- **`@haimang/nacp-core`**:`HookEventName / HOOK_EVENT_PAYLOAD_SCHEMA_NAMES` 是 wire vocabulary,归 nacp-core(W0 consolidation 已落定);A4 sub-PR 不得把这些类型移回 hooks/catalog.ts。
  - **实测**:`packages/hooks/src/catalog.ts:1-4` 已 import 自 `@haimang/nacp-core`;`catalog.ts:45-47` 对外 re-export `HookEventName` 时标 `@deprecated Import HookEventName from @haimang/nacp-core. Planned removal: worker-matrix P0 absorption phase (target 2026-Q3)` — A4 sub-PR 可按该 deprecation note 决定是否清理 re-export(保守建议:**保留 re-export 至 D09 统一 deprecation**)
- `zod`:保持 peerDependency

### 4.2 跟随 absorb 一起内化

- 全部 runtime residual:16 src + 17 test 文件
- `HOOK_EVENT_CATALOG`(dispatch semantics / `allowedOutcomes` / `redactionHints`)— 这不是 wire vocabulary,是 hooks runtime 的 policy,跟搬
- `scripts/{export-schema,gen-registry-doc}.ts`— build-time 辅助,随 package metadata 迁

### 4.3 非迁移项(明确不归 A4)

1. `HookEventName` 字符串列表 / `HOOK_EVENT_PAYLOAD_SCHEMA_NAMES` payload schema 注册表 — 归 `@haimang/nacp-core`,不得内联复制
2. `hook.emit` / `hook.outcome` wire body schemas — 归 `@haimang/nacp-core`(payload schemas 注册表即入口)
3. 任何 audit sink 后端 / 远端 hook transport binding(service-binding runtime 的 remote service name 由 D06 composition 决定;不在 A4 sub-PR 中 hardcode)

### 4.4 不在本 blueprint 内解决

- hook runtime 的 AI-level 策略扩展(例如 rate limit / per-tenant budget) — 归后续 RFC
- Class C `FileChanged / CwdChanged` 补齐 — 已被 catalog.ts §B5 note 注明 deferred to B7

---

## 5. 测试与验证继承

| 当前测试面 | 进入 worker 后如何继承 |
|------------|------------------------|
| 12 unit tests | 1:1 迁到 `test/hooks/`;仅改相对 import |
| `test/runtimes/service-binding.test.ts` | 迁到 `test/hooks/runtimes/`;保持 mock transport |
| 4 integration tests | 迁到 `test/hooks/integration/`;`service-binding-timeout` 保持 mock,不真连远端 |
| root cross-tests(若将来有 hook 跨 worker 契约测试)| 按 B7 LIVE 纪律处理 |

实测 root `test/` 目录内 hooks 相关的 cross-tests 主要通过 B7 LIVE 间接契约跑;不迁。

---

## 6. 风险与禁止事项

### 6.1 主要风险

1. **`HOOK_EVENT_CATALOG` 被误判为 wire vocabulary 一并回迁 nacp-core**:禁止 — catalog 是 dispatch semantics (blocking flag / allowedOutcomes / redactionHints),只有 `HookEventName` / payload schemas 才是 wire vocabulary
2. **`@haimang/nacp-core` import 漂移**:搬到 workers/agent-core 后,worker-level `package.json::dependencies` 必须显式声明 `@haimang/nacp-core: workspace:*`(若本来没有);否则构建失败
3. **`service-binding.ts` 内 hardcoded service name**:A4 sub-PR 不得假设 `HOOK_WORKER` 等 binding name — 由 D06 default composition 决定
4. **deprecation re-export `HookEventName` 被提前删除**:会造成外部 consumer(若 hooks 仍被导出消费)硬崩;建议保留至 D09

### 6.2 明确禁止

1. A4 sub-PR 内扩展 `HOOK_EVENT_CATALOG`(新加 event 归独立 RFC)
2. A4 sub-PR 内改 `hook.emit` / `hook.outcome` wire body schemas(归 nacp-core)
3. A4 sub-PR 内把 `ServiceBindingRuntime` 接 live remote(归 D06)
4. A4 sub-PR 内删除 `packages/hooks/`(归 D09)

---

## 7. 收口证据

1. **源路径列表**:`packages/hooks/src/{14 root + 2 runtimes}` + `test/{12 unit + 1 runtimes + 4 integration}` + `scripts/{2 tsx}`
2. **目标路径列表**:`workers/agent-core/src/hooks/{14 root + runtimes/}` + `workers/agent-core/test/hooks/{12 + runtimes/ + integration/}` + `workers/agent-core/scripts/hooks/{2 tsx}`
3. **依赖处理说明**:`@haimang/nacp-core` 保留作为 wire vocabulary 上游;worker-level package.json 显式声明
4. **测试迁移说明**:16 test 文件 1:1 迁;root cross-tests 不迁(B7 LIVE 保持)
5. **optional / deferred 项声明**:
   - `HookEventName` re-export deprecation 清理归 D09
   - `ServiceBindingRuntime` 接 live remote 归 D06
   - Class C `FileChanged / CwdChanged` 补齐归后续 charter

---

## 8. LOC 与工作量估算

| 维度 | 估算值 | 依据 |
|------|--------|------|
| 源 LOC | ~1598 | 14 root + 2 runtimes |
| 测试 LOC | ~2839 | 12 unit + 1 runtimes + 4 integration |
| 搬家工作量 | **M** | 16 src + 17 test + 2 scripts;wire seam 需要额外注意 |
| 预估时长 | 2-3 工作日 | 比 A2 / A3 稍复杂,因为 `@haimang/nacp-core` dep 处理 |
| 关键风险项 | wire vocabulary seam / `@haimang/nacp-core` dep 合并 | 需在 pair review 中与 W0 consolidation 保持对齐 |

---

## 9. 一句话 verdict

A4 是 P1.A sub-PR 序列中 **唯一含 runtime dep(`@haimang/nacp-core`)** 的 residual 样本:runtime residual 整体搬 / wire vocabulary 留 nacp-core / `HOOK_EVENT_CATALOG` dispatch policy 跟搬 / `HookEventName` re-export deprecation 保留至 D09。A4 合并后 host shell 直接消费 `HookDispatcher`,`ServiceBindingRuntime` 作为 remote hook transport 扩展点由 D06 激活。
