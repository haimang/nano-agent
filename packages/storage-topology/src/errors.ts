/**
 * Storage Topology — Typed Error Hierarchy
 *
 * Introduced in v2.0.0 per B1 spike findings:
 *   - F02 (`docs/spikes/spike-do-storage/02-...`): `r2List` cursor walking required
 *   - F06 (`docs/spikes/spike-do-storage/06-...`): D1 rejects BEGIN
 *   - F08 (`docs/spikes/spike-do-storage/08-...`): DO storage 1-10 MiB value cap
 *
 * All errors thrown by `storage-topology` adapters (including
 * `NullStorageAdapter` and the 4 production-shaped adapters) inherit
 * from `StorageError` so consumers can `catch (e) { if (e instanceof
 * StorageError) … }` without enumerating concrete subclasses.
 */

// ═══════════════════════════════════════════════════════════════════
// §1 — StorageError (base)
// ═══════════════════════════════════════════════════════════════════

/** Base class for all `@nano-agent/storage-topology` errors. */
export class StorageError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "StorageError";
    this.hint = hint;
  }
}

// ═══════════════════════════════════════════════════════════════════
// §2 — ValueTooLargeError
// ═══════════════════════════════════════════════════════════════════

/** Adapter kinds that report a size cap. */
export type SizeCappedAdapterKind = "do" | "kv" | "r2" | "memory";

/**
 * Thrown when a `put` target receives a value whose encoded byte length
 * exceeds the adapter's `maxValueBytes`. Source: spike-do-storage-F08
 * (DO storage 1 MiB – 10 MiB SQLITE_TOOBIG) + spike-do-storage-F05
 * (MemoryBackend must mirror production DO cap).
 *
 * Consumer guidance: promote the offending blob to a tier with higher
 * cap (e.g. DO → R2) before retrying the write.
 */
export class ValueTooLargeError extends StorageError {
  readonly bytes: number;
  readonly cap: number;
  readonly adapter: SizeCappedAdapterKind;

  constructor(
    bytes: number,
    cap: number,
    adapter: SizeCappedAdapterKind,
  ) {
    super(
      `Value too large: ${bytes} bytes > ${cap} cap on ${adapter} adapter`,
      "Promote to a tier with higher cap (e.g. R2) before writing this value.",
    );
    this.name = "ValueTooLargeError";
    this.bytes = bytes;
    this.cap = cap;
    this.adapter = adapter;
  }
}

// ═══════════════════════════════════════════════════════════════════
// §3 — CursorRequiredError
// ═══════════════════════════════════════════════════════════════════

/**
 * Thrown when a helper detected that the caller attempted to treat a
 * truncated R2 list response as exhaustive. Source: spike-do-storage-F02
 * (50 keys + limit=20 returns 20 + cursor).
 *
 * The live `r2List(prefix, opts)` adapter path does **not** throw this
 * on its own — it returns `{ truncated: true, cursor }` faithfully. The
 * error is reserved for explicitly cursor-forbidding call sites (e.g.
 * a hypothetical safe-list helper that refuses to swallow pagination).
 */
export class CursorRequiredError extends StorageError {
  readonly prefix: string;
  readonly returnedCount: number;

  constructor(prefix: string, returnedCount: number) {
    super(
      `r2List(${prefix}) returned ${returnedCount} objects with truncated=true. Caller must walk cursor.`,
      "Use R2Adapter.listAll(prefix) to walk the cursor automatically, or pass opts.cursor to the next list call.",
    );
    this.name = "CursorRequiredError";
    this.prefix = prefix;
    this.returnedCount = returnedCount;
  }
}

// ═══════════════════════════════════════════════════════════════════
// §4 — StorageNotConnectedError
// ═══════════════════════════════════════════════════════════════════

/**
 * Thrown by `NullStorageAdapter` and by `ReferenceBackend` when the
 * concrete binding has not been wired up yet. Retained as a typed
 * replacement for the plain `Error("…not connected")` used pre-v2.
 */
export class StorageNotConnectedError extends StorageError {
  readonly operation: string;
  readonly adapter: string;

  constructor(operation: string, adapter: string) {
    super(`${adapter}: ${operation} not connected`);
    this.name = "StorageNotConnectedError";
    this.operation = operation;
    this.adapter = adapter;
  }
}
