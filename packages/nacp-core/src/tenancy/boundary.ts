/**
 * Tenant Boundary Verification — enforces multi-tenant isolation at the protocol level.
 *
 * Every Core consumer must call verifyTenantBoundary() after validateEnvelope()
 * and before business logic. Violation = NACP_TENANT_MISMATCH or NACP_TENANT_BOUNDARY_VIOLATION.
 */

import type { NacpEnvelope } from "../envelope.js";
import { NacpValidationError } from "../errors.js";
import { verifyDelegationSignature } from "./delegation.js";

export interface TenantBoundaryContext {
  serving_team_uuid: string | "any" | "_platform";
  do_team_uuid?: string;
  accept_delegation: boolean;
  /** Required when accept_delegation=true. Secret used to verify delegation HMAC. */
  delegation_secret?: string;
}

export async function verifyTenantBoundary(
  env: NacpEnvelope,
  ctx: TenantBoundaryContext,
): Promise<void> {
  const teamInEnv = env.authority.team_uuid;

  // Rule 1: consumer serving team must match authority.team_uuid
  if (
    ctx.serving_team_uuid !== "any" &&
    ctx.serving_team_uuid !== "_platform" &&
    teamInEnv !== ctx.serving_team_uuid
  ) {
    if (env.control?.tenant_delegation && ctx.accept_delegation) {
      if (!ctx.delegation_secret) {
        throw new NacpValidationError(
          ["accept_delegation=true but no delegation_secret provided in context"],
          "NACP_DELEGATION_INVALID",
        );
      }
      await verifyDelegationSignature(
        env.control.tenant_delegation,
        ctx.delegation_secret,
      );
    } else {
      throw new NacpValidationError(
        [
          `serving team '${ctx.serving_team_uuid}' does not match envelope team '${teamInEnv}'`,
        ],
        "NACP_TENANT_MISMATCH",
      );
    }
  }

  // Rule 2: refs[*].team_uuid must match authority.team_uuid
  if (env.refs) {
    for (const ref of env.refs as Array<{ team_uuid: string; key: string }>) {
      if (ref.team_uuid !== teamInEnv && teamInEnv !== "_platform") {
        throw new NacpValidationError(
          [
            `ref.team_uuid '${ref.team_uuid}' does not match authority.team_uuid '${teamInEnv}'`,
          ],
          "NACP_TENANT_BOUNDARY_VIOLATION",
        );
      }
      // Rule 3: refs[*].key must start with tenants/{team_uuid}/
      if (!ref.key.startsWith(`tenants/${ref.team_uuid}/`)) {
        throw new NacpValidationError(
          [
            `ref.key '${ref.key}' does not start with 'tenants/${ref.team_uuid}/'`,
          ],
          "NACP_TENANT_BOUNDARY_VIOLATION",
        );
      }
    }
  }

  // Rule 4: DO team context must match
  if (ctx.do_team_uuid && ctx.do_team_uuid !== teamInEnv) {
    throw new NacpValidationError(
      [
        `DO team '${ctx.do_team_uuid}' does not match envelope team '${teamInEnv}'`,
      ],
      "NACP_TENANT_MISMATCH",
    );
  }

  // Rule 5: _platform reserved value only for platform role
  if (
    teamInEnv === "_platform" &&
    env.header.producer_role !== "platform"
  ) {
    throw new NacpValidationError(
      [
        `team_uuid '_platform' is only allowed with producer_role 'platform', got '${env.header.producer_role}'`,
      ],
      "NACP_TENANT_BOUNDARY_VIOLATION",
    );
  }
}
