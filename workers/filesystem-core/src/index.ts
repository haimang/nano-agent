import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { FilesystemCoreEnv, FilesystemCoreShellResponse } from "./types.js";

function createShellResponse(env: FilesystemCoreEnv): FilesystemCoreShellResponse {
  return {
    worker: "filesystem-core",
    nacp_core_version: NACP_VERSION,
    nacp_session_version: NACP_SESSION_VERSION,
    status: "ok",
    worker_version: env.WORKER_VERSION ?? `filesystem-core@${env.ENVIRONMENT ?? "dev"}`,
    phase: "worker-matrix-P4-absorbed",
    absorbed_runtime: true,
    library_worker: true,
  };
}

// ZX5 Lane E E2 — filesystem-core 从 library-only(P1-03 binding-scope 401)
// uplift 为 WorkerEntrypoint RPC,与 E1 context-core 完全对称。
// 短期 shim 期间 agent-core 同时保留 in-process library import(per Q6 +
// R9 时间盒化)。**保持 worker 总数 = 6**(per ZX5 Q4 + R8 owner direction)。

function bindingScopeForbidden(): Response {
  return Response.json(
    {
      error: "binding-scope-forbidden",
      message:
        "filesystem-core is a library-only worker; runtime code is consumed in-process by agent-core",
      worker: "filesystem-core",
    },
    { status: 401 },
  );
}

const worker = {
  async fetch(request: Request, env: FilesystemCoreEnv): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (method === "GET" && (pathname === "/" || pathname === "/health")) {
      return Response.json(createShellResponse(env));
    }

    return bindingScopeForbidden();
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
      ],
    };
  }
}

export type { FilesystemCoreEnv };
export default worker;
