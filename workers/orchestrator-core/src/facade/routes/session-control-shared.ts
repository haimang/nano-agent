import { authenticateRequest } from "../../auth.js";
import { jsonPolicyError } from "../../policy/authority.js";
import {
  D1SessionTruthRepository,
  type DurableSessionLifecycleRecord,
} from "../../session-truth.js";
import type { OrchestratorCoreEnv } from "../env.js";

export interface OwnedSessionResult {
  readonly repo: D1SessionTruthRepository;
  readonly session: DurableSessionLifecycleRecord;
  readonly traceUuid: string;
}

export async function readOwnedSession(
  env: OrchestratorCoreEnv,
  request: Request,
  sessionUuid: string,
): Promise<OwnedSessionResult | Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return jsonPolicyError(503, "worker-misconfigured", "NANO_AGENT_DB binding must be configured", traceUuid);
  }
  const repo = new D1SessionTruthRepository(db);
  const session = await repo.readSessionLifecycle(sessionUuid);
  if (
    !session ||
    session.team_uuid !== (auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid) ||
    session.actor_user_uuid !== auth.value.user_uuid
  ) {
    return jsonPolicyError(404, "not-found", "session not found", traceUuid);
  }
  if (session.deleted_at) {
    return jsonPolicyError(409, "conversation-deleted", "conversation is deleted", traceUuid);
  }
  return { repo, session, traceUuid };
}
