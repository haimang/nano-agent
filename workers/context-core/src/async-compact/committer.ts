import { createLogger } from "@haimang/nacp-core/logger";

const logger = createLogger("context-core");

/**
 * Context-Management — async-compact CompactionCommitter.
 *
 * The committer performs the atomic context swap. Per
 * `PX-async-compact-lifecycle-spec.md §5` and B1 findings F04 / F06 /
 * F08:
 *
 *   1. Size-route the new summary (DO inline ≤ cap, otherwise R2)
 *      OUTSIDE the DO transaction. `DOStorageAdapter.transaction()`
 *      does NOT auto-apply `maxValueBytes` inside the callback (B2
 *      GPT review caveat) — the committer therefore owns the
 *      preflight.
 *   2. Read the current context inside `state.storage.transaction()`.
 *   3. Diff-aware merge: any messages added during PREPARE phase are
 *      preserved AFTER the new summary block.
 *   4. Snapshot the previous version into `version-history`.
 *   5. Atomic write of the new context.
 *   6. Delete `compact-state:{sessionUuid}` so the singleton invariant
 *      (PX spec §2.1) reopens.
 *
 * NOTE on D1: F06 explicitly rejects D1 BEGIN/COMMIT. The committer
 * MUST NOT call any D1 multi-statement primitive — only DO storage
 * `state.storage.transaction()` is valid (per F04).
 */

import type {
  DOStorageAdapter,
  R2Adapter,
} from "@nano-agent/storage-topology";
import type { ContextLayer } from "../context-layers.js";
import type {
  CommitOutcome,
  ContextCandidate,
  PreparedSummary,
} from "./types.js";
import { VersionHistory } from "./version-history.js";

/** Persisted shape of a committed context. */
export interface PersistedContext {
  readonly version: number;
  readonly committedAt: string;
  /** Layers AFTER the swap — summary block + carried-forward fresh layers. */
  readonly layers: readonly ContextLayer[];
  /** Reference to the summary blob (inline or R2). */
  readonly summary: {
    readonly storage: "do" | "r2";
    readonly storageKey: string;
    readonly sizeBytes: number;
  };
}

export interface CompactionCommitterConfig {
  readonly sessionUuid: string;
  readonly doStorage: DOStorageAdapter;
  readonly r2?: R2Adapter;
  /** DO key for the live context. Default `context:{sessionUuid}`. */
  readonly contextKey?: string;
  /** DO key for the active compact state. Default `compact-state:{sessionUuid}`. */
  readonly compactStateKey?: string;
  /** Override clock for deterministic tests. */
  readonly nowIso?: () => string;
  /** Override version-history (tests inject fakes). */
  readonly versionHistory?: VersionHistory;
}

export class CompactionCommitter {
  private readonly sessionUuid: string;
  private readonly doStorage: DOStorageAdapter;
  private readonly r2?: R2Adapter;
  private readonly contextKey: string;
  private readonly compactStateKey: string;
  private readonly nowIso: () => string;
  private readonly versionHistory: VersionHistory;

  constructor(config: CompactionCommitterConfig) {
    this.sessionUuid = config.sessionUuid;
    this.doStorage = config.doStorage;
    this.r2 = config.r2;
    this.contextKey = config.contextKey ?? `context:${config.sessionUuid}`;
    this.compactStateKey =
      config.compactStateKey ?? `compact-state:${config.sessionUuid}`;
    this.nowIso = config.nowIso ?? (() => new Date().toISOString());
    this.versionHistory =
      config.versionHistory ??
      new VersionHistory({
        sessionUuid: config.sessionUuid,
        doStorage: config.doStorage,
        r2: config.r2,
        nowIso: config.nowIso,
      });
  }

  /**
   * Atomic swap of the live context with the prepared summary.
   *
   * Algorithm (the comments mirror the inline numbered steps):
   *   1. Size-route OUTSIDE the tx (R2 promotion is non-transactional).
   *   2. Open `state.storage.transaction()`.
   *   3. Read the live context inside the tx (may have advanced).
   *   4. Build the new layers: summary block + fresh layers added
   *      after `candidate.snapshotVersion`.
   *   5. Snapshot the pre-swap context as `version-{N-1}` (also size-
   *      routed; the inline DO record holds either payload or pointer).
   *   6. Write the new context with `version + 1`.
   *   7. Delete the compact-state record so the singleton reopens.
   */
  async commit(args: {
    candidate: ContextCandidate;
    prepared: PreparedSummary;
  }): Promise<CommitOutcome> {
    const { candidate, prepared } = args;

    // Step 1 — read live context BEFORE the tx so we can size-route
    // both the new summary AND the snapshot of the pre-swap context
    // entirely outside the transaction. Closes B4-R5 (returned
    // `oldVersion` matches the version actually being replaced) AND
    // B4-R6 (snapshot R2 promotion happens out-of-tx so the rollback
    // path can clean it up). A narrow TOCTOU window between this read
    // and the tx's read is handled by re-reading inside the tx and
    // committing the in-tx version pair to the outcome.
    const preTxCurrent = await this.doStorage.get<PersistedContext>(
      this.contextKey,
    );
    const preTxVersion = preTxCurrent?.version ?? 0;

    // Step 2a — size-route the new summary OUTSIDE the tx
    let summarySerialized: Awaited<
      ReturnType<VersionHistory["prepareSerialized"]>
    >;
    try {
      summarySerialized = await this.versionHistory.prepareSerialized({
        version: preTxVersion + 1,
        payload: prepared.text,
      });
    } catch (err) {
      return {
        kind: "failed",
        error: `committer: summary preflight failed: ${describeError(err)}`,
      };
    }

    // Step 2b — size-route the SNAPSHOT of the pre-swap context (only
    // if there is one) OUTSIDE the tx. This closes B4-R6: snapshot R2
    // promotion now happens before the tx opens, and the rollback
    // cleanup path tracks the promoted key.
    let snapshotSerialized:
      | Awaited<ReturnType<VersionHistory["prepareSerialized"]>>
      | undefined;
    if (preTxCurrent) {
      try {
        snapshotSerialized = await this.versionHistory.prepareSerialized({
          version: preTxVersion,
          payload: JSON.stringify(preTxCurrent),
        });
      } catch (err) {
        // If the snapshot's R2 promotion fails we abort honestly —
        // better than committing a context whose pre-swap version is
        // unrecoverable. Cleanup the summary R2 blob already pushed.
        await this.cleanupR2Best(summarySerialized);
        return {
          kind: "failed",
          error: `committer: snapshot preflight failed: ${describeError(err)}`,
        };
      }
    }

    // Captured inside the tx for the outcome — closes B4-R5.
    let committedOldVersion = preTxVersion;
    let committedNewVersion = preTxVersion + 1;

    try {
      await this.doStorage.transaction(async (tx) => {
        // Step 3 — read current context inside tx (TOCTOU pin)
        const current =
          (await tx.get<PersistedContext>(this.contextKey)) ?? null;
        const currentVersion = current?.version ?? 0;

        // R9 / GPT 2nd review §C.2 — TOCTOU drift detection.
        //
        // The summary R2 promotion (Step 2a) and the snapshot R2
        // promotion (Step 2b) BOTH used `preTxVersion` to derive
        // their target keys. If the live context advanced between
        // pre-tx read and tx open (a concurrent commit landed), the
        // pre-promoted keys would be wrong:
        //
        //   - `summarySerialized.storageKey = context-snapshot:s/v{preTx+1}`
        //     would point at v(preTx+1) but the actual new context
        //     would be v(currentVersion+1) ≠ v(preTx+1).
        //   - `snapshotSerialized` was the v(preTxVersion) payload
        //     but `versionHistory.doKey(currentVersion)` would write
        //     it under v(currentVersion), corrupting that snapshot.
        //
        // The cleanest fix: throw to abort the tx; the outer catch
        // already cleans up both R2 blobs; the orchestrator's
        // `recordFailure()` will mark the attempt as failed and let
        // the retry budget decide whether to re-arm. This swaps a
        // silent corruption for an honest transient failure.
        if (currentVersion !== preTxVersion) {
          throw new Error(
            `committer: pre-tx version (${preTxVersion}) drifted from in-tx version (${currentVersion}); aborting to prevent snapshot/summary key corruption (R9)`,
          );
        }
        committedOldVersion = currentVersion;
        committedNewVersion = currentVersion + 1;

        // Step 5 — write the snapshot inline pointer (heavy R2 payload
        // was already promoted in Step 2b). Now safe because
        // currentVersion === preTxVersion.
        if (snapshotSerialized && current) {
          const inlineRecord =
            this.versionHistory.buildInlineRecord(snapshotSerialized);
          await tx.put(
            this.versionHistory.doKey(currentVersion),
            inlineRecord,
          );
        }

        // Step 4 — diff-aware merge
        // For B4 the canonical merge is: take the candidate's layers
        // (which already contain the snapshot-time view) and add the
        // summary block at the front of the recent_transcript layers.
        // Fresh messages from `current` (added during prepare) are
        // appended after, so they are not lost.
        const summaryLayer: ContextLayer = {
          kind: "workspace_summary",
          priority: 0,
          content: prepared.text,
          tokenEstimate: estimateTokens(prepared.text),
          required: true,
        };
        const freshLayers: ContextLayer[] = [];
        if (current && current.layers) {
          for (const layer of current.layers) {
            if (
              layer.kind === "recent_transcript" &&
              !candidate.layers.some(
                (cand) =>
                  cand.kind === layer.kind && cand.content === layer.content,
              )
            ) {
              freshLayers.push(layer);
            }
          }
        }

        const newLayers: ContextLayer[] = [
          ...candidate.layers.filter((l) => l.kind !== "workspace_summary"),
          summaryLayer,
          ...freshLayers,
        ];

        const persisted: PersistedContext = {
          version: currentVersion + 1,
          committedAt: this.nowIso(),
          layers: newLayers,
          summary: {
            storage: summarySerialized.storage,
            storageKey: summarySerialized.storageKey,
            sizeBytes: summarySerialized.sizeBytes,
          },
        };

        // Step 6 — atomic write of new context
        await tx.put(this.contextKey, persisted);

        // Step 7 — clear active compact state
        await tx.delete(this.compactStateKey);
      });
    } catch (err) {
      // B4-R6 cleanup — both summary AND snapshot R2 blobs may have
      // been pushed out-of-tx; clean both on rollback.
      await this.cleanupR2Best(summarySerialized);
      await this.cleanupR2Best(snapshotSerialized);
      return {
        kind: "failed",
        error: `committer: tx aborted: ${describeError(err)}`,
      };
    }

    return {
      kind: "committed",
      // B4-R5 — versions reflect the in-tx truth.
      oldVersion: committedOldVersion,
      newVersion: committedNewVersion,
      summary: {
        storage: summarySerialized.storage,
        storageKey: summarySerialized.storageKey,
        sizeBytes: summarySerialized.sizeBytes,
      },
    };
  }

  /** Best-effort R2 cleanup for tx-rollback paths (B4-R6). */
  private async cleanupR2Best(
    serialized:
      | Awaited<ReturnType<VersionHistory["prepareSerialized"]>>
      | undefined,
  ): Promise<void> {
    if (!serialized || serialized.storage !== "r2" || !serialized.r2Key) return;
    if (!this.r2) return;
    try {
      await this.r2.delete(serialized.r2Key);
    } catch (cleanupErr) {
      logger.warn("async-compact-r2-cleanup-failed", {
        code: "internal-error",
        ctx: {
          r2_key: serialized.r2Key,
          error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        },
      });
    }
  }

  /** Read the current persisted context (e.g. for inspector queries). */
  async readPersisted(): Promise<PersistedContext | undefined> {
    return this.doStorage.get<PersistedContext>(this.contextKey);
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function estimateTokens(text: string): number {
  // Cheap heuristic: ~4 chars / token average. Matches the
  // `workspace-context-artifacts` assembler convention; the assembler
  // is the source of truth and will recompute on next assemble().
  return Math.max(1, Math.ceil(text.length / 4));
}
