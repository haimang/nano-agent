# D04 — filesystem.core 吸收与 posture 决策(D1 + D2)

> 功能簇: `worker-matrix / filesystem-core / absorption-and-posture`
> 讨论日期: `2026-04-23`
> 讨论者: `Claude Opus 4.7 (1M context)`
> 关联调查报告:
> - `docs/plan-worker-matrix.md` §4.4、§5.3 P4、§6.4 P4 DoD、§7 Q4
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`(D1 + D2 归属)
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`(C2/D1 split 代表 blueprint)
> - `docs/eval/worker-matrix/filesystem-core/index.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

`workers/filesystem-core/` W4 已 dry-run validated,但 `src/index.ts` 仍是 version-probe。真实 workspace/storage substrate 在 `@nano-agent/workspace-context-artifacts` 的 filesystem slice(D1)+ `@nano-agent/storage-topology@2.0.0`(D2)。本设计负责把 D1 + D2 按 W3 代表 blueprint 搬进 `workers/filesystem-core/src/`,并冻结首波 connected-mode / remote posture 为 **host-local 继续**(per charter Q4a)。

- **项目定位回顾**:`filesystem.core` 是 **typed workspace / path / ref / storage substrate**,不是 Linux/POSIX 文件系统;workspace truth 单一源,四个 worker 共用同一套 workspace law。
- **本次讨论的前置共识**:
  - D1 = `workspace-context-artifacts` filesystem slice(types / paths / refs / artifacts / prepared-artifacts / promotion / mounts / namespace / backends/*)
  - D2 = `storage-topology` full package(tenant*/placement/adapters/calibration)
  - 首波 posture = **host-local 继续**(Q4a);不发明远端 filesystem RPC
  - `ReferenceBackend.connected` 默认 `false`(memory-only);切 connected 由 owner gate
  - D04 merge 先后顺序建议:D03 先 merge → D04 处理 WCA 中剩余 filesystem slice + evidence-emitters artifact 侧
- **显式排除的讨论范围**:
  - D03 context slice(已归 D03)
  - 独立 remote filesystem RPC family(W1 RFC direction-only)
  - 完整 Linux/POSIX FS / overlay / Python / HTTPFS
  - tenant wrapper 放宽(B9 契约)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`filesystem.core D1+D2 absorption + host-local first-wave posture`
- **一句话定义**:把 WCA filesystem slice(D1)+ storage-topology(D2)搬进 `workers/filesystem-core/src/`,保留 workspace 单一真相,首波 posture 为 host-local(不 remoteize),tenant wrapper 纪律不变。
- **边界描述**:
  - **包含**:D1(types/paths/refs/artifacts/promotion/mounts/namespace/backends)+ D2(tenant storage helpers / placement / adapters / calibration)+ evidence-emitters artifact 侧 helper + 2 结构类型的 filesystem copy
  - **不包含**:context slice(D03)、独立 remote service、DO/KV/R2 在 filesystem.core 独立 entry、tenant 绕过、新 backend
- **关键术语对齐**:

| 术语 | 定义 |
|------|------|
| D1 | WCA filesystem slice(非 context 部分)|
| D2 | `storage-topology` 全包 |
| host-local posture | 首波 runtime 继续在 host 进程内(agent.core composition)运行;不发独立 Worker 流量 |
| connected mode | `ReferenceBackend` 的模式;default = `false`(memory-only)|
| tenant wrapper | `tenant*` 系列 API 强制使用;B9 契约 |
| workspace single truth | 四个 worker 共用同一套 `MountRouter / WorkspaceNamespace / backends` |

### 1.2 参考调查报告

- `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md` — C2/D1 split 代表 blueprint(本设计处理其中 D1 部分)
- `docs/design/pre-worker-matrix/W3-absorption-map.md` §4 D1/D2 落点
- `docs/eval/worker-matrix/filesystem-core/index.md` §3 6 判断
- `packages/storage-topology/src/*` 现有 tenant law 实现
- `docs/rfc/nacp-workspace-rpc.md` — W1 direction-only RFC(不升级为 shipped)

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**:workspace / storage substrate 的物理 owner 从 packages 迁到 workers/filesystem-core;保持 host-local first-wave posture
- **服务于**:所有 workspace consumer(agent.core composition / bash.core capability handlers / context.core snapshot)、D08 cutover、D09 deprecation
- **依赖**:W0 已把 storage law 搬进 `@haimang/nacp-core/storage-law/`(B9 契约 tenancy API 亦在 nacp-core);W4 `workers/filesystem-core/` shell;D03 已完成 context slice(避免 evidence-emitters 分拣冲突)
- **被谁依赖**:D03(共存期 evidence-emitters / snapshot 依赖 types/paths/refs 继续可 resolve)、D01 共存后的 agent.core composition、D02 共存后的 bash.core workspace handler、D08 cutover、D09 deprecation

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| D03 context absorption | 强耦合(mixed helper split)| 强 | evidence-emitters artifact 侧归 D04;共存期 context 侧 snapshot 仍依赖 types/paths/refs |
| D01 agent.core absorption | 上游 | 中 | host composition 消费 workspace;共存期保持旧 import |
| D02 bash.core absorption | 上游 | 中 | bash workspace handlers 消费 `WorkspaceNamespace`;保持共存期 |
| D06 default composition | 下游 | 中 | composition 需要 workspace handle;由 D04 提供最终物理 owner |
| D07 agent↔bash activation | 无直接 | 弱 | bash 消费 workspace 不走 tool.call.* |
| D08 cutover | 下游 | 弱 | cutover 改版本号 |
| D09 deprecation | 下游 | 弱 | D1+D2 吸收稳定后打 banner |
| W1 workspace-rpc RFC | 方向参考 | 弱 | 保持 RFC-only,不升级为 shipped(Q4a)|

### 2.3 一句话定位陈述

> "在 nano-agent 里,`filesystem.core absorption + posture` 是 **worker-matrix P4 核心交付物**,负责 **把 WCA filesystem slice + storage-topology 搬进 workers/filesystem-core/src/,保留 workspace 单一真相,冻结 host-local first-wave posture(Q4a),不发明远端 filesystem RPC**,对上游(charter)提供 **workspace/storage 物理归属** 的真实兑现,对下游(D06 / D08 / D09)要求 **消费同一套 workspace law,不 fork**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点

| 被砍项 | 来源 | 砍的理由 | 未来回补 |
|--------|------|----------|----------|
| 独立 remote filesystem RPC family | 原始 "对称 4 workers" 心智 | 违反 Q4a + W1 direction-only | 否(live 证据出现再 RFC revision)|
| connected mode default ON | "让 reference backend live" | 打破 `connected: false` 纪律 | 否(owner 按需 env gate)|
| 吸收时增 backend(新 DO/KV/R2 变种)| 顺手扩 | W3 pattern §8 honest-partial 纪律 | 否 |
| `evidence-emitters.ts` 直接 import workers/context-core | 循环引用 | thin structural seam 原则 | 否 |
| 吸收时合并 D1 + D2 public API | 减少 re-export | byte-identical | 否 |
| 开 `filesystem-core` real preview deploy 作默认 | 对称性 | charter §6.4 允许 defer | 若 posture 决策改变才做 |

### 3.2 接口保留点

| 扩展点 | 表现形式 | 第一版行为 | 未来演进 |
|--------|----------|------------|----------|
| `ReferenceBackend.connected` | constructor 参数 / env | `false` | 切 `true` 走 owner gate |
| tenant wrapper API | `tenantR2* / tenantKv* / tenantDoStorage*` | B9 契约保持 | 按 nacp-core storage-law 演进 |
| `MountRouter` 注册 | `register(mount, backend)` | 不改 | 新 backend 走独立 RFC |
| `buildArtifactEvidence / emitArtifactEvidence` | evidence helper | 迁入 `filesystem-core/evidence-emitters-filesystem.ts` | 随 filesystem.core 共演 |
| `WorkspaceNamespace` public API | `readFile / writeFile / listDir / stat / deleteFile` | byte-identical | 新 op(如 mkdir proper)走 W1 RFC revision |

### 3.3 完全解耦点

- **解耦对象**:D04 filesystem slice 与 D03 context slice
- **解耦原因**:同 WCA 包内的 slice;各自 owner 清晰(D03 context / D04 filesystem)
- **依赖边界**:mixed helper evidence-emitters 按 W3 blueprint §3.3 分拣;`EvidenceAnchorLike / EvidenceSinkLike` 两个结构类型各自 copy(薄 structural seam)

### 3.4 聚合点

- **聚合对象**:`workers/filesystem-core/src/` 作为 workspace/storage substrate 的 worker-side canonical copy
- **聚合形式**:W3 C2/D1 blueprint §4 目标目录(`types.ts / paths.ts / refs.ts / artifacts.ts / prepared-artifacts.ts / promotion.ts / mounts.ts / namespace.ts / backends/{memory,reference,types}.ts / evidence-emitters-filesystem.ts`)+ D2 所有 tenant* + placement + adapters + calibration
- **为什么不能分散**:workspace truth 单一源 — path / ref / tenant law 散落会让 agent/bash/context 拿不同版本的 workspace

---

## 4. 三个代表实现对比(内部 precedent)

### 4.1 D03 C1+C2 搬家

- **实现概要**:context 侧合并 PR;byte-identical
- **借鉴**:同样的 byte-identical + 共存期纪律
- **不照抄**:D04 还有 D2(storage-topology 全包),规模更大;posture 决策明确(Q4a)

### 4.2 B9 tenancy absorption

- **实现概要**:B9 把 `tenant*` 搬进 `nacp-core/tenancy/`
- **借鉴**:tenant wrapper 纪律;本设计在 D2 中保持 B9 契约引用
- **不照抄**:B9 是 Tier A 聚合,本设计是向 workers/ 迁

### 4.3 W3 C2/D1 split blueprint

- **实现概要**:mixed helper 按 owner 表分配
- **借鉴**:evidence-emitters artifact 侧归 D04
- **不照抄**:D04 额外吸收整个 storage-topology;blueprint 主要描述 split

### 4.4 横向对比

| 维度 | D03 | B9 tenancy | W3 blueprint | **D04** |
|------|-----|-----------|--------------|---------|
| 搬运粒度 | C1 包 + C2 slice | tenant* 集合 | slice owner 表 | **D1 slice + D2 整包** |
| 目标位置 | workers/context-core/src | nacp-core/tenancy | 2 workers | **workers/filesystem-core/src** |
| posture 决策 | compact opt-in(Q3c)| n/a | n/a | **host-local(Q4a)** |
| tenant 约束 | 间接 | 核心 | n/a | **核心(B9 契约不变)** |

---

## 5. In-Scope / Out-of-Scope

### 5.1 In-Scope

- **[S1]** WCA filesystem slice(D1)搬进 `workers/filesystem-core/src/`:`types.ts / paths.ts / refs.ts / artifacts.ts / prepared-artifacts.ts / promotion.ts / mounts.ts / namespace.ts / backends/{memory.ts, reference.ts, types.ts}`
- **[S2]** `storage-topology` 全包(D2)搬进 `workers/filesystem-core/src/storage/`:`tenant*` helpers + `placement/` + `adapters/{do,kv,r2}/*` + `calibration/`
- **[S3]** evidence-emitters **artifact 侧** helper(`build/emitArtifactEvidence`)迁入 `workers/filesystem-core/src/evidence-emitters-filesystem.ts`
- **[S4]** `EvidenceAnchorLike / EvidenceSinkLike` 结构类型在 filesystem.core 内部各自 copy(保持薄 structural seam,对齐 D03 F3)
- **[S5]** tests(WCA filesystem 相关 + storage-topology 全部)迁到 `workers/filesystem-core/test/`
- **[S6]** `workers/filesystem-core/src/index.ts` 从 W4 version-probe 升级为 **probe-only library worker entry**(`absorbed_runtime: true` + `library_worker: true`);不把 filesystem/storage runtime 作为远端 HTTP API 暴露
- **[S7]** `workers/filesystem-core/package.json` 补齐 devDependencies;`dependencies` 保持 `@haimang/nacp-core workspace:*` + 必要 Tier B(如果 D2 helpers 依赖 nacp-core storage-law 则保持)
- **[S8]** Posture 冻结:host-local first-wave(Q4a)— 代码层 + 文档层显式声明
- **[S9]** `ReferenceBackend.connected` 默认 `false` 不变
- **[S10]** tenant wrapper 纪律不变 — `getTenantScopedStorage` 继续由 host DO 调用(不迁到 filesystem.core)

### 5.2 Out-of-Scope

- **[O1]** 独立 remote filesystem RPC service(W1 direction-only)
- **[O2]** 独立 `workers/filesystem-core` real preview deploy(charter §6.4 允许 defer 到 P5 / owner trigger)
- **[O3]** `ReferenceBackend.connected` default ON
- **[O4]** context slice(D03)
- **[O5]** 新 backend / 新 mount / 新 ref scheme
- **[O6]** 放宽 tenant wrapper
- **[O7]** mkdir / ts-exec / 其他 honest-partial 能力的升级
- **[O8]** DEPRECATED banner(D09)
- **[O9]** cutover(D08)
- **[O10]** 物理删除 `packages/storage-topology` / `packages/workspace-context-artifacts`

### 5.3 边界清单

| 项目 | 判定 | 理由 |
|------|------|------|
| D2 `storage-topology` 是否保持原 scope `@nano-agent/storage-topology` | `in-scope 保持` | Tier B 内部 scope 不变 |
| `workers/filesystem-core/src/storage/` 是否在 index.ts 里暴露全部 `tenant*` helpers | `in-scope 暴露` | consumer(agent DO、bash handlers)需要 |
| D04 PR 内同时做 `packages/workspace-context-artifacts` 的 re-export 清理 | `out-of-scope` | 共存期保留;D08/D09 再处理 |
| D04 吸收后 `@nano-agent/storage-topology` 依赖在 D01/D02/D03 包内的 import | `保持` | 共存期兼容 |
| `nacp-core/storage-law/` 中的 storage law 是否在 D04 里被任何修改 | `out-of-scope` | W0 契约 |
| D04 PR 内激活 `FILESYSTEM_CORE` service binding(agent-core wrangler)| `out-of-scope` | charter §4.1 说该 slot 由 D04/D03 posture 决定;D04 posture = host-local,因此不激活 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**:我们选择 **host-local first-wave posture**(Q4a)而不是 **局部/完整 remoteize**
   - **为什么**:workspace 单一真相 + conservative-first + live 证据不要求远端
   - **代价**:filesystem.core 在首波不是独立 Worker 流量;preview deploy 可 defer
   - **重评条件**:若后续有跨地域 / 跨租户存储隔离需求,再开 RFC

2. **取舍 2**:我们选择 **D1 slice + D2 整包同 PR** 而不是 **D1 PR + D2 PR 拆开**
   - **为什么**:D2 tenant helpers 与 D1 backends 协同演化(reference backend 直接使用 tenant*)
   - **代价**:PR 更大
   - **重评条件**:若执行中 D1 / D2 互相不依赖(grep 实证),可拆

3. **取舍 3**:我们选择 **保留 `ReferenceBackend.connected` 默认 false** 而不是 **切 true 尝试 real storage**
   - **为什么**:memory-only 行为稳定;connected 需 DO/R2 配置
   - **代价**:reference 功能在 preview 受限
   - **缓解**:owner 按 env 开启

4. **取舍 4**:我们选择 **evidence-emitters artifact 侧独立 copy `EvidenceAnchorLike/EvidenceSinkLike`** 而不是 **跨 workers import**
   - **为什么**:薄 structural seam;避免循环 import
   - **代价**:两份 copy(context/filesystem 各一份)
   - **缓解**:W3 blueprint 明确允许

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|------|----------|------|------|
| D04 搬家破坏 WCA 原 re-export | 共存期失效 | 所有 workspace consumer 红 | 保留 `packages/workspace-context-artifacts/src/*` 对 filesystem slice 的 re-export;原包保持 |
| D2 tenant law 与 `@haimang/nacp-core/storage-law/` 不一致 | import 错导 | B9 契约破坏 | `storage-topology` 的 tenant helpers 继续 import `@haimang/nacp-core/storage-law/`;grep 验证 |
| connected mode 被误默认为 true | 配置漂移 | memory-only 纪律破坏 | test 断言 `connected === false`;PR review gate |
| `MountRouter` / `WorkspaceNamespace` 语义 drift | 搬家时不小心改签名 | 单一真相破裂;bash / context 消费者炸 | byte-identical + 现有 workspace tests 回归 |
| D04 PR 内提前激活 `FILESYSTEM_CORE` binding | 越界 | agent-core preview 红 | charter §5.2 明确;PR review gate |
| D2 存储 adapter 与 B7 LIVE 行为冲突 | tenant wrapper 被绕过 | B9 契约破坏 | B7 LIVE 5 tests 全程绿;每 sub-PR 跑 `node --test` |

### 6.3 价值

- **对开发者自己**:workspace/storage 单一物理归属;修 bug 路径清晰
- **对 nano-agent 长期演进**:保持 conservative-first;为未来(如果出现)跨地域存储隔离留空间
- **对 "上下文管理 / Skill / 稳定性" 杠杆**:
  - 稳定性:B9 契约 + 单一 workspace truth 继续成立
  - Skill:filesystem.core 作为 typed substrate,为 skill sandbox 留空间
  - 上下文管理:context snapshot 仍有稳定 filesystem 支撑

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | D1 filesystem slice 搬家 | WCA filesystem 部分 → workers/filesystem-core/src | ✅ W3 blueprint §3.2 列出的 11 个文件完整搬;byte-identical |
| F2 | D2 storage-topology 全包搬家 | `storage-topology` → workers/filesystem-core/src/storage/ | ✅ `tenant*` / `placement/` / `adapters/` / `calibration/` 完整搬;B9 契约不变 |
| F3 | evidence-emitters artifact 侧分拣 | artifact helper + 结构类型 copy → workers/filesystem-core/src/evidence/ | ✅ `build/emitArtifactEvidence` + 2 结构类型迁入 |
| F4 | tests 迁移 | WCA filesystem 相关 + storage-topology 全部 | ✅ `pnpm --filter workers/filesystem-core test` 全绿;B7 LIVE 5 tests 全绿 |
| F5 | `workers/filesystem-core/src/index.ts` 升级 | 从 probe 升为 probe-only library worker entry | ✅ `absorbed_runtime: true` + `library_worker: true`;不对外暴露 filesystem/storage runtime HTTP API |
| F6 | package.json 更新 | devDeps 补 | ✅ `pnpm install` 绿;B9 tenant 依赖继续指 `@haimang/nacp-core` |
| F7 | posture 冻结 | host-local 显式声明 | ✅ 文档 + 代码层 asserting;`FILESYSTEM_CORE` binding 仍注释态 |
| F8 | `ReferenceBackend.connected` 默认 false 保证 | 不改 default | ✅ test 断言 `connected === false`;env gate 可 opt-in |
| F9 | tenant wrapper 约束保持 | `getTenantScopedStorage` 仍由 host 调 | ✅ B9 契约 grep 命中验证 |

### 7.2 详细阐述

#### F1: D1 filesystem slice 搬家

- **输入**:`packages/workspace-context-artifacts/src/{types,paths,refs,artifacts,prepared-artifacts,promotion,mounts,namespace}.ts` + `backends/{memory,reference,types}.ts`
- **输出**:`workers/filesystem-core/src/{types,paths,refs,artifacts,prepared-artifacts,promotion,mounts,namespace}.ts` + `backends/{memory,reference,types}.ts`
- **主要调用者**:D06 composition(workspace handle)、D02 搬家后的 bash workspace handlers(共存期)、D03 已搬 context slice 中的 snapshot
- **核心逻辑**:cp 11 文件 + backends/;改 import(相对路径 / `@haimang/nacp-core` 保持;对 `@nano-agent/storage-topology` import 保持直到 F2 落地)
- **边界情况**:F1 与 F2 在同一 PR 内完成,避免 `reference.ts` 对 storage-topology 的 import path 漂移
- **一句话收口目标**:✅ **filesystem slice 11 文件 + backends/ 完整搬入 workers/filesystem-core/src**

#### F2: D2 storage-topology 全包搬家

- **输入**:`packages/storage-topology/src/**`
- **输出**:`workers/filesystem-core/src/storage/`(或按原目录保持,如 `tenant/`、`placement/`、`adapters/`、`calibration/`)
- **核心逻辑**:cp -r src → workers/filesystem-core/src/storage;保留原子目录结构
- **边界情况**:
  - `tenant*` helpers 对 `@haimang/nacp-core/storage-law/` 的 import 保留(W0/B9)
  - DO/KV/R2 adapters runtime 不激活;代码搬但不用 env 触发
- **一句话收口目标**:✅ **storage-topology 全包进 workers/filesystem-core/src/storage;169 tests 全绿**

#### F3: evidence-emitters artifact 侧分拣

- **输入**:`packages/workspace-context-artifacts/src/evidence-emitters.ts`(mixed)
- **输出**:`workers/filesystem-core/src/evidence-emitters-filesystem.ts`;2 结构类型各自 copy
- **核心逻辑**:按 W3 blueprint §3.3 抽 `buildArtifactEvidence / emitArtifactEvidence`;`EvidenceAnchorLike / EvidenceSinkLike` 结构类型在 filesystem.core 也有一份(与 D03 F3 镜像)
- **边界情况**:原 evidence-emitters.ts 保持原位作共存期 re-export
- **一句话收口目标**:✅ **artifact 类 build/emit helper + 2 结构类型迁入 workers/filesystem-core/src/evidence;D03 context 侧不受影响**

#### F4: tests 迁移

- **输入**:WCA filesystem 相关 tests(mounts/namespace/backends/artifacts/promotion/paths/refs)+ storage-topology 全部 tests
- **输出**:`workers/filesystem-core/test/`
- **边界情况**:cross-worker / B7 LIVE tests **不迁**
- **一句话收口目标**:✅ **`pnpm --filter workers/filesystem-core test` 绿(包含 D2 约 169 + D1 slice 部分)**

#### F5: index.ts 升级

- **输入**:F1-F3 aggregate
- **输出**:升级后的 `workers/filesystem-core/src/index.ts`
- **核心逻辑**:保留 fetch handler 默认返回 version-probe JSON，并把 worker 明确标为 `library_worker: true`;不要求把 D1/D2 API 聚合进 deploy entry
- **一句话收口目标**:✅ **library worker 身份清晰;index.ts 形状服从 host-local posture(不需独立 fetch 路由到 runtime substrate)**

#### F6: package.json

- **输入**:原两个 package 的 deps
- **输出**:`workers/filesystem-core/package.json` 补 devDeps;`dependencies` 保留 `@haimang/nacp-core workspace:*`
- **一句话收口目标**:✅ **`pnpm install` 绿;`pnpm -r typecheck` 绿**

#### F7: posture 冻结

- **输入**:charter Q4a
- **输出**:
  - 文档层:本设计 + `workers/filesystem-core/README.md` 显式声明 host-local
  - 代码层:`workers/agent-core/wrangler.jsonc` 的 `FILESYSTEM_CORE` binding 继续保持注释态;agent-core composition 的 workspace handle 继续从 in-process consume
- **一句话收口目标**:✅ **`wrangler.jsonc` 注释态 slot;文档 double assertion**

#### F8: ReferenceBackend connected 默认 false

- **输入**:当前 `connected: false` 实现
- **输出**:不改
- **一句话收口目标**:✅ **test 覆盖 default constructor 的 `connected === false`;env gate 可 opt-in**

#### F9: tenant wrapper 约束

- **输入**:现有 `getTenantScopedStorage` / B9 契约
- **输出**:grep 验证 workers/filesystem-core 内 `DurableObjectState` 直接 API 被访问时都走 `getTenantScopedStorage` 或等价 wrapper
- **一句话收口目标**:✅ **grep zero 命中 "raw storage without tenant wrapper";B7 LIVE 5 tests 全绿**

### 7.3 非功能性要求

- **性能目标**:host-local 路径,与原 package 等同
- **可观测性**:artifact evidence 发送路径不漂移
- **稳定性**:B7 LIVE 5 全绿;B9 tenant 契约保持
- **测试覆盖**:D1 slice + D2 全包 tests 合并 >= 169 + WCA D1 侧覆盖

---

## 8. 可借鉴的代码位置清单

### 8.1 D1 / D2 内部

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| `packages/workspace-context-artifacts/src/{types,paths,refs,artifacts,promotion,mounts,namespace}.ts` | D1 workspace core | F1 整体搬 |
| `packages/workspace-context-artifacts/src/backends/{memory,reference,types}.ts` | D1 backends | F1 搬;保持 connected default false |
| `packages/workspace-context-artifacts/src/evidence-emitters.ts:184-256` | artifact 侧 helper | F3 分拣 |
| `packages/storage-topology/src/tenant*` | B9 契约 core | F2 搬;import 保持 nacp-core storage-law |
| `packages/storage-topology/src/adapters/{do,kv,r2}/*` | 存储适配 | F2 搬;不激活 |
| `packages/storage-topology/src/placement/*` | placement policy | F2 搬 |
| `packages/storage-topology/src/calibration/*` | calibration seam | F2 搬 |

### 8.2 W3 blueprint 对应节

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| `W3-absorption-blueprint-workspace-context-artifacts-split.md:65-83` | filesystem 侧建议文件 | F1 直接消费 |
| `W3-absorption-blueprint-workspace-context-artifacts-split.md:85-103` | mixed helper 分拣表 | F3 直接消费 |
| `W3-absorption-blueprint-workspace-context-artifacts-split.md:115-133` | 建议目标目录 | F5 目录结构 |

### 8.3 必须避开的反例

| 位置 | 问题 | 避开理由 |
|------|------|----------|
| 在 `workers/filesystem-core` 里新建 tenant 绕过 wrapper 的 storage 访问 | B9 契约破坏 | 否 |
| F1 中改 `WorkspaceNamespace.readFile` 签名 | 破坏单一 workspace 真相 | 否 |
| 在 F2 中默认激活 KV/R2 adapter | 违反 host-local posture | 否 |
| 吸收同时新建 `workers/filesystem-core/src/http/` 路由 | 违反 Q4a host-local | 否(W1 RFC direction)|

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

D04 在 P4 phase 提供 workspace/storage substrate 物理所有权迁移 + host-local first-wave posture 的显式冻结。预期代码量:D1 slice ~1400 src + 部分 WCA tests + D2 storage-topology ~2500 src + 169 tests,合计约 4000-5000 LOC 搬家。共存期 ~3 个月。不做独立 preview deploy(charter 允许 defer);不激活 remote binding。PR 规模大但机械,主要风险在 B9 契约对齐 + evidence-emitters 分拣边界。

### 9.2 Value Verdict

| 维度 | 评级 | 说明 |
|------|------|------|
| 贴合度 | **5** | workspace 单一真相 + tenant law 是 nano-agent 基石 |
| 性价比 | **4** | 大 PR 但机械;host-local posture 省去 RPC 发明 |
| 对 "上下文管理 / Skill / 稳定性" 杠杆 | **4** | 稳定性直接受益;skill / 上下文有稳定 substrate |
| 开发者友好度 | **4** | 单一 workspace law 易查;共存期需看双份 import |
| 风险可控 | **4** | 169 + WCA filesystem tests 作回归网;B9 契约 grep 验证 |
| **综合价值** | **4.2** | P4 骨干;host-local posture 维持纪律 |

### 9.3 下一步行动

- [ ] **决策确认**:owner approve;P4 PR 作者 claim
- [ ] **关联 PR**:D1+D2 吸收 PR + D03 协调
- [ ] **待深入调查**:
  - D2 storage-topology 内 `calibration/` 是否仍有外部 consumer?(若无,吸收后可进一步轻量化)
  - `@nano-agent/storage-topology` 在 D04 后是否立即升 `2.0.1` 作 marker?(建议:否,统一 D09)

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7 | 初稿;基于 charter + W3 blueprint + Q4a 编制 |
