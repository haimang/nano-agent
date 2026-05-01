# Nano-Agent 代码审查报告 — HP6-HP8 阶段审查 + hero-to-pro 全阶段回顾

> 审查对象: `hero-to-pro 阶段 HP6/HP7/HP8 + 全阶段（HP0-HP10）跨阶段深度分析`
> 审查类型: `mixed（code-review + docs-review + closure-review + cross-phase + cross-package 深度分析）`
> 审查时间: `2026-04-30`
> 审查人: `Deepseek`
> 审查范围:
> - `workers/orchestrator-core/src/`（todo-control-plane / workspace-control-plane / checkpoint-restore-plane / checkpoint-diff-projector / confirmation-control-plane / session-truth / index.ts）
> - `workers/context-core/src/`（control-plane.ts / index.ts）
> - `workers/agent-core/src/`（host/alarm.ts / host/orchestration.ts / host/runtime-mainline.ts / host/do/session-do/runtime-assembly.ts）
> - `workers/filesystem-core/src/`（temp-file RPC 存在性）
> - `packages/nacp-session/src/`（messages.ts / stream-event.ts）
> - `packages/nacp-core/src/`（tools/tool-catalog.ts / index.ts）
> - `scripts/`（check-megafile-budget.mjs / check-tool-drift.mjs / check-envelope-drift.mjs / megafile-budget.json）
> - `clients/api-docs/`（11 份文档全部核查）
> - `docs/architecture/lane-e-final-state.md`
> - `docs/runbook/zx5-r28-investigation.md`
> - `docs/action-plan/hero-to-pro/HP{6,7,8}-action-plan.md`
> - `docs/issue/hero-to-pro/HP{6,7,8}-closure.md`
> - `docs/charter/plan-hero-to-pro.md`
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md`（§7.7 HP6 / §7.8 HP7 / §7.9 HP8）
> - `docs/action-plan/hero-to-pro/HP{6,7,8}-action-plan.md`（含工作日志回填）
> - `docs/issue/hero-to-pro/HP{6,7,8}-closure.md`（收口声明）
> - `docs/design/hero-to-pro/HP{6,7,8}-*.md`（设计文档）
> - `docs/design/hero-to-pro/HPX-qna.md`（冻结决策 Q19-Q28）
> - 真实代码与测试面（`workers/*/test/` + `packages/*/test/`）
> - `scripts/` 三类 drift guard 实际运行结果
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**: HP6/HP7/HP8 first wave 均成立：HP6 的 todo/workspace-D1/tool.cancelled 协议面、HP7 的 checkpoint snapshot/restore job/diff/fork event 数据面、HP8 的三类 root gate + tool catalog SSoT + Lane E 终态均已落地且全部单包测试通过（1922 tests，0 failures）。所有无法完成的事项均在 closures 中诚实标注 `partial`/`not-yet`/`not-run`。**但从全阶段（HP0-HP10）视角看，存在一个系统性结构问题：8 个 implementation phase 全部停留在 `partial-live`，没有任何一个 phase 到达真正的 `closed`。这不符合 charter §6.3 的严格串行交接原则（"下一 phase 不能在前 phase closure 之前启动"），因为在全阶段仍为 partial 的状态下，HP9 的 `Documentation Freeze Gate` 与 HP10 的 `Final Closure Gate` 均无法合法触发。**

- **结论等级**: `changes-requested`

- **是否允许关闭本轮 review**: `no`

- **本轮最关键的 3 个判断**:
  1. **全阶段 second-wave 债务堆积** — HP2-HP8 共 8 个 phase 将约 35+ 项 "core runtime enforcement / executor / agent-core wiring" 全部 defer 到 "后续批次"。这些 deferred items 共享一个特征：它们不是 minor cleanup，而是各自 phase 的核心闭环逻辑（如 auto-compact 触发、模型切换语义注入、restore executor、cross-turn context manager）。当前无任何 cross-e2e 保护这些 deferred 项，也无明确的 timebox 或 batch plan。
  2. **cross-e2e 系统性空白** — 从 HP2 到 HP8，所有 closure 的测试矩阵均标注 `pnpm test:cross-e2e: not run`。这意味着 7 个 phase 实现了大量新端点、新协议、新状态机，但在真实 6-worker stack 中从未被端到端验证过。Charter §9.4 规定的多条证据门槛（"Cross-turn history 必须有 e2e"、"compact 真实运行必须有 e2e"等）均未满足。
  3. **HP8 closure §5 的 HP9 freeze gate NOT GRANTED 是正确且诚实的** — 但这一 gate 不应对任何 reviewer 意外：R29 postmortem 文件与 verify-initial-context-divergence.mjs 脚本均不存在；所有 agent-core/bash-core consumer 仍未消费 nacp-core tool catalog；R28/R29 均无 explicit closure register。在 HP8 closure 声称 "HP9 documentation freeze gate: NOT GRANTED" 的同时，HP8 自身也未完成其 Phase 1 chronic register 核心任务。

---

## 1. 审查方法与已核实事实

### 对照文档
- `docs/charter/plan-hero-to-pro.md` §7.7-§7.9（HP6/HP7/HP8）+ §6/§8/§10（全阶段 gate/exit 条件）
- `docs/action-plan/hero-to-pro/HP6-action-plan.md`（593 行，含工作日志）
- `docs/action-plan/hero-to-pro/HP7-action-plan.md`（583 行，含工作日志）
- `docs/action-plan/hero-to-pro/HP8-action-plan.md`（622 行，含工作日志）
- `docs/issue/hero-to-pro/HP6-closure.md`（136 行）
- `docs/issue/hero-to-pro/HP7-closure.md`（142 行）
- `docs/issue/hero-to-pro/HP8-closure.md`（153 行）
- `docs/design/hero-to-pro/HPX-qna.md` Q19-Q28

### 核查实现
- `workers/orchestrator-core/src/todo-control-plane.ts`（295 行）— 5-status enum + at-most-1 in_progress
- `workers/orchestrator-core/src/workspace-control-plane.ts`（370 行）— normalizeVirtualPath 7-rule + buildWorkspaceR2Key + D1WorkspaceControlPlane
- `workers/orchestrator-core/src/checkpoint-restore-plane.ts`（544 行）— D1CheckpointSnapshotPlane + D1CheckpointRestoreJobs + confirmation gate + failure_reason + fileSnapshotPolicyForKind + R2 key laws
- `workers/orchestrator-core/src/checkpoint-diff-projector.ts`（195 行）— message + workspace + artifact 三层 diff
- `workers/orchestrator-core/src/index.ts`（2886 行）— todo CRUD 路由已注册，workspace CRUD/tool-calls/restore/fork 路由均不存在
- `workers/agent-core/src/host/alarm.ts`（101 行）— alarm() posture 主线存在
- `workers/agent-core/src/host/orchestration.ts` — compactRequired 仍硬编码 false（HP8 未修复）
- `packages/nacp-session/src/stream-event.ts` — tool.call.cancelled + session.fork.created + 12-kind catalog
- `packages/nacp-session/src/messages.ts` — session.todos.write/update 帧族
- `packages/nacp-core/src/tools/tool-catalog.ts`（81 行）— SSoT，1 条目（bash）
- `scripts/check-megafile-budget.mjs`（90 行）/ `scripts/megafile-budget.json`
- `scripts/check-tool-drift.mjs`（164 行）
- `scripts/check-envelope-drift.mjs`（156 行）
- `docs/architecture/lane-e-final-state.md`（77 行）— 4 字段齐全

### 执行过的验证
- `pnpm --filter @haimang/orchestrator-core-worker typecheck build test` → **305/305 通过**
- `pnpm --filter @haimang/agent-core-worker typecheck build test` → **1077/1077 通过**
- `pnpm --filter @haimang/nacp-session typecheck build test` → **196/196 通过**
- `pnpm --filter @haimang/nacp-core typecheck build test` → **344/344 通过**
- `pnpm run check:megafile-budget` → **5 文件全部 within budget，通过**
- `pnpm run check:tool-drift` → **1 tool id (bash) 注册，catalog SSoT clean，通过**
- `pnpm run check:envelope-drift` → **1 public file clean，通过**
- 全仓 `grep` 搜索: `readTempFile|writeTempFile|listTempFiles|deleteTempFile`（返回仅限于文档）、`workspace/files`（index.ts 中不存在）、`tool-calls`（orchestrator-core 中不存在）、`restore`（index.ts 中不存在）、`fork`（index.ts 中不存在）、`verify-initial-context-divergence`（不存在）、`R29-postmortem`（`docs/issue/zero-to-real/` 中不存在）
- `clients/api-docs/` 11 份文档逐份核查

### 复用 / 对照的既有审查
- 无。本审查独立完成，不参考任何其他 reviewer 的分析报告。

### 1.1 已确认的正面事实

- **HP6 Todo 面完整落地**: `D1TodoControlPlane` 295 行含 5-status enum、`at most 1 in_progress` 约束、4 个 CRUD 方法；façade `GET/POST/PATCH/DELETE /sessions/{id}/todos` 含 `?status=` 过滤已 live；NACP `session.todos.write`/`session.todos.update` 帧族已注册；测试 18 个用例覆盖。
- **HP6 Workspace 安全面完整落地**: `normalizeVirtualPath()` 冻结 7 条安全规则（无 `..`、无 `\`、无空段、≤1024 字节、强制 `/` 分隔等）；`buildWorkspaceR2Key()` 固定 tenant prefix law `tenants/{team}/sessions/{session}/workspace/{normalized}`；`D1WorkspaceControlPlane` 提供了 list/upsert/delete + `UNIQUE(session, virtual_path)` + `content_hash` idempotent 保障。
- **HP6 工具取消协议完整**: `tool.call.cancelled` stream event 含 `cancel_initiator` enum（`user/system/parent_cancel`），且被注册为 12-kind catalog 的一部分。HP6 closure K3 正确遵守了 Q21（不入 confirmation kind enum）。
- **HP7 Checkpoint 数据面大幅扩展**: `checkpoint-restore-plane.ts` 从 HP4 first-wave 的基础状态扩展到 544 行，实现了 `D1CheckpointSnapshotPlane`（4 种 file_snapshot_status）、`D1CheckpointRestoreJobs`（4 种 mode + 6 种 status）、`fileSnapshotPolicyForKind`（Q22 lazy/eager 策略）、confirmation gate（Q24 非 fork 模式强制 `confirmation_uuid`）、`failure_reason` 强制律（Q24 非 success 终态必填）、terminate 幂等、snapshot/fork R2 key law。
- **HP7 Diff 从 message-only 升级到三层**: `CheckpointDiffProjector` 新增 workspace file delta（added/removed/changed）与 watermark 后 artifact 变更投影。
- **HP7 Fork 协议落地**: `session.fork.created` stream event 含 parent/child/conversation/from_checkpoint/restore_job_uuid 5 项必填字段。
- **HP8 三类 root gate 完整落地并接入 `package.json`**: `check:megafile-budget`（5 文件均在 budget 内，`user-do-runtime.ts` 从 1171 降至 1222 → 仍在 1300 内；`runtime-mainline.ts` 636 ≤ 700）、`check:tool-drift`（1 tool id `bash`）、`check:envelope-drift`（1 public file clean）。
- **HP8 Tool Catalog SSoT 成立**: `nacp-core/src/tools/tool-catalog.ts` 81 行单源，`Object.freeze` 锁定，含 `findToolEntry`/`TOOL_CATALOG_IDS`，通过 nacp-core index.ts 再导出。`check:tool-drift.mjs` 脚本检测任何 worker 或 package 中的重复 tool literal。
- **HP8 Lane E 终态冻结**: `lane-e-final-state.md` 77 行含 Q28 要求的 scope/risk/remove condition/owner 4 字段，终态 = `retained-with-reason`，不再使用 "shim" 口径。
- **HP8 Heartbeat alarm 基础就位**: `agent-core/src/host/alarm.ts` 101 行实现 alarm tick（健康检查 → 断开 → flush traces → 下次调度），`user-do-runtime.ts` 中有 `alarm()` + `trimHotState()` + `cleanupEndedSessions()`。
- **所有包测试全部通过**: 4 包共 1922 测试 + 3 个 root gate 全部 green。
- **`clients/api-docs/` 纪律恢复遵守**: HP6/HP7/HP8 closures 均标注 `clients/api-docs: not-touched`，与 HP2/HP3/HP4 的散落更新形成对比——charter §4.4 纪律 3 在 HP6-HP8 期间得到恢复遵守。

### 1.2 已确认的负面事实

- **N1: `verify-initial-context-divergence.mjs` 不存在** — HP8 action-plan 和 design 均将其列为交付物（HP8 P2-02），但 `scripts/` 中无此文件。全仓搜索零结果。
- **N2: `docs/issue/zero-to-real/R29-postmortem.md` 不存在** — HP8 action-plan 和 charter 均将其列为交付物（HP8-B），但该文件根本不存在于文件系统。search for R29 postmortem 在 `docs/issue/zero-to-real/` 返回零结果。
- **N3: R28/R29 均无 explicit closure register** — HP8 closure §2 标注 P1/P2 为 `not-started`。`zx5-r28-investigation.md` 虽有 141 行真实内容（含复现条件/wrangler tail 步骤/诊断命令），但没有 `closed / retained-with-reason / handed-to-platform` 的三选一终态判定。Q28 要求 4 字段齐全（scope/risk/remove condition/owner），当前 R28/R29 两项均缺。
- **N4: agent-core/bash-core 均未消费 nacp-core tool catalog** — 全仓 search for `tool-catalog`/`tool_catalog`/`ToolCatalog` 在 `workers/agent-core` 和 `workers/bash-core` 中均返回零结果。当前 catalog SSoT 的唯一消费者是 nacp-core 自身（re-export）和 `check:tool-drift.mjs` drift guard。实际 worker 仍使用本地嵌入的 tool literal。
- **N5: HP8 未修复 `compactRequired` 硬编码** — 在之前的 HP2-HP4 审查中发现 `orchestration.ts:296,429` 的 `compactRequired: false` 硬编码，本轮 HP8 未触及此问题。auto-compact 仍然死链路。
- **N6: checkpoint-restore-plane 544 行 + 无 HTTP 路由** — 同之前的 HP2-HP4 审查发现一致，HP7 扩展了 restore plane 但依然未注册 public restore/fork HTTP 路由。HP7 closure 自身标注 P6 `not-wired`。
- **N7: filesystem-core temp-file RPC 未实现** — `readTempFile`/`writeTempFile`/`listTempFiles`/`deleteTempFile` 四方法仅在文档中提及，代码库中不存在。HP6 closure 自身标注 P1 `not-started`。
- **N8: workspace CRUD / tool-calls HTTP 面未实现** — `/sessions/{id}/workspace/files/{*path}` 和 `/sessions/{id}/tool-calls` 路由均不存在。
- **N9: HP8 action-plan 文档状态标注 `draft`** — 与 HP6/HP7 action-plan 同样的问题：文件标注 `draft` 但包含完整的工作日志回填，与实际执行状态不符。
- **N10: 全部 HP6-HP8 cross-e2e 未执行** — closures 均标注 `not run`。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 所有 closure/schema/实现文件均被读取并核实行号 |
| 本地命令 / 测试 | yes | 4 包 typecheck+build+test（1922 tests，0 failures）+ 3 root gates |
| schema / contract 反向校验 | yes | migration 010-013 逐一验证，NACP 帧族 schema 与代码对账 |
| live / deploy / preview 证据 | no | 未做 preview deploy，cross-e2e 未执行 |
| 与上游 design / QNA 对账 | yes | HPX-qna Q19-Q28 对照代码实现逐项核查 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| N1 | `verify-initial-context-divergence.mjs` 不存在 — R29 验证入口缺失 | high | delivery-gap | yes | 创建该脚本或显式声明 defer-to-HP10 |
| N2 | `R29-postmortem.md` 不存在 — F15 chronic 未兑现 | high | delivery-gap | yes | 完成 postmortem 三选一判定或显式 handoff |
| N3 | R28/R29 均无 explicit closure register（Q28 4 字段不全） | high | delivery-gap | yes | HP8 P1/P2 回填终态判定 |
| N4 | agent-core/bash-core 未消费 nacp-core tool catalog | medium | delivery-gap | no | HP8 后续批次或 HP9 同批 |
| N5 | `compactRequired` 硬编码 false — HP8 未修复 | high | correctness | no (归 HP3) | HP3 后续批次修复 |
| N6 | checkpoint-restore-plane 无 HTTP 路由 | high | delivery-gap | no (归 HP7) | HP7 后续批次注册路由 |
| N7 | filesystem-core temp-file RPC 未实现 | high | delivery-gap | no (归 HP6) | HP6 后续批次 |
| N8 | workspace/tool-calls HTTP 面缺失 | high | delivery-gap | no (归 HP6) | HP6 后续批次 |
| N9 | HP6/HP7/HP8 action-plan 文档状态标注 `draft` 与实际不符 | low | docs-gap | no | 修改为 `executed` 或 `partial` |
| N10 | 全部 cross-e2e 未执行（HP2-HP8 累计） | high | test-gap | yes | HP5 批次补齐 15-18 + HP6/HP7 相应 e2e |
| N11 | 全阶段 8 个 phase 均 `partial`，无一 `closed` | high | scope-drift | yes | 制定 second-wave batch plan + timebox |
| N12 | `tool.cancelled` stream event 存在但 event kind 命名不一致 | low | naming | no | 统一 `tool.call.cancelled` vs `tool.cancelled` 命名 |

### N1. `verify-initial-context-divergence.mjs` 不存在 — R29 验证入口缺失

- **严重级别**: high
- **类型**: delivery-gap
- **是否 blocker**: yes
- **事实依据**:
  - `docs/action-plan/hero-to-pro/HP8-action-plan.md`: HP8 P2-02 将 `scripts/verify-initial-context-divergence.mjs` 列为交付物
  - `docs/charter/plan-hero-to-pro.md` §7.9: "写scripts/verify-initial-context-divergence.mjs + preview 跑 5 个真实 session diff"
  - 全仓 search 返回零结果: 该脚本不存在于 `scripts/` 或任何位置
- **为什么重要**: 这是 F15 R29（verify-initial-context 502 — `resolved-by-deletion-not-fix`）的唯一自动化入口。没有这个脚本，R29 无法从 "deceptive closure" 升级为 "evidence-backed explicit resolve"。charter §7.9 明确将其列为 HP8 In-Scope。
- **审查判断**: HP8 closure 自身用 `not-started` 标注了 P2，但没有解释这个脚本为何未创建。最可能的原因是它依赖 R29 postmortem 先行（N2），但脚本本身的框架（读取 session、calibrate、diff 基线）不依赖 postmortem 的结论。
- **建议修法**: 创建脚本骨架（即使暂时只做 session history dump + diff 基础），在 HP8 closure §2 P2 中标注其状态，在 HP8 后续批次或 HP10 中完成。

### N2. `R29-postmortem.md` 不存在 — F15 chronic 未兑现

- **严重级别**: high
- **类型**: delivery-gap
- **是否 blocker**: yes
- **事实依据**:
  - `docs/charter/plan-hero-to-pro.md` §7.9: "F15 R29 verify-initial-context 502 显式 postmortem:docs/issue/zero-to-real/R29-postmortem.md 写最终判定（零 diff / 有 diff / 不可验证）"
  - `docs/issue/zero-to-real/` 目录中无 `R29-postmortem.md` 文件
  - 全仓 search 返回零结果
- **为什么重要**: F15 R29 是 charter §2.2 列出的 17 项 chronic deferral 之一，归类为 "deceptive closure flag"。在 hero-to-pro 进入 HP9（文档冻结）前，R29 必须有显式判定。Charter §10.3 将 "F15 R29 标 'silently resolved' 无证据" 列为 NOT-成功退出识别条件。
- **审查判断**: 此文件缺失与 N1 脚本缺失构成 R29 的双重空白。HP8 closure 自身标注 P2 `not-started`，但未给出任何关于何时完成或是否 handoff 到 HP10 的明确说明。
- **建议修法**: 选项 A: HP8 后续批次中完成 postmortem（至少完成三选一判定）。选项 B: 显式以 `handed-to-platform` 登记，附带 Q28 4 字段（scope/risk/remove condition/owner），授权 HP10 final closure 直接接收入口。

### N10. 全部 cross-e2e 未执行（HP2-HP8 累计 7 个 phase）

- **严重级别**: high
- **类型**: test-gap
- **是否 blocker**: yes
- **事实依据**:
  - HP2 closure §6: `pnpm test:cross-e2e: not run`
  - HP3 closure §6: `pnpm test:cross-e2e: not run`
  - HP4 closure §6: `pnpm test:cross-e2e: not run`
  - HP5 closure §7: `pnpm test:cross-e2e (15-18): not run`
  - HP6 closure §6: `pnpm test:cross-e2e (HP6 6+ 场景): not run`
  - HP7 closure §6: `pnpm test:cross-e2e (HP7 6+ 场景): not run`
  - HP8 closure §7: `pnpm test:cross-e2e (HP8 4-scenario): not run`
- **为什么重要**: Charter §9.4 列出 8 条 "证据不足时不允许宣称的内容"，其中多条依赖 cross-e2e 验证：
  - "Cross-turn history 必须有 turn1→turn2 LLM 引用 e2e"
  - "Compact 真实运行必须有 long-conversation e2e 不再溢出 crash"
  - "F12 hook dispatcher closed 必须有 P1-10 cross-e2e 文件全绿"
  - "F13 round-trip closed 必须有 4 个 cross-e2e 文件全绿"
  这些要求没有一个已满足。charter §4.4 纪律 2 规定 "任何 phase 宣称'端点 live'必须有对应 cross-e2e 文件落地"，但所有 closures 均只通过了单包测试。
- **审查判断**: cross-e2e 的缺失不是某个 phase 的单独问题，而是整个 hero-to-pro 阶段的系统性 gap。1922 个单包测试全部通过证明了各 worker 内部逻辑的正确性，但无法证明跨 worker RPC / DO lifecycle / WS push / D1+DO 一致性的真实场景。
- **建议修法**: 必须在 HP10 final closure 之前补齐所有 cross-e2e。建议 HP8 后续批次或专门设立 cross-e2e batch 统一完成。最低要求: HP5 的 15-18（permission/elicitation roundtrip + usage push）必须补齐。

### N11. 全阶段 8 个 phase 均 `partial`，无一 `closed`

- **严重级别**: high
- **类型**: scope-drift
- **是否 blocker**: yes
- **事实依据**:
  - HP2 closure: `partial-live`
  - HP3 closure: `partial-live`
  - HP4 closure: `partial-live`
  - HP5 closure: `partial-live`
  - HP6 closure: `partial-live`
  - HP7 closure: `partial-live`
  - HP8 closure: `partial-live`
  - 全阶段 8 个 implementation phase（HP2-HP8 + 实际上 HP5 也是 partial）均未完成
- **为什么重要**: Charter §6.3 规定严格串行执行，"下一 phase 不能在前 phase closure 之前启动"。但实际执行模式是 "各 phase 做 first wave（control plane / durable truth / protocol）→ defer runtime enforcement / executor / agent-core wiring 到后续批次 → 启动下一 phase"。这个模式导致了：
  1. 每个 phase 的第一层都建立在上一 phase 也是 partial 的基础上
  2. 跨 phase 的集成逻辑（如 confirmations 对 restore 的 gate、compact 对 model switch 的 strip-recover）无法在 partial 状态下真正验证
  3. Second-wave 债务持续累积（当前累计 35+ 项）
- **审查判断**: 这不能归咎于任何一个 phase 的实现质量——各 phase 的 first wave 代码质量很高（1922 测试全绿即可证明）。问题在于 second-wave 工作从未被 timebox。如果 HP9 和 HP10 不主动收口，这些 deferred items 将再次成为 hero-to-platform 的慢性 carryover。
- **建议修法**:
  1. 在 HP8 closure 或 HP9 action-plan 中制定 second-wave batch plan，明确哪些 deferred items 必须在 hero-to-pro 内完成、哪些可以 `handed-to-platform`
  2. 建议采用 `close-with-known-issues` 路径（charter §10.4）：将无法在本阶段完成的 second-wave items 显式登记为 known issues，而非 silent defer
  3. HP10 final closure 必须逐项判定 35+ deferred items

---

## 3. In-Scope 逐项对齐审核

### 3.1 HP6 逐项对齐

| 编号 | 计划项（取自 action-plan） | 审查结论 | 说明 |
|------|---------------------------|----------|------|
| Todo durable truth (P1-01) | `done` | `D1TodoControlPlane` 295 行，5-status enum + at-most-1 in_progress |
| Façade todo CRUD (P1-02) | `done` | `GET/POST/PATCH/DELETE /sessions/{id}/todos` + `?status=` filter |
| NACP todo 帧族 (P1-03) | `done` | `session.todos.write` / `session.todos.update` 双向注册 |
| workspace path law (P2-01) | `done` | `normalizeVirtualPath()` 7-rule + `buildWorkspaceR2Key()` |
| workspace D1 truth (P2-02) | `done` | `D1WorkspaceControlPlane` list/upsert/delete + `content_hash` |
| filesystem-core temp-file RPC (P2-03) | `missing` | `not-started`（closure 坦承 P1） |
| workspace public CRUD routes (P2-04) | `missing` | `not-wired-on-route-side`（closure 坦承 P2） |
| tool.call.cancelled event (P3-01) | `done` | `cancel_initiator` enum（`user/system/parent_cancel`），12-kind catalog |
| tool-calls list/cancel routes (P3-02) | `missing` | `not-wired-on-route-side`（closure 坦承 P3） |
| artifact promotion/provenance (P4-01) | `missing` | `not-wired`（closure 坦承 P4） |
| cleanup jobs cron (P4-02) | `missing` | `not-wired`（closure 坦承 P5） |
| agent-core WriteTodos capability (P5-01) | `missing` | `not-wired`（closure 坦承 P7） |
| cross-e2e (P5-02) | `missing` | `not-run`（closure 坦承 P6） |
| HP6 closure | `partial` | closure 诚实标注 `partial-live` |

### 3.2 HP7 逐项对齐

| 编号 | 计划项（取自 action-plan） | 审查结论 | 说明 |
|------|---------------------------|----------|------|
| checkpoint registry + lazy snapshot (P1) | `done` | `D1CheckpointSnapshotPlane` + `fileSnapshotPolicyForKind`（Q22 lazy/eager） |
| restore job plane (P2) | `done` | `D1CheckpointRestoreJobs` openJob/terminate + confirmation gate + failure_reason + 幂等 |
| diff projector 扩展 (P2) | `done` | `CheckpointDiffProjector` message + workspace + artifact 三层 |
| session.fork.created event (P4) | `done` | 12-kind catalog + fork R2 key law + child namespace 隔离 |
| R2 key laws (P1/P4) | `done` | `buildCheckpointSnapshotR2Key` + `buildForkWorkspaceR2Key` |
| restore executor (P3) | `missing` | `not-wired`（closure 坦承 P1-P3） |
| fork executor (P4) | `missing` | `not-wired`（closure 坦承 P4） |
| TTL cleanup cron (P4) | `missing` | `not-wired`（closure 坦承 P5） |
| public restore/fork routes (P5) | `missing` | `not-wired`（closure 坦承 P6） |
| cross-e2e (P6) | `missing` | `not-run`（closure 坦承 P7） |
| HP7 closure | `partial` | closure 诚实标注 `partial-live` |

### 3.3 HP8 逐项对齐

| 编号 | 计划项（取自 action-plan） | 审查结论 | 说明 |
|------|---------------------------|----------|------|
| megafile budget gate (P3-01) | `done` | `check:megafile-budget` live，5 文件均在 budget 内 |
| tool drift gate (P3-02a) | `done` | `check:tool-drift` live，catalog SSoT clean |
| envelope drift gate (P3-02b) | `done` | `check:envelope-drift` live，public only scope |
| tool catalog SSoT (P4-01) | `done` | `nacp-core/src/tools/tool-catalog.ts` 81 行，`Object.freeze` + re-export |
| Lane E final-state (P1-03) | `done` | `lane-e-final-state.md` 77 行，Q28 4 字段齐全，终态 = `retained-with-reason` |
| heartbeat alarm 主线 (P2-01) | `partial` | alarm.ts 101 行 logic 存在，但 4-scenario e2e 未运行 |
| R28 explicit register (P1-01) | `missing` | `zx5-r28-investigation.md` 有诊断步骤但无终态判定（closure 坦承 P1 `not-started`） |
| R29 verifier + postmortem (P1-02) | `missing` | 脚本不存在 + postmortem 文档不存在（closure 坦承 P2 `not-started`）（见 N1/N2） |
| consumer migration to catalog (P4-02) | `missing` | agent-core/bash-core 未消费 catalog（closure 坦承 P5 `not-wired`） |
| envelope consumer migration (P4-03) | `missing` | `not-wired`（closure 坦承 P6） |
| heartbeat 4-scenario e2e (P2-02) | `missing` | `not-run`（closure 坦承 P4） |
| HP9 freeze gate | `not-granted` | 正确判定（closure §5） |

### 3.4 对齐结论

| 状态 | HP6 | HP7 | HP8 | 合计 |
|------|-----|-----|-----|------|
| done | 5 | 6 | 4 | 15 |
| partial | 0 | 0 | 1 | 1 |
| missing | 8 | 5 | 7 | 20 |
| **总计** | **13** | **11** | **12** | **36** |

> **一句话总结**: HP6/HP7/HP8 的 first wave（control plane / durable truth / protocol）均已落地且通过测试，但所有涉及 runtime enforcement / executor / agent-core wiring 的 second-wave 项全部处于 `missing` 或 `partial` 状态。这与 HP2-HP5 的模式完全一致。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | TodoWrite V2 task graph (O15) | `遵守` | 未实现，todo 保持 V1 flat |
| O2 | WriteFileTool diff/patch 模式 | `遵守` | 未实现 |
| O3 | 跨 conversation fork | `遵守` | fork 限定 same conversation（Q23） |
| O4 | checkpoint diff visualizer | `遵守` | 仅返 JSON |
| O5 | permission/elicitation 旧端点物理删除 | `遵守` | 保留 compat |
| O6 | Multi-provider routing | `遵守` | 无相关代码 |
| O7 | Sub-agent / multi-agent | `遵守` | 无相关代码 |
| O8 | Admin plane / billing | `遵守` | 无相关代码 |
| O9 | checkpoint export/import | `遵守` | 未实现 |
| O10 | tool cancel 不入 confirmation kind enum | `遵守` | `tool.call.cancelled` 仅作 stream event（Q21 + HP5 closure §3 K4） |
| O11 | `forwardInternalJsonShadow` 物理删除 | `遵守` | 保留至 HP10 |
| O12 | `parity-bridge.ts` 物理删除 | `遵守` | 保留至 HP10 |

---

## 5. 全阶段（HP0-HP10）跨阶段跨包深度分析

### 5.1 全阶段 phase 完成度全景图

| Phase | 名称 | 自评状态 | 核心 gap | cross-e2e |
|-------|------|---------|----------|-----------|
| HP0 | 前置 defer 修复 | ✅ closed | 无 | done |
| HP1 | DDL 集中扩展 | ✅ closed | 无（014 correction 已登记） | n/a |
| HP2 | Model 状态机 | `partial-live` | `<model_switch>` / `model.fallback` / agent-core wiring / cross-e2e | ❌ |
| HP3 | Context 状态机 | `partial-live` | CrossTurnContextManager / auto-compact / strip-recover / breaker / cross-e2e | ❌ |
| HP4 | Chat 生命周期 | `partial-live` | retry / restore job / rollback safety / cross-e2e | ❌ |
| HP5 | Confirmation 收拢 | `partial-live` | emitter row-create / 5 kind 非 live / cross-e2e 15-18 | ❌ |
| HP6 | Tool/Workspace | `partial-live` | filesystem-core RPC / workspace CRUD / tool-calls / promote / cleanup / cross-e2e | ❌ |
| HP7 | Checkpoint Revert | `partial-live` | restore/fork executor / TTL cron / public routes / cross-e2e | ❌ |
| HP8 | Runtime Hardening | `partial-live` | R28/R29 register / heartbeat e2e / consumer migration | ❌ |
| HP9 | API Docs + Evidence | 未启动 | HP8 §5: freeze gate NOT GRANTED | n/a |
| HP10 | Final Closure | 未启动 | 依赖 HP9 closure | n/a |

### 5.2 系统性问题: 全阶段 first-wave/second-wave 分裂

从 HP2 到 HP8 的实施呈现一个清晰的双层模式:

**First wave（全 phase 已完成）**:
- D1 durable truth / control plane helper（`*-control-plane.ts` / `*-plane.ts`）
- Public façade route registration（`index.ts` 路由）
- NACP 协议帧族扩展（`nacp-session/src/messages.ts` / `stream-event.ts`）
- 单包单元测试

**Second wave（全 phase 未完成，deferred to "后续批次"）**:
- agent-core runtime enforcement / executor
- Cross-worker RPC wiring（如 context-core ↔ agent-core）
- Cross-e2e 验证
- Runtime state machine 真正闭环

这种模式有优点（基础设施先行、协议冻结早、单包测试覆盖高），但在全阶段视角下造成:
1. **35+ deferred items 堆积**，无明确的 batch plan 或 timebox
2. **任何 phase 都不能宣称 `closed`**，但 phase 之间又严格串行依赖（charter §6.3）
3. **HP9 freeze gate 无法合法触发** — 因为 HP8 自身也是 partial
4. **HP10 final closure 的 F1-F17 chronic register** 大部分项仍留在 `partial` 状态

### 5.3 跨阶段连线断裂深度分析

以下 5 条跨阶段连线在 first wave 中铺设了基础设施，但在 second wave 的缺失下仍无法工作:

| 连线 | 当前状态 | 断裂点 |
|------|---------|--------|
| Model state → LLM call | orchestrator-core 完整（三层模型链），agent-core 部分（只从 message payload 读 modelId） | session default 未传至 agent-core（R7 in HP2-HP4 review） |
| Context probe → auto-compact | context-core 完整（budget 计算），orchestrator-core 完整（路由），agent-core 死链路（`compactRequired: false`） | host 永不触发 compact |
| Confirmation plane → tool pause | `confirmation-control-plane` 完整，`/confirmations` API 完整，emitter 侧未 row-create | PreToolUse 不触发 confirmation |
| Checkpoint registry → restore | `checkpoint-restore-plane` 544 行完整，无 HTTP 路由，无 executor | 用户无法 restore |
| todo registry → LLM WriteTodos | `todo-control-plane` 完整，agent-core 无 WriteTodos capability 接线 | LLM 不能写 todo |

### 5.4 `clients/api-docs/` 全阶段状态审计

| 文件 | 最后一次更新 | 当前与代码对齐 | 发现 |
|------|-------------|---------------|------|
| `README.md` | Apr 30 16:13 | ✅ | HP2-HP4 路由完整登记 |
| `session.md` | Apr 30 16:13 | ✅ | 含 HP2-HP4 context/checkpoint 路由，诚实标注 gap |
| `auth.md` | Apr 30 02:40 | ✅ | 未变更 |
| `catalog.md` | Apr 30 14:43 | ✅ | 未变更 |
| `error-index.md` | Apr 30 16:14 | ✅ | 新增错误码已登记 |
| `me-sessions.md` | Apr 30 15:37 | ✅ | cursor read model 变更已反映 |
| `permissions.md` | Apr 30 02:42 | ✅ | 未变更 |
| `session-ws-v1.md` | Apr 30 05:35 | ✅ | 未变更 |
| `usage.md` | Apr 30 14:43 | ✅ | 未变更 |
| `wechat-auth.md` | Apr 30 02:42 | ✅ | 未变更 |
| `worker-health.md` | Apr 30 05:35 | ✅ | 未变更 |

**文档总数**: 11 份（charter HP9 目标: 18 份。需新增 `models.md` / `context.md` / `checkpoints.md` / `confirmations.md` / `todos.md` / `workspace.md` / `transport-profiles.md` 共 7 份）。

**纪律遵守**: HP2/HP3/HP4 散落更新了 docs（违反 charter §4.4 纪律 3），HP6/HP7/HP8 严格遵守 `not-touched`。

**未反映的 HP6-HP8 surface**: `/sessions/{id}/todos` CRUD、`session.todos.*` 帧、`tool.call.cancelled`、`session.fork.created`、checkpoint diff 扩展 —— 这些均在 HP9 目标中。

### 5.5 命名规范与执行逻辑一致性

**正面发现**:
- 新文件命名遵循 `*-control-plane.ts` / `*-plane.ts` 统一模式（`todo-control-plane.ts`、`workspace-control-plane.ts`、`checkpoint-restore-plane.ts`、`checkpoint-diff-projector.ts`、`confirmation-control-plane.ts`、`context-control-plane.ts`）
- NACP 帧族命名保持 `{domain}.{entity}.{action}` 约定（`session.todos.write` / `session.todos.update` / `session.fork.created`）
- `cancel_initiator` enum 值 `user / system / parent_cancel` 语义清晰
- snapshot/restore status enum 命名一致（四级 `file_snapshot_status` + 四级 `snapshot_status` + 六级 `restore_status`）
- `buildWorkspaceR2Key` / `buildCheckpointSnapshotR2Key` / `buildForkWorkspaceR2Key` 三个 key builder 命名模式一致
- Todo 5-status enum（`pending / in_progress / completed / cancelled / blocked`）与 Confirmation 6-status enum（`pending / allowed / denied / modified / timeout / superseded`）独立正交，无混淆

**问题发现**:
- `tool.call.cancelled` vs `tool.cancelled` 命名: stream-event.ts 中的 kind 是 `tool.call.cancelled`，但 nacp-session index.ts 中某些引用使用了 `tool.cancelled` 缩写。需统一（见 N12）。
- `megafile-budget.json` 文件命名中 "megafile" 的 file name 描述: `facade-router` / `d1-truth-aggregator` / `user-do-runtime` / `session-do-runtime` / `kernel-runner` 并非标准文件名而是描述性标签，但脚本正确映射到实际文件路径。

### 5.6 F1-F17 chronic status 全阶段演进

| Chronic | 说明 | 当前最终判定（HP8 closure） | 审查意见 |
|---------|------|---------------------------|----------|
| F1 | 公共入口模型字段透传断裂 | `closed-by-HP0` | ✅ 正确 |
| F2 | system prompt suffix 缺失 | `closed-by-review-fix` | ✅ HP4 §12 review-fix 已验证 |
| F3 | session-level model + alias | `closed-by-HP2-first-wave` | ⚠️ first wave 完成但 second wave（model_switch/fallback event）未完成 |
| F4 | context state machine | `carried-from-HP3-partial` | ⚠️ auto-compact 死链路 |
| F5 | chat lifecycle | `carried-from-HP4-partial` | ⚠️ retry/restore 未实现 |
| F6 | confirmation control plane | `carried-from-HP5-partial` | ⚠️ emitter caller 未接通 |
| F7 | tool workspace state machine | `partial-by-HP6` | ⚠️ workspace CRUD/promote/cleanup 未实现 |
| F8 | checkpoint / revert | `partial-by-HP7` | ⚠️ executor/route 未实现 |
| F9 | runtime hardening | `partial-by-HP8` | ⚠️ heartbeat e2e + R28/R29 未完成 |
| F10 | R29 postmortem | `still-handed-to-platform` | ❌ postmortem 文档不存在（N2） |
| F11 | API docs + 手工证据 | `partial-by-HP3-and-HP4` | HP9 待命 |
| F12 | final closure | `not-touched` | HP10 待命 |
| F13 | observability drift | `partial-by-HP3/HP6/HP7-and-HP8` | ✅ 多次 inspector 同步 |
| F14 | tenant-scoped storage | `partial-by-HP6-and-HP7` | ⚠️ R2 key law 已固定但实际写入未实现 |
| F15 | DO checkpoint vs product registry 解耦 | `closed-by-HP1` | ✅ 验证通过 |
| F16 | confirmation_pending 统一 | `closed-by-HP5` | ✅ 验证通过 |
| F17 | model_switch strip-recover | `partial-by-HP3` | ⚠️ protected marker 存在但未 recover |

**合计**: 4 项 `closed`、12 项 `partial`、1 项 `not-touched` — 无一 `handed-to-platform` 被真正完成登记件（R29 标 `handed-to-platform` 但缺 Q28 4 字段文档）。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**: HP6/HP7/HP8 first wave 的实现质量良好——所有 closure 中声明的 `done-first-wave` 交付物均可在代码中找到且通过测试（1922 tests + 3 root gates 全部 green）。closures 自评 `partial` 诚实且准确。**但从全阶段（HP0-HP10）视角，hero-to-pro 当前处于一种系统性半完成状态：8 个 implementation phase 无一个 `closed`，35+ second-wave items 堆积，无 cross-e2e 保护，无 R28/R29 explicit register，HP9 freeze gate 无法合法触发。**

- **是否允许关闭本轮 review**: `no`

- **关闭前必须完成的 blocker**:
  1. **N1+N2**: 完成 R29 的双重空白 — 创建 `verify-initial-context-divergence.mjs`（至少脚本骨架）并完成或显式 handoff `R29-postmortem.md`
  2. **N3**: R28/R29 的 Q28 explicit register — 在 HP8 closure 中回填 `closed / retained-with-reason / handed-to-platform` 判定，4 字段齐全
  3. **N10+N11**: 制定 second-wave batch plan — 明确 35+ deferred items 中哪些在 hero-to-pro 内完成、哪些 `handed-to-platform`、哪些 `retained-with-reason`，含 timebox

- **可以后续跟进的 non-blocking follow-up**:
  1. N4: agent-core/bash-core 消费 nacp-core tool catalog
  2. N5: `compactRequired` 解除硬编码（归 HP3）
  3. N6: checkpoint-restore-plane HTTP 路由注册（归 HP7）
  4. N7: filesystem-core temp-file RPC 实现（归 HP6）
  5. N8: workspace/tool-calls HTTP 面实现（归 HP6）
  6. N9: action-plan 文档状态标注修正
  7. N12: `tool.call.cancelled` / `tool.cancelled` 命名统一
  8. HP5 emitter 侧 row-create 接通
  9. HP5 cross-e2e 15-18 补齐
  10. HP2/HP3/HP4/HP6/HP7 cross-e2e 补齐
  11. HP8 heartbeat 4-scenario e2e 补齐
  12. HP8 envelope consumer migration
  13. HP2 `<model_switch>` developer message 注入
  14. HP2 `model.fallback` stream event
  15. HP3 CrossTurnContextManager
  16. HP4 retry 路由
  17. HP4/HP7 restore/fork executor

- **建议的二次审查方式**: `independent reviewer` — 在 second-wave batch plan 完成后，建议由不同 reviewer 做全阶段 final review

- **实现者回应入口**: `请按 docs/templates/code-review-respond.md 在本文档 §8 append 回应，不要改写 §0–§7。`

---

## 7. 附录: 全阶段证据完整矩阵

### 7.1 全阶段测试通过矩阵（HP0-HP8）

| 包 | HP2-HP4 基准 | HP6-HP8 当前 | 变化 |
|----|-------------|-------------|------|
| `@haimang/orchestrator-core-worker` | 300/300（32 文件） | 305/305（33 文件） | +5 tests, +1 test file |
| `@haimang/agent-core-worker` | 1077/1077（103 文件） | 1077/1077（103 文件） | 无变化 |
| `@haimang/context-core-worker` | 178/178（20 文件） | 178/178（20 文件） | 无变化 |
| `@haimang/nacp-session` | 191/191（18 文件） | 196/196（19 文件） | +5 tests, +1 test file |
| `@haimang/nacp-core` | N/A | 344/344（27 文件） | +344 tests（new） |
| **合计** | **1746** | **1922** | **+176 tests, +2 test files** |

### 7.2 HP6-HP8 新增/修改测试文件

| 文件 | 对应 Phase | 覆盖内容 |
|------|-----------|----------|
| `orchestrator-core/test/todo-control-plane.test.ts` | HP6 | todo registry helper（11 tests） |
| `orchestrator-core/test/todo-route.test.ts` | HP6 | todo route wiring（7 tests） |
| `orchestrator-core/test/workspace-control-plane.test.ts` | HP6 | workspace path + D1 truth（18 tests） |
| `orchestrator-core/test/checkpoint-restore-plane.test.ts` | HP7 | snapshot + restore job planes（25 tests） |
| `orchestrator-core/test/checkpoint-diff-projector.test.ts` | HP7 | diff projector（5 tests） |
| `nacp-session/test/hp6-todo-messages.test.ts` | HP6 | todo frames（14 tests） |
| `nacp-session/test/hp6-tool-cancelled.test.ts` | HP6 | tool.call.cancelled（7 tests） |
| `nacp-session/test/hp7-fork-created.test.ts` | HP7 | fork event（5 tests） |
| `nacp-session/test/stream-event.test.ts` | HP7 | 12-kind catalog update |
| `nacp-core/test/tool-catalog.test.ts` | HP8 | tool catalog SSoT（7 tests） |
| `agent-core/test/eval/inspector.test.ts` | HP7/HP8 | inspector mirrored constant update |

### 7.3 HP8 root gate 运行结果

| Gate | 脚本 | 结果 |
|------|------|------|
| `check:megafile-budget` | `scripts/check-megafile-budget.mjs` | ✅ 5/5 within budget |
| `check:tool-drift` | `scripts/check-tool-drift.mjs` | ✅ 1 tool id (bash) registered |
| `check:envelope-drift` | `scripts/check-envelope-drift.mjs` | ✅ 1 public file clean |

### 7.4 此次审查未核查的项目（已知限制）

- `pnpm test:cross-e2e`: 所有 closures 均标注未运行，本轮审查也未执行
- Live preview deploy 验证: 未执行
- DO checkpoint restore 一致性: 如需验证需要 real-time Workers runtime
- WeChat 真机 smoke: 归 HP9 manual evidence pack
- F1+F2 manual evidence pack: 归 HP9
- F16 prod schema baseline: 归 HP9

### 7.5 HP8 closure §5 HP9 freeze gate 解锁条件复审

| 条件 | 当前状态 | 审查判断 |
|------|---------|----------|
| R28 register 进入终态 | `not-started`（模板 only） | 待满足 |
| R29 register 进入终态 | `not-started`（文件不存在） | 待满足 |
| heartbeat 4-scenario e2e 全绿 | `not-run` | 待满足 |
| owner 显式接受 handed-to-platform | 未声明 | 可选路径 |

**审查确认**: HP8 closure §5 的 `NOT GRANTED` 判定是正确的。但如果 HP9 必须在 hero-to-pro 阶段完成（charter §10.1 Primary Exit 3），则上述任一条件的满足性不是可选项而是必须项。

在条件 4（owner 显式接受）未触发的情况下，R28/R29/heartbeat 三项至少需要两项完成。考虑到:
- R28 依赖 owner action（wrangler tail 复盘），受 chart §12 Q1 时间约束
- R29 可以做 without owner action（只需完成 postmortem 三选一判定 + verify 脚本）
- heartbeat e2e 可以独立完成

**建议的 realistic unlock 路径**: 在 HP8 后续批次中完成 R29 postmortem + heartbeat 4-scenario e2e，R28 以 `retained-with-reason` 于 Q28 4 字段齐全登记。
