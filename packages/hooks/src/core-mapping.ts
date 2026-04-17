/**
 * @nano-agent/hooks — codec between hook domain and `@nano-agent/nacp-core`
 * `hook.emit` / `hook.outcome` message bodies.
 *
 * The Core truth (mirrored here so this package doesn't hard-depend on
 * nacp-core) is:
 *
 *   HookEmitBody    = { event_name: string; event_payload: Record<string,unknown> }
 *   HookOutcomeBody = { ok: boolean;
 *                       block?: { reason: string };
 *                       updated_input?: unknown;
 *                       additional_context?: string;
 *                       stop?: boolean;
 *                       diagnostics?: string }
 *
 * Builders/parsers here are the sole point of translation between the
 * domain-level `HookOutcome` (which carries a discriminated `action` +
 * handler bookkeeping) and the Core wire body.
 */

import type { HookOutcome, HookOutcomeAction } from "./outcome.js";

// ══════════════════════════════════════════════════════════════════════
// §1 — hook.emit (request body from the session DO to a hook worker)
// ══════════════════════════════════════════════════════════════════════

/** Shape of the `hook.emit` message body (mirrors nacp-core). */
export interface HookEmitBody {
  readonly event_name: string;
  readonly event_payload: Record<string, unknown>;
}

/**
 * Build a `hook.emit` body for the given event name + payload.
 *
 * Accepts an object-shaped payload. Non-object payloads are wrapped into
 * `{ value: payload }` so the wire body always satisfies
 * `event_payload: Record<string, unknown>` per `nacp-core`.
 */
export function buildHookEmitBody(eventName: string, payload: unknown): HookEmitBody {
  if (!eventName || eventName.length === 0 || eventName.length > 64) {
    throw new Error(
      `Invalid hook.emit body: event_name must be 1-64 chars, got length ${eventName?.length ?? 0}`,
    );
  }

  const eventPayload: Record<string, unknown> =
    payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>) }
      : { value: payload };

  return { event_name: eventName, event_payload: eventPayload };
}

// ══════════════════════════════════════════════════════════════════════
// §2 — hook.outcome (response body from a hook worker)
// ══════════════════════════════════════════════════════════════════════

/** Shape of the `hook.outcome` message body (mirrors nacp-core). */
export interface HookOutcomeBody {
  readonly ok: boolean;
  readonly block?: { reason: string };
  readonly updated_input?: unknown;
  readonly additional_context?: string;
  readonly stop?: boolean;
  readonly diagnostics?: string;
}

/**
 * Parse a `hook.outcome` message body into a domain `HookOutcome`.
 *
 * `handlerId` and `durationMs` are NOT part of the wire body — they come
 * from the dispatcher's per-handler execution context and must be passed
 * in explicitly.
 *
 * Action derivation rules (in priority order):
 *   - `stop: true`          → action: "stop"
 *   - `block: { reason }`   → action: "block", blockReason carried via
 *                              additionalContext so the reducer can pick
 *                              it up without a second channel
 *   - otherwise             → action: "continue"
 */
export function parseHookOutcomeBody(
  body: unknown,
  context: { handlerId: string; durationMs: number },
): HookOutcome {
  if (body === null || body === undefined || typeof body !== "object") {
    throw new Error("Invalid hook.outcome body: expected an object");
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.ok !== "boolean") {
    throw new Error("Invalid hook.outcome body: missing or non-boolean 'ok'");
  }

  const hasBlock = obj.block !== undefined && obj.block !== null;
  if (hasBlock) {
    if (typeof obj.block !== "object" || obj.block === null) {
      throw new Error("Invalid hook.outcome body: 'block' must be an object with a 'reason' string");
    }
    const blockObj = obj.block as Record<string, unknown>;
    if (typeof blockObj.reason !== "string" || blockObj.reason.length === 0) {
      throw new Error("Invalid hook.outcome body: 'block.reason' must be a non-empty string");
    }
  }

  if (obj.stop !== undefined && typeof obj.stop !== "boolean") {
    throw new Error("Invalid hook.outcome body: 'stop' must be a boolean when present");
  }

  if (obj.additional_context !== undefined && typeof obj.additional_context !== "string") {
    throw new Error("Invalid hook.outcome body: 'additional_context' must be a string when present");
  }

  if (obj.diagnostics !== undefined && typeof obj.diagnostics !== "string") {
    throw new Error("Invalid hook.outcome body: 'diagnostics' must be a string when present");
  }

  // Derive the domain action from the wire fields.
  let action: HookOutcomeAction;
  if (obj.stop === true) {
    action = "stop";
  } else if (hasBlock) {
    action = "block";
  } else {
    action = "continue";
  }

  const additionalContext = hasBlock
    ? (obj.block as { reason: string }).reason
    : (obj.additional_context as string | undefined);

  return {
    action,
    handlerId: context.handlerId,
    durationMs: context.durationMs,
    updatedInput: obj.updated_input,
    additionalContext,
    diagnostics:
      typeof obj.diagnostics === "string" ? { message: obj.diagnostics } : undefined,
  };
}

/**
 * Inverse of `parseHookOutcomeBody`: render a domain `HookOutcome` into a
 * Core-compatible `hook.outcome` wire body. Useful for hook workers that
 * produce `HookOutcome` in TS and need to reply with a Core body.
 */
export function buildHookOutcomeBody(outcome: HookOutcome): HookOutcomeBody {
  const body: Record<string, unknown> = {
    ok: outcome.action !== "block",
  };

  if (outcome.action === "block") {
    body.block = { reason: outcome.additionalContext ?? `Blocked by handler ${outcome.handlerId}` };
  }

  if (outcome.action === "stop") {
    body.stop = true;
  }

  if (outcome.updatedInput !== undefined) {
    body.updated_input = outcome.updatedInput;
  }

  if (outcome.action !== "block" && typeof outcome.additionalContext === "string") {
    body.additional_context = outcome.additionalContext;
  }

  if (outcome.diagnostics !== undefined) {
    body.diagnostics =
      typeof (outcome.diagnostics as { message?: unknown }).message === "string"
        ? ((outcome.diagnostics as { message: string }).message)
        : JSON.stringify(outcome.diagnostics);
  }

  return body as unknown as HookOutcomeBody;
}
