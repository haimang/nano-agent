# Nano-Agent After-Foundations P4 — Hooks Catalog Expansion (event classes 先冻结，exact count 待 Phase 3 producer reality)

> 功能簇：`packages/hooks/src/catalog.ts` extension
> 讨论日期：`2026-04-19`
> 讨论者：`Opus 4.7 (1M context)`
>
> 关联调查报告（B1 finding traceability — backward）：
> - `docs/spikes/spike-binding-pair/03-hooks-callback-latency-and-error-shape-confirmed.md` (**binding-F03 — cross-worker hook dispatch viable; catalog can extend safely**)
> - `docs/spikes/spike-binding-pair/02-anchor-headers-survive-but-lowercased.md` (binding-F02 — naming convention reference; hook event names are NOT headers but consistency matters)
> - `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md` (**binding-F04 — `EvalSinkOverflow` candidate event for class-D**)
> - `docs/spikes/spike-do-storage/08-do-storage-value-cap-between-1mib-and-10mib.md` (F08 — context for ContextPressure event semantics)
> - `docs/spikes/binding-findings.md` + `docs/spikes/storage-findings.md` (rollups)
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` §B5 (this design's input contract)
>
> 上游 charter / spec / 模板：
> - `docs/plan-after-foundations.md` §4.1 E (4 classes 先冻结; exact count TBD by B4 reality) + §7.5 (Phase 4 details)
> - **`docs/design/after-foundations/PX-async-compact-lifecycle-spec.md` §7** (canonical 5 new lifecycle events for class D)
> - `docs/design/after-foundations/P3-context-management-async-compact.md` (events emitter; producer reality source)
> - `docs/design/after-foundations/P3-context-management-inspector.md` (consumer reality — WS stream subscribes to all)
> - `docs/eval/after-foundations/context-management-eval-by-Opus.md` v2 §5.2 (catalog 8→18 originally proposed; v2 §6.3 修正 4 classes)
> - `docs/templates/design.md`
>
> 关键 reference (existing code, baseline):
> - `packages/hooks/src/catalog.ts:43-98` (current 8-event catalog — class A 保留)
> - `context/claude-code/entrypoints/sdk/coreTypes.ts:25-53` (claude-code 27 events — borrow subset for class B)
>
> 文档状态：`draft`

---

## 0. 背景与前置约束

charter §4.1 E (r2 修订 by GPT review §2.5) 强制本设计**先冻结 4 个 event classes，不预冻结具体数量**。GPT review 修正了 v1 "8→18 events 含算术错误" 的问题，并明确 exact catalog count 由 Phase 3 (B4) producer reality + Phase 0/6 spike findings 决定。本 design 落实 4-class 冻结 + 每个 class 内的 candidate evaluation 框架 + 与 PX spec §7 的 5 个 async-compact 事件对齐。

- **项目定位回顾**：`packages/hooks/src/catalog.ts` 当前 8 events; 任何扩展是 `hooks` 包最 load-bearing 的契约 (catalog 影响 outcome reducer / session mapper / dispatcher / audit / nacp-core hook message family). Catalog expansion 必须基于 producer reality，不预先猜测.
- **本次讨论的前置共识**：
  - 4 event classes (A/B/C/D) frozen (per charter §4.1 E)
  - **PX spec §7** canonical define class D 的 5 events: ContextPressure / ContextCompactArmed / ContextCompactPrepareStarted / ContextCompactCommitted / ContextCompactFailed —— 这部分 frozen (来自 async-compact lifecycle hard requirement)
  - Class B (claude-code 借鉴) 与 Class C (env events) 的 candidate 必须**逐个评估**是否在 nano-agent worker runtime 下有真实 producer (避免 dead-code event)
  - **binding-F03 evidence** —— 跨 worker hook dispatch p50=4ms / blocking 1.5s viable / throwing returns structured 500 body —— 证明 catalog 扩张在 cross-worker dispatch 上**性能/可靠性都 ok**，可以放心扩
  - **binding-F04 evidence** —— `EvalSinkOverflow` 是 class D 候选 (sink overflow disclosure event)；详见 §4.4
  - 业主 charter §1.4: hook 协议升级与 nacp 协议升级**同期**，但本设计**只**改 hooks catalog；NACP message 在 P5
- **显式排除的讨论范围**：
  - 不讨论 NACP 1.2.0 message family 名字 (→ P5 + nacp-core 1.2.0 RFC)
  - 不讨论 outcome reducer 实现细节 (→ B5 implementation)
  - 不讨论 dispatcher 行为修改 (假设保持现有 dispatcher contract; 仅扩 catalog)
  - 不讨论新 producer / consumer 业务实现 (那是 B4 / B6 ship)
  - 不讨论 hooks v1.0.0 semver bump 时机决策 (charter §11.2: semver 是 secondary outcome)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`packages/hooks/src/catalog.ts` v2 expansion
- **一句话定义**：把 8-event catalog 按 4 frozen classes 扩展，每个 class 内的具体 events 按 producer reality 准入；**严格保留** class A 的 8 events，**显式登记** class D 的 5 PX-spec-driven events，**逐个评估** class B/C 的候选。
- **边界描述**：本设计**包含**4-class 冻结 + class D 5 events 登记 + class B 候选 6 评估 + class C 候选 2 评估 + dispatcher 兼容性约束；**不包含**outcome reducer / session mapper 的实现修改、catalog 在 nacp-core 协议层的 event-name allowed values 扩展 (虽然本质同步发生，但 schema 修订属 P5)。
- **关键术语对齐**：

| 术语 | 定义 |
|---|---|
| **Event Class** | 按事件来源/语义维度分组：A 保留 / B claude-code 借鉴 / C 环境 / D async-compact lifecycle |
| **Frozen** | event 已 commit 进入 catalog；metadata (allowedOutcomes / blocking / payloadSchema / redactionHints) 已定义 |
| **Candidate** | 评估中；只有当**真实 producer + 真实 consumer 同时存在**才能 promote 为 frozen |
| **Producer reality** | B4 (context-management) ship 时实际 emit 该 event 的代码位置 |
| **Consumer reality** | dispatcher 注册的 handler / inspector facade subscribe / outcome reducer 消费 |

### 1.2 参考调查报告

详见 frontmatter B1 findings + claude-code 27-event canonical reference.

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 本子模块在整体架构里的角色：**hooks 协议层 v2 — load-bearing contract for cross-worker / cross-package hook dispatch**
- 服务于：所有需要 hook lifecycle 干预的 packages (context-management, capability-runtime, session-do-runtime, eval-observability) + worker matrix 阶段跨 worker dispatch
- 依赖：existing dispatcher (`packages/hooks/src/dispatcher.ts`)、binding-F03 confirmed dispatch latency budget
- 被谁依赖：B4 (context-management 是 class D 5 events 的 producer)、B6 (考虑 EvalSinkOverflow event)、P5 NACP 1.2.0 (event_name allowed values 扩展)、worker matrix 阶段 cross-worker hook dispatch

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `packages/hooks/src/catalog.ts:43-98` (current) | extends | 强 | 添加 events 而非修改现有 8 |
| `packages/hooks/src/dispatcher.ts` (existing) | depends on | 强 | dispatcher contract 保持; catalog 扩张不引入 dispatcher 行为变化 |
| `packages/hooks/src/outcome.ts` + `core-mapping.ts` + `session-mapping.ts` | follows | 强 | 新 events 必须在三处同步登记 (outcome reducer / core mapping / session mapping) |
| `packages/hooks/src/audit.ts` | follows | 中 | 新 events 必须含 redactionHints |
| **PX-async-compact-lifecycle-spec.md §7** | conforms to | 强 | 5 class-D events (ContextPressure / 4 lifecycle) frozen as PX requires |
| `P3-context-management-async-compact.md` | producer | 强 | `events.ts` emit 5 class-D events; this design 注册 metadata |
| `P3-context-management-inspector.md` | consumer | 中 | WS stream subscribes to all event names; expects metadata for filter |
| `B6-writeback-eval-sink-dedup.md` | optional dependency | 中 | 如果 B6 决定加 `EvalSinkOverflow`，本 design 提供 candidate slot |
| `nacp-core/src/messages/hook.ts` | downstream | 中 | event_name allowed values 扩展 → P5 RFC 议题 (本 design 不直接修改) |
| `context/claude-code/entrypoints/sdk/coreTypes.ts:25-53` | reference | 弱 | 借鉴 platform-agnostic subset; nano-agent 不全套 port |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`hooks catalog v2` 是 **hook 协议层的 load-bearing 扩展**——按 4 frozen classes 准入新 events，每个 event 必须有真实 producer + consumer reality，对上游 conforming PX spec §7 5 lifecycle events，对下游为 P5 NACP 1.2.0 提供 event_name allowed values 扩展输入。

---

## 3. 4 Event Classes (frozen)

> **本节冻结 4 个 event classes 的边界。每个 class 内的具体 events 按 §4-§7 准入或拒绝。**

### Class A — 保留（8 events，不变）

来自 `packages/hooks/src/catalog.ts:43-98`：

| Event | blocking | allowedOutcomes |
|---|---|---|
| `SessionStart` | false | additionalContext / diagnostics |
| `SessionEnd` | false | diagnostics |
| `UserPromptSubmit` | true | block / additionalContext / diagnostics |
| `PreToolUse` | true | block / updatedInput / additionalContext / diagnostics |
| `PostToolUse` | false | additionalContext / diagnostics |
| `PostToolUseFailure` | false | additionalContext / stop / diagnostics |
| `PreCompact` | true | block / diagnostics |
| `PostCompact` | false | additionalContext / diagnostics |

**Frozen — 不修改任何 metadata.** `PreCompact` / `PostCompact` 在 PX spec §7 中作为 commit 边界 hook 复用 (不是 class D，因 class D 是 NEW events)；blocking semantics 保留。

### Class B — claude-code 借鉴 (platform-agnostic 子集，候选评估)

候选来源：`context/claude-code/entrypoints/sdk/coreTypes.ts:25-53` 的 27 events 中 platform-agnostic 子集. **必须逐个评估**真实 producer 是否在 nano-agent worker runtime 下成立.

### Class C — 环境事件 (候选评估，**必须经过 Phase 0/6 spike 验证**)

候选: `FileChanged` / `CwdChanged`. 这两个在 claude-code (single-process CLI) 有 strong producer (`fs.watch` / `process.cwd`)；在 Cloudflare Workers + fake filesystem 世界**是否有真实 producer 待 spike 验证**.

### Class D — Async-compact lifecycle (PX spec §7 frozen)

来自 `PX-async-compact-lifecycle-spec.md §7`. **本 class 的 5 events 在本 design 中 frozen**：

| Event (NEW) | blocking | allowedOutcomes | Producer | PX spec ref |
|---|---|---|---|---|
| `ContextPressure` | false | additionalContext / diagnostics | `async-compact/threshold.ts` (early signal at 50/60/70%) | PX §7 |
| `ContextCompactArmed` | false | diagnostics | `async-compact/scheduler.ts` (`idle → armed`) | PX §7 |
| `ContextCompactPrepareStarted` | false | diagnostics | `async-compact/prepare-job.ts` (`armed → preparing`) | PX §7 |
| `ContextCompactCommitted` | false | additionalContext / diagnostics | `async-compact/committer.ts` (`committing → committed`) | PX §7 |
| `ContextCompactFailed` | false | diagnostics | `async-compact/fallback.ts` 或 prepare-job error | PX §7 |

**Frozen by PX spec §7 + binding-F03 viability evidence (cross-worker hook dispatch p50=4ms ok).** B4 ship 时 producer 实现这 5 个 emission point.

---

## 4. Class B 候选评估 (6 candidates)

每个 candidate 评估 3 个维度: (1) nano-agent runtime 下有 producer? (2) 有 consumer? (3) 与 worker matrix viability?

### 4.1 `Setup` — 一次性环境初始化

| 维度 | 评估 | Decision |
|---|---|---|
| Producer | session DO cold start; `nano-session-do.ts` 已有 init 逻辑 | ✅ has |
| Consumer | hook handler 注入初始化 attachment / pre-load secrets | ✅ has |
| Viability | binding-F03 ok | ✅ |

**Promote: frozen** in catalog v2.
- `blocking: false`
- `allowedOutcomes: ["additionalContext", "diagnostics"]`
- `payloadSchema: SetupPayload` (NEW; defines `{ sessionUuid, env, ... }`)

### 4.2 `Notification` — 通用通知

| 维度 | 评估 | Decision |
|---|---|---|
| Producer | (未明确) — 任何想 push notification 的 producer 都可以 | ⚠️ vague |
| Consumer | inspector / external alerter | ⚠️ generic |

**Defer**: `Notification` 太通用，缺乏明确语义。**不准入** v2；如未来产品需要 alerter，再独立 design。

### 4.3 `Stop` / `StopFailure` — agent 终止

| 维度 | 评估 | Decision |
|---|---|---|
| Producer | session lifecycle (kernel → SessionEnd 之前) | ✅ has |
| Consumer | cleanup hooks; final audit | ✅ has |
| Viability | ok | ✅ |

**Promote `Stop`: frozen.**
- `blocking: false`
- `allowedOutcomes: ["diagnostics"]`
- `payloadSchema: StopPayload` (NEW; defines `{ reason: "user-cancel" | "kernel-finish" | "timeout" | ... }`)

**Defer `StopFailure`**: `PostToolUseFailure` + `Stop` 组合可表达；新加 `StopFailure` 是 over-segmentation。

### 4.4 `PermissionRequest` / `PermissionDenied` — capability ask-gated

| 维度 | 评估 | Decision |
|---|---|---|
| Producer | `capability-runtime` ask-gated capability 调用前 emit | ✅ has (12-pack contract 中已有 ask-gated category) |
| Consumer | UI prompt; audit log | ✅ has |
| Viability | binding-F03 ok | ✅ |

**Promote both: frozen.**
- `PermissionRequest`: `blocking: true`, `allowedOutcomes: ["allow", "deny", "diagnostics"]` (新 outcome `allow`/`deny` 必须在 outcome reducer 同步登记)
- `PermissionDenied`: `blocking: false`, `allowedOutcomes: ["diagnostics"]`

### 4.5 `SubagentStart` / `SubagentStop` — claude-code forked agent

| 维度 | 评估 | Decision |
|---|---|---|
| Producer | forked subagent 模型 (claude-code 风格) | ❌ nano-agent 当前 NO subagent forking; out-of-scope per charter §4.2 |
| Consumer | parent agent 等待 forked 结果 | ❌ same |

**Defer**: nano-agent v1 不实现 forked subagent；如未来 worker matrix 阶段 `agent.core` 启动 subagent worker，再独立 design + add events. **不准入** v2.

### 4.6 Class B summary

| Event | Decision |
|---|---|
| `Setup` | ✅ Promote |
| `Notification` | ❌ Defer (vague semantics) |
| `Stop` | ✅ Promote |
| `StopFailure` | ❌ Defer (over-segmentation) |
| `PermissionRequest` | ✅ Promote (with new `allow`/`deny` outcomes) |
| `PermissionDenied` | ✅ Promote |
| `SubagentStart` / `SubagentStop` | ❌ Defer (no producer reality in nano-agent v1) |

**Class B promoted: 4 events.**

---

## 5. Class C 候选评估 (2 candidates) — **MUST be spike-validated first**

### 5.1 `FileChanged`

| 维度 | 评估 | Decision |
|---|---|---|
| Producer in Workers + fake filesystem | ❌ Workers 没有 `fs.watch` equivalent; fake filesystem 是 K/V over DO storage; "file change" 唯一可能的 producer 是 `capability-runtime` 自己 emit on each `write` capability call | ⚠️ producer exists but trivial |
| Consumer | hook handler 重新 invalidate cache / re-read | ✅ plausible |
| Spike validation | **B7 round 2 follow-up needed** —— B1 round 1 没有跑过这个验证 | ⏳ |

**Decision**: **Defer to B7**. `FileChanged` 候选保留 but 不 promote until B7 round 2 spike confirms producer reality 是否值得 codify (vs 让 capability-runtime caller 自己 emit `PostToolUse` 即可)。**不准入** v2；标记为 `B7-pending`.

### 5.2 `CwdChanged`

| 维度 | 评估 | Decision |
|---|---|---|
| Producer | nano-agent 无 OS-level cwd; fake-bash 的 `cd` 修改 capability runtime state | ⚠️ trivially synthetic |
| Consumer | path resolution rebase | ⚠️ unclear if needed |

**Decision**: **Defer permanently**. nano-agent 的 `cwd` 是 capability runtime state, 不是 OS-bound concept; `cd` 后的状态变化由 capability runtime 内部管理; 没有 cross-package consumer 需要 hook event. **不准入** v2.

### 5.3 Class C summary

| Event | Decision |
|---|---|
| `FileChanged` | ⏳ Defer to B7 spike validation |
| `CwdChanged` | ❌ Defer permanently (no real consumer) |

**Class C promoted: 0 events** in v2; possible 1 event after B7.

---

## 6. Class D 候选评估 (additional binding-F04 candidate)

PX spec §7 已 frozen 5 events (§3 Class D 表). 本节评估 binding-F04 提出的额外候选.

### 6.1 `EvalSinkOverflow` (binding-F04 driver)

**B1 evidence**: `spike-binding-pair-F04` — sink overflow 时静默 drop (capacity=50 / dropped=50). `B6-writeback-eval-sink-dedup.md` issue 已 open: defaultEvalRecords + SessionInspector 必须 emit 显式 disclosure when overflow.

| 维度 | 评估 | Decision |
|---|---|---|
| Producer | `defaultEvalRecords` (session-do-runtime) + `SessionInspector` (eval-observability) overflow check | ✅ has (will be ship by B6) |
| Consumer | inspector facade WS stream (P3-inspector); higher-layer ops alerting; B6 also designed event-not-just-counter as option | ✅ has |
| Viability | binding-F03 ok | ✅ |

**Promote: frozen.**
- `EvalSinkOverflow`
- `blocking: false`
- `allowedOutcomes: ["additionalContext", "diagnostics"]` (additionalContext 用于 hook 暗示 caller flush to durable storage)
- `payloadSchema: EvalSinkOverflowPayload` (NEW; defines `{ droppedCount, capacity, sinkId, sessionUuid }`)
- **Co-ship constraint**: depends on B6 SessionInspector dedup + overflow disclosure ship

### 6.2 Class D summary

| Event | Decision | Source |
|---|---|---|
| `ContextPressure` | ✅ Promote (PX §7) | PX spec |
| `ContextCompactArmed` | ✅ Promote (PX §7) | PX spec |
| `ContextCompactPrepareStarted` | ✅ Promote (PX §7) | PX spec |
| `ContextCompactCommitted` | ✅ Promote (PX §7) | PX spec |
| `ContextCompactFailed` | ✅ Promote (PX §7) | PX spec |
| `EvalSinkOverflow` | ✅ Promote (binding-F04) | binding-F04 |

**Class D promoted: 6 events** (5 PX-driven + 1 binding-driven).

---

## 7. Final v2 catalog count

| Class | Promoted count | Source |
|---|---|---|
| A — 保留 | 8 | unchanged |
| B — claude-code 借鉴 | 4 | §4 (Setup, Stop, PermissionRequest, PermissionDenied) |
| C — 环境事件 | 0 | all deferred (1 may add post-B7) |
| D — Async-compact lifecycle | 6 | §6 (5 PX + 1 EvalSinkOverflow) |
| **Total v2** | **18** | (unchanged from previously projected 18, but now justified per-event) |

> **Note on charter §4.1 E**: charter said "exact count may be 12/14/16/18/20." This design lands on **18**, but **每个 event 都有 producer + consumer + B1 evidence justification**. 不是预先承诺 18，而是 evaluation 收敛到 18.

> **If post-B7 `FileChanged` adds, count → 19.**
> **If B6 decides not to ship `EvalSinkOverflow` event (use counter only), count → 17.**

---

## 8. 关键决策与证据链

### 8.1 决策：保留 class A 8 events 完全不变

**Evidence**: F07 (capability-parity confirms current contracts hold including PreCompact/PostCompact); plan-after-skeleton 阶段 closure.

**Decision**: 不 touch class A 任何字段; backward compat 完整保留。

### 8.2 决策：class B 准入 4 events，拒绝 4 候选

**Evidence**: §4 per-candidate evaluation; binding-F03 viability ok.

**Decision**:
- Promote: `Setup` / `Stop` / `PermissionRequest` / `PermissionDenied`
- Defer: `Notification` / `StopFailure` / `SubagentStart` / `SubagentStop`
- Rationale: 每个准入项都有真实 producer + consumer; defer 项缺其一

### 8.3 决策：class C 暂不准入，pending B7

**Evidence**: §5 evaluation; B1 round 1 没有 file-watch / cwd 真实验证 producer.

**Decision**:
- 0 events promoted in v2
- `FileChanged` 候选保留 pending B7 round 2 spike (与 F09 高 volume probe + F08 binary search 同期)
- `CwdChanged` 永久 defer

### 8.4 决策：class D 5 PX-driven + 1 binding-F04 driven = 6 events

**Evidence**: PX spec §7 + binding-F04 + B6 writeback issue.

**Decision**:
- 5 lifecycle events frozen by PX spec
- `EvalSinkOverflow` frozen by binding-F04 + B6 co-ship constraint
- Co-ship ordering: P3 async-compact (B4) producer + B5 catalog (this design) ship together; B6 SessionInspector dedup + overflow ship 同期 or 之前

### 8.5 决策：新 `allow` / `deny` outcome for PermissionRequest

**Evidence**: capability-runtime ask-gated category needs explicit yes/no semantics, not just "block".

**Decision**:
- `outcome.ts` 添加 `allow` / `deny` 两个 outcome value
- 仅 `PermissionRequest` event 接受这两个 outcome
- Outcome reducer: if all handlers `allow` → proceed; if any `deny` → block; if no handlers → default `deny` (fail-closed)

### 8.6 决策：event names 保持 PascalCase (与 class A 一致)

**Evidence**: catalog 现 8 events 全 PascalCase. binding-F02 是 HTTP **header** 案例 (强制 lowercase)，hook event names 是 internal identifier，不受 binding-F02 约束.

**Decision**: 新 events 全 PascalCase: `Setup`, `ContextPressure`, `EvalSinkOverflow` 等. 与 class A 一致.

> **Important distinction**: NACP `hook.emit` message body 中 `event_name` 字段 value 是 PascalCase (这与 binding-F02 lowercase header 是不同的层；header 是 transport metadata，event_name 是 payload value).

### 8.7 决策：dispatcher 行为完全不变

**Evidence**: existing dispatcher contract 已 stable; binding-F03 confirmed cross-worker dispatch latency budget ok.

**Decision**:
- 本设计**不**修改 dispatcher / outcome reducer / session mapper 的行为算法
- 仅 catalog 数据扩张 + outcome.ts 添加 2 outcome values + payload schema 文件添加
- 现有 8 events 的所有测试保持 pass

### 8.8 决策：协议层 event_name allowed values 扩展由 P5 RFC 处理

**Evidence**: charter §4.1 F: `nacp-core/src/messages/hook.ts` 的 wire body 已经 generic 到能容纳新 event_name (`{ event_name, event_payload }`)，但 `event_name` 的 allowed values list 是 protocol-level contract.

**Decision**:
- 本设计**不**修改 nacp-core
- P5 RFC `nacp-core-1-2-0.md` 处理 `event_name` allowed values 扩展为 18 (or final count)
- 同期 ship — B5 catalog + B6 nacp-core 1.2.0 同 batch

---

## 9. 与 charter / spec / spike findings 对应关系

| Charter §6 Phase 4 in-scope item | 实现位置 | Evidence |
|---|---|---|
| Step 1 — freeze 4 event classes | §3 表 | charter §4.1 E |
| Step 2 — 基于 reality 选择 events | §4-§7 per-candidate evaluation | binding-F03 (viability) + PX spec + binding-F04 |
| Step 3 — freeze metadata | §3 + §4-§6 各表 | per event |
| outcome reducer 跟随更新 | §8.5 (allow/deny outcomes) | PermissionRequest needs them |
| `core-mapping.ts` / `session-mapping.ts` / `audit.ts` 跟随更新 | implementation 阶段 (B5 ship) | catalog 是 SOT |
| 不预先承诺数字 | §7 — 数字 (18) 是评估结果，不是承诺 | charter §4.1 E |
| `hooks` 包版本 | charter §11.2 secondary outcome | semver bump 是结果 |

---

## 10. 不在本 design 决策的事项

1. P5 NACP `event_name` allowed values 扩展 → P5 RFC
2. dispatcher 行为修改 → 不需要修改
3. 新 events 的 implementation (producer 代码) → B4 (class D producer) / capability-runtime (PermissionRequest producer) / B6 (EvalSinkOverflow producer)
4. UI / dashboard 消费 → out-of-scope per charter §4.2
5. Production-grade alerting on `EvalSinkOverflow` → out-of-scope per charter §4.2

---

## 11. 收口标准（Exit Criteria）

本 design 的成立标准：

1. ✅ §3 4 classes frozen
2. ✅ §3 class A 8 events 不变
3. ✅ §3 class D 5 PX-driven events frozen
4. ✅ §4 class B 6 candidates 逐个评估 → 4 promote / 4 defer
5. ✅ §5 class C 2 candidates 评估 → 0 promote / 1 pending B7 / 1 defer
6. ✅ §6 binding-F04 candidate 准入
7. ✅ §7 final count 18 with justification per event
8. ✅ §8 8 个关键决策每个绑定 B1 finding / PX spec / charter
9. ⏳ B5 action plan 引用本 design 写出执行批次
10. ⏳ B7 round 2 spike 重测 cross-worker hook dispatch with 18 events catalog
11. ⏳ P5 RFC `nacp-core-1-2-0.md` 扩展 `event_name` allowed values to 18

---

## 12. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；4 classes frozen；18 events 经 per-candidate evaluation 收敛而非预承诺；5 PX-driven + 1 binding-F04 driven 在 class D；4 claude-code 借鉴 events promoted to class B |
