import test from "node:test";
import assert from "node:assert/strict";

import { buildStreamEventBody, mapRuntimeEventToStreamKind } from "../../packages/agent-runtime-kernel/dist/events.js";
import {
  DoStorageTraceSink,
  SessionTimeline,
  SessionInspector,
  traceEventToAuditBody,
  classifyEvent,
} from "../../packages/eval-observability/dist/index.js";
import { AuditRecordBodySchema } from "../../packages/nacp-core/dist/messages/system.js";
import { SessionStreamEventBodySchema } from "../../packages/nacp-session/dist/stream-event.js";
import { validateRefKey } from "../../packages/storage-topology/dist/index.js";
import { FakeTraceStorage } from "./fixtures/fake-storage.mjs";
import { TURN_UUID, TEAM_UUID, NOW } from "./fixtures/seed-data.mjs";

const REQUEST_UUID = "22222222-2222-4222-8222-222222222222";

test("E2E-09: Observability Pipeline — Kernel Events → Trace Sink → Durable Audit → Timeline Replay", async () => {
  const runtimeEvents = [
    { type: "turn.started", turnId: TURN_UUID, timestamp: NOW },
    { type: "llm.delta", turnId: TURN_UUID, contentType: "text", content: "hello", isFinal: false, timestamp: NOW },
    { type: "llm.delta", turnId: TURN_UUID, contentType: "text", content: " world", isFinal: false, timestamp: NOW },
    { type: "tool.call.progress", turnId: TURN_UUID, toolName: "read_file", requestId: REQUEST_UUID, chunk: "p", isFinal: false, timestamp: NOW },
    { type: "tool.call.result", turnId: TURN_UUID, toolName: "read_file", requestId: REQUEST_UUID, status: "ok", output: "done", timestamp: NOW },
    { type: "llm.delta", turnId: TURN_UUID, contentType: "text", content: "!", isFinal: false, timestamp: NOW },
    { type: "turn.completed", turnId: TURN_UUID, reason: "turn_complete", usage: { total: 42 }, timestamp: NOW },
    { type: "session.update", phase: "turn_running", turnCount: 1, partialOutput: "streaming", timestamp: NOW },
  ];

  const durableEvents = [];
  const liveEvents = [];
  // Use a mock TraceSink because DoStorageTraceSink needs DoStorage-like interface
  const sink = {
    async emit(event) {
      const tier = classifyEvent(event.eventKind);
      if (tier === "live") liveEvents.push(event);
      else durableEvents.push(event);
    },
    async flush() {},
  };

  const inspector = new SessionInspector((candidate) => {
    const result = SessionStreamEventBodySchema.safeParse(candidate);
    return result.success ? { ok: true } : { ok: false, reason: result.error.message };
  });

  for (const [idx, event] of runtimeEvents.entries()) {
    const kind = mapRuntimeEventToStreamKind(event);
    const body = buildStreamEventBody(event);
    inspector.onStreamEvent(kind, idx + 1, body);

    await sink.emit({
      eventKind: kind,
      timestamp: NOW,
      sessionUuid: "sess-001",
      teamUuid: TEAM_UUID,
      turnUuid: TURN_UUID,
      ...body,
    });
  }

  assert.equal(inspector.getRejections().length, 0);
  assert.equal(inspector.getEvents().length, runtimeEvents.length);

  // llm.delta (x2) + session.update + tool.call.progress should be live-only
  // turn.started, tool.call.result, turn.completed should be durable
  assert.ok(liveEvents.length >= 2, "expected live-only events");

  // Fake durable storage
  const fakeStorage = new FakeTraceStorage();
  const storageKey = `tenants/${TEAM_UUID}/traces/sess-001/audit.jsonl`;
  assert.equal(validateRefKey({ kind: "r2", team_uuid: TEAM_UUID, key: storageKey }), true);

  for (const e of durableEvents) {
    await fakeStorage.appendJsonl(storageKey, e);
  }

  const timeline = new SessionTimeline();
  const stored = await fakeStorage.readJsonl(storageKey);
  for (const e of stored) {
    timeline.addEvent(e);
  }

  const allTimelineEvents = timeline.getEvents();
  assert.ok(allTimelineEvents.length >= 3, "expected durable events in timeline");

  // Audit schema validation on tool.call.result
  const toolResultEvent = stored.find((e) => e.eventKind === "tool.call.result");
  assert.ok(toolResultEvent);
  const auditBody = traceEventToAuditBody(toolResultEvent);
  assert.ok(auditBody);
  assert.equal(AuditRecordBodySchema.safeParse(auditBody).success, true);
});
