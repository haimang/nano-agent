# W0 — NACP Protocol Consolidation

> 服务业务簇: `pre-worker-matrix / W0 / nacp-consolidation`
> 计划对象: `把 Tier A cross-worker vocabulary 收束进 nacp-core`
> 类型: `migration`
> 作者: `GPT-5.4`
> 时间: `2026-04-21`
> 文件位置: `docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md`
> 关联设计 / 调研文档:
> - `docs/plan-pre-worker-matrix.md`
> - `docs/design/pre-worker-matrix/W0-nacp-consolidation.md`
> - `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

W0 是 pre-worker-matrix 的最前置执行计划。它不新增跨 worker 行为，也不触碰 worker-matrix 的 live loop；它只做一件事：把已经散落在 `session-do-runtime`、`workspace-context-artifacts`、`hooks`、`storage-topology` 里的 **Tier A vocabulary / helper-adjacent shape** 物理归位到 `@nano-agent/nacp-core`，让后续 W1-W4 都能围绕统一协议真理源推进。

这份 action-plan 的目标不是“扩张 nacp-core 成为大运行时核心”，而是严格按 narrowed design 执行：**只搬 wire-level / contract-adjacent truth，不搬 runtime class，不改语义，不破坏现有消费者。**

- **服务业务簇**：`pre-worker-matrix / W0`
- **计划对象**：`NACP Protocol Consolidation`
- **本次计划解决的问题**：
  - `cross-worker vocabulary 仍分散在多个 Tier B package`
  - `W1/W2/W3/W4 缺少单一协议真理源`
  - `nacp-core 对外发布前缺少完整 Tier A surface`
- **本次计划的直接产出**：
  - `nacp-core/evidence transport hooks-catalog storage-law 子目录`
  - `原位置 re-export / deprecated 兼容层`
  - `W0 closure memo + 1.4.0 级别文档收口`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先 contract-adjacent shape、再 compat、最后版本与文档收口** 的方式推进。先把真正该进 NACP 的 vocabulary 落位，再补原位置 re-export 和顶层导出，最后做 CHANGELOG / RFC / closure，避免一开始就把 regression 面和版本面混在一起。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | 吸收协议形态 | `M` | 把 evidence/transport/storage-law 的 shape 搬进 `nacp-core` | `-` |
| Phase 2 | 吸收词表与导出 | `M` | 补 hooks catalog / evidence vocabulary / 顶层 export | `Phase 1` |
| Phase 3 | 兼容与回归 | `M` | 原位置 re-export、消费者零破坏、测试回归 | `Phase 2` |
| Phase 4 | 版本与收口 | `S` | CHANGELOG / RFC / closure 对齐 | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — 吸收协议形态**
   - **核心目标**：落 `transport/cross-seam.ts`、`evidence/sink-contract.ts`、`storage-law/*`
   - **为什么先做**：这些是 W1/W2/W4 最直接依赖的基础 contract
2. **Phase 2 — 吸收词表与导出**
   - **核心目标**：补 `evidence/vocabulary.ts`、`hooks-catalog/`
   - **为什么放在这里**：先有 shape 落点，再补 vocabulary 更不容易误搬 runtime 逻辑
3. **Phase 3 — 兼容与回归**
   - **核心目标**：原位置改 re-export，保证 1.3 消费者继续可用
   - **为什么放在这里**：只有在目标落点稳定后，compat 层才不会反复返工
4. **Phase 4 — 版本与收口**
   - **核心目标**：完成 1.4.0 级别文档、变更说明与 W0 closure
   - **为什么放在这里**：把代码事实与文档事实一起冻结，供 W1-W4 消费

### 1.4 执行策略说明

- **执行顺序原则**：`先搬 shape，再做 compat，最后改版本与文档`
- **风险控制原则**：`严格区分 vocabulary 与 runtime，不把 class/dispatcher/emitter 一并搬进 nacp-core`
- **测试推进原则**：`每类吸收后做 package-level 回归，最终跑 root/cross/B7 LIVE`
- **文档同步原则**：`CHANGELOG / consolidation RFC / W0 closure 同步更新`

### 1.5 本次 action-plan 影响目录树

```text
W0 NACP Protocol Consolidation
├── Phase 1: 吸收协议形态
│   ├── packages/nacp-core/src/transport/
│   ├── packages/nacp-core/src/evidence/
│   └── packages/nacp-core/src/storage-law/
├── Phase 2: 吸收词表与导出
│   ├── packages/nacp-core/src/hooks-catalog/
│   ├── packages/nacp-core/src/evidence/vocabulary.ts
│   └── packages/nacp-core/src/index.ts
├── Phase 3: 兼容与回归
│   ├── packages/session-do-runtime/src/
│   ├── packages/workspace-context-artifacts/src/
│   ├── packages/hooks/src/
│   └── packages/storage-topology/src/
└── Phase 4: 版本与收口
    ├── packages/nacp-core/CHANGELOG.md
    ├── docs/rfc/
    └── docs/issue/pre-worker-matrix/
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 吸收 `CrossSeamAnchor` propagation shape 与 header law 到 `nacp-core`
- **[S2]** 吸收 evidence sink contract types、`extractMessageUuid` helper、evidence vocabulary
- **[S3]** 吸收 hooks wire-level event vocabulary 与 storage-law builders/constants
- **[S4]** 原位置 re-export、顶层导出、CHANGELOG / closure / regression 收口

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 搬 `BoundedEvalSink` class、startup queue、failure taxonomy 等 runtime 实现
- **[O2]** 搬 `emit*Evidence()`、hook dispatch、storage adapters 等逻辑层代码
- **[O3]** 设计任何新跨 worker 协议或 matrix entry（属 W1）
- **[O4]** 做 worker 级 absorption、发布流水线、deploy 脚手架（属 W2-W4）

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `BoundedEvalSink` class 本体 | `out-of-scope` | 它是 runtime class，不是协议词表 | `worker-matrix agent-core absorption` |
| `evidence vocabulary` | `in-scope` | 它是 W1 RFC 与 W4/W5 closure 的共同 shape 依据 | `W0 执行期` |
| `hooks runtime metadata` | `out-of-scope` | `blocking/allowedOutcomes/redactionHints` 属 hooks runtime | `agent-core absorption` |
| `storage-law builders/constants` | `in-scope` | 是 cross-worker ref/key/tenant truth 的 NACP 家 | `W0 执行期` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | cross-seam 落位 | `add` | `packages/nacp-core/src/transport/cross-seam.ts` | 固化 propagation truth | `medium` |
| P1-02 | Phase 1 | sink-contract 落位 | `add` | `packages/nacp-core/src/evidence/sink-contract.ts` | 固化 sink shape，不搬 class | `medium` |
| P1-03 | Phase 1 | storage-law 落位 | `add` | `packages/nacp-core/src/storage-law/*` | 固化 builders / `_platform` law | `medium` |
| P2-01 | Phase 2 | evidence vocabulary 落位 | `add` | `packages/nacp-core/src/evidence/vocabulary.ts` | 固化 4 类 evidence shape | `medium` |
| P2-02 | Phase 2 | hooks-catalog 落位 | `add` | `packages/nacp-core/src/hooks-catalog/*` | 固化 hook event vocabulary | `medium` |
| P2-03 | Phase 2 | top-level exports | `update` | `packages/nacp-core/src/index.ts` | 暴露 W0 新 surface | `low` |
| P3-01 | Phase 3 | 原位置 re-export | `update` | `session-do-runtime/workspace-context-artifacts/hooks/storage-topology` | 保持旧消费者不 break | `high` |
| P3-02 | Phase 3 | regression 回归 | `update` | `packages/* test/*` | 证明 additive / non-breaking | `high` |
| P4-01 | Phase 4 | CHANGELOG + RFC | `update` | `packages/nacp-core/CHANGELOG.md docs/rfc/*` | 冻结 1.4.0 叙事 | `low` |
| P4-02 | Phase 4 | W0 closure memo | `add` | `docs/issue/pre-worker-matrix/W0-closure.md` | 给 W5 提供 phase 证据 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 吸收协议形态

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | cross-seam 落位 | 只搬 anchor/header propagation truth，不搬 runtime taxonomy | `nacp-core/src/transport/` | `CrossSeamAnchor` 成为 NACP truth | package typecheck/build | 新落点可被下游 import |
| P1-02 | sink-contract 落位 | 只搬 types + helper + dedup contract 文档 | `nacp-core/src/evidence/` | sink contract 成为 NACP truth | package typecheck/build | 无 class 膨胀 |
| P1-03 | storage-law 落位 | 搬 builder helpers 与 `_platform` 常量 | `nacp-core/src/storage-law/` | ref/key law 落到单一中心 | package typecheck/build | 不重复定义 `NacpRefSchema` |

### 4.2 Phase 2 — 吸收词表与导出

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | evidence vocabulary 落位 | 提取 4 类 evidence record shape | `nacp-core/src/evidence/vocabulary.ts` | W1/W5 可统一引用 | nacp-core tests | shape 与原 helper 输出一致 |
| P2-02 | hooks-catalog 落位 | 吸收事件名与 payload schema，不带 runtime meta | `nacp-core/src/hooks-catalog/` | hook vocabulary 成为 NACP truth | package tests | 18 events 对齐当前 reality |
| P2-03 | 顶层导出 | 补 nacp-core public exports | `nacp-core/src/index.ts` | 消费者可统一从包顶层 import | typecheck/build | 无遗漏导出 |

### 4.3 Phase 3 — 兼容与回归

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | 原位置 re-export | 原文件切为 re-export + deprecated JSDoc | 4 个源 package | 旧 import path 继续可用 | package tests | 消费者零破坏 |
| P3-02 | regression 回归 | 跑 package/root/cross/B7 LIVE | `packages/* test/*` | additive minor bump 成立 | 现有测试脚本 | 全绿 |

### 4.4 Phase 4 — 版本与收口

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | CHANGELOG + RFC | 更新 1.4.0 变更说明与 consolidation RFC | `CHANGELOG.md docs/rfc/*` | 文档与代码一致 | 文档核对 | 1.4.0 叙事冻结 |
| P4-02 | W0 closure | 写 phase closure memo | `docs/issue/pre-worker-matrix/W0-closure.md` | W5 可直接消费 | 文档核对 | 证据链完整 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 吸收协议形态

- **Phase 目标**：先把最核心、最窄的 contract 落到 `nacp-core`
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - `packages/nacp-core/src/transport/cross-seam.ts`
  - `packages/nacp-core/src/evidence/sink-contract.ts`
  - `packages/nacp-core/src/storage-law/platform.ts`
  - `packages/nacp-core/src/storage-law/builders.ts`
- **本 Phase 修改文件**：
  - `packages/nacp-core/src/index.ts`
- **具体功能预期**：
  1. cross-seam / sink / storage-law 都拥有明确新家
  2. 不引入 runtime class 膨胀
  3. 为 Phase 2/3 的 compat 做稳定目标
- **具体测试安排**：
  - **单测**：`nacp-core` 相关新增测试
  - **集成测试**：暂不新增，延到 compat 后统一回归
  - **回归测试**：`pnpm --filter @nano-agent/nacp-core typecheck build test`
  - **手动验证**：核对新旧 symbol 列表
- **收口标准**：
  - 新子目录与命名冻结
  - 无 runtime code 越界搬迁
  - `nacp-core` 局部回归通过
- **本 Phase 风险提醒**：
  - 容易把 helper 与 runtime implementation 一起搬错
  - 容易重复定义已有 NACP schema

### 5.2 Phase 2 — 吸收词表与导出

- **Phase 目标**：补齐 evidence / hooks 两类 vocabulary，并对外导出
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `packages/nacp-core/src/evidence/vocabulary.ts`
  - `packages/nacp-core/src/hooks-catalog/index.ts`
- **本 Phase 修改文件**：
  - `packages/nacp-core/src/index.ts`
- **具体功能预期**：
  1. W1 RFC 可直接引用 W0 shipped vocabulary
  2. hooks event reality 与当前 18-event 代码对齐
  3. 顶层 import 面一次到位
- **具体测试安排**：
  - **单测**：新增 vocabulary schema tests
  - **集成测试**：与原 helper 输出/消费面核对
  - **回归测试**：`pnpm --filter @nano-agent/nacp-core test`
  - **手动验证**：核对 top-level exports
- **收口标准**：
  - 4 类 evidence / hooks vocab 均可从 `@nano-agent/nacp-core` 导出
  - 无 runtime meta 混入
- **本 Phase 风险提醒**：
  - hook event reality 以当前代码为准，不以旧文案为准

### 5.3 Phase 3 — 兼容与回归

- **Phase 目标**：让旧消费者继续工作，证明 W0 是 additive
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `packages/session-do-runtime/src/*`
  - `packages/workspace-context-artifacts/src/*`
  - `packages/hooks/src/*`
  - `packages/storage-topology/src/*`
- **具体功能预期**：
  1. 原位置保留 re-export
  2. 旧 import path 不需要立刻改
  3. 回归面证明 1.3 → 1.4 additive 成立
- **具体测试安排**：
  - **单测**：各 package 现有 test
  - **集成测试**：root tests / cross tests
  - **回归测试**：`pnpm -r run test`、`node --test test/*.test.mjs`、`npm run test:cross`
  - **手动验证**：B7 LIVE contract 仍绿
- **收口标准**：
  - 全仓回归通过
  - re-export 路径成立
- **本 Phase 风险提醒**：
  - compat 层最容易出现漏导出或错误导出

### 5.4 Phase 4 — 版本与收口

- **Phase 目标**：把代码结果收进 1.4.0 文档与 phase memo
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `docs/issue/pre-worker-matrix/W0-closure.md`
- **本 Phase 修改文件**：
  - `packages/nacp-core/CHANGELOG.md`
  - `docs/rfc/nacp-core-1-4-consolidation.md`
- **具体功能预期**：
  1. 版本说明与代码 reality 一致
  2. W5 有直接可消费的 phase evidence
- **具体测试安排**：
  - **单测**：无新增
  - **集成测试**：无新增
  - **回归测试**：引用 Phase 3 结果
  - **手动验证**：核对 closure 与 CHANGELOG 引用链
- **收口标准**：
  - 1.4.0 叙事完整
  - W0 closure 可被 W5 引用
- **本 Phase 风险提醒**：
  - 文档若不跟 v0.2 narrowed scope 对齐，会再次把 runtime 搬错

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 4`
- **为什么必须确认**：`关系到 1.4.0 的最终 scope 与 CHANGELOG 描述`
- **当前建议 / 倾向**：`维持 1.4.0，仅承载 W0 narrower，不把 W1 RFC-only 内容写入已 ship symbol`
- **Q**：`W0 完成后，是否明确将 nacp-core 版本线固定为 1.4.0，而不为 W1 预留额外 bump？`
- **A**：`待 owner 决定`

#### Q2

- **影响范围**：`Phase 3`
- **为什么必须确认**：`影响 compat 窗口和后续 worker-matrix cutover 节奏`
- **当前建议 / 倾向**：`原位置至少保留 3 个月 re-export / deprecated 窗口`
- **Q**：`W0 产生的旧路径 re-export，是否按 design 建议保留至少 3 个月？`
- **A**：`待 owner 决定`

### 6.2 问题整理建议

- 优先确认版本与 compat 窗口
- 不在 W0 阶段引入新的协议设计问题

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| vocabulary / runtime 混搬 | 最容易让 `nacp-core` 失控膨胀 | `high` | 按 W0 narrowed design 逐类核对 |
| compat 漏项 | 原位置 re-export 不完整会造成隐性 break | `high` | Phase 3 统一跑全仓回归 |
| 文档叙事漂移 | CHANGELOG / closure 若沿用旧 scope 会误导 W1-W5 | `medium` | 以 v0.2 narrowed wording 为准 |

### 7.2 约束与前提

- **技术前提**：`nacp-core/nacp-session 当前已 1.3.0 shipped`
- **运行时前提**：`B7 LIVE contract 必须继续可用`
- **组织协作前提**：`owner 接受 W0 narrowed 边界`
- **上线 / 合并前提**：`全仓现有测试通过`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/pre-worker-matrix/W0-nacp-consolidation.md`
  - `docs/design/pre-worker-matrix/W5-closure-and-handoff.md`
- 需要同步更新的说明文档 / README：
  - `packages/nacp-core/CHANGELOG.md`
- 需要同步更新的测试说明：
  - `docs/issue/pre-worker-matrix/W0-closure.md`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `pnpm --filter @nano-agent/nacp-core typecheck build test`
  - `pnpm --filter @nano-agent/nacp-session typecheck build test`
- **单元测试**：
  - `新增 vocabulary / hooks-catalog / storage-law 局部测试`
- **集成测试**：
  - `消费者经旧路径与新路径都可 resolve`
- **端到端 / 手动验证**：
  - `B7 LIVE contract 仍绿`
- **回归测试**：
  - `pnpm -r run test`
  - `node --test test/*.test.mjs`
  - `npm run test:cross`
- **文档校验**：
  - `CHANGELOG / RFC / W0 closure 与代码路径一致`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. W0 Tier A vocabulary 全部落入 `nacp-core`
2. 原消费者继续可用，无强制同步改 import
3. 现有测试与 B7 LIVE 不退化
4. 1.4.0 文档叙事与实际代码一致
5. W5 可直接消费 W0 closure

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `Tier A shape 全部有稳定新家，且未越界搬 runtime` |
| 测试 | `package/root/cross/B7 LIVE 全部维持通过` |
| 文档 | `CHANGELOG / RFC / closure 全对齐` |
| 风险收敛 | `compat 与 vocabulary/runtime 边界无明显残缺` |
| 可交付性 | `W1-W4 可直接引用 W0 产出推进` |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待执行后回填`
- **哪些编号的拆分还不够合理**：`待执行后回填`
- **哪些问题本应更早问架构师**：`待执行后回填`
- **哪些测试安排在实际执行中证明不够**：`待执行后回填`
- **模板本身还需要补什么字段**：`待执行后回填`

---

## 10. 结语

这份 action-plan 以 **把 Tier A contract 收束到单一 NACP 真理源** 为第一优先级，采用 **先 shape、再 compat、最后版本与文档收口** 的推进方式，优先解决 **协议分散、发布对象不纯、后续 phase 缺少统一引用基线**，并把 **不搬 runtime class / 不改语义 / 不破坏现有消费者** 作为主要约束。整个计划完成后，`pre-worker-matrix / W0` 应达到 **nacp-core 1.4.0-ready 的稳定状态**，从而为后续的 **W1 RFC、W2 发布、W3 blueprint、W4 shell** 提供稳定基础。
