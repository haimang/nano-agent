# Value Proposition Analysis — Fake Bash — by Opus

> 议题: nano-agent 的 fake bash 子系统
> 版本: **v2（基于 just-bash 真实源码的深度修订版）**
> 分析日期: `2026-04-15`
> 分析者: `Claude Opus 4.6 (1M context)`
> 关联文档:
> - `docs/value-proposition-analysis-by-opus.md` (CF Worker 运行时选型)
> - `docs/investigation/codex-by-opus.md`
> - `docs/investigation/claude-code-by-opus.md`
> - `docs/investigation/mini-agent-by-opus.md`
> 参考代码: `context/just-bash/`（Vercel Labs 维护、Cloudflare fork）
> 文档状态: `draft-v2`

> **版本说明**：本文 v1 建立在 README 级阅读之上；v2 在此基础上下钻到 just-bash 的真实源代码（`src/Bash.ts`、`src/types.ts`、`src/fs/interface.ts`、`src/commands/registry.ts`、`src/network/**`、`src/security/**`、`src/transform/**`、`src/browser.ts`、`src/limits.ts`、`src/custom-commands.ts` 等共约 5k 行样本），**每一条可借鉴点都给出精确的 file:line**，并据此重新定义 nano-agent 的 fake bash 骨架。v1 的结构被保留但大量内容被替换或重写。

---

## 目录（Table of Contents）

0. [背景与问题声明](#0-背景与问题声明)
1. [Just-bash 深度源码走读](#1-just-bash-深度源码走读)
   - 1.1 包结构与双入口（Node vs Browser）
   - 1.2 核心类型与接口 (`src/types.ts`)
   - 1.3 `Bash` 类的生命周期（`src/Bash.ts`）
   - 1.4 文件系统四件套的源码形态
   - 1.5 命令注册表与懒加载（`src/commands/registry.ts`）
   - 1.6 Custom Commands API（`src/custom-commands.ts`）
   - 1.7 执行限制（`src/limits.ts`）
   - 1.8 网络子系统（`src/network/**`）
   - 1.9 Transform Pipeline（`src/transform/**`）
   - 1.10 Defense-in-Depth（`src/security/defense-in-depth-box.ts`）
2. [可直接借鉴的代码清单（file:line 级）](#2-可直接借鉴的代码清单fileline-级)
3. [Nano-agent fake bash 骨架（基于源码的具体规划）](#3-nano-agent-fake-bash-骨架基于源码的具体规划)
   - 3.1 依赖策略：嵌入、fork 还是 vendor
   - 3.2 入口选择：`src/browser.ts` 为基础
   - 3.3 `R2BackedFs` / `DoStorageFs` 的实现骨架（实现 `IFileSystem`）
   - 3.4 `MountableFs` 组合：`/` + `/workspace` + `/.nano`
   - 3.5 Custom commands 清单（git / browser / do-alarm / kv / queue / ai）
   - 3.6 Transform plugins 清单（guard / tee / collector）
   - 3.7 执行限制调优（CF Worker 预算）
4. [Nano-agent 明确声明不支持的内容](#4-nano-agent-明确声明不支持的内容)
5. [声明式注册与三方对齐（registry × system prompt × TS guard）](#5-声明式注册与三方对齐registry--system-prompt--ts-guard)
6. [Worker 运行时适配的具体改造清单](#6-worker-运行时适配的具体改造清单)
7. [终审评价与最终 Verdict](#7-终审评价与最终-verdict)

---

## 0. 背景与问题声明

> 本节保留 v1 的立场，这部分与源码无关，不需要改。

**核心主张**：LLM 的心智模型是一等约束——它天生假设自己处在 Linux + bash + POSIX FS 环境里，prompt engineering 改不了这个先验。**解法是"不扭转，而是拟合"**：提供一个看起来足够像 bash 的虚拟 shell，让 LLM 拿熟悉武器工作，同时底层把命令映射到 Worker 可执行的形态（TS 原生 / service binding / CF native 能力）。

**v1 与 v2 的差别**：v1 的"fake bash"是一个概念方案；v2 把它具体化为 **"嵌入 just-bash（browser 入口）+ 自实现 `R2BackedFs` + 若干 customCommands + 若干 TransformPlugin + 自写的 registry-driven prompt"** 的明确工程骨架。每一块都有 just-bash 里可以直接对齐的源码。

---

## 1. Just-bash 深度源码走读

### 1.1 包结构与双入口（Node vs Browser）

just-bash 提供 **两个独立的入口文件**：

- **Node 入口**：`src/index.ts`（完整 API，含 `OverlayFs` / `ReadWriteFs` / `Sandbox` / defense-in-depth 的 `async_hooks` 集成）
- **Browser 入口**：`src/browser.ts:1-14`（**专门剔除 Node.js 模块**的子集）

源码证据（`src/browser.ts:1-14`）：

```ts
/**
 * Browser-compatible entry point for just-bash.
 *
 * Excludes Node.js-specific modules:
 * - OverlayFs (requires node:fs)
 * - ReadWriteFs (requires node:fs)
 * - Sandbox (uses OverlayFs)
 *
 * Note: The gzip/gunzip/zcat commands will fail at runtime in browsers
 * since they use node:zlib. All other commands work.
 */
```

这个分离**对 nano-agent 来说极其关键**——Cloudflare Worker 的 runtime 状况与 browser 类似：没有 `node:fs`、没有 `node:zlib`、没有 `node:async_hooks`（严格说 Workers 有部分 `node:async_hooks` polyfill，但不完全）。**我们的第一选择是 browser 入口**，而不是 Node 入口。这会让我们少踩大量 "Cannot find module 'node:fs'" 的坑。

**package.json 侧**（`package.json` 顶层）：`"type": "module"` + `"main": "dist/bundle/index.js"`，已经是纯 ESM，Worker 可以直接吃。

---

### 1.2 核心类型与接口 (`src/types.ts`)

`src/types.ts` 只有 210 行，把整个系统的 contract 定得很干净。几个关键类型：

**`ExecResult`**（`src/types.ts:13-26`）：
```ts
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  env?: Record<string, string>;
  stdoutEncoding?: "binary";
}
```
这就是 nano-agent 的 tool result 应有的形状——我们几乎可以原样复用，只需要再叠一层 `metadata`（见 `BashExecResult` at `src/types.ts:29-32`）用于暴露 Transform plugin 的产出。

**`CommandContext`**（`src/types.ts:103-192`）——这是一个**巨大的信息来源**，它定义了一个命令在执行时能拿到什么。几个我们会直接复用的字段：

| 字段 | 行号 | 对 nano-agent 的意义 |
|------|------|---------------------|
| `fs: IFileSystem` | 105 | 统一的文件系统抽象，我们的 `R2BackedFs` 实现这个 |
| `env: Map<string, string>` | 109 | **使用 `Map` 而不是 `Record`** 明确说明是为了"prevent prototype pollution"——这是 LLM 注入场景里的真实风险，直接沿用 |
| `exportedEnv?: Record<string, string>` | 115 | 与 bash 的 exported vs shell-local 语义一致，printenv/env 需要 |
| `limits?: Required<ExecutionLimits>` | 122 | 命令内部可以访问全局 limits，做自我 budget 控制 |
| `exec?(...)` | 135 | 命令可以回调执行子命令（`xargs`, `bash -c` 的基础）；nano-agent 的 `virtual-git` 需要这个才能内部调 `git-write-tree` 之类的子步骤 |
| `fetch?: SecureFetch` | 140 | 只有 network 配置后才存在——这是 opt-in 的典型实现 |
| `getRegisteredCommands?` | 146 | 用于 `help` 命令；nano-agent 可以用它构造 `/capabilities` slash command |
| `fileDescriptors?: Map<number, string>` | 158 | heredoc 与 process substitution 的实现原语 |
| `substitutionDepth?: number` | 168 | 防止 `$(...)` 栈爆炸 |
| `signal?: AbortSignal` | 179 | 协作式取消——这**完美对接** Worker 的 AbortController 语义 |
| `requireDefenseContext?: boolean` | 185 | 命令可以 assert 自己处于 defense context 里 |

**`Command` interface**（`src/types.ts:194-204`）：
```ts
export interface Command {
  name: string;
  trusted?: boolean;  // 命令可声明 "trusted"，会在 runTrustedAsync 里运行
  execute(args: string[], ctx: CommandContext): Promise<ExecResult>;
}
```
60 行的抽象就定义清楚一切——**这是我们应当照搬的理想 Tool 抽象**。比 claude-code 把 UI / permission / activity / render 都塞进 `Tool.ts` 那 650 行的接口好太多。

---

### 1.3 `Bash` 类的生命周期（`src/Bash.ts`）

934 行的 `Bash.ts` 是整个系统的入口编排。关键段落：

#### 1.3.1 构造函数：选项分层（`src/Bash.ts:286-480`）

构造函数按**6 个阶段**初始化：

1. **FS 初始化**（`Bash.ts:287-288`）：`const fs = options.fs ?? new InMemoryFs(options.files);` ——默认 `InMemoryFs`，但支持**传入任意 `IFileSystem` 实现**。这是我们塞 `R2BackedFs` 的口子。
2. **环境变量用 `Map` 建**（`Bash.ts:293-306`）：`new Map<string, string>([["HOME", ...], ["PATH", "/usr/bin:/bin"], ["IFS", " \t\n"], ...])` — 说明 env 从一开始就用 Map，符合 `src/types.ts:109` 的反 prototype-pollution 决策。
3. **Limits 解析**（`Bash.ts:309-321`）：调用 `resolveLimits()`，合并用户配置与默认值。
4. **SecureFetch 创建**（`Bash.ts:323-328`）：
   ```ts
   if (options.fetch) {
     this.secureFetch = options.fetch;
   } else if (options.network) {
     this.secureFetch = createSecureFetch(options.network);
   }
   ```
   两条路径：要么用户塞一个完整的 `SecureFetch`，要么给 `NetworkConfig` 让 just-bash 内部造一个。**对 nano-agent 这个 slot 非常重要**——我们可以传入一个**自己的 SecureFetch，在里面把 fetch 路由到 CF 的 service binding / 走 cf 特定 metadata**。
5. **Defense-in-depth 默认开**（`Bash.ts:340`）：`this.defenseInDepthConfig = options.defenseInDepth ?? true;` — 注意这个默认值，在 Worker 环境下我们需要显式 **`defenseInDepth: false`** 关掉它（见 §6）。
6. **命令注册阶段**（`Bash.ts:433-479`）：
   - 第一批：`createLazyCommands(options.commands)` 注册内建命令；`options.commands` 允许白名单（`Bash.ts:142-145` 的注释说明），可以用来**精简命令集**；
   - 第二批：网络命令**只在** `options.fetch || options.network` 时注册（`Bash.ts:438-442`）；
   - 第三批：python 命令**只在** `options.python` 时注册；
   - 第四批：javascript 命令**只在** `options.javascript` 时注册；
   - 第五批：**用户自定义命令注册在最后**（`Bash.ts:468-479`），这保证 customCommands **可以 override** 同名的内建命令——对 nano-agent 来说，这意味着我们可以写一个 `customCurl` 替换原版 `curl`（例如让它直接走 Worker 的全局 `fetch`，跳过 DNS lookup）。

#### 1.3.2 `exec()` 方法：核心执行路径（`src/Bash.ts:526-740`）

每次 `exec()` 是一次**隔离的 shell 启动**：

1. **全局命令计数**（`Bash.ts:530-542`）：`commandCount` 每次递增，超过 `maxCommandCount` 直接拒绝。这是我们防 LLM 打偏的最终保险。
2. **状态深拷贝**（`Bash.ts:602-618`）：
   ```ts
   const execState: InterpreterState = {
     ...this.state,
     env: execEnv,          // 新的 env Map
     cwd: newCwd,
     functions: new Map(this.state.functions),
     localScopes: [...this.state.localScopes],
     options: { ...this.state.options },
     hashTable: this.state.hashTable,   // hashTable 共享以保 PATH 缓存
     groupStdin: options?.stdin,
     signal: options?.signal,
     extraArgs: options?.args,
   };
   ```
   每次 exec 都有自己的 function 表、local 作用域、shell options，但 **fs 与 commands 是共享的**。这意味着 nano-agent 的一个 session = 一个 Bash 实例 + N 次 exec，**fs 状态是持久的**（跨 turn 保留），**shell-local 状态是每次 exec 重置的**（跨 turn 干净）。这正是我们要的语义。
3. **脚本归一化**（`Bash.ts:623-626`）：`normalizeScript` 会去掉缩进（对 heredoc 保留，需要 `rawScript: true`）。
4. **Transform 插件管线**（`Bash.ts:645-655`）：
   ```ts
   if (this.transformPlugins.length > 0) {
     let meta: Record<string, unknown> = Object.create(null);
     for (const plugin of this.transformPlugins) {
       const pluginResult = plugin.transform({ ast, metadata: meta });
       ast = pluginResult.ast;
       if (pluginResult.metadata) {
         meta = mergeToNullPrototype(meta, pluginResult.metadata);
       }
     }
     metadata = meta;
   }
   ```
   **AST 层面的链式改写 + metadata 合并**——这是我们做 dangerous-pattern-blocker、audit logger、command collector 的完整钩子。metadata 用 `Object.create(null)` 保持 null-prototype 是教科书式的防御。
5. **Interpreter 构造与执行**（`Bash.ts:658-678`）：`new Interpreter(interpreterOptions, execState).executeScript(ast)` — 这是实际执行的地方。
6. **Defense-in-Depth 包裹**（`Bash.ts:682-685`）：`if (defenseHandle) return await defenseHandle.run(executeScript); return await executeScript();` — DID 是可选地包在外面的一层。**Worker 不走 DID 的话，只是直接调 `executeScript()`，其他逻辑都保留**。
7. **错误分类**（`Bash.ts:686-740`）：`ExitError / PosixFatalError / ArithmeticError / ExecutionAbortedError` 分别映射到不同 exitCode——`ExecutionAbortedError` 映射到 124（与 Unix `timeout` 一致）。这个错误分类可以直接抄给 nano-agent 的 error category 列表用。

---

### 1.4 文件系统四件套的源码形态

`src/fs/interface.ts:116-262` 定义了 `IFileSystem` 接口——**这是 nano-agent fake bash 的核心抽象**。接口约 30 个方法，全部是 async，关键设计：

- **明确禁止 sync 方法**（`src/fs/interface.ts:117`）：`// Note: Sync method are not supported and must not be added.` —— 对应 Worker 环境的"所有 I/O 必须是 async"的强约束。
- **`readFile` 同时有字符串版与二进制版**（`interface.ts:122-131`）：二进制版返回 `Uint8Array`，字符串版带 encoding 选项。这让我们在实现 `R2BackedFs` 时可以**一次 R2 fetch**，根据调用方选择解码或原始 bytes。
- **`readdirWithFileTypes?`** 是 optional（`interface.ts:181`）—— 这是性能优化点：支持 `Dirent` 的 fs 可以**一次拿到 type**，不需要对每个 entry 再 `stat` 一次。对我们的 `R2BackedFs` 来说，R2 list 已经返回对象级 metadata，直接映射成 `Dirent` 就好。
- **`InitialFiles` 支持 lazy 函数**（`interface.ts:276-287`）：
  ```ts
  export type LazyFileProvider = () =>
    | string
    | Uint8Array
    | Promise<string | Uint8Array>;

  export type InitialFiles = Record<
    string,
    FileContent | FileInit | LazyFileProvider
  >;
  ```
  **这是"R2 对象即虚拟文件"的原生支持**——我们可以在启动时给每个 R2 对象创建一个 `LazyFileProvider`，实际读取时才调 R2。InMemoryFs 里的处理见 `src/fs/in-memory-fs/in-memory-fs.ts:80-95` 的 `writeFileLazy` 路径。

四种实现的大小与 Worker 兼容性：

| 实现 | 文件 | 行数 | Worker 兼容 |
|------|------|------|-------------|
| `InMemoryFs` | `src/fs/in-memory-fs/in-memory-fs.ts` | 768 | ✅ 纯内存，可直接用 |
| `MountableFs` | `src/fs/mountable-fs/mountable-fs.ts` | 656 | ✅ 纯组合器，可直接用 |
| `OverlayFs` | `src/fs/overlay-fs/overlay-fs.ts` | 1436 | ❌ 依赖 `node:fs` |
| `ReadWriteFs` | `src/fs/read-write-fs/read-write-fs.ts` | 895 | ❌ 依赖 `node:fs` |

**对 nano-agent**：我们直接用 `InMemoryFs` + `MountableFs` + 一个自写的 `R2BackedFs`。不需要 `OverlayFs` / `ReadWriteFs`，browser 入口已经把它们排除了。

#### 1.4.1 `MountableFs` 的 routing 机制（`src/fs/mountable-fs/mountable-fs.ts:182-221`）

```ts
private routePath(path: string): { fs: IFileSystem; relativePath: string } {
  validatePath(path, "access");
  const normalized = normalizePath(path);

  // Find longest matching mount point
  let bestMatch: MountEntry | null = null;
  let bestMatchLength = 0;

  for (const entry of this.mounts.values()) {
    const mp = entry.mountPoint;
    if (normalized === mp) return { fs: entry.filesystem, relativePath: "/" };
    if (normalized.startsWith(`${mp}/`)) {
      if (mp.length > bestMatchLength) {
        bestMatch = entry;
        bestMatchLength = mp.length;
      }
    }
  }

  if (bestMatch) {
    const relativePath = normalized.slice(bestMatchLength);
    return { fs: bestMatch.filesystem, relativePath: relativePath || "/" };
  }

  return { fs: this.baseFs, relativePath: normalized };
}
```

**最长前缀匹配** + **回退到 base fs**。这正是 nano-agent 需要的三层挂载的实现原语：

```
base = InMemoryFs (快速临时区)
mounts:
  /workspace  → R2BackedFs  (持久工作区)
  /.nano      → DoStorageFs (会话元数据)
```

`/.nano/git/HEAD` 会路由到 `DoStorageFs`，`/workspace/src/foo.ts` 会路由到 `R2BackedFs`，`/tmp/build.log` 会落到 `InMemoryFs`，完全不用写 if-else。

挂载点的防御规则（`mountable-fs.ts:152-178`）：
- **不能在 `/` 挂载**（避免替换整个根）
- **不能嵌套挂载**（`/a` 不能挂载在已挂载的 `/a/b` 里，也不能被 `/a/b` 覆盖）

这些规则是 nano-agent 要沿用的。

---

### 1.5 命令注册表与懒加载（`src/commands/registry.ts`）

644 行的 `registry.ts` 最大的特点是**静态可分析的 lazy loader**（`registry.ts:1-2` 的注释）：

```ts
// Each command has an explicit loader function for bundler compatibility (Next.js, etc.)
interface LazyCommandDef<T extends string = string> {
  name: T;
  load: CommandLoader;
}

const commandLoaders: LazyCommandDef<CommandName>[] = [
  { name: "echo", load: () => import("./echo/...") },
  { name: "cat",  load: () => import("./cat/...") },
  // ...
];
```

**每一个 `import()` 都是字面量字符串**——这是让 esbuild / Vite / wrangler 能做 code-splitting 的前提。对 Worker 尤其重要，因为 Worker 打包后的 script 大小有上限（50 KB 压缩 / 10 MB 解压），**我们不希望 80 个命令全部打进同一个 bundle**。

`CommandName` 类型（`registry.ts:15-98`）是一个 **84 项的字符串字面量联合**——这意味着 TypeScript 侧可以对 `options.commands?: CommandName[]` 做穷尽检查，写错命令名编译期就报错。nano-agent 的 registry 也应照此办理。

三类分支加载（`registry.ts:100-114`）：
```ts
export type NetworkCommandName = "curl";
export type PythonCommandName = "python3" | "python";
export type JavaScriptCommandName = "js-exec" | "node";

export type AllCommandName =
  | CommandName
  | NetworkCommandName
  | PythonCommandName
  | JavaScriptCommandName;
```
和分别的 `createNetworkCommands() / createPythonCommands() / createJavaScriptCommands()` 工厂。**按能力分组 + 按需注册** 是 nano-agent 该抄的结构。

---

### 1.6 Custom Commands API（`src/custom-commands.ts`）

`custom-commands.ts` 只有 68 行，提供两类 API：

**`defineCommand`**（`src/custom-commands.ts:44-49`）：
```ts
export function defineCommand(
  name: string,
  execute: (args: string[], ctx: CommandContext) => Promise<ExecResult>,
): Command {
  return { name, trusted: true, execute };
}
```
**`trusted: true` 是默认值**——这是个重要细节，说明作者把 customCommands 视为**宿主信任的扩展**，会在 `DefenseInDepthBox.runTrustedAsync()` 里执行（能访问 Node globals）。对 nano-agent 来说**恰好对齐**：我们自己写的 `gitCmd`、`browserCmd` 等就是可信代码，它们**应该**能访问 `env.R2_WORKSPACE`、`env.BROWSER_BINDING` 这些 Worker bindings，而不能被 DID 拦下来。

**`LazyCommand` + `createLazyCustomCommand`**（`custom-commands.ts:55-67`）：
```ts
export function createLazyCustomCommand(lazy: LazyCommand): Command {
  let cached: Command | null = null;
  return {
    name: lazy.name,
    trusted: true,
    async execute(args, ctx) {
      if (!cached) cached = await lazy.load();
      return cached.execute(args, ctx);
    },
  };
}
```
**用于代码分片**——nano-agent 的 `browser` 命令（几百 KB 的 screenshot 处理代码）应该用这个，避免冷启动时加载。

在 `Bash.ts:468-479` 构造函数里的使用：
```ts
if (options.customCommands) {
  for (const cmd of options.customCommands) {
    if (isLazyCommand(cmd)) {
      this.registerCommand(createLazyCustomCommand(cmd));
    } else {
      this.registerCommand({
        ...cmd,
        trusted: cmd.trusted ?? true,
      });
    }
  }
}
```
——顺序是"内建命令先注册，自定义命令后注册"，**后者会覆盖同名前者**。这让 nano-agent 可以做"温和替换"——保留 `curl` 的语义但换成自己的实现。

---

### 1.7 执行限制（`src/limits.ts`）

138 行的 `limits.ts` 提供 18 种限制（`src/limits.ts:12-66`），**每一种都是独立可配置的**：

| 限制 | 默认值 | 对 Worker 的含义 |
|------|--------|------------------|
| `maxCallDepth` | 100 | 函数递归保护，Worker 栈够用 |
| `maxCommandCount` | 10 000 | **每次 exec 硬上限**，防 fork bomb 与 LLM 坏循环 |
| `maxLoopIterations` | 10 000 | bash while/for/until |
| `maxAwkIterations` | 10 000 | awk 内部 |
| `maxSedIterations` | 10 000 | sed branch loop |
| `maxJqIterations` | 10 000 | jq until/while/repeat |
| `maxSqliteTimeoutMs` | 5 000 | sqlite3 wall clock |
| `maxPythonTimeoutMs` | 10 000（network 时 60 000） | CPython WASM |
| `maxJsTimeoutMs` | 10 000（network 时 60 000） | QuickJS WASM |
| `maxGlobOperations` | 100 000 | glob 展开 |
| `maxStringLength` | 10 MB | 单个字符串上限 |
| `maxArrayElements` | 100 000 | 数组 |
| `maxHeredocSize` | 10 MB | heredoc |
| `maxSubstitutionDepth` | 50 | `$(...)` 栈 |
| `maxBraceExpansionResults` | 10 000 | `{a,b,c}` 展开 |
| `maxOutputSize` | 10 MB | 总输出 |
| `maxFileDescriptors` | 1024 | 文件描述符 |
| `maxSourceDepth` | 100 | `source` 嵌套 |

**对 nano-agent 的调优**（我们必须 override 多个默认值）：
- `maxOutputSize` → **1 MB**（Worker 128 MB 堆，tool result 回注 LLM 上下文，不能太大）
- `maxStringLength` → **2 MB**
- `maxHeredocSize` → **2 MB**
- `maxCommandCount` → **1 000**（单次 exec 如果打到 1000 命令，LLM 基本是坏了）
- `maxCallDepth` → **30**
- `maxJsTimeoutMs` / `maxPythonTimeoutMs` → 走 service binding 的话这里不适用，由子 worker 自己设超时

**核心洞察**：所有限制都在 `Bash` 构造时一次性 resolve（`Bash.ts:309-321`），然后挂在 interpreter 里每一步自动检查——**我们只需要写 override，不用手动实现限制机制**。这是 just-bash 给我们的第一份"免费礼物"。

---

### 1.8 网络子系统（`src/network/**`）

网络层是 just-bash 里最工程化的子系统之一，四个文件共 ~900 行。

#### 1.8.1 `NetworkConfig` 的 contract（`src/network/types.ts:54-134`）

| 字段 | 行号 | 说明 |
|------|------|------|
| `allowedUrlPrefixes` | 86 | 允许的 URL 前缀列表；可以是字符串或 `AllowedUrl` 对象（带 transform） |
| `allowedMethods` | 92 | 默认 `["GET", "HEAD"]`，其他方法要显式开 |
| `dangerouslyAllowFullInternetAccess` | 98 | 逃生舱 |
| `maxRedirects` | 103 | 默认 20 |
| `timeoutMs` | 108 | 默认 30 000 |
| `maxResponseSize` | 114 | 默认 10 MB |
| `denyPrivateRanges` | 126 | 阻止 private/loopback IP 的 host（反 SSRF / DNS rebinding） |

**`RequestTransform`**（`types.ts:32-34`）：
```ts
export interface RequestTransform {
  headers: Record<string, string>;
}
```
这是**凭据注入**的关键——transform 里的 header 在 fetch 边界注入，**凭据永远不进入沙盒环境变量**。对 nano-agent 非常合适：`Authorization: Bearer <secret>` 应该挂在 transform 里，而不是塞到 `options.env`。

错误类型（`types.ts:149-201`）：`NetworkAccessDeniedError` / `TooManyRedirectsError` / `RedirectNotAllowedError` / `MethodNotAllowedError` / `ResponseTooLargeError`——分类明确，直接沿用。

#### 1.8.2 `createSecureFetch` 的实现（`src/network/fetch.ts:76-401`）

关键路径：

1. **入口校验**（`fetch.ts:80-85`）：
   ```ts
   if (!config.dangerouslyAllowFullInternetAccess) {
     const errors = validateAllowList(entries);
     if (errors.length > 0) throw new Error(`Invalid network allow-list:\n...`);
   }
   ```
   配置时 fail-fast，不容忍悄悄失败的 allow-list。

2. **`getFirewallHeaders`**（`fetch.ts:99-121`）：按 URL 前缀匹配找到适用的 transform，按出现顺序**后者覆盖前者**地合并 headers。这让"路径越窄的规则优先级越高"。

3. **`checkAllowed`**（`fetch.ts:139-196`）做两件事：
   - URL 前缀匹配
   - `denyPrivateRanges` 时做**双重检查**：
     - 词法检查：`isPrivateIp(parsed.hostname)` 快速过滤 IP 字面量 + `localhost`
     - DNS 解析检查：对域名做 DNS lookup，检查解析结果是否命中私有段——**反 DNS rebinding**（`fetch.ts:161-190`）
   - DNS 失败时 fail-closed（默认拒绝）

4. **`secureFetch` 主函数**（`fetch.ts:216-330` 片段）：
   - 检查 URL 与 method
   - **手动处理 redirect** (`redirect: "manual"`)：因为 fetch 原生的 redirect 会绕过我们的 allow-list，必须手动接管
   - 每次 redirect 重新调 `checkAllowed(redirectUrl)`
   - 使用 `DefenseInDepthBox.runTrustedAsync(() => fetch(...))` 把 fetch 本身放在可信上下文里（**因为 Headers 构造可能触发 undici 的 WASM 初始化**，需要这层保护）

#### 1.8.3 `allow-list.ts` 的 URL 前缀匹配（`src/network/allow-list.ts:59-112`）

```ts
function matchesPathPrefix(pathname: string, pathPrefix: string): boolean {
  if (pathPrefix === "/" || pathPrefix === "") return true;
  if (pathPrefix.endsWith("/")) return pathname.startsWith(pathPrefix);
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
}

export function matchesAllowListEntry(url: string, allowedEntry: string): boolean {
  const parsedUrl = parseUrl(url);
  if (!parsedUrl) return false;
  const normalizedEntry = normalizeAllowListEntry(allowedEntry);
  if (!normalizedEntry) return false;
  if (parsedUrl.origin !== normalizedEntry.origin) return false;
  if (
    normalizedEntry.pathPrefix !== "/" &&
    normalizedEntry.pathPrefix !== "" &&
    hasAmbiguousPathSeparators(parsedUrl.pathname)   // 拒绝 %2f / %5c / \
  ) return false;
  return matchesPathPrefix(parsedUrl.pathname, normalizedEntry.pathPrefix);
}
```
**以"path segment boundary"为粒度**（而不是 raw string prefix）——所以 `https://api.example.com/v1` 允许 `.../v1/users` 但**不允许** `.../v10`。这是**一类常见的规则绕过漏洞**，作者考虑到了。另外，**拒绝 `%2f` / `%5c` / `\`** 这种 ambiguous 编码（`allow-list.ts:50-57`）——也是常见的 CVE 类别。

**对 nano-agent 的直接价值**：我们**完全照搬** `NetworkConfig` + `createSecureFetch`，但要**替换一个关键点**——`dnsLookup` 在 `fetch.ts:10` 来自 `node:dns`，Worker 里没有。这里有两条路：
1. 把 `denyPrivateRanges: false` 作为默认（因为 Worker 本身不太可能访问 private 网段，CF runtime 拦截掉了）；
2. 用 `config._dnsResolve` 注入自己的 DNS 实现（`types.ts:129-133` 提供了这个后门，`fetch.ts:133` 读取它）——我们可以传一个 no-op，反正 Worker 的 fetch 自己会走 CF edge resolver，不需要 DNS 层再查一次。

---

### 1.9 Transform Pipeline（`src/transform/**`）

#### 1.9.1 类型（`src/transform/types.ts:1-29`）

```ts
export interface TransformPlugin<TMetadata extends object = Record<string, unknown>> {
  name: string;
  transform(context: TransformContext): TransformResult<TMetadata>;
}

export interface TransformContext {
  ast: ScriptNode;
  metadata: Record<string, unknown>;
}

export interface TransformResult<TMetadata> {
  ast: ScriptNode;
  metadata?: TMetadata;
}
```
**每个插件接收 AST + metadata，返回（可能改写过的）AST + 自己的 metadata**——链式组合，和 webpack loader / vite plugin 的心智是一致的。

#### 1.9.2 内建插件 `CommandCollectorPlugin`（`src/transform/plugins/command-collector.ts`）

走 AST 递归（`walkScript` → `walkStatement` → `walkPipeline` → `walkCommand`），收集所有出现过的命令名到 `Set`，最后返回 `{ commands: sorted[] }`。对 nano-agent 的价值：**无侵入地知道 LLM 在一次 exec 里用了哪些命令**，可以直接落盘到 DO storage 做统计与反馈（见 §5 的"动态反馈回路"）。

#### 1.9.3 内建插件 `TeePlugin`

在 AST 层给每个命令前后插入 tee 重定向，把 stdout/stderr 自动旁路到指定目录的日志文件。这是 nano-agent 的**可观测性神器**——我们不用改任何命令实现，就能拿到"每一步的输入输出"的细粒度 trace，再由下游系统（DO / R2 / KV）消费。

#### 1.9.4 Bash 侧的调用（`src/Bash.ts:645-655`，见 §1.3.2 第 4 步）

`Bash` 类有 `registerTransformPlugin(plugin)` 方法把插件挂进去；每次 `exec()` 时依次应用，metadata 用 `mergeToNullPrototype` 合并。**插件可以改 AST 也可以只读 AST**——两种职责都干净支持。

---

### 1.10 Defense-in-Depth（`src/security/defense-in-depth-box.ts`）

`defense-in-depth-box.ts` 有 2006 行，是 just-bash 最厚重的单文件之一。它的本质是：**用 `AsyncLocalStorage` 追踪"当前是否在 bash.exec() 里"，在 exec 期间 monkey-patch 危险 globals（`Function` / `eval` / `setTimeout` / `process.*` / `Module._resolveFilename` / 等），exec 结束后恢复**。

**关键源码事实**（`defense-in-depth-box.ts:77-85`）：
```ts
// Only load AsyncLocalStorage in Node.js (not in browser builds).
// Uses require() instead of a static import so that esbuild can
// dead-code-eliminate this block in browser builds (static imports
// cannot be tree-shaken even when unused).
if (!IS_BROWSER) {
  try {
    const { AsyncLocalStorage } = require("node:async_hooks");
    // ...
  }
}
```

**`__BROWSER__` 宏**是打包时 esbuild 通过 `--define:__BROWSER__=true` 注入的（`defense-in-depth-box.ts:42-47`）。在 browser build 里，`IS_BROWSER === true`，DID 的核心机制变成**no-op**——它的 `activate()` 返回空 handle，`runTrustedAsync` 只是直接执行回调。

**对 nano-agent 的含义**（关键事实）：**Worker 环境下 DID 不起作用，即使我们开启 `defenseInDepth: true` 也无实质防护**。这不是 just-bash 的 bug——它只是在 Node 环境下才能靠 `async_hooks` 做上下文感知。Worker 的 `node:async_hooks` polyfill 是否完整够用，Cloudflare 官方未承诺。

**我们的结论**：
1. **browser 入口**下显式设 `defenseInDepth: false`，减少不必要的包体积与对 runtime 的期待（`Bash.ts:340` 的默认是 true，我们必须显式覆盖）；
2. 把 DID 的作用**替换**为 Worker-native 的安全边界——**每个 capability-style custom command 自己做权限检查**（`context.env` / service binding 的可见性本身就是 capability 隔离）；
3. 对 `js-exec` 类运行时的需求，**完全通过 service binding 到独立 sandbox worker** 实现，不依赖进程内 QuickJS WASM（见 §6）。

---

## 2. 可直接借鉴的代码清单（file:line 级）

> 这是给未来实现阶段的"参考书签"，每一项都注明**我们要沿用 / 改造 / 避开**。

### 2.1 直接沿用（vendored，不修改或最小修改）

| # | 内容 | 源位置 | 沿用方式 |
|---|------|-------|---------|
| 1 | `ExecResult` / `BashExecResult` 类型 | `src/types.ts:13-32` | 作为 nano-agent tool result 的基础类型，可能在 metadata 字段上做扩展 |
| 2 | `Command` interface + `trusted` 字段语义 | `src/types.ts:194-204` | nano-agent 的内部工具抽象直接沿用这三行接口 |
| 3 | `CommandContext` 字段集合 | `src/types.ts:103-192` | 作为我们 customCommand 的上下文类型 |
| 4 | `defineCommand` + `createLazyCustomCommand` 工厂 | `src/custom-commands.ts:44-67` | 写 nano-agent 的 `gitCmd` / `browserCmd` / `kvCmd` 的模板 |
| 5 | `IFileSystem` 接口（~30 方法） | `src/fs/interface.ts:116-262` | 我们的 `R2BackedFs` / `DoStorageFs` 实现这个接口 |
| 6 | `InitialFiles` + `LazyFileProvider` 类型 | `src/fs/interface.ts:267-287` | R2 对象懒加载的类型基础 |
| 7 | `InMemoryFs` 整个实现 | `src/fs/in-memory-fs/in-memory-fs.ts` (768 行) | 作为 nano-agent 的 `/tmp` 临时区 |
| 8 | `MountableFs` 整个实现（含 routing 与防御） | `src/fs/mountable-fs/mountable-fs.ts:63-656` | 作为 nano-agent 的 `/` + `/workspace` + `/.nano` 三层挂载的容器 |
| 9 | `NetworkConfig` + `AllowedUrl` + `RequestTransform` | `src/network/types.ts:32-134` | nano-agent 的 network 配置类型 |
| 10 | `createSecureFetch` 主函数 | `src/network/fetch.ts:76-330` | **fetch 侧唯一修改**：把 `node:dns` 依赖去掉（见下方） |
| 11 | `allow-list.ts` 的 path-prefix 匹配 | `src/network/allow-list.ts:59-112` | 反 `%2f`/`%5c` + path boundary 规则，**全套沿用** |
| 12 | 错误类型：`NetworkAccessDeniedError / RedirectNotAllowedError / TooManyRedirectsError / MethodNotAllowedError / ResponseTooLargeError` | `src/network/types.ts:149-201` | 直接重用，不改 |
| 13 | `TransformPlugin` 接口与 pipeline 类型 | `src/transform/types.ts:1-29` | 写 nano-agent 的 guard / audit 插件的 shape |
| 14 | `CommandCollectorPlugin` 整个实现 | `src/transform/plugins/command-collector.ts` | 直接注册进 nano-agent，落盘到 DO storage |
| 15 | `TeePlugin` 整个实现 | `src/transform/plugins/tee-plugin.ts` | 直接注册，做可观测性 |
| 16 | `ExecutionLimits` 字段定义 | `src/limits.ts:12-66` | nano-agent 直接用这 18 个字段，只 override 默认值 |
| 17 | `resolveLimits()` 的合并策略 | `src/limits.ts:97-137` | 沿用，不改 |
| 18 | 环境变量用 `Map` 防 prototype pollution 的约定 | `src/types.ts:109` + `src/Bash.ts:293` | nano-agent 的会话 env 也用 Map |
| 19 | `exec()` 内每次深拷贝状态的隔离模式 | `src/Bash.ts:602-618` | 保留"shell-local 每次 reset，fs 状态持久"的语义 |
| 20 | 错误分类映射到 exitCode（124 = aborted / 1 = arith / …） | `src/Bash.ts:686-740` | 与真 bash 一致 |

### 2.2 改造后使用（需要 Worker 适配）

| # | 内容 | 源位置 | 改造点 |
|---|------|-------|--------|
| 21 | `createSecureFetch` 的 DNS lookup | `src/network/fetch.ts:10`（`import { lookup as dnsLookup } from "node:dns"`）+ `fetch.ts:133` | **替换**：让 nano-agent 构造时传入 `config._dnsResolve: async () => []`，同时默认 `denyPrivateRanges: false`（CF edge 已经拦截 private range） |
| 22 | `Bash` 构造函数的 `fs` slot | `src/Bash.ts:287-288` | **注入** `MountableFs({ base: InMemoryFs, mounts: [{ "/workspace", R2BackedFs }, { "/.nano", DoStorageFs }] })` |
| 23 | `Bash` 的 `defenseInDepth` 默认值 | `src/Bash.ts:340`（`options.defenseInDepth ?? true`） | **显式关闭**：`new Bash({ defenseInDepth: false })`，避免无效代码路径 |
| 24 | `initFilesystem` 在 Worker 里的行为 | `src/fs/init.ts`（被 `Bash.ts:418-423` 调用） | 只有 InMemoryFs 时执行，其他路径会跳过；我们的 MountableFs 的 base 是 InMemoryFs，这一步会正常建标准目录 |
| 25 | `gzip/gunzip/zcat` 命令 | `src/commands/gzip/*`（依赖 `node:zlib`，`src/browser.ts:10` 的注释提醒在 browser 里会 runtime fail） | **从 nano-agent 的命令白名单里去掉**，或者用 CompressionStream/DecompressionStream 重写一个 customCommand `gzipWorker` |
| 26 | `SecureFetch` 的 body 读取 | `src/network/fetch.ts:298` `responseToResult` | 检查是否会触发 `node:buffer` 或 `node:stream` 路径；如果会，改成 `response.arrayBuffer()` |
| 27 | `Bash.ts` 的 `logger` 参数 | `src/Bash.ts:337, 506-514` | 我们传入一个把日志 push 到 DO storage 的 logger |
| 28 | `options.commands` 白名单 | `src/Bash.ts:142-145` + `Bash.ts:433` | **显式传入只有我们允许的命令子集**，例如不含 `python3`、不含 `node`、不含 `gzip` |

### 2.3 主动避开（不要吞进 nano-agent）

| # | 内容 | 源位置 | 为什么避开 |
|---|------|-------|-----------|
| 29 | `OverlayFs` | `src/fs/overlay-fs/overlay-fs.ts`（1436 行） | 依赖 `node:fs`；nano-agent 不需要"磁盘 overlay" |
| 30 | `ReadWriteFs` | `src/fs/read-write-fs/read-write-fs.ts`（895 行） | 同上 |
| 31 | `Sandbox` 类 | `src/sandbox/**` | 是 `@vercel/sandbox` API 兼容层，不是 sandbox 实现 |
| 32 | Defense-in-Depth 在 browser 里的 no-op 代码 | `src/security/defense-in-depth-box.ts:77-85` 的 `!IS_BROWSER` 分支 | 在 Worker 环境下这条路径是 no-op，显式关闭它避免混淆 |
| 33 | CPython WASM (`python3/python`) | `src/commands/python3/**` | Worker 无 worker_threads + 512MB WASM 内存超预算；改用 service binding 到 py-runner |
| 34 | QuickJS (`js-exec`) 在主 isolate | `src/commands/js-exec/**` | 同上，改用 service binding |
| 35 | `sqlite3` (sql.js) | `src/commands/sqlite3/**` | Workers 上 sql.js 可行但内存吃紧；推荐改为调用 **D1 绑定** 做 `customCommand` |
| 36 | `curl` 里的 undici 相关代码 | `src/network/fetch.ts:244-265`（`runTrustedAsync` 包 `fetch` 是因为 undici WASM 初始化） | Worker 的 `fetch` 不是 undici，没有这个 init 问题；但保留这段代码也无害 |

---

## 3. Nano-agent fake bash 骨架（基于源码的具体规划）

### 3.1 依赖策略：嵌入、fork 还是 vendor？

三条路径：

| 策略 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **npm 依赖** `just-bash` | 升级方便 | 包含我们不需要的代码（OverlayFs/ReadWriteFs/Sandbox/python/js-exec），bundle 变大；DID 默认开 | ⭐⭐☆ |
| **Fork + 改造** | 完全控制 | 维护分叉成本；失去上游更新 | ⭐⭐☆ |
| **Vendor + 重新打包** 选择性地 copy 我们需要的文件 | 体积最小，Worker 兼容性可控 | 一次性工程，需要明确复制边界 | ⭐⭐⭐⭐ |

**推荐 vendor 策略**，理由：
- 我们对 bundle 大小非常敏感（Worker 压缩 50 KB / 解压 10 MB 的上限），要尽可能精简；
- 我们明确知道哪些文件不要（见 §2.3）；
- 上游版本说明 "beta software, use at your own risk"，不是一个稳定 API，本来就不适合长期 npm 依赖。

**vendor 的具体清单**（按 §1 走读得出）：
```
nano-agent/
├── src/
│   └── fake-bash/
│       ├── vendor/                    ← 从 just-bash/src/ 精选复制
│       │   ├── Bash.ts                ← 主类
│       │   ├── types.ts               ← 核心类型
│       │   ├── limits.ts              ← 限制定义与 resolver
│       │   ├── custom-commands.ts     ← defineCommand 工厂
│       │   ├── ast/                   ← AST 类型
│       │   ├── parser/                ← 完整 parser
│       │   ├── interpreter/           ← 完整 interpreter
│       │   ├── commands/              ← 精选命令子目录（非 gzip/python/js-exec）
│       │   ├── commands/registry.ts   ← 按我们的白名单裁剪 CommandName
│       │   ├── fs/
│       │   │   ├── interface.ts       ← IFileSystem 接口
│       │   │   ├── path-utils.ts
│       │   │   ├── encoding.ts
│       │   │   ├── in-memory-fs/      ← 整份复制
│       │   │   └── mountable-fs/      ← 整份复制
│       │   ├── network/               ← 整份复制（除 node:dns 的 import）
│       │   ├── transform/             ← 整份复制
│       │   ├── helpers/
│       │   └── timers.ts
│       ├── fs/
│       │   ├── r2-backed-fs.ts        ← 新写
│       │   └── do-storage-fs.ts       ← 新写
│       ├── commands/
│       │   ├── virtual-git.ts         ← 新写（customCommand）
│       │   ├── browser.ts             ← 新写（service binding）
│       │   ├── do-alarm.ts            ← 新写
│       │   ├── kv.ts                  ← 新写
│       │   ├── queue.ts               ← 新写
│       │   └── ai.ts                  ← 新写
│       ├── transform/
│       │   └── danger-blocker.ts      ← 新写（TransformPlugin）
│       ├── registry.ts                ← NANO_COMMAND_REGISTRY 声明式表
│       └── index.ts                   ← 统一入口
```

---

### 3.2 入口选择：`src/browser.ts` 为基础

**对齐事实**（`src/browser.ts:1-14`）：browser 入口已经**明确剔除**了 OverlayFs / ReadWriteFs / Sandbox，并提示 gzip 会在 browser 里运行时失败。Worker 运行时与 browser 最接近（缺 `node:*` 模块），所以我们**以 browser 入口为起点**，然后在 customCommands 侧补齐我们自己的命令。

**具体步骤**：
1. 把 `src/browser.ts` 的 exports 清单作为我们 `nano-agent/src/fake-bash/vendor/browser.ts` 的基线；
2. 去掉 `gzip/gunzip/zcat` 相关命令（在 `commands/registry.ts` 的 `commandLoaders` 里删除对应 entry）；
3. 保留 `curl` 但替换 `fetch.ts` 的 `node:dns` 导入；
4. 保留 `network` 所有类型、allow-list、secureFetch 主逻辑。

---

### 3.3 `R2BackedFs` / `DoStorageFs` 的实现骨架（实现 `IFileSystem`）

**目标接口**：`src/fs/interface.ts:116-262` 的 `IFileSystem`（约 30 个 async 方法）。

**R2BackedFs 实现要点**：

```ts
// nano-agent/src/fake-bash/fs/r2-backed-fs.ts

import type { IFileSystem, FsStat, ... } from "../vendor/fs/interface.js";

export class R2BackedFs implements IFileSystem {
  constructor(private bucket: R2Bucket, private rootPrefix: string = "") {}

  async readFile(path: string, options?: ...): Promise<string> {
    const obj = await this.bucket.get(this.keyFor(path));
    if (!obj) throw new Error(`ENOENT: ${path}`);
    return await obj.text();
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const obj = await this.bucket.get(this.keyFor(path));
    if (!obj) throw new Error(`ENOENT: ${path}`);
    return new Uint8Array(await obj.arrayBuffer());
  }

  async writeFile(path: string, content: FileContent, ...): Promise<void> {
    await this.bucket.put(this.keyFor(path), content);
  }

  async readdir(path: string): Promise<string[]> {
    const listed = await this.bucket.list({ prefix: this.keyFor(path) + "/" });
    return listed.objects.map(o => o.key.slice(...));
  }

  async readdirWithFileTypes?(path: string): Promise<DirentEntry[]> {
    // 一次 list 就能拿到所有元数据，符合 interface.ts:176-181 的性能优化点
  }

  async stat(path: string): Promise<FsStat> {
    const head = await this.bucket.head(this.keyFor(path));
    if (!head) throw new Error(`ENOENT: ${path}`);
    return { isFile: true, isDirectory: false, ..., size: head.size, mtime: head.uploaded };
  }

  // ... 其他 ~25 方法
  // symlink / realpath / chmod 可以直接 throw EPERM（Worker 不需要这些）
}
```

**关键设计决定**：
- **路径 → R2 key 的映射** 由构造时的 `rootPrefix` 决定，例如 `rootPrefix = "sessions/abc123/workspace"`；
- **目录是"前缀"而不是对象**——`readdir("/")` = `bucket.list({ prefix: "sessions/abc123/workspace/" })`；
- **symlink / hardlink 全部 throw EPERM**，与 just-bash 的 default-deny symlinks 策略一致（CLAUDE.md 中的"Filesystem Security: Default-Deny Symlinks"段落说 OverlayFs / ReadWriteFs 都默认拒绝，我们更进一步直接不支持）；
- **chmod / utimes / readlink / lstat** 返回固定值或 throw——R2 没有这些概念。

**DoStorageFs 实现要点**：以 DO 的 `state.storage` 作为后端，key = path，value = content；相比 R2 它**更适合元数据**（git state、session env、命令历史），因为：
- 读写延迟亚毫秒级
- 单 DO 内强一致
- 支持 transaction（多个 put/delete 原子化）
- 单 DO 50 GB 上限足够元数据使用

---

### 3.4 `MountableFs` 组合：`/` + `/workspace` + `/.nano`

**代码**（可运行骨架）：

```ts
// nano-agent/src/fake-bash/index.ts

import { Bash } from "./vendor/Bash.js";
import { InMemoryFs } from "./vendor/fs/in-memory-fs/in-memory-fs.js";
import { MountableFs } from "./vendor/fs/mountable-fs/mountable-fs.js";
import { R2BackedFs } from "./fs/r2-backed-fs.js";
import { DoStorageFs } from "./fs/do-storage-fs.js";
import { NANO_COMMAND_REGISTRY, buildCustomCommands, buildCommandWhitelist } from "./registry.js";
import { DangerBlockerPlugin } from "./transform/danger-blocker.js";
import { TeePlugin, CommandCollectorPlugin } from "./vendor/transform/index.js";

export function createNanoBash(env: Env, session: SessionState): Bash {
  const base = new InMemoryFs();
  const fs = new MountableFs({
    base,
    mounts: [
      { mountPoint: "/workspace", filesystem: new R2BackedFs(env.R2_WORKSPACE, `sessions/${session.id}/workspace`) },
      { mountPoint: "/.nano",     filesystem: new DoStorageFs(session.doState) },
    ],
  });

  const bash = new Bash({
    fs,
    cwd: "/workspace",
    env: {
      NANO_SESSION: session.id,
      USER: "nano",
      TERM: "dumb",
    },
    commands: buildCommandWhitelist(),    // ← 比 just-bash 全集更窄
    defenseInDepth: false,                // ← 显式关闭（§2.2 第 23 条）
    network: {
      allowedUrlPrefixes: session.config.allowedUrlPrefixes,
      allowedMethods: session.config.allowedMethods ?? ["GET", "HEAD"],
      denyPrivateRanges: false,           // ← Worker 已拦截，见 §2.2 第 21 条
      _dnsResolve: async () => [],        // ← 绕过 node:dns 依赖
    },
    customCommands: buildCustomCommands(env, session),
    executionLimits: {
      maxOutputSize: 1 * 1024 * 1024,     // ← 1 MB（§1.7 调优）
      maxStringLength: 2 * 1024 * 1024,
      maxHeredocSize: 2 * 1024 * 1024,
      maxCommandCount: 1000,
      maxCallDepth: 30,
    },
    logger: session.doLogger,
  });

  bash.registerTransformPlugin(new DangerBlockerPlugin());
  bash.registerTransformPlugin(new CommandCollectorPlugin());
  bash.registerTransformPlugin(new TeePlugin({ outputDir: "/.nano/trace" }));

  return bash;
}
```

**这段代码是一个可直接运行的 v0 原型**——所有使用点在 just-bash 里都有对应源码位置（标在注释里），我们不是在"设计"而是在"组装"。

---

### 3.5 Custom commands 清单（git / browser / do-alarm / kv / queue / ai）

全部用 `defineCommand`（`src/custom-commands.ts:44-49`）写，骨架：

```ts
import { defineCommand } from "./vendor/custom-commands.js";

export const virtualGit = defineCommand("git", async (args, ctx) => {
  // 从 ctx.fs 的 /.nano/git/HEAD 等路径读写 git 状态
  // 支持 subcommand: status, log, diff, add, commit, show, blame
  // ctx.exec 可以内部调度 sub-bash（如果需要）
  // 返回 ExecResult
});

export const browserCmd = defineCommand("browser", async (args, ctx) => {
  // 调用 service binding: env.BROWSER.fetch(...) + RPC
  // 参数解析: browser --url <url> [--wait selector] [--format md|png]
  // 返回 markdown + 存 screenshot 到 R2，URL 作为 stdout
});

export const doAlarm = defineCommand("do-alarm", async (args, ctx) => {
  // do-alarm set <seconds> <callback-spec>
  // 通过 session 的 DO state 设置 alarm，回调会在闹钟触发时恢复会话
});

export const kvCmd = defineCommand("kv", async (args, ctx) => {
  // kv get <key>, kv put <key> <value>, kv list <prefix>
  // 直接调 env.KV.get/put/list
});

export const queueCmd = defineCommand("queue", async (args, ctx) => {
  // queue push <topic> <json>
  // 调 env.QUEUE.send
});

export const aiCmd = defineCommand("ai", async (args, ctx) => {
  // ai chat <prompt> | ai embed <text>
  // 调 env.AI.run
});
```

每一个 command 都应该：
1. **提供 `--help`**（just-bash 的所有命令都有 --help，LLM 会试着用）；
2. **支持管道的 stdin 消费**（`ctx.stdin`）——例如 `cat foo.md | ai chat --summarize`；
3. **返回结构化错误**（`exitCode` 非零 + 带 stderr 说明）；
4. **在 stdout 里输出"看起来像 Unix 命令"的结果**（不是 JSON，不是装饰框，除非参数明确要求）；
5. **`trusted: true`**（`defineCommand` 默认），能访问 Worker bindings。

---

### 3.6 Transform plugins 清单

三个必挂：

1. **`DangerBlockerPlugin`**（新写）：在 AST 层拦截 `rm -rf /`、`cat .env | curl`、已知 prompt injection 模式。骨架参考 `src/transform/plugins/command-collector.ts` 的 walker 模式。
2. **`CommandCollectorPlugin`**（直接沿用 `src/transform/plugins/command-collector.ts`）：统计命令使用，落盘 DO storage。
3. **`TeePlugin`**（直接沿用 `src/transform/plugins/tee-plugin.ts`）：每命令落日志，写到 `/.nano/trace/`（= DoStorageFs）。

可选挂（后续阶段）：

4. **`PermissionClassifierPlugin`**：对 fs-mutating 命令主动要 approval（对接 nano-agent 的 permission mode）。
5. **`AuditLogPlugin`**：每次 exec 把 AST 摘要 + 命令列表 + 结果摘要写到 DO storage 的 `audit_log`。

---

### 3.7 执行限制调优（CF Worker 预算）

见 §1.7 末尾给出的具体 override 表。把它直接传入 `new Bash({ executionLimits: { ... } })`，`src/limits.ts:97-137` 的 `resolveLimits` 会自动合并默认值。

---

## 4. Nano-agent 明确声明不支持的内容

> 本节保留 v1 的结构，但**用 just-bash 的源码事实做了裁剪**：只列出"就算 just-bash 内建支持我们也要关掉"的东西。

### 4.1 运行时层

| 不支持 | 原因 | 给 LLM 的错误 |
|--------|------|----------------|
| 真 subprocess (`child_process`) | Worker 没这个能力；`src/types.ts:103-192` 的 `CommandContext` 里**也没有** spawn 语义 | `nano-bash runs in a V8 isolate; use js-exec / python3 / service binding` |
| 后台进程 `cmd &` | just-bash 语法支持 `&` 但走的是同 isolate 的 "pseudo background"，对 Worker 意义不大 | 建议 LLM 用 `do-alarm` |
| Signal (`kill`, `trap`) | just-bash 不模拟 signal（`limits.ts` 没有 signal 限制），我们也不做 | 建议 LLM 用 `timeout` |
| PTY / tty | 根本无 | 建议 LLM 用 `cat`/`head`/`tail` |
| Raw socket (`nc`) | Worker 只有 fetch 语义 | 建议 LLM 用 `curl` |

### 4.2 Bash 语法层

just-bash 已经支持了几乎全部语法（见 README 的 Shell Features 段），**但 CLAUDE.md 明确说不支持 64-bit 整数**。我们保留 just-bash 的语法面，只在 system prompt 里**不主动宣传** `for/while/until/function` 这类复杂结构——让 LLM 用更简单的管道即可。

### 4.3 命令层（从 just-bash 的 `CommandName` 联合 `registry.ts:15-98` 出发，删减）

**从 just-bash 的全集里删除**：
- `gzip / gunzip / zcat` ← 依赖 `node:zlib`，browser 入口已标注会 runtime 失败（`src/browser.ts:9-10`）
- `python3 / python` ← 改用 service binding，不在主 isolate 跑 CPython WASM
- `js-exec / node` ← 改用 service binding，不在主 isolate 跑 QuickJS WASM
- `sqlite3` ← 改成 D1 customCommand，不用 sql.js WASM
- `bash / sh` 的 `-c` 形式（嵌套 bash）← 保留但通过 `maxSourceDepth: 5` 限制嵌套深度

**保留 just-bash 全量**：
- 所有文件操作、文本处理、数据处理（jq/yq/xan）、导航环境、shell 实用工具、curl、tree/tar、计算/编码（base64/md5sum/sha256sum）等

### 4.4 对 LLM 的显式声明

每个被砍掉的命令，**错误信息必须建议替代**：

```
$ gzip file.txt
error [nano-bash:unavailable]: gzip is not available in nano-bash.
reason: requires node:zlib which is not available in this runtime.
suggest: use 'base64' for encoding, or call 'queue push compression <data>'
         to offload compression to a worker.
```

---

## 5. 声明式注册与三方对齐（registry × system prompt × TS guard）

### 5.1 声明式 registry 的具体 shape

基于 just-bash 的 `Command` interface (`src/types.ts:194-204`) 与 `CommandName` 白名单模式 (`registry.ts:15-98`)，我们的 registry 结构：

```ts
// nano-agent/src/fake-bash/registry.ts

import type { Command } from "./vendor/types.js";
import type { CommandName } from "./vendor/commands/registry.js";

export type NanoCapability =
  | { kind: "builtin"; name: CommandName }                // 引用 just-bash 内建命令名
  | { kind: "custom"; command: Command }                  // 新写的 defineCommand
  | { kind: "service-binding"; name: string; binding: string; method: string };

export interface NanoCommandSpec {
  name: string;                // LLM 看到的命令名
  shortDesc: string;           // system prompt 一行描述
  manpage: string;             // --help 输出
  capability: NanoCapability;
  security: {
    readsFs: boolean;
    writesFs: boolean;
    network: boolean;
    mutatesState: boolean;
    requiresConfirmation?: boolean;
  };
  llmHint?: string;
  unsupported?: Array<{ pattern: RegExp; reason: string; suggest?: string }>;
}

export const NANO_COMMAND_REGISTRY: NanoCommandSpec[] = [
  // —— just-bash 内建命令（按需裁剪）——
  { name: "ls",   shortDesc: "list directory", capability: { kind: "builtin", name: "ls" },
    security: { readsFs: true, writesFs: false, network: false, mutatesState: false }, manpage: "..." },
  { name: "cat",  shortDesc: "read file",      capability: { kind: "builtin", name: "cat" }, ... },
  { name: "grep", shortDesc: "search",         capability: { kind: "builtin", name: "grep" }, ... },
  { name: "rg",   shortDesc: "ripgrep",        capability: { kind: "builtin", name: "rg" }, ... },
  { name: "jq",   shortDesc: "JSON query",     capability: { kind: "builtin", name: "jq" }, ... },
  { name: "curl", shortDesc: "HTTP (allow-listed)", capability: { kind: "builtin", name: "curl" },
    security: { readsFs: false, writesFs: false, network: true, mutatesState: false }, manpage: "..." },

  // —— nano-agent 自写命令 ——
  { name: "git", shortDesc: "virtual git on /workspace", capability: { kind: "custom", command: virtualGit },
    security: { readsFs: true, writesFs: true, network: false, mutatesState: true }, manpage: "..." },
  { name: "browser", shortDesc: "render URL → screenshot + markdown",
    capability: { kind: "service-binding", name: "browser", binding: "BROWSER", method: "fetch" },
    security: { readsFs: false, writesFs: false, network: true, mutatesState: false }, manpage: "..." },
  // ... do-alarm, kv, queue, ai, vectorsearch
];

// —— 从 registry 派生三样东西 ——
export function buildCommandWhitelist(): CommandName[] { /* 只返回 kind: "builtin" 的 */ }
export function buildCustomCommands(env: Env, session: SessionState): CustomCommand[] { /* 把 custom + service-binding 都变成 defineCommand */ }
export function buildSystemPromptSection(): string { /* 见 §5.2 */ }
export function buildAstGuard(): (ast: ScriptNode) => GuardResult { /* 见 §5.3 */ }
```

### 5.2 System Prompt 的三段式

（保留 v1 的设计，因为这部分与源码无关）：
1. **心智锚点**：告诉 LLM 这是一个虚拟 shell 环境，/workspace 持久，/tmp 易失；
2. **能力清单**：从 `NANO_COMMAND_REGISTRY` 分类生成；
3. **显式禁止清单**：从 §4 生成。

每次加命令只改 registry，三段 prompt 自动更新。

### 5.3 TypeScript 守卫的四层

（与 v1 结构一致，但层 1 现在有**具体 AST walker 参考**——`src/transform/plugins/command-collector.ts`）：

- **层 1：AST 静态校验**（执行前）—— 写一个 `AstGuard`，用 CommandCollectorPlugin 同款的 walker 结构（`command-collector.ts` 全文大约 80 行，直接照抄 walker 框架），每遇到 `SimpleCommand` 就在 registry 里查是否存在、是否命中 `unsupported` pattern。
- **层 2：Transform plugin 运行时拦截** —— 就是 `DangerBlockerPlugin`，挂进 `bash.registerTransformPlugin(...)`，利用 `src/Bash.ts:645-655` 的 pipeline。
- **层 3：Capability runtime 校验** —— 在每个 `defineCommand` 的 execute 入口做一次 session 权限检查（plan mode / permission mode）。
- **层 4：LLM 友好错误格式化** —— 统一 `error [category:subtype]: ...\nreason: ...\nsuggest: ...` 格式。

### 5.4 运行时反馈回路

（保留 v1 设计，但现在明确 implement 用 `CommandCollectorPlugin`）：
- 每 N turn 从 DO storage 读出本 session 的 command stats；
- 作为 developer message 喂回 LLM，列出 "succeeded / blocked / suggestion"；
- LLM 在**同一 session 内**就能学会 nano-bash 的方言。

---

## 6. Worker 运行时适配的具体改造清单

> 这一节是 v2 新增的——v1 忽略了"把 just-bash 跑起来到底要改哪里"。现在按源码事实列出。

### 6.1 必须改的代码点

| # | 源位置 | 问题 | 改造 |
|---|--------|------|------|
| 1 | `src/network/fetch.ts:10` | `import { lookup as dnsLookup } from "node:dns";` | **改为** 传入时由构造方提供 `_dnsResolve`；把 `dnsLookupAll` 内部函数改成使用 `config._dnsResolve ?? (() => Promise.resolve([]))` |
| 2 | `src/security/defense-in-depth-box.ts:77-85` | `require("node:async_hooks")` 条件加载 | 构造 `Bash` 时显式传 `defenseInDepth: false`，这段 `require` 虽然仍在代码里但永不执行；bundle 分析时可通过 tree-shake 剥离 |
| 3 | `src/fs/init.ts`（被 `Bash.ts:418` 调用） | 建标准目录（`/bin`, `/usr/bin`, `/tmp`, `/home/user`, etc.） | 对 MountableFs 的 base = InMemoryFs 会正常 work；只需验证 init 路径不会命中挂载点 |
| 4 | `src/commands/gzip/**` | 依赖 `node:zlib` | 从 `commands` 白名单剔除，或用 Web `CompressionStream` 重写一个 customCommand `gzipw` |
| 5 | `src/commands/python3/**` | CPython WASM + worker_threads | 从 `commands` 白名单剔除，用 service binding 替代 |
| 6 | `src/commands/js-exec/**` | QuickJS WASM + 可能的 worker_threads | 同上 |
| 7 | `src/commands/sqlite3/**` | sql.js WASM + worker_threads | 用 D1 customCommand 替代 |
| 8 | 任何 `require("node:...")` 的路径 | Worker 不支持（除非 Node.js compat flag 开） | 逐文件 grep `node:` 导入，能剔的剔，不能剔的走 Worker 的 nodejs compat（需要 wrangler.toml 加 `nodejs_compat` flag） |
| 9 | `src/timers.ts` | 可能依赖 `node:timers` | 检查一遍，换成全局 `setTimeout` / `clearTimeout` |
| 10 | esbuild 打包时注入 `__BROWSER__=true` | 让 DID 的 node 分支 tree-shake 掉 | 在 wrangler build 配置里加 `define: { __BROWSER__: "true" }` |

### 6.2 bundle size 策略

- 把 `src/commands/registry.ts:117+` 的 `commandLoaders` 数组**按白名单裁剪**，只保留我们用的命令，减少 lazy load 的 chunk 数；
- 每个命令的 `import()` 会变成 Worker 的 dynamic chunk，**单个命令子 bundle 不应超过 50 KB 压缩**；
- 对 `rg / awk / sed / jq / yq / xan` 这几个体积较大的命令要特别关注，可能需要逐个评估是否嵌入。

### 6.3 wrangler.toml 片段示例

```toml
[[r2_buckets]]
binding = "R2_WORKSPACE"
bucket_name = "nano-agent-workspaces"

[[durable_objects.bindings]]
name = "NANO_SESSION"
class_name = "NanoSession"

[[services]]
binding = "BROWSER"
service = "nano-browser-worker"

[[services]]
binding = "PY_RUNNER"
service = "nano-python-worker"

[[services]]
binding = "JS_SANDBOX"
service = "nano-js-sandbox-worker"

[[kv_namespaces]]
binding = "KV_CAPS"
id = "..."

[[d1_databases]]
binding = "D1_INDEX"
database_name = "nano-index"

[build.upload]
format = "modules"

[vars]

[define]
__BROWSER__ = "true"
```

---

## 7. 终审评价与最终 Verdict

### 7.1 Just-bash 作为基座的终审（v2 更新）

**评级**：⭐⭐⭐⭐⭐（v1 就是 5 星，v2 源码走读后更加确信）

**加强点**：
- **双入口设计**（`src/browser.ts` vs `src/index.ts`）直接说明作者**已经把非 Node 环境作为一等公民**——我们不是第一个想在 browser/worker 里跑它的人。
- **Bash 构造函数的 6 阶段初始化**（`src/Bash.ts:286-480`）把所有 slot 都暴露为 option，我们想 inject `fs` / `fetch` / `customCommands` / `transformPlugins` / `executionLimits` / `logger` / `commands` 白名单都有直接的槽位。
- **Transform pipeline 的 AST 层 hook**（`src/Bash.ts:645-655`）让可观测性与守卫**零侵入**——不用 wrap exec()。
- **`customCommands` 在内建命令之后注册**（`src/Bash.ts:468-479`）天然支持"温和覆盖"，这是灵活度的关键。
- **`CommandContext.trusted` 字段 + `defineCommand` 默认 `trusted: true`**（`src/custom-commands.ts:48`）让 nano-agent 的扩展命令**合法地**访问 Worker bindings。
- **`InMemoryFs` 和 `MountableFs` 完全无 Node 依赖**，加起来 1424 行，可以几乎无改动地塞进 Worker。
- **network 子系统的 allow-list 细节**（`src/network/allow-list.ts:50-112`）——path boundary + `%2f/%5c` 拒绝 + DNS rebinding 双检——是**我们自己造一遍都不一定能想全的安全点**。
- **限制配置的 18 个字段**（`src/limits.ts:12-66`）覆盖面比我们想的还宽，每一个都是可配置的 override 点，不需要我们在 interpreter 层动手。

**唯一要小心的**：`node:dns` 导入在 `network/fetch.ts:10`，以及 `defenseInDepth` 依赖 `node:async_hooks`。前者通过 `_dnsResolve` 后门绕开，后者通过 `defenseInDepth: false` 关掉即可——都不是工程障碍。

### 7.2 Fake bash 心智模型的可行性再评估

v1 的判断：**反直觉的不是 LLM，而是我们开发者**——LLM 只要"接口层对齐"，底层是 V8 isolate 还是 Linux 进程它无所谓。

v2 源码走读后**进一步确认**这个判断：just-bash 的存在本身就是证明。它一个**完整的 bash 解释器**，跑的脚本和在真 bash 里跑几乎一样——LLM 如果它的训练里见过大量 bash 脚本，在这上面也会跑得丝滑。我们只需要：
1. 保证 fs 里有 LLM 期待的内容（通过 `R2BackedFs` + `MountableFs`）
2. 保证 LLM 期待的工具都能跑（通过 customCommands 补齐 git / browser / cf-native 能力）
3. 保证不支持的边界**诚实返回**而不是静默失败（通过 §5 的三方对齐）

**这三条每一条都有 just-bash 的代码作支点**。

### 7.3 七维度最终评分（v2 修订）

| 维度 | 评级 (1-5) | 一句话说明 |
|------|------------|------------|
| **与 LLM 先验的对齐度** | 5 | just-bash 已经是一个完整 bash 解释器，LLM 感知不到差异 |
| **实现 ROI** | 5 | vendor + 裁剪 + 三样 customCommand 集合 + 一个 new fs 实现，相比从零写节省 10k-20k 行 TS |
| **安全设计** | 4 | 网络 allow-list / MountableFs / 限制体系全套继承；DID 在 Worker 里 no-op 是唯一扣分项，但可以用 capability-based 替代 |
| **扩展性** | 5 | `NANO_COMMAND_REGISTRY` + `defineCommand` + `registerTransformPlugin` 三个 slot 足够扩展一年 |
| **可观测性** | 5 | CommandCollectorPlugin + TeePlugin 零侵入落地 trace |
| **与 CF 运行时的契合度** | 4 | 需要 §6.1 的 10 处改造；一次性工程但不是难点 |
| **工程落地速度** | 4 | 预估 3-5 周到 Must-Have 完成（vendor + R2BackedFs + 3 个 customCommand + registry + 系统 prompt 生成） |
| **综合价值** | **5** | **just-bash 把 80% 的难活干完，剩下 20% 是 Worker 适配 + 声明式注册两件事** |

### 7.4 一句话 Verdict（v2）

> **Fake bash 的可行性不再是一个判断题，而是一个工作清单**：vendor `src/browser.ts` 的子集 → 写 `R2BackedFs` / `DoStorageFs`（实现 `src/fs/interface.ts:116-262`）→ 用 `MountableFs` 组合三层挂载（参照 `src/fs/mountable-fs/mountable-fs.ts:182-221` 的 routing）→ 用 `defineCommand`（`src/custom-commands.ts:44-49`）写 6 个 nano-agent 专属命令 → 注入 `TransformPlugin`（`src/Bash.ts:645-655`）做 guard / tee / collector → 用声明式 registry 同时驱动 `options.commands` 白名单、system prompt 生成、AST guard 校验。**每一步都有 file:line 级别的参考，都不是在"设计"而是在"组装"。强烈推进，按 §6 的改造清单进入实施阶段。**
