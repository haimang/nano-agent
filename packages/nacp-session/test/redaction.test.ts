import { describe, it, expect } from "vitest";
import { redactPayload } from "../src/redaction.js";

describe("redactPayload", () => {
  it("replaces nested field with [redacted]", () => {
    const payload = { body: { tool_input: { api_key: "secret123" } } };
    const result = redactPayload(payload, ["body.tool_input.api_key"]);
    expect((result.body as any).tool_input.api_key).toBe("[redacted]");
  });

  it("does nothing when no hints", () => {
    const payload = { foo: "bar" };
    expect(redactPayload(payload, [])).toEqual({ foo: "bar" });
  });

  it("ignores non-existent paths", () => {
    const payload = { foo: "bar" };
    const result = redactPayload(payload, ["nonexistent.deep.path"]);
    expect(result).toEqual({ foo: "bar" });
  });

  it("handles multiple hints", () => {
    const payload = { a: "secret", b: { c: "also-secret" }, d: "public" };
    const result = redactPayload(payload, ["a", "b.c"]);
    expect(result.a).toBe("[redacted]");
    expect((result.b as any).c).toBe("[redacted]");
    expect(result.d).toBe("public");
  });

  it("does not mutate original", () => {
    const payload = { key: "value" };
    redactPayload(payload, ["key"]);
    expect(payload.key).toBe("value");
  });
});
