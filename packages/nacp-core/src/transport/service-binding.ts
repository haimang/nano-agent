/**
 * Service Binding Transport — RPC-based worker-to-worker via WorkerEntrypoint.
 *
 * Enforces the three-step pipeline before dispatching:
 *   validateEnvelope → verifyTenantBoundary → checkAdmissibility → target.handleNacp
 *
 * GPT code-review §2.5: transport MUST call all three checks, not just forward.
 */

import { validateEnvelope, type NacpEnvelope } from "../envelope.js";
import { checkAdmissibility, type AdmissibilityContext } from "../admissibility.js";
import { verifyTenantBoundary, type TenantBoundaryContext } from "../tenancy/boundary.js";
import type { NacpProgressResponse, NacpSendOptions, NacpTransport } from "./types.js";

export interface ServiceBindingTarget {
  handleNacp(envelope: NacpEnvelope): Promise<NacpEnvelope | NacpProgressResponse>;
}

export interface ServiceBindingTransportOptions {
  target: ServiceBindingTarget;
  boundary: TenantBoundaryContext;
  admissibility?: AdmissibilityContext;
}

export class ServiceBindingTransport implements NacpTransport {
  readonly kind = "service-binding" as const;
  private readonly target: ServiceBindingTarget;
  private readonly boundary: TenantBoundaryContext;
  private readonly admissibility: AdmissibilityContext;

  constructor(opts: ServiceBindingTransportOptions) {
    this.target = opts.target;
    this.boundary = opts.boundary;
    this.admissibility = opts.admissibility ?? {};
  }

  private async precheck(envelope: NacpEnvelope): Promise<NacpEnvelope> {
    const validated = validateEnvelope(envelope);
    await verifyTenantBoundary(validated, this.boundary);
    checkAdmissibility(validated, this.admissibility);
    return validated;
  }

  async send(
    envelope: NacpEnvelope,
    _opts?: NacpSendOptions,
  ): Promise<NacpEnvelope | void> {
    const validated = await this.precheck(envelope);
    const raw = await this.target.handleNacp(validated);
    if (!raw) return;
    if (isProgressResponse(raw)) {
      return raw.response;
    }
    return raw;
  }

  async sendWithProgress(
    envelope: NacpEnvelope,
    _opts?: NacpSendOptions,
  ): Promise<NacpProgressResponse> {
    const validated = await this.precheck(envelope);
    const raw = await this.target.handleNacp(validated);
    if (isProgressResponse(raw)) {
      return raw;
    }
    return { response: raw as NacpEnvelope };
  }
}

function isProgressResponse(val: unknown): val is NacpProgressResponse {
  return (
    typeof val === "object" &&
    val !== null &&
    "response" in val &&
    typeof (val as Record<string, unknown>).response === "object"
  );
}
