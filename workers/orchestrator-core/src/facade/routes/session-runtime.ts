import type {
  SessionApprovalPolicy,
  SessionRuntimePermissionRule,
} from "@haimang/nacp-session";
import { authenticateRequest } from "../../auth.js";
import { D1SessionTruthRepository } from "../../session-truth.js";
import { D1RuntimeConfigPlane } from "../../runtime-config-plane.js";
import { emitFrameViaUserDO } from "../../wsemit.js";
import { jsonPolicyError } from "../../policy/authority.js";
import type { OrchestratorCoreEnv } from "../env.js";
import { parseBody, UUID_RE } from "../shared/request.js";

type RuntimePatch = {
  permission_rules?: SessionRuntimePermissionRule[];
  network_policy?: { mode: string };
  web_search?: { mode: string };
  workspace_scope?: { mounts: string[] };
  approval_policy?: SessionApprovalPolicy;
};

function parseRuntimePatch(body: Record<string, unknown>): { ok: true; value: RuntimePatch } | { ok: false; message: string } {
  const value: RuntimePatch = {};
  if (body.permission_rules !== undefined) {
    if (!Array.isArray(body.permission_rules) || body.permission_rules.length > 100) {
      return { ok: false, message: "permission_rules must be an array with <=100 entries" };
    }
    const rules: SessionRuntimePermissionRule[] = [];
    for (const rule of body.permission_rules) {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
        return { ok: false, message: "permission_rules entries must be objects" };
      }
      const r = rule as Record<string, unknown>;
      if (typeof r.tool_name !== "string" || r.tool_name.length === 0 || r.tool_name.length > 128) {
        return { ok: false, message: "permission rule tool_name is required" };
      }
      if (r.behavior !== "allow" && r.behavior !== "deny" && r.behavior !== "ask") {
        return { ok: false, message: "permission rule behavior must be allow|deny|ask" };
      }
      if (r.scope !== undefined && r.scope !== "session" && r.scope !== "tenant") {
        return { ok: false, message: "permission rule scope must be session|tenant" };
      }
      rules.push({
        ...(typeof r.rule_uuid === "string" ? { rule_uuid: r.rule_uuid } : {}),
        tool_name: r.tool_name,
        ...(typeof r.pattern === "string" ? { pattern: r.pattern } : {}),
        behavior: r.behavior,
        scope: r.scope === "tenant" ? "tenant" : "session",
      });
    }
    value.permission_rules = rules;
  }
  for (const key of ["network_policy", "web_search"] as const) {
    const candidate = body[key];
    if (candidate === undefined) continue;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, message: `${key}.mode is required` };
    }
    const mode = (candidate as { mode?: unknown }).mode;
    if (typeof mode !== "string" || mode.length === 0 || mode.length > 64) {
      return { ok: false, message: `${key}.mode is required` };
    }
    value[key] = { mode };
  }
  if (body.workspace_scope !== undefined) {
    const scope = body.workspace_scope;
    if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
      return { ok: false, message: "workspace_scope.mounts is required" };
    }
    const mounts = (scope as { mounts?: unknown }).mounts;
    if (!Array.isArray(mounts) || mounts.some((m) => typeof m !== "string")) {
      return { ok: false, message: "workspace_scope.mounts must be string[]" };
    }
    value.workspace_scope = { mounts: mounts as string[] };
  }
  if (body.approval_policy !== undefined) {
    if (
      body.approval_policy !== "ask" &&
      body.approval_policy !== "auto-allow" &&
      body.approval_policy !== "deny" &&
      body.approval_policy !== "always_allow"
    ) {
      return { ok: false, message: "approval_policy must be ask|auto-allow|deny|always_allow" };
    }
    value.approval_policy = body.approval_policy;
  }
  return { ok: true, value };
}

function parseRuntimeRoute(request: Request): { sessionUuid: string } | null {
  const pathname = new URL(request.url).pathname;
  const match = pathname.match(/^\/sessions\/([^/]+)\/runtime$/);
  if (!match) return null;
  const sessionUuid = match[1]!;
  return UUID_RE.test(sessionUuid) ? { sessionUuid } : null;
}

export async function tryHandleSessionRuntimeRoute(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response | null> {
  const route = parseRuntimeRoute(request);
  if (!route) return null;
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "PATCH") return null;

  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const teamUuid = auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid;
  if (!teamUuid) {
    return jsonPolicyError(403, "missing-team-claim", "JWT must include team_uuid", traceUuid);
  }
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return jsonPolicyError(503, "worker-misconfigured", "NANO_AGENT_DB binding must be configured", traceUuid);
  }
  const repo = new D1SessionTruthRepository(db);
  const session = await repo.readSessionLifecycle(route.sessionUuid);
  if (!session || session.team_uuid !== teamUuid || session.actor_user_uuid !== auth.value.user_uuid) {
    return jsonPolicyError(404, "not-found", "session not found", traceUuid);
  }
  if (session.deleted_at) {
    return jsonPolicyError(409, "conversation-deleted", "conversation is deleted", traceUuid);
  }

  const plane = new D1RuntimeConfigPlane(db);
  if (method === "GET") {
    const config = await plane.readOrCreate({ session_uuid: route.sessionUuid, team_uuid: teamUuid });
    return Response.json({ ok: true, data: config, trace_uuid: traceUuid }, {
      status: 200,
      headers: { "x-trace-uuid": traceUuid },
    });
  }

  const body = await parseBody(request);
  if (!body) return jsonPolicyError(400, "invalid-input", "runtime PATCH requires a JSON body", traceUuid);
  const parsed = parseRuntimePatch(body);
  if (!parsed.ok) {
    return jsonPolicyError(400, "invalid-input", parsed.message, traceUuid);
  }
  const config = await plane.patch({
    session_uuid: route.sessionUuid,
    team_uuid: teamUuid,
    permission_rules: parsed.value.permission_rules,
    network_policy_mode: parsed.value.network_policy?.mode,
    web_search_mode: parsed.value.web_search?.mode,
    workspace_scope: parsed.value.workspace_scope,
    approval_policy: parsed.value.approval_policy,
  });
  emitFrameViaUserDO(
    env,
    { sessionUuid: route.sessionUuid, userUuid: session.actor_user_uuid, traceUuid },
    "session.runtime.update",
    {
      session_uuid: config.session_uuid,
      version: config.version,
      permission_rules: config.permission_rules,
      network_policy: config.network_policy,
      web_search: config.web_search,
      workspace_scope: config.workspace_scope,
      approval_policy: config.approval_policy,
      updated_at: config.updated_at,
    },
  );
  return Response.json({ ok: true, data: config, trace_uuid: traceUuid }, {
    status: 200,
    headers: { "x-trace-uuid": traceUuid },
  });
}
