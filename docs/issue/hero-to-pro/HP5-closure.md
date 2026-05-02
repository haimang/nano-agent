# HP5 Confirmation Control Plane — Closure

> 服务业务簇: `hero-to-pro / HP5`
> 上游 action-plan: `docs/action-plan/hero-to-pro/HP5-action-plan.md`
> 上游 design: `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md` Q16 / Q17 / Q18 / Q39
> 闭环日期: `2026-04-30`
> 文档状态: `partial`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| HP5 当前状态 | `partial-live`(registry / API / frame / kernel rename / dispatcher injection / legacy compat dual-write 已落地;PreToolUse live caller 与 cross-e2e 15-18 仍未收口) |
| confirmation registry | `done-first-wave`(`D1ConfirmationControlPlane` 写入/读取/decision 全部走 `nano_session_confirmations` 单一真相) |
| public surface | `done-first-wave`(`GET /sessions/{id}/confirmations`、`GET .../{uuid}`、`POST .../{uuid}/decision` 三件套已 live) |
| protocol frames | `done-first-wave`(`session.confirmation.request` / `session.confirmation.update` 已进入 nacp-session registry,phase/role/direction matrix 已对齐;legacy permission/elicitation 帧保留为 compat) |
| kernel wait unification | `done-first-wave`(`approval_pending` → `confirmation_pending`;kind 不进入 enum,符合 Q17;Q39 拒绝并行 alias) |
| HookDispatcher 真注入 | `dispatcher-injected / caller-deferred`(runtime-assembly 不再可选;每个 session DO 都会构造 `HookDispatcher` + `LocalTsRuntime`,但 PreToolUse live caller 仍未在 HP5 内形成 producer path,后续由 pro-to-product PP4 承接) |
| row-first dual-write law | `done-first-wave`(legacy `permission/decision` 与 `elicitation/answer` 在 KV / RPC 写入前 lazily 创建/转移 confirmation row;失败/冲突走 409,不静默覆盖;取消映射 `superseded` 而非 `failed`) |
| live caller (PreToolUse permission / elicitation request) | `not-yet`(emitter 仍未在 emit 时主动 row-create;只有 decision 一侧落地) |
| 测试矩阵 | `partial-green`(`@haimang/nacp-session` / `@haimang/agent-core-worker` / `@haimang/orchestrator-core-worker` 单包测试全绿;cross-e2e 15-18 未运行) |
| clients/api-docs | `not-touched`(client API docs 仍归 HP9 文档批次) |

---

## 1. Resolved 项(本轮 HP5 已落地、可直接消费)

| ID | 描述 | 证据 | 说明 |
|----|------|------|------|
| `R1` | `D1ConfirmationControlPlane` durable helper:create / read / list / applyDecision / markSupersededOnDualWriteFailure | `workers/orchestrator-core/src/confirmation-control-plane.ts` | pending/resolved confirmation 第一次有单一 durable owner |
| `R2` | 7-kind 与 6-status 冻结进入运行时:`CONFIRMATION_KINDS` 与 `CONFIRMATION_STATUSES` 直接消费 HP1 migration 012 CHECK | `workers/orchestrator-core/src/confirmation-control-plane.ts` + `workers/orchestrator-core/migrations/012-session-confirmations.sql` | Q18(无 `tool_cancel` / `custom`)与 Q16(无 `failed`)在代码层硬化 |
| `R3` | public façade `/sessions/{id}/confirmations` 三件套(list / detail / decision)已 live;listing 支持 `?status=` 过滤;decision 冲突返回 409 | `workers/orchestrator-core/src/index.ts` | 客户端不再只能用碎片化 legacy ingress |
| `R4` | nacp-session 协议族新增 `session.confirmation.request` / `session.confirmation.update`,带统一 7-kind / 6-status enum | `packages/nacp-session/src/messages.ts` + `packages/nacp-session/src/index.ts` | generic frame 与 phase/direction/role matrix 已对齐 |
| `R5` | direction matrix 与 phase 矩阵增项:confirmation 帧仅 server → client,`attached` / `turn_running` 阶段允许 | `packages/nacp-session/src/type-direction-matrix.ts` + `packages/nacp-session/src/session-registry.ts` | 客户端不能 produce confirmation frame,符合 control plane 单向语义 |
| `R6` | kernel 内部统一 `confirmation_pending`,`approval_pending` 完全淘汰;`classifyInterrupt` / `canResumeFrom` / scheduler 重映射 | `workers/agent-core/src/kernel/types.ts` + `workers/agent-core/src/kernel/interrupt.ts` | 符合 Q17;不并行多套 pending enum |
| `R7` | session DO runtime-assembly 真构造 `HookDispatcher`(配 `LocalTsRuntime`)并注入 mainline kernel runner;assembly 暴露 `hookDispatcher` 供后续 phase 注册 handler | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` + `workers/agent-core/src/host/runtime-mainline.ts` | dispatcher 不再是 "有就用、没有就算了" 的历史 seam |
| `R8` | row-first dual-write law 在 legacy `permission/decision` / `elicitation/answer` 收编实现:row 先于 KV / RPC 写入,冲突走 409,取消走 `superseded` | `workers/orchestrator-core/src/user-do/surface-runtime.ts`(`ensureConfirmationDecision` helper) | legacy alias 与 `/confirmations` 收敛到同一 truth |
| `R9` | 测试覆盖:registry helper / route / dual-write / dispatcher injection / kernel rename 共新增 5 个 test 文件、约 30 个新增用例 | `workers/orchestrator-core/test/confirmation-control-plane.test.ts` 等 | F1-R8 各 ID 都有可重复的执行证据 |

---

## 2. Partial 项(HP5 已开工,但本轮未完成的 action-plan 条目)

| ID | 描述 | 当前完成度 | 后续 phase / 批次 | 说明 |
|----|------|-----------|-------------------|------|
| `P1` | PreToolUse permission live emitter:`emitPermissionRequestAndAwait()` 在 emit 时主动 row-create,而不仅在 decision 时 lazy upsert | `not-wired-on-emitter-side` | HP5 后续批次 / HP6 接线 | dispatcher 已就位,Session DO emitter 仍走旧 frame |
| `P2` | elicitation live request 收编:emitter 同 P1,emit 时直接写 row 并以 `session.confirmation.request` 推帧 | `not-wired-on-emitter-side` | HP5 后续批次 | 同 P1 |
| `P3` | row-first dual-write 在第二步失败时自动 escalate `superseded`(目前只在显式调用 `markSupersededOnDualWriteFailure` 时执行) | `helper-only` | HP5 后续批次 | 等 P1/P2 真正接 emitter 后,可自然发生 |
| `P4` | cross-e2e 15-18(allow / deny / elicitation roundtrip / usage push live) | `not-run` | HP5 后续批次 | 需要真实 6-worker stack;HP3/HP4 closure 也都把 cross-e2e 留到后批次 |
| `P5` | confirmation kind 5 个非 live(model_switch / context_compact / fallback_model / checkpoint_restore / context_loss)的真接线 | `schema-frozen-only` | HP3 / HP4 / HP6 / HP7 | HP5 第一版只 live `tool_permission` + `elicitation`;其余 kind 等对应 phase 实施时直接复用统一 plane |

---

## 3. Retained 项(本轮显式保留 / 不改)

| ID | 描述 | 来源 frozen 法律 | 后续去向 |
|----|------|-----------------|----------|
| `K1` | legacy `session.permission.request/decision` 与 `session.elicitation.request/answer` 帧族保留为 compat alias | Q16 + 兼容窗口 | HP10 文档包再决定是否 deprecate;HP5 内部不再保留第二套 truth |
| `K2` | kernel 不为 alias 名分裂语义;若未来真有外部命名兼容,只允许在边界做 wrapper 而非新 enum | Q39 | 当前 not-triggered |
| `K3` | confirmation 不引入 `failed` status;dual-write 第二步失败走 `superseded` + audit | Q16 | 后续 phase 必须沿用 |
| `K4` | confirmation 不引入 `tool_cancel` kind | Q18 | HP6 cancel 走 `tool.call.cancelled` stream event,而不是 confirmation |

---

## 4. F1-F17 chronic status 登记(强制)

| chronic | 说明 | HP5 verdict | 备注 |
|---------|------|-------------|------|
| F1 | 公共入口模型字段透传断裂 | `closed-by-HP0` | 本轮未触碰 |
| F2 | system prompt model-aware suffix 缺失 | `closed-by-review-fix` | 本轮未触碰 |
| F3 | session-level current model 与 alias resolution | `closed-by-HP2-first-wave` | 本轮未触碰 |
| F4 | context state machine(compact / branch / fork) | `carried-from-HP3-partial` | 本轮未扩写 |
| F5 | chat lifecycle | `carried-from-HP4-partial` | 本轮未扩写 |
| F6 | confirmation control plane | `partial-by-HP5` | registry / API / frame / kernel / dispatcher / dual-write 已 live;emitter live caller 与 cross-e2e 未完 |
| F7 | tool workspace state machine | `not-touched` | HP6 |
| F8 | checkpoint / revert | `partial-by-HP4` | 本轮未扩写 |
| F9 | runtime hardening | `not-touched` | HP8 |
| F10 | R29 postmortem & residue verdict | `retained-with-reason` | owner-action；由 HP8 / final closure 显式保留，不再写成 handed-to-platform |
| F11 | API docs + 手工证据 | `partial-by-HP3-and-HP4` | client API docs 仍归 HP9;本轮未扩写 |
| F12 | final closure | `not-touched` | HP10 |
| F13 | observability drift / metrics 完整性 | `partial-by-HP3` | usage push live 仍待 18 号 e2e |
| F14 | tenant-scoped storage 全面落地 | `not-touched` | HP6 / HP7 |
| F15 | DO checkpoint vs product checkpoint registry 解耦 | `closed-by-HP1` | 本轮未触碰 |
| F16 | confirmation_pending kernel wait reason 统一 | `closed-by-HP5` | `approval_pending` 已彻底改名为 `confirmation_pending`,Q17 在代码层硬化 |
| F17 | `<model_switch>` developer message strip-then-recover during compact | `partial-by-HP3` | 本轮未触碰 |

---

## 5. 7-kind readiness matrix(强制 — 与 Q18 对齐)

| kind | HP5 first-wave 是否 live | live writer | 备注 |
|------|--------------------------|-------------|------|
| `tool_permission` | ✅ live(via legacy `permission/decision` compat alias) | `surface-runtime.handlePermissionDecision` | emitter 侧 row-create 留给 HP5 后续批次 |
| `elicitation` | ✅ live(via legacy `elicitation/answer` compat alias) | `surface-runtime.handleElicitationAnswer` | 同上 |
| `model_switch` | ⛔ schema-frozen-only | — | HP2 后续 / HP4 后续可直接复用 plane |
| `context_compact` | ⛔ schema-frozen-only | — | HP3 后续(manual compact 升级版) |
| `fallback_model` | ⛔ schema-frozen-only | — | HP2 后续 |
| `checkpoint_restore` | ⛔ schema-frozen-only | — | HP4 / HP7 后续 |
| `context_loss` | ⛔ schema-frozen-only | — | HP3 / HP7 后续 |

---

## 6. 下游 phase / 后续批次交接

| 接收对象 | 交接物 | 形式 | 本 closure 引用 |
|----------|--------|------|----------------|
| HP5 后续批次 | PreToolUse / elicitation emitter 侧 row-create + cross-e2e 15-18 | 必修 | §2 P1-P4 |
| HP6 | tool cancel 不入 confirmation kind 的边界 / `tool.call.cancelled` 由 stream event 承载 | 设计输入 | §3 K4 |
| HP7 | `checkpoint_restore` 与 `context_loss` kind 已就位,直接 plane.create/applyDecision 即可 | 可直接消费 | §5 readiness matrix |
| HP9 | `/sessions/{id}/confirmations` 三件套 + `session.confirmation.*` 帧 + 7-kind/6-status enum 的客户端文档 | 文档输入 | §0 / §1 R3-R5 |

---

## 7. 测试与证据矩阵

| 类型 | 命令 / 路径 | 状态 |
|------|-------------|------|
| typecheck (nacp-session) | `pnpm --filter @haimang/nacp-session typecheck` | ✅ |
| build (nacp-session) | `pnpm --filter @haimang/nacp-session build` | ✅ |
| test (nacp-session) | `pnpm --filter @haimang/nacp-session test` | ✅ 171/171 |
| typecheck (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker typecheck` | ✅ |
| test (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker test` | ✅ 239/239 |
| typecheck (agent-core) | `pnpm --filter @haimang/agent-core-worker typecheck` | ✅ |
| test (agent-core) | `pnpm --filter @haimang/agent-core-worker test` | ✅ 1077/1077 |
| 新增 confirmation registry tests | `workers/orchestrator-core/test/confirmation-control-plane.test.ts` | ✅ 10 |
| 新增 confirmation route tests | `workers/orchestrator-core/test/confirmation-route.test.ts` | ✅ 7 |
| 新增 confirmation dual-write tests | `workers/orchestrator-core/test/confirmation-dual-write.test.ts` | ✅ 5 |
| 新增 confirmation frame tests | `packages/nacp-session/test/hp5-confirmation-messages.test.ts` | ✅ 18 |
| 新增 dispatcher injection tests | `workers/agent-core/test/host/do/runtime-assembly.dispatcher.test.ts` | ✅ 2 |
| `pnpm test:cross-e2e` (15-18) | not run | n/a |

---

## 8. 收口意见

1. **可以确认收口的,是 HP5 的 first wave(registry / API / frame / kernel rename / dispatcher injection / legacy compat dual-write),而不是整个 HP5。**
2. **可以立即被后续 phase 消费的,是 `D1ConfirmationControlPlane` + `/confirmations` 三件套 + `session.confirmation.*` 帧族 + `confirmation_pending` 单一 wait reason + assembly-exposed `HookDispatcher` substrate；但这不等于 PreToolUse caller 已在 HP5 内闭环。**
3. **还不能宣称完成的,是 emitter 侧 row-first row-create、PreToolUse 真接线、5 个非 live kind 与 cross-e2e 15-18。**
