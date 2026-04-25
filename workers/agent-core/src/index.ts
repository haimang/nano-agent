import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import { WorkerEntrypoint } from "cloudflare:workers";
import { NanoSessionDO } from "./host/do/nano-session-do.js";
import { routeInternal } from "./host/internal.js";
import { routeRequest } from "./host/routes.js";
import { validateInternalRpcMeta } from "./host/internal-policy.js";

export interface AgentCoreEnv {
  readonly SESSION_DO: DurableObjectNamespace;
  readonly BASH_CORE?: Fetcher;
  readonly CONTEXT_CORE?: Fetcher;
  readonly FILESYSTEM_CORE?: Fetcher;
  readonly NANO_AGENT_DB?: D1Database;
  readonly AI?: {
    run(model: string, input: Record<string, unknown>): Promise<unknown>;
  };
  readonly ORCHESTRATOR_PUBLIC_BASE_URL?: string;
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
  readonly TEAM_UUID?: string;
  readonly NANO_INTERNAL_BINDING_SECRET?: string;
  readonly NANO_AGENT_LLM_CALL_LIMIT?: string;
  readonly NANO_AGENT_TOOL_CALL_LIMIT?: string;
  readonly NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED?: string;
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

export interface AgentCoreRpcMeta {
  readonly trace_uuid?: string;
  readonly authority?: Record<string, unknown>;
}

export interface AgentCoreRpcResponse {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
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

function legacyRetirementResponse(
  request: Request,
  env: AgentCoreEnv,
  route: LegacyRoute,
): Response {
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

async function fetchWorker(request: Request, env: AgentCoreEnv): Promise<Response> {
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
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function extractSessionUuid(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sessionUuid = (value as { session_uuid?: unknown }).session_uuid;
  return typeof sessionUuid === "string" && sessionUuid.length > 0 ? sessionUuid : null;
}

function stripSessionUuid(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const { session_uuid: _ignored, ...rest } = value as Record<string, unknown>;
  return rest;
}

export default class AgentCoreEntrypoint extends WorkerEntrypoint<AgentCoreEnv> {
  async fetch(request: Request): Promise<Response> {
    return fetchWorker(request, this.env);
  }

  async status(rawInput: unknown, rawMeta: unknown): Promise<AgentCoreRpcResponse> {
    return this.invokeInternalRpc("status", rawInput, rawMeta, "GET");
  }

  async start(rawInput: unknown, rawMeta: unknown): Promise<AgentCoreRpcResponse> {
    return this.invokeInternalRpc("start", rawInput, rawMeta, "POST");
  }

  private async invokeInternalRpc(
    action: "status" | "start",
    rawInput: unknown,
    rawMeta: unknown,
    method: "GET" | "POST",
  ): Promise<AgentCoreRpcResponse> {
    const sessionUuid = extractSessionUuid(rawInput);
    if (!sessionUuid) {
      return {
        status: 400,
        body: {
          error: "invalid-rpc-input",
          message: "session_uuid is required",
        },
      };
    }

    const validatedMeta = validateInternalRpcMeta(rawMeta, this.env);
    if (!validatedMeta.ok) {
      return {
        status: validatedMeta.status,
        body: {
          error: validatedMeta.error,
          message: validatedMeta.message,
        },
      };
    }

    const bodyRecord =
      method === "POST"
        ? {
            ...stripSessionUuid(rawInput),
            trace_uuid: validatedMeta.traceUuid,
            authority: { ...validatedMeta.authority },
          }
        : null;
    const headers = new Headers();
    if (bodyRecord) headers.set("content-type", "application/json");
    const stub = this.env.SESSION_DO.get(this.env.SESSION_DO.idFromName(sessionUuid));
    const response = await stub.fetch(
      new Request(`https://session.internal/sessions/${sessionUuid}/${action}`, {
        method,
        headers,
        body: bodyRecord ? JSON.stringify(bodyRecord) : undefined,
      }),
    );
    return {
      status: response.status,
      body: await readJson(response),
    };
  }
}

export const worker = {
  fetch: fetchWorker,
};

export { NanoSessionDO };
