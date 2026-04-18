import test from "node:test";
import assert from "node:assert/strict";

import { buildStreamEventBody } from "../packages/agent-runtime-kernel/dist/events.js";
import { SessionStreamEventBodySchema } from "../packages/nacp-session/dist/stream-event.js";
import { AuditRecordBodySchema } from "../packages/nacp-core/dist/messages/system.js";
import {
  SessionInspector,
  traceEventToAuditBody,
  auditBodyToTraceEvent,
  validateTraceEvent,
  createDefaultRegistry,
} from "../packages/eval-observability/dist/index.js";
import {
  buildTurnBeginTrace,
  buildTurnEndTrace,
  buildStepTrace,
  mapRuntimeStepKindToTraceKind,
} from "../packages/session-do-runtime/dist/traces.js";

const TRACE_UUID = "44444444-4444-4444-8444-444444444444";
const SESSION_UUID = "55555555-5555-5555-8555-555555555555";
const TURN_UUID = "11111111-1111-4111-8111-111111111111";
const REQUEST_UUID = "22222222-2222-4222-8222-222222222222";
const TEAM_UUID = "team-001";

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

test("eval-observability audit bodies carry trace-first fields and validate against nacp-core audit schema", () => {
  const event = {
    eventKind: "tool.call.result",
    timestamp: "2026-04-17T00:00:02.000Z",
    traceUuid: TRACE_UUID,
    sessionUuid: SESSION_UUID,
    teamUuid: TEAM_UUID,
    sourceRole: "capability",
    sourceKey: "nano-agent.capability.bash@v1",
    turnUuid: TURN_UUID,
    audience: "internal",
    layer: "durable-transcript",
    toolName: "read_file",
    resultSizeBytes: 4,
    durationMs: 12,
  };

  const body = traceEventToAuditBody(event);
  assert.notEqual(body, null);
  assert.equal(AuditRecordBodySchema.safeParse(body).success, true);
  // Trace-first carriers must be present in detail so round-trip readers can
  // reconstruct a trace-law-compliant event without losing the anchor.
  assert.equal(body.detail.traceUuid, TRACE_UUID);
  assert.equal(body.detail.sourceRole, "capability");
  assert.equal(body.detail.sourceKey, "nano-agent.capability.bash@v1");

  const restored = auditBodyToTraceEvent(body, {
    sessionUuid: SESSION_UUID,
    teamUuid: TEAM_UUID,
    timestamp: event.timestamp,
  });
  assert.equal(restored.traceUuid, TRACE_UUID);
  assert.equal(restored.sourceRole, "capability");
  assert.deepEqual(validateTraceEvent(restored), []);
});

test("session-do-runtime trace builders emit canonical turn.begin / turn.end with traceUuid carrier", () => {
  const ctx = {
    sessionUuid: SESSION_UUID,
    teamUuid: TEAM_UUID,
    traceUuid: TRACE_UUID,
    sourceRole: "session",
    sourceKey: "nano-agent.session.do@v1",
  };

  const begin = buildTurnBeginTrace(TURN_UUID, ctx);
  assert.equal(begin.eventKind, "turn.begin");
  assert.equal(begin.traceUuid, TRACE_UUID);
  assert.equal(begin.sourceRole, "session");
  assert.deepEqual(validateTraceEvent(begin), []);

  const end = buildTurnEndTrace(TURN_UUID, 1500, ctx);
  assert.equal(end.eventKind, "turn.end");
  assert.equal(end.durationMs, 1500);
  assert.deepEqual(validateTraceEvent(end), []);

  const step = buildStepTrace(
    { type: "turn.started", turnId: TURN_UUID },
    ctx,
  );
  assert.equal(
    step.eventKind,
    "turn.begin",
    "kernel runtime `turn.started` must map to canonical `turn.begin`",
  );
  assert.equal(mapRuntimeStepKindToTraceKind("turn.completed"), "turn.end");
});

test("durable-promotion-registry marks turn.begin / turn.end as anchor-layer events", () => {
  const registry = createDefaultRegistry();
  const anchors = registry.listByConceptualLayer("anchor");
  const anchorKinds = anchors.map((e) => e.eventKind).sort();
  for (const k of ["session.start", "session.end", "turn.begin", "turn.end"]) {
    assert.ok(
      anchorKinds.includes(k),
      `expected ${k} to be registered as conceptualLayer=anchor, got ${JSON.stringify(anchorKinds)}`,
    );
  }
  assert.ok(
    registry.listByConceptualLayer("durable").length > 0,
    "registry should also expose non-anchor durable events",
  );
});
