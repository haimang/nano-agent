/**
 * Agent Runtime Kernel — Runner
 *
 * Step-driven runner that the Session DO calls step-by-step.
 * Each call to advanceStep:
 *   1. Consults the scheduler for what to do next
 *   2. Executes the step via the appropriate delegate
 *   3. Applies the resulting action(s) through the reducer
 *   4. Returns the new snapshot, emitted events, and done flag
 */

import type { KernelSnapshot } from "./state.js";
import type { KernelDelegates } from "./delegates.js";
import type { RuntimeEvent, StepDecision } from "./types.js";
import type { SchedulerSignals } from "./scheduler.js";
import { scheduleNextStep } from "./scheduler.js";
import { applyAction } from "./reducer.js";
import type { KernelAction } from "./reducer.js";
import { KernelError, KERNEL_ERROR_CODES } from "./errors.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — AdvanceStepResult
// ═══════════════════════════════════════════════════════════════════

export interface AdvanceStepResult {
  snapshot: KernelSnapshot;
  events: RuntimeEvent[];
  done: boolean;
}

export interface KernelRunnerHooks {
  beforeLlmInvoke?: (ctx: {
    readonly snapshot: KernelSnapshot;
    readonly turnId: string;
  }) => Promise<void> | void;
  afterLlmInvoke?: (ctx: {
    readonly snapshot: KernelSnapshot;
    readonly turnId: string;
    readonly usage?: { inputTokens: number; outputTokens: number };
    readonly content: string | null;
  }) => Promise<void> | void;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — KernelRunner
// ═══════════════════════════════════════════════════════════════════

export class KernelRunner {
  constructor(
    private delegates: KernelDelegates,
    private hooks: KernelRunnerHooks = {},
  ) {}

  async advanceStep(
    snapshot: KernelSnapshot,
    signals: SchedulerSignals,
  ): Promise<AdvanceStepResult> {
    const decision = scheduleNextStep(snapshot, signals);
    const now = new Date().toISOString();

    // Emit `turn.started` on the first step of a fresh turn. We detect
    // "first step" by the turn's `stepIndex === 0` + phase not yet
    // advanced past `turn_running`. This is the canonical lifecycle
    // anchor that session-do-runtime maps to the Session stream's
    // `turn.begin` kind via `session-stream-mapping.ts`.
    const lifecycleEvents: RuntimeEvent[] = [];
    if (
      snapshot.activeTurn &&
      snapshot.activeTurn.stepIndex === 0 &&
      snapshot.session.phase === "turn_running" &&
      decision.kind !== "wait" &&
      decision.kind !== "finish"
    ) {
      lifecycleEvents.push({
        type: "turn.started",
        turnId: snapshot.activeTurn.turnId,
        timestamp: now,
      });
    }

    // Guard: any path that operates on an active turn requires one to
    // exist. Compact and idle/ended phases are the exception. The
    // scheduler won't produce non-wait decisions in `idle`/`ended`
    // under normal operation, but we defend against mis-calls here.
    const phase = snapshot.session.phase;
    const requiresActiveTurn =
      decision.kind !== "compact" &&
      phase !== "idle" &&
      phase !== "ended";
    if (requiresActiveTurn && !snapshot.activeTurn) {
      throw new KernelError(
        KERNEL_ERROR_CODES.TURN_NOT_FOUND,
        `advanceStep(${decision.kind}) requires an active turn (phase=${phase})`,
      );
    }

    const turnId = snapshot.activeTurn?.turnId ?? "";

    const inner: Promise<AdvanceStepResult> = (() => {
      switch (decision.kind) {
        case "llm_call":
          return this.handleLlmCall(snapshot, turnId, now);
        case "tool_exec":
          return this.handleToolExec(snapshot, decision, turnId, now);
        case "compact":
          return this.handleCompact(snapshot, now);
        case "wait":
          return this.handleWait(snapshot, decision, turnId, now);
        case "finish":
          return this.handleFinish(snapshot, decision, turnId, now);
        case "hook_emit":
          return this.handleHookEmit(snapshot, decision, now);
        default: {
          const _exhaustive: never = decision;
          throw new Error(
            `Unhandled decision kind: ${(_exhaustive as StepDecision).kind}`,
          );
        }
      }
    })();

    const result = await inner;
    if (lifecycleEvents.length > 0) {
      return { ...result, events: [...lifecycleEvents, ...result.events] };
    }
    return result;
  }

  /**
   * Emit a system-level notification event. The kernel does NOT
   * autonomously produce these (there is no background monitor at
   * this layer); callers — typically the composition layer / Session
   * DO — invoke this seam to surface warnings / errors onto the
   * runtime event stream without having to build the envelope
   * themselves.
   */
  buildSystemNotify(
    severity: "info" | "warning" | "error",
    message: string,
  ): RuntimeEvent {
    return {
      type: "system.notify",
      severity,
      message,
      timestamp: new Date().toISOString(),
    };
  }

  // ── LLM call ────────────────────────────────────────────────────
  private async handleLlmCall(
    snapshot: KernelSnapshot,
    turnId: string,
    now: string,
  ): Promise<AdvanceStepResult> {
    const events: RuntimeEvent[] = [];
    let content = "";
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    try {
      if (this.hooks.beforeLlmInvoke) {
        await this.hooks.beforeLlmInvoke({ snapshot, turnId });
      }

      for await (const chunk of this.delegates.llm.call(
        snapshot.activeTurn?.messages ?? [],
      )) {
        switch (chunk.type) {
          case "content": {
            content += chunk.content;
            events.push({
              type: "llm.delta",
              turnId,
              contentType: "text",
              content: chunk.content,
              isFinal: false,
              timestamp: now,
            });
            break;
          }
          case "usage": {
            usage = chunk.usage;
            break;
          }
          case "tool_calls": {
            snapshot = applyAction(snapshot, {
              type: "tool_calls_requested",
              calls: chunk.calls,
            });
            break;
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "LLM_EXECUTION_FAILED";
      const severity = code === "QUOTA_EXCEEDED" ? "warning" : "error";
      snapshot = applyAction(snapshot, {
        type: "complete_turn",
        reason: code.toLowerCase(),
      });
      events.push({
        type: "system.notify",
        severity,
        message: `${code}: ${message}`,
        timestamp: now,
      });
      return { snapshot, events, done: true };
    }

    const normalizedContent = content.length > 0 ? content : null;
    const llmAction: KernelAction = {
      type: "llm_response",
      content:
        normalizedContent === null
          ? null
          : {
              role: "assistant",
              content: normalizedContent,
            },
      usage,
    };
    snapshot = applyAction(snapshot, llmAction);

    const stepIndex = snapshot.activeTurn?.stepIndex ?? 0;
    snapshot = applyAction(snapshot, {
      type: "complete_step",
      stepIndex,
      result: content,
    });

    try {
      if (this.hooks.afterLlmInvoke) {
        await this.hooks.afterLlmInvoke({
          snapshot,
          turnId,
          usage,
          content: normalizedContent,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      snapshot = applyAction(snapshot, {
        type: "complete_turn",
        reason: "llm-postprocess-failed",
      });
      events.push({
        type: "system.notify",
        severity: "error",
        message: `LLM_POSTPROCESS_FAILED: ${message}`,
        timestamp: now,
      });
      return { snapshot, events, done: true };
    }

    return { snapshot, events, done: false };
  }

  // ── Tool execution ──────────────────────────────────────────────
  private async handleToolExec(
    snapshot: KernelSnapshot,
    decision: Extract<StepDecision, { kind: "tool_exec" }>,
    turnId: string,
    now: string,
  ): Promise<AdvanceStepResult> {
    const events: RuntimeEvent[] = [];
    const callId = decision.requestId;
    let result: unknown = null;
    let resultStatus: "ok" | "error" = "ok";

    for await (const chunk of this.delegates.capability.execute({
      toolName: decision.toolName,
      args: decision.args,
    })) {
      switch (chunk.type) {
        case "progress": {
          events.push({
            type: "tool.call.progress",
            turnId,
            toolName: decision.toolName,
            requestId: callId,
            chunk: chunk.chunk ?? chunk.progress,
            isFinal: false,
            timestamp: now,
          });
          break;
        }
        case "result": {
          result = chunk.result;
          if (chunk.status !== undefined) {
            resultStatus = chunk.status;
          }
          break;
        }
      }
    }

    events.push({
      type: "tool.call.result",
      turnId,
      toolName: decision.toolName,
      requestId: callId,
      status: resultStatus,
      ...(resultStatus === "error"
        ? {
            errorMessage:
              result && typeof result === "object" && "message" in (result as Record<string, unknown>)
                ? String((result as Record<string, unknown>).message)
                : typeof result === "string"
                  ? result
                  : JSON.stringify(result),
          }
        : {
            output: typeof result === "string" ? result : JSON.stringify(result),
          }),
      timestamp: now,
    });

    snapshot = applyAction(snapshot, {
      type: "tool_result",
      callId,
      result,
    });

    const stepIndex = snapshot.activeTurn?.stepIndex ?? 0;
    snapshot = applyAction(snapshot, {
      type: "complete_step",
      stepIndex,
      result,
    });

    return { snapshot, events, done: false };
  }

  // ── Compact ─────────────────────────────────────────────────────
  private async handleCompact(
    snapshot: KernelSnapshot,
    now: string,
  ): Promise<AdvanceStepResult> {
    const events: RuntimeEvent[] = [];
    const tokensBefore = snapshot.session.totalTokens;
    const compactResult = (await this.delegates.compact.requestCompact({
      totalTokens: tokensBefore,
    })) as { tokensFreed: number };

    snapshot = applyAction(snapshot, {
      type: "compact_done",
      tokensFreed: compactResult.tokensFreed,
    });

    events.push({
      type: "compact.notify",
      status: "completed",
      tokensBefore,
      tokensAfter: snapshot.session.totalTokens,
      timestamp: now,
    });

    return { snapshot, events, done: false };
  }

  // ── Wait (interrupt) ────────────────────────────────────────────
  private async handleWait(
    snapshot: KernelSnapshot,
    decision: Extract<StepDecision, { kind: "wait" }>,
    _turnId: string,
    now: string,
  ): Promise<AdvanceStepResult> {
    const events: RuntimeEvent[] = [];

    snapshot = applyAction(snapshot, {
      type: "interrupt",
      reason: decision.reason,
    });

    events.push({
      type: "session.update",
      phase: snapshot.session.phase,
      turnCount: snapshot.session.turnCount,
      timestamp: now,
    });

    return { snapshot, events, done: true };
  }

  // ── Finish ──────────────────────────────────────────────────────
  private async handleFinish(
    snapshot: KernelSnapshot,
    decision: Extract<StepDecision, { kind: "finish" }>,
    turnId: string,
    now: string,
  ): Promise<AdvanceStepResult> {
    const events: RuntimeEvent[] = [];

    snapshot = applyAction(snapshot, {
      type: "complete_turn",
      reason: decision.reason,
    });

    events.push({
      type: "turn.completed",
      turnId,
      reason: decision.reason,
      timestamp: now,
    });

    return { snapshot, events, done: true };
  }

  // ── Hook emit ───────────────────────────────────────────────────
  private async handleHookEmit(
    snapshot: KernelSnapshot,
    decision: Extract<StepDecision, { kind: "hook_emit" }>,
    now: string,
  ): Promise<AdvanceStepResult> {
    const events: RuntimeEvent[] = [];
    const payload = await this.delegates.hook.emit(decision.event, {});

    events.push({
      type: "hook.broadcast",
      event: decision.event,
      payloadRedacted: payload,
      timestamp: now,
    });

    const stepIndex = snapshot.activeTurn?.stepIndex ?? 0;
    snapshot = applyAction(snapshot, {
      type: "complete_step",
      stepIndex,
      result: payload,
    });

    return { snapshot, events, done: false };
  }
}
