/**
 * Context-Management — async-compact VersionHistory.
 *
 * Versioned snapshot persistence for user rollback. Per
 * `PX-async-compact-lifecycle-spec.md §4.3`:
 *   - After every successful COMMIT, the previous (pre-swap) context
 *     is preserved as `version-{N-1}`.
 *   - Snapshots are size-routed exactly like the summary itself: ≤
 *     `DOStorageAdapter.maxValueBytes` → DO inline, otherwise R2.
 *   - The committer's outer `state.storage.transaction()` rolls back
 *     the DO write on failure; R2 cleanup is best-effort because R2
 *     does not participate in the transaction.
 *
 * `VersionHistory` does NOT own the transaction — it exposes pure
 * builders the committer composes. This keeps the snapshot wiring
 * testable without spinning up a fake DO.
 */

import type {
  DOStorageAdapter,
  R2Adapter,
} from "@nano-agent/storage-topology";
import type { SnapshotMetadata } from "./types.js";

const TEXT_ENCODER = new TextEncoder();

export interface VersionHistoryConfig {
  readonly sessionUuid: string;
  readonly doStorage: DOStorageAdapter;
  readonly r2?: R2Adapter;
  /** R2 key prefix for promoted snapshot blobs. Default `context-snapshot/`. */
  readonly r2KeyPrefix?: string;
  /** Override clock for deterministic tests. */
  readonly nowIso?: () => string;
}

export interface SerializedSnapshot {
  /** Inline-stored snapshot pointer when `storage === "do"`. */
  readonly storage: "do" | "r2";
  /** DO key OR R2 key (both share the per-session prefix). */
  readonly storageKey: string;
  /** Pre-encoded payload bytes. */
  readonly sizeBytes: number;
  /** Inline payload (only set for `storage === "do"`). */
  readonly inline?: string;
  /** R2 key when promoted (only set for `storage === "r2"`). */
  readonly r2Key?: string;
}

/**
 * Pure helpers — do not touch storage. The committer interleaves these
 * with `doStorage.transaction()` (DO writes) and out-of-tx `r2.put()`
 * (promotion) so size-routing happens BEFORE the tx opens.
 *
 * The split exists because `DOStorageAdapter.transaction()` does NOT
 * apply `maxValueBytes` pre-check inside the callback (B2 GPT review
 * finding) — the committer therefore decides storage tier first, then
 * runs a tx whose payload is already guaranteed to fit.
 */
export class VersionHistory {
  private readonly sessionUuid: string;
  private readonly doStorage: DOStorageAdapter;
  private readonly r2?: R2Adapter;
  private readonly r2KeyPrefix: string;
  private readonly nowIso: () => string;

  constructor(config: VersionHistoryConfig) {
    this.sessionUuid = config.sessionUuid;
    this.doStorage = config.doStorage;
    this.r2 = config.r2;
    this.r2KeyPrefix = config.r2KeyPrefix ?? "context-snapshot/";
    this.nowIso = config.nowIso ?? (() => new Date().toISOString());
  }

  /** DO storage key for a given snapshot version. */
  doKey(version: number): string {
    return `context-snapshot:${this.sessionUuid}:v${version}`;
  }

  /** R2 key for a promoted snapshot blob. */
  r2Key(version: number): string {
    return `${this.r2KeyPrefix}${this.sessionUuid}/v${version}`;
  }

  /**
   * Decide whether `payload` fits in DO inline storage and, if not,
   * promote it to R2. Runs OUTSIDE the committer's DO transaction
   * because R2 is non-transactional and the size-check must happen
   * before the tx opens (per the GPT-reviewed B2 caveat: tx callbacks
   * do NOT auto-apply `maxValueBytes`).
   *
   * Returns the serialized form the committer should write to DO.
   */
  async prepareSerialized(args: {
    version: number;
    payload: string;
  }): Promise<SerializedSnapshot> {
    const sizeBytes = TEXT_ENCODER.encode(args.payload).byteLength;
    if (sizeBytes <= this.doStorage.maxValueBytes) {
      return {
        storage: "do",
        storageKey: this.doKey(args.version),
        sizeBytes,
        inline: args.payload,
      };
    }
    if (!this.r2) {
      throw new Error(
        `VersionHistory: snapshot ${args.version} is ${sizeBytes} bytes (> DO cap ${this.doStorage.maxValueBytes}) but no R2 adapter is configured for promotion`,
      );
    }
    const r2Key = this.r2Key(args.version);
    await this.r2.put(r2Key, args.payload);
    return {
      storage: "r2",
      storageKey: this.doKey(args.version),
      sizeBytes,
      r2Key,
    };
  }

  /**
   * Build the inline DO record the committer writes inside the tx.
   * For inline storage the record holds the payload; for promoted
   * storage it holds an R2 key pointer.
   */
  buildInlineRecord(serialized: SerializedSnapshot): {
    storage: "do" | "r2";
    sizeBytes: number;
    inline?: string;
    r2Key?: string;
    createdAt: string;
  } {
    return {
      storage: serialized.storage,
      sizeBytes: serialized.sizeBytes,
      inline: serialized.inline,
      r2Key: serialized.r2Key,
      createdAt: this.nowIso(),
    };
  }

  /**
   * Build a `SnapshotMetadata` row for the inspector facade.
   */
  describe(args: {
    serialized: SerializedSnapshot;
    version: number;
    reason: SnapshotMetadata["reason"];
  }): SnapshotMetadata {
    return {
      snapshotId: `${this.sessionUuid}-v${args.version}`,
      version: args.version,
      createdAt: this.nowIso(),
      reason: args.reason,
      sizeBytes: args.serialized.sizeBytes,
      storage: args.serialized.storage,
      storageKey: args.serialized.storageKey,
    };
  }

  /** List existing snapshots (DO-side; R2 promoted snapshots are
   * still indexed via DO pointers, so this single read suffices). */
  async listAll(): Promise<SnapshotMetadata[]> {
    const prefix = `context-snapshot:${this.sessionUuid}:v`;
    const entries = await this.doStorage.list<{
      storage: "do" | "r2";
      sizeBytes: number;
      r2Key?: string;
      createdAt: string;
      reason?: SnapshotMetadata["reason"];
    }>({ prefix });
    const out: SnapshotMetadata[] = [];
    for (const [key, record] of entries) {
      const versionRaw = key.slice(prefix.length);
      const version = Number.parseInt(versionRaw, 10);
      if (!Number.isFinite(version)) continue;
      out.push({
        snapshotId: `${this.sessionUuid}-v${version}`,
        version,
        createdAt: record.createdAt,
        reason: record.reason ?? "pre-compact",
        sizeBytes: record.sizeBytes,
        storage: record.storage,
        storageKey: key,
      });
    }
    out.sort((a, b) => b.version - a.version);
    return out;
  }
}
