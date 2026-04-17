/**
 * NACP-Core Envelope — the single source of truth for all internal messages.
 *
 * Architecture: NACP is a protocol family.
 *   - NACP-Core   (this file) — worker / DO / queue / audit internal contract
 *   - NACP-Session (separate package) — client ↔ session DO WebSocket profile
 *   - Transport Profiles — per-wire rules layered on top
 *
 * Every internal message is an NacpEnvelope. validate → boundary → admissibility → handler.
 */

import { z } from "zod";
import { NacpValidationError } from "./errors.js";
import { NACP_VERSION, NACP_VERSION_COMPAT, cmpSemver } from "./version.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Primitive schemas
// ═══════════════════════════════════════════════════════════════════

export const NacpSemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "must be a valid semver string (e.g. 1.0.0)");

export const NacpPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export type NacpPriority = z.infer<typeof NacpPrioritySchema>;

export const NacpProducerRoleSchema = z.enum([
  "session",
  "hook",
  "skill",
  "capability",
  "queue",
  "ingress",
  "client",
  "platform",
]);
export type NacpProducerRole = z.infer<typeof NacpProducerRoleSchema>;

export const NacpProducerIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(
    /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+@v\d+$/,
    "producer_id must follow 'namespace.sub@vN' pattern (e.g. nano-agent.session.do@v1)",
  );

export const NacpDeliveryKindSchema = z.enum([
  "command",
  "response",
  "event",
  "error",
]);
export type NacpDeliveryKind = z.infer<typeof NacpDeliveryKindSchema>;

export const NacpPlanLevelSchema = z.enum([
  "free",
  "pro",
  "enterprise",
  "internal",
]);
export type NacpPlanLevel = z.infer<typeof NacpPlanLevelSchema>;

export const NacpMembershipLevelSchema = z.enum([
  "owner",
  "admin",
  "operator",
  "member",
  "readonly",
]);

export const NacpAudienceSchema = z.enum([
  "internal",
  "audit-only",
  "client-visible",
]);
export type NacpAudience = z.infer<typeof NacpAudienceSchema>;

// ═══════════════════════════════════════════════════════════════════
// §2 — Header
// ═══════════════════════════════════════════════════════════════════

export const NacpHeaderSchema = z.object({
  schema_version: NacpSemverSchema,
  message_uuid: z.string().uuid(),
  message_type: z.string().min(1).max(128),
  delivery_kind: NacpDeliveryKindSchema,
  sent_at: z.string().datetime({ offset: true }),
  producer_role: NacpProducerRoleSchema,
  producer_id: NacpProducerIdSchema,
  consumer_hint: NacpProducerIdSchema.optional(),
  priority: NacpPrioritySchema.default("normal"),
});
export type NacpHeader = z.infer<typeof NacpHeaderSchema>;

// ═══════════════════════════════════════════════════════════════════
// §3 — Authority (server-stamped, multi-tenant first-class)
// ═══════════════════════════════════════════════════════════════════

export const NacpAuthoritySchema = z.object({
  team_uuid: z.string().min(1).max(64),
  user_uuid: z.string().uuid().optional(),
  plan_level: NacpPlanLevelSchema,
  membership_level: NacpMembershipLevelSchema.optional(),
  stamped_by: NacpProducerIdSchema,
  stamped_at: z.string().datetime({ offset: true }),
});
export type NacpAuthority = z.infer<typeof NacpAuthoritySchema>;

// ═══════════════════════════════════════════════════════════════════
// §4 — Trace
// ═══════════════════════════════════════════════════════════════════

export const NacpTraceSchema = z.object({
  trace_id: z.string().uuid(),
  session_uuid: z.string().uuid(),
  parent_message_uuid: z.string().uuid().optional(),
  stream_id: z.string().min(1).max(128).optional(),
  stream_seq: z.number().int().min(0).optional(),
  span_id: z.string().max(32).optional(),
});
export type NacpTrace = z.infer<typeof NacpTraceSchema>;

// ═══════════════════════════════════════════════════════════════════
// §5 — Control (including multi-tenant delegation + quota)
// ═══════════════════════════════════════════════════════════════════

export const NacpRetryContextSchema = z.object({
  attempt: z.number().int().min(0),
  max_attempts: z.number().int().min(1),
  last_error_code: z.string().min(1).optional(),
  next_backoff_ms: z.number().int().min(0).optional(),
  decision: z.enum(["retry", "dead_letter", "abort"]).optional(),
});
export type NacpRetryContext = z.infer<typeof NacpRetryContextSchema>;

export const NacpQuotaHintSchema = z.object({
  plan_level: NacpPlanLevelSchema,
  budget_remaining_ms: z.number().int().min(0).optional(),
  token_budget_remaining: z.number().int().min(0).optional(),
  rate_limit_bucket: z.string().max(64).optional(),
  rate_limit_remaining: z.number().int().min(0).optional(),
  rate_limit_reset_ms: z.number().int().min(0).optional(),
});
export type NacpQuotaHint = z.infer<typeof NacpQuotaHintSchema>;

export const NacpTenantDelegationSchema = z.object({
  delegated_team_uuid: z.string().min(1).max(64),
  delegator_role: z.enum(["platform", "owner", "admin"]),
  delegator_user_uuid: z.string().uuid().optional(),
  scope: z
    .array(z.enum(["read", "write", "exec", "audit-read", "quota-override"]))
    .min(1),
  delegation_uuid: z.string().uuid(),
  delegation_issued_at: z.string().datetime({ offset: true }),
  delegation_expires_at: z.string().datetime({ offset: true }),
  delegation_reason: z.string().min(1).max(256),
  signature: z.string().min(1).max(512),
});
export type NacpTenantDelegation = z.infer<typeof NacpTenantDelegationSchema>;

export const NacpRedactionHintSchema = z.array(z.string().max(128));

export const NacpControlSchema = z
  .object({
    reply_to: z.string().uuid().optional(),
    request_uuid: z.string().uuid().optional(),
    deadline_ms: z.number().int().min(0).optional(),
    timeout_ms: z.number().int().min(100).max(300_000).optional(),
    idempotency_key: z.string().min(1).max(128).optional(),
    capability_scope: z.array(z.string()).optional(),
    retry_context: NacpRetryContextSchema.optional(),
    tenant_delegation: NacpTenantDelegationSchema.optional(),
    quota_hint: NacpQuotaHintSchema.optional(),
    audience: NacpAudienceSchema.default("internal"),
    redaction_hint: NacpRedactionHintSchema.optional(),
  })
  .optional();
export type NacpControl = z.infer<typeof NacpControlSchema>;

// ═══════════════════════════════════════════════════════════════════
// §6 — Refs (tenant-namespaced large-object references)
// ═══════════════════════════════════════════════════════════════════

export const NacpRefKindSchema = z.enum([
  "r2",
  "kv",
  "do-storage",
  "d1",
  "queue-dlq",
]);

export const NacpRefSchema = z
  .object({
    kind: NacpRefKindSchema,
    binding: z.string().min(1).max(64),
    team_uuid: z.string().min(1).max(64),
    key: z.string().min(1).max(512),
    bucket: z.string().optional(),
    size_bytes: z.number().int().min(0).optional(),
    content_type: z.string().max(128).optional(),
    etag: z.string().max(64).optional(),
    role: z.enum(["input", "output", "attachment"]).default("attachment"),
  })
  .refine((r) => r.key.startsWith(`tenants/${r.team_uuid}/`), {
    message: "ref.key must start with tenants/{team_uuid}/",
    path: ["key"],
  });
export type NacpRef = z.infer<typeof NacpRefSchema>;

export const NacpRefsSchema = z.array(NacpRefSchema).max(32);

// ═══════════════════════════════════════════════════════════════════
// §7 — Extra (safety-valve extension field)
// ═══════════════════════════════════════════════════════════════════

export const NacpExtraSchema = z.record(z.string(), z.unknown()).optional();

// ═══════════════════════════════════════════════════════════════════
// §8 — Envelope (composite)
// ═══════════════════════════════════════════════════════════════════

export const NacpEnvelopeBaseSchema = z.object({
  header: NacpHeaderSchema,
  authority: NacpAuthoritySchema,
  trace: NacpTraceSchema,
  control: NacpControlSchema,
  body: z.unknown().optional(),
  refs: NacpRefsSchema.optional(),
  extra: NacpExtraSchema,
});

export type NacpEnvelope<Body = unknown> = z.infer<
  typeof NacpEnvelopeBaseSchema
> & {
  body?: Body;
};

// ═══════════════════════════════════════════════════════════════════
// §9 — Message registry (populated by messages/*.ts, see index.ts)
//       These mutable maps are filled at import time.
// ═══════════════════════════════════════════════════════════════════

export const BODY_SCHEMAS: Record<string, z.ZodTypeAny> = Object.create(null);
export const BODY_REQUIRED: Set<string> = new Set();
export const ROLE_GATE: Record<string, Set<NacpProducerRole>> =
  Object.create(null);

export const NACP_MESSAGE_TYPES_ALL: Set<string> = new Set();

export function registerMessageType(
  messageType: string,
  bodySchema: z.ZodTypeAny,
  options: {
    bodyRequired?: boolean;
    allowedProducerRoles?: NacpProducerRole[];
  } = {},
): void {
  BODY_SCHEMAS[messageType] = bodySchema;
  NACP_MESSAGE_TYPES_ALL.add(messageType);
  if (options.bodyRequired !== false) {
    BODY_REQUIRED.add(messageType);
  }
  if (options.allowedProducerRoles) {
    ROLE_GATE[messageType] = new Set(options.allowedProducerRoles);
  }
}

// ═══════════════════════════════════════════════════════════════════
// §10 — Validate (5 layers) + Encode / Decode
// ═══════════════════════════════════════════════════════════════════

const MAX_ENVELOPE_BYTES = 96 * 1024;

export function validateEnvelope(raw: unknown): NacpEnvelope {
  // Layer 1: structural shape
  const parsed = NacpEnvelopeBaseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new NacpValidationError(
      parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    );
  }
  const env = parsed.data;

  // Layer 1b: authority.team_uuid non-empty (multi-tenant hard rule)
  if (!env.authority.team_uuid) {
    throw new NacpValidationError([
      "authority.team_uuid is required (no anonymous messages)",
    ]);
  }

  // Layer 2: message_type registry
  if (!NACP_MESSAGE_TYPES_ALL.has(env.header.message_type)) {
    throw new NacpValidationError(
      [
        `message_type '${env.header.message_type}' not in registry. Known: ${[...NACP_MESSAGE_TYPES_ALL].join(", ")}`,
      ],
      "NACP_UNKNOWN_MESSAGE_TYPE",
    );
  }

  // Layer 3: version compatibility
  if (cmpSemver(env.header.schema_version, NACP_VERSION_COMPAT) < 0) {
    throw new NacpValidationError(
      [
        `schema_version '${env.header.schema_version}' is below compat floor '${NACP_VERSION_COMPAT}'`,
      ],
      "NACP_VERSION_INCOMPATIBLE",
    );
  }

  // Layer 4: per-type body validation
  const bodyRequired = BODY_REQUIRED.has(env.header.message_type);
  if (bodyRequired && env.body === undefined) {
    throw new NacpValidationError([
      `body is required for message_type '${env.header.message_type}'`,
    ]);
  }
  const bodySchema = BODY_SCHEMAS[env.header.message_type];
  if (bodySchema && env.body !== undefined) {
    const bodyResult = bodySchema.safeParse(env.body);
    if (!bodyResult.success) {
      throw new NacpValidationError(
        bodyResult.error.issues.map(
          (i) => `body.${i.path.join(".")}: ${i.message}`,
        ),
      );
    }
  }

  // Layer 5: role gate
  const allowedRoles = ROLE_GATE[env.header.message_type];
  if (allowedRoles && !allowedRoles.has(env.header.producer_role)) {
    throw new NacpValidationError(
      [
        `producer_role '${env.header.producer_role}' not allowed for '${env.header.message_type}'. Allowed: ${[...allowedRoles].join(", ")}`,
      ],
      "NACP_PRODUCER_ROLE_MISMATCH",
    );
  }

  return env as NacpEnvelope;
}

export function encodeEnvelope(env: NacpEnvelope): string {
  const validated = validateEnvelope(env);
  const json = JSON.stringify(validated);
  const byteSize = new TextEncoder().encode(json).byteLength;
  if (byteSize > MAX_ENVELOPE_BYTES) {
    throw new NacpValidationError(
      [
        `envelope is ${byteSize} bytes, exceeds ${MAX_ENVELOPE_BYTES} byte limit. Move large data to refs[].`,
      ],
      "NACP_SIZE_EXCEEDED",
    );
  }
  return json;
}

export function decodeEnvelope(raw: string): NacpEnvelope {
  if (raw.length > MAX_ENVELOPE_BYTES * 2) {
    throw new NacpValidationError(
      ["raw message too large (transport ingress guard)"],
      "NACP_SIZE_EXCEEDED",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new NacpValidationError([
      `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
    ]);
  }
  return validateEnvelope(parsed);
}
