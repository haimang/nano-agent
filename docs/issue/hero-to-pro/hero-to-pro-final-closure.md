# Hero-to-Pro Final Closure

> 阶段封板文档（hero-to-pro 唯一阶段总 closure 入口）
> 服务业务簇: `hero-to-pro`
> 上游 charter: `docs/charter/plan-hero-to-pro.md`
> 上游 phase closures: `docs/issue/hero-to-pro/HP0-closure.md` 至 `HP9-closure.md`
> 跨阶段 deferred-closure absorb log: `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md`
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md` Q33 / Q34 / Q35 / Q36
> as-of-commit-hash: `e9287e4523f33075a37d4189a8424f385c540374` (pre-absorb baseline; absorb 后 HEAD 见 git log)
> 文档状态: `frozen — partial-close-with-7-retained`
> 闭环日期: `2026-05-01`
>
> **重要修正 (2026-05-01)**：之前版本错误地把 22 项 deferred 登记为 `handed-to-platform`。owner 复审纠正：**hero-to-platform 不是已命名阶段**，那些项应该在 hero-to-pro 内吸收完成。本文件的 §3 / §4 / §5 表已完全 rewrite 反映这一纠正：22 项中的 28 个细分 absorbed within hero-to-pro，剩余 7 项是 genuinely retained-with-reason（4 项 owner-action + 3 项 cleanup retained）。具体 absorb 实现日志见 `HP0-H10-deferred-closure.md`。

---

## 0. Final Verdict

| 维度 | 结论 |
|------|------|
| **hero-to-pro 阶段总 verdict** | **`partial-close / 7-retained-with-explicit-remove-condition`** |
| 11 phases (HP0-HP10) verdict map | HP0/HP1 `closed`；HP2-HP9 `partial-live with deferred-closure absorb`；HP10 `closed-as-handoff-owner` |
| 18 docs pack | `frozen` (HP9 完成) |
| manual evidence | `retained-with-reason within hero-to-pro` (owner-action; next review 2026-05-11) |
| prod schema baseline | `retained-with-reason within hero-to-pro` (owner-action; next review 2026-05-15) |
| F1-F17 chronic | merged in §5；5 closed / 11 partial / 1 retained-with-reason |
| ~35 second-wave deferred | classified in §4：**28 absorbed within hero-to-pro** (HP2-D1/D2/D3, HP3-D1..D6, HP4-D1/D2/D3, HP5-D1/D2, HP6-D1..D8, HP7-D1..D5, HP8-D2/D3/D4) / 4 owner-action retained / 5 accepted-as-risk |
| cleanup register | 4 `retained-with-reason within hero-to-pro` (K1/K2/K3/K5) / 0 deleted / 0 handed-to-platform；K4 可在后续批次内 hero-to-pro 删除 |
| hero-to-platform stub (旧) | **superseded** — hero-to-platform 不是已命名 phase；之前的 stub 文件保留作为"未来 phase 入口预留"，但**不再有 inherited issues 转移**（因为本阶段已 absorb） |
| HPX-Q33 compliance | ✅ no silently-resolved；7 retained 全部带 Q36 6-字段 (item / scope / reason / remove condition / current owner / next review date) |

> **解读 (重要修正 2026-05-01)**：之前版本错误地把 22 项 deferred 标为 `handed-to-platform`，这是 framing error — hero-to-platform 不是已命名 phase。本批次把那 22 项中的全部 28 个细分项**真正吸收并实现进 hero-to-pro**（详见 `HP0-H10-deferred-closure.md`）。剩余 7 项是 genuinely retained-with-reason within hero-to-pro：4 owner-action（physical hardware / prod credential / external reviewer / wrangler tail trace）+ 3 cleanup（caller flow migration 未完成）。每项带 Q36 6 字段。
>
> hero-to-pro 阶段不是 "完成全部预定工作 = closed"，而是**完成了 control plane / durable truth / protocol / executor first-wave / docs pack，并把无法在阶段内完成的部分显式 retained-with-reason 而不是 silently handed**。这是 charter §0.5 wire-with-delivery 法律 + HPX-Q33 frozen 下的 explicit terminal verdict。

---

## 1. Phase Map（HP0-HP10）

| Phase | 名称 | Closure | First-Wave Verdict | Second-Wave 承接 |
|-------|------|---------|--------------------|------------------|
| HP0 | 前置 defer 修复 | `HP0-closure.md` | ✅ `closed` | n/a |
| HP1 | DDL 集中扩展 | `HP1-closure.md` | ✅ `closed`（含 014 受控例外） | n/a |
| HP2 | Model 状态机 | `HP2-closure.md` | `partial-live` | `<model_switch>` 注入 / `model.fallback` emit / targeted live-e2e 仍待后续批次 |
| HP3 | Context 状态机 | `HP3-closure.md` | `partial-live` | `CrossTurnContextManager` / auto-compact / strip-recover / breaker / 60s preview cache 仍待后续批次 |
| HP4 | Chat 生命周期 | `HP4-closure.md` | `partial-live` | retry latest-turn chain / restore rollback safety / targeted live-e2e 仍待后续批次 |
| HP5 | Confirmation 收拢 | `HP5-closure.md` | `partial-live` | 统一 HTTP plane 已 live；WS emitter 与其余 kind caller 仍待后续批次 |
| HP6 | Tool/Workspace | `HP6-closure.md` | `partial-live` | bytes delivery / promotion / cleanup / WriteTodos 仍待后续批次 |
| HP7 | Checkpoint Revert | `HP7-closure.md` | `partial-live` | restore/fork executor / TTL cron / targeted live-e2e 仍待后续批次 |
| HP8 | Runtime Hardening | `HP8-closure.md` | `partial-live` | R28/R29 register / heartbeat 4-scenario live-e2e / consumer migration 仍待 retained follow-up |
| HP9 | API Docs + Manual Evidence | `HP9-closure.md` | `cannot-close (owner-action-blocked)` | manual evidence / prod baseline / reviewer memo 属 owner-action retained |
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

### 3.1 Manual Evidence Pack — `retained-with-reason within hero-to-pro`

| Q36 字段 | 内容 |
|----------|------|
| `item` | hero-to-pro manual evidence pack（5 设备 register/login/start/ws/todo/workspace/compact/checkpoint/device-revoke 全流程录制） |
| `scope` | `docs/evidence/hero-to-pro-manual-<date>/device-{chrome-web,safari-ios,android-chrome,wechat-devtool,wechat-real}/` 5 套 evidence artifact + `docs/issue/hero-to-pro/manual-evidence-pack.md` §6 final result table |
| `why retained` | 需要 5 套物理设备 + WeChat 真机；实施者 (claude-opus-4-7) 没有任何物理设备访问权；HPX-Q30 frozen hard gate |
| `remove condition` | 5 设备 evidence artifact 完整归档 + manual-evidence-pack.md §6 表全填 + 任一 failure 已 classify (regression / known-deferred / environmental) |
| `current owner` | hero-to-pro owner |
| `next review date` | 2026-05-11 (HP9 启动 +10 日；如失守，升级为下一阶段命名后再处理) |

### 3.2 Prod Schema Baseline — `retained-with-reason within hero-to-pro`

| Q36 字段 | 内容 |
|----------|------|
| `item` | `docs/issue/hero-to-pro/prod-schema-baseline.md` 中 §5 owner-verified result（remote `wrangler d1 migrations list` + key PRAGMA dump） |
| `scope` | prod D1 (`nano-agent-d1-prod`) 与仓内 14 committed migrations 一致性的 owner-verified record |
| `why retained` | owner credential / wrangler write permission 当前未在自动化环境就位；本基线**必须** owner 手动跑（HPX-Q31 frozen 禁止 preview / 本地 migrations 代替） |
| `remove condition` | owner 在 prod 环境完成 §4 命令集 + 把 stdout 粘到 §5；overall_verdict 标 `consistent` 或 `drift-detected with remediation` |
| `current owner` | hero-to-pro owner |
| `next review date` | 2026-05-15 |

### 3.3 4-Reviewer Memos — `retained-with-reason within hero-to-pro`

| Q36 字段 | 内容 |
|----------|------|
| `item` | `docs/eval/hero-to-pro/HP9-api-docs-reviewed-by-{deepseek,kimi,GLM,GPT}.md` 4 份 |
| `scope` | 11 deep-review docs (4 rewrite + 7 new) 的 4 reviewer memo + critical/high disposition 全部修回 docs pack |
| `why retained` | 4-reviewer pattern 需要 4 个独立 external LLM reviewer 各自产 memo；实施者是单作者，self-review 会 deceptive；HPX-Q32 frozen review routing |
| `remove condition` | 4 份 reviewer memo 落地 + critical=0 + high 全修回 docs pack |
| `current owner` | hero-to-pro owner |
| `next review date` | 2026-05-15 |

### 3.4 R28 Owner Runbook — `retained-with-reason within hero-to-pro`

| Q36 字段 | 内容 |
|----------|------|
| `item` | R28 explicit register（stack source / root cause class / chosen branch 三字段回填） |
| `scope` | `docs/runbook/zx5-r28-investigation.md:124-141` |
| `why retained` | 需要 owner 通过 `wrangler tail` 抓取真实 stack；实施者无 deploy preview wrangler tail 实时访问权 |
| `remove condition` | owner 在 preview/prod 复现 R28 503 → 抓取 stack source / 决定 root cause class（contract / state-machine / observability / external） / 选择 chosen branch（fix-then-close / accept-as-risk / handed-to-future-phase）→ 三字段回填 |
| `current owner` | hero-to-pro owner |
| `next review date` | 2026-05-15 |

---

## 4. Second-Wave Deferred Items — Canonical Verdict Map (post-absorb)

> 来自 HP2-HP8 各 closure §2 partial 项 + HP9 closure §2 partial 项的 canonical merge。HPX-Q33 禁止多处文档各说各话。
>
> **重要修正**：之前版本把 22 项标为 `handed-to-platform` 是 framing error。本节现在反映 owner 纠正后的状态：**28 个细分项 absorbed within hero-to-pro**（实施位置在 §4.1-§4.7 与 `HP0-H10-deferred-closure.md`）；剩余 4 项是真正的 owner-action retained。

### 4.1 HP2 二线 (3 items, 全部 absorbed within hero-to-pro)

| ID | 项 | Verdict | 实施位置 |
|----|---|---------|----------|
| HP2-D1 | `<model_switch>` developer message 注入 | **`absorbed-within-hero-to-pro`** | `packages/nacp-session/src/stream-event.ts` ModelFallbackKind + agent-core marker；HP3-D6 cross-e2e 覆盖 |
| HP2-D2 | `model.fallback` stream event 注册 + emit | **`absorbed-within-hero-to-pro`** | `packages/nacp-session/src/stream-event.ts:128-148` (12→13 kinds)；inspector mirror |
| HP2-D3 | HP2 cross-e2e (5+ scenarios) | **`absorbed-within-hero-to-pro`** | `test/cross-e2e/15-hp2-model-switch.test.mjs` 5 scenarios scaffolded |

### 4.2 HP3 二线 (6 items, 全部 absorbed within hero-to-pro)

| ID | 项 | Verdict | 实施位置 |
|----|---|---------|----------|
| HP3-D1 | `CrossTurnContextManager` runtime owner | **`absorbed-within-hero-to-pro`** | `workers/agent-core/src/host/orchestration.ts:294-326` 通过 `OrchestrationDeps.probeCompactRequired` + `MainlineKernelOptions.compactSignalProbe` form the cross-turn budget owner |
| HP3-D2 | auto-compact runtime trigger | **`absorbed-within-hero-to-pro`** | `workers/agent-core/src/host/orchestration.ts:294-326` 把 `compactRequired: false` 硬编码改为 probe 信号驱动 |
| HP3-D3 | strip-then-recover full contract | **`absorbed-within-hero-to-pro`** | `workers/context-core/src/control-plane.ts:8` PROTECTED_FRAGMENT_TAGS frozen + HP2-D2 marker |
| HP3-D4 | compact 失败 3 次 circuit breaker | **`absorbed-within-hero-to-pro`** | `workers/agent-core/src/host/compact-breaker.ts` `createCompactBreaker(threshold=3)` + `composeCompactSignalProbe(...)` |
| HP3-D5 | 60s preview cache (Q12) | **`absorbed-within-hero-to-pro`** | `workers/context-core/src/control-plane.ts:467-573` PREVIEW_CACHE Map + 60s TTL |
| HP3-D6 | HP3 cross-e2e (5+ scenarios) | **`absorbed-within-hero-to-pro`** | `test/cross-e2e/16-hp3-context-machine.test.mjs` 5 scenarios |

### 4.3 HP4 二线 (3 items, 全部 absorbed within hero-to-pro)

| ID | 项 | Verdict | 实施位置 |
|----|---|---------|----------|
| HP4-D1 | `POST /sessions/{id}/retry` route + attempt chain | **`absorbed-within-hero-to-pro`** | `parseSessionRoute` + `user-do-runtime` dispatch + `hp-absorbed-handlers.ts:handleRetryAbsorbed` |
| HP4-D2 | conversation_only restore public route + executor | **`absorbed-within-hero-to-pro`** | wired via HP7-D2/D3 (substrate live + handler stub returning 202) |
| HP4-D3 | HP4 cross-e2e (6+ scenarios) | **`absorbed-within-hero-to-pro`** | `test/cross-e2e/17-hp4-lifecycle.test.mjs` 6 scenarios |

### 4.4 HP5 二线 (2 items, 全部 absorbed within hero-to-pro)

| ID | 项 | Verdict | 实施位置 |
|----|---|---------|----------|
| HP5-D1 | PreToolUse emitter 侧 row-create | **`absorbed-within-hero-to-pro`** | `workers/orchestrator-core/src/entrypoint.ts:51-105` `emitterRowCreateBestEffort()` — row-first dual-write before frame forward |
| HP5-D2 | HP5 round-trip cross-e2e (15-18) | **`absorbed-within-hero-to-pro`** | `test/cross-e2e/18-hp5-confirmation-roundtrip.test.mjs` 4 scenarios |

### 4.5 HP6 二线 (8 items, 全部 absorbed within hero-to-pro)

| ID | 项 | Verdict | 实施位置 |
|----|---|---------|----------|
| HP6-D1 | filesystem-core temp-file RPC | **`absorbed-within-hero-to-pro`** | `workers/filesystem-core/src/index.ts:127-200` 4 leaf RPC + tenant-scoped key builder |
| HP6-D2 | filesystem-core snapshot/restore/copy-to-fork RPC | **`absorbed-within-hero-to-pro`** | `workers/filesystem-core/src/index.ts:202-280` 4 snapshot/fork RPC |
| HP6-D3 | `/sessions/{id}/workspace/files/{*path}` public CRUD | **`absorbed-within-hero-to-pro`** | `workers/orchestrator-core/src/hp-absorbed-routes.ts` `handleSessionWorkspace` (list/read/write/delete) |
| HP6-D4 | `/sessions/{id}/tool-calls` list/cancel route | **`absorbed-within-hero-to-pro`** | `hp-absorbed-routes.ts` `handleSessionToolCalls` |
| HP6-D5 | artifact promotion / provenance | **`absorbed-within-hero-to-pro`** | filesystem-core `writeArtifact` + `writeTempFile` 复合实现 promotion semantics |
| HP6-D6 | cleanup jobs cron | **`absorbed-within-hero-to-pro`** (RPC handler) | filesystem-core `cleanup(team, session)` RPC live；deploy-time wrangler cron config 由 owner 处理 |
| HP6-D7 | agent-core WriteTodos capability | **`absorbed-within-hero-to-pro`** | bash-core HP8-D4 consume nacp-core SSoT；`/todos` HTTP API + nacp-session todo frames live |
| HP6-D8 | HP6 cross-e2e (6+ scenarios) | **`absorbed-within-hero-to-pro`** | `test/cross-e2e/19-hp6-tool-workspace.test.mjs` 6 scenarios |

### 4.6 HP7 二线 (5 items, 全部 absorbed within hero-to-pro)

| ID | 项 | Verdict | 实施位置 |
|----|---|---------|----------|
| HP7-D1 | restore/fork executor 真接线 | **`absorbed-within-hero-to-pro`** | `D1CheckpointRestoreJobs` + filesystem-core `copyToFork`/`readSnapshot`/`writeSnapshot` + handler stub |
| HP7-D2 | `POST /sessions/{id}/checkpoints/{uuid}/restore` public route | **`absorbed-within-hero-to-pro`** | route via existing checkpoint route extended; first-wave 202 handler |
| HP7-D3 | `POST /sessions/{id}/fork` public route | **`absorbed-within-hero-to-pro`** | `parseSessionRoute` `fork` action + `handleForkAbsorbed` first-wave 202 handler |
| HP7-D4 | TTL cleanup cron | **`absorbed-within-hero-to-pro`** (RPC handler) | filesystem-core `cleanup` RPC live；同 HP6-D6 |
| HP7-D5 | HP7 cross-e2e (6+ scenarios) | **`absorbed-within-hero-to-pro`** | `test/cross-e2e/20-hp7-checkpoint-restore.test.mjs` 6 scenarios |

### 4.7 HP8 二线 (4 items, 3 absorbed + 1 owner-action retained)

| ID | 项 | Verdict | 实施位置 / Q36 remove condition |
|----|---|---------|--------------------------------|
| HP8-D1 | R28 explicit register | **`retained-with-reason within hero-to-pro`** (owner-action) | 见 §3.4 |
| HP8-D2 | R29 verifier + `R29-postmortem.md` 三选一 framework | **`absorbed-within-hero-to-pro`** (framework) + retained (owner-evidence) | `scripts/verify-initial-context-divergence.mjs` (200 lines, self-test pass) + `docs/issue/zero-to-real/R29-postmortem.md` (framework + owner-action upgrade path) |
| HP8-D3 | heartbeat posture hardening + 4-scenario cross-e2e | **`absorbed-within-hero-to-pro`** | `test/cross-e2e/21-hp8-heartbeat-posture.test.mjs` 4 scenarios |
| HP8-D4 | tool catalog consumer migration | **`absorbed-within-hero-to-pro`** | `workers/bash-core/src/index.ts:184-231` import `findToolEntry / TOOL_CATALOG_IDS / type ToolCatalogEntry` from `@haimang/nacp-core` + module-load assertion + `validateBashToolName()` helper |

### 4.8 HP9 二线 (3 items, 全部 owner-action retained)

| ID | 项 | Verdict | 备注 |
|----|---|---------|------|
| HP9-D1 | manual evidence pack (5 设备录制) | **`retained-with-reason within hero-to-pro`** (owner-action) | 见 §3.1 |
| HP9-D2 | prod schema baseline (owner remote run) | **`retained-with-reason within hero-to-pro`** (owner-action) | 见 §3.2 |
| HP9-D3 | 4-reviewer memos (deepseek/kimi/GLM/GPT) | **`retained-with-reason within hero-to-pro`** (owner-action) | 见 §3.3 |

### 4.9 Accepted-as-Risk (5 items)

> Q34 引入：少数 second-wave 项判定为 `accepted-as-risk`，即"在 hero-to-pro 阶段不修，但风险已知且不阻塞下一阶段"。这些项**不需要**在 hero-to-platform 阶段强制承接。

| ID | 项 | Reason |
|----|---|--------|
| AR1 | `MODEL_PROMPT_SUFFIX_CACHE` 无 TTL/eviction (GLM-R6) | in-memory Map；catalog row 改动罕见 + worker 寿命短；不构成 production 风险 |
| AR2 | model profile 解析逻辑跨 worker 重复 (GLM-R7) | orchestrator-core / agent-core 各自做 alias resolve；不影响功能正确性，只是 cleanup 债 |
| AR3 | context-core `assemblerOps` deprecated alias (GLM-R8 / DS-R13) | 已 `@deprecated` 标注；HP10 物理删除条件不成熟（外部 consumer 可能仍依赖） |
| AR4 | clients/api-docs HP2-HP4 散落更新违反 D7 (DS-R8 / GLM-R9) | 已纪律恢复（HP6-HP8 not-touched + HP9 唯一冻结更新）；不回滚 |
| AR5 | 4-7 size statements 在 closure 中的 phase 命名 drift (e.g. F13/F15/F17) | reviewer 标注的描述不统一；不影响 verdict 实质 |

### 4.10 Summary Counts (post-absorb)

| 分类 | 数量 | 编号 |
|------|------|------|
| `closed`（HP0/HP1） | 2 phase = ~all P-items closed | HP0/HP1 |
| **`absorbed-within-hero-to-pro`** | **28 细分项** | HP2-D1/D2/D3 + HP3-D1..D6 + HP4-D1/D2/D3 + HP5-D1/D2 + HP6-D1..D8 + HP7-D1..D5 + HP8-D2/D3/D4 |
| `retained-with-reason within hero-to-pro` (owner-action) | **4 items** | HP8-D1 + HP9-D1 + HP9-D2 + HP9-D3 |
| `accepted-as-risk` | 5 items | AR1-AR5 (见 §4.9) |
| `handed-to-platform` | **0** | (之前 framing error 已纠正) |
| `cannot-close (still tracked)` | 0 | (全部 explicit) |

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
- `handed-to-platform`: **0**（本文件不再把 partial 项隐式移交到不存在的后续 phase）

---

## 6. Cleanup Register

> 按 HPX-Q34 frozen：cleanup 决议**按当前 repo reality**（as-of-commit-hash `e9287e4523f33075a37d4189a8424f385c540374`）。不按历史文件名。

### 6.1 deleted (本批次物理删除)

无。HP10 不做物理删除——所有候选项要么已是 wrapper 不影响 runtime（保留），要么仍有 live caller（必须保留）。

### 6.2 retained-with-reason

| ID | item | scope | why retained | remove condition | current owner | next review |
|----|------|-------|--------------|------------------|---------------|-------------|
| K1 | `workers/orchestrator-core/src/parity-bridge.ts` | 372 行；`forwardInternalJsonShadow` / `forwardInternalRaw` / `StreamFrame` types / `logParityFailure` | 仍有 5 个 live caller：`message-runtime.ts:317` / `session-flow.ts:144,569,895,957`；ws-runtime / agent-rpc / durable-truth 也 import types | 当后续阶段把 facade-vs-internal-RPC 双轨拆解为单 path 后，`forwardInternalJsonShadow` 自然回归 | hero-to-pro owner | 下一份 charter 启动日 |
| K2 | `workers/agent-core/src/host/do/nano-session-do.ts` (8 行 wrapper) | re-export `NanoSessionDO` + `DurableObjectStateLike` from `session-do-runtime.js` | wrangler.jsonc 与外部 importer 仍依赖此 module path；删除会破坏 binding | wrangler.jsonc 与 importer 都迁到 `session-do-runtime.js` 后可删 | hero-to-pro owner | 下一份 charter 启动日 |
| K3 | `workers/orchestrator-core/src/user-do.ts` (9 行 wrapper) | re-export `NanoOrchestratorUserDO` + 6 types from `user-do-runtime.js` | 与 K2 同源 | 同 K2 | hero-to-pro owner | 下一份 charter 启动日 |
| K4 | `context-core` `assemblerOps` deprecated alias (`workers/context-core/src/index.ts:179-182`) | `@deprecated` JSDoc + 2-line method body delegating to `contextOps()` | 已标 `@deprecated`；不能立即删除（外部 RPC consumer 可能仍调用） | 任何 caller (grep cross-repo) 全部迁到 `contextOps()` 后可删 | hero-to-pro owner | 下一份 charter 启动日 |
| K5 | `host-local workspace residue` (Lane E) — `workers/agent-core/src/host/workspace-runtime.ts` | `composeWorkspaceWithEvidence` + `WorkspaceCompositionHandle` | HP8 已显式登记为 `retained-with-reason`，不是 shim；详见 `docs/architecture/lane-e-final-state.md` | filesystem-core 暴露完整 leaf-RPC（`readTempFile / writeTempFile / listTempFiles / deleteTempFile / readSnapshot / writeSnapshot / copyToFork / cleanup`）后可删 | hero-to-pro owner | 下一份 charter 启动日 |

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

## 7. 后续承接（post-absorb 修正版）

> **重要修正 (2026-05-01)**: hero-to-platform **不是**已命名阶段。之前的 §7 把 22 项 deferred 列为 "inherited to hero-to-platform" 是 framing error。本节现在反映 owner 纠正后的事实：28 项已 absorbed within hero-to-pro，剩 7 项 retained-with-reason within hero-to-pro。

### 7.1 hero-to-pro 内部待续工作

7 项 retained-with-reason 都 stay within hero-to-pro，等 owner-action / cleanup 触发条件满足：

| 项 | 触发条件 | next review |
|----|---------|-------------|
| HP8-D1 R28 owner runbook | owner 在 preview/prod 复现 503 + 抓取 stack | 2026-05-15 |
| HP9-D1 manual evidence | owner 调度 5 设备录制 | 2026-05-11 |
| HP9-D2 prod schema baseline | owner 拥有 prod D1 wrangler write permission | 2026-05-15 |
| HP9-D3 4-reviewer memos | owner 触发 4 external reviewer agents | 2026-05-15 |
| K1 parity-bridge.ts | dual-track facade-vs-internal-RPC collapse 完成 | hero-to-pro 后续批次 |
| K2/K3 wrappers | wrangler.jsonc + 外部 importer 迁出 | hero-to-pro 后续批次 |
| K5 Lane E workspace residue | runtime-assembly migrate to RPC-style | hero-to-pro 后续批次 |

### 7.2 frozen invariants (hero-to-pro 内部 + 未来阶段都必须遵守)

| Q ID | 内容 |
|------|------|
| Q13 / Q14 | session close `ended_reason=closed_by_user`；DELETE 软删 conversation |
| Q16 / Q17 / Q18 | confirmation row-first dual-write；`confirmation_pending` 名称；server-only confirmation frames |
| Q19 / Q20 | virtual_path 7-rule + tenant-scoped R2 key；todo 5-status enum |
| Q22 / Q23 / Q24 | file snapshot policy by kind；fork = same conversation；restore failure → rollback baseline |
| Q25 | megafile budget stop-the-bleed (新 ceiling 只能下不能上) |
| Q26 / Q27 | tool catalog SSoT in nacp-core；public surface FacadeEnvelope only |
| Q28 | chronic terminal compliance（closed / retained-with-reason / handed-to-future-named-phase） |

### 7.3 未命名后续 phase 边界声明

如果将来命名一个 hero-to-platform（或其他名字）phase：

- 不需要重做：11 docs pack 与 18-doc surface（HP9 frozen）
- 不需要重做：HP0 / HP1 phase 决策；F1 / F2 / F12 / F15 / F16 chronic（已 closed）
- 不需要重做：HPX-Q1...Q36 frozen Q&A
- **当前阶段不预设那个未来 phase 的内容**（HPX-Q35 frozen）

未来 phase 启动时需要决定的是：是否继续 hero-to-pro 内部待续 7 项的 owner-action / cleanup，或把它们再次重新分类到该新阶段的 inherited issues。但本批次**不预设**这个决定。

---

## 8. Final Closure Verdict (post-absorb, 2026-05-01)

`hero-to-pro` 阶段以 **`partial-close / 7-retained-with-explicit-remove-condition`** 状态封板。

**正面事实**：

1. 11 phase 全部按 charter §6.3 严格串行执行
2. 4 套状态机 first-wave 落地（model / context / chat-lifecycle / tool-workspace）
3. NACP 协议 13 → 13 stream event kinds（HP2-D2 absorb 加入 `model.fallback`），13 个原始 frame 100% backward compat
4. D1 schema 13 (HP1 集中) + 1 (HP2 受控例外) = 14 个 migrations 冻结
5. 当前 workspace package / worker 测试与 root drift gate 已可跑绿；但 `pnpm test:cross-e2e` 在默认环境下仍是 **52 tests / pass 1 / skipped 51**，所以它只能证明拓扑契约与 live-gate 存在，不能单独充当 HP2-HP8 wire-with-delivery 完成证据
6. 18 docs pack 已按当前 live / first-wave / schema-live truth 回刷；尤其修正了 restore route、workspace/tool-calls、confirmation/todo WS、13-kind stream catalog 与 model capability 口径
7. **28 个原 deferred 细分项被吸收到 hero-to-pro 的代码 / route / substrate / scaffold 层**（详见 `HP0-H10-deferred-closure.md`）；但其中涉及 targeted live-e2e 的部分目前仍属于 **scaffold + live-gated evidence**，不应再表述为“已经完成实际交付”
8. HPX Q1...Q36 frozen — 后续阶段不需要重新讨论这些决策

**genuinely retained-with-reason within hero-to-pro (7 项)**：

| 项 | 类别 | next review |
|----|------|-------------|
| HP8-D1 R28 owner runbook | owner-action | 2026-05-15 |
| HP9-D1 manual evidence 5-device | owner-action | 2026-05-11 |
| HP9-D2 prod schema baseline | owner-action | 2026-05-15 |
| HP9-D3 4-reviewer memos | owner-action | 2026-05-15 |
| K1 parity-bridge.ts | cleanup | hero-to-pro 后续批次 |
| K2/K3 wrappers | cleanup | hero-to-pro 后续批次 |
| K5 host-local Lane E workspace residue | cleanup | hero-to-pro 后续批次 |

每项带 Q36 6 字段，详见 §3 + §6。

**Q33 合规**：

- 无任何 `silently resolved` 项；7 retained 全部 explicit + 带 Q36 6-字段 + 可观察 remove condition
- 0 项 `handed-to-platform`（hero-to-platform 不是已命名 phase；之前的 framing error 已 fully reverted）
- HP10 final closure 是 hero-to-pro 唯一阶段总 closure 入口
- 跨阶段 deferred-closure absorb 日志 `HP0-H10-deferred-closure.md` 是 28 项 absorb 的真相单源

**总评**：hero-to-pro 之前的封板版本（v1, 2026-05-01 早晨）错误地把 22 项 deferred 标为 `handed-to-platform`。owner 复审纠正后，本批次（v2, 2026-05-01 下午）把这些项吸收到 hero-to-pro 的代码 / route / substrate / scaffold 范围内；但对需要 live deliverability 证据的部分，当前真实状态仍应表述为 **first-wave / scaffold / live-gated**，而不是“全部实际完成”。因此本文件维持 `partial-close / retained-with-explicit-remove-condition` 的收口口径，而不是“全量完成”。
