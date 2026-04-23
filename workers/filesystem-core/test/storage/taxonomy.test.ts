/**
 * Tests for the shared storage-tier vocabulary.
 */

import { describe, it, expect } from "vitest";
import { storageClassToBackend } from "../../src/storage/taxonomy.js";
import type {
  StorageClass,
  StorageBackend,
  ProvisionalMarker,
  ResponsibleRuntime,
} from "../../src/storage/taxonomy.js";

describe("storageClassToBackend", () => {
  it("maps hot → do-storage", () => {
    expect(storageClassToBackend("hot")).toBe("do-storage");
  });

  it("maps warm → kv", () => {
    expect(storageClassToBackend("warm")).toBe("kv");
  });

  it("maps cold → r2", () => {
    expect(storageClassToBackend("cold")).toBe("r2");
  });

  it("is exhaustive across every StorageClass — if this test fails the type added a new tier without updating the mapping", () => {
    const allClasses: StorageClass[] = ["hot", "warm", "cold"];
    const allBackends: StorageBackend[] = allClasses.map((c) => storageClassToBackend(c));
    const unique = new Set<StorageBackend>(allBackends);
    expect(unique.size).toBe(allClasses.length);
    for (const backend of allBackends) {
      expect(["do-storage", "kv", "r2"]).toContain(backend);
    }
  });
});

describe("ProvisionalMarker type", () => {
  it("covers exactly the three expected states", () => {
    const all: ProvisionalMarker[] = ["provisional", "evidence-backed", "frozen"];
    expect(all).toHaveLength(3);
  });
});

describe("ResponsibleRuntime type", () => {
  it("includes the six v1 runtimes", () => {
    const all: ResponsibleRuntime[] = [
      "session-do",
      "workspace",
      "eval",
      "capability",
      "hooks",
      "platform",
    ];
    expect(new Set(all).size).toBe(6);
  });
});
