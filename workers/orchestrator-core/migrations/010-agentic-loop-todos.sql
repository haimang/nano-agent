-- HP1 P3-01 — agentic-loop todo durable truth.
--
-- Frozen contract:
--   * docs/charter/plan-hero-to-pro.md §7.2 In-Scope §3 + §471 (010 ledger)
--   * docs/design/hero-to-pro/HP1-schema-extension.md §7.2 F3
--
-- Goal: HP6 tool/workspace state machine writes/reads TodoItems against this
-- table. status enum mirrors the charter §436 set verbatim:
--   pending | in_progress | completed | cancelled | blocked
-- HP1 freezes both schema and enum; HP6 cannot extend without a §3
-- correction in HP1-closure.

CREATE TABLE IF NOT EXISTS nano_session_todos (
  todo_uuid TEXT PRIMARY KEY,
  session_uuid TEXT NOT NULL,
  conversation_uuid TEXT NOT NULL,
  team_uuid TEXT NOT NULL,
  parent_todo_uuid TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'in_progress', 'completed', 'cancelled', 'blocked'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  FOREIGN KEY (conversation_uuid)
    REFERENCES nano_conversations(conversation_uuid) ON DELETE CASCADE,
  FOREIGN KEY (team_uuid)
    REFERENCES nano_teams(team_uuid) ON DELETE CASCADE,
  FOREIGN KEY (parent_todo_uuid)
    REFERENCES nano_session_todos(todo_uuid) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_todos_session
  ON nano_session_todos(session_uuid, status);

CREATE INDEX IF NOT EXISTS idx_todos_team_updated
  ON nano_session_todos(team_uuid, updated_at DESC);
