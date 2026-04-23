# D09 — Tier B packages 的 per-worker `DEPRECATED` 协议

> 功能簇: `worker-matrix / tier-b-deprecation`
> 讨论日期: `2026-04-23`
> 讨论者: `Claude Opus 4.7 (1M context)`
> 关联调查报告:
> - `docs/plan-worker-matrix.md` §3 I12、§5.3 P5.B、§6.5 P5 DoD、§7 Q6(confirmed `(c) per-worker absorb-stable`)
> - `docs/plan-worker-matrix-reviewed-by-GPT.md` §5.6
> - `docs/design/pre-worker-matrix/W3-absorption-pattern.md` §8 Pattern 7 deprecated timing 纪律
> - `docs/design/pre-worker-matrix/W3-absorption-pattern.md` §5 Pattern 4(capability-runtime 等)
> 文档状态: `draft`

---

## 0. 背景与前置约束

随着 D01-D04 按 P1-P4 节奏完成,对应的 Tier B packages(9 个)会相继进入 "吸收已完成 + worker 侧 runtime 稳定" 状态。本设计负责把这些 Tier B packages 的 `DEPRECATED` banner 打法、CHANGELOG wording、物理删除触发条件等,**按 per-worker 节奏** 统一定义。

charter Q6c 明确:**per-worker 逐个打 deprecated** — 最诚实(吸收稳定了再贴,避免误伤消费者),最不 silent(不等到最后统一贴导致 "吸收完成但 repo 口径仍旧")。

**物理删除**(`rm -rf packages/<name>`)**不** 在本阶段执行 — 遵守 W3 pattern §7 "deprecated banner 不等于物理删除" 与 charter §3.2 O4 "Tier B packages 物理删除属后续阶段"。

- **项目定位回顾**:Tier B packages 是 "验证 + 吸收上下文",随 worker 成熟 phase out;但 phase out 有节奏 — **banner → 保留共存 → 下一阶段删除**。
- **本次讨论的前置共识**:
  - 9 个 Tier B packages:`agent-runtime-kernel / capability-runtime / context-management / eval-observability / hooks / llm-wrapper / session-do-runtime / storage-topology / workspace-context-artifacts`(一 workspace 内部 scope `@nano-agent/*`,不走 GitHub Packages)
  - banner timing = per-worker absorb-stable(Q6c)
  - 物理删除 = 下一阶段
  - CHANGELOG 每个 deprecated PR 同 commit 更新;**对缺 `CHANGELOG.md` 的包**(`agent-runtime-kernel` / `capability-runtime`)允许 README-only deprecation 或 minimal CHANGELOG stub(见 §1.1 关键术语对齐)
  - NACP 2 包(`nacp-core / nacp-session` → `@haimang/*`)**不** deprecated(它们是永久外部包)
- **显式排除的讨论范围**:
  - NACP 2 包的任何 deprecation(否;它们永久)
  - 物理删除 Tier B(下一阶段)
  - Tier B 在 absorb 完成后改 scope 或 name
  - 产品侧 external consumer notification(目前 Tier B 本就不是外部包)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`Tier B per-worker DEPRECATED banner protocol`
- **一句话定义**:定义 9 个 Tier B packages 的 `DEPRECATED` banner 何时打、怎么打、CHANGELOG 怎么写;触发器是对应 worker 的 absorb-stable 状态;物理删除不在本阶段。
- **边界描述**:
  - **包含**:deprecation 触发条件(absorb-stable 判定)、per-package banner wording(README.md 顶部 + CHANGELOG)、`package.json` 的 `deprecated` 字段处理、per-worker 时机(D09 与 P1-P4 对应 phase 交叉)、物理删除延迟
  - **不包含**:物理删除、scope 切换、NACP 2 包 deprecation、product-level notification
- **关键术语对齐**:

| 术语 | 定义 |
|------|------|
| Tier B packages | 9 个 workspace-only packages(非 NACP)|
| absorb-stable | 对应 D01/D02/D03/D04 的 absorb PR 已 merge + agent-core live loop 稳定 + 至少 1 个 P2-P4 e2e 已绿跑 |
| DEPRECATED banner | `README.md` 顶部 `> ⚠️ DEPRECATED — Absorbed into workers/<dest>/` block |
| CHANGELOG entry | `CHANGELOG.md` 新增 `## [DEPRECATED] - YYYY-MM-DD` block。**当前仓库有 `CHANGELOG.md` 的包**:`session-do-runtime / hooks / eval-observability / storage-topology / workspace-context-artifacts / context-management / llm-wrapper`(7 个);**缺 `CHANGELOG.md` 的包**:`agent-runtime-kernel / capability-runtime`(2 个)。对缺的包:允许 **README-only deprecation**(不强制补历史 changelog),PR body 记录 "no CHANGELOG" reason;或者同一 PR 创建一个 **minimal CHANGELOG stub**(只含当次 `[DEPRECATED]` entry),二选一由 PR author 选择并在 PR body 注明 |
| 物理删除 trigger | 下一阶段,基于 "共存期 ~3 个月 + consumer 全部切 + 至少一个 production release 的稳定期" |
| `package.json.deprecated` | npm 字段;Tier B 不发布,因此 **不设** 该字段(避免误导)|

### 1.2 参考调查报告

- `docs/design/pre-worker-matrix/W3-absorption-pattern.md` §7 Pattern 6 共存期 + §8 Pattern 7 deprecated timing
- 各 `packages/<name>/README.md` 与 `CHANGELOG.md`(若存在)
- `docs/plan-worker-matrix-reviewed-by-GPT.md` §5.6 Q6 回答
- charter §6.5 P5 DoD

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**:release hygiene 的第二部分 — Tier B 生命周期诚实标注
- **服务于**:开发者认知(明确 "这个包已经迁到 worker")、charter exit primary #4
- **依赖**:D01-D04 各自 absorb PR 已 merge + absorb-stable 判定成立
- **被谁依赖**:下一阶段(物理删除) 的 trigger 引用

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| D01 agent-core absorption | 上游 | 强 | A1-A5 吸收的 5 packages(session-do-runtime / agent-runtime-kernel / llm-wrapper / hooks / eval-observability)在 D01 完成 + P2 e2e 稳定后贴 banner |
| D02 bash-core absorption | 上游 | 强 | B1 吸收的 capability-runtime 在 D02 + P2 e2e 稳定后贴 banner |
| D03 context-core absorption | 上游 | 强 | C1 吸收的 context-management + C2 slice 稳定后贴 banner(WCA 是 split;见 §5.3 边界清单)|
| D04 filesystem-core absorption | 上游 | 强 | D1 slice + D2 storage-topology 稳定后贴 banner(WCA 共用 with D03;split banner 纪律)|
| D08 published path cutover | 并行 P5 | 弱 | D08 改 NACP 依赖(不动 Tier B);D09 改 Tier B banner(不动 NACP)|
| 下一阶段物理删除 charter | 下游 | 强 | 本设计定义 trigger |

### 2.3 一句话定位陈述

> "在 nano-agent 里,`Tier B deprecation protocol` 是 **worker-matrix P5 的 release hygiene 交付物之一**,负责 **per-worker 逐个把 9 个 Tier B packages 的 README / CHANGELOG 打上 DEPRECATED banner,并明确物理删除 trigger 不在本阶段**,对上游(charter exit primary #4)提供 **吸收真相的诚实标注**,对下游(下一阶段物理删除)要求 **清晰的共存期 + trigger 列表**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点

| 被砍项 | 来源 | 砍的理由 | 未来回补 |
|--------|------|----------|----------|
| absorb PR merge 当日就打 banner(Q6a)| 原 v0.1 | charter Q6c;过早贴误伤 | 否 |
| P5 统一一次打(Q6b)| 原 v0.1 | 吸收稳定节奏不同;统一会让 "吸收已完成但 repo 仍旧" | 否 |
| 物理删除放 D09 内 | 对称 | charter O4;保持共存期纪律 | 否(下一阶段) |
| Tier B 发 patch version 发 npm | 对称(与 NACP 对照)| Tier B 不发布到 registry | 否 |
| 在 `package.json` 设 `deprecated` npm 字段 | npm 惯例 | Tier B 不发布 | 否 |
| 跨 worker 共用同一份 CHANGELOG entry | 省事 | 每个 package 独立 CHANGELOG | 否 |
| WCA split 的两份 banner 合并成一份 | 省事 | WCA 被 split 成 C2 + D1;每个 "half" 在各自 target worker 稳定后可 partial-banner,但真 banner 贴在 WCA 包(一次)= 当 C2 **和** D1 都稳定 | 见 §5.3 |

### 3.2 接口保留点

| 扩展点 | 表现形式 | 第一版行为 | 未来演进 |
|--------|----------|------------|----------|
| Banner template | 统一 markdown 片段 | per-package 按同一模板填 | 未来物理删除时,banner 替换为 "Removed" |
| CHANGELOG entry | per-package `## [DEPRECATED] - YYYY-MM-DD` | 每个 deprecate PR 添加 | 下一阶段物理删除 PR 加 `[REMOVED]` entry |
| 物理删除 trigger reference | 本设计 §5 edge + 下一阶段 charter 引用 | "共存期 ~3 个月 + production release 稳定后" | 可由 release charter 精化为具体日期条件 |

### 3.3 完全解耦点

- **解耦对象**:D09 PR × N(N = 9 个 Tier B,按 absorb-stable 顺序一个一个贴)
- **解耦原因**:per-worker 节奏;不同 package 到 absorb-stable 时间不同
- **依赖边界**:每个 deprecation PR 只 touch **1 个 package** 的 README.md + CHANGELOG.md;不互相依赖

### 3.4 聚合点

- **聚合对象**:统一的 banner template + CHANGELOG wording convention
- **聚合形式**:本设计 §7 F1 给出 template;所有 deprecation PR 复用
- **为什么不能分散**:template 不一致会让 consumer reader 困惑 "这个 deprecated 是同一回事吗?"

---

## 4. 三个代表实现对比(内部 precedent)

### 4.1 W3 pattern spec §8

- **实现概要**:pattern 明确 "deprecation 贴纸不是 pre-worker-matrix 的工作";"真正加 DEPRECATED 的时点,应是 worker-matrix 中该 worker 完成真实吸收、consumer path 已切换之后"
- **借鉴**:本设计严格继承 "吸收稳定后再贴";共存期 + consumer 切换并未要求 worker-matrix 内完成,所以本设计把 trigger 收窄为 "absorb + P2-P4 e2e 稳定"
- **不照抄**:pattern 没给具体 template;本设计 F1 给模板

### 4.2 B9 tenancy absorb 后无 banner

- **实现概要**:B9 把 `tenant*` 搬到 nacp-core,但 Tier B 原位置的 tenant 代码**没有**加 DEPRECATED(直接 cut-over + re-export)
- **借鉴**:shipping discipline 不迁就 npm deprecation 语义
- **不照抄**:B9 是 Tier A subdirectory 聚合;本设计是 Tier B → workers 搬家 + 共存期 banner

### 4.3 npm 标准 deprecation pattern

- **实现概要**:`npm deprecate <pkg>@<ver> "<message>"` 会在 npm registry 标 deprecated
- **借鉴**:banner wording 参考 "Use `<new>` instead"
- **不照抄**:Tier B 不发布;不用 `npm deprecate`;banner 只走 README + CHANGELOG + 不设 `package.json.deprecated`

### 4.4 横向对比

| 维度 | W3 pattern §8 | B9 cut-over | npm deprecate | **D09** |
|------|---------------|-------------|---------------|---------|
| 范围 | 纪律文字 | 代码聚合 | npm registry 层 | **Tier B README + CHANGELOG** |
| 时机 | "worker absorb 完成 + consumer 切换后" | 合并当日 | 单次 cli | **absorb-stable per-worker** |
| 是否发布 | n/a | n/a | 是 | **否(Tier B 不发)** |
| 回滚 | n/a | revert | `npm undeprecate` | **revert README/CHANGELOG** |

---

## 5. In-Scope / Out-of-Scope

### 5.1 In-Scope

- **[S1]** 定义 **absorb-stable** 判定条件(per package):
  - 对应 D01-D04 absorb PR 已 merge
  - `workers/<dest>/src/` 内运行 `workers/<dest>/test` 全绿
  - P2 live loop(至少 agent↔bash + initial_context)e2e 跑绿一次
  - 无 reverted / rollback 现象
- **[S2]** 定义 **Banner template**(markdown):
  ```markdown
  # ⚠️ DEPRECATED — Absorbed into `workers/<dest>/`

  This package's runtime has been absorbed into `workers/<dest>/src/...` as part
  of worker-matrix Phase P<N>. New development should happen in the worker, not
  here. This package will be physically removed in a later release charter.

  **Migration pointer**: see `docs/design/worker-matrix/D<xx>-<...>.md` and
  `docs/design/pre-worker-matrix/W3-absorption-blueprint-<...>.md`.

  **Why not removed yet**:共存期纪律(W3 pattern §2, §6)— 现有 consumer 尚未全部切换;
  物理删除由 `docs/plan-<next>.md` release charter 触发。
  ```
- **[S3]** 定义 **CHANGELOG entry convention**:
  ```markdown
  ## [DEPRECATED] - 2026-MM-DD

  This package is deprecated. Its runtime has been absorbed into `workers/<dest>/`
  as part of worker-matrix Phase P<N> (see `docs/design/worker-matrix/D<xx>`).
  Consumers should migrate to the worker. This package will be physically removed
  in a later release charter.
  ```
- **[S4]** per-package deprecation PR(N = 9):每个 PR 只动 **1 个** `packages/<name>/README.md` +(若存在)该 package `CHANGELOG.md`。**对缺 CHANGELOG 的 2 个包**(`agent-runtime-kernel` / `capability-runtime`)两种合法形态(PR author 任选):(a) **README-only deprecation**(PR body 注明 "no CHANGELOG — README banner is the single source of truth"),或 (b) **minimal CHANGELOG stub**(PR 同 commit 新建 `CHANGELOG.md`,仅含 `## [DEPRECATED] - YYYY-MM-DD` 一个 entry,无历史)。两种形态在 §5 protocol 下都合法,不先补完整历史 changelog 才 deprecate
- **[S5]** deprecation 顺序建议:
  - **第一批(P2 稳定后)**:`session-do-runtime`(A1)、`capability-runtime`(B1)
  - **第二批(P2 + agent-core 其他 A 吸收稳定后)**:`agent-runtime-kernel`(A2)、`llm-wrapper`(A3)、`hooks`(A4 — 注意 runtime residual;wire catalog 在 nacp-core 不 deprecate)、`eval-observability`(A5 — runtime residual)
  - **第三批(P3 稳定后)**:`context-management`(C1)
  - **第四批(P3 + P4 都稳定后)**:`workspace-context-artifacts`(C2+D1 split 全稳定 — WCA 是 split,两端都稳定才 banner)、`storage-topology`(D2)
- **[S6]** **不** 设置 `package.json.deprecated` npm 字段(避免误导;Tier B 不发布)
- **[S7]** NACP 2 包(`nacp-core` / `nacp-session`)**不** deprecated — 它们是永久外部包;D09 PR 明确范围不含它们
- **[S8]** 物理删除 trigger 文档化:下一阶段 charter 的条件至少包含:
  - 共存期 ≥ 3 个月(P2-P4 merge 日起算)
  - 无 consumer 仍 import `@nano-agent/<pkg>`(grep verify)
  - 至少 1 次 production release 稳定期

### 5.2 Out-of-Scope

- **[O1]** 物理删除 `packages/<name>`(下一阶段)
- **[O2]** NACP 2 包 deprecation(否)
- **[O3]** `npm deprecate` CLI 调用(Tier B 不发布)
- **[O4]** Tier B scope 改名
- **[O5]** 任何 Tier B 的 source 改动
- **[O6]** external consumer notification(Tier B 本就不是外部包;Tier B 没有 external consumer)
- **[O7]** deprecation 顺序 forcing(每个 package 按自己 absorb-stable 到达时间贴 banner;先后不是 strict lockstep)

### 5.3 边界清单

| 项目 | 判定 | 理由 |
|------|------|------|
| `workspace-context-artifacts` 何时贴 banner | **C2(context)+ D1(filesystem)都稳定之后一次贴** | 防止半 banner;两端共享一份 README |
| `hooks` 的 wire vocabulary(已在 nacp-core)与 runtime(packages/hooks)| banner 只针对 runtime residual;不影响 nacp-core | W0 已分层 |
| `eval-observability` 的 wire(已 nacp-core)| 同上 | — |
| `nacp-core / nacp-session` | `out-of-scope`(永不 deprecate) | 永久外部包 |
| banner 加在所有 sub-package(若 Tier B 内有子目录 package)| `in-scope if applicable` | 实测 Tier B 均是单包 |
| 打 banner PR 内同时 bump `version` | `out-of-scope` | Tier B 不发布;bump 无意义 |
| 打 banner 后立即禁止在 package 内改 code | `out-of-scope` | 共存期 bug 仍先修原包(W3 pattern §6)|
| D09 PR merge 后在 github commit message 自动打 banner hash | `out-of-scope` | 不需要 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**:per-worker absorb-stable 触发(Q6c)而非 P5 统一 / absorb PR 当日
   - **为什么**:吸收节奏不同步;per-worker 触发最诚实
   - **代价**:9 个 deprecation PR,节奏各异
   - **缓解**:每个 PR 极小(README + CHANGELOG);模板统一

2. **取舍 2**:**不** 物理删除(本设计只贴 banner)
   - **为什么**:共存期 + consumer 尚未全切;W3 pattern §2
   - **代价**:repo 内 Tier B 与 workers/ 并存 ~3 个月
   - **缓解**:CHANGELOG entry 明确物理删除在下一阶段

3. **取舍 3**:WCA 只贴一次 banner(C2+D1 都稳定时)
   - **为什么**:两端共享一份 README;半 banner 语义混乱
   - **代价**:`workspace-context-artifacts` 的 deprecation 比其他 Tier B 慢
   - **缓解**:在 P4 结束时触发;CHANGELOG 明示 "C2 吸收进 workers/context-core;D1 吸收进 workers/filesystem-core"

4. **取舍 4**:不设 `package.json.deprecated`
   - **为什么**:Tier B 不发布;npm 字段无用
   - **代价**:外部工具(若有)无法读 npm 标
   - **缓解**:Tier B 不是 external;README + CHANGELOG 足矣

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|------|----------|------|------|
| 贴 banner 后 consumer 误以为 "不能用" 立即删除本地引用 | banner wording 太强 | 共存期消费者突然切 | wording 明确 "保留 + 物理删除在下一阶段" |
| WCA 过早贴 banner(只 C2 稳定)| 节奏错 | 半吸收状态被标 deprecated | 严格 S3-S5:WCA 在 C2+D1 都稳定时贴 |
| 贴 banner PR 内误改 source | PR 范围扩大 | 共存期 bug 隐患 | PR review gate:PR 只允许改 README + CHANGELOG |
| hooks / eval-observability 的 wire vocabulary(在 nacp-core)被误一起 deprecate | 混淆 runtime residual 与 wire | nacp-core 混入错误 banner | D09 明确范围不含 nacp-core;PR 内不修 `@haimang/nacp-*` |
| deprecation 顺序被误强制 lockstep | review 误解 Q6c | 等慢的 package 拖延快的 | §5.1 明确 per-package trigger,各自 PR |

### 6.3 价值

- **对开发者自己**:repo 内 Tier B 状态 = "正在退役" 明确;避免 "吸收已做但包仍存,readers 不知状态"
- **对 nano-agent 长期演进**:为下一阶段物理删除提供触发器清单;诚实共存期
- **对 "上下文管理 / Skill / 稳定性" 杠杆**:
  - 稳定性:诚实标注 → 减少 silent drift;共存期消费者有明确迁移指引
  - Skill:skill.core 如未来入场,其相关 Tier B(目前无)可按同模板处理

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Banner template 固化 | 统一 markdown 模板 | ✅ 9 个 Tier B packages 的 README 顶部 banner 完全一致(structural fields) |
| F2 | CHANGELOG entry convention(+ no-CHANGELOG fallback)| 统一 entry 格式;对缺 CHANGELOG 的 2 个包允许 README-only 或 minimal stub | ✅ 7 个现有 CHANGELOG 的包:`[DEPRECATED]` block 结构一致;2 个缺 CHANGELOG 的包(`agent-runtime-kernel` / `capability-runtime`):PR body 记录走哪条路径(README-only / minimal stub)|
| F3 | absorb-stable 判定 checklist | 单 package 如何判断已稳定 | ✅ 每个 deprecation PR body 在 prerequisites 段引用该 checklist |
| F4 | per-package deprecation PR 序列(N=9)| 按 §5.5 顺序逐个 PR | ✅ 9 个独立 PR;各自 diff 极小 |
| F5 | WCA 半 banner 避免 | C2+D1 两端稳定后一次贴 | ✅ `workspace-context-artifacts` 的 banner PR 只发生一次 |
| F6 | 物理删除 trigger 文档化 | 写明下一阶段触发条件 | ✅ 本设计 §5 S8 + CHANGELOG entry 引用 |
| F7 | 不碰 NACP 2 包 | D09 不动 nacp-core / nacp-session | ✅ 9 PR 全部 grep:不含 `packages/nacp-core` / `packages/nacp-session` 任何 diff |

### 7.2 详细阐述

#### F1: Banner template 固化

- **输入**:§5.1 S2 的 markdown 模板
- **输出**:template 文件或在本设计 §5.1 S2 锁定
- **核心逻辑**:每个 deprecation PR 把 template 粘到对应 package `README.md` 顶部,替换 `<dest>` / `<N>` / `D<xx>` 占位符
- **边界情况**:WCA 的 `<dest>` 写成 "`workers/context-core/` (context slice) + `workers/filesystem-core/` (filesystem slice)" 双目的
- **一句话收口目标**:✅ **9 个 banner 结构一致;只填 dest / phase / design doc 三变量**

#### F2: CHANGELOG entry convention(+ no-CHANGELOG fallback,吸收 GPT R5)

- **输入**:§5.1 S3 + 当前仓库事实 — **7 个 Tier B 包有 `CHANGELOG.md`**(`session-do-runtime / hooks / eval-observability / storage-topology / workspace-context-artifacts / context-management / llm-wrapper`);**2 个缺 `CHANGELOG.md`**(`agent-runtime-kernel / capability-runtime`)
- **输出**:
  - 有 CHANGELOG 的 7 个:新 `[DEPRECATED]` block(`## [DEPRECATED] - YYYY-MM-DD` 开头)
  - 缺 CHANGELOG 的 2 个:PR author 任选:(a) **README-only deprecation**(PR body 注明 "no CHANGELOG — README banner is the single source of truth"),或 (b) **minimal CHANGELOG stub**(PR 同 commit 新建 `CHANGELOG.md`,仅含 `## [DEPRECATED] - YYYY-MM-DD` 一个 entry,不补历史 changelog)
- **核心逻辑**:
  - 时间 `YYYY-MM-DD` 取 PR merge 日;文字模板固定
  - **不强制**为缺 CHANGELOG 的包先补完整历史;`[DEPRECATED]` entry 是 audit trail 起点而非历史完整性保证
- **边界情况**:
  - 若 PR author 选择 minimal stub,PR body 标 "CHANGELOG created by this deprecation PR (stub-only)"
  - 若 PR author 选择 README-only,`README.md` banner 必须写 "no CHANGELOG — PR link is the audit trail anchor" 一行,明确 PR URL 为 audit anchor
- **一句话收口目标**:✅ **7 个有 CHANGELOG 的包首条是 DEPRECATED entry;2 个缺 CHANGELOG 的包走 README-only 或 minimal stub 其一,不被 "先补历史 changelog" 卡住**

#### F3: absorb-stable 判定 checklist

- **输入**:本设计 §5.1 S1 条件
- **输出**:每个 deprecation PR body 的 Prerequisites 段
- **核心逻辑**:PR body 顶部列:
  - [ ] Corresponding absorb PR merged(link)
  - [ ] `workers/<dest>/test` 全绿(CI link)
  - [ ] P2 live loop 至少跑绿一次(link)
  - [ ] 无 revert / rollback 痕迹(git log verification)
- **一句话收口目标**:✅ **每 deprecation PR body 引用完整 checklist**

#### F4: per-package deprecation PR 序列

- **输入**:9 个 Tier B packages + 建议顺序(§5.1 S5)
- **输出**:9 个独立 PR
- **核心逻辑**:每个 PR 只动 **1 个** README + CHANGELOG;其他 file 零 diff
- **边界情况**:同一日可开多个 PR(不强制 sequential merge)
- **一句话收口目标**:✅ **9 个 deprecation PR 各自绿 + merge**

#### F5: WCA 半 banner 避免

- **输入**:C2(D03 absorb)+ D1(D04 absorb)两端的 absorb-stable 状态
- **输出**:单一 WCA deprecation PR
- **核心逻辑**:等 C2 **和** D1 都稳定再开 PR;banner 明确两端目的
- **一句话收口目标**:✅ **WCA deprecation PR 单次发生;banner 明示双目的**

#### F6: 物理删除 trigger 文档化

- **输入**:§5.1 S8
- **输出**:每个 deprecation PR 的 CHANGELOG entry 尾部附一句 "物理删除在下一阶段 release charter"
- **一句话收口目标**:✅ **9 个 CHANGELOG entry 都明示物理删除 trigger 在下一阶段**

#### F7: 不碰 NACP 2 包

- **输入**:D09 PR review gate
- **输出**:PR diff 文件列表
- **核心逻辑**:grep PR diff 文件路径,若含 `packages/nacp-core` / `packages/nacp-session` / `docs/plan-pre-worker-matrix` / `docs/plan-worker-matrix` → red + reject
- **一句话收口目标**:✅ **9 个 PR 零命中 NACP 相关文件**

### 7.3 非功能性要求

- **性能目标**:n/a(文档 PR)
- **可观测性要求**:CHANGELOG 为 audit trail
- **稳定性要求**:每个 deprecation PR 不破坏 `pnpm install` / `pnpm -r test`;PR 内跑 smoke `pnpm install` + `pnpm -r run build` 验证
- **测试覆盖要求**:无新增 test

---

## 8. 可借鉴的代码位置清单

### 8.1 现有代码

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| `docs/design/pre-worker-matrix/W3-absorption-pattern.md` §8 | deprecated timing 纪律 | 本设计严格继承 |
| 各 `packages/<name>/README.md` | 当前未贴 banner | F1 / F2 应用对象 |
| 各 `packages/<name>/CHANGELOG.md`(若存在)| 现有 entry 格式 | F2 格式对齐 |
| `dogfood/nacp-consume-test/README.md` | 非 deprecated 引用模板 | F1 文本风格参考 |

### 8.2 npm / open-source precedent

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| npm deprecate 官方 doc | deprecation best practices | wording 风格 |
| Babel 7 的 legacy deprecation | 大型 monorepo per-package deprecation | per-worker 节奏参考 |

### 8.3 必须避开的反例

| 位置 | 问题 | 避开理由 |
|------|------|----------|
| `npm deprecate` Tier B | Tier B 不发布 | 无意义 |
| 贴 banner 同 PR 改 Tier B source | 范围扩大 | 否 |
| 在 D09 PR 里 bump version | 无意义 | 否 |
| 一次 PR 贴 9 个 banner | 违反 Q6c | 否 |
| WCA 半 banner | 语义混乱 | 否 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

D09 是 P5 的第二 release hygiene 交付物:9 个 Tier B packages 按 per-worker absorb-stable 触发,逐个开 deprecation PR(README banner + CHANGELOG entry),不改 source、不碰 NACP、不物理删除。模板统一,每 PR diff 极小,回滚简单(revert)。主要风险在 WCA split 的同步贴和 PR 范围守护。

### 9.2 Value Verdict

| 维度 | 评级 | 说明 |
|------|------|------|
| 贴合度 | **4** | charter exit primary #4 |
| 性价比 | **5** | 极小 PR × 9 + 文本只活 |
| "上下文 / Skill / 稳定性" 杠杆 | **3** | 稳定性间接收益;长期 audit 价值高 |
| 开发者友好度 | **5** | banner + CHANGELOG 一览 |
| 风险可控 | **5** | revert 即回滚 |
| **综合价值** | **4.4** | P5 必做;docs-only |

### 9.3 下一步行动

- [ ] **决策确认**:owner approve 模板 + 顺序
- [ ] **关联 PR**:9 个 deprecation PR(按 §5.1 S5 节奏)
- [ ] **待深入调查**:
  - 是否需要一个自动化检查:CI 验证 9 个 Tier B README 顶部是否含 DEPRECATED banner(在 P5 结束后作为 exit gate)?(建议:可选,手动也足)
  - 物理删除 trigger 是否在本设计里写成更精确的条件(例如 "3 months since last absorb PR")?(当前粗粒度足够;下一阶段 charter 精化)

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7 | 初稿;基于 charter Q6c + W3 pattern §8 + GPT §5.6 编制 |
| v0.2 | 2026-04-23 | Claude Opus 4.7 | 吸收 D01-D09 GPT review R5:deprecation protocol 覆盖 "无 CHANGELOG 的包" — `agent-runtime-kernel` / `capability-runtime` 可走 README-only 或 minimal CHANGELOG stub;不强制补完整历史 changelog |
