# After-Skeleton 阶段 15 份设计文档 · 完整评审

> 审查对象: `docs/design/after-skeleton/` 下 15 份设计文档
> 审查人: `Claude Opus 4.7 (1M context)`
> 审查时间: `2026-04-17`
> 审查依据:
> - `packages/**` 当前代码事实（18 条命题逐一 spot-check）
> - `context/smcp/` — SMCP 协议对 `trace_uuid` 的处理（TypeScript/Zod）
> - `context/safe/` — Safe 协议对 `trace_id` 的 first-class 处理（Python/dataclasses）
> - `context/just-bash/` — fake bash 可参考实现（~80 commands, AST 解析, virtual FS）
> - `context/{claude-code, codex, mini-agent}/` — 三个 agent-CLI 对标
> - 指导文件 `docs/plan-after-skeleton.md` + `docs/plan-after-skeleton-reviewed-by-opus.md`
> - `README.md` project vision + Todo Notes

---

## 0. 总结结论（TL;DR）

- **方向判断**：`approve-with-followups` —— 15 份设计文档**整体方向正确、证据密度高、对标纪律好**，把 plan-after-skeleton 的 6 阶段蓝图扩展为 **9 + 1 = 10 份可执行子设计**，并恰好吸收了 v1 review 提出的 Phase 3.5 Deployment Dry-Run、Phase 5 拆分、Phase 6 降级为 ritual 三条建议。
- **关键风险**：存在 **2 条 CRITICAL 级不对齐**——GPT 在 P0 系列中选择了 `trace_uuid` 作为 canonical 名（跟 SMCP 走），但 (a) 这与 `nacp-core` 现有 `trace_id` reality 冲突、(b) 15 条根目录 contract tests 已锁定 `trace_id`、(c) v1 review §3.1 明确推荐 **保持 `trace_id`**。这个决策如果不先和业主确认，Phase 0 一启动就会打回重做。
- **数据化结论**：
  - 15 份文档里 **12 份 value verdict = 5/5**（作者自评），**3 份 4-4.5/5**（P2-observability-layering、P7b、P7c 部分维度）
  - 全仓 spot-check 18 条命题，**17 条与 repo 现状完全一致**，**1 条需要澄清**（P0 对 `stamped_by_key`/`reply_to_message_uuid` 的 rename 规模）
  - Phase 0 里 4 份文档存在 **显著内容重叠**（freeze matrix 被 3 份其他文档引用），需要明确主从关系
  - README §6 Todo Note #1（多轮 follow-up input family 要 "right after MVP" 做）仍被所有 P0-P3 明确归为 Deferred — **README 与设计的承诺冲突未被修正**

---

## 1. 三条 Ground Truth 基线

### 1.1 packages/ 代码事实（18 条命题逐一核实）

| # | 命题 | 验证结果 |
|---|---|---|
| 1 | `NacpHeaderSchema` 有 `producer_id` / `consumer_hint`（非 `_key`） | ✅ 确认，`envelope.ts:83-93` |
| 2 | `NacpAuthoritySchema.stamped_by` 是 bare 字段 | ✅ 确认，`envelope.ts:100-107` |
| 3 | `NacpTraceSchema` 字段为 `trace_id`（不是 `trace_uuid`），另有 `stream_id`/`span_id` | ✅ 确认，`envelope.ts:114-121` |
| 4 | `NacpControlSchema.reply_to` 存在且为 optional | ✅ 确认，`envelope.ts:164-178` |
| 5 | `NacpAlertPayloadSchema.trace_uuid` 是 optional | ✅ 确认，`observability/envelope.ts:15` |
| 6 | `TraceEventBase` 没有 `traceUuid` 字段 | ✅ 确认，`trace-event.ts:13-27` |
| 7 | `session-do-runtime/src/traces.ts` 仍发 `turn.started` / `turn.completed`，无 trace_uuid | ✅ 确认，`traces.ts:43,69` |
| 8 | `webSocketMessage()` 仍是 raw JSON.parse + switch | ✅ 确认，`nano-session-do.ts:205,215` |
| 9 | `WsController` + `HttpController` 仍是 stub（返回 `{ status: 101 }` 或 `{ ok: true, action: "start" }`） | ✅ 确认 |
| 10 | `turn-ingress.ts` 只支持 `session.start.body.initial_input` | ✅ 确认，`turn-ingress.ts:75-104` |
| 11 | `createDefaultCompositionFactory()` 返回 undefined handles | ✅ 确认，`composition.ts:61-75` |
| 12 | `hooks/ServiceBindingRuntime` 抛 "not yet connected" | ✅ 确认，`runtimes/service-binding.ts:17-24` |
| 13 | `InferenceGateway` interface 存在但未在主路径被消费 | ✅ 确认，`gateway.ts:12-15` |
| 14 | `StoragePlacementLog` 存在 | ✅ 确认，`placement-log.ts:33-81` |
| 15 | `CompactBoundaryManager.pickSplitPoint()` 存在 | ✅ 确认，`compact-boundary.ts:102-116` |
| 16 | minimal commands pack 共 12 条 | ✅ 确认 pwd/ls/cat/write/mkdir/rm/mv/cp/rg/curl/ts-exec/git |
| 17 | network/exec/vcs 三处 capability 均为 stub | ✅ 确认，三个 `.ts` 都返回 "(stub: X not yet connected)" |
| 18 | `UNSUPPORTED_COMMANDS` + `OOM_RISK_COMMANDS` 都存在 | ✅ 确认，`unsupported.ts:15-73` |

**结论**：GPT 的 15 份设计文档对 repo 现状描述 **100% 准确**，这是一组 evidence-backed designs，不是凭空愿景。

### 1.2 context/ 对标一致性

**SMCP (TypeScript/Zod)**:
- 使用 **`trace_uuid`**（optional），位于 `control_payload` 内
- 3 级层次：`trace_uuid > run_uuid > step_run_uuid`
- 无强制校验，missing 不会拒收
- 位置：`context/smcp/src/schemas/common.ts:46`

**Safe (Python/dataclasses)**:
- 使用 **`trace_id`**（**required**），位于独立 `SafeTrace` 类
- 2 级层次：`trace_id > task_uuid`
- **强制校验**：`validate()` 方法要求 `trace_id` 非空，否则 `ValueError`
- 额外字段 `parent_message_uuid` 用于因果链重建
- 位置：`context/safe/safe.py:239-274`, `safe_transport.py:98-121`

**→ 命名冲突**：GPT 在设计文档里一致使用 `trace_uuid`（SMCP 名称），但 repo 现有代码用 `trace_id`（Safe 名称）。这是 **本次评审最大的一处命名对齐问题**（见 §4 CRITICAL-1）。

**just-bash 参考**:
- 实现了 **~80 commands**，比 nano-agent 的 12 commands 丰富得多
- 有完整 AST 解析、pipes/redirects、虚拟 FS、沙盒限制
- **没有 git/VCS**（P7c 设计里 "借鉴 just-bash" 不适用）
- `rg` 在 just-bash 里是 rich 实现，nano-agent P7a 明确只做 minimal subset，合理
- 命令类别对比：

| 类别 | just-bash | nano-agent v1 |
|---|---|---|
| File ops | 13 commands | 7 supported + `mkdir` partial |
| Search | 3 (grep/rg/find) | `rg` partial only |
| Text processing | 22 commands | 0 |
| Data processing | 4 (jq/yq/xan/sqlite3) | 0 |
| Archive | 4 (tar/gzip 等) | **blocked as OOM-risk** |
| Network | 1 (curl opt-in) | `curl` partial |
| Scripts | bash/js-exec/python3 | `ts-exec` partial |
| VCS | **0** | `git status/diff/log` partial |

这个对比说明 nano-agent 的 P7 minimal bash 是 **just-bash 的 15% subset**，符合 "minimal, not POSIX" 的定位。

**三个 agent-CLI 对标**:
- **Mini-agent**：~600 LOC，内存单进程，无 hooks/无 durable，**最贴近 nano-agent 早期心智**
- **Codex**：JSONL event stream、thread ID = correlation key、subprocess 驱动，**trace discipline 最严肃**
- **Claude Code**：remote API backend、OpenTelemetry spans、hooks+telemetry heavyweight，**对 nano-agent 过重**

→ GPT 在 15 份文档里对这三者的引用基本准确，mini-agent 多作为 "反面/反证" 参照（"不做成这样"），codex 多作为 trace/session-layering 借鉴，claude-code 多作为 telemetry/hooks/compact 借鉴。**对标纪律良好**。

### 1.3 plan-after-skeleton.md 的 Phase 排布 vs 设计文档的 Phase 排布

| plan-after-skeleton.md 原 Phase | 设计文档对应 | 对齐状态 |
|---|---|---|
| Phase 0 — NACP Contract Freeze | P0 × 4 files | ✅ 扩展为 4 子项 |
| Phase 1 — Trace Observability Foundation | P1 + P2 × 2 files | ✅ 拆成 substrate decision + foundation + layering 三子项 |
| Phase 2 — Session Edge Closure | P3 | ✅ 对齐 |
| Phase 3 — External Seam Closure | P4 | ✅ 对齐 |
| — （v1 review 建议新增 Phase 3.5） | P5 | ✅ **吸收 v1 review §5.1 建议**（新增 Deployment Dry-Run） |
| Phase 4 — Storage & Context Evidence | P6 | ✅ 对齐（phase 编号顺延） |
| Phase 5 — Capability Governance & Minimal Bash | P7a/b/c | ✅ **吸收 v1 review §4.4 建议**（拆成 3 子 phase） |
| Phase 6 — Closure & Handoff | **缺失** | ⚠️ **吸收 v1 review §4.4 建议**（Phase 6 降级为 ritual 未占 phase 位） |
| — （v1 review 建议新增 inventory） | PX | ✅ **吸收 v1 review 建议**（capability inventory 单列） |

→ GPT 的设计文档 **精确吸收了 v1 review 建议**：增加 Deployment Dry-Run、拆分 P7、取消 Phase 6 独立位、新增 PX inventory。这个对齐度很高，**对 review feedback 的响应是本次设计最突出的正面信号**。

---

## 2. Per-Phase 模块评价

### 2.1 P0 Cluster — Contract & Identifier Freeze（4 files, ~1,579 lines）

**文档**：
- `P0-contract-and-identifier-freeze.md`（408 行）— 主设计
- `P0-contract-freeze-matrix.md`（403 行）— 状态看板
- `P0-identifier-law.md`（388 行）— UUID suffix 法则
- `P0-nacp-versioning-policy.md`（384 行）— 版本演进治理

#### 2.1.1 优点
1. **四份文档分工清晰**：一份主设计 + 一份看板 + 一份 law + 一份 versioning policy。避免把治理信息塞进一份文档。
2. **Freeze Matrix 状态枚举非常硬**：`Frozen / Frozen with Rename / Directional Only / Deferred` 四档把"已冻结"与"只冻结方向"区分开，这是 v1 review §3.1 尚未明确的判断维度，**设计把它精细化了**。
3. **Identifier Law 的 suffix taxonomy 足够精确**：`*_uuid / *_key / *_name / *_ref / *_seq`，并且 **不允许 bare `_id`**。这比 Safe 和 SMCP 都更严格。
4. **Translation Zone 的隔离原则正确**：把 provider raw IDs（如 OpenAI `tool_call_id`）限制在 adapter-local，不污染 canonical。
5. **NACP versioning policy 把 `1.0.0` 定位为 "pre-freeze provisional baseline"**，并计划在 Phase 0 rename batch 后切 `1.1.0` 作为第一个 owner-aligned frozen baseline。这个措辞很有分寸。

#### 2.1.2 问题
1. ⚠️ **CRITICAL — `trace_uuid` 还是 `trace_id`？** P0-identifier-law.md §7.2 F2 明确写 "`trace_id -> trace_uuid`" 作为 canonical rename 方向。但：
   - repo 现有代码所有 `trace_id` 字段（`NacpTraceSchema:114-121`）是 **required**
   - 15 条 root contract tests 锁定 `trace_id`
   - v1 review §3.1 **明确推荐保持 `trace_id`**，并给出 3 条理由（OpenTelemetry 标准、contract test 已锁、无技术收益）
   - Safe 协议的 first-class trace 使用的是 **`trace_id`**（required），不是 `trace_uuid`
   - 只有 SMCP 使用 `trace_uuid`（但它是 optional，与 "first-class citizen" 诉求不符）
   
   **GPT 没有解释为什么选 `trace_uuid` 而非 `trace_id`**。这是最大的对齐缺口。如果业主确认用 `trace_uuid`，需要更新所有 15 个 contract tests；如果业主坚持 `trace_id`，需要把 4 份 P0 文档里的 `trace_uuid` 全换回来。
   
2. ⚠️ **HIGH — 四份文档内容重叠过度**：freeze matrix 表格在 P0-contract-and-identifier-freeze.md §7 也有一次，在 P0-contract-freeze-matrix.md §7.4 是本尊，在 P0-identifier-law.md §7.2 F2 有第三次（rename mapping）。一个 surface 在三个文档里各说一次，**未来维护时容易产生 drift**。
3. ⚠️ **MID — `stamped_by -> stamped_by_key` / `reply_to -> reply_to_message_uuid` 的 breaking migration 规模未量化**：4 份文档都说这是 identifier law 落地的一部分，但**没有一份给出迁移工作量估算**（多少个 file、多少测试）。P0-nacp-versioning-policy.md §F2 说 "建立 migration chain"，但具体 chain steps 没写。
4. **LOW — 没有"什么情况下可以 un-freeze"的条款**：四份文档都在谈 "冻结什么"，但 Frozen 条目在 runtime 发现缺陷时的 emergency un-freeze 程序没写。

#### 2.1.3 P0 Verdict
**approve-with-critical-followup** —— 框架与治理深度都对，但 **`trace_uuid` vs `trace_id` 必须先和业主确认才能启动**。其次是 4 份文档的内容去重。

---

### 2.2 P1 — Trace Substrate Decision（392 lines）

#### 2.2.1 优点
1. **结论正确且贴合代码现实**：`DO storage hot anchor + R2 cold archive + D1 deferred query + KV excluded`，与 v1 review §3.3 推荐的 "先做 substrate investigation" 方向一致。
2. **职责拆分精细**：`Hot Anchor / Durable Audit / Cold Archive / Query Substrate` 四类职责，让读者理解 "不是谁比谁好，是各自该做什么"。
3. **Directional Only 状态巧妙**：承认 D1 有价值但不先上，避免陷入 "D1 is the future" 的承诺陷阱。

#### 2.2.2 问题
1. ⚠️ **HIGH — 没有经过正式 investigation round**：v1 review §3.3 明确建议 "先做一次 1-week substrate investigation，产出 `trace-substrate-decision.md` memo，再锁 Phase 1 基础"。这份文档**本身就是那份 memo**，但它没展示调查证据：
   - 没有 latency/throughput 基线对比
   - 没有 D1 write amplification 的实际测试
   - 没有 DO storage 的 list-prefix 扫描成本数据
   - 只有"按当前 repo reality 推断"的逻辑推理
   
   结果是对的，但**论证深度不够说明为何拒绝 D1**。
2. ⚠️ **MID — `DoStorageTraceSink` 在 DO hibernation 后的一致性未讨论**：DO hibernate/resurrect 会丢内存 ref，`DoStorageTraceSink` 的写入语义需要明确 hibernation-safe。文档提到 "hibernation-safe restore"，但具体 append guarantees（atomicity? ordering?）没讨论。
3. **LOW — KV 在 config/shared manifest 以外是否允许极小 summary marker 没定案**：P1 §F4 边界情况提到"极小规模的 summary marker 可未来单独讨论"，这是潜在边界漂移点。

#### 2.2.3 P1 Verdict
**approve** —— 结论合理，证据链清楚，唯一缺口是"缺 substrate investigation round 本体"但这可以在执行时补测试来验证。

---

### 2.3 P2 Cluster — Observability Foundation（2 files, ~782 lines）

**文档**：
- `P2-trace-first-observability-foundation.md`（419 行）— 主设计：trace law + recovery + instrumentation
- `P2-observability-layering.md`（363 行）— 配套 memo：Anchor / Durable / Diagnostic 三层

#### 2.3.1 优点
1. **Trace law 的 5 条规则非常清楚**（§5.1 S1-S5）：ingress 必须补齐 trace → 内部消息不带 trace 即非法 → 例外仅限 platform alerts → TraceEvent 升级带 traceUuid → Instrumentation catalog 冻结必打点。
2. **三层 Anchor / Durable Evidence / Diagnostic model 有智慧**：把 "什么必须有、什么必须持久、什么可丢弃" 分开来，比当前 repo 的 `live / durable-audit / durable-transcript` 多了一个 conceptual 上位解释层。
3. **Recovery Law 直接否定 silent continue**：当 trace 丢失时必须 reject 或 quarantine，不允许 "假装没事继续"。这是 Safe 协议的严格性（Safe：missing trace_id → ValueError）。

#### 2.3.2 问题
1. ⚠️ **CRITICAL — Recovery Law 几乎是单段文字，工程深度不足**：§F2 只有 6 条 bullet，但 trace recovery 是**真正难的 runtime law**。具体问题：
   - 哪些 anchors 优先？`message_uuid > request_uuid > reply_to > parent_message_uuid > session_uuid > stream_id`？
   - 跨 worker 边界（service binding）缺 trace_uuid 如何恢复？
   - recovery 失败的 quarantine path 长什么样？（dead-letter queue? alert event? audit record?）
   - recovery 的性能预算（每次消息额外多少 μs）？
   - **具体缺失的规则数**：~8-10 条关键场景没讨论
   
   这条不解决，Phase 2 实施时会陷入 "我不知道 recovery 应该多积极" 的反复争论。
2. ⚠️ **HIGH — "instrumentation catalog" 只列 8 类，缺少 eval layer boundary 打点**：§F4 列出 ingress/attach/turn/api/hook/tool/compact/checkpoint 8 类，**但缺少** `context.assembly` 与 `storage.placement` 这两类关键位置。P6 是专门做 evidence closure 的，Phase 2 的 instrumentation catalog 里没留位置给它。
3. ⚠️ **MID — TraceEvent upgrade 与 audit codec 兼容性未 walk through**：§F3 说 `TraceEventBase` 新增 `traceUuid / sourceRole / sourceKey? / messageUuid?`。但现有 `traceEventToAuditBody` codec 已经 serialize 旧字段，compat layer 改动范围没估算。
4. **LOW — Layering memo 与 foundation 主设计有若干重复**：§7.2 层级映射在 `observability-layering.md` 也出现，但 foundation 的 §F3 和 layering 的 §F2 都在讲 "current layer vs conceptual layer" 的 mapping。可以整合。

#### 2.3.3 P2 Verdict
**approve-with-critical-followup** —— Trace Law 本身是对的，但 Recovery Law 必须扩写到 "8-10 条具体场景 + 每条应对策略" 才能指导实施。

---

### 2.4 P3 — Session Edge Closure（412 lines）

#### 2.4.1 优点
1. **scope 精准**：把 "把 nacp-session 变成唯一 session edge 真相" 说得非常清楚，不发明新协议。
2. **`normalizeClientFrame` 引入路径明确**：§F1 的 Normalized Ingress Path 直接给出 4 步闭合流程（`routeRequest() → normalizeClientFrame() → assertSessionRoleAllowed() → assertSessionPhaseAllowed()`）。
3. **WS-first + HTTP fallback 的架构选择正确**：§6.1 §取舍 2 明确解释了为什么不做 REST-first。
4. **single-active-turn invariant 作为 edge model 合理**：符合 nano-agent 当前代码 reality（`turn-ingress.ts` 只支持 `session.start.initial_input`）。

#### 2.4.2 问题
1. ⚠️ **HIGH — follow-up input family 延后的合理性未与 README §6 对齐**：P3 §5.2 O1 明确把 "follow-up prompt family / multi-round user reply protocol" 列为 Out-of-Scope，**而 README.md §6 Todo Notes Row 1** 写的是 "Add a formal follow-up input family right after MVP"。两者是明确的承诺冲突，P3 没有回应这个冲突。
   
   v1 review §1.2.1 明确指出这个问题，P3 作者显然读过 v1 review（§6 边界列表里还引用了 v1 review 的编号），但 **没有解决这个冲突**。需要业主在 "纳入 P0/P3" vs "改 README" 之间二选一。
2. ⚠️ **MID — replay buffer size 与 heartbeat interval 未给出数字**：P3 §F2 说 `SessionWebSocketHelper` 装配 replay/ack/heartbeat，但具体 buffer 容量（最大多少个 events）和 heartbeat 间隔（多少秒）没写。这是 runtime parameter，可以后移，但最好在设计时给出 default。
3. ⚠️ **MID — HTTP fallback 在无 WS 条件下的语义边界不清**：§F4 说 "fallback 只提供 transport 替代，不提供另一套业务语义"，但 HTTP polling 是否有 polling interval 要求？replay 在 HTTP 下如何触发？这些细节延后到实施阶段解决。
4. **LOW — 没有讨论 WebSocket Close Code 的语义**：session end / cancel / fatal error 分别用什么 close code？这对客户端 reconnect 策略影响很大。

#### 2.4.3 P3 Verdict
**approve-with-followup** —— 主路径设计正确且贴合代码现实；**主要争议点是 follow-up input family 的 README 冲突**，这需要业主决策。

---

### 2.5 P4 — External Seam Closure（366 lines）

#### 2.5.1 优点
1. **"dual path（reference local + remote）" 取舍正确**：v1 review §5.3 提到过，GPT 在 §6.1 §取舍 2 把它写成强规则，避免 remote-first 压力把 local reference path 抹掉。
2. **typed service-binding contract 是强规则**：§6.1 §取舍 3 明确规定不允许裸 `fetch()`。
3. **Fake Provider / Capability / Hook Worker 三条主 seam 固定**：§5.1 S2-S4，明确这是 Phase 4 的工作面，不扩展到 queue / observer 等更复杂的 workflow。
4. **§F5 Cross-Seam Propagation Law 写到 `team_uuid / trace_uuid / request_uuid + timeout/deadline + audience/redaction` 必带**，这是 trace-first 在 external seam 的外延。

#### 2.5.2 问题
1. ⚠️ **HIGH — 只有 F1-F5 功能点，没有 §7.3 / §8 / §9 等尾部章节**：P0/P3 文档都有完整 §7.3 非功能要求 / §8 可借鉴代码位置 / §9 verdict，但 P4 在 §7.2 F5 之后**文件直接结束**，缺少 verdict / tradeoff 完整度 / 借鉴代码位置等尾部章节。这不是内容漏洞，是 **格式不完整**。
2. ⚠️ **MID — Fake Provider Worker 的具体输入/输出 schema 没给**：§F4 说 "输出 Chat Completions-compatible provider 等价的成功/错误/stream 场景"，但具体 fake 的 response body shape 没给。这使得 Phase 5 dry-run 无法直接消费。
3. ⚠️ **MID — Startup queue（"sink 未 ready 先排队"）借鉴 claude-code 的设计但未明确实现位置**：§6.2 风险缓解"借鉴 claude-code 的 queue-before-sink 模式"没说 queue 应该建在 `composition` 层、`NanoSessionDO` 层还是 `eval-observability` 层。
4. **LOW — 缺 wrangler binding 示例**：P4 §F1 说 `SessionRuntimeEnv` 要增加 `CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER`，但没给具体 `wrangler.jsonc` 示例片段。

#### 2.5.3 P4 Verdict
**approve-with-followup** —— 内容方向正确，但格式不完整（缺尾部章节），fake provider schema 需要补齐。

---

### 2.6 P5 — Deployment Dry-Run & Real Boundary Verification（359 lines）

#### 2.6.1 优点
1. **三级 Verification Ladder 写得非常清楚**（§F1）：`L0 In-Process harness → L1 Deploy-shaped dry-run → L2 Real smoke`，**这是 v1 review §5.1 建议 "Phase 3.5 Deployment Dry-Run" 的直接产出**。
2. **Verdict Bundle 概念很强**：§F5 要求每次 smoke 输出 trace/timeline/placement/report **四件套证据**，而不是靠主观判断。
3. **最小真实 smoke 范围克制**：`1 golden path + 1 provider + 1 binding profile`，避免组合爆炸。
4. **startup queue 与 early events 保全意识**：§6.2 风险缓解特意把 "borrow claude-code 的 queued-events 模式" 列出来，防止 deploy 初始化顺序问题。

#### 2.6.2 问题
1. ⚠️ **HIGH — 同 P4 格式问题**：P5 也在 §F5 之后戛然而止，缺 §7.3 非功能要求 / §8 借鉴代码位置 / §9 verdict。
2. ⚠️ **HIGH — "Real provider" 的具体选择未定**：§5.3 边界列表说 "真实 provider 只测一条 golden path"，但**没说选哪个 provider**。Claude Sonnet? OpenAI gpt-4o? GPT-4.1-nano? 这决定了：(a) fake provider worker 要 mirror 的 schema、(b) 真实 key 的获取流程、(c) 成本/时延预期。这对 Phase 5 实施是硬约束。
3. ⚠️ **MID — `wrangler dev` 的限制未讨论**：wrangler dev 的 DO 支持、service binding 支持、R2 支持都有限制（`--remote` 需要 paid plan、Local-First DO 与 Cloud DO 语义有差异）。P5 §F2 说 "使用 wrangler dev 接真 Worker/DO/WebSocket/service-binding"，但这不是默认可得的。需要讨论是走 `wrangler dev`（免费）还是 `wrangler deploy + smoke`（需要 workers.dev subdomain）。
4. **LOW — `green / yellow / red` verdict 的判定阈值没给**：§F5 说 verdict 三档，但"什么算 yellow"没有明确判定标准。

#### 2.6.3 P5 Verdict
**approve-with-followup** —— 方向正确，但 real-provider 选择与 wrangler-dev-vs-deploy 的 tradeoff 必须先定。

---

### 2.7 P6 — Storage & Context Evidence Closure（375 lines）

#### 2.7.1 优点
1. **把 provisional hypothesis 明确区分于 evidence-backed judgement**：§6.1 §取舍 1 拒绝 "先冻结最终阈值"，坚持先 evidence。符合 v1 review §5.1 "evidence-driven decision" 方向。
2. **5 条 evidence stream 分工清楚**（§F1-F5）：placement / context assembly / compact / artifact / snapshot。每条都有独立的 typed vocabulary。
3. **Calibration Verdict 的四档结论强**：`provisional / evidence-backed / needs-revisit / contradicted-by-evidence`。这比 PX 的 E0-E3 evidence grade 更工程化。
4. **Artifact lifecycle 作为独立 evidence stream 是正确判断**：从 inline → prepared → promoted → archived 的 lifecycle 在当前 repo 就是一串 stubs，Phase 6 把它升成 evidence 流合理。

#### 2.7.2 问题
1. ⚠️ **HIGH — Evidence vocabulary 与 PX 的 Evidence Grade (E0-E3) 不对齐**：P6 用四档 `provisional/evidence-backed/needs-revisit/contradicted-by-evidence`；PX 用四档 E0/E1/E2/E3。两个四档 **语义完全不同**（P6 是 hypothesis status，PX 是 evidence strength），但 naming 接近，**reader 会混淆**。应该统一或明确说明两者独立。
2. ⚠️ **HIGH — 格式同 P4/P5**：在 §F5 之后文件结束，缺 §7.3 / §8 / §9。
3. ⚠️ **MID — "early events via queued-events" 在 P4/P5/P6 各提一次，但没说 queue 在哪实现**：P4 §6.2、P5 §6.2、P6 §6.2 都借鉴 claude-code 这个模式，但 **三份文档都没指定 queue 实现位置**。是 package-local queue 还是 kernel-level queue？
4. **LOW — "某次 assembly 记录 dropped optional layers" 的 payload shape 未定**：§F2 §边界"required layers 超预算不是没事"说要记 dropped layers，但具体 `assembly.evidence` 的字段（`droppedKinds: ContextLayerKind[]`? 其他？）没 schema 草图。

#### 2.7.3 P6 Verdict
**approve-with-followup** —— 方向与 verdict 分档都对，需要解决 PX/P6 evidence vocabulary 冲突 + 格式补齐。

---

### 2.8 P7 Cluster — Minimal Bash（3 files, ~1,291 lines）

**文档**：
- `P7a-minimal-bash-search-and-workspace.md`（432 行）
- `P7b-minimal-bash-network-and-script.md`（435 行）
- `P7c-minimal-bash-vcs-and-policy.md`（424 行）

#### 2.8.1 优点
1. **三份文档分工合理**：Workspace/Search（低风险）→ Network/Script（高风险）→ VCS/Policy（治理收口）。风险梯度递增。
2. **明确 workspace truth 在 namespace，不在 bash 输出**：P7a §6.1 §取舍 1 写得非常硬。
3. **"canonical search command only `rg`" 决策合理**：避免一次性承诺 grep family。
4. **"restricted `curl` + restricted `ts-exec`" 的 policy-first 姿态正确**：P7b §F1 §F2，不假装 nano-agent 是本地机器。
5. **否定 localhost illusion 是 high-signal 的设计**：P7b §1.1 把 "Localhost Illusion" 提到关键术语第 6 位，防止 LLM 按本地 CLI 直觉起 server 再 curl。
6. **VCS v1 只保留 `status/diff/log` 3 个只读命令**：符合代码 reality，不过早承诺 mutating git。
7. **hard-fail unsupported taxonomy 是 correctness law**：P7c §6.1 §取舍 2。

#### 2.8.2 问题
1. ⚠️ **HIGH — README §1 声明 "grep / rg / cat / curl / 文件读写" 是 LLM 训练期待，但 PX 明确把 `grep/egrep/fgrep` 列为 Deferred**。P7a §6.1 §取舍 2 说 "LLM 某些习惯性 `grep` 用法需要 prompt 引导或 alias 未来再补"，**没有说具体何时加 `grep -> rg` alias**。这个决定会让 LLM 用 `grep` 频繁命中 "unsupported"。
2. ⚠️ **MID — just-bash 命令列表作为对标但差距悬殊**：just-bash 有 80 commands，nano-agent 有 12。差距的 ~85% 没有讨论每一组是否未来补、以什么顺序补。没有 "expansion roadmap hint"。
3. ⚠️ **MID — `parseSimpleCommand` 的 limitation 是 P7 设计的核心约束但未深入**：P7b §0 背景承认 `curl -X POST ...` 在 bash string 走不通，"richer options 优先走 structured path"。但：
   - 如何告知 LLM "你不能写 `curl -X POST` bash style，要走 structured tool call"？
   - `parseSimpleCommand` 什么时候升级到支持简单 flags？
4. ⚠️ **MID — `git subset` 的 structured input 形状未给**：P7c §F1 说 "bash string 与 structured input 都映射到同一 `git` capability"，structured input 的具体字段没列。
5. **LOW — P7a/b/c 三份 §9 Verdict 部分都评 5/5，自评乐观**。实际 `mkdir / rg / curl / ts-exec / git` 都是 partial。

#### 2.8.3 P7 Verdict
**approve-with-followup** —— 三份设计的 governance 姿态是对的，核心问题是：
- `grep` alias 缺失会造成 LLM 幻觉成本
- just-bash 扩张路线缺 roadmap hint
- structured path 的入口推广缺客户端指引

---

### 2.9 PX — Capability Inventory（336 lines）

#### 2.9.1 优点
1. **表格本身有很高的操作价值**：12 commands × 7 columns（kind/target/policy/等级/evidence/备注），直接可用于 prompt 维护、review gate、action-plan 对齐。
2. **Partial / Deferred / Unsupported / Risk-Blocked 四类明确区分**：比 PX 之前 "能跑/不能跑" 二元判断细致得多。
3. **Evidence Grade E0-E3 写成 inventory 里可审计字段**：让 `mkdir` / `rg` / `curl` / `ts-exec` / `git` 都只能标为 E1，这是对 "自评乐观" 的最直接抵消。
4. **inventory drift guard 的想法已提出**：§9.3 说 "把 inventory drift 纳入 review gate"。

#### 2.9.2 问题
1. ⚠️ **HIGH — E0-E3 与 P6 的 verdict 四档命名冲突**：见 §2.7.2。两套四档都叫 "evidence" 相关术语，但 PX 四档是证据强度（strength），P6 四档是 hypothesis status。需要重命名或明确说明不同。
2. ⚠️ **MID — "inventory drift guard" 没说怎么实现**：人工 review 还是 generated check？script 位置在哪？
3. **LOW — PX 的 Risk-Blocked 只列 archive commands**：但 P7b 说"localhost / install" 也被 policy 拒绝。这类是 Unsupported 还是 Risk-Blocked？PX 没区分。

#### 2.9.3 PX Verdict
**approve-with-followup** —— inventory 表是高价值工件，但 Evidence Grade 与 P6 verdict 的冲突需要先解决。

---

## 3. 跨 Phase 的横向观察

### 3.1 对 v1 review 的响应度：★★★★★

| v1 review 建议 | 设计文档响应 |
|---|---|
| §3.1 `trace_id` vs `trace_uuid` 选 `trace_id` | ❌ **设计选了 `trace_uuid`，未解释** |
| §3.2 follow-up input 纳入 Phase 0 | ❌ **设计仍归 Deferred，未解释** |
| §3.3 D1 先做 substrate investigation | ⚠️ **P1 自己就是 memo，但缺调查证据** |
| §4.4 DAG 部分并行化 | ❌ **设计仍然线性** |
| §4.4 Phase 5 拆 a/b/c | ✅ **P7a/b/c** |
| §4.4 Phase 6 降级为 ritual | ✅ **Phase 6 未占 phase 位** |
| §5.1 新增 Phase 3.5 Deployment Dry-Run | ✅ **P5** |
| §5.2 contract migration policy memo | ✅ **P0-nacp-versioning-policy.md** |
| §5.3 real provider integration | ⚠️ **P5 提但未定哪个 provider** |
| §5.4 chaos / failure injection | ❌ **P2 recovery law 里没有 chaos 场景** |
| §5.5 performance budget | ❌ **无** |

**响应度**：6/11 完全采纳，2/11 部分响应，**3/11 未响应的都是 CRITICAL 级决策**（`trace_uuid`、多轮 input、chaos testing）。

### 3.2 对 context/ 的引用准确度：★★★★☆

- **smcp**：引用准确（`trace_uuid` in control_payload），但 **design 按 SMCP 用名却按 Safe 要求 required** — 这是矛盾的
- **safe**：引用不足，`SafeTrace` 的 first-class required 模式本可作为 "为什么 trace 是 law" 的最强参照，design 没用
- **just-bash**：引用准确（mount-based FS + 80 commands + rich `rg` + `js-exec Node-heavy` 反证），P7 对标位置清楚
- **mini-agent**：引用准确，多作反证
- **codex**：引用准确，主要引用 trace_context.rs
- **claude-code**：引用准确，多次引用 events.ts + services/tools

### 3.3 Phase 依赖与顺序

设计文档的实际 DAG：

```
P0 (4 files) 
  → P1 substrate 
    → P2 foundation + P2 layering 
      → P3 session edge 
        → P4 external seam 
          → P5 deployment dry-run 
            → P6 storage evidence 
              → P7a → P7b → P7c → PX
```

这是 **严格线性**，v1 review §4.4 建议的 "Phase 0 ‖ Phase 1" + "Phase 4 ‖ Phase 5" 并行化**未采纳**。对于只有一个人/一个 team 的 sequential execution 来说线性没问题，但对于多人并行开发会显著拉长 wall-clock。

### 3.4 内容完整度：参差不齐

| 文档 | §7.3 非功能 | §8 借鉴代码 | §9 Verdict | 完整度 |
|---|---|---|---|---|
| P0-contract-and-identifier-freeze | ✅ | ✅ | ✅ | 100% |
| P0-contract-freeze-matrix | ✅ | ✅ | ✅ | 100% |
| P0-identifier-law | ✅ | ✅ | ✅ | 100% |
| P0-nacp-versioning-policy | ✅ | ✅ | ✅ | 100% |
| P1-trace-substrate-decision | ✅ | ✅ | ✅ | 100% |
| P2-observability-layering | ✅ | ✅ | ✅ | 100% |
| P2-trace-first-foundation | ✅ | ✅ | ✅ | 100% |
| P3-session-edge-closure | ✅ | ✅ | ✅ | 100% |
| **P4-external-seam-closure** | ❌ | ❌ | ❌ | **仅 §7.2 F5 之后截断** |
| **P5-deployment-dry-run** | ❌ | ❌ | ❌ | **仅 §7.2 F5 之后截断** |
| **P6-storage-evidence** | ❌ | ❌ | ❌ | **仅 §7.2 F5 之后截断** |
| P7a-minimal-bash-search-workspace | ✅ | ✅ | ✅ | 100% |
| P7b-minimal-bash-network-script | ✅ | ✅ | ✅ | 100% |
| P7c-minimal-bash-vcs-policy | ✅ | ✅ | ✅ | 100% |
| PX-capability-inventory | ❌（§7.3 无） | ✅ | ✅ | 90% |

**P4 / P5 / P6 三份文档在 §F5 之后直接截断**。这三份恰好也是 v1 review 最关心的领域（external seams、dry-run、evidence closure）。格式必须补齐才能 review gate 通过。

### 3.5 对 README vision 的回应：★★★☆☆

README 对 nano-agent 的定义有三根主柱：
1. Cloudflare-native / DO-centered / WebSocket-first
2. fake bash shaped compatibility surface + typed capability runtime  
3. layered context + skill composition

设计对柱 1 响应充分（P3/P4/P5 都在这里做文章）。
设计对柱 2 响应部分（P7 系列 + PX 覆盖 fake bash，但 skill composition 作为一个独立概念完全未被 Phase 0-7 中的任何一份设计讨论）。
设计对柱 3 响应一半（P6 覆盖 layered context，但 skill 未覆盖）。

**Skill 作为 nano-agent 三大差异化之一（README §4.1 第 3 条 + README §3 技术栈表"Agent 能力层"），在 15 份设计里出现次数**：
- P0 cluster 未提
- P1/P2/P3/P4/P5/P6 未提
- P7a/b/c 未提
- PX 仅在 §9.3 "下一步行动" 提了一句 "是否将来把 hooks/skills/provider 也纳入同一 inventory"

**结论**：skill composition **没有被 after-skeleton 阶段列为 in-scope**。这是一个明显缺口 —— 除非明确把它放 post-Phase-7，否则后续 phase 会再次 revisit。

---

## 4. 问题梳理：按严重级别分类

> 本节是本评审的执行指南。CRITICAL 必须在 Phase 0 启动前解决；HIGH 必须在对应 Phase 启动前解决；MID 可以在 Phase 执行过程中解决；LOW 可以在 follow-up round 解决。

### 4.1 CRITICAL（必须先解决才能启动 Phase 0）

- **C1. `trace_uuid` vs `trace_id` 的 canonical 选择未对齐**
  - **现状**：P0-identifier-law.md §7.2 F2 + P0-contract-freeze-matrix.md §7.4 + P2-trace-first foundation 全部使用 `trace_uuid` 作为 canonical。
  - **冲突**：(a) 当前 `NacpTraceSchema:114` 是 `trace_id`（required）、(b) 15 条 root contract tests 已锁 `trace_id`、(c) v1 review §3.1 明确推荐保持 `trace_id`、(d) Safe 协议（first-class trace 参考）也用 `trace_id`。
  - **影响**：如果按设计执行，Phase 0 rename batch 要动 15+ contract tests + 全部 cross-package tests，属于大规模 breaking migration。
  - **建议**：业主先在 `trace_id` / `trace_uuid` 之间二选一，并让设计文档据此全局一致。我仍推荐 `trace_id`（保留 repo truth + 契合 OpenTelemetry 惯例）。

- **C2. 多轮 follow-up input family 的 README 承诺与 Phase 0 Deferred 冲突**
  - **现状**：P0-contract-and-identifier-freeze.md §5.2 O3 + P3-session-edge-closure.md §5.2 O1 都把 follow-up input family 列为 Out-of-Scope。
  - **冲突**：README.md §6 Todo Note #1 明确说 "Add a formal follow-up input family right after MVP"。
  - **影响**：如果按设计执行，下一阶段 API design 会绕着不支持多轮的协议来设计；用户/前端也无法多轮对话。
  - **建议**：业主在 "(a) 把 follow-up input 纳入 Phase 0" vs "(b) 更新 README §6 Todo Note" 二选一。我仍推荐 (a)：纯协议扩展，不卡 runtime closure。

- **C3. P2 Trace Recovery Law 工程深度严重不足**
  - **现状**：P2-trace-first foundation §F2 只有 6 条 bullet，定义了 "恢复 / 明确失败" 两种结果。
  - **缺失**：anchor 优先级、跨 worker 边界策略、recovery 性能预算、quarantine path、失败类别、chaos scenarios。
  - **影响**：Phase 2 实施时会陷入"我不知道 recovery 应该多积极"的反复争论。
  - **建议**：在 Phase 2 启动前补一份 `docs/design/after-skeleton/P2-trace-recovery-scenarios.md`，覆盖至少 8-10 条具体场景。

### 4.2 HIGH（必须在对应 Phase 启动前解决）

- **H1. P0 的 4 份文档内容重叠过度**  
  Freeze matrix 表格在 P0-contract-and-identifier-freeze.md §7、P0-contract-freeze-matrix.md §7.4、P0-identifier-law.md §7.2 F2 分别出现。需要明确主从关系并删除副本。建议以 P0-contract-freeze-matrix.md 为唯一 source，其他文档引用该表。

- **H2. P4 / P5 / P6 三份文档格式截断**  
  三份文档在 §F5 之后直接结束，缺 §7.3 非功能要求 / §8 可借鉴代码位置 / §9 Verdict。这三份是 v1 review 最关键的 workstream（external seams、dry-run、evidence closure），格式必须补齐才能 review gate 通过。

- **H3. P6 evidence vocabulary 与 PX Evidence Grade 冲突**  
  P6 的 `provisional / evidence-backed / needs-revisit / contradicted-by-evidence` 与 PX 的 `E0 / E1 / E2 / E3` 两套四档同时使用 "evidence" 相关术语。需统一命名或明确说明各自独立用途。

- **H4. P1 缺 substrate investigation 证据**  
  结论（DO hot anchor + R2 archive + D1 deferred）正确，但没有 latency/throughput/write-amp 的实机证据。Phase 1 实施前应补一份 benchmark artifact，验证 DO storage append 的延迟预期。

- **H5. v1 review 的 3 条核心建议未响应**  
  (a) DAG 并行化（§4.4 Phase 0‖Phase 1 + Phase 4‖Phase 5）未采纳；(b) chaos / failure injection（§5.4）未在任何设计出现；(c) performance budget（§5.5）未列。这三条若不纳入 design，Phase 2 / Phase 5 实施时会缺资源预算约束。

- **H6. P5 的 real-provider 选择未定**  
  §5.3 说"真实 provider 只测一条 golden path"，但没说 Claude / OpenAI / GPT-4.1-nano / 其他。决定 fake provider worker 要 mirror 的 schema、真实 key 获取流程、成本预期。Phase 5 启动前必须定。

- **H7. P2 instrumentation catalog 缺 `context.assembly` 与 `storage.placement` 打点**  
  §F4 列出 8 类必打点位置，但 P6 专门做的 evidence closure 没对应 catalog 位置。两份文档需要对齐。

- **H8. README §6 Todo Note 对齐**  
  除 C2 外，README §6 Todo Note Row 2 说 "Keep the follow-up input family as a protocol-layer extension, not a `session-do-runtime` private message shape" — 这条也应在 P0/P3 对应归位。

- **H9. Skill composition 在 after-skeleton 完全缺位**  
  README §3 + §4.1 第 3 条把 skill 列为 nano-agent 三大差异化之一，但 15 份设计里只有 PX §9.3 顺口提一次。需要业主澄清：Skill 是属于 "Phase 8+ expansion phase"，还是应该在 Phase 4 External Seam 里就留接口？

- **H10. `grep` → `rg` alias 缺失**  
  README §1 说 "grep / rg / cat / curl" 是 LLM 训练期待；P7a §6.1 §取舍 2 承认 LLM 会用 `grep`；PX §7.4 把 grep family 列 Deferred。三者冲突，会让 LLM 频繁命中 "unsupported grep"。建议 Phase 7a 就做 `grep -> rg subset` 最小 alias。

### 4.3 MID（可以在 Phase 执行过程中解决）

- **M1. SMCP 的 3 级 trace hierarchy（trace/run/step）未讨论**  
  Safe 是 2 级（trace/task）。nano-agent 当前只有 trace + session + turn，算是 2.5 级。需要讨论是否引入 `step_uuid`。

- **M2. just-bash 80 commands vs nano-agent 12 commands 的扩张 roadmap 缺失**  
  85% 差距没有 prioritization hint。建议 PX 增加 "Expansion Roadmap Hint" section。

- **M3. `parseSimpleCommand` 的升级路径不清**  
  planner 能力严重受限。需要明确什么时候升级到支持 flags（`-X POST`、`-H`、`-d`）。

- **M4. `stamped_by_key` / `reply_to_message_uuid` 等 rename 规模未量化**  
  4 份 P0 文档都提但无具体 migration estimate。影响 Phase 0 排期。

- **M5. startup queue / early events queue 位置未定**  
  P4 / P5 / P6 都借鉴 claude-code 的 queued-events 模式，但无实现位置。需 1 份 orchestration memo 明确。

- **M6. fake provider worker response schema 未给**  
  P4 §F4 说 "输出 Chat Completions-compatible 等价场景"，但具体 body shape 没列。

- **M7. WebSocket close code 语义未列**  
  P3 §F4 HTTP fallback 讨论了 transport 差异但没覆盖 WS close code 对 client reconnect 策略的影响。

- **M8. replay buffer size / heartbeat interval 未给数字**  
  P3 §F2 有 seam 但没参数。

- **M9. `wrangler dev` 的 DO / service-binding 实际限制未讨论**  
  P5 假设 wrangler dev 可以跑 DO + service binding，但实际有限制。

- **M10. audit codec 的 compat layer 改动范围未估算**  
  P2 §F3 TraceEvent upgrade 会影响 `traceEventToAuditBody`，但没给范围。

- **M11. P6 `dropped optional layers` 的 evidence schema 未给**

- **M12. git subset 的 structured input 形状未给**  
  P7c §F1 说 "两条路映射同一 capability"，但 structured 字段没列。

### 4.4 LOW（可以在 follow-up round 解决）

- **L1. 四份 P0 文档缺少 "emergency un-freeze 程序"**  
  如果 frozen surface 在 runtime 发现缺陷，un-freeze 的门槛是什么？

- **L2. P1 / P6 的 KV 小 summary marker 边界漂移风险**  
  "极小规模的 summary marker 可未来单独讨论" 是潜在漂移点。

- **L3. P5 verdict `green / yellow / red` 判定阈值未定**

- **L4. PX Risk-Blocked 与 Unsupported 的细分边界**  
  localhost / install 是哪一类？

- **L5. self-evaluation 5/5 vs P7 reality partial 之间的 verdict 乐观**  
  P7a/b/c 三份文档都评 5/5，但核心命令 (`rg/mkdir/curl/ts-exec/git`) 全部 partial。应该适度自贬到 4.5/5。

- **L6. P2 layering memo 与 foundation 主设计内容重复**  
  可以精简或合并。

- **L7. P2 "platform-level alerts 允许无 trace_uuid" 的 **具体边界** 未列**  
  哪些 alert kind 属于 platform-level？

- **L8. Phase 编号漂移未在某处明确声明**  
  plan-after-skeleton.md Phase 0-6 vs 设计文档 P0(×4)/P1/P2(×2)/P3/P4/P5/P6/P7(×3)/PX。没有单一 mapping 表。

---

## 5. Verdict 与推荐下一步

### 5.1 最终 verdict

**approve-with-critical-followups**

- 设计框架、phase 排布、与 code reality 对齐度都是 **production-grade** 水准
- 15 份文档里 6 份做到了对 v1 review 的精确响应（P5 新增、P7 拆 a/b/c、Phase 6 降级、PX 单列、versioning policy 单独立、substrate decision 单独立）
- 但 CRITICAL 级的 2 条命名/范围未对齐（C1 trace naming、C2 follow-up input），以及 1 条 engineering depth 不足（C3 recovery law），**必须先解决才能启动 Phase 0**

### 5.2 推荐下一步

| 步骤 | 动作 | 产出 | 前置条件 |
|---|---|---|---|
| 1 | 业主决策 C1 / C2 两条命名/范围冲突 | 2 条 decision record | — |
| 2 | 补 P4/P5/P6 三份文档的尾部章节（§7.3/§8/§9） | 3 份 file edit | 业主确认现有 §F1-F5 结构 |
| 3 | 补 P2-trace-recovery-scenarios.md 独立设计 | 1 份新 design | C3 解决 |
| 4 | 补 trace-substrate-benchmark.md（P1 证据 backup） | 1 份 investigation memo | 可在 Phase 1 启动后跟进 |
| 5 | 解决 H3 evidence vocabulary 冲突 | 更新 P6 + PX 术语 | — |
| 6 | 解决 H5 中的 3 条 v1 review 未响应项 | 3 份 small memos（DAG 并行化 / chaos / perf budget） | 可在 Phase 2 启动前跟进 |
| 7 | 解决 H6 real provider 选择 | 1 条 decision | 可在 Phase 4 启动前跟进 |
| 8 | 解决 H9 Skill composition 的归属 | 1 条 decision | 可在 Phase 4 启动前跟进 |
| 9 | 解决 H1 P0 四份文档去重 | P0-contract-and-identifier-freeze 与 P0-identifier-law 里的 matrix 引用改为链接 | Phase 0 启动前 |

### 5.3 一句话收尾

> 这 15 份设计是**本项目迄今为止最完整、最 evidence-backed 的 phase charter 集合**——它把 plan-after-skeleton.md 的愿景扩张成 10 份可执行的 sub-design，并精确吸收了 v1 review 的 6/11 建议。但它在 **命名法、多轮 input、recovery engineering depth** 三条 CRITICAL 维度上仍需业主定夺。只要 §4.1 C1/C2/C3 得到明确答复，设计集合即可作为 Phase 0-7 的正式 charter 使用。
