import test from "node:test";
import assert from "node:assert/strict";

import { buildStreamEventBody } from "../packages/agent-runtime-kernel/dist/events.js";
import { SessionStreamEventBodySchema } from "../packages/nacp-session/dist/stream-event.js";
import { AuditRecordBodySchema } from "../packages/nacp-core/dist/messages/system.js";
import {
  SessionInspector,
  traceEventToAuditBody,
} from "../packages/eval-observability/dist/index.js";

const TURN_UUID = "11111111-1111-4111-8111-111111111111";
const REQUEST_UUID = "22222222-2222-4222-8222-222222222222";

test("eval-observability inspector accepts kernel-built session event bodies under nacp-session validation", () => {
  const inspector = new SessionInspector((candidate) => {
    const result = SessionStreamEventBodySchema.safeParse(candidate);
    return result.success
      ? { ok: true }
      : { ok: false, reason: result.error.message };
  });

  const runtimeEvents = [
    {
      type: "turn.started",
      turnId: TURN_UUID,
      timestamp: "2026-04-17T00:00:00.000Z",
    },
    {
      type: "llm.delta",
      turnId: TURN_UUID,
      contentType: "text",
      content: "hello",
      isFinal: false,
      timestamp: "2026-04-17T00:00:01.000Z",
    },
    {
      type: "tool.call.result",
      turnId: TURN_UUID,
      toolName: "read_file",
      requestId: REQUEST_UUID,
      status: "ok",
      output: "done",
      timestamp: "2026-04-17T00:00:02.000Z",
    },
  ];

  for (const [index, event] of runtimeEvents.entries()) {
    const body = buildStreamEventBody(event);
    inspector.onStreamEvent(body.kind, index + 1, body);
  }

  assert.equal(inspector.getEvents().length, runtimeEvents.length);
  assert.equal(inspector.getRejections().length, 0);
  assert.deepEqual(
    inspector.getEvents().map((event) => event.kind),
    ["turn.begin", "llm.delta", "tool.call.result"],
  );
});

test("eval-observability audit bodies validate against nacp-core audit schema", () => {
  const body = traceEventToAuditBody({
    eventKind: "tool.call.result",
    timestamp: "2026-04-17T00:00:02.000Z",
    sessionUuid: "sess-001",
    teamUuid: "team-001",
    turnUuid: TURN_UUID,
    audience: "internal",
    layer: "durable-audit",
    toolName: "read_file",
    resultSizeBytes: 4,
    durationMs: 12,
  });

  assert.notEqual(body, null);
  assert.equal(AuditRecordBodySchema.safeParse(body).success, true);
});
