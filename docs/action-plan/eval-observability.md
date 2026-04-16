# Nano-Agent 行动计划 — Eval & Observability

> 服务业务簇: `Verification Infrastructure`
> 计划对象: `@nano-agent/eval-observability` — nano-agent 的结构化 trace、timeline、scenario runner 与 failure replay 基础设施
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-16`
> 文件位置: `packages/eval-observability/`（独立 repo，位于 `packages/` 下）
> 关联设计 / 调研文档:
> - `docs/design/eval-observability-by-opus.md`
> - `docs/design/session-do-runtime-by-opus.md`
> - `docs/design/storage-topology-by-opus.md`
> - `docs/design/hooks-by-GPT.md`
> - `docs/design/agent-runtime-kernel-by-GPT.md`
> - `docs/design/llm-wrapper-by-GPT.md`
> - `docs/design/capability-runtime-by-GPT.md`
> - `docs/action-plan/agent-runtime-kernel.md`
> - `docs/action-plan/llm-wrapper.md`
> - `docs/action-plan/capability-runtime.md`
> - `docs/action-plan/workspace-context-artifacts.md`
> - `docs/action-plan/nacp-core.md`
> - `docs/action-plan/nacp-session.md`
> - `README.md`
> - 参考代码：`packages/nacp-core/`、`packages/nacp-session/`、`context/codex/codex-rs/otel/`、`context/codex/codex-rs/rollout/`、`context/claude-code/services/api/logging.ts`、`context/claude-code/utils/telemetry/events.ts`、`context/mini-agent/mini_agent/logger.py`
> 文档状态: `draft`

---

## 0. 执行背景与目标

nano-agent 是 Worker-native agent runtime：没有本地 terminal，没有宿主进程日志，没有“ssh 上去看 stdout”这条退路。  
因此，**结构化 trace 不是锦上添花，而是唯一靠谱的调试、验证与收口基础设施。**

当前代码 reality 已经给出两条关键边界：

1. `@nano-agent/nacp-core` 已有 `audit.record`，可以作为 internal durable trace 的协议载体；
2. `@nano-agent/nacp-session` 已有 `session.stream.event` 的 9 种 kinds，作为 client-visible live stream reality。

所以 `Eval & Observability` 的 v1 目标，不是“先造 dashboard”，而是先把下面三层分清楚并冻结：

1. **Live Session Stream**：WebSocket-first 的实时 client-visible 事件流
2. **Durable Audit Trace**：用于 replay / diagnosis / storage placement 证据的 append-only durable 记录
3. **Durable Transcript**：面向用户对话历史的归档视图，不等于高频 trace 全量落盘

这份 action-plan 的目标，是把 eval/observability 作为独立包落地，先完成 **trace schema、sink、timeline、inspector、scenario runner、failure replay、storage placement evidence**。  
这些 `packages/*` 不是最终 Cloudflare 发布单元；后续会有 deployable Worker / Session DO 组装层把它们拼装起来，并同时服务 **WebSocket-first** 与 **HTTP fallback** 的会话交付路径。

- **服务业务簇**：`Verification Infrastructure`
- **计划对象**：`@nano-agent/eval-observability`
- **本次计划解决的问题**：
  - Worker / DO 环境下缺少统一的结构化 trace 与 replay 机制，问题定位会退化成猜测
  - live stream、durable audit、durable transcript 若不拆开，后续 storage topology 与 replay 会被高频 progress 污染
  - hooks / llm / capability / compact / storage placement 证据目前还没有统一 schema 与 sink
  - 后续 DDL、KV、R2 协同机制需要先有可观察证据，而不是先拍脑袋冻结 placement
- **本次计划的直接产出**：
  - `packages/eval-observability/` 独立包骨架
  - `TraceEvent / TraceSink / SessionTimeline / SessionInspector / ScenarioRunner / FailureReplay` 类型与实现
  - 可枚举、可审阅的 `DurablePromotionRegistry`
  - `audit.record` builder/parser、DO-storage trace sink、storage placement evidence helpers
  - WebSocket-first inspector + HTTP fallback 读取 durable timeline/transcript 的验证路径
  - fixture-driven tests 与最小 README / schema / registry 文档

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 分 **5 个 Phase**，执行策略是 **“先 trace taxonomy，再 sink/timeline，再 runner/replay，再 evidence helpers，最后用场景测试收口”**。  
Eval & Observability 的最大风险不是实现难，而是边界混淆：如果把 live stream 当 durable audit，把 transcript 当 trace，把 production metrics 平台当 v1 必需品，整个系统会同时变重且失真。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | 包骨架与 Trace Taxonomy | M | 建立独立包、冻结 trace schema 与三层分类 | `-` |
| Phase 2 | TraceSink / Audit Codec / Timeline | L | 建立 sink、append-only codec、timeline builder 与读取接口 | Phase 1 |
| Phase 3 | Session Inspector / Scenario Runner / Failure Replay | L | 建立实时观察、脚本化验证与失败重放能力 | Phase 1, Phase 2 |
| Phase 4 | Evidence Helpers / Placement Log / Attribution | M | 收敛 llm/tool/hook/storage 证据字段、placement log 与归因辅助 | Phase 1-3 |
| Phase 5 | Fixtures / 测试 / 文档 / 收口 | M | 以 fake session/fake sink 场景收口，并同步文档 | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — 包骨架与 Trace Taxonomy**
   - **核心目标**：建立独立包，冻结 `TraceEvent` base fields、evidence extension slots、audience 与三分法分类。
   - **为什么先做**：若不先冻结 trace truth，sink、timeline、runner 会各自长出不兼容事件形状。
2. **Phase 2 — TraceSink / Audit Codec / Timeline**
   - **核心目标**：建立 `TraceSink`、`DoStorageTraceSink`、`audit.record` codec 与 `SessionTimeline` read path。
   - **为什么放在这里**：先把 durable trace 写入/读出边界做对，后面的 replay 与 runner 才有地基。
3. **Phase 3 — Session Inspector / Scenario Runner / Failure Replay**
   - **核心目标**：让系统具备“实时看”“脚本化跑”“失败重放”三种观察方式。
   - **为什么放在这里**：光有 trace 存储还不够，必须有可消费它的验证工具。
4. **Phase 4 — Evidence Helpers / Placement Log / Attribution**
   - **核心目标**：把 llm/tool/hook/compact/storage evidence 统一字段化，并补 placement log 与 cache/attempt attribution helper。
   - **为什么放在这里**：evidence helper 应建立在稳定 trace event schema 与 sink 之上。
5. **Phase 5 — Fixtures / 测试 / 文档 / 收口**
   - **核心目标**：用 fake session/fake sink/fake storage 场景验证整个观察链路，补齐文档与脚本。
   - **为什么放在这里**：observability 是否成立，要靠 scenario 与 replay 证明，而不是靠字段数量。

### 1.4 执行策略说明

- **执行顺序原则**：`trace taxonomy -> sink/codec/timeline -> inspector/runner/replay -> evidence helpers -> fixtures/docs`
- **风险控制原则**：不把 production APM、跨租户查询、复杂 UI、完整 OTEL exporter 引入 v1；live stream 与 durable trace 必须显式分离
- **测试推进原则**：先测 schema / sink / timeline，再测 runner / replay；所有高频事件都要验证“不误持久化”
- **文档同步原则**：实现时同步回填 `eval-observability-by-opus.md`、`session-do-runtime-by-opus.md`、`storage-topology-by-opus.md` 以及相关 action-plan 的 evidence 依赖说明

### 1.5 本次 action-plan 影响目录树

```text
packages/eval-observability/
├── src/
│   ├── version.ts
│   ├── types.ts
│   ├── trace-event.ts
│   ├── classification.ts
│   ├── durable-promotion-registry.ts
│   ├── truncation.ts
│   ├── metric-names.ts
│   ├── attribution.ts
│   ├── placement-log.ts
│   ├── audit-record.ts
│   ├── timeline.ts
│   ├── inspector.ts
│   ├── replay.ts
│   ├── scenario.ts
│   ├── runner.ts
│   ├── sink.ts
│   ├── sinks/
│   │   └── do-storage.ts
│   └── index.ts
├── test/
│   ├── trace-event.test.ts
│   ├── classification.test.ts
│   ├── durable-promotion-registry.test.ts
│   ├── audit-record.test.ts
│   ├── sink.test.ts
│   ├── timeline.test.ts
│   ├── inspector.test.ts
│   ├── replay.test.ts
│   ├── scenario.test.ts
│   ├── attribution.test.ts
│   └── integration/
│       ├── session-timeline.test.ts
│       ├── failure-replay.test.ts
│       ├── ws-inspector-http-fallback.test.ts
│       └── storage-placement-evidence.test.ts
├── scripts/
│   ├── export-schema.ts
│   └── gen-trace-doc.ts
├── package.json
├── tsconfig.json
├── README.md
└── CHANGELOG.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `@nano-agent/eval-observability` 独立包骨架
- **[S2]** `TraceEvent` schema：base fields + event-kind-specific evidence extensions
- **[S3]** `Live Session Stream / Durable Audit Trace / Durable Transcript` 三分法与分类 helper，以及可枚举的 `DurablePromotionRegistry`
- **[S4]** `TraceSink` 接口
- **[S5]** `DoStorageTraceSink`：append-only、per-session、tenant-scoped durable sink
- **[S6]** `audit.record` builder/parser：把 trace 与 `@nano-agent/nacp-core` 对齐
- **[S7]** `SessionTimeline`：读取 durable trace 并按时间排序
- **[S8]** `SessionInspector`：消费 `session.stream.event` 的实时观察器
- **[S9]** WebSocket-first + HTTP fallback-aware inspection：实时流走 WS，durable timeline/transcript 读取可走 HTTP fallback
- **[S10]** `ScenarioSpec / ScenarioRunner / ScenarioResult`
- **[S11]** `FailureReplayHelper`
- **[S12]** `StoragePlacementLog`：记录关键数据写入 DO/KV/R2 的 evidence
- **[S13]** `Attribution` helpers：至少覆盖 attempt / provider / gateway / cache-state / output-size 级证据
- **[S14]** `metric-names` / evidence constants：沿用 codex 风格层级命名，至少覆盖 turn duration / ttft / tool call / api request 等基线，但不引入完整 exporter
- **[S15]** README、公开导出、schema/doc 生成脚本与 fixtures

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 生产级 APM / alerting / dashboard
- **[O2]** 跨租户审计查询 API
- **[O3]** 完整 OTEL SDK / OTLP exporter 装配
- **[O4]** Billing / 成本结算 pipeline
- **[O5]** LLM quality benchmark 平台
- **[O6]** Client-side UI 框架
- **[O7]** D1 / structured query for trace events（v1 只做 append + scan）
- **[O8]** 把全部 `session.stream.event` 高频事件无脑 durable 化
- **[O9]** 生产 Worker 内嵌 scenario runner 常驻执行
- **[O10]** 最终 archive 编排与 R2 生命周期策略本体（仅提供 key/evidence helper，不接管 deploy/runtime wiring）

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `audit.record` 作为 internal trace 载体 | `in-scope` | 这是当前 `nacp-core` 已有 reality | 默认不重评 |
| `session.stream.event` 作为 client-visible live stream | `in-scope` | 这是当前 `nacp-session` 唯一 reality | 默认不重评 |
| `llm.delta` / `tool.call.progress` 全量 durable | `out-of-scope` | 高频 ephemeral 事件会造成写放大与错误 timeline | 默认不重评 |
| `DoStorageTraceSink` | `in-scope` | v1 最符合 session actor scope | 仅在跨 session 分析成为主需求时 |
| R2 archive 物理编排 | `defer / depends-on-decision` | 应保留 key/evidence helper，但不在本包里抢跑最终部署编排 | storage-topology 收口时 |
| ScenarioRunner 只跑 WebSocket | `defer / depends-on-decision` | v1 推荐 WS-first，但需要考虑 HTTP fallback 读取 durable 产物 | session-do-runtime action-plan 后 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | package 骨架 | `add` | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | 建出独立 eval-observability package | low |
| P1-02 | Phase 1 | trace taxonomy | `add` | `src/trace-event.ts`、`src/classification.ts`、`src/durable-promotion-registry.ts`、`src/types.ts` | 冻结 durable/live/transcript 三层真相与默认 durable 提升注册表 | high |
| P1-03 | Phase 1 | truncation / metric names | `add` | `src/truncation.ts`、`src/metric-names.ts` | 为 evidence 与命名提供统一基线 | medium |
| P2-01 | Phase 2 | sink interface | `add` | `src/sink.ts` | 所有 durable trace 写入走单一 seam | high |
| P2-02 | Phase 2 | audit codec | `add` | `src/audit-record.ts` | trace 与 `audit.record` 对齐 | high |
| P2-03 | Phase 2 | do-storage sink | `add` | `src/sinks/do-storage.ts` | 建立 v1 主 durable sink | high |
| P2-04 | Phase 2 | timeline builder | `add` | `src/timeline.ts` | 按 session 读取排序 trace | medium |
| P3-01 | Phase 3 | session inspector | `add` | `src/inspector.ts` | 实时观察 `session.stream.event` | medium |
| P3-02 | Phase 3 | scenario schema / runner | `add` | `src/scenario.ts`、`src/runner.ts` | 脚本化验证 session e2e | high |
| P3-03 | Phase 3 | failure replay | `add` | `src/replay.ts` | 从 durable trace 重建失败路径 | high |
| P4-01 | Phase 4 | attribution helpers | `add` | `src/attribution.ts` | 提供 attempt/provider/gateway/cache-state 证据 | medium |
| P4-02 | Phase 4 | placement log | `add` | `src/placement-log.ts` | 为 storage-topology 提供证据 | medium |
| P4-03 | Phase 4 | evidence adapters | `add` | `src/trace-event.ts` | llm/tool/hook/compact/storage 证据 shape 稳定 | high |
| P5-01 | Phase 5 | integration fixtures | `add` | `test/integration/*.test.ts` | timeline / replay / fallback 关键路径稳定回归 | high |
| P5-02 | Phase 5 | schema / doc scripts | `add` | `scripts/*.ts` | 导出 trace schema 与文档 | low |
| P5-03 | Phase 5 | 文档与导出面 | `update` | `README.md`、`src/index.ts` | 下游可直接接入验证基础设施 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 包骨架与 Trace Taxonomy

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | package 骨架 | 参照 `nacp-core` / `nacp-session` 约定建立独立 package | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | 包可 `build/typecheck/test` | 基础命令校验 | 多仓与脚本约定稳定 |
| P1-02 | trace taxonomy | 定义 base fields、evidence extensions、audience、三层分类与 `DurablePromotionRegistry` | `src/trace-event.ts`、`src/classification.ts`、`src/durable-promotion-registry.ts`、`src/types.ts` | live/audit/transcript 边界明确，默认 durable policy 可枚举可审阅 | schema 单测 | 无混淆 durable 与 live 的事件，也不再把 durable 提升规则散落在 if/else 中 |
| P1-03 | truncation / metric names | 定义输出截断策略与 `agent.turn.* / agent.tool.* / agent.api.*` 命名基线，至少覆盖 turn duration / ttft / tool call / api request | `src/truncation.ts`、`src/metric-names.ts` | evidence 命名与大小边界有统一真相 | 单测 | 没有散落命名与任意大 payload |

### 4.2 Phase 2 — TraceSink / Audit Codec / Timeline

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | sink interface | 定义 `emit(event)`、flush/read 相关抽象 | `src/sink.ts` | trace 写入有单一 seam | sink 单测 | Session DO 不感知具体后端 |
| P2-02 | audit codec | trace event 与 `audit.record` 的 builder/parser 对齐 | `src/audit-record.ts` | internal trace 能走 Core transport | codec 单测 | 字段不突破 `audit.record` reality |
| P2-03 | do-storage sink | 实现 tenant-scoped append-only sink | `src/sinks/do-storage.ts` | v1 durable trace 可落到 DO storage | fixture test | 每条事件单行追加，支持读取 |
| P2-04 | timeline builder | 读取并排序一个 session 的全部 durable trace | `src/timeline.ts` | 可构造 session timeline | timeline 单测 | 查询结果稳定且不混入 ephemeral progress |

### 4.3 Phase 3 — Session Inspector / Scenario Runner / Failure Replay

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | session inspector | 订阅 `session.stream.event` 并构造实时观察结果 | `src/inspector.ts` | 可实时观察 session | inspector 单测 | 严格消费现有 9 kinds reality |
| P3-02 | scenario schema / runner | 定义 scenario DSL 并执行 session 验证 | `src/scenario.ts`、`src/runner.ts` | 可以脚本化跑 session e2e | runner 单测 + integration | `run(spec) -> ScenarioResult` 稳定 |
| P3-03 | failure replay | 从 durable trace 抽取失败路径并重建摘要 | `src/replay.ts` | “用户说坏了”可转成可读 replay | replay 单测 | failure path 可重复读取 |

### 4.4 Phase 4 — Evidence Helpers / Placement Log / Attribution

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | attribution helpers | 统一 attempt/provider/gateway/cache-state/ttft 等字段辅助 | `src/attribution.ts` | llm/tool evidence 结构更有解释力 | 单测 | 不只记录“失败了”，还能说明“为什么” |
| P4-02 | placement log | 记录关键对象写入 DO/KV/R2 的 evidence | `src/placement-log.ts` | storage topology 决策有证据来源 | 单测 | 写入证据字段稳定 |
| P4-03 | evidence adapters | 统一 llm/tool/hook/compact/storage 的 event-kind-specific detail | `src/trace-event.ts` | 各子系统都可生产兼容 trace event | adapter 单测 | evidence 字段不再散落 |

### 4.5 Phase 5 — Fixtures / 测试 / 文档 / 收口

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | integration fixtures | 跑通 timeline、replay、WebSocket inspector、HTTP fallback 读取 durable 产物 | `test/integration/*.test.ts` | 观察链路可回归 | 集成测试 | 关键路径稳定 |
| P5-02 | schema / doc scripts | 生成 trace schema 与 trace event 文档 | `scripts/export-schema.ts`、`scripts/gen-trace-doc.ts` | trace contract 可评审 | 脚本测试 | 生成物稳定 |
| P5-03 | 文档与导出面 | 完成 README、public exports、限制说明 | `README.md`、`src/index.ts` | 下游能直接使用本包 | 文档校验 | 支持/不支持边界明确 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 包骨架与 Trace Taxonomy

- **Phase 目标**：冻结 observability 的最小真相。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - `packages/eval-observability/src/trace-event.ts`
  - `packages/eval-observability/src/classification.ts`
  - `packages/eval-observability/src/durable-promotion-registry.ts`
  - `packages/eval-observability/src/metric-names.ts`
- **本 Phase 修改文件**：
  - `packages/eval-observability/package.json`
  - `packages/eval-observability/README.md`
- **具体功能预期**：
  1. `TraceEvent` 具备 base fields 与 extension slots，不再让各子系统自造 detail shape。
  2. live stream / durable audit / durable transcript 的分类规则被明确写死。
  3. `DurablePromotionRegistry` 以可枚举 entry 的方式记录默认 durable promotion 规则，至少说明：事件集合、durable 粒度（full/summary/sample）、replay 可见度、revisit 条件，确保团队随时能回顾“当前 durable 粒度意味着什么观察度”。
  4. 输出截断与 metric naming 拥有统一基线，至少覆盖 turn duration、ttft、tool call、api request/error 等 v1 必需指标名。
- **具体测试安排**：
  - **单测**：schema、classification、durable promotion registry、truncation、metric name constants
  - **集成测试**：无
  - **回归测试**：classification matrix 与 durable promotion policy 快照
  - **手动验证**：对照 `eval-observability-by-opus.md` §5.3
- **收口标准**：
  - trace taxonomy 与三分法稳定
  - 高频 ephemeral 事件不会误入 durable audit
  - durable promotion policy 变成可枚举、可审阅、可回顾的注册表
  - package scripts 与多仓约定稳定
- **本 Phase 风险提醒**：
  - taxonomy 若没写清，后续 sink/timeline/replay 全部会漂移

### 5.2 Phase 2 — TraceSink / Audit Codec / Timeline

- **Phase 目标**：把 durable trace 的写入与读取地基做好。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
  - `P2-04`
- **本 Phase 新增文件**：
  - `packages/eval-observability/src/sink.ts`
  - `packages/eval-observability/src/audit-record.ts`
  - `packages/eval-observability/src/sinks/do-storage.ts`
  - `packages/eval-observability/src/timeline.ts`
- **具体功能预期**：
  1. Session DO 只调 `traceSink.emit(event)`，不关心后端细节。
  2. internal durable trace 通过 `audit.record` 对齐 `nacp-core` reality。
  3. `DoStorageTraceSink` 提供 append-only v1 主路径。
  4. `SessionTimeline` 能稳定按 session 构建 durable 事件序列。
  5. `classification.ts` 与 `DurablePromotionRegistry` 共同决定默认 durable promotion 集合，而不是把哪些事件可持久化写散在 sink / replay / runtime 的条件分支里。
- **具体测试安排**：
  - **单测**：sink interface、audit codec、timeline ordering
  - **集成测试**：fake DO storage append/read
  - **回归测试**：durable trace 不含 `llm.delta` / `tool.call.progress` 全量事件
  - **手动验证**：对照 `packages/nacp-core/src/messages/system.ts`
- **收口标准**：
  - sink/codec/timeline 三层边界明确
  - durable trace 与 live stream 不混淆
  - 默认 durable promotion 集合可通过 registry 直接枚举与 review
  - per-session append/read 路径稳定
- **本 Phase 风险提醒**：
  - 若将 `audit.record` detail 设计过宽，会重新引入敏感数据与大对象问题

### 5.3 Phase 3 — Session Inspector / Scenario Runner / Failure Replay

- **Phase 目标**：让 trace 真正可消费。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - `packages/eval-observability/src/inspector.ts`
  - `packages/eval-observability/src/scenario.ts`
  - `packages/eval-observability/src/runner.ts`
  - `packages/eval-observability/src/replay.ts`
- **具体功能预期**：
  1. `SessionInspector` 可消费现有 `session.stream.event` 9 kinds。
  2. `ScenarioRunner` 可脚本化验证 `session.start -> tool/hook/compact -> session.end`。
  3. `FailureReplayHelper` 可从 durable trace 中提取失败路径摘要。
  4. inspector 与 runner 都应承认 WebSocket-first + HTTP fallback reality：实时看用 WS，事后取 durable timeline/transcript 可走 HTTP fallback。
- **具体测试安排**：
  - **单测**：inspector、scenario schema、runner/replay helper
  - **集成测试**：fake session stream + durable timeline
  - **回归测试**：断线后改读 durable 产物的 fallback 路径
  - **手动验证**：对照 `packages/nacp-session/src/stream-event.ts`
- **收口标准**：
  - 实时观察与事后重放都有稳定入口
  - runner 不依赖生产 Worker 常驻逻辑
  - HTTP fallback 与 WS 读取路径共享同一对象模型
- **本 Phase 风险提醒**：
  - 若 ScenarioRunner 绑定过深到 deploy/runtime，会破坏可测试性

### 5.4 Phase 4 — Evidence Helpers / Placement Log / Attribution

- **Phase 目标**：让 trace 从“记录”升级为“能解释”。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - `packages/eval-observability/src/attribution.ts`
  - `packages/eval-observability/src/placement-log.ts`
- **本 Phase 修改文件**：
  - `packages/eval-observability/src/trace-event.ts`
- **具体功能预期**：
  1. llm/tool/hook/compact/storage evidence 有统一字段预留。
  2. provider/gateway/attempt/cache-state/ttft 等 attribution 可标准化记录。
  3. storage placement evidence 能解释“某条数据被写到了 DO/KV/R2 的哪里”。
- **具体测试安排**：
  - **单测**：attribution helper、placement log
  - **集成测试**：storage placement evidence scenario
  - **回归测试**：cache-state / attempt / provider 字段兼容性
  - **手动验证**：对照 `context/codex/codex-rs/otel/src/events/session_telemetry.rs`、`context/claude-code/services/api/logging.ts`
- **收口标准**：
  - evidence 字段足够支撑 storage-topology 与 replay 分析
  - 不把敏感值原样写入 attribution
  - placement log 成为 topology 决策证据源
- **本 Phase 风险提醒**：
  - 过度追求字段丰度会让 v1 trace schema 失控

### 5.5 Phase 5 — Fixtures / 测试 / 文档 / 收口

- **Phase 目标**：把 observability 从设计论证变成可运行基建。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
  - `P5-03`
- **本 Phase 新增文件**：
  - `packages/eval-observability/test/integration/session-timeline.test.ts`
  - `packages/eval-observability/test/integration/failure-replay.test.ts`
  - `packages/eval-observability/scripts/export-schema.ts`
  - `packages/eval-observability/scripts/gen-trace-doc.ts`
- **本 Phase 修改文件**：
  - `packages/eval-observability/README.md`
  - `packages/eval-observability/src/index.ts`
- **具体功能预期**：
  1. timeline、replay、inspector、fallback 读取 durable 产物都能稳定回归。
  2. README 能清楚说明三分法与 v1 不支持项。
  3. trace schema 与文档生成物可供后续 review 与 runtime 接线。
  4. durable promotion registry 及其 replay 可见度说明可被导出并随文档一起审阅。
- **具体测试安排**：
  - **单测**：补齐未覆盖模块
  - **集成测试**：timeline、replay、inspector、placement evidence
  - **回归测试**：classification 与 durable policy 快照
  - **手动验证**：模拟失败 session 并读取 replay
- **收口标准**：
  - eval-observability package 可独立 build/typecheck/test
  - scenario runner 与 failure replay 可直接服务后续骨架验证
  - 文档能解释 trace、timeline、runner、fallback 的边界
  - 团队可直接审阅“哪些事件 durable、以什么粒度 durable、对应能回看什么 replay”
- **本 Phase 风险提醒**：
  - 若只验证 happy path，会掩盖 durable/live 分层是否真的成立

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 2 / Phase 4 / storage-topology`
- **为什么必须确认**：这决定 durable trace 的 archive 触发时机与责任归属，关系到 DO storage 占用与 session 结束后的读取链路。
- **当前建议 / 倾向**：`本包只负责 DoStorageTraceSink 与 archive key/evidence helper；真正的 R2 archive 编排留给 session-do-runtime / storage-topology 层`
- **Q**：`v1 是否同意把 R2 archive 的物理编排留在运行时装配层，而不是塞进 eval-observability 包内？`
- **A**：同意。

#### Q2

- **影响范围**：`Phase 3 / session-do-runtime`
- **为什么必须确认**：ScenarioRunner 与 Inspector 是否必须同时支持 HTTP fallback，会直接影响接口与测试基座设计。
- **当前建议 / 倾向**：`实时检查坚持 WebSocket-first；HTTP fallback 先支持读取 durable timeline / transcript，不要求等价实时流`
- **Q**：`v1 是否接受“实时观察走 WebSocket，HTTP fallback 只负责读取 durable 产物”的分层策略？`
- **A**：通过阅读 `docs/investigation/action-plan-qna-clarification-batch-1.md` 后，业主表示同意采取推荐措施：`实时观察坚持 WebSocket-first；HTTP fallback 只负责 durable timeline / transcript / summary 等 durable 产物读取，不要求等价实时流。`

#### Q3

- **影响范围**：`Phase 1 / Phase 2 / Phase 4`
- **为什么必须确认**：不是所有 live stream 事件都值得 durable 化，默认提升哪些事件会直接决定写放大与 replay 粒度。
- **当前建议 / 倾向**：`默认 durable：turn.begin/turn.end、tool.result/error 摘要、hook outcome 摘要、compact start/end、llm call summary、storage placement；默认不 durable：llm.delta / tool.call.progress 全量流`
- **Q**：`v1 durable trace 的默认提升集合是否按上述“摘要级 durable、流式 progress 不 durable”的策略冻结？`
- **A**：同意。但我认为我们应该维护一个注册表。随时让我们回顾当前的粒度代表了什么的 replay 内容，我们可以预期得到什么样的观察度。

### 6.2 问题整理建议

- 优先冻结 durable trace 的最小集合与 archive 责任边界
- owner 要求的 durable promotion 注册表需要同步回填到 taxonomy / docs 输出
- 不把未来 dashboard / BI / billing 诉求提前绑进 v1 包结构
- owner 决策需要同步回填到 `storage-topology` 与 `session-do-runtime` 文稿

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| live 与 durable 混淆 | 把高频 progress 全量 durable 会造成写放大与失真 | high | 三分法前置冻结，classification helper 强制执行 |
| trace schema 漂移 | llm/tool/hook/storage 各写各的 detail | high | 统一 `TraceEvent` base + extensions，禁止旁路 |
| sink 过早绑死部署编排 | 把 archive / lifecycle 都塞进本包 | medium | 本包只做 sink/helper，不接管最终 runtime wiring |
| inspector 只押 WebSocket | 网络退化时失去可观察性 | medium | WS-first + HTTP fallback 读取 durable 产物并存 |
| evidence 泄露敏感信息 | request body / payload / file path 直接进 trace | high | redaction hint、truncation、最小 detail 原则、只记录 presence/summary 不记录 secrets |

### 7.2 约束与前提

- **技术前提**：Cloudflare Workers / Durable Objects / TypeScript / append-only JSONL / 无本地 terminal
- **运行时前提**：client-visible live stream 走 `session.stream.event`，internal durable trace 走 `audit.record`；session delivery 是 WebSocket-first，但 observability 读取链路必须承认 HTTP fallback
- **组织协作前提**：`packages/*` 为独立 repo；`@nano-agent/eval-observability` 作为库供 session-do-runtime、hooks、llm-wrapper、capability-runtime 复用；最终 deployable Worker / DO 组装层在后续运行时包中完成
- **上线 / 合并前提**：不得把全部 live stream 强行 durable 化；不得引入 production APM/OTEL exporter 重依赖；不得把 archive 编排与查询平台误写进本包

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/eval-observability-by-opus.md`
  - `docs/design/storage-topology-by-opus.md`
  - `docs/design/session-do-runtime-by-opus.md`
- 需要同步更新的说明文档 / README：
  - `README.md`
  - `packages/eval-observability/README.md`
- 需要同步更新的测试说明：
  - `packages/eval-observability/test/README.md`（如创建）

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `packages/eval-observability` 可独立 `build/typecheck/test`
  - schema/doc 脚本可稳定输出
- **单元测试**：
  - trace taxonomy、classification、sink、timeline、inspector、replay、attribution、placement log
- **集成测试**：
  - fake DO storage trace sink
  - session timeline 读取
  - failure replay
  - WS inspector + HTTP fallback durable read
- **端到端 / 手动验证**：
  - 模拟 `session.start -> llm -> tool -> hook -> compact -> session.end`
  - 手动构造失败 trace 并用 replay helper 重读
- **回归测试**：
  - durable promotion policy 快照
  - `audit.record` detail shape 快照
  - classification matrix 回归
- **文档校验**：
  - README、trace schema、doc 生成物与 design/action-plan 一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `@nano-agent/eval-observability` 已形成独立包骨架与稳定导出面
2. live stream / durable audit / durable transcript 三层边界已被实现而非仅停留在文档里
3. `TraceSink / SessionTimeline / SessionInspector / ScenarioRunner / FailureReplay` 已可稳定联动
4. storage placement 与 llm/tool/hook evidence 已拥有统一字段与最小归因能力
5. WebSocket-first 与 HTTP fallback 读取 durable 产物的双路径都能复用同一对象模型

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | eval-observability 已具备 trace schema、sink、timeline、inspector、runner、replay、placement evidence |
| 测试 | live/durable 分类、sink/timeline/replay/fallback 关键场景均可稳定回归 |
| 文档 | action-plan、设计文稿、README、schema/doc 生成物同步完成 |
| 风险收敛 | 不再混淆 live 与 durable，不再依赖 console-style 临时调试 |
| 可交付性 | 包可被 session-do-runtime、hooks、llm-wrapper、capability-runtime 直接导入并继续装配 |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

> 这份 action-plan 以 **建立 nano-agent 的验证基础设施** 为第一优先级，采用 **先 trace taxonomy、再 sink/timeline、后 runner/replay 与 evidence 收口** 的推进方式，优先解决 **Worker 环境里如何结构化观测 session、如何 durable 化真正有价值的证据、如何让后续 storage-topology 与 runtime 决策建立在事实之上**，并把 **不做生产级 APM、不混淆 live 与 durable、不把 deploy/archive 编排提前塞进库包** 作为主要约束。整个计划完成后，`Eval & Observability` 应达到 **能够支撑 session skeleton 验证、失败重放、storage 证据收集与长期调试** 的程度，从而为后续的 session-do-runtime、storage-topology 与更高级别的产品验证提供可靠基础。
