# context.core 上下文索引

> 状态：`refreshed after pre-worker-matrix closure`
> 用途：服务 `worker-matrix` **rewrite r2**
> 当前主入口：先读 `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md`

---

## 0. 一句话结论

**`context.core` 现在不是“还没有 worker 壳的薄 substrate 设想”，而是一个已经拥有 `workers/context-core` deploy shell、同时拥有 `@nano-agent/context-management` + `@nano-agent/workspace-context-artifacts` context slice 的目标 worker。r2 要做的是 C1+C2 absorption，不是重开 context worker 的存在性讨论。**

---

## 1. 这组文档现在应该依赖什么

| 类型 | 路径 | 当前用途 |
|---|---|---|
| pre-worker final closure | `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md` | 说明 worker-matrix 现在只剩 rewrite + assembly |
| handoff | `docs/handoff/pre-worker-matrix-to-worker-matrix.md` | 说明 W4 shell 已 materialize，W3 blueprints 才是后续执行基线 |
| W4 closure | `docs/issue/pre-worker-matrix/W4-closure.md` | 冻结 `workers/context-core` shell 已存在且 dry-run 已过 |
| W3 map | `docs/design/pre-worker-matrix/W3-absorption-map.md` | 冻结 `C1=context-management`、`C2=workspace-context-artifacts context slice` |
| W3 blueprint | `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md` | 定义 C2 / D1 split 与 mixed evidence helper 的正确归属 |
| condensed truth | `docs/eval/worker-matrix/00-contexts/03-evaluations/current-worker-reality.md` | 说明 shell exists，但 runtime 尚未吸收 |
| shell code | `workers/context-core/*` | 当前 deploy shell 的直接证据 |
| current packages | `packages/context-management/*`; `packages/workspace-context-artifacts/*` | 当前真实语义与代码锚点 |

after-foundations 时代的 B4 / 评估 / learnings 仍然有价值，但现在只应作为 **ancestry / rationale**，不再是直接 gate。

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

本目录现在只回答：

| 项目 | 说明 |
|---|---|
| `context.core` 当前身份 | 薄 context substrate 还是厚 semantic engine |
| `context.core` 当前真相层 | worker shell 已到哪一步；C1/C2 代码已到哪一步 |
| `context.core` 协议责任 | 今天 formal protocol 有多窄，哪些仍只是 typed runtime seam |
| `context.core` 对 r2 的含义 | C1/C2 absorption 该继承什么，不该误写什么 |

### 2.2 Out-of-Scope

| 项目 | 为什么不在这里做 |
|---|---|
| 重开 `context.core` 是否该存在 | W4 壳与 W3 map 已经把存在性问题关闭 |
| 把 `context.core` 写成厚的 semantic memory / reranker / intent engine | 当前代码与 owner direction 都不支持 first-wave 这么写 |
| 重写 B4/B8/B9 原始历史文档 | 它们现在是 ancestry，不是直接规划入口 |
| 提前冻结 remote compact / slot / rerank 的完整 worker protocol | 当前 handoff 已把这类东西保留给 worker-matrix 之后的真实执行阶段 |

---

## 3. 当前应冻结的六个判断

| 判断 | 当前结论 | 主证据 |
|---|---|---|
| worker shell 是否存在 | **存在，而且已完成 W4 dry-run 验证** | `docs/issue/pre-worker-matrix/W4-closure.md:18-27,45-48,235-240`; `workers/context-core/src/index.ts:1-22` |
| 当前 shell 是否已吸收 C1/C2 | **没有**；当前仍是 version-probe shell | `workers/context-core/src/index.ts:5-22`; `docs/eval/worker-matrix/00-contexts/03-evaluations/current-worker-reality.md:19-22` |
| 当前真实 context substance 在哪里 | **仍在 `@nano-agent/context-management@0.1.0` + `@nano-agent/workspace-context-artifacts@0.1.0`** | `packages/context-management/package.json:1-52`; `packages/workspace-context-artifacts/package.json:1-39` |
| worker-matrix 吸收范围 | **C1 + C2 都归 `context-core` 组** | `docs/design/pre-worker-matrix/W3-absorption-map.md:39-42,85-97` |
| 当前最 formal 的 protocol 面 | **仍只有 `context.compact.request/response` 真正 protocolized** | `packages/nacp-core/src/messages/context.ts`; `packages/workspace-context-artifacts/src/compact-boundary.ts` |
| 当前最大缺口 | **shell 已在，但独立 worker implementation / remote compact helper / `initial_context` consumer / first-wave assembled runtime 都还没在 `workers/context-core/` 内闭合** | `docs/eval/worker-matrix/00-contexts/03-evaluations/current-worker-reality.md:19-22`; `packages/context-management/src` / `packages/session-do-runtime/src` 目前无 `initial_context` consumer |

---

## 4. 现在最该怎么理解 `context.core`

### 4.1 它已经同时有“壳”和“substrate”

今天的 `context.core` 也要分两层看：

| 层 | 当前真实物体 | 现在能说明什么 |
|---|---|---|
| deploy shell | `workers/context-core/` | W4 已把 worker 名字、wrangler shape、dry-run pipeline 变成物理事实 |
| context substrate | `packages/context-management/` + `packages/workspace-context-artifacts/` 的 context slice | C1/C2 的真实语义、helper、runtime seam 都仍在 package 中 |

因此 r2 不应再写成：

> “先定义 context-core 要不要成为一个 worker。”

而应写成：

> **“context-core 已有 shell 与 substrate；下一步是完成 C1/C2 absorption，并决定 first-wave 是否 local-assembly 或局部 remoteize。”**

### 4.2 当前 shell 是诚实收窄，不是假装已经成形

`workers/context-core` 当前只做：

1. 返回版本探针 JSON：`workers/context-core/src/index.ts:5-22`
2. 保持 plain fetch shell：`workers/context-core/README.md:1-26`
3. 不激活任何 outgoing bindings：`workers/context-core/wrangler.jsonc:1-22`

因此当前 deploy reality 只能写成：

> **context-core shell exists, but runtime absorption has not started inside that shell**

### 4.3 当前真正要被吸收的是 C1 + C2，不是“全部 context 愿景”

W3 map 与 split blueprint 已经把这条路线冻结得很清楚：

1. `C1 = context-management -> context-core`
2. `C2 = workspace-context-artifacts context slice -> context-core`
3. `slot / reranker / intent-routing` 不属于这次 first-wave reality

这意味着 r2 最不该做的 drift 是：

> 把 `context.core` 从 “budget + compact + assembly + snapshot + evidence” 拉回到一个厚的语义大脑工程。

---

## 5. 推荐阅读顺序

1. **先读** `realized-code-evidence.md`  
   先把 shell、C1/C2 substrate、runtime gaps 的当前事实读清。

2. **再读** `internal-nacp-compliance.md`  
   看清它今天真正 formal 的 protocol 面有多窄。

3. **再读** `external-contract-surface.md`  
   把 host/kernel/workspace seam、inspector facade、storage/evidence seam 区分开。

4. **最后读** `cloudflare-study-evidence.md`  
   把 shell reality、DO/R2/tenant law、以及 `smind-contexter` 的 ancestry 放回平台层理解。

---

## 6. r2 现在不该再犯的三种错误

1. **把 `context.core` 当成还没有 worker 壳的概念物**  
   `workers/context-core` 已经存在。

2. **把 `context.core` 写成厚的 semantic engine**  
   当前 W3/C1/C2 基线不支持这么写。

3. **把当前 shell 写成“已吸收并已 remoteized 的 context worker”**  
   当前仓库里仍不成立。

---

## 7. ancestry-only 参考

需要补更早的理由时，再回去看：

1. `docs/action-plan/after-foundations/B4-context-management-package-async-core.md`
2. `docs/code-review/after-foundations/B2-B4-code-reviewed-by-GPT.md`
3. `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`
4. `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`
5. `docs/eval/after-foundations/smind-contexter-learnings.md`

这些现在主要用来保留：

- 为什么 first-wave 必须薄做
- 为什么 reranker / slot store / intent routing 不能提前写满
- 为什么 inspect/control seam 只能谨慎开放

不应用来覆盖：

- W3/W4/W5 之后的当前 shell reality
- C1/C2 absorption 作为当前执行基线的事实

---

## 8. 本索引的最终判断

**今天的 `context.core` 应被写成：一个已经有 deploy shell、但真实语义仍主要在 C1/C2 packages 中的目标 worker。**

所以 `worker-matrix` r2 的正确问题不是“context-core 是否存在”，而是：

> **如何把 `context-management` 与 `workspace-context-artifacts` 的 context slice 吸收到 `workers/context-core/`，同时保持 compact wire、assembly/snapshot/evidence seam、以及薄 worker 边界不漂移。**
