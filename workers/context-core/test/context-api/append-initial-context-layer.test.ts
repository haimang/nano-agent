/**
 * D03 F4 stub unit tests — P2 Phase 1 落点。
 *
 * Covers (per P1-P5 GPT review R1):
 *   - Normal payload produces exactly 1 canonical `session` layer
 *     appended to the per-assembler pending list;
 *   - Missing-field payload (all-optional fields absent) is a no-op;
 *   - Draining empties the pending list and returns the accumulated
 *     layers in insertion order;
 *   - Independent `ContextAssembler` instances do not share pending
 *     state (WeakMap isolation);
 *   - buildInitialContextLayers picks kind `"session"` (never invents
 *     `"initial_context"` kind).
 */

import { describe, expect, it } from "vitest";
import { ContextAssembler } from "../../src/context-assembler.js";
import type { SessionStartInitialContext } from "@haimang/nacp-session";
import {
  appendInitialContextLayer,
  buildInitialContextLayers,
  drainPendingInitialContextLayers,
  peekPendingInitialContextLayers,
} from "../../src/context-api/append-initial-context-layer.js";

function makeAssembler(): ContextAssembler {
  return new ContextAssembler({
    maxTokens: 32_000,
    reserveForResponse: 1024,
    layers: [
      "system",
      "session",
      "workspace_summary",
      "artifact_summary",
      "recent_transcript",
      "injected",
    ],
  });
}

describe("appendInitialContextLayer / R1 canonical-kind mapping", () => {
  it("produces exactly 1 layer with kind=session for a normal payload", () => {
    const payload: SessionStartInitialContext = {
      user_memory: { pinned: "value" },
      intent: { route: "demo", confidence: 0.8 },
    };
    const layers = buildInitialContextLayers(payload);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.kind).toBe("session");
    expect(layers[0]!.required).toBe(false);
    expect(layers[0]!.tokenEstimate).toBeGreaterThan(0);
    expect(layers[0]!.content).toContain("demo");
  });

  it("returns 0 layers for an empty-object payload", () => {
    const layers = buildInitialContextLayers({});
    expect(layers).toEqual([]);
  });

  it("never emits kind='initial_context' (invented kind forbidden)", () => {
    const payload: SessionStartInitialContext = {
      user_memory: { a: 1 },
      intent: { route: "x" },
      warm_slots: [{ key: "k1", value: "v1" }],
      realm_hints: { r: 1 },
    };
    const layers = buildInitialContextLayers(payload);
    for (const l of layers) {
      expect(l.kind).not.toBe("initial_context");
      expect(
        ["system", "session", "workspace_summary", "artifact_summary", "recent_transcript", "injected"].includes(l.kind),
      ).toBe(true);
    }
  });
});

describe("appendInitialContextLayer / pending list semantics", () => {
  it("appends layer to per-assembler pending list without touching the assembler", () => {
    const assembler = makeAssembler();
    const payload: SessionStartInitialContext = {
      intent: { route: "demo" },
    };
    appendInitialContextLayer(assembler, payload);
    const pending = peekPendingInitialContextLayers(assembler);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.kind).toBe("session");
  });

  it("drain returns accumulated layers and clears state", () => {
    const assembler = makeAssembler();
    appendInitialContextLayer(assembler, { intent: { route: "one" } });
    appendInitialContextLayer(assembler, { intent: { route: "two" } });
    const drained = drainPendingInitialContextLayers(assembler);
    expect(drained).toHaveLength(2);
    expect(drained[0]!.content).toContain("one");
    expect(drained[1]!.content).toContain("two");
    // After draining, peek is empty
    expect(peekPendingInitialContextLayers(assembler)).toHaveLength(0);
  });

  it("is a no-op for empty-object payload (does not throw, does not mutate pending)", () => {
    const assembler = makeAssembler();
    expect(() => appendInitialContextLayer(assembler, {})).not.toThrow();
    expect(peekPendingInitialContextLayers(assembler)).toHaveLength(0);
    // Calling with non-empty payload afterwards still works
    appendInitialContextLayer(assembler, { intent: { route: "after" } });
    expect(peekPendingInitialContextLayers(assembler)).toHaveLength(1);
  });

  it("isolates pending state between independent assembler instances", () => {
    const a = makeAssembler();
    const b = makeAssembler();
    appendInitialContextLayer(a, { intent: { route: "for-a" } });
    expect(peekPendingInitialContextLayers(a)).toHaveLength(1);
    expect(peekPendingInitialContextLayers(b)).toHaveLength(0);
  });
});

describe("appendInitialContextLayer / integration with ContextAssembler.assemble()", () => {
  it("pending layers fed into assemble() show up in AssemblyResult.assembled with kind=session", () => {
    const assembler = makeAssembler();
    appendInitialContextLayer(assembler, {
      intent: { route: "live", realm: "staging", confidence: 0.9 },
    });
    const pending = drainPendingInitialContextLayers(assembler);
    const result = assembler.assemble(pending);
    expect(result.assembled.length).toBeGreaterThan(0);
    const kinds = result.assembled.map((l) => l.kind);
    expect(kinds).toContain("session");
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it("negative case: no appendInitialContextLayer → assembled.length = 0 (no session layer)", () => {
    const assembler = makeAssembler();
    const result = assembler.assemble([]);
    expect(result.assembled).toHaveLength(0);
  });
});
