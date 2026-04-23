/**
 * Integration test: full session lifecycle — start, turn, checkpoint, restore.
 *
 * Exercises the end-to-end flow:
 *   1. Create actor state + checkpoint deps
 *   2. Start a turn with initial input
 *   3. Simulate a kernel step loop (done after 2 steps)
 *   4. Build a checkpoint
 *   5. Restore from checkpoint
 *   6. Verify state consistency
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createInitialActorState,
  transitionPhase,
} from "../../../src/host/actor-state.js";
import type { ActorState } from "../../../src/host/actor-state.js";
import { extractTurnInput } from "../../../src/host/turn-ingress.js";
import {
  buildSessionCheckpoint,
  validateSessionCheckpoint,
} from "../../../src/host/checkpoint.js";
import type {
  CheckpointDeps,
  UsageSnapshot,
  SessionCheckpoint,
} from "../../../src/host/checkpoint.js";

// ── Mock subsystem fragments ──

function makeKernelFragment(stepIndex: number) {
  return {
    version: "0.1.0",
    session: { sessionId: "33333333-3333-4333-8333-333333333333", turnCount: 1, startedAt: "2026-04-16T12:00:00.000Z" },
    activeTurn: stepIndex < 2
      ? { turnId: "turn-1", stepIndex, maxSteps: 50, status: "running" }
      : null,
    lastAction: stepIndex < 2 ? `step:${stepIndex}` : "step:done",
    checkpointedAt: "2026-04-16T12:00:00.000Z",
  };
}

function makeReplayFragment(seqNo: number) {
  return { lastSeqNo: seqNo, frames: [] };
}

function makeWorkspaceFragment() {
  return { version: "0.1.0", mountConfigs: [], fileIndex: [], artifactRefs: [], contextLayers: [], createdAt: "2026-04-16T12:00:00.000Z" };
}

function makeHooksFragment() {
  return { version: "0.1.0", handlers: [], snapshotAt: "2026-04-16T12:00:00.000Z" };
}

// ── Tests ──

describe("start-turn-resume lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("full lifecycle: start → turn → checkpoint → restore", async () => {
    // ── Step 1: initialize session actor ──
    let actorState: ActorState = createInitialActorState();
    expect(actorState.phase).toBe("unattached");

    // Client connects
    actorState = transitionPhase(actorState, "attached");
    expect(actorState.phase).toBe("attached");

    // ── Step 2: start a turn with initial input ──
    const turnInput = extractTurnInput("session.start", {
      initial_input: "Hello, agent!",
    });
    expect(turnInput).not.toBeNull();
    expect(turnInput!.kind).toBe("session-start-initial-input");
    expect(turnInput!.content).toBe("Hello, agent!");

    // Transition to turn_running
    actorState = transitionPhase(actorState, "turn_running");
    expect(actorState.phase).toBe("turn_running");

    // ── Step 3: simulate kernel step loop (2 steps then done) ──
    let currentStep = 0;
    const maxSteps = 2;

    while (currentStep < maxSteps) {
      // Simulate one kernel step
      currentStep++;
    }

    // Turn completes → transition back to attached
    actorState = transitionPhase(actorState, "attached");
    expect(actorState.phase).toBe("attached");

    // ── Step 4: build checkpoint ──
    const usage: UsageSnapshot = {
      totalTokens: 250,
      totalTurns: 1,
      totalDurationMs: 1200,
    };

    const deps: CheckpointDeps = {
      getKernelFragment: () => makeKernelFragment(maxSteps),
      getReplayFragment: async () => makeReplayFragment(5),
      getStreamSeqs: () => ({ main: 5, tool: 2 }),
      getWorkspaceFragment: async () => makeWorkspaceFragment(),
      getHooksFragment: () => makeHooksFragment(),
    };

    const checkpoint = await buildSessionCheckpoint(
      "33333333-3333-4333-8333-333333333333",
      "team-int-abc",
      actorState.phase,
      1,
      usage,
      deps,
    );

    // Verify checkpoint shape
    expect(validateSessionCheckpoint(checkpoint)).toBe(true);
    expect(checkpoint.sessionUuid).toBe("33333333-3333-4333-8333-333333333333");
    expect(checkpoint.teamUuid).toBe("team-int-abc");
    expect(checkpoint.actorPhase).toBe("attached");
    expect(checkpoint.turnCount).toBe(1);
    expect(checkpoint.usageSnapshot.totalTokens).toBe(250);

    // ── Step 5: simulate "restore" from checkpoint ──
    // In a real system, we'd deserialize from storage. Here we validate
    // the checkpoint, extract actor state fields, and verify consistency.

    const raw: unknown = JSON.parse(JSON.stringify(checkpoint));
    expect(validateSessionCheckpoint(raw)).toBe(true);

    const restored = raw as SessionCheckpoint;

    // ── Step 6: verify restored state matches original ──
    expect(restored.actorPhase).toBe(actorState.phase);
    expect(restored.turnCount).toBe(1);
    expect(restored.sessionUuid).toBe("33333333-3333-4333-8333-333333333333");
    expect(restored.teamUuid).toBe("team-int-abc");

    // Kernel fragment should show step:done (turn completed)
    const kernelFrag = restored.kernelFragment as ReturnType<typeof makeKernelFragment>;
    expect(kernelFrag.lastAction).toBe("step:done");
    expect(kernelFrag.activeTurn).toBeNull();

    // Stream seqs should be preserved
    expect(restored.streamSeqs).toEqual({ main: 5, tool: 2 });

    // Usage should round-trip
    expect(restored.usageSnapshot).toEqual(usage);
  });

  it("handles multiple turns before checkpoint", async () => {
    let actorState: ActorState = createInitialActorState();
    actorState = transitionPhase(actorState, "attached");

    // Turn 1
    actorState = transitionPhase(actorState, "turn_running");
    actorState = transitionPhase(actorState, "attached");

    // Turn 2
    actorState = transitionPhase(actorState, "turn_running");
    actorState = transitionPhase(actorState, "attached");

    // Turn 3
    actorState = transitionPhase(actorState, "turn_running");
    actorState = transitionPhase(actorState, "attached");

    const usage: UsageSnapshot = {
      totalTokens: 750,
      totalTurns: 3,
      totalDurationMs: 4500,
    };

    const deps: CheckpointDeps = {
      getKernelFragment: () => makeKernelFragment(2),
      getReplayFragment: async () => makeReplayFragment(15),
      getStreamSeqs: () => ({ main: 15 }),
      getWorkspaceFragment: async () => makeWorkspaceFragment(),
      getHooksFragment: () => makeHooksFragment(),
    };

    const checkpoint = await buildSessionCheckpoint(
      "44444444-4444-4444-8444-444444444444",
      "team-int-abc",
      actorState.phase,
      3,
      usage,
      deps,
    );

    expect(checkpoint.turnCount).toBe(3);
    expect(checkpoint.usageSnapshot.totalTurns).toBe(3);
    expect(validateSessionCheckpoint(checkpoint)).toBe(true);
  });

  it("checkpoint taken during turn_running captures active turn", async () => {
    let actorState: ActorState = createInitialActorState();
    actorState = transitionPhase(actorState, "attached");
    actorState = transitionPhase(actorState, "turn_running");

    const deps: CheckpointDeps = {
      getKernelFragment: () => makeKernelFragment(1), // mid-turn, step 1
      getReplayFragment: async () => makeReplayFragment(3),
      getStreamSeqs: () => ({ main: 3 }),
      getWorkspaceFragment: async () => makeWorkspaceFragment(),
      getHooksFragment: () => makeHooksFragment(),
    };

    const checkpoint = await buildSessionCheckpoint(
      "55555555-5555-4555-8555-555555555555",
      "team-int-abc",
      actorState.phase,
      0,
      { totalTokens: 100, totalTurns: 0, totalDurationMs: 500 },
      deps,
    );

    expect(checkpoint.actorPhase).toBe("turn_running");

    const kernelFrag = checkpoint.kernelFragment as ReturnType<typeof makeKernelFragment>;
    expect(kernelFrag.activeTurn).not.toBeNull();
    expect(kernelFrag.activeTurn!.stepIndex).toBe(1);
    expect(kernelFrag.activeTurn!.status).toBe("running");
  });
});
