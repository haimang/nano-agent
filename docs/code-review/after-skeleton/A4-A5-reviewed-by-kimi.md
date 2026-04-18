# Nano-Agent 代码审查模板

> 审查对象: `A4-session-edge-closure + A5-external-seam-closure`
> 审查时间: `2026-04-18`
> 审查人: `Kimi (k2p5)`
> 审查范围:
> - `docs/action-plan/after-skeleton/A4-session-edge-closure.md`
> - `docs/action-plan/after-skeleton/A5-external-seam-closure.md`
> - `docs/design/after-skeleton/P3-session-edge-closure.md`
> - `docs/design/after-skeleton/P4-external-seam-closure.md`
> - `packages/session-do-runtime/src/{session-edge,turn-ingress,ws-controller,http-controller,do/nano-session-do,remote-bindings,cross-seam,env,composition}.ts`
> - `packages/hooks/src/runtimes/service-binding.ts`
> - `test/fixtures/external-seams/{fake-provider-worker,fake-hook-worker,fake-capability-worker}.ts`
> - `test/external-seam-closure-contract.test.mjs`
> - `context/{codex/codex-rs/tools/src/tool_registry_plan.rs,claude-code/services/tools/toolExecution.ts,just-bash/src/Bash.ts}`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：A4 session edge closure 与 A5 external seam closure 的核心交付物全部落地，代码质量高，测试闭环完整，跨包契约清晰。但存在两处 trace 连续性风险（HTTP fallback 生成独立 trace_uuid）与一处 service-binding URL 语义困惑，以及若干文档数字同步问题。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. A4 成功将 `nacp-session` 的 frozen truth 消费为 session-do-runtime 的唯一主路径：`normalizeClientFrame` + role/phase gate + `SessionWebSocketHelper` 全部接线；raw JSON.parse / message_type switch 彻底下线。
  2. A5 的 v1 binding catalog（CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER）与 cross-seam law（trace/tenant propagation + 5-way failure taxonomy + StartupQueue）已冻结，fake worker fixtures 可直接交付 A6 deploy verification。
  3. HTTP fallback 构造的 NacpClientFrame 使用独立 `crypto.randomUUID()` 作为 trace_uuid，未复用 DO 的 `this.traceUuid`，存在 trace 断裂风险；`callBindingJson` / `makeProviderFetcher` 的本地假 URL 缺少注释说明，可能造成 service-binding 语义困惑。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/after-skeleton/A4-session-edge-closure.md`
  - `docs/action-plan/after-skeleton/A5-external-seam-closure.md`
  - `docs/design/after-skeleton/P3-session-edge-closure.md`
  - `docs/design/after-skeleton/P4-external-seam-closure.md`
  - `docs/action-plan/after-skeleton/AX-QNA.md` (Q8, Q9, Q10, Q12)
- **核查实现**：
  - `packages/session-do-runtime/src/{session-edge,turn-ingress,ws-controller,http-controller,do/nano-session-do}.ts`
  - `packages/session-do-runtime/src/{remote-bindings,cross-seam,env,composition}.ts`
  - `packages/hooks/src/runtimes/service-binding.ts`
  - `test/fixtures/external-seams/*.ts`
  - `test/external-seam-closure-contract.test.mjs`
  - `packages/session-do-runtime/test/integration/edge-trace.test.ts`
  - `packages/session-do-runtime/test/do/nano-session-do.test.ts`
  - `packages/session-do-runtime/test/integration/ws-http-fallback.test.ts`
- **执行过的验证**：
  - `pnpm --filter @nano-agent/session-do-runtime test` → 23 files / 309 tests passed
  - `pnpm --filter @nano-agent/hooks test` → 15 files / 132 tests passed
  - `pnpm --filter @nano-agent/llm-wrapper test` → 11 files / 103 tests passed
  - `npm run test:cross` → 14/14 e2e passed
  - `node --test test/external-seam-closure-contract.test.mjs` → 10/10 passed

### 1.1 已确认的正面事实

- A4 `session-edge.ts`（188 行）完整封装 `normalizeClientFrame` + `validateSessionFrame` + `assertSessionRoleAllowed` + `assertSessionPhaseAllowed`，产出 5 种 `IngressRejectionReason`（`invalid-json`, `schema-invalid`, `phase-illegal`, `role-illegal`, `internal`）。
- A4 `turn-ingress.ts` 正确消费 `session.followup_input`，移除 `future-prompt-family` placeholder，`TURN_INGRESS_NOTE` 明确双路径语义。
- A4 `ws-controller.ts` 从 stub 升级为真实 façade：`WsUpgradeOutcome` 带 `missing-session-id / invalid-session-id` 拒绝原因，`attachHooks` 允许 DO 绑定 `onMessage` / `onClose`。
- A4 `NanoSessionDO` 的 `acceptClientFrame` 成为 WS 与 HTTP fallback 的唯一入口；`dispatchAdmissibleFrame` 对 `session.start` / `session.followup_input` 实现 single-active-turn（`pendingInputs` 队列）。
- A4 `SessionWebSocketHelper` 懒构造并集中管理 replay/ack/heartbeat/checkpoint/restore；`session.resume` 使用 helper `restore` + `handleResume`；checkpoint 保存前调用 helper `checkpoint()`。
- A4 `HttpController` 注入 `HttpDispatchHost` 后，`start/input/cancel` 构造真实 NacpClientFrame 走 `acceptClientFrame`；`end` 返回 405（client 不能发 `session.end`）；`status` / `timeline` 读真实 actor state / replay buffer。
- A4 `emitEdgeTrace` 在 attach / resume / detach 发出 `session.edge.*` 事件，通过 `SubsystemHandles.eval.emit` 进入 A3 的 eval-observability sink；`edge-trace.test.ts` 3 cases 验证 `validateTraceEvent` 通过。
- A5 `env.ts` 新增 `CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER` 三个 optional binding，`V1_BINDING_CATALOG` / `RESERVED_BINDINGS` 明确区分；`SKILL_WORKERS` 标记 `@deprecated` 且不进入 composition。
- A5 `composition.ts` 的 `resolveCompositionProfile` 优先级：`config.compositionProfile` → env 自动探测 → `DEFAULT_COMPOSITION_PROFILE`；`SubsystemHandles` 新增 `profile` 字段。
- A5 `remote-bindings.ts` 提供 `callBindingJson` / `makeHookTransport` / `makeCapabilityTransport` / `makeProviderFetcher` / `makeRemoteBindingsFactory`，把 v1 catalog 映射到子系统 transport 形状。
- A5 `hooks/src/runtimes/service-binding.ts` 从 throw stub 升级为 transport-driven 实现，暴露 `HookTransport / HookRuntimeError / HookRuntimeFailureReason`；缺 transport 时抛 `not-connected`。
- A5 fake worker fixtures（provider/hook/capability）均支持 `default.fetch` 入口与模式切换（`mode=full|stream|error|cancel|continue|block|throw|delay|ok`），可直接被 A6 wrangler 装配。
- A5 `cross-seam.ts` 冻结 `CrossSeamAnchor` + `CROSS_SEAM_HEADERS` + `buildCrossSeamHeaders` / `readCrossSeamHeaders` / `validateCrossSeamAnchor`；`CROSS_SEAM_FAILURE_REASONS` 5 项枚举统一三条 seam 的失败语义；`StartupQueue<T>` 实现 buffer → `markReady` replay / `drop` + `not-ready` 拒绝。
- 测试全面通过：309 (session-do-runtime) + 132 (hooks) + 103 (llm-wrapper) + 14 e2e + 10 external-seam-contract 全部绿色。

### 1.2 已确认的负面事实

- `http-controller.ts:133` 的 `buildClientFrame` 自己生成 `trace_uuid: crypto.randomUUID()`，未复用 DO 的 `this.traceUuid`，也未从 DO 获取 trace 上下文。同一 session 在 WS 与 HTTP fallback 之间会产生不同的 trace identity。
- `callBindingJson` 构造的 Request URL 是 `https://binding.local${path}`，`makeProviderFetcher` 重写为 `https://fake-provider.local${path}`。虽然 service-binding 的 `fetch` 实现通常忽略 URL host，但代码中无注释说明这一点。
- A4 action-plan §11.3 报告 `20 files / 274 tests passed`，实际运行为 `23 files / 309 tests passed`（差异来自 A5 新增的 `remote-bindings`, `cross-seam`, `composition-profile` 测试）。
- P3 design doc §8.4 引用的反例代码行号（`nano-session-do.ts:194-258`, `ws-controller.ts:18-56`, `http-controller.ts:32-102`）对应 pre-A4 代码位置，A4 重写后文件结构已变化。

---

## 2. 审查发现

### R1. HTTP fallback 构造的 NacpClientFrame 使用独立 trace_uuid，未复用 DO 的 traceUuid

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/session-do-runtime/src/http-controller.ts:121-138` `buildClientFrame`：
    ```ts
    trace: {
      trace_uuid: crypto.randomUUID(),
      session_uuid: sessionId,
    },
    ```
  - `packages/session-do-runtime/src/do/nano-session-do.ts:442` `ensureWsHelper` 中 `this.traceUuid = crypto.randomUUID()` 是 DO 级别的 trace identity。
  - DO 的 `emitEdgeTrace` 始终使用 `this.traceUuid`，但 HTTP fallback 输入的 frame 携带的是另一个 UUID。
- **为什么重要**：A3 trace law 要求 traceUuid 是 "canonical trace identity"。如果同一 session 的 WS 连接和 HTTP fallback 调用落在不同 trace 上，跨 transport 的 trace correlation 会断裂。 Observability pipeline 会把它们当成两条独立链路。
- **审查判断**：A4 实现了 "HTTP fallback 共享同一 actor/session model"，但 trace identity 未共享。这是 A4 scope 内的 partial completion。
- **建议修法**：在 DO 的 `fetch()` 中注入 host 时，把 `this.traceUuid` 传递给 `HttpController`，让 `buildClientFrame` 复用 DO 的 traceUuid 而不是自己生成。如果 DO 尚无 traceUuid（首次请求就是 HTTP fallback），可让 DO 先初始化 traceUuid 再构造 frame。

### R2. service-binding URL 使用假 host，缺少语义注释

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `packages/session-do-runtime/src/remote-bindings.ts:56` `callBindingJson`：
    ```ts
    const req = new Request(`https://binding.local${path}`, { ... });
    ```
  - `packages/session-do-runtime/src/remote-bindings.ts:193` `makeProviderFetcher`：
    ```ts
    const request = new Request(`https://fake-provider.local${path}`, init);
    ```
- **为什么重要**：新贡献者看到 `https://binding.local` 会误以为这是一个真实可解析的 URL。service-binding 的 `fetch` 在 Cloudflare Workers 中是一个特殊 API，其 Request URL 通常仅作为路径携带者，实际路由由 platform 的 binding 映射处理。缺少注释会导致困惑和潜在的 URL 构造错误。
- **审查判断**：功能上正确，但代码可读性/可维护性受损。
- **建议修法**：在 `callBindingJson` 和 `makeProviderFetcher` 的 Request 构造处添加注释，明确说明 "URL host is a placeholder; service-binding fetch routing is handled by the Workers platform binding table, not DNS resolution"。

### R3. A4 action-plan §11.3 测试数字与实际运行结果不一致

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - A4 §11.3 报告：`session-do-runtime test` — `20 files / 274 tests passed`。
  - 实际运行：`23 files / 309 tests passed`。
- **为什么重要**：action-plan 是执行记录，数字不一致会让后续审查者怀疑文档是否覆盖最新代码。差异来源是 A5 新增了 3 个测试文件（`remote-bindings.test.ts` 12 cases + `cross-seam.test.ts` 13 cases + `composition-profile.test.ts` 10 cases = 35 cases），274 + 35 = 309。
- **审查判断**：A4 执行时的数字是正确的，但 A5 执行后未回溯更新 A4 文档。
- **建议修法**：在 A4 action-plan §11.3 追加更新说明，或建立 action-plan 数字与实际测试输出自动同步的纪律。

### R4. P3 design doc §8.4 反例代码引用行号已过时

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - P3 design doc §8.4 引用 `packages/session-do-runtime/src/do/nano-session-do.ts:194-258`（raw JSON.parse + message_type switch）。
  - A4 重写后 `nano-session-do.ts` 为 777 行，`webSocketMessage` 在 261-274 行，已完全不同。
- **为什么重要**：设计文档中的代码引用是新贡献者理解系统的入口，过时引用会造成困惑。
- **审查判断**：文档内容本身正确，仅引用位置需要更新。
- **建议修法**：更新 P3 design doc §8.4 的代码引用行号，或在文档中说明 "pre-A4 code locations; refer to current source for latest structure"。

### R5. `makeRemoteBindingsFactory` 未在 `NanoSessionDO` 默认路径中被使用

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - `packages/session-do-runtime/src/do/nano-session-do.ts:129` `constructor` 的默认参数是 `createDefaultCompositionFactory()`，不是 `makeRemoteBindingsFactory()`。
  - A5 §11.4 复盘已指出这一点："`makeRemoteBindingsFactory()` 尚未在 `NanoSessionDO.constructor` 的默认路径中被选用（仍使用 `createDefaultCompositionFactory`）。这是 Phase 1 '不抢 DO 行为' 的刻意留白；A6 deploy 时会通过 `worker.ts` 的 env 读入选择合适的 factory。"
- **为什么重要**：当前 DO 的默认路径仍然是全 local stub，remote seam 只在显式注入 factory 时生效。虽然这是设计意图，但如果 A6 忘记切换 factory，deploy 后的 runtime 仍然是全 local。
- **审查判断**： intentional 留白，但需要在 A6 action-plan 中明确记录为启动条件。
- **建议修法**：在 A6 action-plan 中增加启动条件检查项："确认 `worker.ts` 或 deploy profile 已将 `makeRemoteBindingsFactory()` 注入 `NanoSessionDO` 构造函数"。

### R6. fake provider worker 的 SSE stream 缺少 `streamDelayMs` 实现

- **严重级别**：`low`
- **类型**：`scope-drift`（实际上是未实现的配置项）
- **事实依据**：
  - `test/fixtures/external-seams/fake-provider-worker.ts:33-34` 定义了 `streamDelayMs?: number`。
  - `buildStreamChunks` 和 `buildStreamBody` 均未使用 `streamDelayMs`。
- **为什么重要**：`streamDelayMs` 在接口中声明但未被消费，属于 dead config。测试和 smoke 中无法模拟 provider 的延迟行为。
- **审查判断**：不影响核心功能，但 config 接口不完整。
- **建议修法**：在 `buildStreamBody` 或 `fakeProviderFetch` 的 `stream` 分支中加入 `streamDelayMs` 的 `setTimeout` 模拟，或从 `FakeProviderOptions` 中移除该字段以避免误导。

---

## 3. In-Scope 逐项对齐审核

### A4 In-Scope

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 消费 `normalizeClientFrame()` 的 normalized ingress 主路径 | `done` | `session-edge.ts:90-188` |
| S2 | `SessionWebSocketHelper` 装配到 Session DO | `done` | `nano-session-do.ts:432-454` |
| S3 | `HttpController` 成为 WS-first session model 的 transport fallback | `done` | `http-controller.ts:62-238` |
| S4 | widened session ingress 上维持 single-active-turn | `done` | `nano-session-do.ts:318-328` |
| S5 | edge-side attach/resume/replay/health 进入 trace-first | `done` | `nano-session-do.ts:476-506` + `edge-trace.test.ts` |

### A5 In-Scope

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S6 | binding catalog freeze (CAPABILITY/HOOK/FAKE_PROVIDER) | `done` | `env.ts:61-63` + `V1_BINDING_CATALOG` |
| S7 | `SKILL_WORKERS` 保留为 reserved seam | `done` | `env.ts:67` `@deprecated` + `RESERVED_BINDINGS` |
| S8 | hook `ServiceBindingRuntime` 从 stub 提升为真实 remote | `done` | `hooks/src/runtimes/service-binding.ts:93-153` |
| S9 | capability remote path 成为 session runtime 可装配 reality | `done` | `remote-bindings.ts:135-167` + fake-capability-worker |
| S10 | fake provider worker 闭合 remote provider boundary | `done` | `test/fixtures/external-seams/fake-provider-worker.ts` |
| S11 | cross-seam trace/tenant/request propagation law | `done` | `cross-seam.ts:33-119` |
| S12 | failure/timeout/cancel/fallback 语义统一 | `done` | `cross-seam.ts:130-200` + `CROSS_SEAM_FAILURE_REASONS` |
| S13 | startup queue / early event guard | `done` | `cross-seam.ts:215-285` + `external-seam-closure-contract.test.mjs:177-199` |
| S14 | local reference path 保留 | `done` | `DEFAULT_COMPOSITION_PROFILE` 全 local，`llm-wrapper` local-fetch 测试继续通过 |

### 3.1 对齐结论

- **done**: `14`
- **partial**: `0`
- **missing**: `0`

> A4 与 A5 的核心交付物全部落地，测试与文档形成最小证据闭环。代码质量高，跨包契约清晰。

---

## 4. Out-of-Scope 核查

### A4 Out-of-Scope

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | follow-up queue / replace / merge 的完整产品语义 | `遵守` | `pendingInputs` 仅做最小队列，无 replace/merge |
| O2 | multi-client attach / observer mode | `遵守` | 单 stream "main"，无 observer |
| O3 | public SDK / frontend-facing product API | `遵守` | 无 SDK 实现 |
| O4 | external seam/service-binding worker closure（属 A5） | `遵守` | A4 不触及 external seam |

### A5 Out-of-Scope

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O5 | skill worker runtime / registry / discovery | `遵守` | `SKILL_WORKERS` 显式 reserved，未进入 composition |
| O6 | 真正的 inference gateway 平台 | `遵守` | fake provider 仅用于 boundary proof |
| O7 | HTTP callback transport | `遵守` | 仅 service-binding JSON-over-fetch |
| O8 | browser-rendering / compact worker 等更多 remote worker | `遵守` | 无相关 binding |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`approve-with-followups`
- **是否允许关闭本轮 review**：`yes`
- **关闭前必须完成的 blocker**：无
- **可以后续跟进的 non-blocking follow-up**：
  1. **R1** — HTTP fallback `buildClientFrame` 复用 DO 的 `traceUuid`（中危，建议 A6 deploy 前修复）。
  2. **R2** — `callBindingJson` / `makeProviderFetcher` 的假 URL 添加语义注释（低危，纯文档）。
  3. **R3** — A4 action-plan §11.3 测试数字更新（低危，纯文档）。
  4. **R4** — P3 design doc §8.4 代码引用行号同步（低危，纯文档）。
  5. **R5** — 在 A6 action-plan 中明确 `makeRemoteBindingsFactory` 注入检查项（低危，流程纪律）。
  6. **R6** — fake provider worker 的 `streamDelayMs` 实现或移除（低危，config 完整性）。
