# agent.core — Cloudflare / deploy evidence

> 目标：只保留会直接影响 `worker-matrix` r2 的平台与部署事实。
> 当前最重要变化：pre-worker W4 已把 `agent-core` 从“设计名词”推进成“真实可部署 shell”。

---

## 0. 先给结论

**对 `agent.core` 来说，Cloudflare 平台侧现在最重要的结论已经不是“理论上能不能这样做”，而是：**

1. **以 Durable Object 作为 host 的 deploy 形状已经被真实落地**
2. **Wrangler deploy path 已被真实验证**
3. **当前 live reality 仍停留在 shell + DO stub，而不是完整 runtime assembly**
4. **service-binding activation 仍属于 worker-matrix 集成阶段，而不是 W4 既成事实**

---

## 1. 当前最直接的平台证据

| 类型 | 路径 | 说明 |
|---|---|---|
| W4 closure | `docs/issue/pre-worker-matrix/W4-closure.md` | 定义 shell、DO slot、preview deploy、future service slots |
| handoff | `docs/handoff/pre-worker-matrix-to-worker-matrix.md` | 把 W4 的 deploy reality 交给 r2 继承 |
| shell config | `workers/agent-core/wrangler.jsonc` | 证明 `SESSION_DO` active，其他 worker bindings 仍注释 |
| shell code | `workers/agent-core/src/index.ts`; `src/nano-session-do.ts` | 证明当前线上行为仍是 shell/probe |
| substrate env | `packages/session-do-runtime/src/env.ts`; `worker.ts` | 证明真实 runtime 的 Cloudflare binding mental model 仍存在 |

---

## 2. 当前已经被平台证实的四件事

### 2.1 `agent.core` 作为 Worker + DO 组合已经物理成立

当前硬证据：

- `workers/agent-core/wrangler.jsonc:14-27`
- `workers/agent-core/src/nano-session-do.ts:11-17`
- `docs/issue/pre-worker-matrix/W4-closure.md:18-27,63-71`

这说明：

> `agent.core` 继续以 DO 作为 host 物理核心，不再只是设计偏好。

### 2.2 deploy path 已被真实打通

W4 现在不再需要 credentials 假设分支：

- `docs/issue/pre-worker-matrix/W4-closure.md:22-27,124-145`

这条非常关键，因为它把 r2 的平台问题从：

> “是否能 deploy”

变成了：

> **“deploy 后先接什么 runtime / binding”**

### 2.3 当前 platform reality 仍是 host shell，不是 live matrix

`workers/agent-core/wrangler.jsonc:28-34` 已写清：

1. `BASH_CORE`
2. `CONTEXT_CORE`
3. `FILESYSTEM_CORE`

现在都还是 documented future slots。

因此当前 Cloudflare reality 不是“所有 worker 之间已 live 联通”，而是：

> **host shell 已部署，cross-worker live assembly 仍待 worker-matrix。**

### 2.4 当前 runtime substrate 仍保留 Cloudflare binding catalog mental model

`packages/session-do-runtime/src/env.ts:36-121` 仍冻结：

1. `SESSION_DO`
2. `R2_ARTIFACTS`
3. `KV_CONFIG`
4. `CAPABILITY_WORKER`
5. `HOOK_WORKER`
6. `FAKE_PROVIDER_WORKER`
7. `SKILL_WORKERS` reserved only

这说明：

> 即使 `workers/agent-core` 壳已经创建，Cloudflare-side runtime shape 也不是空白，仍有清晰的 binding/seam 模型可继承。

---

## 3. pre-worker 之后，平台问题已经被收窄成什么

| 旧问题 | 当前状态 | r2 应如何处理 |
|---|---|---|
| `agent.core` 是否适合用 DO | 已被当前 shell 与 substrate 双重证明 | 不再重开 |
| 是否有 deploy path | 已被 preview deploy 证明 | 不再重开 |
| 是否应该立即激活全部 service bindings | W4 明确没有做 | 在 r2 里安排集成顺序 |
| 是否已有 live downstream worker | 没有 | 诚实写为后续 assembly 工作 |

---

## 4. 仍需从 ancestry 继承的平台 law

虽然当前主入口已转到 pre-worker closure/handoff，但下面这些更早的平台 law 仍要保留：

1. cross-seam header 按 lowercase law 处理
2. DO 热状态与大对象路由分层
3. overflow / disclosure 不得 silent trim

这些 law 现在应通过：

- `docs/eval/worker-matrix/00-contexts/01-b8-handoff/*`
- `docs/eval/worker-matrix/00-contexts/04-templates/*`

来继承，而不是重新把 B8 旧文档当作直接 gate。

---

## 5. 对 r2 的直接含义

从 Cloudflare / deploy 角度看，`agent.core` 的 r2 写法现在应明确三件事：

1. **host deploy shell 已存在**
2. **真正的下一步是吸收 `session-do-runtime` 并接线，不是重建 wrangler topology**
3. **service-binding activation 要按 worker readiness 排序，不要把当前注释态 slots写成 live reality**

---

## 6. 本文件的最终判断

**今天的 Cloudflare 证据已经足以把 `agent.core` 定义为“真实可部署的 host shell + 待装配的 live runtime”。**

所以 worker-matrix r2 最该做的不是再证明平台可行，而是：

> **在既有 deploy shell 之上完成 host runtime absorption，并按节奏打开 downstream worker bindings。**
