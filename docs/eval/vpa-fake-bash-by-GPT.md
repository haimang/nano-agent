# Value Proposition Analysis - Fake Bash - by GPT

> 分析对象: `nano-agent / fake bash`
> 分析时间: `2026-04-15`
> 分析者: `GPT-5.4`
> 重点材料:
> - `context/just-bash/README.md`
> - `context/just-bash/src/Bash.ts`
> - `context/just-bash/src/commands/registry.ts`
> - `context/just-bash/src/interpreter/interpreter.ts`
> - `context/just-bash/src/fs/interface.ts`
> - `context/just-bash/src/fs/mountable-fs/mountable-fs.ts`
> - `context/just-bash/src/fs/overlay-fs/overlay-fs.ts`
> - `context/just-bash/src/fs/read-write-fs/read-write-fs.ts`
> - `context/just-bash/src/network/fetch.ts`
> - `context/just-bash/src/security/index.ts`
> - `context/just-bash/THREAT_MODEL.md`

---

## 目录

1. 问题重述：为什么 fake bash 在 nano-agent 里不是可选项
2. 本文的核心判断
3. `just-bash` 的整体结构与总评
4. `just-bash` 的具体能力清单
5. `just-bash` 对 nano-agent 的启发与不适配点
6. nano-agent 最小 fake bash 工具集建议
7. nano-agent 必须明确声明的不支持项
8. 声明式 bash 命令注册模型
9. 如何通过 system prompt 强制规范 fake bash 的使用
10. 如何通过 TypeScript 守卫强制对齐实现与承诺
11. 对 just-bash 的终审评价
12. 对 nano-agent 的 fake bash 心智模型可行性再评价
13. fake bash 落地后对整个项目价值的最终 verdict

---

## 1. 问题重述：为什么 fake bash 在 nano-agent 里不是可选项

你这次补充里最重要的判断是对的：

> **LLM 不是在“Worker/V8 isolate/DO”这个世界观里被训练出来的，而是在“我大概率有 bash、有本地文件系统、有 curl、有 grep、有 git”这种工作流先验里被训练出来的。**

这意味着，对 nano-agent 来说：

- 放弃 Linux、放弃 shell、放弃真实 FS，**在系统内部**是合理的；
- 但在 **LLM 的外部接口层**，如果完全放弃 bash 形状，模型的工作流就会明显退化。

因此 fake bash 的本质不是“为了伪装系统”，而是：

1. **吸收 LLM 既有操作先验**
2. **降低 prompt 中持续纠偏的成本**
3. **让模型继续用它熟悉的搜索/读取/写入/验证路径工作**
4. **把这些 bash-shaped 行为映射到 Worker-native、typed、可治理的能力层**

一句话说：

> **nano-agent 不能把 shell 当作系统真相，但必须把 shell 当作 LLM 兼容层。**

---

## 2. 本文的核心判断

先给结论。

### 2.1 我对 fake bash 的总体判断

**我赞成 nano-agent 引入 fake bash。**

但前提是把它定义成：

- **兼容层**
- **能力路由层**
- **prompt 协议层**

而不是：

- 完整 POSIX 复刻
- 完整 Linux 仿真
- “我们真的有一台机器”式幻觉

### 2.2 我对实现方式的核心建议

最佳架构不是“系统内核就是 shell”，而是两层：

| 层 | 角色 | 原则 |
|---|---|---|
| **外层：bash-compatible surface** | 给 LLM 使用的命令界面 | 保持熟悉、稳定、有限的 bash 形状 |
| **内层：typed capability runtime** | 真正执行的 Worker/Service/DO 能力层 | 强类型、可审计、可限流、可回放 |

因此，nano-agent 的正确方向是：

> **bash-shaped interface, capability-native runtime.**

---

## 3. `just-bash` 的整体结构与总评

### 3.1 它是什么

`just-bash` 不是简单的字符串命令转发器，而是一个相当完整的虚拟 shell runtime。

从代码结构上看，它的主路径是：

```text
Input Script
  -> Parser
  -> AST
  -> Interpreter
  -> Command Registry / Builtins / Virtual FS / Secure Fetch
  -> ExecResult
```

这个架构在 `src/Bash.ts`、`src/interpreter/interpreter.ts`、`src/commands/registry.ts` 中都非常明确。

### 3.2 它的核心设计优点

#### 1. 不是“拼命令”，而是 AST 驱动

`src/Bash.ts` 开头就明确把自己定义为：

> Input -> Parser -> AST -> Interpreter -> Output

这意味着它不是正则拼凑的 shell，而是真正做了解析、AST 执行、内建语义和命令调度。  
这是它最重要的工程价值，因为 fake bash 只有做到 AST 层，才有可能做到：

- 受控的管道与重定向
- 结构化命令收集
- 可插拔的 transform/plugin
- 更可靠的安全边界与资源限制

#### 2. FS 抽象做得很好

`src/fs/interface.ts` 定义了统一的 `IFileSystem`，而不是把 shell 逻辑绑死在某一种文件系统上。  
它支持：

- `InMemoryFs`
- `OverlayFs`
- `ReadWriteFs`
- `MountableFs`

这对于 nano-agent 特别重要，因为你天然就需要：

- 内存文件层
- 持久对象层
- 外部挂载层
- 多源挂载

#### 3. 命令注册模型很适合做“受控暴露”

`src/commands/registry.ts` 不是把所有命令一次性塞进来，而是用**静态可分析的 lazy loader** 来注册命令。

它有几个很好的设计点：

- 命令名字是显式枚举的
- 命令按能力分组
- 网络、Python、JavaScript 都是 opt-in
- 浏览器 bundle 会排除不支持命令

这很适合 nano-agent 的 command registry / capability manifest 设计。

#### 4. 安全意识比普通“fake shell”强很多

`THREAT_MODEL.md` 非常值得肯定。它不是一句“沙箱很安全”就结束，而是明确列出：

- parser bomb
- glob / brace / heredoc / substitution 限制
- FS path traversal / symlink / TOCTOU
- network allow-list / redirect validation / SSRF
- prototype pollution
- DoS
- info disclosure

这种安全姿态是成熟的。

#### 5. 它已经意识到“AI agent 使用场景”

README、AGENTS.npm.md、Sandbox 兼容 API 都说明，`just-bash` 从一开始就不是给终端玩家写的，而是给 agent / AI SDK / sandboxed execution 用的。

这点和 nano-agent 的目标高度相似。

### 3.3 它的核心问题

#### 1. 它本质上仍是 Node-hosted，而不是 Worker-first

虽然它有 browser bundle，但真正高价值的扩展能力：

- `js-exec`
- `python3`
- `sqlite3`
- `OverlayFs`
- `ReadWriteFs`
- `Sandbox`

都强依赖 Node.js 或 worker_threads。

也就是说，`just-bash` 的本体心智仍然是：

> “我运行在一个相对宽松的 JS/Node 宿主里，然后模拟 shell。”

而不是：

> “我运行在强约束的边缘 isolate 里，然后把命令映射到云原生能力。”

这和 nano-agent 的宿主假设不同。

#### 2. 它很强，但也因此容易过宽

`just-bash` 提供了非常多命令和语法。对通用库来说这是优点；对 nano-agent 来说，这也是风险：

- 暴露面大
- 语义承诺大
- 兼容成本高
- prompt drift 风险高

nano-agent 早期如果照单全收，会把 Worker 架构的精力消耗在 shell compatibility 上。

#### 3. 它的安全前提仍然是假定宿主可信

`THREAT_MODEL.md` 里写得很清楚：host-provided `fs` / `fetch` / `customCommands` / transform plugins 都是 trusted。  
这意味着 just-bash 的安全边界是：

- **防不可信脚本**
- **不防不可信宿主**

而 nano-agent 作为平台能力，未来很可能要面对更多层次的 trust boundary：

- 平台宿主
- 租户
- 组织策略
- skill/service provider
- 远程工具提供者

这要求比 just-bash 更强的 capability governance。

#### 4. 它会制造“我好像真的在 Linux”这种心智

`src/Bash.ts` 里默认注入了：

- `OSTYPE=linux-gnu`
- `MACHTYPE=x86_64-pc-linux-gnu`
- `/proc/self/...`
- `/bin`
- `/usr/bin`
- `BASH_VERSION`

`src/shell-metadata.ts` 也会模拟 bash 版本与 kernel 版本。

这很适合“降低 LLM 摩擦”，但对 nano-agent 来说必须克制。  
因为一旦外部假象过强，用户和模型都会自动继续期待：

- job control
- apt/npm/pip
- 真实 process
- 真实 git hooks
- 真实 sockets

而 Worker 做不到。

### 3.4 对它的整体评价

我的总体评价是：

> **`just-bash` 是一个非常高质量的 fake bash 参考实现，但它更像“Node 宿主中的虚拟 shell runtime”，而不是“Cloudflare Workers 中的 capability shell protocol”。**

所以：

- **可借鉴：非常多**
- **可直接复用：有限**
- **可直接照搬：不建议**

---

## 4. `just-bash` 的具体能力清单

这一节按能力面列出，不只看 README，也结合代码结构判断。

### 4.1 Shell 语言能力

`just-bash` 支持的不是单命令执行，而是相当完整的 shell 语法子集：

1. **管道**
   - `cmd1 | cmd2`
2. **重定向**
   - `>`
   - `>>`
   - `2>`
   - `2>&1`
   - `<`
3. **命令串联**
   - `&&`
   - `||`
   - `;`
4. **变量展开**
   - `$VAR`
   - `${VAR}`
   - `${VAR:-default}`
5. **位置参数**
   - `$1`
   - `$2`
   - `$@`
   - `$#`
6. **glob**
   - `*`
   - `?`
   - `[...]`
7. **控制流**
   - `if / elif / else / fi`
   - `for`
   - `while`
   - `until`
8. **函数**
   - `function name { ... }`
   - `name() { ... }`
9. **内建变量 / shell state**
   - `PWD`
   - `HOME`
   - `PATH`
   - `SHELLOPTS`
   - `BASHOPTS`
10. **内建 builtin**
   - `cd`
   - `export`
   - `local`
   - `set`
   - `source`
   - `eval`
   - `readonly`
   - `unset`
   - `read`
   - `mapfile`
   - `test` / `[`
   - `exec`（stub 化）
   - `wait`（stub 化）

这说明它已经不是“命令列表”，而是一个 shell language runtime。

### 4.2 文件系统能力

FS 是 `just-bash` 最强的一部分之一。

#### 支持的 FS 后端

1. **InMemoryFs**
   - 纯内存
   - 默认实现
2. **OverlayFs**
   - 真实目录只读读取
   - 写入在内存 copy-on-write
3. **ReadWriteFs**
   - 真实目录直接读写
4. **MountableFs**
   - 多文件系统挂载到统一命名空间

#### 支持的核心文件操作

- `cat`
- `ls`
- `mkdir`
- `rmdir`
- `touch`
- `rm`
- `cp`
- `mv`
- `ln`
- `chmod`
- `readlink`
- `stat`
- `tree`
- `du`
- `split`

#### 额外拟真能力

- `/bin`, `/usr/bin` stub
- `/dev/null`, `/dev/stdin`, `/dev/stdout`, `/dev/stderr`
- `/proc/self/status` 等虚拟进程元信息
- symlink / hardlink 语义
- 路径解析与挂载路由

### 4.3 文本与数据处理能力

这是它对 agent 场景很有吸引力的一组能力。

#### 文本处理

- `grep`, `egrep`, `fgrep`
- `rg`
- `sed`
- `awk`
- `sort`
- `uniq`
- `cut`
- `paste`
- `tr`
- `rev`
- `nl`
- `fold`
- `expand`, `unexpand`
- `strings`
- `column`
- `join`
- `wc`
- `head`, `tail`
- `diff`

#### 数据处理

- `jq`：JSON
- `yq`：YAML/XML/TOML/CSV
- `xan`：CSV
- `sqlite3`：SQLite via sql.js/WASM
- `base64`

对 agent 而言，这意味着它能把很多“我想写个临时分析脚本”的需求，转成 shell-native 操作。

### 4.4 网络能力

`curl` 不是默认存在，而是 **network opt-in**。

#### 关键特性

1. **默认无网络**
2. **allow-list 驱动**
3. **默认方法只开 `GET/HEAD`**
4. **可选扩展方法**
5. **手动 redirect 检查**
6. **private IP / DNS rebinding 防护**
7. **header transform**
   - 允许在 fetch 边界注入认证头
   - 避免把 secret 直接暴露给脚本

这是它很值得借鉴的一点：  
网络不是“让 shell 调 fetch”，而是“让安全边界包住 fetch”。

### 4.5 可选 runtime 能力

#### `js-exec`

- 基于 QuickJS WASM
- Node-only
- 提供接近 Node 的兼容 API
- 通过 worker + bridge 访问虚拟 FS / fetch / subcommand

#### `python3`

- 基于 CPython Emscripten
- Node-only
- worker 中执行
- 虚拟 FS 桥接

#### `sqlite3`

- 基于 sql.js
- 受 timeout 控制

这组能力说明 just-bash 不仅提供 shell，还提供 “在 shell 中执行脚本型任务” 的能力。

### 4.6 命令扩展与集成能力

#### 自定义命令

`src/custom-commands.ts` 提供：

- `defineCommand(name, execute)`
- lazy custom command

也就是可以把任意 TypeScript handler 注册成 bash 命令。

#### Transform plugin

`src/transform/README.md` 说明它支持：

- parse -> AST -> plugin -> serialize
- 命令收集
- tee 插桩
- metadata 注入

这对 nano-agent 很有启发，因为你也需要：

- tool usage instrumentation
- metadata extraction
- 命令白名单/分类
- 事前静态检查

#### Sandbox-compatible API

它还提供了 Vercel Sandbox 兼容接口，这进一步说明：  
它在产品定位上，本来就接近“被 agent/runtime 嵌入”。

### 4.7 安全与执行限制

这部分是它非常成熟的点。

#### 资源限制

- 最大命令数
- 最大循环次数
- 最大递归深度
- 最大输出
- 最大 heredoc
- 最大 substitution depth
- 最大 glob 操作
- 最大字符串长度
- Python/JS/SQLite timeout

#### 文件系统安全

- root containment
- path sanitize
- symlink 默认拒绝
- TOCTOU 防护
- 错误信息去真实路径

#### JS defense-in-depth

- block `eval`
- block `Function`
- block `process.*`
- block `WebAssembly`
- block `Module._resolveFilename`
- 阻止部分 dynamic import 路径

但要注意：  
它自己也反复强调，这只是 secondary defense，不是 VM 级隔离。

### 4.8 浏览器 / Node 分层

`src/browser.ts` 和 `src/commands/browser-excluded.ts` 直接告诉你：

- core shell 可在浏览器工作
- 但很多高价值命令不能

浏览器排除项包括：

- `tar`
- `yq`
- `xan`
- `sqlite3`
- `python3`
- `python`

README 还额外说明：

- `js-exec` 不在浏览器环境可用
- `OverlayFs` / `ReadWriteFs` 也不在浏览器可用

这恰恰说明：

> fake bash 一旦要跨宿主环境，就必须把“命令能力矩阵”显式化。

这对 nano-agent 非常关键。

---

## 5. `just-bash` 对 nano-agent 的启发与不适配点

### 5.1 最值得借鉴的部分

#### 1. AST-first，而不是字符串-first

nano-agent 的 fake bash 最终如果要支持：

- pipes
- redirects
- chained execution
- command metadata extraction
- guardrails

那最好也采用：

> parse -> AST -> validate -> route -> execute

这件事上，`just-bash` 的设计方向是对的。

#### 2. FS 必须是接口，不是实现

`IFileSystem` 的思路特别适合 nano-agent。  
你未来需要的其实不是一个 FS，而是一组挂载：

- `/workspace` -> 会话工作目录
- `/context` -> 只读上下文层
- `/tmp` -> 临时层
- `/artifacts` -> 大对象工件层
- `/memories` -> 摘要/缓存层

这就是 `MountableFs` 思路在 Worker 世界里的升级版。

#### 3. 命令注册必须可枚举、可裁剪、可懒加载

`createLazyCommands(filter?)` 这种设计很适合 nano-agent 的命令白名单。

因为你必须根据：

- 租户权限
- 客户端能力
- 环境类型
- 当前会话策略

来裁剪可用命令集。

#### 4. 网络必须是 allow-list + transform 模式

这点对 Cloudflare 场景尤其重要。  
`curl` 的正确实现方式不是“把网络开放给 shell”，而是：

- path/origin allow-list
- method allow-list
- redirect control
- SSRF 防护
- secret injection at boundary

这个模型可以几乎原样迁移。

### 5.2 不应直接继承的部分

#### 1. 不应继承“Linux 幻觉即真相”

`just-bash` 的 `/proc`, `OSTYPE`, `/bin`, `HOSTNAME` 很有用，但 nano-agent 不应继续扩大这条路线。  
否则越做越像“你有一台 Linux”，而实际上你没有。

#### 2. 不应继承 Node-first 的 optional runtime

`js-exec` / `python3` / `sqlite3` 在 just-bash 里很自然，因为宿主是 Node。  
但在 Worker 里：

- `js-exec` 可以 Worker-native 重做
- `python3` 应谨慎，最好远端化
- `sqlite3` 可以是 service binding，不应一开始强塞进主 isolate

#### 3. 不应继承“尽量支持很多命令”

nano-agent 更应该：

- 少量命令
- 稳定语义
- 明确能力矩阵
- prompt 中强约束

而不是“命令很多，但宿主约束很碎片”。

---

## 6. nano-agent 最小 fake bash 工具集建议

下面给一个 **v1 最小可行 bash 面**。  
原则不是“越多越好”，而是“最符合 LLM 先验、最常用、最容易稳态化”。

### 6.1 v1 必须包含的命令组

| 命令组 | 建议包含 | 为什么必须有 | 在 nano-agent 中如何实现 |
|---|---|---|---|
| **路径/目录** | `pwd`, `cd`, `ls`, `find` | LLM 默认靠目录探索建立环境心智 | 基于虚拟挂载表与 DO 会话 cwd，绝不映射真实宿主路径 |
| **文件读取** | `cat`, `head`, `tail`, `wc`, `stat` | 读取文件是最基础动作 | 直接走 VFS + 大文件截断策略 + metadata 注入 |
| **搜索** | `grep`, `rg` | LLM 极度依赖 grep/rg 建立局部上下文 | 走索引化 VFS 搜索服务；优先做 deterministic 输出 |
| **文件修改** | `mkdir`, `rm`, `cp`, `mv`, `touch`, `tee` | 需要模拟“工作区编辑” | 映射到会话工作树变更 API；所有写入带审计事件 |
| **输出控制** | `echo`, `printf` | prompt 里经常拼接命令、生成中间文件 | 轻量本地实现 |
| **差异查看** | `diff` | agent 经常需要比较修改前后 | 直接走文本 diff 引擎，不依赖 shell |
| **JSON 处理** | `jq` | 现代 agent 对 JSON 极依赖 | 提供受限 jq 风格查询器或直接内置 JSON query 命令 |
| **网络验证** | `curl` | “验证端点可访问性”是高频刚需 | 映射到 allow-listed fetch/service binding，支持部分 curl flags |
| **TS 执行** | `ts`, `js-exec`, 或 `node` 兼容别名 | 代替大量 ad-hoc bash/python 脚本 | Worker-native TS runtime，限制模块能力和资源上限 |
| **版本工作流** | `git status`, `git diff`, `git add`, `git commit`, `git log` | LLM 对代码修改任务天然期望 git 存在 | 建立虚拟 VCS 层，映射到 snapshot/patch/commit metadata，而不是完整 Git |

### 6.2 哪些看起来常见、但不应放进 v1

| 候选能力 | 是否进 v1 | 判断 |
|---|---|---|
| `python3` | **否** | Worker 内运行复杂、成本高、先用 `ts` 替代，必要时走外部计算 worker |
| `sed` / `awk` 全量 | **谨慎** | 很有用，但语义复杂；早期可由 `grep` + `ts` + write API 代替 |
| `sqlite3` | **否** | 更适合做专用 service binding 能力，而不是一开始放进 fake bash |
| `tar` / `gzip` | **否** | 不属于高频 agent coding loop 的第一层必需项 |
| 浏览器渲染命令 | **不放进 bash** | 作为独立 `browser` 能力更合理，避免塞进 shell 幻觉里 |

### 6.3 关于 `git`

`git` 是一个很关键的判断点。

我建议 nano-agent **必须提供 git-compatible surface，但不要承诺 full Git**。

最小子集建议：

1. `git status`
2. `git diff`
3. `git diff --staged`
4. `git add <paths>`
5. `git restore --staged <paths>` 或等价能力
6. `git commit -m "..."`
7. `git log --oneline -n N`

内部实现应该不是 Git 仓库，而是：

- base snapshot
- working tree diff
- staged set
- commit metadata

这样既满足 LLM 心智，也不把自己绑进完整 Git 实现泥潭。

### 6.4 关于浏览器能力

你提到“获取浏览器权限，进行视觉验证”，这很重要。  
但我建议：

> **浏览器能力应是 first-class tool，不应伪装成 bash 的一部分。**

原因：

- 行为异步
- 输出是结构化 artifact，不是纯 stdout/stderr
- 需要截图、DOM、console、network trace
- 更适合和 Browser Rendering / service binding 对接

因此可以在 prompt 中告诉模型：

- shell 用于文件/网络/文本/版本工作流
- browser 用于页面验证

而不是强行做成 `browser-render https://...` 这类 bash 命令。

---

## 7. nano-agent 必须明确声明的不支持项

这一节非常重要。  
如果不明确声明，fake bash 会迅速被模型和用户误解为“几乎完整 Linux”。

### 7.1 必须声明不支持

1. **不支持任意外部二进制执行**
   - 没有真实 `bash`, `sh`, `node`, `python`, `git`, `apt`, `npm`, `pip`
   - 只有注册过的虚拟命令可用

2. **不支持完整 POSIX / GNU 兼容**
   - 仅支持声明的子集
   - 未实现的 flags 必须 deterministic 报错

3. **不支持真实进程模型**
   - 没有 `ps`
   - 没有 `kill`
   - 没有 `bg`, `fg`, `jobs`, `nohup`
   - 没有真正的 PID 语义

4. **不支持真实系统安装与包管理**
   - 不能 `apt install`
   - 不能 `npm install`
   - 不能 `pip install`
   - 不能假设 PATH 中存在宿主工具

5. **不支持访问宿主文件系统**
   - 只能访问挂载进 VFS 的路径
   - 没有“系统文件”
   - 没有 `/etc/passwd` 之类宿主真文件

6. **不支持完整 Git**
   - 没有 rebase / merge / cherry-pick / submodule / worktree / hooks
   - 只有 virtual VCS subset

7. **不支持 localhost/端口机器心智**
   - 除非显式映射到 service binding / tunnel / preview URL
   - 否则不应让模型默认以为能起一个本地 server 再 curl `localhost`

8. **不支持 shell 启动文件/用户 profile**
   - 没有 `.bashrc`
   - 没有真实 login shell

### 7.2 为什么必须显式声明

因为 fake bash 最大的风险不是“命令少”，而是：

> **模型和用户对未声明部分做了错误补全。**

所以不支持项必须写进：

- system prompt
- `help`
- `bash --help`
- `git --help`
- 错误信息模板

---

## 8. 声明式 bash 命令注册模型

我建议 nano-agent 的 fake bash 不使用“自由拼 handler”的模型，而使用 **manifest-first registration**。

### 8.1 建议的数据结构

```ts
type CapabilityKind =
  | "fs-read"
  | "fs-write"
  | "search"
  | "network"
  | "runtime-ts"
  | "vcs"
  | "utility";

interface BashCommandManifest {
  name: string;
  summary: string;
  category: string;
  capability: CapabilityKind;
  supportedFlags: string[];
  unsupportedFlagsBehavior: "error";
  acceptsPipes: boolean;
  acceptsRedirection: boolean;
  mutatesState: boolean;
  requiresApproval: boolean;
  output: "text" | "json" | "binary";
  implementation:
    | { kind: "builtin"; handler: string }
    | { kind: "service-binding"; service: string; method: string }
    | { kind: "worker-runtime"; entry: string };
}
```

### 8.2 注册原则

1. **命令名是兼容层**
   - 例如 `curl`
   - 但内部实现可以是 `service-binding: network-proxy.fetch`

2. **flag 支持显式列举**
   - 只支持少量 flags
   - 未支持 flag 一律报错

3. **命令能力与权限类型绑定**
   - `fs-write`、`network`、`vcs` 等
   - 这样 approval/policy 才能稳定

4. **命令语义与输出契约固定**
   - stdout/stderr/exitCode 形状稳定
   - 不允许每个 handler 自己发明风格

5. **命令注册表是单一真相源**
   - `help`
   - prompt 生成
   - TS 守卫
   - approval policy
   - docs
   都由它派生，避免 README / AGENTS / 实现三份信息漂移

### 8.3 关于“bash parser”本身

如果要支持：

- pipes
- redirection
- command chaining

那么可以有两种路：

1. **采用 AST parser，再把 command node 路由到 manifest**
2. **只支持单命令 + 管道子集**

我建议：

- v1 支持 **单命令 + pipe + 基础重定向**
- 不要过早追求完整 shell 语法

也就是说，借鉴 `just-bash` 的“AST-first 思想”，但不要继承它的全部语言野心。

---

## 9. 如何通过 system prompt 强制规范 fake bash 的使用

如果 fake bash 要稳定，光有实现不够，**必须通过 system prompt 不断校正 LLM 的预期**。

### 9.1 system prompt 里必须反复强调的事实

建议明确写出类似原则：

1. 你运行在一个 **virtual Worker shell**
2. 只可使用已注册命令
3. 不要假设存在未声明的系统命令
4. 不要假设真实 Linux 进程与本地网络
5. 需要浏览器验证时使用独立 browser 能力，不要用 bash 代替
6. 需要修改文件时只操作虚拟工作区
7. 需要版本操作时使用提供的 virtual git 子集

### 9.2 推荐的 prompt 组织方式

不要写成大段抽象告诫。  
应该由命令注册表自动生成一段**能力契约**：

```text
You are operating in a virtual shell inside Cloudflare Workers.

Supported command families:
- fs: pwd, ls, cat, head, tail, find, grep, rg, mkdir, rm, cp, mv, touch, tee
- net: curl (restricted subset)
- data: jq
- runtime: ts
- vcs: git status, git diff, git add, git commit, git log

Unsupported:
- arbitrary binaries
- package managers
- process control
- full POSIX behavior
- full Git behavior

Use browser tools for visual validation instead of shell commands.
```

### 9.3 prompt 的核心目标

不是“让模型知道限制”，而是：

> **把模型从“我在 Linux 上”修正为“我在一个 bash-shaped worker runtime 上”。**

这个目标更准确。

---

## 10. 如何通过 TypeScript 守卫强制对齐实现与承诺

如果没有 TS 守卫，fake bash 很快会变成“prompt 说一套，实现做一套”。

### 10.1 必须有的守卫层

#### 1. argv/schema guard

每个命令：

- 先 parse argv
- 再验证是否都在支持范围内
- 不支持立即报错

#### 2. path guard

所有路径都必须经过：

- normalize
- resolve against VFS
- mount boundary check
- writable/read-only check

#### 3. capability guard

命令执行前判断：

- 是否允许 `network`
- 是否允许 `fs-write`
- 是否允许 `vcs`
- 是否需要 approval

#### 4. quota/time guard

包括：

- 最大输出
- 最大文件大小
- 最大搜索结果数
- 最大网络响应体
- 最大脚本运行时间

#### 5. output contract guard

所有命令必须返回统一结构：

```ts
interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  metadata?: Record<string, unknown>;
}
```

#### 6. unsupported-surface guard

对未支持的 flag、子命令、语法，统一报：

- 清晰
- 可预测
- 可让模型学习

例如：

```text
git: subcommand 'rebase' is not supported in nano-agent virtual git
```

### 10.2 守卫的真正价值

TS 守卫的作用不是类型好看，而是：

1. **把 prompt 承诺落到执行层**
2. **把不支持项变成 deterministic 行为**
3. **防止 skill/service binding 各自发散**

### 10.3 一个关键原则

> **不要让 fake bash handler 直接触达底层服务。**

中间一定要有 capability adapter 层。  
否则：

- 网络策略会散
- 审计会散
- 错误风格会散
- prompt 无法稳定对齐

---

## 11. 对 just-bash 的终审评价

### 11.1 我认为它是什么级别的参考

我会把 `just-bash` 评价为：

> **一份非常强的 fake bash 参考实现，尤其适合学习“如何把 shell 变成受控 JS runtime”。**

它最值得学习的不是“它有哪些命令”，而是这几件事：

1. shell 要上 AST
2. FS 要抽象
3. command registry 要显式可枚举
4. network 必须 opt-in + allow-list
5. runtime 扩展必须 opt-in
6. threat model 要明文写出来

### 11.2 我认为它不适合直接成为 nano-agent 内核的原因

因为 nano-agent 的宿主世界不同：

- 不是 Node 主进程
- 不是本地 CLI
- 不是本地终端
- 不是宽松 worker_threads 环境
- 不是“给 shell 一个虚拟文件系统”就结束

nano-agent 需要的是：

- DO actor
- WebSocket session
- service binding orchestration
- KV/R2/state layering
- strict capability routing

`just-bash` 并没有为这个目标而设计。

### 11.3 终审结论

**结论：可以借鉴其架构思路，不建议直接照搬其运行时假设。**

---

## 12. 对 nano-agent 的 fake bash 心智模型可行性再评价

这是最关键的一节。

### 12.1 “改变 LLM 心智模型”这件事，能不能做？

我的判断是：

**不能彻底做成。**

你不能靠 system prompt 把一个强烈 Bash/FS/world-model 的 LLM，强行改造成完全理解 Worker isolate/DO/KV/R2 的系统。  
可以引导，但不能指望彻底重写。

所以你这次补充的核心命题是成立的：

> **既然 LLM 的操作先验很难被根治，就应该提供一个足够稳定的 fake bash / fake FS 兼容面。**

### 12.2 但“让 LLM 误认为自己在全功能环境内”要克制

这里我会补一个判断：

**可以让模型“感觉自己在熟悉环境中工作”，但不能让系统“假装自己什么都支持”。**

正确姿态是：

- **局部拟真**
- **边界清晰**
- **失败可学习**

而不是：

- “全功能 Linux 幻觉”

### 12.3 可行的心智模型转换

我建议 nano-agent 公开的心智模型应是：

> 你处在一个虚拟 shell 中。它支持常见 bash 风格的文件、搜索、网络、TS 脚本和版本工作流，但它不是完整 Linux。需要浏览器、远端服务或特殊能力时，请使用专门能力。

这是一种 **中间心智模型**：

- 足够接近 LLM 训练先验
- 又不会误导到不可收拾

### 12.4 最好的产品语言

不要说：

- “这就是 bash”
- “这是完整 shell”

应该说：

- “virtual bash”
- “worker shell”
- “compatibility shell”
- “sandboxed shell surface”

词汇很重要，因为它决定用户和模型的预期。

---

## 13. fake bash 落地后对整个项目价值的最终 verdict

### 13.1 如果 fake bash 做对，会发生什么

如果按本文建议实现：

- 外层 bash-compatible
- 内层 capability-native
- 明确最小命令集
- 强声明不支持
- registry / prompt / TS 守卫一体化

那么 fake bash 会给 nano-agent 带来非常实在的价值提升：

1. **显著降低 LLM 适配摩擦**
2. **显著降低 prompt 教学成本**
3. **让 nano-agent 更接近主流 agent 工作流**
4. **把 Worker 原生能力包装成更可用的 agent 表面**
5. **让 git / curl / grep / cat 这类关键操作变得自然**

### 13.2 如果 fake bash 做错，会发生什么

如果做成“无限接近真实 Linux”的方向，风险很大：

1. 工程复杂度暴涨
2. 用户和模型预期失控
3. Worker 限制不断反噬兼容性
4. 大量时间浪费在 shell edge case，而不是 nano-agent 真正的云原生能力上

### 13.3 我的最终 verdict

**最终 verdict：fake bash 对 nano-agent 不是装饰品，而是战略级兼容层；但它必须是“受限、声明式、Worker-native 的 bash 形状”，而不是“完整 Linux shell 的再实现”。**

我对它的最终判断如下：

| 维度 | 评价 |
|---|---|
| **必要性** | 高 |
| **工程价值** | 高 |
| **业务价值** | 高 |
| **实现风险** | 高 |
| **成功关键** | 外 bash、内 capability；最小命令集；强边界声明；registry/prompt/guard 对齐 |

一句话总结：

> **对 nano-agent 来说，fake bash 是吸收 LLM 先验的桥，不是系统真实内核。桥修得好，产品价值会明显上升；桥修成“伪 Linux”，项目会被兼容性反噬。**

因此，我对整个项目在引入 fake bash 之后的最终再确认是：

> **价值判断上升。**
>
> nano-agent 的路线因此更清晰：它不再只是“Cloudflare 上的 agent runtime”，而是“Cloudflare 上一个对 LLM 友好、对平台可治理的 virtual work shell + agent runtime”。这会让它相比纯 API 型 agent、更接近实际工作流；也相比本地 CLI 型 agent，更具平台化与服务化价值。
