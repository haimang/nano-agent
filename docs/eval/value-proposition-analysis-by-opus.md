# Nano-Agent 价值主张与运行环境选型分析

> 分析对象: `nano-agent` 在 Cloudflare Workers / Durable Objects 运行时上的 10 条设计主张
> 分析日期: `2026-04-15`
> 分析者: `Claude Opus 4.6 (1M context)`
> 对标项目: `mini-agent`、`codex`、`claude-code`（见 `docs/investigation/`）
> 文档状态: `draft`

---

## 0. 背景与问题声明

nano-agent 的目标不是"再写一个 Claude Code"，而是借 mini-agent / codex / claude-code 三家的长处，造一个**专门为我们自己量身的 agent CLI**，并在**上下文管理 / Skill / 稳定性**三个方向上做针对性深耕。

用户提出的十条设计主张，实际上不是十个独立决策，而是一个**从运行时根基开始的系统性重构**——它把 nano-agent 从"跑在本地 Linux 的 CLI 工具"彻底改写为"跑在 Cloudflare Worker V8 isolate 里的分布式 agent 服务"。这是一个**范式级**的选择，必须被当作范式来分析，而不是被拆成十个独立 feature 讨论。

本文的任务是：

1. 逐条对这十条主张做**可行性 + 工程代价**评估；
2. 把它们组合起来做**核心 tradeoff 辩证**；
3. 与三家代表 agent 的做法**对标**，回答"我们能吸收什么、必须放弃什么"；
4. 给出全局 **value verdict**。

---

## 1. 逐条分析十条设计主张

> 每条用统一结构：**(A) 主张还原 → (B) 技术事实核对 → (C) 工程代价 → (D) 评级 + 判断**。

### 1.1 主张 ①：不在传统 Linux 环境工作

#### A. 主张还原

nano-agent 从一开始就**不以 Linux 进程**作为运行模型。没有 fork、没有 /bin/bash、没有 POSIX 文件系统、没有 signal 语义、没有 SIGTERM → SIGKILL 的 shell 生命周期管理。

#### B. 技术事实

Cloudflare Worker 运行在 V8 isolate 里，Node.js 的 `child_process`、`fs`、`os`、`cluster`、`worker_threads`、`net.createServer` 等模块**全部不可用**或只有极窄子集。Workers 的 runtime 叫 `workerd`，它提供 Web 标准 API (fetch / Request / Response / ReadableStream / WebSocket / crypto.subtle)，加上 CF 扩展 (KV / R2 / D1 / DO / Queue / AI / Service Bindings)，仅此而已。

#### C. 工程代价

- **失去的**：(1) 任何"直接 shell out 到外部命令"的能力；(2) 原生文件系统路径语义；(3) POSIX 进程模型熟悉感；(4) 大量成熟的 Node.js npm 包（凡是依赖 `fs` / `child_process` / native binding 的都跑不了）。
- **替代品**：(1) 服务绑定 (service binding) 调别的 worker；(2) R2 作对象存储；(3) DO storage 作有序 KV；(4) 依靠 fetch 语义实现"网络即文件系统"。
- **关键认知转变**：agent 的原子操作从"**进程 + 文件**"变成"**请求 + 对象**"。这改变了一切 tool 的实现方式，但并不意味着能力缩减——只是重新映射。

#### D. 评级与判断

**评级**：⭐⭐⭐⭐⭐（结构性决策，方向正确）

这不是"代价"，而是**主动选择一个更适合 agent 的世界模型**。传统 agent CLI 把 LLM 当成"在本机帮我敲 bash"的助手，这导致沙盒、权限、文件并发、进程泄漏等一系列源自 Unix 遗产的工程负担。离开这个遗产，agent 反而能变得更纯粹。**这一条是整个方案的锚点**，后续九条都是从这里派生的。

---

### 1.2 主张 ②：运行在 V8 isolate 内（~128MB）

#### A. 主张还原

nano-agent 的单次会话（或持续会话）全部在一个 V8 isolate 内执行。

#### B. 技术事实

- **内存**：Workers 的软上限是 **128MB**（paid plan 更高，但 128MB 是规划基准）。
- **CPU 时间**：Workers free/paid 的 **CPU time** 分别为 10ms / 30s，但如果挂在 **Durable Object** 里，可以通过 WebSocket hibernation 与 alarm 组合把"墙钟时间"拉长到小时级；**CPU 时间**才是受约束的核心指标。
- **冷启动**：V8 isolate 冷启动通常 < 5ms，是所有无服务器平台里最快的。
- **单线程**：isolate 是单线程的；异步走 micro-task 与 event loop，没有 Web Worker 里的真并行。

#### C. 工程代价

- **128MB 是 agent 的紧约束**：LLM 的单轮请求体（含上下文 + 工具 schema）可以轻松超过 10MB；如果不做上下文分层，会话跑十几轮就逼近物理上限。
- **CPU 时间是另一个紧约束**：纯 I/O（等 LLM 响应、等 R2、等 KV）**不计入** CPU 时间；但任何 CPU 密集操作（正则、tokenize、JSON 序列化大对象）都算。这意味着 **tiktoken 这类本地 tokenizer 要谨慎用**——对长历史跑一次 tokenize 可能吃掉几百毫秒 CPU 预算。
- **无多进程/多线程**：任何 "并行 tool 调用" 都只能通过 `Promise.all` 在同一 isolate 里交错 I/O，真 CPU 并行要拆成多个 worker。

#### D. 评级与判断

**评级**：⭐⭐⭐⭐☆（正确但需要刻意工程化）

128MB 是**强约束**，但它强迫你把上下文管理从"能塞就塞"转向"分层 + 外推"，这恰好对齐了 nano-agent 的三大深耕方向之一。选择这个约束的回报是**零冷启动 + 全球边缘部署**——对"我自己用"的定位是奢侈的加成。但必须承认：如果未来想把 nano-agent 开放给团队使用，需要一套严肃的**内存预算**与**CPU 时间预算**文化，否则 OOM/超时 是常态。

---

### 1.3 主张 ③：提供 "fake bash" 工具让 LLM 拿到足够的能力

#### A. 主张还原

用一个命令路由器伪装成 bash，把 LLM 请求的 shell 命令映射到 worker 内部实现。

#### B. 技术事实

在 Worker 里"跑 bash"物理上不可能，但**路由器模式是成立的**：
```
LLM 请求 `ls src/`
  ↓
fakeBash("ls src/")
  ↓
解析 → 调用 r2.list({ prefix: "src/" })
  ↓
把结果格式化成 "ls" 风格的字符串
  ↓
返回给 LLM
```
这其实比真 bash 更安全——每一条被 LLM 请求的"命令"都经过你的**显式路由表**，无法 `rm -rf /`，无法 `curl` 到未授权域名，无法 fork bomb。

#### C. 工程代价

- **实现面要多大？** 核心 15 条命令（ls/cat/grep/find/head/tail/wc/echo/pwd/cd/mkdir/mv/cp/rm/touch）就能覆盖 90% 的 LLM 需求。超出这个范围的命令（git / npm / python / …）需要**另一套 dispatcher**：走 service binding 到专用 worker。
- **LLM 能不能接受"假 bash"？** 能。只要 tool description 里**诚实地说**"这是一个受限的虚拟 shell，支持以下子命令"，LLM 会自适应。反而如果假装成完整 bash，LLM 会试用不支持的命令浪费 turn。
- **语法层面**：支持 `|` 管道、`>` 重定向、`&&` / `||` 串接，就能让 LLM 写出 80% 自然的命令；不支持子 shell `$(...)`、不支持 for 循环、不支持变量。

#### D. 评级与判断

**评级**：⭐⭐⭐⭐⭐（设计上优雅，是 nano-agent 独特的一笔）

"fake bash" 不是降级方案，是**更严格的 agent 交互界面**——它把"LLM 可以做什么"的答案变成了一份**可审计的命令清单**，而不是 Unix 遗产。每加一个子命令都是一次明确的 scope 扩张，每一次扩张都经过设计。这种"主动限制"对一个自用工具来说是**好事**。建议：将 fakeBash 与 §1.8 的 skill/service binding 打通，让 skill 可以声明"我提供 `gitx` 子命令"，由 fakeBash 在运行时 dispatch。

---

### 1.4 主张 ④：V8 isolate 需要可以执行 TS 命令

#### A. 主张还原

允许 agent 在 isolate 内执行（LLM 生成的）TypeScript 代码作为一种工具能力。

#### B. 技术事实

这条最危险，也最容易被误解。有三种截然不同的实现路径：

1. **同 isolate eval**：在当前 worker 里 `eval(code)` 或 `new Function(code)`。
   - **问题**：与 nano-agent 本体共享全局对象、共享 fetch 权限、共享 KV/R2/DO 绑定。LLM 一旦产出带后门的代码就能把整个 agent 的凭证 exfil。**不可接受**。
2. **Service binding 到"执行 worker"**：把 TS 代码发到一个**独立的、最小权限的 worker**去跑，它只有一个固定的输出 API，不绑定任何敏感资源。
   - **优点**：强隔离（跨 isolate），出错不污染主 agent。
   - **代价**：冷启动 + 一次 network hop（几 ms），外加那个 worker 自己也跑不了 TS 编译，所以要么用 `new Function` + esbuild 产出 CJS，要么只接受 JS。
3. **内嵌 QuickJS / JavaScript sandbox**：在主 isolate 里跑一个嵌入式 JS 引擎（通过 WASM），LLM 代码完全跑在这个二级引擎里，拿不到外层 worker 的任何绑定。
   - **优点**：最强隔离，不需要额外的 worker。
   - **代价**：QuickJS 的 WASM 二进制 ~500KB+，性能比原生 V8 慢一个数量级，内存占用吃 128MB 预算。

#### C. 工程代价

真正能"执行 TS"的最干净方案是 **Service Binding + 编译层**：
```
主 agent worker  →  service binding  →  sandbox worker
  (完整权限)                             (零权限，仅 Math/JSON/纯计算)
```
sandbox worker 接受 JS 源代码（TS 先在主 worker 或前端编译），跑 `new Function(code)()`，把 stdout / return 值回传。TypeScript 部分由前置的 esbuild-wasm 把 TS → JS。

#### D. 评级与判断

**评级**：⭐⭐⭐☆☆（方向好，但必须**绝对避免**同 isolate eval）

TS 执行能力对 agent 的**数据处理**类任务（"把这个 JSON 按日期分组再 pick top10"）有巨大价值，但如果没做好隔离就是**一等 RCE 漏洞**。强烈建议：第一版只做 **service binding + sandbox worker** 路径，不在主 worker 里 eval；TS 编译放在 sandbox 那一侧，主 agent 只送纯文本 + arguments。这条主张是"方向正确、实现需要格外小心"的典型。

---

### 1.5 主张 ⑤：无 sub-agent，isolate 内单线程运行

#### A. 主张还原

放弃 sub-agent 概念，一个会话对应一个 isolate / DO 实例，单线程。

#### B. 技术事实

Worker / DO 本来就是单线程 isolate 模型，这条是"顺流而下"的决策。codex 的可对话 sub-agent、claude-code 的 AgentTool + Task 体系在这个环境里**无法按原样实现**——但**可以按不同的物理形式实现**：
- 想要"spawn 一个子 agent" → service binding 到另一个 nano-agent worker 实例
- 想要"并行跑多个子任务" → `Promise.all` + 多个 service binding 调用
- 想要"子 agent 持久化" → 给每个子 agent 分配一个独立的 DO id

所以 nano-agent 不是"不能做 sub-agent"，而是"**第一版不做 sub-agent**"；未来如果要做，它会自然地变成"**主 DO → 多个 worker fetch 调用**"的架构，比 codex 的 `forward_events` 复杂度更低。

#### C. 工程代价

单线程换来的**最大价值是简单**——没有父子 agent 的审批路由、没有 transcript 合并、没有 fork strategy、没有 v1/v2 工具并存维护。对"自己用"的 agent，这些复杂度本来就是过度工程。

代价是：**某些任务没有并行就显著变慢**（例如同时读 10 个文件做相关性分析），但这个可以用"同一 turn 里并行发 10 个 R2 fetch"来补，不需要真正的 sub-agent。

#### D. 评级与判断

**评级**：⭐⭐⭐⭐⭐（符合第一版定位）

**sub-agent 是 nano-agent 不应该拥有的能力**，至少在 v1。它的存在会吞噬大量工程预算（对比：codex 的 sub-agent 体系在 `core/src/codex_delegate.rs` + `agent/control.rs` + `multi_agents*.rs` 里占了至少几千行），换来的收益对"自己用 + Worker 环境"的场景几乎为零。

---

### 1.6 主张 ⑥：更强的上下文分层管理 + 外部服务结合

#### A. 主张还原

用 KV / R2 / DO storage 组合，把上下文按"热度 / 体积 / 粘性"分层，突破 isolate 的 128MB 限制。

#### B. 技术事实

Cloudflare 侧的存储能力天然就是分层的：

| 存储 | 读写延迟 | 一致性 | 容量 | 适合的上下文层 |
|------|----------|--------|------|----------------|
| isolate 内存 | ~0 | — | 128MB | 当前 turn 的 messages、tool schema |
| DO storage | ~1ms | 强一致（单实例） | 50 GB / DO | 会话级上下文、turn history、进行中的 tool 状态 |
| DO alarm + state | — | 强一致 | — | 被 hibernate 的 DO 唤醒时的恢复点 |
| KV | ~50ms (edge read) | 最终一致 | 无实际上限 | 全局共享的 skill 元数据、system prompt 模板、用户配置 |
| R2 | ~100-500ms | 强一致 (per object) | 无实际上限 | 大型 transcript、长文件读写缓存、历史 rollout |
| D1 (SQLite) | ~10-50ms | 强一致 | GB 级 | 结构化索引（skill 依赖图、tool 调用历史） |

这是一个**天然的上下文金字塔**——claude-code 花了大量工程做 `microCompact / apiMicrocompact / sessionMemoryCompact / autoCompact` 四层压缩，一部分原因是 TypeScript 进程没有类似的自带分层；而 Worker 环境把这个金字塔**直接写在基础设施里**。

#### C. 工程代价

分层带来两个必须处理的工程问题：

1. **一致性边界**：同一个 turn 里读 KV 与 DO storage 可能看到不一致的视图（KV 最终一致）。需要**"进 DO 优先"原则**：关键会话态全部放 DO storage，KV 只用于"能容忍 60 秒过期"的数据。
2. **提升 / 下降策略**：什么时候把 message 从 isolate 内存踢到 DO storage、再到 R2？需要显式策略：
   - `热层` → `温层`：当前 turn 结束时，前 N 轮对话沉淀到 DO storage
   - `温层` → `冷层`：DO storage 触及 10MB 时，把最旧的 turn 归档到 R2
   - `冷层` → 被动召回：需要时由 agent 主动 fetch 回来作为 "context reference"

#### D. 评级与判断

**评级**：⭐⭐⭐⭐⭐（这是 nano-agent 的核心差异化能力）

**这条是整个方案的最大杠杆**。三家对比 agent 都在"单进程内存"的约束下挣扎：mini-agent 靠 `_summarize_messages` 一次性抹平，codex 靠 compact + compact_remote 双路径，claude-code 靠四层 compact + cache-break 检测。它们的共同痛点是**内存即上下文**——一旦压缩就丢信息，一旦不压缩就 OOM。Worker + CF 存储把这个问题变成**物理问题而非算法问题**：压缩的意义不再是"要不要扔掉信息"，而是"这些信息应该放在哪一层"。

**nano-agent 的上下文管理应当围绕这一条建立"压缩即迁移"的心智**，而不是"压缩即丢弃"。这是它与三家的根本区别。

---

### 1.7 主张 ⑦：更多更精确的 hooks + CF 服务联动

#### A. 主张还原

hook 不是跑 shell 命令，而是调用其他 worker / 其他 CF 服务。例如 `PostToolUse → call context-compactor worker`。

#### B. 技术事实

Service binding 让 worker-to-worker 调用**没有任何网络开销**（不走 public internet，不触 DNS，零认证 handshake），因此把 hook 从"本地 shell"改写成"本地 worker 调用"不仅是可行的，而且**更快、更安全**。

对比一下 hook 执行模型：

| 模型 | mini-agent | codex | claude-code | nano-agent（本方案） |
|------|-----------|-------|-------------|----------------------|
| Shell 命令 | ✗ | ✓ | ✓ | ✗（无 shell） |
| Prompt hook | ✗ | ✗ | ✓ | ✓（调 LLM service binding） |
| HTTP hook | ✗ | ✗ | ✓ | ✓（fetch + 内部 domain） |
| Agent hook | ✗ | ✗ | ✓ | ✓（service binding 到专用 worker） |
| **Service binding hook** | ✗ | ✗ | ✗ | ✓（**独有**） |
| Queue hook (异步) | ✗ | ✗ | ✗ | ✓（CF Queues，独有） |
| Durable Object alarm hook | ✗ | ✗ | ✗ | ✓（独有） |

#### C. 工程代价

- **事件类型的爆炸**：claude-code 已经有 25 种 hook 事件，nano-agent 如果照抄会变得过于复杂。建议**第一版只支持 6 种**：`PreToolUse / PostToolUse / UserPromptSubmit / Stop / PreCompact / PostCompact`，其余按需扩展。
- **hook 结果对主流程的影响**：每个 hook 必须有显式的返回 schema 声明它能不能 block、能不能 inject context、能不能 modify input。claude-code 的 `hookSpecificOutput` 字段是合理的借鉴对象。
- **hook 发现机制**：nano-agent 的 hook 应该在 **wrangler.toml** 的 `[[services]]` 与一个 `hooks.json`（放在 KV / R2）里同时声明。前者是服务绑定，后者是事件挂接。

#### D. 评级与判断

**评级**：⭐⭐⭐⭐⭐（把 CF 原生能力当 hook 执行层是一个很漂亮的架构决策）

**这是 nano-agent 最独特的工程卖点**。它把 hook 从"用户写 shell 脚本"变成"用户部署一个 worker"，这意味着：(1) hook 可以享受 service binding 的零延迟；(2) hook 可以是 TypeScript 而非 shell；(3) hook 可以自带状态（用自己的 DO）；(4) hook 可以被全球边缘并行执行。这是三家代表 agent 都做不到的。

---

### 1.8 主张 ⑧：更自由的 skill 注册——不止 md 文档，还包括 service binding

#### A. 主张还原

skill 有两种形态：**静态 skill**（R2 里的 SKILL.md）和 **动态 skill**（service binding 过来的 worker）。

#### B. 技术事实

这把 skill 的语义扩展到了 "capability binding"。例如：
- 静态 skill：`pdf-generation`，R2 里的一段 markdown 指令 + 若干 asset 文件
- 动态 skill：`web-render`，一个专门的 worker，接收 URL，返回 screenshot + markdown

从 LLM 的角度看两者一样——system prompt 里都只看到"skill name + short description"（progressive disclosure level 1），真正激活时：
- 静态 skill：从 R2 拉完整 SKILL.md，像 mini-agent 那样做路径重写
- 动态 skill：调用 service binding，把结果当作 tool result 返回

#### C. 工程代价

- **发现机制统一**：需要一个中央 skill registry（放 KV），记录 `{name, description, type: "static" | "dynamic", location: "r2://skills/..." | "service://skill-web-render"}`。
- **生命周期不同**：静态 skill 是拉文本后本地计算，动态 skill 是一次真正的 RPC——错误处理、超时、重试完全不同。需要在 skill 抽象层把两种路径统一成 `activate(args) → result` 的签名。
- **安全边界**：动态 skill 本质上是"**另一个 worker 参与了你的会话**"，需要定义清楚它能看到什么上下文、能回写什么状态。第一版建议：动态 skill 只拿到"当次 activation 的参数"，看不到会话历史。

#### D. 评级与判断

**评级**：⭐⭐⭐⭐⭐（把 skill 变成可组合的 capability graph，是 claude-code / codex 都没想到的高度）

这一条的长期价值**极高**。它让 nano-agent 变成一个"**skill 市场的调用方**"——每个 skill 可以独立演进、独立部署、独立计费，而 agent 本体保持极简。对"上下文管理 / Skill / 稳定性"三大深耕方向的第二个（Skill），这是最本源的架构选择。

---

### 1.9 主张 ⑨：HTTPS + WebSocket，以 WebSocket 为主要客户端通讯

#### A. 主张还原

nano-agent 对外暴露 HTTPS（管理面）+ WebSocket（数据面 / 交互面）；长对话走 WebSocket。

#### B. 技术事实

Cloudflare Workers 原生支持 WebSocket，**并且 Durable Object 有 WebSocket hibernation**——当 WebSocket 空闲时 DO 会被休眠，唤醒时恢复所有 WebSocket 连接，**期间不计 CPU 时间**。这意味着 nano-agent 可以：
- 一个 WebSocket 连接对应一个会话；
- 会话在 LLM 等待 / 用户思考时**零成本休眠**；
- 工具调用完成后通过 WebSocket push 给 client；
- DO alarm 可以主动唤醒一个休眠的会话（例如"10 分钟后 check 一下 PR 状态"）。

传统 agent CLI 是"一次运行 = 一次进程"，WebSocket + DO hibernation 让 nano-agent 变成"一次会话 = 一个持久服务"。

#### C. 工程代价

- **client 侧要重写**：mini-agent / codex / claude-code 都是"本地 stdin/stdout"的交互模型，nano-agent 会要求一个 WebSocket client（CLI、浏览器、IDE 插件都行）。好处是所有 client 一致，坏处是不能直接 `pipe` bash。
- **协议设计负担**：需要定义 WebSocket 消息 schema（event / reply / stream chunk / tool call / tool result / …）。可以直接用 **ACP (Agent Client Protocol)** 作为起点——mini-agent 已经在 `acp/__init__.py` 里演示了这种集成，可以直接借鉴。
- **认证与鉴权**：HTTPS + WebSocket 的 rate limit、token 鉴权、subprotocol 协商都要自己做。CF Access 可以承担鉴权层。

#### D. 评级与判断

**评级**：⭐⭐⭐⭐⭐（配合 DO hibernation，这是 nano-agent 最颠覆的用户模型）

这一条和主张 ⑩（Durable Object 持续工具调用）是**强耦合的**——没有 DO hibernation，WebSocket 长连接就成了 CPU 成本黑洞；有了它，WebSocket 就是天生的 agent 交互层。建议直接把 ACP 当 wire protocol，**避免发明新协议**。

---

### 1.10 主张 ⑩：利用 Durable Object 完成持续的工具调用

#### A. 主张还原

把"长时间、跨 turn、需要等待外部事件"的工具调用放进 DO，让它具备持久性、可恢复性、可唤醒性。

#### B. 技术事实

DO 是 CF 的"有状态 serverless"，特性包括：
- **Strong consistency**：每个 DO id 在全球只有一个活实例；
- **`state.storage`**：持久化键值 API，写入即落盘；
- **alarm**：可以预约"X 毫秒后唤醒我"；
- **WebSocket hibernation**：空闲时卸载内存，保留 WebSocket；
- **transactional**：单 DO 内的 storage 操作是事务性的。

结合起来，一个"运行一整天的 agent 工具"（例如"每小时 check 一下 CI，构建好后部署到 staging"）可以这样实现：
```
1. Tool call: monitor_ci(repo, branch)
   → DO 创建一个 job state, 设置 5min alarm
2. Alarm 触发: fetch GitHub API 检查 CI
   → 未完成: 重新设置 alarm
   → 已完成: 通过 WebSocket 推给 client, 再决定是否部署
3. Client 下一次 reconnect, 直接看到 tool 已经自己跑完了
```
这是 mini-agent 的"后台 bash"模式的**云原生强化版**——不仅能后台跑，还能跨进程生存、跨天生存。

#### C. 工程代价

- **DO 不是免费的**：每个 DO 实例有自己的 CPU / wall-clock / 存储账单；"一个会话一个 DO" 对数千并发会话是可承受的，但要注意不要给**每个 tool 调用**都开 DO。
- **Alarm 最小粒度**：目前是秒级，不适合亚秒级 poll。
- **跨 DO 通讯要自己做**：如果主会话 DO 想查询另一个 job DO 的状态，需要 fetch / service binding。
- **存储大小**：单 DO 50GB 上限，对普通 agent 会话足够，但大 transcript / 大 rollout 应该外推到 R2。

#### D. 评级与判断

**评级**：⭐⭐⭐⭐⭐（这是 nano-agent **稳定性**方向的核心武器）

三大深耕方向的"稳定性"一项，在传统进程模型下意味着"保留崩溃日志 + 重连机制"；在 DO 模型下意味着"**进程死了会话不死**"。这是一个根本性的升级：
- 客户端意外断线 → DO 继续跑 tool，重连后回放
- Worker 崩溃 → DO alarm 唤醒，从 state.storage 恢复
- CPU time 用完 → WebSocket hibernate，下次交互自动续上
- 用户关掉终端 → 会话可以选择继续（配合 `RemoteTriggerTool` 风格的远程唤醒）

**这是 nano-agent 真正能做出差异化的地方**，三家代表 agent 中**没有任何一家**能做到类似的持久性模型。

---

## 2. 核心 Tradeoff 辩证

上述十条主张放在一起，形成一个**紧密耦合的运行时哲学**。本节分析它们共同组成的大 tradeoff。

### 2.1 我们主动放弃的

| 放弃的能力 | 代价 | 是否能在未来补回来 |
|------------|------|---------------------|
| 本地 bash / 完整 POSIX | 失去对"本地开发机"的直接操作；任何基于 "agent 改本机代码" 的工作流都失效 | **不能**（这是范式差异） |
| 本地文件系统语义 | 读写文件都要经过 R2；相对路径、symlink、权限位这些概念都变成"对象 metadata" | **部分可以**（可以做 R2 上的 fs 抽象层） |
| 本地进程 / 子进程 | 不能 fork、不能 spawn、不能 shell out | **不能** |
| Node.js 生态的 native 模块 | 任何依赖 `fs` / `child_process` / native binding 的包都用不了 | **部分可以**（wasm 化能补一部分，但工作量大） |
| 本地调试的便利 | 没有 `print(debug)` 到终端；要靠 `wrangler tail` 与 CF Logpush | **不能**（工具链差异） |
| 大上下文一次性塞进内存 | 必须分层管理 | **不应该补回**（这本来就是优势） |
| Sub-agent 并行 | 一个会话一个 DO，单线程 | **可以补**（用 service binding + 多 DO） |
| 实时 stream 到本地终端 | 必须走 WebSocket | **不应该补回**（WebSocket 更通用） |

### 2.2 我们主动换来的

| 换来的能力 | 价值 | 与 nano-agent 定位的契合度 |
|------------|------|---------------------------|
| **零冷启动 + 边缘部署** | 全球延迟 < 100ms，按调用计费 | ⭐⭐⭐⭐⭐（日常用很舒服） |
| **进程级隔离天然具备** | 每个会话 / 子任务独立 isolate，不需要写 sandbox | ⭐⭐⭐⭐⭐（抵消了放弃的 shell 能力） |
| **分层存储天然具备** | KV / R2 / DO / D1 让上下文管理变成"选层"而非"选算法" | ⭐⭐⭐⭐⭐（第一大深耕方向） |
| **持久会话** | DO alarm + WebSocket hibernation → 会话可跨天 | ⭐⭐⭐⭐⭐（第三大深耕方向） |
| **可组合 capability** | skill / hook / sandbox 全部是 service binding | ⭐⭐⭐⭐⭐（第二大深耕方向） |
| **统一协议** | ACP / WebSocket 让 CLI、IDE、浏览器 client 共享一个后端 | ⭐⭐⭐⭐☆ |
| **运维简单** | wrangler deploy 一条命令，无服务器运维 | ⭐⭐⭐⭐⭐（自用工具的重要属性） |
| **基础设施级可观测** | CF 已经提供 request 日志 / metrics / traces，无需自建 | ⭐⭐⭐⭐☆ |

### 2.3 交易的本质

**这笔 tradeoff 的本质是：用"失去本地 shell"换"获得持久、分层、可组合、全球化的 agent 服务"。**

站在"我自己用的 agent CLI"视角，这个交易的关键问题是：**我会用 agent 做什么？**
- 如果 90% 的任务是"在我本地 Mac 上帮我改代码、跑测试、提交 PR" → 这个交易**亏大了**，因为你失去了本地 shell。
- 如果 90% 的任务是"管理云资源、爬数据、做长程 workflow、跨天监控、调 API、处理文件转换" → 这个交易**赚翻了**。
- 如果 50/50 → 正确的选择是**两个 agent 并存**：本地一个用 mini-agent 风格的轻量 CLI，云端一个是 nano-agent。

我判断用户的意图更偏向第二类（从"我要跑在 Worker 里"这一决定可以反推出来——如果是纯本地工作流，根本没必要去 Worker），所以**这笔交易划算**。但它确实意味着 nano-agent **不是 claude-code 的替代品**，而是**另一个品类的工具**。

### 2.4 工程价值

- **短期工程价值**（6 个月）：极简部署模型 + 全球边缘访问 + 持久会话 → 让 agent 从"命令行工具"升级为"始终在线的私人助手"。
- **中期工程价值**（1 年）：以 skill-as-worker 和 hook-as-worker 为基础，建立起一套"**capability marketplace**"——每个能力独立演进，agent 本体保持 < 5k 行。
- **长期工程价值**（> 1 年）：为未来"多人共享 agent 服务"打下基础——DO 的 strong consistency 让"团队协作编辑一个 agent 的 skill / context" 变得可行，而传统 CLI agent 没有这个扩展路径。

### 2.5 业务价值

- **个人生产力**：有一个"永远在线、随地可用、跨设备同步"的 agent，比"每次在新机器 clone + 配 API key + 跑 setup script" 的体验好一个数量级。
- **实验速度**：加一个新 skill 不需要重编译本体，部署一个 service binding 即可——加速迭代。
- **成本可控**：CF Workers 免费额度每天 10 万请求，DO 付费但单会话成本是美分级；比长时间开着云主机便宜得多。
- **风险可控**：没有长期运行的服务器 → 没有 supply chain 被入侵的路径（本地机器不跑 agent 意味着就算 agent 被 prompt injection，也碰不到你本地的 `~/.ssh`）。

---

## 3. 与三家代表 Agent 对标

### 3.1 对标速查表

| 维度 | mini-agent | codex | claude-code | **nano-agent 目标** |
|------|-----------|-------|-------------|---------------------|
| 运行时 | 本地 Python | 本地 Rust | 本地 TypeScript | **CF Worker V8 isolate** |
| 持久性 | 无（日志） | JSONL rollout | session transcript | **DO storage + R2** |
| 并发模型 | 串行 | 工具并行 + sub-agent | 工具并行 + AgentTool | **同会话单线程 + 跨会话 service binding** |
| Shell 能力 | 本地 bash | 本地 bash + 沙盒 | 本地 bash + bwrap | **fake bash 命令路由** |
| 文件系统 | 本地 FS | 本地 FS | 本地 FS + 监控沙盒 | **R2 对象 + fs 抽象层** |
| Sub-agent | ✗ | ✓✓ (可对话) | ✓✓ (AgentTool+Task) | **✗ (v1)** |
| Hook 系统 | ✗ | 5 种事件 | **25 种事件 / 4 种模式** | **6-8 种事件 / service-binding 模式** |
| Skill 来源 | 1 种 (md) | 4 种 | 7 种 | **2 种 (md + service)** |
| Prompt cache | ✗ | 服务端 key | **per-block cache_control** | **per-block + 分层缓存** |
| 上下文压缩 | 单路摘要 | 本地+远端双路 | 四层 (micro/api/session/auto) | **分层迁移 (内存→DO→R2)** |
| 客户端协议 | REPL | TUI | TUI + IDE plugin | **WebSocket + ACP** |
| 审批 / 沙盒 | 无 | 多层 + Guardian LLM | 多层 + classifier | **capability-based (worker 隔离)** |
| 代码体量 | 5k 行 | ~100 crates | 几十万行 | **目标 < 10k 行核心** |

### 3.2 可以吸收的具体能力

#### 3.2.1 来自 mini-agent

- **`Tool` 抽象的极简度**（`tools/base.py`，60 行）：nano-agent 的 tool 接口应该同样小，避免 claude-code 那种"业务 + UI + permission 全塞一个 trait"的臃肿。
- **`_summarize_messages` 的 user-boundary 策略**（`agent.py:180-259`）：保留所有 user message、只压中间的 assistant+tool 序列——这个思路可以**直接借鉴**为 nano-agent 的"层间迁移策略"。把"中间段摘要"改成"中间段迁移到 DO storage"即可，甚至不需要 LLM 调用。
- **`SkillLoader._process_skill_paths`**（`tools/skill_loader.py:119-192`）：skill 加载时的路径重写思路可以移植——只是把"本地绝对路径"改成"R2 对象 URL"。
- **`_cleanup_incomplete_messages`**（`agent.py:100-121`）：cancel 时只删悬空 tool result 的设计，在 WebSocket 断线场景下同样适用。
- **ACP 集成**（`acp/__init__.py`）：直接借鉴作为 nano-agent 的 wire protocol 基础。

#### 3.2.2 来自 codex

- **`withRetry` 式的重试策略**（等价物 `codex-client/src/retry.rs`）：指数退避 + jitter + 429/5xx 区分 + Retry-After 解析——nano-agent 的 LLM 客户端直接按这个抄。
- **Rollout JSONL 持久化**（`rollout/src/recorder.rs`）：每行 JSON 的流式持久化格式，可以直接搬到 DO storage / R2——它的 schema 已经考虑了 resume/fork/archive。
- **Hook 事件模型的结构**（`hooks/src/events/*.rs`）：每个事件一个结构体、显式的 outcome schema——对 nano-agent 的少量事件（6-8 个）来说，这种"一事件一文件"的组织非常合适。
- **Guardian LLM 审批模式**（`core/src/guardian/`）：即便 nano-agent 没有本地 shell，对某些敏感 skill / service binding 的调用仍然需要策略判断；"用另一个 LLM 做决策"的思路可以在 sensitive hook 上复用。
- **`ResponseItem` enum 的变体丰富度**（`codex-protocol` crate）：为 nano-agent 的 message 类型定义提供了参考——除了 `user/assistant/tool`，还要考虑 `reasoning / compaction / tombstone / ghost_snapshot` 这些变体。

#### 3.2.3 来自 claude-code

- **`promptCacheBreakDetection` 的 hash + root-cause 模式**（`services/api/promptCacheBreakDetection.ts`）：nano-agent 的 prompt cache 管理应直接借鉴——per-field hash + 5% 跌幅检测 + pending-change 反查。
- **Per-block `cache_control` + 1h TTL latching**（`services/api/claude.ts:358-434`）：在 Worker 环境下这一条更重要，因为跨 isolate 的缓存命中会直接降低 KV/LLM 成本。
- **Hook 事件的 payload 细节**（`utils/hooks/hooksConfigManager.ts:26-264`）：nano-agent 虽然只做 6-8 个事件，但每个事件的 payload 结构可以抄 claude-code 的设计，它已经考虑过所有边界情况。
- **`execHttpHook` 的 SSRF 守卫 + URL allowlist**（`utils/hooks/execHttpHook.ts`, `ssrfGuard.ts`）：nano-agent 的 hook 虽然走 service binding 不走公网，但**外部 webhook hook** 仍然可能存在，SSRF 守卫值得借鉴。
- **`withRetry` 的持久重试模式**（`services/api/withRetry.ts:267-364`）：当 nano-agent 在 DO 里长跑时，"30s 心跳 / 6 小时上限 / Opus→fallback"这一整套思路几乎可以原样用上。
- **`normalizeMessagesForAPI` + `ensure_call_outputs_present` 风格的消息归一化**：任何长会话都会遇到"悬空 tool call"的一致性问题，这是同类 bug 的高发区。

#### 3.2.4 需要主动避开的

- **codex 的 sub-agent 体系** (`codex_delegate.rs` + `multi_agents*.rs`)：**不抄**。nano-agent 的"多会话"通过多 DO 实现，不需要进程内 fork。
- **claude-code 的 40+ 工具 + 自带 Ink fork** (`tools/` + `ink/`)：**不抄**。nano-agent 的 tool 以 service binding 为主，不在本体堆内建工具；TUI 层完全交给 client 实现。
- **codex / claude-code 的本地沙盒** (`linux-sandbox/`、`sandbox-runtime`)：**不抄**。isolate 天然是沙盒，不需要再造一层。
- **claude-code 的 `tools/TodoWriteTool` 的 activeForm 字段 + 非持久化**：可以简化——nano-agent 的 todo 直接放 DO storage，跨会话持久。

---

## 4. 全局 Value Verdict

### 4.1 综合画像

**nano-agent (v1) 是一个跑在 Cloudflare Worker 上的持久化 agent 服务**，有以下鲜明特征：

- **身份**：始终在线、全球边缘、单用户（自用）、WebSocket 驱动。
- **执行模型**：单 isolate + 单 DO = 单会话；跨会话通过多 DO 独立部署；无 sub-agent。
- **工具模型**：fake bash 命令路由 + R2 文件抽象 + service binding 动态 skill + hook-as-worker。
- **上下文模型**：内存（128MB 紧约束）→ DO storage（会话热历史）→ R2（归档冷历史）→ KV（共享元数据），"压缩即迁移"而非"压缩即丢弃"。
- **稳定性模型**：DO alarm + WebSocket hibernation + 持久 state = 会话跨天生存，进程崩溃不等于会话死亡。
- **体量预期**：核心本体 < 10k 行 TypeScript；绝大部分"能力"外推给 service binding。
- **客户端解耦**：agent 本体不管 UI；CLI / 浏览器 / IDE plugin 都通过 ACP over WebSocket 接入。

### 4.2 最终评分

| 维度 | 评级 (1-5) | 一句话说明 |
|------|------------|------------|
| **与 nano-agent 定位契合度** | 5 | "自己用 + 全球可达 + 长任务" 的目标和 Worker 模型天然对齐 |
| **三大深耕方向的杠杆** | 5 | 上下文分层、skill 可组合、DO 持久性一次性全都拿到 |
| **工程复杂度可控程度** | 4 | 放弃 sub-agent / 本地 shell 大幅降低复杂度，但 Worker 生态学习曲线存在 |
| **短期实现成本** | 3 | 需要重新设计 fake bash / R2 fs 抽象 / service binding 接口，有前期投入 |
| **长期演进空间** | 5 | "capability marketplace" 模型让系统可以长期增长而不膨胀 |
| **风险可控程度** | 4 | sandboxing / TS 执行是最大风险点，只要坚持 service binding 路径就可控 |
| **差异化程度** | 5 | 三家代表 agent 无法做到同样的持久性与可组合性 |
| **自用友好度** | 4 | 部署简单、全球可达，但失去本地 shell 需要心智调整 |
| **综合价值** | **5** | **方向正确、差异显著、代价可接受** |

### 4.3 最终 Verdict

**这十条主张共同构成了一个自洽、正确、差异化显著的设计。**

它们最迷人的地方不是"跑在 Cloudflare 上"这个选择本身，而是**这十条的每一条都放大了另外几条的价值**：
- 选择 Worker（①②）让 sub-agent 不需要实现（⑤），
- 没有 sub-agent 让单线程模型成立（⑤），
- 单线程让 DO state 的一致性模型成立（⑩），
- DO state 让上下文分层变得物理自然（⑥），
- 分层让 hook + skill 走 service binding 变得合理（⑦⑧），
- service binding 让 fake bash 不需要是完整 shell（③），
- WebSocket + DO hibernation 让持久会话成为可能（⑨⑩），
- 持久会话反过来验证了"不跑在 Linux"是对的选择（①）。

**这种紧密耦合是成熟架构的标志**——每一条决策都让其他决策更容易实现。相反，如果十条里有一两条不自洽（例如"我要 sub-agent 但也要 WebSocket hibernation"），整个设计就会在实现阶段崩塌。现在的十条之间没有这种张力。

**主要风险点**：

1. **TS 执行（主张 ④）**是唯一真正需要小心的地方。必须通过 service binding 隔离，绝不在主 isolate 里 eval。
2. **放弃本地 shell 的心智代价**。如果你未来发现"我就是想让 agent 直接改我本地 repo"，需要清晰地告诉自己：**那是另一个 agent 的任务**，不是 nano-agent 的。
3. **128MB 内存 + CPU time** 是硬约束，需要配套的预算文化。tiktoken / JSON 序列化大对象这类 CPU 密集操作要谨慎，宁可外推到专用 worker。

**建议的实施顺序**（渐进路径，避免一次性重写太多）：

1. **阶段 1**（骨架）：裸 worker + LLM client (按 claude-code 的 `withRetry` 抄) + WebSocket 接入 + ACP wire protocol + 最小 fake bash (只有 ls/cat/read/write) + 内存态 session → 这一阶段能跑通"一次对话，读写 R2 对象"的闭环。
2. **阶段 2**（持久性）：把 session 迁入 DO storage，加 alarm 机制，加 hibernation 支持 → 这一阶段能跑通"会话跨 reconnect 存活"。
3. **阶段 3**（分层上下文）：实现 internal → DO → R2 的三层迁移策略，加 prompt cache per-block 管理 → 这一阶段是第一大深耕方向落地。
4. **阶段 4**（Skill 市场）：service binding 动态 skill + KV 中央 registry + progressive disclosure → 第二大深耕方向落地。
5. **阶段 5**（Hooks 体系）：6-8 个事件 + service-binding 执行模式 + SSRF 守卫 → 第三大深耕方向（稳定性）的可观测性侧落地。
6. **阶段 6**（能力扩展）：根据实际使用反馈再决定要不要 TS 执行 sandbox、要不要多 DO 联动（弱 sub-agent 替代品）、要不要 D1 索引层。

**一句话 Verdict**：

> **这是一个把 agent CLI 从"本机工具"重新定义为"边缘服务"的正确方向**。十条主张互为支撑、每一条都对齐三大深耕方向（上下文 / Skill / 稳定性），放弃的本地能力与换来的持久化、分层、可组合架构之间是**划算的交易**。主要执行风险在 TS 沙盒与 128MB 预算纪律，但都是可被工程规范化解决的问题。建议**按上述六阶段渐进推进**，每个阶段结束都是一个可用的里程碑，而不是一次性大爆炸重写。**推进 nano-agent 的 Cloudflare 运行时路线是值得的**。
