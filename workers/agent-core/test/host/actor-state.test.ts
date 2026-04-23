/**
 * Tests for session actor state machine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createInitialActorState,
  transitionPhase,
} from "../../src/host/actor-state.js";

describe("createInitialActorState", () => {
  it("starts in unattached phase", () => {
    const state = createInitialActorState();
    expect(state.phase).toBe("unattached");
  });

  it("has no active turn", () => {
    const state = createInitialActorState();
    expect(state.activeTurnId).toBeNull();
  });

  it("has no pending inputs", () => {
    const state = createInitialActorState();
    expect(state.pendingInputs).toEqual([]);
  });

  it("has no attachedAt or lastCheckpointAt", () => {
    const state = createInitialActorState();
    expect(state.attachedAt).toBeNull();
    expect(state.lastCheckpointAt).toBeNull();
  });
});

describe("transitionPhase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("valid transitions", () => {
    it("transitions from unattached to attached", () => {
      const state = createInitialActorState();
      const next = transitionPhase(state, "attached");

      expect(next.phase).toBe("attached");
      expect(next.attachedAt).toBe("2026-04-16T12:00:00.000Z");
      expect(next.activeTurnId).toBeNull();
    });

    it("transitions from attached to turn_running", () => {
      const state = transitionPhase(createInitialActorState(), "attached");
      const next = transitionPhase(state, "turn_running");

      expect(next.phase).toBe("turn_running");
      // attachedAt should be preserved
      expect(next.attachedAt).toBe("2026-04-16T12:00:00.000Z");
    });

    it("transitions from turn_running to attached", () => {
      let state = transitionPhase(createInitialActorState(), "attached");
      state = transitionPhase(state, "turn_running");
      const next = transitionPhase(state, "attached");

      expect(next.phase).toBe("attached");
      expect(next.activeTurnId).toBeNull();
    });

    it("transitions from attached to ended", () => {
      const state = transitionPhase(createInitialActorState(), "attached");
      const next = transitionPhase(state, "ended");

      expect(next.phase).toBe("ended");
      expect(next.activeTurnId).toBeNull();
    });

    it("transitions from turn_running to ended", () => {
      let state = transitionPhase(createInitialActorState(), "attached");
      state = transitionPhase(state, "turn_running");
      const next = transitionPhase(state, "ended");

      expect(next.phase).toBe("ended");
    });

    it("transitions from unattached to ended", () => {
      const state = createInitialActorState();
      const next = transitionPhase(state, "ended");

      expect(next.phase).toBe("ended");
    });

    it("transitions from attached to unattached", () => {
      const state = transitionPhase(createInitialActorState(), "attached");
      const next = transitionPhase(state, "unattached");

      expect(next.phase).toBe("unattached");
      expect(next.attachedAt).toBeNull();
    });
  });

  describe("invalid transitions", () => {
    it("throws on ended -> attached", () => {
      const state = transitionPhase(createInitialActorState(), "ended");

      expect(() => transitionPhase(state, "attached")).toThrow(
        "Invalid phase transition: ended -> attached",
      );
    });

    it("throws on ended -> turn_running", () => {
      const state = transitionPhase(createInitialActorState(), "ended");

      expect(() => transitionPhase(state, "turn_running")).toThrow();
    });

    it("throws on unattached -> turn_running", () => {
      const state = createInitialActorState();

      expect(() => transitionPhase(state, "turn_running")).toThrow(
        "Invalid phase transition: unattached -> turn_running",
      );
    });

    it("throws on turn_running -> unattached", () => {
      let state = transitionPhase(createInitialActorState(), "attached");
      state = transitionPhase(state, "turn_running");

      expect(() => transitionPhase(state, "unattached")).toThrow();
    });
  });

  describe("immutability", () => {
    it("does not mutate the input state", () => {
      const state = createInitialActorState();
      const next = transitionPhase(state, "attached");

      expect(state.phase).toBe("unattached");
      expect(state.attachedAt).toBeNull();
      expect(next.phase).toBe("attached");
    });

    it("preserves pendingInputs across transitions", () => {
      const state = createInitialActorState();
      // Since pendingInputs is readonly, we verify it carries through
      const next = transitionPhase(state, "attached");
      expect(next.pendingInputs).toEqual([]);
    });
  });

  describe("attachedAt behavior", () => {
    it("sets attachedAt on first attach", () => {
      const state = createInitialActorState();
      const attached = transitionPhase(state, "attached");

      expect(attached.attachedAt).toBe("2026-04-16T12:00:00.000Z");
    });

    it("preserves attachedAt on re-attach after turn", () => {
      const state = transitionPhase(createInitialActorState(), "attached");

      vi.setSystemTime(new Date("2026-04-16T12:05:00.000Z"));
      const running = transitionPhase(state, "turn_running");
      const reattached = transitionPhase(running, "attached");

      // Should keep the original attachedAt, not the new time
      expect(reattached.attachedAt).toBe("2026-04-16T12:00:00.000Z");
    });

    it("clears attachedAt on transition to unattached", () => {
      const state = transitionPhase(createInitialActorState(), "attached");
      const unattached = transitionPhase(state, "unattached");

      expect(unattached.attachedAt).toBeNull();
    });
  });
});
