import {
  AccessTokenInputSchema,
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
  type LoginEnvelope,
  type MeEnvelope,
  type RefreshEnvelope,
  type RegisterEnvelope,
  type ResetPasswordEnvelope,
  type VerifyApiKeyEnvelope,
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
  UserContextRecord,
} from "./repository.js";
import type { WeChatClient } from "./wechat.js";

export interface AuthServiceDeps {
  readonly repo: AuthRepository;
  readonly keyEnv: JwtEnv;
  readonly passwordSalt?: string;
  readonly wechatClient?: WeChatClient;
  readonly now?: () => Date;
  readonly uuid?: () => string;
  readonly sourceName?: string;
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

  private accessClaimsFromContext(context: UserContextRecord) {
    return {
      sub: context.user_uuid,
      user_uuid: context.user_uuid,
      team_uuid: context.team_uuid,
      membership_level: context.membership_level,
      source_name: this.sourceName,
    } as const;
  }

  private buildSnapshot(context: UserContextRecord, exp: number): AuthSnapshot {
    return {
      sub: context.user_uuid,
      user_uuid: context.user_uuid,
      team_uuid: context.team_uuid,
      // `tenant_uuid` currently aliases `team_uuid` for the NACP bridge.
      tenant_uuid: context.team_uuid,
      tenant_source: "claim",
      membership_level: context.membership_level,
      source_name: this.sourceName,
      exp,
    };
  }

  private buildView(context: UserContextRecord, exp: number): AuthView {
    return {
      user: {
        user_uuid: context.user_uuid,
        display_name: context.display_name,
        identity_provider: context.identity_provider,
        login_identifier: context.login_identifier,
      },
      team: {
        team_uuid: context.team_uuid,
        membership_level: context.membership_level,
        plan_level: context.plan_level,
      },
      snapshot: this.buildSnapshot(context, exp),
    };
  }

  private async issueTokens(context: UserContextRecord): Promise<AuthFlowResult> {
    const refreshToken = randomOpaqueToken();
    const refreshExpiresIn = 30 * 24 * 60 * 60;
    const refreshExpiresAt = new Date(this.now().getTime() + refreshExpiresIn * 1000).toISOString();
    const refreshTokenHash = await hashSecret(refreshToken, this.requirePasswordSalt());
    const sessionInput: CreateAuthSessionInput = {
      auth_session_uuid: this.uuid(),
      user_uuid: context.user_uuid,
      team_uuid: context.team_uuid,
      refresh_token_hash: refreshTokenHash,
      expires_at: refreshExpiresAt,
      rotated_from_uuid: null,
      created_at: this.nowIso(),
    };
    await this.deps.repo.createAuthSession(sessionInput);
    const access = await mintAccessToken(this.accessClaimsFromContext(context), this.deps.keyEnv);
    return {
      tokens: {
        access_token: access.token,
        refresh_token: refreshToken,
        expires_in: access.exp - Math.floor(Date.now() / 1000),
        refresh_expires_in: refreshExpiresIn,
        kid: access.kid,
      },
      ...this.buildView(context, access.exp),
    };
  }

  private async ensureContextFromIdentity(identity: IdentityRecord): Promise<UserContextRecord> {
    const context = await this.deps.repo.readUserContext(identity.user_uuid, identity.team_uuid);
    if (!context) {
      throw new AuthServiceError("identity-not-found", 404, "user/team context not found");
    }
    return context;
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
      const context = await this.deps.repo.createBootstrapUser({
        identity_uuid: this.uuid(),
        user_uuid: this.uuid(),
        team_uuid: this.uuid(),
        membership_uuid: this.uuid(),
        display_name: input.display_name ?? this.deriveDisplayName(input.email),
        provider: "email_password",
        provider_subject: input.email,
        provider_subject_normalized: normalizedEmail,
        auth_secret_hash: passwordHash,
        created_at: createdAt,
      });
      return okEnvelope(await this.issueTokens(context));
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
      return okEnvelope(await this.issueTokens(context));
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
      const context = await this.deps.repo.readUserContext(current.user_uuid, current.team_uuid);
      if (!context) {
        throw new AuthServiceError("identity-not-found", 404, "user/team context not found");
      }
      const nextRefreshToken = randomOpaqueToken();
      const nextRefreshTokenHash = await hashSecret(nextRefreshToken, this.requirePasswordSalt());
      const rotatedAt = this.nowIso();
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
          refresh_token_hash: nextRefreshTokenHash,
          expires_at: refreshExpiresAt,
          rotated_from_uuid: current.auth_session_uuid,
          created_at: rotatedAt,
        },
      });
      const access = await mintAccessToken(this.accessClaimsFromContext(context), this.deps.keyEnv);
      return okEnvelope({
        tokens: {
          access_token: access.token,
          refresh_token: nextRefreshToken,
          expires_in: access.exp - Math.floor(Date.now() / 1000),
          refresh_expires_in: refreshExpiresIn,
          kid: access.kid,
        },
        ...this.buildView(context, access.exp),
      });
    } catch (error) {
      return normalizeKnownAuthError<AuthFlowResult>(error);
    }
  }

  async me(rawInput: unknown, rawMeta: unknown): Promise<MeEnvelope> {
    try {
      assertAuthMeta(rawMeta);
      const input = AccessTokenInputSchema.parse(rawInput);
      const claims = await verifyAccessToken(input.access_token, this.deps.keyEnv);
      const context = await this.deps.repo.readUserContext(
        claims.user_uuid ?? claims.sub,
        claims.team_uuid ?? claims.tenant_uuid!,
      );
      if (!context) {
        throw new AuthServiceError("identity-not-found", 404, "user/team context not found");
      }
      return okEnvelope(this.buildView(context, claims.exp ?? Math.floor(Date.now() / 1000) + 3600));
    } catch (error) {
      return normalizeKnownAuthError<AuthView>(error);
    }
  }

  async verifyToken(rawInput: unknown, rawMeta: unknown): Promise<VerifyTokenEnvelope> {
    try {
      assertAuthMeta(rawMeta);
      const input = AccessTokenInputSchema.parse(rawInput);
      const claims = await verifyAccessToken(input.access_token, this.deps.keyEnv);
      const context = await this.deps.repo.readUserContext(
        claims.user_uuid ?? claims.sub,
        claims.team_uuid ?? claims.tenant_uuid!,
      );
      if (!context) {
        throw new AuthServiceError("identity-not-found", 404, "user/team context not found");
      }
      return okEnvelope({
        valid: true,
        ...this.buildView(context, claims.exp ?? Math.floor(Date.now() / 1000) + 3600),
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
      return okEnvelope({
        password_reset: true,
        ...this.buildView(refreshedContext, claims.exp ?? Math.floor(Date.now() / 1000) + 3600),
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
        return okEnvelope(await this.issueTokens(context));
      }
      const context = await this.deps.repo.createBootstrapUser({
        identity_uuid: this.uuid(),
        user_uuid: this.uuid(),
        team_uuid: this.uuid(),
        membership_uuid: this.uuid(),
        display_name:
          decryptedProfile?.display_name ??
          input.display_name ??
          "WeChat User",
        provider: "wechat",
        provider_subject: session.openid,
        provider_subject_normalized: session.openid,
        auth_secret_hash: null,
        created_at: this.nowIso(),
      });
      return okEnvelope(await this.issueTokens(context));
    } catch (error) {
      return normalizeKnownAuthError<AuthFlowResult>(error);
    }
  }

  async verifyApiKey(rawMeta: unknown): Promise<VerifyApiKeyEnvelope> {
    try {
      assertAuthMeta(rawMeta);
      return VerifyApiKeyEnvelopeSchema.parse(
        okEnvelope({
          supported: false,
          reason: "reserved-for-future-phase",
        }),
      );
    } catch (error) {
      return normalizeKnownAuthError<{ supported: false; reason: "reserved-for-future-phase" }>(error);
    }
  }
}
