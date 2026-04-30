-- HP1 P3-03 — confirmation control plane durable truth.
--
-- Frozen contract:
--   * docs/charter/plan-hero-to-pro.md §7.2 In-Scope §4 + §473 (012 ledger)
--   * docs/design/hero-to-pro/HP1-schema-extension.md §7.2 F3
--   * docs/design/hero-to-pro/HPX-qna.md Q16 / Q18
--
-- Frozen invariants (HP5 must NOT extend without §3 correction):
--   * kind ∈ { tool_permission, elicitation, model_switch, context_compact,
--             fallback_model, checkpoint_restore, context_loss }
--     — exactly 7 kinds; Q18 forbids `tool_cancel`.
--   * status ∈ { pending, allowed, denied, modified, timeout, superseded }
--     — exactly 6 statuses; Q16 forbids `failed`. Failed-rollback / replaced
--     confirmations terminate as `superseded`, not `failed`.
--
-- HP5 will be the primary writer; HP2 (model_switch / fallback_model) and HP7
-- (checkpoint_restore / context_loss) co-write into this single row truth.

CREATE TABLE IF NOT EXISTS nano_session_confirmations (
  confirmation_uuid TEXT PRIMARY KEY,
  session_uuid TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'tool_permission',
    'elicitation',
    'model_switch',
    'context_compact',
    'fallback_model',
    'checkpoint_restore',
    'context_loss'
  )),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'allowed', 'denied', 'modified', 'timeout', 'superseded'
  )),
  decision_payload_json TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  expires_at TEXT,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_confirmations_session_status
  ON nano_session_confirmations(session_uuid, status);

CREATE INDEX IF NOT EXISTS idx_confirmations_kind_status
  ON nano_session_confirmations(kind, status, created_at);

CREATE INDEX IF NOT EXISTS idx_confirmations_expires_at
  ON nano_session_confirmations(expires_at)
  WHERE status = 'pending';
