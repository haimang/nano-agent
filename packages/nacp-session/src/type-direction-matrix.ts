/**
 * NACP Session Type × Direction Matrix — session-profile legality.
 *
 * Ownership rule (B9 / GPT-R1): session profile owns its own matrix.
 * `validateSessionFrame()` consumes this matrix — NOT `validateEnvelope()`.
 * Core types have their own matrix in `@nano-agent/nacp-core`.
 *
 * Conservative first-publish rule (B9 RFC §2.4): every (type, delivery_kind)
 * combination in shipped session tests / source paths is legal here.
 */

import type { NacpDeliveryKind } from "@nano-agent/nacp-core";

export const NACP_SESSION_TYPE_DIRECTION_MATRIX: Readonly<
  Record<string, ReadonlySet<NacpDeliveryKind>>
> = Object.freeze({
  "session.start": new Set<NacpDeliveryKind>(["command"]),
  "session.resume": new Set<NacpDeliveryKind>(["command"]),
  "session.cancel": new Set<NacpDeliveryKind>(["command"]),
  "session.end": new Set<NacpDeliveryKind>(["event"]),
  "session.stream.event": new Set<NacpDeliveryKind>(["event"]),
  "session.stream.ack": new Set<NacpDeliveryKind>(["response", "event"]),
  "session.heartbeat": new Set<NacpDeliveryKind>(["event"]),
  "session.followup_input": new Set<NacpDeliveryKind>(["command"]),
});

export function isLegalSessionDirection(
  messageType: string,
  deliveryKind: NacpDeliveryKind,
): boolean {
  const allowed = NACP_SESSION_TYPE_DIRECTION_MATRIX[messageType];
  if (!allowed) return true;
  return allowed.has(deliveryKind);
}
