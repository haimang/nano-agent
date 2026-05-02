# Pro-to-Product 阶段初步规划草案

> **文档性质**: `eval / initial-planning`(不是 charter,不是 design doc,不是 action-plan)
> **作者**: Claude Opus 4.7(1M context)
> **日期**: 2026-05-02
> **直接输入**:
> - `docs/charter/plan-hero-to-pro.md`(hero-to-pro 阶段基石,含 16 节附加阶段 HPX1-HPX6 回填)
> - `docs/eval/hero-to-pro/core-gap/` 9 份报告(hooks ×3、llm-wrapper ×3、connection ×3)
> - 6-worker 真实代码(HPX5/HPX6 后 snapshot)
>
> **本文档不冻结任何决策**。它的目的是把 9 份 core-gap 报告交叉得到的事实、可行的阶段边界、可并行的分工方案、Cloudflare 约束下的可行性,先以"工作笔记"的形式落到一处,供 owner 用作下一步决策的草稿。
>
> **本文档不替代将要写的**:
> - `docs/charter/plan-pro-to-product.md`(基石 charter — 待 owner 决策后由更晚的版次撰写)
> - `docs/action-plan/hero-to-pro/HPX7-*.md`(HPX7 收尾的 action-plan,如果 owner 接受 §3 的提案)
> - `docs/eval/pro-to-product/closing-thoughts-*.md`(类比 hero-to-pro `closing-thoughts-part-{1,2}`)
>
> **修订历史**:
> - `2026-05-02 v0.draft — 首版,基于 9 份 core-gap 报告 + hero-to-pro charter + HPX1-HPX6 回填合成`

---

## 0. 这份文档要回答的 3 个问题

owner 在 hero-to-pro 准备收尾时提出的具体诉求是:

1. **HPX7 应该装什么**:hero-to-pro 阶段是否还应当再追加一段(HPX7),用于收尾"同事们推荐在 hero-to-pro 内完成"的工作 — 哪些应该装进去、哪些不应该。
2. **pro-to-product 的命题**:剩下的工作如何用一个"逻辑组合 coherent"的下一阶段(预定名 `pro-to-product`)承载,使整体开发与验证不被打散。
3. **分工与可行性**:在 6-worker + Cloudflare 单 provider 的真实约束下,哪些工作可以并行、哪些必须串行、关键风险在哪里。

本文档对每个问题给出**初步分析与候选方案**,不做最终决定。

---

## 1. 9 份 core-gap 报告的交叉共识(TL;DR)

9 份报告独立调查 hooks / llm-wrapper / connection 三大维度,**结论高度交叉**。一句话:

> nano-agent 的 **API 表面 + schema + 控制平面骨架** 已经达到生产前形态(HPX5/HPX6 之后),但 **agent-core 内核层** 与 **public WS facade 转发链路** 上仍存在**结构性 wire-without-delivery 断点**;这些断点都不是"端点不够多",而是"已有端点的语义未真接通到 loop"。

### 1.1 三维度的最关键共识(各 3-4 条)

**Hooks(opus + kimi + deepseek 三家):**
- **18-event catalog 中 14 个永不 emit**(只有 `Setup / SessionStart / UserPromptSubmit / SessionEnd / Stop` 5 个真触发);三家独立验证,无异议。
- **Registry 永远是空的** — `new HookRegistry()` 之后,production 代码 0 个 `registry.register(handler)` 调用;dispatcher 拿到 `handlers=[]` → `finalAction:"continue"` → no-op。
- **客户端零 hooks 可见性** — 22-doc pack 内 0 个 `/hooks/*` 端点,`hook.broadcast` 帧 schema-only 无 producer,`HookStarted/HookCompleted`-style 推送完全不存在。
- **PreToolUse 不走 HookDispatcher** — `runtime-mainline.ts:229-256` 的 `authorizeToolPlan()` 直接调 `options.authorizeToolUse` RPC,与 `HookDispatcher.emit("PreToolUse")` **架构上解耦**;`hooks/permission.ts` 的 `verdictOf()` 至今 0 caller。

**LLM Wrapper(GPT + deepseek + kimi 三家):**
- **`approval_policy=ask` 是死胡同** — 三家共同确认:`runtime-mainline.ts:544-553` 在 `decision==="ask"` 时**直接把 `tool-permission-required` error 返回给 LLM**,从不触发 confirmation 流程。`emitPermissionRequestAndAwait`(`session-do-runtime.ts:376-414`)存在但 0 caller。
- **Auto-compact 是空操作** — `runtime-mainline.ts:813-816` 的 `requestCompact()` 返回 `{tokensFreed:0}`;probe 已接通(`runtime-assembly.ts:285-321`),但 delegate 不释放任何 token。**这是 9 份报告里指证最尖锐的一条**:`compact.notify` 帧 emit `status:"completed"` 但实际窗口未清。
- **Context window 预检完全缺失** — kimi-gemini 报告独家发现:`request-builder.ts` 验证 stream/tools/vision/reasoning,但**不估算消息 token 数**也不与 `contextWindow` 比较 → 长对话直接撞 Workers AI 错误。
- **`/runtime` 的 `network_policy/web_search/workspace_scope` 只是 stored hints,不 enforce** — `D1RuntimeConfigPlane.patch()` 持久化字段,但 `authorizeToolUse()`(`entrypoint.ts:345-372`)只读 `permission_rules + approval_policy`,其他字段 0 处消费。
- **fallback/retry/streaming-recovery 不是 first-class** — `LLMExecutor.executeStream()` 无重试循环;`WorkersAiGateway` 内部 fallback 但**不向上层告知** `fallback_used / fallback_model_id / fallback_reason`;orchestrator 下游的 `model.fallback` emit 因此条件难以成立。

**Connection(GPT + deepseek + kimi 三家):**
- **public WS `session.resume` 不是真 replay protocol** — orchestrator-core 把它当 activity touch,只有 `session.followup_input` 真转发(`user-do/ws-runtime.ts:199-235`);`POST /resume` 也只回 `{relay_cursor, replay_lost}`,**不返回任何实际帧**。前端要拼 `/timeline + /confirmations + /todos + /runtime + /items` 多源 reconcile。
- **DO hibernation 后 replay buffer 不恢复** — kimi-gemini 报告独家发现:`persistCheckpoint` 调了 `helper.checkpoint()` 写盘,但 `restoreFromStorage`(`session-do-persistence.ts:193-222`)**只恢复 `kernelFragment + actorPhase`,不恢复 replay buffer** → DO wake 后 `last_seen_seq` 重连必然撞 `NACP_REPLAY_OUT_OF_RANGE`(且无 graceful degrade,`replay.ts:62-68` 直接 throw)。
- **detached session 无 TTL,断连后 turn 无限跑** — Codex 有 `DETACHED_SESSION_TTL=10s` + 后台 expire,nano-agent 的 `markDetached()` 永远保持 detached 状态,且 `webSocketClose` 中 phase 转 `unattached` 但 **`turn_running` 中的 turn 不被 cancel**(`session-do/ws-runtime.ts:243-260`),持续消耗 DO CPU + LLM 配额。
- **重连无会话状态快照** — `ActorState`(phase / activeTurnId / pendingInputs)是 DO 内部状态,**不作为 frame 推给客户端**;前端重连后只能从 replay 帧反推"agent 是否在跑 turn"。

### 1.2 一个跨维度的元结论

3 大维度的 P0 断点全部满足同一个模式:

> **schema 在、durable storage 在、control plane façade 在、emitter 接口在,但 _live caller_ 不在**。

这与 charter §5 早已显式警告的 `wire-without-delivery 不算闭合` 纪律是**同一性质的违约**;HPX5/HPX6 显著推进了 schema 与 emitter 接通,但**核心 loop control points** 的 caller 仍未落地。

charter §10.3 NOT-成功退出识别第 1 条已说:

> 1. F12 hook dispatcher 未真接通(`hooks/permission.ts` 仍走同步 verdict)。

实际现状是这条仍然成立 — F12 在 HP5 closure 内被宣称"closed",但 9 份报告独立确认:**HookDispatcher 实例已注入** ≠ **hook system 真接通**。这条边界必须在 HPX7 或 pro-to-product 的入口被诚实重写。

---

## 2. 阶段命名与命题分割

### 2.1 当前 charter 的下一阶段定义(原)

`docs/charter/plan-hero-to-pro.md` §11.1 把下一阶段命名为 **`hero-to-platform`**,内容是 16 项 multi-provider / sub-agent / admin / billing / SQLite-DO / SDK extraction / WeChat 完整适配等"平台化"主题。其特征:

- **横向扩张**(支持更多 provider、更多 agent 形态、更多管理面)
- **正交于 wrapper 控制面**(D5 决议:不与 4 套状态机交叉)

### 2.2 owner 提出的命名变更:`hero-to-platform → pro-to-product`

owner 把下一阶段名称从 `hero-to-platform` 改成 `pro-to-product`,这是一个**命题级别的方向转换**,不只是名字变化:

| 维度 | hero-to-platform(旧) | pro-to-product(新) |
|------|---------------------|---------------------|
| 中心命题 | 把 wrapper 平台化(横向扩张) | 把 wrapper 产品化(纵向闭环) |
| 工作重点 | multi-provider / admin / billing | 让 4 套状态机 + hooks + connection 真正端到端可用,前端能站在它上面搭起来 |
| 价值衡量 | 平台覆盖广度(N provider × M agent) | 单一前端 demo 能跑长对话、能看到 agent 在做什么、能恢复、能信任 |
| 与外部对标 | "我们和 OpenAI/Anthropic 平台同档位" | "我们和 claude-code/codex/gemini-cli 在 _用户感知_ 上同档位" |

owner 在前一轮已经显式阐明这个转向:

> "我们接下来不能再闭门造车了 [...] 我们现在的目标,是收拢 gaps,让前端可以真正被搭建起来,并进行观测。通过前端然后再倒推后续的阶段,我们应该怎么工作。"

这意味着:

- **`pro-to-product` 不是 `hero-to-platform` 的改名,而是 _在 `hero-to-platform` 之前插入_ 的一个新阶段**
- `hero-to-platform`(multi-provider / sub-agent / admin / billing)被**进一步推后**,作为 pro-to-product 之后的可选第三阶段
- **下沉判定**(基于前一轮 owner 决断 + 9 份报告共识):Skills、Browser Rendering、Memory / CLAUDE.md、Cost/Usage Tracker、Plugin/MCP 生态、Virtual Git、Multi-provider、Sub-agent、SDK extraction、WeChat miniprogram 完整适配 — 全部移到 pro-to-product 之后的"未来某大阶段 foundations 工作",**不是 pro-to-product 的对象**

### 2.3 因此命题树是

```
real-to-hero ✓ (RHX1-RHX2 已收尾)
  └── hero-to-pro [当前阶段, HPX7 收尾中]
        └── pro-to-product [本文档讨论, 草稿状态]
              └── platform / foundations [更后, 现已不在视野中,待 pro-to-product 输出再倒推]
```

### 2.4 为什么 pro-to-product 与 hero-to-pro **不能合并**

读者可能问:既然 P0 断点(compact 空操作 / ask 死胡同 / replay buffer 不恢复 / 14 个 hook 不 emit)都是 hero-to-pro charter 早已识别的 G3/G4/G7/G11 + F12,为什么不直接在 hero-to-pro 加 HPX7-HPX8-HPX9 一直补到全部闭环?

答案在 charter §0.1:

> "real-to-hero 已经收尾,继续散乱地补端点会让 'hero' 名称与产品事实持续漂移"

同样的逻辑现在适用于 hero-to-pro。**"成熟 LLM wrapper 控制平面"**的 charter 一句话目标已经通过 HP1-HP10 + HPX1-HPX6 抵达;再往下补的 P0 断点(compact / ask / replay / hooks-delivered)在性质上**不是"控制平面"**,而是"**控制平面真接通到 loop 与前端**"— 这是另一个命题,值得有自己的入口、自己的诚实命名、自己的 closure 标准。

继续以"HPX7-HPX99"的形式无限延伸 hero-to-pro,就会重蹈 ZX5 / RH6 / F12 / F13 多阶段慢性 carryover 的旧路;这正是 charter §5 与 §10.3 反复警告的反模式。

---

## 3. HPX7 候选 — 哪些工作应留在 hero-to-pro 收尾

### 3.1 HPX7 的入选标准(草案)

为了避免 HPX7 变成"小 hero-to-pro Phase 2",建议它只装满足全部 4 个条件的工作:

1. **修补深度浅** — 单文件或邻近文件改动,不引入新协议帧、不引入新 D1 migration、不引入新阶段架构。
2. **与现有 4 套状态机紧耦合** — 修复后能被 charter §14.1 的"4 套产品状态机闭环"主张更诚实地承载。
3. **不引入新跨 worker 接线** — 不要求新的 service-binding 拓扑。
4. **完成后能让 hero-to-pro 终态判定从 `cannot close` 升级到 `close-with-known-issues`** — 即让 §10.3 NOT-成功识别条目至少减 1 项。

不满足全部 4 条的工作,自动归到 pro-to-product。

### 3.2 HPX7 候选清单(初稿)

按上述 4 条标准筛后,以下工作适合作为 HPX7 收尾:

| ID | 工作项 | 入选理由 | 来源报告 |
|---|---|---|---|
| **HPX7-A** | **`replay.ts:62-68` 把 throw 改成 `Lagged{skipped}` graceful degrade + `restoreFromStorage` 恢复 replay buffer** | 单文件改动,不需新协议;与 charter F12/F13 同性质的 wire-with-delivery 修补;消除 §10.3 NOT-成功识别中 connection 子项 | gemini-cli-connection-by-kimi §3.1 B1 + GAP-9 |
| **HPX7-B** | **`reducer.ts:llm_response` token 双重累加修复**(区分 cumulativeTokens vs currentPromptTokens) | 单文件 0.5 天工作量;直接影响 compact signal 准确性;不修这条会让 P0-1(compact 实装)落地后立刻被错触发 | gemini-cli-llm-wrapper-by-kimi §11.2 缺陷 #6 |
| **HPX7-C** | **`runtime-mainline.ts:520` `abort()` 空实现填充 + `tool.call.cancelled` 真 emit** | 接通 client-cookbook 已宣称的 cancel 路径;capability transport 已有 cancel 接口,只差 wiring | gemini-cli-llm-wrapper-by-kimi §9.4 |
| **HPX7-D** | **`session-stream-adapter.ts:58-62` `content_type:"text"` 硬编码 → 根据 `provider 返回的 reasoning chunk` 区分 thinking vs text** | schema 已有 `"thinking"` 枚举值(`stream-event.ts:121-126`),但 adapter 永远不发;这是 schema-live / producer-not-live 的最小成本一条 | codex-llm-wrapper-by-deepseek §3.1 GAP + 优先级 §6 P0 |
| **HPX7-E** | **诚实修订 `clients/api-docs/confirmations.md` + `session-ws-v1.md` 中"已有 live caller"的描述** | 文档与代码漂移修正;不需要任何代码改动;让 client-cookbook 不再误导前端 reducer 设计 | claude-code-llm-wrapper-by-GPT §4.3 H3 |
| **HPX7-F** | **HPX5 P5-05 `check-docs-consistency.mjs` 加 3 条新 regex**:确保 `confirmations.md` 不再写"emitter live"用于 ask-path,`session-ws-v1.md` 不再写 `model.fallback` "live" 直到 producer 接通,`runtime.md` 中 `network_policy/web_search/workspace_scope` 显式标 `stored-not-enforced` | drift guard 增量;每条 regex ≤ 5 行;CI 集成 | 跨 3 份 llm-wrapper 报告 |
| **HPX7-G** | **`docs/issue/hero-to-pro/HP5-closure.md` 重新表态**:把"F12 hook dispatcher closed"修订为"F12 dispatcher 实例已注入,但 14/18 事件无 emit producer + 0 handler register;真接通 deferred to pro-to-product"。**不允许 silent inherit**(charter §5 chronic explicit-only 纪律) | 文档诚实修订,不动代码;让 hero-to-pro final-closure 能合法走 `close-with-known-issues` 路径 | 跨 3 份 hooks 报告 |
| **HPX7-H** | **`session-do-runtime.ts:679` 空 catch block 修复**:`attachHelperToSocket` 的 race condition 不能用 `catch{}` 默默吞掉;要么 emit `system.error`,要么走真正的 detach-then-attach | 单点 catch 修复;消除 connection 报告 G7 race 隐患 | codex-connection-by-deepseek GAP-7 |

**HPX7 总规模估计**:8 项 × 0.5-2 天/项 = ~7-12 工作日(单 reviewer-engineer)。比 HP5 / HP6 / HPX5 / HPX6 任一个都小,**完全合理作为 hero-to-pro 收尾**。

### 3.3 不入选 HPX7 的清单(明确判定)

以下工作虽然报告中作为 P0 推荐,但 **不入 HPX7**,理由是:它们违反 §3.1 4 条标准之一,且单独完成它们会让 hero-to-pro 进入"无限再追加"模式。这些必须留给 pro-to-product:

| 工作项 | 不入 HPX7 的理由 |
|---|---|
| **Compact 真实装** | 跨 agent-core / context-core 接线,改 reducer 行为(消息真截断),涉及 `<state_snapshot>` summary;深度大,与 hero-to-pro charter G3/G4 同级别;放 pro-to-product PP1 |
| **Permission "ask" 真 pause-resume** | 跨 runtime-mainline / scheduler / kernel runner / DO `awaitAsyncAnswer` / orchestrator confirmation row;改 kernel interrupt 路径;放 pro-to-product PP1 |
| **PreToolUse hook 真 dispatcher 接通** | 改变 `authorizeToolPlan` 调用路径,与 confirmation 接通耦合;放 pro-to-product PP2 |
| **HookStarted / HookCompleted 客户端推送** | 引入新 NACP frame schema;放 pro-to-product PP2 |
| **Context window 预检 + 超窗 graceful degrade** | 引入 token estimator;改 LLM 调用路径;放 pro-to-product PP1 |
| **`/runtime` 的 network_policy/web_search/workspace_scope 真 enforce 或显式降格** | 跨 orchestrator-core / agent-core / bash-core;放 pro-to-product PP4 |
| **detached session TTL + 断连 turn cancel** | 引入新 alarm 调度;放 pro-to-product PP3 |
| **Top-level frames 统一 replay buffer** | 改协议层语义;放 pro-to-product PP3 |
| **Reasoning summary / TokenCount 流事件 / RateLimits / ContextWindow% 推送** | 引入新 NACP frame kinds;放 pro-to-product PP4 |
| **流 retry / idle timeout / streaming-fallback tombstone** | LLM wrapper 重要重构;放 pro-to-product PP1 |

---

## 4. pro-to-product 的核心命题(草稿)

### 4.1 一句话(候选)

> **让 nano-agent 第一次成为"前端可信赖、可观测、可恢复的产品级 agent loop backend"** — 收口 9 份 core-gap 报告识别的 wire-without-delivery 慢性断点,把 hero-to-pro 留下的 schema/storage/façade-already-live 真正接通到 _agent loop_ 与 _client 可见层_。

### 4.2 6 个闭环(直接来自 9 份报告交叉)

claude-code-llm-wrapper-by-GPT §5.2 提出 4 个闭环;扩到 6 个吸纳 hooks 与 connection 报告:

| # | 闭环名 | 含义 | 关键证据(来自报告) |
|---|---|---|---|
| **C1** | **HITL 闭环** | `approval_policy=ask` / elicitation 必须真 pause-resume,不是 error-out | 3 家 llm-wrapper 报告共同 P0;`emitPermissionRequestAndAwait` 0 caller |
| **C2** | **Context 闭环** | auto-compact 必须真修改 live prompt + 前置 token 预检 + 超窗 graceful degrade | 3 家 llm-wrapper 报告共同 P0;`tokensFreed:0` + `request-builder.ts` 不估 token |
| **C3** | **Reliability 闭环** | fallback / retry / stream-recovery / model reroute 必须 first-class + 对前端可见 | GPT/deepseek 共同 P0;`fallback_used` 不流出 + 无 retry 循环 |
| **C4** | **Policy 闭环** | `/runtime` 字段二选一终态 — 真 enforce 或诚实降格为 hint | GPT 报告 P0 — "honest contract" 是命名 |
| **C5** | **Hook-to-Frontend 闭环** | hooks 系统从"内部 audit"升级到"前端可见 + 可干预" — `HookStarted/HookCompleted` 推送 + PreToolUse 走 dispatcher | hooks 3 家报告共同 P0 |
| **C6** | **Reconnect 闭环** | replay buffer 持久化恢复 + status snapshot push + outbound dedup + detached TTL | connection 3 家报告共同 P0 |

### 4.3 为什么是 6 个闭环而不是更多

我考虑过加更多(reasoning 流、TokenCount push、loop detection、workspace checkpoint、tool cancel push、自动续说),但这些**要么是 C1-C6 的子项,要么是产品 polish**:

- reasoning 流 / TokenCount push / RateLimits push / ContextWindow% push → 全部归 C3 或 C4(observability/honesty 子项)
- loop detection → 归 C2(context 闭环的防护层 — 防止 LLM 陷入无限循环耗 context)
- workspace checkpoint(`buildCheckpoint` identity 函数)→ 归 C6(reconnect 闭环 — restore 后 workspace 不丢)
- tool cancel push 已被 HPX7-C 收编
- 自动续说 / plan mode → 明确 out-of-scope(产品决策,非闭环)

### 4.4 一句话非目标(对照 hero-to-pro §3.2)

**不**做 multi-provider、**不**做 sub-agent、**不**做 admin / billing、**不**做 Skills 配置面、**不**做 browser rendering、**不**做 memory/CLAUDE.md、**不**做 plugin/MCP、**不**做完整 SDK extraction、**不**做 WeChat miniprogram 完整适配 — 这些全部明确推后到 pro-to-product 之后的某个 foundations 阶段,本阶段不为它们做任何让步。

---

## 5. 阶段切分初步建议(PP0-PP5)

下面给一个可行的切分草稿。保留 owner 调整的全部空间;数字不冻结。

### 5.1 候选 PP0-PP5

| Phase | 名称 | 主要承担 | 进入条件 |
|---|---|---|---|
| **PP0** | 前置准备 + charter | 写 `plan-pro-to-product.md` charter + 3 份 closing-thoughts(类比 hero-to-pro)+ 9 份 core-gap 报告归一为 deferral 矩阵 + 6 个闭环的具体 acceptance criteria;绝对不写代码 | hero-to-pro `full close` 或 `close-with-known-issues`(HPX7 完成 + HP10 final closure) |
| **PP1** | C1 + C2 闭环(loop blocker 同批做) | ① `approval_policy=ask` 真 pause-resume(scheduler `confirmation_pending` interrupt 真生效);② elicitation 同模式;③ compact 真实装(context-core 提供真实 summary,reducer 真截消息);④ context window 预检 + 超窗 graceful degrade;⑤ token 双重累加 bug 修复(若 HPX7-B 没收编则在此修);⑥ 配套 e2e | PP0 closure |
| **PP2** | C5 闭环 — Hook 真接通到前端 | ① 14/18 关键事件 emit 接通(尤其 PreToolUse / PostToolUse / PreCompact / PostCompact);② Permission 决策从独立 RPC 改为先走 HookDispatcher 再 fallback;③ 新 NACP frame `session.hook.started / session.hook.completed` schema + emit producer;④ `clients/api-docs/` 增 `hooks.md`;⑤ 至少 1 个 platform-policy handler register 路径,证明 pipeline 通到 user-visible behavior | PP1 closure(C1 已通,因为 hook PermissionRequest 与 ask-pause-resume 紧耦合) |
| **PP3** | C6 闭环 — Reconnect 韧性 | ① `restoreFromStorage` 恢复 replay buffer;② `replay.ts` graceful degrade 替代 throw;③ public `session.resume` 升级为真 replay control(server 主动 push 当前 status snapshot);④ top-level frames 进入统一 replay buffer 或 显式 reconcile 路径 honest 文档化;⑤ detached TTL + 断连 turn cancel + alarm 调度;⑥ `session.followup_input` 加 request_id + ack + dedup;⑦ ActorState snapshot push;⑧ 客户端 cookbook reconnect 章节 honest 重写 | PP1 closure(可与 PP2 部分并行,见 §6) |
| **PP4** | C3 + C4 闭环 — Reliability + Policy honesty | ① fallback metadata 流出(per-turn `fallback_used / requested_model_id / fallback_model_id / fallback_reason`)+ `model.fallback` 真 emit;② LLM wrapper 流 retry / idle timeout / streaming-fallback tombstone;③ `/runtime` 三字段(network/web_search/workspace_scope)二选一(真 enforce 或文档降格);④ Reasoning content type 流推送(若 HPX7-D 不收编则在此);⑤ TokenCount / RateLimits / ContextWindow% 流事件 schema + producer;⑥ loop detection(防 LLM 无限循环) | PP1 closure |
| **PP5** | Final closure + handoff | ① `pro-to-product-final-closure.md`;② 9 份 gap 报告中所有 P0/P1/P2 项目的逐项 explicit-resolve / explicit-handoff 判定;③ `clients/api-docs/` 22-doc → 25-doc(新增 `hooks.md` / `reconnect.md` / `reasoning.md` 或扩充);④ `plan-platform-foundations.md` 入口 stub(承载 multi-provider / Skills / Browser / Memory / Cost / Plugin / sub-agent 等被 pro-to-product 显式 defer 的内容)| PP1-PP4 全部 closure |

### 5.2 为什么这样切

**(a) PP1 把 C1+C2 同批做,而不是分开**:报告中 C1(ask pause-resume)与 C2 中的"compact 真实装"看似独立,但 confirmation `kind:context_compact` 在 HP7 design 中已定义,且 C2 的 graceful degrade 路径需要 C1 通(超窗时 emit confirmation 让用户决定 compact / 切模型 / 取消);两者放同一 phase 避免来回改 scheduler interrupt 路径。

**(b) PP2(Hooks)放 PP1 之后**:Hook 的 PermissionRequest 真接通**复用** PP1 已建立的 `confirmation_pending` interrupt;若 PP2 在 PP1 之前,hook 改造完没法验证,因为 ask-loop 还断。

**(c) PP3(Reconnect)与 PP2 _可以部分并行_**:Reconnect 改的是 protocol layer + DO storage layer + facade 转发 layer,与 PP2 改的 hook dispatcher / runtime-mainline tool exec path **接触面极小**;只要避免同一文件改动 race 就可并行。这是 §6 分工方案的关键支点。

**(d) PP4 放 PP1 之后,与 PP3 并行 OK**:reliability + policy 改的是 LLM wrapper + `/runtime` enforcement,与 PP3 的 connection layer 正交。

**(e) PP5 最后**:Final closure 必须等 6 个闭环全 live。

### 5.3 候选 DAG

```
PP0 (charter)
└── PP1 (C1+C2 — HITL + Context loop)
      ├── PP2 (C5 — Hooks-to-Frontend)
      ├── PP3 (C6 — Reconnect)              ◄── PP2/PP3/PP4 可并行
      └── PP4 (C3+C4 — Reliability+Policy)
            └── PP5 (Final closure)
```

**关键判断**:有 3 段并行窗口(PP2 + PP3 + PP4),如果 owner 决定不并行(比如 single reviewer-engineer),那整个 pro-to-product 是严格串行的 6 phase;如果可以三线并行,工期能压到 PP1 + max(PP2, PP3, PP4) + PP5。

---

## 6. 分工方案 — 哪些可并行,哪些必须串行

### 6.1 按文件改动域划分(用以判断并行可行性)

| 域 | 物理位置 | PP1 改动量 | PP2 改动量 | PP3 改动量 | PP4 改动量 |
|---|---|---|---|---|---|
| `agent-core kernel/` (runner, scheduler, reducer) | `workers/agent-core/src/kernel/` | **大** — interrupt 路径、compact action | 中 — `handleHookEmit` | 小 — checkpoint fragment | 小 — error path |
| `agent-core host/runtime-mainline.ts` | 同上 | **大** — `authorizeToolPlan` 改写、compact delegate 真实装、token 预检 | 大 — tool exec hook 接通 | 小 | 中 — fallback metadata 抬出 |
| `agent-core host/do/session-do/runtime-assembly.ts` | 同上 | 中 — confirmation 接线 | 大 — emit hook full implementation | 中 — checkpoint restore | 中 |
| `agent-core hooks/` | 同上 | 0 | **大** — register 路径、producer 接通、新 frame emit | 0 | 0 |
| `orchestrator-core confirmation-control-plane.ts` | `workers/orchestrator-core/src/` | 中 — kind:context_compact / restore | 0 | 0 | 0 |
| `orchestrator-core user-do/ws-runtime.ts + surface-runtime.ts` | 同上 | 0 | 0 | **大** — resume protocol 升级、followup_input ack | 0 |
| `orchestrator-core entrypoint.ts authorizeToolUse` | 同上 | 中 | 大 — runtime/policy 字段消费 | 0 | **大** — network/web_search/workspace_scope enforce |
| `packages/nacp-session/replay.ts` + websocket.ts | `packages/` | 0 | 0 | **大** — graceful degrade、handleResume 状态 push | 0 |
| `packages/nacp-core/messages/` 新 frame schema | `packages/` | 0 | 中 — `session.hook.*` | 中 — `session.actor.snapshot` / status | 中 — token_count / model.reroute |
| `clients/api-docs/` | `clients/` | 中 — 改 `confirmations.md`/`context.md` | 大 — 新 `hooks.md` | 大 — 改 `session-ws-v1.md` + `client-cookbook.md` reconnect | 大 — 新 `reasoning.md` 或扩 `models.md` |
| `clients/web/src/` | 同上 | 中 — UI ask 弹窗 | 中 — UI hook 状态条 | 中 — auto-reconnect | 小 |
| `tests/cross-e2e/` | 顶层 `test/` | **大** — 5+ 用例 | 大 — 3+ | **大** — 5+ | 中 — 3+ |

### 6.2 并行窗口判定

**(a) PP2 ⊥ PP3 ⊥ PP4 各自只在 1-2 个域有大改,且大改域不重合**:
- PP2 大改域:`agent-core hooks/` + `agent-core runtime-mainline tool exec` + `agent-core runtime-assembly emitHook`
- PP3 大改域:`orchestrator-core user-do/ws-runtime` + `packages/nacp-session/replay+websocket`
- PP4 大改域:`orchestrator-core entrypoint authorizeToolUse` + `agent-core host runtime-mainline LLM wrapper path`

**冲突点**:`agent-core host/runtime-mainline.ts` 在 PP2 与 PP4 都被中-大改动 → 这是唯一的真冲突域。**建议**:
- PP4 的 `runtime-mainline.ts` 改动集中在 LLM wrapper subsection(line 445-870 范围),PP2 的改动集中在 tool exec subsection(line 538-870 范围),做好 git 上的 PR 顺序协调。

**(b) PP1 必须在 PP2/PP3/PP4 之前**:理由见 §5.2(a)+(b);scheduler interrupt 路径改完才能让 PP2 的 Hook PermissionRequest 真接通,才能让 PP4 的 token-overflow confirmation 复用同一路径。

### 6.3 候选分工(若 owner 有 ≥ 2 个 reviewer-engineer)

**最少需要 2 人 split**,推荐 3 人:

| 角色 | 主要承担 | Phase 顺序 |
|---|---|---|
| **Engineer A — Core Loop** | PP1(全)、PP2 中的 `runtime-mainline.ts` tool exec 路径改造 + emitHook 真投递 | PP1 → PP2 |
| **Engineer B — Connection & Protocol** | PP3(全)、PP2 中的新 NACP frame schema(`packages/nacp-core/messages/hook.ts` 扩)| PP3(可与 A 的 PP2 并行) |
| **Engineer C — LLM Wrapper & Policy** | PP4(全)、HPX7-D + HPX7-F 的 docs drift guard、PP2 中的 hooks.md 文档撰写 | PP4(可与 A+B 的 PP2/PP3 并行) |

### 6.4 候选分工(若只有 1 个 reviewer-engineer)

整个 pro-to-product 强制串行 PP1 → PP2 → PP3 → PP4 → PP5;HPX7 收尾在 hero-to-pro 期间已完成,所以 pro-to-product 启动时无遗留。

---

## 7. 可行性评估

### 7.1 Cloudflare Workers 约束清单(影响哪些工作)

| 约束 | 受影响工作 | 缓解策略 |
|---|---|---|
| 无 `child_process` | C5 Hook 的 `command` 类型 runtime 不能直接 port | pro-to-product **不**做 command runtime;命名约束:hooks 在本阶段仅支持 `local-ts + service-binding`,user-supplied hook 走 `prompt` runtime(借 Workers AI binding)即可证明 pipeline 通 |
| 无本地 fs(只有 R2) | C5 Hook 的 `FileChanged / WorktreeCreate` 语义不直接对应 | 本阶段 14 个 emit 重点在 `PreToolUse / PostToolUse / Pre/PostCompact / PermissionRequest`,FileChanged 类不入 PP2 |
| `fetch()` 默认无 DNS resolver,SSRF 风险 | C5 Hook 的 `http` 类型 runtime 必须先做 SSRF guard | pro-to-product **不**做 http runtime;留到 pro-to-product 之后的 platform-foundations |
| DO storage 是 K-V,SQLite-DO 决议不引入(D2) | C6 reconnect 的 replay buffer 持久化 | 用现有 `nacp_session:checkpoint` blob + `helper.checkpoint()`,只需修 `restoreFromStorage` 调用顺序,不引入新 storage 模式 |
| Workers AI 单 provider 决议(D3)| C3 reliability 的多 provider fallback chain | pro-to-product **不**引多 provider;`fallback_model_id` 限 Workers AI 内多模型链;adequate 即可 |
| Cloudflare Queue 已在 HPX6 引入 | C2 compact 的异步 summary、C6 detached TTL alarm | 直接复用现有 alarm + queue 基础设施 |
| 6-worker 拓扑不引新 worker(D1)| C5 Hook 的 cross-worker dispatcher | 通过 NACP `hook.emit / hook.outcome` wire schema 在 worker 间桥接(已就绪),不引新 worker |

**综合判断**:Cloudflare 约束**不阻塞** pro-to-product 6 个闭环里的任意一个;只是 C5 hooks 的 command/http runtime + C6 cross-device resume 这两个边缘能力被推迟。9 份报告交叉点的 P0 全部在 Cloudflare 模型内可实现。

### 7.2 工作量初步估算

下面是按 9 份报告 individual 估算合并 + opus 个人评估给出的范围。**这是 ballpark**,任何严肃的工期承诺需要 owner 与执行 engineer 共同细化。

| Phase | 工作内容 | 单工程师天数 | 可并行后人月数 |
|---|---|---|---|
| **HPX7** | §3.2 8 项收尾 | 7-12 天 | 0.5 人月 |
| **PP0** | charter + closing-thoughts + 9 份报告归一 | 3-5 天 | 0.2 人月 |
| **PP1** | C1+C2 闭环(scheduler interrupt 改 + compact 真装 + token 预检)+ e2e | 14-21 天 | 0.7-1.0 人月 |
| **PP2** | C5 Hook 真接通(emitter producer 14 个 + register 路径 + 新 frame + UI 状态条)+ e2e | 10-15 天 | 0.5-0.7 人月 |
| **PP3** | C6 Reconnect 闭环(replay restore + resume protocol + TTL + ack)+ e2e | 10-15 天 | 0.5-0.7 人月 |
| **PP4** | C3+C4 Reliability+Policy(fallback metadata 抬出 + retry + /runtime 二选一 + reasoning 流 + token 流)+ e2e | 10-15 天 | 0.5-0.7 人月 |
| **PP5** | final closure + 25-doc + handoff stub | 5-7 天 | 0.3 人月 |

**总计**:
- **单工程师串行**:60-90 天 ≈ 3-4.5 人月
- **3 工程师并行(PP2/PP3/PP4 三线)**:PP1 + max(PP2,PP3,PP4) + PP5 ≈ 35-50 天 ≈ 2.0-2.5 人月

### 7.3 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| **PP1 compact 真实装跨 worker 复杂度低估** | PP1 工期 > 21 天,推迟 PP2-PP4 | PP0 内必须先写 compact design doc 并跑通"reducer 真截消息"的最小 e2e;接受 compact 为本阶段最大单点风险 |
| **PP2 Hook 改 `authorizeToolPlan` 调用链与 HPX6 permission_rules 冲突** | HPX6 已落地的 D1PermissionRulesPlane 路径与 hook dispatcher 双层 permission 设计需要协调 | PP2 内显式做 sequencing:先 hook → 再 permission_rules → 再 approval_policy;HPX6 决策不退档 |
| **PP3 改 NACP frame schema 破坏 backward compat** | 现有 client 升级压力 | PP3 严格遵守 charter §1.3 的"NACP backward compat"纪律,只新增 frame kind,不破坏现有 13 种;HPX6 已经从 13 → 16 增量验证可行 |
| **DDL freeze 纪律(charter §4.4)是否被破坏** | hero-to-pro HP1 集中 DDL 后默认禁后续 phase 加 migration | pro-to-product **不**新加 D1 migration;6 个闭环全部在 HP1 已落表上做。这条建议明文写进 PP0 charter |
| **9 份报告之间的语义交叉是否完整** | 可能漏了报告之间的隐含矛盾 | PP0 必须做"9 份报告归一为 deferral 矩阵"(类比 hero-to-pro 105 项 deferred 归集),逐项交叉对账 |
| **Owner 资源约束** | 若只有 1 名 engineer,3-4.5 人月相当于 6 个月日历周期 | 接受;不强求并行 |

### 7.4 可行性结论(初步)

**结论**:**可行**。6 个闭环没有任何一个超出当前 6-worker + Workers AI + NACP 协议的能力边界;9 份报告的 P0 修复全部已识别明确的代码位置 + 修复路径;HPX5/HPX6 已铺设的 emitter/durable plane/queue/alarm 基础设施可以直接复用,**不需要新建任何子系统**。最大风险是 PP1 compact 真实装 — 这条 owner 应优先确认 context-core 同事的可用度。

---

## 8. 与 hero-to-platform / 未来 foundations 的关系

### 8.1 pro-to-product 不替代 hero-to-platform

按 §2.3 的命题树,pro-to-product 是 hero-to-pro 与未来 platform 阶段之间**新插入**的纵向闭环阶段,不是 hero-to-platform 的改名。原 hero-to-platform 的 16 项 in-scope(multi-provider / sub-agent / admin / billing / SQLite-DO / SDK extraction / WeChat 完整适配 / WORKER_VERSION CI 切换 / 3-tier observability 单发切换 / prompt caching / structured output / sandbox 隔离 / per-deploy multi-tenant / client package extraction / TodoWrite V2 task graph / 3-tier observability spike)**全部仍然存在**,只是被进一步推迟到 pro-to-product 之后。

### 8.2 推迟的明确清单

owner 在前一轮已经决断的 11 项必须显式 defer 到 pro-to-product 之后:

| 项目 | 推迟到的阶段(候选)| 推迟理由 |
|---|---|---|
| Skills | platform-foundations | "下沉到后续大阶段做 foundations" — owner 显式决断 |
| Browser Rendering | platform-foundations | 同上 |
| Memory / CLAUDE.md / 项目记忆 | platform-foundations | 同上 |
| Cost / Usage Tracker 深 dive | platform-foundations | usage snapshot 已支撑 MVP |
| Plugin / MCP / Service-binding 生态 | platform-foundations | foundation 性质 |
| Virtual Git Subset | platform-foundations | 产品级特性,前端 timeline 已够用 |
| Multi-provider LLM(O1) | platform-foundations | charter D3 |
| Sub-agent / Multi-agent(O2) | platform-foundations | charter D4 |
| Admin / Billing(O3/O4) | platform-foundations | charter D5 |
| SDK extraction(O6) | platform-foundations | F8 升级路径 |
| WeChat miniprogram 完整适配 | 独立专项 | RHX2 已 explicit defer |

**注意**:这一清单建议在 PP5 final closure 时由 owner 重新审视;pro-to-product 的实战经验可能让某些下沉项被前移,或某些 in-scope 项被进一步推迟。

### 8.3 PP5 输出 `plan-platform-foundations.md` 入口 stub

类比 hero-to-pro HP10 输出 `plan-hero-to-platform.md` stub,PP5 应输出 `plan-platform-foundations.md` 入口 stub(命名待 owner 决断 — 也可继续叫 `plan-hero-to-platform.md`)登记 §8.2 全部 11 项 + pro-to-product 自身可能产生的 inherited issues。

---

## 9. Owner 待决问题

下面这些决策本文档不替 owner 做,但必须在 PP0 charter 写出前回答:

### Q1 — HPX7 是否接受 §3.2 8 项的提案?

- 接受 → §3.2 8 项进入 hero-to-pro HPX7 action-plan,HP10 final closure 配套;pro-to-product 启动时 nano-agent 处于"4 套状态机闭环 + 8 项 wire-with-delivery 修补 + F12 chronic explicit-handoff"状态。
- 拒绝 / 减项 → 减下来的项移入 pro-to-product PP1-PP4。

### Q2 — pro-to-product 是否接受 6 个闭环 / 6 个 phase 切分?

- 接受 → PP0 charter 按 §4.2 + §5.1 落地;6 个闭环作为 charter §3.1 一句话产出。
- 调整 → 对 6 个闭环的合并/拆分(比如把 C3+C4 合并为一个 phase,或把 C5 Hook 真接通拆成 dispatcher + frontend 两个 phase)是合理的。

### Q3 — pro-to-product 是否允许 D1 schema 修订?

- 不允许(继承 hero-to-pro charter §4.4 R8 受控例外纪律)→ pro-to-product 必须在 HP1 已落表上做。
- 允许 → PP0 charter 显式开口子,但建议明文限制为"PP1 compact summary 表 + PP3 detached TTL 字段"两类,严禁泛用。

### Q4 — pro-to-product 启动并行度

- 1 工程师串行 → 3-4.5 人月
- 3 工程师并行(PP2/PP3/PP4 三线)→ 2.0-2.5 人月
- 介于两者 → 按 §6.3 减员

### Q5 — `plan-pro-to-product.md` 的 charter 性质

- 严格 charter(类比 hero-to-pro)→ 工作量大,~2-3 周,需多家 review
- 轻 charter(只冻结边界 + 6 闭环 + 5 phase 切分,不写 §6 phase 详细 In-Scope/Out-of-Scope/Exit Criteria)→ ~1 周

### Q6 — pro-to-product 的命名是否最终?

- `pro-to-product` → 锁定
- 候选替代名:`workbench-to-product` / `wrapper-to-product` / `hero-to-product`(直接跳过 pro 命名层)— 任何变化都应在 PP0 之前确认

### Q7 — HP10 final closure 的 NOT-成功识别第 1 条(F12 hook dispatcher 未真接通)如何处理?

- 选项 A:HPX7-G(本文 §3.2)显式重表态,HP10 走 `close-with-known-issues`,F12 explicit-handoff 给 pro-to-product PP2。
- 选项 B:HPX7 内强行做"最低限 hook real-deliver"(只接 PreToolUse 一个事件),让 F12 closure 在 HP10 内完成。
- 选项 C:HP10 标 `cannot close`,等 pro-to-product PP2 完成后回 backfill HP10 closure。

**建议**:A 最干净,B 让 HPX7 范围超 §3.1 4 条标准,C 违反 charter §11.2(下一阶段开启前提)。

---

## 10. 一句话定位(初步)

> **pro-to-product = 把 hero-to-pro 已经盖好的 schema / storage / façade 真正接通到 _agent loop_ 与 _client 可见层_,完成 HITL/Context/Reliability/Policy/Hook-to-Frontend/Reconnect 6 个闭环,让前端第一次能站在一个诚实、可观测、可恢复的产品级 backend 上搭起来,从而能用前端的真实使用反推后续 platform-foundations 阶段的工作。**

---

## 附录 A:9 份 core-gap 报告速查索引

| 维度 | 报告 | 核心 P0 |
|---|---|---|
| Hooks | `claude-code-hooks-by-opus.md` | 14/18 不 emit、registry 永远空、客户端零 hooks API、4 hook types 0/4 |
| Hooks | `codex-hooks-by-kimi.md` | HookStarted/HookCompleted 客户端推送缺失、Outcome entries 结构化缺失、Permission 决策不走 dispatcher |
| Hooks | `gemini-cli-hooks-by-deepseek.md` | BeforeModel/AfterModel/BeforeToolSelection/AfterAgent 4 个干预点完全缺失、PreToolUse 有 catalog 无接线 |
| LLM-wrapper | `claude-code-llm-wrapper-by-GPT.md` | ask 死胡同、auto-compact 假、`/runtime` 不 enforce、fallback/retry 不 first-class、reasoning producer 缺、retry/fork/restore 浅 |
| LLM-wrapper | `codex-llm-wrapper-by-deepseek.md` | reasoning 流不推送、token 计数缺(reasoning/cached/累计/window%)、流 retry 缺、idle timeout 缺、auth refresh 缺、模型 reroute 无感知 |
| LLM-wrapper | `gemini-cli-llm-wrapper-by-kimi.md` | compact 空操作(P0-1)、ask 死胡同(P0-2)、context window 预检缺失(P0-3)、Hook 孤儿、workspace checkpoint identity、token 双重累加、循环检测缺失 |
| Connection | `claude-code-connection-by-GPT.md` | session.resume 不是 replay protocol、top-level frames 无统一 buffer、followup_input 无 ack/dedup、replay window law 不诚实 |
| Connection | `codex-connection-by-deepseek.md` | replay buffer 容量 200/stream 溢出 throw、双层 seq 不一致、重连无 status snapshot、detached 无 TTL、客户端无自动重连、DO migration 无 D1 fallback |
| Connection | `gemini-cli-connection-by-kimi.md` | DO hibernation 后 replay buffer 不恢复(B1 critical)、timeline 重建重置 last_seen_seq、replayLost 判定不完整、detached 无 TTL、facade 转发 last_seen_seq 可能丢失(已记录) |

## 附录 B:HPX7 vs pro-to-product 边界判定速查

| 工作 | HPX7 | pro-to-product |
|---|---|---|
| `replay.ts` graceful degrade | ✓(HPX7-A) | — |
| `restoreFromStorage` 恢复 replay buffer | ✓(HPX7-A) | — |
| token 双重累加修复 | ✓(HPX7-B) | — |
| tool cancel `abort()` 填充 | ✓(HPX7-C) | — |
| reasoning content_type 区分 | ✓(HPX7-D) | 或 PP4 |
| docs drift 修订 + drift guard 扩展 | ✓(HPX7-E + HPX7-F) | — |
| HP5-closure F12 重表态 | ✓(HPX7-G) | — |
| race catch{} 修复 | ✓(HPX7-H) | — |
| ask 真 pause-resume | — | ✓ PP1 |
| compact 真实装 | — | ✓ PP1 |
| context window 预检 | — | ✓ PP1 |
| Hook 14 emitter + dispatcher 真接通 + 客户端 frame | — | ✓ PP2 |
| public resume protocol 升级 + status snapshot | — | ✓ PP3 |
| detached TTL + turn cancel | — | ✓ PP3 |
| top-level frames 统一 replay | — | ✓ PP3 |
| fallback metadata 流出 + LLM retry | — | ✓ PP4 |
| `/runtime` 二选一终态 | — | ✓ PP4 |
| TokenCount/RateLimits/ContextWindow% 流 | — | ✓ PP4 |
| loop detection | — | ✓ PP4 |

---

## 维护约定

1. 本文档是 `eval / initial-planning`,不是 charter — owner 决策后由 PP0 phase 内更细的 `plan-pro-to-product.md` charter 接力。
2. 在 PP0 charter 写出之前,本文档可以不断修订(版本号 v0.draft-rN)— 任何修订都应在文首"修订历史"补一行说明改了什么、为什么改。
3. PP0 charter 写出之后,本文档自动转为"pre-charter ancestry-only"参考,不应再被作为 action-plan 编号依据。
4. 如果 owner 决定 _不_ 走 pro-to-product 路线(比如直接跳到 platform-foundations 或重写命题树),本文档保留为决策对照档,不删除。
