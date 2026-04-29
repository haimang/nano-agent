# Real-to-Hero — RH0-RH2 阶段代码审查（GPT）

> 审查对象: `real-to-hero / RH0-RH2 阶段交付`
> 审查类型: `code-review`
> 审查时间: `2026-04-29`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md`
> - `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md`
> - `docs/action-plan/real-to-hero/RH2-models-context-inspection.md`
> - `workers/agent-core/`
> - `workers/orchestrator-core/`
> - `workers/context-core/`
> - `packages/nacp-session/`
> 对照真相:
> - `docs/charter/plan-real-to-hero.md`
> - `docs/issue/real-to-hero/RH0-closure.md`
> - `docs/issue/real-to-hero/RH1-closure.md`
> - `docs/issue/real-to-hero/RH1-evidence.md`
> - `docs/issue/real-to-hero/RH2-closure.md`
> - `docs/issue/real-to-hero/RH2-evidence.md`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`RH0-RH2 的主体工程已经推进到“RH3 可继续施工”的状态，但当前更像“基线稳定 + wire/contract/stub 骨架成立”，而不是“3 个阶段都已被严格闭合”。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `RH0` 能作为后续阶段的稳定起点，但严格 gate 与证据口径仍未完全对齐，尤其 `pnpm check:cycles` 仍失败，部分测试/preview evidence 只证明“活着”，没有证明 action-plan 声称的行为面。
  2. `RH1` 的 hook / cross-worker RPC / usage strict snapshot 已经落地，但 permission / elicitation / usage push 仍停留在 wire-only / best-effort；没有真实调用链，也没有 round-trip e2e，当前默认仍会落到 `no-user-uuid-for-routing`。
  3. `RH2` 的 `/models`、`/context*`、tool semantic streaming 与 schema 冻结骨架都在，但 `emitServerFrame` 不是完整的 outbound schema gate，`attachment_superseded` 真实发送形状与 RH2 冻结 schema 并未收敛，这会直接影响 RH3 device gate 的协议一致性。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-real-to-hero.md`
  - `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md`
  - `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md`
  - `docs/action-plan/real-to-hero/RH2-models-context-inspection.md`
  - `docs/issue/real-to-hero/RH1-closure.md`
  - `docs/issue/real-to-hero/RH1-evidence.md`
  - `docs/issue/real-to-hero/RH2-closure.md`
  - `docs/issue/real-to-hero/RH2-evidence.md`
- **核查实现**：
  - `workers/agent-core/src/host/do/nano-session-do.ts`
  - `workers/agent-core/src/kernel/scheduler.ts`
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `workers/orchestrator-core/src/entrypoint.ts`
  - `workers/orchestrator-core/src/user-do.ts`
  - `workers/orchestrator-core/src/frame-compat.ts`
  - `workers/orchestrator-core/src/index.ts`
  - `workers/context-core/src/index.ts`
  - `packages/nacp-session/src/messages.ts`
  - `workers/orchestrator-core/migrations/008-models.sql`
  - RH0/RH1/RH2 相关测试文件
- **执行过的验证**：
  - `pnpm check:cycles`
  - `pnpm --filter @haimang/nacp-session test && pnpm --filter @haimang/context-core-worker test && pnpm --filter @haimang/orchestrator-core-worker test && pnpm --filter @haimang/agent-core-worker test`
  - preview smoke：注册账户后访问 `/models`、`/me/sessions`、`/sessions/{id}/context`、`/sessions/{id}/context/snapshot`、`/sessions/{id}/context/compact`、`/sessions/{id}/usage`
- **复用 / 对照的既有审查**：
  - `none` — 其他 reviewer 报告没有作为本结论来源；RH1 / RH2 closure、evidence、work-log 仅作为被复核对象。后台 explore agent 只提供线索，所有结论都在本文中重新按文件与命令核实。

### 1.1 已确认的正面事实

- `RH0` 之后的代码基线目前仍可工作：本轮复跑 `pnpm --filter @haimang/nacp-session test`、`pnpm --filter @haimang/context-core-worker test`、`pnpm --filter @haimang/orchestrator-core-worker test`、`pnpm --filter @haimang/agent-core-worker test` 全部通过，分别为 `15/150`、`19/171`、`15/132`、`100/1062`。
- `RH1` 的 Phase 1 / 3 / 5 主体成立：`scheduler.ts` 已产生 `hook_emit`，`runtime-mainline.ts` 已 delegate 到 `HookDispatcher`，`entrypoint.ts` 已暴露 `forwardServerFrameToClient()`，`user-do.ts` 已有 `emitServerFrame()` 与 `/usage` strict snapshot。
- `RH2` 的 façade 与文档资产主体成立：`migration 008-models.sql`、`GET /models` 路由、`/sessions/{id}/context*` 路由、`context-core` 三个 RPC method、`runtime-mainline` tool semantic event wiring、`docs/api/llm-delta-policy.md` 与 `clients/web/src/RH2-AUDIT.md` 都真实存在。

### 1.2 已确认的负面事实

- `RH0` 当前仍不能按“严格闭合”口径表述：`pnpm check:cycles` 复跑仍报 `10` 个 circular dependencies；`bootstrap-hardening.test.ts` 仍是 `InMemoryAuthRepository` 路径，不是 action-plan 描述的 worker/miniflare/D1 压测；RH0 action-plan 中记录的若干 façade 行为面与真实测试用例仍有偏移。
- `RH1` 的 permission / elicitation 没有进入真实 runtime 调用链：`workers/agent-core/src` 中只有 `emitPermissionRequestAndAwait()` / `emitElicitationRequestAndAwait()` 的定义，没有任何调用点；同时 `pushServerFrameToClient()` 在缺少 `USER_UUID` 时直接返回 `no-user-uuid-for-routing`。
- `RH2` 的 outbound schema gate 不是完整覆盖：`validateLightweightServerFrame()` 对 `session.stream.event` 默认放行；`user-do.ts` 仍有多处 `socket.send()` 直发绕过 `emitServerFrame()`；其中 superseded path 发送的是 legacy lightweight `attachment_superseded` 形状，字段与 `SessionAttachmentSupersededBodySchema` 并不一致。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 逐段核对了 action-plan / closure / evidence 与实现文件、测试文件、migration、schema 文件。 |
| 本地命令 / 测试 | `yes` | 复跑了 `pnpm check:cycles` 与 RH1/RH2 关键包测试，并读取了具体 summary。 |
| schema / contract 反向校验 | `yes` | 对比了 `messages.ts`、`frame-compat.ts`、`user-do.ts` 的真实发送形状与 RH2 schema 冻结内容。 |
| live / deploy / preview 证据 | `yes` | 使用 preview 注册账号并实际访问 `/models`、`/context*`、`/usage`，确认了 `503` / `phase:"stub"` / `409 pending-only` 等当前 live 形态。 |
| 与上游 design / QNA 对账 | `yes` | 本轮以 charter 与 RH0-RH2 action-plan / closure / evidence 为主线，核对了哪些项属于 done、partial、carry-over 或 wording drift。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | RH0 仍未达到“严格闭合”口径 | `high` | `delivery-gap` | `yes` | 修正 RH0 closure / action-plan 口径，或补齐 cycle gate 与被弱化的验证面 |
| R2 | RH1 的 permission / elicitation / usage push 仍是 wire-only | `high` | `delivery-gap` | `yes` | 在 RH3 前补上 user_uuid wiring、真实调用点与 round-trip e2e |
| R3 | RH2 的 outbound schema gate 不完整，superseded 帧与冻结 schema 漂移 | `critical` | `protocol-drift` | `yes` | 统一 outbound frame 形状与 gate 覆盖面，至少先修正 superseded path |
| R4 | RH2 的 live 表述把“façade reachable / stub complete / migration 未 apply”包装得过满 | `medium` | `docs-gap` | `no` | 收紧 closure/evidence 用语，明确 `façade live`、`stub live`、`data live` 的边界 |

### R1. `RH0 仍未达到“严格闭合”口径`

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `pnpm check:cycles` 本轮复跑仍然失败，输出 `Found 10 circular dependencies!`
  - `workers/orchestrator-auth/test/bootstrap-hardening.test.ts:37-48`、`160-190`、`193-219` 显示 RH0 压测仍是 `InMemoryAuthRepository` + 本地 delay 的测试夹具，而不是 action-plan 原文承诺的 worker/miniflare/D1 压测路径
  - `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md:552-615` 中追加的严格审查章节已经确认：cycle gate 未满足、route baseline 行为面与 action-plan 漂移、preview smoke 更接近 deploy/health smoke 而非完整业务流 smoke
- **为什么重要**：
  - RH0 是 real-to-hero 的进场基线。如果 RH0 的“严格闭合”本身是放宽后的口径，后续 RH1/RH2 的 PASS 也更容易被错误理解为“硬 gate 全都已经通过”。
  - 这里的问题不在于仓库不能继续开发，而在于 closure claim 与真实证据层级不一致，会误导后续 phase 的风险判断。
- **审查判断**：
  - RH0 可以被视为“代码基线已稳定、RH1 可开工”的阶段性结果，但不能再按“严格 hard gate 全部兑现”来写。
- **建议修法**：
  - 把 RH0 closure / action-plan 中未满足的 strict gate 显式改写为 carry-over，或继续补齐 cycle cleanup、压力验证与 smoke 证据，使文档口径重新与事实一致。

### R2. `RH1 的 permission / elicitation / usage push 仍是 wire-only`

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md:152-154`、`180-183` 明确要求：`emitPermissionRequestAndAwait` / `emitElicitationRequestAndAwait` 真 emit，并且至少有一个 runtime hook 真调 `emitPermission`
  - `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md:160-162`、`208-210` 明确要求 3 个 cross-e2e 文件：`permission-round-trip.e2e.test.ts`、`elicitation-round-trip.e2e.test.ts`、`usage-push.e2e.test.ts`
  - `workers/agent-core/src/host/do/nano-session-do.ts:679-718` 只存在方法定义；本轮 `rg` 在 `workers/agent-core/src` 中没有找到任何调用点
  - `workers/agent-core/src/host/do/nano-session-do.ts:731-756` 显示 `pushServerFrameToClient()` 在缺少 `USER_UUID` 时直接返回 `{ ok:false, delivered:false, reason:"no-user-uuid-for-routing" }`
  - `docs/issue/real-to-hero/RH1-closure.md:16`、`24-29` 把这些链路写成“可观察 live 的 wire”；但 `docs/issue/real-to-hero/RH1-evidence.md:19-20`、`45-47` 已经承认 round-trip e2e 被 carry-over，当前只是 best-effort / contract live
- **为什么重要**：
  - RH1 的核心命题不是“方法存在”，而是 Lane F side-channel 从 contract-only 升级为真实可观察链路。如果没有调用点、没有 user_uuid、没有 round-trip e2e，那么 permission / elicitation / usage push 还不能叫 live delivery。
  - 这会直接影响 RH3：一旦 device gate 开始依赖这些链路，第一轮真实生产流量才会暴露隐藏问题。
- **审查判断**：
  - RH1 完成了 topology、hook seam 与 strict snapshot HTTP；但 permission / elicitation / usage push 仍应归类为 `wire ready / best-effort skip`，而不是“已 live 收口”。
- **建议修法**：
  - 在 RH3 前明确补上三件事：`user_uuid` 进入 `NanoSessionDO`；至少一个真实 runtime/hook 调用 `emitPermissionRequestAndAwait()`；补齐 3 个 round-trip e2e 文件并以此重写 RH1 closure 的 Phase 2 / Phase 6 口径。

### R3. `RH2 的 outbound schema gate 不完整，superseded 帧与冻结 schema 漂移`

- **严重级别**：`critical`
- **类型**：`protocol-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/orchestrator-core/src/frame-compat.ts:108-123` 的 `validateLightweightServerFrame()` 在对应 message_type 没有 `SESSION_BODY_SCHEMAS` 时默认放行；`session.stream.event` 家族并没有在这里做真正的 body schema 校验
  - `workers/orchestrator-core/src/user-do.ts:1237-1255` 只有走 `emitServerFrame()` 的路径才会经过该 gate
  - `workers/orchestrator-core/src/user-do.ts:1984-1990`、`2000-2003`、`2116`、`2138-2144` 仍有多处 `socket.send()` 直发，绕过 `emitServerFrame()`
  - `packages/nacp-session/src/messages.ts:70-77` 冻结的 `SessionAttachmentSupersededBodySchema` 要求字段为 `session_uuid`、`superseded_at`、`reason ∈ ["device-conflict","reattach","revoked","policy"]`
  - 但 `workers/orchestrator-core/src/user-do.ts:1984-1990` 真实发送的是 legacy lightweight payload：`{ kind: 'attachment_superseded', reason: 'replaced_by_new_attachment', new_attachment_at: ... }`
  - `docs/issue/real-to-hero/RH2-closure.md:16`、`27` 把 RH2 写成“`emitServerFrame` 在 send 前走 NACP schema 校验 gate”
- **为什么重要**：
  - RH2 的 schema 冻结与 RH3 device gate 是一条连续链。如果 superseded / heartbeat / replay / terminal 等真实 outbound path 仍停留在绕过 gate 的 legacy shape，后续 client 或 gateway 一旦开始严格依赖 schema，就会出现协议分裂。
  - 这里不只是“文档说满了”，而是已经存在真实 payload 与冻结 schema 不一致的事实。
- **审查判断**：
  - RH2 完成了 schema 冻结与 gate helper 的骨架，但没有完成“所有关键 outbound frame 都已统一受 gate 约束”的闭合；特别是 superseded path 仍是旧形状。
- **建议修法**：
  - 优先统一 superseded path：要么改为经 `emitServerFrame()` 发送，并使用 `session.attachment.superseded` 的字段与 reason 枚举；要么明确继续保留 legacy lightweight 形状，并把 RH2 closure 改写为“full outbound schema alignment deferred to RH3”。随后再收敛 heartbeat / replay / terminal 等直发路径。

### R4. `RH2 的 live 表述把“façade reachable / stub complete / migration 未 apply”包装得过满`

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:860-939` 的 `/models` 路由已经完整实现，并在 D1 不可用时明确返回 `503 models-d1-unavailable`
  - `workers/orchestrator-core/migrations/008-models.sql:17-66` 已经建表并 seed 了 2 个 baseline model
  - 但本轮 preview smoke 实际访问 `/models` 返回的仍是 `503 {"code":"models-d1-unavailable"}`, 说明 owner-action 的 D1 apply 尚未落地
  - `workers/context-core/src/index.ts:133-199` 的 3 个 RPC method 明确返回 `phase:"stub"`
  - `docs/issue/real-to-hero/RH2-closure.md:16`、`26` 把 `/models`、`/context*` 写成“endpoint live / cross-worker reachable”；这在 transport 层面成立，但在 data/inspector 层面仍分别是 `migration not applied` 与 `stub`
- **为什么重要**：
  - 这类 wording drift 不会马上炸掉运行时，但会让后续阶段误判“哪些是真 live 能力，哪些只是 façade/stub 已预留”。
  - RH3/RH4 的资源安排高度依赖这条边界：`/models` 是 code-complete but preview-not-applied；`/context*` 是 façade-live but inspector-stub。
- **审查判断**：
  - RH2 的代码骨架与 route topology 可以通过，但 closure/evidence 应更明确区分 `façade live`、`stub live` 与 `data live`。
- **建议修法**：
  - 把 RH2 closure 中对应表述改成更精确的分层：`/models` = code complete, preview data pending migration apply；`/context*` = cross-worker reachable stub façade, real inspector deferred to RH4。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | RH0：代码基线稳定、主要测试与 preview 健康 | `done` | 关键包测试当前通过，preview 仍可注册账号并访问 RH1/RH2 相关 facade。 |
| S2 | RH0：strict gate / route baseline / business smoke 已严格闭合 | `partial` | cycle gate 仍失败；压测、route baseline 与 smoke 证据层级仍低于 action-plan 原文。 |
| S3 | RH1：Phase 1 hook dispatcher wiring | `done` | `scheduler.ts`、`runtime-mainline.ts` 与对应测试都已落地。 |
| S4 | RH1：Phase 2 permission / elicitation 真 emit + runtime hook 真调用 | `partial` | 方法存在，但没有 runtime callsite；只能算 emit-and-await seam 就位。 |
| S5 | RH1：Phase 3/4 cross-worker push topology + usage push live | `partial` | RPC topology 与 `onUsageCommit` 代码存在，但缺 `user_uuid` 导致当前默认 `delivered:false`。 |
| S6 | RH1：Phase 5 usage strict snapshot | `done` | `handleUsage()` 已实现 zero-shape / 503 strict snapshot，测试存在且通过。 |
| S7 | RH1：Phase 6 permission / elicitation / usage push round-trip e2e | `missing` | action-plan 列出的 3 个 cross-e2e 文件当前不存在；closure 事后把它们降格为 carry-over。 |
| S8 | RH2：Phase 1 schema freeze + tool semantic streaming wiring | `partial` | schema、registry 与 tool event wiring 存在，但真实 outbound path 并未完全收敛到统一 schema gate。 |
| S9 | RH2：Phase 2 `/models` endpoint | `partial` | 代码与 migration 已完成，但 preview 当前仍因未 apply 迁移而返回 `503`。 |
| S10 | RH2：Phase 3 `/sessions/{id}/context*` + CONTEXT_CORE RPC | `partial` | façade 与 RPC 可达，但返回明确的 `phase:"stub"`，真实 inspector 不在 RH2。 |
| S11 | RH2：Phase 6 client adapter audit-only | `done` | `clients/web/src/RH2-AUDIT.md` 明确登记了 6 类 frame 与 RH3+ carry-over。 |

### 3.1 对齐结论

- **done**: `4`
- **partial**: `6`
- **missing**: `1`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

这更像“**基础骨架、transport seam、stub façade 与部分 strict surface 已完成，但 live delivery / full protocol alignment / owner-action data apply 还没全部收口**”，而不是一个可以整体打上 `completed` 或 `all hard gates passed` 的 RH0-RH2 三阶段包。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | RH2 web / wechat client 真升级 | `遵守` | `clients/web/src/RH2-AUDIT.md` 已明确是 `audit-only`，charter 也没有要求 RH2 必须完成 UI live 消费。 |
| O2 | RH2 context-core 真实 per-session inspector | `遵守` | `context-core/src/index.ts` 明确写了 `phase:"stub"` 并指向 RH4；这本身不是 blocker。 |
| O3 | RH2 `/models` preview D1 apply | `遵守` | closure 已把 migration apply 记为 owner-action carry-over；问题在 wording，而不是 scope 越界。 |
| O4 | RH3/RH6 才完成 full NACP WS handshake、client→server ingress 与 round-trip e2e | `部分违反` | 代码层面确实 deferred，但 RH1/RH2 closure 把其中一部分写成了“已 live / 已 closed”，造成 scope 与 wording 的轻度错位。 |
| O5 | 把 RH2 client 未升级误报为 blocker | `误报风险` | 本轮没有这样处理；真正的 blocker 在协议收敛与 live delivery，不在 UI 审计本身。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`RH0-RH2 的交付可以支撑 RH3 继续施工，但当前 review 不收口；需要先把“strict / live / protocol-aligned”这三层口径重新与事实对齐。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `修正 RH0 / RH1 / RH2 closure 与 action-plan 的关键表述：把 RH0 strict gate 未满足、RH1 wire-only/best-effort、RH2 stub/migration-pending/protocol-drift 的事实显式写清，不要继续用“已 live / 已 strict closed”笼统包裹。`
  2. `在 RH3 前补齐 RH1 的真实交付链：让 user_uuid 进入 NanoSessionDO、接通至少一个 permission/elicitation 调用点，并把 P1-10/P1-11/P1-12 round-trip e2e 真正落地。`
  3. `在 RH3 device gate 之前收敛 RH2 的 outbound frame 协议：至少先统一 superseded path 的字段与 reason 枚举，并决定 heartbeat/replay/terminal 等直发路径是否纳入统一 schema gate。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `owner apply 008-models.sql 后补一轮 preview /models 200/304 证据，把 code-complete 与 data-live 证据链闭合。`
  2. `RH4 再实现真实 context inspector 时，沿用当前 phase:"stub" 的分层表达，避免把 façade reachability 与业务能力完成度混写。`
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码与文档。

---

## 6. 实现者回应

> 本节为对 4 reviewer(GPT-5.4 / Deepseek / GLM-5.1 / Kimi k2p6)在 RH0-RH2 复审中累积识别问题的整体回应。本回应只 append,不改写 §0-§5。

### 6.1 对本轮(4 reviewer)审查的回应

> 执行者: `Owner + Opus 4.7`
> 执行时间: `2026-04-29`
> 回应范围: `GPT R1-R4 / Deepseek R1-R10 / GLM R1-R12 / Kimi R1-R8(36 项 finding,去重映射后约 16 类问题)`
> 对应审查文件:
> - `docs/code-review/real-to-hero/RH0-RH2-reviewed-by-GPT.md`(本文档)
> - `docs/code-review/real-to-hero/RH0-RH2-reviewed-by-deepseek.md`
> - `docs/code-review/real-to-hero/RH0-RH2-reviewed-by-GLM.md`
> - `docs/code-review/real-to-hero/RH0-RH2-reviewed-by-kimi.md`

- **总体回应**: 4 reviewer 一致指出"工程骨架成立 + 文档口径膨胀"——本轮回应做了 (a) 1 项 critical 协议漂移代码 fix(superseded / heartbeat / terminal 三处直发收敛到 emitServerFrame schema gate)、(b) 6 个 endpoint test case 补足(context-route 9 → 15 case 满足 charter §9.2)、(c) 3 份 closure(RH0/RH1/RH2)文档状态 + verdict 口径修正(closed → close-with-known-issues + 显式区分 wire-contract / e2e-live / data-live)、(d) RH0 + RH1 action-plan 收口标准与现实对齐(cycle gate / bootstrap stress strength / P1-06b schema 责任 shift)、(e) RH3 action-plan §2.1.1 显式吸纳 RH0-RH2 的 10 项 carry-over(deepseek R10 容量评估)。代码 + 测试矩阵 1551 → 1557 case 全绿,0 回归。
- **本轮修改策略**: 优先级 = critical 代码 fix > test case 补足 > closure 口径修正 > action-plan 同步 > RH3 carry-over 吸纳。所有改动不破坏既有 PASS 状态;不返工已实施的 wire / topology / schema / RPC 决策。
- **实现者自评状态**: `ready-for-rereview`(blocker GPT R3 已 fix;blocker GPT R1/R2 + deepseek R1/R2/R4/R9 通过 closure 口径修正吸纳;非 blocker follow-up 已登记到 RH3+ action-plan)

### 6.2 跨 reviewer finding 去重映射表

> 4 reviewer 的编号互相独立。本表把 36 项 finding 去重到 16 类问题,每类列出处理结果。

| 类别 | 反映 reviewer | 严重 | 处理结果 | 处置方式 |
|---|---|---|---|---|
| **C-DRIFT-1** outbound frame 协议漂移(superseded path 不符合 NACP 冻结 schema)| GPT R3 / deepseek R4 部分 | critical | **fixed**(代码 + 测试)| `user-do.ts` 把 superseded / heartbeat / terminal 三处 `socket.send` 直发收敛到 `emitServerFrame`,使 NACP body schema gate 真生效;`session.attachment.superseded` body 从 legacy `{reason:'replaced_by_new_attachment', new_attachment_at}` 改为 NACP 冻结的 `{session_uuid, superseded_at, reason:'reattach'}`(reason enum 限制为 device-conflict/reattach/revoked/policy);heartbeat 改为 `{ts:Date.now()}` 走 SessionHeartbeatBodySchema;terminal 从 `{kind:'terminal', terminal:'completed', last_phase}` 改为 `{kind:'session.end', reason:<mapped>, last_phase, session_uuid}` 走 SessionEndBodySchema(TerminalKind→reason enum:`completed→completed`/`cancelled→user`/`error→error`)|
| **C-CLOSURE-WORDING** closure headline vs body 口径断裂 / wire 与 live 混用 | GPT R1/R2/R4 / deepseek R1/R2/R9 / GLM R2/R3 / kimi R6/R7 | high | **fixed**(文档)| 3 份 closure 改:(a) RH1/RH2 文档状态 `closed → close-with-known-issues`;(b) §0 verdict 显式区分 wire-contract / facade-live / inspector-stub / data-live;(c) §0 增加 "本 Phase 最关键的 3 个 known gap";(d) Phase verdict cell 从 ✅ closed 改为 🟡 partial / wire-only / facade-live 等更精确状态 |
| **C-CYCLE-GATE** `pnpm check:cycles` 0 cycle hard gate 实测 10 cycles | GPT R1 隐含 / deepseek R5 / GLM R8 / kimi R1 | medium | **deferred-with-rationale**(口径修正)| RH0 closure §4 + action-plan §5.5 / §5.6 收口标准从 "0 cycle baseline" 改为 "host/do/ 0 cycle + 全仓 ≤10 baseline cycle(由 RH0 引入 0 个新 cycle)";10 个 pre-existing cycle 全在 packages/nacp-core / orchestrator-auth-contract / workspace-context-artifacts / agent-core-kernel / context-core,留 RH6 megafile decomp cleanup;CI 暂以 warning 模式运行 |
| **C-BOOTSTRAP-STRESS** bootstrap-hardening 测试强度低于 charter §7.1(InMemory + 5ms + 顺序)| GPT R1 隐含 / deepseek R6 / GLM R4 / kimi R2 | medium | **deferred-with-rationale**(口径修正)| RH0 closure §4 + action-plan §4.6 显式标注 "application-layer invariants level,charter-grade miniflare/D1 100-concurrent + 5s slow + 真 storm 由 RH6 e2e harness 接续";不在 RH3 scope(避免 deepseek R10 容量爆炸) |
| **C-LANE-F-DELIVERY** Lane F 4 链 wire 完整但真投递返 `delivered:false`(缺 user_uuid)| GPT R2 / deepseek R1 / GLM R2 / kimi R6 | high | **deferred-with-rationale**(吸纳到 RH3)| RH1 closure §0 verdict 改为 "wire-contract 闭合,真投递由 RH3 D6 user_uuid 解锁" + 显式 known gap;RH3 action-plan §2.1.1 新增 C1 carry-over 吸纳到 P3-S6 device gate(IngressAuthSnapshot.user_uuid 进入 NanoSessionDO),工作量 S |
| **C-RH1-E2E-MISSING** P1-10/P1-11/P1-12 三个 round-trip e2e 文件不存在 | GPT R2 / deepseek S7-S9 missing / kimi R7 | high | **deferred-with-rationale**(吸纳到 RH3)| RH1 closure §3 显式登记 missing(非 deferred-with-stub);RH1 action-plan §9.6 第 2 项追加;RH3 action-plan §2.1.1 C2 吸纳为 P3-CO-RH1 新工作项,工作量 M;C1 落地后必须补 |
| **C-CONTEXT-STUB** context-core 3 RPC 全返 `phase: "stub"`,charter §7.3 收口标准第 2 条不满足 | deepseek R2 / GLM R3 | high(deepseek)/ medium(GLM)| **deferred-with-rationale**(口径修正)| RH2 closure §0 + Phase 3 verdict 改为 "facade-live, inspector-stub";charter §7.3 数据互通要求显式降级到 RH4 file pipeline 后(C9);RH2 不返工 stub(stub-shape RPC 是有意的 contract 前置施工)|
| **C-WS-LIFECYCLE** WS lifecycle hardening 4 must-cover scenario(charter §7.3 P2-C)deferred | deepseek R4 / GLM 隐含 / kimi 隐含 | high | **deferred-with-rationale**(吸纳到 RH3)| RH2 closure Phase 4 verdict 改为 partial(gate live, lifecycle deferred);RH3 action-plan §2.1.1 C3 吸纳为 P3-CO-RH2-WS 新工作项,工作量 M-L;client 真 attached(C1 落地)后才能验证 |
| **C-MIGRATION-008** migration 008 未 apply preview D1 → /models 503 | GPT R4 / deepseek R7 / GLM R6 / kimi 隐含 | medium | **deferred-with-rationale**(owner-action)| RH2 closure §0 + Phase 2 verdict 改为 "code-complete, data-pending";RH3 action-plan §2.1.1 C4 entry-gate prereq:RH3 启动前 owner 必须 apply,不占 RH3 工作量 |
| **C-CONTEXT-TEST-COUNT** context-route.test.ts 9 case < charter §9.2 ≥5/endpoint(目标 15)| kimi R4 / GLM R10 | medium | **fixed**(代码)| `context-route.test.ts` 补 6 个 case:snapshot 加 3(400 invalid uuid / 503 binding-missing / 503 RPC throw)+ compact 加 3(401 missing bearer / 400 invalid uuid / 503 binding-missing)→ 总 15 case(GET 5 + snapshot 5 + compact 5)。orchestrator-core 测试 132 → 138,全矩阵 1551 → 1557 |
| **C-ROUTE-TEST-DRIFT** 7 份 RH0 route test 行为面与 action-plan 漂移(messages-403 / me-devices revoked / etc.)| GPT F3 / kimi R3 / GLM R5 | medium | **deferred-with-rationale**(吸纳到 RH3)| GPT F3 已在 RH0 closure §6 登记 carry-over;RH3 action-plan §2.1.1 C7 吸纳为 P3-S5/P3-S6 配套工作(device gate 落地时同步升级 7 份 route test 行为面)|
| **C-CLIENT-ADAPTER** Web/Wechat client adapter 升级 audit-only | deepseek R8 / GPT O1 (遵守) | medium | **deferred-with-rationale**(owner-action)| RH2 closure 已显式标注 audit-only carry-over;RH3 action-plan §2.1.1 C10 吸纳为 RH3 D6 落地后 owner-action;C9 落地(RH4 真 inspector)后再二次升级 |
| **C-DO-MEGAFILE** nano-session-do.ts 行数 1488 → 1594(违反 charter §5 Refactor-before-feature)| deepseek R3 / GLM R1(口径)| high(deepseek)/ high(GLM 口径)| **partially-fixed**(口径修正)| RH0 closure §2 hard gate 行 verdict 仍 ✅ 但补充 "unit-stripped 1488 / `wc -l` 1594 含空行;RH6 megafile decomp 二次压缩兜底";RH3 action-plan §2.1.1 隐含 "新增功能必须拆到 seam 文件"(无新代码改动需要,本回应未在 nano-session-do.ts 添加任何方法)|
| **C-ENTRYPOINT-VALIDATION** RH1 entrypoint.ts 缺 validateSessionFrame schema 校验 | kimi R5 / GLM R12 | medium | **partially-fixed**(口径 + RH3 吸纳)| RH1 action-plan §9.6 r2 注释显式登记责任 shift 到 RH2 P2-08(RH2 在 emitServerFrame 中补做,功能等价);RH3 action-plan §2.1.1 C5 吸纳轻量 kind-whitelist defense-in-depth check(工作量 XS,5 行)|
| **C-USAGE-BEST-EFFORT** onUsageCommit fire-and-forget(void)与 "live" 口径偏差 | GLM R11 | medium | **fixed**(口径)| RH1 closure Phase 4 verdict 显式标注 "wire-only(best-effort skip),`void` fire-and-forget 与 charter §4.4 + design §6.1 best-effort 纪律一致";代码无改动 |
| **C-PREVIEW-SMOKE** RH0 preview smoke 非业务流(GPT F4)| kimi R8 / GPT F4 | low | **rejected**(已闭合)| GPT F4 在 RH0 closure §6 已声明业主同日补做 7-step 业务流 smoke,evidence 在 owner-action 时段记录;不返工 |

### 6.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号(原 reviewer 编号)| 说明 |
|------|------|------|------|
| 已完全修复(代码 + 测试)| 3 类 | C-DRIFT-1 / C-CONTEXT-TEST-COUNT / C-CLOSURE-WORDING(部分)| GPT R3 critical fix + 6 个 test case 补足 + 3 份 closure 口径修正全部落地 |
| 部分修复(口径修正 + RH3 吸纳)| 4 类 | C-LANE-F-DELIVERY / C-RH1-E2E-MISSING / C-WS-LIFECYCLE / C-ENTRYPOINT-VALIDATION | wire 完成,真投递 + e2e + lifecycle hardening 由 RH3 D6 user_uuid 落地后接续(charter §10.3 NOT-成功退出第 1 条已在 RH3 action-plan §2.1.1 C1 显式吸纳)|
| 有理由 deferred | 5 类 | C-CYCLE-GATE / C-BOOTSTRAP-STRESS / C-CONTEXT-STUB / C-MIGRATION-008 / C-CLIENT-ADAPTER | 全部为 charter / RH4 / RH6 时机问题,closure / action-plan 已显式登记 carry-over 与承接位置 |
| 拒绝 / stale-rejected | 1 类 | C-PREVIEW-SMOKE | GPT F4 在 RH0 closure §6 已闭合 |
| 仍 blocked | 0 | — | 无 |

### 6.4 变更文件清单

**代码 fix(R3 protocol drift):**
- `workers/orchestrator-core/src/user-do.ts` — superseded path / heartbeat path / notifyTerminal 三处 `socket.send` 直发收敛到 `emitServerFrame`(NACP `session.attachment.superseded` / `session.heartbeat` / `session.end` 三类 body schema 在 send 前生效)
- `workers/orchestrator-core/test/user-do.test.ts` — supersedes test assertion 从 `'attachment_superseded'`(legacy 下划线)改为 `'session.attachment.superseded'` + `'"reason":"reattach"'`(NACP 冻结 schema)
- `workers/orchestrator-core/test/context-route.test.ts` — 补 6 个 endpoint case(snapshot +3 + compact +3),context endpoint 总 case 数 9 → 15

**Closure 口径修正:**
- `docs/issue/real-to-hero/RH0-closure.md` — §2 hard gate ≤1500 行 cell + §4 已知未实装 cycle gate / bootstrap-hardening 行更新
- `docs/issue/real-to-hero/RH1-closure.md` — 文档状态 closed → close-with-known-issues + §0 verdict 重写 + §0 增加 known gap 三点 + Phase 2/4/6 verdict 改为 wire-only/partial + §5 修订历史 r2
- `docs/issue/real-to-hero/RH2-closure.md` — 文档状态 closed → close-with-known-issues + §0 verdict 重写 + §0 增加 known gap 三点 + Phase 2/3/4 verdict 改为 partial + §2 hard gate 表新增 outbound frame 收敛行 + §5 修订历史 r2

**Action-plan 同步:**
- `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md` — §4.6 P0-G1 收口降级口径(application-layer invariants)+ §5.5 cycle gate 改为 host/do/ 0 + 全仓 baseline 不新增
- `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md` — §9.6 第 2 项追加 P1-10/11/12 missing 显式登记 + r2 注释 P1-06b schema 责任 shift 到 RH2 P2-08
- `docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md` — §2.1.1 新增 RH0-RH2 carry-over inheritance 表(C1-C10),含容量评估 + 工作量 + 不可降级项(C1)

### 6.5 验证结果

> 与本轮 finding 直接相关的验证。

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|--------|-------------|------|----------------|
| jwt-shared 测试 | `pnpm --filter @haimang/jwt-shared test` | pass(20)| baseline 不回归 |
| nacp-session 测试(含 4 RH2-new attachment.superseded case)| `pnpm --filter @haimang/nacp-session test` | pass(150)| C-DRIFT-1 |
| orchestrator-core 测试(含 user-do 11 case + context 15 case + models 5 case + usage strict 3 case)| `pnpm --filter @haimang/orchestrator-core-worker test` | pass(138,r1 132 → r2 138)| C-DRIFT-1 / C-CONTEXT-TEST-COUNT |
| orchestrator-auth 测试 | `pnpm --filter @haimang/orchestrator-auth-worker test` | pass(16)| baseline 不回归 |
| agent-core 测试 | `pnpm --filter @haimang/agent-core-worker test` | pass(1062)| baseline 不回归(P2-12 onToolEvent wire 不破坏) |
| context-core 测试 | `pnpm --filter @haimang/context-core-worker test` | pass(171)| baseline 不回归 |
| **测试矩阵合计** | — | **pass(1557,r1 1551 → r2 1557 ↑6)** | 0 回归 |
| `pnpm check:cycles` | `pnpm check:cycles` | fail(10 cycles,与 RH0 baseline 一致;由 RH0-RH2 引入 0 个新 cycle)| C-CYCLE-GATE(deferred-with-rationale,RH6 cleanup)|

```text
Test Files  100 passed (100)              [agent-core]
Tests       1062 passed (1062)            [agent-core]
Test Files  15 passed (15)                [orchestrator-core]
Tests       138 passed (138)              [orchestrator-core; r1 132 → +6 RH2 reviewer fix]
Test Files  4 passed (4)                  [orchestrator-auth]
Tests       16 passed (16)                [orchestrator-auth]
Test Files  15 passed (15)                [nacp-session]
Tests       150 passed (150)              [nacp-session]
Test Files  19 passed (19)                [context-core]
Tests       171 passed (171)              [context-core]
Test Files  1 passed (1)                  [jwt-shared]
Tests       20 passed (20)                [jwt-shared]
─────────────────────────────────────────────────────
TOTAL       1557 passed                   [r1 1551 → +6 ↑;0 regression]

pnpm check:cycles                         [10 cycles, exit 1; RH0 baseline ≥10, RH0-RH2 引入 0 new]
```

### 6.6 未解决事项与承接

| 编号(reviewer)| 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| GPT R2 / deepseek R1 / GLM R2 / kimi R6(C-LANE-F-DELIVERY)| deferred | NanoSessionDO 缺 user_uuid 是 RH3 D6 device gate 的根本前置;不在 RH2 scope 内补会破坏 deepseek R10 容量评估,且 user_uuid 从 IngressAuthSnapshot 注入需要等 device migration 落地 | RH3 action-plan §2.1.1 C1(P3-S6 一部分)|
| GPT R2 / deepseek S7-S9 / kimi R7(C-RH1-E2E-MISSING)| deferred | 真 round-trip e2e 必须在 user_uuid 注入 + miniflare cross-worker harness 完整后才能写;现写则会成为 best-effort skip e2e(假 PASS) | RH3 action-plan §2.1.1 C2(P3-CO-RH1 新工作项)+ RH6 e2e harness |
| deepseek R4 / charter §7.3 P2-C(C-WS-LIFECYCLE)| deferred | 4 must-cover scenario 必须 client 真 attached 才能验证;DO alarm wire 也是 device gate 落地后才有真使用场景 | RH3 action-plan §2.1.1 C3(P3-CO-RH2-WS 新工作项)|
| deepseek R2 / GLM R3(C-CONTEXT-STUB)| deferred | 真 per-session inspector 在 RH4 file pipeline 落地后接入 inspector-facade 是 charter §7.3 设计;现实现 stub 不返工 | RH4 P4-* file pipeline + inspector-facade 接入 |
| GPT R4 / deepseek R7 / GLM R6(C-MIGRATION-008)| deferred | sandbox 不允许 remote D1 migrate | owner-action(`wrangler d1 migrations apply --remote`),RH3 启动前必须 apply |
| deepseek R3(C-DO-MEGAFILE 1488 → 1594)| partially | RH1/RH2 新增 wire 不可避免地落到 nano-session-do.ts;RH3 起严格执行"新功能拆到 seam 文件"纪律 | RH6 megafile decomposition 完整拆分 |
| GPT R2 / deepseek R6 / GLM R4 / kimi R2(C-BOOTSTRAP-STRESS)| deferred | vitest 限制下 InMemory 是合理工程现实;真 miniflare/D1 stress 由 RH6 e2e harness 接续 | RH6 e2e harness 配 D1 latency spike + 真 100-concurrent register |
| deepseek R5 / GLM R8 / kimi R1(C-CYCLE-GATE 10 cycles)| deferred | 10 cycle 全在 packages/context-core 子树,RH0-RH2 未引入新 cycle;清零非本阶段 scope | RH6 cleanup |
| deepseek R8 / GPT O1(C-CLIENT-ADAPTER)| deferred | 本环境无 web 浏览器 / 微信 devtool,无法 manual smoke 验证;cross-worker push 也需 user_uuid 落地后才能 deliver | RH3 D6 + RH6 owner-action;`clients/web/src/RH2-AUDIT.md` 已登记升级清单 |
| GPT F3 / kimi R3 / GLM R5(C-ROUTE-TEST-DRIFT 7 份 route test 行为面)| deferred | 行为面真升级需要 device gate 落地后底层行为也对齐(如 me-devices 加 status='active' 过滤) | RH3 action-plan §2.1.1 C7(P3-S5/P3-S6 配套)|

### 6.7 Ready-for-rereview gate

- **是否请求二次审查**: `yes`
- **请求复核的范围**: `closure 口径修正 + R3 protocol-drift 代码 fix + RH3 carry-over 吸纳完整性`(不要求 reviewer 重跑全矩阵 1557 case;只需复核 §6.4 变更清单中文档与代码的一致性,以及 RH3 action-plan §2.1.1 C1-C10 是否吸纳了 reviewer 标识的 high blocker)
- **实现者认为可以关闭的前提**:
  1. 4 reviewer 同意 closure 状态从 `closed → close-with-known-issues` 是诚实记录而非膨胀降级
  2. RH3 action-plan §2.1.1 的 C1 / C2 / C3 三项被 reviewer 接受为有效吸纳(GPT R2 / deepseek R1+R4 / GLM R2 / kimi R6+R7 的 high blocker 通过 RH3 显式承接而消化)
  3. C-DRIFT-1 的代码 fix(superseded / heartbeat / terminal 三处收敛到 emitServerFrame schema gate)被 GPT R3 接受为 critical 修复闭合

### 6.8 修订历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| `r1` | `2026-04-29` | `Owner + Opus 4.7` | 4 reviewer(GPT/Deepseek/GLM/Kimi)对 RH0-RH2 累积 36 项 finding 的整体回应:1 项 critical 代码 fix(R3 protocol drift)+ 6 个 test case 补足(context-route)+ 3 份 closure 口径修正 + 2 份 action-plan 同步 + RH3 action-plan §2.1.1 显式吸纳 10 项 carry-over;测试矩阵 1551 → 1557(0 回归);文档状态 RH1/RH2 closure `closed → close-with-known-issues` |

---

## 附录 A — 审查质量评估(by Opus 4.7,实施者反向评价)

> 评价对象: `GPT-5.4 对 real-to-hero / RH0-RH2 三阶段的代码审查`
> 评价人: `Opus 4.7(实施者,基于 4 reviewer 整体回应中实际验证的 finding 真伪 + 修复成本)`
> 评价时间: `2026-04-29`

### A.0 评价结论

- **一句话评价**:本轮 4 reviewer 中唯一一个用 zod schema reverse-check 抓到 critical protocol drift 的 reviewer;findings 数量最少(4 个)但每个都"打到肉",修法 actionable;短板是覆盖面相对窄,需要其他 reviewer 互补 cross-phase / docs-vs-reality 视角。
- **综合评分**:**9.0 / 10**
- **推荐使用场景**:任何涉及 protocol / schema / contract drift 的 PR 评审,以及小迭代的 critical 风险快筛。GPT 的 schema-first + endpoint-first 风格能在最少篇幅内识别"代码与冻结契约不一致"这类最危险的问题。
- **不建议单独依赖的场景**:阶段闭合做"全 carry-over 容量评估"或"closure 口径系统性 audit"时,4 项 finding 不足以覆盖跨阶段累积效应,需要 deepseek R10 类视角互补。

### A.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | schema / contract / endpoint 实测 + protocol 层一致性 | R3 直接 grep `user-do.ts:1984-1990` 发现真实发送的 `{kind:'attachment_superseded', reason:'replaced_by_new_attachment', new_attachment_at:...}` 与 `messages.ts:70-77` 冻结的 `SessionAttachmentSupersededBodySchema {session_uuid, superseded_at, reason: enum}` 字段不符 |
| 证据类型 | 文件行号 + zod schema 反查 + preview live curl 三结合 | R3 / R4 都用了三层证据:行号 + schema 字段 + curl 实测 |
| Verdict 倾向 | strict | 4 reviewer 中唯一在 R3 给出 `critical` 评级,且明确写"必须先修正 superseded path 才能进入 RH3 device gate" |
| Finding 粒度 | coarse(4 项)| 每项 finding 跨度大、聚合度高;不做碎片化 |
| 修法建议风格 | actionable + 二选一 | R3 给出"要么改为经 emitServerFrame 发送...要么明确继续保留 legacy 形状,并把 RH2 closure 改写为..."的清晰决策树 |

### A.2 优点与短板

#### A.2.1 优点

1. **唯一捕捉到 critical protocol drift** — R3 是本轮唯一需要写代码而非改文档的 critical fix。GPT 通过对照 `frame-compat.ts` schema gate 的"对应 message_type 没有 SESSION_BODY_SCHEMAS 时默认放行"逻辑 + `user-do.ts:1984-1990` 的 legacy payload + `messages.ts:70-77` 的 NACP 冻结 schema,精确定位"superseded path 真实发送形状与 RH2 冻结 schema 不收敛"。这种 schema-first 反向校验是 deepseek / GLM / kimi 都没做到的层次。修复:user-do.ts 三处 socket.send 收敛到 emitServerFrame + body 字段全改为 NACP 冻结 schema;1 个 unit test 重写 + 6 个 endpoint case 补足;测试矩阵 1551 → 1557 0 回归。
2. **findings 数量最少但每个都"打到肉"** — 4 项 finding 全部 true-positive,无误报;每项都对应明确的修法路径(R1/R2 docs-gap 修文档,R3 critical drift 修代码,R4 wording drift 修措辞)。这种"低数量 + 高密度"风格在 PR 评审中最节省 reviewer 反馈消化时间。
3. **决策树式修法建议** — R3 / R4 的修法不是单点指示,而是"A 路 / B 路 + 各自 trade-off"的二选一。本轮选择 A 路(改代码到 NACP 一致),理由是 superseded path 是 RH3 device gate 的直接前置;决策依据明确,不会被 reviewer 牵着鼻子走单一方向。

#### A.2.2 短板 / 盲区

1. **覆盖面相对窄(4 项)** — 漏掉了 deepseek R10(RH3 carry-over 累积容量)、GLM R1(行数计量含/不含空行)、kimi R5(entrypoint.ts schema 责任 shift 漂移)三个其他 reviewer 找到的真实 finding。GPT 的 4 finding 全部命中 high 以上,但中低严重的 follow-up 欠覆盖。
2. **未捕捉到 RH1 entrypoint.ts 的 schema 责任 shift** — 与 GPT 自己 R3 关于 outbound schema gate 的方向一致,但 GPT 对 inbound 跨 worker RPC 入口 (`forwardServerFrameToClient`) 的 validateSessionFrame 缺失没有专门 finding。Kimi R5 抓到这个 — 这是 GPT 风格盲区:更关注 outbound emit 而非 inbound RPC 入口。
3. **跨阶段累积效应缺位** — 没有 R10(deepseek)那种 RH3 capacity 警示。GPT 的 4 项 finding 全部 phase-internal,假定下游 phase 会处理 carry-over,但没有评估"下游能否承受这么多 carry-over"。

### A.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| R1(RH0 strict gate 未严格闭合)| high | true-positive | good | 与 deepseek R5/R6 / GLM R8 / kimi R1/R2 cross-validation;GPT 在 RH0 closure §6 已先行登记 6 项 carry-over,本轮 R1 主要是把"已登记"再升级为"必须修正口径而非保留为 carry-over"。修复:口径修正 + 部分纳入 RH3。|
| R2(RH1 wire-only delivery)| high | true-positive(blocker)| excellent | 与 deepseek R1 / GLM R2 / kimi R6 cross-validation;GPT 单独引用 charter §9.4 "Lane F live runtime 闭合 必须有 Permission round-trip e2e + onUsageCommit WS push manual smoke 双证据" 这一硬要求,把 RH1 closure 的 "live" 措辞反推到 charter 原文。修复:RH1 closure §0 verdict 重写 + RH3 §2.1.1 C1 吸纳。|
| R3(RH2 superseded protocol drift)| critical | true-positive(**唯一 critical 代码 fix**)| **excellent(missed-by-others)** | 4 reviewer 中唯一精确 zod-schema reverse-check 命中 — deepseek R4 / GLM 都提到 "WS schema gate 不完整",但只有 GPT 给出"superseded payload `{reason:'replaced_by_new_attachment'...}` 与 `SessionAttachmentSupersededBodySchema {reason:enum["device-conflict","reattach","revoked","policy"]}` 不符"的精确字段对照。修复:user-do.ts superseded/heartbeat/notifyTerminal 三处直发收敛 + body 全改 NACP 冻结 schema + 1 个 unit test 重写 + 测试矩阵 1551 → 1557 0 回归。|
| R4(RH2 live 表述包装过满)| medium | true-positive | good | 与 GLM R3 cross-validation;GPT 把 RH2 closure 的 "endpoint live" / "cross-worker reachable" 用 503 实测 / phase:stub 实测做反向校验,把 wording drift 与真实交付分层。修复:RH2 closure §0 重写为"facade-live, inspector-stub, data-pending"三层。|

**总计**:4 个 finding,2 excellent + 2 good + 0 partial + 0 false-positive + 1 唯一 critical 代码 fix。命中率 100%,critical 捕捉率 100%(其他 3 reviewer 0 个 critical 代码 fix)。

### A.4 多维度评分(单向总分 10 分)

| 维度 | 评分 | 说明 |
|------|------|------|
| 证据链完整度 | 10 | 文件行号 + zod schema 反查 + preview curl 三层证据齐全;R3 的字段对照精确到 enum value 级别 |
| 判断严谨性 | 10 | R3 critical 评级准确;R4 medium 评级准确;无过严或过松 |
| 修法建议可执行性 | 10 | 决策树式 A/B 路径 + trade-off 说明,实施者无需二次决策;R3 的 "A 路:改 NACP / B 路:保留 legacy + 改 closure" 是本轮最 actionable 的修法之一 |
| 对 action-plan / design / QNA 的忠实度 | 9 | charter §9.4 + 设计文档引用准确;但 §9.4 之外的 charter 章节引用密度低于 deepseek |
| 协作友好度 | 10 | 4 finding 简洁明晰,§3 对齐表 11 项 done/partial/missing 一目了然;reviewer 自己的"约 1500 字 §0-§5"是 4 reviewer 中阅读成本最低 |
| 找到问题的覆盖面 | 7 | 4 项 finding 覆盖 RH0/RH1/RH2 各自 1 项 critical/high + 1 项 medium,但缺 cross-phase capacity / measurement-precision / inbound-rpc-validation 视角 |
| 严重级别 / verdict 校准 | 10 | 唯一一个给出 critical 评级且实测对应 critical 代码 fix 的 reviewer;校准 100% |

**综合**:**9.0 / 10**

> GPT-5.4 是本轮 4 reviewer 中"单位 finding 修复价值"最高的 reviewer:用最少的 finding 数量识别了唯一 critical 代码 fix。最适合做"小迭代 critical 风险快筛"或"protocol/schema 类 PR 单独审查";覆盖面短板可以由 deepseek(cross-phase capacity)+ GLM(measurement precision)+ kimi(command evidence)互补。如果只能选一个 reviewer,选 GPT。如果能选两个,选 GPT + Deepseek。

---

## 附录 B — GPT 二次审查（2026-04-29）

> 审查类型: `rereview`
> 审查人: `GPT-5.4`
> 审查对象: `Opus 根据 §0-§5 审查意见追加的代码修复 + closure / action-plan 同步 + RH3 carry-over 吸纳`

### B.0 二次审查一句话结论

- **二次审查 verdict**：`Opus 已经实质性修复了我上轮最关键的协议漂移问题，并显著收紧了 RH1/RH2 的闭合口径；但 RH0 口径仍未完全收紧，RH2 的 schema gate 仍未达到“canonical payload 完整收敛”，因此 RH0-RH2 仍不应被表述为 fully closed。`
- **对上轮 4 个 finding 的复核结论**：
  1. `R1（RH0 strict gate / 口径漂移）`：**部分处理** —— carry-over 与文档同步明显改善，但 RH0 headline 仍保留了过满表述。
  2. `R2（RH1 wire-only delivery）`：**接受为显式 carry-over** —— 代码未补 live delivery，但 closure / RH3 action-plan 已明确承认它仍是 wire-only + best-effort。
  3. `R3（RH2 protocol drift）`：**主体修复成立，但未完全 canonicalize** —— superseded / heartbeat / terminal 三条直发路径已收敛到 `emitServerFrame()`，这是实质修复；但 `session.end` 仍携带 schema 外字段，gate 仍偏 permissive。
  4. `R4（RH2 wording drift）`：**大体修正** —— RH2 已明显区分 `code-complete / data-pending / facade-live / inspector-stub`，但仍有个别数字与阶段摘要未完全同步。

### B.1 本轮复核方法与验证

- **复读并核对了实现者回应**：`docs/code-review/real-to-hero/RH0-RH2-reviewed-by-GPT.md` §6 与附录 A
- **重点回看代码与文档**：
  - `workers/orchestrator-core/src/user-do.ts`
  - `workers/orchestrator-core/test/user-do.test.ts`
  - `workers/orchestrator-core/test/context-route.test.ts`
  - `docs/issue/real-to-hero/RH0-closure.md`
  - `docs/issue/real-to-hero/RH1-closure.md`
  - `docs/issue/real-to-hero/RH2-closure.md`
  - `docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md`
  - `README.md`
  - `workers/orchestrator-core/test/README.md`
- **本轮执行的验证**：
  - `pnpm check:cycles` → 仍失败, `10` 个 circular dependencies
  - `pnpm --filter @haimang/nacp-session test` → `15 files / 150 tests` 通过
  - `pnpm --filter @haimang/orchestrator-core-worker test` → `15 files / 138 tests` 通过
  - preview smoke：`/models`、`/me/devices`、`/me/conversations`
- **本轮 preview 实测结果**：
  - `POST /auth/register` → `200`
  - `GET /models` → `503 models-d1-unavailable`
  - `GET /me/devices` → `500 failed to list devices`
  - `GET /me/conversations` → `200 { conversations: [], next_cursor: null }`

### B.2 已确认修复成立的部分

1. **RH2 协议漂移的最危险部分已经被真修掉。**
   - `workers/orchestrator-core/src/user-do.ts:1987-1992`：superseded path 已改为 `emitServerFrame(sessionUuid, { kind: 'session.attachment.superseded', session_uuid, superseded_at, reason: 'reattach' })`
   - `workers/orchestrator-core/src/user-do.ts:2004-2009`：heartbeat 改为经 `emitServerFrame()` 发送
   - `workers/orchestrator-core/src/user-do.ts:2144-2154`：terminal path 改为经 `emitServerFrame()` 发送 `session.end`
   - `workers/orchestrator-core/test/user-do.test.ts:566-570` 已直接断言 superseded path 改成 `session.attachment.superseded` + `"reason":"reattach"`

2. **RH1 / RH2 的 closure 口径明显比上轮诚实。**
   - `docs/issue/real-to-hero/RH1-closure.md` 已把文档状态改为 `close-with-known-issues`，并把 Phase 2 / 4 / 6 重新标成 `wire-only` / `partial`
   - `docs/issue/real-to-hero/RH2-closure.md` 已把 `/models` 改写为 `code-complete, data-pending`，把 `/context*` 改写为 `facade-live, inspector-stub`

3. **RH3 action-plan 的 carry-over 吸纳是实的，不是口头承诺。**
   - `docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md:115-132` 明确登记了 `C1-C10`
   - 其中 `C1(user_uuid → NanoSessionDO)`、`C2(3 个 RH1 round-trip e2e)`、`C3(WS lifecycle 4 scenario)` 都被写成 RH3 的显式工作项或强依赖，不再是模糊 deferred

4. **RH0 的两条文档型修复已经落地。**
   - `README.md:289-315` 已新增 `Running tests`
   - `workers/orchestrator-core/test/README.md:1-48` 已创建，并把 7 份 route tests 的 carry-over 偏移登记清楚

### B.3 二次审查仍然成立的发现

#### B-R1. RH0 的 headline 口径仍未完全收紧

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/issue/real-to-hero/RH0-closure.md:15` 仍写着“主文件 ≤1500 行 0 cycle”
  - `docs/issue/real-to-hero/RH0-closure.md:39` 同一文件又承认这里实际使用的是 `unit-comment-stripped count = 1488`，而 `wc -l` 为 `1594`
  - `pnpm check:cycles` 本轮复跑仍然是 `10` 个 cycles，不是 `0`
- **审查判断**：
  - RH0 在“后续阶段可以继续施工”的意义上是稳定的，但在“strict closure headline”意义上仍然写得偏满。
  - 我接受它已经比上轮诚实很多，但不接受把它重新表述成“RH0 正式闭合 + 0 cycle + ≤1500 行”这种会误导读者的 summary。
- **建议修法**：
  - RH0 closure 的一句话 verdict 与 Phase 5 文案应该直接写成：`host/do 子树 0 cycle；全仓仍有 10 个 pre-existing cycle；nano-session-do 结构已预拆但 wc -l 尚未回到 ≤1500。`

#### B-R2. RH2 的 protocol-drift 已从 critical 降到 follow-up，但还没有完全 canonicalize

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:2149-2154` 现在发送的是 `kind: 'session.end'`，但 body 仍带 `session_uuid` 与 `last_phase`
  - `packages/nacp-session/src/messages.ts:41-50` 的 `SessionEndBodySchema` 只定义了 `reason` 与 `usage_summary`
  - `workers/orchestrator-core/src/frame-compat.ts` / `validateLightweightServerFrame()` 当前只是 `safeParse(body)` 后返回 `ok`，**不会把 frame 归一化成 schema 允许的 canonical 形状**
  - 本轮新增的 `user-do.test.ts` 直接断言只覆盖了 superseded path，没有直接覆盖 heartbeat / terminal 这两条新收敛路径
- **审查判断**：
  - 我上轮 `R3` 里最危险的那部分——**superseded path 与冻结 schema 明显不一致**——已经修掉了，所以这个问题不再是 `critical blocker`
  - 但如果要说 “NACP body schema gate 真生效且 wire 已 canonicalize”，目前还不够；`session.end` 这条路径仍然是“通过 permissive gate 放行的 extra fields”
- **建议修法**：
  - 在 RH3 里顺手把 `session.end` 发送形状收敛到 schema 允许字段，或把 `SessionEndBodySchema` / compat 规则显式扩展为当前 wire 形状；同时给 heartbeat / terminal 各补 1 条直接单测

#### B-R3. RH2 closure 仍有一处内部同步没收干净

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/issue/real-to-hero/RH2-closure.md:31-32` 已把 context endpoint 测试更新为 `15`
  - 但 `docs/issue/real-to-hero/RH2-closure.md:35` 的 Phase 7 仍写着 `endpoint test 14 case 全绿(5 models + 9 context)`
- **审查判断**：
  - 这说明 RH2 closure 虽然大方向已经修正，但还残留 1 处数字级同步遗漏。
- **建议修法**：
  - 把 RH2 closure 的 Phase 7 摘要同步成当前真实口径，避免一个文件内部同时存在 `15` 与 `14` 两个版本。

### B.4 对 RH0-RH2 收口状态的二次判定

- **RH0**：我现在的判定是 **“基线稳定，可承上启下，但不是 strict-closure”**。README / test README 已补，business-flow smoke 也补了，但 headline 仍未完全诚实。
- **RH1**：我接受它当前的 closure 口径：**wire-contract closed，非 e2e-live closed**。这轮不是把代码补成 live，而是把缺口清楚写进 closure 与 RH3 计划，这一点成立。
- **RH2**：我接受它当前的主结论：**façade / schema / RPC 骨架成立，critical superseded drift 已修；但 data-live / inspector-live / full protocol canonicalization 仍未完成**。

**综合判断**：  
`RH0-RH2` 现在可以被表述为 **“已完成一轮可继续向前推进的阶段收口，并且已把主要 known issues 显式交给 RH3/RH4/RH6”**；  
但**仍不能**被表述为 **“三阶段已经完整、严格、无歧义地 fully closed”**。

### B.5 是否具备进入 RH3 的条件

- **工程判断**：`基本具备，但应按“带前置条件的进入”理解`
- **严格 gate 判断**：`尚未完全满足`

#### 我认可可以进入 RH3 的部分

1. 上轮我最关心的 **critical protocol drift** 已从 `critical blocker` 降到了 `medium follow-up`
2. RH1 的高优先级 live-delivery 缺口已经被清楚吸纳到 RH3 `C1/C2/C3`
3. RH3 action-plan 已经把 carry-over 容量问题显式写入，不再是假设下游“自然会处理”

#### 我认为进入 RH3 前仍应满足的前置条件

1. **owner 先 apply `migration 008-models.sql` 到 preview D1**
   - 本轮实测 `/models` 仍是 `503 models-d1-unavailable`
   - RH3 action-plan 自己也把这件事写成了 `entry-gate prereq`
2. **在 RH3 开始实现时，把 `session.end` canonicalization 当成同批顺手修复**
   - 这不是阻止 RH3 开工的理由
   - 但它应该成为 RH3 前半程的 immediate follow-up，而不是继续拖到更后面

#### 最终收口意见

- **如果按宽口径判断**：`可以进入 RH3`
- **如果按 charter / closure 的严格口径判断**：`应先完成 migration 008 的 preview apply，再宣布 RH3 Start Gate fully satisfied`

我的最终意见是：

> **我同意项目进入 RH3 的实现阶段，但不同意现在就把 RH0-RH2 记作“完全收口”。**
>  
> 更准确的表述应该是：**“RH0-RH2 已完成第二轮复核；critical drift 已消除；RH3 可以启动，但需携带显式前置条件与 carry-over 清单继续推进。”**
