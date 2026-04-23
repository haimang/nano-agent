/**
 * B4 — async-compact scheduler tests.
 *
 * Covers the state-machine transitions in `PX-async-compact-lifecycle-spec.md §2.2`.
 */

import { describe, it, expect } from "vitest";
import { CompactionScheduler } from "../../src/async-compact/scheduler.js";
import { DEFAULT_COMPACT_POLICY, mergeCompactPolicy } from "../../src/budget/index.js";
import type { CompactState } from "../../src/async-compact/types.js";

const baseState = (kind: CompactState["kind"]): CompactState => ({
  kind,
  stateId: `cs-${kind}`,
  enteredAt: "2026-04-20T00:00:00.000Z",
  retriesUsed: 0,
});

const usage = (totalTokens: number) => ({
  totalTokens,
  maxTokens: 100_000,
  responseReserveTokens: 4_000,
  categories: [],
});

describe("scheduler — idle state", () => {
  const scheduler = new CompactionScheduler();

  it("noop when usage is well below soft threshold", () => {
    const decision = scheduler.decide({
      state: baseState("idle"),
      usage: usage(10_000),
      policy: DEFAULT_COMPACT_POLICY,
      atTurnBoundary: true,
      preparedReady: false,
    });
    expect(decision.kind).toBe("noop");
  });

  it("arms when usage crosses soft threshold AND headroom is sufficient", () => {
    const decision = scheduler.decide({
      state: baseState("idle"),
      usage: usage(80_000),
      policy: DEFAULT_COMPACT_POLICY,
      atTurnBoundary: true,
      preparedReady: false,
    });
    expect(decision.kind).toBe("arm");
  });

  it("escalates straight to fallback when usage crosses hard threshold from idle", () => {
    const decision = scheduler.decide({
      state: baseState("idle"),
      usage: usage(95_000),
      policy: DEFAULT_COMPACT_POLICY,
      atTurnBoundary: true,
      preparedReady: false,
    });
    expect(decision.kind).toBe("force-sync-fallback");
  });
});

describe("scheduler — armed state", () => {
  const scheduler = new CompactionScheduler();

  it("prepares at the next turn boundary", () => {
    const decision = scheduler.decide({
      state: baseState("armed"),
      usage: usage(80_000),
      policy: DEFAULT_COMPACT_POLICY,
      atTurnBoundary: true,
      preparedReady: false,
    });
    expect(decision.kind).toBe("prepare");
  });

  it("noop when not at a turn boundary (mid-tool-call)", () => {
    const decision = scheduler.decide({
      state: baseState("armed"),
      usage: usage(80_000),
      policy: DEFAULT_COMPACT_POLICY,
      atTurnBoundary: false,
      preparedReady: false,
    });
    expect(decision.kind).toBe("noop");
  });
});

describe("scheduler — preparing state", () => {
  const scheduler = new CompactionScheduler();

  it("commits when prepared summary ready and at boundary", () => {
    const decision = scheduler.decide({
      state: baseState("preparing"),
      usage: usage(85_000),
      policy: DEFAULT_COMPACT_POLICY,
      atTurnBoundary: true,
      preparedReady: true,
    });
    expect(decision.kind).toBe("commit-prepared");
  });

  it("noop when prepared summary not ready yet", () => {
    const decision = scheduler.decide({
      state: baseState("preparing"),
      usage: usage(85_000),
      policy: DEFAULT_COMPACT_POLICY,
      atTurnBoundary: true,
      preparedReady: false,
    });
    expect(decision.kind).toBe("noop");
  });

  it("commits a ready summary even when usage hits hard threshold", () => {
    const decision = scheduler.decide({
      state: baseState("preparing"),
      usage: usage(99_000),
      policy: DEFAULT_COMPACT_POLICY,
      atTurnBoundary: true,
      preparedReady: true,
    });
    // Prefer the already-paid-for prepared summary over a new sync
    // fallback run (the sync path has its own LLM cost).
    expect(decision.kind).toBe("commit-prepared");
  });
});

describe("scheduler — disabled policy short-circuit", () => {
  const scheduler = new CompactionScheduler();

  it("returns noop regardless of usage", () => {
    const policy = mergeCompactPolicy({ disabled: true });
    expect(
      scheduler.decide({
        state: baseState("idle"),
        usage: usage(99_000),
        policy,
        atTurnBoundary: true,
        preparedReady: false,
      }),
    ).toEqual({ kind: "noop" });
  });
});
