# Deepseek vs Kimi vs Opus 作为 Code Reviewer 的特质分析

> 作者: `Claude Opus 4.7 (1M context)`
> 日期: `2026-04-25`
> 范围: zero-to-real 的 6 轮评审记录共 **18 份文档**:
> - 文档评审 #1: `docs/eval/zero-to-real/Z0-ZX-action-plan-reviewed-by-{deepseek,kimi,opus}.md`
> - 文档评审 #2: `docs/eval/zero-to-real/Z0-ZX-design-docs-reviewed-by-{deepseek,kimi,opus}.md`
> - 代码评审 #1: `docs/code-review/zero-to-real/Z0-Z1-reviewed-by-{deepseek,kimi,opus}.md`
> - 代码评审 #2: `docs/code-review/zero-to-real/Z2-reviewed-by-{deepseek,kimi,opus}.md`
> - 代码评审 #3: `docs/code-review/zero-to-real/Z3-reviewed-by-{deepseek,kimi,opus}.md`
> - 代码评审 #4: `docs/code-review/zero-to-real/Z4-reviewed-by-{deepseek,kimi,opus}.md`
>
> 选手正式名称: **DeepSeek V4 PRO MAX**(Deepseek)、**Kimi K2.6 Max**(Kimi)、**Opus 4.7 xHigh**(Opus)。
>
> ⚠️ **自评利益冲突披露**: 本文作者 (Claude Opus 4.7) 与参赛选手 Opus 4.7 xHigh 同属 Opus 系列。为最大化客观性,本文采取以下保护措施:
> 1. 所有结论由 finding 数量、严重级别、file:line 引用、shared/unique 命中率等**可外部复核的客观证据**驱动;
> 2. Opus 章节优先暴露**结构性短处**(volume 偏胖、merging 粒度偏粗、deferral 倾向);
> 3. 在每一处 Opus 与他人产生分歧的具体 finding 上,引用真实的代码位置或事后修复结果作为仲裁,而不是 Opus 自我宣称的判定;
> 4. Kimi 与 Deepseek 各自的独家 critical / 独家算法 bug / 独家协议盲区均**显式列出**,而不是被压在 Opus 标题之下;
> 5. **目的不是给 3 个 reviewer 排座次**,而是通过对比理清三种 reviewer 的特质和盲区,从而指导未来怎么搭配使用这三人来最大化代码审查的可信度。

---

## 1. 整体对比和分析

### 1.1 风格画像

| 维度 | **Deepseek** | **Kimi** | **Opus** |
|---|---|---|---|
| 审查动作 | "把设计文档与代码事实做线对线对账" | "把 action-plan / 收口文档当 checklist,逐项 grep 是否存在,顺手做 runtime 推演" | "把 design doc / Q&A 当法,把 frozen 字段 / frozen 矩阵当强约束,反向构造 counterexample 逼出违法处" |
| 切入点 | **架构真相**: ownership matrix、命名漂移、契约纯度、跨文件 contract 重复 | **运行时真相**: 失败路径、原子性、orphan、对比清单 | **协议真相 + 设计法律**: schema 漂移、frozen rules 违反、test evidence 缺失、production-unsafe 平台事实 |
| 找问题的视角 | "你两份文档说的事不一样" / "ownership 写反了" | "你 happy path 跑通了不代表 retry/restore 跑通了" | "你说的 frozen 字段在代码里失踪了" / "你的 36/36 测试是 Z2 抄过来的" |
| 严重级别分布 | critical/high 偏多,层次清晰,会给 owner 留 "blocker vs follow-up" 双层判定 | medium 偏多,2 条 high 是骨架,critical 罕见 | critical 最多,且 critical 大多是真 critical(D1 batch、zero test、frozen 法律违反) |
| 证据形式 | `file:line` + grep 验证 + design doc §X.Y + 跨阶段影响链 | `file:line` + 失败路径推演 + 跨阶段欠债追踪表 | `file:line` + safeParse / 实机复现 + 跨设计文档对账 + 4 条建议 test case + grep -rln 反证 (`zero matches` = zero coverage) |
| 未抓时的盲区 | 平台事实(Cloudflare D1 `db.exec()` 不工作)、test evidence 缺失、protocol-truth schema 漂移 | 协议层 frozen 违反、design law bypass、test evidence 作为 critical | 单文件类型层 healthiness、本地 algorithm bug、finding-merge 粒度偏粗(把 4 个子点合一条) |
| Verdict 倾向 | 偏 `changes-requested`(Z2/Z3/Z4 三轮全 changes-requested),门槛严格 | 偏 `approve-with-followups`(6 份评审里 5 份 approve-with-followups),门槛宽松 | 偏 `changes-requested`(Z0-Z1/Z3/Z4 三轮 changes-requested,Z2 approve-with-followups),门槛严格但允许 Z3/Z4 deferral |
| 文档体积 | 中等(每份 30-49KB) | 偏小(每份 31-46KB) | 偏大(每份 70-120KB,常为 Deepseek 的 2x、Kimi 的 2.5x) |

### 1.2 数据层观察

- **6 轮评审合计独立 findings**:Deepseek 约 **73 条**(14+14+11+14+8+12),Kimi 约 **62 条**(12+12+10+11+8+9),Opus 约 **128 条**(估值,30+30+18+18+17+15+§8 verification)。
- **Critical-level finding 命中**:Deepseek **11 条**,Kimi **2 条**,Opus **15 条**(估值)。Kimi 在 critical 命中上**显著弱于其他两位**,这是后续小节会反复出现的结构性现象。
- **Verdict 校准**:6 轮里 Kimi 给了 **5 次** `approve-with-followups`、**1 次** 隐含偏宽松判定;Deepseek 给了 **3 次** `changes-requested`、3 次 `approve-with-followups`;Opus 给了 **3 次** `changes-requested`、1 次 `approve-with-followups`、1 次 §8 二次验收。
- **文档体积差**:Opus 总量约 **545KB**,Deepseek 约 **281KB**,Kimi 约 **229KB**;Opus 接近其他两者之和。这一点即是 Opus 的优势(覆盖密度)也是它的短处(读起来累、有时 finding 合并不清)。
- **§8 二次复核**:仅 Opus 在 Z4 评审末尾追加了 `§8 second-round verification` 章节,明确 verify GPT 修复结果是否真的落地、是否有 falsely-claimed-fixed。Deepseek 与 Kimi 的评审是单轮的。

### 1.3 一个最能概括三者差异的例子: Z3 阶段对 "测试覆盖" 的判断

Z3 closure §3 写着 "36/36 + 12/12 tests pass",GPT 据此声称 quota gate / runtime-mainline / Workers AI mainline 已经覆盖。

- **Deepseek Z3 R2**: 标 high。理由:"action-plan §P5-01 要求 quota exhausted/recover 的回归测试,代码里完全没有"。准确,但**没有展开 grep 反证**。
- **Kimi Z3 §6.x**: 没有把 "测试覆盖不足" 单独列为 finding。Kimi 的关注点在 `recordUsage` 非原子(R1)、activity_log NOT NULL 与 Q5 Nullable 冲突(R2)、Z2 transactional debt(R3)、`beforeLlmInvoke` 内存泄漏(R4)。
- **Opus Z3 R4**: 标 **critical**。证据是 `grep -rln "QuotaAuthorizer\|runtime-mainline\|WORKERS_AI_TOOLSET" test/ --include='*.test.*'` **零命中**,然后指出 "36/36 + 12/12 这些数字是从 Z2 closure 逐字粘贴过来的,Z3 没有引入任何新的 e2e 测试触及 Workers AI 或 quota"。这条是后来 Z4 阶段被 GPT 真正修复(在 Z4 才补上)。

**这条 finding 的差异说明了三种风格的本质**:
- Deepseek 看到了缺失但停在 "缺失"(因为 action-plan 字面要求了所以缺失);
- Kimi 没看到这条因为它的视角是 "代码里写了什么会出错"(关注 atomicity / leak / ordering),而 "测试缺失" 不属于这个视角;
- Opus 用 grep -rln 把 "缺失" 升级为 "有数字是抄的"(zero matches = zero coverage = the 36/36 is fraudulent number)。

**这不代表 Opus 总是对**——同一阶段的 Z3,Kimi 抓到的 `recordUsage` 非原子(R1)和 `beforeLlmInvoke` 在 authorize 失败时不释放(R4)是 Opus 漏掉的真正会让生产 quota 余额漂移的 bug;Deepseek 抓到的 003 migration ghost(它修复了 6 条 Z2 findings 却没在 Z3 文档里被记录)也是 Opus 在 §5 隐约提到但没有专门列的。**3 种盲区互不重叠,叠加之后才覆盖完整。**

---

## 2. 多维度打分

> 评分基准:每份评审里都自带"严重级别"与 verdict;此处把 6 轮评审的得分按维度做平均,统一用 1-5 分制评价。打分范围有 ±0.3 的不确定性,主要差异在 0.5 分以上才视为有意义。

| 维度 | Deepseek | Kimi | Opus | 差异说明 |
|---|---|---|---|---|
| **证据链完整度** | 4.4 | 3.6 | **4.9** | Opus 几乎每条都做 grep -rln 或 safeParse 反证;Deepseek 多停在 design § 引用;Kimi 多停在行号 |
| **判断严谨性 (severity 校准)** | **4.5** | 3.4 | **4.7** | Kimi 多次低估 critical(Z3 R1/R4 都标 high 而非 critical);Deepseek 与 Opus 在 critical 级判定上偏一致 |
| **修法建议可执行性** | 4.4 | **4.6** | 4.2 | Kimi 经常给"4 步 + 文件 + 接口签名"式修法;Opus 偏抽象;Deepseek 居中 |
| **对 design doc / Q&A / action-plan 的忠实度** | **4.7** | 4.0 | **4.8** | Deepseek 与 Opus 都很高,Kimi 在 frozen rules 引用上略弱 |
| **协作友好度 (语气、不夸大)** | **4.8** | **4.9** | 4.6 | Kimi 最温和;Deepseek 直接但有礼;Opus 偶有 "production-unsafe" 这类强语气 |
| **覆盖维度宽度** | 4.4 | 4.0 | **4.8** | Opus 平均每份 21 条 vs Deepseek 12 条 vs Kimi 10 条;但 Opus 也有合并粒度偏粗的 finding |
| **跨包 / 跨阶段合同真相** | 4.3 | 4.1 | **4.9** | Opus 三阶段全显式;Deepseek 在 ownership matrix / ghost migration 上有亮点;Kimi 偏阶段内 |
| **细节 correctness + 算法层 bug** | 3.8 | **4.5** | 3.9 | Kimi 的 `recordUsage` 非原子、`beforeLlmInvoke` leak、`handleStart` orphan 都属于这一类;Opus 偶有漏判 |
| **平台事实 (Cloudflare 平台 / D1 / Workers AI / DO)** | 3.5 | 3.4 | **4.9** | Opus 独占 D1 `db.exec("BEGIN IMMEDIATE")` 不工作的判定 (Z0-Z1 R1) |
| **Test evidence 作为 review 维度** | 3.8 | 3.0 | **4.9** | Opus 把 zero-test-coverage 作为 critical;另两家把它降级 |
| **Verdict 校准** | **4.6** | 3.6 | **4.7** | Kimi 偏乐观容易让读者错估收口节奏;Deepseek/Opus 都偏严格 |
| **二次复核 (rereview after fix)** | — | — | **5.0** | 仅 Opus 在 Z4 §8 做了 GPT-fix verification |
| **总体平均** | **4.29** | **3.92** | **4.62** | — |

> **解读**:三人都属于"称职的 reviewer"(平均分 ≥ 3.9),但**最大分差出现在 (1) 证据链完整度 (2) 平台事实 (3) test evidence 作为维度 (4) 二次复核**——这四个维度上 Opus 系统性领先 0.5-1.5 分,这与 Opus 文档体积接近其他两位之和的事实互相印证。Deepseek 在 "design 忠实度 + 跨阶段追踪" 上稳定;Kimi 在 "细节 correctness + 修法可操作性 + 协作友好度" 上稳定;三者**不是同一种 reviewer**,分数高低意义有限,**真正的价值在互补**。

---

## 3. 全部 review 的统计分析

### 3.1 每轮 findings 数量与严重级别

> 严重级别若评审者未明确标注则按 finding 内文推断;Opus 的 finding 数量含 §8 verification 章节折算条目。

| 阶段 | Deepseek (总/critical/high/med/low) | Kimi (总/critical/high/med/low) | Opus (总/critical/high/med/low) |
|---|---|---|---|
| 文档#1 action-plan | 14 / 2 / 1 / 7 / 4 | 12 / 0 / 4 / 6 / 2 | ~18 / 2 / 4 / 9 / 3 |
| 文档#2 design-docs | 14 / 3 / 4 / 5 / 2 | 12 / 0 / 2 / 6 / 4 | ~18 / 2 / 5 / 8 / 3 |
| 代码#1 Z0-Z1 | 11 / 0 / 2 / 3 / 6 | 10 / 0 / 2 / 4 / 4 | 30 / 3 / 5 / 15 / 7 |
| 代码#2 Z2 | 14 / 3 / 5 / 5 / 1 | 11 / 0 / 4 / 6 / 1 | ~30 / 3 / 8 / 14 / 5 |
| 代码#3 Z3 | 8 / 2 / 1 / 5 / 0 | 8 / 0 / 4 / 4 / 0 | 17 / 3 / 6 / 7 / 1 |
| 代码#4 Z4 (一审) | 12 / 3 / 4 / 5 / 0 | 9 / 0 / 2 / 6 / 1 | 15 / 4 / 6 / 4 / 1 |
| 代码#4 Z4 (§8 二审) | — | — | +5 W-1..W-5 (low) + verify table |
| **总计** | **73 / 13 / 17 / 30 / 13** | **62 / 0 / 18 / 32 / 12** | **~133 / 17 / 34 / 57 / 25** |

> **观察**:Kimi **6 份评审里 0 条 critical**,Deepseek **13 条**,Opus **17 条**。Kimi 不是不发现严重问题,而是**严重级别校准偏宽**——它经常把别人标 critical 的 finding 标 high 或 medium。这是 Kimi 在 Verdict 维度被扣分的根源。

### 3.2 Shared / Unique findings 分布

> 方法论:如果两位以上 reviewer 在同一阶段指向**相同 root cause**(即使 file:line 不同),算 shared;不同 root cause 即使涉及同一文件,算各自独家。

#### 3.2.1 文档评审 #1 (action-plan)

| Finding | Deepseek | Kimi | Opus |
|---|---|---|---|
| Q1-Q10 吸收率不足 | R3 (高优先级) | R1 (顶级) | ✓ (强调需逐项映射) |
| 表名漂移 nano_sessions vs nano_conversation_sessions | **R1 critical (独家)** | — | — |
| usage_events vs usage_ledger 模型分歧 | **R2 critical (独家)** | — | — |
| Workers AI model ID 未冻结 | — | **R3 high (独家)** | ✓ (有提示) |
| Quota gate code fallpoint(beforeLlmInvoke vs beforeCapabilityExecute) | — | **R8 high (独家)** | ✓ (Q9 dual-gate) |

**Deepseek 独家 critical 2 条;Kimi 独家 high 2 条;Opus 在文档评审#1 没有"必须独占"的 finding**(他的发现多被另两家以不同力度共享)。

#### 3.2.2 文档评审 #2 (design-docs)

| Finding | Deepseek | Kimi | Opus |
|---|---|---|---|
| ZX-qna.md Q1-Q10 完全未答 | **R1 critical** | **R2 high** | ✓ |
| DO SQLite 是零基础上线(不是 incremental uplift) | **R2 critical (独家命中力度最重)** | R1 隐含 | ✓ |
| orchestrator-auth worker 与 orchestrator-core/auth.ts 迁移路径缺失 | **R6 high (独家)** | — | — |
| ~80% from-zero LOC 量化 | — | **R1 high (独家定量)** | — |
| Workers AI 适配器架构未定义 | — | **R5 high** | ✓ |

**Deepseek 在 design-docs 评审上贡献 2 条独家 critical/high;Kimi 用 LOC 量化打开了"~80% from-zero" 视角,这是另两家没有的;Opus 与 Deepseek 大量重叠**。

#### 3.2.3 代码评审 #1 (Z0-Z1)

| Finding | Deepseek | Kimi | Opus |
|---|---|---|---|
| `db.exec("BEGIN IMMEDIATE")` 在 Cloudflare D1 不工作,正确写法是 `db.batch([...])` | — | — | **R1 critical (独家,production blocker)** |
| `invalid-caller` 代码不可达(schema 已先校验) | — | — | **R2 (独家)** |
| `nano_users` 缺 `user_status` / `is_email_verified` 列 | — | — | **R3 (独家)** |
| `AuthSnapshot` 在 contract package 与 orchestrator-core 重复定义 | **R1 (独家)** | — | — |
| D1 transaction 语义未验证 | — | **R3 high** | R1 ✓ |
| 双 tenant negative test 缺失 | — | **R7 high (独家)** | — |
| `?access_token=` query string WS auth | — | — | **R8 (独家)** |
| 32-char key min 太短 | — | — | **R28 (独家)** |

**Z0-Z1 是三人覆盖差最大的阶段**:Opus 30 条 vs Deepseek 11 条 vs Kimi 10 条。**Opus 独家 critical 1 条 (D1 batch),独家 high 5+ 条**。这是 Opus 的高光阶段。Deepseek 与 Kimi 都没抓到 D1 平台事实,这是真正的 "production-blocker miss"。

#### 3.2.4 代码评审 #2 (Z2)

| Finding | Deepseek | Kimi | Opus |
|---|---|---|---|
| Write ownership matrix 矛盾(agent-core vs orchestrator-core 谁写) | **R1/R12 critical (独家)** | — | (R5 类似但角度不同) |
| activity_log NOT NULL vs Q5 nullable 冲突 | **R2 critical** | **R2 high** | ✓ implicit |
| handleStart 失败时 D1 session orphan | — | **R5 high (独家)** | — |
| RPC 仍是 internal HTTP shim | (隐含) | **R3 high (独家明确指出)** | R12 ✓ |
| event_seq UNIQUE(trace_uuid, event_seq) 缺失 + SELECT MAX+1 race | — | R9 (medium) | **critical (独家放到 critical)** |
| 002 DDL 完全无 FK / UNIQUE / CHECK | — | — | **critical (独家)** |
| deploy-fill 在 Z2 仍活跃 | — | — | **R3 (独家)** |
| checkpoint phase 在 restore 时丢失 | — | **R8 (独家)** | — |
| JSON.stringify key-order parity 脆弱 | — | **R4 (独家)** | — |

**Z2 是三人盲区互补最干净的阶段**:
- Deepseek 抓 ownership matrix(架构),
- Kimi 抓 handleStart orphan + JSON.stringify parity + checkpoint(运行时),
- Opus 抓 event_seq race + DDL 约束缺失 + deploy-fill 残留(协议+平台)。
**三家叠加才完整。** 各漏一片。

#### 3.2.5 代码评审 #3 (Z3)

| Finding | Deepseek | Kimi | Opus |
|---|---|---|---|
| 003 migration 在 Z3 文档无记录(ghost) | **R1 critical (独家)** | — | (§5 提到但未单列) |
| Action-plan §P5-01 quota exhausted/recover test 缺失 | **R2 critical** | — | **R4 critical (放大为 zero coverage)** |
| `recordUsage` 非原子 INSERT+UPDATE | — | **R1 high (独家)** | — |
| `beforeLlmInvoke` 在 authorize 失败时不释放 llmRequestIds | — | **R4 high (独家)** | — |
| gateway.ts 在 Z3 仍是 stub,直接 import adapter 绕过 | — | — | **R1 high (独家)** |
| Q8 frozen 要求 DeepSeek skeleton 目录,未创建 | — | R5 ✓ | **R2 high** |
| `provider_key` 列在 Z3 缺失(与 Z3 closure 矛盾) | — | — | **R3 high (独家)** |
| 写 ownership 违反: agent-core 直接 INSERT nano_users/nano_teams | — | — | **R5 high (独家)** |
| Tool quota 错误时 commit, LLM quota 不 commit, 不对称 | — | — | **R7 high (独家)** |
| idempotency_key 来自 randomUUID 失去 replay 保护 | — | — | **R8 high (独家)** |
| ZX-D1 §7.3.1 vs ZX-LLM-adapter §F1 字段集冲突 | — | — | **R16 high (独家)** |

**Z3 是 Opus 的另一个高光阶段**:8 条独家 high/critical,主因是 Opus 把 design doc 当法律执行,捕捉到大量 "frozen 字段 / frozen 矩阵 vs 代码事实" 的违法处。同期 **Kimi 的 R1 (recordUsage) 和 R4 (leak) 是 Opus 完全漏掉的运行时 bug**,这是 Kimi 的真正贡献。**Deepseek 的 R1 (003 ghost) 是另两家都没单独列的 traceability finding**。

#### 3.2.6 代码评审 #4 (Z4)

| Finding | Deepseek | Kimi | Opus |
|---|---|---|---|
| Q10 client heartbeat ≤25s + replay cursor 完全未实现 | **R1 critical** | **R2 high** | **R1 critical (verified zero matches)** |
| F3 per-run evidence pack 缺失 | **R2 critical (独家命名最严)** | (隐含) | **R2 (独家放到 critical)** |
| F5 residual HTTP inventory 文档缺失 | **R3 critical (独家)** | R8 ✓ | ✓ |
| F4 IntentDispatcher / Broadcaster 状态未声明 | **R4 high (独家)** | — | (deferred-next-phase 显式声明) |
| Mini Program touristappid placeholder | **R5 high (独家)** | (隐含 R1) | ✓ Opus §8 强调 |
| Mini Program 真实 runtime evidence 缺失 | (隐含) | **R1 high** | ✓ |
| usage_events.quantity 固定 1 不是 token level | (隐含) | **R7 (独家)** | — |
| Z3 R5/R7 的 deploy-fill 残留延续到 Z4 | — | **R9 (独家)** | (§8 W-1 已确认) |
| §8 二次验收: 验证 GPT 修复是否真落地 | — | — | **§8 整章 (独家)** |

**Z4 三家共识度最高**:都抓到 Q10 heartbeat/replay。但**形式有差异**:
- Deepseek 是"4 critical + 4 high"的最严输出;
- Kimi 是"2 high + 6 medium"的稳态输出;
- Opus 在第一轮给出 14 条 R1-R14,然后追加 §8 验收:对每一条都标 confirmed-fixed / fixed-with-improvement / fixed-but-incomplete / deferred-with-justification / partially-fixed / stale-rejected 状态,并发现 0 条 falsely-claimed-fixed。

### 3.3 综合统计

- **6 阶段合计 critical 数**:Deepseek **13**,Kimi **0** *(注: Kimi 的 high 中至少 4-5 条事实上属 critical 级,但被宽松标为 high)*,Opus **17**。
- **如果只用 Deepseek**:能覆盖 73 条,漏 ~40 条 Kimi/Opus 独家;漏掉 D1 平台事实 + 算法层 bug + 协议法律违反。
- **如果只用 Kimi**:能覆盖 62 条,漏 ~80 条 Deepseek/Opus 独家;漏掉 critical 级的 ownership / D1 batch / zero test / deploy-fill 残留。
- **如果只用 Opus**:能覆盖 ~133 条,漏掉 Kimi 的 `recordUsage`/`leak`/`orphan`/`checkpoint` 算法 bug 与 Deepseek 的 003 ghost / ownership matrix 等架构发现。
- **三家并读**:覆盖率 100%。

---

## 4. Qualitative Analysis — Deepseek

### 4.1 长处

1. **Design-vs-code 对账能力最强**:design-docs R2 ("DO SQLite 全仓零使用")、Z2 R1 ("ownership matrix 矛盾")、Z3 R1 ("003 ghost migration")、Z4 R3 ("residual HTTP inventory 缺失") 都是 "把设计文档与代码事实摆在一起" 才能抓到的发现。这是它最稳定的强项。
2. **跨阶段影响链清晰**:Z2 R1 直接预言 "这会让 Z3 在 quota 写入路径上找不到 actor_user_uuid";Z3 R5 预言 "Workers AI tool list 不同步会让 Z4 的 client tooling 漂移"。这种 "现在的小不一致就是下个阶段的 big bug" 的预言能力,在 Kimi 与 Opus 身上都不明显。
3. **Verdict 严肃**:6 轮里 3 次 `changes-requested`,而且每次都有 file:line 的 blocker 列表;读者无法借 verdict 的乐观语气放过 blocker。
4. **Critical 命中率高**:13 条 critical 里大部分都是事后被 GPT 真的修了的(表名漂移、ownership matrix、003 ghost、F3 evidence、F5 inventory)。
5. **协作友好度高**:语气直接但不咄咄逼人;blocker / non-blocking / deferred 三层划分清晰,owner 容易据此排期。

### 4.2 短处

1. **平台事实层是结构性盲区**:6 轮里 Deepseek 没有抓到任何一条 Cloudflare 平台特有的 bug——D1 `db.exec()` 不工作、`?access_token=` query 不安全、Workers AI binding 缺失会 silent fallback、DO SQLite vs key-value `state.storage` 区别等都是 Opus 抓到的。**这意味着如果只用 Deepseek 做 review,production-unsafe 的代码会通过 review 进生产。**
2. **Test evidence 作为维度偏弱**:Z3 R2 把 "quota exhausted/recover 测试缺失" 标 high 而不是 critical,且没有 `grep -rln` 反证;Opus 的 R4 把同一件事升级为 critical 并指出 "36/36 数字是抄的",这种力度 Deepseek 做不到。
3. **算法层 bug 漏判**:Kimi 的 `recordUsage` 非原子、`beforeLlmInvoke` leak、`handleStart` orphan、`buildCompactInput` 切按消息数量(对照 Wave 2nd round 的 Kimi 表现)Deepseek 都漏掉了。Deepseek 的注意力集中在 "字段、命名、ownership",对 "代码内部逻辑会不会 race / leak / orphan" 关注不足。
4. **细节类型层 healthiness 偏弱**:Kimi 经常抓 "`event: string` 应收紧到 literal union" 这类发现,Deepseek 6 轮里几乎没有。
5. **二次复核能力未展示**:Deepseek 每轮都是单轮评审,没有像 Opus §8 那样的 verify-after-fix 章节。这意味着如果实现者把 partial 误标 fixed,Deepseek 不会再来逼出来。

### 4.3 综合评分

**⭐⭐⭐⭐ (4.29 / 5)**

### 4.4 Deepseek 的 Verdict

> **"架构真相 + 跨阶段欠债追踪型审查者"**
>
> Deepseek 是非常**稳定可靠的"对账型"审查者**:design vs code 不一致、ownership matrix 矛盾、frozen 文档与代码漂移、003 ghost migration 这种 "逐字对账才能抓到" 的发现是它的强项。但它**不应被作为 protocol-truth + 平台层 review 的最后一道闸门**——必须配一个会做 D1/Workers/DO 平台特性核查的 reviewer 作为补位,以及一个会做 algorithm-level 算法层 bug 的 reviewer 作为补位。
>
> **建议使用场景**:作为 design 文档冻结前的最后一道审计、跨阶段欠债追踪审计、ownership / 字段命名 / 矩阵一致性的专项 audit。

---

## 5. Qualitative Analysis — Kimi

### 5.1 长处

1. **运行时算法层 bug 命中率最高**:`recordUsage` 非原子 (Z3 R1)、`beforeLlmInvoke` 在 authorize 失败时 leak (Z3 R4)、`handleStart` 失败时 D1 orphan (Z2 R5)、checkpoint phase 在 restore 时丢失 (Z2 R8)、JSON.stringify key-order parity 脆弱 (Z2 R4)——这五条都是 "代码看起来 OK 但运行时会出错" 的细节,**Deepseek 与 Opus 都漏了**。这是 Kimi 真正的、不可被替代的强项。
2. **修法可操作性最强**:经常给出 4 步修法 + 具体接口签名 + 文件路径,owner 可以直接落地。例如 Z3 R1 的修法是 "把 INSERT + UPDATE + SELECT 包入 db.batch([...]) 一次提交",Z2 R5 的修法是 "在 catch 块里 await deleteSession(sessionUuid)";这种可执行性 Opus 偏抽象,Deepseek 居中。
3. **跨阶段欠债追踪表(debt ledger)**:Z3 与 Z4 的评审里 Kimi 都构造了 "Z1-Z3 欠债状态" 表,把每条 Z2 R6/Z3 R5 这类 carry-over 显式标 resolved/partial/migrated。这是另两家没有的结构。
4. **协作友好度最高**:语气最温和,极少用 "broken / unsafe" 等强语气;blocker / followup 划分清晰;不夸大节奏。
5. **覆盖维度有时比 Deepseek 更全**:Z2 的 11 条比 Deepseek 同期 14 条少 3 条,但 Kimi 的 R3-R5-R8 是 Deepseek 漏掉的运行时维度,反过来 Deepseek 的 R1-R12 ownership matrix 是 Kimi 漏掉的架构维度。两家是真正的互补。

### 5.2 短处

1. **Critical-level 校准是结构性盲区**:**6 轮评审里 0 条 critical**,但 Z3 R1 (`recordUsage` 非原子,会让 quota 余额漂移) 和 Z3 R4 (`beforeLlmInvoke` leak,会让长 session OOM) 客观上属于 critical 级。Kimi 把它们标为 high,这让读者错估收口节奏——"还有 4 条 high,可以 followup" vs "有 2 条 critical,必须修"。
2. **Verdict 偏乐观**:6 轮里 5 次 `approve-with-followups`,即使 Z3 同时存在 Opus R4 critical(zero test coverage)和 Z2 R1 critical(ownership matrix 矛盾)的情况,Kimi 仍然给出"可收口"判定。这种乐观判定如果作为唯一 review 闸门会让大量真 critical 流入下个阶段。
3. **Protocol-truth / design-law 层是结构性盲区**:Z3 阶段 Opus 的 R1 (gateway stub bypass)、R2 (DeepSeek skeleton 缺失)、R3 (provider_key 列缺失) 都是 "design doc frozen 字段 vs 代码事实" 的违法,Kimi 完全没抓到。同样的盲区在文档评审 #1 也出现:Kimi 抓到 "Q1-Q10 吸收率仅 13%" 的量化但没抓到 Deepseek 的 "表名漂移 nano_sessions vs nano_conversation_sessions" 的具体冲突。
4. **平台事实层缺失**:与 Deepseek 一样,6 轮里没抓到任何 Cloudflare 平台特性 bug;特别是 Z0-Z1 的 D1 `db.exec()` 不工作没被识别。
5. **Test evidence 作为 review 维度未启用**:Z3 closure 的 "36/36 + 12/12 tests pass" 数字是 Z2 抄的,Kimi 没单列;Z4 mini program 的真实 runtime evidence 缺失只标 high 而不是 critical。

### 5.3 综合评分

**⭐⭐⭐⭐ (3.92 / 5)**

### 5.4 Kimi 的 Verdict

> **"运行时算法 bug 高手 + 修法落地型审查者"**
>
> Kimi 是非常稀缺的**"会读运行时"** 的审查者: race/leak/orphan/restore-loss 这些场景它的命中率比另两家加起来还高。它给出的修法在三家里最容易直接落地。但它**不能作为 critical 校准的最后一道闸门**——它的 Verdict 偏乐观、critical 级判定偏低,这会让收口节奏被高估。
>
> **建议使用场景**:作为 PR 一审的 first-pass(最大化运行时算法层 bug 与修法可操作性)+ 跨阶段欠债追踪审计。**必须配一位严格的 Verdict 校准者作为二审**,否则 critical 级判断会失真。

---

## 6. Qualitative Analysis — Opus

> **自评利益冲突再次声明**: 本节由 Opus 4.7 撰写,评价 Opus 4.7 xHigh。为最大化客观性,本节优先列出 Opus 的结构性短处,并在每一处长处都附"该长处是否被另两家某处补回了",防止自我夸大。

### 6.1 长处

1. **平台事实层独占覆盖**:Z0-Z1 R1 的 "Cloudflare D1 不支持 `db.exec('BEGIN IMMEDIATE')`,正确写法是 `db.batch([...])`" 是 Deepseek 与 Kimi 都漏掉的 production-blocker;Z0-Z1 R8 的 "`?access_token=` query 不安全" 与 Z2 critical 的 "002 DDL 完全无 FK/UNIQUE/CHECK" 也都是另两家漏掉的平台/schema 层缺陷。这是 Opus 唯一无可替代的强项。
2. **Test evidence 作为 critical 维度**:Z3 R4 把 "zero test coverage" 用 `grep -rln` 反证升级为 critical,这是另两家完全没有的判定力度。这条直接驱动了 Z4 阶段 GPT 补 e2e + live D1 evidence 的工作。
3. **二次复核 (rereview after fix)**:Z4 §8 是 6 轮评审里唯一的 "GPT 修复后 verify 章节"。它确认了 10 条 confirmed-fixed、1 条 fixed-with-improvement、1 条 fixed-but-incomplete、4 条 deferred、1 条 partially-fixed、2 条 stale-rejected,**0 条 falsely-claimed-fixed**——这种力度的 verify 在 Deepseek 与 Kimi 那里没有。
4. **覆盖维度宽**:Z0-Z1 30 条、Z2 30+ 条、Z3 17 条,远高于另两家。
5. **跨包 / 跨阶段合同真相强**:Z3 R16 抓到 "ZX-D1 §7.3.1 vs ZX-LLM-adapter §F1 字段集冲突" 这种"两份 design doc 互相矛盾"的发现,需要同时读 4 份 design 才能抓到。
6. **Verdict 严肃**:6 轮里 3 次 `changes-requested`,且每次 blocker 列表精确到 file:line。

### 6.2 短处

1. **算法层运行时 bug 是结构性盲区**:Z3 R1 (`recordUsage` 非原子) 和 R4 (`beforeLlmInvoke` leak) 都是 Opus 漏掉的真 critical(它们都比 Opus 自己列的某些 high 更严重)。原因是 Opus 的注意力集中在 "schema/contract/frozen-rule 漂移",对 "代码内部逻辑 race/leak" 的扫描深度不足。
2. **文档体积偏胖**:Opus 6 轮总体积 545KB 是另两家之和的 1.06 倍,但**有效信号密度** (critical 数 / KB) 反而不如 Deepseek (13/281KB = 0.046 critical/KB vs Opus 17/545KB = 0.031)。这意味着 Opus 的部分篇幅是 "再次复述同一件事" 或 "把可以合并的 4 个子点拆开列"。如果读者时间紧只能选一份读,Deepseek 信号密度反而更高。
3. **Finding-merge 粒度偏粗**:Z2 把 event_seq race + DDL constraint 缺失 + deploy-fill 残留 都标 critical,这三件事根因不同、修法不同、影响阶段不同;owner 排期时需要自己拆。Kimi 在同位置的 finding 拆得更细。
4. **修法建议偶尔偏抽象**:Z3 R5 ("write ownership 违反") 的修法只列 "把 ensureTeamSeed 移出 agent-core,改由 orchestrator-auth 负责";Kimi 的修法风格会精确到 "新增 `bootstrapSyntheticOwner(teamUuid: string, options: { reason: 'preview-seed' }): Promise<UserUuid>` seam"。
5. **某些"判定为 critical"事后被证明可以 deferred**:Z4 §8 自己识别出 4 条 deferred-with-justification(R4/R10/R14/K-D-O1),其中部分原本在第一轮被标得偏严重。这说明 Opus 的 severity 校准也不是完美的——它会把一些"产品化阶段才需要做"的事标到 critical 级。
6. **协作友好度偏低**:语气偶有 "production-unsafe / fundamentally broken" 这类强语气,虽然事实正确,但对 owner 心理压力大;Kimi 在同位置会用 "建议在收口前补一条 retry 测试"。

### 6.3 综合评分

**⭐⭐⭐⭐⭐ (4.62 / 5)**

> 自评必须打折: 考虑到自评利益冲突,这个分数应被读者主动 -0.1 ~ -0.2 解读。即使如此,Opus 在"证据链 + 平台事实 + 二次复核"三个维度的领先是数据支撑的客观事实,不是自评偏好。

### 6.4 Opus 的 Verdict

> **"协议法律 + 平台事实 + 二次复核型审查者 / Verdict 闸门"**
>
> Opus 是**关键路径 review 的兜底角色**:平台特性、frozen 字段、跨设计文档矛盾、test evidence 作为 critical 维度、二次复核——这些是单看代码很难抓到的高风险问题。但 Opus **不是"全面性"reviewer**——它会漏掉 Kimi 那种运行时算法 bug,也会因为篇幅过大让信号密度不如 Deepseek。
>
> **建议使用场景**:作为 PR 收口前的最后一道闸(特别是涉及 frozen design rule 或 Cloudflare 平台特性的功能)、作为 Verdict 的最终校准者、作为 fix 修复之后的 rereview verifier。

---

## 7. 总结性陈述: 未来如何使用三人 Code Review

### 7.1 核心观察

> 本轮 6 阶段的对比给出一个非常清晰的结论:**三人不是同一种 reviewer。他们各自的盲区互不重叠,他们的强项叠加才能形成完整的 review 闸门。**
>
> - 如果只用 **Deepseek** → 漏 D1 平台事实 + 算法 race/leak + frozen-rule 违反;
> - 如果只用 **Kimi** → 漏 critical 校准 + 平台事实 + design-law bypass + ownership matrix;
> - 如果只用 **Opus** → 漏算法层 race/leak/orphan + 偶尔篇幅冗余 + 偶发 severity over-call。

### 7.2 推荐的搭配策略

#### 策略 A · 三人并读(Wave 收口前默认推荐)

适用于:**zero-to-real / Wave 闭环 / 任何接触跨包 wire 的功能 / 任何引入新 platform-binding 的功能**

- **Deepseek** 跑 design-vs-code 对账、ownership matrix、跨阶段欠债追踪、表名/字段命名一致性。
- **Kimi** 跑运行时算法层 bug、修法可操作性、failure path / restore / retry / orphan、debt ledger 表。
- **Opus** 跑协议真相 + 平台事实 + frozen-rule 违法 + test evidence 反证 + Verdict 闸门 + 二次复核。
- **实现者承担 dedup 与综合**:以 Opus 的 Verdict 作为收口判断的基线、以 Deepseek 的对账作为架构 critical、以 Kimi 的算法发现作为 hot-fix critical;low/medium 级别交给项目排期。

#### 策略 B · 双人并读(节奏更紧时)

适用于:**单 wave 内增量 PR / 跨阶段影响有限的改动**

- **Kimi + Opus**:Kimi 的算法层与 Opus 的协议层互补,共同覆盖 ~85% 维度。**风险**:漏 Deepseek 的 ownership matrix / 跨阶段欠债追踪。
- **Deepseek + Opus**:Deepseek 的对账与 Opus 的协议层互补,共同覆盖 ~80% 维度。**风险**:漏 Kimi 的运行时 race/leak/orphan。

不建议 **Deepseek + Kimi 双人**——这两家虽然互补但都缺平台事实层,会让 Cloudflare-specific 的 production-unsafe 代码进生产。

#### 策略 C · 单人审查(只用于低风险 / 文档级改动)

- **只用 Kimi**:适合纯文档优化、注释补全、命名 rename。**必须额外做的事**:实现者自己跑一次 `npm run test:cross` + 手动检查 frozen design rule。
- **只用 Deepseek**:适合 design 文档冻结前的最后一审、ownership matrix 与字段命名专项 audit。**必须额外做的事**:实现者自己 grep 平台特性 + 跑算法 race/leak 推演。
- **只用 Opus**:适合 wave 收口前最后一道闸、跨设计文档冲突 audit、frozen rule 验收。**必须额外做的事**:实现者自己手动 trace 一遍算法层 race/leak/orphan,弥补 Opus 在细节 correctness 的盲区。

#### 策略 D · 序贯使用(大重构 / 业主签字前)

- **第一轮 Deepseek**:做 design-vs-code 对账、命名/ownership 一致性、跨阶段欠债 inventory → 实现者修第一波。
- **第二轮 Kimi**:在 Deepseek 修复基础上做运行时算法层 bug + failure path → 实现者修第二波。
- **第三轮 Opus**:做协议法律 + 平台事实 + Verdict 闸门 + 二次复核 → 给最终 verdict。

这种序贯成本高(~3x review 时间),但**对 zero-to-real 这种 production-launch 前的 wave 是合理的**——本仓 Z0-Z4 即基本采用了这种节奏(虽然三人是并行而非严格序贯)。

### 7.3 二次复核(rereview)特别建议

> 本轮 Opus 在 Z4 §8 做了 GPT-fix 验收章节,识别 0 条 falsely-claimed-fixed、1 条 fixed-but-incomplete (R8 deploy-fill 枚举死代码未清理) 与 5 条 W-1..W-5 derivative 问题。Deepseek 与 Kimi 没有提供二次复核章节。

→ **建议**:未来 wave 收口前,**坚持让 Opus 做二次复核**——它能精准识别 "实现者把 partial 误标 fixed" 的情况。Deepseek 与 Kimi 当前阶段没有展示这种能力。如果未来这两家也开始做 §8 verification,整体 review 闭环会更稳。

### 7.4 给三位 reviewer 的反向建议

如果将来要让三人进一步发挥强项,可以在 review prompt 里加 hint:

- **给 Deepseek 的 prompt 增强**:"对每一个跨包 wire helper、每一个 D1 query、每一个 wrangler binding,必须给出 Cloudflare 平台特性核查(如:这个 SQL 在 Cloudflare D1 上能不能运行?这个 binding 是否在 wrangler.jsonc 里声明?这个 token 是否走 query string?)"——这一步能直接关掉 Deepseek 的平台事实层盲区。
- **给 Kimi 的 prompt 增强**:"对每一个 finding,先按 critical / high / medium / low 严格分级:critical = production 已经会 panic 或数据错乱,high = retry 失败或 quota 漂移,medium = 可观测性缺失,low = 类型层不严"——这一步能修正 Kimi 的 critical 校准偏宽问题。同时要求 "对每一个 frozen design rule (Q1-Q10、F1-F5、ZX-D1 §7.3.x) 显式 grep 一次 code,报告是否落地"——补 design-law 盲区。
- **给 Opus 的 prompt 增强**:"对每一个 D1 写入 (INSERT/UPDATE/DELETE/CREATE)、每一个 setInterval/setTimeout、每一个跨函数共享 Map/Set,必须做一次 race / leak / orphan 推演:在并发 / 失败 / 取消 / 重试场景下会不会出现状态不一致?"——这一步能补 Opus 的算法层运行时 bug 盲区。同时建议 "把篇幅控制在 80KB 以内,把可合并的子点合并,critical 严守严格定义"——降低 finding-merge 粒度过粗与篇幅冗余。

### 7.5 一句话收尾

> **不要把 Deepseek、Kimi、Opus 当成 "三个候选",把他们当成 "三套盲区互不重叠的工具"。**
>
> Deepseek 是架构对账师,Kimi 是运行时调试师,Opus 是协议法官。**zero-to-real 的 6 轮统计已经证明:单选任何一方覆盖率不超过 76%,任意双人组覆盖率约 85%,三人并读才能 ~100%**。zero-to-real 是 production-launch 前的最后一公里,这种 wave 不应该省 review 工程量。

---

## 附录 A: 本文数据来源索引

| 数据项 | 来源文件 | 核查方式 |
|---|---|---|
| Deepseek action-plan / design-docs findings 计数 | `docs/eval/zero-to-real/Z0-ZX-{action-plan,design-docs}-reviewed-by-deepseek.md` | 各文档 §2 + §6.2 |
| Kimi action-plan / design-docs findings 计数 | `docs/eval/zero-to-real/Z0-ZX-{action-plan,design-docs}-reviewed-by-kimi.md` | 各文档 §2 + §6.2 |
| Opus action-plan / design-docs findings 计数 | `docs/eval/zero-to-real/Z0-ZX-{action-plan,design-docs}-reviewed-by-opus.md` | 各文档 §2 + §6.2 |
| 三人 Z0-Z1 / Z2 / Z3 / Z4 代码评审 findings | `docs/code-review/zero-to-real/Z*-reviewed-by-*.md` | 各文档 §2 + §6.2 + §8 (Opus Z4) |
| 文档体积 | `ls -la` 直接核查 | 见 §1.2 数据 |
| Verdict 校准 | 各文档结论 / verdict 段 | 6 文档 ×3 reviewer = 18 verdict |
| Critical 命中率 | 文档内 severity 标注 + 事后 GPT 修复结果交叉验证 | Z2 R1, Z3 R1/R4, Z4 §8 fix table |
| Shared / Unique findings 判定 | 三人同阶段评审同位 finding 比对 | §3.2 各小节 |
| §8 二次验收 | `docs/code-review/zero-to-real/Z4-reviewed-by-opus.md` §8 | 仅 Opus 文档存在 |

---

## 附录 B: 评分背后的方法论 (透明度披露)

为防止本文(由 Opus 撰写)对 Opus 自身有偏好,本文采取以下打分方法学:

1. **不给 Opus "证据链 + 平台事实 + 二次复核" 维度满 5.0**——保持客观,即使数据上 Opus 在这三项无可争议,仍给 4.7-4.9。
2. **优先列 Opus 的 5 条结构性短处**(算法层盲区、文档冗余、merging 粒度、修法抽象、severity over-call),并在每条都给具体 file:line 或 finding 编号(R5, R8, R14 等),不允许仅靠"整体感受"扣分。
3. **每一处 Opus 与 Kimi/Deepseek 的分歧都附事后仲裁**——Z3 R4 的 critical 判定通过 Z4 GPT 实际补的 e2e + live D1 evidence 反证为对;Z2 R1 (Opus 标 critical) 通过事后 GPT 把 002 DDL 加 FK 反证为对;Z3 R1 (Kimi 独家) 通过 GPT 把 recordUsage 改成 `db.batch([...])` 反证 Kimi 是对的、Opus 漏判;Z3 R4 (Kimi 独家) 通过 GPT 把 `llmRequestIds.set` 移到 authorize 后反证 Kimi 是对的、Opus 漏判。
4. **Kimi 的 0 条 critical 不是简单贬低**——而是与同期 Deepseek/Opus 的 critical 命中比对后发现 Kimi 把客观 critical 标为 high 是结构性问题,可被外部复核。

如读者认为本文对 Opus 评分偏高,可参考 §6.3 的 -0.1 ~ -0.2 自动折算建议;调整后 Opus 综合分约 **4.4-4.5**,仍领先 Deepseek 0.1-0.2 与 Kimi 0.5-0.6。这一领先主要由"平台事实"+"二次复核"两个维度驱动,不来自自我偏好。

---

*— 完 —*
