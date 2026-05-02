# Pro-to-Product Closing Thoughts by GPT

> **文档性质**: `eval / closing-thoughts`
> **定位**: 进入 `plan-pro-to-product.md` 基线 charter 撰写前的最后一次综合回顾
> **直接输入**:
> - `docs/eval/pro-to-product/re-planning-by-opus.md`
> - `docs/eval/pro-to-product/re-planning-reviewed-by-deepseek.md`
> - `docs/eval/pro-to-product/re-planning-reviewed-by-kimi.md`
> - `docs/eval/pro-to-product/re-planning-reviewed-by-GPT.md`
> - `docs/issue/hero-to-pro/HPX7-closure.md`
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
> - `docs/charter/plan-hero-to-pro.md` §16
> **方法**: 以 HPX7 完成后的当前代码与最新 closure 为事实锚点；吸收同事 review 中合理、可执行、与现实耦合面一致的部分，不按 owner 偏好做倒推
> **日期**: `2026-05-02`

---

## 0. TL;DR

我的最终结论是：

> **pro-to-product 不需要沿用 Opus 当前那套 7-phase + 13 design + 26 review 的重文档方案，也不适合压缩成 Kimi 提议的 4 个超大 phase。最合理的落点，是一个“6-phase、7-design、e2e-first、batch-review”的轻量基线。**

这套基线的核心判断有 4 条：

1. **HPX7 已经把起点洗干净了**：hero-to-pro 现在是 `close-with-known-issues / 4 owner-action retained`，工程侧 retained 已经不再是本阶段入口负担（`docs/issue/hero-to-pro/hero-to-pro-final-closure.md:21-30`; `docs/issue/hero-to-pro/HPX7-closure.md:14-19,73-80`）。
2. **真正的主矛盾仍然是 live caller / truth gap，不是 endpoint 数量**：`approval_policy=ask` 仍然 error-out，compact 仍然 `{ tokensFreed: 0 }`，replay restore 仍然不恢复 helper buffer，HookDispatcher 仍是 substrate injected 但 caller 未接通（`workers/agent-core/src/host/runtime-mainline.ts:235-261,833-836`; `workers/agent-core/src/host/do/session-do-runtime.ts:378-397`; `workers/agent-core/src/host/do/session-do-persistence.ts:154-160,193-222`; `packages/nacp-session/src/replay.ts:58-73`; `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:155-160,191-196`）。
3. **DeepSeek 对“phase 大体正确，但文档生产过度”的判断是成立的**；尤其是 PP6 作为“杂物抽屉”、26 份逐文档 review、PP0 前置 18-23 天，这些都不该保留（`docs/eval/pro-to-product/re-planning-reviewed-by-deepseek.md:13-14,29-40,63-80,166-194,198-216`）。
4. **Kimi 对“HPX7 后起点更干净、debt gate 应删除、design 数量要瘦身”的判断是成立的**；但他把 HITL + Context + Hook 合并成一个超大 PP1，我不认同。共享 interrupt framework 是对的，但它更适合做 **设计法则**，不适合直接把 critical path 压成一个巨型 phase（`docs/eval/pro-to-product/re-planning-reviewed-by-kimi.md:108-135,148-183,187-239,243-268`）。

因此，我给出的最终到达点是：

- **Phase**：`PP0 + PP1 + PP2 + PP3 + PP4 + PP5`
- **Design**：全部收敛到 `docs/design/pro-to-product/` 下，**7 份**
- **治理**：truth gate 保留；debt gate 删除；review 改成 batch；PP0 必须产出首个 e2e skeleton

---

## 1. HPX7 完成后，我们真正站在什么起点上

这一步必须先说清楚。否则后面的 phase / design / 工期判断都会继续建立在过时前提上。

### 1.1 现在的起点，不再是“hero-to-pro 还差一堆 engineering debt”

HPX7 之后，`hero-to-pro` 的总 verdict 已经变成：

- `close-with-known-issues / 4-owner-action-retained-with-explicit-remove-condition`
- retained 的 4 项都属于 owner-action，而不是 engineering work
- 工程侧 honesty / residual / cleanup blocker 已在 HPX7 内完成 reclassification（`docs/issue/hero-to-pro/hero-to-pro-final-closure.md:21-30`; `docs/issue/hero-to-pro/HPX7-closure.md:36-41,73-80`）

charter §16 也已经把这个新起点写明：hero-to-pro 的实际完成面，现在是 **在不打破 6-worker 基石的前提下，达到 workbench-grade agent loop backend substrate**，并且 HPX7 已把 closure honesty 一层补齐（`docs/charter/plan-hero-to-pro.md:1339-1367`）。

这意味着：

1. **不再需要 Debt Acknowledgement Gate（D1）**
2. **不再需要 Retained Non-Block Gate（D2）**
3. **不再需要单独的 debt-matrix / deferral-matrix 文档**

这三条，我同时吸收了 Kimi 与 DeepSeek 的合理意见。

### 1.2 但“前端可信”这层 gap 仍然是真 gap

HPX7 并没有把 pro-to-product 本身做掉。它只是在进入下一个阶段前，把 deception 和 residual truth gap 收平了。

当前代码里仍然有 5 条非常硬的 live gap：

1. `authorizeToolPlan()` 在 `ask/deny` 时仍然直接 error-out，而不是 pause-resume（`workers/agent-core/src/host/runtime-mainline.ts:235-261`）。
2. `emitPermissionRequestAndAwait()` 明明已存在，但仍是 substrate，没有 live caller（`workers/agent-core/src/host/do/session-do-runtime.ts:378-397`）。
3. `buildExecutionRequest()` 只做 capability validation，不做 token/context-window preflight（`workers/agent-core/src/llm/request-builder.ts:34-120`）。
4. `requestCompact()` 仍然直接返回 `{ tokensFreed: 0 }`（`workers/agent-core/src/host/runtime-mainline.ts:833-836`）。
5. replay checkpoint 已写盘，但 `restoreFromStorage()` 仍不恢复 helper replay；过旧 seq 仍直接 throw（`workers/agent-core/src/host/do/session-do-persistence.ts:154-160,193-222`; `packages/nacp-session/src/replay.ts:58-73`）。

因此，**pro-to-product 的核心命题仍然成立**：

> 不是再去建新的 substrate，而是把已有 substrate 接成前端可信的 live loop。

---

## 2. 我吸收了哪些同事意见，哪些没有吸收

这里不做“谁对谁错”的裁判，而只谈**哪些意见能提升下一版 baseline charter 的可执行性**。

### 2.1 来自 DeepSeek，我明确吸收的 4 点

1. **Phase 主干大体成立，但 PP6 是个杂物抽屉**  
   这一点我完全同意。把 observability、reasoning stream、final closure 混成一个 phase，会把 phase 边界做糊（`docs/eval/pro-to-product/re-planning-reviewed-by-deepseek.md:29-40`）。

2. **PP3 不应在 PP0 结束后立即启动，而应等 PP1 的 `session-do-runtime.ts` 改动稳定**  
   这条非常实用。PP1 和 PP3 虽然不是同一条业务线，但都碰 `session-do-runtime.ts`，完全“立即并行”会制造无意义的 merge churn（`docs/eval/pro-to-product/re-planning-reviewed-by-deepseek.md:51-57`）。

3. **逐文档 26 份 review 是明显过度**  
   我同意改成 batch review。truth gate 是技术动作，不是 review 数量动作（`docs/eval/pro-to-product/re-planning-reviewed-by-deepseek.md:166-194,312-324`）。

4. **PP0 要有首个 e2e skeleton，而不是只产设计文档**  
   这一点我也吸收。因为 pro-to-product 的第一性原理不是“先把设计写完”，而是“先用一个真实 loop 把 substrate 的真断点打出来”（`docs/eval/pro-to-product/re-planning-reviewed-by-deepseek.md:285-308`）。

### 2.2 来自 Kimi，我明确吸收的 4 点

1. **HPX7 完成后，起点比 re-planning 假设得更干净**  
   这是成立的，已经成为本轮 closing-thoughts 的前提（`docs/eval/pro-to-product/re-planning-reviewed-by-kimi.md:108-135`）。

2. **governance 维度要减肥**  
   6 truth gate 保留，但用户感知矩阵、前端 schedule、性能阈值、组织模型，都应该内嵌到 charter 表格或章节里，而不是再衍生一串独立文档（`docs/eval/pro-to-product/re-planning-reviewed-by-kimi.md:328-345`）。

3. **design 数量必须砍掉**  
   我同意，但不是砍到 4-phase 那么激进。我会保留 phase 切分，只砍文档生产（`docs/eval/pro-to-product/re-planning-reviewed-by-kimi.md:46-68,243-268`）。

4. **前端介入时点应该变少、变明确**  
   我同意把 6 个时点压成 3 个关键时点（`docs/eval/pro-to-product/re-planning-reviewed-by-kimi.md:168-177`）。

### 2.3 我没有吸收的部分：4-phase 巨型合并

Kimi 提议把：

- HITL + Context + Hook 合并成一个 Core Product Loop phase
- Reconnect + Reliability 合并成一个 Connection & Recovery phase
- Policy + Observability + Final 合并成最后一个 Product Polish phase（`docs/eval/pro-to-product/re-planning-reviewed-by-kimi.md:187-239`）

我不采用这个结构。原因有两个：

1. **shared interrupt framework ≠ 应该合成同一个 phase**  
   HITL / Context / Hook 的确共享 interrupt 框架，但它们的 owner file、交付对象、验收风险仍不同。共享框架更适合写进 cross-cutting design，而不是直接把 critical path 压成一个大 phase。
2. **Hook 仍然是独立的 productization seam**  
   当前 HookDispatcher 只是 substrate injected，production register source 与 frontend-visible loop 都还没成立（`workers/agent-core/src/host/do/session-do/runtime-assembly.ts:155-160,191-196`; `workers/agent-core/src/hooks/snapshot.ts:42-53`）。这条工作若并入 PP1，极容易把 PP1 再次做成“大 phase 里半闭合、半骨架”的老问题。

所以，我吸收 Kimi 的**减肥思想**，但不吸收他的 **4-phase 合并结构**。

---

## 3. 我最终到达的 Phase 划分

### 3.1 最终推荐：6-phase 轻量基线

我建议用下面这个版本进入 baseline charter：

| Phase | 名称 | 核心职责 | 预计工期（单工程师） |
|---|---|---|---:|
| **PP0** | Charter & Truth Lock | reality snapshot、6 truth gates、D1 freeze 例外、首个 e2e skeleton、cross-cutting truth model 冻结 | 5-8 天 |
| **PP1** | HITL Interrupt Closure | `approval_policy=ask` / elicitation / confirmation pause-resume / allow-deny-timeout 三态闭环 | 15-22 天 |
| **PP2** | Context Budget Closure | token preflight、real compact、prompt mutation、overflow degrade | 15-22 天 |
| **PP3** | Reconnect & Session Recovery | replay restore、lagged contract、detached policy、session state snapshot | 10-16 天 |
| **PP4** | Hook Delivery Closure | PreToolUse 真走 HookDispatcher、最小 live register source、最小 frontend-visible hook loop | 8-14 天 |
| **PP5** | Policy Honesty + Reliability Hardening + Final Closure | `/runtime` 三字段 enforce-or-downgrade、fallback/retry surface、docs/observability audit、final closure | 12-18 天 |

**总计单工程师**：约 **65-100 天**  
**3 工程师并行**：约 **35-55 天**

这个数字明显低于 Opus 的 101-146 天，也高于 initial 的 60-90 天，基本吸收了 Kimi/DeepSeek 对“文档和 governance overhead 被高估”的批评，同时保留了我认为仍然必要的 phase 分离。

### 3.2 为什么不是 7 phase

因为 **PP6 作为独立 phase 没必要保留**。

Observability push 的 schema 与验收要求，应该提前冻结在 cross-cutting contract 中；具体实现跟着 owning phase 走；final closure 则是治理动作，不是一个独立的 feature bucket。DeepSeek 对 PP6 “杂物抽屉”的批评，我认为是成立的（`docs/eval/pro-to-product/re-planning-reviewed-by-deepseek.md:29-40`）。

### 3.3 为什么不是 4 phase

因为 **critical path 会重新被做大**。

HITL、Context、Hook 虽共享 interrupt framework，但并不共享同一层实现面；把它们合成一个大 PP1，会把 charter / action-plan / closure 重新推回“一个 phase 内部做 3 件强耦合但不同交付的事”。这正是我们刚在 hero-to-pro 尾端想避免的口径风险。

### 3.4 最终 DAG

```text
PP0
 └─→ PP1
      ├─→ PP2
      ├─→ PP3   (在 PP1 的 session-do-runtime 改动稳定后启动)
      └─→ PP4   (依赖 PP1 的 confirmation / interrupt substrate)

PP2 + PP3 + PP4
 └─→ PP5
```

解释：

1. **PP2 依赖 PP1**：需要先冻结 interrupt substrate，Context 才能决定 compact / overflow 是走自动恢复还是 confirmation。
2. **PP3 不必等 PP1 完全 closure**：但应等 PP1 在 `session-do-runtime.ts` 上的关键改动稳定后再并行。
3. **PP4 依赖 PP1，不依赖 PP2**：Hook delivery 的最小闭环首先咬的是 confirmation / interrupt substrate，而不是 compact。
4. **PP5 放在最后**：因为 policy honesty、reliability hardening、docs/final closure 更适合作为 endgame hardening。

---

## 4. 最终的具体分工设计

### 4.1 每个 phase 的工作边界

#### PP0 — Charter & Truth Lock

必须交付 5 件事：

1. `plan-pro-to-product.md` 初版
2. 6 truth gates 冻结
3. D1 freeze 例外 law 冻结
4. 首个 e2e skeleton（至少 HITL 或 reconnect 其一）
5. `docs/design/pro-to-product/00-*` 与 `01-*` 两份 cross-cutting design

**不做**：大规模前置 per-phase design、debt matrix、review matrix

#### PP1 — HITL Interrupt Closure

必须闭合：

1. `approval_policy=ask` 不再 error-out
2. permission / elicitation 进入 pause-resume loop
3. allow / deny / timeout 三态可观测
4. `confirmation_pending` 状态在 runtime/closure 中有真实含义

#### PP2 — Context Budget Closure

必须闭合：

1. token/context-window preflight
2. compact 真执行而不是 `{ tokensFreed: 0 }`
3. compact 后 prompt 真变化
4. overflow graceful degrade 有明确 contract

#### PP3 — Reconnect & Session Recovery

必须闭合：

1. helper replay 真恢复
2. out-of-range 不再直接 throw 给前端
3. detached running turn 有明确 policy
4. 客户端重连能知道 session 当前状态

#### PP4 — Hook Delivery Closure

必须闭合：

1. PreToolUse 真经过 HookDispatcher
2. 至少一个 live register source
3. 至少一个 frontend-visible hook path
4. 与 permission_rules / approval_policy 的仲裁顺序明确

#### PP5 — Policy Honesty + Reliability Hardening + Final Closure

必须闭合：

1. `network_policy / web_search / workspace_scope` enforce-or-downgrade
2. fallback / retry / stream recovery 的最小 first-class surface
3. docs / observability / metrics audit
4. final closure 与下一阶段 handoff

### 4.2 推荐的 3 工程师分工

| 角色 | 主承担 | 次承担 |
|---|---|---|
| **A — Core Loop** | PP1 → PP2 | PP4 技术评审 |
| **B — Session Recovery** | PP3 → PP4 | PP1 后半的 session-do-runtime 对齐 |
| **C — Policy / Test / Closure** | PP0 → PP5 | cross-e2e / docs / observability 骨架 |

这套分法比 Opus 的文档生产型分工更直接：**按技术面分，不按文档层分。**

### 4.3 单工程师模式

如果只有 1 位工程师，我建议顺序是：

```text
PP0 → PP1 → PP2 → PP3 → PP4 → PP5
```

不要再按 Kimi 的“大 phase 合并”走，而是保留 6-phase，只在执行上减少切换：

- 先把 PP1 的 interrupt substrate 彻底稳定
- 再做 PP2 的 budget/compact
- 再做 PP3 的 reconnect/recovery
- 再做 PP4 hook
- 最后做 PP5 hardening/closure

这样 cognitive load 最低，也最符合当前代码的 owner file 分布。

---

## 5. 最终的 design 文件方案（全部收敛到 `docs/design/pro-to-product/`）

这是我认为最关键的落点之一。**design 要保留，但必须瘦身，而且必须全部集中到同一目录。**

### 5.1 最终保留：7 份 design

| # | 文件 | 作用 | 对应阶段 |
|---|---|---|---|
| 1 | `docs/design/pro-to-product/00-agent-loop-truth-model.md` | 定义 D1 / DO storage / DO memory 在 6 个闭环中的职责分层 | PP0 / 跨 phase |
| 2 | `docs/design/pro-to-product/01-frontend-trust-contract.md` | 定义前端可见 contract、truth gates、observability baseline、stored-not-enforced 边界 | PP0 / 跨 phase |
| 3 | `docs/design/pro-to-product/02-hitl-interrupt-closure.md` | HITL interrupt 的状态机、pause-resume、timeout、race | PP1 |
| 4 | `docs/design/pro-to-product/03-context-budget-closure.md` | token preflight、compact、prompt mutation、overflow degrade | PP2 |
| 5 | `docs/design/pro-to-product/04-reconnect-session-recovery.md` | replay restore、lagged contract、detached policy、session state snapshot | PP3 |
| 6 | `docs/design/pro-to-product/05-hook-delivery-closure.md` | PreToolUse 接线、register source、frontend-visible hook path、permission interlock | PP4 |
| 7 | `docs/design/pro-to-product/06-policy-reliability-hardening.md` | enforce-or-downgrade、fallback/retry surface、docs/obs/final hardening | PP5 |

### 5.2 为什么是 7 份，而不是 13 份

因为我吸收了两位同事的共同批评：

1. **不能再写“文档-about-文档”**  
   不再需要 debt-matrix、deferral-matrix、独立 honesty-contract、独立 observability-baseline。
2. **但也不能把高风险 phase 完全丢给 action-plan**  
   PP1-PP5 各自仍有不同的技术边界和 owner file，仍然值得有一份 design 先锁边界。

所以最后保留的是：

- **2 份 cross-cutting**
- **5 份 per-phase**

合计 **7 份**

### 5.3 为什么不再额外写 architecture/contract 子目录文档

因为你已经明确倾向于把 design 都放在 `docs/design/pro-to-product/` 下。我认同这个偏好。

对于这一阶段来说：

- 目录统一有助于减少文档谱系分叉
- cross-cutting doc 与 per-phase design 在同目录里，更方便 phase author 直接消费
- future charter / action-plan / closure 引用路径会更稳定

所以我的最终建议是：

> **除 `docs/eval/` 下的评审/closing-thoughts 和未来 `docs/charter/plan-pro-to-product.md` 外，所有设计文件都集中到 `docs/design/pro-to-product/`。**

---

## 6. Governance 怎么收，不怎么长

这一段是为了明确：我们不是放弃治理，而是把治理压回**真正有价值的位置**。

### 6.1 保留的治理动作

1. **6 truth gates**
2. **D1 freeze 受控例外**
3. **Top-3 contingency**
4. **3 个前端介入时点**
5. **batch review**

### 6.2 删除或下沉的治理动作

1. 删除 **Debt Acknowledgement Gate**
2. 删除 **Retained Non-Block Gate**
3. 不再单列 **honesty-contract.md**
4. 不再单列 **observability-baseline.md**
5. 不再做 **26 份逐文档 review**

### 6.3 最终 review 模型

我建议用 **4 次 batch review**：

1. **PP0 package review**：charter + `00` + `01`
2. **PP1+PP2 review**
3. **PP3+PP4 review**
4. **PP5/final closure review**

这比 26 份逐文档 review 更符合 hero-to-pro 后期的真实经验。

### 6.4 前端介入时点（最终版）

只保留 3 个：

1. **PP0 末**：review charter 与 frontend trust contract
2. **PP1 中**：开始对 confirmation / pause-resume UI 做真实接线
3. **PP3 中**：开始对 reconnect / session state restore UI 做真实接线

其余阶段的前端参与自然跟随，不单列 milestone。

---

## 7. 最终判断

如果我要把这次 closing-thoughts 压缩成一句话，那就是：

> **我们已经不需要再花一轮大文档，把“为什么要做 pro-to-product”证明一遍；HPX7 已经把起点校干净了。现在要做的，是用一套更轻、更硬、更贴代码耦合面的 6-phase / 7-design 基线，把已有 substrate 接成前端可信的 live agent loop。**

因此，进入 baseline charter 撰写前，我的最终裁决是：

1. **采纳** Opus 的主干方向：`pro-to-product` 命题成立；PP1/PP2 拆分成立；PP3 在 PP4 前成立。
2. **采纳** DeepSeek 的关键修正：PP6 删除、PP0 压缩、e2e-first、batch review、PP3 延后到 PP1 关键文件稳定后启动。
3. **采纳** Kimi 的关键修正：HPX7 后的 clean-start 判断、debt gate 删除、governance 减肥、front-end 时点压缩。
4. **不采纳** Kimi 的 4-phase 巨型合并。
5. **不采纳** Opus 的 13 design / 26 review / 18-23 天 PP0。

**最终到达点**：

- **Phase**：6
- **Design**：7（全部在 `docs/design/pro-to-product/`）
- **Review**：4 个 batch
- **PP0**：5-8 天，且必须包含首个 e2e skeleton

这就是我认为最合理、也最适合作为 `plan-pro-to-product.md` 前一站的结论。
