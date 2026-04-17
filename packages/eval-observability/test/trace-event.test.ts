/**
 * Tests for TraceEvent shape.
 *
 * Verifies that the base fields and evidence extension slots compose
 * correctly at the type and runtime level, so evidence-bearing events
 * from multiple subsystems can coexist in a single record.
 */

import { describe, it, expect } from "vitest";
import type {
  TraceEvent,
  TraceEventBase,
  LlmEvidenceExtension,
  ToolEvidenceExtension,
  StorageEvidenceExtension,
} from "../src/trace-event.js";

describe("TraceEvent schema", () => {
  it("accepts a minimal base event", () => {
    const base: TraceEventBase = {
      eventKind: "turn.begin",
      timestamp: "2026-04-16T10:00:00.000Z",
      sessionUuid: "sess-1",
      teamUuid: "team-1",
      audience: "internal",
      layer: "durable-audit",
    };
    const event: TraceEvent = base;
    expect(event.eventKind).toBe("turn.begin");
    expect(event.audience).toBe("internal");
  });

  it("accepts an event with LLM evidence fields", () => {
    const event: TraceEvent = {
      eventKind: "api.response",
      timestamp: "2026-04-16T10:00:01.000Z",
      sessionUuid: "sess-1",
      teamUuid: "team-1",
      audience: "internal",
      layer: "durable-audit",
      provider: "anthropic",
      gateway: "cf-ai-gateway",
      attempt: 1,
      cacheState: "hit",
      ttftMs: 123,
      model: "claude-opus-4-7",
      usageTokens: { input: 100, output: 50, cacheRead: 20 },
    };
    expect(event.provider).toBe("anthropic");
    expect(event.usageTokens?.cacheRead).toBe(20);
  });

  it("accepts an event with tool evidence fields", () => {
    const event: TraceEvent = {
      eventKind: "tool.call.result",
      timestamp: "2026-04-16T10:00:02.000Z",
      sessionUuid: "sess-1",
      teamUuid: "team-1",
      audience: "internal",
      layer: "durable-transcript",
      toolName: "read_file",
      resultSizeBytes: 4096,
      durationMs: 42,
    };
    expect(event.toolName).toBe("read_file");
    expect(event.resultSizeBytes).toBe(4096);
  });

  it("accepts an event with storage evidence fields", () => {
    const event: TraceEvent = {
      eventKind: "api.request",
      timestamp: "2026-04-16T10:00:03.000Z",
      sessionUuid: "sess-1",
      teamUuid: "team-1",
      audience: "internal",
      layer: "durable-audit",
      storageLayer: "do",
      key: "tenants/team-1/trace/sess-1/2026-04-16.jsonl",
      op: "put",
      sizeBytes: 512,
    };
    expect(event.storageLayer).toBe("do");
    expect(event.op).toBe("put");
  });

  it("allows combining LLM + tool + storage evidence on the same event", () => {
    const event: TraceEvent = {
      eventKind: "api.response",
      timestamp: "2026-04-16T10:00:04.000Z",
      sessionUuid: "sess-1",
      teamUuid: "team-1",
      audience: "internal",
      layer: "durable-audit",
      provider: "anthropic",
      toolName: "read_file",
      resultSizeBytes: 2048,
      storageLayer: "do",
      op: "get",
    };
    expect(event.provider).toBe("anthropic");
    expect(event.toolName).toBe("read_file");
    expect(event.storageLayer).toBe("do");
  });

  it("extension types are structurally independent of the base", () => {
    // Smoke check: extension types can be authored in isolation.
    const llm: LlmEvidenceExtension = { provider: "openai", attempt: 2 };
    const tool: ToolEvidenceExtension = { toolName: "write_file", resultSizeBytes: 1 };
    const storage: StorageEvidenceExtension = { op: "put", key: "k", sizeBytes: 1 };
    expect(llm.provider).toBe("openai");
    expect(tool.toolName).toBe("write_file");
    expect(storage.op).toBe("put");
  });

  it("serializes cleanly as JSON (round-trip preserves all fields)", () => {
    const original: TraceEvent = {
      eventKind: "turn.end",
      timestamp: "2026-04-16T10:00:10.000Z",
      sessionUuid: "sess-2",
      teamUuid: "team-2",
      turnUuid: "turn-A",
      stepIndex: 3,
      durationMs: 1200,
      audience: "external",
      layer: "durable-transcript",
      error: { code: "E1", message: "boom" },
      provider: "anthropic",
      toolName: "bash",
    };
    const recovered: TraceEvent = JSON.parse(JSON.stringify(original));
    expect(recovered).toEqual(original);
  });
});
