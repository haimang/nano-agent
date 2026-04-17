/**
 * Tests for three-way event classification.
 *
 * Verifies the live / durable-audit / durable-transcript split and the
 * `shouldPersist` helper that gates `DoStorageTraceSink`.
 */

import { describe, it, expect } from "vitest";
import {
  LIVE_ONLY_EVENTS,
  DURABLE_AUDIT_EVENTS,
  DURABLE_TRANSCRIPT_EVENTS,
  classifyEvent,
  shouldPersist,
} from "../src/classification.js";

describe("classifyEvent", () => {
  it("classifies transcript events as durable-transcript", () => {
    for (const kind of [
      "user.message",
      "assistant.message",
      "tool.call.request",
      "tool.call.result",
    ]) {
      expect(classifyEvent(kind)).toBe("durable-transcript");
    }
  });

  it("classifies audit events as durable-audit", () => {
    for (const kind of [
      "turn.begin",
      "turn.end",
      "hook.outcome",
      "hook.broadcast",
      "compact.start",
      "compact.end",
      "compact.notify",
      "session.start",
      "session.end",
      "api.request",
      "api.response",
      "api.error",
    ]) {
      expect(classifyEvent(kind)).toBe("durable-audit");
    }
  });

  it("classifies live-only events as live", () => {
    for (const kind of LIVE_ONLY_EVENTS) {
      expect(classifyEvent(kind)).toBe("live");
    }
  });

  it("defaults unknown event kinds to live (safe fallback)", () => {
    expect(classifyEvent("never.heard.of.you")).toBe("live");
  });
});

describe("shouldPersist", () => {
  it("returns true for durable-transcript events", () => {
    for (const kind of DURABLE_TRANSCRIPT_EVENTS) {
      expect(shouldPersist(kind)).toBe(true);
    }
  });

  it("returns true for durable-audit events", () => {
    for (const kind of DURABLE_AUDIT_EVENTS) {
      expect(shouldPersist(kind)).toBe(true);
    }
  });

  it("returns false for live-only events", () => {
    for (const kind of LIVE_ONLY_EVENTS) {
      expect(shouldPersist(kind)).toBe(false);
    }
  });

  it("returns false for unknown event kinds", () => {
    expect(shouldPersist("foo.bar")).toBe(false);
  });
});

describe("classification sets discipline", () => {
  it("DURABLE_AUDIT_EVENTS and DURABLE_TRANSCRIPT_EVENTS do not overlap", () => {
    for (const kind of DURABLE_AUDIT_EVENTS) {
      expect(DURABLE_TRANSCRIPT_EVENTS.has(kind)).toBe(false);
    }
  });

  it("LIVE_ONLY_EVENTS and DURABLE_*_EVENTS do not overlap", () => {
    const durable = new Set<string>([...DURABLE_AUDIT_EVENTS, ...DURABLE_TRANSCRIPT_EVENTS]);
    for (const kind of LIVE_ONLY_EVENTS) {
      expect(durable.has(kind)).toBe(false);
    }
  });

  it("prevents high-frequency ephemeral kinds from leaking into durable", () => {
    // Sanity check — these MUST remain live-only or the sink will explode.
    expect(LIVE_ONLY_EVENTS.has("llm.delta")).toBe(true);
    expect(LIVE_ONLY_EVENTS.has("tool.call.progress")).toBe(true);
    expect(shouldPersist("llm.delta")).toBe(false);
    expect(shouldPersist("tool.call.progress")).toBe(false);
  });
});
