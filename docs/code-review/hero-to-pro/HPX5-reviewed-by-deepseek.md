# Nano-Agent 代码审查 — HPX5 Wire-Up

> 审查对象: `HPX5 — schema-frozen wire-up + bounded surface completion` (F0/F1/F2a/b/c/F3/F4/F5/F7)
> 审查类型: `closure-review + code-review + docs-review + cross-package-audit`
> 审查时间: `2026-05-02`
> 审查人: `DeepSeek (独立审查,不依赖其他 reviewer 结论)`
> 审查范围:
> - `packages/nacp-session/src/emit-helpers.ts` (NEW)
> - `packages/nacp-session/test/emit-helpers.test.ts` (NEW)
> - `workers/orchestrator-core/src/wsemit.ts` (NEW)
> - `workers/orchestrator-core/src/hp-absorbed-routes.ts` (workspace bytes GET)
> - `workers/orchestrator-core/src/entrypoint.ts` (WriteTodos RPC)
> - `workers/orchestrator-core/src/user-do/surface-runtime.ts` (confirmation emitter)
> - `workers/orchestrator-core/src/user-do/message-runtime.ts` (model.fallback emitter)
> - `workers/orchestrator-core/src/facade/routes/session-context.ts` (compact body 透传)
> - `workers/orchestrator-core/src/facade/routes/session-control.ts` (confirmation/todo emit 路由)
> - `workers/orchestrator-core/src/user-do/session-flow/start.ts` (first_event_seq)
> - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` (compact probe + emitTopLevelFrame deps)
> - `workers/agent-core/src/host/runtime-mainline.ts` (WriteTodos capability 短路)
> - `workers/agent-core/src/host/orchestration.ts` (OrchestrationDeps 扩展)
> - `workers/context-core/src/index.ts` (compact RPC 签名扩展)
> - `clients/api-docs/*.md` (18→19 doc pack 修订)
> - `clients/api-docs/client-cookbook.md` (NEW)
> - `scripts/check-docs-consistency.mjs` (NEW)
> 对照真相:
> - `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md` (原始计划)
> - `docs/issue/hero-to-pro/HPX5-closure.md` (实行者 closure 声明)
> - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` (上游设计)
> - `docs/charter/plan-hero-to-pro.md` (阶段 charter)
> - `docs/eval/hero-to-pro/api-gap/HPX5-HPX6-design-docs-reviewed-by-deepseek.md` (评审建议)
> 文档状态: `reviewed — approve-with-followups`

---

## 0. 总结结论

- **整体判断**: HPX5 wire-up 实现主体成立 — 7 项 In-Scope 功能 (F0/F1/F2/F3/F4/F5/F7) 全部在代码中落地,代码质量中等偏上,emit-helpers 基础设施设计稳健,跨 worker emit bridge 架构合理,WriteTodos capability 的 auto-close 逻辑全面;但存在 5 处需要修正的局部问题 (1 critical + 3 medium + 1 low),以及 1 个跨阶段的实现层 gap 需要在最终 verdict 中明示。
- **结论等级**: `approve-with-followups`
- **是否允许关闭本轮 review**: `yes` — 前提是 R1 (critical) 必须在 HPX6 启动前修正,其余 followup 可交由 HPX6 或 hero-to-platform 处理
- **本轮最关键的 3 个判断**:
  1. `emit-helpers.ts` 的 zod 校验 + system.error fallback 三层防护 (schema fail → system.error → 容忍 drop) 是一个**坚实的 emit seam 基础设施**,对 HPX6 的 9 项新 emitter 有直接杠杆作用
  2. `hp-absorbed-routes.ts` workspace bytes GET 路由中对 filesystem-core `readTempFile` RPC 的调用路径**在当前代码中不存在** — `FILESYSTEM_CORE` 接口类型声明了 `readTempFile?`,但实际 env binding 接线未经验证,这是 pre-existing 的 filesystem-core ↔ orchestrator-core RPC wiring 状态问题,HPX5 暴露了它
  3. 文档修订中 `workspace.md:4` 的 implementation reference 行号 `hp-absorbed-routes.ts:67-128` **已因 HPX5 新增 `/content` 路由分支而偏移** — 现有 parse 函数起止行已变,reference 部分失效

---

## 1. 审查方法与已核实事实

### 对照文档
- `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md` §9 (完整工作日志,660 行)
- `docs/issue/hero-to-pro/HPX5-closure.md` (实行者 closure 声明,139 行)
- `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` (设计,673 行)
- `docs/charter/plan-hero-to-pro.md` (charter,~1000 行)

### 核查实现
- `packages/nacp-session/src/emit-helpers.ts` (254 行) — 完整阅读
- `packages/nacp-session/test/emit-helpers.test.ts` (180 行) — 完整阅读
- `workers/orchestrator-core/src/wsemit.ts` (148 行) — 完整阅读
- `workers/orchestrator-core/src/hp-absorbed-routes.ts:85-392` — workspace 路由段完整阅读
- `workers/orchestrator-core/src/entrypoint.ts:138-262` — WriteTodos RPC 完整阅读
- `workers/orchestrator-core/src/user-do/surface-runtime.ts:36-135` — confirmation emitter 完整阅读
- `workers/orchestrator-core/src/user-do/message-runtime.ts:115-434` — fallback emitter 完整阅读
- `workers/orchestrator-core/src/facade/routes/session-context.ts` (208 行) — compact body 透传完整阅读
- `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:280-329` — compact probe wiring
- `workers/orchestrator-core/src/user-do/session-flow/start.ts:260-293` — first_event_seq
- `clients/api-docs/client-cookbook.md` (200 行) — 完整阅读
- `clients/api-docs/session-ws-v1.md`, `models.md`, `context.md`, `workspace.md` 等修订处 — 逐处验证
- `scripts/check-docs-consistency.mjs` (82 行) — 完整阅读并执行

### 执行过的验证
- `node scripts/check-docs-consistency.mjs` → **OK: 19 docs pass 4 consistency checks**
- `grep -rn "effective_model_id" clients/api-docs/` → 模型审计字段 (legit D1 列名) + cookbook 警告措辞,均非 `model.fallback` WS 帧上下文,无需修正
- `grep -rn "session_status.*running" clients/api-docs/` → 零命中
- `grep -r "content_source.*filesystem-core-leaf-rpc-pending" clients/api-docs/` → 零命中
- `grep -rn "index\.ts:" clients/api-docs/` → 仅剩 `workspace.md:4` 与 `context.md:4` 的新模块化 reference (非 `index.ts:NNN` 旧格式),已全部修正
- 代码逐行对照 action-plan §9.1 与 closure §1 的 40+ 项实际改动清单,全部在代码中找到对应行

### 复用 / 对照的既有审查
- `docs/eval/hero-to-pro/api-gap/HPX5-HPX6-design-docs-reviewed-by-deepseek.md` — 本审查**独立进行**,不依赖该评审的结论,但作为对照基线;HPX5 实现是否吸收了三项核心建议 (§5.1: F1/F2 emit 路径明确化、compact 描述准确化、F8 归类讨论) 是本轮审查的检查项

### 1.1 已确认的正面事实

- **F0 emit-helpers**: `emit-helpers.ts:254` 提供了 `emitTopLevelFrame` 和 `emitStreamEvent` 两个出口,均含 zod 校验 + system.error fallback + EmitObserver 通道。schema 校验失败时走 `NACP_VALIDATION_FAILED` / `NACP_UNKNOWN_MESSAGE_TYPE` / `NACP_BINDING_UNAVAILABLE` 三重 fallback,drop 仅在 system.error 本身也无法 emit 时触发 — 设计思路与 action-plan P1-01 完全一致。
- **F1 confirmation emitter**: `surface-runtime.ts:84-128` 在 `ensureConfirmationDecision` 中,D1 row create (行 105-112) 成功后立即调用 `emitServerFrame("session.confirmation.request", ...)` (行 116-127);`applyDecision` 成功后在路由层 (`session-control.ts:416-451`) emit `session.confirmation.update`。行为严格遵循 HP5 row-first dual-write law (Q16) — emit 在 row write 之后,emit 失败不滚回 row。
- **F2b WriteTodos capability**: `entrypoint.ts:138-262` 实现了完整的 WriteTodos capability backend — 自动 close 旧 in_progress (行 193-209)、同 batch 多 in_progress 仅首条生效其余降级为 pending (行 212-223)、per-row constraint 容错 (行 237-239)、emit `session.todos.update` 全量 list snapshot (行 246-260)。`runtime-mainline.ts:467-578` 的 capability execute 入口加 `toolName === "write_todos"` 短路逻辑正确。
- **F3 auto-compact wiring**: `runtime-assembly.ts:285-321` 在 `buildOrchestrationDeps` 中构造 `composeCompactSignalProbe(budgetSource, breaker)` 并注入 `OrchestrationDeps.probeCompactRequired`,budgetSource 调 `ORCHESTRATOR_CORE.readContextDurableState` 计算阈值。逻辑清晰,`probeCompactRequired` 为 optional 字段,不传时不退化。
- **F4 model.fallback emitter**: `message-runtime.ts:395-434` 替换了硬编码 `fallback_used: false, fallback_reason: null`,改为从 `inputAck.body` 读取真实 fallback decision,并在 `fallback_used=true` 时 emit `model.fallback` stream-event。字段名使用 schema 定义的 `fallback_model_id`。
- **F5 workspace bytes GET**: `hp-absorbed-routes.ts:298-344` 新增 `/content` 路径分支,走 filesystem-core `readTempFile` RPC passthrough,binary-content profile,25 MiB cap,`content_source` 从 `"filesystem-core-leaf-rpc-pending"` → `"live"` (行 291)。
- **测试**: 1789 tests 全绿 (nacp-session 207 + orchestrator-core 332 + agent-core 1072 + context-core 178), `check:cycles` 0 cycle, `check:envelope-drift` clean, `check:docs-consistency` OK。
- **文档**: 19-doc pack 零契约不一致验证通过;新增 `client-cookbook.md` (12 节,200 行) 覆盖率达标;`/start` 返回 `first_event_seq` (start.ts:270-289)。

### 1.2 已确认的负面事实

- **FILESYSTEM_CORE.readTempFile RPC 接口只在类型层声明,未验证 runtime binding 接线**: `facade/env.ts:28-46` 声明了 `FILESYSTEM_CORE.readTempFile?` 接口,`hp-absorbed-routes.ts:300` 检查 `if (!fs?.readTempFile)` 做 defensive guard,但**没有 e2e 测试或 binding-presence test 验证实际 wrangler 配置中 filesystem-core worker 的 `readTempFile` RPC 已暴露给 orchestrator-core**。如果 prod 环境中 filesystem-core 未开启此 RPC,`GET /content` 路由会始终返回 `503 filesystem-rpc-unavailable` — 这是 pre-existing 的 cross-worker RPC wiring 状态问题,HPX5 的 `reader/absorber` 路径正确地暴露了它 (并非 HPX5 引入的 bug,但 closure 宣称 "workspace bytes 路由 live" 时未显式声明此依赖的前提条件)。
- **`workspace.md:4` 的 implementation reference 行号已偏移**: HPX5 新增 `/content` 路由分支后,`parseSessionWorkspaceRoute` 函数的起止行从原有位置移动到 `hp-absorbed-routes.ts:101-133`,而文档引用 `hp-absorbed-routes.ts:67-128` 的 128 行终点已不匹配 (实际 parseSessionWorkspaceRoute 结束于行 133)。这不是功能 bug,但违反 F7 的 "reference 行号准确" 收口标准。
- **emit-helpers test 只覆盖了纯函数逻辑,未覆盖跨 worker bridge 路径**: `emit-helpers.test.ts` (10 case,180 行) 测试了 schema 校验、fallback、sink throw、observer 触发等 emit-helpers **纯函数**行为,但**没有一个 case 验证 `wsemit.ts` 的 `makeUserDoSink` → `OrchestratorUserDO.__forward-frame` → `emitServerFrame` 完整链路**。closure 把 332 个 orchestrator-core test 全绿作为 evidence,但其中**没有新增**专用于验证 F1/F2c/F4 emitter 跨 worker 通路的 e2e contracts test — 这与 action-plan P2-03 要求的 "`tests/contracts/emit-seam.test.ts` 跑 cross-worker emit 场景" 不符。
- **`models.md` 的 session_status 修正不完整**: `models.md:148` 和 `models.md:211` 两处的 `session_status: "running"` 已改为 `"active"` (action-plan 日志确认),但 `models.md:164` 的 response 示例中并未显式声明 `session_status` 字段值 — 审查时发现 `models.md` GET `/sessions/{id}/model` 的 success response body (行 142-158) 中没有 `session_status` 字段 — 这不算错误,因为该 endpoint 返回的是 model 控制面视图而非 session lifecycle 状态,但文档未解释这一点,前端可能困惑为何 `/model` 路由不返 `session_status`。
- **设计评审建议的吸收情况**: 三份 HPX5-HPX6 设计评审中,deepseek 建议 "考虑将 F8 (followup_input) 提升到 HPX5" 未被采纳 — F8 留在 HPX6,但 closure 明确声明了这一点,不算 gap。deepseek 建议 "明确 F1/F2 的 emit 路径" **已被完整采纳** — action-plan §0 明确定义 confirmation/todos 走独立顶层帧 (`SessionWebSocketHelper.pushFrame`),F4 走 stream-event (`pushStreamEvent`)。deepseek 建议 "compact 'hardcoded false' 描述修正" **已被采纳** — action-plan §0 更新为 "default-off, optionally wired"。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|-------------|------|
| 文件 / 行号核查 | yes | 全部 40+ 项代码改动均在源文件中逐行对照 |
| 本地命令 / 测试 | yes | `scripts/check-docs-consistency.mjs` 执行通过 (19 docs, 0 violations);grep 系列验证 |
| schema / contract 反向校验 | yes | `SESSION_BODY_SCHEMAS` 中确认 registration;`SessionStreamEventBodySchema` 13-kind union 确认 model.fallback 在位;direction matrix 确认 session.followup_input 为 command |
| live / deploy / preview 证据 | no | 未执行 wrangler 本地起 worker 验证;依赖 closure 声明的 1789 test 全绿 |
| 与上游 design / QNA 对账 | yes | 对照 HPX5-HPX6 design §0.4 的 5 条 bridging-Q,确认全部 answered 且实现对齐 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|-------------|----------|
| R1 | cross-worker emit 通路无 e2e 覆盖 | critical | test-gap | **yes** — HPX6 启动前补 | 新增 `tests/contracts/emit-seam.test.ts` 验证 User DO `__forward-frame` → `emitServerFrame` → attached client WS receive |
| R2 | `workspace.md:4` reference 行号已偏移 | medium | docs-gap | no | 更新 `hp-absorbed-routes.ts:67-128` → `hp-absorbed-routes.ts:67-133` 或等效精确范围 |
| R3 | `FILESYSTEM_CORE.readTempFile` RPC binding 未验证 | medium | delivery-gap | no | 在 HPX6 的 `tests/binding-presence.test.ts` 中加 `readTempFile` RPC 存在性断言;或在 HPX5 closure 中显式登记此依赖的前提条件 |
| R4 | `hp-absorbed-routes.ts` 的 `readTempFile` 调用缺少 `mime` 类型推导 | medium | correctness | no | `result.mime ?? "application/octet-stream"` 在 filesystem-core RPC 未返回 mime 时回退到通用 MIME — 这在正常路径下无害,但如果某些 workspace file (如 `.json`) 的 MIME 不确定,前端可能无法按预期渲染 |
| R5 | 文档章节目录 `client-cookbook.md` 缺少内部锚点链接 | low | docs-gap | no | 为 12 节添加 `## N.` 后的锚点跳转,提升可读性 |

### R1. cross-worker emit 通路无 e2e 覆盖

- **严重级别**: `critical`
- **类型**: `test-gap`
- **是否 blocker**: `yes` — HPX6 启动前必须补
- **事实依据**:
  - action-plan P2-03 要求 "`tests/contracts/emit-seam.test.ts`(NEW) — 测试覆盖 ≥ 12 case;contracts 测试通过"
  - 实际检查: `tests/contracts/` 目录中没有 `emit-seam.test.ts` 文件
  - closure §3 测试表中, `pnpm test:contracts` 记录为 `28/29 passing`,唯一失败是 pre-existing `session-registry-doc-sync.test.mjs`
  - `wsemit.ts:38-77` 的 `makeUserDoSink` 中 `__forward-frame` DO fetch 是 fire-and-forget,实现正确但有 race 条件 — 如果 User DO 尚未创建或 socket 未 attached,frame 会被静默吞掉;closure 未讨论这一行为
- **为什么重要**:
  - F1/F2c 的 emitter 是 HPX5 的**核心价值产出** — 三份调查报告的 P0 共识就是确认实时性不可依赖 polling。如果 emitter 路径没有自动化 e2e 验证,HPX6/HPX7 的修改可能静默退化 emitter,前端又退回轮询
  - `emitFrameViaUserDO` 是 cross-worker bridge (orchestrator-core → User DO → attached WS client) — 这个 bridge 是 HPX6 F9/F12/F14 共 9 项新 emitter 的共享路径。没有任何 e2e 覆盖意味着 bridge 的 "≤500ms P95 latency" SLA claim (closure §0) 无法被自动化验证
  - 这与 charter §4.4 的 "wire-without-delivery 不算闭合" (F12/F13 教训) 精神直接矛盾
- **审查判断**:
  - 代码实现**本身正确** — `wsemit.ts` 的 fire-and-forget + `emit-helpers.ts` 的 zod 校验 + system.error fallback 链路设计合理
  - 但从 "e2e 证据" 的角度,这是一个 `test-gap` — closure 宣称 "全部 7 项功能 live" 时没有 e2e test 文件支撑 cross-worker emit 路径
  - pre-existing contracts test 的 1 个失败 (`session-registry-doc-sync.test.mjs`) 不是 HPX5 引入的,但 HPX5 也没有新增任何 emitter contracts test 来覆盖自己
- **建议修法**:
  1. **HPX6 Phase 0 (启动前置)**: 补 `tests/contracts/emit-seam.test.ts`,至少覆盖:
     - F1: `D1ConfirmationControlPlane.create()` → orchestrator-core → User DO `__forward-frame` → WS client receive `session.confirmation.request`
     - F1: `D1ConfirmationControlPlane.applyDecision()` → WS client receive `session.confirmation.update`
     - F2c: `writeTodos` → WS client receive `session.todos.update`
     - F4: model.fallback → WS client receive `model.fallback` stream-event
     - fallback path: emit sink 不可达 → `system.error` frame emit (不阻塞 row write)
  2. 如果 contracts test 环境不支持真实 DO-to-WS 通路,至少写 stub-based test 验证 `wsemit.ts` 的 `makeUserDoSink` 行为: `emitFrameViaUserDO` 调用后 `__forward-frame` fetch 被触发,body shape 正确,且 sink throw 时 `emit-helpers` fall back to `system.error`

### R2. `workspace.md:4` reference 行号已偏移

- **严重级别**: `medium`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `workspace.md:4` 引用 `workers/orchestrator-core/src/hp-absorbed-routes.ts:67-128` (parseSessionToolCallsRoute + parseSessionWorkspaceRoute)
  - HPX5 F5 新加的 `/content` 路由分支使 `parseSessionWorkspaceRoute` 从原来 ~85 行起移到 ~101 行起,结束于 ~133 行
  - CI `check-docs-consistency.mjs` 的检查 1 只匹配 `index\.ts:[0-9]+` — **不**检查 `hp-absorbed-routes.ts` 的行号准确性
- **为什么重要**:
  - 误导后续 reader 定位代码;前端开发者若按此 reference 找 `parseSessionWorkspaceRoute` 的实现,行号偏移会导致困惑
  - `context.md:4` 做了类似更新到 `facade/routes/session-context.ts:140-200` 等新行号,但 `workspace.md:4` 的更新不彻底
- **审查判断**: F7 的行号刷新工作完成了 95% — 19 份文档全部消除了 `index.ts:NNN` 旧格式,但个别新模块结构 reference 的行号因 HPX5 自身代码扩增而未同步修正
- **建议修法**: 更新 `workspace.md:4` 为 `workers/orchestrator-core/src/hp-absorbed-routes.ts:67-133` (parseSessionToolCallsRoute + parseSessionWorkspaceRoute incl. HPX5 F5 `/content`)

### R3. `FILESYSTEM_CORE.readTempFile` RPC binding 未验证

- **严重级别**: `medium`
- **类型**: `delivery-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `hp-absorbed-routes.ts:300`: `if (!fs?.readTempFile)` defensive guard 正确地处理了 RPC 不可用场景
  - `facade/env.ts:28-46`: 声明了 `FILESYSTEM_CORE.readTempFile?` 可选接口
  - `workers/orchestrator-core/wrangler.jsonc` 中 `FILESYSTEM_CORE` service binding 的 presence 未经独立测试验证
  - closure §3 记录了 1 个 workspace-route test 更新 (`content_source: "live"`) 但不涉及 `readTempFile` RPC 的 cross-worker 调用验证
- **为什么重要**: 如果 prod/preview 环境中 filesystem-core 未暴露 `readTempFile` RPC endpoint,`GET /content` 路由会始终返回 `503` — 客户端看到的 `content_source: "live"` 与实际情况不符
- **审查判断**: 这是 pre-existing 的 cross-worker RPC wiring 状态问题 — HPX5 **正确地暴露了它** (通过 `reader/absorber` 模式),但 closure 宣称 "workspace bytes 路由 live" 时应同时登记前提条件 (filesystem-core RPC 已 deploy + binding 已打开)
- **建议修法**: 在 HPX6 的 `tests/binding-presence.test.ts` 中加 filesystem-core RPC 存在性断言;或在 HPX5 closure §5 (Backward Compatibility 报告) 中增加一条 "workspace bytes GET 依赖 filesystem-core `readTempFile` RPC 已在 preview/prod 部署"

### R4. `hp-absorbed-routes.ts` 的 `readTempFile` 调用缺少 size_bytes 校验绕过

- **严重级别**: `medium`
- **类型**: `correctness`
- **是否 blocker**: `no`
- **事实依据**:
  - `hp-absorbed-routes.ts:316-320`: 25 MiB cap 检查用的是 `file.size_bytes` (D1 metadata),但实际返回的是 R2 object bytes — 如果 D1 metadata 的 `size_bytes` 与实际 R2 object 大小不一致 (例如 metadata 是旧值但 R2 是更新后的文件),cap 检查会被绕过
  - `hp-absorbed-routes.ts:334`: `result.bytes.byteLength` 可以拿实际值,但只在 R2 返回后才可用,此时已经完成了 `readTempFile` RPC 调用 — 如果实际文件超 25 MiB,CF Workers 的 memory limit 可能已经在 RPC 返回时被触及
- **为什么重要**: Workers 的内存上限通常 128 MiB,25 MiB 文件 + 代码堆栈一般安全,但如果 `readTempFile` RPC 返回了超大文件,Workers 可能 OOM
- **审查判断**: 这不是一个会触发频发的 bug,但防御策略可以加强 — 在 `readTempFile` 调用之前通过 `content_length` header 或 RPC 元数据做 pre-check
- **建议修法**: 在 `readTempFile` RPC meta 中加 `size_bytes` 参数让 filesystem-core 自己 pre-check 并拒绝超限请求;或在 `facade/env.ts` 的 `readTempFile` 接口中加 `sizeCap` 参数透传

### R5. `client-cookbook.md` 缺少内部锚点链接

- **严重级别**: `low`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**: `client-cookbook.md` 12 节全部有 `## N.` 标题,但没有任何内部锚点 (`[§N](#section-n)`),README 索引也未添加跳转
- **审查判断**: 非功能性 gap,不影响正确性
- **建议修法**: HPX6 文档补丁时一并修复

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| **S1** | F0 emit-helpers.ts 新建 + session DO 注入 | `done` | `emit-helpers.ts:254` 两个出口 + zod 校验 + system.error fallback;`runtime-assembly.ts:367-401` 注入 `emitTopLevelFrame` deps |
| **S2** | F1 confirmation WS emitter | `done` | `surface-runtime.ts:84-128` row write 后 emit `.request`;`session-control.ts:416-451` decision 后 emit `.update`;legacy dual-write 路径同样接 emit |
| **S3** | F2a write_todos tool schema 注册 | `done` | `runtime-mainline.ts:467-578` capability 注册 + `toolName === "write_todos"` 短路 |
| **S4** | F2b execution 路由 + auto-close | `done` | `entrypoint.ts:138-262` WriteTodos RPC:auto-close 旧 in_progress + 同 batch 多 in_progress 降级 |
| **S5** | F2c todo WS emitter | `done` | `session-control.ts:506-616` HTTP 路径 emit;`entrypoint.ts:246-260` LLM 路径 emit;both emit `session.todos.update` 全量 list |
| **S6** | F3 auto-compact wiring + body 透传 | `done` | `runtime-assembly.ts:285-321` probe wiring;`session-context.ts:6-69,121-155` body 透传;`context-core/index.ts:228-372` RPC 签名扩展 |
| **S7** | F4 model.fallback emitter | `done` | `message-runtime.ts:395-434` 替换硬编码 + 读 `inputAck.body` + emit `model.fallback` |
| **S8** | F5 workspace bytes GET | `partial` | 代码 live (`hp-absorbed-routes.ts:298-344`),但 cross-worker RPC binding 未经 e2e 验证 (R3) |
| **S9** | F7 文档修订 + reference 刷新 | `partial` | 13 处契约统一 + 9 份 reference 刷新 + CI gate 0 violation;但 `workspace.md:4` 行号偏移 (R2) |

### 3.1 对齐结论

- **done**: `7` (S1/S2/S3/S4/S5/S6/S7)
- **partial**: `2` (S8 — 预存在 RPC binding 状态; S9 — workspace.md 行号)
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

> HPX5 实现状态更接近"**代码主体完成 + 文档/测试收口 90%**",不应标 `done — fully wired-up` 而有 `partial` sub-entries。但整体上 closure 声明是诚实的 — partial 项不影响前端可使用性,仅影响可维护性和可验证性。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|---------------------------|----------|------|
| O1 | F6 tool-calls D1 ledger | `遵守` | `hp-absorbed-routes.ts:184-196` 仍返 `source: "ws-stream-only-first-wave"`,正确延后到 HPX6 |
| O2 | F8 followup_input public WS | `遵守` | direction matrix 已有 `session.followup_input` 注册,`OrchestrationDeps` 有 `drainNextPendingInput`,但 public WS handler 未加 — 正确延后到 HPX6 |
| O3 | F9-F15 (workbench 全部) | `遵守` | 无越界实现 |
| O4 | stream-event 旧 emitter 迁移 | `遵守` | `pushStreamEvent` 路径不动,turn.begin/end 等 13 个 emitter 未迁移到 helpers |
| O5 | WriteTodos V2 task graph | `遵守` | 5-status flat list 维持,Q20 frozen 不变 |
| O6 | legacy permission/elicitation 帧恢复 | `遵守` | 确认不再 emit,`permissions.md` §1 声明维持 |
| O7 | permission_mode 删除 (Q-bridging-7) | `遵守` | `surface-runtime.ts:660-682` 路由完全保留,等待 HPX6 hard delete |
| O8 | decision/payload legacy dual-accept | `遵守` | closure §5 声明 "façade 路由未引入 dual-accept",留 HPX6;与 action-plan P5-01 第 4 条要求的 "façade 加 fallback" 有轻微**实现偏差** — 但 owner 已在 design v0.2.1 中批准 F7 仅文档修正不引入代码 dual-accept |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**: HPX5 wire-up 实现主体成立 — emit-helpers 基础设施设计稳健,confirmation/todos/model.fallback 三类 emitter 正确接入,WriteTodos capability 的 auto-close 逻辑全面,auto-compact probe wiring 架构合理,workspace bytes GET 路由代码正确,文档修订覆盖面广 (19 doc, 0 CI violation)。**但 closure 宣称 "done — fully wired-up" 过于绝对**: cross-worker emit 路径缺少 e2e test 覆盖 (R1),workspace bytes 路由的 RPC binding 依赖未经验证 (R3),且有 1 处文档行号偏移 (R2)。

- **是否允许关闭本轮 review**: `yes` — 前提是 R1 (critical) 必须在 HPX6 启动前修正,其余 followup 可交由 HPX6 或 hero-to-platform 处理

- **关闭前必须完成的 blocker**:
  1. **R1**: 补 `tests/contracts/emit-seam.test.ts` 覆盖 F1/F2c/F4 的 cross-worker emit 通路 (或至少 stub-based test 验证 `wsemit.ts` 行为)。不要求 12 case,至少 3 case: happy path confirmation.request → WS receive + model.fallback stream-event → WS receive + sink failure → system.error fallback

- **可以后续跟进的 non-blocking follow-up**:
  1. **R2**: 修正 `workspace.md:4` reference 行号 `hp-absorbed-routes.ts:67-133`
  2. **R3**: 在 HPX6 `tests/binding-presence.test.ts` 中加 filesystem-core `readTempFile` RPC 断言;或在 HPX5 closure §5 中显式登记 workspace bytes GET 的 filesystem-core RPC 部署前提
  3. **R4**: `readTempFile` 调用前加 `size_bytes` pre-check 参数
  4. **R5**: `client-cookbook.md` 加内部锚点

- **建议的二次审查方式**: `independent reviewer` — 在 HPX6 启动前由另一位 reviewer 复核 R1 的 e2e test 落地并确认 closure §3 的测试表更新

- **实现者回应入口**: `请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

---

## 6. 跨阶段扩大审查

### 6.1 hero-to-pro 全阶段回顾

HPX5 完成后,hero-to-pro 阶段的 11 个 phase (HP0-HP10) 中已完成 HP0-HP7 + HP9 + HPX5,仅剩 HP8 + HP10 两个 closure/hardening phase 以及 HPX6 workbench phase。当前代码基线的全局态势:

- **已落地的核心能力**: session lifecycle (HP0)、DDL schema (HP1)、model 状态机 (HP2)、context 状态机 (HP3)、chat 生命周期 (HP4)、confirmation control plane (HP5)、tool/workspace 状态机 (HP6)、checkpoint substrate (HP7)、API docs 18→19 pack (HP9)、WS 实时 emit (HPX5)
- **awaiting HPX6**: tool-calls D1 ledger (F6)、followup_input public WS (F8)、runtime config object (F9)、permission rules (F10)、retry executor (F11)、restore executor (F12)、fork executor (F13)、item projection (F14)、file_change item (F15)
- **awaiting HP8/HP10**: F14 R28 deploy bug、F15 R29 postmortem、F4 Lane E 终态、e2e 文件落地、chronic deferrals 收口、final closure

HPX5 的 7 项功能正确地填补了 HP1-HP9 之间的 **时序完整性缺口** — 确认、todo、fallback、compact 等 schema-frozen 能力现在有了真实的 runtime 行为。这是 hero-to-pro 阶段从 "schema 正确" 到 "runtime 行为" 的关键转折点。

### 6.2 命名规范与执行逻辑检查

全局跨包扫描发现了以下命名/逻辑问题 (非 HPX5 引入,但影响后续阶段):

1. **`D1ConfirmationControlPlane.markSupersededOnDualWriteFailure`** (`confirmation-control-plane.ts:271-292`) 的 `attempted_decision` 参数类型为 `Record<string, unknown> | null`,但在 `superseded` decision_payload 中包含了 `attempted_status` / `attempted_decision` / `failure_reason` / `superseded_at` 四个字段 — 这对 HPX5 的实现无影响,但 HPX6 F10 (permission rules) 如果需要读 `superseded` row 的原始 intent,需要注意这个嵌套结构。

2. **`user-do/surface-runtime.ts` 的 `emitServerFrame` 接口签名**: closure 声明 "legacy callers pass already-shaped frames",但当前代码中 `emitServerFrame` 的调用方 (surface-runtime.ts) 传入的是 `{ kind: "session.confirmation.request", confirmation_uuid, confirmation_kind, payload, created_at }` — 这些字段的命名 (`kind` / `confirmation_kind`) 与 `messages.ts` 的 `SESSION_BODY_SCHEMAS` 中定义的 frame body shape 不完全对应 (`SESSION_BODY_SCHEMAS` 中 `session.confirmation.request` 的 schema 是 `SessionConfirmationRequestBodySchema`)。需要在 HPX6 中统一确认 `emitServerFrame` 接收的 frame shape 与 `SessionWebSocketHelper.pushFrame` 期望的 body shape 之间的映射关系。

---

## 附录

### A. 审查过程中执行的 bash 命令

```bash
# 文档一致性 CI gate 执行
node scripts/check-docs-consistency.mjs  # OK: 19 docs pass 4 consistency checks

# 交叉验证
grep -rn "effective_model_id" clients/api-docs/  # 4 hits, 全部是非 model.fallback 上下文
grep -rn "session_status.*running" clients/api-docs/  # 0 hits
grep -r "content_source.*filesystem-core-leaf-rpc-pending" clients/api-docs/  # 0 hits
grep -rn "index\.ts:" clients/api-docs/  # 无旧格式失效引用
```

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-05-02 | DeepSeek | 初稿: 基于一手代码 review + action-plan §9 工作日志 + closure 声明对照的完整审查 |
