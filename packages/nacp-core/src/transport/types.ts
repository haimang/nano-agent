/**
 * NACP Transport — abstract interface for all transport profiles.
 *
 * Transports carry NacpEnvelopes across physical boundaries
 * (service binding / queue / DO RPC / WebSocket / HTTP callback).
 * They MUST call validateEnvelope + verifyTenantBoundary + checkAdmissibility
 * before dispatching to handlers.
 */

import type { NacpEnvelope } from "../envelope.js";
import type { TenantBoundaryContext } from "../tenancy/boundary.js";

export interface NacpSendOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type NacpHandler = (
  envelope: NacpEnvelope,
  ctx: { boundary: TenantBoundaryContext },
) => Promise<NacpEnvelope | void>;

export interface NacpTransport {
  readonly kind: string;
  send(envelope: NacpEnvelope, opts?: NacpSendOptions): Promise<NacpEnvelope | void>;
}

export interface NacpProgressResponse {
  response: NacpEnvelope;
  progress?: ReadableStream<NacpEnvelope>;
}
