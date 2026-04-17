/**
 * NACP Error Registry — centralized definitions for all known error codes.
 *
 * Every NACP error has a code, category, retryable flag, and human-readable message.
 * Categories map directly to retry decisions and HTTP status codes.
 *
 * Inspired by SMCP's error_registry.ts (context/smcp/src/runtime/error_registry.ts).
 */

import { z } from "zod";

export const NacpErrorCategorySchema = z.enum([
  "validation",
  "transient",
  "dependency",
  "permanent",
  "security",
  "quota",
  "conflict",
]);
export type NacpErrorCategory = z.infer<typeof NacpErrorCategorySchema>;

export const NacpErrorSchema = z.object({
  code: z.string().min(1).max(64),
  category: NacpErrorCategorySchema,
  message: z.string().min(1).max(512),
  detail: z.record(z.string(), z.unknown()).optional(),
  retryable: z.boolean(),
});
export type NacpError = z.infer<typeof NacpErrorSchema>;

export interface NacpErrorDefinition {
  code: string;
  category: NacpErrorCategory;
  retryable: boolean;
  message: string;
}

const RETRYABLE_CATEGORIES: ReadonlySet<NacpErrorCategory> = new Set([
  "transient",
  "dependency",
  "quota",
]);

export function isRetryableCategory(category: NacpErrorCategory): boolean {
  return RETRYABLE_CATEGORIES.has(category);
}

const _registry = new Map<string, NacpErrorDefinition>();

function def(
  code: string,
  category: NacpErrorCategory,
  retryable: boolean,
  message: string,
): void {
  _registry.set(code, { code, category, retryable, message });
}

// ── Core validation ──
def("NACP_VALIDATION_FAILED", "validation", false, "envelope schema validation failed");
def("NACP_UNKNOWN_MESSAGE_TYPE", "validation", false, "message_type not in registry");
def("NACP_SIZE_EXCEEDED", "validation", false, "envelope exceeds 96KB, use refs");
def("NACP_VERSION_INCOMPATIBLE", "validation", false, "schema_version below compat floor");

// ── Runtime delivery ──
def("NACP_DEADLINE_EXCEEDED", "transient", false, "message past deadline_ms");
def("NACP_IDEMPOTENCY_CONFLICT", "conflict", false, "idempotency_key already observed");
def("NACP_CAPABILITY_DENIED", "security", false, "capability_scope not granted");
def("NACP_RATE_LIMITED", "quota", true, "quota or rate limit reached");
def("NACP_BINDING_UNAVAILABLE", "transient", true, "target service binding unavailable");

// ── HTTP callback ──
def("NACP_HMAC_INVALID", "security", false, "HMAC signature invalid");
def("NACP_TIMESTAMP_SKEW", "security", false, "timestamp skew exceeds 5 minutes");

// ── Multi-tenant ──
def("NACP_TENANT_MISMATCH", "security", false, "authority.team_uuid does not match consumer serving team");
def("NACP_TENANT_BOUNDARY_VIOLATION", "security", false, "refs team_uuid or key does not match authority.team_uuid");
def("NACP_TENANT_QUOTA_EXCEEDED", "quota", true, "tenant quota budget exhausted");
def("NACP_DELEGATION_INVALID", "security", false, "tenant_delegation signature/expiry invalid");

// ── State machine ──
def("NACP_STATE_MACHINE_VIOLATION", "permanent", false, "message not allowed in current session phase");
def("NACP_REPLY_TO_CLOSED", "permanent", false, "reply_to points to closed request");
def("NACP_PRODUCER_ROLE_MISMATCH", "security", false, "producer_role not allowed for this message_type");
def("NACP_REPLAY_OUT_OF_RANGE", "permanent", false, "replay_from seq out of buffer range");

export function resolveErrorDefinition(code: string): NacpErrorDefinition | null {
  return _registry.get(code) ?? null;
}

export function listErrorDefinitions(): NacpErrorDefinition[] {
  return [..._registry.values()];
}

export function registerErrorDefinition(definition: NacpErrorDefinition): void {
  NacpErrorCategorySchema.parse(definition.category);
  _registry.set(definition.code, definition);
}

export function mapErrorCategoryToStatus(category: NacpErrorCategory): number {
  switch (category) {
    case "validation":
      return 400;
    case "security":
      return 403;
    case "quota":
      return 429;
    case "conflict":
      return 409;
    case "dependency":
    case "transient":
      return 503;
    case "permanent":
      return 500;
  }
}
