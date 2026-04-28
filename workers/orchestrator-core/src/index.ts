import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import {
  facadeFromAuthEnvelope,
  type FacadeErrorCode,
  type OrchestratorAuthRpcService,
} from "@haimang/orchestrator-auth-contract";
import { authenticateRequest, type AuthEnv } from "./auth.js";
import { ensureConfiguredTeam, jsonPolicyError, readTraceUuid } from "./policy/authority.js";
import { D1SessionTruthRepository } from "./session-truth.js";
import { NanoOrchestratorUserDO } from "./user-do.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

    // ZX5 Lane D D5 — GET /me/conversations:对 ZX4 P3-05 已 land 的
    // 5 状态 D1 view 做 conversation 维度聚合(把同 conversation_uuid
    // 的多个 session 收成一个 conversation row)。
    if (method === "GET" && pathname === "/me/conversations") {
      return handleMeConversations(request, env);
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
          console.warn(
            `me-sessions-mint-d1-failed session=${sessionUuid}`,
            { tag: "me-sessions-mint-d1-failed", session_uuid: sessionUuid, error: String(error) },
          );
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
async function handleMeConversations(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = (() => {
    if (limitRaw === null) return 50;
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 200) return 50;
    return n;
  })();

  const stub = env.ORCHESTRATOR_USER_DO.get(env.ORCHESTRATOR_USER_DO.idFromName(auth.value.user_uuid));
  const response = await stub.fetch(
    new Request(`https://orchestrator.internal/me/conversations?limit=${limit}`, {
      method: "GET",
      headers: {
        "x-trace-uuid": traceUuid,
        "x-nano-internal-authority": JSON.stringify(auth.value.snapshot),
      },
    }),
  );
  return wrapSessionResponse(response, traceUuid);
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
    console.warn(
      `me-devices-list-d1-failed user=${auth.value.user_uuid}`,
      { tag: "me-devices-list-d1-failed", error: String(error) },
    );
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
    console.warn(
      `me-devices-revoke-d1-failed device=${deviceUuid} user=${auth.value.user_uuid}`,
      { tag: "me-devices-revoke-d1-failed", error: String(error) },
    );
    return jsonPolicyError(500, "internal-error", "failed to revoke device", traceUuid);
  }
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
export default worker;
