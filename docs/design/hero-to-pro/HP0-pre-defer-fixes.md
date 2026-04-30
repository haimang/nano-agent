# Nano-Agent 功能簇设计

> 功能簇: `HP0 Pre-Defer Fixes`
> 讨论日期: `2026-04-30`
> 讨论者: `Owner + GPT-5.4`
> 关联基线文档:
> - `docs/charter/plan-hero-to-pro.md`
> 关联源码锚点:
> - `packages/nacp-session/src/messages.ts:17-20,43-52,119-136`
> - `workers/orchestrator-core/src/session-lifecycle.ts:41-57`
> - `workers/orchestrator-core/src/user-do/session-flow.ts:342-347,445-454`
> - `workers/orchestrator-core/src/user-do/message-runtime.ts:72-77,134-161`
> - `workers/agent-core/src/host/runtime-mainline.ts:162-177`
> - `workers/agent-core/wrangler.jsonc:20-23,44-51,78-87,97-101`
> - `workers/orchestrator-core/wrangler.jsonc:57-63,99-104`
> 关联 QNA / 决策登记:
> - `docs/design/hero-to-pro/HPX-qna.md`（待统一回填 owner / ops 答案后再转 `frozen`；当前先登记建议结论）
> 文档状态: `reviewed`
> 外部 precedent 说明: 当前工作区未 vendored `context/` 源文件；文中出现的 `context/*` 仅作 drafting-time ancestry pointer，不作为当前冻结 / 执行证据。

---

## 0. 背景与前置约束

HP0 不是“功能 phase”，而是 hero-to-pro 真正开工前的 baseline hygiene phase。它负责把 **不依赖新 D1 schema、不依赖 owner-action、不依赖 4 套状态机展开** 的前置 defer 项一次性收干净，避免后续 action-plan 每个 phase 都继续踩同一批旧坑。

- **项目定位回顾**：HP0 是 `freeze-before-build`，不是新的产品能力层。
- **本次讨论的前置共识**：
  - 本轮源码复核后，HP0 只处理立即可完成的 defer 修复、verify-only 项和 R29-dependent residue 的决议准备，不把后续状态机或 D1 设计提前塞进来。
  - `CONTEXT_CORE` binding 与 `LANE_E_RPC_FIRST=false` 已在当前代码中存在，HP0 不再改 wrangler 配置，只做 verify + test。
  - `forwardInternalJsonShadow` / `parity-bridge.ts` 不允许在 HP0 直接物理删除；其终局要等 HP8-B 的 R29 postmortem 后再在 HP10 cleanup 决议。
- **本设计必须回答的问题**：
  - 哪些项属于 HP0 真正要改的内容，哪些只允许 verify，不得误做成“大扫除”？
  - public ingress 的 `model_id` / `reasoning` 字段应该怎样在不引入新 schema 的前提下对齐三条入口？
  - HP0 如何给 HP1 的 `base_instructions_suffix` 预留骨架，但又不制造“字段未落表却假装完成”的假闭合？
- **显式排除的讨论范围**：
  - 任何 D1 migration、新表/新列设计（留 HP1）
  - model state machine / context state machine / confirmation / checkpoint 业务语义（留 HP2+）
  - R29 residue 的最终删除与否（留 HP8-B + HP10）

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`HP0 Pre-Defer Fixes`
- **一句话定义**：`在不改 D1 schema 的前提下，把会污染后续 hero-to-pro 全阶段执行的前置 defer 项收干净，并把 verify-only / later-cleanup 的边界写死。`
- **边界描述**：这个功能簇**包含** `/start` / `/input` 的模型字段透传、`withNanoAgentSystemPrompt(modelId?)` 骨架、binding-presence verify、archive cleanup、lockfile 漂移清扫；**不包含** D1 schema、runtime 新状态机、R29 residue 的最终删除。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| public ingress 模型字段对齐 | `/start`、`/input`、`/messages` 三入口都接受并转发 `model_id` / `reasoning` | 目标是避免 silent drop |
| suffix 骨架 | `withNanoAgentSystemPrompt(modelId?)` 先具备读取接口与调用位点 | 真字段在 HP1 落表后才启用 |
| binding-presence verify | 用测试和 grep 证明 binding / env 已存在 | verify-only，不改 wrangler 配置 |
| R29-dependent residue | `forwardInternalJsonShadow` 与 `parity-bridge.ts` 这类与 R29 诊断有关的历史残留 | HP0 不可误删 |

### 1.2 参考源码与现状锚点

- `packages/nacp-session/src/messages.ts:17-20,43-52,119-136` — 协议层已经允许 `model_id` / `reasoning`
- `workers/orchestrator-core/src/session-lifecycle.ts:41-57` — public `/start` / `/input` body 仍未声明模型字段
- `workers/orchestrator-core/src/user-do/session-flow.ts:342-347,445-454` — `/start` / `/input` 当前仍未透传模型字段
- `workers/orchestrator-core/src/user-do/message-runtime.ts:134-161` — `/messages` 已有 `model_id` / `reasoning` 校验与 gate
- `workers/agent-core/src/host/runtime-mainline.ts:162-177` — `withNanoAgentSystemPrompt()` 目前仍是无 `modelId` 签名
- `workers/agent-core/wrangler.jsonc:20-23,44-51,78-87,97-101` 与 `workers/orchestrator-core/wrangler.jsonc:57-63,99-104` — `LANE_E_RPC_FIRST=false` 与 `CONTEXT_CORE` binding 已存在，可做 verify-only

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- HP0 在整体架构里扮演 **phase-zero hygiene / ingress law repair / cleanup policy freeze** 的角色。
- 它服务于：
  - HP1 之前的字段命名冻结
  - 后续 action-plan 编写
  - review / closure 对“哪些已经完成、哪些只能 verify”的一致口径
- 它依赖：
  - 当前 `orchestrator-core` 的 public ingress 代码
  - 当前 `agent-core` 的 system prompt helper
  - 当前 wrangler / lockfile / archived runbook 状态
- 它被谁依赖：
  - HP1 schema-extension design
  - HP2 model state machine 入口对齐
  - HP10 cleanup 与 R29 postmortem 决议

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| HP1 Schema Extension | HP0 -> HP1 | 强 | `base_instructions_suffix` 命名必须提前对齐 |
| Public ingress routes | HP0 <-> ingress | 强 | `/start` / `/input` / `/messages` 字段 law 由此统一 |
| HP8-B / HP10 cleanup | HP0 -> HP8-B/HP10 | 中 | HP0 只冻结 residue policy，不做终局删除 |
| CI / drift guard | HP0 -> test layer | 中 | binding-presence verify 需要测试落地 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`HP0 Pre-Defer Fixes` 是 **hero-to-pro 的开工前清场层**，负责 **修 ingress law、验证已存在 binding、冻结 residue cleanup 边界**，对上游提供 **可执行的干净 baseline**，对下游要求 **HP1-HP10 不再把这些旧坑当成隐性前提**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| `runbook/zx2-rollback.md` archive 残留 | 已过 archive 生命周期 | 会继续污染当前 runbook 面 | 否 |
| `/start`/`/input` 丢模型字段的旧行为 | 历史上先打通 `/messages` 的快修路径 | 会让 model state machine 从 phase 1 起就建立在不一致入口上 | 否 |
| 把 verify-only 项写成实现项 | 旧 charter 误导 | 会产生重复施工或误删 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| `withNanoAgentSystemPrompt(modelId?)` | 函数签名 | 先支持可选 `modelId` | HP1 后读取 `base_instructions_suffix` 真值 |
| public ingress model law | `StartSessionBody` / `FollowupBody` / forward payload | 透传 `model_id` / `reasoning` | HP2 再接 session-level default / alias / fallback |
| residue cleanup policy | HP0 closure + HP10 cleanup 说明 | 先冻结“不许误删” | HP8-B/HP10 根据 R29 决议删除或保留 |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：verify-only 项与 schema / runtime feature 改造
- **解耦原因**：HP0 若同时改 wrangler / schema / runtime 语义，会丢掉“只做前置修复”的 phase 价值
- **依赖边界**：HP0 只允许改 ingress, helper, tests, archive residue；不改 D1 schema，不新增 product API

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：public ingress 对 `model_id` / `reasoning` 的单一 law
- **聚合形式**：收敛到 `session-lifecycle.ts`、`session-flow.ts`、`message-runtime.ts`
- **为什么不能分散**：如果 `/messages` 与 `/start` `/input` 继续分裂，HP2 的 model state machine 从第一天就不是同一产品面

---

## 4. 参考实现 / 历史 precedent 对比

> HP0 主要是 baseline 修场，因此本设计以 **本仓库 precedent + hero-to-pro studies** 为主，不以外部 reference agent 的完整工作流为主要借鉴对象。

### 4.1 本仓库 public ingress 的现状

- **实现概要**：`/messages` 已支持 `model_id` / `reasoning` / `image_url parts`，但 `/start` 和 `/input` 仍未把相同字段打通。
- **亮点**：
  - `message-runtime.ts` 已经证明字段校验与 `requireAllowedModel()` 这条路是可用的
- **值得借鉴**：
  - 让三入口共享相同字段 law，而不是重新发明第二套模型字段契约
- **不打算照抄的地方**：
  - 继续允许 `/start` / `/input` silent drop 模型字段

### 4.2 real-to-hero 的 precedent

- **实现概要**：RH 阶段多个 closure 已经证明“wire 存在”与“产品口径一致”是两件事。
- **亮点**：
  - RHX2 对 explicit-only / no deceptive closure 的纪律已经建立
- **值得借鉴**：
  - HP0 直接把 verify-only / later-cleanup / still-to-do 三类拆开
- **不打算照抄的地方**：
  - 把 archive、binding、residue 这类基础项继续混进后续 phase 的 action-plan

### 4.3 hero-to-pro studies 的共识

- **实现概要**：study 已经把最小结论说清：当前不是“没有模型能力”，而是“入口与状态不一致”。
- **亮点**：
  - 对 silent drop 的问题定位很准
- **值得借鉴**：
  - 先修产品入口一致性，再做大状态机
- **不打算照抄的地方**：
  - 在 HP0 里顺手扩 schema 或顺手清空所有历史 residue

### 4.4 横向对比速查表

| 维度 | 当前代码 | HP0 目标 | nano-agent 倾向 |
|------|----------|----------|------------------|
| `/messages` 模型字段 | 已支持 | 保持 | 作为单一 law 参考 |
| `/start` / `/input` 模型字段 | 丢失 | 打通 | 不允许 silent drop |
| binding 状态 | 已存在但无专项 verify | verify-only | 不再重复修改配置 |
| R29 residue | 历史残留仍在 | 先冻结 cleanup policy | 不误删、不假装已清空 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** `/start` / `/input` / `/messages` 三入口的 `model_id` / `reasoning` law 对齐 — HP2 之前必须先消除入口不一致。
- **[S2]** `withNanoAgentSystemPrompt(modelId?)` 的签名和调用点骨架 — HP1 字段命名冻结前必须先有接缝。
- **[S3]** binding-presence verify — 已存在的 binding / env 不再靠口头描述，需要变成测试。
- **[S4]** archive / stale-residue 清理与分类 — runbook 这类可直接清的项在 HP0 就应退出视野。
- **[S5]** R29-dependent residue 的“不允许误删”纪律 — 这是 HP0 的关键设计结论之一。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** `nano_models.base_instructions_suffix` 真字段落表 — 属于 HP1；重评条件：HP1 migration 完成
- **[O2]** session-level model default / current model API — 属于 HP2；重评条件：HP2 design / action-plan
- **[O3]** R29 residue 的物理删除 — 属于 HP8-B + HP10；重评条件：postmortem 给出明确结论
- **[O4]** hook dispatcher / confirmation / compact / checkpoint — 属于 HP5/HP3/HP7；重评条件：对应 phase 启动

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `CONTEXT_CORE` binding 再改 wrangler | out-of-scope | 当前代码已存在，只需 verify | HP0 test / closure |
| `forwardInternalJsonShadow` 直接重命名或删除 | defer | 与 R29 诊断证据耦合 | HP8-B / HP10 |
| `base_instructions_suffix` 先用空字符串占位 | in-scope | 允许先开函数签名，不允许伪装成真功能 | HP0 + HP1 |
| `pnpm-lock.yaml` importer 漂移 | conditional in-scope | 只有当前工作树确实漂移时才处理 | HP0 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **先修 ingress law** 而不是 **先做 session-level model API**
   - **为什么**：入口不一致是更底层的 bug；若不先修，后面的 model state machine 会建立在分裂输入之上。
   - **我们接受的代价**：HP0 不会直接给用户新功能。
   - **未来重评条件**：无，HP2 建立在此之上。

2. **取舍 2**：我们选择 **给 `withNanoAgentSystemPrompt` 先加 `modelId?` 骨架** 而不是 **等 HP1 落表后再改函数签名**
   - **为什么**：HP0 的价值之一就是提前对齐字段命名与调用位点。
   - **我们接受的代价**：HP0 completion 可能对这项只标 `partial`。
   - **未来重评条件**：HP1 完成 `base_instructions_suffix` 落表。

3. **取舍 3**：我们选择 **冻结 R29 residue cleanup policy** 而不是 **现在就清空历史残骸**
   - **为什么**：当前这些 residue 仍是诊断与 postmortem 证据的一部分。
   - **我们接受的代价**：工作树短期内仍会保留部分历史命名。
   - **未来重评条件**：HP8-B R29 postmortem 完成。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| HP0 越界成“大扫除” | action-plan 把 verify-only 与 feature 混写 | 打乱 HP1-HP10 边界 | 设计里把 S1/S2/S3 和 defer 项写死 |
| `base_instructions_suffix` 命名与 HP1 不一致 | HP0/HP1 分别独立设计 | 后续要返工函数与 migration | HP1 design doc 先冻结字段名 |
| R29 residue 被误删 | 执行者只看摘要不看 detailed law | 丢失 postmortem 对照材料 | closure 必须显式登记留 HP10 cleanup 决议 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：后续 HP1/HP2 的 action-plan 不再反复处理 ingress / binding / archive 的底层噪音。
- **对 nano-agent 的长期演进**：把“什么是 verify-only、什么是 later-cleanup”在阶段最早处冻结，减少 deceptive closure。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：虽然 HP0 不直接提供新产品面，但它为 model/context/confirmation 三个后续功能簇提供了干净的入口与命名基线。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | 三入口模型字段对齐 | `/start`、`/input`、`/messages` 都接受并转发 `model_id` / `reasoning` | ✅ 三入口不再出现 silent drop |
| F2 | system prompt suffix 骨架 | `withNanoAgentSystemPrompt(modelId?)` 预留 model-aware seam | ✅ HP1 落表后无需再改函数边界 |
| F3 | binding verify 与 archive cleanup | 把已存在 binding 变成测试事实，并清掉确定可删 archive | ✅ 已完成项不再混入后续 phase |
| F4 | R29 residue cleanup law | 显式声明哪些项留给 HP8-B/HP10 决议 | ✅ HP0 不会误删诊断证据 |

### 7.2 详细阐述

#### F1: 三入口模型字段对齐

- **输入**：`StartSessionBody`、`FollowupBody`、`SessionMessagePostBody`
- **输出**：统一进入 agent-core 的 `model_id` / `reasoning` payload
- **主要调用者**：web / wechat / future CLI client；后续 HP2 model endpoints
- **核心逻辑**：以当前 `/messages` 作为 law reference；`/start` 直接 forward，`/input` 转 `handleMessages()` 时不再丢字段
- **边界情况**：
  - `model_id` 格式非法必须返回 400，而不是 silently ignore
  - `reasoning.effort` 必须限制为 `low|medium|high`
- **一句话收口目标**：✅ **三入口输入的模型字段语义一致，且都能到达 agent-core**。

#### F2: system prompt suffix 骨架

- **输入**：可选 `modelId`
- **输出**：model-aware system prompt seam
- **主要调用者**：`runtime-mainline.ts` LLM request assembly
- **核心逻辑**：先改函数签名和调用路径；HP1 前默认 suffix 为空，不读取未落表字段
- **边界情况**：
  - HP0 不能假装已有 per-model suffix 真值
  - 任何默认值都不能改变现有 system prompt 主体含义
- **一句话收口目标**：✅ **函数边界先到位，HP1 能直接接入真实 suffix 数据**。

#### F3: binding verify 与 archive cleanup

- **输入**：当前 wrangler 配置、测试目录、runbook 目录
- **输出**：binding-presence test、archive 删除记录
- **主要调用者**：CI / review / closure
- **核心逻辑**：验证存在性，不重复改配置；已明确退役的 archive 在 HP0 物理删除
- **边界情况**：
  - verify-only 项失败时，HP0 不能宣称完成
  - archive 删除不应误伤仍在引用的运行文档
- **一句话收口目标**：✅ **已完成项变成可验证事实，可删 archive 退出当前视野**。

#### F4: R29 residue cleanup law

- **输入**：`forwardInternalJsonShadow`、`parity-bridge.ts`
- **输出**：明确的 later-cleanup 判定规则
- **主要调用者**：HP8-B R29 postmortem、HP10 final closure
- **核心逻辑**：HP0 只冻结“什么时候可删 / 什么时候必须保留”的 law，不做终局动作
- **边界情况**：
  - 若 R29 判定“有 diff”或“不可验证”，这些 residue 允许继续保留
  - HP10 若删除，必须在 final closure 解释为什么“删除不是替代修 bug”
- **一句话收口目标**：✅ **R29 residue 在 HP0 不会再被错误当作普通 dead code 处理**。

### 7.3 非功能性要求与验证策略

- **性能目标**：HP0 不引入新的 runtime hot-path 复杂度
- **可观测性要求**：closure 必须显式区分 done / partial / verify-only / later-cleanup
- **稳定性要求**：不改变当前 `/messages` 的已上线行为
- **安全 / 权限要求**：`model_id` 透传后仍必须沿用 `requireAllowedModel()` gate
- **测试覆盖要求**：三入口字段透传回归测试 + binding-presence test
- **验证策略**：以现有 public ingress 行为对撞为主，辅以测试与 grep；不以“代码看起来对了”作为结束条件

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次没有直接采用 mini-agent 源码作为 precedent | HP0 以当前仓库与 `context/` 三个 agent 的源码为主 | 不再通过二手 study 转述 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/app-server/src/codex_message_processor.rs:7018-7028` | `OverrideTurnContext` 直接带 `model` 与 `effort` | turn 级模型/effort 是显式输入，不是可被入口静默丢弃的“提示性字段” | HP0 只借鉴“显式透传”纪律 |
| `context/codex/codex-rs/protocol/src/models.rs:471-474` | `model_switch_message()` 构造 `<model_switch>` developer message | 说明跨模型切换被视为明确 runtime 语义，而不是 silent swap | 完整 switch 语义留 HP2 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/utils/model/model.ts:49-98` | 模型解析优先级明确包含会话内 `/model` override | 既然上层把模型视为真实控制输入，底层 ingress 就不应 silent drop | HP0 先补入口 law，一致性比新功能更优先 |
| `context/claude-code/query.ts:659-670` | runtime 调 `callModel()` 时显式传 `model: currentModel` | 说明 runtime model 不是模糊环境态，而是请求装配时的显式字段 | compact / fallback 细节留后续 phase |

### 8.4 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/packages/cli/src/ui/commands/modelCommand.ts:18-45` | `/model set <model-name> [--persist]` 显式设置模型 | 说明模型选择是产品输入，不应在 ingress 中被吞掉 | persist scope 不属于 HP0 |
| `context/gemini-cli/packages/core/src/config/config.ts:1872-1885` | `setModel(newModel, isTemporary)` 同时更新当前模型并区分临时/持久 | 说明“模型切换输入”至少要先可靠到达状态层 | HP0 只先保证 public ingress 不丢字段 |

### 8.5 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `packages/nacp-session/src/messages.ts:43-52,119-136` | 协议层已经支持 `model_id` / `reasoning` | 说明问题不在 NACP schema，而在 public ingress 没有对齐 |
| `workers/orchestrator-core/src/session-lifecycle.ts:41-57` | `StartSessionBody` / `FollowupBody` 还没有 `model_id` / `reasoning` | HP0 必须先补齐 public body 类型 |
| `workers/orchestrator-core/src/user-do/session-flow.ts:342-347,445-454` | `/start` / `/input` 当前未透传模型字段 | 这是 HP0 的直接修复目标 |
| `workers/orchestrator-core/src/user-do/message-runtime.ts:134-161,243-245,296-310` | `/messages` 已有 `model_id` / `reasoning` 校验与 gate | 作为三入口统一 law 的 reference implementation |
| `workers/agent-core/src/host/runtime-mainline.ts:162-177` | `withNanoAgentSystemPrompt()` 目前还不接受 `modelId` | HP0 只先开 seam |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| `HP0-D1` | `withNanoAgentSystemPrompt(modelId?)` 是否允许在 HP0 先开签名、HP1 后回填真值？ | HP0 / HP1 | 允许；但 HP0 若字段未落表只能标 `partial` | `pending-HPX-qna` | `workers/agent-core/src/host/runtime-mainline.ts:162-177`, `packages/nacp-session/src/messages.ts:43-52,119-136`, `workers/orchestrator-core/src/user-do/session-flow.ts:342-347,445-454` |
| `HP0-D2` | `forwardInternalJsonShadow` / `parity-bridge` 是否可在 HP0 直接删？ | HP0 / HP8-B / HP10 | 不可；留待 R29 postmortem 后决议 | `pending-HPX-qna` | `workers/orchestrator-core/src/user-do/message-runtime.ts:72-77`, `workers/orchestrator-core/src/parity-bridge.ts:5-9,57-63` |
| `HP0-D3` | `CONTEXT_CORE` / `LANE_E_RPC_FIRST` 是否还要改 wrangler？ | HP0 | 不改配置，只做 verify + test | `pending-HPX-qna` | `workers/agent-core/wrangler.jsonc:20-23,44-51,78-87,97-101`, `workers/orchestrator-core/wrangler.jsonc:57-63,99-104` |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. HP0 的 in-scope / out-of-scope / later-cleanup 三类边界无二义性。
2. 三入口模型字段 law 与 current code reference path 对齐。
3. `withNanoAgentSystemPrompt(modelId?)` 与 HP1 的字段命名耦合关系已写清。
4. 所有影响 action-plan 执行路径的问题都已在本设计或 QNA register 中回答。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/hero-to-pro/HP0-action-plan.md`
- **需要同步更新的设计文档**：
  - `docs/design/hero-to-pro/HP1-schema-extension.md`
- **需要进入 QNA register 的问题**：
  - `none（本批次先在设计内冻结，后续统一汇总）`

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

HP0 不是产品能力扩张，而是 hero-to-pro 的“施工面整理层”。它会以 **ingress law 修复 + verify-only 证明 + cleanup policy 冻结** 的形式存在，覆盖 public session 入口、system prompt seam、binding 存在性和 archive residue。它与后续 phase 的耦合点不多，但一旦没写清，后面每个 action-plan 都会受到污染。它的复杂度不在代码量，而在“哪些可以现在删、哪些绝对不能误删”的边界纪律。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | `4` | 不是用户新功能，但对 hero-to-pro 作为产品基线极重要 |
| 第一版实现的性价比 | `5` | 改动小、回报高，能显著减少后续 phase 噪音 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | `4` | 通过入口一致性与 cleanup law 为 HP1-HP10 清场 |
| 对开发者自己的日用友好度 | `5` | 减少后续 review 里反复解释“为什么这个项不该在现在删” |
| 风险可控程度 | `4` | 主要风险是越界成大扫除，但设计已给出硬边界 |
| **综合价值** | `5` | 是 hero-to-pro 合法启动的必要前置层 |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：HP0 是否应顺手清掉所有历史 residue
  - **A 方观点**：越早删越干净
  - **B 方观点**：R29 residue 仍是诊断证据，误删会造成 deceptive closure
  - **最终共识**：HP0 只冻结 cleanup law，不直接做终局删除

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-30` | `GPT-5.4` | 初稿 |
