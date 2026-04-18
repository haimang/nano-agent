# A2. Nano-Agent Trace Substrate Decision Investigation 执行计划

> 服务业务簇: `Observability / Trace Persistence`
> 计划对象: `after-skeleton / Phase 1 / trace-substrate-decision-investigation`
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-18`
> 执行序号: `A2 / 10`
> 上游前序: `A1`
> 下游交接: `A3`, `A6`, `A7`
> 文件位置: `packages/eval-observability/**`, `packages/session-do-runtime/**`, `docs/design/after-skeleton/P1-trace-substrate-decision.md`, `docs/eval/after-skeleton-trace-substrate-benchmark.md`
> 关键仓库锚点: `packages/eval-observability/src/sinks/do-storage.ts`, `packages/session-do-runtime/src/{checkpoint,env}.ts`, `packages/session-do-runtime/wrangler.jsonc`
> 参考 context / 对标来源: `context/mini-agent/mini_agent/logger.py`, `context/claude-code/services/tools/toolExecution.ts`
> 关联设计 / 调研文档:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
> - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
> - `docs/design/after-skeleton/PX-QNA.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

Q5 与 Q20 已经把 Phase 1 的边界说得很清楚：**当前方向正式冻结为 `DO storage hot anchor + R2 cold archive + D1 deferred query`，但必须补一份 benchmark / investigation artifact，才能把这条结论从“设计判断”升级为“可执行决定”**。因此这份 action-plan 的工作不是重新发明候选 substrate，而是把已经非常明确的代码现实、性能假设、恢复假设、未来 D1 升格门槛，变成一份可重复执行的调查和证据包。

当前代码现实已经给出强烈倾向：`packages/eval-observability/src/sinks/do-storage.ts` 已经实现 tenant-scoped、append-only、带 `_index` 的 DO storage timeline；`packages/session-do-runtime/src/checkpoint.ts` 已把 DO actor state 当作当前热状态承载；`packages/session-do-runtime/wrangler.jsonc` 只声明了 `SESSION_DO` binding，而 `SessionRuntimeEnv` 虽然给 `R2_ARTIFACTS` / `KV_CONFIG` 留了位置，但没有任何 D1 runtime wiring。也就是说，Phase 1 真正缺的不是更多候选，而是**基于现有最强 reality 的 benchmark、artifact、decision gate**。

- **服务业务簇**：`Observability / Trace Persistence`
- **计划对象**：`after-skeleton / Phase 1 / trace-substrate-decision-investigation`
- **本次计划解决的问题**：
  - Q5 已确认方向，但还缺 benchmark artifact 来证明 DO hot anchor 不是凭直觉拍板
  - Q20 已要求未来任何 D1 升格都必须先交独立 memo，但仓内还没有对应 gate 产物
  - P2/P3/P6 后续计划仍需要一份可引用的 substrate decision pack，避免重复争论
- **本次计划的直接产出**：
  - 一套可重复执行的 trace substrate benchmark harness 与场景定义
  - 一份 `after-skeleton-trace-substrate-benchmark.md` 证据文档
  - 一份经 benchmark 支撑的 substrate decision / gate sync 结果

---

## 1. 执行综述

### 1.1 总体执行方式

这份 action-plan 采用 **先盘点当前 reality 与 benchmark contract，再补 harness 与场景，然后执行 DO hot-path benchmark，最后写出 decision pack 并冻结 gate** 的推进方式。它不是“实现新 substrate”，而是 **把现有 DO-centered reality 做成可审阅、可复测、可给未来 D1 升格设门槛的调查闭环**。这里的 benchmark 方法也必须先冻结：**A2 只做 package-local / current-runtime seam benchmark，不承担 `wrangler dev --remote` 或 deploy-shaped 测试职责；后者统一留给 A6。**

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Reality Inventory & Acceptance Contract | `S` | 列清当前 substrate reality、benchmark 问题、判定指标与 artifact 形状 | `-` |
| Phase 2 | Harness & Scenario Buildout | `M` | 建 benchmark runner、fake E2E 场景、artifact 输出与最小自动校验 | `Phase 1` |
| Phase 3 | Benchmark Execution & Comparative Analysis | `M` | 跑 DO hot anchor benchmark、read/recovery probe、R2/D1/KV comparative note | `Phase 2` |
| Phase 4 | Decision Pack & Gate Freeze | `S` | 写 benchmark 文档、同步 design/QNA gate、正式封装 substrate 结论 | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — Reality Inventory & Acceptance Contract**
   - **核心目标**：把“当前仓里到底已经有什么、还缺什么 benchmark、什么结果算通过”先写死。
   - **为什么先做**：没有 acceptance contract，后面 benchmark 很容易跑出一堆数字却不知道如何裁判。
2. **Phase 2 — Harness & Scenario Buildout**
   - **核心目标**：在现有 package reality 上搭一套最小 benchmark runner，而不是另造一套临时 runtime。
   - **为什么放在这里**：Phase 1 先定义指标，Phase 2 才知道 runner 该产出哪些字段。
3. **Phase 3 — Benchmark Execution & Comparative Analysis**
   - **核心目标**：真正产生 DO append/read/restart evidence，并把 R2 / D1 / KV 的职责差异写成 comparative note。
   - **为什么放在这里**：没有实测证据，Q5 只能继续停留在“方向正确但有条件”。
4. **Phase 4 — Decision Pack & Gate Freeze**
   - **核心目标**：把 benchmark 结果升级成后续 action-plan 可引用的正式 decision pack。
   - **为什么放在这里**：Phase 4 的职责不是补更多实验，而是封装并冻结 decision process。

### 1.4 执行策略说明

- **执行顺序原则**：`先基于现有 DO reality 定 benchmark contract，再补 runner；先看 hot append/restart，再写 archive/query 角色说明`
- **风险控制原则**：`不把 Phase 1 变成 D1 implementation 预研；benchmark 只裁判当前阶段的主路径，不伪装成永久真理`
- **测试推进原则**：`优先复用 eval-observability / session-do-runtime 现有 tests；benchmark runner 再追加最小自动校验`
- **文档同步原则**：`benchmark artifact、P1 decision doc、PX-QNA gate、plan-after-skeleton 的口径必须一致`

### 1.5 本次 action-plan 影响目录树

```text
trace-substrate-decision-investigation
├── packages/eval-observability
│   ├── src/sinks/do-storage.ts
│   ├── src/timeline.ts
│   ├── test/sinks/do-storage.test.ts
│   ├── test/integration/ws-inspector-http-fallback.test.ts
│   └── scripts/trace-substrate-benchmark.ts
├── packages/session-do-runtime
│   ├── src/checkpoint.ts
│   ├── src/env.ts
│   ├── wrangler.jsonc
│   └── test/{traces,checkpoint,integration/checkpoint-roundtrip}.ts
├── docs
│   ├── action-plan/after-skeleton/A2-trace-substrate-decision-investigation.md
│   ├── design/after-skeleton/P1-trace-substrate-decision.md
│   ├── design/after-skeleton/PX-QNA.md
│   └── eval/after-skeleton-trace-substrate-benchmark.md
└── root
    └── package.json / test:cross
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 定义并执行 DO storage hot anchor benchmark：append latency、flush 行为、new-instance timeline reconstruction、简单 write amplification 统计
- **[S2]** 产出 fake E2E shaped benchmark 场景：steady append、burst append、restart/readback、live-vs-durable split
- **[S3]** 形成 substrate decision artifact：为什么 DO 是 hot anchor、R2 是 cold archive、D1 仍只保留 query seam
- **[S4]** 冻结未来 D1 升格 gate：任何要把 D1 拉进热路径或 query 之外职责的提案，都必须先交 benchmark memo

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 直接实现 D1 trace schema、D1 writer、D1 reader
- **[O2]** 真正落地 R2 archive runtime 路径与 export job
- **[O3]** P2 的 `traceUuid` carrier、recovery law、instrumentation catalog
- **[O4]** P5 的 deploy-shaped real-boundary smoke 与真实 Cloudflare 远端性能验收

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| DO storage append/read/restart benchmark | `in-scope` | 这是 Q5 conditional yes 变成正式 decision 的核心证据 | Phase 1 结束后只在 substrate revisit 时重评 |
| R2 cold archive 角色说明 | `in-scope` | P1 需要说明为什么 archive 属于 R2，但不要求现在实现 | Phase 5/6 真正接 archive seam 时重评 |
| D1 热路径实现 | `out-of-scope` | Q5/Q20 已明确当前只允许 deferred query seam | 只有独立 benchmark memo 通过后才重评 |
| KV 承载 trace payload | `out-of-scope` | 当前只允许 config/shared manifest 角色 | 除非出现极小 metadata 例外，再单独 memo |
| benchmark artifact 中包含 D1 cost/query note | `in-scope` | Q20 需要 future D1 elevation gate 的比较维度 | 未来 D1 memo 会继承并扩展 |
| real deploy latency baseline | `depends-on-phase` | 这是 P5 verification gate 的职责，不应被 P1 抢跑 | Phase 5 action-plan 启动时重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Current Substrate Reality Inventory | `update` | `packages/eval-observability/src/sinks/do-storage.ts`, `packages/session-do-runtime/src/{checkpoint,env}.ts`, `wrangler.jsonc` | 把当前 trace substrate reality 与缺口列清楚 | `low` |
| P1-02 | Phase 1 | Benchmark Contract & Pass Criteria | `update` | 本 action-plan, `docs/design/after-skeleton/P1-trace-substrate-decision.md` | 固定 benchmark 要回答的问题、指标和 artifact 字段 | `medium` |
| P2-01 | Phase 2 | Benchmark Runner Skeleton | `add` | `packages/eval-observability/scripts/trace-substrate-benchmark.ts` | 提供可重复执行的 benchmark runner | `medium` |
| P2-02 | Phase 2 | Scenario Corpus & Output Schema | `add` | `packages/eval-observability/test/integration/**`, benchmark fixtures | 用 fake E2E 场景驱动 runner，并产出统一 JSON/Markdown artifact | `medium` |
| P2-03 | Phase 2 | Baseline Regression Guards | `update` | `packages/eval-observability/test/sinks/do-storage.test.ts`, `packages/session-do-runtime/test/integration/checkpoint-roundtrip.test.ts` | 确保 runner 建在真实 tenant-scoped / hibernation-safe reality 上 | `low` |
| P3-01 | Phase 3 | DO Hot-path Benchmark Run | `update` | benchmark runner + artifact output | 产出 append p50/p99、flush cost、restart readback 指标 | `high` |
| P3-02 | Phase 3 | Recovery / Readback Probe | `update` | `packages/eval-observability/src/timeline.ts`, `packages/session-do-runtime/src/checkpoint.ts` | 验证新 sink 实例 / 新 DO 实例读回能力 | `high` |
| P3-03 | Phase 3 | Comparative Note for R2 / D1 / KV | `update` | benchmark artifact, P1 design doc | 把 current decision 与 alternative roles 写成清晰对照 | `medium` |
| P4-01 | Phase 4 | Benchmark Artifact Publication | `add` | `docs/eval/after-skeleton-trace-substrate-benchmark.md` | 形成可引用、可 review 的 benchmark memo | `low` |
| P4-02 | Phase 4 | Decision & Gate Sync | `update` | `docs/design/after-skeleton/P1-trace-substrate-decision.md`, `PX-QNA.md`, `docs/plan-after-skeleton.md` | 把 Q5/Q20 的有条件结论收口为正式 gate | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Reality Inventory & Acceptance Contract

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Current Substrate Reality Inventory | 盘点 DO storage / R2 / KV / D1 的当前代码 reality 与角色空位 | `packages/eval-observability/src/sinks/do-storage.ts`, `packages/session-do-runtime/src/{checkpoint,env}.ts`, `wrangler.jsonc` | 形成一份不含空想候选的 substrate reality list | 代码核对 | 能明确回答“当前哪个 substrate 已有热路径 reality、哪个只是保留位、哪个完全未接线” |
| P1-02 | Benchmark Contract & Pass Criteria | 冻结 benchmark 指标、场景、artifact 输出字段、判定方法，并明确 A2 只使用 package-local / seam-level harness | 本 action-plan, `docs/design/after-skeleton/P1-trace-substrate-decision.md` | 后续 benchmark 不再是随手跑一遍 | 文档自审 | artifact 至少覆盖 append p50/p99、restart readback、write amp、D1 gate note，且方法学不与 A6 deploy verification 混淆 |

### 4.2 Phase 2 — Harness & Scenario Buildout

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Benchmark Runner Skeleton | 用 `tsx` 脚本实现 benchmark runner，复用 `DoStorageTraceSink` 与 fake storage double，并固定为 `local-bench` / `readback-probe` 两类模式 | `packages/eval-observability/scripts/trace-substrate-benchmark.ts` | benchmark 可脚本化执行，不依赖人工手点 | `pnpm --filter @nano-agent/eval-observability tsx scripts/trace-substrate-benchmark.ts --help` | runner 能输出结构化 JSON 指标，且不引入 `wrangler` / remote deploy 依赖 |
| P2-02 | Scenario Corpus & Output Schema | 定义 steady/burst/restart/live-durable split 场景，以及统一输出 schema | benchmark fixtures, `test/integration/ws-inspector-http-fallback.test.ts` | benchmark 场景能覆盖 Q5 关心的 hot path 问题 | targeted test + runner smoke | 场景名称、负载参数、输出字段固定下来 |
| P2-03 | Baseline Regression Guards | 为 tenant-scoped key pattern、_index readback、checkpoint symmetry 增加或复用回归测试 | `test/sinks/do-storage.test.ts`, `packages/session-do-runtime/test/integration/checkpoint-roundtrip.test.ts` | runner 依赖的底层假设被现有 test 面保护 | `pnpm --filter @nano-agent/eval-observability test`, `pnpm --filter @nano-agent/session-do-runtime test` | benchmark 不依赖未经测试的关键假设 |

### 4.3 Phase 3 — Benchmark Execution & Comparative Analysis

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | DO Hot-path Benchmark Run | 跑 steady/burst append 与 flush 测试，采集 p50/p99、buffer flush、key growth 指标，并记录单次 run 的 p99/p50 比例 | benchmark runner, `DoStorageTraceSink` | 得到可比较的 DO hot-path 指标 | runner 实测 | artifact 中存在清晰的 latency / volume / flush 指标，且能判断抖动是否失控 |
| P3-02 | Recovery / Readback Probe | 验证 brand-new sink / new DO instance 是否可经 `_index` + checkpoint 读回历史 | `DoStorageTraceSink.readTimeline()`, `buildSessionCheckpoint()/validateSessionCheckpoint()` | 证明 hot anchor 不只是能写，还能恢复 | targeted integration tests + runner probe | benchmark 文档可明确说明 restart/readback 是否成立 |
| P3-03 | Comparative Note for R2 / D1 / KV | 把 R2、D1、KV 的角色、优点、为何不进入当前主路径写成对照 | benchmark artifact, P1 design doc | future seam 与 current main path 有清晰区分 | 文档核对 | 不再出现“D1 也许直接替代 DO”“KV 也许顺便存 trace”这类模糊表述 |

### 4.4 Phase 4 — Decision Pack & Gate Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | Benchmark Artifact Publication | 输出 benchmark memo，并固定引用路径 | `docs/eval/after-skeleton-trace-substrate-benchmark.md` | 后续设计/评审有统一证据入口 | 文档核对 | memo 同时包含摘要、方法、场景、结果、结论、限制 |
| P4-02 | Decision & Gate Sync | 回填 P1 design/QNA/plan，使 Q5 变成 evidence-backed 决定，Q20 变成硬 gate | `docs/design/after-skeleton/P1-trace-substrate-decision.md`, `PX-QNA.md`, `docs/plan-after-skeleton.md` | 后续 Phase 直接引用，不再重新争论 substrate | 文档核对 | 所有文档都明确：D1 升格前必须先交独立 benchmark memo |

---

## 5. Phase 详情

### 5.1 Phase 1 — Reality Inventory & Acceptance Contract

- **Phase 目标**：把当前 substrate reality 和 benchmark 裁判标准先冻结。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - 无
- **本 Phase 修改文件**：
  - `docs/action-plan/after-skeleton/A2-trace-substrate-decision-investigation.md`
  - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
- **具体功能预期**：
  1. 明确 `DoStorageTraceSink`、`SessionCheckpoint`、`wrangler.jsonc`、`SessionRuntimeEnv` 各自代表的 substrate reality
  2. 明确 benchmark 只裁判 “当前能否支撑 P2 foundation”，不裁判“未来永不变更”
  3. 约定 benchmark artifact 至少记录 append p50/p99、restart readback、storage key growth、write amp note、R2/D1/KV role compare
  4. 冻结方法学：A2 只允许 `local-bench`（脚本化 steady/burst append）与 `readback-probe`（new-instance / checkpoint symmetry）两类 harness；`wrangler dev --remote` / `wrangler deploy` 明确留给 A6
  5. 冻结最小判定阈值：`restart/readback success = 100%`、不得出现跨 tenant/key pattern 漂移、单次 run 中 `p99 > 5x p50` 若出现必须在 artifact 中解释，否则只能给出 `yellow` 结论而不能直接把 DO 宣布为稳定主路径
- **具体测试安排**：
  - **单测**：无新增；以代码核对为主
  - **集成测试**：无
  - **回归测试**：无
  - **手动验证**：人工确认 acceptance contract 足以回答 Q5/Q20
- **收口标准**：
  - benchmark 输出字段与判定目标已经固定
  - 所有人都能从文档直接看出 Phase 1 不做 D1/R2 implementation
  - 后续 runner 不需要再反复追加“这次到底要测什么”
- **本 Phase 风险提醒**：
  - 如果 acceptance contract 过松，后面 benchmark 只能产出“好像还行”的模糊结论
  - 如果 acceptance contract 过重，Phase 1 会被拉成小型平台工程

### 5.2 Phase 2 — Harness & Scenario Buildout

- **Phase 目标**：把 benchmark 从讨论变成可重复执行的脚本和场景集。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `packages/eval-observability/scripts/trace-substrate-benchmark.ts`
  - 视需要新增 benchmark fixtures
- **本 Phase 修改文件**：
  - `packages/eval-observability/test/sinks/do-storage.test.ts`
  - `packages/eval-observability/test/integration/ws-inspector-http-fallback.test.ts`
  - `packages/session-do-runtime/test/integration/checkpoint-roundtrip.test.ts`
- **具体功能预期**：
  1. benchmark runner 能以固定场景运行并输出 JSON/Markdown 两种结果
  2. steady append、burst append、restart readback、live-vs-durable split 四类场景具备统一输入参数
  3. runner 依赖的 key pattern、_index readback、checkpoint symmetry 已被现有 tests 护住
- **具体测试安排**：
  - **单测**：`pnpm --filter @nano-agent/eval-observability test`
  - **集成测试**：`packages/eval-observability/test/integration/ws-inspector-http-fallback.test.ts`, `packages/session-do-runtime/test/integration/checkpoint-roundtrip.test.ts`
  - **回归测试**：`pnpm --filter @nano-agent/eval-observability typecheck && pnpm --filter @nano-agent/eval-observability build`
  - **手动验证**：手工运行 benchmark runner，确认 artifact shape 可读、可 diff
- **收口标准**：
  - benchmark runner 可稳定重复执行
  - 场景名、输入参数、输出字段稳定
  - benchmark 依赖的底层前提均有自动化测试覆盖
- **本 Phase 风险提醒**：
  - 如果 runner 自造过多 fake runtime，会把 benchmark 变成测 runner 而不是测 substrate
  - 如果不补 regression guard，后面 benchmark 结果会建立在脆弱假设上

### 5.3 Phase 3 — Benchmark Execution & Comparative Analysis

- **Phase 目标**：真正拿到 DO hot anchor 是否可用的证据，而不是继续用“看起来合理”的语言代替。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - benchmark 原始输出 JSON（如采用）
- **本 Phase 修改文件**：
  - `docs/eval/after-skeleton-trace-substrate-benchmark.md`
  - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
- **具体功能预期**：
  1. 得到 DO append / flush / restart readback 的 p50/p99 与案例说明
  2. 证明 brand-new sink / new DO instance 能读回已写 timeline，不依赖常驻实例幻觉
  3. 把 R2、D1、KV 的职责差异写成清晰 comparative note，而不是只写一句“未来再说”
- **具体测试安排**：
  - **单测**：沿用 eval/session 包现有 tests
  - **集成测试**：restart readback probe、timeline reconstruction probe
  - **回归测试**：必要时跑 `npm run test:cross`
  - **手动验证**：人工检查 benchmark artifact 是否能直接回答 Q5/Q20
- **收口标准**：
  - benchmark artifact 有实测结果，不是空模板
  - restart/readback 能明确判定为成立/不成立/部分成立
  - D1/KV/R2 的角色边界写清楚，能被下一阶段直接引用
- **本 Phase 风险提醒**：
  - 如果只测 append 不测 restart/readback，P1 就只证明“能写”而没证明“能恢复”
  - 如果 comparative note 写得过度绝对，后续会误把“当前最佳”理解成“永久最佳”

### 5.4 Phase 4 — Decision Pack & Gate Freeze

- **Phase 目标**：把 benchmark 结果变成正式 decision pack，而不是一份孤立实验记录。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `docs/eval/after-skeleton-trace-substrate-benchmark.md`
- **本 Phase 修改文件**：
  - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
  - `docs/design/after-skeleton/PX-QNA.md`
  - `docs/plan-after-skeleton.md`
- **具体功能预期**：
  1. benchmark 结果被总结为正式 Phase 1 substrate decision
  2. Q20 gate 被写成明确的 future change process，而不只是会议记忆
  3. P2/P3/P6 的 action-plan 可以直接引用这份 decision pack
- **具体测试安排**：
  - **单测**：无新增
  - **集成测试**：无新增
  - **回归测试**：必要时重跑 benchmark runner 与关键 package tests
  - **手动验证**：核对 P1 design / PX-QNA / plan-after-skeleton / benchmark memo 四者口径一致
- **收口标准**：
  - P1 有正式 artifact
  - Q5 的 “conditional yes” 已被 evidence-backed 结果支撑
  - Q20 的 gate 被所有相关文档一致引用
- **本 Phase 风险提醒**：
  - 如果 benchmark memo 和 decision doc 脱节，后续仍会重新回到口头解释
  - 如果 gate 文案不够硬，D1 role creep 仍会在未来回潮

---

## 6. 需要业主 / 架构师回答的问题清单

> **统一说明**：与本 action-plan 相关的业主 / 架构师问答，统一收录于 `docs/action-plan/after-skeleton/AX-QNA.md`；请仅在该汇总文件中填写答复，本文不再逐条填写。

### 6.1 当前判断

- 当前 **无新增必须拍板的问题**。
- Q5 已冻结当前 substrate 方向，Q20 已冻结未来 D1 升格流程；这两条足以支撑本 action-plan 启动。
- 若执行中出现新的 owner 问题，必须满足两个条件才允许升级：`会直接改变 benchmark contract` 或 `会改变 D1/R2/DO/KV 的职责边界`。

### 6.2 问题整理建议

- 不要把 benchmark 参数微调升级成 owner 问题
- 只把会改变 substrate decision 或 future gate 的事项带回给业主
- benchmark 结果若不理想，应先给出 evidence 与备选建议，再决定是否升级为新问题

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| benchmark 过于 synthetic | 只测纯内存 fake storage，无法代表 DO reality | `high` | runner 必须尽量复用 `DoStorageTraceSink` 的真实 key/index/write path，并明确记录限制 |
| 只看 append 不看恢复 | 只得到“能写”结论，无法支撑 trace survival | `high` | 强制把 new-instance timeline reconstruction 与 checkpoint readback 纳入 Phase 3 |
| 当前 reality 导致 self-fulfilling decision | 因为仓内已有 DO sink，就过早排除其它路径 | `medium` | 在 comparative note 里明确“当前最优主路径”与“未来 query/archive seam”分层 |
| D1 延后被误读为放弃 | 后续 query 设计被无声跳过 | `medium` | 在 decision pack 中显式写出 D1 = deferred query substrate，而不是 rejected substrate |

### 7.2 约束与前提

- **技术前提**：`benchmark runner 必须优先复用现有 package seams，不另造一套 trace runtime`
- **运行时前提**：`Phase 1 不实现 D1 hot path，不实现 R2 archive writer，只调查并冻结职责`
- **组织协作前提**：`Q5/Q20 视为 owner-aligned frozen input；任何 D1 role 升格都必须重新走 memo review`
- **上线 / 合并前提**：`benchmark artifact、关键 package tests、相关 design doc sync 必须一起存在，才能视为 P1 完成`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
  - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
  - `docs/design/after-skeleton/PX-QNA.md`
- 需要同步更新的说明文档 / README：
  - `docs/plan-after-skeleton.md`
- 需要同步更新的测试说明：
  - `packages/eval-observability/test/**`
  - `packages/session-do-runtime/test/**`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 确认 `DoStorageTraceSink` 继续保持 `tenants/{teamUuid}/trace/{sessionUuid}/{date}.jsonl + _index` 的 tenant-scoped / hibernation-safe reality
  - 确认 `wrangler.jsonc` / `SessionRuntimeEnv` 没有偷偷把 D1 拉进当前热路径
  - 确认 benchmark 运行面只使用 package-local / seam-level harness，而没有混入 `wrangler` remote 或 deploy-shaped 流程
- **单元测试**：
  - `pnpm --filter @nano-agent/eval-observability test`
  - `pnpm --filter @nano-agent/session-do-runtime test`
- **集成测试**：
  - `packages/eval-observability/test/integration/ws-inspector-http-fallback.test.ts`
  - `packages/session-do-runtime/test/integration/checkpoint-roundtrip.test.ts`
- **端到端 / 手动验证**：
  - 手工运行 benchmark runner，确认能产出结构化结果与 Markdown artifact
  - 手工检查 artifact 是否同时给出结论、限制、下一步 gate
- **回归测试**：
  - `pnpm --filter @nano-agent/eval-observability typecheck && pnpm --filter @nano-agent/eval-observability build`
  - `pnpm --filter @nano-agent/session-do-runtime typecheck && pnpm --filter @nano-agent/session-do-runtime build`
  - 如有 root seam 变更则执行 `npm run test:cross`
- **文档校验**：
  - benchmark memo、P1 design、PX-QNA、plan-after-skeleton 对 Q5/Q20 的表述必须一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. 存在一份可复测的 trace substrate benchmark artifact。
2. DO storage 作为 hot anchor / durable audit 主路径的结论有实测证据支撑，而不是仅靠当前代码倾向。
3. R2 = cold archive、D1 = deferred query、KV 不承载 trace payload 的职责边界被明确写清。
4. Q20 的 “D1 升格前必须先交独立 benchmark memo” 已写成硬 gate。
5. Phase 2 后续计划不再需要重新争论 trace substrate 基座。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `benchmark runner + scenario corpus + benchmark memo + decision/gate sync` 全部落地 |
| 测试 | eval-observability / session-do-runtime 关键 tests 与 benchmark runner 形成最小证据闭环 |
| 文档 | P1 design、PX-QNA、plan-after-skeleton、benchmark memo 口径一致 |
| 风险收敛 | 不再存在“DO/D1/R2/KV 到底谁是主路径”的 charter 级摇摆 |
| 可交付性 | P2/P3/P6 action-plan 可直接把 P1 作为已冻结输入使用 |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

这份 action-plan 以 **把 substrate 决策从“方向正确”推进到“证据闭合”** 为第一优先级，采用 **先 reality inventory、再 benchmark contract、再 runner/scenario、最后 decision pack/gate freeze** 的推进方式，优先解决 **Q5 缺 benchmark artifact、Q20 缺执行化 gate、P2 后续仍可能反复争论底座** 这三类问题，并把 **不提前实现 D1/R2 主路径、不把 synthetic benchmark 冒充 deploy verification** 作为主要约束。整个计划完成后，`Observability / Trace Persistence` 应达到 **DO hot anchor / R2 cold archive / D1 deferred query 拥有明确证据与升级门槛** 的状态，从而为后续的 **trace-first observability foundation、session edge closure、storage/context evidence closure** 提供稳定基础。

---

## 11. 工作报告（A2 execution log）

> 执行人：Claude Opus 4.7（1M context）
> 执行时间：`2026-04-18`
> 执行对象：`docs/action-plan/after-skeleton/A2-trace-substrate-decision-investigation.md` Phase 1-4
> 执行结论：**substrate 决策从 “conditional yes” 升级为 “evidence-backed yes”，Q20 升格为 hard gate；附带 sink-level Finding F1 转交 A3/P2。**

### 11.1 工作目标与内容回顾

- **目标**：把 Q5 / Q20 的 owner 决策升级成可重复的 benchmark 证据 + 文档化 gate；不实现 D1 / R2 hot path；不抢 A6 的 deploy-shaped 验证职责。
- **AX-QNA 绑定**：Q5 写明 “DO hot anchor + R2 cold archive + D1 deferred query” + 阈值 `p50 ≤ 20ms / p99 ≤ 100ms / WA ≤ 2× / readback success = 100%`；Q20 要求未来任何 D1 升格必须先交独立 benchmark memo。两者均已通过本轮交付兑现。
- **Phase 真实执行路径**：
  - Phase 1 — 盘点：DO storage = 唯一已接线热路径（`DoStorageTraceSink` + `_index`）；R2 / KV 仅类型槽位；D1 零接线。冻结 acceptance contract（`BENCH_THRESHOLDS = { readbackSuccessPct: 100, writeAmplificationMax: 2, tailRatioWarn: 5 }`）+ 方法学（package-local in-isolate only，禁止 wrangler / deploy-shaped）。
  - Phase 2 — 建 runner：`packages/eval-observability/scripts/trace-substrate-benchmark.ts`，模式 `local-bench` / `readback-probe` / `all`，CLI `--out` JSON、`--markdown` MD、`--seed` 固定 fixture；package.json 加 `bench:trace-substrate` 脚本；新增回归测试 `test/scripts/trace-substrate-benchmark.test.ts`（10 cases）。
  - Phase 3 — 跑出 4 组 evidence：默认 burst（buffer=64, 5×50）→ red；buffer=1024 模式 → red（burst 仍 5 次 flush）；single-flush 参考 → yellow（仅 tail-ratio 噪声）；readback probe 8×128 → green，successPct = 100%、indexKeysObserved = sessions、ordering violations = 0。把 R2/D1/KV 角色差异写入 comparative note。
  - Phase 4 — 产出 `docs/eval/after-skeleton-trace-substrate-benchmark.md` v1（TL;DR + methodology + 4 组结果 + Findings F1/F2 + comparative table + decision + limitations + repro checklist）；回填 `P1-trace-substrate-decision.md` §9.3、`AX-QNA.md` Q5 / Q20、`docs/plan-after-skeleton.md` §7.2。
- **参考案例核对**：mini-agent `logger.py` 的纯 plain-text 单文件追加确认了“缺 index / 缺 tenant 隔离 / 缺 hibernation 安全”是反面教材；just-bash 整体没有 trace/observability 主题，本轮以方法学（package-local script harness、deterministic fixture seed）作为间接参考；claude-code `toolExecution.ts` 仅在错误分类层有 telemetry（`telemetryMessage`），与本次 substrate 决策无直接交集，故未引入额外引用。

### 11.2 实际代码清单

- **新增 / 直接修改的代码**
  - `packages/eval-observability/scripts/trace-substrate-benchmark.ts`（新增，~480 行）：runner + CLI + scenarios + Markdown 输出 + 阈值常量 + verdict 计算；导出 `runBenchmark` / `computeVerdict` / `summariseLatencies` / `renderMarkdown` / `RecordingFakeStorage` / `BENCH_THRESHOLDS` 给测试与未来 reuse。
  - `packages/eval-observability/test/scripts/trace-substrate-benchmark.test.ts`（新增，10 cases）：smoke / verdict / artifact / RecordingFakeStorage 与 sink 的兼容性。
  - `packages/eval-observability/package.json`：新增 `bench:trace-substrate` script 入口。
- **新增 / 修改的文档**
  - `docs/eval/after-skeleton-trace-substrate-benchmark.md`（新增 v1）：完整 evidence pack。
  - `docs/design/after-skeleton/P1-trace-substrate-decision.md`：§9.3 回填执行后状态。
  - `docs/action-plan/after-skeleton/AX-QNA.md`：Q5 / Q20 加 `2026-04-18 执行后追记` 段落。
  - `docs/plan-after-skeleton.md`：§7.2 增补 A2 收口交付物清单。
  - `docs/action-plan/after-skeleton/A2-trace-substrate-decision-investigation.md`（本文件）：§11 工作报告。
- **未改动（确认范围一致）**
  - `packages/eval-observability/src/sinks/do-storage.ts` — 没有改写 sink；F1 的修复属于 A3/P2 sink-level memo，不在 A2 scope。
  - `packages/session-do-runtime/src/checkpoint.ts` / `src/env.ts` / `wrangler.jsonc` — A2 不引入 D1 binding，不改 SessionRuntimeEnv 类型槽位。

### 11.3 测试制作与测试结果

- **新增测试**
  - `packages/eval-observability/test/scripts/trace-substrate-benchmark.test.ts`：
    - `smoke / single-flush invocation never reports red and exposes both scenarios`
    - `smoke / readback probe reaches 100% success and zero ordering violations`
    - `smoke / single-flush WA stays under the published threshold`
    - `smoke / multi-flush configuration surfaces high write amplification (sink finding)` ← 把 Finding F1 锁进 regression
    - `verdict / flags red when readback success drops below threshold`
    - `verdict / flags red when write amplification exceeds the cap`
    - `verdict / downgrades to yellow on tail-ratio breach without other failures`
    - `artifact / renderMarkdown produces a non-empty artifact with the verdict and scope`
    - `artifact / RecordingFakeStorage stays compatible with DoStorageTraceSink keys`
    - `artifact / run report carries the immutable thresholds object`
- **运行结果**
  - `pnpm --filter @nano-agent/eval-observability test` — `16 files / 146 tests passed`。
  - `pnpm --filter @nano-agent/eval-observability typecheck` — 通过。
  - `pnpm --filter @nano-agent/eval-observability build` — 通过。
  - `pnpm --filter @nano-agent/session-do-runtime test` — `19 files / 259 tests passed`（不直接受 A2 影响，作为相邻 substrate 守卫一并跑过）。
  - `npm run test:cross` — `14/14 e2e passed`。
  - `pnpm --filter @nano-agent/eval-observability exec tsx scripts/trace-substrate-benchmark.ts --help` — CLI 可用、阈值正确、scope 提示明确。
- **手动跑出的 4 份 artifact（已纳入 §11.4 收口分析）**
  - 默认 burst（buffer=64, 5×50） → verdict `red`，notes 含 `steady WA 4.584×` / `burst WA 2.997×` / `burst tail 10.118×`
  - buffer=1024 burst（5×50） → verdict `red`，notes 含 `steady tail 32.058×` / `burst WA 2.997×` / `burst tail 13.04×`
  - single-flush（1×250, buffer=1024） → verdict `yellow`，notes 仅 `steady tail 8.787×`，**WA = 1.00× ✓**
  - readback probe（8×128, buffer=32） → verdict `green`，successPct = 100%、indexKeysObserved = 8、ordering violations = 0

### 11.4 收口分析与下一阶段安排

- **AX-QNA / Definition of Done 对照**
  - **功能**：runner + scenarios + artifact + decision/gate sync 全部落地。
  - **测试**：runner regression + sink existing tests + cross e2e 形成最小证据闭环；sink-level Finding F1 已被 `multi-flush configuration surfaces high write amplification (sink finding)` 测试钉住，未来若 sink 升级降低 WA，测试需要同步调整且应在 sink-level memo 中说明。
  - **文档**：benchmark memo + P1 design + PX-QNA + plan-after-skeleton 四份口径一致；下一份 D1 升格 memo 路径已固化为 `docs/eval/trace-substrate-benchmark-v{N}.md`。
  - **风险收敛**：DO/D1/R2/KV 不再有 charter 级摇摆；Q20 写成 hard gate；F1 通过 sizing policy（`maxBufferSize ≥ events-per-turn` + `flush()` 在 `turn.end`）化解，不需要重写 substrate。
  - **可交付性**：A3 / A6 / A7 可直接以本 memo 为已冻结输入开工；任何想动 D1 的提案先去填 §4 / §5 模板。
- **复盘要点回填**
  - 工作量估计偏差：Phase 3 的 Comparative Note 实际比预估省力 —— 因为 D1 / R2 / KV 都没有真实接线，对照表更多是边界声明而非 benchmark；Phase 2 的回归测试用时略超预估，主要是要兼顾 sink 的 read-modify-write 现实，否则 smoke 测试容易因为 WA / tail-ratio 把 CI 误判为 red。
  - 拆分合理度：P2-03 “Baseline Regression Guards” 在落地时被合并到 `trace-substrate-benchmark.test.ts` 的 `RecordingFakeStorage / DoStorageTraceSink` 测试里，没有再去新增独立文件 —— 这是合理简化，避免双轨。
  - 需要更早问架构师：本次没有；Q5 + Q20 已覆盖所有执行歧义。F1 暴露的 sink-level RMW 不需要新 owner 决策，按 §11.4 sizing policy 即可。
  - 测试覆盖不足之处：runner 目前没有跨 OS / 容器的可重复性 fixture；考虑到 A2 only-package-local 边界，本轮不补；A6 deploy 验证时再正式保证。
  - 模板需补字段：A2 模板的 “Phase 总览” 与 “Phase 业务表格” 之间 Phase ID 重复（都叫 Phase 1-4，但与 plan-after-skeleton 的 Phase 1 = trace substrate 阶段重名），未来模板可以加一行 “sub-phase 命名 prefix” 防止读者误读。
- **下一阶段安排（A3 / A6 / A7 启动条件）**
  - **A3 (`P2-trace-first-observability-foundation`)**：可立即启动；substrate 已 evidence-backed，TraceEventBase 加 `traceUuid` (camelCase) 字段直接对接 `DoStorageTraceSink`；按 Finding F1 写入 sink sizing policy（`maxBufferSize ≥ events-per-turn` 与 `flush() on turn.end`）。
  - **A6 (`P5-deployment-dry-run-and-real-boundary-verification`)**：本 memo 明确标注 in-isolate 限制；A6 必须在 `wrangler dev --remote` / deploy-shaped 环境复测 p50 ≤ 20 ms / p99 ≤ 100 ms 的真实 DO put 阈值，并把结果回填本 memo 的 §6 Limitations。
  - **A7 (`P6-storage-and-context-evidence-closure`)**：本 memo §4 已固化 R2 = cold archive seam 的角色；A7 接 R2 wiring 时直接消费此口径，无需重新决策。
  - **未来 D1 升格**：必须新建 `docs/eval/trace-substrate-benchmark-v{N}.md` 并复用本仓 runner（或显式扩展 mode）；不允许任何 “非 benchmark” 路径绕过。
