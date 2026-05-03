/**
 * NACP Session Type × Direction Matrix — session-profile legality.
 *
 * Ownership rule (B9 / GPT-R1): session profile owns its own matrix.
 * `validateSessionFrame()` consumes this matrix — NOT `validateEnvelope()`.
 * Core types have their own matrix in `@haimang/nacp-core`.
 *
 * Conservative first-publish rule (B9 RFC §2.4): every (type, delivery_kind)
 * combination in shipped session tests / source paths is legal here.
 */

import type { NacpDeliveryKind } from "@haimang/nacp-core";

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
  // ZX2 Phase 2 P2-03 — 5 family / 7 message_types
  // server → client: permission.request, usage.update, elicitation.request
  // client → server: permission.decision, skill.invoke, command.invoke,
  //                  elicitation.answer
  "session.permission.request": new Set<NacpDeliveryKind>(["command", "event"]),
  "session.permission.decision": new Set<NacpDeliveryKind>(["response", "command"]),
  "session.usage.update": new Set<NacpDeliveryKind>(["event"]),
  "session.skill.invoke": new Set<NacpDeliveryKind>(["command"]),
  "session.command.invoke": new Set<NacpDeliveryKind>(["command"]),
  "session.elicitation.request": new Set<NacpDeliveryKind>(["command", "event"]),
  "session.elicitation.answer": new Set<NacpDeliveryKind>(["response", "command"]),
  // HP5 P1-03 — confirmation control plane (server → client only)
  "session.confirmation.request": new Set<NacpDeliveryKind>(["event"]),
  "session.confirmation.update": new Set<NacpDeliveryKind>(["event"]),
  // HP6 P1-02 — agentic-loop todos
  // - todos.write: client → server / model → server (command)
  // - todos.update: server → client only (event broadcast of new state)
  "session.todos.write": new Set<NacpDeliveryKind>(["command"]),
  "session.todos.update": new Set<NacpDeliveryKind>(["event"]),
  // HPX6 — workbench top-level frames, all server → client events.
  "session.runtime.update": new Set<NacpDeliveryKind>(["event"]),
  "session.restore.completed": new Set<NacpDeliveryKind>(["event"]),
  "session.item.started": new Set<NacpDeliveryKind>(["event"]),
  "session.item.updated": new Set<NacpDeliveryKind>(["event"]),
  "session.item.completed": new Set<NacpDeliveryKind>(["event"]),
  // RH2 P2-01c — server → client only (notify-and-disconnect)
  "session.attachment.superseded": new Set<NacpDeliveryKind>(["event"]),
  // PP3 — server → client only (early reconnect degraded verdict)
  "session.replay.lost": new Set<NacpDeliveryKind>(["event"]),
});

export function isLegalSessionDirection(
  messageType: string,
  deliveryKind: NacpDeliveryKind,
): boolean {
  const allowed = NACP_SESSION_TYPE_DIRECTION_MATRIX[messageType];
  if (!allowed) return true;
  return allowed.has(deliveryKind);
}
