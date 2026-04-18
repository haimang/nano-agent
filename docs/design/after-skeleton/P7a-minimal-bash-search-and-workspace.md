# Nano-Agent Minimal Bash Search and Workspace 功能簇设计

> 功能簇: `Minimal Bash Search and Workspace`
> 讨论日期: `2026-04-17`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`
> - `docs/design/after-skeleton/P4-external-seam-closure.md`
> - `docs/design/after-nacp/capability-runtime-by-GPT.md`
> - `docs/design/after-nacp/workspace-context-artifacts-by-GPT.md`
> - `docs/eval/vpa-fake-bash-by-GPT.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

到 Phase 6 为止，nano-agent 已经把 contract、trace、session edge、external seam、storage/context evidence 的主骨架铺好了，但 fake bash 最容易被 LLM 高频触发的第一层能力面，其实还没有被正式冻结：

- `@nano-agent/capability-runtime` 已注册 12 个最小命令，其中 workspace/search 相关命令是 `pwd / ls / cat / write / mkdir / rm / mv / cp / rg`（`packages/capability-runtime/src/fake-bash/commands.ts:16-143`; `packages/capability-runtime/README.md:20-43`）。
- `FakeBashBridge` 已明确：**永不伪造成功**，unsupported / oom-risk / unknown / no-executor 都必须返回结构化错误（`packages/capability-runtime/src/fake-bash/bridge.ts:17-19`, `68-109`）。
- `parseSimpleCommand()` 目前只支持非常简单的 argv 解析：引号可以，**pipes / redirects / subshells / escapes 都不支持**（`packages/capability-runtime/src/planner.ts:12-18`, `27-59`）。
- filesystem handlers 已经能通过 `WorkspaceNamespace` 做真实的 read/list/write/delete/mv/cp；但 `mkdir` 仍只是 compatibility ack，workspace backend 还没有 directory primitive（`packages/capability-runtime/src/capabilities/filesystem.ts:44-177`; `packages/workspace-context-artifacts/src/backends/types.ts:19-37`）。
- `WorkspaceNamespace + MountRouter` 已是 workspace truth，且已冻结 `/_platform/` reserved namespace（`packages/workspace-context-artifacts/src/mounts.ts:59-85`; `packages/workspace-context-artifacts/test/mounts.test.ts:160-192`）。
- `rg` handler 目前只是 degraded string-scan stub，并不是真正的 ripgrep 级实现（`packages/capability-runtime/src/capabilities/search.ts:21-44`）。
- 已有测试只证明了 workspace file ops 与 mount law 的一部分成立；并没有证明 `rg` 已具备真实搜索质量（`test/e2e/e2e-07-workspace-fileops.test.mjs:23-109`; `packages/capability-runtime/test/integration/command-surface-smoke.test.ts:14-71`）。

所以 Phase 7a 的任务不是“把 shell 彻底做成 Linux”，而是：

> **冻结 nano-agent 在 fake bash 下关于 workspace 与 search 的最小真实能力面，明确什么是真正成立的 workspace truth，什么只是兼容壳，什么还只能算 partial support。**

- **项目定位回顾**：nano-agent 的真实数据平面是 mount-based workspace + artifact/context system；bash 只是 LLM 兼容层，不是数据真相。
- **本次讨论的前置共识**：
  - workspace truth 必须来自 `WorkspaceNamespace`，而不是来自某个 shell 命令的输出字符串。
  - fake bash 必须遵守“no silent success”。
  - minimal search/workspace first，full POSIX later never assumed。
  - `/_platform/` 是保留命名空间，tenant root mount 不能吞掉它。
- **显式排除的讨论范围**：
  - 不讨论完整 POSIX FS 兼容
  - 不讨论真正的 indexed search service
  - 不讨论 browser-rendering / network / script / VCS（这些留给 Phase 7b/7c）
  - 不讨论 semantic retrieval / embedding index

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Minimal Bash Search and Workspace`
- **一句话定义**：它负责把 nano-agent 的 fake bash 在 workspace 访问与内容搜索上的最小能力面冻结成一组可解释、可验证、与真实 workspace substrate 对齐的 contract。
- **边界描述**：**包含** workspace mount truth、read/list/write/delete/move/copy contract、canonical search command、readonly / reserved namespace law、file/search consistency；**不包含** full shell grammar、grep family 全量兼容、directory metadata 完整模型、semantic retrieval。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **Workspace Truth** | 真正的文件/路径/mount 语义来源 | `MountRouter + WorkspaceNamespace` |
| **Compatibility Command** | 给 LLM 使用的 bash-shaped 命令外形 | 不是系统真相 |
| **Canonical Search Command** | v1 中唯一被正式承诺的文本搜索命令 | 先用 `rg`，不承诺 `grep` family |
| **File/Search Consistency** | 读取、列目录、搜索必须看到同一套 namespace reality | 不能各自走不同数据源 |
| **Reserved Platform Namespace** | `/_platform/...` 路径只允许显式平台 mount 认领 | root mount 不得吞掉 |
| **Partial Support** | 命令已注册，但语义还不够真实或不够完整 | 不能宣传成 fully supported |

### 1.2 参考调查报告

- `context/just-bash/src/fs/mountable-fs/mountable-fs.ts` — longest-prefix mount routing 与统一 namespace 是最值得吸收的基础形态（`49-220`）
- `context/just-bash/src/commands/rg/rg.ts` — 说明成熟的 `rg` 会承诺大量 flags、glob、ignore、context 行为；这正是 nano-agent 早期不应夸口的部分（`1-145`）
- `context/codex/codex-rs/tools/src/tool_registry_plan.rs` — 工具 surface 应先 registry-first 冻结，再逐步填充 handler（`67-184`）
- `context/claude-code/services/tools/toolExecution.ts` — tool execution 不只是“能跑”，还包含 permission、hooks、telemetry 的一体化治理（`126-131`）

**与 just-bash 的对齐结论**

- **明确吸收**：mount-based namespace、显式 command registry、partial support 必须诚实标注。
- **明确拒绝**：把 just-bash 的 80+ commands 当作当前 phase 的 parity 目标、把 rich `rg` flags 当作 v1 既成事实、把 bash 外形误当作 workspace truth。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **fake bash 与 workspace truth 的第一接触层**。
- 它服务于：
  1. `capability-runtime`
  2. `workspace-context-artifacts`
  3. future session-do runtime glue
  4. prompt / capability inventory / policy review
- 它依赖：
  - `A5-external-seam-closure.md`
  - `A7-storage-and-context-evidence-closure.md`
  - `MountRouter + WorkspaceNamespace`
  - `FakeBashBridge + CapabilityExecutor + CapabilityPolicyGate`
- 它被谁依赖：
  - Phase 7b/7c 的 network/script/VCS bash surface
  - future minimal bash action-plan
  - capability inventory memo

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `Workspace / Context / Artifacts` | Workspace -> Bash | 强 | workspace namespace 是 bash file ops 的事实来源 |
| `Storage & Context Evidence Closure` | Workspace -> Evidence | 强 | file/search 行为最终要能留下 evidence |
| `Capability Runtime` | 双向 | 强 | fake bash 只是 capability runtime 的命令外壳 |
| `Session Edge Closure` | Session -> Workspace | 中 | session turn 会驱动 file/search commands，但不应重定义其语义 |
| `External Seam Closure` | Workspace -> External | 中 | future remote search worker 也必须遵守同一 workspace truth |
| `Minimal Bash Network and Script` | Workspace -> Script | 中强 | script 执行需要读写同一 namespace |
| `Minimal Bash VCS and Policy` | Workspace -> VCS | 中强 | virtual git 读到的文件状态必须与 workspace 一致 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Minimal Bash Search and Workspace` 是 **fake bash 的最小数据平面契约**，负责 **把 workspace 访问与内容搜索收敛到同一套 mount-based truth 上**，对上游提供 **bash-compatible 但不撒谎的 file/search surface**，对下游要求 **任何 file/search 行为都不得脱离 `WorkspaceNamespace` 自行发明事实**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 完整 `grep/egrep/fgrep` 三件套 | just-bash | 现在只会制造“我们有完整 Unix text toolchain”的错觉 | 可能 |
| pipes / redirects / subshells | 传统 shell | 当前 planner 明确不支持，强做只会让 contract 失真 | 可能 |
| symlink / chmod / readlink / realpath | just-bash / POSIX | 当前 workspace backend 不提供这类 primitive | 可能 |
| 完整 directory model | POSIX FS | 当前 backend 是 file-map + implicit directory prefix，不应假装是 inode FS | 可能 |
| `.gitignore`/glob/type filter 完整搜索 | just-bash `rg` | 当前 `rg` handler 还只是 degraded stub，承诺过多会透支可信度 | 可能 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| Search capability | `rg` declaration + handler | minimal pattern/path contract | richer flags / indexed worker |
| Directory primitive | workspace backend interface | 暂不提供 | `mkdir/statDir/deleteDir` |
| Grep alias family | command registry | 当前 baseline 不注册；优先保留为后续 `grep -> rg subset` 兼容 alias | `grep -> rg subset` alias layer |
| Remote search | `service-binding` target | slot 存在但未接入 | remote indexed search worker |
| Search result promotion | artifact promotion + evidence | 大结果可 promoted | cross-turn searchable result refs |

### 3.3 完全解耦点（哪里必须独立）

- **Workspace truth 与 bash output**
  - **解耦原因**：命令输出只是呈现；真实状态必须来自 namespace/backend。
  - **依赖边界**：任何 caller 若要判断真实文件状态，只能读 `WorkspaceNamespace` / snapshot / evidence。

- **Search command contract 与搜索实现**
  - **解耦原因**：Phase 7a 先冻结“叫什么、接受什么输入、输出什么边界”，不冻结具体索引策略。
  - **依赖边界**：degraded local-ts 与 future remote search worker 必须共享同一 command contract。

- **File ops policy 与 backend semantics**
  - **解耦原因**：allow/ask/deny 属于 capability policy；readonly/reserved path 属于 workspace law。
  - **依赖边界**：不能把 readonly 行为只写在 prompt 里，也不能把 policy 塞进 backend。

### 3.4 聚合点（哪里要刻意收敛）

- **所有 workspace path resolution 都收敛到 `MountRouter.routePath()`**
- **所有 fake bash file commands 都收敛到同一 workspace namespace**
- **所有 search semantics 都收敛到一个 canonical command（v1: `rg`）**
- **所有 partial support / unsupported 结论都要进入 capability inventory**

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：更接近“直接在本地 FS 上读写文件”，不需要额外区分 compatibility surface 与 workspace truth。
- **亮点**：
  - 简单直接
  - 搜索/读取心智成本低
- **值得借鉴**：
  - 对 LLM 而言，file/search 路径必须足够自然
- **不打算照抄的地方**：
  - 不把本地 FS 假设直接移植到 Worker runtime

### 4.2 codex 的做法

- **实现概要**：registry-first 工具面更成熟，搜索工具与 shell 工具的边界更清楚。
- **亮点**：
  - 工具暴露面先冻结再执行
  - handler kind / permission / surface 统一管理
- **值得借鉴**：
  - search/workspace surface 必须先有 inventory，再谈 richer implementation
- **不打算照抄的地方**：
  - 不复制其本地 shell / sandbox / MCP 复杂矩阵

### 4.3 claude-code 的做法

- **实现概要**：file read/write 与 tool execution 治理成熟，但默认前提仍是本地 CLI / IDE / Node 宿主。
- **亮点**：
  - permission/hook/telemetry 一体化
  - large result persistence 很成熟
- **值得借鉴**：
  - 搜索结果与文件内容不应无限 inline，必要时要转 ref/persisted output
- **不打算照抄的地方**：
  - 不复制其本地磁盘与 IDE 绑定前提

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| workspace truth 来源 | 本地 FS | 本地环境 + registry | 本地 FS / IDE | Mount router + namespace |
| search surface 治理 | 低 | 高 | 中高 | 高 |
| 对 partial support 的显式度 | 低 | 中高 | 中 | 高 |
| 对 Worker/V8 环境适配 | 低 | 低 | 低 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] Workspace truth freeze**
  - 必须明确 `MountRouter + WorkspaceNamespace` 才是 file/search 的事实来源，而不是 bash 输出。

- **[S2] Minimal file ops surface**
  - 必须冻结 `pwd / ls / cat / write / rm / mv / cp` 的最小 contract；`mkdir` 只能以 partial support 口径存在，直到 backend 增加 directory primitive。

- **[S3] Canonical search command**
  - 必须明确 v1 只正式承诺 `rg`，且它是 minimal subset，不是假装完整 ripgrep。

- **[S4] File/search consistency law**
  - 必须保证 file read、list、search 看到的是同一 namespace、同一 readonly law、同一路径解析。

- **[S5] Reserved namespace + mount law**
  - 必须把 `/_platform/` 保留规则写入 fake bash workspace contract，而不是只留在 mount tests 里。

- **[S6] Evidence and test closure**
  - 必须把哪些命令“真支持”、哪些“部分支持”、哪些“还没证据”写入 inventory，并补最小 smoke。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] Full POSIX file command family**
- **[O2] `grep/egrep/fgrep` 全量兼容**
- **[O3] search flags 全矩阵（glob/type/ignore/context/json）**
- **[O4] true directory/inode metadata model**
- **[O5] semantic retrieval / embedding search**

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `mkdir` 命令已注册 | in-scope，但仅 partial support | 当前 handler 只返回 ack，没有 backend directory primitive |
| `rg` 命令已注册 | in-scope，但仅 minimal subset | 当前 handler 仍是 degraded TS scan，不得宣称 ripgrep parity |
| `grep` family | out-of-scope | 计划文档提到过，但当前代码 reality 里根本不存在 |
| readonly mount 拒绝写入 | in-scope | 这是真实 workspace law，已有测试锚点 |
| `/_platform/` | in-scope | 这是路径治理 law，不是实现细节 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **workspace-native truth** 而不是 **shell-native truth**
   - **为什么**：nano-agent 的真实数据平面在 workspace package，不在 bash parser。
   - **我们接受的代价**：bash 表面看起来没有那么“像一台 Linux 机器”。
   - **未来重评条件**：无；这是 Worker-native 架构的基本盘。

2. **取舍 2**：我们选择 **先冻结 `rg` 一个 canonical search command** 而不是 **一口气承诺 `grep + rg + sed + awk`**
    - **为什么**：当前只有 `rg` declaration，且实现仍 degraded；过早承诺只会失真。
    - **我们接受的代价**：LLM 某些习惯性 `grep` 用法需要 prompt 引导或 alias 未来再补。
    - **未来重评条件**：当 search contract、parser、tests 都成熟时，可优先补一个窄口 `grep -> rg` alias，而不是直接扩成完整 grep family。

3. **取舍 3**：我们选择 **deterministic, bounded output** 而不是 **完整 ripgrep parity**
   - **为什么**：Worker/V8 isolate 下，确定性与资源边界比 CLI 花样更重要。
   - **我们接受的代价**：早期搜索体验会比较“窄”。
   - **未来重评条件**：当 remote indexed search worker 成型后，可再增加 richer surface。

4. **取舍 4**：我们选择 **明确标注 partial support** 而不是 **模糊地说“支持这些命令”**
   - **为什么**：`mkdir` 与 `rg` 当前都还不是 fully real，模糊承诺会让 inventory 失去价值。
   - **我们接受的代价**：文档看起来会更“保守”。
   - **未来重评条件**：当 backend/search evidence 补齐后，再提升等级。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| `mkdir` 被误当成真实目录语义 | 只看 command list，不看 backend reality | 调用方误判 workspace state | inventory 中单列 partial support，并在 action-plan 中补 backend primitive |
| `rg` 被误当成 ripgrep parity | prompt/README 夸大能力 | 搜索结果与预期不符 | 明确 `rg` 是 minimal subset；高阶 flags 先报错而不是 silent ignore |
| file/search 走不同数据源 | 局部实现各自偷跑 | 结果不一致 | 强制通过 `WorkspaceNamespace` / future shared search backend |
| root mount 吞掉 `/_platform/` | 新实现忘记保留 law | 平台命名空间污染 | 保留 mount regression tests，并写入 capability inventory |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：终于能把“workspace 命令支持到了什么程度”说清楚，而不是靠感觉。
- **对 nano-agent 的长期演进**：为 network/script/VCS bash surface 提供统一的 workspace baseline。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：上下文管理收益最大，因为 workspace truth 直接决定 context assembly 和 snapshot 的可信度。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Workspace Truth Freeze | 冻结 mount router / namespace / reserved path law | bash file/search 不再自造事实 |
| F2 | Compatibility FileOps Surface | 冻结最小文件命令面与 partial support 边界 | 支持矩阵不再模糊 |
| F3 | Canonical `rg` Contract | 冻结 v1 搜索命令与 minimal argv 形态 | search surface 不再漂移 |
| F4 | File/Search Consistency Guard | 强制 file read/list/search 共享同一 namespace reality | 同一路径不会出现两套答案 |
| F5 | Evidence and Snapshot Alignment | 让 workspace/search 行为能被 evidence/snapshot 解释 | 行为可回放、可审阅 |

### 7.2 详细阐述

#### F1: `Workspace Truth Freeze`

- **输入**：`MountRouter`、`WorkspaceNamespace`、reserved `/_platform/` law
- **输出**：workspace truth contract
- **主要调用者**：filesystem handlers、future search backend、session-do runtime
- **核心逻辑**：
  - path resolution 统一走 longest-prefix route
  - readonly mount 拒绝写入与删除
  - root mount 不能吞 `/_platform/`
- **一句话收口目标**：✅ **`任何 bash file/search command 的路径结果，都能回溯到 namespace route`**

#### F2: `Compatibility FileOps Surface`

- **输入**：`registerMinimalCommands()` 与 filesystem handlers
- **输出**：最小 file ops 能力矩阵
- **主要调用者**：fake bash bridge、capability inventory、prompt
- **核心逻辑**：
  - `pwd/ls/cat/write/rm/mv/cp` 作为 v1 主体
  - `mkdir` 标为 partial，直到 backend 有真实 dir primitive
  - 不承诺 `touch/head/tail/find/tee`
- **一句话收口目标**：✅ **`命令清单与真实 backend 语义保持一致，不再过度承诺`**

#### F3: `Canonical RG Contract`

- **输入**：search capability declaration、planner、current degraded handler
- **输出**：`rg` minimal subset contract
- **主要调用者**：LLM prompt、future remote search worker、tests
- **核心逻辑**：
  - bash string 形态固定为 `rg <pattern> [path]`
  - richer flags 先不承诺
  - structured tool call 可作为未来 richer input 的升级口
  - 若要降低 LLM 对 `grep` 的误用成本，第一优先级兼容回补应该是把 `grep <pattern> [path]` alias 到同一 minimal search capability，而不是引入独立 grep runtime
- **一句话收口目标**：✅ **`search command 有唯一正式名字和唯一最小 argv 入口`**

#### F4: `File/Search Consistency Guard`

- **输入**：filesystem handlers、search handlers、workspace package
- **输出**：一致性原则
- **主要调用者**：reviewers、future implementers
- **核心逻辑**：
  - search 不得绕过 namespace 直接扫宿主
  - readonly/reserved path law 对 search 也生效
  - search output path format 要与 `ls/stat/cat` 一致
- **一句话收口目标**：✅ **`同一个路径在 list/cat/search 中不会出现三套命名`**

#### F5: `Evidence and Snapshot Alignment`

- **输入**：workspace snapshot、artifact promotion、Phase 6 evidence closure
- **输出**：file/search 行为的 evidence 对齐规则
- **主要调用者**：eval-observability、session checkpoint/replay
- **核心逻辑**：
  - 大结果可以 promoted，不要求永远 inline
  - snapshot 记录 workspace fragment，而不是 bash history
  - search capability 等级要反映已有测试/evidence
- **一句话收口目标**：✅ **`workspace/search 的真实状态能被 snapshot 与 evidence 解释，而不是只剩 stdout`**

### 7.3 非功能性要求

- **性能目标**：搜索输出必须有 deterministic/bounded 策略，不能无界扫描后全量 inline。
- **可观测性要求**：workspace/search 行为要能挂回 trace/evidence。
- **稳定性要求**：不得把 partial support 写成 fully supported。
- **测试覆盖要求**：至少需要 workspace file ops、reserved namespace、search contract smoke、以及 file/list/search consistency 四类证据。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nano-agent 当前代码

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `packages/capability-runtime/src/capabilities/filesystem.ts:44-177` | namespace-backed file handlers | filesystem 命令应依附 workspace truth | `mkdir` 仍是 partial |
| `packages/workspace-context-artifacts/src/mounts.ts:59-85` | reserved `/_platform/` routing | root mount 不得吞平台命名空间 | 已有 regression guard |
| `test/e2e/e2e-07-workspace-fileops.test.mjs:23-109` | workspace file ops E2E | 当前最真实的 workspace bash evidence | search 尚未进入同等级 evidence |

### 8.2 来自 just-bash

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/just-bash/src/fs/mountable-fs/mountable-fs.ts:49-220` | mountable unified namespace | mount-first 心智非常适合 nano-agent | 我们已在 workspace package 吸收 |
| `context/just-bash/src/commands/rg/rg.ts:18-114` | rich `rg` surface | 说明完整 ripgrep 面很宽，不应早期照单全收 | 适合作为 future ceiling |

### 8.3 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/tools/src/tool_registry_plan.rs:67-184` | registry-first tool planning | 能力 inventory 应先于实现细节扩张 | 很适合 capability inventory |

### 8.4 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/services/tools/toolExecution.ts:126-131` | tool hooks/permission/telemetry integration | file/search 不是“能跑就行”，还要纳入治理 | future action-plan 需要吸收 |
| `context/claude-code/utils/toolResultStorage.ts:130-199` | large result persistence | 搜索结果过大时应优先转 ref/persist，而不是硬塞上下文 | 与 Phase 6 evidence closure 对齐 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`Minimal Bash Search and Workspace` 的真正任务不是“做出一套 shell 文件命令”，而是给 nano-agent 立一条很硬的底线：workspace truth 在 namespace，search contract 要克制，partial support 必须诚实，bash 只是展示层。这样一来，后面的 curl、ts-exec、git subset 才有一个不会漂移的工作目录与路径宇宙。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | fake bash 若没有 workspace truth，会立刻失真 |
| 第一版实现的性价比 | 4 | search 与 mkdir 仍偏 partial，文档必须比实现更诚实 |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 5 | workspace truth 是这三条线的共用地基 |
| 对开发者自己的日用友好度 | 4 | 会更保守，但更可靠 |
| 风险可控程度 | 4 | 风险主要在 partial support 被误读，可通过 inventory 缓解 |
| **综合价值** | **4** | **应作为 Phase 7 的第一份能力面冻结文稿，但必须持续提醒 `mkdir/rg` 仍是 partial reality** |

### 9.3 下一步行动

- [ ] **决策确认**：确认 v1 canonical search command 仍只保留 `rg`，以及后续是否优先补窄口 `grep -> rg` alias。
- [ ] **关联 Issue / PR**：补一条真正的 search smoke，避免 `rg` 继续只有 declaration 没有质量证据。
- [ ] **待深入调查的子问题**：
  - [ ] `mkdir` 是否要在下一步补成真实 backend primitive，还是继续保持 compatibility alias
  - [ ] `grep` family 是否未来只做 alias，而不做独立 capability
- [ ] **需要更新的其他设计文档**：
  - `docs/design/after-skeleton/P7b-minimal-bash-network-and-script.md`
  - `docs/design/after-skeleton/PX-capability-inventory.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
