/**
 * Tests for session-level checkpoint: build and validate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildSessionCheckpoint,
  validateSessionCheckpoint,
} from "../src/checkpoint.js";
import type { UsageSnapshot, CheckpointDeps } from "../src/checkpoint.js";
import { SESSION_DO_VERSION } from "../src/version.js";

// ── Helpers ──

function makeUsage(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    totalTokens: 1000,
    totalTurns: 3,
    totalDurationMs: 5000,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<CheckpointDeps> = {}): CheckpointDeps {
  return {
    getKernelFragment: () => ({ kernel: "fragment" }),
    getReplayFragment: async () => ({ replay: "fragment" }),
    getStreamSeqs: () => ({ main: 42, tool: 7 }),
    getWorkspaceFragment: async () => ({ workspace: "fragment" }),
    getHooksFragment: () => ({ hooks: "fragment" }),
    ...overrides,
  };
}

// ── Tests ──

describe("buildSessionCheckpoint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces a valid SessionCheckpoint with all fields", async () => {
    const checkpoint = await buildSessionCheckpoint(
      "sess-001",
      "team-abc",
      "attached",
      3,
      makeUsage(),
      makeDeps(),
    );

    expect(checkpoint.version).toBe(SESSION_DO_VERSION);
    expect(checkpoint.sessionUuid).toBe("sess-001");
    expect(checkpoint.teamUuid).toBe("team-abc");
    expect(checkpoint.actorPhase).toBe("attached");
    expect(checkpoint.turnCount).toBe(3);
    expect(checkpoint.kernelFragment).toEqual({ kernel: "fragment" });
    expect(checkpoint.replayFragment).toEqual({ replay: "fragment" });
    expect(checkpoint.streamSeqs).toEqual({ main: 42, tool: 7 });
    expect(checkpoint.workspaceFragment).toEqual({ workspace: "fragment" });
    expect(checkpoint.hooksFragment).toEqual({ hooks: "fragment" });
    expect(checkpoint.usageSnapshot).toEqual(makeUsage());
    expect(checkpoint.checkpointedAt).toBe("2026-04-16T12:00:00.000Z");
  });

  it("fetches replay and workspace fragments in parallel", async () => {
    const order: string[] = [];

    const deps = makeDeps({
      getReplayFragment: async () => {
        order.push("replay");
        return { replay: true };
      },
      getWorkspaceFragment: async () => {
        order.push("workspace");
        return { workspace: true };
      },
    });

    await buildSessionCheckpoint("s", "t", "attached", 0, makeUsage(), deps);

    // Both should have been called (order may vary due to parallelism)
    expect(order).toContain("replay");
    expect(order).toContain("workspace");
  });

  it("passes through the version from SESSION_DO_VERSION", async () => {
    const checkpoint = await buildSessionCheckpoint(
      "s",
      "t",
      "unattached",
      0,
      makeUsage(),
      makeDeps(),
    );

    expect(checkpoint.version).toBe(SESSION_DO_VERSION);
  });

  it("uses current time for checkpointedAt", async () => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));

    const checkpoint = await buildSessionCheckpoint(
      "s",
      "t",
      "attached",
      1,
      makeUsage(),
      makeDeps(),
    );

    expect(checkpoint.checkpointedAt).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("validateSessionCheckpoint", () => {
  function makeValid(): Record<string, unknown> {
    return {
      version: "0.1.0",
      sessionUuid: "11111111-1111-4111-8111-111111111111",
      teamUuid: "team-abc",
      actorPhase: "attached",
      turnCount: 3,
      kernelFragment: { kernel: "fragment" },
      replayFragment: { replay: "fragment" },
      streamSeqs: { main: 42 },
      workspaceFragment: { workspace: "fragment" },
      hooksFragment: { hooks: "fragment" },
      usageSnapshot: { totalTokens: 100, totalTurns: 2, totalDurationMs: 500 },
      checkpointedAt: "2026-04-16T12:00:00.000Z",
    };
  }

  it("accepts a valid checkpoint", () => {
    expect(validateSessionCheckpoint(makeValid())).toBe(true);
  });

  it("accepts checkpoint with null fragments", () => {
    const cp = makeValid();
    cp.kernelFragment = null;
    cp.replayFragment = null;
    cp.workspaceFragment = null;
    cp.hooksFragment = null;

    expect(validateSessionCheckpoint(cp)).toBe(true);
  });

  it("accepts checkpoint with empty streamSeqs", () => {
    const cp = makeValid();
    cp.streamSeqs = {};

    expect(validateSessionCheckpoint(cp)).toBe(true);
  });

  it("rejects null", () => {
    expect(validateSessionCheckpoint(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(validateSessionCheckpoint(undefined)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(validateSessionCheckpoint("string")).toBe(false);
    expect(validateSessionCheckpoint(42)).toBe(false);
  });

  it("rejects when version is missing", () => {
    const cp = makeValid();
    delete cp.version;
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when sessionUuid is not a string", () => {
    const cp = makeValid();
    cp.sessionUuid = 123;
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when turnCount is not a number", () => {
    const cp = makeValid();
    cp.turnCount = "three";
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when streamSeqs contains non-number values", () => {
    const cp = makeValid();
    cp.streamSeqs = { main: "not-a-number" };
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when streamSeqs is null", () => {
    const cp = makeValid();
    cp.streamSeqs = null;
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when usageSnapshot is missing totalTokens", () => {
    const cp = makeValid();
    cp.usageSnapshot = { totalTurns: 2, totalDurationMs: 500 };
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when usageSnapshot is null", () => {
    const cp = makeValid();
    cp.usageSnapshot = null;
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when kernelFragment key is absent", () => {
    const cp = makeValid();
    delete cp.kernelFragment;
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when replayFragment key is absent", () => {
    const cp = makeValid();
    delete cp.replayFragment;
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when workspaceFragment key is absent", () => {
    const cp = makeValid();
    delete cp.workspaceFragment;
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when hooksFragment key is absent", () => {
    const cp = makeValid();
    delete cp.hooksFragment;
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when actorPhase is not a string", () => {
    const cp = makeValid();
    cp.actorPhase = 42;
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when checkpointedAt is not a string", () => {
    const cp = makeValid();
    cp.checkpointedAt = 12345;
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when sessionUuid is not a UUID", () => {
    const cp = makeValid();
    cp.sessionUuid = "not-a-uuid";
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when actorPhase is not in the canonical enum", () => {
    const cp = makeValid();
    cp.actorPhase = "weird_phase";
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when turnCount is negative", () => {
    const cp = makeValid();
    cp.turnCount = -1;
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when turnCount is not an integer", () => {
    const cp = makeValid();
    cp.turnCount = 1.5;
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when streamSeqs contains a negative value", () => {
    const cp = makeValid();
    cp.streamSeqs = { main: -3 };
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when streamSeqs contains a non-integer value", () => {
    const cp = makeValid();
    cp.streamSeqs = { main: 1.5 };
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when usageSnapshot contains a negative total", () => {
    const cp = makeValid();
    cp.usageSnapshot = { totalTokens: -1, totalTurns: 0, totalDurationMs: 0 };
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when checkpointedAt is not a valid ISO timestamp", () => {
    const cp = makeValid();
    cp.checkpointedAt = "not-a-date";
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });

  it("rejects when teamUuid is empty", () => {
    const cp = makeValid();
    cp.teamUuid = "";
    expect(validateSessionCheckpoint(cp)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// restoreSessionCheckpoint
// ═══════════════════════════════════════════════════════════════════

import { restoreSessionCheckpoint } from "../src/checkpoint.js";

describe("restoreSessionCheckpoint", () => {
  function validCheckpoint(): Record<string, unknown> {
    return {
      version: "0.1.0",
      sessionUuid: "11111111-1111-4111-8111-111111111111",
      teamUuid: "team-a",
      actorPhase: "attached",
      turnCount: 5,
      kernelFragment: { k: "fragment" },
      replayFragment: { r: "fragment" },
      streamSeqs: { main: 7 },
      workspaceFragment: { w: "fragment" },
      hooksFragment: { h: "fragment" },
      usageSnapshot: { totalTokens: 10, totalTurns: 5, totalDurationMs: 500 },
      checkpointedAt: "2026-04-17T00:00:00.000Z",
    };
  }

  it("dispatches each fragment to its owning subsystem and returns the composed restore result", async () => {
    const calls: string[] = [];
    const result = await restoreSessionCheckpoint(validCheckpoint(), {
      restoreKernel: (f) => {
        calls.push("kernel");
        return { restored: "kernel", from: f };
      },
      restoreReplay: (f) => {
        calls.push("replay");
        return void f;
      },
      restoreWorkspace: (f) => {
        calls.push("workspace");
        return { restored: "workspace", from: f };
      },
      restoreHooks: (f) => {
        calls.push("hooks");
        return { restored: "hooks", from: f };
      },
    });

    expect(calls).toEqual(["kernel", "replay", "workspace", "hooks"]);
    expect(result.turnCount).toBe(5);
    expect(result.streamSeqs).toEqual({ main: 7 });
    expect(result.actorPhase).toBe("attached");
    expect(result.usage.totalTokens).toBe(10);
  });

  it("throws on an invalid checkpoint (short-circuits the restore path)", async () => {
    const invalid = { bogus: true };
    await expect(
      restoreSessionCheckpoint(invalid, {
        restoreKernel: () => ({}),
        restoreReplay: () => undefined,
        restoreWorkspace: () => ({}),
        restoreHooks: () => ({}),
      }),
    ).rejects.toThrow(/invalid checkpoint/);
  });
});
