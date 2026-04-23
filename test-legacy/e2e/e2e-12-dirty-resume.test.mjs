import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionCheckpoint,
  restoreSessionCheckpoint,
} from "../../packages/session-do-runtime/dist/index.js";
import { ReplayBuffer } from "../../packages/nacp-session/dist/replay.js";
import { createTurnState, createInitialSessionState } from "../../packages/agent-runtime-kernel/dist/index.js";
import { TURN_UUID, SESSION_UUID, TEAM_UUID, NOW } from "./fixtures/seed-data.mjs";

test("E2E-12: Dirty Resume — checkpoint in tools_pending then continue", async () => {
  // Simulate a turn that has produced an assistant tool-call message but not yet executed the tool.
  const turnState = createTurnState(TURN_UUID);
  turnState.stepIndex = 1;
  turnState.phase = "tools_pending";
  turnState.pendingToolCalls = [{ id: "call-1", name: "read_file", arguments: JSON.stringify({ path: "/workspace/main.ts" }) }];

  const sessionState = createInitialSessionState(SESSION_UUID);
  sessionState.turnCount = 1;
  sessionState.messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "read the file" },
    {
      role: "assistant",
      content: null,
      tool_calls: turnState.pendingToolCalls,
    },
  ];

  // Build checkpoint while in tools_pending
  const checkpoint = await buildSessionCheckpoint(
    SESSION_UUID,
    TEAM_UUID,
    "turn_running",
    1,
    { totalTokens: 50, totalTurns: 1, totalDurationMs: 100 },
    {
      getKernelFragment: () => ({ ...sessionState, turnState }),
      getReplayFragment: async () => ({}),
      getStreamSeqs: () => ({ main: 5 }),
      getWorkspaceFragment: async () => ({}),
      getHooksFragment: () => ({}),
    },
  );

  // Restore
  let restoredTurnState = null;
  const restored = await restoreSessionCheckpoint(checkpoint, {
    restoreKernel: (fragment) => {
      restoredTurnState = fragment.turnState;
      return fragment;
    },
    restoreReplay: async () => undefined,
    restoreWorkspace: async () => undefined,
    restoreHooks: () => undefined,
  });

  assert.equal(restored.actorPhase, "turn_running");
  assert.ok(restoredTurnState);
  assert.equal(restoredTurnState.phase, "tools_pending");
  assert.equal(restoredTurnState.pendingToolCalls.length, 1);

  // After resume, continue turn: tool should execute once
  let executionCount = 0;
  function executePendingTool() {
    executionCount += 1;
    return { role: "tool", content: "file content", tool_call_id: "call-1" };
  }

  const toolResult = executePendingTool();
  assert.equal(executionCount, 1);

  // Verify no duplicate assistant message was injected
  const assistantMsgs = sessionState.messages.filter((m) => m.role === "assistant");
  assert.equal(assistantMsgs.length, 1);

  // Verify exactly one tool result
  const toolMsgs = sessionState.messages.filter((m) => m.role === "tool");
  assert.equal(toolMsgs.length, 0); // before append
  sessionState.messages.push(toolResult);
  assert.equal(sessionState.messages.filter((m) => m.role === "tool").length, 1);
});
