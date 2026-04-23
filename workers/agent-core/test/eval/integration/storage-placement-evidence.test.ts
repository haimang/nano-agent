/**
 * Integration test: StoragePlacementLog evidence collection.
 *
 * Verifies that the placement log correctly records operations,
 * computes per-layer summaries, and supports lookup by data item.
 */

import { describe, it, expect } from "vitest";
import { StoragePlacementLog } from "../../../src/eval/placement-log.js";
import type { PlacementEntry } from "../../../src/eval/placement-log.js";

function entry(overrides: Partial<PlacementEntry> = {}): PlacementEntry {
  return {
    dataItem: "session-messages",
    storageLayer: "do-storage",
    key: "session:messages",
    op: "write",
    sizeBytes: 1024,
    timestamp: "2026-04-16T10:00:00.000Z",
    ...overrides,
  };
}

describe("StoragePlacementLog — integration", () => {
  it("records and retrieves entries", () => {
    const log = new StoragePlacementLog();
    log.record(entry());
    log.record(entry({ dataItem: "audit-trail", storageLayer: "do-storage", op: "write" }));

    expect(log.getEntries()).toHaveLength(2);
  });

  it("filters entries by data item", () => {
    const log = new StoragePlacementLog();
    log.record(entry({ dataItem: "session-messages" }));
    log.record(entry({ dataItem: "audit-trail" }));
    log.record(entry({ dataItem: "session-messages" }));

    const messages = log.getByDataItem("session-messages");
    expect(messages).toHaveLength(2);
    expect(messages.every((e) => e.dataItem === "session-messages")).toBe(true);
  });

  it("returns empty array for unknown data item", () => {
    const log = new StoragePlacementLog();
    log.record(entry());

    expect(log.getByDataItem("nonexistent")).toEqual([]);
  });

  it("computes per-layer summary with reads, writes, and total bytes", () => {
    const log = new StoragePlacementLog();

    // DO storage: 2 writes, 1 read
    log.record(entry({ storageLayer: "do-storage", op: "write", sizeBytes: 1000 }));
    log.record(entry({ storageLayer: "do-storage", op: "write", sizeBytes: 2000 }));
    log.record(entry({ storageLayer: "do-storage", op: "read", sizeBytes: 500 }));

    // R2: 1 write
    log.record(entry({ storageLayer: "r2", op: "write", sizeBytes: 50000 }));

    const summary = log.getSummary();

    expect(summary["do-storage"]).toBeDefined();
    expect(summary["do-storage"].writes).toBe(2);
    expect(summary["do-storage"].reads).toBe(1);
    expect(summary["do-storage"].totalBytes).toBe(3500);

    expect(summary["r2"]).toBeDefined();
    expect(summary["r2"].writes).toBe(1);
    expect(summary["r2"].reads).toBe(0);
    expect(summary["r2"].totalBytes).toBe(50000);
  });

  it("handles delete operations in summary (not counted as read or write)", () => {
    const log = new StoragePlacementLog();
    log.record(entry({ op: "delete", sizeBytes: 100 }));

    const summary = log.getSummary();
    expect(summary["do-storage"].reads).toBe(0);
    expect(summary["do-storage"].writes).toBe(0);
    expect(summary["do-storage"].totalBytes).toBe(100);
  });

  it("handles entries without sizeBytes", () => {
    const log = new StoragePlacementLog();
    log.record({
      dataItem: "session-phase",
      storageLayer: "do-storage",
      key: "session:phase",
      op: "read",
      timestamp: "2026-04-16T10:00:00.000Z",
    });

    const summary = log.getSummary();
    expect(summary["do-storage"].reads).toBe(1);
    expect(summary["do-storage"].totalBytes).toBe(0);
  });

  it("returns a copy of entries (not a reference)", () => {
    const log = new StoragePlacementLog();
    log.record(entry());

    const entries = log.getEntries();
    entries.push(entry({ dataItem: "fake" }));
    expect(log.getEntries()).toHaveLength(1);
  });

  it("returns empty summary for empty log", () => {
    const log = new StoragePlacementLog();
    const summary = log.getSummary();
    expect(Object.keys(summary)).toHaveLength(0);
  });

  it("tracks multiple storage layers correctly in summary", () => {
    const log = new StoragePlacementLog();
    log.record(entry({ storageLayer: "do-storage", op: "write", sizeBytes: 100 }));
    log.record(entry({ storageLayer: "kv", op: "read", sizeBytes: 200 }));
    log.record(entry({ storageLayer: "r2", op: "write", sizeBytes: 300 }));

    const summary = log.getSummary();
    expect(Object.keys(summary)).toHaveLength(3);
    expect(summary["do-storage"].writes).toBe(1);
    expect(summary["kv"].reads).toBe(1);
    expect(summary["r2"].writes).toBe(1);
  });
});
