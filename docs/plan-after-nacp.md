# Plan After NACP

> 文档对象: `nano-agent / post-NACP skeleton planning`
> 日期: `2026-04-16`
> 作者: `GPT-5.4`
> 前置已完成项:
> - `packages/nacp-core/` 已收口
> - `packages/nacp-session/` 已收口
> - `docs/design/hooks-by-GPT.md`
> - `docs/design/llm-wrapper-by-GPT.md`
> - `docs/eval/vpa-fake-bash-by-GPT.md`
> - `README.md`

---

## 0. 这份文档要解决什么问题

`nacp-core` 和 `nacp-session` 收口之后，nano-agent 已经有了**协议地基**，但还没有一个可运行的 **agent 本体骨架**。

现在最容易犯的错误有两个：

1. 直接开始写 worker / DO / tool / LLM 代码，让实现顺序反过来主导架构；
2. 过早开始设计 DDL / KV / R2 细节，把还没被运行时验证过的访问模式先固化成数据结构。

这份文档的目标，就是把 post-NACP 阶段的工作顺序钉死：

> **先补齐骨架所需的设计与 action-plan，再做一次全文档联审，再搭基础设施与观察窗口，最后按推荐顺序开始写代码；而 DDL / KV / R2 的最终协同方案，要由这些验证结果反推。**

---

## 1. 我们现在已经有什么，还缺什么

### 1.1 已经冻结的东西

当前已经明确的地基有：

1. **项目定位**
   - nano-agent 是 Cloudflare-native、WebSocket-first、DO-centered、Worker/V8 isolate 宿主的 agent runtime。
2. **协议分层**
   - `NACP-Core` = internal envelope / internal runtime contract
   - `NACP-Session` = client ↔ session DO WebSocket profile
3. **Hooks 设计**
   - 已明确 Hook event / Hook runtime / Hook outcome / NACP-Core / NACP-Session 的映射方式
4. **LLM Wrapper 设计**
   - 已明确 canonical message、provider/model registry、attachment planner、stream normalization、session stream mapping
5. **Fake Bash 价值判断**
   - 已明确 fake bash 是 **LLM compatibility surface**，不是系统内核

### 1.2 还没冻结、但骨架必须先补齐的东西

如果要进入 nano-agent 本体开发，还缺 6 类关键设计：

| 缺口 | 为什么必须先设计 | 它解决什么 |
|---|---|---|
| **Agent Runtime Kernel** | 没有主循环骨架，就无法决定 hooks / llm / tools / compact 谁在什么时候发生 | turn loop、state transitions、step scheduler、abort/cancel、event emission |
| **Capability Runtime / Fake Bash Runtime** | fake bash 不能只停在价值判断，必须落到 capability contract | tool registry、command registry、approval/policy、TS execution、network/browser 映射 |
| **Workspace / Artifact / Context Runtime** | Worker 里没有真实 FS，必须先定义工作区与物料如何存在 | virtual FS、mount、workspace snapshot、artifact ref、context layering、compact input/output |
| **Session DO Runtime / Worker Assembly** | 协议包已经有了，但 agent 还没有 session actor 本体 | WebSocket ingress、session lifecycle、DO storage checkpoint、runtime composition |
| **Observability / Eval Harness** | 没有观察窗口与验证 harness，后面根本无法判断 DDL / KV / R2 应该怎么分层 | trace、timeline、session inspector、scenario runner、replay/eval |
| **Storage Topology / Registry Domain** | 不是为了先做数据库，而是为了把“什么属于 DO / KV / R2”说清楚 | hot state、shared config、large artifact、registry snapshot、storage contracts |

---

## 2. 接下来应该先规划哪些内容

### 2.1 第一组：必须补齐的设计文档

在开始写 nano-agent 本体代码之前，我建议先新增以下设计文档：

1. **`docs/design/agent-runtime-kernel-by-GPT.md`**
   - 定义 nano-agent 主循环
   - 定义 turn / step / event / cancel / compact / tool / llm 的顺序
   - 定义 hooks 与 llm-wrapper 在 runtime 内各自所处的位置

2. **`docs/design/capability-runtime-by-GPT.md`**
   - 定义 fake bash 如何映射为 typed capability runtime
   - 定义 command registry、tool registry、policy / approval、network / browser / ts execution
   - 定义哪些命令是最小集，哪些明确不支持

3. **`docs/design/workspace-context-artifacts-by-GPT.md`**
   - 定义 virtual FS、mount、workspace layout、artifact refs、context layering、compact seams
   - 明确 DO / KV / R2 在“文件、摘要、快照、附件”上的边界

4. **`docs/design/session-do-runtime-by-GPT.md`**
   - 定义真正的 session actor / session DO runtime
   - 说明怎样把 `nacp-session`、agent runtime kernel、hooks、llm-wrapper、capability runtime 装配成一个 Worker/DO 本体

5. **`docs/design/eval-observability-by-GPT.md`**
   - 定义“如何观察一个 session 在跑什么”
   - 定义 scenario runner、trace sink、stream inspector、timeline、failure replay
   - 这是后续做 DDL / KV / R2 分层的证据来源

6. **`docs/design/storage-topology-by-GPT.md`**
   - 定义 hot / warm / cold state
   - 定义 DO storage、KV、R2 各自负责什么
   - 这不是数据库 schema 设计，而是 storage semantics 设计

### 2.2 第二组：要基于设计文档生成的 action-plan

在上述设计文档完成之后，再创建对应 action-plan：

1. `docs/action-plan/agent-runtime-kernel.md`
2. `docs/action-plan/capability-runtime.md`
3. `docs/action-plan/workspace-context-artifacts.md`
4. `docs/action-plan/session-do-runtime.md`
5. `docs/action-plan/llm-wrapper.md`
6. `docs/action-plan/hooks.md`
7. `docs/action-plan/eval-observability.md`
8. `docs/action-plan/storage-topology.md`

其中：

- `hooks` 和 `llm-wrapper` **不需要重新做设计重写**，但需要落成正式 action-plan
- `storage-topology` 的 action-plan **不应直接跳到 DDL**，而应先做 runtime contract、adapters、observability-backed evidence collection

---

## 3. 推荐的总体工作顺序

### 3.1 不是“边想边写”，而是 5 个阶段

我建议 post-NACP 阶段按下面 5 个大阶段推进。

| 阶段 | 名称 | 目标 | 结果 |
|---|---|---|---|
| **Stage A** | 补齐骨架设计 | 把 runtime、capability、workspace、session DO、observability、storage topology 全补齐 | 一组 design docs |
| **Stage B** | 补齐 action-plan | 为所有骨架单元建立执行蓝图 | 一组 action-plan docs |
| **Stage C** | 重新 go through 全部文档 | 做一次跨文档联审，确认边界、协议、命名、事件、职责都对齐 | 一份 cross-doc alignment 记录 |
| **Stage D** | 搭基础设施与观察窗口 | 建立验证 harness、trace、timeline、session inspector、fake provider/tool workers | 可观察、可复现、可回放的测试底座 |
| **Stage E** | 按推荐顺序执行 action-plan | 真正开始写代码 | 一条条 package / worker implementation |

### 3.2 为什么一定要先做 Stage C / D

因为 nano-agent 不是一个“写点库然后调调就行”的项目。

它天然涉及：

- `NACP-Core`
- `NACP-Session`
- Hooks
- LLM Wrapper
- fake bash / capability runtime
- virtual FS / artifact runtime
- DO / KV / R2 分层

这些如果不先做 cross-doc go-through，很容易出现：

1. 命名冲突
2. phase / lifecycle 断点
3. session stream shape 不一致
4. storage contract 说法不一致
5. action-plan 之间互相打架

而如果不先做 observability / eval harness，后面就会进入：

> “感觉上应该放 KV / 感觉上应该放 R2 / 感觉上 DO storage 够了”

这种无证据决策。

---

## 4. 我建议的 planning 顺序

### 4.1 设计文档的推荐编写顺序

我建议按下面顺序补设计：

1. **Agent Runtime Kernel**
2. **Workspace / Context / Artifacts**
3. **Capability Runtime / Fake Bash Runtime**
4. **Session DO Runtime**
5. **Eval / Observability**
6. **Storage Topology**

### 4.2 这个顺序的原因

1. **先定主循环**
   - 不先定 runtime kernel，hooks 和 llm-wrapper 只能停在“功能簇”层，没法真正装配
2. **再定 workspace / artifact**
   - fake bash、tools、llm attachment、compact 都要依赖 workspace / artifact model
3. **然后定 capability runtime**
   - 因为 fake bash 本质上是 capability routing surface，不是 shell 本体
4. **再定 session DO runtime**
   - 到这一步，才知道 session actor 里到底要装什么
5. **再定 observability / eval**
   - 这一步不是晚，而是要基于前面的 runtime structure 来设计观察点
6. **最后再定 storage topology**
   - 因为只有知道“谁在什么时候读写什么”，才能真正决定 DO / KV / R2 边界

---

## 5. 我建议的 implementation 顺序

设计和 action-plan 完成后，我建议按下面顺序真正开始写代码。

### 5.1 第一批：先做能跑通最小 session turn 的骨架

1. **Session DO Runtime Skeleton**
   - Worker 入口
   - Session DO lifecycle
   - WebSocket attach/resume
   - session state checkpoint
   - 将 `nacp-session` 真正接进来

2. **Agent Runtime Kernel**
   - 最小 turn loop
   - step scheduler
   - cancel / abort / compact seam
   - event emission seam

### 5.2 第二批：给骨架装上“能干活”的最小能力

3. **Workspace / Context / Artifact Runtime**
   - virtual workspace
   - artifact ref
   - mount / snapshot
   - compact input/output seam

4. **Capability Runtime / Fake Bash Minimal Set**
   - 最小命令集：`pwd` / `ls` / `cat` / `write` / `rg` / `curl` / `ts-exec`
   - network / browser / git subset 先保留最小能力面

5. **LLM Wrapper Foundation**
   - provider registry
   - model registry
   - canonical request builder
   - stream normalization → `session.stream.event`

### 5.3 第三批：把平台性能力接回来

6. **Hooks Runtime**
   - registry
   - dispatcher
   - audit sink
   - session stream adapter

7. **Observability / Eval Harness**
   - session inspector
   - NACP trace viewer
   - scenario runner
   - replay-based validation

### 5.4 第四批：在验证之后再落存储与注册

8. **Storage Topology Implementation**
   - 先落 adapters 和 contract
   - 后定 KV / R2 / DO storage 的最终职责

9. **Registry / DDL Planning & Implementation**
   - model registry
   - skill registry
   - capability registry
   - audit/export metadata

> 也就是说：**DDL / registry 不是骨架的前置条件，而是骨架验证之后的收敛结果。**

---

## 6. 我们需要什么“基础设施”和“观察窗口”

这是接下来最容易被低估、但最该优先规划的一层。

### 6.1 最小基础设施

1. **Fake Provider Worker**
   - 模拟 Chat Completions 兼容 provider
   - 提供稳定流式输出、错误、超时、tool call 测试路径

2. **Fake Capability Worker**
   - 模拟 fake bash / tool worker
   - 提供 progress / result / cancel / timeout 路径

3. **Session Scenario Runner**
   - 用脚本化方式跑：
     - session.start
     - llm delta
     - tool call
     - hook emit
     - disconnect / reconnect / resume
     - compact / restore

4. **Artifact Staging Sandbox**
   - 专门验证：
     - 小文本 inline
     - 图片 / 大文件走 R2
     - artifact ref 如何进入 LLM wrapper

### 6.2 最小观察窗口

1. **Session Stream Inspector**
   - 看 `session.stream.event` 实际长什么样
   - 验证 event kinds、seq、replay、redaction

2. **NACP Trace Timeline**
   - 同时看 core envelope 与 session stream
   - 排查 internal message 与 client-visible stream 的断点

3. **Tool / Capability Timeline**
   - 看 fake bash / capability runtime 的 progress / result / cancel

4. **Storage Placement Inspector**
   - 每条关键数据落到哪里：
     - DO storage
     - KV
     - R2
   - 这是后续决定 DDL / storage topology 的核心观察面

5. **Failure Replay Window**
   - 能重放：
     - LLM timeout
     - tool timeout
     - session reconnect
     - compact after long turn

---

## 7. 用什么验证，把 DDL / KV / R2 的协同机制反推出来

### 7.1 不要先拍脑袋定存储

接下来不应直接问：

- “skill registry 放哪？”
- “model registry 用 KV 还是 SQLite？”
- “workspace snapshot 要不要进 R2？”

正确顺序应该是先跑出 4 组验证。

### 7.2 四组必须先跑出来的验证

1. **Session / Runtime 验证**
   - 长会话是否需要频繁 checkpoint
   - 哪些状态必须热存于 DO storage

2. **Workspace / Artifact 验证**
   - 哪些工作区数据适合只留内存
   - 哪些需要 snapshot
   - 哪些天然属于 R2 对象

3. **Capability / Fake Bash 验证**
   - 命令输出是否需要 durable replay
   - 工具执行记录是否需要被索引

4. **LLM / Hooks / Compact 验证**
   - 哪些 metadata 需要共享配置
   - 哪些策略数据适合 KV
   - 哪些运行态 trace 不该进入 registry，而应进入审计或导出

### 7.3 由验证反推的 storage 方向

在我看来，理论上大概率会收敛到下面这种分层：

| 层 | 倾向放什么 | 为什么 |
|---|---|---|
| **DO storage** | session hot state、replay checkpoint、turn-local state、last-seen seq、in-flight runtime metadata | 强一致、跟 actor 绑定、适合热状态 |
| **KV** | shared manifests、policy snapshots、provider/model config、skill/capability registry snapshot、feature flags | 读多写少、跨 session 共享 |
| **R2** | artifacts、大文件、workspace snapshot、images、exports、compact archives、trace export bundle | 大对象、低频、可引用 |
| **DDL / structured store** | 只有在 query / indexing / analytics 明确需要时才引入 | 不应在骨架阶段先行 |

> 换句话说：**DDL 不是第一步，而是“验证表明我们真的需要结构化查询”之后才该出现。**

---

## 8. 一次完整的“go through 所有文档”应该怎么做

在所有设计文档与 action-plan 写完之后，我建议做一次明确的 cross-doc review。

### 8.1 必查矩阵

| 检查项 | 需要对齐的文档 |
|---|---|
| Runtime phases / session lifecycle | `nacp-core` / `nacp-session` / `session-do-runtime` / `agent-runtime-kernel` |
| Event catalog / session stream kinds | `hooks` / `llm-wrapper` / `nacp-session` / `eval-observability` |
| Tool progress / cancel / timeout path | `capability-runtime` / `nacp-core` / `session-do-runtime` |
| Workspace / artifact refs | `workspace-context-artifacts` / `llm-wrapper` / `capability-runtime` |
| Storage placement | `storage-topology` / `workspace-context-artifacts` / `eval-observability` |
| Approval / policy / hook interaction | `hooks` / `capability-runtime` / `agent-runtime-kernel` |

### 8.2 cross-doc review 的目标

不是“再读一遍文档”，而是检查：

1. 名词是不是一致
2. phase / event / message type 是否一致
3. 哪些是 runtime responsibility，哪些是 caller-managed responsibility
4. 哪些要在 helper 层 enforce，哪些由 session DO lifecycle 调用
5. 哪些数据应该可回放，哪些只需即时流出

---

## 9. 最终建议：从今天开始，最该先做什么

如果现在要立刻开始下一轮规划，我建议按下面顺序开工：

1. **先写 `docs/design/agent-runtime-kernel-by-GPT.md`**
2. **再写 `docs/design/workspace-context-artifacts-by-GPT.md`**
3. **再写 `docs/design/capability-runtime-by-GPT.md`**
4. **接着写 `docs/design/session-do-runtime-by-GPT.md`**
5. **然后写 `docs/design/eval-observability-by-GPT.md`**
6. **最后写 `docs/design/storage-topology-by-GPT.md`**

接着再按这个顺序制作 action-plan：

1. `agent-runtime-kernel`
2. `session-do-runtime`
3. `workspace-context-artifacts`
4. `capability-runtime`
5. `llm-wrapper`
6. `hooks`
7. `eval-observability`
8. `storage-topology`

### 9.1 为什么这就是“基本骨架”

因为这 8 组工作合起来，正好覆盖了：

- **协议层**：已经有 `nacp-core` / `nacp-session`
- **主循环层**：`agent-runtime-kernel`
- **会话宿主层**：`session-do-runtime`
- **能力执行层**：`capability-runtime`
- **工作区层**：`workspace-context-artifacts`
- **模型层**：`llm-wrapper`
- **治理扩展层**：`hooks`
- **验证观测层**：`eval-observability`
- **存储收敛层**：`storage-topology`

这就是最小可运行 nano-agent skeleton 的完整图。

---

## 10. 一句话 verdict

我的最终建议是：

> **不要立刻写 nano-agent 本体代码；先把 runtime kernel、workspace/artifact、capability runtime、session DO runtime、observability、storage topology 这几块设计和 action-plan 补齐，再做一次 cross-doc 联审，搭好观察窗口，然后按推荐顺序实现。**

这样做的价值是：

1. 让 `nacp-core` / `nacp-session` 真正成为上游地基，而不是孤立协议包
2. 让 hooks / llm-wrapper 从“设计文档”变成可装配骨架
3. 让后续的 DDL / KV / R2 不是拍脑袋，而是被 runtime 验证倒逼出来的结果

如果要一句话概括 post-NACP 阶段的工作方法，那就是：

> **design the skeleton first, verify the seams second, build the infrastructure third, implement last.**
