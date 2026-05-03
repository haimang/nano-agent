/**
 * Agent Runtime Kernel — Reducer
 *
 * Pure-function reducer that handles ALL state transitions.
 * No delegate should directly mutate state — all changes flow through
 * applyAction which returns a new KernelSnapshot.
 */

import type { KernelSnapshot, PendingToolCall, TurnState } from "./state.js";
import type { KernelPhase, InterruptReason } from "./types.js";
import { createTurnState } from "./state.js";
import { KernelError, KERNEL_ERROR_CODES } from "./errors.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Action Discriminated Union
// ═══════════════════════════════════════════════════════════════════

export type KernelAction =
  | { type: "start_turn"; turnId: string }
  | { type: "complete_step"; stepIndex: number; result: unknown }
  | {
      type: "llm_response";
      content: unknown;
      usage?: { inputTokens: number; outputTokens: number };
    }
  | {
      type: "tool_calls_requested";
      calls: Array<{ id: string; name: string; input?: unknown }>;
    }
  | { type: "tool_result"; callId: string; result: unknown }
  | { type: "interrupt"; reason: InterruptReason }
  | { type: "input_arrived"; input: unknown }
  | { type: "resume" }
  | { type: "complete_turn"; reason: string }
  | { type: "end_session" }
  | { type: "compact_done"; tokensFreed: number; messages?: unknown[] };

// ═══════════════════════════════════════════════════════════════════
// §2 — Helper: require active turn
// ═══════════════════════════════════════════════════════════════════

function requireActiveTurn(snapshot: KernelSnapshot): TurnState {
  if (!snapshot.activeTurn) {
    throw new KernelError(
      KERNEL_ERROR_CODES.TURN_NOT_FOUND,
      "No active turn in snapshot",
    );
  }
  return snapshot.activeTurn;
}

// ═══════════════════════════════════════════════════════════════════
// §3 — applyAction
// ═══════════════════════════════════════════════════════════════════

export function applyAction(
  state: KernelSnapshot,
  action: KernelAction,
): KernelSnapshot {
  switch (action.type) {
    // ── start_turn ──────────────────────────────────────────────
    case "start_turn": {
      if (state.session.phase !== "idle") {
        throw new KernelError(
          KERNEL_ERROR_CODES.ILLEGAL_PHASE_TRANSITION,
          `Cannot start turn: phase is "${state.session.phase}", expected "idle"`,
        );
      }
      if (state.activeTurn) {
        throw new KernelError(
          KERNEL_ERROR_CODES.TURN_ALREADY_ACTIVE,
          `Turn "${state.activeTurn.turnId}" is already active`,
        );
      }
      const newTurn = createTurnState(action.turnId);
      return {
        ...state,
        session: { ...state.session, phase: "turn_running" },
        activeTurn: { ...newTurn, phase: "running" },
      };
    }

    // ── complete_step ───────────────────────────────────────────
    case "complete_step": {
      const turn = requireActiveTurn(state);
      // Only advance the step counter; do NOT append to messages.
      // The originating action (llm_response / tool_result) is
      // responsible for recording the payload in the message log.
      return {
        ...state,
        activeTurn: {
          ...turn,
          stepIndex: action.stepIndex + 1,
        },
      };
    }

    // ── llm_response ────────────────────────────────────────────
    case "llm_response": {
      const turn = requireActiveTurn(state);
      const tokenDelta =
        action.usage
          ? action.usage.inputTokens + action.usage.outputTokens
          : 0;
      return {
        ...state,
        session: {
          ...state.session,
          totalTokens: state.session.totalTokens + tokenDelta,
        },
        activeTurn: {
          ...turn,
          messages:
            action.content === null || action.content === undefined
              ? turn.messages
              : [...turn.messages, action.content],
          llmFinished: true,
        },
      };
    }

    // ── tool_calls_requested ────────────────────────────────────
    case "tool_calls_requested": {
      const turn = requireActiveTurn(state);
      const newCalls: PendingToolCall[] = action.calls.map((c) => ({
        callId: c.id,
        toolName: c.name,
        toolInput: c.input ?? null,
      }));
      return {
        ...state,
        activeTurn: {
          ...turn,
          pendingToolCalls: [...turn.pendingToolCalls, ...newCalls],
          messages: [
            ...turn.messages,
            {
              role: "assistant",
              content: action.calls.map((call) => ({
                kind: "tool_call",
                id: call.id,
                name: call.name,
                arguments: JSON.stringify(call.input ?? {}),
              })),
            },
          ],
        },
      };
    }

    // ── tool_result ─────────────────────────────────────────────
    case "tool_result": {
      const turn = requireActiveTurn(state);
      return {
        ...state,
        activeTurn: {
          ...turn,
          pendingToolCalls: turn.pendingToolCalls.filter(
            (descriptor) => descriptor.callId !== action.callId,
          ),
          messages: [
            ...turn.messages,
            {
              role: "tool",
              toolCallId: action.callId,
              content:
                typeof action.result === "string"
                  ? action.result
                  : JSON.stringify(action.result),
            },
          ],
          llmFinished: false,
        },
      };
    }

    // ── interrupt ───────────────────────────────────────────────
    case "interrupt": {
      const phase = state.session.phase;
      if (phase !== "turn_running") {
        throw new KernelError(
          KERNEL_ERROR_CODES.ILLEGAL_PHASE_TRANSITION,
          `Cannot interrupt: phase is "${phase}", expected "turn_running"`,
        );
      }
      const turn = requireActiveTurn(state);
      const targetPhase: KernelPhase =
        action.reason === "fatal_error" ? "interrupted" : "waiting";
      return {
        ...state,
        session: {
          ...state.session,
          phase: targetPhase,
        },
        activeTurn: {
          ...turn,
          interruptReason: action.reason,
        },
      };
    }

    // ── input_arrived ───────────────────────────────────────────
    case "input_arrived": {
      // Buffers external input while the turn is suspended. The
      // buffered input is consumed by the next `resume` action.
      const turn = requireActiveTurn(state);
      return {
        ...state,
        activeTurn: {
          ...turn,
          pendingInput: action.input,
        },
      };
    }

    // ── resume ──────────────────────────────────────────────────
    case "resume": {
      if (state.session.phase !== "waiting") {
        throw new KernelError(
          KERNEL_ERROR_CODES.ILLEGAL_PHASE_TRANSITION,
          `Cannot resume: phase is "${state.session.phase}", expected "waiting"`,
        );
      }
      const turn = requireActiveTurn(state);
      // If input was buffered while waiting, fold it into the message
      // log and clear the buffer before returning to `turn_running`.
      const messages = turn.pendingInput !== null
        ? [...turn.messages, turn.pendingInput]
        : turn.messages;
      return {
        ...state,
        session: { ...state.session, phase: "turn_running" },
        activeTurn: {
          ...turn,
          interruptReason: null,
          messages,
          llmFinished: false,
          pendingInput: null,
        },
      };
    }

    // ── complete_turn ───────────────────────────────────────────
    case "complete_turn": {
      if (state.session.phase !== "turn_running") {
        throw new KernelError(
          KERNEL_ERROR_CODES.ILLEGAL_PHASE_TRANSITION,
          `Cannot complete turn: phase is "${state.session.phase}", expected "turn_running"`,
        );
      }
      return {
        ...state,
        session: {
          ...state.session,
          phase: "idle",
          turnCount: state.session.turnCount + 1,
        },
        activeTurn: null,
      };
    }

    // ── end_session ─────────────────────────────────────────────
    case "end_session": {
      return {
        ...state,
        session: { ...state.session, phase: "ended" },
        activeTurn: null,
      };
    }

    // ── compact_done ────────────────────────────────────────────
    case "compact_done": {
      const turn = state.activeTurn;
      return {
        ...state,
        session: {
          ...state.session,
          totalTokens: Math.max(
            0,
            state.session.totalTokens - action.tokensFreed,
          ),
          compactCount: state.session.compactCount + 1,
        },
        activeTurn:
          turn && Array.isArray(action.messages)
            ? {
                ...turn,
                messages: action.messages,
              }
            : turn,
      };
    }

    default: {
      // Exhaustiveness check
      const _exhaustive: never = action;
      throw new KernelError(
        KERNEL_ERROR_CODES.ILLEGAL_PHASE_TRANSITION,
        `Unknown action type: ${(_exhaustive as KernelAction).type}`,
      );
    }
  }
}
