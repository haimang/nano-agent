# W5 — Closure & Handoff

> 功能簇:`pre-worker-matrix / W5 / closure-and-handoff`
> 讨论日期:`2026-04-21`
> 讨论者:`Claude Opus 4.7 (1M context)` + owner pending review
> 关联文档:
> - Charter: `docs/plan-pre-worker-matrix.md` §4.1 F / §7.6
> - 前置 design(全部消费对象):
>   - `W0-nacp-consolidation.md`(**v0.2 narrower** — BoundedEvalSink class 不搬;hooks wire-shape only)
>   - `W1-cross-worker-protocols.md`(**v0.4 executed RFC-only**)
>   - `W2-publishing-pipeline.md`(**v0.3 executed parallel** — skeleton 已落地,首发/dogfood optional)
>   - `W3-absorption-blueprint-and-dryrun.md`(**v0.2 map + 2-3 blueprint + optional capability-runtime dry-run**)
>   - `W4-workers-scaffolding.md`(**v0.2 1 real(agent-core)+ 3 dry-run**)
> - 消费对象(W5 触发其 rewrite):`docs/plan-worker-matrix.md`(currently deprecated)
> - 消费对象(W5 更新):`docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md`
> - 消费对象(W5 更新):`docs/issue/after-foundations/after-foundations-final-closure.md`
> 文档状态:`draft (v0.3 post-GPT-R6-review: body fully aligned with charter r2 6 exit criteria & narrower W1/W3/W4)`
>
> **修订历史**:
> - v0.1 (2026-04-21):初稿。X1-X7 + 横向一致性 5 对角线
> - v0.2 (2026-04-21):Post-GPT-review narrowing(charter r2 scope 收窄的 downstream)。横向一致性检查内容微调以匹配 W0 narrower + W1 RFC-only + W2 parallel + W3 narrower + W4 1-deploy;final closure 结构描述 6 个 phase 的**收窄后**产出;exit criteria 继承 charter r2 §11 的 6 条收窄版。
> - v0.3 (2026-04-21):Post-GPT-R6 body-level narrowing。GPT 指出 v0.2 仅改顶部/概要,§7.2 X3 "5 大产出" 与 X4 "4 就绪" 仍为旧 W1 shipped protocol / W2 1.4.0 首发 / W3 10 blueprint + llm-wrapper / W4 4 URL 写法。本版:§7.2 X3 "5 大产出" 改为 "6 大产出" 对应 charter r2 §11 exit criteria;§7.2 X4 "4 就绪 table" 扩到 6 就绪(协议 topology / package 策略 / import-publish / orphan 决定 / scaffold / handoff);全文 "4 就绪 / 10 blueprint / llm-wrapper / 4 URL" 系统改为 narrower 表述;§7.2 X5 rev 3 新 §N、§4.1 亮点、§4.3 借鉴、§6.3 三大方向杠杆 一并同步。

---

## 0. 背景与前置约束

### 0.1 为什么 W5 必须作为独立 phase(而非 W0-W4 各自闭环了事)

pre-worker-matrix 前 5 个 phase(W0-W4)各自产出独立交付物(**W0 narrower NACP 吸收 / W1 方向 RFC / W2 publishing skeleton / W3 map + 2-3 blueprint / W4 脚手架 + 1 real deploy**),但它们之间存在**横向一致性需求**(v0.2 版本):

1. **W0 吸收的 evidence vocabulary shape** 必须与 **W1 RFC 里描述的 wrapping pattern** 一致(W1 RFC-only 无 helper 代码,但 shape reference 要对齐)
2. **W2 published path** 的 workflow 能正确打包并发布 W0 shipped 1.4.0 symbols（当前现实：`@haimang/*` 已首发）
3. **W3 map + 代表 blueprint** 里引用的 NACP import path 必须与 W0 shipped 路径一致
4. **W4 workers package.json** 的 NACP deps 能 resolve 成功(`workspace:*` 或 `@haimang/nacp-core@1.4.0` 任一 path)
5. **若 W3 做 optional capability-runtime dry-run**,目的地 `workers/bash-core/src/` 需要 W4 先建;若不做,此横向依赖不存在

这些**横向依赖不会被单个 W0-W4 phase 的 closure 自动验证**。W5 存在的本质:

> **对 W0-W4 narrower 产出做一致性检查,并把结果浓缩为"worker-matrix charter r2 作者直接可消费的 input pack"。**

若跳过 W5 直接进入 worker-matrix P0,会出现两类高频问题:
- **协议漂移**:W3 blueprint 的 import 路径与 W0 实际路径不一致;worker-matrix P0 执行者踩坑
- **依赖漂移**:W4 workers 用 `workspace:*` interim 跑过,但切到 published version 时某 symbol 不存在

W5 的 "final closure + handoff" 就是在这两类漂移扩散前收束。

### 0.2 W5 的非代码性质

与 W0-W4 不同,W5 **不产出任何代码**(除必要的文档交叉引用更新):
- W5 不改 packages/ 或 workers/ 的任何源文件
- W5 不改任何 CI workflow
- W5 不触发任何 Cloudflare deploy

W5 的全部产出都是**文档 + 元文档更新**:
1. 6 份 closure memos(W0-W5 各自一份 + 1 份 final closure)
2. 1 份 handoff memo
3. 2 处 meta-doc 修改(`00-current-gate-truth.md` rev 3 + `after-foundations-final-closure.md` 状态更新)
4. 1 处 charter 状态触发(`plan-worker-matrix.md` deprecated → needs-rewrite-r2)

这决定了 W5 的"执行风险极低、但纪律要求极高"的特殊定位。

### 0.3 前置共识(不再辩论)

- **W0-W4 全部 owner-approved 且实施完成**是 W5 启动的硬前置
- **deprecation 时机**:W5 不涉及 Tier B packages 的 deprecated 贴纸(那是 worker-matrix P0 按 W3 blueprint 执行时加);W5 只做"pre-worker-matrix 整体 deprecated from charter perspective" 的状态更新
- **不 rewrite worker-matrix charter**:W5 只**触发** rewrite;实际 rewrite 由 owner 启动 worker-matrix charter r2 cycle 时做,不在 W5 scope
- **闭环条件**:W5 完成前不启动 worker-matrix charter r2

### 0.4 显式排除

- 不做 W0-W4 的 code delta(已在各自 phase 完成)
- 不 rewrite `plan-worker-matrix.md`(只解除 deprecated state,触发 rewrite;rewrite 动作由未来 worker-matrix charter phase 执行)
- 不做最终 regression run(regression 已在 W0 / W4 各自完成;W5 引用 evidence,不重跑)
- 不做 owner education(handoff memo 是 artifact,不是 tutorial)
- 不做"未来 phase 预览"过度(仅列 worker-matrix charter r2 必 revise 的节,不越位设计)
- 不为 Tier B packages 打 deprecated 贴纸(W3 blueprint 规定 worker-matrix P0 该 worker absorb 完成时加;W5 不提前)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`Pre-Worker-Matrix Closure & Handoff`
- **一句话定义**:对 W0-W4 五个 phase 的产出做一次整体性一致性检查,产出 6 份 closure memos + 1 份 handoff memo,更新 2 处 meta-doc,触发 `plan-worker-matrix.md` r2 rewrite cycle
- **边界描述**:
  - **包含**:6 份 closure + 1 份 handoff + 2 处 meta 更新 + 1 处 charter 状态解锁
  - **不包含**:code changes / worker-matrix charter r2 实际撰写 / deploy actions / Tier B deprecated 贴纸

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|---|---|---|
| phase closure | 单 phase 自闭合的 memo,记录产出 + 遗留 + 验证证据 | W0-W4 各自先产出(在各 phase 末尾);W5 只是检查与归档 |
| final closure | 整个 pre-worker-matrix 阶段的综合 closure memo | W5 产出核心 |
| handoff memo | 向下一 phase(worker-matrix)传递的 input pack | W5 产出核心 |
| 6 就绪(状态)| 协议 topology / package 策略 / import-publish / orphan 决定 / scaffold / handoff(对应 charter r2 §11 6 条 exit criteria) | handoff 的六类核心事实 |
| charter rewrite trigger | `plan-worker-matrix.md` 从 deprecated 进入 `needs-rewrite-r2` 状态的动作 | W5 的最后一个动作 |
| meta-doc | `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md` 等跨 phase 索引文档 | W5 rev 更新对象 |
| 横向一致性检查 | W0-W4 产出之间的交叉引用对齐检查 | W5 独有的纪律动作 |

### 1.3 参考上下文

- `plan-after-foundations.md` §7.8 的 "Worker-Matrix Pre-Convergence & Handoff" 章节(B8 handoff 设计)
- `docs/issue/after-foundations/B8-phase-1-closure.md`(closure memo 结构参考)
- `docs/issue/after-foundations/after-foundations-final-closure.md`(final closure 结构参考)
- `docs/handoff/after-foundations-to-worker-matrix.md`(handoff memo 结构参考)
- `docs/issue/after-foundations/B9-final-closure.md`(post-review revision 写法参考)

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **整体架构里的角色**:pre-worker-matrix 与 worker-matrix 之间的 handoff gate;最后一道一致性检查
- **服务于**:
  - Owner:获得"阶段性胜利感"的凭据 + worker-matrix 是否可启动的判断依据
  - worker-matrix charter r2 作者:得到直接可消费的 input pack
  - worker-matrix P0 执行者:得到 6 就绪清单 + 遗留 open items 精确列表
- **依赖**:W0-W4 全部 owner-approved + 实施完成 + 各自 closure 已写
- **被谁依赖**:worker-matrix charter r2 cycle 启动(handoff memo 是其直接 input)

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| W0-W4 closures | W5 consume + verify | 强 | W5 先读 6 份,检查一致性 |
| `plan-pre-worker-matrix.md` | W5 unchanged | 弱 | 本 charter 不改;只 reference |
| `plan-worker-matrix.md` | W5 modify(状态解锁) | 强 | deprecated banner 状态改为 `needs-rewrite-r2` |
| `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md` | W5 modify(rev 3) | 强 | 同步 pre-worker-matrix closure 状态 |
| `docs/issue/after-foundations/after-foundations-final-closure.md` | W5 modify | 中 | §6 readiness 陈述更新 |
| `docs/handoff/after-foundations-to-worker-matrix.md` | W5 平行 reference | 弱 | B8 handoff 是 ancestor;本 W5 handoff 是 descendant,不替换 |
| `docs/templates/*` | 无 | 无 | W5 不改模板 |
| `packages/*` / `workers/*` | 无 | 无 | W5 纯文档 |
| `.github/workflows/*` | 无 | 无 | W5 不改 CI |

### 2.3 一句话定位陈述

> 在 nano-agent 里,`Pre-Worker-Matrix Closure & Handoff` 是 **pre-worker-matrix 的最后一 phase**,负责 **对 W0-W4 产出做横向一致性检查 + 产出 final closure 与 handoff memo + 解锁 `plan-worker-matrix.md` 进入 r2 rewrite**,对上游(owner)提供 **"pre-worker-matrix 闭环且可进下阶段" 的统一凭据**,对下游(worker-matrix charter r2 作者 + P0 执行者)提供 **6 就绪(对应 charter r2 §11 exit criteria)+ 可直接消费 input pack + 遗留 open items 精确清单**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点(哪里可以砍)

| 被砍项 | 来源 / 对标 | 砍的理由 | 未来是否回补 |
|---|---|---|---|
| Final closure 复述 W0-W4 所有细节 | 全面记录冲动 | 6 份 phase closure 已记录;final closure 是 index + 跨 phase 判断 | 否 |
| Handoff memo 写成 worker-matrix charter r2 的 draft | 越位做下游 | r2 rewrite 是 worker-matrix cycle 工作 | 否 |
| W5 期间跑所有 regression 一次 | 最后验证冲动 | 各 phase 已跑;W5 引用 evidence | 若 W0-W4 某 evidence 遗失,重跑 |
| Deprecated Tier B packages | 顺手清理 | 共存期未到;per-worker absorb 时再加 | 否(W3 blueprint 已规定时机) |
| 为 agent-core URL 真实调度 smoke check | 验证 W4 deploy 持久 | W4 closure 已记录一次 curl;W5 引用即可 | 若 URL 1 周内失效,专门 incident |
| W5 修 W0-W4 发现的小 typo | 善后冲动 | Typo 由后续 doc reviewer 修;W5 focus on structure | 否 |
| 为 worker-matrix P0 写 action-plan | 越位设计 | P0 action-plan 属 worker-matrix cycle | 否 |
| 邮件 / Slack 通知 | 外部沟通 | nano-agent 纪律是 docs-first;通知由 owner 决定 | 否 |

### 3.2 接口保留点(必须留扩展空间)

| 扩展点 | 表现形式 | 第一版行为 | 未来演进 |
|---|---|---|---|
| Final closure 的 "open items" section | markdown bullet list | 列出 W0-W4 遗留的 TODO | worker-matrix P0 消费时逐条关闭;关闭后回写 |
| Handoff memo 的 "6 就绪" 状态表 | markdown table | 6 行 × (状态 / 产出 / 引用),对应 charter r2 §11 6 条 exit criteria | 未来若新 exit 维度加入,加行 |
| `00-current-gate-truth.md` revision history | 顶部 "revision history" block | 记录 rev 1 (2026-04-21 initial) / rev 2 (2026-04-21 post-B9) / rev 3 (2026-04-21 pre-worker-matrix closure) | 每次 meta 更新加 row |
| Worker-matrix r2 rewrite checklist | markdown checkbox list | 列 8-10 条必改节 | 实际 r2 撰写时逐条 check off |

### 3.3 完全解耦点(必须独立)

- **Final closure 与 handoff memo 完全独立**
  - Final closure 面向 "这段时间做了什么"(回顾视角)
  - Handoff memo 面向 "下阶段可以做什么"(前瞻视角)
  - 两份可分别 review;不 cross-reference 过深(只互指 1 次)
- **W5 内部 actions 松耦合**
  - W5 的 6 份 closure 写作可与 meta 更新并行
  - charter state flip 是最后一个动作,与其他并行
- **W5 与 worker-matrix charter r2 rewrite 解耦**
  - W5 产出 input pack;worker-matrix cycle 消费
  - W5 不承担 rewrite 失败的责任(rewrite 未开始 = 不是 W5 问题)

### 3.4 聚合点(单一中心)

- **Final closure 是 pre-worker-matrix 阶段唯一权威综合**
  - 所有"阶段结束了吗 / 哪些做完了 / 哪些遗留"问题指向 final closure
  - 其他 W0-W4 phase closure 是 evidence 来源,不是综合结论
- **Handoff memo 是下阶段唯一 input pack**
  - worker-matrix charter r2 作者读 handoff memo,不读 6 份 phase closure
  - 若 handoff memo 遗漏,扣 W5 收口

---

## 4. 关键参考实现对比

### 4.1 B8 handoff pack(直接 precedent)

- **实现概要**:`plan-after-foundations.md` §7.8 的 "Worker-Matrix Pre-Convergence & Handoff" 产出了 `after-foundations-to-worker-matrix.md` + `after-foundations-final-closure.md` + 2 个 template(B8 shipped)
- **亮点**:
  - closure + handoff 分别 memo 的结构
  - 6 条约束陈述 + 开放 gates 明示
- **值得借鉴**:
  - 就绪状态的结构化表达(W5 扩到 6 就绪对应 charter r2 §11 exit criteria)
  - 开放 gates 精确列出(F03 / F09)
- **不照抄的地方**:
  - B8 handoff 也有 post-B9 review 后的补回填(§11/§12/§13);W5 的 handoff 初版可更干净因为 W0-W4 期间已做整合性检查

### 4.2 B9 final closure post-review 整改 pattern

- **实现概要**:B9 final closure 在 owner GPT review 后加 §8 "Second-round GPT review integration" 追记
- **亮点**:
  - Revision note 在顶部;§8 详细 integration
  - 明确记录 "哪些 claim 当时过满 / 哪些实际修复了"
- **值得借鉴**:
  - 若 W5 阶段发现某 W0-W4 closure 事后被挑战,用类似 pattern 追加 revision
- **不照抄的地方**:
  - W5 本身是最后 phase,不期待再被挑战(若被挑战,就回到具体 W0-W4 修)

### 4.3 大型软件项目的 phase gate review pattern(通用)

- **实现概要**:许多 enterprise 项目在 phase 之间做 "gate review" — 一次性检查 scope / deliverable / quality
- **亮点**:
  - Checklist-driven
  - 多人参与 sign-off
- **值得借鉴**:
  - W5 的 "6 就绪" 状态 = mini gate review checklist(对应 charter r2 §11 exit criteria)
- **不照抄的地方**:
  - 企业 gate review 通常有正式 sign-off ceremony;W5 只需 owner 实质 approve,不需仪式

### 4.4 横向对比速查表

| 维度 | B8 handoff | B9 final closure(post-review) | 大型项目 phase gate | W5(本 design) |
|---|---|---|---|---|
| 产出文件数 | 2 + 2 template | 1 + revision | 多(checklist / sign-off) | **6 closure + 1 handoff + 2 meta update + 1 charter flip** |
| 回顾 vs 前瞻 | 双重 | 单(回顾) | 双重 | **双重(closure 回顾 + handoff 前瞻)** |
| Cross-phase 一致性检查 | 有(§11/§12/§13 post-review) | 无 | 是 | **是(横向一致性检查是 W5 独有纪律)** |
| 触发下游 cycle | 隐式 | 无 | 显式 | **显式(charter state flip)** |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope(W5 第一版必须完成)

- **[X1]** 审阅并确认 W0-W4 各自 closure memo 全部 shipped 且 owner-approved:
  - `docs/issue/pre-worker-matrix/W0-closure.md`
  - `docs/issue/pre-worker-matrix/W1-closure.md`
  - `docs/issue/pre-worker-matrix/W2-closure.md`
  - `docs/issue/pre-worker-matrix/W3-closure.md`
  - `docs/issue/pre-worker-matrix/W4-closure.md`
- **[X2 v0.2]** **横向一致性检查**(5 条对角线,v0.2 内容微调以匹配 narrower scope):
  - (a)W0 吸收的 evidence vocabulary Zod schema 与 W1 **RFC 文档 + W1 closure**里描述的 wrapping pattern shape 是否一致?(v0.2 — W1 无 helper 代码;检查 RFC 描述的 shape 是否引用 W0 shipped 的 EvidenceAnchorSchema)
  - (b v0.2)W2 已完成首发:`@haimang/nacp-core@1.4.0` 是否包含 W0 所有 shipped 新 symbol(不再期望包含 W1 的 — W1 RFC-only 无代码)
  - (c v0.2)**W3 absorption map + 2-3 代表 blueprint** 里引用的 NACP import path 是否与 W0 / W2 当前 shipped 路径一致?(不再是 10 份 blueprint)
  - (d v0.2)W4 的 agent-core 是否能:(i) 从 GitHub Packages resolve `@haimang/nacp-core@1.4.0`;或(ii) 继续用 `workspace:*` resolve 成功;**两者任一 pass 即可**
  - (e v0.2)W4 的 `workers/agent-core/src/` 结构与 W3 **optional capability-runtime dry-run**(若执行)落点 `workers/bash-core/src/` 是否兼容?若未做 dry-run,(e) 检查降为"workers/ 4 个目录结构统一"
- **[X3]** 产出 **`docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`**(§7.2 X3 详述)
- **[X4]** 产出 **`docs/handoff/pre-worker-matrix-to-worker-matrix.md`**(§7.2 X4 详述)
- **[X5]** 更新 **`docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md`** rev 3:
  - 加顶部 rev 3 note
  - 新增章节 "§N. Pre-Worker-Matrix Closure Integration (rev 3)":
    - r2 narrower 6 就绪状态总结(拓扑 / 包策略 / import-publish / orphan 决定 / scaffold / handoff)
    - 1 agent-core deploy URL + 3 dry-run log
    - NACP 1.4.0 发布状态(pre-phase 已发 OR 延后;二者之一 evidence)
    - 指向 final closure + handoff memo
- **[X6]** 更新 **`docs/issue/after-foundations/after-foundations-final-closure.md`**:
  - §6 "readiness statement" 从 "worker matrix Phase 0 gate OPEN" 改为 "pre-worker-matrix shipped;worker-matrix charter r2 待启动"
  - 引用 pre-worker-matrix final closure
- **[X7]** **解锁 `plan-worker-matrix.md`**:
  - 顶部 deprecated banner:"deprecated" → "needs-rewrite-r2"
  - 写入 "r2 rewrite 输入来源":pre-worker-matrix final closure + handoff memo
  - r2 rewrite 预期修订面保留(W0-W4 design 已列出)

### 5.2 Out-of-Scope(W5 不做)

- **[Y1]** Rewrite `plan-worker-matrix.md` 本身(属 worker-matrix charter r2 cycle)
- **[Y2]** 实际撰写 worker-matrix P0 action-plan(属 worker-matrix cycle)
- **[Y3]** 为 Tier B packages 加 deprecated 贴纸(属 worker-matrix P0 按 W3 blueprint 执行)
- **[Y4]** 真实重跑 regression(W0/W4 已跑;W5 引用 evidence)
- **[Y5]** 修复 W0-W4 closure 里 typo / 小 bug(由后续 doc reviewer 修)
- **[Y6]** 重新 deploy agent-core / 触发 3 workers 的 real deploy 验证 URL 持久(W4 closure 已记录 agent-core 1 URL;其余 3 workers 仅 dry-run 不需 URL;若 URL 失效属单独 incident)
- **[Y7]** 为 worker-matrix P0 招新 actor / 分配任务(非 W5 scope)
- **[Y8]** `plan-pre-worker-matrix.md` 本 charter 状态更新(该 charter 结束时自然 "已闭环",不需特别 flip)
- **[Y9]** skill.core deferral 状态更新(已在 `docs/eval/worker-matrix/skill-core-deferral-rationale.md` 冻结;除非 owner 提供新决策)
- **[Y10]** 外部沟通 / release note 发布 / 社区公告

### 5.3 边界清单

| 项目 | 判定 | 理由 |
|---|---|---|
| W5 期间若发现某 W0-W4 closure 有严重 bug | **in-scope 但 escalate** | W5 不直接改 W0-W4 closure;通知该 phase owner;若 block W5,暂停 W5 待 fix;若不 block,记录到 open items |
| Final closure 是否引用 1 agent-core deploy URL + 3 dry-run log 原文 | **in-scope**(v0.2 narrower)| URL + dry-run log 作为"脚手架就绪"的机读 evidence;agent-core curl 响应 json 附录 |
| Handoff memo 是否列 W3 absorption map(10 行)逐行 + 2-3 代表 blueprint 状态 | **in-scope**(v0.2 narrower) | charter r2 作者需要 map 逐行状态 + 代表 blueprint per-file 状态 + 外推风险标签;只列状态 + 链接,不 inline 内容 |
| 是否为 W5 自己也写 `W5-closure.md` | **in-scope**(§7.2 X3 的子产出)| W5 自己作为 phase,也应产 phase closure;但可合并进 final closure 作为 §N 一节,不需独立文件 |
| W5 是否负责 update worker-matrix charter r2 预期修订面的 checklist | **in-scope 起始版本**,**可选 refinement** | `plan-worker-matrix.md` deprecated banner 已列 r2 预期修订面;W5 review 确认 / 补充,不重写 |
| 若 owner W5 期间决定延迟 worker-matrix(如先做 skill.core) | **out-of-scope 改方向**,**in-scope 记录** | W5 本身不 gatekeep owner 方向决策;但在 final closure 记录决策;handoff memo 更新目标 phase |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1 — Final closure + 独立 handoff,双文件不合并**
   - **选择 2 份独立 memo**,不是 **合并 1 份 mega doc**
   - **为什么**:
     - Final closure 回顾视角;handoff memo 前瞻视角。合并会稀释各自焦点
     - worker-matrix charter r2 作者只需读 handoff memo;不合并 = 不强迫读 final closure 里的历史细节
     - 未来若 pre-worker-matrix 阶段有"后 review"(类似 B9 post-review integration),revision 加到 final closure 而不触及 handoff
   - **接受的代价**:维护 2 份文件的交叉引用成本(互相 link)
   - **缓解**:两份顶部各自 `> Companion: <link>` 行

2. **取舍 2 — 横向一致性检查 5 条对角线,不全组合(穷举 10)**
   - **选择 5 条关键对角线**,不是 **C(5,2)=10 组合全查**
   - **为什么**:
     - 5 条已覆盖所有 W0-W4 横向依赖对(见 §5.1 X2 a-e)
     - 其他 5 对组合要么无跨 phase 耦合(如 W2↔W3:W2 只影响 workers/ 消费,不影响 blueprint 撰写),要么已由其他 phase closure 覆盖
   - **接受的代价**:理论漏洞点(若 5 条之外有隐藏 cross-phase 依赖)
   - **缓解**:final closure 记录"横向依赖 inventory",未来若发现第 6 条再追加

3. **取舍 3 — Meta-doc rev 放在 `00-current-gate-truth.md`,不新建文档**
   - **选择 rev 已有文件**,不是 **新建 `pre-worker-matrix-closure-state.md`**
   - **为什么**:
     - `00-current-gate-truth.md` 已有 rev 1 / rev 2 precedent;加 rev 3 保持追溯链
     - 读者查看 "当前门槛状态" 只需读一个文件,不需跨多处
   - **接受的代价**:单文件长度增加
   - **缓解**:rev 3 内容放在 "§N. Pre-Worker-Matrix Closure Integration (rev 3)" 独立 section

4. **取舍 4 — Charter state 仅 flip(deprecated → needs-rewrite-r2),不实际 rewrite**
   - **选择 flip 不 rewrite**
   - **为什么**:
     - r2 rewrite 涉及大量新 scope 设计;属 worker-matrix charter cycle,不是 W5
     - flip 本身是 gate signal;owner / actor 可基于此状态决定启动 r2 cycle
   - **接受的代价**:`plan-worker-matrix.md` 在 "flipped but not rewritten" 过渡状态有一段时间;可能有读者误以为"已 rewrite"
   - **缓解**:banner 文字明确"needs-rewrite-r2" 不是 "rewritten";并指向 handoff memo 作为 input

5. **取舍 5 — 横向一致性检查结果记录在 final closure(不单独文件)**
   - **选择内嵌 final closure**
   - **为什么**:
     - 检查结果 = 5 条通过 / 不通过 + 每条 evidence
     - 独立文件无必要;final closure 的 §N 节足够承载
   - **接受的代价**:final closure 略长
   - **缓解**:检查结果表结构化,查阅友好

6. **取舍 6 — 不重跑 regression,只引用 W0/W4 evidence**
   - **选择引用**,不是 **W5 期间重跑**
   - **为什么**:
     - W0 完成时已跑全包 regression + B7 LIVE;W4 完成时已跑 agent-core 1 real deploy + 3 workers dry-run + CI
     - 重跑会把 W5 变成"验证 phase"而非"收口 phase"
     - 若需重跑,说明某 W0-W4 closure 的 evidence 已失效 — 那是该 phase 的问题,不是 W5
   - **接受的代价**:W5 产出依赖 W0-W4 closure 的 evidence 可信;若 closure 造假 / 错误,W5 吸收
   - **缓解**:X2 横向一致性检查会抓到部分 evidence 漂移

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|---|---|---|---|
| W0-W4 某 closure 未写 / 未 approved | phase 实施遗漏 | W5 无法启动 | X1 严格检查;缺则返回该 phase |
| X2 横向一致性检查发现不一致 | 跨 phase 漂移 | W5 delay;需返回某 phase 修 | escalate pattern(见 §5.3);若 block 则暂停 W5 |
| Handoff memo 写得太抽象,下游用不起来 | 作者视角偏回顾 | worker-matrix r2 作者另写 input pack,W5 产出浪费 | §7.2 X4 要求 handoff memo 含具体文件路径 / 具体 symbol 名;not generic |
| Meta-doc rev 3 写与现实不符 | W4 agent-core deploy URL 已失效 | charter r2 作者被误导 | X2.d 专门检查 W4 agent-core deploy 持久性(curl 一次记录);若失效,write as "曾 deployed at ..." |
| `plan-worker-matrix.md` 状态 flip 后,长期无人启动 r2 | owner 未排期 | pre-worker-matrix 收益在 6 个月内衰减 | W5 完成后 60 天内 owner 若未启动 r2,worker-matrix input pack 应 revision(具体由 owner 决定) |
| pre-worker-matrix 期间出现 owner 决策变动(e.g. 决定放弃 filesystem.core 独立 worker) | owner 方向改变 | W0-W4 部分产出失效 | handoff memo 顶部加 "owner decision freeze date";若后变,开新 charter |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己(我们)**:
  - 一份 final closure memo 取代 "要把 W0-W4 读完才能知道 pre-worker-matrix 干了啥"
  - Handoff memo 让 worker-matrix r2 作者 1 小时内可进入状态
- **对 nano-agent 长期演进**:
  - Pre-worker-matrix 作为完整 phase 被**归档**(B6 / B7 / B8 / B9 / pre-worker-matrix 可作为 phase 序列追溯)
  - 横向一致性检查的 5 条对角线 pattern 可复用(未来 phase 之间也可做类似 check)
- **对三大深耕方向杠杆**:
  - **上下文管理**:handoff memo 明确 context.core 已就绪的 protocol + shell + blueprint;worker-matrix P0 直接实装
  - **Skill**:`workers/` 目录 + agent-core 1 real deploy pattern 可复用给未来 skill.core(若入场)
  - **稳定性**:X2 横向一致性检查内化为 nano-agent 的 phase 纪律,降低下阶段回滚概率

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|---|---|---|---|
| X1 | W0-W4 closure 审阅 | 确认 5 份 phase closure shipped 且 owner-approved | ✅ 5 个文件 exist + owner sign-off |
| X2 | 横向一致性 5 检查 | 5 条对角线检查 | ✅ 5 条全 pass(或 fail + evidence + remediation plan) |
| X3 | Final closure memo | pre-worker-matrix 综合回顾 | ✅ 6 大产出(对应 charter r2 §11 exit criteria)+ 遗留 open items + X2 检查结果 |
| X4 | Handoff memo | 向 worker-matrix 传递 input pack | ✅ 6 就绪(对应 charter r2 §11 exit criteria)+ 具体 input 链接 + r2 预期修订面 |
| X5 | `00-current-gate-truth.md` rev 3 | Meta-doc 同步 | ✅ 加 "§N. Pre-Worker-Matrix Closure" rev 3 |
| X6 | `after-foundations-final-closure.md` 更新 | 跨阶段 readiness 同步 | ✅ §6 状态更新;引用新 handoff |
| X7 | `plan-worker-matrix.md` 状态 flip | charter 解锁 | ✅ banner state 从 deprecated 改 needs-rewrite-r2 |

### 7.2 详细阐述

#### X1: W0-W4 Closure 审阅

- **操作**:
  - `ls docs/issue/pre-worker-matrix/W{0,1,2,3,4}-closure.md` 5 文件全部存在
  - 每份读一遍确认:
    - owner sign-off 存在
    - 对应 phase 的 In-Scope primary criteria 全部勾选
    - 遗留 open items 清晰列出
- **若某 closure 缺失或未 approve**:W5 暂停;escalate 该 phase owner
- **一句话收口目标**:✅ **5 份 closure 存在 + 每份含 owner sign-off + open items 明确**

#### X2: 横向一致性 5 检查

- **5 条对角线详述**:

  **(a)W0 ↔ W1 — Evidence Vocabulary Shape Identity**
  - **检查**:W1 `evidence-envelope-forwarding.md` RFC 中引用的 evidence payload / anchor / `audit.record` wrapping 语义,是否与 W0 shipped 的 `packages/nacp-core/src/evidence/vocabulary.ts` 一致
  - **执行**:对照 RFC 文本与 W0 shipped code,确认 W1 没有重新定义第二套 evidence record shape
  - **Pass 条件**:RFC 只引用 W0 的 discriminated union / anchor 语义,不存在私有字段集或平行 vocabulary
  - **Evidence 附录**:W0 code anchor + W1 RFC 引用段落 + `docs/issue/pre-worker-matrix/W1-closure.md`

  **(b)W0 ↔ W2 — Published Symbol / Skeleton Completeness**
  - **检查**:当前已发布的 `@haimang/nacp-core@1.4.0` 是否包含 W0 shipped 新 symbol
  - **执行**:
    - `npm view @haimang/nacp-core@1.4.0 --json` + dogfood import W0 shipped symbols
  - **Pass 条件**:W0 shipped symbols 可 import
  - **Evidence 附录**:dogfood build log + publish run evidence

  **(c v0.2)W2 ↔ W3 — Import Path Consistency**
  - **检查(v0.2 narrower)**:W3 **absorption map + 2-3 代表 blueprint** 里引用的 NACP import path 是否与 W0 实际 shipped 路径一致
  - **执行**:
    - `grep -r '"@nano-agent/nacp' docs/design/pre-worker-matrix/W3-absorption-map.md docs/design/pre-worker-matrix/W3-absorption-blueprint-*.md`
    - 确认 scope 名与 W0 shipped scope 一致
  - **Pass 条件**:map + 2-3 份 blueprint 里 import path 与 W0 实际路径一致
  - **Evidence 附录**:grep 输出

  **(d v0.2)W2 ↔ W4 — Install Reality**
  - **检查(v0.2 narrower)**:W4 agent-core `package.json` 能用 `workspace:*` 或 `@haimang/nacp-core@1.4.0`(二者之一)成功 install + build
  - **执行**:
    - 若 W2 首发已完成:`cd workers/agent-core && pnpm install` + build 成功(published)
    - 若 W2 首发未完成:同上,但 deps 用 `workspace:*`,也成功
  - **Pass 条件**:**二者任一 path 可用**即 pass(不强制 published)
  - **Evidence 附录**:pnpm install log + build log + 当前使用的 deps 路径说明

  **(e v0.2)W3 dry-run ↔ W4 directory — Structure Compatibility**
  - **检查(v0.2 narrower)**:
    - **若 W3 做了 optional capability-runtime dry-run**:落点 `workers/bash-core/src/` 与 W4 建立的 `workers/bash-core/src/` 目录结构兼容;W4 shell 的 `src/index.ts` 不 import dry-run 代码(保持空壳纯净)
    - **若 W3 未做 dry-run**:降为 "4 个 workers/<name>/ 目录结构统一" 检查
  - **执行**(若有 dry-run):
    - `ls workers/bash-core/src/`
    - `pnpm -C workers/bash-core build` 两者都能 compile
  - **Pass 条件**:两者 coexist + build 双绿;或 4 目录结构统一
  - **Evidence 附录**:ls + tsc log

- **检查结果表(写入 final closure X3)**:
  | 对角线 | 检查内容 | 状态 | Evidence |
  |---|---|---|---|
  | (a) | Evidence vocab identity | ✅/❌ | ... |
  | (b) | Published symbol completeness | ✅/❌ | ... |
  | (c) | Import path consistency | ✅/❌ | ... |
  | (d) | Install reality | ✅/❌ | ... |
  | (e) | Structure compatibility | ✅/❌ | ... |
- **Fail 处理**:任一 ❌ 记录 remediation plan;若 block W5 closure,返回该 phase 修
- **一句话收口目标**:✅ **5 条全 pass + evidence 归档;或 fail 有 remediation plan**

#### X3: `pre-worker-matrix-final-closure.md`

- **文件位置**:`docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`
- **章节建议**:
  1. **概况**:pre-worker-matrix 阶段的一句话总结 + 开始/结束时间
  2. **本阶段 6 大产出**(对应 charter r2 §11 6 条 exit criteria):
     - 协议吸收(W0)— nacp-core / nacp-session 子目录 + 1.3.0/1.4.0 CHANGELOG + RFC 链接
     - 方向性 RFC(W1)— workspace.fs.* / remote compact delegate / evidence forwarding 3 份 RFC(v0.3 降级为 RFC-only,不含代码)
      - 发布管道(W2)— GitHub Packages 双包 workflow skeleton + discipline doc;**首发为可选**(若已完成则附 publish evidence,否则附 workspace:* interim 说明)
      - Absorption map + 代表 blueprint(W3)— 全 worker 范围 absorption map + 2-3 份代表性 blueprint + pattern spec;**capability-runtime dry-run 为可选**(做则强化 blueprint,不做则明确 skip 理由)
      - Workers 脚手架(W4)— `workers/` 目录 + agent-core 1 次 real deploy(URL 可访问) + 3 workers(bash-core/context-core/filesystem-core)dry-run build pass;matrix CI 通过
     - 横向一致性(W5 自身)— 5 × 对角检查全 pass 或有 remediation plan
  3. **每大产出的代码锚点 + 文档锚点**(具体 file:line / URL)
  4. **横向一致性检查结果**(X2 的 5 × 结果表)
  5. **遗留 open items 清单**(按 phase 汇总;每条含 owner + 预期解决时机)
  6. **W5 自身的 phase-level meta**(作为 §N 一节,不独立 W5-closure.md)
  7. **对 worker-matrix 阶段的 handoff posture**(简述 + 指向 handoff memo)
- **预期长度**:~300-400 行
- **一句话收口目标**:✅ **文件 shipped + 6 大章节齐全 + 6 产出对应 charter r2 §11 exit criteria + 5 一致性检查结果完整 + open items 精确**

#### X4: `pre-worker-matrix-to-worker-matrix.md`

- **文件位置**:`docs/handoff/pre-worker-matrix-to-worker-matrix.md`
- **章节建议**:
  1. **6 就绪状态总结**(对应 charter r2 §11 exit criteria):
     | 就绪 | 状态 | 产出位置 | 消费指引 |
     |---|---|---|---|
     | 协议 topology 就绪 | ✅ | nacp-core / nacp-session 子目录 + 1.3.0/1.4.0 CHANGELOG | 参考 W0 §3.4 directory layout |
     | Package 策略就绪 | ✅ | Tier A / Tier B 分层 + 吸收清单 | worker-matrix P0 按 Tier B 清单 absorb |
     | Import / Publish 策略就绪 | ✅ | W4 §0.3 共识 + W2 pipeline skeleton | agent-core 已 real deploy;其余 worker 可选 workspace:* 或 published |
     | Orphan-packages 决定就绪 | ✅ | W0 §5 deprecation matrix | worker-matrix P0 执行 packages/ 删除或保留决策 |
     | Scaffold 就绪 | ✅ | `workers/` 目录 + agent-core 1 real URL + 3 workers dry-run | worker-matrix P0 基于 blueprint 填 src/ |
     | Handoff 就绪 | ✅ | 本 memo + X3 closure + X5 rev 3 | charter r2 作者 1 小时内启动 rewrite |
  2. **可直接消费的 input pack**(按 worker-matrix P0 执行者视角):
     - 开始前读:pre-worker-matrix final closure(本 X3)+ 5 份 phase design(W0/W1/W2/W3/W4)+ charter r2
     - 开始时拿:absorption map + 2-3 代表 blueprint + pattern spec + `workers/` 目录
     - 开始中查:current-gate-truth rev 3(X5)+ handoff 本身 + W1 3 份 RFC(若涉及跨 worker 通信)
  3. **worker-matrix charter r2 必 revise 节 checklist**:
     - [ ] §0 背景:加 "pre-worker-matrix 6 就绪"(协议 topology / package 策略 / import-publish / orphan 决定 / scaffold / handoff)前提
     - [ ] §2.1 当前起点:nacp-core/nacp-session topology 就位;agent-core 1 real deploy;3 workers dry-run;published first publish 可能未完成(以实际 X3 结果为准)
     - [ ] §4 In-Scope A.1-A.4:重写为 blueprint-driven absorption(基于 W3 map + 2-3 代表 blueprint 扩展到全 Tier B)
     - [ ] §4 Out-of-Scope A.1-A.4:移除 "不建独立 worker shell"(已 W4 做)
     - [ ] §5 方法论:加 blueprint-driven / packages-phase-out / workspace-authority 3 条
     - [ ] §6 4 workers 章节:基于 W3 代表 blueprint + pattern spec 扩展到全 Tier B;具体文件清单
     - [ ] §8 Phase 拆分:从 3 扩到 6-7(含 P0.A-P0.D 按 worker 并行 absorption + P0.E composition + P0.F cross-worker wiring + P0.G packages deprecation)
     - [ ] §11 Exit criteria:新增 "live agent turn loop 端到端" + "Tier B packages 物理删除完成" + "若 W2 published 可选未完成,P0 完成 first published cut"
  4. **遗留 open items transfer list**(哪些 open items 需 worker-matrix P0 解决)
  5. **跨 phase 依赖警告**(e.g. "若 owner 在 W5 完成后延迟 r2 超 60 天,input pack 可能 stale")
  6. **Charter state 解锁说明**:pointer to X7
- **预期长度**:~250-350 行
- **一句话收口目标**:✅ **charter r2 作者读完 1 小时内可启动 rewrite**

#### X5: `00-current-gate-truth.md` rev 3

- **文件位置**:`docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md`
- **修改点**:
  - **顶部**:加 "revision 3 (2026-XX-XX)" entry,说明 "pre-worker-matrix closure integrated"
  - **新增 §N** "Pre-Worker-Matrix Closure Integration (rev 3)":
    - 6 就绪状态快照(对应 charter r2 §11 exit criteria;简短版,引用 X4 handoff memo)
    - nacp-core / nacp-session topology 证据(目录 + CHANGELOG + RFC 链接)
    - agent-core 1 real deploy URL + 3 workers dry-run build 证据(引用 W4 closure)
    - W2 published first cut 状态(若已 published 则 1.3.0/1.4.0 链接;若未 published 则标 interim workspace:*)
    - X2 横向一致性检查结果摘要(引用 X3 final closure)
    - pointer to X3 + X4 作为权威
  - **原有 §3**(B9 review integrated)保持不动(那是 rev 2 的产出)
  - **原有 §4**(practical reading law)可微调:把"worker matrix Phase 0 unblocked" 改为 "pre-worker-matrix closed;worker-matrix charter r2 待启动,r2 完成后 Phase 0 unblocked"
- **一句话收口目标**:✅ **rev 3 entry + 新 §N + 引用链完整**

#### X6: `after-foundations-final-closure.md` 更新

- **文件位置**:`docs/issue/after-foundations/after-foundations-final-closure.md`
- **修改点**:
  - **§6 readiness statement**:
    - 原:"worker matrix Phase 0 gate OPEN"
    - 新:"pre-worker-matrix shipped(2026-XX-XX);worker-matrix charter r2 待启动;Phase 0 gate status pending r2 完成"
  - **引用链**:指向 pre-worker-matrix final closure(X3)+ handoff(X4)
- **一句话收口目标**:✅ **§6 状态更新 + 引用链 + after-foundations → pre-worker-matrix → worker-matrix 三阶段关系清晰**

#### X7: `plan-worker-matrix.md` 状态 flip

- **文件位置**:`docs/plan-worker-matrix.md`
- **修改点**:
  - **顶部 deprecated banner**:
    - 原:`deprecated / awaiting-rewrite-after-pre-worker-matrix-closes`
    - 新:`needs-rewrite-r2 / pre-worker-matrix closed on 2026-XX-XX`
  - **新增一段 "r2 rewrite input"**:
    - Pointer 到 X3 final closure
    - Pointer 到 X4 handoff memo
    - Pointer 到 W0-W4 designs
    - 明确 r2 作者的启动顺序:先读 X4 → 读 X3 → 读 4 designs → 按 X4 §3 的 charter revise checklist rewrite
  - **保留**:顶部已列的 r2 预期修订面(W0-W4 设计过程中已积累);X4 §3 是其精细化版本
  - **保留**:r1 原文(作为历史审计 / boundary reference)
- **一句话收口目标**:✅ **banner 状态 flip + r2 rewrite input 链接完整**

### 7.3 非功能性要求

- **Final closure + handoff 可读性**:non-W5 作者读者应能 1 小时理解 pre-worker-matrix 全貌
- **一致性**:X2 的 5 条检查结果应 evidence-backed,可 reproduce
- **追溯性**:每个产出都能反向追溯到 W0-W4 某个具体 closure / design
- **独立性**:Handoff memo 应脱离 final closure 独立可读

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nano-agent 自己的先例

| 位置 | 内容 | 借鉴点 |
|---|---|---|
| `docs/issue/after-foundations/after-foundations-final-closure.md` | after-foundations 整体 closure | X3 的结构参考(特别是 §6 readiness 措辞) |
| `docs/handoff/after-foundations-to-worker-matrix.md` | B8 handoff memo | X4 的结构参考(4 就绪 / 输入 pack) |
| `docs/issue/after-foundations/B9-final-closure.md` | B9 post-review revision | 若 W5 出现 owner 挑战,revision pattern 复用 |
| `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md` rev 2 | meta-doc 的 revision pattern | X5 rev 3 直接沿用 |
| `docs/issue/after-foundations/B8-phase-1-closure.md` | phase closure 结构范本 | W5 自己的 phase-level summary(X3 §6) |

### 8.2 来自本 pre-worker-matrix 的产出

| 位置 | 内容 | 借鉴点 |
|---|---|---|
| W0-W4 各 design doc §9.3 "下一步行动" | 每 design 的遗留 open items | X3 §5 的 open items 汇总来源 |
| W0-W4 各 phase closure(预期) | phase 级产出 | X3 的 evidence 来源 |
| Charter `plan-pre-worker-matrix.md` §11 exit criteria | pre-worker-matrix 整体成功标准 | X3 的"是否成功"判断依据 |

### 8.3 需要避开的反例

| 做法 | 问题 | 我们为什么避开 |
|---|---|---|
| Final closure + handoff 合并一份 | 视角混 | §6.1 取舍 1 |
| W5 期间重跑所有 regression | 把 W5 变 validation phase | §6.1 取舍 6 |
| 把 worker-matrix r2 rewrite 做进 W5 | 越位 | §5.2 [Y1] |
| 横向一致性检查全组合 10 条 | over-engineering | §6.1 取舍 2 |
| 为 Tier B packages 加 deprecated 贴纸 | 越位 worker-matrix P0 | §5.2 [Y3] |
| 用 Slack / 邮件替代 docs-first | 违反 nano-agent 纪律 | §5.2 [Y10] |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

W5 是 **"pre-worker-matrix 最后一 phase + docs-only phase"**:

- **存在形式**:6 份 memo + 2 处 meta 更新 + 1 处 charter state flip(零代码)
- **覆盖范围**:W0-W4 全部产出的整合视图;向 worker-matrix 阶段的交接
- **耦合形态**:
  - 与 W0-W4 **强依赖**(全部作为 input)
  - 与 worker-matrix charter r2 **解锁触发**(不实际 rewrite)
- **预期代码量级**:0 行代码 + ~800-1000 行 markdown(6 memo + 2 meta + 1 charter flip)
- **预期复杂度**:低 — 纯文档 + 一致性检查;零 runtime 风险

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|---|---|---|
| 对 nano-agent 核心定位的贴合度 | **5** | docs-first 纪律的直接体现 |
| 第一版实现的性价比 | **5** | 极低代码工作量;下游使用效率显著提升 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | **4** | handoff memo pattern 可复用于未来 phase 收口 |
| 对开发者自己的日用友好度 | **5** | 1 份 handoff 取代读 6 份 closure |
| 风险可控程度 | **5** | 零代码;X2 检查可发现问题即可返修 |
| **综合价值** | **4.8** | 高 ROI 的 phase gate + 纪律工作 |

### 9.3 下一步行动

- [ ] **决策确认**(W5 动手前,owner 需 approve):
  - §6.1 取舍 1(双独立 memo)是否接受?
  - §6.1 取舍 2(5 条对角线,非全组合)是否接受?
  - §6.1 取舍 6(不重跑 regression)是否接受?
  - X7 的 `plan-worker-matrix.md` state flip 是否在 W5 动手,还是留 owner 手动?
- [ ] **关联 action-plan**:`docs/action-plan/pre-worker-matrix/D6-closure-and-handoff.md`(X1-X7 的批次化)
- [ ] **前置 ready check**:
  - W0-W4 全部 phase closure shipped 且 owner-approved
  - 若 W4 在 W5 前完成首次 Cloudflare deploy,handoff memo 可真实引用 URL;否则 handoff memo 以 "shell deployable,待 owner 提供 Cloudflare credentials 触发" 状态记录
- [ ] **待深入调查的子问题**:
  - 现有 `after-foundations-final-closure.md` 的 §6 措辞 exact text 是什么?(X6 需精确改动)
  - `00-current-gate-truth.md` rev 2 的 section numbering(X5 的 §N 应接续)

---

## 附录

### A. 讨论记录摘要

- **分歧 1**:Final closure + handoff 是否合并
  - **Opus 倾向**:双独立
  - **理由**:视角分离 + 下游消费独立
  - **当前共识**:双独立(§6.1 取舍 1)
- **分歧 2**:横向一致性检查粒度
  - **Opus 倾向**:5 条对角线
  - **理由**:覆盖所有真实耦合对
  - **当前共识**:5 条(§6.1 取舍 2)
- **分歧 3**:W5 是否自己也写 `W5-closure.md` 独立文件
  - **Opus 倾向**:合并进 final closure §6(不独立文件)
  - **理由**:W5 的产出本身就是 final closure;独立一份会递归
  - **当前共识**:合并(§5.3 边界)

### B. 开放问题清单

- [ ] **Q1**:若 X2 检查发现 ❌,是否允许 W5 在"有 remediation plan"状态下闭环?还是必须 fix 后才 close?(推荐:小 fail 允许 + plan;大 fail 必须先修)
- [ ] **Q2**:`plan-worker-matrix.md` state flip 是否可 auto?(推荐:W5 动手做;owner 若反对,revert 成本低)
- [ ] **Q3**:Final closure 与 handoff 的作者是否应是同一人?(推荐:同一人;避免视角差异)
- [ ] **Q4**:`pre-worker-matrix-to-worker-matrix.md` 文件名后缀是 `-to-` 还是 `→`?(参考 B8 `after-foundations-to-worker-matrix.md`,保持一致)
- [ ] **Q5**:W5 闭环后,`plan-pre-worker-matrix.md` 本 charter 是否也要 flip 状态?(推测:自然"已闭环";但可在 r1 顶部加 "closure date";owner 决定)
- [ ] **Q6**:若 owner 在 W5 完成后 60+ 天未启动 worker-matrix r2,handoff memo 是否需要 "stale" 标签?(推荐:设闸;60 天后 handoff 提示"revisit input pack freshness")

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|---|---|---|---|
| v0.1 | 2026-04-21 | Claude Opus 4.7 | 初稿:7 个 X 功能 + 6 个 tradeoff + 横向一致性 5 对角线 + final closure/handoff 双文件结构 + 4 处 meta 更新 |
| v0.2 | 2026-04-21 | Claude Opus 4.7 | Post-GPT-review narrowing(charter r2 scope 收窄的 downstream,W5 自身 scope 不变,只对 "被检查的产出" 做内容调整):<br/>• 顶部加修订历史<br/>• §5.1 X2 5 对角线检查内容微调<br/>• §11 exit criteria 继承 charter r2 §11 的 6 条收窄版本<br/>**净效果**:W5 自身结构(6 closure + 1 handoff + 2 meta + 1 charter flip)不变;检查内容改为"scope 收窄后的版本"适配 |
| **v0.3** | 2026-04-21 | Claude Opus 4.7 | Post-GPT-R6-review body-level narrowing(GPT 指出 v0.2 仅改顶部,正文仍为旧 W1/W3/W4 产出做 closure):<br/>• §7.2 X3 "本阶段 5 大产出" 改为 "6 大产出"对应 charter r2 §11 exit criteria<br/>• §7.2 X4 "4 就绪" 扩为 "6 就绪" table(协议 topology / package 策略 / import-publish / orphan 决定 / scaffold / handoff)<br/>• 全文 "4 就绪 / 10 blueprint / llm-wrapper dry-run / 4 URL" 系统改为 narrower 表述(map + 2-3 代表 blueprint;capability-runtime optional dry-run;agent-core 1 real deploy + 3 dry-run;workspace:* OR published)<br/>• §7.2 X3 "一句话收口目标" 加 "6 产出对应 charter r2 §11 exit criteria"<br/>• §7.2 X4 "charter r2 必 revise 节 checklist" 中 "4 就绪" 前提改 "6 就绪";Exit criteria 加 "若 W2 first publish 可选未完成,P0 完成 first cut"<br/>• §7.2 X5 rev 3 新增 §N 描述改为 "6 就绪 + agent-core 1 real + W2 first publish 状态"<br/>• §4.1/§4.3/§6.1 取舍 6 / §6.3 三大方向杠杆 中 "4 workers / 4 URL" 改 "agent-core 1 real + 3 dry-run"<br/>**净效果**:W5 全文与 charter r2 §11 的 6 条 exit criteria 及 W1-W4 v0.2/v0.3 narrower scope 对齐;无 stale "10 blueprint / llm-wrapper / 4 URL" 引用 |

### D. 修订综述

**v0.2 核心调整**:W5 的 "结构不变,内容适配"。W5 作为 closure phase,其存在价值不因 scope 收窄而变;只是 "被 closure 的产出" 变轻了,所以检查与归档内容相应调整。

**关键保留**:
- Final closure + handoff 双文件结构保留
- 横向一致性 5 对角线保留(是 W5 独有的纪律贡献)
- Charter state flip(`plan-worker-matrix.md` → needs-rewrite-r2)保留
- Meta-doc rev 3 保留

**关键调整**:
- 5 对角线的具体检查 predicate 适配 narrower scope(见上表)
- Final closure 的 "6 大产出"描述对应 charter r2 §11 6 条 exit criteria(协议 topology / package 策略 / import-publish / orphan 决定 / scaffold / handoff)
- Handoff memo 的 "6 就绪" 状态:协议 topology / Package 策略 / Import-Publish 策略 / Orphan-packages 决定 / Scaffold / Handoff(6 条对应 charter r2 §11 exit criteria,从原 4 就绪扩展)
- §7.2 X3/X4 章节建议的产出描述与表格与窄化后的 W1(RFC-only)、W2(skeleton + optional first publish)、W3(map + 2-3 blueprint + optional capability-runtime dry-run)、W4(1 real + 3 dry-run)对齐

**v0.3 后续微调**(R6 修订):
- §5.1 X2 (c)(d)(e) 三条对角线 predicate 进一步对齐 narrower scope(W3 2-3 代表 blueprint / W4 agent-core workspace:* or published / capability-runtime dry-run 作为 dry-run 目标)
- §7.2 X3 "本阶段产出"从 5 条改为 6 条(对应 charter r2 §11 6 条 exit);llm-wrapper 引用改为 capability-runtime;"10 份 blueprint + 真实 deploy 4 URL" 统一改为 "map + 2-3 代表 blueprint;agent-core 1 real + 3 dry-run"
- §7.2 X4 "4 就绪状态表"扩到 6 就绪(协议 topology / package 策略 / import-publish / orphan 决定 / scaffold / handoff);charter r2 必 revise checklist 中 "4 就绪" 前提改为 "6 就绪";Exit criteria 新增 "若 W2 first publish 可选未完成,P0 完成 first cut" 一条
- 全文其余 "4 就绪 / 10 blueprint / llm-wrapper dry-run / 4 URL" 出现处同步改为 narrower 表述

**对 charter r2 §11 第 6 条(worker-matrix r2 起跑线已重写清楚)的支持**:本 W5 的 X7 charter flip + handoff memo 是新 exit 第 6 条的直接交付。
