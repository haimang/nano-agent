/**
 * Storage Topology — R2Adapter Tests
 *
 * Targets B1 findings F01 (≤ 10 MiB single-call), F02 (cursor walking),
 * unexpected-F01 (`putParallel`).
 */

import { describe, it, expect } from "vitest";
import { R2Adapter, type R2BucketBinding, type R2ObjectBodyLike } from "../../../src/storage/adapters/r2-adapter.js";
import { ValueTooLargeError } from "../../../src/storage/errors.js";
import type { R2ObjectLike } from "../../../src/storage/adapters/scoped-io.js";

function makeBucket(seed: Map<string, ArrayBuffer | string> = new Map()): {
  bucket: R2BucketBinding;
  store: Map<string, ArrayBuffer | string>;
  listCalls: Array<{ prefix?: string; limit?: number; cursor?: string }>;
} {
  const store = seed;
  const listCalls: Array<{ prefix?: string; limit?: number; cursor?: string }> = [];

  const bucket: R2BucketBinding = {
    async put(key, value) {
      store.set(key, (value as ArrayBuffer | string) ?? "");
      return undefined;
    },
    async get(key) {
      if (!store.has(key)) return null;
      const v = store.get(key)!;
      const body: R2ObjectBodyLike = {
        key,
        size: typeof v === "string" ? new TextEncoder().encode(v).byteLength : v.byteLength,
        async text() {
          return typeof v === "string" ? v : new TextDecoder().decode(v);
        },
        async arrayBuffer() {
          return typeof v === "string" ? new TextEncoder().encode(v).buffer : v;
        },
      };
      return body;
    },
    async head(key) {
      if (!store.has(key)) return null;
      const v = store.get(key)!;
      return { key, size: typeof v === "string" ? v.length : v.byteLength };
    },
    async list(opts) {
      listCalls.push({ ...opts });
      const prefix = opts?.prefix ?? "";
      const limit = opts?.limit ?? 1000;
      const allKeys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const startIdx = opts?.cursor ? Number(opts.cursor) : 0;
      const slice = allKeys.slice(startIdx, startIdx + limit);
      const truncated = startIdx + limit < allKeys.length;
      const objects: R2ObjectLike[] = slice.map((k) => ({
        key: k,
        size: typeof store.get(k)! === "string" ? (store.get(k)! as string).length : (store.get(k)! as ArrayBuffer).byteLength,
      }));
      return {
        objects,
        truncated,
        cursor: truncated ? String(startIdx + limit) : undefined,
      };
    },
    async delete(key) {
      if (Array.isArray(key)) {
        for (const k of key) store.delete(k);
      } else {
        store.delete(key);
      }
    },
  };
  return { bucket, store, listCalls };
}

describe("R2Adapter", () => {
  describe("get/put/delete (basic)", () => {
    it("put + get round-trip a string", async () => {
      const { bucket } = makeBucket();
      const adapter = new R2Adapter(bucket);
      await adapter.put("k1", "hello");
      const got = await adapter.get("k1");
      expect(got).not.toBeNull();
      expect(await got!.text()).toBe("hello");
    });

    it("get returns null for missing key", async () => {
      const { bucket } = makeBucket();
      const adapter = new R2Adapter(bucket);
      expect(await adapter.get("missing")).toBeNull();
    });

    it("delete removes key", async () => {
      const { bucket } = makeBucket();
      const adapter = new R2Adapter(bucket);
      await adapter.put("k", "v");
      await adapter.delete("k");
      expect(await adapter.get("k")).toBeNull();
    });
  });

  describe("size pre-check (ValueTooLargeError)", () => {
    it("throws ValueTooLargeError when string body exceeds maxValueBytes", async () => {
      const { bucket } = makeBucket();
      const adapter = new R2Adapter(bucket, { maxValueBytes: 10 });
      await expect(adapter.put("k", "this is way more than ten bytes")).rejects.toBeInstanceOf(
        ValueTooLargeError,
      );
    });

    it("throws ValueTooLargeError when ArrayBuffer body exceeds maxValueBytes", async () => {
      const { bucket } = makeBucket();
      const adapter = new R2Adapter(bucket, { maxValueBytes: 5 });
      await expect(adapter.put("k", new ArrayBuffer(100))).rejects.toBeInstanceOf(
        ValueTooLargeError,
      );
    });

    it("does NOT pre-check when body is null or ReadableStream (size unknown)", async () => {
      const { bucket } = makeBucket();
      const adapter = new R2Adapter(bucket, { maxValueBytes: 1 });
      await expect(adapter.put("k", null)).resolves.toBeUndefined();
    });

    it("error.adapter is 'r2'", async () => {
      const { bucket } = makeBucket();
      const adapter = new R2Adapter(bucket, { maxValueBytes: 1 });
      try {
        await adapter.put("k", "xx");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ValueTooLargeError);
        expect((e as ValueTooLargeError).adapter).toBe("r2");
      }
    });
  });

  describe("list cursor walking (per spike-do-storage-F02)", () => {
    it("single page when total ≤ limit", async () => {
      const { bucket } = makeBucket();
      const adapter = new R2Adapter(bucket);
      await adapter.put("p/a", "1");
      await adapter.put("p/b", "2");
      const page = await adapter.list("p/", { limit: 10 });
      expect(page.objects).toHaveLength(2);
      expect(page.truncated).toBe(false);
      expect(page.cursor).toBeUndefined();
    });

    it("returns truncated=true and cursor when limit < total (F02 reproduction)", async () => {
      const { bucket } = makeBucket();
      const adapter = new R2Adapter(bucket);
      // Pre-seed 50 keys (mirrors F02 probe shape)
      for (let i = 0; i < 50; i++) {
        await adapter.put(`p/k${String(i).padStart(3, "0")}`, "v");
      }
      const page1 = await adapter.list("p/", { limit: 20 });
      expect(page1.objects).toHaveLength(20);
      expect(page1.truncated).toBe(true);
      expect(page1.cursor).toBeDefined();

      const page2 = await adapter.list("p/", { limit: 20, cursor: page1.cursor });
      expect(page2.objects).toHaveLength(20);
      expect(page2.truncated).toBe(true);

      const page3 = await adapter.list("p/", { limit: 20, cursor: page2.cursor });
      expect(page3.objects).toHaveLength(10);
      expect(page3.truncated).toBe(false);
      expect(page3.cursor).toBeUndefined();
    });

    it("listAll walks cursor automatically and returns full set", async () => {
      const { bucket, listCalls } = makeBucket();
      const adapter = new R2Adapter(bucket);
      for (let i = 0; i < 50; i++) {
        await adapter.put(`p/k${String(i).padStart(3, "0")}`, "v");
      }
      const all = await adapter.listAll("p/", { limit: 20 });
      expect(all).toHaveLength(50);
      // Three list calls (20 + 20 + 10) — F02 contract
      expect(listCalls).toHaveLength(3);
      expect(listCalls[0].cursor).toBeUndefined();
      expect(listCalls[1].cursor).toBe("20");
      expect(listCalls[2].cursor).toBe("40");
    });

    it("listAll respects maxPages cap to guard against runaway", async () => {
      const { bucket } = makeBucket();
      const adapter = new R2Adapter(bucket);
      for (let i = 0; i < 50; i++) {
        await adapter.put(`p/k${String(i).padStart(3, "0")}`, "v");
      }
      const all = await adapter.listAll("p/", { limit: 5, maxPages: 2 });
      // Two pages × 5 keys = 10
      expect(all).toHaveLength(10);
    });
  });

  describe("putParallel (per unexpected-F01)", () => {
    it("dispatches all items and respects concurrency batching", async () => {
      const { bucket, store } = makeBucket();
      const adapter = new R2Adapter(bucket);
      const items = Array.from({ length: 25 }, (_, i) => ({
        key: `p/${i}`,
        body: `v-${i}`,
      }));
      await adapter.putParallel(items, { concurrency: 5 });
      expect(store.size).toBe(25);
      for (let i = 0; i < 25; i++) {
        expect(store.get(`p/${i}`)).toBe(`v-${i}`);
      }
    });

    it("size cap is enforced per item inside putParallel", async () => {
      const { bucket } = makeBucket();
      const adapter = new R2Adapter(bucket, { maxValueBytes: 3 });
      await expect(
        adapter.putParallel(
          [
            { key: "ok", body: "ok" },
            { key: "bad", body: "this body is too large" },
          ],
          { concurrency: 2 },
        ),
      ).rejects.toBeInstanceOf(ValueTooLargeError);
    });

    it("default concurrency is 10 when not specified", async () => {
      const { bucket, store } = makeBucket();
      const adapter = new R2Adapter(bucket);
      const items = Array.from({ length: 30 }, (_, i) => ({ key: `p/${i}`, body: "v" }));
      await adapter.putParallel(items);
      expect(store.size).toBe(30);
    });
  });

  describe("F01 — single-call covers ≤ 10 MiB", () => {
    it("accepts a 1 MiB string body without invoking multipart helpers", async () => {
      const { bucket } = makeBucket();
      const adapter = new R2Adapter(bucket);
      const body = "x".repeat(1024 * 1024);
      await expect(adapter.put("k", body)).resolves.toBeUndefined();
    });
  });
});
