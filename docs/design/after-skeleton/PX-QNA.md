# Nano-Agent After-Skeleton Owner Q&A

> 范围：`docs/design/after-skeleton/` 全套 design 的跨 Phase 业主决策问题汇总  
> 目的：把会影响后续 action-plan 排序、范围、实现边界、验收标准的 owner decision 收敛到一份单一清单  
> 使用方式：业主逐条补写 `A`，后续 action-plan 直接以本文件答案为准
>
> 📝 **注**：每一条 Q 下方在 GPT 的 `当前建议 / 倾向` 之后、`Q` 本体之前，追加了 **Opus second opinion**（分解 / 影响面 / 最终回答），供业主回答时交叉参考。

---

## 1. Phase 0 / Foundation 决策

### Q1 — 是否正式把 Phase 0 freeze suite 作为 owner-aligned baseline

- **影响范围**：`P0 / 全部后续 action-plan`
- **为什么必须确认**：如果 `P0-contract-and-identifier-freeze.md`、`P0-contract-freeze-matrix.md` 还不算正式 baseline，后续所有 Phase 的 action-plan 都会继续建立在漂移边界上。
- **当前建议 / 倾向**：`请正式确认：P0 设计套件已构成 after-skeleton 的 owner-aligned baseline，且 freeze matrix 是唯一权威状态板`
- **Opus 的分解 / 分析**：这个问题本质上在问 "P0 四份文档是否可以被 baseline 化"。从我的评审（`docs/eval/after-skeleton-design-reviewed-by-opus.md`）看，P0 四份文档的**框架**已准备好、对齐代码事实（18/18 命题核对通过），但存在 **2 条 CRITICAL 级命名/范围冲突**（C1 `trace_uuid` vs `trace_id`、C2 follow-up input family 与 README §6 Todo Note #1 冲突）未解决。
- **Opus 对影响面的深度解读**：如果在这 2 条冲突解决前就 baseline，Phase 0 rename batch 启动时会出现 "按 `trace_uuid` 改 + 按 README 做多轮" 与 "按 `trace_id` 保留 + 按 plan 延后" 两种相互抵触的执行路径。baseline 一旦宣布就是 "freeze"，再回头就是 breaking change，代价成倍增加。
- **Opus 最终回答**：`conditional yes`。P0 设计**作为 structure 已准备好**，但在 **Q6（`traceUuid` 字段命名）与 Q8（follow-up input 归属）得到明确决策之前**不建议宣布为 owner-aligned baseline。建议先回答 Q6 / Q8，再回看 Q1。

- **Q**：`是否正式确认当前 P0 freeze suite 可作为 after-skeleton 阶段的 owner-aligned contract baseline？`
- **A**：确认。保证全局使用 trace_uuid

### Q2 — 是否正式确认 Freeze Matrix 的四种状态划分

- **影响范围**：`P0 / PR review gate / 全部后续 action-plan`
- **为什么必须确认**：`Frozen / Frozen with Rename / Directional Only / Deferred` 直接决定每条后续 action 是"实现既定结论"、还是"等待进一步探索"、还是"不得越界扩张"。
- **当前建议 / 倾向**：`请确认这四档状态继续作为唯一 Phase 状态语言`
- **Opus 的分解 / 分析**：四档状态在治理语言学上是**精细化的一步**——它把 "已冻结" 从二元状态扩展到能表达 "语义冻结但名字未改"（Frozen with Rename）和 "方向确定但物理实现未定"（Directional Only）两种过渡状态。v1 review §3.1 只看到二元 `Frozen / Deferred`，GPT 在设计中把它精细化是设计上的加分项。
- **Opus 对影响面的深度解读**：这四档**会直接被 PR review 用作 gate 语言**。没有四档，"partial" 类项目会在 review 时反复被争论应该算 Frozen 还是 Deferred。有了四档，observability 中 "命名已定 + substrate 未选" 这类项目可以清晰归为 Directional Only，不会被当成 "还没想清楚"。
- **Opus 最终回答**：`yes`。这是此次设计里最高 leverage 的治理决策之一，建议直接确认。**不绑定任何其他 Q**，可以单独拍板。

- **Q**：`是否正式确认 Freeze Matrix 中的四档状态划分，并要求后续 action-plan 与 PR review 全部沿用这四档语义？`
- **A**：确认。

### Q3 — Identifier migration 是否一并包含 `stamped_by_key` 与 `reply_to_message_uuid`

- **影响范围**：`P0 / nacp-core / nacp-session / observability / future adapters`
- **为什么必须确认**：如果这两个字段不在同一轮 rename batch 内处理，Phase 0 的 identifier law 就会留下明显缺口，后续继续传播 legacy naming。
- **当前建议 / 倾向**：`一并纳入本轮 migration；不要把这两个字段留成"以后再说"的例外`
- **Opus 的分解 / 分析**：这两个字段在当前 envelope 里属于 P0 identifier law §F2 明确点名的迁移条目：`stamped_by`（`NacpAuthoritySchema:100-107`，bare field）→ `stamped_by_key`；`reply_to`（`NacpControlSchema:164-178`，optional）→ `reply_to_message_uuid`。如果这一轮 rename batch 不涵盖它们，就会出现 "部分 identifier law 已对齐、部分仍旧" 的半收敛状态。
- **Opus 对影响面的深度解读**：不一起做的代价是**后续 PR review 的判尺会左右摇摆**——有人用 "law 已落地" 的预期 review，有人按 "law 未完全落地" 的现实开发。这种 half-frozen 状态在 MVP 阶段一般要拖两个 minor 版本才能彻底清理。我的评审 §M4 已把这条标为 "未量化" 的 MID 级风险。
- **Opus 最终回答**：`yes`，**但建议先产出一份 migration estimate**（影响多少 file / 多少 test），放在 P0 action-plan 的前置证据位。没有 estimate 之前不要盲目启动 rename batch。

- **Q**：`是否确认在 Phase 0 identifier migration 中，一并执行 \`stamped_by -> stamped_by_key\` 与 \`reply_to -> reply_to_message_uuid\`？`
- **A**：确认。

### Q4 — 版本口径是否正式采用"当前 1.0.0 只是 provisional baseline"

- **影响范围**：`P0 / versioning policy / compat chain / contract tests`
- **为什么必须确认**：如果 `1.0.0` 被当成已经冻结完成的最终基线，那么 `trace_uuid` / `*_uuid` / `*_key` 的 breaking rename 就会在口径上自相矛盾。
- **当前建议 / 倾向**：`正式采用：当前 1.0.0 是 pre-freeze provisional baseline；Phase 0 rename 完成后切入 frozen baseline`
- **Opus 的分解 / 分析**：当前 `packages/nacp-core/src/version.ts:1-10` 已硬编码 `NACP_VERSION = "1.0.0"` 与 `NACP_VERSION_COMPAT = "1.0.0"`，但 P0 rename batch 必然带来 breaking change（至少 `trace_*`、`producer_id`、`stamped_by`、`reply_to` 几组字段改名）。如果把当前 `1.0.0` 视为 "已冻结完成的最终基线"，那么 Phase 0 rename 就自相矛盾——已经 frozen 怎么还能 breaking rename？
- **Opus 对影响面的深度解读**：把 `1.0.0` 定位为 "pre-freeze provisional baseline" 是**诚实且安全的措辞**——它承认当前代码是"阶段性前基线"，rename 完成后切 `1.1.0` 作为真正的 first frozen baseline。这给 compat chain 留出明确的切点，也让后续 contract tests 可以以 `1.1.0` 为基准做版本对拍。
- **Opus 最终回答**：`yes`。这是版本治理上的最清晰选择。**需要同时在 README / CHANGELOG / `version.ts` 注释里写清楚 "1.0.0 为 pre-freeze provisional"**，避免外部读者误读。

- **Q**：`是否确认"当前 \`1.0.0\` 仅是 provisional baseline，Phase 0 rename/compat 落地后再切新的 frozen baseline"这套版本口径？`
- **A**：确认。

---

## 2. Trace / Observability / Session 决策

### Q5 — Trace substrate 是否正式冻结为 `DO storage hot anchor + R2 archive + D1 deferred query`

- **影响范围**：`P1 / P2 / P5 / P6 / future API & DDL`
- **为什么必须确认**：这是 trace foundation、archive seam、evidence closure、以及未来 query layer 的物理基座；若不先定，后续 action-plan 会反复摇摆。
- **当前建议 / 倾向**：`正式采用 DO storage hot anchor + R2 cold archive + D1 deferred query substrate`
- **Opus 的分解 / 分析**：这条 substrate 决策其实由 3 部分组成：
  1. **DO storage 作为 hot anchor 与 durable audit** — 已被 `packages/eval-observability/src/sinks/do-storage.ts` 的 append-only JSONL 实现证实
  2. **R2 作为 cold archive** — `SessionRuntimeEnv.R2_ARTIFACTS` 已预留，archive 角色清晰
  3. **D1 作为 deferred query substrate** — 仓内 0 处 D1 wiring，延后合理
  
  v1 review §3.3 推荐先做 1-week substrate investigation；P1 这份文档本身就扮演 investigation memo 角色，**但缺实机 benchmark 数据**（我的评审 §H4）。
- **Opus 对影响面的深度解读**：这个决策一旦确认，P2 trace foundation、P3 session edge、P5 verification、P6 evidence 的**所有 IO 路径都固定走 DO storage**。如果后续发现 DO storage append 性能不够（例如 50 event/s 以上导致 hibernation 周期冲突），改底座的代价极大。
- **Opus 最终回答**：`conditional yes`。**方向正确，但要求在 Phase 1 启动前补一份 `trace-substrate-benchmark.md`**，用 fake E2E 场景跑一次 DO storage append latency p50/p99，证明 hot anchor 能承受预期负载。benchmark 不通过就回到 Q5 重新评估。

- **Q**：`是否正式确认 nano-agent 的 trace substrate 结论为：DO storage 负责 hot anchor 与 durable audit，R2 负责 cold archive，D1 暂时只保留 future query/index seam？`
- **A**：确认。并同意 Opus 的看法。

### Q6 — TraceEvent base contract 是否必须增补 `traceUuid`

- **影响范围**：`P2 / eval-observability / session-do-runtime / cross-package trace law`
- **为什么必须确认**：如果 `TraceEventBase` 不带 `traceUuid`，那么"trace_uuid 是 runtime 第一事实"就只能停留在 design 口号，无法形成真正的跨包 trace carrier。
- **当前建议 / 倾向**：`必须增补；否则 P2 foundation 不成立`
- **Opus 的分解 / 分析**：`TraceEventBase` 当前字段为 `eventKind / timestamp / sessionUuid / teamUuid / turnUuid? / stepIndex? / durationMs? / audience / layer / error?`（`trace-event.ts:13-27`），**没有 traceUuid**。P2 §F3 要求升级为含 `traceUuid / sourceRole / sourceKey? / messageUuid?`。这是 trace-first law 在 evidence 层的直接外延。
- **Opus 对影响面的深度解读**：如果 `TraceEventBase` 不带 `traceUuid`，"trace-first runtime" 就只能**在 envelope 层成立**，一旦跨到 observability evidence / inspector / timeline / sink，就只能靠 `sessionUuid + timestamp` 旁证。**而 session 内有多 trace 并存的场景**（例如 WS detach/resume 跨 trace）会丢失因果链。Safe 协议的 `SafeTrace` 就是把 `trace_id` 作为独立 first-class 字段，而不是嵌在 session 内。
- **Opus 最终回答**：`yes`，**但本条与隐含命名决策 `trace_uuid` vs `trace_id` 绑定**——我的 v1 review §3.1 推荐保持 `trace_id`（repo truth + OpenTelemetry 标准 + 15 条 contract tests 已锁）。如果业主决定用 `trace_id`，字段名应为 `traceId`（camelCase）；如果用 `trace_uuid`，则 `traceUuid`。**不论命名如何，字段必须存在**。建议业主先在此回答中明确选择名字 (`traceId` / `traceUuid`)，再推进后续 P0 rename batch。

- **Q**：`是否正式确认 Phase 2 必须升级 TraceEvent base contract，使其显式携带 \`traceUuid\`，而不是只依赖 \`sessionUuid/turnUuid\` 等旁证？`
- **A**：确认。

### Q7 — 是否正式采用 Anchor / Durable / Diagnostic 三层 observability 口径

- **影响范围**：`P2 / P6 / event taxonomy / durable promotion rules`
- **为什么必须确认**：如果没有统一的三层语言，后续 event catalog、promotion registry、evidence closure 和 replay 讨论都会继续混用"日志 / durable / transcript / trace"这些模糊词。
- **当前建议 / 倾向**：`正式采用三层模型，并明确它是 conceptual layering，不直接替代实现枚举`
- **Opus 的分解 / 分析**：Anchor / Durable Evidence / Diagnostic 三层是 **conceptual layering**，不是实现枚举。它与 `eval-observability` 当前的 `live / durable-audit / durable-transcript` 三分法不冲突——后者是**实现层分桶**，前者是**认知层分类**。P2-layering.md §7.2 F2 给出的映射：`live ≈ Diagnostic`、`durable-audit 同时覆盖 Anchor + Durable`、`durable-transcript 是 Durable 的用户可见子集`。
- **Opus 对影响面的深度解读**：有了三层语言，后续新增 event kind 就能清楚归类——例如 `llm.delta` 是 Diagnostic（可丢弃）、`turn.begin` 是 Anchor（必须存在）、`tool.call.result` 是 Durable（要持久化）。没有这层语言，后续 event catalog 会持续在 "这个要 durable 吗？" 的问题上反复扯皮。
- **Opus 最终回答**：`yes`。建议在确认时**明确注明**："三层是 conceptual layering，不替代实现枚举；`TraceLayer` enum 继续存在；三层只在 design / review / docs 中作为裁判语言使用。"

- **Q**：`是否正式确认 nano-agent 的 observability 采用 Anchor / Durable / Diagnostic 三层口径，并要求后续 design/action-plan 都按此分层组织？`
- **A**：确认。

### Q8 — Session edge 是否继续明确延后 follow-up input family

- **影响范围**：`P3 / session-do-runtime / nacp-session / frontend adaptation`
- **为什么必须确认**：这直接决定 Phase 3 action-plan 是"先把现有 session edge 真正接成唯一主路径"，还是"同时重开多轮输入协议设计"。
- **当前建议 / 倾向**：`继续延后 follow-up family；P3 只收口当前最小 ingress reality，并对后续输入返回明确 not-yet-supported`
- **Opus 的分解 / 分析**：这条与 **README.md §6 Todo Note Row 1** **直接冲突**：README 说 "Add a formal follow-up input family right after MVP so multi-turn conversations become protocol-native"。P0/P3 设计把它归 Deferred。v1 review §1.2.1 已把这条标为 CRITICAL 冲突，要求业主先做决策。
- **Opus 对影响面的深度解读**：两种选择的后果差异巨大：
  - **继续 Defer**：Phase 3 仅闭合 single-turn ingress；未来 API design / frontend adapter 会被迫围绕 single-turn 协议设计，多轮能力到下一阶段才补，造成 API v1 → v2 的明显断层。
  - **纳入 Phase 0**：多花 1-2 周在 `nacp-session` 加 `session.continue` / `session.followup_input` family（纯协议层扩展，不需要 runtime closure 前置）；换来下一阶段 API 可以一次性设计完整多轮。
- **Opus 最终回答**：`no — 建议纳入 Phase 0，不要 Defer`。理由：(a) README 是已签字承诺，不应单方面推翻；(b) 纯协议层扩展，工程成本低；(c) 延后只是把问题推给下一阶段，总成本更高。**如果业主坚持 defer，需要同步更新 README §6 Todo Note 消除承诺冲突**。

- **Q**：`是否正式确认 Phase 3 不扩展 follow-up / multi-round input family，只收口当前最小 ingress reality？`
- **A**：经过业主的仔细思考。业主还是认可 Opus 的意见。因为这个和我们保持可控范围内最大的 contract surface 原则一致。Opus 对于 API v1 → v2 断层的担忧是真实的。因此业主决定需要在 Phase 0 中对 input family 参考 context/ 内的 agent cli 进行 multi-round 扩展。保证基于事实代码评估下的 v1 接口的 contract surface 足够宽。

---

## 3. External Seam / Verification 决策

### Q9 — External seam 的 v1 binding catalog 是否不纳入 skill worker

- **影响范围**：`P4 / session-do-runtime env / composition factory / future skill design`
- **为什么必须确认**：如果 skill worker 现在就纳入 binding catalog，P4 action-plan 就必须同时补 skill runtime 与 skill contract；如果继续 reserved，则 Phase 4 可以只闭合 capability / hook / fake provider 三条主 seam。
- **当前建议 / 倾向**：`v1 binding catalog 只覆盖 CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER；SKILL_WORKERS 继续保留为 reserved seam`
- **Opus 的分解 / 分析**：当前 `SessionRuntimeEnv` 已有 `SKILL_WORKERS` 预留（`env.ts:14-34`），但无具体实现。P4 §5.3 把 `CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER` 作为 v1 主 seam，skill worker 继续作为 reserved seam。这是范围 discipline 的合理切分。
- **Opus 对影响面的深度解读**：如果 skill worker 现在就纳入 v1 binding catalog，P4 就要同时 (a) 设计 skill runtime、(b) 设计 skill contract、(c) 接 skill discovery。这三条每一条都是独立的大工作量。继续 reserve 的代价是 skill 要等到下一阶段——**但我的评审 §H9 已经指出 README §3/§4.1 把 skill 列为 nano-agent 三大差异化之一，15 份设计里只有 PX §9.3 顺口提一次**，skill composition 在 after-skeleton 整体规划里完全缺位。
- **Opus 最终回答**：`yes` for Q9 本身，**但强烈建议业主同时回答一个 follow-up 问题**："Skill composition 属于 Phase 8+ expansion phase，还是应该在 Phase 4 外延留 design seam？" 不然 skill 会一直被延后到"以后再说"。

- **Q**：`是否正式确认 Phase 4 的 v1 binding catalog 不纳入 skill worker，只先闭合 capability / hook / fake provider 三条主 seam？`
- **A**：确认。

### Q10 — Phase 5 是否正式定位为 verification gate，而不是独立实现 phase

- **影响范围**：`P5 / action-plan 排序 / 验收流程 / release gate`
- **为什么必须确认**：如果 P5 是独立实现 phase，就会和 P3/P4 竞争主线；如果它是 verification gate，就应明确建立在 P3/P4 闭合之后。
- **当前建议 / 倾向**：`正式定位为 verification gate`
- **Opus 的分解 / 分析**：这条实际上在问 Phase 5 的**角色定位**——是 "和 Phase 3/4 并列推进的独立 workstream"，还是 "Phase 3/4 闭合之后才启动的 verification gate"。v1 review §5.1 建议新增 Phase 5 作为 Deployment Dry-Run，定位就是 gate 而非并列。P5 §2.3 自陈 "从 in-process skeleton 走向 Worker-native runtime 的验证阶梯"。
- **Opus 对影响面的深度解读**：作为 gate 的好处是 Phase 3/4 的输出能被 P5 独立验收，发现问题时不影响正在并行的工作流。作为并列 phase 的代价是 P5 的验证对象本身还在变动，smoke 结果会不断失效。
- **Opus 最终回答**：`yes`。建议明确写入 P5 文档：**"Phase 5 只在 Phase 3 与 Phase 4 闭合后启动"**，避免后续出现 "P5 已启动但 P4 仍在改" 的回归场景。

- **Q**：`是否正式确认 Phase 5 的角色是 verification gate，而不是与 P3/P4 并列推进的实现 phase？`
- **A**：确认。

### Q11 — L1/L2 的默认运行模式更倾向哪一条

- **影响范围**：`P5 / wrangler profile / smoke workflow / owner 本地验证方式`
- **为什么必须确认**：`wrangler dev --remote` 与 `wrangler deploy + workers.dev smoke` 会直接影响 action-plan 的本地/远端验证路径与脚本设计。
- **当前建议 / 倾向**：`优先把两条都保留为 profile，但建议先指定一个默认模式，减少执行分叉`
- **Opus 的分解 / 分析**：两条路径各有利弊：
  - **`wrangler dev --remote`**：连接到真实 Cloudflare 边缘，但是**交互式开发服务器**。优点是反馈循环快、trace 在本地 terminal 可见。限制：需要 paid Workers account；DO 在 local 和 remote 模式间语义有细微差异。
  - **`wrangler deploy + workers.dev smoke`**：真正部署到 Cloudflare，然后跑 smoke 脚本。优点是 100% production-shaped。缺点是每次 iteration 需要 deploy（~10s），且 workers.dev subdomain 可能有 rate limit。
- **Opus 对影响面的深度解读**：这影响 action-plan 中 **dev loop 的形态** —— 前者适合日常 Phase 3/4 开发；后者适合 L2 real-boundary smoke。v1 review §M9 已指出 wrangler 的边界限制未充分讨论。
- **Opus 最终回答**：**推荐 hybrid**：
  - **L1 dry-run 默认走 `wrangler dev --remote`**（快速反馈）
  - **L2 real smoke 必须走 `wrangler deploy + workers.dev smoke`**（真 production）
  action-plan 可定义为 "L1 用 dev, L2 用 deploy"，不要二选一。

- **Q**：`对于 Phase 5 的 deploy-shaped / real-boundary 验证，你更倾向默认走哪条路径：\`wrangler dev --remote\`，还是 \`wrangler deploy + workers.dev smoke\`？`
- **A**：确认。

### Q12 — L2 real smoke 的最小真实 provider / model 应选哪条 golden path

- **影响范围**：`P5 / llm-wrapper / fake provider mirror / secret 注入 / 成本与时延预期`
- **为什么必须确认**：没有 provider decision，fake provider worker 无法确定 mirror shape，real smoke 也无法固定成可重复的最小链路。
- **当前建议 / 倾向**：`沿用 llm-wrapper 当前 OpenAI-compatible 方向，先选一条最小、稳定、低成本的 OpenAI-compatible provider/model 作为 golden path`
- **Opus 的分解 / 分析**：当前 llm-wrapper 有 `OpenAIChatAdapter`（已实现），其他 provider adapter 未实现。候选：
  - **`gpt-4.1-nano` (OpenAI)**：极低成本（~$0.10/1M tok）、稳定、streaming 兼容、与现有 adapter 直接对齐
  - **`claude-haiku-4-5-20251001` (Anthropic)**：低成本、稳定，但需要新增 Anthropic adapter
  - **`gpt-4o-mini` (OpenAI)**：成本略高但质量更好
  - **fake only**：完全不跑真实 provider，只靠 fake provider worker
- **Opus 对影响面的深度解读**：选 `gpt-4.1-nano` 的好处是**几乎零额外实现**——现有 OpenAIChatAdapter 直接对接 + fake provider worker 也 mirror 同样的 Chat Completions shape。其他选择都需要新增 adapter 或新增 mirror。
- **Opus 最终回答**：**推荐 `gpt-4.1-nano`** 作为 v1 唯一 golden path。理由：(a) 复用现有 OpenAIChatAdapter；(b) fake provider worker 可 mirror Chat Completions schema 一次完成；(c) 单请求成本 <$0.001，smoke test 成本可忽略；(d) 不引入 Anthropic API 认证的额外 dependency。Claude haiku 可作为 Phase 8+ 扩展项。

- **Q**：`Phase 5 的 L2 real smoke，是否确认采用一条 OpenAI-compatible provider/model 作为唯一最小 golden path？如果确认，优先是哪条 provider/model？`
- **A**：确认。

---

## 4. Storage / Context / Evidence 决策

### Q13 — P6 的 verdict taxonomy 是否正式采用四档 calibration verdict

- **影响范围**：`P6 / storage-topology / workspace-context-artifacts / eval-observability / future DDL`
- **为什么必须确认**：如果没有固定的 calibration verdict，Phase 6 就无法把 provisional hypothesis 收敛成可审阅的结论。
- **当前建议 / 倾向**：`正式采用 provisional / evidence-backed / needs-revisit / contradicted-by-evidence 四档`
- **Opus 的分解 / 分析**：P6 四档覆盖了 hypothesis lifecycle 的 4 个核心状态：
  - `provisional`：设计阶段的假设，未被运行时证据支撑
  - `evidence-backed`：已有 >N 条 evidence 支撑
  - `needs-revisit`：evidence 累积到需要重新判断
  - `contradicted-by-evidence`：evidence 与假设相反，必须撤回
- **Opus 对影响面的深度解读**：这套 verdict 是 P6 evidence closure 的**核心裁判尺**——决定 storage placement hypothesis、context assembly policy、compact threshold 何时可以从 provisional 升格为 frozen。没有这套 taxonomy，Phase 6 的 evidence 就只是一堆 log，无法形成 "某条假设现在算不算成立" 的可审阅结论。
- **Opus 最终回答**：`yes`。四档设计精准且互斥，建议直接确认。**同时请同步回答 Q14**，避免它与 PX Evidence Grade 混淆。

- **Q**：`是否正式确认 P6 的 calibration verdict 采用 \`provisional / evidence-backed / needs-revisit / contradicted-by-evidence\` 四档？`
- **A**：确认。

### Q14 — 是否正式要求 P6 verdict 与 PX capability maturity grade 永久分离

- **影响范围**：`P6 / PX / 全部 capability & evidence 文档`
- **为什么必须确认**：如果 P6 verdict 与 PX E0-E3 混成同一套语言，后续文档和 action-plan 很容易把"能力成熟度"与"假设是否被证据支撑"混为一谈。
- **当前建议 / 倾向**：`正式分离：P6 用 calibration verdict；PX 用 capability maturity grade`
- **Opus 的分解 / 分析**：这条直接回应我评审 §H3 "evidence vocabulary 冲突" 的担忧。两套术语语义不同：
  - **P6 verdict**：描述 **hypothesis status**（设计假设是否被证据支撑）
  - **PX grade**：描述 **capability maturity**（能力实现是否成熟到可对外声明）
  
  两者都叫 "evidence" 相关术语，但**解决的问题完全不同**。例如 "storage hypothesis 某 placement 是 evidence-backed" 与 "`curl` capability 处于 E1 grade"，两者放在同一套 enum 会混为一谈。
- **Opus 对影响面的深度解读**：如果不明确分离，后续会出现：(a) 评审讨论时反复解释哪套 evidence；(b) 文档中交叉引用时术语重合；(c) 新开发者难以快速理解哪套该用。
- **Opus 最终回答**：`yes`。建议进一步**要求文档中每次首次出现任一术语时都加注明**："P6 verdict（hypothesis status）" / "PX grade（capability maturity）"，避免混淆传播。

- **Q**：`是否正式确认 P6 与 PX 使用两套不同术语：P6 只描述 hypothesis status，PX 只描述 capability maturity？`
- **A**：确认。

---

## 5. Minimal Bash / Capability Governance 决策

### Q15 — v1 canonical search command 是否只保留 `rg`

- **影响范围**：`P7a / fake bash prompt / capability inventory / search action-plan`
- **为什么必须确认**：这决定 v1 search surface 是坚持一个窄而硬的 canonical command，还是为了 LLM 习惯提早扩 grep family。
- **当前建议 / 倾向**：`v1 仍只保留 rg 作为 canonical search command`
- **Opus 的分解 / 分析**：当前 `fake-bash/commands.ts:16-143` 注册 `rg` 为唯一搜索命令，`grep/egrep/fgrep` 未注册。P7a §5.2 O2 明确 Out-of-Scope "grep/egrep/fgrep 全量兼容"。这条在保持 v1 能力面**窄而硬**的方向上是对的。
- **Opus 对影响面的深度解读**：选择 `rg` 作为 canonical 的优点：(a) 语法现代（default smart case + ignore `.gitignore`）、(b) 对 LLM 训练期待已足（多数 2024+ 模型都会用 `rg`）、(c) 实现一次只维护一个搜索 backend。保留 `grep` family 的代价是额外维护三个 alias + 解析 legacy flags（如 `-l / -L / -A / -B / -C`）。
- **Opus 最终回答**：`yes`。但请同时回答 Q16（alias 是否做早）——如果 Q16 回答是 "尽早补 alias"，那 "只保留 rg 作为 canonical" 和 "接受 grep 作为 alias 转发" 就不冲突。

- **Q**：`是否正式确认 v1 canonical search command 只保留 \`rg\`，不把 \`grep/egrep/fgrep\` 一并纳入正式支持面？`
- **A**：确认。

### Q16 — `grep -> rg` compatibility alias 是否应作为优先回补项

- **影响范围**：`P7a / prompt ergonomics / fake bash compatibility / inventory`
- **为什么必须确认**：如果 owner 希望尽早降低 LLM 的 grep 幻觉成本，就应把 alias 提前到 action-plan；否则继续保持 deferred。
- **当前建议 / 倾向**：`建议作为最小兼容回补项保留优先级，但不并入 v1 canonical support`
- **Opus 的分解 / 分析**：我评审 §H10 已指出：
  - README.md §1 明确说 "grep / rg / cat / curl" 是 LLM 训练期待
  - P7a §6.1 §取舍 2 承认 "LLM 某些习惯性 `grep` 用法需要 prompt 引导或 alias 未来再补"
  - PX §7.4 把 grep family 列 Deferred
  
  三者组合起来意味着 **LLM 会频繁生成 `grep ...` 命中 "unsupported"**，造成 token / 行动预算浪费。
- **Opus 对影响面的深度解读**：如果早补 `grep -> rg` minimal alias（只翻译 pattern + 一两个最常见 flag 如 `-i / -n`），实施成本极低（预计 < 50 LOC），**显著降低 LLM 幻觉成本**。延后做的代价是每个 turn 浪费 ~100-300 tokens 处理 unsupported fallback。
- **Opus 最终回答**：`yes — 强烈推荐作为 Phase 7a 早期优先项`。建议 scope："接受 `grep` 命令名，只翻译 pattern 与少数 compatible flags（`-i case-insensitive, -n line-numbers`），其他 flag 直接 reject 并提示改用 `rg`"。

- **Q**：`在保持 \`rg\` 为 canonical command 的前提下，你是否希望后续优先补一个窄口的 \`grep -> rg\` compatibility alias？`
- **A**：确认。

### Q17 — `curl` richer options 是否只允许走 structured path

- **影响范围**：`P7b / planner / prompt / capability runtime / future remote fetch worker`
- **为什么必须确认**：如果 richer curl 允许继续沿 bash argv 扩张，planner 与 fake bash grammar 会迅速复杂化；如果只走 structured path，演进路线会更稳定。
- **当前建议 / 倾向**：`明确只走 structured path，不通过 bash argv 扩张`
- **Opus 的分解 / 分析**：当前 `parseSimpleCommand()`（`planner.ts:12-59`）只支持非常简单的 argv 分词，**不支持 pipes / redirects / subshells / escapes**。`curl` handler 只取第一个参数当 URL（`planner.ts:139-146`）。如果允许 richer curl options 沿 bash argv 扩张，需要大改 parser（加 flag grammar、quote escaping、header separator 等）。如果只走 structured path（capability input object），capability-runtime 只需定义 `{ url, method, headers?, body?, timeout? }` schema。
- **Opus 对影响面的深度解读**：bash argv grammar 一旦放开，演进极不稳定——每增加一个 flag 就可能破坏前一个 flag 的解析。structured path 的好处是**不关心如何被调用**（bash string OR structured）都 map 到同一个 schema。Codex 参考正是这种 registry-first 做法。
- **Opus 最终回答**：`yes`。structured path 优先是架构级正确决策。同时建议 P7b 补一句 **"bash argv 只承诺 `curl <url>` 最小形态；richer options (POST / headers / body) 只通过 structured tool call input"**，并在 prompt 中明确告知 LLM。

- **Q**：`是否正式确认 \`curl\` 的 richer method/header/body/timeout 语义只通过 structured capability path 扩张，而不通过 bash argv grammar 扩张？`
- **A**：确认。

### Q18 — `git` v1 是否严格冻结为 `status / diff / log`

- **影响范围**：`P7c / capability inventory / fake bash governance / future virtual VCS design`
- **为什么必须确认**：这决定 action-plan 是继续保持 read-mostly subset，还是需要现在就预留 mutating VCS path。
- **当前建议 / 倾向**：`严格冻结为 status / diff / log；所有 mutating git 继续 deferred`
- **Opus 的分解 / 分析**：当前 `vcs.ts:16-48` 只实现 `status/diff/log` stubs。P7c §5.1 S1 明确冻结 v1 git subset 为这三个只读命令。mutating git（`add/commit/restore/branch`）需要虚拟 index/ref/object model，这是 Phase 8+ 的工作量。
- **Opus 对影响面的深度解读**：冻结为 read-only subset 的好处：(a) 避免承诺 virtual commit model（需要设计 virtual SHA / ref resolution）；(b) `status/diff/log` 三个命令在 workspace namespace 内就能实现（对比 HEAD vs 当前 file state）；(c) 符合 LLM 最常用模式（check state → diff to understand → log to trace history）。mutating 的缺失会让某些 workflow 不可行（如 "`git commit` 暂存当前变更后继续"），但这些 workflow 本质上需要 workspace snapshot + revision control 系统，超出 v1 scope。
- **Opus 最终回答**：`yes`。建议同时在 capability inventory / prompt 中**明确告知 LLM**："git 只支持 read-only introspection（status/diff/log），任何 mutating 操作请用 workspace API 代替（例如 `write` 保存当前变更）"。

- **Q**：`是否正式确认 \`git\` v1 只冻结 \`status / diff / log\` 三个只读子命令，不提前承诺 \`add / commit / restore / branch\` 等 mutating subset？`
- **A**：确认。

### Q19 — Capability inventory 是否正式采用五级口径，并单列 ask-gated disclosure

- **影响范围**：`PX / prompt / tool disclosure / review gate / fake bash docs`
- **为什么必须确认**：如果不把 `Supported / Partial / Deferred / Unsupported / Risk-Blocked` 以及 ask-gated 语境明确下来，后续 capability 对外披露仍会混乱。
- **当前建议 / 倾向**：`正式采用五级口径，并在 inventory / prompt 中显式标注 ask-gated command`
- **Opus 的分解 / 分析**：五级口径各有明确语义：
  - **Supported**：declaration + implementation + evidence 三者都成立
  - **Partial**：declaration 有，但实现为 stub/degraded
  - **Deferred**：明确不做，但未来可回到议程
  - **Unsupported**：主动拒绝（如 `sudo / ssh`）
  - **Risk-Blocked**：因 V8 isolate budget 主动阻断（如 `tar / gzip`）
  
  **ask-gated 是正交维度**——描述 policy layer，独立于能力成熟度。例如 `curl` 当前是 Partial + ask-gated；`ls` 当前是 Supported + allow-gated。
- **Opus 对影响面的深度解读**：五级明确区分 "我们故意不做"（Deferred / Unsupported / Risk-Blocked）与 "我们在做但还没做完"（Partial）。prompt / client disclosure 必须能传达这两类的区别——deferred 是"将来会有"，unsupported 是"永远不会有"，risk-blocked 是"因资源风险而不可得"。ask-gated 单列则让客户端知道哪些命令需要用户确认。
- **Opus 最终回答**：`yes`。五级 + ask-gated 正交分类是正确的 taxonomy。建议 inventory 表格中**每行都有 "maturity grade (E0-E3) + status (5 级) + policy gate (allow/ask/deny)" 三列独立展示**。

- **Q**：`是否正式确认 capability inventory 采用 \`Supported / Partial / Deferred / Unsupported / Risk-Blocked\` 五级口径，并要求 ask-gated command 单独披露？`
- **A**：确认。

---

## 6. Supporting Memo / Gate 决策

### Q20 — 是否要求在未来任何 D1 升格前先产出独立 benchmark memo

- **影响范围**：`P1 / future D1 decision / supporting memos / action-plan gate`
- **为什么必须确认**：如果没有这条 gate，后续团队可能会再次在没有证据的情况下把 D1 拉回热路径讨论。
- **当前建议 / 倾向**：`要求：任何 D1 地位提升前，都必须先提交独立 benchmark / investigation memo`
- **Opus 的分解 / 分析**：D1 当前作为 deferred query substrate（Q5）。如果没有这条 gate，后续很容易在某次讨论中 "我们好像需要 D1 做查询" → 直接改 action-plan → D1 进入热路径而无基准证据。这是典型的 "decision creep"。
- **Opus 对影响面的深度解读**：gate 的价值：(a) 强制未来任何 D1 升格决策都经过 **independent memo** 审视；(b) memo 必须包含 benchmark（write amp, query latency, cost model）；(c) 让 "D1 vs 其他方案" 的讨论不再依赖直觉。这与 Q5 配套——Q5 冻结当前 substrate，Q20 冻结未来 substrate change 的 decision process。
- **Opus 最终回答**：`yes`。建议 gate 表述进一步精确化：**"任何使 D1 进入热路径 / 成为 query substrate 之外角色的决策，必须先提交 `trace-substrate-benchmark-v{N}.md`，通过 owner review 后才能更新 action-plan"**。

- **Q**：`是否正式确认：未来若要提升 D1 的角色，必须先产出独立的 trace substrate benchmark / investigation memo，不能直接改 action-plan 结论？`
- **A**：确认。

---

## 7. 使用建议

- 建议业主优先回答：`Q5 / Q6 / Q8 / Q9 / Q10 / Q12 / Q15 / Q17 / Q18 / Q19`
- 这些问题会直接改变：
  1. action-plan 的实现顺序
  2. 哪些 supporting memo 需要先写
  3. 哪些 Phase 现在可以进入执行，哪些仍应停留在 gate / reserved / deferred 状态

---

## 8. Opus second opinion 汇总速查表

> 供业主快速对照我的立场，并对最具争议的问题做标记。

| Q | Opus 回答 | 与 GPT 倾向是否一致 | 关键依赖 / 关联 Q |
|---|---|---|---|
| Q1  | `conditional yes`（先答 Q6 + Q8）| ⚠️ 有条件 | Q6, Q8 |
| Q2  | `yes` | ✅ 一致 | 独立 |
| Q3  | `yes + 先出 migration estimate` | ✅ 一致（附要求）| — |
| Q4  | `yes` | ✅ 一致 | — |
| Q5  | `conditional yes`（先出 benchmark memo）| ⚠️ 有条件 | Q20 |
| Q6  | `yes`（+ 先敲定 `trace_id` vs `trace_uuid` 命名）| ⚠️ 有隐含决策 | Q1 |
| Q7  | `yes`（注明 conceptual only）| ✅ 一致 | — |
| **Q8** | **`no — 建议纳入 Phase 0`** | ❌ **与 GPT 不一致** | Q1；与 README §6 冲突 |
| Q9  | `yes`（+ 要求答 Skill 路线图）| ✅ 一致（附要求）| — |
| Q10 | `yes` | ✅ 一致 | — |
| Q11 | **hybrid（L1 `dev --remote`, L2 `deploy + smoke`）** | ⚠️ 推荐 hybrid | — |
| Q12 | **`gpt-4.1-nano` 作为 v1 唯一 golden path** | ✅ OpenAI-compatible 方向一致 | — |
| Q13 | `yes` | ✅ 一致 | Q14 |
| Q14 | `yes` | ✅ 一致 | Q13 |
| Q15 | `yes`（与 Q16 配套）| ✅ 一致 | Q16 |
| Q16 | **`yes — 强烈推荐 Phase 7a 早期优先`** | ⚠️ 推推一步 | Q15 |
| Q17 | `yes` | ✅ 一致 | — |
| Q18 | `yes` | ✅ 一致 | — |
| Q19 | `yes`（+ 建议表格三列展示）| ✅ 一致（附建议）| — |
| Q20 | `yes`（+ 命名规范）| ✅ 一致 | Q5 |

> **关键分歧**：**Q8（follow-up input family 归属）** — 我与 GPT 不一致，建议业主重点决策。
> **关键条件**：**Q1 / Q5 / Q6** — 我给了有条件的 yes，业主需要先解决前置决策或先补 memo。
