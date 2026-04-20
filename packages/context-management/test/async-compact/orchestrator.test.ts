/**
 * B4 — AsyncCompactOrchestrator integration tests.
 *
 * Drives the full ARMED → PREPARING → COMMITTING → COMMITTED → IDLE
 * lifecycle with a fake LLM provider and a fake DO storage adapter.
 */

import { describe, it, expect } from "vitest";
import { AsyncCompactOrchestrator } from "../../src/async-compact/index.js";
import { mergeCompactPolicy } from "../../src/budget/index.js";
import { createCollectingEmitter } from "../../src/async-compact/events.js";
import type { ContextLayer } from "@nano-agent/workspace-context-artifacts";
import { fakeDoStorage, fakeProvider } from "../_fixtures.js";

const baseLayers: ContextLayer[] = [
  {
    kind: "system",
    priority: 0,
    content: "system instructions",
    tokenEstimate: 50,
    required: true,
  },
  {
    kind: "recent_transcript",
    priority: 1,
    content: "u: hi\na: hello",
    tokenEstimate: 30,
    required: false,
  },
];

const usage = (totalTokens: number) => ({
  totalTokens,
  maxTokens: 100_000,
  responseReserveTokens: 4_000,
  categories: [],
});

describe("AsyncCompactOrchestrator — happy lifecycle", () => {
  it("ARMED → PREPARING → COMMITTING → COMMITTED → idle", async () => {
    const emitter = createCollectingEmitter();
    const { adapter } = fakeDoStorage();
    const orchestrator = new AsyncCompactOrchestrator({
      sessionUuid: "sess-1",
      doStorage: adapter,
      llmProvider: fakeProvider("compact summary"),
      emitter,
    });

    // Step 1 — usage crosses soft threshold
    const high = usage(80_000);
    expect(orchestrator.shouldArm(high)).toBe(true);
    await orchestrator.tryArm(high);
    expect(orchestrator.getCurrentState().state.kind).toBe("armed");

    // Step 2 — kernel signals turn boundary; orchestrator prepares
    orchestrator.tryPrepare({ layers: baseLayers, contextVersion: 0 });
    expect(orchestrator.getCurrentState().state.kind).toBe("preparing");

    // Wait for the in-flight prepare to settle
    await new Promise((r) => setTimeout(r, 5));

    // Step 3 — commit at next turn boundary
    const outcome = await orchestrator.tryCommit({
      contextVersion: 0,
      atTurnBoundary: true,
      usage: high,
    });
    expect(outcome.kind).toBe("committed");
    if (outcome.kind === "committed") {
      expect(outcome.newVersion).toBe(1);
    }
    expect(orchestrator.getCurrentState().state.kind).toBe("idle");

    // Lifecycle events emitted in canonical order
    const eventNames = emitter.events.map((e) => e.name);
    expect(eventNames).toEqual([
      "ContextCompactArmed",
      "ContextCompactPrepareStarted",
      "ContextCompactCommitted",
    ]);
  });

  it("noop when usage is below soft threshold", async () => {
    const { adapter } = fakeDoStorage();
    const orchestrator = new AsyncCompactOrchestrator({
      sessionUuid: "sess-1",
      doStorage: adapter,
      llmProvider: fakeProvider(),
    });
    const low = usage(10_000);
    expect(orchestrator.shouldArm(low)).toBe(false);
    await orchestrator.tryArm(low);
    expect(orchestrator.getCurrentState().state.kind).toBe("idle");
  });

  it("tryCommit returns no-compact-pending when no prepared summary", async () => {
    const { adapter } = fakeDoStorage();
    const orchestrator = new AsyncCompactOrchestrator({
      sessionUuid: "sess-1",
      doStorage: adapter,
      llmProvider: fakeProvider(),
    });
    const outcome = await orchestrator.tryCommit({
      contextVersion: 0,
      atTurnBoundary: true,
      usage: usage(10_000),
    });
    expect(outcome).toEqual({ kind: "no-compact-pending" });
  });
});

describe("AsyncCompactOrchestrator — hard fallback", () => {
  it("forceSyncCompact runs end-to-end and returns committed", async () => {
    const { adapter } = fakeDoStorage();
    const orchestrator = new AsyncCompactOrchestrator({
      sessionUuid: "sess-1",
      doStorage: adapter,
      llmProvider: fakeProvider("sync-fallback summary"),
      compactPolicy: mergeCompactPolicy({ backgroundTimeoutMs: 1_000 }),
    });
    const outcome = await orchestrator.forceSyncCompact({
      layers: baseLayers,
      contextVersion: 0,
      reason: "hard-threshold-no-prepared-summary",
    });
    expect(outcome.kind).toBe("committed");
    expect(orchestrator.getCurrentState().state.kind).toBe("idle");
  });

  it("tryCommit returns 'fallback-sync' when usage hits hard threshold without prepared summary", async () => {
    const { adapter } = fakeDoStorage();
    const orchestrator = new AsyncCompactOrchestrator({
      sessionUuid: "sess-1",
      doStorage: adapter,
      llmProvider: fakeProvider(),
    });
    const high = usage(95_000);
    const outcome = await orchestrator.tryCommit({
      contextVersion: 0,
      atTurnBoundary: true,
      usage: high,
    });
    expect(outcome.kind).toBe("fallback-sync");
  });
});

describe("AsyncCompactOrchestrator — failed lifecycle", () => {
  it("transitions to failed when prepare-job throws", async () => {
    const emitter = createCollectingEmitter();
    const { adapter } = fakeDoStorage();
    const orchestrator = new AsyncCompactOrchestrator({
      sessionUuid: "sess-1",
      doStorage: adapter,
      llmProvider: {
        async summarize() {
          throw new Error("provider down");
        },
      },
      emitter,
    });
    await orchestrator.tryArm(usage(80_000));
    orchestrator.tryPrepare({ layers: baseLayers, contextVersion: 0 });
    await new Promise((r) => setTimeout(r, 5));
    expect(orchestrator.getCurrentState().state.kind).toBe("failed");
    expect(emitter.events.some((e) => e.name === "ContextCompactFailed")).toBe(true);
  });
});

describe("AsyncCompactOrchestrator — restoreVersion stub honesty", () => {
  it("throws not-implemented (B4 ships seam, B7+ ships restore primitive)", async () => {
    const { adapter } = fakeDoStorage();
    const orchestrator = new AsyncCompactOrchestrator({
      sessionUuid: "sess-1",
      doStorage: adapter,
      llmProvider: fakeProvider(),
    });
    await expect(orchestrator.restoreVersion("snap-1")).rejects.toThrow(
      /not implemented/,
    );
  });
});
