# HP2 Model State Machine — Closure

> 服务业务簇: `hero-to-pro / HP2`
> 上游 action-plan: `docs/action-plan/hero-to-pro/HP2-action-plan.md`
> 上游 design: `docs/design/hero-to-pro/HP2-model-state-machine.md`
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md` Q7 / Q8 / Q9
> 闭环日期: `2026-04-30`
> 文档状态: `partial`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| HP2 当前状态 | `partial-live`（control-plane + durable audit first wave 已落地；`<model_switch>` / `model.fallback` / cross-e2e 仍未收口） |
| model control plane | `done-first-wave`（`GET /models/{id}`、`GET/PATCH /sessions/{id}/model` 已 live） |
| alias / detail | `done-first-wave`（team-scoped alias resolve、list aliases、single-model detail 已 live） |
| runtime truth | `done-first-wave`（`turn override > session default > global default` 已接到 `/start` / `/messages`；requested/effective model audit 已落 D1） |
| schema correction | `done-first-wave`（新增 `014-session-model-fallback-reason.sql`，补齐 owner 已冻结的 `fallback_reason` durable 列） |
| `<model_switch>` | `not-yet` |
| `model.fallback` stream event | `not-yet` |
| 测试矩阵 | `partial-green`（orchestrator-core typecheck/build/test 通过；agent-core deeper wiring 与 cross-e2e 尚未进入） |
| clients/api-docs | `updated`（`README.md` / `session.md` / `error-index.md` 已同步 HP2 first-wave surface） |

---

## 1. Resolved 项（本轮 HP2 已落地、可直接消费）

| ID | 描述 | 证据 | 说明 |
|----|------|------|------|
| `R1` | façade 新增 `GET /models/{id}` | `workers/orchestrator-core/src/index.ts` | 支持 encoded canonical model id 与 `@alias/*`，返回 full metadata + alias info |
| `R2` | façade 新增 `GET/PATCH /sessions/{id}/model` | `workers/orchestrator-core/src/index.ts` | session default model / reasoning 第一次成为独立产品面 |
| `R3` | `/models` list 升级为带 alias 集的 control-plane catalog | `workers/orchestrator-core/src/index.ts`; `workers/orchestrator-core/src/session-truth.ts` | catalog 不再只是粗列表 |
| `R4` | `session-truth` 新增 alias/detail resolve、global default 选取、session model state 与 latest turn model audit | `workers/orchestrator-core/src/session-truth.ts` | public route 与 runtime 复用同一套 D1 真相源 |
| `R5` | `/start` 与 `/messages` 接上 `turn override > session default > global default`，并把 requested/effective model + reasoning 落入 durable turn truth | `workers/orchestrator-core/src/user-do/session-flow.ts`; `workers/orchestrator-core/src/user-do/message-runtime.ts`; `workers/orchestrator-core/src/user-do/durable-truth.ts` | HP3 compact / HP4 retry 后续终于有稳定的 model truth 输入 |
| `R6` | 按 charter R8 补出 `fallback_reason` schema correction | `workers/orchestrator-core/migrations/014-session-model-fallback-reason.sql`; `workers/orchestrator-core/test/migrations-schema-freeze.test.ts` | 修正 HP1/HP2 之间真实存在的 schema blind spot |
| `R7` | 新增 HP2 first-wave 直接测试 | `workers/orchestrator-core/test/models-route.test.ts`; `workers/orchestrator-core/test/session-model-route.test.ts` | route / alias / reasoning normalization / correction ledger 都有直接覆盖 |

---

## 2. Partial 项（HP2 已开工，但本轮未完成的 action-plan 条目）

| ID | 描述 | 当前完成度 | 后续 phase / 批次 | 说明 |
|----|------|-----------|-------------------|------|
| `P1` | agent-core explicit request assembly 深接线 | `closed-by-review-fix` | 已在 HP0-HP4 复审中补齐 | `runtime-mainline` 现已显式把 `modelId` / `reasoning` 送入 request builder，并在调用前读取 `base_instructions_suffix` 接到 system prompt seam |
| `P2` | `<model_switch>` developer message | `not-started` | HP2/HP3 联合 | 本轮未把跨模型切换注入 developer message |
| `P3` | `model.fallback` stream event + single-step fallback execution | `not-started` | HP2 后续批次 | 本轮只补了 durable 列与 future seam，未真正触发 fallback 链 |
| `P4` | cross-e2e matrix | `not-run` | HP2 后续批次 | `reasoning↔non-reasoning` / `vision↔non-vision` / alias / fallback 的 cross-e2e 尚未进入 |

---

## 3. Retained 项（本轮显式保留 / 不改）

| ID | 描述 | 来源 frozen 法律 | 后续去向 |
|----|------|-----------------|----------|
| `K1` | session default clear 继续以 `{ model_id: null }` 表达 | Q7 | 后续客户端直接沿此协议消费 |
| `K2` | fallback 第一版仍然只允许 single-step | Q8 | `model.fallback` 实现时必须继续遵守 |
| `K3` | 仅 reasoning effort 变化不注入 `<model_switch>` | Q9 | 后续 `<model_switch>` 实现时继续遵守 |
| `K4` | 当前 schema 仍没有 per-model `default_reasoning_effort` 列 | repo reality | 本轮以 `supported_reasoning_levels` 首项作为 normalized effort 的 server-side default；若 future 要精确建模，必须走新增 schema/design |

---

## 4. F1-F17 chronic status 登记（强制）

| chronic | 说明 | HP2 verdict | 备注 |
|---------|------|-------------|------|
| F1 | 公共入口模型字段透传断裂 | `closed-by-HP0` | 本轮未回退 |
| F2 | system prompt model-aware suffix 缺失 | `closed-by-review-fix` | HP0-HP4 复审期间已在 agent-core `runtime-mainline` 真接线：D1 `base_instructions_suffix` 会随显式 `modelId` 注入 system prompt seam |
| F3 | session-level current model 与 alias resolution | `closed-by-HP2-first-wave` | 本轮已 live session current-model API + alias/detail + turn audit |
| F4 | context state machine（compact / branch / fork） | `enabled-by-HP2` | HP3 现在可直接消费 `effective_model_id` / session default truth |
| F5 | chat lifecycle | `enabled-by-HP2` | HP4 retry 后续已具备 requested/effective model audit 前提 |
| F6 | confirmation control plane | `not-touched` | HP5 |
| F7 | tool workspace state machine | `not-touched` | HP6 |
| F8 | checkpoint / revert | `not-touched` | HP7 |
| F9 | runtime hardening | `not-touched` | HP8 |
| F10 | R29 postmortem & residue verdict | `handed-to-platform` | HP8-B / HP10 |
| F11 | API docs + 手工证据 | `partial-by-HP2` | client API docs 已更新；manual evidence 仍归 HP9 |
| F12 | final closure | `not-touched` | HP10 |
| F13 | observability drift / metrics 完整性 | `not-touched` | HP8/HP9 |
| F14 | tenant-scoped storage 全面落地 | `not-touched` | HP6 / HP7 |
| F15 | DO checkpoint vs product checkpoint registry 解耦 | `not-touched` | HP7 |
| F16 | confirmation_pending kernel wait reason 统一 | `not-touched` | HP5 / HP6 |
| F17 | `<model_switch>` developer message strip-then-recover during compact | `not-yet` | 仍待 HP2/HP3/HP7 联合后续批次 |

---

## 5. 下游 phase / 后续批次交接

| 接收对象 | 交接物 | 形式 | 本 closure 引用 |
|----------|--------|------|----------------|
| HP3 | `effective_model_id` / session current model API / alias detail truth | 可直接消费 | §1 R2-R5 |
| HP4 | retry 所需的 `requested_model_id` / `effective_model_id` / `fallback_reason` durable 基线 | 可直接消费 | §1 R5-R6 |
| HP9 | 更新后的 model control-plane client docs | 文档输入 | §0 / §6 |

---

## 6. 测试与证据矩阵

| 类型 | 命令 / 路径 | 状态 |
|------|-------------|------|
| typecheck (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker typecheck` | ✅ |
| build (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker build` | ✅ |
| test (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker test` | ✅ |
| new route tests | `workers/orchestrator-core/test/models-route.test.ts`; `workers/orchestrator-core/test/session-model-route.test.ts` | ✅ |
| schema correction test | `workers/orchestrator-core/test/migrations-schema-freeze.test.ts` | ✅ |
| `git --no-pager diff --check` | workspace diff hygiene | ✅ |
| typecheck (agent-core) | `pnpm --filter @haimang/agent-core-worker typecheck` | ✅ |
| build (agent-core) | `pnpm --filter @haimang/agent-core-worker build` | ✅ |
| test (agent-core) | `pnpm --filter @haimang/agent-core-worker test` | ✅ |
| `pnpm test:cross-e2e` | not run | n/a |

---

## 7. 收口意见

1. **这次真正完成的，是 HP2 的 first wave：model control plane、alias/detail、session default、requested/effective turn audit 与 `fallback_reason` correction。**
2. **HP3 / HP4 已经可以基于这轮结果继续推进：compact 能读取稳定 `effective_model_id`，retry 也终于有了 requested/effective model durable truth。**
3. **还不能宣称完成的，是 `<model_switch>`、`model.fallback`、agent-core deeper cleanup 与 cross-e2e，因此 HP2 当前 verdict 仍是 `partial-live`。**
