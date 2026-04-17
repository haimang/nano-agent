/**
 * Tests for canonical model types and helpers.
 *
 * Locks:
 *   - `createEmptyUsage()` shape
 *   - `NormalizedLLMEvent` discriminated-union coverage (incl. the new
 *     `llm.request.started` lifecycle anchor)
 *   - `CanonicalContentPart` construction for each `kind`
 *   - Round-trip JSON serialisation for `CanonicalLLMRequest`
 */

import { describe, it, expect } from "vitest";
import type {
  CanonicalContentPart,
  CanonicalLLMRequest,
  CanonicalLLMResult,
  CanonicalMessage,
  DeltaEvent,
  ErrorEvent,
  FinishEvent,
  NormalizedLLMEvent,
  RequestStartedEvent,
  ToolCallEvent,
} from "../src/canonical.js";
import { createEmptyUsage } from "../src/usage.js";

describe("createEmptyUsage", () => {
  it("returns a zero-valued usage object", () => {
    const usage = createEmptyUsage();
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
    expect(usage.totalTokens).toBe(0);
  });
});

describe("CanonicalContentPart", () => {
  it("accepts all four part kinds", () => {
    const text: CanonicalContentPart = { kind: "text", text: "hi" };
    const image: CanonicalContentPart = { kind: "image_url", url: "https://x/p.png" };
    const call: CanonicalContentPart = {
      kind: "tool_call",
      id: "c1",
      name: "search",
      arguments: "{}",
    };
    const result: CanonicalContentPart = {
      kind: "tool_result",
      toolCallId: "c1",
      content: "ok",
    };
    const all = [text, image, call, result];
    for (const p of all) {
      expect(typeof p.kind).toBe("string");
    }
  });
});

describe("CanonicalMessage", () => {
  it("accepts a string-content message", () => {
    const msg: CanonicalMessage = { role: "user", content: "hi" };
    expect(msg.role).toBe("user");
    expect(typeof msg.content).toBe("string");
  });

  it("accepts a multi-part message", () => {
    const msg: CanonicalMessage = {
      role: "user",
      content: [
        { kind: "text", text: "see:" },
        { kind: "image_url", url: "https://x/p.png" },
      ],
    };
    expect(Array.isArray(msg.content)).toBe(true);
  });
});

describe("CanonicalLLMRequest round-trip", () => {
  it("serialises and deserialises losslessly", () => {
    const original: CanonicalLLMRequest = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "be helpful" },
        { role: "user", content: "hi" },
      ],
      temperature: 0.7,
      maxTokens: 512,
      stream: true,
      stopSequences: ["\n\n"],
      metadata: { requestId: "req-1" },
    };
    const recovered = JSON.parse(JSON.stringify(original)) as CanonicalLLMRequest;
    expect(recovered).toEqual(original);
  });
});

describe("NormalizedLLMEvent discriminated union", () => {
  it("covers llm.request.started, delta, tool_call, finish, error", () => {
    const started: RequestStartedEvent = { type: "llm.request.started", requestId: "r", modelId: "m" };
    const delta: DeltaEvent = { type: "delta", content: "x", index: 0 };
    const call: ToolCallEvent = { type: "tool_call", id: "c", name: "n", arguments: "" };
    const fin: FinishEvent = { type: "finish", finishReason: "stop", usage: createEmptyUsage() };
    const err: ErrorEvent = {
      type: "error",
      error: { category: "network", message: "boom", retryable: true },
    };
    const events: NormalizedLLMEvent[] = [started, delta, call, fin, err];
    expect(events.map((e) => e.type).sort()).toEqual([
      "delta",
      "error",
      "finish",
      "llm.request.started",
      "tool_call",
    ]);
  });

  it("narrows correctly via a switch on `type`", () => {
    const event: NormalizedLLMEvent = { type: "delta", content: "a", index: 1 };
    let observed: string;
    switch (event.type) {
      case "delta":
        observed = event.content;
        break;
      case "llm.request.started":
      case "tool_call":
      case "finish":
      case "error":
        observed = "other";
        break;
    }
    expect(observed).toBe("a");
  });
});

describe("CanonicalLLMResult", () => {
  it("carries the final content, finish reason, usage and duration", () => {
    const result: CanonicalLLMResult = {
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      content: [{ kind: "text", text: "done" }],
      model: "gpt-4o",
      durationMs: 123,
    };
    expect(result.finishReason).toBe("stop");
    expect(result.usage.totalTokens).toBe(15);
    expect(result.content).toHaveLength(1);
    expect(result.durationMs).toBe(123);
  });
});
