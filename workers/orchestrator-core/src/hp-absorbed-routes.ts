// HP0-H10 deferred-closure absorb — handlers extracted from index.ts to
// keep `workers/orchestrator-core/src/index.ts` within its HP8 P3-01
// megafile budget (Q25 stop-the-bleed). The handlers themselves were
// landed by the HP0-H10 deferred-closure batch (see
// `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md`).
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §0.5 wire-with-delivery
//   * docs/issue/hero-to-pro/HP0-H10-deferred-closure.md HP6-D3, HP6-D4
//   * docs/design/hero-to-pro/HPX-qna.md Q19 (path law), Q21 (cancel event), Q25 (megafile)

import { D1SessionTruthRepository } from "./session-truth.js";
import {
  D1WorkspaceControlPlane,
  normalizeVirtualPath,
  buildWorkspaceR2Key,
} from "./workspace-control-plane.js";
// Structural env subset needed by these handlers; avoids importing
// `OrchestratorCoreEnv` from `index.ts` (which would create a circular
// dependency that madge flags via `pnpm check:cycles`).
type AbsorbedRoutesEnv = {
  readonly NANO_AGENT_DB?: D1Database;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// HPX3 F4 — facade-level session ownership gate, parity with confirmations
// and checkpoints handlers. Returns a 404/409 Response when the session is
// not owned by (teamUuid, userUuid) or is tombstoned; returns null when the
// caller should proceed. Skips when no D1 binding is present (test fixtures).
export async function ensureSessionOwnedOrError(
  env: AbsorbedRoutesEnv,
  args: {
    sessionUuid: string;
    teamUuid: string;
    userUuid: string;
    traceUuid: string;
    jsonPolicyError: (
      status: number,
      code: string,
      message: string,
      traceUuid?: string,
    ) => Response;
  },
): Promise<Response | null> {
  const db = env.NANO_AGENT_DB;
  if (!db) return null;
  const repo = new D1SessionTruthRepository(db);
  const session = await repo.readSessionLifecycle(args.sessionUuid);
  if (
    !session ||
    session.team_uuid !== args.teamUuid ||
    session.actor_user_uuid !== args.userUuid
  ) {
    return args.jsonPolicyError(404, "not-found", "session not found", args.traceUuid);
  }
  if (session.deleted_at) {
    return args.jsonPolicyError(409, "conversation-deleted", "conversation is deleted", args.traceUuid);
  }
  return null;
}

export type SessionToolCallsRoute =
  | { kind: "list"; sessionUuid: string }
  | { kind: "cancel"; sessionUuid: string; toolCallId: string };

export function parseSessionToolCallsRoute(request: Request): SessionToolCallsRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const list = pathname.match(/^\/sessions\/([^/]+)\/tool-calls$/);
  if (list) {
    const sessionUuid = list[1]!;
    if (!UUID_RE.test(sessionUuid)) return null;
    if (method !== "GET") return null;
    return { kind: "list", sessionUuid };
  }
  const cancel = pathname.match(/^\/sessions\/([^/]+)\/tool-calls\/([^/]+)\/cancel$/);
  if (!cancel || method !== "POST") return null;
  const sessionUuid = cancel[1]!;
  const toolCallId = cancel[2]!;
  if (!UUID_RE.test(sessionUuid)) return null;
  return { kind: "cancel", sessionUuid, toolCallId };
}

export type SessionWorkspaceRoute = {
  kind: "list" | "read" | "write" | "delete";
  sessionUuid: string;
  virtualPath: string;
};

export function parseSessionWorkspaceRoute(request: Request): SessionWorkspaceRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const matches = pathname.match(/^\/sessions\/([^/]+)\/workspace\/files(\/.*)?$/);
  if (!matches) return null;
  const sessionUuid = matches[1]!;
  if (!UUID_RE.test(sessionUuid)) return null;
  const rawPath = matches[2] ?? "";
  if (rawPath === "" || rawPath === "/") {
    if (method === "GET") return { kind: "list", sessionUuid, virtualPath: "" };
    return null;
  }
  const virtualPath = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
  if (method === "GET") return { kind: "read", sessionUuid, virtualPath };
  if (method === "PUT" || method === "POST") return { kind: "write", sessionUuid, virtualPath };
  if (method === "DELETE") return { kind: "delete", sessionUuid, virtualPath };
  return null;
}

export interface AbsorbedHandlerDeps {
  authenticateRequest: (
    request: Request,
    env: AbsorbedRoutesEnv,
    options?: { allowQueryToken?: boolean },
  ) => Promise<{
    ok: true;
    value: {
      trace_uuid: string;
      user_uuid: string;
      snapshot: { team_uuid?: string; tenant_uuid?: string };
    };
  } | { ok: false; response: Response }>;
  jsonPolicyError: (
    status: number,
    code: string,
    message: string,
    traceUuid?: string,
  ) => Response;
  parseBody: (request: Request) => Promise<Record<string, unknown> | null>;
}

export async function handleSessionToolCalls(
  request: Request,
  env: AbsorbedRoutesEnv,
  route: SessionToolCallsRoute,
  deps: AbsorbedHandlerDeps,
): Promise<Response> {
  const auth = await deps.authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return deps.jsonPolicyError(503, "worker-misconfigured", "NANO_AGENT_DB binding must be configured", traceUuid);
  }
  const repo = new D1SessionTruthRepository(db);
  const session = await repo.readSessionLifecycle(route.sessionUuid);
  if (
    !session ||
    session.team_uuid !==
      (auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid) ||
    session.actor_user_uuid !== auth.value.user_uuid
  ) {
    return deps.jsonPolicyError(404, "not-found", "session not found", traceUuid);
  }
  if (session.deleted_at) {
    return deps.jsonPolicyError(409, "conversation-deleted", "conversation is deleted", traceUuid);
  }
  if (route.kind === "list") {
    return Response.json(
      {
        ok: true,
        data: {
          session_uuid: route.sessionUuid,
          tool_calls: [],
          source: "ws-stream-only-first-wave",
        },
        trace_uuid: traceUuid,
      },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  }
  return Response.json(
    {
      ok: true,
      data: {
        session_uuid: route.sessionUuid,
        request_uuid: route.toolCallId,
        cancel_initiator: "user",
        forwarded: true,
      },
      trace_uuid: traceUuid,
    },
    { status: 202, headers: { "x-trace-uuid": traceUuid } },
  );
}

export async function handleSessionWorkspace(
  request: Request,
  env: AbsorbedRoutesEnv,
  route: SessionWorkspaceRoute,
  deps: AbsorbedHandlerDeps,
): Promise<Response> {
  const auth = await deps.authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return deps.jsonPolicyError(503, "worker-misconfigured", "NANO_AGENT_DB binding must be configured", traceUuid);
  }
  const repo = new D1SessionTruthRepository(db);
  const session = await repo.readSessionLifecycle(route.sessionUuid);
  if (
    !session ||
    session.team_uuid !==
      (auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid) ||
    session.actor_user_uuid !== auth.value.user_uuid
  ) {
    return deps.jsonPolicyError(404, "not-found", "session not found", traceUuid);
  }
  if (session.deleted_at) {
    return deps.jsonPolicyError(409, "conversation-deleted", "conversation is deleted", traceUuid);
  }
  const teamUuid = session.team_uuid;
  const plane = new D1WorkspaceControlPlane(db);
  if (route.kind === "list") {
    const url = new URL(request.url);
    const prefix = url.searchParams.get("prefix") ?? undefined;
    const files = await plane.list({ session_uuid: route.sessionUuid, prefix });
    return Response.json(
      {
        ok: true,
        data: {
          session_uuid: route.sessionUuid,
          tenant_prefix: `tenants/${teamUuid}/sessions/${route.sessionUuid}/workspace/`,
          files,
        },
        trace_uuid: traceUuid,
      },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  }
  let normalized: string;
  try {
    normalized = normalizeVirtualPath(route.virtualPath);
  } catch (error) {
    return deps.jsonPolicyError(
      400,
      "invalid-input",
      `invalid virtual_path: ${error instanceof Error ? error.message : String(error)}`,
      traceUuid,
    );
  }
  const r2Key = buildWorkspaceR2Key({
    team_uuid: teamUuid,
    session_uuid: route.sessionUuid,
    virtual_path: normalized,
  });
  if (route.kind === "read") {
    const file = await plane.readByPath({
      session_uuid: route.sessionUuid,
      virtual_path: normalized,
    });
    if (!file) {
      return deps.jsonPolicyError(404, "not-found", "workspace file not found", traceUuid);
    }
    return Response.json(
      {
        ok: true,
        data: {
          session_uuid: route.sessionUuid,
          virtual_path: normalized,
          r2_key: r2Key,
          metadata: file,
          content_source: "filesystem-core-leaf-rpc-pending",
        },
        trace_uuid: traceUuid,
      },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  }
  if (route.kind === "write") {
    const body = await deps.parseBody(request);
    if (!body) {
      return deps.jsonPolicyError(400, "invalid-input", "write requires JSON body", traceUuid);
    }
    const contentHash = typeof body.content_hash === "string" ? body.content_hash : null;
    const sizeBytes = typeof body.size_bytes === "number" ? body.size_bytes : 0;
    const mime = typeof body.mime === "string" ? body.mime : null;
    const now = new Date().toISOString();
    await plane.upsert({
      session_uuid: route.sessionUuid,
      team_uuid: teamUuid,
      virtual_path: normalized,
      content_hash: contentHash,
      size_bytes: sizeBytes,
      mime,
      written_by: "user",
      created_at: now,
      expires_at: null,
    });
    return Response.json(
      {
        ok: true,
        data: {
          session_uuid: route.sessionUuid,
          virtual_path: normalized,
          r2_key: r2Key,
          stored: true,
        },
        trace_uuid: traceUuid,
      },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  }
  await plane.deleteByPath({
    session_uuid: route.sessionUuid,
    virtual_path: normalized,
  });
  return Response.json(
    {
      ok: true,
      data: { session_uuid: route.sessionUuid, virtual_path: normalized, deleted: true },
      trace_uuid: traceUuid,
    },
    { status: 200, headers: { "x-trace-uuid": traceUuid } },
  );
}
