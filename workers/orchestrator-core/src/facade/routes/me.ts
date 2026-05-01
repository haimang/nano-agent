import { authenticateRequest, clearDeviceGateCache } from "../../auth.js";
import { getLogger, type OrchestratorCoreEnv } from "../env.js";
import { jsonPolicyError } from "../../policy/authority.js";
import { D1SessionTruthRepository } from "../../session-truth.js";
import {
  encodeConversationCursor,
  encodeSessionCursor,
  parseBody,
  parseConversationCursor,
  parseListLimit,
  parseSessionCursor,
  UUID_RE,
} from "../shared/request.js";

type MeSessionsRoute = { kind: "create" } | { kind: "list" };
type ConversationDetailRoute = { conversationUuid: string };

function parseMeSessionsRoute(request: Request): MeSessionsRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  if (pathname !== "/me/sessions") return null;
  if (method === "POST") return { kind: "create" };
  if (method === "GET") return { kind: "list" };
  return null;
}

function parseConversationDetailRoute(request: Request): ConversationDetailRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const match = pathname.match(/^\/conversations\/([^/]+)$/);
  if (!match || method !== "GET") return null;
  const conversationUuid = match[1]!;
  if (!UUID_RE.test(conversationUuid)) return null;
  return { conversationUuid };
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
    const body = await parseBody(request, true);
    if (body && typeof body.session_uuid === "string") {
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
          return jsonPolicyError(500, "internal-error", "failed to persist pending session row", traceUuid);
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
  const nextCursor = rows.length > limit
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

async function handleMeConversations(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
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
    return jsonPolicyError(503, "worker-misconfigured", "NANO_AGENT_DB binding must be configured", traceUuid);
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

async function handleMeDevicesList(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
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

async function handleMeDevicesRevoke(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;

  const body = await parseBody(request);
  if (!body || typeof body !== "object") {
    return jsonPolicyError(400, "invalid-input", "revoke requires a JSON body", traceUuid);
  }
  const deviceUuid = body.device_uuid;
  if (typeof deviceUuid !== "string" || !UUID_RE.test(deviceUuid)) {
    return jsonPolicyError(400, "invalid-input", "device_uuid must be a UUID", traceUuid);
  }
  const reason = typeof body.reason === "string" ? body.reason : null;

  const db = env.NANO_AGENT_DB;
  if (!db) {
    return jsonPolicyError(503, "worker-misconfigured", "device store unavailable", traceUuid);
  }

  try {
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
      return Response.json(
        {
          ok: true,
          data: { device_uuid: deviceUuid, status: "revoked", already_revoked: true },
          trace_uuid: traceUuid,
        },
        { status: 200, headers: { "x-trace-uuid": traceUuid } },
      );
    }

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

export async function tryHandleMeRoute(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();

  const meSessionsRoute = parseMeSessionsRoute(request);
  if (meSessionsRoute) return handleMeSessions(request, env, meSessionsRoute);
  if (method === "GET" && pathname === "/me/conversations") return handleMeConversations(request, env);
  const conversationDetailRoute = parseConversationDetailRoute(request);
  if (conversationDetailRoute) return handleConversationDetail(request, env, conversationDetailRoute);
  if ((method === "GET" || method === "PATCH") && pathname === "/me/team") return handleMeTeam(request, env);
  if (method === "GET" && pathname === "/me/teams") return handleMeTeams(request, env);
  if (method === "GET" && pathname === "/me/devices") return handleMeDevicesList(request, env);
  if (method === "POST" && pathname === "/me/devices/revoke") return handleMeDevicesRevoke(request, env);
  return null;
}
