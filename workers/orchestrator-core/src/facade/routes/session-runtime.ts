import type {
  SessionApprovalPolicy,
  SessionRuntimePermissionRule,
} from "@haimang/nacp-session";
import { authenticateRequest } from "../../auth.js";
import { D1PermissionRulesPlane } from "../../permission-rules-plane.js";
import { D1SessionTruthRepository } from "../../session-truth.js";
import {
  D1RuntimeConfigPlane,
  RuntimeConfigVersionConflictError,
  type RuntimeConfigRow,
} from "../../runtime-config-plane.js";
import { emitFrameViaUserDO } from "../../wsemit.js";
import { jsonPolicyError } from "../../policy/authority.js";
import type { OrchestratorCoreEnv } from "../env.js";
import { parseBody, UUID_RE } from "../shared/request.js";

type RuntimePatch = {
  version: number;
  permission_rules?: SessionRuntimePermissionRule[];
  network_policy?: { mode: string };
  web_search?: { mode: string };
  workspace_scope?: { mounts: string[] };
  approval_policy?: SessionApprovalPolicy;
};

function parseRuntimePatch(body: Record<string, unknown>): { ok: true; value: RuntimePatch } | { ok: false; message: string } {
  if (!Number.isInteger(body.version) || Number(body.version) < 1) {
    return { ok: false, message: "version must be a positive integer" };
  }
  const value: RuntimePatch = { version: Number(body.version) };
  let mutableFieldCount = 0;
  if (body.permission_rules !== undefined) {
    if (!Array.isArray(body.permission_rules) || body.permission_rules.length > 100) {
      return { ok: false, message: "permission_rules must be an array with <=100 entries" };
    }
    mutableFieldCount += 1;
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
    mutableFieldCount += 1;
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
    mutableFieldCount += 1;
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
    mutableFieldCount += 1;
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
  if (mutableFieldCount === 0) {
    return { ok: false, message: "runtime PATCH requires at least one mutable field" };
  }
  return { ok: true, value };
}

function toPublicRule(rule: SessionRuntimePermissionRule): SessionRuntimePermissionRule {
  return {
    ...(typeof rule.rule_uuid === "string" ? { rule_uuid: rule.rule_uuid } : {}),
    tool_name: rule.tool_name,
    ...(typeof rule.pattern === "string" ? { pattern: rule.pattern } : {}),
    behavior: rule.behavior,
    scope: rule.scope === "tenant" ? "tenant" : "session",
  };
}

function mergeRuntimeConfig(
  config: RuntimeConfigRow,
  tenantRules: ReadonlyArray<SessionRuntimePermissionRule>,
): RuntimeConfigRow {
  return {
    ...config,
    permission_rules: [
      ...config.permission_rules.map(toPublicRule),
      ...tenantRules.map(toPublicRule),
    ],
  };
}

async function computeRuntimeEtag(runtime: RuntimeConfigRow, teamUuid: string): Promise<string> {
  const payload = JSON.stringify(runtime);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${payload}:${teamUuid}`));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `"${hex.slice(0, 32)}"`;
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
  const rulesPlane = new D1PermissionRulesPlane(db);
  if (method === "GET") {
    const config = await plane.readOrCreate({ session_uuid: route.sessionUuid, team_uuid: teamUuid });
    const tenantRules = await rulesPlane.listTeamRules(teamUuid);
    const runtime = mergeRuntimeConfig(config, tenantRules);
    const etag = await computeRuntimeEtag(runtime, teamUuid);
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          etag,
          "x-trace-uuid": traceUuid,
        },
      });
    }
    return Response.json({ ok: true, data: runtime, trace_uuid: traceUuid }, {
      status: 200,
      headers: {
        etag,
        "x-trace-uuid": traceUuid,
      },
    });
  }

  const currentConfig = await plane.readOrCreate({ session_uuid: route.sessionUuid, team_uuid: teamUuid });
  const currentTenantRules = await rulesPlane.listTeamRules(teamUuid);
  const currentRuntime = mergeRuntimeConfig(currentConfig, currentTenantRules);
  const currentEtag = await computeRuntimeEtag(currentRuntime, teamUuid);
  const ifMatch = request.headers.get("if-match");
  if (ifMatch !== null && ifMatch !== currentEtag) {
    return jsonPolicyError(409, "conflict", "runtime config changed; refresh and retry with the latest ETag", traceUuid);
  }
  const body = await parseBody(request);
  if (!body) return jsonPolicyError(400, "invalid-input", "runtime PATCH requires a JSON body", traceUuid);
  const parsed = parseRuntimePatch(body);
  if (!parsed.ok) {
    return jsonPolicyError(400, "invalid-input", parsed.message, traceUuid);
  }
  const sessionRules = parsed.value.permission_rules?.filter((rule) => rule.scope !== "tenant");
  const tenantRules = parsed.value.permission_rules?.filter((rule) => rule.scope === "tenant");
  let config: RuntimeConfigRow;
  try {
    config = await plane.patch({
      session_uuid: route.sessionUuid,
      team_uuid: teamUuid,
      expected_version: parsed.value.version,
      ...(parsed.value.permission_rules !== undefined
        ? { permission_rules: sessionRules ?? [] }
        : {}),
      network_policy_mode: parsed.value.network_policy?.mode,
      web_search_mode: parsed.value.web_search?.mode,
      workspace_scope: parsed.value.workspace_scope,
      approval_policy: parsed.value.approval_policy,
    });
  } catch (error) {
    if (error instanceof RuntimeConfigVersionConflictError) {
      return jsonPolicyError(409, "conflict", error.message, traceUuid);
    }
    throw error;
  }
  const mergedTenantRules = parsed.value.permission_rules !== undefined
    ? await rulesPlane.replaceTeamRules({
      team_uuid: teamUuid,
      rules: tenantRules ?? [],
    })
    : await rulesPlane.listTeamRules(teamUuid);
  const responseConfig = mergeRuntimeConfig(config, mergedTenantRules);
  const etag = await computeRuntimeEtag(responseConfig, teamUuid);
  emitFrameViaUserDO(
    env,
    { sessionUuid: route.sessionUuid, userUuid: session.actor_user_uuid, traceUuid },
    "session.runtime.update",
    {
      session_uuid: responseConfig.session_uuid,
      version: responseConfig.version,
      permission_rules: responseConfig.permission_rules,
      network_policy: responseConfig.network_policy,
      web_search: responseConfig.web_search,
      workspace_scope: responseConfig.workspace_scope,
      approval_policy: responseConfig.approval_policy,
      updated_at: responseConfig.updated_at,
    },
  );
  return Response.json({ ok: true, data: responseConfig, trace_uuid: traceUuid }, {
    status: 200,
    headers: {
      etag,
      "x-trace-uuid": traceUuid,
    },
  });
}
