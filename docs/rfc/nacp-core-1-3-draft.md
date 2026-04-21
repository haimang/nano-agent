# RFC — NACP-Core 1.3 / NACP-Session 1.3 / Session-DO-Runtime 0.3

> Status: `owner-approved` (executed 2026-04-21)
> Author: Claude Opus 4.7 (1M context)
> Driver: `docs/action-plan/after-foundations/B9-nacp-1-3-contract-freeze.md` (rewritten 2026-04-21 per GPT review)
> Consumes: `docs/eval/after-foundations/smind-contexter-learnings.md` §9.5.2 + §9.7.2, `docs/code-review/after-foundations/B9-plan-reviewed-by-GPT.md`
> Supersedes: `docs/rfc/nacp-core-1-2-0.md` (B6 frozen / no-delta; see §8 for version jump)

---

## 1. Background

After-foundations Phase B1-B8 established the protocol/runtime substrate and worker-matrix handoff pack. Two review cycles (B8 Opus review R1/R2/R3 + B9 GPT review R1–R5) identified three **already-agreed but not-yet-materialized** consensuses which would otherwise leak into the worker matrix as known tech debt:

1. **NACP envelope legality** — `message_type` and `delivery_kind` are both declared in `NacpHeaderSchema`, but no validator enforces the `(type × delivery)` combination legality. Current `validateEnvelope()` stops at 5 layers (structural / registry / version / body / role). Independently, session profile goes through `validateSessionFrame()` — **not** `validateEnvelope()` — so any core-side matrix does not cover session.
2. **Error body convergence** — `system.error` uses the full `NacpErrorSchema`, while `tool.call.response` / `context.compact.response` / `skill.invoke.response` use `{status: "ok"|"error", error?: {code, message}}`. A standard, orthogonal error body shape exists nowhere.
3. **Tenant plumbing materialization** — `verifyTenantBoundary` + `tenantDoStorage*` were shipped in B6 inside `@nano-agent/nacp-core`, but `@nano-agent/session-do-runtime` has **zero call sites**. Similarly, `SessionStartBodySchema.initial_context` is shipped but typed as `z.record(z.string(), z.unknown())` — effectively unconstrained.

This RFC freezes what today's code can honestly freeze, and **explicitly defers** the parts that either require an owner-driven PR (response shape migration) or that touch architecture not yet in-tree (orchestrator.* namespace, context.core subsystem).

### 1.1 What this RFC is not

- Not a rewrite of the v1 protocol surface.
- Not a breaking change. All v1.1 consumer code continues to work without modification.
- Not a rename or canonicalization pass. Today's verb names (`hook.emit`, `hook.outcome`, `tool.call.request`, `context.compact.*`) already follow the `<namespace>.<verb>` law.
- Not an alias-registry shipment. There is no legacy string that needs aliasing at runtime today.

---

## 2. Normative Scope — Section C: `(message_type × delivery_kind)` matrix

### 2.1 Core matrix

Introduce `NACP_CORE_TYPE_DIRECTION_MATRIX: Record<string, Set<NacpDeliveryKind>>` in `packages/nacp-core/src/type-direction-matrix.ts`. The matrix covers the **11 core-registered types**:

| message_type | legal `delivery_kind` values |
|---|---|
| `tool.call.request` | `command` |
| `tool.call.response` | `response`, `error` |
| `tool.call.cancel` | `command` |
| `hook.emit` | `event` |
| `hook.outcome` | `event`, `response` |
| `skill.invoke.request` | `command` |
| `skill.invoke.response` | `response`, `error` |
| `context.compact.request` | `command` |
| `context.compact.response` | `response`, `error` |
| `system.error` | `error` |
| `audit.record` | `event` |

### 2.2 Session matrix

Introduce `NACP_SESSION_TYPE_DIRECTION_MATRIX` in `packages/nacp-session/src/type-direction-matrix.ts`. This is **owned by the session profile**, not derived from core. Covers 8 session types:

| message_type | legal `delivery_kind` values |
|---|---|
| `session.start` | `command` |
| `session.resume` | `command` |
| `session.cancel` | `command` |
| `session.end` | `event` |
| `session.stream.event` | `event` |
| `session.stream.ack` | `response`, `event` |
| `session.heartbeat` | `event` |
| `session.followup_input` | `command` |

### 2.3 Consumption rule

- `validateEnvelope()` (nacp-core) adds Layer 6: if `env.header.message_type ∈ NACP_CORE_TYPE_DIRECTION_MATRIX`, assert `delivery_kind ∈ matrix[type]`. Non-members (e.g. session types entering core via cross-package paths) **skip** this layer (fail-open for unknown, fail-closed for known).
- `validateSessionFrame()` (nacp-session) adds a matrix check after `validateSessionMessageType()`: if `frame.header.message_type ∈ NACP_SESSION_TYPE_DIRECTION_MATRIX`, assert `delivery_kind ∈ matrix[type]`.
- Two new error codes:
  - `NACP_TYPE_DIRECTION_MISMATCH` (nacp-core) — reported through `NacpValidationError`
  - `NACP_SESSION_TYPE_DIRECTION_MISMATCH` (nacp-session) — reported through `NacpSessionError`

### 2.4 Conservative first-publish rule

Any `(type, delivery_kind)` combination that appears in a shipped test fixture or a shipped source path must be **legal** in the initial matrix. Narrowing is a later, opt-in concern.

---

## 3. Normative Scope — Section D (narrowed): Standard error body schema + **provisional** helper

### 3.1 What ships

- `NacpErrorBodySchema` (Zod) in `packages/nacp-core/src/error-body.ts`:
  ```ts
  z.object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(2048),
    retriable: z.boolean().optional(),
    cause: z.object({
      code: z.string().optional(),
      message: z.string().optional(),
    }).optional(),
  })
  ```
- `NACP_ERROR_BODY_VERBS: ReadonlySet<string>` — registry of message_types that have adopted `NacpErrorBodySchema` as their body schema. **Empty at B9**; populated by the migration PR (§3.3).
- `wrapAsError(source, err, overrides)` — **provisional** helper. Produces an envelope with `delivery_kind: "error"` and `body` = `NacpErrorBodySchema`, with an optional `overrides.target_message_type` that overrides the source's `message_type`. **The helper does NOT validate its own output**, and its output will FAIL `validateEnvelope()` under the current 1.3 surface for every shipped verb — because no shipped verb has adopted `NacpErrorBodySchema` as its body yet. This is intentional. The helper becomes usable in production only after (a) a new verb registers in `NACP_ERROR_BODY_VERBS` with `NacpErrorBodySchema` as its body schema AND matrix entry permits `delivery_kind: "error"`, OR (b) the per-verb migration PR (§3.3) lands.

### 3.1.1 Consumer guidance (B9-R2 integration)

| usage | supported at B9? | rationale |
|---|---|---|
| parse a `NacpErrorBodySchema` payload | ✅ yes | schema is shipped and final |
| produce a test fixture / doc example via `wrapAsError` | ✅ yes | helper is stable for illustration |
| produce a new-worker-matrix-era verb's error response via `wrapAsError` + that verb registered in `NACP_ERROR_BODY_VERBS` | ✅ yes | target case; `validateEnvelope()` will pass |
| wrap an existing `tool.call.request` / `context.compact.request` / `skill.invoke.request` and expect `validateEnvelope()` to pass | ❌ no | existing response pair still uses `{status, error?}`; wait for §3.3 migration PR |

### 3.2 What does **not** ship in B9

Per GPT-R2, the migration of `tool.call.response` / `context.compact.response` / `skill.invoke.response` from `{status: "ok"|"error", error?: {code, message}}` to `NacpErrorBodySchema` is **out-of-scope** for B9 and will be scheduled as a separate, owner-approved PR. Rationale:

1. The migration requires touching every `status`-dispatching consumer in the eval pipeline, `SessionInspector`, `BoundedEvalSink`, and test fixtures.
2. B9's purpose is to freeze contract surface before worker matrix, not to retrofit existing verbs.
3. The helper + spec being shipped here is sufficient for new worker-matrix-era verbs to adopt the standard shape immediately.

### 3.3 Future convergence plan (non-binding)

When the separate PR lands, it will:

- Add `error: NacpErrorBodySchema.optional()` to `tool.call.response` / `context.compact.response` / `skill.invoke.response` alongside the existing `{status, error?}` shape for one minor version.
- In the subsequent minor version, drop the old shape.
- `system.error` continues to use `NacpErrorSchema` (per `error-registry.ts`) as the top-level error envelope; `NacpErrorBodySchema` is **for per-verb response bodies**, not a replacement of the system-level error taxonomy.

---

## 4. Normative Scope — Section E (narrowed): Verb naming law

### 4.1 RFC-level law

All new canonical verbs MUST obey `<namespace>.<verb>` two-part structure. `<namespace>` matches `[a-z][a-z0-9-]*` and contains no dot. `<verb>` matches `[a-z][a-z0-9_.-]*` and MAY contain one additional dot (e.g. `tool.call.request` uses `<namespace>.<verb>` with `<verb> = call.request`). Direction is expressed exclusively through `delivery_kind`, not through suffixes.

### 4.2 Today's baseline compliance

All 11 core-registered verbs and all 8 session-registered verbs already comply. No renames are required.

### 4.3 What does **not** ship in B9

Per GPT-R2, a `LEGACY_ALIAS_REGISTRY` **runtime machinery** is not shipped. Justification:

- The learnings-doc §9.5.2 example (`tool.call.result`, `hook.broadcast`, `hook.return`) referenced a pre-B4 naming draft. Those strings do not exist in the current registry.
- Every shipped verb is already canonical.
- Shipping an unused alias-resolution layer would add a runtime surface that no consumer exercises — violating "don't design for hypothetical future requirements."

If a future phase introduces a new canonical verb *and* an older alias, an alias registry can be added at that time under a new RFC section. The naming law itself is stable from B9 onward.

---

## 5. Normative Scope — Section F-new: `delivery_kind` semantic spec

The 4 values of `NacpDeliveryKind` have the following load-bearing meaning:

| value | semantic |
|---|---|
| `command` | Directive to the receiver. The sender expects the receiver to act, and may expect a paired `response` or `error`. |
| `response` | Completion of a prior `command`. MUST carry `header.reply_to_message_uuid` or `trace.parent_message_uuid` that resolves to the originating `command`'s `message_uuid`. |
| `event` | Fire-and-forget broadcast. No reply expected. Audit sinks and stream channels consume this freely. |
| `error` | A `response`-shaped terminal signal carrying an error body (standard shape `NacpErrorBodySchema`, or — pending §3.3 migration — per-verb `{status: "error", error?: {...}}` shapes). |

### 5.1 Relationship to the matrix (§2)

The matrix encodes which `delivery_kind` values are legal for a given `message_type`. The semantic spec in this section explains *why* the matrix says what it says. A type with `delivery_kind: "response"` without a valid `reply_to` chain is a **payload-level** error, not a matrix-level error; matrix validators do not enforce reply_to chains.

---

## 6. Normative Scope — Section G: Upstream `initial_context` wire hook

### 6.1 Schema

`packages/nacp-session/src/upstream-context.ts` exports:

```ts
export const SessionStartInitialContextSchema = z.object({
  user_memory: z.record(z.string(), z.unknown()).optional(),
  intent: z.object({
    route: z.string().min(1).max(256).optional(),
    realm: z.string().min(1).max(128).optional(),
    confidence: z.number().min(0).max(1).optional(),
  }).optional(),
  warm_slots: z.array(z.object({
    key: z.string().min(1).max(256),
    value: z.unknown(),
  })).optional(),
  realm_hints: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
```

### 6.2 `SessionStartBodySchema` update

The `initial_context` field tightens from `z.record(z.string(), z.unknown()).optional()` to `SessionStartInitialContextSchema.optional()`. Back-compat is preserved via:

- All 4 sub-fields are `optional()`.
- The root schema uses `.passthrough()`, so unknown keys do not reject.
- Empty objects continue to parse successfully.

### 6.3 What the schema does **not** commit to**

Per GPT-R3, this RFC does **not** introduce a consumer of `initial_context` inside `session-do-runtime`. `body.initial_context` is preserved in the validated envelope; any downstream consumer (including `context.core` or `agent.core` in the worker matrix) is free to read it. The RFC fixes the **wire shape**, not the dispatch path.

---

## 7. Back-compat and version jump

### 7.1 Zero-breaking pledge

Every v1.1-era envelope, session frame, and initial_context payload that parsed before this RFC continues to parse. The matrix layer accepts every `(type, delivery_kind)` combination that appears in shipped test fixtures.

### 7.2 Version bumps

- `@nano-agent/nacp-core` — `1.1.0 → 1.3.0`
- `@nano-agent/nacp-session` — `1.1.0 → 1.3.0`
- `@nano-agent/session-do-runtime` — `0.1.0 → 0.3.0`

### 7.3 Why jump `1.2.0` for nacp-core and nacp-session

`docs/rfc/nacp-core-1-2-0.md` and `docs/rfc/nacp-session-1-2-0.md` exist as B6-era "frozen-as-no-delta" RFCs. Reusing the `1.2.0` semver would create ambiguity between "B6 frozen decision" and "B9 shipped delta." The RFC deliberately jumps to `1.3.0`.

### 7.4 Why jump `0.2.0` for session-do-runtime

`packages/session-do-runtime/CHANGELOG.md` contains a `0.2.0` header block (dated 2026-04-20, B6 BoundedEvalSink), but `package.json` remained at `0.1.0` (never published). B9 lifts the package directly to `0.3.0`:

- `CHANGELOG.md` head line for `0.3.0` will explicitly note: "jumps over the never-published `0.2.0` tag; the `0.2.0` CHANGELOG entry remains as historical record of the B6 `BoundedEvalSink` shipment."
- `package.json` goes `0.1.0 → 0.3.0`.

---

## 8. Out-of-scope (explicit)

The following are **not** frozen by this RFC and are expected to be handled in later, separately-authorized work:

- **O1** — Removal of v1.1 message_type strings. Requires nacp-2.0 major bump.
- **O2** — Modification of `V1_BINDING_CATALOG`. Charter §4.1 H rule 32.
- **O3** — Implementation of `orchestrator.*` namespace verbs.
- **O4** — Contexter-side changes.
- **O5** — `context.reranker` worker creation.
- **O6** — DO identity migration (per-session vs per-user). Per-session remains correct for nano-agent.
- **O7** — `DOStorageAdapter.maxValueBytes` bump from 1 MiB to 2 MiB.
- **O8** — New probes for F03 / F09 platform gates.
- **O9** — Any new worker implementation.
- **O10** — Front-end / client SDK changes.
- **O11** — **Migration of existing `{status, error?}` response shapes to `NacpErrorBodySchema`**. GPT-R2. Separate PR.
- **O12** — **`LEGACY_ALIAS_REGISTRY` runtime machinery**. GPT-R2. Naming law is RFC-level only.
- **O13** — **`tenantIngressVerify` / `contextCore.ingestFromUpstream()` as fictional seams**. GPT-R3. Use only already-shipped symbols (`verifyTenantBoundary`, `tenantDoStorage*`).

---

## 9. Traceability

| RFC section | source |
|---|---|
| §1 Background | `docs/issue/after-foundations/B7-final-closure.md` §3; `docs/issue/after-foundations/B8-phase-1-closure.md` §2-§6 |
| §2 Matrix (C) | `docs/eval/after-foundations/smind-contexter-learnings.md` §9.5.2 item C; GPT review R1 (dual ownership) |
| §3 Error body (D-narrowed) | Learnings §9.5.2 item D; GPT review R2 (scope narrow) |
| §4 Naming law (E-narrowed) | Learnings §9.5.2 item E; GPT review R2 (no runtime alias) |
| §5 delivery_kind semantic (F-new) | Learnings §9.5.2 item F-new |
| §6 initial_context | Learnings §10.6.1; B8 Opus review R3 |
| §7 Version | B8 Phase 1 closure §2 footnote (package/CHANGELOG drift); GPT review R4 |
| §8 Out-of-scope | GPT review R2/R3; Learnings §10.4/§10.7/§10.10 |

---

## 10. Closure

This RFC is marked `owner-approved` on execution (2026-04-21) and will transition to `frozen` at B9 Phase 4 closure. Further modifications require a new RFC (nacp-core-1-4 or nacp-2.0).
