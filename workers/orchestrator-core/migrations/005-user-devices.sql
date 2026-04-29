-- User-device truth and revoke audit.
--
-- `nano_user_devices` is the canonical device source. Access/refresh claims may
-- project device_uuid, but revoke decisions are anchored here.

CREATE TABLE IF NOT EXISTS nano_user_devices (
  device_uuid TEXT PRIMARY KEY,
  user_uuid TEXT NOT NULL,
  team_uuid TEXT NOT NULL,
  device_label TEXT,
  device_kind TEXT NOT NULL CHECK (device_kind IN (
    'web', 'wechat-miniprogram', 'cli', 'mobile', 'unknown'
  )),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_reason TEXT,
  FOREIGN KEY (user_uuid) REFERENCES nano_users(user_uuid) ON DELETE CASCADE,
  FOREIGN KEY (team_uuid) REFERENCES nano_teams(team_uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nano_user_devices_user_active
  ON nano_user_devices(user_uuid, status);

CREATE INDEX IF NOT EXISTS idx_nano_user_devices_team_status
  ON nano_user_devices(team_uuid, status);

CREATE TABLE IF NOT EXISTS nano_user_device_revocations (
  revocation_uuid TEXT PRIMARY KEY,
  device_uuid TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  revoked_at TEXT NOT NULL,
  revoked_by_user_uuid TEXT,
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'self-service'
    CHECK (source IN ('self-service', 'admin', 'security-incident')),
  FOREIGN KEY (device_uuid)
    REFERENCES nano_user_devices(device_uuid) ON DELETE CASCADE,
  FOREIGN KEY (user_uuid) REFERENCES nano_users(user_uuid) ON DELETE CASCADE,
  FOREIGN KEY (revoked_by_user_uuid) REFERENCES nano_users(user_uuid)
);

CREATE INDEX IF NOT EXISTS idx_nano_user_device_revocations_user_revoked_at
  ON nano_user_device_revocations(user_uuid, revoked_at DESC);
