# Nano-Agent 功能簇设计

> 功能簇: `HP8 Runtime Hardening + Chronic Closure`
> 讨论日期: `2026-04-30`
> 讨论者: `Owner + GPT-5.4`
> 关联基线文档:
> - `docs/charter/plan-hero-to-pro.md`
> 关联源码锚点:
> - `package.json:7-17`
> - `workers/agent-core/src/host/do/session-do-runtime.ts:1-19,121-123,200-203,583-599,720-737`
> - `workers/agent-core/src/host/do/session-do/ws-runtime.ts:231-270`
> - `workers/agent-core/src/host/do/session-do-persistence.ts:1-12,50-57`
> - `workers/agent-core/src/host/do/nano-session-do.ts:1-8`
> - `workers/agent-core/src/host/workspace-runtime.ts:1-18,20-31,75-100`
> - `workers/filesystem-core/src/index.ts:47-59,83-125`
> - `workers/orchestrator-core/src/index.ts:1880-1904`
> - `workers/orchestrator-core/src/user-do.ts:1-9`
> - `workers/orchestrator-core/src/user-do-runtime.ts:9-15,1141-1171`
> - `packages/nacp-core/src/messages/tool.ts:4-36`
> - `workers/bash-core/src/tool-call.ts:8-37`
> - `workers/agent-core/src/host/runtime-mainline.ts:383-409`
> - `packages/nacp-core/src/rpc.ts:1-8,19-24,89-124`
> - `packages/orchestrator-auth-contract/src/index.ts:232-255`
> - `packages/orchestrator-auth-contract/src/facade-http.ts:1-17,40-47,120-140`
> - `workers/orchestrator-auth/src/errors.ts:1-21`
> - `docs/runbook/zx5-r28-investigation.md:1-7,32-41,100-141`
> 关联 QNA / 决策登记:
> - `docs/design/hero-to-pro/HPX-qna.md`（已冻结；本设计若与 QNA 冲突，以 QNA 为准）
> 文档状态: `reviewed`

---

## 0. 背景与前置约束

当前仓库已经进入“主链路能跑，但慢性断点与运行时硬化尚未系统收口”的状态：

1. Session DO 的 heartbeat 现在已经通过 `session.heartbeat` 更新 `heartbeatTracker.lastHeartbeatAt`，`alarm()` 也会周期性 health-check、persist checkpoint、sweep deferred answers 并再次 `setAlarm()`；也就是说基础 alarm loop 已存在，但它还只是 runtime seam，不是 HP8 的“平台适配结论 + e2e 验证矩阵” （`workers/agent-core/src/host/do/session-do/ws-runtime.ts:231-270`; `workers/agent-core/src/host/do/session-do-runtime.ts:121-123,200-203,583-599`）。
2. 旧 megafile 已经开始被拆：`session-do-persistence.ts` 注释明确写着它是从 `nano-session-do.ts` 抽出的 persistence helper，`user-do.ts` 也已经只剩薄 façade re-export，`user-do-runtime.ts` 注释同样强调“types + pure helpers 已抽到小 seam”（`workers/agent-core/src/host/do/session-do-persistence.ts:1-12`; `workers/agent-core/src/host/do/nano-session-do.ts:1-8`; `workers/orchestrator-core/src/user-do.ts:1-9`; `workers/orchestrator-core/src/user-do-runtime.ts:9-15`）。
3. 但 stop-the-bleed gate 还没有进 root pipeline：根 `package.json` 目前只有 `check:cycles` 与 `check:observability-drift`，scripts 目录里也还没有 `check-megafile-budget` 或 `check-tool-drift`（`package.json:7-17`）。
4. tool schema 仍分散：`nacp-core` 定义了 canonical `tool.call.*` schema，bash-core 仍维护一份镜像的 TypeScript body interface，agent-core runtime-mainline 还在手写 `{ tool_name, tool_input }` payload，说明 HP8 的 tool registry SSoT 仍未真正存在（`packages/nacp-core/src/messages/tool.ts:4-36`; `workers/bash-core/src/tool-call.ts:8-37`; `workers/agent-core/src/host/runtime-mainline.ts:383-409`）。
5. envelope 也仍是三型并存：`nacp-core` 暴露 internal `Envelope<T>`，auth-contract 继续暴露 `AuthEnvelope<T>` 与 `FacadeEnvelope<T>`，`orchestrator-auth` 错误包装仍返回 `AuthEnvelope<T>`；这说明 HP8 讨论的“收敛到 FacadeEnvelope 唯一对外形状”应该理解为 **public surface cleanup**，而不是消灭内部 RPC envelope（`packages/nacp-core/src/rpc.ts:19-24,89-124`; `packages/orchestrator-auth-contract/src/index.ts:232-255`; `packages/orchestrator-auth-contract/src/facade-http.ts:1-17,120-140`; `workers/orchestrator-auth/src/errors.ts:1-21`）。
6. Lane E 仍有 host-local residue：`session-do-runtime.ts` 与 `workspace-runtime.ts` 仍直接依赖 `@nano-agent/workspace-context-artifacts` 组装 workspace business objects，而 filesystem-core 虽然已经 uplift 成 WorkerEntrypoint RPC surface，但当前暴露的仍只是 artifact 三件套（`workers/agent-core/src/host/do/session-do-runtime.ts:60-66`; `workers/agent-core/src/host/workspace-runtime.ts:1-18,20-31,75-100`; `workers/filesystem-core/src/index.ts:47-59,83-125`）。
7. R28 runbook 已有 owner-action 模板，但它仍停留在“待 owner 回填 stack / root cause / fix branch”的状态，这正是 HP8 要显式终结的 chronic deferral 风格（`docs/runbook/zx5-r28-investigation.md:1-7,32-41,100-141`）。

- **项目定位回顾**：HP8 不是新增产品功能，而是把前面 8 个 phase 已经显露出来的慢性断点、脚本缺口、运行时姿态和边界混乱统一压成可 closure 的系统治理层。
- **本次讨论的前置共识**：
  - HP8 的目标是 hardening / explicit closure，不是继续扩张新 surface。
  - heartbeat alarm、megafile split、tool schema、envelope cleanup 都已经有局部骨架；HP8 讨论的是“如何把骨架变成治理规则”。
  - charter 里旧 megafile 名称已经部分过时，HP8 不能再冻结到已经被拆空的旧入口上。
  - R28 / R29 这类 chronic issue 可以接受 `explicit handoff`，但不能接受 silent carryover。
- **本设计必须回答的问题**：
  - megafile gate 应该盯哪些**当前真实 owner 文件**，而不是盯一组已经拆过的历史名字？
  - tool registry 的单一真相源应收敛到哪一层，如何同时服务 agent-core 与 bash-core？
  - envelope 收敛的边界是“public surface 唯一 FacadeEnvelope”，还是连 internal RPC 也要合并？
  - Lane E 的终态判定标准是什么，何时算 sunset，何时算 retained-with-reason？
- **显式排除的讨论范围**：
  - HP9 的 `clients/api-docs` 重写与 manual evidence
  - hero-to-platform 的实质 inherited issues 设计
  - 新的产品 API 或新状态机

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`HP8 Runtime Hardening + Chronic Closure`
- **一句话定义**：`把 R28/R29、DO heartbeat、megafile budget、tool registry、envelope cleanup 与 Lane E 终态判定收敛成一套可验证、可阻断漂移、可显式 handoff 的 runtime hardening 机制。`
- **边界描述**：这个功能簇**包含** chronic deferral explicitization、runtime heartbeat/alarm hardening、file-budget CI gate、tool catalog SSoT、public envelope cleanup、Lane E final-state decision；**不包含** 新业务 surface、manual evidence pack、hero-to-platform 具体内容。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| chronic deferral | 跨多个阶段反复 carry 的问题项 | HP8 要求 explicit 判定 |
| hardening | 不新增产品功能、只提高 runtime / repo posture 的收口工作 | 包含脚本、验证、边界文档 |
| megafile budget | 针对当前高风险大文件的 stop-the-bleed 阈值 | 是防增长，不是一次性大重构 |
| tool catalog | tool schema / description / binding / capability owner 的单一真相源 | 不是 UI 文档索引 |
| public envelope | 对 client 公开的 HTTP envelope 形状 | HP8 目标是唯一 `FacadeEnvelope` |
| Lane E final state | context/filesystem/workspace host-local residue 的终态说明 | sunset 或 retained-with-reason 二选一 |

### 1.2 参考源码与现状锚点

- `workers/agent-core/src/host/do/session-do/ws-runtime.ts:231-270` 与 `workers/agent-core/src/host/do/session-do-runtime.ts:583-599` — heartbeat/alarm loop 已存在，但还缺 phase-level explicit hardening 结论。
- `workers/agent-core/src/host/do/session-do-persistence.ts:1-12`, `workers/agent-core/src/host/do/nano-session-do.ts:1-8`, `workers/orchestrator-core/src/user-do.ts:1-9`, `workers/orchestrator-core/src/user-do-runtime.ts:9-15` — megafile split 已部分完成，说明 HP8 必须面向“当前文件 owner”而不是历史单文件。
- `workers/orchestrator-core/src/index.ts:1880-1904`, `workers/orchestrator-core/src/user-do-runtime.ts:1141-1171`, `workers/agent-core/src/host/do/session-do-runtime.ts:720-737` — 当前 repo 仍存在高行号 owner 文件，需要 stop-the-bleed gate。
- `package.json:7-17` — 当前 root scripts 还没有 `check:megafile-budget` / `check-tool-drift`。
- `packages/nacp-core/src/messages/tool.ts:4-36`, `workers/bash-core/src/tool-call.ts:8-37`, `workers/agent-core/src/host/runtime-mainline.ts:383-409` — tool schema 与 tool payload 构造仍分散。
- `packages/nacp-core/src/rpc.ts:19-24,89-124`, `packages/orchestrator-auth-contract/src/index.ts:232-255`, `packages/orchestrator-auth-contract/src/facade-http.ts:120-140`, `workers/orchestrator-auth/src/errors.ts:1-21` — `Envelope<T>` / `AuthEnvelope<T>` / `FacadeEnvelope<T>` 三型并存。
- `workers/agent-core/src/host/workspace-runtime.ts:1-18,20-31,75-100` — workspace host-local residue 仍真实存在。
- `docs/runbook/zx5-r28-investigation.md:1-7,32-41,100-141` — R28 现在还是 owner-action template，而不是 closure 结论。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- HP8 在整体架构里扮演 **runtime governance owner**。
- 它服务于：
  - repo 漂移控制（megafile/tool drift）
  - runtime posture hardening（heartbeat/alarm）
  - chronic issue 的 explicit closure / handoff
  - HP9 documentation freeze gate 与 HP10 final closure
- 它依赖：
  - 前置 phases 已落地的 runtime seams
  - root scripts / CI 接入点
  - current worker topology 与 contract packages
  - owner 对 R28 / prod / deploy-only 症状的操作配合
- 它被谁依赖：
  - HP9 文档冻结
  - HP10 final closure
  - future hero-to-platform inherited issues register

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| HP5/HP6/HP7 runtime | HP8 <- runtime | 强 | HP8 要把前面 phases 暴露的 chronic issue 压成 closure 规则 |
| Root scripts / CI | HP8 -> repo | 强 | megafile/tool drift gate 都是仓库级守卫 |
| HP9 docs freeze | HP8 -> HP9 | 强 | HP8 不 closure，HP9 不应开始冻结文档 |
| HP10 final closure | HP8 -> HP10 | 强 | HP8 的 retained / handoff 判定会直接进入 final closure |
| owner manual ops | owner -> HP8 | 中 | R28/R29/prod baseline 需要 owner 配合，但 HP8 必须显式化其结果 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`HP8 Runtime Hardening + Chronic Closure` 是 **阶段级 runtime 治理与慢性断点收口 owner**，负责 **把 heartbeat/alarm、脚本 gate、tool/envelope 单一真相源和 chronic deferral 判定统一成可验证的 repo/runtime posture**，对上游提供 **可冻结、可 handoff、可阻断漂移的闭环条件**，对下游要求 **HP9/HP10 不再建立在模糊 carryover 上**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 继续以历史 megafile 名称定义 budget gate | 旧 charter 文案 | 已与当前仓库分层现实脱节 | 否 |
| 为 tool registry 再造第二套 docs-only catalog | 当前 schema 分散 | 会让 schema 与描述继续漂移 | 否 |
| 把 internal RPC envelope 也硬并入 FacadeEnvelope | 三层 envelope 并存 | internal RPC 与 public facade 是两种 transport profile | 否 |
| silent carryover R28/R29 | owner-action 不稳定 | 会把 HP8 变成“继续拖延”的同义词 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| megafile budget config | `scripts/check-megafile-budget.mjs` 内 budget map | 先冻结当前 owner 文件上限 | future 可移到 JSON config |
| tool catalog | `packages/nacp-core/src/tools/tool-catalog.ts` | schema + description + owner binding | future 可扩 doc generator / SDK output |
| drift guard | `scripts/check-tool-drift.mjs` | schema-level drift check | future 可扩 generated diff report |
| retained registry | closure / lane-e-final-state docs | `retained-with-reason` 明细 | future 可汇总进 hero-to-platform inherited issues |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：public envelope cleanup 与 internal RPC envelope。
- **解耦原因**：client-facing `FacadeEnvelope` 与 internal `nacp-internal` profile 不是一个 transport 层；强行合并会模糊边界。
- **依赖边界**：HP8 只要求“对外唯一 FacadeEnvelope”；内部继续允许 `Envelope<T>` 与 `AuthEnvelope<T>` 作为 worker-to-worker contract。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：chronic issue 判定、tool schema、megafile budgets、Lane E 终态说明。
- **聚合形式**：收敛到 root scripts + explicit docs + compile-/grep-level guard。
- **为什么不能分散**：这些项若继续散在 runbook、closure、worker 注释和临时脚本里，HP10 最终收口时无法判断什么是真的“完成”，什么只是“暂时没人继续追”。

---

## 4. 参考实现 / 历史 precedent 对比

> 本节 precedent 以当前仓库源码锚点为 authoritative evidence；若出现 `context/*`，仅作 external ancestry pointer。

### 4.1 当前仓库的 precedent / 反例

- **实现概要**：当前仓库已经有三类可复用 hardening 骨架：第一，Session DO 已经进入 alarm-driven heartbeat + deferred sweep 结构；第二，megafile 已被拆出多个小 seam；第三，tool/envelope contract 已经各自有 canonical package 层定义，但调用侧尚未完全收敛（`workers/agent-core/src/host/do/session-do-runtime.ts:583-599`; `workers/agent-core/src/host/do/session-do-persistence.ts:1-12`; `workers/orchestrator-core/src/user-do.ts:1-9`; `packages/nacp-core/src/messages/tool.ts:4-36`; `packages/nacp-core/src/rpc.ts:89-124`; `packages/orchestrator-auth-contract/src/facade-http.ts:120-140`）。
- **亮点**：
  - 不是从零开始；每个 chronic topic 都已经有“半成品正确骨架”
- **值得借鉴**：
  - 继续沿用 alarm 驱动而非 attachment timer
  - 继续沿用 seam extraction，而不是回到 superfile
  - 继续由 package 层承担 canonical contract owner
- **不打算照抄的地方**：
  - 继续容忍 caller 侧手写重复 tool payload
  - 继续把 explicit closure 依赖 runbook 模板长期悬置

### 4.2 外部 precedent

- **实现概要**：本批次未直接采用 `context/` 下外部 agent 的专门 runtime-hardening 源码。
- **亮点**：
  - `N/A`
- **值得借鉴**：
  - `N/A`
- **不打算照抄的地方**：
  - `N/A`

### 4.3 横向对比速查表

| 维度 | 当前 nano-agent | HP8 倾向 |
|------|-----------------|----------|
| heartbeat loop | 已有 alarm seam | 补 phase-level hardening 与 e2e 结论 |
| megafile split | 已开始拆 | 加 stop-the-bleed gate |
| tool schema source | canonical schema 已在 nacp-core，但调用侧仍重复 | 收敛到 tool catalog |
| public envelope | FacadeEnvelope 已存在，但三型并存 | 对外唯一 FacadeEnvelope，内部 profile 保持分层 |
| chronic issues | runbook/template/注释分散 | explicit closure / retained / handoff |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** R28/R29/Lane E 这类 chronic issue 的 explicit closure 机制。
- **[S2]** DO heartbeat alarm 化的最终 runtime posture 与验证矩阵。
- **[S3]** current-owner megafile budget gate。
- **[S4]** tool catalog SSoT + drift guard。
- **[S5]** public envelope cleanup 与 retained-with-reason registry。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** HP9 文档内容本身 —— 留给 HP9；重评条件：HP8 closure 后进入 doc freeze。
- **[O2]** hero-to-platform inherited issues 详细方案 —— 留给 HP10 / 下一阶段；重评条件：进入 final closure。
- **[O3]** 新的产品 endpoint 或状态机 —— 不属于 hardening；重评条件：新 charter。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| megafile gate 是否仍盯 `nano-session-do.ts` | out-of-scope | 该入口已变成 8 行 re-export | HP8 转盯当前 owner 文件 |
| envelope 收敛是否要求删掉 internal `Envelope<T>` | out-of-scope | internal/profile layering 仍需要它 | HP8 仅约束 public shape |
| R28/R29 是否必须找到代码级根因 | defer | HP8 接受 explicit handoff，但不接受 silent | HP8 closure register |
| Lane E 是否必须立刻物理删除 host-local residue | defer | 允许 retained-with-reason 路径 | HP8 final-state doc |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **对当前 owner 文件设 stop-the-bleed gate**，而不是 **继续围绕历史 megafile 名称写预算**
   - **为什么**：当前真实大文件已经变成 `orchestrator-core/src/index.ts`、`user-do-runtime.ts`、`session-do-runtime.ts` 这一组，而不是旧单文件。
   - **我们接受的代价**：budget map 需要跟着 split 现实更新一次。
   - **未来重评条件**：当这些 owner 文件继续拆小后，再下调阈值。

2. **取舍 2**：我们选择 **tool catalog 收敛到 `nacp-core`**，而不是 **让 agent-core/bash-core 继续各写各的镜像类型**
   - **为什么**：`nacp-core` 已经是 message/schema canonical owner。
   - **我们接受的代价**：需要一次 consumer 迁移与 drift guard 编写。
   - **未来重评条件**：无。

3. **取舍 3**：我们选择 **public surface 唯一 FacadeEnvelope**，而不是 **把 internal RPC envelope 也强行并入**
   - **为什么**：public 与 internal 是两条不同 transport profile。
   - **我们接受的代价**：仓内仍保留多种 envelope 类型名。
   - **未来重评条件**：无；这属于分层，而不是混乱。

4. **取舍 4**：我们选择 **R28/R29/Lane E 允许 explicit handoff / retained-with-reason**，而不是 **要求所有 chronic item 都必须代码根治**
   - **为什么**：这类问题里有 owner-only、deploy-only、platform-fit 项；强行要求一刀切“代码修完”会诱发伪 closure。
   - **我们接受的代价**：closure 文档会保留一些未完成项，但它们必须是显式、带理由的。
   - **未来重评条件**：进入 hero-to-platform 时。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| megafile gate 阈值过低 | 直接用理想值而非当前现实 | HP8 一落地就全红 | 以当前 file owner 高水位为基线，先 stop-the-bleed |
| tool catalog 只写文件不改 consumers | 迁移只做了一半 | drift 继续发生 | drift guard 必须看 consumer imports / payload 构造 |
| envelope cleanup 误伤 internal RPC | 把 `Envelope<T>` 当成也要删除 | internal worker contract 断裂 | 明确“public-only cleanup”边界 |
| chronic issue 再次 silent | owner 未回填 / runbook 未追 | HP10 无法真 closure | HP8 closure 必须为每项写 `closed / retained-with-reason / handoff` |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：后续所有“这东西到底算不算还没做完”都能从同一套 closure law 里找到答案。
- **对 nano-agent 的长期演进**：HP8 把 repo/runtime posture 从“能跑”推进到“可维护、可冻结、可 handoff”。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：没有 HP8，HP9/HP10 只会把漂移与慢性断点包装成更漂亮的文档。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | chronic issue register | R28/R29/Lane E explicit 判定 | ✅ 不再有 silent carryover |
| F2 | heartbeat hardening | alarm-driven heartbeat 的 phase-level 终态与 e2e | ✅ DO heartbeat 变成正式 platform posture |
| F3 | megafile budget gate | current-owner file ceilings + root script | ✅ 大文件只减不增 |
| F4 | tool catalog SSoT | tool schema/description/binding 收敛 | ✅ tool contract 第一次真正单源 |
| F5 | envelope + Lane E cleanup law | public envelope 唯一化 + Lane E retained/sunset law | ✅ HP10 可基于显式分类收口 |

### 7.2 详细阐述

#### F1: chronic issue register

- **输入**：R28 runbook、R29 divergence 验证结果、Lane E 现状审查
- **输出**：每项 chronic issue 的显式判定记录
- **主要调用者**：HP8 closure、HP10 final closure、hero-to-platform inherited issues register
- **核心逻辑**：
  - 每项 chronic issue 必须归入三类之一：
    1. `closed`
    2. `retained-with-reason`
    3. `handed-to-platform`
  - chronic register 的最小 artifact 对齐冻结为：
    - R28：`docs/runbook/zx5-r28-investigation.md`
    - R29 verify：`scripts/verify-initial-context-divergence.mjs`
    - R29 判定：`docs/issue/zero-to-real/R29-postmortem.md`
    - Lane E 终态：`docs/architecture/lane-e-final-state.md`
  - R28 至少要补齐：stack source、root cause class、chosen branch
  - R29 至少要补齐：`zero diff / diff found / unverifiable`
  - Lane E 至少要补齐：`sunset host-local residue` 或 `retain host-local residue with reason`
- **边界情况**：
  - owner 未配合时允许 `handed-to-platform`
  - 不允许 `silent` 或“看起来好了”
- **一句话收口目标**：✅ **HP8 之后，慢性断点只能显式存在，不能隐式漂移**。

#### F2: heartbeat hardening

- **输入**：`session.heartbeat` ingress、DO `alarm()`、abnormal disconnect 场景
- **输出**：正式 runtime posture + test matrix
- **主要调用者**：Session DO、cross-e2e、support/debug
- **核心逻辑**：
  - 继续冻结“DO `alarm()` 驱动 heartbeat health-check”作为唯一主线
  - 不回退到 attachment-lifetime timer
  - 验证矩阵至少覆盖：
    1. 正常 heartbeat 持续连接
    2. heartbeat 丢失后 close + checkpoint
    3. reconnect/resume 后恢复
    4. deferred answers sweep 与 heartbeat alarm 共存
- **边界情况**：
  - 无 attached socket 但 deferred answers 存在时，alarm 仍需 sweep
  - restore helper 与 heartbeat helper 顺序必须稳定
- **一句话收口目标**：✅ **heartbeat 不再只是实现细节，而是已验证的平台适配姿态**。

#### F3: megafile budget gate

- **输入**：当前高行号 owner 文件
- **输出**：`scripts/check-megafile-budget.mjs` + root script + CI gate
- **主要调用者**：CI、评审、未来 split PR
- **核心逻辑**：
  - 第一版 budget 不再盯历史文件名，而盯当前 owner：
    - `workers/orchestrator-core/src/index.ts <= 2000`
    - `workers/orchestrator-core/src/user-do-runtime.ts <= 1200`
    - `workers/agent-core/src/host/do/session-do-runtime.ts <= 800`
    - helper/seam 文件默认 `<= 500`
  - 这些阈值是 **stop-the-bleed ceiling**，不是终局理想值
  - 每次 split 完成后，只允许下调不允许上调
- **边界情况**：
  - `nano-session-do.ts` / `user-do.ts` 这类 re-export wrapper 不参与 budget
  - 生成文件、manifest 文件不纳入 gate
- **一句话收口目标**：✅ **代码体量治理第一次绑定到当前真实 owner 文件，而不是历史残影**。

#### F4: tool catalog SSoT

- **输入**：tool schema、description、capability owner、consumer payload shape
- **输出**：`tool-catalog.ts` + drift guard
- **主要调用者**：agent-core、bash-core、future docs/client tooling
- **核心逻辑**：
  - 把以下事实收敛进单一 catalog：
    - tool id
    - request schema
    - response schema
    - cancel schema
    - description
    - capability owner
    - transport binding name
  - `nacp-core/messages/tool.ts` 改为从 catalog 派生 schema 或至少由 catalog 驱动
  - bash-core/tool-call 与 agent-core/runtime-mainline 改为消费 catalog，而不是保留本地镜像类型
  - `scripts/check-tool-drift.mjs` 检查：
    - duplicated schema literals
    - mismatched tool names / capability names
    - caller 侧 payload drift
- **边界情况**：
  - catalog 是 contract source，不是 runtime registry UI
  - 不要求 HP8 一次性把 clients/api-docs 自动生成
- **一句话收口目标**：✅ **tool contract 不再靠“几份看起来差不多的手写定义”维持一致**。

#### F5: envelope + Lane E cleanup law

- **输入**：`Envelope<T>` / `AuthEnvelope<T>` / `FacadeEnvelope<T>` 现状、workspace host-local residue
- **输出**：public envelope cleanup law + `lane-e-final-state.md`
- **主要调用者**：public API、closure docs、hero-to-platform handoff
- **核心逻辑**：
  - envelope cleanup 规则冻结为：
    - public HTTP responses 只允许 `FacadeEnvelope`
    - internal RPC 继续允许 `Envelope<T>` / `AuthEnvelope<T>`
    - 任何 public code path 若仍直接 re-emit internal envelope，都算 drift
  - Lane E final-state 规则冻结为：
    - 若 host-local consumer 已全部 sunset，则文档化 `closed`
    - 若因 platform-fit 或 cost/complexity 需要保留，则必须写 `retained-with-reason`
- **边界情况**：
  - retained-with-reason 不等于“以后再说”；必须给出 retained scope、风险、移除条件
  - 任何对外 still-exposed `AuthEnvelope` 都视为 HP8 未收口
- **一句话收口目标**：✅ **public contract 与 runtime residue 都第一次有明确边界法则**。

### 7.3 非功能性要求与验证策略

- **性能目标**：新增 gate 脚本不应显著拖慢 root check；优先 grep/AST 轻量实现。
- **可观测性要求**：R28/R29/Lane E 判定都要有 closure-able 文档证据。
- **稳定性要求**：heartbeat alarm 改造不得引入新的 silent close / missed sweep。
- **安全 / 权限要求**：envelope cleanup 不得弱化 internal authority / trace law。
- **测试覆盖要求**：
  - heartbeat 4-scenario cross-e2e
  - megafile gate script test / smoke
  - tool drift guard smoke
  - public envelope grep/assert
- **验证策略**：以“脚本 gate + phase closure + grep/assert”三层合围为准。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次未直接采用 mini-agent 源码 | HP8 主要是当前仓库 hardening 收口 | 不再通过二手 markdown 转述 |

### 8.2 来自外部 precedent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次未直接采用 `context/` 外部 agent 的专门 hardening 源码 | HP8 以当前仓库 runtime / contract 现实为主 | 保持空缺，不制造二手 precedent |

### 8.3 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `workers/agent-core/src/host/do/session-do-runtime.ts:583-599` 与 `workers/agent-core/src/host/do/session-do/ws-runtime.ts:231-270` | alarm-driven heartbeat 已存在 | HP8 继续沿用并把它提升为 phase-level runtime posture |
| `workers/agent-core/src/host/do/session-do-persistence.ts:1-12` 与 `workers/orchestrator-core/src/user-do-runtime.ts:9-15` | megafile 已开始拆 seam | HP8 的 gate 要面向当前 owner 文件 |
| `package.json:7-17` | 当前没有 megafile/tool drift gate | 这是 HP8 必补的 repo 漂移断点 |
| `packages/nacp-core/src/messages/tool.ts:4-36`, `workers/bash-core/src/tool-call.ts:8-37`, `workers/agent-core/src/host/runtime-mainline.ts:383-409` | tool schema / payload 仍分散 | HP8 要把它们收敛进 tool catalog |
| `packages/nacp-core/src/rpc.ts:89-124`, `packages/orchestrator-auth-contract/src/index.ts:232-255`, `packages/orchestrator-auth-contract/src/facade-http.ts:120-140` | 三类 envelope 并存 | HP8 只清理 public surface，不误伤 internal profile |
| `workers/agent-core/src/host/workspace-runtime.ts:1-18,20-31,75-100` | Lane E host-local workspace residue 仍真实存在 | HP8 必须给出 sunset 或 retained-with-reason 结论 |
| `docs/runbook/zx5-r28-investigation.md:100-141` | R28 现在仍只是 owner 回填模板 | HP8 不能接受继续 template-only carry |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| `HP8-D1` | megafile gate 是否继续盯历史文件名？ | HP8 / CI / future split | 否；改盯当前 owner 文件 | `frozen` | 当前 `nano-session-do.ts` 与 `user-do.ts` 已基本变成 wrapper，而真正高行号 owner 已是 `index.ts` / `user-do-runtime.ts` / `session-do-runtime.ts`：`workers/agent-core/src/host/do/nano-session-do.ts:1-8`, `workers/orchestrator-core/src/user-do.ts:1-9`, `workers/orchestrator-core/src/index.ts:1880-1904`, `workers/orchestrator-core/src/user-do-runtime.ts:1141-1171`, `workers/agent-core/src/host/do/session-do-runtime.ts:720-737` |
| `HP8-D2` | tool catalog 应落在哪一层？ | HP8 / agent-core / bash-core | `nacp-core` | `frozen` | canonical tool message schema 已在 `nacp-core`，caller/callee 重复只应向它收敛：`packages/nacp-core/src/messages/tool.ts:4-36`, `workers/bash-core/src/tool-call.ts:8-37`, `workers/agent-core/src/host/runtime-mainline.ts:399-405` |
| `HP8-D3` | envelope 收敛是否包括 internal RPC？ | HP8 / public API / worker RPC | 否；只要求 public 唯一 `FacadeEnvelope` | `frozen` | `Envelope<T>` 与 `AuthEnvelope<T>` 仍是 internal contract，而 `FacadeEnvelope` 才是 public facade shape：`packages/nacp-core/src/rpc.ts:19-24,89-124`, `packages/orchestrator-auth-contract/src/index.ts:232-255`, `packages/orchestrator-auth-contract/src/facade-http.ts:120-140` |
| `HP8-D4` | R28/R29/Lane E 是否允许 retained/handoff？ | HP8 / HP10 | 允许，但必须 explicit | `frozen` | runbook 与 current residue 都表明这类问题存在 owner-only / deploy-only 特征；禁止 silent，允许 explicit：`docs/runbook/zx5-r28-investigation.md:100-141`, `workers/agent-core/src/host/workspace-runtime.ts:1-18,20-31` |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. chronic issue 的判定类型已经冻结。
2. megafile/tool drift gate 的 owner 与目标已经写清。
3. public envelope cleanup 与 internal envelope 边界已经写清。
4. Lane E 终态文档的判定法则已经写清。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/hero-to-pro/HP8-action-plan.md`
- **需要同步更新的设计文档**：
  - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`
  - `docs/design/hero-to-pro/HP7-checkpoint-revert.md`
- **实现前额外提醒**：
  - HP8 的第一步必须先落 scripts/gates 与 closure law，再动代码 cleanup；否则 chronic issue 会再次散掉。

---

## 10. Value Verdict

### 10.1 价值结论

`HP8 Runtime Hardening + Chronic Closure` 必须做，而且它是 HP9/HP10 能否成立的前提。因为没有 HP8，后面的“文档冻结”和“final closure”都只能建立在漂移中的事实之上。

### 10.2 对 charter 目标的支撑度

它直接支撑：

1. hero-to-pro 对“可维护、可冻结、可 handoff”阶段基线的要求
2. HP9 Documentation Freeze Gate
3. HP10 Final Closure Gate

### 10.3 当前建议

- **建议状态**：`approved-for-action-plan`
- **原因**：当前断点、脚本缺口、contract owner 与 retained/handoff 规则都已经足够明确，可以进入 action-plan。
