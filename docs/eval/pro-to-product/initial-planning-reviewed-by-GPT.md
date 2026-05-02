# GPT 对 `pro-to-product` 初步规划草案的复核意见

> **文档性质**: `eval / planning-review`
> **评审对象**: `docs/eval/pro-to-product/initial-planning-by-opus.md`
> **评审方法**: 以当前仓库真实代码与 `docs/charter/plan-hero-to-pro.md` 为准，不以其他同事报告作为事实来源
> **日期**: `2026-05-02`

---

## 0. TL;DR

我的结论是：**我认同把下一阶段从“hero-to-platform”前移为“pro-to-product”这个命题重写，也认同它的核心目标应该从“继续扩平台”改成“先把 agent loop 做成前端可信赖的产品级 backend”；但我不建议直接照搬 Opus 当前的 PP1-PP5 切分与 “默认绝不新增 D1 schema” 表述。**

原因很直接：我回到当前一手代码后，看到的真实主矛盾不是“端点不够多”，而是 **live caller 缺失、loop 中断点没有真正接上、以及 reconnect/replay 的 durable truth 仍然停在 best-effort**。这与 hero-to-pro charter 反复强调的 **wire-without-delivery 不算闭合** 是同一个问题，只是已经从 wrapper control-plane 进一步下沉到了 frontend trust 问题。

更具体地说，当前代码里至少有 6 条 blocker 仍然非常硬：

1. `approval_policy=ask` 仍然直接变成 LLM error，不会触发真正的 permission pause-resume（`workers/agent-core/src/host/runtime-mainline.ts:229-256`，`workers/agent-core/src/host/do/session-do-runtime.ts:376-414`）。
2. auto-compact 的 trigger 已经有了，但 compact delegate 仍然返回 `{ tokensFreed: 0 }`，没有任何真实 prompt mutation（`workers/agent-core/src/host/do/session-do/runtime-assembly.ts:287-312`，`workers/agent-core/src/host/runtime-mainline.ts:813-816`）。
3. LLM request builder 只做 capability 校验，不做 token/context-window 预检（`workers/agent-core/src/llm/request-builder.ts:22-120`）。
4. `/runtime` 的 `network_policy / web_search / workspace_scope` 已落到 D1，但运行时当前只消费 `permission_rules + approval_policy`，其他字段仍是 stored hints（`workers/orchestrator-core/src/runtime-config-plane.ts:66-145`，`workers/orchestrator-core/src/entrypoint.ts:345-372`）。
5. hook dispatcher 已实例化，但 registry 仍然没有 live production register path；当前能看到的 register 仅出现在 snapshot restore 中，说明系统还停留在“框架 ready，caller 不在”（`workers/agent-core/src/host/do/session-do/runtime-assembly.ts:155-160`，`workers/agent-core/src/hooks/snapshot.ts:43-53`）。
6. reconnect/replay 仍然没有闭环：checkpoint 会把 WS helper replay 写盘，但 `restoreFromStorage()` 只恢复 `kernelFragment / actorPhase / turnCount`，不会恢复 replay buffer；同时断连后 turn 也不会被 cancel（`workers/agent-core/src/host/do/session-do-persistence.ts:154-160,193-222`，`packages/nacp-session/src/replay.ts:58-73`，`workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-214,243-260`）。

因此，我对 Opus 草案的总体评价是：**方向对，问题抓得准，但 phase 组织还不够“按真实耦合面切”，并且对 DDL freeze 的坚持略强于工程现实。**

---

## 1. 我认同的部分

### 1.1 `pro-to-product` 不是改名，而是命题切换

这点我明确同意。

`hero-to-pro` 的原 charter 本来就把下一阶段定义为 `hero-to-platform`，内容偏向 multi-provider、sub-agent、admin、billing、SDK extraction 等平台化主题（`docs/charter/plan-hero-to-pro.md:1172-1206`）。但同一份 charter 也明确把本阶段的硬标准定义成 **4 套状态机闭环、文档对齐、拒绝 wire-without-delivery**（`docs/charter/plan-hero-to-pro.md:1296-1319`）。

现在实际代码告诉我们：HPX5 / HPX6 把 schema、storage、surface 又往前推了一大截，但 **“可被前端信赖地消费”** 这件事还没有成立。这不是继续补 platform feature 能解决的问题，而是必须先插入一个 **productization / trust closure** 阶段。换句话说，`pro-to-product` 的必要性，不是来自“愿景”，而是来自 **当前代码与 hero-to-pro 终态承诺之间仍有最后一层 delivery gap**。

### 1.2 Opus 提出的 6 个闭环，基本抓住了真实矛盾

我也认同用闭环而不是端点列表来组织下一阶段。特别是下面 5 个闭环，我认为都是真问题而不是伪命题：

| 闭环 | 我是否认同 | 原因 |
|---|---|---|
| HITL | **认同** | ask/elicitation 现在都没有真正 pause-resume caller，前端无法建立可信的人机协商回路。 |
| Context | **认同** | compact trigger 已有、context durable probe 已有，但真正的“节流 / 压缩 / 超窗降级”还没发生。 |
| Reconnect | **认同** | 当前最大 connection gap 不是“少几个端点”，而是 replay/restore/detach 语义没闭合。 |
| Policy | **认同** | `/runtime` 字段如果继续 stored-not-enforced，就必须降格写清；否则就是对前端的误导契约。 |
| Reliability | **认同，但要收窄** | fallback metadata、retry、streaming recovery 都重要，但应按真正影响前端 trust 的顺序来做。 |

我对 **Hook-to-Frontend** 的判断稍微不同：**它是重要闭环，但我不建议一开始就把目标写成“14 个 emit producer + HookStarted/HookCompleted 全上 + 客户端全消费”**。当前 hook 系统的真实问题还停留在更基础的一层：dispatcher 虽在，但 registry 为空，PreToolUse 也没走 dispatcher（`workers/agent-core/src/host/runtime-mainline.ts:229-256,793-811`，`workers/agent-core/src/host/do/session-do/runtime-assembly.ts:155-160`）。因此它应先被拆成“hook caller 真接通”与“hook frontend 可见性扩展”两个层次，而不是一上来就当成一个完整产品面。

---

## 2. 我用一手代码重新确认的 backend reality

下面这张表，是我认为对下一阶段分 phase 最重要的一组现实约束。

| 主题 | 当前代码事实 | 对阶段规划的含义 |
|---|---|---|
| HITL ask | `authorizeToolPlan()` 在 `decision !== "allow"` 时直接返回 `tool-permission-required / tool-permission-denied`，不会中断 turn 并等待人类输入（`workers/agent-core/src/host/runtime-mainline.ts:229-256`） | `approval_policy=ask` 不是“有待前端适配”，而是 **loop 本身未接通** |
| Permission emitter | `emitPermissionRequestAndAwait()` 已存在，且会发 `session.permission.request` 后等待 async answer（`workers/agent-core/src/host/do/session-do-runtime.ts:376-395`） | 当前缺的是 **live caller**，不是缺 transport substrate |
| Compact trigger | runtime-assembly 已根据 durable usage / context_window / effective_context_pct 计算 compact required（`workers/agent-core/src/host/do/session-do/runtime-assembly.ts:287-312`） | compact 的 blocker 不是“信号不存在”，而是 **执行面没做** |
| Compact execution | `requestCompact()` 直接返回 `{ tokensFreed: 0 }`（`workers/agent-core/src/host/runtime-mainline.ts:813-816`） | 这不是 polish，而是 **假闭环** |
| Token preflight | `buildExecutionRequest()` 只校验 stream / tools / json schema / vision / reasoning capability，不估 token（`workers/agent-core/src/llm/request-builder.ts:22-120`） | context 闭环不能只靠 compact，还必须补前置预算 |
| Runtime config | D1 plane 可 patch `network_policy / web_search / workspace_scope / approval_policy`（`workers/orchestrator-core/src/runtime-config-plane.ts:100-145`） | field 已落表，不应继续“既公开宣称、又运行时不认” |
| Runtime enforcement | `authorizeToolUse()` 只使用 session rules、tenant rules、approval policy fallback（`workers/orchestrator-core/src/entrypoint.ts:345-372`） | Policy 闭环必须二选一：真 enforce 或诚实降格 |
| Hook registry | runtime 里只看到 `new HookRegistry()`，找不到 production register caller；当前 register 只在 snapshot restore 中出现（`workers/agent-core/src/host/do/session-do/runtime-assembly.ts:155-160`，`workers/agent-core/src/hooks/snapshot.ts:43-53`） | hooks 当前不是“功能弱”，而是 **主回路没接通** |
| Reasoning stream typing | `session-stream-adapter` 对 LLM delta 一律输出 `content_type: "text"`（`workers/agent-core/src/llm/session-stream-adapter.ts:61-69`） | reasoning/thinking 现在连 producer typing 都未成立 |
| Replay persistence | `persistCheckpoint()` 会调用 `helper.checkpoint()` 写 replay + stream seq（`workers/agent-core/src/host/do/session-do-persistence.ts:154-160`） | replay 丢失不是因为没写盘，而是 restore 路径没把它读回来 |
| Replay restore | `restoreFromStorage()` 只恢复 team/user/session state，不恢复 helper replay（`workers/agent-core/src/host/do/session-do-persistence.ts:193-222`） | reconnect 第一优先级应是 restore path，而不是先重写整个协议 |
| Replay failure mode | `ReplayBuffer.replay()` 对过旧 seq 直接 throw `NACP_REPLAY_OUT_OF_RANGE`（`packages/nacp-session/src/replay.ts:58-73`） | 需要 graceful lagged/degrade contract |
| Detached behavior | `webSocketClose()` 只把 actor phase 改成 unattached，不会 cancel running turn（`workers/agent-core/src/host/do/session-do/ws-runtime.ts:243-260`） | detached TTL / running turn policy 是 product trust 问题，不只是连接优化 |

这张表基本也解释了为什么我认为 **pro-to-product 必须以“恢复真实 caller”作为第一原则**。现在很多 surface 都不是零，而是 **85% 的 substrate 已在，最后 15% 的 live wiring 没有完成**。下一阶段如果继续按 endpoint 或 feature list 来拆，就很容易再次制造“表面很满、loop 仍断”的历史问题。

---

## 3. 我对 Opus 草案的主要修正意见

### 3.1 PP1 不应该同时吞下全部 C1+C2，而应显式拆成两段执行面

我理解 Opus 为什么把 `ask + elicitation + compact + token preflight` 放进同一个 PP1：它们都属于 loop blocker。

但从真实代码耦合面看，它们其实分成两类：

1. **Interrupt 闭环**：`approval_policy=ask`、permission request、elicitation、confirmation pending、resume turn。
2. **Budget 闭环**：token accounting、context-window preflight、compact summary、prompt mutation、overflow degrade。

这两类虽然都属于 PP1 级 blocker，但改动中心并不完全一样。前者主要咬住 `runtime-mainline + kernel runner/scheduler + async answer path`；后者主要咬住 `request-builder + context probe + reducer/prompt mutation + compact delegate`。把它们在 charter 中硬捆成一个 phase 可以，但在 action-plan 层最好至少拆成 **PP1A / PP1B 两条执行线**，否则 compact 这条最大的技术风险会拖住 ask-path 这条最直观的产品 blocker。

我的建议是：

- **PP1A = HITL interrupt closure**：先把 `ask / elicitation` 从 “return error” 改成 “pause-resume loop”。
- **PP1B = Context budget closure**：再把 token preflight + real compact + overflow degrade 做实。

如果 owner 只有 1 个 engineer，二者仍可串行放在同一个大 phase；但在文档结构上最好把它们拆开，否则后面 closure 时又会重演“一个大 phase 里有一半真闭了、另一半只是骨架”的口径风险。

### 3.2 Hook 闭环不应从“全目录接通”起步，而应先做最小 live loop

我不同意把 PP2 的第一目标直接写成 “14 个 emit producer + 新 frame schema + HookStarted/HookCompleted + frontend status bar”。

当前 hook 子系统的真实状态是：

- dispatcher 在；
- registry 在；
- runtime 在；
- 但 production register path 还不在；
- `PreToolUse` 也没进入 dispatcher，而是绕路去 `authorizeToolUse()` RPC（`workers/agent-core/src/host/runtime-mainline.ts:229-256`）。

所以我会把 Hook phase 的入口目标改成：

1. **PreToolUse 真走 HookDispatcher**；
2. **至少有一个 live register source**（session/platform-policy 二选一先落一个）；
3. **permission / tool lifecycle 至少有最小前端可见性**；
4. 然后才扩展 HookStarted / HookCompleted / 更多 event catalog。

也就是说，我更倾向把这个闭环命名为 **“Hook delivery closure”**，而不是一开始就写成 **“Hook-to-Frontend full surface”**。前者更诚实，也更符合当前代码事实。

### 3.3 Reconnect phase 的第一优先级应是 restore path，而不是先追求协议重写

Opus 在 C6 / PP3 中同时放了 replay restore、status snapshot、outbound dedup、detached TTL、top-level frame buffer 等内容。我同意这些都重要，但从现在的真实断点看，**最先该修的是 restore path**：

1. checkpoint 已经写了 helper replay；
2. restore path 没把它读回来；
3. replay overflow 直接 throw；
4. detached turn 不会停。

这意味着 PP3 的第一批交付最好是：

1. `restoreFromStorage()` 真恢复 replay/helper state；
2. replay out-of-range 改成 lagged/degraded contract；
3. detached TTL + turn cancel / terminal policy；
4. actor/session status snapshot 让前端不用全靠 timeline 反推。

而 **统一 top-level frame replay buffer**、更完整的 outbound dedup/request-id 语义，我建议放在 PP3 后半或 PP5 follow-up。原因不是它不重要，而是它比当前最硬的 restore gap 更像 **第二层协议演进**。

### 3.4 Policy 与 Reliability 不适合完全并批

Opus 把 C3/C4 放进一个 PP4，这在文义上可以理解，但在工程上我建议分清轻重。

`/runtime` 的 `network_policy / web_search / workspace_scope` 当前已经是典型的 **honesty gap**：字段在 D1、在 façade、在 public docs 可见面，但运行时不消费（`workers/orchestrator-core/src/runtime-config-plane.ts:66-145`，`workers/orchestrator-core/src/entrypoint.ts:345-372`）。这件事应该尽早给出二选一终态：

- 要么真的 enforce；
- 要么明确降格为 hint，并让 docs / API response 全部改口。

相比之下，LLM retry / fallback metadata / streaming recovery 虽然也重要，但它们更像 **resilience strengthening**，不一定需要绑定在 policy honesty 上一起收。我的建议是：**policy honesty 应该在阶段前半先完成，不要等 retry/fallback 全套都好了再一起 closure。**

### 3.5 “pro-to-product 默认不新增 D1 schema”可以作为默认原则，但不应写成刚性教条

我理解 Opus 想继承 hero-to-pro 的 DDL freeze 纪律；这是一种健康的保守姿态。

但我不建议直接把它写成“6 个闭环全部在 HP1 已落表上完成”的硬前提。原因有两个：

1. 当前某些 reconnect / dedup / detached recovery 语义，理论上可以仅靠现有 DO storage + alarm 做出来，但如果后续发现需要一个 **极小的 durable idempotency / replay bookkeeping 字段**，那时再被 charter 文本反绑，会让工程选择变形。
2. `hero-to-pro` 的 DDL freeze 成立，是因为那一阶段主命题是 wrapper control-plane；`pro-to-product` 则更靠近 frontend trust / recovery semantics，允许一个**严格受控、明确列举、非扩散式** 的 D1 例外，不会伤害阶段边界，反而比“绝不允许”更诚实。

所以我的建议是：

> **默认不新增 D1 migration；但 PP0 charter 应保留一个“经 owner 明确批准的极小例外窗口”，并把可例外类别写死。**

这样既继承了 freeze discipline，也不会把后续实现逼到不自然的工作区。

---

## 4. 我对 HPX7 的看法

我认同 Opus 提出“不要把所有尾项都塞进 pro-to-product，hero-to-pro 最好先做一轮诚实收尾”的基本思路。但在它列出的 8 项里，我会再区分优先级。

| 项目 | 我的判断 | 理由 |
|---|---|---|
| HPX7-A replay graceful degrade + restore replay buffer | **强烈支持** | 这是当前 reconnect 的最硬断点，而且从代码看确实是 restore/caller 层缺失，不是大设计问题。 |
| HPX7-C tool cancel `abort()` 填充 | **支持** | `abort()` 当前确为空实现（`workers/agent-core/src/host/runtime-mainline.ts:785-790`），这属于很典型的“schema 已有、执行未接”的收尾项。 |
| HPX7-D reasoning `content_type` 区分 | **支持** | `session-stream-adapter` 当前确实把 delta 一律打成 `text`（`workers/agent-core/src/llm/session-stream-adapter.ts:61-69`）。 |
| HPX7-E / F / G 文档诚实修订与 drift guard | **支持** | 这些项的价值不在“补功能”，而在防止下一阶段继续建立在误导合同上。 |
| HPX7-B token 双重累加修复 | **倾向支持，但应在落项前再用当前代码复核一次** | 它很可能重要，但我在这次 review 中没有把这一条重新追到 reducer 级代码。 |
| HPX7-H 空 catch 修复 | **可以做，但不建议把它与 A/C/D/E/F/G 并列成 HPX7 的主价值** | 它更像 hygiene / race hardening，不是阶段命题核心。 |

换句话说，我支持 **“HPX7 做一轮小而硬的诚实收尾”**，但我更看重：

1. replay/restore 的最小修补；
2. cancel / reasoning typing 这类明显的 fake-live seam 修补；
3. docs/closure/drift guard 的诚实重表态。

这三类做完，hero-to-pro 才比较像一个可以合法进入 `close-with-known-issues` 的阶段，而不是继续靠 closure 文本吸收问题。

---

## 5. 我建议的 phase 重排

如果让我基于当前代码重新组织，我会建议把 Opus 的方案改成下面这个版本。

### 5.1 推荐切分

1. **PP0 — Charter / Deferral Matrix / Acceptance Freeze**  
   只做下一阶段基石、deferral 归一、acceptance criteria，不写代码。

2. **PP1 — HITL Interrupt Closure**  
   `approval_policy=ask`、elicitation、confirmation pending、resume turn。目标是把 “return error” 改成 “pause-resume loop”。

3. **PP2 — Context Budget Closure**  
   token accounting、context-window preflight、compact real execution、overflow graceful degrade。目标是让 context 从“有信号”变成“真调度 prompt”。

4. **PP3 — Reconnect Closure**  
   replay restore、lagged degrade、detached TTL、running-turn policy、status snapshot。目标是让 `last_seen_seq` 不再只是 best-effort。

5. **PP4 — Hook Delivery Closure**  
   live register source、PreToolUse 真走 dispatcher、最小前端可见性、hook outcome contract。先闭最小 loop，再考虑更全 catalog。

6. **PP5 — Reliability + Policy Honesty**  
   fallback metadata、retry/stream recovery、`/runtime` 字段 enforce-or-downgrade、reasoning stream typing、必要的 observability push。

7. **PP6 — Final Closure / Docs / Handoff Stub**  
   final docs pack、review、closure、后续 platform-foundations stub。

### 5.2 为什么我更喜欢这个顺序

因为它更贴近当前真实耦合：

- **PP1** 解决“人类无法真正插手 loop”的问题；
- **PP2** 解决“长对话根本撑不住”的问题；
- **PP3** 解决“前端断线后系统不可信”的问题；
- **PP4** 才去解决“hooks 从内部框架变成产品级能力”的问题；
- **PP5** 再补 reliability/policy honesty 的剩余硬化。

这比把 C1+C2 一起塞进一个大 PP1、再把 C3+C4 捆成一个大 PP4，更符合现在的代码地形。

---

## 6. 我建议写进下一版 charter 的硬闸

如果这份初步规划要继续演化为正式 `plan-pro-to-product.md`，我建议一开始就把 closure 标准从“功能做完”改成“前端可信”。

我建议至少冻结下面 6 条硬闸：

1. **HITL truth**：`approval_policy=ask` 不得再以 error-out 形式结束 turn。
2. **Context truth**：compact 之后，下一个 LLM request 的 prompt 必须能被证明确实变了；不能只 emit `compact.notify(status="completed")`。
3. **Reconnect truth**：`last_seen_seq` 重连时，要么 replay 成功，要么返回明确的 lagged/degraded contract；不能直接 throw 给前端。
4. **Session state truth**：前端重连后必须能知道 session 当前是 running / detached / waiting confirmation / ended，而不是只能自己从 timeline 猜。
5. **Policy truth**：`network_policy / web_search / workspace_scope` 必须要么 enforce，要么在 API/docs 中显式写成 hint，不允许继续暧昧。
6. **Hook truth**：至少一个真实 hook path 必须完成 **register → emit → outcome → client/audit visible** 闭环，不能只证明 dispatcher 类还在。

只有把这类标准写死，`pro-to-product` 才不会再重复 hero-to-pro 后期那种“surface 已满，但 live caller 还没落”的 closure 风险。

---

## 7. 最终判断

**我的最终判断是：Opus 这份草案值得作为下一阶段的入口草稿继续推进；它对命题切换、问题分层、以及“先让前端能站起来”的战略方向判断是对的。**

但它还需要三处关键修正，才能成为更稳的 charter 前置稿：

1. **把 phase 切分改得更贴近当前真实耦合面**，尤其要把 HITL、Context、Reconnect 这三条硬 blocker 拆清。
2. **把 Hook 闭环从“全量目录接通”改成“先闭最小 live loop”**，避免再次高估表面进度。
3. **把 D1 freeze 从硬禁令改成默认原则 + 严格受控例外**，给工程现实保留最小出口。

如果按这个方向修订，我认为 `pro-to-product` 会比继续沿用 `hero-to-platform` 这条旧命题更 coherent，也更符合当前 nano-agent 的真实代码状态与前端建设目标。
