/**
 * Tests for extractTurnInput — the single v1 turn-ingress contract.
 *
 * Covers:
 *   - Only `session.start` + `initial_input:string` is a valid turn.
 *   - Returns null for any other `message_type` (including the
 *     future-prompt-family placeholder kinds).
 *   - Returns null for malformed bodies.
 *   - The returned `turnId` is a UUID and `receivedAt` is a valid
 *     ISO timestamp.
 */

import { describe, it, expect } from "vitest";
import { extractTurnInput, TURN_INGRESS_NOTE } from "../src/turn-ingress.js";

describe("extractTurnInput", () => {
  it("returns a TurnInput for session.start with a non-empty initial_input", () => {
    const input = extractTurnInput("session.start", { initial_input: "hello" });
    expect(input).not.toBeNull();
    expect(input!.kind).toBe("session-start-initial-input");
    expect(input!.content).toBe("hello");
    expect(typeof input!.turnId).toBe("string");
    expect(input!.turnId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(Number.isNaN(Date.parse(input!.receivedAt))).toBe(false);
  });

  it("returns null when message_type is not session.start", () => {
    expect(extractTurnInput("session.resume", { initial_input: "hi" })).toBeNull();
    expect(extractTurnInput("session.end", { initial_input: "hi" })).toBeNull();
    expect(extractTurnInput("session.cancel", { initial_input: "hi" })).toBeNull();
    expect(extractTurnInput("session.prompt", { initial_input: "hi" })).toBeNull();
    expect(extractTurnInput("random.kind", { initial_input: "hi" })).toBeNull();
  });

  it("returns null when the body is not an object", () => {
    expect(extractTurnInput("session.start", null)).toBeNull();
    expect(extractTurnInput("session.start", undefined)).toBeNull();
    expect(extractTurnInput("session.start", "stringy")).toBeNull();
    expect(extractTurnInput("session.start", 42)).toBeNull();
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

  it("exports a TURN_INGRESS_NOTE that documents the v1 limitation", () => {
    expect(typeof TURN_INGRESS_NOTE).toBe("string");
    expect(TURN_INGRESS_NOTE).toMatch(/follow-up/i);
  });
});
