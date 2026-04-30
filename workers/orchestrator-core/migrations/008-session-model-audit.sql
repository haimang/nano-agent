-- HP1 P2-02 — session/turn model audit + ended_reason durable truth.
--
-- Frozen contract:
--   * docs/charter/plan-hero-to-pro.md §7.2 In-Scope §1 + §469 (008 ledger)
--   * docs/design/hero-to-pro/HP1-schema-extension.md §7.1 F2
--   * docs/design/hero-to-pro/HPX-qna.md Q13 (`ended_reason` column, no new state)
--
-- Goal:
--   * `nano_conversation_sessions` gets:
--     - `default_model_id` / `default_reasoning_effort` (session-level default)
--     - `ended_reason`                                  (Q13: terminal cause as
--                                                        a column, *not* a new
--                                                        session_status value)
--   * `nano_conversation_turns` gets HP2 model audit columns:
--     - `requested_model_id` / `requested_reasoning_effort`
--     - `effective_model_id` / `effective_reasoning_effort`
--     - `fallback_used` (0/1)
--
-- All columns are nullable so the migration applies cleanly on top of 002.
-- Application-layer (HP2 runtime) enforces semantic invariants when writing.

-- ── 1. nano_conversation_sessions audit columns ──

ALTER TABLE nano_conversation_sessions
  ADD COLUMN default_model_id TEXT;
ALTER TABLE nano_conversation_sessions
  ADD COLUMN default_reasoning_effort TEXT;
ALTER TABLE nano_conversation_sessions
  ADD COLUMN ended_reason TEXT; -- Q13: free-form reason str; HP4 enumerates app-side

-- Helpful queryable index for HP4 reason-aware analytics.
CREATE INDEX IF NOT EXISTS idx_nano_conversation_sessions_ended_reason
  ON nano_conversation_sessions(ended_reason, ended_at);

-- ── 2. nano_conversation_turns audit columns ──

ALTER TABLE nano_conversation_turns
  ADD COLUMN requested_model_id TEXT;
ALTER TABLE nano_conversation_turns
  ADD COLUMN requested_reasoning_effort TEXT;
ALTER TABLE nano_conversation_turns
  ADD COLUMN effective_model_id TEXT;
ALTER TABLE nano_conversation_turns
  ADD COLUMN effective_reasoning_effort TEXT;
ALTER TABLE nano_conversation_turns
  ADD COLUMN fallback_used INTEGER NOT NULL DEFAULT 0
    CHECK (fallback_used IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_nano_conversation_turns_session_effective_model
  ON nano_conversation_turns(session_uuid, effective_model_id);
