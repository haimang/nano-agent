/**
 * NACP Error Body — the standard, orthogonal shape for per-verb error
 * responses.
 *
 * Scope rule (B9 / GPT-R2): this file ships `NacpErrorBodySchema` as the
 * canonical shape for per-verb error responses. The `wrapAsError()` helper
 * is a **provisional** helper — it constructs an error-shaped envelope, but
 * its output is NOT guaranteed to pass `validateEnvelope()` against the
 * current 1.3 registry because no shipped verb has adopted
 * `NacpErrorBodySchema` as its body schema yet. That adoption is explicitly
 * out-of-scope for B9 (see RFC §3.2 / RFC §3.3) and will ship as a separate
 * per-verb migration PR.
 *
 * Until that PR lands, consumers of `wrapAsError()` should understand that:
 *
 *   - The helper is useful for NEW worker-matrix-era verbs that CHOOSE to
 *     adopt `NacpErrorBodySchema` as their body schema from day one. Those
 *     verbs can register themselves in `NACP_ERROR_BODY_VERBS` and then the
 *     helper's output will pass `validateEnvelope()` when they supply a
 *     `target_message_type` whose matrix entry permits `delivery_kind: "error"`.
 *   - For EXISTING verbs (`tool.call.response` / `context.compact.response` /
 *     `skill.invoke.response`), the helper's output will be rejected by
 *     `validateEnvelope()` because those body schemas are still
 *     `{ status, error?: { code, message } }` — not `NacpErrorBodySchema`.
 *
 * `system.error` continues to use the top-level `NacpErrorSchema` in
 * `error-registry.ts`. `NacpErrorBodySchema` is for per-verb response bodies,
 * not a replacement of the system-level error taxonomy.
 */

import { z } from "zod";
import type { NacpEnvelope } from "./types.js";

export const NacpErrorBodySchema = z.object({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(2048),
  retriable: z.boolean().optional(),
  cause: z
    .object({
      code: z.string().min(1).max(128).optional(),
      message: z.string().min(1).max(2048).optional(),
    })
    .optional(),
});
export type NacpErrorBody = z.infer<typeof NacpErrorBodySchema>;

/**
 * Registry of message_types whose body schema IS `NacpErrorBodySchema`.
 *
 * Empty at B9. Populated by the forthcoming per-verb migration PR (RFC §3.3).
 *
 * Until at least one verb is registered here, `wrapAsError()` cannot
 * produce an envelope that passes `validateEnvelope()`. This is intentional:
 * the helper is provisional, and its long-term consumers live in the
 * worker-matrix phase.
 */
export const NACP_ERROR_BODY_VERBS: ReadonlySet<string> = new Set<string>();

export interface WrapAsErrorInput {
  code: string;
  message: string;
  retriable?: boolean;
  cause?: { code?: string; message?: string };
}

export interface WrapAsErrorOverrides {
  message_uuid: string;
  sent_at: string;
  /**
   * Target message_type for the wrapped envelope. When omitted, the source
   * envelope's `message_type` is preserved (provisional mode — the result
   * will not pass `validateEnvelope()` unless that type has been registered
   * in `NACP_ERROR_BODY_VERBS`). When the source is a `*.request` verb,
   * callers SHOULD derive the response pair (e.g. via `getExpectedResponseType`
   * from `state-machine.ts`) and pass it here.
   */
  target_message_type?: string;
}

/**
 * Wrap a source envelope into an error-shaped envelope.
 *
 * **Provisional helper** (B9 / GPT-R2): this constructs an envelope with
 * `delivery_kind: "error"` and `body` = `NacpErrorBodySchema`. The caller
 * supplies a fresh `message_uuid`/`sent_at`; everything else is inherited
 * from `source`. The helper does NOT run `validateEnvelope()` on its output
 * by design — because at B9 ship time, no shipped verb has adopted
 * `NacpErrorBodySchema` as its body schema, which means the result would
 * always fail Layer 4 (body) validation for existing verbs. Per-verb
 * migration is a separate PR.
 *
 * Recommended use-cases today:
 *   - Test fixtures and documentation examples.
 *   - New worker-matrix-era verbs that register themselves in
 *     `NACP_ERROR_BODY_VERBS` AND whose matrix entry allows
 *     `delivery_kind: "error"`.
 *
 * NOT recommended today:
 *   - Wrapping a `tool.call.request` / `context.compact.request` /
 *     `skill.invoke.request` and expecting the result to pass
 *     `validateEnvelope()`. The existing response pair still uses
 *     `{status, error?}` shape; use that shape until RFC §3.3 migration PR.
 */
export function wrapAsError(
  source: NacpEnvelope,
  err: WrapAsErrorInput,
  overrides: WrapAsErrorOverrides,
): NacpEnvelope {
  const errorBody: NacpErrorBody = {
    code: err.code,
    message: err.message,
    ...(err.retriable !== undefined ? { retriable: err.retriable } : {}),
    ...(err.cause ? { cause: err.cause } : {}),
  };
  NacpErrorBodySchema.parse(errorBody);

  const targetType = overrides.target_message_type ?? source.header.message_type;

  return {
    ...source,
    header: {
      ...source.header,
      message_uuid: overrides.message_uuid,
      sent_at: overrides.sent_at,
      message_type: targetType,
      delivery_kind: "error",
    },
    body: errorBody,
  } as NacpEnvelope;
}
