# Z4 Review — Real Clients and First Real Run（Opus 独立审查）

> 审查对象: `Z4 Real Clients and First Real Run`
> 审查时间: `2026-04-25`
> 审查人: `Opus 4.7`（独立完成；不参考 Kimi / DeepSeek 或其他人的报告）
> 审查范围:
> - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md`（含 §9 GPT 工作日志回填）
> - `docs/issue/zero-to-real/Z4-closure.md`
> - `docs/eval/zero-to-real/first-real-run-evidence.md`
> - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md`
> - `docs/design/zero-to-real/ZX-qna.md`（Q1-Q10 owner 已冻结答案）
> - `clients/web/**`、`clients/wechat-miniprogram/**`
> - `workers/agent-core/src/index.ts`、`src/host/internal.ts`、`src/host/internal-policy.ts`、`src/host/do/nano-session-do.ts`、`src/host/runtime-mainline.ts`、`src/host/quota/repository.ts`、`src/llm/gateway.ts`、`src/llm/adapters/workers-ai.ts`、`src/llm/tool-registry.ts`
> - `workers/orchestrator-core/src/index.ts`、`src/auth.ts`、`src/user-do.ts`
> - `workers/orchestrator-auth/src/service.ts`
> - `workers/orchestrator-core/migrations/00{2,3,4,5}-*.sql`
> - `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs`、`test/package-e2e/orchestrator-core/04-reconnect.test.mjs`、`test/shared/orchestrator-auth.mjs`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`Z4 完成的是 "客户端目录骨架 + RPC authority preflight + 真实 LLM mainline live smoke" 三件事；但它声称的 "first real run" / "real-client baseline established" 在两个最关键的合规面（Q10 frozen heartbeat / replay）和一个关键的功能面（Mini Program WeChat 登录 URL 与 server route 对不上）上都不成立。`
- **结论等级**：`changes-requested`
- **本轮最关键的 3 个判断**：
  1. **Q10 owner 冻结答案在两个客户端 + 服务端三处全部未实现**：客户端没有 heartbeat（≤25s）、没有 replay cursor、`session_uuid` 在 follow-up 是带的；orchestrator-core 的 `user-do.ts` WS 附着流程也没有 server-initiated ping。这等于把 Z4 design F2 §301 "WS 断开后 client 通过 replay cursor 补回最近窗口帧" 整个判定方法直接抹掉。
  2. **Mini Program WeChat code-level login 是 dead code**：`clients/wechat-miniprogram/pages/index/index.js:57` POST `/auth/wechat`，但 `workers/orchestrator-core/src/index.ts:106` 注册的路径是 `/auth/wechat/login`。实际真机点击 "WeChat Login" 永远落到 404 / not-found。closure §6 "code-level WeChat login 已接线" 的措辞回避了这个事实——只是 `wx.login()` 在客户端被调过，server 一侧从来没真实接到。
  3. **"first real run evidence" 实际上是一条 cross-e2e 自动化 smoke + 一组 `tsc --noEmit` / `node --check`**；并不是 design 要求的 "真实用户在真实客户端里连续完成登录、交互、回看"。F1 / F2 收口标准里的 "可完成 auth + session start/input/stream/history" 没有任何浏览器 / 微信开发者工具的 manual evidence，evidence pack 也没有 design §270 列出的 `trace_uuid / client_kind / auth_path / transport_baseline / history_ok / reconnect_ok / runtime_ok / open_gaps` 这一组结构化字段。

---

## 1. 审查方法与已核实事实

### 1.1 已确认的正面事实

- **Z3 review carry-over R-W3（agent-core RPC kickoff bypass）已彻底修复**：`workers/agent-core/src/index.ts:184-239` 的 `invokeInternalRpc` 现在调用 `validateInternalRpcMeta(rawMeta, env)`，把 `x-trace-uuid / x-nano-internal-authority / x-nano-internal-binding-secret` 全部 forward 到 `https://session.internal/...`；`workers/agent-core/src/host/do/nano-session-do.ts:499-511` 在判定为 `session.internal` host 时直接调用 `validateInternalAuthority()`，并复用 `bodyJson` 避免二次消费。Z3 留的 defense-in-depth gap 这次在 RPC + HTTP relay + DO fetch 三层都补齐了。
- **Workers AI mainline 真实可达**：`workers/agent-core/src/host/runtime-mainline.ts:121-310` 真正用 `WorkersAiGateway`（第 125 行 `const gateway = new WorkersAiGateway(options.ai)`）在 step-loop 里跑流式调用，并在 `beforeLlmInvoke / afterLlmInvoke` 里以 `provider_key: "workers-ai"` 写 quota usage。
- **system prompt injection 落地**：`runtime-mainline.ts:104-119` 的 `NANO_AGENT_SYSTEM_PROMPT` 在没有 system message 的 turn 自动前置 Cloudflare/V8/fake-bash 心智模型 prompt；`workers/agent-core/test/host/runtime-mainline.test.ts:143-164` 的回归确认 Workers AI payload 首条 message 一定为 system role 且 content 包含 "Cloudflare Workers"。
- **Workers AI tool registry 收敛**：`workers/agent-core/src/llm/tool-registry.ts` 已把 21 条 tool declaration 集中到一个 `LLM_TOOL_DECLARATIONS`，`adapters/workers-ai.ts:76-85` 的 `buildWorkersAiTools()` 只是从 registry 派生；`test/llm/gateway.test.ts:93-103` 的 drift guard 拉了 `bash-core/src/fake-bash/commands.js` 的 `getMinimalCommandDeclarations()` 比 _名字_ 是否对齐，能挡住单边新增 / 删名字。
- **D1 005 migration `provider_key` 已在 schema 和代码两侧落地**：`migrations/005-usage-events-provider-key.sql` 加列 + 索引；`host/quota/repository.ts:191-218` 的 `recordUsage` 把 `provider_key` 显式列入 `INSERT OR IGNORE INTO nano_usage_events`，并用 `EXISTS (SELECT 1 FROM nano_usage_events WHERE usage_event_uuid = ?6)` 做 idempotent guard。
- **runtime tenant deploy-fill 在 agent-core 这一层确实退役**：`workers/agent-core/src/host/do/nano-session-do.ts:602-607` 的 `currentTeamUuid()` 完全去掉了 `env.TEAM_UUID` fallback；`tenantTeamUuid()`（第 706-711 行）只在 `currentTeamUuid()` 为空时回 `"_unknown"` placeholder。Z3 R5 / R15 在 agent-core 一侧的 hard deadline 兑现了。
- **preview synthetic seed owner 已与 team UUID 分离**：`host/quota/repository.ts:30` 的 `PREVIEW_SEED_OWNER_USER_UUID = "00000000-0000-4000-8000-000000000001"`，与任何 team UUID 不会重叠；`ensureTeamSeed()` 必须 `allowSeedMissingTeam === true` 才执行（第 64 行），preview-only escape hatch 的 gate 兑现。
- **真实 Workers AI live smoke 落地**：`test/cross-e2e/12-real-llm-mainline-smoke.test.mjs` 用真实 orchestrator-core public route 启动 session、轮询 timeline 拿 `turn.end`，再用 `npx wrangler d1 execute --remote` 验证同一 `session_uuid` 在 `nano_usage_events` 写入 `resource_kind='llm' / verdict='allow' / provider_key='workers-ai'` 至少一条。这是 zero-to-real 第一次真正端到端的 live capability evidence，含金量高于 §3.1 的 package smoke。

### 1.2 已确认的负面事实

- **Q10 hard rule "WS 必须使用 packages/nacp-session/src/heartbeat.ts 的 heartbeat" 在两个客户端 + orchestrator-core 都没有任何实现**：
  - `clients/web/src/client.ts:77-91` 直接 `new WebSocket(url)`，没有 heartbeat 周期发送，也没有任何 `packages/nacp-session` import。
  - `clients/wechat-miniprogram/utils/nano-client.js:38-52` 直接 `wx.connectSocket({url})`，同样没有 heartbeat。
  - `workers/orchestrator-core/src/user-do.ts:1266-1335` 整段 `handleWsAttach` + `bindSocketLifecycle` 没有任何 `setInterval / setAlarm` 触发的 server-initiated ping，也没有 import 任何 `nacp-session/heartbeat` 模块。
  - 整个仓库唯一处理 `session.heartbeat` 的位置是 `agent-core/src/host/do/nano-session-do.ts:918-919` 的 `lastHeartbeatAt` 戳，但这条路径的客户端是 _别的 worker / test harness_，不是 zero-to-real Z4 真实客户端会进的 user-do WS path。
- **Q10 hard rule "WS 重连必须使用 replay.ts 的 cursor，client 上报 last frame_seq" 在两个客户端 + orchestrator-core 都没有实现**：
  - 客户端没有任何 `last_seen_seq` state、没有 `session.resume` 帧。
  - `user-do.ts:1280-1309` 的 attach 流程只调用一次 `readInternalStream(sessionUuid)` 把当前 timeline frames 一次性 forward，没有任何 cursor 恢复语义，也没有 "client 上报 last seq" 的解析。
  - `test/package-e2e/orchestrator-core/04-reconnect.test.mjs` 现在的 reconnect smoke 只是 "open ws1 → close → open ws2 → close"，没有任何对 frame 顺序 / 不重不漏的 assertion。Q10 §3 "reconnect 后 stream/history 不错位" 的判定方法没有任何 automated cover。
- **Mini Program WeChat 登录路径 mismatch**：
  - 客户端 `clients/wechat-miniprogram/pages/index/index.js:57` POST `/auth/wechat`。
  - 服务端 `workers/orchestrator-core/src/index.ts:106` 注册的是 `POST /auth/wechat/login`。
  - 真机点 "WeChat Login" → 必然 404 / not-found，整条 F2 §269 的 "Mini Program 可完成 WeChat login -> start -> input -> stream -> history" 链路在第一站就断。
- **action-plan 的 "stream/history readback" 在 client 视角并不是真正流**：
  - `agent-core/src/host/internal.ts:107-167` 的 `forwardInternalStream` 注释明确写着 _"First-wave relay is snapshot-based: synthesize a finite NDJSON body from timeline + status reads"_，是把 D1/timeline 一次性合成成 NDJSON。
  - 客户端 WS attach 收到的 frames 来自 `user-do.ts` 一次性 forward 后就没有持续推送（除了下一次 fetch）；`forwardFramesToAttachment` 在 `handleWsAttach` 里只调用了一次。
  - 这意味着 "real client first real run" 在协议层面是 "post-hoc 历史回放"，不是 "agent loop 中实时见到 LLM token / tool call"——Z4 design §270 / §301 期望的 "stream/history" 含义被悄悄替换了。
- **F3 evidence pack 字段缺失**：
  - design §280 / §286 要求 `docs/eval/zero-to-real/evidence/z4-<trace_uuid>.json` 或等价 artifact，含 `trace_uuid / client_kind / auth_path / transport_baseline / history_ok / reconnect_ok / runtime_ok / open_gaps[] / closure_verdict`。
  - 实际产物 `docs/eval/zero-to-real/first-real-run-evidence.md` 是叙事 + Markdown 表格，没有 `trace_uuid` 字段、没有 `reconnect_ok` / `runtime_ok` 这种结构化项。Residual inventory (R1-R4) 写得不错，但其余字段集没有兑现。
- **F4 IntentDispatcher / Broadcaster 状态没有显式 declare**：
  - design §302 判定方法 2 明确要求 "文档明确说明 `IntentDispatcher` / `Broadcaster` 是已实现还是 deferred backlog"。
  - closure 与 evidence 都没有提到这两个名字一次。
- **F5 Residual Transport Inventory 完全缺席**：
  - design §314-§318 要求 inventory 至少包含 `seam 名称、owner、保留原因、风险、候选退役阶段`，并且 "Z4 结束时 internal HTTP seam 数量不高于 Z4 开始时基线"。
  - closure / evidence 都没有这一节。仓库里仍有 `agent-core/src/host/internal.ts` 这一整组 `/internal/sessions/*` HTTP relay（start / input / cancel / status / timeline / verify / stream），它们是不是被 forward 给 RPC、还是仍然是 Z2 RPC scaffold 之外的 fallback，文档没有任何 inventory。
- **`env.TEAM_UUID` deploy-fill 仅在 agent-core 一侧退役，orchestrator-core 端仍保留**：
  - `workers/orchestrator-core/src/auth.ts:207-217`：当 JWT 不带 `team_uuid` claim 时，仍以 `env.TEAM_UUID` 作为 `effectiveTenant` 并把 `tenant_source` 设为 `"deploy-fill"`。
  - `workers/agent-core/src/host/internal-policy.ts:48-52` 的 `normalizeAuthority` 仍然把 `"deploy-fill"` 列为合法 `tenant_source`。
  - 也就是说 closure §6 "runtime tenant truth 不再从 deploy `TEAM_UUID` fallback" 是一句 _"agent-core 那一侧"_ 的局部真，但跨 worker / 跨 stage 看，deploy-fill 语义仍在 control-plane 入口存活。
- **客户端 manual smoke 没有真正发生**：closure §3 第 7 条只跑了 `tsc --noEmit` 与 `node --check`，没有 puppeteer / 浏览器 / 真机演练 evidence，也没有任何 trace_uuid / session_uuid 落到 evidence。F1 §214 "可完成 auth + session start/input/stream/history" 的判定方法只能由 cross-e2e 12 间接覆盖（而那条用的是 _自动化 fetch_，不是 _客户端_）。

---

## 2. 审查发现

### R1. Q10 frozen heartbeat 在三处全部未实现

- **严重级别**：`high`
- **类型**：`scope-drift / delivery-gap`
- **事实依据**：
  - `clients/web/src/client.ts:77-91` 直接 `new WebSocket(url)`，无任何 heartbeat。
  - `clients/wechat-miniprogram/utils/nano-client.js:38-52` 直接 `wx.connectSocket(...)`，无任何 heartbeat。
  - `workers/orchestrator-core/src/user-do.ts:1266-1335` 的 `handleWsAttach + bindSocketLifecycle` 中没有任何 `setInterval / setAlarm` 触发的 server-initiated ping。`alarm()` 第 368-372 行只做 hot state trim、不发 WS ping。
  - Z4 action-plan §172 / Q10 owner 答案明确要求 "server-initiated heartbeat 作为 first-wave 默认，间隔 ≤25s"。
- **为什么重要**：
  - WeChat Mini Program 客户端在 ~30s 静默后会被平台层断开。没有 heartbeat = Mini Program 的真实使用者在 owner 实测中会立刻看到 "几十秒就断" 的体验，gap triage 又得在 Z5 回头补这条 P0 曲线。
  - 这不是 nice-to-have，是 owner 在 Q10 显式拍板的 hard rule，Z4 设计 §301 把它列进了 F2 收口判定方法。
- **审查判断**：
  - "已建立 client baseline" 这句话与 Q10 hard rule 是冲突的。两个 client 都没接入 nacp-session 任何资产，更没满足 ≤25s 心跳。
  - 这是 _baseline 的内核_ 缺失，不是 polish 留尾巴。
- **建议修法**：
  1. orchestrator-core `user-do.ts` 的 attachment lifecycle 加一个 server-initiated ping：`storage.setAlarm(now + 20_000)` 或者 socket scheduled ping，并 import `packages/nacp-session/src/heartbeat.ts`。
  2. 两个 client 收到 ping 后做被动 ack，或者退一步做 client-initiated ping（≤25s）；至少要 import nacp-session 的 heartbeat helper，而不是裸 WebSocket。
  3. 在 `test/package-e2e/orchestrator-core/04-reconnect.test.mjs` 加一条断言："连接保持 ≥30s 无活动也不被 server 主动 close"。

### R2. Q10 frozen replay cursor 在三处全部未实现

- **严重级别**：`high`
- **类型**：`scope-drift / delivery-gap`
- **事实依据**：
  - 两个 client 都没有 `last_seen_seq` 状态、没有 `session.resume` envelope（参考 `packages/nacp-session/src/messages.ts`）。
  - `user-do.ts:1280-1309` 的 attach 只调用一次 `readInternalStream(sessionUuid)`，把当前 timeline 一次性 forward，没有任何 cursor 恢复语义。
  - `test/package-e2e/orchestrator-core/04-reconnect.test.mjs` 仅做 open/close/open/close，没有验证 frame 顺序或不重不漏。
  - Z4 action-plan §172 / design §301 / Q10 owner 答案要求 "reconnect 时 client 上报 last `frame_seq`，server 从该 seq 开始重发；缺帧从 D1 拉"。
- **为什么重要**：
  - replay cursor 是 Z2 hot-state 设计的直接消费者。Q6 owner 答案 §200-§208 把 `recent_frames ≤ 50 / session` 当作 hot-state 的核心容量约束之一，Z2 closure 的判定方法之一就是 "清空 DO storage 后 reconnect 仍能从 D1 恢复 last 50 frames"。Z4 现在让这条 invariant 没有任何客户端去消费——hot-state 在 reconnect 链路上事实上不被 _用_。
- **审查判断**：
  - 这是 cross-stage 协议级断点：Z2 投了资源建 hot-state 与 frame seq，Z4 没把它跨过 client 侧的最后一公里。
- **建议修法**：
  1. client `openStream` 接受 `lastSeenSeq?: number`，在 URL search 或 attach 后第一帧 `session.resume` 里上报。
  2. `user-do.ts:1280` 解析 `last_seen_seq` query / 首帧 resume，仅 forward `frame_seq > last_seen_seq` 的帧；缺口 fallback 到 D1。
  3. 加一条 cross-e2e：start session → 收到 N 帧 → 关 ws → 重连带 `last_seen_seq=k` → 断言只收到 `k+1..N`，并且没有 dup。

### R3. Mini Program WeChat 登录走错路径 → end-to-end dead

- **严重级别**：`high`
- **类型**：`correctness / delivery-gap`
- **事实依据**：
  - `clients/wechat-miniprogram/pages/index/index.js:57` 调 `request(this.data.baseUrl, "/auth/wechat", ...)`。
  - `workers/orchestrator-core/src/index.ts:106` 只识别 `POST /auth/wechat/login`，其它 `/auth/*` 路径通过 `parseAuthRoute` 返回 null → 走 session 路径 → 因为 not UUID 返回 `404 not-found`。
- **为什么重要**：
  - F2 §269 判定方法第 1 条 "Mini Program 可完成 WeChat login -> start -> input -> stream -> history" 在第一站就失败。
  - closure §6 写 "code-level WeChat login 已接线"，但 GPT 的 "接线" 仅是 client 侧调用了 `wx.login()` 取到 `code` 然后 POST 到一个不存在的 URL；server 永远不会进 `wechatLogin` service。这是 _verbatim wired but functionally dead_。
- **审查判断**：
  - 这是一条单字符级 bug；但它直接拆掉了 Z4 design 的 F2 全部判定方法。
- **建议修法**：
  - 把 `pages/index/index.js:57` 的 `"/auth/wechat"` 改为 `"/auth/wechat/login"`；同时在 `test/package-e2e/orchestrator-auth/` 或 cross-e2e 加一条 "WeChat login route 200 + token returned" smoke（即使是 mock OAuth code，也至少 server route 不能 404）。

### R4. "stream" 仅是一次性 NDJSON snapshot，不是真正的实时流

- **严重级别**：`high`
- **类型**：`scope-drift / docs-gap`
- **事实依据**：
  - `agent-core/src/host/internal.ts:107-167` 注释明写 _"First-wave relay is snapshot-based: synthesize a finite NDJSON body from timeline + status reads"_。
  - `user-do.ts:1280-1309` 在 attach 时调一次 `readInternalStream` 把 frames 一次性 forward，并发于 close handler 之外没有持续 push。
  - Z4 design §13 / §270 / §301 反复说 "stream/history" 是 Q10 的 baseline；但 design 没有声明 "stream 实际上 = 1 次 snapshot"。
- **为什么重要**：
  - 真实用户在客户端期望的 "first real run" = 看到 LLM token 边出边显示、tool call 实时可见。当前形态下 client 不会拿到 inflight LLM delta，只能在 `turn.end` 之后再 timeline poll。
  - closure §5 R3 "orchestrator durable timeline 当前不保留 `llm.delta`" 正面承认了这一点，但只是把它列为 residual `[follow-up]`；却没承认 Q10 baseline 的 "WS stream" 在协议上已经被悄悄替换成 "WS one-shot history"。
- **审查判断**：
  - 这不是 "性能不够好"，是 "Z4 真正交付的 transport 与 design 用同一个名词描述两件不同事物"。需要 owner 看到这种漂移并明确选边——要么承认 first-wave stream 就是 snapshot（更新 design 用语），要么真正接通持续 push（接 user-do alarm + WebSocket push）。
- **建议修法**：
  - 短期：在 closure §5 / evidence 显式承认 "WS stream = one-shot timeline snapshot in first wave；client live token streaming 留到下一阶段"。
  - 中期（Z5 之前更好）：在 `forwardFramesToAttachment` 之后保留一个持续 push channel，允许 agent-core 在产生新 frame 时 push 给 attached socket（最小做法是 user-do alarm 周期 poll timeline diff 推到 socket）。

### R5. F3 evidence pack 字段集没有兑现

- **严重级别**：`medium`
- **类型**：`docs-gap / delivery-gap`
- **事实依据**：
  - design §270 / §286 要求 evidence 至少有 `trace_uuid / client_kind / auth_path / transport_baseline / history_ok / reconnect_ok / runtime_ok / open_gaps[] / closure_verdict`。
  - 实际 `docs/eval/zero-to-real/first-real-run-evidence.md` 只有叙事 + 步骤表 + residual inventory，没有 `trace_uuid` / `client_kind` / `reconnect_ok`。
- **为什么重要**：
  - design 显式说 "不允许把明显 blocker 只写成 narrative note 而不入 evidence/backlog"——当前形态正是 narrative。
  - 没有 trace_uuid 落到 evidence，事后 owner 想 "我那次 run 出了什么 quota event" 没有锚点可以查 D1。
- **审查判断**：
  - residual inventory 已经做对了（4 项 + 标签 + 推荐归属），但前置 fields 集合缺失，evidence pack 可复核性低。
- **建议修法**：
  - 在 `docs/eval/zero-to-real/first-real-run-evidence.md` 顶部加一组结构化字段（YAML / Markdown 表都可），把 12 cross-e2e smoke 跑出的 `trace_uuid / session_uuid` 落进去。Web / Mini Program 真机 run 等到能跑通后再追加同样字段集。

### R6. F4 IntentDispatcher / Broadcaster 状态没有声明

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - design §302 判定方法 2 明确要求 "文档明确说明 `IntentDispatcher` / `Broadcaster` 是已实现还是 deferred backlog"。
  - `Z4-closure.md` / `first-real-run-evidence.md` / action-plan §9 GPT 回填 都没出现这两个名字。
  - 仓库 grep 显示 charter 里讲过 "IntentDispatcher 指 agent.core 内的 user-input routing seam，Broadcaster 指 orchestration.core user DO 内的多端 fanout seam"，但 source 里没有同名 module。
- **为什么重要**：
  - Z5 / 下一阶段 owner 要决定 "这两个 seam 是否进 next-wave"。当前它们处于 _未声明 deferred_ 的悬空状态，等于把 charter 里的 backlog 又压了一层。
- **审查判断**：
  - 这是文档级 deliverable 缺失，不影响 runtime，但会影响下一阶段的 scope inheritance。
- **建议修法**：
  - 在 closure §5 residuals 里追加一条 "IntentDispatcher / Broadcaster 当前未实现，归 deferred-next-phase；F4 的 stateful primitive 只到 frame/heartbeat/replay 三件套（且后两件未真实接入 client，见 R1/R2）"。

### R7. F5 Residual Transport Inventory 整节缺失

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - design §314-§318 要求 inventory 含 `seam 名称、owner、保留原因、风险、候选退役阶段`，并且 "internal HTTP seam 数量不高于 Z4 开始时基线"。
  - closure / evidence 没有这一节。
  - 实际仓库仍存在 `workers/agent-core/src/host/internal.ts` 整组 `/internal/sessions/*` HTTP relay（`start / input / cancel / status / timeline / verify / stream`）。它们 与 `index.ts:184 invokeInternalRpc` 的 RPC kickoff 并存，没有 inventory 说明谁是主路径、谁是 fallback。
- **为什么重要**：
  - charter §7.5 把 transport 退役视为 zero-to-real 的 "诚实承认 vs 假装清洁" 的关键证据。F5 的目的就是把 "依然存在" 写出来。当前没有，等于 Z4 在收口时把 transport 的债务又隐藏了一次。
- **审查判断**：
  - 这一节即便只是 `seam 列表 + owner + retire 期望` 的 5 列表也已经足够，工作量小，但缺失代价大。
- **建议修法**：
  - closure 加一节 §6 "Residual transport inventory"：
    | seam | owner | 保留原因 | 风险 | 候选退役阶段 |
    | --- | --- | --- | --- | --- |
    | `agent-core /internal/sessions/{start,input,...}` HTTP relay | agent-core | RPC kickoff 仅 cover `status/start`，其它 5 条仍以 HTTP forward 为入口 | 单租户 binding-secret 失效会绕过 DO authority | Z5 / control-plane RPC 收尾 |
    | `agent-core /internal/sessions/stream` snapshot NDJSON | agent-core | 持续 push channel 未实现，借 NDJSON 替代 | client 视角无 inflight stream（见 R4） | next phase / stream-plane |

### R8. orchestrator-core 端 `env.TEAM_UUID` deploy-fill 未退役（cross-stage）

- **严重级别**：`medium`
- **类型**：`scope-drift / correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/auth.ts:207-217` 仍把 `env.TEAM_UUID` 当 `deployTenant`，并在缺 `team_uuid` claim 时把 `tenant_source` 设为 `"deploy-fill"`。
  - `workers/agent-core/src/host/internal-policy.ts:13 / 48-52` 仍把 `tenant_source` 的合法集合定义为 `"claim" | "deploy-fill"`。
  - closure §6 / GPT 工作日志声称 "runtime tenant truth 不再从 deploy `TEAM_UUID` fallback"，但严格说仅限 agent-core 这一层。
- **为什么重要**：
  - 这是 Z3 review 的 R5 / R15 已经标过的 hard deadline，Z4 的 closure 把它说成 "已收"，但事实是只在 `agent-core` 一侧收。控制面入口（orchestrator-core）仍然给 `tenant_source: "deploy-fill"` 留路径——在 multi-tenant 上线前是潜在租户混淆面。
- **审查判断**：
  - closure 措辞需要诚实。如果只想退役 runtime 一侧，应明写 "agent-core runtime tenant truth 不再 fallback；orchestrator-core 入口的 deploy-fill 路径仍保留为 single-tenant deploy posture，待 multi-tenant onboarding 阶段一并退役"。
- **建议修法**：
  1. 短期：closure 修措辞，把这条 retirement 的 scope 写实。
  2. 中期：把 `auth.ts:215-217` 的 deploy-fill 分支改为：当 JWT 缺 `team_uuid` claim 时直接 `return jsonPolicyError(403, "missing-team-claim", ...)`，并把 `internal-policy.ts:13 / 50-52` 的 `"deploy-fill"` 选项一并删掉。

### R9. 客户端 manual smoke 未实际发生（"first real run" 名实不符）

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - closure §3 / evidence §3 步骤 7 只列了 `tsc --noEmit` 与 `node --check`。
  - design §0 / §35 把 "first real run" 定义为 "真实用户在真实客户端里连续完成登录、交互、回看"。
  - 没有任何 `session_uuid / trace_uuid` 来自浏览器或微信开发者工具的真机 evidence。
- **为什么重要**：
  - 全 Z4 的 _"real"_ 在事实层面只有 `12-real-llm-mainline-smoke.test.mjs` 一条，那是一条 _自动化 fetch_，不是 _client_。把它当成 "real-client baseline established" 是把 cross-e2e 的 evidence 当客户端 evidence 用。
- **审查判断**：
  - Z4 真正成立的是 "preview Workers AI mainline 真实 + RPC authority preflight 真实 + clients 目录真实 _存在_"；但 "real client _used_" 不真实。
- **建议修法**：
  - 至少在 evidence 加一条 manual run 记录：浏览器开 `clients/web` → register → start → 看到 timeline / WS open / WS close 事件 → 截屏（或贴 console log）→ 落 `trace_uuid / session_uuid`。Mini Program 同理（哪怕是开发者工具仿真器）。
  - 如果 owner 接受 "Z4 不要求 manual real-user run"，那 closure 必须改写成 "real-client _scaffolding_ baseline established"，不要继续用 "real-client baseline established"。

### R10. tool-registry 仅靠 _名字_ 防漂移，schema/description 仍可独立漂移

- **严重级别**：`low`
- **类型**：`correctness / test-gap`
- **事实依据**：
  - `workers/agent-core/src/llm/tool-registry.ts` 自维护一份 21 条 declaration（含 description / inputSchema），与 `workers/bash-core/src/fake-bash/commands.ts` 的 minimal registry 是 _两个数据源_。
  - `workers/agent-core/test/llm/gateway.test.ts:93-103` 的 drift guard 只比对 `decl.name` 集合是否相等，对 description / inputSchema 完全不验。
- **为什么重要**：
  - 如果未来 bash-core 把 `cat` 的 schema 加了 `start_line` 参数，agent-core 这边的 `cat: { path: string }` 会继续上报，LLM 不知道有 `start_line`，capability layer 接到不完整 args 行为不可预测。
  - Z3 R10 / Z4 close 都把 "Workers AI 与 bash-core minimal registry 对齐" 当成 hard deadline 之一，"对齐" 仅做 name layer 是名义上完成。
- **审查判断**：
  - 不属于 blocker，但 Z5 之前应当把 source-of-truth 收敛回单一 registry（要么 agent-core import bash-core 的 minimal registry，要么 bash-core import agent-core 的 LLM_TOOL_DECLARATIONS）。
- **建议修法**：
  - `tool-registry.ts` 改为从 `@haimang/bash-core-worker` 的 `getMinimalCommandDeclarations()` 派生：把现有 description / inputSchema 移进 bash-core 的 minimal registry（如果未在），让 agent-core 不再独立维护。

### R11. Web client baseUrl 默认值硬编码到 preview deploy

- **严重级别**：`low`
- **类型**：`docs-gap / scope-drift`
- **事实依据**：
  - `clients/web/src/main.ts:4` 写死 `DEFAULT_BASE_URL = "https://nano-agent-orchestrator-core-preview.haimang.workers.dev"`。
  - localStorage 可覆盖，但首次进入 dev 默认 hit preview。
- **为什么重要**：
  - 客户端是 owner 期望放心 demo 的入口；硬编码生产 / preview URL 在分享时会暴露 deploy URL，并且让 dev 路径不直观。
  - Z4 实施纪律 §80 "客户端栈基线 Vite + Vanilla TypeScript" 没说要 hardcode preview，design §246 "thin client / test harness" 反而要求 stable validation face。
- **审查判断**：
  - 是品味问题，但属于 client baseline 被合理 review 时会被勾出来的小条目。
- **建议修法**：
  - 改为读取 `import.meta.env.VITE_NANO_BASE_URL ?? "http://localhost:8787"`，并在 `clients/web/README.md`（如果有的话）说明。

### R12. 客户端没有 import `packages/nacp-session`，与 Q10 owner 决议直接抵触

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - Q10 owner 答案 §322-§325 三条点名要求消费 `packages/nacp-session/src/heartbeat.ts / replay.ts / messages.ts`。
  - `clients/web/package.json` 与 `clients/wechat-miniprogram/utils/nano-client.js` 都没有任何 `nacp-session` 依赖或 import。
- **为什么重要**：
  - Q10 把 "首版 Mini Program transport baseline" 与 "复用既有 nacp-session 资产" 绑定为一件事，目的就是不要 client 侧重新发明轮子。当前两个 client 全部是 "重新发明轮子"——不光是不消费 nacp-session，还把每个 envelope 的 shape 重新拼了一遍。
- **审查判断**：
  - 这是 Q10 frozen freeze register 的 spec drift。R1/R2 是它的具体后果；这条记到 protocol 级别更醒目。
- **建议修法**：
  - 让 `clients/web/package.json` 加 `@haimang/nacp-session` workspace 依赖，import `heartbeat / replay / messages` 三个 helper；Mini Program 则把这三个 helper 的纯 JS 等价物拷过去（小程序不能 npm import workspace package，但可以 build-time 注入）。

### R13. closure §3 "live LLM mainline smoke 1/1 pass" 没有把 trace 锚点写出来

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `Z4-closure.md` §3 直接给一段 shell 列表 + Result，但没有具体 `session_uuid` / `trace_uuid` / `usage_event_uuid`。
  - `evidence.md` §3 步骤 4 同样写 "1/1 pass" 但没落锚点。
- **为什么重要**：
  - "live evidence" 之所以比 in-repo smoke 高一档，就是因为 D1 行的存在。如果 closure 不把那条 row 的 idempotency key（或 session_uuid）写出来，未来回看时无法跨 stage 关联。
- **审查判断**：
  - 不影响功能正确性，但损害审计链。
- **建议修法**：
  - 在 evidence §3 行 4 后追加 "live run anchors: session_uuid=<...>, idempotency_key=`llm:allow:llm-turn-...`"，复制一条 `nano_usage_events` 行的关键字段。

### R14. `ensureBalance` 路径在 preview 之外仍隐式触发 `ensureTeamSeed` 短路

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `workers/agent-core/src/host/quota/repository.ts:89-95` `ensureBalance` 在第一行就 `await this.ensureTeamSeed(teamUuid)`。
  - `ensureTeamSeed` 第 64 行 `if (!this.options.allowSeedMissingTeam) return;` —— 在生产模式确实直接返回。
  - 但是它的存在意味着每条 quota 记录路径都额外调用一次方法（即使是 no-op）；并且代码逻辑上 `ensureBalance` _总是_ 接受 missing team 的可能性，依赖外部 team seed 完整性。
- **为什么重要**：
  - 不是 hot bug，但 in production 当 `allowSeedMissingTeam=false` 时，如果 team row 缺失，`INSERT OR IGNORE INTO nano_quota_balances` 因 `nano_quota_balances.team_uuid` FK 约束失败会抛 D1 错误而非 typed reject——可能让真实 quota 调用以一个不必要的 5xx 表现出来。
  - Z3 review R5 当时就指出 synthetic seed 的形态需要被收紧，Z4 完成了 owner UUID 分离，但没补这层 typed reject。
- **审查判断**：
  - 留尾巴可控，但 Z5 production hardening 之前应该补一条 "team row missing → typed `tenant-not-onboarded` reject"。
- **建议修法**：
  - 在 `ensureBalance` 之前加一条 read-only check：`SELECT 1 FROM nano_teams WHERE team_uuid=?1 LIMIT 1`；不存在且不在 preview seed mode 时，throw typed `QuotaTeamMissingError` 让 authorizer 把 deny 写到 trace 而不是 5xx。

### R15. 缺失 typed error envelope 客户端展示策略

- **严重级别**：`low`
- **类型**：`scope-drift`
- **事实依据**：
  - Z4 action-plan P3-02 "error/quota disclosure hardening" 要求 "校正客户端对 auth/quota/runtime/tool failures 的呈现与重试策略"。
  - 实际 `client.ts:113-119` 与 `nano-client.js:14-27` 的 error 处理就是 `throw new Error(body.message ?? \`HTTP ${status}\`)`——没有针对 `code='QUOTA_EXCEEDED' / 'invalid-internal-auth'` 等 typed error 做差异化呈现，也没有重试策略。
- **为什么重要**：
  - Q9 owner 答案 §296 明确要求 "user-visible stream 抛 typed error code='QUOTA_EXCEEDED'，不允许静默吞掉"；当前 client 把 typed error 全部展平成字符串，事实上还是吞掉了 typed semantics。
- **审查判断**：
  - first-wave thin client 不要求 polished UI，但至少要把 typed `code` 写到 event log 让 owner 巡检时能识别。
- **建议修法**：
  - `client.ts` / `nano-client.js` 在 catch 时把 `body.error?.code` / `body.error?.quota_kind / remaining` 一并保留到 log entry，而不是仅 message。

---

## 3. In-Scope 逐项对齐审核

### 3.1 Action-plan §2.1 In-Scope（S1-S4）

| 编号 | 计划项 | 审查结论 | 说明 |
|------|---------|----------|------|
| S1 | 新建 `clients/web/`，完成 register/login/session start/input/stream/history baseline | `partial` | 目录与 transport helper 已建；register/login/start/input/timeline 真实可发送；但 "stream" 在协议层只是 1 次 NDJSON snapshot（R4），且 manual smoke 未真正执行（R9）。 |
| S2 | 新建 `clients/wechat-miniprogram/`，完成 WeChat auth 与 session baseline | `missing` | 目录已建；email/password 路径在客户端可用；**WeChat code-level login 因 URL 走错（R3）实际不可用**。"WeChat auth baseline" 不成立。 |
| S3 | 用真实客户端验证 heartbeat、replay cursor、history readback、quota/error disclosure | `missing` | heartbeat（R1）、replay cursor（R2）在三层全部未实现；history readback 仅是 attach 后的一次性 snapshot（R4）；quota/error disclosure 客户端展示也没做差异化（R15）。本条作为 Z4 真实价值最大的一项，没有兑现。 |
| S4 | 做第一次 end-to-end 真实运行并沉淀 evidence / residual inventory | `partial` | live LLM smoke 自动化跑通是真实的；但 "client real run" 没发生；evidence pack 缺 `trace_uuid / client_kind / reconnect_ok` 等 design 要求字段（R5）；residual inventory 已写但漏 IntentDispatcher/Broadcaster 与 transport inventory（R6/R7）。 |

### 3.2 Design §7.1 F1-F5 收口判定方法

| 编号 | 设计项 | 审查结论 | 说明 |
|------|---------|----------|------|
| F1 | Web Hardening：连续完成 login → start → followup → stream → history → reconnect | `partial` | static check 通过；no real browser run；reconnect 没有 cursor。 |
| F2 | Mini Program：完成 WeChat login → start → input → stream → history；replay cursor 重连不丢帧 | `missing` | WeChat login URL 错（R3）；replay 不存在（R2）。两条判定方法都不成立。 |
| F3 | Gap Triage：每次关键 run 落 `evidence/z4-<trace_uuid>.json` 或等价 artifact | `partial` | residual inventory 写得好；evidence 字段集没兑现（R5）。 |
| F4 | Delayed Stateful Work：heartbeat / replay / IntentDispatcher / Broadcaster 状态明确 | `missing` | heartbeat / replay 未真实接客户端；IntentDispatcher / Broadcaster 在文档里没出现一次（R6）。 |
| F5 | Residual Transport Inventory：seam 名 / owner / 保留原因 / 风险 / 退役阶段 | `missing` | 整节缺失（R7）。 |

### 3.3 对齐结论

- **done**: 0
- **partial**: 4（S1 / S4 / F1 / F3）
- **missing**: 5（S2 / S3 / F2 / F4 / F5）
- **out-of-scope-by-design**: 0

> 这更像 "scaffolding has landed; first-wave protocol layer is ⅓ implemented"，而不是 "real-client baseline established"。两个 hard freeze（Q10 heartbeat、Q10 replay）以及一条 hard delivery（WeChat login URL）都没收住，三件加在一起足以判定 _本轮 review 不收口_。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 完整产品化 UI/设计系统 | `遵守` | client 极简，没有 design system / state lib。 |
| O2 | 多端同步、离线缓存、复杂消息渲染组件库 | `遵守` | 没有引入。 |
| O3 | 完整运营后台 / 计费中心 / 管理台 | `遵守` | 无相关产物。 |
| O4 | 客户端 SDK 产品化发布 | `遵守` | clients/* 都是 private workspace，没有发布配置。 |

---

## 5. 跨阶段 Z0-Z4 复盘

### 5.1 不变量矩阵（design / Q&A 冻结的硬约束 vs 实际代码）

| 不变量 | 来源 | Z0 | Z1 | Z2 | Z3 | Z4 | 当前状态 |
|--------|------|----|----|----|----|----|----------|
| `orchestrator.auth = internal-only + WorkerEntrypoint RPC-first` | Q1 / charter | n/a | ✅ | ✅ | ✅ | ✅ | 兑现：`orchestrator-auth/src/index.ts` 是 `WorkerEntrypoint`；`orchestrator-core/src/index.ts:148-161` 通过 RPC 调用 |
| `JWT HS256 + kid keyring + access 1h / refresh 30d` | Q2 | n/a | ✅ | ✅ | ✅ | ✅ | `test/shared/orchestrator-auth.mjs:9-13` 的 `JWT_KID` keyring 一致 |
| `WeChat 首登自动建 user + default team + owner-level membership` | Q3 | n/a | ✅ | ✅ | ✅ | ⚠️ | `wechatLogin` 服务端真的会 `createBootstrapUser`；但 client URL 走错（R3），整条 "WeChat 首登" 在 Z4 仍未真机走通 |
| `API key verify schema 预留 + impl defer` | Q4 | n/a | ✅ | ✅ | ✅ | ✅ | `verifyApiKey` 返回 `reserved-for-future-phase`；schema 已预留 |
| `nano_session_activity_logs 单 append-only + 12 列 + 强制 index + redaction` | Q5 | n/a | n/a | ✅ | ✅ | ✅ | `migrations/002` schema 含 `actor_user_uuid / event_seq / severity / payload`；`view_recent_audit_per_team` 在 003 |
| `DO hot-state ≤200/≤50/TTL≤5m + 10min Alarm + 重建测试` | Q6 | n/a | n/a | ✅ | ✅ | ⚠️ | `user-do.ts:707 setAlarm + HOT_STATE_ALARM_MS` 有；但 Z4 的 client 没消费 hot-state 的 frame seq cursor（R2），让 hot-state 在 reconnect 链路上事实上不被 _用_ |
| `start dual-impl + golden parity test` | Q7 | n/a | n/a | ✅ | ✅ | ✅ | Z2 在 `agent-core/test/host` 下完成；Z4 的 `12-real-llm-mainline-smoke` 走真实 RPC kickoff 路径 |
| `Workers AI required + DeepSeek skeleton-only` | Q8 | n/a | n/a | n/a | ✅ | ✅ | `runtime-mainline.ts` 用 WorkersAiGateway；`adapters/deepseek/index.ts` skeleton-only |
| `Quota = LLM gate + tool gate；deny → activity log + typed error` | Q9 | n/a | n/a | n/a | ✅ | ⚠️ | server 端有 `beforeLlmInvoke / afterLlmInvoke + buildToolQuotaAuthorization`；但 Z4 client 把 typed error 展平为 string（R15），user-visible 一侧没兑现 |
| `Mini Program WS = HTTP in + WS out + heartbeat ≤25s + replay cursor + session_uuid 必带` | Q10 | n/a | n/a | n/a | n/a | ❌ | 客户端没接 heartbeat（R1）/replay（R2）；server 也没 server-initiated ping。`session_uuid` 在 follow-up 是带的 |
| `single agent-core write to nano_session_activity_logs / 不绕 façade` | Z3 review R6 | n/a | n/a | ✅ | ✅ | ✅ | Z3 已经把 `agent-core` 写 activity log 移除，Z4 没有反向重新引入 |
| `tenant_source = "claim" only（deploy-fill 退役）` | Z3 review R5/R15 + Z4 hard deadline | n/a | n/a | n/a | ⚠️ | ⚠️ | 仅 agent-core 一侧退役（`internal-policy.normalizeAuthority` 仍允许 `"deploy-fill"`，`orchestrator-core/src/auth.ts` 仍写 `tenant_source: "deploy-fill"` 见 R8）|
| `RPC kickoff defense-in-depth: validateInternalAuthority at DO fetch` | Z3 review W-3 | n/a | n/a | n/a | ⚠️ | ✅ | Z4 preflight 完整修复（agent-core/src/index.ts:222-228 + nano-session-do.ts:499-511）|
| `provider_key in nano_usage_events` | Z3 review R3 | n/a | n/a | n/a | ✅ | ✅ | `005-usage-events-provider-key.sql` apply remote evidence 已落 |

> 矩阵读法：✅ 兑现 / ⚠️ 部分兑现 / ❌ 未兑现 / n/a 不属于该阶段。
>
> 总观感：Z0-Z3 的 invariant 在 Z4 完成后被维持（≅ 没有反向倒退）；但 **Z4 自身引入的 Q10 invariant 直接掉链**——Q10 是 owner 在 zero-to-real 唯一一条 client transport 级 freeze，Z4 是它的唯一执行阶段，结果三处全部未实现。

### 5.2 命名规范一致性

| 项 | 一致 | 备注 |
|----|------|------|
| `team_uuid` 始终用 hyphenated UUID 字符串 | ✅ | 没有发现 underscore 形态 |
| `trace_uuid / x-trace-uuid` 头与 body 字段一致 | ✅ | `internal-policy.ts:241` 校验 body `trace_uuid` 与 `x-trace-uuid` 不冲突 |
| `provider_key` 全仓库统一为 `"workers-ai"` | ✅ | gateway / runtime-mainline / repository / live smoke 全部一致 |
| `tenant_source: "claim" \| "deploy-fill"` enum 全仓库一致 | ✅ | 跨 worker 一致；问题在于 enum _本身_ 还允许 deploy-fill（R8）|
| `nano_*` 表前缀 & D1 binding `NANO_AGENT_DB` | ✅ | migrations 与 wrangler 一致 |
| client 侧 envelope 字段（`tokens.access_token / team.team_uuid`）与 auth service 一致 | ✅ | `client.ts:31-44` / `service.ts:89-103` 字段对得上 |
| client 侧 `/auth/wechat` URL 与 server `/auth/wechat/login` 不一致 | ❌ | R3，唯一一条命名级 fact error |

### 5.3 跨包执行逻辑断点

1. **Z2 hot-state ↔ Z4 client cursor**：Z2 投了 hot-state 与 frame seq，Z4 没有 client 侧消费者（R2），等于 Z2 的 deliverable 在 product 路径上 _名义保留 + 实际 dead_。
2. **Z2 stream-plane RPC scaffold ↔ Z4 stream**：Z2 closure 把 stream 定义为 dual-impl 的一部分；Z4 把 stream 实际形态降到 1 次 NDJSON snapshot（R4）。这是 design 用语和实现意图之间的语义跑偏，需要在 closure 显式承认。
3. **Z3 quota typed error ↔ Z4 client display**：Z3 的 quota authorizer 把 deny 写进 trace + typed envelope（Q9 frozen），Z4 client 把 typed payload 直接 `.message ?? HTTP <status>` 成字符串（R15），让 typed semantic 在最后一公里被吞掉。
4. **orchestrator-core deploy-fill ↔ agent-core deploy-fill 退役不同步**：R8。
5. **Z4 preflight 完整修复 W-3 RPC bypass**：这是反方向的好例子——Z3 review 标 W-3 medium，Z4 在 preflight 阶段三层（RPC / HTTP relay / DO fetch）一次性补齐，跨阶段 follow-through 兑现。

### 5.4 跨阶段事实级与文档级错误

| 类型 | 项 | 严重度 |
|------|------|--------|
| 事实错误 | closure §6 "code-level WeChat login 已接线" → URL mismatch（R3）| high |
| 事实错误 | closure §3 / GPT 工作日志 "已具备 ... heartbeat、replay cursor" 隐含说法 → Q10 未实现（R1/R2）| high |
| 文档级遗漏 | F4 IntentDispatcher / Broadcaster 状态未声明（R6）| medium |
| 文档级遗漏 | F5 Residual Transport Inventory 整节缺席（R7）| medium |
| 文档级遗漏 | F3 evidence 字段集（R5）| medium |
| 文档措辞跑偏 | "runtime tenant deploy-fill 退役" 被写成全系统而非仅 agent-core（R8）| medium |
| 文档措辞跑偏 | "stream/history" 与一次性 snapshot 同名（R4）| high |
| 命名错误 | `clients/web/package.json:2` 用 `@nano-agent/client-web`，而 NACP publish scope 在 W2 已对齐为 `@haimang/*`（参见 user memory）| low（client 是 private 不会发布，但与全仓 namespace 收敛不一致）|

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**（按建议优先级）：
  1. **R3 修复 Mini Program WeChat 登录 URL**：把 `/auth/wechat` → `/auth/wechat/login`，加一条 server route smoke（即便 mock OAuth code）。
  2. **R1 + R12 接通 server-initiated heartbeat**：在 `orchestrator-core/src/user-do.ts` 加 server 主动 ping（≤25s）；client 至少 import `packages/nacp-session/src/heartbeat.ts` 或在 Mini Program 端拷一份等价 helper；并在 `04-reconnect.test.mjs` 加 "30s idle 不被 server close" 断言。
  3. **R2 接通 replay cursor**：client 在 attach query 或首帧 `session.resume` 报 `last_seen_seq`；server 仅 forward `> last_seen_seq` 的帧；加一条 cross-e2e "重连不重不漏"。
  4. **R4 文档/语义校准**：在 closure / evidence 显式承认 "first-wave WS stream = one-shot timeline snapshot；持续 push 留下一阶段"。如果 owner 想真接通持续 push，把它升为 hard deadline 并在 user-do 加 push channel。
  5. **R5 evidence 字段集补齐**：至少补 `trace_uuid / client_kind / auth_path / transport_baseline / runtime_ok / open_gaps[]` 这 6 个 design 列出的字段。
  6. **R8 closure 文字校准 + 跨 worker deploy-fill 退役 plan**：closure 改为 "agent-core 一侧退役"；并把 `orchestrator-core/src/auth.ts:215-217` + `agent-core/src/host/internal-policy.ts:48-52` 的 deploy-fill 分支退役放进下一阶段 hard deadline。
- **可以后续跟进的 non-blocking follow-up**：
  1. **R6 / R7** F4 / F5 的两节文档补齐（IntentDispatcher / Broadcaster + transport inventory），不阻塞 close 但 Z5 之前必须有。
  2. **R9** 跑一次真实 manual run 落 trace 锚点；如不打算跑，把 closure 措辞由 "real-client baseline established" 改为 "real-client _scaffolding_ baseline established"。
  3. **R10** tool registry single-source-of-truth 收敛回 bash-core minimal registry。
  4. **R11** web client baseUrl 改为 env-driven。
  5. **R13** evidence / closure 把 live smoke 的 `session_uuid / idempotency_key` 落锚点。
  6. **R14** quota repository 加 typed `tenant-not-onboarded` reject。
  7. **R15** client typed error 展现，至少把 `code / quota_kind / remaining` 保留到 event log。

> **本轮 review 不收口，等待实现者按 §6 响应并再次更新代码 + 文档。**
>
> 等三条 Q10 + 一条 WeChat URL + 一条文档校准全部到位后，本审查会再做一次二轮复核，给 Z4 closed 与 Z5 entry 的双信号。在此之前，Z4 应被理解为 "客户端目录与 RPC preflight 已落，但 Q10 transport baseline 尚未真实成立"——如果 owner 决定接受 "Z4 部分关闭，Q10 transport 留到 Z5 一并收"，必须在 closure 显式重新签字（不再继续以 "real-client baseline established" 表达）。

---

### 6.1 对本轮审查的回应

> 执行者: `GPT-5.5 / GitHub Copilot CLI`
> 执行时间: `2026-04-25`
> 回应范围: `Opus R1-R15 + Kimi / DeepSeek overlap findings`

- **总体回应**：已逐项核查三份 Z4 review；真实存在的 blocker/high 问题已修复，文档过度表述已收紧，仍不伪造 manual client evidence 或 token-level live streaming。
- **本轮修改策略**：优先修会导致真实路径断裂或 owner Q10 baseline 不成立的问题（heartbeat/replay/WeChat URL/deploy-fill/typed error/evidence anchor），对结构性但非 Z4 blocker 的事项明确 deferred；对 stale finding 明确 rejected。

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | Q10 heartbeat 在客户端与 orchestrator WS attach 缺失 | `fixed` | `orchestrator-core` WS attachment 增加 15s server heartbeat；Web / Mini Program client 增加 client heartbeat wire message。 | `workers/orchestrator-core/src/user-do.ts`, `clients/web/src/client.ts`, `clients/wechat-miniprogram/utils/nano-client.js` |
| R2 | Q10 replay cursor / last_seen_seq 缺失 | `fixed` | Client 维护 `lastSeenSeq` 并在 WS URL + `session.resume` 上报；server 解析 `last_seen_seq` 并按 client cursor replay `seq > cursor`；新增 user-do regression。 | `clients/web/src/client.ts`, `clients/web/src/main.ts`, `clients/wechat-miniprogram/utils/nano-client.js`, `clients/wechat-miniprogram/pages/index/index.js`, `workers/orchestrator-core/src/user-do.ts`, `workers/orchestrator-core/test/user-do.test.ts` |
| R3 | Mini Program WeChat login URL `/auth/wechat` 与 server `/auth/wechat/login` 不一致 | `fixed` | 小程序端改为 POST `/auth/wechat/login`。 | `clients/wechat-miniprogram/pages/index/index.js` |
| R4 | client WS stream 实际是一次性 NDJSON/timeline snapshot，不是持续 token stream | `deferred` | 不在本轮冒进实现 stream-plane；closure / evidence 显式改写为 first-wave one-shot timeline snapshot，token-level live push 留给 stream-plane hardening。 | `docs/eval/zero-to-real/first-real-run-evidence.md`, `docs/issue/zero-to-real/Z4-closure.md` |
| R5 | F3 evidence pack 缺结构化字段 / artifact | `fixed` | 新增 per-run JSON artifact，补 `trace_uuid/session_uuid/client_kind/auth_path/transport/runtime/history/open_gaps/usage_event_uuid` 等字段，并在 evidence 主文档链接。 | `docs/eval/zero-to-real/evidence/z4-254c1dc7-c595-4e14-97cd-7435b008d33c.json`, `docs/eval/zero-to-real/first-real-run-evidence.md`, `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs` |
| R6 | IntentDispatcher / Broadcaster 状态未声明 | `fixed-docs` | closure Residuals 明确两者当前未实现，状态为 `deferred-next-phase`。 | `docs/issue/zero-to-real/Z4-closure.md` |
| R7 | Residual transport inventory 缺失 | `fixed-docs` | closure 新增 residual transport inventory，列出 guarded internal HTTP relay、snapshot stream、WS query token compatibility、client helper shim 等 seam。 | `docs/issue/zero-to-real/Z4-closure.md` |
| R8 | `orchestrator-core` auth 仍从 `TEAM_UUID` deploy-fill missing tenant claim | `fixed` | public auth 改为缺 `team_uuid/tenant_uuid` 直接 403 `missing-team-claim`；测试改为锁定 no deploy-fill。 | `workers/orchestrator-core/src/auth.ts`, `workers/orchestrator-core/test/auth.test.ts`, `workers/orchestrator-core/test/smoke.test.ts`, `test/package-e2e/orchestrator-core/06-auth-negative.test.mjs` |
| R9 | 没有 browser / WeChat manual smoke，却使用 “real-client baseline” 过满措辞 | `fixed-docs` | closure verdict 改为 `real-client scaffolding baseline + live runtime evidence established`；evidence 明确 automated live runtime evidence 不能替代 manual client evidence。 | `docs/eval/zero-to-real/first-real-run-evidence.md`, `docs/issue/zero-to-real/Z4-closure.md` |
| R10 | Tool registry 只做 name drift guard，schema/description 仍双源 | `deferred` | 未在 Z4 review-fix 中改注册源；记录为 Z5/tool registry SSoT hardening。当前 name guard 仍能防新增/删除漂移。 | `docs/issue/zero-to-real/Z4-closure.md` |
| R11 | Web client baseUrl 硬编码 preview | `fixed` | Web client 支持 `VITE_NANO_BASE_URL` 与 localStorage override；Mini Program page 改为读取既有 `app.globalData.baseUrl`，不再在 page 内重复硬编码。 | `clients/web/src/main.ts`, `clients/wechat-miniprogram/pages/index/index.js` |
| R12 | 客户端未直接 import `@haimang/nacp-session` | `partially-fixed` | Web/Mini 先补 wire-compatible `session.heartbeat/session.resume/session.stream.ack`；因 `clients/` 不在 pnpm workspace 且 Mini Program 不能直接消费 TS workspace package，本轮不强行 import，后续应生成共享 JS shim。 | `clients/web/src/client.ts`, `clients/wechat-miniprogram/utils/nano-client.js`, `docs/issue/zero-to-real/Z4-closure.md` |
| R13 | live smoke 没有 trace/session/usage anchor | `fixed` | live smoke 现在输出 `Z4_LIVE_LLM_ANCHOR`，并将新跑出的 trace/session/usage/idempotency 锚点写入 evidence artifact。 | `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs`, `docs/eval/zero-to-real/evidence/z4-254c1dc7-c595-4e14-97cd-7435b008d33c.json`, `docs/eval/zero-to-real/first-real-run-evidence.md` |
| R14 | quota missing-team typed reject 未补 | `deferred` | 本轮未改 quota repository；Z4 修的是 public auth tenant claim no deploy-fill，quota team onboarding typed error 留给 production hardening。 | `docs/issue/zero-to-real/Z4-closure.md` |
| R15 | 客户端 typed error envelope 被展平成字符串 | `fixed` | Web / Mini Program 增加 structured error classification，保留 status、code、quotaKind、remaining、limitValue 等可见字段。 | `clients/web/src/client.ts`, `clients/web/src/main.ts`, `clients/wechat-miniprogram/utils/nano-client.js`, `clients/wechat-miniprogram/pages/index/index.js` |
| K/D-O1 | Kimi / DeepSeek 对 heartbeat、replay、evidence、transport inventory、manual evidence 的重叠问题 | `covered` | 均并入 R1/R2/R5/R7/R9 的修复或明确 deferred。 | 同上 |
| K/D-O2 | live SQL smoke 使用字符串插值查询 session UUID | `fixed` | 新增 UUID regex guard，所有 D1 usage 查询前先 `assert.match(sessionId, UUID_RE)`。 | `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs` |
| D-S1 | “DeepSeek skeleton 缺失” | `rejected` | 该 finding stale；`workers/agent-core/src/llm/adapters/deepseek/index.ts` 已存在 skeleton。 | 无 |
| D-S2 | “LLM gateway 仍是 stub” | `rejected` | 该 finding stale；`workers/agent-core/src/llm/gateway.ts` 已真实走 Workers AI gateway/request-builder path。 | 无 |

### 6.3 变更文件清单

- `clients/web/src/client.ts`
- `clients/web/src/main.ts`
- `clients/wechat-miniprogram/pages/index/index.js`
- `clients/wechat-miniprogram/utils/nano-client.js`
- `workers/orchestrator-core/src/auth.ts`
- `workers/orchestrator-core/src/user-do.ts`
- `workers/orchestrator-core/test/auth.test.ts`
- `workers/orchestrator-core/test/smoke.test.ts`
- `workers/orchestrator-core/test/user-do.test.ts`
- `test/package-e2e/orchestrator-core/06-auth-negative.test.mjs`
- `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs`
- `docs/eval/zero-to-real/first-real-run-evidence.md`
- `docs/eval/zero-to-real/evidence/z4-254c1dc7-c595-4e14-97cd-7435b008d33c.json`
- `docs/issue/zero-to-real/Z4-closure.md`

### 6.4 验证结果

```text
pnpm --filter @haimang/orchestrator-core-worker typecheck
pnpm --filter @haimang/orchestrator-core-worker test
pnpm --filter @haimang/agent-core-worker typecheck
pnpm --filter @haimang/agent-core-worker test
./workers/agent-core/node_modules/.bin/tsc -p clients/web/tsconfig.json --noEmit
node --check clients/wechat-miniprogram/utils/nano-client.js
node --check clients/wechat-miniprogram/pages/index/index.js
pnpm test:package-e2e
pnpm test:cross-e2e
pnpm --filter @haimang/orchestrator-core-worker deploy:preview
NANO_AGENT_LIVE_E2E=1 node --test test/cross-e2e/12-real-llm-mainline-smoke.test.mjs

Results:
- orchestrator-core local tests: 35/35 pass
- agent-core local tests: 100 files / 1049 tests pass
- client source static/syntax checks pass
- default package/cross E2E suites pass with live tests skipped
- orchestrator-core preview deployed: 8e08094d-50d1-4672-bf8d-3b3429a566fa
- live LLM smoke pass; anchor:
  trace_uuid=254c1dc7-c595-4e14-97cd-7435b008d33c
  session_uuid=5436ded3-4f5c-4485-b444-088b85633d0b
  usage_event_uuid=965cd26e-9a6f-408e-a2b8-9f37cd17a44d
  provider_key=workers-ai
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. Browser / WeChat manual client smoke 仍未执行；本轮只提供 automated live runtime evidence，不伪造手工证据。
  2. Client WS stream 仍是 first-wave one-shot timeline snapshot；token-level live push / continuous stream-plane 留给下一阶段。
  3. Web / Mini Program 目前使用 wire-compatible session helper；后续应抽成由 `@haimang/nacp-session` 生成或共享的 client JS shim。
  4. Quota missing team 的 typed onboarding reject、tool registry schema SSoT 仍是 production hardening / Z5 follow-up。

---

## 7. 对 Opus 代码审查质量的评价

> 评价人: `GPT-5.4 / GitHub Copilot CLI`
> 评价时间: `2026-04-25`
> 评价依据: `docs/code-review/zero-to-real/Z4-reviewed-by-opus.md §0-§6，尤其 §1.2 / §2 / §3 / §5 / §6，并结合本轮对真实 6-worker 代码、review-fix 实施结果与文档收口结果的逐项复核`

### 7.1 一句话评价评审风格

Opus 这轮审查的最大价值是高信噪比和高落点精度：既能抓住真正阻断 Z4 收口的关键问题，也能把 blocker、docs-gap 与后续硬化项分层说清。

### 7.2 优点

1. 命中最关键的直接 bug 与协议断点：WeChat 路由错位、heartbeat、replay、manual evidence 口径失真。
2. 证据链非常完整，能够把 design/Q10/action-plan/closure/code/test 准确对齐到同一条论证链上。
3. 问题分级和修法建议都很可执行，基本可以直接转成修复清单。

### 7.3 缺点

1. 个别建议过于理想化，例如要求客户端直接 import `@haimang/nacp-session`，对 `clients/` workspace 边界与 Mini Program 运行约束考虑不够充分。
2. 少数 follow-up（如 quota missing team typed reject、tool registry schema SSoT）更像 Z5/production hardening，不必上提到和本轮 blocker 同一密度。
3. 报告篇幅很长，虽然高质量，但对阅读者成本要求也最高。

### 7.4 对审查报告中，全部问题，的清点

| 问题编号 | 原始严重程度 | 该问题的质量 | 分析与说明 |
|----|------|------|------------------|
| R1 | high | 高质量 | heartbeat 缺失判断准确，落点到 client + server 两侧，且本轮已被直接修复。 |
| R2 | high | 高质量 | replay cursor 缺失判断准确，建议与修复路径高度一致。 |
| R3 | high | 高质量 | `/auth/wechat` vs `/auth/wechat/login` 命中最关键的直接 correctness bug，价值极高。 |
| R4 | high | 高质量 | 对“一次性 snapshot 被叫作 stream”的语义漂移判断准确，也帮助本轮收紧了 closure/evidence 口径。 |
| R5 | medium | 高质量 | evidence 字段集缺失判断准确，且可直接转成 artifact/anchor 补齐。 |
| R6 | medium | 高质量 | IntentDispatcher/Broadcaster 状态未声明是有效 docs-gap。 |
| R7 | medium | 高质量 | residual transport inventory 缺失判断准确，且与 Z4 设计/charter 强绑定。 |
| R8 | medium | 高质量 | deploy-fill 仅在 agent-core 一侧退役的判断准确，本轮也已据此修正 public auth。 |
| R9 | medium | 高质量 | manual client smoke 与 “real-client baseline established” 口径不匹配，判断非常关键。 |
| R10 | low | 有效但次级 | tool registry SSoT 问题真实，但属于后续收敛项，不是 Z4 主 blocker。 |
| R11 | low | 高质量 | Web baseUrl env-driven 建议小而准，本轮也已被采纳。 |
| R12 | medium | 部分有效 | “不要重造 helper” 的原则正确，但直接要求 workspace import 的实现建议对当前 repo/小程序约束偏硬。 |
| R13 | low | 高质量 | live anchor 缺失是准确的审计链问题，本轮已补。 |
| R14 | low | 部分有效 | quota team onboarding typed reject 是真实硬化点，但更适合 Z5/production hardening。 |
| R15 | low | 高质量 | typed error semantics 被客户端抹平的判断准确，本轮也已直接修复。 |

### 7.5 评分 - 总体 ** 9.3 / 10 **

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | 10 | 设计、代码、测试、文档、历史阶段和风险链条都被完整串联。 |
| 判断严谨性 | 9 | 大多数判断都非常准确，只有少数建议对实现约束考虑略硬。 |
| 修法建议可执行性 | 9 | 大部分建议都能直接转为修复动作，本轮也已证明这一点。 |
| 对 action-plan / design 的忠实度 | 10 | 对 Q10、F1-F5、closure wording 的对齐度最高。 |
| 协作友好度 | 8 | 语气直接但清晰可执行，唯一代价是密度和篇幅较高。 |
| 找到问题的覆盖面 | 10 | 既抓 correctness，又抓 protocol、evidence、docs 与跨阶段语义漂移。 |

---

## 8. 二轮终审 — Opus 对 GPT 修复的复核 + Z0-Z4 全阶段 pre-Z5 综合审查

> 复核人: `Opus 4.7`
> 复核时间: `2026-04-25`
> 复核语境: `GPT 已根据 §6 进行修复并落入 §6.1-§6.5 + §7 评价；本章是 zero-to-real 进入 Z5 收尾前最后一次综合审查。`
> 复核基线:
> - 真实代码：`workers/orchestrator-core/src/{auth,user-do}.ts`、`workers/orchestrator-auth/src/{service,jwt,repository}.ts`、`workers/agent-core/src/{index,host/**,llm/**,kernel/runner}.ts`、`workers/bash-core/src/**`、`packages/nacp-session/src/**`、`packages/orchestrator-auth-contract/src/**`、`clients/web/**`、`clients/wechat-miniprogram/**`、`workers/orchestrator-core/migrations/00{1,2,3,4,5}-*.sql`
> - 文档：`docs/issue/zero-to-real/Z{0,1,2,3,4}-closure.md`、`docs/eval/zero-to-real/first-real-run-evidence.md` + `evidence/z4-...json`
> - 实测：本地 `pnpm typecheck + pnpm test` 全 6 个 worker；`pnpm test:contracts/package-e2e/cross-e2e`

### 8.0 一句话与三句话总结

- **一句话**：`Z4 已经从 changes-requested 升到 ready-for-Z5；Q10 transport baseline、deploy-fill 退役、evidence 锚点、客户端 typed error 这四条 high-impact blockers 全部真实落地，剩余 5 条结构性收敛项作为 Z5 inheritance backlog 是合理的。`
- **三句话**：
  1. GPT 这一轮的修复信噪比相当高：15 条 finding 中 8 条 fixed、3 条 fixed-docs、1 条 partially-fixed、3 条 deferred-with-justification、0 条 falsely-claimed-fixed；本地 typecheck/test 全绿（orchestrator-core 35/35、agent-core 1049/1049、orchestrator-auth 6/6、bash-core 359/359、context-core 171/171、filesystem-core 294/294、contracts 107/107），代码与日志一致。
  2. 修复同时引入了 5 条小的衍生问题（参见 §8.2），但全部属于 follow-up 级别——其中最值得 Z5 优先吸收的是 (a) `tenant_source = "deploy-fill"` enum 值在两个下游 type guard 里仍是合法值（虽然已无生产路径会 mint 它），(b) `user-do.ts setInterval` 没 try/catch + 不是 DO Alarm 形态，(c) 客户端 `session.resume` body 在 orchestrator-core 一侧是 no-op。
  3. 跨阶段角度，Z0-Z3 的 12 条 frozen invariant 没有任何回退；Z4 自身原本掉链的 Q10 transport 现在 server-initiated heartbeat（15s）+ URL query `last_seen_seq` 替代 `session.resume` body cursor 都在线，配套 `04-reconnect.test.mjs`/`user-do.test.ts:557` 有 regression。**Z4 可以收口；Z5 可以以 zero-to-real handoff 为目的进入。**

### 8.1 GPT 修复逐项核查表（按原始严重级别排序）

| 编号 | 严重级 | GPT 自评 | Opus 复核 | 真实落地的代码/文档锚点 | 复核备注 |
|------|--------|----------|-----------|-------------------------|----------|
| R1 | high | `fixed` | `confirmed-fixed` | `workers/orchestrator-core/src/user-do.ts:144 CLIENT_WS_HEARTBEAT_INTERVAL_MS=15_000`，`:1307-1318` server `setInterval` 推送 `{kind:"session.heartbeat",ts}`；`clients/web/src/client.ts:106-115` 客户端 15s 自发心跳 + `socket.readyState` 守卫；`clients/wechat-miniprogram/utils/nano-client.js:118-123` `task.onOpen` 后启动 15s `safeSend(heartbeatFrame)` | 服务侧间隔 = 15s（≤ Q10 25s 上限）；客户端兼容侧也带 ts 心跳；`current.heartbeat_timer` 在 supersede + close 两条路径都被 `clearInterval`（line 1296、1358）。**Q10 first hard rule 已成立**。|
| R2 | high | `fixed` | `confirmed-fixed` | `workers/orchestrator-core/src/user-do.ts:246-251 parseLastSeenSeq`，`:1282 clientLastSeenSeq`，`:1327-1330 replayCursor=Math.min(entry.relay_cursor, clientLastSeenSeq)`；`:1413-1438 forwardFramesToAttachment` 仅 forward `frame.seq>cursor`；新 regression `workers/orchestrator-core/test/user-do.test.ts:557 'uses client last_seen_seq on ws attach to replay missed frames without duplicating'`：`?last_seen_seq=1` + 4 帧（seq=0/1/2/3）→ socket 实际收到只有 seq=2,3，且 D1 cursor 落到 3 | replay cursor 真实生效，`Math.min` 是正确的 anti-replay-attack 形态——客户端不能通过夸大 `last_seen_seq` 跳过尚未推送的帧，因为 server-side `entry.relay_cursor` 永远是上限。**Q10 second hard rule 已成立**。|
| R3 | high | `fixed` | `confirmed-fixed` | `clients/wechat-miniprogram/pages/index/index.js:59` 现在 POST `/auth/wechat/login`，与 `workers/orchestrator-core/src/index.ts:106 if (method==="POST" && pathname==="/auth/wechat/login") return "wechatLogin";` 完全对齐 | 小程序 wechatLogin 流程现在能真实进入 `OrchestratorAuthService.wechatLogin`；剩余的 _真实 appid + 真实 wx.login code_ 已被 R5 / closure 残留诚实承认为 deferred。|
| R4 | high | `deferred` | `confirmed-deferred-honestly` | `docs/issue/zero-to-real/Z4-closure.md:5` verdict 改为 `real-client scaffolding baseline + live runtime evidence established`；`:84` 残留 R3 显式说 "first-wave one-shot timeline snapshot, 不是 token-level live push"；`docs/eval/zero-to-real/first-real-run-evidence.md:5` 状态加 `+ review-fixed`，`:36` 写 `reconnect_ok = "not exercised by this artifact"` | 这是 docs-level 校准最关键的一项：用语从 "established" 退到 "scaffolding baseline + live runtime"，把 design 与实现的语义裂缝写实了。Z5 不必再继承这个 misleading 用语。|
| R5 | medium | `fixed` | `confirmed-fixed` | 新增 artifact `docs/eval/zero-to-real/evidence/z4-254c1dc7-c595-4e14-97cd-7435b008d33c.json` 含 11 个 design 字段（trace_uuid / session_uuid / client_kind / auth_path / transport_baseline / runtime_ok / history_ok / reconnect_ok / quota_evidence / open_gaps / closure_verdict）；`first-real-run-evidence.md` §1.1 加结构化锚点表；`test/cross-e2e/12-real-llm-mainline-smoke.test.mjs:97-105` 跑出后会 `console.log` `# Z4_LIVE_LLM_ANCHOR {...}` | F3 字段集兑现了 9/9（reconnect_ok 显式 declare 为 `not exercised`，open_gaps 用 3 条 string 列表）。json artifact 与 markdown anchor 表 cross-link 正确。|
| R6 | medium | `fixed-docs` | `confirmed-fixed` | `docs/issue/zero-to-real/Z4-closure.md:87` Residuals §6 第 6 条："Z4 未实现同名模块。当前状态明确为 `deferred-next-phase`" | F4 §302 判定方法 2 兑现。|
| R7 | medium | `fixed-docs` | `confirmed-fixed-with-improvement` | `docs/issue/zero-to-real/Z4-closure.md:91-98` §6 整张 transport inventory 表，含 4 行：guarded `/internal/sessions/*` HTTP relay、snapshot stream、WS query token compatibility、client hand-written helper shim | F5 §316 字段全部覆盖（seam / owner / 保留原因 / 风险 / 候选退役阶段），并且 client helper shim 这条是 GPT 自己加的、未在我原 R7 建议表里——补得对。|
| R8 | medium | `fixed` | `confirmed-fixed-but-incomplete` | `workers/orchestrator-core/src/auth.ts:31 tenant_source: "claim"` 严格类型，`:208-213 if (!effectiveTenant) return 403 "missing-team-claim"`；3 个新测试覆盖：`test/auth.test.ts:66`、`test/smoke.test.ts:100`、`test/package-e2e/orchestrator-core/06-auth-negative.test.mjs:90` | mint 入口 ✅。但参见 §8.2 W-1：下游两个 type guard（`agent-core/src/host/internal-policy.ts:48-50`、`orchestrator-core/src/user-do.ts:175-177`）仍把 `"deploy-fill"` 列为合法值。这部分是 dead enum value，没有实际路径会写入；但 Z5 应一并清理。|
| R9 | medium | `fixed-docs` | `confirmed-fixed` | closure verdict + evidence §1.1 closure_verdict = `accepted-as-live-runtime-evidence-not-manual-client-evidence` | 用语从 "real-client baseline established" 收紧到 "scaffolding baseline + live runtime evidence"。诚实程度提到位。|
| R10 | low | `deferred` | `confirmed-deferred-with-rationale` | closure §6 第 4 行 inventory 已记 client helper shim → "Z5 / client package extraction" | tool registry SSoT 收敛在 Z5 处理是合理的 scope。|
| R11 | low | `fixed` | `confirmed-fixed` | `clients/web/src/main.ts:5-19 envBaseUrl = import.meta.env?.VITE_NANO_BASE_URL`，`baseUrl = localStorage ?? envBaseUrl ?? DEFAULT_BASE_URL`；`clients/wechat-miniprogram/pages/index/index.js:6 baseUrl: app.globalData.baseUrl`，与 `clients/wechat-miniprogram/app.js` 的 `globalData.baseUrl` 联动 | 优先级 = localStorage > env > default 是合理的；小程序集中到 globalData，避免 Page 内重复硬编码。|
| R12 | medium | `partially-fixed` | `confirmed-partially-fixed` | 客户端没有 import `@haimang/nacp-session`，但实现了 wire-compatible `session.heartbeat / session.resume / session.stream.ack` envelope；closure §6 transport inventory 第 4 行明确这是 deferred-next-phase | Q10 §322-§325 的 _精神_（wire shape 与 nacp-session 一致）落地了；_字面_（直接 import）确实没办到，但 closure 已写实，并把它作为 client package extraction 的 backlog 入口。|
| R13 | low | `fixed` | `confirmed-fixed` | `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs:97-105 console.log Z4_LIVE_LLM_ANCHOR`；evidence json 含 `usage_event_uuid / idempotency_key / trace_uuid / session_uuid` | live evidence 现在可被 D1 行级别复核：`SELECT * FROM nano_usage_events WHERE usage_event_uuid='965cd26e-...'`。审计链通了。|
| R14 | low | `deferred` | `confirmed-deferred-justified` | closure 没把它列进 inventory，但 §5 残留 R4 诚实保留 escape hatch | quota team onboarding typed reject 留到 production hardening 是合理的。|
| R15 | low | `fixed` | `confirmed-fixed` | `clients/web/src/client.ts:19-33 ClientErrorDetails + NanoClientError`，`:166-189 throw NanoClientError` 携带 `kind / status / code / quotaKind / remaining / limitValue`；`main.ts:75-78 NanoClientError` 时 spread `error.details` 进 log；mini-program `nano-client.js:11-29 classifyError`、`pages/index/index.js:36/51/68/90/124 readErrMessage(error)` 把 typed details 落到日志 | typed error semantic 现在被 _保留_ 而不是被 _展平_，与 Q9 §296 user-visible typed `code='QUOTA_EXCEEDED'` 的精神一致。|
| K/D-O1 | medium | `covered` | `accepted` | 所有重叠问题都映射到 R1/R2/R5/R7/R9 的修复项 | overlap merge 合理。|
| K/D-O2 | low | `fixed` | `confirmed-fixed` | `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs:6 UUID_RE`，`:54-58 queryLlmUsageCount(sessionId)`，`:61-66 queryLlmUsageAnchor(sessionId)` 都先 `assert.match(sessionId, UUID_RE)` 再用字符串插值 | SQL injection guard 落地。|
| D-S1 | n/a | `rejected` | `accepted` | DeepSeek skeleton 真的存在 `workers/agent-core/src/llm/adapters/deepseek/index.ts` | reject 合理，原 finding 已 stale。|
| D-S2 | n/a | `rejected` | `accepted` | gateway 真的不是 stub，`gateway.ts:157 class WorkersAiGateway implements InferenceGateway` | reject 合理。|

### 8.1.1 修复评分（汇总）

| 维度 | 数量 | 占比 |
|------|------|------|
| `confirmed-fixed`（R1/R2/R3/R5/R6/R7/R11/R13/R15 + K/D-O2）| 10 | 53% |
| `confirmed-fixed-with-improvement`（R7 加了 client shim 一栏）| 1 | 5% |
| `confirmed-fixed-but-incomplete`（R8）| 1 | 5% |
| `confirmed-fixed-docs`（R9）| 1 | 5% |
| `confirmed-deferred-honestly / with-rationale`（R4/R10/R14/K-D-O1）| 4 | 21% |
| `confirmed-partially-fixed`（R12）| 1 | 5% |
| `accepted-rejected-as-stale`（D-S1/D-S2）| 2 | 11% |
| `falsely-claimed-fixed`（仍未真实修复但日志说已修）| **0** | **0%** |

**关键事实**：本轮修复**没有任何一条 falsely-claimed-fixed**——这是 zero-to-real 三轮 review 中信噪比最高的一次。

### 8.2 修复引入的衍生问题与边角问题（W 系列）

> 这些都不是 Z4 的 close blocker；记入 Z5 inheritance backlog。

#### W-1. `tenant_source = "deploy-fill"` enum 值仍在 2 个下游 type guard 中合法

- **严重级别**：`low`
- **类型**：`scope-drift / cleanup`
- **事实依据**：
  - `workers/agent-core/src/host/internal-policy.ts:13 readonly tenant_source?: "claim" | "deploy-fill";` 与 `:48-50 normalizeAuthority` 仍允许 `"deploy-fill"` 通过校验。
  - `workers/orchestrator-core/src/user-do.ts:175-177 isAuthSnapshot` 也仍把 `"deploy-fill"` 当成合法值。
  - 但 mint 入口 `workers/orchestrator-core/src/auth.ts:225 tenant_source: "claim"` 已严格只产 claim。
- **判断**：dead enum value——目前没有任何代码路径会 mint `deploy-fill`，但下游 type guard 仍接受它。如果未来某个 worker 以 NACP envelope 形式跨 binding 注入一个 `tenant_source: "deploy-fill"` payload，下游会接受。
- **建议**：Z5 把这两处 type guard 收紧成 `tenant_source === "claim"` 唯一允许值；同时把 internal-policy.ts 的 `InternalAuthorityPayload.tenant_source` 类型也收紧。

#### W-2. orchestrator-core user-do `setInterval(15s)` 不是 DO 推荐形态

- **严重级别**：`low`
- **类型**：`platform-fitness`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:1307-1318 setInterval(...)` + `:1318 (heartbeatTimer as ... { unref?: () => void }).unref?.()`——`unref` 是 Node-only 概念，在 Cloudflare Workers DO 里不会真生效（被 `?.` 守住，所以只是 best-effort）。
  - DO 在 idle 时会 hibernate；timer 状态不会跨 hibernate 持久化。
  - Q6 owner 答案 §200 已经把 DO Alarm 作为 hot-state heartbeat 的推荐形态。
- **判断**：在单次 attachment lifetime 内（attach → close 之间），`setInterval` 实际能工作，因为 attached socket 自身就让 DO 不 hibernate。但首先仍有一个**未捕获的异常风险**：`pair.server.send(...)` 若在 close handler 触发前被 timer tick 调用一次到已关闭 socket，`send()` 抛错会作为未处理异常逃出 timer 回调（Cloudflare Workers 的 `setInterval` 异常没有兜底）。
- **建议**：Z5 把 ws heartbeat 改成由 DO Alarm + `getWebSockets()` 反查驱动；过渡期至少把 `pair.server.send` 包进 try/catch。

#### W-3. 客户端 `session.resume` body 在 orchestrator-core 是 no-op

- **严重级别**：`low`
- **类型**：`docs-gap / wire-redundancy`
- **事实依据**：
  - 客户端 `clients/web/src/client.ts:118-122` + `clients/wechat-miniprogram/utils/nano-client.js:120` 在 `onOpen` 都发了 `{ message_type: "session.resume", body: { last_seen_seq } }`。
  - 但 `workers/orchestrator-core/src/user-do.ts:1362 socket.addEventListener('message', ...)` 仅做 `touchSession`；没有任何 `parseFrame / SESSION_BODY_SCHEMAS["session.resume"]` 解析；replay cursor 完全来自 `parseLastSeenSeq` URL query。
- **判断**：URL query 已经正确解析，`session.resume` body 是 wire-shape 兼容性 _theatre_。但这导致两个事实：(a) 如果未来 client 仅发 body（例如 query 不可设的小程序场景）想恢复 cursor，server 不会理会；(b) 后续如果 client / server 在 ws 消息上对称地约定其他 wire control（例如 cancel-from-client、resume-on-error），会比想象更复杂。
- **建议**：Z5 把 user-do 的 `socket.addEventListener('message')` 升级为 schema 解析路径，至少把 `session.resume.body.last_seen_seq` 接成第二条 cursor 输入（与 URL query 取 `Math.min`）。

#### W-4. 服务端心跳 vs 客户端心跳的 wire shape 不对称

- **严重级别**：`low`
- **类型**：`docs-gap / wire-asymmetry`
- **事实依据**：
  - 服务侧推送：`workers/orchestrator-core/src/user-do.ts:1313 { kind: 'session.heartbeat', ts: Date.now() }`——非 NACP envelope，是平的 `{kind, ts}`。
  - 客户端推送：`clients/web/src/client.ts:112 { message_type: "session.heartbeat", body: { ts: now } }`——NACP envelope。
  - `packages/nacp-session/src/messages.ts:60-64 SessionHeartbeatBodySchema = z.object({ ts: number })` 是 _body_ 形态，对应 `message_type` 包裹。
- **判断**：服务侧推送的形状不匹配 nacp-session schema。client 当前接收时只看 `seq`，不会校验 `message_type`，所以没出错；但 _跨方向_ 的 wire 形状一致性是 zero-to-real 一直在追求的目标，这条会在 client SDK 抽象出来时立刻被发现。
- **建议**：Z5 client SDK 抽象时，server 推送也改为 `{ message_type: "session.heartbeat", body: { ts } }`，或者把 `session.heartbeat` 显式从 NACP envelope 列表里移到 _control frame_ 列表，单独定义 schema。

#### W-5. `@nano-agent/client-web` namespace 与 W2 `@haimang/*` 收敛不一致

- **严重级别**：`low`
- **类型**：`naming / cleanup`
- **事实依据**：
  - `clients/web/package.json:2 "name": "@nano-agent/client-web"`，但全仓 W2 已对齐为 `@haimang/*` namespace（root memory）。
- **判断**：client 是 `private: true` 不会发布，但与其他 16 个 `@haimang/*` package 对齐能让 `pnpm -r` filter / tooling 风格一致。
- **建议**：Z5 client package extraction 时一并改为 `@haimang/client-web`。

### 8.3 Z0-Z4 全阶段最终复盘

#### 8.3.1 Z0（contract / compliance freeze）+ Z1（auth + tenant foundation）

| 项 | 实际状态 | 锚点 |
|----|----------|------|
| `packages/orchestrator-auth-contract` typed contract package 存在 | ✅ | `packages/orchestrator-auth-contract/src/index.ts:12 OWNER_MEMBERSHIP_LEVEL = 100` 等 envelope/输入/输出 zod schema 都在 |
| `orchestrator-auth` 是 WorkerEntrypoint RPC-first（Q1）| ✅ | `workers/orchestrator-auth/src/index.ts` `class extends WorkerEntrypoint`，10 个 RPC method（register/login/refresh/me/verify/wechatLogin/resetPassword/verifyApiKey/...）|
| HS256 + kid keyring + access 1h / refresh 30d / rotate-on-use（Q2）| ✅ | `service.ts:128 refreshExpiresIn = 30*24*60*60`、`:146 expires_in: 3600`、`:236 rotateAuthSession` 显式 revoke + new token；`jwt.ts:113 resolveSigningSecret` 走 `JWT_SIGNING_KEY_<kid>` keyring |
| WeChat 首登自动建 user + default team + owner-level membership（Q3）| ✅ | `service.ts:342 wechatLogin` → `repo.createBootstrapUser`，`repository.ts:209 OWNER_MEMBERSHIP_LEVEL` 写 nano_team_memberships |
| email/password 注册同样自动建 default team（Q3 §94 第 2 条）| ✅ | `service.ts:160 register` 也走 `createBootstrapUser` |
| `nano_team_api_keys` schema 预留 + impl defer（Q4）| ✅ | `service.ts:371 verifyApiKey returns reserved-for-future-phase`；migrations 含表结构 |
| Z4 修复：missing tenant claim → 403，不再 deploy-fill | ✅ | `workers/orchestrator-core/src/auth.ts:208-213` |

**Z0/Z1 现状**：所有 frozen invariant 兑现，没有回退；deploy-fill mint 入口已退役（W-1 是 dead enum cleanup）。

#### 8.3.2 Z2（session truth + audit baseline + dual-impl + hot-state）

| 项 | 实际状态 | 锚点 |
|----|----------|------|
| `nano_session_activity_logs` 12 列单 append-only 表（Q5）| ✅ | `migrations/002-session-truth-and-audit.sql:72-80 actor_user_uuid / event_seq / severity / payload`，3 个强制 index |
| `view_recent_audit_per_team` 派生 view（Q5 §170）| ✅ | `migrations/003-session-truth-hardening.sql:287-288 CREATE VIEW view_recent_audit_per_team` |
| Payload redaction 复用 `packages/nacp-session/src/redaction.ts`（Q5 §169）| ✅ | `workers/orchestrator-core/src/user-do.ts:229 redactActivityPayload` 使用 redactPayload |
| DO hot-state ≤200 conversations / ≤50 frames / TTL≤5min / 10min Alarm（Q6）| ✅ | `user-do.ts:142-148 MAX_CONVERSATIONS=200 / MAX_RECENT_FRAMES=50 / CACHE_TTL_MS=5min / HOT_STATE_ALARM_MS=10min`，`:368 alarm()` 调 trim/cleanup/setAlarm |
| 重建测试（Q6 §208 "清空 DO storage 后 reconnect 仍能从 D1 恢复"）| ✅ | `workers/orchestrator-core/test/user-do.test.ts:677 'hydrates readable state from durable truth when hot state was cleared'` |
| `start` 与 `status` dual-impl + golden parity（Q7）| ✅ | `user-do.ts:723-758 forwardStart` + `:761-791 forwardStatus`，两条都 `jsonDeepEqual(rpc, fetch)`，diff 时 502 |
| Z4 新增 replay cursor regression | ✅ | `user-do.test.ts:557 'uses client last_seen_seq on ws attach'` |
| Z4 新增 ws supersede regression | ✅ | `user-do.test.ts:496 'supersedes the old ws attachment'` |

**Z2 现状**：hot-state 实现 / dual-impl parity / hot-state 重建测试全部 in-tree；Z4 又给 replay 加了 regression。一个余项是 **dual-impl 永久双跑**（每条 start/status 都跑两遍）——这是 Q7 frozen "first proof" 的实际形态，Z5 之前是否切到 RPC primary 应由 owner 决定。

#### 8.3.3 Z3（quota + Workers AI mainline + runtime）

| 项 | 实际状态 | 锚点 |
|----|----------|------|
| Workers AI 是 required provider；DeepSeek skeleton-only（Q8）| ✅ | `workers/agent-core/src/llm/gateway.ts:18 WORKERS_AI_PROVIDER_KEY="workers-ai"`，`:157 class WorkersAiGateway implements InferenceGateway`；`adapters/deepseek/index.ts` skeleton |
| `beforeLlmInvoke / afterLlmInvoke` LLM gate（Q9）| ✅ | `workers/agent-core/src/host/runtime-mainline.ts:288-309` |
| `beforeCapabilityExecute` tool gate（Q9）| ✅ | `runtime-mainline.ts:209-231 buildToolQuotaAuthorization + commit` 仅在 capability 返回 ok 时 commit |
| `nano_usage_events` durable usage truth | ✅ | `migrations/004-usage-and-quota.sql` + `005-usage-events-provider-key.sql` |
| `provider_key` 写入 + retention（Z3 R3）| ✅ | `workers/agent-core/src/host/quota/repository.ts:191-218` `INSERT OR IGNORE` 含 provider_key + atomic batch + EXISTS guard |
| RPC kickoff defense-in-depth（Z3 W-3 / Z4 preflight）| ✅ | `workers/agent-core/src/index.ts:201 validateInternalRpcMeta` + 转发 secret/trace/authority；`nano-session-do.ts:499-511 validateInternalAuthority` |
| system prompt injection（Z4-mid hard deadline）| ✅ | `runtime-mainline.ts:104-119 NANO_AGENT_SYSTEM_PROMPT` + `withNanoAgentSystemPrompt`；regression `test/host/runtime-mainline.test.ts:143-164` |
| Workers AI tool registry SSoT 收敛 | ⚠️ | `llm/tool-registry.ts` 是 agent-core 自维护副本；name-only drift guard 在 `gateway.test.ts:93-103`；schema drift 仍是 deferred（R10）|
| live preview Workers AI mainline evidence | ✅ | `evidence/z4-254c1dc7-c595-4e14-97cd-7435b008d33c.json` 含 `usage_event_uuid: 965cd26e-9a6f-408e-a2b8-9f37cd17a44d` D1 行级证据 |
| preview synthetic seed owner ≠ team UUID | ✅ | `host/quota/repository.ts:30 PREVIEW_SEED_OWNER_USER_UUID = "00000000-0000-4000-8000-000000000001"` |
| `NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED` escape hatch | ✅ | repository options + wrangler.jsonc env gate |

**Z3 现状**：Workers AI mainline + quota dual gate 已成事实，live evidence 锚点完整。R10（tool registry SSoT）是 cleanest deferred item。

#### 8.3.4 Z4（real clients + first real run）

| 项 | 实际状态 | 锚点 |
|----|----------|------|
| `clients/web` Vite + Vanilla TS 最小客户端 | ✅ | `clients/web/{package.json,index.html,src/{client.ts,main.ts,styles.css}}` |
| `clients/wechat-miniprogram` 微信原生工程 | ✅ | `clients/wechat-miniprogram/{app.{js,json},project.config.json,sitemap.json,utils/nano-client.js,pages/index/{index.{js,json,wxml,wxss}}}` |
| Q10 baseline: HTTP start/input + WS stream/history | ✅ | both clients HTTP-in / WS-out |
| Q10 frozen: server-initiated heartbeat ≤25s | ✅ | user-do.ts:1307-1318 15s server ping + clients 也 15s 自发 |
| Q10 frozen: replay cursor / `last_seen_seq` | ✅ | URL query parsed at user-do.ts:246-251；client 维护 lastSeenSeq；regression at user-do.test.ts:557 |
| Q10 frozen: HTTP follow-up input 必带 `session_uuid` | ✅ | `clients/web/src/client.ts:81 body: JSON.stringify({ text, session_uuid: sessionUuid })`；mini-program `pages/index/index.js:80` 同 |
| Mini Program WeChat code-level login URL 正确 | ✅ | client `/auth/wechat/login` + server `/auth/wechat/login` |
| typed error envelope 在客户端被保留 | ✅ | `client.ts:166-189 NanoClientError`；mini-program `nano-client.js:11-29 classifyError` |
| evidence pack 含 `trace_uuid / session_uuid / usage_event_uuid` | ✅ | `evidence/z4-...json` |
| F1 web "可连续完成 login → start → followup → stream → history" | ⚠️ | 自动化 cross-e2e LLM smoke 真跑通；但 manual browser run 没发生（R9 closure 已诚实 declare）|
| F2 mini-program "WeChat login → start → input → stream → history" | ⚠️ | 路径都接通；真实 appid + 真机截图 deferred（R5 closure 诚实承认）|
| F3 evidence pack 字段集 | ✅ | json artifact 全部覆盖 |
| F4 IntentDispatcher / Broadcaster 状态明确 | ✅ | closure §5.6 declare deferred-next-phase |
| F5 residual transport inventory | ✅ | closure §6 4 行表 |
| WS stream = inflight token push | ❌（明确为 first-wave deferred） | `agent-core/src/host/internal.ts:107` snapshot-only；closure 残留 R3 显式 declare |

**Z4 现状**：Q10 三条 hard rule 都成立；F1/F2 部分（manual real-user run + 真实 appid evidence）诚实 deferred；token-level streaming 显式 first-wave 不做。`scaffolding baseline + live runtime evidence established` 这个收口 verdict 是当前状态最准确的描述。

### 8.4 跨包跨阶段执行逻辑核查（pre-Z5）

#### 8.4.1 `tenant_source` 端到端走线

```
JWT mint (orchestrator-auth/service.ts:88-103, "team_uuid + tenant_uuid claim")
  └─→ JWT verify (orchestrator-core/auth.ts:190-213, "missing-team-claim if absent")
        └─→ snapshot mint (orchestrator-core/auth.ts:225, tenant_source: "claim")
              └─→ NACP authority forward (orchestrator-core/user-do.ts:1496-1498)
                    └─→ HTTP relay header x-nano-internal-authority
                          └─→ agent-core/host/internal.ts:46 forward
                                └─→ DO validateInternalAuthority (agent-core/host/internal-policy.ts:200 normalizeAuthority)
                                      └─→ accept tenant_source ∈ {"claim", "deploy-fill"}  ⚠️ W-1 dead enum
                                            └─→ runtime tenant truth (nano-session-do.ts:602-607 currentTeamUuid)
```

整条链 mint 入口已退役 deploy-fill；下游 type guard 仍允许（W-1）。**没有现存代码路径会写入 deploy-fill 进 mint，所以仅是类型层面的 cleanup。**

#### 8.4.2 quota authorize → commit → D1 行 → live evidence 走线

```
agent-core runtime-mainline.ts:288 beforeLlmInvoke
  └─→ quota/authorizer.ts authorize("llm", ctx, "llm-${turnId}-${seq+1}", { provider_key })
        └─→ quota/repository.ts ensureBalance + ...
runtime-mainline.ts:298 afterLlmInvoke
  └─→ quota/authorizer.ts commit("llm", ctx, requestId, { provider_key, input/output_tokens })
        └─→ quota/repository.ts:191-218 db.batch([INSERT, UPDATE, SELECT])
              └─→ nano_usage_events row（含 provider_key="workers-ai"）
                    └─→ 12-real-llm-mainline-smoke.test.mjs:64 SELECT...WHERE provider_key='workers-ai'
                          └─→ Z4_LIVE_LLM_ANCHOR usage_event_uuid 落 evidence json
```

整条链可端到端复核。**Z3 R3 + Z4 R5/R13 联合落地，audit chain 闭合。**

#### 8.4.3 client cursor → server cursor 走线

```
clients/web/src/client.ts:104 url.searchParams.set("last_seen_seq", lastSeenSeq)
  └─→ workers/orchestrator-core/src/user-do.ts:247 parseLastSeenSeq(URL query)
        └─→ :1327-1330 replayCursor = Math.min(entry.relay_cursor, clientLastSeenSeq)
              └─→ :1339 forwardFramesToAttachment(...stream.frames) only seq>cursor
                    └─→ :1431 next entry.relay_cursor = max seq forwarded

(parallel) client.ts:118 ws.send({message_type:"session.resume", body:{last_seen_seq}})
  └─→ user-do.ts:1362 socket.addEventListener('message') → touchSession only
        └─→ ⚠️ W-3 body 被忽略（cursor 已从 URL query 拿到所以无功能后果）
```

URL query path 真实生效；session.resume body 是 wire-compat theatre（W-3）。**Q10 second hard rule 仍成立，因为 URL query 路径是单一 cursor 来源。**

#### 8.4.4 client typed error → server typed envelope 走线

```
quota/authorizer.ts authorize → throws QuotaExceededError {code: "QUOTA_EXCEEDED", quotaKind, remaining, limitValue}
  └─→ runtime-mainline.ts:247 catch QuotaExceededError → result {code, message}
        └─→ kernel runner converts to system.notify + complete_turn
              └─→ orchestrator-core HTTP envelope {ok: false, error: {code, message, ...}}
                    └─→ clients/web/src/client.ts:166-189 throw NanoClientError({kind, code, quotaKind, remaining, limitValue})
                          └─→ main.ts:75-78 spread error.details into log
```

typed propagation 完整：Q9 §296 frozen 兑现。

### 8.5 实测证据（本轮 review 复核期间在本地跑过）

| 命令 | 结果 |
|------|------|
| `pnpm --filter @haimang/orchestrator-core-worker typecheck` | pass |
| `pnpm --filter @haimang/orchestrator-core-worker test` | `35/35 pass`（auth 7、smoke 11、user-do 17）|
| `pnpm --filter @haimang/orchestrator-auth-worker typecheck` | pass |
| `pnpm --filter @haimang/orchestrator-auth-worker test` | `6/6 pass` |
| `pnpm --filter @haimang/agent-core-worker typecheck` | pass |
| `pnpm --filter @haimang/agent-core-worker test` | `1049/1049 pass` over 100 files |
| `pnpm --filter @haimang/bash-core-worker test` | `359/359 pass` over 29 files |
| `pnpm --filter @haimang/context-core-worker test` | `171/171 pass` over 19 files |
| `pnpm --filter @haimang/filesystem-core-worker test` | `294/294 pass` over 25 files |
| `pnpm test:contracts` | `107/107 pass` |
| `pnpm test:package-e2e` | 36 tests skipped（live gated）|
| `pnpm test:cross-e2e` | 13 tests skipped（live gated；含新加的 `12-real-llm-mainline-smoke`）|
| `./workers/agent-core/node_modules/.bin/tsc -p clients/web/tsconfig.json --noEmit` | pass |
| `node --check clients/wechat-miniprogram/{app.js,utils/nano-client.js,pages/index/index.js}` | pass |

**总计 6 个 worker 的本地 typecheck + test 全部通过；2014 条 unit/integration tests 0 fail。**

> live tests 我没本地跑（需要 `NANO_AGENT_LIVE_E2E=1` + 真实 PASSWORD_SALT + JWT secret + preview deploy）。GPT 自评跑过，且 evidence json `usage_event_uuid: 965cd26e-9a6f-408e-a2b8-9f37cd17a44d` 是可校验的 D1 行锚点——任何后续 reviewer 都可以对 preview D1 跑 `SELECT * FROM nano_usage_events WHERE usage_event_uuid='...';` 直接复核。

### 8.6 Z4 closure / Z5 entry 决策

#### 8.6.1 Z4 是否可关闭

- **决策**：`yes — close Z4 with verdict "real-client scaffolding baseline + live runtime evidence established"`
- **依据**：
  1. 全部 high-impact blocker（R1-R3、R8）真实 fixed，并有 regression 把守。
  2. Q0-Q9 frozen invariant 没有回退；Q10 三条 hard rule 全部 in-tree（heartbeat 15s ≤ 25s、replay cursor、HTTP follow-up 带 session_uuid）。
  3. evidence pack 含 D1 行级 anchor；可被任何后续 reviewer 复核。
  4. 残留事项（manual real-user run、token-level streaming、client SDK extraction、tool registry SSoT、deploy-fill enum cleanup）都属于 _hardening / productization_，不属于 _baseline correctness_。
  5. closure 用语已收敛到事实，不再使用 misleading 的 "real-client baseline established"。

#### 8.6.2 Z5（closure-and-handoff）是否可入

- **决策**：`yes — Z5 可以作为 zero-to-real 总收口阶段进入`
- **Z5 应继承的 backlog（按建议优先级）**：
  1. **W-1 / R8 残尾**：把 `tenant_source = "deploy-fill"` enum 值从 `agent-core/host/internal-policy.ts:13/48-50` 与 `orchestrator-core/user-do.ts:175-177` 一并移除；把 `agent-core/src/host/env.ts` 与 `internal.ts` 里 `TEAM_UUID?: string` 的类型字段也清掉（只在 worker test fixture 保留）。约 1 天工作量。
  2. **W-2 ws heartbeat 平台对齐**：`setInterval` → DO Alarm + getWebSockets()；`pair.server.send` 包 try/catch。约 1 天。
  3. **W-3 / W-4 wire-shape 对称**：让 user-do `socket.addEventListener('message')` 解析 NACP envelope，至少接 `session.resume.body.last_seen_seq` 与 server 推送 `{message_type, body}` 形态。约 1 天。
  4. **R10 tool registry SSoT**：`agent-core/src/llm/tool-registry.ts` 改成从 `bash-core/src/fake-bash/commands.ts` 派生；schema 真实迁移到 bash-core minimal registry。约 1-2 天。
  5. **R12 client package extraction**：把 `clients/web/src/client.ts` + `clients/wechat-miniprogram/utils/nano-client.js` 抽到 `packages/nacp-client-shim` 或类似，由 `@haimang/nacp-session` 的 wire types 驱动；同时把 `@nano-agent/client-web` 改为 `@haimang/client-web`（W-5）。约 2-3 天。
  6. **R9 / R5 manual evidence**：跑一次真实浏览器 + 微信开发者工具的 manual run，落 trace anchors 到 evidence/z5-*.json。约 半天。
  7. **R4 / R3-residual stream-plane hardening**：决定是否让 user-do 持续 push（DO Alarm + timeline diff），还是承认 first-wave 永远是 snapshot。这是产品决策，需要 owner 签字。
  8. **R14 quota team-missing typed reject**：production hardening 项；Z5 不强求落地，但应记入 zero-to-real 总 backlog。

- **Z5 不该再做的事**（不要把 zero-to-real 阶段拖出 scope）：
  1. 真正的产品 UI（design 系统、组件库、离线缓存）——明确 zero-to-real out-of-scope。
  2. admin plane / 计费 UI / SLO dashboard——zero-to-real charter §7.5 已显式 out-of-scope。
  3. Workers AI 第二个 model 真实 fc smoke（除非 Workers AI primary fc 出问题；Q8 §265 已预设 escalation path）。
  4. `IntentDispatcher / Broadcaster` 实际实现——deferred-next-phase 是当前最佳决策。

#### 8.6.3 Z4 → Z5 → Mini Program 真机 first run

- **决策**：`允许在 Z5 期间进行 Mini Program 真机 first run；不允许把 Z4 close 改写成 'Mini Program 真机已成立'`
- **理由**：
  1. WeChat 登录 URL 已对齐；client envelope 与 server schema 兼容；server 端 heartbeat + replay cursor 都在线。technical readiness 是真的。
  2. 但真实 appid + ICP 备案 + 微信开放平台审核是运营性工作，不在 Z4 deliverable 内。
  3. Z5 closure 阶段里跑一次真机 first run 并落 manual evidence 是合理 sequencing；将其作为 zero-to-real 总 verdict 的封口动作，比试图把 Z4 重新打开更经济。

### 8.7 三轮审查的最终信号（写给 owner）

- **Z3 closed**：✅
- **Z4 closed**：✅（real-client scaffolding baseline + live runtime evidence established；不夸大为 "real-client baseline"）
- **Z5 可入**：✅（继承 §8.6.2 中 8 条优先级排序的 backlog）
- **Mini Program 真机 first run 直接进 Z4**：❌（保留到 Z5；技术上已可，但不应回头改 Z4 用语）
- **zero-to-real 整体可向 next-phase 移交**：✅（Z0-Z3 invariant 完整；Z4 baseline + first real evidence 闭合；Z5 任务清单清晰）

> 三轮审查结束。Z4 现在是 zero-to-real 这条路上 _可被 owner 接受 closed_ 的最严格状态：**所有 high-impact 问题真实修复、所有遗留项被诚实命名、所有 invariant 跨阶段维持、所有断言由 regression 把守**。剩下的是 Z5 总收口，用 §8.6.2 的 backlog 完成 zero-to-real 这条线的最后 ~6-8 天工作量，然后 zero-to-real 这一阶段就可以连同 evidence/closure/handoff 一并交付出去。
