/**
 * NACP Protocol Version Constants
 *
 * Baseline policy (P0 owner decision, see PX-QNA Q4 / AX-QNA Q4):
 *   - `1.0.0` = pre-freeze provisional baseline. It is NOT the owner-aligned
 *     frozen truth — it is the interim line that existed before the P0
 *     identifier-law rename + widened session family landed.
 *   - `1.1.0` = first owner-aligned frozen baseline. Phase 0 P5-02 cuts this
 *     label after the canonical rename + compat migration + follow-up family
 *     freeze are all landed and tested.
 *
 * After cut: `NACP_VERSION = "1.1.0"` and `NACP_VERSION_COMPAT = "1.0.0"` so
 * a 1.1 reader can still accept payloads produced against the 1.0 surface
 * after passing them through `migrate_v1_0_to_v1_1`.
 *
 * Within any minor line, patch versions are mutually compatible.
 */

export const NACP_VERSION = "1.1.0";
export const NACP_VERSION_COMPAT = "1.0.0";

/**
 * Baseline kind — lets runtime / tests assert which owner-aligned status the
 * running binary is on. `"frozen"` means a Phase 0 rename/compat/follow-up cut
 * has been applied and the wire surface is governed by the identifier law.
 * `"provisional"` means we are still on the pre-freeze interim line.
 */
export type NacpVersionKind = "provisional" | "frozen";
export const NACP_VERSION_KIND: NacpVersionKind = "frozen";

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
