# Plan Orchestration Facade — Reviewed by Opus

> **评审日期**:`2026-04-24`
> **评审人**:`Claude Opus 4.7 (1M context)`
> **被评审文档**:`docs/plan-orchestration-facade.md`(GPT-5.4 draft r0, 2026-04-24)
> **事实根据**:
> 1. `docs/plan-worker-matrix.md`(已 closed 阶段的 charter,提供 4-worker 真实代码锚点)
> 2. `workers/agent-core/src/host/**`(13,328 LOC,实际 live loop 已装配)
> 3. `workers/bash-core/src/**`(5,433 LOC,capability runtime 已吸收)
> 4. `context/smind-contexter/`(838 LOC src/ + 2,447 LOC core/ + 1,652 LOC context/ + ai/ + rag/,约 6k+ LOC 总量)
> 5. `test/INDEX.md` v0.2 记录的 35 个 live e2e 测试,全部以 `/sessions/:id/...` HTTP / WS 路由为入口

---

## 0. Executive Verdict

**方向我支持;scoping 与 sequencing 我有明确保留。**

GPT 起草的 charter 对下一阶段的**架构目标**描述是准确且有前瞻的:

> 把 nano-agent 从「runtime 暴露在外」升级成「public orchestrator + private runtime mesh」。

这个反转是对的。agent-core 当前同时承担「对外 session-facing ingress」和「downstream session runtime」两种身份,这**确实**是一个未了结的 layering error。worker-matrix 阶段成功把 runtime 装出来,但没有把 runtime 关到门内 — charter 选择的目标命中了这个缺口。

但 charter 在**工程上的**三处问题必须在 F0 冻结前解决,否则阶段很可能在 F3 灾难性超期:

1. **F1 的 value 是空的**。F1 只立 façade shell,但没有 F2 就没有事可做;要么接受 F1 只是 scaffold,要么把 F2 的一部分拉进 F1。
2. **F3 被严重低估为 M**。F3 要做的不是「把 agent-core 关门」,而是「把 35 个 live e2e + INDEX.md v0.2 + CLAUDE.md + 所有 preview 探针脚本整体迁移到 orchestrator 入口」,这是 L,不是 M。
3. **contexter 的「吸收面」被简化得太模糊**。charter §1.6 列了「吸收什么 / 不吸收什么」,但没有具体文件 / 模块 / 函数 级的 inventory。contexter 整个 src/ 其实只有 3 个文件(838 LOC),真正值得抄的是 chat.ts 的 **middleware + idFromName 模式**,而不是一整个「gateway + user DO」的抽象口号。

同时 charter 存在**一个根本性的自我拉扯**:

- §5.1 要求 orchestrator.core 「生产 initial_context」+「用户 / session registry」
- §4.2 O7 / §10.Q3 又把「完整 user-memory」推到下阶段
- §13.3 NOT-成功退出 #1 宣称「orchestrator.core 只是个 proxy = 失败」

这三条之间没有桥梁。如果 first-wave 的 orchestrator.core 既不做 user-memory,又不做 registry,又不能只是 proxy — **那它究竟做什么?** charter 必须在 F0 回答这个问题,否则 F1 建完 worker 也没事可做。

**最终立场:我 approve the charter direction,但建议 r0 → r1 在 F0.D 新增「first-wave orchestrator.core 职责 concrete inventory」节,并把 F3 上调到 L + 把 F4 拆成 F4.A(credit preflight)与 F4.B(execution-time recheck),F4.B 可延后。**

---

## 1. 事实校对 — charter 的前提在 4-worker 真实代码里成立吗

### 1.1 校对:agent-core「仍保留 public route shell」的表述

charter §2.1 表:

| 项目 | 当前真相 |
|---|---|
| `agent.core` | 已是 absorbed runtime + live loop;**仍保留 public route shell** |

这条表述在方向上对,但**「shell」**一词严重低估了现实。实际代码锚点:

- `workers/agent-core/src/index.ts:45-63` 路由 `/` + `/sessions/:id/ws` + `/sessions/:id/:action`
- `workers/agent-core/src/host/routes.ts:31-77` 解析 URL → `{websocket | http-fallback | not-found}`
- `workers/agent-core/src/host/http-controller.ts:17-26` `SUPPORTED_ACTIONS` = **7 个业务动作**:`start / input / cancel / end / status / timeline / verify`
- `workers/agent-core/src/host/ws-controller.ts` WebSocket ingress
- `workers/agent-core/src/host/session-edge.ts` acceptIngress 管线
- `workers/agent-core/src/host/do/nano-session-do.ts:676-705` `appendInitialContextLayer` consumer **已活化**
- `workers/agent-core/src/host/do/nano-session-do.ts:559` `verifyTenantBoundary` 已在 frame 接收时逐跳强制

换句话说:agent-core 不是**「尚有一点残留 public 形状」**,它**就是** public ingress:整套 NACP session 消息族(`session.start` / `session.followup_input` / `session.cancel` / `session.end` / …)都从这里的 HTTP / WS 面接入,并且 35 个 live e2e 测试**全部**建立在这套入口上。

**charter 的隐含假设** 是:把 agent-core 「降格」为 internal-only,不需要大动源代码,只需要加 orchestrator.core 接住客户端并 forward。

**真实成本** 是:要么(a)orchestrator.core 变成**一套 7-action HTTP + WS 代理**,protocol-for-protocol 把 NACP session 消息族过一遍;要么(b)重新定义一套 public API(JWT-first / CICP-like),然后在 orchestrator.core 内**翻译**到 NACP 内部协议。两条路都是 L-size 工作,不是 scaffolding。

**F0 必须明确走哪一条**。charter 默认是(b)—— §1.4「唯一允许把外部 JWT 翻译成内部 authority 的入口是 `orchestrator.core`」暗示有 translation — 但 §5.1 的 orchestrator 通道表又只写了 "public HTTP / WS ingress",没写「消息级翻译合约」。

### 1.2 校对:contexter「吸收什么」的表述

charter §1.6 + §5.1 说:

- 吸收 contexter 的「stateless gateway」「user-based DO façade」「upstream orchestration / session dispatch 视角」
- 不吸收「内嵌 context engine」「one-shot chat flow」「CICP 自有协议层」

这个分法在概念上对,但**具体到代码**,contexter 并不像 charter 里渲染的那样可以被「剪刀式」分离。实际 LOC 分布:

| 目录 | LOC | 性质 | charter 表述中的归属 |
|---|---|---|---|
| `src/chat.ts` | 276 | stateless gateway(itty-router + JWT middleware + CICP 封装)| **吸收** |
| `src/engine_do.ts` | 384 | user-based DO + WebSocket sessions map + dispatchCicpAction | **吸收**(但… 见下) |
| `src/index.ts` | 178 | worker entry + CORS + Logger init | 次要 |
| `core/jwt.ts` | 161 | JWT verify | **必须吸收**(否则 orchestrator 拿什么校验 JWT?)|
| `core/schemas_cicp.ts` | 406 | CICP 协议 schema | **不吸收**(GPT 明确) |
| `core/schemas_common.ts` | 236 | Env / Log schema | 部分吸收 |
| `core/db_do.ts` | 471 | DOSqliteManager(migrations / conversations / chats)| **未决**(charter 未谈)|
| `core/alarm.ts` | 228 | AlarmManager | **未决** |
| `core/log.ts` | 164 | Logger + 异步 D1 persist | **未决** |
| `core/broadcast.ts` | 260 | 向 WebSocket 广播 CICP packet | **未决** |
| `context/director.ts` | 446 | **业务编排**(RAG flow, intent analysis)| **不吸收** |
| `context/producer.ts` | 618 | RAG 资源层 | **不吸收** |
| `context/writer.ts` | 588 | RAG 准备层 | **不吸收** |
| `ai/*` | ~400 | intent / gen / vec / topK / topN | **不吸收** |

**关键观察**:

1. **engine_do.ts 不是一个纯粹的「gateway 镜像」**。它 `constructor()` 里同步装配 `DOSqliteManager`、`AlarmManager`、`Director`;它的 `fetch()` 兼顾 HTTP (CICP-over-HTTP) 与 WS Upgrade;`dispatchCicpAction` 里 `CLIENT_MSG_SUBMIT` 用 `waitUntil` 触发后台 `Director.handleUserMessage()`。**只吸收 DO 壳 + WS sessions map,等同于抛弃 engine_do.ts 里几乎所有有价值的代码**,剩下的基本上是一个空 DO 带 JWT header 解析。

2. **chat.ts 的可吸收核是 middleware 模式**:`withTrace`(62-77)、`withAuth`(79-112)、`getUserDOStub`(122-126)、`wrapInCicp`(132-153)。这四段代码是 contexter 所有 public ingress 的共同骨架,约 90 LOC。这个**才是**真正值得抄的部分。charter §1.6 的「stateless gateway 思路」如果能精确到这四段,后续 F1 就清晰得多。

3. **CICP vs NACP 是一整个协议栈的差异**,不是一个 envelope field 的差异。contexter 的 `CicpPacket` shape:`{trace_uuid, source, target, msg_type, msg_intent, input_payload, authority_payload, created_at}`,并且 `source` / `target` 是 gateway 内部角色命名(`chat_gateway` / `director` / `writer` / `producer`)。nano-agent 的 NACP envelope 是外部协议真相,angle 完全不同。**orchestrator.core 不能直接 reuse contexter 的 CicpPacket,它必须从头构造 NACP envelope**。charter §1.6 说对了,但没有写明:这意味着 `wrapInCicp()` 整函数都不能复用 — 只能拿 `withTrace` / `withAuth` 的模式 + 自写 `wrapInNacp()`。

4. **`core/jwt.ts` + `core/db_do.ts`(DOSqliteManager)** 对 orchestrator.core 来说是真实的基础设施需求。charter 没提这两个文件。如果 first-wave orchestrator.core 的 user DO 真的要存 user state(session registry、credit cache),**它需要 DOSqliteManager 或等价物**。这一点必须在 F0 明确:是抄 contexter 的 sqlite 风格,还是用 KV/DO storage 的纯 key-value 风格。

**建议**:F0 加一个 `contexter-absorption-inventory.md` 子文档,列所有 contexter 文件的 3 个 label:`adopt-as-is`、`adapt-pattern`、`discard`。具体对照:

| contexter 文件 | 建议 label | 具体怎么吸收 |
|---|---|---|
| `core/jwt.ts` | `adopt-as-is`(微调接口签名)| orchestrator.core `adapters/jwt.ts` |
| `src/chat.ts` middleware 四段 | `adapt-pattern` | orchestrator.core `facades/middleware.ts`(withTrace / withAuth / wrapInNacp) |
| `src/engine_do.ts` sessions-map + WS upgrade 壳 | `adapt-pattern` | orchestrator.core `user-do/ws-gateway.ts` |
| `core/db_do.ts` | **Q0 待定** | 是否需要 SQLite? 如果不需要,替换为 DO storage KV |
| `core/alarm.ts` | `defer` | first-wave 可能不需要 |
| `core/broadcast.ts` | `adapt-pattern` | 作为 stream relay 的参考 |
| `core/schemas_cicp.ts` | `discard` | NACP 是协议真相 |
| `context/*` + `ai/*` + `rag/*` | `discard` | 完全是业务层,与 façade 无关 |

### 1.3 校对:「只有 orchestrator.core 对外」的现实成本

charter §1.1 说 agent.core / bash.core / context.core / filesystem.core 全部降为 internal-only,「只通过 service binding 接收」。

事实核查:

- `workers/bash-core/src/index.ts:358-375` — bash-core 的 public HTTP 已是 **internal-only surface**:只有 `GET /` 探针 + `POST /capability/call` + `POST /capability/cancel`。没有业务 client-facing ingress。**bash.core 其实已经 internal-only 了**(worker-matrix P1.B 完成后即如此)。
- `workers/context-core/src/index.ts` / `workers/filesystem-core/src/index.ts` — 按 Q3c / Q4a 决策,它们是 host-local posture,**根本没有独立 public surface**,worker entry 只是 probe shell。这两个 worker 在 first-wave **就是** internal-only。
- 唯一真正需要「inwardize」的是 agent.core。

**这对 charter 的含义**:

1. §8.4 F3 说「`agent.core` 对 client-facing business routes 做 deprecation / inwardization,其余 3 worker 继续 internal-only posture」—— 这不是 4 个 worker 一起做的一件事,**它只是 agent.core 一个 worker 的事**。
2. F3 的正确标题应该是 「agent.core Public Surface Cutover」,不是「Runtime Inwardization」(泛指 4 个)。其余 3 个 worker **不需要任何动作**(除非 charter 额外要求它们 emit NACP trace_uuid + authority 在 service-binding 接收时严格校验,那是 F4 的事,不是 F3 的事)。

### 1.4 校对:§6.6 「No Big-Bang Transport Rewrite」与我之前的 restructuring 评审一致

这点和我在 `docs/eval/after-worker-matrix/restructuring-study-by-GPT.md` §8.4 的结论是一致的:**restructuring = 边界清理,不与 transport 切换并发**。charter 明确拒绝了那种激进方案,这是**工程成熟度的提升**。我为此 charter 的这点给一个 strong endorse。

---

## 2. Charter 的结构性问题:F1 是空的,F3 被低估

### 2.1 F1 的 value 空洞化风险

charter §8.2 F1 DoD:

1. `orchestrator-core` preview deploy 成功
2. JWT / trace / user DO routing smoke 全绿
3. public WS upgrade shell 可访问

**问题**:user DO 此时**还没有事做**。F1 结束时的 orchestrator.core 是:

- 一个 user DO (`idFromName(user_uuid)`) 但内部只做 `return stub.fetch(...)`
- JWT middleware 验证通过但 **没有下游**(F2 才补 agent.core seam)
- WS upgrade shell 接上了但**接到哪里**? 没有 F2,它只能连接一个空 DO

preview deploy 成功后,smoke test 究竟测什么? charter 说「routing smoke」— 即路由正确 = OK。但这种 smoke 不能证明 **任何业务价值**。F1 是一个**纯粹的脚手架 phase**,这本身不坏,但:

1. **它占一整个 F 的预算(`M`-size)**,这与 worker-matrix P1.B 相当 — 而 P1.B 吸收了 5,433 LOC 的 bash-core。orchestrator.core F1 只是 scaffolding,不应与之同预算。
2. **F1 没有独立 exit signal** 让 owner 判断「是否进入 F2」—— 因为 F1 的输出不是 runtime,而是 empty shell。这会让 F1 与 F2 的分界模糊,实际执行时一定会合并成一个 F1+F2 的「大 F2」。

**我的建议**:要么

- **合并 F1 + F2.A(session.start seam)** 到一个新 F1',deliverable 是「public WS 能发起 session.start,orchestrator user DO 真的把 frame dispatch 到 agent.core DO,agent.core emits session.stream.event 回来 relay 到 client」。这是**一个完整 roundtrip**,smoke test 有意义。
- 或者,**保留 F1 作为 scaffold,但把它降级为 F0.D**(与 F0 的 design-first 放一起),只花 `S` 预算,don't give it its own phase number。

### 2.2 F3 的 M-size 低估

charter §8.4 F3 In-Scope:

1. agent.core 对 client-facing business routes 做 deprecation / inwardization
2. 保留 `GET /` + `GET /health` + internal DO routing / binding consumption
3. bash / context / filesystem 继续 internal-only posture
4. live tests 全部改成经 orchestrator.core 进入

**问题聚焦在第 4 条**。现状:

- 35 个 live e2e 测试(node:test)在 `test/package-e2e/{agent-core,bash-core}/` + `test/cross-e2e/`,全部通过 `fetch(${workerUrl}/sessions/${id}/start)` 等 HTTP 路由命中 agent-core
- 具体验证动作:session lifecycle(start/input/cancel/end)、HTTP 405 asymmetry、verify drift guard、capability error envelopes、concurrent probe、malformed body validation、cross-seam mid-session binding、error envelope transparency

**把这些测试全部改走 orchestrator.core 的含义**:

1. orchestrator.core 必须提供**一个可用的 public client surface**,能接住 session.* 全套生命周期
2. 每个测试的入口 URL 要替换
3. 每个测试若目前 assert HTTP status(400 / 405 / 200),那些 status 是 agent.core 发的 — 如果 orchestrator.core 做中间层,它会**改写** status(至少是 401 JWT 相关的前置拒绝)
4. JWT auth 必须在测试里准备(每个测试 mint 一个 test JWT),这是 **全新 harness 工作**
5. INDEX.md v0.2 所有条目的 URL / action 描述需要重写 → v0.3

这一整块工作**单独作为一个 phase 都不为过**。charter 把它视为 F3 的一个 bullet 点,还 `M`-size,严重低估。

**量化估计**:

- 测试迁移:35 个 × 平均 15 分钟(修 URL + 加 JWT + 验证)= ~9 小时 纯测试代码
- orchestrator.core 的 session.* HTTP 代理实现:覆盖 7 个 HttpController action + WS upgrade + stream relay = ~1.5 天
- 文档更新:INDEX.md + CLAUDE.md + 所有 `docs/issue/worker-matrix/P*-closure.md` 中残留的 URL 引用 = ~0.5 天
- 保留 deprecated path 并添加 Deprecation header = ~0.25 天
- Preview redeploy + live 验证 = ~0.5 天

合计 ~3-4 工作单位,这是 L,不是 M。

**建议**:F3 拆成

- **F3.A**(M):实现 orchestrator.core 的 session.* public surface + JWT 前置
- **F3.B**(M):35 e2e 测试集体迁移到 orchestrator 入口 + INDEX.md v0.3 + docs 清理
- **F3.C**(S):agent.core 的旧 HTTP route 添加 `Deprecation: true` + `Sunset: <future>` header,保留兼容一段(**不立刻 410/426**,给 e2e 迁移一个过渡窗口)

### 2.3 F4 — credit/revocation 也被低估

charter §8.5 F4 要求:

1. authority no-escalation 规则
2. 任何 internal call 缺 trace_uuid / authority 非法
3. Zod / protocol validation 先于业务逻辑
4. 关键 side-effect 前 DB truth recheck(credit / quota / permission revocation / tenant scope)
5. denial / exhaustion / revocation 的 runtime 行为设计

**第 1-3 条**其实是**现有代码已经做到**的(见 `workers/agent-core/src/host/do/nano-session-do.ts:559` `verifyTenantBoundary` + B9 契约)。F4 需要的是把现状**升级为 explicit policy layer**(一个单独的 policy helper),加几个 test case。这是 `S`-size。

**第 4-5 条**才是真正的工作量。credit / quota / revocation **需要一个 truth source**。这个 truth source:

- 是 D1 / KV / R2 里的某张表?
- 还是另一个 worker(`credit.core`)?
- 如果是 D1,谁写入 credit 消费?是 orchestrator.core 还是 agent.core?是 tool.call 前还是 tool.call 后?
- revocation 是 push-based(admin 撤权 → 广播 → agent DO 收到 → 取消当前 turn)还是 pull-based(每 step 查一次 DB)?

这些是 **domain 级 design 决策**,charter 只说「建立 truth recheck」不够。这本质上是**一个微型 billing/auth domain 建设**,它和 façade 反转是**正交的**工作。

**建议**:

- **F4.A**(S):把已有的 authority validation 提炼为 explicit policy helper + zod-first 护栏 + negative tests
- **F4.B**(L,可延后):credit ledger / quota counter / revocation signal 的 domain 建设,**可以作为下一阶段 standalone charter**(charter §14 已经把 `billing / credit service` 列为下一阶段触发项 — 这条是对的)
- F4.B 从 first-wave 剥离,可以让 orchestration-facade charter 保持在一个 reasonable 的 5-phase 预算内

---

## 3. 关于 DO 身份:per-user vs per-session 分层是对的,但有三处要 tighten

### 3.1 §1.2 决定是正确的

per-user DO (`orchestrator.core`) + per-session DO (`agent.core`) 的分法**结构上正确**。理由:

1. per-user DO 承载的是**跨 session 的长期状态**(user memory / credit balance / active sessions 列表)
2. per-session DO 承载的是**单个 session 内的 turn loop + checkpoint**
3. 若把它们合并成 per-user,agent-core 会变成一个 multi-session actor,checkpoint 语义复杂化
4. 若把 orchestrator 也做成 per-session,跨 session 状态无处存放

contexter 的 engine_do.ts(384 LOC)就是 per-user DO 的实证:它 `idFromName(user_uuid)`,内部有 `sessions: Map<WebSocket, WebSocketData>`,每个 WS 连接对应**同一用户的不同 tab / 不同 client instance**。这是合理的 sharding 粒度。

### 3.2 但有三处必须在 F0 明确

#### (A) session_uuid 的 minting authority

charter §10.Q1 给出推荐答案「orchestrator.core 生成 session_uuid」。理由充分。但代码现状:

- `workers/agent-core/src/index.ts:61` `env.SESSION_DO.idFromName(sessionId)` — sessionId 直接来自 URL path,agent.core 不校验它的合法性
- `workers/agent-core/src/host/routes.ts:31-77` — URL pattern `/sessions/:sessionId/:action`

如果 orchestrator 开始 mint session_uuid,则:

1. **格式约束** 必须定义(UUIDv4? UUIDv7 time-ordered? ULID?)
2. **orchestrator 必须维护 user_uuid → {session_uuids} 的映射**,否则 client 二次请求时怎么知道该复用哪个 session_uuid?
3. **agent.core 必须拒绝未知 session_uuid**(或至少:当 orchestrator 没有预先告知时,agent.core 接到陌生 id 应该发 `system.notify` 报告,而非静默创建新 DO)

这三件事**都在 F0.A 或 F0.B 的范围内**,但 charter 没写。建议 F0.B 加一张「session_uuid lifecycle table」。

#### (B) user DO first-wave 职责的 concrete inventory(最关键)

§4.2 O7 延后「完整 user-memory engine」— 好。但这就产生了**空心化悖论**:

charter §5.1 列 orchestrator.core 职责:
- JWT / authn / tenant stamping ← 具体,有价值
- public HTTP / WebSocket ingress ← 具体,有价值
- upstream session bootstrap / attach / reconnect ← **需要 session registry**(数据在哪?)
- user/session registry ← **这就是状态,不能是空的**
- public stream relay ← 具体,有价值
- external identity → internal `authority` 翻译 ← 具体,有价值
- 生产 `initial_context` ← **需要知识源**(memory? config?)

`session registry` + `生产 initial_context` 这两条**要求 user DO 有 persistent state**。否则 §13.3 NOT-成功退出 #1「orchestrator.core 只是个 proxy」无法避免。

**我的建议**:F0 明确回答 Q0:「First-wave user DO 究竟存什么?」

推荐的**最小非空 schema**:

| 字段 | 类型 | 用途 | 为什么必须 first-wave 就有 |
|---|---|---|---|
| `user_uuid` | string | DO key | idFromName |
| `active_sessions` | `Map<session_uuid, {created_at, agent_do_id, last_seen}>` | session registry | attach/reconnect 必需 |
| `last_jwt_snapshot` | `{sub, realm, tenant_uuid, membership_level, source_name, exp}` | authority 翻译缓存 | 每次 JWT 重验有成本;快照 TTL 5 分钟即可 |
| `initial_context_seed` | `{user_memory_ref?: string, default_context_layers?: array}` | `生产 initial_context` 的最小信息 | 即使空也要有字段,以免 first-wave 后 schema migration |

**不应该 first-wave 就有的**:

- user memory(full RAG / conversation history)
- credit balance(放 F4.B)
- preference / config(next phase)

这张表**就是** orchestrator.core user DO 的 first-wave value proposition。没有它,第 1 天就会撞上「这个 worker 做什么?」的追问。

#### (C) reconnect 语义

charter §8.3 F2.C「attach / reconnect / relay / cancel」是一个 bullet,但 reconnect 在 per-user + per-session 双 DO 拓扑下是**非平凡**的:

- client 在 WS 断线后重连:WS hits orchestrator → orchestrator user DO 查 active_sessions → 找到 agent_do_id → 重新打开 agent.core 侧的 session?但 agent.core DO 可能已经 evict 了它的 checkpoint。
- 或者:agent.core DO 持续活着(per-session DO 自己管 lifecycle)→ orchestrator 只是重新建立 WS forward。但 agent.core 的 WS 一旦断开,内部 state.ws 也要 rehydrate。

这不是 F2 的 "relay" 能一笔带过的,应该有一个 `F2-reconnect-semantics.md` design memo。

---

## 4. 关于 Internal RPC / Transport — 方向正确,但有 1 个被忽略的协议细节

### 4.1 §1.3 + §6.3 + §6.6 的组合是正确的

charter 明确:

1. internal RPC 是 transport,不是安全模型本体(§1.3)
2. 内部只信 envelope — trace_uuid / authority / zod 校验三件套(§6.3)
3. 不搞 big-bang transport rewrite(§6.6)

这三条加起来是**成熟的工程立场**。与我之前在 `restructuring-study-by-GPT.md` 评审的立场一致。

### 4.2 但 session stream 是 **一对多 / long-lived**,不适合 service-binding fetch-response 模式

关键现实:

- `tool.call.*`:request / response 两条 message,短 lived,一次性 — **适合** service binding fetch
- `session.start` 由 client → orchestrator → agent:request 一次,但**响应是一个流**(session.stream.event 多条,跨多秒到多分钟)

现在 agent.core 的 WS ingress 把 stream.event 直接发给 client,**没有中间层**。如果 orchestrator 插入中间,stream 需要:

- 要么:orchestrator → agent 用 service-binding 发 start,agent → orchestrator 用**另一个方向的 service binding**(agent.core 作为 caller)push stream.event,orchestrator 再 forward 到 client WS
- 要么:orchestrator 在 user DO 里 hold 一个 WS 连到 agent.core DO(service binding 不支持 WS — Cloudflare service binding 只是 fetch)
- 要么:orchestrator → agent 用 service-binding 发 start,agent 返回一个 stream readable body(HTTP streaming response)→ orchestrator forward 这个流到 client WS

**只有第三种可行**。service binding 不能双向 WS,也不支持从 callee 发起反向调用(需要 agent.core 显式 fetch orchestrator.core — 可行但复杂)。

charter §5.1 / §5.2 提到 "stream relay" 但**没有说明哪一种机制**。这是 F0.B 必须冻结的一条决策:

> **session.stream.event 从 agent.core 流到 orchestrator.core,使用何种 transport mechanism?**

候选:

- (a) HTTP streaming response(Readable body chunked)— fetch-compatible,最简单
- (b) Durable Object RPC(Cloudflare 2024 新特性 `WorkerEntrypoint`) — 可以 bidirectional,但 charter §4.2 O4 明确延后
- (c) Queue-based relay — 太重,first-wave 不值
- (d) agent.core 作为 service-binding caller 反向 push 到 orchestrator.core — 需要 agent.core 知道 orchestrator 的 binding 名称,耦合方向反转

我推荐 (a),理由:

- 符合 §6.6 「no big-bang transport rewrite」
- fetch-streaming 在 Cloudflare Workers 里是成熟模式
- orchestrator.core 侧实现简单:`const res = await env.AGENT_CORE.fetch(...); res.body.pipeTo(wsWritable)`

但必须**在 F0.B 写死**,否则 F2 开始时会引发返工。

---

## 5. 对 5-worker 职责边界的两处补充

### 5.1 context.core 与 filesystem.core 的 posture 不变 — charter 说的对,但要加一句

charter §5.4 / §5.5 让 context.core / filesystem.core 继续「internal / library-worker posture」,这是正确的延续(worker-matrix Q3c / Q4a 已决)。

但 charter 遗漏一件事:**orchestrator.core 不直接与 context.core / filesystem.core 说话**。它们只被 agent.core 消费。charter 应在 §5.1 的 orchestrator 通道表里明确「orchestrator.core **不**直接 binding `CONTEXT_CORE` / `FILESYSTEM_CORE`」,否则 future PR 可能会误以为「反正都是 internal,binding 随便加」,把 orchestrator.core 变成跨 4 worker 的大路由器。

### 5.2 bash.core 的 policy gate 与 execution-time recheck 的交互

charter §5.3 bash.core 要求「authority / credit / policy gate 必须可接 execution-time recheck」。

这里的细节:bash.core 已有 `AllowAskDenyPolicy`(`packages/capability-runtime/src/policy.ts`)和 21-command registry with `policy: allow/ask/deny`。执行前 recheck 的落点应该是:

- `packages/capability-runtime/src/executor.ts::CapabilityExecutor.execute()`:在 policy.decide() 之后、handler invoke 之前 — 打一个 async hook 查 DB truth

这是**现实可落地**的 integration point,但 charter 没提。F4 的 action-plan 必须明确把这个 hook **打在 executor 里,而不是 bash.core worker-runtime**,否则会分散校验逻辑。

---

## 6. 对 Phase DAG 的看法 — 基本同意,两处建议

charter §9.2 的 DAG:

```
F0 → F1 → F2 → {F3 || F4} → F5
```

我的建议修正:

```
F0 → F1' → F2 → F3(split to A/B/C) → F4.A → F5
                                  └→ (F4.B deferred to next-phase charter)
```

**关键改动**:

- **F1 → F1'**:F1 合并 F2.A(最小 session.start seam)→ F1' deliverable = "public WS + user DO + 真实发出 session.start 到 agent.core + 拿到第一条 session.stream.event"。这让 F1 成为一个**可验证的 milestone**,而不是空 scaffold。
- **F3 拆 A/B/C**(见 §2.2)。
- **F4 拆 A/B,只做 A,B 推到下一阶段**(见 §2.3)。
- **F4 不再与 F3 并行**:F4.A 依赖 F3.A(orchestrator 已有 JWT → authority 翻译),所以应串行在 F3 之后。F3.B(测试迁移)可以与 F4.A 并行。

修正后的 DAG:

```
F0
 ↓
F1'(= old F1 + F2.A)
 ↓
F2(= old F2.B + F2.C only)
 ↓
F3.A(orchestrator 代 session.* surface)
 ├→ F3.B(e2e migration)
 └→ F4.A(authority policy hardening,串行依赖 F3.A)
         ↓
        F3.C(deprecate old agent.core HTTP)
         ↓
        F5
```

预估总工作量:

| Phase | GPT 原 size | 我的建议 size | 理由 |
|---|---|---|---|
| F0 | S | S | 一致 |
| F1(F1') | M | M | 合并 F2.A 后变得 meaningful |
| F2 | L | M | F2.A 移出后缩小 |
| F3 | M | L(= F3.A M + F3.B M + F3.C S) | 测试迁移是真实工作量 |
| F4 | M | S(F4.A)+ L deferred | credit 不能便宜做 |
| F5 | M | M | 一致 |

总计:原 charter S+M+L+M+M+M = ~24 单位;我建议 S+M+M+L+S+M = ~21 单位(等量但内部重新平衡)。

---

## 7. Charter 其它细节点评

### 7.1 Q1-Q6 owner decisions 的 opinion

| Q | GPT 推荐 | 我的看法 |
|---|---|---|
| Q1: 谁生成 session_uuid | orchestrator | ✅ 同意,但**必须**补 §3.2(A) 的 3 项细节 |
| Q2: public protocol 第一优先级 | WS-first + minimal HTTP bootstrap | ✅ 同意,与 contexter 实证一致 |
| Q3: first-wave user-memory scope | 只通过 initial_context 注入,不重写完整 engine | ✅ 同意,但必须配合 §3.2(B) 的 user-DO schema |
| Q4: first-wave internal transport | fetch-backed service binding | ✅ 同意,但必须在 F0.B 冻结 stream 机制(见 §4.2) |
| Q5: 旧 public agent.core 入口何时退役 | F3 全绿后 deprecated,再择机关闭 | ✅ 同意,建议具体化为 F3.C 添加 Deprecation header,不立刻 410 |
| Q6: credit/quota enforcement 第一落点 | orchestrator preflight + runtime recheck 双层 | ⚠️ 同意方向,但 F4.B 应延后 — first-wave 只做 preflight,runtime recheck 推到 credit charter |

### 7.2 关于 §13.3 NOT-成功退出识别

这五条 hard NOT-exit 非常好,但需要一条额外的:

> **NOT-exit #6:35 个现有 live e2e 测试未被显式迁移或保留为 internal verification suite**

没有这一条,F3 可以「技术上完成」而留下一堆未维护的 ghost tests。

### 7.3 关于命名

charter 里混用 `orchestrator-core`(目录)与 `orchestrator.core`(prose)— 与 worker-matrix charter 的 `agent-core` / `agent.core` 一致。这是已有惯例,保持即可。但**包名** charter 没提:`@nano-agent/orchestrator-core-worker`?`@haimang/orchestrator-core-worker`?现有 workers 用的是 `@haimang/agent-core-worker`(private)/ `@haimang/bash-core-worker`(private)。orchestrator 建议沿用 `@haimang/orchestrator-core-worker` 私有,因为它不发包。

### 7.4 关于 §4.3 的例外写法

> 「只有 `orchestrator.core` 对外提供业务级 public ingress;内部 workers 可以继续保留受控的 probe / health / preview verification 形状。」

这条表述我**强力认同**,与我在 `restructuring-study-by-GPT.md` §8.3 的立场一致。建议 charter 在这句话后面加一行 CLAUDE.md 约定:

> **禁止在 agent.core / bash.core / context.core / filesystem.core 新增任何业务性 public HTTP 或 WS route。已有 route 标记 `Deprecation: true` 并持续维护直到 chat/orchestrator E2E migration 完成。**

---

## 8. Final Verdict

### 8.1 我支持什么

1. ✅ **核心方向**:public orchestrator + private runtime mesh 的拓扑反转是**对的**,agent.core 现在确实背着两个身份。
2. ✅ **per-user DO + per-session DO 的分层**:概念上正确,contexter 的 engine_do.ts 有实证。
3. ✅ **NACP envelope 作为内部唯一可信语义**(§6.3):与 worker-matrix B9 契约一致,逐跳校验已有代码支撑。
4. ✅ **「不做 big-bang transport rewrite」**(§6.6):工程上成熟,与我之前 restructuring 评审一致。
5. ✅ **§4.3 的 probe 例外** 与 §1.1 的 internal-only 定义之间的区分**表达精确**。
6. ✅ **§13.3 NOT-exit 的 5 条**非常好,反退化门槛写得清楚。

### 8.2 我建议 charter r0 → r1 修改的地方

1. 🔧 **新增 F0.D:contexter absorption inventory**(§1.2),列 3-label 明细。
2. 🔧 **新增 F0.E:first-wave user DO concrete schema**(§3.2.B),至少 4 字段:user_uuid / active_sessions / last_jwt_snapshot / initial_context_seed。
3. 🔧 **新增 F0.F:session stream transport mechanism 冻结**(§4.2),推荐 HTTP streaming body 方案。
4. 🔧 **新增 F0.G:session_uuid minting + lifecycle + reconnect 语义表**(§3.2.A + §3.2.C)。
5. 🔧 **合并 F1 与 F2.A**(§6),让 F1' 有可验证 deliverable。
6. 🔧 **F3 拆成 A/B/C 三个子 phase**,并升级为 `L`(§2.2)。
7. 🔧 **F4 拆成 A/B,B 推到下一阶段 charter**(§2.3)。
8. 🔧 **新增 NOT-exit #6:35 个 live e2e 必须显式迁移**(§7.2)。
9. 🔧 **§8.4 F3 标题从「Runtime Inwardization」改为「Agent.core Public Surface Cutover」**(§1.3):其余 3 个 worker 不需要 inwardization 动作,这条名称准确化。
10. 🔧 **§4.3 后加一条 CLAUDE.md 级 「不得新增 public route」约定**(§7.4)。

### 8.3 我不会反对 charter 的(哪怕我认为可以更好)

- Q1-Q6 的**默认答案**:我认为全都成立,只是 Q1 / Q4 / Q6 需要具体化 execution plan(不是 answer 本身)。
- F0 是 design-first(§7.2)— 正确。
- §12 测试五层结构 — 正确,但**必须**加上「existing 35 e2e migration」。
- §14 下一阶段触发条件(productization / user-memory / transport / skill / credit)— 方向对。

### 8.4 一句话总结

> **Charter 的方向我接受,orchestrator.core 这一步 nano-agent 迟早要走,而且现在正是时机。**
>
> **但 r0 稿把「façade 建立」这件事的工程实际工作量低估了至少 30% —— 核心漏洞是 F1 空心化 + F3 严重低估 + contexter 吸收面未 concrete 化。**
>
> **r0 → r1 改造清单 10 条(见 §8.2)全部落地后,这份 charter 可以成为 after-worker-matrix 的正式基石文件。改造前它更像一份 vision memo,还不够 actionable 到支撑 P0 冻结。**

### 8.5 与之前 restructuring-study 评审的衔接

在 `docs/eval/after-worker-matrix/restructuring-study-by-GPT.md` §8 中,我提出过 **4-phase charter 草稿**:

- Phase 1 — agent-core 内部分层(host/ 解层)
- Phase 2 — @nano-agent/cf-adapters 抽取
- Phase 3 — HTTP deprecation 立法生效
- Phase 4 — 延后到 chat.core charter

现在 orchestration-facade charter 出现,**它等同于当时的 Phase 4**(chat.core = orchestrator.core 的旧名)。这意味着之前 §8 里提到的:

- **Phase 1**(agent-core 内部 host/ 解层):仍然有价值,但 charter 没把它列入。我建议作为**本 charter F3 的前置**或**并行独立 technical-debt PR**,避免 orchestrator.core 的新代码与 agent.core 的老 host/ 结构**同时扩张**,否则未来 cleanup 成本更高。
- **Phase 2**(cf-adapters 抽取):orchestrator.core 也需要 JWT / storage / RPC helper — 正好是 cf-adapters 的 seed。建议在 F0.D 时顺便评估是否把 cf-adapters 的首轮 6 个子目录**与** orchestrator.core 首批代码一起落地(共享 substrate)。
- **Phase 3**(HTTP deprecation lint rule):可以作为 F3.C 的一部分实现(禁止新增 public route 的 lint + CLAUDE.md 条目)。
- **Phase 4**(chat.core)= 本 charter。

所以 orchestration-facade charter **不是**单独的一件事,它与之前 Phase 1-3 构成同一次整体重组。F0 必须回答:「是分开做,还是合并做?」 我倾向**合并**,理由:

1. orchestrator.core 新代码如果直接用 cf-adapters(而不是散落引用 nacp-core/storage-topology),就少一次未来重构
2. agent.core 的 host/ 解层如果不趁 F3 做,以后动它的理由更稀薄
3. lint rule 应该 day-1 就位,避免 orchestrator.core 新代码无意违反

但这也意味着阶段总预算要上调一档,从 `~5 phase M-L` → `~6 phase M-L`。

---

## 9. 写给 owner 的一页纸总结

如果只读一段:

> **GPT 的 charter 在战略上是对的 —— orchestrator.core 是 nano-agent 下一步必走的路,per-user + per-session 双 DO 分层也是对的。但战术上 r0 稿低估了 3 件事:(1) F1 独立做没有 value,应与 F2.A 合并;(2) F3 不是 M-size,迁移 35 个 live e2e + docs + INDEX.md 是 L-size;(3) F4 credit 部分应延后到下一阶段独立 charter,first-wave 只做 authority policy hardening。同时 r0 对 contexter 的「吸收」描述太笼统 — contexter src/ 只有 838 LOC,真正可抄的是 chat.ts 的 `withTrace` / `withAuth` / `getUserDOStub` / `wrapInCicp` 四段 ~90 LOC,以及 engine_do.ts 的 WS sessions-map 模式 —— 建议 F0 加一份 concrete absorption inventory。如果接受我提出的 10 项 r0 → r1 修改(见 §8.2),这份 charter 可以作为 P0 冻结的基石文件;如果不改,F3 极有可能灾难性超期。**

---

## 10. 版本历史

- **r0 review(2026-04-24)**:对 GPT draft r0 的完整独立评审。结论:方向 approve,scoping / sequencing 需 10 项修改。Owner 决策见 §8.2。

---

## 11. GPT 附加回应 — 基于代码事实的复核与回应

### 11.1 总体回应（总）

**总体判断：Opus 这份评审是高质量、强事实驱动的，我确认其中大部分核心判断成立；但有两处证据表述需要校正，另外有几处属于“设计建议成立、但不能被表述成已由当前代码证明”。**

我对 Opus 观点的总回应可以收敛成三句话：

1. **我确认的主结论**：`orchestrator.core` 方向正确，但 r0 charter 确实把若干 first-wave 工程问题写得过于抽象，尤其是 `agent.core` 的 public ingress 现实、contexter 吸收面的具体化、`session_uuid` 生命周期、以及 F4 中 credit/revocation 的 domain 复杂度。
2. **我需要修正的两处事实表述**：
   - Opus 说“35 个 live e2e 测试**全部**以 `/sessions/:id/...` 为入口”，**这不符合当前测试树事实**。
   - Opus 说 stream relay “**只有第三种可行**（HTTP streaming response）”，**这不是当前仓库代码能证明的结论**；更准确的表述应是“F0 必须冻结一种机制，而 HTTP streaming 是当前最保守、最契合现有 fetch transport 的候选方案”。
3. **因此我对 Opus review 的最终响应不是简单的 approve / reject，而是**：
   - **采纳**其对 F0/F3/F4 的多数收紧建议；
   - **部分采纳**其对 F1 合并、stream 机制、user DO schema 的方案化建议；
   - **明确纠正**其对 live E2E 入口分布的一个过度概括。

下面进入逐项回应。

### 11.2 分项核查与回应（分）

#### 11.2.1 关于 “agent-core 不是残留 shell，而是当前 public ingress 本体” —— **我确认这个判断成立**

这条是 Opus 评审里最重要、也最扎实的一条。

**证据链：**

1. `workers/agent-core/src/index.ts:40-63` 不是“只返回 probe 的空壳”，而是：
   - 先处理 `GET /` 与 `GET /health`
   - 再调用 `routeRequest(request)`
   - 根据路由结果把请求转发到 `SESSION_DO.idFromName(sessionId)` 对应的 DO 实例
2. `workers/agent-core/src/host/routes.ts:27-75` 明确把：
   - `/sessions/:sessionId/ws`
   - `/sessions/:sessionId/:action`
   解析为 `websocket` / `http-fallback`
3. `workers/agent-core/src/host/http-controller.ts:18-26` 的 `SUPPORTED_ACTIONS` 已经是完整的 7-action business surface：
   - `start`
   - `input`
   - `cancel`
   - `end`
   - `status`
   - `timeline`
   - `verify`
4. `workers/agent-core/src/host/ws-controller.ts:19-83` 持有完整的 WS upgrade / message / close façade
5. `workers/agent-core/src/host/do/nano-session-do.ts:552-575` 已在 ingress pipeline 中 `await verifyTenantBoundary(...)`
6. `workers/agent-core/src/host/do/nano-session-do.ts:655-705` 也已经真实消费 `session.start.body.initial_context`

**结论：**

Opus 对这一点的加强是正确的：  
我在 charter r0 中把 `agent.core` 写成“仍保留 public route shell”，**方向对，但力度不够**。更准确的仓库真相是：

> **`agent.core` 当前就是 session-facing public ingress runtime edge，而不只是一个还没清理干净的 route shell。**

这会直接推高 F3 的复杂度，也意味着 F0 必须把“public façade 是代理型兼容，还是翻译型 façade”写死。

---

#### 11.2.2 关于 contexter 吸收面 “需要 concrete inventory” —— **我确认这个判断成立，而且这是 r0 最大缺口之一**

Opus 在这里不是否定“吸收 contexter 的编排价值”，而是要求把“吸收什么”落到文件级、模块级，这是对的。

**证据链：**

1. `context/smind-contexter/src/chat.ts:74-126,132-152` 里真正可直接借鉴的公共入口骨架非常清晰：
   - `withTrace`
   - `withAuth`
   - `getUserDOStub`
   - `wrapInCicp`
2. 其中：
   - `withTrace` / `withAuth` / `getUserDOStub` 是**模式级高复用资产**
   - `wrapInCicp` 则只能借“封装入口消息”的思路，**不能直接复用函数本身**，因为 nano-agent 的内部协议真相是 NACP，不是 CICP
3. `context/smind-contexter/core/jwt.ts:27-124` 是一个独立、边界清晰的 JWT 工具模块，这一类代码确实适合 `adopt-as-is` 或小改接口后吸收
4. 但 `context/smind-contexter/src/engine_do.ts:73-124,131-166,177-236` 并不是“纯 user DO 壳”：
   - 它在 constructor 中同步装了 `DOSqliteManager`
   - 装了 `AlarmManager`
   - 装了 `Director`
   - `fetch()` 同时兼顾 CICP-over-HTTP 与 WS
5. `context/smind-contexter/core/db_do.ts:123-184` 也不是一个“session registry 小工具”，而是完整的 DO SQLite persistence layer，承载 conversations / chats / contexts / vec_history / vec_intents 等业务数据

**结论：**

Opus 的批评成立：  
我在 charter r0 里写“吸收 stateless gateway / user-based DO façade / upstream orchestration 视角”，**概念上是对的，但还不够 actionable**。

更准确的应对方式不是抽象口号，而是补一份类似下面的 inventory：

| contexter 资产 | 复核结论 | 回应 |
|---|---|---|
| `core/jwt.ts` | **可吸收** | 适合 first-wave 直接复用或小改接口后迁入 |
| `src/chat.ts` 的 `withTrace` / `withAuth` / `getUserDOStub` | **应按 pattern 吸收** | 适合改写为 `wrapInNacp()` 版本 |
| `src/chat.ts` 的 `wrapInCicp` | **不可直接复用** | 因为协议层不兼容，必须重写成 NACP 入口封装 |
| `src/engine_do.ts` | **只能局部借模式** | 不能按“user DO façade”整体照搬 |
| `core/db_do.ts` | **first-wave 未决，不可默认吸收** | 需要在 F0 先决定 user DO 是否走 SQLite 模式 |
| `context/*` / `ai/*` / `rag/*` | **不属于 façade first-wave** | 与本阶段边界无关 |

这一点我接受 Opus 的建议：**F0 必须新增 concrete absorption inventory。**

---

#### 11.2.3 关于 “只有 agent-core 真正需要 inwardize，其余 3 worker 已经 internal-only” —— **我确认这个判断成立**

**证据链：**

1. `workers/bash-core/src/index.ts:348-375` 当前对外公开的只有：
   - `GET /`
   - `GET /health`
   - `POST /capability/call`
   - `POST /capability/cancel`
   它没有 client-facing session API
2. `workers/context-core/src/index.ts:17-29` 只接受 probe；其他路径统一 `404`
3. `workers/filesystem-core/src/index.ts:17-29` 同样只接受 probe；其他路径统一 `404`
4. `test/INDEX.md:88-100,114-117` 也把 `context-core` / `filesystem-core` 定义成 library-worker posture，并用 `/runtime -> 404` 守护这种姿势

**结论：**

Opus 这条判断成立，而且比我 r0 的标题更精确。  
对 first-wave 来说，真正要做“public surface cutover”的是 **`agent.core`**，不是 4 个 worker 一起做一轮 inwardization。

因此，Opus 建议把 F3 标题从泛化的 “Runtime Inwardization” 收紧成：

> **`agent.core` Public Surface Cutover**

这是有事实支撑的，我接受。

---

#### 11.2.4 关于 “35 个 live E2E 全部走 `/sessions/:id/...`” —— **这个说法我不接受；它与当前测试树事实不符**

这是 Opus review 中我唯一明确要纠正的事实性过度表述。

**证据链：**

1. `test/INDEX.md:31-32,51` 已明确当前 live E2E 是 **35 subtests**
2. 但这些 35 个 subtests 的入口并不统一：
   - `test/INDEX.md:66-75`：`agent-core` package-e2e 的 10 个 subtests 大多走 `/sessions/:id/...`
   - `test/INDEX.md:77-86`：`bash-core` 的 10 个 subtests 走的是 `/capability/call` / `/capability/cancel` / probe
   - `test/INDEX.md:88-100`：`context-core` / `filesystem-core` 的 4 个 subtests 走的是 `GET /` 与 `POST /runtime`
   - `test/INDEX.md:104-117`：cross-e2e 的 11 个 subtests 里，只有部分走 agent `/sessions/:id/...`；`01` 与 `10` 是四 worker probe，`07` 是 library worker `/runtime`
3. 直接代码搜索也证明了这一点：
   - `test/package-e2e/bash-core/*.test.mjs` 直接命中 `/capability/call` 与 `/capability/cancel`
   - `test/package-e2e/context-core/*.test.mjs` / `filesystem-core/*.test.mjs` 直接命中 `/runtime`
   - `test/cross-e2e/07-library-worker-topology-contract.test.mjs` 命中 `/runtime`
   - `test/cross-e2e/01-stack-preview-inventory.test.mjs` / `10-probe-concurrency-stability.test.mjs` 命中 `GET /`

**结论：**

“35 个 live E2E 全都建在 `/sessions/:id/...` 上”这个说法**不成立**。  
更准确的事实应是：

> **当前 35 个 live subtests 里，有一块“以 agent-core session ingress 为中心”的核心子集，但并不是全部测试都依赖这一路径。**

这会带来一个更细的判断：

1. **Opus 对 F3 被低估的总判断仍然成立**，因为：
   - `agent-core` package-e2e 的 10 个 subtests
   - 若干 cross-e2e（尤其 `02/03/04/05/06/08/09`）
   - `INDEX.md`
   - 若未来加 JWT harness，还要连带更新公共测试辅助层
   这些都确实会被切换影响
2. **但 F3 的证据基础不应写成 “35/35 都要迁移”**，否则会错误放大工作面

换句话说：**Opus 的风险判断是对的，但这一条举证需要修正。**

---

#### 11.2.5 关于 “F1 单独存在时价值偏空，应合并 F2.A 或降级为 scaffold milestone” —— **我部分接受这个判断**

这条更偏 sequencing judgement，而不是纯代码事实，但当前仓库状态确实支持 Opus 的担忧。

**证据链：**

1. 当前仓库里**还不存在** `workers/orchestrator-core/`
2. 现有上游唯一可类比的 public gateway 参考是 `context/smind-contexter/src/chat.ts`
3. 当前 runtime 的真正业务闭环仍在 `agent-core`
4. 如果 F1 只做到：
   - worker scaffold
   - JWT middleware
   - user DO routing
   - WS shell
   但还没有 `orchestrator -> agent` seam，那么它确实只能证明“壳起起来了”，**还不能证明 façade 真能承担 public responsibility**

**结论：**

我接受 Opus 的核心担心：

> **如果 F1 不带最小 roundtrip，它会更像 scaffold milestone，而不是一个有独立业务价值的 phase。**

但我不把它表述成“F1 必须被合并”这种单一答案。更精确的回应应是：

1. **Opus 的风险提示成立**
2. 可选修法至少有两种，二者都合理：
   - **方案 A**：合并 F1 + F2.A，让 F1' 至少能完成 `session.start` roundtrip
   - **方案 B**：保留 F1，但明确把它降级为 `S` 级 scaffold milestone，而不是完整功能 phase

也就是说，**我接受问题诊断，不强行接受唯一修法。**

---

#### 11.2.6 关于 “F4 应拆成 authority hardening 与 credit/revocation domain；后者不宜 first-wave 强绑” —— **我确认这个判断成立**

这条在代码事实层面非常清楚。

**证据链：**

1. 当前 authority / tenant boundary 的基础护栏并不是空白，而是已经存在：
   - `workers/agent-core/src/host/do/nano-session-do.ts:552-575`：`verifyTenantBoundary(...)`
   - `workers/agent-core/src/host/http-controller.ts`：所有 HTTP fallback frame 都先走结构化 message shape
   - 当前 ingress 已有 Zod / protocol gate + tenant verification 的组合
2. `packages/capability-runtime/src/policy.ts:22-48` 已经存在 `CapabilityPolicyGate`
3. `packages/capability-runtime/src/executor.ts:121-239` 当前执行顺序是：
   - 先 `policy.check(plan)`
   - 再处理 `ask/deny`
   - 再取 handler
   - 再真正执行 handler
4. 因此，若要加 execution-time recheck，最自然的插点确实是：
   - **在 `CapabilityExecutor.execute()` 中、policy 之后、handler invoke 之前**
5. 但另一方面，**仓库当前不存在任何已冻结的 credit truth source**
   - 没有 `credit` ledger schema
   - 没有 `quota` domain
   - 没有 revocation signal 机制
   - 没有一个明确的“谁写、谁扣、谁回查”的现成实现

**结论：**

Opus 这里的拆分建议是对的：

- **F4.A**：authority hardening / explicit policy layer / negative tests  
  这是建立在现有 runtime 真相上的收口工作，first-wave 应做
- **F4.B**：credit / quota / revocation 的 execution-time truth system  
  这是一个独立 domain 问题，不适合被写成 façade charter 中“顺手做掉”的一条 bullet

所以我在这条上明确采纳 Opus 的判断：**F4 应拆；其中 credit/revocation 半段应延后。**

---

#### 11.2.7 关于 “session_uuid minting / lifecycle / reconnect 语义必须在 F0 冻结” —— **我确认这个判断成立**

**证据链：**

1. 当前 live harness 生成 sessionId 的方式是 `test/shared/live.mjs:62-63`：
   - `randomSessionId() { return crypto.randomUUID(); }`
2. 当前 WS ingress 确实要求 UUID 形状：
   - `workers/agent-core/src/host/ws-controller.ts:30-63`
3. 但 HTTP path 当前并没有同等级的 UUID gate：
   - `workers/agent-core/src/index.ts:57-62` 直接把 `route.sessionId` 送进 `SESSION_DO.idFromName(sessionId)`
   - `workers/agent-core/src/host/routes.ts:52-71` 只要求 `sessionId` 非空
   - `workers/agent-core/src/host/http-controller.ts:96-101` 也只检查“非空”
4. `context/smind-contexter/src/engine_do.ts:60-67,177-236` 的 user-level DO 确实维护了 `sessions: Map<WebSocket, WebSocketData>` 这一类长期连接态

**结论：**

Opus 对这件事的要求完全成立。  
如果未来由 `orchestrator.core` 负责 mint `session_uuid`，那至少要在 F0 写清三件事：

1. **minting authority**
   - 谁生成
   - 什么格式
2. **registry truth**
   - user DO 保存什么映射
   - attach / reconnect 怎么查
3. **reconnect semantics**
   - 是重新绑定现有 session
   - 还是重新生成新 session 并回放

我也认同 Opus 的进一步建议：**应补一张 `session_uuid lifecycle table`。**

---

#### 11.2.8 关于 “stream relay 机制必须在 F0 冻结” —— **我部分接受；但我不接受把 HTTP streaming 写成‘代码已证明的唯一可行解’**

这条需要严格区分“代码事实”与“设计偏好”。

**当前代码能证明的事实只有这些：**

1. 当前 client stream 是 `agent.core -> client` 直接发
   - `agent-core` 现在持有 WS ingress / replay / timeline 路径
2. 当前已存在的 internal remote seam（例如 `agent -> bash`）是短生命周期 request/response
   - `workers/bash-core/src/index.ts:358-372`
   - `tool.call.*` 很适合 fetch-style internal RPC
3. 当前仓库**还没有**任何 “orchestrator 插在中间时的 stream relay transport” 实现

**因此我同意 Opus 的地方是：**

> F0 必须冻结 `agent.core -> orchestrator.core -> client` 的 stream relay 机制。

**但我不同意它表述成：**

> “只有第三种（HTTP streaming response）可行。”

因为这不是现有仓库代码能够证明的结论。  
在当前代码真相下，更严谨的说法应是：

1. **HTTP streaming** 是一个**强候选**
   - 与 fetch transport 相容
   - 与“不做 big-bang transport rewrite”相容
2. **但它还只是 first-wave 推荐方向，不是已由仓库现状排他证明的唯一解**

所以这条我的结论是：

- **采纳 Opus 的问题定义**
- **保留对其唯一性结论的修正**

---

#### 11.2.9 关于 “orchestrator 不应直接接 `context.core` / `filesystem.core`；execution-time recheck 应打在 executor 里” —— **这两条我都确认成立**

**证据链 A：orchestrator 不应直接接 context/filesystem**

1. 现有运行时绑定关系就是：
   - `AgentCoreEnv` 持有 `BASH_CORE? / CONTEXT_CORE? / FILESYSTEM_CORE?`
   - 见 `workers/agent-core/src/index.ts:6-13`
2. 当前 `context-core` / `filesystem-core` 的姿势都是 library-worker / host-consumed posture
   - `workers/context-core/src/index.ts:5-29`
   - `workers/filesystem-core/src/index.ts:5-29`
3. 当前仓库中不存在“上游 façade 直接调 context/filesystem”的任何既有路径

**结论 A：**

Opus 这里是对的。  
如果不把这句写清，后续 PR 很容易把 `orchestrator.core` 写成一个“到处打 binding 的超级路由器”，这是应该防止的退化。

**证据链 B：recheck 最自然落点在 executor**

1. `packages/capability-runtime/src/executor.ts:121-239` 已经是执行总入口
2. 这里天然拥有：
   - policy decision
   - requestId
   - execution target
   - handler invoke boundary
3. 若把 truth recheck 散落到 `bash-core worker-runtime` 或更外层，会造成：
   - 逻辑重复
   - target-specific drift
   - 难以统一 negative tests

**结论 B：**

Opus 关于 integration point 的建议是现实可落地的，我接受。

---

### 11.3 收束结论（总）

把上述逐项核查收束起来，我的最终回应是：

1. **Opus 对 r0 的主批评是成立的**：
   - `agent.core` 入口面被我写轻了
   - contexter 吸收面需要 concrete inventory
   - `session_uuid` 生命周期 / reconnect / user DO schema 需要 F0 冻结
   - F4 里 credit / revocation 不应被轻描淡写地塞进 façade charter
2. **Opus 对 phase sequencing 的主要担忧我也接受**：
   - F1 单独存在时确实容易空心化
   - F3 至少要上调复杂度，且更准确的标题应围绕 `agent.core` cutover
   - F4 应拆成 first-wave hardening 与 deferred domain build
3. **我保留的两条修正是**：
   - **不是 35/35 live E2E 都走 `/sessions/:id/...`**
   - **HTTP streaming 是强候选，但不是“当前代码已证明的唯一可行流 relay 机制”**

基于这次复核，如果把 review 落成面向 r1 的可执行修改项，我认为优先级最高的是下面 7 条：

1. 新增 **F0.D — contexter absorption inventory**
2. 新增 **F0.E — first-wave user DO concrete schema**
3. 新增 **F0.F — session_uuid minting / lifecycle / reconnect table**
4. 新增 **F0.G — session stream relay mechanism decision**
5. 把 **F3 改名并上调复杂度**，聚焦 `agent.core` public surface cutover
6. 把 **F4 拆成 A/B**，其中 credit/revocation domain 延后
7. 把 **existing live E2E migration** 作为 exit / NOT-exit 级显式项写进 charter

**一句话总结我的回应：**

> **Opus 对方向没有反对，对工程收紧的多数批评是成立的；我会把这份 review 视为“r0 vision memo 走向 r1 actionable charter”的有效校准，而不是对 charter 方向本身的否定。**
