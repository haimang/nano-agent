/**
 * Integration — A3 Phase 5 (P5-01) trace recovery evidence.
 *
 * Demonstrates the two paths required by trace law:
 *   1. *Recovery success.* A candidate event arriving at a downstream
 *      seam without a complete carrier is repaired by threading the
 *      session's known anchor; the resulting event is trace-law
 *      compliant.
 *   2. *Explicit failure.* A candidate that disagrees with the anchor
 *      raises a typed `TraceRecoveryError` with reason
 *      `trace-carrier-mismatch`; the helper does not silently continue.
 *
 * The test also confirms that an audit-body round trip (encode + decode
 * via the eval-observability codec) over a recovered event still yields
 * a trace-law-compliant TraceEvent — i.e. the recovery path composes with
 * the durable persistence path.
 */

import { describe, it, expect } from "vitest";
import {
  attemptTraceRecovery,
  TraceRecoveryError,
  validateTraceEvent,
  traceEventToAuditBody,
  auditBodyToTraceEvent,
  type TraceAnchor,
} from "../../../src/eval/index.js";

const TRACE = "11111111-1111-4111-8111-111111111111";
const SESS = "22222222-2222-4222-8222-222222222222";

const ANCHOR: TraceAnchor = {
  traceUuid: TRACE,
  sessionUuid: SESS,
  teamUuid: "team-recovery",
  sourceRole: "session",
  sourceKey: "nano-agent.session.do@v1",
  turnUuid: "33333333-3333-4333-8333-333333333333",
};

describe("trace-recovery / Phase 5 evidence", () => {
  it("recovery success: anchor threading repairs a bare candidate", () => {
    const recovered = attemptTraceRecovery(
      {
        eventKind: "tool.call.result",
        timestamp: "2026-04-18T10:00:00.000Z",
        audience: "internal",
        layer: "durable-transcript",
        toolName: "bash",
      },
      { anchor: ANCHOR },
    );
    expect(recovered.traceUuid).toBe(TRACE);
    expect(recovered.sourceRole).toBe("session");
    expect(recovered.turnUuid).toBe(ANCHOR.turnUuid);
    expect(validateTraceEvent(recovered)).toEqual([]);
  });

  it("recovery success: round-trips through the audit codec without losing carriers", () => {
    const recovered = attemptTraceRecovery(
      {
        eventKind: "turn.end",
        timestamp: "2026-04-18T10:00:01.000Z",
        audience: "internal",
        layer: "durable-audit",
        durationMs: 4321,
      },
      { anchor: ANCHOR },
    );
    const body = traceEventToAuditBody(recovered);
    expect(body).not.toBeNull();
    const restored = auditBodyToTraceEvent(body!, {
      sessionUuid: SESS,
      teamUuid: "team-recovery",
      timestamp: recovered.timestamp,
    });
    expect(restored.traceUuid).toBe(TRACE);
    expect(restored.sourceRole).toBe("session");
    expect(restored.durationMs).toBe(4321);
    expect(validateTraceEvent(restored)).toEqual([]);
  });

  it("explicit failure: trace-carrier-mismatch is raised, never swallowed", () => {
    let caught: TraceRecoveryError | undefined;
    try {
      attemptTraceRecovery(
        {
          eventKind: "turn.begin",
          timestamp: "2026-04-18T10:00:02.000Z",
          audience: "internal",
          layer: "durable-audit",
          traceUuid: "44444444-4444-4444-8444-444444444444",
        },
        { anchor: ANCHOR },
      );
    } catch (e) {
      caught = e as TraceRecoveryError;
    }
    expect(caught).toBeDefined();
    expect(caught).toBeInstanceOf(TraceRecoveryError);
    expect(caught!.reason).toBe("trace-carrier-mismatch");
    expect(caught!.detail?.candidate).toBe(
      "44444444-4444-4444-8444-444444444444",
    );
    expect(caught!.detail?.anchor).toBe(TRACE);
  });

  it("explicit failure: anchor-missing when nothing supplies traceUuid", () => {
    expect(() =>
      attemptTraceRecovery({
        eventKind: "tool.call.result",
        timestamp: "2026-04-18T10:00:03.000Z",
        audience: "internal",
        layer: "live",
      }),
    ).toThrowError(TraceRecoveryError);
  });
});
