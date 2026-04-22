# Changelog — @nano-agent/nacp-core

## 1.4.0 — 2026-04-22 (W0 — pre-worker-matrix consolidation)

Per `docs/rfc/nacp-core-1-4-consolidation.md`. Zero breaking change. This cut consolidates Tier A vocabulary that had been split across adjacent runtime packages into `@nano-agent/nacp-core`, while leaving runtime classes / dispatchers / adapters in their original homes.

### Added

- `src/transport/cross-seam.ts` — `CrossSeamAnchor`, `CROSS_SEAM_HEADERS`, `buildCrossSeamHeaders()`, `readCrossSeamHeaders()`, `validateCrossSeamAnchor()`.
- `src/evidence/sink-contract.ts` — `EvalSinkEmitArgs`, `EvalSinkOverflowDisclosure`, `EvalSinkStats`, and `extractMessageUuid()`.
- `src/evidence/vocabulary.ts` — `EvidenceAnchorSchema`, 4-stream evidence record schemas (`assembly` / `compact` / `artifact` / `snapshot`), and `EvidenceRecordSchema`.
- `src/hooks-catalog/index.ts` — `HookEventNameSchema`, the frozen 18-event hook name set, per-event payload schemas, and `HOOK_EVENT_PAYLOAD_SCHEMA_{NAMES,SCHEMAS}` registries.
- `src/storage-law/{constants.ts,builders.ts,index.ts}` — `DO_KEYS`, `KV_KEYS`, `R2_KEYS`, `buildDoStorageRef()`, `buildKvRef()`, `buildR2Ref()`, `validateRefKey()`, plus `StorageRef` / `BuildRefOptions`.
- New public subpath exports: `@nano-agent/nacp-core/evidence`, `@nano-agent/nacp-core/hooks-catalog`, `@nano-agent/nacp-core/storage-law`.

### Changed

- `NACP_VERSION` bumped `1.3.0 → 1.4.0`. `NACP_VERSION_COMPAT` stays `1.0.0`.
- `packages/session-do-runtime/src/cross-seam.ts` now keeps only runtime-owned failure/startup logic locally; propagation truth is re-exported from `@nano-agent/nacp-core`.
- `packages/session-do-runtime/src/eval-sink.ts` now re-exports sink contract types + `extractMessageUuid()` from `@nano-agent/nacp-core` while keeping `BoundedEvalSink` local.
- `packages/workspace-context-artifacts/src/evidence-emitters.ts` now types its evidence records against `@nano-agent/nacp-core` vocabulary.
- `packages/hooks/src/catalog.ts` now consumes `HookEventName` and payload-schema-name truth from `@nano-agent/nacp-core`.
- `packages/storage-topology/src/{keys.ts,refs.ts}` now re-export storage-law truth from `@nano-agent/nacp-core`.
- `StorageRef` is now expressed as `extends NacpRef` inside `src/storage-law/builders.ts`; the public field set remains structurally equivalent to the pre-W0 flat interface.
- `validateRefKey()` keeps its pre-W0 call signature (`StorageRef`) while validating the same `team_uuid` + tenant-prefix rule now frozen in `@nano-agent/nacp-core`.

### Not shipped (deferred)

- `BoundedEvalSink`, `CrossSeamError`, `StartupQueue`, evidence emitters, hook runtime metadata, storage adapters, and any other runtime classes / dispatchers / adapters remain outside `@nano-agent/nacp-core`.
- No new cross-worker message families or worker-matrix RFC surface ship in 1.4.0; W1 remains the RFC-only follow-up phase.
- `@nano-agent/nacp-session` does **not** bump in W0 because this consolidation did not require new `nacp-session` imports or surface changes.

## 1.3.0 — 2026-04-21 (B9 — contract freeze pre worker-matrix)

Per `docs/rfc/nacp-core-1-3-draft.md`. Zero breaking change. Version jumps over `1.2.0` because that semver tag is owned by the B6-reconciled "no-schema-delta" RFC (`docs/rfc/nacp-core-1-2-0.md`); reusing it would create ambiguity between "B6 frozen decision" and "B9 shipped delta."

### Added

- `NACP_CORE_TYPE_DIRECTION_MATRIX` (`src/type-direction-matrix.ts`) — `Record<string, Set<NacpDeliveryKind>>` covering all 11 core-registered message types. Conservative first-publish: every `(type, delivery_kind)` combination present in shipped test fixtures or source paths is legal.
- `isLegalCoreDirection(type, kind)` helper — fail-open for unknown types, fail-closed for known.
- `validateEnvelope()` **Layer 6**: `(message_type × delivery_kind)` matrix check. Throws `NacpValidationError` with code `NACP_TYPE_DIRECTION_MISMATCH` on illegal combination.
- `NacpErrorBodySchema` (`src/error-body.ts`) — standard per-verb error body shape. **Per-verb response shape migration (`tool.call.response`, `context.compact.response`, `skill.invoke.response`) is explicitly out-of-scope** and scheduled as a separate, owner-approved PR (RFC §3.2).
- `NACP_ERROR_BODY_VERBS: ReadonlySet<string>` registry — the canonical list of verbs that declare their body schema as `NacpErrorBodySchema`. **Empty at 1.3.0**; populated by the migration PR (RFC §3.3).
- `wrapAsError()` **provisional** helper — constructs error-shaped envelopes. Honors an optional `overrides.target_message_type`. Does NOT self-validate; its output will not pass `validateEnvelope()` against existing shipped verbs until the per-verb migration PR lands. Consumer guidance is in the RFC §3.1.1 table.
- `error-registry.ts`: new error code `NACP_TYPE_DIRECTION_MISMATCH`.

### Changed

- `NACP_VERSION` bumped `1.1.0 → 1.3.0`. `NACP_VERSION_COMPAT` unchanged (`1.0.0`) — existing v1.0/v1.1 consumers continue to work without migration.
- `validateEnvelope()` comment: "5 layers" → "6 layers."

### Not shipped (deferred)

- `LEGACY_ALIAS_REGISTRY` runtime machinery (RFC §4.3) — all current verbs already comply with `<namespace>.<verb>` law; a runtime alias layer would have zero consumers today.
- Per-verb response body migration to `NacpErrorBodySchema` (RFC §3.2/§3.3) — requires a separate PR touching every `status`-dispatching consumer.

## 2026-04-20 — B6 reconciliation (stay at 1.1.0; "1.2.0" RFC closes as no-schema-delta)

Per `docs/rfc/nacp-core-1-2-0.md` (B6-reconciled 2026-04-20), every
schema delta originally proposed in the 2026-04-19 draft fails the
4-condition reverse-derivation decision tree when re-checked against
B2 / B3 / B4 / B5 ship code:

- `context.compact.prepare.*` / `commit.notification` — B4 ships the
  orchestrator in-process; no cross-worker producer exists until
  worker matrix phase. **Deferred.**
- Hook `event_name` enum hoist — `@nano-agent/hooks` owns the v2
  18-event catalog; hoisting would reverse the dep direction.
  **Dropped.**
- `allow? / deny?` on `hook.outcome` — B5 `hooks/src/permission.ts`
  compiles the vocabulary away via `verdictOf()`; wire stays minimal.
  **Dropped.**

**Net result**: 0 schema deltas, 0 new message kinds. Package version
remains `1.1.0`. Per charter §11.2, this is a legitimate B6 exit state
(semver bump is secondary outcome, not primary success marker).

The three normative spec sections surfaced by the RFC — lowercase
anchor headers (binding-F02), eval sink dedup contract (binding-F04),
and KV freshness caveat (F03) — describe behavior already exhibited by
1.1.0 and are documented there for B7 integrated spike verification.

## v1.0.0 (2026-04-16)

Initial release of the NACP-Core package — the internal envelope layer of the Nano-Agent Communication Protocol family.

### Phase 1 — Type & Schema Skeleton
- `NacpHeaderSchema` with 9 fields including `delivery_kind` and `producer_role` + `producer_id` (open namespace)
- `NacpAuthoritySchema` with server-stamped `stamped_by` / `stamped_at` fields
- `NacpTraceSchema` with 2-level trace + `stream_id` / `stream_seq` for future Session profile
- `NacpControlSchema` with `tenant_delegation`, `quota_hint`, `audience`, `redaction_hint`, `reply_to`
- `NacpRefSchema` with tenant namespace enforcement via zod `.refine()`
- `NacpEnvelopeBaseSchema` composite
- `NacpValidationError` and `NacpAdmissibilityError` error classes
- `NACP_VERSION = "1.0.0"` and `cmpSemver()` utility

### Phase 2 — Validate + Admissibility + State Machine
- `validateEnvelope()` 5-layer validation: shape → authority non-empty → registry → version → per-type body + role gate
- `encodeEnvelope()` with 96KB size guard
- `decodeEnvelope()` with transport ingress size guard
- `checkAdmissibility()` for deadline/capability checks (separate from validate per GPT review)
- `NACP_ERROR_REGISTRY` with 18+ error codes (incl. 4 tenant + 4 state-machine)
- `RetryPolicy` / `decideRetry` / `calculateBackoffDelay` (ported from SMCP)
- Session phase state machine with `assertPhaseAllowed()`
- Request/response pairing table
- `NACP_ROLE_REQUIREMENTS` for all 8 producer roles

### Phase 3 — Tenancy First-Class
- `verifyTenantBoundary()` with 5 rules covering all 8 attack scenarios
- `tenantR2*` / `tenantKv*` / `tenantDoStorage*` scoped I/O wrappers
- `createDelegationSignature()` / `verifyDelegationSignature()` HMAC-SHA256

### Phase 4 — Business Message Schemas
- 11 Core message types across 5 domains: tool (3), hook (2), skill (2), context (2), system (2)
- Per-type body required enforcement (fixes GPT §2.10a bug)
- `context.compact.response` added (fixes GPT §2.10d bug)
- Role gate enforcement for all gated message types

### Phase 5 — Core Transport
- `ServiceBindingTransport` (RPC-based with ReadableStream progress support)
- `DoRpcTransport` with `buildDoIdName(team_uuid, suffix)` convention
- `QueueProducer` and `handleQueueMessage()` consumer with DLQ routing

### Phase 6 — Schema Export + Registry Doc
- `scripts/export-schema.ts` → `dist/nacp-core.schema.json` (17 definitions)
- `scripts/gen-registry-doc.ts` → `docs/nacp-core-registry.md`

### Phase 7 — Observability + Compat Placeholders
- `NacpObservabilityEnvelopeSchema` type placeholder (v1.1)
- `migrate_noop()` / `migrate_v1_0_to_v1_1()` compat placeholder
