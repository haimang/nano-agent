/**
 * Storage Topology — DOStorageAdapter Tests
 *
 * Targets B1 findings:
 *   - F04 (transactional semantics: throw → rollback)
 *   - F05 (basic K/V parity)
 *   - F08 (size pre-check; 1 MiB conservative cap)
 */

import { describe, it, expect } from "vitest";
import {
  DOStorageAdapter,
  type DurableObjectStorageBinding,
  type DurableObjectTransactionLike,
} from "../../src/adapters/do-storage-adapter.js";
import { ValueTooLargeError } from "../../src/errors.js";

function makeStorage(): {
  storage: DurableObjectStorageBinding;
  store: Map<string, unknown>;
} {
  const store = new Map<string, unknown>();
  const storage: DurableObjectStorageBinding = {
    async get<T = unknown>(arg: string | string[]): Promise<T | undefined | Map<string, T>> {
      if (Array.isArray(arg)) {
        const m = new Map<string, T>();
        for (const k of arg) {
          if (store.has(k)) m.set(k, store.get(k) as T);
        }
        return m;
      }
      return store.get(arg) as T | undefined;
    },
    async put<T>(arg: string | Record<string, T>, value?: T): Promise<void> {
      if (typeof arg === "string") {
        store.set(arg, value);
      } else {
        for (const [k, v] of Object.entries(arg)) {
          store.set(k, v);
        }
      }
    },
    async delete(arg: string | string[]): Promise<boolean | number> {
      if (Array.isArray(arg)) {
        let n = 0;
        for (const k of arg) {
          if (store.delete(k)) n += 1;
        }
        return n;
      }
      return store.delete(arg);
    },
    async list<T = unknown>(opts?: { prefix?: string; limit?: number }): Promise<Map<string, T>> {
      const prefix = opts?.prefix ?? "";
      const m = new Map<string, T>();
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const sliced = opts?.limit ? keys.slice(0, opts.limit) : keys;
      for (const k of sliced) {
        m.set(k, store.get(k) as T);
      }
      return m;
    },
    async transaction<T>(callback: (tx: DurableObjectTransactionLike) => Promise<T>): Promise<T> {
      // Snapshot for rollback
      const snapshot = new Map(store);
      const tx: DurableObjectTransactionLike = {
        async get<U = unknown>(arg: string | string[]): Promise<U | undefined | Map<string, U>> {
          if (Array.isArray(arg)) {
            const m = new Map<string, U>();
            for (const k of arg) if (store.has(k)) m.set(k, store.get(k) as U);
            return m;
          }
          return store.get(arg) as U | undefined;
        },
        async put<U>(arg: string | Record<string, U>, val?: U): Promise<void> {
          if (typeof arg === "string") store.set(arg, val);
          else for (const [k, v] of Object.entries(arg)) store.set(k, v);
        },
        async delete(arg: string | string[]): Promise<boolean | number> {
          if (Array.isArray(arg)) {
            let n = 0;
            for (const k of arg) if (store.delete(k)) n += 1;
            return n;
          }
          return store.delete(arg);
        },
        async list<U = unknown>(): Promise<Map<string, U>> {
          return new Map(store) as unknown as Map<string, U>;
        },
      };
      try {
        return await callback(tx);
      } catch (err) {
        // Rollback
        store.clear();
        for (const [k, v] of snapshot) store.set(k, v);
        throw err;
      }
    },
  } as unknown as DurableObjectStorageBinding;
  return { storage, store };
}

describe("DOStorageAdapter", () => {
  describe("get/put/delete (basic)", () => {
    it("put + get round-trip", async () => {
      const { storage } = makeStorage();
      const adapter = new DOStorageAdapter(storage);
      await adapter.put("k", "v");
      expect(await adapter.get("k")).toBe("v");
    });

    it("get returns undefined for missing key", async () => {
      const { storage } = makeStorage();
      const adapter = new DOStorageAdapter(storage);
      expect(await adapter.get("missing")).toBeUndefined();
    });

    it("delete returns true when key existed", async () => {
      const { storage } = makeStorage();
      const adapter = new DOStorageAdapter(storage);
      await adapter.put("k", "v");
      expect(await adapter.delete("k")).toBe(true);
    });

    it("delete returns false when key did not exist", async () => {
      const { storage } = makeStorage();
      const adapter = new DOStorageAdapter(storage);
      expect(await adapter.delete("missing")).toBe(false);
    });
  });

  describe("size pre-check (per spike-do-storage-F08)", () => {
    it("default maxValueBytes is 1 MiB", () => {
      const { storage } = makeStorage();
      const adapter = new DOStorageAdapter(storage);
      expect(adapter.maxValueBytes).toBe(1024 * 1024);
    });

    it("put throws ValueTooLargeError when string exceeds cap", async () => {
      const { storage } = makeStorage();
      const adapter = new DOStorageAdapter(storage, { maxValueBytes: 8 });
      await expect(adapter.put("k", "this is more than eight bytes")).rejects.toBeInstanceOf(
        ValueTooLargeError,
      );
    });

    it("put throws ValueTooLargeError for ArrayBuffer beyond cap", async () => {
      const { storage } = makeStorage();
      const adapter = new DOStorageAdapter(storage, { maxValueBytes: 5 });
      await expect(adapter.put("k", new ArrayBuffer(100))).rejects.toBeInstanceOf(
        ValueTooLargeError,
      );
    });

    it("put throws ValueTooLargeError for JSON-shaped values beyond cap", async () => {
      const { storage } = makeStorage();
      const adapter = new DOStorageAdapter(storage, { maxValueBytes: 10 });
      const fat = { items: Array.from({ length: 1000 }, (_, i) => ({ i })) };
      await expect(adapter.put("k", fat)).rejects.toBeInstanceOf(ValueTooLargeError);
    });

    it("error.adapter is 'do'", async () => {
      const { storage } = makeStorage();
      const adapter = new DOStorageAdapter(storage, { maxValueBytes: 1 });
      try {
        await adapter.put("k", "xx");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect((e as ValueTooLargeError).adapter).toBe("do");
      }
    });

    it("succeeds at exactly cap boundary", async () => {
      const { storage } = makeStorage();
      const adapter = new DOStorageAdapter(storage, { maxValueBytes: 5 });
      await expect(adapter.put("k", "exact")).resolves.toBeUndefined();
    });

    it("putMany rejects whole batch when one entry exceeds cap", async () => {
      const { storage, store } = makeStorage();
      const adapter = new DOStorageAdapter(storage, { maxValueBytes: 5 });
      await expect(adapter.putMany({ ok: "ok", bad: "way too big" })).rejects.toBeInstanceOf(
        ValueTooLargeError,
      );
      // Nothing was written
      expect(store.size).toBe(0);
    });

    it("putMany succeeds when all entries are within cap", async () => {
      const { storage, store } = makeStorage();
      const adapter = new DOStorageAdapter(storage, { maxValueBytes: 100 });
      await adapter.putMany({ a: "alpha", b: "beta" });
      expect(store.get("a")).toBe("alpha");
      expect(store.get("b")).toBe("beta");
    });
  });

  describe("transaction (per spike-do-storage-F04)", () => {
    it("commits when callback resolves", async () => {
      const { storage, store } = makeStorage();
      const adapter = new DOStorageAdapter(storage);
      await adapter.put("a", "1");
      await adapter.transaction(async (tx) => {
        await tx.put("a", "2");
        await tx.put("b", "3");
      });
      expect(store.get("a")).toBe("2");
      expect(store.get("b")).toBe("3");
    });

    it("rolls back when callback throws (F04 throw → rollback)", async () => {
      const { storage, store } = makeStorage();
      const adapter = new DOStorageAdapter(storage);
      await adapter.put("a", "original");
      await expect(
        adapter.transaction(async (tx) => {
          await tx.put("a", "modified");
          await tx.put("b", "added");
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      // rollback restored snapshot
      expect(store.get("a")).toBe("original");
      expect(store.has("b")).toBe(false);
    });

    it("transaction return value resolves outer promise", async () => {
      const { storage } = makeStorage();
      const adapter = new DOStorageAdapter(storage);
      const result = await adapter.transaction(async () => "result-value");
      expect(result).toBe("result-value");
    });
  });

  describe("getMany / list / deleteMany", () => {
    it("getMany returns Map of present keys only", async () => {
      const { storage } = makeStorage();
      const adapter = new DOStorageAdapter(storage);
      await adapter.put("a", 1);
      await adapter.put("b", 2);
      const m = await adapter.getMany(["a", "b", "missing"]);
      expect(m.size).toBe(2);
      expect(m.get("a")).toBe(1);
    });

    it("list filters by prefix", async () => {
      const { storage } = makeStorage();
      const adapter = new DOStorageAdapter(storage);
      await adapter.put("user:1", "u1");
      await adapter.put("user:2", "u2");
      await adapter.put("session:1", "s1");
      const m = await adapter.list({ prefix: "user:" });
      expect(m.size).toBe(2);
    });

    it("deleteMany returns count of actually-deleted keys", async () => {
      const { storage } = makeStorage();
      const adapter = new DOStorageAdapter(storage);
      await adapter.put("a", 1);
      await adapter.put("b", 2);
      const n = await adapter.deleteMany(["a", "b", "missing"]);
      expect(n).toBe(2);
    });
  });
});
