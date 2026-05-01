import { authenticateRequest } from "../../auth.js";
import { getLogger, type OrchestratorCoreEnv } from "../env.js";
import { jsonPolicyError } from "../../policy/authority.js";
import { ensureSessionOwnedOrError } from "../../hp-absorbed-routes.js";
import { UUID_RE } from "../shared/request.js";

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

async function handleSessionContext(
  request: Request,
  env: OrchestratorCoreEnv,
  op: "get" | "probe" | "layers" | "snapshot" | "compact-preview" | "compact" | "compact-job",
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
  const ownershipFail = await ensureSessionOwnedOrError(env, {
    sessionUuid,
    teamUuid,
    userUuid: auth.value.user_uuid,
    traceUuid,
    jsonPolicyError,
  });
  if (ownershipFail) return ownershipFail;
  const ctx = (env as { CONTEXT_CORE?: ContextCoreRpcLike }).CONTEXT_CORE;
  if (!ctx) {
    return jsonPolicyError(503, "worker-misconfigured", "CONTEXT_CORE binding missing", traceUuid);
  }
  try {
    const meta = { trace_uuid: traceUuid, team_uuid: teamUuid };
    let body: Record<string, unknown>;
    switch (op) {
      case "get":
        if (typeof ctx.getContextSnapshot !== "function") {
          return jsonPolicyError(503, "worker-misconfigured", "context-core RPC getContextSnapshot missing", traceUuid);
        }
        body = await ctx.getContextSnapshot(sessionUuid, teamUuid, meta);
        break;
      case "probe":
        if (typeof ctx.getContextProbe !== "function") {
          return jsonPolicyError(503, "worker-misconfigured", "context-core RPC getContextProbe missing", traceUuid);
        }
        body = await ctx.getContextProbe(sessionUuid, teamUuid, meta);
        break;
      case "layers":
        if (typeof ctx.getContextLayers !== "function") {
          return jsonPolicyError(503, "worker-misconfigured", "context-core RPC getContextLayers missing", traceUuid);
        }
        body = await ctx.getContextLayers(sessionUuid, teamUuid, meta);
        break;
      case "snapshot":
        if (typeof ctx.triggerContextSnapshot !== "function") {
          return jsonPolicyError(503, "worker-misconfigured", "context-core RPC triggerContextSnapshot missing", traceUuid);
        }
        body = await ctx.triggerContextSnapshot(sessionUuid, teamUuid, meta);
        break;
      case "compact-preview":
        if (typeof ctx.previewCompact !== "function") {
          return jsonPolicyError(503, "worker-misconfigured", "context-core RPC previewCompact missing", traceUuid);
        }
        body = await ctx.previewCompact(sessionUuid, teamUuid, meta);
        break;
      case "compact":
        if (typeof ctx.triggerCompact !== "function") {
          return jsonPolicyError(503, "worker-misconfigured", "context-core RPC triggerCompact missing", traceUuid);
        }
        body = await ctx.triggerCompact(sessionUuid, teamUuid, meta);
        break;
      case "compact-job": {
        const jobId = segments[5];
        if (!jobId || !UUID_RE.test(jobId)) {
          return jsonPolicyError(400, "invalid-input", "job_id must be a UUID", traceUuid);
        }
        if (typeof ctx.getCompactJob !== "function") {
          return jsonPolicyError(503, "worker-misconfigured", "context-core RPC getCompactJob missing", traceUuid);
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

export async function tryHandleSessionContextRoute(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  if (method === "GET" && /^\/sessions\/[^/]+\/context$/.test(pathname)) return handleSessionContext(request, env, "get");
  if (method === "GET" && /^\/sessions\/[^/]+\/context\/probe$/.test(pathname)) return handleSessionContext(request, env, "probe");
  if (method === "GET" && /^\/sessions\/[^/]+\/context\/layers$/.test(pathname)) return handleSessionContext(request, env, "layers");
  if (method === "POST" && /^\/sessions\/[^/]+\/context\/snapshot$/.test(pathname)) return handleSessionContext(request, env, "snapshot");
  if (method === "POST" && /^\/sessions\/[^/]+\/context\/compact\/preview$/.test(pathname)) return handleSessionContext(request, env, "compact-preview");
  if (method === "POST" && /^\/sessions\/[^/]+\/context\/compact$/.test(pathname)) return handleSessionContext(request, env, "compact");
  if (method === "GET" && /^\/sessions\/[^/]+\/context\/compact\/jobs\/[^/]+$/.test(pathname)) {
    return handleSessionContext(request, env, "compact-job");
  }
  return null;
}
