import { describe, it, expect } from "vitest";
import { normalizeStreamChunks } from "../../src/llm/stream-normalizer.js";
import { OpenAIChatAdapter } from "../../src/llm/adapters/openai-chat.js";
import type { NormalizedLLMEvent } from "../../src/llm/canonical.js";

// ── Helpers ─────────────────────────────────────────────────────

async function* toAsyncIterable(items: string[]): AsyncGenerator<string> {
  for (const item of items) {
    yield item;
  }
}

async function collectEvents(gen: AsyncGenerator<NormalizedLLMEvent>): Promise<NormalizedLLMEvent[]> {
  const events: NormalizedLLMEvent[] = [];
  for await (const e of gen) {
    events.push(e);
  }
  return events;
}

// ── Tests ───────────────────────────────────────────────────────

describe("normalizeStreamChunks", () => {
  const adapter = new OpenAIChatAdapter();

  it("yields delta events from SSE content chunks", async () => {
    const chunks = [
      'data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"index":0,"delta":{"content":" world"}}]}',
    ];

    const events = await collectEvents(normalizeStreamChunks(toAsyncIterable(chunks), adapter));

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "delta", content: "Hello", index: 0 });
    expect(events[1]).toEqual({ type: "delta", content: " world", index: 0 });
  });

  it("yields finish event with usage", async () => {
    const chunks = [
      'data: {"choices":[{"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
    ];

    const events = await collectEvents(normalizeStreamChunks(toAsyncIterable(chunks), adapter));

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("finish");
    if (events[0]!.type === "finish") {
      expect(events[0]!.finishReason).toBe("stop");
      expect(events[0]!.usage.inputTokens).toBe(10);
      expect(events[0]!.usage.outputTokens).toBe(5);
    }
  });

  it("yields tool_call events", async () => {
    const chunks = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_123","function":{"name":"get_weather","arguments":""}}]}}]}',
    ];

    const events = await collectEvents(normalizeStreamChunks(toAsyncIterable(chunks), adapter));

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("tool_call");
    if (events[0]!.type === "tool_call") {
      expect(events[0]!.id).toBe("call_123");
      expect(events[0]!.name).toBe("get_weather");
    }
  });

  it("skips [DONE] marker", async () => {
    const chunks = [
      'data: {"choices":[{"index":0,"delta":{"content":"Hi"}}]}',
      "data: [DONE]",
    ];

    const events = await collectEvents(normalizeStreamChunks(toAsyncIterable(chunks), adapter));
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("delta");
  });

  it("skips empty and non-SSE lines", async () => {
    const chunks = [
      "",
      "   ",
      "not-sse-data",
      'data: {"choices":[{"index":0,"delta":{"content":"OK"}}]}',
    ];

    const events = await collectEvents(normalizeStreamChunks(toAsyncIterable(chunks), adapter));
    expect(events).toHaveLength(1);
  });

  it("skips malformed JSON", async () => {
    const chunks = [
      "data: {invalid json}",
      'data: {"choices":[{"index":0,"delta":{"content":"Valid"}}]}',
    ];

    const events = await collectEvents(normalizeStreamChunks(toAsyncIterable(chunks), adapter));
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("delta");
  });

  it("handles empty input", async () => {
    const events = await collectEvents(normalizeStreamChunks(toAsyncIterable([]), adapter));
    expect(events).toHaveLength(0);
  });

  it("handles finish reason tool_calls", async () => {
    const chunks = [
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":8,"completion_tokens":12,"total_tokens":20}}',
    ];

    const events = await collectEvents(normalizeStreamChunks(toAsyncIterable(chunks), adapter));
    expect(events).toHaveLength(1);
    if (events[0]!.type === "finish") {
      expect(events[0]!.finishReason).toBe("tool_calls");
    }
  });
});

describe("OpenAIChatAdapter.parseStreamChunk", () => {
  const adapter = new OpenAIChatAdapter();

  it("parses a usage-only chunk (no choices)", () => {
    const chunk = 'data: {"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}';
    const event = adapter.parseStreamChunk(chunk);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("finish");
    if (event!.type === "finish") {
      expect(event!.usage.inputTokens).toBe(5);
    }
  });

  it("returns null for role-only delta", () => {
    const chunk = 'data: {"choices":[{"index":0,"delta":{"role":"assistant"}}]}';
    const event = adapter.parseStreamChunk(chunk);
    expect(event).toBeNull();
  });
});
