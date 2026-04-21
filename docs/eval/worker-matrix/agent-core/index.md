# agent.core 上下文索引

> 状态：`curated / rewritten`
> 目标：作为 `docs/eval/worker-matrix/agent-core/` 的入口索引，同时提供**原始素材召回路径**、**范围边界**、**当前结论**与**阅读顺序**。

---

## 0. 一句话结论

**`agent.core` 不是一个待发明的 future worker，而是一个已经以 `session-do-runtime + NanoSessionDO` 形式存在的 host worker；worker-matrix 阶段真正要做的，不是“再造 host 壳”，而是把已有的 session host、kernel、llm、hooks、capability、workspace、evidence 主链接成默认运行真相。**

---

## 1. In-Scope / Out-of-Scope

### 1.1 In-Scope

本目录只负责回答下面四类问题：

| 项目 | 说明 |
|---|---|
| `agent.core` 的定位 | 它是不是 host worker、是不是 binding slot、是不是上游 orchestrator |
| `agent.core` 的协议责任 | 它必须遵守哪些 `NACP-Core / NACP-Session / tenant / trace / replay` 法则 |
| `agent.core` 的当前代码真相 | 当前仓库里已经有什么、还缺什么、哪些只是 transport handle |
| `agent.core` 的平台边界 | Cloudflare / Durable Object / service binding / DO storage cap / header law 对它的直接约束 |

### 1.2 Out-of-Scope

本目录**不**承担下面这些工作：

| 项目 | 为什么不在这里做 |
|---|---|
| 设计 `bash.core / filesystem.core / context.core` 的全部细节 | 它们各自需要独立上下文包 |
| 重写 B8/B9 原始历史文档 | 原始文档仍是历史审计路径，本目录只做聚合与裁判 |
| 先行决定 worker-matrix v2 binding catalog | `agent.core != binding slot`，binding catalog 是另一层决策 |
| 把 `agent.core` 重新提升成“长期记忆 / 意图路由 / 用户画像 orchestrator” | 这与 `initial_context` 的 upstream seam 相冲突 |

---

## 2. 证据优先级

本目录采用下面这条优先级，解决 B8/B9 历史文档之间的口径漂移：

1. **当前仓库源码与当前测试**
2. **原始 handoff / review / evaluation 文档**
3. **`context/` 下的参考实现**
4. **较早的 closure 口径**

这条优先级在 `agent.core` 上尤其关键，因为：

- 早期 B9 review 曾经记录过 `verifyTenantBoundary()` 是 fire-and-forget；
- 当前代码已经前进到 `NanoSessionDO.acceptClientFrame()` 显式 `await verifyTenantBoundary(...)` 并在失败时阻止 dispatch：`packages/session-do-runtime/src/do/nano-session-do.ts:481-533`；
- 因此本目录必须以**当前代码真相**作为最终裁判，而不能只复述历史 review。

---

## 3. 原始素材总索引

> 下面列的都是**原始路径**，不是 `docs/eval/worker-matrix/00-context/` 里的复制品。

### 3.1 原始文档素材

| 类型 | 原始路径 | 关键行 / 章节 | 为什么必读 |
|---|---|---|---|
| handoff | [`docs/handoff/after-foundations-to-worker-matrix.md`](../../../handoff/after-foundations-to-worker-matrix.md) | `§4-§6, §9-§11` / `76-135, 176-242, 250-260` | 定义 `agent.core != binding slot`、worker naming、binding catalog policy、B9 pre-req |
| action-plan | [`docs/action-plan/after-foundations/B8-worker-matrix-pre-convergence.md`](../../../action-plan/after-foundations/B8-worker-matrix-pre-convergence.md) | `46-66, 74-85, 152-188` | B8 对 worker-matrix 的原始目标、边界与不变量 |
| closure | [`docs/issue/after-foundations/B8-phase-1-closure.md`](../../../issue/after-foundations/B8-phase-1-closure.md) | `38-56, 59-118` | B1-B7 到 B8 的平台事实盘点，尤其是 binding / DO cap / R2 并发数字 |
| review | [`docs/code-review/after-foundations/B9-plan-reviewed-by-GPT.md`](../../../code-review/after-foundations/B9-plan-reviewed-by-GPT.md) | `37-61, 77-110, 173-220` | 为什么 B9 必须存在，以及它应该如何缩 scope |
| review | [`docs/code-review/after-foundations/B9-reviewed-by-GPT.md`](../../../code-review/after-foundations/B9-reviewed-by-GPT.md) | `41-70, 84-167` | B9 初始实现 review；需与当前代码真相交叉阅读 |
| evaluation | [`docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`](../../../eval/after-foundations/worker-matrix-eval-with-GPT.md) | `132-177` | GPT 对 `agent.core` “最成熟 first-wave worker”的原始判断 |
| evaluation | [`docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`](../../../eval/after-foundations/worker-matrix-eval-with-Opus.md) | `78-84, 171-198` | Opus 对 `agent.core READY`、`kernel: undefined` 的原始判断 |
| evaluation | [`docs/eval/after-foundations/smind-contexter-learnings.md`](../../../eval/after-foundations/smind-contexter-learnings.md) | `31-45, 136-145, 214-229, 241-257` | 说明为什么要把 upstream orchestrator 与 host runtime 分层理解 |

### 3.2 当前仓库代码素材

| 类型 | 原始路径 | 关键行 | 为什么必读 |
|---|---|---|---|
| host entry | [`packages/session-do-runtime/src/worker.ts`](../../../../packages/session-do-runtime/src/worker.ts) | `15-18, 72-88` | 证明 Worker entry 已存在，而且是薄转发壳 |
| host core | [`packages/session-do-runtime/src/do/nano-session-do.ts`](../../../../packages/session-do-runtime/src/do/nano-session-do.ts) | `130-280, 466-715, 906-1112` | 证明真实宿主就是 `NanoSessionDO`，并展示 ingress / dispatch / checkpoint / evidence / tenant 实现 |
| composition | [`packages/session-do-runtime/src/composition.ts`](../../../../packages/session-do-runtime/src/composition.ts) | `82-106` | 证明默认 composition 仍返回空柄 |
| remote composition | [`packages/session-do-runtime/src/remote-bindings.ts`](../../../../packages/session-do-runtime/src/remote-bindings.ts) | `330-397` | 证明 remote factory 已接 hooks/capability/provider transport，但仍未接 kernel/workspace/eval/storage |
| env contract | [`packages/session-do-runtime/src/env.ts`](../../../../packages/session-do-runtime/src/env.ts) | `36-82, 95-121` | 证明 v1 binding catalog 只有 3 active + 1 reserved |
| HTTP fallback | [`packages/session-do-runtime/src/http-controller.ts`](../../../../packages/session-do-runtime/src/http-controller.ts) | `39-55, 127-157, 160-237` | 证明 HTTP fallback 是真实 surface，但它比完整 WS/NACP 面更窄 |
| session protocol | [`packages/nacp-session/src/ingress.ts`](../../../../packages/nacp-session/src/ingress.ts) / [`frame.ts`](../../../../packages/nacp-session/src/frame.ts) / [`stream-event.ts`](../../../../packages/nacp-session/src/stream-event.ts) | `25-74` / `66-136` / `10-96` | 证明 authority stamping、session-owned matrix、canonical 9-kind stream event |
| internal protocol | [`packages/nacp-core/src/envelope.ts`](../../../../packages/nacp-core/src/envelope.ts) / [`type-direction-matrix.ts`](../../../../packages/nacp-core/src/type-direction-matrix.ts) / [`tenancy/boundary.ts`](../../../../packages/nacp-core/src/tenancy/boundary.ts) | `1-10, 255-372` / `17-40` / `20-98` | 证明 `agent.core` 对下游 remote seam 仍必须遵守 Core 契约 |
| runtime kernel | [`packages/agent-runtime-kernel/src/runner.ts`](../../../../packages/agent-runtime-kernel/src/runner.ts) | `35-111, 133-220` | 证明 `KernelRunner` 已真实存在，不是未来想象 |
| llm | [`packages/llm-wrapper/src/executor.ts`](../../../../packages/llm-wrapper/src/executor.ts) | `44-198` | 证明 `LLMExecutor` 已真实存在 |
| hooks | [`packages/hooks/src/runtimes/service-binding.ts`](../../../../packages/hooks/src/runtimes/service-binding.ts) | `34-153` | 证明 remote hook runtime 已真实存在 |

### 3.3 `context/` 参考实现素材

| 类型 | 原始路径 | 关键行 | 为什么必读 |
|---|---|---|---|
| gateway code | [`context/smind-contexter/src/chat.ts`](../../../../context/smind-contexter/src/chat.ts) | `13-18, 118-125, 183-210` | 证明“无状态 gateway + user-level DO”这一分层是现实存在的 |
| director code | [`context/smind-contexter/context/director.ts`](../../../../context/smind-contexter/context/director.ts) | `139-189, 201-279` | 证明上游 orchestrator 可以是 one-shot intent→route→gen，而不是 host turn loop |
| producer code | [`context/smind-contexter/context/producer.ts`](../../../../context/smind-contexter/context/producer.ts) | `328-357, 364-392` | 证明 context 组装与状态持久化可以独立于 host runtime |
| DO storage code | [`context/smind-contexter/core/db_do.ts`](../../../../context/smind-contexter/core/db_do.ts) | `123-183, 186-220` | 证明 DO 内 SQLite / 状态表是可行现实，而不是抽象想象 |
| gateway memo | [`context/smind-contexter/app/plan-chat.ts.txt`](../../../../context/smind-contexter/app/plan-chat.ts.txt) | `9-22, 25-44, 82-98` | 说明 gateway / DO / service binding 的外部面如何分层 |
| engine memo | [`context/smind-contexter/app/plan-engine_do.ts.txt`](../../../../context/smind-contexter/app/plan-engine_do.ts.txt) | `8-21, 24-43, 47-56, 90-108` | 说明 user-level stateful orchestrator 的 Actor 心智模型 |
| engineering design | [`context/smind-contexter/app/design.txt`](../../../../context/smind-contexter/app/design.txt) | `7-21, 23-50, 71-107` | 说明 edge-native、DO actor、KV/R2/D1 技术组合的长期形态 |

---

## 4. 当前应冻结的五个判断

| 判断 | 结论 | 主证据 |
|---|---|---|
| `agent.core` 的身份 | **host worker，不是 binding slot** | `docs/handoff/after-foundations-to-worker-matrix.md:92-135`; `packages/session-do-runtime/src/worker.ts:72-88`; `packages/session-do-runtime/src/env.ts:72-82` |
| host shell 是否已存在 | **已存在，而且真实宿主是 `NanoSessionDO`** | `packages/session-do-runtime/src/do/nano-session-do.ts:130-280`; `packages/session-do-runtime/test/worker.test.ts:30-65` |
| client-facing 协议谁负责 | **`nacp-session` 负责 session profile；`nacp-core` 不是替身** | `packages/nacp-session/src/ingress.ts:25-74`; `packages/nacp-session/src/frame.ts:66-136`; `packages/nacp-core/src/envelope.ts:1-10, 279-372` |
| `initial_context` 的现状 | **wire contract 已冻结，但 host 侧尚无真实 consumer** | `packages/nacp-session/src/upstream-context.ts:1-42`; `packages/nacp-session/src/messages.ts:17-25`; `packages/session-do-runtime/src/do/nano-session-do.ts:608-645` |
| 当前最大技术债 | **默认 host 能跑 session shell，但还没有默认跑出真实 agent turn loop** | `packages/session-do-runtime/src/composition.ts:82-106`; `packages/session-do-runtime/src/remote-bindings.ts:385-395`; `packages/session-do-runtime/src/do/nano-session-do.ts:906-921`; `packages/agent-runtime-kernel/src/runner.ts:35-111`; `packages/llm-wrapper/src/executor.ts:44-198` |

---

## 5. 推荐阅读顺序

1. **先读** `realized-code-evidence.md`  
   先把“现在仓库里到底已经有什么”读清楚，避免先入为主把 `agent.core` 当成 greenfield。

2. **再读** `internal-nacp-compliance.md`  
   它定义 `agent.core` 作为 host 的协议底线，尤其是 `Session profile vs Core envelope` 的 ownership。

3. **再读** `external-contract-surface.md`  
   它定义 `client / upstream / downstream / platform` 四层外部面，避免把所有职责吞成一个“万能 controller”。

4. **最后读** `cloudflare-study-evidence.md`  
   它把 B1-B7/B8 的 Cloudflare 证据与 `context/smind-contexter` 的 edge-native 经验放到一起，给出平台侧边界。

---

## 6. 当前仍然开放的关键缺口

| 缺口 | 当前状态 | 是否阻止 `agent.core` 作为 first-wave 研究对象 |
|---|---|---|
| 默认 composition 未实例化 `KernelRunner` | 仍未接通 | **不阻止研究，但阻止“已完成”判断** |
| 默认 composition 未实例化真实 `LLMExecutor` | 仍未接通 | 同上 |
| `initial_context` 只有 schema、没有 consumer | 仍未接通 | **不阻止 host 定位冻结，但阻止 upstream integration 宣称完成** |
| `TEAM_UUID / SESSION_UUID` 仍未完全成为显式公开 env contract | 部分隐式存在 | **不阻止方向判断，但需要后续文档/类型收口** |
| F03/F09 两个 owner/platform gate | 仍 open | **不阻止 `agent.core` 建模，但阻止把 cross-colo/high-volume network 当成已验证事实** |

---

## 7. 本索引的使用方式

如果后续要继续编写 `worker-matrix` 的 `agent.core` 设计文档，建议把本目录当成下面这三件事的 SSOT：

1. **原始素材召回入口**：先沿着这里的原始路径回到 handoff / code / context 本体；
2. **当前真相裁判**：遇到 B8/B9 旧口径冲突时，以这里列出的当前代码锚点为准；
3. **边界保护器**：任何把 `agent.core` 写成“普通 remote worker”“binding slot”“长期记忆 orchestrator”的设计，都应视为越界。
