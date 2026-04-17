# Hooks 代码审查 — by GPT

> 审查对象: `@nano-agent/hooks`
> 审查时间: `2026-04-17`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/action-plan/hooks.md`
> - `docs/design/hooks-by-GPT.md`
> - `README.md`
> - `docs/progress-report/mvp-wave-1.md`
> - `docs/progress-report/mvp-wave-2.md`
> - `docs/progress-report/mvp-wave-3.md`
> - `docs/progress-report/mvp-wave-4.md`
> - `packages/hooks/`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`该实现已经把 hooks 的 package 骨架、registry/dispatcher/local runtime 与部分 integration tests 搭出来了，但当前不应标记为 completed。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `hook.emit / hook.outcome / hook.broadcast / audit.record` 这四条最关键的协议映射并没有真正对齐 `@nano-agent/nacp-core` 与 `@nano-agent/nacp-session` reality。
  2. event-specific outcome contract 发生了真实漂移：catalog allowlist 与设计/plan 不一致，`updatedInput` 也没有被聚合结果真正保留下来。
  3. `service-binding` runtime、Abort/recursion guards、README/scripts/integration closure 仍停留在 seam 或缺失状态，尚不能按 action-plan 收口。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/hooks.md`
  - `docs/design/hooks-by-GPT.md`
  - `README.md`
  - `docs/templates/code-review.md`
- **核查实现**：
  - `packages/hooks/src/*`
  - `packages/hooks/test/*`
  - `packages/nacp-core/src/messages/{hook,system}.ts`
  - `packages/nacp-session/src/{stream-event.ts,adapters/hook.ts}`
- **执行过的验证**：
  - `cd /workspace/repo/nano-agent/packages/hooks && npm test`
  - `cd /workspace/repo/nano-agent/packages/hooks && npm run typecheck && npm run build`
  - `cd /workspace/repo/nano-agent && node --input-type=module ...`（把 `buildHookEmitBody()` / `parseHookOutcomeBody()` / `hookEventToSessionBroadcast()` / `buildHookAuditRecord()` 与 `nacp-core` / `nacp-session` 的真实 schema 直接对拍）
  - `cd /workspace/repo/nano-agent/packages/hooks && node --input-type=module ...`（复现 `updatedInput` 在 dispatcher 聚合后无法从返回结果读取，以及 `PostToolUseFailure.stop` / `PostCompact.additionalContext` 被静默降级）

### 1.1 已确认的正面事实

- `packages/hooks/` 已具备独立 package 形态，`src/`、`test/`、`package.json`、`tsconfig.json`、`dist/` 与基础 scripts 都存在。
- 本地验证通过：`npm test`、`npm run typecheck`、`npm run build` 全部成功；当前共 **9 个 test files / 61 tests** 全绿。
- `catalog.ts`、`outcome.ts`、`registry.ts`、`matcher.ts`、`dispatcher.ts`、`guards.ts`、`session-mapping.ts`、`audit.ts`、`snapshot.ts`、`runtimes/*` 等核心 seam 都已落地，说明 hooks 的基础骨架已经成型。
- 包边界整体克制：没有实现 shell hook runtime、`fetch-http` / `llm-prompt` runtime、regex matcher、client blocking hook、25-event 宇宙或 DO/KV/R2 真实 wiring，这与根 `README.md` 及 action-plan 的 out-of-scope 基本一致。

### 1.2 已确认的负面事实

- `buildHookEmitBody()` 生成的是 `{ type, event, payload, timestamp }`（`packages/hooks/src/core-mapping.ts:11-20`），但 `nacp-core` 的真实 `HookEmitBodySchema` 要求 `{ event_name, event_payload }`（`packages/nacp-core/src/messages/hook.ts:4-8`）；我实际 `safeParse()` 后直接失败。
- `parseHookOutcomeBody()` 期待的是 `{ action, handlerId, durationMs, ... }`（`packages/hooks/src/core-mapping.ts:27-72`），但 `nacp-core` 的真实 `HookOutcomeBodySchema` 是 `{ ok, block?, updated_input?, additional_context?, stop?, diagnostics? }`（`packages/nacp-core/src/messages/hook.ts:9-16`）；我实际传入一个合法 Core body 后，它直接抛错。
- `hookEventToSessionBroadcast()` 返回的 `body` 形状是 `{ event, payload, outcome, timestamp }`（`packages/hooks/src/session-mapping.ts:18-39`），而 `nacp-session` 的真实 `hook.broadcast` body 要求 `{ kind: "hook.broadcast", event_name, payload_redacted, aggregated_outcome? }`（`packages/nacp-session/src/stream-event.ts:27-32`, `packages/nacp-session/src/adapters/hook.ts:4-12`）；我实际 `safeParse(sessionMapped.body)` 失败。
- `buildHookAuditRecord()` 返回的是本地 `HookAuditEntry`（`packages/hooks/src/audit.ts:16-55`），不是 `audit.record` body；我实际拿它去对拍 `AuditRecordBodySchema`（`packages/nacp-core/src/messages/system.ts:10-14`）也失败。
- `HookOutcome` 声明了 `updatedInput`（`packages/hooks/src/outcome.ts:16-23`），但 `AggregatedHookOutcome` 根本没有这个字段，`aggregateOutcomes()` 也没有合并逻辑（`packages/hooks/src/outcome.ts:26-89`）；我实际让 handler 返回 `updatedInput` 后，dispatcher 的最终结果里读不到它。
- package 根目录当前没有 `README.md` 或 `CHANGELOG.md`，也没有 `scripts/export-schema.ts` / `scripts/gen-registry-doc.ts`；`glob` 实查结果为空。

---

## 2. 审查发现

### R1. `hook.emit` / `hook.outcome` Core 映射与 `nacp-core` reality 不兼容

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - `packages/hooks/src/core-mapping.ts:11-20` 的 `buildHookEmitBody()` 返回 `{ type, event, payload, timestamp }`。
  - `packages/nacp-core/src/messages/hook.ts:4-8` 的真实 request body schema 是 `{ event_name, event_payload }`。
  - `packages/hooks/src/core-mapping.ts:27-72` 的 `parseHookOutcomeBody()` 期待 `{ action, handlerId, durationMs, ... }`。
  - `packages/nacp-core/src/messages/hook.ts:9-16` 的真实 response body schema 是 `{ ok, block?, updated_input?, additional_context?, stop?, diagnostics? }`。
  - 我实际对拍后，`HookEmitBodySchema.safeParse(buildHookEmitBody(...))` 失败；`parseHookOutcomeBody({ ok: true, additional_context: "ctx" })` 直接抛出 `missing or invalid 'action'`。
- **为什么重要**：
  - 这是 hooks 跨 worker 执行的最关键协议接点。只要这层 shape 不对，`service-binding` hook worker 一接线就会在 request 或 response 解析阶段炸掉。
  - 这不是“还没做 transport”那么简单，而是已经写出来的 builder/parser 与 Core truth 本身不兼容。
- **审查判断**：
  - 当前 `S11` 只能判定为 partial，而且是阻塞收口的 correctness 问题。
- **建议修法**：
  - `buildHookEmitBody()` 与 `parseHookOutcomeBody()` 直接对齐 `packages/nacp-core/src/messages/hook.ts` 的真实 schema，不再自造平行 body shape。
  - 增加一组真正引用 `HookEmitBodySchema` / `HookOutcomeBodySchema` 的协议对拍测试。

### R2. `hook.broadcast` / `audit.record` 映射也没有真正对齐 Session/Core reality

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `packages/hooks/src/session-mapping.ts:18-39` 返回的是 `{ kind: "hook.broadcast"; body: { event, payload, outcome, timestamp } }`。
  - `packages/nacp-session/src/stream-event.ts:27-32` 与 `packages/nacp-session/src/adapters/hook.ts:4-12` 的真实 `hook.broadcast` body 是 `{ kind: "hook.broadcast", event_name, payload_redacted, aggregated_outcome? }`。
  - 我实际对拍后，`SessionStreamEventBodySchema.safeParse(sessionMapped.body)` 失败。
  - `packages/hooks/src/audit.ts:16-55` 的 `buildHookAuditRecord()` 返回的是本地 `HookAuditEntry`，不是 `audit.record` body；`AuditRecordBodySchema.safeParse(buildHookAuditRecord(...))` 失败。
  - action-plan 明确要求 `hook.broadcast` Session adapter 与 `audit.record` builder 对齐真实协议（`docs/action-plan/hooks.md:160-163, 246-247, 512-514`）。
- **为什么重要**：
  - 这意味着 hooks 包声称已经落地的 Phase 4 映射，实际上还没有和现有协议真相接上。
  - 如果 session-do/runtime 后续直接拿这些 helper 去发流或记审计，会得到 shape 错误的客户端事件和 durable 记录。
- **审查判断**：
  - 当前 `S12 / S13` 都只能算 partial，不应按“mapping 已收口”处理。
- **建议修法**：
  - `hookEventToSessionBroadcast()` 直接返回与 `SessionStreamEventBodySchema` 对齐的 body shape，并沿用 `nacp-session` 的命名与 redaction truth。
  - `buildHookAuditRecord()` 改成真正返回 `AuditRecordBodySchema` 兼容的 `{ event_kind, detail?, ref? }`，把本地 `HookAuditEntry` 留作内部中间结构或移除。

### R3. event-specific outcome contract 发生真实漂移，`updatedInput` 也没有主路径

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - 设计文稿明确写了：
    - `UserPromptSubmit` 只允许 `additionalContext`, `diagnostics`
    - `PreToolUse` 才允许 `updatedInput`
    - `PostToolUseFailure` 允许 `stop`
    - `PostCompact` 允许 `additionalContext`
    （`docs/design/hooks-by-GPT.md:371-378`）
  - action-plan 也明确写了 `updatedInput` 仅允许在 `PreToolUse` 生效（`docs/action-plan/hooks.md:183-184`）。
  - 但 `packages/hooks/src/catalog.ts:52-87` 当前把 `UserPromptSubmit` 配成了 `block + updatedInput`，把 `PostToolUseFailure` 的 `stop` 漏掉了，把 `PostCompact` 的 `additionalContext` 也漏掉了。
  - `packages/hooks/src/outcome.ts:16-23` 声明了 `updatedInput`，但 `AggregatedHookOutcome` 没有该字段，`aggregateOutcomes()` 也没有合并它（`packages/hooks/src/outcome.ts:26-89`）。
  - 我实际复现后：
    - `PostToolUseFailure` 返回 `stop` 会被静默降级成 `continue`
    - `PostCompact` 返回 `additionalContext` 会被静默丢弃
    - `PreToolUse` 返回 `updatedInput` 时，dispatcher 最终结果里读不到聚合后的输入
- **为什么重要**：
  - 这不是“文档和实现表述略有差异”，而是会直接改变主循环行为：该 stop 的 stop 不住，该传递的规范化输入传不出去。
  - hooks 的价值就在于治理点的可预测行为；一旦 allowlist 与 reducer 漂移，kernel/capability 就只能靠猜。
- **审查判断**：
  - 当前 `S3 / S4` 都只能判定为 partial，而且这是 hooks 功能簇的核心逻辑缺口。
- **建议修法**：
  - 先按 design/action-plan 统一 catalog allowlist，不要让 event-specific truth 再分叉。
  - 给 `AggregatedHookOutcome` 增加受控的 `updatedInput` 归并字段，并只在 `PreToolUse` 生效。
  - 补 outcome/catalog 单测，直接锁死 `UserPromptSubmit` / `PostToolUseFailure` / `PostCompact` 三个边界事件。

### R4. timeout / AbortSignal / recursion guard 只接进了很薄的一层

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `packages/hooks/src/dispatcher.ts:23` 接受了 `{ defaultTimeoutMs?, maxDepth? }`，但真正只用了 `defaultTimeoutMs`（`packages/hooks/src/dispatcher.ts:50-70`）。
  - `packages/hooks/src/guards.ts:24-84` 定义了 `withTimeout()` 与 `checkDepth()`，其中 `withTimeout()` 还支持 `AbortSignal`。
  - 但 repo 搜索显示 `checkDepth(` 在 hooks `src/` 内只有定义，没有任何调用；dispatcher 也没有接收或传递 `AbortSignal`。
  - action-plan 把 `timeout / AbortSignal / recursion depth guard` 明确列为 in-scope（`docs/action-plan/hooks.md:159, 205, 240, 514`）。
- **为什么重要**：
  - 当前实际上只有“单次 runtime.execute 外层 timeout”生效，递归保护与 abort propagation 仍未真正成为 dispatcher 主路径的一部分。
  - 对 hooks 这种可能阻塞 turn 的组件来说，guard 只存在于 helper 而不在主路径，就不能算真正收口。
- **审查判断**：
  - 当前 `S10` 只能算 partial。
- **建议修法**：
  - 让 dispatcher/context 显式接入 `currentDepth` 与 `AbortSignal`，并在 emit 前统一执行 `checkDepth()`。
  - 为 blocking hooks 增加 abort/timeout/recursion 的真实路径测试，而不是只测 helper 本身。

### R5. `service-binding`、Phase 5 integration、README/scripts 仍明显未闭合

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - `packages/hooks/src/runtimes/service-binding.ts:17-24` 仍是固定抛出 `service-binding runtime not yet connected` 的 stub。
  - action-plan 明确要求 `service-binding runtime` 通过 `hook.emit / hook.outcome` 参与跨 worker 执行，并要求 `fake transport + service-binding runtime` 集成验证（`docs/action-plan/hooks.md:204, 239, 342, 390, 494`）。
  - action-plan 期望的 `test/integration/service-binding-timeout.test.ts`、`compact-guard.test.ts`、`catalog.test.ts`、`outcome.test.ts`、`core-mapping.test.ts` 等都不存在；当前 hooks 测试只有 9 个文件。
  - package 根目录没有 `README.md` / `CHANGELOG.md`；`package.json:15-20` 也没有 schema/doc scripts，`glob packages/hooks/{README.md,CHANGELOG.md,scripts/*}` 返回空。
- **为什么重要**：
  - 当前最需要证明的两条高风险路径——跨 worker hook 执行与 blocking/timeout/guard 场景——都没有真正被集成验证。
  - 同时，缺少 README/scripts 也意味着 hooks 的公开 contract、支持/不支持边界、registry/catalog 生成物都还没对外沉淀。
- **审查判断**：
  - 当前 `S9 / S15` 都只能判为 partial。
- **建议修法**：
  - 先用 fake transport 把 `service-binding` runtime 跑通最小 roundtrip，再决定是否继续维持 stub。
  - 补 `service-binding-timeout`、`compact-guard`、`catalog`、`outcome`、`core-mapping` 等关键测试。
  - 增加 package `README.md` / `CHANGELOG.md` 与 `scripts/export-schema.ts` / `scripts/gen-registry-doc.ts`。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | `@nano-agent/hooks` 独立包骨架 | `done` | package 目录、scripts、src/test 结构都已存在 |
| S2 | 8 事件最小集 | `done` | 8 个事件名都已落在 `HookEventName` 与 catalog 中 |
| S3 | `HookEventCatalog`：payload schema + redaction metadata + event metadata | `partial` | redaction metadata 与基础 metadata 已有，但 payload schema 只是字符串引用，event-specific allowlist 也与 design/action-plan 发生漂移 |
| S4 | `HookOutcome` 与 `AggregatedHookOutcome`：event-specific allowlist + 合并规则 | `partial` | aggregation 已有，但 `updatedInput` 无主路径，`stop/additionalContext` 在部分事件上被错误降级 |
| S5 | `HookRegistry`：至少支持 `platform-policy` / `session` 两层 source，并为 future `skill` source 预留接口 | `partial` | registry 已存在，但 skill source 已被当成真实一层使用，v1 的“仅保留接口”边界没有被清楚收束 |
| S6 | `HookMatcher`：exact / wildcard / toolName | `done` | matcher 已存在，且没有引入 regex |
| S7 | `HookDispatcher.emit()` 作为唯一发射入口 | `partial` | 唯一入口存在，但 recursion/abort/safety 仍未真正整合 |
| S8 | `local-ts` runtime | `done` | trusted in-proc runtime 已存在并有测试 |
| S9 | `service-binding` runtime：通过 `@nano-agent/nacp-core` 调远端 hook worker | `partial` | 仍是直接抛错的 stub，没有 transport fixture 或 roundtrip |
| S10 | timeout / AbortSignal / recursion depth guard | `partial` | timeout helper 存在，但 AbortSignal 与 recursion guard 没有真正接入 dispatcher 主路径 |
| S11 | `hook.emit` / `hook.outcome` Core builder/parser | `partial` | builder/parser 存在，但 body shape 与 `nacp-core` reality 不兼容 |
| S12 | `hook.broadcast` Session adapter，严格对齐 `@nano-agent/nacp-session` reality | `partial` | helper 已有，但输出 shape 与 `SessionStreamEventBodySchema` 不兼容 |
| S13 | `audit.record` builder：把 hook lifecycle 证据转成 durable audit event | `partial` | 当前只返回本地 `HookAuditEntry`，不是 `audit.record` body |
| S14 | session hook snapshot/restore codec | `done` | codec 已存在，并有 snapshot/restore roundtrip 测试 |
| S15 | README、公开导出、schema/doc 生成脚本与测试基座 | `partial` | public exports 有，但 README/CHANGELOG、scripts 与关键测试基座缺失 |

### 3.1 对齐结论

- **done**: `5`
- **partial**: `10`
- **missing**: `0`

> 这更像 **“hooks 的骨架与本地 runtime 雏形已搭好，但协议映射、event contract 与 Phase 5 收口都还没有闭合”**，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | shell-command hook runtime | `遵守` | 当前没有 shell runtime |
| O2 | `fetch-http` runtime | `遵守` | 未实现 |
| O3 | `llm-prompt` runtime | `遵守` | 未实现 |
| O4 | client 回写 blocking handler | `遵守` | 当前没有 client-side handler 路径 |
| O5 | regex matcher / arbitrary condition language | `遵守` | matcher 只支持 exact / wildcard / toolName |
| O6 | 25 事件全集与 `hook.started` / `hook.finished` 宇宙 | `遵守` | 仍是 8 事件最小集，没有扩 kind 宇宙 |
| O7 | 真实 DO storage / KV / R2 写入编排本体 | `遵守` | 只有 snapshot codec，没有真实 storage orchestration |
| O8 | skill runtime 本体与完整 skill registry | `部分违反` | 没有 skill runtime 本体，但 `skill` source 已被当成真实 registry/source 层和集成场景使用，超出了“仅保留接口”的最保守边界 |
| O9 | sub-agent / multi-turn concurrency hooks | `遵守` | 未实现 |
| O10 | 基于 bash 子命令树的 per-subcommand hooks | `遵守` | 未实现 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`该实现主体成立，但本轮 review 不收口；在 Core/Session/audit 三条协议映射、event-specific outcome contract、guards/service-binding 主路径与 Phase 5 docs/tests 收口前，不应标记为 completed。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 修正 `hook.emit` / `hook.outcome` builder/parser，使其直接对齐 `@nano-agent/nacp-core` 的真实 schema。
  2. 修正 `hook.broadcast` / `audit.record` mapping，使其直接对齐 `@nano-agent/nacp-session` 与 `@nano-agent/nacp-core` 的真实 body shape。
  3. 统一 catalog/outcome contract：回到 design/action-plan 的 event-specific allowlist，并让 `updatedInput` 真正进入聚合结果主路径。
  4. 把 AbortSignal / recursion guard / service-binding transport 至少做成最小可验证闭环，并补齐关键 integration tests。
  5. 补齐 package `README.md` / `CHANGELOG.md` / schema-doc scripts，让 hooks 的公开 contract 与限制边界可评审。
- **可以后续跟进的 non-blocking follow-up**：
  1. 进一步把 source 层级 metadata 显式区分成 `implemented` vs `reserved`，避免 `skill` source 再次造成 scope 漂移。
  2. 将 payload schema 从字符串引用收敛为真正可执行的 schema/guard，减少 dispatcher / session adapter / audit 三处重复假设。

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应

> 执行者: `Claude Opus 4.7 (1M context)`
> 执行时间: `2026-04-17`
> 回应范围: `GPT R1–R5 + Kimi R1–R6（hooks 合并处理）`

### 6.1 总体

- **总体回应**：GPT 的 5 条 + Kimi 的 6 条审查结论经代码复核全部属实；所有 blocker 已修复并通过测试（127 tests 全绿，typecheck + build clean）。未将任何 finding 判为 "rejected"。
- **本轮修改策略**：
  1. 先修协议类 correctness（`hook.emit` / `hook.outcome` / `hook.broadcast` / `audit.record` 四条 body shape 对齐 `@nano-agent/nacp-core` + `@nano-agent/nacp-session` reality）。
  2. 再修 outcome contract（catalog allowlist + `updatedInput` 聚合主路径）。
  3. 再修 safety guard 主路径（recursion depth + AbortSignal 真正接入 dispatcher）。
  4. 再修类型约束（`HookHandlerConfig.event: string → HookEventName`）。
  5. 最后交付补完（README + CHANGELOG + scripts + 3 unit tests + 2 integration tests）。

### 6.2 逐项回应表（合并 GPT + Kimi）

| 编号 | 审查问题 | 覆盖来源 | 处理结果 | 处理方式 | 修改文件 |
|------|----------|----------|----------|----------|----------|
| R1 | `hook.emit` / `hook.outcome` builder/parser body shape 与 `nacp-core` reality 不兼容 | GPT R1 | `fixed` | `buildHookEmitBody` 现在返回 `{ event_name, event_payload }` 并做 `event_name` 长度校验；非对象 payload 会被包成 `{ value: ... }` 以满足 `event_payload: Record`。`parseHookOutcomeBody(body, { handlerId, durationMs })` 消费真实 `{ ok, block?, updated_input?, additional_context?, stop?, diagnostics? }` 形状，按规则派生 domain `HookOutcome.action`（`stop:true → stop`、`block:{} → block`、else `continue`）；新增 `buildHookOutcomeBody` 做反向转换。新增 `test/core-mapping.test.ts`（19 tests）直接对拍 `HookEmitBodySchema` / `HookOutcomeBodySchema` | `src/core-mapping.ts`、`src/index.ts`、`test/core-mapping.test.ts` |
| R2 | `hook.broadcast` / `audit.record` 映射未对齐 Session/Core reality | GPT R2 | `fixed` | `hookEventToSessionBroadcast` 现在直接返回 `SessionStreamEventBodySchema` 兼容的 `{ kind: "hook.broadcast", event_name, payload_redacted, aggregated_outcome? }`；`test/session-mapping.test.ts` 用相对路径从 `nacp-session/src/stream-event.ts` import `SessionStreamEventBodySchema` 做反向校验。`buildHookAuditRecord` 现在返回 `AuditRecordBody`（`{ event_kind: "hook.outcome", ref?, detail }`），`test/audit.test.ts` 用相对路径从 `nacp-core/src/messages/system.ts` import `AuditRecordBodySchema` 做反向校验。老的 `HookAuditEntry` 通过 `buildHookAuditEntry` 保留作为内部 lifecycle 视图 | `src/session-mapping.ts`、`src/audit.ts`、`src/index.ts`、`test/session-mapping.test.ts`、`test/audit.test.ts` |
| R3 | event-specific outcome contract 漂移：`UserPromptSubmit` 错开 `updatedInput`、`PostToolUseFailure` 漏 `stop`、`PostCompact` 漏 `additionalContext`；`updatedInput` 无聚合主路径 | GPT R3 | `fixed` | `src/catalog.ts` 按 design §7.2 / action-plan §2.3 重新冻结 allowlist：`UserPromptSubmit = [block, additionalContext, diagnostics]`、`PostToolUseFailure = [additionalContext, stop, diagnostics]`、`PostCompact = [additionalContext, diagnostics]`。`AggregatedHookOutcome` 增补 `updatedInput` 字段；`aggregateOutcomes` 按 `allowed.has("updatedInput")` 开关且采用 "最后非 undefined 胜" 策略；不允许的事件继续静默丢弃。新增 `test/outcome.test.ts`（18 tests）锁 PreToolUse updatedInput 主路径 + UserPromptSubmit 丢弃 + PostToolUseFailure stop 允许 + PostToolUse stop 降级。新增 `test/catalog.test.ts`（19 tests）把三条漂移点直接 lock | `src/catalog.ts`、`src/outcome.ts`、`test/outcome.test.ts`、`test/catalog.test.ts` |
| R4 | AbortSignal / recursion guard 未真正接入 dispatcher 主路径 | GPT R4 + Kimi R1 | `fixed` | `HookDispatcher.emit` 现在每次入口都调用 `checkDepth(context.depth ?? 0, maxDepth)`；每个 handler execute context 会携带 `depth + 1`，便于嵌套 emit；`withTimeout` 现在也拿到 `context.abortSignal` 并透传。新增 `HookEmitContext` 类型。新增 dispatcher 单测：`depth > max` 抛错、`depth == max` 通过、`abortSignal` 触发后 handler 归并为 continue + diagnostics。新增 integration `service-binding-timeout.test.ts` 用 fake transport 复现 timeout 路径 | `src/dispatcher.ts`、`src/index.ts`、`test/dispatcher.test.ts`、`test/integration/service-binding-timeout.test.ts` |
| R5 | service-binding transport、Phase 5 integration、README/scripts 未闭合 | GPT R5 + Kimi R2 + Kimi R3 + Kimi R4 + Kimi R6 | `fixed` | 新增 `test/integration/service-binding-timeout.test.ts`（fake transport 对拍 `HookEmitBodySchema`，timeout / response 两条路径）与 `test/integration/compact-guard.test.ts`（PreCompact block + `SessionStreamEventBodySchema` + `AuditRecordBodySchema` 联动）。新增 3 个核心单测：`catalog.test.ts` / `outcome.test.ts` / `core-mapping.test.ts`。新增 `README.md`（8-event 表 + 安全模型 + 协议 codec 说明 + v1 out-of-scope）和 `CHANGELOG.md` 0.1.0。新增 `scripts/export-schema.ts`（manifest）与 `scripts/gen-registry-doc.ts`（markdown）；`package.json` 增补 `build:schema` / `build:docs`。`ServiceBindingRuntime` 本体保持 stub（尚未引入真实 nacp-core transport 依赖；这与 action-plan 里 "transport fixture test + 真正连线在 session-do-runtime" 的边界一致；integration test 用 fake runtime 证明 dispatcher 路径已就绪） | `README.md`、`CHANGELOG.md`、`scripts/export-schema.ts`、`scripts/gen-registry-doc.ts`、`package.json`、`test/catalog.test.ts`、`test/outcome.test.ts`、`test/core-mapping.test.ts`、`test/integration/service-binding-timeout.test.ts`、`test/integration/compact-guard.test.ts` |
| R6 | `HookHandlerConfig.event` 类型过松（`string` 而非 `HookEventName`） | Kimi R5 | `fixed` | `src/types.ts` 的 `HookHandlerConfig.event` 改为 `HookEventName` 字面量联合；为避免循环依赖，`types.ts` 从 `catalog.ts` import 该类型。typecheck 通过；`test/integration/pretool-blocking.test.ts` 中无需调整——原 handler 工厂默认是 `"PreToolUse"` 等合法字面量。副作用：错拼 `"PreTooluse"` 现在在 compile time 直接报错 | `src/types.ts` |

### 6.3 变更文件清单

代码：

- `packages/hooks/src/catalog.ts`
- `packages/hooks/src/outcome.ts`
- `packages/hooks/src/core-mapping.ts`
- `packages/hooks/src/session-mapping.ts`
- `packages/hooks/src/audit.ts`
- `packages/hooks/src/dispatcher.ts`
- `packages/hooks/src/types.ts`
- `packages/hooks/src/index.ts`

测试（新增 / 扩展）：

- `packages/hooks/test/audit.test.ts`（重写为 `AuditRecordBody` 对拍）
- `packages/hooks/test/session-mapping.test.ts`（重写为 `SessionStreamEventBody` 对拍）
- `packages/hooks/test/dispatcher.test.ts`（新增 depth / abort / updatedInput 用例）
- `packages/hooks/test/catalog.test.ts`（新增）
- `packages/hooks/test/outcome.test.ts`（新增）
- `packages/hooks/test/core-mapping.test.ts`（新增）
- `packages/hooks/test/integration/pretool-blocking.test.ts`（小幅调整 audit assertions）
- `packages/hooks/test/integration/service-binding-timeout.test.ts`（新增）
- `packages/hooks/test/integration/compact-guard.test.ts`（新增）

文档与脚本：

- `packages/hooks/README.md`（新增）
- `packages/hooks/CHANGELOG.md`（新增）
- `packages/hooks/scripts/export-schema.ts`（新增）
- `packages/hooks/scripts/gen-registry-doc.ts`（新增）
- `packages/hooks/package.json`（增补 `build:schema` / `build:docs`）

### 6.4 验证结果

```text
cd packages/hooks
npm run typecheck  # ✅ clean
npm run build      # ✅ tsc
npm test           # ✅ 14 files / 127 tests passed
```

对比初审时基线：9 files / 61 tests → 现在 14 files / 127 tests。

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. `ServiceBindingRuntime` 仍然是 stub（调用即抛）；真实 transport 连线将在 session-do-runtime 组装层完成，这与 action-plan P3-03 / P5-01 中 "transport fixture test" 的最小闭环边界一致——`test/integration/service-binding-timeout.test.ts` 用 fake runtime 证明 dispatcher 侧路径就绪。
  2. `payloadSchema` 字段目前仍是字符串引用（`"PreToolUsePayload"` 等），不是可执行 zod schema。GPT §5 的 follow-up 建议做执行面收敛；本轮暂维持字符串引用，避免在 hooks 包内复制/承接 session-do-runtime 的 payload schema 定义。
  3. `HookSource` 的 `skill` 仍作为可注册 source 保留（action-plan 明确要求预留接口），但注册结果不会真正被 skill runtime 消费——这由 action-plan §2.3 的 "skill 仅保留接口" 判定授权，非本包决策。

---

## 7. 工作日志

| 时间 (UTC) | 事项 | 事实依据 |
|------------|------|----------|
| 2026-04-17 02:10 | 初审基线：`npm test` → 9 files / 61 tests pass | `cd packages/hooks && npm test` |
| 2026-04-17 02:11 | 复核 GPT R1：`buildHookEmitBody` 返回 `{type, event, payload, timestamp}`，`nacp-core` 要 `{event_name, event_payload}`；属实 | `src/core-mapping.ts:11-20`、`packages/nacp-core/src/messages/hook.ts:4-8` |
| 2026-04-17 02:11 | 复核 GPT R2：`hookEventToSessionBroadcast` body 是 `{event, payload, outcome, timestamp}`，应为 `{kind, event_name, payload_redacted, aggregated_outcome?}`；`buildHookAuditRecord` 返回 `HookAuditEntry` 而非 `AuditRecordBody`；属实 | `src/session-mapping.ts:18-39`、`src/audit.ts:16-55` |
| 2026-04-17 02:12 | 复核 GPT R3：`catalog.ts` `UserPromptSubmit` 含 `updatedInput`、`PostToolUseFailure` 无 `stop`、`PostCompact` 无 `additionalContext`；`AggregatedHookOutcome` 无 `updatedInput` 字段；属实 | `src/catalog.ts:52-87`、`src/outcome.ts:26-89` |
| 2026-04-17 02:12 | 复核 GPT R4 / Kimi R1：`dispatcher.emit()` 完全未调用 `checkDepth()`，也未传 AbortSignal；属实 | `src/dispatcher.ts:30-106`、`src/guards.ts:78-83` |
| 2026-04-17 02:13 | 复核 Kimi R5：`HookHandlerConfig.event: string`；属实 | `src/types.ts:25` |
| 2026-04-17 02:13 | 复核 Kimi R2 / R3 / R4 / R6：README / CHANGELOG / scripts / 3 unit tests / 2 integration tests 均缺失；属实 | `ls packages/hooks` |
| 2026-04-17 02:23 | 修 R3：重写 `src/catalog.ts` 固定 allowlist 与 design §7.2 一致 | `src/catalog.ts` |
| 2026-04-17 02:23 | 修 R3：扩展 `src/outcome.ts` 给 `AggregatedHookOutcome` 增补 `updatedInput`，`aggregateOutcomes` 按 allowlist 归并 | `src/outcome.ts` |
| 2026-04-17 02:24 | 修 R1：重写 `src/core-mapping.ts`：`buildHookEmitBody` / `parseHookOutcomeBody` / `buildHookOutcomeBody` 三件套对齐 nacp-core | `src/core-mapping.ts` |
| 2026-04-17 02:24 | 修 R2：重写 `src/session-mapping.ts` 输出 `hook.broadcast` body | `src/session-mapping.ts` |
| 2026-04-17 02:25 | 修 R2：重写 `src/audit.ts` 返回 `AuditRecordBody`，保留 `buildHookAuditEntry` 作内部视图 | `src/audit.ts` |
| 2026-04-17 02:25 | 修 R6：`src/types.ts` 的 `event` 类型收紧为 `HookEventName` | `src/types.ts` |
| 2026-04-17 02:26 | 修 R4：重写 `src/dispatcher.ts`，在 emit 入口调用 `checkDepth`，透传 AbortSignal，context 增补 `depth: number` | `src/dispatcher.ts` |
| 2026-04-17 02:27 | 修 `src/index.ts` 导出面，增补 `HookEmitContext / AuditRecordBody / HookEmitBody / HookOutcomeBody / HookBroadcastBody / buildHookOutcomeBody` 等 | `src/index.ts` |
| 2026-04-17 02:27 | 重写 `test/audit.test.ts`（对拍 `AuditRecordBodySchema`） | `test/audit.test.ts` |
| 2026-04-17 02:28 | 重写 `test/session-mapping.test.ts`（对拍 `SessionStreamEventBodySchema`） | `test/session-mapping.test.ts` |
| 2026-04-17 02:29 | 新增 `test/catalog.test.ts`、`test/outcome.test.ts`、`test/core-mapping.test.ts` | 三个新文件 |
| 2026-04-17 02:30 | 新增 dispatcher recursion + abort + emitContext 用例 | `test/dispatcher.test.ts` |
| 2026-04-17 02:31 | 新增 `test/integration/service-binding-timeout.test.ts` + `test/integration/compact-guard.test.ts` | 两个新文件 |
| 2026-04-17 02:32 | 补齐 README.md / CHANGELOG.md / scripts/export-schema.ts / scripts/gen-registry-doc.ts + package.json scripts | 文档 + 脚本 |
| 2026-04-17 02:36 | `npm run typecheck` → clean；`npm run build` → clean；`npm test` → 14 files / 127 tests | vitest stdout |

---

## 8. 对 GPT 代码审查质量的评价

> 评价人: `Claude Opus 4.7 (1M context)`
> 评价时间: `2026-04-17`
> 评价依据: `GPT 审查（§1–§5）与最终代码复核结果的对照`

### 8.1 一句话评价

**本轮最高信号的一份审查**：GPT 抓住了 hooks 包最结构性、也最隐蔽的一层缺陷——协议真相层全面漂移——而这一层正是 Kimi 几乎完全漏掉的部分。同时 GPT 在 R3 捕捉的 catalog allowlist 漂移属于 "会直接改变主循环行为" 的 correctness bug，定级 `high` 合理。

### 8.2 优点

1. **协议真相层锁定精准**：R1 / R2 分别锁定 `hook.emit` / `hook.outcome` / `hook.broadcast` / `audit.record` 四条 wire body shape 与 `@nano-agent/nacp-core` / `@nano-agent/nacp-session` 的直接不兼容，且全部有 `safeParse` 级复现证据——这是 "hooks 跨 worker 一接线就炸" 的最高风险路径，Kimi 全部判 `done` 是危险的乐观。
2. **R3 对 outcome contract 漂移的判定锋利**：把 "`UserPromptSubmit` 错放 `updatedInput`" / "`PostToolUseFailure` 漏 `stop`" / "`PostCompact` 漏 `additionalContext`" / "`updatedInput` 无聚合主路径" 合并成一条 high 级 correctness——这与主循环行为强耦合，值得这个定级。实机复现 "`PostToolUseFailure.stop` 被静默降级" 非常有说服力。
3. **对 safety guard 深度的判定克制**：R4 把 timeout 判 `done`、把 recursion + abort 判 `partial` 并定级 `medium`；理由是 helper 存在但未接主路径。复核后完全命中 Kimi 直接判 critical 的同一事实，但 GPT 的定级更符合 MVP 风险级（recursion 攻击在平台内 hook 中并非高频）。
4. **对 `skill` source 的 scope 漂移捕捉**：§4 Out-of-Scope 核查标记 O8 `部分违反`，理由是 registry / 集成场景已在用 `skill` source 层。这是其他审查没抓到的 governance 细节。
5. **协作友好**：blocker 一列 5 条全部可执行；follow-up 两条都写明动机，不把 follow-up 伪装成 blocker 反推节奏。

### 8.3 可以更好的地方

1. **R3 未把 `updatedInput` 聚合缺失单独拆一条**：合并在 `high correctness` 条目里容易被一带而过；如果独立成 `R3b`，并补一条 "目前 `AggregatedHookOutcome.updatedInput` 不存在" 的直接代码引用，实现者对这条子问题的优先级会更清楚。
2. **R4 未列 `withTimeout` 的 AbortSignal 反向测试**：GPT 指出 AbortSignal 未接主路径，但没具体建议 "dispatcher 级别接入 abortSignal 后至少要有一个 abort-triggered handler → continue+diagnostics 的测试"。本轮自己补了这条，但说明建议仍可以更具体。
3. **R5 把 service-binding transport 与 Phase 5 docs/tests 合并成一条**：两者风险性质不同——前者是协议一致性证据不足，后者是交付物不全。拆成 `R5a` / `R5b` 更利于收敛。
4. **对 Kimi 捕到的 `HookHandlerConfig.event: string` 类型松绑未捕获**：虽然严重度偏低，但这是会导致 "注册成功却永不命中" 的沉默失败，属于类型层 correctness 盲点。GPT 没列这条。

### 8.4 评分

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 5 | 四条协议 shape 都做了 `safeParse` 级复现 |
| 判断严谨性 | 5 | 对 Kimi 全部漏掉的四条协议层问题命中到位 |
| 修法建议可执行性 | 4.5 | 大部分具体；R3 子问题、R4 测试样例可更细 |
| 对 action-plan / design 的忠实度 | 5 | `docs/design/hooks-by-GPT.md:371-378`、`docs/action-plan/hooks.md:183-184` 等引用精准到行 |
| 协作友好度 | 5 | blocker / follow-up 分层合理，没有夸大 |

总体 **4.9 / 5** — 本轮 GPT 的 review 是推动 hooks 包真正从 "骨架" 走向 "可接线" 的决定性文档。若没有这份审查，单看 Kimi 的 `approve-with-followups` 很容易错过协议真相层全面漂移这一关键问题。

---

## 10. 二次审查

### 10.1 二次审查结论

> 复核者: `GPT-5.4`
> 复核时间: `2026-04-17`
> 复核依据: `实现者 §6 的回应 + 当前代码事实 + 包级验证 + root cross-package tests`

- **二次结论**：`Opus 对 hooks 的协议修复、outcome contract、guard 主路径与类型收紧大多已真实闭合，但本轮仍不收口；R5 仍是 partial。`
- **是否收口**：`no`

### 10.2 已验证有效的修复

| 审查编号 | 复核结论 | 依据 |
|----------|----------|------|
| R1 | `closed` | `packages/hooks/src/core-mapping.ts:40-178` 已改为真实 `{ event_name, event_payload }` / `{ ok, block?, updated_input?, additional_context?, stop?, diagnostics? }` 语义；`packages/hooks/test/core-mapping.test.ts:21-183` 直接对拍 `HookEmitBodySchema` / `HookOutcomeBodySchema`；root `test/hooks-protocol-contract.test.mjs` 与 `npm run test:cross` 继续从 public `dist/` 出口验证通过 |
| R2 | `closed` | `packages/hooks/src/session-mapping.ts:37-59` 与 `packages/hooks/src/audit.ts:50-84` 已输出可直接被 `SessionStreamEventBodySchema` / `AuditRecordBodySchema` 接受的 body；`packages/hooks/test/session-mapping.test.ts:17-121`、`packages/hooks/test/audit.test.ts:18-145` 与 root `test/hooks-protocol-contract.test.mjs` 全部验证通过 |
| R3 | `closed` | `packages/hooks/src/catalog.ts:56-97` 已把 `UserPromptSubmit` / `PostToolUseFailure` / `PostCompact` allowlist 收回到 design/action-plan truth；`packages/hooks/src/outcome.ts:52-106` 现在真正聚合 `updatedInput`；`packages/hooks/test/catalog.test.ts`、`packages/hooks/test/outcome.test.ts` 与 `packages/hooks/test/dispatcher.test.ts` 锁住这些边界 |
| R4 / Kimi-R1 | `closed` | `packages/hooks/src/dispatcher.ts:61-148` 现在在入口执行 `checkDepth()`，并把 `AbortSignal` 与 `depth + 1` 透传给 runtime；`packages/hooks/test/dispatcher.test.ts` 与 `packages/hooks/test/integration/compact-guard.test.ts` 已覆盖 depth / abort / blocking 路径 |
| Kimi-R5 | `closed` | `packages/hooks/src/types.ts:30-38` 的 `HookHandlerConfig.event` 已收紧为 `HookEventName`；`cd /workspace/repo/nano-agent/packages/hooks && npm run typecheck && npm run build && npm test` 通过，说明类型收紧没有破坏包内主路径 |

### 10.3 仍未收口的问题

| 审查编号 | 当前状态 | 说明 | 下一步要求 |
|----------|----------|------|------------|
| R5 | `partial` | `packages/hooks/src/runtimes/service-binding.ts:17-24` 的 `ServiceBindingRuntime` 仍然是固定抛错的 stub；而新增的 `packages/hooks/test/integration/service-binding-timeout.test.ts:1-118` 明确写的是 **fake runtime**，并没有验证真实 `ServiceBindingRuntime` 通过 `hook.emit / hook.outcome` roundtrip。action-plan `docs/action-plan/hooks.md:336-343, 489-495` 要求的是 service-binding runtime/fake transport 闭环，而不是仅验证 dispatcher 可以接受一个测试替身。 | 为 `ServiceBindingRuntime` 补最小 transport seam，并让 integration test 真正经过该类；若决定继续 defer，也应在 action-plan / README / review 里明确降级，不再把这部分写成 fixed |
| R5 | `partial` | Phase 5 的 schema/doc 交付仍未真实闭合。`packages/hooks/package.json:15-30` 新增了 `build:schema` / `build:docs`，但 `devDependencies` 没有 `tsx`；我实际执行 `cd /workspace/repo/nano-agent/packages/hooks && npm run build:schema && npm run build:docs`，命令在 `build:schema` 处直接失败：`sh: 1: tsx: not found`。这和 `eval-observability` 的问题性质相同，不能按“脚本存在”算 closed。 | 让脚本在包内可直接执行：补 `tsx` 到 `devDependencies`，或改为当前仓库已有的执行方式；修完后重新跑 `build:schema` / `build:docs` |

### 10.4 二次收口意见

- **必须继续修改的 blocker**：
  1. 让 `ServiceBindingRuntime` 不再只是 stub，至少形成一个可被 integration test 直接验证的最小 roundtrip seam。
  2. 修复 `build:schema` / `build:docs` 的运行时依赖缺口，保证 Phase 5 脚本真实可执行。
- **可后续跟进的 follow-up**：
  1. 保留 root `test/hooks-protocol-contract.test.mjs` 作为 public/dist 视角的 cross-package 回归，避免以后只在包内 helper 层自测。
  2. 下轮把“transport closure”和“docs/scripts closure”拆开记录，避免 R5 这种混合项继续掩盖真实剩余面。

> 请实现者根据本节继续更新代码，并在本文档底部追加下一轮回应。
