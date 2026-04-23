/**
 * Integration — orchestrator output is schema-valid under nacp-session.
 *
 * This test previously failed silently because the orchestrator emitted
 * `turn.started` / `turn.cancelled` / `session.ended` / `system.notify +
 * level` — all of which are outside the canonical 9-kind
 * `SessionStreamEventBodySchema`. The fix routes turn lifecycle through
 * `turn.begin` / `turn.end` and surfaces cancellation / session end via
 * `system.notify + severity`.
 */

import { describe, it, expect, vi } from "vitest";
import { SessionStreamEventBodySchema } from "@haimang/nacp-session";
import { SessionOrchestrator } from "../../../src/host/orchestration.js";
import type { OrchestrationDeps, OrchestrationState } from "../../../src/host/orchestration.js";
import { DEFAULT_RUNTIME_CONFIG } from "../../../src/host/env.js";
import type { TurnInput } from "../../../src/host/turn-ingress.js";

function baseDeps(pushed: Record<string, unknown>[]): OrchestrationDeps {
  return {
    advanceStep: vi.fn(async (snapshot) => ({ snapshot, events: [], done: true })),
    buildCheckpoint: vi.fn((s) => s),
    restoreCheckpoint: vi.fn((f) => f),
    createSessionState: vi.fn(() => ({ phase: "idle" })),
    createTurnState: vi.fn((turnId: string) => ({ turnId, stepIndex: 0 })),
    emitHook: vi.fn(async () => undefined),
    emitTrace: vi.fn(async () => undefined),
    pushStreamEvent: (_kind, body) => {
      pushed.push(body);
    },
  };
}

function turnInput(): TurnInput {
  return {
    kind: "session-start-initial-input",
    content: "hi",
    turnId: "77777777-7777-4777-8777-777777777777",
    receivedAt: "2026-04-17T00:00:00.000Z",
  };
}

describe("integration: orchestrator emissions parse under SessionStreamEventBodySchema", () => {
  it("startTurn emits a schema-valid turn.begin", async () => {
    const pushed: Record<string, unknown>[] = [];
    const orch = new SessionOrchestrator(baseDeps(pushed), DEFAULT_RUNTIME_CONFIG);
    const state = orch.createInitialState();

    await orch.startTurn(state, turnInput());

    const turnBegin = pushed.find((b) => b.kind === "turn.begin");
    expect(turnBegin).toBeDefined();
    const parsed = SessionStreamEventBodySchema.safeParse(turnBegin);
    expect(parsed.success).toBe(true);
  });

  it("runStepLoop completion emits a schema-valid turn.end", async () => {
    const pushed: Record<string, unknown>[] = [];
    const orch = new SessionOrchestrator(baseDeps(pushed), DEFAULT_RUNTIME_CONFIG);
    const state = orch.createInitialState();
    await orch.startTurn(state, turnInput());

    const turnEnd = pushed.find((b) => b.kind === "turn.end");
    expect(turnEnd).toBeDefined();
    expect(SessionStreamEventBodySchema.safeParse(turnEnd).success).toBe(true);
  });

  it("cancelTurn surfaces a schema-valid system.notify (warning)", async () => {
    const pushed: Record<string, unknown>[] = [];
    const orch = new SessionOrchestrator(baseDeps(pushed), DEFAULT_RUNTIME_CONFIG);

    // Put the actor into turn_running first.
    const base = orch.createInitialState();
    const turnRunning: OrchestrationState = {
      ...base,
      actorState: {
        ...base.actorState,
        phase: "turn_running",
        attachedAt: "2026-04-17T00:00:00.000Z",
        activeTurnId: "77777777-7777-4777-8777-777777777777",
      },
    };

    await orch.cancelTurn(turnRunning);

    const notify = pushed.find((b) => b.kind === "system.notify");
    expect(notify).toBeDefined();
    expect((notify as Record<string, unknown>).severity).toBe("warning");
    expect(SessionStreamEventBodySchema.safeParse(notify).success).toBe(true);
  });

  it("endSession surfaces a schema-valid system.notify (info)", async () => {
    const pushed: Record<string, unknown>[] = [];
    const orch = new SessionOrchestrator(baseDeps(pushed), DEFAULT_RUNTIME_CONFIG);

    const base = orch.createInitialState();
    const attached: OrchestrationState = {
      ...base,
      actorState: { ...base.actorState, phase: "attached", attachedAt: "2026-04-17T00:00:00.000Z" },
    };

    await orch.endSession(attached);

    const notify = pushed.find(
      (b) => b.kind === "system.notify" && (b as Record<string, unknown>).severity === "info",
    );
    expect(notify).toBeDefined();
    expect(SessionStreamEventBodySchema.safeParse(notify).success).toBe(true);
  });

  it("maxTurnSteps budget-exhaustion emits a schema-valid system.notify (warning)", async () => {
    const pushed: Record<string, unknown>[] = [];
    const deps = baseDeps(pushed);
    // Make advanceStep never report done.
    (deps as { advanceStep: unknown }).advanceStep = vi.fn(async (snapshot) => ({
      snapshot,
      events: [],
      done: false,
    }));

    const orch = new SessionOrchestrator(deps, { ...DEFAULT_RUNTIME_CONFIG, maxTurnSteps: 2 });
    const base = orch.createInitialState();
    const running: OrchestrationState = {
      ...base,
      actorState: { ...base.actorState, phase: "turn_running", attachedAt: "2026-04-17T00:00:00.000Z" },
    };

    await orch.runStepLoop(running);

    const warn = pushed.find(
      (b) => b.kind === "system.notify" && (b as Record<string, unknown>).severity === "warning",
    );
    expect(warn).toBeDefined();
    expect(SessionStreamEventBodySchema.safeParse(warn).success).toBe(true);
  });
});
