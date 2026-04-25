# Nano-Agent 功能簇设计模板

> 功能簇: `ZX NACP Realization Track`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/charter/plan-zero-to-real.md`、`docs/eval/zero-to-real/plan-hardening-by-GPT.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

zero-to-real 最容易发生的误判，是把 auth / D1 / provider / client 当成主线，而把 NACP 当成“已经有了、不用再管”的背景板。当前仓库代码恰好说明这条线必须反过来：协议不是背景板，而是所有真实能力进入生产路径之前的执行真理。

- **项目定位回顾**：nano-agent 的 internal authority、trace、tenant boundary、session profile 都已落在 `@haimang/nacp-core` 与 `@haimang/nacp-session`。
- **本次讨论的前置共识**：
  - `workers/orchestrator-core/src/auth.ts` 已有 public ingress JWT + `trace_uuid` + tenant mismatch rejection。
  - `workers/agent-core/src/host/internal-policy.ts` 已有 internal secret + authority + trace + no-escalation 逻辑。
  - `packages/nacp-core/src/transport/service-binding.ts` 与 `do-rpc.ts` 已有 transport precheck。
  - `packages/nacp-session/src/ingress.ts` 已明确 authority 必须 server-stamped。
  - 当前 `workers/orchestrator-core/src/auth.ts::AuthSnapshot` 现实字段仍是 `sub / tenant_uuid / source_name / membership_level / realm / exp`，而 `packages/nacp-core/src/envelope.ts::NacpAuthoritySchema` 需要 `team_uuid / plan_level / stamped_by_key / stamped_at`；zero-to-real 必须显式冻结 translation table，而不是默认“字段天然一致”。
  - `packages/nacp-session/src/messages.ts` 已冻结 first-wave session 消息面：`session.start / session.resume / session.cancel / session.end / session.stream.ack / session.heartbeat / session.followup_input`；Z2/Z4 应消费这些 primitives，而不是自造私有 message family。
- **显式排除的讨论范围**：
  - 新发明一套 NACP 之外的协议家族
  - 把 client-facing wire 与 internal worker mesh 混成一层

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`ZX NACP Realization Track`
- **一句话定义**：定义 zero-to-real 如何把已经存在的 NACP vocabulary 落成 auth、session、transport、storage、audit 的 runtime truth。
- **边界描述**：本功能簇**包含** authority mapping、session message 使用面、transport legality、trace/evidence 回挂；**不包含**具体路由路径或具体 D1 字段表。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| realization | 从 schema/类型存在推进到 runtime 主路径强制执行 | 不是“文档上承认” |
| authority stamping | authority 只能由 server 生成并注入 | client 不得自带 authority |
| no-escalation | body/header/route 不得让调用者越权放大 authority/tenant | internal/public 都要守 |
| session profile | `session.start` / `session.followup_input` / ack / heartbeat / resume / replay 的合法使用面 | 由 `nacp-session` 仲裁 |
| evidence linkage | llm/tool/quota/history/audit 都能挂到同一 trace/session/team | Z2-Z3 必须成立 |

### 1.2 参考调查报告

- `docs/charter/plan-zero-to-real.md` — §1.2 / §1.4 / §5.1 / §9
- `docs/eval/zero-to-real/plan-hardening-by-GPT.md` — §3.2 / §3.3 / §4.1
- `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md` — §1 / §6

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **runtime legality backbone** 的角色。
- 它服务于：
  - public ingress auth
  - internal worker mesh
  - session DO lifecycle
  - trace / audit / evidence
- 它依赖：
  - `@haimang/nacp-core`
  - `@haimang/nacp-session`
  - 当前 `orchestrator-core` / `agent-core` 已有 authority hardening
- 它被谁依赖：
  - Z1 auth design
  - Z2 session truth design
  - Z3 quota / runtime evidence design

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| Auth foundation | auth -> authority | 强 | JWT 要落成 `AuthSnapshot -> NacpAuthority` |
| Binding / RPC | transport -> legality | 强 | worker mesh 只能传 NACP-compatible truth |
| D1 schema | persistence <- protocol | 中 | refs / audit / usage 需要 tenant/trace 对齐 |
| Session truth | session -> profile | 强 | client 消息与 server stream 都要走 session profile |
| Runtime/quota | runtime -> evidence | 中 | llm/tool/quota 事件必须 trace-linked |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`ZX NACP Realization Track` 是 **协议到运行时的落地骨架**，负责 **把 authority / trace / session profile / transport legality 变成真实执行门禁**，对上游提供 **统一合法性约束**，对下游要求 **所有 auth、session、audit、runtime 设计都必须可回挂到 NACP truth**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 新协议家族扩张 | 自定义 app protocol 常见做法 | 会把 zero-to-real 从“落实现有真理”变成“重新造协议” | 低 |
| client authority 自带 | 简化前端接线的捷径 | 与 `nacp-session` 明确冲突 | 否 |
| 绕开 trace/evidence 的临时 side channel | 快速打通功能的常见补丁 | 会破坏 real loop 的追责能力 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| authority mapping | `AuthSnapshot -> NacpAuthority` helper | Z1 冻结最小映射 | plan / quota / scopes richer 化 |
| transport legality | `ServiceBindingTransport` / `DoRpcTransport` | control-plane 优先接入 | stream-plane 继续吸收 |
| session profile mapping | ingress normalizer + stream mapper | Z2 冻结已用消息面 | future multi-input families |
| evidence mapping | trace / audit builders | Z2-Z3 只覆盖核心事件 | richer analytics / BI |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：client-facing auth token shape vs internal NACP authority shape
- **解耦原因**：JWT claims 不是内部 authority 的一比一镜像，必须经过 server translation zone。
- **依赖边界**：外部 token 只能经 `orchestration.core` / `orchestration.auth` 翻译后再进入 session/runtime。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：authority、trace、tenant boundary、evidence linkage
- **聚合形式**：由 NACP vocabulary 统一承载
- **为什么不能分散**：如果每个 worker 各自定义一套 auth/audit/event shape，后续 real run 无法统一审计。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：对协议与边界治理较轻，更依赖单进程约束。
- **亮点**：
  - 简单直接
- **值得借鉴**：
  - 不给协议层增加无谓复杂度
- **不打算照抄的地方**：
  - 在多 worker、多租户条件下继续靠隐式约束

### 4.2 codex 的做法

- **实现概要**：重视 typed protocol 与 session/task 法律。
- **亮点**：
  - 合法消息面与运行态分得清楚
- **值得借鉴**：
  - internal transport 必须先过 legality check
- **不打算照抄的地方**：
  - 本地 CLI / shell / repo 环境前提

### 4.3 claude-code 的做法

- **实现概要**：用中心控制层承接任务、工具、权限与交互。
- **亮点**：
  - 高密度 control-plane
- **值得借鉴**：
  - 复杂交互必须有中心化的 legality 与 audit 入口
- **不打算照抄的地方**：
  - 把本地 runtime 经验直接外推到 Worker mesh

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| protocol ownership | 弱 | 强 | 中强 | 强 |
| client/server 边界 | 弱 | 强 | 中 | 强 |
| multi-tenant safety | 弱 | 中 | 中 | 强 |
| audit linkage | 低 | 中 | 高 | 高 |
| transport legality | 低 | 高 | 中 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** 冻结 JWT -> `AuthSnapshot` -> `NacpAuthority` 的 translation zone。
- **[S2]** 冻结 public ingress 与 internal ingress 的 no-escalation law。
- **[S3]** 冻结 client session message 的合法使用面。
- **[S4]** 冻结 worker-to-worker transport 只能传递 NACP-compatible truth。
- **[S5]** 冻结 trace / audit / evidence 的最小回挂面。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** 新增一套独立于 NACP 的 runtime envelope。
- **[O2]** 允许 client 直接 author authority。
- **[O3]** 为了赶进度绕过 trace/team/session linkage。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| transport 可渐进演进 | in-scope | Z0 已允许 control-plane 与 stream-plane 分层推进 |
| NACP legality 可后补 | out-of-scope | 这会直接破坏本阶段“真实”定义 |
| JWT claim 与 NACP authority 一比一等同 | out-of-scope | 中间必须有 translation zone |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **NACP 作为唯一协议主线** 而不是 **为 zero-to-real 再造一层临时协议**
   - **为什么**：当前仓库已具备 authority / trace / session profile truth。
   - **我们接受的代价**：实现时必须尊重既有合法性约束，不能走捷径。
   - **未来重评条件**：只有当 NACP 无法表达未来需求时，才考虑扩张。

2. **取舍 2**：我们选择 **server-stamped authority** 而不是 **client 带 authority 直通**
   - **为什么**：`nacp-session` 已明确禁止 forged authority。
   - **我们接受的代价**：public ingress translation zone 变重。
   - **未来重评条件**：无。

3. **取舍 3**：我们选择 **trace-linked evidence** 而不是 **功能先通、审计后补**
   - **为什么**：real loop 的价值之一就是可回放、可追责。
   - **我们接受的代价**：Z2-Z3 的 wiring 工作增加。
   - **未来重评条件**：无。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| protocol drift | Z1/Z2/Z3 各自发明本地 shape | 内部调用彼此不兼容 | 用本 design 统一 translation / legality / evidence 入口 |
| authority leakage | client 或内部 body/header 不一致 | tenant 越权与审计错位 | 复用现有 public/internal no-escalation truth |
| trace orphaning | runtime side-effect 无 trace | 无法审计 real run | Z2-Z3 强制 evidence linkage |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：任何 auth / runtime / persistence 改动都有统一检查表。
- **对 nano-agent 的长期演进**：后续 richer runtime 不必重新发明 authority / audit 法律。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：这些能力未来都可以挂在统一 trace / session / authority 法律之上。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Authority Translation | JWT / auth result 映射到 NACP authority | ✅ **client 永远不直接 author authority** |
| F2 | Session Profile Usage | 冻结 `session.start` / `session.followup_input` / resume/replay 等使用面 | ✅ **session message legality 由 `nacp-session` 仲裁** |
| F3 | Transport Legality | service binding / DO RPC 只传 NACP envelope | ✅ **internal transport 不再只是“把 JSON 发过去”** |
| F4 | Evidence Linkage | llm/tool/quota/history/audit 都能回挂 trace/session/team | ✅ **real run 可审计** |

### 7.2 详细阐述

#### F1: `Authority Translation`

- **输入**：JWT claims、auth worker verify 结果、deploy tenant truth
- **输出**：`AuthSnapshot` 与 `NacpAuthority`
- **主要调用者**：`orchestration.core`
- **核心逻辑**：public ingress 先验证 token，再把 user/tenant/role/source 等映射进 NACP 载体。
- **边界情况**：
  - `plan_level` 当前不在 public JWT/AuthSnapshot 里，必须显式走 deploy/team lookup fill，不允许静默省略
  - tenant mismatch 必须 typed reject
- **一句话收口目标**：✅ **public ingress 产生的 authority 已可直接进入 session/runtime 主路径**
- **判定方法**：
  1. 存在清晰的 JWT/AuthSnapshot -> InternalAuthorityPayload -> NacpAuthority 映射表。
  2. `team_uuid / plan_level / stamped_by_key / stamped_at` 的来源在文档中逐项冻结。
  3. forged / tenant mismatch / missing plan-level 都会被 typed reject，而不是 success-shaped fallback。

**字段映射表（first-wave frozen）**

| 来源 | 当前字段 | 目标字段 | 说明 |
|------|----------|----------|------|
| JWT | `tenant_uuid` | `team_uuid` | zero-to-real 统一视为 team/tenant 主键 |
| JWT/AuthSnapshot | `sub` | `user_uuid` | 若存在用户态调用则传入；service-only 调用可为空 |
| JWT/AuthSnapshot | `membership_level` | `membership_level` | 原样平移 |
| deploy/team lookup | _无_ | `plan_level` | 必须由 team truth 补齐 |
| internal signer | _无_ | `stamped_by_key` | 当前 deploy 的 internal signing key id |
| runtime clock | _无_ | `stamped_at` | server-stamped timestamp |

#### F2: `Session Profile Usage`

- **输入**：client ingress、server stream、resume/replay/heartbeat paths
- **输出**：严格受 `nacp-session` 仲裁的 session message 使用面
- **主要调用者**：`orchestration.core`、`agent.core`、Z4 clients
- **核心逻辑**：Q10 已冻结 first real run baseline 为 HTTP `start/input` + WS `stream/history`；其协议面仍必须消费 `session.start`、`session.followup_input`、`session.stream.ack`、`session.heartbeat`、`session.resume`、replay cursor 等既有 primitives，而不是 invent 私有 wire。
- **边界情况**：
  - formal follow-up family 已在 earlier phases 冻结为 `session.followup_input`
  - heartbeat / replay 是 caller-managed hardening，不等于 transport 层自动魔法
- **一句话收口目标**：✅ **session legality 由 `nacp-session` 统一仲裁，不再有私有消息旁路**
- **判定方法**：
  1. 文档显式列出 Z2/Z4 使用到的 first-wave session message set。
  2. client ingress / reconnect / replay 说明都不再 invent 私有 message family。
  3. invalid session message negative cases 进入 contract tests。

**first-wave session message set（必须消费）**

- `session.start`
- `session.followup_input`
- `session.cancel`
- `session.end`
- `session.resume`
- `session.stream.ack`
- `session.heartbeat`

#### F3: `Transport Legality`

- **输入**：worker-to-worker envelope
- **输出**：经 precheck 的合法 internal 调用
- **主要调用者**：`orchestration.core`、`agent.core`
- **核心逻辑**：通过 `ServiceBindingTransport` / `DoRpcTransport` 先做 `validateEnvelope -> verifyTenantBoundary -> checkAdmissibility`。
- **边界情况**：
  - control-plane 优先接入
  - stream-plane 可过渡，但不能无界扩张
- **一句话收口目标**：✅ **internal control-plane 已不再依赖“裸 fetch JSON”心智**
- **判定方法**：
  1. control-plane RPC proof 必须带 NACP envelope + authority + trace。
  2. 不再新增“只有 JSON body、没有 authority envelope”的 internal method。
  3. `cross-seam.ts` 在 zero-to-real 只作为 future transport primitive，不成为 first-wave 必经路径。

#### F4: `Evidence Linkage`

- **输入**：history/audit/quota/llm/tool runtime 事件
- **输出**：可统一回挂 `trace_uuid + session_uuid + team_uuid` 的 evidence 链
- **主要调用者**：Z2 session truth、Z3 runtime quota、Z4 evidence pack
- **核心逻辑**：所有 first-wave 持久化与运行证据都要沿用 NACP trace/authority vocabulary，而不是每个 subsystem 自造 ID 族；`nano_session_activity_logs`、`nano_usage_events`、history rows 至少要能共享 trace/session/team linkage。
- **边界情况**：
  - evidence 不要求一步到位做 BI schema
  - 但不允许留“无法挂回 trace/team”的 orphan records
- **一句话收口目标**：✅ **real run 的各侧证据已能回到同一条 NACP 审计主线**
- **判定方法**：
  1. 任一真实 run 的 llm/tool/quota/history/audit 都能共享 `trace_uuid + session_uuid + team_uuid`。
  2. Z4 evidence pack 能直接引用这些 linkage，不需要额外猜测映射关系。
  3. orphan record negative checks 存在。

### 7.3 非功能性要求

- **性能目标**：合法性检查要在 worker 间调用开始前完成，避免错误扩散到深层 runtime。
- **可观测性要求**：所有关键 runtime 事件可映射到 trace/session/team。
- **稳定性要求**：authority / trace / tenant mismatch 必须 typed reject，不能静默修复。
- **测试覆盖要求**：负例必须覆盖 forged authority、tenant mismatch、invalid session message、trace mismatch。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/README.md` | 简单 agent 运行模型 | 协议层必须克制，不做多余抽象 | 用作反衬 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/AGENTS.md` | agent 行为与运行边界说明 | 先定行为与协议，再谈实现 | 对 legality-first 有启发 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/Task.ts` | 任务控制层 | 中心控制面与审计入口要合一 | 对 control-plane 有启发 |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `workers/orchestrator-core/src/user-do.ts` | 当前 `forwardInternalRaw()` 仍通过 `https://agent.internal/internal/...` fetch 调用 | 这是过渡现实，不应继续被误当终态 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

ZX-NACP 不是新增协议，而是把现有协议从“已存在”推到“已主导运行”。它贯穿 Z1-Z3：Z1 负责 authority translation，Z2 负责 session/persistence 对齐，Z3 负责 llm/tool/quota evidence 对齐。复杂度中高，但这是 zero-to-real 从 scaffold 走向真实的基础。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 不以 NACP 为主线，就谈不上 tenant-safe real loop |
| 第一版实现的性价比 | 5 | 复用现有协议比再造一套临时协议更稳 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 5 | 未来所有 runtime richness 都可沿用同一 legality 主线 |
| 对开发者自己的日用友好度 | 4 | 增加约束，但换来一致性 |
| 风险可控程度 | 4 | 主要风险在于接线成本，而非方向错误 |
| **综合价值** | **5** | **这是 zero-to-real 的协议主骨架** |

### 9.3 下一步行动

- [ ] **已冻结答案需在实施中消费**：Q2 / Q4 / Q5 / Q9 已在 `ZX-qna.md` 回填，ZX-NACP 后续只负责把这些答案翻译成 authority/session/evidence 的 runtime law。
- [ ] **关联 Issue / PR**：Z1 auth mapping、Z2 session truth、Z3 runtime evidence。
- [ ] **实施前必须同步的 phase 文档**：
  - `Z1-full-auth-and-tenant-foundation.md`
  - `Z2-session-truth-and-audit-baseline.md`
  - `Z3-real-runtime-and-quota.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：NACP 是背景板还是主线
  - **A 方观点**：auth / D1 / provider 更重要
  - **B 方观点**：这些都必须在 NACP 执行真理之下成立
  - **最终共识**：后者成立

### B. 已冻结决策清单（可选）

- [x] **Q2**：JWT 使用 HS256 + `kid` + 单签发/双验证；authority 通过 server translation zone 补齐 `plan_level / stamped_*`。
- [x] **Q4**：auth worker transport = WorkerEntrypoint RPC-first；对 NACP 而言它仍是 internal transport，不是 public wire。
- [x] **Q5**：`nano_session_activity_logs` 保持单表 append-only，不拆表。
- [x] **Q9**：quota deny 同时覆盖 llm + tool 消耗路径，并进入统一 evidence linkage。

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-24` | `GPT-5.4` | 初稿 |
