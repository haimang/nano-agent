/**
 * @haimang/nacp-core/error-codes-client — client-safe error meta.
 *
 * RHX2 design v0.5 §7.2 F12. **Zero runtime dependencies** — types +
 * a static data table. Web frontend and WeChat mini-program both
 * consume this without pulling zod / nacp-core core.
 *
 * Usage:
 *
 *   import { getErrorMeta, classifyByStatus } from "@haimang/nacp-core/error-codes-client";
 *
 *   const meta = getErrorMeta(envelope.error.code);
 *   if (meta?.category === "auth.expired") redirectToLogin();
 *   else if (meta?.retryable) scheduleRetry();
 *
 *   // Fallback when the registry doesn't know the code (e.g. server
 *   // shipped a new code before the client was rebuilt):
 *   const fallback = classifyByStatus(httpStatus);
 */

import { CLIENT_ERROR_META, CLIENT_ERROR_META_BY_CODE } from "./data.js";
import type { ClientErrorCategory, ClientErrorMeta } from "./types.js";

export type { ClientErrorCategory, ClientErrorMeta } from "./types.js";

export function getErrorMeta(code: string | null | undefined): ClientErrorMeta | undefined {
  if (!code) return undefined;
  return CLIENT_ERROR_META_BY_CODE[code];
}

export function listClientErrorMetas(): readonly ClientErrorMeta[] {
  return CLIENT_ERROR_META;
}

/**
 * Fallback classifier for codes not present in the table. Mirrors the
 * 4 categories the existing web `transport.ts` already produced so the
 * client API does not break for unknown codes.
 */
export function classifyByStatus(status: number): ClientErrorCategory {
  if (status === 401) return "auth.expired";
  if (status === 429) return "quota.exceeded";
  if (status >= 500) return "runtime.error";
  return "request.error";
}
