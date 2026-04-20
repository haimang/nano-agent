/**
 * B4 P5 — kernel CompactDelegate adapter integration test.
 *
 * Drives the full B4 ↔ kernel seam: build an `AsyncCompactOrchestrator`,
 * wrap it as a `CompactDelegate`-shape, invoke `requestCompact` the way
 * the kernel scheduler would, and verify the persisted DO state and
 * delegate response.
 *
 * Does NOT spin up the real kernel — the test uses the structural
 * `KernelCompactDelegate` shape exposed by `createKernelCompactDelegate`,
 * which matches the kernel's `CompactDelegate` interface
 * (`{ requestCompact(budget: unknown): Promise<unknown> }`).
 */

import { describe, it, expect } from "vitest";
import {
  AsyncCompactOrchestrator,
  createKernelCompactDelegate,
} from "../../src/async-compact/index.js";
import type { ContextLayer } from "@nano-agent/workspace-context-artifacts";
import { fakeDoStorage, fakeProvider } from "../_fixtures.js";

const layers: ContextLayer[] = [
  {
    kind: "system",
    priority: 0,
    content: "you are nano-agent",
    tokenEstimate: 50,
    required: true,
  },
  {
    kind: "recent_transcript",
    priority: 1,
    content: "u: long convo here\na: I see.",
    tokenEstimate: 8_000,
    required: false,
  },
];

describe("integration — kernel ↔ AsyncCompactOrchestrator", () => {
  it("kernel-style requestCompact() drives forceSyncCompact end-to-end", async () => {
    const { adapter } = fakeDoStorage();
    const orchestrator = new AsyncCompactOrchestrator({
      sessionUuid: "sess-1",
      doStorage: adapter,
      llmProvider: fakeProvider("compact summary text"),
    });

    const delegate = createKernelCompactDelegate({
      orchestrator,
      readContext: async () => ({ layers, contextVersion: 0 }),
      reason: "kernel-requested",
    });

    const result = await delegate.requestCompact({ totalTokens: 8_050 });
    expect(result.tokensFreed).toBeGreaterThan(0);
    // After commit, the orchestrator returns to idle
    expect(orchestrator.getCurrentState().state.kind).toBe("idle");
    // DO storage holds version 1 of the compacted context
    const persisted = await adapter.get<{ version: number }>("context:sess-1");
    expect(persisted?.version).toBe(1);
  });

  it("returns tokensFreed: 0 honestly when commit fails", async () => {
    const { adapter } = fakeDoStorage({ failTransaction: true });
    const orchestrator = new AsyncCompactOrchestrator({
      sessionUuid: "sess-1",
      doStorage: adapter,
      llmProvider: fakeProvider("summary"),
    });
    const delegate = createKernelCompactDelegate({
      orchestrator,
      readContext: async () => ({ layers, contextVersion: 0 }),
    });
    const result = await delegate.requestCompact({ totalTokens: 8_050 });
    expect(result.tokensFreed).toBe(0);
    expect(orchestrator.getCurrentState().state.kind).toBe("failed");
  });
});
