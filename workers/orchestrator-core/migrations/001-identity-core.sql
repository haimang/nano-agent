-- Identity, auth-session, team, and API-key truth.
--
-- RHX1 consolidates the earlier team display-name, device binding, and API-key
-- salt fragments into the base identity cluster so a fresh D1 apply yields the
-- current runtime schema without historical table-swap residue.

CREATE TABLE IF NOT EXISTS nano_users (
  user_uuid TEXT PRIMARY KEY,
  user_status TEXT NOT NULL DEFAULT 'active'
    CHECK (user_status IN ('active', 'suspended', 'deleted')),
  default_team_uuid TEXT NOT NULL,
  is_email_verified INTEGER NOT NULL DEFAULT 0
    CHECK (is_email_verified IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nano_user_profiles (
  user_uuid TEXT PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_uuid) REFERENCES nano_users(user_uuid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nano_user_identities (
  identity_uuid TEXT PRIMARY KEY,
  user_uuid TEXT NOT NULL,
  identity_provider TEXT NOT NULL
    CHECK (identity_provider IN ('email_password', 'wechat')),
  provider_subject TEXT NOT NULL,
  provider_subject_normalized TEXT NOT NULL,
  auth_secret_hash TEXT,
  team_uuid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  password_updated_at TEXT,
  identity_status TEXT NOT NULL DEFAULT 'active'
    CHECK (identity_status IN ('active', 'pending_verification', 'suspended')),
  FOREIGN KEY (user_uuid) REFERENCES nano_users(user_uuid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nano_teams (
  team_uuid TEXT PRIMARY KEY,
  owner_user_uuid TEXT NOT NULL,
  team_name TEXT NOT NULL DEFAULT '',
  team_slug TEXT,
  created_at TEXT NOT NULL,
  plan_level INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (owner_user_uuid) REFERENCES nano_users(user_uuid)
);

CREATE TABLE IF NOT EXISTS nano_team_memberships (
  membership_uuid TEXT PRIMARY KEY,
  team_uuid TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  membership_level INTEGER NOT NULL CHECK (membership_level >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE,
  FOREIGN KEY (user_uuid) REFERENCES nano_users(user_uuid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS nano_auth_sessions (
  auth_session_uuid TEXT PRIMARY KEY,
  user_uuid TEXT NOT NULL,
  team_uuid TEXT NOT NULL,
  device_uuid TEXT,
  refresh_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  rotated_from_uuid TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  rotated_at TEXT,
  last_used_at TEXT,
  FOREIGN KEY (user_uuid) REFERENCES nano_users(user_uuid) ON DELETE CASCADE,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE,
  FOREIGN KEY (rotated_from_uuid) REFERENCES nano_auth_sessions(auth_session_uuid)
);

CREATE TABLE IF NOT EXISTS nano_team_api_keys (
  api_key_uuid TEXT PRIMARY KEY,
  team_uuid TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_salt TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  key_status TEXT NOT NULL DEFAULT 'active'
    CHECK (key_status IN ('active', 'rotating', 'revoked')),
  scopes_json TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nano_user_identities_provider_subject
  ON nano_user_identities(identity_provider, provider_subject_normalized);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nano_team_memberships_team_user
  ON nano_team_memberships(team_uuid, user_uuid);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nano_auth_sessions_refresh_hash
  ON nano_auth_sessions(refresh_token_hash);

CREATE INDEX IF NOT EXISTS idx_nano_auth_sessions_device_uuid
  ON nano_auth_sessions(device_uuid);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nano_team_api_keys_hash
  ON nano_team_api_keys(key_hash);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nano_teams_team_slug
  ON nano_teams(team_slug);
