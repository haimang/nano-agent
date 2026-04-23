# agent.core — external contract surface

> 目标：只回答 `worker-matrix` r2 还需要知道的外部边界。
> 当前关键变化：`workers/agent-core` 已物理存在并完成 preview deploy，但 live host runtime 仍未在该目录内装配完成。

---

## 0. 先给结论

**今天的 `agent.core` 外部面必须拆成两层来看：**

1. **当前真实 shell surface**：`workers/agent-core` 对外暴露的是 probe JSON + DO stub；
2. **当前真实 host surface 原型**：`@nano-agent/session-do-runtime` 仍定义 Worker/DO、WS/HTTP、remote seam、checkpoint/replay 的完整目标外部面。

如果把这两层混成一个“已经完成的 live host worker”，r2 就会把壳与组装状态写满。

---

## 1. 现在最该依赖的输入

| 类型 | 路径 | 用途 |
|---|---|---|
| W4 closure | `docs/issue/pre-worker-matrix/W4-closure.md` | 定义 W4 只交付 shell / preview deploy，不交付 live assembly |
| handoff | `docs/handoff/pre-worker-matrix-to-worker-matrix.md` | 明确 `agent.core` 继续是 host worker |
| shell code | `workers/agent-core/wrangler.jsonc`; `src/index.ts`; `src/nano-session-do.ts` | 证明当前部署外壳是什么 |
| host substrate | `packages/session-do-runtime/src/worker.ts`; `env.ts`; `http-controller.ts`; `remote-bindings.ts` | 证明目标 host 外部面原型已经存在 |

---

## 2. 当前 external surface 总表

| 层级 | 当前真实 surface | 当前不该误写成什么 |
|---|---|---|
| shell-facing | version probe + DO stub | live agent runtime |
| client-facing runtime | WebSocket-first + HTTP fallback 的 session host 原型 | 普通 REST worker |
| upstream-facing | `session.start.initial_context` 等 session wire hook | host 自己吞掉全部上游编排职责 |
| downstream-facing | remote seam catalog + documented future service slots | agent-core 自己执行全部 bash/context/filesystem 逻辑 |
| platform-facing | `SESSION_DO` active；preview deploy real | “所有 Cloudflare binding 都已启用” |

---

## 3. shell-facing：今天已经真实上线的东西

### 3.1 `workers/agent-core` 当前真的在暴露什么

当前 shell 行为非常窄：

- `fetch()` 返回 `worker / nacp_core_version / nacp_session_version / status / phase`：`workers/agent-core/src/index.ts:6-24`
- `NanoSessionDO.fetch()` 返回 DO stub JSON：`workers/agent-core/src/nano-session-do.ts:3-17`

因此今天对外最准确的表述是：

> **`workers/agent-core` 已是 deploy-shaped shell，但还不是 live session host runtime。**

### 3.2 W4 已把 preview deploy 变成真实事实

W4 closure 已明确：

1. `agent-core` preview deploy 已完成：`docs/issue/pre-worker-matrix/W4-closure.md:18-27,132-145`
2. 当前 live URL 为 `https://nano-agent-agent-core-preview.haimang.workers.dev`：`docs/handoff/pre-worker-matrix-to-worker-matrix.md:112-115`

这意味着 r2 不应再写“未来如果 owner 提供 credentials 才能部署 agent-core”。

---

## 4. client-facing：真正的 host 外部面原型仍在 `session-do-runtime`

### 4.1 Worker entry + DO host 这套外部面仍真实存在

当前 Worker/DO 原型在：

- `packages/session-do-runtime/src/worker.ts:1-89`
- `packages/session-do-runtime/src/do/nano-session-do.ts`

这套外部面的目标形状仍然是：

1. Worker 层只做 route + DO forwarding
2. DO 层承接 WebSocket、HTTP fallback、session lifecycle、checkpoint/replay

### 4.2 HTTP fallback 仍是真实 surface，但只是 host 原型的一部分

当前 `HttpController` 已有真实 action 面：

- `start / input / cancel / end / status / timeline`

但这些事实仍属于 `session-do-runtime` substrate，而不是 `workers/agent-core` 当前 shell 已直接暴露的 surface。

因此 r2 需要区分：

| 问题 | 当前答案 |
|---|---|
| `agent-core` 是否已有 host API 设计原型 | **有**，在 `session-do-runtime` |
| `workers/agent-core` 是否已把这套 host API 吸收并上线 | **没有** |

---

## 5. upstream-facing：`initial_context` 是当前最重要的外部 hook

协议层已给出正式上游入口：

- `packages/nacp-session/src/messages.ts`
- `packages/nacp-session/src/upstream-context.ts:1-42`

但当前 host reality 仍是：

- wire hook 已冻结
- host consumer 仍未在当前 runtime 中装配完成

所以 upstream-facing 的当前诚实表述应是：

> **上游可以合法发送 `initial_context`，但当前 worker shell 与当前 host substrate 都还不能宣称“已消费完成”。**

---

## 6. downstream-facing：当前只有 substrate seam 与 shell future slots

### 6.1 当前 shell 里 active 的只有 `SESSION_DO`

`workers/agent-core/wrangler.jsonc:14-34` 说明：

1. `SESSION_DO` 已 active
2. `BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE` 仍是注释态 future slots

这条非常关键，因为它意味着：

> 当前 preview deploy 不是 cross-worker live assembly deploy。

### 6.2 真正的 downstream seam catalog 仍在 `session-do-runtime`

当前 runtime env / composition truth 是：

- `CAPABILITY_WORKER`
- `HOOK_WORKER`
- `FAKE_PROVIDER_WORKER`
- `SKILL_WORKERS` reserved only

锚点：

- `packages/session-do-runtime/src/env.ts:36-121`
- `packages/session-do-runtime/src/remote-bindings.ts:324-399`

这说明：

1. worker-matrix 未来的 `BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE` 是 worker topology / deploy naming truth
2. 当前 runtime already-shipped seam 仍是 capability / hook / fake-provider binding catalog

两者不能混成一层。

---

## 7. platform-facing：当前外部平台面已比旧文档更具体

| 平台面 | 当前真相 |
|---|---|
| Durable Object | `workers/agent-core` 已激活 `SESSION_DO`; `session-do-runtime` 仍提供真实 host actor 设计原型 |
| Service bindings | 当前 shell 未激活下游 worker bindings；runtime substrate 仍保留 capability/hook/provider seam catalog |
| KV / R2 | W4 shell 故意未激活 owner-managed `KV_CONFIG / R2_ARTIFACTS` |
| Deploy path | real preview deploy 已被验证 |

这意味着 r2 不该再从“Cloudflare deploy 路径是否真实”开始写，而应从：

> **哪些 binding 先激活、哪些运行时代码先吸收** 开始写。

---

## 8. 对 r2 的直接要求

1. **把 `workers/agent-core` 与 `session-do-runtime` 视为同一目标 worker的两个当前层面**。
2. **不要把当前 preview shell 写成“完整 host API 已上线”**。
3. **不要把 W4 未激活的 service bindings 写成当前 live reality**。
4. **继续把 `agent.core` 写成 host worker，而不是 remote capability slot。**

---

## 9. 本文件的最终判断

**今天 `agent.core` 的外部面已经有真实 deploy shell，也有真实 host 原型，但这两层还没有合流。**

因此 worker-matrix r2 的正确写法是：

> **以当前 shell 为 deploy baseline，以 `session-do-runtime` 为 host-runtime baseline，规划二者在 `workers/agent-core/` 内的吸收与接线，而不是重写一套新的 agent 外部面。**
