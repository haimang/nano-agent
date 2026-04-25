# DeepSeek vs Kimi vs Opus 作为 Code Reviewer 的特质分析

> 作者: `GPT-5.4 / GitHub Copilot CLI`
> 日期: `2026-04-25`
> 范围: `6 次评审 / 18 份文档` —— 包含 2 次文档评审与 4 次代码评审
> 参评对象: `DeepSeek V4 PRO MAX`、`Kimi K2.6 Max`、`Opus 4.7 xHigh`
> 数据来源: 六轮原始 review 文档，以及我此前已回填到各 review 文档底部的逐轮质量评价章节
>
> ⚠️ 本文评估的是 **这 6 轮具体 review 表现**，不是对三位同事“通用模型能力”的绝对裁决。分数是为了帮助比较风格、稳定性与适用场景，不是为了制造一个脱离上下文的胜负榜。

---

## 1. 整体对比和分析

### 1.1 风格画像

|  | **DeepSeek** | **Kimi** | **Opus** |
|---|---|---|---|
| 审查动作 | 倾向 **design / action-plan / closure / 代码四者对照** | 倾向 **交付完整性扫描 + 阶段债务账本** | 倾向 **高密度深审 + blocker 分层 + 终局收口** |
| 最稳定的强项 | **文档真相与实现真相对齐** | **广覆盖、可执行建议、跨阶段欠账追踪** | **高命中率、根因精度、优先级排序** |
| 典型命中类型 | ownership drift、evidence 缺口、residual inventory、ghost migration | negative tests、错误路径、类型/交付缺项、客户端补强项 | 直接 correctness bug、协议断点、design-law 违例、closure 失真 |
| 证据风格 | file/section 对照、阶段链路复盘 | checklist 式扫描、implementation follow-up | design / QnA / code / tests / docs 一体化证据链 |
| 典型盲区 | 有时“方向对但主因落点不够准”；偶有重复计数 | 事实校准不稳，容易混入过时 finding；verdict 偏松 | 个别建议会越过当前阶段，报告过密、吸收成本最高 |
| 最适合的角色 | **审计型 second reviewer** | **广覆盖 first-pass reviewer** | **final gate / rereview owner** |

### 1.2 数据层观察

- 六轮均分分别为：**Opus 9.15 / 10**、**DeepSeek 8.22 / 10**、**Kimi 6.95 / 10**。
- 六轮波动分别为：**Opus 0.5**、**DeepSeek 0.9**、**Kimi 1.3**。Opus 不只高，而且最稳；DeepSeek 次稳；Kimi 波动最大。
- 六轮 findings 总量分别为：**Opus 119**、**DeepSeek 73**、**Kimi 62**。这不等于“Opus 最好因为写得最多”，但说明它的审查粒度、拆分能力和覆盖密度明显更高。
- 文档评审与代码评审均分也很一致：**Opus 9.1 / 9.18**、**DeepSeek 8.1 / 8.28**、**Kimi 6.95 / 6.95**。这意味着三位 reviewer 的风格不是只在某一轮偶然发挥，而是跨评审类型都比较稳定。

### 1.3 一个最能概括三者差异的例子

最典型的是 **Z4 代码评审**。

- **DeepSeek** 准确抓到了 `heartbeat/replay`、`F3 evidence pack`、`F5 residual inventory`，说明它对 design/action-plan 的硬要求非常敏感；但它把 Mini Program 真实验证问题更多归因到 `touristappid`，没有优先命中真正更直接的 `/auth/wechat` 路由错误。
- **Kimi** 抓到了 `heartbeat/replay`、证据缺失、SQL 字符串拼接、deploy-fill 残留，说明它擅长把阶段债务串起来；但它漏掉了本轮最关键的直接 correctness bug，并混入了 `DeepSeek skeleton 缺失` 这种过时 finding。
- **Opus** 同时命中了 `heartbeat`、`replay cursor`、`/auth/wechat` vs `/auth/wechat/login`、`snapshot 被误称 stream`、`manual evidence 口径失真`。这说明它不仅知道“哪里没做”，还知道“哪一条是最先必须修的根因”。

这个例子几乎浓缩了三者的长期画像：**DeepSeek 擅长审计真相，Kimi 擅长扫交付面，Opus 擅长抓最硬的 blocker。**

---

## 2. 多维度打分

> 评分口径：综合 6 轮原始文档、我对每轮问题有效性的复核、以及这些问题最终是否转化为真实修复或高质量 deferred 决策。

| 维度 | DeepSeek | Kimi | Opus | 说明 |
|---|---:|---:|---:|---|
| **证据链完整度** | 8.5 | 7.2 | **9.7** | Opus 最擅长把 design / code / tests / docs 串成闭环；DeepSeek 次之；Kimi 更像 checklist 审查。 |
| **判断严谨性** | 8.1 | 6.3 | **9.3** | Kimi 的主要损失来自过时 finding、前提未校准；DeepSeek 偶有落点偏移；Opus 整体最准。 |
| **根因定位精度** | 7.8 | 6.2 | **9.5** | Z4 的 WeChat 路由错位、Z2 的 D1 伪事务、Z3 的 gateway stub/provider lineage 都是 Opus 的代表作。 |
| **覆盖维度宽度** | 8.1 | **8.4** | 9.2 | Kimi 的价值主要不在“最硬”，而在“够宽”；Opus 在高密度下依然很宽。 |
| **跨阶段复盘能力** | **8.8** | 8.0 | **9.4** | DeepSeek 与 Opus 都很强，DeepSeek 尤其适合追文档真相漂移。 |
| **修法建议可执行性** | 8.3 | 8.1 | **9.1** | Kimi 很多建议很接地气；Opus 的建议同样可执行，但会更系统化。 |
| **blocker / follow-up 分层** | 7.8 | 6.0 | **9.4** | Kimi 的 verdict 最松；DeepSeek 中等；Opus 最像真正的收口闸门。 |
| **信噪比** | 8.0 | 6.1 | **9.0** | Kimi 的噪音主要来自误报和越界项；DeepSeek 的噪音主要来自重复或次级项；Opus 最高。 |
| **协作价值** | 8.5 | 8.0 | **9.2** | 三者都能帮助实施，但 Opus 最能直接转成修复清单。 |
| **总体** | **8.2** | **7.0** | **9.2** | — |

---

## 3. 全部 review 的统计分析

### 3.1 六轮 findings 数量

| 轮次 | DeepSeek | Kimi | Opus |
|---|---:|---:|---:|
| 文档评审 #1：Z0-ZX action-plan | 14 | 12 | 20 |
| 文档评审 #2：Z0-ZX design docs | 14 | 12 | 20 |
| 代码评审 #1：Z0-Z1 | 11 | 10 | 30 |
| 代码评审 #2：Z2 | 14 | 11 | 17 |
| 代码评审 #3：Z3 | 8 | 8 | 17 |
| 代码评审 #4：Z4 | 12 | 9 | 15 |
| **总计** | **73** | **62** | **119** |
| **平均每轮** | **12.17** | **10.33** | **19.83** |

### 3.2 六轮综合评分

| 轮次 | DeepSeek | Kimi | Opus |
|---|---:|---:|---:|
| 文档评审 #1：Z0-ZX action-plan | 8.2 | 6.9 | 9.2 |
| 文档评审 #2：Z0-ZX design docs | 8.0 | 7.0 | 9.0 |
| 代码评审 #1：Z0-Z1 | 8.2 | 7.5 | 8.8 |
| 代码评审 #2：Z2 | 8.7 | 7.6 | 9.3 |
| 代码评审 #3：Z3 | 8.4 | 6.3 | 9.3 |
| 代码评审 #4：Z4 | 7.8 | 6.4 | 9.3 |
| **均分** | **8.22** | **6.95** | **9.15** |

### 3.3 稳定性观察

- **Opus**：最高分段、最低波动。说明它不是“偶尔神一把”，而是长期稳定地产出高价值审查。
- **DeepSeek**：稳定中高分，最好的一轮是 Z2，说明它在“文档—DDL—实现”纠偏类任务上特别强。
- **Kimi**：Z0-Z1、Z2 还能维持 7.5+，但到 Z3、Z4 明显下滑，说明一旦代码与设计真相快速演进，Kimi 更容易被旧前提带偏。

### 3.4 各自最有代表性的“独家价值”

| Reviewer | 最能代表其价值的命中样本 |
|---|---|
| **DeepSeek** | Z2 的 `write ownership matrix` / `nullable drift` / `payload 8KB` / `rebuild proof`；Z3 的 `003 幽灵迁移`；Z4 的 `evidence pack` 与 `residual inventory`。 |
| **Kimi** | Z0-Z1 的 `negative tests`、`unionid` 预留；Z2 的 `start 失败清理`、`checkpoint restore`；Z4 的 `SQL 字符串拼接` 与跨阶段债务账本。 |
| **Opus** | Z0-Z1 的 `D1 伪事务` / `invalid-caller`；Z3 的 `gateway stub` / `provider_key` / `lineage 丢失`；Z4 的 `WeChat 路由错位` / `snapshot 误称 stream` / `live anchor 缺失`。 |

---

## 4. Qualitative Analysis — DeepSeek

### 4.1 长处

1. **最适合做设计真相审计**：它非常擅长抓 `design / action-plan / closure / 当前代码` 四者之间的漂移。
2. **跨阶段串联能力强**：不是只看当前 diff，而是会问“这个偏差会怎样污染 Z3 / Z4 / Z5 的输入假设”。
3. **对 evidence / residual / audit trail 特别敏感**：在这个仓库，这是一项非常重要的能力，因为我们很多阶段文档都不是“装饰品”，而是后续阶段的 source-of-truth。

### 4.2 短处

1. **会出现“方向对、主因偏”的问题**：Z4 就是典型例子，命中了“真实验证缺失”，但没先抓到更直接的 `/auth/wechat/login` correctness bug。
2. **重复与拆分不够经济**：类似 Z2 的 R1 / R12、Z4 某些 docs-gap 项，存在信息域重叠。
3. **个别建议比源文档更先行**：会把“需要澄清”推向“推荐这样实现”，这在 action-plan/design review 阶段要小心。

### 4.3 综合评分

**⭐⭐⭐⭐☆ (8.2 / 10)**

### 4.4 DeepSeek 的 Verdict

> **“文档真相 / 阶段收口 / 设计纠偏型 reviewer”**
>
> DeepSeek 不是最强的 final gate，但它是很强的 **审计型 reviewer**。当任务重点是检查设计是否诚实、closure 是否过度乐观、阶段之间有没有知识污染时，DeepSeek 的价值很高。
>
> **建议使用场景**：文档评审、阶段 closure 复核、跨阶段 carry-over 审计、作为 Opus 之前或之后的 second opinion。

---

## 5. Qualitative Analysis — Kimi

### 5.1 长处

1. **覆盖宽、好消化**：Kimi 很适合当第一道大网，能快速扫出缺 tests、缺 docs、缺错误路径、缺 client hardening 之类的交付性问题。
2. **很多建议很接地气**：不像纯理论批评，往往能直接转成 checklist 或 patch 任务。
3. **适合做阶段债务总账**：特别擅长把 Z1-Z3 的残留问题带到 Z4，提醒团队不要只盯当前 diff。

### 5.2 短处

1. **事实校准是主要短板**：Z0 文档评审里的 typo/未来文件依赖，Z3/Z4 里的过时 finding，都会显著拉低可信度。
2. **容易把“值得讨论”写成“当前 blocker”**：尤其是 D1 事务建议、token-level usage、部分设计 trade-off。
3. **verdict 偏松**：在关键约束没落地时仍容易给 `approve-with-followups`，不适合单独承担 release gate。

### 5.3 综合评分

**⭐⭐⭐☆☆ (7.0 / 10)**

### 5.4 Kimi 的 Verdict

> **“广覆盖 first-pass reviewer / 阶段债务记账员”**
>
> Kimi 的价值不在于“最后拍板”，而在于 **尽早把容易漏掉的交付面问题翻出来**。如果团队现在需要的是一份更宽、更易转成 checklist 的 review，Kimi 是有价值的；但如果需要的是高精度 blocker 判断，Kimi 单独上阵不够稳。
>
> **建议使用场景**：PR 第一轮扫面、交付完整性检查、技术债/阶段债务总账、实现前的 checklist audit。

---

## 6. Qualitative Analysis — Opus

### 6.1 长处

1. **命中率最高**：这六轮里，最关键、最先必须修的问题，大多是 Opus 先抓住，或者抓得最准。
2. **根因精度最好**：它不只说“哪里不对”，而是能更早定位“真正断点在哪里”，例如 Z4 的 WeChat 路由错位，Z3 的 gateway stub 与 provider lineage，Z0-Z1 的 D1 伪事务与 `invalid-caller`。
3. **最像真正的收口 reviewer**：blocker / follow-up / future hardening 虽然都很多，但它基本知道哪些是 now、哪些是 next。
4. **跨层证据链最完整**：设计、QnA、代码、测试、closure、action-plan 往往被放在一张坐标系里判断，这对 zero-to-real 这种阶段式工程尤其重要。

### 6.2 短处

1. **少数建议超前于当前阶段**：例如直接要求 workspace import、某些 typed reject / registry SSoT 类提法，更像 next-phase hardening。
2. **阅读成本最高**：高质量的另一面是高密度，实施者必须自己做一次二次归并。
3. **有时会把“应该讨论”压到很接近 blocker 的重量**：虽然总体比另外两位好很多，但仍不是完全没有这个问题。

### 6.3 综合评分

**⭐⭐⭐⭐⭐ (9.2 / 10)**

### 6.4 Opus 的 Verdict

> **“最强 final gate / rereview owner / 阶段收口裁判”**
>
> 如果只能选一个 reviewer 来决定“现在到底能不能收口”，我会选 **Opus**。它不只是找到最多问题，而是最能找到 **真正决定阶段成败的问题**。
>
> **建议使用场景**：关键 PR 收口、阶段 closure 前 rereview、跨包 contract / runtime / transport / schema 真相校准、最终 verdict。

---

## 7. 总结性陈述：未来如何使用 Code Review

### 7.1 核心观察

1. **Opus 明显是综合能力最强、最稳、最适合做 final gate 的 reviewer。**
2. **DeepSeek 不是 Opus 的替代品，但它是非常有价值的审计型 second reviewer。**
3. **Kimi 不是最强 closeout reviewer，但它仍然是很好的 first-pass / completeness / debt-ledger reviewer。**

### 7.2 推荐的搭配策略

#### 策略 A · 重大阶段默认组合

适用于：design freeze、跨 worker 迁移、阶段 closure、真实 deploy / evidence 收口。

- **Opus**：承担 final gate、rereview、blocker 优先级裁决。
- **DeepSeek**：承担文档真相、closure honesty、carry-over 审计。
- **Kimi**：承担 completeness scan、阶段债务总账、易遗漏的交付项补扫。

#### 策略 B · 只用两位 reviewer

1. **Opus + DeepSeek**：适合严肃阶段审查、design / runtime / closure 联动问题。
2. **Opus + Kimi**：适合“一个抓 blocker、一个扫 completeness”的工程推进型场景。
3. **DeepSeek + Kimi**：只有在“暂时不做最终收口裁决、只做预审和补漏”时才建议。

#### 策略 C · 只能选一位 reviewer

1. **如果目标是 final gate / closeout verdict**：选 **Opus**。
2. **如果目标是 audit / truth-check / closure honesty**：选 **DeepSeek**。
3. **如果目标是 first-pass / checklist / debt register**：选 **Kimi**。

### 7.3 二次审查（rereview）特别建议

1. **rereview 最好由 Opus 主导**，因为它最擅长判断“修完了吗”而不是“还能补什么”。
2. **DeepSeek 很适合做 closure reread**，确认工作日志、evidence、residual 是否和真实代码一致。
3. **Kimi 更适合在 rereview 前做一次 debt sweep**，把“虽然不阻塞，但迟早要补”的项单独沉淀出来。

### 7.4 给三位 reviewer 的反向建议

#### 给 DeepSeek

- 更主动地区分 **真正根因** 与 **症状/次级表象**。
- 更积极地合并重复 finding，提升报告压缩率。
- 对 implementation 方案建议再克制一点，避免从“指出歧义”滑到“指定实现”。

#### 给 Kimi

- 在 high/critical finding 之前，先更严格地校准 **当前代码与当前文档版本**。
- 对 “值得讨论” 与 “必须阻塞” 的边界再收紧。
- 如果能加强 protocol-truth / direct correctness 验证，它的整体评分会明显上升。

#### 给 Opus

- 在保持高密度的同时，把 **now / next / later** 再拆得更显眼一点。
- 对 repo/workspace/runtime constraint 的现实边界再提前吸收一点，避免提出理论正确但当前不可直推的建议。
- 在 rereview 场景里，可进一步压缩非 blocker 旁枝，让实现者更快聚焦。

### 7.5 一句话收尾

> **如果只能选一个 reviewer 来守住 zero-to-real 这类阶段工程的最后一道门，应该选 Opus；如果要把审查体系做完整，DeepSeek 和 Kimi 仍然各自有清晰且不可替代的位置。**

---

## 附录 A：本文数据来源索引

### A.1 文档评审

1. `docs/eval/zero-to-real/Z0-ZX-action-plan-reviewed-by-deepseek.md`
2. `docs/eval/zero-to-real/Z0-ZX-action-plan-reviewed-by-kimi.md`
3. `docs/eval/zero-to-real/Z0-ZX-action-plan-reviewed-by-opus.md`
4. `docs/eval/zero-to-real/Z0-ZX-design-docs-reviewed-by-deepseek.md`
5. `docs/eval/zero-to-real/Z0-ZX-design-docs-reviewed-by-kimi.md`
6. `docs/eval/zero-to-real/Z0-ZX-design-docs-reviewed-by-opus.md`

### A.2 代码评审

1. `docs/code-review/zero-to-real/Z0-Z1-reviewed-by-deepseek.md`
2. `docs/code-review/zero-to-real/Z0-Z1-reviewed-by-kimi.md`
3. `docs/code-review/zero-to-real/Z0-Z1-reviewed-by-opus.md`
4. `docs/code-review/zero-to-real/Z2-reviewed-by-deepseek.md`
5. `docs/code-review/zero-to-real/Z2-reviewed-by-kimi.md`
6. `docs/code-review/zero-to-real/Z2-reviewed-by-opus.md`
7. `docs/code-review/zero-to-real/Z3-reviewed-by-deepseek.md`
8. `docs/code-review/zero-to-real/Z3-reviewed-by-kimi.md`
9. `docs/code-review/zero-to-real/Z3-reviewed-by-opus.md`
10. `docs/code-review/zero-to-real/Z4-reviewed-by-deepseek.md`
11. `docs/code-review/zero-to-real/Z4-reviewed-by-kimi.md`
12. `docs/code-review/zero-to-real/Z4-reviewed-by-opus.md`

### A.3 量化口径说明

- findings 数量：按各 review 文档中的 `### Rn.` 条目数统计。
- 单轮评分：采用我已回填到各 review 文档底部的“对该 reviewer 审查质量的评价”中的总体分。
- 本文总评：在复读 18 份原始文档后，对上述单轮结论重新归纳，而不是简单照抄平均数。
