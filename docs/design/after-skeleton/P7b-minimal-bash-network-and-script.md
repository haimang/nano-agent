# Nano-Agent Minimal Bash Network and Script 功能簇设计

> 功能簇: `Minimal Bash Network and Script`
> 讨论日期: `2026-04-17`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P7a-minimal-bash-search-and-workspace.md`
> - `docs/design/after-skeleton/P4-external-seam-closure.md`
> - `docs/design/after-skeleton/P5-deployment-dry-run-and-real-boundary-verification.md`
> - `docs/eval/vpa-fake-bash-by-GPT.md`
> - `docs/design/after-nacp/capability-runtime-by-GPT.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

对于 LLM 来说，workspace/search 之外第二高频的 bash 幻觉就是：

1. **我可以 `curl` 一个地址确认它活着**
2. **我可以写一段脚本做分析**

而当前仓库在这两点上，已经有了很清楚但还不完整的 reality：

- minimal command pack 已注册 `curl` 与 `ts-exec`，二者默认 policy 都是 `ask`（`packages/capability-runtime/src/fake-bash/commands.ts:114-128`）。
- `createNetworkHandlers()` 当前只是 URL 校验 + stub 文案，明确写着 `network access not yet connected`（`packages/capability-runtime/src/capabilities/network.ts:22-38`）。
- `createExecHandlers()` 当前只是确认代码长度的 stub，明确写着 `sandboxed execution not yet connected`（`packages/capability-runtime/src/capabilities/exec.ts:23-34`）。
- planner 对 bash string 的支持非常窄：`curl` 只会取第一个参数当 URL；`ts-exec` 只会把余下 argv 直接拼成 `code`（`packages/capability-runtime/src/planner.ts:139-146`）。
- `ServiceBindingTarget` 的 request/progress/cancel/response seam 已经很成熟，这为后续 remote network/script worker 留出了真实升级口（`packages/capability-runtime/src/targets/service-binding.ts:40-191`）。
- `BrowserRenderingTarget` 仍是 reserved slot，当前不应把 browser automation 混进 Phase 7b（`packages/capability-runtime/src/targets/browser-rendering.ts:17-49`）。
- just-bash 的 `curl` 很强，但它基于 secure fetch opt-in；其 `js-exec` 则是明显 Node/worker_threads-heavy，不适合作为 Worker-first 基线（`context/just-bash/src/commands/curl/curl.ts:177-240`; `context/just-bash/src/commands/js-exec/js-exec.ts:1-130`）。

所以 Phase 7b 的任务不是“恢复 Linux 脚本时代的一切自由”，而是：

> **冻结 nano-agent 在 fake bash 下关于 network verification 与 script execution 的最小可信 contract，并明确 bash string surface 的真实边界、structured capability path 的升级边界、以及 Worker-native policy guard。**

- **项目定位回顾**：nano-agent 运行在受限的 Worker/V8 isolate 中，不存在真实 shell 进程，也不应默认拥有 unrestricted egress。
- **本次讨论的前置共识**：
  - `curl` 不是“网络自由”，而是受 policy 约束的 verification capability。
  - `ts-exec` 不是“node/python 解释器代理”，而是受控分析脚本能力。
  - structured capability path 可以比 bash string surface 更丰富，但两者必须对齐。
  - localhost / long-lived server / install-then-run 都不是 v1 心智。
- **显式排除的讨论范围**：
  - 不讨论 browser rendering
  - 不讨论 Python runtime
  - 不讨论 package install / npm / pip / process spawning
  - 不讨论 unrestricted network / raw sockets / local daemon

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Minimal Bash Network and Script`
- **一句话定义**：它负责把 fake bash 的 `curl` 与 `ts-exec` 收敛为 Worker-native、policy-first、不会制造“本地机器自由”幻觉的最小能力面。
- **边界描述**：**包含** restricted `curl`、restricted `ts-exec`、network/script policy、structured-vs-bash contract、artifact-aware outputs、remote upgrade seam；**不包含** Python、Node process spawning、localhost server control、browser automation、package installation。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **Network Opt-In** | 网络能力只有在 registry/policy/env 明确允许时才存在 | 不是默认常开 |
| **Restricted Curl** | fake bash 里的最小网络验证能力 | 先冻结最小 URL/method/body 面 |
| **Script Sandbox** | 受控的 TS/JS 执行能力 | 不是 Node REPL |
| **Structured Path** | 直接传 capability input object 的调用方式 | 可比 bash argv 更丰富 |
| **Bash String Path** | `curl ...` / `ts-exec ...` 形式的兼容入口 | v1 只承诺极小子集 |
| **Localhost Illusion** | 模型以为自己能起一个 server 再测 `127.0.0.1` | v1 必须明确禁止 |

### 1.2 参考调查报告

- `context/just-bash/src/commands/curl/curl.ts` — 证明 `curl` 真正做深会非常宽，尤其是 headers/body/cookies/write-out 等行为（`177-240`）
- `context/just-bash/src/commands/js-exec/js-exec.ts` — 其脚本能力本质上是 Node-hosted，不适合作为 Worker-first baseline（`1-130`）
- `context/codex/codex-rs/tools/src/tool_registry_plan.rs` — richer structured tool path 应由 registry plan 控制，而不是临时放权（`67-184`）
- `context/claude-code/services/tools/toolExecution.ts` — network/script 这类高风险工具必须受 permission + hooks + telemetry 统筹（`126-131`, `173-245`）

**与 just-bash 的对齐结论**

- **明确吸收**：`curl`/script 走 opt-in/policy-first 思路，高风险能力必须进入治理主链。
- **明确拒绝**：沿用 just-bash 的 Node-heavy `js-exec` 心智、把 rich curl flags 直接等同于当前 Worker-first baseline、把“已注册命令”误写成“已具完整 handler”。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **fake bash 高风险能力收敛层**。
- 它服务于：
  1. LLM 侧“验证端点 / 运行分析脚本”的先验工作流
  2. `capability-runtime`
  3. future external worker seams
  4. policy / observability / inventory
- 它依赖：
  - `P7a-minimal-bash-search-and-workspace.md`
  - `A5-external-seam-closure.md`
  - `ServiceBindingTarget`
  - `FakeBashBridge`
- 它被谁依赖：
  - future browser / provider / fetch / tool-runner worker
  - deployment dry-run / smoke
  - capability inventory

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `Minimal Bash Search and Workspace` | Workspace -> Script | 强 | script 执行必须读写同一 workspace truth |
| `External Seam Closure` | Network/Script -> External | 强 | remote tool-runner worker 是后续自然升级口 |
| `Deployment Dry-Run` | Verification -> Network/Script | 强 | Phase 5 的 real-boundary smoke 会直接检验这些能力 |
| `Capability Runtime` | 双向 | 强 | registry/planner/executor/policy 都在这里 |
| `Storage & Context Evidence Closure` | Script -> Evidence | 中强 | script output / fetch result 可能 promoted 成 artifact |
| `Minimal Bash VCS and Policy` | Policy -> Surface | 中 | network/script 的 unsupported/risky law 需要同 inventory 口径 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Minimal Bash Network and Script` 是 **fake bash 的高风险能力护栏层**，负责 **把 `curl` 与 `ts-exec` 收敛为 policy-first、Worker-native 的最小 contract**，对上游提供 **足够让 LLM 做验证与分析的兼容入口**，对下游要求 **不再默认存在 localhost、package install、真实进程与 unrestricted egress 的幻想**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 完整 curl flags 矩阵 | just-bash curl | 当前 planner 根本不支持；过早承诺会直接撒谎 | 可能 |
| `python` / `python3` | just-bash | Worker-first v1 不应引入第二种脚本 runtime | 可能 |
| `node` / `js-exec` Node 兼容语义 | just-bash js-exec | Node 模块与 worker_threads 前提不成立 | 否 |
| localhost / 起服务再 curl | 本地 CLI 心智 | Worker agent 不应伪装成可开本地 daemon 的机器 | 否 |
| package install / dynamic dependency | `npm` / `pip` 工作流 | 已在 unsupported set 中，被宿主安全模型否定 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| `curl` structured input | capability input object | 先支持极小 URL-centric shape | method/headers/body/timeout |
| `ts-exec` structured input | capability input object | 先支持 inline code | module/files/argv/stdin |
| Remote script/network worker | `service-binding` target | seam 已存在 | dedicated tool-runner worker |
| Output promotion | artifact promotion | 大结果可转 artifact | chunked refs / prepared outputs |
| Browser-backed fetch | browser target / external seam | 不在 v1 | browser-rendering worker |

### 3.3 完全解耦点（哪里必须独立）

- **Bash string surface 与 structured capability path**
  - **解耦原因**：argv parser 目前很窄，不应阻塞 future richer contract。
  - **依赖边界**：bash string 先保守；structured path 可逐步变强，但必须记录 inventory 差异。

- **Network policy 与 transport implementation**
  - **解耦原因**：allow-list、private address block、timeout、egress class 是 policy，不是 fetch 细节。
  - **依赖边界**：local-ts 与 service-binding path 必须共享同一 policy verdict。

- **Script contract 与具体 sandbox**
  - **解耦原因**：Phase 7b 先冻结“可执行什么”而不是“用哪种 VM 实现”。
  - **依赖边界**：不论 in-process 还是 remote worker，都必须返回同一 result/error/progress 形状。

### 3.4 聚合点（哪里要刻意收敛）

- **所有 network/script command declarations 都进统一 registry**
- **所有 localhost/private-network 判断都进统一 policy guard**
- **所有大输出都遵守统一 artifact promotion 逻辑**
- **所有 supported/deferred/risky 结论都进入 capability inventory**

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：更偏本地进程 + 本地脚本 + 本地网络的默认心智。
- **亮点**：
  - 工作流自然
- **值得借鉴**：
  - LLM 真的需要 `curl` 与脚本分析这两类能力
- **不打算照抄的地方**：
  - 不照搬“我就是在一台机器里”的宿主假设

### 4.2 codex 的做法

- **实现概要**：更强调 registry-first tool surface 与 structured execution plan。
- **亮点**：
  - richer path 往往走结构化工具，而不是硬塞 bash flags
- **值得借鉴**：
  - 先冻结 handler kind / tool surface，再逐步扩张 argv
- **不打算照抄的地方**：
  - 不复制其本地 shell / unified exec / JS REPL 大矩阵

### 4.3 claude-code 的做法

- **实现概要**：工具执行面很成熟，permission/hook/telemetry 一体化。
- **亮点**：
  - 高风险工具一定进治理面
  - 大结果持久化成熟
- **值得借鉴**：
  - `curl` / script 这类能力的关键不是“能跑”，而是“有护栏、有证据”
- **不打算照抄的地方**：
  - 不复制其本地终端 / IDE 驱动模型

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| bash string 自由度 | 高 | 中 | 中 | 低到中 |
| structured tool path | 低 | 高 | 中高 | 高 |
| policy / permission 显式度 | 低 | 中高 | 高 | 高 |
| Worker/V8 适配度 | 低 | 低 | 低 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] Restricted `curl` contract**
  - 必须明确 v1 的 bash string path 只承诺极小 URL-centric 形态；richer options 应优先走 structured path。

- **[S2] Restricted `ts-exec` contract**
  - 必须明确 v1 只承诺受控 TS/JS analysis capability，不承诺 Node host compatibility。

- **[S3] Network/script policy guard**
  - 必须定义 allow-list、private/local address block、timeout、approval 与 output size guard。

- **[S4] Structured-path-first upgrade seam**
  - 必须允许 capability input 比 bash argv 更丰富，否则 Phase 7b 很难逐步进化。

- **[S5] Artifact-aware outputs**
  - 必须把大响应、大脚本输出与 artifact promotion 对齐，避免把大 blob 硬塞回上下文。

- **[S6] Remote upgrade seam**
  - 必须承认 service-binding target 是 future real implementation 的自然归宿。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] Python / CPython / notebook-like runtime**
- **[O2] Node module compatibility / child_process / package install**
- **[O3] localhost / `127.0.0.1` / background server assumptions**
- **[O4] browser automation / screenshot / DOM execution**
- **[O5] unrestricted curl flags / cookies / multipart / upload parity**

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `curl https://example.com` | in-scope | 这是最核心的 verification use case |
| `curl -X POST -H ... -d ...` | structured path in-scope，bash string out-of-scope 现状 | 当前 planner 根本没有 flags grammar |
| `ts-exec console.log(1)` | in-scope | 最小 inline analysis 形态 |
| `ts-exec script.ts arg1` | out-of-scope 现状 | 当前 planner 只会把 argv 拼成 code 字符串 |
| `python data.py` | out-of-scope | v1 不引入第二脚本宿主 |
| `npm install && node server.js && curl localhost` | out-of-scope | 这正是要明确禁止的本地机器幻觉 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **restricted curl** 而不是 **general shell network**
   - **为什么**：nano-agent 需要的是 verification capability，不是 unrestricted egress。
   - **我们接受的代价**：bash string 体验不如本地 CLI 自由。
   - **未来重评条件**：当 policy / audit / remote fetch worker 成熟后，可逐步放宽 structured path。

2. **取舍 2**：我们选择 **TS-only script baseline** 而不是 **TS + Python + Node 全家桶**
   - **为什么**：Worker-native v1 必须先减少 runtime 种类与安全面。
   - **我们接受的代价**：某些数据分析工作流需要迁移到 TS。
   - **未来重评条件**：只有当第二 runtime 有明确业务价值且能被完整治理时。

3. **取舍 3**：我们选择 **structured path 优先演进** 而不是 **先补 bash argv flags**
   - **为什么**：当前 planner 很窄，structured capability input 更符合 typed runtime 方向。
   - **我们接受的代价**：bash 兼容感会比本地 shell 弱。
   - **未来重评条件**：当命令注册、argv parser、tests 一起成熟时。

4. **取舍 4**：我们选择 **明确否定 localhost 幻觉** 而不是 **让模型自己试试再失败**
   - **为什么**：这类失败没有信息价值，只会浪费 token 和行动预算。
   - **我们接受的代价**：某些本地 CLI 习惯不能直接平移。
   - **未来重评条件**：除非未来引入可审计的 local loopback simulation；当前不考虑。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| `curl` 被误解为完整 curl | 只看命令名，不看 contract | 用户/模型期望失真 | inventory 中标注 restricted subset + bash/structured 差异 |
| `ts-exec` 被误解为 Node runtime | 受 just-bash / CLI 习惯影响 | 代码移植失败 | 明确写入“不是 Node host compatibility” |
| network/script outputs 过大 | 拉取大网页/大日志 | 污染上下文与 WS stream | 默认与 artifact promotion 对齐 |
| local-ts 与 remote path 行为漂移 | 后续补 service binding 时各写一套 | contract 分叉 | 先冻结 shared result/error/progress contract |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：终于能把 `curl` / `ts-exec` 从“想法”变成带边界的 contract。
- **对 nano-agent 的长期演进**：为 future remote tool-runner、browser worker、fetch policy 打底。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：稳定性提升最大，因为 network/script 是最容易越权和失真的能力。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Restricted Curl Contract | 冻结 curl 的最小 bash/structured 入口 | `curl` 不再是一个模糊口号 |
| F2 | Restricted TS-Exec Contract | 冻结脚本执行的最小能力面 | `ts-exec` 不再被误解成 Node/Python |
| F3 | Network & Script Policy Guard | 明确 approval / address / timeout / size / audit law | 高风险工具有统一护栏 |
| F4 | Structured Upgrade Seam | richer input 先走 typed capability path | 演进不被 argv parser 卡死 |
| F5 | Remote Implementation Seam | 与 service-binding target 对齐 | 未来接远端 worker 不推翻当前 contract |

### 7.2 详细阐述

#### F1: `Restricted Curl Contract`

- **输入**：`curl` declaration、planner、network handler、future fetch policy
- **输出**：curl minimal contract
- **主要调用者**：LLM verification path、hooks、smoke tests
- **核心逻辑**：
  - bash string path 先只承诺最小 `curl <url>`
  - richer method/headers/body 优先走 structured tool input
  - 默认仅允许 external allow-listed destinations
- **一句话收口目标**：✅ **`LLM 可以做最基本的端点验证，但不会被误导成拿到了完整网络终端`**

#### F2: `Restricted TS-Exec Contract`

- **输入**：`ts-exec` declaration、exec handler、future sandbox
- **输出**：脚本执行最小 contract
- **主要调用者**：数据分析、小型转换、workspace-local processing
- **核心逻辑**：
  - 先支持 inline code
  - 不承诺 Node built-ins / child_process / external install
  - 结果统一走 capability result / artifact promotion
  - sandbox 最低约束必须包括：默认无网络、无 Node built-ins、无 child process、明确 CPU/timeout/output 上限、workspace 访问只通过显式输入/bridge
  - 若 in-process 无法可靠执行这些限制，remote tool-runner worker 应成为默认实现路径，而不是继续宣称 local stub 足够
- **一句话收口目标**：✅ **`模型能运行受控分析脚本，但不会误以为自己拥有完整本地运行时`**

#### F3: `Network & Script Policy Guard`

- **输入**：policy gate、future fetch guard、observability
- **输出**：统一护栏
- **主要调用者**：executor、future remote worker、reviewers
- **核心逻辑**：
  - `ask` 默认保留给 network/script
  - block localhost / private destinations / unsafe schemes
  - enforce timeout / output size / audit logging
  - approval/policy 通过不等于能力已成熟；在真实 fetch/sandbox handler 接上之前，`curl` / `ts-exec` 仍必须在 inventory 中保持 Partial
- **一句话收口目标**：✅ **`高风险命令不是“跑了再说”，而是先有护栏再执行`**

#### F4: `Structured Upgrade Seam`

- **输入**：planner、tool call bridge、registry declarations
- **输出**：bash path 与 structured path 的双入口原则
- **主要调用者**：future command expansion、client tools、remote transport
- **核心逻辑**：
  - bash string 负责 LLM 兼容
  - structured input 负责 richer semantics
  - 二者都必须映射到同一个 capability name/result family
  - system prompt / tool docs 必须显式告知模型：bash path 只接受 `curl <url>` 与 `ts-exec <inline code>` 这类最小形态；method/headers/body/file-input 等 richer 语义一律走 structured path
- **一句话收口目标**：✅ **`未来扩张不需要通过“补更多 shell 语法”这条最脆弱的路`**

#### F5: `Remote Implementation Seam`

- **输入**：`ServiceBindingTarget`、external seam design
- **输出**：remote network/script worker contract
- **主要调用者**：future tool-runner worker、deployment dry-run
- **核心逻辑**：
  - progress/cancel/response contract 已存在
  - local-ts 只是 reference path
  - 真正接 fetch sandbox / script sandbox 时不应改 message family
- **一句话收口目标**：✅ **`实现可以从 local-ts 升到 remote worker，但 contract 不重写`**

### 7.3 非功能性要求

- **性能目标**：默认 timeout 必须短而明确，避免脚本/网络长时间悬挂。
- **可观测性要求**：network/script 执行必须可挂 trace，且能进入 evidence/inventory。
- **稳定性要求**：不允许 localhost、Node host、Python 等幻觉重新混进 prompt。
- **测试覆盖要求**：至少需要 restricted curl、restricted ts-exec、policy block、large-output promotion 四类 smoke。
- **兼容性要求**：bash string path 与 structured path 的差异必须出现在 inventory 与 prompt 中，不能靠模型自己猜 planner 边界。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nano-agent 当前代码

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `packages/capability-runtime/src/capabilities/network.ts:22-38` | curl stub | 当前 reality 必须诚实写入文档 | 尚未 connected |
| `packages/capability-runtime/src/capabilities/exec.ts:23-34` | ts-exec stub | 当前 reality 只到 contract/reserved seam | 尚未 sandboxed |
| `packages/capability-runtime/src/targets/service-binding.ts:40-191` | request/progress/cancel/response seam | future remote worker 的正确升级口 | 这是强资产 |

### 8.2 来自 just-bash

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/just-bash/src/commands/curl/curl.ts:177-240` | rich curl execution | 说明完整 curl 会非常宽，不能轻率承诺 | 我们只吸收 opt-in 思路 |
| `context/just-bash/src/commands/js-exec/js-exec.ts:1-130` | Node/worker_threads heavy js-exec | 反向证明它不适合作为 Worker-first baseline | 应明确避开 |

### 8.3 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/tools/src/tool_registry_plan.rs:67-184` | registry-first handler kind planning | richer script/network surface 应先通过 registry 扩张 | 比补 shell flags 更稳 |

### 8.4 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/services/tools/toolExecution.ts:173-245` | permission / hooks / telemetry woven into tool execution | 高风险工具必须进治理主链 | Phase 7b 直接受益 |
| `context/claude-code/utils/toolResultStorage.ts:130-199` | large tool result persistence | 大网页/大脚本输出不应硬塞 prompt | 与 artifact promotion 思路一致 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`Minimal Bash Network and Script` 是 fake bash 真正开始碰高风险边界的一层设计。它的价值不在于“终于也能跑 curl/python 了”，而在于把这两个最诱人的 CLI 幻觉重新解释成 Worker-native capability：受 policy 约束、受 artifact/evidence 约束、受 remote seam 约束。只要这个 contract 立住，后面再接真实 fetch sandbox、tool-runner worker、甚至 browser worker，系统都不会失真。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 这是 fake bash 从低风险走向真实可用的关键一步 |
| 第一版实现的性价比 | 4 | 约束较多，但能显著减少幻觉与越权 |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 4 | 尤其提升稳定性与可治理性 |
| 对开发者自己的日用友好度 | 4 | 不是最自由，但最诚实 |
| 风险可控程度 | 4 | 关键在于别把 stub 讲成 fully supported |
| **综合价值** | **4** | **应作为 Phase 7 的第二份高风险能力收敛文稿，但必须持续承认 `curl/ts-exec` 仍处于 Partial reality** |

### 9.3 下一步行动

- [ ] **决策确认**：确认 `curl` 的 richer options 是否明确只走 structured path，不通过 bash argv 扩张。
- [ ] **关联 Issue / PR**：补 restricted curl / ts-exec 的 smoke 与 policy block tests。
- [ ] **待深入调查的子问题**：
  - [ ] `ts-exec` 是否在 v1 就需要 stdin/file input，还是先只做 inline code
  - [ ] allow-list policy 由 local config、KV 还是 deploy profile 注入
- [ ] **需要更新的其他设计文档**：
  - `docs/design/after-skeleton/P5-deployment-dry-run-and-real-boundary-verification.md`
  - `docs/design/after-skeleton/PX-capability-inventory.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
