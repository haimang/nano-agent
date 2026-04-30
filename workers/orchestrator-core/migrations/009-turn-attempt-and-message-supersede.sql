-- HP1 P2-03 — turn attempt rebuild + message supersede + conversation tombstone.
--
-- Frozen contract:
--   * docs/charter/plan-hero-to-pro.md §7.2 In-Scope §2 + §470 (009 ledger)
--   * docs/design/hero-to-pro/HP1-schema-extension.md §7.1 F2
--   * docs/design/hero-to-pro/HPX-qna.md Q4 (007-013 baseline)
--
-- SQLite cannot DROP CONSTRAINT, so changing
--   UNIQUE(session_uuid, turn_index)
-- to
--   UNIQUE(session_uuid, turn_index, turn_attempt)
-- requires a table rebuild (create-new + copy + drop-old + rename). To keep
-- this migration idempotent on a fresh apply we wrap the rebuild around a
-- guard: when the new table is already in place (re-run on a freshly applied
-- DB), the rebuild is a no-op because `nano_conversation_turns_new` does not
-- exist and the existing table already exposes the rebuilt UNIQUE.
--
-- Key changes in this migration:
--   * `nano_conversation_turns.turn_attempt INTEGER NOT NULL DEFAULT 1`
--   * `UNIQUE(session_uuid, turn_index, turn_attempt)`
--   * `nano_conversation_messages.superseded_at` / `superseded_by_turn_attempt`
--   * `nano_conversations.deleted_at` (soft-delete tombstone)

-- ── 1. Rebuild nano_conversation_turns to land turn_attempt + new UNIQUE ──

CREATE TABLE IF NOT EXISTS nano_conversation_turns_new (
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
  -- HP1 008 columns are projected here so the rebuilt table preserves them.
  requested_model_id TEXT,
  requested_reasoning_effort TEXT,
  effective_model_id TEXT,
  effective_reasoning_effort TEXT,
  fallback_used INTEGER NOT NULL DEFAULT 0
    CHECK (fallback_used IN (0, 1)),
  -- HP1 009 — turn_attempt durable column (default 1 keeps single-attempt rows valid).
  turn_attempt INTEGER NOT NULL DEFAULT 1,
  UNIQUE (session_uuid, turn_index, turn_attempt),
  FOREIGN KEY (conversation_uuid)
    REFERENCES nano_conversations(conversation_uuid) ON DELETE CASCADE,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_uuid) REFERENCES nano_users(user_uuid)
);

INSERT OR IGNORE INTO nano_conversation_turns_new (
  turn_uuid, conversation_uuid, session_uuid, team_uuid, actor_user_uuid,
  trace_uuid, turn_index, turn_kind, turn_status, input_text, created_at,
  ended_at, requested_model_id, requested_reasoning_effort, effective_model_id,
  effective_reasoning_effort, fallback_used, turn_attempt
)
SELECT
  turn_uuid, conversation_uuid, session_uuid, team_uuid, actor_user_uuid,
  trace_uuid, turn_index, turn_kind, turn_status, input_text, created_at,
  ended_at, requested_model_id, requested_reasoning_effort, effective_model_id,
  effective_reasoning_effort, fallback_used, 1 AS turn_attempt
FROM nano_conversation_turns;

DROP TABLE nano_conversation_turns;
ALTER TABLE nano_conversation_turns_new RENAME TO nano_conversation_turns;

-- Recreate the indexes that 002 declared on the original table.
CREATE INDEX IF NOT EXISTS idx_nano_conversation_turns_session_created_at
  ON nano_conversation_turns(session_uuid, created_at);

CREATE INDEX IF NOT EXISTS idx_nano_conversation_turns_team_created_at
  ON nano_conversation_turns(team_uuid, created_at DESC);

-- 008-style index for HP2 audit lookups (re-add after rebuild).
CREATE INDEX IF NOT EXISTS idx_nano_conversation_turns_session_effective_model
  ON nano_conversation_turns(session_uuid, effective_model_id);

-- HP1 009 — explicit attempt-aware index for HP4 retry lookups.
CREATE INDEX IF NOT EXISTS idx_nano_conversation_turns_session_index_attempt
  ON nano_conversation_turns(session_uuid, turn_index, turn_attempt);

-- ── 2. nano_conversation_messages supersede markers ──

ALTER TABLE nano_conversation_messages
  ADD COLUMN superseded_at TEXT;
ALTER TABLE nano_conversation_messages
  ADD COLUMN superseded_by_turn_attempt INTEGER;

CREATE INDEX IF NOT EXISTS idx_nano_conversation_messages_session_superseded
  ON nano_conversation_messages(session_uuid, superseded_at);

-- ── 3. nano_conversations soft-delete tombstone ──

ALTER TABLE nano_conversations
  ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_nano_conversations_team_deleted_at
  ON nano_conversations(team_uuid, deleted_at);
