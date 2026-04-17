/**
 * NACP Admissibility Check — runtime delivery policy, separate from schema validation.
 *
 * validate() checks structural correctness (layers 1-5).
 * checkAdmissibility() checks runtime delivery policies:
 *   - deadline_ms expiry
 *   - capability_scope
 *   - session phase state machine (if phase provided)
 *
 * GPT review §2.10c: deadline is delivery policy, not schema validation.
 * GPT code-review §2.3: state machine must be wired into admissibility.
 */

import { NacpAdmissibilityError } from "./errors.js";
import type { NacpEnvelope } from "./envelope.js";
import { isMessageAllowedInPhase, type SessionPhase } from "./state-machine.js";

export interface AdmissibilityContext {
  granted_capabilities?: Set<string>;
  /** Current session phase. When provided, message_type is checked against phase rules. */
  session_phase?: SessionPhase;
}

export function checkAdmissibility(
  env: NacpEnvelope,
  ctx: AdmissibilityContext = {},
): void {
  // Deadline check
  if (
    env.control?.deadline_ms !== undefined &&
    Date.now() > env.control.deadline_ms
  ) {
    throw new NacpAdmissibilityError(
      "NACP_DEADLINE_EXCEEDED",
      `message deadline ${env.control.deadline_ms} has passed (now: ${Date.now()})`,
    );
  }

  // Capability scope check
  if (env.control?.capability_scope && ctx.granted_capabilities) {
    for (const required of env.control.capability_scope) {
      if (!ctx.granted_capabilities.has(required)) {
        throw new NacpAdmissibilityError(
          "NACP_CAPABILITY_DENIED",
          `required capability '${required}' not granted`,
        );
      }
    }
  }

  // Session phase state machine check
  if (ctx.session_phase) {
    if (!isMessageAllowedInPhase(ctx.session_phase, env.header.message_type)) {
      throw new NacpAdmissibilityError(
        "NACP_STATE_MACHINE_VIOLATION",
        `message_type '${env.header.message_type}' not allowed in session phase '${ctx.session_phase}'`,
      );
    }
  }
}
