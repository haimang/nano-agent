/**
 * Local shim for `node:async_hooks` to keep nacp-core free of
 * `@types/node`. The class is identical to Node's / Cloudflare Workers'
 * `AsyncLocalStorage<T>` for the methods we use (`run`, `getStore`).
 *
 * Cloudflare Workers exposes this under the `nodejs_compat` flag — every
 * nano-agent worker already declares that flag in `wrangler.jsonc`, so
 * this dynamic import resolves at runtime in both Node and Workers.
 */

// We intentionally do NOT use a static `import { AsyncLocalStorage } from
// "node:async_hooks"` here, because that would require `@types/node` for
// type-checking. Instead, we declare the shape locally, then re-export a
// runtime-resolved class.

export interface AsyncLocalStorageLike<T> {
  run<R>(store: T, fn: () => R): R;
  getStore(): T | undefined;
}

type AsyncLocalStorageCtor<T = unknown> = new () => AsyncLocalStorageLike<T>;

interface NodeAsyncHooksModule {
  AsyncLocalStorage: AsyncLocalStorageCtor;
}

const moduleName = "node:async_hooks";

// `Function("return import(...)")` keeps TypeScript from resolving the
// specifier at compile time. The actual runtime resolution happens via
// the dynamic import promise; `AsyncLocalStorage` is exported as a
// thenable proxy class that defers construction to first use, but
// because both Node and Cloudflare Workers ship the module
// synchronously-available, top-level await would also work; we avoid TLA
// to keep ESM consumers (microbundlers, vitest) simple.
//
// Approach: synchronous require-style fallback. `globalThis.process`
// indicates Node; on Cloudflare Workers we rely on the loader providing
// the module via a static dynamic import below.
//
// To keep this module synchronous (avoiding TLA), we declare a minimal
// proxy class that lazily resolves on first construction.

let _real: AsyncLocalStorageCtor | null = null;
let _resolveError: unknown = null;

async function ensureRealLoaded(): Promise<AsyncLocalStorageCtor> {
  if (_real) return _real;
  if (_resolveError) throw _resolveError;
  try {
    const mod = (await import(/* @vite-ignore */ moduleName)) as NodeAsyncHooksModule;
    _real = mod.AsyncLocalStorage;
    return _real;
  } catch (err) {
    _resolveError = err;
    throw err;
  }
}

// Fast path for Node-resolvable environments (Node, vitest, Cloudflare
// Workers with `nodejs_compat`): trigger the import eagerly so the first
// instantiation is synchronous.
const _eagerLoad: Promise<AsyncLocalStorageCtor> = ensureRealLoaded();
// Swallow unhandled rejection — if the runtime doesn't support
// node:async_hooks, the AsyncLocalStorage constructor below will rethrow
// at first use.
_eagerLoad.catch(() => undefined);

export class AsyncLocalStorage<T> implements AsyncLocalStorageLike<T> {
  private _impl: AsyncLocalStorageLike<T> | null = null;

  private _ensureImpl(): AsyncLocalStorageLike<T> {
    if (!this._impl) {
      if (!_real) {
        if (_resolveError) throw _resolveError;
        throw new Error(
          "@haimang/nacp-core/logger: node:async_hooks is not yet resolved. " +
            "Ensure the runtime supports it (Node, or Cloudflare Workers with nodejs_compat).",
        );
      }
      const Ctor = _real as AsyncLocalStorageCtor<T>;
      this._impl = new Ctor();
    }
    return this._impl;
  }

  run<R>(store: T, fn: () => R): R {
    return this._ensureImpl().run(store, fn);
  }

  getStore(): T | undefined {
    return this._ensureImpl().getStore();
  }
}
