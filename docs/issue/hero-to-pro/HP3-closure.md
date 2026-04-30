# HP3 Context State Machine — Closure

> 服务业务簇: `hero-to-pro / HP3`
> 上游 action-plan: `docs/action-plan/hero-to-pro/HP3-action-plan.md`
> 上游 design: `docs/design/hero-to-pro/HP3-context-state-machine.md`
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md` Q10 / Q11 / Q12
> 闭环日期: `2026-04-30`
> 文档状态: `partial`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| HP3 当前状态 | `partial-live`（context control-plane first wave 已落地；runtime owner / auto-compact / full strip-recover 仍未收口） |
| stub 清理 | `done-first-wave`（`context-core.getContextSnapshot` / `triggerContextSnapshot` / `triggerCompact` 不再返回 `phase:"stub"`） |
| public surface | `done-first-wave`（`probe` / `layers` / `compact/preview` / `compact` / `compact/jobs/{id}` 已 live；`GET /context` 保留为 probe alias） |
| durable truth | `done-first-wave`（复用 002 `nano_conversation_context_snapshots` + 013 `compact_boundary` checkpoint handle，无新增 schema） |
| manual compact | `done-first-wave`（deterministic compact summary + checkpoint-backed job reread） |
| auto-compact / runtime owner | `not-yet`（agent-core 仍未把 `compactRequired` 改成 model-aware live decision，`CrossTurnContextManager` 也未成为唯一 prompt owner） |
| strip-then-recover full contract | `not-yet`（第一轮只在 preview/job payload 中登记 `protected_fragment_kinds`，未把 recover 接回下一次真实 prompt） |
| 测试矩阵 | `partial-green`（context-core / orchestrator-core typecheck + build + test 通过；action-plan 要求的 agent-core runtime wiring 与 cross-e2e 尚未完成） |
| clients/api-docs | `updated`（`session.md` / `README.md` 已同步新的 context route matrix 与 probe / preview / job payload） |

---

## 1. Resolved 项（本轮 HP3 已落地、可直接消费）

| ID | 描述 | 证据 | 说明 |
|----|------|------|------|
| `R1` | orchestrator-core 新增 `context-control-plane` durable helper，统一读取 durable snapshot / history / usage / context snapshots / latest compact boundary / model profile | `workers/orchestrator-core/src/context-control-plane.ts` | HP3 control-plane 不再依赖 RH2 stub |
| `R2` | orchestrator-core WorkerEntrypoint 暴露 `readContextDurableState` / `createContextSnapshot` / `commitContextCompact` / `readContextCompactJob` 四个内部 RPC | `workers/orchestrator-core/src/entrypoint.ts` | context-core 无需新增 D1 binding |
| `R3` | context-core 新增 control-plane 组装逻辑，基于 durable truth 派生 probe、canonical layers、preview 与 deterministic compact summary | `workers/context-core/src/control-plane.ts` | 与 `ContextAssembler` canonical order 对齐 |
| `R4` | context-core 旧三 RPC 解 stub；新增 `getContextProbe` / `getContextLayers` / `previewCompact` / `getCompactJob` | `workers/context-core/src/index.ts` | public façade 不再只能拿到 `phase:"stub"` |
| `R5` | public façade 从 coarse `/context` 三件套扩成五个 product-facing surface，同时保留 `GET /context` 兼容 alias | `workers/orchestrator-core/src/index.ts` | client 首次可显式读取 probe / layers / preview / jobs |
| `R6` | manual compact 第一轮复用 `nano_session_checkpoints.checkpoint_kind='compact_boundary'` 作为 durable job handle，并关联 `nano_conversation_context_snapshots` 保存 summary payload | `workers/orchestrator-core/src/context-control-plane.ts`; `workers/orchestrator-core/migrations/013-product-checkpoints.sql` | 遵守 HP1 freeze，未新增 `nano_compact_jobs` |
| `R7` | compact 完成时写入 `compact.notify` stream-event，`/context/compact/jobs/{id}` 可跨 worker 重读 | `workers/orchestrator-core/src/context-control-plane.ts` | job handle 不再只是一次性返回值 |
| `R8` | 新增 / 更新测试覆盖 HP3 first-wave public & RPC surface | `workers/context-core/test/rpc-context-control-plane.test.ts`; `workers/orchestrator-core/test/context-route.test.ts` | probe/layers/preview/job 都有直接测试入口 |

---

## 2. Partial 项（HP3 已开工，但本轮未完成的 action-plan 条目）

| ID | 描述 | 当前完成度 | 后续 phase / 批次 | 说明 |
|----|------|-----------|-------------------|------|
| `P1` | `CrossTurnContextManager` 成为唯一 prompt owner | `not-started-in-runtime` | HP3 后续批次 | 本轮只做 control-plane；agent-core 真实 prompt 仍未切到新的 cross-turn manager |
| `P2` | auto-compact 由 model metadata 驱动并进入 live scheduler | `not-wired` | HP3 后续批次 | kernel `compactRequired` 仍是 host hardcode `false`；本轮只把 model-aware budget 做进 probe / preview |
| `P3` | `<model_switch>` / `<state_snapshot>` strip-then-recover full contract | `preview-only-marker` | HP3/HP4 联合 | 当前会在 preview/job payload 中记录 `protected_fragment_kinds`，但还没有真正 recover 回下一次 prompt |
| `P4` | compact 失败 3 次 circuit breaker | `not-wired` | HP3 后续批次 | current manual compact path 没有 retry/breaker state machine |
| `P5` | 131K / 24K 多窗口 long-conversation cross-e2e | `not-run` | HP3 后续批次 | 本轮未进入 `test/cross-e2e` 的 5 场景矩阵 |

---

## 3. Retained 项（本轮显式保留 / 不改）

| ID | 描述 | 来源 frozen 法律 | 后续去向 |
|----|------|-----------------|----------|
| `K1` | context-core 不新增 D1 binding，继续经 `ORCHESTRATOR_CORE` 读取 / 写回 durable truth | Q10 + 当前 worker topology | HP3 后续批次继续沿此 seam 演进 |
| `K2` | `GET /sessions/{id}/context` 继续保留为 probe 兼容 alias | public drift risk control | HP9 文档包最终再决定是否移除 |
| `K3` | 不新增 `nano_compact_jobs` | HP1 freeze + Q12 | 若 future 证明 checkpoint handle 不足，必须触发 HP1 schema correction |

---

## 4. F1-F17 chronic status 登记（强制）

| chronic | 说明 | HP3 verdict | 备注 |
|---------|------|-------------|------|
| F1 | 公共入口模型字段透传断裂 | `closed-by-HP0` | 本轮未触碰 |
| F2 | system prompt model-aware suffix 缺失 | `partial-preexisting` | probe/preview 已消费 model metadata；runtime system prompt 真接线仍归 HP2/HP3 runtime 批次 |
| F3 | session-level current model 与 alias resolution | `closed-by-HP2-first-wave` | HP2 已补 `/models/{id}`、`GET/PATCH /sessions/{id}/model` 与 requested/effective model audit，HP3 现在可直接消费稳定 model truth |
| F4 | context state machine（compact / branch / fork） | `partial-by-HP3` | control-plane first wave 已落地；runtime owner / auto-compact / breaker 未完 |
| F5 | chat lifecycle | `not-touched` | HP4 |
| F6 | confirmation control plane | `not-touched` | HP5 |
| F7 | tool workspace state machine | `not-touched` | HP6 |
| F8 | checkpoint / revert | `schema-ready-consumed` | HP3 已消费 `compact_boundary` checkpoint handle；完整 restore 仍归 HP7 |
| F9 | runtime hardening | `not-touched` | HP8 |
| F10 | R29 postmortem & residue verdict | `handed-to-platform` | HP8-B / HP10 |
| F11 | API docs + 手工证据 | `partial-by-HP3` | client API docs 已更新；manual evidence 仍归 HP9 |
| F12 | final closure | `not-touched` | HP10 |
| F13 | observability drift / metrics 完整性 | `partial-by-HP3` | compact.notify 第一轮已落 durable stream-event；更深 observability 仍归 HP8/HP9 |
| F14 | tenant-scoped storage 全面落地 | `not-touched` | HP6 / HP7 |
| F15 | DO checkpoint vs product checkpoint registry 解耦 | `closed-by-HP1` | 本轮复用 product checkpoint，未混入 DO `session:checkpoint` |
| F16 | confirmation_pending kernel wait reason 统一 | `not-touched` | HP5 / HP6 |
| F17 | `<model_switch>` developer message strip-then-recover during compact | `partial-by-HP3` | protected marker 已进入 preview/job；真实 recover 未完成 |

---

## 5. 下游 phase / 后续批次交接

| 接收对象 | 交接物 | 形式 | 本 closure 引用 |
|----------|--------|------|----------------|
| HP3 后续批次 | `CrossTurnContextManager` / auto-compact / breaker / strip-recover runtime wiring | 必修 | §2 P1-P5 |
| HP4 | `compact_boundary` checkpoint handle + boundary snapshot payload | 可直接消费 | §1 R6-R7 |
| HP9 | clients/api-docs 新的 context surface 与 payload | 文档输入 | §0 / §1 R5-R8 |

---

## 6. 测试与证据矩阵

| 类型 | 命令 / 路径 | 状态 |
|------|-------------|------|
| typecheck (context-core) | `pnpm --filter @haimang/context-core-worker typecheck` | ✅ |
| build (context-core) | `pnpm --filter @haimang/context-core-worker build` | ✅ |
| test (context-core) | `pnpm --filter @haimang/context-core-worker test` | ✅ |
| typecheck (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker typecheck` | ✅ |
| build (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker build` | ✅ |
| test (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker test` | ✅ |
| 新增 context-core RPC 测试 | `workers/context-core/test/rpc-context-control-plane.test.ts` | ✅ |
| 新增 façade route wiring 测试 | `workers/orchestrator-core/test/context-route.test.ts` | ✅ |
| agent-core runtime wiring | not run | n/a |
| `pnpm test:cross-e2e` | not run | n/a |

---

## 7. 收口意见

1. **可以确认关闭的，是 HP3 的 control-plane first wave，而不是整个 HP3。**
2. **可以立即被后续 phase 消费的，是 durable probe / layers / preview / compact job handle 这条链。**
3. **还不能宣称完成的，是 runtime auto-compact、唯一 prompt owner、full strip-recover、breaker 与 long-conversation e2e。**
