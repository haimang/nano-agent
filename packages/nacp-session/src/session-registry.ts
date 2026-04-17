/**
 * Session Role Requirements + Session-owned Phase Matrix.
 *
 * Blocker 2 fix: Core's phase table only covers session.start/resume/cancel/end.
 * It does NOT include session.stream.event/stream.ack/heartbeat — those are
 * Session profile's own messages. So Session must maintain its OWN phase matrix
 * that includes all WS profile messages, rather than delegating to Core's
 * isMessageAllowedInPhase() which would reject normal session traffic.
 */

import type { SessionPhase } from "@nano-agent/nacp-core";
import { SESSION_MESSAGE_TYPES } from "./messages.js";
import { NacpSessionError, SESSION_ERROR_CODES } from "./errors.js";

// Re-export SessionPhase for downstream convenience
export type { SessionPhase };

export interface SessionRoleRequirement {
  producer: ReadonlySet<string>;
  consumer: ReadonlySet<string>;
}

export const SESSION_ROLE_REQUIREMENTS: Record<string, SessionRoleRequirement> = {
  client: {
    producer: new Set(["session.start", "session.resume", "session.cancel", "session.stream.ack", "session.heartbeat"]),
    consumer: new Set(["session.end", "session.stream.event", "session.heartbeat"]),
  },
  session: {
    producer: new Set(["session.end", "session.stream.event", "session.heartbeat"]),
    consumer: new Set(["session.start", "session.resume", "session.cancel", "session.stream.ack", "session.heartbeat"]),
  },
  ingress: {
    producer: new Set<string>(),
    consumer: new Set<string>(),
  },
};

export function assertSessionRoleAllowed(
  producerRole: string,
  messageType: string,
  direction: "produce" | "consume",
): void {
  const req = SESSION_ROLE_REQUIREMENTS[producerRole];
  if (!req) return;
  const allowed = direction === "produce" ? req.producer : req.consumer;
  if (!allowed.has(messageType)) {
    throw new NacpSessionError(
      [`role '${producerRole}' cannot ${direction} '${messageType}'`],
      SESSION_ERROR_CODES.NACP_SESSION_INVALID_PHASE,
    );
  }
}

/**
 * Session-owned phase matrix (Blocker 2 fix).
 * This replaces delegation to Core's isMessageAllowedInPhase() for session messages.
 * Core's table doesn't cover stream.event/stream.ack/heartbeat.
 */
const SESSION_PHASE_ALLOWED: Record<SessionPhase, Set<string>> = {
  unattached: new Set([
    "session.start",
    "session.resume",
  ]),
  attached: new Set([
    "session.start",       // re-attach
    "session.resume",      // reconnect
    "session.cancel",
    "session.end",
    "session.stream.event",
    "session.stream.ack",
    "session.heartbeat",
  ]),
  turn_running: new Set([
    "session.cancel",
    "session.end",
    "session.stream.event",
    "session.stream.ack",
    "session.heartbeat",
  ]),
  ended: new Set([
    "session.heartbeat",  // final heartbeat before close
  ]),
};

export function isSessionMessageAllowedInPhase(
  phase: SessionPhase,
  messageType: string,
): boolean {
  if (!SESSION_MESSAGE_TYPES.has(messageType)) return false;
  const allowed = SESSION_PHASE_ALLOWED[phase];
  return allowed ? allowed.has(messageType) : false;
}

export function assertSessionPhaseAllowed(
  phase: SessionPhase,
  messageType: string,
): void {
  if (!isSessionMessageAllowedInPhase(phase, messageType)) {
    throw new NacpSessionError(
      [`session message '${messageType}' not allowed in phase '${phase}'`],
      SESSION_ERROR_CODES.NACP_SESSION_INVALID_PHASE,
    );
  }
}
