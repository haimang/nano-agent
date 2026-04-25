import {
  AuthRpcMetadataSchema,
  errorEnvelope,
  type AuthEnvelope,
  type AuthErrorCode,
  type AuthRpcMetadata,
} from "@haimang/orchestrator-auth-contract";

export class AuthServiceError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;

  constructor(code: AuthErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }

  toEnvelope<T>(): AuthEnvelope<T> {
    return errorEnvelope<T>(this.code, this.status, this.message);
  }
}

export function assertAuthMeta(rawMeta: unknown): AuthRpcMetadata {
  const parsed = AuthRpcMetadataSchema.safeParse(rawMeta);
  if (!parsed.success) {
    throw new AuthServiceError("invalid-request", 400, "invalid auth rpc metadata");
  }
  if (parsed.data.caller !== "orchestrator-core") {
    throw new AuthServiceError("invalid-caller", 403, "only orchestrator-core may call orchestrator.auth");
  }
  return parsed.data;
}

export function normalizeKnownAuthError<T>(error: unknown): AuthEnvelope<T> {
  if (error instanceof AuthServiceError) {
    return error.toEnvelope<T>();
  }
  throw error;
}
