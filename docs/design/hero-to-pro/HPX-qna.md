# Hero-to-Pro — HPX QNA

> 范围：`hero-to-pro / HP0-HP10`
> 目的：把会影响后续 `docs/design/hero-to-pro/*.md`、`docs/action-plan/hero-to-pro/*.md`、各 HP phase implementation gate 与 final closure 的业主 / ops 决策收敛到一份单一清单，避免在多个 design 文档中重复回答、重复漂移、重复改口。
> 状态：`draft question register (Q1-Q39 pending owner / ops answers)`
> 使用方式：
> 1. **业主只在本文件填写回答。**
> 2. 其他 design / action-plan / memo 若引用某个 `Q` 编号，默认都以本文件为唯一答复来源。
> 3. 各具体文档不再逐条填写 QNA；如仍保留“已确认 / 已冻结”的历史表述，应理解为上下文说明，后续统一以本文件回填结果为准。
> 4. `Q` 编号应保持稳定；后续若补题，从最后一个编号继续追加。
>
> 📝 **注**：
> - 本文件使用 `docs/templates/qna.md` 的完整版格式。
> - 对于偏运行维护的问题，`业主回答` 一栏默认可由 **业主与 ops 联合回填**；一旦填写，仍视为唯一有效口径。
> - 本文件中的“当前建议 / 倾向”来自 HP0-HP10 设计稿当前冻结结论，目的是帮助业主 / ops 做最终拍板，不等于已经拥有正式 owner answer。

---

## 1. 基础边界 / DDL Freeze

### Q1 — `system prompt model-aware seam` 是否允许先开签名、后补真值？（来源：`docs/design/hero-to-pro/HP0-pre-defer-fixes.md` `HP0-D1`）

- **影响范围**：`workers/agent-core/**`、HP0 closure、HP1 schema extension
- **为什么必须确认**：如果这题不拍板，HP0 会在“能不能先接 seam”与“必须等字段落表”之间反复摇摆，直接拖慢 HP0 与 HP1 的衔接。
- **当前建议 / 倾向**：**允许**在 HP0 先落 `withNanoAgentSystemPrompt(modelId?)` 签名与调用位点，但如果 HP1 之前还没有 `base_instructions_suffix` 真字段，HP0 只能标 `partial`。
- **Reasoning**：这题的核心不是“功能先做多少”，而是要不要先把边界接缝开出来。推荐路线更稳，因为它允许 HP0 先把 public ingress 与 runtime mainline 的结构整理好，同时又不伪装成“model suffix 已经 fully live”。如果不拍板，执行时很容易出现两种坏结果：要么 HP0 什么都不做，后续还得返工函数边界；要么 HP0 偷偷用空字符串冒充真功能，closure 口径失真。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP0 允许先落 withNanoAgentSystemPrompt(modelId?) 的签名和调用 seam，但在 HP1 字段未落表前只能按 partial closure 处理？`
- **业主回答**：

### Q2 — R29 相关 residue 是否禁止在 HP0 提前物理删除？（来源：`docs/design/hero-to-pro/HP0-pre-defer-fixes.md` `HP0-D2`）

- **影响范围**：`workers/orchestrator-core/**`、HP8 R29 postmortem、HP10 cleanup
- **为什么必须确认**：如果不拍板，执行者可能把 `forwardInternalJsonShadow` / `parity-bridge` 当“顺手清理”直接删掉，后面就失去 R29 对照材料。
- **当前建议 / 倾向**：**禁止**在 HP0 提前删；必须等 HP8 的 R29 postmortem 完成后，在 HP10 按显式 cleanup 决议处理。
- **Reasoning**：这类残留的价值不在日常运行，而在于它们还承载“为什么历史上出现 divergence”的证据。推荐路线更稳，因为它把“先整理施工面”和“做最终历史清债”分离开，避免 HP0 越界成大扫除。如果不拍板，后面即使想写清 R29，也会发现最关键的比对点已经被提前抹掉。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 R29 相关 residue 在 HP0 阶段不得物理删除，只允许在 HP8 postmortem 完成后再由 HP10 决议？`
- **业主回答**：

### Q3 — `CONTEXT_CORE` / `LANE_E_RPC_FIRST` 在 HP0 是否只做 verify，不改 wrangler？（来源：`docs/design/hero-to-pro/HP0-pre-defer-fixes.md` `HP0-D3`）

- **影响范围**：`workers/agent-core/wrangler.jsonc`、HP0 tests、后续 Lane E 迁移路径
- **为什么必须确认**：如果这题不拍板，HP0 会重新去碰 wrangler 配置，打乱“verify-only”边界，甚至把后续真正的 Lane E 演进和 HP0 混在一起。
- **当前建议 / 倾向**：**只做 verify + test**，不再修改 wrangler 配置。
- **Reasoning**：当前代码里 binding 和 env flag 已经真实存在，HP0 再改配置的收益很低，风险却很高。推荐路线更稳，因为它把 HP0 定义成“证明当前事实存在”而不是“重写部署面”，这样 action-plan 不会把精力浪费在重复接线上。如果不拍板，HP0 很容易变成配置层返工，而不是设计层清障。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP0 对 CONTEXT_CORE / LANE_E_RPC_FIRST 只做 verify 与测试加固，不再改 wrangler 配置？`
- **业主回答**：

### Q4 — hero-to-pro migration 是否正式冻结为 `007-013` 七个文件？（来源：`docs/design/hero-to-pro/HP1-schema-extension.md` `HP1-D1`）

- **影响范围**：HP1 design freeze、全部后续 HP phase、HP9 prod baseline
- **为什么必须确认**：如果 migration 编号和职责边界不拍板，HP2-HP10 会在实现时不断“顺手补 migration”，DDL Freeze Gate 会直接失效。
- **当前建议 / 倾向**：**冻结为 `007-013` 七个文件**，不再保留旧 `008/009-016` 口径。
- **Reasoning**：HP1 的价值就在于一次性把全阶段 durable truth 布好。如果不拍板，后续每个 phase 都会把“我这里再补一张表/一列”合理化，最后 schema 边界重新碎掉。推荐路线更稳，因为它让 reviewer、owner、ops 都能以同一份 ledger 来判断“某个 truth 到底是不是已经属于 HP1 冻结范围”。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 hero-to-pro 的 D1 migration baseline 固定为 007-013 七个文件，不再允许使用其它并行编号口径？`
- **业主回答**：

### Q5 — checkpoint / file snapshot / restore job 是否必须在 HP1 一次性落表？（来源：`docs/design/hero-to-pro/HP1-schema-extension.md` `HP1-D2`）

- **影响范围**：HP1、HP4、HP7、checkpoint/revert 全链路
- **为什么必须确认**：如果这题不拍板，HP4/HP7 很容易在实现时发现 durable truth 不够，再把补 migration 合理化，破坏执行顺序。
- **当前建议 / 倾向**：**必须**在 HP1 一次性落表。
- **Reasoning**：checkpoint/restore 不是小补丁，它决定后续 chat lifecycle、files restore、fork、cleanup 这整条链怎么成立。推荐路线更稳，因为它把最贵的 schema 决策提前冻结，后面每个 phase 只消费已有真相，而不是边做边发明。如果不拍板，HP4 与 HP7 的设计再完整也会在实施时被迫返工 DDL。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 checkpoint / file snapshot / restore job / cleanup lineage 这组 durable truth 必须在 HP1 一次性落表，而不是分散到 HP4 / HP7 再补？`
- **业主回答**：

### Q6 — 后续 phase 若发现 schema blocker，是否禁止直接新增 migration？（来源：`docs/design/hero-to-pro/HP1-schema-extension.md` `HP1-D3`）

- **影响范围**：HP2-HP10 implementation discipline、charter 修订流程
- **为什么必须确认**：如果不拍板，执行阶段一旦遇到困难，就会很自然地选择“再补个 migration”，DDL Freeze Gate 失去约束力。
- **当前建议 / 倾向**：**禁止**直接新增 migration；只能走 `HP1 schema correction` 路径。
- **Reasoning**：这题本质上是在问：hero-to-pro 后半段是否还承认“边做边长 schema”是正常行为。推荐路线更稳，因为它迫使团队先用现有设计解释问题，再决定是否真的需要修 charter，而不是把 schema correction 正常化。如果不拍板，HP1 的 freeze 就会名存实亡。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP2-HP10 若发现 schema blocker，不得直接新增 migration，而必须走 HP1 schema correction + charter 修订流程？`
- **业主回答**：

---

## 2. 模型 / 上下文状态机

### Q7 — 模型控制面是否必须引入 session default，而不能只靠 turn payload？（来源：`docs/design/hero-to-pro/HP2-model-state-machine.md` `HP2-D1`）

- **影响范围**：HP2 model API、clients、HP3 compact policy
- **为什么必须确认**：如果不拍板，模型选择会继续停留在“每次发消息时顺手带一下参数”的临时状态，无法形成产品级 model state machine。
- **当前建议 / 倾向**：**必须引入 session default**。
- **Reasoning**：只靠 turn payload 意味着客户端和用户永远要自己猜“当前模型到底是谁”，这不利于后续 fallback、checkpoint、context budget 全链路。推荐路线更稳，因为它把 session 当前模型提升成单独可读写的产品面，同时仍允许 turn override。若不拍板，HP2 很容易退化成“多加几个字段”的轻量修补，而不是完整状态机。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 hero-to-pro 的模型控制面必须包含 session default，而不是只依赖每个 turn 自带 model_id / reasoning？`
- **业主回答**：

### Q8 — fallback 是否先冻结为单层，而不是链式路由？（来源：`docs/design/hero-to-pro/HP2-model-state-machine.md` `HP2-D2`）

- **影响范围**：HP2 fallback、HP3 future routing、error/stream semantics
- **为什么必须确认**：如果不拍板，执行时很容易从“给一个 fallback_model_id”膨胀成链式 provider routing，范围立刻越界。
- **当前建议 / 倾向**：**先冻结为单层 fallback**，并要求 audit + stream event。
- **Reasoning**：当前仓库没有多 provider chain policy 的 durable truth，也没有足够 metadata 支撑复杂路由。推荐路线更稳，因为它先把“requested/effective 不同”这件事做成可见事实，而不是急着做策略引擎。如果不拍板，HP2 很可能演变成 hero-to-platform 级别的 routing 设计。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP2 的 fallback 先采用单层模式，而不引入链式 fallback / 多 provider routing？`
- **业主回答**：

### Q9 — `<model_switch>` developer message 是否在 HP2 就冻结语义？（来源：`docs/design/hero-to-pro/HP2-model-state-machine.md` `HP2-D3`）

- **影响范围**：HP2 model state、HP3 compact、LLM request assembly
- **为什么必须确认**：如果不拍板，HP3 的 compact/strip/recover 没有稳定控制片段可对接，两个 phase 会互相等待。
- **当前建议 / 倾向**：**在 HP2 就冻结**，HP3 只消费这份语义。
- **Reasoning**：模型切换语义一旦拖到 HP3 再讨论，会让 compact 和 model control 互相绑死。推荐路线更稳，因为它先把“切模型时给 LLM 什么信号”固定下来，HP3 只负责保存和恢复，不再重新定义协议。如果不拍板，后续 prompt 组装会再次漂移。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 <model_switch> 的 developer message contract 在 HP2 就冻结，HP3 只负责 strip / recover，不再重定义？`
- **业主回答**：

### Q10 — context prompt owner 是否放在 agent-core runtime，而不是 context-core？（来源：`docs/design/hero-to-pro/HP3-context-state-machine.md` `HP3-D1`）

- **影响范围**：HP3 runtime latency、context-core 职责、future prompt assembly
- **为什么必须确认**：如果不拍板，context-core 与 agent-core 都可能各自长出一份 prompt owner，最终出现两套 context truth。
- **当前建议 / 倾向**：**放在 agent-core runtime**；context-core 负责 inspection / control plane。
- **Reasoning**：prompt 组装是 LLM call 主线的一部分，离 runtime 越近越能保证一致性和性能。推荐路线更稳，因为它把 context-core 限定在 probe/preview/job 这类 inspection 面，而不是每次远程参与 prompt 构造。如果不拍板，后续很容易出现 probe 看见一套 truth、真实 prompt 又是另一套 truth。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP3 的 context prompt owner 放在 agent-core runtime，context-core 只承担 inspection / control plane？`
- **业主回答**：

### Q11 — compact 是否必须保护 `<model_switch>` / `<state_snapshot>`，而不是直接摘要所有内容？（来源：`docs/design/hero-to-pro/HP3-context-state-machine.md` `HP3-D2`）

- **影响范围**：HP3 compact correctness、HP2 model switch、future restore
- **为什么必须确认**：如果不拍板，compact 很容易把控制片段和普通对话混在一起压缩，后续语义丢失且难以调试。
- **当前建议 / 倾向**：**必须保护**，采用 strip-then-recover。
- **Reasoning**：控制片段不是给摘要模型读完就算，而是后续 prompt 仍要依赖它们维持状态机语义。推荐路线更稳，因为它把“可摘要正文”和“不可丢控制语义”明确分层。如果不拍板，compact 虽然看起来节省 tokens，但会让模型切换、state snapshot、恢复逻辑一起失真。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP3 的 compact 必须对 <model_switch> / <state_snapshot> 执行 strip-then-recover，而不能直接把它们并入摘要正文？`
- **业主回答**：

### Q12 — manual compact 是否需要 preview 与 durable job 分离？（来源：`docs/design/hero-to-pro/HP3-context-state-machine.md` `HP3-D3`）

- **影响范围**：HP3 context APIs、clients、ops/debug
- **为什么必须确认**：如果不拍板，manual compact 可能变成一次看不见的后台动作，客户端既无法预演，也没有 durable 记录可追。
- **当前建议 / 倾向**：**需要分离**；preview 只读，compact 才创建 job。
- **Reasoning**：preview 和真正执行不是一个抽象层次：前者是解释，后者是状态变更。推荐路线更稳，因为它让用户和运维都能先知道“会发生什么”，同时保留一次真实 compact 的 durable 审计。如果不拍板，HP3 很容易把 manual compact 设计成黑盒 endpoint。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP3 的 manual compact 必须区分 preview 与 durable job，两者不能合并成单一步骤？`
- **业主回答**：

---

## 3. Chat 生命周期 / Confirmation Control Plane

### Q13 — close 是否引入新 session 状态？（来源：`docs/design/hero-to-pro/HP4-chat-lifecycle.md` `HP4-D1`）

- **影响范围**：HP4 read models、clients、lifecycle semantics
- **为什么必须确认**：如果不拍板，close 很可能被实现成又一个新状态，进一步拉宽 lifecycle 词汇表，增加客户端判断负担。
- **当前建议 / 倾向**：**不引入新状态**；继续用 `ended + completed`。
- **Reasoning**：close 的本质是一个动作，不一定需要新的生命周期枚举。推荐路线更稳，因为它保留现有状态集，把“如何结束”表达成 action/result，而不是再发明一个新状态。若不拍板，后面 delete、retry、restore 也会开始各自长状态词。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 session close 不新增 lifecycle state，而继续沿用 ended + completed 语义？`
- **业主回答**：

### Q14 — delete 应落在 session 还是 conversation 维度？（来源：`docs/design/hero-to-pro/HP4-chat-lifecycle.md` `HP4-D2`）

- **影响范围**：HP4 clients、D1 tombstone、conversation view
- **为什么必须确认**：如果不拍板，delete 的 durable owner 不清楚，后面 title、conversation detail、checkpoint registry 都会受影响。
- **当前建议 / 倾向**：**落在 conversation 维度**，采用 soft tombstone。
- **Reasoning**：当前 D1 真相里 `nano_conversations` 已经是 title 与会话聚合 owner，把 delete 放在 conversation 更符合数据模型。推荐路线更稳，因为它避免 session 与 conversation 两层都各自定义 delete 语义。若不拍板，客户端很难知道“删掉的是单个执行会话，还是整段对话”。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP4 的 delete 语义落在 conversation 维度，采用 conversation soft tombstone，而不是 session 级 delete？`
- **业主回答**：

### Q15 — checkpoint/restore 是否继续复用 DO latest checkpoint？（来源：`docs/design/hero-to-pro/HP4-chat-lifecycle.md` `HP4-D3`）

- **影响范围**：HP4 checkpoint registry、restore API、clients、support/debug
- **为什么必须确认**：如果不拍板，执行者可能偷用现有 DO latest checkpoint seam 充当产品面，导致 registry/diff/restore job 不成立。
- **当前建议 / 倾向**：**不复用**；必须新增 checkpoint registry + restore job。
- **Reasoning**：DO latest checkpoint 更像内部恢复机制，不是用户可见的 checkpoint 产品面。推荐路线更稳，因为它把“运行时为了自救存的一份状态”和“用户/客户端可管理的 checkpoint 资产”明确区分。如果不拍板，HP4 表面上做了 restore，实际上仍然没有真正的 checkpoint 产品语义。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP4 的产品级 checkpoint / restore 不得直接复用 DO latest checkpoint，而必须建立独立 registry + restore job？`
- **业主回答**：

### Q16 — confirmation 是否继续按业务各自一套路由，还是统一 control plane？（来源：`docs/design/hero-to-pro/HP5-confirmation-control-plane.md` `HP5-D1`）

- **影响范围**：HP5、HP3/HP4/HP6/HP7、future human-in-the-loop flows
- **为什么必须确认**：如果不拍板，各 phase 会继续各自发明 permission、restore、cleanup、cancel 的确认路径，协议面再次碎裂。
- **当前建议 / 倾向**：**统一 control plane**。
- **Reasoning**：这题不是“要不要抽象得更漂亮”，而是多个 phase 是否共享一套用户确认骨架。推荐路线更稳，因为它让 row、stream、decision handler、pending state 只维护一套真相。如果不拍板，越往后 phase 越多，确认路径越难统一。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP5 把 permission / elicitation / restore / cleanup / cancel 等确认行为统一收敛到单一 confirmation control plane？`
- **业主回答**：

### Q17 — kernel wait reason 是否统一为 `confirmation_pending`，而不是继续扩张多个 pending enum？（来源：`docs/design/hero-to-pro/HP5-confirmation-control-plane.md` `HP5-D2`）

- **影响范围**：HP5 kernel interrupt、scheduler、future restore / cleanup flows
- **为什么必须确认**：如果不拍板，每增加一种确认类流程，就会往 kernel enum 里再塞一个 pending reason，最终难以维护。
- **当前建议 / 倾向**：**统一为 `confirmation_pending`**，具体 kind 放在 confirmation 记录里。
- **Reasoning**：kernel 需要的是一个统一的“在等用户确认”语义，而不是把所有业务原因都硬编码进调度层。推荐路线更稳，因为它让 wait reason 保持抽象稳定，而把业务差异放到 confirmation row / kind 中表达。如果不拍板，后面每个 phase 都可能要求再加一个 enum。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 kernel wait reason 在 HP5 统一为 confirmation_pending，而不继续拆出多个业务专用 pending enum？`
- **业主回答**：

### Q18 — 第一版 confirmation kind 是否要先冻结？（来源：`docs/design/hero-to-pro/HP5-confirmation-control-plane.md` `HP5-D3`）

- **影响范围**：HP5+ 全部后续 phase、API、stream、review/closure
- **为什么必须确认**：如果不拍板，后续 phase 很可能在实现时继续临时加 kind，导致 `/confirmations` 失去统一法则。
- **当前建议 / 倾向**：**先冻结第一版 7 kind**。
- **Reasoning**：kind enum 不是实现小细节，而是整个 control plane 的产品边界。推荐路线更稳，因为它先把第一版必须覆盖的风险动作定住，后面扩张必须进 QNA，而不是在代码里悄悄变多。如果不拍板，HP5 只能得到一个名义统一、实则任意扩展的 confirmation 面。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP5 先冻结第一版 7 个 confirmation kind，后续新增 kind 必须回到 HPX-qna 再拍板？`
- **业主回答**：

---

## 4. Tool / Workspace / Checkpoint

### Q19 — workspace temp file 对外是否使用 UUID，而不是路径？（来源：`docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md` `HP6-D1`）

- **影响范围**：HP6 clients、workspace CRUD、HP7 file diff / restore
- **为什么必须确认**：如果不拍板，workspace file API 会在“像 artifact 一样按 UUID 取”与“像工作目录一样按路径取”之间摇摆。
- **当前建议 / 倾向**：**不使用 UUID 作为产品主键**；对外以 `virtual_path` 为主。
- **Reasoning**：artifact 是产物下载对象，workspace file 是工作态状态，两者的产品心智不同。推荐路线更稳，因为路径天然对应 session 内的工作目录结构，也更符合 diff、restore、promotion 的连续性。如果不拍板，客户端很快会遇到“用户眼里是一个文件，系统却要先查 UUID”的使用断裂。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP6 的 workspace temp file 对外以 virtual_path 作为产品主键，而不是 UUID？`
- **业主回答**：

### Q20 — workspace promote 是 alias 现有对象，还是复制成独立 artifact？（来源：`docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md` `HP6-D2`）

- **影响范围**：HP6 promotion、cleanup、HP7 restore / lineage
- **为什么必须确认**：如果不拍板，workspace cleanup 与 artifact 生命周期可能互相踩踏，正式产物会受临时文件 TTL 影响。
- **当前建议 / 倾向**：**复制成独立 artifact**。
- **Reasoning**：workspace object 的设计前提就是可清理、可过期、可被覆盖；artifact 则需要稳定持久。推荐路线更稳，因为它从一开始就把“工作副本”和“正式产物”分成两条生命周期。如果不拍板，后面无论 cleanup 还是 provenance 都会出现歧义。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP6 的 workspace -> artifact promotion 必须复制成独立 artifact，而不是 alias 同一个底层对象？`
- **业主回答**：

### Q21 — tool cancel 是否要进入统一可观察状态，而不是只做下游内部动作？（来源：`docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md` `HP6-D3`）

- **影响范围**：HP6 tool state、client debug、future support surface
- **为什么必须确认**：如果不拍板，用户和调试面只能看到“工具怎么突然没了”，看不到 terminal state 与 cancel 结果。
- **当前建议 / 倾向**：**要进入统一可观察状态**，包含 terminal state + stream event。
- **Reasoning**：cancel 不是纯内部实现动作，它会改变用户对当前 turn 的理解。推荐路线更稳，因为它把 cancel 从“隐藏的 transport side effect”提升成产品事实，后续 debug、audit、replay 都有据可查。如果不拍板，HP6 虽然实现了 cancel，客户端仍然像没实现一样。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP6 的 tool cancel 必须有可查询 terminal state 与 stream event，而不是只在下游内部完成？`
- **业主回答**：

### Q22 — file snapshot 是 eager 还是 lazy 物化？（来源：`docs/design/hero-to-pro/HP7-checkpoint-revert.md` `HP7-D1`）

- **影响范围**：HP7 cost、cron、checkpoint UX
- **为什么必须确认**：如果不拍板，执行者可能默认 turn-end 就全量复制文件，成本和 cleanup 压力会被迅速放大。
- **当前建议 / 倾向**：**lazy 物化**。
- **Reasoning**：当前 checkpoint 体系首先要解决的是“有产品级锚点”，不是“每次 turn 都复制完整文件系统”。推荐路线更稳，因为它把重成本 snapshot 留到真正需要的场景，再由 registry / status 跟踪物化过程。如果不拍板，HP7 很容易在 first wave 就引入不可控存储成本。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP7 的 file snapshot 采用 lazy materialization，而不是 turn-end eager copy 全量文件？`
- **业主回答**：

### Q23 — fork 是不是新 conversation？（来源：`docs/design/hero-to-pro/HP7-checkpoint-revert.md` `HP7-D2`）

- **影响范围**：HP7 clients、lineage、conversation/session domain
- **为什么必须确认**：如果不拍板，fork 的 lineage 归属会不清晰，后续 conversation view 与 session view 都会混乱。
- **当前建议 / 倾向**：**不是新 conversation**；是同 conversation 下的新 session。
- **Reasoning**：当前 charter 已把 HP7 定位为 session fork，而不是把整段对话搬到新的 conversation 容器里。推荐路线更稳，因为它能保留同一对话脉络下的 lineage，同时又给 child session 充分隔离的 runtime 与文件空间。如果不拍板，fork 很容易与“另开新对话”混成一件事。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP7 的 fork 语义是“同 conversation 下创建一个新 session”，而不是新建 conversation？`
- **业主回答**：

### Q24 — restore 失败后是否允许 best-effort 停留在部分成功状态？（来源：`docs/design/hero-to-pro/HP7-checkpoint-revert.md` `HP7-D3`）

- **影响范围**：HP7 restore reliability、support、checkpoint trustworthiness
- **为什么必须确认**：如果不拍板，执行时容易选择“能恢复多少算多少”，但这样会让 restore 结果变得不可预测。
- **当前建议 / 倾向**：**不允许**；必须有 rollback baseline。
- **Reasoning**：restore 的价值在于可预期，不在于尽量做一点。推荐路线更稳，因为它要求失败时明确回到已知基线，而不是把 conversation、files、runtime 各留一半在旧状态、一半在新状态。如果不拍板，checkpoint 很快就会失去可信度。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP7 的 restore 失败时必须回滚到已知 baseline，不允许以 best-effort partial success 作为合法终态？`
- **业主回答**：

---

## 5. Runtime Hardening / Ops 治理

### Q25 — megafile gate 是否继续盯历史文件名？（来源：`docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md` `HP8-D1`）

- **影响范围**：HP8 CI、future split、repo cleanup
- **为什么必须确认**：如果不拍板，CI 可能继续盯着已经被拆空的历史文件名，真正高风险的大文件反而不受约束。
- **当前建议 / 倾向**：**不再盯历史文件名**；改盯当前真实 owner 文件。
- **Reasoning**：仓库 reality 已经变化，`nano-session-do.ts` / `user-do.ts` 更多只是 wrapper。推荐路线更稳，因为它让 gate 跟当前代码结构一致，真正能阻止问题继续扩大。如果不拍板，megafile gate 会沦为装饰性检查。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP8 的 megafile gate 只针对当前真实 owner 文件，而不再沿用历史 megafile 名称？`
- **业主回答**：

### Q26 — tool catalog 应落在哪一层？（来源：`docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md` `HP8-D2`）

- **影响范围**：HP8 tool contract、agent-core、bash-core、future docs/SDK
- **为什么必须确认**：如果不拍板，catalog 可能落在任意一层，结果仍然会有 caller/callee 各自维护镜像定义。
- **当前建议 / 倾向**：**落在 `nacp-core`**。
- **Reasoning**：当前 canonical tool message schema 已经在 `nacp-core`，catalog 继续往更外层或更内层放都会制造第二个真相源。推荐路线更稳，因为它让 schema、description、binding owner 从第一天就是协议层资产。如果不拍板，HP8 做出来的 SSoT 仍可能只是“另一份定义文件”。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP8 的 tool catalog 单一真相源落在 nacp-core，而由 agent-core / bash-core 向它收敛？`
- **业主回答**：

### Q27 — envelope 收敛是否包括 internal RPC？（来源：`docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md` `HP8-D3`）

- **影响范围**：HP8 public API、worker RPC、auth/orchestrator contracts
- **为什么必须确认**：如果不拍板，cleanup 时很容易把 internal envelope 也一并删改，伤到 worker 内部 contract。
- **当前建议 / 倾向**：**不包括 internal RPC**；只要求 public surface 唯一 `FacadeEnvelope`。
- **Reasoning**：这题的关键是区分“对外 contract 清晰”和“内部 transport 仍有自己的 envelope 需求”。推荐路线更稳，因为它只清 public drift，不误伤 internal RPC 的 authority / trace 语义。如果不拍板，HP8 很可能把“收敛”做成过度清洗。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP8 的 envelope 收敛只针对 public HTTP surface，internal RPC 继续允许 Envelope/AuthEnvelope 保留？`
- **业主回答**：

### Q28 — R28 / R29 / Lane E 是否允许 retained / handoff 作为合法终态？（来源：`docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md` `HP8-D4`）

- **影响范围**：HP8 closure、HP10 final closure、ops runbook、hero-to-platform handoff
- **为什么必须确认**：如果不拍板，执行时就会在“必须现场彻底修完”与“先写 explicit handoff”之间反复拉扯，closure 口径不稳定。
- **当前建议 / 倾向**：**允许** retained / handoff，但必须 explicit。
- **Reasoning**：这几类问题里有些天然带 deploy-only / owner-only / environment-only 特征，不一定都能在同一 phase 内代码上彻底解决。推荐路线更稳，因为它禁止 silent carryover，但接受“已写清 scope、reason、remove condition”的合法未闭合状态。如果不拍板，团队要么会假装问题消失，要么会被迫在错误的 phase 里过度追求完美。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 R28 / R29 / Lane E 这类 chronic issue 允许以 retained-with-reason 或 handed-to-platform 作为合法终态，但绝不允许 silent unresolved？`
- **业主回答**：

---

## 6. API 文档 / 手工证据 / Prod Baseline

### Q29 — api docs 应按 worker 模块切还是按产品 surface 切？（来源：`docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md` `HP9-D1`）

- **影响范围**：HP9 docs pack、clients、README 索引、长期可读性
- **为什么必须确认**：如果不拍板，文档库会继续沿着 worker 实现边界增长，前端和集成方仍然要自己拼产品面。
- **当前建议 / 倾向**：**按产品 surface 切**。
- **Reasoning**：当前 `session.md` 已经证明“按阶段堆功能”会把 models/context/files 混在一起。推荐路线更稳，因为它让文档结构服务于客户端使用，而不是服务于 worker 目录结构。如果不拍板，HP9 就算写到 18 份，仍可能延续 RHX2 的过载文档形态。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP9 的 clients/api-docs 按产品 surface 重组，而不是继续按 worker 模块边界组织？`
- **业主回答**：

### Q30 — manual evidence 是否仍允许继续 defer？（来源：`docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md` `HP9-D2`）

- **影响范围**：HP9 / HP10 gate、manual evidence pack、closure legitimacy
- **为什么必须确认**：如果不拍板，manual evidence 很可能再次变成“下一阶段再补”，直接重演 zero-to-real 的历史缺口。
- **当前建议 / 倾向**：**不允许继续 defer**；它是 hard gate。
- **Reasoning**：HP9 的意义之一就是把“文档、手工证据、prod baseline”绑定成同一份 closure 资产。推荐路线更稳，因为它强制在当前阶段就把真实客户端使用证据拿齐，而不是继续凭想象放行。如果不拍板，HP10 final closure 的合法性会再次变弱。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 manual evidence 在 HP9 是 hard gate，不允许再 defer 到下一阶段？`
- **业主回答**：

### Q31 — prod schema baseline 是否可只依赖仓内 migrations？（来源：`docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md` `HP9-D3`）

- **影响范围**：HP9 prod baseline、ops、HP10 final closure
- **为什么必须确认**：如果不拍板，团队很容易拿本地 migrations 目录当作“prod 真实状态”，但这无法证明 remote/prod 没有 drift。
- **当前建议 / 倾向**：**不可以**；必须 remote/prod 校对。
- **Reasoning**：prod baseline 是 owner / ops 侧事实，不是仓库侧想象。推荐路线更稳，因为它要求真正跑 remote list / dump / diff，把“prod 当前到底是什么”写成文档证据。如果不拍板，HP9 只能得到一份本地视角的 schema 说明，不足以支撑封板。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP9 的 prod schema baseline 必须由 owner / ops 以 remote/prod 事实回填，而不能只引用仓内 migrations 目录？`
- **业主回答**：

### Q32 — 18 份 docs 是否全部走同样强度 review？（来源：`docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md` `HP9-D4`）

- **影响范围**：HP9 review workload、文档冻结节奏、reviewers
- **为什么必须确认**：如果不拍板，要么所有文档都深审导致节奏失控，要么风险高的重写文档被用“轻核对”带过。
- **当前建议 / 倾向**：**不采用统一强度**；rewrite/new 深审，稳定 docs sanity check。
- **Reasoning**：当前文档成熟度明显不均，`error-index.md` 与 `session.md` 的风险完全不同。推荐路线更稳，因为它把 review 精力投入真正高风险的重写/新增文档，同时让稳定文档走事实核对。如果不拍板，HP9 的 review 成本和质量都会一起失控。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP9 的 18 份文档采用分级 review：rewrite / new 深审，稳定文档 sanity check？`
- **业主回答**：

---

## 7. Final Closure / Handoff

### Q33 — final closure 是否允许出现 “silently resolved” 分类？（来源：`docs/design/hero-to-pro/HP10-final-closure-and-cleanup.md` `HP10-D1`）

- **影响范围**：HP10 review、handoff、阶段合法性
- **为什么必须确认**：如果不拍板，final closure 可能再次用模糊语言跳过未完成项，降低整阶段的可审计性。
- **当前建议 / 倾向**：**不允许**。
- **Reasoning**：final closure 的价值就在于把所有残余显式分类，而不是靠叙述性语言让问题“看起来已经好了”。推荐路线更稳，因为它要求每项都能进 map、进 registry、进 handoff。如果不拍板，HP10 就很难成为真正的封板文件。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP10 final closure 中不允许出现 silently resolved 这类模糊分类，所有残余都必须显式标注状态？`
- **业主回答**：

### Q34 — cleanup register 是否按历史文件名决议？（来源：`docs/design/hero-to-pro/HP10-final-closure-and-cleanup.md` `HP10-D2`）

- **影响范围**：HP10 cleanup、repo reality、future reviews
- **为什么必须确认**：如果不拍板，cleanup 决议会继续围绕已经失真的历史名词，而不是当前真实 owner 文件。
- **当前建议 / 倾向**：**不按历史文件名**；按当前 repo reality 决议。
- **Reasoning**：仓库经过多轮拆分后，很多“历史大文件”已经只剩 wrapper。推荐路线更稳，因为它强迫 cleanup 以当前责任归属为准，而不是对着已经变形的历史问题名词作判断。如果不拍板，HP10 的 retained/deleted registry 会失真。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP10 的 cleanup register 必须按当前 repo reality 决议，而不是继续以历史文件名和历史 owner 为依据？`
- **业主回答**：

### Q35 — hero-to-platform stub 是否可以写实质计划？（来源：`docs/design/hero-to-pro/HP10-final-closure-and-cleanup.md` `HP10-D3`）

- **影响范围**：HP10 / next stage boundary / future charter
- **为什么必须确认**：如果不拍板，HP10 很容易越界，把下一阶段路线提前写进当前 closure，破坏阶段边界。
- **当前建议 / 倾向**：**不可以**；stub 只写 inherited issues 入口。
- **Reasoning**：HP10 的职责是封板和移交，不是替下一阶段立完整路线。推荐路线更稳，因为它让 hero-to-platform 仍保有自己的 charter 空间，同时让当前阶段把遗留和继承问题写清。如果不拍板，两个阶段会互相污染。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 HP10 创建的 hero-to-platform stub 只登记 inherited issues 与边界说明，不提前写实质实施计划？`
- **业主回答**：

### Q36 — retained-with-reason 是否是合法终态？（来源：`docs/design/hero-to-pro/HP10-final-closure-and-cleanup.md` `HP10-D4`）

- **影响范围**：HP10 final closure、hero-to-platform handoff、ops / owner review
- **为什么必须确认**：如果不拍板，closure 会陷入“两种极端”：要么假装全部删完，要么把保留项继续模糊挂起。
- **当前建议 / 倾向**：**是合法终态**，但必须带 remove condition。
- **Reasoning**：并不是所有残余都应该被强行删除；有些确实属于阶段边界、环境约束或成本取舍。推荐路线更稳，因为它承认“显式保留”本身可以是合规结论，但要求范围、理由、移除条件都写清。如果不拍板，HP10 的 retained registry 就会失去规范性。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 retained-with-reason 是 HP10 的合法终态之一，但每个 retained 项都必须显式写出范围、理由和 remove condition？`
- **业主回答**：

---

## 8. 条件触发题（仅在触发条件出现时回答）

### Q37 — 若 HP1 在 HP3 启动前仍未落地，manual compact 所依赖的 confirmation/checkpoint 字段是否允许作为 HP1 schema correction 一并处理？（来源：`docs/design/hero-to-pro/HP3-context-state-machine.md` `9.3 条件题`）

- **影响范围**：HP3 start gate、HP1 DDL freeze、context compact job truth
- **为什么必须确认**：这是一道条件触发题；只有当 HP1 未按顺序完成时，它才会影响执行路径。若 HP1 已正常 closure，则本题自动视为 `not-triggered`。
- **当前建议 / 倾向**：**默认不允许**；优先维持 charter 执行顺序，除非 owner 明确批准走 `HP1 schema correction / collateral migration`。
- **Reasoning**：HP3 现已明确第一版不新增独立 `compact_jobs` 表，而是复用 HP1 冻结的 confirmation/checkpoint truth。若 HP1 未落地就让 HP3 自己顺手补这些字段，仍会直接破坏 DDL Freeze Gate。推荐路线更稳，因为它把这个问题保留成一个显式的 owner 决策分支，而不是执行时临时妥协。如果不先在 QNA 里挂出来，真正触发时很容易在聊天里仓促拍板。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`若 HP1 在 HP3 启动前仍未落地，你是否允许 HP3 为 manual compact 所依赖的 confirmation/checkpoint 字段走一次受控的 HP1 schema correction？`
- **业主回答**：

### Q38 — 若 HP1 尚未落地，HP4 所需的最小 delete/retry/checkpoint/restore D1 字段集是否允许作为 collateral migration 一并处理？（来源：`docs/design/hero-to-pro/HP4-chat-lifecycle.md` `9.3 条件题`）

- **影响范围**：HP4 start gate、HP1 DDL freeze、chat lifecycle / checkpoint registry
- **为什么必须确认**：这也是条件触发题；只有当执行顺序被打破时，它才会影响 HP4 能否合法启动。若 HP1 已正常 closure，则本题自动视为 `not-triggered`。
- **当前建议 / 倾向**：**默认不允许**；除非 owner 明确批准受控 correction。
- **Reasoning**：HP4 依赖的 tombstone、retry、checkpoint registry、restore job 都是强 durable truth，如果放到 HP4 临时补，很容易把 phase 边界弄乱。推荐路线更稳，因为它把“例外路径”保留为明确批准制，而不是执行者自行决定。如果不挂到 HPX-qna，触发时很容易因为赶进度而失去治理纪律。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`若 HP1 尚未完成，你是否允许 HP4 为 delete / retry / checkpoint registry / restore job 走一次受控 collateral migration / schema correction？`
- **业主回答**：

### Q39 — 若业主不接受统一 `confirmation_pending` 命名，是否允许保留外部兼容 alias，而内部仍统一语义？（来源：`docs/design/hero-to-pro/HP5-confirmation-control-plane.md` `9.3 条件题`）

- **影响范围**：HP5 naming、clients、internal runtime semantics
- **为什么必须确认**：这是一道命名争议的兜底题；只有在业主对 `confirmation_pending` 这个名字本身有异议时，才需要回答。
- **当前建议 / 倾向**：**允许保留外部兼容 alias，但内部仍统一为 `confirmation_pending` 语义**。
- **Reasoning**：这题的实质不是要不要改一个词，而是内部 runtime 语义是否还能保持单一。如果只是名字不喜欢，最稳的路线是外部给 alias，内部不分裂；否则会为了命名偏好重新引入多个 pending reason。把这题单独挂出来，可以避免未来在实现阶段临时争论命名。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`如果你不接受 confirmation_pending 这个命名，是否同意“外部保留兼容 alias、内部仍统一用 confirmation_pending 语义”这条折中路线？`
- **业主回答**：

---

## 9. 使用约束

### 9.1 哪些问题应该进入 HPX-qna

- **会直接改变 HP0-HP10 contract surface、phase 边界、执行顺序、DDL freeze、closure legality、owner-action / ops-action gate 的问题**
- **需要业主 / ops 拍板，而不是实现阶段自己就能收敛的治理性问题**
- **如果不先拍板，就会导致多个后续 design / action-plan / closure 同时漂移的问题**

### 9.2 哪些问题不应进入 HPX-qna

- **单个函数、单个测试文件、单个脚本的实现细节**
- **已经有明确 owner answer，且本轮无意推翻的旧答案**
- **只影响某个包内部实现、不会改变 HP0-HP10 外部治理边界的问题**

### 9.3 本文件的使用提醒

- HP0-HP10 各设计稿中的 `9.1` 与 `9.3` 已被统一吸收；后续若有回答回填，应优先更新本文件。
- 对于 Q37-Q39 这类**条件触发题**，若条件未发生，可以在 `业主回答` 中直接标注 `not-triggered`。
- 当某个回答会影响多个 phase 时，后续 action-plan / closure 应直接引用本文件的 `Q` 编号，而不要重新解释。

---

## 10. 最小索引

| 区块 | Q 编号 |
|------|--------|
| 基础边界 / DDL Freeze | Q1-Q6 |
| 模型 / 上下文状态机 | Q7-Q12 |
| Chat 生命周期 / Confirmation | Q13-Q18 |
| Tool / Workspace / Checkpoint | Q19-Q24 |
| Runtime Hardening / Ops 治理 | Q25-Q28 |
| API 文档 / 手工证据 / Prod Baseline | Q29-Q32 |
| Final Closure / Handoff | Q33-Q36 |
| 条件触发题 | Q37-Q39 |
