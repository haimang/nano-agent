/**
 * NACP Core Type × Direction Matrix — Layer 6 envelope legality.
 *
 * For every core-registered `message_type`, declares the set of legal
 * `delivery_kind` values. Consumed by `validateEnvelope()` Layer 6.
 *
 * Ownership rule (B9 / GPT-R1): core only covers the 11 core-registered
 * types. Session profile (8 types) has its own matrix in `@nano-agent/nacp-session`.
 *
 * Conservative first-publish rule (B9 RFC §2.4): any (type, delivery_kind)
 * combination present in a shipped test fixture or source path must be legal
 * here. Narrowing is a later, opt-in concern.
 */

import type { NacpDeliveryKind } from "./envelope.js";

export const NACP_CORE_TYPE_DIRECTION_MATRIX: Readonly<
  Record<string, ReadonlySet<NacpDeliveryKind>>
> = Object.freeze({
  // ── tool verbs ──
  "tool.call.request": new Set<NacpDeliveryKind>(["command"]),
  "tool.call.response": new Set<NacpDeliveryKind>(["response", "error"]),
  "tool.call.cancel": new Set<NacpDeliveryKind>(["command"]),

  // ── hook verbs ──
  "hook.emit": new Set<NacpDeliveryKind>(["event"]),
  "hook.outcome": new Set<NacpDeliveryKind>(["event", "response"]),

  // ── skill verbs ──
  "skill.invoke.request": new Set<NacpDeliveryKind>(["command"]),
  "skill.invoke.response": new Set<NacpDeliveryKind>(["response", "error"]),

  // ── context verbs ──
  "context.compact.request": new Set<NacpDeliveryKind>(["command"]),
  "context.compact.response": new Set<NacpDeliveryKind>(["response", "error"]),

  // ── system verbs ──
  "system.error": new Set<NacpDeliveryKind>(["error"]),
  "audit.record": new Set<NacpDeliveryKind>(["event"]),
});

export function isLegalCoreDirection(
  messageType: string,
  deliveryKind: NacpDeliveryKind,
): boolean {
  const allowed = NACP_CORE_TYPE_DIRECTION_MATRIX[messageType];
  if (!allowed) {
    // Fail-open for unknown types (session.* / orchestrator.* / future
    // namespaces). Known-but-illegal combinations are fail-closed via
    // validateEnvelope() Layer 6.
    return true;
  }
  return allowed.has(deliveryKind);
}
