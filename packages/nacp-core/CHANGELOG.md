# Changelog — @nano-agent/nacp-core

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
