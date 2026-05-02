-- HPX6 F9 — session-scoped runtime config.
--
-- Replaces legacy permission_mode KV with a durable runtime object. The
-- config is session-scoped; per-turn model/reasoning overrides remain on
-- input/message bodies.

CREATE TABLE IF NOT EXISTS nano_session_runtime_config (
  session_uuid TEXT PRIMARY KEY,
  team_uuid TEXT NOT NULL,
  permission_rules_json TEXT NOT NULL DEFAULT '[]',
  network_policy_mode TEXT NOT NULL DEFAULT 'restricted',
  web_search_mode TEXT NOT NULL DEFAULT 'disabled',
  workspace_scope_json TEXT NOT NULL DEFAULT '{"mounts":[]}',
  approval_policy TEXT NOT NULL DEFAULT 'ask' CHECK (
    approval_policy IN ('ask', 'auto-allow', 'deny', 'always_allow')
  ),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  FOREIGN KEY (team_uuid)
    REFERENCES nano_teams(team_uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_runtime_config_team_updated
  ON nano_session_runtime_config(team_uuid, updated_at DESC);
