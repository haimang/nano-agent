/**
 * @haimang/nacp-core — NACP Protocol Family, Core Envelope Layer
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
  resolveErrorMeta,
  listErrorMetas,
  listErrorMetaSources,
} from "./error-registry.js";
export type {
  NacpErrorCategory,
  NacpError,
  NacpErrorDefinition,
  ErrorMeta,
  ErrorMetaSource,
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

// ── Type × Direction matrix (1.3) ──
export {
  NACP_CORE_TYPE_DIRECTION_MATRIX,
  isLegalCoreDirection,
} from "./type-direction-matrix.js";

// ── Standard error body (1.3) ──
export {
  NacpErrorBodySchema,
  wrapAsError,
  NACP_ERROR_BODY_VERBS,
} from "./error-body.js";
export type {
  NacpErrorBody,
  WrapAsErrorInput,
  WrapAsErrorOverrides,
} from "./error-body.js";

// ── RPC envelope + meta + caller-side validation (ZX2 Phase 2 P2-01/02) ──
export {
  RpcErrorCodeSchema,
  RpcErrorSchema,
  RpcSuccessEnvelopeSchema,
  RpcErrorEnvelopeSchema,
  RpcEnvelopeSchema,
  RpcCallerSchema,
  RpcMetaSchema,
  okEnvelope,
  errorEnvelope,
  validateRpcCall,
  envelopeFromThrown,
  envelopeFromAuthLike,
} from "./rpc.js";
export type {
  RpcErrorCode,
  RpcError,
  RpcErrorEnvelope,
  RpcSuccessEnvelope,
  Envelope,
  RpcCaller,
  RpcMeta,
  ValidateRpcCallOptions,
  ValidatedRpcCall,
} from "./rpc.js";

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
  CROSS_SEAM_HEADERS,
  buildCrossSeamHeaders,
  readCrossSeamHeaders,
  validateCrossSeamAnchor,
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
  CrossSeamAnchor,
  ServiceBindingTarget,
  DoStubLike,
  DoNamespaceLike,
  QueueLike,
  QueueMessageLike,
  QueueDlqWriterLike,
  QueueConsumerOptions,
} from "./transport/index.js";

// ── Evidence ──
export {
  extractMessageUuid,
  EvidenceAnchorSchema,
  EvidenceStreamSchema,
  AssemblyEvidenceRecordSchema,
  CompactEvidencePhaseSchema,
  CompactRequestEvidenceRecordSchema,
  CompactResponseEvidenceRecordSchema,
  CompactBoundaryEvidenceRecordSchema,
  CompactErrorEvidenceRecordSchema,
  CompactEvidenceRecordSchema,
  ArtifactLifecycleStageSchema,
  ArtifactEvidenceRecordSchema,
  SnapshotCaptureEvidenceRecordSchema,
  SnapshotRestoreEvidenceRecordSchema,
  SnapshotEvidenceRecordSchema,
  EvidenceRecordSchema,
} from "./evidence/index.js";
export type {
  EvalSinkEmitArgs,
  EvalSinkOverflowDisclosure,
  EvalSinkStats,
  EvidenceAnchor,
  EvidenceStream,
  AssemblyEvidenceRecord,
  CompactEvidencePhase,
  CompactEvidenceRecord,
  ArtifactLifecycleStage,
  ArtifactEvidenceRecord,
  SnapshotEvidenceRecord,
  EvidenceRecord,
} from "./evidence/index.js";

// ── Hook vocabulary ──
export {
  HOOK_EVENT_NAMES,
  HookEventNameSchema,
  SessionStartPayloadSchema,
  SessionEndPayloadSchema,
  UserPromptSubmitPayloadSchema,
  PreToolUsePayloadSchema,
  PostToolUsePayloadSchema,
  PostToolUseFailurePayloadSchema,
  PreCompactPayloadSchema,
  PostCompactPayloadSchema,
  SetupPayloadSchema,
  StopPayloadSchema,
  PermissionRequestPayloadSchema,
  PermissionDeniedPayloadSchema,
  ContextPressurePayloadSchema,
  ContextCompactArmedPayloadSchema,
  ContextCompactPrepareStartedPayloadSchema,
  ContextCompactCommittedPayloadSchema,
  ContextCompactFailedPayloadSchema,
  EvalSinkOverflowPayloadSchema,
  HOOK_EVENT_PAYLOAD_SCHEMA_NAMES,
  HOOK_EVENT_PAYLOAD_SCHEMAS,
} from "./hooks-catalog/index.js";
export type {
  HookEventName,
  HookPayloadSchemaName,
} from "./hooks-catalog/index.js";

// ── Storage law ──
export {
  DO_KEYS,
  KV_KEYS,
  R2_KEYS,
  buildR2Ref,
  buildKvRef,
  buildDoStorageRef,
  validateRefKey,
} from "./storage-law/index.js";
export type {
  StorageBackend,
  StorageRef,
  BuildRefOptions,
} from "./storage-law/index.js";

// ── Observability envelope ──
export {
  NacpObservabilityEnvelopeSchema,
  NacpAlertSeveritySchema,
  NacpAlertScopeSchema,
  NacpAlertPayloadSchema,
} from "./observability/envelope.js";
export type {
  NacpAlertSeverity,
  NacpAlertScope,
  NacpAlertPayload,
  NacpObservabilityEnvelope,
} from "./observability/envelope.js";

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

// ── HP8 P4-01 — tool catalog SSoT ──
export {
  TOOL_CATALOG,
  TOOL_CATALOG_IDS,
  findToolEntry,
} from "./tools/tool-catalog.js";
export type {
  ToolCatalogEntry,
  ToolCapabilityOwner,
} from "./tools/tool-catalog.js";
