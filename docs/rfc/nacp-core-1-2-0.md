# RFC: `nacp-core` 1.2.0 — No-Schema-Delta (stay at 1.1.0 per B6 reverse-derivation)

> **RFC ID**: `nacp-core-1-2-0`
> **Status**: `frozen` (B6 ship, 2026-04-20)
> **Author**: Opus 4.7 (1M context) — initial draft by Opus 4.7, reconciled by Opus 4.7 during B6 implementation
> **Date**: 2026-04-19 (initial draft) / 2026-04-20 (B6 reconciliation)
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
> - `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md` §3 (反推 methodology)

---

## 0. Summary (B6-reconciled)

Per charter §4.1 F and P5 §3 reverse-derivation methodology, this RFC
**recommends `nacp-core` stay at `1.1.0`** because every protocol delta
originally proposed in the 2026-04-19 draft fails the 4-condition
decision tree when re-checked against B2 / B3 / B4 / B5 ship code:

| Originally proposed | B6 reality check | Outcome |
|---|---|---|
| Add `context.compact.prepare.request` / `.response` / `commit.notification` | B4 ships `AsyncCompactOrchestrator` **in-process** inside `session-do-runtime` (per B4 §11.4.4: "B4 inspector facade **不**需要 NACP message family"). No cross-worker producer / consumer exists until worker matrix phase. | **DEFERRED to worker matrix** |
| Extend `hook.emit.event_name` to `z.enum([...18])` | `@nano-agent/hooks` is the source-of-truth for the 18-event catalog (B5 landed). Hoisting the enum into `nacp-core` would make `nacp-core` a reverse-dependency of `hooks` and would break the invariant that `event_name` is generic at the envelope layer. | **DROPPED** |
| Add `allow? / deny?` to `hook.outcome` body | Per B5 §2.3 override of P4 §8.5: permission verdict rides on existing `continue` (= allow) / `block` (= deny) actions; zero handlers ⇒ fail-closed deny. `hooks/src/permission.ts::verdictOf()` compiles the P4 vocabulary away without touching the wire. | **DROPPED** |

**Net result**: `nacp-core` carries **0 new message kinds** and **0 schema
changes** in 1.2.0. Per charter §11.2, the package may legitimately stay
at `1.1.0` — semver bump is a secondary outcome, not a primary success
marker. The normative spec material this RFC surfaces (lowercase header /
sink dedup contract / KV freshness caveat) is **behavior-of-current-baseline**
commentary and does not require a version bump.

**Recommended outcome**: **stay at `1.1.0`**. The 3 normative spec
sections in §4 apply to 1.1.0 as already-observed behavior. They are
documented here so B7 integrated spike has a single place to point at
when verifying conformance.

---

## 1. Versioning Decision

| Aspect | 1.1.0 (current & recommended) |
|---|---|
| Frozen baseline | yes |
| 1.0.0 compat shim | yes (unchanged) |
| Message families | 5 (tool / hook / skill / context / system) |
| Total message kinds | 12 (unchanged) |
| Hook event_name shape | `z.string().min(1).max(64)` (unchanged; catalog lives in `@nano-agent/hooks`) |
| Hook outcome fields | `ok`, `block?`, `updated_input?`, `additional_context?`, `stop?`, `diagnostics?` (unchanged) |
| Package version | `@nano-agent/nacp-core@1.1.0` — **no bump** |

---

## 2. Deferred candidates (no-op in this RFC)

### 2.1 `context.compact.prepare.*` / `context.compact.commit.notification` — DEFERRED

- **Why deferred**: B4 ships an in-process `AsyncCompactOrchestrator`.
  `session-do-runtime` calls its methods directly through
  `createKernelCompactDelegate`. There is no cross-worker boundary for
  the prepare / commit path, so envelope-level validation is not needed.
- **When to revisit**: worker matrix phase (post-B8). When `context.core`
  is split into a separate worker that `agent.core` calls via
  cross-worker binding, reverse-derive these kinds again; the
  per-candidate decision tree in `P5-nacp-1-2-0-upgrade.md §3.4`
  applies.
- **Legacy path preserved**: `context.compact.request` /
  `context.compact.response` (existing 1.0.0 baseline) remain
  registered. They serve the synchronous / hard-fallback path and do
  **not** need to be deprecated.

### 2.2 Hook `event_name` enum hoist — DROPPED

- **Why dropped**: hoisting would reverse the dependency direction
  (`nacp-core` would need `@nano-agent/hooks` to know the 18-event
  catalog). `@nano-agent/hooks` is the SOT; the envelope-layer
  validation correctly treats `event_name` as an opaque string within
  the 1-64 char bound.
- **What this means for consumers**: the current schema
  `z.string().min(1).max(64)` **already accepts all 18 v2 events**
  (longest is `ContextCompactPrepareStarted` at 29 chars). No consumer
  change needed.

### 2.3 `allow / deny` hook outcome wire fields — DROPPED

- **Why dropped**: per B5 action-plan §2.3, the B5 implementer
  shipped `verdictOf()` / `denyReason()` as package-local helpers that
  compile P4's `allow / deny` vocabulary down to existing wire fields.
  There is no wire-level user of the new fields; adding them would be
  dead schema.
- **Migration path if ever needed**: if a future phase (e.g. a separate
  permission-adjudication worker) needs to transport `allow / deny`
  semantics distinctly from `continue / block`, a 1.3.0 RFC can revisit
  this. The B5 `permission.ts` helper would be updated to read the new
  fields first and fall back to the current action translation.

---

## 3. What actually DID change in Phase 3 (B4) without touching nacp-core

Listed here so B6 readers can see the producer reality without being
misled into thinking protocol-layer changes shipped:

1. `@nano-agent/context-management` (B4) shipped `AsyncCompactOrchestrator`
   + `bridgeToHookDispatcher` + `COMPACT_LIFECYCLE_EVENT_NAMES`. All
   intra-process; no envelope crossing.
2. `@nano-agent/hooks` (B5) shipped the 18-event catalog, the permission
   verdict helpers, and companion producer seams in
   `session-do-runtime` / `capability-runtime` / `context-management`.
   All catalog knowledge lives inside `@nano-agent/hooks`.
3. `@nano-agent/eval-observability` (B6 — this phase) gains an optional
   `messageUuid` meta on `SessionInspector.onStreamEvent()` + new
   `onSessionFrame()` helper + `getDedupStats()`. This is a **consumer**
   change, not a protocol change — the `messageUuid` comes from the
   NACP envelope header, which has always carried it.
4. `@nano-agent/session-do-runtime` (B6 — this phase) upgrades
   `defaultEvalRecords` to a bounded sink with overflow disclosure. No
   protocol change.

---

## 4. Normative Spec Sections (behavior-of-1.1.0 commentary)

> The sections below are **clarifications**, not new normative
> requirements. They describe behavior that 1.1.0 already exhibits but
> that was under-documented. They are documented here so B7 integrated
> spike can verify conformance without chasing source comments.

### 4.1 §X — Anchor Header Naming (Normative, per binding-F02)

All NACP cross-seam anchor headers MUST use lowercase ASCII names. This
conforms to RFC 7230 §3.2 case-insensitivity AND to the observed
Cloudflare service-binding lowercase normalization validated in
`spike-binding-pair-F02`.

Canonical anchor header names (defined by
`packages/session-do-runtime/src/cross-seam.ts::CROSS_SEAM_HEADERS`):

```
x-nacp-trace-uuid
x-nacp-session-uuid
x-nacp-team-uuid
x-nacp-request-uuid
x-nacp-source-role
x-nacp-source-key
x-nacp-deadline-ms
```

Code constants and any downstream consumer MUST use the lowercase form.
A contract test MUST exist that stamps a header with mixed case and
asserts the receiving side reads the value at the lowercase key only.
See `packages/session-do-runtime/test/cross-seam.test.ts`.

### 4.2 §X — Eval Sink Dedup Contract (Normative, per binding-F04)

NACP transport (whether fetch-based service binding, RPC `handleNacp()`,
or future transports) does **not** provide cross-message dedup. Receiving
workers (sinks, inspectors, audit logs) MUST implement application-layer
dedup keyed on `messageUuid` from the NACP envelope `header` field.

The **dedup key source is the envelope header**, not any message body.
`session.stream.event` body schema is unchanged and does NOT carry
`message_uuid`. Consumers extract the dedup key from the session frame
header and pass it to the sink / inspector.

Sink overflow (when a sink reaches its capacity) MUST emit explicit
disclosure (via overflow counter accessible to inspectors, and
OPTIONALLY via hook event `EvalSinkOverflow` per P4 catalog). Silent
drop is non-conformant.

Reference implementations shipped in B6:
- `packages/eval-observability/src/inspector.ts::SessionInspector` —
  optional `meta.messageUuid` on `onStreamEvent()` enables hard dedup;
  `onSessionFrame(frame)` extracts the header automatically.
- `packages/session-do-runtime/src/do/nano-session-do.ts::defaultEvalRecords`
  — bounded FIFO sink with overflow counter, disclosure ring buffer, and
  (optional) `EvalSinkOverflow` hook emission through an injected seam.

A contract test MUST exist that emits 3× the same `messageUuid` and
asserts the sink contains exactly 1.

### 4.3 §X — KV-Backed State Freshness Caveat (Informative, per F03)

Any NACP message that conveys state read from KV-backed storage SHOULD
be considered eventually consistent across colos. Same-colo
read-after-write was observed strong in `spike-do-storage-F03`;
cross-colo behavior is not yet validated. Until validated (B7 round 2),
consumers SHOULD NOT assume strict cross-colo consistency for
KV-derived state in NACP messages.

If B7 round 2 reveals cross-colo stale, a future minor version MAY add
a `freshness` enum field to relevant message bodies. This RFC reserves
that future change as non-breaking addition.

---

## 5. Migration Plan

### 5.1 For producers and consumers

No migration required. `nacp-core@1.1.0` ships unchanged. All currently
emitted messages — existing and new hook event names — already parse
under 1.1.0 schemas.

### 5.2 Documentation migration

- `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md` — backfill
  with the B6 reverse-derivation outcome (all candidates dismissed or
  deferred) if / when that design doc is revisited.
- `docs/rfc/nacp-session-1-2-0.md` — its Outcome A recommendation is
  now the explicit choice (see §4.1 of that RFC).

---

## 6. Out of Scope

- Worker matrix cross-worker message families → revisit post-B8
- RPC `handleNacp()` transport changes → deferred per
  `binding-findings.md` §0
- Cross-region message routing → after worker matrix
- WebSocket sub-protocol → unchanged from 1.1.0

---

## 7. Acceptance Criteria (B6 closure)

- [x] P5 design's 2 proposed message families are re-evaluated against
      B4 producer reality; conclusion recorded here
- [x] `hook.emit` / `hook.outcome` remain unchanged
- [x] §4.1 lowercase header contract observable in
      `packages/session-do-runtime/test/cross-seam.test.ts`
- [x] §4.2 dedup contract observable in
      `packages/eval-observability/test/inspector-dedup.test.ts` (B6)
      + `packages/session-do-runtime/test/do/nano-session-do.test.ts` (B6)
- [x] `@nano-agent/nacp-core@1.1.0` test suite still passes (no
      schema change → automatic)

---

## 8. References

- Sibling RFC (session profile): `docs/rfc/nacp-session-1-2-0.md`
- Sibling design: `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md`
- Charter §6 Phase 5 + §11.2: `docs/plan-after-foundations.md`
- PX spec §8: `docs/design/after-foundations/PX-async-compact-lifecycle-spec.md`
- P3-async-compact (producer reality): `docs/design/after-foundations/P3-context-management-async-compact.md`
- P3-inspector (independent HTTP confirmation): `docs/design/after-foundations/P3-context-management-inspector.md` §6.3
- P4 hooks catalog: `docs/design/after-foundations/P4-hooks-catalog-expansion.md`
- B1 binding rollup: `docs/spikes/binding-findings.md`
- B4 action-plan (in-process AsyncCompactOrchestrator): `docs/action-plan/after-foundations/B4-context-management-package-async-core.md`
- B5 action-plan (permission verdict compile-away + hook catalog SOT): `docs/action-plan/after-foundations/B5-hooks-catalog-expansion-1-0-0.md`
- B6 writeback issue: `docs/issue/after-foundations/B6-writeback-eval-sink-dedup.md`
- Tracking policy: `docs/issue/README.md`

---

## 9. Revision History

| Date | Author | Change |
|---|---|---|
| 2026-04-19 | Opus 4.7 | Initial draft; proposed 2 `context.compact.*` kinds + hook enum hoist + `allow/deny` outcome additions |
| 2026-04-20 | Opus 4.7 (1M context) | B6 reconciliation: reverse-derived every draft proposal against B4/B5 ship code → all dropped / deferred. Net: `nacp-core` stays at 1.1.0 (0 schema deltas). Normative §4 sections preserved as 1.1.0-behavior commentary |
