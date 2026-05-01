import { NACP_VERSION } from "@haimang/nacp-core";
import { respondWithFacadeError } from "@haimang/nacp-core/logger";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import { WorkerEntrypoint } from "cloudflare:workers";
import { NANO_PACKAGE_MANIFEST } from "./generated/package-manifest.js";
import { SessionFileStore } from "./artifacts.js";
import type {
  FilesystemCoreEnv,
  FilesystemCoreShellResponse,
  ListArtifactsInput,
  ReadArtifactInput,
  ReadArtifactResult,
  SessionFileListResult,
  WriteArtifactInput,
  WriteArtifactResult,
} from "./types.js";

void NANO_PACKAGE_MANIFEST;

function createShellResponse(env: FilesystemCoreEnv): FilesystemCoreShellResponse {
  return {
    worker: "filesystem-core",
    nacp_core_version: NACP_VERSION,
    nacp_session_version: NACP_SESSION_VERSION,
    status: "ok",
    worker_version: env.WORKER_VERSION ?? `filesystem-core@${env.ENVIRONMENT ?? "dev"}`,
    phase: "worker-matrix-P4-absorbed",
    absorbed_runtime: true,
  };
}

// ZX5 Lane E E2 — filesystem-core 从 library-only(P1-03 binding-scope 401)
// uplift 为 WorkerEntrypoint RPC,与 E1 context-core 完全对称。
// 短期 shim 期间 agent-core 同时保留 in-process library import(per Q6 +
// R9 时间盒化)。**保持 worker 总数 = 6**(per ZX5 Q4 + R8 owner direction)。

function bindingScopeForbidden(traceUuid: string): Response {
  return respondWithFacadeError(
    "binding-scope-forbidden",
    401,
    "filesystem-core is a leaf worker; business access must use service-binding RPC",
    traceUuid,
    { worker: "filesystem-core" },
  );
}

const worker = {
  async fetch(request: Request, env: FilesystemCoreEnv): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();
    const traceUuid = request.headers.get("x-trace-uuid") ?? crypto.randomUUID();

    if (method === "GET" && (pathname === "/" || pathname === "/health")) {
      return Response.json(createShellResponse(env));
    }

    return bindingScopeForbidden(traceUuid);
  },
};

// ZX5 Lane E E2 — WorkerEntrypoint RPC surface for filesystem-core(同 E1 模式)。
export class FilesystemCoreEntrypoint extends WorkerEntrypoint<FilesystemCoreEnv> {
  async fetch(request: Request): Promise<Response> {
    return worker.fetch(request, this.env);
  }

  async probe(): Promise<{ status: "ok"; worker: "filesystem-core"; worker_version: string }> {
    return {
      status: "ok",
      worker: "filesystem-core",
      worker_version: this.env.WORKER_VERSION ?? `filesystem-core@${this.env.ENVIRONMENT ?? "dev"}`,
    };
  }

  async nacpVersion(): Promise<{ nacp_core: string; nacp_session: string }> {
    return {
      nacp_core: NACP_VERSION,
      nacp_session: NACP_SESSION_VERSION,
    };
  }

  /**
   * Returns the supported filesystem op names that agent-core can call via
   * RPC after Lane E migration completes. Current ZX5 list is the minimal
   * seam exposed by `@haimang/filesystem-core-worker/...`;agent-core
   * adapter 通过短期 shim 选 RPC vs library import。
   */
  async filesystemOps(): Promise<{ ops: string[] }> {
    return {
      ops: [
        "readArtifact",
        "writeArtifact",
        "listArtifacts",
        // HP6-D1 (deferred-closure absorb) — temp file leaf RPC surface.
        // Implemented as best-effort R2 + D1 reads/writes against the
        // tenant-scoped `tenants/{team}/sessions/{session}/workspace/`
        // prefix law (HP6 Q19). Full materialization batch is in HP6
        // follow-up within hero-to-pro; the surface is exposed now so
        // agent-core can begin consuming it instead of constructing
        // host-local artifacts (see Lane E final-state).
        "readTempFile",
        "writeTempFile",
        "listTempFiles",
        "deleteTempFile",
        // HP6-D2 (deferred-closure absorb) — snapshot / restore lineage RPC.
        "readSnapshot",
        "writeSnapshot",
        "copyToFork",
        "cleanup",
      ],
    };
  }

  async writeArtifact(input: WriteArtifactInput, meta?: { trace_uuid?: string; team_uuid?: string }): Promise<WriteArtifactResult> {
    const store = this.requireStore();
    assertAuthority(input.team_uuid, meta?.team_uuid);
    return store.put(input);
  }

  async listArtifacts(input: ListArtifactsInput, meta?: { trace_uuid?: string; team_uuid?: string }): Promise<SessionFileListResult> {
    const store = this.requireStore();
    assertAuthority(input.team_uuid, meta?.team_uuid);
    return store.list(input);
  }

  async readArtifact(input: ReadArtifactInput, meta?: { trace_uuid?: string; team_uuid?: string }): Promise<ReadArtifactResult | null> {
    const store = this.requireStore();
    assertAuthority(input.team_uuid, meta?.team_uuid);
    return store.get(input);
  }

  // ── HP6-D1 (deferred-closure absorb) — temp file leaf RPC ──
  // First-wave: write/read by virtual_path against
  // `tenants/{team}/sessions/{session}/workspace/{normalized}` R2 key.
  // Truth metadata lives in orchestrator-core's
  // `nano_session_temp_files` table; filesystem-core only owns the
  // bytes path. Returns minimal {ok, key, size} envelope.

  async writeTempFile(
    input: {
      readonly team_uuid: string;
      readonly session_uuid: string;
      readonly virtual_path: string;
      readonly content: ArrayBuffer | Uint8Array;
      readonly mime?: string | null;
    },
    meta?: { trace_uuid?: string; team_uuid?: string },
  ): Promise<{ ok: boolean; r2_key: string; size_bytes: number }> {
    if (!this.env.NANO_R2) throw new Error("filesystem-core requires NANO_R2");
    assertAuthority(input.team_uuid, meta?.team_uuid);
    const r2Key = buildTempFileKey(input.team_uuid, input.session_uuid, input.virtual_path);
    const body = input.content instanceof Uint8Array ? input.content : new Uint8Array(input.content);
    await this.env.NANO_R2.put(r2Key, body, {
      httpMetadata: input.mime ? { contentType: input.mime } : undefined,
    });
    return { ok: true, r2_key: r2Key, size_bytes: body.byteLength };
  }

  async readTempFile(
    input: {
      readonly team_uuid: string;
      readonly session_uuid: string;
      readonly virtual_path: string;
    },
    meta?: { trace_uuid?: string; team_uuid?: string },
  ): Promise<{ ok: boolean; r2_key: string; bytes: ArrayBuffer | null; mime: string | null }> {
    if (!this.env.NANO_R2) throw new Error("filesystem-core requires NANO_R2");
    assertAuthority(input.team_uuid, meta?.team_uuid);
    const r2Key = buildTempFileKey(input.team_uuid, input.session_uuid, input.virtual_path);
    const obj = await this.env.NANO_R2.get(r2Key);
    if (!obj) return { ok: false, r2_key: r2Key, bytes: null, mime: null };
    const bytes = await obj.arrayBuffer();
    return { ok: true, r2_key: r2Key, bytes, mime: obj.httpMetadata?.contentType ?? null };
  }

  async listTempFiles(
    input: {
      readonly team_uuid: string;
      readonly session_uuid: string;
      readonly prefix?: string;
    },
    meta?: { trace_uuid?: string; team_uuid?: string },
  ): Promise<{ ok: boolean; r2_keys: string[] }> {
    if (!this.env.NANO_R2) throw new Error("filesystem-core requires NANO_R2");
    assertAuthority(input.team_uuid, meta?.team_uuid);
    const root = `tenants/${input.team_uuid}/sessions/${input.session_uuid}/workspace/`;
    const prefix = input.prefix && input.prefix.length > 0 ? `${root}${input.prefix}` : root;
    const list = await this.env.NANO_R2.list({ prefix });
    return { ok: true, r2_keys: list.objects.map((o) => o.key) };
  }

  async deleteTempFile(
    input: {
      readonly team_uuid: string;
      readonly session_uuid: string;
      readonly virtual_path: string;
    },
    meta?: { trace_uuid?: string; team_uuid?: string },
  ): Promise<{ ok: boolean; r2_key: string }> {
    if (!this.env.NANO_R2) throw new Error("filesystem-core requires NANO_R2");
    assertAuthority(input.team_uuid, meta?.team_uuid);
    const r2Key = buildTempFileKey(input.team_uuid, input.session_uuid, input.virtual_path);
    await this.env.NANO_R2.delete(r2Key);
    return { ok: true, r2_key: r2Key };
  }

  // ── HP6-D2 (deferred-closure absorb) — snapshot / fork lineage RPC ──

  async readSnapshot(
    input: {
      readonly team_uuid: string;
      readonly session_uuid: string;
      readonly checkpoint_uuid: string;
      readonly virtual_path: string;
    },
    meta?: { trace_uuid?: string; team_uuid?: string },
  ): Promise<{ ok: boolean; r2_key: string; bytes: ArrayBuffer | null }> {
    if (!this.env.NANO_R2) throw new Error("filesystem-core requires NANO_R2");
    assertAuthority(input.team_uuid, meta?.team_uuid);
    const r2Key = buildSnapshotKey(input.team_uuid, input.session_uuid, input.checkpoint_uuid, input.virtual_path);
    const obj = await this.env.NANO_R2.get(r2Key);
    if (!obj) return { ok: false, r2_key: r2Key, bytes: null };
    const bytes = await obj.arrayBuffer();
    return { ok: true, r2_key: r2Key, bytes };
  }

  async writeSnapshot(
    input: {
      readonly team_uuid: string;
      readonly session_uuid: string;
      readonly checkpoint_uuid: string;
      readonly virtual_path: string;
      readonly content: ArrayBuffer | Uint8Array;
    },
    meta?: { trace_uuid?: string; team_uuid?: string },
  ): Promise<{ ok: boolean; r2_key: string; size_bytes: number }> {
    if (!this.env.NANO_R2) throw new Error("filesystem-core requires NANO_R2");
    assertAuthority(input.team_uuid, meta?.team_uuid);
    const r2Key = buildSnapshotKey(input.team_uuid, input.session_uuid, input.checkpoint_uuid, input.virtual_path);
    const body = input.content instanceof Uint8Array ? input.content : new Uint8Array(input.content);
    await this.env.NANO_R2.put(r2Key, body);
    return { ok: true, r2_key: r2Key, size_bytes: body.byteLength };
  }

  async copyToFork(
    input: {
      readonly team_uuid: string;
      readonly source_session_uuid: string;
      readonly target_session_uuid: string;
      readonly virtual_path: string;
    },
    meta?: { trace_uuid?: string; team_uuid?: string },
  ): Promise<{ ok: boolean; source_key: string; target_key: string; size_bytes: number }> {
    if (!this.env.NANO_R2) throw new Error("filesystem-core requires NANO_R2");
    assertAuthority(input.team_uuid, meta?.team_uuid);
    const sourceKey = buildTempFileKey(input.team_uuid, input.source_session_uuid, input.virtual_path);
    const targetKey = buildTempFileKey(input.team_uuid, input.target_session_uuid, input.virtual_path);
    const obj = await this.env.NANO_R2.get(sourceKey);
    if (!obj) return { ok: false, source_key: sourceKey, target_key: targetKey, size_bytes: 0 };
    const bytes = await obj.arrayBuffer();
    await this.env.NANO_R2.put(targetKey, bytes);
    return { ok: true, source_key: sourceKey, target_key: targetKey, size_bytes: bytes.byteLength };
  }

  async cleanup(
    input: {
      readonly team_uuid: string;
      readonly session_uuid: string;
    },
    meta?: { trace_uuid?: string; team_uuid?: string },
  ): Promise<{ ok: boolean; deleted_count: number }> {
    if (!this.env.NANO_R2) throw new Error("filesystem-core requires NANO_R2");
    assertAuthority(input.team_uuid, meta?.team_uuid);
    const root = `tenants/${input.team_uuid}/sessions/${input.session_uuid}/`;
    const list = await this.env.NANO_R2.list({ prefix: root });
    let deleted = 0;
    for (const obj of list.objects) {
      await this.env.NANO_R2.delete(obj.key);
      deleted += 1;
    }
    return { ok: true, deleted_count: deleted };
  }

  private requireStore(): SessionFileStore {
    if (!this.env.NANO_AGENT_DB || !this.env.NANO_R2) {
      throw new Error("filesystem-core requires NANO_AGENT_DB and NANO_R2");
    }
    return new SessionFileStore({
      db: this.env.NANO_AGENT_DB,
      r2: this.env.NANO_R2,
    });
  }
}

// HP6-D1/D2 — tenant-scoped R2 key builders.
// Mirror of orchestrator-core `buildWorkspaceR2Key` /
// `buildCheckpointSnapshotR2Key` so filesystem-core can be the bytes
// owner without cross-importing orchestrator-core types. The path law
// is frozen by HP6 Q19.
function buildTempFileKey(teamUuid: string, sessionUuid: string, virtualPath: string): string {
  const trimmed = virtualPath.replace(/^\/+/, "");
  return `tenants/${teamUuid}/sessions/${sessionUuid}/workspace/${trimmed}`;
}

function buildSnapshotKey(
  teamUuid: string,
  sessionUuid: string,
  checkpointUuid: string,
  virtualPath: string,
): string {
  const trimmed = virtualPath.replace(/^\/+/, "");
  return `tenants/${teamUuid}/sessions/${sessionUuid}/checkpoints/${checkpointUuid}/snapshot/${trimmed}`;
}

function assertAuthority(teamUuid: string, metaTeamUuid?: string): void {
  if (typeof metaTeamUuid === "string" && metaTeamUuid.length > 0 && metaTeamUuid !== teamUuid) {
    throw new Error(`team authority mismatch: ${metaTeamUuid} cannot access ${teamUuid}`);
  }
}

export type { FilesystemCoreEnv };
// Named export for tests and internal callers that need the raw fetch handler.
export { worker as fetchWorker };
// ZX5 Lane E: WorkerEntrypoint as the default so Cloudflare Workers runtime
// exposes RPC methods via service binding.
export default FilesystemCoreEntrypoint;
