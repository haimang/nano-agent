import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import { NanoSessionDO } from "./nano-session-do.js";
import type { AgentCoreEnv, AgentCoreShellResponse } from "./types.js";

function createShellResponse(): AgentCoreShellResponse {
  return {
    worker: "agent-core",
    nacp_core_version: NACP_VERSION,
    nacp_session_version: NACP_SESSION_VERSION,
    status: "ok",
    phase: "pre-worker-matrix-W4-shell",
  };
}

const worker = {
  async fetch(_request: Request, _env: AgentCoreEnv): Promise<Response> {
    return Response.json(createShellResponse());
  },
};

export { NanoSessionDO };
export type { AgentCoreEnv };
export default worker;
