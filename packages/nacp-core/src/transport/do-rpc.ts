/**
 * Durable Object RPC Transport — session DO calls other DOs.
 *
 * DO id must contain team_uuid for tenant isolation:
 *   env.DO_CLASS.idFromName(`team:${team_uuid}:${suffix}`)
 *
 * Enforces the three-step pipeline before dispatching:
 *   validateEnvelope → verifyTenantBoundary → checkAdmissibility → stub.handleNacp
 *
 * GPT code-review §2.5: transport MUST call all three checks.
 */

import { validateEnvelope, type NacpEnvelope } from "../envelope.js";
import { NacpValidationError } from "../errors.js";
import { checkAdmissibility, type AdmissibilityContext } from "../admissibility.js";
import { verifyTenantBoundary, type TenantBoundaryContext } from "../tenancy/boundary.js";
import type { NacpSendOptions, NacpTransport } from "./types.js";

export interface DoStubLike {
  handleNacp(envelope: NacpEnvelope): Promise<NacpEnvelope | void>;
}

export interface DoNamespaceLike {
  idFromName(name: string): { toString(): string };
  get(id: { toString(): string }): DoStubLike;
}

export function buildDoIdName(teamUuid: string, suffix: string): string {
  return `team:${teamUuid}:${suffix}`;
}

export interface DoRpcTransportOptions {
  namespace: DoNamespaceLike;
  teamUuid: string;
  suffix: string;
  boundary: TenantBoundaryContext;
  admissibility?: AdmissibilityContext;
}

export class DoRpcTransport implements NacpTransport {
  readonly kind = "do-rpc" as const;
  private readonly namespace: DoNamespaceLike;
  private readonly teamUuid: string;
  private readonly suffix: string;
  private readonly boundary: TenantBoundaryContext;
  private readonly admissibility: AdmissibilityContext;

  constructor(opts: DoRpcTransportOptions) {
    this.namespace = opts.namespace;
    this.teamUuid = opts.teamUuid;
    this.suffix = opts.suffix;
    this.boundary = opts.boundary;
    this.admissibility = opts.admissibility ?? {};
  }

  async send(
    envelope: NacpEnvelope,
    _opts?: NacpSendOptions,
  ): Promise<NacpEnvelope | void> {
    const validated = validateEnvelope(envelope);
    await verifyTenantBoundary(validated, this.boundary);
    checkAdmissibility(validated, this.admissibility);

    // R2 fix: route team must match envelope authority team
    if (this.teamUuid !== validated.authority.team_uuid) {
      throw new NacpValidationError(
        [
          `DoRpcTransport route team '${this.teamUuid}' does not match envelope authority team '${validated.authority.team_uuid}'`,
        ],
        "NACP_TENANT_MISMATCH",
      );
    }

    const idName = buildDoIdName(this.teamUuid, this.suffix);
    const id = this.namespace.idFromName(idName);
    const stub = this.namespace.get(id);
    return stub.handleNacp(validated);
  }
}
