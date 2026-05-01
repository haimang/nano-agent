import { buildAuditPersist } from "../../observability.js";
import { jsonPolicyError } from "../../policy/authority.js";
import { getLogger, type OrchestratorCoreEnv } from "../env.js";

export async function requireOwnedSession(
  env: OrchestratorCoreEnv,
  sessionUuid: string,
  teamUuid: string,
  userUuid: string,
  traceUuid: string,
): Promise<Response | null> {
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return jsonPolicyError(503, "worker-misconfigured", "session store unavailable", traceUuid);
  }
  const row = await db.prepare(
    `SELECT team_uuid, actor_user_uuid
       FROM nano_conversation_sessions
      WHERE session_uuid = ?1
      LIMIT 1`,
  ).bind(sessionUuid).first<Record<string, unknown>>();
  if (!row) {
    return jsonPolicyError(404, "not-found", "session not found", traceUuid);
  }
  if (String(row.team_uuid) !== teamUuid) {
    try {
      await buildAuditPersist(env)({
        ts: new Date().toISOString(),
        worker: "orchestrator-core",
        trace_uuid: traceUuid,
        session_uuid: sessionUuid,
        team_uuid: teamUuid,
        user_uuid: userUuid,
        event_kind: "tenant.cross_tenant_deny",
        outcome: "denied",
        detail: {
          owner_team_uuid: String(row.team_uuid),
        },
      });
    } catch (error) {
      getLogger(env).warn("cross-tenant-audit-failed", {
        code: "internal-error",
        ctx: {
          tag: "cross-tenant-audit-failed",
          trace_uuid: traceUuid,
          session_uuid: sessionUuid,
          team_uuid: teamUuid,
          owner_team_uuid: String(row.team_uuid),
          error: String(error),
        },
      });
    }
    return jsonPolicyError(403, "permission-denied", "session does not belong to caller", traceUuid);
  }
  if (String(row.actor_user_uuid) !== userUuid) {
    return jsonPolicyError(403, "permission-denied", "session does not belong to caller", traceUuid);
  }
  return null;
}
