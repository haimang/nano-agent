# Nano-Agent 功能簇设计模板

> 功能簇: `Z0 Contract and Compliance Freeze`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/charter/plan-zero-to-real.md`、`docs/eval/zero-to-real/plan-hardening-by-GPT.md`、`docs/eval/zero-to-real/plan-analysis-by-opus-v2.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

本设计文档讨论的是 zero-to-real 的 **Z0 设计冻结层**。它不写业务代码，也不替代后续 action-plan；它的任务是把本阶段的执行 baseline 从“方向正确”收紧为“可以据此连续产出 Z1-Z4 文档与实施包”的程度。

- **项目定位回顾**：nano-agent 已完成 `orchestration-facade`，当前要从 public façade + private runtime mesh 进入 first real run。
- **本次讨论的前置共识**：
  - `orchestration.core` 是唯一 public ingress。
  - `orchestration.auth` 必须 internal-only。
  - `nacp-core` / `nacp-session` 已是协议基石，zero-to-real 不能绕开它们。
  - D1 first-wave 必须是 **thin-but-complete**，不能再退回 too-thin persistence。
  - real client 与 real provider 都属于本阶段目标，不是收尾附属项。
- **显式排除的讨论范围**：
  - 具体表字段逐列定义
  - 具体 WorkerEntrypoint / fetch shim 代码写法
  - admin plane / dashboard / billing richness

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Z0 Contract and Compliance Freeze`
- **一句话定义**：冻结 zero-to-real 的执行边界、合规主线、文档生产顺序、以及 design handoff 纪律。
- **边界描述**：本功能簇**包含** phase scope、binding matrix、RPC rollout law、design 清单、QnA 聚合入口；**不包含** Z1-Z4 的具体实现细节。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| charter-freeze | 由基石文件直接冻结的阶段级边界 | 不是字段级设计 |
| design-handoff | 明确留给 design 文档继续冻结的细节层 | 避免 charter 过载 |
| NACP realization | 把协议 vocabulary 变成 runtime truth 的过程 | 不是“协议存在即可” |
| thin-but-complete | 范围克制，但足以支撑真实 loop / 审计 / 回看 | 与 too-thin 相对 |
| control-plane RPC-first | 先推进 start/followup/cancel/status/verify/timeline 这类内部控制调用 RPC 化 | stream-plane 可过渡 |

### 1.2 参考调查报告

- `docs/charter/plan-zero-to-real.md` — §1 / §4 / §5 / §7 / §12
- `docs/eval/zero-to-real/plan-hardening-by-GPT.md` — §3 / §4 / §5 / §6
- `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md` — §1 / §6 / §7

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **phase governance layer** 的角色。
- 它服务于：
  - zero-to-real 设计文档作者
  - 后续 Z1-Z4 action-plan 拆解者
  - review / closure 作者
- 它依赖：
  - `orchestration-facade` 已闭合的事实
  - `nacp-core` / `nacp-session` 的已发布 truth
  - `workers/orchestrator-core` 与 `workers/agent-core` 的当前 runtime 现实
- 它被谁依赖：
  - 全部 `docs/design/zero-to-real/*.md`
  - `docs/action-plan/zero-to-real/*.md`
  - 后续 Z0-Z4 closure / handoff

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| NACP realization | freeze -> design | 强 | Z0 先确定“协议是执行真理” |
| auth foundation | freeze -> Z1 | 强 | Z1 不能重新争论是否做 WeChat / pure internal auth |
| D1 schema | freeze -> ZX/Z2/Z3 | 强 | 先收紧 thin-but-complete，后谈具体表 |
| runtime/provider | freeze -> Z3 | 中 | 先定 Workers AI first，不在 Z3 重开 provider 主线 |
| clients | freeze -> Z4 | 中 | 先定 web + Mini Program 都是目标面 |
| QnA | freeze -> ZX-qna | 强 | 问题集中，不回灌 charter |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`Z0 Contract and Compliance Freeze` 是 **zero-to-real 的治理入口**，负责 **冻结阶段目标、边界、设计顺序与 compliance 主线**，对上游提供 **稳定的执行基线**，对下游要求 **所有设计与实现不得越过 frozen boundary**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 在 charter 中直接写字段级 schema | 传统大一统规划文档 | 会让 charter 与 design 混层 | 否 |
| 在 Z0 讨论完整 admin plane | `smind-admin` 的成熟 control-plane 广度 | 会吃掉 zero-to-real 主目标 | 是 |
| 在 Z0 就冻结所有 stream-plane 退役细节 | internal transport 重构类项目 | 当前真实 loop 比 transport 优雅更优先 | 是 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| QnA 决策入口 | `docs/design/zero-to-real/ZX-qna.md` | 聚合所有 owner 决策 | 后续追加 revision log |
| transport freeze | `ZX-binding-boundary-and-rpc-rollout.md` | control-plane RPC-first | stream-plane 继续收缩 |
| schema freeze | `ZX-d1-schema-and-migrations.md` | thin-but-complete first-wave | richer views / cold tier |
| provider freeze | `ZX-llm-adapter-and-secrets.md` | Workers AI first | DeepSeek / BYO key / fallback |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：charter-level boundary vs design-level specifics
- **解耦原因**：如果 Z0 继续混入字段、路由、表结构细节，后续设计文档只会变成重复抄写。
- **依赖边界**：Z0 只冻结“必须做什么、不能做什么、按什么顺序做”；具体 surface 交给 ZX / Z1-Z4。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：owner-level open questions
- **聚合形式**：统一收敛到 `ZX-qna.md`
- **为什么不能分散**：如果每份 design 各自留问题，后续 action-plan 会出现多版本口径。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：偏单进程、低层级、低治理成本。
- **亮点**：
  - 起步轻
  - 不容易陷入 phase governance 过重
- **值得借鉴**：
  - first-wave 文档必须服务实现，而不是反过来吞掉实现
- **不打算照抄的地方**：
  - 把多租户 / auth / persistence 复杂度继续压成“以后再说”

### 4.2 codex 的做法

- **实现概要**：typed protocol、阶段化 contract、边界清晰。
- **亮点**：
  - 先定 vocabulary，再落实现
  - 对 transport / event / session 语义很谨慎
- **值得借鉴**：
  - 先冻结 control-plane legality，再扩执行路径
- **不打算照抄的地方**：
  - 一开始就引入过厚的统一协议层与本地 CLI 假设

### 4.3 claude-code 的做法

- **实现概要**：中心化 control plane + 丰富 hooks / tasks / tools。
- **亮点**：
  - control plane 是显式的
  - 复杂系统里大量决定有集中治理位置
- **值得借鉴**：
  - 复杂设计要有单一冻结点与单一答复源
- **不打算照抄的地方**：
  - 本地 shell / 本地 FS / sub-agent 这类不适用 Worker 环境的默认心智

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| phase governance | 弱 | 强 | 中强 | 中强 |
| protocol-first 程度 | 低 | 高 | 中 | 高 |
| runtime environment 假设 | 本地 | 本地 | 本地 | Cloudflare Worker |
| 对多租户治理关注度 | 低 | 中 | 中 | 高 |
| 对 first-wave 边界收紧要求 | 低 | 高 | 高 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** 冻结 zero-to-real 的全局 In-Scope / Out-of-Scope。
- **[S2]** 冻结 `orchestration.core` public-only 与其他 worker internal-only 的边界。
- **[S3]** 冻结 NACP-first、thin-but-complete、real-client-driven 的方法论。
- **[S4]** 冻结 Z1-Z4 design 与 action-plan 文件清单。
- **[S5]** 把需要 owner 拍板的问题集中转交给 `ZX-qna.md`。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** 在 Z0 里决定所有字段级 contract。
- **[O2]** 在 Z0 里开始写 admin plane、billing、dashboard 设计。
- **[O3]** 在 Z0 里要求 internal HTTP 全面退役完成。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `ZX-qna.md` | in-scope | charter 不承载 QnA，但 design 阶段必须承载 |
| transport exact API shape | out-of-scope（Z0） | 交给 `ZX-binding-boundary-and-rpc-rollout.md` |
| first-wave table list | out-of-scope（Z0） | 交给 `ZX-d1-schema-and-migrations.md` |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **先冻结边界** 而不是 **直接开始分散写实现**
   - **为什么**：zero-to-real 涉及 auth / D1 / runtime / client 四条主线，不先冻结边界会立即漂移。
   - **我们接受的代价**：前置文档成本更高。
   - **未来重评条件**：无；这是本阶段的必需纪律。

2. **取舍 2**：我们选择 **charter 与 design 分层** 而不是 **把所有细节都写进基石文件**
   - **为什么**：可以把 phase freeze 与具体实现设计分开审查。
   - **我们接受的代价**：文档数量更多。
   - **未来重评条件**：如果后续阶段范围显著缩小，可回到更轻的文档集。

3. **取舍 3**：我们选择 **QnA 集中化** 而不是 **每份 design 各自留问题**
   - **为什么**：避免 owner 在多个文件上重复改口。
   - **我们接受的代价**：需要在文档间显式引用 Q 编号。
   - **未来重评条件**：如果某阶段只有单一设计文档，可不必独立 QnA。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| design 继续漂移 | Z0 不写清楚 handoff 边界 | Z1-Z4 重复争论 | 用 `charter-freeze / design-handoff` 二分法固定 |
| 讨论面过宽 | 把 admin / billing / dashboard 混入 | 主线被稀释 | 在 Z0 明确全局 Out-of-Scope |
| QnA 分散失控 | 每份文档单独提问 | 后续 action-plan 多版本口径 | 统一归档到 `ZX-qna.md` |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：可以直接按 Z0 -> Z4 的顺序推进，不必再回头改基石定义。
- **对 nano-agent 的长期演进**：为后续 real run、quota、admin plane 留出清晰后继路径。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：先把真实 loop 跑起来，后续这些能力才有可靠承载面。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Phase Boundary Freeze | 冻结 Z1-Z4 的角色与目标 | ✅ **不会再把 admin/billing 混进 zero-to-real 主线** |
| F2 | Compliance Mainline | 冻结 NACP / tenant / audit 主线 | ✅ **后续设计不得绕过 NACP-first** |
| F3 | Design Production Plan | 冻结 design / action-plan / closure 文档集合 | ✅ **后续文档生产顺序稳定** |
| F4 | QnA Routing | 把开放决策汇总到 ZX-qna | ✅ **owner 只需要回答一份清单** |

### 7.2 详细阐述

#### F1: `Phase Boundary Freeze`

- **输入**：charter、hardening 文档、Opus 分析
- **输出**：Z1-Z4 的清晰 phase boundary
- **主要调用者**：后续所有 design / review 作者
- **核心逻辑**：先定义“本阶段必须做成什么样”，再允许设计文档冻结实现面。
- **边界情况**：
  - 不能因为某条线实现困难就把它偷偷降到 out-of-scope
  - 不能把 future richness 当成 Z1-Z4 的必需品
- **一句话收口目标**：✅ **`zero-to-real` 已被收紧为“最小但完整的真实闭环”**

#### F2: `Compliance Mainline`

- **输入**：`nacp-core`、`nacp-session`、当前 `workers/**` 代码事实
- **输出**：全阶段 compliance baseline
- **主要调用者**：Z1/Z2/Z3 作者与 reviewer
- **核心逻辑**：要求所有线都回答 authority、trace、tenant boundary、audit/persistence 回挂。
- **边界情况**：
  - transport 可渐进演进
  - NACP legality 不可后置
- **一句话收口目标**：✅ **任何后续设计都不能把 NACP 降级成背景板**

### 7.3 非功能性要求

- **性能目标**：Z0 不定义数值性能阈值，但要求后续设计显式给出读写热路径与冷路径分层。
- **可观测性要求**：每份文档都必须说明 trace / audit / persistence 如何对齐。
- **稳定性要求**：QnA 答案要可持续引用，不允许分散漂移。
- **测试覆盖要求**：后续 Z1-Z4 都必须映射到可执行验证项。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/README.md` | 轻量 agent 起步方式 | 提醒我们文档必须服务实现，不要为治理而治理 | 反衬 Z0 的克制边界 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/README.md` | protocol/tool/task 的整体说明 | 先定合法 vocabulary，再扩实现 | 对 Z0 的 protocol-first 有启发 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/Task.ts` | 中央任务控制面 | 复杂系统需要明确 control plane 与治理入口 | 对 Z0 的“集中冻结点”有启发 |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `workers/orchestrator-core/src/user-do.ts` | 当前仍用 fetch-backed `/internal/*` 作为主内部控制面 | 这是真实起点，但不能被继续当长期终态 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

Z0 不是“多写一份总纲”，而是把 zero-to-real 从讨论态切到执行态的门槛文件。它的作用是先把主线、边界、顺序、QnA 入口固定下来，使 Z1-Z4 的设计不再互相争抢范围。它本身代码量为零，但对后续所有文档与实现都有高杠杆。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 不先冻结，zero-to-real 很容易失焦 |
| 第一版实现的性价比 | 5 | 文档成本低于后续返工成本 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 4 | 它为未来阶段建立清晰入口 |
| 对开发者自己的日用友好度 | 4 | 降低后续 phase 争议与 review 成本 |
| 风险可控程度 | 5 | 通过 QnA 聚合与分层冻结把风险外显化 |
| **综合价值** | **5** | **Z0 是 zero-to-real 能否连续推进的必要前提** |

### 9.3 下一步行动

- [ ] **决策确认**：Owner 在 `ZX-qna.md` 回填 Q1-Q10。
- [ ] **关联 Issue / PR**：起草 Z1-Z4 action-plan。
- [ ] **待深入调查的子问题**：
  - auth transport exact form
  - D1 activity log exact shape
  - Z2 first RPC parity target
- [ ] **需要更新的其他设计文档**：
  - `ZX-binding-boundary-and-rpc-rollout.md`
  - `ZX-d1-schema-and-migrations.md`
  - `Z1-full-auth-and-tenant-foundation.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：zero-to-real 是不是应该继续追求最小面
  - **A 方观点**：先做更薄的 demo
  - **B 方观点**：必须做最小但完整的真实闭环
  - **最终共识**：采用后者，并把 auth / D1 / runtime / client 一并纳入主线

### B. 开放问题清单（可选）

- [ ] **Q1**：`orchestration.auth` 的 exact transport form 是否直接冻结为 WorkerEntrypoint RPC-first？
- [ ] **Q5**：`nano_session_activity_logs` 的 first-wave 形态是否采用单表 + views？

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-24` | `GPT-5.4` | 初稿 |
