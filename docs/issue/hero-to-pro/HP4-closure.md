# HP4 Chat Lifecycle — Closure

> 服务业务簇: `hero-to-pro / HP4`
> 上游 action-plan: `docs/action-plan/hero-to-pro/HP4-action-plan.md`
> 上游 design: `docs/design/hero-to-pro/HP4-chat-lifecycle.md`
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md` Q13 / Q14 / Q15 / Q38
> 闭环日期: `2026-04-30`
> 文档状态: `partial`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| HP4 当前状态 | `partial-live`（close/delete/title + true cursor read model + conversation detail + checkpoint list/create/diff 已落地；retry / restore / rollback / cross-e2e 仍未收口） |
| lifecycle first wave | `done-first-wave`（`POST /sessions/{id}/close`、`DELETE /sessions/{id}`、`PATCH /sessions/{id}/title` 已 live） |
| read model | `done-first-wave`（`GET /me/sessions`、`GET /me/conversations` 改为 direct D1 cursor；`GET /conversations/{conversation_uuid}` 已 live） |
| checkpoint registry first wave | `done-first-wave`（`GET/POST /sessions/{id}/checkpoints` 与 `GET /sessions/{id}/checkpoints/{checkpoint_uuid}/diff` 已 live） |
| frozen law 对齐 | `done-first-wave`（close 未引入新状态；delete 第一版只 tombstone `deleted_at`；checkpoint surface 未复用 DO latest checkpoint 冒充产品面） |
| retry | `not-yet`（latest-turn retry / attempt chain public surface 未落） |
| restore job | `not-yet`（conversation_only restore、rollback、restart-safe 仍未接线） |
| 测试矩阵 | `partial-green`（orchestrator-core typecheck/build/test 通过；action-plan 要求的 agent-core restore wiring 与 cross-e2e 尚未完成） |
| clients/api-docs | `updated`（`README.md` / `me-sessions.md` / `session.md` / `error-index.md` 已同步 HP4 first-wave surface） |

---

## 1. Resolved 项（本轮 HP4 已落地、可直接消费）

| ID | 描述 | 证据 | 说明 |
|----|------|------|------|
| `R1` | lifecycle body schema 新增 `CloseBody` / `DeleteSessionBody` / `TitlePatchBody` | `workers/orchestrator-core/src/session-lifecycle.ts` | HP4 first-wave action body 不再依赖匿名 loose payload |
| `R2` | User DO 新增 `handleClose` / `handleDelete` / `handleTitle` | `workers/orchestrator-core/src/user-do/session-flow.ts`; `workers/orchestrator-core/src/user-do-runtime.ts` | lifecycle write owner 继续收敛在 session-flow，而不是 façade 直接乱写 D1 |
| `R3` | close 复用 `session_status='ended'`，并写 `ended_reason='closed_by_user'` | `workers/orchestrator-core/src/user-do/session-flow.ts`; `workers/orchestrator-core/src/session-truth.ts` | 符合 Q13，不新增 `closed` 状态 |
| `R4` | delete 按 conversation 维度 soft tombstone，只写 `nano_conversations.deleted_at` | `workers/orchestrator-core/src/user-do/session-flow.ts`; `workers/orchestrator-core/src/session-truth.ts` | 符合 Q14，第一版不加 `deleted_by_user_uuid` |
| `R5` | title 继续只写 `nano_conversations.title` | `workers/orchestrator-core/src/user-do/session-flow.ts`; `workers/orchestrator-core/src/session-truth.ts` | 没有分叉出 session-level title 真相 |
| `R6` | `/me/sessions` 改为 direct D1 true-cursor read model | `workers/orchestrator-core/src/index.ts`; `workers/orchestrator-core/src/session-truth.ts` | response 现在直接带 `ended_reason` / `title`，不再依赖 User DO hot index regroup |
| `R7` | `/me/conversations` 改为 direct conversation-level cursor query | `workers/orchestrator-core/src/index.ts`; `workers/orchestrator-core/src/session-truth.ts` | 不再先拉 session rows 再 façade regroup |
| `R8` | 新增 `GET /conversations/{conversation_uuid}` conversation detail surface | `workers/orchestrator-core/src/index.ts`; `workers/orchestrator-core/src/session-truth.ts` | client 现在可直接读取 title / latest_session / recent sessions |
| `R9` | 新增 checkpoint list/create/diff first-wave surface | `workers/orchestrator-core/src/index.ts`; `workers/orchestrator-core/src/session-truth.ts` | 用户创建 checkpoint 时固定写 `checkpoint_kind='user_named'`、`file_snapshot_status='none'` |
| `R10` | HP4 first-wave route/read-model/lifecycle 测试已补齐 | `workers/orchestrator-core/test/me-sessions-route.test.ts`; `workers/orchestrator-core/test/me-conversations-route.test.ts`; `workers/orchestrator-core/test/chat-lifecycle-route.test.ts`; `workers/orchestrator-core/test/user-do-chat-lifecycle.test.ts` | public surface 与 user-do 语义已有直接覆盖 |

---

## 2. Partial 项（HP4 已开工，但本轮未完成的 action-plan 条目）

| ID | 描述 | 当前完成度 | 后续 phase / 批次 | 说明 |
|----|------|-----------|-------------------|------|
| `P1` | latest-turn retry | `not-started-on-public-surface` | HP4 后续批次 | `turn_attempt` / supersede schema 已在 HP1，但 `/sessions/{id}/retry` 尚未接线 |
| `P2` | restore job orchestration | `not-wired` | HP4 后续批次 | `nano_checkpoint_restore_jobs` 已有 schema，尚未接 public route / coordinator / DO restore seam |
| `P3` | rollback + restart safety | `not-wired` | HP4 后续批次 | 还没有 D1 supersede 反标 / restore job `rolled_back` 可见链 |
| `P4` | lifecycle / retry / restore cross-e2e | `not-run` | HP4 后续批次 | 当前只完成 orchestrator-core 单包测试，未进入 `test/cross-e2e` |

---

## 3. Retained 项（本轮显式保留 / 不改）

| ID | 描述 | 来源 frozen 法律 | 后续去向 |
|----|------|-----------------|----------|
| `K1` | close 不新增 `closed` 状态 | Q13 | HP4 后续批次继续沿 `ended_reason` 演进 |
| `K2` | delete 第一版不引入 `deleted_by_user_uuid` / undelete | Q14 | 如 future 需要恢复面，必须重开 design |
| `K3` | 产品级 checkpoint / restore 不复用 DO latest checkpoint 作为对外 registry | Q15 | HP4 restore 批次必须继续遵守 `D1 checkpoint registry → D1 message ledger → DO snapshot` |
| `K4` | HP4 不自行发明 delete / restore 的 confirmation plane | Q38 + HP5 边界 | 后续统一交给 HP5 confirmation control plane |

---

## 4. F1-F17 chronic status 登记（强制）

| chronic | 说明 | HP4 verdict | 备注 |
|---------|------|-------------|------|
| F1 | 公共入口模型字段透传断裂 | `closed-by-HP0` | 本轮未触碰 |
| F2 | system prompt model-aware suffix 缺失 | `not-touched` | 仍归 HP2 / HP3 runtime 批次 |
| F3 | session-level current model 与 alias resolution | `closed-by-HP2-first-wave` | HP2 已补 session current-model API、alias/detail resolve 与 turn requested/effective audit；HP4 retry 后续可直接消费这条真相链 |
| F4 | context state machine（compact / branch / fork） | `carried-from-HP3-partial` | HP3 first wave 已落；本轮不扩写 |
| F5 | chat lifecycle | `partial-by-HP4` | close/delete/title/read model/checkpoint diff 已 live；retry/restore 未完 |
| F6 | confirmation control plane | `not-touched` | HP5 |
| F7 | tool workspace state machine | `not-touched` | HP6 |
| F8 | checkpoint / revert | `partial-by-HP4` | checkpoint registry / diff 已 live；restore / rollback 仍未收口 |
| F9 | runtime hardening | `not-touched` | HP8 |
| F10 | R29 postmortem & residue verdict | `handed-to-platform` | HP8-B / HP10 |
| F11 | API docs + 手工证据 | `partial-by-HP4` | client API docs 已更新；manual evidence 仍归 HP9 |
| F12 | final closure | `not-touched` | HP10 |
| F13 | observability drift / metrics 完整性 | `partial-by-HP4` | lifecycle durable activity 第一轮已接；完整 observability 仍归 HP8/HP9 |
| F14 | tenant-scoped storage 全面落地 | `not-touched` | HP6 / HP7 |
| F15 | DO checkpoint vs product checkpoint registry 解耦 | `consumed-by-HP4-first-wave` | 本轮 checkpoint surface 明确消费 D1 registry，而非 DO latest key |
| F16 | confirmation_pending kernel wait reason 统一 | `not-touched` | HP5 / HP6 |
| F17 | `<model_switch>` developer message strip-then-recover during compact | `carried-from-HP3-partial` | 仍待 HP3 / HP7 后续批次 |

---

## 5. 下游 phase / 后续批次交接

| 接收对象 | 交接物 | 形式 | 本 closure 引用 |
|----------|--------|------|----------------|
| HP4 后续批次 | retry / restore / rollback / restart-safe coordinator | 必修 | §2 P1-P4 |
| HP5 | delete / restore confirmation consumer 边界 | 设计输入 | §3 K4 |
| HP7 | product checkpoint registry first-wave truth | 可直接消费 | §1 R9 |
| HP9 | 更新后的 HP4 client docs surface | 文档输入 | §0 / §6 |

---

## 6. 测试与证据矩阵

| 类型 | 命令 / 路径 | 状态 |
|------|-------------|------|
| typecheck (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker typecheck` | ✅ |
| build (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker build` | ✅ |
| test (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker test` | ✅ |
| typecheck (nacp-core) | `pnpm --filter @haimang/nacp-core typecheck` | ✅ |
| build (nacp-core) | `pnpm --filter @haimang/nacp-core build` | ✅ |
| test (nacp-core) | `pnpm --filter @haimang/nacp-core test` | ✅ |
| new route tests | `workers/orchestrator-core/test/chat-lifecycle-route.test.ts` | ✅ |
| new read-model tests | `workers/orchestrator-core/test/me-sessions-route.test.ts`; `workers/orchestrator-core/test/me-conversations-route.test.ts` | ✅ |
| new user-do tests | `workers/orchestrator-core/test/user-do-chat-lifecycle.test.ts` | ✅ |
| `git --no-pager diff --check` | workspace diff hygiene | ✅ |
| agent-core restore wiring | not run | n/a |
| `pnpm test:cross-e2e` | not run | n/a |

---

## 7. 收口意见

1. **可以确认收口的，是 HP4 的 first wave，而不是整个 HP4。**
2. **可以立即被后续 phase / client 消费的，是 close/delete/title、true cursor read model、conversation detail、checkpoint list/create/diff 这条链。**
3. **还不能宣称完成的，是 retry、restore job、rollback / restart-safe、一致性 e2e 与 full HP4 closure。**
