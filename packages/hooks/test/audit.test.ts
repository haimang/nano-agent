import { describe, it, expect } from "vitest";
// Relative import to the sibling nacp-core package so the audit body
// shape is validated against the real Core schema without adding a
// workspace install step.
import { AuditRecordBodySchema } from "../../nacp-core/src/messages/system.js";
import { buildHookAuditRecord, buildHookAuditEntry } from "../src/audit.js";
import type { AggregatedHookOutcome, HookOutcome } from "../src/outcome.js";

function makeOutcome(overrides: Partial<AggregatedHookOutcome> = {}): AggregatedHookOutcome {
  return {
    finalAction: "continue",
    outcomes: [],
    blocked: false,
    ...overrides,
  };
}

describe("buildHookAuditRecord → AuditRecordBody", () => {
  it("produces an audit.record body with event_kind='hook.outcome' and the hook event in detail", () => {
    const outcomes: HookOutcome[] = [
      { action: "continue", handlerId: "h1", durationMs: 5 },
      { action: "continue", handlerId: "h2", durationMs: 10 },
    ];

    const body = buildHookAuditRecord(
      "PreToolUse",
      makeOutcome({ outcomes }),
      15,
      { timestamp: "2026-04-17T00:00:00.000Z" },
    );

    expect(body.event_kind).toBe("hook.outcome");
    expect(body.detail?.hookEvent).toBe("PreToolUse");
    expect(body.detail?.handlerCount).toBe(2);
    expect(body.detail?.totalDurationMs).toBe(15);
    expect(body.detail?.timestamp).toBe("2026-04-17T00:00:00.000Z");
    expect(body.detail?.blocked).toBe(false);
  });

  it("round-trips through @nano-agent/nacp-core AuditRecordBodySchema", () => {
    const body = buildHookAuditRecord(
      "PreCompact",
      makeOutcome({
        finalAction: "block",
        blocked: true,
        outcomes: [{ action: "block", handlerId: "blocker", durationMs: 1 }],
        blockReason: "policy violation",
      }),
      1,
    );

    const parsed = AuditRecordBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it("records blockedBy when outcome is blocked", () => {
    const body = buildHookAuditRecord(
      "PreToolUse",
      makeOutcome({
        finalAction: "block",
        blocked: true,
        outcomes: [{ action: "block", handlerId: "policy-blocker", durationMs: 3 }],
      }),
      3,
    );

    expect(body.detail?.blockedBy).toBe("policy-blocker");
    expect(body.detail?.blocked).toBe(true);
  });

  it("records blockedBy for stop action", () => {
    const body = buildHookAuditRecord(
      "PreCompact",
      makeOutcome({
        finalAction: "stop",
        blocked: true,
        outcomes: [{ action: "stop", handlerId: "stopper", durationMs: 1 }],
      }),
      1,
    );

    expect(body.detail?.blockedBy).toBe("stopper");
  });

  it("handles zero handlers", () => {
    const body = buildHookAuditRecord(
      "SessionStart",
      makeOutcome(),
      0,
    );

    expect(body.detail?.handlerCount).toBe(0);
    expect(body.detail?.totalDurationMs).toBe(0);
    expect(body.detail?.blockedBy).toBeUndefined();
  });

  it("identifies the first blocking handler when multiple exist", () => {
    const outcomes: HookOutcome[] = [
      { action: "continue", handlerId: "h1", durationMs: 1 },
      { action: "block", handlerId: "first-blocker", durationMs: 2 },
      { action: "block", handlerId: "second-blocker", durationMs: 3 },
    ];

    const body = buildHookAuditRecord(
      "UserPromptSubmit",
      makeOutcome({
        finalAction: "block",
        blocked: true,
        outcomes,
      }),
      6,
    );

    expect(body.detail?.blockedBy).toBe("first-blocker");
  });

  it("embeds merged diagnostics into detail.diagnostics when present", () => {
    const body = buildHookAuditRecord(
      "SessionEnd",
      makeOutcome({ mergedDiagnostics: { slow: true, slowness_ms: 1200 } }),
      5,
    );

    expect(body.detail?.diagnostics).toEqual({ slow: true, slowness_ms: 1200 });
  });
});

describe("buildHookAuditRecord — B5 v2 events", () => {
  it("carries the new hookEvent name in detail; event_kind stays 'hook.outcome'", () => {
    for (const name of [
      "Setup",
      "Stop",
      "PermissionRequest",
      "PermissionDenied",
      "ContextPressure",
      "ContextCompactArmed",
      "ContextCompactPrepareStarted",
      "ContextCompactCommitted",
      "ContextCompactFailed",
      "EvalSinkOverflow",
    ] as const) {
      const body = buildHookAuditRecord(name, makeOutcome(), 0);
      expect(body.event_kind).toBe("hook.outcome");
      expect(body.detail?.hookEvent).toBe(name);
      const parsed = AuditRecordBodySchema.safeParse(body);
      expect(parsed.success).toBe(true);
    }
  });

  it("PermissionRequest with block outcome records blockedBy + blockReason", () => {
    const body = buildHookAuditRecord(
      "PermissionRequest",
      makeOutcome({
        finalAction: "block",
        blocked: true,
        outcomes: [
          {
            action: "block",
            handlerId: "policy-guard",
            durationMs: 2,
            additionalContext: "workspace escape",
          },
        ],
        blockReason: "workspace escape",
      }),
      2,
    );
    expect(body.detail?.blockedBy).toBe("policy-guard");
    expect(body.detail?.blockReason).toBe("workspace escape");
  });
});

describe("buildHookAuditEntry (internal lifecycle view)", () => {
  it("returns the flat lifecycle shape callers may still want", () => {
    const entry = buildHookAuditEntry(
      "PreToolUse",
      makeOutcome({
        finalAction: "block",
        blocked: true,
        outcomes: [{ action: "block", handlerId: "policy-blocker", durationMs: 3 }],
      }),
      3,
    );
    expect(entry.eventName).toBe("PreToolUse");
    expect(entry.handlerCount).toBe(1);
    expect(entry.blockedBy).toBe("policy-blocker");
    expect(entry.totalDurationMs).toBe(3);
    expect(() => new Date(entry.timestamp)).not.toThrow();
  });
});
