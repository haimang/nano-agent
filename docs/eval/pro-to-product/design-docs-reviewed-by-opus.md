# pro-to-product design 8-pack 审查报告

> 审查对象: `docs/design/pro-to-product/{00-07}*.md` + `PPX-qna.md`(8 份 design + 1 份 owner QnA register)
> 审查类型: `docs-review`
> 审查时间: `2026-05-03`
> 审查人: `Opus 4.7 (1M context)`
> 审查范围:
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> - `docs/design/pro-to-product/02-hitl-interrupt-closure.md`
> - `docs/design/pro-to-product/03-context-budget-closure.md`
> - `docs/design/pro-to-product/04-reconnect-session-recovery.md`
> - `docs/design/pro-to-product/05-hook-delivery-closure.md`
> - `docs/design/pro-to-product/06-policy-reliability-hardening.md`
> - `docs/design/pro-to-product/07-api-contract-docs-closure.md`
> - `docs/design/pro-to-product/PPX-qna.md`
> 对照真相:
> - `docs/charter/plan-pro-to-product.md` (v0.active.2)
> - `docs/charter/review/plan-pro-to-product-reviewed-by-opus.md`
> - `docs/issue/hero-to-pro/HPX7-closure.md`
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
> - 真实 codebase (`workers/agent-core/`、`workers/orchestrator-core/`、`workers/context-core/`、`packages/nacp-session/`、`clients/api-docs/`)
> 文档状态: `reviewed`

---

## 0. 总结结论

> 一句话 verdict:**8 份 design + 1 份 QnA register 已可作为 pro-to-product 阶段的 design baseline 进入下一步 action-plan 拆解,但有 4 处真实断点需要在 PP1/PP2/PP3/PP4 各自 action-plan 启动前补完,否则会让 truth gate 在执行期被深度博弈。**

- **整体判断**:`整体设计成立、引用准确、与 charter 一致;但有 1 处 cross-phase ordering、1 处 PP2 scope 二义性、1 处 PP4 与 catalog 现状冲突、1 处 PP3 HTTP/WS 不对称未明确,需要在 action-plan 阶段冻结。`
- **结论等级**:`approve-with-followups`
- **是否允许关闭本轮 review**:`yes`(design 阶段允许 closure;但 action-plan 启动前必须先在 QnA 或对应 design 增补这 4 个断点的明确判定)
- **本轮最关键的 1-3 个判断**:
  1. **8 份 design 的 30+ 处一手代码引用全部经过逐一校验,行号精确、语义正确**(详见 §1.1 与 §1.3),这意味着 design 不是凭印象写的,而是真在读代码 — 这是把 charter 的 truth-gate 主张落地的最低门槛。
  2. **存在 1 个 PP2 scope 真断点**(详见 R4):03 design F3 把"真接通 runtime compact"和"explicit degraded"写成"二选一",但 charter §10.1 T2 硬闸要求"prompt 真实缩减",explicit degraded 不能满足 T2。这条二义性必须在 PP2 action-plan 启动前由 owner 明确,否则 PP2 closure 会出现"compact 接通"vs"compact 标 not-live"的 16 个工时级别分歧。
  3. **存在 1 个 PP4 与已冻结代码注释的现状冲突**(详见 R3):catalog.ts:158-159 已硬编码 "Fail-closed: handlerCount === 0 → denied",而 PPX-qna Q17 默认答案是 "fallback confirmation"。owner 在回答 Q17 时不知道这条已 frozen 的 catalog 注释 — 必须在 Q17 reasoning 中点出这一冲突,否则 owner 选 fallback 路径后才发现 catalog/dispatcher 也要改。

---

## 1. 审查方法与已核实事实

### 1.0 审查方法

本次审查执行的步骤:

1. **完整阅读 8 份 design 与 1 份 PPX-qna**,逐节比对 charter `docs/charter/plan-pro-to-product.md` v0.active.2 的 7 phase 划分、7 truth gates、5 项受控 D1 例外法律、§6.4 frontend engagement schedule。
2. **对每份 design §8.4 (本仓库 precedent / 需要避开的反例) 列出的 30+ 处代码 file:line 进行逐一打开核对**,记录引用行号是否对应实际语义。
3. **对每个 design §1.2 (参考调查报告) 与 §9.1 (owner/architect 决策登记) 进行交叉核对**,确认 design D-xx 与 PPX-qna Q1-Q22 的对应关系。
4. **对引用的 `clients/api-docs` 行号(README、session-ws-v1、runtime、context、confirmations、error-index)进行长度核对**,确认所有引用未越界。
5. **对一些会决定 phase scope 的关键事实做了独立反向验证**:
   - PreToolUse 是否有 production caller (见 §1.3 R3)
   - persist/restore 路径是否对称 (见 §1.3 R6)
   - executor non-stream vs stream 重试差异 (见 §1.3)

### 1.1 已确认的正面事实

- **F1 (引用准确性)**:8 份 design 的 §8.4 与 §7.2 中合计引用本仓库 30+ 个 file:line 区间。逐一打开后,以下全部经过验证为**行号准确、语义正确**:
  - `workers/agent-core/src/host/runtime-mainline.ts:235-261` — `authorizeToolPlan()` 把 `decision === "ask"` 映射成 `tool-permission-required` error,完全符合 design 02 §8.4 与 design 06 §8.4 的引用 ✓
  - `workers/agent-core/src/host/runtime-mainline.ts:833-836` — `requestCompact()` 返回 `{ tokensFreed: 0 }`,符合 design 03 §8.4 ✓
  - `workers/agent-core/src/host/runtime-mainline.ts:813-830` — hook 委托段;dispatcher 不存在退化 no-op,blocked 时 throw,符合 design 05 §8.4 ✓
  - `workers/agent-core/src/host/do/session-do-runtime.ts:378-415` — `emitPermissionRequestAndAwait()` + `emitElicitationRequestAndAwait()` 都已存在,permission/elicitation substrate 完整 ✓ (design 02 仅引用 378-397 即只覆盖 permission;见 §1.2 R1)
  - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:155-161` — `createSessionHookDispatcher()` 无条件构造 HookRegistry + LocalTsRuntime + HookDispatcher,符合 design 05 §8.4 ✓
  - `workers/agent-core/src/host/do/session-do-persistence.ts:142-187,193-222` — `persistCheckpoint` 调用 `helper.checkpoint()`,但 line 176 硬编码 `replayFragment: null`;`restoreFromStorage` 不调用 `helper.restore()`。design 04 §8.4 描述方向正确 ✓ (但深度不够;见 §1.2 R6)
  - `workers/orchestrator-core/src/facade/routes/session-runtime.ts:129-207` — ETag 计算 + If-None-Match 304 + If-Match 409 完整,与 design 01/06 §8.4 一致 ✓
  - `workers/orchestrator-core/src/facade/routes/session-control.ts:414-449` — decision row write + 同步 `session.confirmation.update` emit,符合 design 02 §8.4 row-first 描述 ✓
  - `workers/orchestrator-core/src/confirmation-control-plane.ts:96-131` — `D1ConfirmationControlPlane.create()` 写 `pending` row,符合 design 02 §8.4 ✓
  - `workers/orchestrator-core/src/user-do/ws-runtime.ts:72-145,86-110,133-145,237-245` — replay cursor `min(relay_cursor, last_seen_seq)`、attachment supersede、markDetached 全部按 design 04 §8.4 描述存在 ✓
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:280-319` — `handleResume()` 在 `body.last_seen_seq > acknowledged` 时记录 `session.replay_lost` audit,但**返回 body 仍是 `replay_lost: true` 字段**,没有"frontend-visible degraded frame"。design 04 F3 描述准确(HTTP 端已 honest,WS 端缺等价) ✓
  - `workers/orchestrator-core/src/entrypoint.ts:328-379` — `authorizeToolUse()` decision order:session-rule → tenant-rule → approval-policy fallback,与 design 06 §8.4 引用一致 ✓
  - `workers/orchestrator-core/src/runtime-config-plane.ts:51-64` — `network_policy.mode` 默认 `"restricted"`,`web_search.mode` 默认 `"disabled"`,`approval_policy` 默认 `"ask"` ✓
  - `workers/agent-core/src/llm/request-builder.ts:34-120` — 仅做 capability validation(model/provider/stream/tools/jsonSchema/vision/reasoning),**完全没有 token-window preflight**,符合 design 03 §8.4 ✓
  - `workers/agent-core/src/llm/executor.ts:59-132` — `execute()` 有完整 retry loop(maxRetries / 429 rotation / exponential backoff / `RETRY_EXHAUSTED`)✓
  - `workers/agent-core/src/llm/executor.ts:134-198` — `executeStream()` 在 `!response.ok` 时直接 throw,**无重试循环**,符合 design 06 §8.4 描述 ✓
  - `workers/agent-core/src/hooks/registry.ts:18-72` — `register()/lookup()/unregister()` 完整,priority 层级 `platform-policy > session > skill`,符合 design 05 §8.4 ✓
  - `workers/agent-core/src/hooks/catalog.ts:92-165` — PreToolUse blocking + allowedOutcomes、PermissionRequest blocking + "Fail-closed: handlerCount === 0 → denied" 注释,符合 design 05 §8.4 ✓ (但与 PPX-qna Q17 默认建议有冲突;见 §1.2 R3)
  - `workers/orchestrator-core/src/context-control-plane.ts:394-511` — `createCompactBoundaryJob()` 写 snapshot/checkpoint/message + emit `compact.notify`,符合 design 03 §8.4 ✓
  - `workers/orchestrator-core/src/facade/route-registry.ts:16-60` — `dispatchFacadeRoute()` 共 12 个 handler 顺序,符合 design 07 §8.4 ✓
  - `packages/nacp-session/src/messages.ts:279-302` — confirmation 7-kind + 6-status enum,符合 design 02 §8.4(`tool_permission/elicitation/model_switch/context_compact/fallback_model/checkpoint_restore/context_loss`)✓
  - `packages/nacp-session/src/replay.ts:58-73` — `replay()` 当 `fromSeq < buf.baseSeq` 时直接 throw `NACP_REPLAY_OUT_OF_RANGE`,符合 design 04 §8.4 ✓
  - `packages/nacp-session/src/stream-event.ts:75-80` — `hook.broadcast` schema 存在,符合 design 05 §8.4 ✓
  - `packages/nacp-core/src/observability/logger/system-error.ts:41-67` — `system.error` structured event 存在,符合 design 06 §8.4 ✓
  - `clients/api-docs/` — 共 22 份 markdown 文件,与 design 07 §1.1 "22-doc pack" 完全一致 ✓
  - `clients/api-docs/context.md:196-207` — Deferred 表(auto-compact / cross-turn / strip-recover / circuit-breaker / 60s preview cache),与 design 03 §8.4 引用一致 ✓
  - `workers/agent-core/src/hooks/catalog.ts` 共声明 18 个 hook event,与 charter §4.2 O4 "14/18" 描述一致 ✓
- **F2 (与 charter v0.active.2 一致)**:8 份 design 的 phase 划分、truth gate 编号、§4.5 D1 例外法律、§6.4 FE-1/FE-2/FE-3、§9.2 latency baseline 都与 charter v0.active.2 完全对齐;Opus charter review 的 4 个断点(B1 latency baseline / B2 frontend engagement / B3 DDL anchor / B4 hook register 现状)中,B1 与 B2 已被 design 00 §3.2/§9 与 design 01 §6 显式吸收,B4 已被 design 05 §5.3 用 "evaluation/durable-promotion-registry 不是 hook handler registry" 显式排除 ✓
- **F3 (PPX-qna 完整覆盖)**:Q1-Q22 22 个问题,与 8 份 design 的 D-00-x..D-07-x 决策表存在严格映射(Q1↔D-00-1, Q2↔D-00-2, Q3↔D-01-1, Q4↔D-01-3, Q5↔Q3+D-00-3+D-01-2+D-07-1, Q6↔D-02-1, ...) ✓
- **F4 (设计层方法论稳定)**:8 份 design 都遵循同一份 `docs/templates/design.md` 模板,§3 精简点/接口保留点/解耦点/聚合点都按"砍-留-解耦-聚合"四向写完。这意味着进入 action-plan 阶段时,reviewer 不需要重新争论"设计要保留什么扩展点" — 这是 design baseline 进入执行的标准信号。
- **F5 (与已 closed 阶段事实一致)**:8 份 design 都没把 hero-to-pro 已 closed/known-issues 的项重新激活;HPX7 7 项 closure verdict 全被尊重(没有 design 试图回头改 H1-H6);hero-to-pro 4 项 owner-action retained 没被任何 design 错误吸收。

### 1.2 已确认的负面事实

下列**已经过独立反向验证**的负面事实,直接对应 §2 finding 列表中的 R1-R10。这些都是真实存在的断点/盲点/不一致,不是猜测。

- **N1 — Design 02 §8.4 引用 `session-do-runtime.ts:378-397` 仅覆盖 permission substrate**,实际 elicitation substrate 在同一文件 `399-415`。Design 02 §5.1 S2 明确把 elicitation 列为 in-scope,但 §8.4 reference 行号未覆盖。这是 R1。
- **N2 — Design 04 §8.4 引用 `session-do-persistence.ts:154-160,193-222` 描述方向正确**,但**未识别 line 176 `replayFragment: null` 是硬编码**。这意味着即便后续 PP3 把 `restoreFromStorage` 接到 `helper.restore()`,持久化端的 helper 数据仍然是 `null`,restore 会读到空。PP3 必须改两处(persist 端写真实 helper checkpoint + restore 端调用 helper.restore())才能完整闭合 G3 / T3 truth gate。这是 R6。
- **N3 — Design 05 §8.4 引用 `runtime-mainline.ts:816-830` 描述为"hook emit blocked throw seam"**,但**实际 production grep 显示 PreToolUse 没有任何 production caller**。`hook.emit("PreToolUse", ...)` 仅出现在 `test/host/runtime-mainline.test.ts:167,193`;`workers/agent-core/src/kernel/runner.ts:419` 的 `delegates.hook.emit(decision.event, {})` 只在 `StepDecision.kind === "hook_emit"` 时触发,而当前 kernel decision tree 不会产出 PreToolUse `hook_emit` decision。这意味着 PP4 不仅要"接通 dispatcher 的 outcome",还要**新增 production caller 把 PreToolUse 在工具执行前 emit**。Design 05 §7.2 F2 表述"PreToolUse caller 在每个真实 tool 之前执行"是对的,但 §8.4 引用让人误读为"caller 已经存在,只差 outcome 转换"。这是 R3。
- **N4 — `workers/agent-core/src/hooks/catalog.ts:158-159` 注释已硬编码** "Fail-closed: when the capability executor observes zero registered handlers (handlerCount === 0) it treats the request as denied"。**而 PPX-qna Q17 默认建议是 "fallback confirmation"**(见 PPX-qna.md:257)。两者直接冲突 — owner 在回答 Q17 时如果选 fallback 路径,意味着 catalog 注释 + dispatcher fail-closed guard 都要同步改动。Q17 reasoning 段中没有指出这一冲突,owner 可能在不知情下做出"fallback 优先"决策。这是 R3 的同一根因(PP4 设计与 catalog frozen 状态的冲突)。
- **N5 — `workers/orchestrator-core/src/entrypoint.ts:349`**:当 `db missing` 时 `authorizeToolUse` 返回 `{ decision: "ask", source: "unavailable" }`。该 `ask` 会被 `runtime-mainline.ts:252-260` 翻译成 `tool-permission-required` error。**Design 06 §7.2 F2 已识别这一点**,但只说"前端/agent 不应误解为正常 user ask",没把 `unavailable→ask→error` 这条完整路径与 PP1 主线 ask 区分开 — 有概率被 PP5 action-plan 解读成"PP5 不用动 unavailable,PP1 改 ask 即可"。Q20 答案"禁止 silent allow"是对的,但语义覆盖不到 unavailable→ask→error 这一变体。这是 R5。
- **N6 — `workers/orchestrator-core/src/user-do/surface-runtime.ts:311-320`** — `handleResume()` 已经能在 `last_seen_seq > acknowledged` 时返回 `replay_lost: true` 字段,**HTTP 端已 frontend-visible**。但 `ws-runtime.ts` 中**WS attach 端没有等价 degraded frame**。Design 04 F3 已正确指出这一不对称,但 PPX-qna Q14("禁止 silent fallback")没把 HTTP/WS 双面分别讨论。owner 答 yes 后,PP3 action-plan owner 仍需自行判断:仅补 WS 端,还是要求 HTTP+WS 完全对齐。这是 R7。
- **N7 — Design 03 §7.3** 写 "probe/preview ≤3s alert threshold",而 charter §9.2 的 3s 阈值是 **"compact 完成或 explicit degrade"**,不是 probe/preview。命名差异看似小,但会让 PP2 owner 误以为只要 probe ≤3s 就达 baseline,而漏掉真正的 compact 测量。这是 R8。
- **N8 — Design 02 / 04 都把 `session-do-runtime.ts` 列为关键改动面**,charter §6.3 #3 / §8.3 Build Gate 已规定"共享 owner file 的高频改动窗口已稳定"才能进入下一 phase,但**两份 design 都没定义"PP1 何时算稳定"的可执行判据**。02 §10 说"会成为后续 PP3 的共享改动面,需尽早稳定";04 §10 说"启动时机必须后移到 PP1 稳定后" — 双向都识别风险,但都把判定权推给对方。这是 R10。
- **N9 — Design 03 §7.2 F3** 把"必须替换为 context-core durable compact"和"explicit degraded"写成"二选一",但**charter §10.1 T2** 是硬闸要求"compact 后下一个 LLM request 的 prompt 能被证明真实缩减" — explicit degraded **不能** 满足 T2(degraded 不等于 prompt mutation)。如果 PP2 owner 选 degraded 路径,等于把 T2 直接推到下一阶段,这相当于 charter 的硬闸被设计层悄悄放宽。PPX-qna 没有专门一题让 owner 拍板这条二义性。这是 R4。
- **N10 — PPX-qna Q17 reasoning** 写 "纯 fail-closed 最安全...优先回退到现有 confirmation,更能复用 PP1 的真实 interrupt substrate,同时仍然维持安全边界" — 但 fallback confirmation 实际上**比 fail-closed 弱**(fail-closed = 默认拒绝;fallback confirmation = 默认问用户,用户可 allow)。Reasoning 把两者写成"安全等级等价、仅差体验",会让 owner 误判选择含义。这是 R9。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 30+ 处引用全部 `Read` 工具打开核对;包括 `runtime-mainline.ts:235-261/813-836`、`session-do-runtime.ts:378-415`、`session-do-persistence.ts:142-222`、`session-runtime.ts:129-207`、`session-control.ts:414-449`、`confirmation-control-plane.ts:96-131`、`ws-runtime.ts:72-245`、`surface-runtime.ts:280-319`、`entrypoint.ts:328-379`、`runtime-config-plane.ts:45-64`、`request-builder.ts:34-120`、`executor.ts:59-198`、`hooks/registry.ts:1-72`、`hooks/catalog.ts:85-180`、`context-control-plane.ts:394-435`、`route-registry.ts:1-60`、`messages.ts:275-332`、`replay.ts:50-99` 等 |
| 本地命令 / 测试 | `partial` | 未跑 `pnpm test`;但跑了 `wc -l`、`grep -rnE` 做 production caller 验证(如 `grep "PreToolUse"` 跨 src 与 test) |
| schema / contract 反向校验 | `yes` | 7-kind confirmation enum、18-event hook catalog、22-doc clients/api-docs pack 全部独立 grep 计数核对 |
| live / deploy / preview 证据 | `n/a` | 本轮是 design review;未要求 live evidence |
| 与上游 design / QNA 对账 | `yes` | 22 个 PPX-qna Q 与 8 份 design 的 D-xx-y 决策做了交叉映射 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | Design 02 §8.4 elicitation substrate 引用行号不全 | low | docs-gap | no | 02 §8.4 reference 改为 `378-415` 即可 |
| R2 | Design 02 / 04 / 05 反向引用 00/01 不一致 | low | docs-gap | no | 02-07 在 §1.2 都补对 00/01 的引用 |
| R3 | Design 05 与 catalog.ts:158-159 + PPX-qna Q17 三者形成 deadlock,且 PreToolUse 当前无 production caller | medium | scope-drift / correctness | yes(action-plan 启动前必须解开) | Q17 reasoning 必须显式点出 catalog frozen 注释,且 05 design §7.2 F2 表述要明确 "新增 PreToolUse production caller" 而非 "改 outcome 转换" |
| R4 | Design 03 F3 把"runtime compact bridge"和"explicit degraded"写成二选一,但 T2 硬闸不接受 degraded | medium | correctness / scope-clarity | yes(action-plan 启动前必须解开) | PPX-qna 增加一题或 03 design 增补"PP2 闭合必须满足 T2 prompt mutation,不能用 degraded 替代;若工程上必须 degraded,则 charter §10.1 T2 同步降级" |
| R5 | Design 06 F2 关于 db-missing→ask→error 链路语义说明不充分 | low | correctness | no | 06 §7.2 F2 增补一句:`unavailable` 必须 fail-visible,不允许走 PP1 ask interrupt 路径 |
| R6 | Design 04 §8.4 未指出 persist 端 line 176 `replayFragment: null` 硬编码 | medium | delivery-gap | yes(action-plan 启动前必须解开) | 04 §7.2 F1 + §8.4 增补 persist 端必修;否则 PP3 只补 restore 端是无效闭合 |
| R7 | Design 04 / Q14 未明确 HTTP/WS 端 degraded 行为是否必须对齐 | low | scope-clarity | no | 04 §7.2 F3 或 Q14 reasoning 增补:HTTP 端已 honest,PP3 主修 WS 端;是否要求 HTTP/WS API shape 同构由 PP3 action-plan 决议 |
| R8 | Design 03 §7.3 把 charter §9.2 compact ≤3s 阈值改写为 "probe/preview ≤3s" | low | docs-gap | no | 03 §7.3 改回 "compact 完成或 explicit degrade ≤3s",probe/preview 不是 charter baseline |
| R9 | PPX-qna Q17 reasoning 把 fail-closed 与 fallback confirmation 写成等价安全 | low | docs-gap / correctness | no | Q17 reasoning 改写:明确两条路径的安全语义差异,owner 拍板时知道选择含义 |
| R10 | Design 02 / 04 共享 `session-do-runtime.ts` owner file,charter §8.3 Build Gate "稳定" 判据未在 design 中可执行化 | medium | delivery-gap / coordination | yes(action-plan 启动前必须解开) | 04 §6.3 增补 "PP3 启动 gate = PP1 closure 写明 `session-do-runtime.ts` 主线已稳定 + 7 工作日内无新 hotfix" 或等价可执行判据 |
| R11 | Design 07 §8.4 PP6 sweep target 列举不全(漏 permissions.md / workspace.md / transport-profiles.md / worker-health.md) | low | delivery-gap | no | 07 §8.4 或 PP6 action-plan 显式列举 22 份逐一对账 |
| R12 | 8 份 design 都未在 §0 / §3 显式重申 charter §4.5 D1 例外法律 | low | docs-gap | no | 02-06 design 在 §3.3 完全解耦点增补 "本 phase 默认 zero migration;若需例外按 charter §4.5 申请 ≥018 编号" |
| R13 | Design 05 PostToolUseFailure / Stop 等 13 类非 user-driven hook 没有明确 PP4 是否 in-scope | low | scope-clarity | no | 05 §5.3 增补:除 PreToolUse/PostToolUse/PermissionRequest 外的 14 类 hook 在 PP4 内仅 substrate-ready,closure 不要求 |

### R1. Design 02 §8.4 elicitation substrate 引用行号不全

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `docs/design/pro-to-product/02-hitl-interrupt-closure.md:307` 引用 `workers/agent-core/src/host/do/session-do-runtime.ts:378-397` 标注为 "legacy permission request + await substrate"
  - 真实代码 `workers/agent-core/src/host/do/session-do-runtime.ts:378-415` 同时包含 `emitPermissionRequestAndAwait()` (378-397) 与 `emitElicitationRequestAndAwait()` (399-415)
  - design 02 §5.1 S2 与 §7.1 F1/F2/F3 都明确把 elicitation 列为 in-scope
- **为什么重要**:
  - design 与 action-plan 之间 reference 是 evidence chain;只引一半 substrate 会让 action-plan owner 误以为 elicitation 还要从零造一遍,而非复用 await primitive
- **审查判断**:
  - 不影响设计正确性,但会让 PP1 action-plan 的工时估算偏高
- **建议修法**:
  - design 02 §8.4 reference 行号改为 `378-415`,并在描述里加 "permission + elicitation 共用同一份 row-first await primitive"

### R2. 02-07 design 反向引用 00/01 不一致

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - design 00 §2.2 矩阵把 `00 → 02..07` 全部标 强耦合
  - design 01 §2.2 矩阵把 `01 → 02..07` 全部标 强或中耦合
  - design 02 §1.2 引用了 00/01 ✓
  - design 03 §1.2 只引 00,未引 01
  - design 04 §1.2 没引 00 也没引 01
  - design 05 §1.2 只引 00
  - design 06 §1.2 引了 00 与 02
  - design 07 §1.2 没引 00,只引 01-06
- **为什么重要**:
  - PP6 docs sweep 阶段会按 evidence chain 追溯每个 design 的依赖;反向引用不一致会让 audit 漏掉 cross-cutting 影响
- **审查判断**:
  - 不影响设计正确性,但削弱 design 之间的 evidence chain
- **建议修法**:
  - 02-07 在 §1.2 都显式列出对 00/01 的引用,不论强弱

### R3. Design 05 与 catalog.ts:158-159 + PPX-qna Q17 形成 deadlock,且 PreToolUse 当前无 production caller

- **严重级别**:`medium`
- **类型**:`scope-drift / correctness`
- **是否 blocker**:`yes`(PP4 action-plan 启动前必须解开)
- **事实依据**:
  - `workers/agent-core/src/hooks/catalog.ts:158-159` 注释:`Fail-closed: when the capability executor observes zero registered handlers (handlerCount === 0) it treats the request as denied.`
  - `docs/design/pro-to-product/PPX-qna.md:257` Q17 默认建议:`优先 fallback confirmation;只有 confirmation substrate 不可用时才 fail-closed`
  - `grep -rnE "['\"]PreToolUse['\"]" workers/agent-core/src/ packages/ | grep -v test/` 仅返回 `packages/nacp-core/src/hooks-catalog/index.ts:7` (枚举定义) — 无任何 production caller
  - `grep -rnE "deps\.hook\.emit|hookDispatcher\.emit"` 在 src/ 里**只有** `runtime-mainline.ts:813-830` 的委托 seam + `kernel/runner.ts:419` 的 `delegates.hook.emit(decision.event, {})` 唯一一处生产 emit;后者只在 `StepDecision.kind === "hook_emit"` 时触发,而当前 kernel decision tree 不会产出 PreToolUse decision
  - `docs/design/pro-to-product/05-hook-delivery-closure.md:307` 把 `runtime-mainline.ts:816-830` 引用为 "hook emit blocked throw — effect seam"
- **为什么重要**:
  - **三重冲突**:
    1. catalog.ts 已 frozen "fail-closed",但 Q17 默认是 "fallback confirmation"
    2. owner 不知道 catalog frozen 注释存在,可能在 Q17 选 fallback,然后才发现 catalog 注释也要改
    3. design 05 §8.4 reference 让 owner 误以为 "PreToolUse caller 已存在,只是 outcome 转换问题",但实际 PreToolUse 完全没有 production caller — PP4 必须**新增** caller
  - 如果 PP4 action-plan 在不解开这三重冲突的情况下启动,会出现:
    - owner 选 Q17 fallback → PP4 改 dispatcher fail-closed 行为 → 与 catalog frozen 注释冲突 → catalog 注释也要改 → 但这条改动在 design 05 完全没声明
    - 或:owner 选 fail-closed → PP4 closure 与 PPX-qna 默认建议不一致 → final closure verdict 出现"design 默认建议未被采纳但未声明为何"
- **审查判断**:
  - 这是 design 阶段最严重的真断点;不算 blocker 是因为可以通过补 1-2 段 reasoning 解决,但**必须**在 PP4 action-plan 启动前解决
- **建议修法**:
  - **必修 1**:PPX-qna Q17 的 reasoning 段增补:`选择 fallback confirmation 路径的副作用 = 必须同步修改 workers/agent-core/src/hooks/catalog.ts:158-159 的 "Fail-closed: handlerCount === 0 → denied" 注释,以及 dispatcher 中对应的 fail-closed guard;owner 在拍板时应明确愿意承担这条同步修改`
  - **必修 2**:design 05 §7.2 F2 描述改为 `当前 PreToolUse 无 production caller,仅在 test 中存在;PP4 必须新增 production caller 把 PreToolUse 在每个真实 tool 执行前 emit,并通过 dispatcher 的 outcome 决定 block/updatedInput/continue`
  - **必修 3**:design 05 §8.4 reference 改写 — `runtime-mainline.ts:816-830` 描述为 "hook 委托 seam(无 production caller emit PreToolUse;PP4 必须新增 caller)"

### R4. Design 03 F3 把"runtime compact bridge"和"explicit degraded"写成二选一,但 T2 硬闸不接受 degraded

- **严重级别**:`medium`
- **类型**:`correctness / scope-clarity`
- **是否 blocker**:`yes`(PP2 action-plan 启动前必须解开)
- **事实依据**:
  - `docs/design/pro-to-product/03-context-budget-closure.md:248` Design 03 §7.2 F3:`当前 runtime-mainline.ts:833-836 返回 { tokensFreed: 0 },必须替换为 context-core durable compact 或 explicit degraded`
  - `docs/charter/plan-pro-to-product.md:629` charter §10.1 T2:`Context truth:compact 后下一个 LLM request 的 prompt 能被证明真实缩减,不再只是 notify / bookkeeping`
  - PPX-qna 中无对应一题让 owner 选择 "T2 硬闸是否允许 degraded 替代"
- **为什么重要**:
  - **explicit degraded ≠ prompt mutation**。Degraded 只表示 "compact 没真正发生,前端被告知";T2 要求的是 "下一个 LLM request 的 prompt 真实缩减"
  - 如果 PP2 owner 选 degraded 路径,T2 仍然不绿;但 design 03 把它和 "真接通" 并列写成 "二选一",会让 PP2 closure 出现:
    - "我们做了 explicit degraded,F3 完成,可以 closure" vs "T2 仍未绿,不允许 closure" 的内部争议
  - 这种二义性在 PP2 末期才暴露,会出现 16 工时级别的返工或 charter 临时修订
- **审查判断**:
  - 必须在 PP2 action-plan 启动前由 owner 拍板:T2 硬闸是否允许 degraded 替代,还是必须真接通 runtime compact bridge
- **建议修法**:
  - **必修 1**:在 PPX-qna 增加一题(暂编 Q23):`PP2 closure 是否必须满足 charter §10.1 T2 "prompt 真实缩减",explicit degraded 不能替代?如果工程上 degraded 是唯一可行路径,charter §10.1 T2 是否同步降级,或 T2 推迟到下一阶段?`
  - **必修 2**:design 03 §7.2 F3 改为 `PP2 closure 路径(必修):接通 context-core durable compact 使 runtime-mainline.ts:833-836 不再返回 {tokensFreed:0};不接受 explicit degraded 作为 T2 替代,除非 charter §10.1 T2 同步修订`

### R5. Design 06 F2 关于 db-missing→ask→error 链路语义说明不充分

- **严重级别**:`low`
- **类型**:`correctness`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/orchestrator-core/src/entrypoint.ts:349` `if (!db) return { ok: false, decision: "ask", source: "unavailable", reason: "db-missing" };`
  - `workers/agent-core/src/host/runtime-mainline.ts:252-260` `result.decision === "ask"` 会被翻译成 `tool-permission-required` error
  - `docs/design/pro-to-product/06-policy-reliability-hardening.md:246` Design 06 §7.2 F2 边界情况:`db missing 当前返回 ask/unavailable,前端/agent 不应误解为正常 user ask`
  - PPX-qna Q20 默认:`policy plane unavailable 时不允许 silent allow,而必须显式 deny / degraded / error surfaced`
- **为什么重要**:
  - Q20 答案 "禁止 silent allow" 是对的,但**没有明确禁止 silent ask**(unavailable 当前走 ask 路径,被翻译成 tool error,前端不知道这是"控制面挂了"而非"用户拒绝")
  - 06 design F2 已识别问题,但表述模糊;PP5 action-plan owner 可能解读成 "PP5 只管 silent allow 禁止,silent ask 是 PP1 范围"
- **审查判断**:
  - 不算 blocker,但 PP5 的 enforce matrix 必须明确 unavailable 的 frontend-visible 表达
- **建议修法**:
  - design 06 §7.2 F2 增补:`db / policy plane unavailable 时,authorizeToolUse 当前走 "ask + unavailable" 路径并被 runtime 翻译成 tool-permission-required error;PP5 必须改为 fail-visible(structured system.error 或 explicit unavailable degraded),不允许借 PP1 ask 主线吞掉控制面故障`

### R6. Design 04 §8.4 未指出 persist 端 line 176 `replayFragment: null` 硬编码

- **严重级别**:`medium`
- **类型**:`delivery-gap`
- **是否 blocker**:`yes`(PP3 action-plan 启动前必须解开)
- **事实依据**:
  - `workers/agent-core/src/host/do/session-do-persistence.ts:154-160`:`if (helper && helperStorage) { await helper.checkpoint(helperStorage); }` — helper 持久化逻辑存在
  - `workers/agent-core/src/host/do/session-do-persistence.ts:176`:`replayFragment: null` — 写入 D1 storage 的 checkpoint 主体里,helper checkpoint 数据**没有**进入这个 fragment
  - `workers/agent-core/src/host/do/session-do-persistence.ts:193-222`:`restoreFromStorage` 仅恢复 `actorPhase / kernelSnapshot / turnCount`,**完全不调用** `helper.restore()`
  - `docs/design/pro-to-product/04-reconnect-session-recovery.md:305` Design 04 §8.4:`session-do-persistence.ts:154-160,193-222 — helper checkpoint writes but restore only restores main checkpoint — internal/public recovery 不可混淆`
- **为什么重要**:
  - Design 04 的描述方向正确,但**只点出 restore 端的缺失,没点出 persist 端的硬编码**
  - 如果 PP3 action-plan owner 只读 design 04 §8.4 就开工,会**只补 restore 端**,以为 G3/T3 已闭合 — 但 persist 端 `replayFragment: null` 意味着 restore 即便 wired 也读到空,helper replay 数据永远丢失
  - 这是 charter §10.1 T3 "Reconnect truth" 的真闭环必修两步:
    1. persist 端把 helper checkpoint 数据写进 `replayFragment` (而不是 null)
    2. restore 端调用 `helper.restore(persistedFragment)`
- **审查判断**:
  - design 描述方向正确但深度不够,会导致 action-plan 漏修一半
- **建议修法**:
  - design 04 §7.2 F1 (Reconnect Cursor Law) 改名/扩展为 "Replay Persistence + Restore Symmetry",增补:`PP3 必修两步:(a) session-do-persistence.ts:176 把 replayFragment: null 替换为 helper.checkpoint() 输出;(b) restoreFromStorage 调用 helper.restore(replayFragment)。仅修任一端无效`
  - design 04 §8.4 reference 增补 file:line,显式指出 line 176 的硬编码

### R7. Design 04 / Q14 未明确 HTTP/WS 端 degraded 行为是否必须对齐

- **严重级别**:`low`
- **类型**:`scope-clarity`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:280-319` HTTP `handleResume()` 在 `last_seen_seq > acknowledged` 时返回 `replay_lost: true` body 字段(已 frontend-visible)
  - `workers/orchestrator-core/src/user-do/ws-runtime.ts:72-156` WS attach 时**没有等价 degraded frame**(replay 由 `forwardFramesToAttachment` 静默执行,if `frame.seq <= cursor` 则跳过)
  - `docs/design/pro-to-product/04-reconnect-session-recovery.md:247` Design 04 §7.2 F3:`当前 surface-runtime.ts:280-319 的 HTTP resume 能判断 last_seen_seq > relay_cursor 并记录 session.replay_lost,但 WS attach 还缺等价 frontend-visible degraded`
  - PPX-qna Q14 默认:`禁止 silent fallback。必须显式 degraded / replay_lost`
- **为什么重要**:
  - Q14 表述笼统,owner 可能答 yes 后,PP3 action-plan owner 仍不知道:
    - 是否要求 WS attach 时新增 `session.replay.lost` top-level frame
    - 还是只要 HTTP resume 端 honest 即可,前端必须先 HTTP resume → 再 WS attach
  - 这是会影响前端集成方案的边界差异
- **审查判断**:
  - 不算 blocker,但 PP3 action-plan 必须先选定其中之一
- **建议修法**:
  - PPX-qna Q14 reasoning 增补:`当前 HTTP resume 端已 frontend-visible(返回 replay_lost: true);WS attach 端缺等价 degraded frame。owner 答 yes 时应进一步明确:(a) PP3 必须为 WS attach 新增等价 top-level degraded frame,或 (b) docs 明确前端必须先 HTTP resume 再 WS attach,WS 端不强制对齐`

### R8. Design 03 §7.3 把 charter §9.2 compact ≤3s 阈值改写为 "probe/preview ≤3s"

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `docs/charter/plan-pro-to-product.md:603` charter §9.2:`compact 完成或 explicit degrade 建议 ≤ 3s`
  - `docs/design/pro-to-product/03-context-budget-closure.md:265` Design 03 §7.3:`probe/preview ≤3s alert threshold`
- **为什么重要**:
  - 命名差异让 PP2 owner 误以为只要 probe ≤3s 就达 baseline,而漏掉真正的 compact 完成测量;两者是不同代码路径
- **审查判断**:
  - 是 docs 笔误级别的 drift,但属于 PP6 Frontend Trust 的 latency baseline,必须诚实
- **建议修法**:
  - design 03 §7.3 改为 `compact 完成或 explicit degrade ≤3s alert threshold(charter §9.2);probe/preview 不在 charter baseline 范围`

### R9. PPX-qna Q17 reasoning 把 fail-closed 与 fallback confirmation 写成等价安全

- **严重级别**:`low`
- **类型**:`docs-gap / correctness`
- **是否 blocker**:`no`
- **事实依据**:
  - `docs/design/pro-to-product/PPX-qna.md:258` Q17 reasoning:`纯 fail-closed 最安全,但会把"没注册 handler"直接放大成产品死端;优先回退到现有 confirmation,更能复用 PP1 的真实 interrupt substrate,同时仍然维持安全边界`
- **为什么重要**:
  - **fail-closed = 默认 deny**(用户即便点击也不能 allow,因为 handler 缺失就是 deny)
  - **fallback confirmation = 默认 ask user**(用户可以 allow,handler 缺失 = 把决策权交给用户)
  - 两者**不是等价安全等级**,是不同的产品策略
  - reasoning 写成 "都安全,只是体验差异" 会让 owner 在不理解语义差异下做选择
- **审查判断**:
  - 这是 reasoning 表述准确性问题
- **建议修法**:
  - Q17 reasoning 改写:`两条路径的安全语义不同 — fail-closed = 默认拒绝,handler 缺失视为 deny;fallback confirmation = 默认问用户,用户可 allow。owner 拍板时应明确选择 "默认 deny" 还是 "默认 ask user" 的产品语义,而非把两者视为等价安全`

### R10. Design 02 / 04 共享 `session-do-runtime.ts` owner file,charter §8.3 Build Gate "稳定" 判据未在 design 中可执行化

- **严重级别**:`medium`
- **类型**:`delivery-gap / coordination`
- **是否 blocker**:`yes`(PP3 action-plan 启动前必须解开)
- **事实依据**:
  - `docs/design/pro-to-product/02-hitl-interrupt-closure.md:336` design 02 §10:`session-do-runtime.ts 会成为后续 PP3 的共享改动面,需尽早稳定`
  - `docs/design/pro-to-product/04-reconnect-session-recovery.md:416` design 04 §10:`session-do-runtime.ts 与 PP1 会共享改动面,启动时机必须后移到 PP1 稳定后`
  - charter §6.3 #3:`PP3 可与后续 Phase 并行,但不得与 PP1 在同一 owner file 的高频改动窗口重叠`
  - charter §8.3 Build Gate:`共享 owner file 的高频改动窗口已稳定`
- **为什么重要**:
  - "稳定" 在 design 中没有可执行判据 — 是 "PP1 closure" 还是 "无新 commit 7 天" 还是 "PP1 truth gate 全绿"?
  - 02 与 04 双向都把判定权推给对方;实际执行期会出现 PP3 owner 看到 PP1 "看似稳定" 就开工,而 PP1 仍在 hotfix
- **审查判断**:
  - 这是 cross-phase 协调真断点,charter 已要求但 design 未落地为可执行判据
- **建议修法**:
  - design 04 §6.3 增补:`PP3 启动 gate 的 "PP1 稳定" 判据 = (a) docs/issue/pro-to-product/PP1-closure.md 已写入 closed 状态,且 (b) PP1 closure 文档显式声明 "session-do-runtime.ts 主线已稳定,后续 hotfix 不影响 PP3 启动",且 (c) 自该 closure 起 7 个工作日内未在 session-do-runtime.ts 产生新 commit。三者全满足才解锁 PP3`

### R11. Design 07 §8.4 PP6 sweep target 列举不全(漏 permissions.md / workspace.md / transport-profiles.md / worker-health.md)

- **严重级别**:`low`
- **类型**:`delivery-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `clients/api-docs/` 实际 22 份:README, auth, catalog, checkpoints, client-cookbook, confirmations, context, error-index, items, me-sessions, models, **permissions**, runtime, session-ws-v1, session, todos, tool-calls, **transport-profiles**, usage, **wechat-auth**, **worker-health**, **workspace**
  - `docs/design/pro-to-product/07-api-contract-docs-closure.md:294-302` design 07 §8.4 列出的 sweep target 主要是 README/runtime/session-ws-v1/error-index/session-bridge/session-control
  - 7 份 design 都没显式提到的:`permissions.md`(与 PP1 confirmation/HITL 关联)、`workspace.md`(与 PP5 workspace_scope 关联)、`transport-profiles.md`(与 PP5 stream/fallback 关联)、`worker-health.md`(与 PP5 latency observability 关联)
- **为什么重要**:
  - 07 §5.1 S1 已包含 "22-doc pack sweep" 全集,所以技术上不算遗漏;但 §8.4 的列举会让 PP6 action-plan owner 把这几份当成低优,实际它们都和 PP1/PP5 truth gate 直接相关
- **审查判断**:
  - 不算 blocker,但 PP6 action-plan 明确逐一对账即可
- **建议修法**:
  - design 07 §7.2 F1 / §8.4 增补:`22 份逐一对账列表(每份与对应 PP1-PP5 truth gate 的关联标注)`

### R12. 8 份 design 都未在 §0 / §3 显式重申 charter §4.5 D1 例外法律

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - charter §4.5:`本阶段允许一类严格受控的 D1 例外,但默认不使用。...若触发新 migration,编号必须从 018 起顺延`
  - design 02:无 D1 例外声明(实际无新 schema 需求)
  - design 03 §9.1 D-03-1:`否,复用 checkpoint`(隐式 zero migration,但未显式引用 §4.5)
  - design 04:无 D1 例外声明
  - design 05:无 D1 例外声明
  - design 06:无 D1 例外声明,但 PP5 enforce matrix 实施时如果想加 D1 字段需要走 §4.5
- **为什么重要**:
  - charter §4.5 是阶段全局法律,各 design 不重申不会立即出错,但 PP1-PP5 action-plan owner 启动时如果想加 D1 字段,可能会绕开 §4.5 而不知有此约束
- **审查判断**:
  - 不算 blocker,但建议 design 都显式重申以防 action-plan 漏遵守
- **建议修法**:
  - 02-06 各 design 在 §3.3 完全解耦点增补一句:`本 phase 默认 zero migration;若需 D1 例外,按 charter §4.5 申请 ≥018 编号`

### R13. Design 05 PostToolUseFailure / Stop 等 13 类非 user-driven hook 没有明确 PP4 是否 in-scope

- **严重级别**:`low`
- **类型**:`scope-clarity`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/agent-core/src/hooks/catalog.ts` 共声明 18 个 hook event:SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, PostCompact, Setup, Stop, PermissionRequest, PermissionDenied, ContextPressure, ContextCompactArmed, ContextCompactPrepareStarted, ContextCompactCommitted, ContextCompactFailed, EvalSinkOverflow
  - design 05 §5.1 S2-S4 只明确 PreToolUse / PostToolUse / PermissionRequest 这 3 类
  - design 05 §5.2 O1 写 "新事件 enum out-of-scope",但**没明确剩 15 类 hook 是否仍 substrate-ready / 是否 closure 要求**
- **为什么重要**:
  - charter §4.2 O4 明确:`Full hook catalog (14/18 emit 全接通)` out-of-scope
  - 但 design 05 没把这一全集映射写清,可能让 PP4 reviewer 在 closure 时纠结 "PostCompact 已有部分 caller (durable-promotion-registry 异步 compact 使用),是否算闭合"
- **审查判断**:
  - 不算 blocker,但应明确 boundary
- **建议修法**:
  - design 05 §5.3 边界清单增补:`PostToolUseFailure / Setup / Stop / PreCompact / PostCompact / PermissionDenied / ContextPressure / ContextCompactArmed/PrepareStarted/Committed/Failed / EvalSinkOverflow 共 14 类 hook 在 PP4 内仅作为 substrate-ready,closure 不要求 user-driven register caller;若已有 production caller(如 ContextCompact* 由 durable-promotion-registry 注入),仅作 secondary outcome 登记`

---

## 3. In-Scope 逐项对齐审核

> 对照 charter §10 的 7 truth gates 与各 design 的 §5.1/§7.1 in-scope 项。

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | design 00 §5.1 S1-S4 (Truth Gate Registry / Evidence Shape / Cannot-Close / Latency Baseline) | `done` | 与 charter §10 完全对齐;truth gate 共同语言已冻结 |
| S2 | design 01 §5.1 S1-S4 (Public Surface Taxonomy / FE State / Docs Truth / FE Engagement) | `done` | 与 charter §6.4 / §10.1 T7 对齐;FE-1/FE-2/FE-3 的最低输出可被 closure 引用 |
| S3 | design 02 §5.1 S1 (tool_permission runtime interrupt) | `done` | 设计完整;runtime ask bridge 路径明确 |
| S4 | design 02 §5.1 S2 (elicitation runtime interrupt) | `partial` | 设计完整,但 §8.4 reference 行号未覆盖 elicitation substrate(R1)。不影响实现 |
| S5 | design 02 §5.1 S3 (pending list/reconnect truth) | `done` | row-first + reconnect 后 list pending 路径明确 |
| S6 | design 02 §5.1 S4 (timeout/superseded discipline) | `done` | terminal discipline 明确 |
| S7 | design 03 §5.1 S1 (Runtime budget preflight) | `done` | request-builder 缺位、context-core probe owner 已明确 |
| S8 | design 03 §5.1 S2 (Manual compact live) | `done` | createCompactBoundaryJob 已存在 |
| S9 | design 03 §5.1 S3 (Auto compact honesty) | `done` | docs honesty law 明确 |
| S10 | design 03 §5.1 S4 (Protected fragment law) | `done` | preview 已识别 protected kinds |
| S11 | design 03 §7.2 F3 (Runtime Compact Bridge) | `partial` | **真断点**:F3 把 "真接通" 与 "explicit degraded" 写成二选一,但 T2 硬闸不接受 degraded(R4) |
| S12 | design 04 §5.1 S1 (WS reconnect via last_seen_seq) | `done` | ws-runtime.ts 替换 cursor 已实现 |
| S13 | design 04 §5.1 S2 (Detached recovery) | `done` | markDetached 已存在 |
| S14 | design 04 §5.1 S3 (Replay lost/degraded UX) | `partial` | HTTP 端已 honest;WS 端 degraded 必须新增,但 design / Q14 未明确(R7) |
| S15 | design 04 §5.1 S4 (State snapshot recovery bundle) | `done` | recovery bundle 包含 confirmations/context/items/todos/runtime |
| S16 | design 04 §7.2 F1-F4 整体 | `partial` | persist 端 line 176 `replayFragment: null` 硬编码未在 design 中点出(R6) |
| S17 | design 05 §5.1 S1 (User-driven hook registration) | `done` | session-scoped register/list/unregister 设计明确 |
| S18 | design 05 §5.1 S2 (PreToolUse live effect) | `partial` | **真断点**:design §8.4 让 reader 误以为 caller 已存在;实际 PreToolUse 无 production caller(R3) |
| S19 | design 05 §5.1 S3 (PostToolUse live observation) | `done` | broadcast schema 已存在 |
| S20 | design 05 §5.1 S4 (PermissionRequest live integration) | `partial` | **真断点**:与 catalog.ts:158-159 fail-closed frozen 注释 + Q17 fallback 默认建议三者冲突(R3) |
| S21 | design 06 §5.1 S1 (Runtime field enforce matrix) | `done` | matrix 设计明确 |
| S22 | design 06 §5.1 S2 (Tool policy decision order) | `done` | session→tenant→approval-policy fallback 已 enforced |
| S23 | design 06 §5.1 S3 (Streaming reliability honesty) | `done` | non-stream vs stream 差异已识别 |
| S24 | design 06 §5.1 S4 (Structured degraded errors) | `done` | system.error registry 已存在 |
| S25 | design 06 §7.2 F2 边界(db missing → ask path) | `partial` | unavailable→ask→error 路径未与 PP1 ask 主线明确分离(R5) |
| S26 | design 07 §5.1 S1-S4 (22-doc sweep / matrix / frame-error / readiness) | `done` | sweep 范围与 readiness label 法律明确 |
| S27 | charter §6.3 #3 + §8.3 Build Gate (PP1/PP3 owner file 协调) | `partial` | 02/04 双向识别风险但都未给可执行判据(R10) |
| S28 | charter §4.5 D1 例外法律在各 design 重申 | `missing` | 02-06 design 都未在 §3.3 显式重申(R12) |

### 3.1 对齐结论

- **done**:18
- **partial**:9
- **missing**:1
- **stale**:0
- **out-of-scope-by-design**:0

> **状态总结**:`8 份 design 的主线设计基本对齐 charter 7 truth gates 与 7 phase 划分,18 项 done。9 项 partial 全是表述/scope 二义性,不是设计本身错误。1 项 missing 是 §4.5 D1 例外法律重申,属于 docs-discipline 而非 truth-gap。这更像 "整体设计骨架已成立,但有 4 个真实断点(R3/R4/R6/R10)需要在 action-plan 启动前补完",而非 "设计未达到 baseline"。`

---

## 4. Out-of-Scope 核查

> 检查 design 是否越界,也检查 reviewer 是否把 frozen deferred 项误判为 blocker。

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | charter §4.2 O1 Multi-provider routing | `遵守` | 8 份 design 都没引入 provider 抽象 |
| O2 | charter §4.2 O2 Sub-agent / multi-agent | `遵守` | 无 design 触及 |
| O3 | charter §4.2 O3 Admin/billing/SDK extraction | `遵守` | 01 §3.1/§5.2 显式排除 |
| O4 | charter §4.2 O4 Full hook catalog (14/18 emit 全接通) | `遵守 + 误报风险` | 05 §5.2 O1 显式排除新 enum;但 §5.3 没明确 14 类非 user-driven hook 在 PP4 是否仅作 substrate-ready,有 reviewer 误把 ContextCompact* 已存在的 register 误读成 PP4 闭合证据的风险(R13) |
| O5 | charter §4.2 O5 Sandbox / bash streaming / WeChat | `遵守` | 5 design 都没触及 |
| O6 | charter §4.5 D1 例外:默认不新增 migration,例外按 ≥018 编号 | `遵守 + 误报风险` | 03 §9.1 D-03-1 隐式遵守;但 02-06 没显式重申(R12) |
| O7 | charter §6.4 Frontend Engagement Schedule | `遵守` | 01 §6 与 design 00 §3.2 都吸收 |
| O8 | charter §10.1 7 truth gates 不可设计层放宽 | `部分违反` | design 03 §7.2 F3 把 T2 硬闸 "prompt 真实缩减" 与 "explicit degraded" 并列,等于设计层悄悄放宽硬闸(R4) |
| O9 | hero-to-pro 4 项 owner-action retained 不复活 | `遵守` | 8 design 都没回头复活 R28 runbook / manual evidence / prod baseline / 4-reviewer memos |
| O10 | HPX7 6 项 closed verdict 不重开 | `遵守` | 8 design 都没回头改 H1-H6 |
| O11 | catalog.ts:158-159 PermissionRequest fail-closed frozen 注释 | `部分违反` | PPX-qna Q17 默认建议 fallback confirmation 与该 frozen 注释直接冲突,但 design 05 / Q17 reasoning 都没指出此冲突(R3) |
| O12 | charter §1.2 6-worker topology 不变 | `遵守` | 8 design 都基于 6-worker 基石 |
| O13 | charter §1.2 wire-without-delivery 不算闭合 | `遵守` | design 00 把 substrate-ready / live caller 严格区分;design 05 §5.3 把 evaluation/durable-promotion-registry 排除出 hook handler registry |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**:`approve-with-followups`
  - 8 份 design 与 1 份 PPX-qna 已**整体可作为 pro-to-product 阶段 design baseline**。30+ 处一手代码引用全部经过逐一打开核对,行号准确、语义正确;truth gate / phase 划分 / D1 例外 / FE engagement / latency baseline 全部与 charter v0.active.2 对齐;Opus charter review 提出的 4 个断点 B1/B2/B4 已被本批 design 显式吸收,B3 (DDL anchor) 在 charter §1.2 / §4.5 已落地。
  - 但有 **4 处真实断点必须在 PP1/PP2/PP3/PP4 各自 action-plan 启动前补完**(R3/R4/R6/R10),否则会让 truth gate 在执行期被深度博弈;另有 **9 处低严重度 followup**(R1/R2/R5/R7/R8/R9/R11/R12/R13)可在 batch review 或 action-plan 阶段顺手解决。
- **是否允许关闭本轮 review**:`yes`
  - design 阶段允许 closure;但 R3/R4/R6/R10 必须在 PP4/PP2/PP3/PP3 action-plan 启动前明确解决。
- **关闭前必须完成的 blocker(action-plan 阶段)**:
  1. **R3 — PP4 action-plan 启动前**:PPX-qna Q17 reasoning 显式点出 catalog.ts:158-159 fail-closed frozen 注释冲突;design 05 §7.2 F2 与 §8.4 改写,明确 "PreToolUse 当前无 production caller,PP4 必须新增" 而非 "已有 caller,只差 outcome 转换"
  2. **R4 — PP2 action-plan 启动前**:PPX-qna 增加 Q23 让 owner 拍板 "T2 硬闸是否允许 explicit degraded 替代";design 03 §7.2 F3 改写,明确 PP2 closure 不接受 degraded 作为 T2 替代
  3. **R6 — PP3 action-plan 启动前**:design 04 §7.2 F1 与 §8.4 增补 persist 端 line 176 `replayFragment: null` 必修,以及与 restore 端的对称修复
  4. **R10 — PP3 action-plan 启动前**:design 04 §6.3 增补 "PP1 稳定" 的可执行判据(closure 写明 + 7 工作日内无新 commit)
- **可以后续跟进的 non-blocking follow-up**:
  1. **R1**:design 02 §8.4 reference 行号改为 `378-415`,涵盖 elicitation
  2. **R2**:02-07 design 在 §1.2 都补对 00/01 的反向引用
  3. **R5**:design 06 §7.2 F2 增补 unavailable 的 fail-visible 表达
  4. **R7**:PPX-qna Q14 reasoning 明确 HTTP/WS 双面是否对齐
  5. **R8**:design 03 §7.3 把 "probe/preview ≤3s" 改回 charter §9.2 的 "compact 完成 ≤3s"
  6. **R9**:PPX-qna Q17 reasoning 明确 fail-closed vs fallback 的安全语义差异
  7. **R11**:design 07 §7.2 F1 增补 22 份 docs 逐一对账列表
  8. **R12**:02-06 design 在 §3.3 增补 "本 phase 默认 zero migration;若需 D1 例外,按 §4.5 ≥018 编号"
  9. **R13**:design 05 §5.3 明确 14 类非 user-driven hook 在 PP4 内仅 substrate-ready
- **建议的二次审查方式**:`no rereview needed`
  - design 已可进入 action-plan;R3/R4/R6/R10 4 处 blocker 应在 action-plan 落地后由 action-plan reviewer 在对应 PP* action-plan review 中验证已解决,而非再开一轮 design rereview。
- **实现者回应入口**:`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应,不要改写 §0–§5。`

> 8 份 design + PPX-qna 是**真正按 charter v0.active.2 写、按代码事实读、按 truth gate 收口**的产物。整体质量在 nano-agent 历史 design 批次中处于偏上水准。R3/R4/R6/R10 是真实断点但都属于"补 1-2 段 reasoning + 1-2 行可执行判据"级别,不需要重做设计。

---

## 6. GPT 修复回填（2026-05-03）

### 6.1 对本轮审查的回应

> 执行者: `GPT-5.4`
> 执行时间: `2026-05-03`
> 回应范围: `DeepSeek R1-R8 + Kimi R1-R10 + Opus R1-R13`
> 对应审查文件:
> - `docs/eval/pro-to-product/design-docs-reviewed-by-deepseek.md`
> - `docs/eval/pro-to-product/design-docs-reviewed-by-kimi.md`
> - `docs/eval/pro-to-product/design-docs-reviewed-by-opus.md`

- **总体回应**：`三份 review 的有效 design-level 问题已逐条核实并修入 design/QNA 正文；过时或与当前仓库事实不符的判断，已保留为 stale-rejected。`
- **本轮修改策略**：`优先修正会影响 scope、truth gate、evidence chain、QNA 单一来源和 docs sweep 边界的问题；不把 action-plan 级细节误塞回 design，也不为了响应 review 去重开 charter。`
- **实现者自评状态**：`ready-for-rereview`

### 6.2 DeepSeek 审查逐项回应

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| DS-R1 | `context_compact` confirmation 归属悬垂 | `fixed` | 在 `03` 明确其为 `registry-only / not part of PP2 closure evidence`，并把 PP2/PP6 的诚实标注边界写清 | `03-context-budget-closure.md` |
| DS-R2 | hook/policy/confirmation 仲裁顺序未冻结 | `fixed` | 将 `05` 改为 `PreToolUse-first minimal loop`，把 PermissionRequest 的 fallback law 收敛到 `PPX-qna Q17` 作为唯一来源 | `05-hook-delivery-closure.md`, `PPX-qna.md` |
| DS-R3 | `network_policy/web_search` 缺 proof methodology | `fixed` | 在 `06` F1 明确逐字段反查执行层消费链的方法，而不是只写“prove or downgrade” | `06-policy-reliability-hardening.md` |
| DS-R4 | `07` 未把 hook docs 明确列为 in-scope | `fixed` | 在 `07` 新增 `S5` 与 `F5 Hook Contract Reconcile`，并把 hook docs 纳入 pack sweep | `07-api-contract-docs-closure.md` |
| DS-R5 | T4 缺单一 owner | `fixed` | 在 `04` 增加 `S5` 和 `F5 Session State Truth`，明确 PP3 是 T4 运行时证据 owner | `04-reconnect-session-recovery.md` |
| DS-R6 | `session-control.ts:414-449` 行号漂移 | `stale-rejected` | 复核当前代码后，decision row write + WS update 仍正好位于 `414-449`；描述与行号均成立，无需改文档 | `workers/orchestrator-core/src/facade/routes/session-control.ts` |
| DS-R7 | `03` 未明确 auto compact 的 honesty boundary | `fixed` | 改写 `03` F3：degraded 只能作为 fail-visible fallback，不能替代 T2 prompt mutation 硬闸 | `03-context-budget-closure.md` |
| DS-R8 | `context/` 外部引用不可验证 | `stale-rejected` | 当前仓库已 vendored `context/gemini-cli`、`context/codex`、`context/claude-code`；并在 `00` 显式写明 | `00-agent-loop-truth-model.md` |

### 6.3 Kimi 审查逐项回应

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| Kimi-R1 | PP4 扩大 charter 最小 hook 范围 | `fixed` | 把 `05` 从“三类都要闭合”收窄为 `PreToolUse` 硬闸，`PostToolUse/PermissionRequest` 改成 secondary candidate | `05-hook-delivery-closure.md` |
| Kimi-R2 | e2e skeleton 框架未定义 | `fixed` | 在 `00` §7.3 明确复用现有 `test:package-e2e / test:cross-e2e` Node harness，并定义 skeleton evidence shape | `00-agent-loop-truth-model.md` |
| Kimi-R3 | latency baseline 缺测量基础设施 | `fixed` | 在 `00` §7.3 增补 latency 记录字段与 evidence 输出形态，避免 baseline 成为空数字 | `00-agent-loop-truth-model.md` |
| Kimi-R4 | 8 份 design 标题未定制 | `fixed` | 将 `00-07` 的一级标题全部改成真实 phase/design 标题 | `00-07 design docs` |
| Kimi-R5 | FE engagement 缺验收标准 | `fixed` | 在 `01` §7.3 为 FE-1/FE-2/FE-3 增补确认清单、反馈产物与 closure 引用要求 | `01-frontend-trust-contract.md` |
| Kimi-R6 | Q17 与 D-05-3 口径矛盾 | `fixed` | `05` 不再维持 `open-to-plan`/fail-closed 倾向，改为引用 `PPX-qna Q17` 的单一建议来源；保持 `proposed` 因 owner 尚未回填 | `05-hook-delivery-closure.md`, `PPX-qna.md` |
| Kimi-R7 | stream retry 继续 ambiguity | `fixed` | 在 `Q19` 和 `06` 明确：可选路径只能二选一进入 PP5 implementation/closure，不能继续保持开放语义 | `06-policy-reliability-hardening.md`, `PPX-qna.md` |
| Kimi-R8 | 外部 `context/` 引用无法验证 | `stale-rejected` | 当前仓库已存在对应 vendored 目录；该 finding 与当前 repo 事实不符 | `context/gemini-cli`, `context/codex`, `context/claude-code` |
| Kimi-R9 | PP3 checkpoint restore 引用不完整 | `fixed` | `04` 已显式补出 `persist + restore` 两端缺口，点名 `replayFragment: null` 与 `helper.restore()` 对称修复 | `04-reconnect-session-recovery.md` |
| Kimi-R10 | PP0-PP6 vs 00-07 映射未明示 | `fixed` | 在 `00` 新增 phase/design 映射表，明确 `PP0=00+01` 到 `PP6=07` 的关系 | `00-agent-loop-truth-model.md` |

### 6.4 Opus 审查逐项回应

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| Opus-R1 | `02` elicitation substrate 行号不全 | `fixed` | `02` §8.4 引用改为 `378-415`，并明确 permission + elicitation 共用 await primitive | `02-hitl-interrupt-closure.md` |
| Opus-R2 | `02-07` 反向引用 `00/01` 不一致 | `fixed` | 为 `03/04/05/07` 补齐对 `00/01` 的引用，恢复 cross-cutting evidence chain | `03-context-budget-closure.md`, `04-reconnect-session-recovery.md`, `05-hook-delivery-closure.md`, `07-api-contract-docs-closure.md` |
| Opus-R3 | `05` 与 catalog/Q17/PreToolUse caller 形成 deadlock | `fixed` | `05` 明确当前只有 dispatcher seam、没有 production PreToolUse caller；Q17 reasoning 明写 fallback 选择会触发 catalog/guard 同步修改 | `05-hook-delivery-closure.md`, `PPX-qna.md` |
| Opus-R4 | `03` 把 compact bridge 与 degraded 写成二选一 | `fixed` | 直接把 `03` F3 改成“PP2 closure 必须满足 T2 prompt mutation；degraded 只能作为 fail-visible fallback”；未新增 Q23，因为该约束已由 charter 直接给出 | `03-context-budget-closure.md` |
| Opus-R5 | `06` 未充分写出 `db-missing → ask → error` | `fixed` | 在 `06` F2 明确这条链必须改成 fail-visible unavailable，而不能被 PP1 正常 ask 语义吞掉 | `06-policy-reliability-hardening.md` |
| Opus-R6 | `04` 未显式指出 `replayFragment: null` | `fixed` | `04` F1/§8.4 已显式点名 persist 端 line 176 的硬编码，以及 restore 端必须同步修 | `04-reconnect-session-recovery.md` |
| Opus-R7 | `04/Q14` 未明确 HTTP/WS degraded 是否对齐 | `fixed` | 在 `04` 和 `Q14` 都补明：HTTP 已 honest；PP3 必须补 WS degraded，或在 docs 中冻结“先 HTTP resume 再 WS attach”的顺序 | `04-reconnect-session-recovery.md`, `PPX-qna.md` |
| Opus-R8 | `03` 把 compact ≤3s 改写成 probe/preview ≤3s | `fixed` | `03` §7.3 已改回 charter 原文：`compact 完成或 explicit degrade ≤3s` | `03-context-budget-closure.md` |
| Opus-R9 | Q17 reasoning 把两条策略写成等价安全 | `fixed` | Q17 已明确：`fail-closed = 默认 deny`，`fallback confirmation = 默认 ask user`，两者不是同等级安全 | `PPX-qna.md` |
| Opus-R10 | `PP1 稳定` 判据不可执行 | `fixed` | 在 `04` 写入 PP3 启动 gate：要求 PP1 closure 文档已明确 `session-do-runtime.ts` live interrupt 主线稳定，且无仍在进行中的语义重写 | `04-reconnect-session-recovery.md`, `02-hitl-interrupt-closure.md` |
| Opus-R11 | `07` sweep target 漏 4 份 docs | `fixed` | `07` F1/§8.4 现已显式列出 22 份 docs，并补入 `permissions/workspace/transport-profiles/worker-health` | `07-api-contract-docs-closure.md` |
| Opus-R12 | design 未重申 charter §4.5 D1 例外法律 | `fixed` | `00-07` 全部补入 `default zero migration / charter §4.5 / 018+` 纪律说明 | `00-07 design docs` |
| Opus-R13 | 非 user-driven hook 边界不清 | `fixed` | `05` §5.3 已把 14 类非 user-driven hook 明确降为 `substrate-ready only` | `05-hook-delivery-closure.md` |

### 6.5 状态汇总

| 分类 | 数量 | 编号 | 说明 |
|------|------|------|------|
| 已完全修复 | `27` | `DS-R1/R2/R3/R4/R5/R7, Kimi-R1/R2/R3/R4/R5/R6/R7/R9/R10, Opus-R1/R2/R3/R4/R5/R6/R7/R8/R9/R10/R11/R12/R13` | design/QNA 已同步修正 |
| stale-rejected | `3` | `DS-R6, DS-R8, Kimi-R8` | 与当前仓库事实不符或已被当前代码现实覆盖 |
| 有理由部分采纳 | `1` | `Kimi-R6` | 统一到 Q17 单一来源，但未伪装成 owner 已回答后的 `frozen` |
| 仍 blocked | `0` | `—` | 当前 design-level 修复已完成 |

### 6.6 变更文件清单

- `docs/design/pro-to-product/00-agent-loop-truth-model.md` — 增补 vendored context 事实、phase/design 映射、e2e skeleton 与 latency evidence 方法。
- `docs/design/pro-to-product/01-frontend-trust-contract.md` — 补 FE-1/FE-2/FE-3 的验收标准与 frontend contract 的 D1 纪律。
- `docs/design/pro-to-product/02-hitl-interrupt-closure.md` — 校正 elicitation substrate 引用，并补共享 owner file 稳定 handoff 要求。
- `docs/design/pro-to-product/03-context-budget-closure.md` — 收紧 T2 硬闸、auto compact honesty 边界与 compact latency 表述。
- `docs/design/pro-to-product/04-reconnect-session-recovery.md` — 增补 `replayFragment` persist/restore 对称修复、T4 owner 与 PP3 启动 gate。
- `docs/design/pro-to-product/05-hook-delivery-closure.md` — 收窄 PP4 scope 到 minimal live loop，修正 PreToolUse caller / Q17 / 非 user-driven hook 边界。
- `docs/design/pro-to-product/06-policy-reliability-hardening.md` — 补 enforce proof methodology、unavailable fail-visible 语义与 stream retry 冻结纪律。
- `docs/design/pro-to-product/07-api-contract-docs-closure.md` — 增补 hooks docs in-scope、22-doc explicit sweep list 与缺漏文档锚点。
- `docs/design/pro-to-product/PPX-qna.md` — 修正 Q14/Q17/Q19 reasoning，消除 replay 与 permission fallback 的语义歧义。

### 6.7 验证结果

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|--------|-------------|------|----------------|
| 文档 diff hygiene | `git --no-pager diff --check -- docs/design/pro-to-product docs/eval/pro-to-product/design-docs-reviewed-by-opus.md` | `pass` | 全部 |
| 关键代码锚点复核 | 重新打开 `session-do-runtime.ts:378-415`、`catalog.ts:158-159`、`runtime-mainline.ts:816-836`、`session-do-persistence.ts:154-176,193-222`、`entrypoint.ts:349`、`session-control.ts:414-449`、`runner.ts:419` | `pass` | `DS-R2/R7`, `Kimi-R6/R9`, `Opus-R1/R3/R5/R6` |
| vendored context 事实核验 | `find context -maxdepth 1 -mindepth 1 -type d` 与定向检查 `context/gemini-cli context/codex context/claude-code` | `pass` | `DS-R8`, `Kimi-R8` |
| 模板残留与标题回归 | grep `Nano-Agent 功能簇设计模板`, `open-to-plan`, 占位符残留 | `pass` | `Kimi-R4`, `Kimi-R6`, `Opus-R3` |

```text
- 所有 design 标题已替换为真实 phase/design 名称。
- `PPX-qna` 不再把 fail-closed 与 fallback confirmation 写成等价安全。
- `03` 不再把 degraded 写成 T2 prompt mutation 的合法替代。
- `04` 已明确 replay persistence 需要同时修 persist + restore 两端。
```

### 6.8 未采纳事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| `DS-R6` | `rejected` | 当前 `session-control.ts:414-449` 仍准确对应 decision row write + update emit；review 结论已过时 | 无需承接 |
| `DS-R8` | `rejected` | `context/gemini-cli`、`context/codex`、`context/claude-code` 已 vendored 在当前仓库 | 无需承接 |
| `Kimi-R8` | `rejected` | 同上，属于事实前提错误 | 无需承接 |
| `Kimi-R6` | `partially-fixed` | 已统一设计/QNA 口径，但 owner 仍未填写 `业主回答`，因此不伪装成 frozen | `docs/design/pro-to-product/PPX-qna.md` Q17 |

### 6.9 Ready-for-rereview gate

- **是否请求二次审查**：`no`
- **请求复核的范围**：`action-plan review should consume these fixes directly`
- **实现者认为可以关闭的前提**：
  1. `design baseline` 层面的 scope/logic/docs drift 已收平，不再需要单独开一轮 design rereview。
  2. 后续若要复核，应转到 `PP1-PP6 action-plan` 是否按本轮修正后的 design/QNA 继续执行，而不是重复审 design 本身。
