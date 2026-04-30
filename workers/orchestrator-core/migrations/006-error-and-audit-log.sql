-- RHX2 first-wave: error + audit durable truth.
--
-- Two tables, one migration file (RHX2 design v0.5 §3.5 / Q-Obs2):
--   * nano_error_log  — cross-trace error index (TTL 14d, F4)
--   * nano_audit_log  — protocol/security audit truth (TTL 90d, F11)
--
-- Both tables follow the "main truth + index reference" rule documented
-- in RHX2 design §3.6 (Q-Obs12). They DO NOT store full payloads when
-- another truth (`nano_session_activity_logs`, migration 002) already
-- holds them; instead `nano_audit_log.ref_*` columns reference back.
--
-- Single-write-point: orchestrator-core (Q-Obs1). Per-team write rate is
-- capped at the application layer (≤10/s) to protect this D1 against
-- the storms we already saw in RHX1 closure debugging.
--
-- TTL cleanup: Cloudflare cron trigger (Q-Obs8), wired in Phase 6.

-- ─────────────────────────────────────────────────────────────────
-- nano_error_log — cross-trace, cross-worker error index (TTL 14d)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nano_error_log (
  log_uuid       TEXT PRIMARY KEY,
  trace_uuid     TEXT NOT NULL,
  session_uuid   TEXT,
  team_uuid      TEXT,
  worker         TEXT NOT NULL,
  source_role    TEXT,
  code           TEXT NOT NULL,
  category       TEXT NOT NULL CHECK (category IN (
    'validation', 'transient', 'dependency', 'permanent',
    'security', 'quota', 'conflict'
  )),
  severity       TEXT NOT NULL CHECK (severity IN ('warn', 'error', 'critical')),
  http_status    INTEGER,
  message        TEXT NOT NULL,
  context_json   TEXT,
  rpc_log_failed INTEGER NOT NULL DEFAULT 0 CHECK (rpc_log_failed IN (0, 1)),
  created_at     TEXT NOT NULL,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_nano_error_log_trace_created_at
  ON nano_error_log(trace_uuid, created_at);

CREATE INDEX IF NOT EXISTS idx_nano_error_log_team_created_at
  ON nano_error_log(team_uuid, created_at);

CREATE INDEX IF NOT EXISTS idx_nano_error_log_session_created_at
  ON nano_error_log(session_uuid, created_at);

CREATE INDEX IF NOT EXISTS idx_nano_error_log_severity_created_at
  ON nano_error_log(severity, created_at);

-- ─────────────────────────────────────────────────────────────────
-- nano_audit_log — protocol/security audit truth (TTL 90d, owner-only)
-- ─────────────────────────────────────────────────────────────────
--
-- first-wave event_kinds (RHX2 design §7.2 F11):
--   1. auth.login.success
--   2. auth.api_key.issued
--   3. auth.api_key.revoked
--   4. auth.device.gate_decision
--   5. tenant.cross_tenant_deny
--   6. hook.outcome   (only when final_action != 'continue')
--   7. session.attachment.superseded
--   8. session.replay_lost

CREATE TABLE IF NOT EXISTS nano_audit_log (
  audit_uuid     TEXT PRIMARY KEY,
  trace_uuid     TEXT,
  session_uuid   TEXT,
  team_uuid      TEXT NOT NULL,
  user_uuid      TEXT,
  device_uuid    TEXT,
  worker         TEXT NOT NULL,
  event_kind     TEXT NOT NULL,
  ref_kind       TEXT,
  ref_uuid       TEXT,
  detail_json    TEXT,
  outcome        TEXT NOT NULL CHECK (outcome IN ('ok', 'denied', 'failed')),
  created_at     TEXT NOT NULL,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE,
  FOREIGN KEY (user_uuid) REFERENCES nano_users(user_uuid) ON DELETE SET NULL,
  FOREIGN KEY (device_uuid)
    REFERENCES nano_user_devices(device_uuid) ON DELETE SET NULL,
  FOREIGN KEY (session_uuid)
    REFERENCES nano_conversation_sessions(session_uuid) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_nano_audit_log_team_kind_created_at
  ON nano_audit_log(team_uuid, event_kind, created_at);

CREATE INDEX IF NOT EXISTS idx_nano_audit_log_user_created_at
  ON nano_audit_log(user_uuid, created_at);

CREATE INDEX IF NOT EXISTS idx_nano_audit_log_session_created_at
  ON nano_audit_log(session_uuid, created_at);

CREATE INDEX IF NOT EXISTS idx_nano_audit_log_trace
  ON nano_audit_log(trace_uuid);
