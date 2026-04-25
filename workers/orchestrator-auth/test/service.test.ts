import { describe, expect, it } from "vitest";
import { AuthService } from "../src/service.js";
import { mintAccessToken } from "../src/jwt.js";
import type {
  AuthRepository,
  AuthSessionRecord,
  CreateAuthSessionInput,
  CreateBootstrapUserInput,
  IdentityRecord,
  RotateAuthSessionInput,
  UserContextRecord,
} from "../src/repository.js";

class InMemoryAuthRepository implements AuthRepository {
  private readonly identities = new Map<string, IdentityRecord>();
  private readonly contexts = new Map<string, UserContextRecord>();
  private readonly sessionsByHash = new Map<string, AuthSessionRecord>();
  private readonly sessionsByUuid = new Map<string, AuthSessionRecord>();

  private identityKey(provider: string, normalized: string): string {
    return `${provider}:${normalized}`;
  }

  private contextKey(userUuid: string, teamUuid: string): string {
    return `${userUuid}:${teamUuid}`;
  }

  async findIdentityBySubject(provider: IdentityRecord["identity_provider"], providerSubjectNormalized: string): Promise<IdentityRecord | null> {
    return this.identities.get(this.identityKey(provider, providerSubjectNormalized)) ?? null;
  }

  async createBootstrapUser(input: CreateBootstrapUserInput): Promise<UserContextRecord> {
    const identity: IdentityRecord = {
      identity_uuid: input.identity_uuid,
      user_uuid: input.user_uuid,
      team_uuid: input.team_uuid,
      identity_provider: input.provider,
      provider_subject: input.provider_subject,
      provider_subject_normalized: input.provider_subject_normalized,
      auth_secret_hash: input.auth_secret_hash,
      display_name: input.display_name,
      membership_level: 100,
      plan_level: 0,
    };
    const context: UserContextRecord = {
      user_uuid: input.user_uuid,
      team_uuid: input.team_uuid,
      display_name: input.display_name,
      identity_provider: input.provider,
      login_identifier: input.provider_subject,
      membership_level: 100,
      plan_level: 0,
    };
    this.identities.set(this.identityKey(input.provider, input.provider_subject_normalized), identity);
    this.contexts.set(this.contextKey(input.user_uuid, input.team_uuid), context);
    return context;
  }

  async touchIdentityLogin(): Promise<void> {}

  async readUserContext(userUuid: string, teamUuid: string): Promise<UserContextRecord | null> {
    return this.contexts.get(this.contextKey(userUuid, teamUuid)) ?? null;
  }

  async createAuthSession(input: CreateAuthSessionInput): Promise<void> {
    const record: AuthSessionRecord = {
      auth_session_uuid: input.auth_session_uuid,
      user_uuid: input.user_uuid,
      team_uuid: input.team_uuid,
      refresh_token_hash: input.refresh_token_hash,
      expires_at: input.expires_at,
      rotated_from_uuid: input.rotated_from_uuid,
      created_at: input.created_at,
      revoked_at: input.revoked_at ?? null,
      rotated_at: input.rotated_at ?? null,
      last_used_at: input.last_used_at ?? null,
    };
    this.sessionsByHash.set(input.refresh_token_hash, record);
    this.sessionsByUuid.set(input.auth_session_uuid, record);
  }

  async findAuthSessionByHash(refreshTokenHash: string): Promise<AuthSessionRecord | null> {
    return this.sessionsByHash.get(refreshTokenHash) ?? null;
  }

  async rotateAuthSession(input: RotateAuthSessionInput): Promise<void> {
    const current = this.sessionsByUuid.get(input.current_session_uuid);
    if (!current) return;
    const updated: AuthSessionRecord = {
      ...current,
      revoked_at: input.revoked_at,
      rotated_at: input.rotated_at,
      last_used_at: input.last_used_at,
    };
    this.sessionsByHash.set(updated.refresh_token_hash, updated);
    this.sessionsByUuid.set(updated.auth_session_uuid, updated);
    await this.createAuthSession(input.next);
  }

  async updatePasswordSecret(identityUuid: string, passwordHash: string): Promise<void> {
    for (const [key, identity] of this.identities.entries()) {
      if (identity.identity_uuid !== identityUuid || identity.identity_provider !== "email_password") continue;
      this.identities.set(key, { ...identity, auth_secret_hash: passwordHash });
    }
  }
}

function createService(repo = new InMemoryAuthRepository()): AuthService {
  let seq = 0;
  return new AuthService({
    repo,
    keyEnv: KEY_ENV,
    passwordSalt: "salt",
    wechatClient: {
      async exchangeCode(code: string) {
        return { openid: `openid:${code}` };
      },
    },
    now: () => new Date("2026-04-25T00:00:00.000Z"),
    uuid: () => {
      seq += 1;
      return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
    },
  });
}

const KEY_ENV = {
  JWT_SIGNING_KID: "v1",
  JWT_SIGNING_KEY_v1: "x".repeat(32),
} as const;

const META = {
  trace_uuid: "11111111-1111-4111-8111-111111111111",
  caller: "orchestrator-core",
} as const;

describe("AuthService", () => {
  it("registers, logs in, refreshes, and reads me", async () => {
    const repo = new InMemoryAuthRepository();
    const service = createService(repo);

    const register = await service.register(
      {
        email: "user@example.com",
        password: "password-123",
        display_name: "User",
      },
      META,
    );
    expect(register.ok).toBe(true);
    if (!register.ok) return;

    const duplicate = await service.register(
      {
        email: "user@example.com",
        password: "password-123",
      },
      META,
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.code).toBe("identity-already-exists");
    }

    const login = await service.login(
      { email: "user@example.com", password: "password-123" },
      META,
    );
    expect(login.ok).toBe(true);
    if (!login.ok) return;

    const me = await service.me({ access_token: login.data.tokens.access_token }, META);
    expect(me.ok).toBe(true);
    if (!me.ok) return;
    expect(me.data.team.membership_level).toBe(100);

    const refreshed = await service.refresh(
      { refresh_token: login.data.tokens.refresh_token },
      META,
    );
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    expect(refreshed.data.tokens.refresh_token).not.toBe(login.data.tokens.refresh_token);

    const replayed = await service.refresh(
      { refresh_token: login.data.tokens.refresh_token },
      META,
    );
    expect(replayed.ok).toBe(false);
    if (!replayed.ok) {
      expect(replayed.error.code).toBe("refresh-revoked");
    }
  });

  it("requires the old password to reset password", async () => {
    const service = createService();
    const register = await service.register(
      {
        email: "reset@example.com",
        password: "password-123",
      },
      META,
    );
    expect(register.ok).toBe(true);
    if (!register.ok) return;

    const failed = await service.resetPassword(
      {
        access_token: register.data.tokens.access_token,
        old_password: "wrong-pass",
        new_password: "password-456",
      },
      META,
    );
    expect(failed.ok).toBe(false);

    const reset = await service.resetPassword(
      {
        access_token: register.data.tokens.access_token,
        old_password: "password-123",
        new_password: "password-456",
      },
      META,
    );
    expect(reset.ok).toBe(true);

    const relogin = await service.login(
      { email: "reset@example.com", password: "password-456" },
      META,
    );
    expect(relogin.ok).toBe(true);
  });

  it("bootstraps and reuses wechat identities", async () => {
    const service = createService();
    const first = await service.wechatLogin({ code: "abc" }, META);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.user.identity_provider).toBe("wechat");

    const second = await service.wechatLogin({ code: "abc" }, META);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.user.user_uuid).toBe(first.data.user.user_uuid);
  });

  it("rejects non-orchestrator callers", async () => {
    const service = createService();
    const result = await service.login(
      { email: "user@example.com", password: "password-123" },
      {
        trace_uuid: "11111111-1111-4111-8111-111111111111",
        caller: "orchestrator-core-bad",
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid-caller");
    }
  });

  it("rejects forged and cross-team access tokens", async () => {
    const service = createService();
    const register = await service.register(
      {
        email: "tenant@example.com",
        password: "password-123",
      },
      META,
    );
    expect(register.ok).toBe(true);
    if (!register.ok) return;

    const forged = await mintAccessToken(
      {
        sub: register.data.user.user_uuid,
        user_uuid: register.data.user.user_uuid,
        team_uuid: register.data.team.team_uuid,
        membership_level: register.data.team.membership_level,
        source_name: "orchestrator.auth",
      },
      {
        JWT_SIGNING_KID: "v1",
        JWT_SIGNING_KEY_v1: "y".repeat(32),
      },
    );
    const forgedResult = await service.me({ access_token: forged.token }, META);
    expect(forgedResult.ok).toBe(false);
    if (!forgedResult.ok) {
      expect(forgedResult.error.code).toBe("invalid-auth");
    }

    const foreignTeamToken = await mintAccessToken(
      {
        sub: register.data.user.user_uuid,
        user_uuid: register.data.user.user_uuid,
        team_uuid: "99999999-9999-4999-8999-999999999999",
        membership_level: register.data.team.membership_level,
        source_name: "orchestrator.auth",
      },
      KEY_ENV,
    );
    const foreignResult = await service.me(
      { access_token: foreignTeamToken.token },
      META,
    );
    expect(foreignResult.ok).toBe(false);
    if (!foreignResult.ok) {
      expect(foreignResult.error.code).toBe("identity-not-found");
    }
  });
});
