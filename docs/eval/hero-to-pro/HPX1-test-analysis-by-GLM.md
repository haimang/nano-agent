# Nano-Agent 代码审查模板

> 审查对象: `HPX1-worker-test-cleanup-and-enhance`
> 审查类型: `mixed` (code-review + docs-review + closure-review)
> 审查时间: `2026-05-01`
> 审查人: `GLM`
> 审查范围:
> - `workers/{bash-core,context-core,filesystem-core,orchestrator-auth,orchestrator-core,agent-core}/test/**`
> - `test/package-e2e/**`
> - `test/cross-e2e/**`
> - `test/root-guardians/**`
> - `packages/*/test/**`
> 对照真相:
> - 各 worker 设计文档与 charter 规范
> - NACP 协议矩阵 (B9 / Q16 / Q18 / Q23 等)
> - HP 系列增补设计文档
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：当前测试体系骨架完整、覆盖面广，但存在 **31 个零价值占位测试**、**3 个应迁移至 worker 内部的测试**、**6 个应删除或实现的空壳测试**，以及若干跨层重复与脆弱 mock 问题。
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`no` — 需要实施下述 R1-R8 修正后方可收口。
- **本轮最关键的 3 个判断**：
  1. **cross-e2e 15-21 共 31 个占位测试全部只断言 `status === 200`，提供零覆盖，必须要么实现要么删除。** (R1)
  2. **root-guardians/tool-call-live-loop 是纯粹的进程内单元测试，不属于 root-guardians 的跨切契约职责，应迁移至 `workers/agent-core/test/`。** (R2)
  3. **package-e2e 中 `context-core/02` 和 `filesystem-core/02` 测的是单 worker 内部路由拒绝逻辑，应回归到各自 worker 的内部测试。** (R3)

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - NACP 协议矩阵 (B9 §2, §3, §6; Q16; Q18; Q23)
  - HP5 confirmation spec, HP6 tool-cancel/todo spec, HP7 checkpoint/fork spec, HP8 heartbeat spec
  - PX capability inventory, F08 size routing spec
  - 各 worker wrangler.jsonc 配置
- **核查实现**：
  - 6 个 worker 的全部 test 目录 (约 115 个测试文件)
  - `test/package-e2e/` 全部 23 个测试文件
  - `test/cross-e2e/` 全部 22 个测试文件
  - `test/root-guardians/` 全部 6 个测试文件
  - `packages/nacp-session`, `packages/jwt-shared`, `packages/storage-topology` 的 test 目录 (约 35 个测试文件)
- **执行过的验证**：
  - 全文件阅读并标注每个 describe/it 块
  - 交叉对比 worker 内部测试与 package-e2e 测试的主题重叠
  - 比对 package-e2e 与 cross-e2e 的重复覆盖
  - 评估 mock 脆弱点、外部依赖、时序依赖
- **复用 / 对照的既有审查**：
  - 无 — 本分析为独立审查，未参考 Kimi、Deepseek 或 GPT 的报告。

### 1.1 已确认的正面事实

- 所有 6 个 worker 均有完整的单元测试套件，核心逻辑覆盖率良好
- package-e2e 为每个 worker 提供了真实的部署验证（probe、capability-call、auth-negative 等）
- cross-e2e 覆盖了关键的跨 worker 交互场景（session lifecycle、capability through agent、file cross-tenant deny、device revoke）
- root-guardians 提供了 NACP 协议矩阵、storage-topology 跨包契约、schema 向后兼容等跨切保护
- 各 worker 内部测试普遍包含安全边界测试（路径穿越、私网地址拒绝、授权升级检测）
- HP5 (confirmation)、HP6 (todo/cancel)、HP7 (checkpoint/fork) 的协议层测试使用了真实内存 SQLite + migration，覆盖了状态机和CHECK约束

### 1.2 已确认的负面事实

- cross-e2e 15-21 的 7 个文件共 31 个 it 块全部只断言 `response.status === 200`，零功能验证
- `07-library-worker-topology-contract.test.mjs` 唯一断言为 `assert.ok(true, "...")`，总是通过
- `root-guardians/tool-call-live-loop.test.mjs` 的 5 个测试全部是进程内单元测试（import + mock），非跨切契约
- orchestrator-core 约 14 个路由测试使用手写 SQL 字符串匹配的 D1 mock，任何 SQL 重构都可能导致隐性测试失败
- 多个测试依赖 `setTimeout` 等待（10ms-50ms），在 CI 压力下可能间歇性失败
- orchestrator-core 和 context-core 内部各自的 `adaptD1` 辅助函数在 6+ 个文件中重复
- bash-core 内部 FakeWorkspace fixture 在 4 个文件中近乎完全相同地重复

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐文件逐 it 块阅读 |
| 本地命令 / 测试 | no | 未运行测试套件，仅静态分析 |
| schema / contract 反向校验 | yes | NACP 协议矩阵、枚举冻结与测试断言交叉比对 |
| live / deploy / preview 证据 | no | 本轮仅静态代码审查 |
| 与上游 design / QNA 对账 | partial | 引用了 Q16/Q18/Q23/B9 标注，但未逐一对照设计文档全文 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | cross-e2e 15-21 共 31 个存根占位测试提供零覆盖 | critical | test-gap | yes | 实现或删除 |
| R2 | tool-call-live-loop 应迁移至 agent-core 内部测试 | high | scope-drift | no | 迁移至 workers/agent-core/test/ |
| R3 | context-core/02、filesystem-core/02 posture 测的是内部路由逻辑 | medium | scope-drift | no | 迁移至各 worker 内部测试 |
| R4 | orchestrator-core 路由测试使用脆弱的 SQL 字符串匹配 mock | high | correctness | no | 改用 adaptD1 内存 SQLite 或共享 mock 工厂 |
| R5 | 4+ 处 FakeWorkspace/makeWorkspace/adaptD1 代码重复 | medium | delivery-gap | no | 提取共享 test helpers |
| R6 | 多处 setTimeout 依赖的测试在 CI 下可能不稳定 | medium | platform-fitness | no | 改用 vi.useFakeTimers() 或加大超时倍数 |
| R7 | bash-core/error-code 不一致（execution-error vs handler-error） | medium | correctness | no | 确认并统一 |
| R8 | package-e2e/orchestrator-core/07 legacy 测试放在了错误的目录 | low | scope-drift | no | 移至 agent-core/ |
| R9 | cross-e2e/07 空操作拓扑契约测试 | high | test-gap | yes | 实现或删除 |
| R10 | bash-core/result.test.ts 和 search-rg-reality.test.ts 断言实现常量 | low | docs-gap | no | 标注为冻结守卫或改为行为断言 |
| R11 | nacp-session stream-event 仅 7/13 kind 有正向解析测试 | medium | test-gap | no | 补充缺失的 6 种 kind 测试 |
| R12 | orchestrator-core/user-do.test.ts 过长（1504行），应拆分 | low | delivery-gap | no | 拆分为 4-5 个主题文件 |
| R13 | package-e2e/orchestrator-core/08 worker-health 硬编码 6 个 worker 名称 | medium | correctness | no | 改为动态断言 |
| R14 | packages/storage-topology R2 F01 测试仅验证 1 MiB 而非边界 | low | test-gap | no | 补充接近 10 MiB 边界的测试 |

### R1. cross-e2e 15-21 共 31 个存根占位测试提供零覆盖

- **严重级别**：`critical`
- **类型**：`test-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `test/cross-e2e/15-hp2-model-switch.test.mjs` — 5 个 it，全部只断言 `response.status === 200`
  - `test/cross-e2e/16-hp3-context-machine.test.mjs` — 5 个 it，全部只断言 `response.status === 200`
  - `test/cross-e2e/17-hp4-lifecycle.test.mjs` — 6 个 it，全部只断言 `response.status === 200`
  - `test/cross-e2e/18-hp5-confirmation-roundtrip.test.mjs` — 4 个 it，全部只断言 `response.status === 200`
  - `test/cross-e2e/19-hp6-tool-workspace.test.mjs` — 6 个 it，全部只断言 `response.status === 200`
  - `test/cross-e2e/20-hp7-checkpoint-restore.test.mjs` — 6 个 it，全部只断言 `response.status === 200`
  - `test/cross-e2e/21-hp8-heartbeat-posture.test.mjs` — 4 个 it，全部只断言 `response.status === 200`
- **为什么重要**：这些文件位于 `cross-e2e/` 目录，给人一种"HP2-HP8 全有跨 worker e2e 测试"的错误印象。实际上这些测试对任何功能都不提供覆盖，如果有人依赖这些测试作为质量门禁，将会得到虚假的信心。
- **审查判断**：必须作为最高优先级处理。每个 HP 的注释中描述了应该测试什么（model switch、auto-compact、confirmation roundtrip、checkpoint restore 等），但这些断言完全没有实现。
- **建议修法**：为每个 HP 逐步实现真实测试。如果当前无法实现，应将文件改为 `.skip.mjs` 后缀或添加 `describe.skip` 标记，并在 CI 中添加独立检查确保不会长期遗留。

### R2. tool-call-live-loop 应迁移至 agent-core 内部测试

- **严重级别**：`high`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `test/root-guardians/tool-call-live-loop.test.mjs` 的 5 个测试全部通过 `import { createDefaultCompositionFactory }` 和 `import { NanoSessionDO }` 直接导入 worker 编译产物
  - 测试 (a) 通过读源码文件验证 wrangler.jsonc 的 service binding
  - 测试 (b)(c)(d) 实例化内部对象（CompositionFactory、NanoSessionDO、MockBashCoreBinding）
  - 测试 (e) 读源码文件验证字符串不存在
  - 所有测试都是进程内单元级测试，不涉及真实部署或跨 worker 交互
- **为什么重要**：root-guardians 应该守护跨切契约（协议矩阵、版本对齐、schema 兼容性），而非单个 worker 的内部组合逻辑。将 worker 内部测试放在 root-guardians 中会模糊层次边界。
- **审查判断**：应迁移至 `workers/agent-core/test/live-loop/` 或类似目录。
- **建议修法**：将 5 个测试迁移至 `workers/agent-core/test/`，同时在 root-guardians 中添加一个轻量级契约测试验证 wrangler.jsonc 的 service binding 声明与测试期望一致。

### R3. context-core/02、filesystem-core/02 posture 测的是内部路由逻辑

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `test/package-e2e/context-core/02-library-worker-posture.test.mjs` — 测 `POST /runtime → 404`，这是单个 worker 的路由层行为
  - `test/package-e2e/filesystem-core/02-library-worker-posture.test.mjs` — 同上
  - 跨 worker 不可达性契约已由 `cross-e2e/07-library-worker-topology-contract.test.mjs` 声明（当前为空操作，见 R9）
  - worker 内部的 `smoke.test.ts` 已有 `returns 401 binding-scope-forbidden for non-probe routes (ZX2)` 测试
- **为什么重要**：posture 测的是"library worker 不暴露非探针路由"这一**单 worker 安全策略**，而非跨 worker 交互。在 package-e2e 中放置此类测试会模糊 e2e 的范围定义。
- **审查判断**：正确定义是 package-e2e 应该验证部署制品的**面端行为**（跨 worker 协作的运行时正确性），而单 worker 的路由安全策略应回归到 worker 内部测试。
- **建议修法**：
  1. 将 `context-core/02` 和 `filesystem-core/02` 的测试逻辑迁移至各 worker 的 `smoke.test.ts`，补充为 ZX2 绑定范围的非路由探针冻结守卫
  2. 在 package-e2e 中保留文件但替换为跨面姿态验证（如：从 orchestrator-core 的 `/debug/workers/health` 确认 library worker 以正确的身份和状态报告健康）

### R4. orchestrator-core 路由测试使用脆弱的 SQL 字符串匹配 mock

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `confirmation-route.test.ts` — 手写 mock 通过 `sql.includes("FROM nano_session_confirmations")` 拦截所有查询
  - `todo-route.test.ts` — `sql.includes("FROM nano_conversation_sessions s")` 拦截 lifecycle 查询
  - `me-conversations-route.test.ts`、`me-sessions-route.test.ts`、`session-model-route.test.ts`、`debug-routes.test.ts` 等均使用 SQL 字符串匹配
  - 任何 SQL 重构（列重命名、表重命名、查询优化）都可能导致 mock 行为偏移但测试仍然"通过"——因为 mock 使用的是宽松匹配而非精确断言
- **为什么重要**：这是一种"假绿"风险——测试通过但实际行为可能已偏离。控制面测试（confirmation-control-plane、todo-control-plane、checkpoint-restore-plane）已经使用了真实的 adaptD1 + 内存 SQLite，证明好的模式是存在的。
- **审查判断**：路由层测试应改用 adaptD1 或共享的 mock 工厂，确保 mock 行为与真实 schema 对齐。
- **建议修法**：
  1. 提取 `test/helpers/adapt-d1.ts` 共享辅助（已在 5+ 个 control-plane 测试中重复）
  2. 路由测试逐步迁移为使用 adaptD1 生成真实内存 SQLite 实例
  3. 过渡期可使用共享的 `createDbMock` 工厂替代手写 SQL 匹配

### R5. 4+ 处 FakeWorkspace/makeWorkspace/adaptD1 代码重复

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `bash-core/test/capabilities/search-rg-reality.test.ts`、`git-subset.test.ts`、`file-search-consistency.test.ts`、`local-ts-workspace.test.ts` 各自包含几乎完全相同的 FakeWorkspace 实现
  - `bash-core/test/capabilities/text-processing-core.test.ts` 和 `text-processing-aux.test.ts` 包含完全相同的 makeWorkspace 函数
  - `orchestrator-core/test/` 中 6+ 个文件包含相同的 adaptD1 辅助函数
  - `orchestrator-auth/test/service.test.ts` 和 `bootstrap-hardening.test.ts` 各自包含 InMemoryAuthRepository 实现
- **为什么重要**：代码重复导致维护负担——当接口变更时需要同步更新多处，遗漏则产生静默不一致。
- **审查判断**：应提取共享测试辅助，降低维护成本。
- **建议修法**：
  1. `bash-core/test/helpers/fake-workspace.ts` — 统一 FakeWorkspace
  2. `bash-core/test/helpers/make-workspace.ts` — 统一 makeWorkspace
  3. `orchestrator-core/test/helpers/adapt-d1.ts` — 统一 adaptD1
  4. `orchestrator-core/test/helpers/make-user-do-mock.ts` — 统一 makeUserDoMock
  5. `orchestrator-auth/test/helpers/in-memory-auth-repository.ts` — 统一 InMemoryAuthRepository

### R6. 多处 setTimeout 依赖的测试在 CI 下可能不稳定

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `bash-core/test/smoke.test.ts` — `setTimeout(resolve, 10)` 后发取消
  - `bash-core/test/executor.test.ts` — 50ms timeout vs 延迟
  - `bash-core/test/integration/service-binding-transport.test.ts` — `setTimeout(10)` 取消路由
  - `bash-core/test/integration/service-binding-progress.test.ts` — `setTimeout(10)` 取消 + 30ms timeout vs 500ms 延迟
  - `nacp-session/test/websocket.test.ts` — 心跳和 ack 超时依赖 setTimeout
  - `nacp-session/test/heartbeat.test.ts` — 1.5x interval 和 timeout 依赖 setTimeout
  - `nacp-session/test/integration/heartbeat-timeout.test.ts` — 心跳超时检测
- **为什么重要**：CI 环境（尤其是 GitHub Actions 的免费 runner）CPU 限制可能导致 setTimeout 回调延迟，使测试在正确逻辑下仍间歇性失败。
- **审查判断**：不阻塞，但应逐步改为假定时器或加大超时倍数。
- **建议修法**：
  1. 所有依赖 setTimeout 的超时测试统一使用 `vi.useFakeTimers()`
  2. 如果无法使用假定时器（如测试真实 WebSocket 行为），将超时倍数增大至至少 5x 预期值
  3. 对已知的脆弱测试添加 `@skip` 标记并在 CI 中单独运行

### R7. bash-core/error-code 不一致（execution-error vs handler-error）

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `worker/bash-core/test/executor.test.ts:124` — 断言 `execution-error`
  - `worker/bash-core/test/integration/local-ts-workspace.test.ts:144` — 断言 `handler-error`
  - 两者测试的都是"handler 执行错误"，但使用了不同的错误码
- **为什么重要**：如果这是两个不同层级的精确区分（executor 层 vs handler 层），则需要文档说明；如果是遗漏，可能导致客户端无法正确处理错误。
- **审查判断**：需确认代码行为后决定。
- **建议修法**：确认 executor 和 handler 层的错误码设计意图。如果两者应有不同的 code，在测试中添加注释说明；如果是 bug，修正其中一个。

### R8. package-e2e/orchestrator-core/07 legacy 退休测试放在了错误的目录

- **严重级别**：`low`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `test/package-e2e/orchestrator-core/07-legacy-agent-retirement.test.mjs` 的 8 个测试带标记 `["agent-core"]`，测的是 agent-core 的旧路由返回 410/426
  - 文件放在 `orchestrator-core/` 目录下
- **为什么重要**：文件组织与测试对象不一致，增加维护时的认知负担。
- **审查判断**：应移至 `test/package-e2e/agent-core/07-legacy-agent-retirement.test.mjs`。

### R9. cross-e2e/07 空操作拓扑契约测试

- **严重级别**：`high`
- **类型**：`test-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `test/cross-e2e/07-library-worker-topology-contract.test.mjs` — 唯一断言是 `assert.ok(true, "...")`
  - 注释声明"实际的拓扑契约断言已委托给 worker 本地测试和 wrangler 审计"
  - 但 wrangler 审计并不存在（至少不在 CI 中运行）
- **为什么重要**：library worker 不可达性是安全关键属性，应该有真实的跨 worker e2e 契约测试验证。
- **审查判断**：要么实现真正的拓扑契约测试（如从 orchestrator-core 尝试直接访问 library worker 的非探针路由并断言 401/404），要么在 R3 迁移后的 worker 内部测试中统一守护。
- **建议修法**：实现真实测试——从 orchestrator-core 的 `/debug/workers/health` 端点获取所有 bound worker 列表，验证每个 library worker 只暴露探针路由。

### R10. bash-core 断言实现常量值

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `bash-core/test/result.test.ts:76` — 断言 `INLINE_RESULT_MAX_BYTES === 65536`
  - `bash-core/test/capabilities/search-rg-reality.test.ts:137` — 断言 `DEFAULT_RG_MAX_MATCHES === 200` 和 `DEFAULT_RG_MAX_BYTES === 32 * 1024`
- **为什么重要**：这些测试断言具体数字而非行为。如果常量有意变更，测试会意外失败但无明确指示。
- **审查判断**：不阻塞，但应在测试描述或注释中标注"冻结常量守卫，变更此值需同步更新测试"。
- **建议修法**：在测试描述和注释中明确标注为冻结常量守卫。

### R11. nacp-session stream-event 仅 7/13 kind 有正向解析测试

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `packages/nacp-session/test/stream-event.test.ts` 声称有 13 种注册 kind
  - 正向解析测试仅覆盖了 7 种：`tool.call.progress`、`hook.broadcast`、`llm.delta`、`turn.begin`、`compact.notify`、`system.notify`、`system.error`
  - 缺少正向解析的 6 种：`tool.call.result`、`tool.call.cancelled`、`session.fork.created`、`session.stream.ack`、`session.heartbeat`、`model.fallback`
  - 注意：`tool.call.cancelled` 和 `session.fork.created` 各有独立的测试文件（`hp6-tool-cancelled.test.ts` 和 `hp7-fork-created.test.ts`），所以实际的独立覆盖是存在的
  - 真正缺少独立正向解析测试的只有：`tool.call.result`（在 tool adapter 测试中间接覆盖）、`session.stream.ack`、`session.heartbeat`、`model.fallback`
- **为什么重要**：stream event kind 是 NACP 协议的核心表面，每种 kind 的正向解析应至少有 1 个显式测试。
- **建议修法**：
  1. 在 `stream-event.test.ts` 中为每种缺少正向解析的 kind 添加测试（至少 `session.stream.ack`、`session.heartbeat`、`model.fallback`、`tool.call.result` 各一个）
  2. 或者将现有独立文件的 `registers in STREAM_EVENT_KINDS` 测试视为足够覆盖，但在 stream-event.test.ts 中添加注释说明哪些 kind 在独立文件中覆盖

### R12. orchestrator-core/user-do.test.ts 过长（1504行）

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：`workers/orchestrator-core/test/user-do.test.ts` 有 1504 行，包含 27+ it 块，覆盖了 start 逻辑、WS 逻辑、权限/决策转发、生命周期管理、alarm/cache 清理等多个关注点。
- **建议修法**：拆分为：
  - `user-do-start.test.ts` — start 相关逻辑
  - `user-do-ws.test.ts` — WebSocket 逻辑
  - `user-do-permission-elicitation.test.ts` — 决策转发
  - `user-do-alarm-cache.test.ts` — alarm/cache 清理

### R13. package-e2e/orchestrator-core/08 worker-health 硬编码 6 个 worker 名称

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：`test/package-e2e/orchestrator-core/08-worker-health.test.mjs` 硬编码了 6 个 worker 名称和数量，每当 worker 矩阵变化都会失败。
- **建议修法**：改为动态断言——从 `/debug/workers/health` 响应中提取 worker 列表，断言数量 > 0 且每个 worker 的 status 字段有效。

### R14. packages/storage-topology R2 F01 测试仅验证 1 MiB 而非边界

- **严重级别**：`low`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：`packages/storage-topology/test/adapters/r2-adapter.test.ts` 中的 F01 测试只验证 1 MiB 字符串不触发 multipart，但注释声称是"≤ 10 MiB"契约。
- **建议修法**：添加接近 10 MiB 边界的测试用例（如 9.99 MiB），或者至少在注释中说明为何省略。

---

## 3. In-Scope 逐项对齐审核

> 以下对齐所有测试层级与 worker 的覆盖情况。

### 3.1 Worker 内部测试 Matrix

#### 3.1.1 bash-core (30 files, ~260 test cases)

| 领域 | 文件数 | 测试数 | 覆盖评价 | 问题 |
|------|--------|--------|----------|------|
| RPC 层 | 1 | 14 | 良好 | 无 |
| Plumbing/注册 | 2 | 15 | 良好 | 无 |
| Planner | 4 | 39 | 良好 | planFromToolCall 仅 2 case |
| 策略/权限 | 2 | 18 | 良好 | 无 |
| 执行器 | 2 | 17 | 良好 | setTimeout 脆弱 |
| 工具调用/结果 | 2 | 20 | 良好 | Zod schema 同步风险 |
| 文件系统 | 1 | 7 | 良好 | 无 |
| 能力: workspace-truth | 1 | 12 | 良好 | 无 |
| 能力: ts-exec | 1 | 5 | 良好 | 无 |
| 能力: text-processing | 2 | 30 | 良好 | makeWorkspace 重复 |
| 能力: search-rg | 1 | 12 | 良好 | 常量断言 |
| 能力: network-egress | 1 | 13 | 优秀 | 无 |
| 能力: git-subset | 1 | 9 | 良好 | FakeWorkspace 重复 |
| 集成 | 6 | 28 | 偏薄 | remote-seam 仅 3 case |
| 冻结清单守卫 | 1 | 11 | 优秀 | 外部文件依赖 |
| 冒烟 | 1 | 7 | 良好 | setTimeout 脆弱 |

#### 3.1.2 context-core (14 files, ~135 test cases)

| 领域 | 文件数 | 测试数 | 覆盖评价 | 问题 |
|------|--------|--------|----------|------|
| RPC 控制面 | 1 | 6 | 良好 | 无 |
| 冒烟 | 1 | 4 | 良好 | 无 |
| 快照 | 1 | 8 | 良好 | 无 |
| 脱敏 | 1 | 15 | 优秀 | 跨包对齐守卫 |
| Inspector facade | 1 | 27 | 优秀 | 无 |
| 上下文组装器 | 1 | 13 | 优秀 | 无 |
| Compact 边界 | 1 | 10 | 良好 | 无 |
| Budget/策略 | 1 | 18 | 优秀 | 无 |
| 异步 compact | 7 | 46 | 优秀 | R4 回归守卫标注完整 |
| 集成 | 0 | 0 | 缺口 | 无 e2e 集成测试 |

#### 3.1.3 filesystem-core (16 files, ~210 test cases)

| 领域 | 文件数 | 测试数 | 覆盖评价 | 问题 |
|------|--------|--------|----------|------|
| RPC 路径法律 | 1 | 5 | 良好 | 无 |
| 冒烟 | 1 | 4 | 良好 | 无 |
| 存储: taxonomy/refs/keys | 3 | 42 | 优秀 | 跨包对齐守卫 |
| 存储: placement/mime-gate | 2 | 28 | 优秀 | 无 |
| 存储: adapters | 5 | 53 | 优秀 | D1 负面 API 守卫出色 |
| 提升/promotion | 1 | 17 | 优秀 | F08 对齐守卫 |
| Namespace | 1 | 19 | 优秀 | 只读/可写挂载路由 |
| Backends | 2 | 38 | 优秀 | F08 大小路由 |

#### 3.1.4 orchestrator-auth (4 files, ~21 test cases)

| 领域 | 文件数 | 测试数 | 覆盖评价 | 问题 |
|------|--------|--------|----------|------|
| 认证服务 | 1 | 12 | 良好 | 首个 it 是大集成测试 |
| 公开表面 | 1 | 1 | 良好 | 极简但完整 |
| 引导加固 | 1 | 3 | 良好 | 并发压力测试优秀 |
| kid 轮换 | 1 | 5 | 优秀 | 关键安全测试 |

#### 3.1.5 orchestrator-core (28 files, ~200+ test cases)

| 领域 | 文件数 | 测试数 | 覆盖评价 | 问题 |
|------|--------|--------|----------|------|
| Checkpoint | 2 | 20 | 优秀 | 真实 SQLite + migration |
| Todo | 2 | 17 | 优秀 | helper+SQL CHECK 双端 |
| Confirmation | 3 | 21 | 优秀 | 双写+控制面+路由 |
| 迁移冻结 | 1 | 10+ | 优秀 | DDL Freeze Gate |
| Session/conversation 路由 | 4 | 18 | 良好 | SQL mock 脆弱 |
| User-DO 核心 | 1 | 27+ | 良好 | 过长，需拆分 |
| User-DO lifecycle | 1 | 3 | 偏薄 | 关键路径覆盖不足 |
| 认证 | 2 | 10 | 优秀 | kid rotation 安全关键 |
| Debug/观测 | 2 | 10 | 良好 | SQL mock 脆弱 |
| Files 路由 | 1 | 13 | 优秀 | 安全覆盖全面 |
| 策略/权限/决策路由 | 3 | 15 | 良好 | 模式重复 |
| 绑定/使用量/奇偶桥 | 3 | 22 | 良好 | 无 |
| 冒烟 | 1 | 12+ | 优秀 | 全面的安全路径 |

#### 3.1.6 agent-core (103+ files, ~1340 test cases)

| 领域 | 文件数 | 测试数 | 覆盖评价 | 问题 |
|------|--------|--------|----------|------|
| Kernel | 8 | ~80 | 优秀 | 纯状态机测试 |
| LLM | 11 | ~90 | 良好 | 重试/流式覆盖全面 |
| Host/DO | 23 | ~200+ | 良好 | mock 较重 |
| Host/integration | 10 | ~60 | 良好 | checkpoint/WS/graceful |
| Eval | 15 | ~150 | 优秀 | timeline/trace/evidence |
| Hooks | 15 | ~200+ | 优秀 | 全覆盖 |
| RPC/冒烟 | 2 | ~20 | 良好 | 无 |

### 3.2 Package-E2E 测试 Matrix

| Worker | 文件数 | 测试数 | 有效 e2e | 应迁移 | 问题 |
|--------|--------|--------|----------|--------|------|
| bash-core | 6 | 11 | 11 | 0 | 06 部分属于 worker 内部 |
| context-core | 2 | 2 | 1 | 1 | 02 是内部路由测试 |
| filesystem-core | 2 | 2 | 1 | 1 | 02 是内部路由测试 |
| orchestrator-auth | 1 | 1 | 1 | 0 | 无 |
| agent-core | 1 | 1 | 1 | 0 | 无 |
| orchestrator-core | 11 | 24 | 23 | 0 | 07 应移至 agent-core/ |
| **合计** | **23** | **41** | **38** | **2** | |

### 3.3 Cross-E2E 测试 Matrix

| 文件 | 测试数 | 有效 | 占位 | 性质 | 问题 |
|------|--------|------|------|------|------|
| 01-stack-preview-inventory | 1 | ✅ | — | 跨面板元数据 | 与 probe 有重叠但视角不同 |
| 02-agent-bash-tool-call-happy-path | 1 | ✅ | — | 跨 worker 端到端 | 与 bash-core/02+04 重叠 |
| 03-agent-bash-tool-call-cancel | 1 | ✅ | — | 跨 worker | 与 bash-core/03 重叠 |
| 04-agent-context-initial-context | 1 | ✅ | — | 跨 worker | 与 orch-core/02 test2 重叠 |
| 05-agent-context-default-compact-posture | 1 | ⚠️ | — | 测内部配置 | 应归入 worker 内部 |
| 06-agent-filesystem-host-local-posture | 1 | ⚠️ | — | 测内部配置 | 应归入 worker 内部 |
| 07-library-worker-topology-contract | 1 | ❌ | ✅ | 空操作 | 应实现或删除 |
| 08-session-lifecycle-cross | 1 | ✅ | — | 最完整跨 worker | 与 11 重叠但更简洁 |
| 09-capability-error-envelope-through-agent | 2 | ✅ | — | 跨 seam 错误传播 | 与 bash-core/05 重叠但路径不同 |
| 10-probe-concurrency-stability | 1 | ✅ | — | 负载/并发 | 无 |
| 11-orchestrator-public-facade-roundtrip | 1 | ✅ | — | 完整端到端 | 与 08 重叠但含 WS |
| 12-real-llm-mainline-smoke | 1 | ✅ | — | 真实 LLM | D1 直接操作 |
| 13-device-revoke-force-disconnect | 1 | ✅ | — | 安全关键 | 无 |
| 14-files-cross-tenant-deny | 1 | ✅ | — | 安全关键 | 无 |
| 15-hp2-model-switch | 5 | ❌ | ✅ | 全部占位 | **R1** |
| 16-hp3-context-machine | 5 | ❌ | ✅ | 全部占位 | **R1** |
| 17-hp4-lifecycle | 6 | ❌ | ✅ | 全部占位 | **R1** |
| 18-hp5-confirmation-roundtrip | 4 | ❌ | ✅ | 全部占位 | **R1** |
| 19-hp6-tool-workspace | 6 | ❌ | ✅ | 全部占位 | **R1** |
| 20-hp7-checkpoint-restore | 6 | ❌ | ✅ | 全部占位 | **R1** |
| 21-hp8-heartbeat-posture | 4 | ❌ | ✅ | 全部占位 | **R1** |
| zx2-transport | 1+ | ✅ | — | 面板端点验证 | 文件名不描述性 |

### 3.4 Root-Guardians 测试 Matrix

| 文件 | 测试数 | 性质 | 问题 |
|------|--------|------|------|
| nacp-1-3-matrix-contract | 9 | 跨切契约 ✅ | 无 |
| tool-call-live-loop | 5 | 进程内单元 ❌ | **R2** 应迁移 |
| session-registry-doc-sync | 3 | 文档-代码对齐 ✅ | 无 |
| test-command-coverage | 4 | 元测试 ✅ | 无 |
| storage-topology-contract | 3 | 跨包契约 ✅ | 无 |
| initial-context-schema-contract | 7 | 跨切 schema ✅ | 无 |

### 3.5 Packages 测试 Matrix

| 包 | 文件数 | 测试数 | 覆盖评价 | 问题 |
|------|--------|--------|----------|------|
| nacp-session | 19 | ~170 | 优秀 | stream-event 正向覆盖不完整 |
| jwt-shared | 1 | 20 | 优秀 | kid rotation 关键守卫 |
| storage-topology | 15 | ~170 | 优秀 | 跨包对齐守卫 |

### 3.6 对齐结论

- **done**: ~1600 有效测试用例，覆盖核心逻辑、协议表面、安全边界
- **partial**: stream-event 7/13 kind 正向覆盖、local-ts-workspace 集成覆盖偏薄
- **missing**: HP2-HP8 的真实 e2e 测试（31 个占位）、library-worker 拓扑契约
- **stale**: `tool-call-live-loop` 在 root-guardians 的位置、legacy 测试在 orchestrator-core 目录
- **out-of-scope-by-design**: 真实 LLM 调用深度测试（需外部服务）

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 真实 Cloudflare DO 集成测试 | 遵守 | 需要 Cloudflare 运行时，不在静态测试范围内 |
| O2 | 真实 LLM 端到端深度测试 | 遵守 | 依赖外部 API，仅做冒烟级验证 |
| O3 | 性能/负载测试 | 遵守 | 不在功能测试范围内，10-probe-concurrency 是唯一并发测试 |
| O4 | 客户端 (wechat-miniprogram) 测试审查 | 遵守 | 不在本轮审查范围 |
| O5 | CI/CD 流水线配置 | 部分违反 | setTimeout 脆弱性可能导致 CI 间歇性失败 |

---

## 5. 专项分析：测试归属分界

### 5.1 应回归到 Worker 内部测试的

| 当前位置 | 测试内容 | 应迁移到 | 理由 |
|----------|----------|----------|------|
| `package-e2e/context-core/02-library-worker-posture.test.mjs` | POST /runtime → 404 路由拒绝 | `workers/context-core/test/smoke.test.ts` | 单 worker 路由安全策略，非跨 worker 行为 |
| `package-e2e/filesystem-core/02-library-worker-posture.test.mjs` | POST /runtime → 404 路由拒绝 | `workers/filesystem-core/test/smoke.test.ts` | 同上 |
| `root-guardians/tool-call-live-loop.test.mjs` | 组合工厂路由 + binding 声明 + wire kind 验证 | `workers/agent-core/test/live-loop/` | 进程内单元测试，非跨切契约 |
| `cross-e2e/05-agent-context-default-compact-posture.test.mjs` | verify 端点的 compact 姿态挂载状态 | `workers/context-core/test/` 或 `workers/orchestrator-core/test/` | 测的是内部配置而非跨 worker 协作 |

### 5.2 应保留在 Package-E2E 的

| 文件 | 测试内容 | 保留理由 |
|------|----------|----------|
| bash-core/01-preview-probe | 部署后服务健康检查 | 验证部署制品 |
| bash-core/02-capability-call-route | /capability/call 路由可达性 | 部署层契约 |
| bash-core/03-capability-cancel-route | /capability/cancel 路由可达性 | 部署层契约 |
| bash-core/04-capability-sampling | 信封形状采样验证 | 部署层契约 |
| bash-core/05-capability-error-envelopes | 错误信封格式验证 | 部署层契约（含 worker+phase 归属） |
| bash-core/06-capability-malformed-body | HTTP 400 边界验证 | 部署层契约（含 worker+phase 归属性质） |
| context-core/01-preview-probe | library-worker 身份验证 | 部署层契约 |
| filesystem-core/01-preview-probe | library-worker 身份验证 | 部署层契约 |
| orchestrator-auth/01-probe | 公开表面安全边界验证 | 部署安全契约 |
| agent-core/01-preview-probe | live-loop 身份验证 | 部署层契约 |
| orchestrator-core/01-11 (除07外) | 面板路由的全链路验证 | 部署层契约 |

### 5.3 应保留在 Cross-E2E 的

| 文件 | 测试内容 | 保留理由 |
|------|----------|----------|
| 01-stack-preview-inventory | 跨面板架构元数据 | 唯一验证面板聚合 |
| 02, 03 | 通过 agent 的 capability 调用/取消 | 跨 seam 真实调用 |
| 08-session-lifecycle-cross | 完整跨 worker 生命周期 | 最完整的端到端 |
| 09-error-envelope-through-agent | 跨 seam 错误传播不变异 | 关键不变量 |
| 10-probe-concurrency-stability | 并发负载稳定性 | 唯一并发测试 |
| 12-real-llm-mainline-smoke | 真实 LLM 调用端到端 | 唯一真实 LLM 路径验证 |
| 13-device-revoke | 设备撤销安全边界 | 安全关键 |
| 14-files-cross-tenant-deny | 跨租户文件拒绝 | 安全关键 |
| zx2-transport | 面板端点契约 | 入口路由验证 |

### 5.4 应保留在 Root-Guardians 的

| 文件 | 测试内容 | 保留理由 |
|------|----------|----------|
| nacp-1-3-matrix-contract | NACP 协议矩阵契约 | 跨包契约 |
| session-registry-doc-sync | 文档-代码对齐 | 跨切一致性 |
| test-command-coverage | 测试结构保证 | 元测试 |
| storage-topology-contract | 跨包存储契约 | 跨包契约 |
| initial-context-schema-contract | Schema 向后兼容 | 跨切兼容性 |

---

## 6. 测试冗余与缺口专项分析

### 6.1 跨层冗余 Matrix

| 冗余对 | 层级 | 真冗余？ | 建议 |
|--------|------|----------|------|
| bash-core/02 pwd 调用 vs bash-core/04 pwd 采样 | package-e2e vs package-e2e | 否 | 视角不同（路由可达 vs 信封形状），添加差异化注释 |
| cross-e2e/09 unknown-tool/policy-ask vs bash-core/05 同类错误 | cross-e2e vs package-e2e | 否 | 路径不同（代理 vs 直接），差异是关键不变量 |
| cross-e2e/04 initial-context vs orch-core/02 test2 | cross-e2e vs package-e2e | 部分 | 高度重叠，建议交叉引用注释说明差异 |
| cross-e2e/08 完整生命周期 vs cross-e2e/11 面板轮转 | cross-e2e vs cross-e2e | 部分 | 11 含 WS 验证，08 更简洁；建议合并或在不同场景下保留 |
| packages/storage-topology & filesystem-core refs/keys/taxonomy | packages vs worker | 否 | packages 测纯函数，worker 测集成路径 |
| nacp-session websocket AckWindow vs delivery | unit vs unit | 否 | 语义不同（单组件 vs 集成） |
| orchestrator-core adaptD1 × 6 | worker internal | 是 | 提取共享辅助 |
| bash-core FakeWorkspace × 4 | worker internal | 是 | 提取共享辅助 |

### 6.2 覆盖缺口 Matrix

| 缺口 | 领域 | 严重级别 | 建议 |
|------|------|----------|------|
| HP2-HP8 跨 worker e2e 测试（31 个占位） | cross-e2e | critical | 实现或删除 (R1) |
| library-worker 拓扑契约 | cross-e2e | high | 实现真实测试 (R9) |
| stream-event 6/13 kind 正向解析 | nacp-session | medium | 补充测试 (R11) |
| agent-core live-loop 测试应在 agent-core 内部 | root-guardians | high | 迁移 (R2) |
| local-ts-workspace 仅 5 case（未覆盖 rm/mv/cp/git） | bash-core | low | 补充集成覆盖 |
| remote-seam-upgrade 仅 3 case | bash-core | low | 补充取消/超时/错误场景 |
| orchestrator-core 路由 mock 脆弱性 | orchestrator-core | high | 改用 adaptD1 (R4) |
| me-sessions-route 缺少 401 测试 | orchestrator-core | medium | 补充 |
| session-model-route 缺少输入验证负面测试 | orchestrator-core | medium | 补充 |
| observability-runtime 仅 3 case | orchestrator-core | medium | 补充边界条件 |
| packages R2 10 MiB 边界测试 | storage-topology | low | 补充边界 (R14) |
| context-core 无 e2e 集成测试 | context-core | medium | 考虑补充 compact 端到端路径 |

---

## 7. 最终 verdict 与收口意见

- **最终 verdict**：当前测试体系主体完整，核心安全路径有良好覆盖，但存在 31 个零价值占位测试、若干归属错误和脆弱 mock 问题。清除占位、修正归属、统一辅助后，测试体系可达到 production-grade。
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 删除或标记 cross-e2e 15-21 的 31 个占位测试 (R1)
  2. 实现或替代 cross-e2e/07 拓扑契约测试 (R9)
- **可以后续跟进的 non-blocking follow-up**：
  1. 迁移 tool-call-live-loop 至 agent-core 内部测试 (R2)
  2. 迁移 context-core/02 和 filesystem-core/02 至 worker 内部测试 (R3)
  3. 替换 orchestrator-core 路由测试的 SQL mock 为 adaptD1 (R4)
  4. 提取共享 test helpers (FakeWorkspace, adaptD1, makeUserDoMock, InMemoryAuthRepository) (R5)
  5. 改造 setTimeout 依赖测试为假定时器 (R6)
  6. 确认并统一 bash-core error-code (R7)
  7. 移动 legacy 测试至正确目录 (R8)
  8. 补充 stream-event 正向解析测试 (R11)
  9. 拆分 user-do.test.ts (R12)
  10. 改造 worker-health 动态断言 (R13)
  11. 标注冻结常量守卫 (R10)
- **建议的二次审查方式**：`independent reviewer` — blocker 修正后由独立审查者确认占位测试是否已正确处理。
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §6 append 回应，不要改写 §0-§5。

> 如果不能关闭，请明确写出：
> `本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。`