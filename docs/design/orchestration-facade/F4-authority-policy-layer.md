# Nano-Agent 功能簇设计模板

> 功能簇: `F4 Authority Policy Layer`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/plan-orchestration-facade.md`、`docs/plan-orchestration-facade-reviewed-by-opus-2nd-pass.md`
> 文档状态: `draft (reviewed + FX-qna applied)`

---

## 0. 背景与前置约束

当前仓库里，authority / tenant / validation 纪律已经存在，但分散在 `NanoSessionDO`、`verifyTenantBoundary`、各类 worker edge 与 capability runtime 之间。orchestration-facade 阶段不需要顺手造 credit/quota/billing domain，但必须把这些分散纪律收口成一层 **explicit policy layer**，否则 internal contract 与 single-tenant law 很难真正落稳。

- **项目定位回顾**：本阶段只做 F4.A，不做 F4.B credit/quota/revocation domain。
- **本次讨论的前置共识**：
  - missing `trace_uuid` / `authority` -> reject
  - no-escalation rule 必须显式化
  - `TEAM_UUID` 是 first-wave serving tenant truth
  - execution-time truth recheck hook 应落在 `CapabilityExecutor`
- **显式排除的讨论范围**：
  - concrete credit ledger
  - quota counters
  - revocation propagation fabric

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`F4 Authority Policy Layer`
- **一句话定义**：定义 orchestration-facade 阶段必须显式化的 authority / tenant / legality / truth-recheck policy layer。
- **边界描述**：本功能簇**包含** ingress validation、internal request legality、tenant truth alignment、executor recheck seam、negative test targets；**不包含** billing/credit domain 本体。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| authority policy layer | 中央 policy helper / module，承接 legality 判断 | 不再散落在多处 |
| no-escalation | internal call 不得提升 scope 或 authority | 必须显式测试 |
| tenant truth alignment | JWT tenant claim 与 `TEAM_UUID` 的对齐法 | first-wave 仍 single-tenant |
| execution-time truth recheck | handler 执行前再次确认当前 truth 的 hook | 先留 seam，不造 domain |

### 1.2 参考调查报告

- `docs/plan-orchestration-facade.md` — §1.6 / §1.9 / §11.5
- `docs/plan-orchestration-facade-reviewed-by-opus-2nd-pass.md` — G2 / M4

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **legality guardrail** 的角色。
- 它服务于：
  - façade public ingress
  - internal binding contract
  - capability runtime
- 它依赖：
  - NACP envelope truth
  - single-tenant-per-deploy law
  - `CapabilityExecutor`
- 它被谁依赖：
  - F1/F2 runtime path legality
  - F3 negative deprecation tests
  - next-phase credit/quota domain

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| public façade contract | ingress -> policy | 强 | public JWT preflight 先经过 policy |
| internal binding contract | internal request -> policy | 强 | internal auth 不是唯一判断 |
| tenant truth | `TEAM_UUID` <-> claim | 强 | mismatch 必须 reject |
| capability runtime | policy -> executor hook | 强 | execution-time recheck 落点在此 |
| live tests | negative cases -> tests | 中 | need explicit failure shapes |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`F4 Authority Policy Layer` 是 **central legality guardrail**，负责 **把 authority / tenant / no-escalation / truth-recheck seam 从分散实现收口成显式 policy**，对上游提供 **可验证的合法性判断**，对下游要求 **single-tenant law 与 execution hook 落地**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| credit ledger | billing/quotas | 不属于本阶段 | 是 |
| revocation signal bus | 权限系统常见 | 本阶段只留 hook，不造 domain | 是 |
| separate policy service worker | microservice 化常见 | 当前阶段没必要 | 低 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| ingress policy helper | `validateIngressAuthority(...)` | fields/tenant/no-escalation checks | richer org/plan checks |
| internal policy helper | `validateInternalAuthority(...)` | header + authority legality | signed internal identity |
| executor recheck hook | `beforeCapabilityExecute(...)` | no-op/domain stub | credit/quota/revocation checks |
| tenant config | `TEAM_UUID` explicit env | preview/prod required | multi-tenant source migration |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：policy layer vs billing domain
- **解耦原因**：F4.A 要先写法律，不把 domain 建设绑进来。
- **依赖边界**：policy 负责“必须检查什么”；credit/quota 域未来再决定“去哪里查 truth”。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：authority legality、tenant mismatch、no-escalation、executor pre-check
- **聚合形式**：单一 policy helper layer
- **为什么不能分散**：分散实现既难 review，也难构建 negative tests。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：权限与工具合法性更多靠简化运行环境，显式 policy layer 较薄。
- **值得借鉴**：
  - 第一版先把约束写少而清楚
- **不打算照抄的地方**：
  - 依赖“简单环境”替代显式 legality layer

### 4.2 codex 的做法

- **实现概要**：sandbox/network/filesystem 权限模型 typed 且前置。
- **值得借鉴**：
  - 先 typed 化 permission/approval vocabulary
- **不打算照抄的地方**：
  - first-wave 不复制完整 sandbox policy engine

### 4.3 claude-code 的做法

- **实现概要**：ToolPermissionContext、can_use_tool、permission prompt tool 等把“能不能执行”放在显式控制面。
- **值得借鉴**：
  - policy 应是中央层，不应散落在每个 tool handler
- **不打算照抄的地方**：
  - 本阶段不引入其完整 permission prompt UI/SDK 机制

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| policy typed 化 | 低 | 高 | 高 | 高 |
| tenant/source law | 低 | 中 | 中 | 中高 |
| executor pre-check seam | 低 | 中 | 高 | 高 |
| first-wave 复杂度 | 低 | 高 | 中 | 中 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** explicit policy helper
- **[S2]** missing `trace_uuid` / `authority` reject
- **[S3]** no-escalation rule
- **[S4]** `TEAM_UUID` vs tenant claim alignment
- **[S5]** `CapabilityExecutor` recheck hook
- **[S6]** negative tests

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** credit/quota ledger
- **[O2]** revocation signal infrastructure
- **[O3]** multi-tenant source migration

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `TEAM_UUID` absent in local test env | in-scope but tolerated locally | 本地/测试可兜底，但 preview/prod 不可 |
| preview/prod 缺 `TEAM_UUID` | in-scope and reject | 必须显式配置，否则直接视为 misconfigured deploy |
| recheck hook 先留空实现 | in-scope | 当前先冻结 seam，不造 domain |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **先做显式 policy layer** 而不是 **继续维持分散 legality**
   - **为什么**：否则 internal contract 和 tenant law 难以 review 与测试。
   - **我们接受的代价**：会多出一层 helper / module。
   - **未来重评条件**：无；这是必要收口。

2. **取舍 2**：我们选择 **single-tenant-per-deploy law** 而不是 **本阶段就做 tenant-source migration**
   - **为什么**：当前 runtime 真实强依赖 `TEAM_UUID`。
   - **我们接受的代价**：multi-tenant gateway 价值延后。
   - **未来重评条件**：进入下一阶段 richer orchestrator。

3. **取舍 3**：我们选择 **先留 executor recheck seam** 而不是 **顺手造 credit domain**
   - **为什么**：本阶段重点是 law，不是 domain。
   - **我们接受的代价**：hook 初期可能只是 no-op / stub。
   - **未来重评条件**：credit/quota charter 启动时。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| legality 继续散落 | 不抽 helper | review/test 难收口 | F4 单独 design + action plan |
| `_unknown` 成为隐性 prod truth | 不强制 `TEAM_UUID` | tenant law 失真 | preview/prod 显式配置 |
| recheck seam 被拖没 | 只写 policy，不写 executor hook | future credit domain 再返工 | F4.A2 明确落点在 `CapabilityExecutor` |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：合法性判断终于有单一真相源。
- **对 nano-agent 的长期演进**：credit/quota/revocation 可以在既有 seam 上长出来，而不是重开 runtime 结构。
- **对三大深耕方向的杠杆作用**：稳定性与权限边界直接提升。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Ingress policy helper | 收口 public/internal authority legality | ✅ **合法性判断有中央层** |
| F2 | Tenant truth alignment | `TEAM_UUID` 与 claim 对齐 | ✅ **first-wave tenant law 具体化** |
| F3 | No-escalation enforcement | internal request 不得提权 | ✅ **internal contract 不会变成绕过点** |
| F4 | Executor recheck seam | `CapabilityExecutor` 前置 hook | ✅ **future truth recheck 有落点** |
| F5 | Negative tests | 非法输入/tenant mismatch 等用例 | ✅ **policy 不是纸面纪律** |

### 7.2 详细阐述

#### F1: `Ingress policy helper`

- **输入**：public ingress 或 internal request
- **输出**：admit / reject verdict
- **主要调用者**：`orchestrator.core`、`agent.core`
- **核心逻辑**：
  - missing `trace_uuid` -> reject
  - missing `authority` -> reject
  - authority escalation -> reject
  - tenant claim mismatch -> reject
  - internal request 还必须叠加 `validateInternalAuthority()`，不能把 header gate 当成 legality 本体
- **边界情况**：
  - tenant claim absent：first-wave 可接受，并将 `last_auth_snapshot.tenant_uuid = TEAM_UUID`
  - tenant claim absent 时，`last_auth_snapshot.tenant_source = "deploy-fill"`
  - tenant claim present 且匹配时，`last_auth_snapshot.tenant_source = "claim"`
- **一句话收口目标**：✅ **authority legality 不再散落在各入口处临时拼装**

#### F2: `Tenant truth alignment`

- **输入**：`TEAM_UUID`、JWT tenant claim、运行环境标识
- **输出**：accept / reject / misconfigured deploy verdict
- **主要调用者**：`orchestrator.core` ingress + worker bootstrap
- **核心逻辑**：
  - preview / prod 必须显式配置 `TEAM_UUID`
  - worker bootstrap 应尽早检查：若 `!env.TEAM_UUID && env.ENVIRONMENT !== "test"`，则直接返回 misconfigured response（推荐 `503`）
  - JWT claim 缺失时允许 deploy-fill；claim 存在但与 `TEAM_UUID` 不一致时 reject
  - mismatch 对 client 的 typed body 只暴露 `error: "tenant-mismatch"`；`expected/got` 仅保留在内部日志
- **边界情况**：
  - `_unknown` fallback 只允许测试态继续存在
  - 该策略只在 single-tenant-per-deploy 阶段成立；future multi-tenant charter 必须 revisit
- **一句话收口目标**：✅ **single-tenant law 从纸面设计落到实际 deploy/runtime 行为**

#### F3: `No-escalation enforcement`

- **输入**：authority payload、internal action、resolved tenant truth
- **输出**：pass / reject
- **主要调用者**：`validateIngressAuthority()`、`validateInternalAuthority()`
- **核心逻辑**：
  - internal request 不得提升 scope / tool rights / tenant reach
  - façade 翻译出来的 authority 与下游执行 authority 必须双头一致
  - 任何 escalation 尝试都返回 typed rejection，而不是静默降级
- **边界情况**：
  - `verify` / `timeline` 这类看似只读动作也不能绕过 authority law
- **一句话收口目标**：✅ **internal contract 不会变成逃逸 public law 的后门**

#### F4: `Executor recheck seam`

- **输入**：即将执行 capability 的上下文
- **输出**：allow / deny / future domain lookup hook
- **主要调用者**：`CapabilityExecutor`
- **核心逻辑**：在 handler 执行前预留集中 hook，未来可接 credit/quota/revocation truth。
- **边界情况**：
  - first-wave 可先为 no-op 或 simple legality pass-through，但 hook 必须存在
- **一句话收口目标**：✅ **future truth recheck 不再需要重构执行器主路径**

#### F5: `Negative tests`

- **输入**：非法 ingress / internal authority case
- **输出**：typed rejection evidence
- **主要调用者**：F4 action-plan / live tests
- **核心逻辑**：
  - 至少覆盖 missing `trace_uuid`
  - missing `authority`
  - authority escalation
  - tenant mismatch
  - preview env 缺 `TEAM_UUID`
- **边界情况**：
  - local/test 对 `_unknown` 的容忍不应污染 preview/prod negative cases
- **一句话收口目标**：✅ **policy 不是纸面纪律，而是带有可断言负例的执行规则**

### 7.3 非功能性要求

- **性能目标**：policy helper 不得引入重度同步依赖。
- **可观测性要求**：reject reason 必须 typed、可日志化。
- **稳定性要求**：tenant truth 不能继续依赖 `_unknown` 作为 preview/prod 默认。
- **测试覆盖要求**：negative tests 至少覆盖 missing authority、escalation、tenant mismatch。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/agent.py:90-98` | 显式 cancellation check | legality 也要有显式中央判定，而不是隐式期待 | |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/protocol/src/permissions.rs:21-73` | network/filesystem permission enums | typed legality vocabulary 很重要 | |
| `context/codex/codex-rs/protocol/src/permissions.rs:118-177` | sandbox policy structs | 借鉴“先定义 policy shape” | |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/Tool.ts:123-148` | centralized permission context | legality 状态必须集中 | |
| `context/claude-code/cli/structuredIO.ts:93-117` | request details typed 化 | reject/approval 信息必须 typed 化 | |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `workers/agent-core/src/host/do/nano-session-do.ts:812-826` | 当前 `buildIngressContext()` 在 `TEAM_UUID` 缺失时会掉 `_unknown` fallback | 这不能继续作为 preview/prod 的 deploy truth |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`F4 Authority Policy Layer` 是 orchestration-facade 阶段的“法律文本”。它不做更厚的业务域，但它决定什么是合法的 public/internal request，以及 future truth recheck 应落在哪。它的难点不在代码量，而在边界拿捏：既要收口 legality，又不能顺手把 credit domain 造出来。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | runtime mesh 和 façade 都需要统一 legality layer |
| 第一版实现的性价比 | 5 | 先收口 policy，后续 domain 建设成本大幅下降 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 5 | stability 与 permissions 都直接依赖它 |
| 对开发者自己的日用友好度 | 4 | 需要 upfront 设计，但长期更稳 |
| 风险可控程度 | 4 | 风险在 scope creep，已通过 F4.A/B 拆分控制 |
| **综合价值** | **5** | **本阶段必须完成的 guardrail 文档** |

### 9.3 下一步行动

- [ ] **设计冻结回填**：把 bootstrap `TEAM_UUID` check、`tenant_source` 审计字段与 negative tests 吸收到 F4 action-plan。
- [ ] **关联 Issue / PR**：`docs/action-plan/orchestration-facade/F4-authority-hardening.md`
- [ ] **待深入调查的子问题**：
  - misconfigured deploy response 在 preview 中采用 `503` 还是直接 throw 的最终实现风格
- [ ] **需要更新的其他设计文档**：
  - `F0-agent-core-internal-binding-contract.md`
  - `F0-user-do-schema.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-24 | GPT-5.4 | 初稿 |
| v0.2 | 2026-04-24 | GPT-5.4 | 吸收 review + FX-qna，冻结 `TEAM_UUID` law、`tenant_source`、negative tests 与 corrected code anchor |
