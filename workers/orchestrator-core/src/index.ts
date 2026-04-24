import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import { authenticateRequest, type AuthEnv } from "./auth.js";
import { NanoOrchestratorUserDO } from "./user-do.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OrchestratorCoreEnv extends AuthEnv {
  readonly ORCHESTRATOR_USER_DO: DurableObjectNamespace;
  readonly AGENT_CORE?: Fetcher;
  readonly NANO_INTERNAL_BINDING_SECRET?: string;
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
}

export interface OrchestratorCoreShellResponse {
  readonly worker: "orchestrator-core";
  readonly nacp_core_version: string;
  readonly nacp_session_version: string;
  readonly status: "ok";
  readonly phase: "orchestration-facade-F2";
  readonly public_facade: true;
  readonly agent_binding: boolean;
}

function createShellResponse(env: OrchestratorCoreEnv): OrchestratorCoreShellResponse {
  return {
    worker: "orchestrator-core",
    nacp_core_version: NACP_VERSION,
    nacp_session_version: NACP_SESSION_VERSION,
    status: "ok",
    phase: "orchestration-facade-F2",
    public_facade: true,
    agent_binding: Boolean(env.AGENT_CORE),
  };
}

function jsonError(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status });
}

function ensureTenantConfigured(env: OrchestratorCoreEnv): Response | null {
  if (!env.TEAM_UUID && env.ENVIRONMENT !== "test") {
    return jsonError(503, "worker-misconfigured", "TEAM_UUID must be configured");
  }
  return null;
}

async function parseBody(request: Request, optional = false): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length === 0) return optional ? {} : null;
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return optional ? {} : null;
  }
}

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

type SessionAction = "start" | "input" | "cancel" | "status" | "timeline" | "verify" | "ws";

function parseSessionRoute(request: Request): { sessionUuid: string; action: SessionAction } | null {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  if (segments.length !== 3 || segments[0] !== "sessions") return null;
  const sessionUuid = segments[1]!;
  const action = segments[2] as SessionAction;
  if (!UUID_RE.test(sessionUuid)) return null;
  if (!["start", "input", "cancel", "status", "timeline", "verify", "ws"].includes(action)) return null;
  return { sessionUuid, action };
}

const worker = {
  async fetch(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const method = request.method.toUpperCase();

    if (method === "GET" && (pathname === "/" || pathname === "/health")) {
      return Response.json(createShellResponse(env));
    }

    const tenantError = ensureTenantConfigured(env);
    if (tenantError) return tenantError;

    const route = parseSessionRoute(request);
    if (!route) return jsonError(404, "not-found", "route not found");

    const auth = await authenticateRequest(request, env);
    if (!auth.ok) return auth.response;

    const stub = env.ORCHESTRATOR_USER_DO.get(env.ORCHESTRATOR_USER_DO.idFromName(auth.value.user_uuid));

    if (route.action === "ws") {
      if (!isWebSocketUpgrade(request)) {
        return jsonError(400, "invalid-upgrade", "ws route requires websocket upgrade");
      }
      return stub.fetch(new Request(`https://orchestrator.internal/sessions/${route.sessionUuid}/ws`, {
        method: "GET",
        headers: { upgrade: "websocket" },
      }));
    }

    const optionalBody = route.action === "cancel";
    const needsBody = route.action === "start" || route.action === "input" || route.action === "cancel" || route.action === "verify";
    const body = needsBody ? await parseBody(request, optionalBody) : null;
    if (needsBody && body === null) {
      return jsonError(400, `invalid-${route.action}-body`, `${route.action} requires a JSON body`);
    }

    return stub.fetch(new Request(`https://orchestrator.internal/sessions/${route.sessionUuid}/${route.action}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === null ? undefined : JSON.stringify({
        ...body,
        trace_uuid: auth.value.trace_uuid,
        auth_snapshot: auth.value.snapshot,
        initial_context_seed: auth.value.initial_context_seed,
      }),
    }));
  },
};

export { NanoOrchestratorUserDO };
export default worker;
