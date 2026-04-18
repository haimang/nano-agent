/**
 * Session DO Runtime — Session Edge Adapter (A4 Phase 1).
 *
 * Wraps the nacp-session truth so the Durable Object never has to look at
 * raw JSON itself. Two responsibilities:
 *
 *   1. **Decode + normalize.** Parse the wire bytes once, ask
 *      `nacp-session` to authority-stamp + schema-validate the client
 *      frame, and produce a typed `IngressEnvelope` that downstream
 *      `WsController` / `HttpController` / `NanoSessionDO` can dispatch
 *      from. All schema and legality work lives here, not in the DO.
 *
 *   2. **Phase / role legality gate.** Defer to
 *      `assertSessionPhaseAllowed` and `assertSessionRoleAllowed` from
 *      `nacp-session/session-registry` so that the DO never maintains a
 *      parallel legality matrix.
 *
 * Design contract:
 *   - The DO MUST go through `acceptIngress()` for every incoming
 *     client frame (WS or HTTP). Bypassing it is a contract violation.
 *   - When the legality gate rejects, the DO is given a typed
 *     `IngressRejection` instead of a thrown error. The DO can decide
 *     whether to log + close, send a `system.notify`, or surface a 4xx
 *     response — but it never silently continues.
 */

import {
  normalizeClientFrame,
  validateSessionFrame,
  assertSessionPhaseAllowed,
  assertSessionRoleAllowed,
  isSessionMessageAllowedInPhase,
  type IngressContext,
  type NacpClientFrame,
  type NacpSessionFrame,
  type SessionPhase,
} from "@nano-agent/nacp-session";

// ─────────────────────────────────────────────────────────────────────
// Result types
// ─────────────────────────────────────────────────────────────────────

/** Outcome of `acceptIngress()` — either an admissible frame or a typed rejection. */
export type IngressEnvelope =
  | {
      readonly ok: true;
      readonly frame: NacpSessionFrame;
      readonly messageType: string;
      readonly body: Record<string, unknown> | undefined;
    }
  | IngressRejection;

export interface IngressRejection {
  readonly ok: false;
  readonly reason: IngressRejectionReason;
  readonly message: string;
  /** Optional message_type if it was successfully parsed before the rejection. */
  readonly messageType?: string;
}

export type IngressRejectionReason =
  | "invalid-json"
  | "schema-invalid"
  | "phase-illegal"
  | "role-illegal"
  | "internal";

// ─────────────────────────────────────────────────────────────────────
// Acceptance
// ─────────────────────────────────────────────────────────────────────

export interface AcceptIngressInput {
  /** Wire payload — string for WS, decoded JSON allowed for HTTP fallback. */
  readonly raw: string | unknown;
  /** Authority context derived from the DO's binding / route. */
  readonly authority: IngressContext;
  /** Per-stream sequence assigned by the DO. */
  readonly streamSeq: number;
  /** Stream UUID assigned by the DO. */
  readonly streamUuid: string;
  /** Current actor phase — used for the phase gate. */
  readonly phase: SessionPhase;
}

/**
 * Decode + normalize + legality-gate a client frame. Returns either a
 * typed `IngressEnvelope` carrying the validated session frame, or an
 * `IngressRejection` describing exactly why the frame is not admissible.
 */
export function acceptIngress(input: AcceptIngressInput): IngressEnvelope {
  const { raw, authority, streamSeq, streamUuid, phase } = input;

  // 1. Wire decode (only when given a string; HTTP fallback supplies a parsed object).
  let parsed: unknown;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return {
        ok: false,
        reason: "invalid-json",
        message: `failed to parse wire frame: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  } else {
    parsed = raw;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: "schema-invalid",
      message: "ingress payload is not a JSON object",
    };
  }

  // 2. Authority stamp + schema validation (nacp-session is the truth).
  let frame: NacpSessionFrame;
  try {
    const candidate = parsed as NacpClientFrame;
    frame = normalizeClientFrame(candidate, authority, streamSeq, streamUuid);
  } catch (e) {
    return {
      ok: false,
      reason: "schema-invalid",
      message: `nacp-session rejected the client frame: ${
        e instanceof Error ? e.message : String(e)
      }`,
      messageType:
        typeof (parsed as { header?: { message_type?: unknown } }).header
          ?.message_type === "string"
          ? ((parsed as { header: { message_type: string } }).header
              .message_type as string)
          : undefined,
    };
  }

  // Defensive double-check — the assembled frame must still parse.
  try {
    validateSessionFrame(frame);
  } catch (e) {
    return {
      ok: false,
      reason: "internal",
      message: `assembled frame failed re-validation: ${
        e instanceof Error ? e.message : String(e)
      }`,
      messageType: frame.header.message_type,
    };
  }

  const messageType = frame.header.message_type;

  // 3. Phase gate.
  if (!isSessionMessageAllowedInPhase(phase, messageType)) {
    try {
      assertSessionPhaseAllowed(phase, messageType);
    } catch (e) {
      return {
        ok: false,
        reason: "phase-illegal",
        message: e instanceof Error ? e.message : String(e),
        messageType,
      };
    }
  }

  // 4. Role gate (client → produce).
  try {
    assertSessionRoleAllowed(frame.header.producer_role, messageType, "produce");
  } catch (e) {
    return {
      ok: false,
      reason: "role-illegal",
      message: e instanceof Error ? e.message : String(e),
      messageType,
    };
  }

  return {
    ok: true,
    frame,
    messageType,
    body: (frame.body ?? undefined) as Record<string, unknown> | undefined,
  };
}
