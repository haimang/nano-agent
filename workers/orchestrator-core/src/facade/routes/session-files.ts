import { authenticateRequest } from "../../auth.js";
import { jsonPolicyError } from "../../policy/authority.js";
import type { OrchestratorCoreEnv } from "../env.js";
import { getLogger } from "../env.js";
import {
  parseListLimit,
  parseSessionFileUpload,
  sanitizeContentDispositionFilename,
  UUID_RE,
} from "../shared/request.js";
import { requireOwnedSession } from "../shared/ownership.js";

type SessionFilesRoute =
  | { kind: "list"; sessionUuid: string }
  | { kind: "upload"; sessionUuid: string }
  | { kind: "content"; sessionUuid: string; fileUuid: string };

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

export async function tryHandleSessionFilesRoute(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response | null> {
  const route = parseSessionFilesRoute(request);
  return route ? handleSessionFiles(request, env, route) : null;
}
