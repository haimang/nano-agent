/**
 * NACP Protocol Version Constants
 *
 * NACP_VERSION is the current protocol version embedded in every envelope's header.schema_version.
 * NACP_VERSION_COMPAT is the minimum version a receiver will accept.
 * Within the 1.x.x range, all patch versions are mutually compatible.
 */

export const NACP_VERSION = "1.0.0";
export const NACP_VERSION_COMPAT = "1.0.0";

export function cmpSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}
