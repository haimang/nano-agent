import { describe, it, expect } from "vitest";
import { ContextAssembler } from "../src/context-assembler.js";
import type { ContextLayer, ContextAssemblyConfig } from "../src/context-layers.js";

function makeLayer(overrides: Partial<ContextLayer>): ContextLayer {
  return {
    kind: "injected",
    priority: 50,
    content: "test content",
    tokenEstimate: 100,
    required: false,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ContextAssemblyConfig> = {}): ContextAssemblyConfig {
  return {
    maxTokens: 1000,
    layers: ["system", "session", "workspace_summary", "artifact_summary", "recent_transcript", "injected"],
    reserveForResponse: 200,
    ...overrides,
  };
}

describe("ContextAssembler", () => {
  // ── sorting by priority ─────────────────────────────────────────────

  it("sorts layers by priority (lower = higher priority)", () => {
    const assembler = new ContextAssembler(makeConfig());

    const layers = [
      makeLayer({ kind: "injected", priority: 30, content: "third" }),
      makeLayer({ kind: "system", priority: 10, content: "first" }),
      makeLayer({ kind: "session", priority: 20, content: "second" }),
    ];

    const result = assembler.assemble(layers);
    expect(result.assembled.map((l) => l.content)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  // ── required layers always included ─────────────────────────────────

  it("always includes required layers even when over budget", () => {
    const assembler = new ContextAssembler(
      makeConfig({ maxTokens: 100, reserveForResponse: 0 }),
    );

    const layers = [
      makeLayer({ priority: 1, tokenEstimate: 80, required: true, content: "required" }),
      makeLayer({ priority: 2, tokenEstimate: 80, required: true, content: "also-required" }),
    ];

    const result = assembler.assemble(layers);
    // Both required layers included even though total exceeds budget
    expect(result.assembled).toHaveLength(2);
    expect(result.totalTokens).toBe(160);
    expect(result.truncated).toBe(true);
  });

  // ── budget enforcement ──────────────────────────────────────────────

  it("excludes optional layers that exceed budget", () => {
    const assembler = new ContextAssembler(
      makeConfig({ maxTokens: 500, reserveForResponse: 100 }),
    );
    // Budget = 500 - 100 = 400 tokens

    const layers = [
      makeLayer({ priority: 1, tokenEstimate: 200, required: false, content: "fits" }),
      makeLayer({ priority: 2, tokenEstimate: 200, required: false, content: "also-fits" }),
      makeLayer({ priority: 3, tokenEstimate: 200, required: false, content: "dropped" }),
    ];

    const result = assembler.assemble(layers);
    expect(result.assembled).toHaveLength(2);
    expect(result.totalTokens).toBe(400);
    expect(result.truncated).toBe(true);
  });

  it("includes all layers when within budget", () => {
    const assembler = new ContextAssembler(
      makeConfig({ maxTokens: 1000, reserveForResponse: 0 }),
    );

    const layers = [
      makeLayer({ priority: 1, tokenEstimate: 100 }),
      makeLayer({ priority: 2, tokenEstimate: 200 }),
      makeLayer({ priority: 3, tokenEstimate: 300 }),
    ];

    const result = assembler.assemble(layers);
    expect(result.assembled).toHaveLength(3);
    expect(result.totalTokens).toBe(600);
    expect(result.truncated).toBe(false);
  });

  // ── reserveForResponse ──────────────────────────────────────────────

  it("reserves tokens for response", () => {
    const assembler = new ContextAssembler(
      makeConfig({ maxTokens: 500, reserveForResponse: 300 }),
    );
    // Budget = 500 - 300 = 200 tokens

    const layers = [
      makeLayer({ priority: 1, tokenEstimate: 150, content: "fits" }),
      makeLayer({ priority: 2, tokenEstimate: 150, content: "dropped" }),
    ];

    const result = assembler.assemble(layers);
    expect(result.assembled).toHaveLength(1);
    expect(result.assembled[0].content).toBe("fits");
    expect(result.truncated).toBe(true);
  });

  // ── mixed required and optional ─────────────────────────────────────

  it("includes required layers first, then optional within remaining budget", () => {
    const assembler = new ContextAssembler(
      makeConfig({ maxTokens: 500, reserveForResponse: 0 }),
    );

    const layers = [
      makeLayer({ priority: 1, tokenEstimate: 200, required: true, content: "req" }),
      makeLayer({ priority: 2, tokenEstimate: 200, required: false, content: "opt1" }),
      makeLayer({ priority: 3, tokenEstimate: 200, required: false, content: "opt2" }),
    ];

    const result = assembler.assemble(layers);
    // required (200) + opt1 (200) = 400 <= 500, opt2 (200) would be 600 > 500
    expect(result.assembled).toHaveLength(2);
    expect(result.assembled.map((l) => l.content)).toEqual(["req", "opt1"]);
    expect(result.truncated).toBe(true);
  });

  // ── empty input ─────────────────────────────────────────────────────

  it("handles empty layer list", () => {
    const assembler = new ContextAssembler(makeConfig());
    const result = assembler.assemble([]);

    expect(result.assembled).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
    expect(result.truncated).toBe(false);
  });

  // ── config.layers allowlist (R4 regression guard) ────────────────────

  it("honours config.layers allowlist and drops non-allowlisted kinds", () => {
    const assembler = new ContextAssembler(
      makeConfig({ layers: ["system"], maxTokens: 1000, reserveForResponse: 0 }),
    );

    const layers = [
      makeLayer({ kind: "system", priority: 1, content: "kept" }),
      makeLayer({ kind: "artifact_summary", priority: 2, content: "dropped" }),
      makeLayer({ kind: "recent_transcript", priority: 3, content: "also-dropped" }),
    ];

    const result = assembler.assemble(layers);
    expect(result.assembled.map((l) => l.kind)).toEqual(["system"]);
  });

  it("treats an empty allowlist as accept-all (backwards compat)", () => {
    const assembler = new ContextAssembler(
      makeConfig({ layers: [], maxTokens: 1000, reserveForResponse: 0 }),
    );

    const layers = [
      makeLayer({ kind: "system", priority: 1 }),
      makeLayer({ kind: "artifact_summary", priority: 2 }),
    ];
    const result = assembler.assemble(layers);
    expect(result.assembled).toHaveLength(2);
  });

  it("required layers still get dropped when their kind is not on the allowlist", () => {
    const assembler = new ContextAssembler(
      makeConfig({ layers: ["system"], maxTokens: 1000, reserveForResponse: 0 }),
    );
    const layers = [
      makeLayer({ kind: "system", priority: 1, required: true, content: "sys" }),
      makeLayer({
        kind: "artifact_summary",
        priority: 2,
        required: true,
        content: "art",
      }),
    ];
    const result = assembler.assemble(layers);
    expect(result.assembled.map((l) => l.kind)).toEqual(["system"]);
  });

  // ── fixed canonical order (2nd-round GPT R4 regression guard) ──────

  it("falls back to CANONICAL_LAYER_ORDER when config.layers is empty (fixed-order contract)", () => {
    const assembler = new ContextAssembler(
      makeConfig({ layers: [], maxTokens: 10_000, reserveForResponse: 0 }),
    );
    // Deliberately provide the layers in the WRONG order and with
    // priorities that would not produce the canonical order on their
    // own.
    const layers = [
      makeLayer({ kind: "injected", priority: 0 }),
      makeLayer({ kind: "recent_transcript", priority: 0 }),
      makeLayer({ kind: "artifact_summary", priority: 0 }),
      makeLayer({ kind: "workspace_summary", priority: 0 }),
      makeLayer({ kind: "session", priority: 0 }),
      makeLayer({ kind: "system", priority: 0 }),
    ];
    const result = assembler.assemble(layers);
    expect(result.assembled.map((l) => l.kind)).toEqual([
      "system",
      "session",
      "workspace_summary",
      "artifact_summary",
      "recent_transcript",
      "injected",
    ]);
    expect(result.orderApplied).toEqual([
      "system",
      "session",
      "workspace_summary",
      "artifact_summary",
      "recent_transcript",
      "injected",
    ]);
  });

  it("caller-supplied config.layers is BOTH allowlist AND ordering", () => {
    const assembler = new ContextAssembler(
      makeConfig({
        layers: ["injected", "system"], // deliberately reversed vs canonical
        maxTokens: 10_000,
        reserveForResponse: 0,
      }),
    );
    const layers = [
      makeLayer({ kind: "system", priority: 99, content: "sys" }),
      makeLayer({ kind: "injected", priority: 0, content: "inj" }),
      makeLayer({ kind: "recent_transcript", priority: 0, content: "dropped" }),
    ];
    const result = assembler.assemble(layers);
    expect(result.assembled.map((l) => l.kind)).toEqual(["injected", "system"]);
    expect(result.orderApplied).toEqual(["injected", "system"]);
  });

  it("uses caller priority only as a tiebreaker within the same kind (not across kinds)", () => {
    const assembler = new ContextAssembler(
      makeConfig({ layers: [], maxTokens: 10_000, reserveForResponse: 0 }),
    );
    const layers = [
      // two injected layers with distinct priorities
      makeLayer({ kind: "injected", priority: 20, content: "inj-B" }),
      makeLayer({ kind: "injected", priority: 10, content: "inj-A" }),
      // one system layer with a large priority — should still come first
      makeLayer({ kind: "system", priority: 999, content: "sys" }),
    ];
    const result = assembler.assemble(layers);
    expect(result.assembled.map((l) => l.content)).toEqual(["sys", "inj-A", "inj-B"]);
  });

  it("reports orderApplied for every call", () => {
    const assembler = new ContextAssembler(makeConfig({ layers: ["system"] }));
    const result = assembler.assemble([makeLayer({ kind: "system", priority: 0 })]);
    expect(result.orderApplied).toEqual(["system"]);
  });
});
