# Nano-Agent 功能簇设计模板

> 功能簇: `ZX Binding Boundary and RPC Rollout`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/charter/plan-zero-to-real.md`、`docs/eval/zero-to-real/plan-analysis-by-opus-v2.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

当前仓库已经不是“还没有内部 transport”的状态；相反，协议层已有 `ServiceBindingTransport` 与 `DoRpcTransport`，但 runtime 现实仍主要是 `orchestrator-core -> agent-core` 通过 fetch-backed `/internal/*` 调用。zero-to-real 的问题因此不是“要不要做 RPC”，而是“如何把 RPC/binding 变成明确的安全边界治理主线”。

- **项目定位回顾**：`orchestration.core` 是唯一 public façade；其他 worker 都应 internal-only。
- **本次讨论的前置共识**：
  - `workers/orchestrator-core/src/user-do.ts` 当前仍有 `forwardInternalRaw()` 走 `https://agent.internal/internal/...`。
  - `workers/agent-core/src/index.ts` 当前仍承接 `/internal/*`。
  - `workers/agent-core/src/host/internal-policy.ts` 已有 shared secret + authority + trace + no-escalation 逻辑。
  - `packages/nacp-core/src/transport/service-binding.ts` 与 `do-rpc.ts` 已有协议级 precheck。
- **显式排除的讨论范围**：
  - 本阶段一次性退役所有 stream-plane HTTP
  - 把 `orchestration.core` 扩成 context/filesystem 超级路由器

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`ZX Binding Boundary and RPC Rollout`
- **一句话定义**：冻结 zero-to-real 的 public/internal worker 边界、binding matrix、以及 control-plane RPC-first 的迁移顺序。
- **边界描述**：本功能簇**包含** worker 身份、binding 权限、internal-only discipline、control-plane vs stream-plane rollout；**不包含**具体 D1 schema 与 client 交互细节。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| public façade | 唯一对外暴露 HTTP/WS 的 worker | 当前只能是 `orchestration.core` |
| internal-only worker | 不暴露 public business route 的 worker | 可保留 probe |
| control-plane | start/followup/cancel/status/verify/timeline/auth 这类命令/查询路径 | 优先 RPC 化 |
| stream-plane | stream relay、NDJSON pull、WS attach/reconnect 过渡面 | 可暂留过渡 seam |
| pure internal transport | 只接受内部 caller 的 transport 形态 | `orchestration.auth` day-1 必须如此 |

### 1.2 参考调查报告

- `docs/charter/plan-zero-to-real.md` — §1.7 / §5.5 / §5.6 / §7.1-§7.5
- `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md` — §1 / §2 / §6
- `docs/eval/zero-to-real/plan-hardening-by-GPT.md` — §5.1 / §5.4

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **security boundary governor** 的角色。
- 它服务于：
  - `orchestration.core`
  - `orchestration.auth`
  - `agent.core`
  - runtime mesh reviewer / implementer
- 它依赖：
  - `orchestration-facade` 既有 private mesh
  - NACP transport primitives
  - current internal authority hardening
- 它被谁依赖：
  - Z1 auth worker bringup
  - Z2 control-plane RPC kickoff
  - Z3 runtime mesh tightening
  - Z4 internal HTTP residual inventory

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| Auth foundation | boundary -> auth | 强 | `orchestration.auth` 是否 internal-only 由本设计冻结 |
| Session truth | boundary -> Z2 | 强 | `orchestration.core -> agent.core` 哪些面先 RPC 化由本设计决定 |
| NACP realization | legality <- boundary | 强 | transport 只是载体，NACP 是法律 |
| Runtime/quota | mesh -> boundary | 中 | Z3 不应新增多余 internal HTTP |
| Clients | weak | 弱 | client 只看到 `orchestration.core` |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`ZX Binding Boundary and RPC Rollout` 是 **internal mesh 的边界治理文档**，负责 **冻结谁可以对外、谁只能内联、哪些 internal 面先 RPC 化、哪些只能保留过渡 seam**，对上游提供 **单一 public façade 与清晰的 internal caller law**，对下游要求 **不得继续扩张 fetch-backed control-plane HTTP**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 所有 internal seam 一步到位 RPC-only | 理想化 transport 重构 | 会挤压 real auth / D1 / provider 主线 | 是 |
| façade 直连 context/filesystem | 超级 API gateway 常见做法 | 会破坏 runtime mesh 分层 | 否 |
| `orchestration.auth` public route | 常见 auth service 暴露方式 | 与“唯一对外入口”直接冲突 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| auth transport shape | WorkerEntrypoint RPC or fetch-binding shim | internal-only, single caller | 未来完全 RPC 化 |
| agent control-plane RPC | start/followup/cancel/status/verify/timeline | Z2 至少双实现 1 条主方法 | 全部控制面切换 |
| stream residual inventory | memo / issue list | Z4 明确剩余 seam | 后续继续压缩 |
| internal gate | secret + authority + trace | 保持双层门禁 | 可升级为更强平台身份 |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：public contract vs internal control-plane transport
- **解耦原因**：外部 API 稳定性与内部执行边界不应绑死。
- **依赖边界**：client 永远只经 `orchestration.core`；worker mesh 只能通过 internal contracts 互通。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：public ownership、single caller rule、control-plane rollout sequence
- **聚合形式**：由本设计文档统一冻结
- **为什么不能分散**：若分别写在 Z1/Z2/Z3，会导致每阶段自行解释边界。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：更接近单体运行，不强调 worker 间边界治理。
- **亮点**：
  - 简单
- **值得借鉴**：
  - 边界设计不要为了抽象而抽象
- **不打算照抄的地方**：
  - 继续弱化 transport / boundary law

### 4.2 codex 的做法

- **实现概要**：内部 protocol / task / execution ownership 较清晰。
- **亮点**：
  - 对 command / lifecycle 边界有强约束
- **值得借鉴**：
  - control-plane 应该先合法、后扩张
- **不打算照抄的地方**：
  - 本地 repo / shell 语境

### 4.3 claude-code 的做法

- **实现概要**：中心控制层很强，内部工具与任务协调集中。
- **亮点**：
  - 单一控制入口的价值很清楚
- **值得借鉴**：
  - public 入口必须唯一，复杂度不能平铺到所有子系统
- **不打算照抄的地方**：
  - 本地 CLI / sub-agent / shell transport

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| public/internal 边界 | 弱 | 中强 | 强 | 强 |
| internal transport governance | 低 | 高 | 中 | 高 |
| 单一控制入口 | 弱 | 中 | 强 | 强 |
| 本地 runtime 假设 | 强 | 强 | 强 | 弱 |
| Worker-native 适配 | 低 | 低 | 低 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** 冻结 6-worker binding matrix。
- **[S2]** 冻结 `orchestration.auth` internal-only / only called by `orchestration.core`。
- **[S3]** 冻结 `orchestration.core -> agent.core` control-plane RPC-first 顺序。
- **[S4]** 冻结 stream-plane 只可作为显式过渡 seam。
- **[S5]** 冻结 internal gate 的最小安全纪律。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** Z 阶段内全面退役所有 internal HTTP。
- **[O2]** 让 `orchestration.core` 直接 bind context/filesystem。
- **[O3]** 为了追求 transport 纯度而延后 real auth / D1 / provider。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `orchestration.auth` 是否可有 public `/auth/*` | out-of-scope | public auth 只能由 `orchestration.core` 代理 |
| `agent.core /internal/*` 过渡面 | in-scope | 允许存在，但只能收缩不能扩张 |
| stream pull / relay HTTP 继续存在 | in-scope（过渡） | 但必须列入 residual inventory |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **`orchestration.core` 作为唯一 public façade** 而不是 **多个 worker 各自暴露 public 面**
   - **为什么**：这是安全边界与 client 心智的根前提。
   - **我们接受的代价**：public proxy / relay 代码更多。
   - **未来重评条件**：只有在下一阶段明确引入新的 public gateway 时。

2. **取舍 2**：我们选择 **control-plane RPC-first** 而不是 **all-plane 一次性 RPC-only**
   - **为什么**：这样能同时兼顾边界收紧与 zero-to-real 主线交付。
   - **我们接受的代价**：Z4 仍需维护一份 residual inventory。
   - **未来重评条件**：当 web + Mini Program real run 稳定后。

3. **取舍 3**：我们选择 **`orchestration.auth` single-caller** 而不是 **auth worker 被多个内部 worker共享调用**
   - **为什么**：避免 JWT/identity 能力在 runtime mesh 内四处扩散。
   - **我们接受的代价**：某些内部查询要绕经 `orchestration.core`。
   - **未来重评条件**：若后续形成明确的 internal identity query facade。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| transport rewrite 过重 | 把所有 seam 一起改 | 阻塞 zero-to-real 主线 | control-plane / stream-plane 分层推进 |
| auth 边界扩散 | 多个 worker 直连 auth | secret / identity law 失控 | single caller rule |
| façade 超级化 | orchestrator 直接接 context/filesystem | 运行层职责混乱 | 固定 agent.core 为 runtime mesh owner |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：有一张清晰的 binding / transport 边界图，不必在每个 PR 重解释。
- **对 nano-agent 的长期演进**：为后续 HTTP 继续退役保留了明确基线。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：把外部入口与内部执行层分开，后续演进不会反复牵动 client contract。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Binding Matrix Freeze | 明确谁能调谁 | ✅ **worker 间调用矩阵不再模糊** |
| F2 | Auth Internalization | auth worker 只接受 orchestrator 调用 | ✅ **JWT/identity 能力不进入 runtime mesh** |
| F3 | Control-Plane RPC Kickoff | start/followup/cancel/status/verify/timeline 优先 RPC 化 | ✅ **至少 1 条主方法双实现可用** |
| F4 | Stream Residual Governance | 剩余 HTTP seam 可见、可压缩 | ✅ **不会继续无界扩张** |

### 7.2 详细阐述

#### F1: `Binding Matrix Freeze`

- **输入**：6 worker 拓扑、现有 runtime 调用路径
- **输出**：binding allowlist
- **主要调用者**：所有 zero-to-real 实施者
- **核心逻辑**：
  1. `orchestration.core` 只对外
  2. `orchestration.auth` 只接受 `orchestration.core`
  3. `agent.core` 只面向 internal runtime mesh
  4. `bash/context/filesystem` 只由 `agent.core` 消费
- **边界情况**：
  - probe 可继续存在
  - public business route 不可外溢
- **一句话收口目标**：✅ **worker 间边界已经先于代码实现被冻结**

#### F2: `Control-Plane RPC Kickoff`

- **输入**：当前 `/internal/sessions/*` fetch-backed 现实
- **输出**：RPC-first 迁移顺序
- **主要调用者**：Z2 session truth 实施
- **核心逻辑**：
  - Z2 scaffold RPC entrypoint
  - 至少把 `start` 做成首条双实现方法
  - 其余 control-plane 保持 parity 迁移
- **边界情况**：
  - stream 不要求在 Z2 全部切走
  - 不允许新增控制面 HTTP 新接口
- **一句话收口目标**：✅ **control-plane 的 internal HTTP 已进入“只减不增”状态**

### 7.3 非功能性要求

- **性能目标**：control-plane 迁移不应让 real loop 出现额外不可观测延迟。
- **可观测性要求**：internal caller、trace、authority 必须可审计。
- **稳定性要求**：internal gate 不允许 silent fallback。
- **测试覆盖要求**：single-caller、secret mismatch、authority mismatch、RPC parity 都要有负例。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/README.md` | 简单入口模型 | 提醒我们 public edge 需要尽量单一 | 仅作克制参考 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/README.md` | agent / protocol / command 结构 | transport 与 control plane 需要分层 | 对 rollout 有启发 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/Task.ts` | centralized task/control ownership | 单一入口与中心控制层的价值 | 对 `orchestration.core` 有启发 |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `workers/orchestrator-core/src/user-do.ts` | `forwardInternalRaw()` 直接拼 `https://agent.internal/internal/sessions/...` | 这是当前现实，但不是 zero-to-real 终态 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

ZX-binding 让 zero-to-real 的 transport 讨论从“要不要 RPC”切成“哪些 internal 面先 RPC 化、哪些只允许过渡”。它把 auth worker internalization、control-plane rollout、stream-plane residual inventory 放在同一张边界图上。复杂度中等，但收益很高，因为它直接决定了后续实现是否还能保持唯一 public façade。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 唯一 public façade 与 internal mesh 是当前架构核心 |
| 第一版实现的性价比 | 4 | 需要一定迁移成本，但远低于长期双轨成本 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 5 | 未来 richer mesh 可以继续沿这条边界扩展 |
| 对开发者自己的日用友好度 | 4 | 需要多记一套边界，但换来一致性 |
| 风险可控程度 | 4 | 最大风险在 rollout 顺序，而不是方向 |
| **综合价值** | **5** | **这是 zero-to-real 的安全边界总图** |

### 9.3 下一步行动

- [ ] **决策确认**：在 `ZX-qna.md` 回答 Q1 / Q4 / Q7 / Q10。
- [ ] **关联 Issue / PR**：Z1 auth worker、Z2 session truth、Z4 residual inventory。
- [ ] **待深入调查的子问题**：
  - auth transport exact form
  - first RPC parity method
  - Mini Program first real run 的 transport最低要求
- [ ] **需要更新的其他设计文档**：
  - `Z1-full-auth-and-tenant-foundation.md`
  - `Z2-session-truth-and-audit-baseline.md`
  - `Z4-real-clients-and-first-real-run.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：RPC 是否应被打入 out-of-scope
  - **A 方观点**：本阶段先别碰 transport
  - **B 方观点**：边界治理与 control-plane RPC 启动必须纳入主线
  - **最终共识**：后者成立，但 stream-plane 可以过渡

### B. 开放问题清单（可选）

- [ ] **Q1**：`orchestration.auth` 的 exact transport 是否直接冻结为 WorkerEntrypoint RPC-first？
- [ ] **Q7**：Z2 第一条 dual-implemented control-plane 方法是否直接选 `start`？

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-24` | `GPT-5.4` | 初稿 |
