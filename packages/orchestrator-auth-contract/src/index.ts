import { z } from "zod";
import { AuthErrorCodeSchema } from "./auth-error-codes.js";
import type { AuthErrorCode } from "./auth-error-codes.js";
export { AuthErrorCodeSchema, type AuthErrorCode } from "./auth-error-codes.js";

// ZX2 Phase 2 P2-04: facade-http-v1 contract lives alongside auth in this
// package. Re-exported below.
export {
  FacadeErrorCodeSchema,
  FacadeErrorSchema,
  FacadeSuccessEnvelopeSchema,
  FacadeErrorEnvelopeSchema,
  FacadeEnvelopeSchema,
  facadeOk,
  facadeError,
  facadeFromAuthEnvelope,
} from "./facade-http.js";
export type {
  FacadeErrorCode,
  FacadeError,
  FacadeErrorEnvelope,
  FacadeSuccessEnvelope,
  FacadeEnvelope,
} from "./facade-http.js";

export const IdentityProviderSchema = z.enum(["email_password", "wechat"]);
export type IdentityProvider = z.infer<typeof IdentityProviderSchema>;

export const AuthRpcMetadataSchema = z.object({
  trace_uuid: z.string().uuid(),
  caller: z.string().trim().min(1),
});
export type AuthRpcMetadata = z.infer<typeof AuthRpcMetadataSchema>;

export const OWNER_MEMBERSHIP_LEVEL = 100 as const;
export const MembershipLevelSchema = z.number().int().nonnegative();
export const TeamSlugSchema = z.string().regex(/^[a-z0-9-]{1,32}$/);
export const SnapshotDeviceUuidSchema = z.union([z.string().uuid(), z.literal("")]);

export const AccessTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  user_uuid: z.string().uuid().optional(),
  team_uuid: z.string().uuid().optional(),
  tenant_uuid: z.string().uuid().optional(),
  device_uuid: z.string().uuid().optional(),
  membership_level: z.number().int().nonnegative().optional(),
  source_name: z.string().min(1).optional(),
  realm: z.string().min(1).optional(),
  typ: z.literal("access").optional(),
  iat: z.number().int().optional(),
  exp: z.number().int().optional(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;

/**
 * Auth worker snapshots are always claim-backed.
 * The deploy-fill fallback remains an orchestrator-core ingress-only concern.
 *
 * ZX1-ZX2 review (GLM R6): `team_uuid` is REQUIRED on snapshots produced by
 * `orchestrator-auth.verify-access-token` (tenant_source=claim, JWT minted
 * by ZX1+ keys always carries it). It is OPTIONAL on `AccessTokenClaims`
 * (above) so legacy bearer tokens that pre-date the kid-aware keyring can
 * still parse — but those tokens are then promoted to a snapshot only after
 * orchestrator-core's deploy-fill ingress fills in `team_uuid` from
 * `tenant_uuid`. User DO code paths that read `auth_snapshot.team_uuid`
 * therefore see a guaranteed UUID and do not need to fall back.
 */
export const AuthSnapshotSchema = z.object({
  sub: z.string().uuid(),
  user_uuid: z.string().uuid(),
  team_uuid: z.string().uuid(),
  tenant_uuid: z.string().uuid(),
  device_uuid: SnapshotDeviceUuidSchema,
  /**
   * `tenant_uuid` is currently an alias of `team_uuid` while zero-to-real
   * continues to bridge public auth truth into the NACP tenant model.
   */
  tenant_source: z.literal("claim"),
  membership_level: MembershipLevelSchema,
  source_name: z.string().min(1).optional(),
  exp: z.number().int().optional(),
});
export type AuthSnapshot = z.infer<typeof AuthSnapshotSchema>;

export const AuthUserSchema = z.object({
  user_uuid: z.string().uuid(),
  display_name: z.string().min(1).nullable(),
  identity_provider: IdentityProviderSchema,
  login_identifier: z.string().min(1).nullable(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthTeamSchema = z.object({
  team_uuid: z.string().uuid(),
  team_name: z.string().trim().min(1).max(80),
  team_slug: TeamSlugSchema,
  membership_level: MembershipLevelSchema,
  plan_level: z.number().int().nonnegative(),
});
export type AuthTeam = z.infer<typeof AuthTeamSchema>;

export const AuthTokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_expires_in: z.number().int().positive(),
  kid: z.string().min(1),
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

export const AuthViewSchema = z.object({
  user: AuthUserSchema,
  team: AuthTeamSchema,
  snapshot: AuthSnapshotSchema,
});
export type AuthView = z.infer<typeof AuthViewSchema>;

const EmailSchema = z.string().trim().email();
const PasswordSchema = z.string().min(8);
const Base64PayloadSchema = z.string().trim().min(1);

export const RegisterInputSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  display_name: z.string().trim().min(1).max(80).optional(),
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const LoginInputSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const RefreshInputSchema = z.object({
  refresh_token: z.string().min(1),
});
export type RefreshInput = z.infer<typeof RefreshInputSchema>;

export const AccessTokenInputSchema = z.object({
  access_token: z.string().min(1),
});
export type AccessTokenInput = z.infer<typeof AccessTokenInputSchema>;

export const ResetPasswordInputSchema = z.object({
  access_token: z.string().min(1),
  old_password: PasswordSchema,
  new_password: PasswordSchema,
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordInputSchema>;

export const WeChatLoginInputSchema = z.object({
  code: z.string().trim().min(1),
  encrypted_data: Base64PayloadSchema.optional(),
  iv: Base64PayloadSchema.optional(),
  display_name: z.string().trim().min(1).max(80).optional(),
}).superRefine((value, ctx) => {
  const hasEncrypted = typeof value.encrypted_data === "string";
  const hasIv = typeof value.iv === "string";
  if (hasEncrypted !== hasIv) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "encrypted_data and iv must be provided together",
      path: hasEncrypted ? ["iv"] : ["encrypted_data"],
    });
  }
});
export type WeChatLoginInput = z.infer<typeof WeChatLoginInputSchema>;

export const VerifyApiKeyInputSchema = z.object({
  api_key: z.string().min(1),
});
export type VerifyApiKeyInput = z.infer<typeof VerifyApiKeyInputSchema>;

export const CreateApiKeyInputSchema = z.object({
  team_uuid: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;

export const AuthFlowResultSchema = AuthViewSchema.extend({
  tokens: AuthTokensSchema,
});
export type AuthFlowResult = z.infer<typeof AuthFlowResultSchema>;

export const VerifyTokenResultSchema = AuthViewSchema.extend({
  valid: z.literal(true),
});
export type VerifyTokenResult = z.infer<typeof VerifyTokenResultSchema>;

export const ResetPasswordResultSchema = AuthViewSchema.extend({
  password_reset: z.literal(true),
});
export type ResetPasswordResult = z.infer<typeof ResetPasswordResultSchema>;

export const VerifyApiKeyResultSchema = z.object({
  supported: z.literal(true),
  key_id: z.string().min(1),
  team_uuid: z.string().uuid(),
  user_uuid: z.string().uuid(),
  membership_level: MembershipLevelSchema,
  source_name: z.string().min(1),
});
export type VerifyApiKeyResult = z.infer<typeof VerifyApiKeyResultSchema>;

export const CreateApiKeyResultSchema = z.object({
  key_id: z.string().min(1),
  api_key: z.string().regex(/^nak_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  team_uuid: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
});
export type CreateApiKeyResult = z.infer<typeof CreateApiKeyResultSchema>;

export const AuthErrorSchema = z.object({
  code: AuthErrorCodeSchema,
  message: z.string().min(1),
  status: z.number().int().min(400).max(599),
});
export type AuthError = z.infer<typeof AuthErrorSchema>;

export const makeAuthSuccessEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    ok: z.literal(true),
    data: dataSchema,
  });

export const AuthErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: AuthErrorSchema,
});
export type AuthErrorEnvelope = z.infer<typeof AuthErrorEnvelopeSchema>;

export const makeAuthEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.union([makeAuthSuccessEnvelopeSchema(dataSchema), AuthErrorEnvelopeSchema]);

export type AuthSuccessEnvelope<T> = {
  readonly ok: true;
  readonly data: T;
};

export type AuthEnvelope<T> = AuthSuccessEnvelope<T> | AuthErrorEnvelope;

export const RegisterEnvelopeSchema = makeAuthEnvelopeSchema(AuthFlowResultSchema);
export type RegisterEnvelope = AuthEnvelope<AuthFlowResult>;

export const LoginEnvelopeSchema = makeAuthEnvelopeSchema(AuthFlowResultSchema);
export type LoginEnvelope = AuthEnvelope<AuthFlowResult>;

export const RefreshEnvelopeSchema = makeAuthEnvelopeSchema(AuthFlowResultSchema);
export type RefreshEnvelope = AuthEnvelope<AuthFlowResult>;

export const MeEnvelopeSchema = makeAuthEnvelopeSchema(AuthViewSchema);
export type MeEnvelope = AuthEnvelope<AuthView>;

export const VerifyTokenEnvelopeSchema = makeAuthEnvelopeSchema(VerifyTokenResultSchema);
export type VerifyTokenEnvelope = AuthEnvelope<VerifyTokenResult>;

export const ResetPasswordEnvelopeSchema = makeAuthEnvelopeSchema(ResetPasswordResultSchema);
export type ResetPasswordEnvelope = AuthEnvelope<ResetPasswordResult>;

export const WeChatLoginEnvelopeSchema = makeAuthEnvelopeSchema(AuthFlowResultSchema);
export type WeChatLoginEnvelope = AuthEnvelope<AuthFlowResult>;

export const VerifyApiKeyEnvelopeSchema = makeAuthEnvelopeSchema(VerifyApiKeyResultSchema);
export type VerifyApiKeyEnvelope = AuthEnvelope<VerifyApiKeyResult>;

export const CreateApiKeyEnvelopeSchema = makeAuthEnvelopeSchema(CreateApiKeyResultSchema);
export type CreateApiKeyEnvelope = AuthEnvelope<CreateApiKeyResult>;

export function okEnvelope<T>(data: T): AuthSuccessEnvelope<T> {
  return { ok: true, data };
}

export function errorEnvelope<T>(
  code: AuthErrorCode,
  status: number,
  message: string,
): AuthEnvelope<T> {
  return {
    ok: false,
    error: {
      code,
      status,
      message,
    },
  };
}

export interface OrchestratorAuthRpcService {
  register(input: unknown, meta: unknown): Promise<RegisterEnvelope>;
  login(input: unknown, meta: unknown): Promise<LoginEnvelope>;
  refresh(input: unknown, meta: unknown): Promise<RefreshEnvelope>;
  me(input: unknown, meta: unknown): Promise<MeEnvelope>;
  verifyToken(input: unknown, meta: unknown): Promise<VerifyTokenEnvelope>;
  resetPassword(input: unknown, meta: unknown): Promise<ResetPasswordEnvelope>;
  wechatLogin(input: unknown, meta: unknown): Promise<WeChatLoginEnvelope>;
  verifyApiKey(input: unknown, meta: unknown): Promise<VerifyApiKeyEnvelope>;
  createApiKey(input: unknown, meta: unknown): Promise<CreateApiKeyEnvelope>;
}
