-- Conversation, session, message, context snapshot, and audit-log truth.
--
-- RHX1 folds the ZX4/RH4 table-swap migrations into the current final schema:
-- session_status includes pending/expired, activity payload is capped at 8 KiB,
-- and every dependent table points at the canonical conversation/session tables.

CREATE TABLE IF NOT EXISTS nano_conversations (
  conversation_uuid TEXT PRIMARY KEY,
  team_uuid TEXT NOT NULL,
  owner_user_uuid TEXT NOT NULL,
  conversation_status TEXT NOT NULL
    CHECK (conversation_status IN ('active', 'ended', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  latest_session_uuid TEXT,
  latest_turn_uuid TEXT,
  title TEXT,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_uuid) REFERENCES nano_users(user_uuid)
);

CREATE TABLE IF NOT EXISTS nano_conversation_sessions (
  session_uuid TEXT PRIMARY KEY,
  conversation_uuid TEXT NOT NULL,
  team_uuid TEXT NOT NULL,
  actor_user_uuid TEXT NOT NULL,
  trace_uuid TEXT NOT NULL,
  session_status TEXT NOT NULL CHECK (session_status IN (
    'pending', 'starting', 'active', 'detached', 'ended', 'expired'
  )),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  last_phase TEXT,
  last_event_seq INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (conversation_uuid)
    REFERENCES nano_conversations(conversation_uuid) ON DELETE CASCADE,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_uuid) REFERENCES nano_users(user_uuid)
);

CREATE TABLE IF NOT EXISTS nano_conversation_turns (
  turn_uuid TEXT PRIMARY KEY,
  conversation_uuid TEXT NOT NULL,
  session_uuid TEXT NOT NULL,
  team_uuid TEXT NOT NULL,
  actor_user_uuid TEXT NOT NULL,
  trace_uuid TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  turn_kind TEXT NOT NULL CHECK (turn_kind IN ('start', 'followup', 'cancel')),
  turn_status TEXT NOT NULL
    CHECK (turn_status IN ('accepted', 'completed', 'cancelled', 'failed')),
  input_text TEXT,
  created_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE (session_uuid, turn_index),
  FOREIGN KEY (conversation_uuid)
    REFERENCES nano_conversations(conversation_uuid) ON DELETE CASCADE,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_uuid) REFERENCES nano_users(user_uuid)
);

CREATE TABLE IF NOT EXISTS nano_conversation_messages (
  message_uuid TEXT PRIMARY KEY,
  conversation_uuid TEXT NOT NULL,
  session_uuid TEXT NOT NULL,
  turn_uuid TEXT,
  team_uuid TEXT NOT NULL,
  trace_uuid TEXT NOT NULL,
  message_role TEXT NOT NULL
    CHECK (message_role IN ('user', 'assistant', 'system')),
  message_kind TEXT NOT NULL,
  body_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  event_seq INTEGER,
  FOREIGN KEY (conversation_uuid)
    REFERENCES nano_conversations(conversation_uuid) ON DELETE CASCADE,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  FOREIGN KEY (turn_uuid)
    REFERENCES nano_conversation_turns(turn_uuid) ON DELETE CASCADE,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nano_conversation_context_snapshots (
  snapshot_uuid TEXT PRIMARY KEY,
  conversation_uuid TEXT NOT NULL,
  session_uuid TEXT NOT NULL,
  turn_uuid TEXT,
  team_uuid TEXT NOT NULL,
  trace_uuid TEXT NOT NULL,
  snapshot_kind TEXT NOT NULL,
  summary_ref TEXT,
  prompt_token_estimate INTEGER,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_uuid)
    REFERENCES nano_conversations(conversation_uuid) ON DELETE CASCADE,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  FOREIGN KEY (turn_uuid)
    REFERENCES nano_conversation_turns(turn_uuid) ON DELETE SET NULL,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nano_session_activity_logs (
  activity_uuid TEXT PRIMARY KEY,
  team_uuid TEXT NOT NULL,
  actor_user_uuid TEXT,
  conversation_uuid TEXT,
  session_uuid TEXT,
  turn_uuid TEXT,
  trace_uuid TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  event_kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
  payload TEXT NOT NULL CHECK (length(CAST(payload AS BLOB)) <= 8192),
  created_at TEXT NOT NULL,
  UNIQUE (trace_uuid, event_seq),
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_uuid) REFERENCES nano_users(user_uuid),
  FOREIGN KEY (conversation_uuid)
    REFERENCES nano_conversations(conversation_uuid) ON DELETE SET NULL,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE SET NULL,
  FOREIGN KEY (turn_uuid)
    REFERENCES nano_conversation_turns(turn_uuid) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_nano_session_activity_logs_team_created_at
  ON nano_session_activity_logs(team_uuid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nano_session_activity_logs_trace_event_seq
  ON nano_session_activity_logs(trace_uuid, event_seq);

CREATE INDEX IF NOT EXISTS idx_nano_session_activity_logs_session_created_at
  ON nano_session_activity_logs(session_uuid, created_at);

CREATE INDEX IF NOT EXISTS idx_nano_conversation_sessions_team_started_at
  ON nano_conversation_sessions(team_uuid, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_nano_conversation_sessions_pending_started_at
  ON nano_conversation_sessions(session_status, started_at);

CREATE INDEX IF NOT EXISTS idx_nano_conversation_turns_session_created_at
  ON nano_conversation_turns(session_uuid, created_at);

CREATE INDEX IF NOT EXISTS idx_nano_conversation_turns_team_created_at
  ON nano_conversation_turns(team_uuid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nano_conversation_messages_session_created_at
  ON nano_conversation_messages(session_uuid, created_at, event_seq);

CREATE INDEX IF NOT EXISTS idx_nano_conversation_messages_turn_created_at
  ON nano_conversation_messages(turn_uuid, created_at);

DROP VIEW IF EXISTS view_recent_audit_per_team;
CREATE VIEW view_recent_audit_per_team AS
SELECT
  team_uuid,
  event_kind,
  severity,
  COUNT(*) AS event_count,
  MAX(created_at) AS last_event_at
FROM nano_session_activity_logs
WHERE created_at >= datetime('now', '-7 day')
GROUP BY team_uuid, event_kind, severity;
