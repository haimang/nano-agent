# bash.core 上下文索引

> 状态：`refreshed after pre-worker-matrix closure`
> 用途：服务 `worker-matrix` **rewrite r2**
> 当前主入口：先读 `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md`

---

## 0. 一句话结论

**`bash.core` 现在不是“还没有 worker 壳”的想象物，也不是“完整 shell runtime”的候选物。它当前最准确的身份，是一个已经拥有 `workers/bash-core` deploy shell、同时拥有 `@nano-agent/capability-runtime` 真实 fake-bash engine 的目标 worker。r2 要做的是 B1 absorption，不是重新发明 shell。**

---

## 1. 这组文档现在应该依赖什么

| 类型 | 路径 | 当前用途 |
|---|---|---|
| pre-worker final closure | `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md` | 说明 worker-matrix 现在只剩 rewrite + assembly |
| handoff | `docs/handoff/pre-worker-matrix-to-worker-matrix.md` | 说明 W4 shell 已 materialize，后续该做真实吸收 |
| W4 closure | `docs/issue/pre-worker-matrix/W4-closure.md` | 冻结 `workers/bash-core` shell 已存在且 dry-run 已过 |
| W3 map | `docs/design/pre-worker-matrix/W3-absorption-map.md` | 冻结 `B1 = capability-runtime -> bash-core` |
| W3 blueprint | `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md` | 定义 `bash-core` 的代表性吸收目标与目录形状 |
| condensed truth | `docs/eval/worker-matrix/00-contexts/03-evaluations/current-worker-reality.md` | 说明当前 shell exists，但 runtime 尚未吸收 |
| shell code | `workers/bash-core/*` | 当前 deploy shell 的直接证据 |
| fake-bash engine | `packages/capability-runtime/*` | 当前真实能力面与治理纪律 |

更早的 fake-bash、just-bash、after-foundations 文档仍有价值，但现在应作为 **ancestry / rationale**，而不是直接 gate。

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

本目录现在只回答：

| 项目 | 说明 |
|---|---|
| `bash.core` 当前身份 | fake-bash capability worker 候选体，还是 full shell |
| `bash.core` 当前真相层 | worker shell 已到哪一步；capability engine 已到哪一步 |
| `bash.core` 协议责任 | 当前真正拥有哪层 `tool.call.* / cancel / progress / policy` 契约 |
| `bash.core` 对 r2 的含义 | B1 absorption 该继承什么，不该误写什么 |

### 2.2 Out-of-Scope

| 项目 | 为什么不在这里做 |
|---|---|
| 重新论证 fake-bash 是否值得做 | 价值判断已在 earlier eval 与当前代码现实中闭合 |
| 把 `bash.core` 写成 full shell / POSIX / Linux 兼容层 | 当前代码与设计都明确拒绝这条路线 |
| 把 `bash.core` 写成已完成 deploy 的 live remote worker | W4 只给了 shell，不是已吸收 runtime |
| 把 browser / python / package manager / mutating git 强塞进首波 | 当前治理真相明确拒绝或延后这些面 |

---

## 3. 当前应冻结的六个判断

| 判断 | 当前结论 | 主证据 |
|---|---|---|
| worker shell 是否存在 | **存在，而且已完成 dry-run 验证** | `docs/issue/pre-worker-matrix/W4-closure.md:18-27,43-48,225-233`; `workers/bash-core/src/index.ts:1-22` |
| 当前 shell 是否已吸收 fake-bash engine | **没有**；当前仍是 version-probe shell | `workers/bash-core/src/index.ts:5-22`; `docs/eval/worker-matrix/00-contexts/03-evaluations/current-worker-reality.md:19-22` |
| 真实 bash-core substance 在哪里 | **仍在 `@nano-agent/capability-runtime@0.1.0`** | `packages/capability-runtime/package.json:1-35`; `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md:30-57` |
| 当前真实能力面 | **21-command governed subset + planner/bridge/executor/targets/handlers** | `packages/capability-runtime/README.md:1-151`; `packages/capability-runtime/src/fake-bash/commands.ts:16-314` |
| 当前 remote seam | **`CAPABILITY_WORKER` + `serviceBindingTransport` 已存在** | `packages/session-do-runtime/src/env.ts:36-121`; `packages/session-do-runtime/src/remote-bindings.ts:335-395`; `packages/capability-runtime/src/targets/service-binding.ts:1-215` |
| worker-matrix 首波姿态 | **B1 absorption + worker assembly，不是 full shell 设计重开** | `docs/design/pre-worker-matrix/W3-absorption-map.md:31-42,79-84`; `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md:14-28,148-170` |

---

## 4. 现在最该怎么理解 `bash.core`

### 4.1 它已经同时有“壳”和“引擎”

今天的 `bash.core` 也有两层现实：

| 层 | 当前真实物体 | 现在能说明什么 |
|---|---|---|
| deploy shell | `workers/bash-core/` | W4 已把 worker 名字、wrangler shape、dry-run pipeline 变成物理事实 |
| fake-bash engine | `packages/capability-runtime/` | governed fake-bash、tool-call bridge、targets、handlers 都已是真实代码 |

因此 r2 不应再写成：

> “先定义 bash-core 是不是值得做。”

而应写成：

> **“bash-core 已有 shell 与 engine；下一步是完成 B1 absorption 并决定它的首波 remote assembly。”**

### 4.2 当前 shell 是诚实壳，不是假装已经 remoteized

`workers/bash-core` 当前只做：

1. 返回版本探针 JSON：`workers/bash-core/src/index.ts:5-22`
2. 保持一个 plain fetch shell：`workers/bash-core/README.md:1-30`
3. 在 W4 范围内不激活任何 outgoing bindings：`workers/bash-core/wrangler.jsonc:1-22`

这意味着：

> **当前的 bash-core deploy reality 已存在，但 live capability worker 还没有被吸收进这个目录。**

### 4.3 当前真正要被吸收的是 B1，而不是 just-bash

W3 已经把这条路线冻结得很清楚：

- `B1 = capability-runtime -> bash-core`：`docs/design/pre-worker-matrix/W3-absorption-map.md:37-39,79-84`
- 目标是保留 fake-bash 外形 + typed capability 内核 + honest partial 纪律：`docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md:14-28,118-133,148-170`

所以 r2 最不该做的 drift 是：

> 把 `bash.core` 从 `capability-runtime` 路线拉回到 full shell runtime / just-bash port。

---

## 5. 推荐阅读顺序

1. **先读** `realized-code-evidence.md`  
   先把 shell、engine、remote seam、未吸收部分读清楚。

2. **再读** `internal-nacp-compliance.md`  
   看清 `bash.core` 当前真正拥有的是哪层协议。

3. **再读** `external-contract-surface.md`  
   把 package API、fake-bash surface、service-binding seam、worker shell 区分开。

4. **最后读** `cloudflare-study-evidence.md`  
   把 W4 shell reality、fake-bash platform law、just-bash ancestry 边界放回平台层理解。

---

## 6. r2 现在不该再犯的三种错误

1. **把 `bash.core` 当成还没有 shell 的抽象概念**  
   `workers/bash-core` 已经存在。

2. **把 `bash.core` 写成 full shell runtime**  
   当前代码真相仍是 governed fake-bash engine。

3. **把当前 shell 写成“已吸收 capability-runtime 的 live worker”**  
   这在当前仓库里仍不成立。

---

## 7. ancestry-only 参考

需要补充更早的理由时，再回去看：

1. `docs/eval/vpa-fake-bash-by-GPT.md`
2. `docs/spikes/fake-bash-platform-findings.md`
3. `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`
4. `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`
5. `context/just-bash/*`

这些现在主要用来保留：

- fake-bash 的价值论证
- governed subset 的平台理由
- just-bash 能吸收什么、不能直接照搬什么

不应用来覆盖：

- W3/W4/W5 之后的当前 shell reality
- B1 absorption 作为当前执行基线的事实

---

## 8. 本索引的最终判断

**今天的 `bash.core` 应被写成：一个已经有 deploy shell、但真实语义仍主要在 `capability-runtime` 中的目标 capability worker。**

所以 `worker-matrix` r2 的正确问题不是“bash-core 要不要存在”，而是：

> **如何把 B1 吸收到 `workers/bash-core/`，同时保持 21-command governed subset、`tool.call.*` 对齐、service-binding seam、以及 honest partial / no-silent-success 治理不漂移。**
