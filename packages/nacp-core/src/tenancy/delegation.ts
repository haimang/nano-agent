/**
 * Tenant Delegation — HMAC signature verification for cross-tenant operations.
 *
 * Only producer_role="platform" may carry tenant_delegation.
 * The delegation is signed with a shared secret and has an expiry.
 */

import type { NacpTenantDelegation } from "../envelope.js";
import { NacpValidationError } from "../errors.js";

function signaturePayload(d: NacpTenantDelegation): string {
  return [
    d.delegation_uuid,
    d.delegated_team_uuid,
    d.delegator_role,
    d.scope.join(","),
    d.delegation_issued_at,
    d.delegation_expires_at,
    d.delegation_reason,
  ].join("|");
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createDelegationSignature(
  delegation: Omit<NacpTenantDelegation, "signature">,
  secret: string,
): Promise<string> {
  return hmacSha256(secret, signaturePayload(delegation as NacpTenantDelegation));
}

export async function verifyDelegationSignature(
  delegation: NacpTenantDelegation,
  secret: string,
): Promise<void> {
  // Check expiry first
  const expiresAt = new Date(delegation.delegation_expires_at).getTime();
  if (Date.now() > expiresAt) {
    throw new NacpValidationError(
      [`delegation expired at ${delegation.delegation_expires_at}`],
      "NACP_DELEGATION_INVALID",
    );
  }

  // Verify HMAC
  const expected = await hmacSha256(secret, signaturePayload(delegation));
  if (expected !== delegation.signature) {
    throw new NacpValidationError(
      ["delegation HMAC signature mismatch"],
      "NACP_DELEGATION_INVALID",
    );
  }
}
