# Changelog — @nano-agent/nacp-core

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
