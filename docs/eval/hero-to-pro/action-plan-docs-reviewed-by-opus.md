# Nano-Agent 代码审查 — hero-to-pro action-plan docs

> 审查对象: `docs/action-plan/hero-to-pro/HP0-HP10-action-plan.md（共 11 份）`
> 审查类型: `docs-review`
> 审查时间: `2026-04-30`
> 审查人: `Claude Opus 4.7`
> 审查范围:
> - `docs/action-plan/hero-to-pro/HP0-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP1-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP2-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP3-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP4-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP5-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP6-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP7-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP8-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP9-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP10-action-plan.md`
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md`(基石 charter,1331 行)
> - `docs/design/hero-to-pro/HP0-pre-defer-fixes.md` ~ `HP10-final-closure-and-cleanup.md`(12 份 design)
> - `docs/design/hero-to-pro/HPX-qna.md`(39 道 owner-pending 题)
> - `docs/templates/code-review.md`(本审查模板来源)
> - 当前 `main @ 256ffa2` 分支真实代码(migrations/、workers/、packages/、context/)
> 文档状态: `changes-requested`

---

## 0. 总结结论

> 这套 action-plan 在结构与字段命名层面确实做到了与 charter / design / HPX-qna 的高度对齐;但在三个根本性维度上**不能直接引导团队进入 hero-to-pro 真正的开发工作**:HPX-qna 的 39 道 owner-pending 题全部空白却被 11 份 action-plan 同时当作"已冻结"消费;`context/` 目录下三家 reference agent 的源码事实上存在但被全仓 design 文档错误地声明为"未 vendored",而 11 份 action-plan 又一律未引用其中任何一条 precedent;若干 cross-phase 边界(workspace cleanup vs checkpoint cleanup TTL、confirmation `superseded` 终态、`compact_boundary` UUID 复用为 compact job_id)在 action-plan 与 design 的相互引用中存在事实漂移。

- **整体判断**:`结构合格,但 freeze 前提不成立 + precedent 引用断裂 + 跨 phase 细节漂移,应在合并前修订`
- **结论等级**:`changes-requested`
- **是否允许关闭本轮 review**:`no`
- **本轮最关键的 1-3 个判断**:
  1. **HPX-qna 39 道题 owner-pending 全空白**,但 11 份 action-plan 已经在"冻结决策来源"栏目把它们全部以"frozen 引用"消费,这是 freeze 假象,必须先让 owner 真正回填后才能视作可执行依据。
  2. **`context/` precedent 引用全链条断裂** — design 文档自称"未 vendored"(实则存在)、action-plan 完全未引用、charter §0.2 明确把 `context/claude-code/codex/gemini-cli` 列为 ancestry 参考 — 三处口径不一致,导致 action-plan 在 HP2/HP3/HP5/HP7 的关键设计点失去 precedent 校验路径。
  3. **跨 phase 数据/生命周期边界存在 2-3 处事实漂移**:HP6 workspace cleanup `session.end + 24h` vs HP7 checkpoint cleanup `session.end + 90d` 的并存关系未明确;HP3 `compact_boundary` checkpoint UUID 复用为 `compact_jobs/{id}` 在 HP1 P4-01 文末"未引入额外 compact job 表"与 HP3 设计 §7.2 F4 之间需要一次显式对齐。

---

## 1. 审查方法与已核实事实

### 1.1 对照文档

- **基石 charter**:`docs/charter/plan-hero-to-pro.md`(1331 行,§1-§15 全文)
- **12 份 design 文档**:`docs/design/hero-to-pro/HP0-HP10-*.md` + `HPX-qna.md`
- **11 份 action-plan**:`docs/action-plan/hero-to-pro/HP0-HP10-action-plan.md`(总计 5163 行)
- **代码 ground truth**:`main @ 256ffa2` 真实代码

### 1.2 核查实现

- `workers/orchestrator-core/migrations/`(实际仅 001-006)
- `workers/orchestrator-core/src/{session-lifecycle.ts, user-do/*.ts, parity-bridge.ts}`
- `workers/agent-core/src/host/{runtime-mainline.ts, do/session-do-*.ts}`
- `packages/{nacp-core,nacp-session}/src/`
- `context/{claude-code,codex,gemini-cli,mini-agent,smcp,...}`

### 1.3 执行过的验证

- `ls context/`(确认 13 个 precedent 目录存在)
- `ls context/codex/codex-rs/protocol/src/openai_models.rs context/claude-code/utils/model/model.ts context/gemini-cli/packages/cli/src/ui/commands/modelCommand.ts`(确认 design 引用的关键 precedent 文件**真实存在**)
- `grep -E "context/(codex|claude-code|gemini)" docs/action-plan/hero-to-pro/HP*.md`(action-plan 中 0 命中)
- `grep -l "context/codex\|context/claude-code\|context/gemini" docs/design/hero-to-pro/*.md`(design 中 8 份命中)
- `grep -n "vendored" docs/design/hero-to-pro/HP*.md`(每份 design 都声明"未 vendored",但事实相反)
- `wc -l docs/action-plan/hero-to-pro/HP*.md`(11 份共 5163 行,平均 ~470 行/份)
- `grep -c "P[0-9]-[0-9][0-9]" docs/action-plan/hero-to-pro/HP*.md`(每份 24-34 个 P-编号工作项)

### 1.4 复用 / 对照的既有审查

- `docs/eval/hero-to-pro/design-docs-reviewed-by-opus.md` — 我先前完成的 design-layer review,作为 design ↔ action-plan 一致性核查的输入
- `docs/eval/hero-to-pro/design-docs-reviewed-by-deepseek.md` — 第三方 design review,作为线索(未独立采纳结论)
- 此前我对 `HPX-qna.md` 39 道题填写的 Opus second opinion(在同一轮工作内完成),作为 HPX 引用合法性的对照基线

### 1.5 已确认的正面事实

- 11 份 action-plan **结构高度一致**,均按 charter 推荐的 Phase / 工作项编号 / 测试方式 / 收口标准 / DoD 五段式组织,可读性与可审计性强。
- **charter §7.x 中冻结的工作项几乎全部被覆盖** — HP1 list 的 7 张 migration、4 alias seed、9 个 index、HP2 的四层模型状态、HP5 的 7-kind confirmation、HP7 的三模式 restore、HP9 的 18 doc + 5 设备 evidence,均能在对应 action-plan 中找到 1:1 P-编号工作项。
- **跨 phase 依赖链条清晰** — HP4 P3-01 显式说"消费 HP1 落地的 `nano_session_checkpoints`",HP5 P1-01 显式依赖 HP1 `012`,HP7 P1-01 显式依赖 HP1 `013`;所有依赖链可被 reviewer 顺向追踪,无循环依赖或前置条件丢失。
- **Out-of-Scope 边界遵守纪律** — HP4 显式标注"files-only / conversation_and_files restore"为 [O1] 留 HP7;HP6 显式标注"patch/diff/read-before-write 编辑器"为 [O2] 留 hero-to-platform;HP3 显式标注"multi-provider routing"为 [O1];未发现 phase 越界做下一 phase 工作。
- **HP1 P5-02 包含 `schema correction registry / correction-of` 模板要求** — 与 charter §4.4 R8 受控例外一致,DDL Freeze Gate 的"修宪程序"在 action-plan 层有显式落点。

### 1.6 已确认的负面事实

- **HPX-qna.md 39 题的 `业主回答` 栏目至今全部空白** — 我亲自核查过该文件,Q1-Q39 的 `- **业主回答**：` 行均无内容。然而 11 份 action-plan **每一份**都在文档头部"冻结决策来源"标注 `docs/design/hero-to-pro/HPX-qna.md` 的 Q-编号"只读引用",HP1-action-plan 头部 line 36-37 明确写 `Q4-Q6、Q13、Q16、Q18(只读引用;本 action-plan 不填写 Q/A)` — 这是 owner answer 不存在的情况下被当作 frozen 消费。
- **`context/` 目录确实存在但 design 全仓声明"未 vendored"** — `ls context/` 返回 `claude-code / codex / gemini-cli / mini-agent / smcp / smind-* / safe / wbca-mini / just-bash / ddl-v170` 共 13 个目录;`ls context/codex/codex-rs/protocol/src/openai_models.rs` 等 4 条 design 引用文件全部存在(返回成功),但 8 份 design 文档头部均写"当前工作区未 vendored `context/` 源文件",该声明与文件系统事实**矛盾**。
- **action-plan 完全不引用 `context/` 任何路径** — `grep -E "context/(codex|claude-code|gemini)" docs/action-plan/hero-to-pro/HP*.md` 返回 0 命中。这意味着 design 文档中"借鉴 Codex `<model_switch>`"、"借鉴 Gemini `ChatRecordingService`"、"借鉴 Claude `query.ts:572-578` fallback" 等设计动机,在 action-plan 阶段全部丢失。执行者拿到 action-plan 后**无法回到 precedent 验证设计动机**。
- **HP1 P1-01 自身规定要"把 Q4/Q5/Q6/Q13/Q16/Q18 派生规则显式补入 charter / HP1 design"** — 但 action-plan 同时把这些 Q 列为"只读引用、不填写 Q/A"。如果 owner 未回答,P1-01 的执行者既不能"显式补入"(因为没有 frozen answer),也不能"提问"(因为 action-plan 不允许)。**这是一处自我矛盾**。
- **HP3 与 HP1 的 compact_jobs 边界在两处文档之间存在不同表述**:HP3 design §7.2 F4 写"job_id 直接复用 `compact_boundary` checkpoint UUID;`/jobs` 读取的是 checkpoint / confirmation / compact.notify 的投影";HP1 P4-01 写"未引入额外 compact job 表"。两处方向一致,但 HP3-action-plan 中是否同样冻结这一选择需要在 P3-02 中显式标注 — 当前**未见显式 cross-link**。
- **HP6 workspace cleanup TTL 与 HP7 checkpoint cleanup TTL 在 action-plan 层未对账**:HP6 P4 工作项使用 charter §7.7 `session.end + 24h`,HP7 P4 工作项使用 charter §7.8 `turn-end rotate=10 / user-named 30d / session.end + 90d`,二者均消费 HP1 落地的 `nano_workspace_cleanup_jobs`,但**没有任何 action-plan 显式说明两套 cron job 的责任边界**(谁负责扫描哪一行、`scope` 列怎么填)。

### 1.7 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 通过 `Read` + `head` + `grep` 对 charter / design / action-plan 的关键行号(如 HP1 P5-02、HP3 §7.2 F4、HP6 §7.7、HP7 §7.8、charter §4.4 R8 等)逐项核查 |
| 本地命令 / 测试 | yes | `ls context/`、`ls context/<cited paths>`、`grep -E ...`、`wc -l`、`grep -c P[0-9]-` 均执行 |
| schema / contract 反向校验 | yes | 通过对 migrations/ 现状(仅 001-006)与 action-plan HP1 声称落 007-013 的对账确认"freeze 是设计意图,不是已发生事实" |
| live / deploy / preview 证据 | n/a | action-plan 是文档审查,无需 live evidence |
| 与上游 design / QNA 对账 | yes | 11 份 action-plan ↔ 12 份 design ↔ HPX-qna 39 题 ↔ charter §7.x 全链对账 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | HPX-qna 39 题 owner-pending,但 11 份 action-plan 全部以"frozen 引用"消费 | critical | scope-drift | yes | 在 owner 真正回填 HPX 之前,所有 action-plan 状态从 `draft` 不得转 `approved`;或显式声明"基于 GPT 推荐线路的预演执行计划" |
| R2 | `context/` precedent 文件实际存在但 design 全仓声明"未 vendored",action-plan 又完全不引用 | high | docs-gap + correctness | yes | 修订 design 头部的"未 vendored"声明,改为"已 vendored 但作为 ancestry pointer 不作执行证据";action-plan 在 HP2/HP3/HP5/HP7 关键工作项中加入 precedent 行号引用 |
| R3 | HP1 P1-01 要求"显式补入派生规则",但同 phase 又禁止 Q/A — 自我矛盾 | high | correctness | yes | 重写 P1-01 文本:把"显式补入"改为"以 owner 已回填的 HPX 答案为准回填",或要求 P1-01 在 owner 回填 HPX 后才能开始 |
| R4 | HP6 ↔ HP7 cleanup TTL 边界在 action-plan 中未对账 | medium | scope-drift | no | 在 HP6 P4 与 HP7 P4 各加一段"`nano_workspace_cleanup_jobs.scope` 列对账表",显式分配 24h/30d/90d/checkpoint_ttl 各自由谁触发 |
| R5 | HP3 compact job_id 复用 `compact_boundary` checkpoint UUID 的设计意图未在 action-plan 显式 cross-link | medium | docs-gap | no | HP3 P3-02 加一行"job_id 即 `nano_session_checkpoints.checkpoint_uuid` where kind=compact_boundary,不新增表" |
| R6 | confirmation `superseded` 作为失败回滚终态在 HP1 与 HP5 之间表述不一致 | medium | protocol-drift | no | HP1 P3-03 与 HP5 P3 显式锁定:`failed` 不进入 enum,失败用 `superseded` + audit log |
| R7 | charter §6.3 要求每 phase closure 必须显式声明 F1-F17 状态,但仅 HP8/HP10 action-plan 提到 chronic register | medium | delivery-gap | no | HP2-HP7 / HP9 各 action-plan 的 closure 工作项加"F1-F17 状态登记"作为 sub-task |
| R8 | action-plan 无任何 `cross-e2e` 文件名引用,charter 强制的 `15-permission-roundtrip-allow / 16 / 17 / 18` 仅在 HP5 一处出现 | low | test-gap | no | HP5 P4 显式列出 4 个文件名;HP2/HP3/HP4/HP6/HP7 的 e2e 工作项也建议命名(便于 reviewer 对账 charter §9.1) |
| R9 | HP9 manual evidence hard gate 与 owner 设备就绪的依赖在 action-plan 没有 owner-action 锁定时点 | low | platform-fitness | no | HP9 P4 加 owner-action checklist:5 设备清单 + 录制脚本 + 录制时间窗 — 与 charter §12 Q2 对齐 |
| R10 | HP10 cleanup 决议依赖 HP8-B R29 postmortem 真实结论,但 action-plan 中未列 R29 postmortem 文件路径作为输入 | low | docs-gap | no | HP10 P2 加显式 input:`docs/issue/zero-to-real/R29-postmortem.md`(HP8-B 交付),不存在则 HP10 不得启动 |

### R1. HPX-qna 39 题 owner-pending,但 11 份 action-plan 全部以"frozen 引用"消费

- **严重级别**:`critical`
- **类型**:`scope-drift`
- **是否 blocker**:`yes`
- **事实依据**:
  - `docs/design/hero-to-pro/HPX-qna.md`:Q1-Q39 的 `- **业主回答**：` 行全部空白(我亲自填了 Opus second opinion 但 owner answer 仍空)
  - `docs/action-plan/hero-to-pro/HP1-action-plan.md:36-37` 写 `冻结决策来源: docs/design/hero-to-pro/HPX-qna.md Q4-Q6、Q13、Q16、Q18(只读引用;本 action-plan 不填写 Q/A)`
  - HP0-HP10 action-plan 头部均有同款"只读引用"声明 — 11/11 份均预设 HPX 已冻结
  - charter §1.1 D6 明确写"DDL 改动统一在 HP1 一次性收口" — 但这条决策的具体 schema 取舍在 HPX Q4/Q5/Q6 中,Q 答案 owner 未填
- **为什么重要**:
  - 如果 owner 在 HP1 启动后回答 Q4 选"非 007-013 而是别的编号",HP1-action-plan 全部 P-编号工作项即时作废
  - 如果 owner 在 HP5 启动前对 Q18 选"加 `tool_cancel` 第 8 kind",HP5/HP6 action-plan 的 schema 字段消费关系全部需要重写
  - "frozen 引用"在文档表面看起来是 `freeze`,实则是基于 GPT 推荐线路的预演 — 这种状态执行风险极高
- **审查判断**:
  - 11 份 action-plan 在 freeze 前提不成立的情况下,把自己写成了"待执行计划",而不是"待 owner 拍板后可执行的计划"
  - 这是 process drift,不是单文件 bug — 修法不在某一份 action-plan,而在执行节奏
- **建议修法**:
  - 在 owner 回填 HPX 之前,所有 action-plan 状态保持 `draft`,不得转 `approved`/`ready-to-execute`
  - 在每份 action-plan 头部增加一段 `状态前置条件: HPX-qna Q<n>-Q<m> 已由 owner 回填`,作为执行前 gate
  - 或 — 如果决定继续以 GPT 推荐线路推进 — 在 charter §1.1 增列 D11:"接受 HPX 推荐线路作为预冻结",并在 owner 后续回填时按 schema correction 程序处理偏差

### R2. `context/` precedent 文件实际存在但 design 全仓声明"未 vendored",action-plan 又完全不引用

- **严重级别**:`high`
- **类型**:`docs-gap + correctness`
- **是否 blocker**:`yes`
- **事实依据**:
  - `ls context/` 返回 `claude-code / codex / gemini-cli / mini-agent / smcp / smind-* / safe / wbca-mini / just-bash / ddl-v170` — 13 个目录真实存在
  - `ls context/codex/codex-rs/protocol/src/openai_models.rs` → 文件存在;`ls context/claude-code/utils/model/model.ts` → 文件存在;`ls context/gemini-cli/packages/cli/src/ui/commands/modelCommand.ts` → 文件存在;`ls context/codex/codex-rs/app-server/src/codex_message_processor.rs` → 文件存在
  - `docs/design/hero-to-pro/HP0-pre-defer-fixes.md:19` / `HP2-model-state-machine.md:20` / 其余 6 份 design 头部均写 `外部 precedent 说明: 当前工作区未 vendored context/ 源文件;文中出现的 context/* 仅作 drafting-time ancestry pointer,不作为当前冻结 / 执行证据。`
  - `grep -E "context/(codex|claude-code|gemini)" docs/action-plan/hero-to-pro/HP*.md` → 0 命中(11 份 action-plan 总计 5163 行,完全无 precedent 路径引用)
  - charter §0.2 把 `context/claude-code/` `context/codex/` `context/gemini-cli/` 列为 `ancestry-only / 背景参考(不作为直接入口)`
- **为什么重要**:
  - 三处口径不一致:文件系统说"存在"、design 说"未 vendored"、action-plan 说"沉默"。reviewer 拿到任何一份单独读时,都得不到 precedent 真相
  - HP2 `<model_switch>` 设计直接借自 Codex `model_switch_message()`(`context/codex/codex-rs/protocol/src/models.rs:471-474`)、HP3 strip-then-recover 借自 Codex `compact.rs:132-142`、HP5 confirmation bus 借自 Gemini `confirmation-bus/types.ts` — 这些设计动机在 action-plan 阶段被剥离后,执行者**无法回到 precedent 验证"为什么这样做"**
  - 如果未来 hero-to-platform 启动时 owner/reviewer 想知道"hero-to-pro 是否真的对齐 reference agent",会发现链条断裂
- **审查判断**:
  - "未 vendored"声明是 design 起草时的笔误或保护性声明,与文件系统事实矛盾;应当修正
  - action-plan 不引用 precedent 不是错误本身,但**配合 design 的错误声明**就形成了真相缺口
- **建议修法**:
  - 修订 8 份 design 头部"未 vendored"声明为 `外部 precedent 说明: context/ 目录已 vendored(claude-code / codex / gemini-cli),引用作为 ancestry / drafting-time precedent;action-plan 阶段不要求执行者回访,但 design review 时可作 evidence`
  - 选择性地在 HP2 P3-01(`<model_switch>`)、HP3 P4-01(strip-recover)、HP5 P1-03(confirmation 7-kind 来源)、HP7 P4-01(fork lineage system message)等 4 个最具 precedent 强相关的工作项中,加一行 `precedent 参考: context/<path>:<lines>`,让 design ↔ action-plan ↔ precedent 三层可追溯

### R3. HP1 P1-01 要求"显式补入派生规则",但同 phase 又禁止 Q/A — 自我矛盾

- **严重级别**:`high`
- **类型**:`correctness`
- **是否 blocker**:`yes`
- **事实依据**:
  - `docs/action-plan/hero-to-pro/HP1-action-plan.md:36` 写 `冻结决策来源: docs/design/hero-to-pro/HPX-qna.md Q4-Q6、Q13、Q16、Q18(只读引用;本 action-plan 不填写 Q/A)`
  - 同文件 `4.1 Phase 1 — Freeze Alignment + Consumer Map` 表格 P1-01 工作内容写 `把 Q4/Q5/Q6/Q13/Q16/Q18 的派生规则显式补入 charter / HP1 design:007-013 freeze、014+ correction-only、ended_reason、7-kind confirmation、superseded rollback 终态、无 tool_cancel`
  - HPX-qna.md 中这 6 个 Q 的 `业主回答` 栏目当前全部空白
- **为什么重要**:
  - P1-01 执行者拿到工单后会发现:Q4/Q5/Q6/Q13/Q16/Q18 没有 owner answer,但 action-plan 头部又规定不允许提问/回答 — 唯一可执行的路径是"按 GPT 推荐线路抄进 charter / design",这就把推荐线路升级为 owner 决策
  - 这是 R1 在 HP1 内部的具体显化:HP1 是 DDL Freeze Gate,如果 P1-01 基于未冻结的 owner answer 把派生规则"显式补入" charter,后续 owner 反悔会引发 charter 主修订
- **审查判断**:
  - P1-01 的工作描述与文档头规则相互否定;必须二选一:要么删除"不填写 Q/A"约束并允许 P1-01 引用具体 owner answer,要么把 P1-01 重写为"以 owner 已回填的 HPX 答案为准回填,如未回填则 HP1 不得启动"
- **建议修法**:
  - 推荐第二条:HP1-action-plan 头部增加 `执行前置: HPX-qna.md 中本 action-plan 引用的所有 Q 必须由 owner 回填`,P1-01 工作内容改为 `以 owner 已回填的 HPX Q4/Q5/Q6/Q13/Q16/Q18 答案为准,把派生规则显式补入 charter / HP1 design`
  - 同样规则适用 HP2-HP10 — 11 份 action-plan 应统一执行前置 gate,而不是各自处理

### R4. HP6 ↔ HP7 cleanup TTL 边界在 action-plan 中未对账

- **严重级别**:`medium`
- **类型**:`scope-drift`
- **是否 blocker**:`no`
- **事实依据**:
  - `docs/charter/plan-hero-to-pro.md:739` HP6 In-Scope:`session.end + 24h cron 清理 — 每次清理写 nano_workspace_cleanup_jobs 一行 audit`
  - `docs/charter/plan-hero-to-pro.md:794` HP7 In-Scope:`turn-end rotate 10 个 / user-named 30 天 / compact-boundary 与 compact summary 同 TTL / session.end + 90d cron 清理 — 所有 cleanup 操作写 nano_workspace_cleanup_jobs audit 行`
  - HP1 P4-01 落 `nano_workspace_cleanup_jobs(... scope ENUM[session_end | explicit | checkpoint_ttl] ...)` — 只有 3 种 scope
  - HP6-action-plan 与 HP7-action-plan 均消费同一张 `nano_workspace_cleanup_jobs`,但**未在任一 action-plan 中显式说明** scope 列分别对应哪段 cron / 哪个 phase 的责任
- **为什么重要**:
  - HP6 工作区 cleanup 与 HP7 checkpoint cleanup 都会扫描 R2 + 写 `nano_workspace_cleanup_jobs`;如果两套 cron 同时跑,会出现"workspace temp file 被 24h cron 删除,但 turn_end 时 HP7 检查到该 file 已不存在导致 snapshot materialization 失败"等竞态
  - charter §7.7 与 §7.8 各自独立合理,但 action-plan 没有合并视角 — 这正是"design 单 phase 看清楚、跨 phase 看不清楚"的典型缺口
- **审查判断**:
  - 不是 critical(HP6/HP7 设计本身没错),但 reviewer 在合并时无法独立判断两套 cleanup 是否会冲突,需要补一份 cross-phase 对账表
- **建议修法**:
  - 在 HP6 P4 与 HP7 P4 各加一段 `nano_workspace_cleanup_jobs.scope 责任分配表`:
    - `session_end` → HP6 owner(workspace temp files 24h)
    - `explicit` → HP6 owner(用户显式 cleanup workspace)
    - `checkpoint_ttl` → HP7 owner(turn-end rotate / user-named 30d / session_end 90d)
  - 在 HP1 P4-01 注释中增加上述责任分配作为 schema 文档,避免实施者各自解读

### R5. HP3 compact job_id 复用 `compact_boundary` checkpoint UUID 的设计意图未在 action-plan 显式 cross-link

- **严重级别**:`medium`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `docs/design/hero-to-pro/HP3-context-state-machine.md` §3.2 与 §7.2 F4 写 `compact job 第一版以 HP1 已冻结的 checkpoint / confirmation truth 组装读模型,不在本 phase 新增独立 compact job 表;job_id 直接复用 compact_boundary checkpoint UUID,/jobs 读取 checkpoint / confirmation / compact.notify 的投影`
  - `docs/action-plan/hero-to-pro/HP1-action-plan.md` P4-01 写 `第一版 compact job 继续复用 compact_boundary checkpoint handle,不新增 nano_compact_jobs`
  - HP3-action-plan P3-01/P3-02 关于 compact preview/job 的工作项**未引用 HP1 P4-01 这段** — reviewer 看 HP3-action-plan 时不会知道 job_id 的具体来源
- **为什么重要**:
  - HP3 实施者写 `/compact/jobs/{id}` 端点时,如果不知道 `id` = `nano_session_checkpoints.checkpoint_uuid` where `kind=compact_boundary`,会自然倾向新建 `nano_compact_jobs` 表 — 但 charter §4.4 R8 明确禁止 HP3 新增 migration
  - 这是 HP1 与 HP3 之间的硬依赖,在 action-plan 层断了
- **审查判断**:
  - 设计本身是对的(HP1 与 HP3 design 都说同一件事),但 action-plan 层缺少 cross-link,实施者会被迫去 design 层挖掘
- **建议修法**:
  - HP3 P3-02 工作内容加一行 `compact job 实现:job_id 直接为 nano_session_checkpoints.checkpoint_uuid where checkpoint_kind=compact_boundary;/jobs/{id} 路由读取 checkpoint + compact.notify event 投影,严禁新建 nano_compact_jobs 表(参见 HP1 P4-01)`

### R6. confirmation `superseded` 作为失败回滚终态在 HP1 与 HP5 之间表述不一致

- **严重级别**:`medium`
- **类型**:`protocol-drift`
- **是否 blocker**:`no`
- **事实依据**:
  - `docs/charter/plan-hero-to-pro.md:441` 与 `docs/design/hero-to-pro/HP1-schema-extension.md` §7.2 写 `nano_session_confirmations.status: pending | allowed | denied | modified | timeout | superseded`(6 状态,无 `failed`)
  - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md` §7.2 F1 写 `confirmation row 至少含 status` 但未列具体 enum;§6.2 风险表写 `confirmation registry 与 DO storage 双写不一致 → 以 confirmation row 为准,DO storage 写失败则 row 标 failed 并显式告警` — **这里写了 `failed`,与 HP1 6 状态枚举不一致**
  - `docs/action-plan/hero-to-pro/HP1-action-plan.md:217` 表格 P3-03 写 `kind 集合与 Q18 一致;无 failed / tool_cancel;回滚终态支持 superseded`
  - HP5-action-plan 未单独锁定 enum 列表
- **为什么重要**:
  - HP5 design 一处使用 `failed` 一处使用 `superseded`,HP1 schema 只有 `superseded` — 实施者按 HP5 design 写 `failed` 会触发 D1 CHECK 约束失败
  - 这是 design 层就漂移、action-plan 层未发现的典型情况
- **审查判断**:
  - HP1-action-plan 已经明确锁定 `无 failed`,但 HP5-action-plan 未锁定 — 必须在 HP5 action-plan 显式同款锁定,否则 HP5 实施时按 design 写代码会出错
- **建议修法**:
  - HP5 P3 加 `confirmation 终态枚举:pending | allowed | denied | modified | timeout | superseded;失败回滚使用 superseded + audit log,严禁新增 failed(参见 HP1 P3-03)`
  - 同时 fix HP5 design §6.2 风险表中的 `row 标 failed` 笔误

### R7. charter §6.3 要求每 phase closure 必须显式声明 F1-F17 状态,但仅 HP8/HP10 action-plan 提到 chronic register

- **严重级别**:`medium`
- **类型**:`delivery-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `docs/charter/plan-hero-to-pro.md:345` §6.3 要求 `每 phase closure 必须显式声明 chronic deferral 状态 — F1-F17 每项在每 phase closure 中标 closed/partial/not-touched/handed-to-platform,HP10 汇总`
  - HP8-action-plan P1-01/P1-02 提到 `R28 / R29 / Lane E register`,HP10-action-plan P3-01 提到 `chronic map merge`
  - HP0/HP1/HP2/HP3/HP4/HP5/HP6/HP7/HP9 共 9 份 action-plan 的 closure 工作项**均未提及 F1-F17 status 登记**,只在 HP10 一次性汇总
- **为什么重要**:
  - 如果只在 HP10 一次性汇总 F1-F17,意味着前 8 个 phase 各自不会跟踪 chronic 状态,直到 HP10 才发现"某项 F-编号在某 phase 应该 close 但没人做"
  - charter §6.3 的设计意图正是分散追踪、HP10 汇总 — 11 份 action-plan 部分背离了这条纪律
- **审查判断**:
  - 不是 critical(HP10 仍然能汇总),但会让 closure 质量下降,且 HP10 工作量被推后集中
- **建议修法**:
  - 在 HP0-HP7 / HP9 各 action-plan 的 closure 工作项中增加一行子任务:`F1-F17 chronic status 登记(每项标 closed/partial/not-touched/handed-to-platform)`
  - HP10 P3-01 工作内容改为 `merge HP0-HP9 closure 中已登记的 F1-F17 状态,而非首次登记`

### R8. action-plan 无 cross-e2e 文件名引用,charter 强制的 `15-18` e2e 文件名仅在 HP5 一处出现

- **严重级别**:`low`
- **类型**:`test-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `docs/charter/plan-hero-to-pro.md:1109` Primary Exit 6 写 `F12 + F13 e2e 4 件套全部就位 — test/cross-e2e/15-18 4 个文件全绿`
  - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md` §7.3 列出 `15-permission-roundtrip-allow.test.mjs / 16-permission-roundtrip-deny.test.mjs / 17-elicitation-roundtrip.test.mjs / 18-usage-push-live.test.mjs`
  - HP5-action-plan P4-01 提到这 4 个文件 — 但其他 phase 的 e2e 工作项均未给出具体文件名
- **为什么重要**:
  - charter §9 列出 8-10 类 e2e 强制项(model 切换 / cross-turn / compact / restore / fork / namespace / heartbeat / docs review),如果 action-plan 不命名文件,reviewer 无法逐项核对"哪个测试覆盖哪个 charter 要求"
  - 不是 critical,但是 charter exit gate 与 action-plan 的对账粒度问题
- **审查判断**:
  - HP5 已建立先例,其他 phase 应跟进
- **建议修法**:
  - HP2 P4-01(model 切换 5 e2e)、HP3 P5-01(长对话 e2e)、HP4 P5-01(lifecycle e2e)、HP6 P5-01(workspace e2e)、HP7 P5-01(restore/fork e2e)的工作项均补一行 `cross-e2e 文件名建议:test/cross-e2e/19-... / 20-... / ...`

### R9. HP9 manual evidence hard gate 与 owner 设备就绪的依赖在 action-plan 没有 owner-action 锁定时点

- **严重级别**:`low`
- **类型**:`platform-fitness`
- **是否 blocker**:`no`
- **事实依据**:
  - `docs/charter/plan-hero-to-pro.md:1219-1223` Q2 写 `HP9 启动前 owner 锁定 5 套设备 + 制定录制脚本;HP9 启动后 1 周内完成。最晚冻结时点:HP9 启动日`
  - `docs/charter/plan-hero-to-pro.md:942-944` HP9 风险段写 `若 owner 不能完整配合,HP9 不能 closure,HP10 final closure 不得放行,本阶段标 cannot close`
  - HP9-action-plan P4-01/P4-02 提到 5 设备 evidence 与 manual evidence 索引,但**未在工作项内列出 owner-action checklist**(谁锁定设备、何时锁定、设备清单形式)
- **为什么重要**:
  - charter Q2 把 owner-action 时点定为"HP9 启动日",但 action-plan 没有把这个时点显式落到 P-编号工作项 — 实施者会发现自己启动 HP9 后等设备等不到,还可能误判为 HP9 阻塞
- **审查判断**:
  - 低优先级 — HP9 风险段已经写了"cannot close",但 action-plan 缺一个 owner-action checklist 让 owner 知道何时该做什么
- **建议修法**:
  - HP9 P4-01 加一行 `owner-action checklist:① 设备清单冻结(HP9 启动日)② 录制脚本完成(启动 + 3 日)③ 5 设备录制完成(启动 + 7 日)④ evidence pack 索引(启动 + 10 日);任一节点延期 → HP9 标 partial close`

### R10. HP10 cleanup 决议依赖 HP8-B R29 postmortem 真实结论,但 action-plan 中未列 R29 postmortem 文件路径作为输入

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `docs/charter/plan-hero-to-pro.md:957` HP10 In-Scope `对 HP8-B R29 postmortem 判定为可删的 forwardInternalJsonShadow / parity-bridge historical residue 做物理删除`
  - `docs/charter/plan-hero-to-pro.md:1279` 列 `docs/issue/zero-to-real/R29-postmortem.md(HP8-B 交付,虽放在 zero-to-real 文件夹但本阶段写)`
  - HP10-action-plan P2-01/P2-02 提到 `delete residue + retained registry`,但**未列 R29-postmortem.md 作为执行前置输入**
- **为什么重要**:
  - 如果 HP8-B 在 R29 postmortem 中选"不可验证",HP10 的 `forwardInternalJsonShadow` / `parity-bridge` 删除就**不应执行**;但 action-plan 没明确说"HP10 P2 先读 R29-postmortem.md 再决定删 / 留"
  - 这不阻止 HP10 启动,但会让执行者错过"R29 选了不可验证"的信号
- **审查判断**:
  - 低优先级 — 易修
- **建议修法**:
  - HP10 P2-01 工作内容首行加 `执行前置:读取 docs/issue/zero-to-real/R29-postmortem.md(由 HP8-B 交付),依据其 verdict 决定 forwardInternalJsonShadow / parity-bridge 是 delete 还是 retained-with-reason`

---

## 3. In-Scope 逐项对齐审核

> 对照 charter §4.1 全局 In-Scope I1-I11 与 action-plan 的对应关系。

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | I1 — HP0 前置 defer 修复(model_id 透传 / suffix seam / binding verify / archive cleanup) | done | HP0-action-plan §3 业务工作总表 P1-01 至 P5-01 共 8 个工作项完整覆盖 charter §7.1 In-Scope 8 项 |
| S2 | I2 — HP1 DDL 集中扩展(007-013 七张 migration + alias seed + index) | done | HP1-action-plan §3 P2-01 至 P5-02 共 7 migration + seed + closure 完整覆盖 charter §7.2 |
| S3 | I3 — HP2 Model 状态机(4 层 + `<model_switch>` + fallback audit) | done | HP2-action-plan 4 phase 覆盖 charter §7.3 全部 In-Scope 8 项;但 R2 — `<model_switch>` precedent 引用缺失 |
| S4 | I4 — HP3 Context 状态机(probe / preview / job / layers / auto-compact / strip-recover) | partial | charter §7.4 全部 In-Scope 9 项被覆盖,但 R5 中 compact job_id 复用 checkpoint UUID 的 cross-link 不显式 |
| S5 | I5 — HP4 Chat 生命周期(close / delete / title / retry / cursor / conversation_only restore) | done | HP4-action-plan 5 phase 覆盖 charter §7.5 In-Scope 8 项,checkpoint registry / restore job 字段消费已对齐 HP1 |
| S6 | I6 — HP5 Confirmation control plane + F12/F13 4 e2e | partial | charter §7.6 covered;但 R6 confirmation `superseded` 终态与 R8 e2e 文件名仅 HP5 显式 — 其他 phase e2e 命名缺位 |
| S7 | I7 — HP6 Tool/Workspace(todo / temp file / inflight / promotion / R2 namespace) | partial | charter §7.7 covered,但 R4 cleanup TTL 与 HP7 边界未显式对账 |
| S8 | I8 — HP7 Checkpoint 全模式 revert + fork + R2 file shadow snapshot + TTL | partial | charter §7.8 covered,但 R4 cleanup TTL 边界与 R5 lazy snapshot 在 worker restart 后的 D1 持久化语义在 action-plan P4-02 略浅 |
| S9 | I9 — HP8 chronic 收口(F14/F15/F6/F4/F5/F8/envelope) | partial | charter §7.9 covered,但 R7 F1-F17 状态登记仅 HP8 提及,其他 phase closure 不分摊 |
| S10 | I10 — HP9 docs + manual evidence + prod baseline | partial | charter §7.10 covered;R9 owner-action checklist 缺时点;R2 docs 中"context.md"是新增 docs 不是 precedent 引用 |
| S11 | I11 — HP10 final closure + hero-to-platform stub | partial | charter §7.11 covered;R10 R29-postmortem 输入未列;cleanup register 按 commit-hash anchor 未显式 |

### 3.1 对齐结论

- **done**:5(S1, S2, S3, S5)
- **partial**:6(S4, S6, S7, S8, S9, S10, S11)
- **missing**:0
- **stale**:0
- **out-of-scope-by-design**:0

> 这更像"主体骨架完成,但 cross-phase 细节、precedent 引用、owner-action 时点尚未收口",而不是 missing 或 stale。所有 charter In-Scope 都有 P-编号工作项落点,问题主要在 action-plan 互引与外部 precedent 的链接质量。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | charter §4.2 O1 — Multi-provider routing | 遵守 | HP2-action-plan §2.2 显式 [O1] `Multi-provider routing(O1)`;HP3 同款 |
| O2 | charter §4.2 O2 — Sub-agent / multi-agent | 遵守 | 11 份 action-plan 均无 sub-agent 痕迹;HP6 [O1] 显式排除 TodoWrite V2 task graph |
| O3 | charter §4.2 O3 — Admin plane / billing | 遵守 | HP2 [O2] `Per-team model billing / quota`、HP9 [O2] `新 API surface 继续扩张` |
| O4 | charter §4.2 O7 — 完整 handler-granularity refactor | 遵守 | HP8 P3 仅做 `megafile-budget stop-the-bleed` + `tool-drift` guard,未越界做 refactor |
| O5 | charter §4.2 O12 — SQLite-backed DO | 遵守 | 所有 action-plan 均无 SQLite-DO 痕迹 |
| O6 | charter §4.5 唯一例外 — HP9 prod baseline 补救 migration | 遵守 | HP1 P5-02 显式登记 `014+ 未触发`;HP9 P4-02 写 prod baseline 但未触及 migration apply |
| O7 | charter §4.4 R7 — 不删检测代码替代修 bug | 遵守 | HP0 P4-01 / HP10 P2-01 均 conditional on R29 postmortem,未越界删 |
| O8 | charter §4.4 R8 — DDL Freeze 受控例外 | 遵守 | HP1 P5-02 落 `schema correction registry`,HP3-HP7 各 action-plan 均无新 migration |
| O9 | charter §4.2 O11 — Sandbox / streaming progress for bash | 遵守 | HP6 P3 仅做 `tool inflight + cancel`,未触及 sandbox |
| O10 | HPX Q39 推荐线 — 外部 alias 内部统一 confirmation_pending | 误报风险 | HP5-action-plan 未显式登记 alias 兼容窗口期 — 若 owner 选了"内部统一外部 alias",HP5 P2 实施者会缺指导 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**:`changes-requested — 主体结构合格,但 R1/R2/R3 三个 critical/high blocker 必须先修才能让团队进入真正的 hero-to-pro 开发`
- **是否允许关闭本轮 review**:`no`
- **关闭前必须完成的 blocker**:
  1. **R1**:HPX-qna 39 题 owner 真正回填 — 这是 hero-to-pro 整阶段的 freeze 前提。在 owner 回填前,11 份 action-plan 状态保持 `draft`,不得转 `approved`/`ready-to-execute`;或在 charter §1.1 增列 D11 显式接受"GPT 推荐线路作为预冻结"
  2. **R2**:修订 8 份 design 头部"未 vendored"的事实错误声明,改为 `已 vendored 但作为 ancestry pointer`;选择性地在 HP2/HP3/HP5/HP7 的 4-6 个最强 precedent-依赖工作项中加 `precedent 参考: context/<path>:<lines>` 行
  3. **R3**:HP1-action-plan P1-01 重写 — 把"显式补入派生规则"改为"以 owner 已回填的 HPX 答案为准回填";同时为 HP1-HP10 各 action-plan 头部增加 `执行前置: HPX-qna.md 中本 action-plan 引用的所有 Q 必须由 owner 回填` gate
- **可以后续跟进的 non-blocking follow-up**:
  1. **R4**:HP6 P4 与 HP7 P4 加 `nano_workspace_cleanup_jobs.scope 责任分配表`
  2. **R5**:HP3 P3-02 加 `compact job 实现:job_id = nano_session_checkpoints.checkpoint_uuid where checkpoint_kind=compact_boundary`
  3. **R6**:HP5 P3 显式锁定 confirmation 终态 enum + 修 HP5 design §6.2 笔误
  4. **R7**:HP0-HP7 / HP9 closure 加 F1-F17 状态登记子任务
  5. **R8**:HP2-HP7 e2e 工作项补具体 `test/cross-e2e/<n>-...` 文件名建议
  6. **R9**:HP9 P4-01 加 owner-action 时点 checklist
  7. **R10**:HP10 P2-01 加 R29-postmortem.md 输入前置
- **建议的二次审查方式**:`same reviewer rereview`(我对 charter / design / action-plan / HPX 全链条已建立 mental model,二次复核成本最低)
- **实现者回应入口**:`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应,不要改写 §0–§5。`

> 本轮 review 不收口,等待实现者按 §6 响应并按 R1/R2/R3 三个 blocker 修订 action-plan / design 头部声明 / HPX 状态后,再次发起复核。

---

## 附 A. 审查工作量与覆盖度

- 阅读 charter 全文 1331 行(§1-§15 全节)
- 阅读 12 份 design 文档(平均 ~30KB/份,共 ~350KB)
- 阅读 HP0-action-plan 全文 462 行
- 通过 Explore subagent 完成 HP1-HP10 共 10 份 action-plan 的事实抽取(共 4701 行)
- 独立 spot-check HP1 头部 + Phase 1/2 详情(line 1-280)
- 独立完成 `context/` 目录与 design "未 vendored" 声明的事实矛盾验证
- 独立完成 HPX-qna.md 39 题 owner answer 状态核查
- 独立完成 charter §7.x 与 11 份 action-plan 的 In-Scope I1-I11 对齐核查

## 附 B. 与 design-docs-reviewed-by-opus.md 的关系

本审查针对 **action-plan 层**,不重复 design 层 review 的发现。两者的关系是:
- design review 关注"设计意图是否合理 / 边界是否清楚 / Q-decision 是否充分"
- action-plan review 关注"执行计划能否落地 / 跨 phase 依赖能否串起来 / freeze 前提是否成立"

R1-R3 是 action-plan 层独有的 blocker,与 design review 不重叠;R4-R10 是跨 phase / 跨文档的 link 缺口,部分与 design review 中已发现的"design 单 phase 看清楚、跨 phase 看不清楚"问题同源。
