/**
 * RHX2 P3-01 — `respondWithFacadeError()` and `attachServerTimings()`.
 *
 * Sub-path: `@haimang/nacp-core/logger`
 *
 * `respondWithFacadeError(...)` produces an HTTP `Response` whose body
 * is a `FacadeErrorEnvelope` (same wire shape as
 * `@haimang/orchestrator-auth-contract::facadeError(...)`). The shape is
 * intentionally duck-typed here so `nacp-core` does NOT depend on
 * `orchestrator-auth-contract` (which is a workspace-only retire
 * candidate, see RHX2 design v0.5 §3.7); the wire format is identical.
 *
 * `attachServerTimings(...)` adds the `Server-Timing` HTTP header to
 * an existing `Response`. Used by orchestrator-core facade routes
 * (P3-04 / P3-05); other workers may use it too if they need timing.
 *
 * Both helpers integrate with a `Logger` instance: `respondWithFacadeError`
 * automatically calls `logger.error(...)` so every facade error response
 * also flows through the structured log + ring buffer pipeline. Phase 3
 * does not yet wire the persistence sink — that lands in Phase 5 / P5-04.
 */

import type { Logger } from "./types.js";

export interface FacadeErrorBody {
  /** Stable error code (kebab-case for FacadeErrorCode, UPPER_SNAKE for NACP). */
  code: string;
  /** HTTP status echoed inside the body for clients that read body-only. */
  status: number;
  /** Short human message (≤ 2048 chars per FacadeErrorSchema). */
  message: string;
  /** Optional structured details (caller's choice; opaque to nacp-core). */
  details?: unknown;
}

export interface FacadeErrorEnvelopeWire {
  ok: false;
  error: FacadeErrorBody;
  trace_uuid: string;
}

export interface RespondWithFacadeErrorOptions {
  /** When provided, the helper calls `logger.error(message, {code, ctx})`. */
  logger?: Logger;
  /** Extra response headers to merge in. */
  headers?: Record<string, string>;
}

/**
 * Build a `Response` that carries a `FacadeErrorEnvelope`. Sets:
 *   - HTTP status = `status`
 *   - `Content-Type: application/json`
 *   - `x-trace-uuid: <traceUuid>`
 *   - any caller-supplied headers
 *
 * If `opts.logger` is supplied, also emits `logger.error(message, {code,
 * ctx: details})` so the response is mirrored into the structured
 * logging pipeline.
 *
 * `code` is `string` (not the union type) because callers may pass codes
 * from any of the seven enums + ad-hoc codes. The CI parity gate
 * (`docs/api/error-codes.md`) keeps the universe well-defined.
 */
export function respondWithFacadeError(
  code: string,
  status: number,
  message: string,
  traceUuid: string,
  details?: unknown,
  opts: RespondWithFacadeErrorOptions = {},
): Response {
  if (status < 400 || status > 599) {
    throw new RangeError(
      `respondWithFacadeError: status must be 4xx/5xx, got ${status} for code=${code}`,
    );
  }

  const body: FacadeErrorEnvelopeWire = {
    ok: false,
    error: details !== undefined
      ? { code, status, message, details }
      : { code, status, message },
    trace_uuid: traceUuid,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-trace-uuid": traceUuid,
    ...(opts.headers ?? {}),
  };

  if (opts.logger) {
    // Critical errors (status >= 500) → logger.critical; otherwise warn.
    // Caller can override by NOT passing logger and emitting their own
    // record. Phase 3 keeps this default conservative.
    const ctx: Record<string, unknown> = { http_status: status };
    if (details !== undefined) ctx.details = details;
    if (status >= 500) {
      opts.logger.critical(message, { code, ctx });
    } else {
      opts.logger.warn(message, { code, ctx });
    }
  }

  return new Response(JSON.stringify(body), { status, headers });
}

/* ───────────────────── Server-Timing ─────────────────────────── */

/**
 * Single named segment in a `Server-Timing` header.
 *
 * RHX2 §7.2 F6: first-wave fields are `auth`, `agent`, and `total`.
 * Other workers may add their own segments; this helper does not
 * impose a closed taxonomy.
 */
export interface ServerTiming {
  /** Segment name; e.g. `"auth"`, `"agent"`, `"total"`. */
  name: string;
  /** Duration in milliseconds. Negative / NaN values are dropped. */
  durMs: number;
  /** Optional human-readable description (rendered as `desc=...`). */
  description?: string;
}

function formatTiming(t: ServerTiming): string | null {
  if (typeof t.durMs !== "number" || !Number.isFinite(t.durMs) || t.durMs < 0) return null;
  // Use 3 decimals to preserve sub-millisecond precision but cap clutter.
  const rounded = Math.round(t.durMs * 1000) / 1000;
  let s = `${t.name};dur=${rounded}`;
  if (t.description) {
    // Server-Timing description must be quoted if it contains comma/semicolon.
    const safe = t.description.replace(/[,;]/g, "").slice(0, 128);
    s += `;desc="${safe}"`;
  }
  return s;
}

/**
 * Append `Server-Timing` segments to the given `Response` and return a
 * fresh `Response` (since `Headers` on a real Cloudflare `Response` are
 * immutable once delivered). Existing `Server-Timing` is preserved and
 * appended to.
 *
 * Empty / invalid timings are silently dropped — first-wave §7.2 F6
 * specifies "subcalls that never happened are omitted, not zero".
 */
export function attachServerTimings(response: Response, timings: ServerTiming[]): Response {
  const segments = timings.map(formatTiming).filter((s): s is string => s !== null);
  if (segments.length === 0) return response;
  if (response.status < 200) return response;

  const headers = new Headers(response.headers);
  const existing = headers.get("Server-Timing");
  const next = existing ? `${existing}, ${segments.join(", ")}` : segments.join(", ");
  headers.set("Server-Timing", next);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Convenience: build the canonical `{ auth, agent, total }` triple that
 * RHX2 §7.2 F6 sets at the orchestrator-core facade boundary. Pass
 * `undefined` for segments that did not occur (e.g. requests that
 * never went through agent-core).
 */
export function buildFacadeServerTimings(input: {
  totalMs: number;
  authMs?: number;
  agentMs?: number;
}): ServerTiming[] {
  const out: ServerTiming[] = [];
  if (typeof input.authMs === "number") out.push({ name: "auth", durMs: input.authMs });
  if (typeof input.agentMs === "number") out.push({ name: "agent", durMs: input.agentMs });
  out.push({ name: "total", durMs: input.totalMs });
  return out;
}
