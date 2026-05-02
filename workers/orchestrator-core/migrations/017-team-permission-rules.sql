-- HPX6 F10 — tenant-scoped permission rules.
--
-- Session-scoped rules live inside nano_session_runtime_config. Tenant rules
-- are separate so admins can seed defaults without touching active sessions.

CREATE TABLE IF NOT EXISTS nano_team_permission_rules (
  rule_uuid TEXT PRIMARY KEY,
  team_uuid TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  pattern TEXT,
  behavior TEXT NOT NULL CHECK (behavior IN ('allow', 'deny', 'ask')),
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_permission_rules_team_priority
  ON nano_team_permission_rules(team_uuid, priority, updated_at DESC);
