import {
  OWNER_MEMBERSHIP_LEVEL,
  type IdentityProvider,
} from "@haimang/orchestrator-auth-contract";

export interface IdentityRecord {
  readonly identity_uuid: string;
  readonly user_uuid: string;
  readonly team_uuid: string;
  readonly identity_provider: IdentityProvider;
  readonly provider_subject: string;
  readonly provider_subject_normalized: string;
  readonly auth_secret_hash: string | null;
  readonly display_name: string | null;
  readonly membership_level: number;
  readonly plan_level: number;
}

export interface UserContextRecord {
  readonly user_uuid: string;
  readonly team_uuid: string;
  readonly team_name: string;
  readonly team_slug: string;
  readonly display_name: string | null;
  readonly identity_provider: IdentityProvider;
  readonly login_identifier: string | null;
  readonly membership_level: number;
  readonly plan_level: number;
}

export interface AuthSessionRecord {
  readonly auth_session_uuid: string;
  readonly user_uuid: string;
  readonly team_uuid: string;
  readonly device_uuid: string | null;
  readonly refresh_token_hash: string;
  readonly expires_at: string;
  readonly rotated_from_uuid: string | null;
  readonly created_at: string;
  readonly revoked_at: string | null;
  readonly rotated_at: string | null;
  readonly last_used_at: string | null;
}

export interface CreateBootstrapUserInput {
  readonly identity_uuid: string;
  readonly user_uuid: string;
  readonly team_uuid: string;
  readonly membership_uuid: string;
  readonly team_name: string;
  readonly team_slug: string;
  readonly display_name: string | null;
  readonly provider: IdentityProvider;
  readonly provider_subject: string;
  readonly provider_subject_normalized: string;
  readonly auth_secret_hash: string | null;
  readonly created_at: string;
}

export interface CreateAuthSessionInput {
  readonly auth_session_uuid: string;
  readonly user_uuid: string;
  readonly team_uuid: string;
  readonly device_uuid: string | null;
  readonly refresh_token_hash: string;
  readonly expires_at: string;
  readonly rotated_from_uuid: string | null;
  readonly created_at: string;
  readonly revoked_at?: string | null;
  readonly rotated_at?: string | null;
  readonly last_used_at?: string | null;
}

export interface RotateAuthSessionInput {
  readonly current_session_uuid: string;
  readonly revoked_at: string;
  readonly last_used_at: string;
  readonly rotated_at: string;
  readonly next: CreateAuthSessionInput;
}

export interface UserDeviceRecord {
  readonly device_uuid: string;
  readonly user_uuid: string;
  readonly team_uuid: string;
  readonly device_label: string | null;
  readonly device_kind: string;
  readonly status: string;
  readonly created_at: string;
  readonly last_seen_at: string;
  readonly revoked_at: string | null;
  readonly revoked_reason: string | null;
}

export interface UpsertUserDeviceInput {
  readonly device_uuid: string;
  readonly user_uuid: string;
  readonly team_uuid: string;
  readonly device_label: string | null;
  readonly device_kind: string;
  readonly seen_at: string;
}

export interface TeamApiKeyRecord {
  readonly api_key_uuid: string;
  readonly team_uuid: string;
  readonly owner_user_uuid: string;
  readonly key_hash: string;
  readonly key_salt: string;
  readonly label: string;
  readonly key_status: string;
  readonly created_at: string;
  readonly last_used_at: string | null;
  readonly revoked_at: string | null;
}

export interface CreateTeamApiKeyInput {
  readonly api_key_uuid: string;
  readonly team_uuid: string;
  readonly key_hash: string;
  readonly key_salt: string;
  readonly label: string;
  readonly created_at: string;
}

export interface AuthRepository {
  findIdentityBySubject(
    provider: IdentityProvider,
    providerSubjectNormalized: string,
  ): Promise<IdentityRecord | null>;
  createBootstrapUser(input: CreateBootstrapUserInput): Promise<UserContextRecord>;
  touchIdentityLogin(identityUuid: string, lastLoginAt: string): Promise<void>;
  readUserContext(userUuid: string, teamUuid: string): Promise<UserContextRecord | null>;
  createAuthSession(input: CreateAuthSessionInput): Promise<void>;
  findAuthSessionByHash(refreshTokenHash: string): Promise<AuthSessionRecord | null>;
  rotateAuthSession(input: RotateAuthSessionInput): Promise<void>;
  readUserDevice(deviceUuid: string): Promise<UserDeviceRecord | null>;
  upsertUserDevice(input: UpsertUserDeviceInput): Promise<void>;
  findTeamApiKey(apiKeyUuid: string): Promise<TeamApiKeyRecord | null>;
  createTeamApiKey(input: CreateTeamApiKeyInput): Promise<void>;
  touchTeamApiKey(apiKeyUuid: string, lastUsedAt: string): Promise<void>;
  revokeTeamApiKey(apiKeyUuid: string, revokedAt: string): Promise<void>;
  updatePasswordSecret(identityUuid: string, passwordHash: string, updatedAt: string): Promise<void>;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeUserContextRow(row: Record<string, unknown> | null): UserContextRecord | null {
  if (!row) return null;
  return {
    user_uuid: String(row.user_uuid),
    team_uuid: String(row.team_uuid),
    team_name: String(row.team_name ?? ""),
    team_slug: String(row.team_slug ?? ""),
    display_name: toNullableString(row.display_name),
    identity_provider: String(row.identity_provider) as IdentityProvider,
    login_identifier: toNullableString(row.login_identifier),
    membership_level: toInt(row.membership_level),
    plan_level: toInt(row.plan_level),
  };
}

function normalizeIdentityRow(row: Record<string, unknown> | null): IdentityRecord | null {
  if (!row) return null;
  return {
    identity_uuid: String(row.identity_uuid),
    user_uuid: String(row.user_uuid),
    team_uuid: String(row.team_uuid),
    identity_provider: String(row.identity_provider) as IdentityProvider,
    provider_subject: String(row.provider_subject),
    provider_subject_normalized: String(row.provider_subject_normalized),
    auth_secret_hash: toNullableString(row.auth_secret_hash),
    display_name: toNullableString(row.display_name),
    membership_level: toInt(row.membership_level),
    plan_level: toInt(row.plan_level),
  };
}

function normalizeAuthSessionRow(row: Record<string, unknown> | null): AuthSessionRecord | null {
  if (!row) return null;
  return {
    auth_session_uuid: String(row.auth_session_uuid),
    user_uuid: String(row.user_uuid),
    team_uuid: String(row.team_uuid),
    device_uuid: toNullableString(row.device_uuid),
    refresh_token_hash: String(row.refresh_token_hash),
    expires_at: String(row.expires_at),
    rotated_from_uuid: toNullableString(row.rotated_from_uuid),
    created_at: String(row.created_at),
    revoked_at: toNullableString(row.revoked_at),
    rotated_at: toNullableString(row.rotated_at),
    last_used_at: toNullableString(row.last_used_at),
  };
}

function normalizeUserDeviceRow(row: Record<string, unknown> | null): UserDeviceRecord | null {
  if (!row) return null;
  return {
    device_uuid: String(row.device_uuid),
    user_uuid: String(row.user_uuid),
    team_uuid: String(row.team_uuid),
    device_label: toNullableString(row.device_label),
    device_kind: String(row.device_kind),
    status: String(row.status),
    created_at: String(row.created_at),
    last_seen_at: String(row.last_seen_at),
    revoked_at: toNullableString(row.revoked_at),
    revoked_reason: toNullableString(row.revoked_reason),
  };
}

function normalizeTeamApiKeyRow(row: Record<string, unknown> | null): TeamApiKeyRecord | null {
  if (!row) return null;
  return {
    api_key_uuid: String(row.api_key_uuid),
    team_uuid: String(row.team_uuid),
    owner_user_uuid: String(row.owner_user_uuid),
    key_hash: String(row.key_hash),
    key_salt: String(row.key_salt ?? ""),
    label: String(row.label),
    key_status: String(row.key_status),
    created_at: String(row.created_at),
    last_used_at: toNullableString(row.last_used_at),
    revoked_at: toNullableString(row.revoked_at),
  };
}

export class D1AuthRepository implements AuthRepository {
  constructor(private readonly db: D1Database) {}

  async findIdentityBySubject(
    provider: IdentityProvider,
    providerSubjectNormalized: string,
  ): Promise<IdentityRecord | null> {
    const row = await this.db.prepare(
      `SELECT
         i.identity_uuid,
         i.user_uuid,
         i.team_uuid,
         i.identity_provider,
         i.provider_subject,
         i.provider_subject_normalized,
         i.auth_secret_hash,
         p.display_name,
         m.membership_level,
         t.plan_level
       FROM nano_user_identities i
       JOIN nano_users u
         ON u.user_uuid = i.user_uuid
        JOIN nano_team_memberships m
          ON m.team_uuid = i.team_uuid AND m.user_uuid = i.user_uuid
       JOIN nano_teams t
         ON t.team_uuid = i.team_uuid
       LEFT JOIN nano_user_profiles p
          ON p.user_uuid = i.user_uuid
       WHERE i.identity_provider = ?1
         AND i.provider_subject_normalized = ?2
         AND i.identity_status = 'active'
         AND u.user_status = 'active'
       LIMIT 1`,
    )
      .bind(provider, providerSubjectNormalized)
      .first<Record<string, unknown>>();
    return normalizeIdentityRow(row ?? null);
  }

  async createBootstrapUser(input: CreateBootstrapUserInput): Promise<UserContextRecord> {
    await this.db.batch([
      this.db.prepare(
        `INSERT INTO nano_users (
           user_uuid,
           user_status,
           default_team_uuid,
           is_email_verified,
           created_at,
           updated_at
         ) VALUES (?1, 'active', ?2, 0, ?3, ?3)`,
      ).bind(input.user_uuid, input.team_uuid, input.created_at),
      this.db.prepare(
        `INSERT INTO nano_user_profiles (user_uuid, display_name, avatar_url, updated_at)
         VALUES (?1, ?2, NULL, ?3)`,
      ).bind(input.user_uuid, input.display_name, input.created_at),
      this.db.prepare(
        `INSERT INTO nano_teams (team_uuid, owner_user_uuid, created_at, plan_level, team_name, team_slug)
          VALUES (?1, ?2, ?3, 0, ?4, ?5)`,
      ).bind(input.team_uuid, input.user_uuid, input.created_at, input.team_name, input.team_slug),
      this.db.prepare(
        `INSERT INTO nano_team_memberships (membership_uuid, team_uuid, user_uuid, membership_level, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(
        input.membership_uuid,
        input.team_uuid,
        input.user_uuid,
        OWNER_MEMBERSHIP_LEVEL,
        input.created_at,
      ),
      this.db.prepare(
        `INSERT INTO nano_user_identities (
           identity_uuid,
           user_uuid,
           identity_provider,
           provider_subject,
           provider_subject_normalized,
           auth_secret_hash,
           team_uuid,
           created_at,
           last_login_at,
           password_updated_at,
           identity_status
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8, 'active')`,
      ).bind(
        input.identity_uuid,
        input.user_uuid,
        input.provider,
        input.provider_subject,
        input.provider_subject_normalized,
        input.auth_secret_hash,
        input.team_uuid,
        input.created_at,
      ),
    ]);
    return {
      user_uuid: input.user_uuid,
      team_uuid: input.team_uuid,
      team_name: input.team_name,
      team_slug: input.team_slug,
      display_name: input.display_name,
      identity_provider: input.provider,
      login_identifier: input.provider_subject,
      membership_level: OWNER_MEMBERSHIP_LEVEL,
      plan_level: 0,
    };
  }

  async touchIdentityLogin(identityUuid: string, lastLoginAt: string): Promise<void> {
    await this.db.prepare(
      `UPDATE nano_user_identities
          SET last_login_at = ?2
        WHERE identity_uuid = ?1`,
    ).bind(identityUuid, lastLoginAt).run();
  }

  async readUserContext(userUuid: string, teamUuid: string): Promise<UserContextRecord | null> {
    const row = await this.db.prepare(
      `SELECT
         m.user_uuid,
         m.team_uuid,
         t.team_name,
         t.team_slug,
         p.display_name,
         i.identity_provider,
         i.provider_subject AS login_identifier,
         m.membership_level,
         t.plan_level
       FROM nano_team_memberships m
       JOIN nano_teams t
         ON t.team_uuid = m.team_uuid
       LEFT JOIN nano_user_profiles p
          ON p.user_uuid = m.user_uuid
       LEFT JOIN nano_user_identities i
         ON i.user_uuid = m.user_uuid AND i.team_uuid = m.team_uuid AND i.identity_status = 'active'
       JOIN nano_users u
         ON u.user_uuid = m.user_uuid
       WHERE m.user_uuid = ?1
         AND m.team_uuid = ?2
         AND u.user_status = 'active'
       ORDER BY
        CASE WHEN i.identity_provider = 'email_password' THEN 0 ELSE 1 END,
        i.created_at ASC
      LIMIT 1`,
    )
      .bind(userUuid, teamUuid)
      .first<Record<string, unknown>>();
    return normalizeUserContextRow(row ?? null);
  }

  async createAuthSession(input: CreateAuthSessionInput): Promise<void> {
    await this.db.prepare(
      `INSERT INTO nano_auth_sessions (
         auth_session_uuid,
         user_uuid,
         team_uuid,
         device_uuid,
         refresh_token_hash,
         expires_at,
         rotated_from_uuid,
         created_at,
         revoked_at,
         rotated_at,
         last_used_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
      .bind(
        input.auth_session_uuid,
        input.user_uuid,
        input.team_uuid,
        input.device_uuid ?? null,
        input.refresh_token_hash,
        input.expires_at,
        input.rotated_from_uuid,
        input.created_at,
        input.revoked_at ?? null,
        input.rotated_at ?? null,
        input.last_used_at ?? null,
      )
      .run();
  }

  async findAuthSessionByHash(refreshTokenHash: string): Promise<AuthSessionRecord | null> {
    const row = await this.db.prepare(
      `SELECT
         auth_session_uuid,
         user_uuid,
         team_uuid,
         device_uuid,
         refresh_token_hash,
         expires_at,
         rotated_from_uuid,
         created_at,
         revoked_at,
         rotated_at,
         last_used_at
       FROM nano_auth_sessions
      WHERE refresh_token_hash = ?1
      LIMIT 1`,
    )
      .bind(refreshTokenHash)
      .first<Record<string, unknown>>();
    return normalizeAuthSessionRow(row ?? null);
  }

  async rotateAuthSession(input: RotateAuthSessionInput): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `UPDATE nano_auth_sessions
            SET revoked_at = ?2,
                rotated_at = ?3,
                last_used_at = ?4
          WHERE auth_session_uuid = ?1`,
      ).bind(
        input.current_session_uuid,
        input.revoked_at,
        input.rotated_at,
        input.last_used_at,
      ),
      this.db.prepare(
         `INSERT INTO nano_auth_sessions (
            auth_session_uuid,
            user_uuid,
            team_uuid,
            device_uuid,
            refresh_token_hash,
            expires_at,
            rotated_from_uuid,
            created_at,
            revoked_at,
            rotated_at,
            last_used_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
       ).bind(
         input.next.auth_session_uuid,
         input.next.user_uuid,
         input.next.team_uuid,
         input.next.device_uuid ?? null,
         input.next.refresh_token_hash,
         input.next.expires_at,
         input.next.rotated_from_uuid,
         input.next.created_at,
        input.next.revoked_at ?? null,
        input.next.rotated_at ?? null,
        input.next.last_used_at ?? null,
      ),
    ]);
  }

  async readUserDevice(deviceUuid: string): Promise<UserDeviceRecord | null> {
    const row = await this.db.prepare(
      `SELECT
         device_uuid,
         user_uuid,
         team_uuid,
         device_label,
         device_kind,
         status,
         created_at,
         last_seen_at,
         revoked_at,
         revoked_reason
       FROM nano_user_devices
      WHERE device_uuid = ?1
      LIMIT 1`,
    ).bind(deviceUuid).first<Record<string, unknown>>();
    return normalizeUserDeviceRow(row ?? null);
  }

  async upsertUserDevice(input: UpsertUserDeviceInput): Promise<void> {
    await this.db.prepare(
      `INSERT INTO nano_user_devices (
         device_uuid,
         user_uuid,
         team_uuid,
         device_label,
         device_kind,
         status,
         created_at,
         last_seen_at,
         revoked_at,
         revoked_reason
       ) VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6, NULL, NULL)
       ON CONFLICT(device_uuid) DO UPDATE SET
         user_uuid = excluded.user_uuid,
         team_uuid = excluded.team_uuid,
         device_label = excluded.device_label,
         device_kind = excluded.device_kind,
         status = 'active',
         last_seen_at = excluded.last_seen_at,
         revoked_at = NULL,
         revoked_reason = NULL`,
    ).bind(
      input.device_uuid,
      input.user_uuid,
      input.team_uuid,
      input.device_label,
      input.device_kind,
      input.seen_at,
    ).run();
  }

  async findTeamApiKey(apiKeyUuid: string): Promise<TeamApiKeyRecord | null> {
    const row = await this.db.prepare(
      `SELECT
         k.api_key_uuid,
         k.team_uuid,
         t.owner_user_uuid,
         k.key_hash,
         k.key_salt,
         k.label,
         k.key_status,
         k.created_at,
         k.last_used_at,
         k.revoked_at
       FROM nano_team_api_keys k
       JOIN nano_teams t
         ON t.team_uuid = k.team_uuid
      WHERE k.api_key_uuid = ?1
      LIMIT 1`,
    ).bind(apiKeyUuid).first<Record<string, unknown>>();
    return normalizeTeamApiKeyRow(row ?? null);
  }

  async createTeamApiKey(input: CreateTeamApiKeyInput): Promise<void> {
    await this.db.prepare(
      `INSERT INTO nano_team_api_keys (
         api_key_uuid,
         team_uuid,
         key_hash,
         key_salt,
         label,
         key_status,
         scopes_json,
         created_at,
         last_used_at,
         revoked_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, 'active', NULL, ?6, NULL, NULL)`,
    ).bind(
      input.api_key_uuid,
      input.team_uuid,
      input.key_hash,
      input.key_salt,
      input.label,
      input.created_at,
    ).run();
  }

  async touchTeamApiKey(apiKeyUuid: string, lastUsedAt: string): Promise<void> {
    await this.db.prepare(
      `UPDATE nano_team_api_keys
           SET last_used_at = ?2
         WHERE api_key_uuid = ?1`,
    ).bind(apiKeyUuid, lastUsedAt).run();
  }

  async revokeTeamApiKey(apiKeyUuid: string, revokedAt: string): Promise<void> {
    await this.db.prepare(
      `UPDATE nano_team_api_keys
          SET key_status = 'revoked',
              revoked_at = ?2
        WHERE api_key_uuid = ?1`,
    ).bind(apiKeyUuid, revokedAt).run();
  }

  async updatePasswordSecret(identityUuid: string, passwordHash: string, updatedAt: string): Promise<void> {
    await this.db.prepare(
      `UPDATE nano_user_identities
          SET auth_secret_hash = ?2,
              password_updated_at = ?3
        WHERE identity_uuid = ?1
          AND identity_provider = 'email_password'`,
    ).bind(identityUuid, passwordHash, updatedAt).run();
  }
}
