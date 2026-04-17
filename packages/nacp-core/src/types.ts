/**
 * NACP-Core public type exports.
 *
 * Re-exports all zod-inferred types from envelope.ts for consumer convenience.
 * Also provides the type-safe buildEnvelope helper (populated after Phase 4).
 */

export type {
  NacpHeader,
  NacpAuthority,
  NacpTrace,
  NacpControl,
  NacpRetryContext,
  NacpQuotaHint,
  NacpTenantDelegation,
  NacpRef,
  NacpEnvelope,
  NacpPriority,
  NacpProducerRole,
  NacpDeliveryKind,
  NacpPlanLevel,
  NacpAudience,
} from "./envelope.js";
