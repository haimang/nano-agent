/**
 * Session DO Runtime — Session actor internal state.
 *
 * Defines the state machine for a session actor's lifecycle phases
 * and provides pure-function transitions between them.
 *
 * Phase transitions:
 *   unattached -> attached      (client connects)
 *   attached   -> turn_running  (turn begins)
 *   turn_running -> attached    (turn completes)
 *   attached   -> ended         (session.end received)
 *   turn_running -> ended       (forced end)
 *   unattached -> ended         (timeout / cleanup)
 *
 * Reference: docs/action-plan/session-do-runtime.md Phase 3
 */

import type { TurnInput } from "./turn-ingress.js";

/** Valid phases in the session actor lifecycle. */
export type ActorPhase = "unattached" | "attached" | "turn_running" | "ended";

/** Immutable snapshot of a session actor's internal state. */
export interface ActorState {
  readonly phase: ActorPhase;
  readonly activeTurnId: string | null;
  readonly pendingInputs: TurnInput[];
  readonly attachedAt: string | null;
  readonly lastCheckpointAt: string | null;
}

/**
 * Create the initial actor state for a new session.
 * Starts in the "unattached" phase with no active turn.
 */
export function createInitialActorState(): ActorState {
  return {
    phase: "unattached",
    activeTurnId: null,
    pendingInputs: [],
    attachedAt: null,
    lastCheckpointAt: null,
  };
}

/**
 * Produce a new ActorState with the phase transitioned to `newPhase`.
 *
 * This is a pure function — it returns a new state object without
 * mutating the input. Side-effect fields (attachedAt) are updated
 * based on the target phase.
 *
 * @throws Error if the transition is invalid
 */
export function transitionPhase(
  state: ActorState,
  newPhase: ActorPhase,
): ActorState {
  validateTransition(state.phase, newPhase);

  const now = new Date().toISOString();

  switch (newPhase) {
    case "attached":
      return {
        ...state,
        phase: "attached",
        attachedAt: state.attachedAt ?? now,
        activeTurnId: null,
      };

    case "turn_running":
      return {
        ...state,
        phase: "turn_running",
      };

    case "ended":
      return {
        ...state,
        phase: "ended",
        activeTurnId: null,
      };

    case "unattached":
      return {
        ...state,
        phase: "unattached",
        attachedAt: null,
      };
  }
}

// ── Transition validation ──

const VALID_TRANSITIONS: Record<ActorPhase, ActorPhase[]> = {
  unattached: ["attached", "ended"],
  attached: ["turn_running", "ended", "unattached"],
  turn_running: ["attached", "ended"],
  ended: [],
};

function validateTransition(from: ActorPhase, to: ActorPhase): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid phase transition: ${from} -> ${to}. Allowed transitions from "${from}": [${allowed.join(", ")}]`,
    );
  }
}
