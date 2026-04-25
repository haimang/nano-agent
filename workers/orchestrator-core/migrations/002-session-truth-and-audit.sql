CREATE TABLE IF NOT EXISTS nano_conversations (
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

CREATE TABLE IF NOT EXISTS nano_conversation_sessions (
  session_uuid TEXT PRIMARY KEY,
  conversation_uuid TEXT NOT NULL,
  team_uuid TEXT NOT NULL,
  actor_user_uuid TEXT NOT NULL,
  trace_uuid TEXT NOT NULL,
  session_status TEXT NOT NULL CHECK (session_status IN ('starting', 'active', 'detached', 'ended')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  last_phase TEXT,
  last_event_seq INTEGER NOT NULL DEFAULT 0
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
  turn_status TEXT NOT NULL CHECK (turn_status IN ('accepted', 'completed', 'cancelled', 'failed')),
  input_text TEXT,
  created_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS nano_conversation_messages (
  message_uuid TEXT PRIMARY KEY,
  conversation_uuid TEXT NOT NULL,
  session_uuid TEXT NOT NULL,
  turn_uuid TEXT,
  team_uuid TEXT NOT NULL,
  trace_uuid TEXT NOT NULL,
  message_role TEXT NOT NULL CHECK (message_role IN ('user', 'assistant', 'system')),
  message_kind TEXT NOT NULL,
  body_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  event_seq INTEGER
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
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nano_session_activity_logs (
  activity_uuid TEXT PRIMARY KEY,
  team_uuid TEXT NOT NULL,
  actor_user_uuid TEXT NOT NULL,
  conversation_uuid TEXT NOT NULL,
  session_uuid TEXT NOT NULL,
  turn_uuid TEXT,
  trace_uuid TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  event_kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nano_session_activity_logs_team_created_at
  ON nano_session_activity_logs(team_uuid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nano_session_activity_logs_trace_event_seq
  ON nano_session_activity_logs(trace_uuid, event_seq);

CREATE INDEX IF NOT EXISTS idx_nano_session_activity_logs_session_created_at
  ON nano_session_activity_logs(session_uuid, created_at);

CREATE INDEX IF NOT EXISTS idx_nano_conversation_sessions_team_started_at
  ON nano_conversation_sessions(team_uuid, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_nano_conversation_messages_session_created_at
  ON nano_conversation_messages(session_uuid, created_at, event_seq);
