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
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认在 Phase 0 先冻结一条最小、client-produced 的 follow-up input family？如果确认，canonical message 名称与最小 body shape 应该是什么？`
- **业主回答**：

### Q2 — Freeze Matrix 是否继续采用四档状态语言（来源：A1）

- **影响范围**：`A1 / 后续全部 action-plan / PR review gate / design-review vocabulary`
- **为什么必须确认**：如果没有统一的状态语言，团队会反复争论某项内容到底算“已经冻结”还是“只是方向正确但未落地”。
- **当前建议 / 倾向**：`继续采用 Frozen / Frozen with Rename / Directional Only / Deferred 四档状态`
- **Reasoning**：这个问题不是文案癖好，而是项目治理工具。项目现在不是“全都做完”或“全都没做完”的二元状态，而是存在很多中间状态：语义已经定了、但名字还没改；方向已经确定、但底层实现还没选；明确不做但以后也许再看。四档状态的价值，就是让 review、action-plan、实现、文档都用同一套词说话，减少反复拉扯。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 Freeze Matrix 继续使用 Frozen / Frozen with Rename / Directional Only / Deferred 四档状态，并要求后续 action-plan 与 PR review 统一沿用？`
- **业主回答**：

### Q3 — Identifier migration 是否要一并处理 `stamped_by` 与 `reply_to` 的 rename（来源：A1）

- **影响范围**：`A1 / nacp-core / nacp-session / compat migrations / tests / downstream adapters`
- **为什么必须确认**：如果这两个字段继续留在旧命名里，Phase 0 的 identifier law 会变成“只改一半”，后续系统会长期混用新旧口径。
- **当前建议 / 倾向**：`一并纳入本轮 migration，但在真正开改前先产出 migration estimate`
- **Reasoning**：这类 rename 很容易被误以为只是机械替换，但它会同时打到 schema、compat、测试和文档。对业主来说，关键不是“这两个字段改不改”，而是“我们要不要接受一个半冻结状态继续存在”。如果不一起处理，后面每个 reviewer 都要重新解释哪些命名已经 canon、哪些还是遗留口径，治理成本会持续存在。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认在 Phase 0 的 identifier migration 中，一并执行 stamped_by -> stamped_by_key 与 reply_to -> reply_to_message_uuid？`
- **业主回答**：

### Q4 — Version baseline 是否正式采用“1.0.0 provisional，1.1.0 first frozen baseline”的口径（来源：A1）

- **影响范围**：`A1 / versioning policy / README / compat chain / contract tests`
- **为什么必须确认**：如果当前 `1.0.0` 被讲成已经冻结完成的最终基线，那么后续的 breaking rename 在版本语义上会自相矛盾。
- **当前建议 / 倾向**：`正式采用：1.0.0 = pre-freeze provisional baseline；1.1.0 = first owner-aligned frozen baseline`
- **Reasoning**：版本号不只是展示给外部看的标签，它也是团队内部判断“现在能不能再改 contract”的依据。当前仓库还在做一轮系统性 rename，如果还坚持说 `1.0.0` 已完全冻结，就会制造假稳定感。把 `1.0.0` 明确成 provisional，可以诚实表达项目状态；把 `1.1.0` 作为 first frozen baseline，则能给 tests、README、compat story 一个真正清晰的落点。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认当前 1.0.0 只是 provisional baseline，待 Phase 0 rename / compat 完成后，再把 1.1.0 作为 first frozen baseline？`
- **业主回答**：

---

## 2. Trace / Observability / Session 决策

### Q5 — Trace substrate 是否正式冻结为“DO storage hot anchor + R2 cold archive + D1 deferred query”（来源：A2, A7）

- **影响范围**：`A2 / A3 / A6 / A7 / trace persistence / future query layer / cost model`
- **为什么必须确认**：如果 trace 的物理落点没有先定，后续 benchmark、observability、evidence closure 都会在不同存储路线间来回摇摆。
- **当前建议 / 倾向**：`正式冻结当前方向，但把 benchmark artifact 视为启动条件，而不是可选附录`
- **Reasoning**：这是“地基到底放哪”的问题。对业主来说，可以理解成：trace 先写进哪里，哪里负责高频热写入，哪里负责长期归档，哪里先留作未来查询。现在最合理的工程路线是 DO 扛热写入、R2 扛归档、D1 暂不进热路径；但这个结论必须有最低限度的 benchmark 支撑，否则就是“看起来合理”的直觉决策。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 nano-agent 当前的 trace substrate 采用 DO storage hot anchor + R2 cold archive + D1 deferred query，并要求在 Phase 1 前补 benchmark / investigation artifact？`
- **业主回答**：

### Q6 — TraceEvent base contract 是否必须显式携带 `traceUuid`（来源：A3）

- **影响范围**：`A3 / eval-observability / session-do-runtime / cross-package trace law / recovery`
- **为什么必须确认**：如果 trace 信息不进入基础 event contract，那么“trace-first”只会停留在设计口号层，而不会成为真正可追踪、可恢复的运行事实。
- **当前建议 / 倾向**：`必须显式携带 traceUuid；不要只靠 sessionUuid / turnUuid 等旁证来拼 trace`
- **Reasoning**：对小白业主来说，这相当于“每一条关键运行事件，是否都自带自己的链路编号”。如果没有这个字段，后面看日志、做恢复、做 replay 时，就只能靠时间、session、turn 去猜谁跟谁相关，这在单条链路里可能还能凑合，在多 trace 并存时就会失真。把 traceUuid 放进 base contract，是把“每个事件都知道自己属于哪条链”这件事写死。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 Phase 2 必须升级 TraceEvent base contract，使其显式携带 traceUuid，而不是只依赖 sessionUuid / turnUuid 等旁证？`
- **业主回答**：

### Q7 — Observability 是否正式采用 Anchor / Durable / Diagnostic 三层语言（来源：A3, A4）

- **影响范围**：`A3 / A4 / A7 / event catalog / evidence policy / replay semantics`
- **为什么必须确认**：如果不先说明“哪些事件是锚点、哪些事件必须持久化、哪些只是诊断用”，后续事件分类会继续混用日志、trace、transcript 等模糊词。
- **当前建议 / 倾向**：`正式采用三层 conceptual layering，但明确它不直接替代底层实现 enum`
- **Reasoning**：三层语言的作用，不是替代代码里的类型，而是给团队一个统一的解释框架。对业主来说，这能帮助你区分：哪些事件是“系统不该丢”的锚点，哪些是“为了复盘必须留下”的 durable 证据，哪些只是帮助排查问题的诊断信息。没有这层语言，后面每加一个 event kind 都会重新争“这个到底该不该保存、该保存多久、对谁可见”。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 nano-agent 的 observability 采用 Anchor / Durable / Diagnostic 三层语言，并要求后续 design / action-plan 按此组织？`
- **业主回答**：

### Q8 — Follow-up / multi-round input family 是否必须进入 Phase 0，而不是继续延后（来源：A1, A4）

- **影响范围**：`A1 / A4 / nacp-session / client protocol / future API continuity`
- **为什么必须确认**：这决定项目是先把多轮输入作为正式协议的一部分冻结下来，还是继续只围绕 single-turn ingress 设计后再补第二代接口。
- **当前建议 / 倾向**：`不再延后；应在 Phase 0 先冻结最小 multi-round input family`
- **Reasoning**：这实际上是在决定“多轮对话是不是 v1 的一部分”。如果继续延后，眼前的 runtime 接线会更简单，但代价是后续 API 不得不经历一次明显断层：第一版只会启动会话，第二版再补继续输入。对项目定位来说，你们已经明确希望 contract surface 尽量在可控范围内做宽，这意味着至少要把多轮输入的**最小协议形状**先纳入 Phase 0，而不是让 runtime 用私有消息偷偷兜底。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 follow-up / multi-round input family 应在 Phase 0 进入正式 contract freeze，而不是继续推迟到后续阶段？`
- **业主回答**：

---

## 3. External Seam / Verification 决策

### Q9 — v1 binding catalog 是否只纳入 capability / hook / fake provider，不纳入 skill worker（来源：A5）

- **影响范围**：`A5 / session runtime env / composition profile / future skill roadmap`
- **为什么必须确认**：如果 skill worker 也进入当前 binding catalog，Phase 4 的范围会立刻膨胀成“同时设计 skill runtime + skill discovery + skill contract”。
- **当前建议 / 倾向**：`v1 只闭合 capability / hook / fake provider；skill worker 继续保留为 reserved seam`
- **Reasoning**：这不是否定 skill 的价值，而是在决定当前阶段的边界纪律。对业主来说，可以把它理解为：现在要不要把“未来最重要的扩展方向”也一起做进第一轮远端闭环。答案更适合是“先为 skill 留槽位，但不在这一轮把它拉成真实运行依赖”，否则 P4 会被过早扩成第二个大项目。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 Phase 4 的 v1 binding catalog 只覆盖 capability / hook / fake provider 三条主 seam，而 skill worker 继续作为 reserved seam？`
- **业主回答**：

### Q10 — Phase 5 是否正式定位为 verification gate，而不是独立实现 phase（来源：A5, A6）

- **影响范围**：`A5 / A6 / action-plan sequencing / release gate / deploy verification`
- **为什么必须确认**：如果 P5 被当成独立实现 phase，它会和 P3/P4 争主线；如果它被定位为 gate，就会变成对前序闭环的专门验收阶段。
- **当前建议 / 倾向**：`正式定位为 verification gate`
- **Reasoning**：一个常见误区是把“验证阶段”也当成和实现阶段并列推进的 workstream。结果就是：验证对象本身还在变，smoke 结果每天失效，团队既做实现又追验证噪音。把 Phase 5 定位成 gate，等于明确说：先把 P3/P4 的最小闭环做出来，再拿 P5 去做 deploy-shaped / real-boundary 验收，这样验证结果才有解释力。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 Phase 5 是一个 verification gate，而不是与 P3 / P4 并列推进的独立实现 phase？`
- **业主回答**：

### Q11 — L1 / L2 的默认运行模式是否固定为 hybrid：L1 用 `wrangler dev --remote`，L2 用 `wrangler deploy + workers.dev smoke`（来源：A6）

- **影响范围**：`A6 / wrangler profiles / local loop / real-boundary smoke / team workflow`
- **为什么必须确认**：如果不先冻结默认运行模式，后续验证脚本、profile 命名、成本预期都会分叉。
- **当前建议 / 倾向**：`采用 hybrid：L1 默认 wrangler dev --remote，L2 必须 deploy + workers.dev smoke`
- **Reasoning**：这里本质上是在平衡两种需求：开发反馈要快，验证边界要真。只用 `dev --remote` 很方便，但不等于真正 deploy-shaped；只用 deploy smoke 又会让每次迭代都太重。对业主来说，hybrid 是最稳的折中：把日常快速验证和真正上线形状验证拆成两层，而不是用一种模式假装两种需求都满足。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 Phase 5 的默认运行模式采用 hybrid：L1 走 wrangler dev --remote，L2 走 wrangler deploy + workers.dev smoke？`
- **业主回答**：

### Q12 — L2 real smoke 的唯一最小 golden path 是否采用 OpenAI-compatible + `gpt-4.1-nano`（来源：A5, A6）

- **影响范围**：`A5 / A6 / llm-wrapper / fake provider mirror / secrets / smoke cost`
- **为什么必须确认**：如果不先定真实 provider / model，fake provider 无法稳定 mirror，Phase 5 的 real smoke 也无法形成可重复的最小链路。
- **当前建议 / 倾向**：`采用一条唯一最小 golden path：OpenAI-compatible provider + gpt-4.1-nano`
- **Reasoning**：这里要解决的不是“哪个模型最好”，而是“哪个最适合作为第一条真实验证链”。对小白业主来说，golden path 的目标是稳定、便宜、易复用，而不是代表最终全部商业能力。`gpt-4.1-nano` 的价值在于它能最大化复用当前 OpenAI-compatible adapter，降低额外适配成本，让 fake provider 和 real provider 尽量共用一套 shape。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 Phase 5 的 L2 real smoke 只先走一条唯一最小 golden path：OpenAI-compatible provider + gpt-4.1-nano？`
- **业主回答**：

---

## 4. Storage / Context / Evidence 决策

### Q13 — P6 的 calibration verdict 是否正式采用四档：`provisional / evidence-backed / needs-revisit / contradicted-by-evidence`（来源：A7）

- **影响范围**：`A7 / storage-topology / workspace-context-artifacts / eval-observability / future reports`
- **为什么必须确认**：如果没有一套固定 verdict 语言，Phase 6 会产生很多 evidence，但很难把这些 evidence 转化成可以审阅、可以冻结、可以撤回的结论。
- **当前建议 / 倾向**：`正式采用四档 calibration verdict`
- **Reasoning**：你可以把这套 taxonomy 理解成“项目如何判断一个假设现在处于什么状态”。没有它，团队只能说“好像更有把握了”“看起来不太对”，但没法形成正式结论。四档 verdict 的意义，就是给每个 hypothesis 一个清楚的阶段：还只是猜测、已有证据支撑、需要回头重看、或者已被证据推翻。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 Phase 6 的 calibration verdict 采用 provisional / evidence-backed / needs-revisit / contradicted-by-evidence 四档？`
- **业主回答**：

### Q14 — P6 verdict 与 PX capability maturity grade 是否永久分离（来源：A7）

- **影响范围**：`A7 / PX-capability-inventory / review language / future docs`
- **为什么必须确认**：如果把“假设有没有被证据支持”与“某项能力成熟不成熟”混用成一套词，团队后面会持续误读文档。
- **当前建议 / 倾向**：`永久分离：P6 verdict 只描述 hypothesis status；PX grade 只描述 capability maturity`
- **Reasoning**：这两个东西都和“证据”有关，所以很容易被混在一起，但它们回答的是完全不同的问题。前者是在说“这条判断是否已被证明”；后者是在说“这个能力是否已成熟到可以对外承诺”。如果不分开，reviewer、实现者、业主会在同一张表里看见两个“好像都在说成熟度”的体系，最后谁也说不清到底在判什么。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 P6 verdict 与 PX capability maturity grade 永久分离，前者只描述 hypothesis status，后者只描述 capability maturity？`
- **业主回答**：

### Q20 — 未来任何 D1 角色升格前，是否都必须先提交独立 benchmark / investigation memo（来源：A2, A7）

- **影响范围**：`A2 / A7 / future D1 decision / supporting memos / substrate governance`
- **为什么必须确认**：如果没有这条 gate，团队未来很容易在没有新证据的情况下，把 D1 从 deferred query seam 悄悄拉回热路径讨论。
- **当前建议 / 倾向**：`必须先交独立 memo，再允许改 action-plan`
- **Reasoning**：这道题不是在决定“现在用不用 D1”，而是在决定“以后谁有权改这个决定、靠什么改”。对业主来说，这是一条防止 decision creep 的护栏：避免团队在未来某次实现压力下，凭直觉就把 D1 重新拉进主路径。要求先交独立 memo，等于强制未来任何角色升格都要经过新的 benchmark、成本、职责边界审视。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认：未来若要提升 D1 的角色，必须先提交独立的 trace substrate benchmark / investigation memo，不能直接修改现有 action-plan 结论？`
- **业主回答**：

---

## 5. Minimal Bash / Capability Governance 决策

### Q15 — v1 canonical search command 是否只保留 `rg`（来源：A8）

- **影响范围**：`A8 / fake bash registry / planner / inventory / prompt ergonomics`
- **为什么必须确认**：这决定 v1 的搜索能力面，是坚持一个窄而硬的 canonical command，还是为了兼容习惯而把 grep family 一并纳入正式支持面。
- **当前建议 / 倾向**：`v1 只保留 rg 作为 canonical search command`
- **Reasoning**：对业主来说，这题本质上是在问：“我们是先把一个搜索命令做真，还是先把三个看起来像搜索的命令都挂上去？”在 Worker / fake bash 这个前提下，更稳的路线是先把 `rg` 做成真实 baseline，因为它能减少实现面与文档面的漂移。如果一开始就把 `grep / egrep / fgrep` 都纳入正式支持，团队会很快陷入兼容历史 flag 语法的泥潭。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 v1 canonical search command 只保留 rg，不把 grep / egrep / fgrep 一并纳入正式支持面？`
- **业主回答**：

### Q16 — 在保持 `rg` 为 canonical 的前提下，是否优先补一个窄口的 `grep -> rg` alias（来源：A8）

- **影响范围**：`A8 / LLM compatibility / fake bash ergonomics / inventory`
- **为什么必须确认**：如果这条 alias 不尽早补，LLM 会频繁生成 `grep ...` 后再撞 unsupported；如果补得太宽，又会把系统重新拖回 grep family 兼容泥潭。
- **当前建议 / 倾向**：`尽早补一个最窄 alias，只接住最常见 pattern 与少量兼容 flag`
- **Reasoning**：这题的关键不是“要不要支持 grep”，而是“要不要为 LLM 常见习惯做一个低成本缓冲层”。很多模型天生就会敲 `grep`，如果系统每次都先报不支持，再引导改用 `rg`，会浪费很多 turn 预算。补一个非常窄的 alias，可以减少幻觉成本，同时又不牺牲 `rg` 作为 canonical truth 的治理清晰度。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`在保持 rg 为 canonical command 的前提下，是否希望优先补一个最窄的 grep -> rg compatibility alias？`
- **业主回答**：

### Q17 — `curl` richer method / header / body / timeout 语义是否只允许走 structured path（来源：A9）

- **影响范围**：`A9 / planner / capability-runtime / prompt / future remote fetch worker`
- **为什么必须确认**：如果 richer curl 继续沿 bash argv 扩张，planner 和 fake bash grammar 会迅速变复杂；如果只走 structured path，演进路线会稳定得多。
- **当前建议 / 倾向**：`明确只通过 structured capability path 扩张 richer curl`
- **Reasoning**：这里的本质是“扩展能力到底放在哪一层”。把复杂 curl 语义塞进 bash 字符串，看起来更像 shell，但对 Worker-agent 来说，代价是 parser、quote、flag、escaping 复杂度瞬间膨胀。把复杂输入统一放进 structured path，则能让 bash path 只保留 `curl <url>` 这种最小入口，而把真正会增长的能力收敛到 schema 层。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 curl 的 richer method / header / body / timeout 语义只通过 structured capability path 扩张，而不通过 bash argv grammar 扩张？`
- **业主回答**：

### Q18 — `git` v1 是否严格冻结为 `status / diff / log` 三个只读子命令（来源：A10）

- **影响范围**：`A10 / capability inventory / fake bash governance / future virtual VCS design`
- **为什么必须确认**：这决定 v1 是只做只读 introspection，还是现在就预留 mutating VCS 路线。
- **当前建议 / 倾向**：`严格冻结为 status / diff / log；mutating git 全部 deferred`
- **Reasoning**：对业主来说，这题其实是在问：“v1 要不要承诺一个虚拟 git 仓库模型？”一旦要支持 `add / commit / branch / restore`，就不再只是几个命令的事，而是要设计虚拟 index、ref、history、冲突与回滚。先把 `status / diff / log` 做成只读 baseline，能满足大部分“看状态、看改动、看历史”的理解类需求，同时避免过早承诺完整 VCS 系统。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 git v1 只冻结 status / diff / log 三个只读子命令，不提前承诺 add / commit / restore / branch 等 mutating subset？`
- **业主回答**：

### Q19 — Capability inventory 是否正式采用五级口径，并单列 ask-gated disclosure（来源：A10）

- **影响范围**：`A10 / PX-capability-inventory / prompt / tool disclosure / review gate`
- **为什么必须确认**：如果不把“能力当前是什么状态”与“调用是否需要 ask”分开披露，后续 capability truth 会继续混乱。
- **当前建议 / 倾向**：`正式采用 Supported / Partial / Deferred / Unsupported / Risk-Blocked 五级口径，并把 ask-gated 作为正交维度单列`
- **Reasoning**：这相当于给能力治理建立一个统一标签系统。五级口径解决的是“能力做到了什么程度”；ask-gated 解决的是“即使支持，是否仍需要用户确认”。如果把这两件事混成一句自然语言，README、prompt、registry、review comment 就会开始各说各话，最后没人能快速判断某个命令到底是没做、半做、故意不做，还是做了但需要确认。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 capability inventory 采用 Supported / Partial / Deferred / Unsupported / Risk-Blocked 五级口径，并要求 ask-gated command 单独披露？`
- **业主回答**：

---

## 6. Action-Plan 整编后新增补的问题

### Q21 — `mkdir` 在 v1 / Phase 7a 中应保持“显式 partial + compatibility ack”，还是现在就补最小 directory primitive（来源：A8）

- **影响范围**：`A8 / capability-runtime / workspace backend interface / docs disclosure / tests`
- **为什么必须确认**：`mkdir` 现在既不是完整真实实现，也不能再继续停在“看起来成功但语义不清”的状态；Phase 7a 必须把它的 contract 讲明白。
- **当前建议 / 倾向**：`优先保持显式 partial + compatibility ack，并把真实 directory primitive 留给后续更大范围的 workspace backend 演进`
- **Reasoning**：这题的关键，不是“空目录创建难不难”，而是“为了让一个命令看起来更真，是否要提前改底层 workspace 抽象”。如果现在就补 directory primitive，影响的不只是 `mkdir`，还会波及 backend 接口、path law、测试资产和后续 file/search consistency。对当前阶段来说，更稳的选择通常是：诚实承认 `mkdir` 还是 partial，只要它不会误导 LLM 和 reviewer，就不要为了面子过早扩底座。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 Phase 7a 中的 mkdir 继续维持“显式 partial + compatibility ack”，而不是为了 v1 提前改造 workspace backend 去补最小 directory primitive？`
- **业主回答**：

### Q22 — `ts-exec` 的 v1 substrate 应如何选择：本地 isolate 沙箱、远程 tool-runner，还是诚实 partial（来源：A9）

- **影响范围**：`A9 / capability-runtime / security policy / resource budget / future remote worker design`
- **为什么必须确认**：`ts-exec` 是 LLM 非常高频期待的工具，但在 Worker / V8 isolate 前提下也是风险最高的工具之一；如果不先做架构级决策，Phase 7b 会长期停在“命令已注册，但没人知道它到底算不算真实支持”的状态。
- **当前建议 / 倾向**：`v1 优先采用诚实 partial，并保留 future remote tool-runner 升级口；只有在本地 isolate 沙箱有明确证据且成本可控时，才考虑转正`
- **Reasoning**：这题是在决定“我们是否现在就承诺一条真实脚本执行路线”。本地 isolate 沙箱听起来最完整，但它需要可靠的安全边界、取消机制、输出控制和资源预算；远程 tool-runner 更可扩展，但又依赖 Phase 4/5 的远端闭环先成熟。对当前项目阶段来说，最稳妥的做法通常不是勉强给出一个“看起来能跑”的执行器，而是先诚实地把它标为 partial / ask-gated，再为未来 remote substrate 留正式升级口。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 ts-exec 在 v1 先保持诚实 partial（并保留 future remote tool-runner 升级口），而不是现在就承诺本地 isolate 沙箱或完整远程执行？`
- **业主回答**：

