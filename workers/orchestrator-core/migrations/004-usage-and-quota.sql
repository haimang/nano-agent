CREATE TABLE IF NOT EXISTS nano_quota_balances (
  team_uuid TEXT NOT NULL,
  quota_kind TEXT NOT NULL CHECK (quota_kind IN ('llm', 'tool')),
  remaining INTEGER NOT NULL CHECK (remaining >= 0),
  limit_value INTEGER NOT NULL CHECK (limit_value >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (team_uuid, quota_kind),
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nano_usage_events (
  usage_event_uuid TEXT PRIMARY KEY,
  team_uuid TEXT NOT NULL,
  session_uuid TEXT REFERENCES nano_conversation_sessions(session_uuid) ON DELETE SET NULL,
  trace_uuid TEXT NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('llm', 'tool')),
  verdict TEXT NOT NULL CHECK (verdict IN ('allow', 'deny')),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  unit TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (team_uuid, resource_kind, idempotency_key),
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nano_usage_events_team_created_at
  ON nano_usage_events(team_uuid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nano_usage_events_trace_created_at
  ON nano_usage_events(trace_uuid, created_at);

CREATE INDEX IF NOT EXISTS idx_nano_quota_balances_team_updated_at
  ON nano_quota_balances(team_uuid, updated_at DESC);
