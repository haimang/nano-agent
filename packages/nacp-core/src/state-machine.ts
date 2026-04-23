/**
 * NACP State Machine — session phase transitions + role requirements.
 *
 * Defines which messages are legal in which session phase,
 * which request/response pairs must match,
 * and which roles must cover which message types.
 */

import type { NacpProducerRole } from "./envelope.js";

// ═══════════════════════════════════════════════════════════════
// §1 — Session phases
// ═══════════════════════════════════════════════════════════════

export type SessionPhase =
  | "unattached"
  | "attached"
  | "turn_running"
  | "ended";

// NOTE (GPT code-review §3.1): session.* message types appear here for phase
// transition awareness — Core needs to know WHICH messages trigger phase changes
// even though Core does NOT define body schemas for session.* messages.
// Body schemas for session.* live in @haimang/nacp-session.
const PHASE_ALLOWED_MESSAGES: Record<SessionPhase, Set<string>> = {
  unattached: new Set([
    "session.start",
    "session.resume",
    "system.error",
    "audit.record",
  ]),
  attached: new Set([
    "session.end",
    "session.cancel",
    "system.error",
    "audit.record",
    // turn begins when LLM call starts; the session DO transitions
    // to turn_running internally — external callers see "attached"
    // until the first tool call.
    "tool.call.request",
    "hook.emit",
    "skill.invoke.request",
    "context.compact.request",
  ]),
  turn_running: new Set([
    "tool.call.request",
    "tool.call.response",
    "tool.call.cancel",
    "hook.emit",
    "hook.outcome",
    "skill.invoke.request",
    "skill.invoke.response",
    "context.compact.request",
    "context.compact.response",
    "session.cancel",
    "session.end",
    "system.error",
    "audit.record",
  ]),
  ended: new Set([
    "system.error",
    "audit.record",
  ]),
};

export function isMessageAllowedInPhase(
  phase: SessionPhase,
  messageType: string,
): boolean {
  const allowed = PHASE_ALLOWED_MESSAGES[phase];
  return allowed ? allowed.has(messageType) : false;
}

export function assertPhaseAllowed(
  phase: SessionPhase,
  messageType: string,
): void {
  if (!isMessageAllowedInPhase(phase, messageType)) {
    throw new Error(
      `NACP_STATE_MACHINE_VIOLATION: message_type '${messageType}' not allowed in phase '${phase}'`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// §2 — Request / response pairing
// ═══════════════════════════════════════════════════════════════

export const REQUEST_RESPONSE_PAIRS: ReadonlyMap<string, string> = new Map([
  ["tool.call.request", "tool.call.response"],
  ["skill.invoke.request", "skill.invoke.response"],
  ["context.compact.request", "context.compact.response"],
  ["hook.emit", "hook.outcome"],
]);

export function getExpectedResponseType(
  requestType: string,
): string | undefined {
  return REQUEST_RESPONSE_PAIRS.get(requestType);
}

// ═══════════════════════════════════════════════════════════════
// §3 — Per-role requirements
// ═══════════════════════════════════════════════════════════════

export interface RoleRequirement {
  producer: ReadonlySet<string>;
  consumer: ReadonlySet<string>;
}

export const NACP_ROLE_REQUIREMENTS: Record<string, RoleRequirement> = {
  session: {
    producer: new Set([
      "tool.call.request",
      "tool.call.cancel",
      "skill.invoke.request",
      "hook.emit",
      "context.compact.request",
      "audit.record",
      "system.error",
    ]),
    consumer: new Set([
      "tool.call.response",
      "skill.invoke.response",
      "hook.outcome",
      "context.compact.response",
    ]),
  },
  capability: {
    producer: new Set([
      "tool.call.response",
      "context.compact.response",
      "system.error",
    ]),
    consumer: new Set([
      "tool.call.request",
      "tool.call.cancel",
      "context.compact.request",
    ]),
  },
  skill: {
    producer: new Set(["skill.invoke.response", "system.error"]),
    consumer: new Set(["skill.invoke.request"]),
  },
  hook: {
    producer: new Set(["hook.outcome", "system.error"]),
    consumer: new Set(["hook.emit"]),
  },
  client: {
    producer: new Set([
      "session.start",
      "session.resume",
      "session.cancel",
    ]),
    consumer: new Set(["session.end"]),
  },
  queue: {
    producer: new Set(["system.error"]),
    consumer: new Set(["audit.record"]),
  },
  ingress: {
    producer: new Set<string>(),
    consumer: new Set<string>(),
  },
  platform: {
    producer: new Set(["context.compact.request", "audit.record"]),
    consumer: new Set(["system.error", "audit.record"]),
  },
} satisfies Record<NacpProducerRole, RoleRequirement>;

export function assertRoleCoversRequired(
  role: string,
  handlers: { canProduce: Set<string>; canConsume: Set<string> },
): { missingProducer: string[]; missingConsumer: string[] } {
  const req = NACP_ROLE_REQUIREMENTS[role];
  if (!req) return { missingProducer: [], missingConsumer: [] };

  const missingProducer = [...req.producer].filter(
    (mt) => !handlers.canProduce.has(mt),
  );
  const missingConsumer = [...req.consumer].filter(
    (mt) => !handlers.canConsume.has(mt),
  );
  return { missingProducer, missingConsumer };
}
