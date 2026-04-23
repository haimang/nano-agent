# W3 Closure — Absorption Map, Representative Blueprints, and Optional Dry-Run

> 阶段: `pre-worker-matrix / W3`
> 状态: `closed (design-heavy; optional dry-run deferred to worker-matrix P0 per owner Q1)`
> 作者: `Claude Opus 4.7 (1M context)`
> 时间: `2026-04-23`
> 对应 action-plan: `docs/action-plan/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`
> 对应 design: `docs/design/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`

---

## 1. 结论

W3 已达到 action-plan 约定的关闭条件。

本轮工作 **没有** 实际搬任何 Tier B 包代码,也没有执行 optional capability-runtime dry-run。它真正完成的是:**把 W3 设计层的六件硬交付(template / pattern / map / 2 份必写代表 blueprint / 1 份可选代表 blueprint / closure)全部对齐到当前 repo 代码事实,并对 v0.2 设计中若干与 reality 冲突的表述做 **reality-pass 修正**,让 worker-matrix P0 可直接按 map + 代表 blueprint 执行 absorb。**

---

## 2. 实际交付

### 2.1 设计交付物

| 编号 | 文件 | 状态 | 作用 |
|---|---|---|---|
| T1 | `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md` | `shipped` | 8 节固定 blueprint 模板;worker-matrix P0 新写 blueprint 直接 copy-fill |
| T2-map | `docs/design/pre-worker-matrix/W3-absorption-map.md` | `shipped + reality-verified` | 9 个 Tier B packages / 10 个 absorption units 的 worker 归宿图 |
| T2-bp1 | `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md` | `shipped + reality-revised` | 必写代表 — `bash-core` 吸收样本 |
| T2-bp2 | `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md` | `shipped + reality-revised` | 必写代表 — split-package(context-core + filesystem-core) |
| T2-bp3 | `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md` | `shipped (optional representative, kept)` | 可选代表 — `agent-core` host shell 样板 |
| T4 | `docs/design/pre-worker-matrix/W3-absorption-pattern.md` | `shipped + reality-revised` | 10 条迁移纪律(owner/contract/split/import/bugfix/root-tests/deprecated/honest-partial/evidence/blueprint-boundary) |
| T6 | 本文件 | `shipped` | W3 closure memo |

### 2.2 本轮同步完成的真相层修正

1. **全局 scope 迁移**:所有 pre-worker-matrix active design / action-plan / RFC / template / 生成 registry doc 从 `@nano-agent/nacp-core` / `@nano-agent/nacp-session` 统一到 `@haimang/*`,对齐 W2 首发 `@haimang/nacp-core@1.4.0` + `@haimang/nacp-session@1.3.0` 的真相层。
2. **W4 配置对齐**:`W4-workers-scaffolding.md` 中 `.npmrc` scope (`@nano-agent:registry` → `@haimang:registry`) 与 GitHub Actions `setup-node` `scope: '@nano-agent'` → `'@haimang'`。
3. **`docs/nacp-core-registry.md` 重新生成**:用 `pnpm --filter @haimang/nacp-core build:docs`,registry 说明自动落到 `@haimang/nacp-session`。

### 2.3 Phase 1 reality verification 关键发现

> 对照 `packages/` 实测结果,对已有 W3 设计做差异核查。

1. **capability-runtime 真相**(与 v0.2 设计冲突,已修正):
   - `packages/capability-runtime/package.json` `dependencies: {}`(零运行时依赖;`typescript` / `vitest` / `zod` 都在 `devDependencies`)
   - `grep -r "from ['\"]@nano-agent\|from ['\"]@haimang" packages/capability-runtime/{src,test}` 零命中
   - src + test 合计 9473 LOC
   - → v0.2 设计主文 §6.1 取舍 2 表声称 "跨 package 依赖 = 中 (nacp / hooks)" 与 v0.2 §0.2 "它有真实跨包依赖 + 复杂测试" 均 **与 reality 冲突**;v0.3 reality pass 已统一修正为 "零跨包 dep,代表性来自 semantic coupling(fake-bash surface + typed runtime + honest-partial 纪律)+ 体量"
   - → optional dry-run 若执行,真正 battle-test 的是 "搬 src/test + build + test 可执行流水线",**不是** 循环引用拆解
2. **workspace-context-artifacts 真相**(与 v0.2 设计一致,补齐缺失):
   - `dependencies`:`@haimang/nacp-core` + `@nano-agent/storage-topology`
   - 是 pre-worker-matrix 里 **唯一** 同时跨 Tier A(NACP)与 Tier B(storage-topology)的 Tier B 包
   - 是真正的 "循环引用 / 跨 worker seam" 代表样本,`capability-runtime` 不是
   - `evidence-emitters.ts` 实测暴露:`buildAssemblyEvidence / buildCompactEvidence / buildSnapshotEvidence / buildArtifactEvidence` + 各自 `emit*Evidence` 包装 + `EvidenceAnchorLike / EvidenceSinkLike` 结构类型;split blueprint §3.3 的 helper owner 分配与 reality 对齐
3. **session-do-runtime 真相**(与 blueprint 一致):
   - `dependencies`:`@haimang/nacp-core` + `@haimang/nacp-session` + `@nano-agent/workspace-context-artifacts`
   - blueprint §2.1 直接依赖列表与 reality 完全一致

### 2.4 cross-doc 收口

1. `W3-absorption-blueprint-capability-runtime.md` §2.1 重写 representativeness 说明(零跨包 dep / semantic coupling / LOC 体量)
2. `W3-absorption-blueprint-workspace-context-artifacts-split.md` §2.1 补齐 `@haimang/nacp-core` 依赖并显式列出 evidence helper 实测 surface
3. `W3-absorption-pattern.md` Pattern 4 改写("capability-runtime direct deps 很少" → "`dependencies: {}`(实测零);真正的循环引用样本在 WCA split")
4. `W3-absorption-blueprint-and-dryrun.md` §0.2、§1.4、§6.1 取舍 2、§7.2 T3 step 1 / T3 收口目标 / T4 循环引用节 全部 reality-pass 改写;新版本标记 `v0.3 reality-calibrated`
5. W4-workers-scaffolding.md scope 同步;plan-pre-worker-matrix.md r3 truth layer 对齐;nacp-core-registry.md 重新生成

---

## 3. Mandatory / Optional 裁定表

| 项目 | 设计定位 | 本轮实际结果 | 裁定 |
|---|---|---|---|
| Blueprint TEMPLATE (T1) | mandatory | 已存在且 reality-verified | `done` |
| Absorption map (T2-map) | mandatory | 9 packages / 10 units,reality-verified | `done` |
| capability-runtime blueprint (T2-bp1) | mandatory representative | shipped + v0.3 reality-revised | `done` |
| WCA split blueprint (T2-bp2) | mandatory representative | shipped + v0.3 reality-revised | `done` |
| session-do-runtime blueprint (T2-bp3) | optional representative | shipped(保留 optional 定位) | `done (optional)` |
| Pattern spec (T4) | mandatory | shipped + Pattern 4 reality-revised | `done` |
| W3 closure (T6) | mandatory | 本文件 | `done` |
| capability-runtime optional dry-run (T3) | optional | **deferred to worker-matrix P0**(owner Q1 决策) | `deferred-by-design` |
| 其他 7 份非代表 detailed blueprint | out-of-scope | 按 map 外推规则移交 worker-matrix P0 on-demand | `out-of-scope` |

---

## 4. Optional dry-run 决策与理由

### 4.1 决策

按 owner 在 `W3-absorption-blueprint-and-dryrun.md` §6 Q1 / action-plan §6.1 Q1 的回应:

> **A**:否。optional dry-run 可延期到 worker-matrix P0;W3 的硬交付仍是 map + pattern + 2-3 份代表 blueprint。

因此本轮 **不执行** capability-runtime dry-run。

### 4.2 因此保留 placeholder 的 pattern spec 节

以下 pattern doc 节继续留 placeholder,等待 worker-matrix P0 首次 absorb 时回填:

1. **LOC → 时长经验系数** — 等 worker-matrix P0 真实 absorb 第一个包后回写
2. **可执行流水线样板**(搬 src/test + build + test 的实际命令序列与坑位)— 等首次 absorb 回写
3. **循环引用解决 pattern** — **v0.3 reality pass 新结论**:此节与 capability-runtime dry-run 是否执行 **无关**,必须等 `workspace-context-artifacts` split 真实发生时回填。原因是 capability-runtime 实测零跨包 dep,即使执行 dry-run 也不会产生循环引用 lesson

### 4.3 若未来决定补做 dry-run

行动路径已固化在 `W3-absorption-blueprint-and-dryrun.md` §7.2 T3 step 1-8 + capability-runtime blueprint §8。核心:

1. `mkdir -p workers/bash-core/src workers/bash-core/test`
2. `cp -r packages/capability-runtime/src/* workers/bash-core/src/`;test 同理
3. `cd workers/bash-core && pnpm build && pnpm test`
4. 回写 pattern spec "可执行流水线样板" + "LOC → 时长系数"
5. `packages/capability-runtime/` 保留不删(共存期纪律)

---

## 5. In-Scope / Out-of-Scope verdict

| 项目 | 结果 | 说明 |
|---|---|---|
| map 核对与 reality 校准 | `done` | 10 units / 4 worker;源码锚点与 W0 shipped truth 对齐 |
| template reality 核对 | `done` | 8 节结构稳定;`@haimang/*` scope 对齐 |
| pattern reality 核对 | `done` | 10 条 pattern;Pattern 4 已按实测改写 |
| capability-runtime blueprint | `done` | representativeness 已按 reality 重新表述 |
| WCA split blueprint | `done` | `@haimang/nacp-core` + `@nano-agent/storage-topology` 两条跨包边已对齐 |
| session-do-runtime optional blueprint | `done` | 保留 optional 定位 |
| optional capability-runtime dry-run | `deferred-by-design` | owner Q1 决策;pattern spec 相关节保留 placeholder |
| 其他 7 份 detailed blueprint | `out-of-scope` | 按 map 外推;worker-matrix P0 on-demand 补写 |
| 实际搬迁代码 / deprecate 贴纸 / 删旧包 | `out-of-scope` | W3 是设计层,不是执行层 |
| W3 closure | `done` | 本文件 |

---

## 6. 验证结果

### 6.1 代码 reality 对照(Phase 1)

本轮未跑任何 package 测试,核心验证动作是 **代码事实对照**,与 W1 closure 同类。实际核对的 reality:

1. `packages/capability-runtime/package.json` — `dependencies: {}`,与 blueprint reality 注释一致
2. `grep -r "from ['\"]@nano-agent\|from ['\"]@haimang" packages/capability-runtime/{src,test}` — 零命中
3. `wc -l packages/capability-runtime/{src,test}/**/*.ts` — 合计 9473 行
4. `packages/workspace-context-artifacts/package.json` — `dependencies` 含 `@haimang/nacp-core` + `@nano-agent/storage-topology`
5. `packages/workspace-context-artifacts/src/evidence-emitters.ts` — 确认 4 类 build/emit helper 与 `EvidenceAnchorLike / EvidenceSinkLike` 实测 export
6. `packages/session-do-runtime/package.json` — `dependencies` 含 `@haimang/nacp-core` + `@haimang/nacp-session` + `@nano-agent/workspace-context-artifacts`

### 6.2 文档一致性对照(Phase 2)

cross-doc consistency:

1. **W3 design ↔ W3 blueprints**:§6.1 取舍 2 表 / §0.2 / §1.4 / §7.2 T3 与 3 份 blueprint 的 reality 表述全部对齐到 v0.3
2. **W3 ↔ W0 shipped truth**:所有 blueprint 中的 "protocol imports 去 `@haimang/nacp-core`" 表述与 W0 shipped `@haimang/nacp-core@1.4.0` 一致
3. **W3 ↔ W1 RFC**:WCA split blueprint 对 evidence helper 的 owner 分配与 `evidence-envelope-forwarding.md` RFC "audit.record carrier / 不新增 family" 立场一致
4. **W3 ↔ W2 publish reality**:所有 `@<scope>/nacp-core` 占位符改为 `@haimang/nacp-core`;`workspace:*` interim 路径继续保留为 W4 两种 option 之一
5. **W3 ↔ W4**:若未来执行 dry-run,落点 `workers/bash-core/` 由 W4 提供;本轮不执行,不构成 W4 依赖
6. **W3 ↔ W5**:W5 predicate 可直接引用本 closure 的 mandatory/optional 裁定表

---

## 7. 遗留项与后续交接

### 7.1 已明确不在 W3 收口的项目

1. 其他 7 份非代表 Tier B package 的 detailed blueprint(`agent-runtime-kernel` / `llm-wrapper` / `hooks` runtime residual / `eval-observability` runtime seam / `context-management` / `storage-topology` residual 等)
2. 任何 Tier B package 的实际搬迁 / 代码改动
3. 任何 Tier B package 的 `DEPRECATED` banner 或 README 修改
4. `workers/*` 目录的实际创建(那是 W4 的工作)
5. optional capability-runtime dry-run 的实际执行(deferred)
6. pattern spec "LOC→时长系数" / "可执行流水线样板" / "循环引用解决 pattern" 三个具体数据节的回填

### 7.2 对下游阶段的直接价值

1. **W4** 在 scaffolding 时可以直接按 map 知道 4 个 worker 各自预期吸收哪些 Tier B 单元,不需要再辩论归宿
2. **W5** 可以把本 closure + map + 2-3 份代表 blueprint + pattern spec 一起纳入 final handoff pack;diagonal check 里 "package → worker 归宿" 维度已有 stable evidence
3. **worker-matrix P0**:
   - 开第一个 absorb sub-phase 前 **必读** `W3-absorption-pattern.md` + 对应 blueprint(若存在)
   - 对非代表包按 pattern + map 外推;外推有特殊情况时 on-demand 补 detailed blueprint(用 TEMPLATE copy-fill)
   - 首个 absorb 完成后回填 pattern spec 三个 placeholder 节
   - `workspace-context-artifacts` split 因跨 Tier A/B,是 circular-ref / cross-worker seam 的真实样本,建议它的 absorb PR 同时作为 "循环引用 pattern" 回写回合

### 7.3 对 owner / 架构师的显式 open question

1. 是否在 worker-matrix charter r2 里把 "首次 absorb 必须回写 pattern spec 三个 placeholder 节" 写成硬纪律?(推荐 yes;此处只标记)
2. 若未来某个 Tier B 包在 absorb 时发现与代表 blueprint 差异极大,是修 blueprint 还是就地调整?(pattern spec §11 / W3 设计主文 §6.1 取舍 3 已给 rule,但仍依赖 worker-matrix charter r2 落实)

---

## 8. 最终 verdict

W3 可以关闭。本阶段的价值不是 "提前搬完了 Tier B",而是:

1. **map 已把 "包该去哪" 从模糊判断变成 stable 表**(9 packages / 10 units / 4 workers)
2. **2-3 份代表 blueprint 已让 split-package / fake-bash absorb / host shell landing 三种真实最难场景各自有样本**
3. **pattern spec 已让方法论收敛到同一套 owner / contract / split / bugfix / root-tests / deprecated / honest-partial 纪律**
4. **scope 真相层已对齐到 `@haimang/*`**,后续任何 blueprint 外推不再需要讨论 NACP 发布 scope
5. **optional dry-run 被 honestly deferred**,不冒充 done;pattern spec 三个 placeholder 节的回填路径已预埋

worker-matrix P0 从此不再是 "边设计边搬",而是 **"按 map 执行、按代表 blueprint 外推、按 pattern spec 保持纪律"** 的有节奏吸收。
