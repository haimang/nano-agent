# nano-agent

> 一个运行在 **Cloudflare Workers / Durable Objects** 上的、**WebSocket-first**、**stateful**、**Cloudflare-native** 的 agent runtime。

这是 nano-agent 的初期宣言。

它不是最终版文档，也不是完整规格书，而是项目开始前对“我们要做什么、不做什么、为什么这样做”的第一次公开定义。随着开发推进，这份 README 会持续被修改、补充、收敛。

---

## 1. 项目的总体说明

nano-agent 不是一个传统意义上的本地 Agent CLI。

我们不准备把 Claude Code、Codex、或其他本地开发代理，原样搬进一个缩小版的 Linux 容器里；我们要做的是一个**完全不同宿主环境里的 agent runtime**：

- 运行在 **Cloudflare Workers 的 V8 isolate** 中
- 以 **Durable Object** 作为会话 actor 与状态中枢
- 以 **WebSocket** 作为主要客户端通信方式
- 以 **KV / R2 / Service Binding** 作为上下文、文件、技能、压缩、扩展能力的外部系统支撑

这个项目的出发点非常明确：

> **我们不是想把“本地 shell agent”搬上云，而是想做一个对 LLM 足够友好、对平台足够可治理、对产品足够可嵌入的云原生 agent。**

这也意味着，nano-agent 会主动接受一些反直觉的前提：

- 没有传统 Linux 进程模型
- 没有真实 bash
- 没有真实本地文件系统
- 没有 sub-agent 树式并行执行作为早期核心

但与此同时，我们也不会假装 LLM 没有既有工作流先验。

LLM 被训练成天然期待：

- bash
- grep / rg / cat / curl
- 文件读写
- 临时脚本执行
- git 风格的工作流

所以 nano-agent 会提供一个 **bash-shaped compatibility surface**，但其内部实现将是一个 **typed capability runtime**。  
也就是说：**对模型保留熟悉的操作形状，对系统内部坚持强类型、可治理、可恢复、可组合的云原生能力边界。**

---

## 2. Credit：我们吸收的经验来源

nano-agent 不是从真空里长出来的。

我们明确受到了下面这些项目与分析工作的启发：

| 来源 | 我们吸收什么 |
|---|---|
| **Claude Code** | prompt cache 意识、hooks 密度、skills 与 agent 能力的协同、长期产品化的终端代理心智 |
| **Codex CLI** | runtime platform 思维、结构化工具调用链、durable session / rollout / state 的工程化方法 |
| **mini-agent** | 单 agent 核心循环的克制、最小可用结构、桥接型 agent 的清晰性 |
| **just-bash** | fake bash / virtual FS / command registry / secure fetch / AST-first shell runtime 的设计思路 |
| **Cloudflare 平台能力** | Workers、Durable Objects、KV、R2、Service Bindings、Browser Rendering、边缘部署模型 |
| **已有分析文档** | 我们在 `docs/` 中沉淀的价值主张分析、fake bash 分析，以及对主流 agent CLI 的结构化对标结论 |

如果要更具体地说，我们对这些来源的态度不是“复制”，而是：

> **吸收成熟经验，拒绝错误宿主假设；复用思想，不复刻形态。**

---

## 3. 技术栈

当前阶段，nano-agent 的预期技术栈如下。

| 维度 | 预期选型 |
|---|---|
| **核心运行时** | Cloudflare Workers (V8 isolate) |
| **状态中枢** | Durable Objects |
| **主要通信协议** | HTTPS + WebSocket（以 WebSocket 为主） |
| **持久化层** | Durable Object storage / KV / R2（按热状态、共享配置、大对象分层） |
| **核心语言** | TypeScript |
| **Agent 能力层** | 声明式 tool registry + fake bash compatibility surface + typed capability runtime |
| **文件系统模型** | Virtual FS / mount-based workspace / memory-first + durable-backed persistence |
| **网络能力** | allow-list / policy-driven fetch，优先映射到 Cloudflare 原生能力 |
| **浏览器能力** | Cloudflare Browser Rendering 或同类远端浏览器服务 |
| **上下文系统** | 分层上下文装配、压缩、摘要、恢复、外部服务协同 |
| **扩展方式** | service binding 驱动的 skills / hooks / capability manifests |
| **版本工作流** | virtual git subset（而不是完整 Git 实现） |

我们不认为“技术栈越像传统 CLI 越正确”。  
恰恰相反，nano-agent 的技术栈之所以成立，正是因为它与本地 Agent CLI 有本质差异。

---

## 4. 价值组合：我们不想重新造轮子，我们想做个不一样的东西

### 4.1 我们的观点

我们的核心观点有三条。

#### 1. Agent 的宿主环境决定了它的产品形态

Claude Code 和 Codex 之所以强，不只是因为模型强，而是因为它们站在：

- 本地终端
- 本地文件系统
- 本地进程
- 本地沙盒

这些宿主假设上构建能力。

而 nano-agent 从一开始就不在那个世界里。  
它的宿主环境是：

- Workers
- Durable Objects
- WebSocket
- Cloudflare 服务网格

所以它不该被定义成“缩水版本地 CLI”，而该被定义成：

> **Cloudflare-native 的持久化 agent runtime。**

#### 2. LLM 的工作流先验不能被简单抹掉

LLM 不会天然理解“我现在在一个 V8 isolate + DO + KV + R2 的系统里”。  
LLM 天然会期待 shell、文件、搜索、curl、git。

所以我们不会强迫模型学习一个完全陌生的新世界，而是提供一个**兼容层**：

- fake bash
- virtual FS
- virtual git subset
- worker-native TS execution

但这层兼容的目的不是伪造 Linux，而是**吸收 LLM 已有先验，降低使用摩擦**。

#### 3. 我们的目标不是“功能最多”，而是“组合方式不同”

我们不打算和本地 Agent CLI 拼：

- 谁更像真实 bash
- 谁命令更多
- 谁能起更多子进程

我们更关心的是：

- 会话是否可持续
- 状态是否可恢复
- 系统是否可治理
- 技能是否可服务化扩展
- agent 是否能自然嵌入 Web 产品和云端工作流

### 4.2 我们主动选择的 trade-off

下面这些，不是被动妥协，而是主动选择。

| 我们主动选择 | 我们放弃什么 | 我们换来什么 |
|---|---|---|
| **不以 Linux 为宿主真相** | 真实 shell / 真实本地环境兼容性 | 可托管、可嵌入、可多租户、可平台化 |
| **运行在 V8 isolate** | 大内存、子进程、线程、原生二进制 | 低启动成本、边缘部署、天然 Web runtime |
| **单 agent、单线程为早期核心** | 显式 sub-agent 并行编排能力 | 更简单的正确性模型、更稳定的成本与状态管理 |
| **用 fake bash 作为兼容层，而非系统内核** | 完整 POSIX 幻觉 | 对 LLM 友好，同时保持内部强类型能力边界 |
| **将 skill 做成 service-composable capability** | 纯 markdown skill 的简单性 | 更强扩展性、更适合平台生态与远端能力装配 |
| **上下文分层并外部化** | 单进程里“一把梭”式上下文管理 | 更强恢复能力、更好成本控制、更适合长会话 |
| **以 WebSocket 为主通信协议** | 简单的 request-response 模型 | 更好的流式体验、事件驱动、持续连接与重连语义 |
| **virtual git subset 而不是完整 Git** | 完整 Git 兼容 | 满足 LLM 工作流的关键心智，同时控制复杂度 |

### 4.3 我们不想重新造的轮子

我们不想重新发明：

- prompt cache / compact / context layering 的基本思想
- tool registry / approval / policy / state replay 的工程套路
- fake bash / virtual FS / secure fetch 的已知模式

但我们也不想把这些轮子原样装到错误的车上。

我们的目标是：

> **站在已有 agent CLI 的经验之上，做一个宿主环境不同、产品边界不同、价值组合不同的新系统。**

---

## 5. 我们预期的 value 对比

下面这张表不是“今天已经做到什么”，而是 **nano-agent 的预期价值定位**。

| 维度 | 传统本地 Agent CLI | nano-agent 预期定位 |
|---|---|---|
| **宿主环境** | 本地终端 / 本地 OS | Cloudflare Workers / Durable Objects |
| **部署方式** | 安装 CLI、本机运行 | 云端托管、边缘部署、零安装接入 |
| **状态模型** | 进程内会话为主 | actor-style durable session |
| **交互模型** | TUI / stdin/stdout | WebSocket-first 实时事件流 |
| **文件系统** | 真实本地 FS | virtual FS + durable-backed mounts |
| **shell 能力** | 真实 bash / system shell | fake bash compatibility surface |
| **工具执行** | 真实进程 / 本地命令 | typed capability runtime / service binding |
| **上下文管理** | 本地内存 + 压缩 | 分层上下文 + 外部服务协同 |
| **扩展模型** | 本地插件 / skill / MCP | service-composable skills / hooks / bindings |
| **浏览器能力** | 本地浏览器自动化或无 | 可直接接远端浏览器服务 |
| **版本工作流** | 完整 Git | virtual git subset |
| **可恢复性** | 视实现而定 | 设计上将恢复、重连、持久化作为一等能力 |
| **适用产品形态** | 开发者本地助手 | 嵌入式 agent backend / 平台能力 / Web 工作台 |

再换一种看法：

| 对标对象 | 他们最强的地方 | nano-agent 不复制什么 | nano-agent 想吸收什么 |
|---|---|---|---|
| **Claude Code** | 产品化终端代理、hooks、skills、cache-aware context | 不复制其 TUI-first、本地终端宿主 | 吸收 hooks / skills / context engineering 思想 |
| **Codex CLI** | runtime platform、durable state、结构化工具链 | 不复制其 OS sandbox / 本地进程模型 | 吸收 stateful runtime / policy / replay 思想 |
| **mini-agent** | 极简、可读、单 agent 核心循环 | 不复制其轻安全、轻持久化边界 | 吸收“小而清晰”的系统克制 |
| **just-bash** | fake bash、virtual FS、secure fetch | 不复制其 Node-hosted shell 运行时假设 | 吸收 bash compatibility surface 的设计方法 |

---

## 6. 结语和评价

nano-agent 的价值，不在于“比已有本地 Agent CLI 更像一个终端”，而在于：

- 它更像一个**云原生的 agent actor**
- 一个**可以持续连接、持续执行、持续恢复**的 runtime
- 一个**对 LLM 友好、对平台可治理、对产品可嵌入**的能力层

这条路并不轻松。

它的难点很明确：

- 需要在 Worker 的强约束下重建 agent 运行时
- 需要用 fake bash 吸收 LLM 先验，但又不能掉进“伪 Linux”陷阱
- 需要把 context、filesystem、skills、hooks、git workflow 都重新定义成云原生能力

但也正因为如此，它值得做。

如果 Claude Code 更像一个成熟终端产品，Codex 更像一个工程化 runtime，mini-agent 更像一个清晰的教学样本，那么 nano-agent 想成为的是：

> **Cloudflare 上的 virtual work shell + durable agent runtime。**

这不是一条“更小、更像、更兼容”的路线。  
这是一个**不同价值组合**的项目。

而这份 README，只是这个项目第一次把自己的立场说清楚。
