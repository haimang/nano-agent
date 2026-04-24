# Nano-Agent 代码审查模板

> 审查对象: `orchestration-facade / F0 + F1 + F2`
> 审查时间: `2026-04-24`
> 审查人: `DeepSeek v4 Pro`
> 审查范围:
> - `docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md` + 工作日志
> - `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md` + 工作日志
> - `docs/action-plan/orchestration-facade/F2-session-seam-completion.md` + 工作日志
> - `docs/issue/orchestration-facade/F0-closure.md`
> - `docs/issue/orchestration-facade/F1-closure.md`
> - `docs/issue/orchestration-facade/F2-closure.md`
> - `docs/design/orchestration-facade/F0-*.md`（8 份 design docs）
> - `docs/design/orchestration-facade/FX-qna.md`
> - `docs/plan-orchestration-facade.md`（charter）
> - `workers/orchestrator-core/src/index.ts`
> - `workers/orchestrator-core/src/user-do.ts`
> - `workers/orchestrator-core/src/auth.ts`
> - `workers/orchestrator-core/test/smoke.test.ts`
> - `workers/orchestrator-core/test/user-do.test.ts`
> - `workers/agent-core/src/index.ts`
> - `workers/agent-core/src/host/internal.ts`
> - `context/smind-contexter/core/jwt.ts`
> - `context/smind-contexter/src/chat.ts`
> - `context/smind-contexter/src/engine_do.ts`
> - `test/package-e2e/orchestrator-core/01-05.test.mjs`
> - `test/shared/live.mjs`
> 文档状态: `reviewed`

---

## 0. 总结结论

> 实现主体成立，但 F1/F2 的 closure 声明中存在对 "first event relay" 与 "live stream" 的关键歧义未消解。本轮不应推翻 F0~F2 已闭合的工作，但必须在下游阶段启动前把 stream relay 的真实能力边界写清楚。

- **整体判断**：F0 的 design freeze 可作为有效 baseline，F1/F2 代码实现了 claimed surface（7 条 public routes、lifecycle states、retention、WS attach/reconnect），但内部 NDJSON stream 的实现本质是 **timeline snapshot relay**（读取已完成 session 的 timeline），而非 design doc 所预设的 real-time / live stream relay。closure 文件中"first event relay"的表述过度暗示了 live relay 已知，且 F2 闭口文中"不再只是 narrow roundtrip"的宣告在 stream 层面未落实。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. F1/F2 closure 文档中"first event relay 已打通"的宣告，其技术实质是 **post-hoc timeline snapshot relay**，并非 design doc §6.2 所描述的 `agent.core` → `orchestrator.core` live NDJSON 流。这一差异不应被 closure 文件的措辞掩盖，否则 F2/F3 以"完整 session seam"为基座推进 cutover 时，会在长会话连线上重新撞墙。
  2. `minted` 状态在类型系统中已定义（`SessionStatus = 'minted' | 'starting' | 'active' | 'detached' | 'ended'`），但在 user DO 的 `handleStart` 中从未被写入 —— start 请求到达时直接写入 `status: 'starting'`。这会误导后续阅读代码的人以为存在一条 minted → starting 的显式状态转移路径。
  3. `forwardInternalStream()` 在 agent-core 侧以 timeline + status 的合成方式构造 NDJSON，它对待 real-time live session 的能力有结构性局限：agent 在 turn-running 中时，stream 只能返回"当前无业务事件"（phase 不为 `turn_running` 时直接塞 terminal frame），而 session 真正 live 事件产生后再调用 `/stream` 才能看到完整记录。这意味着当前实现对长会话的 relay 模型本质是 **轮询**，不是推送。

---

## 1. 审查方法与已核实事实

> 这一节只写事实，不写结论。
> 明确你看了哪些文件、跑了哪些命令、核对了哪些计划项/设计项。

- **对照文档**：
  - `docs/plan-orchestration-facade.md`（charter r2，§1.7/§6.2/§10.1/§11.1-11.3）
  - `docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`（含 §11 工作日志）
  - `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`（含 §11 工作日志）
  - `docs/action-plan/orchestration-facade/F2-session-seam-completion.md`（含 §11 工作日志）
  - `docs/design/orchestration-facade/FX-qna.md`（Q1-Q8 `业主回答` 全部已回填）
  - `docs/design/orchestration-facade/F0-*`（8 份 design docs，均已标记 `frozen`）
  - `docs/issue/orchestration-facade/F0-closure.md` / `F1-closure.md` / `F2-closure.md`
- **核查实现**：
  - `workers/orchestrator-core/src/index.ts`（127 行）
  - `workers/orchestrator-core/src/user-do.ts`（660 行）
  - `workers/orchestrator-core/src/auth.ts`（184 行）
  - `workers/agent-core/src/host/internal.ts`（178 行）
  - `workers/agent-core/src/index.ts`（74 行）
  - `workers/orchestrator-core/test/smoke.test.ts`（102 行）
  - `workers/orchestrator-core/test/user-do.test.ts`（322 行）
  - `test/package-e2e/orchestrator-core/01-05.test.mjs`（5 份 live test）
  - `context/smind-contexter/core/jwt.ts` / `src/chat.ts` / `src/engine_do.ts`
- **执行过的验证**：
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck`
  - `pnpm --filter @haimang/orchestrator-core-worker build`
  - `pnpm --filter @haimang/orchestrator-core-worker test`
  - `pnpm --filter @haimang/agent-core-worker typecheck`
  - `pnpm --filter @haimang/agent-core-worker build`
  - `pnpm --filter @haimang/agent-core-worker test`
  - `pnpm test:package-e2e`
  - `pnpm test:cross`

### 1.1 已确认的正面事实

- 8 份 design doc 均已在 F0 完成从 `draft` → `frozen` 的状态翻转，与 FX-qna.md Q1-Q8 的 `业主回答` 形成了可追溯的证据口径。
- `workers/orchestrator-core/` 作为全新 worker 资产已经完整落地：package.json / tsconfig.json / wrangler.jsonc / src / test / README，并且已纳入 CI workflow（`workers.yml`）和 pnpm workspace。
- `agent-core` 的 `routeInternal()` 正确采用了 `index.ts` 中的**早退**策略（`pathname.startsWith("/internal/")` 优先于 legacy `routeRequest()`），避免了复用 legacy parser 的风险。
- internal auth gate 实现了 typed `401 invalid-internal-auth`，与 F0 design 和 FX-qna Q1 完全对齐，secret 缺失/不匹配均可被断言。
- user DO 的 WS supersede 逻辑执行了正确的顺序：先从 `attachments` Map 移除旧 socket → 发送 `attachment_superseded` → `close(4001)`，避免了 work log 中提到的旧 close 回调误伤新 attachment 的 bug。
- ended session retention 采用 `24h 时间窗 + 100 数量窗` 双上限 lazy cleanup，与 FX-qna Q4 的 Opus 回答一致。
- `test/package-e2e/orchestrator-core/` 的 5 份 live test 均已通过（`29/29` package-e2e, `40/40` cross-e2e）。
- public route family 的 7 条路径（start/input/cancel/status/timeline/verify/ws）全部由 `orchestrator-core` 接管，与 charter §1.5 和 compatibility-facade contract §7.1 F1 一致。
- `ensureTenantConfigured` 在 `index.ts` 中正确采用 `env.ENVIRONMENT !== "test"` 作为豁免条件，与 FX-qna Q5 的 Opus 回答一致。

### 1.2 已确认的负面事实

- agent-core 的 `forwardInternalStream()` 并非实时流通道。它先调用 `SESSION_DO.fetch('/sessions/:id/timeline')` 获取 timeline 快照，再调 `SESSION_DO.fetch('/sessions/:id/status')` 获取状态快照，然后按 `phase !== "turn_running"` 的条件判断是否附加 terminal frame。这是 **snapshot assembly**，不是 **live stream relay**。在 design doc `F0-stream-relay-mechanism.md` §6.2 和 FX-qna Q2 中，stream 被明确定义为 `agent -> orchestrator` 的 HTTP streaming response with NDJSON framing，且三类 frame（meta/event/terminal）应为运行时的自然产出，而非事后合成。
- `SessionEntry.status` 的 TypeScript union 类型包含 `'minted'`，但 `handleStart` 中从未写入该状态。entry 的第一个写入值即为 `status: 'starting'`。然而 F1 action-plan §4.2 P2-02 和 F2 closure §4.3 均未提及 `minted` 状态在 F1/F2 的 scope 中未被实现。
- `handleWsAttach` 在完成 supersede 和 new attachment 注册后，调用 `readInternalStream(sessionUuid)` 读取 `/internal/stream` 的 NDJSON 帧并 relay 给新 WS client。这个模型意味着：**WS client 只会在 attach 时收到一次 timeline snapshot relay，此后不会再收到 agent 产生的后续事件**。对于已经完成的 session（如所有 live test 的测试场景）这是足够的；但对于仍在 `turn_running` 的 live session，后续事件不会被 relay。
- `orchestrator-core/src/auth.ts` 的 JWT 实现（HS256、base64url、verifyJwt、signJwt）与 `context/smind-contexter/core/jwt.ts` 的结构高度同构——相同的函数名、相同的验证流程、相同的 base64url 工具——但它是完全 rewrite 的，未从 contexter 直接引用任何代码。F0 contexter absorption inventory 对 `core/jwt.ts` 给出的 label 是 `adopt-as-is (light adaptation)`，实际执行是 full reimplementation。

---

## 2. 审查发现

> 使用稳定编号：`R1 / R2 / R3 ...`
> 每条 finding 都应包含：严重级别、事实依据、为什么重要、审查判断。
> 只写真正影响 correctness / security / scope / delivery 的问题，不写样式意见。

### R1. Stream relay 是 snapshot relay，不是 design doc 所定义的 live relay

- **严重级别**：`critical`
- **类型**：`scope-drift`
- **事实依据**：
  - `workers/agent-core/src/host/internal.ts:95-148` — `forwardInternalStream()` 通过 `SESSION_DO.fetch('/sessions/:id/timeline')` 和 `SESSION_DO.fetch('/sessions/:id/status')` 读取已完成数据，再手写 NDJSON encoder 输出 `meta/event/terminal` frames。
  - `docs/design/orchestration-facade/F0-stream-relay-mechanism.md` §6.2 — 明确将 relay stream 定义为 agent-core 向 orchestrator-core 发送的实时事件流，并指出 framing 应使用 `meta` / `event` / `terminal` 三类 frame，其中 `event` 是"承载 session stream event"的 live 业务帧。
  - `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md` P4-01 — 要求"让 orchestrator user DO 读取 StreamFrame，至少消费 meta 与 first event"，暗示 first event 来自运行中的流。
  - `workers/orchestrator-core/src/user-do.ts:276` — `handleStart` 在 POST start 到 agent DO（完成同步处理）后，调用 `readInternalStream(sessionUuid)` 读取 `/internal/stream` 的 NDJSON。此时 agent DO 已完成 `start` 的同步处理，所以能读到完整的 timeline snapshot，但这**被误等价为"first event relay 已打通"**。
- **为什么重要**：
  - F1 closure 和 F2 closure 的关键 argument —— "系统第一次拥有了 façade-owned public start path 与 guarded internal runtime seam"、"no longer just a narrow roundtrip" —— 都建立在此 relay 已当作 live stream 被验证的前提上。
  - 如果 agent-core 的 `/internal/stream` 实际上是轮询式读取已完成 session 的 timeline snapshot，那么 WS attach 所 relay 的也不会是后续 live 事件。这将直接影响 F2 所声称的"实时 relay"可信度，以及 F3 cutover 时对长会话、断线续传、turn-by-turn 事件的真实验证能力。
  - F1 action-plan 本身严格限定了 scope（只做 narrow roundtrip），因此 snapshot relay 在 F1 范围内**作为 first-roundtrip proof 是合理的**。问题出在 F2 closure 没有诚实交代这一限制，而是用"完整 session seam"的语言暗示了一个尚不存在的 live relay。
- **审查判断**：
  - 这不是 bug，而是**scope 声明与实现实质之间的歧义**。
  - F1 的 narrow roundtrip proof 可以用 snapshot relay 满足；但 F2 在宣称"完整 seam"时，必须显式声明：当前 `/internal/stream` 是一种 **timeline-snapshot-over-NDJSON** 实现，尚未支持 real-time event push。否则 F3 cutover 将以错误的 live relay 预期启动。
- **建议修法**：
  1. 在 `F2-closure.md` 追加一段已知限制声明："当前 `/internal/stream` 是 timeline snapshot relay，支持 post-hoc 事件读取；real-time push relay 是下一阶段 richer relay 的议题，不在 F1/F2 scope 内。"
  2. 在 `workers/agent-core/src/host/internal.ts:95` 上方加一行文档注释："// first-wave snapshot-based relay; reads completed timeline events, not real-time push."
  3. F3 action-plan 中明确区分：当前已实现的 `snapshot relay` 与 design doc 预设的 `live relay`，并为 live relay 规划独立的实现 phase。

### R2. `minted` 生命周期状态在类型中定义但从未在实现中写入

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:16` — `SessionStatus = 'minted' | 'starting' | 'active' | 'detached' | 'ended'`
  - `workers/orchestrator-core/src/user-do.ts:249-256` — `handleStart` 首次写入 session entry 时，`status: 'starting'`，从未写入 `'minted'`。
  - `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md` §4.3 — charter 中 lifecycle 表明确列出了 `minted` 阶段："生成 session_uuid，写入 user DO registry，尚未启动 runtime"。
  - `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md` 的实际交付和 work log 中未提及此 gap。
- **为什么重要**：
  - 如果 `minted` 只是类型上的占位符而从未被写入，那么 session 的"已创建但未启动"状态就不存在，这会误导后续接手的人以为存在一个 minted → starting 的显式边界。
  - 在 `handleStart` 实现中，`session_uuid` 的解析发生在 worker `index.ts` 的路由层（client 自行提供），而非 DO 内创建。因此 "minted = 生成 UUID 并写入 registry" 在当前架构下**不可能由 orchestrator DO 实现**——UUID 是 client 在 URL 中传入的。
  - 这是一个设计假设（façade mint UUID）与实现现实（client 提供 UUID）之间的裂缝。
- **审查判断**：
  - `minted` 状态属于 charter §4.3 的设计遗产，在当前实现架构下不适用。应将其从类型声明和 lifecycle design doc 中移除，或明确标注为"当前阶段不实现的未来语义"。
- **建议修法**：
  1. 从 `SessionStatus` union 中移除 `'minted'`，或注释标注 `// reserved for future pre-start minting (当前阶段 client provides UUID)`。
  2. 在 `F0-session-lifecycle-and-reconnect.md` 的 lifecycle 表中给 `minted` 行加标注：`当前实现中 client 传 UUID，DO 直接进入 starting；minted 语义延后至 F3+`。

### R3. WS 附着后的事件 relay 是单次 snapshot，不构成 persistent relay

- **严重级别**：`high`
- **类型**：`scope-drift`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:440` — `handleWsAttach` 在建立新 attachment 后，调用一次 `readInternalStream(sessionUuid)` 读取 NDJSON snapshot 并 relay 给新 WS client，随后**没有持续监听内部流或建立持久 relay 连接的逻辑**。
  - `workers/orchestrator-core/src/user-do.ts:462-465` — `bindSocketLifecycle` 中的 message listener 只负责更新 session timestamp，不负责从 agent-core 拉取新事件并 relay。
  - F2 action-plan P3-01 收口标准要求"attach 成立，supersede 顺序稳定"——这在单次 snapshot relay 上成立。但 F2 closure §1 声称"orchestrator-core 现在不再只是能 start 一次的 façade，而是 first-wave 的完整 session owner"，这种语言暗示了持续的 live relay 能力。
  - 当前所有 5 份 live test 的 WS 测试均采用"先 start（等待完成后），再 attach"的模式（见 `03-ws-attach.test.mjs:58-63`、`04-reconnect.test.mjs:39-44`），因此测试无法暴露 "未完成的 session 在 WS attach 后收不到后续事件" 的问题。
- **为什么重要**：
  - 如果 WS attach 后无法持续 relay agent 的后续事件，那么 `orchestrator-core` 的 WS 只是"历史事件回放器"，不是"实时 relay owner"。
  - 这不是 F2 的 scope 问题——F2 明确在 §2.2 O1 中排除了 multi-writer / read-only mirror，但**没有**排除 persistent live relay；相反，它把"WS attach/reconnect"列为 in-scope (§2.1 S3) 并以"façade 成为 canonical attach owner"作为收口标准。
- **审查判断**：
  - F2 的 WS attach 实现满足了 single active writable attachment + supersede 的行为要求，达到了它的最低可收口标准（测试可断言 supersede / reconnect / terminal reject）。
  - 但对"WS relay owner"语义的完整性不足——当前 relay 的"持续"行为实际上依赖 agent-core 的短 request sync 完成（start 后立即完成，然后 attach 读一次 snapshot），不是真正的 persistent relay loop。
- **建议修法**：
  1. F2 closure 应补充一项已知限制："F2 WS attach 完成一次 session snapshot relay；agent 持续运行时的多次事件 push relay 不在 F2 scope（属于下一阶段 live stream/poll 增强），当前依赖 agent-core 的 short-sync session 模型保证功能可用。"
  2. `handleWsAttach` 的 `readInternalStream` 调用处添加注释说明这仍是 snapshot-based 的 relay 模型。

### R4. contexter JWT `adopt-as-is` 的实际交付是 full reimplementation

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `context/smind-contexter/core/jwt.ts` — 包含 `base64Url`、`importKey`、`verifyJwt`、`signJwt`，使用 HMAC-SHA256。
  - `workers/orchestrator-core/src/auth.ts` — 同样包含 `base64Url`、`importKey`、`verifyJwt`、`signJwt`，同样的算法、同样的错误处理模式，但代码是独立重写的，没有任何 import 自 contexter。
  - `docs/design/orchestration-facade/F0-contexter-absorption-inventory.md` — 对 `core/jwt.ts` 的 label 为 `adopt-as-is (light adaptation)`，迁入位置建议为 `orchestrator-core/src/adapters/jwt.ts`。
- **为什么重要**：
  - 如果 charter 和 design doc 声称某段代码是"adopt-as-is"，则 future review 或 audit 会预期代码有 direct lineage。实际的全量重写意味着没有可追溯的继承关系，且任何在 contexter jwt.ts 中后续修复的 bug 不会自动进入 orchestrator。
  - 就当前实现质量而言，独立重写的 jwt.ts 在功能上是正确的（HS256 签名验证与 contexter 一致），因此这不构成 correctness issue。但它在设计可追溯性上制造了虚假的继承链。
- **审查判断**：
  - 实现上可以接受（功能等价），但吸收策略的称谓应与事实对齐。建议将 label 从 `adopt-as-is` 改为 `adapt-pattern` 或 `reimplement-from-reference`。
- **建议修法**：
  1. 在 `F0-contexter-absorption-inventory.md` 中将 `core/jwt.ts` 的 label 修正为 `adapt-pattern (reimplemented)`，并注明：算法与接口签名继承自 contexter，代码为独立重写以适配 TypeScript / Cloudflare Workers 环境。
  2. 将 `orchestrator-core/src/auth.ts` 的文件内容与 `context/smind-contexter/core/jwt.ts` 的关系写入代码注释或 README。

### R5. StreamFrame 联合类型缺少完整的 discriminated union narrowing

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:66-69` — `StreamFrame` 类型定义为联合类型，以 `kind` 为 discriminator，但三个分支的字段约束不完全：`meta` 帧的 `seq` 被固定为 `0`（而非 `number`），`event` 帧要求 `seq: number` + `name: 'session.stream.event'` + `payload: Record<string, unknown>`，`terminal` 帧有 `terminal: TerminalKind`。
  - 该类型在 `readNdjsonFrames`（行 133-158）中使用，但返回值类型是 `StreamFrame[]`，实际运行时 `JSON.parse(line) as StreamFrame` 没有经过 Zod 或任何运行时校验。
  - FX-qna Q2 明确要求"TS 类型应以 `kind` 为 discriminator 的 discriminated union"，但当前实现中 `meta` 帧的 `seq` 字段被硬编码为字面量 `0` 而非 `number`，这在 TypeScript narrowing 上更精确，但可能限制未来的 `meta` 帧版本演进。
- **为什么重要**：
  - 当前实现依靠 agent-core 侧的 `forwardInternalStream` 作为唯一 NDJSON 生产者，因此 NDJSON frame shape 是内部可控的。但当将来引入外部事件源或多 worker relay 时，缺乏运行时校验的 frame 类型会成为隐藏 bug 源。
- **审查判断**：
  - 在 F1/F2 的 scope 内可接受（单 producer 场景）。但 F3 切为 canonical ingress 后，应考虑加入 Zod schema 校验以防御性解析。
- **建议修法**：
  1. 在 `readNdjsonFrames` 中对每行 `JSON.parse` 结果进行逐个 `kind` 字段的 discrimination 检查，对未知 `kind` 提供明确错误处理而非静默退回 `StreamFrame` 断言。
  2. 在 action-plan 或 FX-qna 的 follow-up 清单中增加一项"NDJSON Zod 运行时校验"。

---

## 3. In-Scope 逐项对齐审核

> 如果存在 action-plan / design doc，就必须有这一节。
> 结论统一使用：`done | partial | missing | out-of-scope-by-design`。

### F0 — Concrete Freeze Pack

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | P1-01: charter / design / qna 一致性审计 | `done` | 8 份 design doc 均已翻到 `frozen`，FX-qna Q1-Q8 已回填，无自相矛盾 |
| S2 | P1-02: review finding 分类 | `done` | DeepSeek/Opus review 的 close-out 附章已把 findings 分类为 absorbed / follow-up |
| S3 | P2-01: design wording 收口 | `done` | design pack 统一使用 freeze 语气，无残留 owner prompt |
| S4 | P2-02: charter 对齐 | `done` | charter 顶层状态已同步到 `F0 freeze closed; F1 unlocked` |
| S5 | P3-01: F1-F5 进入条件清单 | `done` | 6 份 action-plan 已形成连续执行链 |
| S6 | P3-02: follow-up 降级清单 | `done` | `503 vs throw`、`canonical_public` URL、partial replay 等已归入实现期 |
| S7 | P4-01: F0 closure memo | `done` | `F0-closure.md` 正式声明 F0 闭合、F1 已解锁 |

### F1 — Bring-up and First Roundtrip

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S8 | P1-01: orchestrator-core worker shell | `done` | package/wrangler/README/tests/DO 完整落地且通过 build/typecheck/test |
| S9 | P1-02: probe marker | `done` | probe 返回 `worker=orchestrator-core / phase=orchestration-facade-F2` |
| S10 | P2-01: public start ingress | `done` | `POST /sessions/:id/start` 经 JWT ingress → user DO 路由 |
| S11 | P2-02: user DO registry shell | `done` | 写入完整初始 `SessionEntry`（含 6 字段），per-user DO 已可用 |
| S12 | P3-01: agent internal route family 起步 | `done` | `/internal/sessions/:id/{start,input,cancel,status,timeline,verify,stream}` 已存在 |
| S13 | P3-02: internal auth gate | `done` | `x-nano-internal-binding-secret` + typed `401 invalid-internal-auth` 已实现 |
| S14 | P4-01: NDJSON first event relay | `partial` | 见 R1：打通但本质是 snapshot relay。F1 scope 内作为 narrow roundtrip proof 可接受。 |
| S15 | P4-02: relay cursor 初始语义 | `done` | `relay_cursor = -1`（无 forwarded frame），首个已 forward frame 后更新，与 design 对齐 |
| S16 | P5-01: orchestrator package-e2e 最小集 | `done` | 01/02 live tests 通过 |
| S17 | P5-02: F1 closure | `partial` | closure 已产出但未交代 snapshot relay 的限制 |

### F2 — Session Seam Completion

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S18 | P1-01: SessionEntry 行为完整化 | `done` | 状态流转（starting/active/detached/ended）已实现，不再扩字段 |
| S19 | P1-02: ended retention | `done` | `24h + 100` 双上限 lazy cleanup 已实现并可通过测试断言 |
| S20 | P2-01: façade input/cancel | `done` | input/cancel 经 façade forward 到 agent internal，可与 live test 断言 |
| S21 | P2-02: façade status/timeline/verify | `done` | status/timeline/verify 已就位，verify 采用 façade forward 模式不发明私有检查 |
| S22 | P3-01: WS attach | `done` | `/sessions/:id/ws` 由 façade 接管，supersede 顺序正确 |
| S23 | P3-02: reconnect taxonomy | `done` | success/terminal/missing 三分支均已实现并可断言 |
| S24 | P4-01: terminal mapping | `done` | terminal frame → lifecycle.status 映射已闭合 |
| S25 | P4-02: terminal / missing attach rejection | `done` | `session_terminal` (409) 与 `session_missing` (404) 语义分离正确 |
| S26 | P5-01: façade package-e2e 扩面 | `done` | 03/04/05 live tests 通过 |
| S27 | P5-02: F2 closure + probe rollover | `partial` | closure 已产出且 probe 已 bump 到 F2，但未交代 R1/R3 的限制 |

### 3.1 对齐结论

- **done**: `24`
- **partial**: `3`（S14 P4-01 NDJSON relay、S17 F1 closure、S27 F2 closure）
- **missing**: `0`

> F0~F2 的实现总体完成了 action-plan 中列出的结构化工作项。3 个 partial 评级都指向同一个根因：closure 文档的语言暗示了一个比实际实现更强的 live relay 能力。这个差距不在代码的 correctness 层面，而在 scope declarativeness 层面。**这更像是"closure 写了 future tense 而实现早已 freeze 在当前 tense"的文档漂移问题。**

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | F0: 新增任何 worker 代码 | `遵守` | F0 未产生任何代码文件 |
| O2 | F1: 完整 public `input/verify/status/timeline/ws/reconnect` | `遵守` | 这些都在 F2 中完成，未在 F1 偷渡 |
| O3 | F1: F3 cutover / legacy deprecation / README 大迁移 | `遵守` | 无 cutover 代码落入 F1 |
| O4 | F1: 直接开放 context-core / filesystem-core 给 orchestrator | `遵守` | orchestrator-core 的 wrangler.jsonc 只有 AGENT_CORE binding |
| O5 | F2: multi-writer / read-only mirror attachment | `遵守` | 仅实现 single active writable attachment |
| O6 | F2: partial replay / richer replay protocol | `遵守` | relay cursor 仅做 seq tracking，不实现 replay-from-cursor |
| O7 | F2: full history archive / SQLite | `遵守` | 采用 DO storage key-value，无 SQLite 引入 |
| O8 | F2: F3 canonical cutover 与 legacy hard deprecation | `遵守` | F2 代码中无 410/426 legacy route 逻辑 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：**F0/F1/F2 整体通过，但 F1/F2 closure 必须在收口前追加 snapshot relay 的已知限制声明。**
- **是否允许关闭本轮 review**：`yes`（本轮审查完成，闭合后不重新开封）
- **关闭前必须完成的 blocker**：
  1. **B1**: 在 `F1-closure.md` 和 `F2-closure.md` 中各自追加一段"已知限制 Known Limitations"章节，明确说明当前 `/internal/stream` 的实现本质是 timeline-snapshot-over-NDJSON relay，不是 live push relay；real-time event push 属于下一阶段的 richer relay 议题。此段措辞不能在 closure 的其他部分（如"结论"或"交付"）中被矛盾表述掩盖。
  2. **B2**: 从 `SessionStatus` 类型中移除 `'minted'`（或加 `// reserved` 注释并注释说明原因），避免后续读者误认为代码中存在一条 minted → starting 的显式状态转移路径。
- **可以后续跟进的 non-blocking follow-up**：
  1. **F1**: `agent-core` 的 `forwardInternalStream()` 上方添加文档注释，说明"first-wave snapshot-based relay"。
  2. **F2**: `handleWsAttach` 中的 `readInternalStream` 调用添加注释说明"当前读取完成后的 snapshot，未实现 real-time event push relay"。
  3. **F3**: contexter absorption inventory 中 `core/jwt.ts` 的 label 修正为 `adapt-pattern (reimplemented)`。
  4. **F4**: `readNdjsonFrames` 的返回值类型改为 `unknown[]` → 在 discriminator 分派后再窄化到 `StreamFrame`，或引入 Zod 运行时校验。

---

## 8. 对 DeepSeek 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-24`
> 评价依据: `workers/orchestrator-core/src/user-do.ts`, `workers/agent-core/src/host/internal.ts`, `docs/design/orchestration-facade/F0-contexter-absorption-inventory.md`, `docs/issue/orchestration-facade/F{1,2}-closure.md`

### 8.1 一句话评价
DeepSeek 的强项是抓“设计假设与实际交付不一致”的结构性问题，尤其擅长发现悬空状态和 inventory 口径漂移。

### 8.2 优点
1. 准确指出了 `minted` 是设计遗产而非当前实现现实，这个判断直接促成了类型与文档收口。
2. 对 snapshot relay、JWT absorption inventory label 的口径漂移非常敏感，帮助把 frozen docs 拉回到代码真相。

### 8.3 事实确认 - 审核文档中，所有真实存在的问题
1. snapshot relay 被 closure 讲成更强的 live relay，确实是文档漂移。
2. `minted` 状态在实现里确实从未被写入。
3. contexter JWT 的吸收 label 确实与实际独立重写不符。
4. `readNdjsonFrames` 缺少运行时 discriminator 校验，这一点也成立。

### 8.4 事实错误 - 审核文档中，所有的事实错误
1. R3 把 “WS 附着后是单次 snapshot relay” 上升到 F2 scope drift，判断略重；更准确地说这是已知限制未写清，而不是 F2 交付失效。
2. §3.2 / §3.3 中把 “terminal mapping 已闭合” 评成 `done` 与当前代码事实不完全一致；当前闭合的是 façade 侧 cancel terminal 与 typed rejection，不是 richer internal terminal truth。
3. R5 关于 discriminated union narrowing 的一部分论证落在 future extensibility，而不是当前 correctness，因此力度偏弱。

---
以上内容均不局限于只有2个，如果多个请一一列举。
---

### 8.5 评分 - 总体 ** 4.4 / 5** 

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 4 | 能抓到关键文件与文档，但跨测试/closure 的串联稍弱于 Opus。 |
| 判断严谨性 | 4 | 大部分判断准确，少数 scope 级措辞偏重。 |
| 修法建议可执行性 | 5 | `minted`、inventory label、closure truth 这些建议都很可执行。 |
| 对 action-plan / design 的忠实度 | 5 | 很重视 frozen docs 与 shipped reality 的偏差。 |
| 协作友好度 | 4 | 问题清晰，但部分结论的严重度略高于实际。 |
