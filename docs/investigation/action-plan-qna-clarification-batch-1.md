# Action-Plan Q&A Clarification — Batch 1

> 说明对象:
> - `docs/action-plan/hooks.md`
> - `docs/action-plan/eval-observability.md`
> - `docs/action-plan/storage-topology.md`
> - `docs/action-plan/session-do-runtime.md`
> 日期: `2026-04-16`
> 作者: `GPT-5.4`
> 说明依据:
> - `README.md`
> - `docs/action-plan/nacp-session.md`
> - `packages/nacp-core/src/envelope.ts`
> - `packages/nacp-core/src/tenancy/boundary.ts`
> - `packages/nacp-session/src/messages.ts`
> - `packages/nacp-session/src/stream-event.ts`
> - `packages/nacp-session/src/websocket.ts`
> - `context/smcp/src/schemas/common.ts`

---

## 1. 先说结论：这些问题为什么会同时出现

你现在看到的这些 Q，不是在问“产品愿景要不要变”，而是在问：

> **在 nano-agent 的第一版骨架里，哪些边界要先冻结，哪些边界要刻意留白。**

它们本质上都属于同一类问题：

1. **哪些东西已经有协议真相，不能在 runtime 里私自发明**
2. **哪些东西现在还没有协议真相，必须先用最小方案打通**
3. **哪些东西未来一定会更复杂，但 v1 不应该提前背负**
4. **哪些东西如果不先说清楚，会让几个 package 的边界互相打架**

你觉得“看不懂”，不是你的问题，而是这些问题来自 **4 份不同 action-plan**，每份文档都各自从 `Q1` 开始编号，所以它们放在一起看时非常容易失去上下文。

因此，这份澄清文档会把它们重新组织成 **Batch-1 / Q1-Q5**：

| Batch-1 编号 | 原始来源 | 原问题主题 |
|---|---|---|
| **Q1** | `hooks.md` | 是否允许 skill 在运行时注册会跨 resume 持久化的 session hooks |
| **Q2** | `hooks.md` | blocking hook 失败时，默认 fail-open 还是 fail-closed |
| **Q3** | `eval-observability.md` | 为什么实时观察走 WebSocket，而 HTTP fallback 只读 durable 产物 |
| **Q4** | `storage-topology.md` | 为什么 v1 先只支持 tenant-scoped key/ref，而不马上引入 `_platform` |
| **Q5** | `session-do-runtime.md` | 为什么首个 turn 先固定走 `session.start.initial_input` |

---

## 2. 这些 Q 背后的共同背景

### 2.1 现在 nano-agent 处于什么阶段

我们现在不是在做“最终产品规格书”，而是在做：

- **能跑起来的最小骨架**
- **能验证架构是否成立的 runtime**
- **能让后续 storage / hooks / observability / session 彼此对齐的基础层**

所以很多 Q 都不是在问“未来永远怎么做”，而是在问：

> **为了最小产品验证，我们现在到底要不要先把复杂度背上？**

### 2.2 为什么这些问题必须问，而不能“先写代码再说”

因为这些问题都直接影响 **协议、存储、恢复、审计、runtime 边界**。

一旦不先问清楚，最容易出现的情况就是：

1. `session-do-runtime` 为了方便，自己发明一种输入消息；
2. `storage-topology` 为了方便，先写死某种 key / checkpoint 结构；
3. `hooks` 为了方便，把失败策略写成默认放行或默认拦截；
4. `eval-observability` 为了方便，把 live stream 和 durable trace 混成一锅。

这样短期看像是“快了”，但后面所有包都会被前面的临时决定反向绑死。

---

## 3. Batch-1 / Q1 — 为什么要问“skill 是否能动态注册、并跨 resume 持久化 session hooks”

### 3.1 原问题

> `v1 是否允许 skill 在运行时注册会跨 resume 持久化的 session hooks？`

### 3.2 这个问题从哪来

`hooks.md` 里当前把 hook source 收敛成两层：

- `platform-policy`
- `session`

同时它又给未来保留了一个接口：

- `skill`

这意味着设计上已经承认：

> 将来 skill 可能不只是“被调用一次的能力”，它也可能在 session 生命周期里挂入新的 hook 行为。

例如：

1. 某个 skill 被激活后，要求未来所有 `PreToolUse` 都先经过它的参数审计；
2. 某个 skill 在一个 session 内临时加一条 `PreCompact` 守卫；
3. 某个 skill 想在后续每次 `UserPromptSubmit` 时插入一个规范化逻辑。

一旦允许这种能力，就会立刻出现一个更深的问题：

> 这些 hook 只是本次内存里临时存在，还是要在 session resume 之后继续存在？

### 3.3 它影响哪些真实地方

如果答案是 **允许，并且要跨 resume 持久化**，那就不只是多一个 API，而是要同时改变：

1. **HookRegistry 结构**
   - 现在只需要支持平台层和 session 层
   - 之后要增加 skill runtime source、注册时机、去重规则、优先级规则

2. **Session checkpoint / restore**
   - 持久化的不再只有 session 数据
   - 还要把 skill 注册出来的 hook catalog、handler ref、source 信息一起存下来

3. **安全模型**
   - skill 到底能注册哪些事件
   - 能不能注册 blocking hook
   - 能不能覆盖平台策略
   - 能不能影响后续所有 turn

4. **审计与解释性**
   - 恢复后为什么这个 hook 还存在
   - 它是谁注册的
   - 它现在还应该生效吗

### 3.4 这个问题真正让你做的选择是什么

它不是在问“我们要不要支持 skill 扩展能力”，而是在问：

| 选择 | 真正含义 |
|---|---|
| **选 Yes** | v1 就把 skill 当成能改变 session 生命周期行为的长期参与者 |
| **选 No** | v1 先把 hook 真相收敛在平台层和 session 层，skill 先只是普通能力提供者 |

### 3.5 我推荐的思路到底是什么意思

我在 action-plan 里的推荐不是“永远不支持”，而是：

> **v1 先不承诺“skill 动态注册且跨 resume 持久化”的能力。**

更精确地说，是：

1. **接口可以留**
   - 也就是代码结构上允许未来加这个能力

2. **默认不开放**
   - v1 不把它当成可依赖能力

3. **真相先只有两层**
   - `platform-policy`
   - `session`

### 3.6 为什么我推荐这样做

因为这是最符合 MVP 的收敛方式。

你当前要先验证的是：

- session actor 模型是否成立
- hooks 和 tool / compact / audit 的衔接是否成立
- resume / checkpoint / replay 是否稳定

而不是先验证：

- skill 能不能改写整个 session 生命周期

这类动态、持久、跨恢复的注册能力，一旦打开，复杂度会立刻进入“策略系统”级别，而不是“骨架验证”级别。

### 3.7 如果你采纳这个推荐，代码上会怎么执行

v1 的具体落地会是：

1. `HookRegistry` 只承认 `platform-policy` 和 `session` 为正式 source
2. `skill` source 只作为未来接口或 placeholder 类型
3. Session checkpoint **不承诺**要保存 skill 动态注册出来的 hooks
4. 若 skill 想影响 hook 行为，v1 只能通过：
   - 返回一个结果给 session runtime
   - 或通过明确的 session config 更新路径
   - 但不是“偷偷把自己挂到 hook registry 里并跨 resume 保留”

### 3.8 如果你反过来选 “Yes”，会立刻多出什么工作

至少要加：

1. `skill` source 的 schema
2. 注册 / 反注册 / 冲突解决规则
3. resume 后的恢复规则
4. skill hook 的配额、权限、可注册事件白名单
5. skill hook 的审计字段
6. 平台策略与 skill 注册冲突时谁优先

### 3.9 我的当前判断

**推荐 v1 选 No。**

不是因为这条路错，而是因为这条路属于 **第二阶段能力**，不是“验证骨架是否成立”的第一阶段能力。

---

## 4. Batch-1 / Q2 — 为什么要问“blocking hook 失败时是 fail-open 还是 fail-closed”

### 4.1 原问题

> `对于 PreToolUse / PreCompact 这类 blocking hook，远端 runtime 失败时的默认策略是否采用“平台策略 fail-closed，其余 fail-open”？`

### 4.2 这个问题从哪来

`hooks.md` 里最关键的两个 hook 事件是：

- `PreToolUse`
- `PreCompact`

它们不是纯观察型 hook，而是 **阻塞型 / 治理型 hook**。

也就是说，它们不是“看一眼然后记个日志”，而是：

- **PreToolUse**：工具调用前先过一道闸门
- **PreCompact**：compact 前先过一道闸门

如果 hook runtime 是远端的，比如通过 service binding 跑在别的 Worker 里，那么就一定会遇到：

1. 超时
2. 远端错误
3. binding 调用失败
4. 暂时不可用

这时系统必须决定：

> hook 没成功返回，到底默认继续执行，还是默认拦住？

### 4.3 它影响哪些真实地方

这个选择直接影响：

1. **安全**
   - 如果默认放行，平台策略失效时可能放出不该执行的 tool

2. **可用性**
   - 如果默认拦截，某个非关键 hook 抖一下就可能把整次 turn 卡死

3. **compact 正确性**
   - `PreCompact` 若默认放行，可能在不该 compact 的时候误 compact
   - 若默认拦截，也可能导致 session 一直不 compact，内存膨胀

4. **审计解释**
   - 出问题后要能回答：是 hook 明确允许了，还是 hook 根本没跑成功但系统默认放行了

### 4.4 这个问题真正让你做的选择是什么

它本质上是在问：

| 选择 | 真正含义 |
|---|---|
| **全部 fail-open** | 优先保证系统继续运行，接受治理可能失效 |
| **全部 fail-closed** | 优先保证治理不失效，接受系统可用性下降 |
| **按 source 区分** | 平台级治理严守，session/观察型 hook 更宽松 |

### 4.5 我推荐的思路到底是什么意思

我推荐的是第三种：

> **平台策略 fail-closed，其余 fail-open，并写审计。**

也就是：

1. **`platform-policy` source**
   - 默认 **fail-closed**
   - 因为它代表平台治理、权限边界、风险控制

2. **`session` source**
   - 默认 **fail-open**
   - 因为它更接近业务扩展或用户态 session 行为

3. **observer-like hook**
   - 默认 **fail-open**
   - 因为它的本意就不是强制拦截

4. **所有失败都写 audit**
   - 必须让系统后续能解释：这是规则明确拦下来的，还是 hook runtime 出错后的默认策略

### 4.6 为什么我推荐这样做

因为 nano-agent 是个平台型 runtime，而不是纯本地脚本。

平台型 runtime 里，平台策略通常承担的是：

- tool allow/deny
- compact guard
- 风险拦截
- 组织级治理

如果这些策略一旦 runtime 抖动就默认放行，平台治理就会形同虚设。

但另一方面，session 内的非平台 hook 若一律 fail-closed，又会让整个产品极端脆弱。

所以这不是“折中看起来漂亮”，而是：

> **把治理语义和扩展语义分开。**

### 4.7 如果你采纳这个推荐，代码上会怎么执行

具体会变成：

1. hook source 类型上显式带 `failure_policy`
2. dispatcher 在 timeout / error 时按 source 决策
3. blocking hook 返回聚合结果时要区分：
   - 显式 block
   - 显式 allow
   - runtime failure → fallback policy
4. `audit.record` 里必须能看见：
   - 哪个 hook source
   - 失败原因
   - 最终采用了哪条 fallback 决策

### 4.8 如果你反过来选其他方案，会怎样

- **全 fail-open**
  - 系统最好用
  - 但平台治理最弱

- **全 fail-closed**
  - 平台最保守
  - 但可用性最差
  - 一个远端 hook 小故障可能把整条主链路打断

### 4.9 我的当前判断

**推荐按 source 分层：平台 fail-closed，其余 fail-open。**

这更符合 nano-agent 既要平台治理、又要产品可用的目标。

---

## 5. Batch-1 / Q3 — 为什么“实时观察”要走 WebSocket，而 HTTP fallback 只读 durable 产物

### 5.1 原问题

> `v1 是否接受“实时观察走 WebSocket，HTTP fallback 只负责读取 durable 产物”的分层策略？`

### 5.2 你困惑的点非常合理：这里的“观察”到底是什么

这里的“观察”不是单指后台 observability，也不是单指“日志系统”。

它其实混合了两层含义：

1. **产品层实时观察**
   - 用户现在正在看这个 session 在干什么
   - 例如：token 正在流出、tool 正在执行、compact 正在发生

2. **系统层 durable 观察**
   - 我们事后要回放、调试、审计、分析
   - 例如：turn 何时开始/结束、tool 最终结果摘要、hook outcome 摘要、compact 边界

这两层观察不是一回事，所以不该用同一条存储/传输策略。

### 5.3 为什么说“实时观察”不是单纯日志

`packages/nacp-session/src/stream-event.ts` 已经把 server → client 的 live 事件收敛成 `session.stream.event`，里面至少有这些 kind：

- `llm.delta`
- `tool.call.progress`
- `tool.call.result`
- `hook.broadcast`
- `turn.begin`
- `turn.end`
- `compact.notify`
- `system.notify`
- `session.update`

这说明：

> 在 nano-agent 里，“观察”不是一个旁路日志功能，而是 **session runtime 对 client 的一等输出通道**。

换句话说，client 不是只想“事后看日志”，它还想：

1. 在 UI 上看到 token 正在流出
2. 看到 tool 正在跑进度
3. 看到 turn 开始 / 结束
4. 看到 compact / hook / system 通知

这本质上是 **产品实时交互**，不是仅仅 observability。

### 5.4 为什么这里优先是 WebSocket

因为 live 事件天然是：

- 连续的
- 高频的
- 有顺序的
- 需要低延迟
- 需要断线恢复语义

而 `nacp-session` 当前现实里，WebSocket helper 还已经具备：

- replay
- ack
- heartbeat
- resume

也就是 `SessionWebSocketHelper` 正在承担一个真正的 **实时 session 流协议**，不是普通的 request-response。

如果你把这些 live 事件都改成 HTTP 轮询，那么你马上要自己重造：

1. polling 周期
2. 增量读取 cursor
3. 顺序性
4. backpressure
5. 断线恢复
6. 高频 token / progress 的传输成本

所以从 runtime 角度说，WebSocket 不是“为了观测而选了个酷炫协议”，而是：

> **因为 session 本身就是流式、增量、持续连接的。**

### 5.5 那为什么还要 HTTP fallback

因为你前面明确提到过：

- 真实网络环境会劣化
- 有时 client 只剩 HTTP
- 不是所有环境都适合长连

这时 fallback 的作用不是“复制一条完整 WebSocket runtime”，而是：

> **保证在没有实时流的情况下，用户仍然能看见 durable 的会话结果与状态。**

所以 fallback 更像：

- 读 transcript
- 读 durable timeline
- 读最终结果
- 读当前 session 状态摘要

而不是：

- 逐 token 地实时同步
- 逐 chunk 地推 tool progress

### 5.6 这个问题真正让你做的选择是什么

它不是在问“观测是不是只能 HTTP 做”，而是在问：

| 选择 | 真正含义 |
|---|---|
| **WS 承担 live，HTTP 读 durable** | 传输层分工明确，实时链路和 durable 链路分离 |
| **HTTP 也要等价承担 live** | 要额外实现轮询 / SSE / 增量 cursor / 重放语义 |
| **只保留 HTTP** | 整个 session runtime 不再是 WebSocket-first，而会倒逼协议与 UX 重写 |

### 5.7 我推荐的思路到底是什么意思

我推荐的是：

> **实时观察坚持走 WebSocket；HTTP fallback 先只读 durable 结果与状态。**

这句话翻译成更具体的执行，就是：

1. 用户在线、网络正常时：
   - 用 WebSocket 看 `llm.delta`、`tool.call.progress`、`hook.broadcast` 等 live 事件

2. 用户断线、网络退化、或只剩 HTTP 环境时：
   - 改为 HTTP 拉 durable timeline、transcript、summary、最终结果

3. `eval-observability` 包里：
   - 不要求 Inspector / Runner 在 v1 就把 HTTP 做成与 WebSocket 完全等价的 live stream

### 5.8 为什么我推荐这样做

因为这正好对应你当前的产品目标：

- **核心体验**：实时 session
- **兜底能力**：可恢复、可读取、可回放

而不是：

- 先为了兼容所有网络情况，把 live runtime 做成一套最复杂的多传输协议系统

### 5.9 如果你采纳这个推荐，代码上会怎么执行

1. `session-do-runtime`
   - WebSocket path 负责 live push
   - HTTP path 负责 start/read/cancel/end 等最小入口和 durable read

2. `eval-observability`
   - live stream 不强制 durable 化
   - durable trace / transcript 通过 HTTP 读取

3. UI / client
   - 优先接 WebSocket
   - 失败时退到 HTTP 读状态和 durable 产物

### 5.10 如果你坚持“HTTP 也要做完整实时观察”，意味着什么

意味着你其实在要求 v1 同时设计：

- 轮询协议
- 或 SSE 协议
- 或长轮询增量协议
- cursor / offset / ack 语义
- 和 WebSocket 等价的顺序与恢复模型

这不是不行，但它已经明显超出“最小骨架验证”。

### 5.11 我的当前判断

**推荐：WebSocket 负责 live observation，HTTP fallback 负责 durable read。**

这不是贬低 HTTP，而是把两种链路分别放回它们最擅长的位置。

---

## 6. Batch-1 / Q4 — 为什么要问“v1 先只支持 tenant-scoped key/ref，暂不引入 `_platform` 例外”

### 6.1 原问题

> `v1 是否接受 storage-topology 先只支持 tenant-scoped key/ref reality，把 platform-global `_platform` 例外留到后续单独决策？`

### 6.2 你现在的困惑是什么

你问得非常关键：

> 这是不是意味着，我们得先做完整 SaaS identity / global platform 设计，才能继续？

答案是：

> **不是。恰恰相反，这个问题是在问：为了 MVP，我们要不要先不要把 platform-global storage 也背上。**

### 6.3 这个问题从哪来

当前代码 reality 里，NACP 已经把多租户边界写得很严格：

1. `NacpRefSchema` 要求 `ref.key` 必须以 `tenants/{team_uuid}/` 开头
2. `tenantR2* / tenantKv* / tenantDoStorage*` helpers 都默认在 key 前加 `tenants/{team_uuid}/`
3. `verifyTenantBoundary()` 会校验：
   - `authority.team_uuid`
   - `refs[*].team_uuid`
   - `refs[*].key` 前缀

这说明当前协议与 helper 的真实默认世界是：

> **所有可引用对象，默认都属于某个租户。**

但与此同时，`verifyTenantBoundary()` 里又保留了一个特殊值：

- `_platform`

而且只允许特定角色使用。

这意味着设计上已经暗示了：

> 将来可能存在“平台级、全局共享、非某个租户私有”的数据或调用身份。

例如：

- 全局 feature flags
- 平台默认 model registry
- 平台默认 hook policy
- 全局运营控制面配置

于是问题来了：

> v1 的 `storage-topology` 要不要立刻把这两套世界都支持完？

### 6.4 这个问题真正让你做的选择是什么

它本质上不是在问“要不要支持多租户”，而是在问：

| 选择 | 真正含义 |
|---|---|
| **只做 tenant-scoped reality** | v1 所有 key/ref/builder 先只围绕一个 team_uuid 工作 |
| **同时做 `_platform` 例外** | v1 就要把平台级全局存储、租户级存储、两者的读写规则一起设计 |

### 6.5 为什么这和“多租户控制面”不是一回事

这是最需要澄清的点。

你说的目标是：

> 最终由一个多租户管理系统对整个 nano-agent 发起 call 请求。

这件事和 `_platform` 不是同一个层面。

#### 第一层：调用身份 / authority

这对应的是：

- 谁在发请求
- 这个请求代表哪个 team
- 是否允许 delegation

这部分现在已经在 NACP / SMCP 风格里有原型：

- `authority.team_uuid`
- `plan_level`
- delegation / boundary verification

也就是说，**多租户调用身份模型** 已经有方向了。

#### 第二层：存储命名空间 / storage key reality

这对应的是：

- 某个对象存在哪
- key 怎么命名
- ref 怎么表示
- 平台级对象和租户级对象能不能共用一套 builder

Q4 问的是第二层，不是第一层。

所以它不是要你先设计完整 SaaS identity，而是在问：

> **在 v1 的 storage-topology 包里，我们要不要先把“平台全局对象”也做成正式支持的一类存储对象。**

### 6.6 为什么我会推荐“先只支持 tenant-scoped”

因为这更符合当前代码事实，也更符合 MVP 节奏。

如果你现在就要求 `storage-topology` 正式支持 `_platform`，你至少要额外回答：

1. `_platform` key 是否仍走 `NacpRefSchema`
2. 若 `NacpRefSchema` 现在强制 `tenants/{team_uuid}/...`，是否要改 schema
3. `tenantKvPut()` 这种 helper 是否还适用
4. 平台级对象是否允许被某租户 session 直接引用
5. 平台级对象与租户级 override 的优先级是什么
6. 平台级数据如何审计、缓存、下发

也就是说，你会立刻从“做最小存储语义层”升级为“设计平台配置系统”。

### 6.7 我推荐的思路到底是什么意思

我的推荐不是：

> “我们不做多租户平台”

而是：

> **v1 的 `storage-topology` 包，先只把 tenant-scoped world 做扎实；`_platform` 作为后续 follow-up 再纳入。**

这在执行上意味着：

1. 当前所有 builder / ref / key factory
   - 默认只支持 `team_uuid`

2. 当前所有 storage placement contract
   - 默认只描述“某个 team 的 session / artifact / config / archive”

3. `_platform`
   - 先作为已知未来方向
   - 但不在 v1 里强行落成正式 storage class

### 6.8 这会不会阻止你以后做全局控制面

不会。

因为全局控制面以后仍然可以通过两种方式接进来：

1. **协议身份层**
   - `_platform` producer / delegation / authority

2. **存储层 follow-up**
   - 后续补一个明确的 platform-global key/ref 规范
   - 再升级 builder / schema / policy

所以 Q4 的推荐本质上是：

> **先别在 v1 的 topology package 里，把“租户数据”和“平台全局数据”两套系统一起定死。**

### 6.9 如果你采纳这个推荐，代码上会怎么执行

1. `storage-topology` 的 builders 只接受 `team_uuid`
2. `NacpRef` 仍遵循 `tenants/{team_uuid}/...`
3. `tenantR2* / tenantKv* / tenantDoStorage*` 继续作为默认 helper
4. `_platform` 相关能力只在文档里保留 follow-up seam，不要求本轮实现

### 6.10 如果你反过来选“现在就支持 `_platform`”，会多出什么工作

至少要追加：

1. 平台级 key schema
2. 平台级 ref 表示方式
3. builder 与 helper 新分支
4. tenant → platform 读取规则
5. platform → tenant override 规则
6. 审计与访问控制规则

### 6.11 和 SMCP 多租户约定的关系

你提到参考 `smcp`，这个方向是对的。

从 `context/smcp` 现有 schema 可以看到，它已经把下面这类字段当作协议一等公民：

- `team_uuid`
- `invoker_user_uuid`
- `team_plan_level`

这说明 **“调用 authority 天然带 team 语义”** 是成熟方向。

但 SMCP 里这件事成立，并不自动推出：

> storage-topology v1 必须同时把“租户级存储”和“平台级全局存储”都设计完整。

所以 Q4 并不是在背离你想要的多租户平台，反而是在保护它：

> **先把租户边界做实，再把平台全局能力作为明确的第二层扩展引入。**

### 6.12 我的当前判断

**推荐 v1 先只支持 tenant-scoped key/ref reality。**

这不是往回缩，而是避免 storage-topology 在 MVP 阶段就提前变成整套平台配置系统。

---

## 7. Batch-1 / Q5 — 为什么要问“首个 turn 是否固定走 `session.start.initial_input`”

### 7.1 原问题

> `v1 是否同意把首个 turn 固定在 session.start.initial_input，上层 follow-up prompt family 另行补到 Session profile，而不是在 session-do-runtime 内自造消息？`

### 7.2 这个问题从哪来

当前 `nacp-session` 已冻结的 message set 只有这些：

- `session.start`
- `session.resume`
- `session.cancel`
- `session.end`
- `session.stream.event`
- `session.stream.ack`
- `session.heartbeat`

同时 `session.start` 的 body 里已经有：

- `initial_input`

但现在还没有一个正式的：

- `prompt.submit`
- `session.input`
- `user.message`

之类的 follow-up 输入消息。

因此问题不是“首条输入怎么写起来更漂亮”，而是：

> **现在的 Session profile 里，正常用户输入到底从哪条协议消息进来？**

### 7.3 它影响哪些真实地方

这个问题会直接影响：

1. **Session DO ingress dispatch**
   - 收到什么消息时开始 turn

2. **state machine**
   - turn 从哪个 message type 进入

3. **integration tests**
   - start-turn-resume 到底怎么写

4. **HTTP fallback**
   - start 请求是否自带第一条 input

5. **后续协议演进**
   - follow-up input family 未来怎么加，是否与当前 runtime 相冲突

### 7.4 这个问题真正让你做的选择是什么

它本质上是在问：

| 选择 | 真正含义 |
|---|---|
| **先用 `session.start.initial_input`** | 先打通最小 e2e，承认 follow-up prompt family 以后再补 |
| **现在就发明 runtime 私有输入消息** | session-do-runtime 先行定义协议，之后再让 `nacp-session` 追认 |
| **马上扩展 `nacp-session`** | 现在就把多轮输入协议作为正式工作项推进 |

### 7.5 我推荐的思路到底是什么意思

我推荐的是：

> **v1 先把首个 turn 固定走 `session.start.initial_input`；后续多轮输入 family，应该由 `nacp-session` 正式扩协议，而不是在 `session-do-runtime` 内私造消息。**

这句话的重点不是“永远只支持第一轮”，而是：

> **协议真相必须归 `nacp-session`，不能归 runtime assembly 层。**

### 7.6 为什么我推荐这样做

因为如果 `session-do-runtime` 先为了方便，私自搞一个“内部 prompt 消息”，就会出现：

1. runtime 能收
2. action-plan 里能跑
3. 但 protocol package 并不知道这条消息

这会让整个仓库重新出现“协议真相漂移”。

而你前面已经明确希望：

- 协议要先收口
- action-plan 之间要 coherent
- 运行时不要私发明协议

所以 Q5 的推荐本质上是在保护这个原则。

### 7.7 这会不会让 v1 只能做单轮

**在最小骨架验证阶段，是的，默认首先保证“首轮可打通”。**

但这不等于产品永远只能单轮。

它真正的含义是：

1. **先验证 session actor / start / turn / stream / resume 是真的能跑**
2. **再用一个小版本，把 follow-up input family 正式补进 `nacp-session`**

如果你现在就明确说：

> “不，我的 v1 产品验证必须包含多轮对话”

那也不是不能做。  
但正确做法是：

> **立刻给 `nacp-session` 新开一个小行动项，正式定义 follow-up input family。**

而不是让 `session-do-runtime` 偷偷兜底。

### 7.8 如果你采纳这个推荐，代码上会怎么执行

1. `session.start.body.initial_input`
   - 成为首个 turn 的正式入口

2. `session-do-runtime`
   - 只负责消费这个 reality
   - 不发明新的 wire message

3. `TurnIngressAdapter`
   - 可以为 future input family 预留接口
   - 但不在 v1 宣称已经有正式 follow-up prompt wire truth

4. 后续如果要多轮：
   - 在 `nacp-session` 正式补一条消息族
   - 例如 `session.input.submit` 或等价方案

### 7.9 如果你反过来选“runtime 自己先造消息”，会有什么问题

会立刻产生：

1. protocol 与 runtime 双真相
2. docs / tests / clients 三方对接不一致
3. 未来 `nacp-session` 正式扩协议时的迁移负担

### 7.10 我的当前判断

**推荐：首个 turn 先固定走 `session.start.initial_input`。**

如果你确认 v1 就必须多轮，那下一步应该是：

> **补 `nacp-session` 的 follow-up input family action item。**

而不是让 `session-do-runtime` 先偷着定义。

---

## 8. 我对这 5 个问题的整体建议

如果把“最小产品验证”的视角放到第一位，我当前推荐的组合是：

| Batch-1 问题 | 当前推荐 |
|---|---|
| **Q1 — skill 动态注册持久化 hooks** | **v1 先不开放**，只留接口 |
| **Q2 — blocking hook 失败策略** | **平台策略 fail-closed，其余 fail-open** |
| **Q3 — 实时观察与 fallback 分工** | **WebSocket 负责 live，HTTP 负责 durable read** |
| **Q4 — tenant-scoped vs `_platform`** | **v1 先只做 tenant-scoped** |
| **Q5 — 首个 turn 入口** | **先固定 `session.start.initial_input`** |

这 5 条放在一起，代表的是同一个方法论：

> **把 v1 的骨架做成“边界清楚、协议单一、恢复稳定、后续可扩”，而不是“现在就把所有未来复杂度提前兑现”。**

---

## 9. 如果你想继续推进，我建议下一步怎么问

如果你觉得现在已经能理解这些问题了，下一轮最适合继续明确的是下面两类：

1. **你希望 v1 验证到什么程度**
   - 只验证单轮 durable session skeleton？
   - 还是必须验证多轮？
   - 是否必须验证平台级全局配置？

2. **哪些“未来能力”你想提前纳入 v1**
   - skill 持久化 hook
   - follow-up input family
   - `_platform` key/ref
   - HTTP 等价实时流

因为这些不是“对错题”，而是 **v1 scope 决策题**。

---

## 10. 最后一段直白话

如果把这 5 个 Q 全都翻译成大白话，它们其实分别在问：

1. **Q1**：skill 现在先老老实实当能力，还是一上来就能改 session 生命周期？
2. **Q2**：规则服务挂了时，是优先保安全，还是优先不停机？
3. **Q3**：实时过程到底是直播，还是事后查日志？
4. **Q4**：v1 先把“每个租户自己的东西”做扎实，还是一开始就把“平台全局东西”也做完？
5. **Q5**：第一句话先走现有协议入口，还是让 runtime 自己偷偷造一条新入口？

我给的推荐，全部都站在同一个立场上：

> **先让骨架成立，再把复杂度按层次补回来。**
