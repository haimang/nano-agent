-- Session file metadata truth.
--
-- Binary payloads live in R2. D1 keeps the queryable metadata and stable R2 key
-- uniqueness used by `/sessions/:id/files` and related product surfaces.

CREATE TABLE IF NOT EXISTS nano_session_files (
  file_uuid TEXT PRIMARY KEY,
  session_uuid TEXT NOT NULL,
  team_uuid TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER NOT NULL,
  original_name TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nano_session_files_session_created_at
  ON nano_session_files(session_uuid, created_at DESC, file_uuid DESC);

CREATE INDEX IF NOT EXISTS idx_nano_session_files_team_created_at
  ON nano_session_files(team_uuid, created_at DESC, file_uuid DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nano_session_files_r2_key
  ON nano_session_files(r2_key);
