ALTER TABLE nano_session_activity_logs RENAME TO nano_session_activity_logs_old_v3;
ALTER TABLE nano_conversation_context_snapshots RENAME TO nano_conversation_context_snapshots_old_v3;
ALTER TABLE nano_conversation_messages RENAME TO nano_conversation_messages_old_v3;
ALTER TABLE nano_conversation_turns RENAME TO nano_conversation_turns_old_v3;
ALTER TABLE nano_conversation_sessions RENAME TO nano_conversation_sessions_old_v3;
ALTER TABLE nano_conversations RENAME TO nano_conversations_old_v3;

CREATE TABLE nano_conversations (
  conversation_uuid TEXT PRIMARY KEY,
  team_uuid TEXT NOT NULL,
  owner_user_uuid TEXT NOT NULL,
  conversation_status TEXT NOT NULL CHECK (conversation_status IN ('active', 'ended', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  latest_session_uuid TEXT,
  latest_turn_uuid TEXT,
  title TEXT
);

CREATE TABLE nano_conversation_sessions (
  session_uuid TEXT PRIMARY KEY,
  conversation_uuid TEXT NOT NULL REFERENCES nano_conversations(conversation_uuid) ON DELETE CASCADE,
  team_uuid TEXT NOT NULL,
  actor_user_uuid TEXT NOT NULL,
  trace_uuid TEXT NOT NULL,
  session_status TEXT NOT NULL CHECK (session_status IN ('starting', 'active', 'detached', 'ended')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  last_phase TEXT,
  last_event_seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE nano_conversation_turns (
  turn_uuid TEXT PRIMARY KEY,
  conversation_uuid TEXT NOT NULL REFERENCES nano_conversations(conversation_uuid) ON DELETE CASCADE,
  session_uuid TEXT NOT NULL REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  team_uuid TEXT NOT NULL,
  actor_user_uuid TEXT NOT NULL,
  trace_uuid TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  turn_kind TEXT NOT NULL CHECK (turn_kind IN ('start', 'followup', 'cancel')),
  turn_status TEXT NOT NULL CHECK (turn_status IN ('accepted', 'completed', 'cancelled', 'failed')),
  input_text TEXT,
  created_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE (session_uuid, turn_index)
);

CREATE TABLE nano_conversation_messages (
  message_uuid TEXT PRIMARY KEY,
  conversation_uuid TEXT NOT NULL REFERENCES nano_conversations(conversation_uuid) ON DELETE CASCADE,
  session_uuid TEXT NOT NULL REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  turn_uuid TEXT REFERENCES nano_conversation_turns(turn_uuid) ON DELETE CASCADE,
  team_uuid TEXT NOT NULL,
  trace_uuid TEXT NOT NULL,
  message_role TEXT NOT NULL CHECK (message_role IN ('user', 'assistant', 'system')),
  message_kind TEXT NOT NULL,
  body_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  event_seq INTEGER
);

CREATE TABLE nano_conversation_context_snapshots (
  snapshot_uuid TEXT PRIMARY KEY,
  conversation_uuid TEXT NOT NULL REFERENCES nano_conversations(conversation_uuid) ON DELETE CASCADE,
  session_uuid TEXT NOT NULL REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  turn_uuid TEXT REFERENCES nano_conversation_turns(turn_uuid) ON DELETE SET NULL,
  team_uuid TEXT NOT NULL,
  trace_uuid TEXT NOT NULL,
  snapshot_kind TEXT NOT NULL,
  summary_ref TEXT,
  prompt_token_estimate INTEGER,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE nano_session_activity_logs (
  activity_uuid TEXT PRIMARY KEY,
  team_uuid TEXT NOT NULL,
  actor_user_uuid TEXT,
  conversation_uuid TEXT REFERENCES nano_conversations(conversation_uuid) ON DELETE SET NULL,
  session_uuid TEXT REFERENCES nano_conversation_sessions(session_uuid) ON DELETE SET NULL,
  turn_uuid TEXT REFERENCES nano_conversation_turns(turn_uuid) ON DELETE SET NULL,
  trace_uuid TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  event_kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
  payload TEXT NOT NULL CHECK (length(CAST(payload AS BLOB)) <= 8192),
  created_at TEXT NOT NULL,
  UNIQUE (trace_uuid, event_seq)
);

INSERT INTO nano_conversations (
  conversation_uuid,
  team_uuid,
  owner_user_uuid,
  conversation_status,
  created_at,
  updated_at,
  latest_session_uuid,
  latest_turn_uuid,
  title
)
SELECT
  conversation_uuid,
  team_uuid,
  owner_user_uuid,
  conversation_status,
  created_at,
  updated_at,
  latest_session_uuid,
  latest_turn_uuid,
  title
FROM nano_conversations_old_v3;

INSERT INTO nano_conversation_sessions (
  session_uuid,
  conversation_uuid,
  team_uuid,
  actor_user_uuid,
  trace_uuid,
  session_status,
  started_at,
  ended_at,
  last_phase,
  last_event_seq
)
SELECT
  session_uuid,
  conversation_uuid,
  team_uuid,
  actor_user_uuid,
  trace_uuid,
  session_status,
  started_at,
  ended_at,
  last_phase,
  last_event_seq
FROM nano_conversation_sessions_old_v3;

INSERT INTO nano_conversation_turns (
  turn_uuid,
  conversation_uuid,
  session_uuid,
  team_uuid,
  actor_user_uuid,
  trace_uuid,
  turn_index,
  turn_kind,
  turn_status,
  input_text,
  created_at,
  ended_at
)
SELECT
  turn_uuid,
  conversation_uuid,
  session_uuid,
  team_uuid,
  actor_user_uuid,
  trace_uuid,
  turn_index,
  turn_kind,
  turn_status,
  input_text,
  created_at,
  ended_at
FROM nano_conversation_turns_old_v3;

INSERT INTO nano_conversation_messages (
  message_uuid,
  conversation_uuid,
  session_uuid,
  turn_uuid,
  team_uuid,
  trace_uuid,
  message_role,
  message_kind,
  body_json,
  created_at,
  event_seq
)
SELECT
  message_uuid,
  conversation_uuid,
  session_uuid,
  turn_uuid,
  team_uuid,
  trace_uuid,
  message_role,
  message_kind,
  body_json,
  created_at,
  event_seq
FROM nano_conversation_messages_old_v3;

INSERT INTO nano_conversation_context_snapshots (
  snapshot_uuid,
  conversation_uuid,
  session_uuid,
  turn_uuid,
  team_uuid,
  trace_uuid,
  snapshot_kind,
  summary_ref,
  prompt_token_estimate,
  payload_json,
  created_at
)
SELECT
  snapshot_uuid,
  conversation_uuid,
  session_uuid,
  turn_uuid,
  team_uuid,
  trace_uuid,
  snapshot_kind,
  summary_ref,
  prompt_token_estimate,
  payload_json,
  created_at
FROM nano_conversation_context_snapshots_old_v3;

INSERT INTO nano_session_activity_logs (
  activity_uuid,
  team_uuid,
  actor_user_uuid,
  conversation_uuid,
  session_uuid,
  turn_uuid,
  trace_uuid,
  event_seq,
  event_kind,
  severity,
  payload,
  created_at
)
SELECT
  activity_uuid,
  team_uuid,
  actor_user_uuid,
  conversation_uuid,
  session_uuid,
  turn_uuid,
  trace_uuid,
  event_seq,
  event_kind,
  severity,
  CASE
    WHEN length(CAST(payload AS BLOB)) <= 8192 THEN payload
    ELSE '{"truncated":true,"migrated":true,"reason":"payload-too-large"}'
  END,
  created_at
FROM nano_session_activity_logs_old_v3;

DROP TABLE nano_session_activity_logs_old_v3;
DROP TABLE nano_conversation_context_snapshots_old_v3;
DROP TABLE nano_conversation_messages_old_v3;
DROP TABLE nano_conversation_turns_old_v3;
DROP TABLE nano_conversation_sessions_old_v3;
DROP TABLE nano_conversations_old_v3;

CREATE INDEX idx_nano_session_activity_logs_team_created_at
  ON nano_session_activity_logs(team_uuid, created_at DESC);

CREATE INDEX idx_nano_session_activity_logs_trace_event_seq
  ON nano_session_activity_logs(trace_uuid, event_seq);

CREATE INDEX idx_nano_session_activity_logs_session_created_at
  ON nano_session_activity_logs(session_uuid, created_at);

CREATE INDEX idx_nano_conversation_sessions_team_started_at
  ON nano_conversation_sessions(team_uuid, started_at DESC);

CREATE INDEX idx_nano_conversation_turns_session_created_at
  ON nano_conversation_turns(session_uuid, created_at);

CREATE INDEX idx_nano_conversation_turns_team_created_at
  ON nano_conversation_turns(team_uuid, created_at DESC);

CREATE INDEX idx_nano_conversation_messages_session_created_at
  ON nano_conversation_messages(session_uuid, created_at, event_seq);

CREATE INDEX idx_nano_conversation_messages_turn_created_at
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
