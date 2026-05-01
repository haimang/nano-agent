/**
 * facade-http-v1 — public HTTP facade contract (ZX2 Phase 2 P2-04).
 *
 * Profile: `facade-http-v1` (see docs/transport/transport-profiles.md).
 *
 * Why this lives in `orchestrator-auth-contract`, not in nacp-core or a
 * new package:
 *   - This package already ships `AuthEnvelope<T>` whose shape is exactly
 *     the facade-http-v1 envelope. The owner / GPT review of ZX2 v1
 *     explicitly rejected creating a parallel `orchestrator-rpc-contract`
 *     package; the canonical home for facade-public types is therefore
 *     here, alongside auth.
 *   - `nacp-core` ships `Envelope<T>` for the `nacp-internal` profile.
 *     The two envelopes are intentionally structurally identical so a
 *     facade response can be produced by simply attaching `trace_uuid`
 *     to a NACP-Core RPC result. This file documents that alignment.
 *
 * Wire shape (HTTP):
 *
 *   200/201/204 OK:
 *     { ok: true, data: T, trace_uuid: string }
 *
 *   4xx/5xx error (HTTP status === error.status):
 *     { ok: false, error: { code, status, message, details? }, trace_uuid }
 *
 * Required headers on the request side:
 *   - x-trace-uuid: <uuid>
 *   - Authorization: Bearer <jwt>   (except auth bootstrap routes)
 *   - content-type: application/json (for POST/PUT/PATCH)
 */

import { z } from "zod";
import { RpcErrorCodeSchema } from "@haimang/nacp-core";
import { AuthErrorCodeSchema } from "./auth-error-codes.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Facade error code taxonomy
// ═══════════════════════════════════════════════════════════════════

/**
 * facade-http-v1 error code taxonomy. Superset of `AuthErrorCode` from
 * the auth contract (so an auth `Envelope.error` can be re-emitted as a
 * facade error without translation), plus session/policy/runtime codes.
 *
 * ZX2 alignment: every code in `RpcErrorCodeSchema` (nacp-core/rpc.ts)
 * has a corresponding entry here. The two enums must be kept in sync.
 */
export const FacadeErrorCodeSchema = z.enum([
  // ── shape / schema ──
  "invalid-request",
  "invalid-input",
  "invalid-meta",
  "invalid-trace",
  "invalid-authority",
  "invalid-caller",
  "invalid-session",
  "invalid-auth-body",
  // ── auth-flavoured (must include every AuthErrorCode) ──
  "invalid-auth",
  "identity-already-exists",
  "identity-not-found",
  "password-mismatch",
  "refresh-invalid",
  "refresh-expired",
  "refresh-revoked",
  "invalid-wechat-code",
  "invalid-wechat-payload",
  // ── permission / authority ──
  "permission-denied",
  "binding-scope-forbidden",
  "tenant-mismatch",
  "authority-escalation",
  "missing-team-claim",
  // ── lifecycle ──
  "not-found",
  "conflict",
  "session-not-running",
  "session-already-ended",
  "conversation-deleted",
  "confirmation-already-resolved",
  // ── runtime ──
  "worker-misconfigured",
  "auth-misconfigured",
  "context-rpc-unavailable",
  "rpc-parity-failed",
  "upstream-timeout",
  "rate-limited",
  "not-supported",
  "internal-error",
]);
export type FacadeErrorCode = z.infer<typeof FacadeErrorCodeSchema>;

/**
 * Compile-time guarantee that every `AuthErrorCode` is also a
 * `FacadeErrorCode`. If this assignment fails, the two enums have
 * drifted and the auth → facade re-emit path becomes lossy.
 */
const _authErrorCodesAreFacadeCodes: z.infer<typeof AuthErrorCodeSchema> extends FacadeErrorCode
  ? true
  : never = true;
void _authErrorCodesAreFacadeCodes;

/**
 * ZX5 Lane C C4 — Cross-package compile-time guarantee that every
 * `RpcErrorCode` (from `@haimang/nacp-core`) is also a `FacadeErrorCode`.
 *
 * **Single-direction constraint** (per ZX4-ZX5 GPT review §3.9):
 *   FacadeErrorCode 必须 ⊇ RpcErrorCode(facade 是 RPC 的 superset)。
 *   反向不要求 — facade 可以有 nacp-core 不知道的 codes(如 invalid-wechat-payload)。
 *
 * If `nacp-core` adds a new `RpcErrorCode` value and `FacadeErrorCode`
 * doesn't enumerate it, this assignment will fail TS narrowing
 * (`extends never`),迫使我们同步 facade 表。这是 build-time guard,运行时
 * 走 `RpcErrorCodeSchema.safeParse → fallback to internal-error`(per
 * `@haimang/nacp-core/rpc.ts` 现有路径)。
 */
const _rpcErrorCodesAreFacadeCodes: z.infer<typeof RpcErrorCodeSchema> extends FacadeErrorCode
  ? true
  : never = true;
void _rpcErrorCodesAreFacadeCodes;

// ═══════════════════════════════════════════════════════════════════
// §2 — FacadeError + envelopes
// ═══════════════════════════════════════════════════════════════════

export const FacadeErrorSchema = z.object({
  code: FacadeErrorCodeSchema,
  status: z.number().int().min(400).max(599),
  message: z.string().min(1).max(2048),
  details: z.unknown().optional(),
});
export type FacadeError = z.infer<typeof FacadeErrorSchema>;

export const FacadeSuccessEnvelopeSchema = <T extends z.ZodTypeAny>(
  data: T,
) =>
  z.object({
    ok: z.literal(true),
    data,
    trace_uuid: z.string().uuid(),
  });

export const FacadeErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: FacadeErrorSchema,
  trace_uuid: z.string().uuid(),
});
export type FacadeErrorEnvelope = z.infer<typeof FacadeErrorEnvelopeSchema>;

export const FacadeEnvelopeSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.union([FacadeSuccessEnvelopeSchema(data), FacadeErrorEnvelopeSchema]);

export type FacadeSuccessEnvelope<T> = {
  readonly ok: true;
  readonly data: T;
  readonly trace_uuid: string;
};
export type FacadeEnvelope<T> = FacadeSuccessEnvelope<T> | FacadeErrorEnvelope;

// ═══════════════════════════════════════════════════════════════════
// §3 — Helpers
// ═══════════════════════════════════════════════════════════════════

export function facadeOk<T>(data: T, trace_uuid: string): FacadeSuccessEnvelope<T> {
  return { ok: true, data, trace_uuid };
}

export function facadeError(
  code: FacadeErrorCode,
  status: number,
  message: string,
  trace_uuid: string,
  details?: unknown,
): FacadeErrorEnvelope {
  return {
    ok: false,
    error: {
      code,
      status,
      message,
      ...(details !== undefined ? { details } : {}),
    },
    trace_uuid,
  };
}

/**
 * Wrap an `AuthEnvelope<T>` (legacy / RPC-internal shape) into a
 * `FacadeEnvelope<T>` by stamping the trace_uuid. The error code is
 * passed through unchanged because `AuthErrorCode ⊂ FacadeErrorCode`.
 */
export function facadeFromAuthEnvelope<T>(
  authEnvelope:
    | { readonly ok: true; readonly data: T }
    | {
        readonly ok: false;
        readonly error: {
          readonly code: string;
          readonly status: number;
          readonly message: string;
        };
      },
  trace_uuid: string,
): FacadeEnvelope<T> {
  if (authEnvelope.ok) {
    return { ok: true, data: authEnvelope.data, trace_uuid };
  }
  // Re-validate code; unknown values become `internal-error`.
  const codeResult = FacadeErrorCodeSchema.safeParse(authEnvelope.error.code);
  return {
    ok: false,
    error: {
      code: codeResult.success ? codeResult.data : "internal-error",
      status: authEnvelope.error.status,
      message: authEnvelope.error.message,
    },
    trace_uuid,
  };
}
