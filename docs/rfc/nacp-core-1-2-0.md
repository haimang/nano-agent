# RFC: `nacp-core` 1.2.0 — Async-Compact Family + Hook Catalog Extension + Lowercase Header Spec

> **RFC ID**: `nacp-core-1-2-0`
> **Status**: `draft` (becomes `frozen` on B6 ship)
> **Author**: Opus 4.7 (1M context)
> **Date**: 2026-04-19
> **Sibling RFCs**: `docs/rfc/nacp-session-1-2-0.md`
> **Sibling design**: `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md`
>
> **B1 finding sources (backward traceability)**:
> - `docs/spikes/spike-binding-pair/02-anchor-headers-survive-but-lowercased.md` (**binding-F02 — anchor headers MUST be lowercase**)
> - `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md` (binding-F04 — sink dedup contract)
> - `docs/spikes/spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md` (F03 — freshness caveat)
> - `docs/spikes/binding-findings.md` (rollup §3 — writeback to NACP spec)
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` §B6
> - `docs/issue/after-foundations/B6-writeback-eval-sink-dedup.md` (open writeback issue)
>
> **Related design / spec dependencies**:
> - `docs/design/after-foundations/PX-async-compact-lifecycle-spec.md` §8 (NACP-eligibility canonical)
> - `docs/design/after-foundations/P3-context-management-async-compact.md` (producer reality)
> - `docs/design/after-foundations/P4-hooks-catalog-expansion.md` §8.8 (hook event_name allowed values 18)
> - `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md` §3 (反推 methodology + 2 frozen families)

---

## 0. Summary

`nacp-core` 1.1.0 → 1.2.0 添加 **2 个 message families** (`context.compact.prepare.*` + `context.compact.commit.notification`)、**扩展 hook event_name allowed values 8→18 + 新增 allow/deny outcomes**、**3 个 normative spec sections** (lowercase header / sink dedup / KV freshness caveat). 1.0.0 / 1.1.0 compat shim **完整保留**.

Per charter §11.2, semver bump (1.1.0 → 1.2.0) 是 secondary outcome — 真正成功标准是 protocol surface 与 PX spec §8 + binding-F02/F04 evidence 严格对齐.

---

## 1. Versioning

| Aspect | 1.1.0 (current) | 1.2.0 (this RFC) |
|---|---|---|
| Frozen baseline | yes | yes |
| 1.0.0 compat shim | yes | yes (preserved) |
| 1.1.0 compat shim | (n/a; 1.1.0 IS the baseline) | yes (added; 1.1.0 users do not break) |
| Message families | 5 (tool / hook / skill / context / system) | 5 (no new family group; **added kinds inside existing families**) |
| Total message kinds | 12 (best estimate by current code) | 14 (12 + 2 new context.compact.* kinds) |
| Hook event_name allowed values | 8 | 18 (extension only; 8 unchanged) |
| Hook outcome fields | `ok`, `block?`, `updated_input?`, `additional_context?`, `stop?`, `diagnostics?` | + `allow?`, `deny?` (for PermissionRequest event only) |

---

## 2. New Message Kinds (per P5 §3.4 reverse-derivation)

> Only families satisfying P5 §3.1 4-condition decision tree are added. Per PX spec §8 + P5 §3, only async-compact lifecycle's cross-worker prepare/commit warrants NACP message extension.

### 2.1 `context.compact.prepare.request`

**Producer**: `agent.core` worker (or in-process equivalent)
**Consumer**: `context.core` worker (when context-management runs as separate worker per worker matrix)
**Wire shape**:

```ts
import { z } from "zod";
import { NacpRefSchema } from "../envelope.js";

export const ContextCompactPrepareRequestBodySchema = z.object({
  /** Reference to the conversation history range to summarize. */
  history_ref: NacpRefSchema,
  /** Caller's snapshot version at the time of request (for diff-aware merge per PX §5.2). */
  snapshot_version: z.number().int().min(0),
  /** Token budget the summary should target after compaction. */
  target_token_budget: z.number().int().min(1),
  /** Optional hint to compact only specific tags (per P3-hybrid-storage tag model). */
  compact_tags: z.array(z.string()).optional(),
  /** Caller-side correlation id for matching response. */
  prepare_job_id: z.string().uuid(),
});
```

Registration: `packages/nacp-core/src/messages/context.ts`
```ts
registerMessageType("context.compact.prepare.request", ContextCompactPrepareRequestBodySchema, {
  bodyRequired: true,
  allowedProducerRoles: ["session", "platform"],
});
```

### 2.2 `context.compact.prepare.response`

**Producer**: `context.core` (or in-process equivalent)
**Consumer**: `agent.core`
**Wire shape**:

```ts
export const ContextCompactPrepareResponseBodySchema = z.object({
  /** Echoed for correlation. */
  prepare_job_id: z.string().uuid(),
  /** Outcome status. */
  status: z.enum(["ok", "error", "cancelled", "timeout"]),
  /** When ok: ref to the prepared summary blob. */
  summary_ref: NacpRefSchema.optional(),
  /** When ok: actual byte size of summary (drives F08 inline-vs-R2-promotion routing in committer). */
  summary_bytes: z.number().int().min(0).optional(),
  /** When ok: tokens consumed by summary (post-compact). */
  tokens_after: z.number().int().min(0).optional(),
  /** Tokens before compaction (informational). */
  tokens_before: z.number().int().min(0).optional(),
  /** Error info when status != ok. */
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
```

Registration:
```ts
registerMessageType("context.compact.prepare.response", ContextCompactPrepareResponseBodySchema, {
  bodyRequired: true,
  allowedProducerRoles: ["capability"],
});
```

### 2.3 `context.compact.commit.notification`

**Producer**: `context.core` (or in-process equivalent) — emitted when `committing → committed` transition completes
**Consumer**: `agent.core` (and any inspector subscribed via independent HTTP)
**Wire shape**:

```ts
export const ContextCompactCommitNotificationBodySchema = z.object({
  /** Session this commit belongs to. */
  session_uuid: z.string().uuid(),
  /** Old context version (pre-swap). */
  old_version: z.number().int().min(0),
  /** New context version (post-swap). */
  new_version: z.number().int().min(0),
  /** Ref to the committed summary (may be inline-DO or R2-ref per F08 routing). */
  summary_ref: NacpRefSchema,
  /** Snapshot id for the pre-swap context (for user rollback per PX §4.3). */
  pre_swap_snapshot_id: z.string(),
  /** Reason; informational. */
  reason: z.enum([
    "scheduled-prepare-and-commit",
    "hard-fallback-no-prepared-summary",
    "user-explicit-trigger",
    "background-llm-timeout-fallback",
  ]),
});
```

Registration:
```ts
registerMessageType("context.compact.commit.notification", ContextCompactCommitNotificationBodySchema, {
  bodyRequired: true,
  allowedProducerRoles: ["capability", "platform"],
});
```

### 2.4 Existing `context.compact.request/response` — preserved unchanged

Per 1.0.0 / 1.1.0 compat: existing `context.compact.request` + `context.compact.response` remain valid. They represent **synchronous compact** (the legacy / hard-fallback path) — NOT the prepare/commit lifecycle. Both can coexist.

---

## 3. Hook Family Extension

### 3.1 `event_name` allowed values extended to 18

`packages/nacp-core/src/messages/hook.ts` `hook.emit.event_name` field's enum allowed values:

```ts
// 1.2.0 — 18 values (8 unchanged + 4 class-B + 6 class-D; per P4 design §7)
export const HOOK_EVENT_NAMES_V1_2 = z.enum([
  // Class A — preserved 8
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PreCompact",
  "PostCompact",
  // Class B — claude-code 借鉴 4 (per P4 §4)
  "Setup",
  "Stop",
  "PermissionRequest",
  "PermissionDenied",
  // Class D — async-compact lifecycle + binding-F04 (per P4 §6 + PX §7)
  "ContextPressure",
  "ContextCompactArmed",
  "ContextCompactPrepareStarted",
  "ContextCompactCommitted",
  "ContextCompactFailed",
  "EvalSinkOverflow",
]);
```

Wire-level shape of `hook.emit` and `hook.outcome` is unchanged from 1.1.0:
```ts
// hook.emit body — unchanged structure
{ event_name: HOOK_EVENT_NAMES_V1_2, event_payload: z.unknown() }

// hook.outcome body — extended with allow/deny
export const HookOutcomeBodySchemaV1_2 = z.object({
  ok: z.boolean(),
  block: z.string().optional(),
  updated_input: z.unknown().optional(),
  additional_context: z.string().optional(),
  stop: z.string().optional(),
  diagnostics: z.array(z.unknown()).optional(),
  // 1.2.0 additions for PermissionRequest event
  allow: z.boolean().optional(),
  deny: z.string().optional(),
});
```

### 3.2 Compat shim for 1.0.0 / 1.1.0 consumers

- 1.0.0 / 1.1.0 consumers receiving `hook.emit` with new event_name (e.g. `Setup` or `ContextCompactArmed`) MAY:
  - Drop the message silently (forward-compat)
  - Forward to a generic handler
  - Log + ignore
- 1.2.0 producers MUST NOT assume 1.0.0/1.1.0 consumer understands new events; design hook handlers to be optional listeners
- `outcome` `allow` / `deny` fields are ignored by 1.0.0/1.1.0 consumers (which only know `ok` / `block` / `updated_input` / `additional_context` / `stop` / `diagnostics`)

---

## 4. Normative Spec Sections (per P5 §4 / §5 / §6)

### 4.1 §X — Anchor Header Naming (Mandatory; per binding-F02)

> All NACP cross-seam anchor headers MUST use lowercase ASCII names in all packages, documentation, and code. This conforms to RFC 7230 §3.2 case-insensitivity AND to the observed Cloudflare service binding lowercase normalization (validated in `spike-binding-pair-F02`).
>
> The 6 canonical anchor header names are:
> ```
> x-nacp-trace-uuid
> x-nacp-session-uuid
> x-nacp-team-uuid
> x-nacp-request-uuid
> x-nacp-source-uuid
> x-nacp-source-role
> ```
>
> Code constants in `packages/session-do-runtime/src/cross-seam.ts` and any consumer MUST use the lowercase form. Audit logs and inspector dumps MUST display lowercase form.
>
> A contract test MUST exist that sends a header with mixed case and asserts the receiving side observes the value at the lowercase key only.

### 4.2 §X — Eval Sink Dedup Contract (Mandatory; per binding-F04)

> NACP transport (whether fetch-based service binding, RPC handleNacp, or future transports) does NOT provide cross-message dedup. Receiving workers (sinks, inspectors, audit logs) MUST implement application-layer dedup keyed on `messageUuid` (NACP envelope field).
>
> Sink overflow (when a sink reaches its capacity) MUST emit explicit disclosure (via hook event `EvalSinkOverflow` per P4 catalog OR via metric counter accessible to inspectors). Silent drop is non-conformant.
>
> Reference implementation: `packages/eval-observability/src/inspector.ts` `SessionInspector` (post-B6 ship has dedup) and `packages/session-do-runtime/src/do/nano-session-do.ts` `defaultEvalRecords` (post-B6 ship has dedup + overflow disclosure).
>
> A contract test MUST exist that emits 3× the same `messageUuid` and asserts sink contains exactly 1.

### 4.3 §X — KV-Backed State Freshness Caveat (Informative; per F03)

> Any NACP message that conveys state read from KV-backed storage SHOULD be considered eventually consistent across colos. Same-colo read-after-write was observed strong in `spike-do-storage-F03`; cross-colo behavior is not yet validated. Until validated (B7 round 2), consumers SHOULD NOT assume strict cross-colo consistency for KV-derived state in NACP messages.
>
> If B7 round 2 reveals cross-colo stale, a future minor version may add a `freshness` enum field to relevant message bodies. This RFC reserves that future change as non-breaking addition.

---

## 5. Migration Plan

### 5.1 For producers wanting to use 1.2.0

1. Bump dependency to `nacp-core@^1.2.0`
2. Use new message kinds: `context.compact.prepare.*` + `context.compact.commit.notification`
3. May start emitting new hook events (`Setup` / `Stop` / `PermissionRequest` / `PermissionDenied` / `ContextCompactArmed` / etc.) once consumers are aware
4. Audit code for any mixed-case `X-Nacp-*` header constants — convert to lowercase

### 5.2 For consumers staying on 1.0.0 / 1.1.0

- No code change required
- New message kinds will be rejected by `validateEnvelope` since their kinds are not registered in 1.0.0/1.1.0
- New hook event_name values will pass through `hook.emit` (since `event_name` is `string` at 1.0.0/1.1.0) but consumer may not have a registered handler — graceful no-op

### 5.3 Compat shim implementation

`packages/nacp-core/src/compat/` adds:
- `1.0.0-compat.ts` — preserved (existing)
- `1.1.0-compat.ts` — NEW (shim that strips 1.2.0-only fields when downgrading messages for 1.1.0 consumers)

---

## 6. Out of Scope

- nacp-session 1.2.0 specific kinds → sibling `nacp-session-1-2-0.md` RFC
- RPC handleNacp transport changes → out of B1 round 1 scope (per `binding-findings.md` §0)
- Cross-region message routing → after worker matrix
- WebSocket sub-protocol → unchanged from 1.1.0

---

## 7. Acceptance Criteria

- [ ] 2 new context.compact.* kinds registered in `nacp-core/src/messages/context.ts`
- [ ] `hook.emit` `event_name` enum extended to 18 values
- [ ] `hook.outcome` extended with `allow?` / `deny?` fields
- [ ] `1.0.0-compat.ts` test suite still passes
- [ ] `1.1.0-compat.ts` shim shipped + test suite passes
- [ ] §4.1 lowercase header contract test added (mandatory)
- [ ] §4.2 dedup contract test added (depends on B6 SessionInspector ship)
- [ ] CHANGELOG entry written
- [ ] Round 2 integrated spike (B7) re-runs cross-worker NACP message exchange with new families
- [ ] Audit `grep -rn "X-Nacp\\|X-NACP" packages/` returns 0 mixed-case usages

---

## 8. References

- Sibling RFC (session profile): `docs/rfc/nacp-session-1-2-0.md`
- Sibling design: `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md`
- Charter §6 Phase 5 + §11.2: `docs/plan-after-foundations.md`
- PX spec §8: `docs/design/after-foundations/PX-async-compact-lifecycle-spec.md`
- P3-async-compact (producer reality): `docs/design/after-foundations/P3-context-management-async-compact.md`
- P3-inspector (independent HTTP confirmation): `docs/design/after-foundations/P3-context-management-inspector.md` §6.3
- P4 hooks catalog (event_name allowed values 18): `docs/design/after-foundations/P4-hooks-catalog-expansion.md`
- B1 binding rollup: `docs/spikes/binding-findings.md`
- B6 writeback issue: `docs/issue/after-foundations/B6-writeback-eval-sink-dedup.md`
- Tracking policy: `docs/issue/README.md`

---

## 9. Revision History

| Date | Author | Change |
|---|---|---|
| 2026-04-19 | Opus 4.7 | Initial draft; 2 frozen context.compact.* kinds (reverse-derived from PX §8 + P3-async-compact); hook event_name 8→18 + allow/deny; 3 normative spec sections (lowercase / dedup / freshness); 1.0.0 + 1.1.0 compat preserved |
