import { describe, it, expect } from "vitest";
// Relative path to the sibling workspace package: we validate that every
// body produced by this adapter parses under the real nacp-session
// `SessionStreamEventBodySchema`.
import { SessionStreamEventBodySchema } from "../../nacp-session/src/stream-event.js";
import { mapLlmEventToSessionBody } from "../src/session-stream-adapter.js";
import type { NormalizedLLMEvent } from "../src/canonical.js";

describe("mapLlmEventToSessionBody", () => {
  it("maps delta event to a schema-valid llm.delta", () => {
    const event: NormalizedLLMEvent = { type: "delta", content: "Hello", index: 0 };
    const result = mapLlmEventToSessionBody(event);

    expect(result).not.toBeNull();
    expect(result!.kind).toBe("llm.delta");
    expect(result!.body).toMatchObject({
      kind: "llm.delta",
      content_type: "text",
      content: "Hello",
      is_final: false,
    });

    const parsed = SessionStreamEventBodySchema.safeParse(result!.body);
    expect(parsed.success).toBe(true);
  });

  it("maps tool_call event to a schema-valid llm.delta with tool_use_start", () => {
    const event: NormalizedLLMEvent = {
      type: "tool_call",
      id: "call_123",
      name: "get_weather",
      arguments: '{"city":"NYC"}',
    };

    const result = mapLlmEventToSessionBody(event);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("llm.delta");

    const body = result!.body as { kind: string; content_type: string; content: string };
    expect(body.kind).toBe("llm.delta");
    expect(body.content_type).toBe("tool_use_start");
    // Tool identity is encoded inside `content` as JSON.
    const decoded = JSON.parse(body.content);
    expect(decoded).toEqual({ id: "call_123", name: "get_weather", arguments: '{"city":"NYC"}' });

    const parsed = SessionStreamEventBodySchema.safeParse(result!.body);
    expect(parsed.success).toBe(true);
  });

  it("returns null for finish event (kernel handles turn.end)", () => {
    const event: NormalizedLLMEvent = {
      type: "finish",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
    expect(mapLlmEventToSessionBody(event)).toBeNull();
  });

  it("maps error event to a schema-valid system.notify with severity='error'", () => {
    const event: NormalizedLLMEvent = {
      type: "error",
      error: {
        category: "rate_limit",
        message: "Too many requests",
        retryable: true,
        status: 429,
      },
    };

    const result = mapLlmEventToSessionBody(event);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("system.notify");

    const body = result!.body as { kind: string; severity: string; message: string };
    expect(body.kind).toBe("system.notify");
    expect(body.severity).toBe("error");
    expect(body.message).toContain("rate_limit");
    expect(body.message).toContain("Too many requests");
    expect(body.message).toContain("retryable");

    const parsed = SessionStreamEventBodySchema.safeParse(result!.body);
    expect(parsed.success).toBe(true);
  });

  it("maps auth error to a schema-valid system.notify without spurious retryable suffix", () => {
    const event: NormalizedLLMEvent = {
      type: "error",
      error: { category: "auth", message: "Invalid API key", retryable: false },
    };

    const result = mapLlmEventToSessionBody(event);
    expect(result).not.toBeNull();

    const body = result!.body as { severity: string; message: string };
    expect(body.severity).toBe("error");
    expect(body.message).toContain("auth");
    expect(body.message).not.toContain("retryable");

    expect(SessionStreamEventBodySchema.safeParse(result!.body).success).toBe(true);
  });

  it("never emits an unknown kind — output is always within the canonical 9-kind catalog", () => {
    const events: NormalizedLLMEvent[] = [
      { type: "delta", content: "a", index: 0 },
      { type: "delta", content: "b", index: 0 },
      {
        type: "tool_call",
        id: "c1",
        name: "search",
        arguments: "{}",
      },
      { type: "error", error: { category: "network", message: "oops", retryable: true } },
    ];
    const ALLOWED = new Set([
      "tool.call.progress",
      "tool.call.result",
      "hook.broadcast",
      "session.update",
      "turn.begin",
      "turn.end",
      "compact.notify",
      "system.notify",
      "llm.delta",
    ]);
    for (const e of events) {
      const out = mapLlmEventToSessionBody(e);
      expect(out).not.toBeNull();
      expect(ALLOWED.has(out!.kind)).toBe(true);
    }
  });
});
