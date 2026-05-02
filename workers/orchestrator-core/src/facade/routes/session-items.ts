import { authenticateRequest } from "../../auth.js";
import { D1ItemProjectionPlane } from "../../item-projection-plane.js";
import { D1SessionTruthRepository } from "../../session-truth.js";
import { jsonPolicyError } from "../../policy/authority.js";
import type { OrchestratorCoreEnv } from "../env.js";
import { UUID_RE } from "../shared/request.js";

type ItemsRoute =
  | { kind: "list"; sessionUuid: string }
  | { kind: "detail"; itemUuid: string };

function parseItemsRoute(request: Request): ItemsRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  if (method !== "GET") return null;
  const list = pathname.match(/^\/sessions\/([^/]+)\/items$/);
  if (list) {
    const sessionUuid = list[1]!;
    return UUID_RE.test(sessionUuid) ? { kind: "list", sessionUuid } : null;
  }
  const detail = pathname.match(/^\/items\/([^/]+)$/);
  if (detail) {
    const itemUuid = detail[1]!;
    return UUID_RE.test(itemUuid) ? { kind: "detail", itemUuid } : null;
  }
  return null;
}

export async function tryHandleSessionItemsRoute(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response | null> {
  const route = parseItemsRoute(request);
  if (!route) return null;
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const teamUuid = auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid;
  if (!teamUuid) {
    return jsonPolicyError(403, "missing-team-claim", "JWT must include team_uuid", traceUuid);
  }
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return jsonPolicyError(503, "worker-misconfigured", "NANO_AGENT_DB binding must be configured", traceUuid);
  }
  const repo = new D1SessionTruthRepository(db);
  const plane = new D1ItemProjectionPlane(db);

  if (route.kind === "list") {
    const session = await repo.readSessionLifecycle(route.sessionUuid);
    if (!session || session.team_uuid !== teamUuid || session.actor_user_uuid !== auth.value.user_uuid) {
      return jsonPolicyError(404, "not-found", "session not found", traceUuid);
    }
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? "50");
    const result = await plane.list({
      session_uuid: route.sessionUuid,
      cursor: url.searchParams.get("cursor"),
      limit: Number.isInteger(limitRaw) ? limitRaw : 50,
    });
    return Response.json({ ok: true, data: result, trace_uuid: traceUuid }, {
      status: 200,
      headers: { "x-trace-uuid": traceUuid },
    });
  }

  const item = await plane.read(route.itemUuid);
  if (!item) return jsonPolicyError(404, "not-found", "item not found", traceUuid);
  const session = await repo.readSessionLifecycle(item.session_uuid);
  if (!session || session.team_uuid !== teamUuid || session.actor_user_uuid !== auth.value.user_uuid) {
    return jsonPolicyError(404, "not-found", "item not found", traceUuid);
  }
  return Response.json({ ok: true, data: { item }, trace_uuid: traceUuid }, {
    status: 200,
    headers: { "x-trace-uuid": traceUuid },
  });
}
