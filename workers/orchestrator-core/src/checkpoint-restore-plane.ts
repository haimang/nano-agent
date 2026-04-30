// HP7 — checkpoint restore plane (snapshot lineage + restore jobs + fork
// lineage). Built on the durable truth frozen by HP1 migration 013.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.8 HP7
//   * docs/design/hero-to-pro/HP7-checkpoint-revert.md §7 F1-F5
//   * docs/design/hero-to-pro/HPX-qna.md Q22-Q24
//   * workers/orchestrator-core/migrations/013-product-checkpoints.sql
//
// Frozen invariants (HP7 must NOT extend without §3 schema correction
// in HP1):
//   * checkpoint_kind ∈ { turn_end, user_named, compact_boundary, system }
//   * file_snapshot_status ∈ { none, pending, materialized, failed }
//   * snapshot_status ∈ { pending, materialized, copied_to_fork, failed }
//   * restore mode ∈ { conversation_only, files_only,
//                       conversation_and_files, fork }
//   * restore status ∈ { pending, running, succeeded, partial, failed,
//                         rolled_back }
//   * cleanup scope ∈ { session_end, explicit, checkpoint_ttl }
//     — HP1 closure §7.4: HP6 owns session_end / explicit;
//                          HP7 owns checkpoint_ttl.
//
// Frozen invariants (HP7 design level):
//   * Q22 — turn_end / system / compact_boundary auto checkpoints are
//           strictly lazy on file snapshot materialization;
//           user_named tries eager, falls back to `pending`.
//   * Q23 — fork is "same conversation, new session" (the orchestrator
//           writes target_session_uuid on the restore job rather than
//           creating a new conversation).
//   * Q24 — restore must NOT leave partial success. We seed a rollback
//           baseline `system` checkpoint BEFORE the executor steps;
//           any executor failure causes status = `rolled_back` and
//           failure_reason carries the first failing step + code.
//           Only if the rollback itself fails does status = `failed`.

export const CHECKPOINT_FILE_SNAPSHOT_STATUSES = [
  "none",
  "pending",
  "materialized",
  "failed",
] as const;
export type CheckpointFileSnapshotStatus =
  (typeof CHECKPOINT_FILE_SNAPSHOT_STATUSES)[number];

export const CHECKPOINT_SNAPSHOT_STATUSES = [
  "pending",
  "materialized",
  "copied_to_fork",
  "failed",
] as const;
export type CheckpointSnapshotStatus =
  (typeof CHECKPOINT_SNAPSHOT_STATUSES)[number];

export const RESTORE_MODES = [
  "conversation_only",
  "files_only",
  "conversation_and_files",
  "fork",
] as const;
export type RestoreMode = (typeof RESTORE_MODES)[number];

export const RESTORE_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "partial",
  "failed",
  "rolled_back",
] as const;
export type RestoreStatus = (typeof RESTORE_STATUSES)[number];

const RESTORE_TERMINAL_STATUSES = new Set<RestoreStatus>([
  "succeeded",
  "partial",
  "failed",
  "rolled_back",
]);

export interface CheckpointFileSnapshotRow {
  readonly snapshot_uuid: string;
  readonly checkpoint_uuid: string;
  readonly session_uuid: string;
  readonly team_uuid: string;
  readonly source_temp_file_uuid: string | null;
  readonly source_artifact_file_uuid: string | null;
  readonly source_r2_key: string;
  readonly snapshot_r2_key: string;
  readonly virtual_path: string;
  readonly size_bytes: number;
  readonly content_hash: string | null;
  readonly snapshot_status: CheckpointSnapshotStatus;
  readonly created_at: string;
}

export interface CheckpointRestoreJobRow {
  readonly job_uuid: string;
  readonly checkpoint_uuid: string;
  readonly session_uuid: string;
  readonly mode: RestoreMode;
  readonly target_session_uuid: string | null;
  readonly status: RestoreStatus;
  readonly confirmation_uuid: string | null;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly failure_reason: string | null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toCount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

function rowToSnapshot(row: Record<string, unknown>): CheckpointFileSnapshotRow {
  return {
    snapshot_uuid: String(row.snapshot_uuid),
    checkpoint_uuid: String(row.checkpoint_uuid),
    session_uuid: String(row.session_uuid),
    team_uuid: String(row.team_uuid),
    source_temp_file_uuid: toNullableString(row.source_temp_file_uuid),
    source_artifact_file_uuid: toNullableString(row.source_artifact_file_uuid),
    source_r2_key: String(row.source_r2_key),
    snapshot_r2_key: String(row.snapshot_r2_key),
    virtual_path: String(row.virtual_path),
    size_bytes: toCount(row.size_bytes),
    content_hash: toNullableString(row.content_hash),
    snapshot_status: String(row.snapshot_status) as CheckpointSnapshotStatus,
    created_at: String(row.created_at),
  };
}

function rowToRestoreJob(row: Record<string, unknown>): CheckpointRestoreJobRow {
  return {
    job_uuid: String(row.job_uuid),
    checkpoint_uuid: String(row.checkpoint_uuid),
    session_uuid: String(row.session_uuid),
    mode: String(row.mode) as RestoreMode,
    target_session_uuid: toNullableString(row.target_session_uuid),
    status: String(row.status) as RestoreStatus,
    confirmation_uuid: toNullableString(row.confirmation_uuid),
    started_at: toNullableString(row.started_at),
    completed_at: toNullableString(row.completed_at),
    failure_reason: toNullableString(row.failure_reason),
  };
}

/**
 * Build the canonical R2 key for a checkpoint file snapshot.
 * HP7 design §7.2 F1:
 *   `tenants/{team}/sessions/{session}/snapshots/{checkpoint_uuid}/{virtual_path}`
 *
 * Callers MUST pass an already-normalized virtual_path
 * (`normalizeVirtualPath()`) — we don't re-validate here to avoid
 * coupling, but the workspace plane validates upstream.
 */
export function buildCheckpointSnapshotR2Key(input: {
  readonly team_uuid: string;
  readonly session_uuid: string;
  readonly checkpoint_uuid: string;
  readonly virtual_path: string;
}): string {
  return `tenants/${input.team_uuid}/sessions/${input.session_uuid}/snapshots/${input.checkpoint_uuid}/${input.virtual_path}`;
}

/**
 * Build the canonical R2 key for a forked workspace file. HP7 design
 * §7.2 F4 + Q23: child session must NOT alias parent's R2 key.
 *   `tenants/{team}/sessions/{child_session}/workspace/{virtual_path}`
 */
export function buildForkWorkspaceR2Key(input: {
  readonly team_uuid: string;
  readonly child_session_uuid: string;
  readonly virtual_path: string;
}): string {
  return `tenants/${input.team_uuid}/sessions/${input.child_session_uuid}/workspace/${input.virtual_path}`;
}

export type FileSnapshotMaterializationPolicy = "lazy" | "eager_with_fallback";

/**
 * Q22 freeze: maps `checkpoint_kind` to the materialization policy.
 *
 * - turn_end / system / compact_boundary: strictly lazy → snapshot rows
 *   are NOT created until restore / fork / explicit materialize asks.
 *   Their `nano_session_checkpoints.file_snapshot_status` stays at
 *   `none` until then.
 * - user_named: tries eager — caller attempts to materialize each
 *   workspace temp file; if any single copy fails, the checkpoint
 *   moves to `pending` so a later restore retry can complete it
 *   (rather than reporting `materialized` with holes).
 */
export function fileSnapshotPolicyForKind(
  kind: string,
): FileSnapshotMaterializationPolicy {
  if (kind === "user_named") return "eager_with_fallback";
  return "lazy";
}

export class CheckpointSnapshotConstraintError extends Error {
  constructor(
    public readonly code:
      | "checkpoint-not-found"
      | "snapshot-already-materialized"
      | "invalid-status",
    message: string,
  ) {
    super(message);
    this.name = "CheckpointSnapshotConstraintError";
  }
}

export class D1CheckpointSnapshotPlane {
  constructor(private readonly db: D1Database) {}

  async list(input: {
    readonly checkpoint_uuid: string;
  }): Promise<CheckpointFileSnapshotRow[]> {
    const rows = await this.db
      .prepare(
        `SELECT
           snapshot_uuid, checkpoint_uuid, session_uuid, team_uuid,
           source_temp_file_uuid, source_artifact_file_uuid,
           source_r2_key, snapshot_r2_key, virtual_path,
           size_bytes, content_hash, snapshot_status, created_at
         FROM nano_checkpoint_file_snapshots
         WHERE checkpoint_uuid = ?1
         ORDER BY virtual_path ASC`,
      )
      .bind(input.checkpoint_uuid)
      .all<Record<string, unknown>>();
    return (rows.results ?? []).map(rowToSnapshot);
  }

  async create(input: {
    readonly checkpoint_uuid: string;
    readonly session_uuid: string;
    readonly team_uuid: string;
    readonly source_temp_file_uuid: string | null;
    readonly source_artifact_file_uuid: string | null;
    readonly source_r2_key: string;
    readonly snapshot_r2_key: string;
    readonly virtual_path: string;
    readonly size_bytes: number;
    readonly content_hash: string | null;
    readonly initial_status: CheckpointSnapshotStatus;
    readonly created_at: string;
  }): Promise<CheckpointFileSnapshotRow> {
    const snapshotUuid = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO nano_checkpoint_file_snapshots (
           snapshot_uuid, checkpoint_uuid, session_uuid, team_uuid,
           source_temp_file_uuid, source_artifact_file_uuid,
           source_r2_key, snapshot_r2_key, virtual_path,
           size_bytes, content_hash, snapshot_status, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
      )
      .bind(
        snapshotUuid,
        input.checkpoint_uuid,
        input.session_uuid,
        input.team_uuid,
        input.source_temp_file_uuid,
        input.source_artifact_file_uuid,
        input.source_r2_key,
        input.snapshot_r2_key,
        input.virtual_path,
        input.size_bytes,
        input.content_hash,
        input.initial_status,
        input.created_at,
      )
      .run();
    const row = await this.db
      .prepare(
        `SELECT
           snapshot_uuid, checkpoint_uuid, session_uuid, team_uuid,
           source_temp_file_uuid, source_artifact_file_uuid,
           source_r2_key, snapshot_r2_key, virtual_path,
           size_bytes, content_hash, snapshot_status, created_at
         FROM nano_checkpoint_file_snapshots
         WHERE snapshot_uuid = ?1
         LIMIT 1`,
      )
      .bind(snapshotUuid)
      .first<Record<string, unknown>>();
    if (!row) throw new Error("snapshot row lost after insert");
    return rowToSnapshot(row);
  }

  async transitionStatus(input: {
    readonly snapshot_uuid: string;
    readonly status: CheckpointSnapshotStatus;
  }): Promise<CheckpointFileSnapshotRow | null> {
    if (!CHECKPOINT_SNAPSHOT_STATUSES.includes(input.status)) {
      throw new CheckpointSnapshotConstraintError(
        "invalid-status",
        `snapshot_status must be one of ${CHECKPOINT_SNAPSHOT_STATUSES.join("|")}`,
      );
    }
    await this.db
      .prepare(
        `UPDATE nano_checkpoint_file_snapshots
            SET snapshot_status = ?2
          WHERE snapshot_uuid = ?1`,
      )
      .bind(input.snapshot_uuid, input.status)
      .run();
    const row = await this.db
      .prepare(
        `SELECT
           snapshot_uuid, checkpoint_uuid, session_uuid, team_uuid,
           source_temp_file_uuid, source_artifact_file_uuid,
           source_r2_key, snapshot_r2_key, virtual_path,
           size_bytes, content_hash, snapshot_status, created_at
         FROM nano_checkpoint_file_snapshots
         WHERE snapshot_uuid = ?1
         LIMIT 1`,
      )
      .bind(input.snapshot_uuid)
      .first<Record<string, unknown>>();
    return row ? rowToSnapshot(row) : null;
  }

  /**
   * HP7 P1-01 — set `nano_session_checkpoints.file_snapshot_status`
   * after a (lazy or eager) materialization pass.
   *
   * `failed` is sticky: callers must explicitly retry by materializing
   * the missing snapshot rows; we never silently downgrade it back to
   * `pending`. `none` means "snapshot has not been requested yet"
   * — the default for turn_end / system / compact_boundary kinds.
   */
  async setCheckpointFileSnapshotStatus(input: {
    readonly checkpoint_uuid: string;
    readonly status: CheckpointFileSnapshotStatus;
  }): Promise<void> {
    if (!CHECKPOINT_FILE_SNAPSHOT_STATUSES.includes(input.status)) {
      throw new CheckpointSnapshotConstraintError(
        "invalid-status",
        `file_snapshot_status must be one of ${CHECKPOINT_FILE_SNAPSHOT_STATUSES.join("|")}`,
      );
    }
    await this.db
      .prepare(
        `UPDATE nano_session_checkpoints
            SET file_snapshot_status = ?2
          WHERE checkpoint_uuid = ?1`,
      )
      .bind(input.checkpoint_uuid, input.status)
      .run();
  }
}

export class CheckpointRestoreJobConstraintError extends Error {
  constructor(
    public readonly code:
      | "missing-confirmation"
      | "invalid-mode"
      | "invalid-status"
      | "already-terminal"
      | "job-not-found",
    message: string,
  ) {
    super(message);
    this.name = "CheckpointRestoreJobConstraintError";
  }
}

export class D1CheckpointRestoreJobs {
  constructor(private readonly db: D1Database) {}

  /**
   * HP7 P3-01 — open a pending restore / fork job. Q24: confirmation
   * is mandatory for every mode that mutates the source session
   * (`conversation_only`, `files_only`, `conversation_and_files`).
   * Fork creates a new session and is therefore allowed without a
   * fresh confirmation row in HP5 first wave; we still record the
   * confirmation_uuid when present so the audit trail stays uniform.
   */
  async openJob(input: {
    readonly checkpoint_uuid: string;
    readonly session_uuid: string;
    readonly mode: RestoreMode;
    readonly confirmation_uuid: string | null;
    readonly target_session_uuid: string | null;
  }): Promise<CheckpointRestoreJobRow> {
    if (!RESTORE_MODES.includes(input.mode)) {
      throw new CheckpointRestoreJobConstraintError(
        "invalid-mode",
        `mode must be one of ${RESTORE_MODES.join("|")}`,
      );
    }
    if (input.mode !== "fork" && !input.confirmation_uuid) {
      throw new CheckpointRestoreJobConstraintError(
        "missing-confirmation",
        "destructive restore requires a confirmation_uuid (HP5 checkpoint_restore)",
      );
    }
    const jobUuid = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO nano_checkpoint_restore_jobs (
           job_uuid, checkpoint_uuid, session_uuid, mode,
           target_session_uuid, status, confirmation_uuid,
           started_at, completed_at, failure_reason
         ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, NULL, NULL, NULL)`,
      )
      .bind(
        jobUuid,
        input.checkpoint_uuid,
        input.session_uuid,
        input.mode,
        input.target_session_uuid,
        input.confirmation_uuid,
      )
      .run();
    const row = await this.read({ job_uuid: jobUuid });
    if (!row) throw new Error("restore job row lost after insert");
    return row;
  }

  async read(input: {
    readonly job_uuid: string;
  }): Promise<CheckpointRestoreJobRow | null> {
    const row = await this.db
      .prepare(
        `SELECT
           job_uuid, checkpoint_uuid, session_uuid, mode,
           target_session_uuid, status, confirmation_uuid,
           started_at, completed_at, failure_reason
         FROM nano_checkpoint_restore_jobs
         WHERE job_uuid = ?1
         LIMIT 1`,
      )
      .bind(input.job_uuid)
      .first<Record<string, unknown>>();
    return row ? rowToRestoreJob(row) : null;
  }

  async listForSession(input: {
    readonly session_uuid: string;
    readonly limit?: number;
  }): Promise<CheckpointRestoreJobRow[]> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const rows = await this.db
      .prepare(
        `SELECT
           job_uuid, checkpoint_uuid, session_uuid, mode,
           target_session_uuid, status, confirmation_uuid,
           started_at, completed_at, failure_reason
         FROM nano_checkpoint_restore_jobs
         WHERE session_uuid = ?1
         ORDER BY started_at DESC, job_uuid DESC
         LIMIT ?2`,
      )
      .bind(input.session_uuid, limit)
      .all<Record<string, unknown>>();
    return (rows.results ?? []).map(rowToRestoreJob);
  }

  async markRunning(input: {
    readonly job_uuid: string;
    readonly started_at: string;
  }): Promise<CheckpointRestoreJobRow | null> {
    const existing = await this.read({ job_uuid: input.job_uuid });
    if (!existing) return null;
    if (existing.status !== "pending") {
      throw new CheckpointRestoreJobConstraintError(
        "already-terminal",
        `restore job is in status ${existing.status}; cannot mark running`,
      );
    }
    await this.db
      .prepare(
        `UPDATE nano_checkpoint_restore_jobs
            SET status = 'running',
                started_at = ?2
          WHERE job_uuid = ?1`,
      )
      .bind(input.job_uuid, input.started_at)
      .run();
    return this.read({ job_uuid: input.job_uuid });
  }

  /**
   * HP7 P3-02 — apply a terminal status. Q24: callers MUST supply the
   * first failing step + code in `failure_reason` for any non-success
   * terminal so the audit row can explain the failure without a log
   * dive.
   */
  async terminate(input: {
    readonly job_uuid: string;
    readonly status: RestoreStatus;
    readonly completed_at: string;
    readonly failure_reason: string | null;
  }): Promise<CheckpointRestoreJobRow | null> {
    if (!RESTORE_TERMINAL_STATUSES.has(input.status)) {
      throw new CheckpointRestoreJobConstraintError(
        "invalid-status",
        `terminate requires a terminal status (${[...RESTORE_TERMINAL_STATUSES].join("|")})`,
      );
    }
    if (input.status !== "succeeded" && !input.failure_reason) {
      throw new CheckpointRestoreJobConstraintError(
        "invalid-status",
        "non-success terminal requires failure_reason (Q24)",
      );
    }
    const existing = await this.read({ job_uuid: input.job_uuid });
    if (!existing) {
      throw new CheckpointRestoreJobConstraintError(
        "job-not-found",
        `restore job ${input.job_uuid} not found`,
      );
    }
    if (RESTORE_TERMINAL_STATUSES.has(existing.status)) {
      // Idempotent: already terminal — return existing row unchanged.
      return existing;
    }
    await this.db
      .prepare(
        `UPDATE nano_checkpoint_restore_jobs
            SET status = ?2,
                completed_at = ?3,
                failure_reason = ?4
          WHERE job_uuid = ?1`,
      )
      .bind(
        input.job_uuid,
        input.status,
        input.completed_at,
        input.failure_reason,
      )
      .run();
    return this.read({ job_uuid: input.job_uuid });
  }
}
