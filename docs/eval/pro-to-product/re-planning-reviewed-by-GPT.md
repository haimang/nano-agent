# GPT 对 `re-planning-by-opus.md` 的再次复核（基于 HPX7 已完成事实）

> **文档性质**: `eval / planning-review`
> **评审对象**: `docs/eval/pro-to-product/re-planning-by-opus.md`
> **评审方法**: 只以当前仓库代码、`hero-to-pro` 最新 closure / charter 为事实依据；不以 owner 偏好或二手 review 作为事实来源
> **日期**: `2026-05-02`

---

## 0. TL;DR

我的结论是：**这份 re-planning 在“阶段方向”和“主干 phase 重排”上，明显比 initial 草案更成熟；但在 HPX7 已完成之后，它已经同时出现了两类新问题：**

1. **事实基线已经部分过时**：文中仍把 `hero-to-pro` 入口前提写成 `partial-close / 7-retained`，并把 HPX7 中若干项写成“待修代码补丁”，而当前真实状态已经变成 `close-with-known-issues / 4 owner-action retained`，且 HPX7 中至少两项是 **verification-first 合法收口**，不是继续开 patch（`docs/eval/pro-to-product/re-planning-by-opus.md:11-12,191-223`; `docs/issue/hero-to-pro/HPX7-closure.md:14-19,27-32`; `docs/issue/hero-to-pro/hero-to-pro-final-closure.md:21-30`）。
2. **设计文档生产方案过重**：真正“复杂”的，不是它把 phase 拆成 7 段，而是它试图在 PP0 前后 frontload **13 份 design + 26 份 review**。这会把下一阶段重新拉回 “文档体系很完整，但 live caller 还没真正接通” 的老风险（`docs/eval/pro-to-product/re-planning-by-opus.md:397-429,493-501`）。

所以，如果你问我一句最直接的话：**我认同这份 re-planning 的 phase 判断，大体不认同它现在这版 design 蓝图。**

更具体地说：

- **该保留的**：PP1/PP2 拆分、PP3 前置、Policy honesty 单列、6 truth gate、D1 freeze 改成默认原则 + 受控例外。
- **该收缩的**：13 份 design、26 份 review、PP0 18-23 天的文档前置生产。
- **更直接清晰的做法**：把 mandatory 前置文档从 13 份收缩到 **6 份左右**：`1 份 charter + 2 份 cross-cutting architecture + 3 份高风险 phase design`；其余内容改放 charter 附录或各 phase action-plan。

---

## 1. 经过 HPX7 之后，哪些判断仍然成立

### 1.1 PP1 / PP2 拆开，仍然是正确的

这点在当前代码里是站得住的。

HITL interrupt 的真实断点是：`authorizeToolPlan()` 在收到 `ask/deny` 时仍然直接走 error result，而不是暂停 turn 等待人类输入（`workers/agent-core/src/host/runtime-mainline.ts:235-261`）。但与此同时，`emitPermissionRequestAndAwait()` 与 `awaitAsyncAnswer()` 这条 async answer substrate 已经存在，说明缺的是 **caller 接通**，不是 transport/substrate 缺失（`workers/agent-core/src/host/do/session-do-runtime.ts:378-397`）。

Context budget 则是另一条完全不同的断点链：`buildExecutionRequest()` 仍然只做 capability validation，不做 token/context-window preflight（`workers/agent-core/src/llm/request-builder.ts:34-120`）；`requestCompact()` 现在也仍然直接返回 `{ tokensFreed: 0 }`，说明 compact 还停在假闭环（`workers/agent-core/src/host/runtime-mainline.ts:833-836`）。

所以，**PP1=interrupt、PP2=budget** 的拆分不是文档癖，而是当前代码确实已经把这两条工作分成了两组不同 owner file / 不同验收方式。

### 1.2 PP3（Reconnect）排在 PP4（Hook）前面，仍然是对的

我仍然认同这条顺序判断。

因为 reconnect 现在的断点仍然非常硬：

1. checkpoint 时，WS helper replay 确实会被写盘（`workers/agent-core/src/host/do/session-do-persistence.ts:154-160`）。
2. 但 `restoreFromStorage()` 只恢复 `actorPhase / kernelFragment / turnCount`，没有把 helper replay 读回来（`workers/agent-core/src/host/do/session-do-persistence.ts:193-222`）。
3. `ReplayBuffer.replay()` 对过旧 seq 仍然直接 throw `NACP_REPLAY_OUT_OF_RANGE`（`packages/nacp-session/src/replay.ts:58-73`）。

这说明 PP3 的优先级确实高于 PP4。因为前端一旦断线，session 的可信度会直接掉下去；而 hook 当前虽然不完整，但主要还是“内部 framework 没 fully 接成 product loop”的问题，不是“页面一刷新就失真”的问题。

### 1.3 PP4 应该坚持 minimal live loop first

这点我也认同，而且 HPX7 完成后反而更应该坚持。

当前 hook 侧的现实仍然是：runtime assembly 里会无条件 new `HookRegistry + HookDispatcher`，但这证明的是 **dispatcher substrate 已注入**，不是 production register source 已接通（`workers/agent-core/src/host/do/session-do/runtime-assembly.ts:155-160,191-196`）。能看到的明确 register 路径，仍然是在 snapshot restore 里把 handler 重新注册回 registry（`workers/agent-core/src/hooks/snapshot.ts:42-53`）。与此同时，tool permission 仍然先走 `authorizeToolPlan()`，并没有先进入 `PreToolUse` hook loop（`workers/agent-core/src/host/runtime-mainline.ts:235-261,545-560`）。

所以，PP4 继续坚持 **“至少一条 live loop 先打通，再扩 surface”** 是对的；如果反过来从大 catalog / 大 UI surface 起步，极容易重演 HPX5/HPX6 的 schema-live / producer-not-live。

### 1.4 Policy honesty 必须是明确 phase 命题

这也仍然成立。

因为 `/runtime` 的 public contract 已经继续扩大了：现在它不止有 runtime fields，还有 `ETag / If-Match` optimistic lock（`workers/orchestrator-core/src/facade/routes/session-runtime.ts:18-25,129-136,177-207`）。但运行时真正消费的，依然还是 session rule / tenant rule / approval policy fallback；`network_policy / web_search / workspace_scope` 仍没有进入 authorize 决策（`workers/orchestrator-core/src/entrypoint.ts:351-378`）。

所以 re-planning 把 **Policy honesty** 明文变成阶段级命题，我认为是对的。前端最怕的不是“字段还没做”，而是“字段已经公开了、文档也写了，但运行时根本不认”。

---

## 2. 经过 HPX7 之后，这份 re-planning 已经出现的过时点

这里是我认为必须明确写出来的部分。不是因为这份文档“方向错了”，而是因为 **HPX7 已经把它的一部分前提改写掉了**。

### 2.1 入口事实已经过时

文头仍然把 `hero-to-pro-final-closure.md` 写成 `partial-close/7-retained`，把 `HPX6-closure.md` 写成 “executed-with-followups + 4 项 followup”（`docs/eval/pro-to-product/re-planning-by-opus.md:11-12`）。

但当前真实事实已经是：

- `hero-to-pro` 阶段总 verdict = `close-with-known-issues / 4-owner-action-retained-with-explicit-remove-condition`（`docs/issue/hero-to-pro/hero-to-pro-final-closure.md:21-30`）。
- HPX7 已经把工程侧 honesty / residual / cleanup blocker 收拢掉（`docs/issue/hero-to-pro/HPX7-closure.md:14-19,36-41,73-80`）。
- charter §16 也已经把 HPX7 纳入阶段现实，明确说明 hero-to-pro 现在的交接重点是 **honesty uplift 后的可信起点**，而不是“还卡在 HPX6/HPX7 尾项”（`docs/charter/plan-hero-to-pro.md:1339-1367`）。

这意味着：**re-planning 现在不能再把自己写成“替一个仍处于 partial-close 的阶段收尾”。** 它应该明确改写成：**“站在 HPX7 已完成、hero-to-pro 已 close-with-known-issues 的起点上做 PP0 入口设计。”**

### 2.2 HPX7 的 S2 标准写得过死，而且已经被实际结果反证

re-planning 把 HPX7 的 S2 写成“不跨 worker”（`docs/eval/pro-to-product/re-planning-by-opus.md:184-187`）。

但 HPX7 真正落地的结果并不是“所有项都单 worker 单文件”：

- `tool.call.cancelled` 的 live caller 修补同时落在 `agent-core runtime-mainline`、`agent-core runtime-assembly`、`orchestrator-core hp-absorbed-routes`（`docs/issue/hero-to-pro/HPX7-closure.md:27-32`）。
- `/runtime` optimistic lock 也不是只改 `runtime-config-plane.ts`，而是 route-level public contract + tests（`docs/issue/hero-to-pro/HPX7-closure.md:31-32,65-67`）。

也就是说，**真正可执行的 HPX7 标准不是“绝不跨 worker 改文件”，而是“不能引入新的跨 worker 架构命题 / 新 substrate / 新 protocol / 新 D1”**。如果把 S2 写成 literal 的“不跨 worker”，它反而会误导未来的 PP0：工程师会为了迎合 planning 文本，把本来合理的小范围双边改动扭曲成更难维护的单边 workaround。

### 2.3 HPX7-2 与 HPX7-5 的描述，已经被 HPX7 实际结果修正

re-planning 里：

- `HPX7-2` 被写成 `reducer.ts llm_response token 双重累加修复`（`docs/eval/pro-to-product/re-planning-by-opus.md:195-200`）。
- `HPX7-5` 被写成 `item-projection-plane.ts 残缺补全`（同上）。

但当前 HPX7 closure 的真实结论是：

- token accounting 是 **verification-closed**，本轮没有再证实独立 live bug，因此没有强做跨面 patch（`docs/issue/hero-to-pro/HPX7-closure.md:27-29`）。
- `/items` 这条也是 **verification-closed**：当前 repo reality 下 7-kind list/detail 已成立，HPX7 做的是 public route tests 与 closure evidence，不是重写 `item-projection-plane.ts`（`docs/issue/hero-to-pro/HPX7-closure.md:30-32,38-40`）。

这说明一个更深的结论：**这份 re-planning 虽然已经比 initial 草案更克制，但它对“verification-first 收口”和“必须写代码修补”之间的边界仍然不够稳。**

---

## 3. 我认为它真正“太复杂”的地方，不在 phase，而在 design 生产

这是我这次 review 最明确的判断。

### 3.1 7-phase 本身不算过度复杂

如果只看 phase 切分，re-planning 其实没有明显过度设计：

- PP1 / PP2 拆分合理；
- PP3 前置合理；
- PP4 minimal live loop first 合理；
- PP5 把 policy honesty 从“顺手补补”升到 phase 级命题合理；
- D1 freeze 从硬禁令改成默认原则 + 受控例外，也比 initial 草案成熟（`docs/eval/pro-to-product/re-planning-by-opus.md:229-355`）。

所以，我不认为“7 phase”本身太多。**问题不在 phase 数量，而在文档套件数量。**

### 3.2 真正过重的是：13 份 design + 26 份 review + PP0 前置 18-23 天

re-planning 在 §9 里提出：

- Tier 1 三份 reasoning / pre-charter 文档；
- Tier 2 四份 cross-cutting architecture 文档；
- Tier 3 六份 per-phase design；
- 总计 13 份 design（`docs/eval/pro-to-product/re-planning-by-opus.md:397-429`）。

同时它又给出 review 体例：

- Tier 1 四家 review；
- Tier 2 两家 review；
- Tier 3 一家 review；
- 总计 26 份 review（`docs/eval/pro-to-product/re-planning-by-opus.md:493-501`）。

这会导致一个很直接的副作用：**PP0 还没开始接 loop，文档生产已经先变成一个小项目。**

这对 `pro-to-product` 来说不合适。原因不是我反对 design doc，而是这一阶段的本质不是再造新 substrate，而是 **把已有 substrate 接成 live caller / truth gate**。它更像“高风险 wiring 阶段”，不是“需要先发明 13 份上游理论文档的架构扩张阶段”。

### 3.3 这套 design 蓝图内部还有两处结构性不严谨

1. **数量不一致**：§9.2 的 Tier 3 标题写的是 “Per-Phase Implementation(5 份)”，但下面实际列的是 `#8-#13` 共 **6 份**，并且 §9.2 末尾自己又写成 `3 + 4 + 6 = 13`（`docs/eval/pro-to-product/re-planning-by-opus.md:416-429`）。
2. **“14 节 charter” 与实际清单不一致**：§7.6 标题写 “PP0 charter 必含 14 节”，但清单从 `§0` 列到 `§16`，实际是 **17 个编号段**，不是 14 节（`docs/eval/pro-to-product/re-planning-by-opus.md:309-339`）。

这两个问题虽然不是产品逻辑 bug，但它们恰恰说明：**文档体系本身已经开始膨胀到作者难以稳定持有的一致性边界了。**

---

## 4. 我建议的更直接、更清晰的办法

如果要在保留 re-planning 主干判断的前提下，把它改成更可执行的方案，我建议这样收缩：

### 4.1 前置 mandatory 文档只保留 3 份

#### 文档 1：`plan-pro-to-product.md`

这份 charter 直接吸收：

- Reality Snapshot
- 6 truth gates
- In-Scope / Out-of-Scope
- D1 freeze 例外
- Frontend Engagement Schedule
- Contingency Contract
- 收口类型判定

也就是说，**不要再把这些信息拆成过多“前置 reasoning 子文档”**。

#### 文档 2：`docs/architecture/pro-to-product-agent-loop-truth.md`

把原方案里的：

- debt acknowledgement matrix
- 9-report deferral matrix
- truth architecture
- honesty contract 中跟三层真相、durable truth、phase truth 有关的部分

合并成一份。

它只回答一类问题：**D1 / DO storage / DO memory 在 6 个闭环里分别负责什么，哪些“已有但未接通”的面要进入本阶段，哪些明确 defer。**

#### 文档 3：`docs/architecture/pro-to-product-frontend-trust-contract.md`

把原方案里的：

- frontend contract
- honesty contract 里与前端可见性相关的部分
- observability baseline

合并成一份。

它只回答另一类问题：**前端在每个闭环里能依赖什么、看到什么、量到什么、哪些字段只是 stored-not-enforced。**

### 4.2 只为高风险 phase 写独立 design

我建议 mandatory 独立 design 只保留 3 份：

1. `PP1-hitl-interrupt-closure.md`
2. `PP2-context-budget-closure.md`
3. `PP3-reconnect-closure.md`

原因很简单：这三段是当前代码里最硬、最容易跨层打架的三条主线：

- PP1 咬住 `authorizeToolPlan()` / async answer / scheduler interrupt（`workers/agent-core/src/host/runtime-mainline.ts:235-261`; `workers/agent-core/src/host/do/session-do-runtime.ts:378-397`）。
- PP2 咬住 request-builder preflight + real compact（`workers/agent-core/src/llm/request-builder.ts:34-120`; `workers/agent-core/src/host/runtime-mainline.ts:833-836`）。
- PP3 咬住 checkpoint / restore / replay / detach policy（`workers/agent-core/src/host/do/session-do-persistence.ts:154-160,193-222`; `packages/nacp-session/src/replay.ts:58-73`）。

### 4.3 PP4 / PP5 / PP6 默认不再预写完整 design

我的建议是：

- **PP4**：先用 action-plan 驱动；只有当 HookDispatcher 与 permission_rules 的仲裁顺序仍有实质争议时，才补专门 design。
- **PP5**：先在 charter 里冻结 “enforce-or-downgrade” law，再用 action-plan 落地；不要先写一份很大的 “Reliability + Policy + Observability” 设计总文。
- **PP6**：尽量收缩成 final closure / docs / observability 校验，不要再挂一串新的 feature 命题。

换句话说，**设计文档应该只服务于“高风险、跨层、未定形”的工作，不应该变成每个 phase 的默认前置仪式。**

### 4.4 收缩后的文档集

如果按我的建议，mandatory 文档集会从 13 份收缩到：

| 类别 | 文件数 | 说明 |
|---|---:|---|
| Charter | 1 | `plan-pro-to-product.md` |
| Cross-cutting architecture | 2 | truth model / frontend trust contract |
| High-risk phase designs | 3 | PP1 / PP2 / PP3 |
| **总计** | **6** | 比 13 份更适合这个阶段 |

PP4-PP6 只在出现未定形风险时再补 design，不再默认强制。

这套方案的好处是：**复杂度真正收下来了，但 phase 判断没有被打散。**

---

## 5. 对 phase 设定本身，我的最终意见

### 5.1 我支持保留的部分

1. **保留 PP1 / PP2 拆分**
2. **保留 PP3 在 PP4 之前**
3. **保留 PP4 minimal live loop first**
4. **保留 PP5 中 policy honesty 的显式地位**
5. **保留 6 truth gates**
6. **保留 D1 freeze 默认原则 + 受控例外**

### 5.2 我建议修正的部分

1. **把 PP6 收轻**  
   现在的 PP6 同时背 observability、reasoning stream、Hook 扩展、docs 新增、final closure，已经有重新变成“everything-that-didn’t-fit”桶的倾向（`docs/eval/pro-to-product/re-planning-by-opus.md:427-429,519-529`）。  
   我的建议是：**PP6 只保留 final closure + docs + observability 校验**；reasoning typing 这类真实 feature 应该尽早并回对应 phase，而不是全部滞留到末段。

2. **把 PP0 从“design 生产 phase”改回“入口冻结 phase”**  
   PP0 应该冻结 reality、scope、gate、例外 law，而不是把 13 份文档先全部推出来。HPX7 已经把最危险的 closure honesty 清掉了，PP0 不需要再承担 hero-to-pro 尾部那种文档救火功能（`docs/issue/hero-to-pro/HPX7-closure.md:36-41`; `docs/charter/plan-hero-to-pro.md:1355-1367`）。

3. **把 Debt Gate 重新刷新**  
   现在的 debt matrix 不能再用 “7 retained + HPX6 R1/R2 followups” 这套旧计数。HPX7 之后，真正 retained 的是 4 项 owner-action；工程侧 known issues 是另一类，不应与 retained 混记（`docs/issue/hero-to-pro/hero-to-pro-final-closure.md:21-30`）。

---

## 6. 最终 verdict

我的最终 verdict 是：

> **`re-planning-by-opus.md` 可以保留为一份“方向正确、但需要瘦身和刷新基线”的 reasoning 文档；它不适合原样直接升级为 PP0 的文档生产蓝图。**

我对它的评价可以概括成三句话：

1. **阶段判断是对的**：比 initial 草案更贴近当前代码耦合面。
2. **文档方案是过重的**：13 份 design + 26 份 review 对这个阶段来说不经济，也不必要。
3. **HPX7 已经改写了它的入口前提**：在进入 PP0 之前，应该先做一轮 **re-planning v2 精简**，把过时的 HPX7 / retained / debt 口径全部刷新。

如果只允许我给一个最明确的建议，那就是：

> **保留这份 re-planning 的 phase 主干，砍掉一半以上的 design 生产，把 PP0 收回到“冻结起点与 gate”，把真正高风险的设计工作集中在 PP1 / PP2 / PP3 三份 design 上。**

这会比现在这版 **更直接、更清晰，也更像一个准备开工的计划**。

---

## 7. 附加章节：我建议的 `docs/design/pro-to-product/` design 清单（单目录版）

既然你倾向于把 design 文件都集中放在 `docs/design/pro-to-product/` 下，我认为这是对的。对于 `pro-to-product` 这种阶段，**设计文件最怕的不是数量少，而是分散在太多目录之后，边界和依赖关系反而更难看清。**

我的建议是：**把 design 控制在“5 份核心必需 + 1 份条件触发”**。这样既比 Opus 的 13 份方案直接很多，又比“完全不写 design、直接进 action-plan”稳得多。

### 7.1 核心必需（5 份）

| # | 文件 | 对应范围 | 为什么必须单独成文 |
|---|---|---|---|
| 1 | `docs/design/pro-to-product/00-agent-loop-truth-model.md` | 跨 phase | 统一回答 D1 / DO storage / DO memory 在 6 个闭环里各负责什么；把 debt matrix、truth architecture、phase truth 边界合并成一份“真相总图”。这是所有后续 phase design 的共同前提。 |
| 2 | `docs/design/pro-to-product/01-frontend-trust-contract.md` | 跨 phase | 统一定义前端在每个闭环里能依赖什么、看到什么、哪些是 `stored-not-enforced`、6 truth gates 怎么验。把 frontend contract、honesty contract、observability baseline 合并成一份“前端可信合同”。 |
| 3 | `docs/design/pro-to-product/02-hitl-interrupt-closure.md` | PP1 | HITL 是当前最明确的 live caller 断点：`authorizeToolPlan()` 仍是 error-out，而 async answer substrate 已存在。这里必须单独锁定 interrupt state machine、pause-resume、timeout、race。 |
| 4 | `docs/design/pro-to-product/03-context-budget-closure.md` | PP2 | Context budget 是另一条独立高风险主线：token preflight、compact 真执行、prompt mutation、overflow degrade 互相强耦合，不能只靠 action-plan 口头带过。 |
| 5 | `docs/design/pro-to-product/04-reconnect-closure.md` | PP3 | reconnect 涉及 checkpoint / restore / replay / lagged contract / detached policy，多层状态恢复顺序必须先锁定，否则最容易做成“每层都补了一点，但前端重连仍不可信”。 |

### 7.2 条件触发（1 份，可选）

| # | 文件 | 何时才需要写 | 作用 |
|---|---|---|---|
| 6 | `docs/design/pro-to-product/05-hook-policy-interlock.md` | 仅当 PP4/PP5 在实施前仍无法快速决定 `PreToolUse → HookDispatcher → permission_rules / approval_policy` 的仲裁顺序时 | 把 Hook delivery 与 Policy honesty 的交叉点单独拆出来，避免 PP4/PP5 各自写 action-plan 时重复发明边界。若该仲裁在 charter / action-plan 阶段已说清，则**这份可以不写**。 |

### 7.3 为什么我不建议再为 PP5 / PP6 各写一份默认 design

原因不是它们不重要，而是它们的风险形态和 PP1-PP3 不一样：

1. **PP5（Reliability + Policy Honesty）** 的第一原则应该先在 charter 与 `01-frontend-trust-contract.md` 里冻结：  
   `network_policy / web_search / workspace_scope` 必须 **enforce 或降格**，不要先展开一份大 design 再讨论。
2. **PP6** 应该尽量收轻成 final closure / docs / observability 校验，不要再变成一个 feature phase。  
   如果 PP6 仍要单独写 design，通常说明前面 phase 切分已经不够干净。

所以，**PP5 / PP6 默认不单列 design**；只有在执行时出现新的、无法靠 action-plan 解决的跨层争议，才再补文档，而不是预先占坑。

### 7.4 我建议的撰写顺序

如果按这个单目录方案执行，顺序应当是：

1. `00-agent-loop-truth-model.md`
2. `01-frontend-trust-contract.md`
3. `02-hitl-interrupt-closure.md`
4. `03-context-budget-closure.md`
5. `04-reconnect-closure.md`
6. `05-hook-policy-interlock.md`（仅在确有争议时补）

这个顺序的好处是：

- 先统一**阶段级真相与前端合同**
- 再锁定**3 条最高风险、最容易跨层打架的主线**
- 最后只在确有必要时，补 Hook / Policy 的交叉专题

### 7.5 最终建议

如果让我给出一个最简洁、但我认为足够稳的版本，那就是：

> **`docs/design/pro-to-product/` 下先准备 5 份核心 design，必要时再加第 6 份条件文档；不要一开始就扩成 10+ 份。**

这套清单既保留了 design 的价值，也避免 `pro-to-product` 还没开始接 live loop，就先把自己重新做成一个文档工程项目。
