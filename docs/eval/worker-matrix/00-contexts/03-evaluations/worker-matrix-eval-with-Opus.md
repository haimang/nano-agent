# After Foundations — Worker Matrix Evaluation by Opus

> 状态：`独立辩证评估 (independent dialectical review)`
> 对象：用户提出的 5-worker 矩阵方案 (`agent.core / context.core / filesystem.core / bash.core / skill.core`)
> 比照：Opus 自己上一轮提出的 `docs/eval/new-plan-by-Opus.md`（单 worker、Real Agent Loop & Worker Realization）
> 立场：先 steel-man、再质疑、再给条件性推荐
> 写作时间：2026-04-18

---

## 0. 一句话先给结论

> **我同意"下一阶段必须从 packages 内部走出来、组成可部署的 worker"，这一点你是对的，我之前的 Phase-8 单 worker 提案在战略层是低估了。**
>
> 但**我不推荐把 5 个 worker 同时立项为对等的产品边界**。我推荐：把"5-worker 矩阵"作为**架构北极星**冻结，但**第一波只把 3 个有真实地基的 worker 实做出来 (`agent.core / bash.core / filesystem.core`)，把 `context.core / skill.core` 作为 reserved seam 留口子但不立项**。

如果只能挑一句话表达我对这个方案的立场：

> **方向正确，时机半正确，颗粒度过细。**

下面我会分别说明这三层判断的依据。

---

## 1. 我承认你这个方案修正了我之前的盲点

我先 steel-man 你的提案，包括承认我之前 `new-plan-by-Opus.md` 的 Phase 8 单 worker 路线在哪里没看到位。

### 1.1 我之前提案的隐性错误

我在 `new-plan-by-Opus.md` 里提出的 Phase 8 = "Real Agent Loop & Worker Realization"，本质上是这样的逻辑：

> "现在 packages 都齐了，唯一缺的是 KernelRunner 没接到 session-do-runtime 里。所以下一步把 kernel 接进去、跑通一次真实的 agent turn，就完成了主链。"

这个判断在**事实层是对的**（`composition.ts:95` 和 `remote-bindings.ts:386` 都还是 `kernel: undefined`，KernelRunner 类完整但从未实例化），但在**战略层是不够的**：

- 它默认 "next phase = 让 session-do-runtime 内部跑通"
- 它把 worker 边界假设成"只有 session DO 一个 worker，其它都是它的 transport seam"
- 它没有强迫验证**多 worker 之间的 NACP 通讯形态在真实 Cloudflare runtime 下是否成立**

你的 5-worker 提案把这个隐性假设打破了——它问的是：

> "如果 nano-agent 的产品形态本来就是多 worker 协作，那为什么我们要先做完单 worker 内部闭环再去拆？为什么不直接用多 worker 来做闭环？"

这个问题问得对。

### 1.2 你的方案在结构上的三个真实价值

我承认你这个方向有三个我之前没充分给到权重的优势：

**(1) 强迫 NACP 跨 worker 通讯成为 production reality，而不是 fake transport 测试品。**

当前 `nacp-core/src/transport/do-rpc.ts` 和 `hooks/src/runtimes/service-binding.ts` 都已经有 service-binding seam，但它们目前只在单包测试和 cross-package fake transport 里被验证过。如果不做多 worker 矩阵，这层"跨 worker 协议"很可能永远停留在"接口对了、但生产环境从没真正握手过"的状态。这是个**真实的、不补不行的 gap**。

**(2) 强迫职责边界在物理层就被划清，避免 monolith creep。**

`session-do-runtime` 当前实际上已经在悄悄变厚——它持有 `workspaceComposition`（`workspace-runtime.ts` 是上一轮我自己加的）、持有 `defaultEvalRecords`、未来还要持有 KernelRunner 实例、provider fetcher、capability target……如果不在物理 worker 边界上切，半年后 `session-do-runtime` 会变成一个 5000 行的 god worker。你的 5-worker 矩阵直接把这条 trend 截断。

**(3) 强迫 deployable-shaped 的事实出现在主线上。**

我的 Phase 8 提案里有 verification ladder（local-l0 → remote-dev-l1 → deploy-smoke-l2），但本质上还是"先内部跑通再考虑部署"。你的方案把"一次真实的 wrangler deploy"拉到了主线动作。这个差异在**MVP 验证速度**上很关键——能不能拿出一个真实部署、真实可点开、真实有 trace 的东西，是判断"这套架构到底是不是产品"的最直接信号。

**这三点，我之前的提案都没正面回答。所以从战略目标上，我支持你转向 worker matrix。**

---

## 2. 但我对你方案的颗粒度有保留

steel-man 之后，我的质疑是：**5 个 worker 同时立项，颗粒度切错了。**

下面用 packages/ 的真实代码事实逐个核对每个 worker 的"地基成熟度"——我用一个简单的 4 档分类：

- **READY** — packages/ 下已经有 80%+ 的 load-bearing 代码，组装即可
- **HALF** — 接口与抽象层已有，但 production 实现仍是 stub 或 not-connected
- **THIN** — 只有抽象/语义层，缺真实运行时实现
- **GREENFIELD** — packages/ 下没有任何 foundation，需要从零写

| Worker | 主要依赖 packages | 地基档位 | 关键缺口 |
|---|---|---|---|
| `agent.core` | `session-do-runtime` + `nacp-session` + `agent-runtime-kernel` + `llm-wrapper` + `hooks` | **READY** | KernelRunner 未接（`composition.ts:95`、`remote-bindings.ts:386` 均 `kernel: undefined`）；llm-wrapper 已有 fetcher 形 (`remote-bindings.ts:387`) |
| `bash.core` | `capability-runtime` (12-pack + grep alias + listDir-probe + UTF-8 truncation) | **READY** | `ServiceBindingTarget` 已就绪；只需 worker shell + binding 注册 |
| `filesystem.core` | `workspace-context-artifacts` + `storage-topology` | **HALF** | `MemoryBackend` 可用、`ReferenceBackend` 全部抛 "not connected"；`NullStorageAdapter` 也全抛"not connected"；KV/D1/R2 真实 adapter 不存在 |
| `context.core` | `workspace-context-artifacts` (`ContextAssembler` / `CompactBoundaryManager` / `WorkspaceSnapshotBuilder`) | **THIN** | 装配机制已有、evidence 已能 emit，但**真正的 LLM 驱动压缩**（你说"我会在别的说明里进行具体安排"）尚未成文，更未实现 |
| `skill.core` | `capability-runtime/targets/browser-rendering.ts`（明确 stub）+ 未来浏览器/搜索/爬虫 | **GREENFIELD** | A8/A9/A10 期间显式把 browser/search/scrape 留作未来 reserved；packages/ 下没有实际能力代码 |

这张表是关键依据。让我把它转成判断：

### 2.1 三个 READY/READY-向 worker 应该立刻做

`agent.core`、`bash.core`、`filesystem.core (memory tier)` 这三个 worker，组装代码已经在仓库里**全部存在**。它们的 worker 化主要工作是：

- 写 `wrangler.toml` 与 worker 入口
- 在 `composition.ts` 里把 KernelRunner 真正实例化
- 在 service binding 表里把 hooks/capability/workspace 路由配上
- 用 `composeWorkspaceWithEvidence` 把 evidence sink 接到 eval seam
- 写 deploy smoke

这些都是**装配工作**，不是新功能开发。一个工程师 1-2 周可以三个 worker 同时部署起来。

### 2.2 `context.core` 当前不应该立项为独立 worker

理由有三：

**(a) 你自己说了"我会在别的说明里进行具体安排"。**

也就是说，"context 压缩机制"的产品边界、策略层、与 LLM 的交互形态都还没出 spec。在 spec 没有的情况下立 worker，必然会出现：第一版 worker 接口被随手定型 → 一个月后 spec 出来 → worker 接口要重写一遍。这是浪费。

**(b) `workspace-context-artifacts` 已经把 context 装配机制做完了。**

它现在缺的不是"能不能装配"，而是"装配出来的 budget 满了之后要不要、怎么、用哪个 LLM 去压缩"。这是**策略问题**，不是 worker 边界问题。当前更合理的做法是：让 `agent.core` 的 turn loop 里直接调用 `CompactBoundaryManager`，等 spec 落地后再把它**升级**成独立 worker。从单包内部 → 单 worker 内部 → 独立 worker，这是渐进路径，不会浪费已有代码。

**(c) 独立 worker 会引入额外的 service binding 跳数。**

context 压缩是一个高频操作（每次 turn 都可能触发判断），如果它是独立 worker，每次都要走 service-binding 调用。在 spec 还没定的阶段就承担这个 latency 与 trace 复杂度，得不偿失。

### 2.3 `skill.core` 当前不应该立项为独立 worker

这个判断比 `context.core` 更强烈。理由：

**(a) packages/ 下没有任何 foundation 代码可以组装。**

A8/A9/A10 三个阶段的 inventory 里，browser/search/scrape 都是被**显式 reserved**的——意思是当时已经决定**不做**。`capability-runtime/src/targets/browser-rendering.ts` 是个 stub。如果现在立 `skill.core`，相当于第一天起就要从零写浏览器集成、搜索集成、爬虫集成，每一个都是几周的工作量。

**(b) 第一波 MVP 不需要它。**

一次最小化 agent turn 闭环只需要：LLM call + bash 工具 + 文件系统读写 + trace 回流。`skill.core` 提供的能力（浏览器截图、爬虫、搜索）都不是"agent 能跑"的必要条件，它们是"agent 能做更多事"的扩展能力。MVP 应该证明环路成立，不应该证明能力广度。

**(c) 它会拖慢矩阵成型。**

如果 5 个 worker 都要等 `skill.core` 的浏览器实现完成才能合龙，那矩阵的"可演示"时间会从 2 周拖到 2 个月。

### 2.4 我的结论：颗粒度调整

5-worker 作为**架构北极星**：保留。
5-worker 作为**第一波立项范围**：缩到 3 worker。

| Phase | Worker | 立项动作 |
|---|---|---|
| **Phase 8.A — 立刻做** | `agent.core` | session-do-runtime + KernelRunner + llm-wrapper 真实接通 |
| **Phase 8.A** | `bash.core` | capability-runtime 12-pack + ServiceBindingTarget 包成独立 worker |
| **Phase 8.A** | `filesystem.core (memory tier + R2 promotion)` | WorkspaceNamespace + MemoryBackend 上线，R2 promotion 留 slot |
| **Phase 8.B — spec 落地后** | `context.core` | 等用户的"context 压缩机制说明"出来后立项 |
| **Phase 8.C — 视产品需要** | `skill.core` | 用户明确需要浏览器/搜索/爬虫时再立项，且按 capability 单独立项而非合一 worker |

---

## 3. 与我自己 Phase 8 单 worker 提案的诚实对比

我必须诚实承认：**你的方案在战略上比我的 Phase 8 强**，但在**第一波执行颗粒度上**我的提案更稳。最理想的方案是把两者合：

|  | Opus 单 worker Phase 8 (旧) | 用户 5-worker 矩阵 (新) | 推荐合成 |
|---|---|---|---|
| 验证目标 | "kernel 接通 + 单 worker 跑通 turn" | "5 worker 跨 NACP 跑通 turn + deployable" | **3 worker 跨 NACP 跑通 turn + deployable** |
| 部署复杂度 | 1 个 worker | 5 个 worker（5x deploy/CI surface） | 3 个 worker（manageable） |
| 强迫 NACP cross-worker | 弱 | 强 | **强**（3 个 worker 已经足够强迫 service-binding reality） |
| MVP 时间 | 2-3 周 | 6-8 周 | **3-4 周** |
| 后续可扩 | 需要再次拆分（拆 monolith 成本高） | 已经拆好（扩展容易） | 已留出 `context.core / skill.core` 的 binding seam，扩展低成本 |
| 强迫 deployable | 弱 | 强 | **强** |
| 监控 monolith creep | 弱 | 强 | **中-强** |

合成方案的核心思想：

> **采用你的"矩阵"目标，但把第一波收窄到 3 个有真实地基的 worker；剩下 2 个作为 reserved binding 名额留在 service-binding 目录里，但不实装。**

这样你既得到了你想要的"NACP cross-worker 跑通、deployable MVP、防止 monolith creep"，又避免了 5 个并行立项 + 2 个 greenfield 拖累整体节奏的问题。

---

## 4. 详细分析：每个 worker 的真实 readiness 与 risk

### 4.1 `agent.core` — READY，立刻做

**对应 packages（按 load-bearing 程度）：**
- `session-do-runtime`（DO 壳、WS+HTTP edge、CrossSeamAnchor、composition factory）
- `nacp-session` 1.1.0（8 message kinds 已冻结）
- `agent-runtime-kernel`（KernelRunner 类完整：advanceStep 处理 llm_call/tool_exec/compact/wait/finish/hook_emit）
- `llm-wrapper`（provider abstraction + fetcher）
- `hooks`（registry + dispatcher + service-binding runtime）

**当前真实状态：**

```
composition.ts:95          kernel: undefined
remote-bindings.ts:386     kernel: undefined
remote-bindings.ts:387     llm: providerFetcher ? { fetcher } : undefined  ← 仅当 binding 存在
```

也就是说，**外壳全部就绪、内核从未实例化**。这是当前 nano-agent 最关键的一处技术债。

**Phase 8.A 任务清单：**
1. 在 `composition.ts` 与 `remote-bindings.ts` 里实例化 `KernelRunner`，把 `kernel: undefined` 替换成 `kernel: new KernelRunner({...})`
2. 在 `NanoSessionDO` 的 turn 处理路径里调用 `kernel.advanceStep(...)`
3. llm-wrapper 接到 `agent.core` 的 worker secret 上（OpenAI/Anthropic provider）
4. 把 hooks `service-binding` runtime 路由到 deploy 后的 hooks worker（如果分了）或 in-process registry（如果未分）
5. 写 `wrangler.toml` 与 `compatibility_date`，配置 DO binding 与 service binding 表
6. deploy smoke 测试：HTTP 发 `session.start` → KernelRunner 跑一次 fake LLM → 收到 `session.frame_ready`

**风险：低。** 所有依赖代码都在仓库里。

### 4.2 `bash.core` — READY，立刻做

**对应 packages：**
- `capability-runtime`（12-pack: pwd/ls/cat/write/mkdir/rm/mv/cp/rg/curl/ts-exec/git）
- `capability-runtime/src/targets/service-binding.ts`（远端 capability execution target）
- `FakeBashBridge`、`CapabilityExecutor`、policy（unsupported/risky/ask-gated governance）

**当前真实状态：**

A8/A9/A10 已经把 12-pack 全部 land，包括：
- grep 别名 (`-i`/`-n`)
- listDir-probe + readFile-fallback
- UTF-8 byte-aware truncation
- git read-only subset (status/diff/log)
- ts-exec partial（明确标记 not connected）
- curl partial（默认返回 `curl-not-connected` 字符串）
- inventory drift guard（CI 强制 PX-capability-inventory.md 与代码同步）

**Phase 8.A 任务清单：**
1. 写 `bash-worker/src/index.ts`：暴露一个 fetch handler，路由到 `CapabilityExecutor.execute(input)`
2. 用 `ServiceBindingTarget` 在 `agent.core` 侧注入到 hooks 的 capability 调用路径
3. ts-exec 与 curl 的 not-connected 状态保持显式（不要在 worker 化时偷偷"让它连"，否则破坏 inventory 契约）
4. deploy smoke：`agent.core` 发起一个 `tool_exec` → 跨 service-binding → `bash.core` 执行 → 结果回流

**风险：低。** 这是最干净、最有辨识度的 worker。

### 4.3 `filesystem.core` — HALF，做但只做 memory tier

**对应 packages：**
- `workspace-context-artifacts`（`WorkspaceNamespace`、`MountRouter`、`MemoryBackend`、`ReferenceBackend`、`PreparedArtifacts`、`PromotionPlan`）
- `storage-topology`（`taxonomy`、`refs`、`keys`、`placement`、`calibration`、`adapters/scoped-io.ts`）

**当前真实状态（这是与 GPT 评估一致的关键观察）：**

- `MemoryBackend` 真实可用 ✓
- `ReferenceBackend` 全部 5 个方法都抛 `"not connected — durable storage backend is not yet available"` ✗
- `NullStorageAdapter` 所有 KV/R2/D1 操作都抛 `"not connected"` ✗
- `placement.ts` / `taxonomy.ts` / `refs.ts` 是**语义 + 决策层**，不是 runtime adapter

**也就是说：filesystem.core 名字看起来 ready，但 KV/D1/R2 的 production adapters 当前还不存在。**

**Phase 8.A 任务清单（保守版）：**
1. 写 `filesystem-worker/src/index.ts`，对外暴露 workspace mount API
2. 内部用 `MemoryBackend` + R2 promotion（R2 是相对简单的 binding，可以做）
3. KV / D1 留作 reserved slot，先不实装
4. **不要**把 `ReferenceBackend` 在这个阶段接通——它需要更慎重的 placement 策略落地
5. deploy smoke：`bash.core` 在工作目录里写文件 → 走 `filesystem.core` → 下次读出来

**风险：中。** 主要风险是如果用户期望第一版就有完整 KV/D1/R2 分层，会失望。我建议明确告知第一波只有 memory + R2，KV/D1 是 Phase 8.B 议题。

### 4.4 `context.core` — THIN，**第一波不做独立 worker**

**对应 packages：**
- `workspace-context-artifacts`（`ContextAssembler`、`CompactBoundaryManager`、`WorkspaceSnapshotBuilder`、`evidence-emitters`）

**当前真实状态：**

- `composeWorkspaceWithEvidence` 已能装配 assembler/compact/snapshot 三件套 ✓
- 5 evidence streams（placement/assembly/compact/artifact/snapshot）已能 emit ✓
- **但**：`CompactBoundaryManager` 当前只判断"是否到了 compact 边界"，没有"实际用 LLM 做语义压缩"的代码
- 用户原话："context.core: 上下文压缩机制（separate spec coming）" — spec 未出

**为什么不立独立 worker：**
- 你自己说了 spec 在路上，不应在 spec 前冻接口
- 当前 `agent.core` 内部直接调用 `composeWorkspaceWithEvidence` 已能跑通基础环路
- 真正需要独立 worker 是因为压缩涉及**昂贵 LLM 调用**且**生命周期与 turn 解耦**——这两个特征要等 spec 出来才能确认

**Phase 8.A 暂行做法：**
- `agent.core` 内嵌使用 `composeWorkspaceWithEvidence`
- 在 service binding 表里**预留** `CONTEXT_CORE` 名字，但暂不部署
- spec 落地后再升级

**风险：低（暂不立项）。**

### 4.5 `skill.core` — GREENFIELD，**第一波不做**

**对应 packages：**
- `capability-runtime/src/targets/browser-rendering.ts`（**明确 stub**，"not connected"）
- 浏览器、搜索、爬虫：**packages/ 下没有任何代码**

**为什么不立独立 worker：**
- 没有 foundation 可以组装，相当于从零写新功能
- A8/A9/A10 期间已经把这些能力**显式 reserved**，违背当时的边界决策
- MVP 不需要它

**Phase 8.A 暂行做法：**
- 不立项
- Service binding 表里**预留** `SKILL_CORE` 名字
- 等用户明确产品需求时再立项；甚至可以**不**做成单一 `skill.core`，而是按能力拆成 `browser-worker / search-worker / scrape-worker`，避免另一种 monolith creep

**风险：低（暂不立项）。**

---

## 5. Phase 8 推荐合成方案

### 5.1 In-Scope（第一波，3-4 周）

1. **`agent.core` worker** — KernelRunner 接通，session-do-runtime 真实部署，HTTP+WS edge 上线
2. **`bash.core` worker** — capability-runtime 包成独立 worker，service-binding 接 `agent.core`
3. **`filesystem.core` worker (memory + R2)** — WorkspaceNamespace 上线，R2 promotion 接通
4. **NACP cross-worker handshake 验证** — 三个 worker 之间通过 service binding 真实通讯
5. **CrossSeamAnchor 跨 worker 连续性** — `x-nacp-trace/session/source-*` headers 在所有 worker 跳数都被保留，trace 在 eval sink 里能拼成一条完整链路
6. **Evidence cross-worker fan-in** — `agent.core` 持有 default eval sink，其它 worker 把 evidence 通过 hooks/binding 回流到这里
7. **Deployable MVP** — 一条真实可点开的部署，能演示一次 agent turn（fake provider 或真实 OpenAI/Anthropic）

### 5.2 Out-of-Scope（第一波明确不做）

1. **`context.core` 独立 worker** — 等 spec
2. **`skill.core` 独立 worker** — 等明确产品需求
3. **真实 LLM-driven context compression** — 同上
4. **KV / D1 production adapters** — 留 Phase 8.B
5. **`ReferenceBackend` 接通** — 留 Phase 8.B
6. **完整 just-bash port** — 维持当前 governed 12-pack
7. **浏览器 / 搜索 / 爬虫** — 维持 reserved
8. **重型 frontend / artifact DDL / registry business model** — 不在矩阵 MVP 范围
9. **service-binding 表的 `CONTEXT_CORE / SKILL_CORE`** — 留 binding 名字但不部署

### 5.3 实现路径（推荐顺序）

| 周 | 动作 | 验收信号 |
|---|---|---|
| W1 | `agent.core` 立壳 + KernelRunner 接通 + 单 worker deploy | 能 deploy；HTTP `session.start` 收到 `session.frame_ready` |
| W2 | `bash.core` 立壳 + ServiceBindingTarget 接到 agent.core | agent.core 发 `tool_exec` 跨 worker 跑到 bash.core 并回流 |
| W3 | `filesystem.core` 立壳 (memory + R2) + workspace 跨 worker | bash.core 写的文件 → filesystem.core 持久 → 下次读出来 |
| W3-W4 | CrossSeamAnchor + evidence fan-in 跨 worker 验证 | 一次 turn 在 eval sink 里拼出完整 trace 链 |
| W4 | Deploy smoke + 演示 demo | 能给非工程同事点开演示 |

### 5.4 Phase 8.B（不在本轮，但应预留 seam）

- `context.core` spec 落地后立项
- KV / D1 adapters 落地，`ReferenceBackend` 接通
- `skill.core` 按真实产品需求拆 worker

---

## 6. 我对你方案的诚实判断（一图归纳）

```
你的提案：5 worker matrix
        ┌─────────────────────────────────────────────┐
        │  agent.core   bash.core   filesystem.core  │  ← READY，应该立刻做
        ├─────────────────────────────────────────────┤
        │  context.core                               │  ← 等 spec
        │  skill.core                                 │  ← 没地基，等需求
        └─────────────────────────────────────────────┘
                            │
                            ▼
我的合成：3 worker matrix + 2 reserved binding
        ┌─────────────────────────────────────────────┐
        │  agent.core   bash.core   filesystem.core  │  ← Phase 8.A
        ├─────────────────────────────────────────────┤
        │  CONTEXT_CORE (binding name reserved)      │  ← Phase 8.B
        │  SKILL_CORE   (binding name reserved)      │  ← Phase 8.C
        └─────────────────────────────────────────────┘

效果：
  · 拿到你想要的 NACP cross-worker reality
  · 拿到 deployable MVP
  · 防止 monolith creep（已经物理拆开）
  · 不被 context spec 与 skill greenfield 拖死
  · 后续扩展只是"把 binding 名字换成实 worker"，不需重构
```

---

## 7. 最终 verdict

### 7.1 是否推荐你的"5-worker 矩阵"作为下一阶段方向

> **战略目标推荐。第一波立项颗粒度不推荐。**

具体地：
- ✅ **推荐**：把 5-worker 矩阵作为产品的最终架构北极星
- ✅ **推荐**：把"NACP cross-worker reality + deployable MVP + 防止 monolith creep"作为下一阶段的核心验证目标
- ❌ **不推荐**：第一波就把 5 个 worker 全部立项
- ✅ **推荐**：第一波只做 `agent.core / bash.core / filesystem.core` 这 3 个有真实地基的 worker
- ✅ **推荐**：在 service-binding 目录里**预留** `context.core / skill.core` 名额，作为 reserved seam，明确不在第一波
- ✅ **推荐**：在 `agent.core` 内部继续直接使用 `composeWorkspaceWithEvidence` 作为 context 装配的临时位置，等你的 context spec 出来后再升级

### 7.2 与 GPT 评估的差异

GPT 在 `worker-matrix-eval-with-GPT.md` 给出了 "**5 个都建成真实 worker，但厚薄不同**"的方案——3 个 load-bearing + 2 个 real-but-thin。

我的判断比 GPT **更保守一档**：

> **2 个不要建成 real-but-thin worker，而要建成 reserved binding 名额。**

理由：
- "real-but-thin worker" 仍然要写 wrangler.toml、CI、deploy smoke、维护 secret/binding。这些是真实成本。
- `context.core` 等 spec 出来后接口会改一次，现在做 thin 也是浪费。
- `skill.core` 是 greenfield，"thin" 也得有一个能跑的 stub，本质上是写新代码。

我承认 GPT 的方案更"对得起 5-worker 这个北极星"，但我的方案在**节奏**上更现实。

### 7.3 一句话总结

> **你的方向是对的——nano-agent 必须立刻从 packages 内部走出来，组成可部署的、跨 NACP 通讯的 worker 矩阵。但第一波只做 3 个，剩下 2 个留 binding 名额。这样你既能在 3-4 周内拿到一个真实可演示的 MVP，又能避免被 spec 没出的 `context.core` 和没地基的 `skill.core` 拖死整个节奏。把 5-worker 当架构北极星，而不是第一波立项范围。**

---

## 附：当前真实代码事实快照（写本文时核对）

| 事实 | 文件 | 行号 |
|---|---|---|
| 默认 composition factory `kernel: undefined` | `packages/session-do-runtime/src/composition.ts` | 95 |
| 远程 composition factory `kernel: undefined` | `packages/session-do-runtime/src/remote-bindings.ts` | 386 |
| llm fetcher 仅当 binding 存在时设置 | `packages/session-do-runtime/src/remote-bindings.ts` | 387 |
| 远程 composition factory `workspace: undefined` | `packages/session-do-runtime/src/remote-bindings.ts` | 391 |
| `ReferenceBackend` 全部抛 "not connected" | `packages/workspace-context-artifacts/src/backends/reference.ts` | 19/25/33/41/47 |
| `NullStorageAdapter` 全部抛 "not connected" | `packages/storage-topology/src/adapters/scoped-io.ts` | 87-127 |
| `BrowserRenderingTarget` 是 stub | `packages/capability-runtime/src/targets/browser-rendering.ts` | — |
| `CURL_NOT_CONNECTED_NOTE = "curl-not-connected"` | `packages/capability-runtime/src/capabilities/network.ts` | 38 |
| `composeWorkspaceWithEvidence` 已就绪 | `packages/session-do-runtime/src/workspace-runtime.ts` | 75-101 |
| `KernelRunner` 类完整但 packages/session-do-runtime 从未实例化 | `packages/agent-runtime-kernel/src/...` | — |

这些事实应当作为 Phase 8.A 立项 review 时的基线 checklist。
