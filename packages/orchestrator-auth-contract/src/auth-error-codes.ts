import { z } from "zod";

export const AuthErrorCodeSchema = z.enum([
  "invalid-request",
  "invalid-caller",
  "invalid-auth",
  "identity-already-exists",
  "identity-not-found",
  "password-mismatch",
  "refresh-invalid",
  "refresh-expired",
  "refresh-revoked",
  "invalid-wechat-code",
  "invalid-wechat-payload",
  "not-supported",
  "worker-misconfigured",
]);
export type AuthErrorCode = z.infer<typeof AuthErrorCodeSchema>;
