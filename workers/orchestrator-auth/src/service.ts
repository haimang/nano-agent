import {
  AccessTokenInputSchema,
  CreateApiKeyInputSchema,
  VerifyApiKeyInputSchema,
  LoginInputSchema,
  RegisterInputSchema,
  ResetPasswordInputSchema,
  VerifyApiKeyEnvelopeSchema,
  WeChatLoginInputSchema,
  RefreshInputSchema,
  okEnvelope,
  type AuthFlowResult,
  type AuthSnapshot,
  type AuthView,
  type AccessTokenClaims,
  type CreateApiKeyEnvelope,
  type CreateApiKeyResult,
  type LoginEnvelope,
  type MeEnvelope,
  type RefreshEnvelope,
  type RegisterEnvelope,
  type ResetPasswordEnvelope,
  type VerifyApiKeyEnvelope,
  type VerifyApiKeyResult,
  type VerifyTokenEnvelope,
  type WeChatLoginEnvelope,
} from "@haimang/orchestrator-auth-contract";
import { assertAuthMeta, AuthServiceError, normalizeKnownAuthError } from "./errors.js";
import { hashSecret, randomOpaqueToken } from "./hash.js";
import { mintAccessToken, verifyAccessToken, type JwtEnv } from "./jwt.js";
import type {
  AuthRepository,
  CreateAuthSessionInput,
  IdentityRecord,
  TeamApiKeyRecord,
  UserContextRecord,
} from "./repository.js";
import type { WeChatClient } from "./wechat.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const API_KEY_PREFIX = "nak_";
const TEAM_SLUG_RETRY_LIMIT = 5;
const TEAM_SLUG_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const DEVICE_KIND_SET = new Set([
  "web",
  "wechat-miniprogram",
  "cli",
  "mobile",
  "unknown",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /unique/i.test(error.message) && /constraint/i.test(error.message);
}

export interface AuthServiceDeps {
  readonly repo: AuthRepository;
  readonly keyEnv: JwtEnv;
  readonly passwordSalt?: string;
  readonly wechatClient?: WeChatClient;
  readonly now?: () => Date;
  readonly uuid?: () => string;
  readonly sourceName?: string;
}

interface DeviceInput {
  readonly device_uuid: string;
  readonly device_label: string | null;
  readonly device_kind: string;
}

export class AuthService {
  private readonly now: () => Date;
  private readonly uuid: () => string;
  private readonly sourceName: string;

  constructor(private readonly deps: AuthServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.uuid = deps.uuid ?? (() => crypto.randomUUID());
    this.sourceName = deps.sourceName ?? "orchestrator.auth";
  }

  private requirePasswordSalt(): string {
    if (!this.deps.passwordSalt || this.deps.passwordSalt.length === 0) {
      throw new AuthServiceError("worker-misconfigured", 503, "PASSWORD_SALT must be configured");
    }
    return this.deps.passwordSalt;
  }

  private requireWeChatClient(): WeChatClient {
    if (!this.deps.wechatClient) {
      throw new AuthServiceError("worker-misconfigured", 503, "WECHAT_APPID and WECHAT_SECRET must be configured");
    }
    return this.deps.wechatClient;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private deriveDisplayName(emailOrName: string): string {
    const trimmed = emailOrName.trim();
    if (trimmed.includes("@")) {
      const [local] = trimmed.split("@");
      return (local && local.length > 0 ? local : "user").slice(0, 80);
    }
    return trimmed.slice(0, 80);
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private readDeviceInput(rawInput: unknown, fallbackKind: string): DeviceInput {
    const record = isRecord(rawInput) ? rawInput : {};
    const requestedUuid = typeof record.device_uuid === "string" ? record.device_uuid.trim() : "";
    const requestedLabel = typeof record.device_label === "string" ? record.device_label.trim() : "";
    const requestedKind = typeof record.device_kind === "string" ? record.device_kind.trim() : "";
    return {
      device_uuid: UUID_RE.test(requestedUuid) ? requestedUuid : this.uuid(),
      device_label: requestedLabel.length > 0 ? requestedLabel.slice(0, 80) : null,
      device_kind: DEVICE_KIND_SET.has(requestedKind) ? requestedKind : fallbackKind,
    };
  }

  private requireBoundDeviceUuid(rawInput: unknown, currentDeviceUuid: string | null): DeviceInput {
    if (currentDeviceUuid && !UUID_RE.test(currentDeviceUuid)) {
      throw new AuthServiceError("invalid-auth", 401, "refresh session device binding is invalid");
    }
    const requested = this.readDeviceInput(rawInput, "unknown");
    if (!currentDeviceUuid) return requested;
    if (
      isRecord(rawInput) &&
      typeof rawInput.device_uuid === "string" &&
      rawInput.device_uuid.trim().length > 0 &&
      rawInput.device_uuid.trim() !== currentDeviceUuid
    ) {
      throw new AuthServiceError("invalid-auth", 401, "refresh token is bound to another device");
    }
    return {
      device_uuid: currentDeviceUuid,
      device_label: requested.device_label,
      device_kind: requested.device_kind,
    };
  }

  private accessClaimsFromContext(
    context: UserContextRecord,
    deviceUuid: string,
    sourceName = this.sourceName,
  ): Omit<AccessTokenClaims, "iat" | "exp" | "typ"> {
    return {
      sub: context.user_uuid,
      user_uuid: context.user_uuid,
      team_uuid: context.team_uuid,
      device_uuid: deviceUuid,
      membership_level: context.membership_level,
      source_name: sourceName,
    } as const;
  }

  private buildSnapshot(
    context: UserContextRecord,
    exp: number,
    deviceUuid: string,
    sourceName = this.sourceName,
  ): AuthSnapshot {
    return {
      sub: context.user_uuid,
      user_uuid: context.user_uuid,
      team_uuid: context.team_uuid,
      tenant_uuid: context.team_uuid,
      device_uuid: deviceUuid,
      tenant_source: "claim",
      membership_level: context.membership_level,
      source_name: sourceName,
      exp,
    };
  }

  private buildView(
    context: UserContextRecord,
    exp: number,
    deviceUuid: string,
    sourceName = this.sourceName,
  ): AuthView {
    return {
      user: {
        user_uuid: context.user_uuid,
        display_name: context.display_name,
        identity_provider: context.identity_provider,
        login_identifier: context.login_identifier,
      },
      team: {
        team_uuid: context.team_uuid,
        team_name: context.team_name,
        team_slug: context.team_slug,
        membership_level: context.membership_level,
        plan_level: context.plan_level,
      },
      snapshot: this.buildSnapshot(context, exp, deviceUuid, sourceName),
    };
  }

  private async recordDevice(context: UserContextRecord, device: DeviceInput, seenAt: string): Promise<void> {
    await this.deps.repo.upsertUserDevice({
      device_uuid: device.device_uuid,
      user_uuid: context.user_uuid,
      team_uuid: context.team_uuid,
      device_label: device.device_label,
      device_kind: device.device_kind,
      seen_at: seenAt,
    });
  }

  private async issueTokens(
    context: UserContextRecord,
    device: DeviceInput,
    sourceName = this.sourceName,
  ): Promise<AuthFlowResult> {
    const createdAt = this.nowIso();
    await this.recordDevice(context, device, createdAt);
    const refreshToken = randomOpaqueToken();
    const refreshExpiresIn = 30 * 24 * 60 * 60;
    const refreshExpiresAt = new Date(this.now().getTime() + refreshExpiresIn * 1000).toISOString();
    const refreshTokenHash = await hashSecret(refreshToken, this.requirePasswordSalt());
    const sessionInput: CreateAuthSessionInput = {
      auth_session_uuid: this.uuid(),
      user_uuid: context.user_uuid,
      team_uuid: context.team_uuid,
      device_uuid: device.device_uuid,
      refresh_token_hash: refreshTokenHash,
      expires_at: refreshExpiresAt,
      rotated_from_uuid: null,
      created_at: createdAt,
    };
    await this.deps.repo.createAuthSession(sessionInput);
    const access = await mintAccessToken(
      this.accessClaimsFromContext(context, device.device_uuid, sourceName),
      this.deps.keyEnv,
    );
    return {
      tokens: {
        access_token: access.token,
        refresh_token: refreshToken,
        expires_in: access.exp - Math.floor(Date.now() / 1000),
        refresh_expires_in: refreshExpiresIn,
        kid: access.kid,
      },
      ...this.buildView(context, access.exp, device.device_uuid, sourceName),
    };
  }

  private async ensureContextFromIdentity(identity: IdentityRecord): Promise<UserContextRecord> {
    const context = await this.deps.repo.readUserContext(identity.user_uuid, identity.team_uuid);
    if (!context) {
      throw new AuthServiceError("identity-not-found", 404, "user/team context not found");
    }
    return context;
  }

  private slugifyBase(input: string): string {
    const normalized = input
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return (normalized.length > 0 ? normalized : "team").slice(0, 25);
  }

  private randomSlugSuffix(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes, (value) => TEAM_SLUG_ALPHABET[value % 36]).join("");
  }

  private buildTeamSlug(teamName: string): string {
    return `${this.slugifyBase(teamName)}-${this.randomSlugSuffix()}`;
  }

  private async createBootstrapContext(input: {
    readonly display_name: string;
    readonly provider: IdentityRecord["identity_provider"];
    readonly provider_subject: string;
    readonly provider_subject_normalized: string;
    readonly auth_secret_hash: string | null;
    readonly created_at: string;
  }): Promise<UserContextRecord> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < TEAM_SLUG_RETRY_LIMIT; attempt += 1) {
      const teamName = input.display_name;
      const teamSlug = this.buildTeamSlug(teamName);
      try {
        return await this.deps.repo.createBootstrapUser({
          identity_uuid: this.uuid(),
          user_uuid: this.uuid(),
          team_uuid: this.uuid(),
          membership_uuid: this.uuid(),
          team_name: teamName,
          team_slug: teamSlug,
          display_name: input.display_name,
          provider: input.provider,
          provider_subject: input.provider_subject,
          provider_subject_normalized: input.provider_subject_normalized,
          auth_secret_hash: input.auth_secret_hash,
          created_at: input.created_at,
        });
      } catch (error) {
        lastError = error;
        if (!isUniqueConstraintError(error)) throw error;
      }
    }
    throw (
      lastError ?? new AuthServiceError("worker-misconfigured", 500, "failed to allocate a unique team slug")
    );
  }

  private parseApiKeyId(apiKey: string): string {
    const trimmed = apiKey.trim();
    if (!trimmed.startsWith(API_KEY_PREFIX)) {
      throw new AuthServiceError("invalid-auth", 401, "api key must start with nak_");
    }
    const dotIndex = trimmed.indexOf(".");
    const keyId = dotIndex === -1 ? trimmed : trimmed.slice(0, dotIndex);
    if (keyId.length <= API_KEY_PREFIX.length) {
      throw new AuthServiceError("invalid-auth", 401, "api key identifier missing");
    }
    return keyId;
  }

  private async verifyApiKeyRecord(apiKey: string): Promise<{
    readonly result: VerifyApiKeyResult;
    readonly context: UserContextRecord;
    readonly record: TeamApiKeyRecord;
  }> {
    const keyId = this.parseApiKeyId(apiKey);
    const record = await this.deps.repo.findTeamApiKey(keyId);
    if (!record || record.revoked_at || record.key_status !== "active") {
      throw new AuthServiceError("invalid-auth", 401, "api key not found or revoked");
    }
    const expectedHash = await hashSecret(apiKey, record.key_salt);
    if (expectedHash !== record.key_hash) {
      throw new AuthServiceError("invalid-auth", 401, "api key mismatch");
    }
    const context = await this.deps.repo.readUserContext(record.owner_user_uuid, record.team_uuid);
    if (!context) {
      throw new AuthServiceError("identity-not-found", 404, "api key owner context not found");
    }
    await this.deps.repo.touchTeamApiKey(record.api_key_uuid, this.nowIso());
    return {
      record,
      context,
      result: {
        supported: true,
        key_id: record.api_key_uuid,
        team_uuid: record.team_uuid,
        user_uuid: record.owner_user_uuid,
        membership_level: context.membership_level,
        source_name: `${this.sourceName}.api-key`,
      },
    };
  }

  private async authenticateBearer(input: { access_token: string }): Promise<{
    readonly context: UserContextRecord;
    readonly exp: number;
    readonly deviceUuid: string;
    readonly sourceName: string;
  }> {
    if (input.access_token.startsWith(API_KEY_PREFIX)) {
      const verified = await this.verifyApiKeyRecord(input.access_token);
      return {
        context: verified.context,
        exp: Math.floor(Date.now() / 1000) + 3600,
        deviceUuid: "",
        sourceName: verified.result.source_name,
      };
    }
    const claims = await verifyAccessToken(input.access_token, this.deps.keyEnv);
    const context = await this.deps.repo.readUserContext(
      claims.user_uuid ?? claims.sub,
      claims.team_uuid ?? claims.tenant_uuid!,
    );
    if (!context) {
      throw new AuthServiceError("identity-not-found", 404, "user/team context not found");
    }
    if (typeof claims.device_uuid !== "string" || !UUID_RE.test(claims.device_uuid)) {
      throw new AuthServiceError("invalid-auth", 401, "access token missing device_uuid");
    }
    return {
      context,
      exp: claims.exp ?? Math.floor(Date.now() / 1000) + 3600,
      deviceUuid: claims.device_uuid,
      sourceName: claims.source_name ?? this.sourceName,
    };
  }

  async register(rawInput: unknown, rawMeta: unknown): Promise<RegisterEnvelope> {
    try {
      assertAuthMeta(rawMeta);
      const input = RegisterInputSchema.parse(rawInput);
      const normalizedEmail = this.normalizeEmail(input.email);
      const existing = await this.deps.repo.findIdentityBySubject("email_password", normalizedEmail);
      if (existing) {
        throw new AuthServiceError("identity-already-exists", 409, "email identity already exists");
      }
      const passwordHash = await hashSecret(input.password, this.requirePasswordSalt());
      const createdAt = this.nowIso();
      const displayName = input.display_name ?? this.deriveDisplayName(input.email);
      const device = this.readDeviceInput(rawInput, "web");
      const context = await this.createBootstrapContext({
        display_name: displayName,
        provider: "email_password",
        provider_subject: input.email,
        provider_subject_normalized: normalizedEmail,
        auth_secret_hash: passwordHash,
        created_at: createdAt,
      });
      return okEnvelope(await this.issueTokens(context, device));
    } catch (error) {
      return normalizeKnownAuthError<AuthFlowResult>(error);
    }
  }

  async login(rawInput: unknown, rawMeta: unknown): Promise<LoginEnvelope> {
    try {
      assertAuthMeta(rawMeta);
      const input = LoginInputSchema.parse(rawInput);
      const normalizedEmail = this.normalizeEmail(input.email);
      const identity = await this.deps.repo.findIdentityBySubject("email_password", normalizedEmail);
      if (!identity || !identity.auth_secret_hash) {
        throw new AuthServiceError("identity-not-found", 404, "email identity not found");
      }
      const passwordHash = await hashSecret(input.password, this.requirePasswordSalt());
      if (passwordHash !== identity.auth_secret_hash) {
        throw new AuthServiceError("password-mismatch", 401, "password mismatch");
      }
      await this.deps.repo.touchIdentityLogin(identity.identity_uuid, this.nowIso());
      const context = await this.ensureContextFromIdentity(identity);
      const device = this.readDeviceInput(rawInput, "web");
      return okEnvelope(await this.issueTokens(context, device));
    } catch (error) {
      return normalizeKnownAuthError<AuthFlowResult>(error);
    }
  }

  async refresh(rawInput: unknown, rawMeta: unknown): Promise<RefreshEnvelope> {
    try {
      assertAuthMeta(rawMeta);
      const input = RefreshInputSchema.parse(rawInput);
      const refreshTokenHash = await hashSecret(input.refresh_token, this.requirePasswordSalt());
      const current = await this.deps.repo.findAuthSessionByHash(refreshTokenHash);
      if (!current) {
        throw new AuthServiceError("refresh-invalid", 401, "refresh token not found");
      }
      if (current.revoked_at) {
        throw new AuthServiceError("refresh-revoked", 401, "refresh token has been revoked");
      }
      if (Date.parse(current.expires_at) <= this.now().getTime()) {
        throw new AuthServiceError("refresh-expired", 401, "refresh token has expired");
      }
      const boundDevice = this.requireBoundDeviceUuid(rawInput, current.device_uuid);
      const deviceRecord = await this.deps.repo.readUserDevice(boundDevice.device_uuid);
      if (
        !deviceRecord ||
        deviceRecord.user_uuid !== current.user_uuid ||
        deviceRecord.team_uuid !== current.team_uuid ||
        deviceRecord.status !== "active"
      ) {
        throw new AuthServiceError("refresh-revoked", 401, "refresh device has been revoked");
      }
      const context = await this.deps.repo.readUserContext(current.user_uuid, current.team_uuid);
      if (!context) {
        throw new AuthServiceError("identity-not-found", 404, "user/team context not found");
      }
      const rotatedAt = this.nowIso();
      await this.recordDevice(context, {
        device_uuid: boundDevice.device_uuid,
        device_label: boundDevice.device_label ?? deviceRecord.device_label,
        device_kind: boundDevice.device_kind || deviceRecord.device_kind,
      }, rotatedAt);
      const nextRefreshToken = randomOpaqueToken();
      const nextRefreshTokenHash = await hashSecret(nextRefreshToken, this.requirePasswordSalt());
      const refreshExpiresIn = 30 * 24 * 60 * 60;
      const refreshExpiresAt = new Date(this.now().getTime() + refreshExpiresIn * 1000).toISOString();
      await this.deps.repo.rotateAuthSession({
        current_session_uuid: current.auth_session_uuid,
        revoked_at: rotatedAt,
        rotated_at: rotatedAt,
        last_used_at: rotatedAt,
        next: {
          auth_session_uuid: this.uuid(),
          user_uuid: current.user_uuid,
          team_uuid: current.team_uuid,
          device_uuid: boundDevice.device_uuid,
          refresh_token_hash: nextRefreshTokenHash,
          expires_at: refreshExpiresAt,
          rotated_from_uuid: current.auth_session_uuid,
          created_at: rotatedAt,
        },
      });
      const access = await mintAccessToken(
        this.accessClaimsFromContext(context, boundDevice.device_uuid),
        this.deps.keyEnv,
      );
      return okEnvelope({
        tokens: {
          access_token: access.token,
          refresh_token: nextRefreshToken,
          expires_in: access.exp - Math.floor(Date.now() / 1000),
          refresh_expires_in: refreshExpiresIn,
          kid: access.kid,
        },
        ...this.buildView(context, access.exp, boundDevice.device_uuid),
      });
    } catch (error) {
      return normalizeKnownAuthError<AuthFlowResult>(error);
    }
  }

  async me(rawInput: unknown, rawMeta: unknown): Promise<MeEnvelope> {
    try {
      assertAuthMeta(rawMeta);
      const input = AccessTokenInputSchema.parse(rawInput);
      const auth = await this.authenticateBearer(input);
      return okEnvelope(this.buildView(auth.context, auth.exp, auth.deviceUuid, auth.sourceName));
    } catch (error) {
      return normalizeKnownAuthError<AuthView>(error);
    }
  }

  async verifyToken(rawInput: unknown, rawMeta: unknown): Promise<VerifyTokenEnvelope> {
    try {
      assertAuthMeta(rawMeta);
      const input = AccessTokenInputSchema.parse(rawInput);
      const auth = await this.authenticateBearer(input);
      return okEnvelope({
        valid: true,
        ...this.buildView(auth.context, auth.exp, auth.deviceUuid, auth.sourceName),
      });
    } catch (error) {
      return normalizeKnownAuthError<{ valid: true } & AuthView>(error);
    }
  }

  async resetPassword(rawInput: unknown, rawMeta: unknown): Promise<ResetPasswordEnvelope> {
    try {
      assertAuthMeta(rawMeta);
      const input = ResetPasswordInputSchema.parse(rawInput);
      const claims = await verifyAccessToken(input.access_token, this.deps.keyEnv);
      const normalizedContext = await this.deps.repo.readUserContext(
        claims.user_uuid ?? claims.sub,
        claims.team_uuid ?? claims.tenant_uuid!,
      );
      if (!normalizedContext) {
        throw new AuthServiceError("identity-not-found", 404, "user/team context not found");
      }
      const identity = await this.deps.repo.findIdentityBySubject(
        "email_password",
        String(normalizedContext.login_identifier ?? "").toLowerCase(),
      );
      if (!identity || !identity.auth_secret_hash) {
        throw new AuthServiceError("identity-not-found", 404, "password identity not found");
      }
      const oldHash = await hashSecret(input.old_password, this.requirePasswordSalt());
      if (oldHash !== identity.auth_secret_hash) {
        throw new AuthServiceError("password-mismatch", 401, "old password mismatch");
      }
      const newHash = await hashSecret(input.new_password, this.requirePasswordSalt());
      const updatedAt = this.nowIso();
      await this.deps.repo.updatePasswordSecret(identity.identity_uuid, newHash, updatedAt);
      const refreshedContext = await this.ensureContextFromIdentity(identity);
      const deviceUuid =
        typeof claims.device_uuid === "string" && UUID_RE.test(claims.device_uuid) ? claims.device_uuid : "";
      return okEnvelope({
        password_reset: true,
        ...this.buildView(
          refreshedContext,
          claims.exp ?? Math.floor(Date.now() / 1000) + 3600,
          deviceUuid,
          claims.source_name ?? this.sourceName,
        ),
      });
    } catch (error) {
      return normalizeKnownAuthError<{ password_reset: true } & AuthView>(error);
    }
  }

  async wechatLogin(rawInput: unknown, rawMeta: unknown): Promise<WeChatLoginEnvelope> {
    try {
      assertAuthMeta(rawMeta);
      const input = WeChatLoginInputSchema.parse(rawInput);
      const session = await this.requireWeChatClient().exchangeCode(input.code);
      const decryptedProfile =
        typeof input.encrypted_data === "string" && typeof input.iv === "string"
          ? await this.requireWeChatClient().decryptProfile(
              session.session_key,
              input.encrypted_data,
              input.iv,
            )
          : null;

      if (
        decryptedProfile?.openid &&
        decryptedProfile.openid.length > 0 &&
        decryptedProfile.openid !== session.openid
      ) {
        throw new AuthServiceError(
          "invalid-wechat-payload",
          400,
          "wechat decrypted openid does not match jscode2session openid",
        );
      }

      const device = this.readDeviceInput(rawInput, "wechat-miniprogram");
      const existing =
        (decryptedProfile?.unionid
          ? await this.deps.repo.findIdentityBySubject("wechat", decryptedProfile.unionid)
          : null) ??
        (decryptedProfile?.openid
          ? await this.deps.repo.findIdentityBySubject("wechat", decryptedProfile.openid)
          : null) ??
        await this.deps.repo.findIdentityBySubject("wechat", session.openid);
      if (existing) {
        await this.deps.repo.touchIdentityLogin(existing.identity_uuid, this.nowIso());
        const context = await this.ensureContextFromIdentity(existing);
        return okEnvelope(await this.issueTokens(context, device));
      }
      const displayName =
        decryptedProfile?.display_name ??
        input.display_name ??
        "WeChat User";
      const context = await this.createBootstrapContext({
        display_name: displayName,
        provider: "wechat",
        provider_subject: session.openid,
        provider_subject_normalized: session.openid,
        auth_secret_hash: null,
        created_at: this.nowIso(),
      });
      return okEnvelope(await this.issueTokens(context, device));
    } catch (error) {
      return normalizeKnownAuthError<AuthFlowResult>(error);
    }
  }

  async verifyApiKey(rawInput: unknown, rawMeta: unknown): Promise<VerifyApiKeyEnvelope> {
    try {
      assertAuthMeta(rawMeta);
      const input = VerifyApiKeyInputSchema.parse(rawInput);
      const verified = await this.verifyApiKeyRecord(input.api_key);
      return VerifyApiKeyEnvelopeSchema.parse(okEnvelope(verified.result));
    } catch (error) {
      return normalizeKnownAuthError<VerifyApiKeyResult>(error);
    }
  }

  async createApiKey(rawInput: unknown, rawMeta: unknown): Promise<CreateApiKeyEnvelope> {
    try {
      assertAuthMeta(rawMeta);
      const input = CreateApiKeyInputSchema.parse(rawInput);
      const apiKey = `${API_KEY_PREFIX}${this.uuid()}`;
      const salt = randomOpaqueToken(12);
      const keyHash = await hashSecret(apiKey, salt);
      await this.deps.repo.createTeamApiKey({
        api_key_uuid: apiKey,
        team_uuid: input.team_uuid,
        key_hash: keyHash,
        key_salt: salt,
        label: input.label,
        created_at: this.nowIso(),
      });
      const result: CreateApiKeyResult = {
        key_id: apiKey,
        api_key: apiKey,
        team_uuid: input.team_uuid,
        label: input.label,
      };
      return okEnvelope(result);
    } catch (error) {
      return normalizeKnownAuthError<CreateApiKeyResult>(error);
    }
  }
}
