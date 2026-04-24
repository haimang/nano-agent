import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import { NanoSessionDO } from "./host/do/nano-session-do.js";
import { routeInternal } from "./host/internal.js";
import { routeRequest } from "./host/routes.js";

export interface AgentCoreEnv {
  readonly SESSION_DO: DurableObjectNamespace;
  readonly BASH_CORE?: Fetcher;
  readonly CONTEXT_CORE?: Fetcher;
  readonly FILESYSTEM_CORE?: Fetcher;
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
  readonly TEAM_UUID?: string;
  readonly NANO_INTERNAL_BINDING_SECRET?: string;
}

export interface AgentCoreShellResponse {
  readonly worker: "agent-core";
  readonly nacp_core_version: string;
  readonly nacp_session_version: string;
  readonly status: "ok";
  readonly phase: "worker-matrix-P2-live-loop";
  readonly absorbed_runtime: true;
  readonly live_loop: true;
  readonly capability_binding: boolean;
}

function createShellResponse(env: AgentCoreEnv): AgentCoreShellResponse {
  return {
    worker: "agent-core",
    nacp_core_version: NACP_VERSION,
    nacp_session_version: NACP_SESSION_VERSION,
    status: "ok",
    phase: "worker-matrix-P2-live-loop",
    absorbed_runtime: true,
    live_loop: true,
    capability_binding: Boolean(env.BASH_CORE),
  };
}

const worker = {
  async fetch(request: Request, env: AgentCoreEnv): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (method === "GET" && (pathname === "/" || pathname === "/health")) {
      return Response.json(createShellResponse(env));
    }

    if (pathname.startsWith("/internal/")) {
      return routeInternal(request, env);
    }

    const route = routeRequest(request);
    if (route.type === "not-found") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const sessionId =
      route.type === "websocket" || route.type === "http-fallback"
        ? route.sessionId
        : "default";
    const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId));
    return stub.fetch(request);
  },
};

export { NanoSessionDO };
export default worker;
