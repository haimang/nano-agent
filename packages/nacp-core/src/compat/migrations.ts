/**
 * NACP Version Migration Helpers — placeholder for future upgrades.
 *
 * Pattern from SMCP: context/smcp/src/compat/migrations.ts
 * Each version upgrade gets a migrate_vX_Y_to_vX_Z(raw) function
 * that transforms raw dict → raw dict (before schema parse).
 */

export function migrate_noop(raw: unknown): unknown {
  return raw;
}

export function migrate_v1_0_to_v1_1(_raw: unknown): never {
  throw new Error(
    "migrate_v1_0_to_v1_1 is not yet implemented. " +
    "This placeholder exists to pre-validate the migration chain pattern.",
  );
}
