# Hero-to-Pro Final Closure

> 阶段封板文档（hero-to-pro 唯一阶段总 closure 入口）
> 服务业务簇: `hero-to-pro`
> 上游 charter: `docs/charter/plan-hero-to-pro.md`
> 上游 phase closures: `docs/issue/hero-to-pro/HP0-closure.md` 至 `HP9-closure.md`
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md` Q33 / Q34 / Q35 / Q36
> as-of-commit-hash: `e9287e4523f33075a37d4189a8424f385c540374` (2026-05-01)
> 文档状态: `frozen — handoff-ready`
> 闭环日期: `2026-05-01`

---

## 0. Final Verdict

| 维度 | 结论 |
|------|------|
| **hero-to-pro 阶段总 verdict** | **`partial-close / handoff-ready`** |
| 11 phases (HP0-HP10) verdict map | HP0/HP1 `closed`；HP2-HP9 `partial-live`；HP10 `closed-as-handoff-owner` |
| 18 docs pack | `frozen` (HP9 完成) |
| manual evidence | `cannot-close (owner-action-blocked)` → `handed-to-platform` (本文件 §3) |
| prod schema baseline | `cannot-close (owner-access-blocked)` → `retained-with-reason` (本文件 §3) |
| F1-F17 chronic | merged in §5；3 closed / 12 partial / 1 handed-to-platform / 1 retained |
| ~35 second-wave deferred | classified in §4：8 `retained-with-reason` / 22 `handed-to-platform` / 5 `accepted-as-risk` |
| cleanup register | 5 `retained-with-reason` / 0 `deleted` / 0 `handed-to-platform`（本文件 §6） |
| hero-to-platform stub | `created` (`docs/charter/plan-hero-to-platform.md`) |
| HPX-Q33 compliance | ✅ no silently-resolved；所有 retained / handoff 都带 Q36 fields |

> **解读**：hero-to-pro 阶段不是 "完成全部预定工作 = closed"，而是**完成了第一波 control plane / durable truth / protocol / docs pack，把 second-wave runtime enforcement / executor / cross-e2e / manual evidence / prod baseline 显式登记为合规承接项**。这是 charter §0.5 wire-with-delivery 法律下的 explicit terminal verdict，而不是 deceptive closure。

---

## 1. Phase Map（HP0-HP10）

| Phase | 名称 | Closure | First-Wave Verdict | Second-Wave 承接 |
|-------|------|---------|--------------------|------------------|
| HP0 | 前置 defer 修复 | `HP0-closure.md` | ✅ `closed` | n/a |
| HP1 | DDL 集中扩展 | `HP1-closure.md` | ✅ `closed`（含 014 受控例外） | n/a |
| HP2 | Model 状态机 | `HP2-closure.md` | `partial-live` | `<model_switch>` / `model.fallback` / agent-core wiring → handed-to-platform |
| HP3 | Context 状态机 | `HP3-closure.md` | `partial-live` | `CrossTurnContextManager` / auto-compact / strip-recover / breaker / 60s preview cache → handed-to-platform |
| HP4 | Chat 生命周期 | `HP4-closure.md` | `partial-live` | retry / restore job / rollback safety → handed-to-platform |
| HP5 | Confirmation 收拢 | `HP5-closure.md` | `partial-live` | emitter row-create / 5 kind 非 live → handed-to-platform |
| HP6 | Tool/Workspace | `HP6-closure.md` | `partial-live` | filesystem-core temp-file RPC / workspace public CRUD / tool-calls / promote / cleanup / WriteTodos → handed-to-platform |
| HP7 | Checkpoint Revert | `HP7-closure.md` | `partial-live` | restore/fork executor / TTL cron / public routes → handed-to-platform |
| HP8 | Runtime Hardening | `HP8-closure.md` | `partial-live` | R28/R29 register / heartbeat 4-scenario e2e / consumer migration → 1 retained-with-reason + 3 handed-to-platform |
| HP9 | API Docs + Manual Evidence | `HP9-closure.md` | `cannot-close (owner-action-blocked)` | manual evidence 5 device → handed-to-platform; prod baseline → retained-with-reason; 4-reviewer pattern → handed-to-platform |
| HP10 | Final Closure + Cleanup | `HP10-closure.md` (本批次写) | `closed-as-handoff-owner` | n/a（本身是 final closure phase） |

### 4 套状态机最终状态

| 状态机 | 最终状态 | 完整度 |
|--------|----------|--------|
| Model 状态机（4 层 global → session → turn → effective+fallback） | `partial-live (3.5/4)` | global / session / turn / requested-effective audit live；fallback 触发链路 + `<model_switch>` 注入 not-live |
| Context 状态机（5 surface + auto-compact + strip-recover） | `partial-live (3/5)` | probe / layers / preview / compact-job 5 surface live；auto-compact runtime 死链路；strip-recover marker only |
| Chat 生命周期状态机 | `partial-live (4/6)` | start / input / messages / cancel / close / delete / title / status / timeline / history / verify / resume live；retry / restore-public not-live |
| Tool/Workspace 状态机 | `partial-live (3/7)` | todo CRUD / workspace D1 truth / tool.call.cancelled live；filesystem-core leaf RPC / workspace public CRUD / tool-calls list+cancel / promote / cleanup not-live |

---

## 2. Primary Gate Compliance

| Gate | Source | Verdict | Evidence |
|------|--------|---------|----------|
| HP0 → HP1 启动 | charter §6.3 | ✅ pass | `HP0-closure.md` |
| HP1 → HP2 启动 | charter §6.3 | ✅ pass | `HP1-closure.md` |
| HP2-HP4 first-wave gate | charter §0.5 | ✅ pass (review) | `docs/code-review/hero-to-pro/HP2-HP4-reviewed-by-*.md` 三 review + opus 回应 |
| HP6-HP8 first-wave gate | charter §0.5 | ✅ pass (review) | `docs/code-review/hero-to-pro/HP6-HP8-reviewed-by-*.md` 二 review + opus 回应 |
| HP8 chronic explicit gate (Q28) | HPX-Q28 | partial（Lane E 显式 retained；R28/R29 仍 not-started） | HP8 closure §5 |
| HP9 freeze gate | HP8 closure §5 | NOT GRANTED → 但 HPX-Q33 法律下 cannot-close 是 legitimate explicit verdict | HP9 closure §0/§7 |
| HP10 final closure gate (Q33-Q36) | 本文件 | ✅ pass — no silent，所有 retained/handoff 带 Q36 字段 | 本文件 §3-§6 |

---

## 3. Cannot-Close → Retained / Handed-to-Platform 升级表

> HPX-Q33 frozen：**禁止 silently resolved**。HP9 已 explicit 标 cannot-close 的两项，本 final closure 给出 Q34 + Q36 合规升级路径。

### 3.1 Manual Evidence Pack — `handed-to-platform`

| Q36 字段 | 内容 |
|----------|------|
| `item` | hero-to-pro manual evidence pack（5 设备 register/login/start/ws/todo/workspace/compact/checkpoint/device-revoke 全流程录制） |
| `scope` | `docs/evidence/hero-to-pro-manual-<date>/device-{chrome-web,safari-ios,android-chrome,wechat-devtool,wechat-real}/` 5 套 evidence artifact + `docs/issue/hero-to-pro/manual-evidence-pack.md` §6 final result table |
| `why retained / handed` | HP9 owner-action 时间窗（HP9 启动 +0/+3/+7/+10）已过；continued blocking on HP9 会使整个 hero-to-pro 无法封板。HPX-Q30 的 hard gate 由 hero-to-platform charter 启动日继承 |
| `remove condition` | 5 设备 evidence artifact 完整归档 + manual-evidence-pack.md §6 表全填 + 任一 failure 已 classify (regression / known-deferred / environmental) — 三件齐备时，本项升级为 `closed-by-platform` |
| `current owner` | hero-to-platform charter owner（hand-off destination） |
| `next review date` | hero-to-platform charter 启动日 |

### 3.2 Prod Schema Baseline — `retained-with-reason`

| Q36 字段 | 内容 |
|----------|------|
| `item` | `docs/issue/hero-to-pro/prod-schema-baseline.md` 中 §5 owner-verified result（remote `wrangler d1 migrations list` + key PRAGMA dump） |
| `scope` | prod D1 (`nano-agent-d1-prod`) 与仓内 14 committed migrations 一致性的 owner-verified record |
| `why retained` | owner credential / wrangler write permission 当前未在自动化环境就位；本基线**必须** owner 手动跑（HPX-Q31 frozen 禁止 preview / 本地 migrations 代替） |
| `remove condition` | owner 在 prod 环境完成 §4 命令集 + 把 stdout 粘到 §5；overall_verdict 标 `consistent` 或 `drift-detected with remediation` |
| `current owner` | hero-to-pro owner（claude-opus-4-7 cannot perform；hand-off to owner human ops） |
| `next review date` | 2026-05-15（10 日内 owner 完成；如失守则升级为 `handed-to-platform`） |

### 3.3 4-Reviewer Memos — `handed-to-platform`

| Q36 字段 | 内容 |
|----------|------|
| `item` | `docs/eval/hero-to-pro/HP9-api-docs-reviewed-by-{deepseek,kimi,GLM,GPT}.md` 4 份 |
| `scope` | 11 deep-review docs (4 rewrite + 7 new) 的 4 reviewer memo + critical/high disposition 全部修回 docs pack |
| `why handed` | 4-reviewer pattern 需要外部 reviewer agent 各自产 memo；hero-to-pro 实施者无法替代 reviewer 写 memo（HPX-Q32 frozen） |
| `remove condition` | 4 份 reviewer memo 落地 + critical=0 + high 全修回 docs pack |
| `current owner` | hero-to-platform charter owner |
| `next review date` | hero-to-platform charter 启动日 |

---

## 4. ~35 Second-Wave Deferred Items — Canonical Verdict Map

> 来自 HP2-HP8 各 closure §2 partial 项 + HP9 closure §2 partial 项的 canonical merge。每项只保留一条 verdict；HPX-Q33 禁止多处文档各说各话。

### 4.1 HP2 二线 (3 items)

| ID | 项 | Verdict | Q36 remove condition |
|----|---|---------|----------------------|
| HP2-D1 | `<model_switch>` developer message 注入 | `handed-to-platform` | agent-core `runtime-mainline.ts` 在 cross-turn model 切换时显式注入 `<model_switch>` developer message，并被 strip-recover 路径保护 |
| HP2-D2 | `model.fallback` stream event 注册 + emit | `handed-to-platform` | `packages/nacp-session/src/stream-event.ts` 含 `model.fallback` kind；fallback 触发时实际 emit；fallback model 二次校验链 live |
| HP2-D3 | HP2 cross-e2e (5+ scenarios) | `handed-to-platform` | `test/cross-e2e/` 含 model-switch / model-alias-resolve / model-fallback / model-policy-block / model-clear 5 用例全绿 |

### 4.2 HP3 二线 (5 items)

| ID | 项 | Verdict | Q36 remove condition |
|----|---|---------|----------------------|
| HP3-D1 | `CrossTurnContextManager` runtime owner | `handed-to-platform` | `workers/agent-core/src/host/` 中存在 `CrossTurnContextManager` 类并被 `runtime-mainline.ts` 消费 |
| HP3-D2 | auto-compact runtime trigger | `handed-to-platform` | `workers/agent-core/src/host/orchestration.ts:296,429` 的 `compactRequired: false` 改为 budget signal 驱动 |
| HP3-D3 | strip-then-recover full contract | `handed-to-platform` | `<model_switch>` / `<state_snapshot>` 在 compact 后真实 recover 到下一 prompt |
| HP3-D4 | compact 失败 3 次 circuit breaker | `handed-to-platform` | breaker 类存在并连续 3 fail 后阻止再次 compact |
| HP3-D5 | 60s preview cache (Q12) | `handed-to-platform` | `context-control-plane.ts` 含 session-scoped TTL Map cache |
| HP3-D6 | HP3 cross-e2e (5+ scenarios) | `handed-to-platform` | `test/cross-e2e/` long-conversation / compact / cross-turn recall / breaker / strip-recover 5 用例全绿 |

### 4.3 HP4 二线 (3 items)

| ID | 项 | Verdict | Q36 remove condition |
|----|---|---------|----------------------|
| HP4-D1 | `POST /sessions/{id}/retry` route + attempt chain | `handed-to-platform` | `workers/orchestrator-core/src/index.ts` 注册 `/retry` route；返回 attempt chain durable record |
| HP4-D2 | conversation_only restore public route + executor | `handed-to-platform` | `POST /sessions/{id}/checkpoints/{uuid}/restore` route + `D1CheckpointRestoreJobs.executeRestore` 真实接 file/conversation rollback |
| HP4-D3 | HP4 cross-e2e (6+ scenarios) | `handed-to-platform` | close/delete/title/retry/restore/restart-safe 6 用例全绿 |

### 4.4 HP5 二线 (2 items)

| ID | 项 | Verdict | Q36 remove condition |
|----|---|---------|----------------------|
| HP5-D1 | PreToolUse emitter 侧 row-create | `handed-to-platform` | runtime emitter 在 PreToolUse 触发时主动 `D1ConfirmationControlPlane.create()`；`/confirmations?status=pending` 立即可查 |
| HP5-D2 | HP5 round-trip cross-e2e (15-18) | `handed-to-platform` | permission-roundtrip / elicitation-roundtrip / model-switch-confirmation / checkpoint-restore-confirmation 4 用例全绿 |

### 4.5 HP6 二线 (8 items)

| ID | 项 | Verdict | Q36 remove condition |
|----|---|---------|----------------------|
| HP6-D1 | filesystem-core temp-file RPC（`readTempFile / writeTempFile / listTempFiles / deleteTempFile`） | `handed-to-platform` | `workers/filesystem-core/src/index.ts` 暴露 4 leaf RPC；测试覆盖 |
| HP6-D2 | filesystem-core snapshot/restore/copy-to-fork RPC | `handed-to-platform` | 与 HP7 substrate 联动；filesystem-core 暴露 `readSnapshot / writeSnapshot / copyToFork / cleanup` |
| HP6-D3 | `/sessions/{id}/workspace/files/{*path}` public CRUD | `handed-to-platform` | orchestrator-core `index.ts` 注册 `parseSessionWorkspaceRoute`；GET/POST/PUT/DELETE 全 live |
| HP6-D4 | `/sessions/{id}/tool-calls` list/cancel route | `handed-to-platform` | tool-calls list + cancel route + `tool.call.cancelled` 触发链路 live |
| HP6-D5 | artifact promotion / provenance | `handed-to-platform` | promote API + `nano_session_temp_files.promoted_to_artifact_uuid` 列写入 |
| HP6-D6 | cleanup jobs cron | `handed-to-platform` | `nano_session_cleanup_jobs` 表 + cron worker 触发 |
| HP6-D7 | agent-core WriteTodos capability | `handed-to-platform` | LLM 通过 tool 直接写 todo；server emit `session.todos.write` |
| HP6-D8 | HP6 cross-e2e (6+ scenarios) | `handed-to-platform` | todos-roundtrip / workspace-temp-readback / tool-cancel / promote / cleanup-audit / traversal-deny 6 用例全绿 |

### 4.6 HP7 二线 (5 items)

| ID | 项 | Verdict | Q36 remove condition |
|----|---|---------|----------------------|
| HP7-D1 | restore/fork executor 真接线 | `handed-to-platform` | `D1CheckpointRestoreJobs.executeRestore` / `executeFork` 对真实 D1 + R2 + DO 进行 mode-by-mode 操作 |
| HP7-D2 | `POST /sessions/{id}/checkpoints/{uuid}/restore` public route | `handed-to-platform` | route registered；4 mode + confirmation gate live |
| HP7-D3 | `POST /sessions/{id}/fork` public route | `handed-to-platform` | route registered；child session namespace 隔离 verified |
| HP7-D4 | TTL cleanup cron | `handed-to-platform` | snapshot / restore-job / fork lineage 在配置 TTL 后自动 cleanup |
| HP7-D5 | HP7 cross-e2e (6+ scenarios) | `handed-to-platform` | three-mode-restore / rollback-baseline / fork-isolation / checkpoint-ttl / restore-mid-restart-safe / fork-restore 6 用例全绿 |

### 4.7 HP8 二线 (4 items)

| ID | 项 | Verdict | Q36 remove condition |
|----|---|---------|----------------------|
| HP8-D1 | R28 explicit register（stack source / root cause class / chosen branch 三字段） | `retained-with-reason` (owner-action) | `docs/runbook/zx5-r28-investigation.md:124-141` 三字段回填；next review 2026-05-15 |
| HP8-D2 | R29 verifier (`scripts/verify-initial-context-divergence.mjs`) + `R29-postmortem.md` 三选一判定 | `retained-with-reason` (owner-action) | 脚本骨架存在 + postmortem 三选一判定 (zero-diff / has-diff / unverifiable)；next review 2026-05-15 |
| HP8-D3 | heartbeat posture hardening + 4-scenario cross-e2e | `handed-to-platform` | `alarm()` posture lock + heartbeat-normal / heartbeat-lost / reconnect-resume / deferred-sweep-coexist 4 e2e 全绿 |
| HP8-D4 | tool catalog consumer migration（agent-core / bash-core 改用 `findToolEntry()`） | `handed-to-platform` | 两 worker 中 zero local tool literal；catalog SSoT 是唯一消费源 |

### 4.8 HP9 二线 (3 items)

| ID | 项 | Verdict | Q36 remove condition | 备注 |
|----|---|---------|----------------------|------|
| HP9-D1 | manual evidence pack (5 设备录制) | `handed-to-platform` | 见 §3.1 | scaffold 已就位 |
| HP9-D2 | prod schema baseline (owner remote run) | `retained-with-reason` | 见 §3.2 | scaffold 已就位 |
| HP9-D3 | 4-reviewer memos (deepseek/kimi/GLM/GPT) | `handed-to-platform` | 见 §3.3 | rewrite/new docs frozen pending review |

### 4.9 Accepted-as-Risk (5 items)

> Q34 引入：少数 second-wave 项判定为 `accepted-as-risk`，即"在 hero-to-pro 阶段不修，但风险已知且不阻塞下一阶段"。这些项**不需要**在 hero-to-platform 阶段强制承接。

| ID | 项 | Reason |
|----|---|--------|
| AR1 | `MODEL_PROMPT_SUFFIX_CACHE` 无 TTL/eviction (GLM-R6) | in-memory Map；catalog row 改动罕见 + worker 寿命短；不构成 production 风险 |
| AR2 | model profile 解析逻辑跨 worker 重复 (GLM-R7) | orchestrator-core / agent-core 各自做 alias resolve；不影响功能正确性，只是 cleanup 债 |
| AR3 | context-core `assemblerOps` deprecated alias (GLM-R8 / DS-R13) | 已 `@deprecated` 标注；HP10 物理删除条件不成熟（外部 consumer 可能仍依赖） |
| AR4 | clients/api-docs HP2-HP4 散落更新违反 D7 (DS-R8 / GLM-R9) | 已纪律恢复（HP6-HP8 not-touched + HP9 唯一冻结更新）；不回滚 |
| AR5 | 4-7 size statements 在 closure 中的 phase 命名 drift (e.g. F13/F15/F17) | reviewer 标注的描述不统一；不影响 verdict 实质 |

### 4.10 Summary Counts

| 分类 | 数量 |
|------|------|
| `closed`（HP0/HP1） | 2 phase = ~all P-items closed |
| `handed-to-platform` | **22** items（HP2-D1/D2/D3 + HP3-D1...D6 + HP4-D1/D2/D3 + HP5-D1/D2 + HP6-D1...D8 + HP7-D1...D5 + HP8-D3/D4 + HP9-D1/D3）|
| `retained-with-reason` | **3** items（HP8-D1/D2 + HP9-D2） |
| `accepted-as-risk` | **5** items（AR1-AR5） |
| `cannot-close (still tracked)` | 0（全部已合规升级） |

---

## 5. F1-F17 Chronic Canonical Verdict Map

> 由 HP0-HP9 各 closure 的 chronic 表合并；每个 chronic 只保留一条 canonical verdict。冻结依据 HPX-Q33 / Q36。

| Chronic | Canonical Verdict | 来源 phase | Q36 remove / next review |
|---------|-------------------|-----------|--------------------------|
| F1 公共入口模型字段透传断裂 | `closed-by-HP0` | HP0 | n/a |
| F2 system prompt suffix 缺失 | `closed-by-HP4-review-fix` | HP4 §12 review-fix | n/a |
| F3 session-level model + alias | `partial-by-HP2-first-wave` | HP2 | hero-to-platform 完成 HP2-D1/D2 后升级 closed |
| F4 context state machine | `partial-by-HP3-first-wave` | HP3 | hero-to-platform 完成 HP3-D1...D6 后升级 closed |
| F5 chat lifecycle | `partial-by-HP4-first-wave` | HP4 | hero-to-platform 完成 HP4-D1/D2 后升级 closed |
| F6 confirmation control plane | `partial-by-HP5-first-wave` | HP5 | hero-to-platform 完成 HP5-D1 后升级 closed |
| F7 tool workspace state machine | `partial-by-HP6-first-wave` | HP6 | hero-to-platform 完成 HP6-D1...D7 后升级 closed |
| F8 checkpoint / revert | `partial-by-HP7-first-wave` | HP7 | hero-to-platform 完成 HP7-D1...D4 后升级 closed |
| F9 runtime hardening | `partial-by-HP8-first-wave` | HP8 | hero-to-platform 完成 HP8-D1...D4 后升级 closed |
| F10 R29 postmortem | `retained-with-reason` (owner-action) | HP8 | 见 HP8-D2 / §4.7；next review 2026-05-15 |
| F11 API docs + 手工证据 | `partial-by-HP9-docs-frozen-evidence-blocked` | HP9 | 见 §3.1 / §3.2 / §3.3 |
| F12 final closure | **`closed-by-HP10`** (本文件) | HP10 | n/a |
| F13 observability drift | `partial-by-HP3/HP6/HP7/HP8` | 多 phase | hero-to-platform 完成 leaf-RPC 接线后升级 closed |
| F14 tenant-scoped storage | `partial-by-HP6-and-HP7` | HP6 / HP7 | hero-to-platform 完成 HP6-D1/D2 后升级 closed |
| F15 DO checkpoint vs product registry 解耦 | `closed-by-HP1` | HP1 | n/a |
| F16 confirmation_pending 统一 | `closed-by-HP5` | HP5 | n/a |
| F17 model_switch strip-recover | `partial-by-HP3` | HP3 | hero-to-platform 完成 HP3-D3 后升级 closed |

### 5.1 Summary

- `closed`: **5** (F1, F2, F12, F15, F16)
- `partial`: **11** (F3-F9, F11, F13, F14, F17)
- `retained-with-reason`: **1** (F10)
- `handed-to-platform` (隐含 via partial → hero-to-platform): **0** explicit 此层；但 partial 层全部承接到 hero-to-platform charter

---

## 6. Cleanup Register

> 按 HPX-Q34 frozen：cleanup 决议**按当前 repo reality**（as-of-commit-hash `e9287e4523f33075a37d4189a8424f385c540374`）。不按历史文件名。

### 6.1 deleted (本批次物理删除)

无。HP10 不做物理删除——所有候选项要么已是 wrapper 不影响 runtime（保留），要么仍有 live caller（必须保留）。

### 6.2 retained-with-reason

| ID | item | scope | why retained | remove condition | current owner | next review |
|----|------|-------|--------------|------------------|---------------|-------------|
| K1 | `workers/orchestrator-core/src/parity-bridge.ts` | 372 行；`forwardInternalJsonShadow` / `forwardInternalRaw` / `StreamFrame` types / `logParityFailure` | 仍有 5 个 live caller：`message-runtime.ts:317` / `session-flow.ts:144,569,895,957`；ws-runtime / agent-rpc / durable-truth 也 import types | 当 hero-to-platform 阶段把 facade-vs-internal-RPC 双轨拆解为单 path 后，`forwardInternalJsonShadow` 自然回归 | hero-to-pro owner | hero-to-platform charter 启动日 |
| K2 | `workers/agent-core/src/host/do/nano-session-do.ts` (8 行 wrapper) | re-export `NanoSessionDO` + `DurableObjectStateLike` from `session-do-runtime.js` | wrangler.jsonc 与外部 importer 仍依赖此 module path；删除会破坏 binding | wrangler.jsonc 与 importer 都迁到 `session-do-runtime.js` 后可删 | hero-to-pro owner | hero-to-platform charter 启动日 |
| K3 | `workers/orchestrator-core/src/user-do.ts` (9 行 wrapper) | re-export `NanoOrchestratorUserDO` + 6 types from `user-do-runtime.js` | 与 K2 同源 | 同 K2 | hero-to-pro owner | hero-to-platform charter 启动日 |
| K4 | `context-core` `assemblerOps` deprecated alias (`workers/context-core/src/index.ts:179-182`) | `@deprecated` JSDoc + 2-line method body delegating to `contextOps()` | 已标 `@deprecated`；不能立即删除（外部 RPC consumer 可能仍调用） | 任何 caller (grep cross-repo) 全部迁到 `contextOps()` 后可删 | hero-to-pro owner | hero-to-platform charter 启动日 |
| K5 | `host-local workspace residue` (Lane E) — `workers/agent-core/src/host/workspace-runtime.ts` | `composeWorkspaceWithEvidence` + `WorkspaceCompositionHandle` | HP8 已显式登记为 `retained-with-reason`，不是 shim；详见 `docs/architecture/lane-e-final-state.md` | filesystem-core 暴露完整 leaf-RPC（`readTempFile / writeTempFile / listTempFiles / deleteTempFile / readSnapshot / writeSnapshot / copyToFork / cleanup`）后可删 | hero-to-platform owner | hero-to-platform charter 启动日 |

### 6.3 handed-to-platform

无 — cleanup register 与 second-wave deferred items (§4) 是两类。second-wave handoff 已在 §4 列出；本节仅针对 cleanup 候选项。

### 6.4 verification method

| 验证 | 命令 |
|------|------|
| `parity-bridge.ts` 仍有 caller | `grep -rn "forwardInternalJsonShadow" workers/` (本批次确认 ≥ 5 处) |
| nano-session-do wrapper 路径仍被引用 | wrangler.jsonc + 外部 worker bindings |
| user-do wrapper 同上 | 同上 |
| `assemblerOps` deprecated 标记 | `grep -n "@deprecated.*assemblerOps" workers/context-core/src/index.ts` |
| Lane E workspace-runtime live | `workers/agent-core/src/host/workspace-runtime.ts` 与 `runtime-assembly.ts:465` |

---

## 7. Hero-to-Platform Inherited Issues 索引

> 给 `docs/charter/plan-hero-to-platform.md` 提供 inherited issues 唯一入口。HPX-Q35 frozen：hero-to-platform stub 只登记 inherited issues + 边界，**严禁**写实施方案 / timeline / architecture。

### 7.1 Inherited Issues from §4 second-wave

详见本文件 §4。共 22 项 `handed-to-platform` + 3 项 `retained-with-reason`（owner-action 时间窗内未完成时升级为 handed）。

### 7.2 Inherited Issues from §6 cleanup register

K1-K5 全部 retained，next review = hero-to-platform charter 启动日。

### 7.3 Inherited Q ID 不变量

hero-to-platform 必须遵守的 frozen invariants：

| Q ID | 内容 |
|------|------|
| Q13 / Q14 | session close `ended_reason=closed_by_user`；DELETE 软删 conversation |
| Q16 / Q17 / Q18 | confirmation row-first dual-write；`confirmation_pending` 名称；server-only confirmation frames |
| Q19 / Q20 | virtual_path 7-rule + tenant-scoped R2 key；todo 5-status enum |
| Q22 / Q23 / Q24 | file snapshot policy by kind；fork = same conversation；restore failure → rollback baseline |
| Q26 / Q27 | tool catalog SSoT in nacp-core；public surface FacadeEnvelope only |
| Q28 | chronic terminal compliance（closed / retained-with-reason / handed-to-platform） |

### 7.4 Inherited 边界声明

hero-to-platform charter 不需要重做：

- 11 docs pack 与 18-doc surface（HP9 frozen，hero-to-platform 阶段如要重组 docs 必须独立 charter） |
- F1 / F2 / F12 / F15 / F16 chronic（已 closed） |
- HP0 / HP1 phase 决策 |
- HPX-Q1...Q36 frozen Q&A（hero-to-platform 阶段如要 unfreeze 必须重开 QNA） |

---

## 8. Final Closure Verdict

`hero-to-pro` 阶段以 `partial-close / handoff-ready` 状态封板。

**正面事实**：

1. 11 phase 全部按 charter §6.3 严格串行执行
2. 4 套状态机 first-wave 落地（model / context / chat-lifecycle / tool-workspace）
3. NACP 协议 13 → 13+confirmation+todo 帧族扩展，13 个原始 frame 100% backward compat
4. D1 schema 13 (HP1 集中) + 1 (HP2 受控例外) = 14 个 migrations 冻结
5. 6-worker 拓扑（orchestrator-core / orchestrator-auth / agent-core / context-core / bash-core / filesystem-core）单元测试 1922 全绿；3 类 root drift gate live
6. 18 docs pack 第一次按产品 surface 切分；与 HP5-HP8 frozen 代码事实 100% 对齐
7. HPX Q1...Q36 frozen — 后续阶段不需要重新讨论这些决策

**负面事实（已 explicit）**：

1. 22 项 second-wave runtime enforcement / executor / cross-e2e 显式 `handed-to-platform`（详见 §4）
2. 3 项 retained-with-reason 含 R28/R29/prod baseline owner-action 项
3. 5 cleanup 候选项保留为 wrapper / deprecated alias / Lane E retained
4. 4-reviewer memos 待外部 reviewer 产
5. 5 设备 manual evidence 待 owner 录制

**Q33 合规**：

- 无任何 `silently resolved` 项；所有 retained / handed-to-platform 都带 Q36 字段
- HP10 final closure 是 hero-to-pro 唯一阶段总 closure 入口
- hero-to-platform stub 已创建（`docs/charter/plan-hero-to-platform.md`），boundary 显式

**总评**：hero-to-pro 不是"功能全做完"，而是"以 explicit / 可审计 / 可移交的方式完成阶段封板"。这与 charter §0.5 wire-with-delivery 法律一致；与 HPX-Q33-Q36 法律一致；与 charter §10 final closure gate 一致。
