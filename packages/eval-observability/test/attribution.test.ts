/**
 * Tests for attribution helpers.
 */

import { describe, it, expect } from "vitest";
import { buildLlmAttribution, buildToolAttribution } from "../src/attribution.js";
import type { TraceEvent } from "../src/trace-event.js";

function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    eventKind: "api.request",
    timestamp: "2026-04-16T10:00:00.000Z",
    sessionUuid: "sess-001",
    teamUuid: "team-001",
    audience: "internal",
    layer: "durable-audit",
    ...overrides,
  };
}

describe("buildLlmAttribution", () => {
  it("builds attribution from an LLM event with all fields", () => {
    const event = makeEvent({
      eventKind: "api.response",
      provider: "anthropic",
      gateway: "cf-ai-gateway",
      attempt: 2,
      cacheState: "hit",
      ttftMs: 120,
      durationMs: 500,
    });

    const attr = buildLlmAttribution(event);

    expect(attr).not.toBeNull();
    expect(attr!.eventKind).toBe("api.response");
    expect(attr!.provider).toBe("anthropic");
    expect(attr!.gateway).toBe("cf-ai-gateway");
    expect(attr!.attempt).toBe(2);
    expect(attr!.cacheState).toBe("hit");
    expect(attr!.ttftMs).toBe(120);
    expect(attr!.totalDurationMs).toBe(500);
  });

  it("builds attribution with partial LLM fields", () => {
    const event = makeEvent({
      eventKind: "api.request",
      provider: "openai",
    });

    const attr = buildLlmAttribution(event);

    expect(attr).not.toBeNull();
    expect(attr!.provider).toBe("openai");
    expect(attr!.gateway).toBeUndefined();
    expect(attr!.attempt).toBeUndefined();
  });

  it("returns null when no LLM evidence fields present", () => {
    const event = makeEvent({
      eventKind: "turn.begin",
    });

    expect(buildLlmAttribution(event)).toBeNull();
  });

  it("recognizes ttftMs alone as LLM evidence", () => {
    const event = makeEvent({
      eventKind: "api.response",
      ttftMs: 50,
    });

    const attr = buildLlmAttribution(event);
    expect(attr).not.toBeNull();
    expect(attr!.ttftMs).toBe(50);
  });
});

describe("buildToolAttribution", () => {
  it("builds attribution from a tool event, surfacing toolName + resultSizeBytes", () => {
    const event = makeEvent({
      eventKind: "tool.call.result",
      toolName: "read_file",
      resultSizeBytes: 2048,
      durationMs: 200,
    });

    const attr = buildToolAttribution(event);

    expect(attr).not.toBeNull();
    expect(attr!.eventKind).toBe("tool.call.result");
    expect(attr!.toolName).toBe("read_file");
    expect(attr!.resultSizeBytes).toBe(2048);
    expect(attr!.totalDurationMs).toBe(200);
  });

  it("returns null when toolName is not present", () => {
    const event = makeEvent({
      eventKind: "api.request",
    });

    expect(buildToolAttribution(event)).toBeNull();
  });

  it("handles tool event without durationMs or resultSizeBytes", () => {
    const event = makeEvent({
      eventKind: "tool.call.result",
      toolName: "write_file",
    });

    const attr = buildToolAttribution(event);

    expect(attr).not.toBeNull();
    expect(attr!.toolName).toBe("write_file");
    expect(attr!.totalDurationMs).toBeUndefined();
    expect(attr!.resultSizeBytes).toBeUndefined();
  });

  it("carries an oversized result size through attribution unchanged (for downstream policy)", () => {
    const event = makeEvent({
      eventKind: "tool.call.result",
      toolName: "read_file",
      resultSizeBytes: 10_000_000,
    });

    const attr = buildToolAttribution(event);
    expect(attr).not.toBeNull();
    expect(attr!.resultSizeBytes).toBe(10_000_000);
  });
});
