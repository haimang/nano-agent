/**
 * Workspace Context Artifacts — ReferenceBackend Tests
 *
 * Targets:
 *   - F04: DO storage transactional semantics (delegated to DOStorageAdapter)
 *   - F05: ReferenceBackend round-trip parity with MemoryBackend for inline writes
 *   - F08: oversize blob promotion to R2 when an R2 adapter is supplied;
 *          ValueTooLargeError when no R2 backing
 *   - StorageNotConnectedError surface for the placeholder mode
 */

import { describe, it, expect } from "vitest";
import {
  DOStorageAdapter,
  R2Adapter,
  StorageNotConnectedError,
  ValueTooLargeError,
  type DurableObjectStorageBinding,
  type DurableObjectTransactionLike,
  type R2BucketBinding,
  type R2ObjectBodyLike,
} from "../../src/storage/index.js";
import { ReferenceBackend } from "../../src/backends/reference.js";

function fakeDoStorage(): {
  binding: DurableObjectStorageBinding;
  store: Map<string, unknown>;
} {
  const store = new Map<string, unknown>();
  const binding: DurableObjectStorageBinding = {
    async get<T = unknown>(arg: string | string[]) {
      if (Array.isArray(arg)) {
        const m = new Map<string, T>();
        for (const k of arg) if (store.has(k)) m.set(k, store.get(k) as T);
        return m;
      }
      return store.get(arg) as T | undefined;
    },
    async put<T>(arg: string | Record<string, T>, val?: T) {
      if (typeof arg === "string") store.set(arg, val);
      else for (const [k, v] of Object.entries(arg)) store.set(k, v);
    },
    async delete(arg: string | string[]) {
      if (Array.isArray(arg)) {
        let n = 0;
        for (const k of arg) if (store.delete(k)) n += 1;
        return n;
      }
      return store.delete(arg);
    },
    async list<T = unknown>(opts?: { prefix?: string; limit?: number }) {
      const prefix = opts?.prefix ?? "";
      const m = new Map<string, T>();
      for (const k of [...store.keys()].sort()) {
        if (k.startsWith(prefix)) m.set(k, store.get(k) as T);
      }
      return m;
    },
    async transaction<T>(callback: (tx: DurableObjectTransactionLike) => Promise<T>) {
      return callback(binding as unknown as DurableObjectTransactionLike);
    },
  } as unknown as DurableObjectStorageBinding;
  return { binding, store };
}

function fakeR2(): { bucket: R2BucketBinding; store: Map<string, string> } {
  const store = new Map<string, string>();
  const bucket: R2BucketBinding = {
    async put(key, value) {
      store.set(
        key,
        value === null
          ? ""
          : typeof value === "string"
            ? value
            : value instanceof ArrayBuffer
              ? new TextDecoder().decode(value)
              : ArrayBuffer.isView(value)
                ? new TextDecoder().decode(value)
                : "",
      );
      return undefined;
    },
    async get(key) {
      if (!store.has(key)) return null;
      const v = store.get(key)!;
      const body: R2ObjectBodyLike = {
        key,
        size: new TextEncoder().encode(v).byteLength,
        async text() {
          return v;
        },
        async arrayBuffer() {
          return new TextEncoder().encode(v).buffer;
        },
      };
      return body;
    },
    async head(key) {
      if (!store.has(key)) return null;
      return { key, size: new TextEncoder().encode(store.get(key)!).byteLength };
    },
    async list() {
      return { objects: [], truncated: false };
    },
    async delete(key) {
      if (Array.isArray(key)) for (const k of key) store.delete(k);
      else store.delete(key);
    },
  };
  return { bucket, store };
}

describe("ReferenceBackend (B2 connected mode)", () => {
  describe("not-connected mode (placeholder)", () => {
    it("isConnected() === false when no doStorage supplied", () => {
      const backend = new ReferenceBackend();
      expect(backend.isConnected()).toBe(false);
    });

    it("every method throws StorageNotConnectedError", async () => {
      const backend = new ReferenceBackend();
      await expect(backend.read("a")).rejects.toBeInstanceOf(StorageNotConnectedError);
      await expect(backend.write("a", "x")).rejects.toBeInstanceOf(
        StorageNotConnectedError,
      );
      await expect(backend.list("")).rejects.toBeInstanceOf(StorageNotConnectedError);
      await expect(backend.stat("a")).rejects.toBeInstanceOf(StorageNotConnectedError);
      await expect(backend.delete("a")).rejects.toBeInstanceOf(StorageNotConnectedError);
    });

    it("StorageNotConnectedError carries operation + adapter labels", async () => {
      const backend = new ReferenceBackend();
      try {
        await backend.read("a");
        expect.unreachable();
      } catch (e) {
        expect((e as StorageNotConnectedError).operation).toBe("read");
        expect((e as StorageNotConnectedError).adapter).toBe("ReferenceBackend");
      }
    });
  });

  describe("connected mode — basic CRUD round-trip (per F05 parity)", () => {
    it("write + read roundtrip a small file inline through DO", async () => {
      const { binding, store } = fakeDoStorage();
      const backend = new ReferenceBackend({
        doStorage: new DOStorageAdapter(binding),
      });
      await backend.write("hello.txt", "Hello, world!");
      expect(await backend.read("hello.txt")).toBe("Hello, world!");
      // Stored as inline DoEntry
      const stored = store.get("hello.txt") as { kind: string; content: string };
      expect(stored.kind).toBe("inline");
      expect(stored.content).toBe("Hello, world!");
    });

    it("read returns null for missing key", async () => {
      const { binding } = fakeDoStorage();
      const backend = new ReferenceBackend({
        doStorage: new DOStorageAdapter(binding),
      });
      expect(await backend.read("missing.txt")).toBeNull();
    });

    it("stat returns size + modifiedAt for existing inline entry", async () => {
      const { binding } = fakeDoStorage();
      const backend = new ReferenceBackend({
        doStorage: new DOStorageAdapter(binding),
      });
      await backend.write("info.json", '{"a":1}');
      const meta = await backend.stat("info.json");
      expect(meta).not.toBeNull();
      expect(meta!.size).toBe(7);
      expect(meta!.modifiedAt).toBeTruthy();
      expect(() => new Date(meta!.modifiedAt)).not.toThrow();
    });

    it("delete removes the key and returns true", async () => {
      const { binding, store } = fakeDoStorage();
      const backend = new ReferenceBackend({
        doStorage: new DOStorageAdapter(binding),
      });
      await backend.write("temp.txt", "temp");
      expect(await backend.delete("temp.txt")).toBe(true);
      expect(store.has("temp.txt")).toBe(false);
    });

    it("delete returns false for non-existent key", async () => {
      const { binding } = fakeDoStorage();
      const backend = new ReferenceBackend({
        doStorage: new DOStorageAdapter(binding),
      });
      expect(await backend.delete("never-was-here")).toBe(false);
    });

    it("list filters immediate children by prefix", async () => {
      const { binding } = fakeDoStorage();
      const backend = new ReferenceBackend({
        doStorage: new DOStorageAdapter(binding),
      });
      await backend.write("src/a.ts", "a");
      await backend.write("src/b.ts", "b");
      await backend.write("src/lib/c.ts", "c");
      const top = await backend.list("");
      expect(top.find((e) => e.name === "src")).toBeDefined();
      const sub = await backend.list("src");
      const names = sub.map((e) => e.name).sort();
      expect(names).toEqual(["a.ts", "b.ts", "lib"]);
    });
  });

  describe("oversize behavior (per F08)", () => {
    it("without R2 backing: oversize write throws ValueTooLargeError of adapter='do'", async () => {
      const { binding } = fakeDoStorage();
      const backend = new ReferenceBackend({
        doStorage: new DOStorageAdapter(binding, { maxValueBytes: 16 }),
      });
      try {
        await backend.write("big.txt", "this is way more than sixteen bytes");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ValueTooLargeError);
        expect((e as ValueTooLargeError).adapter).toBe("do");
      }
    });

    it("with R2 backing: oversize write is promoted to R2 and DO stores a pointer", async () => {
      const { binding, store: doStore } = fakeDoStorage();
      const { bucket, store: r2Store } = fakeR2();
      // Cap at 256 bytes — large enough to hold the small JSON pointer
      // entry (~100 B) but smaller than the 1 KiB payload below; the
      // pointer entry itself must fit under the cap or the second
      // doStorage.put would also reject.
      const backend = new ReferenceBackend({
        doStorage: new DOStorageAdapter(binding, { maxValueBytes: 256 }),
        r2: new R2Adapter(bucket),
        r2KeyPrefix: "ws/",
      });
      const big = "x".repeat(1024);
      await backend.write("big.txt", big);

      // DO holds promoted pointer
      const entry = doStore.get("big.txt") as { kind: string; r2Key: string; size: number };
      expect(entry.kind).toBe("promoted");
      expect(entry.r2Key).toBe("ws/big.txt");
      expect(entry.size).toBe(1024);

      // R2 holds the payload
      expect(r2Store.get("ws/big.txt")).toBe(big);

      // Read transparently fetches from R2
      expect(await backend.read("big.txt")).toBe(big);
    });

    it("delete cleans up R2 backing for promoted entries (best-effort)", async () => {
      const { binding } = fakeDoStorage();
      const { bucket, store: r2Store } = fakeR2();
      const backend = new ReferenceBackend({
        doStorage: new DOStorageAdapter(binding, { maxValueBytes: 256 }),
        r2: new R2Adapter(bucket),
      });
      await backend.write("big.txt", "x".repeat(1024));
      expect(r2Store.size).toBe(1);
      await backend.delete("big.txt");
      expect(r2Store.size).toBe(0);
    });

    it("inline entries below cap do not touch R2 even when R2 is supplied", async () => {
      const { binding } = fakeDoStorage();
      const { bucket, store: r2Store } = fakeR2();
      const backend = new ReferenceBackend({
        doStorage: new DOStorageAdapter(binding),
        r2: new R2Adapter(bucket),
      });
      await backend.write("small.txt", "tiny");
      expect(r2Store.size).toBe(0);
    });
  });

  describe("end-to-end: matches MemoryBackend behavior for inline writes (F05 parity)", () => {
    it("CRUD shape mirrors MemoryBackend's API", async () => {
      const { binding } = fakeDoStorage();
      const backend = new ReferenceBackend({
        doStorage: new DOStorageAdapter(binding),
      });
      await backend.write("doc.md", "# Draft");
      expect(await backend.read("doc.md")).toBe("# Draft");
      await backend.write("doc.md", "# Final");
      expect(await backend.read("doc.md")).toBe("# Final");
      const stat = await backend.stat("doc.md");
      expect(stat).not.toBeNull();
      expect(stat!.size).toBe(7);
      const list = await backend.list("");
      expect(list.find((e) => e.name === "doc.md")).toBeDefined();
      expect(await backend.delete("doc.md")).toBe(true);
      expect(await backend.read("doc.md")).toBeNull();
    });
  });
});
