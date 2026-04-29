/**
 * Turn Ingress Contract — the canonical adapter from a normalized session
 * frame onto a kernel-friendly `TurnInput`.
 *
 * A4 P1-01 (Phase 0 widened surface):
 *   - The legacy `future-prompt-family` placeholder is gone. The Phase 0
 *     contract freeze (AX-QNA Q8) added `session.followup_input` to the
 *     `nacp-session` truth, and this module now consumes it directly.
 *   - The two ingress kinds are:
 *       * `session-start-initial-input` — first turn carried by
 *         `session.start.body.initial_input`
 *       * `session-followup-input`      — subsequent turn(s) carried by
 *         `session.followup_input.body.text`
 *   - Anything else returns `null`. The runtime never invents a third
 *     ingress family.
 *
 * Reference code: `packages/nacp-session/src/{messages,ingress}.ts`
 */

// ── Turn Ingress Kind ──

/**
 * Discriminant for turn input sources. Both kinds are first-class — the
 * runtime treats follow-up input as just another turn for the purposes
 * of `single-active-turn` admissibility (A4 P3-02).
 */
export type TurnIngressKind =
  | "session-start-initial-input"
  | "session-followup-input";

// ── Turn Input ──

/**
 * Normalized turn input that the kernel can consume.
 *
 * Regardless of how the turn arrived, the kernel always receives a
 * `TurnInput` with content, a turnId, a receivedAt, and the originating
 * `messageType`. `messageType` lets the orchestrator and traces explain
 * which session message this turn came from without losing the legality
 * gate's verdict.
 */
export interface TurnInput {
  readonly kind: TurnIngressKind;
  readonly content: string;
  readonly parts?: readonly unknown[];
  readonly modelId?: string;
  readonly reasoning?: { readonly effort: "low" | "medium" | "high" };
  readonly turnId: string;
  readonly receivedAt: string;
  readonly messageType: "session.start" | "session.followup_input";
}

// ── Ingress Note ──

/**
 * Documents the post-Phase 0 reality: the widened session ingress surface
 * is now `session.start.initial_input` + `session.followup_input.text`.
 * This constant exists so generated docs and prompt disclosures stay in
 * sync with the code without anyone having to re-discover the contract.
 */
export const TURN_INGRESS_NOTE =
  "Session DO accepts two turn ingress paths: 'session.start' with a non-empty " +
  "initial_input (first turn) and 'session.followup_input' with a non-empty text " +
  "(follow-up turns). Both run through nacp-session's normalizeClientFrame and " +
  "are subject to the role/phase legality gate. Richer queue / replace / merge " +
  "semantics are explicitly out of scope and remain for a future session protocol cut.";

// ── Extract Turn Input ──

/**
 * Extracts a `TurnInput` from an incoming message body, or returns null
 * if the message is not a recognised turn ingress. The caller is
 * responsible for having already run the message through
 * `normalizeClientFrame()` so that `messageType` and `body` arrive
 * already-validated against the nacp-session schemas.
 */
export function extractTurnInput(
  messageType: string,
  body: unknown,
): TurnInput | null {
  if (body === null || body === undefined || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  const modelId = typeof record.model_id === "string" && record.model_id.length > 0
    ? record.model_id
    : undefined;
  const reasoning =
    record.reasoning &&
    typeof record.reasoning === "object" &&
    !Array.isArray(record.reasoning) &&
    ((record.reasoning as Record<string, unknown>).effort === "low" ||
      (record.reasoning as Record<string, unknown>).effort === "medium" ||
      (record.reasoning as Record<string, unknown>).effort === "high")
      ? { effort: (record.reasoning as { effort: "low" | "medium" | "high" }).effort }
      : undefined;
  const parts = Array.isArray(record.parts) ? record.parts : undefined;

  if (messageType === "session.start") {
    const initialInput = record["initial_input"];
    if (typeof initialInput !== "string" || initialInput.length === 0) {
      return null;
    }
    return {
      kind: "session-start-initial-input",
      content: initialInput,
      ...(modelId ? { modelId } : {}),
      ...(reasoning ? { reasoning } : {}),
      turnId: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      messageType: "session.start",
    };
  }

  if (messageType === "session.followup_input") {
    const text = record["text"];
    if (typeof text !== "string" || text.length === 0) {
      return null;
    }
    return {
      kind: "session-followup-input",
      content: text,
      ...(parts ? { parts } : {}),
      ...(modelId ? { modelId } : {}),
      ...(reasoning ? { reasoning } : {}),
      turnId: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      messageType: "session.followup_input",
    };
  }

  return null;
}
