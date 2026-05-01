import { authenticateRequest } from "../../auth.js";
import { normalizeReasoningOptions, parseSessionModelPatchBody } from "../../session-lifecycle.js";
import { D1SessionTruthRepository, type DurableResolvedModel } from "../../session-truth.js";
import { jsonPolicyError } from "../../policy/authority.js";
import type { OrchestratorCoreEnv } from "../env.js";
import { getLogger } from "../env.js";
import { UUID_RE, parseBody } from "../shared/request.js";

type ModelDetailRoute = { modelRef: string };
type SessionModelRoute = { sessionUuid: string; action: "get" | "patch" };

function parseModelDetailRoute(request: Request): ModelDetailRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const match = pathname.match(/^\/models\/(.+)$/);
  if (!match || method !== "GET") return null;
  const raw = match[1]!;
  const modelRef = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  return modelRef.length > 0 ? { modelRef } : null;
}

function parseSessionModelRoute(request: Request): SessionModelRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const match = pathname.match(/^\/sessions\/([^/]+)\/model$/);
  if (!match) return null;
  const sessionUuid = match[1]!;
  if (!UUID_RE.test(sessionUuid)) return null;
  if (method === "GET") return { sessionUuid, action: "get" };
  if (method === "PATCH") return { sessionUuid, action: "patch" };
  return null;
}

async function computeEtag(payload: string): Promise<string> {
  const buf = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `"${hex.slice(0, 32)}"`;
}

async function resolveTeamModelOrResponse(input: {
  readonly db: D1Database;
  readonly repo: D1SessionTruthRepository;
  readonly teamUuid: string;
  readonly modelRef: string;
  readonly traceUuid: string;
}): Promise<Response | DurableResolvedModel> {
  const resolved = await input.repo.resolveModelForTeam({
    team_uuid: input.teamUuid,
    model_ref: input.modelRef,
  });
  if (resolved) return resolved;
  const aliasRow = await input.db.prepare(
    `SELECT target_model_id
       FROM nano_model_aliases
      WHERE alias_id = ?1
      LIMIT 1`,
  ).bind(input.modelRef).first<{ target_model_id: string }>();
  const canonicalModelId = aliasRow?.target_model_id ?? input.modelRef;
  const policy = await input.db.prepare(
    `SELECT allowed
       FROM nano_team_model_policy
      WHERE team_uuid = ?1
        AND model_id = ?2
      LIMIT 1`,
  ).bind(input.teamUuid, canonicalModelId).first<{ allowed: number }>();
  if (policy && Number(policy.allowed) === 0) {
    return jsonPolicyError(403, "model-disabled", "requested model is disabled for this team", input.traceUuid);
  }
  return jsonPolicyError(400, "model-unavailable", "requested model is not active", input.traceUuid);
}

async function handleModelsList(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
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
    const repo = new D1SessionTruthRepository(db);
    const models = await repo.listActiveModelsForTeam(teamUuid);
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

async function handleModelDetail(
  request: Request,
  env: OrchestratorCoreEnv,
  route: ModelDetailRoute,
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
  const repo = new D1SessionTruthRepository(db);
  const resolved = await resolveTeamModelOrResponse({
    db,
    repo,
    teamUuid,
    modelRef: route.modelRef,
    traceUuid,
  });
  if (resolved instanceof Response) return resolved;
  return Response.json(
    {
      ok: true,
      data: {
        requested_model_id: route.modelRef,
        resolved_model_id: resolved.model.model_id,
        resolved_from_alias: resolved.resolved_from_alias,
        model: resolved.model,
      },
      trace_uuid: traceUuid,
    },
    { status: 200, headers: { "x-trace-uuid": traceUuid } },
  );
}

async function handleSessionModel(
  request: Request,
  env: OrchestratorCoreEnv,
  route: SessionModelRoute,
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return jsonPolicyError(503, "worker-misconfigured", "NANO_AGENT_DB binding must be configured", traceUuid);
  }
  const teamUuid = auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid;
  if (typeof teamUuid !== "string" || teamUuid.length === 0) {
    return jsonPolicyError(403, "missing-team-claim", "team_uuid missing from auth snapshot", traceUuid);
  }
  const repo = new D1SessionTruthRepository(db);
  const state = await repo.readSessionModelState({
    session_uuid: route.sessionUuid,
    team_uuid: teamUuid,
    actor_user_uuid: auth.value.user_uuid,
  });
  if (!state) {
    return jsonPolicyError(404, "not-found", "session not found", traceUuid);
  }
  if (state.deleted_at) {
    return jsonPolicyError(409, "conversation-deleted", "conversation is deleted", traceUuid);
  }
  if (route.action === "get") {
    return Response.json(
      { ok: true, data: state, trace_uuid: traceUuid },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  }
  if (state.session_status === "expired") {
    return jsonPolicyError(409, "session-expired", "session expired and cannot update model", traceUuid);
  }
  if (state.session_status === "ended") {
    return jsonPolicyError(409, "session_terminal", "session ended and cannot update model", traceUuid);
  }

  const body = await parseBody(request);
  const parsed = parseSessionModelPatchBody(body);
  if (!parsed.ok) return parsed.response;

  if (!parsed.model_id_present && !state.default_model_id) {
    return jsonPolicyError(
      400,
      "invalid-input",
      "cannot update reasoning without a session default model",
      traceUuid,
    );
  }

  if (parsed.model_id_present && parsed.model_id === null) {
    await repo.updateSessionModelDefaults({
      session_uuid: route.sessionUuid,
      default_model_id: null,
      default_reasoning_effort: null,
    });
  } else {
    const modelRef = parsed.model_id_present ? parsed.model_id : state.default_model_id;
    if (!modelRef) {
      return jsonPolicyError(400, "invalid-input", "model_id is required", traceUuid);
    }
    const resolved = await resolveTeamModelOrResponse({
      db,
      repo,
      teamUuid,
      modelRef,
      traceUuid,
    });
    if (resolved instanceof Response) return resolved;
    const baselineReasoning =
      parsed.reasoning_present
        ? parsed.reasoning
        : state.default_reasoning_effort
          ? { effort: state.default_reasoning_effort }
          : null;
    const normalizedReasoning = normalizeReasoningOptions(
      baselineReasoning,
      resolved.model.supported_reasoning_levels,
    );
    await repo.updateSessionModelDefaults({
      session_uuid: route.sessionUuid,
      default_model_id: resolved.model.model_id,
      default_reasoning_effort: normalizedReasoning?.effort ?? null,
    });
  }

  const nextState = await repo.readSessionModelState({
    session_uuid: route.sessionUuid,
    team_uuid: teamUuid,
    actor_user_uuid: auth.value.user_uuid,
  });
  return Response.json(
    { ok: true, data: nextState, trace_uuid: traceUuid },
    { status: 200, headers: { "x-trace-uuid": traceUuid } },
  );
}

export async function tryHandlePublicModelRoute(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();

  const modelDetailRoute = parseModelDetailRoute(request);
  if (modelDetailRoute) return handleModelDetail(request, env, modelDetailRoute);
  if (method === "GET" && pathname === "/models") return handleModelsList(request, env);
  return null;
}

export async function tryHandleSessionModelRoute(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response | null> {
  const sessionModelRoute = parseSessionModelRoute(request);
  return sessionModelRoute ? handleSessionModel(request, env, sessionModelRoute) : null;
}
