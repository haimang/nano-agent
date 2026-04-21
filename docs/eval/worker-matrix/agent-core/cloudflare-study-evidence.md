# agent.core — cloudflare study evidence

> 目标：只保留那些会**直接改变 `agent.core` 设计判断**的 Cloudflare / DO / service binding / edge-native 证据，并给出每条证据的原始路径。

---

## 0. 先给结论

从 Cloudflare 侧看，`agent.core` 的最佳姿态已经不是抽象争论，而是被证据指向的结果：

1. **DO 非常适合作为 session host actor**；
2. **service binding 已足够支撑 first-wave remote seams**；
3. **cross-seam header 必须按 lowercase law 处理**；
4. **DO 只能承载小而密的热状态，大对象必须显式外送**；
5. **observability 不能依赖 silent overflow，host 必须保留 dedup + disclosure。**

---

## 1. 原始素材召回表

### 1.1 原始文档

| 类型 | 原始路径 | 关键行 / 章节 | 用途 |
|---|---|---|---|
| closure | `docs/issue/after-foundations/B8-phase-1-closure.md` | `38-56, 59-118` | B1-B7 → B8 的平台事实总表；含 DO cap / binding / R2 并发数字 |
| handoff | `docs/handoff/after-foundations-to-worker-matrix.md` | `31-89, 176-212, 224-242` | 给出 worker-matrix 可直接消费的平台 law 与 open gates |
| action-plan | `docs/action-plan/after-foundations/B8-worker-matrix-pre-convergence.md` | `52-66, 74-85, 152-188` | 说明 B8 为什么要把这些平台事实显式写进 handoff |

### 1.2 `context/` 参考实现

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| engineering design | `context/smind-contexter/app/design.txt` | `7-21, 23-50` | 证明 edge-native + DO actor + KV/R2/D1 组合不是抽象幻想 |
| gateway memo | `context/smind-contexter/app/plan-chat.ts.txt` | `9-22, 25-44, 82-98` | 证明 stateless gateway + DO + service binding 的外部面是现实可行形态 |
| EngineDO memo | `context/smind-contexter/app/plan-engine_do.ts.txt` | `8-21, 24-43, 90-108` | 证明单 DO actor 承担 session + ws + routing 是成熟心智模型 |
| gateway code | `context/smind-contexter/src/chat.ts` | `118-125, 183-210` | 证明 `idFromName(user_uuid)` + WS upgrade 透传是真实代码 |
| DO SQLite code | `context/smind-contexter/core/db_do.ts` | `123-183, 186-220` | 证明 DO 内 SQLite/状态表不是理论产物 |

### 1.3 当前仓库代码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| Worker/DO host | `packages/session-do-runtime/src/worker.ts` / `src/do/nano-session-do.ts` | `72-88` / `130-280` | 证明 `agent.core` 当前就已经是 Worker + DO 组合 |
| runtime env | `packages/session-do-runtime/src/env.ts` | `55-82` | 证明 service binding / R2 / KV 的当前绑定面 |

---

## 2. 直接影响 `agent.core` 的平台事实

| 证据项 | 原始事实 | 主证据 | 对 `agent.core` 的直接含义 |
|---|---|---|---|
| DO actor 形态 | DO 很适合作为 session host actor | `context/smind-contexter/app/design.txt:11-18, 41-49`; `context/smind-contexter/app/plan-engine_do.ts.txt:8-21, 24-43`; `packages/session-do-runtime/src/do/nano-session-do.ts:130-280` | `agent.core` 应继续以 DO 为物理核心，而不是退回无状态 monolith |
| binding-F01 | cross-worker abort propagation 是 native | `docs/issue/after-foundations/B8-phase-1-closure.md:72-76, 102-109` | host 可以把 timeout/cancel 真正向 remote seam 传播 |
| binding-F02 | `x-nacp-*` 头在 binding seam 上会 lowercased | `docs/issue/after-foundations/B8-phase-1-closure.md:72-75, 108-109` | host 的 cross-seam anchor 读取与比较必须 lowercase-safe |
| binding-F03 | cross-worker hook dispatch 低延迟、可行 | `docs/issue/after-foundations/B8-phase-1-closure.md:72-75, 109-110` | `HOOK_WORKER` 作为 first-wave remote seam 有现实基础 |
| binding-F04 | dedup + overflow disclosure 已在真实 push path 成立 | `docs/issue/after-foundations/B8-phase-1-closure.md:75-76, 106-107` | host 侧 event/eval sink 不可再 silent trim |
| F08 | DO value cap 的安全规划值应按 `2,097,152 bytes` 使用 | `docs/issue/after-foundations/B8-phase-1-closure.md:69-71, 102-104` | host 只能把小而密的 session 热状态留在 DO；大对象必须出站 |
| unexpected-F01 | R2 并发 put 的保守默认值可取 `50` | `docs/issue/after-foundations/B8-phase-1-closure.md:76, 105` | 若 host 参与 artifact/upload 路由，默认并发应保守 |

---

## 3. 这些平台事实如何约束 `agent.core`

## 3.1 `agent.core` 应该是“薄 host、强 session”，而不是“大对象处理中心”

`context/smind-contexter` 的工程设计与 B8 平台数字在这里高度一致：

- 设计侧强调 DO actor + KV/R2/D1 各司其职：`context/smind-contexter/app/design.txt:41-49`
- B8 平台侧给出明确 DO cap：`docs/issue/after-foundations/B8-phase-1-closure.md:102-104`

这两者合起来指向一个明确判断：

> `agent.core` 应把 session state、checkpoint、replay helper、ack/heartbeat、trace cursor 留在 DO；大 artifact、大 context blob、超 cap 数据必须显式走 R2 / artifact path。

## 3.2 service binding 现实可行，因此不应退回“全塞回一个 Worker”

如果只看抽象设计，我们或许还能争论 “worker-matrix 是不是太早”。  
但 B8 事实已经把这条争论基本结束了：

- abort propagation 是 live truth；
- hook dispatch latency 可接受；
- lowercase header law 已被真实路径验证；
- dedup/overflow disclosure 在真实 push path 已成立。

因此对 `agent.core` 的设计态度应该是：

> 继续把它当作 host worker，并大胆把 hooks / capability / provider 这类 seam 放到 remote worker；不要因为担心 transport 不成熟，又缩回单 Worker monolith。

## 3.3 lowercase header law 是 host 的硬纪律

`binding-F02` 证明 `x-nacp-*` headers 到 cross-worker 边界时会统一小写：`docs/issue/after-foundations/B8-phase-1-closure.md:108-109`。

这条对 `agent.core` 比对普通 remote worker 更重要，因为 host 负责：

- trace correlation；
- session identity propagation；
- tenant/team context propagation；
- request correlation。

因此任何 host-side downstream 设计都必须：

1. lowercase 写 header；
2. lowercase 读 header；
3. 测试里以 lowercase 为真相。

## 3.4 host observability 必须显式保留 dedup + overflow disclosure

`binding-F04` 给出的事实不是“有个 sink 能工作”，而是：

- duplicate drop 在真实 push path 可见；
- overflow count 与 disclosure 都可见：`docs/issue/after-foundations/B8-phase-1-closure.md:106-107`

这对 `agent.core` 的要求比对其他 worker 更高，因为它是：

- session stream 宿主；
- replay timeline 宿主；
- trace/eval 汇合点。

所以 host 层绝不能再接受“裁掉一点反正没人知道”的 silent overflow 心智。

## 3.5 `context/smind-contexter` 证明了“gateway → DO actor → 内部模块”这条 edge-native 心智是可理解的

你之前担心的一个重要问题，是脱离 Linux / shell / 本地 FS 之后，整个系统会不会变成一个反直觉架构。

`smind-contexter` 恰好提供了一个已存在的边缘原生对照物：

- gateway 是无状态 Worker：`context/smind-contexter/src/chat.ts:13-18, 183-210`
- host 是 per-user DO actor：`context/smind-contexter/app/plan-engine_do.ts.txt:8-21, 24-43`
- DO 内仍然可以维护数据库与状态：`context/smind-contexter/core/db_do.ts:123-183, 186-220`

这说明：

> “无状态 gateway + 有状态 DO host + 内部模块/下游服务”并不是不可理解的奇技淫巧，而是已经被其他 edge-native agent/RAG 系统采用过的架构形态。

---

## 4. 仍然开放的平台 gate

| gate | 当前状态 | 对 `agent.core` 的影响 |
|---|---|---|
| `F03_CROSS_COLO_ENABLED` | 仍 open | 不能把 cross-colo KV read-after-write 写成 host 的硬保证 |
| `F09_OWNER_URL_MISSING` | 仍 open | 不能把高强度远端网络行为写成“已验证能力” |

这两条不否定 `agent.core` 方向，但会影响后续：

- remote config/control plane 的一致性假设；
- 高负载 curl / network capability 的宣称边界。

---

## 5. 本文件的最终判断

平台证据对 `agent.core` 给出的最终指向很明确：

> **继续以 Durable Object 作为 session host 核心；把 remote seams 当成真实路径而不是未来幻想；把 lowercase header、DO cap、dedup/overflow disclosure、显式存储路由当成 host 纪律。**

这也是为什么 `agent.core` 在 worker-matrix 里应该首先被建模为 **host worker**，而不是被降格回某个普通 binding slot。
