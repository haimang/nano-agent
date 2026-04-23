/**
 * Workspace Context Artifacts — Reference Backend
 *
 * Routes workspace file operations to durable storage adapters from
 * `@nano-agent/storage-topology` (B2 — after-foundations Phase 1).
 *
 * Two operating modes:
 *   1. **Connected** — caller supplies a `DOStorageAdapter` (and
 *      optionally an `R2Adapter`) at construction time. Reads/writes
 *      route to durable storage; oversized writes are routed to R2 if
 *      the optional R2 backing is present, otherwise the call rejects
 *      with `ValueTooLargeError` from the underlying adapter.
 *   2. **Not connected** — no adapter is supplied. Every method throws
 *      `StorageNotConnectedError` (the typed replacement for the
 *      pre-v2 plain `Error("not connected")`). This preserves the
 *      placeholder semantics for code paths that have not yet wired
 *      durable storage but want to keep the seam.
 *
 * **Source findings**:
 *   - F04 + F05 (DO storage transactional + parity)
 *   - F08 (1 MiB-ish DO size cap, R2 promotion strategy)
 *   - unexpected-F01 (R2 per-call latency motivation for `putParallel`)
 *
 * Tenant prefixing is the caller's responsibility — pass already-tenant-
 * prefixed paths (`tenants/{teamUuid}/…`). The connected backend does
 * NOT re-apply tenant scoping; it simply forwards keys through to the
 * adapter. Higher layers (e.g. `WorkspaceNamespace`) are the right
 * place for tenant-aware path composition.
 */

import {
  DOStorageAdapter,
  R2Adapter,
  StorageNotConnectedError,
  ValueTooLargeError,
} from "../storage/index.js";
import type { WorkspaceBackend } from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Config
// ═══════════════════════════════════════════════════════════════════

/**
 * Stored entry shape inside DO storage. Wrapping the file content in
 * a small envelope lets us track `modifiedAt` and detect promotion
 * pointers without conflating with raw payload bytes.
 */
interface DoEntry {
  readonly kind: "inline" | "promoted";
  readonly modifiedAt: string;
  readonly size: number;
  /** Inline content (kind === "inline"). */
  readonly content?: string;
  /** R2 key (kind === "promoted"). */
  readonly r2Key?: string;
}

export interface ReferenceBackendConfig {
  /**
   * Required for connected mode. Routes inline reads/writes to DO
   * storage and enforces the F08 size pre-check. If omitted, the
   * backend operates in not-connected mode (every method throws
   * `StorageNotConnectedError`).
   */
  readonly doStorage?: DOStorageAdapter;
  /**
   * Optional R2 backing. When supplied, writes whose byte length
   * exceeds `doStorage.maxValueBytes` are promoted to R2 and DO stores
   * a `{ kind: "promoted", r2Key }` pointer instead of the inline
   * payload. This implements the F08 ladder ("> DO cap → R2") at the
   * backend layer so callers do not have to size-route manually.
   */
  readonly r2?: R2Adapter;
  /**
   * Prefix prepended to every R2 key when promoting from DO. Keeps
   * promoted blobs grouped under a recognizable namespace. Defaults to
   * `"workspace/"`. Caller is responsible for adding any tenant prefix
   * upstream (this backend is tenant-agnostic).
   */
  readonly r2KeyPrefix?: string;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — ReferenceBackend
// ═══════════════════════════════════════════════════════════════════

export class ReferenceBackend implements WorkspaceBackend {
  private readonly doStorage?: DOStorageAdapter;
  private readonly r2?: R2Adapter;
  private readonly r2KeyPrefix: string;
  // First-wave P4 posture keeps filesystem/storage host-local by default,
  // so "not connected" remains the canonical zero-config state here.
  private readonly connected: boolean;

  constructor(config?: ReferenceBackendConfig) {
    this.doStorage = config?.doStorage;
    this.r2 = config?.r2;
    this.r2KeyPrefix = config?.r2KeyPrefix ?? "workspace/";
    this.connected = this.doStorage !== undefined;
  }

  /** Returns `true` when a `DOStorageAdapter` was supplied. */
  isConnected(): boolean {
    return this.connected;
  }

  async read(relativePath: string): Promise<string | null> {
    const doStorage = this.requireConnected("read");
    const key = this.normalize(relativePath);
    const entry = await doStorage.get<DoEntry>(key);
    if (!entry) return null;
    if (entry.kind === "inline") return entry.content ?? null;
    // Promoted: read from R2
    if (!this.r2 || !entry.r2Key) {
      throw new StorageNotConnectedError("read (promoted)", "ReferenceBackend");
    }
    const obj = await this.r2.get(entry.r2Key);
    if (!obj) return null;
    return obj.text();
  }

  async write(relativePath: string, content: string): Promise<void> {
    const doStorage = this.requireConnected("write");
    const key = this.normalize(relativePath);
    const bytes = new TextEncoder().encode(content).byteLength;
    const modifiedAt = new Date().toISOString();

    if (bytes <= doStorage.maxValueBytes) {
      const entry: DoEntry = { kind: "inline", modifiedAt, size: bytes, content };
      await doStorage.put(key, entry);
      return;
    }

    // Oversized — promote to R2 if available
    if (!this.r2) {
      // No R2 backing — surface the same ValueTooLargeError shape as DO would.
      throw new ValueTooLargeError(bytes, doStorage.maxValueBytes, "do");
    }
    const r2Key = `${this.r2KeyPrefix}${key}`;
    await this.r2.put(r2Key, content);
    const entry: DoEntry = { kind: "promoted", modifiedAt, size: bytes, r2Key };
    await doStorage.put(key, entry);
  }

  async list(
    relativePath: string,
  ): Promise<Array<{ name: string; size: number }>> {
    const doStorage = this.requireConnected("list");
    const prefix = this.normalize(relativePath);
    const dirPrefix = prefix === "" ? "" : prefix + "/";
    const all = await doStorage.list<DoEntry>({ prefix: dirPrefix });

    const seen = new Set<string>();
    const results: Array<{ name: string; size: number }> = [];

    for (const [storedKey, entry] of all) {
      const remainder =
        prefix === "" ? storedKey : storedKey.slice(dirPrefix.length);
      if (remainder === "") continue;

      const slashIdx = remainder.indexOf("/");
      const childName = slashIdx === -1 ? remainder : remainder.slice(0, slashIdx);
      if (seen.has(childName)) continue;
      seen.add(childName);

      const size = slashIdx === -1 ? entry.size : 0;
      results.push({ name: childName, size });
    }
    return results;
  }

  async stat(
    relativePath: string,
  ): Promise<{ size: number; modifiedAt: string } | null> {
    const doStorage = this.requireConnected("stat");
    const key = this.normalize(relativePath);
    const entry = await doStorage.get<DoEntry>(key);
    if (!entry) return null;
    return { size: entry.size, modifiedAt: entry.modifiedAt };
  }

  async delete(relativePath: string): Promise<boolean> {
    const doStorage = this.requireConnected("delete");
    const key = this.normalize(relativePath);
    const entry = await doStorage.get<DoEntry>(key);
    if (!entry) return false;
    if (entry.kind === "promoted" && entry.r2Key && this.r2) {
      // Best-effort R2 cleanup — DO entry is the source of truth, so we
      // delete it even if R2 cleanup fails.
      try {
        await this.r2.delete(entry.r2Key);
      } catch (err) {
        console.warn(
          `ReferenceBackend.delete: R2 cleanup of ${entry.r2Key} failed:`,
          err,
        );
      }
    }
    return doStorage.delete(key);
  }

  // ── Internals ──

  private requireConnected(op: string): DOStorageAdapter {
    if (!this.doStorage) {
      throw new StorageNotConnectedError(op, "ReferenceBackend");
    }
    return this.doStorage;
  }

  private normalize(path: string): string {
    return path
      .replace(/\/+/g, "/")
      .replace(/^\//, "")
      .replace(/\/$/, "");
  }
}
