// HP7 P2-01 — checkpoint diff projector.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.8 HP7
//   * docs/design/hero-to-pro/HP7-checkpoint-revert.md §7 F2
//   * workers/orchestrator-core/migrations/013-product-checkpoints.sql
//
// HP4 first wave already provides `readCheckpointDiff` returning
// message + supersede deltas. HP7 P2 extends the diff to also explain
// workspace temp file delta + promoted artifact delta against the
// captured `message_high_watermark`. The projector is read-only and
// non-mutating; it is consumed by `GET /checkpoints/{id}/diff` and by
// the restore executor before it asks for HP5 confirmation.

export interface CheckpointDiffWorkspaceFileDelta {
  readonly virtual_path: string;
  readonly change: "added" | "removed" | "changed";
  readonly current_size_bytes: number | null;
  readonly current_content_hash: string | null;
  readonly current_temp_file_uuid: string | null;
}

export interface CheckpointDiffArtifactDelta {
  readonly file_uuid: string;
  readonly change: "added" | "removed" | "changed";
  readonly mime: string | null;
  readonly source_workspace_path: string | null;
  readonly provenance_kind: string | null;
}

export interface CheckpointDiffWorkspaceProjection {
  readonly checkpoint_uuid: string;
  readonly current_workspace_count: number;
  readonly snapshot_workspace_count: number;
  readonly workspace_files: ReadonlyArray<CheckpointDiffWorkspaceFileDelta>;
  readonly artifacts: ReadonlyArray<CheckpointDiffArtifactDelta>;
}

export class CheckpointDiffProjector {
  constructor(private readonly db: D1Database) {}

  /**
   * Compose the full HP7 diff for a checkpoint:
   *   - workspace file delta: current `nano_session_temp_files` for the
   *     session vs. the captured snapshot rows under
   *     `nano_checkpoint_file_snapshots(checkpoint_uuid=?)`.
   *   - artifact delta: artifacts created AFTER the checkpoint's
   *     `message_high_watermark.created_at` are reported as `added`;
   *     artifacts with a `source_workspace_path` that exists in the
   *     snapshot but no longer in current temp files are reported as
   *     `changed`.
   *
   * The projector returns `null` when the checkpoint does not exist;
   * callers are expected to gate on existence via the lifecycle repo.
   */
  async project(input: {
    readonly session_uuid: string;
    readonly checkpoint_uuid: string;
  }): Promise<CheckpointDiffWorkspaceProjection | null> {
    const checkpoint = await this.db
      .prepare(
        `SELECT
           checkpoint_uuid, file_snapshot_status, message_high_watermark
         FROM nano_session_checkpoints
         WHERE checkpoint_uuid = ?1
           AND session_uuid = ?2
         LIMIT 1`,
      )
      .bind(input.checkpoint_uuid, input.session_uuid)
      .first<Record<string, unknown>>();
    if (!checkpoint) return null;

    const snapshotRows = await this.db
      .prepare(
        `SELECT virtual_path, content_hash, size_bytes,
                source_temp_file_uuid, source_artifact_file_uuid
         FROM nano_checkpoint_file_snapshots
         WHERE checkpoint_uuid = ?1
           AND snapshot_status IN ('materialized', 'copied_to_fork')`,
      )
      .bind(input.checkpoint_uuid)
      .all<Record<string, unknown>>();

    const currentRows = await this.db
      .prepare(
        `SELECT temp_file_uuid, virtual_path, content_hash, size_bytes
         FROM nano_session_temp_files
         WHERE session_uuid = ?1`,
      )
      .bind(input.session_uuid)
      .all<Record<string, unknown>>();

    const snapshotByPath = new Map<string, Record<string, unknown>>();
    for (const r of snapshotRows.results ?? []) {
      snapshotByPath.set(String(r.virtual_path), r);
    }
    const currentByPath = new Map<string, Record<string, unknown>>();
    for (const r of currentRows.results ?? []) {
      currentByPath.set(String(r.virtual_path), r);
    }

    const workspaceFiles: CheckpointDiffWorkspaceFileDelta[] = [];
    for (const [path, current] of currentByPath) {
      const snap = snapshotByPath.get(path);
      if (!snap) {
        workspaceFiles.push({
          virtual_path: path,
          change: "added",
          current_size_bytes: toNumber(current.size_bytes),
          current_content_hash: toNullableString(current.content_hash),
          current_temp_file_uuid: toNullableString(current.temp_file_uuid),
        });
        continue;
      }
      const currentHash = toNullableString(current.content_hash);
      const snapHash = toNullableString(snap.content_hash);
      if (currentHash !== snapHash) {
        workspaceFiles.push({
          virtual_path: path,
          change: "changed",
          current_size_bytes: toNumber(current.size_bytes),
          current_content_hash: currentHash,
          current_temp_file_uuid: toNullableString(current.temp_file_uuid),
        });
      }
    }
    for (const [path] of snapshotByPath) {
      if (!currentByPath.has(path)) {
        workspaceFiles.push({
          virtual_path: path,
          change: "removed",
          current_size_bytes: null,
          current_content_hash: null,
          current_temp_file_uuid: null,
        });
      }
    }

    // Artifact delta — only well-defined when the checkpoint captured a
    // message_high_watermark we can resolve to a created_at. If the
    // watermark message was already pruned, we report an empty artifact
    // delta rather than guessing.
    const watermark = toNullableString(checkpoint.message_high_watermark);
    let artifacts: CheckpointDiffArtifactDelta[] = [];
    if (watermark) {
      const watermarkRow = await this.db
        .prepare(
          `SELECT created_at FROM nano_conversation_messages
            WHERE message_uuid = ?1
            LIMIT 1`,
        )
        .bind(watermark)
        .first<{ created_at?: string }>();
      const watermarkAt = watermarkRow?.created_at ?? null;
      if (watermarkAt) {
        const addedRows = await this.db
          .prepare(
            `SELECT file_uuid, mime, source_workspace_path, provenance_kind, created_at
             FROM nano_session_files
             WHERE session_uuid = ?1
               AND created_at > ?2`,
          )
          .bind(input.session_uuid, watermarkAt)
          .all<Record<string, unknown>>();
        artifacts = (addedRows.results ?? []).map((r) => ({
          file_uuid: String(r.file_uuid),
          change: "added" as const,
          mime: toNullableString(r.mime),
          source_workspace_path: toNullableString(r.source_workspace_path),
          provenance_kind: toNullableString(r.provenance_kind),
        }));
      }
    }

    return {
      checkpoint_uuid: input.checkpoint_uuid,
      current_workspace_count: currentByPath.size,
      snapshot_workspace_count: snapshotByPath.size,
      workspace_files: workspaceFiles,
      artifacts,
    };
  }
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}
