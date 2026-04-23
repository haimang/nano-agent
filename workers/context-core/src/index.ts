import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import type { ContextCoreEnv, ContextCoreShellResponse } from "./types.js";

function createShellResponse(): ContextCoreShellResponse {
  return {
    worker: "context-core",
    nacp_core_version: NACP_VERSION,
    nacp_session_version: NACP_SESSION_VERSION,
    status: "ok",
    phase: "worker-matrix-P3-absorbed",
    absorbed_runtime: true,
    library_worker: true,
  };
}

const worker = {
  async fetch(request: Request, _env: ContextCoreEnv): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (method === "GET" && (pathname === "/" || pathname === "/health")) {
      return Response.json(createShellResponse());
    }

    return new Response("Not Found", { status: 404 });
  },
};

export type { ContextCoreEnv };
export default worker;
