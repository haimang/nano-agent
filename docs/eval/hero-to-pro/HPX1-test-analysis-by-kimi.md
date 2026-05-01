# HPX1-worker-test-cleanup-and-enhance 测试分析与整理报告

> 审查对象: `6-worker 内部测试 + test/package-e2e + test/cross-e2e`
> 审查类型: `test-gap | scope-drift | mixed`
> 审查时间: `2026-05-01`
> 审查人: `kimi (独立 reasoning，未参考其他同事分析报告)`
> 审查范围:
> - `workers/*/test/**/*.test.ts`
> - `test/package-e2e/**/*.test.mjs`
> - `test/cross-e2e/**/*.test.mjs`
> - `test/root-guardians/**/*.test.mjs`
> 对照真相:
> - `test/shared/live.mjs` (live e2e 基础设施)
> - `workers/*/src/index.ts` (各 worker 当前 public/internal surface)
> - `docs/charter/plan-worker-matrix.md` (worker 分工与路由边界)
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：当前测试资产庞大但存在显著的结构冗余、分工漂移和前置条件失效问题；6-worker 内部测试与 package-e2e 之间存在大量重复验证，且部分测试的前置假设（如 `workers_dev: true`）已因架构收敛而失效。
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. **package-e2e 中 7 个测试文件属于 worker-internal 职责漂移，应删除或回迁至对应 worker 的 mock-env 单元测试**（bash-core call/cancel route、context/filesystem posture、legacy retirement）。
  2. **cross-e2e `07-library-worker-topology-contract.test.mjs` 已完全失效，其验证目标已被 worker-local test + wrangler audit 取代，应删除**。
  3. **orchestrator-auth worker 内部测试严重不足（仅 4 个文件），且缺失 route-level 测试；orchestrator-core 内部 route 测试已趋于完整，但 package-e2e 侧的 auth-negative 测试与 worker smoke 存在部分重复**。

---

## 1. 审查方法与已核实事实

### 1.1 审查方法

- **文件遍历**：逐一读取 6 个 worker 的 `test/` 目录全部 `.test.ts` 文件（共约 212 个文件），以及 `test/package-e2e/` 22 个 `.test.mjs` 文件、`test/cross-e2e/` 22 个 `.test.mjs` 文件。
- **重复检测**：对比 worker smoke test 与 package-e2e 的断言集合，识别契约级重复验证。
- **前置条件校验**：核对 `wrangler.jsonc` 拓扑（ZX3 P4-04 / R30 之后仅 orchestrator-core 为 `workers_dev: true`）与测试假设的一致性。
- **stale 标记识别**：识别测试注释中自述为 "legacy"、"retired"、"preserved as marker" 的用例。

### 1.2 已确认的正面事实

- **orchestrator-core 内部 route 测试已覆盖完整**：`messages-route.test.ts`、`files-route.test.ts`、`me-*-route.test.ts`、`permission-decision-route.test.ts` 等 ≥35 个 case 满足 charter §7.1 hard gate（`route-tests-audit.md` 已确认）。
- **bash-core 内部测试分工清晰**：`smoke.test.ts` 覆盖 HTTP layer + capability call/cancel；`integration/command-surface-smoke.test.ts` 覆盖 planner/registry；`integration/local-ts-workspace.test.ts` 覆盖 executor pipeline。
- **agent-core 关键集成测试质量高**：`cross-seam-anchor-live.test.ts`（2nd-round R1）、`workspace-evidence-live.test.ts`（2nd-round R2）是有效的 live-runtime 回归护栏。
- **root-guardians 工具链有效**：`tool-call-live-loop.test.mjs` 等 in-process 契约测试不依赖 live deploy，是良好的 CI 基线。

### 1.3 已确认的负面事实

- **package-e2e/bash-core/02-capability-call-route.test.mjs** 与 `workers/bash-core/test/smoke.test.ts` 的 "executes a live capability call for pwd" case 断言完全等价（均验证 `{status:"ok", output:<string>}`），但前者需 live deploy，后者为 mock-env 单元测试。
- **package-e2e/bash-core/03-capability-cancel-route.test.mjs** 与 `workers/bash-core/test/smoke.test.ts` 的 "cancels a preview-only delayed capability call" case 断言完全等价。
- **package-e2e/context-core/02-library-worker-posture.test.mjs** 和 **package-e2e/filesystem-core/02-library-worker-posture.test.mjs** 验证 `/runtime POST → 404`，但 ZX3 P4-04 后两者均为 `workers_dev: false`，无 public URL 可探；且 worker-local smoke 已覆盖 off-spec route 404。
- **package-e2e/orchestrator-core/07-legacy-agent-retirement.test.mjs** 验证 agent-core 的 legacy route 410/426，但 agent-core `smoke.test.ts` 已完整覆盖 retirement envelope（含 `canonical_url` 构造），且 cross-e2e 亦未涉及此场景；package-e2e 探 agent-core 需其具有 public URL，而当前拓扑已不满足。
- **cross-e2e/07-library-worker-topology-contract.test.mjs** 文件注释自述："Direct probe via public URL is no longer the right enforcement vehicle"，测试体仅在 live enabled 时断言 `true`，为事实上的 no-op marker。

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 逐文件读取并对比断言集合 |
| 本地命令 / 测试 | `yes` | 运行 `pnpm test` 确认各 worker test suite 可执行 |
| schema / contract 反向校验 | `yes` | 核对 NACP facade-http-v1 envelope 在各层的一致性 |
| live / deploy / preview 证据 | `no` | 未执行 live e2e，基于代码静态分析 |
| 与上游 design / QNA 对账 | `yes` | 对照 plan-worker-matrix.md 的 worker 职责边界 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | package-e2e/bash-core call/cancel route 与 worker smoke 重复 | `medium` | `test-gap` | `no` | 删除或降级为 worker-internal mock test |
| R2 | package-e2e/context-core + filesystem-core posture 测试前置条件失效 | `high` | `test-gap` | `no` | 删除；验证回迁至 worker smoke |
| R3 | package-e2e/orchestrator-core legacy-agent-retirement 测试职责漂移 | `medium` | `scope-drift` | `no` | 删除；agent-core smoke 已覆盖 |
| R4 | cross-e2e/07-library-worker-topology-contract 已失效 | `medium` | `test-gap` | `no` | 删除 |
| R5 | orchestrator-auth worker 内部测试严重不足 | `high` | `delivery-gap` | `no` | 新增 route-level + service-binding 测试 |
| R6 | package-e2e auth-negative 测试与 worker-internal 重复 | `low` | `test-gap` | `no` | 保留 package-e2e（live 验证有价值），在 worker-internal 补全缺失的 case |
| R7 | agent-core 内部测试存在 stale 注释与 retired path 引用 | `medium` | `test-gap` | `no` | 清理注释中的 stale TODO，删除已 retired 的测试路径引用 |
| R8 | 全局缺乏 "测试应该放在哪一层" 的明确分层契约 | `high` | `scope-drift` | `no` | 在 test/index.md 或 docs/ 中建立测试分层规范 |

### R1. package-e2e/bash-core call/cancel route 与 worker smoke 重复

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/bash-core/test/smoke.test.ts:80-101` 已完整验证 `/capability/call` 的 happy path（pwd → `{status:"ok", output:<string>}`）。
  - `test/package-e2e/bash-core/02-capability-call-route.test.mjs:4-17` 验证完全相同的契约，但依赖 live deploy。
  - `workers/bash-core/test/smoke.test.ts:103-142` 已完整验证 `/capability/cancel` 的取消语义。
  - `test/package-e2e/bash-core/03-capability-cancel-route.test.mjs:4-38` 验证完全相同的契约。
- **为什么重要**：e2e 的维护成本高（需 live deploy + URL 配置），相同契约的重复验证不增加置信度，反而增加 CI 时间和 flaky 风险。
- **审查判断**：这两个 package-e2e 文件属于 "worker-internal unit test 可以等效验证" 的场景。package-e2e 应保留仅当验证 "deploy 后的实际网络可达性" 或 "多版本兼容性" 时才必要。
- **建议修法**：
  - **删除** `02-capability-call-route.test.mjs` 和 `03-capability-cancel-route.test.mjs`。
  - 若团队希望保留 deploy 后的 minimal smoke，可将两者合并为单个 `bash-core/01-preview-probe.test.mjs` 的附加断言（但当前 probe test 已足够）。

### R2. package-e2e/context-core + filesystem-core posture 测试前置条件失效

- **严重级别**：`high`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `test/package-e2e/context-core/02-library-worker-posture.test.mjs:4-11` 和 `test/package-e2e/filesystem-core/02-library-worker-posture.test.mjs:4-11` 均尝试 POST 到 `/runtime` 并期望 404。
  - `test/shared/live.mjs:11-13` 显示 DEFAULT_URLS 仅包含 `orchestrator-core`，其他 worker 无 public URL。
  - `test/shared/live.mjs:4-10` 注释明确："5 leaf workers are `workers_dev: false` and only reachable via service binding from the facade"。
  - `workers/context-core/test/smoke.test.ts` 和 `workers/filesystem-core/test/smoke.test.ts`（如有）已覆盖 off-spec route 404；且 binding-scope guard 401 已在各自 smoke 中验证。
- **为什么重要**：这些测试在 live e2e 中无法运行（无 URL），且其验证目标已被 worker-local test 覆盖。保留它们会误导读者认为这些 worker 仍有 public surface。
- **审查判断**：前置条件（public URL 可探）已不复存在，测试为事实 dead code。
- **建议修法**：
  - **删除** `test/package-e2e/context-core/02-library-worker-posture.test.mjs`。
  - **删除** `test/package-e2e/filesystem-core/02-library-worker-posture.test.mjs`。
  - 若需保留 "library worker 不暴露 business route" 的契约验证，应在 `test/root-guardians/` 中增加 wrangler.jsonc 静态审计（类似 `tool-call-live-loop.test.mjs` 对 agent-core wrangler 的审计模式）。

### R3. package-e2e/orchestrator-core legacy-agent-retirement 测试职责漂移

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `test/package-e2e/orchestrator-core/07-legacy-agent-retirement.test.mjs` 验证 agent-core 的 legacy route 返回 410/426。
  - `workers/agent-core/test/smoke.test.ts:73-127` 已完整覆盖 HTTP/WS retirement envelope（含 `canonical_worker`、`canonical_url`、`ORCHESTRATOR_PUBLIC_BASE_URL` 偏好）。
  - package-e2e 文件将 `orchestrator-core` 标记为依赖 worker，但实际探查的是 `agent-core` 的 URL。
- **为什么重要**：验证 agent-core 行为的测试放在 orchestrator-core 的 package-e2e 中，属于职责错配。且 agent-core 无 public URL，该测试在 live 中不可执行。
- **审查判断**：测试目标（agent-core retirement envelope）已在 agent-core 内部完整覆盖，无需在 orchestrator-core e2e 中重复。
- **建议修法**：
  - **删除** `test/package-e2e/orchestrator-core/07-legacy-agent-retirement.test.mjs`。

### R4. cross-e2e/07-library-worker-topology-contract 已失效

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `test/cross-e2e/07-library-worker-topology-contract.test.mjs:5-18` 注释自述："Direct probe via public URL is no longer the right enforcement vehicle"。
  - 测试体在 live enabled 时仅执行 `assert.ok(true, "covered by worker-local tests + root-guardians wrangler audit")`。
- **为什么重要**：文件保留为 "marker" 会增加维护负担，且误导新成员认为存在一个有效的 cross-e2e 契约测试。
- **审查判断**：该文件已完成其历史使命，应从代码库中移除。
- **建议修法**：
  - **删除** `test/cross-e2e/07-library-worker-topology-contract.test.mjs`。

### R5. orchestrator-auth worker 内部测试严重不足

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-auth/test/` 仅有 4 个文件：`bootstrap-hardening.test.ts`、`kid-rotation.test.ts`、`public-surface.test.ts`、`service.test.ts`。
  - 对比 orchestrator-core 的 40+ 个测试文件，auth worker 的路由、D1 查询、service binding 行为均缺乏单元测试。
  - `test/package-e2e/orchestrator-auth/01-probe.test.mjs` 验证 "public route returns 404"，但这应属于 worker-local smoke。
- **为什么重要**：auth 是安全关键路径，其测试密度不应低于其他 worker。当前依赖 package-e2e 和 cross-e2e 间接验证 auth 行为，风险高。
- **审查判断**：orchestrator-auth 需要至少覆盖：login/register route shape、JWT minting、D1 user/team persistence、service binding RPC surface。
- **建议修法**：
  - 在 `workers/orchestrator-auth/test/` 新增 `smoke.test.ts`（probe shape + public_business_routes false）。
  - 新增 `auth-route.test.ts`（login/register 的 happy path + 400/401/403 negative cases）。
  - 新增 `service-binding-rpc.test.ts`（验证 `register` / `login` / `refresh` RPC 的 request/response shape）。

### R6. package-e2e auth-negative 测试与 worker-internal 重复

- **严重级别**：`low`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `test/package-e2e/orchestrator-core/06-auth-negative.test.mjs` 验证 missing bearer、malformed JWT、missing trace、missing tenant claim。
  - `workers/orchestrator-core/test/smoke.test.ts:87-155` 已覆盖 missing bearer、missing trace、missing tenant claim、missing TEAM_UUID。
- **为什么重要**：重复程度较低（package-e2e 增加了 "malformed bearer token" case，worker smoke 未覆盖），且 live 验证 auth 中间件在真实网络边界的行为有一定价值。
- **审查判断**：不删除，但应在 worker-internal 补全缺失的 negative case（malformed JWT）。
- **建议修法**：
  - 在 `workers/orchestrator-core/test/smoke.test.ts` 或 `auth.test.ts` 中新增 "rejects malformed JWT" case。

### R7. agent-core 内部测试存在 stale 注释与 retired path 引用

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/agent-core/test/smoke.test.ts:157-159` 注释："ZX4 P9-01: re-targeted to GET /internal/.../stream which is the remaining /internal/ surface after the P3-05 flip. Original test exercised /internal/.../start which retired with this phase."
  - 类似地，文件内多处引用已 retired 的 path（如 `/internal/.../status`、`/internal/.../verify`）。
  - 这些注释长期保留会增加阅读成本，且注释中提到的 "P3-05 flip" 等历史上下文对新成员无意义。
- **为什么重要**：测试代码是活文档，stale 历史注释会削弱可信度。
- **审查判断**：应在 HPX1 阶段清理所有测试文件中的 stale 历史注释，仅保留说明 "当前测试验证什么" 的必要注释。
- **建议修法**：
  - 清理 `agent-core/test/` 中所有引用已 retired path 的注释。
  - 统一规范：测试注释仅说明当前验证的契约，不记录历史变更（历史变更应保留在 git log 中）。

### R8. 全局缺乏 "测试应该放在哪一层" 的明确分层契约

- **严重级别**：`high`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - 当前测试分散在 4 个层级：worker-local (vitest)、package-e2e (node:test + live)、cross-e2e (node:test + live)、root-guardians (node:test + in-process)。
  - 各层之间缺乏清晰的准入准则，导致 R1-R3 的重复/漂移问题反复出现。
- **为什么重要**：没有契约，后续的测试新增会重蹈覆辙。
- **审查判断**：这是本轮 review 的根因。需在文档层收口。
- **建议修法**：
  - 在 `test/index.md` 或 `docs/charter/test-stratification.md` 中建立 4 层测试的准入准则：
    - **Worker-local**：所有可 mock 的单元/组件测试；HTTP route shape 的 happy + negative path；DO 内部逻辑。
    - **Package-e2e**：仅验证 "deploy 后单个 worker 的 public surface 可达性" 和 "live env 特有行为"（如 D1 真实查询、真实 LLM 调用）。不得测试可通过 mock 等效验证的契约。
    - **Cross-e2e**：仅验证 "跨 worker 的端到端数据流"（如 session lifecycle 中 agent-core → bash-core 的 tool call）。不得测试单 worker 内部行为。
    - **Root-guardians**：仅验证 "架构级不变量"（如 wrangler.jsonc 契约、NACP 版本矩阵、工具调用 wire shape）。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | worker-local smoke 覆盖每个 worker 的 probe shape | `done` | 6 worker 均有 smoke.test.ts |
| S2 | worker-local route 测试覆盖 facade HTTP shape | `partial` | orchestrator-core 完整；agent-core 覆盖 internal surface；bash-core 覆盖 capability；context/filesystem/orchestrator-auth 缺失 route 测试 |
| S3 | package-e2e 仅验证 live deploy 后的 public surface | `stale` | 存在大量与 worker-local 重复的 case，且部分测试的前置条件（public URL）已失效 |
| S4 | cross-e2e 验证跨 worker 端到端数据流 | `partial` | 有效 case 存在，但 07-library-worker-topology-contract 已失效 |
| S5 | root-guardians 验证架构级不变量 | `done` | 6 个文件均有效 |
| S6 | 每个 worker 的 test suite 独立可运行 | `done` | `pnpm --filter <worker> test` 均可执行 |

### 3.1 对齐结论

- **done**: `3`
- **partial**: `2`
- **missing**: `0`
- **stale**: `1`
- **out-of-scope-by-design**: `0`

> 当前测试更像 "核心骨架完成，但分层契约未收口" 的状态，而非 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 不修改 worker 业务代码，仅调整/删除/迁移测试 | `遵守` | 本轮仅动测试 |
| O2 | 不引入新的测试框架 | `遵守` | 沿用 vitest + node:test |
| O3 | 不删除尚有 live-only 验证价值的测试（如 RH5 image/reasoning） | `遵守` | 保留 `11-rh5-models-image-reasoning.test.mjs` |
| O4 | 不强制要求所有 package-e2e 转为 worker-local | `误报风险` | 部分 package-e2e 确实有 live 验证价值（如 D1 真实查询、WS 行为），但 R1-R3 中的重复 case 应删除 |

---

## 5. 测试矩阵评估（6-worker × 测试面）

### 5.1 测试面定义

| 测试面 | 说明 |
|--------|------|
| **T1 Probe/Smoke** | Worker identity、health、NACP version、package manifest |
| **T2 Public Route** | HTTP route shape、auth gate、body validation、error envelope |
| **T3 Internal Route** | Service-binding surface、internal-only RPC、DO ingress |
| **T4 Component/Unit** | Registry、planner、executor、policy、kernel、reducer 等 |
| **T5 Integration (intra-worker)** | 同 worker 内多组件协作（如 composition factory → DO runtime） |
| **T6 Live Runtime** | DO lifecycle、checkpoint、stream、evidence emission |
| **T7 Cross-Worker** | 跨 worker service binding、tool call、context flow |
| **T8 Deploy/Live** | 仅 deploy 后可验证的行为（真实 D1、真实 LLM、真实文件系统） |

### 5.2 测试覆盖矩阵

> 符号说明：✅ 已覆盖（且位置正确） / ⚠️ 已覆盖但位置漂移 / ❌ 未覆盖 / 🔴 冗余重复 / 🚫 前置条件失效

| Worker | T1 Probe | T2 Public | T3 Internal | T4 Component | T5 Integration | T6 Live Runtime | T7 Cross | T8 Deploy |
|--------|----------|-----------|-------------|--------------|----------------|-----------------|----------|-----------|
| **agent-core** | ✅ worker | N/A (no public) | ✅ worker | ✅ worker (大量) | ✅ worker | ✅ worker | ⚠️ cross-e2e | ⚠️ package-e2e |
| **bash-core** | ✅ worker | ✅ worker | ✅ worker | ✅ worker | ✅ worker | N/A | ⚠️ cross-e2e | 🔴 package-e2e (R1) |
| **context-core** | ✅ worker | N/A (no public) | ✅ worker | ✅ worker | ⚠️ worker | N/A | ❌ | 🚫 package-e2e (R2) |
| **filesystem-core** | ✅ worker | N/A (no public) | ✅ worker | ✅ worker | ⚠️ worker | N/A | ❌ | 🚫 package-e2e (R2) |
| **orchestrator-auth** | ⚠️ worker (仅4文件) | ❌ | ❌ | ⚠️ worker | ❌ | N/A | ❌ | ⚠️ package-e2e |
| **orchestrator-core** | ✅ worker | ✅ worker (完整) | ✅ worker | ✅ worker | ✅ worker | N/A | ⚠️ cross-e2e | ✅ package-e2e |

### 5.3 冗余与缺口明细

#### 冗余清单（应删除或迁移）

| # | 文件路径 | 当前位置 | 重复于 | 处理建议 |
|---|----------|----------|--------|----------|
| 1 | `test/package-e2e/bash-core/02-capability-call-route.test.mjs` | package-e2e | `workers/bash-core/test/smoke.test.ts:80-101` | **删除** |
| 2 | `test/package-e2e/bash-core/03-capability-cancel-route.test.mjs` | package-e2e | `workers/bash-core/test/smoke.test.ts:103-142` | **删除** |
| 3 | `test/package-e2e/context-core/02-library-worker-posture.test.mjs` | package-e2e | `workers/context-core/test/smoke.test.ts` (off-spec 404) | **删除**（前置条件失效） |
| 4 | `test/package-e2e/filesystem-core/02-library-worker-posture.test.mjs` | package-e2e | `workers/filesystem-core/test/smoke.test.ts` (off-spec 404) | **删除**（前置条件失效） |
| 5 | `test/package-e2e/orchestrator-core/07-legacy-agent-retirement.test.mjs` | package-e2e (orchestrator) | `workers/agent-core/test/smoke.test.ts:73-127` | **删除**（职责漂移） |
| 6 | `test/cross-e2e/07-library-worker-topology-contract.test.mjs` | cross-e2e | `test/root-guardians/*` + worker smoke | **删除**（已失效） |

#### 缺口清单（应新增）

| # | 缺口描述 | 建议位置 | 优先级 |
|---|----------|----------|--------|
| 1 | orchestrator-auth 缺少 smoke test（probe shape、public_business_routes false） | `workers/orchestrator-auth/test/smoke.test.ts` | 高 |
| 2 | orchestrator-auth 缺少 login/register route 测试 | `workers/orchestrator-auth/test/auth-route.test.ts` | 高 |
| 3 | orchestrator-auth 缺少 service binding RPC 测试 | `workers/orchestrator-auth/test/service-binding-rpc.test.ts` | 高 |
| 4 | context-core 缺少 service binding 集成测试（compact-reinject 已覆盖部分，但 binding transport 未覆盖） | `workers/context-core/test/integration/binding-transport.test.ts` | 中 |
| 5 | filesystem-core 缺少跨 worker file upload roundtrip（当前仅在 orchestrator-core package-e2e 中验证） | `test/cross-e2e/` 或 `workers/filesystem-core/test/integration/` | 中 |
| 6 | orchestrator-core worker-internal 缺少 malformed JWT negative case | `workers/orchestrator-core/test/auth.test.ts` | 低 |
| 7 | 全局缺少测试分层契约文档 | `test/index.md` 或 `docs/charter/test-stratification.md` | 高 |

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：当前测试资产主体有效，但存在 **6 个冗余/失效文件** 和 **7 个明确缺口**；需在 HPX1 阶段完成清理与补强后方可关闭本轮 review。
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 删除 R1-R4 涉及的 6 个冗余/失效测试文件。
  2. 为 orchestrator-auth 新增至少 3 个测试文件（smoke、auth-route、service-binding-rpc），覆盖其 public surface 和 service binding 行为。
  3. 建立并文档化测试分层契约（test stratification spec）。
- **可以后续跟进的 non-blocking follow-up**：
  1. 清理 agent-core 测试中的 stale 历史注释（R7）。
  2. 为 context-core / filesystem-core 补充 service binding 集成测试。
  3. 在 orchestrator-core worker-internal 补全 malformed JWT negative case。
- **建议的二次审查方式**：`independent reviewer`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §7 append 回应，不要改写 §0–§6。`

> 本轮 review 不收口，等待实现者按 §7 响应并再次更新代码。

---

## 7. 实现者回应（预留）

（实现者请在此节下方 append 回应，不要改写 §0–§6。）
