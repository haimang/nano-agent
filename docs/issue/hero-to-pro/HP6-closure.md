# HP6 Tool / Workspace State Machine — Closure

> 服务业务簇: `hero-to-pro / HP6`
> 上游 action-plan: `docs/action-plan/hero-to-pro/HP6-action-plan.md`
> 上游 design: `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md` Q19 / Q20 / Q21
> 闭环日期: `2026-04-30`
> 文档状态: `partial`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| HP6 当前状态 | `partial-live`(todo CRUD live;workspace path normalization + D1 truth helper live;`tool.call.cancelled` 协议 live;workspace API / artifact promotion / cleanup cron / filesystem-core RPC 仍未收口) |
| todo durable truth | `done-first-wave`(`D1TodoControlPlane` + `at most 1 in_progress` 约束硬化) |
| todo public surface | `done-first-wave`(`GET/POST/PATCH/DELETE /sessions/{id}/todos` + `?status=` 过滤) |
| NACP todo frame family | `done-first-wave`(`session.todos.write` / `session.todos.update` 已注册) |
| workspace path law | `done-first-wave`(`normalizeVirtualPath()` 7-rule 冻结 + `buildWorkspaceR2Key()` tenant prefix law) |
| workspace D1 truth helper | `done-first-wave`(`D1WorkspaceControlPlane` 提供 list/upsert/delete + UNIQUE 一致性 + content_hash idempotent) |
| workspace public CRUD | `not-yet`(`/sessions/{id}/workspace/files/{*path}` 路由与 filesystem-core RPC 仍未接线) |
| filesystem-core leaf RPC | `not-yet`(temp-file RPC 留给 HP6 后续批次) |
| tool inflight + cancel surface | `partial-live`(`tool.call.cancelled` 协议帧 + 11 stream kind catalog 已 live;`/sessions/{id}/tool-calls` list/cancel HTTP 路由仍未接线) |
| artifact promotion + provenance | `not-yet`(留给 HP6 后续批次 / HP7 snapshot 链) |
| cleanup jobs(scope=`session_end`/`explicit`) | `not-yet`(scope 责任已在 HP1 closure §7.4 冻结归 HP6,本轮未实现 cron / job audit) |
| 测试矩阵 | `partial-green`(`@haimang/nacp-session` 191/191、`@haimang/orchestrator-core-worker` 275/275、`@haimang/agent-core-worker` 1077/1077;cross-e2e 6+ 场景未运行) |
| clients/api-docs | `not-touched`(client API docs 仍归 HP9) |

---

## 1. Resolved 项(本轮 HP6 已落地、可直接消费)

| ID | 描述 | 证据 | 说明 |
|----|------|------|------|
| `R1` | `D1TodoControlPlane` durable helper:create / read / list / patch / delete | `workers/orchestrator-core/src/todo-control-plane.ts` | todo 第一次拥有单一 durable owner |
| `R2` | 5-status enum 冻结(charter §436):`pending / in_progress / completed / cancelled / blocked` | `workers/orchestrator-core/src/todo-control-plane.ts` + `migrations/010-agentic-loop-todos.sql` | 在 helper 与 SQL CHECK 双层硬化 |
| `R3` | `at most 1 in_progress` 约束在 application layer 实现并测试覆盖 | `D1TodoControlPlane.create` / `patch` + `test/todo-control-plane.test.ts` | DB 层无 partial-unique 表达,但应用层 read-then-insert 已覆盖正常路径 |
| `R4` | public façade `/sessions/{id}/todos` CRUD 三件套(list / create / patch / delete) | `workers/orchestrator-core/src/index.ts` | client 第一次有正式 todo 面 |
| `R5` | NACP `session.todos.write` / `session.todos.update` 帧族 | `packages/nacp-session/src/messages.ts` + `index.ts` + `type-direction-matrix.ts` + `session-registry.ts` | client → server / server → client 边界冻结 |
| `R6` | `normalizeVirtualPath()` 7-rule 冻结(no leading `/`、no `..` / `.`、no empty seg、no `\`、no control char、≤ 1024 bytes、必须 `/` 分隔) | `workers/orchestrator-core/src/workspace-control-plane.ts` | virtual_path 安全边界统一收敛到一个 helper |
| `R7` | `buildWorkspaceR2Key()` tenant prefix law:`tenants/{team}/sessions/{session}/workspace/{normalized}` | `workers/orchestrator-core/src/workspace-control-plane.ts` | 即使后续 helper 漏 normalize,key builder 强制再做一次 |
| `R8` | `D1WorkspaceControlPlane` D1 truth helper:list / readByPath / upsert / deleteByPath | `workers/orchestrator-core/src/workspace-control-plane.ts` | UNIQUE(session, virtual_path) + content_hash idempotent + cleanup_status default 'pending' |
| `R9` | `tool.call.cancelled` stream event 与 `cancel_initiator` enum(`user / system / parent_cancel`,Q21 不入 confirmation kind) | `packages/nacp-session/src/stream-event.ts` + `index.ts` | client 第一次能区分 user cancel / tool error / 父级 cancel |
| `R10` | 11-kind stream-event catalog 与 agent-core observability inspector 的 mirrored constant 重新对齐 | `workers/agent-core/src/eval/inspector.ts` + `test/eval/inspector.test.ts` | drift check 重新平衡;observability 层不会遗漏 cancel |
| `R11` | 测试覆盖:registry helper / route / path / D1 / cancel frame 共新增 5 个 test 文件、约 50 用例 | 各 test 文件 | 安全 / 一致性 / 协议三层均有可重复证据 |

---

## 2. Partial 项(HP6 已开工,但本轮未完成的 action-plan 条目)

| ID | 描述 | 当前完成度 | 后续 phase / 批次 | 说明 |
|----|------|-----------|-------------------|------|
| `P1` | filesystem-core leaf RPC 扩展(`readTempFile/writeTempFile/listTempFiles/deleteTempFile`) | `not-started` | HP6 后续批次 | leaf-worker 边界与服务绑定接线工作量较大,留给独立批次 |
| `P2` | `/sessions/{id}/workspace/files/{*path}` 公共 CRUD 路由 + `?prefix=` + `POST /workspace/cleanup` | `not-wired-on-route-side` | HP6 后续批次 | 路径与 D1 helper 已就位,差 façade route + filesystem-core RPC 接线 |
| `P3` | `/sessions/{id}/tool-calls` 列表 + `POST .../cancel` HTTP surface | `not-wired-on-route-side` | HP6 后续批次 / HP9 文档同批 | `tool.call.cancelled` 帧已就位,kernel `pendingToolCalls` projection 仍未上 façade |
| `P4` | artifact promotion(`POST /sessions/{id}/artifacts/promote`)+ provenance(`source_workspace_path`、`source_session_uuid`) | `not-wired` | HP6 后续批次 / HP7 snapshot 链 | 011 schema 已就位;HP6 第一版只 freeze 了 R2 key 形状 |
| `P5` | cleanup jobs:`session_end + 24h` cron + audit row 写入 `nano_workspace_cleanup_jobs`(scope=`session_end`/`explicit`) | `not-wired` | HP6 后续批次 | scope 责任已在 HP1 closure §7.4 冻结;HP7 owns `checkpoint_ttl` |
| `P6` | cross-e2e 6+ 场景(LLM `WriteTodos`、temp-file 跨 turn、single tool cancel、promote、cleanup audit、traversal deny) | `not-run` | HP6 后续批次 | 与 HP3/HP4/HP5 closure 的 cross-e2e 一并留给 cross-e2e 批次 |
| `P7` | agent-core `WriteTodos` capability 真接线到 todo registry | `not-wired` | HP6 后续批次 | route 已 live;模型侧 capability 真接线留给后续 |

---

## 3. Retained 项(本轮显式保留 / 不改)

| ID | 描述 | 来源 frozen 法律 | 后续去向 |
|----|------|-----------------|----------|
| `K1` | `virtual_path` 是产品主键;`temp_file_uuid` 仅作内部稳定引用 | Q19 | HP7 snapshot 必须沿用 |
| `K2` | promote 必须复制成独立 artifact;不允许 alias workspace object | Q20 | 后续 P4 实施时硬性约束 |
| `K3` | tool cancel 不入 confirmation kind enum;统一以 `tool.call.cancelled` 终态事件承载 | Q21 + HP5 closure §3 K4 | HP5 confirmation 7-kind 不变 |
| `K4` | filesystem-core 继续是 leaf worker;workspace CRUD 只通过 service-binding RPC | charter + HP6 design §3.1 | 后续不打开 public workspace fetch |
| `K5` | todo 不引入 `deleted_at`(第一版直接 hard delete);删除血缘走 audit / message ledger | HP6 design §7.2 F1 边界情况 | 不重评,除非 future 需要 undelete |
| `K6` | `nano_workspace_cleanup_jobs.scope` HP6 / HP7 责任分工:`session_end` / `explicit` 归 HP6,`checkpoint_ttl` 归 HP7 | HP1 closure §7.4 + HP6 design §7.3 cleanup jobs | 后续两 phase 实现时不得交叉解释 |

---

## 4. F1-F17 chronic status 登记(强制)

| chronic | 说明 | HP6 verdict | 备注 |
|---------|------|-------------|------|
| F1 | 公共入口模型字段透传断裂 | `closed-by-HP0` | 本轮未触碰 |
| F2 | system prompt model-aware suffix 缺失 | `closed-by-review-fix` | 本轮未触碰 |
| F3 | session-level current model 与 alias resolution | `closed-by-HP2-first-wave` | 本轮未触碰 |
| F4 | context state machine(compact / branch / fork) | `carried-from-HP3-partial` | 本轮未扩写 |
| F5 | chat lifecycle | `carried-from-HP4-partial` | 本轮未扩写 |
| F6 | confirmation control plane | `carried-from-HP5-partial` | HP5 first wave 已落 |
| F7 | tool workspace state machine | `partial-by-HP6` | todo / workspace D1 / `tool.call.cancelled` 已 live;workspace public CRUD / promote / cleanup / tool-calls list 未完 |
| F8 | checkpoint / revert | `partial-by-HP4` | 本轮未扩写 |
| F9 | runtime hardening | `not-touched` | HP8 |
| F10 | R29 postmortem & residue verdict | `handed-to-platform` | HP8-B / HP10 |
| F11 | API docs + 手工证据 | `partial-by-HP3-and-HP4` | HP9 |
| F12 | final closure | `not-touched` | HP10 |
| F13 | observability drift / metrics 完整性 | `partial-by-HP3` | 本轮把 inspector 11-kind catalog 与 nacp-session 重新对齐(防 drift) |
| F14 | tenant-scoped storage 全面落地 | `partial-by-HP6` | `buildWorkspaceR2Key()` 正式形成 workspace 子前缀 law;具体 R2 写入在后续批次 |
| F15 | DO checkpoint vs product checkpoint registry 解耦 | `closed-by-HP1` | 本轮未触碰 |
| F16 | confirmation_pending kernel wait reason 统一 | `closed-by-HP5` | 本轮未触碰 |
| F17 | `<model_switch>` developer message strip-then-recover during compact | `partial-by-HP3` | 本轮未触碰 |

---

## 5. 下游 phase / 后续批次交接

| 接收对象 | 交接物 | 形式 | 本 closure 引用 |
|----------|--------|------|----------------|
| HP6 后续批次 | filesystem-core temp-file RPC、workspace public CRUD、tool-calls 路由、promote / provenance、cleanup cron、cross-e2e | 必修 | §2 P1-P7 |
| HP7 | `D1WorkspaceControlPlane` + `temp_file_uuid` 已稳定;snapshot lineage 可直接基于 temp file 行 | 可直接消费 | §1 R6-R8 + §3 K1 |
| HP7 | `nano_workspace_cleanup_jobs.scope='checkpoint_ttl'` 由 HP7 拥有,不能复用 HP6 cron | 设计输入 | §3 K6 |
| HP9 | `/sessions/{id}/todos` CRUD + `session.todos.*` 帧 + `tool.call.cancelled` 终态事件 + 5-status enum 客户端文档 | 文档输入 | §0 / §1 R4-R5 / R9 |

---

## 6. 测试与证据矩阵

| 类型 | 命令 / 路径 | 状态 |
|------|-------------|------|
| typecheck (nacp-session) | `pnpm --filter @haimang/nacp-session typecheck` | ✅ |
| build (nacp-session) | `pnpm --filter @haimang/nacp-session build` | ✅ |
| test (nacp-session) | `pnpm --filter @haimang/nacp-session test` | ✅ 191/191 |
| typecheck (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker typecheck` | ✅ |
| test (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker test` | ✅ 275/275 |
| typecheck (agent-core) | `pnpm --filter @haimang/agent-core-worker typecheck` | ✅ |
| test (agent-core) | `pnpm --filter @haimang/agent-core-worker test` | ✅ 1077/1077 |
| 新增 todo registry tests | `workers/orchestrator-core/test/todo-control-plane.test.ts` | ✅ 11 |
| 新增 todo route tests | `workers/orchestrator-core/test/todo-route.test.ts` | ✅ 7 |
| 新增 workspace path / D1 tests | `workers/orchestrator-core/test/workspace-control-plane.test.ts` | ✅ 18 |
| 新增 todo frame tests | `packages/nacp-session/test/hp6-todo-messages.test.ts` | ✅ 14 |
| 新增 tool.call.cancelled frame tests | `packages/nacp-session/test/hp6-tool-cancelled.test.ts` | ✅ 7 |
| `pnpm test:cross-e2e` (HP6 6+ 场景) | not run | n/a |

---

## 7. 收口意见

1. **可以确认收口的,是 HP6 的 first wave(todo CRUD + workspace path & D1 truth + `tool.call.cancelled` 协议 + observability inspector drift fix),而不是整个 HP6。**
2. **可以立即被后续 phase 消费的,是 `D1TodoControlPlane` / `D1WorkspaceControlPlane` / `normalizeVirtualPath` / `buildWorkspaceR2Key` / `tool.call.cancelled` 帧族 / `session.todos.*` 帧族。**
3. **还不能宣称完成的,是 filesystem-core 真 RPC、workspace public CRUD、tool-calls 路由、promote / provenance、cleanup cron 与 cross-e2e。**
