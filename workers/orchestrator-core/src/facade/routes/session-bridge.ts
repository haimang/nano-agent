import { authenticateRequest } from "../../auth.js";
import {
  ensureSessionOwnedOrError,
  handleSessionToolCalls,
  handleSessionWorkspace,
  parseSessionToolCallsRoute,
  parseSessionWorkspaceRoute,
} from "../../hp-absorbed-routes.js";
import { jsonPolicyError } from "../../policy/authority.js";
import type { OrchestratorCoreEnv } from "../env.js";
import { parseBody, UUID_RE } from "../shared/request.js";
import { wrapSessionResponse } from "../shared/response.js";

type SessionAction =
  | "start"
  | "input"
  | "cancel"
  | "close"
  | "delete"
  | "title"
  | "status"
  | "timeline"
  | "history"
  | "verify"
  | "ws"
  | "usage"
  | "resume"
  | "messages"
  | "retry"
  | "fork"
  | "permission/decision"
  | "policy/permission_mode"
  | "elicitation/answer";

function parseSessionRoute(request: Request): { sessionUuid: string; action: SessionAction } | null {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const method = request.method.toUpperCase();
  if (segments[0] !== "sessions") return null;
  if (segments.length === 2 && method === "DELETE") {
    const sessionUuid = segments[1]!;
    if (!UUID_RE.test(sessionUuid)) return null;
    return { sessionUuid, action: "delete" };
  }
  if (segments.length === 3) {
    const sessionUuid = segments[1]!;
    const action = segments[2] as SessionAction;
    if (!UUID_RE.test(sessionUuid)) return null;
    if (
      ![
        "start",
        "input",
        "cancel",
        "close",
        "title",
        "status",
        "timeline",
        "history",
        "verify",
        "ws",
        "usage",
        "resume",
        "messages",
        "retry",
        "fork",
      ].includes(action)
    ) {
      return null;
    }
    return { sessionUuid, action };
  }
  if (segments.length === 4) {
    const sessionUuid = segments[1]!;
    if (!UUID_RE.test(sessionUuid)) return null;
    const compound = `${segments[2]}/${segments[3]}` as SessionAction;
    if (
      compound === "permission/decision"
      || compound === "policy/permission_mode"
      || compound === "elicitation/answer"
    ) {
      return { sessionUuid, action: compound };
    }
  }
  return null;
}

async function dispatchDoSessionRoute(request: Request, env: OrchestratorCoreEnv): Promise<Response | null> {
  const route = parseSessionRoute(request);
  if (!route) return null;

  const auth = await authenticateRequest(request, env, {
    allowQueryToken: route.action === "ws",
  });
  if (!auth.ok) return auth.response;

  const stub = env.ORCHESTRATOR_USER_DO.get(env.ORCHESTRATOR_USER_DO.idFromName(auth.value.user_uuid));

  if (route.action === "ws") {
    return stub.fetch(request);
  }

  const optionalBody =
    route.action === "cancel"
    || route.action === "resume"
    || route.action === "close"
    || route.action === "delete"
    || route.action === "retry"
    || route.action === "fork";
  const needsBody =
    route.action === "start"
    || route.action === "input"
    || route.action === "cancel"
    || route.action === "verify"
    || route.action === "messages"
    || route.action === "resume"
    || route.action === "permission/decision"
    || route.action === "policy/permission_mode"
    || route.action === "elicitation/answer"
    || route.action === "close"
    || route.action === "delete"
    || route.action === "title"
    || route.action === "retry"
    || route.action === "fork";
  const body = needsBody ? await parseBody(request, optionalBody) : null;
  if (needsBody && body === null) {
    // HPX3 F6 — use stable schema code (`invalid-input`) instead of
    // per-action dynamic strings; the action name remains in the
    // message field for diagnostics.
    return jsonPolicyError(400, "invalid-input", `${route.action} requires a JSON body`);
  }

  const response = await stub.fetch(new Request(`https://orchestrator.internal/sessions/${route.sessionUuid}/${route.action}`, {
    method: request.method.toUpperCase(),
    headers: {
      "content-type": "application/json",
      "x-trace-uuid": auth.value.trace_uuid,
      "x-nano-internal-authority": JSON.stringify(auth.value.snapshot),
    },
    body: body === null
      ? undefined
      : JSON.stringify({
          ...body,
          trace_uuid: auth.value.trace_uuid,
          auth_snapshot: auth.value.snapshot,
          initial_context_seed: auth.value.initial_context_seed,
        }),
  }));

  return wrapSessionResponse(response, auth.value.trace_uuid);
}

export async function tryHandleSessionBridgeRoute(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response | null> {
  const toolCallsRoute = parseSessionToolCallsRoute(request);
  if (toolCallsRoute) {
    return handleSessionToolCalls(request, env, toolCallsRoute, {
      authenticateRequest,
      jsonPolicyError,
      parseBody: (req) => parseBody(req),
    });
  }
  const workspaceRoute = parseSessionWorkspaceRoute(request);
  if (workspaceRoute) {
    return handleSessionWorkspace(request, env, workspaceRoute, {
      authenticateRequest,
      jsonPolicyError,
      parseBody: (req) => parseBody(req),
    });
  }
  return dispatchDoSessionRoute(request, env);
}

export { ensureSessionOwnedOrError };
