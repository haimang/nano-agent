# W3 — Absorption Map + Representative Blueprints + Optional capability-runtime Dry-Run

> 功能簇:`pre-worker-matrix / W3 / absorption-blueprint-methodology`
> 讨论日期:`2026-04-21`
> 讨论者:`Claude Opus 4.7 (1M context)` + owner pending review
> 关联文档:
> - Charter: `docs/plan-pre-worker-matrix.md` §4.1 D / §7.4
> - Tier 映射:`docs/plan-pre-worker-matrix.md` §1.3
> - 前置 design:`W0-nacp-consolidation.md`(Tier A 吸收 shape)
> - 并行 design:`W1-cross-worker-protocols.md`(跨 worker 协议)、`W2-publishing-pipeline.md`(NACP 发布)
> - 后继 design:`W4-workers-scaffolding.md`(消费 W3 的 optional capability-runtime dry-run 结果,若执行)
> 文档状态:`draft (v0.3 post-GPT-R4-review: body fully narrowed — §2.3 / §3 / §4 / §6 / §7.3 / §9 all reflect map + 2-3 representative + optional capability-runtime dry-run)`
>
> **修订历史**:
> - v0.1 (2026-04-21):初稿。10 份 detailed blueprint + llm-wrapper dry-run(gate)
> - v0.2 (2026-04-21):Post-GPT-review narrowing(GPT review 盲点 5-6 整改)。收窄为 **1 份 absorption map + 2-3 份代表性 detailed blueprint + dry-run 可选**。若做 dry-run,目标从 llm-wrapper 改为 capability-runtime(更代表跨 worker 吸收复杂度)。§0 / §5.1 / §7.2 T2/T3/T4 已重写;顶部 + §7.1 T-table 已更新。
> - v0.3 (2026-04-21):Post-GPT-R4 body-level narrowing。GPT 指出 v0.2 仅改顶部/In-Scope/T-table;§2.2/§2.3/§3/§4/§6.1 取舍 1-2/§6.2 风险表/§6.3 价值/§9.1 画像/§9.3 下一步/附录 A/B 仍按 v0.1 表述 "10 份 blueprint / llm-wrapper dry-run / 强制 gate"。本版:标题改为 "Absorption Map + Representative Blueprints + Optional capability-runtime Dry-Run";§2.2 interaction matrix、§2.3 一句话定位、§3.1-§3.4 精简/接口/解耦/聚合、§4.2-§4.4 对比(Strangler Fig / monorepo / speed table)、§6.1 取舍 1-2(重写 map-ratio 取舍 + capability-runtime 候选对比)、§6.2 风险表、§6.3 价值、§7.2 T1/T6 收口目标、§7.3 非功能、§9.1 画像、§9.3 下一步决策 / 关联链接 / 深入调查、附录 A 分歧、附录 B 开放问题 全文与 v0.2 顶部一致。

---

## 0. 背景与前置约束

### 0.1 为什么 W3 必须作为独立 phase(v0.2 narrowed)

owner 在"packages 定位"讨论中明确:`nacp-core` / `nacp-session` 之外**所有** Tier B packages 是"验证 + 吸收上下文"。

**v0.2 post-GPT-review 调整**:原 v0.1 把 W3 定义为 "10 份 detailed blueprint + llm-wrapper dry-run(gate)",被 GPT review 盲点 5-6 指出过度(llm-wrapper 代表性低 + 10 份 blueprint = 新大阶段)。v0.2 narrower 定义:

| 条目 | v0.1 | v0.2 |
|---|---|---|
| Absorption map | 隐含在 10 份 blueprint 里 | **显式独立产 1 份 map**(primary deliverable) |
| Detailed blueprint | 10 份 | **2-3 份**(高复杂度代表:capability-runtime / workspace-context-artifacts split / 可选 session-do-runtime) |
| Dry-run | **gate**(llm-wrapper) | **optional**;若做选 **capability-runtime**(代表性高);非 gate |
| 其他 7 份 detailed blueprint | W3 完成 | 推到 worker-matrix charter r2 / P0 按需撰写 |

v2 把设计与执行严格拆开,**保持** 3 个结构性好处,但工作量减少 ~70%:

- **单 phase 单焦点纪律**:W3 产 map + 2-3 份代表 blueprint + optional dry-run
- **可预估**:map 给出粗粒度规模;2-3 份代表细化典型复杂度
- **可并行**:不同 worker 的 absorption 仍可并行;缺的 7 份 detailed blueprint 由 worker-matrix P0 现场撰写(不是回归设计工作,是"先读 map + 代表 blueprint,再执行该 worker 的 absorb"的 natural flow)

### 0.2 为什么 dry-run 在 W3 做(v0.2 降为 optional)

**v0.2 调整**:dry-run 从 gate 降为 optional。GPT review 盲点 5 指出:llm-wrapper 代表性低(零跨包 dep = 无循环引用 lessons = 外推能力弱)。

v0.2 立场:

- **Dry-run 非必要**:1 份 map + 2-3 份 detailed blueprint 已足够 worker-matrix P0 启动
- **Dry-run 可选**:若 owner / team 时间充裕,可做 dry-run;但不作为 W3 exit gate
- **若做,目标改 `capability-runtime`**(非 llm-wrapper)— 它有真实跨包依赖 + 复杂测试 + 对应 bash.core absorption,dry-run 的 lessons 外推价值更高
- Dry-run 产出的 pattern doc 可部分回写到代表 blueprint(非强制)

### 0.3 前置共识(v0.2 narrower — 不再辩论)

- **9 个 Tier B packages 的归宿已基本固定,但吸收视角会展开为 10 个 absorption units**(其中 `workspace-context-artifacts` 至少拆成 context/filesystem 两个主要单元;见 charter §1.3 Tier B 映射表)
- **Absorption map 必做**(1 份 10 行表)
- **Detailed blueprint 仅做 2-3 份代表性高复杂度包**(v0.2 narrower):
  - 必写:`capability-runtime`(→ bash.core,capability surface / policy / honest-partial 纪律最集中)
  - 必写:`workspace-context-artifacts-split`(→ context.core + filesystem.core,需拆分决策)
  - 可选:`session-do-runtime`(→ agent.core,含 DO class)
- **其他 7 份 detailed blueprint 不在本阶段**:由 worker-matrix P0 该 worker absorb 前现场撰写(不是 pre-phase gate)
- **Dry-run 可选 + 若做选 capability-runtime**(v0.2 narrower;原 v0.1 选 llm-wrapper 因代表性低被 GPT review §5 纠正)
- **Blueprint 不预设实际搬迁时机**:blueprint 描述"怎么搬",不规定"何时搬"
- **共存模式默认**:Tier B 包与 workers/\* 代码并存 ~3 个月
- **deprecated 标注时机**:worker-matrix P0 该 worker absorb 完成时原包发 patch + README deprecated;不在 W3 期间提前
- **若做 dry-run,原包保留**:capability-runtime 原包不删,worker-matrix 末期统一删

### 0.4 显式排除(v0.2)

- 不实际搬迁其他 7 个 Tier B 包的 detailed blueprint 撰写(那是 worker-matrix P0)
- 不删除任何 Tier B 包代码(连可选 dry-run 的 capability-runtime 原包都保留)
- 不修改现有 Tier B 包 public API(除可选 dry-run 目标 README 加 deprecated)
- 不为 Tier B 包发布到 GitHub Packages(W2 明确只发 NACP 2 包)
- 不写 auto-migration script
- 不承诺 worker-matrix P0 具体 phase 分法
- **v0.2 新增**:不以 llm-wrapper 为 dry-run 目标(代表性低,v0.1 误选);若 owner 决定做 dry-run,改选 capability-runtime

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称(v0.2)**:`Absorption Map + Representative Blueprints + Optional capability-runtime Dry-Run`
- **一句话定义(v0.2 narrower)**:为 **9 个 Tier B packages（按吸收单元展开为 10 行 map）** 产出 **1 份 absorption map**+ **2-3 份代表性高复杂度 detailed blueprint**(capability-runtime / workspace-context-artifacts-split / 可选 session-do-runtime)+ **optional capability-runtime dry-run**(非 gate);其他非代表性单元的细化 blueprint 延到 worker-matrix P0 该 worker absorb 前现场撰写
- **边界描述**:
  - **包含(v0.2)**:blueprint 模板定义、**1 份 absorption map**、**2-3 份代表性 detailed blueprint** 撰写、optional `capability-runtime` dry-run 执行、pattern spec 文档、deprecated 标注纪律
  - **不包含**:其他 9 个包的实际 absorb、worker-matrix P0 的具体 phase 拆分、blueprint 里提到的 workers/ 目录实际创建(那是 W4)

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|---|---|---|
| blueprint | 针对一个 Tier B package 的搬迁蓝图,含映射表 + 循环解决 + 测试迁移 + deprecated 时机 + LOC + 时长 | W3 的主交付物 |
| absorption | 把 Tier B package 的代码物理搬进 `workers/<name>/` 并删除原位置(worker-matrix P0 执行) | 词义与 W0 的 consolidation 区别:consolidation = Tier B → nacp-core;absorption = Tier B → workers/\* |
| dry-run | 对 1 个代表包做真实 absorption 样本(代码搬 + 测试迁 + 构建绿),但保留原包并行存在,不删 | W3 若执行,目标是 capability-runtime |
| pattern | dry-run 过程中发现的可复用步骤、坑位、工具链决定,写成独立 spec doc | 给 map 外推与后续 blueprint 使用 |
| deprecated 贴纸 | Tier B 包的 README.md 顶部加 `⚠️ DEPRECATED` banner + 迁移指引 | 在 worker-matrix P0 该 worker absorb 完成后统一加 |
| 共存期 | Tier B 包与 workers/\* 代码并行存在的时间窗口(~3 个月) | W3 blueprint 默认假设 |
| LOC 估算 | 预估 absorption 期间 diff 总行数(新增 + 修改 + 删除) | 每份 blueprint 必填 |
| Strangler Fig | 软件迁移 pattern:新代码在旁逐步替换旧代码,旧代码保留一段时间后删 | W3 整体遵循此 pattern |

### 1.3 参考上下文

- Charter `docs/plan-pre-worker-matrix.md` §1.3 Tier B 映射表(10 包 → workers 目的地)
- Charter §7.4 `In-Scope` 条目 32-39(blueprint 6 字段 + dry-run 5 条)
- Charter r2 当前文档清单:template + map + 2-3 份代表 blueprint + pattern spec
- B9 `tenancy/*` 吸收 precedent(`docs/issue/after-foundations/B9-final-closure.md`)— 最接近的 "跨 package 搬迁" 历史成功案例
- 当前 `packages/capability-runtime/` / `packages/workspace-context-artifacts/` 代码事实核查(见 §6.1 取舍 2)

### 1.4 Dry-run 目标重评(v0.2 — capability-runtime 替代 llm-wrapper)

**v0.1 旧选择(llm-wrapper)被 GPT review §5 纠正**:llm-wrapper 零跨包 dep + 纯 logic,**代表性过低**;搬完不能外推其他 9 包的复杂度。

**v0.2 新选择(capability-runtime)对比表**:

| 维度 | llm-wrapper(v0.1 旧选)| **capability-runtime(v0.2 新选)** |
|---|---|---|
| source 文件数 | 12 | **30+**(handlers + bridge + executor + targets) |
| source 总行数 | ~1090 | **~3500+** |
| test 文件数 | 7 | **15+** |
| test 总行数 | ~1424(103 tests) | **~4000+**(352 tests) |
| 包依赖 | 零(仅 peer zod) | **多个** nacp-core / workspace-context-artifacts 引用 |
| 消费者数 | 1 | 1(session-do-runtime;未来 bash.core) |
| 循环引用风险 | 无 | **有**(多层)— 这是 pattern spec 需要捕获的关键 lesson |
| 与 NACP 关系 | 完全独立 | 深度依赖 `tool.call.*` family |
| platform-specific seam | 无 | **有**(ServiceBindingTarget / remote-bindings seam) |
| 代表性 | **低** | **高** — 代表真正的跨 worker absorption 复杂度 |

**v0.2 结论**:若 owner 决定执行 optional dry-run,**选 capability-runtime**;若不做,pattern spec 由未来 worker-matrix P0 首次 absorb 回写(推迟到 live evidence-driven 时机)。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **整体架构里的角色**:设计层的**最后一块前置工作**;让 worker-matrix P0 从"需要边设计边搬"退化为"按 blueprint 执行"
- **服务于**:worker-matrix 阶段的 absorption sub-phases(P0.A agent.core / P0.B bash.core / P0.C context.core / P0.D filesystem.core 各自的 blueprint 执行)
- **依赖**:
  - W0 完成(Tier A 吸收后 nacp-core 的 final shape)
  - W1 完成(3 份 RFC shipped,blueprint 内对应协议 reference 可确定)
  - W4 开始(blueprint 里的"目的地"即 `workers/<name>/src/...`,需要该目录存在)
- **被谁依赖**:worker-matrix P0 所有 absorption sub-phase(blueprint 是直接消费对象)

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| W0 已 ship 的 nacp-core 1.4.0 | W3 blueprint 引用 | 强 | blueprint 里 import path 从 Tier B 内部 symbol 改为 `@nano-agent/nacp-core` |
| W1 新协议 RFC(`workspace.fs.*` 等) | W3 代表 blueprint 可引用 | 弱-中 | 若代表 blueprint 涉及跨 worker 通信,可引用 W1 RFC;W1 RFC-only 无 code |
| W2 publishing pipeline skeleton | W3 blueprint 假设 import 形式 | 中 | blueprint 描述 `workspace:*` OR `@<scope>/nacp-core` 任一 path |
| W4 workers/ 目录 | W3 blueprint 描述目的地 | 强 | blueprint 指向 `workers/<name>/src/...`,该目录由 W4 建立 |
| worker-matrix P0 | W3 被消费 | 强 | P0 按 map 执行全 Tier B;按 2-3 代表 blueprint 外推 |
| `packages/capability-runtime/` | W3 **optional** dry-run 目标(如执行) | 弱-中 | capability-runtime 相较 llm-wrapper 更具代表性;dry-run 属 optional 增强 |
| 其他 Tier B 包 | W3 map 覆盖 / 仅代表少数深写 blueprint | 弱 | 不动它们直到 worker-matrix P0 |
| `docs/action-plan/` | W3 map + 代表 blueprint 会成为 action-plan 前置 | 中 | worker-matrix charter r2 的 action-plan 会引用 W3 map + 代表 blueprint |

### 2.3 一句话定位陈述

> 在 nano-agent 里(v0.2),`Absorption Map + Representative Blueprints + Optional capability-runtime Dry-Run` 是 **设计层桥梁**,负责 **产出 1 份覆盖全部 9 个 Tier B packages / 10 个 absorption units 的 map + 2-3 份代表性 absorption blueprint(作为 pattern 样本)+ optional capability-runtime dry-run(若执行则强化 pattern;若不执行则明确 skip 理由)**,对上游(pre-worker-matrix)提供 **"packages 被 worker 吸收"的方向性 shopping list(map)+ 样本(blueprint)**,对下游(worker-matrix P0)要求 **按 map 执行,按 2-3 代表 blueprint 外推到其余单元;不临时设计**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点(哪里可以砍)

| 被砍项 | 来源 / 对标 | 砍的理由 | 未来是否回补 |
|---|---|---|---|
| 自动 migration script | 大规模 monorepo migration | 各包都有自己的循环引用 / 测试特殊处;脚本化成本大于收益 | 否(人工 PR 更准) |
| Blueprint 精确到 SHA / commit 级别 | 严格 audit 项目 | 过于精确;blueprint 是"当前代码事实的快照",SHA 当天即过时 | 否 |
| 同时 dry-run 多个包 | 并行推进 | 每个包有自己的 pattern 发现;并行会稀释 lessons;v0.2 dry-run 本身 optional | 否 |
| Blueprint 内给出完整重构后的代码 | "blueprint = code" | blueprint 是 shopping list 不是 PR diff;实装在 worker-matrix P0 | 否 |
| 为所有 Tier B 包逐份写 detailed blueprint | v0.1 原设想"10 份 detailed blueprint" | v0.2 narrower:map + 2-3 代表即可外推;写全份 = 新 phase | 留给 worker-matrix P0 按需补细 |
| Blueprint 决定 "谁在 worker-matrix P0 执行" | 任务分配 | W3 只写 what,不写 who;who 是 worker-matrix charter r2 的事 | 否 |
| Blueprint 预测 runtime behavior 差异 | 过度 future 分析 | blueprint 基于"byte-identical semantics"假设 | 若某包发现 absorb 后行为变化,属 bug 单修 |
| Dry-run 完成后立即删原包 | 快速清理 | W3 即使执行 optional dry-run 也不 destroy;原包保留到 worker-matrix 末期 | 否(共存纪律) |

### 3.2 接口保留点(必须留扩展空间)

| 扩展点 | 表现形式 | 第一版行为 | 未来演进 |
|---|---|---|---|
| Blueprint 模板(`TEMPLATE-absorption-blueprint.md`) | Markdown 模板 | 8 节结构(见 §7.2 T1) | 若 worker-matrix P0 反馈某节冗余 / 某节缺失,修模板并回写 2-3 份代表 blueprint + map 说明 |
| 循环引用解决方案库 | pattern doc §N | 目前列 3 种(dependency-inversion / interface-extraction / relocation) | 新 pattern 出现时 additive 加入 |
| LOC 估算方法 | blueprint "LOC 估算" 字段 | 手工 `wc -l` + 人类判断 | 若不准确率高,引入更严格 metric |
| 时长估算方法 | blueprint "时长估算" 字段 | 若执行 optional capability-runtime dry-run,基于其推导 per-LOC 系数;否则按 map 历史基线(LOC × 0.5min)作 rough 估算 | 若经验数据累积,用回归方法 |
| Deprecated 贴纸模板 | pattern doc §N 一段 markdown | 统一 wording + 指向新位置 | 若某包有特殊约束(如 external consumer),个性化 |

### 3.3 完全解耦点(必须独立)

- **2-3 份代表 blueprint + map 条目之间完全无引用**
  - 每份 blueprint 自包含;不 `see blueprint X` 类链接
  - pattern spec 是**唯一**跨 blueprint 的共享引用源
  - 原因:worker-matrix P0 可能并行执行 4 个 worker 的 absorption;blueprint 互相依赖会产生顺序约束
- **Optional capability-runtime dry-run 代码(落点 `workers/bash-core/src/`)与 blueprint 写作解耦**
  - blueprint / map 描述"怎么搬";dry-run 代码是"实际搬过一次的样本"
  - blueprint 读者不必读 dry-run 代码才能理解 blueprint
  - 反之 dry-run 执行者不必先读完 blueprint 才能开始 dry-run(但最好参考)
- **Dry-run 的 test 迁移与 source 迁移独立**
  - 可以先搬 source 跑 vitest,再搬 test;或同时搬
  - pattern doc 记录实际执行顺序 + 取舍

### 3.4 聚合点(单一中心)

- **聚合对象**:所有 absorption-related 方法论
- **聚合形式**:
  - Pattern spec `W3-absorption-pattern.md` — 唯一的跨 blueprint 方法论聚合点(含 map 扩展到全 Tier B 的外推规则)
  - Blueprint template — 2-3 代表 blueprint 共用的结构模板;worker-matrix P0 按 map 外推时也引用本模板
- **为什么不能分散**:2-3 代表 blueprint 若各自 reinvent 方法,worker-matrix P0 按 map 外推到其余包时会遇到不一致的坑位;pattern spec 聚合让 lessons 可复用

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
  - W3 **optional** dry-run 期间(若执行)`packages/capability-runtime/` 不删
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
  - 被 absorb 的 Tier B 包不去 GitHub Packages;只是换家(worker 内部)
- **不照抄的地方**:
  - W3 的目的地不是 npm registry,而是另一个目录;不需要 publish 中介

### 4.4 横向对比速查表

| 维度 | B9 tenancy absorption | Strangler Fig | W3(本设计) |
|---|---|---|---|
| 目的地 | nacp-core 内部 | 新 service | `workers/<name>/src/...` |
| 并行期 | 无(直接 cut) | 长(月到年) | **中等(~3 个月)** |
| 保留 re-export | 无 | 不适用 | **无**(原包保留但不做 re-export,因为它会被整个 absorb) |
| Blueprint 先行 | 否(即兴执行) | 不强求 | **强制**(map 全 Tier B + 2-3 代表 blueprint) |
| Dry-run | 否 | 不强求 | **Optional**(v0.2:若做则 capability-runtime 落 workers/bash-core/src/ 强化 pattern;若不做则明确 skip 理由) |
| 自动化程度 | 手工 | 手工 | 手工 + 部分脚本(`wc -l` / `grep -r imports` 类) |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope(W3 v0.2 narrower 版)

> **v0.2 说明**:原 v0.1 的 S1-S6 覆盖 10 份 detailed blueprint + llm-wrapper dry-run(gate)+ 全量 back-write。v0.2 依据 GPT review 盲点 5-6 整改,收窄为 map + 2-3 代表 + optional dry-run。

- **[S1]** **Blueprint 模板定义**:一份 `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`,8 节固定结构(保留)
- **[S2 v0.2]** **1 份 absorption map**:`docs/design/pre-worker-matrix/W3-absorption-map.md`,含 **10 个 absorption units** 的映射表(覆盖 9 个 Tier B packages):每行含 (source unit → destination worker / 复杂度 / 主要依赖 / deprecated 时机 policy)。**轻粒度,不逐文件**。
- **[S3 v0.2]** **2-3 份代表性 detailed blueprint**(必,按 TEMPLATE):
  - 必写:`W3-absorption-blueprint-capability-runtime.md`(→ bash.core;capability surface / policy / honest-partial 纪律最集中 + bash.core 是独立 worker 角色主力)
  - 必写:`W3-absorption-blueprint-workspace-context-artifacts-split.md`(→ context.core + filesystem.core 的拆分决策;workspace-context-artifacts 内部要切)
  - 可选(推荐):`W3-absorption-blueprint-session-do-runtime.md`(→ agent.core;含 NanoSessionDO + DO class 吸收)
- **[S4 optional]** **Dry-run(optional,非 gate)**:
  - 若做:目标 = `capability-runtime`(不是 llm-wrapper,v0.2 调整)
  - 如果执行:在 `workers/bash-core/src/` 建吸收代码;保留 `packages/capability-runtime/`;跑绿 tests
  - 如果不执行:pattern spec 延到 worker-matrix P0 首次 absorb 回写
- **[S5]** **Pattern spec**:`docs/design/pre-worker-matrix/W3-absorption-pattern.md`,含:
  - 循环引用 3 类 pattern 的 placeholder(若无 dry-run,由 worker-matrix P0 回填)
  - LOC → 时长 经验系数(若有 dry-run 数据)
  - Test 迁移典型动作(generic)
  - deprecated 贴纸 wording + 时机
  - 共存期管理纪律
- **[S6]** **W3 closure memo**:`docs/issue/pre-worker-matrix/W3-closure.md`,含:
  - map 完成状态
  - 2-3 份代表 blueprint 完成状态
  - dry-run 结果(若做)
  - 7 份未写 detailed blueprint 的 handoff 指引(worker-matrix P0 现场写)
- **[S7 v0.2 删除]** ~~Back-write 10 份 blueprint~~ → 只有 2-3 份,无需大规模 back-write

### 5.2 Out-of-Scope(W3 不做)

- **[O1]** 实际搬迁其他 9 个 Tier B 包(那是 worker-matrix P0 全部工作)
- **[O2]** 删除任一 Tier B 原包(共存期内不删;即使执行 optional dry-run 也保留原包)
- **[O3]** 在 W3 期间提前给原包 README 加 deprecated 贴纸(按 §0.3 时机在 worker-matrix P0 对应 absorb 完成后加)
- **[O4 v0.2]** 为 2-3 份代表 blueprint **以外** 的 7 份 package 撰写 detailed blueprint(这些由 worker-matrix charter r2 的 P0 sub-phases 现场产出);以及为任何 blueprint 写 action-plan
- **[O5]** 自动 migration script / codemod
- **[O6]** 对其他 9 个包做 dry-run(blueprint 已足够)
- **[O7]** 修改任一 Tier B 包的 public API 或语义(若执行 optional dry-run,也仅允许位置复制与 import 调整,不改行为)
- **[O8]** 为 Tier B 包单独发版(它们不发布;见 W2)
- **[O9]** 把 `workers/*` 引入 workspace 作为 W3 的独立交付(W4 统一处理;W3 只在 dry-run 需要时使用 stub 目录)
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
| W3 完成后 optional dry-run 目标是否同时存在于 2 处 | **yes,故意** | 共存期;worker-matrix P0 对应 worker absorb 结束时再删原位置 |
| Blueprint 是否要给出 absorption 执行的确切 PR 顺序 | **no**(blueprint 描述"怎么搬",不规定"何时") | 顺序由 worker-matrix charter r2 决定 |
| 是否为 `context.core` 的 W3 blueprint 额外考虑 β 路线的 remote compact delegate | **blueprint 层面仅标注** | β 路线 compact delegate 的接线属于 worker-matrix P0 cross-worker integration;blueprint 只注明"context.core worker 必须消费 W1 `context.compact.*` 现有协议" |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1(v0.2 窄化)— 产 1 份 map + 2-3 份代表 blueprint,不写全 10 份 detailed blueprint**
   - **选择 map + 代表**,不是 **一份大综合 master plan**,也不是 **10 份逐包 detailed blueprint**
   - **为什么**:
     - Map 给 worker-matrix P0 完整 shopping list;代表 blueprint 给 pattern 样本
     - 写全 10 份 detailed = 新 phase(GPT review 盲点 5 指出)
     - 代表 blueprint 互不依赖(§3.3);worker-matrix P0 按 map 外推到其余包
     - 大综合文档会淹没具体细节
   - **接受的代价**:非代表包的 detailed blueprint 推给 worker-matrix P0 on-demand 补写;若 P0 执行某包时发现模板外推不够,要临时深化
   - **缓解**:pattern spec 作为 meta-index;map 显式标注每行"外推风险"(高/中/低),高风险项 P0 补写 detailed

2. **取舍 2(v0.2 调整)— Optional dry-run 目标选 `capability-runtime`,不选 llm-wrapper 也不强制做**
   - **候选比较**(v0.2 重评估):
     | 候选 | 源/测试 LOC | 跨 package 依赖 | 消费者数 | Platform seam | 代表性 | 适合度 |
     |---|---|---|---|---|---|---|
     | `capability-runtime` | ~2400 / ~3400 | 中(nacp / hooks) | 1(agent-runtime-kernel) | 有(bash.core seam) | **高**(覆盖 seam / 跨包 dep / policy 组合) | ★★★★★ |
     | `llm-wrapper` | 1090 / 1424 | 0(仅 peer zod) | 1 | 无 | 低 | ★★ |
     | `agent-runtime-kernel` | ~600 / ~400 | nacp-core | 1 | 低 | 中 | ★★★ |
     | 其他 | — | 各异 | — | — | — | — |
   - **选择 capability-runtime(if executed)**
   - **为什么**:v0.1 选 llm-wrapper 因零 dep 最干净,但 GPT review 盲点 6 指出"零 dep = pattern 样本无跨包 lessons",代表性过低;capability-runtime 有 seam + 跨包 dep,更能 battle-test pattern
   - **为什么 optional**:dry-run 本身 = 真正动代码;若时窗紧则作为 follow-on,不 block W3 closure
   - **接受的代价**:若不做,pattern spec 某些节(循环引用/seam 处理)无实证 lessons
   - **缓解**:pattern spec 节留 placeholder;worker-matrix P0 执行首个复杂包后回填

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
     - W3 期间其他 Tier B 包 absorb 还没做;deprecated 会误导 consumer(以为现在就不该用)
     - Optional dry-run(capability-runtime 若做)是验证,不代表"现在就不该用 capability-runtime"
     - 按包 absorb 进度逐个 deprecated 是最诚实的节奏
   - **接受的代价**:deprecated 时机与 W3 解耦;worker-matrix P0 执行者要记得在每包 absorb 完成时打 deprecated(但这个动作简单,贴纸模板在 pattern spec)

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|---|---|---|---|
| Optional capability-runtime dry-run 若不做,pattern spec 缺实证 | 时窗紧 → dry-run skip | pattern spec 某些节(循环引用/seam)无 lessons | §6.1 取舍 2 已提及;pattern spec 相关节留 placeholder;worker-matrix P0 首个复杂包执行后回填 |
| Blueprint 写作期间 Tier B 源代码变更 | 长时间写 blueprint | blueprint 过时 | Blueprint 基于"W3 启动日 repo snapshot";明确标注 `basis_commit: <sha>`;若源码重大变更,blueprint 需 revise |
| Map 外推到其余包失败(某包与代表 blueprint 差异过大) | 非代表包 special-case 多 | worker-matrix P0 就地深化 blueprint | §7.2 map 表含"外推风险"列;高风险项 P0 on-demand 补 detailed |
| 代表 blueprint 粒度不一致 | 不同作者写作风格差异 | worker-matrix P0 执行者困惑 | §7.2 T1 的 TEMPLATE 强制结构;每份代表 blueprint 必 fill 8 节 |
| W4 `workers/` 目录未就绪但 W3 optional dry-run 要用 | W3 与 W4 顺序 | dry-run 阻塞 | §7.3 T3 明确:若 W4 未完成,W3 dry-run 先建 `workers/bash-core/src/` stub 目录,细节保留给 W4 完善 |
| capability-runtime 内部对 nacp 有未觉察的依赖 | package.json 未列但代码 import | dry-run import resolve 失败 | §7.3 T3 第 1 步:`grep -r "@nano-agent" packages/capability-runtime/src packages/capability-runtime/test` 先审计 |
| 共存期发现需要 bugfix | 使用期间发现问题 | 要决定"在哪里修"(原包 or dry-run 新位置) | Pattern spec 明确:共存期 bug 修 **原包**(Tier B 包,因为 consumer 仍用它);若做了 dry-run 则 dry-run 代码同步 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己**:
  - worker-matrix P0 不再是"边设计边实装":map 给 trajectory,代表 blueprint 给样本,pattern spec 给方法论
  - Map 是可并行的 shopping list,team 可并行接包任务
- **对 nano-agent 长期演进**:
  - Pattern spec 形成"nano-agent 的包吸收方法论",未来若还有 absorption 场景(如某 worker 自己再拆分)可复用
  - Blueprint template 是一次性投入,终身复用
- **对"上下文管理 / Skill / 稳定性"深耕方向**:
  - 上下文管理:blueprint 清晰描述 context.core 接收哪些部分(snapshot/assembly/compact 等),worker-matrix P0 不会误收 filesystem 部分
  - Skill:未来 skill.core 若入场时需吸收其他包,可直接套用 W3 pattern
  - 稳定性:共存期 + 逐包 deprecated 纪律避免 "big bang 重构" 的系统性风险

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单(v0.2 narrower)

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|---|---|---|---|
| **T1** | Blueprint TEMPLATE | 8 节固定结构的 markdown 模板 | ✅ `TEMPLATE-absorption-blueprint.md` 可被代表性 blueprint 直接 copy-fill(后续 worker-matrix P0 现场写 blueprint 也用同一 template) |
| **T2 (v0.2)** | **Absorption map**(1 份)+ **代表性 detailed blueprint**(2-3 份)| map 为 10 行 package → destination 表(粗粒度);代表性 blueprint 针对 capability-runtime / workspace-context-artifacts-split / 可选 session-do-runtime | ✅ map + 2-3 blueprint shipped;其他 7 份不在本阶段 |
| **T3 (v0.2 optional)** | capability-runtime dry-run(非 gate) | 若 owner 决定做:真实搬 capability-runtime 到 `workers/bash-core/src/`,测试绿 | ✅ 若做:`workers/bash-core/src/` 有真实代码 + package-local tests green;**若不做:pattern doc 延后回写** |
| **T4** | Pattern spec | 基于 dry-run(若做)或 generic knowledge 的 pattern doc | ✅ generic 部分(deprecated wording / 共存期纪律)shipped;具体 pattern(循环引用 / LOC 系数)若无 dry-run 留 placeholder |
| ~~**T5**~~ | ~~Back-write~~ | **v0.2 删除** — 只有 2-3 份代表,无需大规模 back-write | N/A |
| **T6 (v0.2)** | W3 closure memo | 归档 | ✅ `W3-closure.md` 含 map + 2-3 代表 blueprint + dry-run 状态(完成或延后)+ 7 份未写 blueprint 的 worker-matrix P0 交接指引 |

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
     - 估算时长:若已有 dry-run 数据则引用其系数;否则给出人工 rough estimate
  
  ## §2. Files → Destination 映射表(逐文件)
     | src path | dest path | 动作(move/split/skip) | 备注 |
     |---|---|---|---|
     (每个 src 文件一行;split 的文件注明 section 拆分)
  
  ## §3. 跨 package 循环引用分析
     - 当前 import 扫描:`grep -r "import.*from" packages/<name>/src packages/<name>/test`
     - 跨包 import 清单(每条:源文件 → 目标包 → 具体 symbol)
     - 循环风险评估:
       - 低:如 leaf package(跨包 import 极少)
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
      - 原包内 shared protocol imports,absorb 后仍应指向 `@nano-agent/nacp-core` / `@nano-agent/nacp-session`
      - workers package-level resolution 可暂用 `workspace:*` 或 published version,由 W2/W4 当时状态决定
  
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
      - 本 blueprint 依赖:W0 完成、W1 RFC 可读、W4 目录就绪;W2 只需 skeleton 就绪(首发可选)
     - 本 blueprint 被谁依赖:worker-matrix P0 的 `<worker>` absorption sub-phase
     - Related pattern spec sections:(指向 pattern doc 的相关节)
  ```

- **一句话收口目标**:✅ **TEMPLATE 可 direct copy-fill;2-3 份代表 blueprint 作者按此产出;worker-matrix P0 按 map 外推到其余 Tier B 包时复用**

#### T2 (v0.2): Absorption map + 2-3 代表性 detailed blueprint

**Map(1 份,必做)**:
- 文件:`docs/design/pre-worker-matrix/W3-absorption-map.md`
- 内容:10 行表,每行 `(source package → destination worker / 粗粒度 LOC / 主要跨包依赖 / deprecated 时机 policy)`
- 规模:~1 页 markdown(100-150 行)

**Detailed blueprint(2-3 份,必做代表性高复杂度包)**:
- 必:`docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`(bash.core,capability surface / policy 纪律最集中)
- 必:`docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`(context.core + filesystem.core 拆分)
- 可选:`docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`(agent.core + DO class)
- 每份按 T1 TEMPLATE 8 节满填;~300-500 行 markdown
- **其他 7 份不在本阶段写**:由 worker-matrix P0 在对应 worker absorb 前现场撰写;W3 只要求 map 给出 destination / 复杂度 / 外推风险

- **一句话收口目标(v0.2)**:✅ **map + 2-3 blueprint shipped;7 份未写 blueprint 在 W3 closure memo 交接给 worker-matrix P0**

#### T3 (v0.2 OPTIONAL): capability-runtime Dry-Run(非 gate)

> **v0.2 说明**:dry-run 从 v0.1 gate 降为 v0.2 optional;若做,目标从 llm-wrapper 改为 capability-runtime(代表性高)。

- **前置条件(若做)**:W4 `workers/bash-core/` 目录创建
- **执行步骤(若做)**:
  1. **审计 import**:`grep -r "@nano-agent" packages/capability-runtime/` — 识别跨包依赖(期望发现 nacp-core / workspace-context-artifacts 引用);这些跨包 import 的解决 pattern 是 dry-run 的**主要 learning**
  2. **建 destination 目录**:`mkdir -p workers/bash-core/src workers/bash-core/test`
  3. **搬 source**:`cp -r packages/capability-runtime/src/* workers/bash-core/src/`(copy 不 move)
  4. **搬 test**:`cp -r packages/capability-runtime/test/* workers/bash-core/test/`
  5. **调 import**:`nacp-core` 引用改 `@<scope>/nacp-core`(若 W2 首发)或保持 `workspace:*`;workspace-context-artifacts 引用 — **这里会遇到 circular / cross-worker 依赖问题**,按 pattern doc §2 解决方案处理(dependency inversion / interface extraction / relocation)
  6. **build 验证**:`cd workers/bash-core && pnpm build`
  7. **test 验证**:`cd workers/bash-core && pnpm test`(目标是 package-local tests 全绿)
  8. **记录 lessons**:跨包依赖解决路径 + 实际 LOC + 实际时长 → 写 pattern doc(T4)
- **共存期**:`packages/capability-runtime/` 完全不动;共存
- **回归**:`pnpm -r run test` 全绿
- **一句话收口目标(v0.2 若做)**:✅ **workers/bash-core/src/ 有真实代码 + package-local tests 全绿;packages/capability-runtime/ 未改;主 regression 全绿;pattern doc 循环引用节已回写**
- **若不做**:pattern doc 的 LOC 系数 / 循环引用具体 pattern 保留 placeholder,等 worker-matrix P0 首次 absorb 回写

#### T4 (v0.2): Pattern Spec

- **文件**:`docs/design/pre-worker-matrix/W3-absorption-pattern.md`
- **v0.2 必含节**(若有 dry-run 则数据充实;若无 dry-run 则 generic 部分先写,placeholder 留给 P0):
  1. **背景**:capability-runtime dry-run lessons(若做)或 generic pattern description
  2. **循环引用解决 pattern**(若做 dry-run,基于实测;若不做,留 placeholder)
  3. **LOC → 时长 经验系数**(若做 dry-run,基于 ~3500 source + ~4000 test LOC 实测;若不做,留 placeholder)
  4. **Test 迁移典型动作**:generic(vitest config / fixture / mock 处理)
  5. **Deprecated 贴纸标准 wording**(templating,不依赖 dry-run):
     ```markdown
     # ⚠️ DEPRECATED — Absorbed into `workers/<dest>/`
     
     This package's logic has been absorbed into `workers/<dest>/src/...` as part
     of worker-matrix Phase <X>. New development should happen in the worker, not
     here. This package will be removed at the end of worker-matrix phase.
     
     **Migration pointer**: see `docs/design/pre-worker-matrix/W3-absorption-blueprint-<name>.md`.
     ```
  6. **共存期管理纪律**(generic):bug 修原包 / CHANGELOG 双写 / CI 双跑
  7. **Workspace 配置**:pnpm-workspace.yaml 同时 include `packages/*` + `workers/*`
  8. **PR 流水线**:每个 absorption PR checklist
- **一句话收口目标(v0.2)**:✅ **pattern doc generic 节 shipped;具体 pattern 若有 dry-run 则实装,若无则 placeholder + P0 回写指引**

#### ~~T5: Back-write~~ (v0.2 DELETED)

v0.2 删除 — 只有 2-3 份代表 blueprint,不需要大规模 back-write;LOC/时长字段在 blueprint 撰写时已基于 dry-run 数据(若有)或 generic 估算。

#### T6: W3 Closure Memo

- **文件**:`docs/issue/pre-worker-matrix/W3-closure.md`
- **必含(v0.2)**:
  - Absorption map 清单(1 份表)+ 其 10 行条目的完成状态(每行含 destination / LOC / 外推风险)
  - 2-3 份代表 blueprint 的清单 + 完成状态
  - Optional capability-runtime dry-run 状态:若做,实际 diff 大小 + test 结果 + 时长;若不做,明确 skip 理由
  - Pattern spec 归档点
  - 遗留 open question(如"pattern spec 的循环引用节需等 worker-matrix P0 第一个复杂包回填"、"7 份未写 detailed blueprint 的外推 risk 列表")
  - worker-matrix P0 消费者 checklist(它们拿到 W3 产出应该能直接开跑)
- **一句话收口目标**:✅ **closure 可被 worker-matrix charter r2 作者直接消费;dry-run skip/done 状态明确**

### 7.3 非功能性要求

- **Blueprint 可读性**:non-expert 读者应能读懂某份代表 blueprint 的 intent(不需要读完 pattern spec 就能理解)
- **Blueprint 可执行性**:worker-matrix P0 执行者应能只读 map + 代表 blueprint + pattern spec 就能完成 absorb(代表包直接执行,非代表包按 pattern 外推 + 必要时 on-demand 补 detailed)
- **Dry-run 可验证性(若做)**:W3 closure 应含可 re-run 的 dry-run 步骤(若需回归验证);若不做则 closure 明确 skip 理由
- **Pattern 可复用性**:pattern doc 应对未来类似场景(skill.core 入场等)仍然可用

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nano-agent 自己的先例

| 位置 | 内容 | 借鉴点 |
|---|---|---|
| `docs/issue/after-foundations/B9-final-closure.md` | B9 tenancy 吸收的 closure memo | W3 closure memo 的结构模板 |
| `packages/nacp-core/src/tenancy/` | B9 吸收后的目标目录 | `workers/<name>/src/llm/` 等目的地的命名类比 |
| `docs/plan-pre-worker-matrix.md` §1.3 | 10 包 → workers/ 的映射表 | blueprint §2 的源 mapping |

### 8.2 来自 capability-runtime / workspace-context-artifacts 的代表性锚点

| 位置 | 内容 | 借鉴点 |
|---|---|---|
| `packages/capability-runtime/src/tool-call.ts` | `tool.call.*` body bridge | bash.core 代表 blueprint 的协议锚点 |
| `packages/capability-runtime/src/capabilities/{filesystem,search,text-processing,network,vcs,exec}.ts` | fake-bash handler 家族 | bash.core 吸收时的 file-level grouping 参考 |
| `packages/capability-runtime/src/capabilities/workspace-truth.ts` | `WorkspaceNamespace` 依赖边界 | 从本地 workspace truth 走向 future authority split 的关键 seam |
| `packages/workspace-context-artifacts/src/{compact-boundary,snapshot}.ts` | context 侧 snapshot / compact seam | context.core 代表 blueprint 的主要锚点 |
| `packages/workspace-context-artifacts/src/{mounts,namespace,backends/*}.ts` | filesystem 侧 mount / namespace / backend | filesystem.core 代表 blueprint 的主要锚点 |
| `packages/workspace-context-artifacts/src/evidence-emitters.ts` | evidence helper 与 schema 混居 | 需要在 split blueprint 中明确 residual 分配 |

### 8.3 来自 Strangler Fig Pattern / 软件迁移文献

- Martin Fowler 的 "Strangler Fig" 博文 — 软件迁移经典
- "Feature Flag + Gradual Rollout" pattern(虽然 W3 不用 feature flag,但"新旧并存"思维相同)

### 8.4 需要避开的反例

| 做法 | 问题 | 我们为什么避开 |
|---|---|---|
| 一次 mega PR 搬 10 包 | 风险爆炸 + review 不可能 | W3 只 dry-run 1 个;worker-matrix P0 按 blueprint 分批 |
| blueprint 精确到 line 级 | 代码每天变 | W3 blueprint 到 file 级 |
| dry-run 删除原包 | 破坏共存期纪律 | §0.3 明确 optional dry-run 也必须保留原包 |
| 在 W3 期间加所有 deprecated 贴纸 | Consumer 误解"现在不该用" | §6.1 取舍 5 明确 deprecated 时机 |
| 写 auto-migration script | 每包循环引用不同;脚本化失败率高 | §3.1 精简 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

W3(v0.2)是 **"设计桥梁 — map + 代表样本"** phase:

- **存在形式**:1 份 TEMPLATE + 1 份 absorption map + 2-3 份代表 detailed blueprint + 1 份 pattern spec + (optional)1 份 capability-runtime dry-run(真实代码)+ 1 份 closure memo
- **覆盖范围**:Tier B 全部包的 absorption map(粗粒度);2-3 代表包的 detailed blueprint;optional capability-runtime 真实搬迁样本
- **耦合形态**:
  - 与 W0 强耦合(blueprint 引用 W0 已吸收的 nacp-core path)
  - 与 W1 弱-中耦合(代表 blueprint 可引用 W1 RFC;W1 RFC-only 无 code)
  - 与 W2 中耦合(blueprint 假设 `workspace:*` OR `@<scope>/nacp-core` 任一 import path)
  - 与 W4 强耦合(若做 dry-run 需要 `workers/bash-core/` 目录存在;若 W4 晚,dry-run 先建 stub)
  - 与 worker-matrix P0 强耦合(直接消费 map + 代表 blueprint + pattern spec)
- **预期代码量级**:
  - TEMPLATE:~100 行 markdown
  - Absorption map:~100-150 行 markdown
  - 2-3 份代表 blueprint:~900-1500 行 markdown 合计(每份 300-500 行)
  - Pattern spec:~400-600 行
  - Optional dry-run 真实代码(若做):~2400 src + ~3400 test LOC(copy,不是新写)
  - Closure memo:~100 行
- **预期复杂度**:中 — blueprint 书写需要仔细的代码审计;dry-run(若做)有跨包 dep 风险,需按 pattern 处理

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
  - §6.1 取舍 1(v0.2 窄化 — map + 2-3 代表 blueprint,非 10 份 detailed)是否接受?
  - §6.1 取舍 2(v0.2 — optional dry-run 目标 = capability-runtime;不强制执行)是否接受?
  - §6.1 取舍 4(共存期 ~3 个月)是否接受?
  - §6.1 取舍 5(deprecated 贴纸在 worker-matrix P0 该 worker absorb 完成时加)是否接受?
  - §5.3 边界清单中 `workspace-context-artifacts` 拆 2 份 blueprint 是否接受?
  - §5.3 边界清单中 `evidence-emitters.ts` 的 emit helpers 归 agent.core(非 context.core)是否接受?
- [ ] **关联 action-plan**:`docs/action-plan/pre-worker-matrix/D4-absorption-blueprint-and-dryrun.md`(T1-T4/T6 的批次化执行;T5 已删)
- [ ] **关联 TEMPLATE 产出**:`docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`(T1 交付)
- [ ] **关联 Pattern spec 产出**:`docs/design/pre-worker-matrix/W3-absorption-pattern.md`(T4 交付)
- [ ] **关联 Map 产出**:`docs/design/pre-worker-matrix/W3-absorption-map.md`(T2 交付)
- [ ] **关联 2-3 代表 blueprint 产出**:`docs/design/pre-worker-matrix/W3-absorption-blueprint-{capability-runtime,workspace-context-artifacts-split,session-do-runtime}.md`(T2 交付;第 3 份可选)
- [ ] **依赖下游**:
  - W4 `workers/bash-core/` 目录创建(T3 若执行 dry-run 需要;若 W4 慢,T3 建 stub)
- [ ] **待深入调查的子问题**:
  - capability-runtime 的跨包 dep 具体集合?(T3 第 1 步审计验证,若做 dry-run)
  - `workspace-context-artifacts` 内部 `evidence-emitters.ts` 的 emit helpers 具体含哪些函数?(`workspace-context-artifacts-split.md` blueprint 需要列出)
  - `hooks` package 去掉 W0 已搬的 catalog vocabulary 后,还剩多少 runtime 代码?(map 行注释 + P0 现场补 blueprint 时核查)
  - `storage-topology` 去掉 W0 已搬的 keys/refs 后,还剩的 adapters + placement + calibration 的 LOC(map 行注释)

---

## 附录

### A. 讨论记录摘要

- **分歧 1**:W3 是否必须做 dry-run,而非纯 blueprint
  - **Opus 倾向(v0.1)**:必须 dry-run 1 个
  - **v0.2 调整**:dry-run 降为 optional;做或不做都有明确处理路径
  - **当前共识(v0.2)**:optional(§0.2 + §6.1 取舍 2)
- **分歧 2**:dry-run 目标选择(若做)
  - **候选**:llm-wrapper / capability-runtime / agent-runtime-kernel / eval-observability
  - **v0.1 倾向**:llm-wrapper(零跨包 dep 最干净)
  - **v0.2 调整**:capability-runtime(代表性高;GPT review 盲点 6 指出零 dep 代表性不足)
  - **当前共识(v0.2)**:capability-runtime(§6.1 取舍 2)
- **分歧 3**:blueprint 粒度
  - **候选**:per-line / per-file / per-module
  - **Opus 倾向**:per-file(§6.1 取舍 3)
  - **当前共识**:per-file
- **分歧 4**:共存期长度
  - **候选**:1 个月 / 3 个月 / 永久
  - **Opus 倾向**:3 个月(§6.1 取舍 4)
  - **当前共识**:~3 个月

### B. 开放问题清单

- [ ] **Q1**:`packages/capability-runtime/package.json` 的 inter-workspace `@nano-agent/*` dep 集合?(T3 第 1 步审计,若做 dry-run)
- [ ] **Q2**:pnpm-workspace.yaml 是否需要 `include workers/*`(W4 会处理,但 W3 optional dry-run 先建 `workers/bash-core/` 时需确认 workspace 识别)
- [ ] **Q3**:原包 `packages/capability-runtime/` 在 optional dry-run 期间是否需要改 CHANGELOG?(建议:不改,直到 worker-matrix P0 bash.core absorb 完成时在原包 CHANGELOG 加 "deprecated in favor of workers/bash-core" entry)
- [ ] **Q4**:dry-run 的 `workers/bash-core/src/` 是否需要单独 vitest.config.ts?(若 W4 未给,W3 临时内置一份)
- [ ] **Q5**:`workspace-context-artifacts` 拆 2 份 blueprint 后,共享依赖(如 types / utils)归哪一份?(建议:抽共用 interface 到 nacp-core,但若量小可 duplication;blueprint 写作时决定)
- [ ] **Q6**:worker-matrix P0 是否强制"必须读完 pattern spec 才能开始 absorption PR"?(推荐 yes;纪律由 worker-matrix charter r2 制定)
- [ ] **Q7**:若 worker-matrix P0 执行期间发现某份代表 blueprint 有误,修 blueprint 还是就地调整?(建议:小误就地调整 + 回写 blueprint;大误停下来 revise blueprint,避免偏离)

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|---|---|---|---|
| v0.1 | 2026-04-21 | Claude Opus 4.7 | 初稿:T1-T6 功能 + 6 个 tradeoff + 10 blueprint 目录 + llm-wrapper dry-run 步骤 + pattern doc 结构 |
| v0.2 | 2026-04-21 | Claude Opus 4.7 | Post-GPT-review narrowing(顶部/§0/§5.1 In-Scope/§7.1 T-table/§7.2 T2-T5):收窄为 **1 份 absorption map + 2-3 份代表性 detailed blueprint + dry-run 可选**;若做 dry-run,目标从 llm-wrapper 改为 capability-runtime |
| **v0.3** | 2026-04-21 | Claude Opus 4.7 | Post-GPT-R4 body-level narrowing(GPT 指出 v0.2 顶部改完但正文 §2.2/§2.3/§3/§4/§6/§7.3/§9/附录 仍 v0.1):<br/>• 标题改为 "Absorption Map + Representative Blueprints + Optional capability-runtime Dry-Run"<br/>• §2.2 interaction matrix 改:llm-wrapper dry-run 目标改 capability-runtime optional;10 包执行改 map + 外推;W1 强耦合改 弱-中<br/>• §2.3 一句话定位重写为 map + 2-3 代表 + optional dry-run<br/>• §3.1 精简表:去除 "额外 9 个 dry-run",新增 "逐份写 detailed blueprint"被砍;3.2 接口表:LOC / 时长字段描述改 capability-runtime / map 外推<br/>• §3.3 解耦点:10 份改 2-3 份;dry-run 落点 workers/agent-core/src/llm/ 改 workers/bash-core/src/<br/>• §3.4 聚合点:pattern doc 改 pattern spec;10 份改 2-3 份<br/>• §4.2 Strangler Fig:dry-run 期间保留 llm-wrapper 改 capability-runtime optional<br/>• §4.3 monorepo:llm-wrapper 换家改通用"被 absorb 的 Tier B 包"<br/>• §4.4 对比表:Blueprint 先行 / Dry-run 两行 narrower<br/>• §6.1 取舍 1 重写(map+ratio vs 10 份 detailed);取舍 2 重写(capability-runtime vs llm-wrapper,optional 化);取舍 5 小改<br/>• §6.2 风险表:llm-wrapper 过简 改 capability-runtime skip;10 粒度不一致 改 2-3 粒度;W4 目录 stub 改 bash-core<br/>• §6.3 价值:10 份 shopping list 改 map + 代表<br/>• §7.2 T1 收口目标 / T6 closure memo 逐条更新为 map + 代表 + optional dry-run<br/>• §7.3 非功能:blueprint 可读性 / 可执行性 / dry-run 可验证性 全部 narrower<br/>• §9.1 画像 + 代码量级 narrower<br/>• §9.3 下一步:决策确认 / 关联链接 / 深入调查 全部 narrower<br/>• 附录 A 分歧 1-2 加 v0.1/v0.2 时间线;附录 B Q1-Q7 改 capability-runtime / bash-core / pattern spec<br/>**净效果**:全文与 v0.2 顶部完全一致;无残留 "10 份 blueprint / llm-wrapper dry-run / 强制 gate" 表述(除历史版本记录外) |

### D. 修订综述

**v0.2 核心调整**:区分 "必要的 absorption 指引"(map)与 "可选的 pattern 样本"(dry-run)。

- **Map 是 worker-matrix P0 启动的必要输入** — 告诉 executor "哪个包去哪个 worker"
- **2-3 份 detailed blueprint** 覆盖**高复杂度代表包**,给 executor 以最难场景的参考
- **Dry-run 是可选的 pattern 样本** — 若做,用 capability-runtime 作 substantive case;若不做,pattern doc 由 worker-matrix P0 首次 absorb 时回写

**未覆盖的 7 份 detailed blueprint**:它们的撰写时机不是"W3 gate",而是"worker-matrix P0 开始 absorb 该 worker 前的 natural prep"。worker-matrix charter r2 的 P0 sub-phase 规划时,每个 worker 的 P0.X 可以先写 detailed blueprint,再 execute。这降低了 pre-phase 的文档负担,保持 worker-matrix P0 的执行节奏。

**对 charter r2 §11 exit criteria 的支持**:原 r1 第 5 条"10 份 blueprint + owner glance-pass"已被 charter r2 第 2 条"包策略已冻结(Tier B 吸收映射表已存在)"替代。本 W3 对应到新 exit 第 2 条。
