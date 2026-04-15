# nano-agent 价值主张与架构取舍分析

> 分析对象: `nano-agent`
> 分析时间: `2026-04-15`
> 分析者: `GPT-5.4`
> 参考材料:
> - `docs/investigation/claude-code-by-opus.md`
> - `docs/investigation/codex-by-opus.md`
> - `docs/investigation/mini-agent-by-opus.md`
> - `docs/investigation/claude-code-by-GPT.md`
> - `docs/investigation/codex-by-GPT.md`

---

## 1. 执行摘要

先给结论：**这套 nano-agent 方案值得做，但前提是明确把它定义为“Cloudflare-native 的持久化 agent runtime”，而不是“运行在 Worker 里的缩水版 Claude Code / Codex CLI”。**

你的 10 个选择整体上是**高度一致**的，它们共同指向一个非常清晰的产品方向：

1. **放弃传统本地 CLI / Linux 进程模型**
2. **拥抱 V8 isolate + Durable Object 的 actor/state 模型**
3. **把 shell、skill、context、hook 全部重写成“云原生、可治理、可恢复”的能力层**

这条路的最大价值，不在于“能不能 100% 模拟本地 agent CLI”，而在于：

- **零安装 / 可嵌入 / 可多租户 / 可持续连接**
- **状态和工具调用天然可持久化**
- **与 Cloudflare 自身服务形成系统级协同**
- **更适合产品化、平台化、服务化，而不只是本地黑盒终端工具**

它的最大风险也非常明确：

- **fake bash 如果做成“伪 Linux”，会变成一个高复杂度、低真实度、误导模型的陷阱**
- **128MB V8 isolate 会强迫你把上下文、文件、长任务、压缩、工具输出都做分层外置**
- **如果同时追求本地 CLI 的工具兼容度和 Worker 的云原生约束，工程上会两头失血**

所以，正确路线不是“复刻 Claude Code / Codex”，而是**提炼它们最值得继承的能力结构，再重组为 Worker-first 的新物种**。

---

## 2. 你的方案本质上在定义什么产品

这套组合不是一个普通 agent CLI。

它更像：

- **一个运行在 Durable Object 上的会话型 agent actor**
- **一个通过 WebSocket 与客户端持续同步状态、事件、工具流的实时代理**
- **一个把文件系统、skills、hooks、上下文压缩、工具执行外包给 Cloudflare 服务网格的 agent runtime**

如果 Claude Code 更像“Anthropic-first 的终端产品工作台”，Codex 更像“重工程化的 agent runtime platform”，mini-agent 更像“轻量教学级 agent 样板”，那么你这个 nano-agent 的潜在定位是：

> **Cloudflare-native、WebSocket-first、stateful、service-composable 的 agent runtime。**

这是一个不同生态位，不应以“谁更像 Linux CLI”来评判，而应以“谁更适合云端持续交互、状态治理、服务拼装”来评判。

---

## 3. 逐条分析你的 10 个设计选择

### 3.1 不工作在传统的 Linux 环境

**判断：赞成，而且应该彻底接受这个前提，而不是试图掩盖它。**

#### 为什么这样选

Claude Code 和 Codex 的大量能力都默认建立在本地 OS 假设之上：真实 shell、真实文件系统、真实进程、真实沙盒、真实权限升级、真实 TUI。那是一条“本地开发工具”的技术演化路线。

而你的目标不是把 agent 塞进 Linux 容器，而是放进 **Cloudflare Worker + V8 isolate + Durable Object**。这意味着：

- 没有传统进程树
- 没有真实 bash
- 没有 fork / thread / tty
- 没有本地磁盘意义上的长期 workspace
- 没有“安装一个二进制 CLI 就能跑”的假设

既然运行时范式已经完全不同，产品心智也应该不同。

#### Trade-off

你失去的是：

- 大量现成 CLI 工具和 shell 生态的直接复用
- 本地 agent CLI 的“所见即所得”兼容性
- 许多社区已有 prompt / tool 习惯的天然适配

你获得的是：

- 更强的可托管性
- 更统一的多租户隔离边界
- 更容易嵌入浏览器、SaaS、Web IDE、控制台、协作产品
- 更容易做账号体系、审计、计费、事件流和平台集成

#### 工程价值

工程上，这个选择会逼迫系统从一开始就采用**显式能力建模**，而不是偷偷依赖宿主机。这反而有利于长期维护，因为：

- 工具边界更清晰
- 状态迁移更可控
- 调试与回放更容易结构化
- 权限治理不再被 shell 和 OS 行为“暗中决定”

#### 业务价值

业务上，这一选择最大的价值是**把 agent 从“开发者本地工具”转成“可交付产品能力”**。这意味着：

- 更适合 SaaS 化
- 更适合与账号、组织、权限、审计体系结合
- 更适合在浏览器端、远程 IDE、协作工作台中直接使用

这不是“失去 Linux”，而是“换取产品化的宿主环境”。

---

### 3.2 运行在 V8 isolate 内

**判断：赞成，但必须承认它是“高约束换高部署价值”的选择。**

#### 为什么这样选

V8 isolate 的核心价值不是“更强”，而是：

- 启动快
- 部署轻
- 天然面向 Web runtime
- 与 Worker 平台能力原生兼容

对 nano-agent 来说，V8 isolate 的意义在于：你可以把 agent 变成一个**低延迟、可弹性伸缩、天然网络化**的服务，而不是一个必须绑定本地设备和本地终端的程序。

#### Trade-off

你付出的代价非常真实：

- 内存预算大约只有 128MB
- CPU 时间与生命周期受限
- 不能依赖本地线程 / 子进程 / 原生二进制
- 大工具输出和大上下文都必须外置
- TypeScript 运行、文件系统模拟、长任务延续都需要自己重建

这意味着 V8 isolate **不是传统 agent CLI 的“更好底座”**，而是一个完全不同的底座。

#### 工程价值

这个约束会强迫 nano-agent 形成非常健康的架构分层：

- 活跃工作集放内存
- 会话状态放 Durable Object
- 大对象与快照放 R2
- 共享配置与低频读取素材放 KV
- 长任务通过 continuation / wake-up 机制延续

这种架构比“全塞进单进程内存”更复杂，但也更适合可恢复与多端访问。

#### 业务价值

业务层面，V8 isolate 带来的不是性能神话，而是：

- 全球边缘部署能力
- 极低的接入门槛
- 更适合把 agent 作为平台功能输出
- 更适合高频、小会话、实时交互型产品

尤其在 Web IDE、在线文档助手、站内 agent、云端工作台等场景，这个选择有非常直接的商业价值。

---

### 3.3 提供类似 fake bash 的工具，确保 LLM 有足够工具可用

**判断：必须做，但千万不要做成“假装自己是完整 bash”。**

#### 为什么这样选

Claude Code、Codex、mini-agent 都证明了一件事：**LLM 需要一个足够通用的“操作表面”**。如果工具太碎，模型推理链会断；如果工具太抽象，模型不会用。

本地 CLI 里，这个通用表面通常就是 bash。

但在 Worker 里，真正值得做的不是 bash 模拟器，而是一个**LLM 友好的虚拟操作层**：

- 文件浏览
- 搜索
- diff / patch
- 目录遍历
- 文本处理
- 包/模块信息查询
- 受限命令执行
- 与外部服务的结构化调用

你可以让它“长得像 bash”，但本质应该是**能力路由器**，不是 POSIX 复刻。

#### Trade-off

如果做成 full bash 幻觉：

- 模型会假设存在真实进程、真实 PATH、真实包管理器
- 用户会期待 shell 兼容性
- 你会陷入 endless edge cases：管道、子 shell、环境变量、重定向、后台进程、TTY、SIGINT

如果做成虚拟 shell：

- 兼容性下降
- 需要 prompt / tool schema 设计得更明确
- 需要文档化什么能做、什么不能做

但换来的好处非常大：

- 所有命令都可观察、可审计、可治理
- 不会被宿主机状态污染
- 可以自然接入 hooks、approval、quotas、streaming
- 更容易把工具能力映射到 CF 内部服务

#### 工程价值

这个设计会成为 nano-agent 的中枢层。它让工具调用从“执行 shell 文本”变成“执行声明化能力”：

- 更容易做参数验证
- 更容易做限流和取消
- 更容易做结构化日志与工具回放
- 更容易把输出裁剪、摘要、分块并注入上下文

#### 业务价值

业务上，这意味着你可以把 nano-agent 安全地嵌进更多产品，而不是把一个危险的远程 shell 暴露给用户。

**最重要的判断：fake bash 应该是产品协议，不应该是兼容性承诺。**

---

### 3.4 V8 isolate 需要可以执行 ts 命令

**判断：值得做，但应该把“ts 命令”重新定义为“受约束的 TypeScript 能力”，而不是 Node CLI 等价物。**

#### 为什么这样选

在 Cloudflare 生态里，TypeScript/JavaScript 天然是第一语言。让 agent 在同一个语言域内做：

- snippet 执行
- 类型检查
- AST 变换
- 小型测试
- 工具逻辑扩展

是非常自然的。

这会让 nano-agent 在 Web 开发生态里拥有比传统 shell 更顺滑的能力面。

#### Trade-off

如果你承诺“可以执行 TS 命令”，用户会自动把它理解为：

- `ts-node`
- `tsx`
- `npm run`
- 依赖 Node API 的项目脚本

但 Worker/V8 isolate 并不等同于 Node。

因此真正合理的做法是：

- 提供 **`ts_eval`**
- 提供 **`ts_typecheck`**
- 提供 **`ts_transform`**
- 提供 **基于虚拟文件系统的模块执行**
- 明确标注 Web API / Worker API 与 Node API 的边界

#### 工程价值

这会让 nano-agent 的扩展能力更“原生”，因为：

- 工具逻辑可以直接复用 TS 生态
- skill / service / hook 的实现语言可以统一
- 更容易把“脚本能力”从 bash 迁移到更安全的受控执行模型

#### 业务价值

业务上，这是面向 Web 开发者非常强的卖点：

- 更像“在线可编程 agent”
- 更适合与前端项目、Worker 项目、边缘函数项目结合
- 更适合把 skill 扩展做成开发者平台能力

#### 关键提醒

**不要把它宣传成“支持 Node/TS CLI 完全兼容”。**

正确的说法应该是：

> nano-agent 提供 Worker-native 的 TypeScript 执行与变换能力。

这会少很多误解，也更符合真实能力边界。

---

### 3.5 agent 不存在 sub-agent，在 V8 isolate 里单线程运行

**判断：这是一个非常合理、而且我认为应该坚持的简化。**

#### 为什么这样选

Claude Code 和 Codex 的 sub-agent 都很强，但也都说明了一件事：**sub-agent 是高收益、高复杂度、高资源占用的能力。**

它们带来的问题包括：

- 上下文分叉与合并
- 状态同步
- 并发冲突
- 资源配额
- 权限继承
- 结果回归
- UI 可见性

在 Worker / DO / 128MB isolate 的前提下，显式 sub-agent 会把复杂度迅速拉爆。

单线程单 agent 反而符合你的底座特性：

- Durable Object 天然像 actor
- 单状态所有权更清晰
- 更适合事件流和 WebSocket 同步
- 更适合 continuation/resume

#### Trade-off

你失去的是：

- 并行拆解复杂任务的能力
- 那种“一次开很多子工人”的 wow factor
- 在大仓库复杂任务里的吞吐优势

你获得的是：

- 更简单的正确性模型
- 更稳定的成本预测
- 更容易调试、回放、审计
- 更少的上下文复制与 token 浪费

#### 工程价值

工程上，这能显著降低系统难度。你可以把复杂性转移到：

- hooks
- service binding
- 外部专用 worker
- context compaction service
- durable task queue

也就是说，不需要让 **LLM 可见的 sub-agent** 出现，也可以通过**系统层的外部协作服务**获得一部分并行收益。

#### 业务价值

业务上，这个选择带来的是：

- 更可解释
- 更可治理
- 更低推理成本
- 更适合企业场景的审计与配额控制

我会把这个判断概括成一句话：

> **你不是放弃了多 agent，而是把多 agent 的复杂性从“模型层”下沉到了“平台层”。**

这对 Worker runtime 是对的。

---

### 3.6 更强的上下文分层管理，并与外部服务结合

**判断：这是你的核心护城河之一，优先级应该非常高。**

#### 为什么这样选

128MB V8 isolate 不是“建议你做 context layering”，而是**逼着你必须做**。

Claude Code 最强的地方之一，是把 prompt cache、compact、micro-compact、session memory、cache break detection 做成一套体系。Codex 也把 compact、resume、rollout/state 做成了真正的基础设施。mini-agent 虽然轻，但也已经展示了“按 user 边界摘要”这种小而聪明的策略。

你的 nano-agent 如果想在 Workers 里成立，上下文必须至少分成：

1. **不可变层**：system prompt、基础 tool schema、全局规则
2. **会话层**：长期记忆、阶段摘要、目标约束
3. **工作层**：当前 turn、最近工具结果、当前文件窗口
4. **工件层**：长输出、长文件、日志、补充材料
5. **外部压缩层**：由其他 Worker/服务负责摘要、规整、裁剪

#### Trade-off

你付出的代价是：

- 系统架构更复杂
- 多一次或多次上下文装配与压缩延迟
- 需要处理“压缩后恢复”与“工具 schema 重新注入”问题

你获得的是：

- 更长的可持续会话
- 更低的 token 成本
- 更强的 resume / reconnect / cross-client continuity
- 更适合企业或平台场景的上下文治理

#### 工程价值

这会让 nano-agent 拥有真正区别于“把 prompt 直接塞给模型”的工程深度。

特别值得吸收的已有经验：

- 从 **Claude Code** 吸收“cache-aware context design”的思想
- 从 **Codex** 吸收“remote compact / rollout-state 分层”的思想
- 从 **mini-agent** 吸收“轻量但结构清晰的摘要边界设计”

#### 业务价值

业务上，这直接决定两件事：

1. **成本曲线**
2. **长会话体验**

如果做得好，用户会感觉这个 agent “记得住”“接得上”“不会越聊越笨”；如果做不好，128MB 和 token 上限会让它很快退化成一次性问答工具。

所以我会把它定义为：

> **nano-agent 最重要的不是 fake bash，而是 context operating system。**

---

### 3.7 提供更多、更精确的 hooks，并与不同 CF 服务结合

**判断：非常正确，而且这是你最应该从 Claude Code 身上吸收的能力之一。**

#### 为什么这样选

Claude Code 的强项不是单个 hook，而是**高密度生命周期事件 + 多来源注入 + 可阻断/可修改主流程**。这让它不只是“能调用工具”，而是“几乎整个 agent 行为都可插桩”。

在 nano-agent 里，hooks 的意义会更大，因为你不是运行在用户本机，而是运行在一个平台里。平台型 agent 的核心不是“能做什么”，而是：

- 谁可以在何时介入
- 谁可以读取/修改什么上下文
- 哪些行为可以被审计、转发、替换、增强

#### Trade-off

hook 系统一旦做深，会带来：

- API 稳定性压力
- 调试复杂度上升
- 行为可预测性下降
- 安全边界更难解释

但如果不做，nano-agent 就会失去最重要的产品化机会：**让客户端、组织规则、外部服务成为 agent 行为的一部分。**

#### 工程价值

这里建议你把 hooks 做成**强类型事件协议**，而不是模糊回调。优先级高的事件包括：

- `session.opened`
- `message.received`
- `context.assembled`
- `tool.planned`
- `tool.started`
- `tool.chunk`
- `tool.finished`
- `tool.denied`
- `context.compacting`
- `context.compacted`
- `skill.resolved`
- `skill.loaded`
- `approval.requested`
- `approval.resolved`
- `state.persisted`
- `socket.attached`
- `socket.detached`
- `agent.sleeping`
- `agent.woken`

这些事件一旦稳定下来，几乎整个产品生态就有了基础。

#### 业务价值

业务层面，hooks 可以直接变成：

- 企业审计能力
- 产品埋点与 A/B
- 计费与配额控制
- 第三方集成入口
- 自动摘要、自动合规、自动注释、自动监控等增值能力

这件事的意义远超“方便扩展”，它实际上在定义你的平台边界。

---

### 3.8 skill 注册更自由，不仅限于 md 文档，而是通过 service binding 做能力扩展

**判断：这是一个非常强的差异化方向，而且比单纯复制 skill 文档系统更有前途。**

#### 为什么这样选

Claude Code 和 Codex 都证明了：skill 不应该只是“静态 prompt 文本”。真正成熟的 skill 系统，最终会和：

- 工具
- hooks
- 权限
- 运行时资源
- 动态发现

发生耦合。

你要走得更远一步：**让 skill 不只是说明书，而是可绑定服务、可声明能力、可按需唤醒的远端能力单元。**

这非常适合 Cloudflare：

- service binding 天然是能力边界
- 每个 skill 可以映射到独立 Worker
- 可以按租户 / 组织 / 环境做技能装配
- 可以把重计算或专门能力移出主 isolate

#### Trade-off

这条路会引入新的系统问题：

- skill manifest 需要标准化
- skill 版本管理变复杂
- 调试链路跨服务
- 权限与信任边界必须显式化
- 网络往返与失败语义需要清晰定义

但它换来的不是“小扩展”，而是**生态级扩展能力**。

#### 工程价值

工程上，我建议 skill 至少具备以下元数据：

- 名称与描述
- 输入/输出 schema
- 依赖的工具/服务
- 可触发的 hooks
- 可见性与权限等级
- 缓存策略
- 是否可热加载
- 是否需要独立上下文层

换句话说，skill 应从 markdown 升级为 **capability manifest**。

#### 业务价值

业务上，这件事几乎就是未来的扩展市场：

- 内部团队技能库
- 客户专属 skill
- 付费增值能力
- 行业模板技能
- 第三方 partner extension

这也是 nano-agent 最容易形成平台型网络效应的地方。

---

### 3.9 使用 HTTPS + WebSocket，并以 WebSocket 作为主要 client 通信方式

**判断：强烈建议，这和 Durable Object 的模型天然契合。**

#### 为什么这样选

本地 CLI 的主通信方式是 stdin/stdout + TUI。你的 nano-agent 既然不在本地终端里，就需要一个新的主交互协议。

WebSocket 很适合承载：

- token streaming
- 工具输出流
- hook 事件流
- approval 交互
- session 状态更新
- reconnect / resume

而 Durable Object 恰好适合做：

- 连接归属
- 会话粘性
- actor 状态所有权
- 工具执行过程中的增量事件转发

#### Trade-off

你要承担的是：

- 客户端协议复杂度
- 断线重连语义
- backpressure
- 事件顺序与幂等
- 长连接运维与诊断

但这些复杂度本质上都是值得的，因为它们换来的是**真正的实时产品体验**。

#### 工程价值

WebSocket-first 会让系统天然以“事件”为中心，而不是“请求-响应”为中心。这很适合 agent，因为 agent 的运行过程本来就不是一次请求，而是一串状态变化：

- 收到输入
- 装配上下文
- 生成工具计划
- 执行工具
- 工具分块输出
- 触发审批
- 继续推理
- 写入持久化
- 通知客户端完成

如果你用纯 HTTPS，这些过程都会被打平。

#### 业务价值

业务上，WebSocket-first 直接提升：

- 用户感知速度
- 客户端可视化能力
- 多端同步能力
- 嵌入式产品体验

尤其对“在线 IDE / 浏览器工作台 / 协作面板”类产品，这是决定体验上限的基础设施选择。

---

### 3.10 利用 Durable Object 的特性，完成持续的工具调用

**判断：这是整个架构的基石，不只是一个附加点。**

#### 为什么这样选

Claude Code 和 Codex 最强的地方之一，都是它们有“会话持续性”和“多步任务延续性”。区别在于，它们大多建立在本地进程、TUI、线程或子 agent 上。

你的世界里，没有这些东西。那就必须让 **Durable Object 成为 agent 的 stateful orchestrator**：

- 持有当前会话状态
- 持有当前工具调用状态
- 维护等待中的 continuation
- 负责自我唤醒
- 在 WebSocket 与持久化之间桥接

#### Trade-off

你需要面对的挑战包括：

- 单 actor 热点
- 会话分片策略
- DO storage 的体积与访问模式限制
- 唤醒节奏设计
- 长工具调用的中断、恢复、重放

但这是唯一能把 Worker runtime 从“短请求函数”提升成“持续代理”的路径。

#### 工程价值

如果设计得好，Durable Object 能给你：

- 强状态所有权
- 简化的并发模型
- 天然的会话恢复点
- 更清晰的事件顺序
- 工具调用的 durable continuation

我会建议你明确区分：

- **DO storage**：热状态、会话元数据、待执行动作、游标、锁
- **R2**：大工件、长日志、文件快照、转录归档
- **KV**：共享配置、系统 prompt 版本、低频 skill 元数据、组织级参数

不要把 KV 当作高频状态库用；KV 更适合共享读取，不适合 turn-by-turn 的强一致会话状态。

#### 业务价值

这会直接带来很强的产品能力：

- 会话断开后还能继续
- 工具调用可以异步等待
- 用户可以离线回来继续看结果
- 可以做审计、回放、外部通知
- 可以做更复杂的审批与人工介入流程

从业务角度看，这会把 nano-agent 从“对话接口”提升为“持续执行单元”。

---

## 4. 对你这组选择的总体 trade-off 判断

### 4.1 你放弃了什么

这套方案明确放弃了本地 agent CLI 的三个典型优势：

1. **真实 shell 兼容性**
2. **子进程/多线程/多 agent 的本地高吞吐**
3. **与宿主机开发环境的天然贴合**

所以，nano-agent 不会是：

- 最适合跑本地大型 monorepo 的工具
- 最适合完全复用现有 shell 工作流的工具
- 最适合做“像人类开发者一样控制一台电脑”的工具

### 4.2 你换来了什么

但你换来的，是另一组传统 CLI 很难真正做到的特性：

1. **可托管**
2. **可嵌入**
3. **可持续连接**
4. **可恢复**
5. **可多租户治理**
6. **可与平台服务深度组合**

这使得 nano-agent 更适合被当作：

- 平台能力
- SaaS 内核
- Web 产品基础设施
- 企业工作流节点

而不仅仅是一个“更聪明的终端”。

### 4.3 为什么这组选择是自洽的

你的 10 个点并不是零散想法，而是一个高度一致的架构主张：

- 不要 Linux
- 不要真实 bash
- 不要 sub-agent
- 不要本地进程模型
- 要 DO
- 要 WebSocket
- 要 service binding
- 要分层上下文
- 要强 hooks
- 要技能即能力

这套组合的本质就是：

> **把 agent 从本地工具重写为云原生状态机。**

这在工程和产品上都是成立的。

---

## 5. nano-agent 可以从 3 组 agent CLI 吸收什么

### 5.1 从 Claude Code 吸收什么

Claude Code 最值得吸收的，不是它的 TUI，也不是它的 Anthropic 专属接口，而是它的**能力组织方式**。

#### 应该吸收

1. **把上下文与缓存当一等公民**
   - prompt cache awareness
   - compact boundary
   - 压缩后的恢复与重建
   - cache break detection 这类“上下文基础设施意识”

2. **高密度 hooks 体系**
   - 生命周期事件足够细
   - hook 不只是日志，而是能阻断、注入、重写流程

3. **Skill 的渐进式披露与条件激活**
   - skill 不应一次性全灌进 prompt
   - skill 应能按场景、按路径、按状态动态装配

4. **权限模式的人类心智设计**
   - 用户理解的是“plan / edit / bypass”，不是内部状态机
   - 这个 UX 心智可以迁移到 WebSocket 客户端协议和审批系统

#### 应该变形吸收

1. **sub-agent / swarm**
   - Claude 的多 agent 很强，但 nano-agent 应把这类能力下沉为平台层服务，不宜直接暴露成同类模型

2. **Plan Mode**
   - 可以保留“执行前规划”这个思想
   - 但不必复制其多 agent 访谈式实现

3. **skill -> hook 联动**
   - 非常值得保留
   - 但应通过 service binding + manifest 来做，而不是沿用本地文件发现模型

#### 不应照搬

- TUI-first 思路
- Anthropic-first 的 provider 结构
- 依赖本地 sandbox 的安全假设

### 5.2 从 Codex 吸收什么

Codex 最值得吸收的，是它把 agent 做成了**运行时平台**，而不是一串 prompt。

#### 应该吸收

1. **runtime platform 心态**
   - rollout/state 双层持久化
   - 工具事件结构化
   - 会话恢复、回放、可查询元数据

2. **工具系统的工程化**
   - 工具 schema 统一
   - 调度、取消、审批、并发门控、输出回灌都有明确链路

3. **权限治理链**
   - policy
   - approval
   - session 级缓存
   - 审计与回放

4. **远端 compact / app-server / WebSocket 思维**
   - 这些与 Worker runtime 非常相容

#### 应该变形吸收

1. **sub-agent thread tree**
   - 其“持久化线程树与结果回归”思想值得学
   - 但应转换为 Durable Object + 外部任务/服务编排，不必保留模型可见的子 agent 树

2. **Guardian/secondary decision service**
   - 可以转化为单独的 policy worker / compliance worker / classifier service

3. **tool_search / 动态工具发现**
   - 可以变成 service binding registry + capability directory

#### 不应照搬

- 对真实 Linux/macOS/Windows 沙盒的工程投入
- 全量 bash / local OS 执行模型
- OpenAI Responses API 中心化的 provider 绑定

### 5.3 从 mini-agent 吸收什么

mini-agent 最值得吸收的，不是功能面，而是**克制**。

#### 应该吸收

1. **单 agent、单循环、可读性强的核心结构**
2. **轻量但聪明的上下文摘要边界**
3. **“桥接”意识**
   - 它把自己暴露成 ACP server，这种“把 agent 做成可被别的产品调用的能力”的思路非常值得保留

4. **避免过度工程**
   - 对 nano-agent 来说，这一点尤其重要，因为 Worker 架构本身已经够复杂了

#### 应该变形吸收

1. **skill 路径重写**
   - 可转化为 skill/service manifest 中的资源定位重写

2. **极简工具集合**
   - nano-agent 早期版本也应该优先保证“少量工具真实可用”，而不是“很多工具名义上支持”

#### 不应照搬

- 无权限治理
- 无 hooks
- 无持久化
- 无恢复
- 无平台化能力

### 5.4 综合吸收后的“正确组合”

我认为最合理的吸收组合是：

- **从 Claude Code 吸收：**
  - 上下文层级意识
  - cache-aware 设计
  - hooks / skills 的协同
  - approval 的产品化语义

- **从 Codex 吸收：**
  - runtime platform 心态
  - 持久化 / 回放 / 状态数据库意识
  - 结构化工具执行链
  - WebSocket / app-server / durable session 思维

- **从 mini-agent 吸收：**
  - 单 agent 核心循环的克制
  - 面向集成的桥接思维
  - 少而真的工具哲学

而最不该吸收的是：

- 把 Linux shell 当作 runtime 真相
- 把 sub-agent 当作早期必须能力
- 把 TUI 当作产品中心

---

## 6. 对 nano-agent 的全局价值评定

### 6.1 工程价值

这套 nano-agent 的工程价值非常高，因为它不是重复已有 CLI，而是在几个关键点上重新定义 agent runtime：

1. **从进程模型转向 actor 模型**
2. **从本地 shell 转向声明化工具层**
3. **从单机内存上下文转向分层外置上下文**
4. **从静态 skill 文本转向 service-composable capability**
5. **从一次性请求转向持续 WebSocket 会话**

这几项一旦做成，nano-agent 会拥有很强的架构辨识度。

### 6.2 业务价值

它的业务价值并不在“替代本地 CLI”，而在于：

- 为 Web 产品提供原生 agent runtime
- 为在线 IDE/编辑器提供实时代理能力
- 为企业工作流提供可审计、可恢复、可扩展的 agent 节点
- 为 Cloudflare 生态提供一个天然的 agent 集成层

如果定位清晰，它甚至更接近：

- agent platform
- embedded agent backend
- cloud-native automation runtime

而不只是“命令行助手”。

### 6.3 最强卖点

我认为 nano-agent 潜在最强的三个卖点是：

1. **Cloudflare-native**
   - DO / KV / R2 / service binding / WebSocket 不是外挂，而是系统骨架

2. **持久化与连接连续性**
   - 用户断线、客户端切换、长工具调用、异步审批都能成立

3. **skill/hook/service 一体化**
   - 这会让 nano-agent 比普通 CLI 更像一个可编排平台

### 6.4 最大工程风险

风险最大的不是模型，不是 UI，而是下面三点：

1. **fake bash 过度承诺**
   - 如果想兼容真实 shell，会进入无底洞

2. **存储分层不清**
   - 如果把 KV、DO、R2 的职责混在一起，系统会很快变得昂贵且难以预测

3. **上下文系统做浅了**
   - 128MB isolate 下，context layering 不是 nice-to-have，而是生死线

### 6.5 最佳应用场景

这套 nano-agent 最适合：

- Web IDE / 在线代码工作台
- 浏览器中的智能编程助手
- 平台型“会话式工具代理”
- 需要强审计与状态恢复的企业场景
- 与 CF 其他服务深度联动的自动化流程

它不最适合：

- 直接替代本地 Codex / Claude Code 做重度本地仓库修改
- 依赖大量系统命令和本地包管理器的任务
- 强依赖并行 sub-agent 的超复杂拆解任务

---

## 7. 最关键的实现原则

如果要让这套方案真正成立，我认为必须守住以下原则。

### 7.1 把 fake bash 设计成“虚拟能力协议”，不要设计成 shell 模拟器

这是最重要的一条。

### 7.2 把 Durable Object 设计成会话 actor，而不是普通状态缓存

它应该拥有：

- 当前 turn 状态
- 工具 continuation
- socket 连接关系
- 审批等待点
- 自唤醒逻辑

### 7.3 把上下文系统设计成核心产品，而不是内部实现细节

要有：

- 分层
- 压缩
- 恢复
- 大对象外置
- cache-aware 设计

### 7.4 把 skill 升级为 capability manifest

skill 不只是 md 文本；它应该可以绑定：

- 提示片段
- 工具权限
- service binding
- hooks
- 输入输出 schema
- 生命周期策略

### 7.5 把 hooks 设计成稳定事件协议

只有这样，客户端、平台服务、企业扩展、审计系统才能长期围绕它生长。

---

## 8. 最终 verdict

**最终 verdict：我认为这套 nano-agent 方案不仅成立，而且有明确的独特价值；但它成功的前提，是你坚定地把它做成“Cloudflare-native 的 agent runtime”，而不是试图在 Worker 里假装自己还是一个本地 Linux CLI。**

我的最终判断是：

- **方向正确性：高**
- **架构自洽性：高**
- **工程难度：高**
- **产品差异化：很高**
- **替代传统本地 agent CLI 的能力：中低**
- **成为新型云端 agent 平台的潜力：高**

一句话总结：

> **Claude Code 强在产品化终端工作台，Codex 强在工程化 agent runtime，mini-agent 强在极简可读样板；而你这套 nano-agent，如果做对，会成为“Cloudflare 上的持久化、可嵌入、可编排、可治理的 agent actor”。**

这条路不是最轻松的，但它是**有新价值、且不是简单跟随者**的一条路。
