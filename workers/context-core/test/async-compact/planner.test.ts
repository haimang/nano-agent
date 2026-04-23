/**
 * B4 — async-compact planner tests.
 *
 * Verifies the CoW fork contract from `PX-async-compact-lifecycle-spec.md §4`:
 *   - The candidate is a NEW array, but element references are shared.
 *   - tokenEstimate is the sum of layer estimates.
 *   - freshContextAdvanced detects mid-prepare drift.
 */

import { describe, it, expect } from "vitest";
import { CompactionPlanner, freshContextAdvanced } from "../../src/async-compact/planner.js";
import type { ContextLayer } from "@nano-agent/workspace-context-artifacts";

function layer(kind: ContextLayer["kind"], content: string, tokens = 100): ContextLayer {
  return {
    kind,
    priority: 0,
    content,
    tokenEstimate: tokens,
    required: false,
  };
}

describe("planner — CoW fork structural sharing", () => {
  const planner = new CompactionPlanner();

  it("returns a NEW layers array (different reference from input)", () => {
    const input = [layer("system", "sys"), layer("recent_transcript", "hi")];
    const candidate = planner.fork({ layers: input, contextVersion: 1 });
    expect(candidate.layers).not.toBe(input);
  });

  it("preserves element references (no deep copy)", () => {
    const sys = layer("system", "sys");
    const transcript = layer("recent_transcript", "hi");
    const candidate = planner.fork({
      layers: [sys, transcript],
      contextVersion: 1,
    });
    expect(candidate.layers[0]).toBe(sys);
    expect(candidate.layers[1]).toBe(transcript);
  });

  it("tokenEstimate sums layer estimates", () => {
    const candidate = planner.fork({
      layers: [layer("system", "a", 50), layer("recent_transcript", "b", 200)],
      contextVersion: 1,
    });
    expect(candidate.tokenEstimate).toBe(250);
  });

  it("snapshotVersion / takenAt / layers are observable on the candidate", () => {
    const candidate = planner.fork({
      layers: [layer("system", "a")],
      contextVersion: 7,
    });
    expect(candidate.snapshotVersion).toBe(7);
    expect(candidate.layers).toHaveLength(1);
    expect(() => new Date(candidate.takenAt)).not.toThrow();
  });
});

describe("planner — freshContextAdvanced", () => {
  const planner = new CompactionPlanner();

  it("returns false when versions match", () => {
    const candidate = planner.fork({
      layers: [layer("system", "x")],
      contextVersion: 5,
    });
    expect(freshContextAdvanced(candidate, 5)).toBe(false);
  });

  it("returns true when current version > candidate snapshotVersion", () => {
    const candidate = planner.fork({
      layers: [layer("system", "x")],
      contextVersion: 5,
    });
    expect(freshContextAdvanced(candidate, 6)).toBe(true);
  });
});
