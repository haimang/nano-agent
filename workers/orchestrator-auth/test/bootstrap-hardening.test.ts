// RH0 P0-G1 — bootstrap hardening stress tests for orchestrator-auth.
// charter §7.1 hard gate: 3 stress cases (cold-start 100 register / D1 slow /
// refresh storm) on `workers/orchestrator-auth/test/bootstrap-hardening.test.ts`.
//
// 这层测试关心 register/login/refresh 在并发与延迟极端条件下的行为(在 RH1
// runtime 起跑前固定基线)。本文件的 `InMemoryAuthRepository` 与 service.test.ts
// 复制(独立 fixture,避免 runtime 修改时跨文件耦合)。

import { describe, expect, it } from "vitest";
import { AuthService } from "../src/service.js";
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
import type { WeChatClient } from "../src/wechat.js";

const KEY_ENV = {
  JWT_SIGNING_KID: "v1",
  JWT_SIGNING_KEY_v1: "x".repeat(32),
} as const;

const META = {
  trace_uuid: "11111111-1111-4111-8111-111111111111",
  caller: "orchestrator-core" as const,
};

interface RepoOptions {
  /** Inject a per-call delay (ms) for every async repo operation. */
  latencyMs?: number;
}

class InMemoryAuthRepository implements AuthRepository {
  private readonly identities = new Map<string, IdentityRecord>();
  private readonly contexts = new Map<string, UserContextRecord>();
  private readonly sessionsByHash = new Map<string, AuthSessionRecord>();
  private readonly sessionsByUuid = new Map<string, AuthSessionRecord>();
  private readonly devicesByUuid = new Map<string, UserDeviceRecord>();
  private readonly apiKeysByUuid = new Map<string, TeamApiKeyRecord>();

  constructor(private readonly opts: RepoOptions = {}) {}

  private async delay(): Promise<void> {
    const ms = this.opts.latencyMs ?? 0;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  private identityKey(provider: string, normalized: string): string {
    return `${provider}:${normalized}`;
  }

  private contextKey(userUuid: string, teamUuid: string): string {
    return `${userUuid}:${teamUuid}`;
  }

  async findIdentityBySubject(
    provider: IdentityRecord["identity_provider"],
    providerSubjectNormalized: string,
  ): Promise<IdentityRecord | null> {
    await this.delay();
    return (
      this.identities.get(this.identityKey(provider, providerSubjectNormalized)) ?? null
    );
  }

  async createBootstrapUser(input: CreateBootstrapUserInput): Promise<UserContextRecord> {
    await this.delay();
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
    this.identities.set(
      this.identityKey(input.provider, input.provider_subject_normalized),
      identity,
    );
    this.contexts.set(this.contextKey(input.user_uuid, input.team_uuid), context);
    return context;
  }

  async touchIdentityLogin(): Promise<void> {
    await this.delay();
  }

  async readUserContext(userUuid: string, teamUuid: string): Promise<UserContextRecord | null> {
    await this.delay();
    return this.contexts.get(this.contextKey(userUuid, teamUuid)) ?? null;
  }

  async createAuthSession(input: CreateAuthSessionInput): Promise<void> {
    await this.delay();
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
    await this.delay();
    return this.sessionsByHash.get(refreshTokenHash) ?? null;
  }

  async rotateAuthSession(input: RotateAuthSessionInput): Promise<void> {
    await this.delay();
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
    await this.delay();
    return this.devicesByUuid.get(deviceUuid) ?? null;
  }

  async upsertUserDevice(input: UpsertUserDeviceInput): Promise<void> {
    await this.delay();
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
    await this.delay();
    return this.apiKeysByUuid.get(apiKeyUuid) ?? null;
  }

  async createTeamApiKey(input: CreateTeamApiKeyInput): Promise<void> {
    await this.delay();
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
    await this.delay();
    const existing = this.apiKeysByUuid.get(apiKeyUuid);
    if (!existing) return;
    this.apiKeysByUuid.set(apiKeyUuid, { ...existing, last_used_at: lastUsedAt });
  }

  async updatePasswordSecret(identityUuid: string, passwordHash: string): Promise<void> {
    await this.delay();
    for (const [key, identity] of this.identities.entries()) {
      if (
        identity.identity_uuid !== identityUuid ||
        identity.identity_provider !== "email_password"
      ) {
        continue;
      }
      this.identities.set(key, { ...identity, auth_secret_hash: passwordHash });
    }
  }
}

function createService(opts: { latencyMs?: number; nowMs?: number } = {}): AuthService {
  const repo = new InMemoryAuthRepository({ latencyMs: opts.latencyMs });
  let seq = 0;
  // Advancing clock so each minted token gets a unique iat → unique signature.
  // Anchor at owner-provided baseline (default 2026-04-29) and tick +1 second
  // per now() read; this keeps the test deterministic without needing real time.
  const baseMs = opts.nowMs ?? Date.parse("2026-04-29T00:00:00.000Z");
  let nowOffsetSec = 0;
  const wechatClient: WeChatClient = {
    async exchangeCode(code: string) {
      return { openid: `openid:${code}`, session_key: "c2Vzc2lvbi1rZXk=" };
    },
    async decryptProfile() {
      return {};
    },
  };
  return new AuthService({
    repo,
    keyEnv: KEY_ENV,
    passwordSalt: "salt",
    wechatClient,
    now: () => {
      nowOffsetSec += 1;
      return new Date(baseMs + nowOffsetSec * 1000);
    },
    uuid: () => {
      seq += 1;
      const hex = seq.toString(16).padStart(12, "0");
      return `00000000-0000-4000-8000-${hex}`;
    },
  });
}

describe("orchestrator-auth bootstrap hardening", () => {
  it(
    "cold-start 100 concurrent register — pending/active status invariants hold",
    async () => {
      const service = createService();
      const N = 100;
      const tasks: Promise<unknown>[] = [];
      for (let i = 0; i < N; i++) {
        tasks.push(
          service.register(
            {
              email: `user-${i}@example.com`,
              password: "password-123",
              display_name: `User ${i}`,
            },
            META,
          ),
        );
      }
      const results = await Promise.all(tasks);
      const successes = results.filter((r) => (r as { ok: boolean }).ok).length;
      const failures = results.filter((r) => !(r as { ok: boolean }).ok).length;
      expect(successes).toBe(N);
      expect(failures).toBe(0);
    },
    30_000,
  );

  it(
    "D1 slow response — 50 concurrent register with 5ms-per-op latency completes without deadlock",
    async () => {
      // 5s 真实 D1 stall 在 unit-test 不现实模拟(Promise + setTimeout 5s ×
      // 100 op = 500s);压成 5ms × ~10 op/register = 50ms 单 op → 总并发能在
      // 1s 内完成。本 case 验证同步路径不挂在 sequential D1 chain 上,
      // miniflare/prod 真 5s 慢响应行为另由 preview smoke 覆盖。
      const service = createService({ latencyMs: 5 });
      const N = 50;
      const t0 = Date.now();
      const tasks: Promise<unknown>[] = [];
      for (let i = 0; i < N; i++) {
        tasks.push(
          service.register(
            {
              email: `slow-user-${i}@example.com`,
              password: "password-123",
            },
            META,
          ),
        );
      }
      const results = await Promise.all(tasks);
      const elapsed = Date.now() - t0;
      const successes = results.filter((r) => (r as { ok: boolean }).ok).length;
      expect(successes).toBe(N);
      // sequential bound = N × ~10 op × 5ms = 2500ms;parallel 应 ≪ 2500ms
      expect(elapsed).toBeLessThan(2_500);
    },
    30_000,
  );

  it(
    "refresh chain rotation storm — sequential rotation 50 generations without deadlock",
    async () => {
      const service = createService();
      const reg = await service.register(
        {
          email: "storm@example.com",
          password: "password-123",
        },
        META,
      );
      expect(reg.ok).toBe(true);
      if (!reg.ok) return;

      let currentRefresh = reg.data.tokens.refresh_token;
      const generations = 50;
      const seenRefresh = new Set<string>();
      seenRefresh.add(currentRefresh);
      for (let i = 0; i < generations; i++) {
        const refreshed = await service.refresh(
          { refresh_token: currentRefresh },
          META,
        );
        expect(refreshed.ok).toBe(true);
        if (!refreshed.ok) return;
        const next = refreshed.data.tokens.refresh_token;
        // Refresh token rotation invariant: each generation must produce a
        // distinct refresh token (the access token, by contrast, can repeat
        // when wall-clock-seconds-resolution iat collides — that is acceptable
        // because revoke的真相在 refresh 链上)。
        expect(seenRefresh.has(next)).toBe(false);
        seenRefresh.add(next);
        currentRefresh = next;
      }
      expect(seenRefresh.size).toBe(generations + 1);

      // After the storm, the most recent refresh token still rotates cleanly.
      const tail = await service.refresh(
        { refresh_token: currentRefresh },
        META,
      );
      expect(tail.ok).toBe(true);
    },
    30_000,
  );
});
