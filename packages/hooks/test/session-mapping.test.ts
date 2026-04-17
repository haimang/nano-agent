import { describe, it, expect } from "vitest";
// Relative import to sibling nacp-session package — tests confirm that
// the broadcast body we build parses under the real Session schema.
import { SessionStreamEventBodySchema } from "../../nacp-session/src/stream-event.js";
import { hookEventToSessionBroadcast } from "../src/session-mapping.js";
import type { AggregatedHookOutcome, HookOutcome } from "../src/outcome.js";

function makeOutcome(overrides: Partial<AggregatedHookOutcome> = {}): AggregatedHookOutcome {
  return {
    finalAction: "continue",
    outcomes: [],
    blocked: false,
    ...overrides,
  };
}

describe("hookEventToSessionBroadcast", () => {
  it("returns a hook.broadcast body aligned with SessionStreamEventBodySchema", () => {
    const body = hookEventToSessionBroadcast(
      "SessionStart",
      { sessionId: "s1" },
      makeOutcome(),
    );

    expect(body.kind).toBe("hook.broadcast");
    expect(body.event_name).toBe("SessionStart");
    expect(body.payload_redacted).toEqual({ sessionId: "s1" });

    const parsed = SessionStreamEventBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it("includes aggregated_outcome summary with finalAction / blocked / handlerCount", () => {
    const outcomes: HookOutcome[] = [
      { action: "continue", handlerId: "h1", durationMs: 5 },
      { action: "continue", handlerId: "h2", durationMs: 10 },
    ];

    const body = hookEventToSessionBroadcast(
      "PostToolUse",
      { tool: "Bash" },
      makeOutcome({ outcomes }),
    );

    const agg = body.aggregated_outcome as Record<string, unknown>;
    expect(agg.finalAction).toBe("continue");
    expect(agg.blocked).toBe(false);
    expect(agg.handlerCount).toBe(2);
  });

  it("redacts fields listed in catalog redactionHints for PreToolUse", () => {
    const payload = {
      tool_name: "Bash",
      tool_input: "rm -rf /",
      session_id: "s1",
    };

    const body = hookEventToSessionBroadcast(
      "PreToolUse",
      payload,
      makeOutcome(),
    );

    const redacted = body.payload_redacted as Record<string, unknown>;
    expect(redacted.tool_input).toBe("[REDACTED]");
    expect(redacted.tool_name).toBe("Bash");
    expect(redacted.session_id).toBe("s1");
  });

  it("redacts user_input for UserPromptSubmit", () => {
    const body = hookEventToSessionBroadcast(
      "UserPromptSubmit",
      { user_input: "secret prompt", session_id: "s1" },
      makeOutcome(),
    );

    const redacted = body.payload_redacted as Record<string, unknown>;
    expect(redacted.user_input).toBe("[REDACTED]");
    expect(redacted.session_id).toBe("s1");
  });

  it("does not redact fields for events with no redactionHints", () => {
    const body = hookEventToSessionBroadcast(
      "SessionStart",
      { sessionId: "s1", data: "visible" },
      makeOutcome(),
    );

    const redacted = body.payload_redacted as Record<string, unknown>;
    expect(redacted.sessionId).toBe("s1");
    expect(redacted.data).toBe("visible");
  });

  it("handles null/undefined payload gracefully", () => {
    const body = hookEventToSessionBroadcast(
      "SessionEnd",
      null,
      makeOutcome(),
    );

    expect(body.payload_redacted).toBeNull();
    const parsed = SessionStreamEventBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it("surfaces blockReason in aggregated_outcome when blocked", () => {
    const body = hookEventToSessionBroadcast(
      "PreToolUse",
      {},
      makeOutcome({
        finalAction: "block",
        blocked: true,
        blockReason: "Policy violation",
      }),
    );

    const agg = body.aggregated_outcome as Record<string, unknown>;
    expect(agg.blocked).toBe(true);
    expect(agg.blockReason).toBe("Policy violation");
  });
});
