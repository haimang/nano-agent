import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
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

// ZX2 Phase 1 P1-03 (transport-profiles.md / binding-scope guard):
// filesystem-core is a library-only worker. /health is the only public
// entry; every other path is denied with 401 to defend against any
// accidental workers.dev exposure.
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

export type { FilesystemCoreEnv };
export default worker;
