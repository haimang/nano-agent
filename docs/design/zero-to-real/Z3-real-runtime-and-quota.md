# Nano-Agent 功能簇设计模板

> 功能簇: `Z3 Real Runtime and Quota`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/charter/plan-zero-to-real.md`、`docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md`、`docs/design/zero-to-real/ZX-nacp-realization-track.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

Z3 要把 loop 里“看起来已经有了、其实还是假的”部分换成真的：真实 provider、真实 quota gate、真实 usage evidence，以及收紧 runtime mesh 的 internal transport 纪律。当前仓库最接近 quota 的现成 seam 是 `workers/bash-core/src/executor.ts` 里的 `beforeCapabilityExecute()`；最接近 real runtime 的现成骨架是 `workers/agent-core/src/kernel/runner.ts`。Z3 的任务是把这些骨架接上真实主路径。

- **项目定位回顾**：Z3 是 zero-to-real 从“持久化真实”走向“执行真实”的阶段。
- **本次讨论的前置共识**：
  - required provider 只有 Workers AI。
  - fake provider 必须退为 test/demo path。
  - quota 必须成为 runtime truth，而不是文档口号。
  - runtime mesh 不允许继续扩 internal HTTP 新面。
- **显式排除的讨论范围**：
  - full fallback chain
  - full quota ledger / alerts plane
  - DeepSeek 完整 BYO key 治理

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Z3 Real Runtime and Quota`
- **一句话定义**：让 `agent.core` 的 llm/tool runtime 进入真实 provider + 真实 quota gate + 真实 evidence path。
- **边界描述**：本功能簇**包含** Workers AI 主路径、usage/quota minimal truth、`beforeCapabilityExecute` 实际消费、runtime evidence 对齐；**不包含**多 provider 完整治理与完整 quota 产品面。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| real runtime | 真实 provider + 真实 side-effect gate + 真实 evidence | 与 fake/demo path 相对 |
| quota gate | side-effect 前 allow/deny 检查 | 不能只是事后记账 |
| usage event | 单次 llm/tool 消耗事件 | 写入 D1 |
| quota balance | 当前 tenant 的最小余额/额度视图 | first-wave 不做完整 ledger |
| runtime evidence | llm/tool/quota 事件与 trace/session/team 的链接 | Z3 closure 关键证据 |

### 1.2 参考调查报告

- `docs/charter/plan-zero-to-real.md` — §7.4
- `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md`
- `docs/design/zero-to-real/ZX-nacp-realization-track.md`
- `workers/bash-core/src/executor.ts`

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **real execution layer** 的角色。
- 它服务于：
  - `agent.core` runtime
  - `bash.core` capability execution
  - trace/audit/evidence sink
- 它依赖：
  - Z2 session truth
  - Workers AI adapter
  - usage/quota D1 tables
- 它被谁依赖：
  - Z4 first real run
  - final closure

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| LLM adapter | adapter -> runtime | 强 | Z3 required provider path |
| Session truth | runtime -> persistence | 强 | llm/tool events 需要挂到 session/trace |
| Quota schema | runtime -> usage/balance | 强 | allow/deny 与 usage evidence |
| Binding/RPC | agent -> bash/context/fs | 中 | runtime mesh 不能继续扩 HTTP |
| Clients | runtime -> stream | 中 | real output 进入真实客户端链路 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`Z3 Real Runtime and Quota` 是 **让 agent loop 真的开始消耗真实资源并留下真实证据** 的阶段，负责 **接入 real provider、把 quota gate 接入 side-effect 主路径，并把 llm/tool/quota evidence 回挂到 shared truth**，对上游提供 **真实执行结果**，对下游要求 **Z4 客户端实验不再跑在 fake runtime 上**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 多 provider required path | 通用推理平台做法 | 会扩大 Z3 范围 | 是 |
| 完整 quota 策略与计费产品面 | 成熟 SaaS billing | zero-to-real 只需最小 allow/deny truth | 是 |
| provider-native raw stream 暴露给客户端 | 省去映射的捷径 | 会泄漏 provider boundary | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| quota authorizer | runtime hook / service binding | allow/deny + usage write | richer policies |
| provider registry | adapter registry | Workers AI + optional DeepSeek skeleton | more models/providers |
| usage evidence | trace/audit payloads | minimal fields | richer analytics |
| budget semantics | `nano_quota_balances` | simple remaining/allow state | quota ledger/alerts |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：LLM invoke gate vs tool gate
- **解耦原因**：虽然都属于 quota，但未来可能有不同 policy；第一版需要统一入口，不需要统一实现。
- **依赖边界**：Z3 只冻结“都必须经过 gate”，不强制要求内部计算公式完全相同。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：usage event 写入、quota balance 变更、deny evidence
- **聚合形式**：围绕同一 `team_uuid + trace_uuid + session_uuid` 聚合
- **为什么不能分散**：否则配额决策无法与真实 loop 证据对应。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：runtime 更轻，quota/billing 几乎不成为主线。
- **亮点**：
  - 执行层薄
- **值得借鉴**：
  - 真实 runtime 也不应被 quota 逻辑吞没
- **不打算照抄的地方**：
  - 不为 real runtime 建立正式 gate

### 4.2 codex 的做法

- **实现概要**：执行控制与策略约束较清楚。
- **亮点**：
  - tool / execution legality 边界强
- **值得借鉴**：
  - policy 必须进入执行前置路径
- **不打算照抄的地方**：
  - 本地 CLI 假设

### 4.3 claude-code 的做法

- **实现概要**：工具与控制层更丰富。
- **亮点**：
  - 权限/控制面与任务执行的配合较强
- **值得借鉴**：
  - 真实执行必须有中心化 gate，而不是 scattered check
- **不打算照抄的地方**：
  - 本地 shell/tool 丰富面

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| real provider emphasis | 低 | 中 | 中 | 高 |
| runtime gate | 低 | 中高 | 高 | 高 |
| quota/billing emphasis | 低 | 低 | 低 | 中 |
| evidence linkage | 低 | 中 | 高 | 高 |
| worker-native suitability | 低 | 低 | 低 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** Workers AI 进入 agent loop 主路径
- **[S2]** fake provider 退到 test/demo path
- **[S3]** llm/tool side-effect 前 quota allow/deny
- **[S4]** `nano_usage_events` / `nano_quota_balances` 写入
- **[S5]** llm/tool/quota evidence 进入 trace/audit

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** full quota product plane
- **[O2]** complete multi-provider required baseline
- **[O3]** deep secret governance / BYO key platform
- **[O4]** all stream-plane RPC-only

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `beforeCapabilityExecute()` 只拦 tool | out-of-scope | Z3 要求更强的 runtime truth |
| DeepSeek skeleton | in-scope（optional） | 不影响 required provider baseline |
| quota deny 的计费公式 | out-of-scope | 第一版只需 allow/deny + evidence 可追 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **先让 Workers AI 进入主路径** 而不是 **继续停留在 fake provider**
   - **为什么**：real run 不能建立在假模型上。
   - **我们接受的代价**：需要尽早处理 provider error/latency/evidence。
   - **未来重评条件**：无。

2. **取舍 2**：我们选择 **quota gate 进入 side-effect 前置路径** 而不是 **只做事后 usage 记录**
   - **为什么**：owner 已明确配额必须是执行门禁，不是摆设。
   - **我们接受的代价**：需要把 gate 接到 llm/tool 执行主链路。
   - **未来重评条件**：无。

3. **取舍 3**：我们选择 **不新增多余 internal HTTP 面** 而不是 **为了方便再开一批 runtime 接口**
   - **为什么**：zero-to-real 已明确 transport 边界治理主线。
   - **我们接受的代价**：实现时要更多复用现有 runtime mesh。
   - **未来重评条件**：无。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| quota 只拦 tool 不拦 llm | 继续沿用现有 seam 而不扩主链路 | 真实资源控制失真 | 通过 Q9 明确 gate 范围 |
| provider 接入但 evidence 不完整 | 只求模型出字 | 无法审计真实运行 | Z3 closure 强制 evidence linkage |
| runtime mesh 再开 HTTP 口 | 实现图省事 | 破坏边界收紧主线 | 固定“不增新 HTTP 控制面”纪律 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：终于能验证真实运行成本、失败模式和证据链。
- **对 nano-agent 的长期演进**：为 future quota plane、provider expansion 留下真实基线。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：只有 real runtime 才能暴露真实的 context/tool/loop 问题。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Workers AI Mainline | 真实 provider 主路径 | ✅ **fake provider 不再是默认** |
| F2 | Runtime Quota Gate | llm/tool side-effect 前 allow/deny | ✅ **配额成为执行真理** |
| F3 | Usage/Balance Persistence | usage event 与 balance 写入 D1 | ✅ **配额结果可回看** |
| F4 | Runtime Evidence | llm/tool/quota 进入 trace/audit | ✅ **真实运行具备证据链** |

### 7.2 详细阐述

#### F1: `Workers AI Mainline`

- **输入**：normalized LLM request
- **输出**：真实模型结果与 usage 数据
- **主要调用者**：`agent.core`
- **核心逻辑**：用 Workers AI 替换掉 production path 上的 fake provider。
- **边界情况**：
  - provider 失败必须按 runtime/system notify truth 暴露
  - DeepSeek skeleton 不影响 required path 判定
- **一句话收口目标**：✅ **agent loop 已真实触发模型调用**

#### F2: `Runtime Quota Gate`

- **输入**：llm call / capability plan / tenant context
- **输出**：allow/deny verdict + usage write
- **主要调用者**：`agent.core`、`bash.core`
- **核心逻辑**：在 side-effect 前做 gate，在 side-effect 后写 usage/evidence。
- **边界情况**：
  - gate 范围由 Q9 定稿
  - deny 也必须留下 trace/evidence
- **一句话收口目标**：✅ **配额不是日志，而是门禁**

### 7.3 非功能性要求

- **性能目标**：gate 本身不应成为大瓶颈，但必须可观测。
- **可观测性要求**：每次 llm/tool/quota 都能追到 trace/session/team。
- **稳定性要求**：provider failure、quota deny 都要有 typed surface。
- **测试覆盖要求**：Workers AI happy path、quota allow/deny、usage/balance 写入、evidence linkage 都需证明。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/README.md` | 轻量运行模型 | 提醒 runtime gating 也要克制 | 只作对照 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/README.md` | 执行与控制面关系 | 执行前 gate 是合法性的一部分 | 间接启发 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/Task.ts` | 中心控制与执行配合 | runtime 需要中心 gate 与事件面 | 间接启发 |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `workers/agent-core/src/llm/gateway.ts` | 仍停在 future seam | Z3 目标就是让它退出“占位符”状态 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

Z3 让 nano-agent 的 loop 从“能跑通逻辑”进化到“真的在消耗真实资源”。它同时接 provider、quota、usage、evidence 四条线，因此是 zero-to-real 的执行真实性证明阶段。只要 Z3 过关，Z4 客户端实验才有意义。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 没有 real runtime，就没有 zero-to-real |
| 第一版实现的性价比 | 4 | 复杂，但都是 first real run 必需能力 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 5 | 真正的运行负载会暴露后续深耕方向的真实问题 |
| 对开发者自己的日用友好度 | 4 | provider/quota 真实化后，实验结论才可信 |
| 风险可控程度 | 4 | 通过 Workers AI first 与 quota minimal 可以控住范围 |
| **综合价值** | **5** | **这是 zero-to-real 的执行真实性证明** |

### 9.3 下一步行动

- [ ] **决策确认**：在 `ZX-qna.md` 回答 Q8-Q9。
- [ ] **关联 Issue / PR**：Workers AI mainline、quota gate、usage tables、runtime evidence。
- [ ] **待深入调查的子问题**：
  - deny event 的最小 payload
  - usage event 字段清单
  - optional DeepSeek skeleton 代码位置
- [ ] **需要更新的其他设计文档**：
  - `ZX-llm-adapter-and-secrets.md`
  - `ZX-nacp-realization-track.md`
  - `Z4-real-clients-and-first-real-run.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：quota 是不是先只拦 tool
  - **A 方观点**：沿用现有 seam，快一点
  - **B 方观点**：真实资源消耗必须统一进入 gate
  - **最终共识**：先由 Q9 拍板，但方向明显偏向后者

### B. 开放问题清单（可选）

- [ ] **Q8**：DeepSeek 是否仅作为 optional skeleton
- [ ] **Q9**：quota deny 是否覆盖 llm/tool 两类主消耗路径

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-24` | `GPT-5.4` | 初稿 |
