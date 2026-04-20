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
import type { ContextLayer } from "@nano-agent/workspace-context-artifacts";
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

    // Step 1 — size-route the summary OUTSIDE the tx
    let summarySerialized: Awaited<
      ReturnType<VersionHistory["prepareSerialized"]>
    >;
    try {
      summarySerialized = await this.versionHistory.prepareSerialized({
        version: candidate.snapshotVersion + 1,
        payload: prepared.text,
      });
    } catch (err) {
      return {
        kind: "failed",
        error: `committer: summary preflight failed: ${describeError(err)}`,
      };
    }

    try {
      await this.doStorage.transaction(async (tx) => {
        // Step 3 — read current context inside tx
        const current =
          (await tx.get<PersistedContext>(this.contextKey)) ?? null;
        const currentVersion = current?.version ?? 0;

        // Step 5 — snapshot the pre-swap context (only when one exists)
        if (current) {
          const snapshotPayload = JSON.stringify(current);
          // Size-route the snapshot too — but inside the tx we only
          // know how to write the inline pointer; R2 promotion would
          // need to happen out-of-tx. The committer's contract is:
          // **callers MUST configure R2 when their summaries / past
          // contexts can exceed the DO cap**. If R2 is missing AND the
          // payload exceeds the cap, prepareSerialized throws.
          const snapshotSerialized = await this.versionHistory.prepareSerialized({
            version: currentVersion,
            payload: snapshotPayload,
          });
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
      // The DO tx rolled back. Best-effort R2 cleanup for any blob we
      // pushed out-of-tx — orphan R2 objects are non-fatal but we
      // should not silently leak them when we know the swap aborted.
      if (summarySerialized.storage === "r2" && summarySerialized.r2Key && this.r2) {
        try {
          await this.r2.delete(summarySerialized.r2Key);
        } catch (cleanupErr) {
          console.warn(
            `committer: R2 cleanup of ${summarySerialized.r2Key} failed after tx rollback:`,
            cleanupErr,
          );
        }
      }
      return {
        kind: "failed",
        error: `committer: tx aborted: ${describeError(err)}`,
      };
    }

    return {
      kind: "committed",
      oldVersion: candidate.snapshotVersion,
      newVersion: candidate.snapshotVersion + 1,
      summary: {
        storage: summarySerialized.storage,
        storageKey: summarySerialized.storageKey,
        sizeBytes: summarySerialized.sizeBytes,
      },
    };
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
