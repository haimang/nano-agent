# After-worker-matrix restructuring study by GPT

> Study date: `2026-04-23`
> Author: `GPT-5.4`
> Scope:
> - 4-worker internal restructuring
> - new shared Cloudflare adapter package
> - transport posture shift toward internal-only RPC before `chat.core`

---

## 0. Executive verdict

**结论：方向合理，但必须“分层推进、限域抽象、保留最小外部入口”，不能把它做成一次性的大重写。**

你的三个判断里，有两个半是对的：

1. **把每个 worker 从单文件 shell 演进为分层结构**，这是对的，而且从 after-worker-matrix 开始做，时机也基本对。
2. **新增一个 Cloudflare 统一适配层 package**，方向也对，但它必须是**薄基础设施层**，不能变成新的“业务大杂烩”。
3. **为 future `chat.core` 提前收紧 4-worker 的外部 transport**，方向对；但如果现在就要求“取消对外所有 HTTP 通讯结构”，则**过头了**。在当前 Cloudflare Worker 现实、Wrangler 入口、preview/deploy/probe、以及 `SESSION_DO` / service binding 的工作方式下，after-worker-matrix 更合理的目标应是：
   - **取消对外业务 HTTP surface**
   - **保留最小 fetch/upgrade/probe 入口**
   - **把真正业务逻辑后移到 facade / rpc / binding seam**

所以我的最终判断不是 yes/no 二元，而是：

> **这套 restructuring 值得做，而且会为 5-worker `chat.core` 铺路；但它应该被定义为“边界重组 + 抽象收口”，而不是“立刻彻底去 HTTP + 全量统一目录宗教”的硬切换。**

---

## 1. 当前代码真相：我们现在站在什么位置

### 1.1 当前 4-worker 还处于 W4 shell reality，不是厚运行时 reality

当前 `workers/*` 仍然是 very thin shell：

- `workers/agent-core/src/index.ts` 只是返回 shell JSON，`NanoSessionDO` 也只是 stub。
- `workers/bash-core/src/index.ts`、`workers/context-core/src/index.ts`、`workers/filesystem-core/src/index.ts` 都还是 fetch shell。
- `workers/agent-core/wrangler.jsonc` 只激活了 `SESSION_DO`，其他 service bindings 仍是注释态。

也就是说，**真正的业务运行时仍主要在 `packages/*`**：

- `session-do-runtime`
- `capability-runtime`
- `context-management`
- `workspace-context-artifacts`
- `storage-topology`
- `hooks`
- `llm-wrapper`
- `agent-runtime-kernel`

因此，after-worker-matrix 的 restructuring 必须建立在一个核心现实之上：

> **我们不是在整理一个已经稳定沉淀的 4-worker 厚系统，而是在为一个刚完成 absorption 的系统准备长期形态。**

### 1.2 当前 worker build 也天然偏向 “所有实现仍在 `src/` 下”

四个 worker 的 `tsconfig.json` 现在都是：

- `rootDir: "src"`
- `include: ["src/**/*.ts"]`
- `outDir: "dist"`

这意味着如果直接把 `services/commands/facades/adapters` 放到 `src/` 同级，你不是在“做目录整理”，而是在**同时重写 tsc / dist / wrangler main 的构建假设**。

所以仅从工程现实看，你提出的目录思想是对的，但**推荐的物理落点应是**：

```text
workers/<worker>/src/
  index.ts
  middlewares.ts
  facades/
  commands/
  services/
  adapters/
  workflows/   # 若真的需要
```

而不是把这些目录先放到 `src/` 外面。

### 1.3 当前仓库并不是“还没有 Cloudflare 抽象”

这是判断 `nano-cf-adapters` 是否合理的关键前提。

当前仓库里已经存在几类 Cloudflare-like seam：

1. `packages/nacp-core/src/tenancy/scoped-io.ts`
   - 已有 `R2BucketLike / KVNamespaceLike / DoStorageLike`
   - 已有 tenant-scoped R2/KV/DO storage wrapper
2. `packages/storage-topology/src/adapters/{r2-adapter,kv-adapter}.ts`
   - 已有 production-shaped `R2Adapter / KvAdapter`
   - 已有 `waitUntil`、size guard、cursor walk、parallel put 等 runtime 细节
3. `packages/nacp-core/src/transport/queue.ts`
   - 已有 Queue producer / consumer seam
4. `packages/session-do-runtime/src/worker.ts`
   - 已有 `DurableObjectNamespaceLike`
   - 已有 Worker env binding shape

所以新 package 不应从零发明 Cloudflare 抽象，而应被理解为：

> **把已经散落在 `nacp-core` / `storage-topology` / `session-do-runtime` 的 runtime-adapter seams，重新收口成更清晰的 shared infra layer。**

---

## 2. `context/` 三个 agent-cli 样本给出的真实启发

你要求我结合 `context/` 内样本的复杂度来判断，这一点非常关键。因为这些样本说明：**真正成熟的 agent 系统，复杂度主要来自边界，不来自单个 loop。**

### 2.1 Claude Code：高复杂系统的关键不是“目录多”，而是边界被拆得很清楚

`context/claude-code` 的平铺代码树里已经能直接看到这些 axis：

- `commands`
- `services`
- `tools`
- `skills`
- `state`
- `coordinator`
- `bridge`
- `remote`
- `server`
- `assistant`

而 `main.tsx` 的 import 也证明它不是一个“单循环 agent”，而是一个：

- CLI entry
- feature-gated command platform
- stateful app
- analytics / policy / auth / plugin / mcp / skill / remote-session / agent-swarm
- 多 transport / 多 mode / 多权限机制

这给 nano-agent 的启发不是“照抄它的目录”，而是：

1. **当 agent 复杂度上升时，transport、tooling、session state、policy、workflow 一定会分层。**
2. **command / service / state / tool registry / coordination** 这些边界最终都会出现。
3. 但 Claude Code 的复杂度建立在**本地 CLI + 本地 FS + 本地 shell + 丰富交互 UI** 上，不可直接移植到 Cloudflare-native worker runtime。

所以它支持你的方向，但也提醒我们：

> **应该吸收“边界分层”，不要照搬“本地 CLI 的目录密度”。**

### 2.2 Codex：最值得吸收的不是 transport 形状，而是“拒绝把 core 继续做胖”

`context/codex` 最有价值的不是 README，而是它的仓库组织与 `AGENTS.md` 的工程纪律：

- 它是明确的 monorepo/workspace
- 有 `codex-cli`、`codex-rs`、`sdk/typescript`
- 明确强调：**resist adding code to core**
- 倾向在概念稳定时引入新 crate / package，而不是让 central core 继续膨胀

这和你提出新增 shared package 的想法高度相关。

Codex 给 nano-agent 的最强启发是：

1. **新抽象一旦跨边界复用，就该提炼成 package，而不是继续塞进某个 worker 或某个 core package。**
2. 但 package 必须服务于**明确、稳定、可复用的边界**，而不是把所有“暂时不好放”的代码扔进去。

因此，Codex **支持** `nano-cf-adapters` 这件事；但它也同时告诉我们：

> **如果 `nano-cf-adapters` 被设计成“所有 Cloudflare 相关逻辑都扔进去”，它会迅速变成新的 `codex-core` 问题。**

### 2.3 Mini Agent：低复杂系统能保持扁平，但 transport / memory / tools 一多，层次立刻出现

`context/mini-agent` 现在仍是相对扁平的：

- `agent.py`
- `cli.py`
- `llm/`
- `tools/`
- `acp/`
- `skills/`

这说明一件事：**如果系统复杂度还没上来，过早做层次化会产生仪式感多于价值。**

但它也已经自然分出了：

- agent loop
- CLI
- ACP server
- tools
- skills
- memory / notes / MCP

这说明 transport 与 core logic 的分离最终仍然会发生。

Mini Agent 给 nano-agent 的启发是：

1. 如果还只是单机 demo，可以扁平；
2. 一旦进入**持久会话 / 外部工具 / skills / transport bridge / long context**，就会自然需要更稳定的边界；
3. nano-agent 未来显然不会停在 Mini Agent 这个复杂度，而是更接近 “Claude Code 的功能 ambition + Codex 的工程分包 discipline + Cloudflare-native runtime constraint”。

所以：**你的 restructuring 方向，比 Mini Agent 更早开始做是合理的**，因为 nano-agent 的目标复杂度本来就更高。

---

## 3. 对你的三个核心提议的逐项判断

## 3.1 提议一：每个 worker 改为 facade / services / workflow 分层

### 判断

**合理，而且应该做。**

但要加三个条件：

1. **应放在 `src/` 内，而不是 `src/` 外。**
2. **应允许四个 worker 非对称实现，不要强迫所有子目录全部落地。**
3. **`commands` 与 `workflow` 语义要先冻结，不要两个名字都代表 orchestration。**

### 为什么合理

当前 4-worker 未来的复杂度来源不是“算法很难”，而是：

- facade / ingress 多样化（DO / WS / binding / internal rpc）
- session orchestration
- capability execution
- context assembly / compaction
- filesystem authority / artifact lifecycle
- Cloudflare runtime binding glue

这些东西混在一个 `index.ts` 或几百行 worker entry 里，后面一定会变成高耦合。

因此，按层次拆分是对的。推荐理解如下：

| 层 | 职责 | 应放什么 |
|---|---|---|
| `facades/` | transport / ingress seam | fetch route, DO facade, WS facade, binding facade, internal rpc facade |
| `commands/` | 无状态、一次性 orchestration | `startSession`, `callCapability`, `compactContext`, `promoteArtifact` |
| `services/` | 中阶业务逻辑 | session service, context service, filesystem authority service, fake-bash registry service |
| `adapters/` | worker 内部对 runtime / external infra 的特化 glue | Cloudflare binding glue, just-bash bridge, specific provider wrappers |

### 风险与反例

#### 风险 1：把四个 worker 强行做成完全同构

这不对。

因为四个 worker 的 transport reality 并不对称：

- `agent-core` 明显需要 `do/`、`ws/`、`rpc/`
- `bash-core` 更像 `rpc/bindings` + command executor
- `context-core` / `filesystem-core` 更像 host-local authority worker，`ws/` 甚至可能长期不需要

所以应该统一**层的语言**，不要统一**目录存在性**。  
也就是说：`facades/do`、`facades/ws` 应该是 **optional subtree**，不是每个 worker 的强制模板。

#### 风险 2：`commands/` 与 `workflow/` 的边界目前是重复的

你在提案前半写了 `workflow`，后半实际给的是 `commands/`，并说它承载 one-shot workflow-like 流程。

这其实说明当前更清晰的落点是：

> **先用 `commands/` 作为 orchestration 层，不要同时再建一个 `workflow/`。**

只有当 future 确实出现：

- 长生命周期
- 多 step
- 可恢复
- 可审计
- 带状态机

这种流程时，再把它们单独升级为 `workflows/`。

否则 after-worker-matrix 一上来就同时引入 `commands` 与 `workflows`，会制造术语重叠。

### 小结

**这个提议成立。**  
但建议落成：

```text
workers/<worker>/src/
  index.ts
  middlewares.ts
  facades/
  commands/
  services/
  adapters/
```

并把 `workflows/` 作为可选的 future layer，而不是首轮必建层。

---

## 3.2 提议二：新增高度抽象统一的 `nano-cf-adapters`

### 判断

**方向合理，但 scope 必须严格收窄。**

更准确地说，我支持：

> **新增一个 shared Cloudflare runtime adapter package。**

但我不支持：

> **把 Cloudflare 相关的业务流转逻辑都吸进去。**

### 现有代码为什么支持这件事

当前仓库已经散落着很多“本来就应该被统一收口”的 runtime seam：

- `nacp-core`：tenant-scoped R2/KV/DO storage helper
- `storage-topology`：`R2Adapter`、`KvAdapter`
- `nacp-core`：Queue producer / consumer
- `session-do-runtime`：DO namespace / worker env binding seam

这说明系统已经进入一个阶段：

> **Cloudflare runtime 不是 incidental detail，而是已经成为 shared architectural substrate。**

既然如此，专门有一个 shared package 去承接它，是合理的。

### 这个 package 应该装什么

我建议它只装 **runtime-facing thin adapters**，例如：

1. `d1/`
   - D1 binding thin wrapper
   - connection / statement helper
   - retry / error normalization
2. `r2/`
   - 复用或迁移 `R2Adapter`
   - object put/get/list cursor helper
   - waitUntil-friendly bulk helper
3. `kv/`
   - 复用或迁移 `KvAdapter`
   - sync/async put helper
4. `queues/`
   - queue producer / consumer glue
   - DLQ helper
5. `do/`
   - Durable Object binding/helper types
   - namespace/fetch routing helper
6. `bindings/` 或 `rpc/`
   - service-binding invoke helper
   - internal RPC envelope / response helper
7. `tunnel/`
   - 仅当 future 确实存在，需要时再加

### 这个 package 不应该装什么

不应该装下面这些：

1. tenant law / authority rule  
   这些已经是 `nacp-core` protocol / tenancy 范畴
2. storage placement semantics  
   这些是 `storage-topology` 领域语义
3. session orchestration  
   这是 `session-do-runtime` / worker own logic
4. fake-bash business logic  
   这是 `bash-core` 领域，不是通用 Cloudflare adapter
5. context compaction / artifact lifecycle  
   这是 `context-core` / `filesystem-core` 领域逻辑

也就是说，它应该是：

> **runtime abstraction package**

而不是：

> **Cloudflare business platform package**

### 命名建议

当前内部 workspace package 的命名风格是：

- `@nano-agent/llm-wrapper`
- `@nano-agent/storage-topology`

而 published protocol package 是：

- `@haimang/nacp-core`

所以如果要新增内部 package，从现有命名真相看，**更一致的名字应是**：

```text
@nano-agent/cf-adapters
```

而不是：

```text
@nano-cf-adapters
```

后者会引入第三种 naming style，不利于长期统一。

### 小结

**这个提议成立，但必须收窄为“薄 infra adapter package”。**  
如果你接受这个前提，我认为它会是 after-worker-matrix 中最有长期价值的一次 package 提炼。

---

## 3.3 提议三：取消 4-worker 对外 HTTP 通讯，准备 internal RPC，等待 5-worker `chat.core`

### 判断

**方向正确，但“现在就彻底取消所有对外 HTTP”并不合理。**

### 为什么方向正确

从长期架构上看，你的判断是对的：

1. future 的真正 client/session ingress 应该集中到 `chat.core`
2. 其余 4-worker 更像 internal capability workers / authority workers
3. 它们之间应该优先走内部 binding / rpc，而不是保留 public HTTP business endpoints

这对安全性、边界清晰度、以及未来拓扑演进都更好。

### 为什么现在不能做成“全部取消”

因为当前代码现实里：

1. Worker 入口仍然是 `fetch()`
2. `agent-core` 仍以 `SESSION_DO` + route forwarding 为 Worker 形状
3. W4/W5/WM 当前真相层、smoke tests、preview deploy、health probe 都建立在 fetch shell 上
4. 即使走 service binding，本质上在 Worker 里仍是 fetch-style entry / invocation seam

也就是说，在 after-worker-matrix 阶段，更合理的目标不是：

> **no HTTP anywhere**

而是：

> **no public business HTTP surface except minimal ingress/probe**

### 更合理的收口方式

我建议把这个目标重写为三层：

1. **外部 public surface 最小化**
   - 只保留：
     - health/version/probe
     - 必要的 upgrade / ingress
   - 不再把业务命令暴露为外部 HTTP route
2. **内部 worker-to-worker 统一走 binding/RPC facade**
   - `facades/rpc`
   - `facades/bindings`
3. **把未来 `chat.core` 接管 ingress 预留出来**
   - 但在 `chat.core` 真正落地前，不要硬删现有最小 fetch/upgrade seam

### 关键 trade-off

#### 你得到的价值

1. 4-worker 的角色更纯：不再既是 internal service，又像 public app
2. future `chat.core` 接管时，不需要再拆业务 handler
3. security posture 更清晰
4. RPC seam 更适合 typed contract、审计、hook、trace

#### 你付出的代价

1. preview / smoke / deploy probe 需要重新定义最小入口
2. 一些 current W4/WM 文档和测试假设要同步收口
3. 如果过早去掉 fetch surface，会让 worker 实际部署与验证变得别扭

### 小结

**方向成立，但 after-worker-matrix 不应追求“零 fetch”，而应追求“零 public business HTTP”。**

---

## 4. 推荐的 restructuring 形态

## 4.1 推荐目录原则

### 原则 A：所有实现仍放在 `src/` 下

这是与当前 `tsconfig` / `wrangler main` / `dist` reality 对齐的最小成本方案。

### 原则 B：统一语言，不强制同构

四个 worker 都采用相同的层命名，但允许某些层不存在。

### 原则 C：`commands` 先承担 workflow 层职责

不要在首轮同时引入 `commands/` 和 `workflows/` 两套 orchestration 目录。

## 4.2 推荐目录草案

```text
workers/<worker>/
  src/
    index.ts
    middlewares.ts
    facades/
      rpc/
      bindings/
      do/         # optional
      ws/         # optional
    commands/
    services/
    adapters/
    types/
  test/
```

## 4.3 四个 worker 的非对称落点

| worker | 应重点强化的层 | 备注 |
|---|---|---|
| `agent-core` | `facades/do`, `facades/ws`, `facades/rpc`, `commands`, `services` | 它是 orchestration / session edge |
| `bash-core` | `facades/rpc`, `facades/bindings`, `commands`, `services`, `adapters` | fake-bash 执行面最强 |
| `context-core` | `facades/rpc`, `services`, `adapters` | authority / assembly / compact substrate |
| `filesystem-core` | `facades/rpc`, `services`, `adapters` | authority / artifact / storage substrate |

---

## 5. 对 after-worker-matrix 阶段的推荐推进方式

如果把这件事真的立成 after-worker-matrix 主题，我建议它遵守以下顺序：

1. **先做目录与 import boundary 重组**
   - 不改语义
   - 不改 transport contract
2. **再抽 shared `@nano-agent/cf-adapters`**
   - 只搬 thin runtime seams
   - 不搬 domain logic
3. **再把 facade 层改成 internal-first**
   - binding / rpc 成为默认内部调用面
4. **最后把 public HTTP 收紧到最小必要面**
   - 保留 probe / version / required ingress
   - 删除对外业务 route
5. **等 `chat.core` 真正落地后，再做最终 cutover**
   - 让 `chat.core` 成为唯一外部编排通信面

这个顺序的核心价值是：

> **把 restructuring 做成“边界清理”，而不是和 runtime 语义升级、transport 切换、worker 拓扑变化同时发生。**

---

## 6. Final verdict

### 6.1 我支持的部分

1. **支持** 4-worker 在 after-worker-matrix 进入分层结构
2. **支持** 引入 shared Cloudflare adapter package
3. **支持** 把 4-worker 朝 internal RPC / binding-first 方向推进
4. **支持** 为 future `chat.core` 预留 transport restructuring

### 6.2 我不建议原样执行的部分

1. **不建议** 把 `services/commands/facades/adapters` 放到 `src/` 外
2. **不建议** 首轮同时引入 `commands` 与 `workflow` 两套 orchestration 目录
3. **不建议** 强迫四个 worker 完全同构
4. **不建议** 把 `nano-cf-adapters` 做成包含业务语义的大平台包
5. **不建议** 在 `chat.core` 尚未存在时，宣称“取消所有对外 HTTP 结构”

### 6.3 最终结论

> **这套 restructuring 是合理的，而且值得做。**
>
> **但它应被定义为：**
> 1. **worker 内部边界重组**
> 2. **shared runtime adapter 收口**
> 3. **public business HTTP surface 收缩**
>
> **而不是：**
> 1. 一次性目录大跃进
> 2. 一次性 transport 全切换
> 3. 一次性把所有 Cloudflare 逻辑抽进一个新“大 core”包

如果按上述约束推进，我认为 after-worker-matrix 的这次构架调整**不仅合理，而且很有必要**。  
它会让 nano-agent 在进入 5-worker `chat.core` 之前，就先把：

- worker 内部层次
- Cloudflare runtime substrate
- internal RPC seam
- public ingress discipline

这四件最容易在后期爆炸的边界，提前收干净。

---

## 7. Owner 裁决后的追加分析（激进版）

> 追加日期：`2026-04-23`
> 背景：Owner 明确否决前文中过于保守的三个判断，并要求：
> 1. `commands/`、`services/`、`adapters/` **必须** 从 `src/` 移出，且后续业务逻辑不得再进入 `src/`
> 2. 本阶段内必须把 4-worker 的 HTTP 接口**彻底退化并标记废弃**，所有内部接口全部 RPC 化
> 3. `cf-adapters` 可以主动吸收更大范围能力，不应以“先小后大”为默认策略

这一裁决改变的，不只是目录偏好，而是 **after-worker-matrix 的法律边界**。  
因此，本追加章节不再重复上一版“是否要这么激进”的问题，而是改为回答：

> **在接受 Owner 裁决为前提的情况下，这套更激进的 restructuring 是否仍然成立？如果成立，应该如何定义，才能既激进又不失控？**

### 7.1 对裁决一的分析：`src/` 必须退化为 entry-only legal zone

#### 我的更新判断

**Owner 在这个点上是对的。**

上一版建议把 `commands/`、`services/`、`adapters/` 放回 `src/` 内，本质上是在照顾当前 `tsconfig` 的 build reality，而不是在为 after-worker-matrix 建立一条足够强的架构法律。  
但如果 after-worker-matrix 的目标本来就是为更大规模开发做准备，那么 **“为了省一次构建改造而保留 `src/` 吞业务逻辑的口子”**，确实过于保守。

更激进、也更长期正确的做法应该是：

> **把 `src/` 明确降格为 runtime entry / bootstrap / deprecated facade legal zone。**

也就是说，`src/` 的唯一合法内容应是：

1. `index.ts`
2. `middlewares.ts`
3. 必要的 runtime bootstrap glue
4. 少量“已废弃的 HTTP / fetch 兼容入口”

而 **真正业务逻辑** 必须一律外移到：

- `facades/`
- `commands/`
- `services/`
- `adapters/`

#### 为什么 Owner 的判断更强

因为这不是简单的“目录漂亮”，而是在建立一条**反回潮法律**：

1. 以后谁想图省事往 `src/` 里加业务逻辑，会立刻违反明确的架构边界；
2. `src/` 从“默认堆代码的地方”变成“只准 entry glue 存在的地方”；
3. 这会让后续 `chat.core` 接管外部 facade 时，4-worker 的真实业务层已经天然与 runtime entry 脱钩。

也就是说，Owner 的裁决虽然更激进，但它**显著提高了未来结构退化的门槛**。

#### 需要诚实承认的代价

接受这条裁决，意味着当前 worker build reality 必须一起改：

1. 当前四个 worker 的 `tsconfig.json` 都是 `rootDir: "src"`，这将不再成立；
2. `include` 也不能再只看 `src/**/*.ts`；
3. Wrangler 的 entry 仍会指向 `dist/index.js`，但 `dist` 产物将来自更高层级的编译树；
4. import graph / test import / path alias 都需要重校准。

换句话说：

> **接受 Owner 裁决一，等价于承认 after-worker-matrix 必须做一次“构建形态重置”。**

这不是缺点，而是应明确写入计划的成本。

#### 本点更新结论

我撤回前文“应放在 `src/` 内”的保守建议。  
在 Owner 裁决成立的前提下，更准确的结论应是：

> **`src/` 必须被法律化为 entry-only zone；`commands/`、`services/`、`adapters/` 以及主要 `facades/` 都应在 `src/` 外。**

---

### 7.2 对裁决二的分析：HTTP 应被“法律废弃化”，而不是仅仅“缩小使用”

#### 我的更新判断

**Owner 的方向是成立的，但需要把“废弃 HTTP”翻译成精确的 runtime 法律。**

上一版我主张保留 minimal fetch/probe 入口，是因为当前 Worker runtime、Wrangler、preview deploy、以及 `SESSION_DO` / service binding 的形状本来就是 fetch-oriented。这个判断本身没有错。  
但 Owner 要求的是：

> **从架构法律上彻底禁止 HTTP 作为内部业务接口。**

这条要求，其实可以成立，只要我们区分清楚两件事：

1. **Worker runtime 仍然以 `fetch()` 作为物理入口**
2. **业务协议层面，HTTP 已不再是合法内部调用面**

这两个陈述并不矛盾。

#### 应如何理解“彻底退化 HTTP”

更激进但可执行的定义应是：

1. `fetch()` **可以继续存在**
   - 因为 Worker runtime 不会消失
   - Wrangler/preview/smoke 仍需要最小入口
2. 但 `fetch()` 不再承载**活业务 contract**
   - 所有内部 worker-to-worker 交互必须走 service binding / RPC facade
   - 原有 HTTP 业务 route 全部退化为 deprecated shim
3. deprecated shim 的行为应非常明确：
   - 返回 `410 Gone` / `426 Upgrade Required` / 明确 deprecation JSON
   - 或只保留 version/deprecation marker
   - 不允许再承载真实业务处理

也就是说，after-worker-matrix 的新法律应写成：

> **HTTP 作为 runtime transport 物理存在，但作为内部业务协议已被废弃。**

这才是真正符合 Owner 裁决精神的表达。

#### 为什么这比“只缩小 public HTTP”更强

因为上一版的表述仍给人留下一个灰区：

- 好像只要不是 public route，就还能在内部偷偷继续走 HTTP

而 Owner 现在明确要求：

> **没有灰区。内部协议一律 RPC 化。**

这个要求更强，但从长期看是正确的，因为它会：

1. 强迫所有 worker 之间的调用收口到 typed RPC contract
2. 让 trace / hook / policy / auth / versioning 都挂在统一内部协议上
3. 为后续 `chat.core` 接管所有外部 facade 创造更干净的 topology

#### 需要诚实承认的代价

1. 当前所有 smoke / probe / docs / deploy assumptions 都要重写口径
2. 部分 root / worker tests 不能再用“直接 hit business HTTP route”的思维写
3. `agent-core` 当前 DO + route-forwarding 习惯会被重新解释为：
   - runtime shell 仍在
   - 业务 contract 已不在 HTTP 层

这意味着：

> **Owner 的裁决二，本质上不是 transport tweak，而是 contract law replacement。**

#### 本点更新结论

我接受 Owner 的判断，但把它改写为更精确的版本：

> **after-worker-matrix 应当把 HTTP 在 4-worker 中降格为 deprecated runtime shell；内部业务接口全部 RPC 化；HTTP 不再是合法业务协议面。**

---

### 7.3 对裁决三的分析：`cf-adapters` 应允许“受控膨胀”，但必须是基础设施膨胀，不是领域逻辑逃逸

#### 我的更新判断

**Owner 的批评有道理。**

上一版我对 `cf-adapters` 的 scope 控制偏紧，出发点是防止它变成新 core，但副作用是：

1. 容易把很多未来必然会反复共享的 Cloudflare-specific helper 继续散落在 worker/package 内
2. 每次想往里加能力，都要走一次“先证明它够薄”的讨论与测试循环
3. 这对一个明确会长期演进的 Cloudflare-native 系统来说，确实会造成不必要的摩擦

Owner 的论点是：

> **既然 `cf-adapters` 本来就是一个独立、隔离、可控的 package，那么先做大，再按需回缩，可能比先做小、后续不断追加更便宜。**

这个判断在当前项目阶段是成立的。

#### 为什么“受控膨胀”在这里成立

因为 `cf-adapters` 与传统“核心包做胖”不同，它天然有三个隔离条件：

1. **它是独立 package**
   - 胖了不会直接污染 worker entry
2. **它的命名与职责本来就指向 Cloudflare substrate**
   - 膨胀仍在同一技术轴线上，不是无限泛化
3. **它的消费者会是多个 worker**
   - 越早形成共享底座，越能避免后续 copy-paste 与再抽象

所以这里真正需要防的，不是“包大”，而是：

> **包大到开始吞领域语义。**

#### 因此，新的边界不应是“只做薄抽象”，而应是“允许厚基础设施，不允许吞领域核心”

也就是说，`cf-adapters` 可以主动吸收：

1. `d1/`
2. `r2/`
3. `kv/`
4. `queues/`
5. `do/`
6. `rpc/`
7. `bindings/`
8. `tunnel/`
9. `ws/`
10. `observability/`
11. `errors/`
12. `retries/`
13. `testing/`
14. `migrations/`
15. `cache/`
16. `rate-limit/`
17. `wait-until/`
18. `fanout/`
19. `artifact-transfer/`
20. `consistency/`

甚至还可以容纳一部分 **Cloudflare-first 的业务流转抽象**，例如：

- R2 artifact promotion flow
- queue-to-do fanout helper
- binding RPC envelope + error normalization
- DO checkpoint persistence helper
- cross-binding retry / backoff policy

这些都可以是“超纲但仍合理”的内容，因为它们仍然围绕 **Cloudflare substrate orchestration**。

#### 但它仍然不应吞掉什么

即使接受 Owner 的激进路线，我仍然认为它不应吸收：

1. `session` 的领域状态机
2. `fake-bash` 命令治理本体
3. `context` assembly / compaction 领域策略
4. `filesystem` authority / artifact law 本体
5. `agent` orchestration / tool policy / NACP protocol truth

这些不是 Cloudflare substrate，而是 worker/domain 自己的核心语义。

#### 因此，本点更准确的更新结论是

> **`cf-adapters` 可以主动做大，允许“受控膨胀”；但它膨胀的方向必须是 Cloudflare-first infrastructure + substrate workflow，而不是跨域吞并各 worker 的核心领域逻辑。**

---

### 7.4 在接受 Owner 裁决后的总体更新结论

接受 Owner 三条裁决之后，我对整个 restructuring 的判断从“谨慎渐进式”更新为：

> **可以更激进，而且应该更激进。**

但这里的“激进”必须被明确定义为：

1. **激进地重新立法**
   - `src/` 不再容纳业务逻辑
   - HTTP 不再是合法内部业务协议
2. **激进地提前收口共享底座**
   - `cf-adapters` 主动扩容，承接 Cloudflare substrate
3. **激进地把 4-worker 推向 internal-only posture**
   - 为 `chat.core` 的统一外部 facade 提前清场

而不是：

1. 无边界地改目录
2. 无定义地抽象 RPC
3. 无约束地把任何不好放的代码丢进 `cf-adapters`

换句话说：

> **Owner 的路线并不是“更冒险”，而是“更先验地把未来法律写死”。**

如果项目目标真的是更大规模开发，我认为这条路线是可以成立的。

---

### 7.5 基于 Owner 裁决的 4-worker 目录结构设想

以下目录草案刻意遵守三条新法律：

1. `src/` 只保留 entry / middleware / deprecated HTTP shell
2. 所有内部业务接口都走 `facades/rpc` 或 `facades/bindings`
3. 真实业务逻辑全部在 `commands / services / adapters`

#### 7.5.1 `agent-core`

```text
workers/agent-core/
  src/
    index.ts                    # Worker bootstrap only
    middlewares.ts              # shared middleware chain
    deprecated-http.ts          # 410/426 deprecation shell only

  facades/
    do/
      nano-session-do.ts
      session-route.ts
      session-checkpoint.ts
    ws/
      session-upgrade.ts
      stream-push.ts
      ack-window.ts
    rpc/
      session-rpc.ts
      followup-input-rpc.ts
      hook-emit-rpc.ts
    bindings/
      bash-core.ts
      context-core.ts
      filesystem-core.ts

  commands/
    start-session.ts
    accept-followup-input.ts
    dispatch-tool-call.ts
    append-initial-context.ts
    checkpoint-session.ts
    restore-session.ts

  services/
    session-service.ts
    orchestration-service.ts
    ingress-policy-service.ts
    replay-service.ts
    checkpoint-service.ts
    stream-service.ts

  adapters/
    env.ts
    do-storage.ts
    websocket-runtime.ts
    rpc-transport.ts
    trace-sink.ts

  test/
```

**说明**

- `agent-core` 仍是最重的 orchestration worker。
- `src/` 只剩 bootstrap 与 deprecated shell。
- 对外 HTTP 在这里已经不再是业务入口；真正 live contract 是 DO / WS / RPC facade。

#### 7.5.2 `bash-core`

```text
workers/bash-core/
  src/
    index.ts                    # Worker bootstrap only
    middlewares.ts
    deprecated-http.ts          # deprecated shell only

  facades/
    rpc/
      capability-rpc.ts
      cancel-rpc.ts
      progress-rpc.ts
    bindings/
      agent-core.ts

  commands/
    execute-command.ts
    cancel-command.ts
    inspect-command-registry.ts
    validate-command-policy.ts

  services/
    execution-service.ts
    command-registry-service.ts
    governance-service.ts
    progress-stream-service.ts
    sandbox-service.ts

  adapters/
    just-bash-runtime.ts
    local-ts-runtime.ts
    browser-rendering.ts
    provider-bridge.ts
    rpc-transport.ts

  test/
```

**说明**

- `bash-core` 是 fake-bash 与 capability execution 的集中面。
- HTTP 应彻底退化，只剩 deprecation shell。
- 真实业务面全部通过 RPC / service binding 暴露。

#### 7.5.3 `context-core`

```text
workers/context-core/
  src/
    index.ts                    # Worker bootstrap only
    middlewares.ts
    deprecated-http.ts

  facades/
    rpc/
      assemble-context-rpc.ts
      compact-context-rpc.ts
      append-initial-context-rpc.ts
    bindings/
      agent-core.ts

  commands/
    assemble-context.ts
    compact-context.ts
    append-initial-context.ts
    capture-context-snapshot.ts
    restore-context-snapshot.ts

  services/
    assembler-service.ts
    compact-service.ts
    budget-service.ts
    snapshot-service.ts
    evidence-service.ts

  adapters/
    env.ts
    r2-context-store.ts
    kv-hints-store.ts
    rpc-transport.ts
    eval-sink.ts

  test/
```

**说明**

- `context-core` 不再暴露 HTTP 业务接口。
- 它作为 authority/substrate worker，对外只保留 RPC facade。
- `appendInitialContextLayer` 这类 API 应明确归属在这里，而不是继续悬挂在 host shell。

#### 7.5.4 `filesystem-core`

```text
workers/filesystem-core/
  src/
    index.ts                    # Worker bootstrap only
    middlewares.ts
    deprecated-http.ts

  facades/
    rpc/
      workspace-read-rpc.ts
      workspace-write-rpc.ts
      artifact-rpc.ts
      snapshot-rpc.ts
    bindings/
      agent-core.ts
      context-core.ts

  commands/
    read-workspace.ts
    write-workspace.ts
    list-tree.ts
    promote-artifact.ts
    capture-workspace-snapshot.ts
    restore-workspace-snapshot.ts

  services/
    authority-service.ts
    artifact-service.ts
    topology-service.ts
    snapshot-service.ts
    index-service.ts

  adapters/
    env.ts
    r2-workspace-store.ts
    kv-index-store.ts
    d1-catalog-store.ts
    rpc-transport.ts

  test/
```

**说明**

- `filesystem-core` 的 HTTP 业务面也应完全废弃。
- 它的核心是 workspace authority / artifact lifecycle / snapshot substrate。
- 若 future 真有更重的 catalog/index/query 需求，这里会最早感受到 `cf-adapters` 的扩容价值。

---

### 7.6 对 `cf-adapters` 的激进版目录补充建议

虽然本节重点是 4-worker，但在 Owner 裁决下，`cf-adapters` 的推荐形态也应一并明确：

```text
packages/cf-adapters/
  src/
    d1/
    r2/
    kv/
    queues/
    do/
    rpc/
    bindings/
    ws/
    tunnel/
    observability/
    retries/
    errors/
    testing/
    migrations/
    cache/
    rate-limit/
    artifact-transfer/
    consistency/
```

若沿现有命名真相，包名更推荐：

```text
@nano-agent/cf-adapters
```

而不是引入新的 scope 风格。

---

### 7.7 追加章节最终结论

在 Owner 裁决生效后，我对这次 restructuring 的最终看法进一步更新为：

> **上一版的保守建议在“长期边界立法”上确实不够。**
>
> **更激进的版本不仅可行，而且更贴近 after-worker-matrix 的真实使命：**
> 1. 让 `src/` 失去业务容纳能力
> 2. 让 HTTP 失去内部业务协议地位
> 3. 让 `cf-adapters` 提前成为足够厚的 Cloudflare substrate growth zone

如果项目接下来真的会迅速扩大，我现在更倾向于认为：

> **Owner 的裁决比我的上一版建议，更适合作为 after-worker-matrix 的正式架构方向。**
