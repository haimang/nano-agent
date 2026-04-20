/**
 * Tests for the permission verdict helpers (B5 §2.3 override of P4 §8.5).
 *
 * The design originally wanted `allow` / `deny` outcome actions, but
 * `HookOutcomeBodySchema` has no such fields. The helpers in
 * `permission.ts` compile-away the design's `allow` / `deny` vocabulary
 * to the existing `continue` / `block` wire truth.
 */

import { describe, it, expect } from "vitest";
import { aggregateOutcomes } from "../src/outcome.js";
import type { HookOutcome } from "../src/outcome.js";
import { denyReason, verdictOf } from "../src/permission.js";

function oc(
  action: HookOutcome["action"],
  overrides: Partial<HookOutcome> = {},
): HookOutcome {
  return {
    action,
    handlerId: overrides.handlerId ?? "h",
    durationMs: overrides.durationMs ?? 1,
    ...overrides,
  };
}

describe("verdictOf — PermissionRequest wire translation", () => {
  it("returns `deny` when there are zero handlers (fail-closed)", () => {
    const agg = aggregateOutcomes([], "PermissionRequest");
    expect(verdictOf(agg, "PermissionRequest")).toBe("deny");
  });

  it("returns `allow` when every handler continues", () => {
    const agg = aggregateOutcomes(
      [oc("continue"), oc("continue")],
      "PermissionRequest",
    );
    expect(verdictOf(agg, "PermissionRequest")).toBe("allow");
  });

  it("returns `deny` when any handler blocks (strictest-wins)", () => {
    const agg = aggregateOutcomes(
      [oc("continue"), oc("block", { additionalContext: "blocked by rule" })],
      "PermissionRequest",
    );
    expect(verdictOf(agg, "PermissionRequest")).toBe("deny");
  });

  it("returns `deny` on stop (defensive — stop isn't in allowlist but still fails closed)", () => {
    // stop will be demoted to continue by aggregateOutcomes because it's not in
    // PermissionRequest's allowedOutcomes. Construct the aggregated outcome
    // manually to exercise the defensive branch.
    const defensive = {
      finalAction: "stop" as const,
      outcomes: [oc("stop")],
      blocked: true,
    };
    expect(verdictOf(defensive, "PermissionRequest")).toBe("deny");
  });
});

describe("denyReason", () => {
  it("returns 'no-handler-fail-closed' when zero handlers responded", () => {
    const agg = aggregateOutcomes([], "PermissionRequest");
    expect(denyReason(agg)).toBe("no-handler-fail-closed");
  });

  it("returns the blockReason when a handler supplied one", () => {
    const agg = aggregateOutcomes(
      [oc("block", { additionalContext: "write outside workspace" })],
      "PermissionRequest",
    );
    expect(denyReason(agg)).toBe("write outside workspace");
  });

  it("returns 'denied-by-handler' when handler denied without a reason", () => {
    // blockReason defaults to "Blocked by handler <id>" from the reducer;
    // but construct a custom allowed case where no blockReason is surfaced.
    const custom = {
      finalAction: "block" as const,
      outcomes: [oc("block")],
      blocked: true,
      blockReason: undefined,
    };
    expect(denyReason(custom)).toBe("denied-by-handler");
  });
});
