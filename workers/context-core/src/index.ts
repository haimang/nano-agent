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
  async fetch(_request: Request, _env: ContextCoreEnv): Promise<Response> {
    return Response.json(createShellResponse());
  },
};

export type { ContextCoreEnv };
export default worker;
