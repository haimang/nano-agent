-- HP1 P4-01 — product checkpoint / file snapshot / restore job / cleanup
-- lineage durable truth (one migration covers HP4/HP6/HP7 hard dependencies).
--
-- Frozen contract:
--   * docs/charter/plan-hero-to-pro.md §7.2 In-Scope §5/§6 + §474 (013 ledger)
--   * docs/design/hero-to-pro/HP1-schema-extension.md §7.2 F4
--   * docs/design/hero-to-pro/HPX-qna.md Q5 (checkpoint lineage one-shot freeze)
--
-- Tables:
--   1. nano_session_checkpoints       — user-visible checkpoint timeline.
--                                       Distinct from `session:checkpoint` DO
--                                       state (DO is runtime; this is product).
--   2. nano_checkpoint_file_snapshots — lazy R2 snapshot lineage per checkpoint.
--   3. nano_checkpoint_restore_jobs   — restore audit (incl. fork mode).
--   4. nano_workspace_cleanup_jobs    — cleanup lineage; HP1 closure §7.4 fixes
--                                       scope ownership (session_end / explicit
--                                       → HP6; checkpoint_ttl → HP7).
--
-- HP3 first cut of `/context/compact/jobs/{id}` deliberately reuses
-- `nano_session_checkpoints.checkpoint_kind = 'compact_boundary'` rather than
-- introducing a new `nano_compact_jobs` table; if HP3 ever proves that
-- handle insufficient, it must trigger HP1 §3 schema correction.

-- ── 1. nano_session_checkpoints — user-visible product checkpoint truth ──

CREATE TABLE IF NOT EXISTS nano_session_checkpoints (
  checkpoint_uuid TEXT PRIMARY KEY,
  session_uuid TEXT NOT NULL,
  conversation_uuid TEXT NOT NULL,
  team_uuid TEXT NOT NULL,
  turn_uuid TEXT,
  turn_attempt INTEGER,
  checkpoint_kind TEXT NOT NULL CHECK (checkpoint_kind IN (
    'turn_end', 'user_named', 'compact_boundary', 'system'
  )),
  label TEXT,
  message_high_watermark TEXT,
  latest_event_seq INTEGER,
  context_snapshot_uuid TEXT,
  file_snapshot_status TEXT NOT NULL DEFAULT 'none' CHECK (
    file_snapshot_status IN ('none', 'pending', 'materialized', 'failed')
  ),
  created_by TEXT NOT NULL CHECK (
    created_by IN ('user', 'system', 'compact', 'turn_end')
  ),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  FOREIGN KEY (conversation_uuid)
    REFERENCES nano_conversations(conversation_uuid) ON DELETE CASCADE,
  FOREIGN KEY (team_uuid)
    REFERENCES nano_teams(team_uuid) ON DELETE CASCADE,
  FOREIGN KEY (turn_uuid)
    REFERENCES nano_conversation_turns(turn_uuid) ON DELETE SET NULL,
  FOREIGN KEY (context_snapshot_uuid)
    REFERENCES nano_conversation_context_snapshots(snapshot_uuid)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_session
  ON nano_session_checkpoints(session_uuid, created_at);

CREATE INDEX IF NOT EXISTS idx_checkpoints_team_created
  ON nano_session_checkpoints(team_uuid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkpoints_kind_created
  ON nano_session_checkpoints(checkpoint_kind, created_at);

CREATE INDEX IF NOT EXISTS idx_checkpoints_expires_at
  ON nano_session_checkpoints(expires_at);

-- ── 2. nano_checkpoint_file_snapshots — lazy R2 snapshot lineage ──

CREATE TABLE IF NOT EXISTS nano_checkpoint_file_snapshots (
  snapshot_uuid TEXT PRIMARY KEY,
  checkpoint_uuid TEXT NOT NULL,
  session_uuid TEXT NOT NULL,
  team_uuid TEXT NOT NULL,
  source_temp_file_uuid TEXT,
  source_artifact_file_uuid TEXT,
  source_r2_key TEXT NOT NULL,
  snapshot_r2_key TEXT NOT NULL,
  virtual_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content_hash TEXT,
  snapshot_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    snapshot_status IN ('pending', 'materialized', 'copied_to_fork', 'failed')
  ),
  created_at TEXT NOT NULL,
  FOREIGN KEY (checkpoint_uuid)
    REFERENCES nano_session_checkpoints(checkpoint_uuid) ON DELETE CASCADE,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  FOREIGN KEY (team_uuid)
    REFERENCES nano_teams(team_uuid) ON DELETE CASCADE,
  FOREIGN KEY (source_temp_file_uuid)
    REFERENCES nano_session_temp_files(temp_file_uuid) ON DELETE SET NULL,
  FOREIGN KEY (source_artifact_file_uuid)
    REFERENCES nano_session_files(file_uuid) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_snapshots_checkpoint
  ON nano_checkpoint_file_snapshots(checkpoint_uuid);

CREATE INDEX IF NOT EXISTS idx_checkpoint_snapshots_status
  ON nano_checkpoint_file_snapshots(snapshot_status);

CREATE INDEX IF NOT EXISTS idx_checkpoint_snapshots_session
  ON nano_checkpoint_file_snapshots(session_uuid, created_at);

-- ── 3. nano_checkpoint_restore_jobs — restore + fork audit ──

CREATE TABLE IF NOT EXISTS nano_checkpoint_restore_jobs (
  job_uuid TEXT PRIMARY KEY,
  checkpoint_uuid TEXT NOT NULL,
  session_uuid TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN (
    'conversation_only', 'files_only', 'conversation_and_files', 'fork'
  )),
  target_session_uuid TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'succeeded', 'partial', 'failed', 'rolled_back'
  )),
  confirmation_uuid TEXT,
  started_at TEXT,
  completed_at TEXT,
  failure_reason TEXT,
  FOREIGN KEY (checkpoint_uuid)
    REFERENCES nano_session_checkpoints(checkpoint_uuid) ON DELETE CASCADE,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  FOREIGN KEY (target_session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE SET NULL,
  FOREIGN KEY (confirmation_uuid)
    REFERENCES nano_session_confirmations(confirmation_uuid) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_restore_jobs_session
  ON nano_checkpoint_restore_jobs(session_uuid, status);

CREATE INDEX IF NOT EXISTS idx_restore_jobs_checkpoint
  ON nano_checkpoint_restore_jobs(checkpoint_uuid, status);

CREATE INDEX IF NOT EXISTS idx_restore_jobs_status_started
  ON nano_checkpoint_restore_jobs(status, started_at);

-- ── 4. nano_workspace_cleanup_jobs — cleanup lineage (HP6/HP7 share table) ──
--
-- Scope ownership (frozen in HP1 closure §7.4):
--   * `session_end` / `explicit`     — written by HP6 (workspace state machine)
--   * `checkpoint_ttl`               — written by HP7 (checkpoint TTL cron)

CREATE TABLE IF NOT EXISTS nano_workspace_cleanup_jobs (
  job_uuid TEXT PRIMARY KEY,
  session_uuid TEXT NOT NULL,
  team_uuid TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN (
    'session_end', 'explicit', 'checkpoint_ttl'
  )),
  target_count INTEGER,
  deleted_count INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'done', 'failed'
  )),
  scheduled_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  FOREIGN KEY (team_uuid)
    REFERENCES nano_teams(team_uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cleanup_jobs_session_status
  ON nano_workspace_cleanup_jobs(session_uuid, status);

CREATE INDEX IF NOT EXISTS idx_cleanup_jobs_scope_status
  ON nano_workspace_cleanup_jobs(scope, status);

CREATE INDEX IF NOT EXISTS idx_cleanup_jobs_scheduled_at
  ON nano_workspace_cleanup_jobs(scheduled_at);
