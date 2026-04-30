-- HP1 P3-02 — workspace temp file durable truth + artifact provenance columns.
--
-- Frozen contract:
--   * docs/charter/plan-hero-to-pro.md §7.2 In-Scope §3 + §472 (011 ledger)
--   * docs/design/hero-to-pro/HP1-schema-extension.md §7.2 F3
--
-- Goal:
--   1. nano_session_temp_files — agent workspace scratch files (NOT artifacts).
--      Lifecycle is short-lived; HP6 promotes selected entries into
--      nano_session_files (the 004 artifact table). retention is enforced via
--      `expires_at` + `cleanup_status`, consumed by HP6/HP7 cleanup jobs.
--   2. nano_session_files (artifact table introduced in 004) gains 3 provenance
--      columns so HP6 / HP7 / HP10 can audit how a long-lived artifact came to
--      exist (user upload, agent generation, workspace promotion, compact
--      summary materialization, or checkpoint restore).

-- ── 1. nano_session_temp_files ──

CREATE TABLE IF NOT EXISTS nano_session_temp_files (
  temp_file_uuid TEXT PRIMARY KEY,
  session_uuid TEXT NOT NULL,
  team_uuid TEXT NOT NULL,
  virtual_path TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER NOT NULL,
  content_hash TEXT,
  last_modified_at TEXT NOT NULL,
  written_by TEXT NOT NULL CHECK (written_by IN ('user', 'agent', 'tool')),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  cleanup_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (cleanup_status IN ('pending', 'scheduled', 'done')),
  UNIQUE (session_uuid, virtual_path),
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  FOREIGN KEY (team_uuid)
    REFERENCES nano_teams(team_uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_temp_files_session
  ON nano_session_temp_files(session_uuid);

CREATE INDEX IF NOT EXISTS idx_temp_files_cleanup
  ON nano_session_temp_files(cleanup_status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nano_session_temp_files_r2_key
  ON nano_session_temp_files(r2_object_key);

-- ── 2. nano_session_files (004) — provenance columns ──
--
-- Default `provenance_kind` for legacy rows is intentionally left NULL: 004
-- rows pre-date HP1 freeze and HP6/HP7 will only consume rows written under
-- HP1+. The application layer (HP6) MUST set provenance_kind on every new
-- INSERT after HP1 closure.

ALTER TABLE nano_session_files
  ADD COLUMN provenance_kind TEXT
    CHECK (provenance_kind IN (
      'user_upload',
      'agent_generated',
      'workspace_promoted',
      'compact_summary',
      'checkpoint_restored'
    ));

ALTER TABLE nano_session_files
  ADD COLUMN source_workspace_path TEXT;

ALTER TABLE nano_session_files
  ADD COLUMN source_session_uuid TEXT;

CREATE INDEX IF NOT EXISTS idx_nano_session_files_provenance_kind
  ON nano_session_files(provenance_kind);

CREATE INDEX IF NOT EXISTS idx_nano_session_files_source_session
  ON nano_session_files(source_session_uuid);
