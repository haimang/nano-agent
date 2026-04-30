/**
 * @haimang/nacp-core/error-codes-client — static data table.
 *
 * The concrete table is generated at build/test time from the unified
 * server registry and committed as a plain static module
 * (`generated-data.ts`). This file intentionally contains **no**
 * runtime import from `../error-registry.js` so browser / mini-program
 * consumers do not pull server-side registry logic into their bundle.
 */

import type { ClientErrorMeta } from "./types.js";
import { GENERATED_CLIENT_ERROR_META } from "./generated-data.js";

// Hide ad-hoc internal codes from the table that ships to clients to
// avoid surfacing implementation-detail codes in UI catalogues. They
// are still accessible server-side via `resolveErrorMeta()`.
export const CLIENT_ERROR_META: readonly ClientErrorMeta[] = GENERATED_CLIENT_ERROR_META;

export const CLIENT_ERROR_META_BY_CODE: Record<string, ClientErrorMeta> = (() => {
  const out: Record<string, ClientErrorMeta> = {};
  for (const c of CLIENT_ERROR_META) out[c.code] = c;
  return out;
})();
