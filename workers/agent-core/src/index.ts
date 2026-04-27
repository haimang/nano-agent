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
  readonly WORKER_VERSION?: string;
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
  readonly worker_version: string;
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
    worker_version: env.WORKER_VERSION ?? `agent-core@${env.ENVIRONMENT ?? "dev"}`,
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

// ZX2 Phase 3 P3-01/02 — extended RPC action set.
type AgentRpcAction = "status" | "start" | "input" | "cancel" | "verify" | "timeline" | "stream_snapshot";

const AGENT_RPC_METHOD: Record<AgentRpcAction, "GET" | "POST"> = {
  status: "GET",
  start: "POST",
  input: "POST",
  cancel: "POST",
  verify: "POST",
  timeline: "GET",
  stream_snapshot: "GET",
};

export default class AgentCoreEntrypoint extends WorkerEntrypoint<AgentCoreEnv> {
  async fetch(request: Request): Promise<Response> {
    return fetchWorker(request, this.env);
  }

  async status(rawInput: unknown, rawMeta: unknown): Promise<AgentCoreRpcResponse> {
    return this.invokeInternalRpc("status", rawInput, rawMeta);
  }

  async start(rawInput: unknown, rawMeta: unknown): Promise<AgentCoreRpcResponse> {
    return this.invokeInternalRpc("start", rawInput, rawMeta);
  }

  // ZX2 Phase 3 P3-01 — new RPC methods, dual-track parity gated by orchestrator-core.
  async input(rawInput: unknown, rawMeta: unknown): Promise<AgentCoreRpcResponse> {
    return this.invokeInternalRpc("input", rawInput, rawMeta);
  }

  async cancel(rawInput: unknown, rawMeta: unknown): Promise<AgentCoreRpcResponse> {
    return this.invokeInternalRpc("cancel", rawInput, rawMeta);
  }

  async verify(rawInput: unknown, rawMeta: unknown): Promise<AgentCoreRpcResponse> {
    return this.invokeInternalRpc("verify", rawInput, rawMeta);
  }

  async timeline(rawInput: unknown, rawMeta: unknown): Promise<AgentCoreRpcResponse> {
    return this.invokeInternalRpc("timeline", rawInput, rawMeta);
  }

  // ZX2 Phase 3 P3-02 — cursor-paginated stream snapshot.
  // Body shape:
  //   input  = { session_uuid, cursor?: string|null, limit?: number }
  //   output = { events: Event[], next_cursor: string|null, terminal?: { phase } }
  // Persistent push remains on the WS path (session-ws-v1); this RPC only
  // serves snapshot reads / fallbacks.
  async streamSnapshot(rawInput: unknown, rawMeta: unknown): Promise<AgentCoreRpcResponse> {
    // ZX1-ZX2 review (Kimi §6.3 #2): cursor must be a non-negative integer
    // when present, limit must be in [1, 1000]. Reject early so callers see
    // a 400 instead of a silently-coerced default.
    const inputRecord =
      rawInput && typeof rawInput === "object"
        ? (rawInput as Record<string, unknown>)
        : {};
    const cursorRaw = inputRecord.cursor;
    if (cursorRaw !== undefined && cursorRaw !== null) {
      const cursorNum = Number(cursorRaw);
      if (
        !Number.isFinite(cursorNum) ||
        !Number.isInteger(cursorNum) ||
        cursorNum < 0
      ) {
        return {
          status: 400,
          body: {
            error: "invalid-input",
            message: "stream_snapshot cursor must be a non-negative integer",
          },
        };
      }
    }
    const limitRaw = inputRecord.limit;
    if (limitRaw !== undefined && limitRaw !== null) {
      const limitNum = Number(limitRaw);
      if (
        !Number.isFinite(limitNum) ||
        !Number.isInteger(limitNum) ||
        limitNum <= 0 ||
        limitNum > 1000
      ) {
        return {
          status: 400,
          body: {
            error: "invalid-input",
            message: "stream_snapshot limit must be an integer in [1, 1000]",
          },
        };
      }
    }
    return this.invokeInternalRpc("stream_snapshot", rawInput, rawMeta);
  }

  private async invokeInternalRpc(
    action: AgentRpcAction,
    rawInput: unknown,
    rawMeta: unknown,
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

    const method = AGENT_RPC_METHOD[action];
    const bodyRecord =
      method === "POST"
        ? {
            ...stripSessionUuid(rawInput),
            trace_uuid: validatedMeta.traceUuid,
            authority: { ...validatedMeta.authority },
          }
        : null;

    // For GET-shaped reads with optional input parameters (cursor / limit on
    // stream_snapshot, or none on status/timeline), forward them through the
    // querystring so the existing fetch handler can parse them.
    const url = new URL(`https://session.internal/sessions/${sessionUuid}/${action}`);
    if (method === "GET") {
      const inputRecord = stripSessionUuid(rawInput);
      for (const [key, value] of Object.entries(inputRecord)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }

    const headers = new Headers();
    if (bodyRecord) headers.set("content-type", "application/json");
    headers.set("x-trace-uuid", validatedMeta.traceUuid);
    headers.set("x-nano-internal-authority", JSON.stringify(validatedMeta.authority));
    if (this.env.NANO_INTERNAL_BINDING_SECRET) {
      headers.set("x-nano-internal-binding-secret", this.env.NANO_INTERNAL_BINDING_SECRET);
    }
    const stub = this.env.SESSION_DO.get(this.env.SESSION_DO.idFromName(sessionUuid));
    const response = await stub.fetch(
      new Request(url.toString(), {
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
