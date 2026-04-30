// HP6 P3 — tool.call.cancelled stream event schema tests.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.7 HP6
//   * docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md §7 F3
//   * docs/design/hero-to-pro/HPX-qna.md Q21

import { describe, it, expect } from "vitest";
import {
  SessionStreamEventBodySchema,
  STREAM_EVENT_KINDS,
  ToolCallCancelledKind,
} from "../src/index.js";

describe("HP6 tool.call.cancelled — frozen shape", () => {
  it("registers in STREAM_EVENT_KINDS", () => {
    expect(STREAM_EVENT_KINDS).toContain("tool.call.cancelled");
  });

  it("accepts a user-initiated cancel", () => {
    const ev = ToolCallCancelledKind.parse({
      kind: "tool.call.cancelled",
      tool_name: "bash",
      request_uuid: "11111111-1111-4111-8111-111111111111",
      cancel_initiator: "user",
    });
    expect(ev.cancel_initiator).toBe("user");
  });

  it("accepts cancel_initiator=system + reason", () => {
    const ev = ToolCallCancelledKind.parse({
      kind: "tool.call.cancelled",
      tool_name: "bash",
      request_uuid: "11111111-1111-4111-8111-111111111111",
      cancel_initiator: "system",
      reason: "policy timeout",
    });
    expect(ev.cancel_initiator).toBe("system");
    expect(ev.reason).toBe("policy timeout");
  });

  it("accepts cancel_initiator=parent_cancel", () => {
    const ev = ToolCallCancelledKind.parse({
      kind: "tool.call.cancelled",
      tool_name: "bash",
      request_uuid: "11111111-1111-4111-8111-111111111111",
      cancel_initiator: "parent_cancel",
    });
    expect(ev.cancel_initiator).toBe("parent_cancel");
  });

  it("rejects unknown initiators", () => {
    expect(
      ToolCallCancelledKind.safeParse({
        kind: "tool.call.cancelled",
        tool_name: "bash",
        request_uuid: "11111111-1111-4111-8111-111111111111",
        cancel_initiator: "agent",
      }).success,
    ).toBe(false);
  });

  it("requires request_uuid (cancel must correlate)", () => {
    expect(
      ToolCallCancelledKind.safeParse({
        kind: "tool.call.cancelled",
        tool_name: "bash",
        cancel_initiator: "user",
      }).success,
    ).toBe(false);
  });

  it("integrates with the SessionStreamEventBody discriminated union", () => {
    const ev = SessionStreamEventBodySchema.parse({
      kind: "tool.call.cancelled",
      tool_name: "bash",
      request_uuid: "11111111-1111-4111-8111-111111111111",
      cancel_initiator: "user",
    });
    expect(ev.kind).toBe("tool.call.cancelled");
  });
});
