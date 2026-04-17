# Code Review — @nano-agent/hooks

> 审查对象: `packages/hooks/`
> 审查时间: `2026-04-17`
> 审查人: `Kimi k2p5`
> 审查范围:
> - `docs/action-plan/hooks.md`
> - `docs/design/hooks-by-opus.md`
> - `docs/design/hooks-by-GPT.md`
> - `packages/hooks/src/` (14 files)
> - `packages/hooks/test/` (9 test files)
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：hooks 的核心骨架（catalog、registry、matcher、dispatcher、runtime seam、audit、session-mapping、snapshot）已完整实现，61 个测试全过；但 action-plan 明确要求的文档、脚本、部分测试覆盖与 dispatcher 深度保护仍未完全收口。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. `HookDispatcher` 虽然接收 `maxDepth` 选项，但 `emit()` 内部**完全没有调用 `checkDepth()`**，递归保护只存在于接口层而未在调度路径生效。
  2. action-plan 列出的 4 个 integration tests 中有 2 个缺失；3 个核心单测文件（catalog、outcome、core-mapping）也缺失。
  3. `README.md` 与 schema/doc 生成脚本均未产出，直接影响下游包的接入与协议审阅。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/hooks.md`
  - `docs/design/hooks-by-opus.md`
  - `docs/design/hooks-by-GPT.md`
  - `README.md`
- **核查实现**：
  - `packages/hooks/src/` — 14 个源文件
  - `packages/hooks/test/` — 9 个测试文件
- **执行过的验证**：
  - `pnpm --filter @nano-agent/hooks typecheck` ✅ passed
  - `pnpm --filter @nano-agent/hooks test` ✅ 9 test files, 61 tests passed

### 1.1 已确认的正面事实

- `HookEventName` 8 事件最小集已冻结于 `catalog.ts`，`isBlockingEvent()` 与 `allowedOutcomes` 明确。
- `HookRegistry` 实现了 source 优先级排序（platform-policy > session > skill），支持 register/unregister/lookup/listAll/listBySource/clear。
- `matchEvent` 仅支持 exact / wildcard / toolName，**无 regex**，符合 out-of-scope 约束。
- `HookDispatcher.emit()` 是单一入口：blocking 事件顺序执行并在 block/stop 时 short-circuit；non-blocking 事件并行执行；handler 错误被捕获并转为 continue + diagnostics。
- `LocalTsRuntime` 实现完整，支持 id → async fn 的受控执行。
- `ServiceBindingRuntime` 作为 stub 存在，明确抛出 `not yet connected`，为 session-do-runtime 组装层预留 seam。
- `guards.ts` 的 `withTimeout` 支持 timer + AbortSignal 双重取消；`checkDepth` 提供递归深度校验函数。
- `core-mapping.ts` 将 hook domain 映射到 `hook.emit` / `hook.outcome` NACP-Core message body。
- `session-mapping.ts` 将事件映射为 `hook.broadcast`，并按 `redactionHints` 对 payload 脱敏。
- `audit.ts` 生成 `HookAuditEntry`，捕获 eventName、handlerCount、blockedBy、duration。
- `snapshot.ts` 提供 registry 的 serialize/restore，支持 DO hibernation 后恢复。
- 2 个 integration tests（pretool-blocking、session-resume-hooks）验证了 blocking short-circuit 与 snapshot/restore 端到端路径。

### 1.2 已确认的负面事实

- `README.md` 不存在于 `packages/hooks/`。
- `scripts/export-schema.ts` 与 `scripts/gen-registry-doc.ts` 不存在。
- `test/catalog.test.ts`、`test/outcome.test.ts`、`test/core-mapping.test.ts` 不存在。
- `test/integration/service-binding-timeout.test.ts`、`test/integration/compact-guard.test.ts` 不存在。
- `HookDispatcher.emit()` 虽然构造函数接收 `options.maxDepth`，但**从未调用 `checkDepth()`**，递归保护未生效（`src/dispatcher.ts:38-106`）。
- `HookHandlerConfig.event` 的类型是 `string` 而不是 `HookEventName`（`src/types.ts:25`），导致 registry 在类型层面允许注册非法事件名。
- `ServiceBindingRuntime` 当前是完全 stub，无法执行任何真实调用（符合注释说明，但与 action-plan 中 "transport fixture test" 的期望有差距）。

---

## 2. 审查发现

### R1. HookDispatcher 未实际启用递归深度保护

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - `src/dispatcher.ts:23` 构造函数接收 `options?: { defaultTimeoutMs?: number; maxDepth?: number }`
  - `src/dispatcher.ts:30-106` `emit()` 方法全程未读取 `maxDepth`，也未调用 `checkDepth()`
  - `src/guards.ts:78-83` `checkDepth` 函数已存在但无人消费
- **为什么重要**：design doc 与 action-plan 均将 recursion guard 列为 high 风险缓解手段；如果 handler 在 `PostToolUse` 中再次触发 tool 从而引发嵌套 emit，系统将因缺少深度检查而陷入无限递归，直至 DO CPU 超时。
- **审查判断**：这是一个显式的功能缺失，属于 safety guard 未 wire 到 dispatch path 的 bug。
- **建议修法**：
  1. 在 `emit()` 签名中增加可选 `depth` 参数（默认 0）
  2. 在 emit 入口处调用 `checkDepth(depth, this.options?.maxDepth ?? DEFAULT_GUARD_OPTIONS.maxDepth)`
  3. 在 runtime 内部（如 local-ts handler 触发嵌套 emit 时）传递 `depth + 1`
  4. 补充 dispatcher 递归深度测试（depth=3 通过，depth=4 抛出并转为 diagnostics）

### R2. README.md 缺失

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：
  - `packages/hooks/README.md` 不存在
  - `docs/action-plan/hooks.md` P1-01 / P5-03 明确要求 README
- **为什么重要**：kernel、capability、session-do-runtime 的开发者需要快速理解 hooks 的 8 事件目录、blocking vs non-blocking 语义、runtime 接入方式、out-of-scope 限制；无 README 会显著增加跨包集成摩擦。
- **审查判断**：必须在收口前补齐。
- **建议修法**：添加 README，至少包含：包用途简述、8 事件清单与 blocking 语义、registry/dispatcher 基本用法、local-ts / service-binding runtime 示例、v1 限制（无 shell/HTTP/agent runtime、无 regex matcher、client 只读订阅）。

### R3. 3 个核心单测文件缺失

- **严重级别**：`high`
- **类型**：`test-gap`
- **事实依据**：
  - action-plan §1.5 目录树列出 `test/catalog.test.ts`、`test/outcome.test.ts`、`test/core-mapping.test.ts`
  - 当前 test 目录中无上述 3 个文件
- **为什么重要**：catalog 与 outcome 是 hooks 的根基；core-mapping 是 NACP 协议对齐的关键。缺失单测意味着 schema 变更、outcome 合并规则调整、或 core message shape 漂移时缺乏快速回归能力。
- **审查判断**：action-plan 明确将其列入单元测试范围，缺失属于未达标。
- **建议修法**：
  - `catalog.test.ts`：验证 8 事件存在、blocking/allowedOutcomes/redactionHints 正确
  - `outcome.test.ts`：验证 `aggregateOutcomes` 全部组合（continue+block+stop、additionalContext 拼接、diagnostics 合并、非法 action demote）
  - `core-mapping.test.ts`：验证 `buildHookEmitBody` 结构、`parseHookOutcomeBody` 对合法/非法输入的解析与报错

### R4. 2 个 integration tests 缺失

- **严重级别**：`high`
- **类型**：`test-gap`
- **事实依据**：
  - action-plan §1.5 列出 4 个 integration tests：`pretool-blocking.test.ts`、`service-binding-timeout.test.ts`、`session-resume-hooks.test.ts`、`compact-guard.test.ts`
  - 当前仅存在 pretool-blocking 与 session-resume-hooks
- **为什么重要**：service-binding timeout 与 PreCompact guard 是 action-plan P5-01 明确要求的收口场景；缺少它们意味着两条高风险路径（远端 runtime 超时失败、compact 被阻断）没有稳定回归。
- **审查判断**：必须在收口前补齐缺失的 2 个 integration tests。
- **建议修法**：
  - `service-binding-timeout.test.ts`：构造一个 mock service-binding runtime（或利用现有 stub + 自定义 fake runtime），验证超时后 dispatcher 返回 continue + timeout diagnostics，不抛异常到主循环。
  - `compact-guard.test.ts`：注册一个 `PreCompact` blocking handler，验证 emit 后 `blocked=true`，且审计记录正确。

### R5. HookHandlerConfig.event 类型过松

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `src/types.ts:25`：`readonly event: string;`
  - 而 `HookEventName` 是 8 成员字面量联合，定义于 `src/catalog.ts:10-18`
- **为什么重要**：这允许在类型层面注册非法事件名（如拼写错误 `"PreTooluse"`），registry 的 `lookup` 参数虽是 `HookEventName`，但注册端没有类型约束，可能导致 "注册成功但永远不会被命中" 的静默失败。
- **审查判断**：属于 schema 契约松动，应收紧。
- **建议修法**：将 `HookHandlerConfig.event` 的类型从 `string` 改为 `HookEventName`；如需要避免循环依赖，可将 `HookEventName` 类型声明前移至 `types.ts` 或单独文件。

### R6. Schema/doc 生成脚本缺失

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - action-plan §1.5 列出 `scripts/export-schema.ts` 与 `scripts/gen-registry-doc.ts`
  - `packages/hooks/scripts/` 目录不存在
- **为什么重要**：脚本用于生成可供团队审阅的 hook catalog 与 registry 文档，是 action-plan P5-02 的明确产出。
- **审查判断**：可视为 non-blocking follow-up，但最好在收口前至少提供最小可用版本。
- **建议修法**：创建 `scripts/` 目录，实现最小版本：
  - `export-schema.ts`：导出 `HOOK_EVENT_CATALOG` 为 JSON schema 片段
  - `gen-registry-doc.ts`：生成 markdown，列出 8 事件、blocking 语义、allowed outcomes、redaction hints

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 独立包骨架 | done | package.json、tsconfig.json、build/typecheck/test 均正常 |
| S2 | 8 事件最小集 | done | catalog.ts 已冻结 8 事件 |
| S3 | HookEventCatalog | done | payloadSchema / redactionHints / allowedOutcomes 已就位 |
| S4 | HookOutcome + AggregatedHookOutcome | done | outcome.ts 实现完整，但缺少 outcome.test.ts |
| S5 | HookRegistry (platform-policy / session / skill) | done | registry.ts 完整，source 优先级与 lookup 正确 |
| S6 | HookMatcher (exact / wildcard / toolName) | done | matcher.ts 无 regex，测试覆盖完整 |
| S7 | HookDispatcher.emit() 单一入口 | done | dispatcher.ts 实现 blocking/non-blocking/short-circuit |
| S8 | local-ts runtime | done | runtimes/local-ts.ts 完整 |
| S9 | service-binding runtime | partial | 接口与 stub 就位，但当前完全无法执行真实调用；缺 timeout integration test |
| S10 | timeout / AbortSignal / recursion guard | partial | timeout 已 wire 到 dispatcher；recursion guard (`checkDepth`) **未 wire** |
| S11 | hook.emit / hook.outcome Core builder/parser | done | core-mapping.ts 就位，但缺 core-mapping.test.ts |
| S12 | hook.broadcast Session adapter | done | session-mapping.ts 对齐 nacp-session，redaction 正确 |
| S13 | audit.record builder | done | audit.ts 就位，测试覆盖完整 |
| S14 | session hook snapshot/restore | done | snapshot.ts + snapshot.test.ts + integration 验证完整 |
| S15 | README / 导出 / schema 脚本 | missing | README 与 scripts 均缺失；3 个核心单测与 2 个集成测试也缺失 |

### 3.1 对齐结论

- **done**: 11
- **partial**: 3
- **missing**: 1

> 该实现更像“核心调度逻辑与类型骨架已完成，但安全网（递归保护）、文档、脚本与部分测试覆盖仍未收口”，而非 action-plan 定义的全面完成状态。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | shell-command hook runtime | 遵守 | 未引入任何 shell runtime |
| O2 | fetch-http runtime | 遵守 | 类型未声明 fetch-http，仅 local-ts + service-binding |
| O3 | llm-prompt runtime | 遵守 | 未引入 |
| O4 | client 回写 blocking handler | 遵守 | 客户端只读通过 hook.broadcast，无回写能力 |
| O5 | regex matcher | 遵守 | matcher.ts 仅 exact/wildcard/toolName |
| O6 | 25 事件全集 | 遵守 | 仅 8 事件 |
| O7 | 真实 DO storage / KV / R2 写入编排本体 | 遵守 | 仅提供 audit builder / snapshot codec，不接管 wiring |
| O8 | skill runtime 本体 | 遵守 | registry 预留 skill source 标签，但 skill 子系统未实装注册 |
| O9 | sub-agent / multi-turn concurrency hooks | 遵守 | 未涉及 |
| O10 | per-subcommand bash hooks | 遵守 | 未涉及 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`approve-with-followups` — 核心实现质量高、61 测试全过、typecheck 通过，但存在 **1 个 critical 功能缺失（dispatcher 未启用递归深度保护）** 与多项文档/测试缺口，当前不应标记为 completed。
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 在 `HookDispatcher.emit()` 中实际启用 `checkDepth()` 递归保护（R1）
  2. 补齐 `README.md`（R2）
  3. 补齐 3 个缺失的核心单测：`catalog.test.ts`、`outcome.test.ts`、`core-mapping.test.ts`（R3）
  4. 补齐 2 个缺失的集成测试：`service-binding-timeout.test.ts`、`compact-guard.test.ts`（R4）
  5. 将 `HookHandlerConfig.event` 类型收紧为 `HookEventName`（R5）
- **可以后续跟进的 non-blocking follow-up**：
  1. 实现 `scripts/export-schema.ts` 与 `scripts/gen-registry-doc.ts`（R6）
  2. 在 session-do-runtime 组装阶段将 `ServiceBindingRuntime` 从 stub 升级为真实 transport 调用

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应模板

> **规则**：
> 1. 不要改写 §0–§5；只允许从这里往下 append
> 2. 回应时按 `R1/R2/...` 对应，不要模糊说“已修一些问题”
> 3. 必须写明“哪些修了、怎么修的、改了哪些文件、跑了什么验证”
> 4. 若选择不修某条 finding，必须写明理由与 tradeoff

### 6.1 对本轮审查的回应

> 执行者: `{IMPLEMENTER}`
> 执行时间: `{DATE}`
> 回应范围: `R1–R6`

- **总体回应**：`{ONE_LINE_RESPONSE}`
- **本轮修改策略**：`{STRATEGY}`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | dispatcher 未启用递归深度保护 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R2 | README 缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R3 | 3 个核心单测缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R4 | 2 个集成测试缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R5 | HookHandlerConfig.event 类型过松 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R6 | schema/doc 脚本缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |

### 6.3 变更文件清单

- `{FILE_1}`
- `{FILE_2}`
- `{FILE_3}`

### 6.4 验证结果

```text
{TEST_OR_BUILD_OUTPUT_SUMMARY}
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview | partially-closed | blocked`
- **仍然保留的已知限制**：
  1. `{KNOWN_LIMITATION_1}`
  2. `{KNOWN_LIMITATION_2}`

---

## 7. 二次审查模板

> **规则**：
> 1. 二次审查人不得改写 §0–§6，只能继续 append
> 2. 二次审查必须区分：已验证修复有效 / 仅部分修复 / 新引入问题
> 3. 必须明确“本轮是否收口”

### 7.1 二次审查结论

> 复核者: `{REVIEWER}`
> 复核时间: `{DATE}`
> 复核依据: `实现者 §6 的回应 + 当前代码事实`

- **二次结论**：`{ONE_LINE_REREVIEW_VERDICT}`
- **是否收口**：`yes | no`

### 7.2 已验证有效的修复

| 审查编号 | 复核结论 | 依据 |
|----------|----------|------|
| R1 | `closed` | `{FILE:LINE / command / test}` |
| R2 | `closed` | `{FILE:LINE / command / test}` |

### 7.3 仍未收口的问题

| 审查编号 | 当前状态 | 说明 | 下一步要求 |
|----------|----------|------|------------|
| R3 | `open | partial | regressed` | `{WHY}` | `{ACTION}` |
| R4 | `open | partial | regressed` | `{WHY}` | `{ACTION}` |

### 7.4 二次收口意见

- **必须继续修改的 blocker**：
  1. `{BLOCKER_1}`
  2. `{BLOCKER_2}`
- **可后续跟进的 follow-up**：
  1. `{FOLLOWUP_1}`
  2. `{FOLLOWUP_2}`

> 若仍不收口，请明确写：请实现者根据本节继续更新代码，并在本文档底部追加下一轮回应。

---

## 8. 文档纪律

- review 文档是**append-only**的执行记录：
  - 初审写 §0–§5
  - 实现者回应写 §6
  - 二次审查写 §7
  - 如有第三轮，继续在底部追加 `§8+`
- 不要删除上一轮判断；如果观点变化，必须写“为什么变化”
- 每条结论都应尽量有**文件 / 行号 / 命令输出**支撑
- 如果 action-plan / design doc 的边界本身变了，先更新源文档，再继续 code review

---

## 9. 对 Kimi 代码审查质量的评价

> 评价人: `Claude Opus 4.7 (1M context)`
> 评价时间: `2026-04-17`
> 评价依据: `Kimi 审查（§1–§5）与最终代码复核结果的对照`
>
> 注：本次修复的具体工作日志全部写在 `docs/code-review/hooks-by-GPT.md §7`，不在此重复。

### 9.1 一句话评价

**交付物清单层严谨，但协议真相层盲点较大**：Kimi 在 README / 核心单测 / 集成测试 / `HookHandlerConfig.event` 类型收紧等 "外围" 层面全部发现到位，但 hooks 包最关键的四条 NACP 协议映射（`hook.emit` / `hook.outcome` / `hook.broadcast` / `audit.record`）全部被判 `done`——这是本轮 review 最大的结构性盲点，也是 GPT 审查能显著补位的原因。

### 9.2 优点

1. **R1 递归保护空心化定位准**：把 `HookDispatcher` 接收 `maxDepth` 却从不调用 `checkDepth()` 这条安全网缺失直接定级 `critical`，并给出完整修法 4 步（emit 增参 + entry checkDepth + runtime 传 `depth+1` + 单测覆盖）。GPT 同一问题定级 `medium`，Kimi 的定级更激进——就这条 issue 的 "攻击面" 而言，Kimi 更严格的判断对防御 PostToolUse → 工具 → PostToolUse 嵌套更稳妥。
2. **R5 `HookHandlerConfig.event: string` 类型收紧是 GPT 漏掉的 correctness 盲点**：虽然定级 `medium`，但这是会让 "注册成功却永不命中" 的沉默失败，收紧到 `HookEventName` 字面量联合后 compile time 就能拦截拼写错误。作为 Kimi 的独家发现，价值明确。
3. **R2 / R3 / R4 / R6 清单类缺项齐全**：README、3 个核心单测（catalog / outcome / core-mapping）、2 个 integration tests（service-binding-timeout / compact-guard）、scripts——五条都踩在 action-plan §1.5 / §5.5 的字面要求上，全部属实。
4. **§4 out-of-scope 逐项核对扎实**：10 条 out-of-scope 都给出 "遵守" + 一句证据，避免作者通过 out-of-scope 放水。
5. **§1.1 正面事实列得很具体**：每条都点到具体的 seam 名字（`HookEventCatalog` 8 事件、`matchEvent` 无 regex、`withTimeout` 双重取消等），方便与负面事实对照。

### 9.3 可以更好的地方

1. **协议映射四条全部漏掉（最严重的盲点）**：
   - S11 `buildHookEmitBody` 判 `done`——实测 `{type, event, payload, timestamp}` 与 `nacp-core` 的 `{event_name, event_payload}` 完全不兼容。
   - S11 `parseHookOutcomeBody` 判 `done`——实测它期待 `{action, handlerId, durationMs}`，但 `nacp-core` 真实 body 是 `{ok, block?, updated_input?, additional_context?, stop?, diagnostics?}`，`safeParse` 即失败。
   - S12 `hookEventToSessionBroadcast` 判 `done`——实测 body 是 `{event, payload, outcome, timestamp}`，`SessionStreamEventBodySchema.safeParse` 直接不过。
   - S13 `buildHookAuditRecord` 判 `done`——实测它返回本地 `HookAuditEntry`，不是 `AuditRecordBody`。
   - 四条是同一类问题：Kimi 只核对了 "代码存在 + 有测试"，没反向跑一次 `@nano-agent/nacp-core` / `@nano-agent/nacp-session` 的真实 schema `safeParse`。GPT 的第一步就是做这个对拍，补上了这整类盲点。
2. **outcome contract 漂移完全未捕获**：Kimi 的 S3 / S4 都判 `done`。而实际上 `UserPromptSubmit` 错放 `updatedInput`、`PostToolUseFailure` 漏 `stop`、`PostCompact` 漏 `additionalContext`、`AggregatedHookOutcome` 没有 `updatedInput` 字段——这组 4 条漂移会直接改变主循环行为。Kimi 只核对了 "allowedOutcomes 有定义" 却没对照 `docs/design/hooks-by-GPT.md §7.2` 的 allowlist 真相做表格 diff。
3. **`approve-with-followups` verdict 偏乐观**：基于漏掉的协议层问题，这个定级会误导读者以为 hooks 已接近收口。更严谨的判断应当是 `changes-requested`——正如 GPT 所做。
4. **复现度不如 GPT**：例如 R1 只写 "`emit()` 方法全程未读取 maxDepth"，没有进一步跑一个 depth=4 的嵌套复现。R1 本身是对的，但 review 文档的说服力依赖实机证据。

### 9.4 评分

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 3.5 | 行号精准；缺实机 `safeParse` / 嵌套复现 |
| 判断严谨性 | 3 | 协议映射四条 + outcome 漂移四条全部漏网 |
| 修法建议可执行性 | 4.5 | R1 修法步骤完整、R3–R6 命名具体 |
| 对 action-plan / design 的忠实度 | 4 | 清单类条目引得准，design §7.2 allowlist 未系统 diff |
| 协作友好度 | 5 | §1.1 正负面事实分层干净，§4 out-of-scope 无推诿 |

总体 **3.8 / 5** — Kimi 在 "可观察清单" 层的审查非常稳，唯一但关键的缺陷是没有做 "与 `@nano-agent/nacp-core` / `@nano-agent/nacp-session` 真实 schema 对拍" 这一步。与 GPT 并读时互补性很强，但单独使用会误判收口节奏。
