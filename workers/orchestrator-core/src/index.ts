import { NACP_VERSION } from "@haimang/nacp-core";
import { attachServerTimings, buildFacadeServerTimings } from "@haimang/nacp-core/logger";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import {
  facadeFromAuthEnvelope,
  type FacadeErrorCode,
  type OrchestratorAuthRpcService,
} from "@haimang/orchestrator-auth-contract";
import { NANO_PACKAGE_MANIFEST } from "./generated/package-manifest.js";
import { authenticateRequest, clearDeviceGateCache, type AuthEnv } from "./auth.js";
import { buildAuditPersist, createOrchestratorLogger } from "./observability.js";
import { ensureConfiguredTeam, jsonPolicyError, readTraceUuid } from "./policy/authority.js";
import { D1SessionTruthRepository } from "./session-truth.js";
import { NanoOrchestratorUserDO } from "./user-do.js";
import { buildDebugPackagesResponse } from "./debug/packages.js";

void NANO_PACKAGE_MANIFEST;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SESSION_FILE_BYTES = 25 * 1024 * 1024;
const MIME_RE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;

function getLogger(env: OrchestratorCoreEnv) {
  return createOrchestratorLogger(env);
}

// ZX2 Phase 3 P3-01/02 — agent-core RPC method signature.
//
// History: this contract was originally introduced for dual-track parity
// (ZX2 P3-01 RPC vs HTTP, jsonDeepEqual fan-out). ZX4 P9 P9-01 retired the
// HTTP shadow path; the binding is now the **sole** transport for input /
// cancel / verify / timeline (P3-05 flip executed). The "shadow"-era
// comparison helpers and `forwardInternalJsonShadow` method name are kept
// purely for diff hygiene — no HTTP-truth comparison is performed.
// Tracked for rename in the next envelope refactor (per ZX5 closure §3.2 +
// 4-reviewer review O11).
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
    // ZX4 Phase 4 P4-01 / Phase 6 P6-01 — decision-forwarding RPCs.
    permissionDecision?: AgentRpcMethod;
    elicitationAnswer?: AgentRpcMethod;
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
  readonly NODE_AUTH_TOKEN?: string;
  readonly GITHUB_TOKEN?: string;
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

function clampLimit(raw: string | null, fallback: number, max: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

function readAuthTeam(auth: Awaited<ReturnType<typeof authenticateRequest>> & { ok: true }): string | null {
  return auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid ?? null;
}

function isTeamOwner(auth: Awaited<ReturnType<typeof authenticateRequest>> & { ok: true }): boolean {
  return Number(auth.value.snapshot.membership_level ?? 0) >= 100;
}

async function authenticateDebugRequest(request: Request, env: OrchestratorCoreEnv) {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth;
  const teamUuid = readAuthTeam(auth);
  if (!teamUuid) {
    return {
      ok: false as const,
      response: jsonPolicyError(
        403,
        "missing-team-claim",
        "team_uuid missing from auth snapshot",
        auth.value.trace_uuid,
      ),
    };
  }
  return auth;
}

async function handleDebugLogs(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
  const auth = await authenticateDebugRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const teamUuid = readAuthTeam(auth)!;
  const db = env.NANO_AGENT_DB;
  if (!db) return jsonPolicyError(503, "worker-misconfigured", "debug log store unavailable", traceUuid);

  const url = new URL(request.url);
  const requestedTeam = url.searchParams.get("team_uuid");
  if (requestedTeam && requestedTeam !== teamUuid) {
    return jsonPolicyError(403, "permission-denied", "debug logs are team-scoped", traceUuid);
  }
  const clauses = ["team_uuid = ?1"];
  const binds: unknown[] = [teamUuid];
  const addClause = (column: string, value: string | null, op = "=") => {
    if (!value) return;
    binds.push(value);
    clauses.push(`${column} ${op} ?${binds.length}`);
  };
  addClause("trace_uuid", url.searchParams.get("trace_uuid"));
  addClause("session_uuid", url.searchParams.get("session_uuid"));
  addClause("code", url.searchParams.get("code"));
  addClause("created_at", url.searchParams.get("since"), ">=");
  const limit = clampLimit(url.searchParams.get("limit"), 100, 200);
  binds.push(limit);
  const rows = await db.prepare(
    `SELECT log_uuid, trace_uuid, session_uuid, team_uuid, worker, code, category,
            severity, http_status, message, context_json, rpc_log_failed, created_at
       FROM nano_error_log
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?${binds.length}`,
  ).bind(...binds).all<Record<string, unknown>>();
  return Response.json({
    ok: true,
    data: {
      logs: rows.results ?? [],
      limit,
    },
    trace_uuid: traceUuid,
  }, { headers: { "x-trace-uuid": traceUuid } });
}

async function handleDebugRecentErrors(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
  const auth = await authenticateDebugRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const teamUuid = readAuthTeam(auth)!;
  const limit = clampLimit(new URL(request.url).searchParams.get("limit"), 100, 200);
  const recent = getLogger(env)
    .recentErrors(limit)
    .filter((record) => !record.team_uuid || record.team_uuid === teamUuid);
  return Response.json({
    ok: true,
    data: {
      recent_errors: recent,
      limit,
    },
    trace_uuid: traceUuid,
  }, { headers: { "x-trace-uuid": traceUuid } });
}

async function handleDebugAudit(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
  const auth = await authenticateDebugRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  if (!isTeamOwner(auth)) {
    return jsonPolicyError(403, "permission-denied", "debug audit requires team owner", traceUuid);
  }
  const teamUuid = readAuthTeam(auth)!;
  const db = env.NANO_AGENT_DB;
  if (!db) return jsonPolicyError(503, "worker-misconfigured", "debug audit store unavailable", traceUuid);

  const url = new URL(request.url);
  const requestedTeam = url.searchParams.get("team_uuid");
  if (requestedTeam && requestedTeam !== teamUuid) {
    return jsonPolicyError(403, "permission-denied", "debug audit is team-scoped", traceUuid);
  }
  const clauses = ["team_uuid = ?1"];
  const binds: unknown[] = [teamUuid];
  const addClause = (column: string, value: string | null, op = "=") => {
    if (!value) return;
    binds.push(value);
    clauses.push(`${column} ${op} ?${binds.length}`);
  };
  addClause("event_kind", url.searchParams.get("event_kind"));
  addClause("trace_uuid", url.searchParams.get("trace_uuid"));
  addClause("session_uuid", url.searchParams.get("session_uuid"));
  addClause("created_at", url.searchParams.get("since"), ">=");
  const limit = clampLimit(url.searchParams.get("limit"), 100, 200);
  binds.push(limit);
  const rows = await db.prepare(
    `SELECT audit_uuid, trace_uuid, session_uuid, team_uuid, user_uuid, device_uuid,
            worker, event_kind, ref_kind, ref_uuid, detail_json, outcome, created_at
       FROM nano_audit_log
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?${binds.length}`,
  ).bind(...binds).all<Record<string, unknown>>();
  return Response.json({
    ok: true,
    data: {
      audit: rows.results ?? [],
      limit,
    },
    trace_uuid: traceUuid,
  }, { headers: { "x-trace-uuid": traceUuid } });
}

async function handleDebugPackages(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
  const auth = await authenticateDebugRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const data = await buildDebugPackagesResponse(NANO_PACKAGE_MANIFEST, env);
  return Response.json({
    ok: true,
    data,
    trace_uuid: traceUuid,
  }, { headers: { "x-trace-uuid": traceUuid } });
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
  | "close"
  | "delete"
  | "title"
  | "status"
  | "timeline"
  | "history"
  | "verify"
  | "ws"
  // ZX2 Phase 5 P5-01 — facade-必需 HTTP endpoints
  | "permission/decision"
  | "policy/permission_mode"
  // ZX4 Phase 6 P6-01 — elicitation answer return path.
  | "elicitation/answer"
  | "usage"
  | "resume"
  // ZX5 Lane D D3/D4 — product surface endpoints.
  | "messages"
  | "files";
type AuthAction =
  | "register"
  | "login"
  | "refresh"
  | "verify"
  | "me"
  | "resetPassword"
  | "wechatLogin"
  | "revokeApiKey";
type SessionFilesRoute =
  | { kind: "list"; sessionUuid: string }
  | { kind: "upload"; sessionUuid: string }
  | { kind: "content"; sessionUuid: string; fileUuid: string };

function parseSessionRoute(request: Request): { sessionUuid: string; action: SessionAction } | null {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const method = request.method.toUpperCase();
  if (segments[0] !== "sessions") return null;
  if (segments.length === 2 && method === "DELETE") {
    const sessionUuid = segments[1]!;
    if (!UUID_RE.test(sessionUuid)) return null;
    return { sessionUuid, action: "delete" };
  }
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
        "close",
        "title",
        "status",
        "timeline",
        "history",
        "verify",
        "ws",
        "usage",
        "resume",
        // ZX5 Lane D D3/D4 — multimodal messages + artifact files.
        "messages",
        "files",
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
    if (
      compound === "permission/decision" ||
      compound === "policy/permission_mode" ||
      compound === "elicitation/answer"
    ) {
      return { sessionUuid, action: compound };
    }
  }
  return null;
}

function parseSessionFilesRoute(request: Request): SessionFilesRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const listOrUpload = pathname.match(/^\/sessions\/([^/]+)\/files$/);
  if (listOrUpload) {
    const sessionUuid = listOrUpload[1]!;
    if (!UUID_RE.test(sessionUuid)) return null;
    if (method === "GET") return { kind: "list", sessionUuid };
    if (method === "POST") return { kind: "upload", sessionUuid };
    return null;
  }
  const content = pathname.match(/^\/sessions\/([^/]+)\/files\/([^/]+)\/content$/);
  if (!content || method !== "GET") return null;
  const sessionUuid = content[1]!;
  const fileUuid = content[2]!;
  if (!UUID_RE.test(sessionUuid) || !UUID_RE.test(fileUuid)) return null;
  return { kind: "content", sessionUuid, fileUuid };
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
  if (method === "POST" && pathname === "/auth/api-keys/revoke") return "revokeApiKey";
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

function readDeviceMetadata(request: Request): Record<string, unknown> {
  const deviceUuid = request.headers.get("x-device-uuid");
  const deviceLabel = request.headers.get("x-device-label");
  const deviceKind = request.headers.get("x-device-kind");
  return {
    ...(typeof deviceUuid === "string" && deviceUuid.length > 0 ? { device_uuid: deviceUuid } : {}),
    ...(typeof deviceLabel === "string" && deviceLabel.length > 0 ? { device_label: deviceLabel } : {}),
    ...(typeof deviceKind === "string" && deviceKind.length > 0 ? { device_kind: deviceKind } : {}),
  };
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
  const deviceMetadata = readDeviceMetadata(request);
  let input =
    action === "me" || action === "verify"
      ? { access_token: accessToken }
      : action === "resetPassword"
        ? { ...(body ?? {}), access_token: accessToken }
        : { ...(body ?? {}), ...deviceMetadata };

  if (action === "revokeApiKey") {
    const auth = await authenticateRequest(request, env);
    if (!auth.ok) return auth.response;
    const teamUuid = auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid;
    if (!teamUuid) {
      return jsonPolicyError(403, "missing-team-claim", "team_uuid missing from auth snapshot", traceUuid);
    }
    input = {
      ...(body ?? {}),
      team_uuid: teamUuid,
      user_uuid: auth.value.user_uuid,
    };
  }

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
                : action === "revokeApiKey"
                  ? await env.ORCHESTRATOR_AUTH.revokeApiKey(input, meta)
                  : await env.ORCHESTRATOR_AUTH.wechatLogin({ ...input, ...deviceMetadata }, meta);

  // ZX2 Phase 4 P4-02 — wrap the auth-contract envelope into facade-http-v1
  // so every public response shares the same `{ok,data,trace_uuid}` /
  // `{ok:false,error,trace_uuid}` shape across auth + session routes.
  const facade = facadeFromAuthEnvelope(
    envelope as
      | { readonly ok: true; readonly data: unknown }
      | {
          readonly ok: false;
          readonly error: { readonly code: string; readonly status: number; readonly message: string };
        },
    traceUuid,
  );
  return Response.json(facade, {
    status: facade.ok ? 200 : facade.error.status,
    headers: { "x-trace-uuid": traceUuid },
  });
}

async function dispatchFetch(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const method = request.method.toUpperCase();

    if (method === "GET" && (pathname === "/" || pathname === "/health")) {
      return Response.json(createShellResponse(env));
    }

    if (method === "GET" && pathname === "/debug/workers/health") {
      return buildWorkerHealthSnapshot(env);
    }
    if (method === "GET" && pathname === "/debug/logs") {
      return handleDebugLogs(request, env);
    }
    if (method === "GET" && pathname === "/debug/recent-errors") {
      return handleDebugRecentErrors(request, env);
    }
    if (method === "GET" && pathname === "/debug/audit") {
      return handleDebugAudit(request, env);
    }
    if (method === "GET" && pathname === "/debug/packages") {
      return handleDebugPackages(request, env);
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

    // ZX5 Lane D D5 — GET /me/conversations:对 ZX4 P3-05 已 land 的
    // 5 状态 D1 view 做 conversation 维度聚合(把同 conversation_uuid
    // 的多个 session 收成一个 conversation row)。
    if (method === "GET" && pathname === "/me/conversations") {
      return handleMeConversations(request, env);
    }
    const conversationDetailRoute = parseConversationDetailRoute(request);
    if (conversationDetailRoute) {
      return handleConversationDetail(request, env, conversationDetailRoute);
    }

    if ((method === "GET" || method === "PATCH") && pathname === "/me/team") {
      return handleMeTeam(request, env);
    }
    if (method === "GET" && pathname === "/me/teams") {
      return handleMeTeams(request, env);
    }

    // ZX5 Lane D D6 — GET /me/devices(list)+ POST /me/devices/revoke
    // (per Q9 owner direction:device truth in D1, single-device revoke
    // granularity, refresh chain immediate kill + auth gate immediate reject).
    if (method === "GET" && pathname === "/me/devices") {
      return handleMeDevicesList(request, env);
    }
    if (method === "POST" && pathname === "/me/devices/revoke") {
      return handleMeDevicesRevoke(request, env);
    }

    // RH2 P2-04 — GET /models(D1 真相源 + per-team policy filter + ETag)
    if (method === "GET" && pathname === "/models") {
      return handleModelsList(request, env);
    }

    // RH2 P2-05/06/07 — context inspection endpoints
    if (method === "GET" && /^\/sessions\/[^/]+\/context$/.test(pathname)) {
      return handleSessionContext(request, env, "get");
    }
    if (method === "GET" && /^\/sessions\/[^/]+\/context\/probe$/.test(pathname)) {
      return handleSessionContext(request, env, "probe");
    }
    if (method === "GET" && /^\/sessions\/[^/]+\/context\/layers$/.test(pathname)) {
      return handleSessionContext(request, env, "layers");
    }
    if (method === "POST" && /^\/sessions\/[^/]+\/context\/snapshot$/.test(pathname)) {
      return handleSessionContext(request, env, "snapshot");
    }
    if (method === "POST" && /^\/sessions\/[^/]+\/context\/compact\/preview$/.test(pathname)) {
      return handleSessionContext(request, env, "compact-preview");
    }
    if (method === "POST" && /^\/sessions\/[^/]+\/context\/compact$/.test(pathname)) {
      return handleSessionContext(request, env, "compact");
    }
    if (method === "GET" && /^\/sessions\/[^/]+\/context\/compact\/jobs\/[^/]+$/.test(pathname)) {
      return handleSessionContext(request, env, "compact-job");
    }

    const tenantError = ensureTenantConfigured(env);
    if (tenantError) return tenantError;

    const filesRoute = parseSessionFilesRoute(request);
    if (filesRoute) {
      return handleSessionFiles(request, env, filesRoute);
    }
    const checkpointRoute = parseSessionCheckpointRoute(request);
    if (checkpointRoute) {
      return handleSessionCheckpoint(request, env, checkpointRoute);
    }

    const route = parseSessionRoute(request);
    if (!route) return jsonPolicyError(404, "not-found", "route not found");

    const auth = await authenticateRequest(request, env, {
      allowQueryToken: route.action === "ws",
    });
    if (!auth.ok) return auth.response;

    const stub = env.ORCHESTRATOR_USER_DO.get(env.ORCHESTRATOR_USER_DO.idFromName(auth.value.user_uuid));

    if (route.action === "ws") {
      const publicUrl = new URL(request.url);
      const internalUrl = new URL(`https://orchestrator.internal/sessions/${route.sessionUuid}/ws`);
      const lastSeenSeq = publicUrl.searchParams.get("last_seen_seq");
      if (lastSeenSeq !== null) {
        internalUrl.searchParams.set("last_seen_seq", lastSeenSeq);
      }
      return stub.fetch(new Request(internalUrl, {
        method: "GET",
        headers: isWebSocketUpgrade(request)
          ? {
              upgrade: "websocket",
              "x-trace-uuid": auth.value.trace_uuid,
              "x-nano-internal-authority": JSON.stringify(auth.value.snapshot),
            }
          : {
              "x-trace-uuid": auth.value.trace_uuid,
              "x-nano-internal-authority": JSON.stringify(auth.value.snapshot),
            },
      }));
    }

    const optionalBody =
      route.action === "cancel" ||
      route.action === "resume" ||
      route.action === "close" ||
      route.action === "delete";
    const needsBody = route.action === "start" || route.action === "input" || route.action === "cancel"
      || route.action === "verify" || route.action === "messages"
      || route.action === "resume" || route.action === "permission/decision"
      || route.action === "policy/permission_mode" || route.action === "elicitation/answer"
      || route.action === "close" || route.action === "delete" || route.action === "title";
    const body = needsBody ? await parseBody(request, optionalBody) : null;
    if (needsBody && body === null) {
        return jsonPolicyError(400, `invalid-${route.action}-body`, `${route.action} requires a JSON body`);
    }

    const response = await stub.fetch(new Request(`https://orchestrator.internal/sessions/${route.sessionUuid}/${route.action}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-trace-uuid": auth.value.trace_uuid,
        "x-nano-internal-authority": JSON.stringify(auth.value.snapshot),
      },
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
  }

// RHX2 P3-04/P3-05 — outer wrapper that injects `Server-Timing: total;dur=N`
// onto every facade response. First-wave §7.2 F6 covers `total` only;
// `auth` and `agent` segments require timing capture inside the
// downstream proxy paths and land in a follow-up commit.
const worker = {
  async fetch(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
    const startedAt = Date.now();
    const response = await dispatchFetch(request, env);
    const totalMs = Date.now() - startedAt;
    return attachServerTimings(response, buildFacadeServerTimings({ totalMs }));
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
  // ZX5 Lane D D2 — registry 从 catalog-content.ts 静态加载;每个 entry
  // 含 name / description / version / status。后续若 owner 需要可改为
  // D1 / KV / R2 加载,接口形状(facade-http-v1 envelope)不变。
  const { CATALOG_SKILLS, CATALOG_COMMANDS, CATALOG_AGENTS } = await import("./catalog-content.js");
  const data = (() => {
    switch (kind) {
      case "skills":
        return { skills: CATALOG_SKILLS };
      case "commands":
        return { commands: CATALOG_COMMANDS };
      case "agents":
        return { agents: CATALOG_AGENTS };
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
    // ZX4 P3-03 — D1 pending truth: insert nano_conversations + nano_conversation_sessions
    // pair so GET /me/sessions can surface the pending row before /start arrives,
    // and so alarm GC has a row to expire after 24h. NANO_AGENT_DB may be absent
    // in tests / shell-only runs; in that case we fall back to the previous
    // KV-only behavior so the F3 probe and unit-test paths keep working.
    if (env.NANO_AGENT_DB) {
      const teamUuid = auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid;
      const actorUserUuid = auth.value.snapshot.user_uuid ?? auth.value.snapshot.sub;
      if (typeof teamUuid === "string" && teamUuid.length > 0) {
        const repo = new D1SessionTruthRepository(env.NANO_AGENT_DB);
        try {
          await repo.mintPendingSession({
            session_uuid: sessionUuid,
            team_uuid: teamUuid,
            actor_user_uuid: actorUserUuid,
            trace_uuid: traceUuid,
            minted_at: createdAt,
          });
        } catch (error) {
          getLogger(env).warn("me-sessions-mint-d1-failed", {
            code: "internal-error",
            ctx: {
              tag: "me-sessions-mint-d1-failed",
              session_uuid: sessionUuid,
              error: String(error),
            },
          });
          return jsonPolicyError(
            500,
            "internal-error",
            "failed to persist pending session row",
            traceUuid,
          );
        }
      }
    }
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

  if (!env.NANO_AGENT_DB) {
    return Response.json(
      { ok: true, data: { sessions: [], next_cursor: null }, trace_uuid: traceUuid },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  }
  const url = new URL(request.url);
  const limit = parseListLimit(url.searchParams.get("limit"), 50, 200);
  const cursor = parseSessionCursor(url.searchParams.get("cursor"));
  const repo = new D1SessionTruthRepository(env.NANO_AGENT_DB);
  const rows = await repo.listSessionsForUser({
    team_uuid: auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid!,
    actor_user_uuid: auth.value.user_uuid,
    limit: limit + 1,
    cursor,
  });
  const nextCursor =
    rows.length > limit
      ? encodeSessionCursor(rows[limit]!.started_at, rows[limit]!.session_uuid)
      : null;
  const sessions = rows.slice(0, limit).map((row) => ({
    conversation_uuid: row.conversation_uuid,
    session_uuid: row.session_uuid,
    status: row.session_status,
    last_phase: row.last_phase,
    last_seen_at: row.ended_at ?? row.started_at,
    created_at: row.started_at,
    ended_at: row.ended_at,
    ended_reason: row.ended_reason,
    title: row.title,
  }));
  return Response.json(
    { ok: true, data: { sessions, next_cursor: nextCursor }, trace_uuid: traceUuid },
    { status: 200, headers: { "x-trace-uuid": traceUuid } },
  );
}

// ZX5 Lane D D5 — GET /me/conversations.
// 对照 D5 owner direction(per Q5):仅复用现有 D1 truth(`nano_conversation_sessions`)
// + ZX4 P3-05 落地的 5 状态视图;不新建平行表。
//
// 形态:
//   GET /me/conversations
//     ?limit=<n>       — 默认 50,上限 200
//
// Response(facade-http-v1 envelope):
//   {
//     ok: true,
//     data: {
//       conversations: Array<{
//         conversation_uuid: string,
//         latest_session_uuid: string,
//         latest_status: 'pending'|'starting'|'active'|'detached'|'ended'|'expired',
//         started_at: string,                     // earliest session.started_at in conv
//         latest_session_started_at: string,      // latest session.started_at in conv (sort key)
//         last_seen_at: string,                   // legacy alias of latest_session_started_at
//                                                 // — kept for one release per ZX5 GPT R4
//         last_phase: string | null,
//         session_count: number,
//       }>,
//       next_cursor: null,
//     },
//     trace_uuid: string,
//   }
//
// 实现:authenticate → 通过 service binding 调 User-DO `/me/conversations`;
// User-DO 内部复用 `D1SessionTruthRepository.listSessionsForUser({limit})`
// 的结果,按 conversation_uuid group。
function parseListLimit(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > max) {
    return fallback;
  }
  return value;
}

function encodeConversationCursor(startedAt: string, conversationUuid: string): string {
  return `${startedAt}|${conversationUuid}`;
}

function encodeSessionCursor(startedAt: string, sessionUuid: string): string {
  return `${startedAt}|${sessionUuid}`;
}

function parseSessionCursor(raw: string | null): { started_at: string; session_uuid: string } | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const [startedAt, sessionUuid] = raw.split("|");
  if (!startedAt || !sessionUuid || !UUID_RE.test(sessionUuid)) return null;
  return { started_at: startedAt, session_uuid: sessionUuid };
}

function parseConversationCursor(raw: string | null): { started_at: string; conversation_uuid: string } | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const [startedAt, conversationUuid] = raw.split("|");
  if (!startedAt || !conversationUuid || !UUID_RE.test(conversationUuid)) return null;
  return { started_at: startedAt, conversation_uuid: conversationUuid };
}

type ConversationDetailRoute = { conversationUuid: string };

function parseConversationDetailRoute(request: Request): ConversationDetailRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const match = pathname.match(/^\/conversations\/([^/]+)$/);
  if (!match || method !== "GET") return null;
  const conversationUuid = match[1]!;
  if (!UUID_RE.test(conversationUuid)) return null;
  return { conversationUuid };
}

type SessionCheckpointRoute =
  | { kind: "list"; sessionUuid: string }
  | { kind: "create"; sessionUuid: string }
  | { kind: "diff"; sessionUuid: string; checkpointUuid: string };

function parseSessionCheckpointRoute(request: Request): SessionCheckpointRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const listOrCreate = pathname.match(/^\/sessions\/([^/]+)\/checkpoints$/);
  if (listOrCreate) {
    const sessionUuid = listOrCreate[1]!;
    if (!UUID_RE.test(sessionUuid)) return null;
    if (method === "GET") return { kind: "list", sessionUuid };
    if (method === "POST") return { kind: "create", sessionUuid };
    return null;
  }
  const diff = pathname.match(/^\/sessions\/([^/]+)\/checkpoints\/([^/]+)\/diff$/);
  if (!diff || method !== "GET") return null;
  const sessionUuid = diff[1]!;
  const checkpointUuid = diff[2]!;
  if (!UUID_RE.test(sessionUuid) || !UUID_RE.test(checkpointUuid)) return null;
  return { kind: "diff", sessionUuid, checkpointUuid };
}

async function handleMeConversations(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return Response.json(
      { ok: true, data: { conversations: [], next_cursor: null }, trace_uuid: traceUuid },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  }

  const url = new URL(request.url);
  const limit = parseListLimit(url.searchParams.get("limit"), 50, 200);
  const cursor = parseConversationCursor(url.searchParams.get("cursor"));
  const repo = new D1SessionTruthRepository(db);
  const rows = await repo.listConversationsForUser({
    team_uuid: auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid!,
    actor_user_uuid: auth.value.user_uuid,
    limit: limit + 1,
    cursor: cursor
      ? {
          latest_session_started_at: cursor.started_at,
          conversation_uuid: cursor.conversation_uuid,
        }
      : null,
  });
  const page = rows.slice(0, limit + 1);
  const nextCursor = page.length > limit
    ? encodeConversationCursor(page[limit]!.latest_session_started_at, page[limit]!.conversation_uuid)
    : null;
  const conversations = page.slice(0, limit);

  return Response.json(
    { ok: true, data: { conversations, next_cursor: nextCursor }, trace_uuid: traceUuid },
    { status: 200, headers: { "x-trace-uuid": traceUuid } },
  );
}

async function handleConversationDetail(
  request: Request,
  env: OrchestratorCoreEnv,
  route: ConversationDetailRoute,
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return jsonPolicyError(
      503,
      "worker-misconfigured",
      "NANO_AGENT_DB binding must be configured",
      traceUuid,
    );
  }
  const repo = new D1SessionTruthRepository(db);
  const detail = await repo.readConversationDetail({
    conversation_uuid: route.conversationUuid,
    team_uuid: auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid!,
    actor_user_uuid: auth.value.user_uuid,
  });
  if (!detail) {
    return jsonPolicyError(404, "not-found", "conversation not found", traceUuid);
  }
  return Response.json(
    { ok: true, data: detail, trace_uuid: traceUuid },
    { status: 200, headers: { "x-trace-uuid": traceUuid } },
  );
}

async function handleSessionCheckpoint(
  request: Request,
  env: OrchestratorCoreEnv,
  route: SessionCheckpointRoute,
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return jsonPolicyError(
      503,
      "worker-misconfigured",
      "NANO_AGENT_DB binding must be configured",
      traceUuid,
    );
  }
  const repo = new D1SessionTruthRepository(db);
  const session = await repo.readSessionLifecycle(route.sessionUuid);
  if (
    !session ||
    session.team_uuid !== (auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid) ||
    session.actor_user_uuid !== auth.value.user_uuid
  ) {
    return jsonPolicyError(404, "not-found", "session not found", traceUuid);
  }
  if (session.deleted_at) {
    return jsonPolicyError(
      409,
      "conversation-deleted",
      "conversation is deleted",
      traceUuid,
    );
  }

  if (route.kind === "list") {
    const checkpoints = await repo.listCheckpoints({
      session_uuid: route.sessionUuid,
      team_uuid: session.team_uuid,
    });
    return Response.json(
      {
        ok: true,
        data: {
          session_uuid: route.sessionUuid,
          conversation_uuid: session.conversation_uuid,
          checkpoints,
        },
        trace_uuid: traceUuid,
      },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  }

  if (route.kind === "create") {
    const body = await parseBody(request, true);
    const rawLabel = typeof body?.label === "string" ? body.label.trim() : "";
    if (body?.label !== undefined && (rawLabel.length === 0 || rawLabel.length > 200)) {
      return jsonPolicyError(
        400,
        "invalid-input",
        "label must be a non-empty string up to 200 characters",
        traceUuid,
      );
    }
    const checkpoint = await repo.createUserCheckpoint({
      session_uuid: route.sessionUuid,
      team_uuid: session.team_uuid,
      label: rawLabel.length > 0 ? rawLabel : null,
      created_at: new Date().toISOString(),
    });
    if (!checkpoint) {
      return jsonPolicyError(500, "internal-error", "failed to create checkpoint", traceUuid);
    }
    return Response.json(
      {
        ok: true,
        data: {
          session_uuid: route.sessionUuid,
          conversation_uuid: session.conversation_uuid,
          checkpoint,
        },
        trace_uuid: traceUuid,
      },
      { status: 201, headers: { "x-trace-uuid": traceUuid } },
    );
  }

  const diff = await repo.readCheckpointDiff({
    session_uuid: route.sessionUuid,
    checkpoint_uuid: route.checkpointUuid,
    team_uuid: session.team_uuid,
  });
  if (!diff) {
    return jsonPolicyError(404, "not-found", "checkpoint not found", traceUuid);
  }
  return Response.json(
    {
      ok: true,
      data: {
        session_uuid: route.sessionUuid,
        conversation_uuid: session.conversation_uuid,
        diff,
      },
      trace_uuid: traceUuid,
    },
    { status: 200, headers: { "x-trace-uuid": traceUuid } },
  );
}

async function readCurrentTeam(
  db: D1Database,
  userUuid: string,
  teamUuid: string,
): Promise<Record<string, unknown> | null> {
  return db.prepare(
    `SELECT
       t.team_uuid,
       t.team_name,
       t.team_slug,
       t.plan_level,
       m.membership_level
     FROM nano_teams t
     JOIN nano_team_memberships m
       ON m.team_uuid = t.team_uuid
    WHERE t.team_uuid = ?1
      AND m.user_uuid = ?2
    LIMIT 1`,
  ).bind(teamUuid, userUuid).first<Record<string, unknown>>();
}

async function handleMeTeam(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return jsonPolicyError(503, "worker-misconfigured", "team store unavailable", traceUuid);
  }
  const teamUuid = auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid;
  if (!teamUuid) {
    return jsonPolicyError(403, "missing-team-claim", "team_uuid missing from auth snapshot", traceUuid);
  }

  if (request.method.toUpperCase() === "PATCH") {
    const body = await parseBody(request);
    const teamName = typeof body?.team_name === "string" ? body.team_name.trim() : "";
    if (teamName.length === 0 || teamName.length > 80) {
      return jsonPolicyError(400, "invalid-input", "team_name must be a non-empty string up to 80 chars", traceUuid);
    }
    const membership = await readCurrentTeam(db, auth.value.user_uuid, teamUuid);
    if (!membership) {
      return jsonPolicyError(404, "not-found", "team not found", traceUuid);
    }
    if (Number(membership.membership_level ?? 0) < 100) {
      return jsonPolicyError(403, "permission-denied", "only team owner can update team_name", traceUuid);
    }
    await db.prepare(
      `UPDATE nano_teams
          SET team_name = ?2
        WHERE team_uuid = ?1`,
    ).bind(teamUuid, teamName).run();
  }

  const row = await readCurrentTeam(db, auth.value.user_uuid, teamUuid);
  if (!row) {
    return jsonPolicyError(404, "not-found", "team not found", traceUuid);
  }
  return Response.json(
    {
      ok: true,
      data: {
        team_uuid: String(row.team_uuid),
        team_name: String(row.team_name),
        team_slug: String(row.team_slug),
        membership_level: Number(row.membership_level),
        plan_level: Number(row.plan_level),
      },
      trace_uuid: traceUuid,
    },
    { status: 200, headers: { "x-trace-uuid": traceUuid } },
  );
}

async function handleMeTeams(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return Response.json(
      { ok: true, data: { teams: [] }, trace_uuid: traceUuid },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  }
  const rows = await db.prepare(
    `SELECT
       t.team_uuid,
       t.team_name,
       t.team_slug,
       t.plan_level,
       m.membership_level
     FROM nano_team_memberships m
     JOIN nano_teams t
       ON t.team_uuid = m.team_uuid
    WHERE m.user_uuid = ?1
    ORDER BY t.created_at ASC`,
  ).bind(auth.value.user_uuid).all<Record<string, unknown>>();
  const teams = (rows.results ?? []).map((row) => ({
    team_uuid: String(row.team_uuid),
    team_name: String(row.team_name),
    team_slug: String(row.team_slug),
    membership_level: Number(row.membership_level),
    plan_level: Number(row.plan_level),
  }));
  return Response.json(
    { ok: true, data: { teams }, trace_uuid: traceUuid },
    { status: 200, headers: { "x-trace-uuid": traceUuid } },
  );
}

// ZX5 Lane D D6 — GET /me/devices.
// Per Q9 owner direction:device truth 放 D1 表 `nano_user_devices`。本路径
// 直接读 D1,不走 service binding(orchestrator-auth 主要负责 sign/verify;
// device 列表读取在 orchestrator-core 走 D1 即可,降耦合)。
async function handleMeDevicesList(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return Response.json(
      { ok: true, data: { devices: [] }, trace_uuid: traceUuid },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  }
  try {
    const rows = await db.prepare(
      `SELECT device_uuid, device_label, device_kind, status,
              created_at, last_seen_at, revoked_at, revoked_reason
         FROM nano_user_devices
         WHERE user_uuid = ?1
           AND status = 'active'
         ORDER BY last_seen_at DESC
         LIMIT 100`,
    ).bind(auth.value.user_uuid).all<Record<string, unknown>>();
    const devices = (rows.results ?? []).map((r) => ({
      device_uuid: String(r.device_uuid),
      device_label: typeof r.device_label === "string" ? r.device_label : null,
      device_kind: String(r.device_kind),
      status: String(r.status),
      created_at: String(r.created_at),
      last_seen_at: String(r.last_seen_at),
      revoked_at: typeof r.revoked_at === "string" ? r.revoked_at : null,
      revoked_reason: typeof r.revoked_reason === "string" ? r.revoked_reason : null,
    }));
    return Response.json(
      { ok: true, data: { devices }, trace_uuid: traceUuid },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  } catch (error) {
    getLogger(env).warn("me-devices-list-d1-failed", {
      code: "internal-error",
      ctx: {
        tag: "me-devices-list-d1-failed",
        user_uuid: auth.value.user_uuid,
        error: String(error),
      },
    });
    return jsonPolicyError(500, "internal-error", "failed to list devices", traceUuid);
  }
}

// ZX5 Lane D D6 — POST /me/devices/revoke.
// Body shape:
//   { device_uuid: string, reason?: string }
//
// 行为(per Q9 owner direction):
// 1. 校验 device_uuid 属于当前 authenticated user(防止跨用户 revoke)
// 2. 在 D1 把 nano_user_devices.status = 'revoked' + revoked_at = now
// 3. 写一行 nano_user_device_revocations 用作 audit
// 4. 通过 service binding 通知 orchestrator-auth(若有 RPC 接口)/ best-effort
//    断开已 active session — 当前 ZX5 阶段 best-effort 仅记录 D1 状态;
//    refresh / verify 路径在下一次 auth gate 时通过 D1 lookup 拒绝(实现
//    在 orchestrator-auth/src/jwt.ts 的 verifyAccessToken 之后,可加一个
//    "device active check" — 留作 D6 的 second-half / 第二次 PR);
//    本期产出 schema + endpoint + D1 写入。
//
// TODO (D6 second-half, per ZX5 review GLM R9 + kimi R6):
//   - extend orchestrator-auth's verifyAccessToken / authenticateRequest to
//     SELECT nano_user_devices.status WHERE device_uuid = ?; status='revoked'
//     → 401 immediately (single D1 read, idempotent, no caching layer per Q11)
//   - extend IngressAuthSnapshot with device_uuid (claim-backed) so the WS
//     attach gate can drop revoked devices on the next attach attempt
//   - emit best-effort `session.terminate` server frame on already-attached
//     sessions whose device was just revoked (orchestrator-core User-DO has
//     the attachment map; needs a /me/devices/revoke → User-DO fan-out)
// Until that lands, the access token issued **before** revoke continues to
// authenticate until its `exp` claim — this is acceptable for the current
// product surface but documented here so it's not silently overlooked.
async function handleMeDevicesRevoke(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;

  const body = await parseBody(request);
  if (!body || typeof body !== "object") {
    return jsonPolicyError(400, "invalid-input", "revoke requires a JSON body", traceUuid);
  }
  const record = body as Record<string, unknown>;
  const deviceUuid = record.device_uuid;
  if (typeof deviceUuid !== "string" || !UUID_RE.test(deviceUuid)) {
    return jsonPolicyError(400, "invalid-input", "device_uuid must be a UUID", traceUuid);
  }
  const reason = typeof record.reason === "string" ? record.reason : null;

  const db = env.NANO_AGENT_DB;
  if (!db) {
    return jsonPolicyError(503, "worker-misconfigured", "device store unavailable", traceUuid);
  }

  try {
    // 1. ownership check
    const owned = await db.prepare(
      `SELECT user_uuid, status
         FROM nano_user_devices
        WHERE device_uuid = ?1
        LIMIT 1`,
    ).bind(deviceUuid).first<Record<string, unknown>>();
    if (!owned) {
      return jsonPolicyError(404, "not-found", "device not found", traceUuid);
    }
    if (String(owned.user_uuid) !== auth.value.user_uuid) {
      return jsonPolicyError(403, "permission-denied", "device does not belong to caller", traceUuid);
    }
    if (String(owned.status) === "revoked") {
      // idempotent: already revoked
      return Response.json(
        {
          ok: true,
          data: { device_uuid: deviceUuid, status: "revoked", already_revoked: true },
          trace_uuid: traceUuid,
        },
        { status: 200, headers: { "x-trace-uuid": traceUuid } },
      );
    }

    // 2 + 3. atomic UPDATE + audit insert
    const now = new Date().toISOString();
    const revocationUuid = crypto.randomUUID();
    await db.batch([
      db.prepare(
        `UPDATE nano_user_devices
            SET status = 'revoked',
                revoked_at = ?2,
                revoked_reason = ?3
          WHERE device_uuid = ?1`,
      ).bind(deviceUuid, now, reason),
      db.prepare(
        `INSERT INTO nano_user_device_revocations (
           revocation_uuid, device_uuid, user_uuid, revoked_at,
           revoked_by_user_uuid, reason, source
         ) VALUES (?1, ?2, ?3, ?4, ?3, ?5, 'self-service')`,
      ).bind(revocationUuid, deviceUuid, auth.value.user_uuid, now, reason),
    ]);
    clearDeviceGateCache(deviceUuid);
    const stub = env.ORCHESTRATOR_USER_DO.get(env.ORCHESTRATOR_USER_DO.idFromName(auth.value.user_uuid));
    await stub.fetch(
      new Request("https://orchestrator.internal/internal/devices/revoke", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trace-uuid": traceUuid,
          "x-nano-internal-authority": JSON.stringify(auth.value.snapshot),
        },
        body: JSON.stringify({ device_uuid: deviceUuid, reason }),
      }),
    );

    return Response.json(
      {
        ok: true,
        data: {
          device_uuid: deviceUuid,
          status: "revoked",
          revoked_at: now,
          revocation_uuid: revocationUuid,
        },
        trace_uuid: traceUuid,
      },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  } catch (error) {
    getLogger(env).warn("me-devices-revoke-d1-failed", {
      code: "internal-error",
      ctx: {
        tag: "me-devices-revoke-d1-failed",
        device_uuid: deviceUuid,
        user_uuid: auth.value.user_uuid,
        error: String(error),
      },
    });
    return jsonPolicyError(500, "internal-error", "failed to revoke device", traceUuid);
  }
}

// ───────────────────────────────────────────────────────────────────
// RH2 P2-04 — GET /models
//
// D1 真相源 + per-team policy filter + ETag (sha256 of JSON body)。
// 404 / 304 (If-None-Match) / 401 / 403 / 200 是合法 status set。
// ───────────────────────────────────────────────────────────────────

interface ModelRow {
  readonly model_id: string;
  readonly family: string;
  readonly display_name: string;
  readonly context_window: number;
  readonly is_reasoning: number;
  readonly is_vision: number;
  readonly is_function_calling: number;
  readonly status: string;
}

async function computeEtag(payload: string): Promise<string> {
  const buf = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // ETag must be quoted per RFC 7232.
  return `"${hex.slice(0, 32)}"`;
}

async function handleModelsList(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return jsonPolicyError(503, "worker-misconfigured", "models D1 unavailable", traceUuid);
  }
  const teamUuid = auth.value.snapshot.team_uuid;
  if (typeof teamUuid !== "string" || teamUuid.length === 0) {
    return jsonPolicyError(403, "missing-team-claim", "team_uuid missing from auth snapshot", traceUuid);
  }
  try {
    const modelsRes = await db.prepare(
      `SELECT model_id, family, display_name, context_window,
              is_reasoning, is_vision, is_function_calling, status
         FROM nano_models
        WHERE status = 'active'
        ORDER BY model_id ASC`,
    ).all<ModelRow>();
    const allRows = modelsRes.results ?? [];
    const policyRes = await db.prepare(
      `SELECT model_id, allowed
         FROM nano_team_model_policy
        WHERE team_uuid = ?1`,
    ).bind(teamUuid).all<{ model_id: string; allowed: number }>();
    const denied = new Set<string>(
      (policyRes.results ?? [])
        .filter((p) => Number(p.allowed) === 0)
        .map((p) => String(p.model_id)),
    );
    const models = allRows
      .filter((m) => !denied.has(m.model_id))
      .map((m) => ({
        model_id: m.model_id,
        family: m.family,
        display_name: m.display_name,
        context_window: m.context_window,
        capabilities: {
          reasoning: Number(m.is_reasoning) === 1,
          vision: Number(m.is_vision) === 1,
          function_calling: Number(m.is_function_calling) === 1,
        },
        status: m.status,
      }));
    const data = { models };
    const payload = JSON.stringify(data);
    const etag = await computeEtag(payload + ":" + teamUuid);
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          "x-trace-uuid": traceUuid,
          etag,
        },
      });
    }
    return Response.json(
      { ok: true, data, trace_uuid: traceUuid },
      {
        status: 200,
        headers: {
          "x-trace-uuid": traceUuid,
          etag,
          "cache-control": "private, max-age=60",
        },
      },
    );
  } catch (error) {
    getLogger(env).warn("models-d1-read-failed", {
      code: "internal-error",
      ctx: { tag: "models-d1-read-failed", team_uuid: teamUuid, error: String(error) },
    });
    return jsonPolicyError(503, "models-d1-unavailable", "models lookup failed", traceUuid);
  }
}

// ───────────────────────────────────────────────────────────────────
// RH2 P2-05 / P2-06 / P2-07 — context inspection endpoints
//
// Routes:
//   GET  /sessions/{uuid}/context           → context-core.getContextSnapshot
//   POST /sessions/{uuid}/context/snapshot  → context-core.triggerContextSnapshot
//   POST /sessions/{uuid}/context/compact   → context-core.triggerCompact
//
// Topology:
//   client ─[façade auth + UUID gate]→ orchestrator-core
//     ─[CONTEXT_CORE service binding RPC]→ context-core
// ───────────────────────────────────────────────────────────────────

async function handleSessionContext(
  request: Request,
  env: OrchestratorCoreEnv,
  op:
    | "get"
    | "probe"
    | "layers"
    | "snapshot"
    | "compact-preview"
    | "compact"
    | "compact-job",
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const sessionUuid = segments[1];
  if (!sessionUuid || !UUID_RE.test(sessionUuid)) {
    return jsonPolicyError(400, "invalid-input", "session_uuid must be a UUID", traceUuid);
  }
  const teamUuid = auth.value.snapshot.team_uuid;
  if (typeof teamUuid !== "string" || teamUuid.length === 0) {
    return jsonPolicyError(403, "missing-team-claim", "team_uuid missing from auth snapshot", traceUuid);
  }
  const ctx = (env as { CONTEXT_CORE?: ContextCoreRpcLike }).CONTEXT_CORE;
  if (!ctx) {
    return jsonPolicyError(
      503,
      "worker-misconfigured",
      "CONTEXT_CORE binding missing",
      traceUuid,
    );
  }
  try {
    const meta = { trace_uuid: traceUuid, team_uuid: teamUuid };
    let body: Record<string, unknown>;
    switch (op) {
      case "get":
        if (typeof ctx.getContextSnapshot !== "function") {
          return jsonPolicyError(
            503,
            "worker-misconfigured",
            "context-core RPC getContextSnapshot missing",
            traceUuid,
          );
        }
        body = await ctx.getContextSnapshot(sessionUuid, teamUuid, meta);
        break;
      case "probe":
        if (typeof ctx.getContextProbe !== "function") {
          return jsonPolicyError(
            503,
            "worker-misconfigured",
            "context-core RPC getContextProbe missing",
            traceUuid,
          );
        }
        body = await ctx.getContextProbe(sessionUuid, teamUuid, meta);
        break;
      case "layers":
        if (typeof ctx.getContextLayers !== "function") {
          return jsonPolicyError(
            503,
            "worker-misconfigured",
            "context-core RPC getContextLayers missing",
            traceUuid,
          );
        }
        body = await ctx.getContextLayers(sessionUuid, teamUuid, meta);
        break;
      case "snapshot":
        if (typeof ctx.triggerContextSnapshot !== "function") {
          return jsonPolicyError(
            503,
            "worker-misconfigured",
            "context-core RPC triggerContextSnapshot missing",
            traceUuid,
          );
        }
        body = await ctx.triggerContextSnapshot(sessionUuid, teamUuid, meta);
        break;
      case "compact-preview":
        if (typeof ctx.previewCompact !== "function") {
          return jsonPolicyError(
            503,
            "worker-misconfigured",
            "context-core RPC previewCompact missing",
            traceUuid,
          );
        }
        body = await ctx.previewCompact(sessionUuid, teamUuid, meta);
        break;
      case "compact":
        if (typeof ctx.triggerCompact !== "function") {
          return jsonPolicyError(
            503,
            "worker-misconfigured",
            "context-core RPC triggerCompact missing",
            traceUuid,
          );
        }
        body = await ctx.triggerCompact(sessionUuid, teamUuid, meta);
        break;
      case "compact-job": {
        const jobId = segments[5];
        if (!jobId || !UUID_RE.test(jobId)) {
          return jsonPolicyError(400, "invalid-input", "job_id must be a UUID", traceUuid);
        }
        if (typeof ctx.getCompactJob !== "function") {
          return jsonPolicyError(
            503,
            "worker-misconfigured",
            "context-core RPC getCompactJob missing",
            traceUuid,
          );
        }
        body = await ctx.getCompactJob(sessionUuid, teamUuid, jobId, meta);
        break;
      }
    }
    return Response.json(
      { ok: true, data: body, trace_uuid: traceUuid },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  } catch (error) {
    getLogger(env).warn("context-rpc-failed", {
      code: "internal-error",
      ctx: {
        tag: "context-rpc-failed",
        op,
        session_uuid: sessionUuid,
        team_uuid: teamUuid,
        error: String(error),
      },
    });
    return jsonPolicyError(503, "context-rpc-unavailable", `context ${op} failed`, traceUuid);
  }
}

interface ContextCoreRpcLike {
  getContextSnapshot?(
    sessionUuid: string,
    teamUuid: string,
    meta: { trace_uuid: string; team_uuid: string },
  ): Promise<Record<string, unknown>>;
  getContextProbe?(
    sessionUuid: string,
    teamUuid: string,
    meta: { trace_uuid: string; team_uuid: string },
  ): Promise<Record<string, unknown>>;
  getContextLayers?(
    sessionUuid: string,
    teamUuid: string,
    meta: { trace_uuid: string; team_uuid: string },
  ): Promise<Record<string, unknown>>;
  triggerContextSnapshot?(
    sessionUuid: string,
    teamUuid: string,
    meta: { trace_uuid: string; team_uuid: string },
  ): Promise<Record<string, unknown>>;
  previewCompact?(
    sessionUuid: string,
    teamUuid: string,
    meta: { trace_uuid: string; team_uuid: string },
  ): Promise<Record<string, unknown>>;
  triggerCompact?(
    sessionUuid: string,
    teamUuid: string,
    meta: { trace_uuid: string; team_uuid: string },
  ): Promise<Record<string, unknown>>;
  getCompactJob?(
    sessionUuid: string,
    teamUuid: string,
    jobId: string,
    meta: { trace_uuid: string; team_uuid: string },
  ): Promise<Record<string, unknown>>;
}

interface SessionFileRecord {
  readonly file_uuid: string;
  readonly session_uuid: string;
  readonly team_uuid: string;
  readonly r2_key: string;
  readonly mime: string | null;
  readonly size_bytes: number;
  readonly original_name: string | null;
  readonly created_at: string;
}

interface FilesystemCoreRpcLike {
  writeArtifact?(
    input: {
      team_uuid: string;
      session_uuid: string;
      mime?: string | null;
      original_name?: string | null;
      bytes: ArrayBuffer;
    },
    meta: { trace_uuid: string; team_uuid: string },
  ): Promise<{ file: SessionFileRecord }>;
  listArtifacts?(
    input: {
      team_uuid: string;
      session_uuid: string;
      cursor?: string | null;
      limit?: number;
    },
    meta: { trace_uuid: string; team_uuid: string },
  ): Promise<{ files: SessionFileRecord[]; next_cursor: string | null }>;
  readArtifact?(
    input: {
      team_uuid: string;
      session_uuid: string;
      file_uuid: string;
    },
    meta: { trace_uuid: string; team_uuid: string },
  ): Promise<{ file: SessionFileRecord; bytes: ArrayBuffer } | null>;
}

async function handleSessionFiles(
  request: Request,
  env: OrchestratorCoreEnv,
  route: SessionFilesRoute,
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const teamUuid = auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid;
  if (typeof teamUuid !== "string" || teamUuid.length === 0) {
    return jsonPolicyError(403, "missing-team-claim", "team_uuid missing from auth snapshot", traceUuid);
  }
  const fs = (env as { FILESYSTEM_CORE?: FilesystemCoreRpcLike }).FILESYSTEM_CORE;
  if (!fs) {
    return jsonPolicyError(503, "worker-misconfigured", "FILESYSTEM_CORE binding missing", traceUuid);
  }
  const access = await requireOwnedSession(env, route.sessionUuid, teamUuid, auth.value.user_uuid, traceUuid);
  if (access) return access;

  try {
    const meta = { trace_uuid: traceUuid, team_uuid: teamUuid };
    if (route.kind === "list") {
      if (typeof fs.listArtifacts !== "function") {
        return jsonPolicyError(503, "worker-misconfigured", "filesystem-core RPC listArtifacts missing", traceUuid);
      }
      const url = new URL(request.url);
      const data = await fs.listArtifacts(
        {
          team_uuid: teamUuid,
          session_uuid: route.sessionUuid,
          limit: parseListLimit(url.searchParams.get("limit"), 50, 200),
          cursor: url.searchParams.get("cursor"),
        },
        meta,
      );
      return Response.json(
        { ok: true, data, trace_uuid: traceUuid },
        { status: 200, headers: { "x-trace-uuid": traceUuid } },
      );
    }

    if (route.kind === "upload") {
      if (typeof fs.writeArtifact !== "function") {
        return jsonPolicyError(503, "worker-misconfigured", "filesystem-core RPC writeArtifact missing", traceUuid);
      }
      const upload = await parseSessionFileUpload(request, traceUuid);
      if ("response" in upload) return upload.response;
      const result = await fs.writeArtifact(
        {
          team_uuid: teamUuid,
          session_uuid: route.sessionUuid,
          mime: upload.mime,
          original_name: upload.original_name,
          bytes: upload.bytes,
        },
        meta,
      );
      return Response.json(
        {
          ok: true,
          data: {
            file_uuid: result.file.file_uuid,
            session_uuid: result.file.session_uuid,
            mime: result.file.mime,
            size_bytes: result.file.size_bytes,
            original_name: result.file.original_name,
            created_at: result.file.created_at,
          },
          trace_uuid: traceUuid,
        },
        { status: 201, headers: { "x-trace-uuid": traceUuid } },
      );
    }

    if (typeof fs.readArtifact !== "function") {
      return jsonPolicyError(503, "worker-misconfigured", "filesystem-core RPC readArtifact missing", traceUuid);
    }
    const result = await fs.readArtifact(
      {
        team_uuid: teamUuid,
        session_uuid: route.sessionUuid,
        file_uuid: route.fileUuid,
      },
      meta,
    );
    if (!result) {
      return jsonPolicyError(404, "not-found", "file not found", traceUuid);
    }
    return new Response(result.bytes, {
      status: 200,
      headers: {
        "content-type": result.file.mime ?? "application/octet-stream",
        "content-length": String(result.file.size_bytes),
        "cache-control": "no-store",
        "x-trace-uuid": traceUuid,
        ...(result.file.original_name
          ? { "content-disposition": `inline; filename="${sanitizeContentDispositionFilename(result.file.original_name)}"` }
          : {}),
      },
    });
  } catch (error) {
    const op = route.kind === "content" ? "read" : route.kind;
    getLogger(env).warn("filesystem-rpc-failed", {
      code: "internal-error",
      ctx: {
        tag: "filesystem-rpc-failed",
        op,
        session_uuid: route.sessionUuid,
        team_uuid: teamUuid,
        error: String(error),
      },
    });
    return jsonPolicyError(503, "filesystem-rpc-unavailable", `files ${op} failed`, traceUuid);
  }
}

async function requireOwnedSession(
  env: OrchestratorCoreEnv,
  sessionUuid: string,
  teamUuid: string,
  userUuid: string,
  traceUuid: string,
): Promise<Response | null> {
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return jsonPolicyError(503, "worker-misconfigured", "session store unavailable", traceUuid);
  }
  const row = await db.prepare(
    `SELECT team_uuid, actor_user_uuid
       FROM nano_conversation_sessions
      WHERE session_uuid = ?1
      LIMIT 1`,
  ).bind(sessionUuid).first<Record<string, unknown>>();
  if (!row) {
    return jsonPolicyError(404, "not-found", "session not found", traceUuid);
  }
  if (String(row.team_uuid) !== teamUuid) {
    try {
      await buildAuditPersist(env)({
        ts: new Date().toISOString(),
        worker: "orchestrator-core",
        trace_uuid: traceUuid,
        session_uuid: sessionUuid,
        team_uuid: teamUuid,
        user_uuid: userUuid,
        event_kind: "tenant.cross_tenant_deny",
        outcome: "denied",
        detail: {
          owner_team_uuid: String(row.team_uuid),
        },
      });
    } catch (error) {
      getLogger(env).warn("cross-tenant-audit-failed", {
        code: "internal-error",
        ctx: {
          tag: "cross-tenant-audit-failed",
          trace_uuid: traceUuid,
          session_uuid: sessionUuid,
          team_uuid: teamUuid,
          owner_team_uuid: String(row.team_uuid),
          error: String(error),
        },
      });
    }
    return jsonPolicyError(403, "permission-denied", "session does not belong to caller", traceUuid);
  }
  if (String(row.actor_user_uuid) !== userUuid) {
    return jsonPolicyError(403, "permission-denied", "session does not belong to caller", traceUuid);
  }
  return null;
}

async function parseSessionFileUpload(
  request: Request,
  traceUuid: string,
): Promise<
  | { bytes: ArrayBuffer; mime: string | null; original_name: string | null }
  | { response: Response }
> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return {
      response: jsonPolicyError(400, "invalid-input", "files upload requires multipart/form-data", traceUuid),
    };
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return {
      response: jsonPolicyError(400, "invalid-input", "multipart body could not be parsed", traceUuid),
    };
  }
  const entry = form.get("file");
  if (!isUploadBlob(entry)) {
    return {
      response: jsonPolicyError(400, "invalid-input", "multipart field 'file' is required", traceUuid),
    };
  }
  if (entry.size > MAX_SESSION_FILE_BYTES) {
    return {
      response: jsonPolicyError(413, "payload-too-large", "file exceeds 25 MiB limit", traceUuid),
    };
  }
  const explicitMime = form.get("mime");
  const mimeCandidate =
    typeof explicitMime === "string" && explicitMime.trim().length > 0
      ? explicitMime.trim()
      : typeof entry.type === "string" && entry.type.trim().length > 0
        ? entry.type.trim()
        : null;
  const mime = normalizeMime(mimeCandidate);
  if (mimeCandidate !== null && mime === null) {
    return {
      response: jsonPolicyError(400, "invalid-input", "mime must be a valid type/subtype", traceUuid),
    };
  }
  const bytes = await entry.arrayBuffer();
  if (bytes.byteLength > MAX_SESSION_FILE_BYTES) {
    return {
      response: jsonPolicyError(413, "payload-too-large", "file exceeds 25 MiB limit", traceUuid),
    };
  }
  const originalName =
    typeof entry.name === "string" && entry.name.trim().length > 0
      ? entry.name.trim().slice(0, 255)
      : null;
  return {
    bytes,
    mime,
    original_name: originalName,
  };
}

function isUploadBlob(value: unknown): value is File {
  return typeof value === "object"
    && value !== null
    && typeof (value as Blob).arrayBuffer === "function"
    && typeof (value as Blob).size === "number";
}

function normalizeMime(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 255) return null;
  return MIME_RE.test(trimmed) ? trimmed : null;
}

function sanitizeContentDispositionFilename(value: string): string {
  return value.replace(/["\\\r\n]/g, "_");
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
  // ZX1-ZX2 review (DeepSeek R6 / Kimi R9): hardened idempotency detection.
  // The earlier check (`"ok" in body`) was too lax — a business JSON like
  // `{ok: true, tool_call_id: "x"}` would slip through unwrapped. We now
  // require either:
  //   - facade envelope success: ok===true with `data` field, OR
  //   - legacy DO action ack:    ok===true with `action: string` field
  //     (kept on purpose so {ok:true,action,phase,...} stays compat-passthrough), OR
  //   - facade envelope error:   ok===false with `error: object`
  // Anything else (including `{ok:true,tool_call_id:...}`) is wrapped as a
  // fresh envelope below.
  const obj =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const looksFacadeSuccess = obj?.ok === true && "data" in obj;
  const looksFacadeError = obj?.ok === false && obj.error !== undefined && typeof obj.error === "object";
  const looksLegacyDoAck = obj?.ok === true && typeof obj.action === "string";
  if (obj && (looksFacadeSuccess || looksFacadeError || looksLegacyDoAck)) {
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
  const errObj = (body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}) as { error?: string; message?: string; code?: string };
  const code = (errObj.code ?? errObj.error ?? "internal-error") as FacadeErrorCode;
  const message = errObj.message ?? errObj.error ?? "session route returned an error";
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
export { worker };
export default worker;
