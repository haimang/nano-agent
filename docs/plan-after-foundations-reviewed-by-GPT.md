# Plan After Foundations — Reviewed by GPT

> 文档对象：`docs/plan-after-foundations.md`
> 审查人：`GPT-5.4`
> 审查日期：`2026-04-19`
> 审查性质：`charter review / code-fact audit / sequencing critique`
> 审查结论：`changes-requested`

---

## 0. 总判断

我的总判断是：

> **这份 charter 的大方向是对的，而且比“直接进入 worker matrix”更符合当前代码现实；但它现在还不能原样作为正式执行 charter 冻结。**

我明确支持它做出的三条主判断：

1. **worker matrix 之前必须插入一个 after-foundations 验证期**
2. **这个阶段必须用真实 Cloudflare 部署形态做 spike，而不是只在本地补测试**
3. **这个阶段必须 ship 代码，而不是只产出文档**

但我也认为，当前稿子仍有几个会影响执行正确性的 load-bearing 问题：

1. **把“platform truth probe”“package hardening”“next-stage worker naming/binding handoff”三层东西写得过于捆绑**
2. **对当前仓库 readiness 的表述仍偏乐观，容易把“typed seam 已有”误读成“runtime 组装已成熟”**
3. **`context-management` 的包边界、`hooks 8→18` 的冻结时机、`nacp 1.2.0` 的具体消息族，仍然前置得过早**
4. **worker matrix 的 future worker 命名，与当前 `session-do-runtime` 已冻结的 v1 binding catalog，并不在同一个抽象层**

所以我的建议不是推翻，而是：

> **保留“spike-first + ship code + pre-matrix hardening”这条主线，但在正式开工前，对 §2 / §4 / §6 / §7 / §11 做一次收紧和去混层。**

---

## 1. 我明确赞同的部分

### 1.1 先 after-foundations，再 worker matrix

这一点我明确赞同，而且与 `docs/eval/after-foundations/before-worker-matrix-eval-with-GPT.md` 的判断一致。

当前仓库虽然已经有 `nacp-core / nacp-session / capability-runtime / workspace-context-artifacts / hooks / eval-observability / storage-topology / session-do-runtime` 这批 foundations，但它们更接近：

- **contract-tested packages**
- **typed seams**
- **partial deploy skeleton**

而不是已经完成了真实 Cloudflare runtime 收口的 worker fabric。

这从代码上是清楚的：`packages/session-do-runtime/src/composition.ts` 的默认工厂仍返回 `kernel / llm / capability / workspace / hooks / eval / storage = undefined`；`packages/session-do-runtime/src/remote-bindings.ts` 也只把 `llm / capability / hooks` 三条 remote seam 做成可选装配，`kernel / workspace / eval / storage` 仍未进入默认真实组装路径。

所以，**先补平台真相，再做 worker matrix**，是正确的。

### 1.2 spike 必须是真实 deploy-shaped probe

这一点也对。因为当前仓库里最缺的，恰好就是本地测试很难证明的几类事实：

- R2/KV/DO 的真实行为差异
- service binding 的真实延迟/失败/重试形态
- fake-bash 在 Worker 限制下的真实 CPU/subrequest 边界

`packages/storage-topology/src/adapters/scoped-io.ts` 里的 `NullStorageAdapter` 仍然对所有 `do/kv/r2` 操作抛 `not connected`；`packages/workspace-context-artifacts/src/backends/reference.ts` 的 `ReferenceBackend` 也仍然是纯占位 seam。  
这说明本阶段确实需要真实平台探针，而不是继续只在内存环境里推演。

### 1.3 “本阶段必须 ship 代码”这个判断是成立的

这一点我也赞同。

如果 after-foundations 只做 spike 和文档，不把结果沉淀回 packages，那么下一阶段还是会重新回到“边写 worker，边发现基础构件不够用”的老问题。  
所以这个阶段应该有代码产出，而且这些产出确实应该落回现有 foundations。

### 1.4 把 async compaction 当成核心能力，而不是可选增强

这个判断方向上是对的。

从 `docs/eval/after-foundations/context-management-eval-by-GPT.md` 的结论看，nano-agent 真正值得建设的，不是复制本地 CLI 的“文件记忆 + 手动 compact 心智”，而是：

- 有预算治理
- 有 inspection
- 有 prepare/commit 生命周期
- 有分层 storage 视图

所以把 async compaction 提升为 after-foundations 的核心主题，我是支持的。

### 1.5 “不要把 storage.* / context.assemble.* 直接做成协议面”这个克制是对的

这条边界判断也对。

`storage-topology` 和 `workspace-context-artifacts` 当前更适合作为 worker 内部 capability / storage / assembly seam，而不是马上上升成新的协议家族。  
这一点和我此前对 NACP 的判断一致：**协议要服务边界，不要吞掉内部实现。**

---

## 2. 我认为当前 charter 的主要问题

### 2.1 §2 对“当前仓库起点”的描述偏乐观

`docs/plan-after-foundations.md` 在 §2.1 里把当前状态概括为“8 个 skeleton packages 已 closure”，这个表述容易误导。

更准确的说法应该是：

> **8 个 foundations packages 已达到“接口、对象模型、包内测试、部分跨包 contract tests 已成立”的状态，但 default runtime assembly 仍然是 partial。**

原因很直接：

1. `packages/session-do-runtime/src/composition.ts` 默认仍返回全空 handle bag
2. `packages/session-do-runtime/src/remote-bindings.ts` 虽然已有 remote seam wiring，但只覆盖 `capability / hooks / provider`
3. `packages/session-do-runtime/package.json` 运行时依赖甚至还没有直接把 `hooks / storage-topology / eval-observability / llm-wrapper / capability-runtime` 作为正式 runtime deps 收进来

这意味着当前仓库的真实成熟度是：

- **foundation seam 已经存在**
- **assembly host 还没有真正长成**

如果 charter 不把这一点写清，后续就很容易把 after-foundations 执行成“在一个其实还没组装起来的 runtime 上继续叠大 scope”。

### 2.2 future worker 命名，与当前 v1 binding catalog 混层了

这是我认为当前稿子里最需要修正的一点。

当前真实代码里，`packages/session-do-runtime/src/env.ts` 冻结的 v1 remote binding catalog 只有：

- `CAPABILITY_WORKER`
- `HOOK_WORKER`
- `FAKE_PROVIDER_WORKER`

并且只保留了一个 reserved slot：

- `SKILL_WORKERS`

`packages/session-do-runtime/wrangler.jsonc` 也只声明了这三条 services binding。  
当前仓库里根本还没有 `context.core`、`filesystem.core` 这些 binding slot，更没有一个所谓的 “service-binding 目录” 可供直接预留 `agent.core / bash.core / filesystem.core / context.core` 名额。

更重要的是，这两层其实不是同一个抽象层：

| 层 | 当前代码里的意思 |
|---|---|
| `CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER` | **agent session runtime 消费的 remote seam** |
| `agent.core / bash.core / filesystem.core / context.core` | **下一阶段想做的产品级 worker 拆分** |

把这两层直接合并成同一个“binding reservation”动作，会让 charter 在实现时变得非常含混。

我建议这里明确改成：

1. **本阶段只允许冻结“下一阶段 worker naming proposal”**
2. **只有当本阶段真的修改 `env.ts / worker.ts / wrangler.jsonc` 时，才谈 binding catalog reservation**
3. **不要把 `agent.core` 也写成一个被 reservation 的 service binding slot**，因为它更像 host worker，而不是被 host 消费的 remote binding

### 2.3 `context-management` 的当前包边界定义过宽，且会和已有包重叠

这是第二个很重的结构问题。

当前仓库里，其实已经有一批 context/workspace/inspection primitives：

- `packages/workspace-context-artifacts/src/context-layers.ts`
- `packages/workspace-context-artifacts/src/context-assembler.ts`
- `packages/workspace-context-artifacts/src/compact-boundary.ts`
- `packages/workspace-context-artifacts/src/snapshot.ts`
- `packages/session-do-runtime/src/workspace-runtime.ts`
- `packages/eval-observability/src/inspector.ts`

其中：

1. `workspace-context-artifacts` 已经拥有 **mount/router/artifact/context assembly/compact boundary/snapshot**
2. `session-do-runtime` 已经有 `composeWorkspaceWithEvidence()`
3. `eval-observability` 已经有 `SessionInspector`

所以，当前 charter 里 Phase 3 的 `packages/context-management/` 如果同时接管：

- `storage/`
- `lifecycle/`
- `inspector/`

就会把三个已有包的职责重新打散一遍。

我不反对新建 `context-management`，但我认为它必须收窄成：

| 包 | 应继续拥有的职责 |
|---|---|
| `workspace-context-artifacts` | workspace data plane、context layers、artifact/snapshot/compact boundary |
| `storage-topology` | 物理 tier adapter 与 placement/policy |
| `eval-observability` | live/durable inspection primitives |
| `context-management` | **budget policy、async compact scheduler/planner/prepare/commit、context inspection protocol facade** |

否则 after-foundations 不是在 harden foundations，而是在第二次重切 foundations。

### 2.4 §2.3 的 “Inspector 无” 表述并不准确

`docs/plan-after-foundations.md` 在 §2.3 里把 Inspector 写成“无”，这在代码事实层面不准确。

当前确实**没有 context-specific 的 HTTP/WS inspection endpoint**，但仓库并不是“没有 inspector 概念”：

- `packages/eval-observability/src/inspector.ts` 已经有 `SessionInspector`
- `packages/eval-observability/README.md` 也已经明确它是 live session stream inspector

所以这里更准确的 gap 应该写成：

> **缺少 context-usage / context-layers / context-policy / snapshot-oriented inspection surface，而不是完全没有 inspector。**

这个修正很重要，因为它会直接影响 Phase 3 的 scope：  
是“新建 inspection protocol facade”，还是“重新发明 inspector”。

### 2.5 Hooks 8→18 的目标既有内部算术错误，也有冻结过早的问题

这是当前 charter 里最明显的逻辑断点之一。

当前 `packages/hooks/src/catalog.ts` 真实只有 8 个 event，这个判断没问题。  
但 Phase 4 里对扩张目标的写法本身不自洽：

1. §4.1/E 写的是新增 `6 + 2 + 4 = 12` 个 event
2. §7.5 又写“新增 10 events”，但列出来的名字仍然是 12 个
3. 现有 8 个 + 新增 12 个，应该得到 **20**，不是 **18**

这不是文字小问题，而是说明当前 hook charter 还没有真正完成 catalog freeze。

而且，从来源上看，这 12 个新增事件里至少有三类需要更谨慎：

1. **Claude Code 借鉴事件**  
   `context/claude-code/entrypoints/sdk/coreTypes.ts` 里确实有 `Setup / Notification / Stop / StopFailure / PermissionRequest / PermissionDenied / FileChanged / CwdChanged` 等事件；  
   但 Claude Code 同时也有 `SubagentStart / WorktreeCreate / FileChanged / CwdChanged` 这类明显依赖本地运行时、subagent、worktree 的心智。nano-agent 当前是 single-thread worker runtime，不应机械移植。

2. **环境事件**  
   `FileChanged / CwdChanged` 在本地 CLI 有强意义；在 Worker + fake filesystem 世界，它们是否存在、由谁产生、是不是 runtime truth，都还没有经过 spike 验证。

3. **async compact 事件**  
   `ContextPressure / ContextCompactArmed / ContextCompactPrepareStarted / ContextCompactCommitted` 只有在 Phase 3 的真实生命周期稳定后，才能冻结成 catalog truth。

所以我的建议是：

> **Phase 4 不能先写死“8→18”；应该改成“基于 Phase 3 producer reality + Phase 0/6 spike findings，冻结一版扩展 catalog”，最终总数可以是 12、14、16、18，但不该现在先拍死。**

### 2.6 NACP 1.2.0 的升级时机可以保留，但消息家族不应现在就写死

我同意本阶段就做协议升级，不建议把它拖到 worker matrix。

但我不同意现在就在 charter 里把具体 family 写死为：

- `context.compact.prepare.request/response`
- `context.compact.commit.request/response`
- `context.budget.exceeded`
- `session.context.usage.snapshot`

原因是：

1. 当前 `packages/nacp-core/src/messages/context.ts` 只有最小 `context.compact.request/response`
2. 当前 `packages/nacp-session/src/messages.ts` 也还没有任何 context inspection message family
3. 如果 Phase 3 最终采用的是“worker 内部 scheduler + HTTP/WS inspection facade”，那未必每个 lifecycle 都值得变成 NACP core/session 消息

也就是说，**我支持“本阶段做 1.2.0 升级”，但不支持“在 spike 之前就把 1.2.0 的具体消息面冻结成 charter truth”。**

更稳的写法应该是：

> Phase 5 的目标是：**基于 Phase 3 producer/consumer reality，最小化扩展 NACP 以承载 async compact 与 context inspection 所需的稳定协议面。**

### 2.7 “Round 1 spike 不依赖任何 packages/ 代码”过于绝对

我理解这条纪律背后的动机：  
避免 spike 被本地 seam 先验绑架，做不出真正的 platform probe。

但按现在的写法，它容易把 Phase 0 变成“独立小实验”，而不是“对 foundations 的现实校验”。

我建议保留这个精神，但把话改成：

> **Round 1 spike 不依赖 packages/ 的运行时实现；但它的验证目标、finding 模板、以及回写任务，必须显式对齐 packages/ 的 seam 与 contract。**

否则会出现一种很危险的情况：  
spike 在证明 Cloudflare truth，packages 在维持自己的 seam truth，两者只在文档里口头会合。

### 2.8 semver bump 不应被写成本阶段的主要价值锚点

这一条不是 blocker，但我建议收紧。

当前仓库里：

- `hooks` 是 `0.1.0`
- `storage-topology` 是 `0.1.0`
- `session-do-runtime` 也是 `0.1.0`
- `nacp-core / nacp-session` 是 `1.1.0`

所以把 `storage-topology 2.0.0`、`hooks 1.0.0`、`nacp 1.2.0` 写进 exit criteria 可以理解，但它们不该成为本阶段的主要成功标记。  
真正的成功标记应该是：

- spike 暴露并消化了真实 gap
- package law 收窄了
- runtime truth 与 protocol truth 对齐了

版本号只是结果，不是价值本身。

---

## 3. 我认为这份 charter 的盲点与断点清单

| 类别 | 盲点 / 断点 | 为什么会出问题 | 我建议的修正 |
|---|---|---|---|
| runtime readiness | 把 foundations closure 写得像 runtime assembly ready | 会误导后续 scope 继续叠在一个其实还没组装好的 host 上 | 把 §2.1 改写成“typed seams ready, live assembly partial” |
| binding taxonomy | future worker matrix 命名和当前 v1 binding catalog 混层 | 实施时会不清楚到底是在改当前 host 的 remote seam，还是只是记录下一阶段 worker 提案 | 分开写 “current binding catalog” 与 “next-phase worker naming proposal” |
| context package law | `context-management` 同时吞 storage / lifecycle / inspector | 会和 `workspace-context-artifacts / storage-topology / eval-observability` 重叠 | 只让新包拥有 budget + async compact + inspection facade |
| inspector reality | 把 inspector 写成“无” | 会导致 Phase 3 重复造 निरीक्षण primitives | 改成“无 context-specific inspection surface” |
| hooks freeze | 8→18 目标有算术错误且冻结过早 | catalog 还没真正 freeze，就会把后续 Phase 3/5 带偏 | 先 freeze event classes，再 freeze exact count |
| protocol timing | 1.2.0 具体消息族前置冻结 | 如果 producer/consumer reality 与假设不符，Phase 5 会被迫重写 | 保留升级时机，不预冻结具体 family |
| spike discipline | Round 1 与 packages 完全断开 | 容易产生“spike truth”和“package truth”双轨漂移 | 强化回写/追踪纪律，而不是绝对隔离 |
| success criteria | 版本号过度前置 | 容易把语义成熟度简化成 semver bump | 把 semver 降级为附属结果 |

---

## 4. 我建议怎样修这份 charter

### 4.1 保留主线，不改掉这三个核心判断

下面三条我建议原样保留：

1. **先 after-foundations，再 worker matrix**
2. **用两轮 deploy-shaped spike 暴露并消化 platform truth**
3. **本阶段必须 ship 代码，不只是写文档**

### 4.2 但要把本阶段的“必须冻结项”收紧成三层

我建议把本阶段真正要冻结的东西拆成三层：

#### A. 必须冻结

- spike discipline
- storage adapter contract 的修订结果
- fake-bash 扩展后的 supported / partial / unsupported inventory
- async compact lifecycle 的最小 producer/consumer law
- NACP 1.2.0 的最终最小协议面

#### B. 可以先做 proposal，不要现在冻结

- worker matrix 的最终 4+1 worker naming
- context-management 是否必须作为独立包存在，还是应先在既有包上收敛
- hooks 扩展后的精确总数

#### C. 明确延后

- 任何 productized worker shell
- context/filesystem/skill 的正式 service binding catalog
- 比 v1 需要更多运行时前提的 Claude-Code-style environment hooks

### 4.3 我建议的阶段收紧方式

如果要保持 Phase 0-7 的骨架，我建议这样收紧：

1. **Phase 0**：只做 platform truth probe + package impact findings  
2. **Phase 1**：storage adapter hardening + `ReferenceBackend` 接通  
3. **Phase 2**：在 `capability-runtime` 内扩 fake-bash 高频能力，不再发明第二套 fake-bash runtime  
4. **Phase 3**：只建设 `budget + async compact lifecycle + context inspection facade`，避免与现有包重叠  
5. **Phase 4**：先 freeze expanded hook classes，再 freeze exact catalog  
6. **Phase 5**：根据 Phase 3/4 的真实 producer/consumer reality 冻结 NACP 1.2.0  
7. **Phase 6**：integrated spike 验证  
8. **Phase 7**：只输出 handoff memo 与 future worker naming proposal，不把 binding reservation 写成已完成事实

### 4.4 我最建议优先重写的章节

如果只做一轮最小修改，我建议优先重写：

1. `§2 当前仓库的真实起点`
2. `§4 In-Scope / Out-of-Scope`
3. `§6 Phases`
4. `§7.5 Hooks Catalog Expansion`
5. `§7.6 NACP Protocol Upgrade`
6. `§11 Exit Criteria`

---

## 5. 对这份 charter 的最终评价

我对 `docs/plan-after-foundations.md` 的最终评价是：

> **这是一份方向判断显著正确、而且已经吸收了多轮 owner pushback 的 charter；但它现在仍处在“高质量 draft”状态，还没有到可以原样冻结为执行真相源的程度。**

它最值得肯定的地方在于：

- 没有继续执着于“立刻做 worker matrix”
- 正确认知到 Cloudflare runtime truth 不能只靠本地测试推断
- 正确认知到 after-foundations 必须产出 shipped code
- 正确认知到 async context compaction 会决定 nano-agent 的独特性

它最需要修正的地方在于：

- **把 package hardening、protocol freeze、future worker taxonomy 混得过紧**
- **对当前 runtime assembly readiness 仍有轻微高估**
- **对 hooks / NACP 的 exact freeze 仍然过早**
- **对 `context-management` 的包边界定义仍然偏大**

---

## 6. 最终 Verdict

### 6.1 关于方向

**Verdict：明确支持。**

after-foundations 作为 worker matrix 之前的 spike-driven hardening phase，这个方向是正确的。

### 6.2 关于当前这份 charter

**Verdict：强烈保留，但必须做一轮收紧后再冻结。**

它已经足够成为：

- after-foundations 的主方向说明
- 下一轮设计/行动计划的母稿
- owner / reviewer / implementer 之间的统一坐标

但它还不应该直接被当成“已经无歧义的 execution SOT”。

### 6.3 一句话总评

> **Opus 这份 `plan-after-foundations` 已经把方向选对了：先做真实 Cloudflare truth probe，再 harden foundations，再进入 worker matrix。真正还没收口的，不是“要不要这么做”，而是“哪些东西该在本阶段冻结，哪些东西只能先做 proposal”。只要把 runtime readiness、binding taxonomy、context package law、hooks exact count、NACP exact message family 这五处收紧，这份 charter 就能成为一个非常强的下一阶段起点。**
