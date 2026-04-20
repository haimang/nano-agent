/**
 * Storage Topology — KvAdapter Tests
 *
 * Targets B1 findings F03 (freshness JSDoc only — no behavioral
 * difference enforceable in unit test) and unexpected-F02 (`putAsync`
 * fire-and-forget contract).
 */

import { describe, it, expect, vi } from "vitest";
import { KvAdapter, type KVNamespaceBinding } from "../../src/adapters/kv-adapter.js";
import { ValueTooLargeError } from "../../src/errors.js";

function makeKv(): {
  kv: KVNamespaceBinding;
  store: Map<string, string>;
  putCalls: Array<{ key: string; value: string }>;
} {
  const store = new Map<string, string>();
  const putCalls: Array<{ key: string; value: string }> = [];
  const kv: KVNamespaceBinding = {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      putCalls.push({ key, value });
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
  return { kv, store, putCalls };
}

describe("KvAdapter", () => {
  describe("get/put/delete", () => {
    it("put + get round-trip", async () => {
      const { kv } = makeKv();
      const adapter = new KvAdapter(kv);
      await adapter.put("k1", "hello");
      expect(await adapter.get("k1")).toBe("hello");
    });

    it("get returns null for missing key", async () => {
      const { kv } = makeKv();
      const adapter = new KvAdapter(kv);
      expect(await adapter.get("missing")).toBeNull();
    });

    it("delete removes key", async () => {
      const { kv } = makeKv();
      const adapter = new KvAdapter(kv);
      await adapter.put("k", "v");
      await adapter.delete("k");
      expect(await adapter.get("k")).toBeNull();
    });
  });

  describe("size pre-check", () => {
    it("put throws ValueTooLargeError beyond maxValueBytes", async () => {
      const { kv } = makeKv();
      const adapter = new KvAdapter(kv, { maxValueBytes: 5 });
      await expect(adapter.put("k", "this is more than five bytes")).rejects.toBeInstanceOf(
        ValueTooLargeError,
      );
    });

    it("put error.adapter is 'kv'", async () => {
      const { kv } = makeKv();
      const adapter = new KvAdapter(kv, { maxValueBytes: 1 });
      try {
        await adapter.put("k", "xx");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect((e as ValueTooLargeError).adapter).toBe("kv");
      }
    });

    it("default maxValueBytes is 25 MiB", () => {
      const { kv } = makeKv();
      const adapter = new KvAdapter(kv);
      expect(adapter.maxValueBytes).toBe(25 * 1024 * 1024);
    });
  });

  describe("putAsync (per unexpected-F02)", () => {
    it("returns synchronously (no await needed)", () => {
      const { kv } = makeKv();
      const adapter = new KvAdapter(kv);
      const result = adapter.putAsync("k", "v");
      // putAsync MUST be void / sync
      expect(result).toBeUndefined();
    });

    it("registers the write with ctx.waitUntil when provided", async () => {
      const { kv, putCalls } = makeKv();
      const adapter = new KvAdapter(kv);
      const captured: Promise<unknown>[] = [];
      const ctx = { waitUntil: (p: Promise<unknown>) => captured.push(p) };
      adapter.putAsync("k", "v", ctx);
      expect(captured).toHaveLength(1);
      await captured[0];
      expect(putCalls).toEqual([{ key: "k", value: "v" }]);
    });

    it("size cap is enforced synchronously (throws before dispatch)", () => {
      const { kv, putCalls } = makeKv();
      const adapter = new KvAdapter(kv, { maxValueBytes: 3 });
      expect(() => adapter.putAsync("k", "way too big string here")).toThrow(
        ValueTooLargeError,
      );
      // Nothing was dispatched
      expect(putCalls).toHaveLength(0);
    });

    it("write failures are swallowed (warned, not thrown)", async () => {
      const failing: KVNamespaceBinding = {
        async get() {
          return null;
        },
        async put() {
          throw new Error("KV down");
        },
        async delete() {},
      };
      const adapter = new KvAdapter(failing);
      const captured: Promise<unknown>[] = [];
      const ctx = { waitUntil: (p: Promise<unknown>) => captured.push(p) };
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      adapter.putAsync("k", "v", ctx);
      // Resolves (does not reject) because the catch handler swallows
      await expect(captured[0]).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("KvAdapter.putAsync(k) failed"),
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });

    it("works without ctx (write still dispatched)", async () => {
      const { kv, putCalls } = makeKv();
      const adapter = new KvAdapter(kv);
      adapter.putAsync("k", "v");
      // Yield microtasks so the dispatched write resolves
      await new Promise((r) => setTimeout(r, 5));
      expect(putCalls).toEqual([{ key: "k", value: "v" }]);
    });
  });
});
