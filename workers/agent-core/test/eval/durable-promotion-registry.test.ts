/**
 * Tests for DurablePromotionRegistry.
 *
 * The registry is the auditable artefact that answers "what do we
 * persist, why, and at what fidelity?". These tests lock the default
 * v1 rule set and the enumeration / lookup contract.
 */

import { describe, it, expect } from "vitest";
import {
  DurablePromotionRegistry,
  createDefaultRegistry,
  type DurablePromotionEntry,
} from "../../src/eval/durable-promotion-registry.js";
import { DURABLE_AUDIT_EVENTS, DURABLE_TRANSCRIPT_EVENTS } from "../../src/eval/classification.js";

function entry(overrides: Partial<DurablePromotionEntry> & { eventKind: string }): DurablePromotionEntry {
  return {
    layer: "durable-audit",
    granularity: "full",
    replayVisible: false,
    revisitCondition: "none",
    description: "test",
    ...overrides,
  };
}

describe("DurablePromotionRegistry basic API", () => {
  it("register + get round-trips the entry", () => {
    const registry = new DurablePromotionRegistry();
    const e = entry({ eventKind: "x.y", granularity: "summary" });
    registry.register(e);
    expect(registry.get("x.y")).toEqual(e);
  });

  it("get returns undefined for unknown event kinds", () => {
    const registry = new DurablePromotionRegistry();
    expect(registry.get("unknown")).toBeUndefined();
  });

  it("register overwrites an existing rule for the same event kind", () => {
    const registry = new DurablePromotionRegistry();
    registry.register(entry({ eventKind: "x.y", granularity: "summary" }));
    registry.register(entry({ eventKind: "x.y", granularity: "full" }));
    expect(registry.get("x.y")?.granularity).toBe("full");
  });

  it("list() returns every registered entry", () => {
    const registry = new DurablePromotionRegistry();
    registry.register(entry({ eventKind: "a" }));
    registry.register(entry({ eventKind: "b" }));
    expect(registry.list()).toHaveLength(2);
  });

  it("listByLayer() filters entries by their target layer", () => {
    const registry = new DurablePromotionRegistry();
    registry.register(entry({ eventKind: "a", layer: "durable-audit" }));
    registry.register(entry({ eventKind: "b", layer: "durable-transcript" }));
    registry.register(entry({ eventKind: "c", layer: "durable-audit" }));
    expect(registry.listByLayer("durable-audit")).toHaveLength(2);
    expect(registry.listByLayer("durable-transcript")).toHaveLength(1);
    expect(registry.listByLayer("live")).toHaveLength(0);
  });
});

describe("createDefaultRegistry()", () => {
  const registry = createDefaultRegistry();

  it("covers every durable-transcript event", () => {
    for (const kind of DURABLE_TRANSCRIPT_EVENTS) {
      expect(registry.get(kind)).toBeDefined();
    }
  });

  it("covers every durable-audit event", () => {
    for (const kind of DURABLE_AUDIT_EVENTS) {
      expect(registry.get(kind)).toBeDefined();
    }
  });

  it("transcript entries for user.message and assistant.message are full + replayVisible", () => {
    for (const kind of ["user.message", "assistant.message"]) {
      const e = registry.get(kind);
      expect(e?.layer).toBe("durable-transcript");
      expect(e?.granularity).toBe("full");
      expect(e?.replayVisible).toBe(true);
    }
  });

  it("tool.call.result is a summary-granularity transcript entry", () => {
    const e = registry.get("tool.call.result");
    expect(e?.layer).toBe("durable-transcript");
    expect(e?.granularity).toBe("summary");
  });

  it("api.error is promoted at full granularity for incident investigation", () => {
    const e = registry.get("api.error");
    expect(e?.layer).toBe("durable-audit");
    expect(e?.granularity).toBe("full");
  });

  it("hook.outcome is promoted but not replay-visible (governance evidence only)", () => {
    const e = registry.get("hook.outcome");
    expect(e?.layer).toBe("durable-audit");
    expect(e?.replayVisible).toBe(false);
  });

  it("hook.broadcast is promoted into durable audit and stays replay-visible", () => {
    const e = registry.get("hook.broadcast");
    expect(e?.layer).toBe("durable-audit");
    expect(e?.granularity).toBe("summary");
    expect(e?.replayVisible).toBe(true);
  });

  it("compact.notify is promoted into durable audit for replay diagnostics", () => {
    const e = registry.get("compact.notify");
    expect(e?.layer).toBe("durable-audit");
    expect(e?.granularity).toBe("summary");
    expect(e?.replayVisible).toBe(true);
  });

  it("live-only events like llm.delta are NOT registered for promotion", () => {
    expect(registry.get("llm.delta")).toBeUndefined();
    expect(registry.get("tool.call.progress")).toBeUndefined();
  });

  it("every default entry carries a revisit condition and description", () => {
    for (const e of registry.list()) {
      expect(e.revisitCondition.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
    }
  });
});
