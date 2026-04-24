# Orchestration Facade — FX QNA

> 范围：`orchestration-facade / F0-F5`
> 目的：把会影响后续 `F0 design freeze / F1-F5 action-plan / closure` 的业主 / 架构师决策收敛到一份单一清单，避免在多个 design 文档中重复回答、重复漂移、重复改口。
> 状态：`frozen answer register (Q1-Q8 filled; F0 closed)`
> 使用方式：
> 1. **业主只在本文件填写回答。**
> 2. 其他 design / action-plan / memo 若引用某个 `Q` 编号，默认都以本文件为唯一答复来源。
> 3. 各具体文档不再逐条填写 QNA；如仍保留“已确认 / 已冻结”的历史表述，应理解为上下文说明，后续统一以本文件回填结果为准。
> 4. `Q` 编号应保持稳定；后续若补题，从最后一个编号继续追加。

---

## 1. Internal Contract / Stream Contract

### Q1 — internal auth header 的 first-wave 形态是否接受“shared secret header”作为 frozen baseline？（来源：`F0-agent-core-internal-binding-contract.md`）

- **影响范围**：`agent.core` internal route、`orchestrator.core` binding client、F1 integration tests
- **为什么必须确认**：如果不拍板，F1 会在“纯 header”与“签名载体/更复杂 token”之间摇摆，导致 internal contract 迟迟无法冻结。
- **当前建议 / 倾向**：**先接受 shared secret header 作为 first-wave frozen baseline**；未来若需要更强 identity，再升级为签名或平台级身份。
- **Reasoning**：这个问题会出现，是因为 `orchestrator -> agent` internal contract 既不能只信 transport，也不值得在第一版就造一套更重的内部身份系统。当前推荐路线更稳，是因为它足以把 internal request 与 public request 区分开，又不会把 F1 的实现复杂度抬高太多。如果现在不拍板，internal binding contract 这份 design 就会停留在“抽象同意，落地不同意”的状态，F1 会重新变回 ad-hoc fetch 胶水。

- **Opus的对问题的分解**：本题其实是 3 个子决策叠在一起：(a) Cloudflare service binding 本身是否足够做身份边界 —— 结论：不够，service binding 只保证 caller 是同 account worker，不能区分"是 orchestrator 还是 agent 自环调用"，也无法承载 authority payload；(b) 若必须加 gate，形态是 `shared secret header` / `signed token (HMAC)` / `platform identity (mTLS-like)` 三选一；(c) secret 的来源、rotation、preview/prod 隔离如何处理。
- **Opus的对GPT推荐线路的分析**：shared secret header 是 first-wave 最便宜的正解。理由：与 `wrangler secret` 已有模式直接对齐（项目已有 GitHub Packages `NODE_AUTH_TOKEN` 类 placeholder 经验，见 root `.npmrc`）；只需一个 header 与一次字符串比较，F1 测试可直接 inject；rotation 通过 `wrangler secret put` 无代码改动。**真实风险**只有一个：日志里泄漏 secret —— 这通过约定 `redact on trace emission` 可缓解。签名 token（HMAC）在 first-wave 带来的边际收益不足以覆盖额外的 signing / verification 逻辑与 clock-skew 处理；platform identity 目前 Cloudflare 尚无原生 worker identity attestation，属 future。
- **Opus的最终回答**：**同意 shared secret header 作为 frozen baseline**，但必须在 D2 `F0-agent-core-internal-binding-contract.md` 同步冻结 4 件落地细节：(1) header 名冻结为 `x-nano-internal-binding-secret`（命名避免与其它未来 `x-nano-internal-*` header 撞车）；(2) secret 值来源必须是 `wrangler secret`，通过 `env.NANO_INTERNAL_BINDING_SECRET` 读取，**严禁**硬编码或 `vars` 明文；(3) preview 与 prod 必须使用**独立**的 secret，不得复用；(4) agent.core 侧 secret 缺失 / 不匹配时返回 typed rejection `{ error: "invalid-internal-auth", ... }` + HTTP 401，**不静默 fallback** 到 legacy public route。另外 header gate 只是第一重；request 到达 agent.core 后 F4.A 的 `validateInternalAuthority()` 仍必须校验 authority payload 的 legality —— 两重独立，不合并。

- **问题**：`F1 是否确认采用 shared secret header 作为 first-wave internal auth gate？如果不同意，请明确是要签名 token，还是平台身份方案。`
- **业主回答**：同意，与Opus的建议相同。

### Q2 — internal stream relay 是否正式冻结为 `HTTP streaming + application/x-ndjson + meta/event/terminal`？（来源：`F0-stream-relay-mechanism.md`）

- **影响范围**：`agent.core` internal stream route、`orchestrator.core` relay reader、reconnect cursor、F1/F2 integration tests
- **为什么必须确认**：如果 framing 不冻结，F1/F2 会在 NDJSON、SSE-like、custom JSON chunk 三种形态间漂移。
- **当前建议 / 倾向**：**冻结为 `HTTP streaming + application/x-ndjson`，并采用 `meta` / `event` / `terminal` 三类 frame。**
- **Reasoning**：这个问题会出现，是因为 r2 虽然已经拍板“HTTP streaming response”，但还没有把 framing 层写成唯一真相。当前推荐路线更稳，是因为 NDJSON 简单、可调试、与 fetch/Readable body 心智一致，而且非常适合 first-wave 的 worker-to-worker relay。如果现在不拍板，stream relay 会成为 F1/F2 最大的返工点，尤其是在 reconnect、terminal 语义、日志诊断上。

- **Opus的对问题的分解**：本题涉及 3 个层面：(a) wire format 选择 —— NDJSON / SSE(`text/event-stream`) / JSON-array stream / binary；(b) frame taxonomy —— `meta/event/terminal` 三类是否足够，以及 `event` 是否需要再分支；(c) type-level 精度 —— `seq` 是 `number` / `string`？`payload` 是 `unknown` / NACP schema？`terminal: "ended"` 与 lifecycle `status: "ended"` 词汇重叠如何消歧。
- **Opus的对GPT推荐线路的分析**：NDJSON 是三个 wire format 里**最契合当前 fetch transport 心智**的选择。优点：(1) 与 `Response.body` + `TextDecoderStream` + line-buffer 的 Web Stream API 直接兼容；(2) 不需要 SSE 特有的 `data:` / `id:` / `retry:` prefix 语义；(3) debug / `curl` 查看极简单。三类 frame taxonomy 在 first-wave 够用 —— `meta`（stream-open handshake）/ `event`（业务）/ `terminal`（关闭原因）覆盖 90% 场景。**真实问题** 是我在 Opus R2/R4/R5 提的三处技术细节：wire format 冻结但 TS 类型 / seq 语义 / terminal 词汇这三条歧义未同时冻结，F1.C first event relay 实现时必然重新 invent。
- **Opus的最终回答**：**同意冻结 NDJSON + meta/event/terminal 作为 frozen wire baseline**。但 F0 collapse 前必须在 `F0-stream-relay-mechanism.md` §7.2 同批补齐 4 条技术细节：(1) 加 TypeScript discriminated union（`type StreamFrame = MetaFrame | EventFrame | TerminalFrame`，以 `kind` 为 discriminator）；(2) `seq: number`（非负整数，单调递增，初始 0）；(3) `EventFrame.payload` 类型对应 `@haimang/nacp-session::SessionStreamEventBody`（避免 `unknown`）；(4) **重命名** `terminal: "ended"` 为 `terminal: "session_end"`（或直接去掉这一选项，让 `completed / cancelled / error` 三选一）—— 消除与 lifecycle `status: "ended"` 的词汇冲突（见 Opus R5）。Content-Type 明确为 `application/x-ndjson`。

- **问题**：`first-wave internal stream framing 是否确认采用 NDJSON 三类 frame？如果不同意，请明确替代 wire shape。`
- **业主回答**：同意，与Opus的建议相同。

---

## 2. Session Registry / Reconnect

### Q3 — first-wave 是否确认采用“single active writable attachment”作为默认 attach/reconnect 规则？（来源：`F0-session-lifecycle-and-reconnect.md`）

- **影响范围**：public WS attach、reconnect、user DO registry、F2 tests
- **为什么必须确认**：如果不确认，多 tab / 多 attachment 的行为会在实现时继续模糊，F2 容易陷入无休止 edge-case 讨论。
- **当前建议 / 倾向**：**确认 single active writable attachment**；新 attachment 可接管旧 attachment，multi-tab richer 行为延后。
- **Reasoning**：这个问题会出现，是因为 façade 接管 public WS 后，必须有人回答“一个 session 到底允许几个活跃客户端同时写”。当前推荐路线更稳，是因为它把 first-wave 问题降到最可控：只有一个写者、一个当前 relay owner，旧连接被 supersede。如果现在不拍板，F2 的 attach/reconnect 代码会在“是不是要支持多 tab 并发写”上失控，测试也会失去明确验收边界。

- **Opus的对问题的分解**：题目有 4 个子问题：(a) 每个 session 允许的并发 attachment 数 —— 1 / N；(b) attachment 类型 —— writable / read-only mirror 是否分离；(c) 新 attachment 到来时旧 attachment 的命运 —— superseded / 拒绝新的；(d) superseded 的旧 attachment 如何通知 client（静默断开 vs typed close message）。
- **Opus的对GPT推荐线路的分析**：single active writable attachment + superseded 旧的，是 first-wave 的正确克制点。原因：(1) 现有 `workers/agent-core/src/host/ws-controller.ts` 本就只支持 per-session 单连接心智，多 attachment 会要求重写 WS session 管理；(2) 多写者必然触发并发 turn 提交的竞争条件（`NanoSessionDO.dispatchAdmissibleFrame` 已有 `turn_running` 单活跃 turn 约束，多写会与之冲突）；(3) superseded 而非拒绝新连接，让 client 重连不需要用户手动刷新 —— 这是 UX 的 strong default。**GPT 推荐漏掉一点**：没说 superseded 的旧 attachment 如何被通知关闭。静默断开会让 client 以为是网络抖动重连，陷入循环。
- **Opus的最终回答**：**同意 single active writable attachment + superseded 模式**，但在 `F0-session-lifecycle-and-reconnect.md` §7.2 F2 补 2 条：(1) superseded 的旧 attachment 必须收到一条 typed close message `{ kind: "attachment_superseded", reason: "replaced_by_new_attachment", new_attachment_at: <timestamp> }`，然后 server 主动关闭 WS（而非让 client 误以为是网络断开）；(2) read-only mirror attachment **明确延后**到下一阶段 richer orchestrator charter，first-wave 不做。另：terminal session 不允许新 attach，WS upgrade 直接返回 typed `{ error: "session_terminal", terminal: <reason> }`（与 lifecycle 状态机一致）。

- **问题**：`first-wave attach/reconnect 是否确认 single active writable attachment？如果不同意，请明确是多写者还是读写分离模型。`
- **业主回答**：同意，与Opus的建议相同。

### Q4 — ended session 的 recent metadata 是否允许 bounded 保留窗口？（来源：`F0-user-do-schema.md`）

- **影响范围**：user DO schema、registry cleanup、terminal session status/timeline 行为
- **为什么必须确认**：如果不确认，`active_sessions` 是只保活跃中，还是允许短期保留 ended metadata，会直接影响 schema 与 cleanup 设计。
- **当前建议 / 倾向**：**允许 bounded recent-ended metadata**，例如时间窗口或数量窗口；不做 full archive。
- **Reasoning**：这个问题会出现，是因为 first-wave 既不想引入完整 history domain，又不能在 session 一结束就把一切事实抹掉，否则状态读取、错误诊断、刚结束后的查询都会变得困难。当前推荐路线更稳，是因为它只保留少量、短期、最小必要的 terminal metadata，既能支撑实际使用，又不会把 user DO 拉成 history store。如果现在不拍板，schema 与 lifecycle 文档会一直停留在“可能 purge / 也可能保留”的模糊状态。

- **Opus的对问题的分解**：本题 3 个子问题：(a) ended session 是否立即 purge —— 必要性在于 reconnect window 内的 typed terminal response、post-mortem diagnostics、status/timeline 只读查询；(b) retention policy 维度 —— 时间窗 / 数量窗 / 双上限；(c) 窗口大小 —— 时间若选 1h / 24h / 7d，数量若选 20 / 100 / 500。
- **Opus的对GPT推荐线路的分析**：bounded retention 是对的；单纯时间窗或单纯数量窗都有病：(1) 只用时间窗 —— 一个狂用 agent 的 user 24h 内可能 ended 几千 session，DO storage 膨胀失控；(2) 只用数量窗 —— 一个偶尔用的 user 保留的老 session 可能是几个月前的，reconnect `timeline` 查旧 session 没有业务价值。GPT 说 "time or count window" 让 owner 二选一，但实际应是**两者叠加**（whichever comes first purge）。
- **Opus的最终回答**：**同意 bounded retention，但推荐时间 + 数量双上限 policy**，具体：(1) 时间窗：`ended_at + 24h` TTL；(2) 数量窗：每 user 最多保留 100 个 ended sessions；(3) 超过任一上限时 purge `ended_at` 最早的那一批 ended sessions；(4) 上限**不影响** `active / detached / starting / minted` 状态的 sessions（这些受 lifecycle 管，不受 retention 管）；(5) purge 操作可以是 lazy（读 registry 时顺手清）或 alarm-triggered，具体机制留给 F1 实现。在 `F0-user-do-schema.md` §7.2 F2 retention 小节把这 5 点写进去即可。

- **问题**：`first-wave 是否允许 bounded recent-ended metadata 保留？如果允许，请确认更倾向时间窗口还是数量窗口。`
- **业主回答**：同意，与Opus的建议相同。

---

## 3. Tenant Truth / Authority Law

### Q5 — preview / prod 是否明确要求显式配置 `TEAM_UUID`，不得继续依赖 `_unknown` fallback？（来源：`F4-authority-policy-layer.md`、`docs/plan-orchestration-facade.md`）

- **影响范围**：wrangler config、preview deploy、tenant law、negative tests
- **为什么必须确认**：如果不拍板，single-tenant-per-deploy 仍会停留在“概念上同意、配置上没落实”的状态。
- **当前建议 / 倾向**：**确认 preview / prod 必须显式配置 `TEAM_UUID`**；`_unknown` 只允许本地或测试兜底。
- **Reasoning**：这个问题会出现，是因为当前运行时代码已经把 `TEAM_UUID` 当成 tenant truth，但 preview wrangler 现实里还没显式提供它。当前推荐路线更稳，是因为它把“first-wave tenant truth = single-tenant-per-deploy”从纸面设计变成真实 deploy discipline。如果现在不拍板，F4.A 的 authority law 会变成半真半假：代码看起来有 tenant 边界，实际 preview 却可能继续跑在 `_unknown` 上。

- **Opus的对问题的分解**：题目的 3 个子问题：(a) wrangler 层面是否要求所有 worker `wrangler.jsonc` 的 `vars` 里必须写 `TEAM_UUID`；(b) runtime 层面：`env.TEAM_UUID` 缺失时的行为 —— 现状代码（`workers/agent-core/src/host/do/nano-session-do.ts:817-819`）是 fallback 到 `_unknown`，是否收紧为 throw / fail fast；(c) local / test env 的豁免语义 —— 用 `env.ENVIRONMENT === "test"` 判断还是用独立 flag。
- **Opus的对GPT推荐线路的分析**：同意方向。`_unknown` fallback 是 B9 tenant wrapper 在 worker-matrix 阶段的 bootstrap-time 保险机制（让空 env 的 vitest 能跑），它**不应** 成为 preview/prod 的真相。GPT 推荐正确。但 GPT 没说具体校验时机 —— 是 worker bootstrap 就 throw（fail fast），还是每次 DO 构造时 throw，还是第一次 `verifyTenantBoundary` 调用时 throw。我推荐 fail fast：deploy-time 或 worker module load 时校验，越早越好，避免冷启动后第一次请求才 500。
- **Opus的最终回答**：**同意强制配置**。落地方式：(1) 4 个现有 worker + 新 orchestrator-core 的 `wrangler.jsonc` 在 `env.preview.vars` 和 `env.prod.vars`（prod 未来）显式写 `TEAM_UUID: "<canonical-tenant-id>"`；(2) `workers/*/src/index.ts` 的 `worker.fetch()` 入口加一次 bootstrap check：`if (!env.TEAM_UUID && env.ENVIRONMENT !== "test") return new Response(..., { status: 503 })`（或 throw，让 CF runtime 显示 "worker misconfigured"）；(3) `buildIngressContext()` 当前的 `_unknown` fallback 分支保留但**仅在** `env.ENVIRONMENT === "test"` 时有效，否则在 step (2) 已被挡住；(4) F4.A 补一条 negative test：preview env 缺 `TEAM_UUID` → 503 rejection with typed body。在 `F4-authority-policy-layer.md` §7.2 F2 的 "边界情况" 表明确这 4 条。

- **问题**：`preview / prod 是否确认强制显式配置 TEAM_UUID？`
- **业主回答**：同意，与Opus的建议相同。

### Q6 — 当 JWT 中没有 `tenant_uuid` claim 时，first-wave 是否接受“用 deploy tenant truth 隐式补足”？（来源：`F4-authority-policy-layer.md`）

- **影响范围**：JWT ingress、tenant mismatch policy、F4 negative tests
- **为什么必须确认**：tenant claim 缺失到底是允许还是必须报错，会直接影响 public ingress policy helper。
- **当前建议 / 倾向**：**允许 claim 缺失，但如果 claim 存在则必须与 `TEAM_UUID` 一致。**
- **Reasoning**：这个问题会出现，是因为 first-wave 同时存在两个事实：一方面 current runtime 以 deploy-level tenant truth 为主，另一方面 façade 又会处理 JWT。当前推荐路线更稳，是因为它与“single-tenant-per-deploy”一致：tenant 真相仍来自部署，claim 只是附加验证，而不是唯一来源。如果现在不拍板，JWT policy helper 在实现时要么过严（逼所有 token 都带 tenant），要么过松（claim mismatch 也不管），两边都容易出问题。

- **Opus的对问题的分解**：本题 3 子问题：(a) claim 完全缺失时 —— reject（严）/ 用 `env.TEAM_UUID` 隐式补足（宽）；(b) claim 存在但与 `env.TEAM_UUID` 不等时 —— reject（严，`tenant-mismatch` 语义清晰）/ 警告后放行（宽，多 tenant 向后兼容）；(c) audit trail 要求 —— `last_auth_snapshot.tenant_uuid` 记什么（claim 原值 vs env 真值 vs 两者都记）。
- **Opus的对GPT推荐线路的分析**：GPT 推荐 "缺失放行（implicit fill），存在则 mismatch reject" 与 single-tenant-per-deploy（Q5）口径完全一致。现实考虑：(1) first-wave 的 client（contexter SaaS 或 smind CRM 接入端）发 JWT 时不一定带 `tenant_uuid` claim，如果严 reject 会导致接入门槛抬升；(2) 如果有人在 JWT 里写 `tenant_uuid` 且与部署 tenant 不等，这是非常明确的错误意图，应 reject。**GPT 推荐的盲点**：没说 `last_auth_snapshot.tenant_uuid` 在 implicit fill 情况下记什么 —— 如果记 env 真值，则审计看不到"这个 user 带没带 claim"；如果记 null，后续 query 不方便。
- **Opus的最终回答**：**同意 "claim 可缺失，存在则 mismatch reject"** 路线。补 audit trail 细则：(1) JWT 有 `tenant_uuid` claim 且 == `env.TEAM_UUID` → pass，`last_auth_snapshot.tenant_uuid = <claim value>`；(2) JWT 有 claim 且 ≠ `env.TEAM_UUID` → typed reject `{ error: "tenant-mismatch", expected: <env.TEAM_UUID>, got: <claim> }`（expected/got 仅在内部日志，不回给 client）；(3) JWT 无 claim → implicit pass，`last_auth_snapshot.tenant_uuid = env.TEAM_UUID`，同时 snapshot 加一个 `last_auth_snapshot.tenant_source: "deploy-fill" | "claim"`（让审计可区分是 implicit 还是显式）；(4) 这个 policy 明确只在 **single-tenant-per-deploy** 成立，future multi-tenant charter 启动时必须 revisit —— 在 `F4-authority-policy-layer.md` §7.2 F1 的 "边界情况" 补一句"多 tenant charter 必须 revisit"。

- **问题**：`first-wave 是否确认“tenant claim 可缺失，但若存在必须匹配 TEAM_UUID”？`
- **业主回答**：同意，与Opus的建议相同。

---

## 4. Cutover / Testing Strategy

### Q7 — legacy `agent.core` session routes 是否在 F3 exit 后立即进入 hard deprecation，而不是再保留一个 post-F3 grace window？（来源：`F0-compatibility-facade-contract.md`）

- **影响范围**：F3 cutover、legacy route behavior、closure criterion #2
- **为什么必须确认**：如果 F3 exit 后还留额外 grace window，canonical ingress 的定义会再次变模糊。
- **当前建议 / 倾向**：**F3 exit 后立即 hard deprecate**；迁移窗口只存在于 F3 执行期。
- **Reasoning**：这个问题会出现，是因为工程上大家都喜欢给 legacy 路由“再多留一点保险时间”，但本阶段真正要修的正是 dual-ingress tech debt。当前推荐路线更稳，是因为它把迁移窗口限制在执行阶段内部，而不是让“临时兼容”再次变成常态。如果现在不拍板，F3 closure 很容易写成“理论上切换完成，但 legacy path 还在跑”，那 canonical ingress 就仍然没有真正成立。

- **Opus的对问题的分解**：本题有 3 个子问题：(a) "F3 exit" 的判定条件 —— 何时算 F3 真正关闭？（F3-closure memo 产出时 / orchestrator live E2E 全绿时 / legacy 410 negative test 也绿时？）；(b) "立即" 的实现动作 —— 是同一个 PR 里把 legacy 200 翻转为 410，还是分两次 PR（先 add Deprecation header，再翻 410）；(c) grace window 的真实需求方 —— 外部 client / 内部测试 harness / deploy verification；这三类分别是否有 grace 需求。
- **Opus的对GPT推荐线路的分析**：同意"立即 hard deprecate"。理由：(1) 本阶段唯一要修的就是 dual-ingress tech-debt，留 grace 等于承认 dual-ingress 合理；(2) 现有 26 个测试文件里，只有 12 个走 `/sessions/:id/*`（F0-live-e2e-migration-inventory §7.2 F1 已列清），迁移面可控；(3) 外部 client：first-wave 实质还没有 prod client，grace 对谁都不服务；(4) 内部测试 harness 会随 F3.B 一起迁，不需要 grace；(5) deploy verification 用 `GET /` probe 不受影响（probe 不在 legacy 范围内）。**GPT 漏掉的**：没说 "立即" 是分 2 次 PR 还是同 PR 翻转 —— 分 2 次会有一个中间态 "Deprecation header 但还是 200"，容易让 reviewer / owner 误判 F3 已完成。
- **Opus的最终回答**：**同意立即 hard deprecate，无 grace window**。精化 3 条：(1) "F3 exit" 明确定义 = F3-closure memo 产出 + orchestrator-core live E2E 全绿 + legacy 410 negative test 也绿，三条同时满足；(2) "立即" = 同一个 PR 里翻转 agent.core legacy session routes 从 200 到 410（不分 2 次 PR），避免中间状态；(3) body shape 按我 Opus R7 建议：`{ error: "gone", canonical_public: "https://<orchestrator>/sessions/:id", message: "agent-core session surface retired, please use orchestrator-core canonical public ingress" }`，Content-Type `application/json`，HTTP 410。WS upgrade `/sessions/:id/ws` 直接 HTTP 426 + 同样的 canonical hint body（不升级 WS）。(4) `GET /` / `GET /health` probe **不受影响**，继续保留（§6.3 纪律）。在 `F0-compatibility-facade-contract.md` §7.2 F2 加这 4 条。

- **问题**：`是否确认 F3 exit 后 legacy session routes 立即 hard deprecate，不再保留额外 grace window？`
- **业主回答**：同意，与Opus的建议相同。

### Q8 — F3 测试迁移是否确认采用“新增 `test/package-e2e/orchestrator-core/`”作为推荐路径？（来源：`F0-live-e2e-migration-inventory.md`）

- **影响范围**：test tree、live harness、`test/INDEX.md`、F3 action-plan
- **为什么必须确认**：如果不拍板，F3 会在“原地改 agent-core 测试”与“新增 orchestrator-core suite”之间反复摇摆。
- **当前建议 / 倾向**：**确认新增 `test/package-e2e/orchestrator-core/` 作为 canonical public suite**；agent-core 保留 probe/internal verification tests。
- **Reasoning**：这个问题会出现，是因为 canonical public owner 已经从 `agent.core` 变成 `orchestrator.core`，而测试树理应同步表达这件事。当前推荐路线更稳，是因为它让目录结构本身就说出架构真相：public suite 属于 orchestrator，agent-core 的 package-e2e 回到 internal/probe/posture 验证。如果现在不拍板，F3 迁移会既改路径又不改结构，最后人和文档仍会把 agent-core 当默认 public worker。

- **Opus的对问题的分解**：3 子问题：(a) 目录结构 —— 新建 `test/package-e2e/orchestrator-core/` vs 在原 `test/package-e2e/agent-core/02-06` 上原地改 URL；(b) 原有 agent-core session-facing 测试的命运 —— 删除 / 迁移 / 降级为 internal verification；(c) `test/cross-e2e/*` 是否也同步新增 orchestrator 入口目录（现有 cross-e2e 是跨 worker 的,不是按 worker 分目录）。
- **Opus的对GPT推荐线路的分析**：同意新增 orchestrator-core 目录。理由：(1) **测试树结构是架构真相的映射** —— canonical public owner 从 agent.core 变成 orchestrator.core，目录结构必须同步表达，否则后续维护者一看 `package-e2e/agent-core/` 会以为 agent-core 仍是 public edge；(2) 原地改 URL 风险高 —— 10 个 subtests 挤在 `agent-core/02-06` 同一目录，混合了 public 切换 + internal verification 两种职责，review 时难区分；(3) 新建目录后 agent-core 的保留文件职责更纯（只做 probe / internal verification）。**GPT 遗漏**：没说 `test/cross-e2e/*` 的处理 —— 按现状 cross-e2e 是 "多 worker 协作" 场景，保持在 `cross-e2e/` 即可但入口要从 agent-core URL 改到 orchestrator URL；是否需要引入 `cross-e2e/orchestrator-*` 子目录前缀可以讨论，但我倾向不必（cross 本就是跨 worker 概念）。
- **Opus的最终回答**：**同意新增 `test/package-e2e/orchestrator-core/`**。具体落地：(1) 新建目录含 7 个初始文件：`01-preview-probe` / `02-session-start` / `03-ws-attach` / `04-reconnect` / `05-verify-status-timeline` / `06-auth-negative`（JWT invalid/missing）/ `07-legacy-agent-retirement`（assert agent.core 旧入口已 retire）；(2) 现有 agent-core 的文件去留 —— `02-session-edge` / `04-session-lifecycle` / `05-multi-turn-input` / `06-verify-unknown-check` 按 F0-live-e2e-migration-inventory §7.2 F1 逐字搬到 orchestrator-core（改 URL + 加 JWT harness）；`03-initial-context-smoke` 合并进 orchestrator-core `02-session-start` 的 subtest；原 agent-core 文件删除，不留 ghost；(3) `test/cross-e2e/02,03,04,05,06,08,09` 入口 URL 从 `agent-core` 改到 `orchestrator-core`，**保持在 cross-e2e/ 目录**（cross 天然跨 worker，目录不需要拆）；(4) `test/shared/live.mjs` 新增 `NANO_AGENT_ORCHESTRATOR_CORE_URL` env 与 default preview URL；(5) `test/INDEX.md` 一次性更新到 v0.3。在 `F0-live-e2e-migration-inventory.md` §7.2 F2 补这 5 条。

- **问题**：`F3 是否确认新增 orchestrator-core package-e2e suite，而不是只在 agent-core 原文件上原地改 URL？`
- **业主回答**：同意，与Opus的建议相同。

---

## 5. 使用约束

### 5.1 哪些问题应该进入 QNA

- **会直接改变 contract surface、实现边界、执行顺序、验收标准或支持面披露的问题**
- **需要业主 / 架构师拍板，而不是实现阶段自己就能收敛的技术细节**
- **如果不先拍板，就会导致多个后续文档一起漂移的问题**

### 5.2 哪些问题不应进入 QNA

- **实现细节微调**：例如单个文件内的 helper 命名、局部 refactor 手法
- **已有 frozen answer 的重复提问**：除非本次要正式推翻旧答案
- **只影响单个函数或单个包内部实现、不会改变阶段治理边界的问题**

### 5.3 `Reasoning` 的写法要求

- 要写给**非项目作者、但需要做决策的人**
- 要解释：
  1. **这个问题为什么会出现**
  2. **为什么当前推荐路线更稳**
  3. **如果不拍板，会导致什么工程或业务后果**
- 避免只写“建议这样做”，而不解释其背后的 trade-off

### 5.4 `问题` 的写法要求

- 必须是**业主可以直接作答**的句子
- 尽量避免把多个独立决策捆成一题
- 若问题天然包含两个子决策，需在问题里明确写出“如果确认，请同时回答 X / Y”

### 5.5 `业主回答` 的使用要求

- 业主回答应尽量简洁、明确、可执行
- 一旦填写，应同步成为后续 design / action-plan / review 的唯一口径
- 如果后续要推翻答案，应在同一份 QNA 中追加修订说明，而不是在别处悄悄改口
