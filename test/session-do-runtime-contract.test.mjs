import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RUNTIME_CONFIG,
  SessionOrchestrator,
  buildSessionCheckpoint,
  restoreSessionCheckpoint,
  validateSessionCheckpoint,
} from "../packages/session-do-runtime/dist/index.js";
import { SessionStreamEventBodySchema } from "../packages/nacp-session/dist/stream-event.js";

const TURN_UUID = "11111111-1111-4111-8111-111111111111";
const SESSION_UUID = "22222222-2222-4222-8222-222222222222";

function makeDeps(pushedBodies) {
  return {
    advanceStep: async (snapshot) => ({ snapshot, events: [], done: true }),
    buildCheckpoint: (snapshot) => snapshot,
    restoreCheckpoint: (fragment) => fragment,
    createSessionState: () => ({ phase: "idle" }),
    createTurnState: (turnId) => ({ turnId, stepIndex: 0 }),
    emitHook: async () => undefined,
    emitTrace: async () => undefined,
    pushStreamEvent: (_kind, body) => {
      pushedBodies.push(body);
    },
  };
}

test("session-do-runtime public orchestrator emits nacp-session-valid bodies", async () => {
  const pushedBodies = [];
  const orchestrator = new SessionOrchestrator(makeDeps(pushedBodies), DEFAULT_RUNTIME_CONFIG);

  await orchestrator.startTurn(orchestrator.createInitialState(), {
    kind: "session-start-initial-input",
    content: "hello",
    turnId: TURN_UUID,
    receivedAt: "2026-04-17T00:00:00.000Z",
  });

  assert.deepEqual(
    pushedBodies.map((body) => body.kind),
    ["turn.begin", "turn.end"],
  );
  for (const body of pushedBodies) {
    assert.equal(SessionStreamEventBodySchema.safeParse(body).success, true);
  }
});

test("session-do-runtime checkpoint helpers round-trip a valid public checkpoint shape", async () => {
  const checkpoint = await buildSessionCheckpoint(
    SESSION_UUID,
    "team-001",
    "attached",
    3,
    { totalTokens: 120, totalTurns: 3, totalDurationMs: 2500 },
    {
      getKernelFragment: () => ({ kernel: "fragment" }),
      getReplayFragment: async () => ({ replay: "fragment" }),
      getStreamSeqs: () => ({ main: 7 }),
      getWorkspaceFragment: async () => ({ workspace: "fragment" }),
      getHooksFragment: () => ({ hooks: "fragment" }),
    },
  );

  assert.equal(validateSessionCheckpoint(checkpoint), true);

  const restored = await restoreSessionCheckpoint(checkpoint, {
    restoreKernel: (fragment) => ({ restoredKernel: fragment }),
    restoreReplay: async () => undefined,
    restoreWorkspace: async (fragment) => ({ restoredWorkspace: fragment }),
    restoreHooks: (fragment) => ({ restoredHooks: fragment }),
  });

  assert.equal(restored.actorPhase, "attached");
  assert.equal(restored.turnCount, 3);
  assert.deepEqual(restored.streamSeqs, { main: 7 });
});
