export interface CleanupEnv {
  readonly NANO_AGENT_DB?: D1Database;
}

export interface CleanupResult {
  readonly ok: true;
  readonly error_cutoff: string;
  readonly audit_cutoff: string;
}

const ERROR_RETENTION_DAYS = 14;
const AUDIT_RETENTION_DAYS = 90;

function cutoffIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export async function cleanupObservabilityLogs(
  env: CleanupEnv,
  now = new Date(),
): Promise<CleanupResult> {
  const db = env.NANO_AGENT_DB;
  if (!db) {
    throw new Error("NANO_AGENT_DB binding is required for observability cleanup");
  }
  const errorCutoff = cutoffIso(now, ERROR_RETENTION_DAYS);
  const auditCutoff = cutoffIso(now, AUDIT_RETENTION_DAYS);
  await db.batch([
    db.prepare(`DELETE FROM nano_error_log WHERE created_at < ?1`).bind(errorCutoff),
    db.prepare(`DELETE FROM nano_audit_log WHERE created_at < ?1`).bind(auditCutoff),
  ]);
  return {
    ok: true,
    error_cutoff: errorCutoff,
    audit_cutoff: auditCutoff,
  };
}
