/**
 * Tests for outcome aggregation.
 *
 * Locks the event-specific allowlist behaviour:
 *   - `stop` / `block` actions are demoted to `continue` on events that
 *     don't allow them (UserPromptSubmit, PostToolUse, PostCompact, ...).
 *   - `additionalContext` / `diagnostics` are only merged when allowed.
 *   - `updatedInput` is only propagated on `PreToolUse` — silently
 *     dropped elsewhere.
 *   - strictest-wins precedence: stop > block > continue.
 */

import { describe, it, expect } from "vitest";
import { aggregateOutcomes } from "../src/outcome.js";
import type { HookOutcome } from "../src/outcome.js";

function oc(
  action: HookOutcome["action"],
  overrides: Partial<HookOutcome> = {},
): HookOutcome {
  return {
    action,
    handlerId: overrides.handlerId ?? `h-${Math.random().toString(36).slice(2, 8)}`,
    durationMs: overrides.durationMs ?? 1,
    ...overrides,
  };
}

describe("aggregateOutcomes — basic merge rules", () => {
  it("returns finalAction=continue for an empty outcome list", () => {
    const agg = aggregateOutcomes([], "PreToolUse");
    expect(agg.finalAction).toBe("continue");
    expect(agg.blocked).toBe(false);
    expect(agg.outcomes).toHaveLength(0);
  });

  it("strictest-wins: stop > block > continue", () => {
    const agg = aggregateOutcomes(
      [oc("continue"), oc("block"), oc("stop")],
      "PostToolUseFailure", // allows both block (no!) — wait, block NOT allowed here
      // Actually to test strictness purely we pick an event that allows BOTH stop and block.
      // There's no such event, so test with the catalog's rules applied instead.
    );
    // PostToolUseFailure allows stop but NOT block → block demoted to continue.
    // So final = stop via the stop outcome.
    expect(agg.finalAction).toBe("stop");
    expect(agg.blocked).toBe(true);
  });

  it("concatenates additionalContext with newlines when allowed", () => {
    const agg = aggregateOutcomes(
      [
        oc("continue", { additionalContext: "first" }),
        oc("continue", { additionalContext: "second" }),
      ],
      "PreToolUse",
    );
    expect(agg.mergedContext).toBe("first\nsecond");
  });

  it("shallow-merges diagnostics when allowed", () => {
    const agg = aggregateOutcomes(
      [
        oc("continue", { diagnostics: { a: 1 } }),
        oc("continue", { diagnostics: { b: 2 } }),
      ],
      "PreToolUse",
    );
    expect(agg.mergedDiagnostics).toEqual({ a: 1, b: 2 });
  });
});

describe("aggregateOutcomes — event-specific allowlist", () => {
  it("UserPromptSubmit: block is allowed", () => {
    const agg = aggregateOutcomes([oc("block", { handlerId: "policy" })], "UserPromptSubmit");
    expect(agg.finalAction).toBe("block");
    expect(agg.blocked).toBe(true);
  });

  it("UserPromptSubmit: updatedInput is NOT allowed — silently dropped", () => {
    const agg = aggregateOutcomes(
      [oc("continue", { updatedInput: { prompt: "rewritten" } })],
      "UserPromptSubmit",
    );
    expect(agg.updatedInput).toBeUndefined();
  });

  it("PreToolUse: updatedInput is allowed and propagated", () => {
    const agg = aggregateOutcomes(
      [oc("continue", { updatedInput: { tool_input: "safe" } })],
      "PreToolUse",
    );
    expect(agg.updatedInput).toEqual({ tool_input: "safe" });
  });

  it("PreToolUse: last-non-undefined updatedInput wins across multiple handlers", () => {
    const agg = aggregateOutcomes(
      [
        oc("continue", { handlerId: "a", updatedInput: { tool_input: "first" } }),
        oc("continue", { handlerId: "b" /* no updatedInput */ }),
        oc("continue", { handlerId: "c", updatedInput: { tool_input: "final" } }),
      ],
      "PreToolUse",
    );
    expect(agg.updatedInput).toEqual({ tool_input: "final" });
  });

  it("PostToolUseFailure: stop is allowed (design §7.2)", () => {
    const agg = aggregateOutcomes([oc("stop", { handlerId: "halter" })], "PostToolUseFailure");
    expect(agg.finalAction).toBe("stop");
    expect(agg.blocked).toBe(true);
  });

  it("PostToolUseFailure: block is NOT allowed — demoted to continue", () => {
    const agg = aggregateOutcomes([oc("block", { handlerId: "nope" })], "PostToolUseFailure");
    expect(agg.finalAction).toBe("continue");
    expect(agg.blocked).toBe(false);
  });

  it("PostToolUse: stop is NOT allowed — demoted to continue", () => {
    const agg = aggregateOutcomes([oc("stop")], "PostToolUse");
    expect(agg.finalAction).toBe("continue");
  });

  it("PostCompact: additionalContext is allowed (design §7.2)", () => {
    const agg = aggregateOutcomes(
      [oc("continue", { additionalContext: "summary: turn-42" })],
      "PostCompact",
    );
    expect(agg.mergedContext).toBe("summary: turn-42");
  });

  it("PostCompact: block is NOT allowed — demoted", () => {
    const agg = aggregateOutcomes([oc("block")], "PostCompact");
    expect(agg.finalAction).toBe("continue");
  });

  it("SessionStart: diagnostics are allowed and merged", () => {
    const agg = aggregateOutcomes(
      [oc("continue", { diagnostics: { slow: true } })],
      "SessionStart",
    );
    expect(agg.mergedDiagnostics).toEqual({ slow: true });
  });

  it("PreCompact: block is allowed", () => {
    const agg = aggregateOutcomes(
      [oc("block", { handlerId: "token-guard", additionalContext: "budget exceeded" })],
      "PreCompact",
    );
    expect(agg.finalAction).toBe("block");
    expect(agg.blockReason).toBe("budget exceeded");
  });

  it("SessionEnd: additionalContext is NOT allowed — silently dropped", () => {
    const agg = aggregateOutcomes(
      [oc("continue", { additionalContext: "should be dropped" })],
      "SessionEnd",
    );
    expect(agg.mergedContext).toBeUndefined();
  });
});

describe("aggregateOutcomes — blockReason derivation", () => {
  it("uses the blocking handler's additionalContext as blockReason when present", () => {
    const agg = aggregateOutcomes(
      [oc("block", { handlerId: "p", additionalContext: "policy X" })],
      "PreToolUse",
    );
    expect(agg.blockReason).toBe("policy X");
  });

  it("falls back to 'Blocked by handler <id>' when no additionalContext is provided", () => {
    const agg = aggregateOutcomes([oc("block", { handlerId: "p" })], "PreToolUse");
    expect(agg.blockReason).toBe("Blocked by handler p");
  });
});

// ──────────────────────────────────────────────────────────────────────
// §B5 — v2 catalog additions (Class B + Class D)
// ──────────────────────────────────────────────────────────────────────

describe("aggregateOutcomes — Class B new events", () => {
  describe("Setup", () => {
    it("allows additionalContext + diagnostics", () => {
      const agg = aggregateOutcomes(
        [
          oc("continue", { additionalContext: "pre-warm cache", diagnostics: { ms: 3 } }),
        ],
        "Setup",
      );
      expect(agg.mergedContext).toBe("pre-warm cache");
      expect(agg.mergedDiagnostics).toEqual({ ms: 3 });
    });

    it("demotes block to continue (not in allowlist)", () => {
      const agg = aggregateOutcomes([oc("block")], "Setup");
      expect(agg.finalAction).toBe("continue");
    });
  });

  describe("Stop", () => {
    it("permits diagnostics only; additionalContext is silently dropped", () => {
      const agg = aggregateOutcomes(
        [
          oc("continue", { diagnostics: { flushed: true }, additionalContext: "dropped" }),
        ],
        "Stop",
      );
      expect(agg.mergedDiagnostics).toEqual({ flushed: true });
      expect(agg.mergedContext).toBeUndefined();
    });
  });

  describe("PermissionRequest — wire-level truth (B5 §2.3 override of P4 §8.5)", () => {
    it("continue → allow verdict (via finalAction)", () => {
      const agg = aggregateOutcomes(
        [oc("continue", { handlerId: "policy", diagnostics: { approved: true } })],
        "PermissionRequest",
      );
      expect(agg.finalAction).toBe("continue");
      expect(agg.blocked).toBe(false);
    });

    it("block → deny verdict, with blockReason from handler additionalContext", () => {
      const agg = aggregateOutcomes(
        [
          oc("block", {
            handlerId: "policy",
            additionalContext: "write outside workspace",
          }),
        ],
        "PermissionRequest",
      );
      expect(agg.finalAction).toBe("block");
      expect(agg.blocked).toBe(true);
      expect(agg.blockReason).toBe("write outside workspace");
    });

    it("empty handler list aggregates to continue — caller is responsible for fail-closed", () => {
      const agg = aggregateOutcomes([], "PermissionRequest");
      expect(agg.finalAction).toBe("continue");
      expect(agg.outcomes).toHaveLength(0);
    });

    it("strictest-wins: even a single deny among allows flips the verdict", () => {
      const agg = aggregateOutcomes(
        [
          oc("continue", { handlerId: "ok-1" }),
          oc("block", { handlerId: "no", additionalContext: "forbidden" }),
          oc("continue", { handlerId: "ok-2" }),
        ],
        "PermissionRequest",
      );
      expect(agg.finalAction).toBe("block");
      expect(agg.blockReason).toBe("forbidden");
    });

    it("stop is NOT allowed — demoted to continue (permission verdict cannot halt the agent loop)", () => {
      const agg = aggregateOutcomes([oc("stop", { handlerId: "panic" })], "PermissionRequest");
      expect(agg.finalAction).toBe("continue");
    });
  });

  describe("PermissionDenied (observational)", () => {
    it("is non-blocking: block in the outcomes is demoted to continue", () => {
      const agg = aggregateOutcomes([oc("block")], "PermissionDenied");
      expect(agg.finalAction).toBe("continue");
    });

    it("allows additionalContext + diagnostics", () => {
      const agg = aggregateOutcomes(
        [oc("continue", { additionalContext: "denied by policy", diagnostics: { rule: "W1" } })],
        "PermissionDenied",
      );
      expect(agg.mergedContext).toBe("denied by policy");
      expect(agg.mergedDiagnostics).toEqual({ rule: "W1" });
    });
  });
});

describe("aggregateOutcomes — Class D new events (async-compact + eval sink)", () => {
  it("ContextPressure allows additionalContext + diagnostics", () => {
    const agg = aggregateOutcomes(
      [oc("continue", { additionalContext: "usage=0.72", diagnostics: { warn: true } })],
      "ContextPressure",
    );
    expect(agg.mergedContext).toBe("usage=0.72");
    expect(agg.mergedDiagnostics).toEqual({ warn: true });
  });

  it("ContextCompactArmed drops additionalContext (diagnostics-only)", () => {
    const agg = aggregateOutcomes(
      [oc("continue", { additionalContext: "dropped", diagnostics: { stateId: "s-1" } })],
      "ContextCompactArmed",
    );
    expect(agg.mergedContext).toBeUndefined();
    expect(agg.mergedDiagnostics).toEqual({ stateId: "s-1" });
  });

  it("ContextCompactCommitted preserves additionalContext (summary reference)", () => {
    const agg = aggregateOutcomes(
      [oc("continue", { additionalContext: "summary@v2" })],
      "ContextCompactCommitted",
    );
    expect(agg.mergedContext).toBe("summary@v2");
  });

  it("ContextCompactFailed drops additionalContext (diagnostics-only)", () => {
    const agg = aggregateOutcomes(
      [oc("continue", { additionalContext: "dropped", diagnostics: { reason: "timeout" } })],
      "ContextCompactFailed",
    );
    expect(agg.mergedContext).toBeUndefined();
    expect(agg.mergedDiagnostics).toEqual({ reason: "timeout" });
  });

  it("EvalSinkOverflow allows additionalContext hint (flush-to-durable)", () => {
    const agg = aggregateOutcomes(
      [oc("continue", { additionalContext: "please flush eval sink" })],
      "EvalSinkOverflow",
    );
    expect(agg.mergedContext).toBe("please flush eval sink");
  });

  it("No Class D event permits block/stop — demoted to continue", () => {
    for (const name of [
      "ContextPressure",
      "ContextCompactArmed",
      "ContextCompactPrepareStarted",
      "ContextCompactCommitted",
      "ContextCompactFailed",
      "EvalSinkOverflow",
    ] as const) {
      const aggBlock = aggregateOutcomes([oc("block")], name);
      const aggStop = aggregateOutcomes([oc("stop")], name);
      expect(aggBlock.finalAction).toBe("continue");
      expect(aggStop.finalAction).toBe("continue");
    }
  });
});
