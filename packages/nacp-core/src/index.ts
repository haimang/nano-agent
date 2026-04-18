/**
 * @nano-agent/nacp-core — NACP Protocol Family, Core Envelope Layer
 *
 * This is the public API surface. All consumers should import from here.
 */

// ── Side-effect: register all Core message types ──
import "./messages/index.js";

// ── Version ──
export {
  NACP_VERSION,
  NACP_VERSION_COMPAT,
  NACP_VERSION_KIND,
  cmpSemver,
} from "./version.js";
export type { NacpVersionKind } from "./version.js";

// ── Error types ──
export { NacpValidationError, NacpAdmissibilityError } from "./errors.js";

// ── Envelope schemas ──
export {
  NacpSemverSchema,
  NacpPrioritySchema,
  NacpProducerRoleSchema,
  NacpProducerKeySchema,
  NacpDeliveryKindSchema,
  NacpPlanLevelSchema,
  NacpMembershipLevelSchema,
  NacpAudienceSchema,
  NacpHeaderSchema,
  NacpAuthoritySchema,
  NacpTraceSchema,
  NacpRetryContextSchema,
  NacpQuotaHintSchema,
  NacpTenantDelegationSchema,
  NacpRedactionHintSchema,
  NacpControlSchema,
  NacpRefKindSchema,
  NacpRefSchema,
  NacpRefsSchema,
  NacpExtraSchema,
  NacpEnvelopeBaseSchema,
} from "./envelope.js";

// ── Envelope runtime ──
export {
  validateEnvelope,
  encodeEnvelope,
  decodeEnvelope,
  registerMessageType,
  BODY_SCHEMAS,
  BODY_REQUIRED,
  ROLE_GATE,
  NACP_MESSAGE_TYPES_ALL,
} from "./envelope.js";

// ── Error registry ──
export {
  NacpErrorCategorySchema,
  NacpErrorSchema,
  resolveErrorDefinition,
  listErrorDefinitions,
  registerErrorDefinition,
  isRetryableCategory,
  mapErrorCategoryToStatus,
} from "./error-registry.js";
export type {
  NacpErrorCategory,
  NacpError,
  NacpErrorDefinition,
} from "./error-registry.js";

// ── Retry ──
export {
  NacpRetryPolicySchema,
  NacpRetryDecisionSchema,
  calculateBackoffDelay,
  decideRetry,
} from "./retry.js";
export type { NacpRetryPolicy, NacpRetryDecision } from "./retry.js";

// ── Admissibility ──
export { checkAdmissibility } from "./admissibility.js";
export type { AdmissibilityContext } from "./admissibility.js";

// ── State machine ──
export {
  isMessageAllowedInPhase,
  assertPhaseAllowed,
  getExpectedResponseType,
  REQUEST_RESPONSE_PAIRS,
  NACP_ROLE_REQUIREMENTS,
  assertRoleCoversRequired,
} from "./state-machine.js";
export type { SessionPhase, RoleRequirement } from "./state-machine.js";

// ── Tenancy ──
export {
  verifyTenantBoundary,
  tenantR2Put, tenantR2Get, tenantR2Head, tenantR2List, tenantR2Delete,
  tenantKvGet, tenantKvPut, tenantKvDelete,
  tenantDoStorageGet, tenantDoStoragePut, tenantDoStorageDelete,
  createDelegationSignature, verifyDelegationSignature,
} from "./tenancy/index.js";
export type {
  TenantBoundaryContext,
  R2BucketLike, KVNamespaceLike, DoStorageLike,
} from "./tenancy/index.js";

// ── Messages ──
export {
  ToolBodySchemas, ToolCallRequestBodySchema, ToolCallResponseBodySchema, ToolCallCancelBodySchema,
  HookBodySchemas, HookEmitBodySchema, HookOutcomeBodySchema,
  SkillBodySchemas, SkillInvokeRequestBodySchema, SkillInvokeResponseBodySchema,
  ContextBodySchemas, ContextCompactRequestBodySchema, ContextCompactResponseBodySchema,
  SystemBodySchemas, SystemErrorBodySchema, AuditRecordBodySchema,
} from "./messages/index.js";

// ── Transport ──
export {
  ServiceBindingTransport,
  DoRpcTransport,
  buildDoIdName,
  QueueProducer,
  handleQueueMessage,
} from "./transport/index.js";
export type {
  NacpTransport,
  NacpHandler,
  NacpSendOptions,
  NacpProgressResponse,
  ServiceBindingTarget,
  DoStubLike,
  DoNamespaceLike,
  QueueLike,
  QueueMessageLike,
  QueueDlqWriterLike,
  QueueConsumerOptions,
} from "./transport/index.js";

// ── Types (re-exported for convenience) ──
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
} from "./types.js";
