import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import type { OrchestratorAuthRpcService } from "@haimang/orchestrator-auth-contract";
import { authenticateRequest, type AuthEnv } from "./auth.js";
import { ensureConfiguredTeam, jsonPolicyError, readTraceUuid } from "./policy/authority.js";
import { NanoOrchestratorUserDO } from "./user-do.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OrchestratorCoreEnv extends AuthEnv {
  readonly ORCHESTRATOR_USER_DO: DurableObjectNamespace;
  readonly AGENT_CORE?: Fetcher & {
    start?: (
      input: Record<string, unknown>,
      meta: { trace_uuid: string; authority: unknown },
    ) => Promise<{ status: number; body: Record<string, unknown> | null }>;
    status?: (
      input: Record<string, unknown>,
      meta: { trace_uuid: string; authority: unknown },
    ) => Promise<{ status: number; body: Record<string, unknown> | null }>;
  };
  readonly ORCHESTRATOR_AUTH?: OrchestratorAuthRpcService & Fetcher;
  readonly BASH_CORE?: Fetcher;
  readonly CONTEXT_CORE?: Fetcher;
  readonly FILESYSTEM_CORE?: Fetcher;
  readonly NANO_AGENT_DB?: D1Database;
  readonly NANO_INTERNAL_BINDING_SECRET?: string;
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
  readonly WORKER_VERSION?: string;
}

export interface OrchestratorCoreShellResponse {
  readonly worker: "orchestrator-core";
  readonly nacp_core_version: string;
  readonly nacp_session_version: string;
  readonly status: "ok";
  readonly worker_version: string;
  readonly phase: "orchestration-facade-closed";
  readonly public_facade: true;
  readonly agent_binding: boolean;
}

interface WorkerHealthProbeBody {
  readonly worker?: string;
  readonly status?: string;
  readonly worker_version?: string;
  readonly [key: string]: unknown;
}

interface WorkerHealthEntry {
  readonly worker: string;
  readonly live: boolean;
  readonly status: string;
  readonly worker_version: string | null;
  readonly details?: Record<string, unknown>;
  readonly error?: string;
}

function createShellResponse(env: OrchestratorCoreEnv): OrchestratorCoreShellResponse {
  return {
    worker: "orchestrator-core",
    nacp_core_version: NACP_VERSION,
    nacp_session_version: NACP_SESSION_VERSION,
    status: "ok",
    worker_version: env.WORKER_VERSION ?? `orchestrator-core@${env.ENVIRONMENT ?? "dev"}`,
    phase: "orchestration-facade-closed",
    public_facade: true,
    agent_binding: Boolean(env.AGENT_CORE),
  };
}

async function parseProbeResponse(response: Response): Promise<WorkerHealthProbeBody | undefined> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as WorkerHealthProbeBody;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function probeWorkerBinding(
  worker: string,
  binding: Fetcher | undefined,
): Promise<WorkerHealthEntry> {
  if (!binding || typeof binding.fetch !== "function") {
    return {
      worker,
      live: false,
      status: "binding-missing",
      worker_version: null,
    };
  }
  try {
    const response = await binding.fetch(new Request(`https://${worker}.internal/health`));
    const body = await parseProbeResponse(response);
    const status = typeof body?.status === "string" ? body.status : `http-${response.status}`;
    return {
      worker,
      live: response.ok && status === "ok",
      status,
      worker_version: typeof body?.worker_version === "string" ? body.worker_version : null,
      ...(body ? { details: body } : {}),
    };
  } catch (error) {
    return {
      worker,
      live: false,
      status: "unreachable",
      worker_version: null,
      error: error instanceof Error ? error.message : "unknown worker probe failure",
    };
  }
}

async function buildWorkerHealthSnapshot(env: OrchestratorCoreEnv): Promise<Response> {
  const self = createShellResponse(env);
  const remoteWorkers = await Promise.all([
    probeWorkerBinding("orchestrator-auth", env.ORCHESTRATOR_AUTH),
    probeWorkerBinding("agent-core", env.AGENT_CORE),
    probeWorkerBinding("bash-core", env.BASH_CORE),
    probeWorkerBinding("context-core", env.CONTEXT_CORE),
    probeWorkerBinding("filesystem-core", env.FILESYSTEM_CORE),
  ]);
  const workers: WorkerHealthEntry[] = [
    {
      worker: self.worker,
      live: true,
      status: self.status,
      worker_version: self.worker_version,
      details: self as unknown as Record<string, unknown>,
    },
    ...remoteWorkers,
  ];
  const live = workers.filter((entry) => entry.live).length;
  return Response.json({
    ok: true,
    environment: env.ENVIRONMENT ?? "dev",
    generated_at: new Date().toISOString(),
    summary: {
      live,
      total: workers.length,
    },
    workers,
  });
}

function ensureTenantConfigured(env: OrchestratorCoreEnv): Response | null {
  return ensureConfiguredTeam(env);
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

type SessionAction =
  | "start"
  | "input"
  | "cancel"
  | "status"
  | "timeline"
  | "history"
  | "verify"
  | "ws";
type AuthAction =
  | "register"
  | "login"
  | "refresh"
  | "verify"
  | "me"
  | "resetPassword"
  | "wechatLogin";

function parseSessionRoute(request: Request): { sessionUuid: string; action: SessionAction } | null {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  if (segments.length !== 3 || segments[0] !== "sessions") return null;
  const sessionUuid = segments[1]!;
  const action = segments[2] as SessionAction;
  if (!UUID_RE.test(sessionUuid)) return null;
  if (!["start", "input", "cancel", "status", "timeline", "history", "verify", "ws"].includes(action)) return null;
  return { sessionUuid, action };
}

function parseAuthRoute(request: Request): AuthAction | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  if (method === "POST" && pathname === "/auth/register") return "register";
  if (method === "POST" && pathname === "/auth/login") return "login";
  if (method === "POST" && pathname === "/auth/refresh") return "refresh";
  if (method === "POST" && pathname === "/auth/verify") return "verify";
  if (method === "POST" && pathname === "/auth/password/reset") return "resetPassword";
  if (method === "POST" && pathname === "/auth/wechat/login") return "wechatLogin";
  if ((method === "GET" || method === "POST") && (pathname === "/auth/me" || pathname === "/me")) {
    return "me";
  }
  return null;
}

function readAccessToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token.length > 0) return token;
  }
  return null;
}

async function proxyAuthRoute(
  request: Request,
  env: OrchestratorCoreEnv,
  action: AuthAction,
): Promise<Response> {
  if (!env.ORCHESTRATOR_AUTH) {
    return jsonPolicyError(503, "worker-misconfigured", "ORCHESTRATOR_AUTH binding must be configured");
  }
  const traceUuid = readTraceUuid(request) ?? crypto.randomUUID();
  const meta = {
    trace_uuid: traceUuid,
    caller: "orchestrator-core" as const,
  };
  const body = action === "me" ? {} : await parseBody(request, true);
  if (action !== "me" && body === null) {
    return jsonPolicyError(400, "invalid-auth-body", "auth routes require a JSON body");
  }

  const accessToken = readAccessToken(request);
  const input =
    action === "me" || action === "verify"
      ? { access_token: accessToken }
      : action === "resetPassword"
        ? { ...(body ?? {}), access_token: accessToken }
        : body ?? {};

  const envelope =
    action === "register"
      ? await env.ORCHESTRATOR_AUTH.register(input, meta)
      : action === "login"
        ? await env.ORCHESTRATOR_AUTH.login(input, meta)
        : action === "refresh"
          ? await env.ORCHESTRATOR_AUTH.refresh(input, meta)
          : action === "verify"
            ? await env.ORCHESTRATOR_AUTH.verifyToken(input, meta)
            : action === "me"
              ? await env.ORCHESTRATOR_AUTH.me(input, meta)
              : action === "resetPassword"
                ? await env.ORCHESTRATOR_AUTH.resetPassword(input, meta)
                : await env.ORCHESTRATOR_AUTH.wechatLogin(input, meta);

  return Response.json(envelope, {
    status: envelope.ok ? 200 : envelope.error.status,
    headers: { "x-trace-uuid": traceUuid },
  });
}

const worker = {
  async fetch(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const method = request.method.toUpperCase();

    if (method === "GET" && (pathname === "/" || pathname === "/health")) {
      return Response.json(createShellResponse(env));
    }

    if (method === "GET" && pathname === "/debug/workers/health") {
      return buildWorkerHealthSnapshot(env);
    }

    const authRoute = parseAuthRoute(request);
    if (authRoute) {
      return proxyAuthRoute(request, env, authRoute);
    }

    const tenantError = ensureTenantConfigured(env);
    if (tenantError) return tenantError;

    const route = parseSessionRoute(request);
    if (!route) return jsonPolicyError(404, "not-found", "route not found");

    const auth = await authenticateRequest(request, env, {
      allowQueryToken: route.action === "ws",
    });
    if (!auth.ok) return auth.response;

    const stub = env.ORCHESTRATOR_USER_DO.get(env.ORCHESTRATOR_USER_DO.idFromName(auth.value.user_uuid));

    if (route.action === "ws") {
      return stub.fetch(new Request(`https://orchestrator.internal/sessions/${route.sessionUuid}/ws`, {
        method: "GET",
        headers: isWebSocketUpgrade(request) ? { upgrade: "websocket" } : {},
      }));
    }

    const optionalBody = route.action === "cancel";
    const needsBody = route.action === "start" || route.action === "input" || route.action === "cancel" || route.action === "verify";
    const body = needsBody ? await parseBody(request, optionalBody) : null;
    if (needsBody && body === null) {
        return jsonPolicyError(400, `invalid-${route.action}-body`, `${route.action} requires a JSON body`);
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
