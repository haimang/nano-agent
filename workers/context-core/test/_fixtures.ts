/**
 * Shared test fixtures — fake DO storage / R2 / KV bindings.
 *
 * Mirrors the seed pattern used in `workspace-context-artifacts` tests
 * so B4 tests speak the same vocabulary.
 */

import {
  DOStorageAdapter,
  R2Adapter,
  type DurableObjectStorageBinding,
  type DurableObjectTransactionLike,
  type R2BucketBinding,
  type R2ObjectBodyLike,
} from "@nano-agent/storage-topology";

export function fakeDoStorage(
  opts: {
    failTransaction?: boolean;
    /**
     * R9 drift fixture (GPT 2nd review §C.2). One-shot hook fired
     * AFTER the next `binding.get(...)` call computes its result but
     * BEFORE it returns. Lets a test simulate a concurrent commit
     * that lands between the committer's pre-tx read and its in-tx
     * read.
     */
    onGetSideEffect?: (key: string | string[]) => void;
  } = {},
) {
  const store = new Map<string, unknown>();
  let getSideEffect = opts.onGetSideEffect;
  const binding: DurableObjectStorageBinding = {
    async get<T = unknown>(arg: string | string[]) {
      const result: T | undefined | Map<string, T> = Array.isArray(arg)
        ? (() => {
            const m = new Map<string, T>();
            for (const k of arg) if (store.has(k)) m.set(k, store.get(k) as T);
            return m;
          })()
        : (store.get(arg) as T | undefined);
      if (getSideEffect) {
        const fn = getSideEffect;
        getSideEffect = undefined; // one-shot
        fn(arg);
      }
      return result;
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
    async list<T = unknown>(o?: { prefix?: string; limit?: number }) {
      const prefix = o?.prefix ?? "";
      const m = new Map<string, T>();
      for (const k of [...store.keys()].sort()) {
        if (k.startsWith(prefix)) m.set(k, store.get(k) as T);
      }
      return m;
    },
    async transaction<T>(callback: (tx: DurableObjectTransactionLike) => Promise<T>) {
      if (opts.failTransaction) {
        throw new Error("forced-tx-failure");
      }
      const snapshot = new Map(store);
      const tx: DurableObjectTransactionLike = {
        async get<U = unknown>(arg: string | string[]) {
          if (Array.isArray(arg)) {
            const m = new Map<string, U>();
            for (const k of arg) if (store.has(k)) m.set(k, store.get(k) as U);
            return m;
          }
          return store.get(arg) as U | undefined;
        },
        async put<U>(arg: string | Record<string, U>, val?: U) {
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
        async list<U = unknown>() {
          return new Map(store) as unknown as Map<string, U>;
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
  } as unknown as DurableObjectStorageBinding;

  return { binding, store, adapter: new DOStorageAdapter(binding) };
}

export function fakeR2() {
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
  return { bucket, store, adapter: new R2Adapter(bucket) };
}

export function fakeProvider(text = "default summary") {
  return {
    async summarize() {
      return { text };
    },
  };
}
