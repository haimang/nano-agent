# Blueprint — `storage-topology` → `workers/filesystem-core/src/storage/`

> 类型：on-demand absorption blueprint(非代表,P0 补齐)
> 状态：draft(worker-matrix P0 Phase 2 产出)
> 直接上游：
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`(D2 归属)
> - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`
> - `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`
> - `docs/design/worker-matrix/D04-filesystem-core-absorption-and-posture.md`(D2 聚合于 filesystem-core)
> - `docs/plan-worker-matrix.md` §7 Q4a(host-local 继续 + tenant wrapper 不绕过)
> 相关原始素材：
> - `packages/storage-topology/package.json`(`dependencies.@haimang/nacp-core: workspace:*`)
> - `packages/storage-topology/src/{15 root files + adapters/{5 files}}`
> - `packages/storage-topology/test/{7 unit + 3 integration + 5 adapters}.test.ts`
> - `packages/storage-topology/scripts/{export-schema,gen-placement-doc}.ts`
> - **相关但不在 D2 scope**:`packages/session-do-runtime/src/do/nano-session-do.ts::getTenantScopedStorage()`(B9 tenant wrapper,归 A1)

---

## 1. 这个 blueprint 解决什么问题

1. `storage-topology` 是 `filesystem.core` 的 canonical storage substrate:hot/warm/cold taxonomy、key/ref builder、placement / demotion / promotion plan、calibration、D1 / DO / KV / R2 adapters、scoped-io tenant-scoped helpers、evidence、mime-gate、errors。它是 B9 tenant wrapper(在 A1 host shell 内的 `getTenantScopedStorage`)所依赖的 I/O 法规与 adapter 源。
2. 它代表的是 **"跨 Cloudflare primitive adapters(D1 / DO / KV / R2)+ placement 决策逻辑 + B9 tenant I/O 契约"** 的 absorption 难度;规模 ~2643 src + ~2173 test ≈ 4816 LOC,是 D1 slice 之外 filesystem-core 最主要的 substrate 单元。
3. 进入 worker-matrix 时,这份 blueprint 让 P4 / D2 PR 作者少想:
   - 哪些文件整包搬(全部 15 root + 5 adapters = 20 src)
   - **Q4a 口径**(host-local 继续 + tenant wrapper 不绕过)如何在 `workers/filesystem-core/src/storage/` 落地
   - `getTenantScopedStorage()` 不在 D2 scope — 归 A1 host shell
   - `@haimang/nacp-core::tenantDoStorage*` helpers 保持 wire vocabulary 上游

---

## 2. 当前代码事实与源路径

### 2.1 package-level 事实

- `package.json` 关键信息:
  - 名称:`@nano-agent/storage-topology`
  - 版本:`2.0.0`(已 major bump 过,稳定)
  - scripts:`build / typecheck / test / test:coverage / build:schema / build:docs`
  - **`dependencies: { "@haimang/nacp-core": "workspace:*" }`**(唯一 runtime dep — `tenantDoStorage*` / `tenantKv*` / `tenantR2*` helpers)
  - `peerDependencies.zod >= 3.22.0`
- **实测 tenant-scoped I/O helpers 落在 `src/adapters/scoped-io.ts`**(231 LOC)— 包装 `@haimang/nacp-core` 的 tenant 上层 helpers,提供 DO / KV / R2 三种 backing 的 scoped I/O
- public surface 由 `src/index.ts`(140 行)汇总
- 实测 LOC:src ~2643(15 root + 5 adapters)/ test ~2173(7 unit + 3 integration + 5 adapters)/ 合计 ~4816

### 2.2 核心源码锚点

| 职责 | 源路径 | 备注 |
|------|--------|------|
| public API aggregator | `packages/storage-topology/src/index.ts` | 全 export |
| version | `src/version.ts` | |
| storage taxonomy | `src/taxonomy.ts` | hot/warm/cold semantic |
| keys | `src/keys.ts` | key builder |
| refs | `src/refs.ts` | ref shape |
| placement | `src/placement.ts` | 207 LOC;placement plan 主体 |
| calibration | `src/calibration.ts` | 298 LOC;校准逻辑 |
| data items | `src/data-items.ts` | 271 LOC;data item 元数据 |
| checkpoint candidate | `src/checkpoint-candidate.ts` | |
| promotion plan | `src/promotion-plan.ts` | |
| demotion plan | `src/demotion-plan.ts` | |
| archive plan | `src/archive-plan.ts` | |
| mime gate | `src/mime-gate.ts` | |
| errors | `src/errors.ts` | 115 LOC |
| evidence | `src/evidence.ts` | 110 LOC;storage evidence emit |
| adapters | `src/adapters/{d1,do-storage,kv,r2}-adapter.ts` + `scoped-io.ts` | D1 / DO / KV / R2 四种 primitive adapter + **scoped-io 包装 `@haimang/nacp-core` tenant helpers** |
| unit tests | `test/{calibration,checkpoint-candidate,keys,mime-gate,placement,refs,taxonomy}.test.ts` | 7 unit |
| integration | `test/integration/{checkpoint-archive-contract,placement-evidence-revisit,scoped-io-alignment}.test.ts` | 3 integration |
| adapters tests | `test/adapters/{d1,do-storage,errors,kv,r2}-adapter.test.ts` | 5 adapters tests |
| build scripts | `scripts/{export-schema,gen-placement-doc}.ts` | tsx |

### 2.3 外部 consumer 锚点(D2 不搬,但需兼顾)

| 事实 | 代码锚点 | 含义 |
|------|----------|------|
| B9 tenant wrapper 在 A1 | `packages/session-do-runtime/src/do/nano-session-do.ts:558::getTenantScopedStorage()` | 返回 `DoStorageLike` shape proxy,**所有非 wrapper DO storage 访问都经此** |
| B9 契约已 shipped | `packages/session-do-runtime/CHANGELOG.md:19-24`(B9 0.3.0 changelog)| `wsHelperStorage()` / any DO put/get/delete 统一走 tenant proxy |
| `@haimang/nacp-core::tenantDoStorage*` | wire vocabulary(W0 consolidation)| tenant key 格式 law — 不归 D2 |

---

## 3. 目标落点

### 3.1 建议目录结构

```text
workers/filesystem-core/
  src/
    storage/
      index.ts                        # D2 public API aggregator
      version.ts
      taxonomy.ts
      keys.ts
      refs.ts
      placement.ts
      calibration.ts
      data-items.ts
      checkpoint-candidate.ts
      promotion-plan.ts
      demotion-plan.ts
      archive-plan.ts
      mime-gate.ts
      errors.ts
      evidence.ts
      adapters/
        d1-adapter.ts
        do-storage-adapter.ts
        kv-adapter.ts
        r2-adapter.ts
        scoped-io.ts
  test/
    storage/
      {7 unit}.test.ts
      integration/
        {3}.test.ts
      adapters/
        {5}.test.ts
  scripts/
    storage/
      export-schema.ts
      gen-placement-doc.ts
```

### 3.2 文件映射表

| 源文件 / 目录 | 目标文件 / 目录 | 搬迁方式 | 备注 |
|---------------|------------------|----------|------|
| `src/index.ts` | `workers/filesystem-core/src/storage/index.ts` | 重建 exports | |
| `src/{15 root files}` | `storage/{同名}` | 原样迁移 | `calibration.ts` 298 LOC、`data-items.ts` 271 LOC 最大 |
| `src/adapters/{5 files}` | `storage/adapters/{同名}` | 原样迁移 | `scoped-io.ts` 保持 `@haimang/nacp-core` import |
| `test/{7 unit}.test.ts` | `test/storage/{同名}` | 调整相对 import | |
| `test/integration/{3 files}` | `test/storage/integration/{同名}` | 调整相对 import | |
| `test/adapters/{5 files}` | `test/storage/adapters/{同名}` | 调整相对 import | |
| `scripts/{2 tsx}` | `workers/filesystem-core/scripts/storage/{同名}` | 原样迁移 | |

---

## 4. 依赖与 import 处理

### 4.1 保留为 package dependency

- **`@haimang/nacp-core`**:`tenantDoStorage* / tenantKv* / tenantR2*` helpers 是 wire vocabulary;D2 sub-PR 不得把这些类型移回 storage-topology
- `zod`:保持 peerDependency

### 4.2 跟随 absorb 一起内化

- 全部 20 src + 15 test + 2 tsx scripts

### 4.3 非迁移项(明确不归 D2)

1. **`getTenantScopedStorage()` / `DoStorageLike` proxy(在 A1 host)**:归 A1 host shell 搬,D2 sub-PR 不得搬家
2. **`@haimang/nacp-core::tenantDoStorage*` / `tenantKv*` / `tenantR2*` helpers**:归 nacp-core(W0 consolidation);D2 sub-PR 不得内联复制
3. **B9 live contract(wsHelperStorage 等 `tenants/<team>/` 命名空间规则)**:由 A1 实装,D2 仅承担 scoped-io 包装层

### 4.4 不在本 blueprint 内解决

- 远端 cross-worker storage call(归 D06 composition / remote bindings)
- 跨 worker 共享 storage namespace(DO / KV / R2 binding 级别)的 wrangler 配置(归 D06 / D08 cutover)
- `@nano-agent/workspace-context-artifacts` 消费 storage-topology 的 import 切换(归 D04 D1 slice)

---

## 5. 测试与验证继承

| 当前测试面 | 进入 worker 后如何继承 |
|------------|------------------------|
| 7 unit tests | 1:1 迁到 `test/storage/` |
| 3 integration tests | 1:1 迁到 `test/storage/integration/`;`scoped-io-alignment` 保持 tenant 契约验证 |
| 5 adapters tests | 1:1 迁到 `test/storage/adapters/` |
| **B9 LIVE 根契约**(如果将来落地) | 按 root guardians 纪律处理 |

---

## 6. 风险与禁止事项

### 6.1 主要风险

1. **`scoped-io.ts` 中对 `@haimang/nacp-core` 的 import 漂移**:必须保留 `@haimang/nacp-core::tenantDoStorage* / tenantKv* / tenantR2*` import;D2 sub-PR 不得把这些 helper 内联复制
2. **Q4a 被误读为 "自由绕过 tenant"**:Q4a 决定是 "host-local 继续"(不接远端 storage worker),不是 "tenant 可绕过";B9 tenant wrapper 契约保持
3. **`@nano-agent/workspace-context-artifacts` consumer 的依赖切换漂移**:WCA 的 `backends/reference.ts` 当前 import `@nano-agent/storage-topology`;D2 搬后,consumer(D04 D1 slice 内部或 context-core coexist 期的 WCA 旧包)必须通过 re-exports / cross-worker import 正确解析 — **pair review D04 sub-PR 作者**
4. **adapter test 依赖 Cloudflare primitive mock**:搬家时 mock helper 必须同步
5. **`v2.0.0` 版本号被误 bump**:搬家 ≠ 升级

### 6.2 明确禁止

1. D2 sub-PR 内把 `getTenantScopedStorage()` 从 A1 境内拉入 filesystem-core
2. D2 sub-PR 内改 `DoStorageLike` shape
3. D2 sub-PR 内激活远端 storage worker / cross-worker storage binding(归 D06)
4. D2 sub-PR 内删除 `packages/storage-topology/`(归 D09)

---

## 7. 收口证据

1. **源路径列表**:`packages/storage-topology/src/{15 root + 5 adapters}` + `test/{7 + 3 + 5}` + `scripts/{2 tsx}`
2. **目标路径列表**:`workers/filesystem-core/src/storage/{15 root + adapters/}` + `test/storage/{...}` + `workers/filesystem-core/scripts/storage/{2 tsx}`
3. **依赖处理说明**:`@haimang/nacp-core` 保留;`getTenantScopedStorage()` 归 A1;B9 contract 不变
4. **测试迁移说明**:15 test 1:1 迁;B9 根契约保持(若将来落地)
5. **optional / deferred 项声明**:
   - 远端 storage worker 接入归 D06
   - WCA consumer 依赖切换归 D04

---

## 8. LOC 与工作量估算

| 维度 | 估算值 | 依据 |
|------|--------|------|
| 源 LOC | ~2643 | 15 root + 5 adapters |
| 测试 LOC | ~2173 | 7 + 3 + 5 |
| 搬家工作量 | **M** | 20 src 含 adapters/;15 test 含 3 层子目录 |
| 预估时长 | 2-3 工作日 | 与 D04 D1 slice 协调 ≈ 额外 0.5-1 天 |
| 关键风险项 | `@nano-agent/workspace-context-artifacts` consumer 切换 / B9 tenant wrapper 契约 | 需 pair review D04 |

---

## 9. 一句话 verdict

D2 是 P4 filesystem-core PR 中 **跨 Cloudflare primitive adapters + B9 tenant 契约 upstream** 的关键 unit:20 src 整包搬 / `@haimang/nacp-core` dep 保留 / `scoped-io` 不内联 / `getTenantScopedStorage()` 归 A1 / Q4a 口径保持 host-local。D2 合并后 filesystem-core 成为 storage substrate 唯一物理归属;A1 的 B9 tenant wrapper 继续消费 D2 的 scoped-io 层。
