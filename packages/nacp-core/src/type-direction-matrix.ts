/**
 * NACP Core Type × Direction Matrix — Layer 6 envelope legality.
 *
 * For every core-registered `message_type`, declares the set of legal
 * `delivery_kind` values. Consumed by `validateEnvelope()` Layer 6.
 *
 * Ownership rule (B9 / GPT-R1): core only covers the 11 core-registered
 * types. Session profile (8 types) has its own matrix in `@haimang/nacp-session`.
 *
 * Conservative first-publish rule (B9 RFC §2.4): any (type, delivery_kind)
 * combination present in a shipped test fixture or source path must be legal
 * here. Narrowing is a later, opt-in concern.
 */

type CoreDeliveryKind = "command" | "response" | "event" | "error";

export const NACP_CORE_TYPE_DIRECTION_MATRIX: Readonly<
  Record<string, ReadonlySet<CoreDeliveryKind>>
> = Object.freeze({
  // ── tool verbs ──
  "tool.call.request": new Set<CoreDeliveryKind>(["command"]),
  "tool.call.response": new Set<CoreDeliveryKind>(["response", "error"]),
  "tool.call.cancel": new Set<CoreDeliveryKind>(["command"]),

  // ── hook verbs ──
  "hook.emit": new Set<CoreDeliveryKind>(["event"]),
  "hook.outcome": new Set<CoreDeliveryKind>(["event", "response"]),

  // ── skill verbs ──
  "skill.invoke.request": new Set<CoreDeliveryKind>(["command"]),
  "skill.invoke.response": new Set<CoreDeliveryKind>(["response", "error"]),

  // ── context verbs ──
  "context.compact.request": new Set<CoreDeliveryKind>(["command"]),
  "context.compact.response": new Set<CoreDeliveryKind>(["response", "error"]),

  // ── system verbs ──
  "system.error": new Set<CoreDeliveryKind>(["error"]),
  "audit.record": new Set<CoreDeliveryKind>(["event"]),
});

export function isLegalCoreDirection(
  messageType: string,
  deliveryKind: CoreDeliveryKind,
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
