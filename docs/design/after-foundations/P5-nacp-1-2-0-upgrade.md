# Nano-Agent After-Foundations P5 — NACP 1.2.0 Protocol Upgrade

> 功能簇：`nacp-core` 1.1.0 → 1.2.0 + `nacp-session` 1.1.0 → 1.2.0
> 讨论日期：`2026-04-19`
> 讨论者：`Opus 4.7 (1M context)`
>
> 关联调查报告（B1 finding traceability — backward）：
> - `docs/spikes/spike-binding-pair/02-anchor-headers-survive-but-lowercased.md` (**binding-F02 — NACP 1.2.0 spec MUST declare anchor headers lowercase**)
> - `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md` (binding-F04 — dedup contract documented in spec; does NOT add new message kind)
> - `docs/spikes/spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md` (F03 — freshness caveat note in spec)
> - `docs/spikes/binding-findings.md` + `docs/spikes/storage-findings.md` (rollups)
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` §B6 (this design's input contract)
>
> 上游 charter / spec / 模板：
> - `docs/plan-after-foundations.md` §4.1 F (升级时机本阶段; 具体 family 反推自 Phase 3 reality; 不预冻结) + §7.6 (Phase 5 details)
> - **`docs/design/after-foundations/PX-async-compact-lifecycle-spec.md` §8** (canonical "what MUST / what does NOT need NACP")
> - `docs/design/after-foundations/P3-context-management-async-compact.md` (producer reality)
> - `docs/design/after-foundations/P3-context-management-inspector.md` §6.3 (inspector facade NOT via NACP)
> - `docs/design/after-foundations/P4-hooks-catalog-expansion.md` §8.8 (catalog event_name allowed values needs P5)
> - `docs/eval/after-foundations/context-management-eval-by-Opus.md` v2 §6.4 (originally proposed families) + §8.7 (charter修订收窄)
> - `docs/templates/design.md`
>
> 关联 RFCs (sibling, ship together):
> - `docs/rfc/nacp-core-1-2-0.md`
> - `docs/rfc/nacp-session-1-2-0.md`
>
> 关键 reference (existing code, baseline):
> - `packages/nacp-core/src/messages/context.ts` (current `context.compact.request/response` only)
> - `packages/nacp-session/src/messages.ts` (current 8 message kinds)
> - `packages/nacp-core/src/messages/hook.ts` (current hook.emit/outcome wire body)
>
> 文档状态：`draft`

---

## 0. 背景与前置约束

charter §4.1 F (r2 修订 by GPT review §2.6) 强制本设计：**升级时机本阶段，但具体 message family 必须从 Phase 3 真实 producer/consumer 反推；不预冻结具体 message kind 名字**. 本 design 落实"反推" methodology + 给两个 sibling RFC 定方向 + 严守 PX spec §8 "what MUST / what does NOT need NACP" 边界.

- **项目定位回顾**：`nacp-core` 当前 1.1.0 frozen + 1.0.0 compat shim; `nacp-session` 当前 1.1.0 frozen + 8 message kinds. 任何 1.2.0 扩展是 protocol-level contract change, 必须谨慎.
- **本次讨论的前置共识**：
  - charter §4.1 F: 升级时机不变，但具体 family 反推自 Phase 3 (B4) producer/consumer reality
  - PX spec §8: 已经 canonically define 哪些**必须**走 NACP (跨 worker compact dispatch + cross-worker compact result)，哪些**不需要** (intra-worker hooks + inspector independent HTTP)
  - **binding-F02 hard requirement**: NACP 1.2.0 spec 必须显式声明 anchor headers lowercase
  - **binding-F04**: dedup contract 在 spec 文档中说明，但**不**新增 message kind (transport-level 概念，不是协议字段)
  - inspector 走独立 HTTP/WS 路由 (per P3-inspector §6.3 + GPT review §2.3) → **不**需要 `session.context.usage.snapshot` 等 NACP message
  - charter §11.2: semver bump (1.1.0 → 1.2.0) 是 secondary outcome；**核心**是协议 surface contract 是否冻结
- **显式排除的讨论范围**：
  - 不讨论具体 zod schema (→ sibling RFC)
  - 不讨论 1.0.0 / 1.1.0 compat shim 实现细节 (→ implementation 阶段)
  - 不讨论 Phase 3 (B4) async-compact 的实现细节 (→ already in P3-async-compact + PX spec)
  - 不讨论 hooks catalog event 数量 (→ P4 design)
  - 不讨论 storage / context.assemble layer-level message (charter §4.1 F 已明确 NOT add)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`nacp-core` 1.1.0 → 1.2.0 + `nacp-session` 1.1.0 → 1.2.0
- **一句话定义**：基于 Phase 3 (B4) async-compact reality + binding-F02/F04 contract，**反推**最小化 NACP 协议扩展，并在 spec 中显式声明 lowercase header + dedup contract.
- **边界描述**：本设计**包含**反推 methodology + candidate family 评估 + lowercase header spec + dedup contract spec + sibling RFC 定方向；**不包含**具体 zod schema (sibling RFC)、compat shim 实现 (B6 implementation)、async-compact lifecycle 行为 (PX spec)、hook catalog 内容 (P4)。
- **关键术语对齐**：

| 术语 | 定义 |
|---|---|
| **反推 methodology** | 看 Phase 3 (B4) producer/consumer reality 已经实际产生/消费的事件，反向决定 NACP 协议是否需要承载该事件 |
| **Frozen-or-deferred** | 每个 candidate family 必须明确状态：`frozen` (本阶段 ship), `deferred` (worker matrix 阶段视情决定), `dismissed` (确定不需要) |
| **NACP-eligible event** | 满足: (1) 跨 worker; (2) 需要 envelope-level validation; (3) 与 transport 解耦; 三者满足才需要 NACP message |
| **Hook-only event** | intra-worker; 仅需要 hook dispatcher 即可承载；不需要 NACP envelope |

### 1.2 参考调查报告

详见 frontmatter B1 findings + PX spec §8 + Opus v2 §6.4 / §8.7.

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 本子模块在整体架构里的角色：**NACP 协议层 v1.2.0 — load-bearing 跨 worker contract for after-foundations phase exit**
- 服务于：worker matrix 阶段任何跨 worker 通讯 (agent.core ↔ context.core ↔ filesystem.core)；P3 inspector facade (虽然 inspector 走独立 HTTP，但 envelope schema 的 anchor 字段 reuses NACP type)
- 依赖：B1 binding-F02/F04 evidence；PX spec §8；P3-async-compact producer reality；P3-inspector consumer reality
- 被谁依赖：nacp-core / nacp-session 1.0.0 / 1.1.0 用户 (compat shim must hold)；P4 hooks catalog (event_name allowed values)；worker matrix 阶段 cross-worker dispatch

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `packages/nacp-core/src/messages/{context,hook,system,...}.ts` | extends | 强 | 添加 message kind (if approved) + extend hook event_name allowed values |
| `packages/nacp-session/src/messages.ts` | (likely no change) | 弱 | charter §4.1 F + PX §8: inspector independent HTTP, **no need** for session.context.usage.* family |
| **PX-async-compact-lifecycle-spec.md §8** | conforms to | 强 | "what MUST / what does NOT need NACP" 是本 design 的 evaluation 边界 |
| `P3-context-management-async-compact.md` | reverse-derives from | 强 | producer reality 决定 NACP candidate |
| `P3-context-management-inspector.md` §6.3 | confirms exclusion | 中 | inspector NOT via NACP; minus `session.context.usage.snapshot` candidate |
| `P4-hooks-catalog-expansion.md` §8.8 | feeds into | 中 | hook event_name allowed values 18 → P5 RFC 扩展 |
| `B6-writeback-eval-sink-dedup.md` (open issue) | spec-document | 中 | dedup contract spec 文档化 (non-protocol) |
| `nacp-core` 1.0.0 / 1.1.0 compat shim | preserves | 强 | 必须不 break |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`NACP 1.2.0 upgrade` 是 **协议层 minimal extension，反推自 Phase 3 producer/consumer reality**——对上游 conforming PX spec §8 边界，对下游 nacp-core / nacp-session 1.2.0 RFCs 提供方向 + 严守 binding-F02 lowercase header contract + binding-F04 dedup spec note。

---

## 3. 反推 Methodology

### 3.1 Decision tree

对每个 candidate event / message family 应用以下 decision tree：

```
   Is this event / state-transition cross-worker?
   ├── NO  → hook event only (P4 catalog handles); NACP not needed
   └── YES
       │
       ├── Does the receiving worker need envelope-level validation
       │   (admissibility / tenancy / schema)?
       │   ├── NO  → independent HTTP/WS endpoint (e.g. inspector facade);
       │   │         NACP not needed
       │   └── YES
       │       │
       │       ├── Is there a real producer in Phase 3 (B4) reality?
       │       │   ├── NO  → defer (no producer reality)
       │       │   └── YES
       │       │       │
       │       │       └── Is there a real consumer (cross-worker)?
       │       │           ├── NO  → defer
       │       │           └── YES → frozen in 1.2.0
```

### 3.2 Application to PX spec §8 candidates

PX spec §8 列出的 3 个 "what MUST be representable in NACP" candidates 经 decision tree:

| Candidate (PX §8) | Cross-worker? | Envelope validation? | Phase 3 producer? | Cross-worker consumer? | Decision |
|---|---|---|---|---|---|
| Cross-worker compact request (agent.core → context.core "prepare summary") | YES | YES (tenancy / sessionUuid scoping) | YES (PX §3 prepare-job is in async-compact) | YES (if context.core is separate worker in matrix phase) | **frozen** in 1.2.0 |
| Cross-worker compact result (context.core → agent.core "summary ready") | YES | YES (correlate with request) | YES (PX §5 commit) | YES | **frozen** in 1.2.0 |
| Inspector subscribe (inspector → session DO "stream me events") | YES | NO (inspector goes via HTTP/WS independent route per §3.6 P3-inspector + GPT §2.3) | YES (P3-inspector is producer) | NO (consumer is HTTP client, not NACP peer) | **dismissed** — independent HTTP |

PX spec §8 "what does NOT need NACP" candidates already pre-dismissed:
- ContextPressure → hook only ✓ (P4 class D event)
- PreCompact / PostCompact → existing hook protocol ✓
- Per-session policy override reads → HTTP inspector ✓

### 3.3 Application to additional B1-driven candidates

| Candidate | Cross-worker? | Envelope validation? | Reality? | Decision |
|---|---|---|---|---|
| `context.budget.exceeded` notification (Opus v2 §6.4) | YES (sender = context.core, receiver = agent.core) | YES | YES (PX §7 ContextPressure 同源) | **but** can be expressed as cross-worker hook dispatch (P4 + binding-F03 viability) — **dismissed** to keep NACP minimal |
| `session.context.usage.snapshot` (Opus v2 §6.4) | NO if inspector via HTTP | — | — | **dismissed** (per inspector independent HTTP decision) |
| `storage.placement.*` family (Opus v2 §8.3.2 originally suggested) | (intra-package; storage layer) | NO | — | **dismissed** per charter §4.1 F |
| `filesystem.write.committed` (Opus v2 §8.3.2 originally suggested) | (intra-worker for now; cross-worker only when filesystem.core ships) | — | NO producer in Phase 3 | **deferred** to worker matrix phase |
| `context.assemble.*` (Opus v2 §8.3.2 originally suggested) | NO (assembly is in-worker) | — | — | **dismissed** per charter §4.1 F |

### 3.4 Reverse-derivation result: 2 frozen NACP families

After §3.2 + §3.3 evaluation, **only 2 family groups frozen for 1.2.0**:
- `context.compact.prepare.request/response` (cross-worker compact request + result, PX §8 #1+#2 combined into 1 family)
- `context.compact.commit.notification` (cross-worker notification when commit happens; only emitted if context-management runs as separate worker)

These 2 message families are the **only** candidates promoted to sibling RFC `nacp-core-1-2-0.md` for full schema definition.

`nacp-session-1-2-0.md` may have **0 new families** — to be confirmed in that RFC. Charter §11.2 explicitly allows nacp-session staying at 1.1.0 if no extension needed; semver bump is secondary outcome.

---

## 4. binding-F02 Lowercase Header Spec (mandatory)

### 4.1 Hard requirement

`spike-binding-pair-F02` validated: Cloudflare service binding fetch transport **forces HTTP header names to lowercase**. `X-Nacp-Trace-Uuid` → received only at `x-nacp-trace-uuid`.

### 4.2 Spec normative text (will appear in nacp-core-1-2-0 RFC)

> **NACP 1.2.0 §X — Anchor Header Naming**
>
> All NACP cross-seam anchor headers MUST use lowercase ASCII names in all packages, documentation, and code. This conforms to RFC 7230 §3.2 case-insensitivity AND to the observed Cloudflare service binding lowercase normalization (validated in spike-binding-pair-F02).
>
> The 6 canonical anchor header names are:
> - `x-nacp-trace-uuid`
> - `x-nacp-session-uuid`
> - `x-nacp-team-uuid`
> - `x-nacp-request-uuid`
> - `x-nacp-source-uuid`
> - `x-nacp-source-role`
>
> Code constants in `packages/session-do-runtime/src/cross-seam.ts` and any consumer MUST use the lowercase form. Audit logs and inspector dumps MUST display lowercase form.

### 4.3 Audit obligation for B5 ship

B5 implementation phase must `grep -rn "X-Nacp\\|X-NACP" packages/` and convert any mixed-case usage. This is a contract test candidate.

---

## 5. binding-F04 Dedup Contract Spec (mandatory, non-protocol)

### 5.1 Hard requirement

`spike-binding-pair-F04` validated: Cloudflare service binding fetch transport **does not provide message dedup**; 60 records sent with same dedupSeed → all 60 received, only 20 unique.

### 5.2 Spec normative text (will appear in nacp-core-1-2-0 RFC)

> **NACP 1.2.0 §X — Eval Sink Dedup Contract**
>
> NACP transport (whether fetch-based service binding, RPC handleNacp, or future transports) does NOT provide cross-message dedup. Receiving workers (sinks, inspectors, audit logs) MUST implement application-layer dedup keyed on `messageUuid` (NACP envelope field).
>
> Sink overflow (when a sink reaches its capacity) MUST emit explicit disclosure (via hook event `EvalSinkOverflow` per P4 catalog OR via metric counter accessible to inspectors). Silent drop is non-conformant.
>
> Reference implementation: `packages/eval-observability/src/inspector.ts` `SessionInspector` (post-B6 ship has dedup) and `packages/session-do-runtime/src/do/nano-session-do.ts` `defaultEvalRecords` (post-B6 ship has dedup + overflow disclosure).

### 5.3 No new message kind

This contract is **transport behavior + sink behavior** spec. **No** new NACP message kind added by binding-F04.

---

## 6. F03 Freshness Caveat Spec (note-only)

### 6.1 Spec normative text

> **NACP 1.2.0 §X — KV-Backed State Freshness**
>
> Any NACP message that conveys state read from KV-backed storage MUST be considered eventually consistent across colos. Same-colo read-after-write was observed strong in spike-do-storage-F03; cross-colo behavior is not yet validated. Until validated (B7 round 2), consumers SHOULD NOT assume strict cross-colo consistency for KV-derived state in NACP messages.

This is a **read-side caveat**, not a protocol field change.

---

## 7. hook event_name allowed values extension

### 7.1 P4 → P5 dependency

Per P4 design §7, `nacp-core/src/messages/hook.ts` `event_name` field's allowed values must extend from current 8 to **18** (4 unchanged class A + 4 class B + 6 class D; 0 class C).

### 7.2 Spec text (will be in nacp-core RFC)

`hook.emit` and `hook.outcome` message bodies remain wire-compatible (`{ event_name, event_payload }` and `{ ok, block?, updated_input?, additional_context?, stop?, allow?, deny?, diagnostics? }`). The `event_name` field accepts the 18 enum values. New `allow` and `deny` outcome fields are added for the `PermissionRequest` event.

---

## 8. 关键决策与证据链

### 8.1 决策：反推 methodology over pre-freeze

**Evidence**: charter §4.1 F (post-GPT-review r2 修订); historical 1.0.0 → 1.1.0 evolution showed pre-freeze causes rework.

**Decision**: Apply §3 decision tree to every candidate; only promote when 4 conditions all yes.

### 8.2 决策：仅 2 family promoted to nacp-core 1.2.0

**Evidence**: §3.2-§3.4 evaluation; PX spec §8.

**Decision**:
- Frozen: `context.compact.prepare.request/response` + `context.compact.commit.notification`
- Dismissed: `context.budget.exceeded` (use hook), `session.context.usage.snapshot` (use HTTP), `storage.*` (per charter §4.1 F), `context.assemble.*` (per charter §4.1 F)
- Deferred: `filesystem.write.committed` (no Phase 3 producer)

### 8.3 决策：nacp-session 可能 0 new family

**Evidence**: PX §8 + P3-inspector §6.3 (independent HTTP) + charter §11.2 (semver bump 是 secondary outcome).

**Decision**:
- nacp-session 1.2.0 RFC 中 evaluate 是否有 candidate; 如果 0 → 保持 1.1.0 不 bump
- 如果某些 cross-worker session-state 同步真的需要协议化 (B4 producer reality 暴露), then add minimum

### 8.4 决策：lowercase header spec normative

**Evidence**: binding-F02; binding-F03 confirms anchor headers traverse hook path also lowercase.

**Decision**: §4 spec text → nacp-core 1.2.0 RFC §X (mandatory normative section).

### 8.5 决策：dedup spec normative (no message kind change)

**Evidence**: binding-F04; B6 writeback issue已 ship 的 SessionInspector + defaultEvalRecords 已 dedup.

**Decision**: §5 spec text → nacp-core 1.2.0 RFC §X (normative non-protocol section). Sinks MUST dedup; transport is NOT responsible.

### 8.6 决策：F03 freshness caveat note

**Evidence**: F03 same-colo strong; cross-colo TBD.

**Decision**: §6 spec text → nacp-core 1.2.0 RFC §X (informative note section). B7 round 2 confirms; spec updates if needed.

### 8.7 决策：hook event_name allowed values extends to 18 (P4 dependency)

**Evidence**: P4 design §7 final count 18; charter §4.1 F (NACP follows hooks reality).

**Decision**: nacp-core 1.2.0 RFC schema for `hook.emit` `event_name` enum 接受 18 values + new `allow`/`deny` outcomes.

### 8.8 决策：1.0.0 / 1.1.0 compat shim 完整保留

**Evidence**: charter §4.1 F; nacp-core 1.0.0 compat shim 已经保留 (历史 closure 经验).

**Decision**: 1.2.0 ship 时 1.0.0 / 1.1.0 user 完全不 break:
- 1.0.0 user 不消费新 family → no impact
- 1.1.0 user 不消费新 family → no impact
- 1.0.0 / 1.1.0 user 消费 hook.emit/outcome 时 event_name 是 1.0.0/1.1.0 范围 → no impact (新 enum value 不破坏现有 value)
- compat test 全绿是 RFC freeze 前提

### 8.9 决策：协议升级时机本阶段不变

**Evidence**: charter §4.1 F (升级时机本阶段); P3 producer reality 在 B4 ship 后 fix.

**Decision**:
- B5 (P4 catalog) ship → B4 producer ship → B6 (P5 RFCs + nacp 1.2.0 implementation) ship
- ship ordering: catalog 先 ship 让 producer 可以 emit (即使 dispatcher 容错)；producer ship 让 NACP 反推有 reality；NACP RFC 最后 finalize

---

## 9. 与 charter / spec / spike findings 对应关系

| Charter §6 Phase 5 in-scope item | 实现位置 | Evidence |
|---|---|---|
| Step 1 — 反推 methodology | §3 decision tree | charter §4.1 F |
| Step 2 — 最小化扩展 | §3.4 only 2 frozen + 4 dismissed + 1 deferred | per evaluation |
| Step 3 — RFC + freeze | sibling RFCs | this design feeds into them |
| 1.0.0 / 1.1.0 compat shim 完整保留 | §8.8 | charter §4.1 F |
| 不预先承诺 nacp-session 必须 bump | §8.3 | charter §11.2 |
| 不预先承诺 nacp-core message family 名字 | §3.4 (frozen names are derived, not committed in charter) | charter §4.1 F |
| 不新增 storage.* family | §3.3 | charter §4.1 F |
| 不新增 context.assemble.* family | §3.3 | charter §4.1 F |
| 协议 schema 与 P3+P4 实现一一对应 | §8.7 (P4 → P5 dep) + §3.2 (P3 reality reverse-derived) | charter §4.1 F |

---

## 10. 不在本 design 决策的事项

1. 具体 zod schema for the 2 frozen families → sibling `nacp-core-1-2-0.md` RFC
2. nacp-session 1.2.0 具体 family list (0 or N) → sibling `nacp-session-1-2-0.md` RFC
3. compat shim 实现细节 → B6 implementation
4. Message UUID generation strategy (already in nacp-core 1.0.0)
5. NACP envelope size limit / fragmentation → out-of-scope
6. RPC handleNacp transport spec (out-of-scope per `binding-findings.md` §0)
7. Cross-region / cross-colo NACP routing → after worker matrix
8. NACP WebSocket sub-protocol → existing nacp-session WS profile unchanged

---

## 11. 收口标准（Exit Criteria）

本 design 的成立标准：

1. ✅ §3 反推 methodology + decision tree
2. ✅ §3.2-§3.4 candidate evaluation 收敛到 2 frozen
3. ✅ §4 lowercase header spec normative text
4. ✅ §5 dedup spec normative text
5. ✅ §6 F03 freshness caveat note
6. ✅ §7 hook event_name extension 路径 (P4 → P5 dep)
7. ✅ §8 9 个关键决策每个绑定 B1 finding / charter / PX spec
8. ⏳ sibling `nacp-core-1-2-0.md` RFC 落地具体 schema
9. ⏳ sibling `nacp-session-1-2-0.md` RFC 落地 (可能 0 family)
10. ⏳ B6 action plan 引用本 design + 2 RFCs 写出执行批次
11. ⏳ B7 round 2 spike re-runs cross-worker NACP message exchange with new families
12. ⏳ 1.0.0 / 1.1.0 compat shim 测试全绿

---

## 12. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；反推 methodology + 4 conditions decision tree；2 frozen + 4 dismissed + 1 deferred；lowercase header + dedup + freshness 3 个 spec normative sections；P4 → P5 hook event_name extension dep |
