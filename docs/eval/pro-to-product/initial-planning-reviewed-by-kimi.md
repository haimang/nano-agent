# Pro-to-Product 阶段初步规划 —— 独立审查意见

> **文档性质**: `review / eval-response`（对 `docs/eval/pro-to-product/initial-planning-by-opus.md` 的独立审查）
> **审查人**: `kimi (k2p6)`
> **日期**: `2026-05-02`
> **审查基础**:
> - Opus initial-planning v0.draft（483 行全文）
> - `docs/charter/plan-hero-to-pro.md`（hero-to-pro 基石，含 §16 HPX1-HPX6 回填）
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`（阶段封板状态：partial-close/7-retained）
> - `docs/issue/hero-to-pro/HPX6-closure.md`（HPX6 executed-with-followups）
> - `docs/code-review/hero-to-pro/HPX6-reviewed-by-kimi.md`（HPX6 审查发现 9 项）
> - 9 份 core-gap 报告目录确认（hooks ×3、llm-wrapper ×3、connection ×3 均存在）
>
> **审查立场**: 完全独立推理，不参考其他同事（包括 Opus、Deepseek、GPT）的既有结论，仅以文档事实和代码现状为据。

---

## 0. 总体判断

**对 Opus 草案的定性**: 这是一份**命题方向正确、交叉分析扎实、框架设计合理**的初步规划，在"为什么要 pro-to-product"和"6 个闭环是什么"两个问题上给出了令人信服的回答。但在**工作量诚实度、入口条件清晰度、风险 contingency 具体化**三个维度上存在显著缺口，若直接按此草案执行，有**35-40% 概率**在 PP1 遭遇工期失控或范围蔓延。

**我的核心建议**:
1. **接受命题转换**（hero-to-platform → pro-to-product）和 **6 闭环框架**（C1-C6）
2. **削减 HPX7 至 3-4 项**，避免收尾阶段再次膨胀
3. **在 PP0 内增加 3-5 天进行 hero-to-pro 真实 debt 盘点**，把 HPX6 遗留问题纳入入口条件
4. **PP1 拆分为两个 sub-phase**，降低 compact 真实装的单点阻塞风险
5. **PP5 增加 "hero-to-pro 7-retained 清理验证" gate**，防止历史债务 silently inherit

---

## 1. 对命题转换的判断（§2）

### 1.1 肯定：owner 的命题转换是必要且正确的

Opus 在 §2.2 把 owner 的意图翻译为：

> pro-to-product 不是 hero-to-platform 的改名，而是在 hero-to-platform **之前插入**的新阶段

这个判断我完全同意。从 hero-to-pro final closure 的实际情况看：

- 4 套状态机完整度：Model 3.5/4、Context 3/5、Chat 4/6、Tool/Workspace 3/7
- 22-doc pack 已冻结，但 **"schema/storage/façade-already-live, live-caller 不在"** 的 wire-with-without-delivery 模式贯穿 HP2-HP8
- HPX6 的 closure 状态是 `executed-with-followups`，不是 `completed`

这些数据支持 Opus 的元结论（§1.2）：**当前断点不是"端点不够多"，而是"已有端点的语义未真接通到 loop"**。继续以 hero-to-platform（multi-provider / admin / billing）为下一阶段，会让 nano-agent 在"前端站不住"的情况下盲目横向扩张，重蹈 ZX5 "Lane E shim ≤2 周"的覆辙。

### 1.2 补充：pro-to-product 与 hero-to-pro 的边界应更锋利

Opus §2.4 论证了"为什么不能合并"，但缺少一个**量化标准**。我建议在 PP0 charter 中明确：

```
pro-to-product 的 in-scope 判定标准（单条）：
1. 该工作修复的是一个「已有 schema / 已有 D1 表 / 已有 façade 端点」但「0 caller 或 caller 走 stub」的断点
2. 修复后，前端能在一个完整 user journey 中感知到行为变化（而非仅内部 metric 改善）
3. 不引入新的 NACP message_type（除非该 type 是已有 schema 的 emit producer）
4. 不引入新的 D1 migration（严格继承 hero-to-pro HP1 DDL freeze 纪律）

凡不满足 1+2 的工作 → 明确推后到 platform-foundations。
```

这个标准的价值在于：**把 Opus 的 6 个闭环从"抽象概念"转化为"可逐条判定是否越界"的 operational rule**。当前草案中，C3 "Reliability 闭环"的某些子项（如 loop detection、TokenCount push）可能不完全满足标准 2，需要在 PP0 内二次审视。

---

## 2. 对 HPX7 的判断（§3）

### 2.1 问题：HPX7 的 8 项提案违反了自己制定的 4 条标准

Opus §3.1 为 HPX7 制定了很好的入选标准：
1. 修补深度浅（单文件或邻近文件）
2. 与现有 4 套状态机紧耦合
3. 不引入新跨 worker 接线
4. 完成后能让 hero-to-pro 终态判定升级

但 §3.2 的 8 项候选中，**至少 3 项违反标准 1 或 3**：

| 项 | 违反的标准 | 理由 |
|---|---|---|
| **HPX7-A** replay buffer 恢复 | 标准 1（非单文件）+ 标准 3（跨 agent-core/orchestrator-core/packages） | 涉及 `replay.ts` 协议层 + `session-do-persistence.ts` DO storage 层 + `user-do/ws-runtime.ts` façade 转发层，三层联动 |
| **HPX7-D** reasoning content_type 区分 | 标准 3（跨 worker） | 需改 `session-stream-adapter.ts`（agent-core）→ `stream-event.ts`（nacp-session）→ `clients/api-docs/session-ws-v1.md`（docs），且涉及 provider 返回格式解析 |
| **HPX7-F** check-docs-consistency 新 regex | 标准 2（非状态机耦合） | 这是 drift guard 增量，与 4 套状态机无直接关系 |

**更严重的问题**：HPX7-A（replay buffer 恢复）被 Opus 自己归类为 connection 维度的 P0 断点（§1.1 Connection 第 2 条），但又在 HPX7 中试图收编。如果 HPX7-A 真的只是"单文件改动"，那它就不应该是 9 份报告共同指认的 P0；如果它是 P0，那它就不满足 HPX7 的浅修补标准。**这是一个自相矛盾**。

### 2.2 建议：HPX7 削减至 3-4 项

基于 hero-to-pro final closure 已经处于 `partial-close/7-retained` 状态，HPX7 的使命不是"尽量多补"，而是"**用最少的动作让 final closure 合法化**"。

我的建议清单：

| ID | 工作项 | 入选理由 | 工作量 |
|---|---|---|---|
| **HPX7-A'** | `docs/issue/hero-to-pro/HP5-closure.md` 重新表态（类比 Opus HPX7-G） | **零代码改动**，仅文档诚实化；消除 deceptive closure；让 F12 从 "closed" 降级为 "dispatcher instance injected, live caller deferred" | 0.5 天 |
| **HPX7-B'** | `session-do-runtime.ts:679` 空 catch 修复（Opus HPX7-H） | **单点单文件**；消除 connection G7 race 隐患；符合 4 条标准 | 0.5 天 |
| **HPX7-C'** | `reducer.ts` token 双重累加修复（Opus HPX7-B） | **单文件**；直接影响 compact signal 准确性；若留到 PP1 会让 compact 真实装后立刻被错触发 | 0.5 天 |
| **HPX7-D'** | `runtime-mainline.ts:520` abort() 空实现填充（Opus HPX7-C） | **单文件**；接通 client-cookbook 已宣称的 cancel 路径；capability transport 已有接口 | 0.5 天 |

**删除项的理由**：
- **HPX7-A（replay buffer）**：三层联动，深度大，应归 PP3
- **HPX7-D（reasoning 区分）**：跨 worker + provider 格式依赖，应归 PP4
- **HPX7-E/F（docs drift 修订/drift guard）**：HP9 已 frozen 22-doc pack，事后追加 drift guard 属于"纪律维护"而非"阶段收口"；若 HP9 的 docs 有漂移，应在 pro-to-product PP0 内统一审视而非在 hero-to-pro 尾端打补丁
- **HPX7-G（HP5 closure 重表态）**：与我的 HPX7-A' 合并，范围缩小到"仅 F12 重表态"

**HPX7 总规模**：4 项 × 0.5 天 = **2 工作日**，比 Opus 的 7-12 天压缩 75%，且更诚实地承认：hero-to-pro 的收尾不应该再碰深层架构。

---

## 3. 对 6 个闭环的判断（§4）

### 3.1 肯定：闭环框架覆盖了 9 份报告的交叉共识

C1（HITL）+ C2（Context）+ C3（Reliability）+ C4（Policy）+ C5（Hook-to-Frontend）+ C6（Reconnect）的划分，与 9 份报告的 P0 断点基本一一对应。这是 Opus 草案最扎实的部分。

### 3.2 问题：C3 和 C4 的边界模糊

Opus §4.3 把 "TokenCount push / RateLimits push / ContextWindow% push / reasoning 流 / loop detection" 全部归入 C3 或 C4，但这些工作的**用户感知度**差异很大：

- **fallback metadata 流出**（C3）：前端能立即看到 model badge 变化 → 高感知
- **TokenCount push**（C4）：前端需要专门 UI 才能消费 → 中感知
- **loop detection**（C4）：前端无直接 UI，仅防止 backend 无限循环 → 低感知

如果 pro-to-product 的核心命题是"**前端可搭建、可观测**"（Opus §4.1），那 loop detection 这类纯 backend 防护层工作，虽然技术重要，但**不满足命题的 user-visible 标准**。

### 3.3 建议：在 PP0 内增加 "用户感知度矩阵"

对每个闭环的子项，按以下矩阵分类：

| 子项 | 用户直接感知 | 用户间接感知 | backend 内部优化 |
|---|---|---|---|
| ask pause-resume | ✅ | — | — |
| compact 真实装 | ✅ | — | — |
| fallback metadata 流出 | ✅ | — | — |
| hook started/completed 推送 | ✅ | — | — |
| resume protocol 升级 | ✅ | — | — |
| detached TTL | — | ✅ | — |
| retry / idle timeout | — | ✅ | — |
| loop detection | — | — | ✅ |
| token 预检 | — | — | ✅ |

**建议**：pro-to-product 的 **must-have** 只包括"用户直接感知"列；"用户间接感知"列是 **should-have**；"backend 内部优化"列是 **nice-to-have，可 defer 到 platform-foundations**。这样能在工期压力时保护核心命题不被 backend-only 工作稀释。

---

## 4. 对阶段切分的判断（§5）

### 4.1 肯定：DAG 设计合理，并行窗口判断有依据

Opus §5.3 的 DAG（PP0 → PP1 → {PP2, PP3, PP4} → PP5）和 §6.2 的并行窗口判定（PP2/PP3/PP4 大改域不重合）是合理的。特别是把 PP1（C1+C2）作为串行 bottleneck，符合"scheduler interrupt 路径改完才能验证 hook/connection/reliability"的依赖逻辑。

### 4.2 问题：PP1 的复杂度被系统性低估

Opus §7.2 估算 PP1（C1+C2）为 **14-21 天**。但这个估算没有考虑以下隐藏成本：

**隐藏成本 1：scheduler interrupt 改造不是"加几行代码"**
- 当前 `runtime-mainline.ts` 的 `authorizeToolPlan()` 是同步 verdict（§1.1 LLM-wrapper P0-2：ask 时直接返回 error）
- 要改成 pause-resume，需要：
  1. 在 kernel runner 中引入 `awaitAsyncAnswer()` 或类似 async interrupt point
  2. 修改 `OrchestrationState` 以支持 `confirmation_pending` phase
  3. 修改 `ws-runtime.ts` 的 client message handler，让它能把 confirmation decision 路由回正确的 turn
  4. 处理 race：用户在 confirmation pending 时 send followup_input 或 cancel
  5. e2e 验证：需要模拟 LLM 触发 tool_use → 拦截 confirmation → 模拟用户 decision → 验证 turn resume

这 5 步中，第 1 和第 2 步涉及 agent-core kernel 的最敏感路径（scheduler / state machine），**不是 14-21 天内能安全完成的**。参考 hero-to-pro HP5（Confirmation 收拢）的历程：仅统一 HTTP plane 就花了整整一个 phase，而 pause-resume 比 HTTP plane 复杂 2-3 倍。

**隐藏成本 2：compact 真实装的跨 worker 协调**
- Opus §7.3 已把 "PP1 compact 真实装跨 worker 复杂度低估" 列为最大风险，但估算中未加 buffer
- 真实装意味着：context-core 要提供真实 summary（不是 stub）→ agent-core reducer 要真截消息（不是标记）→ orchestrator-core 要持久化 compact boundary → 前端要能读取 compacted message 的 "已归档" 状态
- 这涉及 3 个 worker + 1 个 package + 前端适配，**14-21 天仅够 proof-of-concept，不够 production-ready**

### 4.3 建议：PP1 拆分为 PP1a 和 PP1b

| Sub-phase | 承担 | 工期 | 与下游关系 |
|---|---|---|---|
| **PP1a** | ask pause-resume（C1）+ elicitation 同模式 + token 预检（轻量版） | 18-25 天 | 阻塞 PP2（Hook PermissionRequest 依赖 confirmation interrupt） |
| **PP1b** | compact 真实装（C2）+ graceful degrade + circuit breaker 真生效 | 14-21 天 | 可与 PP3（Reconnect）部分并行，因为 compact 改的是 context-core/agent-core，reconnect 改的是 orchestrator-core/packages |

**拆分理由**：
1. **降低单点阻塞**：如果 PP1 把 C1 和 C2 捆在一起，一旦 compact 真实装卡壳（高概率），ask pause-resume 也会被拖后，进而阻塞 PP2/PP3/PP4 全部
2. **C1 和 C2 的技术域不同**：C1 改的是 scheduler/state machine（kernel 层），C2 改的是 context management（context-core + reducer 层），虽然都涉及 interrupt，但实现路径不同
3. **工期诚实化**：PP1a 18-25 天 + PP1b 14-21 天 = 32-46 天，比 Opus 的 14-21 天更诚实，虽然看起来更大，但**避免中途发现"估少了"导致的范围蔓延**

---

## 5. 对工作量估算的判断（§7.2）

### 5.1 问题：单工程师串行估算过于乐观

Opus 估算：
- 单工程师串行：60-90 天 ≈ 3-4.5 人月
- 3 工程师并行：35-50 天 ≈ 2.0-2.5 人月

**我的判断**：单工程师串行需要 **90-120 天（4.5-6 人月）**，3 工程师并行需要 **50-70 天（2.5-3.5 人月）**。理由：

1. **PP1 实际工作量**：见 §4.3，PP1a+PP1b 合计 32-46 天，不是 14-21 天
2. **e2e 测试成本被低估**：每个闭环需要 3-5 个 cross-e2e 场景，每个场景从编写到稳定平均 2-3 天（考虑 Cloudflare Workers 的异步特性、D1 状态重置、WS 帧时序 race）。6 个闭环 × 4 场景 × 2.5 天 = 60 天 e2e  alone
3. **文档同步成本**：22-doc → 25-doc 的增量（hooks.md / reconnect.md / reasoning.md）不是"写几页"，而是需要与代码逐条对账、更新 example、跑 check-docs-consistency。每份新 doc 2-3 天，3 份 = 6-9 天
4. **Bugfix 和 regression 缓冲**：任何触及 kernel scheduler 的改动（PP1a）都会引发 10-20% 的 unexpected regression，需要额外 20-30% buffer

### 5.2 建议：采用 "保守估算 + 显式 buffer" 模式

在 PP0 charter 中明确：

```
工作量估算纪律（继承 hero-to-pro §5 方法论）：
1. 基础估算 = 工程师自估 × 1.5（Cloudflare Workers 异步复杂度系数）
2. e2e 成本单独列项，不按"附属工作"打包
3. 每个 phase 预留 20% regression buffer，不挪用
4. 若单 phase 实际超出估算 30%，触发 scope-cut 会议（而非加班追赶）
```

---

## 6. 对入口条件的判断（§5.1 PP0）

### 6.1 问题：缺少 hero-to-pro 真实 debt 盘点

Opus §5.1 定义 PP0 为"前置准备 + charter"，输入是"hero-to-pro full close 或 close-with-known-issues"。但 hero-to-pro 的实际状态是：

- **final closure**: partial-close/7-retained（4 owner-action + 3 cleanup）
- **HPX6 closure**: executed-with-followups（4 项 followup：retry deep semantics、fork deep semantics、DO alarm、package publish）
- **HPX6 code review**: 9 项发现（3 blocker + 3 followup + 3 docs-gap）

这些遗留问题**不是"known-issues"，而是 active debt**。如果 pro-to-product 在入口条件中不明确处理这些 debt，它们会在 PP1-PP4 中突然爆发。

### 6.2 建议：PP0 增加 "Debt Acknowledgement & Entry Gate"

在 PP0 内增加一个强制 gate：

**Gate D1 — Hero-to-Pro Debt Clearance**: 在 pro-to-product 任何代码工作启动前，必须完成以下 debt 的显式登记：

| Debt 来源 | 具体项 | 对 pro-to-product 的影响 | 处理建议 |
|---|---|---|---|
| HPX6 closure followup-1 | retry executor deep semantics 未完成 | PP1a 的 attempt-chain 创建需要基于现有 Queue substrate，但现有 retry handler 为空壳 | 在 PP1a 启动前，必须评估：是基于空壳扩展，还是重写？ |
| HPX6 closure followup-2 | fork executor deep semantics 未完成 | PP3/PP4 的 fork 相关测试需要真实的 child session | 若 PP3 不涉及 fork，可 defer；若涉及，必须在 PP0 内完成 fork handler 基础 |
| HPX6 closure followup-3 | DO alarm 兜底未落地 | PP3 的 detached TTL 依赖 alarm 基础设施 | PP0 内必须决定：复用 HPX6 的 Queue path，还是补 alarm？ |
| HPX6 review R1 | item projection 功能残缺（error 无投影、read 仅支持 tool_call） | C5/C6 的 item 相关测试会失败 | 建议归入 HPX7-C'：在 hero-to-pro 尾端补全 item projection，否则 PP2/PP3 的 e2e 无法通过 |
| HPX6 review R2 | runtime config 无乐观锁 | C4 的 `/runtime` PATCH 测试会 flaky | 建议归入 HPX7-D'：单文件修复，避免 PP4 的 policy 测试被并发问题干扰 |
| HPX6 review R3 | executor-runtime 为空壳 | 直接影响 PP1a 的 retry 和 PP3 的 restore | 必须在 PP0 内明确：executor 骨架是否足够支撑 PP1a，还是需要前置加固？ |

**这个 gate 的价值**：把"hero-to-pro 已关闭"的错觉打破，让 pro-to-product 的工程师在第一天就知道：哪些地基是 solid 的，哪些地基是 plywood 的。

---

## 7. 对分工方案的判断（§6）

### 7.1 肯定：按文件改动域划分是正确思路

Opus §6.1 的表格（按域划分 PP1-PP4 改动量）是可行的并行判断基础。特别是识别出 `runtime-mainline.ts` 是 PP2 与 PP4 的唯一真冲突域，这个判断准确。

### 7.2 问题：1-engineer 场景未考虑认知负荷

Opus §6.4 说"若只有 1 个 reviewer-engineer，整个 pro-to-product 强制串行"。但**串行不是唯一问题**，认知负荷才是：

- PP1a 改 scheduler interrupt（kernel 层，需深度理解 state machine）
- PP2 改 hook dispatcher（hooks 层，需理解 registry/dispatcher/runtime 三角）
- PP3 改 reconnect protocol（connection 层，需理解 WS frame lifecycle + DO storage + replay buffer）
- PP4 改 LLM wrapper（wrapper 层，需理解 Workers AI gateway + token estimation + fallback chain）

这 4 个层的技术栈**几乎没有重叠**。一个工程师若要在 3-4 个月内切换 4 次上下文，每次都需要 3-5 天的"重新加载"时间。Opus 的 60-90 天估算**未包含上下文切换成本**。

### 7.3 建议：1-engineer 场景增加 "层固化" 策略

若确实只有 1 名工程师，建议不是严格串行 PP1→PP2→PP3→PP4，而是**按层固化**：

```
Engineer X — "Kernel + State Machine 专家":
  连续承担 PP1a（ask interrupt）+ PP2（Hook dispatcher 接入 kernel）
  因为两者都在 agent-core kernel/scheduler 层，上下文不切换

然后切换为 "Connection + Protocol 专家":
  连续承担 PP1b（compact 真实装）+ PP3（Reconnect）
  因为两者都涉及 message lifecycle + DO storage

最后切换为 "Wrapper + Policy 专家":
  承担 PP4（Reliability + Policy）
```

这样总工期可能从 90-120 天降到 75-100 天（减少 2-3 次上下文切换），但** charter 中需要明确说明这种层固化策略**。

---

## 8. 对风险缓解的判断（§7.3）

### 8.1 问题：风险列表缺少 "如果发生 X，则做 Y" 的 contingency

Opus §7.3 列出了 6 条风险，但缓解策略都是方向性的（如"PP0 内必须先写 compact design doc"），缺少**量化的触发条件和 fallback 路径**：

- 若 compact design doc 评审发现"reducer 真截消息"不可行（如会破坏 cross-turn history），**scope-cut 的底线是什么**？是"接受 compact 只标记不截断"，还是"必须截断否则 PP1b 不 closure"？
- 若 PP1a 的 scheduler interrupt 改造导致 regression > 20%，**是否允许回滚到同步 verdict + 把 pause-resume defer 到 platform-foundations**？
- 若 Hook dispatcher 与 HPX6 的 `D1PermissionRulesPlane` 冲突（§7.3 风险 2），**仲裁原则是什么**？是"hook 优先"还是"permission_rules 优先"？

### 8.2 建议：为 Top-3 风险增加 "Contingency Contract"

在 PP0 charter 中，为以下 3 个最高风险增加显式 contingency：

**Risk 1 — PP1 compact 不可行**
- Trigger：PP0 compact design doc 评审未通过，或 PP1b 第 10 天仍无 working PoC
- Fallback：compact 降级为 "advisory-only"（只 emit `compact.notify`，不真截消息）+ 把 "真截断" 明确 defer 到 platform-foundations
- Impact：C2 闭环不完整，但 frontend 仍可通过 advisory 信号手动触发 compact

**Risk 2 — PP1a scheduler interrupt regression 过高**
- Trigger：PP1a e2e 中现有场景 regression > 30% 或新增 flaky test > 5 个
- Fallback：ask 路径保持同步 error-out，但增加 `confirmation_uuid` 生成 + row-create（让前端能 polling 拉取 confirmation 状态）+ 把真 pause-resume defer 到 platform-foundations
- Impact：C1 闭环降级为 "polling-based HITL"，非实时但仍可用

**Risk 3 — PP2 Hook 与 permission_rules 冲突**
- Trigger：PP2 第 5 天仍无法确定仲裁顺序
- Fallback：固定顺序 `hook → permission_rules → approval_policy`，并在 `/runtime` PATCH 中增加 `hook_enabled: boolean` 字段让用户可关闭 hook 层
- Impact：C5 闭环延迟，但 C4 的 policy 闭环不受影响

---

## 9. 对遗漏维度的判断

### 9.1 遗漏 1：前端团队的介入时点

Opus 草案全程从 backend 视角出发，但 pro-to-product 的核心命题是"**前端可搭建**"。**前端团队什么时候介入？**

- 若前端在 PP5 才介入，会发现 PP1-PP4 的"用户直接感知"设计不符合前端实际消费方式（如 frame 时序、error handling、loading state）
- 若前端在每个 PP 都介入，会增加沟通成本，但能保证"backend 改完 = frontend 能立刻用"

**建议**：在 PP0 charter 中明确前端介入节奏：

```
Frontend Engagement Schedule:
- PP0: 前端 lead 参与 charter 评审，确认 6 闭环的 user-visible 定义
- PP1a 中期（第 10 天）: 前端接入 confirmation interrupt 的 mock，编写 UI prototype
- PP2 启动日: 前端同步启动 hook status bar UI 设计
- PP3 启动日: 前端同步启动 reconnect / auto-reconnect UI 设计
- PP4 中期: 前端接入 fallback / retry 的 toast/notification 设计
- PP5: 前端 full integration test，产出 "frontend demo 可跑" 证据
```

### 9.2 遗漏 2：性能基准和 SLA

Opus 草案中没有提到 pro-to-product 是否需要定义性能基准。但以下工作直接影响性能：

- PP1b compact 真实装：如果 compact 耗时 > 5s，前端会感知到"agent 卡住了"
- PP3 reconnect：如果 replay buffer 恢复后重放 1000 个 frame 耗时 > 3s，重连体验会很差
- PP4 retry：如果 LLM retry 的 backoff 策略不合理，会浪费配额

**建议**：在 PP0 内定义 pro-to-product 的**可观测性基准**（不是 SLA，而是"frontend 不卡"的阈值）：

| 场景 | 阈值 | 测量方式 |
|---|---|---|
| confirmation interrupt 延迟 | ≤ 500ms（用户点击 allow → agent resume） | cross-e2e 计时 |
| compact 执行延迟 | ≤ 3s（用户触发 compact → compact.notify completed） | cross-e2e 计时 |
| reconnect 重放延迟 | ≤ 2s（WS attach → 最后一条历史 frame 推送完毕） | cross-e2e 计时 |
| retry 首次响应延迟 | ≤ 1s（retry 触发 → turn.begin emit） | cross-e2e 计时 |

### 9.3 遗漏 3：hero-to-pro 7-retained 的清理验证

hero-to-pro final closure 的 7 项 retained（§3）中，有 4 项是 owner-action（manual evidence、prod baseline、reviewer memos、R28 runbook）。这些 retained 的 `next review date` 是 2026-05-11 至 2026-05-15。

**如果 pro-to-product 在 2026-05-15 之前启动**，这 4 项 retained 可能仍处于未解决状态。Opus 草案没有讨论：
- 这些 retained 是否阻塞 pro-to-product 启动？
- 若不阻塞，如何在 pro-to-product 的 final closure 中处理它们（因为它们是 hero-to-pro 的 debt，但可能拖到 pro-to-product 结束还没解决）？

**建议**：在 PP0 的入口条件中增加 **Gate D2 — Hero-to-Pro Retained Non-Block Verification**：

```
必须显式声明以下 retained 不阻塞 pro-to-product：
1. manual evidence pack → 理由：纯 evidence，不影响代码行为
2. prod schema baseline → 理由：preview 环境已验证；prod 由 owner 独立处理
3. reviewer memos → 理由：docs 已 frozen；reviewer memo 是 process debt 不是 product debt
4. R28 runbook → 理由：Lane E 已决定 permanent fallback（若未决定，则必须在 PP0 前决定）

若 owner 不同意上述声明，pro-to-product 启动推迟至 retained 清理完毕。
```

---

## 10. 对 Opus 草案的总体修正建议

### 10.1 建议采纳（无异议）

| 项 | 理由 |
|---|---|
| 命题转换（hero-to-platform → pro-to-product） | 方向正确，避免横向扩张 |
| 6 闭环框架（C1-C6） | 覆盖了 9 份报告的 P0 共识 |
| HPX7 存在必要性 | hero-to-pro 需要诚实收尾，不能无限延伸 |
| PP2/PP3/PP4 并行窗口 | 大改域不重合，有并行依据 |
| Cloudflare 约束评估 | 务实，不阻塞核心闭环 |
| PP5 输出 platform-foundations stub | 继承 hero-to-pro HP10 模式 |

### 10.2 建议修正（需调整）

| 项 | 原草案 | 修正建议 |
|---|---|---|
| HPX7 范围 | 8 项，7-12 天 | **4 项，2 天**；删除 replay buffer、reasoning 区分、docs drift guard |
| PP1 范围 | C1+C2 合并，14-21 天 | **拆分为 PP1a（C1，18-25 天）+ PP1b（C2，14-21 天）**；降低单点阻塞 |
| PP0 内容 | charter + closing-thoughts，3-5 天 | **增加 debt 盘点（3 天）+ 前端介入计划（1 天）+ contingency contract（1 天）**；总计 8-12 天 |
| 工作量估算 | 单工程师 60-90 天 | **90-120 天**；含 e2e 单独列项、regression buffer、上下文切换 |
| 风险缓解 | 方向性描述 | **增加 3 个 Top Risk 的量化 trigger + fallback path** |
| 入口条件 | "hero-to-pro full close" | **改为 "hero-to-pro partial-close/7-retained + debt acknowledgement gate passed"** |
| 用户感知度 | 无显式分类 | **增加 must-have/should-have/nice-have 三级分类** |
| 前端介入 | 无 | **增加 Frontend Engagement Schedule** |
| 性能基准 | 无 | **增加可观测性基准（4 个阈值）** |

### 10.3 建议新增（原草案未覆盖）

| 项 | 内容 | 落点 |
|---|---|---|
| Debt Acknowledgement Gate | 登记 HPX6 closure followups + HPX6 review findings + hero-to-pro 7-retained | PP0 强制 gate |
| Layer-Consolidation Strategy | 1-engineer 场景按层固化（kernel→connection→wrapper），减少上下文切换 | PP0 charter §6.4 替代方案 |
| Contingency Contract | Top-3 风险的 trigger + fallback + impact 显式化 | PP0 charter §7.3 |
| Frontend Engagement Schedule | 前端在 PP0/PP1a/PP2/PP3/PP4/PP5 的介入时点 | PP0 charter §8 |
| Observability Baseline | 4 个用户感知阈值（confirmation interrupt / compact / reconnect / retry） | PP0 charter §9 |
| Hero-to-Pro Retained Non-Block Verification | 7-retained 中哪些不阻塞 pro-to-product，哪些阻塞 | PP0 入口条件 |

---

## 11. 一句话总结

> **Opus 的 pro-to-product 草案在"做什么"和"为什么做"上判断准确，但在"怎么做"、"花多久"、"如果不行怎么办"三个执行维度上过于乐观。我的建议是：接受命题和闭环框架，但把 HPX7 压缩到 2 天诚实收尾、把 PP1 拆分为两个 sub-phase、把 PP0 扩展为包含 debt 盘点和 contingency contract 的 8-12 天准备期、把工作量估算上调 30-50%。pro-to-product 的成功不在于"做得快"，而在于"诚实地承认 hero-to-pro 留下了 plywood 地基，并在加固地基后再盖楼"。**

---

*本审查完全基于 kimi 独立阅读文档和代码后的推理，未参考其他同事的分析报告。*
