# F0–F5 执行计划审查报告 — DeepSeek V4 Flash

> **审查者**: DeepSeek V4 Flash（独立审查，未参考 Kimi/GPT/Opus 的评审报告）
> **审查日期**: 2026-04-24
> **审查范围**: `docs/action-plan/orchestration-facade/F0-*.md` ↔ `workers/*` + `context/smind-contexter/` 实际代码
> **审查方法**: 逐项交叉核对每个 action-plan 的 Phase/Item 与 `workers/agent-core/`、`workers/bash-core/`、`workers/context-core/`、`workers/filesystem-core/`、`context/smind-contexter/` 中的真实源码

---

## 总体评分

| 维度 | 评分 (1–5) | 说明 |
|------|------------|------|
| F0–F5 内部一致性 | 4 | Phase 链条逻辑清晰；退出条件定义良好 |
| 与实际代码的吻合度 | 2 | **重大盲点**: agent-core 已是成熟公共入口，但计划把它当 greenfield |
| smind-contexter 吸收合理性 | 4 | F0 inventory 正确界定 adopt/adapt/defer/discard；实际代码匹配 |
| 对 context-core 状态的认知 | 2 | 计划假设 context-core 是已部署的服务 worker；实际是纯库 worker |
| 风险识别能力 | 3 | 技术风险有提及，但最大风险（orchestrator-core ≠ greenfield）未被识别 |
| Phase 粒度 | 4 | 结构良好的 Phase，退出条件可度量 |
| **整体就绪度** | **2.5** | F0 合理；F1–F3 需大幅调整；F4 较为实际 |

---

## F0 — Concrete Freeze Pack（冻结基线）

**状态: 合理 — 与代码现实几乎无冲突**

| 项目 | 发现 | 严重程度 |
|------|------|----------|
| P1-01 charter/design/qna 一致性审计 | 8 份设计文档 + FX-qna + charter 相互引用一致。`F0-contexter-absorption-inventory.md` 正确映射了 smind-contexter 的吸收范围。无自相矛盾。 | ✅ 通过 |
| P1-02 review finding 分类 | DeepSeek/Opus 的 findings 分类正确。无未解决的 owner-level blocker。 | ✅ 通过 |
| P2-01 design wording 收口 | 设计文档语体一致。无残留的 owner prompt。 | ✅ 通过 |
| P3-01 F1-F5 入口清单 | F1-F5 执行计划文件齐全，形成连贯的执行链。入口/退出条件明确。 | ✅ 通过 |

**关键观察**: F0 保持在文档/closure 层面，明确不做任何代码变更。代码与计划无冲突。

---

## F1 — Bring-up and First Roundtrip（启动与首次往返）

**状态: 重大偏差 — 计划假设 greenfield；实际代码成熟度远高于预期**

### 计划要建什么 vs 代码实际是什么

| Phase | 计划范围 | 当前代码现实 |
|-------|----------|-------------|
| P1-01 orchestrator-core worker shell | 全新 `workers/orchestrator-core/` | **不存在。** 仓库中没有 `orchestrator-core/` 目录。 |
| P2-01 public start ingress | `POST /sessions/:session_uuid/start` → orchestrator | **已存在** — `agent-core/src/index.ts` 通过 `routeRequest()` → `NanoSessionDO` 路由处理。NanoSessionDO 共 1602 行，处理 start/input/cancel/status/timeline/verify/ws 全部逻辑。 |
| P3-01 agent internal route family | 在 agent-core 上新建 `/internal/start/cancel/stream` | **不存在。** `agent-core/src/host/routes.ts` 没有 `/internal/*` 前缀 — 所有 session 路径都是公开的。 |
| P3-02 internal auth gate | Shared-secret `x-nano-internal-binding-secret` 校验 | **不存在。** agent-core 没有 internal-auth gate。 |
| P4-01 NDJSON first event relay | orchestrator user DO 读取 StreamFrame | **已存在** — `NanoSessionDO` + kernel runner 通过 `session-stream-mapping.ts` 产生 stream events。 |
| P1-02 orchestrator probe marker | `GET /` / `GET /health` 返回 probe | **已存在** — `agent-core/src/index.ts` 第 45-47 行返回 `AgentCoreShellResponse`。 |

### 🔴 严重问题

**问题 1: orchestrator-core ≠ greenfield**（严重程度：高）

计划把 orchestrator-core 当作全新 worker 搭建。但 **agent-core 已经是一个完全成熟的公共入口 worker**：
- 路由表：`/sessions/:id/{ws,start,input,cancel,status,timeline,verify}`
- NanoSessionDO：完整的 session 生命周期（1602 行生产代码）
- Kernel runtime：step loop、LLM wrapper、hooks、eval observability
- Service binding to bash-core：已激活并部署

另建一个重复或代理这些功能的 `orchestrator-core/` 反而会造成 F3 本要解决的 dual-ingress 问题。

**建议**：计划应重新定义，要么：
- (a) 将 **agent-core 视作 orchestrator-core**，原地演进而非新建 worker；或
- (b) 将 `orchestrator-core/` 建成一个**薄路由层**，包裹现有 agent-core 路由，而非重新实现 session 逻辑。

**问题 2: Internal route family 不存在**（严重程度：高）

F1 Phase 3 假设 agent-core 有 `/internal/start/cancel/stream` 端点并带 secret gate。但当前的 `agent-core/src/host/routes.ts`（第 27-75 行）只有公开模式 `/sessions/:sessionId/:action`。路由层没有"internal vs public"的概念。

**建议**：F1 必须明确指定 internal contract 是：
- (a) agent-core 上的新 URL 前缀（`/internal/sessions/...`）
- (b) agent-core worker fetch 中的独立入口点
- (c) 由完全不同的 worker 处理

**问题 3: 文档化的 contexter 吸收项目部分未完成**（严重程度：中）

`F0-contexter-absorption-inventory.md` 规定了以下吸收项目：
- `jwt.ts adopt-as-is` → JWT 校验在 `@haimang/nacp-session` 中，不在独立 jwt.ts 中。部分满足。
- `chat.ts withAuth/withTrace adapt-pattern` → 没有对应的 orchestrator middleware。未完成。
- `engine_do.ts sessions map adapt-pattern` → `NanoSessionDO` 有自己的 session 管理，是对 engine_do.ts 的显著演进。部分满足。
- `core/broadcast.ts relay pattern` → Stream relay 使用 `session-stream-mapping.ts`，非 broadcast.ts。架构不同。

**建议**：F1 应跟踪哪些 contexter 吸收项目已完成、哪些仍为实施项。

---

## F2 — Session Seam Completion（Session 接缝补全）

**状态: 条件通过 — 设计合理，但依赖于 F1 的决策方向**

| 项目 | 发现 | 严重程度 |
|------|------|----------|
| P1-01 SessionEntry 完整化 | `NanoSessionDO` 已管理完整生命周期状态（minted/starting/active/detached/ended）。`status`、`relay_cursor`、`ended_at` 等字段已在运行时状态中。 | ✅ 基本已完成 |
| P1-02 ended retention `24h+100` | 当前代码中未确认。session 清理/淘汰策略需验证。 | ⚠️ 需检查 |
| P2-01 façade input/cancel | 已由 `agent-core` → `NanoSessionDO` 处理。Input 经 `extractTurnInput()`；cancel 经 `cancelCapabilityCall`。 | ✅ 已存在 |
| P2-02 façade status/timeline/verify | `HttpController` 处理这些 action。Status 通过 session state 返回。 | ✅ 已存在 |
| P3-01 WS attach | 公共 WS attach 已在 `/sessions/:id/ws` 通过 `WsController` 存在。single-active-writer 语义已实施。 | ✅ 已存在 |
| P4-01 terminal mapping | `KernelPhase` → lifecycle.status 映射在 `actor-state.ts` 中存在。 | ✅ 已存在 |

### 🔴 严重问题

**F2 的大部分范围已在 agent-core 中实现。** 计划将 F2 定义为"构建这些功能"，但 session seam（start/cancel/status/timeline/verify/ws）已在 `agent-core/NanoSessionDO` 中存在。F2 更适合定义为**审计 + 加固**而非**构建**。

---

## F3 — Canonical Cutover and Legacy Retirement（规范迁移与旧版退役）

**状态: 过早 — 依赖不存在的 orchestrator-core**

| 项目 | 发现 | 严重程度 |
|------|------|----------|
| P1-01 canonical public suite | `test/package-e2e/orchestrator-core/` 目录不存在。 | 🔴 未开始 |
| P2-01 迁移 agent-core session tests | 所有 session tests 都在 `agent-core/` 下。没有迁移目标。 | 🔴 被阻塞 |
| P3-01 cross-e2e 入口迁移 | Cross-e2e 测试引用 `agent-core` 作为公共入口。 | 🔴 被阻塞 |
| P4-01 legacy HTTP 410 | agent-core 没有 hard deprecation 层。路由都是公共且活动的。 | 🔴 过早 |
| P4-02 legacy WS 426 | 同上。 | 🔴 过早 |

### 🔴 严重问题

F3 假设 orchestrator-core 已存在且是规范入口。由于 **orchestrator-core 不存在**，F3 完全被 F1 阻塞。此外，"退役 agent-core 旧路由"这一前提本身就有架构问题 —— 如果 F1 决定原地演进 agent-core 而非新建 orchestrator-core，F3 的整个框架都失效。

另外，F3 提到迁移 `context-core` 测试。但 context-core 的当前 worker（`workers/context-core/src/index.ts`）是**纯库 worker**——只返回 shell probe。没有有意义的 HTTP 路由可迁移。

---

## F4 — Authority Hardening（权限加固）

**状态: 现实 — 正确识别了当前代码的真实缺口**

| 项目 | 发现 | 严重程度 |
|------|------|----------|
| P1-01 ingress/internal helper | 不存在集中的 `validateIngressAuthority()` / `validateInternalAuthority()`。Auth 检查散落在各 handler 中。 | 🔴 真实缺口 |
| P1-02 typed reject taxonomy | 错误响应存在但未统一归类。缺少 trace/authority/tenant/shape 分类。 | 🔴 真实缺口 |
| P2-01 `TEAM_UUID` bootstrap law | 当前 `ENVIRONMENT` 和 `OWNER_TAG` 在 `wrangler.jsonc` 中配置。worker 入口处没有显式的 `TEAM_UUID` 校验。 | 🔴 真实缺口 |
| P2-02 tenant_source snapshot | 当前 `SessionEntry` 中没有 `tenant_source`（claim vs deploy-fill）区分。 | 🔴 真实缺口 |
| P3-01 no-escalation enforcement | 没有集中的 no-escalation 层。内部调用路径使用与外部相同的 auth。 | 🔴 真实缺口 |
| P3-02 executor recheck seam | `bash-core/src/executor.ts` 有 `CapabilityExecutor` 带 policy gate + permission authorizer seam。recheck hook 不存在。 | ⚠️ 部分覆盖 |
| P4-01 negative tests | Auth 失败模式的负例测试覆盖有限。 | ⚠️ 需扩展 |

### 分析

F4 是整个集合中**最现实的执行计划**。它正确识别了：
1. 当前代码缺少集中的合法性实施机制
2. Tenant truth（`TEAM_UUID`）是隐式的，而非强制执行的
3. Auth 决策缺乏审计轨迹
4. Executor permission recheck 是未来需要的 seam

bash-core executor（`workers/bash-core/src/executor.ts`）已经有 `CapabilityPolicyGate` 和 `CapabilityPermissionAuthorizer` 接口——这些为 recheck seam（P3-02）提供了天然集成点。

---

## F5 — Closure and Handoff（收尾与交接）

**状态: 依赖项 — 无法独立评估，交付物取决于 F1-F4 的执行结果**

F5 是纯文档 phase，汇总 F1-F4 产出。在当前阶段无代码与计划的冲突问题。

---

## smind-contexter 吸收情况评估

执行计划通过 `F0-contexter-absorption-inventory.md` 引用 `smind-contexter`（位于 `context/smind-contexter/`）。将 inventory 与实际代码交叉核对：

### adopt-as-is 项目

| 项目 | 代码目标 | 当前状态 |
|------|----------|----------|
| `core/jwt.ts` | JWT verify 逻辑 | ✅ 通过 `@haimang/nacp-session` JWT 类型间接满足。未移植独立 `jwt.ts`。 |

### adapt-pattern 项目

| 项目 | 代码目标 | 当前状态 |
|------|----------|----------|
| `chat.ts` withAuth/withTrace | `orchestrator-core` middleware | ❌ agent-core 中没有等价的 middleware。请求追踪使用 kernel/eval 中的 `TraceContext`，非 incoming middleware。 |
| `engine_do.ts` sessions map | orchestrator user DO | ✅ `NanoSessionDO` 用更复杂的状态机管理 sessions。是演进，不是复制。 |
| `core/broadcast.ts` relay pattern | orchestrator NDJSON relay | ⚠️ Stream relay 存在，但遵循 `session-stream-mapping.ts` 设计，非 broadcast.ts。架构不同。 |

### defer 项目

| 项目 | 状态 |
|------|------|
| `db_do.ts`（richer memory substrate） | ✅ 正确推迟。first-wave session DO 中没有 SQLite/D1。 |
| `core/db_d1.ts`、`core/db_vec.ts` | ✅ 正确推迟。D1/Vectorize 不在 orchestrator 范围中。 |

### discard 项目

| 项目 | 状态 |
|------|------|
| `schemas_cicp.ts`（CICP 协议） | ✅ 正确丢弃。NACP 是协议真相。 |
| `context/*` / `ai/*` / `rag/*` | ✅ 正确丢弃。完全不在 worker-matrix 中（仅存在于 `context/smind-contexter/`）。 |

### 综合吸收评分: 3/5 — Inventory 论证合理，但实际吸收进展不均。多项 adapt-pattern 项目未实现。

---

## 跨层问题

### 问题 A: 计划将"orchestrator"与"新 worker"混为一谈（高严重度）

F1-F3 将 "orchestrator-core" 视为全新 worker。但 `agent-core` 已承担了大部分 orchestrator 角色：

| 能力 | 计划中 (orchestrator-core) | 代码中 (agent-core) |
|------|---------------------------|---------------------|
| 公共 session 路由 | F1 P2 | ✅ `/sessions/:id/start,input,cancel,...` |
| WebSocket attach | F2 P3 | ✅ `/sessions/:id/ws` 通过 WsController |
| Session DO | F1 P2 | ✅ 1602 行 NanoSessionDO |
| First-event relay | F1 P4 | ✅ Kernel + stream mapping |
| Internal auth gate | F1 P3 | ❌ 缺失 |
| 集中化 policy | F4 P1 | ❌ 缺失 |

**建议**：F1 必须明确决定：orchestrator-core 是新 worker 还是 agent-core 的演进？这个决定将改变 F1-F3 的全部结构。

### 问题 B: Context-core 是库，不是服务（中严重度）

`workers/context-core/wrangler.jsonc` 从未以 service binding 部署。preview 中的 "worker" 是 `nano-agent-context-core`，但：
- 其 `src/index.ts` 只返回 probe 响应
- 所有真实 context 逻辑通过 `@haimang/context-core-worker` npm 依赖在 agent-core 进程中运行
- Service binding 在 `agent-core/wrangler.jsonc` 第 37 行被注释掉

F3 假设 context-core 有可部署的 HTTP 路由和 live E2E 测试。这当前不成立。

### 问题 C: Internal binding 设计不够具体（高严重度）

F1 P3 说"在 agent-core 上添加 `/internal/start/cancel/stream`"，但：
- 没有具体的 URL 前缀（`/internal/sessions/...`？）
- 没有 internal vs public 请求体形状差异的合约 schema
- 没有现有调用者的升级/迁移路径

### 问题 D: F4 authority helpers 应作为优先实施项（中严重度）

缺少集中的 auth helper 是最可操作的发现。这些 helper（P1-01/P1-02/P2-01）可以独立于 orchestrator-core 建设，能立即提升系统安全性。

---

## 按 Phase 就绪度矩阵

| Phase | 计划成熟度 | 代码吻合度 | 风险等级 | 需要返工？ |
|-------|-----------|-----------|----------|-----------|
| F0 | 4/5 | 5/5 | 低 | 否 |
| F1 | 4/5（结构良好） | 1/5（忽略现有代码） | 🔴 高 | 是 — 需根据 agent-core 现实重新校准 |
| F2 | 4/5 | 3/5（大部分已存在） | 🟡 中 | 是 — 从"构建"重新定范围为"审计+加固" |
| F3 | 4/5 | 1/5（无 orchestrator-core） | 🔴 高 | 是 — 被 F1 决策阻塞 |
| F4 | 4/5 | 3/5（缺口真实） | 🟡 中 | 否 — 范围正确 |
| F5 | 4/5 | 不适用 | 低 | 否 |

---

## 最终结论

**F0–F5 执行计划结构良好、内部一致、文笔清晰。但它们包含一个根本性的架构盲点：假设 `orchestrator-core` 是 greenfield 构建，而非对已有且成熟的 `agent-core` 的演进。**

这个盲点贯穿 F1（构建已存在的内容）、F2（加固已存在的内容）、F3（替换已在运行的内容）和 F5（交接从未构建的内容）。

### 立即建议

1. **重新校准 F1**，明确处理 agent-core → orchestrator-core 的关系。计划应选择：
   - 将 agent-core 重命名为 orchestrator-core 并原地演进；或
   - 将 orchestrator-core 建成薄路由 facade，以 agent-core 作为内部运行时；或
   - 明确解释在 agent-core 已有能力之外，为什么需要独立 worker。

2. **重新定义 F2** 范围，从"构建 session seam"改为"审计并加固 agent-core/NanoSessionDO 中的现有 session seam"。

3. **对齐 context-core 现实** — 先激活其 service binding 并赋予有意义的 HTTP 路由，再规划测试迁移。

4. **优先实施 F4 Phase 1（policy helpers）**，作为早期独立交付物——它保护整个系统且不依赖 orchestrator-core 决策。

5. **具体化 internal binding contract**：URL 前缀、请求/响应 schema、认证机制、迁移计划。
