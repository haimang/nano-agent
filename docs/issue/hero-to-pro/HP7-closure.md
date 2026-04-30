# HP7 Checkpoint Revert — Closure

> 服务业务簇: `hero-to-pro / HP7`
> 上游 action-plan: `docs/action-plan/hero-to-pro/HP7-action-plan.md`
> 上游 design: `docs/design/hero-to-pro/HP7-checkpoint-revert.md`
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md` Q22 / Q23 / Q24
> 闭环日期: `2026-04-30`
> 文档状态: `partial`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| HP7 当前状态 | `partial-live`(snapshot plane / restore job plane / diff projector / fork lineage event 已落地;runtime restore executor / fork executor / TTL cron / public restore route 仍未收口) |
| checkpoint registry truth | `consumed-from-HP1`(HP4 first wave 已 live `nano_session_checkpoints` list/create/diff;HP7 沿用同一 truth) |
| file snapshot durable truth | `done-first-wave`(`D1CheckpointSnapshotPlane` create / list / transition status + `setCheckpointFileSnapshotStatus` 已 live) |
| lazy/eager-by-kind 物化策略 (Q22) | `done-first-wave`(`fileSnapshotPolicyForKind`:turn_end/system/compact_boundary 严格 lazy;user_named eager_with_fallback) |
| restore job 真相 | `done-first-wave`(`D1CheckpointRestoreJobs` open / read / list / markRunning / terminate;status / mode 双层 enum 在 helper + SQL CHECK 硬化) |
| confirmation gate (Q24 destructive) | `done-first-wave`(`openJob` 对非 fork 模式强制 `confirmation_uuid`;fork 显式不强制,与 Q23 对齐) |
| rollback / failure_reason law (Q24) | `done-first-wave`(非 success 终态强制 `failure_reason`;`succeeded / partial / failed / rolled_back` 终态幂等) |
| restore mode router (3 destructive + 1 fork) | `done-first-wave`(`RESTORE_MODES` 4 项冻结 + helper 拒绝未知 mode + SQL CHECK) |
| diff projection (message + workspace + artifact) | `done-first-wave`(`CheckpointDiffProjector` 输出 added/removed/changed workspace + watermark-后 artifact added) |
| R2 key law (snapshot + fork) | `done-first-wave`(`buildCheckpointSnapshotR2Key` / `buildForkWorkspaceR2Key`,Q23 child 完全独立 namespace) |
| `session.fork.created` stream event | `done-first-wave`(parent_session / child_session / conversation / from_checkpoint / restore_job_uuid 5 项必填;label 可选) |
| stream-event drift fix | `done-first-wave`(11 → 12;agent-core inspector mirrored constant 同步)|
| restore executor / fork executor / runtime DO 接线 | `not-yet`(留给 HP7 后续批次;HP1/HP6/HP5 truth 已就位,executor 是收口工作) |
| TTL cleanup cron(scope=`checkpoint_ttl`)| `not-yet`(scope 已在 HP1 closure §7.4 锁定归 HP7,本轮未实现 cron) |
| public restore / fork HTTP 路由 | `not-yet`(协议 + 真相 + diff 已 live,等 executor 接线) |
| 测试矩阵 | `partial-green`(`@haimang/nacp-session` 196/196、`@haimang/orchestrator-core-worker` 305/305、`@haimang/agent-core-worker` 1077/1077;cross-e2e 6+ 场景未运行) |
| clients/api-docs | `not-touched`(client API docs 仍归 HP9) |

---

## 1. Resolved 项(本轮 HP7 已落地、可直接消费)

| ID | 描述 | 证据 | 说明 |
|----|------|------|------|
| `R1` | `D1CheckpointSnapshotPlane` durable helper:create / list / transitionStatus / setCheckpointFileSnapshotStatus | `workers/orchestrator-core/src/checkpoint-restore-plane.ts` | snapshot row 第一次有独立 owner,而非寄生 latest DO blob |
| `R2` | `D1CheckpointRestoreJobs` durable helper:openJob / read / listForSession / markRunning / terminate | `workers/orchestrator-core/src/checkpoint-restore-plane.ts` | restore 第一次有独立的 audit-friendly job truth |
| `R3` | 4 个 status enum 硬化:`file_snapshot_status`(4)、`snapshot_status`(4)、`restore_mode`(4)、`restore_status`(6) | helper + migration 013 双层 | Q22-Q24 在代码层严格不可漂移 |
| `R4` | Q22 物化策略 helper `fileSnapshotPolicyForKind`:user_named=eager_with_fallback;其余 lazy | `workers/orchestrator-core/src/checkpoint-restore-plane.ts` | 所有 turn_end / system / compact_boundary 都默认不复制文件,避免 R2 成本陷阱 |
| `R5` | Q24 confirmation gate:`openJob` 对非 fork 模式强制 confirmation_uuid;fork 允许无 confirmation | `D1CheckpointRestoreJobs.openJob` | destructive restore 第一次有不可绕过的人机边界 |
| `R6` | Q24 failure_reason 强制律:非 success 终态(`partial` / `failed` / `rolled_back`)必须携带 failure_reason | `D1CheckpointRestoreJobs.terminate` | restore 失败不再只写 boolean;审计行可解释失败步骤 |
| `R7` | terminate 幂等 + markRunning 拒绝终态:状态机不可回退 | helper transition 验证 | 重试 / 网络重放不会写错 |
| `R8` | snapshot R2 key law `tenants/{team}/sessions/{session}/snapshots/{checkpoint_uuid}/{virtual_path}` | `buildCheckpointSnapshotR2Key` | tenant prefix law 在 snapshot 层延续 |
| `R9` | fork R2 key law `tenants/{team}/sessions/{child_session}/workspace/{virtual_path}` (Q23) | `buildForkWorkspaceR2Key` | child session 绝不复用 parent R2 key |
| `R10` | `CheckpointDiffProjector`:current vs snapshot 工作区 added/removed/changed + watermark-后 artifact added | `workers/orchestrator-core/src/checkpoint-diff-projector.ts` | `/diff` 不再只回 message delta;HP4 first wave + HP7 P2 一起组成完整 diff |
| `R11` | `session.fork.created` 协议帧:parent / child / conversation / from_checkpoint / restore_job 5 项必填(Q23 same-conversation 不变量) | `packages/nacp-session/src/stream-event.ts` + `index.ts` | parent attached client 第一次能在不轮询 restore job 的前提下感知 fork |
| `R12` | observability inspector mirrored constant 同步至 12 kinds(防 drift) | `workers/agent-core/src/eval/inspector.ts` + `test/eval/inspector.test.ts` | session.fork.created 进入 observability 通路 |
| `R13` | 测试覆盖:snapshot plane / restore job plane / diff projector / fork frame 共新增 4 个 test 文件、约 36 用例 | 各 test 文件 | enum + Q22/Q23/Q24 三层 frozen law 都有可重复证据 |

---

## 2. Partial 项(HP7 已开工,但本轮未完成的 action-plan 条目)

| ID | 描述 | 当前完成度 | 后续 phase / 批次 | 说明 |
|----|------|-----------|-------------------|------|
| `P1` | restore executor:`conversation_only` 真接 DO restore seam + D1 supersede 反标 | `not-wired` | HP7 后续批次 | 协议 + 真相 + diff 已就位;executor 是收口工作 |
| `P2` | restore executor:`files_only` 真接 R2 复制 + workspace temp file 反向覆写 | `not-wired` | HP7 后续批次 | filesystem-core leaf RPC(HP6 partial)是前置依赖 |
| `P3` | restore executor:`conversation_and_files` 用一个 job 编排上面两步 + rollback baseline 自动创建 | `not-wired` | HP7 后续批次 | 顺序需先创建 `system` rollback baseline 再 forward 执行 |
| `P4` | fork executor:复制 conversation + snapshot 文件到 child namespace + child transcript lineage system message | `not-wired` | HP7 后续批次 | 协议帧 / R2 key law / restore job mode=fork 已就位 |
| `P5` | TTL cleanup cron:turn_end recent-10 / user_named 30d / session.end + 90d 清理 + audit row | `not-wired` | HP7 后续批次 | scope=`checkpoint_ttl` 归 HP7(HP1 closure §7.4) |
| `P6` | public surface 路由:`POST /sessions/{id}/checkpoints/{id}/restore` / `POST /sessions/{id}/fork` / 扩展 `/diff` 输出 workspace+artifact | `not-wired` | HP7 后续批次 | helper 与 projector 已就位,等 executor 收口同时接线 |
| `P7` | cross-e2e 6+ 场景(三模式 restore + rollback + fork isolation + TTL audit) | `not-run` | HP7 后续批次 | 与 HP3/HP4/HP5/HP6 closure 一并留给 cross-e2e 批次 |

---

## 3. Retained 项(本轮显式保留 / 不改)

| ID | 描述 | 来源 frozen 法律 | 后续去向 |
|----|------|-----------------|----------|
| `K1` | turn_end / system / compact_boundary 严格 lazy 物化 | Q22 | 后续 P1-P3 实施时不得改成 eager 全量复制 |
| `K2` | fork = 同 conversation 新 session;不创建新 conversation | Q23 | 后续 P4 fork executor 不得开新 conversation |
| `K3` | restore 失败必须有 rollback baseline + `rolled_back` / `failed` 区分;无 partial success 妥协 | Q24 | 后续 P3 实施时必须先建 baseline 再 forward |
| `K4` | child session R2 key 绝不复用 parent;`buildForkWorkspaceR2Key` 是唯一入口 | Q23 + tenant prefix law | 后续 P4 fork executor 必须强制走该 helper |
| `K5` | tool cancel 不入 confirmation kind 与本 phase 无关,但 HP6 K3 在此引用以提醒边界 | HPX Q21 + HP5 closure §3 K4 + HP6 closure §3 K3 | 不重评 |
| `K6` | `nano_workspace_cleanup_jobs.scope='checkpoint_ttl'` 归 HP7,`session_end`/`explicit` 归 HP6 | HP1 closure §7.4 + HP6 closure §3 K6 | 后续两 phase 实现 cleanup 时不得交叉解释 |
| `K7` | restore executor 不复用 `session.resume` latest-key seam 充当产品 restore;只走 restore job + D1 + R2 + DO restore primitive 三层 | HP7 design §0 / §3.1 反例条目 | 后续 P1-P3 实现时严禁 latest-key fallback |

---

## 4. F1-F17 chronic status 登记(强制)

| chronic | 说明 | HP7 verdict | 备注 |
|---------|------|-------------|------|
| F1 | 公共入口模型字段透传断裂 | `closed-by-HP0` | 本轮未触碰 |
| F2 | system prompt model-aware suffix 缺失 | `closed-by-review-fix` | 本轮未触碰 |
| F3 | session-level current model 与 alias resolution | `closed-by-HP2-first-wave` | 本轮未触碰 |
| F4 | context state machine | `carried-from-HP3-partial` | 本轮未扩写 |
| F5 | chat lifecycle | `carried-from-HP4-partial` | 本轮未扩写 |
| F6 | confirmation control plane | `carried-from-HP5-partial` | HP7 P3-01 复用 HP5 `checkpoint_restore` kind |
| F7 | tool workspace state machine | `carried-from-HP6-partial` | HP7 read-only 消费 HP6 workspace truth |
| F8 | checkpoint / revert | `partial-by-HP7` | snapshot plane / restore job plane / diff / fork event 已 live;executor / cron / public route 未完 |
| F9 | runtime hardening | `not-touched` | HP8 |
| F10 | R29 postmortem & residue verdict | `handed-to-platform` | HP8-B / HP10 |
| F11 | API docs + 手工证据 | `partial-by-HP3-and-HP4` | HP9 |
| F12 | final closure | `not-touched` | HP10 |
| F13 | observability drift / metrics 完整性 | `partial-by-HP3-and-HP6` | 本轮第二次 inspector 12-kind catalog 同步,防止 fork 事件遗漏 |
| F14 | tenant-scoped storage 全面落地 | `partial-by-HP6-and-HP7` | snapshot + fork R2 key law 进一步固化 |
| F15 | DO checkpoint vs product checkpoint registry 解耦 | `closed-by-HP1` | 本轮在 K7 显式重申不得回到 latest-key seam |
| F16 | confirmation_pending kernel wait reason 统一 | `closed-by-HP5` | 本轮未触碰 |
| F17 | `<model_switch>` developer message strip-then-recover during compact | `partial-by-HP3` | 本轮未触碰 |

---

## 5. 下游 phase / 后续批次交接

| 接收对象 | 交接物 | 形式 | 本 closure 引用 |
|----------|--------|------|----------------|
| HP7 后续批次 | restore / fork executor、TTL cleanup cron、public restore / fork 路由、cross-e2e | 必修 | §2 P1-P7 |
| HP8 | restore job + confirmation gate + rollback law 已就位,可作为 runtime hardening / chronic closure 的稳定基座 | 可直接消费 | §1 R2 / R5 / R6 |
| HP9 | `/checkpoints/{id}/diff` 多层 delta + `session.fork.created` 帧 + 4-mode 4-status enum 客户端文档 | 文档输入 | §0 / §1 R10 / R11 |

---

## 6. 测试与证据矩阵

| 类型 | 命令 / 路径 | 状态 |
|------|-------------|------|
| typecheck (nacp-session) | `pnpm --filter @haimang/nacp-session typecheck` | ✅ |
| build (nacp-session) | `pnpm --filter @haimang/nacp-session build` | ✅ |
| test (nacp-session) | `pnpm --filter @haimang/nacp-session test` | ✅ 196/196 |
| typecheck (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker typecheck` | ✅ |
| test (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker test` | ✅ 305/305 |
| typecheck (agent-core) | `pnpm --filter @haimang/agent-core-worker typecheck` | ✅ |
| test (agent-core) | `pnpm --filter @haimang/agent-core-worker test` | ✅ 1077/1077 |
| 新增 snapshot + restore-job tests | `workers/orchestrator-core/test/checkpoint-restore-plane.test.ts` | ✅ 25 |
| 新增 diff projector tests | `workers/orchestrator-core/test/checkpoint-diff-projector.test.ts` | ✅ 5 |
| 新增 fork frame tests | `packages/nacp-session/test/hp7-fork-created.test.ts` | ✅ 5 |
| 更新 stream-event drift test | `packages/nacp-session/test/stream-event.test.ts` | ✅ |
| 更新 inspector drift test | `workers/agent-core/test/eval/inspector.test.ts` | ✅ |
| `pnpm test:cross-e2e` (HP7 6+ 场景) | not run | n/a |

---

## 7. 收口意见

1. **可以确认收口的,是 HP7 的 first wave(snapshot durable plane + restore job plane + diff projector + fork lineage event + R2 key law),而不是整个 HP7。**
2. **可以立即被后续 phase 消费的,是 `D1CheckpointSnapshotPlane` / `D1CheckpointRestoreJobs` / `CheckpointDiffProjector` / `buildCheckpointSnapshotR2Key` / `buildForkWorkspaceR2Key` / `fileSnapshotPolicyForKind` / `session.fork.created` 帧。**
3. **还不能宣称完成的,是 restore / fork executor、public route、TTL cleanup cron 与 cross-e2e。**
