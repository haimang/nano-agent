# RFC: `nacp-session` 1.2.0 — Minimal-or-Zero Extension (per Phase 3 reality)

> **RFC ID**: `nacp-session-1-2-0`
> **Status**: `draft` (becomes `frozen` on B6 ship; **may freeze with NO new kinds**)
> **Author**: Opus 4.7 (1M context)
> **Date**: 2026-04-19
> **Sibling RFC**: `docs/rfc/nacp-core-1-2-0.md`
> **Sibling design**: `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md`
>
> **B1 finding sources (backward traceability)**:
> - `docs/spikes/spike-binding-pair/02-anchor-headers-survive-but-lowercased.md` (binding-F02 — header lowercase contract; cross-references nacp-core RFC §4.1)
> - `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md` (binding-F04 — sink dedup contract; cross-references nacp-core RFC §4.2)
> - `docs/spikes/binding-findings.md` (rollup §3 — writeback to NACP spec)
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` §B6
>
> **Related design / spec dependencies**:
> - `docs/design/after-foundations/PX-async-compact-lifecycle-spec.md` §8 (NACP-eligibility canonical — inspector NOT via NACP)
> - `docs/design/after-foundations/P3-context-management-inspector.md` §6.3 (inspector goes via independent HTTP/WS; **dismisses** `session.context.usage.snapshot`)
> - `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md` §3.3 + §8.3 (反推 evaluation; nacp-session likely 0 new families)
>
> **Charter normative**:
> - `docs/plan-after-foundations.md` §4.1 F (don't pre-freeze; reverse-derive)
> - `docs/plan-after-foundations.md` §11.2 (semver bump is secondary outcome; nacp-session may stay at 1.1.0)

---

## 0. Summary

After applying P5 §3 reverse-derivation methodology + PX spec §8 NACP-eligibility decision tree to **all candidate session-profile message kinds**, **0 new families warrant promotion in 1.2.0**. The existing 8 session message kinds (1.1.0 baseline) cover all observed Phase 3 reality.

**Recommended outcome**: `nacp-session` **stays at 1.1.0** (no semver bump). Per charter §11.2, this is an acceptable B6 exit state — semver bump is secondary outcome, not the primary success marker.

**If the consensus reviewer prefers a 1.2.0 cosmetic bump** (to align nacp-core 1.2.0 + nacp-session 1.2.0 version numbers for documentation hygiene), §3.4 lists the no-op upgrade path: spec-only normative cross-reference to `nacp-core-1-2-0.md`, no schema changes.

---

## 1. Versioning Decision

| Aspect | 1.1.0 (current) | Recommended action |
|---|---|---|
| Frozen baseline | yes | **stay at 1.1.0** (no bump) |
| 1.0.0 compat shim | yes | preserved |
| 1.1.0 compat shim | (n/a) | n/a (1.1.0 IS the baseline) |
| Message kinds | 8 (session.start / resume / cancel / end / stream.ack / heartbeat / followup_input + stream.event 9-kinds in profile) | unchanged |
| Spec normative additions | — | optional cosmetic 1.2.0 bump documents lowercase header + dedup cross-reference; no schema change |

> **Why stay at 1.1.0**: charter §11.2 explicitly says "如果某 lifecycle stage 只需要 hook event + inspector facade 即可，就不要塞进 NACP." Inspector facade per P3-inspector §6.3 goes via **independent HTTP/WS** route, not NACP envelope — so no `session.context.*` family is justified. Other candidates (cross-worker session sync) have NO Phase 3 producer reality. Per P5 §3.4 4-condition decision tree, no candidate satisfies all 4 conditions.

---

## 2. Existing 8 Session Message Kinds (1.1.0 baseline, preserved)

For reference (no changes proposed):

| Kind | Direction | Producer | Consumer | Purpose |
|---|---|---|---|---|
| `session.start` | client → DO | client | session DO | initiate session with cwd / initial context / initial input |
| `session.resume` | client → DO | client | session DO | reconnect; specify last_seen_seq for replay |
| `session.cancel` | client → DO | client | session DO | abort current operation with reason |
| `session.end` | DO → client | session DO | client | finalize; carry usage_summary |
| `session.stream.ack` | client → DO | client | session DO | acknowledge stream event delivery |
| `session.heartbeat` | bidirectional | either | either | liveness signal |
| `session.followup_input` | client → DO | client | session DO | multi-round input (Phase 0 widening) |
| `session.stream.event` (sub-profile, 9 canonical kinds) | DO → client | session DO | client | live event stream (consumed by SessionInspector) |

All preserved unchanged. No deprecation, no field additions, no enum extensions.

---

## 3. Reverse-Derivation Evaluation (per P5 §3 decision tree)

### 3.1 Candidate: `session.context.usage.snapshot` (originally proposed in Opus v2 §6.4)

| Condition | Answer | Detail |
|---|---|---|
| Cross-worker? | YES (inspector → session DO) | OK |
| Envelope-level validation needed? | **NO** | inspector facade goes via **independent HTTP/WS** route (per P3-inspector §6.3 + GPT review §2.3); no NACP envelope involved |
| → Decision | **DISMISSED** | inspector handles directly via `/inspect/sessions/:id/context/usage` HTTP endpoint; no NACP message needed |

### 3.2 Candidate: `session.context.committed` (originally proposed in Opus v2 §8.3.2)

| Condition | Answer | Detail |
|---|---|---|
| Cross-worker? | YES | session DO → external observer |
| Envelope-level validation? | YES | tenancy / sessionUuid scoping |
| Phase 3 (B4) producer reality? | NO | async-compact `committer.ts` emits `ContextCompactCommitted` **hook event** (P4 catalog class D); no separate session-level message needed; cross-worker observers already see the hook event via cross-worker hook dispatch (binding-F03 viability) |
| → Decision | **DISMISSED** | redundant with hook event; Opus v2 originally proposed but P4 catalog covers it |

### 3.3 Candidate: `session.workspace.diverged` (originally proposed in Opus v2 §8.3.2)

| Condition | Answer | Detail |
|---|---|---|
| Cross-worker? | YES (would be: filesystem.core → agent.core) | OK |
| Envelope-level validation? | YES | OK |
| Phase 3 (B4) producer reality? | **NO** | filesystem.core does NOT exist as separate worker in current scope; `WorkspaceNamespace` is intra-package; no producer until worker matrix phase |
| → Decision | **DEFERRED** | revisit when worker matrix phase actually splits filesystem.core; not a 1.2.0 concern |

### 3.4 Candidate: `session.cancel.acknowledged` (extension of existing session.cancel)

| Condition | Answer | Detail |
|---|---|---|
| Cross-worker? | NO | client ↔ session DO is single hop already |
| → Decision | **DISMISSED** | existing session.cancel + session.heartbeat / session.stream.event covers acknowledgment |

### 3.5 Cross-worker session-state sync candidates

Various potential candidates exist for cross-worker session-state sync (e.g., when context.core wants to inform agent.core that session metadata changed). All evaluated:

| Candidate | Producer reality? | Decision |
|---|---|---|
| `session.metadata.invalidated` | NO (metadata changes go through DO storage transaction; readers query directly) | DISMISSED |
| `session.policy.updated` | NO (per-session policy via inspector POST; no cross-worker push) | DISMISSED |
| `session.snapshot.captured` | NO (snapshot is intra-worker action; no cross-worker push) | DISMISSED |

### 3.6 Final tally

**0 candidates promoted.** All evaluated candidates are dismissed (4) or deferred (1). Conclusion: no `session.*` family extension warranted in 1.2.0.

---

## 4. Two Outcomes for B6 Reviewer

### 4.1 Outcome A (recommended): stay at 1.1.0

- `nacp-session` package version unchanged: `1.1.0`
- No schema changes
- No CHANGELOG entry needed beyond a note pointing to this RFC
- Per charter §11.2 explicit allowance

### 4.2 Outcome B (cosmetic): bump to 1.2.0 with no schema changes

If the B6 reviewer prefers `nacp-core` 1.2.0 + `nacp-session` 1.2.0 to share a version number for documentation hygiene:

- `nacp-session` package version → `1.2.0`
- 1.1.0 compat shim added (trivial: pass-through, since no schema delta)
- CHANGELOG entry: "1.2.0 — version-only bump to align with nacp-core 1.2.0; no schema changes; lowercase header + sink dedup spec sections cross-referenced from nacp-core 1.2.0 §4.1 / §4.2"
- Spec body adds `§X — Cross-Reference to NACP Core 1.2.0` with normative pointers to:
  - `nacp-core-1-2-0.md` §4.1 (lowercase headers — applies to session profile too)
  - `nacp-core-1-2-0.md` §4.2 (sink dedup — applies to `session.stream.event` consumers)
  - `nacp-core-1-2-0.md` §4.3 (KV freshness caveat — informative)

**This RFC defers the choice between Outcome A and B to B6 reviewer**. Both are acceptable per charter §11.2.

---

## 5. Migration Plan

### 5.1 Outcome A migration: none

- Existing 1.0.0 / 1.1.0 consumers continue working
- No code change required anywhere

### 5.2 Outcome B migration: trivial

- Bump `packages/nacp-session/package.json` version to `1.2.0`
- Add `packages/nacp-session/src/compat/1.1.0-compat.ts` as pass-through shim
- Update README to reference cross-RFC normative sections
- Spec test: verify 1.1.0 consumers still work end-to-end

---

## 6. Cross-Reference Spec Sections (applies regardless of A or B)

> Even if Outcome A is chosen and the package stays at 1.1.0, the following normative behaviors **already apply to nacp-session profile** because they are HTTP-level / sink-level concerns inherited from `nacp-core`:

### 6.1 Anchor header lowercase (per nacp-core 1.2.0 §4.1)

WebSocket frames in the session profile carry NACP envelopes. When the WebSocket upgrade request is itself a HTTP request, the `x-nacp-*` anchor headers MUST be lowercase per the cross-seam contract. This applies to:
- `WsController.handleUpgrade` in `session-do-runtime`
- Any service binding that re-invokes a session DO via fetch

### 6.2 Sink dedup (per nacp-core 1.2.0 §4.2)

`session.stream.event` consumers (most notably `SessionInspector` at `packages/eval-observability/src/inspector.ts:78`) MUST dedup by `messageUuid`. The `session.stream.event` body schema's `message_uuid` field (existing in 1.1.0) is the dedup key.

### 6.3 KV freshness caveat (per nacp-core 1.2.0 §4.3)

If session-level state read from KV-backed storage appears in a `session.stream.event` payload (e.g., session metadata fragments), consumers should treat such state as eventually consistent across colos until B7 round 2 validation.

---

## 7. Out of Scope

- Anything in `nacp-core-1-2-0.md` (sibling RFC handles core extensions)
- Worker matrix phase changes to session profile (deferred to that phase)
- WebSocket sub-protocol versioning (unchanged from 1.1.0)
- RPC handleNacp transport (out of scope per `binding-findings.md` §0)
- New session-level capability message kinds (no Phase 3 producer reality)

---

## 8. Acceptance Criteria

### 8.1 Outcome A acceptance

- [ ] B6 reviewer confirms stay at 1.1.0
- [ ] No code changes
- [ ] CHANGELOG note pointing to this RFC's "no extension warranted" conclusion

### 8.2 Outcome B acceptance (alternative)

- [ ] B6 reviewer confirms cosmetic bump to 1.2.0
- [ ] `package.json` version bumped to 1.2.0
- [ ] `1.1.0-compat.ts` pass-through shim added
- [ ] CHANGELOG entry as in §4.2
- [ ] Cross-reference spec sections (per §6) added to nacp-session README or spec doc
- [ ] 1.1.0 consumer compat test green

### 8.3 Common acceptance (regardless of A or B)

- [ ] §6.1 (lowercase header) holds in `WsController` / WS upgrade path — contract test added
- [ ] §6.2 (sink dedup) confirmed via `SessionInspector` post-B6 ship — depends on B6 issue
- [ ] §6.3 (freshness caveat) documented in package README

---

## 9. Why "0 new families" is the right answer

This RFC's seemingly-empty schema-change result is itself a **load-bearing finding**. It validates that:

1. **PX spec §8 was correct** to canonically scope NACP eligibility narrowly
2. **Charter §4.1 F + GPT review §2.6 修订** was correct to forbid pre-freezing message families
3. **P3-inspector independent HTTP decision** cleanly removes 1 candidate family
4. **P4 hooks catalog 18 events** absorbs lifecycle observability that earlier eval drafts had over-eagerly assigned to NACP

If a future phase actually needs new session message kinds, this RFC's per-candidate evaluation framework (§3) is the template — apply the 4-condition decision tree, not eyeball intuition.

---

## 10. References

- Sibling RFC (core extensions): `docs/rfc/nacp-core-1-2-0.md`
- Sibling design: `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md`
- Charter §6 Phase 5 + §11.2: `docs/plan-after-foundations.md`
- PX spec §8 (NACP-eligibility canonical): `docs/design/after-foundations/PX-async-compact-lifecycle-spec.md`
- P3-inspector §6.3 (inspector NOT via NACP): `docs/design/after-foundations/P3-context-management-inspector.md`
- B1 binding rollup: `docs/spikes/binding-findings.md`
- Existing 8 message kinds source: `packages/nacp-session/src/messages.ts`
- Tracking policy: `docs/issue/README.md`

---

## 11. Revision History

| Date | Author | Change |
|---|---|---|
| 2026-04-19 | Opus 4.7 | Initial draft; reverse-derivation evaluates 5 candidates → 4 dismissed + 1 deferred → 0 frozen; recommends stay-at-1.1.0 (Outcome A) with cosmetic-bump alternative (Outcome B); cross-references nacp-core 1.2.0 normative sections that apply regardless |
