# Nano-Agent 行动计划 — Workspace / Context / Artifacts

> 服务业务簇: `Workspace Data Plane`
> 计划对象: `@nano-agent/workspace-context-artifacts` — mount-based workspace namespace、artifact refs 与 layered context assembly
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-16`
> 文件位置: `packages/workspace-context-artifacts/`（独立 repo，位于 `packages/` 下）
> 关联设计 / 调研文档:
> - `docs/design/workspace-context-artifacts-by-GPT.md`
> - `docs/design/capability-runtime-by-GPT.md`
> - `docs/design/llm-wrapper-by-GPT.md`
> - `docs/design/agent-runtime-kernel-by-GPT.md`
> - `docs/action-plan/agent-runtime-kernel.md`
> - `docs/action-plan/llm-wrapper.md`
> - `docs/action-plan/capability-runtime.md`
> - `docs/action-plan/nacp-core.md`
> - `docs/action-plan/nacp-session.md`
> - `docs/eval/vpa-fake-bash-by-GPT.md`
> - `README.md`
> - 参考代码：`packages/nacp-core/`、`context/just-bash/`、`context/codex/codex-rs/exec-server/`、`context/claude-code/utils/attachments.ts`、`context/claude-code/services/compact/compact.ts`、`context/claude-code/utils/toolResultStorage.ts`、`context/mini-agent/mini_agent/tools/file_tools.py`
> 文档状态: `draft`

---

## 0. 执行背景与目标

nano-agent 已经明确不把宿主真实文件系统当真相，也不把 transcript 当唯一上下文真相。  
在这种前提下，真正的数据地基必须回答下面几个问题：

1. fake bash / capability runtime 在读写的“文件”到底是什么
2. 大工具结果、图片、文档、导出物何时变成 artifact ref
3. llm-wrapper 如何获得 prepared artifact 与分层上下文
4. compact / snapshot / restore 的边界由谁来定义

所以 `Workspace / Context / Artifacts` 的任务，不是先写 KV/R2/DDL，而是先冻结 **命名空间、引用模型、上下文层级、compact 边界与 snapshot seam**。  
同时，这一层虽然会深度吸收 `context/just-bash` 的 mount/router 心智，但实现必须在 nano-agent 仓内完成；`context/just-bash` 只是参考与行为基线，不应成为 runtime dependency。

- **服务业务簇**：`Workspace Data Plane`
- **计划对象**：`@nano-agent/workspace-context-artifacts`
- **本次计划解决的问题**：
  - nano-agent 需要一个 mount-based virtual workspace，而不是继续假装存在宿主本地目录
  - `ArtifactRef` / `Prepared Artifact` / large tool result promotion 还缺统一对象模型
  - `llm-wrapper`、`capability-runtime`、`kernel`、`compact` 对上下文和对象边界的依赖，需要一个共同语义底座
  - hibernation / restore / replay 需要最小 workspace/context fragment，但目前还没有明确定义
- **本次计划的直接产出**：
  - `packages/workspace-context-artifacts/` 独立包骨架
  - `WorkspaceNamespace / MountConfig / ArtifactRef / PreparedArtifact / ContextAssembler / CompactBoundary / WorkspaceSnapshot` 类型与接口体系
  - mount router、memory backend、artifact registry/store seam、prepared artifact seam、context assembly、compact boundary、snapshot builder
  - 以 fake workspace / fake artifacts / compact fixtures / snapshot fixtures 跑通最小数据平面验证

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 分 **5 个 Phase**，执行策略是 **“先语义层，再 namespace，再 artifact，再 context/compact，最后 snapshot 与场景测试收口”**。  
这里最重要的是先把 **数据对象边界** 做对，而不是先抢跑物理存储拓扑。v1 如果过早把 DO/KV/R2 placement 写死，后面一旦 compact、prepared artifact 或 snapshot shape 调整，就会全面返工。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | 包骨架与 Workspace Domain Model | M | 建立独立包，冻结 namespace/ref/context/snapshot 语义类型 | `-` |
| Phase 2 | Workspace Namespace / Mount Router / Backends | L | 落地 mount-based namespace、最长前缀匹配路由与 memory backend | Phase 1 |
| Phase 3 | Artifact Registry / Prepared Artifact / Result Promotion | L | 建立 artifact ref、prepared artifact、large result promotion seam | Phase 1, Phase 2 |
| Phase 4 | Context Assembler / Compact Boundary / Redaction | M | 冻结分层上下文、compact 输入输出边界与 session-visible preview/redaction | Phase 1, Phase 3 |
| Phase 5 | Snapshot Builder / Fixtures / 文档 / 收口 | M | 建立最小 snapshot fragment，并用 fake data plane 场景验证 | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — 包骨架与 Workspace Domain Model**
   - **核心目标**：建立独立包，并冻结 workspace path、mount、artifact ref、prepared artifact、context layer、compact boundary、snapshot 等语义类型。
   - **为什么先做**：没有统一对象模型，后续 namespace、artifact、context assembler 都会各自定义一套真相。
2. **Phase 2 — Workspace Namespace / Mount Router / Backends**
   - **核心目标**：建立 mount-based namespace 与最小 backend 合同，至少跑通 memory backend 与 reference backend seam。
   - **为什么放在这里**：capability runtime 和 fake bash 最先依赖的就是稳定的读写命名空间。
3. **Phase 3 — Artifact Registry / Prepared Artifact / Result Promotion**
   - **核心目标**：把大对象、工具输出、图片、文档、compact summary 纳入统一 ref 与 preparation 语义。
   - **为什么放在这里**：artifact 模型决定 llm-wrapper、tool result、export/snapshot 如何交换对象。
4. **Phase 4 — Context Assembler / Compact Boundary / Redaction**
   - **核心目标**：定义进入模型与 runtime 的分层上下文，以及 compact 前 strip / compact 后 reinjection 的正式边界。
   - **为什么放在这里**：只有 namespace 与 artifact 模型稳定后，context assembler 才不会拼接一堆临时结构。
5. **Phase 5 — Snapshot Builder / Fixtures / 文档 / 收口**
   - **核心目标**：冻结最小 checkpoint/export fragment，并用 fake workspace / fake artifacts / compact fixtures 做整体验证。
   - **为什么放在这里**：snapshot 是对前四个 Phase 的综合收口，不能提前拍脑袋定 shape。

### 1.4 执行策略说明

- **执行顺序原则**：`domain model -> in-repo namespace reimplementation -> artifacts/prepared -> context/compact -> snapshot/tests`
- **风险控制原则**：先冻结语义层与接口层，不抢跑最终 storage topology；只实现最小 backend 与最小 artifact kinds
- **测试推进原则**：mount routing、artifact ref、context assembly、compact boundary、snapshot 各有独立单测，再用 fake data plane integration 收口
- **文档同步原则**：实现时同步回填 `workspace-context-artifacts-by-GPT.md`、`llm-wrapper-by-GPT.md`、`capability-runtime-by-GPT.md`、`agent-runtime-kernel-by-GPT.md`

### 1.5 本次 action-plan 影响目录树

```text
packages/workspace-context-artifacts/
├── src/
│   ├── version.ts
│   ├── types.ts
│   ├── paths.ts
│   ├── mounts.ts
│   ├── namespace.ts
│   ├── refs.ts
│   ├── artifacts.ts
│   ├── prepared-artifacts.ts
│   ├── promotion.ts
│   ├── context-layers.ts
│   ├── context-assembler.ts
│   ├── compact-boundary.ts
│   ├── redaction.ts
│   ├── snapshot.ts
│   ├── backends/
│   │   ├── memory.ts
│   │   └── reference.ts
│   └── index.ts
├── test/
│   ├── namespace.test.ts
│   ├── mounts.test.ts
│   ├── refs.test.ts
│   ├── artifacts.test.ts
│   ├── prepared-artifacts.test.ts
│   ├── promotion.test.ts
│   ├── context-assembler.test.ts
│   ├── compact-boundary.test.ts
│   ├── snapshot.test.ts
│   └── integration/
│       ├── fake-workspace-flow.test.ts
│       ├── compact-reinject.test.ts
│       └── snapshot-restore-fragment.test.ts
├── package.json
├── tsconfig.json
├── README.md
└── CHANGELOG.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `@nano-agent/workspace-context-artifacts` 独立包骨架
- **[S2]** `WorkspacePath / MountConfig / WorkspaceNamespace / ArtifactRef / PreparedArtifactRef / ContextLayer / WorkspaceSnapshot` 类型体系
- **[S3]** `ArtifactRef` / `PreparedArtifactRef` 作为 `NacpRef` 语义包装，而不是另造 wire schema
- **[S4]** mount-based namespace 与 longest-prefix mount router
- **[S5]** memory backend 与 reference backend seam
- **[S6]** session-local writable mount、shared readonly mount、artifact pseudo-path 语义
- **[S7]** `ArtifactRegistry / ArtifactStore` 接口层
- **[S8]** prepared artifact contract：至少支持 extracted-text / summary / preview 这类最小种类
- **[S9]** capability result -> artifact promotion seam
- **[S10]** `ContextAssembler`：system、session、workspace、artifact summary、recent transcript 等层级
- **[S11]** `CompactBoundaryManager`：strip / request / response / reinjection 边界
- **[S12]** session-visible preview / redaction helper
- **[S13]** `WorkspaceSnapshotBuilder`：只导出 workspace/context fragment
- **[S14]** fake workspace / fake artifact / compact fixture / snapshot fixture 测试基座
- **[S15]** README、公开导出与 package scripts

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 最终 DO / KV / R2 / D1 storage topology 冻结
- **[O2]** 真实 Cloudflare backend adapter 的生产级实现
- **[O3]** 完整 Git 仓库语义与索引数据库
- **[O4]** 完整 OCR / embedding / semantic indexing pipeline
- **[O5]** 完整 compact 算法与模型调用本体
- **[O6]** transcript / analytics / registry 的最终 DDL
- **[O7]** 多用户协作 workspace
- **[O8]** client-visible完整 UI/SDK 对 artifact 的下载/预览体验

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| mount-based workspace truth | `in-scope` | 这是 Worker-first 架构的基础假设 | 不重评 |
| `ArtifactRef` 底层对齐 `NacpRef` | `in-scope` | 已由设计文稿与 NACP reality 明确冻结 | 不重评 |
| memory backend | `in-scope` | 没有它就无法对 namespace 与 snapshot 做本地验证 | 不重评 |
| 真实 R2/KV adapter | `defer / depends-on-decision` | 语义层先于物理拓扑，v1 先做 interface seam | storage-topology action-plan 执行时 |
| prepared artifact 丰富种类 | `defer / depends-on-decision` | v1 先做 extracted-text / summary / preview 即可 | 多模态路径稳定后 |
| compact 真正摘要生成 | `out-of-scope` | 这是 compact capability / llm path 的职责，不是本包 | compact execution 开始时 |
| transcript 全量 durable schema | `out-of-scope` | 本包只定义 context/snapshot fragment，不定义最终数据库表 | storage/eval 设计启动时 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | package 骨架 | `add` | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | 建出独立 workspace package | low |
| P1-02 | Phase 1 | domain types | `add` | `src/types.ts`、`src/paths.ts`、`src/refs.ts` | 冻结 workspace/artifact/context 真相 | high |
| P1-03 | Phase 1 | context/snapshot contracts | `add` | `src/context-layers.ts`、`src/snapshot.ts` | 固定层级与恢复边界 | high |
| P2-01 | Phase 2 | mount router | `add` | `src/mounts.ts`、`src/namespace.ts` | 在仓内重写 mount 路由并统一路径路由 | high |
| P2-02 | Phase 2 | memory backend | `add` | `src/backends/memory.ts` | 提供最小可运行 backend | medium |
| P2-03 | Phase 2 | reference backend seam | `add` | `src/backends/reference.ts` | 为 durable/KV/R2 预留接口 | medium |
| P3-01 | Phase 3 | artifact registry/store | `add` | `src/artifacts.ts` | 统一 artifact metadata 与生命周期入口 | high |
| P3-02 | Phase 3 | prepared artifacts | `add` | `src/prepared-artifacts.ts` | 冻结 prepared artifact 语义 | medium |
| P3-03 | Phase 3 | result promotion seam | `add` | `src/promotion.ts` | 大结果可提升为 artifact ref | medium |
| P4-01 | Phase 4 | context assembler | `add` | `src/context-assembler.ts` | 分层上下文进入统一装配器 | high |
| P4-02 | Phase 4 | compact boundary | `add` | `src/compact-boundary.ts` | compact 输入输出边界正式化 | high |
| P4-03 | Phase 4 | redaction helper | `add` | `src/redaction.ts` | session-visible preview/redaction 统一 | medium |
| P5-01 | Phase 5 | snapshot builder | `add` | `src/snapshot.ts` | 导出最小 checkpoint fragment | high |
| P5-02 | Phase 5 | tests | `add` | `test/*.test.ts`、`test/integration/*.test.ts` | 用 fake data plane 收口 | medium |
| P5-03 | Phase 5 | 文档与导出面 | `update` | `README.md`、`src/index.ts` | 给 capability/kernel/llm 直接接入 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 包骨架与 Workspace Domain Model

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | package 骨架 | 参照现有 `packages/*` 约定建立独立 workspace package | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | 包可 `build/typecheck/test` | 基础命令校验 | 包骨架稳定 |
| P1-02 | domain types | 定义 workspace path、mount、artifact ref、prepared artifact ref 等核心类型 | `src/types.ts`、`src/paths.ts`、`src/refs.ts` | 对象真相稳定 | 类型测试 / compile-only | 不再依赖临时对象 shape |
| P1-03 | context/snapshot contracts | 冻结 context layer、compact boundary、snapshot fragment 类型 | `src/context-layers.ts`、`src/snapshot.ts` | 为 assembler 与 snapshot 提前钉死边界 | 单测 | 恢复边界不再漂移 |

### 4.2 Phase 2 — Workspace Namespace / Mount Router / Backends

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | mount router | 借鉴 `MountableFs.routePath()` 的最长前缀匹配实现 mount routing | `src/mounts.ts`、`src/namespace.ts` | 路径解析唯一出口 | router 单测 | readonly/shared/artifact 路径规则清楚 |
| P2-02 | memory backend | 提供 session-local writable backend | `src/backends/memory.ts` | fake workspace 可运行 | backend 单测 | 常见读写/list/stat 语义成立 |
| P2-03 | reference backend seam | 为 durable/KV/R2/other refs 提供统一 backend contract | `src/backends/reference.ts` | 不绑定物理落点也能表达 mount | interface 单测 | storage topology 可后接 |

### 4.3 Phase 3 — Artifact Registry / Prepared Artifact / Result Promotion

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | artifact registry/store | 定义 artifact metadata、audience、preview、prepared-state 与 registry/store 合同 | `src/artifacts.ts` | 大对象有统一入口 | artifact 单测 | 不再用裸字符串/路径传大对象 |
| P3-02 | prepared artifacts | 定义 sourceRef -> preparedRef 的最小 contract | `src/prepared-artifacts.ts` | llm-wrapper 能稳定消费 prepared artifact | prepared 单测 | extracted-text/summary/preview 三类足以支撑 v1 |
| P3-03 | result promotion seam | 把大 capability result 提升为 artifact/ref | `src/promotion.ts` | tool output 不再被迫内联 | promotion 单测 | 与 capability runtime 责任边界明确 |

### 4.4 Phase 4 — Context Assembler / Compact Boundary / Redaction

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | context assembler | 按固定层级顺序组装 system/session/workspace/artifact summary/recent transcript | `src/context-assembler.ts`、`src/context-layers.ts` | 上下文不再是隐式 message array 拼接 | assembler 单测 | layer order 与 token budgeting 明确 |
| P4-02 | compact boundary | 对齐 `context.compact.request/response` 的 history_ref/summary_ref contract | `src/compact-boundary.ts` | compact 成为正式阶段 | compact 单测 | strip / reinject 责任清楚 |
| P4-03 | redaction helper | 为 session-visible preview/export 提供 redaction 与 audience scope helper | `src/redaction.ts` | client 看见的是引用/预览而非内部全量对象 | redaction 单测 | preview / redaction 行为稳定 |

### 4.5 Phase 5 — Snapshot Builder / Fixtures / 文档 / 收口

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | snapshot builder | 只导出 workspace/context checkpoint fragment，不直接写 DO/KV/R2 | `src/snapshot.ts` | 恢复边界被显式声明 | snapshot 单测 | 与 kernel/session runtime 边界清楚 |
| P5-02 | tests | 用 fake workspace / fake artifact / compact fixture / snapshot fixture 做整体验证 | `test/*.test.ts`、`test/integration/*.test.ts` | data plane 行为可回归 | `vitest run` | 高风险路径覆盖充足 |
| P5-03 | 文档与导出面 | 更新 README、导出 namespace/artifact/context/snapshot API | `README.md`、`src/index.ts` | capability/kernel/llm 可直接接入 | 文档检查 | 用法、边界、责任划分清楚 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 包骨架与 Workspace Domain Model

- **Phase 目标**：把 workspace/context/artifact 从一堆文档概念，变成明确的对象模型与独立包接口。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - `packages/workspace-context-artifacts/package.json`
  - `packages/workspace-context-artifacts/tsconfig.json`
  - `packages/workspace-context-artifacts/src/types.ts`
  - `packages/workspace-context-artifacts/src/paths.ts`
  - `packages/workspace-context-artifacts/src/refs.ts`
  - `packages/workspace-context-artifacts/src/context-layers.ts`
  - `packages/workspace-context-artifacts/src/snapshot.ts`
- **本 Phase 修改文件**：
  - `packages/workspace-context-artifacts/README.md`
  - `packages/workspace-context-artifacts/src/index.ts`
- **具体功能预期**：
  1. `ArtifactRef` 与 `PreparedArtifactRef` 明确是对 `NacpRef` 的语义包装，而不是新 wire format。
  2. context layers 至少显式覆盖 system、session、workspace summary、artifact summary、recent transcript。
  3. snapshot 类型只表达最小 fragment，不携带物理 backend API 或数据库 schema。
- **具体测试安排**：
  - **单测**：类型 guard、ref wrapper、layer order enums
  - **集成测试**：无
  - **回归测试**：compile-only contract tests
  - **手动验证**：逐项对照 `workspace-context-artifacts-by-GPT.md` 的 F1-F6
- **收口标准**：
  - domain model 不再依赖临时 ad-hoc shapes
  - `NacpRef` 对齐关系被写清楚且可测试
  - 后续 Phase 无需重写核心 public types
- **本 Phase 风险提醒**：
  - 若 `ArtifactRef` 自己另起 wire schema，后面会与 NACP 全面分裂
  - 若 snapshot 类型过细，会提前绑死 storage topology

### 5.2 Phase 2 — Workspace Namespace / Mount Router / Backends

- **Phase 目标**：提供 Worker-first 的统一命名空间，让 capability runtime 与 fake bash 真正有“工作区”可用。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `packages/workspace-context-artifacts/src/mounts.ts`
  - `packages/workspace-context-artifacts/src/namespace.ts`
  - `packages/workspace-context-artifacts/src/backends/memory.ts`
  - `packages/workspace-context-artifacts/src/backends/reference.ts`
- **具体功能预期**：
  1. namespace route 规则直接吸收 `just-bash` `MountableFs.routePath()` 的最长前缀匹配心智，但在 nano-agent 仓内重写实现，不直接引用其运行时代码。
  2. memory backend 能支撑 session-local writable workspace。
  3. reference backend seam 允许后续将路径映射到 durable/KV/R2 refs，而不改变上层 namespace 语义。
- **具体测试安排**：
  - **单测**：mount route、readonly/writeable、child mount visibility
  - **集成测试**：fake namespace + memory backend
  - **回归测试**：冲突 mount、artifact pseudo-path、invalid path normalization
  - **手动验证**：对照 `context/just-bash/src/fs/mountable-fs/mountable-fs.ts` 做语义差分检查
- **收口标准**：
  - 所有路径访问都有统一 route 出口
  - session-local 与 shared/artifact mount 的语义清楚
  - backend 接口不泄漏具体存储实现细节
- **本 Phase 风险提醒**：
  - 若 namespace 规则与 fake bash / capability runtime 理解不一致，后续所有文件能力都会漂移
  - 若 path normalization 不严格，安全与多租户边界会被削弱

### 5.3 Phase 3 — Artifact Registry / Prepared Artifact / Result Promotion

- **Phase 目标**：让大对象、附件与工具大输出变成可引用、可预处理、可重用的系统对象。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - `packages/workspace-context-artifacts/src/artifacts.ts`
  - `packages/workspace-context-artifacts/src/prepared-artifacts.ts`
  - `packages/workspace-context-artifacts/src/promotion.ts`
- **具体功能预期**：
  1. artifact registry/store 统一管理 metadata、preview、audience scope、prepared-state。
  2. prepared artifact contract 至少能表达 extracted-text、summary、preview 三类输出。
  3. promotion seam 允许 capability runtime 将大结果提升为 artifact ref，而不是强迫 transcript inline。
- **具体测试安排**：
  - **单测**：artifact metadata、prepared variants、promotion policy
  - **集成测试**：fake capability result -> artifact ref -> preview
  - **回归测试**：prepared failure、oversized output、repeat promotion idempotency
  - **手动验证**：对照 `claude-code/utils/toolResultStorage.ts` 与 `attachments.ts`
- **收口标准**：
  - 大对象能通过 ref 在系统内流通
  - prepared artifact 已足够支撑 llm-wrapper v1
  - promotion 责任边界与 capability runtime/llm-wrapper 保持清楚
- **本 Phase 风险提醒**：
  - 若 artifact kinds 一次做得过细，v1 推进会被拖慢
  - 若 preview/redaction 没有先建模，session-visible data 会混乱

### 5.4 Phase 4 — Context Assembler / Compact Boundary / Redaction

- **Phase 目标**：让“进入模型的上下文”与“compact 前后边界”变成正式、可回放的系统阶段。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - `packages/workspace-context-artifacts/src/context-assembler.ts`
  - `packages/workspace-context-artifacts/src/compact-boundary.ts`
  - `packages/workspace-context-artifacts/src/redaction.ts`
- **本 Phase 修改文件**：
  - `packages/workspace-context-artifacts/src/context-layers.ts`
- **具体功能预期**：
  1. assembler 以固定层级顺序装配 context，而不是隐式拼接 message arrays。
  2. compact boundary 明确对齐 `context.compact.request.history_ref` 与 `context.compact.response.summary_ref`。
  3. redaction helper 明确 client-visible preview 与 internal object 的边界，并保证后续 WebSocket-first 与 HTTP fallback 两条会话返回路径可以复用同一 preview/redaction 结果。
- **具体测试安排**：
  - **单测**：layer ordering、budget trimming、compact strip/reinject、preview redaction
  - **集成测试**：artifact summary + compact reinjection flow
  - **回归测试**：图片/文档被 strip、tool results 转 ref、空层处理
  - **手动验证**：对照 `claude-code/services/compact/compact.ts`
- **收口标准**：
  - 上下文装配成为显式 API，而不是散落逻辑
  - compact 边界与 reinjection 规则可观测、可回放
  - session-visible 输出不再泄漏内部全量对象
- **本 Phase 风险提醒**：
  - 若 compact boundary 含糊，replay/restore 与 eval 会全部失真
  - 若 layer order 不稳定，模型行为会出现难追踪漂移

### 5.5 Phase 5 — Snapshot Builder / Fixtures / 文档 / 收口

- **Phase 目标**：把 workspace/context 层的恢复边界正式钉死，并证明它能与 kernel/session runtime 对接。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
  - `P5-03`
- **本 Phase 新增文件**：
  - `packages/workspace-context-artifacts/test/namespace.test.ts`
  - `packages/workspace-context-artifacts/test/mounts.test.ts`
  - `packages/workspace-context-artifacts/test/refs.test.ts`
  - `packages/workspace-context-artifacts/test/artifacts.test.ts`
  - `packages/workspace-context-artifacts/test/prepared-artifacts.test.ts`
  - `packages/workspace-context-artifacts/test/promotion.test.ts`
  - `packages/workspace-context-artifacts/test/context-assembler.test.ts`
  - `packages/workspace-context-artifacts/test/compact-boundary.test.ts`
  - `packages/workspace-context-artifacts/test/snapshot.test.ts`
  - `packages/workspace-context-artifacts/test/integration/fake-workspace-flow.test.ts`
  - `packages/workspace-context-artifacts/test/integration/compact-reinject.test.ts`
  - `packages/workspace-context-artifacts/test/integration/snapshot-restore-fragment.test.ts`
- **本 Phase 修改文件**：
  - `packages/workspace-context-artifacts/README.md`
  - `packages/workspace-context-artifacts/src/index.ts`
- **具体功能预期**：
  1. snapshot builder 只导出 workspace/context fragment，不直接负责写 DO/KV/R2；后续 session runtime 可将其同时用于 WebSocket replay 恢复与 HTTP fallback 返回持久化。
  2. fake data plane 场景至少覆盖：workspace 读写、artifact promotion、compact boundary、snapshot fragment。
  3. README 清楚说明 mount truth、artifact-first path、prepared artifact 与 snapshot seam 的边界。
- **具体测试安排**：
  - **单测**：namespace/artifact/context/snapshot 各自独立
  - **集成测试**：fake workspace flow、compact reinject、snapshot fragment
  - **回归测试**：ephemeral progress 不入 snapshot、readonly mount 不可写、redaction 生效
  - **手动验证**：最小 `mount -> write -> promote -> assemble -> snapshot` 示例
- **收口标准**：
  - workspace/context package 足以支撑 capability runtime、llm-wrapper、kernel 三者接线
  - snapshot fragment 边界与 session runtime 责任不冲突
  - 文档把“不做物理 storage topology”写清楚
- **本 Phase 风险提醒**：
  - 若 integration tests 不覆盖 compact + snapshot 联动，后续 session restore 一定返工
  - 若 README 省略 redaction / preview 语义，下游很容易重新把大对象内联

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 2 / Phase 3 / Phase 5`
- **为什么必须确认**：这是整个数据平面的根假设，直接决定 namespace、artifact、snapshot 的实现方向。
- **当前建议 / 倾向**：`正式确认 v1 以 mount-based workspace truth + artifact-first large object path 为基础`
- **Q**：`v1 是否正式冻结“mount-based workspace truth + artifact-first large object path”这两个前提？`
- **A**：同意建议

#### Q2

- **影响范围**：`Phase 3 / Phase 4`
- **为什么必须确认**：prepared artifact 的最小种类会直接影响 llm-wrapper 的附件进入路径与 promotion 策略。
- **当前建议 / 倾向**：`v1 只保证 extracted-text / summary / preview 三类 prepared artifact`
- **Q**：`v1 是否确认 prepared artifact 先只做 extracted-text、summary、preview 三类，而不同时引入更复杂的多媒体衍生物？`
- **A**：同意建议

#### Q3

- **影响范围**：`Phase 4 / Phase 5`
- **为什么必须确认**：它决定 snapshot fragment 到底只含 workspace/context 元数据，还是也要包含更重的 transcript/export 对象。
- **当前建议 / 倾向**：`workspace package 只输出 workspace/context fragment；durable transcript 与 websocket replay 仍由 session runtime 负责`
- **Q**：`v1 是否确认 workspace package 只负责 workspace/context fragment，不负责 durable transcript 与 websocket replay state？`
- **A**：同意建议

### 6.2 问题整理建议

- **Q1** 是整个包的第一原则。
- **Q2** 需要与 llm-wrapper 同步拍板，避免附件路径重复设计。
- **Q3** 需要与 kernel/session runtime 一起定稿，避免 snapshot 责任边界重叠。

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| `NacpRef` contract | artifact ref 不能另造一套 wire truth | high | 直接以 `packages/nacp-core/src/envelope.ts` 为 source of truth |
| `context.compact.*` contract | compact 边界必须对齐现有 Core schema | high | Phase 4 直接对齐 `messages/context.ts` |
| storage topology 未冻结 | 容易把语义层过早绑到 DO/KV/R2 | high | 只做 seam，不写最终 placement |
| capability runtime / llm-wrapper 强依赖本包 | 一旦对象模型飘移，下游全返工 | high | 先冻结 domain model，再逐层实现 |
| just-bash 依赖渗入产物 | mount/router 若直接依赖外部实现会削弱可控性 | high | 只吸收语义与测试基线，在仓内重写实现 |

### 7.2 约束与前提

- **技术前提**：Cloudflare Workers / Durable Objects / memory-first workspace / no host filesystem truth
- **运行时前提**：artifact-first large object path、prepared artifact 进入模型、compact boundary 明确、snapshot 由 session runtime 决定何时 flush；session runtime 后续会同时支持 WebSocket-first 与 HTTP fallback，两条路径都应复用本包的对象模型与 preview/redaction 结果
- **组织协作前提**：`packages/*` 为独立 repo；workspace package 需要同时服务 capability runtime、llm-wrapper、kernel；最终 deployable Worker / DO 组装层在后续运行时包中完成
- **上线 / 合并前提**：不得把最终 storage topology 偷偷写死到语义层；不得引入宿主路径直通假设；不得把 `context/just-bash` 直接作为 runtime dependency 打进产物

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/workspace-context-artifacts-by-GPT.md`
  - `docs/design/capability-runtime-by-GPT.md`
  - `docs/design/llm-wrapper-by-GPT.md`
  - `docs/design/agent-runtime-kernel-by-GPT.md`
- 需要同步更新的说明文档 / README：
  - `packages/workspace-context-artifacts/README.md`
  - 根目录 `README.md`（如 mount truth / artifact path / package naming 需要回填）
- 需要同步更新的测试说明：
  - `docs/plan-after-nacp.md` 中的 fake workspace / snapshot / compact harness 说明

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `pnpm --filter @nano-agent/workspace-context-artifacts build`
  - `pnpm --filter @nano-agent/workspace-context-artifacts typecheck`
- **单元测试**：
  - namespace / mount routing / refs / artifacts / prepared artifacts / context assembler / compact boundary / snapshot
- **集成测试**：
  - fake workspace flow
  - compact strip -> summary ref -> reinjection
  - snapshot fragment build / restore handoff
- **端到端 / 手动验证**：
  - 手动构造一次 `write -> promote large result -> assemble context -> snapshot fragment`
  - 手动构造一次 `history_ref -> compact summary_ref -> reinject`
- **回归测试**：
  - readonly mount 写入失败、artifact ref preview redaction、生效中的 ephemeral progress 不入 snapshot
- **文档校验**：
  - README 中明确说明 mount model、artifact-first path、prepared artifact 范围与 snapshot 边界

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `@nano-agent/workspace-context-artifacts` 能以独立包形式 build、typecheck、test
2. workspace namespace、artifact refs、prepared artifacts、context layers、compact boundary 已成为统一对象模型
3. `ArtifactRef` / `PreparedArtifactRef` 与 `NacpRef` 的关系被明确且稳定实现
4. 大结果 promotion、context assembly、compact reinjection、snapshot fragment 已形成清晰责任边界
5. capability runtime、llm-wrapper、kernel 可以在不自造对象模型的前提下直接接入本包

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | workspace package 已具备 namespace、mount router、artifact model、prepared artifact、context assembler、compact boundary、snapshot builder |
| 测试 | mount/artifact/context/snapshot 与 fake data plane integration 均可稳定回归 |
| 文档 | README、公开导出面、边界与 Q/A 同步完成 |
| 风险收敛 | v1 不再依赖宿主真实文件系统心智，也不再把大对象与 transcript 混为一谈 |
| 可交付性 | capability runtime、llm-wrapper、kernel、future session runtime 可直接复用统一数据模型 |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

> 这份 action-plan 以 **冻结 nano-agent 的数据承载层与上下文装配层** 为第一优先级，采用 **先语义边界、后 namespace/backends、再 artifact/prepared/context、最后 snapshot 收口** 的推进方式，优先解决 **virtual workspace truth、artifact-first 大对象路径、context layering 与 compact/snapshot 边界**，并把 **不抢跑最终 storage topology、不恢复宿主文件系统幻觉、最小 prepared artifact 范围优先** 作为主要约束。整个计划完成后，`Workspace / Context / Artifacts` 应达到 **能为 capability runtime、llm-wrapper、kernel 提供统一数据真相** 的程度，从而为后续的 session-do-runtime、storage-topology、eval-observability 与高级验证工作提供稳定基础。
