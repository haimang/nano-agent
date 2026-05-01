# Nano-Agent 测试矩阵全量分析：`HPX1-worker-test-cleanup-and-enhance`

> 审查对象: `workers/*/test/` (6 个 worker 共 217 个测试文件) + `test/package-e2e/` (23 个 e2e 测试文件)
> 审查类型: `test-coverage-analysis | redundancy-analysis | gap-analysis | placement-review`
> 审查时间: `2026-05-01`
> 审查人: `DeepSeek v4-pro（独立审查，未参考 Kimi、DeepSeek Chat、GPT 或 Opus 的既有分析报告）`
> 审查范围:
> - `workers/agent-core/test/` — 103 个测试文件
> - `workers/bash-core/test/` — 30 个测试文件
> - `workers/context-core/test/` — 20 个测试文件
> - `workers/filesystem-core/test/` — 27 个测试文件
> - `workers/orchestrator-auth/test/` — 4 个测试文件
> - `workers/orchestrator-core/test/` — 33 个测试文件
> - `test/package-e2e/` — 23 个测试文件（分布于 6 个目标子目录）
> 对照真相:
> - `workers/*/src/` 全部源码 (6 个 worker 的完整实现)
> - `workers/*/wranger.jsonc` — deployment binding 合约
> - `packages/` — 跨 package 类型合约 (@haimang/nacp-core, @nano-agent/*)
> 文档状态: `reviewed`

---

## 0. 总结结论

> 整体判断: 当前 6 个 worker 的 217 个测试文件整体质量良好, 测试金字塔分层清晰（单元→集成→e2e 探针）, 但有 7 个明确冗余对、package-e2e 中存在 10 个不属于 e2e 而应回归 worker 内部的测试项、以及若干系统性测试缺口需要补强。本轮分析为 HPX1 阶段的 cleanup 和 enhance 提供可操作清单。

- **整体判断**: `测试架构骨架成立，但存在 7 处冗余对、10 个 e2e 误放项、以及 5 类系统性缺口，需在 HPX1 阶段执行 cleanup + enhance`
- **结论等级**: `changes-requested`
- **是否允许关闭本轮 review**: `no — 需按本文 §3 执行清理和按 §4 补强后方可收口`
- **本轮最关键的 1-3 个判断**:
  1. **`test/package-e2e/` 中超过 40% 的测试（10/23）实际是单 worker HTTP 探针，应迁移至对应 worker 内部** — 这些测试直接命中 `workers_dev: false` 的 leaf worker（bash-core/agent-core/context-core/filesystem-core），不跨越 worker 边界，不满足 "package e2e" 定义。
  2. **agent-core 和 context-core 中存在明确的代码路径冗余测试对（如 `compact-reinject.test.ts` vs `compact-boundary.test.ts`)，可安全合并或删除一方** — 这些文件测试完全相同的函数和 schema 解析路径，仅测试数据不同。
  3. **存在 5 类系统性测试缺口：跨 worker hook 集成、compaction 管线 e2e、checkpoint archive/restore e2e、bash-core HTTP 错误分类专项、以及 agent-core 的 `orchestration.test.ts` 过度膨胀需拆分** — 这些是高价值回归点，当前完全无覆盖。

---

## 1. 审查方法与已核实事实

> 这一节只写事实，不写结论。明确我核查了哪些文件、使用了何种方法。

### 1.1 审查方法论

本轮采用 **五层并行分析** 策略：

1. **全量文件枚举** — 通过 glob 扫描所有 6 个 worker 的 `test/` 目录和 `test/package-e2e/` 目录，确认总文件数为 217 + 23 = 240。
2. **分层阅读** — 将 240 个文件按 worker 拆分，通过 6 个并行 agent 逐文件阅读其 `describe/it/test` 实际内容（非仅判读文件名），记录每个测试文件的代码覆盖范围和断言类型。
3. **冗余判定** — 对每对功能相似的测试文件执行交叉比对，判定是否存在代码路径重复。
4. **e2e 归属判定** — 对 `test/package-e2e/` 中的每个文件，分析其是否真正跨越 worker 边界（通过 service binding 或 HTTP 调用真实下游），还是仅测试单 worker HTTP 面。
5. **缺口分析** — 从源码结构出发，逐模块检查是否有未覆盖的关键代码路径。

- **核查实现**:
  - `workers/*/test/**/*.test.*` — 逐文件阅读全部 217 个测试的实际断言内容
  - `test/package-e2e/**/*.test.mjs` — 逐文件阅读全部 23 个 e2e 测试的实际请求目标
  - `workers/*/wrangler.jsonc` — 核对 `workers_dev` 配置，判定 leaf worker 的 HTTP 可达性
  - `workers/orchestrator-core/src/index.ts` — 核对公共 facade 路由表
- **执行过的验证**:
  - 各 worker test 目录下的 `smoke.test.ts` 文件横向对比，确认 probe shape 测试的重复程度
  - `bash-core/test/smoke.test.ts` 与 `test/package-e2e/bash-core/*` 逐行比对
  - `agent-core/test/host/composition-*.test.ts` 之间的函数调用链对比
  - `context-core/test/compact-boundary.test.ts` 与 `context-core/test/integration/compact-reinject.test.ts` 的 schema 解析路径对比
- **复用 / 对照的既有审查**:
  - 无 — 本轮为独立审查，未参考 Kimi、GPT 或 Opus 的同主题分析报告。

### 1.2 测试全景数据

| Worker | 测试文件数 | 总测试规模估算 | 组织结构 |
|--------|-----------|---------------|---------|
| agent-core | 103 | ~1500+ 测试用例 | 6 个子目录：`eval/`、`hooks/`、`host/`、`kernel/`、`llm/`、`smoke`/`rpc` |
| bash-core | 30 | ~350+ 测试用例 | 3 层：单元 (`test/`)、capability (`test/capabilities/`)、integration (`test/integration/`) |
| context-core | 20 | ~300+ 测试用例 | 3 层：核心单元、`async-compact/`、`integration/` |
| filesystem-core | 27 | ~400+ 测试用例 | 4 层：核心单元、`backends/`、`storage/`、`storage/integration/` |
| orchestrator-auth | 4 | ~100+ 测试用例 | 2 层：service 核心、bootstrap/hardening |
| orchestrator-core | 33 | ~600+ 测试用例 | 3 层：route (facade)、plane (service)、DO (core behavioral) |
| **合计** | **217** | **~3250+ 测试用例** | |

| Package-E2E 目标 | 文件数 | 真正 e2e | 误放（应回归 worker） |
|-----------------|--------|----------|----------------------|
| bash-core | 6 | 0 | 6 |
| agent-core | 1 | 0 | 1 |
| context-core | 2 | 0 | 2 |
| filesystem-core | 2 | 0 | 2 |
| orchestrator-auth | 1 | 0 | 1 |
| orchestrator-core | 11 | 10 | 1 (07-legacy 放错目录) |
| **合计** | **23** | **10** | **13** |

### 1.3 已确认的正面事实

- **6 个 worker 的单元测试覆盖率整体良好**。大部分源码模块都有对应测试文件，测试分层遵循"unit → integration"金字塔，route/plane/DO 三层测试在 orchestrator-core 中尤为完善。
- **bash-core 的 capability 测试分层设计非常规范**。`planner-*.test.ts`（planner 层）与 `capabilities/*.test.ts`（handler 层）形成清晰的 planner-vs-handler 责任分离，git-subset、text-processing、grep alias 均采用此模式，为最佳实践。
- **orchestrator-core 的 migration schema freeze 测试 (`migrations-schema-freeze.test.ts`) 是出色的设计 invariant 回归门**。全量应用 001-013 migration 到 in-memory SQLite 并验证 DDL 合约，这在 cloudflare workers 环境下极为罕见且有价值。
- **filesystem-core 的 cross-package contract 集成测试 (`scoped-io-alignment.test.ts`、`placement-evidence-revisit.test.ts`) 正确使用了跨 package 类型验证**，确保本 worker 的 key 生成与 `@haimang/nacp-core` 的 scoped-io 写入路径一致。
- **`orchestrator-core/11-rh5-models-image-reasoning.test.mjs` 是项目中唯一一个端到端验证 vision+reasoning + filesystem + D1 全管线的 e2e 测试**，覆盖 4 层服务交互，价值极高。
- **所有 217 个 worker 测试均能在当前代码库中成功编译/执行**，不存在引用已删除模块或废弃函数的"僵尸测试"。没有 stale、invalid 文件。

### 1.4 已确认的负面事实

- **`test/package-e2e/` 中 56.5% 的测试（13/23）不是真正的 "package e2e"**。其中 12 个直接命中 `workers_dev: false` 的 leaf worker（bash-core/agent-core/context-core/filesystem-core/orchestrator-auth），1 个（`07-legacy-agent-retirement.test.mjs`）放在错误的 worker 目录下。
- **存在 7 个明确的测试冗余对**，分布在 agent-core (4 对)、context-core (2 对)、orchestrator-core (1 对)，测试相同的代码路径但使用略微不同的 fixture 数据。
- **bash-core 的 HTTP 错误分类测试（error-envelopes、malformed-body）仅存在于 package-e2e，未反映在 worker 内部测试**。这是一个测试归属的颠倒——单元级输入验证本应是 worker 测试中最先覆盖的内容。
- **`agent-core/test/host/orchestration.test.ts` 达到 31,941 bytes，包含过多离散关注点**，已从"orchestrator 状态机"膨胀为包含 hooks/traces/stream events/checkpoint/input-draining/cancellation 的巨量单文件。
- **context-core 的 `integration/compact-reinject.test.ts` 是 `compact-boundary.test.ts` 的近乎完全副本** — 两者测试相同的 `buildCompactRequest` schema 解析、`applyCompactResponse` 边界标记注入、和 `pickSplitPoint` 预算感知切分。

### 1.5 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐文件阅读全部 240 个测试的实际测试用例内容，记录其覆盖的函数和模块 |
| 本地命令 / 测试 | no | 本轮执行的是静态代码分析，未实际运行测试套件 |
| schema / contract 反向校验 | yes | 对 e2e 测试的归属判定基于 `wrangler.jsonc` 中 `workers_dev` 配置值 |
| live / deploy / preview 证据 | no | 本轮未进行 live deploy 验证 |
| 与上游 design / QNA 对账 | no | 本轮聚焦测试覆盖分析，未与 design doc 逐项对账 |

---

## 2. 审查发现

> 使用稳定编号：`R1 / R2 / R3 ...`。每条 finding 都包含：严重级别、类型、事实依据、为什么重要、审查判断、建议修法。

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | package-e2e 中 12 个 leaf-worker HTTP 探针应回归对应 worker 内部 | high | test-gap | yes | 迁移至 worker test |
| R2 | 7 个 worker 内部测试冗余对需要合并/删除 | medium | correctness | no | 合并或删除 |
| R3 | bash-core HTTP 输入验证测试仅存在于 e2e 而非 worker 内部 | high | test-gap | yes | 补充至 worker test |
| R4 | agent-core `orchestration.test.ts` 过度膨胀需要拆分 | medium | delivery-gap | no | 拆分为多个测试文件 |
| R5 | `orchestrator-core/07-legacy-agent-retirement.test.mjs` 放错 worker 目录 | medium | correctness | no | 移至 agent-core 或删除 |
| R6 | `orchestrator-core/09-api-key-smoke.test.mjs` 直接 INSERT 生产 D1 | medium | platform-fitness | no | 标记风险或加 env guard |
| R7 | agent-core 的 `eval/sink.test.ts` 仅测试 test-only 接口，无生产价值 | low | correctness | no | 删除 |
| R8 | orchestrator-auth 的 `InMemoryAuthRepository` 在两个测试文件中重复定义 | low | correctness | no | 提取共享测试 helper |

### 2.2 详细发现

---

### R1. `test/package-e2e/` 中 12 个 leaf-worker HTTP 探针不属于 e2e（应回归 worker 内部）

- **严重级别**: `high`
- **类型**: `test-gap`
- **是否 blocker**: `yes`
- **事实依据**:
  - `test/package-e2e/bash-core/01-preview-probe.test.mjs` — 直接请求 `bash-core` root `/` 探针端点。bash-core 在 `wrangler.jsonc` 中配置为 `workers_dev: false`，是纯 library worker，仅通过 service binding 被其他 worker 调用。该测试绕过了 binding 架构，直接在 HTTP 层命中了不当暴露的 leaf worker 面。
  - `test/package-e2e/bash-core/02-capability-call-route.test.mjs` — POST `pwd` 到 `/capability/call`，与 `workers/bash-core/test/smoke.test.ts:80-101` 测试完全相同的路径（"executes a live capability call for pwd"）。
  - `test/package-e2e/bash-core/03-capability-cancel-route.test.mjs` — 调用 `__px_sleep` 后 cancel，与 `workers/bash-core/test/smoke.test.ts:103-142` 重叠。
  - `test/package-e2e/agent-core/01-preview-probe.test.mjs` — 与 `workers/agent-core/test/smoke.test.ts:38-55` 重复。
  - `test/package-e2e/context-core/01-preview-probe.test.mjs` — 与 `workers/context-core/test/smoke.test.ts` 中 probe 测试重复。
  - `test/package-e2e/filesystem-core/01-preview-probe.test.mjs` — 与 `workers/filesystem-core/test/smoke.test.ts` 中 probe 测试重复。
  - `test/package-e2e/context-core/02-library-worker-posture.test.mjs` — POST 到 `/runtime` 验证 404，验证 library-worker 姿态。这种"不应存在运行时路由"的断言应当属于 worker 自身的测试范畴。
  - `test/package-e2e/filesystem-core/02-library-worker-posture.test.mjs` — 同上，验证 library-worker-only 表面。
  - `test/package-e2e/orchestrator-auth/01-probe.test.mjs` — 验证 auth worker 的 `workers_dev: false` + `rpc_surface: true` 姿态。虽然该 worker 不是 leaf worker，但仍为单 worker 的部署合约验证。
  - `test/package-e2e/bash-core/04-capability-sampling.test.mjs`、`05-capability-error-envelopes.test.mjs`、`06-capability-malformed-body.test.mjs` — 这三个测试虽不与现有 worker 测试完全重复（smoke 测试未覆盖完整的 error taxonomy 和 malformed-body 验证），但本质仍是单 worker HTTP 输入验证，应回归 `workers/bash-core/test/`。
- **为什么重要**:
  - package-e2e 的目的是验证"多个 worker 在真实部署中通过 service binding / HTTP 调用的集成行为"。直接命中 leaf worker 内部端点是对该目的的模糊化——这些测试中不存在跨 worker 行为。
  - 将单体 worker 测试留在 e2e 会掩盖两点关键事实：(1) e2e 测试无法在 PR CI 中证明任何跨 worker 集成安全；(2) worker 内部缺乏 HTTP 面的完整输入验证覆盖。
- **审查判断**:
  - 12 个测试应当从 `test/package-e2e/` 中移除并重组: (a) 与现有 worker 测试完全重复的 (preview-probe、capability-call、capability-cancel) → **直接删除，不迁移**；(b) 在 worker 内部尚无对等覆盖的 (error-envelopes、malformed-body、library-worker-posture) → **迁移至对应 worker 的 test 目录并命名对齐**。
- **建议修法**:
  1. **删除**（已由 worker 内部覆盖）：`bash-core/01`、`bash-core/02`、`bash-core/03`、`agent-core/01`、`context-core/01`、`filesystem-core/01`
  2. **迁移至 worker 内部**（作为新的 worker 测试文件）：
     - `bash-core/04 → workers/bash-core/test/http-sampling.test.ts`
     - `bash-core/05 → workers/bash-core/test/http-error-taxonomy.test.ts`（合并 05 和 06）
     - `bash-core/06 → 合并至上述 http-error-taxonomy.test.ts`
     - `context-core/02 → workers/context-core/test/library-worker-posture.test.ts`
     - `filesystem-core/02 → workers/filesystem-core/test/library-worker-posture.test.ts`
     - `orchestrator-auth/01 → workers/orchestrator-auth/test/probe-posture.test.ts`（此文件可保留在 e2e 作为 auth-canary，但内容本身是单 worker 验证）

---

### R2. 7 个 worker 内部测试冗余对需要合并/删除

- **严重级别**: `medium`
- **类型**: `correctness`
- **是否 blocker**: `no`

#### R2.1: agent-core — `host/composition-local-ts-fallback.test.ts` vs `host/composition-p2-upgrade.test.ts`

- **事实依据**: 两个文件均测试 `compositionFactory` 的 capability transport 选择逻辑（service-binding → local-ts fallback → unavailable）。`composition-local-ts-fallback.test.ts` 的 4 个测试是 `composition-p2-upgrade.test.ts` 中对应场景的严格子集。
- **审查判断**: `composition-local-ts-fallback.test.ts` 可安全删除，保留 `composition-p2-upgrade.test.ts` 作为该模块的权威工厂测试。
- **建议修法**: 删除 `host/composition-local-ts-fallback.test.ts`，确认 `composition-p2-upgrade.test.ts` 已覆盖其所有断言。

#### R2.2: agent-core — `host/integration/graceful-shutdown.test.ts` vs `host/shutdown.test.ts`

- **事实依据**: `shutdown.test.ts`（单元）已覆盖 hook 发射顺序、trace flush、WS close codes、error resilience。`graceful-shutdown.test.ts`（集成）增加了 `buildSessionCheckpoint` + `validateSessionCheckpoint` 集成，但核心断言与单元测试高度重叠。
- **审查判断**: 合并两文件。将 `graceful-shutdown.test.ts` 中的 checkpoint round-trip 验证归入 `shutdown.test.ts`，删除 `graceful-shutdown.test.ts`。
- **建议修法**: 将 `graceful-shutdown.test.ts` 中 `buildSessionCheckpoint` + `validateSessionCheckpoint` 相关的测试用例合并到 `shutdown.test.ts`，原集成文件删除。

#### R2.3: agent-core — `host/integration/ws-http-fallback.test.ts` vs `host/routes.test.ts` + `host/ws-controller.test.ts`

- **事实依据**: `ws-http-fallback.test.ts` 的"路由分发到正确 controller"测试 = `routes.test.ts` + `ws-controller.test.ts` 已经独立测试的路径。唯一的"共享 actor state 模型"测试手动调用 `transitionPhase` 而不涉及实际 controller 交互。
- **审查判断**: 可安全删除 `ws-http-fallback.test.ts`。路由分发和 WsController 行为已有各自的权威单元测试。
- **建议修法**: 删除 `host/integration/ws-http-fallback.test.ts`。

#### R2.4: agent-core — `llm/integration/retry-timeout.test.ts` vs `llm/executor.test.ts`

- **事实依据**: `executor.test.ts` 已覆盖全部 retry 场景（500 重试、429 重试、401/400 不重试、Retry-After 遵守、timeout、provider retryConfig override）。`retry-timeout.test.ts` 使用不同 fixture 重新测试相同行为。唯一增量是验证 `rotateApiKey` 通过 `ProviderRegistry` 调用，但这可在 executor 测试中增加一个用例。
- **审查判断**: 将 `rotateApiKey` 验证补充到 `executor.test.ts`，删除 `retry-timeout.test.ts`。
- **建议修法**: 在 `executor.test.ts` 中添加一个 `rotateApiKey` 调用链验证，删除 `llm/integration/retry-timeout.test.ts`。

#### R2.5: context-core — `integration/compact-reinject.test.ts` vs `compact-boundary.test.ts`

- **事实依据**: 两者测试相同的三个函数（`buildCompactRequest`、`applyCompactResponse`、`pickSplitPoint`），均使用 `ContextCompactRequestBodySchema.safeParse` 和 `ContextCompactResponseBodySchema.safeParse`。`integration/compact-reinject.test.ts` 没有测试任何 `compact-boundary.test.ts` 未覆盖的代码路径。
- **审查判断**: 这是本轮发现中最干净的冗余 — `integration/compact-reinject.test.ts` 可无保留删除。
- **建议修法**: 删除 `context-core/test/integration/compact-reinject.test.ts`。

#### R2.6: context-core — `integration/fake-workspace-flow.test.ts` vs `integration/snapshot-restore-fragment.test.ts` + `snapshot.test.ts`

- **事实依据**: 三个文件均测试 snapshot build → populated fields → restore roundtrip。`fake-workspace-flow.test.ts` 增加了 artifact promotion 步骤，`snapshot-restore-fragment.test.ts` 增加了多 mount + context layers，而 `snapshot.test.ts` 是基础的 build/restore 测试。
- **审查判断**: 将三者合并为一份权威 snapshot 集成测试（保留 `snapshot-restore-fragment.test.ts` 为容器，合并其余两文件的独特测试用例）。
- **建议修法**: 以 `snapshot-restore-fragment.test.ts` 为基础，合并 `fake-workspace-flow.test.ts` 的 promotion 步骤和 `snapshot.test.ts` 的边界用例，删除另外两份文件。

#### R2.7: agent-core — `eval/sink.test.ts`（孤立测试）

- **事实依据**: 该文件仅测试一个 test-only 的 `InMemoryTraceSink` 实现——它验证 `emit()`/`flush()` 返回 Promise 并且事件可被检索。`InMemoryTraceSink` 不在任何生产代码路径中使用，只为测试 test-only 接口合同而存在。真实的 sink（`DoStorageTraceSink`）已在 `eval/sinks/do-storage.test.ts` 中充分测试。
- **审查判断**: 删除。该测试不覆盖任何生产代码路径。
- **建议修法**: 删除 `agent-core/test/eval/sink.test.ts`。

---

### R3. bash-core HTTP 输入验证规范仅存在于 package-e2e

- **严重级别**: `high`
- **类型**: `test-gap`
- **是否 blocker**: `yes`
- **事实依据**:
  - `test/package-e2e/bash-core/05-capability-error-envelopes.test.mjs` 测试了三个 HTTP 层面的错误 taxonomy：`unknown-tool`、`policy-ask`、`handler-error`。`workers/bash-core/test/smoke.test.ts` 中没有任何对应测试。
  - `test/package-e2e/bash-core/06-capability-malformed-body.test.mjs` 测试了 HTTP 输入验证：`invalid-json`、`invalid-request-shape`、empty body → 400。worker 内部没有这些测试。
  - `test/package-e2e/bash-core/04-capability-sampling.test.mjs` 通过 HTTP 调用 `pwd` 和 `ls`，而 worker 内部的 `integration/command-surface-smoke.test.ts` 仅测试 planner 层（不测试 HTTP envelope）。
- **为什么重要**: HTTP 输入验证属于 worker 自身的防御面，应当在 worker 内部测试中优先覆盖。当前状态是"worker 内部缺乏基本安全防御的测试，而 e2e 提供了这些测试但放在了错误的位置"。当 e2e 目录被清理后，这些测试必须回归 worker 内部。
- **审查判断**: 这些测试对应的业务代码（`bash-core/src/index.ts` 中的 fetch handler 输入解析）确实需要 worker 内部覆盖。应当创建独立的 HTTP 层测试文件。
- **建议修法**:
  1. 创建 `workers/bash-core/test/http-input-validation.test.ts`，包含：JSON 解析错误 → 400、missing `tool_name` → 400、empty body → 400
  2. 创建 `workers/bash-core/test/http-error-taxonomy.test.ts`，包含：`unknown-tool`、`policy-ask`、`handler-error` 三种标准错误 envelope
  3. 将 `http-sampling.test.ts`（从 package-e2e 迁移）纳入 bash-core 测试套件

---

### R4. agent-core `orchestration.test.ts` 过度膨胀需要拆分

- **严重级别**: `medium`
- **类型**: `delivery-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `agent-core/test/host/orchestration.test.ts` 大小 31,941 bytes，覆盖：`createInitialState`、`startTurn`、`runStepLoop`、`drainNextPendingInput`、`cancelTurn`、`endSession`、hook ordering (B5 Setup before SessionStart)、trace-law compliance、`maxTurnSteps` safety cap — 共 9+ 个离散关注点。
  - 其中部分测试（hook ordering、stream event schema 合规）与已有独立测试文件（`hooks/`、`integration/stream-event-schema.test.ts`）存在内容交叠。
- **为什么重要**: 31KB 的单测试文件是维护性债务——当 orchestrator 状态机需要修改时，开发者不知道该修改哪个测试文件，还是需要在膨胀的文件中找到正确的 `describe` block。拆分会降低未来回归退化的风险。
- **审查判断**: 按职责拆分为 4 个文件：`orchestration.state-machine.test.ts`（状态初始化+状态转换）、`orchestration.turn-lifecycle.test.ts`（start→step→complete→end）、`orchestration.input-draining.test.ts`（drainNextPendingInput）、`orchestration.hook-ordering.test.ts`（B5 Setup ordering）。
- **建议修法**: 按上述四个维度拆分 `orchestration.test.ts`，保持 `describe` block 命名一致性。

---

### R5. `orchestrator-core/07-legacy-agent-retirement.test.mjs` 放错 worker 目录

- **严重级别**: `medium`
- **类型**: `correctness`
- **是否 blocker**: `no`
- **事实依据**: 该文件位于 `test/package-e2e/orchestrator-core/` 目录下，但实际测试的是 **agent-core** 的 legacy session 路由（`start`、`input`、`cancel`、`end`、`status`、`timeline`、`verify`、`ws`），验证每个返回 410/426 退休 envelope。
- **审查判断**: 该测试的循环遍历（7 个 action → 410/426）是 `workers/agent-core/test/smoke.test.ts` 中单个 410/426 测试的超集——smoke test 只测试了 `status` (410) 和 `ws` (426)。循环遍历在 package-e2e 中有增量价值，但应将其迁移至 agent-core 自身的测试目录或移入 agent-core e2e 子目录。
- **建议修法**: 一个选择：将 7-action 循环逻辑合并入 `workers/agent-core/test/smoke.test.ts` 使单个 worker 测试更完整，删除 e2e 中的文件。另一个选择：如果保持 e2e 侧面验证，移入 `test/package-e2e/agent-core/` 目录并重命名为 `02-legacy-retirement.test.mjs`。

---

### R6. `orchestrator-core/09-api-key-smoke.test.mjs` 中的直接 D1 INSERT

- **严重级别**: `medium`
- **类型**: `platform-fitness`
- **是否 blocker**: `no`
- **事实依据**: 该测试通过 `wrangler d1 execute` 直接在共享预览环境的 D1 数据库中 INSERT 一行 API key 数据。如果多个 CI runner 或多个开发分支同时运行此 e2e 测试，可能产生数据竞争。
- **为什么重要**: 直接 D1 INSERT 绕过应用层的 API key 创建流程（通常通过 orchestrator-auth 的 RPC 调用），测试的是一条不反映真实用户流程的旁路。同时可能存在 DB 污染风险。
- **审查判断**: 该测试的核心价值是验证 `nak_` API key 的 bearer auth 流程。长期方案是通过 orchestrator-auth RPC 创建 API key（代表真实的用户流程），或为 e2e 创建独立的、可重置的 D1 preview database。
- **建议修法**: 当前标记为 `SKIP_TEARDOWN_RISK`，加 env guard 确保只在独立预览部署上运行。长期需改为通过 RPC 创建 API key 的 e2e 流程。

---

### R7. orchestrator-auth `InMemoryAuthRepository` 类在两个测试文件中重复定义

- **严重级别**: `low`
- **类型**: `correctness`
- **是否 blocker**: `no`
- **事实依据**: `InMemoryAuthRepository` 在 `workers/orchestrator-auth/test/service.test.ts` 和 `workers/orchestrator-auth/test/bootstrap-hardening.test.ts` 中各自完整定义，唯一差别是 `bootstrap-hardening.test.ts` 版本增加了 `latencyMs` 可配置参数。
- **审查判断**: 应提取为共享测试 fixture（`workers/orchestrator-auth/test/support/test-repository.ts`），由两个测试文件引用。
- **建议修法**: 创建 `workers/orchestrator-auth/test/support/in-memory-auth-repository.ts`，合并两个类定义（保留 `latencyMs` 可选项），更新 `service.test.ts` 和 `bootstrap-hardening.test.ts` 的 import。

---

## 3. Test Matrix：全量测试面评估

> 以下对 6 个 worker 的核心模块逐一评估测试覆盖与缺口，使用 matrix 结构。

### 3.1 agent-core（103 文件，~1500+ cases）

| 模块/子域 | 测试文件 | 覆盖状态 | 缺口/冗余 |
|-----------|---------|---------|----------|
| entrypoint (HTTP+RPC) | `smoke.test.ts`, `rpc.test.ts` | ✅ 良好 | — |
| eval/trace 事件 | `trace-event.test.ts`, `classification.test.ts`, `audit-record.test.ts`, `attribution.test.ts`, `anchor-recovery.test.ts` | ✅ 良好 | — |
| eval/inspector | `inspector.test.ts`, `inspector-dedup.test.ts` | ✅ 良好 | — |
| eval/timeline | `timeline.test.ts`, `integration/session-timeline.test.ts` | ✅ 良好 | — |
| eval/replay | `replay.test.ts`, `integration/failure-replay.test.ts` | ✅ 良好 | — |
| eval/evidence | `evidence-streams.test.ts`, `integration/p6-evidence-verdict.test.ts`, `durable-promotion-registry.test.ts` | ✅ 良好 | — |
| eval/sink (trace persistence) | `sinks/do-storage.test.ts`, `sinks/do-storage-placement-emission.test.ts` | ✅ 良好 | — |
| eval/sink interface | `sink.test.ts` | 🔴 冗余 | 仅测试 test-only 接口，应删除 |
| eval/scenario runner | `scenario.test.ts` | ⚠️ 薄 | 仅测试了 mock session，未用真实 DO 运行 scenario |
| eval/benchmark | `scripts/trace-substrate-benchmark.test.ts` | ⚠️ 孤立 | 仅测试 benchmark runner 本身，benchmark 产物未被 CI 使用 |
| hooks/catalog | `catalog.test.ts`, `outcome.test.ts`, `core-mapping.test.ts` | ✅ 优良 | 这是项目中测试质量最高的模块，catalog→outcome→mapping 三层清晰 |
| hooks/dispatcher | `dispatcher.test.ts`, `guards.test.ts`, `matcher.test.ts`, `permission.test.ts` | ✅ 良好 | — |
| hooks/registry | `registry.test.ts`, `snapshot.test.ts`, `session-mapping.test.ts` | ✅ 良好 | — |
| hooks/integration | `compact-guard.test.ts`, `pretool-blocking.test.ts`, `service-binding-timeout.test.ts`, `session-resume-hooks.test.ts` | ✅ 良好 | — |
| hooks/runtimes | `runtimes/service-binding.test.ts` | ✅ 良好 | — |
| hooks/audit | `audit.test.ts` | ✅ 良好 | — |
| host/orchestrator | `orchestration.test.ts` | 🔴 膨胀 | 31KB 单文件，需拆分为 4 个文件 |
| host/state machine | `actor-state.test.ts` | ✅ 良好 | — |
| host/alarm+health | `alarm.test.ts`, `health.test.ts` | ✅ 良好 | — |
| host/checkpoint | `checkpoint.test.ts`, `integration/checkpoint-roundtrip.test.ts` | ✅ 良好 | — |
| host/composition | `composition-p2-upgrade.test.ts`, `composition-profile.test.ts`, **`composition-local-ts-fallback.test.ts`** | 🔴 冗余 | local-ts-fallback 是 p2-upgrade 的子集，应删除 |
| host/cross-seam | `cross-seam.test.ts`, `integration/cross-seam-anchor-live.test.ts` | ✅ 良好 | — |
| host/remote bindings | `remote-bindings.test.ts`, `integration/remote-composition-default.test.ts` | ✅ 良好 | — |
| host/routing+ws | `routes.test.ts`, `ws-controller.test.ts`, `worker.test.ts`, `http-controller.test.ts`, **`integration/ws-http-fallback.test.ts`** | 🔴 冗余 | ws-http-fallback 重复前三者，应删除 |
| host/shutdown | `shutdown.test.ts`, **`integration/graceful-shutdown.test.ts`** | 🔴 冗余 | integration 基本重复 unit，应合并 |
| host/turn ingress | `turn-ingress.test.ts` | ✅ 良好 | — |
| host/traces | `traces.test.ts` | ✅ 良好 | 包含 Kimi R2 mirror drift guard |
| host/ | `runtime-mainline.test.ts`, `system-prompt-seam.test.ts`, `eval-sink.test.ts` | ✅ 良好 | — |
| host/do | `nano-session-do.test.ts`, `default-sink-dedup.test.ts`, `initial-context-consumer.test.ts`, `runtime-assembly.*.test.ts` | ✅ 良好 | — |
| host/context-api | `context-api/append-initial-context-layer.test.ts` | ✅ 良好 | — |
| host/edge trace | `integration/edge-trace.test.ts`, `integration/helper-outbound-wiring.test.ts`, `integration/workspace-evidence-live.test.ts` | ✅ 良好 | — |
| host/stream | `integration/stream-event-schema.test.ts` | ✅ 良好 | — |
| host/heartbeat | `integration/heartbeat-ack-timeout.test.ts` | ✅ 良好 | — |
| host/start-turn-resume | `integration/start-turn-resume.test.ts` | ⚠️ 薄 | 与 checkpoint-roundtrip 重叠，可考虑合并 |
| host/quota | `quota/repository.test.ts` | ⚠️ 薄 | 仅一个测试文件，quota 的计算逻辑未充分覆盖 |
| kernel | `checkpoint.test.ts`, `events.test.ts`, `interrupt.test.ts`, `message-intents.test.ts`, `reducer.test.ts`, `runner.test.ts`, `scheduler.test.ts` | ✅ 优良 | kernel 层的测试密度和隔离度最佳 |
| kernel/scenarios | `basic-turn.test.ts`, `compact-turn.test.ts`, `idle-input-arrival.test.ts`, `interrupt-turn.test.ts`, `tool-turn.test.ts` | ⚠️ 部分冗余 | 与 `runner.test.ts` 有场景重叠但叙述式测试有其价值 |
| llm | `attachment-planner.test.ts`, `canonical.test.ts`, `executor.test.ts`, `gateway.test.ts`, `registry.test.ts`, `request-builder.test.ts`, `session-stream-adapter.test.ts`, `stream-normalizer.test.ts` | ✅ 良好 | — |
| llm/integration | `fake-provider-worker.test.ts`, `local-fetch-stream.test.ts`, `prepared-artifact-routing.test.ts`, **`retry-timeout.test.ts`** | 🔴 冗余 | retry-timeout 被 executor.test.ts 覆盖 |
| **agent-core 缺口总计** | | | 1 个膨胀拆分 / 4 个冗余对 / 2 个薄覆盖 / 1 个孤立 |

### 3.2 bash-core（30 文件，~350+ cases）

| 模块/子域 | 测试文件 | 覆盖状态 | 缺口/冗余 |
|-----------|---------|---------|----------|
| entrypoint | `smoke.test.ts`, `rpc.test.ts` | ✅ 良好 | 但 HTTP 错误 taxonomy 和 malformed-body 验证缺失 |
| executor | `executor.test.ts` | ✅ 良好 | — |
| permission | `permission.test.ts` | ✅ 良好 | B5 authorizer seam 已充分测试 |
| policy | `policy.test.ts` | ✅ 良好 | — |
| registry | `registry.test.ts` | ✅ 良好 | — |
| result/promotion | `result.test.ts` | ✅ 良好 | — |
| tool-call msg | `tool-call.test.ts` | ✅ 良好 | — |
| commands | `commands.test.ts`, `inventory-drift-guard.test.ts` | ✅ 良好 | docs guard 是一个优秀的设计 invariant |
| fake-bash bridge | `fake-bash-bridge.test.ts` | ✅ 良好 | — |
| filesystem handlers | `filesystem.test.ts` | ✅ 良好 | — |
| planner | `planner.test.ts`, `planner-bash-narrow.test.ts`, `planner-git-subset.test.ts`, `planner-grep-alias.test.ts`, `planner-text-processing.test.ts` | ✅ 优良 | planner-vs-handler 分层是最佳实践 |
| capabilities/git | `capabilities/git-subset.test.ts` | ✅ 良好 | 与 planner-git-subset 分层正确 |
| capabilities/network | `capabilities/network-egress.test.ts` | ✅ 优良 | SSRF 防护全面，deny-list 覆盖 10+ 地址段 |
| capabilities/search | `capabilities/search-rg-reality.test.ts` | ✅ 良好 | — |
| capabilities/text | `capabilities/text-processing-core.test.ts`, `capabilities/text-processing-aux.test.ts` | ✅ 优良 | 最详尽的能力测试: POSIX语义/UTF-8安全/subset限制 |
| capabilities/ts-exec | `capabilities/ts-exec-partial.test.ts` | ✅ 良好 | — |
| capabilities/workspace | `capabilities/workspace-truth.test.ts` | ✅ 良好 | — |
| integration | `command-surface-smoke.test.ts`, `file-search-consistency.test.ts`, `local-ts-workspace.test.ts`, `remote-seam-upgrade.test.ts`, `service-binding-progress.test.ts`, `service-binding-transport.test.ts` | ⚠️ functional but thin | 6 个 integration 文件已覆盖核心管道, 但部分仅为单测试文件 |
| **HTTP 错误分类** | ❌ 缺失于 worker | 🔴 缺口 | 当前仅存在于 package-e2e，应补入 `http-error-taxonomy.test.ts` |
| **HTTP 输入验证** | ❌ 缺失于 worker | 🔴 缺口 | 当前仅存在于 package-e2e，应补入 `http-input-validation.test.ts` |
| **bash-core 缺口总计** | | | 2 个 HTTP 面测试缺口（需补入 worker）|

### 3.3 context-core（20 文件，~300+ cases）

| 模块/子域 | 测试文件 | 覆盖状态 | 缺口/冗余 |
|-----------|---------|---------|----------|
| entrypoint/smoke | `smoke.test.ts`, `rpc-context-control-plane.test.ts` | ✅ 良好 | — |
| context assembler | `context-assembler.test.ts` | ✅ 优良 | priority sorting, budget, config layers 全面覆盖 |
| compact boundary | `compact-boundary.test.ts` | ✅ 良好 | — |
| compact lifecycle | `async-compact/committer.test.ts`, `async-compact/orchestrator.test.ts`, `async-compact/persistence-and-retry.test.ts`, `async-compact/planner.test.ts`, `async-compact/prepare-job.test.ts`, `async-compact/scheduler.test.ts` | ✅ 优良 | 6 个文件覆盖 compactor 全生命周期，persistence-and-retry 测试崩溃恢复尤其重要 |
| budget/policy | `budget/policy.test.ts` | ✅ 良好 | — |
| redaction | `redaction.test.ts` | ✅ 良好 | — |
| snapshot | `snapshot.test.ts` | ⚠️ 冗余 | 与 integration 层重叠 |
| inspector facade | `inspector-facade/facade.test.ts` | ✅ 良好 | — |
| initial context API | `context-api/append-initial-context-layer.test.ts` | ✅ 良好 | — |
| integration | `integration/evidence-runtime-wiring.test.ts`, `integration/kernel-adapter.test.ts` | ✅ 良好 | — |
| integration | **`integration/compact-reinject.test.ts`** | 🔴 冗余 | 与 `compact-boundary.test.ts` 完全冗余，应删除 |
| integration | **`integration/fake-workspace-flow.test.ts`** | 🔴 冗余 | 与 snapshot 和 snapshot-restore 重叠，应合并 |
| integration | `integration/snapshot-restore-fragment.test.ts` | ⚠️ 可作为权威 | 建议作为 snapshot roundtrip 的最终集成测试 |
| **context-core 缺口总计** | | | 2 个冗余对（compact-reinject + fake-workspace-flow）、snapshot 3 文件重叠需合并 |

### 3.4 filesystem-core（27 文件，~400+ cases）

| 模块/子域 | 测试文件 | 覆盖状态 | 缺口/冗余 |
|-----------|---------|---------|----------|
| entrypoint/smoke | `smoke.test.ts` | ✅ 良好 | — |
| artifacts | `artifacts.test.ts`, `prepared-artifacts.test.ts` | ✅ 良好 | — |
| evidence | `evidence-emitters-filesystem.test.ts` | ⚠️ 薄 | 仅 2 tests |
| leaf RPC path | `leaf-rpc-path-law.test.ts` | ✅ 良好 | — |
| mounts | `mounts.test.ts` | ✅ 良好 | — |
| namespace | `namespace.test.ts` | ✅ 良好 | — |
| promotion | `promotion.test.ts` | ✅ 良好 | — |
| refs | `refs.test.ts` | ✅ 良好 | — |
| session file store | `session-file-store.test.ts` | ✅ 良好 | D1+R2 dual-write 已测试 |
| backends | `backends/memory.test.ts`, `backends/reference.test.ts` | ✅ 优良 | F05 parity 显式测试是一个好实践 |
| storage/placement | `storage/placement.test.ts`, `storage/calibration.test.ts`, `storage/mime-gate.test.ts`, `storage/taxonomy.test.ts`, `storage/checkpoint-candidate.test.ts` | ✅ 良好 | — |
| storage/refs | `storage/refs.test.ts` | ⚠️ 薄重叠 | 与 `refs.test.ts` 有概念重叠但测试不同抽象层 |
| storage/keys | `storage/keys.test.ts` | ✅ 良好 | — |
| storage/adapters | `storage/adapters/d1-adapter.test.ts`, `storage/adapters/do-storage-adapter.test.ts`, `storage/adapters/errors.test.ts`, `storage/adapters/kv-adapter.test.ts`, `storage/adapters/r2-adapter.test.ts` | ✅ 优良 | 4 adapter + 1 error hierarchy，架构清晰 |
| storage/integration | `storage/integration/checkpoint-archive-contract.test.ts`, `storage/integration/placement-evidence-revisit.test.ts`, `storage/integration/scoped-io-alignment.test.ts` | ✅ 优良 | cross-package contract 验证恰到好处 |
| **filesystem-core 缺口总计** | | | 1 个薄覆盖（evidence-emitters）、1 个概念重叠（storage/refs vs refs）|

### 3.5 orchestrator-auth（4 文件，~100+ cases）

| 模块/子域 | 测试文件 | 覆盖状态 | 缺口/冗余 |
|-----------|---------|---------|----------|
| service | `service.test.ts` | ✅ 优良 | 全面覆盖: register/login/refresh/me/WeChat/API key/audit |
| bootstrap hardening | `bootstrap-hardening.test.ts` | ✅ 良好 | 并发压力测试、refresh-chain 风暴测试 |
| kid rotation | `kid-rotation.test.ts` | ✅ 良好 | — |
| public surface | `public-surface.test.ts` | ✅ 良好 | — |
| **fixture duplication** | `InMemoryAuthRepository` | ⚠️ 冗余 | service.test.ts 和 bootstrap-hardening.test.ts 中重复定义 |
| **orchestrator-auth 缺口总计** | | | 1 个 fixture 重复 / 无测试缺口 |

### 3.6 orchestrator-core（33 文件，~600+ cases）

| 模块/子域 | 测试文件 | 覆盖状态 | 缺口/冗余 |
|-----------|---------|---------|----------|
| smoke + auth | `smoke.test.ts`, `auth.test.ts`, `kid-rotation.test.ts` | ✅ 良好 | smoke 测试体积过大(456 行)，建议拆分 catalog 测试 |
| binding presence | `binding-presence.test.ts` | ⚠️ 非传统 | 配置契约测试，reads wrangler.jsonc，有独特价值 |
| chat lifecycle | `chat-lifecycle-route.test.ts`, `user-do-chat-lifecycle.test.ts` | ✅ 良好 | route + DO 分层 |
| checkpoint | `checkpoint-diff-projector.test.ts`, `checkpoint-restore-plane.test.ts` | ✅ 良好 | — |
| confirmation | `confirmation-control-plane.test.ts`, `confirmation-dual-write.test.ts`, `confirmation-route.test.ts` | ✅ 优良 | plane + runtime + route 三层金字塔 |
| context proxy | `context-route.test.ts` | ✅ 良好 | — |
| debug | `debug-routes.test.ts` | ✅ 良好 | — |
| elicitation | `elicitation-answer-route.test.ts` | ✅ 良好 | — |
| files proxy | `files-route.test.ts` | ✅ 良好 | — |
| me/ routes | `me-conversations-route.test.ts`, `me-devices-route.test.ts`, `me-sessions-route.test.ts`, `me-team-route.test.ts`, `me-teams-route.test.ts` | ✅ 良好 | cursor pagination 测试已在 conversations 中覆盖 |
| messages | `messages-route.test.ts` | ✅ 良好 | — |
| migrations | `migrations-schema-freeze.test.ts` | ✅ 优良 | 全量 DDL 冻结，一处失败即阻止 schema 回退 |
| models | `models-route.test.ts`, `session-model-route.test.ts` | ✅ 良好 | — |
| observability | `observability-runtime.test.ts` | ⚠️ 薄 | 仅 3 个测试覆盖复杂的 audit 管线 |
| parity bridge | `parity-bridge.test.ts` | ✅ 良好 | — |
| permission decision | `permission-decision-route.test.ts` | ✅ 良好 | — |
| policy | `policy-permission-mode-route.test.ts` | ✅ 良好 | — |
| todo | `todo-control-plane.test.ts`, `todo-route.test.ts` | ✅ 良好 | plane + route 分层 |
| usage | `usage-strict-snapshot.test.ts` | ✅ 良好 | — |
| workspace | `workspace-control-plane.test.ts` | ✅ 良好 | — |
| user-do (核心) | `user-do.test.ts` | 🔴 膨胀 | 1374+ 行、覆盖 15+ 关注点，项目中最庞大的单测试文件 |
| **orchestrator-core 缺口总计** | | | 2 个膨胀（smoke + user-do）、1 个薄覆盖（observability） |

---

## 4. Test placement analysis：worker-内部 vs package-e2e 分界标准

> 本节定义测试应当回归 worker 内部或保留在 package-e2e 的分界标准。

### 4.1 归属判定矩阵

| 测试类型 | 应属于 | 理由 |
|---------|--------|------|
| 单 worker 内部函数的单元测试 | worker test/ | 不涉及跨 worker 通信 |
| 单 worker 内多模块集成（如 registry→planner→executor） | worker test/integration/ | 虽然集成多模块，但仍在同一 worker 内 |
| 单 worker HTTP fetch handler 的输入/输出验证 | worker test/ | 这是 worker 自身的契约测试，不应当依赖 live deploy |
| 单 worker 的 probe shape（/health, /) 验证 | worker test/ | smoke test 应在 worker 内部完成 |
| 通过 service binding RPC 调用另一个 worker | package-e2e | 这是真正的跨 worker 集成 |
| 通过 HTTP facade 的公开端点（orchestrator-core 的 /sessions、/auth 等） | package-e2e | orchestrator-core 是公开入口，其 API 面的正确性需在 live deploy 中验证 |
| WebSocket 握手、attach、supersede 交互 | package-e2e | WebSocket 无法在 `worker.fetch()` mock 中真实测试 |
| 跨三个以上 worker 的全管线测试（如 LLM 推理→filesystem→D1） | package-e2e | 多服务交互无法在单 worker 测试中模拟 |

### 4.2 当前 package-e2e 归属重新判定

| e2e 文件 | 当前归属 | 正确归属 | 行动 |
|---------|---------|---------|------|
| `bash-core/01-preview-probe` | package-e2e | `workers/bash-core/test/` | → 删除（worker smoke 已覆盖） |
| `bash-core/02-capability-call-route` | package-e2e | `workers/bash-core/test/` | → 删除（worker smoke 已覆盖） |
| `bash-core/03-capability-cancel-route` | package-e2e | `workers/bash-core/test/` | → 删除（worker smoke 已覆盖） |
| `bash-core/04-capability-sampling` | package-e2e | `workers/bash-core/test/` | → 迁移 |
| `bash-core/05-capability-error-envelopes` | package-e2e | `workers/bash-core/test/` | → 迁移 |
| `bash-core/06-capability-malformed-body` | package-e2e | `workers/bash-core/test/` | → 迁移 |
| `agent-core/01-preview-probe` | package-e2e | `workers/agent-core/test/` | → 删除（worker smoke 已覆盖） |
| `context-core/01-preview-probe` | package-e2e | `workers/context-core/test/` | → 删除（worker smoke 已覆盖） |
| `context-core/02-library-worker-posture` | package-e2e | `workers/context-core/test/` | → 迁移 |
| `filesystem-core/01-preview-probe` | package-e2e | `workers/filesystem-core/test/` | → 删除（worker smoke 已覆盖） |
| `filesystem-core/02-library-worker-posture` | package-e2e | `workers/filesystem-core/test/` | → 迁移 |
| `orchestrator-auth/01-probe` | package-e2e | `workers/orchestrator-auth/test/` | → 迁移（或保留为 auth canary） |
| `orchestrator-core/01-preview-probe` | package-e2e | package-e2e ✅ | 保留（这是公开 facade 的 health check） |
| `orchestrator-core/02-session-start` | package-e2e | package-e2e ✅ | 保留（auth → orchestrator-core → agent-core cross-worker） |
| `orchestrator-core/03-ws-attach` | package-e2e | package-e2e ✅ | 保留（WS attach/supersede 交互） |
| `orchestrator-core/04-reconnect` | package-e2e | package-e2e ✅ | 保留（WS reconnect + error taxonomy） |
| `orchestrator-core/05-verify-status-timeline` | package-e2e | package-e2e ✅ | 保留（facade 全 surface 测试） |
| `orchestrator-core/06-auth-negative` | package-e2e | package-e2e ✅ | 保留（live deploy JWT rejection） |
| `orchestrator-core/07-legacy-agent-retirement` | package-e2e（错误目录） | `workers/agent-core/test/` | → 迁移至 agent-core 或并入其 smoke-test |
| `orchestrator-core/08-worker-health` | package-e2e | package-e2e ✅ | 保留（cross-worker 聚合健康检查） |
| `orchestrator-core/09-api-key-smoke` | package-e2e | package-e2e ✅ | 保留（加 env guard 标记风险） |
| `orchestrator-core/10-files-smoke` | package-e2e | package-e2e ✅ | 保留（orchestrator→filesystem→R2 cross-worker） |
| `orchestrator-core/11-rh5-models-image-reasoning` | package-e2e | package-e2e ✅ | 保留（最完整的 4 层跨 worker e2e 测试） |

---

## 5. 系统测试缺口与补强建议

> 以下识别当前测试集中不存在但应根据代码结构补强的测试项。

### 5.1 高优先级缺口

#### G1. 跨 worker hook 集成 e2e 测试（⛔ 完全缺失）

- **描述**: 当前没有任何 e2e 测试覆盖 "session start → hook worker 被调用 → hook 返回 block/continue → session 继续或终止" 的完整流程。`agent-core/test/hooks/integration/` 中的测试全部使用 `LocalTsRuntime` 或 `FakeServiceBindingRuntime`，从未真正跨 worker 调用。
- **影响**: hook 系统的最高价值场景——通过外部 worker 拦截和修改 agent 行为——在生产中完全无测。
- **建议**: 在 `test/package-e2e/orchestrator-core/` 中新增 `12-hook-pretool-block.test.mjs`，测试：
  - 部署一个 hook worker (可复用 `test/package-e2e/support/fake-hook-worker.ts`)
  - Session start → tool call → hook worker 拦截 block → session stream 中出现 `hook.broadcast` 且 tool 未执行
  - non-matching tool → hook worker continue → tool 正常执行

#### G2. Compaction 管线 e2e 测试（⛔ 完全缺失）

- **描述**: context-core 的 compaction 全生命周期（arm → prepare → commit → done）在当前的所有测试中均使用 fake LLM provider 和 fake DO storage。没有 e2e 测试验证 "(1) 真实 LLM 产出压缩摘要 → (2) 摘要写入 R2 → (3) DO storage 版本更新 → (4) 下一个 turn 使用压缩后的上下文" 这一完整链路。
- **影响**: compaction 是系统成本控制的关键通道，若真实 LLM 产出的摘要与 fake provider 的行为不一致（如 token 计数差异导致 budget 溢出），只能在生产中发现。
- **建议**: 在 `test/package-e2e/orchestrator-core/` 中新增 `13-compact-pipeline.test.mjs`，测试：
  - 多轮 session 积累足够 context → 自动触发 compaction
  - 验证 compaction 后的 context 大小 < compaction 前
  - 验证 compaction 后 agent 仍能正确回答之前轮次的问题（context continuity）

#### G3. Checkpoint archive/restore e2e 测试（⛔ 完全缺失）

- **描述**: `checkpoint-restore-plane.test.ts` 和 `checkpoint-diff-projector.test.ts` 使用 in-memory sqlite 测试了 plane 层。但没有 e2e 测试验证 "(1) 真实 session 中产生 checkpoint → (2) checkpoint archive 写入 R2 → (3) 在真实环境中 restore checkpoint → (4) workspace 文件恢复到 checkpoint 时的状态"。
- **影响**: checkpoint 的跨 worker 存储拓扑（orchestrator-core → filesystem-core → R2/DO）涉及 3 个 worker 的协调，任何一层有行为差异都会导致 restore 失败。
- **建议**: 在 `test/package-e2e/orchestrator-core/` 中新增 `14-checkpoint-archive-restore.test.mjs`。

### 5.2 中优先级缺口

#### G4. agent-core kernel runner 缺少 error recovery 专项测试

- **描述**: kernel runner 在 `runner.test.ts` 中有基本覆盖，但所有测试均为 happy-path（exception: cancel/timeout）。没有测试 cover "LLM 调用在 runner 中失败后该怎么恢复"、"tool 返回 malformed 结果后该怎么恢复"、"compact 失败后 runner 如何 fallback"。
- **建议**: 在 `agent-core/test/kernel/` 中新增 `runner-error-recovery.test.ts`。

#### G5. bash-core HTTP 面测试补全

- **描述**: 如 R3 所述，bash-core worker 内部的 HTTP 错误分类（error-envelopes）和输入验证（malformed-body）测试完全缺失。
- **建议**: 新增 `workers/bash-core/test/http-input-validation.test.ts` 和 `workers/bash-core/test/http-error-taxonomy.test.ts`（或合并为一个文件）。

#### G6. filesystem-core evidence-emitters 测试过薄

- **描述**: `evidence-emitters-filesystem.test.ts` 仅 2 tests，测试了 `buildArtifactEvidence` 的 schema 对齐。但 evidence emitter 在 storage layer 的全管线（placement log → evidence → calibration → recommendation）中，filesystem-core 侧的证据发射在涉及 D1、R2、DO 的真实交互时未有覆盖。
- **建议**: 扩充 `evidence-emitters-filesystem.test.ts`，至少增加 4 个测试覆盖 writes/reads/deletes 的证据发射。

#### G7. orchestrator-core observability-runtime 测试过于单薄

- **描述**: `observability-runtime.test.ts` 仅有 3 tests: device revoke audit、replay_lost detection、system.error emission。而 observability 管线涉及 audit log writing、trace event 记录、session timeline building、error classification 等多维度。
- **建议**: 拆分和扩充 `observability-runtime.test.ts`，覆盖 error classification、trace event→audit body mapping、session timeline 在异常场景下的行为。

#### G8. agent-core scenario runner 与真实 DO 集成

- **描述**: `eval/scenario.test.ts` 测试了 ScenarioRunner 的 DSL（send/expect/checkpoint/resume），但仅使用纯 mock session。从不与真实 DO 交互运行。
- **建议**: 在 `eval/integration/` 中新增 `scenario-do-integration.test.ts`，用真实 `NanoSessionDO` 运行一个 mini scenario。

### 5.3 低优先级缺口

#### G9. orchestrator-auth WeChat login 全流程 e2e 测试

- **描述**: `service.test.ts` 测试了 WeChat identity bootstrap 和 profile decryption 的单元逻辑。但没有 live e2e 测试真实 WeChat OAuth 回调 → auth worker → orchestrator-core 的全流程。
- **建议**: 低优先级（依赖真实 WeChat 测试账号）。

#### G10. agent-core quota repository 计算逻辑测试

- **描述**: `quota/repository.test.ts` 测试了 CRUD 操作，但未验证 quota 扣减、余额归零后的 gate 行为、或超限后的 rejection。
- **建议**: 补充 quota 计算逻辑的测试（余额递减、零余额拒绝、并发扣减）。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**: `测试架构骨干成立, 但 package-e2e 归属混乱（56.5% 误放）和 7 处冗余对是明确缺陷。HPX1 阶段执行本文中的清理 (R1-R8) 和补强 (G1-G10) 后, 测试线的可信度将显著提升。`

- **结论等级**: `changes-requested — 需在 HPX1 阶段执行 §3 清理和 §5 补强后重新审阅`

- **关闭前必须完成的 blocker**:
  1. R1: 清理 `test/package-e2e/` 中 12 个不应属于 e2e 的测试文件（6 个删除 + 6 个迁移至 worker 内部）
  2. R3: 补全 `bash-core` worker 内部的 HTTP 输入验证和错误分类测试
  3. G1: 新增至少 1 个跨 worker hook 集成 e2e 测试

- **可以后续跟进的 non-blocking follow-up**:
  1. R2 中 7 个冗余对的逐步合并/删除（可在 HPX1 中逐步执行）
  2. R4: agent-core `orchestration.test.ts` 拆分（可在 HPX1 后续完成）
  3. G2-G10: 各级别的缺口补强（按优先级分阶段执行）
  4. R6: `09-api-key-smoke.test.mjs` 的风险标记和长期改造
  5. R8: `InMemoryAuthRepository` 测试 fixture 提取

- **建议的二次审查方式**: `independent reviewer — HPX1 完成后由另一位 reviewer 验证清理和补强结果`

- **实现者回应入口**: `请按 docs/templates/code-review-respond.md 在本文档 §7 append 回应，不要改写 §0–§6。`

---

> 本文档由 DeepSeek v4-pro 独立撰写，未参考 Kimi、GLM、GPT 或 Opus 的同主题分析。所有判断基于对 240 个测试文件的逐文件内容和 6 个 worker 的完整源码结构的独立分析。
