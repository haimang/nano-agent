import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import type { BashCoreEnv, BashCoreShellResponse } from "./types.js";

function createShellResponse(): BashCoreShellResponse {
  return {
    worker: "bash-core",
    nacp_core_version: NACP_VERSION,
    nacp_session_version: NACP_SESSION_VERSION,
    status: "ok",
    phase: "pre-worker-matrix-W4-shell",
  };
}

const worker = {
  async fetch(_request: Request, _env: BashCoreEnv): Promise<Response> {
    return Response.json(createShellResponse());
  },
};

export type { BashCoreEnv };
export default worker;
