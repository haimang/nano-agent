import type { AuditRecord } from "@haimang/nacp-core/logger";
import { describe, expect, it } from "vitest";
import { AuthService } from "../src/service.js";
import { hashSecret } from "../src/hash.js";
import { mintAccessToken } from "../src/jwt.js";
import type { WeChatClient } from "../src/wechat.js";
import type {
  AuthRepository,
  AuthSessionRecord,
  CreateAuthSessionInput,
  CreateBootstrapUserInput,
  CreateTeamApiKeyInput,
  IdentityRecord,
  RotateAuthSessionInput,
  TeamApiKeyRecord,
  UpsertUserDeviceInput,
  UserContextRecord,
  UserDeviceRecord,
} from "../src/repository.js";

class InMemoryAuthRepository implements AuthRepository {
  private readonly identities = new Map<string, IdentityRecord>();
  private readonly contexts = new Map<string, UserContextRecord>();
  private readonly sessionsByHash = new Map<string, AuthSessionRecord>();
  private readonly sessionsByUuid = new Map<string, AuthSessionRecord>();
  private readonly devicesByUuid = new Map<string, UserDeviceRecord>();
  private readonly apiKeysByUuid = new Map<string, TeamApiKeyRecord>();

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
      team_name: input.team_name,
      team_slug: input.team_slug,
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
      device_uuid: input.device_uuid,
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

  async readUserDevice(deviceUuid: string): Promise<UserDeviceRecord | null> {
    return this.devicesByUuid.get(deviceUuid) ?? null;
  }

  async upsertUserDevice(input: UpsertUserDeviceInput): Promise<void> {
    const existing = this.devicesByUuid.get(input.device_uuid);
    this.devicesByUuid.set(input.device_uuid, {
      device_uuid: input.device_uuid,
      user_uuid: input.user_uuid,
      team_uuid: input.team_uuid,
      device_label: input.device_label,
      device_kind: input.device_kind,
      status: "active",
      created_at: existing?.created_at ?? input.seen_at,
      last_seen_at: input.seen_at,
      revoked_at: null,
      revoked_reason: null,
    });
  }

  async findTeamApiKey(apiKeyUuid: string): Promise<TeamApiKeyRecord | null> {
    return this.apiKeysByUuid.get(apiKeyUuid) ?? null;
  }

  async createTeamApiKey(input: CreateTeamApiKeyInput): Promise<void> {
    const firstContext = Array.from(this.contexts.values())[0];
    this.apiKeysByUuid.set(input.api_key_uuid, {
      api_key_uuid: input.api_key_uuid,
      team_uuid: input.team_uuid,
      owner_user_uuid: firstContext?.user_uuid ?? "00000000-0000-4000-8000-000000000999",
      key_hash: input.key_hash,
      key_salt: input.key_salt,
      label: input.label,
      key_status: "active",
      created_at: input.created_at,
      last_used_at: null,
      revoked_at: null,
    });
  }

  async touchTeamApiKey(apiKeyUuid: string, lastUsedAt: string): Promise<void> {
    const existing = this.apiKeysByUuid.get(apiKeyUuid);
    if (!existing) return;
    this.apiKeysByUuid.set(apiKeyUuid, { ...existing, last_used_at: lastUsedAt });
  }

  async revokeTeamApiKey(apiKeyUuid: string, revokedAt: string): Promise<void> {
    const existing = this.apiKeysByUuid.get(apiKeyUuid);
    if (!existing) return;
    this.apiKeysByUuid.set(apiKeyUuid, {
      ...existing,
      key_status: "revoked",
      revoked_at: revokedAt,
    });
  }

  async updatePasswordSecret(identityUuid: string, passwordHash: string): Promise<void> {
    for (const [key, identity] of this.identities.entries()) {
      if (identity.identity_uuid !== identityUuid || identity.identity_provider !== "email_password") continue;
      this.identities.set(key, { ...identity, auth_secret_hash: passwordHash });
    }
  }

  latestSession(): AuthSessionRecord | null {
    return Array.from(this.sessionsByUuid.values()).at(-1) ?? null;
  }

  device(deviceUuid: string): UserDeviceRecord | null {
    return this.devicesByUuid.get(deviceUuid) ?? null;
  }

  apiKey(apiKeyUuid: string): TeamApiKeyRecord | null {
    return this.apiKeysByUuid.get(apiKeyUuid) ?? null;
  }
}

function createService(
  repo = new InMemoryAuthRepository(),
  wechatClient: WeChatClient = {
    async exchangeCode(code: string) {
      return { openid: `openid:${code}`, session_key: "c2Vzc2lvbi1rZXk=" };
    },
    async decryptProfile() {
      return {};
    },
  },
  auditSink?: (record: AuditRecord) => void,
): AuthService {
  let seq = 0;
  return new AuthService({
    repo,
    keyEnv: KEY_ENV,
    passwordSalt: "salt",
    wechatClient,
    auditPersist: auditSink,
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("AuthService", () => {
  it("registers, logs in, refreshes, and reads me", async () => {
    const repo = new InMemoryAuthRepository();
    const service = createService(repo);

    const register = await service.register(
      {
        email: "user@example.com",
        password: "password-123",
        display_name: "User",
        device_uuid: "11111111-1111-4111-8111-111111111111",
        device_kind: "web",
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
    expect(me.data.team.team_name).toBe("User");
    expect(me.data.team.team_slug).toMatch(/^[a-z0-9-]{1,32}$/);
    expect(me.data.snapshot.device_uuid).toMatch(UUID_RE);

    const refreshed = await service.refresh(
      {
        refresh_token: login.data.tokens.refresh_token,
        device_uuid: login.data.snapshot.device_uuid,
      },
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

  it("uses decrypted WeChat display name when provided", async () => {
    const service = createService(
      new InMemoryAuthRepository(),
      {
        async exchangeCode(code: string) {
          return { openid: `openid:${code}`, session_key: "c2Vzc2lvbi1rZXk=" };
        },
        async decryptProfile() {
          return {
            openid: "openid:abc",
            display_name: "小程序用户",
          };
        },
      },
    );

    const result = await service.wechatLogin(
      { code: "abc", encrypted_data: "ZW5j", iv: "aXY=" },
      META,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.user.display_name).toBe("小程序用户");
  });

  it("rejects mismatched decrypted openid", async () => {
    const service = createService(
      new InMemoryAuthRepository(),
      {
        async exchangeCode(code: string) {
          return { openid: `openid:${code}`, session_key: "c2Vzc2lvbi1rZXk=" };
        },
        async decryptProfile() {
          return {
            openid: "openid:other",
          };
        },
      },
    );

    const result = await service.wechatLogin(
      { code: "abc", encrypted_data: "ZW5j", iv: "aXY=" },
      META,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid-wechat-payload");
    }
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
        device_uuid: register.data.snapshot.device_uuid,
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
        device_uuid: register.data.snapshot.device_uuid,
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

  it("binds refresh to device and rejects mismatched device_uuid", async () => {
    const repo = new InMemoryAuthRepository();
    const service = createService(repo);
    const register = await service.register(
      {
        email: "device@example.com",
        password: "password-123",
        device_uuid: "22222222-2222-4222-8222-222222222222",
        device_kind: "web",
      },
      META,
    );
    expect(register.ok).toBe(true);
    if (!register.ok) return;

    const refreshed = await service.refresh(
      {
        refresh_token: register.data.tokens.refresh_token,
        device_uuid: "33333333-3333-4333-8333-333333333333",
      },
      META,
    );
    expect(refreshed.ok).toBe(false);
    if (!refreshed.ok) {
      expect(refreshed.error.code).toBe("invalid-auth");
    }
  });

  it("creates and verifies API keys", async () => {
    const repo = new InMemoryAuthRepository();
    const service = createService(repo);
    const register = await service.register(
      {
        email: "apikey@example.com",
        password: "password-123",
      },
      META,
    );
    expect(register.ok).toBe(true);
    if (!register.ok) return;

    const created = await service.createApiKey(
      { team_uuid: register.data.team.team_uuid, label: "preview" },
      META,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.api_key.startsWith(`${created.data.key_id}.`)).toBe(true);
    expect(repo.apiKey(created.data.key_id)?.api_key_uuid).toBe(created.data.key_id);
    expect(repo.apiKey(created.data.api_key)).toBeNull();

    const verified = await service.verifyApiKey(
      { api_key: created.data.api_key },
      META,
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.data.team_uuid).toBe(register.data.team.team_uuid);

    const me = await service.me({ access_token: created.data.api_key }, META);
    expect(me.ok).toBe(true);
    if (!me.ok) return;
    expect(me.data.snapshot.device_uuid).toBe("");
  });

  it("emits audit records for login and api key issue", async () => {
    const repo = new InMemoryAuthRepository();
    const audits: AuditRecord[] = [];
    const service = createService(repo, undefined, (record) => audits.push(record));

    const register = await service.register(
      {
        email: "audit@example.com",
        password: "password-123",
        device_uuid: "44444444-4444-4444-8444-444444444444",
        device_kind: "web",
      },
      META,
    );
    expect(register.ok).toBe(true);
    if (!register.ok) return;

    const login = await service.login(
      {
        email: "audit@example.com",
        password: "password-123",
        device_uuid: "44444444-4444-4444-8444-444444444444",
        device_kind: "web",
      },
      META,
    );
    expect(login.ok).toBe(true);

    const created = await service.createApiKey(
      { team_uuid: register.data.team.team_uuid, label: "audit-key" },
      META,
    );
    expect(created.ok).toBe(true);

    expect(audits.map((record) => record.event_kind)).toContain("auth.login.success");
    expect(audits.map((record) => record.event_kind)).toContain("auth.api_key.issued");
    expect(audits.every((record) => record.trace_uuid === META.trace_uuid)).toBe(true);
    expect(audits.every((record) => record.team_uuid === register.data.team.team_uuid)).toBe(true);
  });

  it("emits audit record for api key revoke", async () => {
    const repo = new InMemoryAuthRepository();
    const audits: AuditRecord[] = [];
    const service = createService(repo, undefined, (record) => audits.push(record));

    const register = await service.register(
      {
        email: "audit-revoke@example.com",
        password: "password-123",
        device_uuid: "45444444-4444-4444-8444-444444444444",
        device_kind: "web",
      },
      META,
    );
    expect(register.ok).toBe(true);
    if (!register.ok) return;

    const created = await service.createApiKey(
      { team_uuid: register.data.team.team_uuid, label: "audit-revoke-key" },
      META,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    audits.length = 0;
    const revoked = await service.revokeApiKey(
      {
        team_uuid: register.data.team.team_uuid,
        user_uuid: register.data.user.user_uuid,
        key_id: created.data.key_id,
      },
      META,
    );
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;

    expect(repo.apiKey(created.data.key_id)?.key_status).toBe("revoked");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.event_kind).toBe("auth.api_key.revoked");
    expect(audits[0]?.ref).toEqual({ kind: "api_key", uuid: created.data.key_id });
  });

  it("keeps verifying legacy single-segment API keys", async () => {
    const repo = new InMemoryAuthRepository();
    const service = createService(repo);
    const register = await service.register(
      {
        email: "legacy-api@example.com",
        password: "password-123",
      },
      META,
    );
    expect(register.ok).toBe(true);
    if (!register.ok) return;

    const legacyKey = "nak_legacy_key_id";
    const salt = "legacy-salt";
    await repo.createTeamApiKey({
      api_key_uuid: legacyKey,
      team_uuid: register.data.team.team_uuid,
      key_hash: await hashSecret(legacyKey, salt),
      key_salt: salt,
      label: "legacy",
      created_at: "2026-04-25T00:00:00.000Z",
    });

    const verified = await service.verifyApiKey(
      { api_key: legacyKey },
      META,
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.data.key_id).toBe(legacyKey);
    expect(verified.data.team_uuid).toBe(register.data.team.team_uuid);
  });
});
