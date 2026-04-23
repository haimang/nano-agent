import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import { NanoSessionDO } from "./host/do/nano-session-do.js";

export interface AgentCoreEnv {
  readonly SESSION_DO: DurableObjectNamespace;
  readonly BASH_CORE?: Fetcher;
  readonly CONTEXT_CORE?: Fetcher;
  readonly FILESYSTEM_CORE?: Fetcher;
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
}

export interface AgentCoreShellResponse {
  readonly worker: "agent-core";
  readonly nacp_core_version: string;
  readonly nacp_session_version: string;
  readonly status: "ok";
  readonly phase: "worker-matrix-P1.A-absorbed";
  readonly absorbed_runtime: true;
}

function createShellResponse(): AgentCoreShellResponse {
  return {
    worker: "agent-core",
    nacp_core_version: NACP_VERSION,
    nacp_session_version: NACP_SESSION_VERSION,
    status: "ok",
    phase: "worker-matrix-P1.A-absorbed",
    absorbed_runtime: true,
  };
}

const worker = {
  async fetch(_request: Request, _env: AgentCoreEnv): Promise<Response> {
    return Response.json(createShellResponse());
  },
};

export { NanoSessionDO };
export default worker;
