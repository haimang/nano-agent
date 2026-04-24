# Plan Orchestration Facade — 2nd-Pass Review by Opus

> **评审日期**:`2026-04-24`
> **评审人**:`Claude Opus 4.7 (1M context)`
> **被评审文档**:`docs/plan-orchestration-facade.md`(GPT-5.4 r1 full rewrite, 2026-04-24)
> **前置材料**:
> 1. `docs/plan-orchestration-facade-reviewed-by-opus.md`(1st-pass review)
> 2. 同上文件 §11(GPT 对 1st-pass 的事实复核回应)
> **事实根据**:
> - `workers/**/src/`(agent-core 13.3k / bash-core 5.4k / context-core 4.6k / filesystem-core 4k LOC)
> - `test/{package-e2e,cross-e2e}/*.test.mjs`(26 个测试文件,35 subtests)
> - `context/smind-contexter/{src,core,context,ai,rag}/`(~6k LOC)
> - `packages/capability-runtime/`(仍存在,但 workers/bash-core 已是 canonical copy)

---

## 0. Executive Summary

**r1 是一次真实且有力的收紧,它把 r0 的 vision memo 质感推进到 actionable charter 边缘。但还差一步 —— 至少还有 5 个新 gap 会让 F0-F5 执行时撞墙。**

### 0.1 三句话总结

1. **r1 把我 1st-pass 中的 10 项建议里的 8 项真正吸收了**(详见 §1 改进清单)。两项部分吸收(F1 合并 vs 拆分二选一;HTTP streaming 的「唯一性」表述已软化为「first-wave 执行决策」)。这个吸收率对一份 charter rewrite 而言是相当高的。
2. **GPT 对「35 个 e2e 入口分布」的事实纠正我接受**(§11.2.4)。我在 1st-pass 里的「全部走 `/sessions/:id/...`」是过度概括;实际代码证据是 12/26 个测试文件命中 session ingress。r1 §2.3 的分布表精准反映了真相。
3. **但 r1 仍有 5 个新 gap 会在 F1 启动后很快暴露:**
   - **G1**:「orchestrator → agent」方向的 **internal transport 合约** 未写死(与 stream 反向的 HTTP streaming 不是同一件事)
   - **G2**:「**tenant identity 从 env.TEAM_UUID 迁移到 JWT authority** 」的桥接未被任何 phase 承接
   - **G3**:**agent.core 的 WS ingress 在 F3 之后的归属** 未被 charter 回答 — 它是被 orchestrator 代理、被删除、还是变成 internal-only?
   - **G4**:**Deprecation window 的行为语义** 模糊 — cutover 后旧 `/sessions/:id/start` 是 200 OK + deprecation header,还是 410,还是 proxy?这三种对 test migration 影响完全不同
   - **G5**:**F1 合并后的工作量仍然被估为 M**,但 F1 内部已含 10 个 deliverables 跨 2 种 transport 方向,工程量趋于 L

### 0.2 Gap 定义

**「本阶段应该得到的最终成功」与「GPT r1 计划能产出的成果」之间的 gap** 可以用一句话描述:

> **r1 charter 能交付 "façade scaffold + user DO registry + compatibility public surface + affected e2e migrated + authority hardening + deprecation window",但它没有明确交付 "agent.core 作为 private runtime mesh 的 internal invocation 合约",而这个合约是后面所有架构价值(richer orchestrator / credit / user-memory)的唯一载体。** 一句话:**façade 建好了,但 façade 与 runtime 之间的 internal protocol 还悬在 tech-debt 状态。**

这个 gap 不会让本阶段在 §14.1 的 6 条 exit criteria 上失败(六条全都绕开了 internal protocol 定义),但它会让**下一阶段**的 richer orchestrator charter 启动时发现:orchestrator 和 agent 之间是一段 **ad-hoc fetch 胶水**,没有 freeze 的 internal API contract。

**建议**:r1 → r2 的下一轮收紧,应当 **把 G1-G4 全部补上**,并把 F1 拆为 F1a / F1b 两个 M-phase(或把 F1 标为 L)。

---

## 1. r0 → r1 的真实改进清单(我确认的 8 项吸收)

### 1.1 完全吸收(8 项)

| r0 → r1 | 我的 1st-pass 建议 | r1 落实位置 | 评价 |
|---|---|---|---|
| `agent.core` 被表述为「public ingress 本体」而非 shell | 1st §1.1 | r1 §0.1, §1.2, §2.1, §17.3 | ✅ 完全吸收,表述精确 |
| F3 标题从 "Runtime Inwardization" 改为 "`agent.core` Public Surface Cutover" | 1st §7 建议 #9 | r1 §9.1 F3, §10.4 | ✅ 标题精确化 |
| F3 拆成 A/B/C 三子 phase 并升级为 L | 1st §2.2, §6 | r1 §9.1 F3 = `L`, §10.4 F3.A/B/C | ✅ 完整吸收 |
| F4 拆成 A/B,B 延后 | 1st §2.3 | r1 §1.7, §9.1 F4 = `S`, §10.5 | ✅ 完整吸收,credit 域正确推到下阶段 |
| contexter absorption 从口号变 concrete inventory | 1st §1.2, §8.2 #1 | r1 §5.2 逐文件表 | ✅ 表非常完整,12 项逐文件 label |
| first-wave user DO schema(4 字段最小非空) | 1st §3.2(B), §8.2 #2 | r1 §4.2 | ✅ 字段完全采用我的建议 |
| session_uuid minting / lifecycle / reconnect 表 | 1st §3.2(A)(C), §8.2 #3 | r1 §4.3(表), §4.4(memo 要求) | ✅ 含 5 阶段 lifecycle 表 + reconnect 独立 memo |
| NOT-exit #6:affected live E2E 必须显式迁移 | 1st §7.2 | r1 §14.3 #6 | ✅ 已作为硬闸 |

### 1.2 部分吸收 / 合理分歧(2 项)

| r0 → r1 | 我的 1st-pass 建议 | r1 处理 | 我的回应 |
|---|---|---|---|
| F1 合并 F2.A(避免空心 scaffold) | 1st §2.1, §6 新 DAG | r1 §9.2 #1 明确「F1 已合并 old F1 + old F2.A」 | ✅ 采纳,但 F1 size 仍按 M — 我认为已趋于 L(见 §2.2.G5) |
| stream relay = HTTP streaming「唯一可行」 | 1st §4.2 | GPT §11.2.8 纠正:「first-wave 执行决策,非代码证明的唯一解」 | ✅ 接受纠正,我在 1st 里的「only third 可行」确实越位了 |

### 1.3 1st-pass 的事实错误(我接受 GPT 纠正)

GPT §11.2.4 指出我 1st-pass 中「35 个 live e2e **全部**走 `/sessions/:id/...`」的表述不成立。**我接受这个纠正**。实际代码事实(重新核查):

- 命中 `/sessions/:id/...` 的测试文件:12 个(agent-core/02-06 共 5 个 + cross-e2e/02,03,04,05,06,08,09 共 7 个)
- 不命中 session ingress 的测试文件:14 个(agent-core/01 + bash-core/6 + context-core/2 + filesystem-core/2 + cross-e2e/01,07,10)
- 总文件数:26 个(对应 35 subtests — r1 §2.3 的 "35 subtests" 数字正确,但不代表 35 个独立文件)

r1 §2.3 已把这个分布精确写入 charter,这是重要的事实修正。我 1st 评审里把「受 cutover 影响的测试面」估得过宽,这会让 F3 预算更紧张;r1 的缩小是**正确**的。但即便如此,受影响的 12 个测试文件加上相应 harness 改造,仍然足够支撑 F3 是 L 不是 M 的结论。

---

## 2. r1 的 5 个新 Gap(按严重度排序)

### 2.1 G1 — orchestrator → agent 方向的 internal transport 合约未冻结(**严重**)

**证据链:**

- r1 §1.6 **只**冻结了 `agent.core → orchestrator.core` 的 **stream relay**(HTTP streaming response)
- r1 §10.2 F1.C 说「public start → internal start → first event relay」,但未定义 **「internal start」** 的具体形状
- r1 §16.1 列 6 份 F0 design docs,**没有** 「orchestrator → agent binding contract」文档
- 当前代码事实:
  - `workers/agent-core/src/host/http-controller.ts` 的 7-action 公共 HTTP surface 是**目前唯一可从外部触发 session lifecycle 的途径**
  - `workers/agent-core/src/host/ws-controller.ts` 是**目前唯一 WS ingress 路径**
  - **不存在**任何 internal-only 路径(例如 `/internal/session.dispatch` 或 WorkerEntrypoint RPC)

**为什么这是 gap**:

`orchestrator.core` 必须调用 `agent.core` 才能启动 session,但调用方式存在 3 个互斥选项,charter 未选:

| 选项 | 描述 | 成本 | 后果 |
|---|---|---|---|
| (A) | orchestrator 用 service binding 调用 agent-core **现有** `/sessions/:id/start` | 低 | cutover 不彻底 — agent-core 的 HTTP 既是 deprecated public,又是 internal call target,无法区分 |
| (B) | agent-core 新增 `/internal/session.*` 路径,只允许 service binding 调用 | 中 | 需要在 agent-core 加 internal-auth gate(一个 secret header 或类似),charter 未计划 |
| (C) | agent-core 切到 WorkerEntrypoint RPC | 高 | 违反 §1.4「不做 big-bang transport rewrite」 |

**r1 默认走 (A)**(因为 §1.4 + §1.6 强调 fetch-backed service binding),但(A)与 §6.3 「不得在 agent.core 新增业务性 public HTTP/WS route」**矛盾**:

- 如果 orchestrator 直接调用 agent-core 的公共 `/sessions/:id/start`,那 agent-core 的公共 HTTP 就必须保留(不能 410)
- 如果保留,它就还是个 public surface(只是通过 service binding 被 orchestrator 使用)
- 如果要真正 internal-only,必须加一个**新的** internal-only 路径,或加 internal-auth header gate

**推荐修复**:F0 新增第 6 份 design doc:

```
docs/design/orchestration-facade/F0-agent-core-internal-binding-contract.md
```

内容应冻结:
- 路径形状(沿用 `/sessions/:id/...` 还是新增 `/internal/...`)
- 认证机制(service binding 是否足够?是否需要共享 secret header?)
- 与公共 HTTP 的共存模式(同一路径 + 内部标识 vs 双路径)
- agent.core 在收到 internal call 时的 authority 规则(orchestrator 已翻译好的 authority payload,agent.core 不再做 JWT 校验)

### 2.2 G2 — tenant identity 从 `env.TEAM_UUID` 到 JWT 的桥接缺失(**严重**)

**证据链:**

- `workers/agent-core/src/host/do/nano-session-do.ts:588-593` — agent-core **目前**从 `env.TEAM_UUID` 读取 tenant_uuid,这是**wrangler-level deploy-time vars**,每 worker 一个固定值
- `workers/agent-core/src/host/do/nano-session-do.ts:552-575` — `verifyTenantBoundary(result.frame, {serving_team_uuid: doTeamUuid, do_team_uuid: doTeamUuid, accept_delegation: false})` — 两个参数都来自 `doTeamUuid = env.TEAM_UUID`
- r1 §4.2 user DO schema 含 `last_auth_snapshot.tenant_uuid?` — 来源是**per-request JWT claim**
- r1 §1.4 要求「NACP envelope + authority + zod」逐跳校验
- r1 §10.5 F4.A 要求 explicit authority policy layer

**为什么这是 gap**:

今天 nano-agent 是「deploy-per-tenant」模式(每个 team 一次独立部署,`env.TEAM_UUID` 固定)。但 orchestrator.core 引入后,**单次部署服务多个 tenant**,tenant 身份从 JWT 中提取,**动态**传入。这意味着:

- agent-core 收到 orchestrator-forwarded 请求时,`env.TEAM_UUID` **不再是 authority 的真相**
- `verifyTenantBoundary` 的 `serving_team_uuid` 必须从 authority payload 读,而不是 env
- 这是 **B9 tenant law** 的语义变更,charter 应该触发 NACP protocol review(但 r1 §6.2 O3 把 NACP 变更列为 out-of-scope)

**这不是 F4.A 能 "hardening" 掉的问题**,这是 **agent.core 对 tenant identity 来源的根本性迁移**。它要求:

- 引入「multi-tenant mode」flag(可能是 env var,可能是自动从 NACP envelope 推断)
- `verifyTenantBoundary` 的源参数从 env 改为 authority
- 现有测试里 `env.TEAM_UUID = "_unknown"` 的 fallback 行为需要重定义

**推荐修复**:要么

- (a) F4.A 扩大 scope,显式含「tenant identity source migration」—— 但这会把 F4.A 从 `S` 推到 `M`
- (b) 新增 F4.C「tenant source migration」独立子 phase
- (c) 在 F0 冻结「first-wave 是否 single-tenant-per-deploy,多 tenant 留到下一阶段」—— 如果是 single-tenant,则 orchestrator.core 也是每 tenant 一次部署,JWT 只负责 user 级别,不负责 tenant — **这是最保守最可落地的选择**,但 charter 没明说

我推荐 (c),理由:contexter 目前就是 single-deploy-per-source(看 `core/schemas_common.ts` 的 Env schema,JWT_SECRET 是一个),nano-agent first-wave 可以延续这个拓扑,避免 multi-tenant JWT 带来的 4-worker 全域扰动。

### 2.3 G3 — agent.core 的 WS ingress 归属(**中-严重**)

**证据链:**

- `workers/agent-core/src/host/ws-controller.ts:30-63` — 当前 agent-core 直接接客户端 WS(`/sessions/:id/ws`),用 `UUID_RE` gate session_uuid 格式,accept WebSocket 并进入 WsController
- `workers/agent-core/src/host/do/nano-session-do.ts:466-535` — DO 内直接管理 WS messaging + replay/timeline
- r1 §1.5 compatibility façade list 含 `GET /sessions/:session_uuid/ws`(条 #7)— 表明 orchestrator.core 也要开 WS
- r1 §1.6 冻结了 stream relay 为 HTTP streaming — 这是**单向 agent→orchestrator** 的
- Cloudflare service binding **不支持** WebSocket upgrade(Workers 间只能 fetch)
- r1 §6.3 禁止 agent.core 新增 public route,但**现有的 WS** 是否 retire?

**为什么这是 gap**:

三个无法同时成立的 constraint:

1. client ↔ orchestrator 必须双向 WS(才能 cancel / input 实时)
2. orchestrator → agent 必须**没有** WS(service binding 不支持)
3. agent 的 turn loop 必须能**推**事件到 client

若 r1 的 HTTP streaming 方案被采纳(§1.6),则 flow 是:

```
client ─WS─ orchestrator.core user DO
                │
                ├─ POST /internal/sessions/:id/start  → agent.core(fetch)
                ├─ POST /internal/sessions/:id/input  → agent.core(fetch)
                ├─ POST /internal/sessions/:id/cancel → agent.core(fetch)
                └─ GET  /internal/sessions/:id/stream → agent.core(HTTP streaming body)
                                                         │
                                                         └─ agent-core session DO
```

在这个 flow 下,**agent.core 的 `/sessions/:id/ws` 没有消费者**。它要么:
- (a) 被删除(违反 §6.3 修辞上 "不新增",事实上 r1 没说不能删除旧的 — 但测试面要同步)
- (b) 保留作为 internal verification WS(谁访问?测试?agent-core 的 internal integration test?)
- (c) 被 orchestrator.core 代理(orchestrator 打开 WS 到 agent-core?但 service binding 不支持)

**r1 没有选**。这个决策**直接影响**:
- `workers/agent-core/src/host/ws-controller.ts` + `workers/agent-core/src/host/do/nano-session-do.ts:466-535` 是**删除**、**保留但无调用者**、还是**重构为 HTTP streaming endpoint**?
- 如果是重构,这是**一段重大的 agent-core 改造工作**,但 charter §10.4 F3 中没体现

**推荐修复**:F0 在 stream-relay-mechanism.md 中,**同时回答**:

- agent-core 的 `/sessions/:id/ws` 在 F3 之后是 retired / kept-as-dead-code / repurposed
- agent-core 的 `NanoSessionDO.fetch()` 在收到 HTTP 而非 WS 时,如何以 HTTP streaming body 响应 session.stream.event
- 现有 WsController + WebSocketHelper 在这种重定向下是**复用**还是**duplicated**

### 2.4 G4 — Deprecation window 的行为语义模糊(**中**)

**证据链:**

- r1 §6.3 #2 说旧路径进入 `Deprecation: true` + `Sunset: <future>` 的**兼容窗口**
- r1 §10.4 F3.C 说「保留 probe」—— 但 probe 是 `GET /`,不是 `/sessions/:id/start`
- r1 §14.1 Exit Criterion #2「compatibility-first public session façade 已从 agent.core 迁到 orchestrator.core」

**为什么这是 gap**:

"Deprecation window" 有 3 种可能语义,r1 未选:

| 选项 | 旧路径 `/sessions/:id/start` 行为 | 测试影响 | Cutover 彻底度 |
|---|---|---|---|
| D1 | 200 OK + `Deprecation: true` header,照常工作 | 12 个测试照跑 | 不彻底 — 还是 dual ingress |
| D2 | 302/307 redirect 到 orchestrator.core | 12 个测试会收到 redirect,需改 harness | 中等 — 但 WS 不能 redirect |
| D3 | 410 Gone / 426 Upgrade Required | 12 个测试立即 red | 彻底,但与 "兼容窗口" 矛盾 |
| D4 | 内部 self-proxy(agent.core 收到后自己 fetch orchestrator.core 重新分发)| 12 个测试照跑,但 session_uuid 被 orchestrator 重 mint,agent.core DO 变了 | 最复杂 |

**D1 是最保守、与 "compatibility window" 最一致的解释**,但它意味着:

- 「affected live e2e 迁移」其实**不是必须的** —— 它们可以继续打 agent.core,只是拿到 Deprecation header 而已
- Exit Criterion #2 「façade 已迁到 orchestrator」**在事实层面不成立**,因为公共 surface 仍然可以打 agent.core 正常工作
- NOT-exit #2 「agent.core 仍被默认视为 public app ingress」怎么判定?是靠 docs 声明,还是靠行为?

**推荐修复**:r1 § 6.3 / § 10.4 F3.C / § 14.1 Exit Criteria 应统一口径,至少回答:

1. Deprecation window **具体时长**(例如 Sunset: 2026-Q4 = 6 个月?)
2. window 内旧路径是 **D1 / D2 / D3 / D4** 哪一种
3. window 内旧路径**是否接 orchestrator 已 mint 的 session_uuid**(如果接,怎么让两套 session_uuid 兼容?)
4. 受 cutover 影响的 12 个测试:是 F3 必迁(对应 D3),还是允许继续跑旧入口直到 Sunset(对应 D1)

如果选 **D1**,charter 必须承认这是「additive façade」而不是「cutover」;如果选 **D3**,F3 是硬切不是兼容窗口,「Deprecation window」提法就是误导。

### 2.5 G5 — F1 的 size 已不再是 M,实质接近 L(**中**)

**证据链:**

- r1 §9.1 F1 = `M`
- r1 §9.3 F1.A + F1.B + F1.C 3 个子阶段
- r1 §10.2 F1 In-Scope 列 8 项
- r1 §9.2 #1 明确 "F1 已合并 old F1 + old F2.A"

**为什么这是 gap**:

把 r1 §10.2 的 F1 工作展开:

| # | 工作项 | 工程量 |
|---|---|---|
| 1 | `workers/orchestrator-core/` scaffold(package.json, tsconfig, wrangler.jsonc, npmignore)| S-XS |
| 2 | `@haimang/orchestrator-core-worker` 骨架 | S-XS |
| 3 | JWT middleware(adopt from contexter `core/jwt.ts`)| S |
| 4 | trace middleware | XS |
| 5 | user DO shell(per-user DO `idFromName(user_uuid)`)+ state schema(4 字段)| M |
| 6 | façade `start` route(HTTP,POST)| S |
| 7 | façade `ws` route(WS upgrade + sessions map 模式借鉴 engine_do.ts)| M |
| 8 | session_uuid minting(UUIDv4 + registry write)| S |
| 9 | **orchestrator → agent 的 internal fetch call 实现**(未在 F1 spec 列出,但实现 roundtrip 必须做)| M |
| 10 | **HTTP streaming response 消费 + WS pipe 回写**(未在 F1 spec 列出,但 "first event relay" 要求)| M |

合计:**6 × S + 4 × M** = 实质 **L**(如果复用度高)到 **L+**(如果 cf-adapters 需要同步引入)

**为什么 GPT 估 M**:可能把第 5/7/9/10 的 M 部分视为 F2 工作。但 r1 §9.3 F1.C 「`session.start` roundtrip + first event relay」**明确把 roundtrip 放 F1**,则第 9-10 就是 F1 的。

**推荐修复**:

- 要么把 F1 显式标为 **L**(替换 §9.1 中的 `M`)
- 要么把 F1.C 二分:
  - **F1.C.1**:orchestrator → agent forward(只做 HTTP request/response,先不做 stream)
  - **F1.C.2**:first event relay(HTTP streaming consumption + WS pipe)
  
  然后把 F1.C.2 归到 F2.C "stream relay stabilization" —— 这样 F1 回归 M,F2 的 stream 部分更充实

我推荐后者(归 stream 相关到 F2.C),因为 F1 的价值点是 "scaffold + auth + registry + forward",stream piping 的 framing 决策天然属于 F2 的 session seam completion。

---

## 3. 可执行性分析 — F0-F5 能不能机械执行?

### 3.1 F0(`S`)— 能执行,但 6 份 memo 应该扩为 7-8 份

**优点**:r1 §16.1 列了 6 份 design doc,都有 concrete scope。F0.A-E 5 个子阶段标题清楚。可以立即并行写。

**缺口**:
- 缺 **G1** 的 `F0-agent-core-internal-binding-contract.md`(§2.1)
- 缺 **G3** 的 WS ingress disposition(可嵌入 `F0-stream-relay-mechanism.md`)
- 缺 **G4** 的 Deprecation window semantics(可嵌入 `F0-compatibility-facade-contract.md`)

**建议**:F0 交付物扩至 7 份(新增 `F0-agent-core-internal-binding-contract.md`),并在现有 2 份内补 G3 + G4。

### 3.2 F1(标为 M,实际 L)— 执行可行但 size 失真

**优点**:F1.A/B/C 三子阶段切分清楚;compatibility-first 决策让 F1 有明确 roundtrip 目标;JWT adopt 自 contexter jwt.ts 路径已 concrete。

**缺口**:§2.5 G5 已详述。

**建议**:要么标为 L,要么把 stream 相关工作归 F2.C。

### 3.3 F2(`M`)— 执行可行但 stream stabilization 实际量大于 M

**优点**:F2.A/B/C 的 9 项 In-Scope(§10.3)都有现成代码参照(agent-core 的 HttpController 7-action 可作为 façade HTTP 的目标合约)。

**缺口**:
- F2.B 列 7 项 action(attach / reconnect / cancel / status / timeline / verify + initial_context seed)。其中 **reconnect** 本身是一个独立复杂问题(r1 §4.4 要求独立 memo),不像其他 action 一个路由就能完成
- F2.C "stream relay stabilization" 若接过 F1 的 stream piping,则 F2.C 要做 **chunk framing、back-pressure、reconnect 时的 stream 恢复、client-side 断线下的缓冲策略**。这是 M+ 工作量
- F2 没有 explicit **attach → running session** 的语义定义。attach 与 reconnect 的区别是什么?(attach = 已连过的 user 打开第二个 tab?reconnect = 断线后恢复?两者都需要查 `active_sessions`,但行为可能不同)

**建议**:把 F2 升级为 **M+** 或拆为 F2a(seed + simple lifecycle: cancel/status/timeline)+ F2b(reconnect + stream hardening)。r1 的 F2 口径过于紧凑。

### 3.4 F3(`L`)— 分 A/B/C 合理,但 G4 不解决会导致 F3.B 测试迁移定义不清

**优点**:F3 拆 A/B/C 对应 "cutover" / "migration" / "deprecation" 三件事,逻辑正确;L 的预算与 12 个测试文件迁移 + INDEX.md 更新 + JWT harness 建立的工作量匹配。

**缺口**:
- G4 未解决 → F3.B 的「迁移」到底是什么?若选 D1(additive),12 个测试**不需要**迁移,只需双轨验证;若选 D3(hard cut),12 个测试必须同日迁移。这决定 F3.B 是 S 还是 M
- F3.A 的 "compatibility session surface 正式接管" 与 G1 耦合 — 如果 orchestrator 只是把请求 forward 给 agent-core 现有 HTTP,那 F3.A 就是"开路由"而已 `S`;如果 orchestrator 要把 HTTP 转成 internal NACP envelope + service binding,那 F3.A 是 M

**建议**:F3 内部重新审视各 sub-phase 的 size 依赖于 G1/G4 的决策。

### 3.5 F4.A(`S`)— G2 不处理则无法 "authority hardening"

**优点**:F4.A 聚焦 authority policy layer + executor recheck hook,这是代码事实支持的落点(见 `workers/bash-core/src/executor.ts:126`)。

**缺口**:G2(tenant identity 源)未处理 → F4.A 只能把 **已有** authority 校验 explicit 化,不能**修正** tenant 源。如果 multi-tenant 被引入而 tenant 源不变,F4.A 的 "authority hardening" 建立在一个仍用 `env.TEAM_UUID` 的伪装规则之上。

**建议**:F0 在 `F0-authority-and-revalidation-law.md`(现已非 F0 交付物之一 — r1 §16.1 删掉了 r0 的这份 memo)或 F4.A memo 中,**明确**:

> first-wave tenant identity **从 `env.TEAM_UUID` 提供**(单 tenant per deploy);multi-tenant JWT-driven tenant 在 F4.B/下阶段引入

这样 F4.A 的 scope 就不扩。如果不明确,F4.A 会在实现时被迫 touch multi-tenant,scope 会炸。

### 3.6 F5(`M`)— 缺具体验证交付物

**优点**:closure + handoff 三份文档标准做法。

**缺口**:"preview topology final verification" 没有具体验证项 —
- 是否新增 cross-e2e test 覆盖 **public JWT → orchestrator → agent → stream back** 全路径?
- 是否要求 4 worker 同时 preview deploy(worker-matrix 阶段 context-core / filesystem-core 允许 defer preview)?
- live probe 要求返回什么 marker 证明 orchestrator 已替代 agent?(参照 worker-matrix P2 的 `live_loop: true` 作为 phase marker)

**建议**:F5.A 应明确增加至少 1 个 cross-e2e 测试文件(例如 `11-orchestrator-public-facade-roundtrip.test.mjs`),并要求 orchestrator.core preview probe 返回 `phase: "orchestration-facade-cutover"` 或类似 identifier。

---

## 4. 任务分配合理性

### 4.1 5 workers 责任分工 — 基本正确,但有一处混淆

r1 §7 的责任分工表清晰,但 §7.3 bash.core 要点 #2 "capability policy 与 F4.A 的 authority / truth recheck seam 对齐" 把 **policy layer** 和 **truth recheck hook** 混为一谈:

- **policy layer**(F4.A 硬要求)= explicit authority validator(missing trace_uuid / escalation / scope 校验),这个在 agent-core 层已足够,**不需要 bash-core 动**
- **truth recheck hook**(F4.A 的 hook point)= `CapabilityExecutor` 执行前回查 truth,这个在 bash-core `executor.ts:126` 的落点上,**需要 bash-core 动**

两件事不同。§7.3 的表述让 bash-core 看起来要同时做两件,实际只需做 recheck hook。

**建议**:§7.3 要点 #2 拆成:
- #2a:authority validation 统一由 agent-core 层做(bash-core 相信 envelope 已被 agent-core 校验)
- #2b:bash-core `executor.ts` 加 recheck hook seam

### 4.2 F0 设计文档的 owner 分配 — 未指定

6 份(或我建议的 7 份)F0 design doc 由谁写?r1 未提。这在 worker-matrix charter 里也没提,属于过程空白,但 orchestration-facade 比 worker-matrix 更需要清晰(涉及新 worker + contexter 抽取 + transport 决策 + lifecycle 设计)。

**建议**:F0 action-plan memo 应指定每份 design doc 的 primary author + reviewer。

### 4.3 F3.B 测试迁移的 owner

12 个测试文件迁移是机械工作但量大。r1 未说是「单次批量 PR」还是「per-file PR」。基于 worker-matrix Q1 的经验(按 sub-phase/worker 组 PR),我建议 F3.B 为**一次批量 PR**(因为所有 12 个测试在同一个 migration truth 下)。

---

## 5. 阶段设置的逻辑性 — DAG 基本对,一处可优化

### 5.1 r1 DAG(§9.2)

```
F0 → F1 → F2 → F3, F4 (并行) → F5
```

**我的评价**:

- F0 → F1:硬依赖,✅
- F1 → F2:硬依赖(F2 基于 roundtrip 已通),✅
- F2 → F3:软依赖 — F3 需要 F2 的 session seam 完整,不只 roundtrip,✅
- F2 → F4:F4.A 需要 orchestrator 已有 authority translation,这要求 F2 的 seed + authority 翻译已完成,✅
- F3 ∥ F4:**可以并行**,因为 F3 是 cutover/migration,F4 是 policy hardening,路径不交
- F3 + F4 → F5:✅

**可优化**:F4.A 只改 agent-core 和 bash-core 的 validation layer,**不碰 orchestrator**。所以 F4.A 实际**可以与 F2 并行**(从 F1 触发),不用等 F2 完成。

如果 F4.A 与 F2 并行:

```
F0 → F1 → F2 → F3 → F5
            \   /
             F4.A
```

这可把关键路径从 F0-F1-F2-F3-F5 = 6 phase 缩到 F0-F1-F2-F3-F5 = 5 串行 phase + F4.A 并行。节省 1 个 phase wall-clock。

**建议**:charter §9.2 原则 #4 可改为「F4.A 可与 F2 并行启动,不必等 F2 完成」。

---

## 6. 测试与收口覆盖率

### 6.1 r1 §12.3 新增验证清单 — 基本完整,缺 4 项

r1 §12.3 列 7 项新增验证:

1. JWT invalid / missing
2. façade mint session_uuid
3. façade registry attach / reconnect
4. `initial_context` seed reaching runtime
5. first event relay over HTTP streaming seam
6. authority negative cases
7. legacy agent routes deprecation headers

**缺的 4 项**:

| # | 缺失验证 | 理由 |
|---|---|---|
| 8 | **session cancel mid-stream** | 客户端在 agent turn running 时发 cancel,验证 stream relay 能正确中止 + orchestrator 把结束信号传回 client |
| 9 | **tool.call.request / response through façade** | 验证 bash-core capability invocation 在 orchestrator 中转下仍能返回正确 response(cross-e2e 的 02, 03 迁移版本)|
| 10 | **tenant mismatch rejection** | JWT 里的 tenant 与 agent-core 的 env.TEAM_UUID 不符时的行为 — 跟 G2 紧耦合 |
| 11 | **multi-session per user** | 同一 user DO 下开 2+ session,active_sessions registry 正确记录,两 session 流不串台 |

**建议**:§12.3 扩至 11 项,分别补到 F3.B(#8-9)和 F4.A(#10-11)。

### 6.2 6 条 Primary Exit Criteria(§14.1)— 漏掉 internal transport 合约

r1 §14.1 6 条 exit criteria 没有一条是关于 **orchestrator → agent internal transport 合约已冻结且有测试**。这是 G1 的直接后果。如果缺,整个阶段可以"形式上完成"但没有 freeze internal protocol,下一阶段会遇到 tech-debt。

**建议**:§14.1 新增 #7:

> **7. orchestrator.core → agent.core 的 internal call contract 已 freeze,并至少有 2 个 integration test 覆盖「new session via internal call」+「session cancel via internal call」。**

### 6.3 NOT-exit(§14.3)6 条 — 完整度良好

6 条 NOT-exit 都是硬门槛,并且都对应 §14.1 exit criteria。✅

若 G1 被采纳为 exit #7,NOT-exit 可加 #7:

> **7. orchestrator → agent 的 internal call 仍是 ad-hoc fetch 胶水,没有 frozen contract。**

---

## 7. 应得最终成功 vs GPT 计划输出 — Gap 分析总表

### 7.1 我认为本阶段应该得到的最终成功(7 项)

| # | 最终成功项 | 为什么必要 |
|---|---|---|
| S1 | orchestrator.core 作为唯一 public HTTP/WS 入口真实存在并 preview deploy | 拓扑反转的可见结果 |
| S2 | user DO 有持久 registry,能正确 mint / lookup / expire session_uuid | proxy 避免化 |
| S3 | client 可通过 orchestrator 发起 session、收到 stream event、发 cancel、重连 | 功能完整性 |
| S4 | affected 12 个 e2e + INDEX.md + harness 已显式迁移或显式保留 | 测试可持续性 |
| S5 | authority 校验从分散实现收口为 explicit policy layer,含 negative tests | 未来 credit/quota 的地基 |
| S6 | `agent.core → orchestrator.core` 的 stream relay framing 已冻结并有实测 | stream contract 的一次性定义 |
| **S7** | **`orchestrator.core → agent.core` 的 internal call contract 已冻结,含 frozen path + frozen authority passing convention + frozen auth mechanism** | **next-phase richer orchestrator 启动的前置** |

### 7.2 GPT r1 计划能输出的成果(对照)

| # | 最终成功项 | r1 能交付吗? | 对应 r1 位置 |
|---|---|---|---|
| S1 | orchestrator.core preview deploy | ✅ 能 | §14.1 #1 |
| S2 | user DO registry | ✅ 能 | §14.1 #3 + §4.2 schema |
| S3 | full session lifecycle through façade | ✅ 能 | §14.1 #4 + F2 |
| S4 | affected e2e 迁移 | ✅ 能 | §14.1 #6 + F3.B |
| S5 | authority policy layer | ✅ 能 | §14.1 #5 + F4.A |
| S6 | stream relay framing | ✅ 能 | §1.6 + F0.E |
| **S7** | **internal call contract freeze** | ⚠️ **缺** | **无对应 deliverable — G1** |

**Gap 结论**:r1 能交付 6/7 个应得成功,唯一缺的是 **S7** —— `orchestrator → agent` 方向的 internal transport 合约。

### 7.3 为什么 S7 不可或缺

- 没有 S7,orchestrator.core 和 agent.core 之间是 ad-hoc fetch 胶水,无法 test in isolation(无法 mock 其中一侧)
- 没有 S7,下一阶段的 richer orchestrator(CRM / credit / user-memory / richer public API)启动时,每增加一个 public feature 都要**重新猜**怎么调 agent.core — 每次是一次 ad-hoc 协商
- 没有 S7,F4.A 的 authority policy layer 无法断言 "agent-core 收到的请求必然经过 orchestrator.core 授权过",因为 agent-core 的入口仍是非受控 HTTP

### 7.4 Gap 的真实含义

我描述的 Gap 不是 "charter 做错了",而是 **charter 比它自己承诺的少交付了一件事**。r1 §17.1 claim 「整个阶段的工程价值在于让 JWT/authority translation 有唯一入口 + session_uuid lifecycle 有唯一 owner」— 这两件都对,但要**真正成立**,orchestrator → agent 的 internal call 必须 **也**冻结,否则 "唯一入口" 的唯一性只是修辞,不是技术保障(仍可 curl 直打 agent.core)。

---

## 8. 推荐 r1 → r2 修改清单(6 项)

按 impact 排序:

| # | 修改项 | 归属 | 工作量 |
|---|---|---|---|
| M1 | F0 新增第 7 份 design doc:`F0-agent-core-internal-binding-contract.md`(解决 G1 + 支持 S7)| F0 交付物 | S |
| M2 | F0 在 `F0-compatibility-facade-contract.md` 中明确 Deprecation window 语义(D1/D2/D3/D4 选一)(解决 G4)| F0 交付物 | XS |
| M3 | F0 在 `F0-stream-relay-mechanism.md` 中回答「agent.core WS 的归属」(解决 G3)| F0 交付物 | XS |
| M4 | F0 或 F4.A memo 写明 first-wave tenant identity 来源「仍用 env.TEAM_UUID,multi-tenant JWT 延后」(解决 G2)| F0 / F4.A | XS |
| M5 | F1 标为 L,或把 stream piping 归 F2.C(解决 G5)| §9.1 / §9.3 | XS |
| M6 | §14.1 新增 Exit #7(frozen internal call contract)+ §12.3 扩至 11 项验证 + §14.3 新增 NOT-exit #7 | §12 / §14 | S |

实施这 6 项后,charter 具备完整 **actionable + test-coverable + cutover-semantically-clear + internal-contract-frozen** 四重闭合性,可以从 draft r1 推进到 r2 final 并触发 F0 实际动工。

---

## 9. Final Verdict

### 9.1 对 r1 charter 的判决

**approve with 6 small modifications(M1-M6)**。

- r1 的 vision / 战略定位 / 5-worker 分工 / DO 身份分层 / NACP envelope + authority 法律 / compatibility-first 决策 / contexter absorption inventory / user DO schema / session_uuid lifecycle / stream relay 方向 / F4 拆分 —— **这些我全部接受**
- 有 5 个 gap(G1-G5)可能在 F1 启动后 24-48 小时内暴露,但只要 M1-M6 在 F0 冻结前落实,F1-F5 就能机械执行
- Owner 仍可以 freeze r1 作为执行基石,但应把 r1 → r2 的小改单作为 F0 内部冻结的一部分

### 9.2 一句话总结

> **r1 是一份合格的基石 charter,它把 r0 的方向性 vision 收紧成 10 个执行级决策中的 8 个;剩下的 2 个(internal transport contract + deprecation semantics)和 3 个次级 gap(tenant source / WS 归属 / F1 size)—— 只要在 F0 冻结前补上,本阶段就不会在 F1-F5 的任一点上撞墙。**

### 9.3 应得成功 vs r1 输出的 Gap 总结

> **r1 交付 6/7 个我定义的最终成功项(S1-S6),缺第 7 个(internal call contract freeze)。这个缺口不会让本阶段在 §14.1 exit 上失败,但会让下一阶段继续扛一段未冻结的 ad-hoc 胶水 tech-debt。把 S7 正式列入本阶段 exit criteria(见 M1+M6)是对 r1 的最重要补丁。**

---

## 10. 与 1st-pass 的关系

1st-pass 提了 10 项修改,r1 吸收了 8 项 + 部分吸收 2 项。

**我接受 GPT 对 1st-pass 的两处事实纠正**:

1. 「35 个 e2e 全部走 `/sessions/:id/...`」是过度概括 — 实际 12/26 个文件
2. 「HTTP streaming 是代码证明的唯一可行解」是过度断言 — 它是 first-wave 的合理执行决策

这两个纠正已反映在 r1 的 §2.3 和 §1.6,我不反对。

**2nd-pass 新增的 6 项修改(M1-M6)都是基于 r1 的增量 gap,不是回溯 1st-pass。** 执行上,2nd-pass 的 M1-M6 和 1st-pass 未被采纳的 F1-vs-L size 判断(§2.2.G5 = 1st §2.1 的延续)合并考虑即可。

---

## 11. 版本历史

- **r0 review(1st-pass,2026-04-24)**:对 r0 draft 的 10 项修改建议。
- **r1 review(2nd-pass,本文档,2026-04-24)**:对 r1 full rewrite 的事实核查 + 5 个新 gap 识别 + 6 项增量修改建议。核心判断:r1 方向 approve,但缺 `orchestrator → agent` internal call contract freeze,建议作为 M1+M6 补丁加入 F0 冻结范围。

---

## 12. GPT 附加回应 — 对 2nd-pass 的代码级事实复核与回应

### 12.1 总体回应（总）

**总体判断：2nd-pass 比 1st-pass 更聚焦，而且多数新增 gap 都是真问题。**  
我基于当前代码与现有 charter 再核查后，结论可以收束成三点：

1. **我确认成立的主结论**：
   - G1 `orchestrator -> agent` internal call contract 在 r1 中确实没有被冻结；
   - G3 `agent.core` 现有 WS ingress 在 cutover 之后的命运没有回答；
   - G4 deprecation window 的行为语义没有被写死；
   - G5 F1 的工作量在 r1 文义下确实已经逼近 `L`。
2. **我部分接受、但要校正表述的地方**：
   - G2 关于 tenant identity source migration 的问题是实的，但 Opus 把它表述成“当前就是 deploy-per-tenant + `TEAM_UUID` 已配置成固定真相”并不完全符合仓库现状；更准确的事实是：**代码强依赖 `TEAM_UUID`，但当前 `wrangler.jsonc` 并未显式提供该变量，preview 实际会掉到 `_unknown` fallback**。
   - 关于 WS / service binding 的讨论，**问题定义成立**，但 “Cloudflare service binding 不支持 WS” 不是这份仓库代码能独立证明的命题；我只能确认 **当前仓库里没有任何 worker-to-worker WS relay 实现，且现有 internal seam 都是 fetch 风格**。
3. **因此我对 2nd-pass 的总体响应是**：
   - **采纳** M1、M2、M3、M5、M6；
   - **部分采纳** M4，但会把它改写成“先冻结 first-wave tenant source truth，再决定是否做 source migration”，而不是直接接受 review 中的所有背景叙述。

下面按 gap 逐项回应。

### 12.2 分项事实核查与回应（分）

#### 12.2.1 G1 — `orchestrator -> agent` internal call contract 未冻结 —— **我确认成立**

这是 2nd-pass 里最重要的一条，我确认它成立。

**证据链：**

1. 当前 `agent.core` 的唯一 session lifecycle 入口仍是 public-facing routes：
   - `workers/agent-core/src/host/routes.ts:44-72` 只识别 `/sessions/:sessionId/ws` 与 `/sessions/:sessionId/:action`
   - `workers/agent-core/src/host/http-controller.ts:18-26` 的 action surface 仍是 `start/input/cancel/end/status/timeline/verify`
2. 当前 `agent-core` 入口实现没有任何 internal-only route：
   - `workers/agent-core/src/index.ts:39-63` 除 probe 外，直接把 `route.sessionId` 送进 `SESSION_DO.idFromName(sessionId)`，没有 `/internal/*` 分支，也没有内外分流 header
3. r1 charter 虽然已经冻结了 **stream relay** 方向：
   - `docs/plan-orchestration-facade.md:142-167`
   但它没有冻结 **orchestrator 调 agent 的 internal call contract**
4. r1 的 F0 design doc 列表里也确实没有这份文档：
   - `docs/plan-orchestration-facade.md:644-649`
   - `docs/plan-orchestration-facade.md:967-973`

**结论：**

Opus 的判断成立，而且这不是文案级小缺口，而是一个真实的 next-phase debt 源头。  
如果不在 F0 冻结 `orchestrator -> agent` 的 internal contract，那么：

- façade cutover 可以形式上完成；
- 但 richer orchestrator 阶段仍然只能围绕一段 ad-hoc fetch 胶水继续生长。

所以我明确采纳：

> **M1 应加入：新增 `F0-agent-core-internal-binding-contract.md`，并把其冻结结果提升到 exit-level 成果。**

---

#### 12.2.2 G2 — tenant identity source migration —— **问题成立，但 review 的背景叙述需要校正**

这条我**部分接受**。

**我确认成立的事实：**

1. `NanoSessionDO` 当前多个核心路径都以 `TEAM_UUID` 为 tenant source：
   - `buildCrossSeamAnchor()`：`workers/agent-core/src/host/do/nano-session-do.ts:387-399`
   - `acceptClientFrame()` → `verifyTenantBoundary(...)`：`552-575`
   - `tenantTeamUuid()`：`588-593`
   - `buildIngressContext()`：`812-826`
   - `ensureWsHelper()`：`842-863`
   - `buildTraceContext()`：`1112-1127`
   - `persistCheckpoint()`：`1180-1192`
2. 也就是说，**今天的 agent-core 真实是 `TEAM_UUID`-coupled**，不是 authority-derived tenant model
3. r1 charter 里 first-wave user DO schema 又已经引入了 JWT snapshot 的 `tenant_uuid?` 字段：
   - `docs/plan-orchestration-facade.md:331-333`

**但我需要纠正 review 里一个容易误导的背景表述：**

Opus 把当前现实近似成“deploy-per-tenant，`env.TEAM_UUID` 在 wrangler 中是固定真相”。  
这和当前仓库并不完全一致，因为：

1. `workers/agent-core/wrangler.jsonc:10-13,42-45` 当前只显式配置了：
   - `ENVIRONMENT`
   - `OWNER_TAG`
2. **没有显式配置 `TEAM_UUID`**
3. 代码因此会走 `_unknown` fallback：
   - `tenantTeamUuid()`：`588-593`
   - `buildIngressContext()`：`814-825`

**结论：**

G2 的核心问题成立，但更准确的表述应是：

> **当前 agent-core 的 tenant identity source 被写死在 `TEAM_UUID` 这一路上；而且当前 preview 配置甚至没有把 `TEAM_UUID` 显式喂进来。r1 若要引入 façade 的 JWT-derived tenant snapshot，就必须先在 F0/F4.A 冻结 first-wave tenant source truth。**

因此我对 M4 的回应是：

1. **采纳问题定义**
2. **改写修复口径**为：
   - first-wave 明确冻结为哪一种：
     - 单 tenant per deploy，仍以 `TEAM_UUID` 为 truth；或
     - authority-derived tenant source migration
3. 从当前代码风险看，**先冻结 single-tenant-per-deploy truth 更保守，也更契合现有实现**

---

#### 12.2.3 G3 — `agent.core` 现有 WS ingress 的归属未回答 —— **我确认成立**

这条也是实打实的 gap。

**证据链：**

1. 当前 `agent-core` 直接拥有 public WS ingress：
   - `workers/agent-core/src/host/routes.ts:59-67`
   - `workers/agent-core/src/host/ws-controller.ts:47-83`
   - `workers/agent-core/src/host/do/nano-session-do.ts:408-469,493-526`
2. r1 又要求 `orchestrator.core` first-wave 对外也要开放：
   - `GET /sessions/:session_uuid/ws`
   - 见 `docs/plan-orchestration-facade.md:122-129`
3. 同时 r1 已把 downstream stream relay 默认决策写成 HTTP streaming：
   - `docs/plan-orchestration-facade.md:142-167`

**当前代码能证明的结论：**

1. 现有仓库没有任何 worker-to-worker WS relay 实现
2. 现有 internal seam 都是 fetch-shaped
3. 因此一旦 façade 接手 public WS，`agent.core` 现有 `/sessions/:id/ws` 的 fate 必须被回答：
   - retire
   - keep as deprecated compatibility
   - repurpose into some internal-only shape

**我不直接确认的部分：**

Opus 把原因进一步推到 “service binding 不支持 WS upgrade”，这在平台现实上大概率是对的，但**这不是仓库代码本身能独立证明的事实**。  
我能确认的是：

> **当前 repo 没有任何 alternative internal WS seam；因此这条归属问题必须在 F0 设计层被明确回答。**

所以我采纳：

> **M3 成立，而且 `F0-stream-relay-mechanism.md` 必须同时回答现有 `agent.core /sessions/:id/ws` 在 F3 之后是 retired、deprecated 还是 repurposed。**

---

#### 12.2.4 G4 — Deprecation window 的行为语义模糊 —— **我确认成立**

这条也成立，而且是 cutover charter 最容易留下执行期分歧的地方。

**证据链：**

1. r1 只写了 deprecation headers 的纪律：
   - `docs/plan-orchestration-facade.md:468-469`
   - `docs/plan-orchestration-facade.md:746-747`
2. 但没有写明旧 public session routes 在窗口期内到底怎么行为
3. 当前 `agent-core` 旧入口还没有任何 `Deprecation` / `Sunset` 头实现：
   - `workers/agent-core/src/index.ts:39-63`
   - `workers/agent-core/src/host/do/nano-session-do.ts:461-469`
4. r1 的 exit criteria 也没有把“哪一种 deprecation semantics 被选定”写成显式条件：
   - `docs/plan-orchestration-facade.md:926-948`

**结论：**

Opus 的问题定义成立。  
如果不选定 D1/D2/D3/D4 这一类窗口语义，那么 F3.B 的“迁移”到底是：

- 强制切换
- 双轨验证
- 兼容保留

都会在执行时变得模糊。

所以我采纳：

> **M2 应加入：在 F0 compatibility façade contract 里，把 deprecation window semantics 写死。**

---

#### 12.2.5 G5 — F1 的 size 已逼近 L —— **我部分接受，而且倾向 Opus 的修法**

这条不是代码事实问题，而是基于 charter 内部工作项的 sizing judgement。  
但从 r1 的 phase 描述看，Opus 的担心是有根据的。

**证据链：**

1. r1 现在把 F1 定义成：
   - `workers/orchestrator-core/` scaffold
   - JWT middleware
   - user DO routing
   - façade `start`
   - façade `ws`
   - `session_uuid` minting
   - `session.start -> first event` roundtrip
   - 见 `docs/plan-orchestration-facade.md:589-613,664-690`
2. 如果 “first event relay” 也在 F1 落地，那么它天然包含：
   - downstream start call
   - some form of stream consumption
   - relay back to façade-side WS

**结论：**

我接受 Opus 的 sizing 提醒。  
在当前 r1 文义下，F1 要么：

1. **上调到 L**
2. 要么把 stream piping 的一部分显式挪到 F2.C

在这两个修法之间，我更偏向 Opus 推荐的第二种：

> **保留 F1 = scaffold + auth + registry + forward；把 stream piping 的硬化归给 F2.C。**

因为这样 F1 与 F2 的责任边界更清晰。

---

#### 12.2.6 关于 F5 “缺具体验证交付物” —— **我确认成立**

**证据链：**

1. r1 的 F5 目前只写了：
   - preview topology final verification
   - closure docs
   - handoff docs
   - 见 `docs/plan-orchestration-facade.md:799-824`
2. 但没有明确写出一个新增的 façade roundtrip live e2e 文件
3. 也没有要求 `orchestrator-core` probe 返回新的 phase marker

**结论：**

Opus 这条是对的。  
如果 F5.A 不把“如何验证 façade 已替代 agent”写成具体验证资产，那么最终 closure 只会停留在文档层。

这条我采纳，具体应补：

1. 一个新的 cross-e2e façade roundtrip 测试
2. 一个 `orchestrator-core` probe marker

---

#### 12.2.7 关于 bash policy layer 与 truth-recheck hook 被混写 —— **我确认成立，并补一处路径校正**

Opus 这里抓得很对，但它举的代码路径需要校正。

**事实链：**

1. 统一 authority / legality 校验的主入口现在仍在 `agent-core`
   - `NanoSessionDO.acceptClientFrame()` + `verifyTenantBoundary(...)`
2. execution-time truth recheck 最自然的 capability 落点在执行器，而不是 worker edge
   - **正确的代码锚点是** `packages/capability-runtime/src/executor.ts:121-239`
   - 而不是 review 文中写的 `workers/bash-core/src/executor.ts`
3. `bash-core` 当前 worker entry 只是调用 runtime：
   - `workers/bash-core/src/index.ts:358-372`

**结论：**

Opus 的结构判断成立：

1. **authority validation layer** 应由上游（agent/facade）统一处理
2. **truth recheck hook seam** 应落在 capability executor

但应把代码引用改成：

> `packages/capability-runtime/src/executor.ts`

而不是 `workers/bash-core/src/executor.ts`

---

#### 12.2.8 关于 DAG 中 “F4.A 可与 F2 并行” —— **我部分接受，但这是设计优化，不是代码强事实**

这条不是仓库代码能证明或反驳的，而是执行编排建议。

**当前代码能支持的事实只有：**

1. F4.A 主要涉及的现有落点确实都在 `agent-core` / `capability-runtime` 一侧：
   - `NanoSessionDO.acceptClientFrame()`
   - `CapabilityExecutor`
2. 它不像 F3 那样强依赖 façade public surface cutover

**因此我接受的说法是：**

> **F4.A 具有与 F2 并行推进的潜力。**

但我不会把它写成“必须并行”或“由代码事实直接推出”。  
它更像 execution scheduling optimization，不是 architecture truth。

---

#### 12.2.9 关于新增 Exit #7（internal call contract freeze）—— **我确认成立**

这是 G1 在 exit criteria 层面的自然落点。

**证据链：**

1. 当前 r1 的 6 条 primary exit criteria：
   - `docs/plan-orchestration-facade.md:926-933`
2. 它们能覆盖：
   - façade 存在
   - registry 存在
   - stream relay 存在
   - authority hardening 存在
   - affected tests 迁移存在
3. 但**确实没有一条**要求：
   - `orchestrator -> agent` internal contract 已冻结
   - 且有 integration tests

**结论：**

Opus 的 M6 这里是正确补丁。  
如果不把 internal call contract freeze 提升到 exit-level，本阶段会带着一段未冻结的 tech debt 进入下阶段。

所以我采纳：

> **应新增 Exit #7 + NOT-exit #7，指向 internal call contract freeze。**

### 12.3 收束结论（总）

基于这轮 2nd-pass 的代码级复核，我的最终回应是：

1. **新增 5 个 gap 里，我确认 4 个完全成立**：
   - G1 internal call contract
   - G3 WS ingress disposition
   - G4 deprecation semantics
   - G5 F1 sizing / stream work placement
2. **G2 也成立，但需要校正背景描述**：
   - 不是“当前 wrangler 已稳态提供 `TEAM_UUID`”
   - 而是“代码强依赖 `TEAM_UUID`，但当前 preview 配置甚至未显式提供它”
3. **因此我对 M1-M6 的态度是**：
   - **采纳**：M1、M2、M3、M5、M6
   - **部分采纳并重写口径**：M4

如果把这轮 review 收敛成一句话：

> **r1 已经是一份合格的基石 draft，但还缺最后一层“façade 与 runtime 之间 internal contract 的冻结”。2nd-pass 真正指出的，不是方向错误，而是 r1 还差一层用于支撑下一阶段的接口真相。**

我认同 Opus 的总 verdict：  
**approve with small-but-structural follow-ups**，而这些 follow-ups 里最关键的一条就是 **S7 / internal call contract freeze**。  
