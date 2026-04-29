-- RH5 live repair — fix stale FK left by the v6 conversation table swap.
--
-- Some preview/prod D1 instances can retain
-- nano_usage_events.session_uuid -> nano_conversation_sessions_old_v6 after the
-- session table swap. Once the old table is dropped, LLM/tool usage writes fail
-- during FK validation. Rebuild the table forward-only so usage events point at
-- the canonical nano_conversation_sessions table.

PRAGMA foreign_keys = OFF;

CREATE TABLE nano_usage_events_new (
  usage_event_uuid TEXT PRIMARY KEY,
  team_uuid TEXT NOT NULL,
  session_uuid TEXT REFERENCES nano_conversation_sessions(session_uuid) ON DELETE SET NULL,
  trace_uuid TEXT NOT NULL,
  provider_key TEXT,
  model_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  is_reasoning INTEGER NOT NULL DEFAULT 0 CHECK (is_reasoning IN (0, 1)),
  is_vision INTEGER NOT NULL DEFAULT 0 CHECK (is_vision IN (0, 1)),
  request_uuid TEXT,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('llm', 'tool')),
  verdict TEXT NOT NULL CHECK (verdict IN ('allow', 'deny')),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  unit TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (team_uuid, resource_kind, idempotency_key),
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE
);

INSERT INTO nano_usage_events_new (
  usage_event_uuid,
  team_uuid,
  session_uuid,
  trace_uuid,
  provider_key,
  model_id,
  input_tokens,
  output_tokens,
  estimated_cost_usd,
  is_reasoning,
  is_vision,
  request_uuid,
  resource_kind,
  verdict,
  quantity,
  unit,
  idempotency_key,
  created_at
)
SELECT
  usage_event_uuid,
  team_uuid,
  CASE
    WHEN session_uuid IS NOT NULL
      AND EXISTS (
        SELECT 1
          FROM nano_conversation_sessions s
         WHERE s.session_uuid = nano_usage_events.session_uuid
      )
    THEN session_uuid
    ELSE NULL
  END,
  trace_uuid,
  provider_key,
  model_id,
  input_tokens,
  output_tokens,
  estimated_cost_usd,
  is_reasoning,
  is_vision,
  request_uuid,
  resource_kind,
  verdict,
  quantity,
  unit,
  idempotency_key,
  created_at
FROM nano_usage_events;

DROP TABLE nano_usage_events;
ALTER TABLE nano_usage_events_new RENAME TO nano_usage_events;

CREATE INDEX idx_nano_usage_events_team_created_at
  ON nano_usage_events(team_uuid, created_at DESC);
CREATE INDEX idx_nano_usage_events_trace_created_at
  ON nano_usage_events(trace_uuid, created_at);
CREATE INDEX idx_nano_usage_events_team_provider_created
  ON nano_usage_events(team_uuid, provider_key, created_at DESC);
CREATE INDEX idx_nano_usage_events_team_model_created
  ON nano_usage_events(team_uuid, model_id, created_at DESC);

PRAGMA foreign_keys = ON;
