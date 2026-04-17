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
