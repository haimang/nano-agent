import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStreamEventBody,
  mapRuntimeEventToStreamKind,
} from "../packages/agent-runtime-kernel/dist/events.js";
import { SessionStreamEventBodySchema } from "../packages/nacp-session/dist/stream-event.js";

const TURN_UUID = "11111111-1111-4111-8111-111111111111";
const REQUEST_UUID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-04-17T00:00:00.000Z";

const CASES = [
  {
    event: { type: "turn.started", turnId: TURN_UUID, timestamp: NOW },
    expectedKind: "turn.begin",
  },
  {
    event: {
      type: "turn.completed",
      turnId: TURN_UUID,
      reason: "turn_complete",
      usage: { total: 42 },
      timestamp: NOW,
    },
    expectedKind: "turn.end",
  },
  {
    event: {
      type: "llm.delta",
      turnId: TURN_UUID,
      contentType: "text",
      content: "hello",
      isFinal: false,
      timestamp: NOW,
    },
    expectedKind: "llm.delta",
  },
  {
    event: {
      type: "tool.call.progress",
      turnId: TURN_UUID,
      toolName: "read_file",
      requestId: REQUEST_UUID,
      chunk: "partial",
      isFinal: false,
      timestamp: NOW,
    },
    expectedKind: "tool.call.progress",
  },
  {
    event: {
      type: "tool.call.result",
      turnId: TURN_UUID,
      toolName: "read_file",
      requestId: REQUEST_UUID,
      status: "ok",
      output: "done",
      timestamp: NOW,
    },
    expectedKind: "tool.call.result",
  },
  {
    event: {
      type: "hook.broadcast",
      event: "pre_tool_use",
      payloadRedacted: { ok: true },
      aggregatedOutcome: { accepted: true },
      timestamp: NOW,
    },
    expectedKind: "hook.broadcast",
  },
  {
    event: {
      type: "compact.notify",
      status: "completed",
      tokensBefore: 100,
      tokensAfter: 40,
      timestamp: NOW,
    },
    expectedKind: "compact.notify",
  },
  {
    event: {
      type: "system.notify",
      severity: "info",
      message: "ready",
      timestamp: NOW,
    },
    expectedKind: "system.notify",
  },
  {
    event: {
      type: "session.update",
      phase: "turn_running",
      turnCount: 1,
      partialOutput: "streaming",
      timestamp: NOW,
    },
    expectedKind: "session.update",
  },
];

test("agent-runtime-kernel stream bodies validate against nacp-session reality", () => {
  for (const { event, expectedKind } of CASES) {
    const mappedKind = mapRuntimeEventToStreamKind(event);
    assert.equal(mappedKind, expectedKind);

    const body = buildStreamEventBody(event);
    assert.equal(body.kind, expectedKind);

    const parsed = SessionStreamEventBodySchema.safeParse(body);
    assert.equal(
      parsed.success,
      true,
      `expected ${event.type} -> ${expectedKind} body to satisfy SessionStreamEventBodySchema`,
    );
  }
});
