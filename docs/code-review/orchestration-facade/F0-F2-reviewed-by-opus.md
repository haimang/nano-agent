# Nano-Agent 代码审查 — Orchestration Facade F0-F2

> 审查对象: `orchestration-facade / F0-F2`(设计冻结 + orchestrator-core 建立 + session seam 完整化)
> 审查时间: `2026-04-24`
> 审查人: `Claude Opus 4.7 (1M context)`
> 审查范围:
> - `docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`(含工作日志 §11)
> - `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`(含工作日志 §11)
> - `docs/action-plan/orchestration-facade/F2-session-seam-completion.md`(含工作日志 §11)
> - `docs/issue/orchestration-facade/F{0,1,2}-closure.md`
> - `workers/orchestrator-core/**`(源码 + tests + wrangler)
> - `workers/agent-core/src/index.ts` + `src/host/internal.ts`
> - `.github/workflows/workers.yml`
> - `test/shared/live.mjs` + `test/package-e2e/orchestrator-core/*`
> - `docs/design/orchestration-facade/FX-qna.md`(owner 最终回答状态)
> - `context/smind-contexter/` 真实参考代码
> 文档状态: `reviewed`
> **独立性声明**:本轮评审**未参考** DeepSeek / Kimi / GPT / 此前 Opus 评审对同范围或同对象的分析。所有 finding 基于本人独立对代码、工作日志、closure 文档、contexter 参考代码的 first-principles 审查。

---

## 0. 总结结论

- **整体判断**:F0-F2 三个周期**主体交付成立,口径清晰,scope discipline 维持良好**。orchestrator-core 从无到有、user DO 具备完整生命周期、7-action façade + 7-action internal seam 双向对称、测试树扩出完整 5 个 package-e2e 文件 + 10 个 vitest unit。**但在 `/internal/stream` 的真实 stream 性、legacy dual-ingress 的真实隐含、cross-e2e 证据力、terminal 原因区分度这 4 点上,closure 叙事比代码事实更乐观。**
- **结论等级**:`approve-with-followups`
- **本轮最关键的 3 个判断**:
  1. **`/internal/stream` 是 "timeline-snapshot-to-ndjson transform",不是真正的 live stream**(R1,high)。agent-core 每次收到 `GET /internal/sessions/:id/stream` 时,会**同步**读 timeline + status,把结果合成一条完整 NDJSON body 一次性返回。这在 F1/F2 功能上够用,但它不是 charter §1.6 / design D3 承诺的 "实时 event relay"。它更接近 HTTP polling 的轮询 snapshot,只是语法上穿了 streaming response 的外衣。这会直接影响 F3/F4 之后真实 WS relay 语义的可行性。
  2. **legacy `/sessions/*` 在 agent-core 仍然完全活着**(R2,medium)。F1/F2 closure 声称 "canonical public ingress 已是 orchestrator-core",但 `workers/agent-core/src/index.ts:56-69` 的 fall-through 分支证明,**任何 client 仍然可以直接 `POST agent-core/sessions/:id/start`,完全绕开 orchestrator**。这是 F3 要解决的问题(charter 如此规定),但 F2 closure 的 "canonical" 措辞偏乐观 —— 真实状态是 **additive dual-ingress**,而非 canonical single-ingress。
  3. **`pnpm test:cross 40/40` 不构成 orchestrator canonical ownership 的证据**(R4,medium)。40 个 cross 测试当前仍通过 `NANO_AGENT_AGENT_CORE_URL` 直接打 agent-core,走的是 legacy public route。它们全绿只证明 **legacy 路径仍工作**,不证明 orchestrator 能承担 cross 场景。F2 closure 拿 40/40 当 canonical 证据是错位。

---

## 1. 审查方法与已核实事实

### 1.1 对照文档

- `docs/plan-orchestration-facade.md`(r2 charter)
- `docs/design/orchestration-facade/` 8 份 design + `FX-qna.md`(含 owner 最终答案)
- `docs/action-plan/orchestration-facade/F0-F5-*.md`(其中 F0-F2 有 §11 工作日志回填)
- `docs/issue/orchestration-facade/F0-closure.md` / `F1-closure.md` / `F2-closure.md`

### 1.2 核查代码

- `workers/orchestrator-core/package.json`(name / deps / scripts)
- `workers/orchestrator-core/wrangler.jsonc`(DO binding / AGENT_CORE service binding / TEAM_UUID / preview env)
- `workers/orchestrator-core/tsconfig.json`(rootDir=src,与其它 worker 一致)
- `workers/orchestrator-core/src/index.ts`(128 行 — 入口路由 + JWT ingress + DO routing)
- `workers/orchestrator-core/src/auth.ts`(185 行 — JWT verify/sign + authenticateRequest + tenant claim alignment + InitialContextSeed builder)
- `workers/orchestrator-core/src/user-do.ts`(660 行 — SessionEntry + lifecycle + retention + WS attachment + NDJSON relay + terminal/missing taxonomy)
- `workers/orchestrator-core/test/smoke.test.ts`(5 tests — probe / JWT reject / DO routing / WS upgrade)
- `workers/orchestrator-core/test/user-do.test.ts`(5 tests — detached start / status+verify forwarding / WS supersede / terminal+missing / retention purge)
- `workers/agent-core/src/index.ts`(74 行 — 新增 `/internal/*` 早退分支 + TEAM_UUID / NANO_INTERNAL_BINDING_SECRET env)
- `workers/agent-core/src/host/internal.ts`(178 行 — `routeInternal` + secret gate + 7-action router + `forwardInternalStream` NDJSON 合成)
- `.github/workflows/workers.yml`(CI matrix 已扩到 5 worker,含 `orchestrator-core`)
- `test/shared/live.mjs`(`orchestrator-core` URL + `NANO_AGENT_ORCHESTRATOR_CORE_URL` env)
- `test/package-e2e/orchestrator-core/01-05` 5 个 live test 文件
- `context/smind-contexter/src/chat.ts`(参照 `withTrace/withAuth/getUserDOStub/wrapInCicp` 四段)
- `context/smind-contexter/src/engine_do.ts`(参照 sessions Map + WebSocket upgrade)

### 1.3 执行过的验证

- `pnpm --filter @haimang/orchestrator-core-worker typecheck` → PASS(无错)
- `pnpm --filter @haimang/orchestrator-core-worker test` → **10/10 passed**(5 smoke + 5 user-do)
- `grep -n "业主回答" FX-qna.md` → 8 题全部非空("同意,与 Opus 的建议相同。")
- `grep matrix .github/workflows/workers.yml` → 5-worker 列表
- `find workers/orchestrator-core/src -type f` → 3 个 ts 源文件(index / auth / user-do),结构清晰
- `grep internal.ts SUPPORTED_INTERNAL_ACTIONS` → 7 条 action 枚举(start/input/cancel/status/timeline/verify/stream)完整

### 1.4 已确认的正面事实

- **orchestrator-core 从 0 到 1 真实落地**:package / tsconfig / wrangler / 3 源码文件 / 2 测试文件 / README / .gitignore,结构完整,遵循其它 4 worker 的命名 + 布局惯例。
- **DO 身份分层正确**:orchestrator-core 使用 `idFromName(user_uuid)`(`index.ts:94`),agent-core 继续 `idFromName(session_uuid)`(`index.ts:68`)。设计 §1.2 的 per-user / per-session 双 DO 法在代码里清晰落地。
- **agent-core `/internal/*` 早退设计正确**:`index.ts:52-54` 在 `routeRequest()` 调用**之前**用 `pathname.startsWith("/internal/")` 早退 —— 完全符合 design R3 建议。`routeInternal` 独立 parser 在 `host/internal.ts:41-57`,与 `routes.ts` 解耦,无 routing 冲突。
- **shared secret gate 按 Q1 frozen answer 实现**:`internal.ts:29-39` 的 `validateInternalSecret` 读 `x-nano-internal-binding-secret` header,与 `env.NANO_INTERNAL_BINDING_SECRET` 比较,不匹配 return typed `{error:"invalid-internal-auth"}` + HTTP 401。实现与我对 Q1 回答的 4 项落地细节(header 名 / secret 来源 / typed 401 / 不 fallback)**100% 对齐**。
- **JWT ingress 按 Q5/Q6 frozen answer 实现**:`auth.ts:146-156` 的 `claimTenant ?? deployTenant` + claim mismatch reject + `tenant_source: "claim" | "deploy-fill"` snapshot —— 完全符合 Q6 "claim 可缺失,存在则 mismatch reject" + audit trail 要求。
- **SessionEntry schema 按 F0 design D5 实现**:`user-do.ts:19-26` 的 `SessionEntry` 含 `created_at / last_seen_at / status / last_phase / relay_cursor / ended_at` 6 字段,与 D5 §7.2 F2 对齐。从 F1 第一次写入就是**完整 6 字段**(F1 工作日志 §11.4 第 2.项),不是 F1 写 4 字段 + F2 扩 2 字段的脆弱双阶段 —— 避免了 schema migration。这点比原 F2 action-plan §3 业务总表 "P1-01 SessionEntry 完整化" 的叙述更聪明。
- **relay cursor 语义正确**:`user-do.ts:254 relay_cursor: -1` 初始值为 -1;`user-do.ts:513-519 forwardFramesToAttachment` 中 `if (frame.seq <= cursor) continue; cursor = frame.seq` —— 这是 **`cursor = last_forwarded.seq`** 语义,与 design D3 / D6 默认语义一致。reconnect 时天然从 `cursor + 1` 恢复(等价行为)。
- **retention 按 Q4 frozen answer 实现**:`user-do.ts:91-93 MAX_ENDED_SESSIONS = 100, ENDED_TTL_MS = 24h`;`cleanupEndedSessions:620-636` 同时施加 time 与 count 两个窗口(`keptByTime = filter(...) → slice(-MAX)`)—— 实现了我对 Q4 建议的 "时间 + 数量双上限"。
- **attachment supersede 按 Q3 frozen answer 实现**:`user-do.ts:414-425 handleWsAttach` 对旧 attachment 先发 typed `{kind:"attachment_superseded", reason:"replaced_by_new_attachment", new_attachment_at}`,然后 close。不是静默断开 —— 与我对 Q3 的细化建议 100% 对齐。
- **`session_missing` vs `session_terminal` 的分层实现正确**:`user-do.ts:107-121` 两种 rejection shape 分开;`handleWsAttach:404-406` 先 `requireSession` 若不存在 → `sessionMissingResponse`(404),若 `status === "ended"` → `sessionTerminalResponse`(409)。这解决了我 Opus 2nd-pass action-plan review R7 提到的 "purged session 语义" 问题。
- **contexter 吸收口径高度遵守**:D4 inventory 定义的 adopt / adapt / defer / discard 四分法在代码中严格体现 —— 没有 SQLite,没有 CICP packet,没有 RAG,只借鉴了 JWT verify 算法 + middleware 模式 + user DO sessions map 结构。**未发现偷渡**。
- **owner 在 FX-qna 8 题全部回填**:均为 "同意,与 Opus 的建议相同。" —— Opus 的 Q1-Q8 二级意见被 owner 全盘采纳,并进入代码落地。
- **CI matrix 扩展正确**:`.github/workflows/workers.yml` 在 4 worker 后插入 `orchestrator-core`,保持 build/test/dry-run 工作流对称。
- **live harness 扩展正确**:`test/shared/live.mjs` 加了 `orchestrator-core` 的 default URL + `NANO_AGENT_ORCHESTRATOR_CORE_URL` env 覆盖。
- **本地 vitest 全绿**:orchestrator-core 10/10 passed(本次审查实测)。

### 1.5 已确认的负面事实

- **agent-core `/internal/stream` 不是真正的 stream,是 timeline-snapshot-to-NDJSON transform**:`internal.ts:95-148 forwardInternalStream` 每次被调用都会:(1) 同步拉 `stub.fetch(/timeline)`;(2) 同步拉 `stub.fetch(/status)`;(3) 把结果合成一整条 NDJSON body;(4) `buildNdjsonStream` 在 `start(controller)` 里**一次性 enqueue 全部 lines 然后 close**(`internal.ts:75-83`)。body shape 是 `ReadableStream`,但 behavior 是一次性 flush。
- **agent-core legacy `/sessions/*` 完全活着**:`index.ts:56-69` 在 `/internal/*` 早退**之后**,剩下所有路径继续走 `routeRequest()` + `SESSION_DO.fetch()` 的原始分发。没有任何 deprecation header,没有 410,没有重定向到 orchestrator。
- **`pnpm test:cross 40/40` 的真实 target 仍是 agent-core**:`test/shared/live.mjs` 有 4 个 worker URL + 新加 orchestrator URL,但 cross-e2e 测试文件如 `02-agent-bash-tool-call-happy-path.test.mjs` 通过 `getUrl("agent-core")` 拿 URL,**不是**通过 orchestrator 进入。F3 才做这层迁移(F3 action-plan 明确)。
- **`terminal: "completed"` 是 hardcoded**:`internal.ts:135-140` 合成 terminal frame 时 `terminal: "completed"` 写死,忽略真实 terminal 原因(cancel / error / ended)。对外界看,这个 stream 永远只会"以 completed 结束" —— D3 §7.2 F1 要求 terminal 4 值(completed/cancelled/error/ended)可区分,当前实现不满足。
- **orchestrator-core user-do.ts:275 `readInternalStream` 每次 start/input 后都全量拉一遍**:line 275 `const frames = await this.readInternalStream(sessionUuid)` 在 `handleStart` 尾部调用;`handleInput:322` 同样调用;`handleWsAttach:440` 也调用。一次 DO fetch 对同一个 agent-core DO 是便宜的,但这暴露了 "relay" 在当前实现里本质上是 "每次请求后同步 drain snapshot"。
- **TEAM_UUID = "nano-agent" 是字符串 placeholder**:`orchestrator-core/wrangler.jsonc:13` 写 `"TEAM_UUID": "nano-agent"` —— 不是 UUID 格式,只是 tenant marker 字符串。作为 F0-F2 的 first-wave single-tenant 占位合理,但下一阶段 multi-tenant 启动时需要规范化。
- **其它 4 个 worker 的 wrangler.jsonc 未加 TEAM_UUID**:当前只有 orchestrator-core 配了。F4.A 才做 5-worker 统一 deploy law,F0-F2 不负责此事,不是 finding,是 scope 边界记录。

---

## 2. 审查发现

### R1. `/internal/stream` 是 snapshot-to-NDJSON transform,不是 live stream(**high**)

- **严重级别**:`high`
- **类型**:`correctness`(架构层 — stream 语义偏离)
- **事实依据**:
  - `workers/agent-core/src/host/internal.ts:75-83` — `buildNdjsonStream(lines)`:
    ```typescript
    return new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
        controller.close();
      },
    });
    ```
    `start()` 同步把所有 line enqueue 然后 close,不暴露 controller 到外部,没有 async producer。
  - `workers/agent-core/src/host/internal.ts:95-148` — `forwardInternalStream` 不接 WebSocket / 不订阅 DO state changes,完全是 `stub.fetch(/timeline) + stub.fetch(/status)` 两次 HTTP 读取后合成。
  - `workers/orchestrator-core/src/user-do.ts:586-590` — orchestrator 侧 `readInternalStream` 每次都一次性读完 reader。
  - charter §1.6:"`agent.core -> orchestrator.core` 的 session stream relay,默认采用 **HTTP streaming response(Readable body)机制**" —— charter 明确要求 real streaming。
  - design D3 §7.2 F1 规定 NDJSON 三类 frame `meta/event/terminal`,实际实现把 timeline 里每个 event 映射为 `event` frame + 可选 `session.update` + 末尾 terminal,**没有任何 active producer**,没有 close 前的真实 event pump。
- **为什么重要**:
  1. F1/F2 的 "first event relay" 功能上能跑通,因为 **在 start 完成瞬间 timeline 可能已经有 1 条 turn_begin 事件**,timeline → NDJSON 转换刚好能拿到它。这让表面测试全绿。
  2. 但 reconnect 场景(F2 Phase 3 目标)真实语义是:client 断线后重连,orchestrator 应**继续接收 agent 侧新产生的 event**。当前实现下,orchestrator 每次重连都拉 **整个 timeline 从头**,没有 "resume since cursor" 的能力。orchestrator 侧的 cursor guard(`user-do.ts:513-519`)只是在 **客户端 forward 层** 避免重复,但 **internal 层** 仍然重复传全量。这对高事件量 session 是性能隐患。
  3. terminal 语义完全丢失 —— 永远 hardcoded `"completed"`,cancel 和 error 都识别不出来(见 §1.5 负面事实)。
  4. 更根本的问题:如果未来 agent-core DO 真正产生 **turn 期间持续多个 event**(例如 kernel step events 流式),orchestrator 侧的 "拉一次 snapshot" 模型无法消费它们。
- **审查判断**:
  - 不是 F2 阶段的 blocker(charter 允许 first-wave 用最简单 transport),但 closure 声称 "first event relay 真实可行" 是对 functionally work 的事实描述,**对 stream 真正的 live 性没有背书**。
  - F3/F4 之后若引入真正的 turn-streaming(现在 agent-core 可能不产生,但 future 必然会),当前 `/internal/stream` 实现需要重构。
- **建议修法**:
  1. **短期**(F3 实现期):让 `/internal/stream` 接受 `?since_seq=<N>` query,只返回 seq > N 的 events + 当前 status。orchestrator 侧 pass `relay_cursor` 作为 `since_seq`。降低重复传输。
  2. **中期**(与 F4 或下一阶段):让 agent-core DO 暴露 timeline subscription(或 alarm-triggered push),orchestrator user DO 基于 subscription 接收实时 event —— 这是真正的 live stream。
  3. **立即**(本周期或 F3 首批):修正 `terminal` hardcoded 值 —— 读 DO 当前 phase + 最后一条 timeline event 的 kind,判断实际 terminal 原因(`turn_complete` / `turn_cancelled` / `turn_error`),映射到 `completed/cancelled/error`。否则 D3 的 terminal taxonomy 从未真正落地。

### R2. legacy `/sessions/*` 在 agent-core 仍完全活着,closure 措辞偏乐观(**medium**)

- **严重级别**:`medium`
- **类型**:`docs-gap`(closure wording 过度承诺)
- **事实依据**:
  - `workers/agent-core/src/index.ts:56-69`:
    ```typescript
    const route = routeRequest(request);
    if (route.type === "not-found") { ... }
    const sessionId = ... route.sessionId ...;
    const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId));
    return stub.fetch(request);
    ```
    非 `/internal/*` 的 `/sessions/:id/*` 全部 fall through 到原 SESSION_DO.fetch(),未添加 deprecation header,未返回 410,未 redirect。
  - `docs/issue/orchestration-facade/F2-closure.md:§3`:"canonical public ingress 已经有真实 session seam" —— "canonical" 一词对读者暗示 **agent-core legacy 已不是 canonical**。
  - charter §1.5:first-wave 保留 compatibility,F3 才做 cutover。行为上 F2 状态与 charter 一致 —— 但 closure 的措辞超出了行为真相。
- **为什么重要**:
  - 这是"真实状态 vs 文档承诺"的 mismatch。当前真实状态是 **dual-ingress**:外部 client 既可打 orchestrator 也可直打 agent-core,两条路 semantically 等价。F2 closure 说 "canonical" 会让下游读者误以为 agent-core 已失去 public ownership。
  - 特别是 F3 执行者若信任 F2 closure 的措辞,可能低估 F3 的工作量(以为 "只是关掉已失效的 legacy route"),实际则要 hard disable 一个**仍然在正常工作的** public surface。
- **审查判断**:
  - 非代码问题 —— F1/F2 按 charter 就应该保留 dual-ingress。
  - 是 closure memo wording 精度问题。
- **建议修法**:
  1. F2-closure.md §3 第 1 条 "canonical public ingress 已经有真实 session seam" → 改为 "orchestrator-core 已具备完整 first-wave session seam,可承担 canonical ingress;但 agent-core legacy `/sessions/*` **仍处于 additive 共存状态**,F3 才做单一化 cutover"。
  2. F3 action-plan 在 "风险与依赖" 表明确记录:"cutover 时需要把 agent-core 当前仍 fully functional 的 legacy surface 翻转为 410/426,**不是移除已失效残留**"。

### R3. NDJSON `terminal` 原因 hardcoded 为 `"completed"`,丢失 cancel/error 区分(**medium**)

- **严重级别**:`medium`
- **类型**:`correctness`
- **事实依据**:
  - `workers/agent-core/src/host/internal.ts:134-140`:
    ```typescript
    if (phase && phase !== "turn_running") {
      lines.push(JSON.stringify({
        kind: "terminal",
        seq: nextSeq,
        terminal: "completed",    // ← hardcoded
        payload: { phase },
      }));
    }
    ```
    不论 DO 实际因 cancel / error / normal-complete 结束,一律报 `"completed"`。
  - `docs/design/orchestration-facade/F0-stream-relay-mechanism.md` §7.2 F1 要求 terminal 4 值(`completed | cancelled | error | ended`)可区分。
  - orchestrator-core `user-do.ts:341-381 handleCancel` 依赖 **自己** 在 cancel 路径上构造 `SessionTerminalRecord{terminal: "cancelled"}`(`user-do.ts:357-361`),**不从 agent-core stream 读取**。这说明 orchestrator 侧已经给自己做了一套 terminal reason,agent-core 侧那条 hardcoded `"completed"` 事实上没被用到 —— **但如果下游某天真的消费 stream terminal frame**,它会拿到错误数据。
- **为什么重要**:
  - 目前 orchestrator 做了 "自证" 机制绕开 agent-core 的 terminal 字段(cancel action 自己决定 terminal=cancelled)。但这种双轨 truth source 本身就是 code smell:**谁是 terminal 真相?** agent-core 的 stream 说 `completed`,orchestrator 的 SessionTerminalRecord 说 `cancelled`,如果以后 WS client 同时收到 terminal frame + cancel-response,两者的 terminal 值不一致。
  - F3 legacy retire 之后,如果 cross-e2e 新测试 assert agent-core internal stream 的 terminal,会永远看到 `completed`,与 orchestrator 上报的 `cancelled` 冲突。
- **审查判断**:
  - 是当前代码的真实缺陷,不影响 F1/F2 happy path 测试通过(因为 orchestrator 绕开了),但会影响长期 stream 语义一致性。
- **建议修法**:
  1. `agent-core/src/host/internal.ts:forwardInternalStream` 增加 phase → terminal 的真实映射:
     - phase `"ended"` + last event kind 含 `cancel` → `terminal: "cancelled"`
     - phase `"ended"` + last event kind 含 `error` → `terminal: "error"`
     - phase `"ended"` 其它 → `terminal: "completed"`
     - 或更简单:读 DO 存储里的 `session:checkpoint.last_shutdown_reason`(若存在)
  2. 或者:删除 agent-core 侧的 hardcoded terminal,在 orchestrator 侧**永远**由自己判断,并在 design D3 里明确 "agent-core 不负责 terminal 原因,orchestrator 是真相源"。

### R4. `pnpm test:cross 40/40` 作为 canonical 证据是错位的(**medium**)

- **严重级别**:`medium`
- **类型**:`test-gap` + `docs-gap`
- **事实依据**:
  - `docs/issue/orchestration-facade/F2-closure.md:§4`:"live suites passed: pnpm test:package-e2e (29/29), pnpm test:cross (40/40)"
  - `docs/action-plan/orchestration-facade/F2-session-seam-completion.md:§11.5` 同样声明。
  - `test/cross-e2e/02-agent-bash-tool-call-happy-path.test.mjs` 等 cross 测试文件通过 `getUrl("agent-core")` 拿 URL,**直接**打 agent-core `/sessions/:id/...`。
  - `test/shared/live.mjs:22-24` `workerUrl` 函数查 env → DEFAULT_URLS 映射,其中 `agent-core` 仍然是 legacy 入口。
  - F3 action-plan 明确 cross-e2e 迁移是 F3 任务(`F3-canonical-cutover-and-legacy-retirement.md` P3-01)。
- **为什么重要**:
  - 40 个 cross 测试全绿**只证明** agent-core legacy 路径仍在工作,**不证明** orchestrator-core 能在 cross 场景下承担 canonical ownership。
  - 把 40/40 当 F2 closure 证据,读者会误以为 orchestrator 已被 cross 测试端到端验证过,实际**完全没有**。
  - 真正能证明 F2 的只有 `test/package-e2e/orchestrator-core/*.test.mjs` 5 个文件(01-05)—— 这些是真正打 orchestrator URL 的。
- **审查判断**:
  - 不是代码错误,是 evidence 归因错位。
- **建议修法**:
  1. F2 closure §4 "live suites passed" 拆分表述:
     - `test/package-e2e/orchestrator-core/*.test.mjs (5/5)` → **真正的 F2 证据**
     - `pnpm test:package-e2e (29/29)` → orchestrator (5) + 其它 worker (24) 的汇总,其它 worker 不变
     - `pnpm test:cross (40/40)` → 标注 **"仍走 legacy agent-core,F3 才迁移 — 不是 orchestrator canonical 证据"**
  2. 下次 F3 closure 时,cross 总数 40/40 再出现 should 明确 "入口已从 agent-core 迁到 orchestrator-core"。

### R5. orchestrator-core TEAM_UUID 是字符串 placeholder,跨 worker 未统一(**medium**)

- **严重级别**:`medium`
- **类型**:`scope-drift`(但在 charter 允许范围内)
- **事实依据**:
  - `workers/orchestrator-core/wrangler.jsonc:13`:`"TEAM_UUID": "nano-agent"` —— 非 UUID 格式。
  - `workers/agent-core/wrangler.jsonc`、`workers/bash-core/wrangler.jsonc`、`workers/context-core/wrangler.jsonc`、`workers/filesystem-core/wrangler.jsonc`:**均无** `TEAM_UUID` 字段。
  - `workers/agent-core/src/host/do/nano-session-do.ts:812-826`:若 `env.TEAM_UUID` 缺失 → fallback `"_unknown"`。
  - FX-qna Q5 frozen answer:"preview/prod 必须显式配置 TEAM_UUID,`_unknown` 只允许本地/测试"。
- **为什么重要**:
  - 当前 orchestrator 侧的 JWT tenant claim alignment(`auth.ts:146-150`)能正常工作,因为 orchestrator 的 `env.TEAM_UUID = "nano-agent"` 已配置,claim 缺失时 `deploy-fill` 填 `"nano-agent"`。
  - 但 agent-core 侧 `buildIngressContext()` 仍读 `env.TEAM_UUID` —— 如果 agent-core preview env 没配(当前事实),运行时 tenant 就是 `"_unknown"`。
  - **跨 worker 的 tenant truth 不一致**:orchestrator 认为 tenant 是 `"nano-agent"`,agent-core 认为是 `"_unknown"`。若 orchestrator 把 authority payload `tenant_uuid: "nano-agent"` forward 到 agent-core,agent-core 的 `verifyTenantBoundary` 会看到 `frame.team_uuid != doTeamUuid` → 可能拒绝。
  - 当前实现规避了这个:agent-core 的 `/internal/*` 通道走 `host/internal.ts` 的 `forwardHttpAction`,**没有重新构造 NACP envelope 也没有 call `verifyTenantBoundary`** —— internal 路径绕过了 B9 tenant wrapper。这是另一面的问题(见 O2)。
- **审查判断**:
  - charter 说 F4.A 才统一 deploy law,F0-F2 不负责,技术上合规。
  - 但如果 F3 迁移前 4 个 worker 未同步 TEAM_UUID,就 hard cutover legacy,tenant boundary 会在 cross-seam 点爆炸。
- **建议修法**:
  1. F3 kickoff 前(或 F3.C 之前),把 `workers/{agent-core,bash-core,context-core,filesystem-core}/wrangler.jsonc` 都加 `"TEAM_UUID": "nano-agent"`(preview env 同步)。**这不能等到 F4.A**,必须在 legacy cutover 之前 —— 否则 orchestrator 转 NACP envelope 给 agent-core 后 boundary verify 会失败。
  2. 或者在 F3 前检查:internal `/internal/*` 路径是否需要跑 `verifyTenantBoundary`?当前 `routeInternal` 跳过了 NACP envelope 构造(见 O2),这让 tenant mismatch 绕过,功能上"凑合",但 F4.A 硬化 authority 时要重做。

### R6. orchestrator-core user-do.ts 的 `status/timeline/verify` 是代理穿透,未自行落 registry phase 同步(**low**)

- **严重级别**:`low`
- **类型**:`correctness`(边缘 edge case)
- **事实依据**:
  - `workers/orchestrator-core/src/user-do.ts:487-503 proxyReadResponse`:读 agent-core response body,`extractPhase` 从 body.phase 取,更新 `entry.last_phase` 后回传。
  - 如果 agent-core internal response body 的 JSON 不含 `phase` 字段(例如 agent-core 返回 `{ events: [...] }` 而非 `{ phase, events }`),`extractPhase` 返回 `null`,entry 保持原 `last_phase`。
  - 当前 `agent-core/src/host/http-controller.ts` 的 `handleStatus` / `handleTimeline` / `handleVerify` 返回什么 shape,取决于 DO 是否 wire。测试里显示 `{ ok: true, action: "status", phase: "attached" }` 这类 shape。
- **为什么重要**:
  - proxyReadResponse 的错位是:它**吞掉** body 中可能与 orchestrator 注意力不同的字段(例如 `events`、`timeline`),`cloneJsonResponse(status, body)` 只是原样序列化。所以功能上没问题,但**每次 status/timeline/verify 都多读一遍完整 body + 同步落 registry** —— 读 + 写 + 回传的 round trip 对 pure read action 是过度的。
  - Verify is preview-only。Orchestrator 透传 verify 然后更新 phase —— 实际 verify response 可能 phase 字段为空,body 是 `{error:"unknown-verify-check"}` 这类 —— 当前实现处理了 `null` phase(保留旧值),OK。
- **审查判断**:
  - 不是 bug,是 performance 小毛刺。优化可以后续做。

### R7. orchestrator-core `05-verify-status-timeline.test.mjs` 的 verify negative 断言条件偏弱(**low**)

- **严重级别**:`low`
- **类型**:`test-gap`
- **事实依据**:
  - `test/package-e2e/orchestrator-core/05-verify-status-timeline.test.mjs:51-55`:
    ```javascript
    const verify = await fetchJson(`${base}/sessions/${sessionId}/verify`, {
      method: "POST", headers, body: JSON.stringify({ check: "bogus" }),
    });
    assert.equal(verify.response.status, 200);
    assert.equal(verify.json?.error, "unknown-verify-check");
    ```
    assert status=200 + body.error=unknown-verify-check。
  - agent-core `package-e2e/06-verify-unknown-check.test.mjs`(worker-matrix P2 时创建)的原始 assert 更严格:它 `SUPPORTED = new Set(["capability-call", "capability-cancel", "initial-context", "compact-posture", "filesystem-posture"])`,枚举每个 support check 断言返回特定 shape,还对 unknown 断言 error shape 的完整字段(不止 `error`)。
- **为什么重要**:
  - 新写的 05-verify-status-timeline 只覆盖 unknown check 一条,没覆盖 5 个 canonical check names 的 drift guard —— 后续 verify support 集合若变更,当前 orchestrator package-e2e 不会 red。
  - 不是严重问题,因为 agent-core 的 06 仍有 drift guard,但 orchestrator 入口的 verify 代理行为未被对称验证。
- **审查判断**:
  - 可推到 F3.B 测试迁移阶段统一补齐。
- **建议修法**:
  1. F3.B 迁移 agent-core `06-verify-unknown-check.test.mjs` 到 `orchestrator-core/06-verify-unknown-check.test.mjs` 时,保留 5-check drift guard 断言。

---

## 3. In-Scope 逐项对齐审核

### 3.1 F0 — Concrete Freeze Pack(S)

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P1-01 | charter / design / FX-qna 一致性审计 | `done` | 8 份 design + FX-qna + charter 顶层状态翻到 "F0 freeze closed" |
| P1-02 | review finding 分类 | `done` | DeepSeek / Opus findings 回填 close-out 附章 |
| P2-01 | design wording 收口 | `done` | 8 份 design 均翻到 `frozen` |
| P2-02 | charter wording 收口 | `done` | charter 顶层状态同步 |
| P3-01 | F1-F5 entry checklist 清单化 | `done` | F1-F5 6 份 action-plan 形成连续链 |
| P3-02 | implementation follow-up 降级 | `done` | `503/throw`、URL 组装、partial replay 归入实现期 |
| P4-01 | F0 closure memo | `done` | `docs/issue/orchestration-facade/F0-closure.md` 已产出 |

**F0 小结**: 7/7 done。FX-qna 8 题 owner 全回填("同意,与 Opus 的建议相同。"),Opus 三字段也全部填满。scope discipline 良好,无代码越权。

### 3.2 F1 — Bring-up and First Roundtrip(M)

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P1-01 | orchestrator-core worker shell | `done` | 4 配置文件 + 3 源码文件 + 2 测试文件 + README |
| P1-02 | orchestrator probe marker | `done` | `phase: "orchestration-facade-F1"` 初版,F2 升到 F2(见 §3.3) |
| P2-01 | public start ingress | `done` | `orchestrator-core/src/index.ts:88` + `auth.ts` |
| P2-02 | per-user DO registry shell | `done` | `user-do.ts` + `idFromName(user_uuid)` |
| P3-01 | `/internal/*` 最小集 | `done` | 7 条全部,超出 F1 原计划的 4 条(start/input/cancel/stream)—— **实际 status/timeline/verify 也一起做了**,见下文评注 |
| P3-02 | secret gate | `done` | `x-nano-internal-binding-secret` + typed 401 |
| P4-01 | NDJSON relay reader | `partial` | 功能上读 NDJSON,但 **agent-core 侧发送的不是真正的 stream**(R1) |
| P4-02 | cursor 初始语义 | `done` | `relay_cursor = last_forwarded.seq` 正确实现 |
| P5-01 | minimal live suite | `done` | `01-preview-probe + 02-session-start` 已创建 |
| P5-02 | F1 closure | `done` | `F1-closure.md` 已产出 |

**F1 评注**:
- **P3-01 实际完成了比计划更多的工作**:原计划是 `start/cancel/stream` 3 条(或我 Opus 2nd-pass action-plan R1 推荐的 `start/input/cancel/stream` 4 条),但实际 `internal.ts:15-23` 开了 7 条全集。这让 F2 的 Phase 2/3 工作从"扩 internal 到 4 条 path"变成"只改 orchestrator 侧消费逻辑",显著轻量化 F2。**超出计划但合理前置**,不扣分。
- **P4-01 的 partial 评级源于 R1**:功能上可消费 NDJSON,但 agent-core 侧不是真正的 live stream(snapshot transform)。闭环功能在,架构语义未达。

### 3.3 F2 — Session Seam Completion(M)

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P1-01 | SessionEntry 完整化 | `done` | 6 字段(F1 就已完整,F2 主要补 status transitions) |
| P1-02 | ended retention | `done` | 24h + 100 双上限 lazy cleanup |
| P2-01 | façade input/cancel | `done` | `user-do.ts:handleInput + handleCancel` |
| P2-02 | façade status/timeline/verify | `done` | proxyReadResponse 透传(R6 是 low perf,不阻塞) |
| P3-01 | WS attach | `done` | `handleWsAttach:399-452` |
| P3-02 | reconnect taxonomy | `done` | `session_terminal` / `session_missing` / success(WS 成功 upgrade) |
| P4-01 | terminal mapping | `partial` | orchestrator 侧 terminal record 正确,但 agent-core stream 的 terminal 永远 `"completed"`(R3) |
| P4-02 | terminal attach rejection | `done` | `handleWsAttach:405-406` |
| P5-01 | façade package-e2e 扩面 | `done` | 03/04/05 已添加 |
| P5-02 | F2 closure | `done` | `F2-closure.md` 已产出,但 closure 措辞偏乐观(R2/R4) |

**F2 评注**:
- probe marker 已 rollover 到 `orchestration-facade-F2`(`index.ts:21, 32`,以及 `01-preview-probe.test.mjs:11`)✓
- attachment supersede + close message 按 Q3 frozen answer 实现 ✓
- retention 按我对 Q4 推荐的双上限实现 ✓

### 3.4 总体对齐结论

- **done**: 24 / 27 = 89%
- **partial**: 2(F1 P4-01 + F2 P4-01,都是 R1/R3 相关)
- **done (with closure wording issues)**: 1(F2 P5-02,R2/R4)
- **missing**: 0

> F0-F2 主体完成。2 条 `partial` 都指向同一个底层问题(agent-core stream 语义不足);closure wording 2 处偏乐观但代码本身正确。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 重造全新 public product API | `遵守` | orchestrator-core `/sessions/:id/*` 7 action 与 agent-core compatible,无新 API 重造 |
| O2 | multi-tenant-per-deploy | `遵守` | TEAM_UUID 仍 single-tenant("nano-agent" placeholder),不引入 tenant migration |
| O3 | full user-memory / RAG | `遵守` | user DO 只含 4 字段 schema + session registry,无 SQLite / RAG / director |
| O4 | concrete credit ledger | `遵守` | orchestrator-core 无 credit / quota 任何相关代码 |
| O5 | WorkerEntrypoint RPC | `遵守` | 全程 fetch-backed service binding,无 RPC rewrite |
| O6 | orchestrator direct bind context/filesystem | `遵守` | wrangler.jsonc services 只有 `AGENT_CORE`,无 CONTEXT/FILESYSTEM binding |
| O7 | F3 canonical cutover / legacy deprecation | `遵守` | agent-core legacy `/sessions/*` 完全保留(R2 的另一面 — 这里是对的) |
| O8 | F4 authority helper / executor recheck | `遵守` | 无 `CapabilityExecutor` hook 改动 |

**Out-of-scope 全 8 条 遵守**。无 scope creep,无偷渡 F3/F4 工作。

### 4.1 一个值得注意的"灰色地带"观察(非违反)

`workers/agent-core/src/host/internal.ts:59-73 forwardHttpAction`:
- 把 internal request 的 body 原样 forward 到 `SESSION_DO.fetch(targetUrl)`,**未经 NACP envelope 包装**
- 不走 `acceptClientFrame` / `verifyTenantBoundary` / B9 tenant wrapper

这是 F4.A authority hardening 要补的事(F4 P3-01 no-escalation enforcement)。当前 internal 通道 auth 只靠 header secret,**没有 NACP envelope 校验**。这是 F1/F2 可接受的简化,但 F4.A 必须处理。

这不是 out-of-scope 违反(F4.A 才管 authority 硬化),但 **R5 的 tenant boundary concern 直接依赖这个事实**:因为 internal 通道不走 `verifyTenantBoundary`,tenant mismatch 不会爆。若 F4.A 加了 NACP envelope 校验而 agent-core 其它 4 worker 的 TEAM_UUID 没同步配,系统会 broken。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**:F0-F2 三个周期**结构性交付扎实**,orchestrator-core 代码质量高、contexter 吸收清单严格遵守、user DO lifecycle / retention / attachment / terminal taxonomy 按 FX-qna frozen answers 落地。**审查通过,以 approve-with-followups 结论收口**。
- **是否允许关闭本轮 review**:`yes — with 3 follow-ups 推到 F3 / F4` —— 本轮不要求回滚或补修,3 条 followup 直接进入后续 phase。
- **关闭前必须完成的 blocker**:
  1. **R1 后半段**(`terminal: "completed"` hardcoded)应在 F3 前修正 —— 否则 legacy retirement 后任何 stream 消费者都会看到错误的 terminal 原因。建议 F3.A 首批任务。
- **可以后续跟进的 non-blocking follow-up**:
  1. **R1 前半段 / R3**:`/internal/stream` 的 snapshot-to-ndjson 本质限制 → 推到 F4 或下一阶段做真正 live stream 重构;短期 F3 可加 `?since_seq=` query 降低重复传输。
  2. **R2**:F2-closure.md 措辞修正 —— 把 "canonical" 改为 "canonical-ready but dual-ingress active,F3 cutover"。顺手改。
  3. **R4**:F2-closure.md `cross 40/40` 归因修正 —— 拆开 orchestrator(5) / agent-core-legacy(24) / cross-still-legacy(40),明确 canonical 证据只来自 `package-e2e/orchestrator-core/*`。顺手改。
  4. **R5**:F3 kickoff 前把其它 4 worker 的 `wrangler.jsonc` 同步加 `TEAM_UUID: "nano-agent"`,否则 F4.A NACP envelope 硬化时会在 tenant boundary 爆。建议**F3.A 之前**处理。
  5. **R6**:`proxyReadResponse` 性能小毛刺 —— 推到 F5 handoff 或 future optimization。
  6. **R7**:F3.B 迁移 `06-verify-unknown-check.test.mjs` 到 orchestrator suite 时保留 5-check drift guard。

> **本轮 review 收口**。F3 启动前需要处理 R1 后半(terminal reason)+ R5(5-worker TEAM_UUID 统一),其它推到自然 phase 时机。

---

## 6. 对 Contexter 参考代码的对照评估

（本节用于独立验证 F1/F2 对 contexter 吸收口径的遵守度,与 D4 absorption inventory 对齐）

| contexter 资产 | design label | F1/F2 实际处理 | 评估 |
|---|---|---|---|
| `core/jwt.ts` | `adopt-as-is (light adaptation)` | `auth.ts:74-95 verifyJwt` 重写,HMAC SHA-256 pattern 同,接口签名 `(token, secret) → JwtPayload \| null` 同 | ✓ 遵守 — 模式采纳,代码从头写(非直接 copy),合理 |
| `chat.ts::withTrace` | `adapt-pattern` | `auth.ts:179` `request.headers.get("x-trace-uuid") ?? crypto.randomUUID()` | ✓ 遵守 |
| `chat.ts::withAuth` | `adapt-pattern` | `auth.ts:132-184 authenticateRequest` — 扩展了 tenant alignment + snapshot + seed | ✓ 遵守 + 合理扩展 |
| `chat.ts::getUserDOStub` | `adapt-pattern` | `index.ts:94` `env.ORCHESTRATOR_USER_DO.get(...idFromName(auth.value.user_uuid))` | ✓ 完全同 pattern |
| `chat.ts::wrapInCicp` | `discard-as-code / keep-as-idea` | 无 `wrapInCicp`,用 `stub.fetch(url, { body: { ...rawBody, trace_uuid, auth_snapshot, initial_context_seed } })` 直接构造 NACP-flavored body | ✓ 遵守 — 思路保留,CICP shape discard |
| `engine_do.ts` sessions Map | `adapt-pattern` | `user-do.ts:180` `private readonly attachments = new Map<string, AttachmentState>()` —— 按 `session_uuid` 做 key(非 contexter 的 `WebSocket` key) | ✓ 合理适配(orchestrator 查询场景不同) |
| `engine_do.ts` WS accept | `adapt-pattern` | `user-do.ts:412 pair.server.accept?.()` | ✓ 完全同 pattern |
| `core/db_do.ts` | `defer` | **未引入**,user-do.ts 走 DO storage key-value | ✓ 遵守 |
| `core/alarm.ts` | `defer` | **未引入** | ✓ 遵守 |
| `core/broadcast.ts` | `adapt-pattern` | orchestrator 没有多消费者 broadcast,只 single-writable attachment —— 模式精神相近但 scope 更小 | ✓ 遵守(first-wave 克制) |
| `core/schemas_cicp.ts` | `discard` | **未引入** | ✓ 遵守 |
| `context/*` + `ai/*` + `rag/*` | `discard` | **未引入**,无 RAG / director / producer / writer | ✓ 遵守 |

**总体遵守度**:`12/12 完全遵守,无偷渡`。D4 inventory 在代码里严格落地,体现了 F0 freeze pack 的真实约束力。

---

## 7. 总结与下一步

### 7.1 整体评价

F0-F2 的执行**高于我对同规模阶段的平均预期**,主要体现在:

1. **design → action-plan → code 三层贯通**:FX-qna 的 8 个 frozen answer 全部在代码里能找到精确映射。Q1 shared secret / Q3 single writable attachment / Q4 双上限 retention / Q6 tenant claim 处理 —— 每一条都不是"计划说要做,实现时变样"。
2. **contexter 吸收严格遵守 inventory**:没有偷渡 SQLite / CICP / RAG / Director。orchestrator-core 的 660 行 user-do.ts 是"新代码 + contexter 模式参考",不是 "contexter copy-paste"。
3. **scope discipline 维持良好**:out-of-scope 8 条全部遵守,agent-core legacy 正确保留(F3 才动),F4.A authority 正确延后。
4. **测试扩面合理**:从 F1 的 2 个 orchestrator-core live test 扩到 F2 的 5 个,package-e2e 命中面 29,本地 vitest 10/10 通过。

### 7.2 主要薄弱点

1. **`/internal/stream` 的 "stream" 是修辞,不是行为**(R1)—— 是 F0-F2 阶段最实质的架构缺陷,虽然不阻塞功能验收,但承载 charter §1.6 承诺不完整。
2. **closure memo wording 偏乐观**(R2 + R4)—— "canonical"、"40/40 cross 绿"两条措辞让读者产生 "orchestrator 已承担 cross 场景" 的印象,与真实状态不符。
3. **`terminal: "completed"` hardcoded**(R3)—— D3 design 要求的 4 值可区分只在 orchestrator 侧用 SessionTerminalRecord 实现,agent-core 侧的 stream frame 丢失信息。

### 7.3 F3 kickoff 前建议处理清单

| 项 | 建议处理时机 | 原因 |
|---|---|---|
| R3 terminal reason 正确映射 | **F3 前必须** | 否则 legacy retire 后消费者拿到错误 terminal |
| R5 4 worker wrangler.jsonc 同步 TEAM_UUID | **F3 前必须** | 否则 F4.A 硬化 authority 时 tenant boundary 爆 |
| R2 F2-closure wording 修正 | F3 启动前可顺手 | 避免 F3 执行者低估工作量 |
| R4 F2-closure 40/40 cross 证据归因修正 | F3 启动前可顺手 | 同上 |
| R1 stream 架构重构 | F4 或下阶段 | 不阻塞 F3 |
| R6/R7 performance / test coverage | F5 或 future | low priority |

---

## 8. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-24 | Claude Opus 4.7 (1M context) | F0-F2 三个阶段的完整独立代码审查。基于 action-plan 工作日志 §11 + 3 份 closure + 实际源码 (`workers/orchestrator-core/**`, `workers/agent-core/src/{index,host/internal}.ts`) + test tree + contexter 参考代码 + FX-qna owner 最终答案,识别 7 条 finding(1 high / 4 medium / 2 low),判决 `approve-with-followups`。R3+R5 推到 F3 前处理;其它 follow-up 自然跟进。独立完成,未参考其它评审者对同范围的分析。

---

## 9. 实现者回应（按 §6 模板）

### 9.1 对本轮审查的回应

> 执行者: `GPT-5.4`
> 执行时间: `2026-04-24`
> 回应范围: `Opus R1-R7 + DeepSeek R1-R5 + Kimi R1-R6（按主题归并）`

- **总体回应**：本轮 review 中成立的问题已按“代码缺陷优先修、设计/closure 口径漂移同步收口、无真相源的推断型修法不硬造”原则完成处理。
- **本轮修改策略**：先修真正影响 correctness / test discipline / scope truth 的项（stream frame 校验、minted 悬空、JWT helper 位置、reconnect/verify 证据），再同步 action-plan / closure / frozen design，使文档口径回到当前代码事实上。

### 9.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | `/internal/stream` 被 closure 当成 live relay；DeepSeek R1/R3 同类指出 snapshot relay 口径漂移 | `fixed` | 未把 current snapshot relay 伪装成 persistent push；改写 F1/F2 closure、action-plan、design doc，并在 `agent-core` 内部实现处加 snapshot-based 注释 | `docs/issue/orchestration-facade/F1-closure.md`, `docs/issue/orchestration-facade/F2-closure.md`, `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`, `docs/action-plan/orchestration-facade/F2-session-seam-completion.md`, `docs/design/orchestration-facade/F0-stream-relay-mechanism.md`, `workers/agent-core/src/host/internal.ts` |
| R2 | legacy dual-ingress 仍活着；closure / evidence 把 orchestrator 说得过满；Opus R4 同时指出 `test:cross` 证据归因错位 | `fixed` | 把 F2 closure 从“已 canonical”改为“已具备承接 canonical ingress 的 seam，但 legacy additive 共存到 F3”；同时给 `test:cross` 全部补上“仍主要走 legacy agent-core ingress”的限定语 | `docs/issue/orchestration-facade/F1-closure.md`, `docs/issue/orchestration-facade/F2-closure.md`, `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`, `docs/action-plan/orchestration-facade/F2-session-seam-completion.md` |
| R3 | agent-core internal stream 的 terminal hardcoded 为 `completed` | `deferred` | 经代码与 runtime event truth 核查，当前 internal snapshot relay 没有可稳定区分 cancel/error 的单一真相源；orchestrator 侧 session terminal 仍由 façade own。未硬造错误 taxonomy，而是把 design / closure 改明：internal terminal 表示 relay read 收口，不自动等于 façade lifecycle ended | `docs/design/orchestration-facade/F0-stream-relay-mechanism.md`, `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md`, `docs/issue/orchestration-facade/F2-closure.md` |
| R4 | verify negative 断言偏弱 | `fixed` | 把 orchestrator package-e2e 的 verify unknown-check 断言补到 canonical envelope 级别：校验 `ok/action/check/error/supported[]`，并锁住 5 个 expected checks | `test/package-e2e/orchestrator-core/05-verify-status-timeline.test.mjs` |
| R5 | `minted` 在类型和文档里存在，但实现里从未落地；DeepSeek R2 同类指出其与 client-provided session UUID 现实冲突 | `fixed` | 从 `SessionStatus` 中移除 `minted`，并同步 charter / design / action-plan 的 lifecycle 与 schema 叙述，改成当前真实的 `starting/active/detached/ended` | `workers/orchestrator-core/src/user-do.ts`, `docs/plan-orchestration-facade.md`, `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md`, `docs/design/orchestration-facade/F0-user-do-schema.md`, `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`, `docs/action-plan/orchestration-facade/F2-session-seam-completion.md` |
| R6 | Kimi R1 / DeepSeek R5：`readNdjsonFrames` 只做类型断言，无运行时校验 | `fixed` | 在 façade 侧加入 `kind` discriminator + seq/payload/terminal 手工运行时校验；畸形 NDJSON 现在返回 typed `502 invalid-stream-frame`，并新增单测覆盖 | `workers/orchestrator-core/src/user-do.ts`, `workers/orchestrator-core/test/user-do.test.ts` |
| R7 | Kimi R4：reconnect live taxonomy 缺 terminal/missing；Kimi R5：`signJwt` 混入生产路径 | `fixed` | 新增 live reconnect terminal/missing 用例；将 JWT 签发 helper 从生产 `auth.ts` 移出，改为 worker test helper 与 package-e2e shared helper | `test/package-e2e/orchestrator-core/04-reconnect.test.mjs`, `test/package-e2e/orchestrator-core/02-session-start.test.mjs`, `test/package-e2e/orchestrator-core/03-ws-attach.test.mjs`, `test/package-e2e/orchestrator-core/05-verify-status-timeline.test.mjs`, `test/shared/orchestrator-jwt.mjs`, `workers/orchestrator-core/test/jwt-helper.ts`, `workers/orchestrator-core/test/smoke.test.ts`, `workers/orchestrator-core/src/auth.ts` |
| R8 | DeepSeek R4：contexter JWT “adopt-as-is” 与实际 full reimplementation 不符 | `fixed` | 把 absorption inventory 与 charter inventory 改成 `adapt-pattern (reimplemented from reference)`，避免制造虚假的直接 lineage | `docs/design/orchestration-facade/F0-contexter-absorption-inventory.md`, `docs/plan-orchestration-facade.md` |
| R9 | Kimi R2：cursor 语义与 frozen design 不一致 | `fixed` | 保持当前 event-only cursor 代码不变，但把 design doc 明确改成 shipped semantics：first-wave 只有 forwarded `event` 计入 cursor，`meta/terminal` 不计入 | `docs/design/orchestration-facade/F0-stream-relay-mechanism.md` |
| R10 | Kimi R3：`completed/error -> ended` 映射缺失 | `rejected` | 这条在当前 session model 下不是安全代码修法：internal snapshot relay 的 terminal 表示一次 read/turn 收口，不等于 session ended；若硬改会把可继续 follow-up 的 session 错误终结。已通过 lifecycle / relay docs 明确分层 | `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md`, `docs/design/orchestration-facade/F0-stream-relay-mechanism.md` |
| R11 | Opus R5：TEAM_UUID placeholder 与跨 worker 未统一 | `deferred` | 这是 F3/F4 deploy law 与 tenant hardening 议题，当前不在 F0-F2 review fix 的安全改动面内；未在本轮偷改其它 workers 的 deploy config | `无代码修改（记录为后续阶段 follow-up）` |
| R12 | Kimi R6 / Opus R6：tenant 策略一致性、proxyReadResponse 轻微过度同步 | `rejected` | 前者在非 test 环境由 `ensureTenantConfigured` 先行收口，当前不会形成生产歧义；后者是 low-grade perf concern，不是 correctness bug。本轮不引入行为改写 | `无代码修改` |

### 9.3 变更文件清单

- `workers/orchestrator-core/src/user-do.ts`
- `workers/orchestrator-core/src/auth.ts`
- `workers/orchestrator-core/test/user-do.test.ts`
- `workers/orchestrator-core/test/smoke.test.ts`
- `workers/orchestrator-core/test/jwt-helper.ts`
- `workers/agent-core/src/host/internal.ts`
- `test/shared/orchestrator-jwt.mjs`
- `test/package-e2e/orchestrator-core/{02-session-start,03-ws-attach,04-reconnect,05-verify-status-timeline}.test.mjs`
- `docs/issue/orchestration-facade/F{1,2}-closure.md`
- `docs/action-plan/orchestration-facade/F{1,2}-*.md`
- `docs/design/orchestration-facade/F0-{stream-relay-mechanism,session-lifecycle-and-reconnect,user-do-schema,contexter-absorption-inventory}.md`
- `docs/plan-orchestration-facade.md`

### 9.4 验证结果

```text
pnpm --filter @haimang/orchestrator-core-worker typecheck  -> PASS
pnpm --filter @haimang/orchestrator-core-worker build      -> PASS
pnpm --filter @haimang/orchestrator-core-worker test       -> PASS (2 files / 11 tests)
pnpm --filter @haimang/agent-core-worker test              -> PASS (96 files / 1033 tests)
pnpm test:package-e2e                                      -> PASS (30 skipped without NANO_AGENT_LIVE_E2E=1; new orchestrator cases parse and register correctly)
```

### 9.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. `/internal/stream` 当前仍是 snapshot-based finite NDJSON relay，不是 persistent live push。
  2. legacy `agent-core /sessions/*` 仍在 F2 结束状态下可用，真正单一化 cutover 仍待 F3 执行。

---

## 10. 对 Opus 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-24`
> 评价依据: `workers/orchestrator-core/src/user-do.ts`, `workers/agent-core/src/host/internal.ts`, `docs/issue/orchestration-facade/F{1,2}-closure.md`, `test/package-e2e/orchestrator-core/*`

### 10.1 一句话评价
Opus 这轮审查证据链最完整、对 closure 与真实代码的错位最敏感，属于“强事实核查 + 强项目态判断”的高质量 review。

### 10.2 优点
1. 很准确地抓到了 **snapshot relay 被文档讲成 live relay**、**dual-ingress 仍存在**、**cross 证据归因错位** 这三处最容易误导下一阶段执行者的真问题。
2. 不只看源码，也核对了 action-plan、closure、live harness、cross tests 的证据归因，审查宽度和上下文利用都很好。

### 10.3 事实确认 - 审核文档中，所有真实存在的问题
1. `/internal/stream` 当前确实是 timeline/status 合成出来的 snapshot NDJSON，不是 persistent live push。
2. F2 closure 与 action-plan 的确把 `pnpm test:cross` 说得过于像 orchestrator canonical 证据。
3. legacy `agent-core /sessions/*` 在 F2 结束时确实仍是活的 additive ingress。
4. verify negative live 断言确实偏弱，缺少 supported-check drift guard。

### 10.4 事实错误 - 审核文档中，所有的事实错误
1. R3 把 internal stream 的 terminal hardcoded `completed` 定性成“应立即修成 cancel/error/completed 真 taxonomy”过重；当前 runtime 并没有稳定暴露足够信号去无歧义恢复 cancel/error，强修会伪造真相。
2. R5 对 TEAM_UUID 风险的时间点判断偏前；当前 `/internal/*` 路径并未在这条 seam 上重新进入 tenant boundary 验证，因此它是未来硬化风险，不是本轮必须改的现时缺陷。

---
以上内容均不局限于只有2个，如果多个请一一列举。
---

### 10.5 评分 - 总体 ** 4.8 / 5** 

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 5 | 代码、tests、closure、action-plan、参考样本都被串起来了。 |
| 判断严谨性 | 5 | 大部分判断都建立在真实代码路径与交付证据上。 |
| 修法建议可执行性 | 4 | 多数建议可执行；terminal taxonomy 那条在当前 runtime truth 下略超前。 |
| 对 action-plan / design 的忠实度 | 5 | 很擅长抓 design/closure 与实现真相的偏移。 |
| 协作友好度 | 5 | 虽然严格，但给出的 follow-up 时机与优先级清楚。 |
