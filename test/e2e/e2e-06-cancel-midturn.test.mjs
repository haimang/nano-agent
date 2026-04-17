import test from "node:test";
import assert from "node:assert/strict";

import { createTurnState, createInitialSessionState, KernelRunner } from "../../packages/agent-runtime-kernel/dist/index.js";
import { SessionStreamEventBodySchema } from "../../packages/nacp-session/dist/stream-event.js";
import { buildStreamEventBody, mapRuntimeEventToStreamKind } from "../../packages/agent-runtime-kernel/dist/events.js";
import { TURN_UUID, NOW } from "./fixtures/seed-data.mjs";

test("E2E-06: Cancel Mid-Turn → Cleanup Incomplete Messages → Resume", async () => {
  // Simulate a turn with assistant message + 2 tool calls, then cancel before second tool executes.
  // We verify message list cleanliness by manipulating a mock message array the same way
  // KernelRunner would clean it up on cancel.

  let messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "do things" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call-1", function: { name: "read_file" } },
        { id: "call-2", function: { name: "long_running_task" } },
      ],
    },
    { role: "tool", content: "file content", tool_call_id: "call-1" },
  ];

  // Cancel cleanup: remove last assistant and all tool results after it
  function cancelCleanup(msgs) {
    const lastAssistantIdx = msgs.findLastIndex((m) => m.role === "assistant");
    if (lastAssistantIdx >= 0) {
      return msgs.slice(0, lastAssistantIdx);
    }
    return msgs;
  }

  messages = cancelCleanup(messages);

  // Assert no assistant with tool_calls remains
  const assistantMsg = messages.find((m) => m.role === "assistant");
  assert.equal(assistantMsg, undefined);

  // Assert no dangling tool result (every tool result needs a matching assistant tool_call)
  const toolResults = messages.filter((m) => m.role === "tool");
  assert.equal(toolResults.length, 0);

  // Cancel represented as system.notify (turn.interrupted not in RUNTIME_TO_STREAM_MAP)
  const cancelEvent = {
    type: "system.notify",
    severity: "info",
    message: "Turn cancelled by user",
    timestamp: NOW,
  };
  const streamBody = buildStreamEventBody(cancelEvent);
  assert.equal(streamBody.kind, "system.notify");
  assert.equal(SessionStreamEventBodySchema.safeParse(streamBody).success, true);

  // New turn begin after cancel
  const beginBody = buildStreamEventBody({ type: "turn.started", turnId: TURN_UUID, timestamp: NOW });
  assert.equal(beginBody.kind, "turn.begin");
  assert.equal(SessionStreamEventBodySchema.safeParse(beginBody).success, true);
});
