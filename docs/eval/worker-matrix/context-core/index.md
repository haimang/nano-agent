# context.core 上下文索引

> 状态：`curated / rewritten`
> 目标：作为 `docs/eval/worker-matrix/context-core/` 的入口索引，同时提供**原始素材召回路径**、**范围边界**、**当前结论**与**阅读顺序**。

---

## 0. 一句话结论

**`context.core` 不是一个已经独立成形的“上下文大脑 worker”，而是一组已经真实存在、但应保持薄做的 context substrate：它今天最可信的内核是 `budget + async compact + assembly + snapshot + evidence`，而不是 slot/reranker/full context engine。**

---

## 1. In-Scope / Out-of-Scope

### 1.1 In-Scope

本目录只负责回答下面四类问题：

| 项目 | 说明 |
|---|---|
| `context.core` 的定位 | 它应不应该成为独立 worker、应该厚做还是薄做 |
| `context.core` 的协议责任 | 它今天到底拥有哪些 formal NACP/internal contract，哪些还没有协议化 |
| `context.core` 的当前代码真相 | 当前仓库里已经有哪些 package/测试/runtime glue，哪些仍只是 seam |
| `context.core` 的平台边界 | DO / R2 / tenant ref / evidence / inspector 对它的直接约束 |

### 1.2 Out-of-Scope

本目录**不**承担下面这些工作：

| 项目 | 为什么不在这里做 |
|---|---|
| 设计 `agent.core / bash.core / filesystem.core` 的全部细节 | 它们各自需要独立上下文包 |
| 把 `context.core` 直接写成完整 slot/rerank/context-engine 产品 | 当前代码与 worker-matrix 评估都不支持这种厚判断 |
| 重写 B4/B8/B9 原始历史文档 | 原始文档仍是历史审计路径，本目录只做聚合与裁判 |
| 提前冻结 `context.reranker` / D1 / 高级语义压缩 API | 当前阶段证据不足，且会过早锁死策略层 |

---

## 2. 证据优先级

本目录采用下面这条优先级：

1. **当前仓库源码与当前测试**
2. **原始 action-plan / review / evaluation 文档**
3. **`context/` 下的参考实现**
4. **较早的 closure 口径**

这条优先级在 `context.core` 上尤其重要，因为：

- B4 的初始实现日志一度把 `/inspect/...` seam 写得比真实 runtime 更满：`docs/action-plan/after-foundations/B4-context-management-package-async-core.md:568-575,644-660`
- 后续 review 已把它收紧成“package 主体成立，但 helper-only seam 与 deferred caveat 需要诚实标注”：`docs/code-review/after-foundations/B2-B4-code-reviewed-by-GPT.md:5-6,29-37,201-237`
- worker-matrix 两份评估又都明确提醒：`context.core` 方向正确，但必须薄做：`docs/eval/after-foundations/worker-matrix-eval-with-GPT.md:181-226`; `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md:83-100,250-260`

---

## 3. 原始素材总索引

> 下面列的都是**原始路径**，不是 `docs/eval/worker-matrix/00-context/` 里的复制品。

### 3.1 原始文档素材

| 类型 | 原始路径 | 关键行 / 章节 | 为什么必读 |
|---|---|---|---|
| action-plan | [`docs/action-plan/after-foundations/B4-context-management-package-async-core.md`](../../../action-plan/after-foundations/B4-context-management-package-async-core.md) | `48-75, 189-225, 568-575, 613-654` | B4 的原始 scope、integration seam、deferred caveat 与下游 handoff |
| review | [`docs/code-review/after-foundations/B2-B4-code-reviewed-by-GPT.md`](../../../code-review/after-foundations/B2-B4-code-reviewed-by-GPT.md) | `5-6, 33-37, 42-70, 74-85, 201-237` | 为什么 `context-management` 可以作为 foundation 保留，但不能被误写成已闭合的独立 runtime |
| evaluation | [`docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`](../../../eval/after-foundations/worker-matrix-eval-with-GPT.md) | `181-226` | GPT 对 `context.core = 薄 worker` 的原始判断 |
| evaluation | [`docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`](../../../eval/after-foundations/worker-matrix-eval-with-Opus.md) | `163-166, 171-250` | Opus 对 `context.core` readiness 较低、first-wave 不宜厚拆的原始判断 |
| evaluation | [`docs/eval/after-foundations/smind-contexter-learnings.md`](../../../eval/after-foundations/smind-contexter-learnings.md) | `31-42, 214-229, 241-259` | 提供 slot/rerank/intent-routing 的未来方向，但也明确 owner 已决定 first-wave 暂不纳入 |

### 3.2 当前仓库代码素材

| 类型 | 原始路径 | 关键行 | 为什么必读 |
|---|---|---|---|
| package overview | [`packages/context-management/README.md`](../../../../packages/context-management/README.md) | `3-15, 16-23, 45-108, 129-145` | 证明 `context-management` 今天就是 `budget + async-compact + inspector-facade` 三件事 |
| compact runtime | [`packages/context-management/src/async-compact/index.ts`](../../../../packages/context-management/src/async-compact/index.ts) | `1-24, 25-50, 126-156, 159-245, 502-620` | 证明 orchestrator、hydrate/persist、retry/generation token、restore seam 的当前真相 |
| kernel seam | [`packages/context-management/src/async-compact/kernel-adapter.ts`](../../../../packages/context-management/src/async-compact/kernel-adapter.ts) | `1-18, 31-37, 57-88` | 证明 `context.core` 已有接 kernel 的最小 delegate seam |
| inspector seam | [`packages/context-management/src/inspector-facade/index.ts`](../../../../packages/context-management/src/inspector-facade/index.ts) | `313-371` | 证明 `/inspect/...` 只是 opt-in mount helper，不是默认 host truth |
| inspector contract | [`packages/context-management/src/inspector-facade/types.ts`](../../../../packages/context-management/src/inspector-facade/types.ts) | `1-9, 20-38, 44-80, 154-230` | 证明 facade 的 header law、UsageReport shape、providers seam 与 control surface |
| assembly | [`packages/workspace-context-artifacts/src/context-assembler.ts`](../../../../packages/workspace-context-artifacts/src/context-assembler.ts) | `1-22, 39-49, 66-167` | 证明 caller-ordered assembly、budget truncation、evidence emission 已真实存在 |
| compact boundary | [`packages/workspace-context-artifacts/src/compact-boundary.ts`](../../../../packages/workspace-context-artifacts/src/compact-boundary.ts) | `1-22, 36-49, 97-218` | 证明 compact boundary 已直接镜像 `context.compact.request/response` |
| snapshot | [`packages/workspace-context-artifacts/src/snapshot.ts`](../../../../packages/workspace-context-artifacts/src/snapshot.ts) | `1-8, 30-49, 84-184, 198-232` | 证明 snapshot builder 真实 capture mounts/fileIndex/artifacts/contextLayers，而不是空壳 |
| evidence | [`packages/workspace-context-artifacts/src/evidence-emitters.ts`](../../../../packages/workspace-context-artifacts/src/evidence-emitters.ts) | `1-14, 24-84, 90-175, 222-282` | 证明 assembly/compact/artifact/snapshot 四类 evidence 都有统一 emitter |
| observability | [`packages/eval-observability/src/inspector.ts`](../../../../packages/eval-observability/src/inspector.ts) | `1-12, 23-33, 50-62, 157-315` | 证明 live inspector 是 append-only 9-kind observer，而不是 context engine 本体 |
| storage refs | [`packages/storage-topology/src/refs.ts`](../../../../packages/storage-topology/src/refs.ts) | `1-23, 31-53, 67-79, 128-166` | 证明所有 history/summary/storage refs 都必须 tenant-prefixed 才能过 `NacpRef` law |
| runtime use-site | [`packages/session-do-runtime/src/workspace-runtime.ts`](../../../../packages/session-do-runtime/src/workspace-runtime.ts) | `1-18, 45-62, 75-101` | 证明 workspace evidence trio 已有真实 runtime 组装 helper |
| runtime use-site | [`packages/session-do-runtime/src/do/nano-session-do.ts`](../../../../packages/session-do-runtime/src/do/nano-session-do.ts) | `256-305, 1055-1072` | 证明默认 deploy-shaped path 现在会给 workspace/context evidence 安装默认 sink |

### 3.3 `context/` 参考实现素材

| 类型 | 原始路径 | 关键行 | 为什么必读 |
|---|---|---|---|
| 结构总纲 | [`context/smind-contexter/app/design.txt`](../../../../context/smind-contexter/app/design.txt) | `159-184` | 说明真正的厚 context engine 长什么样，以及它与我们当前薄 substrate 的距离 |
| DDL / slot store | [`docs/eval/after-foundations/smind-contexter-learnings.md`](../../../eval/after-foundations/smind-contexter-learnings.md) | `192-210, 245-259` | 提炼 `contexts / vec_history / vec_intents` 等结构对 nano-agent 的启发 |
| gateway / engine 分层 | [`context/smind-contexter/app/plan-chat.ts.txt`](../../../../context/smind-contexter/app/plan-chat.ts.txt) | `9-22, 25-44` | 说明 gateway 与 stateful engine 应分层，而非把 context 全吞进 host |
| DO actor 方案 | [`context/smind-contexter/app/plan-engine_do.ts.txt`](../../../../context/smind-contexter/app/plan-engine_do.ts.txt) | `8-21, 24-43, 90-108` | 说明 stateful context actor 的正确心智模型 |
| producer | [`context/smind-contexter/context/producer.ts`](../../../../context/smind-contexter/context/producer.ts) | `328-357, 364-392` | 证明“谁进 prompt”的最终仲裁可以集中在 producer，而不是散在各层 |
| director | [`context/smind-contexter/context/director.ts`](../../../../context/smind-contexter/context/director.ts) | `139-189, 215-272` | 说明意图判断、路由、context 决策可以先于运行时执行 |
| DO storage | [`context/smind-contexter/core/db_do.ts`](../../../../context/smind-contexter/core/db_do.ts) | `123-183, 186-220` | 说明 DO 内局部数据库 / BLOB / slot store 是未来可行方向，但不是今天已实现现实 |

---

## 4. 当前应冻结的五个判断

| 判断 | 结论 | 主证据 |
|---|---|---|
| `context.core` 的身份 | **薄的 context substrate，不是已完成的独立 context engine** | `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md:181-226`; `packages/context-management/README.md:3-15`; `packages/workspace-context-artifacts/README.md:17-64` |
| 当前最 formal 的协议面 | **只有 `context.compact.request/response` 真正 protocolized** | `packages/nacp-core/src/messages/context.ts:5-25`; `packages/workspace-context-artifacts/src/compact-boundary.ts:1-22,36-49` |
| 当前最扎实的代码面 | **assembly / compact boundary / snapshot / evidence / budget / async compact** | `packages/workspace-context-artifacts/src/context-assembler.ts:66-167`; `packages/workspace-context-artifacts/src/snapshot.ts:84-184`; `packages/context-management/src/async-compact/index.ts:159-245` |
| inspector 的正确定位 | **存在且可信，但通常应由 host worker opt-in 挂载，不应误写成默认独立 public surface** | `packages/context-management/src/inspector-facade/index.ts:313-371`; `test/context-management-contract.test.mjs:52-65` |
| 最大未冻结区 | **slot/reranker/intent-routing/semantic strategy 仍是 future direction，不是 first-wave reality** | `docs/eval/after-foundations/smind-contexter-learnings.md:31-42,245-259`; `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md:199-223` |

---

## 5. 推荐阅读顺序

1. **先读** `realized-code-evidence.md`  
   先确认当前仓库里已经有什么，再去谈 worker 化。

2. **再读** `internal-nacp-compliance.md`  
   它定义 `context.core` 目前真正拥有的 formal protocol 边界，以及哪些东西还不该乱协议化。

3. **再读** `external-contract-surface.md`  
   它解释 `agent.core / workspace / storage / observability / inspector` 这些 seam 是怎么分工的。

4. **最后读** `cloudflare-study-evidence.md`  
   它把 DO/R2/tenant ref/platform law 与 `smind-contexter` 的经验结合起来，给出 worker-matrix 阶段的推荐姿态。

---

## 6. 当前仍然开放的关键缺口

| 缺口 | 当前状态 | 是否阻止 `context.core` 继续建模 |
|---|---|---|
| 独立 `context.core` worker deploy shell | 仍不存在 | **不阻止建模，但阻止“已独立部署”判断** |
| live `context.compact.*` remote transport | 仍不存在 | **不阻止 package-level truth，但阻止 cross-worker closure 宣称** |
| slot / reranker / intent-routing strategy | 仍 deferred | **不阻止 first-wave 薄 worker，但阻止厚 context-engine 宣称** |
| inspector public mount | helper 已存在，默认 host path 未启用 | **不阻止 context substrate 成立，但阻止 public control plane closure 宣称** |
| storage placement evidence 闭环 | adapters / calibration 已有，runtime 主路径仍薄 | **不阻止方向判断，但阻止 DO/KV/R2 物理拓扑提前冻结** |

---

## 7. 本索引的使用方式

如果后续要继续编写 `worker-matrix` 的 `context.core` 设计文档，建议把本目录当成下面这三件事的 SSOT：

1. **原始素材召回入口**：先沿着这里的原始路径回到 action-plan / code / context 本体；
2. **当前真相裁判**：遇到 B4/B8/B9/B7 旧口径冲突时，以这里列出的当前代码锚点为准；
3. **边界保护器**：任何把 `context.core` 写成“已经具备 slot/rerank/full semantic memory engine”的设计，都应视为越界。
