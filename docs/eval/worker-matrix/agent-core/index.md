# agent.core 上下文索引

> 状态：`refreshed after pre-worker-matrix closure`
> 用途：服务 `worker-matrix` **rewrite r2**
> 当前主入口：先读 `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md`

---

## 0. 一句话结论

**`agent.core` 现在不是“待发明 worker”，而是一个已经同时拥有 `workers/agent-core` deploy shell 与 `@nano-agent/session-do-runtime` host substrate 的目标 worker。`worker-matrix` r2 要做的是 A1-A5 的 assembly / absorption，不是重新发明 host 拓扑。**

---

## 1. 这组文档现在应该依赖什么

先把下面这些当成 **direct input pack**：

| 类型 | 路径 | 当前用途 |
|---|---|---|
| pre-worker final closure | `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md` | 定义 pre-worker 已闭环、worker-matrix 只剩 rewrite + assembly |
| handoff | `docs/handoff/pre-worker-matrix-to-worker-matrix.md` | 定义 r2 rewrite 该继承什么、不该重开什么 |
| W4 closure | `docs/issue/pre-worker-matrix/W4-closure.md` | 冻结 `workers/agent-core` 已真实存在且 preview deploy 已完成 |
| W3 map | `docs/design/pre-worker-matrix/W3-absorption-map.md` | 冻结 `agent-core = A1-A5` 这组 absorption units |
| W3 blueprint | `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md` | 定义 A1 host-shell → worker 的代表落点 |
| condensed truth | `docs/eval/worker-matrix/00-contexts/03-evaluations/current-worker-reality.md` | 提供当前 4-worker 代码真相总表 |
| shell code | `workers/agent-core/*` | 提供当前 deploy-shaped shell 的直接证据 |
| host substrate | `packages/session-do-runtime/src/*` | 提供真正的 host runtime 代码真相 |

上游 after-foundations 文档仍有价值，但现在只应作为 **ancestry** 使用，不再是直接 gate。

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

本目录现在只回答四件事：

| 项目 | 说明 |
|---|---|
| `agent.core` 当前身份 | host worker 还是 binding slot |
| `agent.core` 当前真相层 | worker shell 已到什么程度；runtime substrate 已到什么程度 |
| `agent.core` 协议责任 | `nacp-session` / `nacp-core` / tenant / replay / stream law 由谁负责 |
| `agent.core` 对 r2 的含义 | rewrite 应继承什么，第一批 assembly 不该再重开什么 |

### 2.2 Out-of-Scope

本目录不再承担：

| 项目 | 为什么不在这里做 |
|---|---|
| 重新论证 4-worker 拓扑 | W4 已把目录、名字、deploy shell 变成物理事实 |
| 重写 B8/B9 历史文档 | `00-contexts` 已把它们降级为 ancestry summaries |
| 把 `agent.core` 写成长期记忆 orchestrator | `initial_context` 已冻结为 upstream→host seam，而不是 host 自吞所有上游职责 |
| 把 `agent.core` 当成普通 remote worker | handoff 已明确 `agent.core` 继续是 host worker |

---

## 3. 当前应冻结的六个判断

| 判断 | 当前结论 | 主证据 |
|---|---|---|
| `agent.core` 身份 | **host worker，不是 binding slot** | `docs/handoff/pre-worker-matrix-to-worker-matrix.md:47-50`; `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md:118-128` |
| worker shell 是否存在 | **存在，而且已完成 real preview deploy** | `docs/issue/pre-worker-matrix/W4-closure.md:18-27,63-71,140-145`; `workers/agent-core/src/index.ts:1-24` |
| 当前 shell 是否等于 live host runtime | **不是**；它现在仍是 version-probe shell + DO stub | `workers/agent-core/src/index.ts:6-24`; `workers/agent-core/src/nano-session-do.ts:1-17` |
| 真实 host substrate 在哪里 | **仍在 `@nano-agent/session-do-runtime@0.3.0`** | `packages/session-do-runtime/package.json:1-40`; `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md:20-25,39-48` |
| 当前最大 runtime 缺口 | **default / remote composition 仍未把 kernel/workspace/eval/storage 接满** | `packages/session-do-runtime/src/composition.ts:82-106`; `packages/session-do-runtime/src/remote-bindings.ts:324-399` |
| worker-matrix 组装范围 | **A1-A5 都归 `agent-core` 组** | `docs/design/pre-worker-matrix/W3-absorption-map.md:31-42,46-77` |

---

## 4. 现在最该怎么理解 `agent.core`

### 4.1 它已经同时有“壳”和“原型”

今天的 `agent.core` 不是单点事实，而是两层真相同时存在：

| 层 | 当前真实物体 | 现在能说明什么 |
|---|---|---|
| deploy shell | `workers/agent-core/` | W4 已证明 worker 目录、wrangler shape、DO slot、preview deploy path 都真实存在 |
| host substrate | `packages/session-do-runtime/` | 真正的 Worker/DO host、session ingress、HTTP/WS controller、checkpoint/replay、remote seam wiring 仍在这里 |

因此 r2 不应再写成：

> “先定义 agent-core 是什么。”

而应写成：

> **“agent-core 已有 shell 与 substrate；下一步是把 A1-A5 吸收并装成 live host runtime。”**

### 4.2 当前的 worker shell 是诚实收窄，不是假装完成

`workers/agent-core` 当前只做三件事：

1. 暴露 `fetch()` 并返回版本探针 JSON：`workers/agent-core/src/index.ts:6-24`
2. 导出 `NanoSessionDO` stub：`workers/agent-core/src/nano-session-do.ts:11-17`
3. 保持 `SESSION_DO` active，而把 `BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE` 留在注释态 future slots：`workers/agent-core/wrangler.jsonc:14-34`

这正是 W4 想证明的东西：

> **deploy-shaped host shell 已落地，但 live cross-worker assembly 还没有开始。**

### 4.3 当前的 host substrate 已经远超“概念草图”

`session-do-runtime` 仍是 `agent.core` 最重要的当前代码证据，因为它已经真实拥有：

1. Worker entry → DO forwarding：`packages/session-do-runtime/src/worker.ts:1-89`
2. Session runtime env / remote seam catalog：`packages/session-do-runtime/src/env.ts:36-121`
3. default composition / remote composition：`packages/session-do-runtime/src/composition.ts:82-106`; `packages/session-do-runtime/src/remote-bindings.ts:324-399`
4. 真正的 DO host、本地 checkpoint/replay、session lifecycle glue：`packages/session-do-runtime/src/do/nano-session-do.ts`

这意味着 `agent.core` 的主任务已经从“有没有 host runtime”变成了：

> **如何把现成 substrate 吸进 `workers/agent-core/src/` 并接成默认真相。**

---

## 5. 推荐阅读顺序

1. **先读** `realized-code-evidence.md`  
   先把 shell、substrate、runtime gaps 的当前事实读清。

2. **再读** `internal-nacp-compliance.md`  
   看清 `agent.core` 作为 host 继续要遵守的双协议边界。

3. **再读** `external-contract-surface.md`  
   把当前 shell surface、未来 host surface、upstream/downstream seam 区分开。

4. **最后读** `cloudflare-study-evidence.md`  
   把 W4 deploy reality、DO host law、service-binding activation 边界放回平台层理解。

---

## 6. r2 现在不该再犯的三种错误

1. **把 `agent.core` 当成 greenfield worker**  
   W4 shell 与 `session-do-runtime` substrate 都已经存在。

2. **把 `agent.core` 写成 binding slot**  
   handoff 已把 host 身份冻结。

3. **把 W1/W4 未交付的内容写成“已 live”**  
   service bindings 还未在 `workers/agent-core` 激活；remote protocol families 仍是 RFC-only direction，不是已 ship runtime API。

---

## 7. ancestry-only 参考

若需要追溯更早的论证背景，再回去看：

1. `docs/handoff/after-foundations-to-worker-matrix.md`
2. `docs/issue/after-foundations/B8-phase-1-closure.md`
3. `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`
4. `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`

但在 r2 写作时，这些只应用来保留：

- host vs remote 心智模型
- 平台 law
- 早期 readiness rationale

不应用来覆盖：

- pre-worker W3/W4/W5 的当前入口口径
- 当前 `workers/agent-core` shell reality
- 当前 `@haimang/nacp-*` 发布事实

---

## 8. 本索引的最终判断

**今天的 `agent.core` 应被写成：一个已经拥有 deploy shell 与 host substrate 的目标 host worker。**

所以 `worker-matrix` r2 的正确问题不是“要不要先建 agent-core”，而是：

> **如何按 A1-A5 吸收顺序，把现有 `session-do-runtime`、kernel、llm、hooks、eval seam 组装进 `workers/agent-core/`，并把当前 shell 提升成 live host runtime。**
