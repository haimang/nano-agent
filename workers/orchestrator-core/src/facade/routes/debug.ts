import { NANO_PACKAGE_MANIFEST } from "../../generated/package-manifest.js";
import { buildDebugPackagesResponse } from "../../debug/packages.js";
import { jsonPolicyError } from "../../policy/authority.js";
import {
  createShellResponse,
  getLogger,
  type OrchestratorCoreEnv,
  type WorkerHealthEntry,
  type WorkerHealthProbeBody,
} from "../env.js";
import { authenticateDebugRequest, isTeamOwner, readAuthTeam } from "../shared/auth.js";
import { clampLimit } from "../shared/request.js";

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

export async function tryHandleHealthDebugRoute(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response | null> {
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
  return null;
}
