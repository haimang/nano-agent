# NACP Reviewed by GPT

> 文档名: `nacp-reviewed-by-GPT`
> 审查日期: `2026-04-15`
> 审查者: `GPT-5.4`
> 审查对象: `docs/nacp-by-opus.md`
> 联合阅读材料:
> - `README.md`
> - `docs/value-proposition-analysis-by-opus.md`
> - `docs/value-proposition-analysis-by-GPT.md`
> - `docs/design/hooks-by-opus.md`
> - `docs/vpa-fake-bash-by-opus.md`
> - `context/smcp/README.md`
> - `context/smcp/src/schemas/common.ts`
> - `context/smcp/src/schemas/envelopes.ts`
> - `context/smcp/src/runtime/error_registry.ts`
> - `context/smcp/src/runtime/retry.ts`
> - `context/smcp/src/runtime/http.ts`
> - `context/smcp/src/compat/migrations.ts`
> - `context/safe/safe.py`
> - `context/safe/safe_transport.py`
> - `context/codex/codex-rs/app-server-protocol/src/jsonrpc_lite.rs`
> - `context/codex/codex-rs/protocol/src/lib.rs`
> - `context/claude-code/services/mcp/types.ts`
> - `context/claude-code/types/logs.ts`
> - `context/mini-agent/mini_agent/acp/__init__.py`
> 文档状态: `draft`

---

## 0. 总判断

**结论先说**：我同意 Opus 的大方向，**NACP 是必要的**，而且 nano-agent 如果真的要成为一个 **Cloudflare-native、service-composable、WebSocket-first、Durable-Object-centered** 的 agent runtime，那么它迟早都需要一份稳定的内部通信协议。

但我**不同意把 `docs/nacp-by-opus.md` 原样当作最终 v1 规范直接冻结**。这份稿子非常强，吸收 SMCP / SAFE 的方向也基本正确，但它当前有一个核心问题：

> **它把“内部 worker/DO 之间的消息合同”、“client ↔ session DO 的实时会话协议”、“外部 HTTP callback 边界协议”三层东西压得太紧了。**

这会带来三个最关键的断点：

1. **WebSocket-first 的会话恢复语义没有真正定义完成**  
   没有 sequence / cursor / replay / ack，DO hibernation 不会自动替你解决断线重连后的消息一致性。

2. **流式工具回传路径没有闭合**  
   `tool.call.progress` 被定义了，但在 `service-binding` / `WorkerEntrypoint RPC` 路径下，tool worker 如何持续把 progress 推回 session，没有真正说明白。

3. **client-facing protocol 和 internal runtime protocol 被混在一起**  
   `authority`、`consumer`、`hook.broadcast`、ACP naming 等设计，已经暴露出“内部合同”和“客户端 wire 协议”边界不清。

所以我的 verdict 不是“反对 NACP”，而是：

> **强烈支持 NACP 作为 nano-agent 的协议地基；但建议把它从“单一总协议”改成“一个 core envelope + 若干 profile/bridge”的协议家族。**

---

## 1. Opus 方案里我明确赞同的部分

先说优点，因为这份稿子不是空想，它已经非常接近一个可落地的协议骨架。

| 我赞同的点 | 为什么成立 | 来源脉络 |
|---|---|---|
| **7 字段扁平信封** | 比 SMCP 更适合 agent runtime；比 SAFE 更适合 TS 实现 | SAFE 的平铺结构 + SMCP 的 schema discipline |
| **authority / trace / control / body 分层** | 这是最重要的工程纪律，能避免“控制信息混进业务 payload” | SMCP / SAFE 都证明过 |
| **zod 作为单一 SOT** | TS 类型、runtime parse、JSON Schema 导出可以一套定义三处复用 | 比 claude-code 的纯类型联合更稳 |
| **refs 作为一等公民** | nano-agent 的上下文、文件、截图、audit 都不应塞进消息体 | 完全符合 Worker / R2 / DO 的现实 |
| **error registry + retry context** | 错误分类和重试决策必须协议化，否则每个 consumer 都会各写各的 | 这是 SMCP 最值得抄的部分之一 |
| **transport 与 envelope 解耦** | 非常正确，协议层不应该绑定具体 transport | SAFE `safe.py` / `safe_transport.py` 的分层值得继承 |
| **避免 JSON-RPC 2.0 历史包袱** | nano-agent 不需要为 `"jsonrpc":"2.0"` 背债 | codex 的做法是一个合理提醒 |
| **HMAC / size guard / deadline / idempotency** | 这些都不是“增强项”，而是云端系统的基本卫生 | 对 hooks / skills / queues 都重要 |

简单说，Opus 把 **SMCP 的声明式纪律**、**SAFE 的 validate 态度**、**codex 的 wire 简化意识**、**mini-agent/ACP 的 session 生命周期直觉**，拼成了一份对 nano-agent 很有方向感的初稿。这一点我完全认可。

---

## 2. 我对 Opus 方案的主要 critique

### 2.1 最大问题：协议边界压得过于扁平

Opus 的稿子实际上同时在做三件事：

1. 定义 **internal envelope**
2. 定义 **client ↔ session DO 的 WebSocket wire**
3. 定义 **HTTP callback / Queue / Service Binding 的 transport profile**

这三件事当然相关，但**不是一个稳定层次**。

**为什么这是问题**：

- internal worker/DO 协议追求的是 **可组合、可审计、可迁移**
- client-facing 协议追求的是 **易实现、低负担、可重连、可流式**
- HTTP callback 边界追求的是 **签名、防重放、最小暴露面**

把三者压成一个“统一 required message set + 统一 envelope 语义”，会让协议同时承担太多角色，最后任何一端都不够顺手。

**我建议的修正**：

- **NACP-Core**：worker / DO / queue / audit 间的内部信封
- **NACP-Session**：client ↔ session DO 的会话流协议
- **NACP-HTTP Profile**：外部 callback 的 ingress/egress profile
- **ACP Bridge**：对外兼容 ACP，但不是靠“命名相似”假装兼容

也就是说，**应统一的是 core envelope，不是所有 wire 形态都要完全同构。**

### 2.2 WebSocket-first，但没有真正定义“恢复协议”

Opus 正确抓住了 README 的核心：nano-agent 是 **WebSocket-first + DO hibernation**。但协议稿里关于 WebSocket 的判断，存在一个危险的乐观前提：

> “DO hibernation 存在，所以协议层不需要改变。”

我认为这不成立。

DO hibernation 解决的是 **空闲 CPU 成本**，不是：

- 浏览器/CLI 客户端断线重连
- 中间网络抖动导致的 frame 丢失
- client 恢复时不知道自己错过了哪些 `session.update`
- tool progress / hook event / audit push 的顺序重建

**现在的 NACP 草案缺少以下关键字段**：

- `sequence` 或 `event_seq`
- `replay_from`
- `last_seen_seq`
- `stream_id`
- `ack_required` / `delivery_mode`

没有这些，`session.update` 和 `hook.broadcast` 最终会变成“尽力而为的推送”，而不是一个 durable session runtime 应该拥有的**可恢复事件流**。

**这是我认为最大的 blind spot。**

### 2.3 `tool.call.progress` 的物理回传路径没有闭合

在消息类型注册表中，Opus 设计了：

- `tool.call.request`
- `tool.call.response`
- `tool.call.progress`
- `tool.call.cancel`

这在概念上是对的，但在 transport mapping 里，它又主张 v1 优先走：

- `WorkerEntrypoint RPC` / service-binding RPC

问题来了：

> 如果 `session DO -> tool worker` 是一次 RPC 调用，那么 tool worker 的 **progress** 要怎么持续回到 session？

这不是 schema 问题，而是**物理路径问题**。

它至少需要三选一：

1. tool worker 反向回调 session DO  
2. tool worker 把 progress 写入共享流 / DO storage，由 session 拉取  
3. 不把 progress 当 internal NACP message，而当 session stream event 从主 DO 统一转发

Opus 文稿还没有把这条链闭合，所以 `tool.call.progress` 目前是“存在于注册表”，但**没有闭合的运行时形态**。

这同样适用于：

- `hook.broadcast`
- 长时 `skill.invoke.*`
- 后续 browser / python / js sandbox 的增量输出

### 2.4 `authority` 一律必填，混淆了信任边界

Opus 借鉴 SAFE，把 authority 提升成协议一等公民，这是对的。

但它进一步提出：

> 在 client → server 的 WebSocket 消息里，`authority` 也不省略，客户端侧由鉴权层注入，协议内部永远必填。

这在 **internal envelope** 里成立，在 **external client wire** 里就很危险。

因为 client-facing 连接的事实是：

- authority 不是“客户端自己声明的事实”
- authority 是“服务端鉴权后得到的受信上下文”

如果把 authority 作为 client frame 的常规字段，会天然制造两层问题：

1. **责任错位**：客户端看起来像在“发送 authority”
2. **解析错觉**：下游模块可能误把“frame 中带了 authority”当成可信事实

**我的建议**：

- **NACP-Core** 内部消息：authority 必填
- **NACP-Session** 客户端消息：authority 不由客户端提供，由接入层注入，再进入 core

也就是说，**authority 应该是 server-stamped，不是 client-authored。**

### 2.5 全局 `REQUIRED` message set 不适合 nano-agent 的模块化结构

SAFE 的 `REQUIRED / OPTIONAL` 思路很好，但 Opus 这里直接把 16 个 message type 拉成全局 `NACP_MESSAGE_TYPES_REQUIRED`，我认为不适合 nano-agent。

原因很简单：

- skill worker 不需要处理 `session.start`
- client 不需要处理 `skill.invoke.request`
- compactor 不需要处理 `hook.broadcast`
- queue consumer 也不该被要求“支持 session 全套语义”

**nano-agent 的组件是角色化的，不是每个组件都应覆盖整个协议面。**

所以这里应改成：

- **core required fields**
- **per-profile required message families**
- **per-role supported message types**

否则，“required 集合”会从“启动时的健壮性检查”变成“无意义的全量承诺”。

### 2.6 `producer` / `consumer` 用封闭 enum，和 service-composable 愿景冲突

Opus 稿子里把 `producer` 和 `consumer` 定义成枚举：

- `nano-agent.session`
- `nano-agent.fake-bash`
- `nano-agent.hook`
- `nano-agent.skill`
- ...

这在项目 very early phase 里方便，但它和 README 的另一个核心主张冲突：

> nano-agent 要允许更多 skill / hook / capability 以 service binding 方式注册和扩展。

如果 producer/consumer 是 closed enum，那么每增加一个新 binding、一个新 capability worker、一个新插件来源，就要改协议枚举。这样协议反而会成为扩展瓶颈。

**更好的设计**应该是：

- `producer_role`: 受控枚举（session / hook / skill / client / platform / service）
- `producer_id`: 命名空间字符串（如 `nano-agent.skill.browser-render@v1`）
- `consumer_hint`: 可选字符串，而不是强约束 enum

这既保留了可观测性，又不牺牲扩展性。

### 2.7 `hook.broadcast` 不应该是 core message type

`hook.broadcast` 是一个典型例子，暴露了协议层次混淆：

- 它本质上是 **session stream / client push event**
- 不是一个所有内部模块都需要理解的 core business message

把它放进 core registry 会带来两个问题：

1. internal protocol 被 client-facing 事件污染
2. “redacted payload” 这种 audience-aware 逻辑被塞进 core message type

**我的建议**：

- Core 里保留 `hook.emit` / `hook.outcome`
- `hook.broadcast` 迁移到 `NACP-Session` profile

同理，`session.update` 也更像 session stream event，而不是所有 worker 通用的核心消息。

### 2.8 `ACP 兼容` 的说法目前还不够严格

Opus 提出：

> NACP 的 WebSocket lifecycle 故意和 ACP method 命名接近，未来可以写 bridge。

我觉得这个方向没问题，但这里需要非常明确：

> **命名相似不等于协议兼容。**

mini-agent 的 ACP 模式里有非常明确的：

- `initialize`
- `newSession`
- `prompt`
- `sessionUpdate`
- `cancel`

以及对应的 request/response/notification 关系。

如果 NACP 只是：

- `session.start`
- `session.update`
- `session.cancel`

却没有对 request/response、ack、error、resume、notification 的行为做同级定义，那它并不是真的“兼容 ACP”，只是**看起来像 ACP**。

我的建议是：

- 要么明确说：**NACP-Session 不是 ACP，只提供 bridge**
- 要么真的定义一个 ACP-compatible session profile

不要停在“命名风格接近”这一层。

### 2.9 运行时状态机没有进协议约束

NACP 现在定义了很多 message type，但没有真正定义：

- 哪些消息在哪个 session phase 合法
- 哪些消息必须成对出现
- 哪些 response 对应哪些 request
- 哪些 message_type 只能由哪些 producer_role 发出

这会导致一个问题：

> 消息 individually valid，但在 runtime sequence 上仍然非法。

例如：

- `session.cancel` 在 session 未运行时收到怎么办
- `tool.call.response` 对应不到 request_uuid 怎么办
- `context.compact.request` 没有 response 类型，谁知道 compact 何时完成
- `session.resume` 与 WebSocket reconnect 的关系是什么

SMCP 的 workflow contract 天然内嵌了一部分状态机；nano-agent 没有 workflow DSL，就更需要在协议或 profile 层写明 **state transition rules**。

### 2.10 代码骨架示例里已经暴露出几个技术断点

这不是大方向问题，而是我在 Opus 样例骨架里看到的几个具体断点：

1. **per-type body required 没被真正 enforce**  
   `validateEnvelope()` 里只有 `env.body !== undefined` 时才 parse body，这意味着 `tool.call.request` 没 body 也可能过掉 Layer 4。

2. **size guard 只在 encode 阶段做**  
   如果走 object RPC 或者 transport 自己 parse 了，size policy 就可能绕开。  
   size 限制应是 transport ingress policy + envelope policy 双层存在。

3. **deadline 被放进 validate 层**  
   这在语义上没错，但它其实是 runtime delivery policy，不完全等于 schema validation。  
   更准确的分层是：schema valid 之后，再做 deadline admissibility check。

4. **`context.compact.request` 没有 `.response`**  
   这会让 compact worker 的成功/失败回传没有稳定锚点。

这些不是不可修，但说明当前稿子**已经到了需要进入第二轮收敛**的时候，而不是直接冻结。

---

## 3. 我认为 Opus 方案的盲点与断点清单

| 类别 | 盲点 / 断点 | 为什么会出问题 | 我建议的修正 |
|---|---|---|---|
| 协议分层 | internal / session / HTTP callback 混层 | 一个协议承担三种稳定性诉求，最终三边都不够顺手 | 拆成 Core + Session + Transport Profiles |
| WebSocket | 无 `sequence / replay / cursor / ack` | WebSocket-first + DO hibernation 体系下无法可靠恢复事件流 | 增加 session stream sequencing 与 replay 机制 |
| 流式 tool | `tool.call.progress` 无闭合回传路径 | service-binding RPC 天然是 request/response，不是 server push | 引入 callback path / stream_id / session event bus |
| 权威上下文 | client frame 中 authority 常规化 | 混淆“用户声明”与“服务端鉴权后注入”的边界 | authority 只作为 server-stamped core 字段 |
| 消息注册表 | 全局 required set | 各角色只消费协议子集，全局 required 无实际意义 | 改为 per-role / per-profile required sets |
| 扩展性 | closed `producer/consumer` enum | 每新增 capability worker 都要改协议 | 拆成 `producer_role + producer_id` |
| 客户端事件 | `hook.broadcast` 进入 core | 把 audience/redaction 逻辑污染 core registry | 移到 Session profile |
| 兼容性 | ACP 只是“命名近似” | 会制造错误预期 | 明确 bridge，而不是口头兼容 |
| 状态机 | 无合法转移约束 | individually valid but globally invalid | 增加 lifecycle state rules |
| 安全/隐私 | redaction 不是协议一等概念 | audit / broadcast / client push 的可见性容易漂移 | 增加 audience / redaction metadata |
| 流控 | 无 backpressure / coalescing 规则 | 高频 `session.update` / progress 容易压爆 WS 客户端 | 加 session stream profile 的 flush/coalesce 规则 |
| 代码样例 | body required、size guard、compact response 等细节未闭合 | 规范与实现容易在第一版就分叉 | 第二轮先收紧骨架再实现 |

---

## 4. NACP 到底有没有必要

我的答案是：**非常必要，但必要的是“协议化的内部契约”，不是“一步到位的大一统超级协议”。**

### 4.1 为什么 nano-agent 比传统 CLI 更需要协议

传统本地 CLI 经常可以“不靠内部协议”也活得下去，因为：

- 很多状态在单进程内
- 很多调用靠函数引用传递
- shell / stdin / stdout 本身就是现成 wire

但 nano-agent 不是这个世界。

它天然就是：

- **session DO**
- **skill worker**
- **hook runtime**
- **fake bash capability facade**
- **context compactor**
- **queue consumer**
- **WebSocket client**

这些模块之间如果没有稳定协议，立刻会发生：

- 字段名漂移
- 不同模块各自序列化
- 错误语义不统一
- audit 无法聚合
- queue 版本兼容无法做

所以，**NACP 的必要性不是抽象上的“最好有”，而是工程上的“迟早要还”**。

### 4.2 为什么 SMCP / SAFE 对 nano-agent 特别有启发

因为 nano-agent 的宿主环境和它们的经验非常接近：

- 都是云端、多 worker、多阶段、异步、有审计需求
- 都需要 schema-first
- 都不能依赖“调用方和接收方在同一个内存里”

所以 Opus 借用 SMCP / SAFE 的哲学，我认为完全正确。

### 4.3 但必要性并不等于“现在就把所有外层都冻住”

我会把 NACP 的必要性拆成三个层次：

| 层次 | 必要性 | 说明 |
|---|---|---|
| **NACP-Core** | **必须立即做** | worker / DO / queue / audit 的统一合同 |
| **NACP-Session** | **必须尽早做** | WebSocket-first 产品形态无法绕过它，但需要单独考虑 sequence/replay |
| **NACP-HTTP / Queue 扩展 profile** | **按真实需求推进** | 不必在 day 1 全部实现，但结构应预留 |

所以我的判断是：

> **NACP 是必要的，但应该先把“核心合同”做对，而不是一开始就把所有 transport 与 client wire 一锅端。**

---

## 5. 我对 NACP 的补充说明与建议

### 5.1 我建议的重构：把 NACP 改成协议家族

#### A. `NACP-Core`

用于：

- session DO ↔ skill worker
- session DO ↔ hook runtime
- session DO ↔ compactor
- queue producer ↔ consumer
- audit record

包含：

- envelope
- authority
- trace
- control
- refs
- error / retry / idempotency
- core message registry

#### B. `NACP-Session`

用于：

- client ↔ session DO WebSocket

额外包含：

- `stream_seq`
- `resume_from_seq`
- `session_attach`
- `session_detach`
- `event_kind`
- coalescing / replay rules

如果要兼容 ACP，就在这一层做 bridge，而不是把 ACP 语义硬塞进 core。

#### C. `NACP-Transport Profiles`

用于：

- service-binding profile
- queue profile
- http-callback profile

它们规定的是：

- 哪些 header 必须存在
- size 限制
- 签名/验签
- 重试策略
- callback/reply 规则

而不是再重新发明一套 envelope。

### 5.2 我建议新增或调整的字段

| 字段 | 建议 | 原因 |
|---|---|---|
| `header.delivery_kind` | `command / response / event / error` | 明确消息语义，不只靠 `message_type` 猜 |
| `trace.stream_id` | 新增 | 流式 tool / hook / browser 输出需要稳定流 ID |
| `trace.stream_seq` | 新增 | 解决 WebSocket replay / 去重 / 顺序问题 |
| `control.reply_to` | 新增 | 比泛化的 `correlation_uuid` 更清楚 |
| `producer_role + producer_id` | 替代 closed enum `producer` | 兼顾可观测性与扩展性 |
| `audience` / `visibility` | 新增 | 区分 internal / audit / client-redacted |
| `redaction_hint` | 新增或附在 schema metadata | `hook.broadcast` / `session.update` 要安全裁剪 |

### 5.3 我建议调整消息注册表的分层

#### 应保留在 Core 的

- `tool.call.request`
- `tool.call.response`
- `skill.invoke.request`
- `skill.invoke.response`
- `hook.emit`
- `hook.outcome`
- `context.compact.request`
- `context.compact.response`
- `system.error`

#### 应迁移到 Session profile 的

- `session.start`
- `session.resume`
- `session.cancel`
- `session.update`
- `session.end`
- `tool.call.progress`
- `hook.broadcast`

也就是说，**凡是明显面向 client push / resume / stream UX 的，都不该再塞在 core registry 里。**

### 5.4 我建议补上的状态机约束

协议不该只有 shape，还应有最小行为规则，例如：

1. `session.start` 只能在 unattached/new 状态进入
2. `session.resume` 只能绑定已有 `session_uuid`
3. `tool.call.response` 必须关联已有 open request
4. `context.compact.request` 必须返回 terminal response 或 error
5. `session.cancel` 只能指向 active turn 或 active stream

这类规则不一定都写进 zod schema，但必须写进 NACP profile 文档。

### 5.5 我建议的实现顺序

1. **先做 `NACP-Core`**
   - envelope
   - core registry
   - error / retry / refs
   - internal worker / DO / queue path

2. **再做 `NACP-Session`**
   - WebSocket 子协议
   - sequence / replay / resume
   - ACP bridge

3. **最后做 `HTTP callback` 与 schema export**
   - HMAC
   - timestamp skew
   - JSON Schema for non-TS clients

这个顺序会比“先把所有 transport 一次性钉住”更安全。

---

## 6. 对 Opus 方案的最终评价

我对 `docs/nacp-by-opus.md` 的最终评价是：

> **这是一份质量很高、方向很准、足以成为正式规范前身的协议设计稿，但它还不是应该直接冻结的最终版。**

它最值得肯定的地方在于：

- 没有从零胡编，而是站在 **SMCP / SAFE** 的成熟经验上
- 没有被 JSON-RPC / gRPC / MCP 的现成名词绑架
- 很清楚 nano-agent 的真实宿主前提是 **Workers + DO + WebSocket + Service Binding**
- 把协议问题提升到了“项目地基”层，而不是“以后再补”

它最需要修正的地方在于：

- **别把 internal protocol、session stream protocol、external callback profile 混成一层**
- **别低估 WebSocket-first 场景下 replay / sequence / resume 的协议负担**
- **别让 core registry 吃下 transport-specific / audience-specific 的消息类型**

---

## 7. 最终 Verdict

### 7.1 关于 NACP 本身

**Verdict：必须做。**

没有 NACP，nano-agent 后面的 hooks / skills / fake bash / compactor / queue / audit 全都会在各自的局部最优里分叉，最终丢掉平台化能力。

### 7.2 关于 Opus 的这份 NACP 草案

**Verdict：强烈保留，不能原样冻结。**

它已经足够成为：

- `NACP-Core` 的第一版 SOT
- 协议设计讨论的基准坐标
- 后续 session/profile 拆分的母稿

但在进入实现前，我建议先完成下面这一步：

> **把 `docs/nacp-by-opus.md` 从“单一总协议”重构为“core + session + transport profiles”的协议家族设计。**

### 7.3 一句话总评

> **NACP 的必要性没有问题，真正的问题不是“要不要协议化”，而是“协议边界怎么切”。Opus 已经把方向选对了；下一步不是推倒重来，而是做一次关键的分层收敛。只要把 internal envelope、session stream、transport profile 三层切开，NACP 就会从一份优秀草案，变成 nano-agent 最重要的基础设施之一。**
