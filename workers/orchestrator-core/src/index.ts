import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import {
  facadeFromAuthEnvelope,
  type FacadeErrorCode,
  type OrchestratorAuthRpcService,
} from "@haimang/orchestrator-auth-contract";
import { authenticateRequest, type AuthEnv } from "./auth.js";
import { ensureConfiguredTeam, jsonPolicyError, readTraceUuid } from "./policy/authority.js";
import { NanoOrchestratorUserDO } from "./user-do.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ZX2 Phase 3 P3-01/02 — agent-core RPC method signature shared by all
// dual-track parity entry points. Each callable returns the same
// `{status, body}` shape (which orchestrator-core compares to the
// HTTP-truth result via jsonDeepEqual).
type AgentRpcMethod = (
  input: Record<string, unknown>,
  meta: { trace_uuid: string; authority: unknown },
) => Promise<{ status: number; body: Record<string, unknown> | null }>;

export interface OrchestratorCoreEnv extends AuthEnv {
  readonly ORCHESTRATOR_USER_DO: DurableObjectNamespace;
  readonly AGENT_CORE?: Fetcher & {
    start?: AgentRpcMethod;
    status?: AgentRpcMethod;
    // ZX2 Phase 3 P3-01 — extended RPC surface
    input?: AgentRpcMethod;
    cancel?: AgentRpcMethod;
    verify?: AgentRpcMethod;
    timeline?: AgentRpcMethod;
    streamSnapshot?: AgentRpcMethod;
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
  | "ws"
  // ZX2 Phase 5 P5-01 — facade-必需 HTTP endpoints
  | "permission/decision"
  | "policy/permission_mode"
  | "usage"
  | "resume";
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
  if (segments[0] !== "sessions") return null;
  // 3-segment routes: /sessions/{uuid}/{action}
  if (segments.length === 3) {
    const sessionUuid = segments[1]!;
    const action = segments[2] as SessionAction;
    if (!UUID_RE.test(sessionUuid)) return null;
    if (
      ![
        "start",
        "input",
        "cancel",
        "status",
        "timeline",
        "history",
        "verify",
        "ws",
        "usage",
        "resume",
      ].includes(action)
    )
      return null;
    return { sessionUuid, action };
  }
  // ZX2 Phase 5 P5-01 — 4-segment compound actions:
  //   /sessions/{uuid}/permission/decision
  //   /sessions/{uuid}/policy/permission_mode
  if (segments.length === 4) {
    const sessionUuid = segments[1]!;
    if (!UUID_RE.test(sessionUuid)) return null;
    const compound = `${segments[2]}/${segments[3]}` as SessionAction;
    if (compound === "permission/decision" || compound === "policy/permission_mode") {
      return { sessionUuid, action: compound };
    }
  }
  return null;
}

// ZX2 Phase 5 P5-01 — catalog routes (non-session-bound).
type CatalogKind = "skills" | "commands" | "agents";
function parseCatalogRoute(request: Request): CatalogKind | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  if (method !== "GET") return null;
  if (pathname === "/catalog/skills") return "skills";
  if (pathname === "/catalog/commands") return "commands";
  if (pathname === "/catalog/agents") return "agents";
  return null;
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

  // ZX2 Phase 4 P4-02 — wrap the auth-contract envelope into facade-http-v1
  // so every public response shares the same `{ok,data,trace_uuid}` /
  // `{ok:false,error,trace_uuid}` shape across auth + session routes.
  const facade = facadeFromAuthEnvelope(envelope, traceUuid);
  return Response.json(facade, {
    status: facade.ok ? 200 : facade.error.status,
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

    // ZX2 Phase 5 P5-01 — public catalog routes (skills / commands / agents).
    const catalogRoute = parseCatalogRoute(request);
    if (catalogRoute) {
      return handleCatalog(request, env, catalogRoute);
    }

    // ZX2 Phase 5 P5-02 — public /me/sessions routes (server-mint UUID).
    const meSessionsRoute = parseMeSessionsRoute(request);
    if (meSessionsRoute) {
      return handleMeSessions(request, env, meSessionsRoute);
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

    const response = await stub.fetch(new Request(`https://orchestrator.internal/sessions/${route.sessionUuid}/${route.action}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === null ? undefined : JSON.stringify({
        ...body,
        trace_uuid: auth.value.trace_uuid,
        auth_snapshot: auth.value.snapshot,
        initial_context_seed: auth.value.initial_context_seed,
      }),
    }));

    // ZX2 Phase 4 P4-02 — wrap the User-DO JSON response in a
    // facade-http-v1 envelope. Already-envelope-shaped bodies (e.g. when
    // a downstream layer constructs `{ok,data,trace_uuid}` directly) are
    // passed through unchanged so the wrapper is idempotent.
    return wrapSessionResponse(response, auth.value.trace_uuid);
  },
};

// ZX2 Phase 5 P5-01 — catalog handler. Returns a static (per-deploy)
// list of skills / commands / agents. The list is intentionally empty by
// default — concrete plug-ins are registered by future plans (skill/
// command frameworks). Response is wrapped in facade-http-v1.
async function handleCatalog(
  request: Request,
  _env: OrchestratorCoreEnv,
  kind: CatalogKind,
): Promise<Response> {
  const traceUuid = readTraceUuid(request) ?? crypto.randomUUID();
  const data = (() => {
    switch (kind) {
      case "skills":
        return { skills: [] as Array<{ name: string; description: string }> };
      case "commands":
        return { commands: [] as Array<{ name: string; description: string }> };
      case "agents":
        return { agents: [] as Array<{ name: string; description: string }> };
    }
  })();
  return Response.json(
    { ok: true, data, trace_uuid: traceUuid },
    { status: 200, headers: { "x-trace-uuid": traceUuid } },
  );
}

// ZX2 Phase 5 P5-02 — /me/sessions routes.
type MeSessionsRoute = { kind: "create" } | { kind: "list" };
function parseMeSessionsRoute(request: Request): MeSessionsRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  if (pathname !== "/me/sessions") return null;
  if (method === "POST") return { kind: "create" };
  if (method === "GET") return { kind: "list" };
  return null;
}

async function handleMeSessions(
  request: Request,
  env: OrchestratorCoreEnv,
  route: MeSessionsRoute,
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;

  if (route.kind === "create") {
    // Reject client-supplied UUID — the whole point of this endpoint is
    // server-mint as the single source of truth.
    const body = await parseBody(request, true);
    if (body && typeof (body as Record<string, unknown>).session_uuid === "string") {
      return jsonPolicyError(
        400,
        "invalid-input",
        "POST /me/sessions does not accept a client-supplied session_uuid; UUID is server-minted",
        traceUuid,
      );
    }
    const sessionUuid = crypto.randomUUID();
    const ttlSeconds = 24 * 60 * 60;
    const createdAt = new Date().toISOString();
    return Response.json(
      {
        ok: true,
        data: {
          session_uuid: sessionUuid,
          status: "pending",
          ttl_seconds: ttlSeconds,
          created_at: createdAt,
          start_url: `/sessions/${sessionUuid}/start`,
        },
        trace_uuid: traceUuid,
      },
      { status: 201, headers: { "x-trace-uuid": traceUuid } },
    );
  }

  // GET /me/sessions — list user's sessions. v1: forward to User DO which
  // owns the index. The User DO already exposes a hot index; we add a new
  // route /me/sessions on the DO (P5-02 second part).
  const stub = env.ORCHESTRATOR_USER_DO.get(env.ORCHESTRATOR_USER_DO.idFromName(auth.value.user_uuid));
  const response = await stub.fetch(
    new Request("https://orchestrator.internal/me/sessions", {
      method: "GET",
      headers: {
        "x-trace-uuid": traceUuid,
        "x-nano-internal-authority": JSON.stringify(auth.value.snapshot),
      },
    }),
  );
  return wrapSessionResponse(response, traceUuid);
}

async function wrapSessionResponse(
  response: Response,
  traceUuid: string,
): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    // Non-JSON (e.g. websocket upgrade) — pass through.
    return response;
  }
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "ok" in (body as Record<string, unknown>) &&
    typeof (body as Record<string, unknown>).ok === "boolean"
  ) {
    // Already wrapped — make sure trace_uuid is stamped.
    const obj = body as Record<string, unknown>;
    if (typeof obj.trace_uuid !== "string" || obj.trace_uuid.length === 0) {
      obj.trace_uuid = traceUuid;
    }
    return Response.json(obj, {
      status: response.status,
      headers: { "x-trace-uuid": traceUuid },
    });
  }
  if (response.ok) {
    return Response.json(
      { ok: true, data: body, trace_uuid: traceUuid },
      { status: response.status, headers: { "x-trace-uuid": traceUuid } },
    );
  }
  // Error path: try to lift `{ error, message }` legacy shape into facade.error
  const obj = (body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}) as { error?: string; message?: string; code?: string };
  const code = (obj.code ?? obj.error ?? "internal-error") as FacadeErrorCode;
  const message = obj.message ?? obj.error ?? "session route returned an error";
  return Response.json(
    {
      ok: false,
      error: {
        code,
        status: response.status,
        message,
      },
      trace_uuid: traceUuid,
    },
    { status: response.status, headers: { "x-trace-uuid": traceUuid } },
  );
}

export { NanoOrchestratorUserDO };
export default worker;
