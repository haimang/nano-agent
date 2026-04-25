CREATE TABLE IF NOT EXISTS nano_users (
  user_uuid TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nano_user_profiles (
  user_uuid TEXT PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_uuid) REFERENCES nano_users(user_uuid)
);

CREATE TABLE IF NOT EXISTS nano_user_identities (
  identity_uuid TEXT PRIMARY KEY,
  user_uuid TEXT NOT NULL,
  identity_provider TEXT NOT NULL CHECK (identity_provider IN ('email_password', 'wechat')),
  provider_subject TEXT NOT NULL,
  provider_subject_normalized TEXT NOT NULL,
  auth_secret_hash TEXT,
  team_uuid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  identity_status TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY (user_uuid) REFERENCES nano_users(user_uuid)
);

CREATE TABLE IF NOT EXISTS nano_teams (
  team_uuid TEXT PRIMARY KEY,
  owner_user_uuid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  plan_level INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (owner_user_uuid) REFERENCES nano_users(user_uuid)
);

CREATE TABLE IF NOT EXISTS nano_team_memberships (
  membership_uuid TEXT PRIMARY KEY,
  team_uuid TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  membership_level INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid),
  FOREIGN KEY (user_uuid) REFERENCES nano_users(user_uuid)
);

CREATE TABLE IF NOT EXISTS nano_auth_sessions (
  auth_session_uuid TEXT PRIMARY KEY,
  user_uuid TEXT NOT NULL,
  team_uuid TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  rotated_from_uuid TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  rotated_at TEXT,
  last_used_at TEXT,
  FOREIGN KEY (user_uuid) REFERENCES nano_users(user_uuid),
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid),
  FOREIGN KEY (rotated_from_uuid) REFERENCES nano_auth_sessions(auth_session_uuid)
);

CREATE TABLE IF NOT EXISTS nano_team_api_keys (
  api_key_uuid TEXT PRIMARY KEY,
  team_uuid TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nano_user_identities_provider_subject
  ON nano_user_identities(identity_provider, provider_subject_normalized);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nano_team_memberships_team_user
  ON nano_team_memberships(team_uuid, user_uuid);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nano_auth_sessions_refresh_hash
  ON nano_auth_sessions(refresh_token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nano_team_api_keys_hash
  ON nano_team_api_keys(key_hash);
