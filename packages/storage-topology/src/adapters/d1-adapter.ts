/**
 * Storage Topology — D1Adapter
 *
 * Per-binding wrapper around a Cloudflare D1 database.
 *
 * Source finding (B1 Round 1 real Cloudflare probe):
 *   - F06 (`docs/spikes/spike-do-storage/06-…`): D1 explicitly REJECTS
 *     SQL `BEGIN TRANSACTION` (error redirect to
 *     `state.storage.transaction()`). Cross-statement atomicity is only
 *     possible via `db.batch([…])`. Failing batch survivors confirmed
 *     `survivingRows = []`.
 *
 * Therefore this adapter intentionally exposes **only**:
 *   - `query(sql, …params)` — single statement
 *   - `batch(statements)` — atomic group
 *
 * It does NOT expose `beginTransaction()` / `commit()` / `rollback()`.
 * Any "read-then-conditional-write" pattern must either be folded into
 * a single batch or moved to DO storage transactional semantics
 * (`DOStorageAdapter.transaction`).
 */

// ═══════════════════════════════════════════════════════════════════
// §1 — Decoupled D1 binding types
// ═══════════════════════════════════════════════════════════════════

/** Subset of Cloudflare's `D1Result` exposed by this adapter. */
export interface D1ResultLike<T = Record<string, unknown>> {
  readonly results: T[];
  readonly success: boolean;
  readonly meta?: Record<string, unknown>;
  readonly error?: string;
}

/**
 * Subset of Cloudflare's `D1PreparedStatement`. Only the methods used
 * by this adapter are typed; runtime statements support more.
 */
export interface D1PreparedStatementLike {
  bind(...params: unknown[]): D1PreparedStatementLike;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  run(): Promise<D1ResultLike>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

/**
 * Minimal D1 binding — structurally compatible with Cloudflare's
 * `D1Database`. Does NOT type `exec()` (raw multi-statement) because
 * exposing it would defeat the F06 batch-only contract.
 */
export interface D1DatabaseBinding {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatementLike[],
  ): Promise<D1ResultLike<T>[]>;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — D1Adapter
// ═══════════════════════════════════════════════════════════════════

/**
 * Production-shaped wrapper around a D1 database binding.
 *
 * Cap is `Infinity` because D1 row-size limits live inside SQLite, not
 * at the adapter layer; the value is exposed for symmetry with the
 * other adapters and to let callers branch on "no per-value cap".
 */
export class D1Adapter {
  /** D1 has no adapter-level value cap; row size is bounded by SQLite. */
  readonly maxValueBytes: number = Number.POSITIVE_INFINITY;

  private readonly db: D1DatabaseBinding;

  constructor(db: D1DatabaseBinding) {
    this.db = db;
  }

  /**
   * Single-statement query. Binds parameters via prepared statements
   * to prevent SQL injection.
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    ...params: unknown[]
  ): Promise<D1ResultLike<T>> {
    const stmt = this.db.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    return bound.all<T>();
  }

  /**
   * Single-statement query that returns the first row (or `null`).
   * Convenience wrapper over `prepare(...).first()`.
   */
  async first<T = Record<string, unknown>>(
    sql: string,
    ...params: unknown[]
  ): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    return bound.first<T>();
  }

  /**
   * Atomic batch — entire group commits or rolls back together.
   * Per F06: this is the ONLY cross-statement atomicity primitive
   * available in D1. The caller MUST pre-bind each statement before
   * passing it in.
   */
  async batch<T = Record<string, unknown>>(
    statements: D1PreparedStatementLike[],
  ): Promise<D1ResultLike<T>[]> {
    return this.db.batch<T>(statements);
  }

  /**
   * Expose `prepare` so callers can build batched statements with
   * bound parameters before passing them to `batch()`. Direct
   * `prepare().run()` outside a batch is permitted but reverts to
   * single-statement semantics.
   */
  prepare(sql: string): D1PreparedStatementLike {
    return this.db.prepare(sql);
  }

  // INTENTIONALLY NOT EXPOSED (per F06):
  //   beginTransaction() — D1 rejects `BEGIN TRANSACTION`
  //   commit()           — no transactional commit primitive
  //   rollback()         — no transactional rollback primitive
  //   exec()             — raw multi-statement bypass; would defeat batch-only contract
}
