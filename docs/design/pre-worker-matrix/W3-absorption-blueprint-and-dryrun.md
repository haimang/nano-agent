# W3 — Absorption Blueprint Methodology & `llm-wrapper` Dry-Run

> 功能簇:`pre-worker-matrix / W3 / absorption-blueprint-methodology`
> 讨论日期:`2026-04-21`
> 讨论者:`Claude Opus 4.7 (1M context)` + owner pending review
> 关联文档:
> - Charter: `docs/plan-pre-worker-matrix.md` §4.1 D / §7.4
> - Tier 映射:`docs/plan-pre-worker-matrix.md` §1.3
> - 前置 design:`W0-nacp-consolidation.md`(Tier A 吸收 shape)
> - 并行 design:`W1-cross-worker-protocols.md`(跨 worker 协议)、`W2-publishing-pipeline.md`(NACP 发布)
> - 后继 design:`W4-workers-scaffolding.md`(消费 W3 的 llm-wrapper dry-run 结果)
> 文档状态:`draft`

---

## 0. 背景与前置约束

### 0.1 为什么 W3 必须作为独立 phase

owner 在"packages 定位"讨论中明确:`nacp-core` / `nacp-session` 之外**所有** Tier B packages 是"验证 + 吸收上下文",随 worker 成熟而 phase out。这条决策的**物理兑现**分两步:

1. **W3(本阶段):为每个 Tier B package 写 blueprint**(files → destination 映射 + 循环引用解决 + test 迁移 + deprecated 时机 + LOC 估算)+ **对最简包 `llm-wrapper` 做真实 dry-run** 作为 pattern 样本
2. **worker-matrix P0(后续阶段):按 blueprint 执行实际 absorption**(把 Tier B packages 物理搬进 `workers/<name>/`)

把设计与执行严格拆开,有 3 个结构性好处:

- **单 phase 单焦点纪律**:W3 只产 blueprint + 1 dry-run,不实际做 N 个 worker 的 absorption;worker-matrix P0 只按 blueprint 执行
- **可预估**:10 份 blueprint 给出 LOC + 时长估算,worker-matrix P0 的 scope 可被精确预算
- **可并行**:worker-matrix P0 的 4 个 worker 各自 absorb 可并行推进(因为 blueprint 无互依)

### 0.2 为什么 dry-run 也在 W3 做

owner 与 Opus 一致选择:**blueprint 先行 + 1 包 dry-run 作为 pattern 样本**。理由:

- 纯文档 blueprint 不验证"搬迁真的可执行";dry-run 是**最小可验证样本**
- 1 包 dry-run 产出的 pattern 可 back-write 到其他 9 份 blueprint,提高质量一致性
- `llm-wrapper` 是最简包(见 §6.1 取舍 2),dry-run 风险最低

### 0.3 前置共识(不再辩论)

- **10 个 Tier B 包的目的地固定**(charter §1.3 Tier B 映射表)
- **Dry-run 目标 = `llm-wrapper`**(charter §7.4 第 34-39 条;见 §6.1 取舍 2 具体理由)
- **Blueprint 不预设实际搬迁时机**:blueprint 描述"怎么搬",不规定"何时搬"(后者是 worker-matrix P0 的工作)
- **共存模式默认**:W3 所有 blueprint 都基于"Tier B 包与 workers/\* 代码并存 3 个月"假设
- **deprecated 标注时机**:blueprint 指定在"worker-matrix P0 该 worker absorb 完成"时,原包发 patch bump 加 README deprecated 贴纸;不在 W3 期间提前 deprecated
- **llm-wrapper dry-run 保留**:dry-run 的 `workers/agent-core/src/llm/` 目录**不删**,作为 worker-matrix P0 的真实产出 seed
- **llm-wrapper 原包保留**:dry-run 后 `packages/llm-wrapper/` **不删**,在 worker-matrix 末期统一删

### 0.4 显式排除

- 不实际搬迁其他 9 个 Tier B 包(那是 worker-matrix P0)
- 不删除任何现有 Tier B 包的代码(连 llm-wrapper 都保留)
- 不修改现有 Tier B 包的 public API(除 dry-run 目标的 `packages/llm-wrapper/README.md` 加 deprecated 贴纸)
- 不为 Tier B 包发布到 GitHub Packages(W2 已明确只发 NACP 2 包)
- 不写 "auto-migration script"(blueprint 是人工可读 + 可执行的 PR shopping list,不是脚本)
- 不承诺 worker-matrix P0 的具体 phase 分法(那是 worker-matrix charter r2 的事)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`Absorption Blueprint Methodology & llm-wrapper Dry-Run`
- **一句话定义**:为 10 个 Tier B package 产出一致 shape 的 absorption blueprint(per-file → per-destination 映射 + 测试迁移 + deprecated 时机 + LOC 与时长估算),并对 `llm-wrapper` 做一次**真实** dry-run absorption 作为其他 9 份 blueprint 的 pattern 样本
- **边界描述**:
  - **包含**:blueprint 模板定义、10 份 blueprint 的撰写规范、llm-wrapper 真实 dry-run 执行、pattern spec 文档、deprecated 标注纪律
  - **不包含**:其他 9 个包的实际 absorb、worker-matrix P0 的具体 phase 拆分、blueprint 里提到的 workers/ 目录实际创建(那是 W4)

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|---|---|---|
| blueprint | 针对一个 Tier B package 的搬迁蓝图,含映射表 + 循环解决 + 测试迁移 + deprecated 时机 + LOC + 时长 | W3 的主交付物 |
| absorption | 把 Tier B package 的代码物理搬进 `workers/<name>/` 并删除原位置(worker-matrix P0 执行) | 词义与 W0 的 consolidation 区别:consolidation = Tier B → nacp-core;absorption = Tier B → workers/\* |
| dry-run | 对 1 个包做真实 absorption(代码搬 + 测试迁 + 构建绿),但保留原包并行存在,不删 | llm-wrapper 在 W3 dry-run |
| pattern | dry-run 过程中发现的可复用步骤、坑位、工具链决定,写成独立 spec doc | 给其他 9 份 blueprint 使用 |
| deprecated 贴纸 | Tier B 包的 README.md 顶部加 `⚠️ DEPRECATED` banner + 迁移指引 | 在 worker-matrix P0 该 worker absorb 完成后统一加 |
| 共存期 | Tier B 包与 workers/\* 代码并行存在的时间窗口(~3 个月) | W3 blueprint 默认假设 |
| LOC 估算 | 预估 absorption 期间 diff 总行数(新增 + 修改 + 删除) | 每份 blueprint 必填 |
| Strangler Fig | 软件迁移 pattern:新代码在旁逐步替换旧代码,旧代码保留一段时间后删 | W3 整体遵循此 pattern |

### 1.3 参考上下文

- Charter `docs/plan-pre-worker-matrix.md` §1.3 Tier B 映射表(10 包 → workers 目的地)
- Charter §7.4 `In-Scope` 条目 32-39(blueprint 6 字段 + dry-run 5 条)
- Charter §14.1 文档清单:`W3-absorption-blueprint-<package>.md` × 10 + `W3-absorption-pattern.md`
- B9 `tenancy/*` 吸收 precedent(`docs/issue/after-foundations/B9-final-closure.md`)— 最接近的 "跨 package 搬迁" 历史成功案例
- 当前 `packages/llm-wrapper/` 代码事实核查(见 §6.1 取舍 2)

### 1.4 Dry-run 目标代码事实核查

| 维度 | llm-wrapper 数据 | 为什么适合 dry-run |
|---|---|---|
| source 文件数 | 12 个 (`.ts`) | 中等规模,不过小也不过大 |
| source 总行数 | ~1090 行 | 单人 1-2 天可消化 |
| test 文件数 | 7 个 | 映射清晰 |
| test 总行数 | ~1424 行(103 个 unit test) | 测试覆盖充分 |
| 包依赖 | **零** runtime dep(仅 peer `zod`) | **无循环引用风险** — 这是最大优势 |
| 消费者数 | 1(`session-do-runtime`,未来 `workers/agent-core`) | 单 consumer = 单 absorption 终点 |
| 与 NACP 关系 | 完全独立(不 import nacp-core/session) | absorption 不依赖 W0/W1 已 ship |
| platform-specific seam | 无(纯 LLM client logic) | 不涉及 DO / KV / R2 platform 行为 |

**结论**:llm-wrapper 是 Tier B 10 包中**结构最简单、耦合最低、最适合首个 dry-run** 的候选。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **整体架构里的角色**:设计层的**最后一块前置工作**;让 worker-matrix P0 从"需要边设计边搬"退化为"按 blueprint 执行"
- **服务于**:worker-matrix 阶段的 absorption sub-phases(P0.A agent.core / P0.B bash.core / P0.C context.core / P0.D filesystem.core 各自的 blueprint 执行)
- **依赖**:
  - W0 完成(Tier A 吸收后 nacp-core 的 final shape)
  - W1 完成(新协议定义,blueprint 内对应 import 路径可确定)
  - W4 开始(blueprint 里的"目的地"即 `workers/<name>/src/...`,需要该目录存在)
- **被谁依赖**:worker-matrix P0 所有 absorption sub-phase(blueprint 是直接消费对象)

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| W0 已 ship 的 nacp-core 1.4.0 | W3 blueprint 引用 | 强 | blueprint 里 import path 从 Tier B 内部 symbol 改为 `@nano-agent/nacp-core` |
| W1 新协议(`workspace.fs.*` 等) | W3 blueprint 引用 | 中 | 某些 blueprint 涉及 worker-matrix P0 执行时需消费 W1 新协议 |
| W2 publishing pipeline | W3 blueprint 假设可用 | 强 | blueprint 假设 nacp-core 可从 GitHub Packages install |
| W4 workers/ 目录 | W3 blueprint 描述目的地 | 强 | blueprint 指向 `workers/<name>/src/...`,该目录由 W4 建立 |
| worker-matrix P0 | W3 被消费 | 强 | P0 按 blueprint 执行 10 包 absorption |
| `packages/llm-wrapper/` | W3 dry-run 目标 | 强 | W3 唯一"动代码"的对象 |
| 其他 9 个 Tier B 包 | W3 只写 blueprint 不动代码 | 弱 | 不动它们直到 worker-matrix P0 |
| `docs/action-plan/` | W3 blueprint 会成为 action-plan 前置 | 中 | worker-matrix charter r2 的 action-plan 会引用 W3 blueprint |

### 2.3 一句话定位陈述

> 在 nano-agent 里,`Absorption Blueprint Methodology & llm-wrapper Dry-Run` 是 **设计层桥梁**,负责 **为 10 个 Tier B package 产出一致 shape 的 absorption blueprint + 用 llm-wrapper dry-run 验证 blueprint 可执行性**,对上游(pre-worker-matrix)提供 **"packages 被 worker 吸收"这条 trajectory 的可操作 shopping list**,对下游(worker-matrix P0)要求 **按 blueprint 执行,不临时设计**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点(哪里可以砍)

| 被砍项 | 来源 / 对标 | 砍的理由 | 未来是否回补 |
|---|---|---|---|
| 自动 migration script | 大规模 monorepo migration | 10 个包每个都有自己的循环引用 / 测试特殊处;脚本化成本大于收益 | 否(人工 PR 更准) |
| Blueprint 精确到 SHA / commit 级别 | 严格 audit 项目 | 过于精确;blueprint 是"当前代码事实的快照",SHA 当天即过时 | 否 |
| 同时 dry-run 多个包 | 并行推进 | 每个包有自己的 pattern 发现;并行会稀释 lessons | 否 |
| Blueprint 内给出完整重构后的代码 | "blueprint = code" | blueprint 是 shopping list 不是 PR diff;实装在 worker-matrix P0 | 否 |
| 额外 9 个 dry-run | 每包都验证 | 1 个 dry-run 已足以验证 pattern 可复用 | 若 worker-matrix P0 执行首个非 llm-wrapper blueprint 时出大问题,再评估 |
| Blueprint 决定 "谁在 worker-matrix P0 执行" | 任务分配 | W3 只写 what,不写 who;who 是 worker-matrix charter r2 的事 | 否 |
| Blueprint 预测 runtime behavior 差异 | 过度 future 分析 | blueprint 基于"byte-identical semantics"假设 | 若某包发现 absorb 后行为变化,属 bug 单修 |
| Dry-run 完成后立即删原包 | 快速清理 | W3 只 dry-run,不 destroy;原包保留到 worker-matrix 末期 | 否(共存纪律) |

### 3.2 接口保留点(必须留扩展空间)

| 扩展点 | 表现形式 | 第一版行为 | 未来演进 |
|---|---|---|---|
| Blueprint 模板(`TEMPLATE-absorption-blueprint.md`) | Markdown 模板 | 8 节结构(见 §7.2 T1) | 若 worker-matrix P0 反馈某节冗余 / 某节缺失,修模板并回写 10 份 blueprint |
| 循环引用解决方案库 | pattern doc §N | 目前列 3 种(dependency-inversion / interface-extraction / relocation) | 新 pattern 出现时 additive 加入 |
| LOC 估算方法 | blueprint "LOC 估算" 字段 | 手工 `wc -l` + 人类判断 | 若不准确率高,引入更严格 metric |
| 时长估算方法 | blueprint "时长估算" 字段 | 基于 llm-wrapper dry-run 推导 per-LOC 系数 | 若经验数据累积,用回归方法 |
| Deprecated 贴纸模板 | pattern doc §N 一段 markdown | 统一 wording + 指向新位置 | 若某包有特殊约束(如 external consumer),个性化 |

### 3.3 完全解耦点(必须独立)

- **10 份 blueprint 之间完全无引用**
  - 每份 blueprint 自包含;不 `see blueprint X` 类链接
  - pattern doc 是**唯一**跨 blueprint 的共享引用源
  - 原因:worker-matrix P0 可能并行执行 4 个 worker 的 absorption;blueprint 互相依赖会产生顺序约束
- **Dry-run 代码(`workers/agent-core/src/llm/`)与 blueprint 写作解耦**
  - blueprint 描述"怎么搬";dry-run 代码是"实际搬过一次的样本"
  - blueprint 读者不必读 dry-run 代码才能理解 blueprint
  - 反之 dry-run 执行者不必先读完 blueprint 才能开始 dry-run(但最好参考)
- **Dry-run 的 test 迁移与 source 迁移独立**
  - 可以先搬 source 跑 vitest,再搬 test;或同时搬
  - pattern doc 记录实际执行顺序 + 取舍

### 3.4 聚合点(单一中心)

- **聚合对象**:所有 absorption-related 方法论
- **聚合形式**:
  - Pattern doc `W3-absorption-pattern.md` — 唯一的跨 blueprint 方法论聚合点
  - Blueprint template — 10 份 blueprint 共用的结构模板
- **为什么不能分散**:10 份 blueprint 若各自 reinvent 方法,worker-matrix P0 execute 时会遇到 10 套不一致的坑位;pattern doc 聚合让 lessons 可复用

---

## 4. 关键参考实现对比

### 4.1 B9 `tenancy/*` absorption 成功 precedent

- **实现概要**:B9 把 `tenantR2* / tenantKv* / tenantDoStorage*` 从各自 Tier B 包搬到 `nacp-core/src/tenancy/`,直接 cut-over,无 re-export
- **亮点**:
  - subdirectory 聚合干净
  - additive semver
  - 一次 merge,所有 consumer 改 import
- **值得借鉴**:
  - "byte-identical semantics" 的迁移纪律(dry-run 和 worker-matrix P0 都遵守)
- **不照抄的地方**:
  - B9 迁移目标是 nacp-core(Tier A);W3 迁移目标是 workers(Tier B → workers/\*)
  - B9 直接 cut-over;W3 dry-run + worker-matrix P0 共存 3 个月(Strangler Fig)

### 4.2 Strangler Fig Pattern(软件迁移经典)

- **实现概要**:新代码在旧代码"旁边"生长;旧代码保留一段时间;两者并行运行;最后删除旧代码
- **亮点**:
  - 风险最低
  - 可分批验证
  - 随时可退回
- **值得借鉴**:
  - W3 dry-run 期间 `packages/llm-wrapper/` 不删
  - worker-matrix P0 每包 absorb 后原包继续存活到共存期结束
- **不照抄的地方**:
  - Strangler Fig 传统上用于 service-level 迁移;W3 是 package-level 迁移 — 粒度更细
  - W3 强制"blueprint 先行",Strangler Fig 不强求

### 4.3 Monorepo "workspace package → external import" 迁移(changesets 类场景)

- **实现概要**:某 package 从内部工作空间"升级"为 npm 外部依赖
- **亮点**:
  - consumer `package.json` 改 `workspace:*` 为 `^1.x.x`
- **W3 的反向**:
  - W3 是"workspace package → worker 内部代码"(降级,不是升级)
  - llm-wrapper 不去 GitHub Packages;只是换家
- **不照抄的地方**:
  - W3 的目的地不是 npm registry,而是另一个目录;不需要 publish 中介

### 4.4 横向对比速查表

| 维度 | B9 tenancy absorption | Strangler Fig | W3(本设计) |
|---|---|---|---|
| 目的地 | nacp-core 内部 | 新 service | `workers/<name>/src/...` |
| 并行期 | 无(直接 cut) | 长(月到年) | **中等(~3 个月)** |
| 保留 re-export | 无 | 不适用 | **无**(原包保留但不做 re-export,因为它会被整个 absorb) |
| Blueprint 先行 | 否(即兴执行) | 不强求 | **强制** |
| Dry-run | 否 | 不强求 | **强制**(1 包样本) |
| 自动化程度 | 手工 | 手工 | 手工 + 部分脚本(`wc -l` / `grep -r imports` 类) |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope(W3 第一版必须完成)

- **[S1]** **Blueprint 模板定义**:一份 `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`,8 节固定结构(§7.2 T1 详述)
- **[S2]** **10 份 package-specific blueprints**:
  - `W3-absorption-blueprint-session-do-runtime.md` → agent.core
  - `W3-absorption-blueprint-agent-runtime-kernel.md` → agent.core
  - `W3-absorption-blueprint-llm-wrapper.md` → agent.core(同时是 dry-run 的详细版)
  - `W3-absorption-blueprint-hooks.md` → agent.core(仅 runtime 部分;W0 已搬 catalog vocabulary)
  - `W3-absorption-blueprint-eval-observability.md` → agent.core
  - `W3-absorption-blueprint-capability-runtime.md` → bash.core
  - `W3-absorption-blueprint-context-management.md` → context.core
  - `W3-absorption-blueprint-workspace-context-artifacts-context.md` → context.core(snapshot/assembly/compact-boundary 部分)
  - `W3-absorption-blueprint-workspace-context-artifacts-filesystem.md` → filesystem.core(mount/namespace/backends 部分)
  - `W3-absorption-blueprint-storage-topology.md` → filesystem.core(adapters + placement + calibration;keys/refs/_platform 已由 W0 吸收)
- **[S3]** **Dry-run: `llm-wrapper` 真实 absorption**:
  - 在 `workers/agent-core/src/llm/` 建目录(若 W4 已建 `workers/agent-core/` 就用,否则 W3 先建 stub)
  - 搬 12 个 source file + 7 个 test file
  - import path 调整:`zod` 保留;若有其他 inter-package import 改为 `@<scope>/nacp-core`(期望无,llm-wrapper 是纯 logic)
  - Build + test 跑绿(`workers/agent-core/` 目录可编译,即使 agent-core 其他部分还没 absorb)
  - `packages/llm-wrapper/README.md` 不加 deprecated(按 §0.3 deprecated 时机在 worker-matrix P0 absorb 完成)
  - `packages/llm-wrapper/` 不删
- **[S4]** **Pattern spec**:`docs/design/pre-worker-matrix/W3-absorption-pattern.md`,基于 llm-wrapper dry-run lessons 写 pattern:
  - Dry-run 实际遇到的坑 + 解决方案
  - LOC → 时长 回归经验系数
  - 循环引用的 3 类 pattern(若遇到)
  - Test 迁移的典型动作(e.g. `describe.only` 临时用于分批验证)
  - deprecated 贴纸的标准 wording + 时机
  - 共存期管理(`pnpm-workspace.yaml` / lockfile / CI 考虑)
- **[S5]** **W3 closure memo**:`docs/issue/pre-worker-matrix/W3-closure.md`,含:
  - 10 份 blueprint 的完成状态
  - dry-run 执行结果(diff 规模、test pass 证据、时长实际值)
  - pattern spec 归档点
- **[S6]** **Back-write 到 10 份 blueprint**:dry-run 完成后,把 pattern spec 里的 lessons back-write 到其他 9 份 blueprint 的相关字段(特别是 LOC / 时长估算基于 dry-run 回归系数)

### 5.2 Out-of-Scope(W3 不做)

- **[O1]** 实际搬迁其他 9 个 Tier B 包(那是 worker-matrix P0 全部工作)
- **[O2]** 删除 `packages/llm-wrapper/`(共存期内不删)
- **[O3]** 在 `packages/llm-wrapper/README.md` 加 deprecated 贴纸(按 §0.3 时机在 worker-matrix P0 agent.core absorb 完成时加)
- **[O4]** 为 10 份 blueprint 各自写 action-plan(action-plan 由 worker-matrix charter r2 的 P0 sub-phases 产出)
- **[O5]** 自动 migration script / codemod
- **[O6]** 对其他 9 个包做 dry-run(blueprint 已足够)
- **[O7]** 修改任何 10 个 Tier B 包的 public API 或 source code(llm-wrapper 除外,且 llm-wrapper 的"修改"只是搬位置不改 shape)
- **[O8]** 为 Tier B 包单独发版(它们不发布;见 W2)
- **[O9]** 修改 pnpm workspace 主配置(dry-run 的 `workers/agent-core/` 加入 workspace 由 W4 处理)
- **[O10]** 决定 worker-matrix P0 的具体 phase 拆分 / order(那是 worker-matrix charter r2)

### 5.3 边界清单(灰色地带)

| 项目 | 判定 | 理由 |
|---|---|---|
| `workspace-context-artifacts` 是否拆 2 份 blueprint(context + filesystem) | **in-scope 拆 2 份** | 该包内部有清晰分界(snapshot/assembly → context.core;mount/namespace/backends → filesystem.core);拆 2 份让 worker-matrix P0 可并行执行 |
| `storage-topology` 的 keys/refs(W0 已吸收)是否还在 W3 blueprint | **out-of-scope** | W0 已把 keys/refs 吸收到 nacp-core storage-law;blueprint 只描述 "剩余部分(adapters + placement + calibration)" |
| `hooks` 的 catalog vocabulary(W0 已吸收)是否还在 W3 blueprint | **out-of-scope** | 同上;blueprint 只描述 runtime dispatch 部分 |
| `session-do-runtime` 的 cross-seam / eval-sink(W0 已吸收)是否还在 W3 blueprint | **out-of-scope** | 同上;blueprint 只描述 NanoSessionDO + orchestration + controllers |
| `evidence-emitters.ts` 的 emit helpers(W0 未搬)是否进 blueprint | **in-scope**,归 agent.core | 按 owner 决策,emit helpers 归 agent.core(`workspace-context-artifacts-context` blueprint 说明这部分去 agent.core 而非 context.core) |
| Dry-run 是否跑 cross-worker integration test | **out-of-scope** | dry-run 只验证包内测试绿;跨 worker 集成在 worker-matrix P0 |
| W3 完成后 llm-wrapper 是否同时存在于 2 处 | **yes,故意** | 共存期;worker-matrix P0 agent.core absorb 结束时再删原位置 |
| Blueprint 是否要给出 absorption 执行的确切 PR 顺序 | **no**(blueprint 描述"怎么搬",不规定"何时") | 顺序由 worker-matrix charter r2 决定 |
| 是否为 `context.core` 的 W3 blueprint 额外考虑 β 路线的 remote compact delegate | **blueprint 层面仅标注** | β 路线 compact delegate 的接线属于 worker-matrix P0 cross-worker integration;blueprint 只注明"context.core worker 必须消费 W1 `context.compact.*` 现有协议" |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1 — 写 10 份 blueprint,不一份大综合**
   - **选择 per-package blueprint**,不是 **一份 "Tier B absorption master plan"**
   - **为什么**:
     - 每份 blueprint 可独立 review;worker-matrix P0 相应 absorb 子任务可拎一份独立执行
     - blueprint 互不依赖(§3.3)
     - 大综合文档会淹没具体细节(10 × LOC / 循环引用详述不适合一份)
   - **接受的代价**:10 份文档总字数比一份大;导航负担增加
   - **缓解**:pattern doc 作为 meta-index

2. **取舍 2 — Dry-run 选 `llm-wrapper`,不选其他候选**
   - **候选比较**:
     | 候选 | 源/测试 LOC | 跨 package 依赖 | 消费者数 | Platform seam | 适合度 |
     |---|---|---|---|---|---|
     | `llm-wrapper` | 1090 / 1424 | **0**(仅 peer zod) | 1(session-do-runtime) | **无** | ★★★★★ |
     | `agent-runtime-kernel` | ~600 / ~400 (估) | 可能 nacp-core | 1 | 低 | ★★★★ |
     | `eval-observability` | ~400 / ~600 (估) | nacp-core / session | 1 | 低 | ★★★ |
     | `hooks` | ~800 / ~1200 (估) | nacp-core | 2+ | 中 | ★★ |
     | 其他 | — | 高 | 多 | 高 | ★ |
   - **选择 llm-wrapper**
   - **为什么**:零跨 package dep → dry-run 不会被循环引用问题拖累;成为最干净的 pattern 样本
   - **接受的代价**:llm-wrapper 无依赖意味着 dry-run 学不到"循环引用如何解决"的 lessons(这一类 lessons 要等 worker-matrix P0 实际执行第二个包时才出现)
   - **缓解**:pattern doc 的 "循环引用解决" 节留 placeholder,worker-matrix P0 执行首个复杂包后回填

3. **取舍 3 — Blueprint 颗粒度到 "file"(不到 line,也不到 module)**
   - **选择 per-file 映射**,不是 **per-line diff** / **per-module 概括**
   - **为什么**:
     - per-file 平衡 具体 与 可读
     - per-line 会立即过时(代码每天变)
     - per-module 太粗(一个 module 内不同文件可能归不同 worker)
   - **接受的代价**:某些文件内部需要拆分(如 workspace-context-artifacts/evidence-emitters.ts 既有 schema 部分(W0 已搬)又有 emit helper 部分(归 agent.core))— blueprint 需注明"文件部分"
   - **缓解**:blueprint 对 split file 特殊处理:"file X 的 section A-B 去 destination1;section C-D 去 destination2"

4. **取舍 4 — 共存期 ~3 个月,不更短也不更长**
   - **选择 ~3 个月**,不是 **1 个月** 也不是 **永久**
   - **为什么**:
     - 1 个月太紧:worker-matrix P0 4 个 worker 的 absorption 并行也要 2-3 周;加上 cross-worker integration + closure,3 个月给 buffer
     - 永久:违反 "packages phase out" trajectory
     - 3 个月:刚够 worker-matrix P0 + 早期 bug fix + consumer 迁移
   - **接受的代价**:3 个月内 2 份代码共存,开发者看 `packages/` + `workers/` 两处可能困惑
   - **缓解**:deprecated 贴纸 + pattern doc 明确 "这期间的 bug fix 在哪里修" 的纪律

5. **取舍 5 — Deprecated 贴纸在 worker-matrix P0 该 worker absorb 完成时加,不在 W3 期间加**
   - **选择 "absorb 完成时加 deprecated"**,不是 **"W3 期间加 deprecated"**
   - **为什么**:
     - W3 期间其他 9 个包 absorb 还没做;deprecated 会误导 consumer(以为现在就不该用)
     - `llm-wrapper` dry-run 是验证,不代表"现在就不该用 llm-wrapper"
     - 按包 absorb 进度逐个 deprecated 是最诚实的节奏
   - **接受的代价**:deprecated 时机与 W3 解耦;worker-matrix P0 执行者要记得在每包 absorb 完成时打 deprecated(但这个动作简单,贴纸模板在 pattern doc)

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|---|---|---|---|
| llm-wrapper dry-run 过于简单,pattern 不足以覆盖复杂包 | llm-wrapper 零 dep | pattern doc 某些节(如循环引用)无 lessons | §6.1 取舍 2 已提及;pattern doc 相关节留 placeholder |
| Blueprint 写作期间 Tier B 源代码变更 | 长时间写 blueprint | blueprint 过时 | Blueprint 基于"W3 启动日 repo snapshot";明确标注 `basis_commit: <sha>`;若源码重大变更,blueprint 需 revise |
| 10 份 blueprint 粒度不一致 | 不同作者写作风格差异 | worker-matrix P0 执行者困惑 | §7.2 T1 的 TEMPLATE 强制结构;每份 blueprint 必 fill 8 节 |
| W4 `workers/` 目录未就绪但 W3 dry-run 要用 | W3 与 W4 顺序 | dry-run 阻塞 | §7.3 T3 明确:若 W4 未完成,W3 dry-run 先建 `workers/agent-core/src/llm/` stub 目录,细节保留给 W4 完善 |
| llm-wrapper 内部对 nacp 有未觉察的依赖 | package.json 未列但代码 import | dry-run import resolve 失败 | §7.3 T3 第 1 步:`grep -r "@nano-agent" packages/llm-wrapper/src packages/llm-wrapper/test` 先审计 |
| Back-write 阶段(S6)漏掉某 blueprint 字段 | 10 × 多字段 | 质量不一致 | §7.3 T6 有 checklist;每份 blueprint 必回看 |
| 共存期发现需要 bugfix | 使用期间发现问题 | 要决定"在哪里修"(原包 or dry-run 新位置) | Pattern doc 明确:共存期 bug 修 **原包**(Tier B 包,因为 consumer 仍用它);dry-run 代码同步 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己**:
  - worker-matrix P0 不再是"边设计边实装",全部变成"读 blueprint + 执行"
  - 10 份 blueprint 是可并行的 shopping list,team 可并行接包任务
- **对 nano-agent 长期演进**:
  - pattern doc 形成"nano-agent 的包吸收方法论",未来若还有 absorption 场景(如某 worker 自己再拆分)可复用
  - Blueprint template 是一次性投入,终身复用
- **对"上下文管理 / Skill / 稳定性"深耕方向**:
  - 上下文管理:blueprint 清晰描述 context.core 接收哪些部分(snapshot/assembly/compact 等),worker-matrix P0 不会误收 filesystem 部分
  - Skill:未来 skill.core 若入场时需吸收其他包,可直接套用 W3 pattern
  - 稳定性:共存期 + 逐包 deprecated 纪律避免 "big bang 重构" 的系统性风险

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|---|---|---|---|
| T1 | Blueprint TEMPLATE | 8 节固定结构的 markdown 模板 | ✅ `TEMPLATE-absorption-blueprint.md` 可被 10 份 blueprint 直接 copy-fill |
| T2 | 10 份 package blueprint | 按 TEMPLATE 产出 10 份 | ✅ 每份 8 节满填,LOC + 时长估算有数字 |
| T3 | llm-wrapper dry-run 执行 | 真实搬 + 测试绿 | ✅ `workers/agent-core/src/llm/` 有真实代码;unit tests all green |
| T4 | Pattern spec | 基于 dry-run 的 lessons 文档 | ✅ 含循环引用 / LOC 系数 / deprecated 贴纸 / 共存期管理 4 大节 |
| T5 | Back-write | dry-run 经验回写 9 份 blueprint | ✅ 10 份 blueprint 的 LOC / 时长字段基于回归系数更新 |
| T6 | W3 closure memo | 归档 | ✅ `W3-closure.md` 含 10 blueprints + dry-run + pattern 3 类产出清单 |

### 7.2 详细阐述

#### T1: Blueprint TEMPLATE 结构

- **文件位置**:`docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`
- **8 节固定结构**(blueprint 作者必填):

  ```
  # W3 Blueprint — Absorbing `<package-name>` into `workers/<dest>/`
  
  > Basis commit: `<sha>` (状态快照)
  > Author: `<name>`
  > Date: `<date>`
  > Status: `draft | reviewed | frozen`
  
  ## §1. 吸收概况(一句话 + 目标 worker + 规模)
     - 一句话:本包吸收的目的与边界
     - 目的地 worker:`workers/<name>/`
     - 源 package 规模:source LOC / test LOC
     - 估算 diff:新增 / 删除(约 LOC)
     - 估算时长:dry-run 回归系数 × LOC(W3 末期由 S5 back-write)
  
  ## §2. Files → Destination 映射表(逐文件)
     | src path | dest path | 动作(move/split/skip) | 备注 |
     |---|---|---|---|
     (每个 src 文件一行;split 的文件注明 section 拆分)
  
  ## §3. 跨 package 循环引用分析
     - 当前 import 扫描:`grep -r "import.*from" packages/<name>/src packages/<name>/test`
     - 跨包 import 清单(每条:源文件 → 目标包 → 具体 symbol)
     - 循环风险评估:
       - 低:如 llm-wrapper(零跨包)
       - 中:如 hooks(依赖 nacp-core)
       - 高:如 workspace-context-artifacts(相互依赖 storage-topology / capability-runtime)
     - 解决 pattern:
       - (A)dependency inversion(把依赖接口化)
       - (B)interface extraction(抽共用 interface 进 NACP)
       - (C)relocation(把共用部分搬到对应目的地)
  
  ## §4. Test 迁移规划
     | src test path | dest test path | 动作 | 备注 |
     |---|---|---|---|
     - test 文件归属 1:1 对应 src 文件
     - Mock / fixture 迁移路径
     - vitest config 调整(若有)
  
  ## §5. Deprecated 标注时机
     - 贴纸位置:`packages/<name>/README.md` 顶部
     - 贴纸 wording(模板见 pattern doc)
     - 时机:**该 worker absorb 完成后**(不是 W3 期间)
     - 原包是否发 patch bump(推荐:发 0.X.1 patch 只加 README 贴纸)
  
  ## §6. 与 NACP 1.4.0 的 import 改写
     - 原包内从 tier B 兄弟包 import 的 symbol,absorb 后应改为 `@nano-agent/nacp-core` / `@nano-agent/nacp-session`(GitHub Packages import path)
     - 列出具体改写点(file:line → new import path)
  
  ## §7. Worker-matrix P0 执行 checklist
     - [ ] src 搬迁完成
     - [ ] test 搬迁完成
     - [ ] import path 改写
     - [ ] build 绿
     - [ ] unit test 绿
     - [ ] 原包 deprecated 贴纸 added
     - [ ] CHANGELOG updated
     - [ ] PR reviewed + merged
  
  ## §8. 依赖 / 下游 / 后续 phase 引用
     - 本 blueprint 依赖:W0 / W1 / W2 / W4 完成
     - 本 blueprint 被谁依赖:worker-matrix P0 的 `<worker>` absorption sub-phase
     - Related pattern spec sections:(指向 pattern doc 的相关节)
  ```

- **一句话收口目标**:✅ **TEMPLATE 可 direct copy-fill;10 份 blueprint 作者按此产出**

#### T2: 10 份 package-specific blueprint

- **作者**:本 W3 design 产出后,Opus 或指定作者按 TEMPLATE 产出 10 份;每份独立 PR
- **顺序**:建议 llm-wrapper 第一个写(因为它是 dry-run 目标,写 blueprint 时就可以同时核查 dry-run 实际情况);其他 9 份可并行
- **每份字数预估**:~300-500 行 markdown(per blueprint)
- **共计**:10 × ~400 = ~4000 行 blueprint artifacts
- **一句话收口目标**:✅ **10 份 blueprint shipped;每份 8 节满填**

#### T3: llm-wrapper Dry-Run 执行

- **前置条件**:W4 `workers/agent-core/` 目录创建(若 W4 未开始,W3 先建 stub);W2 NACP 发布就绪(llm-wrapper 不需依赖 NACP,但 agent-core worker package 层可能 import)
- **执行步骤**:
  1. **审计 import**:`grep -r "@nano-agent\|@<scope>" packages/llm-wrapper/` — 确认零跨包 dep(预期)
  2. **建 destination 目录**:`mkdir -p workers/agent-core/src/llm workers/agent-core/test/llm`
  3. **搬 source**:`cp packages/llm-wrapper/src/*.ts workers/agent-core/src/llm/`(copy 不 move,原位置保留)
  4. **搬 test**:`cp packages/llm-wrapper/test/*.ts workers/agent-core/test/llm/`
  5. **调 import**:在 `workers/agent-core/src/llm/` 内部文件,相对 import 无需改(同目录结构);`package.json` 里 `zod` 作为 devDep 或从 `@<scope>/nacp-core` 转依赖(核查)
  6. **调 vitest config**:`workers/agent-core/vitest.config.ts`(若 W4 未创建,本 step 临时 inline 一份)
  7. **build 验证**:`cd workers/agent-core && pnpm build`(期望绿)
  8. **test 验证**:`cd workers/agent-core && pnpm test`(期望 103 tests all green)
  9. **记录 lessons**:
     - 遇到的坑(如 tsconfig 需要 `moduleResolution: bundler` 等)
     - 实际 LOC(diff size)
     - 实际时长(人工 + wall-clock)
     - 写入 pattern doc(T4)
- **共存期**:`packages/llm-wrapper/` 完全不动;两处 llm-wrapper 代码共存
- **回归**:`pnpm -r run test` 仍全绿(原 llm-wrapper 包 + 新 workers/agent-core/src/llm/)
- **一句话收口目标**:✅ **workers/agent-core/src/llm/ 有真实代码 + 103 tests all green;packages/llm-wrapper/ 未改;主 regression 全绿**

#### T4: Pattern Spec

- **文件**:`docs/design/pre-worker-matrix/W3-absorption-pattern.md`
- **最少必含节**:
  1. **背景**:来自 llm-wrapper dry-run 的 lessons
  2. **循环引用解决 pattern**(即使 llm-wrapper 零循环,记录"若遇到" pattern;worker-matrix P0 执行其他包时回填)
  3. **LOC → 时长 经验系数**:基于 llm-wrapper 实测(~1090 source + ~1424 test LOC → 实际 dry-run 人时)
  4. **Test 迁移典型动作**:vitest config / fixture / mock 处理
  5. **Deprecated 贴纸标准 wording**(templating 给 10 份 blueprint 复用):
     ```markdown
     # ⚠️ DEPRECATED — Absorbed into `workers/<dest>/`
     
     This package's logic has been absorbed into `workers/<dest>/src/...` as part
     of worker-matrix Phase <X>. New development should happen in the worker, not
     here. This package will be removed at the end of worker-matrix phase.
     
     **Migration pointer**: see `docs/design/pre-worker-matrix/W3-absorption-blueprint-<name>.md`.
     ```
  6. **共存期管理纪律**:
     - bug fix 修原包(consumer 仍用);dry-run 副本同步
     - CHANGELOG 双写(原包 + worker)
     - CI 矩阵:原包测试 + worker 测试双跑
  7. **Workspace 配置**:`pnpm-workspace.yaml` 同时 include `packages/*` + `workers/*`(W4 建立)
  8. **PR 流水线**:每个 absorption PR 的 checklist(含 blueprint §7 的 8 项)
- **一句话收口目标**:✅ **pattern doc 8 节全满;所有 templating / 系数 / wording 可被 10 份 blueprint 直接引用**

#### T5: Back-write(dry-run 经验回写)

- **触发时机**:llm-wrapper dry-run 完成(T3 结束)+ pattern doc 写完(T4 结束)
- **动作**:
  - 对其他 9 份 blueprint,更新 §1 的"估算时长"字段(基于 T4 §3 的 LOC × 系数)
  - 对其他 9 份 blueprint,引用 pattern doc 的相关节(§2 循环引用解决 / §5 deprecated wording 等)
- **一句话收口目标**:✅ **9 份 blueprint 的"估算时长"字段有实数;引用 pattern doc 的链接全部 valid**

#### T6: W3 Closure Memo

- **文件**:`docs/issue/pre-worker-matrix/W3-closure.md`
- **必含**:
  - 10 份 blueprint 的清单 + 完成状态
  - llm-wrapper dry-run 的实际 diff 大小 + test 结果 + 时长
  - pattern doc 归档点
  - 遗留 open question(如"pattern doc 的循环引用节需等 worker-matrix P0 第一个复杂包回填")
  - worker-matrix P0 消费者 checklist(它们拿到 W3 产出应该能直接开跑)
- **一句话收口目标**:✅ **closure 可被 worker-matrix charter r2 作者直接消费**

### 7.3 非功能性要求

- **Blueprint 可读性**:non-expert 读者应能读懂某份 blueprint 的 intent(不需要读完 pattern doc 就能理解)
- **Blueprint 可执行性**:worker-matrix P0 执行者应能只读 blueprint + pattern doc 就能完成 absorb,不再需要现场设计
- **Dry-run 可验证性**:W3 closure 应含可 re-run 的 dry-run 步骤(若需回归验证)
- **Pattern 可复用性**:pattern doc 应对未来类似场景(skill.core 入场等)仍然可用

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nano-agent 自己的先例

| 位置 | 内容 | 借鉴点 |
|---|---|---|
| `docs/issue/after-foundations/B9-final-closure.md` | B9 tenancy 吸收的 closure memo | W3 closure memo 的结构模板 |
| `packages/nacp-core/src/tenancy/` | B9 吸收后的目标目录 | `workers/<name>/src/llm/` 等目的地的命名类比 |
| `docs/plan-pre-worker-matrix.md` §1.3 | 10 包 → workers/ 的映射表 | blueprint §2 的源 mapping |

### 8.2 来自 llm-wrapper 自身(dry-run 目标)

| 位置 | 内容 | 借鉴点 |
|---|---|---|
| `packages/llm-wrapper/src/index.ts` (74 行) | 包的 public API | 搬迁后 `workers/agent-core/src/llm/index.ts` shape 保持 |
| `packages/llm-wrapper/test/executor.test.ts` (378 行) | 最大 test 文件 | test 迁移的典型案例 |
| `packages/llm-wrapper/package.json` | 依赖声明 | 搬迁后 `workers/agent-core/package.json` 的 LLM-related dep 来源 |
| `packages/llm-wrapper/src/executor.ts` (327 行) | 核心 class | pattern doc 的 "大 class 迁移" 示例 |

### 8.3 来自 Strangler Fig Pattern / 软件迁移文献

- Martin Fowler 的 "Strangler Fig" 博文 — 软件迁移经典
- "Feature Flag + Gradual Rollout" pattern(虽然 W3 不用 feature flag,但"新旧并存"思维相同)

### 8.4 需要避开的反例

| 做法 | 问题 | 我们为什么避开 |
|---|---|---|
| 一次 mega PR 搬 10 包 | 风险爆炸 + review 不可能 | W3 只 dry-run 1 个;worker-matrix P0 按 blueprint 分批 |
| blueprint 精确到 line 级 | 代码每天变 | W3 blueprint 到 file 级 |
| dry-run 删除原包 | 破坏共存期纪律 | §0.3 明确 llm-wrapper 原包保留 |
| 在 W3 期间加所有 deprecated 贴纸 | Consumer 误解"现在不该用" | §6.1 取舍 5 明确 deprecated 时机 |
| 写 auto-migration script | 每包循环引用不同;脚本化失败率高 | §3.1 精简 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

W3 是 **"设计桥梁 + 1 次 dry-run"** phase:

- **存在形式**:1 份 TEMPLATE + 10 份 blueprint + 1 份 pattern doc + 1 份 dry-run(真实代码)+ 1 份 closure memo
- **覆盖范围**:Tier B 10 个包的搬迁蓝图;最简包的真实搬迁样本
- **耦合形态**:
  - 与 W0 强耦合(blueprint 引用 W0 已吸收的 nacp-core path)
  - 与 W1 中耦合(blueprint 引用 W1 新协议;worker-matrix P0 跨 worker 通讯需 W1 就绪)
  - 与 W2 强耦合(blueprint 假设 NACP 可从 GitHub Packages import)
  - 与 W4 强耦合(dry-run 需要 `workers/` 目录存在;若 W4 晚,dry-run 先建 stub)
  - 与 worker-matrix P0 强耦合(直接消费)
- **预期代码量级**:
  - TEMPLATE:~100 行 markdown
  - 10 份 blueprint:~4000 行 markdown 合计
  - Pattern doc:~400-600 行
  - Dry-run 真实代码:~1090 src + ~1424 test LOC(copy,不是新写)
  - Closure memo:~100 行
- **预期复杂度**:中 — blueprint 书写需要仔细的代码审计;dry-run 本身低风险(llm-wrapper 无依赖)

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|---|---|---|
| 对 nano-agent 核心定位的贴合度 | **5** | "packages 是吸收上下文" 决策从纸面变成 execution shopping list |
| 第一版实现的性价比 | **4** | Blueprint 写作工作量大(~4000 行);但 worker-matrix P0 效率提升值得 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | **5** | Pattern doc 是长期复用资产;skill.core 入场时可直接套用 |
| 对开发者自己的日用友好度 | **4** | Blueprint 格式统一;execution 时按 checklist 即可 |
| 风险可控程度 | **4** | dry-run 低风险;blueprint 写作有过时风险但可控 |
| **综合价值** | **4.4** | 承上(pre-worker-matrix 其他 phase)启下(worker-matrix P0)的关键桥梁 |

### 9.3 下一步行动

- [ ] **决策确认**(W3 动手前,owner 需 approve):
  - §6.1 取舍 2(dry-run 目标 = llm-wrapper)是否接受?
  - §6.1 取舍 4(共存期 ~3 个月)是否接受?
  - §6.1 取舍 5(deprecated 贴纸在 worker-matrix P0 该 worker absorb 完成时加)是否接受?
  - §5.3 边界清单中 `workspace-context-artifacts` 拆 2 份 blueprint 是否接受?
  - §5.3 边界清单中 `evidence-emitters.ts` 的 emit helpers 归 agent.core(非 context.core)是否接受?
- [ ] **关联 action-plan**:`docs/action-plan/pre-worker-matrix/D4-absorption-blueprint-and-dryrun.md`(T1-T6 的批次化执行)
- [ ] **关联 TEMPLATE 产出**:`docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`(T1 交付)
- [ ] **关联 Pattern spec**:`docs/design/pre-worker-matrix/W3-absorption-pattern.md`(T4 交付)
- [ ] **关联 10 份 blueprint**:`docs/design/pre-worker-matrix/W3-absorption-blueprint-*.md`(T2 交付,共 10 份)
- [ ] **依赖下游**:
  - W4 `workers/agent-core/` 目录创建(T3 dry-run 需要;若 W4 慢,T3 建 stub)
- [ ] **待深入调查的子问题**:
  - llm-wrapper 是否真的零跨包 dep?(T3 第 1 步审计验证)
  - `workspace-context-artifacts` 内部 `evidence-emitters.ts` 的 emit helpers 具体含哪些函数?(`workspace-context-artifacts-context.md` blueprint 需要列出)
  - `hooks` package 去掉 W0 已搬的 catalog vocabulary 后,还剩多少 runtime 代码?(blueprint 需要核查)
  - `storage-topology` 去掉 W0 已搬的 keys/refs 后,还剩的 adapters + placement + calibration 的 LOC(`storage-topology.md` blueprint 需要核查)

---

## 附录

### A. 讨论记录摘要

- **分歧 1**:W3 是否必须做 dry-run,而非纯 blueprint
  - **Opus 倾向**:必须 dry-run 1 个
  - **理由**:纯文档 blueprint 未验证可执行性;1 个 dry-run 风险极低,收益极高
  - **当前共识**:必做 1 个 dry-run(§0.2 + §6.1 取舍 2)
- **分歧 2**:dry-run 目标选择
  - **候选**:llm-wrapper / agent-runtime-kernel / eval-observability
  - **Opus 倾向**:llm-wrapper(零跨包 dep 最干净)
  - **当前共识**:llm-wrapper(§6.1 取舍 2)
- **分歧 3**:blueprint 粒度
  - **候选**:per-line / per-file / per-module
  - **Opus 倾向**:per-file(§6.1 取舍 3)
  - **当前共识**:per-file
- **分歧 4**:共存期长度
  - **候选**:1 个月 / 3 个月 / 永久
  - **Opus 倾向**:3 个月(§6.1 取舍 4)
  - **当前共识**:~3 个月

### B. 开放问题清单

- [ ] **Q1**:`packages/llm-wrapper/package.json` 是否有任何 inter-workspace `@nano-agent/*` dep?(T3 第 1 步审计)
- [ ] **Q2**:pnpm-workspace.yaml 是否需要 `include workers/*`(W4 会处理,但 W3 dry-run 先建 `workers/agent-core/` 时需确认 workspace 识别)
- [ ] **Q3**:原包 `packages/llm-wrapper/` 在 dry-run 期间是否需要改 CHANGELOG?(建议:不改,直到 worker-matrix P0 agent.core absorb 完成时在原包 CHANGELOG 加 "deprecated in favor of workers/agent-core" entry)
- [ ] **Q4**:dry-run 的 `workers/agent-core/src/llm/` 是否需要单独 vitest.config.ts?(若 W4 未给,W3 临时内置一份)
- [ ] **Q5**:`workspace-context-artifacts` 拆 2 份 blueprint 后,共享依赖(如 types / utils)归哪一份?(建议:抽共用 interface 到 nacp-core,但若量小可 duplication;blueprint 写作时决定)
- [ ] **Q6**:worker-matrix P0 是否强制"必须读完 pattern doc 才能开始 absorption PR"?(推荐 yes;纪律由 worker-matrix charter r2 制定)
- [ ] **Q7**:若 worker-matrix P0 执行期间发现某份 blueprint 有误,修 blueprint 还是就地调整?(建议:小误就地调整 + 回写 blueprint;大误停下来 revise blueprint,避免偏离)

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|---|---|---|---|
| v0.1 | 2026-04-21 | Claude Opus 4.7 | 初稿:T1-T6 功能 + 6 个 tradeoff + 10 blueprint 目录 + llm-wrapper dry-run 步骤 + pattern doc 结构 |
