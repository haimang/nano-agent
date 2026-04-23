/**
 * Tests for the trace anchor + recovery helper (A3 Phase 3 / P3-01).
 *
 * The helper is the load-bearing piece of trace-first foundation: every
 * lifecycle seam (checkpoint, restore, alarm, ingress, replay) must run
 * incoming candidates through it and either obtain a recovered event or
 * receive a typed `TraceRecoveryError`.
 */

import { describe, it, expect } from "vitest";
import {
  TraceRecoveryError,
  TRACE_RECOVERY_REASONS,
  attemptTraceRecovery,
  type TraceAnchor,
  type TraceCandidate,
} from "../../src/eval/anchor-recovery.js";
import { isTraceLawCompliant } from "../../src/eval/trace-event.js";

const TRACE = "11111111-1111-4111-8111-111111111111";
const TRACE_OTHER = "22222222-2222-4222-8222-222222222222";
const SESS = "33333333-3333-4333-8333-333333333333";

const ANCHOR: TraceAnchor = {
  traceUuid: TRACE,
  sessionUuid: SESS,
  teamUuid: "team-a",
  sourceRole: "session",
  sourceKey: "nano-agent.session.do@v1",
};

function makeCandidate(
  overrides: Partial<TraceCandidate> = {},
): TraceCandidate {
  return {
    eventKind: "turn.begin",
    timestamp: "2026-04-18T10:00:00.000Z",
    audience: "internal",
    layer: "durable-audit",
    ...overrides,
  };
}

describe("anchor-recovery / taxonomy", () => {
  it("exports the full reason list", () => {
    expect(TRACE_RECOVERY_REASONS).toEqual([
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

  it("TraceRecoveryError carries reason + detail", () => {
    const e = new TraceRecoveryError("anchor-missing", "missing", { x: 1 });
    expect(e.name).toBe("TraceRecoveryError");
    expect(e.reason).toBe("anchor-missing");
    expect(e.detail).toEqual({ x: 1 });
  });
});

describe("attemptTraceRecovery / success paths", () => {
  it("threads the anchor onto a bare candidate", () => {
    const event = attemptTraceRecovery(makeCandidate(), { anchor: ANCHOR });
    expect(event.traceUuid).toBe(TRACE);
    expect(event.sessionUuid).toBe(SESS);
    expect(event.teamUuid).toBe("team-a");
    expect(event.sourceRole).toBe("session");
    expect(event.sourceKey).toBe("nano-agent.session.do@v1");
    expect(isTraceLawCompliant(event)).toBe(true);
  });

  it("preserves explicit candidate fields over anchor defaults", () => {
    const event = attemptTraceRecovery(
      makeCandidate({
        traceUuid: TRACE,
        sourceRole: "capability",
        turnUuid: "turn-X",
      }),
      { anchor: ANCHOR },
    );
    expect(event.sourceRole).toBe("capability");
    expect(event.turnUuid).toBe("turn-X");
  });

  it("accepts a candidate already trace-law compliant without an anchor", () => {
    const event = attemptTraceRecovery(
      makeCandidate({
        traceUuid: TRACE,
        sessionUuid: SESS,
        teamUuid: "team-a",
        sourceRole: "session",
      }),
    );
    expect(event.traceUuid).toBe(TRACE);
  });

  it("threads sourceKey / messageUuid from the anchor when missing", () => {
    const event = attemptTraceRecovery(makeCandidate(), {
      anchor: { ...ANCHOR, messageUuid: "44444444-4444-4444-8444-444444444444" },
    });
    expect(event.messageUuid).toBe("44444444-4444-4444-8444-444444444444");
  });
});

describe("attemptTraceRecovery / failure paths", () => {
  it("throws anchor-missing when neither candidate nor anchor has traceUuid", () => {
    try {
      attemptTraceRecovery(makeCandidate());
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TraceRecoveryError);
      expect((e as TraceRecoveryError).reason).toBe("anchor-missing");
    }
  });

  it("throws anchor-missing when traceUuid is not a UUID", () => {
    try {
      attemptTraceRecovery(makeCandidate({ traceUuid: "bad" }));
      expect.fail("expected throw");
    } catch (e) {
      expect((e as TraceRecoveryError).reason).toBe("anchor-missing");
    }
  });

  it("throws trace-carrier-mismatch when candidate disagrees with anchor", () => {
    try {
      attemptTraceRecovery(makeCandidate({ traceUuid: TRACE_OTHER }), {
        anchor: ANCHOR,
      });
      expect.fail("expected throw");
    } catch (e) {
      expect((e as TraceRecoveryError).reason).toBe("trace-carrier-mismatch");
    }
  });

  it("throws anchor-ambiguous when primary and secondary disagree", () => {
    try {
      attemptTraceRecovery(makeCandidate(), {
        anchor: ANCHOR,
        secondaryAnchor: { ...ANCHOR, traceUuid: TRACE_OTHER },
      });
      expect.fail("expected throw");
    } catch (e) {
      expect((e as TraceRecoveryError).reason).toBe("anchor-ambiguous");
    }
  });

  it("throws anchor-missing when anchor is missing required fields", () => {
    const partial = {
      traceUuid: TRACE,
      sessionUuid: SESS,
      // teamUuid + sourceRole missing
    } as unknown as TraceAnchor;
    try {
      attemptTraceRecovery(makeCandidate(), { anchor: partial });
      expect.fail("expected throw");
    } catch (e) {
      expect((e as TraceRecoveryError).reason).toBe("anchor-missing");
    }
  });

  it("never silently mutates the candidate input", () => {
    const candidate = makeCandidate();
    expect(candidate.traceUuid).toBeUndefined();
    attemptTraceRecovery(candidate, { anchor: ANCHOR });
    expect(candidate.traceUuid).toBeUndefined(); // original untouched
  });
});
