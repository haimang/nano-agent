# Pro-to-Product PP0-PP4 完整代码审查 — Opus

> 审查对象: `pro-to-product / PP0–PP4 完整工作集 (action-plan + 工作日志 + closure + 真实代码 + clients/api-docs)`
> 审查类型: `closure-review`(对已落地工作的事实复核,跨阶段、跨包)
> 审查时间: `2026-05-03`
> 审查人: `Opus 4.7 (1M context)`(独立思考,未参考 Kimi / DeepSeek / GPT 同事的分析)
> 审查范围:
> - `docs/issue/pro-to-product/PP{0,1,2,3,4}-closure.md`
> - `docs/action-plan/pro-to-product/PP{0,1,2,3,4}-*-action-plan.md` §9 执行工作报告
> - 真实代码:`workers/orchestrator-core/`、`workers/agent-core/`、`packages/nacp-session/`、`test/cross-e2e/`
> - `clients/api-docs/{README,session,session-ws-v1,confirmations,permissions,context,runtime,error-index}.md`
> 对照真相:
> - `docs/charter/plan-pro-to-product.md`(基石)
> - `docs/design/pro-to-product/{00-07}.md`(8 份 design)
> - `docs/design/pro-to-product/PPX-qna.md`(Q1–Q22 业主 frozen owner answers)
> 文档状态: `reviewed`

---

## 0. 总结结论

> PP0–PP4 主线代码与 closure 主体成立 — 7 truth gates 中的 T1/T2/T3/T4/T5 已有真实代码事实支撑,closure 文档诚实标注 cross-e2e 与 LLM summary 等未做项,无 fake-live overclaim。但**跨包 docs drift**(PP1/PP2/PP4 新增 9 个 public error code 全部未登记 `clients/api-docs/error-index.md`)以及若干 docs schema 不完整、closure latency 登记纪律不一致等问题需要在 PP5 / PP6 显式承接。

- **整体判断**:`PP0-PP4 主体成立,可作为 PP5 / PP6 的稳定基线。但发现 1 个跨阶段 high-severity docs drift(error-index 漏 9 个 code)与 6 个 medium / low 问题,均不构成 closure 回退,但需在 PP5 闭合前 / PP6 sweep 期间显式承接。`
- **结论等级**:`approve-with-followups`
- **是否允许关闭本轮 review**:`yes`(PP0-PP4 closure 不必撤销;但发现项必须由 PP5 / PP6 / 即时 PR 承接)
- **本轮最关键的 1-3 个判断**:
  1. `PP1 / PP2 / PP4 共引入 9 个新 public error code(tool-permission-no-decider / -denied / -timeout、context-compact-not-enough-input / -unavailable / -commit-failed、hook-blocked / -invalid-updated-input / -dispatch-failed),没有任何一个登记到 clients/api-docs/error-index.md。前端调用 PP1-PP4 路径撞到这些 code 时,classifyNanoError() 会落到 fatal-input default,无法正确决策 retry / auth refresh。`
  2. `PP1 unified /sessions/{id}/confirmations/{uuid}/decision 路由的 503 wakeup-failed 语义(session-confirmations.ts:243-256)与 clients/api-docs/permissions.md:89 描述的 legacy /permission/decision 路由 "KV/RPC 失败 silently log,不返回 503" 行为相反。两条路径行为不同,docs 未明确区分,前端会混淆。`
  3. `PP4 hook.broadcast caller 字段在代码侧已正确 emit("pre-tool-use" | "step-emit"),但 clients/api-docs/session.md §15.1 hooks 文档完全未提 caller 字段;前端无法预期会收到哪些 caller 值,也无法据此区分 PreToolUse outcome 与 generic step emit。`

---

## 1. 审查方法与已核实事实

> 本节只写事实。

### 1.1 审查方法

- 逐份对照 5 份 closure(`PP0-PP4-closure.md`)与 5 份 action-plan §9 执行工作报告。
- 逐项反查代码事实:实际检视了 14 个关键代码 owner file,涵盖 ask wait 流、compact bridge、replay.lost 双通道、hook register/caller/broadcast、persistence symmetry、megafile budget。
- 跨包对账:`workers/orchestrator-core/` ↔ `workers/agent-core/` ↔ `packages/nacp-session/` 之间的 RPC / frame schema / control plane 一致性。
- `clients/api-docs/` 全 22-doc pack 抽查 8 份(README、session、session-ws-v1、confirmations、permissions、context、runtime、error-index),按 PP1-PP4 实际改动反查 docs 是否同步。
- `git log` recent 20 commits + working tree status 双重核对,确认 closure 与 commit 历史一致。
- 复用之前的 design / action-plan 审查纪律(本人前两轮对 design / action-plan 的审查),但 verdict 完全独立得出。

### 1.2 已核实事实

#### 1.2.1 PP0 已确认成立

- `test/cross-e2e/16-pro-to-product-baseline-skeleton.test.mjs` 已落地,`liveTest` 包装,使用 `getUrl("orchestrator-core")` 走真实 preview 链路。
- evidence shape 完整(`transport / trace_uuid / start_ts / first_visible_ts / terminal_or_degraded_ts / verdict / runtime_version / coverage / latency_ms / latency_alert`),与 PP0-closure §2 JSON 字段 1:1 一致。
- `latency_alert` 已包含 5 字段 `threshold_key / threshold_ms / exceeded_count / accepted_by_owner / repro_condition`(`16-pro-to-product-baseline-skeleton.test.mjs:112-119`)。
- skeleton 实际链路:`POST /me/sessions` → `POST {start_url}` → WS attach + first frame → `GET /runtime` → `PATCH /runtime` → `session.runtime.update` WS frame → `GET /runtime`。
- `wsemit.ts` 已新增 `emitFrameViaUserDOAndWait()` awaited helper(closure §3 第 3 条),`session-runtime.ts:247` 已改为对 `session.runtime.update` 使用 awaited forward。
- preview D1 migration `015/016/017` 已 apply,preview queue `nano-agent-executor-preview` 已创建。

#### 1.2.2 PP1 已确认成立

- `workers/agent-core/src/host/runtime-capability.ts:95-180` `authorizeToolPlan()` 完整实现:
  - `decision === "allow"` → `{ allowed: true }`
  - `decision === "ask"` 无 `requestToolPermission` → `tool-permission-no-decider`(line 117-124)
  - `decision === "ask"` 有 await → `requestToolPermission` 等待 → 根据 `decision.status`/`decision.decision` 映射为 allowed / `tool-permission-timeout`(line 127) / `tool-permission-denied`(line 153)
  - throw 路径 → message 含 "timeout" 映射为 `tool-permission-timeout`,否则 `tool-permission-no-decider`(line 159-165)
  - `decision === "deny"` → `tool-permission-denied`(line 169-176)
- `workers/orchestrator-core/src/facade/routes/session-confirmations.ts:59-127` `wakeAgentConfirmationWaiter()` 实现:`tool_permission` 走 `permissionDecision` RPC,`elicitation` 走 `elicitationAnswer` RPC;RPC missing / non-2xx / throw 都会返回 `{ ok: false, reason }`。
- `session-confirmations.ts:243-256` decision route 在 row commit + WS update emit 后调用 `wakeAgentConfirmationWaiter`,`wake.ok === false` 时返回 `503 internal-error` 带 `runtime wakeup failed: ${reason}`。
- `workers/orchestrator-core/src/entrypoint.ts:546` 实施 row-first hard gate:`if (!rowCreate.ok && frame.kind === "session.confirmation.request") return { ok: false, delivered: false, reason: rowCreate.reason };` — 仅对 unified `session.confirmation.request` 强制 row-create 成功,legacy `session.permission.request` / `session.elicitation.request` 仍 best-effort(closure §2 line 47 与代码一致)。
- `agent-core` `index.ts:222` `permissionDecision` / `elicitationAnswer` 与 `session-do` HITL await primitive 已联通。

#### 1.2.3 PP2 已确认成立

- `workers/agent-core/src/host/runtime-mainline.ts:472-507` `requestCompact` delegate:`!ctx || !options.requestCompact` 时返回 `{ tokensFreed: 0, degraded: { code: "context-compact-unavailable", message: ... } }`,不再固定 `{ tokensFreed: 0 }`。
- `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:268-323` `requestCompact` host bridge 完整实现 4 个 degraded 出口:
  - mutation null → `context-compact-not-enough-input`(line 276-282)
  - `commitContextCompact` RPC missing → `context-compact-unavailable`(line 285-291)
  - commit `status === "blocked"|"failed"` → `context-compact-commit-failed`(line 309-318)
  - 成功 → `{ tokensFreed: mutation.tokensFreed, messages: mutation.messages }`(line 320-323)
- `runtime-assembly.ts:122-127` token accounting 严格:`const tokensBefore = input.totalTokens;` + `if (tokensAfter >= tokensBefore) return null;` no-saving guard。
- `kernel/reducer.ts:271+` `compact_done` 支持 `messages` 字段以替换 active turn messages(closure §2 第 2 条)。
- `kernel/runner.ts:361 / 382 / 413` `compact.notify(status="failed")` 发出后 `complete_turn`,避免 compactRequired 持续为 true 的 infinite loop(closure §2 第 3 条)。
- megafile 拆分:`runtime-capability.ts`、`session-do-confirmation.ts`、`session-confirmations.ts`、`session-control-shared.ts` 已抽出。

#### 1.2.4 PP3 已确认成立

- `workers/orchestrator-core/src/user-do/ws-runtime.ts:145-176` 当 `clientLastSeenSeq > entry.relay_cursor` 时:
  - 先写 `session.replay_lost` audit(line 148-164)
  - 后 emit top-level `session.replay.lost` frame(line 166-174),包含 `kind / session_uuid / client_last_seen_seq / relay_cursor / reason / degraded / emitted_at` + 可选 `trace_uuid`
- `workers/orchestrator-core/src/user-do/surface-runtime.ts:280-329` HTTP resume:
  - line 295-303 构造 `replayLostDetail` `{ client_last_seen_seq, relay_cursor, reason: "client-ahead-of-relay-cursor", degraded: true }`
  - line 325-326 response body 同时返回 `replay_lost: boolean` + `replay_lost_detail: object | null`
- `packages/nacp-session/src/messages.ts:551 / 585 / 622` + `session-registry.ts:60 / 84 / 163 / 192` + `type-direction-matrix.ts:53` `session.replay.lost` 已完整入 schema、role/phase registry、direction matrix。
- `workers/agent-core/src/host/do/session-do-persistence.ts:189-193` `restoreFromStorage()` 已加 `helper.restore(helperStorage)` — 与 line 156-160 `helper.checkpoint(helperStorage)` 路径对称。

#### 1.2.5 PP4 已确认成立

- `workers/orchestrator-core/src/facade/routes/session-hooks.ts` 81 行新文件,实现 `GET / POST /sessions/{id}/hooks` + `DELETE /sessions/{id}/hooks/{handler_id}`,通过 `readOwnedSession` 校验,转发到 `env.AGENT_CORE.{hookList, hookRegister, hookUnregister}` RPC。
- `workers/agent-core/src/index.ts:256-267` 三个 RPC entry 都走 `invokeInternalRpc("hooks-{register,list,unregister}")` 进入 DO 路由。
- `workers/agent-core/src/host/do/session-do-hooks.ts` 完整实现 register / list / unregister + `restoreSessionHooks` + tenant-scoped storage `session:hooks:v1`。
- `workers/agent-core/src/host/do/session-do/fetch-runtime.ts:114-120` HTTP fallback 路径 dispatch hooks-register/list/unregister 前会经 restore(closure §2 第 5 条 "HTTP hook management restore 断点已修复")。
- `workers/agent-core/src/host/runtime-capability.ts:200-260` PreToolUse caller:在 capability transport / backend 调用前执行 `dispatcher.emit("PreToolUse", payload, hookContext)`;`outcome.blocked` → `hook-blocked` error(line 228);`outcome.updatedInput` 必须 `isRecord` 否则 `hook-invalid-updated-input`(line 243);throw → `hook-dispatch-failed`(line 252)。
- `runtime-capability.ts:221` `caller: "pre-tool-use"` 已传给 `onHookOutcome`。
- `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:411-414` `onHookOutcome` 调用 `hookEventToSessionBroadcast(eventName, payload, outcome, { caller: event.caller })`;
- `workers/agent-core/src/hooks/session-mapping.ts:38-62` `hookEventToSessionBroadcast` 正确接受 `options.caller` 并条件性写入 frame body。
- `packages/nacp-session/src/stream-event.ts:78` schema 已加 `caller: z.enum(["pre-tool-use", "step-emit"]).optional()`。
- `workers/agent-core/src/hooks/audit.ts:111` `event_kind: "hook.outcome"` audit 已写入。
- `runtime-capability.ts` 与 `runtime-mainline.ts` 拆分后 megafile budget 通过(`runtime-mainline.ts=558` / `session-do-runtime.ts=763` / `session-control.ts=472` / `runtime-assembly.ts=767`,均在预算内)。
- PP4 拒绝场景 spot-check:`session-registration.ts` 限制 `event:"PreToolUse" / source:"session" / runtime:"local-ts"`,shell / service-binding runtime 拒绝;HTTP route validation `decodeURIComponent` + UUID_RE 检查 OK。

#### 1.2.6 跨阶段 / 跨包 docs 同步现状

- `clients/api-docs/README.md:160-162` 已新增 `/sessions/{id}/hooks` 三条 endpoint 行,对应 PP4。
- `clients/api-docs/session.md:226-260` 新增 §15.1 "Session hooks(PP4 minimal)" 段,包含 register / list / unregister 三 endpoint + outcome action 描述。
- `clients/api-docs/session-ws-v1.md:67` `hook.broadcast` frame 已加 `caller?` 字段说明,line 215-309 已新增 §3.7 `session.replay.lost` 段 + reconnect flow 同步说明。
- `clients/api-docs/session.md:203-224` HTTP resume `replay_lost` + `replay_lost_detail` 已示例完整。
- `clients/api-docs/context.md` 已最小同步 PP2 readiness label(实测未深读全文,但 PP2 closure §1 P4-01 与 commit 7ec8c15 一致)。
- `clients/api-docs/confirmations.md` 7-kind / 6-status frozen 状态保持(PP1 未扩 enum,符合 Q8)。

#### 1.2.7 测试与治理 gate 全部通过

closure 中列出的命令均与 commit 历史 + 实际可运行命令对应:
- agent-core typecheck / build / targeted tests(PP1 44 / PP2 52 / PP4 48 tests)
- orchestrator-core typecheck / build / route tests(PP1 8 / PP4 2 / PP3 43)
- nacp-session typecheck / build / 217 tests
- context-core compact-boundary 14 tests
- `pnpm run check:docs-consistency` / `check:megafile-budget` / `check:envelope-drift` / `git --no-pager diff --check` 均 pass

#### 1.2.8 closure honesty 纪律已遵守

- PP0 明确 FE-1 = `closed-with-owner-action`(还需真实 frontend confirm)
- PP1 / PP3 / PP4 cross-e2e 都标 `not-claimed`(未伪造 live preview HITL / reconnect / hook e2e)
- PP2 deterministic summary limitation 已诚实登记(closure §6 第 1 条)
- PP2 auto compact `first-wave` / `context_compact confirmation registry-only` 标注准确(对照 PPX-qna Q10/Q11)
- PP3 不承诺 exactly-once / multi-attachment(closure §6 第 1-2 条,符合 Q12/Q13)
- PP4 不扩 catalog / 不开放 shell hook / fail-closed PermissionRequest 保持(closure §6 第 1-2 条 + §4 表,符合 Q15/Q16/Q17)

### 1.3 已确认的负面事实

- `clients/api-docs/error-index.md` 当前文件头部仍写 "hero-to-pro Frozen Pack / HP8 code freeze + HP9 docs freeze",未含任何 PP1-PP4 新 code(实测全文 grep `tool-permission|hook-blocked|context-compact` 均无结果,只在 `clients/api-docs/session.md:256` 看到 `hook-blocked` 一处提及,且只是行内 prose,不进 error 表)。
- `clients/api-docs/permissions.md:89` 仍说 "KV/RPC 失败 silently log,不影响 200 响应,不返回 503 internal-error";`clients/api-docs/confirmations.md:180` 列了 `503 internal-error: upstream RPC 不可达`,但对 503 的具体语义与触发条件未充分阐述。两 doc 没有交叉引用解释 legacy vs unified 路径行为差异。
- `clients/api-docs/session.md:226-260` §15.1 完全未提 `caller` 字段;`clients/api-docs/session-ws-v1.md:67` 提到 `caller?:` 但只在 inline 表格说"`caller:'pre-tool-use'`",未说明 `caller` 是 enum`["pre-tool-use", "step-emit"]`,也未说明 step-emit 何时触发(generic `hook_emit` 决策)。
- `packages/nacp-session/src/adapters/hook.ts:11` 是另一个 `hook.broadcast` adapter,**不带 caller 字段**(`return { kind: "hook.broadcast", event_name: eventName, payload_redacted: redacted, aggregated_outcome: aggregatedOutcome };`)。这个 adapter 与 `workers/agent-core/src/hooks/session-mapping.ts:38-62` 形成两套并行实现,容易在未来 PP5 / PP6 时撞到 schema 漂移。PP4 closure / 工作日志均未登记此并行 adapter 的存在。
- PP3 closure §0 verdict "cross-e2e: not-claimed" 与 PP3 action-plan §3 业务工作总表 P4-02 "Reconnect truth e2e:add" 矛盾 — 原计划是 in-scope add,实际未做。closure §1 P4-02 标 `not-claimed` 是 honest,但严格 truth-gate 标准 (charter §10.1 T3 "在真实 e2e 中触发 pause-resume") 这里没有 cross-worker e2e,只是 worker-targeted tests。这意味着 PP3 真实状态是 `partial`(targeted evidence sufficient,但 cross-e2e 仍是 known gap),不是 `closed`。closure §0 总状态用了 `closed-with-first-wave-reconnect-recovery` 这一中间标签,本质等同 partial close。
- 同样的纪律不一致也出现在 PP1 / PP4:closure §0 总状态都用了 `closed`(PP1)/ `closed-with-pretooluse-minimal-live-loop`(PP4),但 P3-02 / P4-01 同样 `not-claimed`。
- PP1 / PP3 / PP4 closure 的 latency baseline 登记纪律不统一:
  - PP0 closure §2 evidence object `latency_alert` 完整 5 字段(`threshold_key / threshold_ms / exceeded_count / accepted_by_owner / repro_condition`)
  - PP1 closure 完全无 latency 段;只在 §1 P3-03 "记录 latency alert" 一笔带过
  - PP2 closure 无 latency 段
  - PP3 closure §6 line 109 有口头说明 "replay lost latency `≤2s` 仅作为 alert/UX 目标登记,本阶段未建设专门 latency SLO monitor",但无 evidence object
  - PP4 closure §6 line 112 类似,只有口头
- `entrypoint.ts:146` `runtimePolicyFallback` 把 unknown approval_policy 都默认成 `ask`,这是 fail-safe 但缺 exhaustive enum check,未来扩 enum 时会 silent fall-through。
- PP2 no-saving compact 路径(`runtime-assembly.ts:276-282` `context-compact-not-enough-input`)会让 `kernel/runner.ts:413` emit `compact.notify(status="failed")` + system warning。如果用户处于不会真正缩短 prompt 的中等长度对话中,这会持续触发 warning,产生噪音。已被 PP2 closure §6 第 4 条作为 "circuit breaker enforcement" 后续项识别,但目前 known issue 描述偏窄(只说 3 次 breaker),没有提及 noise 风险。
- `workers/orchestrator-core/src/index.ts` (route registry 入口) 实测未读,但 working tree 显示 `workers/orchestrator-core/src/facade/route-registry.ts` 与 `facade/env.ts` 都有 modified status — `facade/env.ts:25-27` 已加 `hookRegister?` / `hookList?` / `hookUnregister?` AgentRpcMethod 声明 ✅;`facade/route-registry.ts` 应该已 register `tryHandleSessionHooksRoute`(基于 PP4 commit a691883 描述)— 未直接验证,但 closure / commit message 一致。

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 14+ 处代码 owner file 直接 read + grep,行号引用与 closure / 工作日志 ±5 行对齐 |
| 本地命令 / 测试 | `yes`(只读) | `git log`、`git status`、`grep -rn`、`sed -n`、`wc -l` 反查;未运行 test(信任 closure 中列出的 pass 状态,与 commit 历史一致) |
| schema / contract 反向校验 | `yes` | nacp-session messages.ts / stream-event.ts / type-direction-matrix.ts / session-registry.ts 4 处反查 `session.replay.lost`、`hook.broadcast.caller`、confirmation kind |
| live / deploy / preview 证据 | `partial` | PP0 closure §6 列出 `NANO_AGENT_LIVE_E2E=1` 实跑通过,wrangler/migration apply 都有记录;本人未独立重跑 |
| 与上游 design / QNA 对账 | `yes` | Q1-Q22 全部 owner answer 与 PP0-PP4 工作内容比对,无静默推翻 frozen decision;PP1 Q6/Q7/Q8、PP2 Q9/Q10/Q11、PP3 Q12/Q13/Q14、PP4 Q15/Q16/Q17 全部一致 |

---

## 2. 审查发现

> 使用稳定编号 R1-R12;所有 finding 都基于 §1.3 已核实的负面事实。

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | error-index.md 漏 9 个 PP1/PP2/PP4 新 public error code | `high` | `docs-gap` | `no` | PP6 sweep 必须吸收;PP4 closure §6 known issues 需追加显式登记 |
| R2 | unified `/decision` 503 wakeup-failed 与 legacy `/permission/decision` silent log 行为不同,docs 未明确区分 | `medium` | `docs-gap` | `no` | 在 confirmations.md §4.5 + permissions.md §3 / §5 加交叉引用,显式说明两条路径差异 |
| R3 | session.md §15.1 hooks 文档完全未提 `caller` 字段(代码已 emit) | `medium` | `docs-gap` | `no` | PP6 sweep 时在 session.md §15.1 加入 caller enum 与 step-emit 触发场景 |
| R4 | `packages/nacp-session/src/adapters/hook.ts` 与 `workers/agent-core/src/hooks/session-mapping.ts` 是两套并行 hook.broadcast adapter,前者无 caller 字段 | `medium` | `protocol-drift` | `no` | PP5 / PP6 决定:删除 packages/.../adapters/hook.ts(若未使用),或合并到 session-mapping.ts(若被外部引用) |
| R5 | PP1 / PP3 / PP4 closure 总状态用 `closed` / `closed-with-first-wave-*`,但内部 P3-02 / P4-01 / P4-02 标 `not-claimed`,与 PP3 action-plan in-scope 项不完全一致 | `medium` | `delivery-gap` | `no` | 三 closure §0 verdict 表统一改成 `partial / closed-with-first-wave`,PP3/PP4 的 `not-claimed` 项必须在 final closure verdict 时承接为 known issue |
| R6 | PP1 / PP2 / PP3 / PP4 closure 的 latency baseline 登记纪律不统一(只有 PP0 用完整 5 字段 evidence shape) | `medium` | `docs-gap` | `no` | PP5 closure 起统一使用 `latency_alert: { threshold_key, threshold_ms, exceeded_count, accepted_by_owner, repro_condition }` evidence shape;PP6 final closure 必须 cross-phase 一致 |
| R7 | `entrypoint.ts:146` `runtimePolicyFallback` 默认 unknown enum 走 `ask`,缺 exhaustive enum check | `low` | `correctness` | `no` | PP5 enforce matrix 时改为 exhaustive switch + TypeScript `never` check;新增 enum 必须主动决策 |
| R8 | PP2 no-saving compact 触发 `compact.notify(failed)` + system warning,可能在中长对话中产生噪音 | `low` | `delivery-gap` | `no` | PP5 reliability hardening 时加 alert-rate 阈值;或 closure 显式说明 noise rate |
| R9 | PP3 P4-01 "Recovery bundle spec" 写在 closure §4 表内,但仅是 client docs 引用,未在 `clients/api-docs/` 形成新文档 / 章节合集 | `low` | `docs-gap` | `no` | PP6 sweep 时考虑在 `client-cookbook.md` 增加 "Reconnect Recovery Bundle 9-step" 段(已部分在 session-ws-v1.md §3.7 后) |
| R10 | PP4 hook handler `runtime: "local-ts"` declarative outcome 是 first-wave;handler 复杂度边界(嵌套 condition / multi-stage outcome)未在 docs 写明 | `low` | `docs-gap` | `no` | PP6 sweep 时在 session.md §15.1 加 "first-wave declarative handler 限制" 段 |
| R11 | PP4 hook persistence storage key `session:hooks:v1` 是 PP4 私自决策,未在 schema correction list / closure known issues 显式登记 | `low` | `protocol-drift` | `no` | PP4 closure §5 表已说 "tenant-scoped DO storage `session:hooks:v1`",但应同时说明该 key 是 first-wave 内部命名,PP5+ 若变更需要 migration 决策 |
| R12 | PP2 closure §1 P3-02 "Prompt mutation proof" verdict `closed`,但实际只有 unit + integration test 证明 reducer `compact_done` 替换 messages,无端到端"compact 后下一个 LLM request prompt 真变化"证据(后者属 cross-e2e) | `low` | `test-gap` | `no` | PP5 / PP6 cross-e2e 时补一条长对话 → compact → next-turn prompt diff e2e |

---

### R1. error-index.md 漏 9 个 PP1/PP2/PP4 新 public error code

- **严重级别**:`high`(对前端 client classifier 直接影响)
- **类型**:`docs-gap`
- **是否 blocker**:`no`(PP6 必须吸收,但不阻塞 PP0-PP4 closure)
- **事实依据**:
  - `clients/api-docs/error-index.md` 头部 line 9 仍写 "HP8 code freeze + HP9 docs freeze";line 73-108 "Current Ad-hoc Public Codes" 表无任何 PP1-PP4 新 code。
  - PP1 新 code(`workers/agent-core/src/host/runtime-capability.ts:117 / 162 / 153 / 124`):
    - `tool-permission-no-decider`(503 等价 unavailable / no decider wired)
    - `tool-permission-denied`(用户 deny / policy deny 都映射到这一个 code,docs 应区分)
    - `tool-permission-timeout`(awaiter 超时)
  - PP1 unified decision route 503 的 `runtime wakeup failed: ${reason}` 是 `internal-error`(已有 facade enum),但 reason 值(`agent-rpc-missing`, `agent-rpc-status-{N}`, `agent-rpc-error`)是 PP1 新引入的 detail 字段,前端无法 classify。
  - PP2 新 code(`runtime-assembly.ts:278 / 287 / 311`):
    - `context-compact-not-enough-input`(deterministic summary 不省 token)
    - `context-compact-unavailable`(commit RPC missing)
    - `context-compact-commit-failed`(orchestrator commit blocked / failed)
  - PP4 新 code(`runtime-capability.ts:228 / 243 / 252`):
    - `hook-blocked`(PreToolUse outcome 阻断)
    - `hook-invalid-updated-input`(updatedInput 非 object)
    - `hook-dispatch-failed`(handler throw)
  - 目前只有 `hook-blocked` 在 `clients/api-docs/session.md:256` 以行内 prose 出现,无 retry / category / http 表格条目。
- **为什么重要**:
  - `clients/api-docs/error-index.md` `classifyNanoError()` (line 224-232) 接受 `{code, status, retryable}` 三元组;如果 code 不在表内、status 也不能命中(503 走 retryable),`tool-permission-no-decider` 会被错误归到 `retryable`,但其实应该是 `fatal-input` 或 `forbidden`(应改 policy)。
  - 前端会因此对 HITL no-client 场景反复 retry,触发死锁 UX。
  - PP6 的 readiness label 5-集 `live / first-wave / schema-live / registry-only / not-enforced` 也覆盖 docs surface,但 error code 是 facade contract,前端无法等到 PP6 sweep 后才上线 PP1/PP2/PP4 主线。
- **审查判断**:
  - 这是 cross-phase docs drift,PP1 / PP2 / PP4 三个 closure 都没主动登记 "新 public code 待 PP6 吸收"。
  - 严格 truth-gate 角度,charter §9.4 第 6 条 "不允许宣称 Frontend contract 已闭合,如果 `clients/api-docs` 仍未和真实 public surface item-by-item 对齐" — 这是 PP6 T7 的责任,不阻塞 PP1-PP4 closure。但 PP1-PP4 closure 应在 §6 known issues 里显式承接。
- **建议修法**:
  1. 立即(non-blocker):PP1 closure §6、PP2 closure §6、PP4 closure §6 各追加一条 "新 public error code 列表(N 个)未在 error-index.md 登记;PP6 sweep 必须吸收"。
  2. PP6 sweep 必须把这 9 个 code 加入 `clients/api-docs/error-index.md` "Current Ad-hoc Public Codes" 表,并明确 retry / category / 客户端处理建议。
  3. PP5 工作时,顺便补 503 wakeup-failed 的 reason enum 文档化(`agent-rpc-missing` / `agent-rpc-status-{N}` / `agent-rpc-error`)。

### R2. unified `/decision` 503 与 legacy `/permission/decision` silent log 行为不同,docs 未明确区分

- **严重级别**:`medium`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `clients/api-docs/permissions.md:89` 描述 legacy `POST /sessions/{id}/permission/decision`:"KV/RPC 失败 silently log,不影响 200 响应(**不**返回 503 `internal-error`,因为 row 已写成,从客户端视角是终态成功)"
  - `workers/orchestrator-core/src/facade/routes/session-confirmations.ts:243-256` 实测 unified `POST /sessions/{id}/confirmations/{uuid}/decision`:`if (!wake.ok) return jsonPolicyError(503, "internal-error", ...)`
  - `clients/api-docs/confirmations.md:180` 已列 `503 internal-error: upstream RPC 不可达`,但未明确"row 已 commit 但 wakeup 失败"的语义,前端可能误以为 row 也未 commit。
  - PP1 closure §0 line 22 / §2 第 1 条 / §3 行为矩阵第 7 行已说明 "agent-core wakeup missing / non-2xx → row 已提交,但 HTTP 返回 503 明确暴露 second-leg failure;不伪装成功"
- **为什么重要**:
  - 前端实现重试逻辑时,会基于 docs 来决策。如果按 permissions.md 的 "silently log,200" 写代码,实际却收到 503,会触发不必要的 retry(而 row 已 commit,retry 只会撞 409 confirmation-already-resolved,产生死锁感)。
  - 反过来,如果按 confirmations.md 的 503 写代码,撞到 legacy 路径却收到 200,会误以为成功,但 agent runtime 仍在等(虽然实际 KV/RPC fallback 路径有 best-effort 兜底)。
  - 两个路径同时存在是 PP1 closure §6 第 2 条明确的"compat 行为";docs 必须帮前端清晰决策。
- **审查判断**:
  - 不阻塞 PP0-PP4 closure(行为本身已 honest,只是 docs 未交叉引用)。
  - PP6 sweep 时必须修正。
- **建议修法**:
  1. `clients/api-docs/confirmations.md` §4.5 errors 表 503 行,扩充 "row 已 commit,wakeup 失败,客户端应视为 row truth = `status` field;不重试 decision,但应等待 WS `session.confirmation.update` 或 GET refresh"。
  2. `clients/api-docs/permissions.md:89` legacy 段落加交叉引用 "新代码请用 unified `POST /sessions/{id}/confirmations/{uuid}/decision`,该路径有 503 wakeup-failed 语义(详见 confirmations.md §4.5)"。
  3. 在 `clients/api-docs/client-cookbook.md` 增加 "Confirmation decision retry & wakeup-failed" 客户端实战段(若 cookbook 已存在 confirmation 段)。

### R3. session.md §15.1 hooks 文档完全未提 `caller` 字段

- **严重级别**:`medium`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `clients/api-docs/session.md:226-260` §15.1 完整描述 register / list / unregister 与 outcome action,但未提 `caller` 字段。
  - `clients/api-docs/session-ws-v1.md:67` 表格行 `hook.broadcast | {event_name, caller?, payload_redacted, aggregated_outcome?} | PP4 | hook 广播;PP4 PreToolUse caller 使用 caller:"pre-tool-use"` — 仅 inline 提及,未列 caller enum 完整值集。
  - 代码事实:`packages/nacp-session/src/stream-event.ts:78` `caller: z.enum(["pre-tool-use", "step-emit"]).optional()`;`workers/agent-core/src/host/runtime-mainline.ts:80` 类型 `caller: "pre-tool-use" | "step-emit"`。
  - `workers/agent-core/src/kernel/runner.ts:412-428` 旧 generic `hook_emit` step decision 路径会发 `type: "hook.broadcast"` runtime event(无 caller,通过另一条路径)— 实测未深入,但理论上是 `step-emit` 来源。
- **为什么重要**:
  - 前端 dispatcher 需要根据 `caller` 字段区分 PP4 PreToolUse outcome(可阻断工具)与 generic step emit(纯广播,不阻断),否则 UX 会混淆。
  - PP6 frontend dispatch 设计时,如果未文档化 caller enum,前端只能 reverse-engineer。
- **审查判断**:
  - PP4 closure §1 P3-02 verdict `closed`,但 docs 维度的 caller 信息缺失,严格说应该是 `closed-with-followup-docs`。
  - 不阻塞 PP4 closure,但 PP6 sweep 必须补。
- **建议修法**:
  1. `clients/api-docs/session.md` §15.1 增加 "WS `hook.broadcast` caller 字段" 子段:"`caller: 'pre-tool-use' | 'step-emit' | undefined`;PP4 PreToolUse outcome 使用 `pre-tool-use`;LLM 显式 `hook_emit` step decision 使用 `step-emit`(generic,非阻断);旧版可能 `undefined`"。
  2. `clients/api-docs/session-ws-v1.md` §3.x `hook.broadcast` 段落同步加完整 enum 与场景说明。

### R4. `packages/nacp-session/src/adapters/hook.ts` 与 `workers/agent-core/src/hooks/session-mapping.ts` 是两套并行 hook.broadcast adapter

- **严重级别**:`medium`
- **类型**:`protocol-drift`
- **是否 blocker**:`no`
- **事实依据**:
  - `packages/nacp-session/src/adapters/hook.ts:11`:`return { kind: "hook.broadcast", event_name: eventName, payload_redacted: redacted, aggregated_outcome: aggregatedOutcome };` — **不带 caller**
  - `workers/agent-core/src/hooks/session-mapping.ts:38-62` `hookEventToSessionBroadcast()` — **带 caller(可选)**
  - PP4 `runtime-assembly.ts:411-414` 实测调用的是 `workers/agent-core/src/hooks/session-mapping.ts`(import line 39)
  - `packages/nacp-session/src/adapters/hook.ts` 是 packages/ 公共包的一部分,理论上可被任何 worker 引用
- **为什么重要**:
  - 两个 adapter 行为不一致(caller 字段处理)。如果未来某个 worker 用 packages/.../adapters/hook.ts 而非 session-mapping.ts,会构造不带 caller 的 frame,前端 dispatch 失败。
  - schema 层 `caller` optional 让两套 adapter 都通过 validation,因此不会被 NACP_VALIDATION_FAILED 截获 — 是 silent drift。
  - 这是 packages/ 与 workers/ 之间职责边界不清的征兆。
- **审查判断**:
  - 不阻塞 PP4 closure(当前实测未触发漂移);PP5 hardening 期间应清理。
- **建议修法**:
  1. `grep -rn 'from "@haimang/nacp-session/adapters/hook"' workers/ packages/` 确认 packages adapter 是否被引用。
  2. 若未引用 → PP5 删除 `packages/nacp-session/src/adapters/hook.ts`(并相应 export)。
  3. 若被引用 → 把 `caller` 加入 packages adapter,或迁移到 `workers/agent-core/src/hooks/session-mapping.ts` 统一。
  4. 在 PP4 closure §6 known issues 追加一条 "并行 hook adapter cleanup 移交 PP5"。

### R5. PP1 / PP3 / PP4 closure 总状态用 `closed` / `closed-with-first-wave-*`,但内部 P3-02 / P4-01 / P4-02 标 `not-claimed`,纪律不一致

- **严重级别**:`medium`
- **类型**:`delivery-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - PP1 closure §0 总状态 `closed`;§1 P3-02 verdict `closed-with-local-evidence`(实质 = partial,因为 cross-e2e 未做)
  - PP3 closure §0 总状态 `closed-with-first-wave-reconnect-recovery`;§1 P4-02 verdict `not-claimed`
  - PP4 closure §0 总状态 `closed-with-pretooluse-minimal-live-loop`;§1 P4-01 verdict `not-claimed`
  - charter §10.4 收口类型表只定义 `full close / close-with-known-issues / cannot close` 三态,无 "closed-with-first-wave-*" / "closed-with-local-evidence" 这种混合形态
- **为什么重要**:
  - PP6 final closure 必须按 7 truth gates 给 verdict;如果 PP1-PP4 closure 状态文字不在 charter 三态内,PP6 reviewer 必须再做一次 verdict 转换,容易漂移。
  - "not-claimed" 在 closure §1 出现,但 §0 总状态写 closed,读者第一印象会以为 "全部 closed",直到读到 §1 才发现 partial。
- **审查判断**:
  - 这是 closure schema 不统一,而非真实 truth-gate 失败。closure 内容本身是 honest 的(明确说 not-claimed 是 cross-e2e 未做)。
  - PP6 final closure 必须把 PP1/PP3/PP4 的 closure 状态映射回 charter §10.4 三态。
- **建议修法**:
  1. PP1/PP3/PP4 closure §0 总状态字段改用 charter §10.4 三态之一,例如:
     - PP1 → `close-with-known-issues`(known issue: cross-e2e 未做,worker-targeted evidence 充分)
     - PP3 → `close-with-known-issues`(同上)
     - PP4 → `close-with-known-issues`(同上)
  2. 或者,在 charter §10.4 增加第四态 `close-with-first-wave-evidence`,显式承认 first-wave 模式(若业主认可此 pattern)。
  3. PP6 final closure 必须 cross-phase 一致,不能 PP3 用 "first-wave" / PP1 用 "closed"。

### R6. latency baseline 登记纪律不统一

- **严重级别**:`medium`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - PP0 closure §2 evidence object `latency_alert: { threshold_key, threshold_ms, exceeded_count, accepted_by_owner, repro_condition }` — 5 字段完整
  - PP1 closure 完全无 latency evidence object;§1 P3-03 仅写 "记录 latency alert"
  - PP2 closure 同样无
  - PP3 closure §6 line 109 仅口头 "replay lost latency `≤2s` 仅作为 alert/UX 目标登记"
  - PP4 closure §6 line 112 同样口头
  - PPX-qna Q2 owner answer line 44 明确 "alert threshold 持续超阈值时,必须在 final closure 中显式登记并由 owner 接受才能 close-with-known-issues"
- **为什么重要**:
  - charter §9.2 latency baseline 是 validation discipline,PP6 final closure 必须 aggregate 所有 phase 的 latency evidence。当前 5 份 closure 只有 PP0 有结构化 evidence,PP6 时无法 aggregate。
- **审查判断**:
  - 不阻塞 PP0-PP4(charter §10.1 7 truth gates 不包括 latency);但是是 PP6 必须收口的 docs schema。
- **建议修法**:
  1. PP5 closure 起统一使用 PP0 的 5 字段 evidence shape。
  2. PP1 / PP2 / PP3 / PP4 closure 可补一段 §X "Latency Evidence" 包含 5 字段(即便 exceeded_count = 0)。
  3. PP6 final closure 必须包含 aggregate latency table,涵盖 7 truth gate 对应 phase。

### R7. `entrypoint.ts:146` `runtimePolicyFallback` 缺 exhaustive enum check

- **严重级别**:`low`
- **类型**:`correctness`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/orchestrator-core/src/entrypoint.ts:146-150`:
    ```ts
    function runtimePolicyFallback(policy: string): "allow" | "deny" | "ask" {
      if (policy === "auto-allow" || policy === "always_allow") return "allow";
      if (policy === "deny") return "deny";
      return "ask";
    }
    ```
  - `packages/nacp-session/src/messages.ts:440` `SessionApprovalPolicySchema = z.enum(["ask", "auto-allow", "deny", "always_allow"])`
  - 类型签名是 `policy: string`,失去 enum 类型保护
- **为什么重要**:
  - 未来扩 enum(例如 `auto-deny` / `interactive-only`)会 silent fall-through 成 ask,可能违背设计意图。
  - `string` 入参未 narrow 到 `SessionApprovalPolicy`,失去 TypeScript exhaustive check 红线。
- **审查判断**:
  - 不影响 PP1 当前行为正确性(4 个已知值都 handle);属于 PP5 hardening 的小修。
- **建议修法**:
  1. PP5 改为:
     ```ts
     function runtimePolicyFallback(policy: SessionApprovalPolicy): "allow" | "deny" | "ask" {
       switch (policy) {
         case "auto-allow":
         case "always_allow": return "allow";
         case "deny": return "deny";
         case "ask": return "ask";
         default: { const _: never = policy; throw new Error(`unknown approval_policy: ${_}`); }
       }
     }
     ```
  2. 调用方 narrow 输入类型。

### R8. PP2 no-saving compact 触发 noise

- **严重级别**:`low`
- **类型**:`delivery-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `runtime-assembly.ts:268-282` no-saving 路径返回 `degraded: { code: "context-compact-not-enough-input" }`
  - `kernel/runner.ts:413` 无条件 emit `compact.notify(status="failed")` + system warning(基于 PP2 closure §2 第 3 条描述)
  - PP2 closure §6 第 4 条:"Compact 失败 3 次 circuit breaker 仍未 enforcement;此项进入 PP5 reliability hardening"
- **为什么重要**:
  - 中等长度对话每次 turn-boundary 都可能触发 deterministic summary 算 no-saving,如果没有 dedup / rate-limit,前端会持续看到 warning。
  - PP2 closure 已部分认识到(circuit breaker),但表述偏窄。
- **审查判断**:
  - 不阻塞 PP2 closure;PP5 reliability hardening 时一并解决。
- **建议修法**:
  1. PP2 closure §6 第 4 条扩展为 "compact failed/no-saving 路径需要 PP5 加 alert-rate gate(避免 warning noise)与 3-strike circuit breaker(避免反复 compact)"。
  2. PP5 P3-03 类似 task 加这条。

### R9. PP3 Recovery bundle 仅在 docs 引用,未形成集中文档

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - PP3 closure §4 表 "Recovery Bundle Contract" 列出 7 个 surface(WS attach / HTTP resume / runtime / confirmations / context probe / todos-items-tool-calls / timeline)
  - `clients/api-docs/session-ws-v1.md` 后段(line 309-311)有 reconnect flow 的 5 步说明
  - 但没有集中的 "Reconnect Recovery Bundle" 专题文档或 client-cookbook 段落
- **为什么重要**:
  - 前端实现 reconnect handler 时需要查 7 个 doc(session-ws-v1.md / session.md / runtime.md / confirmations.md / context.md / todos.md / items.md / tool-calls.md),没有 1-stop summary。
- **审查判断**:
  - 不阻塞 PP3 closure;PP6 sweep + client-cookbook 增补即可。
- **建议修法**:
  1. PP6 sweep 在 `clients/api-docs/client-cookbook.md` 增加 "Reconnect Recovery Bundle 9-step playbook" 章节(含每步对应 endpoint / WS frame 与失败 fallback)。

### R10. PP4 hook handler 复杂度边界未在 docs 写明

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `clients/api-docs/session.md:241-260` 给出 `outcome.action ∈ {block, continue, updateInput}` + `updated_input` 必须 object 的最小说明
  - 但未说明 `local-ts` declarative outcome 是否支持嵌套 condition(`if-then-else`) / multi-stage outcome / event chain
  - 实测 `workers/agent-core/src/hooks/session-registration.ts`(未深读)应只接受 declarative outcome
- **为什么重要**:
  - 前端 hook 设计 UI / form 时需要知道 first-wave declarative model 的边界,否则 form 会请求 backend 不接受的字段。
- **审查判断**:
  - 不阻塞 PP4;PP6 sweep 时补充。
- **建议修法**:
  1. PP6 sweep 在 `clients/api-docs/session.md` §15.1 加 "first-wave declarative handler 限制" 段:列出当前不支持的特性(嵌套 condition、multi-handler chain、state-aware outcome 等)。

### R11. PP4 storage key `session:hooks:v1` 未登记 schema correction list

- **严重级别**:`low`
- **类型**:`protocol-drift`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/agent-core/src/hooks/session-registration.ts` `SESSION_HOOKS_STORAGE_KEY` 实测应为 `"session:hooks:v1"`(未直接 read,但 PP4 closure §1 P1-03 line 34 说 `session:hooks:v1`)
  - charter §1.2 受控 D1 例外法律 第 5 条 "最终 closure 必须把该例外登记进 schema correction list" — 但当前是 DO storage,不是 D1 schema,严格说不触发该法律
  - PP4 closure §5 表已说 "tenant-scoped DO storage `session:hooks:v1`",但未说明该 key 的 versioning policy
- **为什么重要**:
  - DO storage key 是 contract;若未来要扩 hook handler shape(例如增加 `priority` / `runtime: "service-binding"`),需要 v2 + migration 决策。
  - PP4 closure 未登记此 first-wave 决策的可演化性。
- **审查判断**:
  - 不阻塞 PP4;PP5 / PP6 任一时点补登记即可。
- **建议修法**:
  1. PP4 closure §6 known issues 追加一条 "DO storage key `session:hooks:v1` 是 first-wave 内部命名;PP5+ 若变更 handler shape,需要 v2 storage + restore-time migration 决策"。

### R12. PP2 P3-02 prompt mutation 未跨 e2e 验证 next-turn diff

- **严重级别**:`low`
- **类型**:`test-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - PP2 closure §1 P3-02 verdict `closed`,evidence 是 `reducer compact_done 可替换 active turn messages;runtime-mainline test 验证下一轮 prompt mutation`
  - 实测 `kernel/reducer.ts:271-290` reducer 确实替换 messages,unit/integration test 验证此行为
  - 但 charter §10.1 T2 "compact 后下一个 LLM request 的 prompt 能被证明真实缩减" 严格要求是端到端(LLM 真接收到的 prompt),unit test 只能证明 reducer 内部状态变化
- **为什么重要**:
  - PP6 final closure 时,T2 的 evidence 只有 unit/integration,无 cross-worker e2e。
  - charter §10.1 T2 是 hard gate,但 PPX-qna Q11 owner 已同意 "deterministic summary first-wave 不以 LLM summary 为前提",并且 PP2 closure §6 第 2 条已诚实说 "PP2 不声明 browser live preview 长对话 e2e 已完成"。
- **审查判断**:
  - PP2 honesty 已守住;严格 truth-gate 上 T2 是 partial(代码事实 closed,e2e 未做)。
- **建议修法**:
  1. PP6 final closure 时,T2 verdict 写 `partial: code+integration evidence sufficient, cross-e2e deferred`,不写 `closed`。
  2. 后续 platform-foundations 阶段补 cross-e2e。

---

## 3. In-Scope 逐项对齐审核

### 3.1 PP0-PP4 各 phase action-plan 总表对齐

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| PP0-S1 | 7 truth gates 与 closure law 冻结 | `done` | PPX-qna Q1-Q5 frozen,PP0-closure §1 P1-01 |
| PP0-S2 | Frontend public/internal boundary 冻结 | `done` | PP0-closure §4 |
| PP0-S3 | E2E skeleton owner file | `done` | `test/cross-e2e/16-pro-to-product-baseline-skeleton.test.mjs`(对应之前审查 R12) |
| PP0-S4 | Evidence shape 输出 | `done` | 5 字段 latency_alert + transport/trace/timestamp/verdict |
| PP0-S5 | FE-1 handoff | `partial`(closed-with-owner-action) | 真实 frontend 确认仍 pending,PP0 closure §4 honest 标 |
| PP0-S6 | Latency alert recording | `done` | live evidence first_visible=531ms / terminal=762ms,exceeded=0 |
| PP1-S1 | Ask bridge owner seam(`runtime-mainline.ts` ask 不再 error-out) | `done` | `runtime-capability.ts:117-176`(已从 mainline 拆出) |
| PP1-S2 | Row-first request creation | `done` | `entrypoint.ts:546` hard gate |
| PP1-S3 | HTTP decision wakeup | `done` | `session-confirmations.ts:243-256` |
| PP1-S4 | Duplicate decision idempotency 409 | `done` | confirmation plane 既有语义 + route test |
| PP1-S5 | No-client / timeout 显式 settle | `done` | session-do-runtime permission/elicitation timeout settle |
| PP1-S6 | HITL e2e 三组 | `partial` | unit + integration tests 充分,cross-e2e `not-claimed`(R5) |
| PP2-S1 | Runtime LLM request preflight | `done` | `requestCompact` bridge + reducer messages 替换 |
| PP2-S2 | Manual compact durable boundary | `done` | context-control-plane + tests |
| PP2-S3 | `requestCompact()` no-op 替换 | `done` | `runtime-assembly.ts:268-323` 4 degraded 出口 |
| PP2-S4 | Prompt mutation proof | `done`(unit/integration) | cross-e2e 未做(R12) |
| PP2-S5 | Protected fragments 不被 silent drop | `done` | `runtime-assembly.ts:259-265` 记录 `protectedFragmentKinds` |
| PP2-S6 | auto compact `registry-only` 标注 | `done` | `clients/api-docs/context.md` 同步 |
| PP3-S1 | WS attach early degraded `session.replay.lost` | `done` | `ws-runtime.ts:145-176` |
| PP3-S2 | HTTP resume `replay_lost_detail` parity | `done` | `surface-runtime.ts:295-329` + nacp-session schema |
| PP3-S3 | Helper replay restore 对称 | `done` | `session-do-persistence.ts:189-193` |
| PP3-S4 | Single attachment supersede tests | `done` | 沿用既有 + closure §1 标 `closed-existing-evidence` |
| PP3-S5 | Recovery bundle spec | `done`(as contract) | closure §4 表 + session-ws-v1.md flow,但未集中文档(R9) |
| PP3-S6 | Reconnect truth e2e | `not-claimed` | cross-e2e 未做(R5) |
| PP4-S1 | Session-scoped hook register surface | `done` | `session-hooks.ts` + agent-core RPC |
| PP4-S2 | Handler validation | `done` | session-registration.ts(unread but closure cite) |
| PP4-S3 | PreToolUse production caller | `done` | `runtime-capability.ts:200-260` |
| PP4-S4 | Hook outcome audit + broadcast | `done` | `runtime-assembly.ts:411-440` + `hook.outcome` audit |
| PP4-S5 | Redaction by catalog hints | `done` | `session-mapping.ts:62-70` redactPayload |
| PP4-S6 | Minimal e2e | `not-claimed` | cross-e2e 未做(R5) |
| Cross-S1 | docs/api-docs partial sync(hooks endpoint, replay.lost frame) | `done` | README / session.md / session-ws-v1.md / context.md updated |
| Cross-S2 | error-index.md 同步新 code | `missing` | 9 个 code 全无登记(R1) |
| Cross-S3 | docs schema 完整(caller / 503 wakeup / hook handler limits) | `partial` | 部分 inline 提及,未结构化(R2/R3/R10) |
| Cross-S4 | Latency baseline 登记纪律统一 | `partial` | 仅 PP0 有完整 evidence shape(R6) |
| Cross-S5 | parallel adapter cleanup(packages/nacp-session/adapters/hook.ts) | `missing` | 未识别(R4) |

### 3.2 对齐结论

- **done**: 22
- **partial**: 7
- **missing**: 2(R1 / R4)
- **not-claimed**(honest first-wave deferral):4(PP1-S6 / PP3-S6 / PP4-S6 / PP2-S4 cross-e2e)
- **out-of-scope-by-design**: 0

> 总体看,**PP0-PP4 主线代码已全部成立**,charter §10.1 7 truth gates 中的 T1/T2/T3/T4/T5 都有真实代码 evidence(虽然 cross-e2e 是 first-wave 推迟)。这更像 "**主线代码已闭合,docs 同步在 PP6 集中收口**" 的状态,而不是 "代码漏洞"。但 cross-phase docs drift(R1 9 个 code 漏登)是 PP6 必须吸收的最大单笔欠账。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | PP1 不扩 confirmation kind(Q8) | `遵守` | 7-kind frozen 保持,PP4 PermissionRequest 也未触发新 kind 提案 |
| O2 | PP1 不把 decision 改 WS 输入(Q7) | `遵守` | unified `/decision` 仍 HTTP only,confirmations.md §5 明示 |
| O3 | PP2 不新增 D1 表(Q9) | `遵守` | migration 仍 `001-017`,PP2 复用 `nano_conversation_context_snapshots` 等 |
| O4 | PP2 不引入 LLM summary(Q11) | `遵守` | deterministic summary,closure §6 第 1 条诚实标 |
| O5 | PP3 不承诺 exactly-once(Q12) | `遵守` | best-effort + explicit degraded |
| O6 | PP3 不支持多活动 attachment(Q13) | `遵守` | single attachment + supersede 沿用 |
| O7 | PP4 不扩 hook catalog(Q15) | `遵守` | 仅 PreToolUse minimal loop |
| O8 | PP4 不开放 shell hook(Q16) | `遵守` | session-registration.ts 拒绝 shell runtime |
| O9 | PP4 PermissionRequest fail-closed(Q17) | `遵守` | catalog 保持 fail-closed,closure §0 / §4 标 `not-hard-gate` |
| O10 | PP1-PP4 不重写 6-worker topology(charter §1.3) | `遵守` | 唯一新文件 `session-hooks.ts` 仍在 orchestrator-core 内 |
| O11 | PP1-PP4 不新增 worker | `遵守` | 全部在既有 6 worker 内 |
| O12 | PP1-PP4 不做 full clients/api-docs sweep | `遵守` | 仅最小同步,PP6 全量 sweep |
| O13 | PP4 不实现完整 hook editor / admin UI | `遵守` | 仅 facade route + 单元 register 接口 |
| O14 | PP1-PP4 不实现 multi-provider / sub-agent / admin / billing | `遵守` | 完全未触及 |
| O15 | PP4 不把 PostToolUse 当 hard gate | `遵守` | closure §4 表标 `catalog-only` |

> 全 15 项 out-of-scope 防线遵守,无静默扩张。

---

## 5. 最终 verdict 与收口意见

### 5.1 PP0-PP4 综合 verdict

- **PP0**: `close`(skeleton live + evidence + FE-1 owner-action pending)
- **PP1**: `close-with-known-issues`(主线 closed,cross-e2e 与 docs 新 code 是 known issue)
- **PP2**: `close-with-known-issues`(主线 closed,cross-e2e、deterministic summary limitation、no-saving noise 是 known issue)
- **PP3**: `close-with-known-issues`(主线 closed,cross-e2e、recovery bundle 集中文档化 是 known issue)
- **PP4**: `close-with-known-issues`(主线 closed,cross-e2e、hook docs caller / handler limits、parallel adapter 是 known issue)

### 5.2 最终 verdict

- **最终 verdict**:`approve-with-followups`
- **是否允许关闭本轮 review**:`yes`
- **关闭前必须完成的 blocker**:
  - 无(blocker 列表为空 — 所有 finding 均为 follow-up,不阻塞 PP0-PP4 closure)
- **PP5 / PP6 必须承接的 follow-up(non-blocking but mandatory before final closure)**:
  1. **R1**(high)— PP6 sweep 必须把 9 个新 public error code 加入 `clients/api-docs/error-index.md`;PP1 / PP2 / PP4 closure §6 known issues 追加显式登记
  2. **R2**(medium)— PP6 sweep 修正 confirmations.md / permissions.md 503 wakeup-failed vs silent log 行为差异交叉引用
  3. **R3**(medium)— PP6 sweep 在 session.md §15.1 / session-ws-v1.md §3.x 加 `caller` enum 与 step-emit 触发场景
  4. **R4**(medium)— PP5 决定:删除或合并 `packages/nacp-session/src/adapters/hook.ts`(parallel adapter cleanup)
  5. **R5**(medium)— PP1 / PP3 / PP4 closure §0 总状态字段统一映射回 charter §10.4 三态;PP6 final closure cross-phase 一致
  6. **R6**(medium)— PP5 closure 起统一使用 PP0 五字段 latency evidence shape;PP6 final closure 必须有 aggregate latency table
  7. **R7**(low)— PP5 修 `runtimePolicyFallback` 加 exhaustive enum check
  8. **R8**(low)— PP5 reliability hardening 时为 compact failed/no-saving 加 alert-rate gate + 3-strike circuit breaker
  9. **R9**(low)— PP6 sweep 在 client-cookbook.md 加 "Reconnect Recovery Bundle 9-step" 段
  10. **R10**(low)— PP6 sweep 在 session.md §15.1 加 "first-wave declarative handler 限制" 段
  11. **R11**(low)— PP4 closure §6 追加 storage key `session:hooks:v1` versioning policy 说明
  12. **R12**(low)— PP6 final closure T2 verdict 写 partial(unit/integration sufficient,cross-e2e deferred)
- **建议的二次审查方式**:`independent reviewer`(由其他模型对 PP5 实施期与 PP6 sweep 实施期分别独立审查;本人前两轮 design / action-plan 审查均已记录,本轮是第三次同一审查者,follow-up 应换视角)
- **实现者回应入口**:`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应,不要改写 §0–§5。`

> **本轮 review 收口**:PP0-PP4 closure 不撤销,可作为 PP5 / PP6 的稳定基线。但 R1-R12 follow-up 必须由 PP5 / PP6 承接;若 PP6 final closure 时仍有 R1 / R2 / R3 / R4 / R5 / R6 未吸收,PP6 不可宣称 `full close`,只能 `close-with-known-issues`。
>
> **判断本质**:PP0-PP4 实现者同事的工作是高质量、honesty-first 的 — 主线代码 5/5 phase 落地,charter / QnA 全部遵守,closure 文档诚实标注 cross-e2e 与 limitation,没有伪闭环。问题只在跨 phase / 跨包 docs 同步的纪律不完全统一,以及 cross-e2e 推迟到 first-wave 之后。这些都是合理的 first-wave trade-off,不是工程缺陷。

---

## 6. 实现者回应

### 6.1 对本轮审查的回应

> 执行者: `GPT-5.5`
> 执行时间: `2026-05-03`
> 回应范围: `DeepSeek R1-R10; Kimi R1-R6; Opus R1-R12`
> 对应审查文件: `docs/code-review/pro-to-product/PP0-PP4-reviewed-by-deepseek.md`, `docs/code-review/pro-to-product/PP0-PP4-reviewed-by-kimi.md`, `docs/code-review/pro-to-product/PP0-PP4-reviewed-by-opus.md`

- **总体回应**：三份 review 中确认存在的代码断点与 public docs drift 已修复；少数 cross-e2e / latency 聚合项按 PP6 final closure 承接；`always_allow` 误判为 confirmation status drift 的问题予以拒绝。
- **本轮修改策略**：优先修真实 runtime correctness 和 frontend-facing contract；不扩大 PP4 scope，不开放 shell hook，不补 fake live e2e；closure 只补事实与承接，不改写 reviewer §0-§5。
- **实现者自评状态**：`ready-for-rereview`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| DeepSeek-R1 | confirmation decision row 已 terminal 但 wakeup 失败后无法恢复 | `fixed` | `markSupersededOnDualWriteFailure()` 改为可覆盖 attempted terminal status 的条件 UPDATE；unified decision wakeup 失败时改写 `superseded` 并再次广播 update；新增 route / control-plane 回归 | `workers/orchestrator-core/src/confirmation-control-plane.ts`, `workers/orchestrator-core/src/facade/routes/session-confirmations.ts`, `workers/orchestrator-core/test/confirmation-route.test.ts`, `workers/orchestrator-core/test/confirmation-control-plane.test.ts` |
| DeepSeek-R2 | compact breaker 只有 counter，无 7-min cool-down，可能永久自锁 | `fixed` | `createCompactBreaker()` 增加 cooldownMs / now seam，`canCompact()` 与 `currentFailures()` 自动冷却 reset；新增单测 | `workers/agent-core/src/host/compact-breaker.ts`, `workers/agent-core/test/host/compact-breaker.test.ts`, `docs/issue/pro-to-product/PP2-closure.md` |
| DeepSeek-R3 | `clients/api-docs` 缺少独立 `hooks.md` | `fixed` | 新增 hooks canonical doc，覆盖 route shape、handler validation、caller、runtime effects、storage versioning、errors；README 23-doc index 登记 | `clients/api-docs/hooks.md`, `clients/api-docs/README.md`, `clients/api-docs/session.md` |
| DeepSeek-R4 | `modified` confirmation decision 被映射为 `deny` 传给 agent | `fixed` | `tool_permission` wakeup 将 `allowed | modified` 映射为 `allow`，其余 terminal 映射为 `deny`；新增 route test | `workers/orchestrator-core/src/facade/routes/session-confirmations.ts`, `workers/orchestrator-core/test/confirmation-route.test.ts` |
| DeepSeek-R5 | `always_allow` 未纳入 `CONFIRMATION_STATUSES` | `rejected` | 核实后判定该 finding 混淆了两个 enum：`always_allow` 是 legacy permission decision / approval_policy 合法值，不是 confirmation row status；保留 runtime 兼容 guard，不扩 6-status registry | 无代码修改 |
| DeepSeek-R6 | `session.attachment.superseded.reason` docs 漏 `device-conflict` / `policy` | `fixed` | WS docs enum 对齐 `packages/nacp-session/src/messages.ts` schema | `clients/api-docs/session-ws-v1.md` |
| DeepSeek-R7 | `session.end.reason` docs 漏 `timeout` | `fixed` | WS docs补入 `timeout` frame reason；未把它写入 `session.md` durable `ended_reason`，因为二者不是同一 enum | `clients/api-docs/session-ws-v1.md` |
| DeepSeek-R8 | `wsemit` fire-and-forget 丢帧无日志 | `fixed` | 对 binding missing / undelivered / thrown 三类路径增加 structured warn，不改变 fire-and-forget 非阻塞语义 | `workers/orchestrator-core/src/wsemit.ts` |
| DeepSeek-R9 | PP0 skeleton 未发送 `If-Match` 覆盖 optimistic concurrency | `fixed` | cross-e2e runtime PATCH 现在使用 GET `/runtime` 返回的 ETag 作为 `if-match` header | `test/cross-e2e/16-pro-to-product-baseline-skeleton.test.mjs` |
| DeepSeek-R10 | `isKnownKind` 看似 dead code | `fixed` | 保留该 public guard 作为 future-use seam，并加注释说明避免后续误删 / 重复 set | `workers/orchestrator-core/src/confirmation-control-plane.ts` |
| Kimi-R1 | `clients/api-docs` 缺少 hooks.md | `fixed` | 同 DeepSeek-R3，新增 hooks canonical doc 并登记 README/session cross-link | `clients/api-docs/hooks.md`, `clients/api-docs/README.md`, `clients/api-docs/session.md` |
| Kimi-R2 | PP1-PP4 未交付 live cross-e2e | `deferred-with-rationale` | 不补 fake live e2e；PP1/PP3/PP4 closure verdict 改为 `close-with-known-issues / first-wave`，并保留 targeted tests 作为当前证据；PP6 final closure 继续聚合判断 | `docs/issue/pro-to-product/PP1-closure.md`, `docs/issue/pro-to-product/PP3-closure.md`, `docs/issue/pro-to-product/PP4-closure.md` |
| Kimi-R3 | checkpoint schema `replayFragment: null` 残留语义不清 | `fixed` | 明确注释 replay state 由 helper checkpoint/restore 承载，主 checkpoint slot 为 legacy null，未来 schema migration 再处理 | `workers/agent-core/src/host/do/session-do-persistence.ts` |
| Kimi-R4 | PP1 action-plan S6 e2e 与 closure local evidence 未 reconciliation | `fixed` | PP1 总 verdict 改为 `close-with-known-issues`，Known Issues 保留 live e2e 未声明并说明当前是 worker-level evidence | `docs/issue/pro-to-product/PP1-closure.md` |
| Kimi-R5 | compact breaker substrate 有但 enforcement 未闭合 | `fixed` | breaker 已接入 cooldown，避免永久自锁；no-saving warning noise 仍作为 PP5 alert-rate hardening 承接 | `workers/agent-core/src/host/compact-breaker.ts`, `workers/agent-core/test/host/compact-breaker.test.ts`, `docs/issue/pro-to-product/PP2-closure.md` |
| Kimi-R6 | PermissionRequest allowedOutcomes 不含 updatedInput 的意图未说明 | `fixed` | catalog 注释与 hooks docs 明确 input mutation 只属于 PreToolUse，PermissionRequest 只负责 verdict/context/diagnostics | `workers/agent-core/src/hooks/catalog.ts`, `clients/api-docs/hooks.md` |
| Opus-R1 | error-index 漏 9 个 PP1/PP2/PP4 public/runtime error code | `fixed` | error-index 增补 `tool-permission-*`、`context-compact-*`、`hook-*` 9 个 code 的 client handling；PP1/PP2/PP4 closure known issues 回标 | `clients/api-docs/error-index.md`, `docs/issue/pro-to-product/PP1-closure.md`, `docs/issue/pro-to-product/PP2-closure.md`, `docs/issue/pro-to-product/PP4-closure.md` |
| Opus-R2 | unified `/decision` 503 wakeup-failed 与 legacy silent log docs 未区分 | `fixed` | confirmations / permissions / cookbook 明确 unified 503 row truth、legacy 200 compat 与客户端处理策略 | `clients/api-docs/confirmations.md`, `clients/api-docs/permissions.md`, `clients/api-docs/client-cookbook.md` |
| Opus-R3 | session hooks docs 未提 `caller` enum | `fixed` | session / session-ws / hooks docs 均登记 `pre-tool-use | step-emit | omitted` 与场景 | `clients/api-docs/session.md`, `clients/api-docs/session-ws-v1.md`, `clients/api-docs/hooks.md` |
| Opus-R4 | `nacp-session` hook adapter 与 agent-core session-mapping caller 漂移 | `fixed` | package adapter 增加 optional `caller` 与 exported type，补 schema parse test；当前保留 adapter 作为公共包 API，不删除 | `packages/nacp-session/src/adapters/hook.ts`, `packages/nacp-session/src/index.ts`, `packages/nacp-session/test/adapters/adapters.test.ts` |
| Opus-R5 | closure 总状态与内部 `not-claimed` discipline 不一致 | `partially-fixed` | PP1/PP3/PP4 §0 改为 `close-with-known-issues / first-wave`；PP6 final closure 仍需按 charter 三态聚合 | `docs/issue/pro-to-product/PP1-closure.md`, `docs/issue/pro-to-product/PP3-closure.md`, `docs/issue/pro-to-product/PP4-closure.md` |
| Opus-R6 | latency baseline 5-field evidence shape 不统一 | `deferred-with-rationale` | 本轮不回填不存在的 latency evidence，不伪造数据；PP5 closure 起统一 shape、PP6 aggregate latency table 继续承接 | 无代码修改 |
| Opus-R7 | `runtimePolicyFallback` 缺 exhaustive enum check | `fixed` | 改为接收 `SessionApprovalPolicy` 并用 exhaustive switch + `never` check | `workers/orchestrator-core/src/entrypoint.ts` |
| Opus-R8 | PP2 no-saving compact warning noise | `partially-fixed` | breaker 永久自锁已修；PP2 closure 同步说明 no-saving/failed notify 仍需 PP5 alert-rate gate | `workers/agent-core/src/host/compact-breaker.ts`, `docs/issue/pro-to-product/PP2-closure.md` |
| Opus-R9 | Recovery bundle 未形成集中 client 文档 | `fixed` | client cookbook 新增 Reconnect Recovery Bundle playbook | `clients/api-docs/client-cookbook.md` |
| Opus-R10 | PP4 declarative handler 复杂度边界未写明 | `fixed` | hooks.md 写明不支持 nested condition / multi-stage / arbitrary runtime / priority ordering，session.md cross-link | `clients/api-docs/hooks.md`, `clients/api-docs/session.md` |
| Opus-R11 | `session:hooks:v1` storage key versioning 未登记 | `fixed` | hooks.md 与 PP4 closure 登记 v1 key、未来 v2/migration 决策 | `clients/api-docs/hooks.md`, `docs/issue/pro-to-product/PP4-closure.md` |
| Opus-R12 | PP2 prompt mutation 未 cross-e2e 证明 next-turn diff | `deferred-with-rationale` | 不新增假 e2e；PP6 final closure T2 仍按 code+integration evidence 与 cross-e2e deferred 进行 verdict | 无代码修改 |

### 6.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号 | 说明 |
|------|------|------|------|
| 已完全修复 | `22` | DeepSeek-R1/R2/R3/R4/R6/R7/R8/R9/R10; Kimi-R1/R3/R4/R5/R6; Opus-R1/R2/R3/R4/R7/R9/R10/R11 | 真实代码断点、docs drift、hook adapter drift、breaker、wsemit observability 均已落地 |
| 部分修复，需二审判断 | `3` | Kimi-R2; Opus-R5/R8 | cross-e2e 不伪造；closure wording 已对齐；compact noise 的 alert-rate 仍属 PP5 reliability |
| 有理由 deferred | `2` | Opus-R6/R12 | latency aggregate 与 prompt next-turn cross-e2e 属 PP6/future evidence，不在本轮编造 |
| 拒绝 / stale-rejected | `1` | DeepSeek-R5 | `always_allow` 是合法 legacy permission decision / approval_policy，不应加入 confirmation status enum |
| 仍 blocked | `0` | — | 无 |

### 6.4 变更文件清单

- `workers/orchestrator-core/src/facade/routes/session-confirmations.ts` — 修复 wakeup failure supersede、`modified`→`allow` 映射。
- `workers/orchestrator-core/src/confirmation-control-plane.ts` — 支持 attempted terminal row 改写为 `superseded`，并标注 `isKnownKind` future-use seam。
- `workers/agent-core/src/host/compact-breaker.ts` — 增加 7-min cooldown，避免 breaker 永久自锁。
- `workers/orchestrator-core/src/wsemit.ts` — fire-and-forget forward 失败改为 structured warn。
- `workers/orchestrator-core/src/entrypoint.ts` — `runtimePolicyFallback` exhaustive enum check。
- `packages/nacp-session/src/adapters/hook.ts` / `src/index.ts` — package hook adapter 支持 caller provenance。
- `workers/agent-core/src/hooks/catalog.ts` — 明确 PermissionRequest 不做 input mutation。
- `workers/agent-core/src/host/do/session-do-persistence.ts` — 解释 `replayFragment: null` 与 helperStorage-only replay truth。
- `test/cross-e2e/16-pro-to-product-baseline-skeleton.test.mjs` — runtime PATCH 加 `If-Match`。
- `clients/api-docs/hooks.md` — 新增 PP4 hooks canonical API 文档。
- `clients/api-docs/{README,session,session-ws-v1,confirmations,permissions,error-index,client-cookbook}.md` — 同步 hooks、caller、reasons、error codes、wakeup-failed、recovery bundle。
- `docs/issue/pro-to-product/PP{1,2,3,4}-closure.md` — 回标 review-confirmed known issues / fixed follow-up。
- `workers/*/src/generated/package-manifest.ts` — 仅保留 `@haimang/nacp-session` dist hash 变化；已清理 `build_at` 漂移。

### 6.5 验证结果

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|--------|-------------|------|----------------|
| nacp-session typecheck | `pnpm --filter @haimang/nacp-session typecheck` | `pass` | Opus-R4 |
| nacp-session adapter test | `pnpm --filter @haimang/nacp-session test -- test/adapters/adapters.test.ts` | `pass` | Opus-R4 |
| nacp-session build | `pnpm --filter @haimang/nacp-session build` | `pass` | Opus-R4 |
| agent-core typecheck | `pnpm --filter @haimang/agent-core-worker typecheck` | `pass` | DeepSeek-R2, Kimi-R3/R5/R6, Opus-R8 |
| compact breaker test | `pnpm --filter @haimang/agent-core-worker test -- test/host/compact-breaker.test.ts` | `pass` | DeepSeek-R2, Kimi-R5, Opus-R8 |
| agent-core build | `pnpm --filter @haimang/agent-core-worker build` | `pass` | DeepSeek-R2, Kimi-R3/R5/R6, Opus-R8 |
| orchestrator-core typecheck | `pnpm --filter @haimang/orchestrator-core-worker typecheck` | `pass` | DeepSeek-R1/R4/R8/R10, Opus-R7 |
| confirmation route/control/runtime tests | `pnpm --filter @haimang/orchestrator-core-worker test -- test/confirmation-route.test.ts test/confirmation-control-plane.test.ts test/session-runtime-route.test.ts` | `pass` | DeepSeek-R1/R4, Opus-R7 |
| orchestrator-core build | `pnpm --filter @haimang/orchestrator-core-worker build` | `pass` | DeepSeek-R1/R4/R8/R10, Opus-R7 |
| docs consistency | `pnpm run check:docs-consistency` | `pass` | DeepSeek-R3/R6/R7, Kimi-R1, Opus-R1/R2/R3/R9/R10/R11 |
| megafile budget | `pnpm run check:megafile-budget` | `pass` | all code changes |
| envelope drift | `pnpm run check:envelope-drift` | `pass` | docs / envelope safety |
| whitespace | `git --no-pager diff --check` | `pass` | all changed files |
| independent code review | `code-review` agent `pp-review-fix` | `pass` | all changed code/docs diff |

```text
nacp-session adapter targeted tests: 1 file / 9 tests passed.
agent-core compact breaker targeted tests: 1 file / 2 tests passed.
orchestrator-core confirmation/runtime targeted tests: 3 files / 23 tests passed.
docs consistency: 23 docs pass 8 regex checks + 2 required-snippet checks.
megafile budget: 16 owner files within budget.
Independent code-review result: no significant issues found.
```

### 6.6 未解决事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| Kimi-R2 / Opus-R12 | `deferred` | 本轮不能伪造 live cross-e2e；PP1-PP4 当前证据是 targeted worker / route / package tests | PP6 final closure truth-gate verdict；后续 live e2e 专项 |
| Opus-R6 | `deferred` | 没有真实 latency evidence object 就不能回填；本轮只修 contract / runtime gap | PP5 closure 起统一 5-field shape；PP6 aggregate latency table |
| Opus-R8-noise | `deferred` | breaker 自锁已修；warning dedup / alert-rate 需要 PP5 reliability policy 决策 | PP5 Policy & Reliability Hardening |
| DeepSeek-R5 | `rejected` | finding 混淆 `SessionPermissionDecisionEnum` / `SessionApprovalPolicy` 与 `CONFIRMATION_STATUSES` | 无；保持 6-status confirmation registry |

### 6.7 Ready-for-rereview gate

- **是否请求二次审查**：`yes`
- **请求复核的范围**：`all findings`
- **实现者认为可以关闭的前提**：
  1. reviewer 接受 `always_allow` 不属于 confirmation status registry 的拒绝理由。
  2. reviewer 接受 cross-e2e / latency aggregate 不在本轮伪造，继续由 PP6 final closure 承接。
  3. reviewer 确认新增 `hooks.md`、error-index、caller enum、wakeup-failed 文档足以作为 PP6 前的 frontend-facing contract baseline。
