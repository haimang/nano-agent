import type { IdentityProvider } from "@haimang/orchestrator-auth-contract";

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
  updatePasswordSecret(userUuid: string, passwordHash: string, updatedAt: string): Promise<void>;
}

function toIsoString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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
    refresh_token_hash: String(row.refresh_token_hash),
    expires_at: String(row.expires_at),
    rotated_from_uuid: toIsoString(row.rotated_from_uuid),
    created_at: String(row.created_at),
    revoked_at: toIsoString(row.revoked_at),
    rotated_at: toIsoString(row.rotated_at),
    last_used_at: toIsoString(row.last_used_at),
  };
}

export class D1AuthRepository implements AuthRepository {
  constructor(private readonly db: D1Database) {}

  private async withTransaction<T>(work: () => Promise<T>): Promise<T> {
    await this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = await work();
      await this.db.exec("COMMIT");
      return result;
    } catch (error) {
      await this.db.exec("ROLLBACK");
      throw error;
    }
  }

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
       JOIN nano_team_memberships m
         ON m.team_uuid = i.team_uuid AND m.user_uuid = i.user_uuid
       JOIN nano_teams t
         ON t.team_uuid = i.team_uuid
       LEFT JOIN nano_user_profiles p
         ON p.user_uuid = i.user_uuid
      WHERE i.identity_provider = ?1
        AND i.provider_subject_normalized = ?2
      LIMIT 1`,
    )
      .bind(provider, providerSubjectNormalized)
      .first<Record<string, unknown>>();
    return normalizeIdentityRow(row ?? null);
  }

  async createBootstrapUser(input: CreateBootstrapUserInput): Promise<UserContextRecord> {
    return this.withTransaction(async () => {
      await this.db.prepare(
        `INSERT INTO nano_users (user_uuid, created_at) VALUES (?1, ?2)`,
      ).bind(input.user_uuid, input.created_at).run();
      await this.db.prepare(
        `INSERT INTO nano_user_profiles (user_uuid, display_name, avatar_url, updated_at)
         VALUES (?1, ?2, NULL, ?3)`,
      ).bind(input.user_uuid, input.display_name, input.created_at).run();
      await this.db.prepare(
        `INSERT INTO nano_teams (team_uuid, owner_user_uuid, created_at, plan_level)
         VALUES (?1, ?2, ?3, 0)`,
      ).bind(input.team_uuid, input.user_uuid, input.created_at).run();
      await this.db.prepare(
        `INSERT INTO nano_team_memberships (membership_uuid, team_uuid, user_uuid, membership_level, created_at)
         VALUES (?1, ?2, ?3, 100, ?4)`,
      ).bind(input.membership_uuid, input.team_uuid, input.user_uuid, input.created_at).run();
      await this.db.prepare(
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
           identity_status
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 'active')`,
      )
        .bind(
          input.identity_uuid,
          input.user_uuid,
          input.provider,
          input.provider_subject,
          input.provider_subject_normalized,
          input.auth_secret_hash,
          input.team_uuid,
          input.created_at,
        )
        .run();
      return {
        user_uuid: input.user_uuid,
        team_uuid: input.team_uuid,
        display_name: input.display_name,
        identity_provider: input.provider,
        login_identifier: input.provider_subject,
        membership_level: 100,
        plan_level: 0,
      };
    });
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
         ON i.user_uuid = m.user_uuid AND i.team_uuid = m.team_uuid
      WHERE m.user_uuid = ?1
        AND m.team_uuid = ?2
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
         refresh_token_hash,
         expires_at,
         rotated_from_uuid,
         created_at,
         revoked_at,
         rotated_at,
         last_used_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
      .bind(
        input.auth_session_uuid,
        input.user_uuid,
        input.team_uuid,
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
    await this.withTransaction(async () => {
      await this.db.prepare(
        `UPDATE nano_auth_sessions
            SET revoked_at = ?2,
                rotated_at = ?3,
                last_used_at = ?4
          WHERE auth_session_uuid = ?1`,
      )
        .bind(
          input.current_session_uuid,
          input.revoked_at,
          input.rotated_at,
          input.last_used_at,
        )
        .run();
      await this.createAuthSession(input.next);
    });
  }

  async updatePasswordSecret(userUuid: string, passwordHash: string, updatedAt: string): Promise<void> {
    await this.db.prepare(
      `UPDATE nano_user_identities
          SET auth_secret_hash = ?2,
              last_login_at = ?3
        WHERE user_uuid = ?1
          AND identity_provider = 'email_password'`,
    ).bind(userUuid, passwordHash, updatedAt).run();
  }
}
