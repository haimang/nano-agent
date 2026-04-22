# W0 — NACP Protocol Consolidation

> 功能簇:`pre-worker-matrix / W0 / nacp-consolidation`
> 讨论日期:`2026-04-21`
> 讨论者:`Claude Opus 4.7 (1M context)` + owner pending review
> 关联文档:
> - Charter: `docs/plan-pre-worker-matrix.md` §4.1 A / §7.1
> - Tier 映射:`docs/plan-pre-worker-matrix.md` §1.3
> - 姊妹 design:`docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`(依赖本 design 的产出)
> - 当前 NACP contract:`docs/rfc/nacp-core-1-3-draft.md`
> 文档状态:`executed (v0.3 shipped)`
>
> **修订历史**:
> - v0.1 (2026-04-21):初稿
> - v0.2 (2026-04-21):post-GPT-review narrowing — BoundedEvalSink class 不搬 NACP(只搬 dedup/overflow shape + extractMessageUuid helper);hooks catalog 拆分(wire-level event name + payload schema → NACP;HookEventMeta runtime metadata 留 hooks 包)
> - v0.3 (2026-04-22):executed / shipped — W0 已按 narrowed scope 落地；收口见 `docs/rfc/nacp-core-1-4-consolidation.md` 与 `docs/issue/pre-worker-matrix/W0-closure.md`

---

## 0. 背景与前置约束

### 0.1 为什么 W0 必须最先

pre-worker-matrix 阶段的 6 个 Phase(W0-W5)中,W0 是**唯一**全部处理"把已有契约吸收进 NACP"的纯整合工作;它不新增任何跨 worker 行为,但它让后续 W1-W5 所需的"协议单一真理源"落到位。

没有 W0 的先行整合:
- W1 设计跨 worker 协议时,无法引用稳定的 evidence vocabulary / storage-law(因为它们还散落在 3 个不同 package)
- W2 发布 `nacp-core` 时,消费者(未来的 `workers/*`)会发现"要用 NACP 就还得额外装 session-do-runtime / workspace-context-artifacts / hooks / storage-topology",这违背 Tier A 对外 only 2 包的定位
- W3 写 absorption blueprint 时,Tier B 每个 package 里都"混着一部分将来要进 NACP + 一部分将来进 worker",blueprint 粒度会失控
- W4 的 4 个空 worker 声明 dependency 时,只能依赖 2 个 NACP 包;若 Tier A 吸收未完成,workers 无法一次性 bind 所有 cross-worker 契约

所以 W0 是**其他 5 个 phase 的 strict precondition**。

### 0.2 前置共识(不再辩论)

- **Tier A 映射 owner 接受**:charter §1.3 已冻结 5 类吸收对象
- **Additive-only**:1.4.0 对 1.3.0 消费者零破坏;re-export 维持旧 import path 至少 3 个月
- **Shape 不改**:吸收过程中,每个原类/函数/schema 的 TS shape 保持 byte-identical;只换"物理家"
- **测试一起搬**:吸收对象的 test 同步迁移;原 test 文件保持最小 re-export smoke
- **B7 LIVE 契约保持**:`test/b7-round2-integrated-contract.test.mjs` 5/5 必须保持 green
- **`nacp-core` 单包扩容**:所有 Tier A 对象聚合到 `nacp-core`,不新建 `nacp-evidence` / `nacp-storage-law` 子包(违反"NACP 就 2 包对外"纪律)

### 0.3 显式排除

- 不重构 evidence / cross-seam / hooks / storage 的**语义**(吸收 ≠ 重构)
- 不改 `nacp-session` 除非某吸收对象被 `nacp-session` 消费 → 那才 minor bump session
- 不删原 package 的文件(只做 re-export)
- 不吸收"逻辑层"的 emitter 函数(W0 只吸收 schema;emitter helper 属 agent.core)
- 不处理 `evidence-emitters.ts` 里的 emit 函数(W3 blueprint 决定去向,默认 agent.core per owner 答案 3)
- 不设计新跨 worker 协议(那是 W1 的工作)

### 0.4 代码事实核查产生的 4 处 charter 修正(v0.2 新增 1 处)

核查原码后,发现 charter §7.1 内部描述与当前代码不完全对齐:

| charter 原文 | 代码事实 | 本 design 修正 |
|---|---|---|
| "hook catalog 8 个 v1 event" | 实际已是 **18 events**(B5 expansion shipped:Class A 8 + Class B 4 + Class D 6) | W0 吸收 18 events 的 **wire-level 部分**(名称 + payload schema),不吸收 runtime metadata |
| "cross-seam.ts 搬 anchor + header law" | `cross-seam.ts` 含 3 块:propagation(anchor+headers)+ failure taxonomy + startup queue | W0 **只吸收 propagation 部分**;failure taxonomy 与 startup queue 属 agent.core runtime 细节,留原位 |
| "storage-topology keys.ts + refs.ts 搬 tenant law" | `NacpRefSchema` 已在 `nacp-core/src/envelope.ts`;`refs.ts` 的 `buildDoStorageRef` 等 helper 基于 NacpRefSchema 构建 | W0 **只吸收 helper 函数 + `_platform/` reserved 常量**;不重复 schema(它已在 nacp-core) |
| **【v0.2 新增】** "BoundedEvalSink 搬 nacp-core/evidence/sink.ts" | `BoundedEvalSink` 是 runtime class(FIFO 队列 + dedup 检测 + overflow disclosure ring buffer),**不是 wire protocol** | **v0.2 修订**:W0 **不搬 BoundedEvalSink class 本身**;只搬**协议-adjacent shape**:`EvalSinkEmitArgs` / `EvalSinkOverflowDisclosure` / `EvalSinkStats` 3 个 type + `extractMessageUuid` helper + dedup contract 文档;**class 留在 session-do-runtime**(随 agent.core absorption 进入 workers/agent-core)。GPT review 盲点 3 指出:`nacp-core` 不应成为"承载所有跨 worker 公共语义"的大核心包 |

> **v0.2 post-GPT-review 说明**:GPT review 盲点 3 指出原 r1 的 W0 让 `nacp-core` 边界膨胀,把 runtime class 误当作协议吸收对象。v0.2 严格区分 **wire-level vocabulary / helper-adjacent 协议**(→ NACP)vs **runtime class / dispatch logic**(留 Tier B 包,随 worker absorption 搬 workers/)。

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`NACP Protocol Consolidation`(W0 五件套吸收)
- **一句话定义**:把散落在 4 个 Tier B package 里的 cross-worker 契约**物理归位**到 `nacp-core`,保持 wire shape 与 consumer API byte-identical,版本号 additive 递进
- **边界描述**:
  - **包含**:5 类吸收 + re-export + 版本 bump + CHANGELOG + RFC + regression
  - **不包含**:任何 semantics 变动;emit 函数的迁移(属逻辑层);新协议设计(W1);发布(W2);worker 级 absorption(worker-matrix P0)

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|---|---|---|
| absorb / consolidate | 把一段代码从 Tier B package 物理搬到 `nacp-core`,原位置保留 re-export | 本 design 核心动作 |
| re-export | 原文件改为 `export * from "@nano-agent/nacp-core/..."` + deprecated JSDoc | 保证 1.3.0 消费者零破坏 |
| additive minor bump | 1.3.0 → 1.4.0,只加 symbol 不减不改 | 严格遵守 semver minor 定义 |
| vocabulary | 某领域内**数据形态**的集合(Zod schema / TS type / 常量),区别于"runtime logic" | 本 design 只吸收 vocabulary |
| logic / emitter | 基于 vocabulary 做 side effect 的函数 | 属逻辑层,留原 package 或 worker 吸收 |
| `_platform/` 例外 | `_platform/config/feature_flags` 这一单一 KV 例外,其余 `_platform/` 禁用 | storage law 核心纪律 |

### 1.3 参考上下文

- charter `docs/plan-pre-worker-matrix.md` §1.3 Tier A 映射表(吸收源 + 目的地)
- charter §7.1 W0 In-Scope 7 项(本 design 的展开对象)
- 姊妹 design `W1-cross-worker-protocols.md` §7.2 F7(依赖 W0 的 evidence vocabulary shape)
- B9 review response `docs/code-review/after-foundations/B9-reviewed-by-GPT.md` §6(提供 1.3.0 → 1.4.0 additive 纪律的直接 precedent)

### 1.4 代码事实锚点(吸收源)

| 吸收对象 | 当前物理位置 | 文件行数 | 核心 export 符号 |
|---|---|---|---|
| `BoundedEvalSink` + 3 个附属类型 | `packages/session-do-runtime/src/eval-sink.ts` | 292 | `BoundedEvalSink / EvalSinkEmitArgs / EvalSinkOverflowDisclosure / EvalSinkStats / BoundedEvalSinkOptions` + `extractMessageUuid` helper |
| CrossSeamAnchor + propagation | `packages/session-do-runtime/src/cross-seam.ts` (lines 1-120 约) | 285(总),propagation 占约 120 行 | `CrossSeamAnchor / CROSS_SEAM_HEADERS / buildCrossSeamHeaders / readCrossSeamHeaders` |
| Evidence vocabulary 4 kinds(schema 部分) | `packages/workspace-context-artifacts/src/evidence-emitters.ts` 的 build* 函数返回类型 + stream enum | 282 总;schema 可提取 ~80 行 | 4 kinds `"assembly" / "compact" / "artifact" / "snapshot"` + 每 kind 的 record shape |
| Hooks catalog vocabulary | `packages/hooks/src/catalog.ts` | 285 | `HookEventName`(18 values)+ `HookEventMeta` + 每个 event 的 `allowedOutcomes / payloadSchema / redactionHints / blocking` |
| Storage law helpers + `_platform` 例外 | `packages/storage-topology/src/keys.ts` (85) + `refs.ts` (166) | 251 合计 | `buildDoStorageRef / buildR2Ref / buildKvRef / DO_KEYS / KV_KEYS / R2_KEYS / KV_KEYS.featureFlags()` 等 |

**总计吸收代码量**:约 **1395 总 lines 中的 ~700-800 lines** 真正进入 nacp-core(扣除:cross-seam 里的 failure taxonomy / startup queue、evidence-emitters 里的 emit 函数、keys/refs 里已在 NACP 的 NacpRefSchema 引用等)。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **整体架构里的角色**:W0 把"跨 worker 协议真理"从**散落 4 个 package**收束到**单一 NACP 包**;是 pre-worker-matrix 阶段让 `packages/ 是 context 非 library` 这一 owner 决策**物理生效**的第一个动作
- **服务于**:W1(依赖 evidence vocabulary 与 storage-law)、W2(单一发布对象)、W3(blueprint 画清 package 残留 surface)、W4(worker 空壳只依赖 nacp-core)
- **依赖**:B9 shipped 的 `nacp-core 1.3.0`(W0 是其 additive minor bump)
- **被谁依赖**:除 W0 以外所有 pre-worker-matrix phase + worker-matrix absorption

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `nacp-core 1.3.0` 现有 registry | W0 extends | 强 | 吸收后的 vocabulary 与现有 message types 共存 |
| `session-do-runtime` eval-sink consumer | W0 re-export 保护 | 强 | 现有消费路径必须保持工作 |
| `workspace-context-artifacts` evidence emitter | W0 借 schema 不借 emit | 中 | emitter 函数留原位,由 W3 blueprint 决定最终归属 |
| `hooks` 18-event runtime | W0 借 catalog vocab 不借 runtime | 中 | Hook dispatch / emission 留 hooks 包 |
| `storage-topology` DO/R2/KV adapters | W0 不动 adapter,只吸收 law | 弱 | adapters 是 logic 层,归 filesystem.core |
| `nacp-session 1.3.0` | 看依赖情况 | 弱 | 若 session 代码引用 CrossSeamAnchor,则 session bump |
| B7 LIVE wire contract | 保持 | 强 | 5 tests 必须继续 green |

### 2.3 一句话定位陈述

> 在 nano-agent 里,`NACP Protocol Consolidation` 是 **整合型 phase**,负责 **把散落在 4 个 Tier B package 里的 cross-worker 契约 vocabulary 物理归位到 `nacp-core` 并 ship 1.4.0**,对上游(owner 决策)提供 **"packages 是吸收上下文" 这条决策的第一次物理兑现**,对下游(W1-W5 及 worker-matrix)要求 **通过 re-export 平滑迁移,不强制一次性修改 consumer**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点(哪里可以砍)

| 被砍项 | 来源 | 砍的理由 | 未来是否回补 |
|---|---|---|---|
| `cross-seam.ts` 的 failure taxonomy(`TraceRecoveryReason` 等) | session-do-runtime | 属 agent.core runtime 的错误分类,不是 cross-worker wire 契约 | 否(留在原包,W3 blueprint 随 session-do-runtime 吸收到 agent.core) |
| `cross-seam.ts` 的 startup queue | 同上 | 是 agent.core 启动时序问题,不是协议 | 否(同上) |
| `evidence-emitters.ts` 的 `emit*()` 函数 | workspace-context-artifacts | emit 是 host-coordinated side effect,per owner 答案 3 归 agent.core | 否(W0 只搬 shape;emit 函数由 worker-matrix P0 决定家) |
| `hooks/catalog.ts` 的 dispatch 逻辑 | hooks | dispatch 是 runtime,不是 vocabulary | 否(dispatch 随 hooks 包吸收到 agent.core) |
| `NacpRefSchema` 自身 | 已在 nacp-core | 避免 double-define;storage-law 只吸收 **基于** NacpRefSchema 的 helper | 否(本来就没必要再搬) |
| 语义变动 | — | 吸收只动物理位置,不动 semantics | 否(语义改动需独立 RFC) |

### 3.2 接口保留点(必须留扩展空间)

| 扩展点 | 表现形式 | 第一版行为 | 未来可能演进 |
|---|---|---|---|
| `nacp-core/src/evidence/` 子目录 | 新建 | 放 sink + vocabulary + forwarding(W1 会加) | 如果出现新 evidence kind,在此目录 additive 扩 |
| `nacp-core/src/hooks-catalog/` 子目录 | 新建 | 放 18-event vocabulary | 未来 Class C 事件(FileChanged / CwdChanged)或其他 class 可 additive 加 |
| `nacp-core/src/storage-law/` 子目录 | 新建 | 放 builder helpers + `_platform/` 常量 | 若 `_platform/` 范围扩张(owner decision),在此补新常量 |
| `nacp-core/src/transport/cross-seam.ts` | 新建(如果不与已有 transport/ 合并) | 放 anchor + headers | 未来若新增 cross-seam 元数据(如 priority / quota),在此 additive |
| 每个 re-export 文件 | 原位置保留 3 个月起 | `export * from "@nano-agent/nacp-core/..."` + `@deprecated` JSDoc | 待 worker-matrix 完成 absorb 后,原位置删除;删除不在本阶段 |

### 3.3 完全解耦点(必须独立)

- **每个吸收 category 一次独立 PR**(或一次 commit)
  - **解耦对象**:5 类吸收互相无语义耦合(evidence sink 与 hooks catalog 不交织)
  - **解耦原因**:每类 PR 独立可 review 可 revert;若某类出问题不影响其他类
  - **依赖边界**:5 类全部依赖 nacp-core 1.3.0 基座;互相无 order

- **吸收源 vs 吸收目的地之间的 namespace 完全独立**
  - 吸收后在 nacp-core 的新路径不得与 `session-do-runtime` 等原路径有 import 循环
  - 原路径只做 re-export,不反向 import nacp-core 的其他符号

### 3.4 聚合点(单一中心)

- **聚合对象**:所有 cross-worker 协议 vocabulary
- **聚合形式**:`nacp-core` 包的 `src/` 子目录结构
- **为什么不能分散**:owner 决策明确 NACP 是唯一对外发布包;任何"子包 nacp-evidence"都违反这条

**nacp-core 1.4.0 目标结构**(本 design 冻结):

```
packages/nacp-core/src/
├── envelope.ts                       (现有,含 NacpRefSchema,W0 不动)
├── errors.ts                         (现有)
├── error-registry.ts                 (现有)
├── error-body.ts                     (现有,B9 shipped)
├── type-direction-matrix.ts          (现有,B9 shipped;W1 会 additive 扩 workspace.fs.*)
├── version.ts                        (现有;W0 bump NACP_VERSION 1.3.0 → 1.4.0)
├── state-machine.ts                  (现有)
├── retry.ts                          (现有)
├── admissibility.ts                  (现有)
├── compat/                           (现有,migrate_v1_0_to_v1_1)
├── tenancy/                          (现有,B9 shipped verifyTenantBoundary + tenantDoStorage*)
├── transport/                        (现有)
│   ├── service-binding.ts            (现有)
│   ├── do-rpc.ts                     (现有)
│   ├── queue.ts                      (现有)
│   ├── types.ts                      (现有)
│   └── cross-seam.ts                 【W0 新建】— propagation 部分
├── messages/                         (现有 5 files;W1 会加 workspace.ts)
│   ├── tool.ts / hook.ts / skill.ts / context.ts / system.ts / index.ts
├── observability/                    (现有)
├── evidence/                         【W0 新建目录】(v0.2 narrower)
│   ├── sink-contract.ts              【W0 新建】— **仅** shape types (EvalSinkEmitArgs / EvalSinkOverflowDisclosure / EvalSinkStats) + extractMessageUuid helper + dedup contract doc;**不含 BoundedEvalSink class**
│   └── vocabulary.ts                 【W0 新建】— 4 kinds Zod schema(assembly / compact / artifact / snapshot)
├── hooks-catalog/                    【W0 新建目录】(v0.2 narrower)
│   └── index.ts                      【W0 新建】— HookEventName union(18 events)+ per-event payload Zod schema;**不含 HookEventMeta runtime metadata**(blocking / allowedOutcomes / redactionHints 留 hooks 包)
└── storage-law/                      【W0 新建目录】
    ├── constants.ts                  【W0 新建】— DO/KV/R2 key law + `KV_KEYS.featureFlags()` `_platform` 例外
    └── builders.ts                   【W0 新建】— buildDoStorageRef / buildR2Ref / buildKvRef 等
```

`index.ts` 顶层 re-export 所有新 subdirectory 的 public symbols,保证消费者 `import { ... } from "@nano-agent/nacp-core"` 一次到位。

---

## 4. 关键参考实现对比

### 4.1 B9 已 shipped 的 `tenancy/*` 吸收 pattern(直接 precedent)

- **实现概要**:B9 把 `tenantR2* / tenantKv* / tenantDoStorage*` helpers 从各包搬到 `nacp-core/src/tenancy/scoped-io.ts`,同步加 `verifyTenantBoundary` 到 `tenancy/boundary.ts`;`scoped-io.ts` export 给 `storage-topology` 作为消费者
- **亮点**:
  - 新建 `tenancy/` 子目录,清晰聚合
  - 原消费者(workspace-context-artifacts / session-do-runtime)直接改 import,没搞 re-export — 因为那时 tenant helpers 本来就没有"老家"
- **值得借鉴**:
  - subdirectory 聚合策略 ✓
  - Additive-only semver 纪律 ✓
- **W0 vs B9 的差异**:
  - W0 吸收的对象**有老家**(session-do-runtime / hooks / storage-topology 已 shipped 并被消费)
  - 因此 W0 必须走 **re-export** 路径,不能直接 cut;B9 那种"cut without re-export"不适用
  - 原消费者 import 路径在 W0 阶段**不**改;worker-matrix P0 absorb 时再改

### 4.2 TypeScript monorepo 中的 "barrel re-export" pattern

- **实现概要**:把一个 module 的内容搬到新位置后,旧位置文件只保留 `export * from "new-location"`(可加 `@deprecated` JSDoc)
- **亮点**:
  - consumer 代码零改动
  - 迁移可并行:每个 consumer 按自己节奏改 import;不强制同步
- **值得借鉴**:
  - W0 的 5 类吸收**全部走这条模式**
- **不照抄的地方**:
  - 通常 barrel re-export 会保留很久(几年)— W0 明确只保留到 worker-matrix P0 absorb 完成(预计 3 个月内);到时原包会随 Tier B deprecation 被物理删除

### 4.3 nano-agent 的 1.3.0 → 1.4.0 纪律(本 design 建立的 precedent)

- **实现概要**:B9 是 1.1 → 1.3(跳 1.2 因 frozen RFC 占用);W0 是 1.3 → 1.4 严格 minor additive
- **亮点**:
  - 明确区分 "Primary criteria"(语义成熟)vs "Secondary outcomes"(版本号)— 继承 B9 §11.1/§11.2 口径
- **值得借鉴**:
  - W0 的 CHANGELOG 和 exit criteria 沿用 B9 的表述(避免建立第二套纪律)
- **新增**:
  - 首次出现 "re-export as additive" 纪律条目 — W0 写入 RFC

### 4.4 横向对比速查表

| 维度 | B9 tenancy 吸收 | Barrel re-export pattern | W0(本阶段) |
|---|---|---|---|
| 原位置是否保留 | 否(直接 cut) | 是(re-export 长久) | **是(re-export,短期 3 个月)** |
| 消费者是否同步改 import | 是(一次性) | 否(按需改) | **否(worker-matrix P0 再改)** |
| semver 类型 | minor(1.1→1.3,跳 1.2) | 可 patch | **minor(1.3→1.4,无跳)** |
| subdirectory 新建 | 是(`tenancy/`) | 不限 | **是(`evidence/ hooks-catalog/ storage-law/` + `transport/cross-seam.ts`)** |
| nano-agent 倾向 | 适用于无消费者的新功能 | 适用于跨次迁移 | **当前场景:临时共存 → 长期单聚合** |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope(W0 第一版必须完成)

- **[S1] (v0.2 narrowed)** `EvalSinkEmitArgs / EvalSinkOverflowDisclosure / EvalSinkStats` shape types + `extractMessageUuid` helper + dedup contract doc 搬到 `nacp-core/src/evidence/sink-contract.ts`;**`BoundedEvalSink` class 本身不搬**,保留在 `packages/session-do-runtime/src/eval-sink.ts`,随 worker-matrix P0 agent.core absorption 进入 `workers/agent-core/`;session-do-runtime 内 eval-sink.ts re-import 上述 shape types
- **[S2]** `CrossSeamAnchor` + `CROSS_SEAM_HEADERS` + `buildCrossSeamHeaders` / `readCrossSeamHeaders` 搬到 `nacp-core/src/transport/cross-seam.ts`;`session-do-runtime/src/cross-seam.ts` 保留 failure taxonomy + startup queue,propagation 部分改为 re-export from nacp-core
- **[S3]** Evidence 4 kinds 的 Zod schema 搬到 `nacp-core/src/evidence/vocabulary.ts`;`workspace-context-artifacts/src/evidence-emitters.ts` 里的 build* emit* 函数保留,但 record shape 改为 import from nacp-core
- **[S4] (v0.2 narrowed)** `HookEventName` union(18 events)+ per-event payload Zod schema 搬到 `nacp-core/src/hooks-catalog/index.ts`;**`HookEventMeta` interface + `HOOK_EVENT_CATALOG`(blocking / allowedOutcomes / redactionHints)不搬**,保留在 `packages/hooks/src/catalog.ts`(dispatch runtime metadata);`hooks/src/catalog.ts` 从 nacp-core re-import event name + payload schema truth,自身继续维护 HookEventMeta;dispatch 逻辑保留
- **[S5]** `buildDoStorageRef / buildR2Ref / buildKvRef / DO_KEYS / KV_KEYS / R2_KEYS` 搬到 `nacp-core/src/storage-law/{builders.ts,constants.ts}`;`storage-topology/src/{keys,refs}.ts` re-export
- **[S6]** `NACP_VERSION` 从 `1.3.0` bump 到 `1.4.0`;`NACP_VERSION_COMPAT` 保持 `1.0.0`
- **[S7]** `nacp-session` 若依赖新 anchor 接口则 bump 到 1.4.0;否则保持 1.3.0
- **[S8]** CHANGELOG 1.4.0 entry;RFC `docs/rfc/nacp-core-1-4-consolidation.md`
- **[S9]** re-export path 对应的 test smoke(证明 import 路径没断)
- **[S10]** 全包 regression:`pnpm -r run test` / `node --test test/*.test.mjs` / `npm run test:cross` / B7 LIVE 契约保持 green
- **[S11]** 各 re-export 文件加 `@deprecated` JSDoc 指向 nacp-core 新位置,含"计划在 worker-matrix phase 后删除"说明
- **[S12]** W0 closure memo:`docs/issue/pre-worker-matrix/W0-closure.md`

### 5.2 Out-of-Scope(W0 不做)

- **[O1]** 语义变动(任何吸收对象的行为 / 返回 shape / 错误码变化)
- **[O2]** 新跨 worker 协议设计(那是 W1;本 design §1.3 明确指向 W1)
- **[O3]** `evidence-emitters.ts` 的 emit 函数迁移(W3 blueprint 决定;默认去 agent.core)
- **[O4]** `cross-seam.ts` 的 failure taxonomy / startup queue 迁移(留原位;随 session-do-runtime 吸收到 agent.core)
- **[O5]** `hooks` dispatch runtime 迁移(同上,随 hooks 包)
- **[O6]** storage adapters(DO/R2/KV)迁移(去 filesystem.core)
- **[O7]** 原消费者 import 路径改写(保持 re-export,worker-matrix P0 再改)
- **[O8]** 原包物理删除(本阶段 Tier B 包只 deprecated 标注,删除在 worker-matrix 末期或之后)
- **[O9]** 任何 1.3.0 → 1.4.0 breaking change
- **[O10]** 吸收对象的性能优化或重构
- **[O11]** 新增 NACP 1.4.0 的 message types(那是 W1;本阶段 1.4.0 只加 non-message symbols)
- **[O12]** 发布 1.4.0 到 GitHub Packages(那是 W2;W0 只 local ship)

### 5.3 边界清单(灰色地带)

| 项目 | 判定 | 理由 |
|---|---|---|
| `nacp-core/src/evidence/` 是否合并到现有 `observability/` | **in-scope(新建独立目录)** | observability 是 "观察现有事件" 抽象;evidence 是 "产生新 record vocabulary";语义不同 |
| `nacp-core/src/transport/cross-seam.ts` 是否新建文件 vs 合并到 `transport/types.ts` | **in-scope(新建 cross-seam.ts)** | 独立文件便于后续 W1 cross-worker protocols 引用 |
| hooks-catalog 是否应合并到 `messages/hook.ts` | **in-scope(新建 hooks-catalog/ 目录)** | `messages/hook.ts` 是 NACP message family(`hook.emit / hook.outcome`);hooks-catalog 是 session-level 事件名 + payload(Class A/B/D 共 18);不同抽象层 |
| storage-law 是否合并到现有 `tenancy/` | **in-scope(新建 storage-law/ 目录)** | `tenancy/` 是 tenant 边界 verify + scoped IO;storage-law 是 key/ref builder + `_platform/` 例外;可区分 |
| `NacpRefSchema` 是否需迁移 | **out-of-scope** | 已在 `envelope.ts`;迁移会破坏 NACP envelope 内部结构 |
| W0 期间是否允许修复吸收对象里发现的 bug | **允许 patch(但记录 CHANGELOG 为 1.4.0 含 bug-fix)** | 发现即修;不积累 tech debt;但避免顺手重构 |
| re-export 文件是否可用 `export * from` vs 逐个 `export { ... }` | **逐个更清晰** | 显式 export symbol 更利于 TypeScript language service 解析;`export *` 可能漏掉新 symbol |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1 — 走 re-export 路径,不直接 cut**
   - **选择 re-export**,不是 **让消费者一次改完 import**
   - **为什么**:
     - session-do-runtime / workspace-context-artifacts / hooks / storage-topology 是 pre-worker-matrix 阶段**还活着的 Tier B 包**;强制消费者同步改 import 会卷入 worker-matrix P0 才该做的 absorb 工作
     - re-export 让 W0 可独立 review / merge;zero break;worker-matrix P0 才按 blueprint 统一改 import
   - **接受的代价**:一段时间内 2 个 import path 共存,消费者看到的 public API 表面更复杂
   - **重评条件**:若 worker-matrix P0 延期超过 3 个月,re-export 共存时间过长,评估是否转为"强制改 import"

2. **取舍 2 — 每类吸收独立 PR,不一次性大 PR**
   - **选择 5 独立 PR**,不是 **一次 mega-PR**
   - **为什么**:
     - 每类 ~100-200 行 diff,独立 PR 可 review / revert
     - 某类出问题不阻塞其他类进度
   - **接受的代价**:W0 Phase 需跑 5 次 CI / 5 次 version bump cadence 维护
   - **折中**:5 个 PR 可 back-to-back;allow-all-green 后一次性 tag 为 `nacp-v1.4.0`(不要 1.3.1 → 1.3.2 → 1.3.3 → 1.3.4 → 1.4.0)

3. **取舍 3 — 1.4.0 是 one-shot bump,不走 1.3.1 → 1.3.2 patch trail**
   - **选择 one-shot 1.3.0 → 1.4.0**(W0 全部 PR land 后一次 tag)
   - **为什么**:
     - 5 类吸收逻辑上是一个整体("把跨 worker 契约收束");语义一致的事不该拆 5 个 minor 版本
     - W2 发布管道只需一次 publish(1.4.0);不需要 5 次
   - **接受的代价**:W0 期间 nacp-core 在 repo 里保持 "1.3.0 shipped + 1.4.0 pending" 状态一段时间
   - **重评条件**:若某 PR 显著延期,评估拆成 1.3.1(已 land 部分)+ 1.4.0(剩余)

4. **取舍 4 — 新建子目录 `evidence/ hooks-catalog/ storage-law/`,不扁平化到 `src/` 根**
   - **选择子目录**,不是 **`src/evidence-sink.ts / src/hooks-catalog.ts / ...`**
   - **为什么**:
     - 子目录清晰聚合同主题内容(sink + vocabulary + 未来 forwarding 都在 `evidence/`)
     - 与现有 `tenancy/ transport/ messages/ compat/ observability/` 目录惯例一致
     - 新目录为 W1 的 forwarding helper 预留位置;未来 additive 不乱
   - **接受的代价**:目录深度略增;import path 略长(`@nano-agent/nacp-core/evidence/sink` vs `@nano-agent/nacp-core/evidence-sink`)
   - **次要决策**:子目录内 `index.ts` 做 barrel export,外部 `import { EvalSinkEmitArgs, HookEventName } from "@nano-agent/nacp-core"` 等 shape symbols 仍可一步到位(BoundedEvalSink class 保留在 session-do-runtime,不从 nacp-core 再导出)

5. **取舍 5 — charter 口径 "hook 8 v1 events" 按代码实际 "18 events" 修正**
   - **选择按代码真相 18 events 设计**,不是 **按 charter 字面 8**
   - **为什么**:
     - charter 写作时遗漏了 B5 expansion 的 10 additional events(2026-04-20 shipped)
     - 按 charter 设计会漏 10 events,worker-matrix P0 仍需补搬;违反 "W0 一次吸收完整"
   - **接受的代价**:charter §7.1 字面需小幅修正(或 W0 closure memo 里注明发现);本 design 已修正
   - **处理**:W0 closure memo 明确记录此发现,charter §7.1 打 footnote "see W0 closure for actual scope"

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|---|---|---|---|
| re-export 写错导致 consumer build 断 | export symbol 遗漏 | pnpm -r build 红 | §5.1 S9 要求每个 re-export 文件有 smoke test 断言原 import path 可 resolve |
| 吸收过程中"顺手改了语义" | 无意重构 | 行为变更 | 每个 PR review 强制对比 shape:原位置与新位置 `git diff --no-index` 应无 logic 改动 |
| hooks catalog 18 events 内部的 metadata 粒度在新位置与原位置漂移 | 迁移时漏 field | dispatch runtime 出错 | §7.4 的 smoke test 跑 18 events metadata 完整性断言 |
| `storage-law` 吸收与 `tenancy/` 已有 helper 产生名字冲突 | symbol 重名 | import ambiguity | §5.3 边界清单已确认 tenancy 与 storage-law 是两个关注点;符号命名不同(`verifyTenantBoundary` vs `KV_KEYS.featureFlags`) |
| B7 LIVE 契约被破坏 | `BoundedEvalSink` dedup 行为偏移 | B7 test 红 | §5.1 S10 + B7 test 强制保持 green;CI 必须 full regression 才 merge |
| nacp-session 被迫同 bump | anchor 被 session 消费 | 双版本同步管理成本增加 | 核查:nacp-session 当前是否 import CrossSeamAnchor?若否,保持 1.3.0;若是,W0 同 bump 到 1.4.0 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己**:nacp-core 成为"看 cross-worker 契约只看一个地方"的单一聚合源;后续任何新 worker 上手只需读 nacp-core
- **对 nano-agent 长期演进**:
  - 第三方实现者未来只需依赖 `@nano-agent/nacp-core`;不再需要拉 `session-do-runtime` / `workspace-context-artifacts` 等 validation-only 包
  - worker-matrix P0 的 blueprint-driven absorption 真正可执行(每个 Tier B 包 absorb 后,"什么留 nacp-core,什么归 worker"已在 W0 明确)
- **对三大深耕方向的杠杆**:
  - 上下文管理:evidence vocabulary 在 nacp-core 统一,context.core 吸收后仍能与其他 worker 语义对齐
  - Skill:skill.core 未来入场时,只需引 nacp-core 即可看到所有跨 worker 契约
  - 稳定性:物理聚合降低"某 worker 用的是旧 shape,另一 worker 用的是新 shape"的漂移风险

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|---|---|---|---|
| C1 **(v0.2)** | Evidence sink **shape** 吸收(class 不搬)| 仅 `EvalSinkEmitArgs / EvalSinkOverflowDisclosure / EvalSinkStats / extractMessageUuid` + dedup contract doc → `nacp-core/src/evidence/sink-contract.ts`;**`BoundedEvalSink` class 留原位**(随 agent.core absorption 流向 workers/agent-core) | ✅ 原位置 re-export shape types 与 helper;BoundedEvalSink class 保持在 session-do-runtime;sink consumer 零 break |
| C2 | Cross-seam propagation 吸收 | CrossSeamAnchor + headers + helpers → `nacp-core/src/transport/cross-seam.ts` | ✅ propagation 部分搬走;failure taxonomy + startup queue 保留原位 |
| C3 | Evidence vocabulary 吸收 | 4 kinds(assembly/compact/artifact/snapshot)Zod schema → `nacp-core/src/evidence/vocabulary.ts` | ✅ schema 在 nacp-core;emit 函数留 workspace-context-artifacts |
| C4 **(v0.2)** | Hooks catalog **wire-shape** 吸收(metadata 不搬)| 仅 `HookEventName` union(18 events)+ per-event payload Zod schema → `nacp-core/src/hooks-catalog/index.ts`;**`HookEventMeta` 的 blocking / allowedOutcomes / redactionHints runtime metadata 留 hooks 包**(dispatch logic 需要) | ✅ event name + payload schema 在 nacp-core;HookEventMeta runtime metadata 留 hooks 包;wire consumer 零 break |
| C5 | Storage law 吸收 | buildDoStorageRef 等 helper + `_platform/` 常量 → `nacp-core/src/storage-law/` | ✅ helpers + 常量搬走;adapters 留 storage-topology |
| C6 | 版本 bump + CHANGELOG + RFC | NACP_VERSION 1.4.0 + CHANGELOG 1.4.0 entry + `docs/rfc/nacp-core-1-4-consolidation.md` | ✅ semver minor additive;RFC owner-approved |
| C7 | Regression | 全包测试 + B7 LIVE + root + cross 全绿 | ✅ 零红 |

### 7.2 详细阐述

#### C1 (v0.2): Evidence sink **shape** 吸收(class 不搬)

- **输入**:`packages/session-do-runtime/src/eval-sink.ts`(292 行)
- **输出(v0.2 narrower)**:
  - `packages/nacp-core/src/evidence/sink-contract.ts`(~80 行,**仅** shape + contract doc):
    - `EvalSinkEmitArgs` type
    - `EvalSinkOverflowDisclosure` type
    - `EvalSinkStats` type
    - `extractMessageUuid(record: unknown): string | undefined` helper
    - dedup-on-messageUuid 契约 JSDoc 文档
  - **`BoundedEvalSink` class 本身不迁** — 保留在 `packages/session-do-runtime/src/eval-sink.ts`;随 worker-matrix P0 agent-core absorption 最终进入 `workers/agent-core/`
  - `packages/session-do-runtime/src/eval-sink.ts` → 保留 BoundedEvalSink class + re-export shape types/helper from nacp-core(原 import 继续工作)
- **主要调用者(不变)**:`NanoSessionDO` 构造函数 — 继续 import `BoundedEvalSink` from session-do-runtime(无需改)
- **核心操作(v0.2)**:
  1. 从 `session-do-runtime/src/eval-sink.ts` 提取 4 个 shape types + `extractMessageUuid` 到 `nacp-core/src/evidence/sink-contract.ts`
  2. session-do-runtime 内 `eval-sink.ts` 从 nacp-core re-import 这些 shape types(而不是自定义);`BoundedEvalSink` class 保留
  3. 消费者 import 路径完全不变(因 class 未搬)
  4. test:nacp-core 加 shape contract test(e.g. extractMessageUuid);session-do-runtime 原 BoundedEvalSink 测试保持
- **边界情况**:
  - nacp-core 不得 import session-do-runtime(避免循环);shape 移到 nacp-core 后,session-do-runtime 反向 import nacp-core shape,符合 layer dependency 方向
- **一句话收口目标**:✅ **Shape types 可从 `@nano-agent/nacp-core/evidence/sink-contract` import;BoundedEvalSink class 保留在 session-do-runtime 不动;所有 tests 保持 green**

#### C2: Cross-seam propagation 吸收

- **输入**:`packages/session-do-runtime/src/cross-seam.ts` 的**前约 120 行**(propagation 部分:anchor interface + headers + helpers)
- **输出**:
  - `packages/nacp-core/src/transport/cross-seam.ts`(~120 行)
  - 原文件 `session-do-runtime/src/cross-seam.ts` 头部改为 `export { CrossSeamAnchor, CROSS_SEAM_HEADERS, buildCrossSeamHeaders, readCrossSeamHeaders } from "@nano-agent/nacp-core"`;保留后续 165 行(failure taxonomy + startup queue)作为 agent.core-specific content
- **主要调用者**:`NanoSessionDO` 构造 + `remote-bindings.ts` service binding transport
- **边界情况**:
  - propagation 与 failure taxonomy 之间**没有相互 import**(已核查)— 吸收安全
  - lowercase header const(`x-nacp-trace-uuid` 等)保持字面不变 — B7 binding-F02 契约依赖
- **一句话收口目标**:✅ **anchor / headers / helpers 在 nacp-core 可独立引用;B7 LIVE 契约 5 tests green**

#### C3: Evidence vocabulary 吸收

- **输入**:`packages/workspace-context-artifacts/src/evidence-emitters.ts` 的**schema 部分**(4 kinds 的 record shape;约 80 行 — 从 build* 函数的返回类型反推)
- **输出**:
  - `packages/nacp-core/src/evidence/vocabulary.ts` 新建(~120 行,含 4 kinds 的 Zod schema + TS type + discriminated union)
  - `workspace-context-artifacts/src/evidence-emitters.ts` 的 build* 函数改为 return 符合新 schema 的 object(或 import schema 的 TS type)
- **Zod schema 草案**(4 kinds):

  ```ts
  // nacp-core/src/evidence/vocabulary.ts

  export const EvidenceAnchorSchema = z.object({
    traceUuid: z.string().uuid(),
    sessionUuid: z.string().uuid(),
    teamUuid: z.string().min(1).max(64),
    sourceRole: z.string().min(1).max(32),
    sourceKey: z.string().min(1).max(128).optional(),
    turnUuid: z.string().optional(),
    timestamp: z.string().datetime({ offset: true }),
  });

  export const AssemblyEvidenceRecordSchema = z.object({
    kind: z.literal("assembly"),
    anchor: EvidenceAnchorSchema,
    assembledKinds: z.array(z.string()),
    droppedOptionalKinds: z.array(z.string()),
    orderApplied: z.array(z.string()),
    totalTokens: z.number().int().min(0),
    truncated: z.boolean(),
    requiredLayerBudgetViolation: z.boolean().optional(),
    preparedArtifactsUsed: z.number().int().min(0).optional(),
    dropReason: z.string().optional(),
  });

  export const CompactEvidenceRecordSchema = z.object({
    kind: z.literal("compact"),
    anchor: EvidenceAnchorSchema,
    tokensBefore: z.number().int().min(0),
    tokensAfter: z.number().int().min(0),
    summaryRefKey: z.string().optional(),
    status: z.enum(["ok", "error"]),
    errorCode: z.string().optional(),
  });

  export const ArtifactEvidenceRecordSchema = z.object({
    kind: z.literal("artifact"),
    anchor: EvidenceAnchorSchema,
    refKey: z.string(),
    bytes: z.number().int().min(0),
    promotedTo: z.enum(["inline", "do-storage", "r2"]),
    reason: z.string().optional(),
  });

  export const SnapshotEvidenceRecordSchema = z.object({
    kind: z.literal("snapshot"),
    anchor: EvidenceAnchorSchema,
    operation: z.enum(["capture", "restore"]),
    mountCount: z.number().int().min(0),
    fileCount: z.number().int().min(0),
    artifactCount: z.number().int().min(0),
    contextLayerCount: z.number().int().min(0),
  });

  export const EvidenceRecordSchema = z.discriminatedUnion("kind", [
    AssemblyEvidenceRecordSchema,
    CompactEvidenceRecordSchema,
    ArtifactEvidenceRecordSchema,
    SnapshotEvidenceRecordSchema,
  ]);
  ```

- **边界情况**:
  - W1 的 `wrapEvidenceAsAudit()` helper 依赖此 schema;本 design 的 schema 草案必须提前对齐 W1 F7 的使用
  - workspace-context-artifacts 当前 build* 函数 return `unknown` — 吸收后 return `EvidenceRecord` 类型 精化 API
- **一句话收口目标**:✅ **4 kinds schema 在 nacp-core 可 import;workspace-context-artifacts 消费后 TypeScript 类型推断收紧(从 unknown → EvidenceRecord)**

#### C4 (v0.2): Hooks catalog **wire-shape** 吸收(runtime metadata 不搬)

- **输入**:`packages/hooks/src/catalog.ts`(285 行,含 18 events)
- **输出(v0.2 narrower)**:
  - `packages/nacp-core/src/hooks-catalog/index.ts` 新建(~100-150 行),**仅含**:
    - `HookEventName` string-literal-union(18 values)
    - 每个 event 的 payload **Zod schema**(wire-level shape)
    - `HOOK_EVENT_PAYLOAD_SCHEMAS` record 映射 event name → Zod schema
  - **`HookEventMeta` interface 与其 `HOOK_EVENT_CATALOG` metadata(`blocking / allowedOutcomes / redactionHints`)不搬**;继续留在 `packages/hooks/src/catalog.ts`(它们是 dispatch runtime 语义,不是 wire protocol)
  - `hooks/src/catalog.ts` 改为:从 nacp-core re-import `HookEventName` + payload schema truth;**保留** `HookEventMeta` interface + `HOOK_EVENT_CATALOG` metadata 在原位
- **charter 对齐修正**:charter §7.1 原称 "8 个 v1 event" — 实际 B5 shipped 18 events(Class A 8 + Class B 4 + Class D 6);W0 按 18 个 **wire-shape** 吸收
- **核心操作**:
  - 从 `hooks/src/catalog.ts` 提取 HookEventName union + payload Zod schemas → nacp-core
  - HookEventMeta interface + `blocking / allowedOutcomes / redactionHints` 字段保留在 hooks 包
  - hooks 包 dispatch runtime(emit / outcome reducer / session mapper)import `HookEventName` from nacp-core,但 dispatch 用自己的 HookEventMeta
- **边界情况**:
  - 若某 consumer(如 session-do-runtime)直接 import HookEventMeta,它们继续 import from hooks 包(不变)
  - nacp-core 不得依赖 hooks 包(避免循环);hooks 包已依赖 nacp-core for envelope,这个方向合理
- **一句话收口目标**:✅ **HookEventName union + 18 payload schemas 在 nacp-core 可 import;`HookEventMeta` runtime metadata 留原位;hooks 包 dispatch runtime 零功能改动**

#### C5: Storage law 吸收

- **输入**:`packages/storage-topology/src/keys.ts`(85)+ `refs.ts`(166)
- **输出**:
  - `packages/nacp-core/src/storage-law/constants.ts` 新建(`DO_KEYS / KV_KEYS / R2_KEYS` + `KV_KEYS.featureFlags()` 例外等)
  - `packages/nacp-core/src/storage-law/builders.ts` 新建(`buildDoStorageRef / buildR2Ref / buildKvRef / validateRefKey` 等 helpers)
  - `storage-topology/src/{keys,refs}.ts` 各自改为 re-export
- **边界情况**:
  - `NacpRefSchema` 不迁(已在 `envelope.ts`);storage-law 的 builder 返回值是 `NacpRef` 类型(从 envelope.ts import)
  - storage adapters(DO / R2 / KV)保留 `storage-topology/src/adapters/`;W0 不动这部分
- **一句话收口目标**:✅ **builders + key law 在 nacp-core;adapters 仍在 storage-topology;所有 ref 仍过 NacpRefSchema**

#### C6: 版本 bump + CHANGELOG + RFC

- **nacp-core CHANGELOG 1.4.0 entry 草案**:
  ```
  ## 1.4.0 — 2026-04-XX (pre-worker-matrix W0 — Cross-Worker Contract Consolidation)
  
  Per `docs/rfc/nacp-core-1-4-consolidation.md`. Zero breaking change. Additive minor bump:
  all 5 absorbed categories preserve byte-identical wire shape and consumer API. Original
  positions retain re-export wrappers with `@deprecated` JSDoc; those wrappers will be
  removed during the subsequent worker-matrix absorption phase.
  
  ### Added (v0.2 narrowed)
  - `evidence/sink-contract.ts` — EvalSinkEmitArgs / EvalSinkOverflowDisclosure / EvalSinkStats shape types + extractMessageUuid helper + dedup contract doc (absorbed from @nano-agent/session-do-runtime). **BoundedEvalSink class itself NOT migrated** — remains in @nano-agent/session-do-runtime; will move to workers/agent-core/ during worker-matrix P0.
  - `evidence/vocabulary.ts` — 4 evidence record kinds (assembly/compact/artifact/snapshot) as discriminated union Zod schema
  - `transport/cross-seam.ts` — CrossSeamAnchor + CROSS_SEAM_HEADERS + buildCrossSeamHeaders/readCrossSeamHeaders (propagation only; absorbed from @nano-agent/session-do-runtime)
  - `hooks-catalog/index.ts` — HookEventName union (18 values) + per-event payload Zod schema (absorbed from @nano-agent/hooks). **HookEventMeta interface + HOOK_EVENT_CATALOG metadata (blocking/allowedOutcomes/redactionHints) NOT migrated** — remain in @nano-agent/hooks (dispatch runtime metadata).
  - `storage-law/` — buildDoStorageRef/buildR2Ref/buildKvRef/validateRefKey helpers + `DO_KEYS / KV_KEYS / R2_KEYS` constants + `KV_KEYS.featureFlags()` exception
  - `NACP_VERSION` bumped `1.3.0 → 1.4.0`
  
  ### Not changed (explicit non-breaking guarantees)
  - All 1.3.0 exports preserved byte-identical
  - `NacpRefSchema` remains in `envelope.ts` (not migrated; storage-law builders reference it)
  - `validateEnvelope()` 6-layer contract unchanged
  - `NACP_CORE_TYPE_DIRECTION_MATRIX` unchanged (W1 will add `workspace.fs.*` entries separately)
  ```
- **nacp-session CHANGELOG**:条件性 — 若 cross-seam anchor 被 nacp-session 消费(需核查),同 bump 1.4.0;否则保持 1.3.0 并在 CHANGELOG 记录"no delta for W0"
- **RFC `docs/rfc/nacp-core-1-4-consolidation.md`** 结构:
  1. 背景 / pre-worker-matrix W0 触发
  2. 5 类吸收对象 + 物理迁移表
  3. re-export 纪律 + 3-month window
  4. Additive non-breaking 证明
  5. 与 B9 1.3.0 的兼容矩阵
  6. W1 依赖本 RFC 的点(evidence vocabulary / storage-law 后续消费)

#### C7: Regression

- **测试矩阵**:
  - `pnpm --filter @nano-agent/nacp-core test` — 247+ 保持 + 新增 C1-C5 的 unit test smoke
  - `pnpm -r run test` — 11 包全绿
  - `node --test test/*.test.mjs` — 98+ 保持(W0 不改 root tests,但 re-export smoke 可能新增 1-2 条)
  - `npm run test:cross` — 112+ 保持
  - `test/b7-round2-integrated-contract.test.mjs` — 5/5 保持(BoundedEvalSink 契约是 B7 关键依赖;类本身留在 session-do-runtime,B7 契约 shape 在 nacp-core/evidence/sink-contract.ts 可 re-import)
- **一句话收口目标**:✅ **全绿,零红,B7 LIVE 契约守住**

### 7.3 非功能性要求

- **性能**:吸收前后 runtime 无 measurable 差异(吸收是 structure 重排,不是算法改动)
- **可观测性**:吸收后 nacp-core 的 public API surface 扩大,CHANGELOG 清晰列出所有新 export
- **稳定性**:re-export 保护;additive-only;B7 LIVE 契约守住
- **测试覆盖**:新 nacp-core 子目录(evidence/ hooks-catalog/ storage-law/ transport/cross-seam.ts)每处至少一个 smoke + 一个 contract test

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nano-agent 自己(B9 tenancy 吸收 pattern)

| 文件:行 | 内容 | 借鉴点 |
|---|---|---|
| `packages/nacp-core/src/tenancy/` 整个目录 | B9 shipped 的 tenancy 吸收 | 子目录结构 + Zod schema 组织惯例 |
| `packages/nacp-core/CHANGELOG.md` 1.3.0 entry | B9 CHANGELOG 格式 | 用作 C6 的 1.4.0 entry 模板 |
| `docs/rfc/nacp-core-1-3-draft.md` | B9 RFC 结构 | 用作 C6 RFC 的模板 |

### 8.2 来自 Tier B 包(吸收源)

| 文件:行 | 内容 | 借鉴点 |
|---|---|---|
| `packages/session-do-runtime/src/eval-sink.ts:40-77` | BoundedEvalSink types | 直接复制 **shape types(EvalSinkEmitArgs / Overflow / Stats)+ extractMessageUuid helper** 到 nacp-core/evidence/sink-contract.ts;**class 本身不搬** |
| `packages/session-do-runtime/src/cross-seam.ts:30-80` | CrossSeamAnchor + headers | 直接复制前 80 行到 nacp-core/transport/cross-seam.ts |
| `packages/workspace-context-artifacts/src/evidence-emitters.ts:24-75` | evidence anchor + 4 kinds build 函数 | 从 build 函数反推 Zod schema |
| `packages/hooks/src/catalog.ts:38-66` | HookEventName 18 values | 直接 copy 到 nacp-core/hooks-catalog/index.ts |
| `packages/storage-topology/src/keys.ts:38-64` | `_platform/` exception + KV_KEYS | 直接 copy 到 nacp-core/storage-law/constants.ts |
| `packages/storage-topology/src/refs.ts:31-166` | buildDoStorageRef 等 | 直接 copy 到 nacp-core/storage-law/builders.ts |

### 8.3 来自 TypeScript monorepo 社区的 re-export 惯例

- `@deprecated` JSDoc 标签惯例(VS Code / tsserver 显示 strike-through,guide 消费者迁移)
- `export { ... } from "..."` vs `export * from "..."` — 逐个 export 更利于 tree-shaking + tsserver hover

### 8.4 需要避开的反例

| 位置 | 问题 | 我们为什么避开 |
|---|---|---|
| 把 `evidence-emitters.ts` emit 函数一并搬 | 吸收 logic 层 | §3.1 砍;emit 归 agent.core(owner 答案 3) |
| 把 `hooks/src/catalog.ts` dispatch 也搬 | 吸收 runtime | §3.1 砍;dispatch 归 hooks 包(将来进 agent.core) |
| 在 nacp-core 新建 `nacp-storage-law` 子包 | 子包化 | owner 决策:NACP 只 2 包对外;子目录足够 |
| 修复吸收对象里已知 bug 顺手改 | scope creep | §5.3 说明:发现 bug 可在 1.4.0 patch 层面修,但不做重构 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

W0 是 **"纯整合型 phase"**:

- **存在形式**:`nacp-core 1.4.0` additive minor bump;新增 3 个子目录 + 1 个 transport 子文件 + 对应 CHANGELOG/RFC
- **覆盖范围**:5 类 cross-worker 协议 vocabulary(evidence / cross-seam / hooks-catalog / storage-law)
- **耦合形态**:nacp-core 扩容;4 个 Tier B 包通过 re-export 保持消费者零破坏
- **预期代码量级**:
  - nacp-core 新增 ~700-800 行(5 类吸收 + index re-export)
  - 4 个 Tier B 包 re-export wrapper ~60-80 行(每包 ~15-20 行)
  - RFC ~400-600 行
  - CHANGELOG ~80 行
- **预期复杂度**:低 — 机械性搬迁 + 保守 re-export;无 semantics 改动

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|---|---|---|
| 对 nano-agent 核心定位的贴合度 | **5** | 把"packages 是吸收上下文"决策物理兑现的第一步 |
| 第一版实现的性价比 | **5** | 机械搬迁 + re-export;工程量相对收益极高 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | **5** | 后续所有 worker 看跨 worker 契约只看一个地方 |
| 对开发者自己的日用友好度 | **3** | 开发者要习惯 "先搬到 nacp-core,再从 worker 消费" 的新 pattern |
| 风险可控程度 | **5** | re-export + additive + B7 LIVE 守护三重保护 |
| **综合价值** | **4.6** | 标准 "不性感但 load-bearing" 基础设施;但这一版风险极低 |

### 9.3 下一步行动

- [ ] **决策确认**(W0 动代码前,owner 需 approve):
  - §6.1 取舍 1(re-export vs cut)是否接受?
  - §6.1 取舍 5(按代码实际 18 events 而非 charter 字面 8)是否接受?
  - §3.4 nacp-core 1.4.0 目录结构(新增 `evidence/` `hooks-catalog/` `storage-law/` + `transport/cross-seam.ts`)是否接受?
  - §7.2 C3 Evidence vocabulary 的 Zod schema 草案是否接受?(与 W1 F7 的 `wrapEvidenceAsAudit` 对齐)
  - §7.2 C2 关于 cross-seam 只吸收 propagation,保留 failure taxonomy + startup queue 是否接受?
- [ ] **关联 RFC 撰写**(本 design approve 后启动):
  - `docs/rfc/nacp-core-1-4-consolidation.md`
- [ ] **关联 action-plan**:`docs/action-plan/pre-worker-matrix/D1-nacp-consolidation.md`(5 类吸收的批次化执行)
- [ ] **依赖下游文档**:
  - `W1-cross-worker-protocols.md` §7.2 F7(evidence schema 必须与本 design §7.2 C3 的 Zod 形状 byte-identical)
  - `W3-absorption-blueprint-*.md`(各 Tier B 包吸收时,re-export wrappers 的删除时机)
- [ ] **待深入调查的子问题**:
  - `nacp-session` 是否直接 import `CrossSeamAnchor`?(决定 nacp-session 是否同 bump 1.4.0)
  - `evidence-emitters.ts` 的 emit 函数当前是否有 consumer 直接调用?(决定它们在 W3 里的搬迁紧迫度)

---

## 附录

### A. 讨论记录摘要

- **分歧 1**:charter 说 "hook 8 events",代码实际 18
  - **Opus 倾向**:按代码实际 18
  - **理由**:charter 写作时遗漏 B5 expansion;按字面 8 会漏搬 10 events
  - **当前共识**:本 design §6.1 取舍 5 + §7.2 C4 明确按 18 events 吸收
- **分歧 2**:`cross-seam.ts` 整体搬 vs 只搬 propagation
  - **Opus 倾向**:只搬 propagation
  - **理由**:failure taxonomy 与 startup queue 是 agent.core runtime 细节,非 wire protocol
  - **当前共识**:本 design §7.2 C2 只搬前约 120 行
- **分歧 3**:`storage-topology/refs.ts` 是否与现有 `nacp-core/envelope.ts::NacpRefSchema` 有重合
  - **核查结果**:是;`refs.ts` 的 builder 函数**基于** NacpRefSchema 构建;NacpRefSchema 本身**不需**吸收(已在 NACP)
  - **当前共识**:本 design §7.2 C5 只吸收 builder + 常量

### B. 开放问题清单

- [ ] **Q1**:`nacp-session` 代码是否 import `CrossSeamAnchor`?若是,同 bump 1.4.0;若否,保持 1.3.0
- [ ] **Q2**:re-export wrapper 的 `@deprecated` JSDoc 指向文本(建议:"`Moved to @nano-agent/nacp-core as part of 1.4.0 consolidation. Will be removed in worker-matrix phase.`")
- [ ] **Q3**:C3 Evidence vocabulary Zod schema 是否需要 `trace_uuid` 字段作为顶层(本 design 放在 `anchor.traceUuid`);与 audit.record wrapping 对齐时是否需要顶层 trace
- [ ] **Q4**:W0 所有 PR 是否应该 back-to-back merge(同一 day),还是可以 day-by-day(每个 C1-C5 一个 day)?
- [ ] **Q5**:CHANGELOG 里提及的 "re-export wrappers 会在 worker-matrix 阶段移除" 的"阶段"是指 worker-matrix P0,还是 worker-matrix 整个阶段?(建议:P0 absorb 时物理移除)

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|---|---|---|---|
| v0.1 | 2026-04-21 | Claude Opus 4.7 | 初稿:5 类吸收的详细设计 + 3 处 charter 修正 + 4 kinds evidence Zod schema 草案 |
| v0.2 | 2026-04-21 | Claude Opus 4.7 | Post-GPT-review narrowing(GPT review 盲点 3 整改):<br/>• §0.4 新增第 4 条 charter 修正:`BoundedEvalSink` class 不搬 NACP,只搬 shape types + `extractMessageUuid` helper + dedup contract 文档;class 留在 `session-do-runtime`<br/>• §1.3 Tier A 映射表第 1 行拆分(class vs shape)<br/>• §1.3 第 4 行拆分:hooks event name + payload schema 进 NACP;HookEventMeta runtime metadata(blocking/allowedOutcomes/redactionHints)留 hooks 包<br/>• §4.1 W0 In-Scope 对应条目 1, 4 更新<br/>• §7.2 C1 详述:去掉 BoundedEvalSink class 迁移步骤;保留 shape + helper 迁移<br/>• §7.2 C4 详述:同上,区分 wire-shape(迁)vs runtime metadata(不迁)<br/>• §7.2 C6 CHANGELOG entry 草案 "Added" 节更新反映新的吸收边界<br/>**净效果**:nacp-core 1.4.0 代码量减少 ~30%(从 ~700 行降到 ~500 行);Tier B 包的 runtime class 保留更多,与 worker-matrix P0 absorption 更自然对接 |

### D. 修订综述

**v0.2 总体方向**:对 NACP 协议边界做收窄 — 区分 "跨 worker 共享的 wire-level shape / adjacent helper"(属 NACP 合理家) vs "runtime class / dispatch semantics"(属 Tier B 包,随 worker absorption 流向 workers/)。避免 `nacp-core` 成为"承载所有跨 worker 公共语义"的大核心包。

**本 design 配合 v0.2 charter 的 scope 整体收窄**:
- charter r2 §0.5 long-term vs first-wave 分层原则 → W0 只做 first-wave 真正需要的 wire shape 吸收
- charter r2 §4.1 A narrower → W0 §4.1/§7.2 narrower 版对应
- charter r2 §11 exit criteria 6 条(从 11 条)→ W0 不再是"吸收完成"的硬 exit,而是 "wire-level vocabulary 已归位 + 1.4.0 shipped" 的更窄目标
