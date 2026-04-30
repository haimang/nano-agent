# Hero-to-Pro — HPX QNA

> 范围：`hero-to-pro / HP0-HP10`
> 目的：把会影响后续 `docs/design/hero-to-pro/*.md`、`docs/action-plan/hero-to-pro/*.md`、各 HP phase implementation gate 与 final closure 的业主 / ops 决策收敛到一份单一清单，避免在多个 design 文档中重复回答、重复漂移、重复改口。
> 状态：`frozen (Q1-Q39 resolved, 2026-04-30)`
> 使用方式：
> 1. **业主只在本文件填写回答。**
> 2. 其他 design / action-plan / memo 若引用某个 `Q` 编号，默认都以本文件为唯一答复来源。
> 3. 各具体文档不再逐条填写 QNA；如仍保留“已确认 / 已冻结”的历史表述，应理解为上下文说明，后续统一以本文件回填结果为准。
> 4. `Q` 编号应保持稳定；后续若补题，从最后一个编号继续追加。
>
> 📝 **注**：
> - 本文件使用 `docs/templates/qna.md` 的完整版格式。
> - 对于偏运行维护的问题，`业主回答` 一栏默认可由 **业主与 ops 联合回填**；一旦填写，仍视为唯一有效口径。
> - 本文件中的“当前建议 / 倾向”是设计阶段留存的拍板前上下文；若与 `业主回答` 或后续 action-plan 口径冲突，一律以 `业主回答` 为准。

---

## 1. 基础边界 / DDL Freeze

### Q1 — `system prompt model-aware seam` 是否允许先开签名、后补真值？（来源：`docs/design/hero-to-pro/HP0-pre-defer-fixes.md` `HP0-D1`）

- **影响范围**：`workers/agent-core/**`、HP0 closure、HP1 schema extension
- **为什么必须确认**：如果这题不拍板，HP0 会在“能不能先接 seam”与“必须等字段落表”之间反复摇摆，直接拖慢 HP0 与 HP1 的衔接。
- **当前建议 / 倾向**：**允许**在 HP0 先落 `withNanoAgentSystemPrompt(modelId?)` 签名与调用位点，但如果 HP1 之前还没有 `base_instructions_suffix` 真字段，HP0 只能标 `partial`。
- **Reasoning**：这题的核心不是“功能先做多少”，而是要不要先把边界接缝开出来。推荐路线更稳，因为它允许 HP0 先把 public ingress 与 runtime mainline 的结构整理好，同时又不伪装成“model suffix 已经 fully live”。如果不拍板，执行时很容易出现两种坏结果：要么 HP0 什么都不做，后续还得返工函数边界；要么 HP0 偷偷用空字符串冒充真功能，closure 口径失真。

- **Opus的对问题的分解**：
  - 这题的本质是接缝优先 vs 字段优先,有三个子问题:(1) 函数签名扩展会不会破坏现有调用?(2) HP0 标 `partial` 是不是给 deceptive closure 留口?(3) 若 HP1 延期,这条 seam 会不会演化成"永久空函数"的死代码。
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("先开签名 + partial closure")在 nano-agent 当前阶段是稳的,理由是:HP0 的核心价值就是"边界对齐"而不是"功能闭合";签名先行能让 HP1 的 migration 与 runtime 接线在两个 phase 之间无缝衔接,避免 HP1 完成时再回头改函数边界。但 partial 状态需要硬约束 expiry,否则会变成永久 partial。
- **Opus的最终回答**：
  - 同意先开签名,但建议在 HP0 closure 文档中显式登记 `expires-at: HP1 closure`:HP1 一旦 closure 后,该 partial 必须强制升级为完整接线(读取 `base_instructions_suffix` 真值),否则整体视为 HP1 incomplete 而非 HP0 success。这样能从规则上挡住"永久 partial"的退化路径。

- **问题**：`是否确认 HP0 允许先落 withNanoAgentSystemPrompt(modelId?) 的签名和调用 seam，但在 HP1 字段未落表前只能按 partial closure 处理？`
- **业主回答**：确认。同意 GPT 的先开签名 + partial closure 路线，并采纳 Opus 的补充约束：HP0 closure 文档中显式登记 `expires-at: HP1 closure`，HP1 closure 后该 partial 必须强制升级为完整接线，否则视 HP1 为 incomplete。`approved`

### Q2 — R29 相关 residue 是否禁止在 HP0 提前物理删除？（来源：`docs/design/hero-to-pro/HP0-pre-defer-fixes.md` `HP0-D2`）

- **影响范围**：`workers/orchestrator-core/**`、HP8 R29 postmortem、HP10 cleanup
- **为什么必须确认**：如果不拍板，执行者可能把 `forwardInternalJsonShadow` / `parity-bridge` 当“顺手清理”直接删掉，后面就失去 R29 对照材料。
- **当前建议 / 倾向**：**禁止**在 HP0 提前删；必须等 HP8 的 R29 postmortem 完成后，在 HP10 按显式 cleanup 决议处理。
- **Reasoning**：这类残留的价值不在日常运行，而在于它们还承载“为什么历史上出现 divergence”的证据。推荐路线更稳，因为它把“先整理施工面”和“做最终历史清债”分离开，避免 HP0 越界成大扫除。如果不拍板，后面即使想写清 R29，也会发现最关键的比对点已经被提前抹掉。

- **Opus的对问题的分解**：
  - 三个子问题:(1) `forwardInternalJsonShadow` / `parity-bridge.ts` 这些 residue 的诊断价值是否仍然 active(不是历史摆设)?(2) "禁止 HP0 删"会不会让 HP10 失去合法删除契机?(3) HP8 postmortem 之前是否真的没有任何信号能判断 residue 是否还需要保留。
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("禁止 HP0 删 + 等 HP8 postmortem")完全符合 hero-to-pro 治理纪律。R29 residue 既是历史诊断证据又是潜在死代码,先 freeze cleanup policy、再做终局动作是正确顺序。唯一风险:HP8 若延期或 owner 不回填 R29,这些 residue 会无限期留下来 — 但这个风险其实是 HP8/HP10 应当承担的,不应让 HP0 提前替它们做决定。
- **Opus的最终回答**：
  - 同意禁止 HP0 删除。补充建议:HP0 closure 文档中显式列出 residue 当前的精确 grep 范围(文件路径 + 函数名 + 调用点),为 HP8 postmortem 提供 stable baseline,避免 HP8 启动时还要重新 archaeology。

- **问题**：`是否确认 R29 相关 residue 在 HP0 阶段不得物理删除，只允许在 HP8 postmortem 完成后再由 HP10 决议？`
- **业主回答**：确认。禁止 HP0 提前删除 R29 residue。采纳 Opus 补充：HP0 closure 文档中显式列出 residue 当前精确 grep 范围（文件路径 + 函数名 + 调用点），作为 HP8 postmortem 的 stable baseline。`approved`

### Q3 — `CONTEXT_CORE` / `LANE_E_RPC_FIRST` 在 HP0 是否只做 verify，不改 wrangler？（来源：`docs/design/hero-to-pro/HP0-pre-defer-fixes.md` `HP0-D3`）

- **影响范围**：`workers/agent-core/wrangler.jsonc`、HP0 tests、后续 Lane E 迁移路径
- **为什么必须确认**：如果这题不拍板，HP0 会重新去碰 wrangler 配置，打乱“verify-only”边界，甚至把后续真正的 Lane E 演进和 HP0 混在一起。
- **当前建议 / 倾向**：**只做 verify + test**，不再修改 wrangler 配置。
- **Reasoning**：当前代码里 binding 和 env flag 已经真实存在，HP0 再改配置的收益很低，风险却很高。推荐路线更稳，因为它把 HP0 定义成“证明当前事实存在”而不是“重写部署面”，这样 action-plan 不会把精力浪费在重复接线上。如果不拍板，HP0 很容易变成配置层返工，而不是设计层清障。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 当前 binding 是否真的就绪能跑通 RPC(verify-only 是否足以证明)?(2) verify-only 是否会掩盖现有配置的 silent drift?(3) HP3 启动时若发现需要新增 binding,会不会被这条 law 阻塞。
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("只 verify 不改配置")符合 HP0 作为 hygiene phase 的边界。但有一个隐患:`LANE_E_RPC_FIRST=false` 当前是观察 flag,verify 不能等同于"接受这个值就是终态",否则 HP8 的 Lane E final-state 决议会失去对配置面的杠杆 — verify 应当包含"flag 当前值"作为输入证据,而不是默默 stamp 通过。
- **Opus的最终回答**：
  - 同意只 verify。建议 verify test 同时记录 `LANE_E_RPC_FIRST` 当前值与 `CONTEXT_CORE` binding wiring 的 grep 证据,作为 HP8 Lane E final-state 决议的输入。HP3 若真需要新增 binding,走 HP1 schema correction 同款的"配置 correction"程序,而不是绕过 HP0 法则。

- **问题**：`是否确认 HP0 对 CONTEXT_CORE / LANE_E_RPC_FIRST 只做 verify 与测试加固，不再改 wrangler 配置？`
- **业主回答**：确认。只做 verify + test，不改 wrangler。采纳 Opus 补充：verify test 同时记录 `LANE_E_RPC_FIRST` 当前值，作为 HP8 Lane E final-state 决议的输入证据。`approved`

### Q4 — hero-to-pro migration 是否正式冻结为 `007-013` 七个文件？（来源：`docs/design/hero-to-pro/HP1-schema-extension.md` `HP1-D1`）

- **影响范围**：HP1 design freeze、全部后续 HP phase、HP9 prod baseline
- **为什么必须确认**：如果 migration 编号和职责边界不拍板，HP2-HP10 会在实现时不断“顺手补 migration”，DDL Freeze Gate 会直接失效。
- **当前建议 / 倾向**：**冻结为 `007-013` 七个文件**，不再保留旧 `008/009-016` 口径。
- **Reasoning**：HP1 的价值就在于一次性把全阶段 durable truth 布好。如果不拍板，后续每个 phase 都会把“我这里再补一张表/一列”合理化，最后 schema 边界重新碎掉。推荐路线更稳，因为它让 reviewer、owner、ops 都能以同一份 ledger 来判断“某个 truth 到底是不是已经属于 HP1 冻结范围”。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 编号是否会跟其他分支或未合并 migration 冲突?(2) 七个文件的拆分粒度是否合理(不是太大也不是太小)?(3) 后续若需要"同主题第二张表",是放进同一 migration 还是新增编号?
- **Opus的对GPT推荐线路的分析**：
  - GPT 给的 ledger(007 model metadata / 008 session-turn audit / 009 turn_attempt rebuild / 010 todos / 011 temp files+provenance / 012 confirmations / 013 checkpoints+snapshots+restore_jobs+cleanup_jobs)粒度合理,review/apply 风险可控。每个 migration 能独立 review、独立回滚,不会出现"一个超大 migration"或"碎片化 migration"。值得注意的是 013 实际包含四张表 — 但因为四者共属 checkpoint lineage,放一起反而比拆开更稳。
- **Opus的最终回答**：
  - 同意冻结 007-013。owner 拍板时需同时显式确认两条派生规则:(a) 014+ 编号空间只允许 `HP1 schema correction` 占用;(b) HP2-HP10 若发现"应该和 007-013 中某张表合并的列",必须改写对应 migration(等同于推翻 freeze)而非新增第八张 migration。这两条若不一并冻结,DDL Freeze Gate 会被"同主题但新文件"绕过。

- **问题**：`是否确认 hero-to-pro 的 D1 migration baseline 固定为 007-013 七个文件，不再允许使用其它并行编号口径？`
- **业主回答**：确认。冻结为 007-013 七个文件。采纳 Opus 两条派生规则：(a) 014+ 编号空间只允许 `HP1 schema correction` 占用；(b) HP2-HP10 若发现同主题需合并列，必须改写对应 migration 而非新增第八个 migration 文件。`approved`

### Q5 — checkpoint / file snapshot / restore job 是否必须在 HP1 一次性落表？（来源：`docs/design/hero-to-pro/HP1-schema-extension.md` `HP1-D2`）

- **影响范围**：HP1、HP4、HP7、checkpoint/revert 全链路
- **为什么必须确认**：如果这题不拍板，HP4/HP7 很容易在实现时发现 durable truth 不够，再把补 migration 合理化，破坏执行顺序。
- **当前建议 / 倾向**：**必须**在 HP1 一次性落表。
- **Reasoning**：checkpoint/restore 不是小补丁，它决定后续 chat lifecycle、files restore、fork、cleanup 这整条链怎么成立。推荐路线更稳，因为它把最贵的 schema 决策提前冻结，后面每个 phase 只消费已有真相，而不是边做边发明。如果不拍板，HP4 与 HP7 的设计再完整也会在实施时被迫返工 DDL。

- **Opus的对问题的分解**：
  - 三个子问题:(1) HP4 conversation_only restore 是否真的需要 checkpoint 三表全部落地,还是只需 `nano_session_checkpoints` 一张?(2) 一次落表 vs HP4/HP6/HP7 各自补的成本如何对比?(3) 若 HP1 不落,HP4/HP7 的 collateral migration 真的更小吗?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("必须一次落表")是守住 DDL Freeze Gate 的灵魂条款。如果 HP1 不落 checkpoint lineage,HP4 必然要补 `nano_session_checkpoints + nano_checkpoint_restore_jobs`,HP7 必然要补 `nano_checkpoint_file_snapshots + nano_workspace_cleanup_jobs` — 这就是 schema 沿 phase 边界继续碎裂,DDL Freeze 就名存实亡。一次落表的成本主要在 HP1 review,但 review 一次永远比每个 phase 反复 review schema 加 migration 更便宜。
- **Opus的最终回答**：
  - 同意必须 HP1 一次落表。建议 HP1 action-plan 中显式标注"checkpoint 三表 + cleanup 表是 HP4/HP6/HP7 的硬依赖",并要求 HP1 review 时把 HP4/HP6/HP7 设计中的字段消费关系逐项映射回 013 migration,避免 reviewer 因为"看不到 consumer"而误判这些表"可以等"。

- **问题**：`是否确认 checkpoint / file snapshot / restore job / cleanup lineage 这组 durable truth 必须在 HP1 一次性落表，而不是分散到 HP4 / HP7 再补？`
- **业主回答**：确认。必须 HP1 一次性落表。采纳 Opus 补充：HP1 action-plan 中显式标注 checkpoint 三表 + cleanup 表是 HP4/HP6/HP7 的硬依赖，HP1 review 时要求对照 HP4/HP6/HP7 设计逐项映射字段消费关系到 migration 013。`approved`

### Q6 — 后续 phase 若发现 schema blocker，是否禁止直接新增 migration？（来源：`docs/design/hero-to-pro/HP1-schema-extension.md` `HP1-D3`）

- **影响范围**：HP2-HP10 implementation discipline、charter 修订流程
- **为什么必须确认**：如果不拍板，执行阶段一旦遇到困难，就会很自然地选择“再补个 migration”，DDL Freeze Gate 失去约束力。
- **当前建议 / 倾向**：**禁止**直接新增 migration；只能走 `HP1 schema correction` 路径。
- **Reasoning**：这题本质上是在问：hero-to-pro 后半段是否还承认“边做边长 schema”是正常行为。推荐路线更稳，因为它迫使团队先用现有设计解释问题，再决定是否真的需要修 charter，而不是把 schema correction 正常化。如果不拍板，HP1 的 freeze 就会名存实亡。

- **Opus的对问题的分解**：
  - 三个子问题:(1) "schema correction"流程的成本是否过高,以至于实施期会被绕过?(2) 是否所有 phase 都能在执行时识别出"这是 schema 问题还是逻辑问题"(避免误诊)?(3) 例外条件如何成文,谁有权批准?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("禁止 + 必须走 schema correction")是 DDL Freeze 的灵魂条款。若不严守,HP1 的 freeze 立刻退化成"建议性约束",团队最自然的妥协就是"再加一个 migration 就好了"。但这条 law 必须配套有"轻量但严格"的 correction 流程,否则会出现两种坏结果:要么 phase 私下绕过,要么 phase 全部 stalled 等 owner 拍板。
- **Opus的最终回答**：
  - 同意禁止。强烈建议 HP1 设计稿中给出"schema correction"的最小流程模板:(a) 谁批准(owner + architect 双签);(b) charter 如何修(在 `plan-hero-to-pro.md` 增列 `schema correction registry`);(c) 新 migration 编号规则(从 014 起,每个 correction 独占编号,标 `correction-of: 007-013 中的某张`)。模板在 HP1 closure 前就要存在,避免 HP3-HP7 真触发时争议。

- **问题**：`是否确认 HP2-HP10 若发现 schema blocker，不得直接新增 migration，而必须走 HP1 schema correction + charter 修订流程？`
- **业主回答**：确认。禁止直接新增 migration，必须走 HP1 schema correction。采纳 Opus 补充：HP1 设计稿中给出 correction 最小流程模板（owner + architect 双签批准；charter 中新增 `schema correction registry`；新 migration 从 014 起编号并标 `correction-of`）。模板在 HP1 closure 前必须就位。`approved`

---

## 2. 模型 / 上下文状态机

### Q7 — 模型控制面是否必须引入 session default，而不能只靠 turn payload？（来源：`docs/design/hero-to-pro/HP2-model-state-machine.md` `HP2-D1`）

- **影响范围**：HP2 model API、clients、HP3 compact policy
- **为什么必须确认**：如果不拍板，模型选择会继续停留在“每次发消息时顺手带一下参数”的临时状态，无法形成产品级 model state machine。
- **当前建议 / 倾向**：**必须引入 session default**。
- **Reasoning**：只靠 turn payload 意味着客户端和用户永远要自己猜“当前模型到底是谁”，这不利于后续 fallback、checkpoint、context budget 全链路。推荐路线更稳，因为它把 session 当前模型提升成单独可读写的产品面，同时仍允许 turn override。若不拍板，HP2 很容易退化成“多加几个字段”的轻量修补，而不是完整状态机。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 仅 turn payload 是否真的不够(客户端能否自行 cache "上次用过的模型")?(2) session default 与 turn override 的优先级是否需在 HP2 一并冻结(还是留给 HP3 决定)?(3) clients 能否优雅 fallback 到 turn-only 兼容模式,避免新旧客户端混跑时碎裂?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("必须引入 session default")正确。若只靠 turn payload,会有三个不可接受的后果:(a) 客户端永远要自行猜"当前模型"(不一致风险);(b) HP3 compact 失去 model-aware budget 的稳定输入(每个 turn 重新算窗口);(c) HP4 retry 没法继承上次 turn 的模型选择(retry 必须带 model_id 才能复刻语境,但用户不会知道)。这条不引入会拖累 HP3/HP4 一起退化。
- **Opus的最终回答**：
  - 同意必须引入 session default,且 HP2 一并冻结优先级:`turn override > session default > global default`。补充:`PATCH /sessions/{id}/model` 第一版必须同时支持 set 与 clear 两种语义(`{ model_id: null }` 表示恢复 global default),避免 client 想"放回默认"时无路径。clear 语义不冻死,后续 client 只能改协议而不是改 schema。

- **问题**：`是否确认 hero-to-pro 的模型控制面必须包含 session default，而不是只依赖每个 turn 自带 model_id / reasoning？`
- **业主回答**：确认。必须引入 session default，形成 `turn override > session default > global default` 三层优先级。采纳 Opus 补充：`PATCH /sessions/{id}/model` 第一版必须同时支持 set 与 clear（`{ model_id: null }` 恢复 global default），避免客户端无法回到默认模型。`approved`

### Q8 — fallback 是否先冻结为单层，而不是链式路由？（来源：`docs/design/hero-to-pro/HP2-model-state-machine.md` `HP2-D2`）

- **影响范围**：HP2 fallback、HP3 future routing、error/stream semantics
- **为什么必须确认**：如果不拍板，执行时很容易从“给一个 fallback_model_id”膨胀成链式 provider routing，范围立刻越界。
- **当前建议 / 倾向**：**先冻结为单层 fallback**，并要求 audit + stream event。
- **Reasoning**：当前仓库没有多 provider chain policy 的 durable truth，也没有足够 metadata 支撑复杂路由。推荐路线更稳，因为它先把“requested/effective 不同”这件事做成可见事实，而不是急着做策略引擎。如果不拍板，HP2 很可能演变成 hero-to-platform 级别的 routing 设计。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 单层是否真能覆盖 80% 的实际场景(provider 间断、model deprecate)?(2) "可见性 + audit"是单层 vs 多层共有的需求,这部分能否提前冻结?(3) 未来扩链式时,单层 schema 是否需推倒重做?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("先单层 + audit + stream event")正确且务实。多层链式需要 metadata(provider list / weight / health)与 policy engine,两者当前 nano-agent 都没有。强行做多层只会让 fallback 看起来支持"链",实际上每一层逻辑都是 stub。先做单层并把"requested/effective 可见"做成稳定事实,比假装支持多层更有产品价值。
- **Opus的最终回答**：
  - 同意单层。建议 D1 audit 列设计为 `requested_model_id / effective_model_id / fallback_reason`(三列独立),未来扩 chain 时只需新增 `fallback_chain_json` 列即可,不必改造现有列语义。`model.fallback` stream event payload 也用同样 shape,client 后续兼容性好。

- **问题**：`是否确认 HP2 的 fallback 先采用单层模式，而不引入链式 fallback / 多 provider routing？`
- **业主回答**：确认。先冻结单层 fallback + audit + stream event。采纳 Opus 补充：D1 audit 列设计为 `requested_model_id / effective_model_id / fallback_reason` 三列独立，未来扩 chain 时只需新增 `fallback_chain_json` 列，不改造现有列语义。`approved`

### Q9 — `<model_switch>` developer message 是否在 HP2 就冻结语义？（来源：`docs/design/hero-to-pro/HP2-model-state-machine.md` `HP2-D3`）

- **影响范围**：HP2 model state、HP3 compact、LLM request assembly
- **为什么必须确认**：如果不拍板，HP3 的 compact/strip/recover 没有稳定控制片段可对接，两个 phase 会互相等待。
- **当前建议 / 倾向**：**在 HP2 就冻结**，HP3 只消费这份语义。
- **Reasoning**：模型切换语义一旦拖到 HP3 再讨论，会让 compact 和 model control 互相绑死。推荐路线更稳，因为它先把“切模型时给 LLM 什么信号”固定下来，HP3 只负责保存和恢复，不再重新定义协议。如果不拍板，后续 prompt 组装会再次漂移。

- **Opus的对问题的分解**：
  - 三个子问题:(1) HP2 冻结是否会让 HP3 compact 设计被迫 retrofit(还是天然契合)?(2) `<model_switch>` 是否会与 reasoning effort 切换的语义边界冲突?(3) 仅 model id 变化与仅 reasoning 变化要不要分别 inject?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("HP2 冻结、HP3 只 strip/recover")正确。模型切换语义本来就是 model state machine 的一部分,放 HP3 反而会让 compact 与 model 互相绑死(HP2 等 HP3 决定 message 格式,HP3 等 HP2 决定切换语义)。HP2 冻结后,HP3 只需消费一个稳定的 contract,strip-then-recover 的算法边界自然清晰。
- **Opus的最终回答**：
  - 同意 HP2 冻结。明确补充:仅 reasoning effort 变化不注入 `<model_switch>`(否则 LLM 会被频繁 effort tweak 噪声打扰),但 effort 必须独立 audit。这条规则建议在 HP2 设计稿 7.2 节 F4 显式写入,避免 HP3 实施时再争论。

- **问题**：`是否确认 <model_switch> 的 developer message contract 在 HP2 就冻结，HP3 只负责 strip / recover，不再重定义？`
- **业主回答**：确认。HP2 冻结语义，HP3 只 strip/recover。采纳 Opus 补充：仅 reasoning effort 变化不注入 `<model_switch>`（避免噪声），但 effort 必须独立 audit。此规则在 HP2 设计稿 F4 中显式写入。`approved`

### Q10 — context prompt owner 是否放在 agent-core runtime，而不是 context-core？（来源：`docs/design/hero-to-pro/HP3-context-state-machine.md` `HP3-D1`）

- **影响范围**：HP3 runtime latency、context-core 职责、future prompt assembly
- **为什么必须确认**：如果不拍板，context-core 与 agent-core 都可能各自长出一份 prompt owner，最终出现两套 context truth。
- **当前建议 / 倾向**：**放在 agent-core runtime**；context-core 负责 inspection / control plane。
- **Reasoning**：prompt 组装是 LLM call 主线的一部分，离 runtime 越近越能保证一致性和性能。推荐路线更稳，因为它把 context-core 限定在 probe/preview/job 这类 inspection 面，而不是每次远程参与 prompt 构造。如果不拍板，后续很容易出现 probe 看见一套 truth、真实 prompt 又是另一套 truth。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 跨 worker RPC 组 prompt 的 latency 是否真的不可接受(数量级)?(2) context-core 限定为 inspection 是否会被未来 multi-session 共享 context 推翻?(3) probe/preview 看到的 truth 与真实 prompt 如何保证一致?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("放 agent-core,context-core 做 inspection")是当下最稳的。每次 LLM call 跨 worker 拉 prompt 在 Cloudflare Workers 模型下意味着至少一次额外 Service Binding RPC + serialization,在长上下文 / 高频 turn 场景会显著放大尾延迟。更关键的是 — 把 prompt owner 放在 context-core 会让 agent-core runtime 失去对 prompt 真相的直接控制权,debug/replay 都要跨 worker 取数据。
- **Opus的最终回答**：
  - 同意放 agent-core。补关键约束:context-core 的 probe API 与 agent-core CrossTurnContextManager 必须共享同一份 layer-ordering 协议契约(以 nacp-session 类型作为 SSoT),禁止两边各写一套 layer 顺序逻辑。一致性靠"共同消费 nacp 类型"而非"两边独立实现",这样 inspection 与真实 prompt 才不会漂移。

- **问题**：`是否确认 HP3 的 context prompt owner 放在 agent-core runtime，context-core 只承担 inspection / control plane？`
- **业主回答**：确认。放 agent-core runtime，context-core 只做 inspection/control plane。采纳 Opus 关键约束：context-core 的 probe API 与 agent-core CrossTurnContextManager 必须共享同一份 layer-ordering 协议契约（以 nacp-session 类型为 SSoT），禁止两边各写一套 layer 顺序逻辑。`approved`

### Q11 — compact 是否必须保护 `<model_switch>` / `<state_snapshot>`，而不是直接摘要所有内容？（来源：`docs/design/hero-to-pro/HP3-context-state-machine.md` `HP3-D2`）

- **影响范围**：HP3 compact correctness、HP2 model switch、future restore
- **为什么必须确认**：如果不拍板，compact 很容易把控制片段和普通对话混在一起压缩，后续语义丢失且难以调试。
- **当前建议 / 倾向**：**必须保护**，采用 strip-then-recover。
- **Reasoning**：控制片段不是给摘要模型读完就算，而是后续 prompt 仍要依赖它们维持状态机语义。推荐路线更稳，因为它把“可摘要正文”和“不可丢控制语义”明确分层。如果不拍板，compact 虽然看起来节省 tokens，但会让模型切换、state snapshot、恢复逻辑一起失真。

- **Opus的对问题的分解**：
  - 三个子问题:(1) strip-then-recover 在何时执行(摘要前 strip,摘要后 recover,还是两者在同一原子操作内)?(2) 是否要保护除了 `<model_switch>` 与 `<state_snapshot>` 之外的其他控制片段?(3) recover 顺序如何稳定(原序复原还是按 boundary metadata 重组)?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("必须保护 + 采用 strip-then-recover")正确。控制片段在语义上不属于"对话内容",而属于"runtime 状态信号";让 LLM 把它们当文本压缩,等同于用 summary 摘要去理解一个 prompt 模板 — 结果是状态切换语义直接湮灭。Codex 已经有 `<model_switch>` strip/recover 的 contract precedent,nano-agent 没有理由重新发明。
- **Opus的最终回答**：
  - 同意必须 strip-then-recover。建议 HP3 设计中显式列出"受保护片段 enum"(初版 = `<model_switch>`, `<state_snapshot>`),后续扩张走 HPX 治理(与 HP5 confirmation kind freeze 同套规则)。recover 顺序按"原 prompt 中的相对位置 + boundary metadata 配对"双约束,避免 recover 顺序漂移导致 LLM 误读。

- **问题**：`是否确认 HP3 的 compact 必须对 <model_switch> / <state_snapshot> 执行 strip-then-recover，而不能直接把它们并入摘要正文？`
- **业主回答**：确认。必须 strip-then-recover。采纳 Opus 补充：HP3 设计显式列出受保护片段 enum（初版 = `<model_switch>`, `<state_snapshot>`），后续扩张走 HPX 治理；recover 顺序按原 prompt 相对位置 + boundary metadata 配对双约束。`approved`

### Q12 — manual compact 是否需要 preview 与 durable job 分离？（来源：`docs/design/hero-to-pro/HP3-context-state-machine.md` `HP3-D3`）

- **影响范围**：HP3 context APIs、clients、ops/debug
- **为什么必须确认**：如果不拍板，manual compact 可能变成一次看不见的后台动作，客户端既无法预演，也没有 durable 记录可追。
- **当前建议 / 倾向**：**需要分离**；preview 只读，compact 才创建 job。
- **Reasoning**：preview 和真正执行不是一个抽象层次：前者是解释，后者是状态变更。推荐路线更稳，因为它让用户和运维都能先知道“会发生什么”，同时保留一次真实 compact 的 durable 审计。如果不拍板，HP3 很容易把 manual compact 设计成黑盒 endpoint。

- **Opus的对问题的分解**：
  - 三个子问题:(1) preview 不写 summary 是否真的安全(成本/语义,会不会让 client 反复 preview 造成 LLM call 浪费)?(2) job durable handle 的最小 schema 是什么(HP3 设计已选择复用 `compact_boundary` checkpoint UUID)?(3) 是否要支持 preview 后立即转 commit 的快路径,避免重复计算?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("分离 preview 与 job")正确。preview 只读 = 解释,job = 状态变更,两者抽象层根本不同。HP3 进一步的设计选择(job_id 复用 compact_boundary checkpoint UUID)很巧妙 — 它把 compact 结果固化到 HP1 已有的 checkpoint truth 上,既避免新建 `nano_compact_jobs` 表破坏 DDL Freeze,又保证 `/compact/jobs/{id}` 在 worker 重启后仍可读。
- **Opus的最终回答**：
  - 同意分离。建议 preview 返回结果中包含 `would_create_job_template`(可作为下一步 commit 的 idempotency hint),client 不必重复计算"会折叠哪些 turn"。preview 本身建议加 in-memory cache(同一 session + 同一 high-watermark 的 preview 在 60s 内复用结果),降低反复 preview 的 LLM 成本。

- **问题**：`是否确认 HP3 的 manual compact 必须区分 preview 与 durable job，两者不能合并成单一步骤？`
- **业主回答**：确认。preview 只读 + durable job 分离。采纳 Opus 补充：preview 返回含 `would_create_job_template` 作为 idempotency hint；同 session + 同 high-watermark 的 preview 在 60s 内复用 in-memory cache，降低反复 preview 的 LLM 成本。`approved`

---

## 3. Chat 生命周期 / Confirmation Control Plane

### Q13 — close 是否引入新 session 状态？（来源：`docs/design/hero-to-pro/HP4-chat-lifecycle.md` `HP4-D1`）

- **影响范围**：HP4 read models、clients、lifecycle semantics
- **为什么必须确认**：如果不拍板，close 很可能被实现成又一个新状态，进一步拉宽 lifecycle 词汇表，增加客户端判断负担。
- **当前建议 / 倾向**：**不引入新状态**；继续用 `ended + completed`。
- **Reasoning**：close 的本质是一个动作，不一定需要新的生命周期枚举。推荐路线更稳，因为它保留现有状态集，把“如何结束”表达成 action/result，而不是再发明一个新状态。若不拍板，后面 delete、retry、restore 也会开始各自长状态词。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 现有 `ended + completed` 二元组是否真足够表达"主动 close"vs"自然 ended";(2) 客户端是否需要区分 close 与 cancel(否则两条 action 看起来终态一样);(3) 第三方 reason(close_by_user, error, system_timeout) 应该放哪。
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("不新增、复用 ended + completed")正确。close 是 action 不是 state — 在 nano-agent 当前 6 状态(`pending|starting|active|detached|ended|expired`)已经被全仓 switch case 引用的前提下,新增 `closed` 会强制每个 read model / scheduler / restore 路径都补一个分支,边际成本远高于 reason 列。
- **Opus的最终回答**：
  - 同意不新增。建议在 session 终态行写入 `ended_reason` 列(初版 enum: `completed | cancelled | error | closed_by_user | timeout`),把"close"作为一种 reason 表达,而不是状态机的新维度。这条列建议进 HP1 008 migration(session/turn audit 那张),避免 HP4 单独再补 migration。

- **问题**：`是否确认 session close 不新增 lifecycle state，而继续沿用 ended + completed 语义？`
- **业主回答**：确认。不新增状态，以 `ended_reason` 列（enum: `completed | cancelled | error | closed_by_user | timeout`）表达终止原因。采纳 Opus 补充：此列进入 HP1 008 migration，避免 HP4 单独补 migration。`approved`

### Q14 — delete 应落在 session 还是 conversation 维度？（来源：`docs/design/hero-to-pro/HP4-chat-lifecycle.md` `HP4-D2`）

- **影响范围**：HP4 clients、D1 tombstone、conversation view
- **为什么必须确认**：如果不拍板，delete 的 durable owner 不清楚，后面 title、conversation detail、checkpoint registry 都会受影响。
- **当前建议 / 倾向**：**落在 conversation 维度**，采用 soft tombstone。
- **Reasoning**：当前 D1 真相里 `nano_conversations` 已经是 title 与会话聚合 owner，把 delete 放在 conversation 更符合数据模型。推荐路线更稳，因为它避免 session 与 conversation 两层都各自定义 delete 语义。若不拍板，客户端很难知道“删掉的是单个执行会话，还是整段对话”。

- **Opus的对问题的分解**：
  - 三个子问题:(1) session-level delete 是否有合法用例(比如"删掉这次失败的 attempt"),还是用户根本不会想删单个 session?(2) tombstone 是否会让 audit 查询变复杂(每个 query 都要 join `deleted_at IS NULL`)?(3) restore/undelete 是否需要支持产品面?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("conversation soft tombstone")正确。用户心智模型是"删整段对话",且 `nano_conversations.title` 已经存在 — conversation 已经是 title 与会话聚合的天然 owner。session-level delete 既不符合用户心智,也会让 conversation detail 视图出现"对话还在但里面 session 缺失"的怪异状态。
- **Opus的最终回答**：
  - 同意 conversation soft tombstone。建议 HP4 第一版**不**暴露 undelete 产品面(避免误删工作流复杂化)。但要注意 hero-to-pro 当前 freeze 里只包含 `nano_conversations.deleted_at`; owner/support 若要做误删恢复,走数据修复 / 运维流程即可,不在本轮 DDL 中追加 `deleted_by_user_uuid` 之类新列。

- **问题**：`是否确认 HP4 的 delete 语义落在 conversation 维度，采用 conversation soft tombstone，而不是 session 级 delete？`
- **业主回答**：确认。conversation soft tombstone 以当前 charter freeze 为准：hero-to-pro 只冻结 `nano_conversations.deleted_at`，第一版不暴露 undelete 产品面；误删恢复走 owner/support 的数据修复流程，不在本轮 DDL 中追加 `deleted_by_user_uuid`。`approved`

### Q15 — checkpoint/restore 是否继续复用 DO latest checkpoint？（来源：`docs/design/hero-to-pro/HP4-chat-lifecycle.md` `HP4-D3`）

- **影响范围**：HP4 checkpoint registry、restore API、clients、support/debug
- **为什么必须确认**：如果不拍板，执行者可能偷用现有 DO latest checkpoint seam 充当产品面，导致 registry/diff/restore job 不成立。
- **当前建议 / 倾向**：**不复用**；必须新增 checkpoint registry + restore job。
- **Reasoning**：DO latest checkpoint 更像内部恢复机制，不是用户可见的 checkpoint 产品面。推荐路线更稳，因为它把“运行时为了自救存的一份状态”和“用户/客户端可管理的 checkpoint 资产”明确区分。如果不拍板，HP4 表面上做了 restore，实际上仍然没有真正的 checkpoint 产品语义。

- **Opus的对问题的分解**：
  - 三个子问题:(1) DO latest checkpoint 真的不能多版本化吗(给 latest 加个时间戳就行?)?(2) 新增 D1 registry 与 DO seam 的双写一致性如何保证(任一侧失败如何回滚)?(3) restore 时 D1 与 DO 的 source of truth 如何分工?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("不复用,新增 registry + restore job")完全正确。DO latest checkpoint 是 hibernation seam — 它的设计目标是"worker 重启后拼回 runtime state",不是"用户列出和 restore 任意历史锚点"。即使硬给 latest 加时间戳,也仍然没有 list/diff/TTL/fork 这些产品语义,且会让 hibernation 机制承担与产品 semantics 完全不同的访问模式。
- **Opus的最终回答**：
  - 同意不复用。建议明确 restore 流程的 source-of-truth 顺序:`D1 checkpoint registry` → `D1 message ledger` → `DO snapshot`。DO 失败后必须以 D1 truth 重建,不允许把 DO 当主源 — 这条规则要在 HP7 设计稿 7.2 节 F3 显式写入,避免实施期出现"以 DO 为权威"的反模式。

- **问题**：`是否确认 HP4 的产品级 checkpoint / restore 不得直接复用 DO latest checkpoint，而必须建立独立 registry + restore job？`
- **业主回答**：确认。不复用 DO latest checkpoint，建立独立 registry + restore job。采纳 Opus 关键约束：restore 流程 source-of-truth 顺序为 `D1 checkpoint registry → D1 message ledger → DO snapshot`，DO 失败后必须以 D1 truth 重建，不允许把 DO 当主源。此规则在 HP7 设计稿 F3 中显式写入。`approved`

### Q16 — confirmation 是否继续按业务各自一套路由，还是统一 control plane？（来源：`docs/design/hero-to-pro/HP5-confirmation-control-plane.md` `HP5-D1`）

- **影响范围**：HP5、HP3/HP4/HP6/HP7、future human-in-the-loop flows
- **为什么必须确认**：如果不拍板，各 phase 会继续各自发明 permission、restore、cleanup、cancel 的确认路径，协议面再次碎裂。
- **当前建议 / 倾向**：**统一 control plane**。
- **Reasoning**：这题不是“要不要抽象得更漂亮”，而是多个 phase 是否共享一套用户确认骨架。推荐路线更稳，因为它让 row、stream、decision handler、pending state 只维护一套真相。如果不拍板，越往后 phase 越多，确认路径越难统一。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 兼容旧 endpoint 的窗口期多长(永久 alias 还是有 deprecate 节奏)?(2) 统一面是否会让 simple permission 路径多走 RTT(从 1 个 endpoint 变成 row-write + endpoint)?(3) registry 与 DO storage 双写如何守原子性,失败如何处理?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("统一 control plane + 兼容旧 endpoint")正确。permission/elicitation/restore/cleanup/cancel 各自一套会让协议碎裂、客户端 pending list 永远不全,后续 phase 越多越乱。统一面的成本主要在 HP5 实施期,但收益持续到 HP10 — 这是典型的"前置投入换长期治理"决策。
- **Opus的最终回答**：
  - 同意统一。建议双写顺序冻结为"先 confirmation row → 后 DO storage primitive(`emitPermissionRequestAndAwait` etc.)"。若第二步失败,不要新增 `failed` status 破坏 charter enum,也不要留下 phantom pending;应立即把该 row 回写到现有 schema 可表达的失效终态(推荐 `superseded`),并把失败细节写入 `decision_payload_json` 与 audit/error log。兼容旧 endpoint 的 deprecate 节奏建议 HP10 final closure 时再决定(届时已知 client 切换进度),不在 HP5 提前冻结。

- **问题**：`是否确认 HP5 把 permission / elicitation / restore / cleanup / cancel 等确认行为统一收敛到单一 confirmation control plane？`
- **业主回答**：确认。统一 control plane + 保留旧 endpoint 兼容。采纳修正后的双写顺序：先写 confirmation row → 后写 DO storage primitive；若第二步失败，不新增 `failed` status，也不留下 phantom pending，而是把该 row 回写到现有 schema 可表达的失效终态（本轮冻结采用 `superseded`），并把失败细节写入 `decision_payload_json` + audit/error log。旧 endpoint deprecate 节奏延至 HP10 决定。`approved`

### Q17 — kernel wait reason 是否统一为 `confirmation_pending`，而不是继续扩张多个 pending enum？（来源：`docs/design/hero-to-pro/HP5-confirmation-control-plane.md` `HP5-D2`）

- **影响范围**：HP5 kernel interrupt、scheduler、future restore / cleanup flows
- **为什么必须确认**：如果不拍板，每增加一种确认类流程，就会往 kernel enum 里再塞一个 pending reason，最终难以维护。
- **当前建议 / 倾向**：**统一为 `confirmation_pending`**，具体 kind 放在 confirmation 记录里。
- **Reasoning**：kernel 需要的是一个统一的“在等用户确认”语义，而不是把所有业务原因都硬编码进调度层。推荐路线更稳，因为它让 wait reason 保持抽象稳定，而把业务差异放到 confirmation row / kind 中表达。如果不拍板，后面每个 phase 都可能要求再加一个 enum。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 把现有 `approval_pending` 直接迁移是否破坏现有 restore 路径?(2) "kind 放 row 而非 enum"如何确保 scheduler 仍能高效调度(比如按 kind 优先级 wake)?(3) 统一是否削弱 observability/诊断信号(从 enum 名字一眼看出原因)?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("统一为 confirmation_pending")正确。kernel 关心的是"agent loop 在等用户决策",不需要知道业务 kind — kind 是 control plane 的 metadata,不是 scheduler 的 dispatch key。`approval_pending` → `confirmation_pending` 迁移本身比让 enum 持续膨胀(`elicitation_pending`、`restore_pending`、...)代价小得多。
- **Opus的最终回答**：
  - 同意统一。建议同时把 `confirmation_kind` 作为 wait reason 的 metadata 字段(不进 enum),在 observability/log/replay 层仍可读到 kind 信息。诊断不靠 enum 名字而靠 metadata,这是更稳健的层次切分。

- **问题**：`是否确认 kernel wait reason 在 HP5 统一为 confirmation_pending，而不继续拆出多个业务专用 pending enum？`
- **业主回答**：确认。统一 `confirmation_pending`，kind 作为 metadata（不进 enum），在 observability/log/replay 层仍可读 kind 信息。`approved`

### Q18 — 第一版 confirmation kind 是否要先冻结？（来源：`docs/design/hero-to-pro/HP5-confirmation-control-plane.md` `HP5-D3`）

- **影响范围**：HP5+ 全部后续 phase、API、stream、review/closure
- **为什么必须确认**：如果不拍板，后续 phase 很可能在实现时继续临时加 kind，导致 `/confirmations` 失去统一法则。
- **当前建议 / 倾向**：**先冻结第一版 7 kind**。
- **Reasoning**：kind enum 不是实现小细节，而是整个 control plane 的产品边界。推荐路线更稳，因为它先把第一版必须覆盖的风险动作定住，后面扩张必须进 QNA，而不是在代码里悄悄变多。如果不拍板，HP5 只能得到一个名义统一、实则任意扩展的 confirmation 面。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 7 个 kind(`tool_permission/elicitation/model_switch/context_compact/fallback_model/checkpoint_restore/context_loss`)是否真覆盖 HP3-HP7 的所有 confirmation 需求?(2) 后续 kind 扩张走 HPX 是否过重(每加一个就要 owner 拍板)?(3) 是否需要预留 `custom` kind 作为 escape hatch?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("冻结 7 kind + 扩张走 HPX")完全正确。kind enum 是 confirmation control plane 的产品边界,不是实现细节。如果允许实施期临时扩张,/confirmations API 会很快退化成"名义统一、实则任意 kind",失去单一法则。HP6 设计稿已经在 F5 明确反对 `conversation_delete/workspace_cleanup/tool_cancel` 临时扩 enum,这是与 HP5 一致的纪律。
- **Opus的最终回答**：
  - 同意冻结 7 kind。**强烈反对**预留 `custom` 作为 escape hatch — escape hatch 在工程实践中会立刻被滥用,所有难定的 confirmation 都会落到 `custom`。后续扩张必须进 HPX-qna 并修 charter,这条治理纪律不能让步。

- **问题**：`是否确认 HP5 先冻结第一版 7 个 confirmation kind，后续新增 kind 必须回到 HPX-qna 再拍板？`
- **业主回答**：确认。第一版冻结 7 kind，后续扩张必须进 HPX-qna。**不预留 `custom` escape hatch**（会被滥用）。kind 集合以 charter §7.2 的 DDL schema 定义为权威（`tool_permission/elicitation/model_switch/context_compact/fallback_model/checkpoint_restore/context_loss`），HP5 设计文档 F5 中不一致的 kind 列表必须在 action-plan 制作前修正为与 charter 一致。`approved`

---

## 4. Tool / Workspace / Checkpoint

### Q19 — workspace temp file 对外是否使用 UUID，而不是路径？（来源：`docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md` `HP6-D1`）

- **影响范围**：HP6 clients、workspace CRUD、HP7 file diff / restore
- **为什么必须确认**：如果不拍板，workspace file API 会在“像 artifact 一样按 UUID 取”与“像工作目录一样按路径取”之间摇摆。
- **当前建议 / 倾向**：**不使用 UUID 作为产品主键**；对外以 `virtual_path` 为主。
- **Reasoning**：artifact 是产物下载对象，workspace file 是工作态状态，两者的产品心智不同。推荐路线更稳，因为路径天然对应 session 内的工作目录结构，也更符合 diff、restore、promotion 的连续性。如果不拍板，客户端很快会遇到“用户眼里是一个文件，系统却要先查 UUID”的使用断裂。

- **Opus的对问题的分解**：
  - 三个子问题:(1) UUID 是否更利于 dedup / rename / move 等高级操作?(2) virtual_path 的 normalization(拒绝 `..`、绝对路径、反斜杠混淆)防御是否足够稳?(3) HP7 file snapshot 是否需要某种 stable id 来引用文件历史版本?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("virtual_path 为产品主键")正确。用户与 LLM 都按路径思考(写作 `read_file("notes.md")` 而不是 `read_file("uuid:abc-123")`),UUID 强迫两端都要做映射。artifact 是产物下载对象、workspace file 是工作态状态,两者心智模型不同 — virtual_path 正好对应工作目录的连续性。
- **Opus的最终回答**：
  - 同意 virtual_path 为产品主键。但建议 D1 列同时保留 `temp_file_uuid` 作为 HP7 file snapshot 的 immutable 引用源(HP6 设计稿其实已经包含这一列):"产品主键是路径,内部稳定 id 是 UUID,两者并存不冲突"。snapshot 引用走 UUID(避免 path rename 后 snapshot 失真),用户面 API 走 path。这是 HP6→HP7 衔接的关键细节。

- **问题**：`是否确认 HP6 的 workspace temp file 对外以 virtual_path 作为产品主键，而不是 UUID？`
- **业主回答**：确认。产品主键 = `virtual_path`，内部稳定 ID = `temp_file_uuid`（用于 HP7 snapshot 不可变引用）。两者并存不冲突，用户面 API 走 path，snapshot 引用走 UUID。`approved`

### Q20 — workspace promote 是 alias 现有对象，还是复制成独立 artifact？（来源：`docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md` `HP6-D2`）

- **影响范围**：HP6 promotion、cleanup、HP7 restore / lineage
- **为什么必须确认**：如果不拍板，workspace cleanup 与 artifact 生命周期可能互相踩踏，正式产物会受临时文件 TTL 影响。
- **当前建议 / 倾向**：**复制成独立 artifact**。
- **Reasoning**：workspace object 的设计前提就是可清理、可过期、可被覆盖；artifact 则需要稳定持久。推荐路线更稳，因为它从一开始就把“工作副本”和“正式产物”分成两条生命周期。如果不拍板，后面无论 cleanup 还是 provenance 都会出现歧义。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 复制成本是否影响大文件场景(几 GB 的 artifact 怎么办)?(2) 引用计数 + R2 dedupe 是否值得在 HP6 第一版做?(3) artifact 的不可变性是否真要锁死(promote 后允许覆盖吗)?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("复制成独立 artifact")正确。temp file 与 artifact 的 lifecycle 在设计上根本不同:temp 自带 TTL + cleanup,artifact 需要稳定下载与长期引用。共享 R2 key 必然导致两种事故 — 要么 cleanup 误删 promoted artifact,要么 artifact 被工作区随后改写。当前 nano-agent 没有 R2 dedupe / reference counting 机制,提前优化这条会破坏 lifecycle 隔离。
- **Opus的最终回答**：
  - 同意复制。建议 HP6 设计稿 7.2 节 F4 显式声明"未来若引入 R2 dedupe,必须以新 phase 重评本决策",避免实施期 owner 看到大文件成本时临时改 alias。同时建议 promotion API 第一版**禁止**重复 promote 同一 path 覆盖原 artifact — 改成生成新 `file_uuid` 但保留旧 artifact(HP6 设计已经这样冻结)。

- **问题**：`是否确认 HP6 的 workspace -> artifact promotion 必须复制成独立 artifact，而不是 alias 同一个底层对象？`
- **业主回答**：确认。复制成独立 artifact。采纳 Opus 补充：第一版禁止重复 promote 同一 path 覆盖原 artifact（生成新 `file_uuid` 保留旧 artifact）；未来若引入 R2 dedupe 必须以新 phase 重评本决策。`approved`

### Q21 — tool cancel 是否要进入统一可观察状态，而不是只做下游内部动作？（来源：`docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md` `HP6-D3`）

- **影响范围**：HP6 tool state、client debug、future support surface
- **为什么必须确认**：如果不拍板，用户和调试面只能看到“工具怎么突然没了”，看不到 terminal state 与 cancel 结果。
- **当前建议 / 倾向**：**要进入统一可观察状态**，包含 terminal state + stream event。
- **Reasoning**：cancel 不是纯内部实现动作，它会改变用户对当前 turn 的理解。推荐路线更稳，因为它把 cancel 从“隐藏的 transport side effect”提升成产品事实，后续 debug、audit、replay 都有据可查。如果不拍板，HP6 虽然实现了 cancel，客户端仍然像没实现一样。

- **Opus的对问题的分解**：
  - 三个子问题:(1) cancel 终态与 error 终态如何在 D1 message ledger 中区分(同样是 `tool.call.result` 还是新增 row)?(2) `tool.call.cancelled` stream event 的 schema 是否与现有 `tool.call.result` 兼容?(3) cancel 与 confirmation 是否要绑定(先确认再 cancel,还是直接 cancel)?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("必须有 terminal state + stream event")正确。cancel 不是 transport side effect,是产品事实 — 用户/support/replay 都需要知道"这个 tool 是被取消还是失败了"。如果只在 bash-core 内部 cancel 完事,客户端永远看到 inflight 不更新,UI 就只能加超时假象。
- **Opus的最终回答**：
  - 同意。建议 `tool.call.cancelled` event 必须区分 `cancel_initiator`(`user | system | parent_cancel`),便于诊断"为什么这个 tool 被取消"。第一版**不**要求 cancel 走 confirmation(避免每次取消都弹确认)。若未来业务确实要求"cancel 前也要确认",必须作为新增 kind 回到 HPX-qna + charter 修订后再启用,当前 freeze 不预留 `tool_cancel` kind。

- **问题**：`是否确认 HP6 的 tool cancel 必须有可查询 terminal state 与 stream event，而不是只在下游内部完成？`
- **业主回答**：确认。必须有 terminal state + `tool.call.cancelled` stream event，event payload 含 `cancel_initiator`（`user | system | parent_cancel`）。第一版不要求 cancel 走 confirmation；若未来要把 cancel 纳入 confirmation，必须先回到 HPX-qna 并同步修 charter，当前 freeze 不预留 `tool_cancel` kind。`approved`

### Q22 — file snapshot 是 eager 还是 lazy 物化？（来源：`docs/design/hero-to-pro/HP7-checkpoint-revert.md` `HP7-D1`）

- **影响范围**：HP7 cost、cron、checkpoint UX
- **为什么必须确认**：如果不拍板，执行者可能默认 turn-end 就全量复制文件，成本和 cleanup 压力会被迅速放大。
- **当前建议 / 倾向**：**lazy 物化**。
- **Reasoning**：当前 checkpoint 体系首先要解决的是“有产品级锚点”，不是“每次 turn 都复制完整文件系统”。推荐路线更稳，因为它把重成本 snapshot 留到真正需要的场景，再由 registry / status 跟踪物化过程。如果不拍板，HP7 很容易在 first wave 就引入不可控存储成本。

- **Opus的对问题的分解**：
  - 三个子问题:(1) lazy 是否会让 first-time restore 体验明显变差(必须等 materialization)?(2) eager 的 R2 成本上限大概是多少(每 turn 多少 MB × 多少 turn)?(3) lazy materialization 失败时如何提示用户(加重试还是直接 surface error)?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("lazy materialization")完全正确。多数 turn-end checkpoint 不会被 restore — 这是 checkpoint 系统的客观规律。如果每个 turn 都 eager 复制 workspace 全量文件,成本会以 `turn 数 × workspace 大小` 累乘,且大多数复制是浪费。lazy 只在 user-named checkpoint / restore / fork 真触发时物化,与实际 usage pattern 匹配。
- **Opus的最终回答**：
  - 同意 lazy。建议 user-named checkpoint(用户主动 `POST /checkpoints`)采用"尽量 eager,失败转 pending"策略:用户主动命名意味着大概率会 restore,提前物化能降低后续 restore 等待。turn-end auto checkpoint 严格 lazy。这种"按 checkpoint kind 分级"的策略比一刀切 lazy 在 UX 上更平衡。

- **问题**：`是否确认 HP7 的 file snapshot 采用 lazy materialization，而不是 turn-end eager copy 全量文件？`
- **业主回答**：确认。lazy 为 baseline。采纳 Opus 分级策略：user-named checkpoint（用户主动 `POST /checkpoints`）尽量 eager（失败转 pending），turn-end auto checkpoint 严格 lazy。`approved`

### Q23 — fork 是不是新 conversation？（来源：`docs/design/hero-to-pro/HP7-checkpoint-revert.md` `HP7-D2`）

- **影响范围**：HP7 clients、lineage、conversation/session domain
- **为什么必须确认**：如果不拍板，fork 的 lineage 归属会不清晰，后续 conversation view 与 session view 都会混乱。
- **当前建议 / 倾向**：**不是新 conversation**；是同 conversation 下的新 session。
- **Reasoning**：当前 charter 已把 HP7 定位为 session fork，而不是把整段对话搬到新的 conversation 容器里。推荐路线更稳，因为它能保留同一对话脉络下的 lineage，同时又给 child session 充分隔离的 runtime 与文件空间。如果不拍板，fork 很容易与“另开新对话”混成一件事。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 同 conversation 多 session 在 conversation detail 视图如何展示(列表/树/分支)?(2) cross-conversation fork 是否真的不需要(场景:把当前对话 fork 到新对话独立演进)?(3) fork 后 parent session 是否仍可继续写消息?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("同 conversation 新 session")正确,与 charter 一致。这种 fork 保留同一对话脉络下的 lineage,且给 child session 充分隔离的 runtime 与 R2 namespace。cross-conversation fork 是更复杂的产品决策,涉及"复制还是引用 conversation truth"等问题,不适合在 HP7 第一版做。
- **Opus的最终回答**：
  - 同意。建议 conversation detail 视图设计第一版直接展示 session 树/列表(parent/child lineage),提前暴露多 session 形态,避免后续 client 在 fork 上线后反向施压改 D1 schema。parent session 是否能继续写消息建议第一版**允许**(parent/child 完全独立),但 fork 创建瞬间应推一条 `session.fork.created` stream event 给 parent attached client,让 client UX 清楚分叉点。

- **问题**：`是否确认 HP7 的 fork 语义是“同 conversation 下创建一个新 session”，而不是新建 conversation？`
- **业主回答**：确认。同 conversation 新 session，parent/child 完全独立。采纳 Opus 补充：conversation detail 视图第一版展示 session 树/列表（parent/child lineage）；fork 创建时推送 `session.fork.created` stream event 给 parent attached client。`approved`

### Q24 — restore 失败后是否允许 best-effort 停留在部分成功状态？（来源：`docs/design/hero-to-pro/HP7-checkpoint-revert.md` `HP7-D3`）

- **影响范围**：HP7 restore reliability、support、checkpoint trustworthiness
- **为什么必须确认**：如果不拍板，执行时容易选择“能恢复多少算多少”，但这样会让 restore 结果变得不可预测。
- **当前建议 / 倾向**：**不允许**；必须有 rollback baseline。
- **Reasoning**：restore 的价值在于可预期，不在于尽量做一点。推荐路线更稳，因为它要求失败时明确回到已知基线，而不是把 conversation、files、runtime 各留一半在旧状态、一半在新状态。如果不拍板，checkpoint 很快就会失去可信度。

- **Opus的对问题的分解**：
  - 三个子问题:(1) rollback baseline 的成本是否会让每次 restore 翻倍 R2 复制?(2) `rolled_back` 状态是否真能回到原状态(D1 supersede 标记 + DO snapshot + R2 文件三处都要回)?(3) 是否所有失败都要 rollback,还是只针对关键步骤?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("禁止 partial,必须有 rollback baseline")正确。restore 的产品价值就是可预期 — 用户点 restore 后,期望的是"要么回到那个 checkpoint,要么完全没动"。partial 把 conversation 一半在新 / 一半在旧、files 一半在新 / 一半在旧,这种状态比根本不 restore 还危险(用户以为 restore 成功,实际数据混乱)。
- **Opus的最终回答**：
  - 同意禁止 partial。建议 rollback baseline checkpoint 的 R2 成本以 lazy 物化兜底:rollback baseline 大多用不上(restore 多数成功),materialize 仅在 restore 真触发且需要回滚时执行。这样把"安全"做成"按需付费"而不是"昂贵保险"。同时建议 `failed_reason` 列必须包含足够信息让 support/owner 复盘(具体哪一步失败、错误码),不只是 boolean failure。

- **问题**：`是否确认 HP7 的 restore 失败时必须回滚到已知 baseline，不允许以 best-effort partial success 作为合法终态？`
- **业主回答**：确认。禁止 partial success，必须有 rollback baseline。采纳 Opus 补充：rollback baseline 的 R2 成本以 lazy 物化兜底（大多用不上）；`failed_reason` 列必须包含足够信息（具体失败步骤 + 错误码）。`approved`

---

## 5. Runtime Hardening / Ops 治理

### Q25 — megafile gate 是否继续盯历史文件名？（来源：`docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md` `HP8-D1`）

- **影响范围**：HP8 CI、future split、repo cleanup
- **为什么必须确认**：如果不拍板，CI 可能继续盯着已经被拆空的历史文件名，真正高风险的大文件反而不受约束。
- **当前建议 / 倾向**：**不再盯历史文件名**；改盯当前真实 owner 文件。
- **Reasoning**：仓库 reality 已经变化，`nano-session-do.ts` / `user-do.ts` 更多只是 wrapper。推荐路线更稳，因为它让 gate 跟当前代码结构一致，真正能阻止问题继续扩大。如果不拍板，megafile gate 会沦为装饰性检查。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 当前 owner 文件清单(`orchestrator-core/src/index.ts`、`user-do-runtime.ts`、`session-do-runtime.ts`)是否会在 HP8 实施期间继续变化(若拆分还在进行,gate 阈值就是 moving target)?(2) budget 阈值如何设(stop-the-bleed 还是理想值)?(3) wrapper 文件如何排除(`nano-session-do.ts`/`user-do.ts` 已经只有 8-9 行)?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("改盯当前 owner 文件 + stop-the-bleed 阈值")完全正确。仓库 reality 已经变化 — 历史 megafile 名字已退化为 wrapper,继续盯它们只是装饰性 CI。stop-the-bleed 而非理想值的策略也对 — 一上来就用理想阈值会让 HP8 一落地全红,gate 失去信号。
- **Opus的最终回答**：
  - 同意。建议 budget 配置文件用 `scripts/megafile-budget.json` 而非硬编码 `.mjs`,owner enumeration 与 CI gate 逻辑分离。HP10 cleanup 调整阈值或 HP11+ 阶段升级 gate 时无需改 script 代码。同时建议 budget 配置中明确标 `kind: stop-the-bleed`,提醒 reviewer 这不是终极阈值。

- **问题**：`是否确认 HP8 的 megafile gate 只针对当前真实 owner 文件，而不再沿用历史 megafile 名称？`
- **业主回答**：确认。改盯当前真实 owner 文件 + stop-the-bleed 阈值。采纳 Opus 补充：budget 配置用 `scripts/megafile-budget.json`（非硬编码 .mjs），配置中标注 `kind: stop-the-bleed`。`approved`

### Q26 — tool catalog 应落在哪一层？（来源：`docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md` `HP8-D2`）

- **影响范围**：HP8 tool contract、agent-core、bash-core、future docs/SDK
- **为什么必须确认**：如果不拍板，catalog 可能落在任意一层，结果仍然会有 caller/callee 各自维护镜像定义。
- **当前建议 / 倾向**：**落在 `nacp-core`**。
- **Reasoning**：当前 canonical tool message schema 已经在 `nacp-core`，catalog 继续往更外层或更内层放都会制造第二个真相源。推荐路线更稳，因为它让 schema、description、binding owner 从第一天就是协议层资产。如果不拍板，HP8 做出来的 SSoT 仍可能只是“另一份定义文件”。

- **Opus的对问题的分解**：
  - 三个子问题:(1) `nacp-core` 是否会因此承担过多 dependency(把 capability owner 信息也吸进协议层是否越界)?(2) catalog 的 schema 与 description owner 如何分离(schema 是 contract,description 偏文档)?(3) drift guard 检查粒度多细(literal 级 vs 类型级)?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("落在 nacp-core")正确。canonical tool message schema 已经在 nacp-core,任何外层 catalog 都会立刻成为第二个 truth source。把 catalog 放在更靠近 caller(agent-core)或 callee(bash-core)的层都会让另一侧仍然要维护镜像类型。
- **Opus的最终回答**：
  - 同意落 nacp-core。建议 catalog 文件结构按 capability owner 分目录(`packages/nacp-core/src/tools/bash/`, `tools/filesystem/`, `tools/workspace/`),便于 HP6 workspace tool 与 HP8 hardening 并行扩展,且每个 capability owner 维护自己的 catalog entry,降低跨 phase 编辑冲突。

- **问题**：`是否确认 HP8 的 tool catalog 单一真相源落在 nacp-core，而由 agent-core / bash-core 向它收敛？`
- **业主回答**：确认。落 `nacp-core`。采纳 Opus 补充：catalog 按 capability owner 分目录（`tools/bash/`, `tools/filesystem/`, `tools/workspace/`），每个 owner 维护自己的 catalog entry。`approved`

### Q27 — envelope 收敛是否包括 internal RPC？（来源：`docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md` `HP8-D3`）

- **影响范围**：HP8 public API、worker RPC、auth/orchestrator contracts
- **为什么必须确认**：如果不拍板，cleanup 时很容易把 internal envelope 也一并删改，伤到 worker 内部 contract。
- **当前建议 / 倾向**：**不包括 internal RPC**；只要求 public surface 唯一 `FacadeEnvelope`。
- **Reasoning**：这题的关键是区分“对外 contract 清晰”和“内部 transport 仍有自己的 envelope 需求”。推荐路线更稳，因为它只清 public drift，不误伤 internal RPC 的 authority / trace 语义。如果不拍板，HP8 很可能把“收敛”做成过度清洗。

- **Opus的对问题的分解**：
  - 三个子问题:(1) public/internal 边界如何明确(orchestrator-core 是 public 但内部对其他 worker 的调用算 internal RPC)?(2) internal RPC 仍允许的 envelope profile 之间(Envelope vs AuthEnvelope)是否互通?(3) drift guard 如何识别哪些 route 是 public(避免误改 internal 或漏过 public)?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("只清 public,不动 internal")正确。public(client-facing HTTP)与 internal(worker-to-worker RPC)是两条不同 transport profile — 强行合并会让 internal RPC 失去 authority 与 trace 语义。HP8 的目标是公共契约清晰,不是 envelope 类型数量极小化。
- **Opus的最终回答**：
  - 同意只清 public。建议 HP8 给出明确的"public route enumeration"(以 `orchestrator-core/src/index.ts` 中所有 fetch handler 为权威列表),drift guard 以此 enum 为权威 scope,严防误清 internal RPC。enum 进 `scripts/check-envelope-drift.mjs` 配置文件,与 megafile budget 同套机制。

- **问题**：`是否确认 HP8 的 envelope 收敛只针对 public HTTP surface，internal RPC 继续允许 Envelope/AuthEnvelope 保留？`
- **业主回答**：确认。只清 public surface，internal RPC 保留。采纳 Opus 补充：HP8 给出明确 public route enumeration（以 `orchestrator-core/src/index.ts` 所有 fetch handler 为权威列表），drift guard 以此为准。`approved`

### Q28 — R28 / R29 / Lane E 是否允许 retained / handoff 作为合法终态？（来源：`docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md` `HP8-D4`）

- **影响范围**：HP8 closure、HP10 final closure、ops runbook、hero-to-platform handoff
- **为什么必须确认**：如果不拍板，执行时就会在“必须现场彻底修完”与“先写 explicit handoff”之间反复拉扯，closure 口径不稳定。
- **当前建议 / 倾向**：**允许** retained / handoff，但必须 explicit。
- **Reasoning**：这几类问题里有些天然带 deploy-only / owner-only / environment-only 特征，不一定都能在同一 phase 内代码上彻底解决。推荐路线更稳，因为它禁止 silent carryover，但接受“已写清 scope、reason、remove condition”的合法未闭合状态。如果不拍板，团队要么会假装问题消失，要么会被迫在错误的 phase 里过度追求完美。

- **Opus的对问题的分解**：
  - 三个子问题:(1) `retained-with-reason` 与 `handed-to-platform` 的边界如何画(retained 是仍在仓内但暂不动、handoff 是迁出到 hero-to-platform)?(2) "explicit"的最小信息(scope/reason/remove condition)是否要 schema 化?(3) retained 项是否需要设置 review cadence(避免永久挂起)?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("允许 retained/handoff,禁止 silent")务实且必要。R28(stack 分析)、R29(divergence 验证)、Lane E(host-local residue)各有不同的 chronic 特征 — 强行一刀切要求"代码级根治"会诱发伪 closure(团队为了 closure 而假装解决)。但允许 retained 的前提是 explicit,这条治理纪律不能让步。
- **Opus的最终回答**：
  - 同意允许 retained/handoff。建议 HP10 final closure 中所有 retained 项必须带 `next-review-date`(默认 = hero-to-platform charter 启动日),避免 retained 永久挂起。retained registry 的最小字段建议为 `(item, scope, reason, remove_condition, current_owner, next_review_date)`,这六个字段缺任一项视为 silent retained,等同 unresolved。

- **问题**：`是否确认 R28 / R29 / Lane E 这类 chronic issue 允许以 retained-with-reason 或 handed-to-platform 作为合法终态，但绝不允许 silent unresolved？`
- **业主回答**：确认。允许 retained/handoff 作为合法终态，禁止 silent unresolved。采纳 Opus 补充：HP10 final closure 中所有 retained 项带 `next-review-date`（默认 = hero-to-platform charter 启动日）；retained registry 最小字段为 `(item, scope, reason, remove_condition, current_owner, next_review_date)`，缺任一项视为 silent retained。`approved`

---

## 6. API 文档 / 手工证据 / Prod Baseline

### Q29 — api docs 应按 worker 模块切还是按产品 surface 切？（来源：`docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md` `HP9-D1`）

- **影响范围**：HP9 docs pack、clients、README 索引、长期可读性
- **为什么必须确认**：如果不拍板，文档库会继续沿着 worker 实现边界增长，前端和集成方仍然要自己拼产品面。
- **当前建议 / 倾向**：**按产品 surface 切**。
- **Reasoning**：当前 `session.md` 已经证明“按阶段堆功能”会把 models/context/files 混在一起。推荐路线更稳，因为它让文档结构服务于客户端使用，而不是服务于 worker 目录结构。如果不拍板，HP9 就算写到 18 份，仍可能延续 RHX2 的过载文档形态。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 18 份的拆分粒度是否合理(再细就太碎、再粗就退化成 RHX2)?(2) cross-link 维护成本是否上升(产品 surface 之间往往互相引用)?(3) README 索引能否承担导航责任?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("按产品 surface 切,11→18")正确。`session.md` 当前已经把 models / context / files 混装,继续追加只会更难用。worker 模块边界对 frontend / 集成方完全是无关信息(他们不关心哪个 worker handle 哪个 endpoint),按 surface 切才贴合 doc 真实消费方。
- **Opus的最终回答**：
  - 同意。建议每份新增 doc 在头部声明对应的"主要 worker / endpoint family"(作为 implementation reference),方便逆向查"实现在哪",避免按 surface 切之后失去到代码的导航。这相当于 doc 内部保留 worker map,但首屏组织按 surface — 两全其美。

- **问题**：`是否确认 HP9 的 clients/api-docs 按产品 surface 重组，而不是继续按 worker 模块边界组织？`
- **业主回答**：确认。按产品 surface 切（11→18 份）。采纳 Opus 补充：每份新增 doc 头部声明对应的主要 worker/endpoint family（作为 implementation reference），首屏组织按 surface，内部保留 worker map。`approved`

### Q30 — manual evidence 是否仍允许继续 defer？（来源：`docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md` `HP9-D2`）

- **影响范围**：HP9 / HP10 gate、manual evidence pack、closure legitimacy
- **为什么必须确认**：如果不拍板，manual evidence 很可能再次变成“下一阶段再补”，直接重演 zero-to-real 的历史缺口。
- **当前建议 / 倾向**：**不允许继续 defer**；它是 hard gate。
- **Reasoning**：HP9 的意义之一就是把“文档、手工证据、prod baseline”绑定成同一份 closure 资产。推荐路线更稳，因为它强制在当前阶段就把真实客户端使用证据拿齐，而不是继续凭想象放行。如果不拍板，HP10 final closure 的合法性会再次变弱。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 5 设备齐备的现实成本(owner 一人备齐还是协作)?(2) hard gate 是否会让 HP9 闭合时点延期(若设备就绪滞后)?(3) "not-applicable-with-reason" 是否会被滥用成"defer 的伪装"?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("hard gate,不允许 defer")正确。zero-to-real final closure 已经把 manual evidence 列为遗留 gap,实际证明了"defer 即永久 defer"。HP9 是 hero-to-pro 对外的真正交付门槛,如果再缺 manual evidence,整个阶段的 closure legitimacy 都会松动。
- **Opus的最终回答**：
  - 同意 hard gate。建议 owner 在 HP8 closure 前就开始准备设备矩阵(平行进行),不要等 HP9 启动才开始借设备/约真机时间,避免 HP9 成为单点延期。"not-applicable-with-reason" 只允许"产品边界不适用"(如 web 设备不适用 wechat 真机流程),不允许"暂时没设备"作为理由 — 这条要在 HP9 设计稿 7.2 节 F3 显式收紧。

- **问题**：`是否确认 manual evidence 在 HP9 是 hard gate，不允许再 defer 到下一阶段？`
- **业主回答**：确认。hard gate，不允许继续 defer。采纳 Opus 补充：owner 在 HP8 closure 前开始准备设备矩阵（平行进行），不等 HP9 启动；`not-applicable-with-reason` 只允许"产品边界不适用"，不允许"暂时没设备"。`approved`

### Q31 — prod schema baseline 是否可只依赖仓内 migrations？（来源：`docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md` `HP9-D3`）

- **影响范围**：HP9 prod baseline、ops、HP10 final closure
- **为什么必须确认**：如果不拍板，团队很容易拿本地 migrations 目录当作“prod 真实状态”，但这无法证明 remote/prod 没有 drift。
- **当前建议 / 倾向**：**不可以**；必须 remote/prod 校对。
- **Reasoning**：prod baseline 是 owner / ops 侧事实，不是仓库侧想象。推荐路线更稳，因为它要求真正跑 remote list / dump / diff，把“prod 当前到底是什么”写成文档证据。如果不拍板，HP9 只能得到一份本地视角的 schema 说明，不足以支撑封板。

- **Opus的对问题的分解**：
  - 三个子问题:(1) owner remote 访问是否稳定可执行(`wrangler d1 migrations list --remote` 是否可重复跑)?(2) 若 prod 不可读如何 fallback(blocked-by-owner-access 是否够)?(3) baseline 文档的 freshness 周期是什么(随每次 migration apply 更新还是阶段封板才更新)?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("必须 remote/prod 事实回填,不能只引用仓内 migrations")正确。本地 migrations 目录只能证明仓库,不能证明 prod 没有 drift — 历史上 zero-to-real 阶段就遇到过 prod schema 与仓内不符的情况。HP9 作为对外交付的封板,如果不做 remote 校对,后续 hero-to-platform 一启动就会发现"我们以为冻结的 schema 实际上跟 prod 不一致"。
- **Opus的最终回答**：
  - 同意。建议 baseline 文档头部记录 `captured_at` 与 `wrangler 命令版本`(具体 `wrangler --version` 输出),后续若 prod 漂移便有 anchor 可对比。若 owner 暂无 prod 访问权限,标 `blocked-by-owner-access` 并自动进 HP10 retained registry,绝不允许"先用本地代替"作为合法做法。

- **问题**：`是否确认 HP9 的 prod schema baseline 必须由 owner / ops 以 remote/prod 事实回填，而不能只引用仓内 migrations 目录？`
- **业主回答**：确认。必须 remote/prod 校对，不允许只引用仓内 migrations。采纳 Opus 补充：baseline 文档头部记录 `captured_at` 与 `wrangler --version` 输出；若 owner 暂无 prod 访问权限，标 `blocked-by-owner-access` 并进 HP10 retained registry。`approved`

### Q32 — 18 份 docs 是否全部走同样强度 review？（来源：`docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md` `HP9-D4`）

- **影响范围**：HP9 review workload、文档冻结节奏、reviewers
- **为什么必须确认**：如果不拍板，要么所有文档都深审导致节奏失控，要么风险高的重写文档被用“轻核对”带过。
- **当前建议 / 倾向**：**不采用统一强度**；rewrite/new 深审，稳定 docs sanity check。
- **Reasoning**：当前文档成熟度明显不均，`error-index.md` 与 `session.md` 的风险完全不同。推荐路线更稳，因为它把 review 精力投入真正高风险的重写/新增文档，同时让稳定文档走事实核对。如果不拍板，HP9 的 review 成本和质量都会一起失控。

- **Opus的对问题的分解**：
  - 三个子问题:(1) rewrite vs sanity check 的判定边界如何画(谁拍板)?(2) sanity check 是否真能发现结构过时(还是只能发现错别字)?(3) 升级机制(sanity check 中发现严重过时 → 升级为 rewrite)如何触发?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("分级 review")正确且节奏合理。一刀切深审会让 HP9 工时失控,一刀切轻核会漏 critical 问题。HP9 设计稿已经把分类冻结(`session.md/permissions.md/usage.md/error-index.md` 走 rewrite,7 份 new 走深审,其余 sanity check),这个分类是基于当前文档成熟度做的客观判断,不是节省工时的妥协。
- **Opus的最终回答**：
  - 同意分级。建议 sanity check 文档若 reviewer 发现结构已过时,必须**当天**决定是否升级为 rewrite,而不是延后处理 — 拖到 closure 前才暴露会让 HP9 单点延期。具体机制:sanity check checklist 中加一项 "has structural drift?" 必填项,若 yes 立即触发升级路径。

- **问题**：`是否确认 HP9 的 18 份文档采用分级 review：rewrite / new 深审，稳定文档 sanity check？`
- **业主回答**：确认。分级 review：rewrite/new 深审，稳定 docs sanity check。采纳 Opus 补充：sanity check checklist 加必填项 "has structural drift?"，若 yes 立即升级为 rewrite。`approved`

---

## 7. Final Closure / Handoff

### Q33 — final closure 是否允许出现 “silently resolved” 分类？（来源：`docs/design/hero-to-pro/HP10-final-closure-and-cleanup.md` `HP10-D1`）

- **影响范围**：HP10 review、handoff、阶段合法性
- **为什么必须确认**：如果不拍板，final closure 可能再次用模糊语言跳过未完成项，降低整阶段的可审计性。
- **当前建议 / 倾向**：**不允许**。
- **Reasoning**：final closure 的价值就在于把所有残余显式分类，而不是靠叙述性语言让问题“看起来已经好了”。推荐路线更稳，因为它要求每项都能进 map、进 registry、进 handoff。如果不拍板，HP10 就很难成为真正的封板文件。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 强制显式分类的代价是否会让 HP10 文档过长(影响可读性)?(2) 是否所有项都能严格落入 `closed/retained/handoff` 三类?(3) 边界模糊项(看起来好了但没人核实)如何处理?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("禁止 silently resolved")完全正确。silently 是 closure 失真的主要途径 — 历史阶段 closure 反复证明,只要有"看起来好了"这条软分类,所有难定的项都会落进去,最终 closure 失去审计价值。HP10 是 hero-to-pro 唯一的封板入口,这条纪律不能让步。
- **Opus的最终回答**：
  - 同意。建议 HP10 final closure 模板中预先列出"分类决策树"(如:"问题是否在代码中已不存在? yes → closed;否则 → 是否有明确移除条件? yes → retained-with-reason;否则 → 是否要继承到 hero-to-platform? yes → handed-to-platform;否则 → cannot close"),防止边界项落入 silent resolution。

- **问题**：`是否确认 HP10 final closure 中不允许出现 silently resolved 这类模糊分类，所有残余都必须显式标注状态？`
- **业主回答**：确认。禁止 silently resolved 分类。采纳 Opus 补充：HP10 final closure 模板预先列出分类决策树（closed / retained-with-reason / handed-to-platform / cannot close），防止边界项落入 silent。`approved`

### Q34 — cleanup register 是否按历史文件名决议？（来源：`docs/design/hero-to-pro/HP10-final-closure-and-cleanup.md` `HP10-D2`）

- **影响范围**：HP10 cleanup、repo reality、future reviews
- **为什么必须确认**：如果不拍板，cleanup 决议会继续围绕已经失真的历史名词，而不是当前真实 owner 文件。
- **当前建议 / 倾向**：**不按历史文件名**；按当前 repo reality 决议。
- **Reasoning**：仓库经过多轮拆分后，很多“历史大文件”已经只剩 wrapper。推荐路线更稳，因为它强迫 cleanup 以当前责任归属为准，而不是对着已经变形的历史问题名词作判断。如果不拍板，HP10 的 retained/deleted registry 会失真。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 当前 repo reality 的 grep / ls 基线如何定义(以哪个 commit 为锚)?(2) 历史问题名字与当前文件 owner 的映射如何记录(便于 reviewer 理解)?(3) HP10 闭合后 reality 又会变化,是否需要重新决议?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("按当前 repo reality 决议")正确。`nano-session-do.ts`、`user-do.ts` 已退化为 8-9 行 wrapper,继续按历史名字下 cleanup 决议会产生失真结论(比如"删除 megafile" — 但根本没 megafile 可删了)。reality-driven 才能让 retained/deleted/handoff 决议真正落地。
- **Opus的最终回答**：
  - 同意。建议 cleanup register 中每项标注 `as-of-commit-hash`(decision baseline 锚定到具体 commit),锁住 reality snapshot,避免 review 期间代码继续变化导致决策依据漂移。若 commit 被 rebase 掉,review 须重新核对,而不是默认沿用旧决议。

- **问题**：`是否确认 HP10 的 cleanup register 必须按当前 repo reality 决议，而不是继续以历史文件名和历史 owner 为依据？`
- **业主回答**：确认。按当前 repo reality 决议，不按历史文件名。采纳 Opus 补充：cleanup register 中每项标注 `as-of-commit-hash` 锚定 reality snapshot，避免 review 期间代码变化导致决策漂移。`approved`

### Q35 — hero-to-platform stub 是否可以写实质计划？（来源：`docs/design/hero-to-pro/HP10-final-closure-and-cleanup.md` `HP10-D3`）

- **影响范围**：HP10 / next stage boundary / future charter
- **为什么必须确认**：如果不拍板，HP10 很容易越界，把下一阶段路线提前写进当前 closure，破坏阶段边界。
- **当前建议 / 倾向**：**不可以**；stub 只写 inherited issues 入口。
- **Reasoning**：HP10 的职责是封板和移交，不是替下一阶段立完整路线。推荐路线更稳，因为它让 hero-to-platform 仍保有自己的 charter 空间，同时让当前阶段把遗留和继承问题写清。如果不拍板，两个阶段会互相污染。

- **Opus的对问题的分解**：
  - 三个子问题:(1) "入口"的最小信息粒度是什么(只列 inherited issues 还是要写范围说明)?(2) 是否允许在 stub 中写"建议优先级"(看似帮忙、实则越界)?(3) inherited issues 与 stub 的关系(stub 是否就是 inherited issues 索引页)?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("只写入口,不写实质计划")正确。HP10 的角色是封板和移交,不是替下一阶段立 charter。如果 HP10 趁势把 hero-to-platform 路线规划掉,会破坏阶段边界 — 下一阶段启动时会发现自己被"前一阶段的善意"绑住手脚,且 charter 失去主动设定空间。
- **Opus的最终回答**：
  - 同意。**严禁** stub 中写"recommended approach"、"suggested timeline"、"proposed architecture",这些都属于下一阶段 charter 范畴。stub 中只允许:(a) inherited issues 列表 + 来源 phase;(b) 本阶段不再覆盖的边界说明(避免下一阶段误以为某项已完成)。这两类信息是"入口信息",其他都是越界。

- **问题**：`是否确认 HP10 创建的 hero-to-platform stub 只登记 inherited issues 与边界说明，不提前写实质实施计划？`
- **业主回答**：确认。stub 只登记 inherited issues + 边界说明，**严禁**写 recommended approach / suggested timeline / proposed architecture。`approved`

### Q36 — retained-with-reason 是否是合法终态？（来源：`docs/design/hero-to-pro/HP10-final-closure-and-cleanup.md` `HP10-D4`）

- **影响范围**：HP10 final closure、hero-to-platform handoff、ops / owner review
- **为什么必须确认**：如果不拍板，closure 会陷入“两种极端”：要么假装全部删完，要么把保留项继续模糊挂起。
- **当前建议 / 倾向**：**是合法终态**，但必须带 remove condition。
- **Reasoning**：并不是所有残余都应该被强行删除；有些确实属于阶段边界、环境约束或成本取舍。推荐路线更稳，因为它承认“显式保留”本身可以是合规结论，但要求范围、理由、移除条件都写清。如果不拍板，HP10 的 retained registry 就会失去规范性。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 是否所有项都能"显式保留"(有些项可能根本说不清 remove condition)?(2) remove condition 的最小颗粒度(可观察事件 vs 主观判断)?(3) review cadence 是否需要(避免 retained 永久积压)?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("retained 合法 + 必须带 remove condition")务实且必要。一刀切要求"全部清理"会诱发伪 closure(团队为了清而清,反而留下回归风险)。但"显式 retained"必须有可验证的 remove condition,否则 retained 就退化成"先不管"。
- **Opus的最终回答**：
  - 同意 retained 合法。建议每项 retained 必须有"假设当 X 发生时即可移除"的 X 条件 — X 必须是可观察 / 可触发的具体事件(如"R29 postmortem 完成"、"hero-to-platform charter 启动"),纯主观 retained(如"等想清楚再说")**不允许**。这条是 retained 与 silent unresolved 的本质区别。

- **问题**：`是否确认 retained-with-reason 是 HP10 的合法终态之一，但每个 retained 项都必须显式写出范围、理由和 remove condition？`
- **业主回答**：确认。retained-with-reason 是合法终态，但每项必须带 scope/reason/remove condition。采纳 Opus 补充：remove condition 必须是可观察/可触发的具体事件，纯主观 retained（如"等想清楚再删"）不允许。`approved`

---

## 8. 条件触发题（仅在触发条件出现时回答）

### Q37 — 若 HP1 在 HP3 启动前仍未落地，manual compact 所依赖的 confirmation/checkpoint 字段是否允许作为 HP1 schema correction 一并处理？（来源：`docs/design/hero-to-pro/HP3-context-state-machine.md` `9.3 条件题`）

- **影响范围**：HP3 start gate、HP1 DDL freeze、context compact job truth
- **为什么必须确认**：这是一道条件触发题；只有当 HP1 未按顺序完成时，它才会影响执行路径。若 HP1 已正常 closure，则本题自动视为 `not-triggered`。
- **当前建议 / 倾向**：**默认不允许**；优先维持 charter 执行顺序，除非 owner 明确批准走 `HP1 schema correction / collateral migration`。
- **Reasoning**：HP3 现已明确第一版不新增独立 `compact_jobs` 表，而是复用 HP1 冻结的 confirmation/checkpoint truth。若 HP1 未落地就让 HP3 自己顺手补这些字段，仍会直接破坏 DDL Freeze Gate。推荐路线更稳，因为它把这个问题保留成一个显式的 owner 决策分支，而不是执行时临时妥协。如果不先在 QNA 里挂出来，真正触发时很容易在聊天里仓促拍板。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 当前 HP1 看起来不会延期到 HP3 启动后(HP1 是 P0,触发概率较低),但若真触发是否要紧急批准?(2) 若允许 collateral migration,会不会破坏 DDL Freeze Gate 的整体纪律(开了一次例外就有第二次)?(3) 默认禁止是否有兜底(避免 HP3 无限期 stalled)?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("默认不允许,除非 owner 明确批准走 HP1 schema correction")正确。这把 escape hatch 的钥匙留在 owner 手里,不让 HP3 实施者临时拍板。HP3 设计稿已选择把 `/compact/jobs/{id}` 复用 HP1 的 `compact_boundary` checkpoint UUID,降低了对 HP1 落地的强依赖,触发风险本身已经被设计层面缓解。
- **Opus的最终回答**：
  - 同意默认 not-triggered + 显式批准制。补充建议:若被触发,collateral migration 必须仍以 `HP1 schema correction / 014+` 编号,而不是绕过 HP1 命名空间另起 `HP3 migrations`。这样从形式上保持 DDL Freeze Gate 唯一入口,即使是例外也走同一条门。

- **问题**：`若 HP1 在 HP3 启动前仍未落地，你是否允许 HP3 为 manual compact 所依赖的 confirmation/checkpoint 字段走一次受控的 HP1 schema correction？`
- **业主回答**：`not-triggered` — HP1 优先于 HP3 按 charter 执行顺序完成 closure。若意外触发，按 Opus 补充的约束处理：必须走 HP1 schema correction（编号 014+），不允许绕过 HP1 命名空间另起 `HP3 migrations`。`approved`

### Q38 — 若 HP1 尚未落地，HP4 所需的最小 delete/retry/checkpoint/restore D1 字段集是否允许作为 collateral migration 一并处理？（来源：`docs/design/hero-to-pro/HP4-chat-lifecycle.md` `9.3 条件题`）

- **影响范围**：HP4 start gate、HP1 DDL freeze、chat lifecycle / checkpoint registry
- **为什么必须确认**：这也是条件触发题；只有当执行顺序被打破时，它才会影响 HP4 能否合法启动。若 HP1 已正常 closure，则本题自动视为 `not-triggered`。
- **当前建议 / 倾向**：**默认不允许**；除非 owner 明确批准受控 correction。
- **Reasoning**：HP4 依赖的 tombstone、retry、checkpoint registry、restore job 都是强 durable truth，如果放到 HP4 临时补，很容易把 phase 边界弄乱。推荐路线更稳，因为它把“例外路径”保留为明确批准制，而不是执行者自行决定。如果不挂到 HPX-qna，触发时很容易因为赶进度而失去治理纪律。

- **Opus的对问题的分解**：
  - 三个子问题:(1) HP4 依赖的 schema 量比 HP3 大得多(tombstone + retry + checkpoint registry + restore job 四组 truth),collateral 风险更高;(2) 若 HP4 开 collateral 先例,HP6/HP7 几乎必然跟进;(3) 默认禁止时 HP4 是否有 graceful 降级路径(只做 close/title 不做 delete/restore)?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("默认不允许 + owner 显式批准")正确,且比 Q37 应当更严格。HP4 的 schema 影响面比 HP3 大一个数量级,临时 collateral 一旦放开,HP1 DDL Freeze Gate 实际上失效。owner 批准制是正确的兜底机制。
- **Opus的最终回答**：
  - 同意默认 not-triggered + 显式批准制。补充建议:HP4 collateral 的影响面比 HP3 大,owner 若批准必须同时确认两件事:(a) HP9 prod schema baseline 时段顺延(因为 collateral migration 会出现在 014+);(b) HP10 retained registry 中显式登记"曾走 collateral 路径"作为治理事件,避免下一阶段以为 hero-to-pro 的 schema 顺序是"正常完成"。

- **问题**：`若 HP1 尚未完成，你是否允许 HP4 为 delete / retry / checkpoint registry / restore job 走一次受控 collateral migration / schema correction？`
- **业主回答**：`not-triggered` — HP1 优先于 HP4 按 charter 执行顺序完成 closure。若意外触发，owner 批准时需同时确认：(a) HP9 prod schema baseline 时段顺延；(b) HP10 retained registry 登记此 collateral 路径事件。`approved`

### Q39 — 若业主不接受统一 `confirmation_pending` 命名，是否允许保留外部兼容 alias，而内部仍统一语义？（来源：`docs/design/hero-to-pro/HP5-confirmation-control-plane.md` `9.3 条件题`）

- **影响范围**：HP5 naming、clients、internal runtime semantics
- **为什么必须确认**：这是一道命名争议的兜底题；只有在业主对 `confirmation_pending` 这个名字本身有异议时，才需要回答。
- **当前建议 / 倾向**：**允许保留外部兼容 alias，但内部仍统一为 `confirmation_pending` 语义**。
- **Reasoning**：这题的实质不是要不要改一个词，而是内部 runtime 语义是否还能保持单一。如果只是名字不喜欢，最稳的路线是外部给 alias，内部不分裂；否则会为了命名偏好重新引入多个 pending reason。把这题单独挂出来，可以避免未来在实现阶段临时争论命名。

- **Opus的对问题的分解**：
  - 三个子问题:(1) 外部 alias 是否真能保持兼容(alias 与本体长期分离会有漂移风险)?(2) 内部统一是否会让外部 alias 漂移成"看似 alias 实则旧语义"?(3) 命名争议本身值不值得为它 split runtime 语义?
- **Opus的对GPT推荐线路的分析**：
  - GPT 路线("外部 alias、内部统一")是务实折中。这题本质不是要不要改一个词,而是 internal runtime 语义是否还能保持单一。如果只为命名偏好就 split runtime(internal 也分多个 pending enum),前面 Q17 的所有理由都会被推翻 — 那是更糟的局面。alias 是低成本兼容路径。
- **Opus的最终回答**：
  - 同意折中路线。建议外部 alias 的有效期不超过 hero-to-platform 启动 — 届时 client 必须切到 `confirmation_pending`,不允许 alias 永久存在。alias deprecate 时间表由 HP10 final closure 决议,不是开放性 alias。这样既给 client 兼容窗口,又防止 alias 永久挂起成第二真相源。

- **问题**：`如果你不接受 confirmation_pending 这个命名，是否同意“外部保留兼容 alias、内部仍统一用 confirmation_pending 语义”这条折中路线？`
- **业主回答**：`not-triggered` — 接受 `confirmation_pending` 命名。采纳 Opus 补充的兜底条款：若未来任何原因需要 alias，alias 有效期不超过 hero-to-platform 启动，届时 client 必须切到 `confirmation_pending`，不允许永久 alias。`approved`

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
