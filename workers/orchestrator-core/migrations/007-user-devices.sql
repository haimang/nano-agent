-- ZX5 Lane D D6 — device truth model freeze(per Q9 owner direction)。
--
-- 决策回顾(Q9):
-- 1. device truth 放 D1 表 — `nano_user_devices` 是 canonical source。
--    `device_uuid` 可以投影进 refresh session / access claim,但 claim 不是 truth。
-- 2. revoke 粒度冻结为 "单设备的全部 token / refresh chain",不做全用户登出。
-- 3. 行为:同 device_uuid 的 refresh 立即失效 + 新 authenticated HTTP/WS attach
--    立即拒绝 + 已存在 live session 若已绑 device_uuid 则 best-effort 立即断开。
--
-- 本 migration 只建 schema;revoke 行为在 orchestrator-auth/orchestrator-core
-- 代码层实现(D6 phase)。
--
-- Schema:
-- - `nano_user_devices`:device canonical truth
-- - `nano_user_device_revocations`:revoke 事件 + 时间;orchestrator-auth
--   refresh / verifyAccessToken 路径检查 device_uuid 是否在最近 revoke 中。

CREATE TABLE IF NOT EXISTS nano_user_devices (
  device_uuid TEXT PRIMARY KEY,
  user_uuid TEXT NOT NULL,
  team_uuid TEXT NOT NULL,
  device_label TEXT,             -- optional 用户友好名称(e.g. "haimang's iPhone")
  device_kind TEXT NOT NULL CHECK (device_kind IN (
    'web', 'wechat-miniprogram', 'cli', 'mobile', 'unknown'
  )),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')) DEFAULT 'active',
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

-- Revoke event log(append-only)— orchestrator-auth refresh / verify
-- 路径在 graceful overlap window 内仍接受 access token,但任何
-- post-revoke 的 refresh 必须 reject;这里记录 revoke 事件用于 audit。
CREATE TABLE IF NOT EXISTS nano_user_device_revocations (
  revocation_uuid TEXT PRIMARY KEY,
  device_uuid TEXT NOT NULL REFERENCES nano_user_devices(device_uuid) ON DELETE CASCADE,
  user_uuid TEXT NOT NULL,
  revoked_at TEXT NOT NULL,
  revoked_by_user_uuid TEXT,     -- 自助 revoke 时 = 自身;后续 admin 路径 = admin uuid
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'self-service' CHECK (source IN (
    'self-service', 'admin', 'security-incident'
  ))
);

CREATE INDEX IF NOT EXISTS idx_nano_user_device_revocations_user_revoked_at
  ON nano_user_device_revocations(user_uuid, revoked_at DESC);
