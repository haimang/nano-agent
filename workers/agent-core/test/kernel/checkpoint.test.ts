import { describe, it, expect } from "vitest";
import {
  buildCheckpointFragment,
  restoreFromFragment,
  validateFragment,
} from "../../src/kernel/checkpoint.js";
import type { KernelCheckpointFragment } from "../../src/kernel/checkpoint.js";
import {
  createInitialSessionState,
  createKernelSnapshot,
} from "../../src/kernel/state.js";
import type { KernelSnapshot } from "../../src/kernel/state.js";
import { applyAction } from "../../src/kernel/reducer.js";
import { KERNEL_VERSION } from "../../src/kernel/version.js";
import { KernelError, KERNEL_ERROR_CODES } from "../../src/kernel/errors.js";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function idleSnapshot(): KernelSnapshot {
  return createKernelSnapshot(createInitialSessionState());
}

function runningSnapshot(turnId = "t-1"): KernelSnapshot {
  return applyAction(idleSnapshot(), { type: "start_turn", turnId });
}

// ═══════════════════════════════════════════════════════════════════
// buildCheckpointFragment
// ═══════════════════════════════════════════════════════════════════

describe("buildCheckpointFragment", () => {
  it("creates fragment from idle snapshot", () => {
    const snap = idleSnapshot();
    const fragment = buildCheckpointFragment(snap);

    expect(fragment.version).toBe(KERNEL_VERSION);
    expect(fragment.session.phase).toBe("idle");
    expect(fragment.activeTurn).toBeNull();
    expect(fragment.lastAction).toBeNull();
    expect(fragment.checkpointedAt).toBeTruthy();
  });

  it("creates fragment from running snapshot with active turn", () => {
    const snap = runningSnapshot("t-42");
    const fragment = buildCheckpointFragment(snap);

    expect(fragment.version).toBe(KERNEL_VERSION);
    expect(fragment.session.phase).toBe("turn_running");
    expect(fragment.activeTurn).not.toBeNull();
    expect(fragment.activeTurn!.turnId).toBe("t-42");
    expect(fragment.lastAction).toBe("step:0");
  });

  it("records step index in lastAction", () => {
    let snap = runningSnapshot();
    snap = applyAction(snap, {
      type: "complete_step",
      stepIndex: 0,
      result: "r0",
    });
    snap = applyAction(snap, {
      type: "complete_step",
      stepIndex: 1,
      result: "r1",
    });
    const fragment = buildCheckpointFragment(snap);
    expect(fragment.lastAction).toBe("step:2");
  });

  it("includes checkpointedAt as ISO string", () => {
    const before = new Date().toISOString();
    const fragment = buildCheckpointFragment(idleSnapshot());
    const after = new Date().toISOString();

    expect(fragment.checkpointedAt >= before).toBe(true);
    expect(fragment.checkpointedAt <= after).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// restoreFromFragment
// ═══════════════════════════════════════════════════════════════════

describe("restoreFromFragment", () => {
  it("restores idle snapshot from fragment", () => {
    const original = idleSnapshot();
    const fragment = buildCheckpointFragment(original);
    const restored = restoreFromFragment(fragment);

    expect(restored.session.phase).toBe("idle");
    expect(restored.session.turnCount).toBe(0);
    expect(restored.activeTurn).toBeNull();
    expect(restored.version).toBe(KERNEL_VERSION);
  });

  it("restores running snapshot with active turn", () => {
    const original = runningSnapshot("t-99");
    const fragment = buildCheckpointFragment(original);
    const restored = restoreFromFragment(fragment);

    expect(restored.session.phase).toBe("turn_running");
    expect(restored.activeTurn).not.toBeNull();
    expect(restored.activeTurn!.turnId).toBe("t-99");
    expect(restored.activeTurn!.phase).toBe("running");
  });

  it("round-trips state through checkpoint and restore", () => {
    let snap = runningSnapshot("t-rt");
    snap = applyAction(snap, {
      type: "llm_response",
      content: "hello",
      usage: { inputTokens: 50, outputTokens: 25 },
    });
    snap = applyAction(snap, {
      type: "complete_step",
      stepIndex: 0,
      result: "hello",
    });

    const fragment = buildCheckpointFragment(snap);
    const restored = restoreFromFragment(fragment);

    expect(restored.session.totalTokens).toBe(75);
    expect(restored.activeTurn!.stepIndex).toBe(1);
    // complete_step no longer duplicates into messages — the message
    // log contains exactly one entry from llm_response.
    expect(restored.activeTurn!.messages).toEqual(["hello"]);
  });

  it("produces an independent snapshot (no shared references)", () => {
    const snap = runningSnapshot();
    const fragment = buildCheckpointFragment(snap);
    const restored = restoreFromFragment(fragment);

    // Mutating the restored snapshot should not affect the fragment
    restored.session.turnCount = 999;
    expect(fragment.session.turnCount).toBe(0);
  });

  it("throws CHECKPOINT_VERSION_MISMATCH when fragment.version differs", () => {
    const fragment = buildCheckpointFragment(idleSnapshot());
    const bumped: KernelCheckpointFragment = {
      ...fragment,
      version: "9.9.9-test",
    };
    try {
      restoreFromFragment(bumped);
      throw new Error("expected restoreFromFragment to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(KernelError);
      expect((err as KernelError).code).toBe(
        KERNEL_ERROR_CODES.CHECKPOINT_VERSION_MISMATCH,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// validateFragment
// ═══════════════════════════════════════════════════════════════════

describe("validateFragment", () => {
  it("returns true for a valid fragment", () => {
    const fragment = buildCheckpointFragment(idleSnapshot());
    expect(validateFragment(fragment)).toBe(true);
  });

  it("returns true for a fragment with active turn", () => {
    const fragment = buildCheckpointFragment(runningSnapshot());
    expect(validateFragment(fragment)).toBe(true);
  });

  it("returns false for null", () => {
    expect(validateFragment(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(validateFragment(undefined)).toBe(false);
  });

  it("returns false for a string", () => {
    expect(validateFragment("not a fragment")).toBe(false);
  });

  it("returns false for empty object", () => {
    expect(validateFragment({})).toBe(false);
  });

  it("returns false for missing version", () => {
    const fragment = buildCheckpointFragment(idleSnapshot());
    const { version: _, ...partial } = fragment;
    expect(validateFragment(partial)).toBe(false);
  });

  it("returns false for invalid session phase", () => {
    const bad = {
      version: KERNEL_VERSION,
      session: {
        phase: "bogus",
        turnCount: 0,
        totalTokens: 0,
        compactCount: 0,
        lastCheckpointAt: null,
        createdAt: new Date().toISOString(),
      },
      activeTurn: null,
      lastAction: null,
      checkpointedAt: new Date().toISOString(),
    };
    expect(validateFragment(bad)).toBe(false);
  });

  it("returns false for missing checkpointedAt", () => {
    const fragment: Record<string, unknown> = {
      ...buildCheckpointFragment(idleSnapshot()),
    };
    delete fragment.checkpointedAt;
    expect(validateFragment(fragment)).toBe(false);
  });
});
