# Nano-Agent After-Skeleton Action-Plan Q&A

> 范围：`docs/action-plan/after-skeleton/A1~A10`
> 目的：把 after-skeleton action-plan 真正依赖的业主 / 架构师决策统一收敛到一处，避免在 10 份执行文档中重复回答、重复漂移、重复改口。
> 使用方式：
> 1. **业主只需要在本文件填写回答。**
> 2. `A1~A10` 中若引用某个 `Q` 编号，默认都以本文件为唯一答复来源。
> 3. 各 action-plan 内不再逐条填写 QNA；如旧文仍保留“已确认 / 已冻结”的表述，应理解为历史上下文，后续统一以本文件回填结果为准。
> 4. 为了便于追溯，`Q1~Q20` 沿用现有编号；`Q21+` 是本次在整编 A1~A10 后新增补的问题。
>
> 📝 **注**：
> - 本文件仿照 `docs/design/after-skeleton/PX-QNA.md` 的结构，但额外增加了 `Reasoning`，专门面向第一次参与项目决策的业主。
> - 按你的要求，`Opus` 相关区块与 `业主回答` 均留空，供后续 second opinion 与正式答复使用。

---

## 1. Phase 0 / Contract Freeze 决策

### Q1 — Formal follow-up input family 的最小 frozen shape 应该是什么（来源：A1, A4）

- **影响范围**：`A1 / A4 / nacp-session / session-do-runtime / client adapter / future multi-round API`
- **为什么必须确认**：如果连“第二轮输入到底长什么样”都没有最小冻结版本，Phase 0 只能冻结第一轮 `session.start`，Phase 3 做 runtime 接线时就会被迫自己发明 follow-up message shape。
- **当前建议 / 倾向**：`先冻结一条最小 client-produced follow-up family，例如 canonical message = session.followup_input，body 至少包含 { text, context_ref? }`
- **Reasoning**：这个问题看起来像“字段名细节”，其实它决定的是：系统未来是否能自然支持多轮对话。对小白业主来说，可以把它理解成“我们要不要现在就定义第二句用户输入的标准格式”。如果不定义，后面的 runtime 和前端就只能临时拼接私有字段，短期看起来快，长期会造成 API v1 和 v2 断层。先冻结一个**非常小**的 shape，能同时守住“contract surface 尽量宽”与“当前实现不失控”这两件事。

- **Opus的对问题的分解**：
  1. **消息数量**：单条 follow-up message 还是多条系列消息（queue/replace/merge）？
  2. **Canonical name**：`session.continue` / `session.followup_input` / `session.prompt` / 其他？
  3. **Body 最小字段**：`text` 必带；`context_ref` 是否必带；是否需要 `stream_seq` / `attachments` / `tool_results` 等补充字段？
  4. **与 `session.start.initial_input` 的对称性**：two families 是否应该共享 body shape，还是有意设计差异？
- **Opus的对GPT推荐线路的分析**：GPT 推荐的 "单条 `session.followup_input` + `{ text, context_ref? }`" **是最小且正确的路线**：
  1. 单条而非多条，避免 queue/replace/merge 语义过早涌入 Phase 0 scope（这些属于下一阶段 API design）
  2. `session.followup_input` 与 `session.start.initial_input` 形成**明显对称**，方便 client/server 共享 ingress path
  3. `context_ref` 可选设计允许未来挂 `PreparedArtifactRef`，为多轮里 refer-back 预留空间
  4. 限制 body 到 2 字段，能在 Phase 0 只跑一次 breaking migration 就把 shape 冻住
- **Opus的最终回答**：`强烈同意 GPT 推荐`。**唯一补充建议**：body 里再额外预留 **`stream_seq?: number`**（optional），这样 follow-up 能被 replay/resume 识别到其在 session timeline 上的位置；否则 reconnect 后 client 无法判断 follow-up 是否已被 server 接收。最终 shape 建议 = `{ text: string, context_ref?: NacpRef, stream_seq?: number }`。

- **问题**：`是否确认在 Phase 0 先冻结一条最小、client-produced 的 follow-up input family？如果确认，canonical message 名称与最小 body shape 应该是什么？`
- **业主回答**：同意。

### Q2 — Freeze Matrix 是否继续采用四档状态语言（来源：A1）

- **影响范围**：`A1 / 后续全部 action-plan / PR review gate / design-review vocabulary`
- **为什么必须确认**：如果没有统一的状态语言，团队会反复争论某项内容到底算“已经冻结”还是“只是方向正确但未落地”。
- **当前建议 / 倾向**：`继续采用 Frozen / Frozen with Rename / Directional Only / Deferred 四档状态`
- **Reasoning**：这个问题不是文案癖好，而是项目治理工具。项目现在不是“全都做完”或“全都没做完”的二元状态，而是存在很多中间状态：语义已经定了、但名字还没改；方向已经确定、但底层实现还没选；明确不做但以后也许再看。四档状态的价值，就是让 review、action-plan、实现、文档都用同一套词说话，减少反复拉扯。

- **Opus的对问题的分解**：
  1. 是否接受四档（精细化）vs 二元 Frozen/Deferred（简单化）的 tradeoff？
  2. 四档能否 1:1 map 到 PR review 的判断 axis？
  3. 四档语言会否与 PX capability maturity grade（E0-E3）或 P6 verdict（provisional/evidence-backed/...）产生混淆？
- **Opus的对GPT推荐线路的分析**：GPT 推荐继续四档 **完全正确**。四档的核心价值在 Phase 0 rename batch 里最为关键：
  - `Frozen with Rename` 精确描述 "语义已定、名字未改" 状态 —— 这就是 Phase 0 大部分字段目前的处境
  - `Directional Only` 精确描述 "方向已定、物理实现未选" —— 这就是 observability substrate 当前状态
  - 二元模型会被迫把这两类都归为 "deferred"，造成 Phase 0 执行时反复争论
- **Opus的最终回答**：`强烈同意`。四档语言是 design review v1 阶段我就推荐过的治理工具，在 action-plan 阶段继续沿用是正确选择。**建议**：为避免与 PX grade / P6 verdict 混淆，在 A1 exit pack 和 PR review template 里明确写 "Freeze Matrix (contract status) ≠ PX grade (capability maturity) ≠ P6 verdict (hypothesis status)" 三者独立。

- **问题**：`是否确认 Freeze Matrix 继续使用 Frozen / Frozen with Rename / Directional Only / Deferred 四档状态，并要求后续 action-plan 与 PR review 统一沿用？`
- **业主回答**：同意。

### Q3 — Identifier migration 是否要一并处理 `stamped_by` 与 `reply_to` 的 rename（来源：A1）

- **影响范围**：`A1 / nacp-core / nacp-session / compat migrations / tests / downstream adapters`
- **为什么必须确认**：如果这两个字段继续留在旧命名里，Phase 0 的 identifier law 会变成“只改一半”，后续系统会长期混用新旧口径。
- **当前建议 / 倾向**：`一并纳入本轮 migration，但在真正开改前先产出 migration estimate`
- **Reasoning**：这类 rename 很容易被误以为只是机械替换，但它会同时打到 schema、compat、测试和文档。对业主来说，关键不是“这两个字段改不改”，而是“我们要不要接受一个半冻结状态继续存在”。如果不一起处理，后面每个 reviewer 都要重新解释哪些命名已经 canon、哪些还是遗留口径，治理成本会持续存在。

- **Opus的对问题的分解**：
  1. `stamped_by` → `stamped_by_key`（authority 层）和 `reply_to` → `reply_to_message_uuid`（control 层）是两种不同性质的 rename：前者是 "bare handle → 加 suffix"；后者是 "宽语义 → 显式关联对象"
  2. 两者是否应与 `trace_id/stream_id/span_id/producer_id/consumer_hint` 的第一波 rename 放同一 PR 批次？
  3. 如果分批，半冻结期有多长？review 纪律如何保持？
- **Opus的对GPT推荐线路的分析**：GPT 推荐 "一并纳入 + 先出 migration estimate" 路线 **完全正确**：
  1. 一并做的好处：只经历一次 breaking migration，contract tests 只改一次，compat chain 只加一次
  2. 分批做的代价：`nacp-session.SessionContext` 会存在 "trace_uuid 已改、stamped_by 还没改" 的半冻结期，review 时必须每次解释
  3. 先出 estimate 的必要性：基于我的 spot-check，repo 内 `trace_id` 40 处 + `stamped_by/reply_to` 各若干处 + 15 root contract tests + 14 e2e tests 都会被影响，**总改动面可能比 A1 P1-02 估计的大 2-3 倍**
- **Opus的最终回答**：`同意 GPT 推荐`。但**强硬要求 migration estimate 必须先产出**，且 estimate 必须包含：(a) 全仓 `grep -r "trace_id\|stamped_by\|reply_to\|producer_id\|consumer_hint\|stream_id\|span_id"` 结果总数；(b) 影响的 test 文件清单（包括 root 的 15+14=29 条跨包测试）；(c) 每 package 的 rename 工作量估算。estimate 通过后再开 A1 P2-01 rename PR。

- **问题**：`是否确认在 Phase 0 的 identifier migration 中，一并执行 stamped_by -> stamped_by_key 与 reply_to -> reply_to_message_uuid？`
- **业主回答**：同意 Opus 的判断。

### Q4 — Version baseline 是否正式采用“1.0.0 provisional，1.1.0 first frozen baseline”的口径（来源：A1）

- **影响范围**：`A1 / versioning policy / README / compat chain / contract tests`
- **为什么必须确认**：如果当前 `1.0.0` 被讲成已经冻结完成的最终基线，那么后续的 breaking rename 在版本语义上会自相矛盾。
- **当前建议 / 倾向**：`正式采用：1.0.0 = pre-freeze provisional baseline；1.1.0 = first owner-aligned frozen baseline`
- **Reasoning**：版本号不只是展示给外部看的标签，它也是团队内部判断“现在能不能再改 contract”的依据。当前仓库还在做一轮系统性 rename，如果还坚持说 `1.0.0` 已完全冻结，就会制造假稳定感。把 `1.0.0` 明确成 provisional，可以诚实表达项目状态；把 `1.1.0` 作为 first frozen baseline，则能给 tests、README、compat story 一个真正清晰的落点。

- **Opus的对问题的分解**：
  1. `1.0.0` 到 `1.1.0` 的切换时机：Phase 0 全部 PR 合并后？还是 Phase 0 P5-02 Baseline Cut 时？
  2. `1.0.0` 作为 provisional 时，外部读者（未来可能的 integrator）如何理解这个状态？
  3. 切到 `1.1.0` 后，compat floor 是否从 `1.0.0` 起算？（即 `1.1.0` 的 reader 能不能读 `1.0.0` 的 payload？）
- **Opus的对GPT推荐线路的分析**：GPT 推荐 "1.0.0 provisional → 1.1.0 frozen" 是**版本治理上最清晰的选择**：
  1. 诚实：承认当前代码还在做一轮系统性 rename，不是 final state
  2. 清晰切点：让 compat chain 有明确起始（`1.1.0` 是 first frozen），避免 "究竟从哪版开始算合同已冻结" 的模糊争论
  3. 与 Q3 `migration estimate` 配合：estimate 通过 + rename PR 合并 + baseline cut = 切到 `1.1.0`
- **Opus的最终回答**：`同意 GPT 推荐`。**补充 3 点执行细节**：
  1. `packages/nacp-core/src/version.ts` 的 `NACP_VERSION` 常量注释必须写明 "pre-freeze provisional; upgrade to 1.1.0 after Phase 0 rename batch"
  2. `NACP_VERSION_COMPAT` 在切 `1.1.0` 时应保持 `"1.0.0"`，即 `1.1.0` 的 reader 能通过 `migrate_v1_0_to_v1_1` 读旧 payload
  3. 建议 `version.ts` 新增 `NACP_VERSION_KIND: "provisional" | "frozen"` 常量，让 code 能 assert 当前版本状态（例如在测试启动时 log 出来）

- **问题**：`是否确认当前 1.0.0 只是 provisional baseline，待 Phase 0 rename / compat 完成后，再把 1.1.0 作为 first frozen baseline？`
- **业主回答**：同意。

---

## 2. Trace / Observability / Session 决策

### Q5 — Trace substrate 是否正式冻结为“DO storage hot anchor + R2 cold archive + D1 deferred query”（来源：A2, A7）

- **影响范围**：`A2 / A3 / A6 / A7 / trace persistence / future query layer / cost model`
- **为什么必须确认**：如果 trace 的物理落点没有先定，后续 benchmark、observability、evidence closure 都会在不同存储路线间来回摇摆。
- **当前建议 / 倾向**：`正式冻结当前方向，但把 benchmark artifact 视为启动条件，而不是可选附录`
- **Reasoning**：这是“地基到底放哪”的问题。对业主来说，可以理解成：trace 先写进哪里，哪里负责高频热写入，哪里负责长期归档，哪里先留作未来查询。现在最合理的工程路线是 DO 扛热写入、R2 扛归档、D1 暂不进热路径；但这个结论必须有最低限度的 benchmark 支撑，否则就是“看起来合理”的直觉决策。

- **Opus的对问题的分解**：
  1. **DO storage hot anchor** —— 由 `DoStorageTraceSink` 的 `tenants/{teamUuid}/trace/{sessionUuid}/{YYYY-MM-DD}.jsonl + _index` pattern 证实可行
  2. **R2 cold archive** —— `SessionRuntimeEnv.R2_ARTIFACTS` 已预留类型位，role 清晰但尚未接线
  3. **D1 deferred query** —— 仓内 **0 处 D1 wiring**，完全 greenfield
  4. **benchmark 要回答的问题**：DO hot-path append p50/p99 能否承受预期负载？new-instance timeline reconstruction 是否可用？write amplification 是否在可接受范围？
- **Opus的对GPT推荐线路的分析**：GPT 推荐冻结当前方向 + benchmark 作为启动条件 —— **方向正确**。但 A2 Phase 1 的 acceptance contract 不够严格：
  - P1-02 只说 "artifact 至少覆盖 append p50/p99、restart readback、write amp note、D1 gate note"，但**没给 pass/fail 阈值**
  - 如果 benchmark 跑出来 p99 = 500ms，算通过吗？250ms？100ms？没写
- **Opus的最终回答**：`conditional yes` —— 同意方向，但**要求 benchmark acceptance criteria 前置定数字**。最低建议阈值：
  - **append p50 ≤ 20ms，p99 ≤ 100ms**（DO storage put 在 isolate 内）
  - **new-instance timeline reconstruction 成功率 100%**（tenant-scoped key + `_index` 必须可读回）
  - **write amplification ≤ 2x**（即每条 trace event 实际 storage cost ≤ 2 × event size）
  如果 benchmark 跑出来任一指标不达标，回到 Q5 重评 substrate。这是防止 "benchmark 跑了、但结论是我们说了算" 的护栏。

- **问题**：`是否确认 nano-agent 当前的 trace substrate 采用 DO storage hot anchor + R2 cold archive + D1 deferred query，并要求在 Phase 1 前补 benchmark / investigation artifact？`
- **业主回答**：同意 Opus 的判断。
- **2026-04-18 执行后追记（A2 收口）**：A2 已产出 `docs/eval/after-skeleton-trace-substrate-benchmark.md` v1 + runner `packages/eval-observability/scripts/trace-substrate-benchmark.ts`，readback success = 100%、tenant-scoped key 不变；steady single-flush WA = 1.00× 满足 ≤ 2× 阈值，结论从 conditional yes 升格为 **evidence-backed yes**。新发现 F1：sink 在 multi-flush 场景下做 read-modify-write 导致 WA > 2×，属于 sink-level sizing policy（A3/P2 处理），不影响 substrate 决策。

### Q6 — TraceEvent base contract 是否必须显式携带 `traceUuid`（来源：A3）

- **影响范围**：`A3 / eval-observability / session-do-runtime / cross-package trace law / recovery`
- **为什么必须确认**：如果 trace 信息不进入基础 event contract，那么“trace-first”只会停留在设计口号层，而不会成为真正可追踪、可恢复的运行事实。
- **当前建议 / 倾向**：`必须显式携带 traceUuid；不要只靠 sessionUuid / turnUuid 等旁证来拼 trace`
- **Reasoning**：对小白业主来说，这相当于“每一条关键运行事件，是否都自带自己的链路编号”。如果没有这个字段，后面看日志、做恢复、做 replay 时，就只能靠时间、session、turn 去猜谁跟谁相关，这在单条链路里可能还能凑合，在多 trace 并存时就会失真。把 traceUuid 放进 base contract，是把“每个事件都知道自己属于哪条链”这件事写死。

- **Opus的对问题的分解**：
  1. `TraceEventBase` 当前字段：`eventKind / timestamp / sessionUuid / teamUuid / turnUuid? / stepIndex? / durationMs? / audience / layer / error?`（10 字段）
  2. 需要新增字段：`traceUuid`（必带）+ `sourceRole`（必带）+ `sourceKey?`（可选）+ `messageUuid?`（可选）
  3. 命名约定：TypeScript camelCase = `traceUuid`；NACP wire-level snake_case = `trace_uuid`
  4. **与 Q1 绑定**：业主已决定使用 `trace_uuid`（不是 `trace_id`），对应 TS 字段名 = `traceUuid`
- **Opus的对GPT推荐线路的分析**：GPT 推荐必须进 base contract **完全正确**。trace-first law 必须有 carrier，否则只是口号：
  - 对比 `context/safe/safe.py:239-274` 的 `SafeTrace`：trace_id 是 required first-class field，不是嵌在 session context 里
  - 对比 `context/smcp` 的 `control_payload.trace_uuid`：虽然是 optional，但至少是 top-level 字段
  - nano-agent 选择是最严格的：采用 smcp 命名（`trace_uuid`）+ safe 严格度（required + 不允许 silent continue）
- **Opus的最终回答**：`同意`。**关键执行提醒**：
  1. TS 字段名应为 **`traceUuid`**（camelCase），**不要误用 `trace_uuid`**（snake_case 只存在于 NACP wire 层）
  2. `sourceRole` 也应作为必带字段，让 event 能回答 "谁发出的"；`sourceKey?` / `messageUuid?` 可选
  3. 建议同时在 A3 P1-02 里给出 `TraceEventBase` 完整新 schema 草图，作为 Phase 2/3 的锚点

- **问题**：`是否确认 Phase 2 必须升级 TraceEvent base contract，使其显式携带 traceUuid，而不是只依赖 sessionUuid / turnUuid 等旁证？`
- **业主回答**：同意 Opus 的判断。
- **2026-04-18 执行后追记（A3 收口）**：A3 已把 `TraceEventBase` 扩展为 `eventKind / timestamp / traceUuid / sessionUuid / teamUuid / sourceRole / sourceKey? / messageUuid? / turnUuid? / stepIndex? / durationMs? / audience / layer / error?`，并暴露 `validateTraceEvent` / `assertTraceLaw`。session-do-runtime 的 `buildTurnBeginTrace / buildTurnEndTrace / buildStepTrace` 重命名并全部强制携带 trace carrier；audit codec `auditBodyToTraceEvent` 在缺失 `traceUuid` 时抛 "trace law violation"。accepted internal work 已无法绕过 trace-first 校验。

### Q7 — Observability 是否正式采用 Anchor / Durable / Diagnostic 三层语言（来源：A3, A4）

- **影响范围**：`A3 / A4 / A7 / event catalog / evidence policy / replay semantics`
- **为什么必须确认**：如果不先说明“哪些事件是锚点、哪些事件必须持久化、哪些只是诊断用”，后续事件分类会继续混用日志、trace、transcript 等模糊词。
- **当前建议 / 倾向**：`正式采用三层 conceptual layering，但明确它不直接替代底层实现 enum`
- **Reasoning**：三层语言的作用，不是替代代码里的类型，而是给团队一个统一的解释框架。对业主来说，这能帮助你区分：哪些事件是“系统不该丢”的锚点，哪些是“为了复盘必须留下”的 durable 证据，哪些只是帮助排查问题的诊断信息。没有这层语言，后面每加一个 event kind 都会重新争“这个到底该不该保存、该保存多久、对谁可见”。

- **Opus的对问题的分解**：
  1. 三层是 **conceptual layering**（认知层），不是 implementation enum（实现层）
  2. 与现有 `TraceLayer enum` (`live / durable-audit / durable-transcript`) 的映射：
     - `live ≈ Diagnostic`（可丢弃/可采样）
     - `durable-audit 覆盖 Anchor + Durable`（Anchor 是 Durable 的子集）
     - `durable-transcript 是 Durable 的 user-visible 子集`
  3. 典型 event kind 归属：`turn.begin/turn.end` = Anchor；`assistant.message` = Durable；`llm.delta` = Diagnostic
- **Opus的对GPT推荐线路的分析**：GPT 推荐采用 + 明确不替代 enum **完全正确**。这是 design review 阶段我就赞成的治理结构：
  - 新增 event 时有明确归类 framework：锚点不能丢、durable 必须存、diagnostic 可采样
  - 避免团队每次加 event 都重新争 "这个要 durable 吗"
- **Opus的最终回答**：`同意`。**执行建议**：
  1. 在 `packages/eval-observability/README.md` 和 public exports 注释里**首次出现三层语言时必须标注** "conceptual layering, not runtime enum"，避免团队把它与 `TraceLayer enum` 混用
  2. 在 A3 Phase 1 的 Trace Law Matrix 里给出一张 **event-kind → layer** 映射表（至少覆盖 `turn.*` / `llm.*` / `tool.*` / `hook.*` / `compact.*` / `checkpoint.*` 五个 family），作为 runtime 的归类 reference

- **问题**：`是否确认 nano-agent 的 observability 采用 Anchor / Durable / Diagnostic 三层语言，并要求后续 design / action-plan 按此组织？`
- **业主回答**：同意 Opus 的判断。
- **2026-04-18 执行后追记（A3 收口）**：三层概念语言已以 `ConceptualTraceLayer` 类型 + `CONCEPTUAL_LAYER_OF_TRACE_LAYER` 映射表落在 `packages/eval-observability/src/types.ts`；`DurablePromotionEntry` 新增 `conceptualLayer` 字段并为 `turn.begin / turn.end / session.start / session.end` 标注 `anchor`，其余 durable 事件标注 `durable`，live-only 事件维持 `diagnostic`。`DurablePromotionRegistry.listByConceptualLayer()` 暴露查询入口，root `test/trace-first-law-contract.test.mjs` 与 `test/observability-protocol-contract.test.mjs` 校验 anchor 归属。概念层语言与 runtime `TraceLayer` 实现枚举保持显式分离，不互相替代。

### Q8 — Follow-up / multi-round input family 是否必须进入 Phase 0，而不是继续延后（来源：A1, A4）

- **影响范围**：`A1 / A4 / nacp-session / client protocol / future API continuity`
- **为什么必须确认**：这决定项目是先把多轮输入作为正式协议的一部分冻结下来，还是继续只围绕 single-turn ingress 设计后再补第二代接口。
- **当前建议 / 倾向**：`不再延后；应在 Phase 0 先冻结最小 multi-round input family`
- **Reasoning**：这实际上是在决定“多轮对话是不是 v1 的一部分”。如果继续延后，眼前的 runtime 接线会更简单，但代价是后续 API 不得不经历一次明显断层：第一版只会启动会话，第二版再补继续输入。对项目定位来说，你们已经明确希望 contract surface 尽量在可控范围内做宽，这意味着至少要把多轮输入的**最小协议形状**先纳入 Phase 0，而不是让 runtime 用私有消息偷偷兜底。

- **Opus的对问题的分解**：
  1. 两种选择的 wall-clock cost：
     - **纳入 Phase 0**：+1-2 周（`nacp-session` 加一个 message family 的协议扩展）
     - **延后到下一阶段**：+3-6 月（下一阶段 API design 发现 v1 协议不支持多轮，反过来补 v1 协议，再做 v2 API）
  2. README §6 Todo Note Row 1 的明文承诺："Add a formal follow-up input family **right after MVP**"
  3. 此问题与 Q1 高度耦合：Q8 确认纳入 → Q1 必须给出 shape
- **Opus的对GPT推荐线路的分析**：GPT 推荐不再延后 **完全正确**。这是我在 design review §1.2.1 就明确推过的 CRITICAL 问题 —— 把 design doc 的 "继续 defer" 反转为 "纳入 Phase 0"。业主在 PX-QNA Q8 也已采纳此方向，action-plan 已正确响应（A1 P1-03 + P3-01 包含 follow-up family 冻结工作）。
- **Opus的最终回答**：`强烈同意`。**一个重要配套**：A1 Phase 1 必须产出 **follow-up family micro-spec**（Q1 答案）；如果 Q1 迟迟不定，Phase 3 会被自己的依赖卡住。建议 Q1/Q8 **一起拍板**，不要 Q8 先 yes 但 Q1 留空。

- **问题**：`是否确认 follow-up / multi-round input family 应在 Phase 0 进入正式 contract freeze，而不是继续推迟到后续阶段？`
- **业主回答**：同意 Opus 的判断。

---

## 3. External Seam / Verification 决策

### Q9 — v1 binding catalog 是否只纳入 capability / hook / fake provider，不纳入 skill worker（来源：A5）

- **影响范围**：`A5 / session runtime env / composition profile / future skill roadmap`
- **为什么必须确认**：如果 skill worker 也进入当前 binding catalog，Phase 4 的范围会立刻膨胀成“同时设计 skill runtime + skill discovery + skill contract”。
- **当前建议 / 倾向**：`v1 只闭合 capability / hook / fake provider；skill worker 继续保留为 reserved seam`
- **Reasoning**：这不是否定 skill 的价值，而是在决定当前阶段的边界纪律。对业主来说，可以把它理解为：现在要不要把“未来最重要的扩展方向”也一起做进第一轮远端闭环。答案更适合是“先为 skill 留槽位，但不在这一轮把它拉成真实运行依赖”，否则 P4 会被过早扩成第二个大项目。

- **Opus的对问题的分解**：
  1. 现状：`SessionRuntimeEnv` 已有 `SKILL_WORKERS` 预留，但无具体实现
  2. 纳入 v1 的代价：需要同时设计 skill runtime + skill contract + skill discovery，P4 范围翻倍
  3. 继续 reserved 的代价：Skill 继续延后
  4. README §3/§4.1 把 Skill 列为 nano-agent **三大差异化** 之一（上下文管理 / Skill / 稳定性），design review §H9 指出 Skill 在全部 15 份 design + 10 份 action-plan 里基本缺位
- **Opus的对GPT推荐线路的分析**：GPT 推荐 reserved **完全正确**。P4 scope discipline 是对的 —— 不把 Skill 强塞进这一轮。但**这个答案本身带出一个未解问题**：Skill composition 何时启动？
  - 所有 15 份 design 中，只有 `PX-capability-inventory.md §9.3` 顺口提了 "skills 也纳入 inventory" 一次
  - 10 份 action-plan 中，只有 A5 §3.1 一句 "reserved seam"
  - 这意味着 Skill 会一直被延后到 "以后再说"
- **Opus的最终回答**：`同意 Q9 本身`。但**强烈建议业主在 A10 exit pack 或下一阶段的 plan 中增加 "Skill composition roadmap handoff" 条目**，明确下一阶段（after A10）的 Skill design entry point，避免 Skill 被 indefinitely defer。**否则 nano-agent 三大差异化之一会在 after-skeleton 整个阶段里完全缺席**。

- **问题**：`是否确认 Phase 4 的 v1 binding catalog 只覆盖 capability / hook / fake provider 三条主 seam，而 skill worker 继续作为 reserved seam？`
- **业主回答**：同意 Opus 的判断。

### Q10 — Phase 5 是否正式定位为 verification gate，而不是独立实现 phase（来源：A5, A6）

- **影响范围**：`A5 / A6 / action-plan sequencing / release gate / deploy verification`
- **为什么必须确认**：如果 P5 被当成独立实现 phase，它会和 P3/P4 争主线；如果它被定位为 gate，就会变成对前序闭环的专门验收阶段。
- **当前建议 / 倾向**：`正式定位为 verification gate`
- **Reasoning**：一个常见误区是把“验证阶段”也当成和实现阶段并列推进的 workstream。结果就是：验证对象本身还在变，smoke 结果每天失效，团队既做实现又追验证噪音。把 Phase 5 定位成 gate，等于明确说：先把 P3/P4 的最小闭环做出来，再拿 P5 去做 deploy-shaped / real-boundary 验收，这样验证结果才有解释力。

- **Opus的对问题的分解**：
  1. 作为 gate 的含义：P5 只在 P3 + P4 闭合后启动
  2. 作为并列 phase 的代价：P3/P4 实现面还在变动，smoke 结果反复失效
  3. 启动条件明确：A4 全部 Phase 完成 + A5 全部 Phase 完成 = A6 可启动
- **Opus的对GPT推荐线路的分析**：GPT 推荐 gate 定位 **完全正确**。这是 v1 review §5.1 我就推过的建议（把 Phase 5 作为 Deployment Dry-Run）。A6 §2.3 边界判定表已经明确 "若 WsController / HttpController 仍是 stub，P5 不能进入 L1/L2"。
- **Opus的最终回答**：`强烈同意`。**执行建议**：在 A6 §7.2 约束与前提里**明确写死** "Phase 5 只在 A4 + A5 各自 Phase 5 exit pack 完成后启动"。避免后续出现 "P5 已启动但 P4 仍在改" 的回归场景 —— 这在 software 项目里是非常常见的 anti-pattern。

- **问题**：`是否确认 Phase 5 是一个 verification gate，而不是与 P3 / P4 并列推进的独立实现 phase？`
- **业主回答**：同意 Opus 的判断。

### Q11 — L1 / L2 的默认运行模式是否固定为 hybrid：L1 用 `wrangler dev --remote`，L2 用 `wrangler deploy + workers.dev smoke`（来源：A6）

- **影响范围**：`A6 / wrangler profiles / local loop / real-boundary smoke / team workflow`
- **为什么必须确认**：如果不先冻结默认运行模式，后续验证脚本、profile 命名、成本预期都会分叉。
- **当前建议 / 倾向**：`采用 hybrid：L1 默认 wrangler dev --remote，L2 必须 deploy + workers.dev smoke`
- **Reasoning**：这里本质上是在平衡两种需求：开发反馈要快，验证边界要真。只用 `dev --remote` 很方便，但不等于真正 deploy-shaped；只用 deploy smoke 又会让每次迭代都太重。对业主来说，hybrid 是最稳的折中：把日常快速验证和真正上线形状验证拆成两层，而不是用一种模式假装两种需求都满足。

- **Opus的对问题的分解**：
  1. `wrangler dev --remote`：快速反馈（~1s iteration）、真实 Cloudflare edge、需 paid Workers account、DO 在 local/remote 模式间有细微差异
  2. `wrangler deploy + workers.dev smoke`：真正 production-shaped、每次 iteration ~10s deploy、可能 rate limit、需要真 Cloudflare subdomain
  3. **secret 注入机制**：OpenAI API Key 在两种模式下如何获取？
- **Opus的对GPT推荐线路的分析**：GPT 推荐 hybrid **完全正确**，是我 v1 review §4.4 推过的方案。两种模式分层后：
  - L1 负责日常 dev loop（每天跑多次）
  - L2 负责里程碑验证（Phase 4/5 收口时跑）
- **Opus的最终回答**：`同意`。**补充 secret 注入 policy**：
  - L1 (`wrangler dev --remote`): `.dev.vars` 文件（`.gitignore` 忽略），owner-local
  - L2 (`wrangler deploy + smoke`): `wrangler secret put OPENAI_API_KEY` 注入到真 Worker，与 Cloudflare-native 一致
  - **禁止**：任何形式的 `.env` / 环境变量注入（容易被 commit 泄漏）
  这一条需要纳入 A6 P4-01 执行细节。

- **问题**：`是否确认 Phase 5 的默认运行模式采用 hybrid：L1 走 wrangler dev --remote，L2 走 wrangler deploy + workers.dev smoke？`
- **业主回答**：同意 Opus 的判断。

### Q12 — L2 real smoke 的唯一最小 golden path 是否采用 OpenAI-compatible + `gpt-4.1-nano`（来源：A5, A6）

- **影响范围**：`A5 / A6 / llm-wrapper / fake provider mirror / secrets / smoke cost`
- **为什么必须确认**：如果不先定真实 provider / model，fake provider 无法稳定 mirror，Phase 5 的 real smoke 也无法形成可重复的最小链路。
- **当前建议 / 倾向**：`采用一条唯一最小 golden path：OpenAI-compatible provider + gpt-4.1-nano`
- **Reasoning**：这里要解决的不是“哪个模型最好”，而是“哪个最适合作为第一条真实验证链”。对小白业主来说，golden path 的目标是稳定、便宜、易复用，而不是代表最终全部商业能力。`gpt-4.1-nano` 的价值在于它能最大化复用当前 OpenAI-compatible adapter，降低额外适配成本，让 fake provider 和 real provider 尽量共用一套 shape。

- **Opus的对问题的分解**：
  1. 候选 provider / model：
     - **`gpt-4.1-nano`** (OpenAI): 极低成本 (~$0.10/1M tok)、稳定、streaming 兼容、与现有 `OpenAIChatAdapter` 直接对齐
     - **`claude-haiku-4-5`** (Anthropic): 低成本、稳定，但需要新增 Anthropic adapter（额外工作量）
     - **`gpt-4o-mini`** (OpenAI): 成本略高但质量更好
     - **fake-only**: 完全不跑真实 provider（失去 real-boundary 证据）
  2. fake provider worker 的 mirror 范围：Chat Completions schema
- **Opus的对GPT推荐线路的分析**：GPT 推荐 `gpt-4.1-nano` **完全正确**：
  1. 零额外 adapter 工作（复用现有 `OpenAIChatAdapter`）
  2. fake provider worker 可一次 mirror Chat Completions schema 完成
  3. 单 smoke call 成本 <$0.001（按 ~500 tok input + 200 tok output 估算），100 次 smoke <$0.1
  4. 不引入 Anthropic API 认证的 dependency
- **Opus的最终回答**：`同意`。**补充实际使用建议**：
  1. Claude haiku 作为 Phase 8+ 扩展项（下一阶段 multi-provider matrix）
  2. smoke 里的 prompt 应该是 deterministic 的（例如 `"Reply with exactly: OK"`），避免每次 smoke 都因为 model randomness 产生不同输出
  3. smoke 结果检查不要依赖 full response match，只检查 `response.status === "ok" && response.output.length > 0`

- **问题**：`是否确认 Phase 5 的 L2 real smoke 只先走一条唯一最小 golden path：OpenAI-compatible provider + gpt-4.1-nano？`
- **业主回答**：同意 Opus 的判断。

---

## 4. Storage / Context / Evidence 决策

### Q13 — P6 的 calibration verdict 是否正式采用四档：`provisional / evidence-backed / needs-revisit / contradicted-by-evidence`（来源：A7）

- **影响范围**：`A7 / storage-topology / workspace-context-artifacts / eval-observability / future reports`
- **为什么必须确认**：如果没有一套固定 verdict 语言，Phase 6 会产生很多 evidence，但很难把这些 evidence 转化成可以审阅、可以冻结、可以撤回的结论。
- **当前建议 / 倾向**：`正式采用四档 calibration verdict`
- **Reasoning**：你可以把这套 taxonomy 理解成“项目如何判断一个假设现在处于什么状态”。没有它，团队只能说“好像更有把握了”“看起来不太对”，但没法形成正式结论。四档 verdict 的意义，就是给每个 hypothesis 一个清楚的阶段：还只是猜测、已有证据支撑、需要回头重看、或者已被证据推翻。

- **Opus的对问题的分解**：
  1. 四档覆盖 hypothesis lifecycle:
     - `provisional`：设计阶段猜测，未被 runtime evidence 支撑
     - `evidence-backed`：已有 ≥N 条 evidence 支撑
     - `needs-revisit`：evidence 累积到需要重新判断
     - `contradicted-by-evidence`：evidence 与假设相反，必须撤回
  2. 升格阈值未定（N = ?）
- **Opus的对GPT推荐线路的分析**：GPT 推荐四档 **完全正确**。这是 Phase 6 evidence closure 的核心裁判尺：
  - 没有四档，evidence 只是一堆 log，无法形成 "某条假设现在算不算成立" 的可审阅结论
  - 四档精确互斥，覆盖 hypothesis lifecycle 所有状态
- **Opus的最终回答**：`同意`。**强烈要求前置定升格阈值**：
  - `provisional → evidence-backed`：至少 **3 条独立 evidence signals** 且不矛盾
  - `evidence-backed → needs-revisit`：出现 **≥1 条 contradictory signal** 或 30 天无新 evidence 支撑
  - `→ contradicted-by-evidence`：**≥5 条 contradictory signals** 或 1 条 critical contradiction（例如 placement hypothesis 被实测性能打脸）
  这些数字不必僵化，但 A7 Phase 4 P4-03 必须给出初始值，后续可根据实践调整。

- **问题**：`是否确认 Phase 6 的 calibration verdict 采用 provisional / evidence-backed / needs-revisit / contradicted-by-evidence 四档？`
- **业主回答**：同意 Opus 的判断。

### Q14 — P6 verdict 与 PX capability maturity grade 是否永久分离（来源：A7）

- **影响范围**：`A7 / PX-capability-inventory / review language / future docs`
- **为什么必须确认**：如果把“假设有没有被证据支持”与“某项能力成熟不成熟”混用成一套词，团队后面会持续误读文档。
- **当前建议 / 倾向**：`永久分离：P6 verdict 只描述 hypothesis status；PX grade 只描述 capability maturity`
- **Reasoning**：这两个东西都和“证据”有关，所以很容易被混在一起，但它们回答的是完全不同的问题。前者是在说“这条判断是否已被证明”；后者是在说“这个能力是否已成熟到可以对外承诺”。如果不分开，reviewer、实现者、业主会在同一张表里看见两个“好像都在说成熟度”的体系，最后谁也说不清到底在判什么。

- **Opus的对问题的分解**：
  1. **P6 verdict**（hypothesis status）：针对 **设计假设**（placement hypothesis / context assembly policy / compact threshold），回答 "这条假设是否已被证据支撑"
  2. **PX grade**（capability maturity）：针对 **capability**（如 `curl` / `rg` / `ts-exec`），回答 "这个能力是否已成熟到可对外声明"
  3. 例子：
     - "DO storage hot anchor hypothesis is `evidence-backed`" （P6 verdict）
     - "`curl` capability is at `E1 grade (partial)`" （PX grade）
     二者语义完全不同
- **Opus的对GPT推荐线路的分析**：GPT 推荐永久分离 **完全正确**。这是 design review §H3 我就标的冲突 —— 两套术语都带 "evidence" 字眼，如果不显式分离会混用。
- **Opus的最终回答**：`同意`。**补充文档纪律**：在任一术语**首次出现**时必须标注所属体系，例如：
  - "The storage placement hypothesis is **evidence-backed (P6 hypothesis status)**"
  - "The `rg` capability is at **E1 grade (PX capability maturity)**"
  建议 A7 P1-03 把这条作为 mandatory review checklist 项，PR review 时必须检查。

- **问题**：`是否确认 P6 verdict 与 PX capability maturity grade 永久分离，前者只描述 hypothesis status，后者只描述 capability maturity？`
- **业主回答**：同意 Opus 的判断。

### Q20 — 未来任何 D1 角色升格前，是否都必须先提交独立 benchmark / investigation memo（来源：A2, A7）

- **影响范围**：`A2 / A7 / future D1 decision / supporting memos / substrate governance`
- **为什么必须确认**：如果没有这条 gate，团队未来很容易在没有新证据的情况下，把 D1 从 deferred query seam 悄悄拉回热路径讨论。
- **当前建议 / 倾向**：`必须先交独立 memo，再允许改 action-plan`
- **Reasoning**：这道题不是在决定“现在用不用 D1”，而是在决定“以后谁有权改这个决定、靠什么改”。对业主来说，这是一条防止 decision creep 的护栏：避免团队在未来某次实现压力下，凭直觉就把 D1 重新拉进主路径。要求先交独立 memo，等于强制未来任何角色升格都要经过新的 benchmark、成本、职责边界审视。

- **Opus的对问题的分解**：
  1. "升格" 定义：D1 从 `deferred query seam` 变为其他任何角色（hot path writer / read path / cache / session storage）
  2. memo 必须包含的内容：触发原因、benchmark 结果、成本模型、职责重划、回退方案
  3. review flow：memo → owner review → 通过后才改 action-plan → 再改代码
- **Opus的对GPT推荐线路的分析**：GPT 推荐强制独立 memo **完全正确**。这是防止 decision creep 的核心护栏：
  - 防止 "我们现在好像需要 D1 做查询" → 直接改代码 → D1 悄悄进热路径 → 无 benchmark 支撑
  - 强制 memo 机制把 "凭直觉改决定" 挡在门外
- **Opus的最终回答**：`强烈同意`。**补充 memo 模板要求**（这是防止 memo 变形式主义的关键）：
  1. **触发原因**：为什么现在需要改 D1 角色？（引用具体 evidence）
  2. **Benchmark 结果**：write amplification / query latency p50/p99 / cost model（与 Q5 benchmark 同质量要求）
  3. **职责重划**：D1 承担什么新职责？DO storage / R2 对应卸什么？
  4. **回退方案**：如果 D1 升格后发现不成立，如何回退？
  5. **影响的 action-plan 条目**：哪些 A-plan 需要修改？
  建议 memo 文件名规范 = `docs/eval/trace-substrate-benchmark-v{N}.md`，以 version 递增。

- **问题**：`是否确认：未来若要提升 D1 的角色，必须先提交独立的 trace substrate benchmark / investigation memo，不能直接修改现有 action-plan 结论？`
- **业主回答**：同意 Opus 的判断。
- **2026-04-18 执行后追记（A2 收口）**：本 gate 已变成 hard gate 并写入 `docs/eval/after-skeleton-trace-substrate-benchmark.md` §4 / §5 与 `docs/design/after-skeleton/P1-trace-substrate-decision.md` §9.3。文件命名规范固定为 `docs/eval/trace-substrate-benchmark-v{N}.md`；任何 D1 角色升格必须先填齐 5 项必备字段（trigger / benchmark / 职责重划 / 回退方案 / 影响的 action-plan 条目），且 benchmark 须复用本仓 runner 或扩展 mode，禁止口头讨论替代。

---

## 5. Minimal Bash / Capability Governance 决策

### Q15 — v1 canonical search command 是否只保留 `rg`（来源：A8）

- **影响范围**：`A8 / fake bash registry / planner / inventory / prompt ergonomics`
- **为什么必须确认**：这决定 v1 的搜索能力面，是坚持一个窄而硬的 canonical command，还是为了兼容习惯而把 grep family 一并纳入正式支持面。
- **当前建议 / 倾向**：`v1 只保留 rg 作为 canonical search command`
- **Reasoning**：对业主来说，这题本质上是在问：“我们是先把一个搜索命令做真，还是先把三个看起来像搜索的命令都挂上去？”在 Worker / fake bash 这个前提下，更稳的路线是先把 `rg` 做成真实 baseline，因为它能减少实现面与文档面的漂移。如果一开始就把 `grep / egrep / fgrep` 都纳入正式支持，团队会很快陷入兼容历史 flag 语法的泥潭。

- **Opus的对问题的分解**：
  1. **只保留 `rg`** 的优点：(a) 语法现代 (default smart case + `.gitignore`)；(b) 对 LLM 训练期待已足（多数 2024+ 模型都会用 `rg`）；(c) 实现只需维护一个搜索 backend
  2. **保留 `grep` family** 的代价：额外维护三个 alias + 解析 legacy flags (`-l / -L / -A / -B / -C / -E / -F / -r` 等)
  3. 与 Q16 配套：Q15 = canonical 只有 `rg`；Q16 = 是否早做 `grep → rg` 兼容 alias（不冲突）
- **Opus的对GPT推荐线路的分析**：GPT 推荐只保留 `rg` **完全正确**。这是 "窄而硬" 原则的正确应用 —— 一次 canonical 只做一个 search command，能最大化 disclosure 清晰度。
- **Opus的最终回答**：`同意`。但请同时读 Q16 回答 —— Q15 约束 canonical，Q16 约束 ergonomic alias，两者是不同问题。canonical = 只有 `rg`（capability inventory 层面）；alias = `grep` 接 `rg`（客户端兼容层面）。这样**既保持治理 clarity，又降低 LLM 幻觉成本**。

- **问题**：`是否确认 v1 canonical search command 只保留 rg，不把 grep / egrep / fgrep 一并纳入正式支持面？`
- **业主回答**：同意 Opus 的判断。

### Q16 — 在保持 `rg` 为 canonical 的前提下，是否优先补一个窄口的 `grep -> rg` alias（来源：A8）

- **影响范围**：`A8 / LLM compatibility / fake bash ergonomics / inventory`
- **为什么必须确认**：如果这条 alias 不尽早补，LLM 会频繁生成 `grep ...` 后再撞 unsupported；如果补得太宽，又会把系统重新拖回 grep family 兼容泥潭。
- **当前建议 / 倾向**：`尽早补一个最窄 alias，只接住最常见 pattern 与少量兼容 flag`
- **Reasoning**：这题的关键不是“要不要支持 grep”，而是“要不要为 LLM 常见习惯做一个低成本缓冲层”。很多模型天生就会敲 `grep`，如果系统每次都先报不支持，再引导改用 `rg`，会浪费很多 turn 预算。补一个非常窄的 alias，可以减少幻觉成本，同时又不牺牲 `rg` 作为 canonical truth 的治理清晰度。

- **Opus的对问题的分解**：
  1. **不做 alias 的代价**：每次 LLM 生成 `grep ...` 命中 unsupported → LLM 被迫改用 `rg` → 浪费 ~100-300 tokens/turn
  2. **做窄 alias 的代价**：<50 LOC 实现成本
  3. **alias 范围**：接受哪些 flags？
     - **最窄方案**：只接 pattern + `-i` (case-insensitive) + `-n` (line numbers)
     - **稍宽方案**：+ `-r` (recursive) + `-l` (files-with-matches) + `-E` (extended regex)
     - **太宽方案**：`grep` 完整 flag 矩阵 → 回到兼容泥潭
- **Opus的对GPT推荐线路的分析**：GPT 推荐尽早补最窄 alias **完全正确**。这是 design review §H10 我就推过的优先项：
  - README §1 明确说 "grep / rg / cat / curl" 是 LLM 训练期待
  - P7a §6.1 §取舍 2 承认 "LLM 某些习惯性 `grep` 用法需要 prompt 引导或 alias 未来再补"
  - 三者组合意味着 LLM 会频繁生成 `grep`，如果延后 alias 会浪费大量 turn 预算
- **Opus的最终回答**：`强烈同意`。**具体 alias 范围建议采用最窄方案**：
  ```
  接受：grep <pattern> [file|dir]
  接受的 flags：-i (case-insensitive), -n (line numbers)
  不接受的 flags：其他所有 flags（-A/-B/-C/-E/-F/-l/-r/...），触发 "use rg directly for this flag" 错误
  ```
  这样 50 LOC 就能覆盖 80%+ LLM `grep` 用法；剩下 20% 会得到明确的 "改用 rg" 引导，不 silent 失败。

- **问题**：`在保持 rg 为 canonical command 的前提下，是否希望优先补一个最窄的 grep -> rg compatibility alias？`
- **业主回答**：同意 Opus 的判断。

### Q17 — `curl` richer method / header / body / timeout 语义是否只允许走 structured path（来源：A9）

- **影响范围**：`A9 / planner / capability-runtime / prompt / future remote fetch worker`
- **为什么必须确认**：如果 richer curl 继续沿 bash argv 扩张，planner 和 fake bash grammar 会迅速变复杂；如果只走 structured path，演进路线会稳定得多。
- **当前建议 / 倾向**：`明确只通过 structured capability path 扩张 richer curl`
- **Reasoning**：这里的本质是“扩展能力到底放在哪一层”。把复杂 curl 语义塞进 bash 字符串，看起来更像 shell，但对 Worker-agent 来说，代价是 parser、quote、flag、escaping 复杂度瞬间膨胀。把复杂输入统一放进 structured path，则能让 bash path 只保留 `curl <url>` 这种最小入口，而把真正会增长的能力收敛到 schema 层。

- **Opus的对问题的分解**：
  1. 现状：`parseSimpleCommand()` 不支持 pipes/redirects/escapes；`curl` handler 只取第一个 arg 当 URL
  2. bash argv 扩张的代价：每加一个 flag 要扩 parser，quote escaping / flag grammar 复杂度膨胀
  3. structured path 的优势：capability-runtime 只需定义 `{ url, method?, headers?, body?, timeout? }` schema，不关心如何被调用
  4. 两路径协同：bash argv 保留 `curl <url>` 最小形态；richer options 只通过 structured tool call
- **Opus的对GPT推荐线路的分析**：GPT 推荐 structured only **完全正确**。这是架构级正确决策：
  - bash argv 一旦放开，演进极不稳定 —— 每增加一个 flag 就可能破坏前一个 flag 的解析
  - structured path 的好处是**不关心如何被调用**，bash string 与 structured 都 map 到同一 schema
  - Codex 的 `tool_registry_plan.rs` 正是这种 registry-first 做法
- **Opus的最终回答**：`同意`。**执行建议**：在 A9 P1-01 里**明确写死**：
  ```
  bash path: 只承诺 `curl <url>` 最小形态；任何其他 token 触发 
    "Use structured tool call with { url, method, headers, body, timeout } for richer options" 错误
  structured path: capability input schema = { url, method?, headers?, body?, timeout? }
  ```
  并在 capability runtime 的 prompt disclosure 里明确告知 LLM："For simple `curl <url>` use bash; for POST/headers/body use structured tool call."

- **问题**：`是否确认 curl 的 richer method / header / body / timeout 语义只通过 structured capability path 扩张，而不通过 bash argv grammar 扩张？`
- **业主回答**：同意 Opus 的判断。

### Q18 — `git` v1 是否严格冻结为 `status / diff / log` 三个只读子命令（来源：A10）

- **影响范围**：`A10 / capability inventory / fake bash governance / future virtual VCS design`
- **为什么必须确认**：这决定 v1 是只做只读 introspection，还是现在就预留 mutating VCS 路线。
- **当前建议 / 倾向**：`严格冻结为 status / diff / log；mutating git 全部 deferred`
- **Reasoning**：对业主来说，这题其实是在问：“v1 要不要承诺一个虚拟 git 仓库模型？”一旦要支持 `add / commit / branch / restore`，就不再只是几个命令的事，而是要设计虚拟 index、ref、history、冲突与回滚。先把 `status / diff / log` 做成只读 baseline，能满足大部分“看状态、看改动、看历史”的理解类需求，同时避免过早承诺完整 VCS 系统。

- **Opus的对问题的分解**：
  1. 现状：`vcs.ts:16-48` 只实现 `status/diff/log` stubs
  2. 冻结 read-only 的优点：(a) 避免承诺 virtual commit model（需要设计 virtual SHA / ref resolution / merge-conflict logic）；(b) 符合 LLM 最常用模式（check state → diff to understand → log to trace history）
  3. mutating git 需要的前置设计：virtual index、virtual refs、virtual history、conflict resolution —— 这是 Phase 8+ 的工作量
  4. 实现算法选择：HEAD vs workspace snapshot 对比 / git binary shell-out / libgit2-wasm
- **Opus的对GPT推荐线路的分析**：GPT 推荐严格冻结 **完全正确**。mutating git 需要的 virtual index/ref/history 设计工作量巨大，与 v1 scope 不匹配。read-only subset 也已足够覆盖 LLM 的典型 workflow。
- **Opus的最终回答**：`同意`。**补充实现建议**（A10 未深入讨论）：
  1. **实现算法**：v1 建议基于 **workspace snapshot + last-checkpoint diff** 实现，**不引入 git binary shell-out 或 libgit2-wasm 依赖**
     - `git status`：对比 current workspace vs last checkpoint 的 file hash
     - `git diff`：对比 current file content vs last checkpoint file content（line-based diff）
     - `git log`：展示 session 内所有 checkpoints 的时间线 + summary
  2. **prompt 告知**：在 capability inventory 里明确告知 LLM："git v1 only supports read-only introspection (status/diff/log). Any mutating operation (`add`, `commit`, `restore`, `branch`) is deferred — use workspace API (`write`, `rm`) for file changes."
  3. **未来 upgrade path**：保留 `ServiceBindingTarget` 作为未来 remote virtual-git worker 的 upgrade 槽

- **问题**：`是否确认 git v1 只冻结 status / diff / log 三个只读子命令，不提前承诺 add / commit / restore / branch 等 mutating subset？`
- **业主回答**：同意 Opus 的判断。

### Q19 — Capability inventory 是否正式采用五级口径，并单列 ask-gated disclosure（来源：A10）

- **影响范围**：`A10 / PX-capability-inventory / prompt / tool disclosure / review gate`
- **为什么必须确认**：如果不把“能力当前是什么状态”与“调用是否需要 ask”分开披露，后续 capability truth 会继续混乱。
- **当前建议 / 倾向**：`正式采用 Supported / Partial / Deferred / Unsupported / Risk-Blocked 五级口径，并把 ask-gated 作为正交维度单列`
- **Reasoning**：这相当于给能力治理建立一个统一标签系统。五级口径解决的是“能力做到了什么程度”；ask-gated 解决的是“即使支持，是否仍需要用户确认”。如果把这两件事混成一句自然语言，README、prompt、registry、review comment 就会开始各说各话，最后没人能快速判断某个命令到底是没做、半做、故意不做，还是做了但需要确认。

- **Opus的对问题的分解**：
  1. 五级语义：
     - **Supported**：declaration + implementation + evidence 三者都成立
     - **Partial**：declaration 有，但实现为 stub/degraded
     - **Deferred**：明确不做，但未来可回到议程
     - **Unsupported**：主动拒绝（如 `sudo / ssh`）
     - **Risk-Blocked**：因 V8 isolate budget 主动阻断（如 `tar / gzip`）
  2. ask-gated 正交维度：`curl` = Partial + ask-gated；`ls` = Supported + allow-gated
  3. 与 PX grade E0-E3 的关系：五级是 "status (做到了什么程度)"；E0-E3 是 "evidence strength (证据强度)"
- **Opus的对GPT推荐线路的分析**：GPT 推荐五级 + 正交 ask-gated **完全正确**：
  - 五级明确区分 "我们故意不做"（Deferred/Unsupported/Risk-Blocked）与 "我们在做但还没做完"（Partial）
  - prompt / client disclosure 必须能传达这两类区别 —— deferred 是 "将来会有"，unsupported 是 "永远不会有"，risk-blocked 是 "因资源风险而不可得"
  - ask-gated 作为正交维度让 client 知道哪些命令需要用户确认
- **Opus的最终回答**：`同意`。**表格建议**：inventory 每行展示 **3 列独立** —— `maturity grade (E0-E3)` + `status (五级)` + `policy gate (allow/ask/deny)`。示例：
  ```
  | capability | grade | status      | policy |
  | `ls`       | E3    | Supported   | allow  |
  | `curl`     | E1    | Partial     | ask    |
  | `sudo`     | —     | Unsupported | deny   |
  | `tar`      | —     | Risk-Blocked| deny   |
  | `mkdir`    | E1    | Partial     | ask    |
  ```

- **问题**：`是否确认 capability inventory 采用 Supported / Partial / Deferred / Unsupported / Risk-Blocked 五级口径，并要求 ask-gated command 单独披露？`
- **业主回答**：同意 Opus 的判断。

---

## 6. Action-Plan 整编后新增补的问题

### Q21 — `mkdir` 在 v1 / Phase 7a 中应保持“显式 partial + compatibility ack”，还是现在就补最小 directory primitive（来源：A8）

- **影响范围**：`A8 / capability-runtime / workspace backend interface / docs disclosure / tests`
- **为什么必须确认**：`mkdir` 现在既不是完整真实实现，也不能再继续停在“看起来成功但语义不清”的状态；Phase 7a 必须把它的 contract 讲明白。
- **当前建议 / 倾向**：`优先保持显式 partial + compatibility ack，并把真实 directory primitive 留给后续更大范围的 workspace backend 演进`
- **Reasoning**：这题的关键，不是“空目录创建难不难”，而是“为了让一个命令看起来更真，是否要提前改底层 workspace 抽象”。如果现在就补 directory primitive，影响的不只是 `mkdir`，还会波及 backend 接口、path law、测试资产和后续 file/search consistency。对当前阶段来说，更稳的选择通常是：诚实承认 `mkdir` 还是 partial，只要它不会误导 LLM 和 reviewer，就不要为了面子过早扩底座。

- **Opus的对问题的分解**：
  1. 现状：`mkdir` handler 只返回 ack，`WorkspaceBackend` 接口没有 directory primitive
  2. 两种选择：
     - **(a) 补 directory primitive**：需要改 `WorkspaceBackend` 接口 + 所有 backend 实现 + 所有 mount 实现 + 多 package 联动。影响 `workspace-context-artifacts` / `capability-runtime` / mount tests 等
     - **(b) 保留 compat ack + 显式 partial**：不改底层，但需要在 prompt / inventory / docs 里明确告知 LLM "mkdir 只是兼容外形，不创建真实目录实体"
  3. 当前 workspace backend 实际语义：file-map + implicit prefix（没有 inode/dir 概念）
- **Opus的对GPT推荐线路的分析**：GPT 推荐 partial + compat ack **完全正确**。补 directory primitive 会波及多个 package，工作量远超 "修 `mkdir` 一个命令" 的认知。而且在当前 workspace 实现（file-map + implicit prefix）下，"目录是否存在" 这个概念本来就是虚构的 —— 只要 prefix 下有 file，prefix 就 "存在"。
- **Opus的最终回答**：`同意 GPT 推荐`。**执行建议**：
  1. `mkdir <path>` 继续返回 success ack，但在 capability inventory 标注 "Partial (compatibility ack only; no directory entity created)"
  2. prompt 里明确告知 LLM："`mkdir` 仅创建前缀 acknowledgement，不创建独立目录实体。要让目录 "存在"，请向该 prefix 下的路径 write 至少一个 file。"
  3. 在 A8 P2-02 里补一个 regression test，验证 `mkdir /foo` 后 `ls /` **不应该** 出现 `foo` entry（直到 `/foo/bar.txt` 被 write）
  4. **未来 upgrade path**：如果 workspace backend 未来要支持真实 directory entity（例如 R2-backed artifacts 需要 list-prefix），那时再统一扩 `WorkspaceBackend` 接口

- **问题**：`是否确认 Phase 7a 中的 mkdir 继续维持“显式 partial + compatibility ack”，而不是为了 v1 提前改造 workspace backend 去补最小 directory primitive？`
- **业主回答**：同意 Opus 的判断。

### Q22 — `ts-exec` 的 v1 substrate 应如何选择：本地 isolate 沙箱、远程 tool-runner，还是诚实 partial（来源：A9）

- **影响范围**：`A9 / capability-runtime / security policy / resource budget / future remote worker design`
- **为什么必须确认**：`ts-exec` 是 LLM 非常高频期待的工具，但在 Worker / V8 isolate 前提下也是风险最高的工具之一；如果不先做架构级决策，Phase 7b 会长期停在“命令已注册，但没人知道它到底算不算真实支持”的状态。
- **当前建议 / 倾向**：`v1 优先采用诚实 partial，并保留 future remote tool-runner 升级口；只有在本地 isolate 沙箱有明确证据且成本可控时，才考虑转正`
- **Reasoning**：这题是在决定“我们是否现在就承诺一条真实脚本执行路线”。本地 isolate 沙箱听起来最完整，但它需要可靠的安全边界、取消机制、输出控制和资源预算；远程 tool-runner 更可扩展，但又依赖 Phase 4/5 的远端闭环先成熟。对当前项目阶段来说，最稳妥的做法通常不是勉强给出一个“看起来能跑”的执行器，而是先诚实地把它标为 partial / ask-gated，再为未来 remote substrate 留正式升级口。

- **Opus的对问题的分解**：
  1. 三种选择：
     - **(a) 本地 V8 isolate sandbox** (如 `quickjs-emscripten` / `sandboxjs` / V8 isolate-in-isolate): 完整 inline 执行，但需要评估 V8 isolate compat、memory budget (Worker 128MB)、cancel mechanism、输出 size cap
     - **(b) 远程 tool-runner worker**: 更可扩展，但依赖 P4 fake provider + service-binding 稳定后才能接
     - **(c) 诚实 partial (inline code only, syntax check + length ack)**: 低成本，保守，不承诺真实执行
  2. LLM 期待：`ts-exec` 是 "分析数据、做转换、跑小脚本" 的高频工具
  3. 风险：如果选 (a) 但 sandbox 边界不严 → 安全漏洞；如果选 (b) 但 P4 未稳 → 连环阻塞；如果选 (c) → LLM 会遇到 "看起来注册了但不能真跑" 的认知失调
- **Opus的对GPT推荐线路的分析**：GPT 推荐 v1 partial + 远端升级口 **完全正确**。这是我在 action-plan review §C2 标为 CRITICAL 的决策点：
  - (a) 本地 sandbox 前置未知：`quickjs-emscripten` 在 Cloudflare Worker V8 isolate 内的 compat 未验证；memory budget / cancel mechanism / output cap 都需要设计
  - (b) 远程 tool-runner 依赖 P4/P5 成熟：P4 fake provider + service-binding transport 必须先稳定，然后才能接远端 script runtime
  - (c) 诚实 partial 是最保守、最诚实的 v1 选择 —— 但需要确保 capability inventory 准确标注，避免 LLM 误用
- **Opus的最终回答**：`强烈同意`。**v1 采用 (c) 诚实 partial**。**具体执行建议**：
  1. **v1 scope**：`ts-exec <inline code>` 只做 **syntax validation + code length ack**，不执行 code。response 应明确说明 "Execution not yet connected; use workspace API or wait for future remote tool-runner"
  2. **capability inventory**：`ts-exec` = E1 grade, Partial, ask-gated
  3. **prompt 告知**：LLM 明确知道 "ts-exec in v1 is a declaration + syntax check only. For data analysis, use workspace API (`cat`/`rg`) to read files and report back."
  4. **升级 path 保留**：`ServiceBindingTarget` 作为正式 upgrade path，Phase 8+ 接 remote sandbox 时 **不改 `tool.call.*` message family**
  5. **NOT** 选项 (a) 的理由：本地 isolate sandbox 的评估工作量（compat + budget + cancel + output cap + security review）≥ A9 全部 Phase 总和，会把 Phase 7b 拖垮
  6. **NOT** 选项 (b) 的理由：依赖 A5 + A6 + fake provider worker 全部稳定后才能接，链条太长，v1 不适合

- **问题**：`是否确认 ts-exec 在 v1 先保持诚实 partial（并保留 future remote tool-runner 升级口），而不是现在就承诺本地 isolate 沙箱或完整远程执行？`
- **业主回答**：同意 Opus 的判断。

---

## 7. Opus second opinion 汇总速查表

> 供业主快速对照我的立场；CRITICAL 需要先拍板，HIGH 需要在对应 A 启动前解决。

| Q | Opus 回答 | 与 GPT 倾向是否一致 | 关键依赖 / 关联 Q | 严重级别 |
|---|---|---|---|---|
| Q1  | `强烈同意 + 补 stream_seq?` | ✅ 一致（附增强）| Q8 | **CRITICAL** |
| Q2  | `强烈同意` | ✅ 一致 | — | HIGH |
| Q3  | `同意 + 前置 migration estimate` | ✅ 一致（附要求）| — | HIGH |
| Q4  | `同意 + version.ts 加 KIND 常量` | ✅ 一致（附建议）| — | MID |
| Q5  | `conditional yes + 定阈值 p50≤20ms/p99≤100ms` | ✅ 一致（附数字）| Q20 | HIGH |
| Q6  | `同意 + 强调 camelCase traceUuid` | ✅ 一致（附提醒）| Q1 | HIGH |
| Q7  | `同意 + 文档纪律` | ✅ 一致（附建议）| — | MID |
| Q8  | `强烈同意` | ✅ 一致 | Q1 | **CRITICAL** |
| Q9  | `同意 + flag Skill roadmap 缺失` | ✅ 一致（附 follow-up）| — | HIGH |
| Q10 | `强烈同意 + 启动条件写死` | ✅ 一致（附执行细节）| — | MID |
| Q11 | `同意 + secret 注入 policy` | ✅ 一致（附补充）| — | HIGH |
| Q12 | `同意 + deterministic smoke prompt` | ✅ 一致（附建议）| — | MID |
| Q13 | `同意 + 前置升格阈值 N=3/5` | ✅ 一致（附数字）| Q14 | HIGH |
| Q14 | `同意 + 首次出现显式标注` | ✅ 一致（附纪律）| Q13 | MID |
| Q15 | `同意` | ✅ 一致 | Q16 | MID |
| Q16 | `强烈同意 + 具体 flags 范围` | ✅ 一致（附范围）| Q15 | HIGH |
| Q17 | `同意 + bash parser 行为明确` | ✅ 一致（附细节）| — | MID |
| Q18 | `同意 + workspace-snapshot 实现算法` | ✅ 一致（附算法）| — | MID |
| Q19 | `同意 + 3 列独立表格` | ✅ 一致（附表格）| — | MID |
| Q20 | `强烈同意 + memo 模板 5 项` | ✅ 一致（附模板）| Q5 | HIGH |
| **Q21** | `同意 partial + 6 条执行建议` | ✅ 一致（附执行细节）| — | HIGH |
| **Q22** | `强烈同意 partial + 反对 (a)(b)` | ✅ 一致（附明确理由）| — | **CRITICAL** |

### 关键提醒

- **3 条 CRITICAL 建议业主优先拍板**：Q1（follow-up shape）+ Q8（纳入 Phase 0）+ Q22（ts-exec partial）
- **Q1 与 Q8 必须一起拍板**：Q8=yes 但 Q1 留空会让 A1 Phase 3 无依据启动
- **与 GPT 立场完全一致**，但在 **14 个问题上附加了具体执行细节 / 数字 / 模板**，避免执行时再次漂移
- **Q9 附带 Skill roadmap 缺失提醒**：Skill 在全部 15 design + 10 action-plan 里基本缺位，建议业主单独决策 Skill 何时启动
