# Z5 — Closure and Handoff

> 服务业务簇: `zero-to-real / Z5 / closure-and-handoff`
> 计划对象: `汇总 Z0-Z4 的交付、验证、残留问题，并形成 zero-to-real 最终 closure 与 handoff`
> 类型: `update`
> 作者: `GPT-5.4`
> 时间: `2026-04-25`
> 文件位置: `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md`
> 关联设计 / 调研文档:
> - `docs/charter/plan-zero-to-real.md`
> - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md`
> - `docs/design/zero-to-real/ZX-qna.md`
> - `docs/issue/zero-to-real/Z0-closure.md`
> - `docs/issue/zero-to-real/Z1-closure.md`
> - `docs/issue/zero-to-real/Z2-closure.md`
> - `docs/issue/zero-to-real/Z3-closure.md`
> - `docs/issue/zero-to-real/Z4-closure.md`
> 文档状态: `executed`

---

## 0. 执行背景与目标

Z5 是 zero-to-real 的总收口 phase。它不负责代替 Z1-Z4 做实现，也不负责“把所有不完美都修干净”。它的职责是回答三个最终问题：**zero-to-real 到底交付了什么、哪些证据足够证明这不是 mock、哪些 residual 已诚实划给下一阶段**。如果没有 Z5，前四个 phase 即使都做了工作，也只会留下分散 closure、碎片 evidence 和没有排序的遗留清单。

因此 Z5 的目标是建立一套正式的阶段结论资产：`Z5-closure.md`、`zero-to-real-final-closure.md`、`zero-to-real-to-next-phase.md`，并把 Z4 的真实运行证据、Z1-Z3 的 durability/auth/runtime 证明、以及 remaining residuals 整合成一个可交接的 handoff pack。

- **服务业务簇**：`zero-to-real / Z5`
- **计划对象**：`Closure and Handoff`
- **本次计划解决的问题**：
  - Z0-Z4 可能各自完成，但没有统一最终 verdict
  - residual / deferred / out-of-scope items 缺少统一 handoff 入口
  - 下一个阶段需要一份能直接消费的总结，而不是重新读完整个设计与 action-plan 树
- **本次计划的直接产出**：
  - `docs/issue/zero-to-real/Z5-closure.md`
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
  - `docs/handoff/zero-to-real-to-next-phase.md`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先汇总 phase closures 与证据，再做阶段 verdict，再产出 handoff pack** 的方式推进。Z5 不再写业务实现，而是执行一轮严格的 completion audit：每个 exit criterion 是否被具体证据支撑；若没有，就回退到 owning phase，而不是在 Z5 里强行盖章。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Completion Audit | `S` | 汇总 Z0-Z4 closure、tests、real-run evidence，检查 charter exit criteria | `Z0-Z4 closed` |
| Phase 2 | Final Verdict | `S` | 形成 zero-to-real 的整体完成判断、价值判断与残留问题边界 | `Phase 1` |
| Phase 3 | Handoff Pack | `S` | 写 final closure、next-phase handoff、residual register | `Phase 2` |

### 1.3 Phase 说明

1. **Phase 1 — Completion Audit**
   - **核心目标**：确认 Z0-Z4 的 closure 不是口头成立，而是被 tests/evidence 支撑。
   - **为什么先做**：没有 audit，Z5 只能重复摘要，不能给 verdict。
2. **Phase 2 — Final Verdict**
   - **核心目标**：判断 zero-to-real 是否真正完成了“从 0 到可真实运行”的承诺。
   - **为什么放在这里**：必须建立在 completion audit 之上。
3. **Phase 3 — Handoff Pack**
   - **核心目标**：把 residuals、deferred items、next-phase 建议压成可直接消费的 handoff。
   - **为什么放在最后**：先有 verdict，再决定怎样交接。

### 1.4 执行策略说明

- **执行顺序原则**：`先审计，再判定，再交接`
- **风险控制原则**：`Z5 不修正文实现；发现 blocker 时回退到 owning phase`
- **测试推进原则**：`复用 Z1-Z4 已有 automated tests 与 Z4 real-run evidence，不在 Z5 invent 新证明方式`
- **文档同步原则**：`charter exit criteria、phase closures、real-run evidence、handoff pack 一致`

### 1.5 本次 action-plan 影响目录树

```text
Z5 Closure and Handoff
├── docs/
│   ├── issue/zero-to-real/
│   │   ├── Z0-closure.md ... Z4-closure.md    [inputs]
│   │   ├── Z5-closure.md                     [new]
│   │   └── zero-to-real-final-closure.md    [new]
│   ├── handoff/
│   │   └── zero-to-real-to-next-phase.md    [new]
│   └── eval/zero-to-real/
│       └── first-real-run-evidence.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 汇总并审计 Z0-Z4 closure、tests、evidence 是否支持 charter exit criteria
- **[S2]** 形成 zero-to-real 最终 verdict
- **[S3]** 输出 final closure 与 next-phase handoff
- **[S4]** 把 remaining residuals / deferreds / out-of-scope items 归档成统一 register

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 修补 Z1-Z4 的新实现 bug
- **[O2]** 重写 zero-to-real charter 或 design 包
- **[O3]** 提前创建下一阶段的 design/action-plan 正文
- **[O4]** 把 residual 全部清零

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| final closure | `in-scope` | Z5 的核心输出之一 | `Z5 执行期` |
| next-phase handoff | `in-scope` | 没有 handoff，zero-to-real 无法形成阶段交接 | `Z5 执行期` |
| 新实现代码修复 | `out-of-scope` | 应回退到 owning phase，而不是在 Z5 偷修 | `发现 blocker 时` |
| 下一阶段 charter 正文 | `out-of-scope` | Z5 只交接，不代写下一阶段 | `下一阶段启动时` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | completion audit | `update` | `docs/issue/zero-to-real/Z0-closure.md ... Z4-closure.md` `tests/evidence` | 审计前四阶段是否真完成 | `medium` |
| P1-02 | Phase 1 | charter exit check | `update` | `docs/charter/plan-zero-to-real.md` | 用 charter exit criteria 做最终检查 | `medium` |
| P2-01 | Phase 2 | final verdict memo | `add` | `docs/issue/zero-to-real/Z5-closure.md` | 给出阶段总体 verdict | `low` |
| P2-02 | Phase 2 | final closure | `add` | `docs/issue/zero-to-real/zero-to-real-final-closure.md` | 汇总零到真实的总交付 | `low` |
| P3-01 | Phase 3 | next-phase handoff | `add` | `docs/handoff/zero-to-real-to-next-phase.md` | 把 residual 与建议交给下一阶段 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Completion Audit

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | completion audit | 汇总 Z0-Z4 closure、`pnpm test:package-e2e`、`pnpm test:cross-e2e`、全量回归结果与 Z4 evidence | `docs/issue/zero-to-real/Z0-closure.md` ... `Z4-closure.md` | 知道哪些交付有证据、哪些没有 | doc review | 每个阶段都有 deliverables/tests/evidence 映射 |
| P1-02 | charter exit check | 对照 charter `§10.1 Primary Exit Criteria` 逐条判断成立与否 | `docs/charter/plan-zero-to-real.md` | Z5 的 verdict 有客观标尺 | doc review | 不再出现“感觉已完成”的表述 |

### 4.2 Phase 2 — Final Verdict

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | final verdict memo | 写 `Z5-closure.md`，说明 zero-to-real 是否完成、完成到什么程度 | `docs/issue/zero-to-real/Z5-closure.md` | 阶段 verdict 清晰 | doc review | verdict 有 evidence 支撑且诚实陈述 residual |
| P2-02 | final closure | 写 `zero-to-real-final-closure.md`，按总交付视角汇总 auth/session/runtime/clients/evidence | `docs/issue/zero-to-real/zero-to-real-final-closure.md` | 项目层 closure 成立 | doc review | final closure 可单独被下一阶段阅读消费 |

### 4.3 Phase 3 — Handoff Pack

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | next-phase handoff | 写 `zero-to-real-to-next-phase.md`，列出 residuals、deferreds、推荐顺序、风险提醒 | `docs/handoff/zero-to-real-to-next-phase.md` | 下一阶段不需重新清点残局 | doc review | handoff 具备 ready-to-consume 结构 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Completion Audit

- **Phase 目标**：把 Z0-Z4 的零散完成状态压成一个可判定的审计结果
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `无`
- **具体功能预期**：
  1. 每个 phase 的 deliverable/test/evidence 都能被列出。
  2. charter exit criteria 有具体映射。
  3. 若发现 blocker，能够明确回退到 owning phase。
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`复核 Z1-Z4 已有 automated results`
  - **手动验证**：`逐份 closure/evidence 审阅`
- **收口标准**：
  - Z0-Z4 都有 closure inputs
  - tests/evidence 对应关系清晰
  - blocker 与 residual 被分开
- **本 Phase 风险提醒**：
  - 最容易把“仍待修复的 blocker”误记成 residual

### 5.2 Phase 2 — Final Verdict

- **Phase 目标**：给 zero-to-real 一个基于证据的阶段结论
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `docs/issue/zero-to-real/Z5-closure.md`
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
- **本 Phase 修改文件**：
  - `无`
- **具体功能预期**：
  1. 能回答“这个阶段是否真的从 0 走到了 real”。
  2. 能说明 auth/session/runtime/clients 哪些已经成为真实系统资产。
  3. 能诚实写出 residual 和 trade-off。
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`以 Z1-Z4 已有自动化结果为输入`
  - **手动验证**：`final closure 与 evidence/charter 对照`
- **收口标准**：
  - verdict 与 evidence 对齐
  - final closure 可单独阅读
  - 没有“无证据完成”的条目
- **本 Phase 风险提醒**：
  - 最容易因为阶段结束压力而写出过满结论

### 5.3 Phase 3 — Handoff Pack

- **Phase 目标**：把 zero-to-real 的剩余工作变成下一阶段的起跑线，而不是烂尾清单
- **本 Phase 对应编号**：
  - `P3-01`
- **本 Phase 新增文件**：
  - `docs/handoff/zero-to-real-to-next-phase.md`
- **本 Phase 修改文件**：
  - `无`
- **具体功能预期**：
  1. residual / deferred / next-phase required 被清晰分组。
  2. 下一阶段知道先吃什么、为什么、依赖什么。
  3. handoff 文档可替代重新通读整棵 zero-to-real 文档树。
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`无`
  - **手动验证**：`handoff 对照 Z5/final closure`
- **收口标准**：
  - handoff 文档存在
  - residuals 有优先级与 owner 建议
  - 下一阶段入口不含模糊措辞
- **本 Phase 风险提醒**：
  - 最容易把“后续建议”写成“必须立即做”，导致 handoff 失真

---

## 6. 风险与依赖

| 风险 / 依赖 | 描述 | 缓解方式 |
|-------------|------|----------|
| 阶段完成度被高估 | 前序 closure 可能表述偏满 | Z5 以 tests/evidence/charter exit criteria 复核，而非信任摘要 |
| residual 与 blocker 混淆 | 会导致下一阶段入口错误 | completion audit 中强制分类：blocked / residual / deferred |
| handoff 过于宽泛 | 下阶段仍需重做清点 | 输出明确排序、风险与输入文档路径 |

---

## 7. 完成后的预期状态

Z5 完成后，项目将拥有：

1. zero-to-real 阶段的正式 verdict
2. final closure 与 handoff 资产
3. 基于证据的 residual register
4. 可以直接衔接下一阶段的起跑线

---

## 8. 本计划完成后立即解锁的后续动作

1. 依据 `zero-to-real-to-next-phase.md` 启动下一阶段 charter / design
2. 把 blocked / residual / deferred 条目转成新的 plan/action-plan 输入
3. 将 zero-to-real 视为已闭合历史阶段，而不是继续漂移中的 work-in-progress

---

## 9. 工作日志回填

> 执行者: `GPT-5.4`
> 执行状态: `executed`
> 关联 closure: `docs/issue/zero-to-real/Z5-closure.md`
> 关联 final memo: `docs/issue/zero-to-real/zero-to-real-final-closure.md`
> 关联 handoff: `docs/handoff/zero-to-real-to-next-phase.md`

### 9.1 Completion audit

- 重新审阅并交叉对照：
  - `docs/issue/zero-to-real/Z0-closure.md`
  - `docs/issue/zero-to-real/Z1-closure.md`
  - `docs/issue/zero-to-real/Z2-closure.md`
  - `docs/issue/zero-to-real/Z3-closure.md`
  - `docs/issue/zero-to-real/Z4-closure.md`
  - `docs/charter/plan-zero-to-real.md`
  - `docs/design/zero-to-real/ZX-qna.md`
- 逐条按 charter `§10.1 Primary Exit Criteria` 复核 zero-to-real 是否具备：
  - 完整 end-user auth truth
  - multi-tenant / NACP compliance runtime truth
  - session durable truth
  - Workers AI + quota runtime truth
  - web / Mini Program first-wave real-client baseline
  - 明确 backlog register
- 本轮判断：zero-to-real 不再存在“是否已经 first real run”这一类未定义 blocker；剩余项均可压入 next-phase backlog。

### 9.2 补充验证与 closeout 证据

- 在 final closure 落笔前重新执行一轮 broad local validation：
  - `orchestrator-auth` / `orchestrator-core` / `agent-core` typecheck + test
  - `bash-core` / `context-core` / `filesystem-core` test
  - root `pnpm test:contracts`
  - `clients/web` typecheck + Mini Program syntax check
- 补做 preview live smoke：
  - `NANO_AGENT_LIVE_E2E=1 node --test test/package-e2e/orchestrator-core/{01,02,03,04,05,07}-*.test.mjs test/cross-e2e/*.test.mjs`
  - 结果：`28 / 28 pass`
- 补做 preview D1 SQL spot-check：
  - `PRAGMA table_info(nano_usage_events);`
  - anchor row lookup for `usage_event_uuid=37bece21-987e-4f69-ad9b-5543f64c1359`
  - core table counts lookup
- 新增 closeout evidence artifact：
  - `docs/eval/zero-to-real/evidence/z5-213260f5-9ff9-4c41-b52f-f9ee11b1ce2e.json`
- 更新聚合 evidence 文档：
  - `docs/eval/zero-to-real/first-real-run-evidence.md` 新增 Z5 closeout supplemental validation section

### 9.3 阶段输出

- 新增：
  - `docs/issue/zero-to-real/Z5-closure.md`
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
  - `docs/handoff/zero-to-real-to-next-phase.md`
- 在这些文档中完成：
  - phase closure mapping
  - charter exit criteria audit
  - closeout validation evidence
  - unified residual register
  - next-phase ready backlog order

### 9.4 新增 / 修改文件列表

- 新增：
  - `docs/issue/zero-to-real/Z5-closure.md`
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
  - `docs/handoff/zero-to-real-to-next-phase.md`
  - `docs/eval/zero-to-real/evidence/z5-213260f5-9ff9-4c41-b52f-f9ee11b1ce2e.json`
- 修改：
  - `docs/eval/zero-to-real/first-real-run-evidence.md`
  - `docs/action-plan/zero-to-real/Z5-closure-and-handoff.md`

### 9.5 收口意见

- Z5 没有偷渡新的实现 phase，而是严格按照 action-plan 做了：
  - completion audit
  - charter exit check
  - closeout validation
  - final verdict
  - handoff pack
- 当前仍保留的 transport/client/registry/manual-evidence 问题已经被压成明确 backlog，不再阻塞 zero-to-real 作为历史阶段正式闭合。
