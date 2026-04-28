# ZX4 / ZX5 Action Plan Reviewed by GPT

> 审查对象:
> - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md`
> - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`
> 时间: `2026-04-28`
> 结论标签: **拆分方向总体正确;ZX4 已接近可执行;但按 owner direction,ZX5 不允许拆分出新的 worker**

---

## 0. TL;DR

这次把老 ZX4 拆成 **ZX4(transport true close + session semantics)** 与 **ZX5(protocol hygiene + product surface + architecture)**，整体上是一次**正确且必要的重切**。

和我上一次审查相比，这次最关键的改进已经成立：

1. **ZX4 不再混入 product / protocol / ops / architecture 杂项**，主目标重新收紧到 `internal-http-compat` 真退役与 session 语义闭环。
2. **ZX4 的 gate 逻辑明显更合理**：不再拿 `cross-e2e 14/14` 当 P1 bugfix gate，而是把它放到 whole-plan gate。
3. **ZX4 已接受“单一 session truth model”原则**：明确不再新建 `pending_sessions` 平行表。
4. **ZX5 也不再冒充 transport close 的一部分**，而是明确承接 hygiene / product / architecture 三条非阻塞 lane。

但这次拆分**还不是完全无盲点**。我的总体判断是：

- **ZX4**：方向对、phase 逻辑基本成立，**已接近可执行**；主要剩下的是状态机枚举、permission/usage/elicitation 实施边界、以及 live gate 前置条件需要再冻结。
- **ZX5**：lane 划分总体合理，但 **Lane C / D / E 各自都还有一个关键盲点**，如果不在执行前说清楚，后面会变成“做着做着再改定义”。

另外，本次我已经按你的要求，**直接把 owner 问题的回答写回了两份 action-plan 文档中**。

但需要补一条比上轮评审更强的修正：

> **owner direction 已明确冻结：ZX5 不允许拆分出新的 worker。**

这意味着我在上一版评审里对 `workers/session-do/` 的“物理上会变成 7-worker topology”判断，虽然作为**拓扑后果识别**本身没有错，但在**执行结论**上必须下调为：

- **ZX5 不得创建 `workers/session-do/`**
- **Lane E 不得以“新增独立 worker”作为当前阶段执行目标**
- **如未来仍要讨论 session runtime 拆分，也必须是 owner 重新授权后的后续议题，而不是当前 ZX5 scope**

---

## 1. 这次拆分后，scope 划分是否合理

## 1.1 ZX4 的 scope 划分：**明显合理很多**

我同意现在 ZX4 的主标题和主范围：

- **Lane A**: transport blocking close
- **Lane B**: session semantics

这比老 ZX4 unified draft 清晰得多。当前版本已经把这些内容移出 ZX4：

- `jwt-shared`
- error code / envelope hygiene
- catalog content
- product endpoints
- WORKER_VERSION ops
- session-do / context-core / filesystem-core 大架构改造

这意味着现在 ZX4 的 closure 语义终于比较自洽：

> **transport 真收口** + **facade-http-v1 必需 session 语义闭环**

这和当前真实代码状态也是对齐的：

- `internal-http-compat` 仍是 `retired-with-rollback`
- R28 / R29 / parity body diff / P3-05 flip / R31 仍是真 blocker
- `/me/sessions` / permission / usage / elicitation 仍停在半成品状态

所以 **ZX4 当前 scope 的大方向，我认可**。

## 1.2 ZX5 的 scope 划分：**总体合理，但比 ZX4 更容易在 lane 内再度发散**

ZX5 现在分成：

- **Lane C**: protocol / auth hygiene
- **Lane D**: product surface + ops
- **Lane E**: architecture refactor

这个分法也比原来的“大一锅端”好很多，尤其是：

- Lane C 基本围绕 single source / compile-time constraints / client helper migration
- Lane D 基本围绕 facade public surface
- Lane E 基本围绕 compute topology / service binding / RPC uplift

也就是说，**ZX5 的一级 scope 划分是合理的**。

但需要注意：**ZX5 的一级切分合理，不等于每个 lane 内部都已经完全冻结好了执行边界**。下面的盲点主要集中在 lane 内部。

---

## 2. ZX4 的阶段设计审查

## 2.1 我认可的部分

### A. `Phase 0 → Phase 1 → Phase 7 → Phase 8 → Phase 9` 的主线逻辑是成立的

现在 ZX4 的主线已经变成：

1. 先做 `user-do.ts` seam extraction
2. 再修 R28 / R29
3. 再补 session semantics
4. 再做 whole-plan live gate
5. 再开 7 天观察
6. 最后 flip + retired

这个顺序明显比上一版健康，因为它避免了两个老问题：

- 先把所有新逻辑继续堆进 `user-do.ts`
- 在 feature 还在变化时就提前开 parity observation

### B. `P1 exit gate` 与 `whole-plan gate` 的分离是对的

上一版最明显的断点，就是把 `cross-e2e 14/14` 错绑成 P1 gate。  
现在改成：

- **P1**: 只看 R28 / R29 targeted preview smoke
- **P7**: 才看 `cross-e2e 14/14`

这和当前 live-gated 测试现实是匹配的，因为现在 `pnpm test:cross-e2e` 默认仍是 `1 pass + 13 skip`，它本来就不适合拿来充当一个早期 bugfix gate。

### C. 单一 truth 原则已经被吸收

这是 ZX4 这次最重要的修正之一。

现在文档已经明确：

- 不新建 `pending_sessions` 表
- 在现有 `nano_conversation_sessions` 上扩展状态

这避免了 create-stage / active-stage / history-stage 各自落在不同 schema 的双真相问题。  
这点我明确认可。

## 2.2 ZX4 仍然存在的盲点

### R1 — `pending` / `expired` / 现有 status enum 仍未完全冻结，状态机描述前后不够一致

当前真实代码与 migration 事实是：

- `nano_conversation_sessions.session_status` 当前只允许  
  `starting | active | detached | ended`
- ZX4 文本中明确要引入 `pending`
- 但同时又在 Phase 3 写了 `pending -> expired`
- 而 `GET /me/sessions` 描述里又常常只写 `pending + active + ended`

这说明**状态机方向是对的，但枚举集还没有完全冻结**。

如果不在执行前说清楚，后面会出现三种容易打架的实现：

1. migration 加 `pending`，不加 `expired`
2. TypeScript union 加了 `expired`，SQL CHECK 没加
3. read-model 只展示 `pending/active/ended`，但后台还有 `detached/expired`

**建议**：ZX4 在开工前把 session status 集合显式冻结成一份表。  
最少要同时统一：

- migration CHECK
- `DurableSessionStatus` TypeScript union
- `/me/sessions` read-model 可见状态
- alarm GC 对应的状态转移

### R2 — Phase 4-6 对 permission / usage / elicitation 的工作量描述仍偏乐观

ZX4 现在把这三件事写成一条顺滑链：

- P4 permission round-trip
- P5 usage live push + 真预算
- P6 elicitation round-trip + e2e

方向没问题，但从当前代码事实看，**它们并不是只改几处 handler 就能闭合**：

- `workers/orchestrator-core/src/user-do.ts` 当前只有 `emitServerFrame()` 这个 WS seam
- `handlePermissionDecision()` 目前只是记录决定，不会回流到 runtime resolver
- `handleUsage()` 目前仍返回 null placeholder
- agent-core 侧目前并没有一个已经成型的“阻塞等待 orchestrator decision 再恢复执行”的现成 transport contract

所以这三 phase 实际上会同时牵动：

- orchestrator-core read/write paths
- agent-core runtime blocking seam
- WS / HTTP mirror
- live e2e

**建议**：执行时把 P4 / P5 / P6 视为“一个连续的 session-interaction cluster”，不要按文稿长度低估。

### R3 — Phase 7 的 `14/14` gate 虽然放对了位置，但仍需把运行前置条件写得更显式

这次把 `14/14` 放到 P7 是对的。  
但它仍然依赖一整套外部条件：

- live token
- preview deploy 可执行
- live budget / external dependency readiness
- `NANO_AGENT_LIVE_E2E`

因此它已经不是“代码 phase 内部的自足 gate”，而是 **code + ops + creds + budget** 的联合 gate。

我不认为这构成新的设计错误，但建议 ZX4 执行时把它显式标成：

> **whole-plan verification gate，含环境前置条件**

否则后面 closure 又容易出现“代码都做完了，但 gate 没法跑”的措辞漂移。

---

## 3. ZX5 的阶段设计审查

## 3.1 我认可的部分

### A. Lane C / D / E 的一级切分是合理的

这次 ZX5 没再把 hygiene / product / architecture 混成一条 closure 线，这是正确的。

### B. Lane E 后置到 ZX4 之后是必要条件，但已不再是充分条件

`session-do` 抽离 + context/filesystem 真 RPC，都属于**会改变系统物理拓扑**的大改。  
这类工作不应该和 ZX4 的 transport true close 混跑。  
这一点我仍然认可。

但在你最新明确 owner direction 之后，这里的结论还要再补半句：

> **即使放到 ZX4 之后，ZX5 也不允许因为 Lane E 去新增一个独立 worker。**

所以，Lane E 现在不能再被理解为“晚一点再做 `workers/session-do/`”，而应被理解为：

- 当前 ZX5 中**冻结 / 延后**
- 仅保留为未来可能的架构研究议题
- 且未来若重启，也应优先讨论 `agent-core / agent-session` 这样的 agent-domain split，而不是把 `session-do` 先抽成一个横向基础设施 worker

### C. ZX5 已经不再试图用“所有 lane 一起完成”来定义 close

这也比上一版健康。  
对于这么异质的 3 个 lane，lane-by-lane close 本来就比统一 close 更自然。

## 3.2 ZX5 仍然存在的盲点

### R4 — Lane C 的 C5 落点仍有小断点：`packages/orchestrator-auth-contract/README.md` 当前并不存在

Lane C 的文稿把 C5 写成：

- 更新 `packages/orchestrator-auth-contract/README.md`
- 更新 `packages/nacp-core/README.md`

但当前仓库里：

- `packages/nacp-core/README.md` 存在
- `packages/orchestrator-auth-contract/README.md` **并不存在**

这不是大问题，但它说明 **C5 还没完全冻结“文档落在哪里”**。

我的建议是：

1. 要么在 C5 里明确允许新建 `packages/orchestrator-auth-contract/README.md`
2. 要么把这部分文档固定落到 `docs/transport/` 或相关 eval / contract 文档

否则执行者会在“补 README”还是“改 docs”之间临时再做一轮设计。

### R5 — Lane C 的 C6 目标方向对了，但 helper 能力边界仍未完全冻结

我认同这次的修正方向：

- 不再写深路径 import
- 改成 `@haimang/nacp-session` root export / shared helper / adapter

但当前真实包导出是：

- `HeartbeatTracker`
- `ReplayBuffer`
- `SessionWebSocketHelper`

这三者并不等价于“现成的 web / wechat 客户端接入层”。

更具体地说：

- `ReplayBuffer` 是 NACP frame 级 ring buffer
- `SessionWebSocketHelper` 更偏 session runtime / DO helper
- 当前客户端仍然处理的是现网 lightweight `{kind,...}` wire 与自己的 lastSeenSeq / ack / timer 逻辑

所以 **C6 的方向没错，但它不是“直接替换几行 import”这么简单**。  
更合理的执行口径应该是：

> 以 `@haimang/nacp-session` 为 single source，必要时先在包内或 client 层补一层 browser/wechat adapter，再删现有手写实现。

### R6 — Lane D 的 D3 `/sessions/{id}/messages` 仍缺少和现有 `/input` / `history` / `timeline` 的语义去重

这是 ZX5 我最想强调的产品面盲点之一。

当前真实 session facade 已经有：

- `POST /sessions/{id}/input`
- `GET /sessions/{id}/timeline`
- `GET /sessions/{id}/history`

而 D3 想加：

- `POST /sessions/{id}/messages`

问题在于：**这不是一个单纯“多一个 endpoint”**，而是一个潜在的语义重叠点。

执行前至少要先冻结下面三件事：

1. `/messages` 是不是 `/input` 的多模态超集？
2. 如果是，它和现有 start/input/history/timeline 的落库规则如何统一？
3. 它是 session-running ingress，还是只是离线消息写入？

如果不先冻结，D3 很容易变成：

- 一条新入口
- 一套新 body
- 一份新 D1 写法
- 最后再和 `/input` / history 做对齐补丁

这会把 Lane D 带回“接口碎片再增殖”的老路。

### R7 — Lane D 的 D6 `/me/devices/revoke` 当前依赖写法不够准确

文稿里把 D6 描述成“依赖 C2 jwt-shared 切完后更稳”。  
我理解它的意图是：先把 JWT helper 去重，再做 revocation。

但从当前代码看，**`jwt-shared` 只解决 helper single source，不会自动带来 device truth / device revocation model**。

当前 repo 里能看到的是：

- refresh token revocation 相关逻辑存在
- 但没有明确的 device registry / trusted device schema / `device_uuid` 模型

所以 D6 真正缺的不是“先抽 jwt-shared”，而是：

1. device truth 在哪里
2. revoke 粒度是什么
3. revoke 后影响哪些 token / session / refresh chain

换句话说，**D6 的真实前置更接近“device model freeze”，而不是“jwt-shared 已抽”**。  
这一点建议在执行前单独补一条设计冻结。

### R8 — 关于 Lane E，我需要按 owner direction 修正结论：ZX5 不允许新增 worker

我需要把这里的口径明确修正为两层：

第一层，**事实识别**没有变：

- 如果真的新建 `workers/session-do/`，那物理上就不再是原来的 6-worker 拓扑
- 这一点只是对 plan 文本后果的客观识别，不是我对该方案的推荐

第二层，**执行结论**现在已经被 owner direction 明确覆盖：

> **ZX5 不允许拆分出新的 worker。**

因此，Lane E 在当前阶段不能按下面这条路执行：

- 新建 `workers/session-do/`
- 把 `NanoSessionDO` 从 `agent-core` 物理迁出
- 让 ZX5 承担一次新增 worker 的拓扑重构

我现在的评审结论是：

1. **应把“新增 `workers/session-do/`”从 ZX5 可执行范围中拿掉**
2. **不得在 ZX5 中把 6-worker 变成 7-worker**
3. **如未来业务已经在真实客户端上跑通、session 语义稳定后仍要重谈拆分，应优先按 `agent-core / agent-session` 的域内拆分语言重新建模**
4. **即使未来重谈，也应保持 `agent-session` 仅与 `agent-core` 沟通，而不是让 `orchestrator-core` 或其他节点直接跨过去**

所以这里不再是“接受 7-worker 事实并继续推进”，而是：

> **owner 已明确否决该路径；ZX5 不得执行这类新增 worker 的拆分。**

### R9 — Lane E 的 Q6 回答方向是正确的：不能做“零缓冲硬切”

当前 agent-core 对 context-core 的消费，仍有直接库内 import 痕迹：

- `@haimang/context-core-worker/context-api/append-initial-context-layer`

这说明 E3 / E4 不是简单的“把 binding 接上就完事”，而是：

- 调用方式
- contract
- import
- tests
- runtime seam

都要一起迁。

所以我不支持“零 fallback / 一次性硬切”。  
我支持的口径是：

- **允许短期 shim / compat seam**
- **禁止长期双轨挂账**

这也是我已经直接写入 ZX5 Q6 的答案。

---

## 4. 本次直接写回 action-plan 的问答结论

我已经把 owner answers 直接写回了两份 action-plan。核心结论如下：

| 文档 | 问题 | 我的结论 |
|---|---|---|
| ZX4 | Q1 | 同意按“结果约束”冻结 R28，不绑定单一实现名词 |
| ZX4 | Q2 | 同意 phase-by-phase 串行为主，仅低交集子项跨 phase 并行 |
| ZX4 | Q3 | 同意 4 模块 seam，按职责拆分，不按机械行数 |
| ZX4 | Q4 | 同意在所有 parity 影响代码冻结且 14/14 全绿后再开观察 |
| ZX4 | Q5 | 同意扩现有 `nano_conversation_sessions`，不建平行表 |
| ZX5 | Q1 | 部分同意：C 可与 ZX4 并行，D 仅低交集项可并行，E 必须等 ZX4 完成 |
| ZX5 | Q2 | 先冻结为 owner local preview deploy 路径 |
| ZX5 | Q3 | 同意切 shared helper，但以 package root export / adapter 为准 |
| ZX5 | Q4 | 原技术后果判断成立，但现已被 owner direction 覆盖：ZX5 不允许新建 `workers/session-do/`，Lane E 只能冻结/延后，不能执行新增 worker 拆分 |
| ZX5 | Q5 | 同意 D3/D4 复用现有 D1 truth + R2 storage，不建平行表 |
| ZX5 | Q6 | 不同意零缓冲一次性硬切；同意短期 shim 迁移后再删旧 import |

另外，我也直接修正了 ZX5 文本里一处前后自相矛盾的地方：

- 统一成 **`RpcErrorCode ⊂ FacadeErrorCode`**
- 不再写反成 `FacadeErrorCode ⊂ RpcErrorCode`

---

## 5. 最终结论

## 5.1 对 ZX4 的结论

**ZX4 这次重建后，已经从“不能直接开工”进化到“基本可执行”。**

我对它的判断是：

- **scope**：正确
- **phase 设计**：大体合理
- **关键改进**：已吸收上轮 review 的核心意见
- **剩余问题**：主要是状态机枚举冻结、P4-P6 的真实工作量与 live gate 前置条件

如果要一句话总结：

> **ZX4 现在已经像一个真正的 blocking close plan 了。**

## 5.2 对 ZX5 的结论

**ZX5 的一级 lane 划分是合理的，但 Lane E 已被 owner direction 明确收紧：不允许在 ZX5 中拆分出新的 worker。**

我对它的判断是：

- **scope split**：正确
- **lane independence**：大体成立
- **主要风险**：Lane C 的 helper 能力边界、Lane D 的 product contract 语义、以及 Lane E 当前文稿仍残留“新增 worker”导向，必须按 owner direction 改写或冻结

如果也用一句话总结：

> **ZX5 这次终于不像“把剩下所有东西都扔进去”的收尾包了，但它还没有完全摆脱 lane 内部重新发散的风险，尤其是 Lane E 不能再按“新增 worker”路径继续写。**

## 5.3 最终 verdict

- **ZX4**: `approved-with-caveats`
- **ZX5**: `approved-with-caveats` **(前提: 明确遵守 owner direction，不得在 ZX5 中新增 worker)**

其中：

- ZX4 的 caveat 已经不再是“范围错了”，而是“执行时要把状态机与 gate 前提再钉死”
- ZX5 的 caveat 则是“每条 lane 内都还有一个核心设计点需要在开工前再冻一下”，其中 **Lane E 的核心冻结点不是技术细节，而是 owner direction 已禁止其在 ZX5 中新增 worker**

这次拆分总体上，我给出的是 **明确正面评价**：

> **拆分是对的，边界比上一版健康很多；ZX4 可以按当前方向推进，ZX5 则必须先接受一条硬边界：按 owner direction，不允许在本阶段拆分出新的 worker。**
