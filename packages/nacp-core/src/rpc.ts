/**
 * NACP-Core RPC envelope, metadata, and double-headed validation helper
 * (ZX2 Phase 2 P2-01 / P2-02).
 *
 * Scope rule: this is the canonical home for the worker-↔-worker RPC
 * shapes that ZX2 promotes. Worker-specific RPC interfaces (AgentCoreRpc,
 * BashCoreRpc, ...) MUST import these types and MUST NOT redefine them
 * locally. The associated transport-profile is `nacp-internal`
 * (see docs/transport/transport-profiles.md).
 *
 * Why this lives in nacp-core, not in a new package:
 *   The original ZX2 v1 plan proposed a new packages/orchestrator-rpc-contract
 *   package. The owner / GPT review rejected that approach because it would
 *   shadow nacp-core's existing protocol responsibilities (envelope, authority,
 *   trace, error registry, transport precheck, tenant boundary, admissibility).
 *   v2 instead expands nacp-core's public surface to be the single contract
 *   source, and provides this file as the dedicated RPC layer.
 *
 * Layering:
 *   - `Envelope<T>` is the success/error union for RPC results.
 *   - `RpcMeta` is the second positional argument every WorkerEntrypoint
 *     RPC method receives (trace, caller, authority, optional session_uuid).
 *   - `RpcErrorCode` is the canonical error code enum used by all internal
 *     RPC paths. The string values intentionally match the auth-contract
 *     `AuthErrorCode` taxonomy where they overlap so error mapping stays
 *     idempotent across worker boundaries.
 *   - `validateRpcCall(input, meta, schemas)` is the caller-side helper
 *     that runs zod parse + tenant boundary precheck before sending. It
 *     mirrors the callee-side `validateEnvelope` + `verifyTenantBoundary`
 *     + `checkAdmissibility` chain that ServiceBindingTransport already
 *     runs. Together they form the "double-headed" validation pattern
 *     ZX2 mandates.
 */

import { z } from "zod";
import { NacpValidationError } from "./errors.js";
import { NacpAuthoritySchema, type NacpAuthority } from "./envelope.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — RpcErrorCode taxonomy (ZX2 unified)
// ═══════════════════════════════════════════════════════════════════

/**
 * Canonical RPC error code enum. All internal RPC + facade-http-v1 errors
 * resolve to one of these codes. The taxonomy is intentionally aligned with
 * orchestrator-auth-contract's `AuthErrorCode` so cross-worker error
 * forwarding does not need a translation table.
 */
export const RpcErrorCodeSchema = z.enum([
  // ── shape / schema ──
  "invalid-request",
  "invalid-input",
  "invalid-meta",
  "invalid-trace",
  "invalid-authority",
  "invalid-caller",
  "invalid-session",
  // ── auth-flavoured (compat with auth-contract) ──
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
  // ── lifecycle ──
  "not-found",
  "conflict",
  "session-not-running",
  "session-already-ended",
  // ── runtime ──
  "worker-misconfigured",
  "rpc-parity-failed",
  "upstream-timeout",
  "rate-limited",
  "not-supported",
  "internal-error",
]);
export type RpcErrorCode = z.infer<typeof RpcErrorCodeSchema>;

// ═══════════════════════════════════════════════════════════════════
// §2 — Envelope<T> — success/error union for RPC results
// ═══════════════════════════════════════════════════════════════════

/**
 * Standard RPC error body. Carries an HTTP-style status so a single
 * mapping shipped on facade-http-v1 can round-trip the same shape.
 */
export const RpcErrorSchema = z.object({
  code: RpcErrorCodeSchema,
  status: z.number().int().min(400).max(599),
  message: z.string().min(1).max(2048),
  details: z.unknown().optional(),
});
export type RpcError = z.infer<typeof RpcErrorSchema>;

export const RpcSuccessEnvelopeSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    ok: z.literal(true),
    data,
  });

export const RpcErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: RpcErrorSchema,
});
export type RpcErrorEnvelope = z.infer<typeof RpcErrorEnvelopeSchema>;

export const RpcEnvelopeSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.union([RpcSuccessEnvelopeSchema(data), RpcErrorEnvelopeSchema]);

export type RpcSuccessEnvelope<T> = {
  readonly ok: true;
  readonly data: T;
};
export type Envelope<T> = RpcSuccessEnvelope<T> | RpcErrorEnvelope;

/**
 * Construct an `ok: true` envelope.
 */
export function okEnvelope<T>(data: T): RpcSuccessEnvelope<T> {
  return { ok: true, data };
}

/**
 * Construct an `ok: false` envelope. Status defaults are kept narrow on
 * purpose to discourage random 4xx/5xx codes drifting in.
 */
export function errorEnvelope<T = never>(
  code: RpcErrorCode,
  status: number,
  message: string,
  details?: unknown,
): Envelope<T> {
  return {
    ok: false,
    error: {
      code,
      status,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// §3 — RpcMeta — the second-positional argument every RPC method takes
// ═══════════════════════════════════════════════════════════════════

/**
 * Caller identifier — kept narrow so caller-side log lines and audit
 * records can group by worker. New callers should be added here, not
 * passed as free strings.
 */
export const RpcCallerSchema = z.enum([
  "orchestrator-core",
  "orchestrator-auth",
  "agent-core",
  "bash-core",
  "context-core",
  "filesystem-core",
  "runtime",
  "cli",
  "web",
  "wechat-miniprogram",
  "test",
]);
export type RpcCaller = z.infer<typeof RpcCallerSchema>;

/**
 * `RpcMeta` is the metadata an RPC callee receives independently of the
 * domain-specific input. It carries trace identity, the typed caller name,
 * an optional NACP-shaped authority snapshot, an optional session_uuid for
 * session-bound calls, and an optional request_uuid for capability-grain
 * audit / idempotency (ZX2 Phase 3 P3-03 expects bash-core to require
 * request_uuid for every capability call).
 */
export const RpcMetaSchema = z.object({
  trace_uuid: z.string().uuid(),
  caller: RpcCallerSchema,
  authority: NacpAuthoritySchema.optional(),
  session_uuid: z.string().uuid().optional(),
  request_uuid: z.string().uuid().optional(),
  // Free-form source label (e.g. "session.runtime", "cli.repl") for
  // observability. Kept short.
  source: z.string().min(1).max(128).optional(),
});
export type RpcMeta = z.infer<typeof RpcMetaSchema>;

// ═══════════════════════════════════════════════════════════════════
// §4 — Caller-side double-head validation
// ═══════════════════════════════════════════════════════════════════

export interface ValidateRpcCallOptions<I extends z.ZodTypeAny> {
  /**
   * The zod schema for the method's input argument.
   */
  readonly inputSchema: I;
  /**
   * Optional override of the meta schema. Defaults to RpcMetaSchema.
   * Worker-specific RPC interfaces may tighten this (e.g. require
   * `authority` to be present) by passing a `RpcMetaSchema.extend(...)`.
   */
  readonly metaSchema?: z.ZodTypeAny;
  /**
   * If set, require `meta.authority?.team_uuid` to equal this value.
   * Used by orchestrator-core when calling agent-core / bash-core to
   * stop an authority that disagrees with the calling tenant from
   * leaking through.
   */
  readonly requireTenant?: string;
  /**
   * If true, `meta.authority` must be present.
   */
  readonly requireAuthority?: boolean;
  /**
   * If true, `meta.session_uuid` must be present.
   */
  readonly requireSession?: boolean;
  /**
   * If true, `meta.request_uuid` must be present (capability-grain calls).
   */
  readonly requireRequestUuid?: boolean;
}

export interface ValidatedRpcCall<I> {
  readonly input: I;
  readonly meta: RpcMeta;
}

/**
 * Caller-side validation. Throws `NacpValidationError` on any failure;
 * call sites should catch and translate to `errorEnvelope("invalid-input"
 * / "invalid-meta", ...)` if they prefer a narrowed Envelope to a raw
 * throw.
 *
 * Pattern:
 *
 * ```ts
 * const { input, meta } = validateRpcCall(rawInput, rawMeta, {
 *   inputSchema: AgentStartInputSchema,
 *   requireAuthority: true,
 *   requireTenant: callerTenant.team_uuid,
 *   requireSession: true,
 * });
 * const env = await env.AGENT_CORE.start(input, meta);
 * ```
 *
 * The callee then runs `validateEnvelope` + `verifyTenantBoundary` +
 * `checkAdmissibility` in its WorkerEntrypoint method to close the loop.
 */
export function validateRpcCall<I extends z.ZodTypeAny>(
  rawInput: unknown,
  rawMeta: unknown,
  options: ValidateRpcCallOptions<I>,
): ValidatedRpcCall<z.infer<I>> {
  const metaSchema = options.metaSchema ?? RpcMetaSchema;
  const inputResult = options.inputSchema.safeParse(rawInput);
  if (!inputResult.success) {
    throw new NacpValidationError(
      inputResult.error.issues.map((issue) => issue.message),
    );
  }
  const metaResult = metaSchema.safeParse(rawMeta);
  if (!metaResult.success) {
    throw new NacpValidationError(
      metaResult.error.issues.map((issue) => issue.message),
    );
  }
  const meta = metaResult.data as RpcMeta;

  if (options.requireAuthority && !meta.authority) {
    throw new NacpValidationError([
      "rpc meta.authority is required for this call",
    ]);
  }
  if (
    options.requireTenant !== undefined &&
    meta.authority &&
    meta.authority.team_uuid !== options.requireTenant
  ) {
    throw new NacpValidationError([
      `rpc meta.authority.team_uuid='${meta.authority.team_uuid}' does not match required tenant '${options.requireTenant}'`,
    ]);
  }
  if (options.requireSession && !meta.session_uuid) {
    throw new NacpValidationError([
      "rpc meta.session_uuid is required for this call",
    ]);
  }
  if (options.requireRequestUuid && !meta.request_uuid) {
    throw new NacpValidationError([
      "rpc meta.request_uuid is required for this call",
    ]);
  }

  return {
    input: inputResult.data as z.infer<I>,
    meta,
  };
}

// ═══════════════════════════════════════════════════════════════════
// §5 — Helpers for translating validation throws into Envelope.error
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert an unknown thrown value into an `Envelope.error`. Use this
 * inside RPC method bodies to keep the wire shape consistent even when
 * an unexpected exception escapes.
 */
export function envelopeFromThrown<T = never>(
  error: unknown,
  fallbackCode: RpcErrorCode = "internal-error",
  fallbackStatus = 500,
): Envelope<T> {
  if (error instanceof NacpValidationError) {
    return errorEnvelope<T>("invalid-input", 400, error.message, {
      issues: error.errors,
    });
  }
  if (error instanceof Error) {
    return errorEnvelope<T>(fallbackCode, fallbackStatus, error.message);
  }
  return errorEnvelope<T>(
    fallbackCode,
    fallbackStatus,
    typeof error === "string" ? error : "unknown error",
  );
}

/**
 * Map an existing auth-contract style `{ ok, data | error }` envelope into
 * the canonical `Envelope<T>` shape. Auth contract uses the same field
 * layout already, so this is a structural cast hardened with a runtime
 * shape check; the helper exists so the mapping is documented in code.
 */
export function envelopeFromAuthLike<T>(
  authEnvelope:
    | { readonly ok: true; readonly data: T }
    | {
        readonly ok: false;
        readonly error: {
          readonly code: string;
          readonly message: string;
          readonly status: number;
        };
      },
): Envelope<T> {
  if (authEnvelope.ok) {
    return { ok: true, data: authEnvelope.data };
  }
  // Re-validate the error code through the canonical taxonomy. Codes that
  // are not in `RpcErrorCodeSchema` get coerced to `internal-error` so the
  // wire shape never carries an unknown enum value.
  const codeResult = RpcErrorCodeSchema.safeParse(authEnvelope.error.code);
  return {
    ok: false,
    error: {
      code: codeResult.success ? codeResult.data : "internal-error",
      status: authEnvelope.error.status,
      message: authEnvelope.error.message,
    },
  };
}

// Re-export `NacpAuthority` so RpcMeta's authority shape has a shorter
// import path at call sites.
export type { NacpAuthority };
