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
  readonly ORCHESTRATOR_PUBLIC_BASE_URL?: string;
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
  readonly phase: "orchestration-facade-closed";
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
    phase: "orchestration-facade-closed",
    absorbed_runtime: true,
    live_loop: true,
    capability_binding: Boolean(env.BASH_CORE),
  };
}

const LEGACY_SESSION_ACTIONS = new Set([
  "start",
  "input",
  "cancel",
  "end",
  "status",
  "timeline",
  "verify",
]);

function deriveCanonicalUrl(request: Request, env: AgentCoreEnv): string {
  const url = new URL(request.url);
  if (env.ORCHESTRATOR_PUBLIC_BASE_URL) {
    const canonical = new URL(env.ORCHESTRATOR_PUBLIC_BASE_URL);
    canonical.pathname = url.pathname;
    canonical.search = url.search;
    return canonical.toString();
  }
  if (url.hostname.includes("agent-core")) {
    url.hostname = url.hostname.replace("agent-core", "orchestrator-core");
  }
  return url.toString();
}

type LegacyRoute = Exclude<ReturnType<typeof routeRequest>, { type: "not-found" }>;

function legacyRetirementResponse(request: Request, env: AgentCoreEnv, route: LegacyRoute): Response {
  const canonicalUrl = deriveCanonicalUrl(request, env);
  if (route.type === "websocket") {
    return Response.json(
      {
        error: "legacy-websocket-route-retired",
        message: "public websocket session ingress moved to orchestrator-core",
        canonical_worker: "orchestrator-core",
        canonical_url: canonicalUrl,
      },
      { status: 426 },
    );
  }

  return Response.json(
    {
      error: "legacy-session-route-retired",
      message: `public session route "${route.action}" moved to orchestrator-core`,
      canonical_worker: "orchestrator-core",
      canonical_url: canonicalUrl,
    },
    { status: 410 },
  );
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

    if (
      route.type === "websocket" ||
      (route.type === "http-fallback" && LEGACY_SESSION_ACTIONS.has(route.action))
    ) {
      return legacyRetirementResponse(request, env, route);
    }

    const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(route.sessionId));
    return stub.fetch(request);
  },
};

export { NanoSessionDO };
export default worker;
