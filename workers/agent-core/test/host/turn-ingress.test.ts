/**
 * Tests for extractTurnInput — the v1 + Phase 0 widened turn-ingress
 * contract.
 *
 * After A4 Phase 1 the runtime accepts two ingress kinds:
 *   - `session.start` + non-empty `initial_input`
 *   - `session.followup_input` + non-empty `text`
 *
 * Both run after nacp-session's normalizeClientFrame, so this module
 * trusts schema-validated bodies; it still rejects malformed payloads
 * to be defensive against accidental upstream drift.
 */

import { describe, it, expect } from "vitest";
import { extractTurnInput, TURN_INGRESS_NOTE } from "../../src/host/turn-ingress.js";

describe("extractTurnInput / session.start", () => {
  it("returns a TurnInput for session.start with a non-empty initial_input", () => {
    const input = extractTurnInput("session.start", { initial_input: "hello" });
    expect(input).not.toBeNull();
    expect(input!.kind).toBe("session-start-initial-input");
    expect(input!.content).toBe("hello");
    expect(input!.messageType).toBe("session.start");
    expect(typeof input!.turnId).toBe("string");
    expect(input!.turnId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(Number.isNaN(Date.parse(input!.receivedAt))).toBe(false);
  });

  it("returns null when initial_input is missing, wrong-typed, or empty", () => {
    expect(extractTurnInput("session.start", {})).toBeNull();
    expect(extractTurnInput("session.start", { initial_input: 123 })).toBeNull();
    expect(extractTurnInput("session.start", { initial_input: "" })).toBeNull();
    expect(extractTurnInput("session.start", { initial_input: null })).toBeNull();
  });

  it("preserves long initial_input payloads verbatim", () => {
    const long = "x".repeat(10_000);
    const input = extractTurnInput("session.start", { initial_input: long });
    expect(input?.content).toBe(long);
  });
});

describe("extractTurnInput / session.followup_input (Phase 0 widened)", () => {
  it("returns a TurnInput for session.followup_input with non-empty text", () => {
    const input = extractTurnInput("session.followup_input", {
      text: "second turn",
    });
    expect(input).not.toBeNull();
    expect(input!.kind).toBe("session-followup-input");
    expect(input!.content).toBe("second turn");
    expect(input!.messageType).toBe("session.followup_input");
  });

  it("returns null when text is missing, wrong-typed, or empty", () => {
    expect(extractTurnInput("session.followup_input", {})).toBeNull();
    expect(extractTurnInput("session.followup_input", { text: 0 })).toBeNull();
    expect(extractTurnInput("session.followup_input", { text: "" })).toBeNull();
  });

  it("ignores the initial_input field on a followup body", () => {
    const input = extractTurnInput("session.followup_input", {
      text: "real",
      initial_input: "wrong-key",
    });
    expect(input?.content).toBe("real");
  });
});

describe("extractTurnInput / unknown / malformed", () => {
  it("returns null for unrecognised message_type values", () => {
    expect(extractTurnInput("session.resume", { initial_input: "hi" })).toBeNull();
    expect(extractTurnInput("session.end", { initial_input: "hi" })).toBeNull();
    expect(extractTurnInput("session.cancel", { initial_input: "hi" })).toBeNull();
    expect(extractTurnInput("session.prompt", { text: "hi" })).toBeNull();
    expect(extractTurnInput("random.kind", { initial_input: "hi" })).toBeNull();
  });

  it("returns null when the body is not an object", () => {
    expect(extractTurnInput("session.start", null)).toBeNull();
    expect(extractTurnInput("session.start", undefined)).toBeNull();
    expect(extractTurnInput("session.start", "stringy")).toBeNull();
    expect(extractTurnInput("session.start", 42)).toBeNull();
    expect(extractTurnInput("session.followup_input", null)).toBeNull();
  });
});

describe("TURN_INGRESS_NOTE", () => {
  it("documents both ingress kinds and excludes future placeholder language", () => {
    expect(typeof TURN_INGRESS_NOTE).toBe("string");
    expect(TURN_INGRESS_NOTE).toMatch(/session\.start/);
    expect(TURN_INGRESS_NOTE).toMatch(/session\.followup_input/);
    expect(TURN_INGRESS_NOTE).not.toMatch(/not yet frozen/i);
  });
});
