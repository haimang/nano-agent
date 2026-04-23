# D03 — context.core 吸收与 posture 决策(C1 + C2)

> 功能簇: `worker-matrix / context-core / absorption-and-posture`
> 讨论日期: `2026-04-23`
> 讨论者: `Claude Opus 4.7 (1M context)`
> 关联调查报告:
> - `docs/plan-worker-matrix.md` §4.3、§5.3 P3、§6.3 P3 DoD、§7 Q3
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`(C1 + C2 归属)
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`(C2/D1 split 代表 blueprint)
> - `docs/eval/worker-matrix/context-core/index.md`
> - `docs/eval/worker-matrix/cross-worker-interaction-matrix.md` §3.2
> 文档状态: `draft`

---

## 0. 背景与前置约束

`workers/context-core/` W4 已 dry-run validated,但 `src/index.ts` 仍是 version-probe。真实 context 能力在 `@nano-agent/context-management@0.1.0`(C1)+ `@nano-agent/workspace-context-artifacts@0.1.0` 的 context slice(C2)。本设计负责把 C1 + C2 按 W3 代表 blueprint 搬进 `workers/context-core/src/`,并明确首波 compact posture(per charter Q3c: opt-in,不默认装)。

- **项目定位回顾**:`context.core` 是 **薄 context substrate**,不是完整 semantic engine;首波运行位置是 host 进程内(agent.core 的 composition),不是独立 remote worker。
- **本次讨论的前置共识**:
  - C1 = `context-management` 全包(budget / async-compact / inspector-facade 三子模块)
  - C2 = `workspace-context-artifacts` 的 context slice(assembly / compact-boundary / redaction / snapshot / evidence-emitters 的 context 部分)
  - 首波 compact posture = **opt-in 保持**(Q3c);remote compact delegate 仍是 W1 RFC direction,不升级
  - `initial_context` consumer 不在本设计内(属 D05);API(`appendInitialContextLayer`)的 **shape + owner** 在本设计冻结
  - evidence-emitters.ts 是 mixed helper,本设计负责 context slice;filesystem slice 归 D04
- **显式排除的讨论范围**:
  - `filesystem.core` D1/D2 吸收(D04)
  - `initial_context` host consumer 接线(D05)
  - default compact 改为自动装(与 Q3c 冲突)
  - context.core 升级为厚 semantic engine(slot / reranker / intent routing)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`context.core C1+C2 absorption + first-wave compact posture`
- **一句话定义**:把 `packages/context-management/**`(C1)与 `packages/workspace-context-artifacts/` 的 context slice(C2)搬进 `workers/context-core/src/`,提供 `appendInitialContextLayer` API(被 D05 消费),保持 compact 为 opt-in,不升级为厚 engine。
- **边界描述**:
  - **包含**:C1(budget / async-compact / inspector-facade)+ C2(context-layers / context-assembler / compact-boundary / redaction / snapshot)+ evidence-emitters 的 context 4 类 build/emit helper(assembly / compact / snapshot + 2 个结构类型 EvidenceAnchorLike / EvidenceSinkLike)+ `appendInitialContextLayer` API shape
  - **不包含**:filesystem slice(D04)、host consumer 接线(D05)、compact default 自动装、inspector facade default ON、`restoreVersion` 真实装配
- **关键术语对齐**:

| 术语 | 定义 |
|------|------|
| C1 | `@nano-agent/context-management` 全包 |
| C2 | `@nano-agent/workspace-context-artifacts` 的 context slice(非 filesystem 部分)|
| compact posture | 首波 `context.compact.*` 是否自动装在 default composition(Q3c:否)|
| `appendInitialContextLayer(payload)` | context.core 提供给 host 的 API;D05 host consumer 会调它 |
| mixed helper | evidence-emitters.ts 既有 context 侧 helper 也有 filesystem 侧 helper;本设计处理 context 侧 |
| thin substrate | 首波运行位置是 host 进程内;不独立 remote,不自造 context RPC |

### 1.2 参考调查报告

- `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md` — C2/D1 split 代表 blueprint(本设计处理其中 C2 部分)
- `docs/design/pre-worker-matrix/W3-absorption-map.md` §4 C1/C2 落点
- `docs/eval/worker-matrix/context-core/index.md` §3 6 判断
- `docs/rfc/remote-compact-delegate.md` — W1 direction-only RFC(不升级为 shipped runtime)

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**:把 context substrate 从 package 形态迁到 worker 形态,保留首波 host-local 运行 posture
- **服务于**:D05(host consumer 需要 `appendInitialContextLayer` API 落位)、D06(default composition 的 workspace handle 位置)、D04(evidence-emitters filesystem 侧需要知道 context 侧已搬走)
- **依赖**:W0 shipped `@haimang/nacp-core` evidence vocabulary、W4 已存在 `workers/context-core/` shell、W3 C2/D1 split 代表 blueprint
- **被谁依赖**:D05(`appendInitialContextLayer` API owner)、D04(filesystem slice split 对 context slice 的 expectation)、D09(C1/C2 吸收稳定后打 deprecated)、D08(cutover 改 `workers/context-core/package.json`)

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| D04 filesystem absorption | 强耦合(mixed helper split)| 强 | `evidence-emitters.ts` 需要 C2/D1 同时约束 owner;PR 顺序建议 D03 先 merge,D04 后 split |
| D05 initial_context consumer | 下游 | 强 | D05 需要本设计冻结的 `appendInitialContextLayer` API shape |
| D06 default composition | 下游 | 中 | D06 在 composition 里挂 context handle;本设计不改 composition |
| D01 agent.core absorption | 上游 | 中 | D01 搬 host shell 后,host composition 里 context handle 的 import 需指向 workers/context-core(共存期由 D05 管控)|
| D07 agent↔bash activation | 无直接 | 弱 | context 不参与 bash tool.call |
| D08 cutover | 下游 | 弱 | cutover 时改依赖版本,本设计保证 import 层次不漂 |
| D09 deprecation | 下游 | 弱 | C1/C2 吸收稳定后打 banner |

### 2.3 一句话定位陈述

> "在 nano-agent 里,`context.core absorption + posture` 是 **worker-matrix P3 核心交付物**,负责 **把 context-management 全包 + workspace-context-artifacts context slice 搬进 workers/context-core/src/,提供 appendInitialContextLayer API,保持 compact opt-in 纪律(Q3c)**,对上游(charter)提供 **context runtime 物理归属** 的真实兑现,对下游(D05)要求 **只消费已冻结的 API shape,不越位到 context 内部实现**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点

| 被砍项 | 来源 | 砍的理由 | 未来回补? |
|--------|------|----------|-----------|
| 首波 remote compact worker transport | W1 RFC 方向 | 非 first-wave critical;保持 RFC direction | 否(除非 live evidence 出现)|
| compact 默认自动装 | 原始 v0.1 想象 | Q3c:opt-in 保持 | 否 |
| inspector facade default ON | "提供 observability" | 违反 "默认 OFF + env gate + auth" 纪律 | 否(owner 按 deploy 配 env)|
| `restoreVersion` 真实装配 | "把 stub 补成 real" | honest-partial 纪律;W3 pattern §8 | 否 |
| slot store / reranker / intent routing 扩面 | 假设厚 engine | 违反 thin substrate | 否(需独立 charter)|
| 吸收时合并 C1 / C2 public API | "减少 re-export" | byte-identical 纪律 | 否 |

### 3.2 接口保留点

| 扩展点 | 表现形式 | 第一版行为 | 未来演进 |
|--------|----------|------------|----------|
| `appendInitialContextLayer(payload)` | context.core public API | 接收 `SessionStartInitialContextSchema` 推断出的 payload;push 到 layers stack | 后续可支持多次调用 / 优先级 / 替换;本设计只冻结签名 |
| `createKernelCompactDelegate` | 已存在的 opt-in factory | 保持;D06 default composition 不默认挂 | 若 compact posture 改为 "默认装",本设计不必改,D06 / 后续 charter 改即可 |
| inspector facade mount helper | `mountInspectorFacade(...)` | 默认 OFF + env gate | 按需 ON |
| evidence sink interface | `EvidenceSinkLike` 结构类型 | 保留;host 侧 BoundedEvalSink 实现之 | D04 filesystem slice 也消费同一 shape |

### 3.3 完全解耦点

- **解耦对象**:C2 context slice 与 D1 filesystem slice(在 `workspace-context-artifacts` 内部)
- **解耦原因**:C2 → context.core;D1 → filesystem.core;两者分别吸收到不同 worker;helper owner 由 W3 blueprint §3.3 明确
- **依赖边界**:evidence-emitters.ts 的 build/emit `Assembly/Compact/Snapshot` → context;`Artifact` → filesystem;2 个结构类型(`EvidenceAnchorLike / EvidenceSinkLike`)保持薄 structural seam,不阻塞 split

### 3.4 聚合点

- **聚合对象**:`workers/context-core/src/` 作为 context substrate 唯一物理归属
- **聚合形式**:W3 C2 blueprint §4 建议目录(`context-layers.ts / context-assembler.ts / compact-boundary.ts / redaction.ts / snapshot.ts / evidence/{assembly.ts, compact.ts, snapshot.ts}/` + `budget/ async-compact/ inspector-facade/` 三个 C1 子目录)
- **为什么不能分散**:C1 + C2 协同提供 assembly + compact + evidence 的完整语义;分散会让 host consumer 无单一 owner 可调

---

## 4. 三个代表实现对比(以 nano-agent 内部 precedent)

### 4.1 D01 A1 host shell 搬家

- **实现概要**:session-do-runtime → workers/agent-core/src/host
- **亮点**:sub-PR 序列、保留共存期、byte-identical
- **借鉴**:本设计执行同样的 byte-identical + 共存期纪律
- **不照抄**:D03 是单包吸收 + 单包 slice(C1 整包 + C2 slice),不用 sub-PR 序列那么细;一次 C1+C2 PR 即可

### 4.2 W0 1.4 consolidation(evidence vocabulary 搬家)

- **实现概要**:evidence vocabulary 搬进 `@haimang/nacp-core/evidence/`,runtime 仍留 package
- **亮点**:wire/runtime 分层
- **借鉴**:C2 吸收时,`EvidenceRecord` / `EvidenceAnchorSchema` 继续 import `@haimang/nacp-core`;不回搬
- **不照抄**:D03 搬的是 runtime(builder / emitter helpers),不是 vocabulary

### 4.3 W3 C2/D1 split 代表 blueprint

- **实现概要**:workspace-context-artifacts 同时跨 Tier A(NACP)+ Tier B(storage-topology)真实跨包边
- **亮点**:mixed helper 按 owner 表分配(§3.3 已指)
- **借鉴**:本设计严格按此表对 evidence-emitters 的 context 部分做 owner 归属
- **不照抄**:D03 只处理 C2 context 部分;D1 filesystem 部分由 D04 处理

### 4.4 横向对比速查表

| 维度 | D01 A1 | W0 evidence | W3 C2/D1 blueprint | **D03(本设计)** |
|------|--------|-------------|-------------------|-----------------|
| 目标位置 | workers/agent-core/src/host | nacp-core/src/evidence | 2 个 workers(C2→context;D1→filesystem)| workers/context-core/src |
| 搬运粒度 | host shell 整体 | vocabulary only | slice + slice | **C1 整包 + C2 slice** |
| 是否 byte-identical | 是 | wire 层是 | slice 内是 | **是** |
| 是否需要同包内 split | 否 | 否 | 是(C2 vs D1 split 在 WCA 包内)| **是(C2/D1 split 在 WCA 包内,本设计只管 C2)** |

---

## 5. In-Scope / Out-of-Scope

### 5.1 In-Scope

- **[S1]** `packages/context-management/src/**`(C1)搬进 `workers/context-core/src/`:`budget/ async-compact/ inspector-facade/` 三子目录;public API 在 index.ts aggregate
- **[S2]** `packages/workspace-context-artifacts/src/` 的 context slice(`context-layers.ts / context-assembler.ts / compact-boundary.ts / redaction.ts / snapshot.ts`)搬进 `workers/context-core/src/`
- **[S3]** `evidence-emitters.ts` 中 **context 侧 helper**(`build/emitAssemblyEvidence / build/emitCompactEvidence / build/emitSnapshotEvidence`)+ `EvidenceAnchorLike / EvidenceSinkLike` 结构类型搬进 `workers/context-core/src/evidence/{assembly.ts, compact.ts, snapshot.ts}/`
- **[S4]** 新增 `appendInitialContextLayer(payload: SessionStartInitialContext): void` API 与关联类型冻结;本 PR 先 ship API 形态,host 消费由 D05 完成
- **[S5]** tests(C1 package-local + C2 slice 涉及 tests)迁到 `workers/context-core/test/`
- **[S6]** `workers/context-core/src/index.ts` 从 version-probe 升级为 context runtime entry(暴露 public API;保留 version-probe JSON shape 兼容)
- **[S7]** `workers/context-core/package.json` 补齐 devDependencies(C1/C2 原需 zod / typescript / vitest);`dependencies` 含 `@haimang/nacp-core workspace:*`、`@nano-agent/storage-topology workspace:*`(本阶段保留,D04 后视具体 import 是否仍需)
- **[S8]** 首波 compact posture 在文档层与代码层显式:**compact 保持 opt-in,不默认挂;`createKernelCompactDelegate` 作为 opt-in factory 继续存在但不被 default composition 默认调用**
- **[S9]** `restoreVersion` 继续 throw `not implemented`,honest-partial 不改

### 5.2 Out-of-Scope

- **[O1]** host 侧 `dispatchAdmissibleFrame` 调 `appendInitialContextLayer`(D05)
- **[O2]** filesystem slice(D1)搬家(D04)
- **[O3]** `evidence-emitters.ts` 中 artifact 侧 helper 搬(D04)
- **[O4]** compact 默认自动装 / remote compact delegate shipped(W1 RFC direction 保持)
- **[O5]** inspector facade default ON
- **[O6]** `restoreVersion` 真实实现
- **[O7]** `slot store / reranker / intent routing` 扩面
- **[O8]** context.core DEPRECATED banner(D09)
- **[O9]** cutover 切 published(D08)
- **[O10]** real preview deploy for context-core(charter §6.3 允许 P3 defer 到 P5)

### 5.3 边界清单

| 项目 | 判定 | 理由 |
|------|------|------|
| `appendInitialContextLayer` 返回 `Promise<void>` 还是 sync `void` | `in-scope 冻结为 sync void` | payload 已由 host 在 `acceptClientFrame` 解析;assembler append 是本地内存操作;D05 可在 host 侧用 `void` 调用 |
| C2 slice 里 `redaction.ts` 是否搬 | `in-scope` | redaction 属 context 侧评估纪律 |
| `ContextAssembler.assemble(...)` signature 改动 | `out-of-scope` | byte-identical |
| `workers/context-core/package.json` 保留对 `@nano-agent/storage-topology` 依赖 | `in-scope` | C2 slice 内部部分 helper 还会消费 storage-topology 类型;共存期保留;D04 后视情况重评 |
| 本 PR 内同步做 C2 slice 的 re-export(package 原位)清理 | `out-of-scope` | 共存期保留原 package 对 context slice 的 re-export;D08 cutover / D09 deprecation 再处理 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**:我们选择 **把 C1 全包 + C2 slice 合并到一次 PR** 而不是 **C1 PR + C2 PR 拆开**
   - **为什么**:C1 的 async-compact 与 C2 的 compact-boundary 语义协同;拆开会让中间态 host consumer 拿不到完整 context API
   - **代价**:PR 略大
   - **重评条件**:若执行中发现 WCA slice split 复杂度远高于预期,可临时拆

2. **取舍 2**:我们选择 **compact 保持 opt-in** 而不是 **default composition 自动装**
   - **为什么**:charter Q3c + thin substrate 纪律
   - **代价**:首波 live loop 不自动有 compact
   - **缓解**:`createKernelCompactDelegate` 保留为 opt-in;D06 可通过 env flag 启用

3. **取舍 3**:我们选择 **`appendInitialContextLayer` 在本 PR 先 ship API shape** 而不是 **与 D05 host consumer 一并做**
   - **为什么**:API owner 是 context.core;host 消费是 D05 主题;shape 先冻结能让 D05 直接编码
   - **代价**:本 PR merge 后、D05 merge 前,该 API "有 shape 但无 caller"(短暂 dead code)
   - **缓解**:package-local test 验证 API 不 throw

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|------|----------|------|------|
| C2 slice 搬家破坏 WCA 原 package 的 context re-export | 共存期 re-export 失效 | session-do-runtime / capability-runtime / agent-core 消费者红 | 保留 `packages/workspace-context-artifacts/src/index.ts` 对 context slice 的 re-export(从 workers/context-core/src 反向 import 是 hack,更简单的做法是:原 package 保持原文件,workers 侧 copy;共存期接受两份;D09 deprecate 时再统一)|
| `evidence-emitters.ts` split 时 context / filesystem helper 边界误判 | mixed helper owner 分错 | evidence 发送路径重复 / 断裂 | 严格按 W3 blueprint §3.3 表;D03 与 D04 作者 pair review 彼此的 slice 归属 |
| compact opt-in 在执行中被偷偷改成默认 | reviewer 漏看 | 违反 Q3c | PR review checklist 显式禁止修改 `createDefaultCompositionFactory` 内 compact 装配状态(属 D06 边界)|
| inspector facade env gate 被 default ON 混入 | "方便调试" | 违反纪律 | PR 内 grep `ENABLE_INSPECTOR` / `mountInspectorFacade` 调用,非 env-gated 即红线 |
| `@nano-agent/storage-topology` 在 workers/context-core 的依赖让 Tier B scope 污染 context worker | workspace package resolution | build 红 / runtime 找不到 | 共存期接受;D04 后若 storage adapter 路径由 filesystem.core owner,context.core 可移除该依赖 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己**:context 能力的单一物理归属;`appendInitialContextLayer` API owner 清晰(context.core),host 消费 clean(D05)
- **对 nano-agent 长期演进**:context.core 保持 thin substrate 的纪律不漂移;未来若需要厚 engine,走独立 charter
- **对 "上下文管理 / Skill / 稳定性" 杠杆**:
  - 上下文管理:核心价值所在;本设计是 worker-matrix 的骨干
  - 稳定性:opt-in 纪律让首波 live loop 少一类 failure mode
  - Skill:reserved skill.core 未来如入场,需要 context seam;本设计提供清晰 substrate 模板

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | C1 搬家 | context-management → workers/context-core/src | ✅ 3 子目录(budget / async-compact / inspector-facade)完整搬;97 tests 全绿 |
| F2 | C2 slice 搬家 | WCA context slice → workers/context-core/src | ✅ 5 文件(context-layers / context-assembler / compact-boundary / redaction / snapshot)完整搬 |
| F3 | evidence-emitters context 侧分拣 | assembly/compact/snapshot helpers + 2 结构类型 → workers/context-core/src/evidence/ | ✅ context 侧 3 类 build+emit helper + `EvidenceAnchorLike/EvidenceSinkLike` 结构类型迁入 |
| F4 | `appendInitialContextLayer` API | context.core 提供给 host 的 layer push API | ✅ 签名冻结为 `(payload: SessionStartInitialContext) => void`;package-local test 验证 shape + 空 payload 行为 |
| F5 | tests 迁移 | C1 + C2 涉及的 package-local tests | ✅ `pnpm --filter workers/context-core test` 全绿(>= 原 WCA C2 涉及 + 97 C1)|
| F6 | `workers/context-core/src/index.ts` 升级 | 从 version-probe 升为 context runtime entry | ✅ 暴露 public API;保留 version-probe JSON 兼容 |
| F7 | compact posture 冻结 | 确认 opt-in 保持 | ✅ `createKernelCompactDelegate` 存在但不被 default composition 默认调用;文档层 + 代码层双重 asserting |
| F8 | `restoreVersion` honest-partial 保留 | 不改 | ✅ 继续 throw `not implemented`;test 覆盖 |

### 7.2 详细阐述

#### F1: C1 搬家

- **输入**:`packages/context-management/src/**`
- **输出**:`workers/context-core/src/{budget,async-compact,inspector-facade}/`
- **主要调用者**:D05 host consumer(via `appendInitialContextLayer`)、D06 composition(via opt-in compact delegate)
- **核心逻辑**:cp -r src → workers/context-core/src;保留 3 子目录;public API 由 `workers/context-core/src/index.ts` aggregate;`AsyncCompactOrchestrator` 保持 armed → prepare → commit 生命周期
- **边界情况**:`inspector-facade` 默认 OFF;env gate by `ENABLE_INSPECTOR`
- **一句话收口目标**:✅ **3 子目录完整搬;97 C1 tests package-local 全绿**

#### F2: C2 slice 搬家

- **输入**:`packages/workspace-context-artifacts/src/{context-layers,context-assembler,compact-boundary,redaction,snapshot}.ts`
- **输出**:`workers/context-core/src/{context-layers,context-assembler,compact-boundary,redaction,snapshot}.ts`
- **核心逻辑**:cp 5 文件;改 import(内部相对 / `@haimang/nacp-core` 保持);不改 public API
- **边界情况**:`snapshot.ts` 依赖 filesystem slice 的 types/paths/refs → 共存期保留 `@nano-agent/workspace-context-artifacts` import,D04 后改 workers/filesystem-core 来源
- **一句话收口目标**:✅ **5 个 context slice 文件完整搬;原 package 文件保留作 re-export 源**

#### F3: evidence-emitters context 侧分拣

- **输入**:`packages/workspace-context-artifacts/src/evidence-emitters.ts`(mixed)
- **输出**:`workers/context-core/src/evidence/{assembly.ts, compact.ts, snapshot.ts}/`
- **核心逻辑**:
  1. 按 W3 blueprint §3.3 表抽 context 侧 helper:`build/emitAssemblyEvidence`、`build/emitCompactEvidence`、`build/emitSnapshotEvidence`
  2. 2 个结构类型 `EvidenceAnchorLike / EvidenceSinkLike` 复制进 workers/context-core(D04 的 filesystem 侧同时也会有 copy — 这是故意;W3 blueprint 明确 "保持极薄 structural seam")
  3. filesystem 侧 `build/emitArtifactEvidence` **不搬**(D04 处理)
- **边界情况**:原 `evidence-emitters.ts` 保留整体原位作 re-export,避免 consumer 突然红
- **一句话收口目标**:✅ **3 类 evidence helper(assembly/compact/snapshot)+ 2 结构类型迁入 workers/context-core/src/evidence/;artifact helper 留在原文件供 D04 搬**

#### F4: `appendInitialContextLayer` API

- **输入**:D05 的 caller 期望
- **输出**:
  ```ts
  export function appendInitialContextLayer(
    assembler: ContextAssembler,
    payload: SessionStartInitialContext
  ): void;
  ```
  或 assembler method:`assembler.appendInitialContextLayer(payload: SessionStartInitialContext): void`
- **主要调用者**:D05 在 host `dispatchAdmissibleFrame` 内 `session.start` 分支
- **核心逻辑**:
  1. payload 已由 `nacp-session::SessionStartInitialContextSchema` 解析
  2. 按 payload 内容 push 对应 layer 到 assembler 的 layers stack;保留既有 `layer priority / redaction` 规则
  3. 无副作用 evidence(evidence 由 host composition 在 assemble 时统一发)
- **边界情况**:
  - payload 为空 / undefined → no-op
  - payload 含多 layer 时 → 按 schema 顺序依次 append
- **一句话收口目标**:✅ **API 签名冻结;package-local test 覆盖空 payload / 单 layer / 多 layer 三类;D05 作者可直接按该 shape 消费**

#### F5: tests 迁移

- **输入**:C1 package test + C2 涉及的 WCA test(assembly / compact-boundary / snapshot / redaction)
- **输出**:`workers/context-core/test/`
- **核心逻辑**:按文件迁;`vitest.config` 对齐;fixture / helper 一并搬;filesystem 相关 test **不迁**(留给 D04)
- **一句话收口目标**:✅ **`pnpm --filter workers/context-core test` 绿;总数 >= C1 97 tests + C2 涉及部分**

#### F6: index.ts 升级

- **输入**:F1-F4 aggregate
- **输出**:升级后的 `workers/context-core/src/index.ts`
- **核心逻辑**:保留 fetch handler(默认 returns version-probe JSON 兼容 W4 shape);export public API(C1 3 子模块 + C2 5 文件 + evidence context 侧 + `appendInitialContextLayer`)
- **一句话收口目标**:✅ **`curl preview-url`(若 deploy)仍返回合法 JSON;`import { ContextAssembler, appendInitialContextLayer } from '@haimang/context-core-worker'` 或等价 in-workspace 消费路径 resolve 成功**

#### F7: compact posture 冻结

- **输入**:charter Q3c
- **输出**:文档 + 代码层 double assertion:
  1. 文档层:本设计 + D06 design(若 D06 存在并指向 context.core handle)都写明 "compact opt-in"
  2. 代码层:`createKernelCompactDelegate` 存在,但 D06 的 `createDefaultCompositionFactory` 不将其默认装入
- **一句话收口目标**:✅ **D06 merge 后 grep `createKernelCompactDelegate` 在 default composition 的调用点 = 空;opt-in caller 可通过 env flag 手动装配**

#### F8: `restoreVersion` honest-partial

- **输入**:C1 `async-compact` 中的 stub
- **输出**:continue throw `not implemented`
- **一句话收口目标**:✅ **honest-partial 保留;package-local test 覆盖 throw**

### 7.3 非功能性要求

- **性能目标**:本地 in-process 路径,性能与原 C1/C2 package 等同
- **可观测性要求**:inspector facade 默认 OFF;evidence sink 走 host 的 BoundedEvalSink(owner 在 agent.core,per W3 pattern §10)
- **稳定性要求**:root cross + B7 LIVE 全程绿
- **测试覆盖要求**:C1 97 tests + C2 涉及部分 + `appendInitialContextLayer` 新增 3-5 tests

---

## 8. 可借鉴的代码位置清单

### 8.1 C1 / C2 内部

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| `packages/context-management/src/{budget,async-compact,inspector-facade}/` | C1 三子模块 | F1 整体搬 |
| `packages/workspace-context-artifacts/src/context-assembler.ts` | 上下文组装 | F2 搬 |
| `packages/workspace-context-artifacts/src/compact-boundary.ts` | compact 边界 | F2 搬 |
| `packages/workspace-context-artifacts/src/snapshot.ts` | snapshot 构建 | F2 搬 |
| `packages/workspace-context-artifacts/src/redaction.ts` | 脱敏 | F2 搬 |
| `packages/workspace-context-artifacts/src/evidence-emitters.ts:48-177` | assembly/compact 侧 helper | F3 按行区分搬 |
| `packages/workspace-context-artifacts/src/evidence-emitters.ts:218-...` | snapshot 侧 helper | F3 搬 |

### 8.2 W3 blueprint 对应节

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| `W3-absorption-blueprint-workspace-context-artifacts-split.md:48-63` | context-core 侧建议文件 | F2 直接消费 |
| `W3-absorption-blueprint-workspace-context-artifacts-split.md:85-103` | mixed helper 分拣表 | F3 直接消费 |
| `W3-absorption-blueprint-workspace-context-artifacts-split.md:104-133` | 建议目标目录 | F6 目录结构 |

### 8.3 必须避开的反例

| 位置 | 问题 | 避开理由 |
|------|------|----------|
| 把 `BoundedEvalSink` 的 **durable owner** 从 host DO 搬到 context.core | 破坏 W3 pattern §10 | sink owner 留在 host |
| 在 `appendInitialContextLayer` 里写 side-effect evidence(立即 `emit`)| 违反 "emit 归 assemble 时统一做" | 保持 context-layers 的纯函数属性 |
| 吸收时把 `mountInspectorFacade` 改为 default ON | charter 明确纪律 | 否 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

D03 在 P3 phase 提供 context runtime 的物理所有权迁移 + `appendInitialContextLayer` API 的 shape 冻结。预期代码量:C1 ~2000 src + 97 tests + C2 slice ~1500 src + tests 若干,合计搬家约 5000 LOC + package.json / index.ts 增量。共存期 ~3 个月;WCA 原包保持 re-export。compact posture 明确 opt-in,不做 remote delegate。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 说明 |
|----------|------------|------|
| 对 nano-agent 核心定位的贴合度 | **5** | 上下文管理是 nano-agent 长期深耕方向;本设计是骨干 |
| 第一版实现的性价比 | **4** | 搬家机械 + API 冻结简单;难点在 mixed helper split 与 D04 协调 |
| 对 "上下文管理 / Skill / 稳定性" 杠杆 | **5** | 上下文管理直接受益;未来 skill 入场有清晰 thin substrate 参考 |
| 对开发者友好度 | **4** | API owner 清晰;共存期需要看双份 import 路径 |
| 风险可控程度 | **4** | evidence-emitters split 风险由 W3 blueprint 精确表消解 |
| **综合价值** | **4.4** | P3 骨干交付物 |

### 9.3 下一步行动

- [ ] **决策确认**:owner approve;P3 PR 作者 claim
- [ ] **关联 PR**:C1+C2 吸收 PR + D04 协调 review
- [ ] **待深入调查**:
  - `EvidenceAnchorLike / EvidenceSinkLike` 在 context 侧与 filesystem 侧是否需要同一文件位置?(建议:各自 copy;保持薄 structural seam)
  - `workers/context-core` 是否在本设计内做 real preview deploy?(建议:defer 到 P5 cutover 或 owner trigger)

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7 | 初稿;基于 charter + W3 C2/D1 blueprint + Q3c 编制 |
