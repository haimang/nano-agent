/**
 * Turn Ingress Contract — explicitly documents the current minimal reality
 * for how user turns enter the Session DO.
 *
 * Current state (v1):
 *   - Only `session.start` with `initial_input` is a known turn ingress path.
 *   - Follow-up turn input (e.g. user replies mid-conversation) is NOT yet
 *     frozen in the NACP-Session profile.
 *
 * This module makes that gap explicit in code, not just in docs, so that
 * downstream consumers (kernel, workspace) can depend on a stable contract
 * and will get a compile-time signal when the ingress family expands.
 *
 * Reference: docs/action-plan/session-do-runtime.md Phase 1 (P1-01 to P1-03)
 * Reference code: packages/nacp-session/src/ingress.ts (normalizeClientFrame)
 */

// ── Turn Ingress Kind ──

/**
 * Discriminant for turn input sources.
 *
 *   "session-start-initial-input" — the only v1 reality: session.start body contains initial_input
 *   "future-prompt-family"        — placeholder for follow-up prompt messages (not yet frozen)
 */
export type TurnIngressKind =
  | "session-start-initial-input"
  | "future-prompt-family";

// ── Turn Input ──

/**
 * Normalized turn input that the kernel can consume.
 *
 * Regardless of how the turn arrived (session.start, future prompt message),
 * the kernel always receives a TurnInput with content, a turnId, and a timestamp.
 */
export interface TurnInput {
  readonly kind: TurnIngressKind;
  readonly content: string;
  readonly turnId: string;
  readonly receivedAt: string;
}

// ── Ingress Note ──

/**
 * Documents that follow-up turn input is NOT yet frozen.
 *
 * This constant exists so that code and generated docs both carry the same
 * caveat. When the NACP-Session profile freezes the follow-up prompt family,
 * this note should be updated and the "future-prompt-family" kind should be
 * replaced with concrete message types.
 */
export const TURN_INGRESS_NOTE =
  "Follow-up turn input (user replies after session.start) is NOT yet frozen " +
  "in the NACP-Session profile. The 'future-prompt-family' TurnIngressKind is " +
  "a placeholder. The concrete message type(s), body schema, and delivery " +
  "semantics will be added in a future NACP-Session version. Until then, only " +
  "'session-start-initial-input' is a supported ingress path.";

// ── Extract Turn Input ──

/**
 * Extracts a TurnInput from an incoming message, or returns null if the
 * message is not a recognized turn ingress.
 *
 * v1 reality: only handles `session.start` with a body containing `initial_input`.
 * All other message types return null.
 *
 * @param messageType - The NACP message_type string (e.g. "session.start")
 * @param body - The parsed message body (unknown shape, validated here)
 * @returns TurnInput if the message carries turn content, null otherwise
 */
export function extractTurnInput(
  messageType: string,
  body: unknown,
): TurnInput | null {
  if (messageType !== "session.start") {
    return null;
  }

  if (
    body === null ||
    body === undefined ||
    typeof body !== "object"
  ) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const initialInput = record["initial_input"];

  if (typeof initialInput !== "string" || initialInput.length === 0) {
    return null;
  }

  return {
    kind: "session-start-initial-input",
    content: initialInput,
    turnId: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
  };
}
