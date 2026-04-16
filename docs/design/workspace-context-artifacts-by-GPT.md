# Nano-Agent Workspace / Context / Artifacts 功能簇设计

> 功能簇: `Workspace / Context / Artifacts`
> 讨论日期: `2026-04-16`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/eval/vpa-fake-bash-by-GPT.md`
> - `docs/design/llm-wrapper-by-GPT.md`
> - `docs/design/hooks-by-GPT.md`
> - `docs/action-plan/nacp-core.md`
> - `docs/action-plan/nacp-session.md`
> - `docs/plan-after-nacp.md`
> - `README.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

### 0.1 为什么现在必须冻结 Workspace / Context / Artifacts

nano-agent 的宿主世界里没有真实本地文件系统，也不应该把“文件 / 上下文 / 大附件 / 工具结果”全都当作一类东西处理。

如果不先冻结这一层，后面一定会出现这些问题：

1. fake bash 不知道自己在读什么“文件”
2. llm-wrapper 不知道附件何时 inline、何时变成 artifact ref
3. compact 不知道该裁什么、保什么、重注入什么
4. DO / KV / R2 不知道哪些数据分别属于热状态、共享配置和大对象

### 0.2 本次讨论的前置共识

- nano-agent 的文件系统模型是 **virtual FS / mount-based workspace / memory-first + durable-backed persistence**。
- fake bash 和 capability runtime 都建立在这个 workspace namespace 之上，而不是直接接真实宿主 FS。
- llm-wrapper 已明确：大附件默认不走 inline binary，而走 **artifact staging / prepared artifact**。
- `NACP-Session` 负责客户端事件流，不负责 workspace/object 本身的存储。
- storage topology 还未最终冻结，因此本设计先定义 **语义层与对象边界**，不直接落数据库或物理 schema。

### 0.3 显式排除的讨论范围

- 不讨论完整 DDL / registry schema
- 不讨论完整 compaction 算法，只讨论 compact 输入/输出边界
- 不讨论完整 Git / indexer / search database
- 不讨论真实 Cloudflare R2/KV API 封装细节
- 不讨论浏览器视觉能力本体

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Workspace / Context / Artifacts`
- **一句话定义**：这是 nano-agent 的**数据承载层与上下文装配层**，负责定义 workspace namespace、mount、artifact refs、context layers、compact boundaries 与 snapshot seam。
- **边界描述**：
  - **包含**：virtual FS contract、mount model、artifact refs、prepared artifact、context assembler、compact boundary、workspace snapshot seam
  - **不包含**：具体 tool 执行、具体 LLM provider 调用、具体 registry/DDL、完整 git 工作流

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|------|------|------|
| **Workspace** | 一个 session 看到的统一虚拟命名空间 | 不是宿主真实目录 |
| **Mount** | 将某种 backend 映射到 workspace 某个路径前缀 | 如 `/workspace`、`/memories`、`/artifacts` |
| **ArtifactRef** | 对大对象/附件/导出物的稳定引用 | 可以指向 R2、KV 导出的摘要、DO local object |
| **Prepared Artifact** | 已完成预处理、适合被 LLM 或 tool 消费的 artifact | 如 OCR 文本、缩略图、摘要 |
| **Context Layer** | 会进入模型或 runtime 的上下文层级 | 如 system、session、workspace、artifact summary、recent transcript |
| **Compact Boundary** | context 被压缩/替换的明确边界 | 不能只是“随手删旧消息” |
| **Workspace Snapshot** | 某一时刻 workspace 的可恢复描述 | 不是数据库表转储 |
| **Redaction Scope** | 数据进入 client-visible stream 前需要遵守的脱敏边界 | 与 `NACP-Session` 对齐 |

### 1.3 参考调查报告

- `context/just-bash/src/fs/interface.ts` — 抽象 FS 接口（`110-220`）
- `context/just-bash/src/fs/mountable-fs/mountable-fs.ts` — mount-based unified namespace（`50-240`）
- `context/just-bash/src/fs/overlay-fs/overlay-fs.ts` — copy-on-write / read-only overlay（`1-240`）
- `context/codex/codex-rs/exec-server/src/sandboxed_file_system.rs` — sandbox-aware filesystem routing（`28-240`）
- `context/codex/codex-rs/core/src/state/session.rs` — session-scoped history / token/rate state（`19-155`）
- `context/claude-code/utils/attachments.ts` — attachment / image / file / message injection 处理（`1-260`）
- `context/claude-code/services/compact/compact.ts` — compact 输入裁剪与 reinjection（`122-145`, `202-240`）
- `context/claude-code/utils/sessionStorage.ts` — transcript / tool progress / session-local storage boundary（`128-205`）
- `context/claude-code/utils/toolResultStorage.ts` — 大工具结果持久化为文件并以引用回填（`26-199`）
- `context/mini-agent/mini_agent/tools/file_tools.py` — 直接路径读写与 token truncation（`63-260`）

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**：数据承载层 + 上下文装配层
- **服务对象**：
  1. capability runtime
  2. llm-wrapper
  3. agent runtime kernel
  4. compact pipeline
  5. observability / export
- **它依赖于**：
  - storage topology 的最终物理落点
  - capability runtime 的读写动作
  - llm-wrapper 的 attachment planner
  - session DO runtime 的 checkpoint 行为
- **它被谁依赖**：
  - fake bash / capability runtime
  - llm-wrapper
  - hooks
  - session DO runtime
  - eval / replay harness

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `Capability Runtime` | 双向 | 强 | 几乎所有 capability 都在读写 workspace / artifacts |
| `LLM Wrapper` | 双向 | 强 | context layers 与 prepared artifact 直接进入 canonical request |
| `Agent Runtime Kernel` | 双向 | 强 | kernel 决定何时 compact、何时 snapshot、何时装配 context |
| `Hooks` | 双向 | 中 | hooks 可以观测或干预上下文/compact 行为 |
| `NACP-Session` | Workspace -> Session | 中 | client 只看到摘要/引用/事件，不直接看到全部 workspace 真相 |
| `Storage Topology` | 双向 | 强 | 本层定义语义边界，storage topology 决定物理落点 |
| `Eval / Observability` | Workspace -> Eval | 强 | 需要知道某个输出来自哪个 artifact / snapshot / context layer |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Workspace / Context / Artifacts` 是 **workspace 命名空间与上下文装配层**，负责 **把文件、附件、工具结果、compact 边界和 prepared artifacts 统一建模**，对上游提供 **稳定的读写/引用/装配语义**，对下游要求 **mount-based namespace、artifact-first large object path、明确的 compact 与 snapshot 边界**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 真实宿主 FS 作为真相 | mini-agent / 本地 CLI | 与 Worker/V8 isolate 宿主冲突 | 否 |
| 完整 Git 仓库语义 | 本地 agent CLI | v1 只需要 virtual git subset / snapshot seam | 可能 |
| 任意大文件直接 inline 进模型上下文 | 本地附件直觉 | 与 128MB isolate 和 request limits 冲突 | 否 |
| 全量 session transcript 直接当上下文真相 | claude-code 本地 transcript 模型 | 云端 runtime 更需要分层 context | 否 |
| overlay 到真实本地目录 | just-bash OverlayFs | Node-hosted 参考很好，但不是 Worker 真相 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| Mount Backend | `memory | durable | kv-ref | r2-ref` | v1 先定义 contract | 更多 backend types |
| Artifact Kind | `text | image | document | transcript-export | tool-output` | v1 覆盖最小集合 | 更细粒度 media taxonomy |
| Prepared Artifact | `sourceRef -> preparedRef[]` | v1 重点支持 LLM 输入前预处理 | OCR / embedding / structured extract |
| Snapshot Strategy | `checkpoint | export-bundle` | v1 只做最小 checkpoint seam | richer diff/export formats |
| Context Layer Order | config / builder API | v1 冻结固定顺序 | policy-driven layer selection |

### 3.3 完全解耦点（哪里必须独立）

- **Workspace Namespace 与 Artifact Store**
  - **解耦原因**：不是所有 artifact 都应该“像文件一样”挂进 workspace。
  - **依赖边界**：workspace 更适合当前工作区视图；artifact store 更适合大对象与衍生物。

- **Context Assembler 与 Compactor**
  - **解耦原因**：装配上下文和压缩上下文不是同一个算法问题。
  - **依赖边界**：assembler 负责层级组合；compactor 负责替换和边界提交。

- **Mount Router 与 Physical Storage**
  - **解耦原因**：现在要先冻结语义边界，而不是绑定 KV / R2 / DO storage API。
  - **依赖边界**：router 只理解 mount semantics；storage adapters 负责落地。

- **Session-visible References 与 Internal Data**
  - **解耦原因**：client 能看到的是引用、摘要、redacted preview，不应该天然看到内部全量对象。
  - **依赖边界**：所有向 session stream 公开的数据都必须经过 adapter / redaction。

### 3.4 聚合点（哪里要刻意收敛）

- **所有 mounts 都进 `WorkspaceNamespace`**
- **所有 artifact refs 都进 `ArtifactRegistry` / `ArtifactStore`**
- **所有 context 层都进 `ContextAssembler`**
- **所有 compact boundary 提交都进 `CompactBoundaryManager`**
- **所有 snapshot 构建都进 `WorkspaceSnapshotBuilder`**

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：`file_tools.py` 直接基于 `Path` 解析路径并读写本地文件，外加 token 截断（`63-260`）。
- **亮点**：
  - 工具行为直观
  - 大文件读取的 token 截断意识存在
- **值得借鉴**：
  - 读文件结果的 token-aware 裁剪值得保留
  - read/write/edit 的调用形态清楚
- **不打算照抄的地方**：
  - 把宿主文件系统当作工作区真相
  - 路径解析直接绑定当前机器目录

### 4.2 codex 的做法

- **实现概要**：通过 `SandboxedFileSystem` 把文件操作代理到 sandbox context（`sandboxed_file_system.rs:28-240`）；`SessionState` 又把 history、token/rate 信息作为 session-scoped state 单独管理（`state/session.rs:19-155`）。
- **亮点**：
  - 文件访问和 session state 分得很清楚
  - sandbox context 是显式输入，不是假设性全局
- **值得借鉴**：
  - workspace 访问必须带上下文，而不是隐式地“当前目录可用”
  - session-scoped history/context 需要独立建模
- **不打算照抄的地方**：
  - 本地 sandbox / local filesystem 前提
  - 将 FS 访问强绑定到本地执行环境

### 4.3 claude-code 的做法

- **实现概要**：
  - `attachments.ts` 把文件、图片、计划、tasks 等变成统一 attachment 输入（`1-260`）
  - `compact.ts` 会在 compact 前 strip 掉 images/documents，并在 compact 后做 reinjection（`122-145`, `202-240`）
  - `sessionStorage.ts` 明确 progress 不是 transcript participant，session transcript 与 ephemeral progress 要分开（`128-205`）
  - `toolResultStorage.ts` 会把大工具结果持久化为文件，并用引用消息替代全量内联（`26-199`）
- **亮点**：
  - attachment / compact / transcript / large tool results 四层现实问题处理得很成熟
  - 明确区分 durable transcript 与 ephemeral progress
- **值得借鉴**：
  - prepared artifact 与 attachment 是必要层，而不是“直接塞文件内容”
  - compact 输入必须主动裁剪，而不是被动等超限
  - 大结果应通过 artifact/ref 回填，而不是强行留在上下文
- **不打算照抄的地方**：
  - 本地 session transcript / project dir 持久化方式
  - Node/local FS 导向的数据组织

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| 文件系统真相 | 本地 FS | 本地 sandbox FS | 本地 project/session files | virtual FS + mount |
| 附件/大对象建模 | 弱 | 中 | 强 | 强 |
| compact 边界意识 | 弱 | 中 | 强 | 强 |
| transcript / progress 分离 | 弱 | 中 | 强 | 强 |
| 对 Worker 宿主适配度 | 低 | 低 | 低 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] Virtual Workspace Namespace**
  - 定义 mount-based workspace 命名空间，而不是直接访问宿主真实目录。

- **[S2] Mount Model**
  - 至少区分 session-local writable workspace、shared readonly context mounts、artifact refs。

- **[S3] ArtifactRef / Prepared Artifact Model**
  - 大工具结果、图片、文档、导出物都要通过 artifact ref 进入系统。

- **[S4] Context Layering**
  - system、session、workspace、artifact summary、recent transcript 等层级必须被显式建模。

- **[S5] Compact Boundary**
  - 必须有“compact 前的输入裁剪”和“compact 后的重注入”边界。

- **[S6] Snapshot / Checkpoint Seam**
  - 允许 session DO 在 hibernation / restore 时只保存最小必要 workspace/context state。

- **[S7] Result-to-Artifact Promotion**
  - 大 capability result 要能被提升为 artifact ref，而不是永远内联。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] 完整 Git 仓库语义**
- **[O2] 完整搜索索引 / semantic index**
- **[O3] 完整 binary diff / patch storage**
- **[O4] 全量多媒体处理 pipeline**
- **[O5] registry / analytics 数据库 schema**
- **[O6] 多用户协作 workspace**

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| 小文本文件直接读入上下文 | in-scope | 这是最常见工作流，且可以 controlled |
| 图片 / PDF 原样 inline | out-of-scope | v1 更适合走 artifact ref / prepared artifact |
| 大工具结果进入 transcript | out-of-scope | 应提升为 artifact ref 或 preview + ref |
| compact boundary message | in-scope | compact 必须有明确边界，便于 replay / restore |
| session transcript 全量持久化格式 | defer | 先冻结语义层，不抢跑物理实现 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **mount-based virtual workspace** 而不是 **本地路径直通**
   - **为什么**：这是 Worker/V8 isolate 宿主下唯一稳定且可治理的工作区语义。
   - **我们接受的代价**：需要多一层 namespace / mount router 抽象。
   - **未来重评条件**：只有未来某个执行 target 明确提供稳定的本地式持久卷，才考虑更像“真实目录”的语义。

2. **取舍 2**：我们选择 **artifact ref / prepared artifact** 而不是 **大对象直接内联**
   - **为什么**：大对象、图片、工具大输出都不适合在 isolate 和记忆窗口里直接搬运。
   - **我们接受的代价**：需要 artifact lifecycle / preview / redaction 设计。
   - **未来重评条件**：如果某类对象被证明总是足够小且高频，可局部允许 inline。

3. **取舍 3**：我们选择 **context layering + compact boundary** 而不是 **单 transcript 一把梭**
   - **为什么**：nano-agent 的长期价值就是上下文管理，而不是把 transcript 当唯一真相。
   - **我们接受的代价**：context assembler 与 compact seam 需要额外模块。
   - **未来重评条件**：只有某些层级被证明无价值，才允许简化。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| workspace 设计过虚 | 没有最小真实 working set | fake bash / capability runtime 无法落地 | 一开始就定义 session-local writable mount |
| artifact 模型过早复杂化 | 想一次覆盖所有媒体类型 | 实现推进变慢 | v1 只冻结通用 ArtifactRef + PreparedArtifact seam |
| compact 边界不清 | 压缩前后语义含糊 | replay / restore / session consistency 出问题 | CompactBoundaryManager 单独建模 |
| storage topology 绑太早 | 先写 KV/R2/DDL | 返工大 | 本设计只定义语义边界，不定义最终物理 schema |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：后续设计 capability runtime、llm-wrapper、storage topology 时都有统一的数据模型。
- **对 nano-agent 的长期演进**：为大附件、多模态、compact、long session 恢复提供基础设施。
- **对"上下文管理 / Skill / 稳定性"三大深耕方向的杠杆作用**：
  - 上下文管理：这是核心地基
  - Skill：skills 最终会读取 workspace / artifacts / prepared context
  - 稳定性：snapshot / compact / replay 都依赖这一层

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Workspace Namespace | 统一 workspace 命名空间 | ✅ **所有读写都能落到 mount-based namespace，而非宿主路径直通** |
| F2 | ArtifactRef Model | 大对象/附件统一引用模型 | ✅ **大对象可以被引用、预览、重用，而不是只能内联** |
| F3 | Prepared Artifact Pipeline | LLM/tool 可消费的衍生物 | ✅ **多模态与大对象进入模型前有统一预处理入口** |
| F4 | Context Assembler | 分层上下文装配 | ✅ **进入 kernel/llm 的上下文层级可枚举、可裁剪、可重注入** |
| F5 | Compact Boundary Manager | compact 输入/输出边界 | ✅ **compact 变成正式生命周期，而不是紧急补丁** |
| F6 | Snapshot Builder | workspace/context checkpoint seam | ✅ **session 恢复所需的最小状态可以稳定导出与恢复** |

### 7.2 详细阐述

#### F1: `WorkspaceNamespace`

- **输入**：mount config、session context、workspace operations
- **输出**：统一的路径解析 / 读写 / list / stat 语义
- **主要调用者**：capability runtime、kernel、hooks
- **核心逻辑**：所有路径访问先经 mount router，再落 storage adapter
- **边界情况**：readonly mounts、shared mounts、artifact pseudo-paths
- **一句话收口目标**：✅ **workspace 路径不再依赖宿主目录真相。**

#### F2: `ArtifactRef`

- **输入**：tool result、uploaded file、generated image、compact archive
- **输出**：stable ref + metadata + preview/redaction info
- **主要调用者**：llm-wrapper、session stream adapter、tool result promotion
- **核心逻辑**：大对象与衍生物统一通过 ref 流通
- **边界情况**：artifact 已准备/未准备、preview size、audience scope
- **一句话收口目标**：✅ **大对象可以在系统内被一等公民式引用。**

#### F3: `PreparedArtifact`

- **输入**：source artifact
- **输出**：OCR 文本、摘要、缩略图、structured extract 等
- **主要调用者**：llm-wrapper、future browser/runtime services
- **核心逻辑**：为模型和工具提供安全、轻量、适配后的输入
- **边界情况**：预处理失败、同源 artifact 多种 prepared outputs
- **一句话收口目标**：✅ **图片/文档进入模型前有统一 staging/preparation 语义。**

#### F4: `ContextAssembler`

- **输入**：session history、workspace state、artifact summaries、memory/plan/task refs
- **输出**：分层上下文视图
- **主要调用者**：kernel、llm-wrapper、compact pipeline
- **核心逻辑**：固定层级顺序，显式 token budgeting
- **边界情况**：某层过大、某层为空、某层需要 lazy inject
- **一句话收口目标**：✅ **上下文不再是“message array + 拼接附件”这种隐式过程。**

#### F5: `CompactBoundaryManager`

- **输入**：compact trigger、当前上下文层
- **输出**：compact input、boundary record、post-compact reinjection set
- **主要调用者**：kernel、llm-wrapper、observability
- **核心逻辑**：compact 前 strip / compact 后 rehydrate
- **边界情况**：附件剥离、tool results 转 ref、skill/memory 重注入
- **一句话收口目标**：✅ **compact 成为可回放、可观测、可验证的正式阶段。**

#### F6: `WorkspaceSnapshotBuilder`

- **输入**：workspace namespace、artifact refs、context summary、runtime metadata
- **输出**：checkpoint/export bundle
- **主要调用者**：session DO runtime、eval harness
- **核心逻辑**：定义最小可恢复面
- **边界情况**：in-flight writes、ephemeral progress、不该持久化的临时对象
- **一句话收口目标**：✅ **workspace/context 的恢复边界被显式声明。**

### 7.3 非功能性要求

- **性能目标**：常见小文件读写与 context assembly 不应要求全量对象扫描
- **可观测性要求**：artifact promotion、compact boundary、snapshot build 都必须有事件记录
- **稳定性要求**：readonly/shared mounts 的语义必须明确且可测试
- **测试覆盖要求**：mount routing、artifact refs、context assembly、compact boundary、snapshot 各有独立测试

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/tools/file_tools.py:63-150` | read file + token truncation | 读文件结果要 token-aware | 借鉴读取体验，不借宿主真相 |
| `context/mini-agent/mini_agent/tools/file_tools.py:155-260` | write/edit 直接路径操作 | 简单输入输出 shape | 反向提醒不要直接绑本地路径 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/exec-server/src/sandboxed_file_system.rs:28-240` | sandbox-aware FS routing | 文件访问要带 sandbox/context，而不是裸路径 | 强烈借鉴 |
| `context/codex/codex-rs/core/src/state/session.rs:19-155` | session history / token/rate state | history/context 要单独建模 | 借鉴 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/utils/attachments.ts:1-140` | attachment 注入总线 | attachment 不是“文件内容字符串” | 强烈借鉴 |
| `context/claude-code/services/compact/compact.ts:122-145` | compact 前 strip images/documents | compact 输入裁剪必须正式建模 | 强烈借鉴 |
| `context/claude-code/services/compact/compact.ts:202-240` | compact retry/trim 思路 | compact 不应只是简单删历史 | 借鉴思路 |
| `context/claude-code/utils/sessionStorage.ts:128-205` | transcript 与 progress 分离 | durable transcript 与 ephemeral progress 必须分开 | 强烈借鉴 |
| `context/claude-code/utils/toolResultStorage.ts:26-199` | 大工具结果变文件引用 | tool output promotion -> artifact ref | 强烈借鉴 |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `context/mini-agent/mini_agent/tools/file_tools.py:108-206` | 直接读写本地绝对/相对路径 | nano-agent 不以宿主文件系统为真相 |
| `context/just-bash/src/fs/overlay-fs/overlay-fs.ts:1-240` | 真实 Node FS overlay 是很好的参考，但宿主假设错误 | 我们借 mount/overlay 思想，不借 Node 实现路径 |
| `context/claude-code/utils/sessionStorage.ts:198-205` | transcript path 直接绑本地 project dir | nano-agent 应以 session actor + storage adapters 为中心 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

Workspace / Context / Artifacts 在 nano-agent 中会以一个**mount-based namespace + artifact-first large object model + layered context assembler** 的组合存在。它与 capability runtime、llm-wrapper、compact、session restore 都是强耦合，但这些耦合都是正向的：这是把 Cloudflare-native 宿主变成“LLM 能工作”的核心数据底座。复杂度为 **高**，但这部分复杂度是项目价值本身，不是实现噪音。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 这是“云原生 agent runtime”与“本地 CLI”最本质的分水岭之一 |
| 第一版实现的性价比 | 4 | 设计先行非常值，但实现要克制，不宜一口吃成胖子 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 5 | 这三条几乎都直接压在这一层上 |
| 对开发者自己的日用友好度 | 4 | 一开始会更抽象，但后续所有能力都会更统一 |
| 风险可控程度 | 4 | 主要风险是抽象过早；通过最小工作区与最小 artifact model 可控 |
| **综合价值** | **5** | 这是 nano-agent 真正脱离“本地文件系统心智”的关键设计层 |

### 9.3 下一步行动

- [ ] **决策确认**：业主确认 v1 是否接受“artifact-first large object path”和“mount-based workspace truth”
- [ ] **关联 Issue / PR**：创建 `docs/action-plan/workspace-context-artifacts.md`
- [ ] **待深入调查的子问题**：
  - snapshot/export bundle 的最小字段集
  - prepared artifact 的最小种类和生成责任方
- [ ] **需要更新的其他设计文档**：
  - `docs/design/session-do-runtime-by-GPT.md`
  - `docs/design/storage-topology-by-GPT.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-16` | `GPT-5.4` | 初稿 |
