# F0 — Concrete Freeze Pack

> 服务业务簇: `orchestration-facade / F0 / concrete-freeze-pack`
> 计划对象: `把 reviewed design pack + FX-qna 收束成可执行的 freeze baseline`
> 类型: `modify`
> 作者: `GPT-5.4`
> 时间: `2026-04-24`
> 文件位置: `docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`
> 关联设计 / 调研文档:
> - `docs/plan-orchestration-facade.md`
> - `docs/design/orchestration-facade/F0-compatibility-facade-contract.md`
> - `docs/design/orchestration-facade/F0-agent-core-internal-binding-contract.md`
> - `docs/design/orchestration-facade/F0-stream-relay-mechanism.md`
> - `docs/design/orchestration-facade/F0-contexter-absorption-inventory.md`
> - `docs/design/orchestration-facade/F0-user-do-schema.md`
> - `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md`
> - `docs/design/orchestration-facade/F0-live-e2e-migration-inventory.md`
> - `docs/design/orchestration-facade/F4-authority-policy-layer.md`
> - `docs/design/orchestration-facade/FX-qna.md`
> - `docs/eval/orchestration-facade/F0-FX-design-docs-reviewed-by-deepseek.md`
> - `docs/eval/orchestration-facade/F0-FX-design-docs-reviewed-by-opus.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

F0 不写 worker 业务代码；它的职责是把已经完成的 design authoring、review absorption、FX-qna 回填，真正压成 **可执行的 freeze baseline**。如果没有这个周期，F1 很容易又回到“design 已经差不多了，所以边写边定”的老路，最终把 `orchestrator.core` 的首轮实现重新拖回 ad-hoc fetch 胶水、stream 返工、tenant law 再讨论。

这份 action-plan 要解决的不是“再写更多设计文档”，而是把现有 design pack 从 `reviewed + qna-applied` 推进到 **可直接驱动 F1-F5 实施** 的阶段真相层：该冻结的答案冻结、该进入 action-plan 的事项落进后续周期、该明确不是 blocker 的事项从“设计犹豫”降级成“实现期选择”。

- **服务业务簇**：`orchestration-facade / F0`
- **计划对象**：`Concrete Freeze Pack`
- **本次计划解决的问题**：
  - `review / qna / design / charter 之间虽然已基本对齐，但还缺少正式 freeze 周期`
  - `F1-F5 需要明确 design blocker 与 implementation follow-up 的边界`
  - `本阶段尚缺 F0 phase closure 与 execution checklist`
- **本次计划的直接产出**：
  - `frozen-ready 的 charter + design pack + FX-qna 组合`
  - `F1-F5 action-plan 的直接输入边界`
  - `docs/issue/orchestration-facade/F0-closure.md`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先做 freeze audit、再做真相同步、最后写 F0 closure** 的方式推进。F0 不新增功能，只把“还可能被反复讨论的设计答案”收束成一层单一真相源，并把后续周期的起跑条件写清楚。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | 冻结面审计 | `S` | 逐项核对 charter / design / FX-qna / review findings | `-` |
| Phase 2 | 真相同步与 wording 收口 | `M` | 消除残留漂移，固定 blocker vs follow-up 边界 | `Phase 1` |
| Phase 3 | 执行清单化 | `S` | 把 F1-F5 的进入条件、输入与交付物落成 checklist | `Phase 2` |
| Phase 4 | F0 closure | `S` | 写 F0 closure，正式解锁 F1 | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — 冻结面审计**
   - **核心目标**：确认 8 份 design docs、1 份 FX-qna、1 份 charter 已无 owner-level blocker
   - **为什么先做**：没有 freeze audit，后续 action-plan 只是把模糊带进实现期
2. **Phase 2 — 真相同步与 wording 收口**
   - **核心目标**：把 lingering draft wording、旧式 owner prompts、残留 open-question 统一清掉
   - **为什么放在这里**：只有先确认 blockers 已消失，才知道哪些 wording 该删除、哪些 follow-up 该保留
3. **Phase 3 — 执行清单化**
   - **核心目标**：把 F1-F5 的入口条件、输出物、依赖关系写成可执行清单
   - **为什么放在这里**：F0 的意义是为后续执行铺轨，而不是停留在文档美化
4. **Phase 4 — F0 closure**
   - **核心目标**：形成 F0 closure memo，声明 design freeze 完成并解锁 F1
   - **为什么放在最后**：closure 必须建立在前 3 个 Phase 的事实收束之后

### 1.4 执行策略说明

- **执行顺序原则**：`先审计 blocker，再收束 wording，最后形成 closure`
- **风险控制原则**：`不在 F0 偷渡实现工作，也不把实现期选择重新升格为 owner blocker`
- **测试推进原则**：`F0 以文档交叉核对为主，不引入代码级新验证任务`
- **文档同步原则**：`charter / design docs / FX-qna / closure wording 一次收口`

### 1.5 本次 action-plan 影响目录树

```text
F0 Concrete Freeze Pack
├── charter/
│   └── docs/plan-orchestration-facade.md
├── design/
│   └── docs/design/orchestration-facade/
│       ├── F0-*.md
│       ├── F4-authority-policy-layer.md
│       └── FX-qna.md
├── review/
│   └── docs/eval/orchestration-facade/
│       ├── F0-FX-design-docs-reviewed-by-deepseek.md
│       └── F0-FX-design-docs-reviewed-by-opus.md
└── closure/
    └── docs/issue/orchestration-facade/F0-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 审计 charter / design pack / FX-qna / review findings 的最终一致性
- **[S2]** 明确区分 owner-level blocker 与 implementation follow-up
- **[S3]** 把 F1-F5 进入条件与交付物清单化
- **[S4]** 产出 `F0-closure.md`

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 新增任何 worker 代码、route、binding 或 wrangler 配置
- **[O2]** 提前实现 `orchestrator.core`
- **[O3]** 迁 live E2E、README、legacy route 行为
- **[O4]** 提前做 F4 authority helper / executor hook 代码

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `503 vs throw` 的 misconfigured deploy 风格 | `defer` | 已不再是 owner blocker，但仍属实现细节 | `F4 实现期` |
| `canonical_public` URL 具体组装位置 | `defer` | 设计已冻结语义，不必在 F0 再定实现位置 | `F3 实现期` |
| partial replay | `out-of-scope` | first-wave 只冻结 cursor/resume baseline | `下一阶段 richer relay` |
| F0 closure memo | `in-scope` | 这是 F1 入口的正式证明 | `F0 执行期` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | charter / design / qna 一致性审计 | `update` | `plan + design + FX-qna` | 证明 freeze 真正成立 | `medium` |
| P1-02 | Phase 1 | review finding 分类 | `update` | `review docs` | 把 blocking / non-blocking 边界写死 | `medium` |
| P2-01 | Phase 2 | wording 收口 | `update` | `docs/design/orchestration-facade/*` | 移除残留 owner prompts 与漂移 wording | `low` |
| P2-02 | Phase 2 | charter 对齐 | `update` | `docs/plan-orchestration-facade.md` | 让 charter 与已冻结 design 保持同口径 | `low` |
| P3-01 | Phase 3 | F1-F5 entry checklist | `update` | `action-plan pack` | 后续周期不再重复 invent start conditions | `medium` |
| P3-02 | Phase 3 | follow-up 降级清单 | `update` | `closure / action-plan notes` | 把实现期问题从 blocker 列表移走 | `low` |
| P4-01 | Phase 4 | F0 closure memo | `add` | `docs/issue/orchestration-facade/F0-closure.md` | 正式解锁 F1 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 冻结面审计

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | 一致性审计 | 核对 charter、8 份 design docs、FX-qna 是否共享同一组 frozen answers | `docs/plan-orchestration-facade.md` `docs/design/orchestration-facade/*` | 冻结真相形成单一口径 | 文档 review | 无自相矛盾结论 |
| P1-02 | review finding 分类 | 把 DeepSeek / Opus findings 标成 resolved / implementation follow-up | `docs/eval/orchestration-facade/*` | 不再把旧 blocker 留在 F1 入口 | 文档 review | 无残留 owner blocker |

### 4.2 Phase 2 — 真相同步与 wording 收口

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | design wording 收口 | 去掉旧式“待 owner 决策”尾巴，统一成 freeze 语气 | `docs/design/orchestration-facade/*` | design pack 可直接供实现消费 | 文档 review | 不再出现 owner prompt 漂移 |
| P2-02 | charter wording 收口 | 确认 charter 对 blocker / follow-up 的表述与 design pack 一致 | `docs/plan-orchestration-facade.md` | charter 成为 action-plan SSOT | 文档 review | charter 与 design 无冲突 |

### 4.3 Phase 3 — 执行清单化

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | F1-F5 进入条件清单 | 把每个周期的启动前提、输出物、退出条件整理成 checklist | `docs/action-plan/orchestration-facade/*` | 后续周期可机械执行 | 文档 review | 6 个周期均有清晰入口 |
| P3-02 | implementation follow-up 清单 | 将 `503/throw`、URL 组装、partial replay 等问题降级成实现期选择 | `closure notes` | F1 不再被伪 blocker 阻塞 | 文档 review | follow-up 不再冒充 blocker |

### 4.4 Phase 4 — F0 closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | F0 closure memo | 记录 design freeze 完成、blocker 已清、F1 已解锁 | `docs/issue/orchestration-facade/F0-closure.md` | F0 正式闭合 | 文档 review | closure 可直接被 F1 引用 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 冻结面审计

- **Phase 目标**：证明 orchestration-facade 的 design freeze 已成立
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `docs/plan-orchestration-facade.md`
  - `docs/design/orchestration-facade/*`
- **具体功能预期**：
  1. review findings 不再以“待解决 blocker”形式悬挂
  2. FX-qna 的冻结答案成为 action-plan 唯一引用口径
  3. F1-F5 的设计前提得到统一解释
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`无代码回归；做 cross-doc review`
  - **手动验证**：`逐份核对 charter / design / qna / review`
- **收口标准**：
  - 无 owner-level blocker
  - 无 design 与 charter 冲突
  - follow-up 都已降级为实现期选择
- **本 Phase 风险提醒**：
  - 最容易把 wording 收口误当成 design 修改
  - 最容易把实现期问题重新拉回 owner 决策层

### 5.2 Phase 2 — 真相同步与 wording 收口

- **Phase 目标**：把 design pack 变成真正的 execution-facing 文档集
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `docs/plan-orchestration-facade.md`
  - `docs/design/orchestration-facade/*`
- **具体功能预期**：
  1. 所有 freeze 语义都以当前 SSOT 呈现
  2. 不再保留“是否接受”“待 owner 决定”式旧提示
  3. F1-F5 后续 action-plan 可直接引用这些文档
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`文档 review`
  - **手动验证**：`grep 检查残留 placeholder / owner prompt`
- **收口标准**：
  - design pack 语言统一
  - charter 语言统一
  - 无多套“当前建议”并存
- **本 Phase 风险提醒**：
  - 最容易误删本该保留的 implementation follow-up

### 5.3 Phase 3 — 执行清单化

- **Phase 目标**：把 F1-F5 的实施入口、边界和交付物机械化
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`
  - `docs/action-plan/orchestration-facade/F2-session-seam-completion.md`
  - `docs/action-plan/orchestration-facade/F3-canonical-cutover-and-legacy-retirement.md`
  - `docs/action-plan/orchestration-facade/F4-authority-hardening.md`
  - `docs/action-plan/orchestration-facade/F5-closure-and-handoff.md`
- **本 Phase 修改文件**：
  - `本文件`
- **具体功能预期**：
  1. 每个周期都有清晰 start / done 条件
  2. 实现期 follow-up 不再阻挡 F1 起跑
  3. action-plan 体系成为后续工作的唯一执行入口
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`文档交叉核对`
  - **手动验证**：`逐份 action-plan 检查 phase 依赖与 exit criteria`
- **收口标准**：
  - 6 份 action-plan 齐备
  - 无 phase 依赖冲突
  - F1 入口清晰
- **本 Phase 风险提醒**：
  - 最容易在 F2/F3/F4 之间重复写同一类任务

### 5.4 Phase 4 — F0 closure

- **Phase 目标**：正式宣布 design freeze 完成
- **本 Phase 对应编号**：
  - `P4-01`
- **本 Phase 新增文件**：
  - `docs/issue/orchestration-facade/F0-closure.md`
- **本 Phase 修改文件**：
  - `无`
- **具体功能预期**：
  1. closure memo 清楚说明 F0 的交付物
  2. 明确 F1 已解锁
  3. implementation follow-up 被正确记录为下游事项
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`无代码回归`
  - **手动验证**：`closure 内容与 action-plan pack 逐项对应`
- **收口标准**：
  - F0 closure 可直接被 F1 引用
  - 无需再回头补 owner 决策
- **本 Phase 风险提醒**：
  - 最容易把 F0 closure 写成“设计总结”，而不是“执行入口证明”

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 当前结论

本阶段 **无新增 owner-level blocker**。  
F0 直接消费 `docs/design/orchestration-facade/FX-qna.md` 中已冻结的 Q1-Q8 答案，不再额外开题。

### 6.2 问题整理建议

- 仍存在的 `503 vs throw`、URL 组装、partial replay 等事项，都应在对应实现期处理
- 若后续有人试图把这些实现期选择重新升级为 blocker，应先回看 `FX-qna.md` 与本 action-plan 的边界定义

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| wording 看似已收口但仍有多套 SSOT | design / charter / qna 分开演进过一轮 | `medium` | Phase 1 先做 cross-doc audit |
| follow-up 与 blocker 再次混淆 | reviewer 指出的 implementation choice 被误当 phase gate | `medium` | Phase 2/3 明确降级清单 |
| F1 过早启动 | 若没有 F0 closure，后续实现容易绕过 freeze discipline | `high` | 必须先产 `F0-closure.md` |

### 7.2 约束与前提

- **技术前提**：`8 份 design docs + FX-qna 已存在，且 review absorption 已完成`
- **运行时前提**：`当前不要求任何 worker 代码变更或 deploy 行为`
- **组织协作前提**：`owner / Opus 的 frozen answers 以 FX-qna 为唯一口径`
- **上线 / 合并前提**：`F0 closure 必须先于 F1 bring-up`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/plan-orchestration-facade.md`
  - `docs/design/orchestration-facade/*`
- 需要同步更新的说明文档 / README：
  - `无`
- 需要同步更新的测试说明：
  - `无`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `charter / design / FX-qna / review findings 无冲突`
  - `6 份 action-plan 已形成连续执行链`
- **单元测试**：
  - `无`
- **集成测试**：
  - `无`
- **端到端 / 手动验证**：
  - `人工核对 F1-F5 的入口与出口条件`
- **回归测试**：
  - `文档 grep / cross-read`
- **文档校验**：
  - `F0 closure 与 F1 action-plan 可彼此直接引用`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `F0 blocker 已全部清空`
2. `FX-qna 成为唯一 frozen answer source`
3. `F1-F5 的执行入口、输出物、退出条件都已明确`
4. `implementation follow-up 不再冒充设计阻塞`
5. `F0-closure.md 正式解锁 F1`

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `F0 成功把 design pack 压成 execution-facing freeze baseline` |
| 测试 | `文档交叉核对后无 blocker / 无冲突` |
| 文档 | `charter + design + FX-qna + F0 closure 同步完成` |
| 风险收敛 | `设计期问题与实现期问题已分层` |
| 可交付性 | `F1 可立即启动且不需再回头问 owner` |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`Phase 2 wording 收口若反复触及 design substance，说明 F0 前审计不够细`
- **哪些编号的拆分还不够合理**：`若 P3-01 / P3-02 仍混杂 blocker 与 follow-up，应再细拆`
- **哪些问题本应更早问架构师**：`若 F1 又冒出 owner blocker，说明 FX-qna 覆盖仍不足`
- **哪些测试安排在实际执行中证明不够**：`若 F1 仍需回头补 F0 文档校验，说明 F0 closure 标准偏弱`
- **模板本身还需要补什么字段**：`future 可增加“frozen answers consumed from QNA”专门字段`

---

## 10. 结语

这份 action-plan 以 **把 design pack 真正冻结成可执行真相层** 为第一优先级，采用 **先审计、再收口、最后 closure** 的推进方式，优先解决 **design blocker 与 implementation follow-up 混淆** 以及 **F1 入口不够机械化** 两个问题，并把 **不偷渡实现工作** 作为主要约束。整个计划完成后，`orchestration-facade / F0` 应达到 **正式解锁 F1 的 freeze-ready 状态**，从而为后续的 **orchestrator bring-up、session seam completion、cutover、authority hardening 与 final closure** 提供稳定基础。
