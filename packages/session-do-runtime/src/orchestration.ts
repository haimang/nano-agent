/**
 * Session DO Runtime — Kernel Orchestration.
 *
 * The heart of Wave 4: the Session DO drives the kernel step-by-step,
 * dispatches runtime events to the stream, emits hooks at lifecycle
 * boundaries, and emits traces for observability.
 *
 * The orchestrator is a pure coordination layer — it does not import
 * kernel internals directly. All capabilities come through the
 * `OrchestrationDeps` interface, making it testable with mock deps and
 * decoupled from concrete subsystem implementations.
 *
 * Stream-event discipline
 * -----------------------
 * Every `pushStreamEvent(kind, body)` call MUST emit a body that parses
 * under `@nano-agent/nacp-session`'s `SessionStreamEventBodySchema` (9
 * discriminated kinds). The orchestrator no longer invents `turn.started`
 * / `turn.cancelled` / `session.ended` kinds:
 *
 *   - Turn start  → `turn.begin` with `{ kind, turn_uuid }`.
 *   - Turn end    → `turn.end`   with `{ kind, turn_uuid, usage? }`.
 *   - Turn cancel → `system.notify` with `{ kind, severity: "warning", message }`.
 *   - Session end → `system.notify` with `{ kind, severity: "info", message }`.
 *   - Step-budget exhaustion → `system.notify` with `{ kind, severity: "warning", message }`.
 *
 * The `kind` field is deliberately duplicated inside `body` because the
 * Session profile uses a discriminated union on `kind`; callers can
 * `SessionStreamEventBodySchema.parse(body)` directly.
 *
 * Reference: docs/action-plan/session-do-runtime.md Phase 4
 */

import type { ActorState } from "./actor-state.js";
import { createInitialActorState, transitionPhase } from "./actor-state.js";
import type { TurnInput } from "./turn-ingress.js";
import type { RuntimeConfig } from "./env.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — OrchestrationDeps
// ═══════════════════════════════════════════════════════════════════

/**
 * Dependencies injected into the SessionOrchestrator.
 *
 * Each function maps to a subsystem capability the orchestrator needs.
 * All are async to support cross-DO / cross-worker calls.
 */
export interface OrchestrationDeps {
  // ── Kernel ──
  readonly advanceStep: (
    snapshot: unknown,
    signals: unknown,
  ) => Promise<{ snapshot: unknown; events: unknown[]; done: boolean }>;
  readonly buildCheckpoint: (snapshot: unknown) => unknown;
  readonly restoreCheckpoint: (fragment: unknown) => unknown;
  readonly createSessionState: () => unknown;
  readonly createTurnState: (turnId: string) => unknown;

  // ── Subsystems ──
  readonly emitHook: (
    event: string,
    payload: unknown,
    context?: unknown,
  ) => Promise<unknown>;
  readonly emitTrace: (event: unknown) => Promise<void>;

  // ── Session stream ──
  /**
   * Push a session stream event. `kind` MUST be one of the 9 canonical
   * session.stream.event kinds. `body` MUST parse under
   * `SessionStreamEventBodySchema` and therefore include the same
   * `kind` field as its discriminator.
   */
  readonly pushStreamEvent: (kind: string, body: Record<string, unknown>) => void;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — OrchestrationState
// ═══════════════════════════════════════════════════════════════════

/**
 * Immutable state blob that the orchestrator threads through every
 * lifecycle method. Contains both the session-actor state and the
 * kernel snapshot.
 */
export interface OrchestrationState {
  readonly actorState: ActorState;
  readonly kernelSnapshot: unknown;
  readonly turnCount: number;
}

// ═══════════════════════════════════════════════════════════════════
// §3 — SessionOrchestrator
// ═══════════════════════════════════════════════════════════════════

export class SessionOrchestrator {
  constructor(
    private readonly deps: OrchestrationDeps,
    private readonly config: RuntimeConfig,
  ) {}

  // ── Initial state ────────────────────────────────────────────

  /**
   * Create the initial orchestration state for a fresh session.
   * Both the actor and kernel start in their idle/unattached phases.
   */
  createInitialState(): OrchestrationState {
    const sessionState = this.deps.createSessionState();
    return {
      actorState: createInitialActorState(),
      kernelSnapshot: { session: sessionState, activeTurn: null, version: "0.1.0" },
      turnCount: 0,
    };
  }

  // ── Start Turn ───────────────────────────────────────────────

  async startTurn(
    state: OrchestrationState,
    input: TurnInput,
  ): Promise<OrchestrationState> {
    // 1. Emit hooks — SessionStart for the first turn, UserPromptSubmit always.
    if (state.turnCount === 0) {
      await this.deps.emitHook("SessionStart", {
        sessionId: input.turnId,
        content: input.content,
      });
    }
    await this.deps.emitHook("UserPromptSubmit", {
      turnId: input.turnId,
      content: input.content,
    });

    // 2. Transition actor: unattached → attached → turn_running.
    let actorState = state.actorState;
    if (actorState.phase === "unattached") {
      actorState = transitionPhase(actorState, "attached");
    }
    actorState = transitionPhase(actorState, "turn_running");
    actorState = { ...actorState, activeTurnId: input.turnId } as ActorState;

    // 3. Create turn state in the kernel snapshot.
    const turnState = this.deps.createTurnState(input.turnId);
    const kernelSnapshot = {
      ...(state.kernelSnapshot as Record<string, unknown>),
      activeTurn: turnState,
      session: {
        ...((state.kernelSnapshot as Record<string, unknown>).session as Record<string, unknown>),
        phase: "turn_running",
      },
    };

    // 4. Emit the canonical `turn.begin` stream event.
    this.deps.pushStreamEvent("turn.begin", {
      kind: "turn.begin",
      turn_uuid: input.turnId,
    });

    // 5. Emit a trace event for observability (not client-visible).
    await this.deps.emitTrace({
      eventKind: "turn.begin",
      turnId: input.turnId,
      timestamp: new Date().toISOString(),
    });

    const newState: OrchestrationState = {
      actorState,
      kernelSnapshot,
      turnCount: state.turnCount + 1,
    };

    return this.runStepLoop(newState);
  }

  // ── Step Loop ────────────────────────────────────────────────

  /**
   * Advance the kernel step-by-step until done or interrupted.
   */
  async runStepLoop(state: OrchestrationState): Promise<OrchestrationState> {
    let snapshot = state.kernelSnapshot;
    let stepCount = 0;

    while (stepCount < this.config.maxTurnSteps) {
      const signals = {
        hasMoreToolCalls: false,
        compactRequired: false,
        cancelRequested: false,
        timeoutReached: false,
        llmFinished: false,
      };

      const result = await this.deps.advanceStep(snapshot, signals);
      snapshot = result.snapshot;
      stepCount += 1;

      // Dispatch each emitted event — kernel events must already be in
      // `SessionStreamEventBody` shape.
      for (const event of result.events) {
        const evt = event as Record<string, unknown>;
        const kind = typeof evt["kind"] === "string" ? (evt["kind"] as string) : "system.notify";
        this.deps.pushStreamEvent(kind, evt);
      }

      if (result.done) {
        // Turn is complete — emit a canonical `turn.end` and transition
        // the actor back to attached.
        const activeTurnId = state.actorState.activeTurnId;
        if (activeTurnId) {
          this.deps.pushStreamEvent("turn.end", {
            kind: "turn.end",
            turn_uuid: activeTurnId,
          });
        }

        let actorState = state.actorState;
        if (actorState.phase === "turn_running") {
          actorState = transitionPhase(actorState, "attached");
        }

        // Checkpoint if configured.
        if (this.config.checkpointOnTurnEnd) {
          this.deps.buildCheckpoint(snapshot);
        }

        return {
          actorState,
          kernelSnapshot: snapshot,
          turnCount: state.turnCount,
        };
      }
    }

    // Step budget exhausted — treat as interruption.
    this.deps.pushStreamEvent("system.notify", {
      kind: "system.notify",
      severity: "warning",
      message: `Step budget exhausted after ${stepCount} steps`,
    });

    let actorState = state.actorState;
    if (actorState.phase === "turn_running") {
      actorState = transitionPhase(actorState, "attached");
    }

    return {
      actorState,
      kernelSnapshot: snapshot,
      turnCount: state.turnCount,
    };
  }

  // ── Cancel Turn ──────────────────────────────────────────────

  async cancelTurn(state: OrchestrationState): Promise<OrchestrationState> {
    const cancelSignals = {
      hasMoreToolCalls: false,
      compactRequired: false,
      cancelRequested: true,
      timeoutReached: false,
      llmFinished: false,
    };

    const result = await this.deps.advanceStep(
      state.kernelSnapshot,
      cancelSignals,
    );

    // Cancellation surfaces to the client as a system.notify with
    // severity=warning. `turn.cancelled` is NOT a session.stream.event kind.
    this.deps.pushStreamEvent("system.notify", {
      kind: "system.notify",
      severity: "warning",
      message: state.actorState.activeTurnId
        ? `Turn ${state.actorState.activeTurnId} cancelled`
        : "Turn cancelled",
    });

    let actorState = state.actorState;
    if (actorState.phase === "turn_running") {
      actorState = transitionPhase(actorState, "attached");
    }

    return {
      actorState,
      kernelSnapshot: result.snapshot,
      turnCount: state.turnCount,
    };
  }

  // ── End Session ──────────────────────────────────────────────

  async endSession(state: OrchestrationState): Promise<OrchestrationState> {
    await this.deps.emitHook("SessionEnd", {
      turnCount: state.turnCount,
      timestamp: new Date().toISOString(),
    });

    await this.deps.emitTrace({
      eventKind: "session.ended",
      timestamp: new Date().toISOString(),
    });

    // Session end surfaces to the client as a system.notify with
    // severity=info. `session.ended` is NOT a session.stream.event kind.
    this.deps.pushStreamEvent("system.notify", {
      kind: "system.notify",
      severity: "info",
      message: `Session ended (turnCount=${state.turnCount})`,
    });

    let actorState = state.actorState;
    if (actorState.phase !== "ended") {
      if (actorState.phase === "turn_running") {
        actorState = transitionPhase(actorState, "attached");
      }
      actorState = transitionPhase(actorState, "ended");
    }

    // Final checkpoint
    this.deps.buildCheckpoint(state.kernelSnapshot);

    return {
      actorState,
      kernelSnapshot: state.kernelSnapshot,
      turnCount: state.turnCount,
    };
  }
}
