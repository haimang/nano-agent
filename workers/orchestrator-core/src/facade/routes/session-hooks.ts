import { jsonPolicyError } from "../../policy/authority.js";
import type { DurableSessionLifecycleRecord } from "../../session-truth.js";
import type { OrchestratorCoreEnv } from "../env.js";
import { parseBody, UUID_RE } from "../shared/request.js";
import { readOwnedSession } from "./session-control-shared.js";

type SessionHookRoute =
  | { kind: "list"; sessionUuid: string }
  | { kind: "register"; sessionUuid: string }
  | { kind: "unregister"; sessionUuid: string; handlerId: string };

function parseSessionHookRoute(request: Request): SessionHookRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const listOrRegister = pathname.match(/^\/sessions\/([^/]+)\/hooks$/);
  if (listOrRegister) {
    const sessionUuid = listOrRegister[1]!;
    if (!UUID_RE.test(sessionUuid)) return null;
    if (method === "GET") return { kind: "list", sessionUuid };
    if (method === "POST") return { kind: "register", sessionUuid };
    return null;
  }
  const item = pathname.match(/^\/sessions\/([^/]+)\/hooks\/([^/]+)$/);
  if (!item) return null;
  const sessionUuid = item[1]!;
  const handlerId = decodeURIComponent(item[2]!);
  if (!UUID_RE.test(sessionUuid) || method !== "DELETE" || handlerId.length === 0) return null;
  return { kind: "unregister", sessionUuid, handlerId };
}

function buildAgentAuthority(session: DurableSessionLifecycleRecord): Record<string, unknown> {
  return {
    sub: session.actor_user_uuid,
    tenant_uuid: session.team_uuid,
    tenant_source: "claim",
    source_name: "orchestrator-core.session-hooks",
  };
}

function forwardAgentResponse(response: { status: number; body: Record<string, unknown> | null }): Response {
  return Response.json(response.body ?? { ok: false }, { status: response.status });
}

export async function tryHandleSessionHooksRoute(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response | null> {
  const route = parseSessionHookRoute(request);
  if (!route) return null;
  const owned = await readOwnedSession(env, request, route.sessionUuid);
  if (owned instanceof Response) return owned;
  const { session, traceUuid } = owned;
  const meta = { trace_uuid: traceUuid, authority: buildAgentAuthority(session) };

  if (route.kind === "list") {
    const rpc = env.AGENT_CORE?.hookList;
    if (typeof rpc !== "function") {
      return jsonPolicyError(503, "worker-misconfigured", "AGENT_CORE hookList RPC must be configured", traceUuid);
    }
    return forwardAgentResponse(await rpc({ session_uuid: route.sessionUuid }, meta));
  }

  if (route.kind === "register") {
    const body = await parseBody(request);
    if (!body) return jsonPolicyError(400, "invalid-input", "hook registration body must be a JSON object", traceUuid);
    const rpc = env.AGENT_CORE?.hookRegister;
    if (typeof rpc !== "function") {
      return jsonPolicyError(503, "worker-misconfigured", "AGENT_CORE hookRegister RPC must be configured", traceUuid);
    }
    return forwardAgentResponse(await rpc({ session_uuid: route.sessionUuid, ...body }, meta));
  }

  const rpc = env.AGENT_CORE?.hookUnregister;
  if (typeof rpc !== "function") {
    return jsonPolicyError(503, "worker-misconfigured", "AGENT_CORE hookUnregister RPC must be configured", traceUuid);
  }
  return forwardAgentResponse(await rpc(
    { session_uuid: route.sessionUuid, handler_id: route.handlerId },
    meta,
  ));
}
