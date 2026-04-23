/**
 * Cross-package contract — trace-first law (A3 Phase 4 / P4-02).
 *
 * Locks the invariants every adjacent package must respect once they emit
 * trace evidence:
 *   1. `TraceEventBase` exposes `traceUuid` + `sourceRole` as first-class
 *      required fields; `validateTraceEvent` returns an empty array for
 *      compliant events and a typed reason list for violators.
 *   2. The audit codec round-trips trace carriers — even when the audit
 *      detail is stripped, the meta envelope can still recover the carrier
 *      or the codec throws a trace-law violation (no silent drop).
 *   3. `attemptTraceRecovery` exposes the eight A3 §5.3 reasons; the
 *      taxonomy is what every adjacent package must speak when threading
 *      a trace anchor across a boundary.
 *   4. Adjacent packages (hooks, session-do-runtime) consume the eval
 *      contract without re-inventing fields: `buildHookAuditRecord` +
 *      `buildTurnBeginTrace` + `buildTurnEndTrace` produce events that
 *      pass `validateTraceEvent`.
 *   5. The platform-level alert exception is the ONLY place where a
 *     `trace_uuid` may be omitted; request / session / turn scoped alerts
 *     are rejected at the schema level (NACP-Core observability envelope).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  validateTraceEvent,
  isTraceLawCompliant,
  TRACE_RECOVERY_REASONS,
  attemptTraceRecovery,
  TraceRecoveryError,
  auditBodyToTraceEvent,
  traceEventToAuditBody,
  CONCEPTUAL_LAYER_OF_TRACE_LAYER,
} from "../packages/eval-observability/dist/index.js";
import {
  buildTurnBeginTrace,
  buildTurnEndTrace,
} from "../packages/session-do-runtime/dist/traces.js";
import { buildHookAuditRecord } from "../packages/hooks/dist/index.js";
import { NacpAlertPayloadSchema } from "../packages/nacp-core/dist/observability/envelope.js";

const TRACE = "11111111-1111-4111-8111-111111111111";
const SESS = "22222222-2222-4222-8222-222222222222";
const TURN = "33333333-3333-4333-8333-333333333333";
const ALERT_UUID = "44444444-4444-4444-8444-444444444444";
const TEAM = "team-trace-first";

test("validateTraceEvent: empty array when trace law is satisfied", () => {
  const event = {
    eventKind: "turn.begin",
    timestamp: "2026-04-18T10:00:00.000Z",
    traceUuid: TRACE,
    sessionUuid: SESS,
    teamUuid: TEAM,
    sourceRole: "session",
    audience: "internal",
    layer: "durable-audit",
  };
  assert.deepEqual(validateTraceEvent(event), []);
  assert.equal(isTraceLawCompliant(event), true);
});

test("validateTraceEvent: surfaces every trace-law reason for a bare event", () => {
  const violations = validateTraceEvent({
    audience: "internal",
    layer: "live",
  });
  const reasons = violations.map((v) => v.reason).sort();
  assert.deepEqual(reasons, [
    "missing-event-kind",
    "missing-session-uuid",
    "missing-source-role",
    "missing-team-uuid",
    "missing-timestamp",
    "missing-trace-uuid",
  ]);
});

test("attemptTraceRecovery exposes the eight A3 §5.3 reasons", () => {
  assert.deepEqual(TRACE_RECOVERY_REASONS, [
    "anchor-missing",
    "anchor-ambiguous",
    "checkpoint-invalid",
    "timeline-readback-failed",
    "compat-unrecoverable",
    "cross-seam-trace-loss",
    "trace-carrier-mismatch",
    "replay-window-gap",
  ]);
});

test("attemptTraceRecovery: throws with a typed reason on anchor mismatch", () => {
  let caught;
  try {
    attemptTraceRecovery(
      {
        eventKind: "turn.begin",
        timestamp: "2026-04-18T10:00:00.000Z",
        audience: "internal",
        layer: "durable-audit",
        traceUuid: TRACE,
      },
      {
        anchor: {
          traceUuid: "55555555-5555-4555-8555-555555555555",
          sessionUuid: SESS,
          teamUuid: TEAM,
          sourceRole: "session",
        },
      },
    );
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof TraceRecoveryError);
  assert.equal(caught.reason, "trace-carrier-mismatch");
});

test("session-do-runtime trace builders produce trace-law-compliant events", () => {
  const ctx = {
    sessionUuid: SESS,
    teamUuid: TEAM,
    traceUuid: TRACE,
    sourceRole: "session",
    sourceKey: "nano-agent.session.do@v1",
  };
  for (const event of [
    buildTurnBeginTrace(TURN, ctx),
    buildTurnEndTrace(TURN, 123, ctx),
  ]) {
    assert.deepEqual(validateTraceEvent(event), []);
  }
});

test("hook audit body round-trips trace carriers via auditBodyToTraceEvent", () => {
  const aggregated = {
    finalAction: "continue",
    outcomes: [
      {
        action: "continue",
        handlerId: "h1",
        durationMs: 5,
      },
    ],
    blocked: false,
  };
  const body = buildHookAuditRecord("PreToolUse", aggregated, 5, {
    timestamp: "2026-04-18T10:00:00.000Z",
    traceContext: {
      traceUuid: TRACE,
      sourceRole: "hook",
      sourceKey: "nano-agent.hook.dispatcher@v1",
      turnUuid: TURN,
    },
  });
  const recovered = auditBodyToTraceEvent(body, {
    sessionUuid: SESS,
    teamUuid: TEAM,
    timestamp: "2026-04-18T10:00:00.000Z",
  });
  assert.deepEqual(validateTraceEvent(recovered), []);
  assert.equal(recovered.sourceRole, "hook");
  assert.equal(recovered.turnUuid, TURN);
});

test("audit codec encode/decode preserves trace carriers across boundaries", () => {
  const event = {
    eventKind: "tool.call.result",
    timestamp: "2026-04-18T10:00:01.000Z",
    traceUuid: TRACE,
    sessionUuid: SESS,
    teamUuid: TEAM,
    sourceRole: "capability",
    sourceKey: "nano-agent.capability.bash@v1",
    turnUuid: TURN,
    audience: "internal",
    layer: "durable-transcript",
    toolName: "bash",
    durationMs: 9,
  };
  const body = traceEventToAuditBody(event);
  assert.notEqual(body, null);
  const recovered = auditBodyToTraceEvent(body, {
    sessionUuid: SESS,
    teamUuid: TEAM,
    timestamp: event.timestamp,
  });
  assert.deepEqual(validateTraceEvent(recovered), []);
  assert.equal(recovered.sourceRole, "capability");
  assert.equal(recovered.toolName, "bash");
});

test("CONCEPTUAL_LAYER_OF_TRACE_LAYER documents the conceptual mapping", () => {
  assert.equal(CONCEPTUAL_LAYER_OF_TRACE_LAYER["live"], "diagnostic");
  assert.equal(CONCEPTUAL_LAYER_OF_TRACE_LAYER["durable-audit"], "durable");
  assert.equal(
    CONCEPTUAL_LAYER_OF_TRACE_LAYER["durable-transcript"],
    "durable",
  );
});

test("NacpAlertPayloadSchema: only platform-scoped alerts may omit trace_uuid", () => {
  const platform = NacpAlertPayloadSchema.safeParse({
    alert_uuid: ALERT_UUID,
    team_uuid: TEAM,
    scope: "platform",
    severity: "warning",
    category: "queue.backpressure",
    message: "queue degraded",
    emitted_at: "2026-04-18T10:00:00.000+00:00",
  });
  assert.equal(platform.success, true);

  for (const scope of ["request", "session", "turn"]) {
    const r = NacpAlertPayloadSchema.safeParse({
      alert_uuid: ALERT_UUID,
      team_uuid: TEAM,
      scope,
      severity: "error",
      category: "trace.lost",
      message: "trace anchor lost",
      emitted_at: "2026-04-18T10:00:00.000+00:00",
    });
    assert.equal(
      r.success,
      false,
      `${scope}-scoped alert must require trace_uuid`,
    );
  }

  const sessionWithTrace = NacpAlertPayloadSchema.safeParse({
    alert_uuid: ALERT_UUID,
    team_uuid: TEAM,
    scope: "session",
    trace_uuid: TRACE,
    severity: "error",
    category: "trace.lost",
    message: "trace anchor lost",
    emitted_at: "2026-04-18T10:00:00.000+00:00",
  });
  assert.equal(sessionWithTrace.success, true);
});
