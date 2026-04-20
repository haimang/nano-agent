/**
 * B4 — async-compact CompactionCommitter tests.
 *
 * Locks the F04 / F06 / F08 contracts:
 *   - All swaps go through `state.storage.transaction()` (F04 / F06)
 *   - Tx callback never sees `maxValueBytes` validation (B2 caveat) —
 *     so the committer must size-route OUTSIDE the tx (F08)
 *   - Promotion to R2 happens before the tx opens
 *   - Tx failure rolls back DO writes AND triggers best-effort R2 cleanup
 */

import { describe, it, expect } from "vitest";
import { CompactionCommitter } from "../../src/async-compact/committer.js";
import type { ContextCandidate, PreparedSummary } from "../../src/async-compact/types.js";
import { DOStorageAdapter } from "@nano-agent/storage-topology";
import { fakeDoStorage, fakeR2 } from "../_fixtures.js";

const candidate = (snapshotVersion = 3): ContextCandidate => ({
  snapshotVersion,
  takenAt: "2026-04-20T00:00:00.000Z",
  layers: [
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
      content: "u: hi\na: hello",
      tokenEstimate: 30,
      required: false,
    },
  ],
  tokenEstimate: 80,
});

const prepared = (text = "compact summary"): PreparedSummary => ({
  prepareJobId: "prep-fixed",
  snapshotVersion: 3,
  text,
  sizeBytes: new TextEncoder().encode(text).byteLength,
  producedAt: "2026-04-20T00:00:01.000Z",
});

describe("committer — happy path (DO inline)", () => {
  it("commits via state.storage.transaction() (F04 + F06)", async () => {
    const { adapter, store } = fakeDoStorage();
    const committer = new CompactionCommitter({
      sessionUuid: "s-1",
      doStorage: adapter,
      nowIso: () => "2026-04-20T00:00:02.000Z",
    });
    const outcome = await committer.commit({
      candidate: candidate(0),
      prepared: prepared("hello world"),
    });
    expect(outcome.kind).toBe("committed");
    if (outcome.kind === "committed") {
      expect(outcome.oldVersion).toBe(0);
      expect(outcome.newVersion).toBe(1);
      expect(outcome.summary.storage).toBe("do");
    }
    // Persisted context exists
    const persisted = await adapter.get<{ version: number; layers: unknown[] }>(
      "context:s-1",
    );
    expect(persisted?.version).toBe(1);
    // Compact-state record was deleted (singleton invariant reopens)
    expect(store.has("compact-state:s-1")).toBe(false);
  });

  it("snapshots the previous context as version-{N-1}", async () => {
    const { adapter, store } = fakeDoStorage();
    // Pre-seed an existing context so the committer must snapshot it.
    await adapter.put("context:s-1", {
      version: 5,
      committedAt: "2026-04-20T00:00:00.000Z",
      layers: [{ kind: "system", priority: 0, content: "old-sys", tokenEstimate: 10, required: true }],
      summary: { storage: "do", storageKey: "context-snapshot:s-1:v0", sizeBytes: 0 },
    });
    const committer = new CompactionCommitter({
      sessionUuid: "s-1",
      doStorage: adapter,
    });
    const outcome = await committer.commit({
      candidate: candidate(5),
      prepared: prepared("new summary"),
    });
    expect(outcome.kind).toBe("committed");
    if (outcome.kind === "committed") {
      expect(outcome.newVersion).toBe(6);
    }
    // Snapshot of v5 was persisted
    expect(store.has("context-snapshot:s-1:v5")).toBe(true);
  });
});

describe("committer — F08 size-routing OUTSIDE tx", () => {
  it("promotes oversize summaries to R2 BEFORE opening the tx", async () => {
    const { adapter: doAdapter } = withSmallCap();
    const { adapter: r2Adapter, store: r2Store } = fakeR2();
    const committer = new CompactionCommitter({
      sessionUuid: "s-1",
      doStorage: doAdapter,
      r2: r2Adapter,
    });
    const big = "x".repeat(500);
    const outcome = await committer.commit({
      candidate: candidate(0),
      prepared: prepared(big),
    });
    expect(outcome.kind).toBe("committed");
    if (outcome.kind === "committed") {
      expect(outcome.summary.storage).toBe("r2");
    }
    // R2 holds the payload
    const r2Key = (outcome as { summary: { storageKey: string } }).summary.storageKey
      .replace("context-snapshot:s-1:v", "context-snapshot/s-1/v");
    expect(r2Store.size).toBe(1);
    expect([...r2Store.values()][0]).toBe(big);
    // Use r2Key in expectation only to silence lint
    expect(r2Key).toContain("/v");
  });

  it("returns 'failed' when summary > DO cap and no R2 is configured", async () => {
    const { adapter: doAdapter } = withSmallCap();
    const committer = new CompactionCommitter({
      sessionUuid: "s-1",
      doStorage: doAdapter,
    });
    const outcome = await committer.commit({
      candidate: candidate(0),
      prepared: prepared("x".repeat(500)),
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.error).toContain("preflight");
    }
  });
});

describe("committer — tx failure rollback + R2 cleanup", () => {
  it("returns failed and triggers best-effort R2 cleanup on tx throw", async () => {
    const { adapter: doAdapter } = withSmallCap({ failTransaction: true });
    const { adapter: r2Adapter, store: r2Store } = fakeR2();
    const committer = new CompactionCommitter({
      sessionUuid: "s-1",
      doStorage: doAdapter,
      r2: r2Adapter,
    });
    const outcome = await committer.commit({
      candidate: candidate(0),
      prepared: prepared("x".repeat(500)),
    });
    expect(outcome.kind).toBe("failed");
    // R2 blob was promoted out-of-tx, then cleaned up after tx aborted
    expect(r2Store.size).toBe(0);
  });
});

describe("committer — B4-R5 version truth on mid-prepare drift", () => {
  it("CommitOutcome reports the version actually replaced (in-tx truth), not the candidate's pre-tx estimate", async () => {
    const { adapter, store } = fakeDoStorage();
    // Pre-seed a context already at version 7 (drift since the
    // candidate snapshot was taken at version 0).
    await adapter.put("context:s-1", {
      version: 7,
      committedAt: "2026-04-20T00:00:00.000Z",
      layers: [
        { kind: "system", priority: 0, content: "old", tokenEstimate: 5, required: true },
      ],
      summary: { storage: "do", storageKey: "context-snapshot:s-1:v0", sizeBytes: 0 },
    });
    const committer = new CompactionCommitter({
      sessionUuid: "s-1",
      doStorage: adapter,
    });
    const outcome = await committer.commit({
      candidate: candidate(0), // candidate thinks the world is at v0
      prepared: prepared("summary"),
    });
    expect(outcome.kind).toBe("committed");
    if (outcome.kind === "committed") {
      // B4-R5 — outcome reflects in-tx live version, not the
      // stale candidate.snapshotVersion.
      expect(outcome.oldVersion).toBe(7);
      expect(outcome.newVersion).toBe(8);
    }
    const persisted = store.get("context:s-1") as { version: number };
    expect(persisted.version).toBe(8);
  });
});

describe("R9 — TOCTOU drift detection (GPT 2nd review §C.2)", () => {
  it("aborts the tx (and cleans R2) when pre-tx version drifts from in-tx version", async () => {
    const store = new Map<string, unknown>();
    // Prime the store with v=5
    store.set("context:s-1", {
      version: 5,
      committedAt: "2026-04-20T00:00:00.000Z",
      layers: [
        { kind: "system", priority: 0, content: "old-sys", tokenEstimate: 5, required: true },
      ],
      summary: { storage: "do", storageKey: "context-snapshot:s-1:v0", sizeBytes: 0 },
    });
    // Custom binding with a one-shot drift hook on the FIRST get
    let driftFired = false;
    const binding = {
      async get(key: unknown) {
        const result = store.get(String(key));
        if (!driftFired && key === "context:s-1") {
          driftFired = true;
          // Simulate a concurrent commit landing — bump version to 7
          store.set("context:s-1", {
            version: 7,
            committedAt: "2026-04-20T00:00:01.000Z",
            layers: [],
            summary: { storage: "do", storageKey: "context-snapshot:s-1:v0", sizeBytes: 0 },
          });
        }
        return result;
      },
      async put(key: unknown, value: unknown) {
        store.set(String(key), value);
      },
      async delete(key: unknown) {
        return store.delete(String(key));
      },
      async list() {
        return new Map();
      },
      async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
        const snapshot = new Map(store);
        const tx = {
          async get(key: unknown) {
            return store.get(String(key));
          },
          async put(key: unknown, value: unknown) {
            store.set(String(key), value);
          },
          async delete(key: unknown) {
            return store.delete(String(key));
          },
          async list() {
            return new Map(store);
          },
        };
        try {
          return await callback(tx);
        } catch (err) {
          store.clear();
          for (const [k, v] of snapshot) store.set(k, v);
          throw err;
        }
      },
    } as unknown as ConstructorParameters<typeof DOStorageAdapter>[0];
    const doAdapter = new DOStorageAdapter(binding);
    const { adapter: r2Adapter, store: r2Store } = fakeR2();
    const committer = new CompactionCommitter({
      sessionUuid: "s-1",
      doStorage: doAdapter,
      r2: r2Adapter,
    });
    const outcome = await committer.commit({
      candidate: candidate(5),
      prepared: prepared("summary text"),
    });
    // R9 — drift detection aborts the commit honestly
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.error).toContain("drifted");
    }
    // Snapshot key uses preTx version (v5) — that key must NOT exist
    // post-rollback (rollback restored the snapshot map state)
    expect(store.has("context-snapshot:s-1:v5")).toBe(false);
    // The bumped v=7 write that "landed concurrently" stays — we
    // never overwrote it with stale content
    const live = store.get("context:s-1") as { version: number };
    expect(live.version).toBe(7);
    // R2 promotion (if any) cleaned up
    expect(r2Store.size).toBe(0);
  });
});

describe("committer — B4-R6 snapshot R2 cleanup on tx rollback", () => {
  it("oversize pre-existing snapshot promoted to R2 BEFORE tx is cleaned up on rollback", async () => {
    const { binding } = fakeDoStorage({ failTransaction: true });
    const doAdapter = new DOStorageAdapter(binding, { maxValueBytes: 50 });
    const { adapter: r2Adapter, store: r2Store } = fakeR2();
    // Pre-seed an oversize context using the underlying binding so the
    // adapter cap doesn't refuse the seed itself.
    const heavyContext = {
      version: 5,
      committedAt: "2026-04-20T00:00:00.000Z",
      layers: Array.from({ length: 10 }, (_, i) => ({
        kind: "recent_transcript",
        priority: i,
        content: `turn-${i}`.repeat(20),
        tokenEstimate: 100,
        required: false,
      })),
      summary: { storage: "do", storageKey: "context-snapshot:s-1:v0", sizeBytes: 0 },
    };
    await binding.put("context:s-1", heavyContext);
    const committer = new CompactionCommitter({
      sessionUuid: "s-1",
      doStorage: doAdapter,
      r2: r2Adapter,
    });
    const outcome = await committer.commit({
      candidate: candidate(5),
      prepared: prepared("x".repeat(500)),
    });
    expect(outcome.kind).toBe("failed");
    // Both summary AND snapshot R2 blobs cleaned up
    expect(r2Store.size).toBe(0);
  });
});

// Helpers ──

function withSmallCap(opts: { failTransaction?: boolean } = {}) {
  const { binding } = fakeDoStorage(opts);
  // Wrap with explicit small cap to force R2 routing
  const adapter = new DOStorageAdapter(binding, { maxValueBytes: 50 });
  return { adapter };
}
