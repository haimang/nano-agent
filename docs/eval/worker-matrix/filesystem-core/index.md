# filesystem.core 上下文索引

> 状态：`refreshed after pre-worker-matrix closure`
> 用途：服务 `worker-matrix` **rewrite r2**
> 当前主入口：先读 `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md`

---

## 0. 一句话结论

**`filesystem.core` 现在不是“还没有 worker 壳的 workspace/storage foundation”，而是一个已经拥有 `workers/filesystem-core` deploy shell、同时拥有 `@nano-agent/workspace-context-artifacts` filesystem slice + `@nano-agent/storage-topology` 的目标 worker。r2 要做的是 D1+D2 absorption，不是重开 filesystem worker 的存在性讨论。**

---

## 1. 这组文档现在应该依赖什么

| 类型 | 路径 | 当前用途 |
|---|---|---|
| pre-worker final closure | `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md` | 说明 worker-matrix 现在只剩 rewrite + assembly |
| handoff | `docs/handoff/pre-worker-matrix-to-worker-matrix.md` | 说明 W4 shell 已 materialize，W3 blueprints 才是后续执行基线 |
| W4 closure | `docs/issue/pre-worker-matrix/W4-closure.md` | 冻结 `workers/filesystem-core` shell 已存在且 dry-run 已过 |
| W3 map | `docs/design/pre-worker-matrix/W3-absorption-map.md` | 冻结 `D1=workspace-context-artifacts filesystem slice`、`D2=storage-topology residual` |
| W3 blueprint | `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md` | 定义 D1 与 C2 的正确 split |
| condensed truth | `docs/eval/worker-matrix/00-contexts/03-evaluations/current-worker-reality.md` | 说明 shell exists，但 runtime 尚未吸收 |
| shell code | `workers/filesystem-core/*` | 当前 deploy shell 的直接证据 |
| current packages | `packages/workspace-context-artifacts/*`; `packages/storage-topology/*` | 当前真实 workspace/storage substrate |

旧的 after-foundations 评估、B2/B3/A8、just-bash 仍有价值，但现在只应作为 **ancestry / rationale**，不再是直接 gate。

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

本目录现在只回答：

| 项目 | 说明 |
|---|---|
| `filesystem.core` 当前身份 | mount-based workspace/storage worker 候选体，还是真 POSIX FS |
| `filesystem.core` 当前真相层 | worker shell 已到哪一步；D1/D2 代码已到哪一步 |
| `filesystem.core` 协议责任 | 今天真正 formal 的 ref/key/path law 由谁拥有 |
| `filesystem.core` 对 r2 的含义 | D1/D2 absorption 该继承什么，不该误写什么 |

### 2.2 Out-of-Scope

| 项目 | 为什么不在这里做 |
|---|---|
| 重开 `filesystem.core` 是否该存在 | W4 壳与 W3 map 已经把存在性问题关闭 |
| 把 `filesystem.core` 写成完整 Linux/POSIX 文件系统 | 当前代码与平台路线都不支持这么写 |
| 重写 B2/B3/A8-A10 原始历史文档 | 它们现在是 ancestry，不是直接规划入口 |
| 提前冻结完整 KV/D1/R2 production topology | handoff 仍要求 evidence-driven / staged assembly |

---

## 3. 当前应冻结的六个判断

| 判断 | 当前结论 | 主证据 |
|---|---|---|
| worker shell 是否存在 | **存在，而且已完成 W4 dry-run 验证** | `docs/issue/pre-worker-matrix/W4-closure.md:18-27,47-48`; `workers/filesystem-core/src/index.ts:1-22` |
| 当前 shell 是否已吸收 D1/D2 | **没有**；当前仍是 version-probe shell | `workers/filesystem-core/src/index.ts:5-22`; `docs/eval/worker-matrix/00-contexts/03-evaluations/current-worker-reality.md:20-22` |
| 当前真实 filesystem substance 在哪里 | **仍在 `@nano-agent/workspace-context-artifacts@0.1.0` 的 filesystem slice + `@nano-agent/storage-topology@2.0.0`** | `packages/workspace-context-artifacts/package.json:1-39`; `packages/storage-topology/package.json:1-43` |
| worker-matrix 吸收范围 | **D1 + D2 都归 `filesystem-core` 组** | `docs/design/pre-worker-matrix/W3-absorption-map.md:40-42,90-102` |
| 当前最扎实的 substrate | **`MountRouter + WorkspaceNamespace + backends + refs + promotion + adapters`** | `packages/workspace-context-artifacts/src/mounts.ts`; `namespace.ts`; `backends/*`; `promotion.ts`; `packages/storage-topology/src/*` |
| 当前最大缺口 | **shell 已在，但 absorbed runtime code、live remote service、worker-era workspace authority implementation 都还没在 `workers/filesystem-core/` 内闭合** | `docs/eval/worker-matrix/00-contexts/03-evaluations/current-worker-reality.md:20-22`; `packages/session-do-runtime/src/remote-bindings.ts:385-395` |

---

## 4. 现在最该怎么理解 `filesystem.core`

### 4.1 它已经同时有“壳”和“substrate”

今天的 `filesystem.core` 也要分两层看：

| 层 | 当前真实物体 | 现在能说明什么 |
|---|---|---|
| deploy shell | `workers/filesystem-core/` | W4 已把 worker 名字、wrangler shape、dry-run pipeline 变成物理事实 |
| workspace/storage substrate | `packages/workspace-context-artifacts/` 的 filesystem slice + `packages/storage-topology/` | D1/D2 的真实语义、adapters、refs、backends 都仍在 package 中 |

因此 r2 不应再写成：

> “先定义 filesystem-core 要不要成为一个 worker。”

而应写成：

> **“filesystem-core 已有 shell 与 substrate；下一步是完成 D1/D2 absorption，并决定 first-wave 是否继续 host-local / staged remoteize。”**

### 4.2 当前 shell 是诚实收窄，不是假装已经成形

`workers/filesystem-core` 当前只做：

1. 返回版本探针 JSON：`workers/filesystem-core/src/index.ts:5-22`
2. 保持 plain fetch shell：`workers/filesystem-core/README.md:1-26`
3. 维持 stateless shell，不激活 durable/service bindings：`workers/filesystem-core/wrangler.jsonc:1-22`

因此当前 deploy reality 只能写成：

> **filesystem-core shell exists, but authority/runtime absorption has not started inside that shell**

### 4.3 当前真正要被吸收的是 D1 + D2，不是“完整文件系统幻想”

W3 map 与 split blueprint 已经把这条路线冻结得很清楚：

1. `D1 = workspace-context-artifacts filesystem slice -> filesystem-core`
2. `D2 = storage-topology residual -> filesystem-core`
3. first-wave 不是把 KV/D1/R2 全部包装成完整 remote filesystem service

这意味着 r2 最不该做的 drift 是：

> 把 `filesystem.core` 从 “typed workspace/storage substrate” 拉回到一个 Linux/POSIX/全平台文件系统工程。

---

## 5. 推荐阅读顺序

1. **先读** `realized-code-evidence.md`  
   先把 shell、D1/D2 substrate、runtime gaps 的当前事实读清。

2. **再读** `internal-nacp-compliance.md`  
   看清它今天真正 formal 的 ref/key/path law 由谁拥有。

3. **再读** `external-contract-surface.md`  
   把 workspace package、fake-bash consumer、runtime seam、remote gap 区分开。

4. **最后读** `cloudflare-study-evidence.md`  
   把 shell reality、DO/R2/KV law、以及 just-bash 的 ancestry 放回平台层理解。

---

## 6. r2 现在不该再犯的三种错误

1. **把 `filesystem.core` 当成还没有 worker 壳的概念物**  
   `workers/filesystem-core` 已经存在。

2. **把 `filesystem.core` 写成完整 Linux/POSIX 文件系统**  
   当前 D1/D2 基线不支持这么写。

3. **把当前 shell 写成“已吸收并已 remoteized 的 filesystem worker”**  
   当前仓库里仍不成立。

---

## 7. ancestry-only 参考

需要补更早理由时，再回去看：

1. `docs/action-plan/after-foundations/B2-storage-adapter-hardening.md`
2. `docs/action-plan/after-foundations/B3-fake-bash-extension-and-port.md`
3. `docs/action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md`
4. `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`
5. `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`
6. `context/just-bash/*`

这些现在主要用来保留：

- 为什么 first-wave 必须薄做
- 为什么 workspace truth 必须是 typed mount universe
- 为什么不能把 overlay/full FS/Python/HTTPFS 心智直接照搬进来

不应用来覆盖：

- W3/W4/W5 之后的当前 shell reality
- D1/D2 absorption 作为当前执行基线的事实

---

## 8. 本索引的最终判断

**今天的 `filesystem.core` 应被写成：一个已经有 deploy shell、但真实语义仍主要在 D1/D2 packages 中的目标 worker。**

所以 `worker-matrix` r2 的正确问题不是“filesystem-core 是否存在”，而是：

> **如何把 `workspace-context-artifacts` 的 filesystem slice 与 `storage-topology` 吸收到 `workers/filesystem-core/`，同时保持 typed workspace/path/ref law、以及薄 worker 边界不漂移。**
