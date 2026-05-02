-- HPX6 F6 — durable tool-call ledger.
--
-- Source of truth for public `/sessions/{id}/tool-calls` history and
-- item-projection `tool_call` objects. Stream events remain the realtime
-- channel; this table is the durable scan surface.

CREATE TABLE IF NOT EXISTS nano_tool_call_ledger (
  request_uuid TEXT PRIMARY KEY,
  session_uuid TEXT NOT NULL,
  conversation_uuid TEXT,
  turn_uuid TEXT,
  team_uuid TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  cancel_initiator TEXT CHECK (
    cancel_initiator IS NULL OR cancel_initiator IN ('user', 'system', 'tool')
  ),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  FOREIGN KEY (conversation_uuid)
    REFERENCES nano_conversations(conversation_uuid) ON DELETE SET NULL,
  FOREIGN KEY (turn_uuid)
    REFERENCES nano_conversation_turns(turn_uuid) ON DELETE SET NULL,
  FOREIGN KEY (team_uuid)
    REFERENCES nano_teams(team_uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tool_call_ledger_session_updated
  ON nano_tool_call_ledger(session_uuid, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_call_ledger_team_updated
  ON nano_tool_call_ledger(team_uuid, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tool_call_ledger_status
  ON nano_tool_call_ledger(status, updated_at DESC);
